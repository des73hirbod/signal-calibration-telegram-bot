/**
 * Signal Calibration — ChannelGate.gs
 *
 * Prospective companion build: CHANNEL_GATE.VERSION = '8'.
 * Historical ChannelGate V2 bytes are not available, so this module does not
 * claim to reconstruct or replace them byte-for-byte. It is a new successor
 * built from the verified 364-line V1 seed and the documented R17 contract, now
 * advanced through PE07 with legacy-migration, capacity, backup/recovery, and key-governance operator controls in addition to the PE05/PE06 access surfaces.
 *
 * R21 integration contract:
 *   - R21 calls channelGateAllows_(envelope, lock) only while its existing
 *     LockService.getScriptLock() lock is held.
 *   - The call occurs after deleted-update replay/idempotency guards and before
 *     beginOperation_(), participant creation, or Signal Calibration dispatch.
 *   - This module never acquires a second script lock on that hot path.
 *
 * Separation of concerns:
 *   1) channel membership qualification is a channel-scoped cache and may be
 *      deleted independently; and
 *   2) lifetime participation eligibility is bot/project-scoped access-control
 *      state and may survive participant/research-data deletion after genuine
 *      enrollment.
 *
 * Access-control state and re-entry grant metadata in this module are not
 * Signal Calibration research variables and must not be used as Signal/Noise,
 * outcome, adherence, evidence, layer, or intervention-selection inputs.
 * PE05/OT03 grant codes are account-bound, single-use, finite-lived, and stored
 * only as keyed verifiers. Legacy V1 codes are not reconstructable; V2 codes
 * are deterministically recoverable from persisted non-secret grant metadata.
 * Raw/formatted codes are never persisted or logged by this module.
 *
 * Membership fast path:
 *   A verified user performs no Telegram getChatMember call and no membership
 *   persistence rewrite. Script Properties are read by targeted getProperty()
 *   calls only; the hot path never snapshots the full property store.
 */

const CHANNEL_GATE = Object.freeze({
  VERSION: '8',

  REQUIRED_CHANNEL_PROPERTY: 'REQUIRED_CHANNEL_USERNAME',
  BOT_TOKEN_PROPERTY: 'BOT_TOKEN',
  VERIFY_ACTION: 'CHANNEL_VERIFY',

  // OT02 owner/request access-control plane. Owner identity is optional for
  // ordinary participation and exact Telegram User.id when configured.
  OWNER_TELEGRAM_USER_ID_PROPERTY: 'OWNER_TELEGRAM_USER_ID',
  OWNER_MAX_USER_ID: 4503599627370495,
  OWNER_STATUS_COMMAND: '/owner-status',
  OWNER_CALLBACK_VERSION: 'O1',
  OWNER_CALLBACK_SIGNING_CONTEXT: 'scb-owner-action-v1|',
  OWNER_CALLBACK_TAG_HEX_LENGTH: 16,
  OWNER_CALLBACK_MAX_BYTES: 64,

  REENTRY_REQUEST_VERSION: '1',
  REENTRY_REQUEST_STORAGE_PREFIX: 'SCB_PE_REQ_V1_',
  REENTRY_REQUEST_ACTION: 'PE_REQ|1',
  REENTRY_REQUEST_ID_HEX_LENGTH: 24,
  REENTRY_REQUEST_ID_CONTEXT: 'scb-reentry-request-id-v1|',
  REENTRY_REQUEST_HUMAN_REF_CONTEXT: 'scb-owner-human-ref-v1|',
  REENTRY_REQUEST_WINDOW_MS: 24 * 60 * 60 * 1000,
  REENTRY_REQUEST_NOTIFY_COOLDOWN_MS: 15 * 60 * 1000,
  REENTRY_REQUEST_MAX_GENERATION: 999998,
  REENTRY_REQUEST_STATUS: Object.freeze({
    PENDING: 'PENDING',
    DENIED: 'DENIED',
    APPROVED: 'APPROVED'
  }),

  // Preserve the existing V1 membership-cache key/value contract so a safe
  // successor deployment does not invalidate already-verified channel members.
  MEMBERSHIP_CACHE_VERSION: '1',
  MEMBERSHIP_STORAGE_PREFIX: 'SCB_CG_V1_',
  MEMBERSHIP_VERIFIED_VALUE: 'VERIFIED',
  MEMBERSHIP_KEY_HASH_HEX_LENGTH: 24,

  // Lifetime eligibility has a separate identity domain and keyspace.
  ELIGIBILITY_VERSION: '1',
  ELIGIBILITY_STORAGE_PREFIX: 'SCB_PE_V1_',
  ELIGIBILITY_IDENTITY_PEPPER_PROPERTY: 'ACCESS_IDENTITY_PEPPER',
  ELIGIBILITY_IDENTITY_KEY_VERSION_PROPERTY: 'ACCESS_IDENTITY_PEPPER_VERSION',
  ELIGIBILITY_IDENTITY_KEY_VERSION: '1',
  ELIGIBILITY_IDENTITY_CONTEXT: 'scb-participation-eligibility-v1|',
  ELIGIBILITY_MIN_PEPPER_LENGTH: 32,
  ELIGIBILITY_MAX_PEPPER_LENGTH: 512,

  // PE07 Script Properties capacity governance. Google currently documents
  // 500 KB total storage per property store. These thresholds are deliberately
  // lower: 60% warning and 80% growth stop, leaving headroom for configuration
  // and non-growing reconciliation transitions.
  PROPERTY_STORE_DOCUMENTED_LIMIT_BYTES: 500000,
  PROPERTY_STORE_WARNING_BYTES: 300000,
  PROPERTY_STORE_GROWTH_STOP_BYTES: 400000,

  // PE07 migration/operator inputs. Raw Telegram IDs are accepted only as
  // ephemeral operator inputs; migration reports return pseudonymous access refs.
  MIGRATION_VERSION: '1',
  MIGRATION_CANDIDATE_USER_IDS_PROPERTY: 'SCB_PE_MIGRATION_CANDIDATE_USER_IDS',
  MIGRATION_APPROVED_DRY_RUN_HASH_PROPERTY: 'SCB_PE_MIGRATION_APPROVED_DRY_RUN_HASH',
  RESTORE_BACKUP_FILE_ID_PROPERTY: 'SCB_PE_RESTORE_BACKUP_FILE_ID',
  BACKUP_FORMAT_VERSION: '1',
  BACKUP_INTEGRITY_CONTEXT: 'scb-eligibility-backup-integrity-v1|',

  ELIGIBILITY_STATE: Object.freeze({
    ENROLLED: 'ENROLLED',
    RETIRING: 'RETIRING',
    LOCKED: 'LOCKED'
  }),

  // PE05 re-entry grants are a temporary authorization overlay. Lifetime
  // eligibility remains LOCKED until the PE03 durable enrollment boundary
  // atomically advances the participation generation back to ENROLLED.
  REENTRY_GRANT_VERSION: '1',
  REENTRY_GRANT_STORAGE_PREFIX: 'SCB_PE_GRANT_V1_',
  REENTRY_VERIFIER_CONTEXT: 'scb-reentry-verifier-v1|',
  REENTRY_CODE_DERIVATION_CONTEXT: 'scb-reentry-code-v1|',
  REENTRY_CODE_V2_DERIVATION_CONTEXT: 'scb-reentry-code-v2|',
  REENTRY_CODE_VERSION_V2: 2,
  REENTRY_ISSUANCE_ORIGIN: Object.freeze({
    TELEGRAM_OWNER: 'TELEGRAM_OWNER',
    OPERATOR: 'OPERATOR'
  }),
  REENTRY_GRANT_ID_CONTEXT: 'scb-reentry-grant-id-v1|',
  REENTRY_CODE_HEX_LENGTH: 24, // 96 bits; R21 rate limiting runs before this gate.
  REENTRY_GRANT_ID_HEX_LENGTH: 24,
  REENTRY_DEFAULT_TTL_MINUTES: 1440,
  REENTRY_MIN_TTL_MINUTES: 5,
  REENTRY_MAX_TTL_MINUTES: 10080,
  REENTRY_TTL_PROPERTY: 'SCB_REENTRY_GRANT_TTL_MINUTES',
  REENTRY_OPERATOR_TARGET_USER_ID_PROPERTY: 'SCB_REENTRY_OPERATOR_TARGET_USER_ID',
  REENTRY_OPERATOR_REASON_PROPERTY: 'SCB_REENTRY_OPERATOR_REASON',

  REENTRY_GRANT_STATUS: Object.freeze({
    ISSUED: 'ISSUED',
    MEMBERSHIP_PENDING: 'MEMBERSHIP_PENDING',
    REENTRY_AUTHORIZED: 'REENTRY_AUTHORIZED',
    CONSUMING: 'CONSUMING',
    CONSUMED: 'CONSUMED',
    REVOKED: 'REVOKED'
  }),

  REENTRY_REASON: Object.freeze({
    TECHNICAL_REPLACEMENT: 'TECHNICAL_REPLACEMENT',
    APPROVED_REPEAT_PARTICIPATION: 'APPROVED_REPEAT_PARTICIPATION',
    VALIDATION_TEST_IDENTITY: 'VALIDATION_TEST_IDENTITY',
    OTHER_OWNER_AUTHORIZED: 'OTHER_OWNER_AUTHORIZED'
  }),

  NONMEMBER_TEXT: 'Join the Signal Calibration channel to use the bot.',
  TECHNICAL_FAILURE_TEXT: 'I couldn\'t verify access right now. Please try again.',
  INVALID_CALLBACK_TEXT: 'That verification button is not valid for this chat. Please use the current verification button.',
  LOCKED_TEXT: 'This Telegram account has already participated in Signal Calibration. Another participation requires owner authorization. You can request re-entry here, or if you already have a one-time re-entry code, send /unlock CODE.',
  LOCKED_PRIVACY_TEXT: 'After genuine Signal Calibration enrollment, the bot retains limited pseudonymous access/deletion-control evidence after /delete-data: the participation-eligibility marker used to prevent automatic repeat enrollment; deletion-audit evidence used to confirm/reconcile deletion and reject replay of the deleted update; and, if applicable, re-entry request/grant records under their separate access-control lifecycle. These retained records contain no Telegram ID, Signal Calibration answers, or deleted research records and are not used as Signal Calibration outcomes or research measures. The ordinary current-channel membership verification cache is separate and deletable. If you explicitly request another participation, the owner-visible request contains only a pseudonymous reference and participation generation; signed button-routing metadata is used only to process the owner action and is not stored in the request record or logged. Research answers and deleted research records are not sent to the owner through this mechanism.',
  LOCKED_HELP_TEXT: 'This Telegram account has already participated. Use Request re-entry to ask the owner for another participation when owner control is available. If the owner gives you a one-time re-entry code, send /unlock CODE. Use /privacy for the retained access-marker and request policy. /acute and /recovery remain available for static safety/support information.',
  LOCKED_DELETE_TEXT: 'This account is already locked against automatic repeat enrollment. Participant/research data may already have been deleted or may still be under operator reconciliation. /delete-data does not remove the minimal pseudonymous participation-eligibility marker or deletion-audit evidence; any re-entry request/grant records remain under their separate access-control lifecycle. These retained governance/control records contain no Telegram ID, Signal Calibration answers, or deleted research content. Another independent participation still requires owner authorization.',
  LOCKED_ACUTE_TEXT: 'Get help now if you need it. No further reply is required. This message does not start or restore Signal Calibration participation.',
  LOCKED_RECOVERY_TEXT: 'Rest now. No further reply is required. This message does not start or restore Signal Calibration participation.',
  RETIRING_TEXT: 'Your previous Signal Calibration participation is still being closed. Please try again after it is reconciled.',
  OWNER_UNAVAILABLE_TEXT: 'Owner re-entry controls are unavailable for this action.',
  OWNER_CALLBACK_INVALID_TEXT: 'That owner action is invalid, stale, or no longer actionable.',
  OWNER_APPROVAL_PARTIAL_TEXT: 'The re-entry authorization was created, but the request state was not finalized. Retry the same Approve action.',
  OWNER_REVOKE_RECONCILIATION_TEXT: 'This re-entry authorization is being consumed and cannot be revoked until reconciliation finishes.',
  OWNER_REVOKED_TEXT: 'Re-entry authorization revoked.',
  OWNER_ALREADY_REVOKED_TEXT: 'This re-entry authorization is already revoked.',
  OWNER_CONSUMED_TEXT: 'This re-entry authorization has already been consumed and cannot be revoked.',
  OWNER_EXPIRED_TEXT: 'This re-entry authorization has expired.',
  REQUEST_RECORDED_TEXT: 'Your re-entry request was recorded. Owner notification was attempted.',
  REQUEST_PENDING_TEXT: 'Your re-entry request is already pending.',
  REQUEST_NOTIFY_UNCONFIRMED_TEXT: 'Your re-entry request was recorded. Owner notification was not confirmed. You can try Request re-entry again after the retry interval.',
  REQUEST_DENIED_TEXT: 'This re-entry request was not approved. You can create a new request after the current request window ends.',
  REQUEST_UNAVAILABLE_TEXT: 'This Telegram account has already participated in Signal Calibration. Owner-mediated re-entry requests are temporarily unavailable. If you already have a one-time re-entry code, send /unlock CODE.',
  REQUEST_NOT_READY_TEXT: 'A re-entry request cannot be created while prior participation or deletion reconciliation is still unresolved.',
  REQUEST_ACTIVE_GRANT_TEXT: 'A re-entry authorization is already active for this account. Use the existing authorization path; a second request was not created.',
  REQUEST_RECONCILIATION_TEXT: 'A re-entry authorization is still being reconciled. Another request cannot be created yet.',
  REENTRY_PENDING_TEXT: 'Your re-entry code is valid. Join the current Signal Calibration channel, then use the verification button to continue.',
  REENTRY_RECONCILIATION_TEXT: 'Your re-entry authorization needs operator reconciliation before another participation can begin.',
  REENTRY_INVALID_TEXT: 'That re-entry code is not valid for this Telegram account, is no longer active, or has already been used.',
  REENTRY_ALREADY_ACTIVE_TEXT: 'Re-entry authorization is already active for this Telegram account. Use /start to continue fresh setup.'
});

/**
 * Primary R21 integration function.
 *
 * @param {Object} envelope R21-validated Telegram private-chat envelope.
 * @param {Lock} lock The exact ScriptLock already held by R21 doPost().
 * @return {boolean} true only when R21 may continue processing this update.
 */
function channelGateRetiringSafetyCommand_(text) {
  const raw=String(text==null?'':text).trim();
  const match=/^(\/(?:acute|recovery))(?:@[A-Za-z0-9_]+)?(?:\s|$)/i.exec(raw);
  return match?String(match[1]).toLowerCase():'';
}

// FINAL-GATE-01: Data controls do not require current channel membership.
// This is a narrow, identity-bound route into Core, NOT an enrollment bypass.
// RETIRING is excluded: a deletion already in reconciliation must not race a new operation.
function channelGateCoreDataRightsRequest_(envelope) {
  const text = String(envelope.text == null ? '' : envelope.text).trim();
  const command = text.split(/\s+/)[0].toLowerCase();
  const cb = String(envelope.callbackData == null ? '' : envelope.callbackData);
  const deletionCallback = /^DC_DELETE_(?:CONFIRM|CANCEL)\|/.test(cb);
  const stopCallback = /^STOP_(?:CONFIRM|CANCEL)\|/.test(cb);
  const isStop = command === '/stop' || stopCallback;
  const isDeletion = command === '/delete-data' || deletionCallback;
  const isPrivacy = command === '/privacy';
  if (!isStop && !isDeletion && !isPrivacy) return {requested:false};
  let existing = {ok:false,exists:false,consentStatus:'',reason:'NO_READ_HELPER'};
  try {
    if (typeof findExistingParticipantForSafetyGate_ === 'function')
      existing = findExistingParticipantForSafetyGate_(envelope.userId);
  } catch (error) { existing = {ok:false,exists:false,reason:'IDENTITY_READ_FAILED'}; }
  if (!existing || !existing.ok) return {requested:true,allow:false,reason:'IDENTITY_LOOKUP_UNAVAILABLE'};
  if (!existing.exists) return {requested:true,allow:false,reason:'NO_PARTICIPANT_RECORD'};
  if (isStop && String(existing.consentStatus) !== 'CONSENTED')
    return {requested:true,allow:false,reason:'NOT_CONSENTED'};
  return {requested:true,allow:true,reason:'EXISTING_PARTICIPANT_IDENTITY_VERIFIED'};
}

function channelGateAllows_(envelope, lock) {
  const identity = channelGateValidateEnvelope_(envelope);
  if (!identity.ok) {
    channelGateLog_('CHANNEL_GATE_ENVELOPE_REJECTED', { reason: identity.reason });
    return false;
  }

  if (!channelGateHasHeldLock_(lock)) {
    channelGateAckBlockedCallback_(envelope);
    channelGateLog_('CHANNEL_GATE_LOCK_REQUIRED', {});
    return false;
  }

  // This module shares Apps Script scope with Core, which owns the single
  // strict @bot parser. No username guess or foreign command passes this gate.
  const botAddress = typeof scbResolveTelegramCommandText_ === 'function'
    ? scbResolveTelegramCommandText_(envelope.text) : {accepted:false,reason:'CORE_COMMAND_PARSER_MISSING'};
  if (!botAddress.accepted) {
    channelGateAckBlockedCallback_(envelope);
    channelGateLog_('CHANNEL_GATE_BOT_ADDRESS_REJECTED',{reason:botAddress.reason||'UNKNOWN'});
    return false;
  }
  envelope.text = botAddress.text;

  // OT02: explicit owner controls are parsed before ordinary eligibility/channel
  // routing but remain behind the R21 webhook/update/rate-limit/ScriptLock layer.
  // Ordinary owner commands are not privileged; only the explicit surfaces below
  // are consumed here.
  const ownerCommand = channelGateOwnerCommand_(envelope.text);
  const ownerCallback = channelGateParseOwnerCallback_(envelope.callbackData);
  if (ownerCommand || ownerCallback.isOwnerCallback) {
    channelGateAckBlockedCallback_(envelope);
    channelGateHandleExplicitOwnerControl_(envelope, lock, ownerCommand, ownerCallback);
    return false;
  }

  const eligibilityConfig = channelGateEligibilityConfig_();
  if (!eligibilityConfig.ok) {
    channelGateAckBlockedCallback_(envelope);
    channelGateSendTechnicalFailure_(envelope.chatId, null, envelope.userId);
    channelGateLog_('CHANNEL_GATE_ELIGIBILITY_CONFIGURATION_INVALID', { reason: eligibilityConfig.reason });
    return false;
  }

  let eligibility;
  try {
    const eligibilityKey = channelGateEligibilityStorageKeyFromConfig_(envelope.userId, eligibilityConfig);
    const eligibilityRaw = PropertiesService.getScriptProperties().getProperty(eligibilityKey);
    eligibility = channelGateParseEligibilityRecord_(eligibilityRaw);
  } catch (error) {
    channelGateAckBlockedCallback_(envelope);
    channelGateSendTechnicalFailure_(envelope.chatId, null, envelope.userId);
    channelGateLog_('CHANNEL_GATE_ELIGIBILITY_STORAGE_UNAVAILABLE', { message: channelGateSafeError_(error) });
    return false;
  }
  if (!eligibility.ok) {
    channelGateAckBlockedCallback_(envelope);
    channelGateSendTechnicalFailure_(envelope.chatId, null, envelope.userId);
    channelGateLog_('CHANNEL_GATE_ELIGIBILITY_CORRUPT', { reason: eligibility.reason });
    return false;
  }

  const requestCallback = channelGateParseRequestCallback_(envelope.callbackData);
  if (requestCallback.isRequestCallback && !requestCallback.valid) {
    channelGateAckBlockedCallback_(envelope);
    channelGateSendText_(CHANNEL_GATE.INVALID_CALLBACK_TEXT, envelope.chatId);
    channelGateLog_('CHANNEL_GATE_REENTRY_REQUEST_CALLBACK_REJECTED', { reason: requestCallback.reason });
    return false;
  }

  const verifyCallback = channelGateParseVerifyCallback_(envelope.callbackData);
  if (verifyCallback.isGateCallback && !verifyCallback.valid) {
    channelGateAckBlockedCallback_(envelope);
    channelGateSendText_(CHANNEL_GATE.INVALID_CALLBACK_TEXT, envelope.chatId);
    channelGateLog_('CHANNEL_GATE_VERIFY_CALLBACK_REJECTED', { reason: verifyCallback.reason });
    return false;
  }
  if (verifyCallback.valid && String(verifyCallback.boundUserId) !== String(envelope.userId)) {
    channelGateAckBlockedCallback_(envelope);
    channelGateSendText_(CHANNEL_GATE.INVALID_CALLBACK_TEXT, envelope.chatId);
    channelGateLog_('CHANNEL_GATE_VERIFY_CALLBACK_REJECTED', { reason: 'user_binding_mismatch' });
    return false;
  }

  // `/unlock` is gate-owned in every eligibility condition. The raw code never
  // reaches R21 dispatch/free-text handling and is never written to research data.
  const unlock = channelGateParseUnlockCommand_(envelope.text);
  if (unlock.isCommand) {
    channelGateAckBlockedCallback_(envelope);
    return channelGateHandleUnlockCommand_(envelope, lock, eligibilityConfig, eligibility, unlock);
  }

  // The only membership/LOCKED bypass is a verified, existing identity's
  // stop/deletion/privacy control. It cannot start or resume research and
  // cannot race RETIRING. No new participant record is created by the lookup.
  if (!(eligibility.exists && eligibility.state === CHANNEL_GATE.ELIGIBILITY_STATE.RETIRING)) {
    const rights = channelGateCoreDataRightsRequest_(envelope);
    if (rights.requested) {
      if (rights.allow) {
        channelGateLog_('CHANNEL_GATE_DATA_RIGHTS_CORE_PASS_THROUGH',{kind:String(envelope.callbackData||'').startsWith('DC_DELETE_')?'delete_callback':String(envelope.callbackData||'').startsWith('STOP_')?'stop_callback':String(envelope.text||'').trim().split(/\s+/)[0],scope:'EXISTING_IDENTITY_ONLY'});
        return true;
      }
      channelGateAckBlockedCallback_(envelope);
      if (rights.reason === 'IDENTITY_LOOKUP_UNAVAILABLE')
        channelGateSendTechnicalFailure_(envelope.chatId,null,envelope.userId);
      else if (String(envelope.text||'').trim().toLowerCase() === '/privacy')
        channelGateSendText_('Privacy information is available after channel verification. No new research response was recorded.',envelope.chatId);
      else
        channelGateSendText_('No current participant record eligible for that action was found. No record was changed. If you believe this is wrong, use the verified study contact provided in your consent materials.',envelope.chatId);
      channelGateLog_('CHANNEL_GATE_DATA_RIGHTS_DENIED',{reason:rights.reason});
      return false;
    }
  }

  if (eligibility.exists && eligibility.state === CHANNEL_GATE.ELIGIBILITY_STATE.RETIRING) {
    const retiringSafetyCommand=channelGateRetiringSafetyCommand_(envelope.text);
    if(retiringSafetyCommand) {
      let existing={ok:false,exists:false,consentStatus:'',reason:'NO_READ_HELPER'};
      try {
        if(typeof findExistingParticipantForSafetyGate_==='function') existing=findExistingParticipantForSafetyGate_(envelope.userId);
      } catch(error) { existing={ok:false,exists:false,consentStatus:'',reason:'PARTICIPANT_READ_THROW'}; }
      if(existing && existing.ok && existing.exists && String(existing.consentStatus)==='CONSENTED') {
        channelGateLog_('CHANNEL_GATE_RETIRING_SAFETY_PASS_THROUGH',{command:retiringSafetyCommand,generation:eligibility.generation});
        return true;
      }
      channelGateAckBlockedCallback_(envelope);
      channelGateSendLockedStatic_(retiringSafetyCommand,envelope.chatId);
      channelGateLog_('CHANNEL_GATE_RETIRING_SAFETY_STATIC',{command:retiringSafetyCommand,generation:eligibility.generation,reason:String(existing&&existing.reason||existing&&existing.exists?'UNPROVEN_CONSENT':'PARTICIPANT_ABSENT')});
      return false;
    }
    channelGateAckBlockedCallback_(envelope);
    channelGateSendText_(CHANNEL_GATE.RETIRING_TEXT, envelope.chatId);
    channelGateLog_('CHANNEL_GATE_BLOCKED_RETIRING', { generation: eligibility.generation });
    return false;
  }

  if (requestCallback.valid && !(eligibility.exists && eligibility.state === CHANNEL_GATE.ELIGIBILITY_STATE.LOCKED)) {
    channelGateAckBlockedCallback_(envelope);
    channelGateSendText_(CHANNEL_GATE.REQUEST_UNAVAILABLE_TEXT, envelope.chatId);
    channelGateLog_('CHANNEL_GATE_REENTRY_REQUEST_NOT_LOCKED', {});
    return false;
  }

  // LOCKED remains the lifetime fact while a grant is pending/authorized. Only
  // the separate grant overlay can open fresh setup, and a plain locked `/start`
  // performs no Telegram membership API call.
  if (eligibility.exists && eligibility.state === CHANNEL_GATE.ELIGIBILITY_STATE.LOCKED) {
    const lockedCommand = channelGateLockedCommand_(envelope.text);
    if (lockedCommand && lockedCommand !== '/delete-data') {
      channelGateAckBlockedCallback_(envelope);
      channelGateSendLockedStatic_(lockedCommand, envelope.chatId);
      channelGateLog_('CHANNEL_GATE_LOCKED_STATIC_SURFACE', { command: lockedCommand, generation: eligibility.generation });
      return false;
    }

    const grant = channelGateReadReentryGrantForUser_(envelope.userId, eligibilityConfig);
    if (!grant.ok) {
      channelGateAckBlockedCallback_(envelope);
      channelGateSendTechnicalFailure_(envelope.chatId, null, envelope.userId);
      channelGateLog_('CHANNEL_GATE_REENTRY_GRANT_CORRUPT', { reason: grant.reason });
      return false;
    }

    if (requestCallback.valid) {
      channelGateAckBlockedCallback_(envelope);
      return channelGateHandleParticipantReentryRequest_(envelope, lock, eligibilityConfig, eligibility, grant);
    }

    if (lockedCommand === '/delete-data' && !(grant.exists && grant.effectiveStatus === CHANNEL_GATE.REENTRY_GRANT_STATUS.REENTRY_AUTHORIZED)) {
      channelGateAckBlockedCallback_(envelope);
      channelGateSendLockedStatic_(lockedCommand, envelope.chatId);
      channelGateLog_('CHANNEL_GATE_LOCKED_STATIC_SURFACE', { command: lockedCommand, generation: eligibility.generation });
      return false;
    }

    if (grant.exists && grant.effectiveStatus === CHANNEL_GATE.REENTRY_GRANT_STATUS.CONSUMING) {
      channelGateAckBlockedCallback_(envelope);
      channelGateSendText_(CHANNEL_GATE.REENTRY_RECONCILIATION_TEXT, envelope.chatId);
      channelGateLog_('CHANNEL_GATE_REENTRY_CONSUMPTION_RECONCILIATION_REQUIRED', {
        generation: eligibility.generation,
        targetGeneration: grant.targetGeneration,
        grantId: grant.grantId
      });
      return false;
    }

    if (grant.exists && grant.effectiveStatus === CHANNEL_GATE.REENTRY_GRANT_STATUS.MEMBERSHIP_PENDING) {
      if (verifyCallback.valid) {
        return channelGateCompletePendingReentryMembership_(envelope, lock, eligibilityConfig, eligibility, grant);
      }
      channelGateAckBlockedCallback_(envelope);
      const channel = channelGateReadRequiredChannel_();
      if (!channel.ok) {
        channelGateSendTechnicalFailure_(envelope.chatId, null, envelope.userId);
        return false;
      }
      channelGateSendJoinPrompt_(envelope.chatId, envelope.userId, channel);
      channelGateLog_('CHANNEL_GATE_REENTRY_MEMBERSHIP_PENDING', {
        generation: eligibility.generation,
        targetGeneration: grant.targetGeneration,
        grantId: grant.grantId
      });
      return false;
    }

    if (!(grant.exists && grant.effectiveStatus === CHANNEL_GATE.REENTRY_GRANT_STATUS.REENTRY_AUTHORIZED)) {
      channelGateAckBlockedCallback_(envelope);
      channelGateSendLockedExplanation_(envelope.chatId, envelope.userId, eligibilityConfig);
      channelGateLog_('CHANNEL_GATE_BLOCKED_LOCKED', { generation: eligibility.generation });
      return false;
    }
  }

  return channelGateApplyMembershipGate_(envelope, verifyCallback);
}


// -----------------------------------------------------------------------------
// OT02 — Telegram owner authority and transient re-entry request subsystem.
// Request records are access/governance state only and intentionally contain no
// reversible Telegram target ID or research content.
// -----------------------------------------------------------------------------

function channelGateOwnerConfig_() {
  let raw = '';
  try {
    raw = String(PropertiesService.getScriptProperties().getProperty(CHANNEL_GATE.OWNER_TELEGRAM_USER_ID_PROPERTY) || '').trim();
  } catch (error) {
    return { ok: false, configured: false, reason: 'owner_configuration_read_failed' };
  }
  if (!raw) return { ok: false, configured: false, reason: 'owner_not_configured' };
  if (!/^[1-9][0-9]*$/.test(raw)) return { ok: false, configured: true, reason: 'owner_id_noncanonical' };
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > CHANNEL_GATE.OWNER_MAX_USER_ID || String(value) !== raw) {
    return { ok: false, configured: true, reason: 'owner_id_out_of_range_or_noncanonical' };
  }
  return { ok: true, configured: true, userId: raw };
}

function channelGateOwnerCommand_(text) {
  const raw = String(text == null ? '' : text).trim();
  const match = /^(\/owner-status)(?:@[A-Za-z0-9_]+)?(?:\s|$)/i.exec(raw);
  return match ? CHANNEL_GATE.OWNER_STATUS_COMMAND : '';
}

function channelGateParseBase36SafeInteger_(raw, minValue, maxValue) {
  const s = String(raw == null ? '' : raw);
  if (!/^[0-9a-z]+$/.test(s) || (s.length > 1 && s.charAt(0) === '0')) return { ok: false };
  const value = parseInt(s, 36);
  if (!Number.isSafeInteger(value) || value < minValue || value > maxValue || value.toString(36) !== s) return { ok: false };
  return { ok: true, value: value, canonical: String(value) };
}

function channelGateParseOwnerCallback_(callbackData) {
  if (callbackData === null || callbackData === undefined || callbackData === '') {
    return { isOwnerCallback: false, valid: false, reason: '' };
  }
  const raw = String(callbackData);
  if (raw.indexOf(CHANNEL_GATE.OWNER_CALLBACK_VERSION + '|') !== 0) {
    return { isOwnerCallback: false, valid: false, reason: '' };
  }
  if (channelGateUtf8ByteLength_(raw) > CHANNEL_GATE.OWNER_CALLBACK_MAX_BYTES) {
    return { isOwnerCallback: true, valid: false, reason: 'owner_callback_too_long' };
  }
  const parts = raw.split('|');
  if (parts.length !== 6 || parts[0] !== CHANNEL_GATE.OWNER_CALLBACK_VERSION) {
    return { isOwnerCallback: true, valid: false, reason: 'owner_callback_shape_invalid' };
  }
  const action = parts[1];
  if (action !== 'A' && action !== 'D' && action !== 'R') {
    return { isOwnerCallback: true, valid: false, reason: 'owner_callback_action_invalid' };
  }
  const uid = channelGateParseBase36SafeInteger_(parts[2], 1, CHANNEL_GATE.OWNER_MAX_USER_ID);
  if (!uid.ok) return { isOwnerCallback: true, valid: false, reason: 'owner_callback_uid_invalid' };
  const ref = String(parts[3]);
  if (!new RegExp('^[0-9a-f]{' + CHANNEL_GATE.REENTRY_REQUEST_ID_HEX_LENGTH + '}$').test(ref)) {
    return { isOwnerCallback: true, valid: false, reason: 'owner_callback_ref_invalid' };
  }
  const generation = channelGateParseBase36SafeInteger_(parts[4], 1, 999999);
  if (!generation.ok) return { isOwnerCallback: true, valid: false, reason: 'owner_callback_generation_invalid' };
  const tag = String(parts[5]);
  if (!new RegExp('^[0-9a-f]{' + CHANNEL_GATE.OWNER_CALLBACK_TAG_HEX_LENGTH + '}$').test(tag)) {
    return { isOwnerCallback: true, valid: false, reason: 'owner_callback_tag_invalid' };
  }
  const unsigned = [CHANNEL_GATE.OWNER_CALLBACK_VERSION, action, parts[2], ref, parts[4]].join('|');
  return {
    isOwnerCallback: true,
    valid: true,
    action: action,
    targetUserId: uid.canonical,
    ref: ref,
    generation: generation.value,
    tag: tag,
    unsigned: unsigned,
    rawLength: channelGateUtf8ByteLength_(raw)
  };
}

function channelGateBuildOwnerCallback_(action, targetUserId, ref, generation, eligibilityConfig) {
  if (action !== 'A' && action !== 'D' && action !== 'R') throw new Error('CHANNEL_GATE_OWNER_ACTION_INVALID');
  if (!eligibilityConfig || eligibilityConfig.ok !== true) throw new Error('CHANNEL_GATE_OWNER_SIGNING_CONFIG_REQUIRED');
  const uid = Number(targetUserId);
  const gen = Number(generation);
  if (!Number.isSafeInteger(uid) || uid < 1 || uid > CHANNEL_GATE.OWNER_MAX_USER_ID) throw new Error('CHANNEL_GATE_OWNER_TARGET_INVALID');
  if (!Number.isSafeInteger(gen) || gen < 1 || gen > 999999) throw new Error('CHANNEL_GATE_OWNER_GENERATION_INVALID');
  const reference = String(ref || '').toLowerCase();
  if (!new RegExp('^[0-9a-f]{' + CHANNEL_GATE.REENTRY_REQUEST_ID_HEX_LENGTH + '}$').test(reference)) throw new Error('CHANNEL_GATE_OWNER_REFERENCE_INVALID');
  const unsigned = [CHANNEL_GATE.OWNER_CALLBACK_VERSION, action, uid.toString(36), reference, gen.toString(36)].join('|');
  const tag = channelGateHmacSha256Hex_(CHANNEL_GATE.OWNER_CALLBACK_SIGNING_CONTEXT + unsigned, eligibilityConfig.pepper)
    .slice(0, CHANNEL_GATE.OWNER_CALLBACK_TAG_HEX_LENGTH);
  const data = unsigned + '|' + tag;
  if (channelGateUtf8ByteLength_(data) > CHANNEL_GATE.OWNER_CALLBACK_MAX_BYTES) throw new Error('CHANNEL_GATE_OWNER_CALLBACK_TOO_LONG');
  return data;
}

function channelGateVerifyOwnerCallback_(parsed, envelope, ownerConfig, eligibilityConfig) {
  if (!parsed || parsed.valid !== true) return { ok: false, reason: parsed && parsed.reason ? parsed.reason : 'owner_callback_invalid' };
  if (!ownerConfig || ownerConfig.ok !== true || String(envelope.userId) !== String(ownerConfig.userId)) {
    return { ok: false, reason: 'owner_sender_invalid' };
  }
  if (!eligibilityConfig || eligibilityConfig.ok !== true) return { ok: false, reason: 'eligibility_configuration_invalid' };
  const expected = channelGateHmacSha256Hex_(CHANNEL_GATE.OWNER_CALLBACK_SIGNING_CONTEXT + parsed.unsigned, eligibilityConfig.pepper)
    .slice(0, CHANNEL_GATE.OWNER_CALLBACK_TAG_HEX_LENGTH);
  if (!channelGateConstantTimeEqual_(expected, parsed.tag)) return { ok: false, reason: 'owner_callback_signature_invalid' };
  return { ok: true };
}

function channelGateParseRequestCallback_(callbackData) {
  if (callbackData === null || callbackData === undefined || callbackData === '') {
    return { isRequestCallback: false, valid: false, reason: '' };
  }
  const raw = String(callbackData);
  if (raw === CHANNEL_GATE.REENTRY_REQUEST_ACTION) return { isRequestCallback: true, valid: true, reason: '' };
  if (raw.indexOf('PE_REQ|') === 0) return { isRequestCallback: true, valid: false, reason: 'request_callback_invalid' };
  return { isRequestCallback: false, valid: false, reason: '' };
}

function channelGateRequestStorageKeyFromDigest_(identityDigest) {
  const digest = String(identityDigest || '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(digest)) throw new Error('CHANNEL_GATE_REQUEST_IDENTITY_INVALID');
  return CHANNEL_GATE.REENTRY_REQUEST_STORAGE_PREFIX + digest;
}

function channelGateRequestRecordValue_(record) {
  if (!record || typeof record !== 'object') throw new Error('CHANNEL_GATE_REQUEST_RECORD_REQUIRED');
  const status = String(record.status || '');
  if (status !== CHANNEL_GATE.REENTRY_REQUEST_STATUS.PENDING &&
      status !== CHANNEL_GATE.REENTRY_REQUEST_STATUS.DENIED &&
      status !== CHANNEL_GATE.REENTRY_REQUEST_STATUS.APPROVED) throw new Error('CHANNEL_GATE_REQUEST_STATUS_INVALID');
  const requestId = String(record.requestId || '').toLowerCase();
  if (!new RegExp('^[0-9a-f]{' + CHANNEL_GATE.REENTRY_REQUEST_ID_HEX_LENGTH + '}$').test(requestId)) throw new Error('CHANNEL_GATE_REQUEST_ID_INVALID');
  const generation = Number(record.generation);
  const createdAt = Number(record.createdAt);
  const windowExpiresAt = Number(record.requestWindowExpiresAt);
  const notifyAt = Number(record.lastNotificationAttemptAt || 0);
  const attempts = Number(record.notificationAttemptCount || 0);
  if (!Number.isSafeInteger(generation) || generation < 1 || generation > CHANNEL_GATE.REENTRY_REQUEST_MAX_GENERATION) throw new Error('CHANNEL_GATE_REQUEST_GENERATION_INVALID');
  if (!Number.isSafeInteger(createdAt) || createdAt <= 0) throw new Error('CHANNEL_GATE_REQUEST_CREATED_AT_INVALID');
  if (!Number.isSafeInteger(windowExpiresAt) || windowExpiresAt !== createdAt + CHANNEL_GATE.REENTRY_REQUEST_WINDOW_MS) throw new Error('CHANNEL_GATE_REQUEST_WINDOW_INVALID');
  if (!Number.isSafeInteger(notifyAt) || notifyAt < 0 || notifyAt > Date.now() + CHANNEL_GATE.REENTRY_REQUEST_WINDOW_MS * 2) throw new Error('CHANNEL_GATE_REQUEST_NOTIFY_AT_INVALID');
  if (!Number.isSafeInteger(attempts) || attempts < 0) throw new Error('CHANNEL_GATE_REQUEST_ATTEMPTS_INVALID');
  if ((attempts === 0 && notifyAt !== 0) || (attempts > 0 && notifyAt <= 0)) throw new Error('CHANNEL_GATE_REQUEST_ATTEMPT_PAIR_INVALID');
  const out = { v: CHANNEL_GATE.REENTRY_REQUEST_VERSION, s: status, id: requestId, g: generation, iat: createdAt, win: windowExpiresAt, na: notifyAt, attempts: attempts };
  const grantId = record.linkedGrantId == null ? '' : String(record.linkedGrantId).toLowerCase();
  if (status === CHANNEL_GATE.REENTRY_REQUEST_STATUS.APPROVED) {
    if (!new RegExp('^[0-9a-f]{' + CHANNEL_GATE.REENTRY_GRANT_ID_HEX_LENGTH + '}$').test(grantId)) throw new Error('CHANNEL_GATE_REQUEST_LINKED_GRANT_REQUIRED');
    out.grantId = grantId;
  } else if (grantId) {
    throw new Error('CHANNEL_GATE_REQUEST_LINKED_GRANT_NOT_ALLOWED');
  }
  return JSON.stringify(out);
}

function channelGateParseRequestRecord_(rawValue) {
  const raw = rawValue == null ? '' : String(rawValue);
  if (!raw) return { ok: true, exists: false };
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (error) { return { ok: false, exists: true, reason: 'request_json_invalid' }; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, exists: true, reason: 'request_shape_invalid' };
  if (String(parsed.v || '') !== CHANNEL_GATE.REENTRY_REQUEST_VERSION) return { ok: false, exists: true, reason: 'request_version_invalid' };
  try {
    const canonical = channelGateRequestRecordValue_({
      status: parsed.s,
      requestId: parsed.id,
      generation: parsed.g,
      createdAt: parsed.iat,
      requestWindowExpiresAt: parsed.win,
      lastNotificationAttemptAt: parsed.na,
      notificationAttemptCount: parsed.attempts,
      linkedGrantId: parsed.grantId
    });
    if (canonical !== raw) return { ok: false, exists: true, reason: 'request_noncanonical' };
    return {
      ok: true,
      exists: true,
      status: String(parsed.s),
      requestId: String(parsed.id),
      generation: Number(parsed.g),
      createdAt: Number(parsed.iat),
      requestWindowExpiresAt: Number(parsed.win),
      lastNotificationAttemptAt: Number(parsed.na),
      notificationAttemptCount: Number(parsed.attempts),
      linkedGrantId: parsed.grantId ? String(parsed.grantId) : ''
    };
  } catch (error) {
    return { ok: false, exists: true, reason: 'request_field_invalid:' + channelGateSafeError_(error) };
  }
}

function channelGateReadRequestForDigest_(identityDigest) {
  try {
    const key = channelGateRequestStorageKeyFromDigest_(identityDigest);
    return channelGateParseRequestRecord_(PropertiesService.getScriptProperties().getProperty(key));
  } catch (error) {
    return { ok: false, exists: false, reason: 'request_read_failed:' + channelGateSafeError_(error) };
  }
}

function channelGatePersistRequest_(identityDigest, record) {
  try {
    const props = PropertiesService.getScriptProperties();
    const key = channelGateRequestStorageKeyFromDigest_(identityDigest);
    const value = channelGateRequestRecordValue_(record);
    const capacity = channelGateCapacityAllowsWrite_(key, value);
    if (!capacity.ok) return { ok: false, reason: capacity.reason || 'request_capacity_blocked' };
    props.setProperty(key, value);
    const persisted = String(props.getProperty(key) || '');
    if (persisted !== value) return { ok: false, reason: 'request_persistence_mismatch' };
    const parsed = channelGateParseRequestRecord_(persisted);
    if (!parsed.ok || !parsed.exists) return { ok: false, reason: parsed.reason || 'request_verify_failed' };
    return parsed;
  } catch (error) {
    channelGateLog_('CHANNEL_GATE_REENTRY_REQUEST_PERSISTENCE_EXCEPTION', { message: channelGateSafeError_(error) });
    return { ok: false, reason: 'request_persistence_exception' };
  }
}

function channelGateDeleteRequestForDigest_(identityDigest) {
  try {
    const props = PropertiesService.getScriptProperties();
    const key = channelGateRequestStorageKeyFromDigest_(identityDigest);
    props.deleteProperty(key);
    return String(props.getProperty(key) || '') === '';
  } catch (error) {
    channelGateLog_('CHANNEL_GATE_REENTRY_REQUEST_DELETE_EXCEPTION', { message: channelGateSafeError_(error) });
    return false;
  }
}

function channelGateGenerateRequestId_(identityDigest) {
  if (typeof Utilities === 'undefined' || typeof Utilities.getUuid !== 'function') throw new Error('CHANNEL_GATE_UUID_UNAVAILABLE');
  const frame = CHANNEL_GATE.REENTRY_REQUEST_ID_CONTEXT + String(Utilities.getUuid()) + '|' + String(Utilities.getUuid()) + '|' + String(Date.now()) + '|' + String(identityDigest).toLowerCase();
  const requestId = channelGateSha256Hex_(frame).slice(0, CHANNEL_GATE.REENTRY_REQUEST_ID_HEX_LENGTH).toLowerCase();
  if (!new RegExp('^[0-9a-f]{' + CHANNEL_GATE.REENTRY_REQUEST_ID_HEX_LENGTH + '}$').test(requestId)) throw new Error('CHANNEL_GATE_REQUEST_ID_GENERATION_FAILED');
  return requestId;
}

function channelGateRequestHumanRef_(identityDigest, requestId) {
  const digest = String(identityDigest || '').toLowerCase();
  const id = String(requestId || '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(digest) || !new RegExp('^[0-9a-f]{' + CHANNEL_GATE.REENTRY_REQUEST_ID_HEX_LENGTH + '}$').test(id)) throw new Error('CHANNEL_GATE_REQUEST_REFERENCE_INPUT_INVALID');
  return 'REF-' + channelGateSha256Hex_(CHANNEL_GATE.REENTRY_REQUEST_HUMAN_REF_CONTEXT + digest + '|' + id).slice(0, 12).toUpperCase();
}

function channelGateRequestWindowExpired_(request, now) {
  return !!(request && request.exists && (request.status === CHANNEL_GATE.REENTRY_REQUEST_STATUS.PENDING || request.status === CHANNEL_GATE.REENTRY_REQUEST_STATUS.DENIED) && Number(now) > request.requestWindowExpiresAt);
}

function channelGateGrantBlocksNewRequest_(grant) {
  if (!grant || !grant.exists) return false;
  const status = String(grant.effectiveStatus || '');
  return status === CHANNEL_GATE.REENTRY_GRANT_STATUS.ISSUED ||
    status === CHANNEL_GATE.REENTRY_GRANT_STATUS.MEMBERSHIP_PENDING ||
    status === CHANNEL_GATE.REENTRY_GRANT_STATUS.REENTRY_AUTHORIZED ||
    status === CHANNEL_GATE.REENTRY_GRANT_STATUS.CONSUMING;
}

function channelGateAttemptOwnerRequestNotification_(request, identityDigest, targetUserId, ownerConfig, eligibilityConfig) {
  const now = Date.now();
  if (request.notificationAttemptCount > 0 && now - request.lastNotificationAttemptAt < CHANNEL_GATE.REENTRY_REQUEST_NOTIFY_COOLDOWN_MS) {
    return { ok: true, attempted: false, request: request, sendOk: null };
  }
  const next = {
    status: request.status,
    requestId: request.requestId,
    generation: request.generation,
    createdAt: request.createdAt,
    requestWindowExpiresAt: request.requestWindowExpiresAt,
    lastNotificationAttemptAt: now,
    notificationAttemptCount: request.notificationAttemptCount + 1
  };
  const persisted = channelGatePersistRequest_(identityDigest, next);
  if (!persisted.ok) return { ok: false, reason: persisted.reason || 'notification_attempt_persistence_failed' };
  const ref = channelGateRequestHumanRef_(identityDigest, persisted.requestId);
  const approve = channelGateBuildOwnerCallback_('A', targetUserId, persisted.requestId, persisted.generation, eligibilityConfig);
  const deny = channelGateBuildOwnerCallback_('D', targetUserId, persisted.requestId, persisted.generation, eligibilityConfig);
  const text = 'Re-entry request\nReference: ' + ref + '\nParticipation generation: ' + persisted.generation;
  const sendOk = channelGateSendText_(text, ownerConfig.userId, [[
    { text: 'Approve', callback_data: approve },
    { text: 'Deny', callback_data: deny }
  ]]);
  return { ok: true, attempted: true, request: persisted, sendOk: sendOk === true };
}

function channelGateHandleParticipantReentryRequest_(envelope, lock, eligibilityConfig, eligibility, grant) {
  if (!channelGateAssertHeldLock_(lock, 'participant_reentry_request')) return false;
  const ownerConfig = channelGateOwnerConfig_();
  if (!ownerConfig.ok) {
    channelGateSendText_(CHANNEL_GATE.REQUEST_UNAVAILABLE_TEXT, envelope.chatId);
    return false;
  }
  if (!eligibility || !eligibility.exists || eligibility.state !== CHANNEL_GATE.ELIGIBILITY_STATE.LOCKED) {
    channelGateSendText_(CHANNEL_GATE.REQUEST_UNAVAILABLE_TEXT, envelope.chatId);
    return false;
  }
  if (eligibility.generation > CHANNEL_GATE.REENTRY_REQUEST_MAX_GENERATION) {
    channelGateSendText_(CHANNEL_GATE.REQUEST_UNAVAILABLE_TEXT, envelope.chatId);
    return false;
  }
  if (channelGateGrantBlocksNewRequest_(grant)) {
    if (grant.effectiveStatus === CHANNEL_GATE.REENTRY_GRANT_STATUS.CONSUMING) channelGateSendText_(CHANNEL_GATE.REQUEST_RECONCILIATION_TEXT, envelope.chatId);
    else channelGateSendText_(CHANNEL_GATE.REQUEST_ACTIVE_GRANT_TEXT, envelope.chatId);
    return false;
  }
  const readiness = channelGateReentryTargetReady_(envelope.userId);
  if (!readiness.ok) {
    channelGateSendText_(CHANNEL_GATE.REQUEST_NOT_READY_TEXT, envelope.chatId);
    channelGateLog_('CHANNEL_GATE_REENTRY_REQUEST_READINESS_BLOCKED', { reason: readiness.reason, generation: eligibility.generation });
    return false;
  }

  let digest;
  try { digest = channelGateIdentityDigestFromConfig_(envelope.userId, eligibilityConfig); }
  catch (error) {
    channelGateSendTechnicalFailure_(envelope.chatId, null, envelope.userId);
    return false;
  }
  let request = channelGateReadRequestForDigest_(digest);
  if (!request.ok) {
    channelGateSendTechnicalFailure_(envelope.chatId, null, envelope.userId);
    channelGateLog_('CHANNEL_GATE_REENTRY_REQUEST_CORRUPT', { reason: request.reason });
    return false;
  }
  const now = Date.now();
  if (request.exists && channelGateRequestWindowExpired_(request, now)) {
    if (!channelGateDeleteRequestForDigest_(digest)) {
      channelGateSendTechnicalFailure_(envelope.chatId, null, envelope.userId);
      return false;
    }
    request = { ok: true, exists: false };
  }
  if (request.exists && request.generation !== eligibility.generation) {
    if ((request.status === CHANNEL_GATE.REENTRY_REQUEST_STATUS.PENDING ||
         request.status === CHANNEL_GATE.REENTRY_REQUEST_STATUS.DENIED) &&
        request.generation < eligibility.generation) {
      if (!channelGateDeleteRequestForDigest_(digest)) {
        channelGateSendTechnicalFailure_(envelope.chatId, null, envelope.userId);
        return false;
      }
      request = { ok: true, exists: false };
    } else {
      channelGateSendTechnicalFailure_(envelope.chatId, null, envelope.userId);
      channelGateLog_('CHANNEL_GATE_REENTRY_REQUEST_GENERATION_MISMATCH', { generation: eligibility.generation });
      return false;
    }
  }
  if (request.exists && request.status === CHANNEL_GATE.REENTRY_REQUEST_STATUS.APPROVED) {
    const cleanup = channelGateCleanupApprovedRequestWithoutActionableGrant_(digest, request, grant);
    if (!cleanup.ok) {
      channelGateSendTechnicalFailure_(envelope.chatId, null, envelope.userId);
      channelGateLog_('CHANNEL_GATE_REENTRY_APPROVED_REQUEST_RECONCILIATION_BLOCKED', { reason: cleanup.reason });
      return false;
    }
    if (cleanup.reconciliation) {
      channelGateSendText_(CHANNEL_GATE.REQUEST_RECONCILIATION_TEXT, envelope.chatId);
      return false;
    }
    if (cleanup.actionable) {
      channelGateSendText_(CHANNEL_GATE.REQUEST_ACTIVE_GRANT_TEXT, envelope.chatId);
      return false;
    }
    if (cleanup.pruned) request = { ok: true, exists: false };
  }
  if (request.exists && request.status === CHANNEL_GATE.REENTRY_REQUEST_STATUS.DENIED) {
    channelGateSendText_(CHANNEL_GATE.REQUEST_DENIED_TEXT, envelope.chatId);
    return false;
  }
  if (!request.exists) {
    const created = {
      status: CHANNEL_GATE.REENTRY_REQUEST_STATUS.PENDING,
      requestId: channelGateGenerateRequestId_(digest),
      generation: eligibility.generation,
      createdAt: now,
      requestWindowExpiresAt: now + CHANNEL_GATE.REENTRY_REQUEST_WINDOW_MS,
      lastNotificationAttemptAt: 0,
      notificationAttemptCount: 0
    };
    request = channelGatePersistRequest_(digest, created);
    if (!request.ok) {
      channelGateSendTechnicalFailure_(envelope.chatId, null, envelope.userId);
      channelGateLog_('CHANNEL_GATE_REENTRY_REQUEST_CREATE_FAILED', { reason: request.reason });
      return false;
    }
  }

  const notification = channelGateAttemptOwnerRequestNotification_(request, digest, envelope.userId, ownerConfig, eligibilityConfig);
  if (!notification.ok) {
    channelGateSendTechnicalFailure_(envelope.chatId, null, envelope.userId);
    channelGateLog_('CHANNEL_GATE_REENTRY_REQUEST_NOTIFICATION_STATE_FAILED', { reason: notification.reason });
    return false;
  }
  if (!notification.attempted) {
    channelGateSendText_(CHANNEL_GATE.REQUEST_PENDING_TEXT, envelope.chatId);
  } else if (notification.sendOk) {
    channelGateSendText_(CHANNEL_GATE.REQUEST_RECORDED_TEXT, envelope.chatId);
  } else {
    channelGateSendText_(CHANNEL_GATE.REQUEST_NOTIFY_UNCONFIRMED_TEXT, envelope.chatId);
  }
  channelGateLog_('CHANNEL_GATE_REENTRY_REQUEST_STATE', {
    status: notification.request.status,
    generation: notification.request.generation,
    notificationAttemptCount: notification.request.notificationAttemptCount
  });
  return false;
}

function channelGateReadEligibilityForOwnerTarget_(targetUserId, eligibilityConfig) {
  try {
    const key = channelGateEligibilityStorageKeyFromConfig_(targetUserId, eligibilityConfig);
    return channelGateParseEligibilityRecord_(PropertiesService.getScriptProperties().getProperty(key));
  } catch (error) {
    return { ok: false, exists: false, reason: 'owner_target_eligibility_read_failed' };
  }
}

function channelGateValidateOwnerRequestActionState_(parsed, eligibilityConfig) {
  let digest;
  try { digest = channelGateIdentityDigestFromConfig_(parsed.targetUserId, eligibilityConfig); }
  catch (error) { return { ok: false, reason: 'owner_target_identity_failed' }; }
  const eligibility = channelGateReadEligibilityForOwnerTarget_(parsed.targetUserId, eligibilityConfig);
  if (!eligibility.ok || !eligibility.exists || eligibility.state !== CHANNEL_GATE.ELIGIBILITY_STATE.LOCKED) return { ok: false, reason: 'owner_target_not_locked' };
  if (eligibility.generation !== parsed.generation) return { ok: false, reason: 'owner_target_generation_mismatch' };
  const request = channelGateReadRequestForDigest_(digest);
  if (!request.ok || !request.exists) return { ok: false, reason: request.reason || 'owner_request_missing' };
  if (request.requestId !== parsed.ref || request.generation !== parsed.generation) return { ok: false, reason: 'owner_request_reference_mismatch' };
  return { ok: true, digest: digest, eligibility: eligibility, request: request };
}

function channelGateSendOwnerApproval_(chatId, targetUserId, identityDigest, request, grant, eligibilityConfig) {
  if (!request || request.status !== CHANNEL_GATE.REENTRY_REQUEST_STATUS.APPROVED ||
      request.linkedGrantId !== grant.grantId) return { ok: false, reason: 'approved_request_link_required' };
  if (!channelGateV2GrantCorrelatesTelegramRequest_(
        grant,
        identityDigest,
        request.generation + 1,
        CHANNEL_GATE.REENTRY_REASON.APPROVED_REPEAT_PARTICIPATION,
        request.requestId)) {
    return { ok: false, reason: 'approved_grant_correlation_failed' };
  }
  if (!channelGateV2GrantActionable_(grant)) return { ok: false, reason: 'approved_grant_not_actionable' };
  const recovered = channelGateRecoverV2Code_(grant, eligibilityConfig);
  if (!recovered.ok) return recovered;
  const ref = channelGateRequestHumanRef_(identityDigest, request.requestId);
  const revoke = channelGateBuildOwnerCallback_('R', targetUserId, grant.grantId, grant.targetGeneration, eligibilityConfig);
  const text = [
    'Re-entry approved.',
    'Reference: ' + ref,
    'Next participation: ' + grant.targetGeneration,
    'Code: ' + recovered.code,
    'Expires: ' + new Date(grant.expiresAt).toISOString()
  ].join('\n');
  // Telegram Bot API supports InlineKeyboardButton.copy_text as
  // { copy_text: { text: "..." } }. The core sender serializes arbitrary
  // keyboard button objects without filtering.
  const sendOk = channelGateSendText_(text, chatId, [[
    { text: 'Copy code', copy_text: { text: recovered.code } },
    { text: 'Revoke', callback_data: revoke }
  ]]);
  channelGateLog_('CHANNEL_GATE_OWNER_APPROVAL_RESPONSE_ATTEMPT', {
    targetGeneration: grant.targetGeneration,
    grantStatus: grant.effectiveStatus,
    sendConfirmed: sendOk === true
  });
  return { ok: true, sendOk: sendOk === true, code: recovered.code, revokeCallback: revoke };
}

function channelGateHandleOwnerApprove_(envelope, lock, parsed, eligibilityConfig) {
  if (!channelGateAssertHeldLock_(lock, 'owner_approve')) return false;
  const state = channelGateValidateOwnerRequestActionState_(parsed, eligibilityConfig);
  if (!state.ok) {
    channelGateSendText_(CHANNEL_GATE.OWNER_CALLBACK_INVALID_TEXT, envelope.chatId);
    return false;
  }

  const now = Date.now();
  if (state.request.status === CHANNEL_GATE.REENTRY_REQUEST_STATUS.DENIED) {
    channelGateSendText_(CHANNEL_GATE.OWNER_CALLBACK_INVALID_TEXT, envelope.chatId);
    return false;
  }

  if (state.request.status === CHANNEL_GATE.REENTRY_REQUEST_STATUS.PENDING) {
    if (channelGateRequestWindowExpired_(state.request, now)) {
      channelGateDeleteRequestForDigest_(state.digest);
      channelGateSendText_(CHANNEL_GATE.OWNER_CALLBACK_INVALID_TEXT, envelope.chatId);
      return false;
    }

    const readiness = channelGateReentryTargetReady_(parsed.targetUserId);
    if (!readiness.ok) {
      channelGateSendText_(CHANNEL_GATE.OWNER_CALLBACK_INVALID_TEXT, envelope.chatId);
      channelGateLog_('CHANNEL_GATE_OWNER_APPROVE_READINESS_BLOCKED', { reason: readiness.reason, generation: state.request.generation });
      return false;
    }

    const issued = channelGateIssueReentryGrant_(
      parsed.targetUserId,
      CHANNEL_GATE.REENTRY_REASON.APPROVED_REPEAT_PARTICIPATION,
      lock,
      {
        issuanceOrigin: CHANNEL_GATE.REENTRY_ISSUANCE_ORIGIN.TELEGRAM_OWNER,
        requestId: state.request.requestId
      }
    );
    if (!issued.ok) {
      channelGateSendText_(CHANNEL_GATE.OWNER_CALLBACK_INVALID_TEXT, envelope.chatId);
      channelGateLog_('CHANNEL_GATE_OWNER_APPROVE_GRANT_BLOCKED', { reason: issued.reason, generation: state.request.generation });
      return false;
    }

    const approved = channelGatePersistRequest_(state.digest, {
      status: CHANNEL_GATE.REENTRY_REQUEST_STATUS.APPROVED,
      requestId: state.request.requestId,
      generation: state.request.generation,
      createdAt: state.request.createdAt,
      requestWindowExpiresAt: state.request.requestWindowExpiresAt,
      lastNotificationAttemptAt: state.request.lastNotificationAttemptAt,
      notificationAttemptCount: state.request.notificationAttemptCount,
      linkedGrantId: issued.grantId
    });
    if (!approved.ok) {
      channelGateSendText_(CHANNEL_GATE.OWNER_APPROVAL_PARTIAL_TEXT, envelope.chatId);
      channelGateLog_('CHANNEL_GATE_OWNER_APPROVE_REQUEST_FINALIZATION_PENDING', {
        targetGeneration: issued.targetGeneration,
        grantStatus: issued.grant && issued.grant.effectiveStatus ? issued.grant.effectiveStatus : 'ISSUED'
      });
      return false;
    }

    const persistedGrant = channelGateReadReentryGrantForDigest_(state.digest);
    if (!persistedGrant.ok || !persistedGrant.exists) {
      channelGateSendTechnicalFailure_(envelope.chatId, null, envelope.userId);
      return false;
    }
    const response = channelGateSendOwnerApproval_(
      envelope.chatId, parsed.targetUserId, state.digest, approved, persistedGrant, eligibilityConfig
    );
    if (!response.ok) channelGateSendTechnicalFailure_(envelope.chatId, null, envelope.userId);
    return false;
  }

  if (state.request.status !== CHANNEL_GATE.REENTRY_REQUEST_STATUS.APPROVED) {
    channelGateSendText_(CHANNEL_GATE.OWNER_CALLBACK_INVALID_TEXT, envelope.chatId);
    return false;
  }

  const grant = channelGateReadReentryGrantForDigest_(state.digest);
  if (!grant.ok || !grant.exists) {
    channelGateSendText_(CHANNEL_GATE.OWNER_CALLBACK_INVALID_TEXT, envelope.chatId);
    return false;
  }
  if (state.request.linkedGrantId !== grant.grantId ||
      !channelGateV2GrantCorrelatesTelegramRequest_(
        grant,
        state.digest,
        state.request.generation + 1,
        CHANNEL_GATE.REENTRY_REASON.APPROVED_REPEAT_PARTICIPATION,
        state.request.requestId)) {
    channelGateSendText_(CHANNEL_GATE.OWNER_CALLBACK_INVALID_TEXT, envelope.chatId);
    return false;
  }
  if (grant.effectiveStatus === CHANNEL_GATE.REENTRY_GRANT_STATUS.CONSUMING) {
    channelGateSendText_(CHANNEL_GATE.OWNER_REVOKE_RECONCILIATION_TEXT, envelope.chatId);
    return false;
  }
  if (channelGateGrantTerminalForRequestCleanup_(grant)) {
    channelGateCleanupTerminalRequestForGrant_(grant);
    channelGateSendText_(CHANNEL_GATE.OWNER_CALLBACK_INVALID_TEXT, envelope.chatId);
    return false;
  }
  const response = channelGateSendOwnerApproval_(
    envelope.chatId, parsed.targetUserId, state.digest, state.request, grant, eligibilityConfig
  );
  if (!response.ok) channelGateSendTechnicalFailure_(envelope.chatId, null, envelope.userId);
  return false;
}

function channelGateHandleOwnerDeny_(envelope, parsed, eligibilityConfig) {
  const state = channelGateValidateOwnerRequestActionState_(parsed, eligibilityConfig);
  if (!state.ok) {
    channelGateSendText_(CHANNEL_GATE.OWNER_CALLBACK_INVALID_TEXT, envelope.chatId);
    return false;
  }
  if (state.request.status === CHANNEL_GATE.REENTRY_REQUEST_STATUS.DENIED && !channelGateRequestWindowExpired_(state.request, Date.now())) {
    const ref = channelGateRequestHumanRef_(state.digest, state.request.requestId);
    channelGateSendText_('Re-entry request already denied.\nReference: ' + ref + '\nParticipation generation: ' + state.request.generation, envelope.chatId);
    return false;
  }
  if (state.request.status !== CHANNEL_GATE.REENTRY_REQUEST_STATUS.PENDING || channelGateRequestWindowExpired_(state.request, Date.now())) {
    channelGateSendText_(CHANNEL_GATE.OWNER_CALLBACK_INVALID_TEXT, envelope.chatId);
    return false;
  }
  const grant = channelGateReadReentryGrantForDigest_(state.digest);
  if (!grant.ok || channelGateGrantBlocksNewRequest_(grant)) {
    channelGateSendText_(CHANNEL_GATE.OWNER_CALLBACK_INVALID_TEXT, envelope.chatId);
    return false;
  }
  const denied = channelGatePersistRequest_(state.digest, {
    status: CHANNEL_GATE.REENTRY_REQUEST_STATUS.DENIED,
    requestId: state.request.requestId,
    generation: state.request.generation,
    createdAt: state.request.createdAt,
    requestWindowExpiresAt: state.request.requestWindowExpiresAt,
    lastNotificationAttemptAt: state.request.lastNotificationAttemptAt,
    notificationAttemptCount: state.request.notificationAttemptCount
  });
  if (!denied.ok) {
    channelGateSendTechnicalFailure_(envelope.chatId, null, envelope.userId);
    return false;
  }
  const ref = channelGateRequestHumanRef_(state.digest, denied.requestId);
  channelGateSendText_('Re-entry request denied.\nReference: ' + ref + '\nParticipation generation: ' + denied.generation, envelope.chatId);
  channelGateLog_('CHANNEL_GATE_OWNER_DENY', { generation: denied.generation, status: denied.status });
  return false;
}

function channelGateHandleOwnerRevoke_(envelope, lock, parsed, eligibilityConfig) {
  if (!channelGateAssertHeldLock_(lock, 'owner_revoke')) return false;
  let digest;
  try { digest = channelGateIdentityDigestFromConfig_(parsed.targetUserId, eligibilityConfig); }
  catch (error) {
    channelGateSendText_(CHANNEL_GATE.OWNER_CALLBACK_INVALID_TEXT, envelope.chatId);
    return false;
  }
  const grant = channelGateReadReentryGrantForDigest_(digest);
  if (!grant.ok || !grant.exists ||
      grant.codeVersion !== CHANNEL_GATE.REENTRY_CODE_VERSION_V2 ||
      grant.issuanceOrigin !== CHANNEL_GATE.REENTRY_ISSUANCE_ORIGIN.TELEGRAM_OWNER ||
      grant.identityDigest !== digest ||
      grant.grantId !== parsed.ref ||
      grant.targetGeneration !== parsed.generation) {
    channelGateSendText_(CHANNEL_GATE.OWNER_CALLBACK_INVALID_TEXT, envelope.chatId);
    return false;
  }

  const request = channelGateReadRequestForDigest_(digest);
  if (!request.ok) {
    channelGateSendTechnicalFailure_(envelope.chatId, null, envelope.userId);
    return false;
  }
  if (request.exists) {
    if (request.requestId !== grant.requestId) {
      channelGateSendText_(CHANNEL_GATE.OWNER_CALLBACK_INVALID_TEXT, envelope.chatId);
      return false;
    }
    if (request.status === CHANNEL_GATE.REENTRY_REQUEST_STATUS.APPROVED &&
        request.linkedGrantId !== grant.grantId) {
      channelGateSendText_(CHANNEL_GATE.OWNER_CALLBACK_INVALID_TEXT, envelope.chatId);
      return false;
    }
  }

  if (grant.effectiveStatus === CHANNEL_GATE.REENTRY_GRANT_STATUS.CONSUMING) {
    channelGateSendText_(CHANNEL_GATE.OWNER_REVOKE_RECONCILIATION_TEXT, envelope.chatId);
    return false;
  }
  if (grant.effectiveStatus === CHANNEL_GATE.REENTRY_GRANT_STATUS.CONSUMED) {
    channelGateCleanupTerminalRequestForGrant_(grant);
    channelGateSendText_(CHANNEL_GATE.OWNER_CONSUMED_TEXT, envelope.chatId);
    return false;
  }
  if (grant.effectiveStatus === 'EXPIRED') {
    channelGateCleanupTerminalRequestForGrant_(grant);
    channelGateSendText_(CHANNEL_GATE.OWNER_EXPIRED_TEXT, envelope.chatId);
    return false;
  }
  if (grant.effectiveStatus === CHANNEL_GATE.REENTRY_GRANT_STATUS.REVOKED) {
    const cleanup = channelGateCleanupTerminalRequestForGrant_(grant);
    channelGateSendText_(cleanup.ok ? CHANNEL_GATE.OWNER_ALREADY_REVOKED_TEXT : CHANNEL_GATE.OWNER_CALLBACK_INVALID_TEXT, envelope.chatId);
    return false;
  }
  if (!channelGateV2GrantActionable_(grant) ||
      !request.exists ||
      request.status !== CHANNEL_GATE.REENTRY_REQUEST_STATUS.APPROVED ||
      request.linkedGrantId !== grant.grantId) {
    channelGateSendText_(CHANNEL_GATE.OWNER_CALLBACK_INVALID_TEXT, envelope.chatId);
    return false;
  }

  const eligibility = channelGateReadEligibilityForOwnerTarget_(parsed.targetUserId, eligibilityConfig);
  if (!eligibility.ok || !eligibility.exists ||
      eligibility.state !== CHANNEL_GATE.ELIGIBILITY_STATE.LOCKED ||
      eligibility.generation + 1 !== grant.targetGeneration) {
    channelGateSendText_(CHANNEL_GATE.OWNER_CALLBACK_INVALID_TEXT, envelope.chatId);
    return false;
  }

  const revoked = channelGateRevokeReentryGrant_(parsed.targetUserId, lock);
  if (!revoked.ok) {
    if (revoked.reason === 'consumption_reconciliation_required') {
      channelGateSendText_(CHANNEL_GATE.OWNER_REVOKE_RECONCILIATION_TEXT, envelope.chatId);
    } else if (revoked.reason === 'already_consumed') {
      channelGateSendText_(CHANNEL_GATE.OWNER_CONSUMED_TEXT, envelope.chatId);
    } else {
      channelGateSendText_(CHANNEL_GATE.OWNER_CALLBACK_INVALID_TEXT, envelope.chatId);
    }
    return false;
  }

  const terminalGrant = revoked.grant || grant;
  const cleanup = channelGateCleanupTerminalRequestForGrant_(terminalGrant);
  channelGateSendText_(
    revoked.idempotent ? CHANNEL_GATE.OWNER_ALREADY_REVOKED_TEXT : CHANNEL_GATE.OWNER_REVOKED_TEXT,
    envelope.chatId
  );
  channelGateLog_('CHANNEL_GATE_OWNER_REVOKE', {
    targetGeneration: terminalGrant.targetGeneration,
    status: terminalGrant.effectiveStatus || terminalGrant.status,
    requestCleanupConfirmed: cleanup.ok === true
  });
  return false;
}

function channelGateOwnerStatusSnapshot_(eligibilityConfig) {
  try {
    const all = PropertiesService.getScriptProperties().getProperties();
    let pendingRequests = 0;
    let actionableGrants = 0;
    const now = Date.now();
    Object.keys(all).forEach(function(key) {
      const k = String(key);
      if (k.indexOf(CHANNEL_GATE.REENTRY_REQUEST_STORAGE_PREFIX) === 0) {
        const request = channelGateParseRequestRecord_(all[key]);
        if (request.ok && request.exists && request.status === CHANNEL_GATE.REENTRY_REQUEST_STATUS.PENDING && !channelGateRequestWindowExpired_(request, now)) pendingRequests++;
      } else if (k.indexOf(CHANNEL_GATE.REENTRY_GRANT_STORAGE_PREFIX) === 0) {
        const digest = k.slice(CHANNEL_GATE.REENTRY_GRANT_STORAGE_PREFIX.length);
        const grant = channelGateParseGrantRecord_(all[key], digest);
        if (grant.ok && grant.exists && (grant.effectiveStatus === CHANNEL_GATE.REENTRY_GRANT_STATUS.ISSUED || grant.effectiveStatus === CHANNEL_GATE.REENTRY_GRANT_STATUS.MEMBERSHIP_PENDING || grant.effectiveStatus === CHANNEL_GATE.REENTRY_GRANT_STATUS.REENTRY_AUTHORIZED)) actionableGrants++;
      }
    });
    const capacity = channelGatePropertyStoreCapacitySnapshot_();
    return {
      ok: true,
      eligibilityStatus: eligibilityConfig && eligibilityConfig.ok ? 'VALID_V' + eligibilityConfig.keyVersion : 'INVALID',
      pendingRequests: pendingRequests,
      actionableGrants: actionableGrants,
      capacityStatus: capacity.ok ? capacity.status : 'UNAVAILABLE'
    };
  } catch (error) {
    return { ok: false, reason: 'owner_status_snapshot_failed' };
  }
}

function channelGateSendOwnerStatus_(chatId, eligibilityConfig) {
  const snapshot = channelGateOwnerStatusSnapshot_(eligibilityConfig);
  if (!snapshot.ok) return channelGateSendText_('Owner status is temporarily unavailable.', chatId);
  const text = [
    'Owner control: ACTIVE',
    'ChannelGate version: ' + CHANNEL_GATE.VERSION,
    'Eligibility key: ' + snapshot.eligibilityStatus,
    'Property capacity: ' + snapshot.capacityStatus,
    'Pending requests: ' + snapshot.pendingRequests,
    'Actionable grants: ' + snapshot.actionableGrants
  ].join('\n');
  return channelGateSendText_(text, chatId);
}

function channelGateHandleExplicitOwnerControl_(envelope, lock, ownerCommand, ownerCallback) {
  if (!channelGateAssertHeldLock_(lock, 'owner_control')) return false;
  const ownerConfig = channelGateOwnerConfig_();
  if (!ownerConfig.ok || String(envelope.userId) !== String(ownerConfig.userId)) {
    channelGateSendText_(CHANNEL_GATE.OWNER_UNAVAILABLE_TEXT, envelope.chatId);
    channelGateLog_('CHANNEL_GATE_OWNER_CONTROL_REJECTED', { reason: 'owner_sender_unavailable' });
    return false;
  }
  const eligibilityConfig = channelGateEligibilityConfig_();
  if (ownerCommand === CHANNEL_GATE.OWNER_STATUS_COMMAND) {
    channelGateSendOwnerStatus_(envelope.chatId, eligibilityConfig);
    return false;
  }
  if (!ownerCallback || !ownerCallback.valid) {
    channelGateSendText_(CHANNEL_GATE.OWNER_CALLBACK_INVALID_TEXT, envelope.chatId);
    return false;
  }
  const verified = channelGateVerifyOwnerCallback_(ownerCallback, envelope, ownerConfig, eligibilityConfig);
  if (!verified.ok) {
    channelGateSendText_(CHANNEL_GATE.OWNER_CALLBACK_INVALID_TEXT, envelope.chatId);
    channelGateLog_('CHANNEL_GATE_OWNER_CALLBACK_REJECTED', { reason: verified.reason });
    return false;
  }
  if (ownerCallback.action === 'A') return channelGateHandleOwnerApprove_(envelope, lock, ownerCallback, eligibilityConfig);
  if (ownerCallback.action === 'D') return channelGateHandleOwnerDeny_(envelope, ownerCallback, eligibilityConfig);
  if (ownerCallback.action === 'R') return channelGateHandleOwnerRevoke_(envelope, lock, ownerCallback, eligibilityConfig);
  channelGateSendText_(CHANNEL_GATE.OWNER_CALLBACK_INVALID_TEXT, envelope.chatId);
  return false;
}

function pruneExpiredReentryRequestsOnce_() {
  return channelGateWithOperatorScriptLock_(function(lock) {
    if (!channelGateAssertHeldLock_(lock, 'prune_reentry_requests')) throw new Error('CHANNEL_GATE_LOCK_REQUIRED');
    const props = PropertiesService.getScriptProperties();
    const all = props.getProperties();
    const now = Date.now();
    let scanned = 0;
    let pruned = 0;
    let retained = 0;
    let corrupt = 0;
    Object.keys(all).forEach(function(key) {
      if (String(key).indexOf(CHANNEL_GATE.REENTRY_REQUEST_STORAGE_PREFIX) !== 0) return;
      scanned++;
      const request = channelGateParseRequestRecord_(all[key]);
      if (!request.ok || !request.exists) { corrupt++; return; }
      if (channelGateRequestWindowExpired_(request, now)) {
        props.deleteProperty(key);
        if (String(props.getProperty(key) || '') === '') pruned++;
        else retained++;
        return;
      }
      if (request.status === CHANNEL_GATE.REENTRY_REQUEST_STATUS.APPROVED) {
        const digest = String(key).slice(CHANNEL_GATE.REENTRY_REQUEST_STORAGE_PREFIX.length).toLowerCase();
        const grant = channelGateReadReentryGrantForDigest_(digest);
        if (!grant.ok) { corrupt++; retained++; return; }
        if (!grant.exists) {
          props.deleteProperty(key);
          if (String(props.getProperty(key) || '') === '') pruned++;
          else retained++;
          return;
        }
        if (grant.grantId !== request.linkedGrantId ||
            grant.codeVersion !== CHANNEL_GATE.REENTRY_CODE_VERSION_V2 ||
            grant.issuanceOrigin !== CHANNEL_GATE.REENTRY_ISSUANCE_ORIGIN.TELEGRAM_OWNER ||
            grant.requestId !== request.requestId) {
          corrupt++; retained++; return;
        }
        if (channelGateGrantTerminalForRequestCleanup_(grant)) {
          props.deleteProperty(key);
          if (String(props.getProperty(key) || '') === '') pruned++;
          else retained++;
          return;
        }
      }
      retained++;
    });
    return { ok: true, scanned: scanned, pruned: pruned, retained: retained, corrupt: corrupt };
  });
}

function channelGateApplyMembershipGate_(envelope, verifyCallback) {
  const channel = channelGateReadRequiredChannel_();
  if (!channel.ok) {
    channelGateAckBlockedCallback_(envelope);
    channelGateSendTechnicalFailure_(envelope.chatId, null, envelope.userId);
    channelGateLog_('CHANNEL_GATE_CONFIGURATION_INVALID', { reason: channel.reason });
    return false;
  }

  const membershipKey = channelGateStorageKey_(channel.identity, envelope.userId);
  let storedMembership;
  try {
    storedMembership = String(PropertiesService.getScriptProperties().getProperty(membershipKey) || '');
  } catch (error) {
    channelGateAckBlockedCallback_(envelope);
    channelGateSendTechnicalFailure_(envelope.chatId, channel, envelope.userId);
    channelGateLog_('CHANNEL_GATE_STORAGE_UNAVAILABLE', { message: channelGateSafeError_(error) });
    return false;
  }

  if (storedMembership) {
    if (storedMembership !== CHANNEL_GATE.MEMBERSHIP_VERIFIED_VALUE) {
      channelGateAckBlockedCallback_(envelope);
      channelGateSendTechnicalFailure_(envelope.chatId, channel, envelope.userId);
      channelGateLog_('CHANNEL_GATE_STORAGE_CORRUPT', { channel: channel.identity });
      return false;
    }
    if (verifyCallback.valid) {
      channelGateAckBlockedCallback_(envelope);
      return false;
    }
    return true;
  }

  const membership = channelGateFetchMembership_(channel.identity, envelope.userId);
  if (membership.kind === 'member') {
    if (!channelGatePersistVerification_(membershipKey)) {
      channelGateAckBlockedCallback_(envelope);
      channelGateSendTechnicalFailure_(envelope.chatId, channel, envelope.userId);
      channelGateLog_('CHANNEL_GATE_PERSISTENCE_FAILED', { channel: channel.identity });
      return false;
    }

    channelGateLog_('CHANNEL_GATE_VERIFIED', { channel: channel.identity, status: membership.status });
    if (verifyCallback.valid) {
      channelGateAckBlockedCallback_(envelope);
      channelGateConvertVerifyCallbackToStart_(envelope);
    }
    return true;
  }

  channelGateAckBlockedCallback_(envelope);
  if (membership.kind === 'nonmember') {
    channelGateSendJoinPrompt_(envelope.chatId, envelope.userId, channel);
    channelGateLog_('CHANNEL_GATE_BLOCKED_NONMEMBER', { channel: channel.identity, status: membership.status });
    return false;
  }

  channelGateSendTechnicalFailure_(envelope.chatId, channel, envelope.userId);
  channelGateLog_('CHANNEL_GATE_VERIFICATION_FAILED', {
    channel: channel.identity,
    reason: membership.reason || 'unknown'
  });
  return false;
}

function channelGateHandleUnlockCommand_(envelope, lock, eligibilityConfig, eligibility, unlock) {
  if (!unlock.valid) {
    if (eligibility.exists && eligibility.state === CHANNEL_GATE.ELIGIBILITY_STATE.LOCKED) {
      channelGateSendLockedExplanation_(envelope.chatId, envelope.userId, eligibilityConfig);
    } else {
      channelGateSendText_('Use /start for normal Signal Calibration access.', envelope.chatId);
    }
    return false;
  }

  if (!eligibility.exists) {
    channelGateSendText_('This Telegram account has no prior participation lock. Use /start for normal access.', envelope.chatId);
    return false;
  }
  if (eligibility.state === CHANNEL_GATE.ELIGIBILITY_STATE.RETIRING) {
    channelGateSendText_(CHANNEL_GATE.RETIRING_TEXT, envelope.chatId);
    return false;
  }
  if (eligibility.state === CHANNEL_GATE.ELIGIBILITY_STATE.ENROLLED) {
    channelGateSendText_('This Telegram account already has an enrolled participation. A re-entry code can be used only after the prior participant/research record has been successfully retired and deleted.', envelope.chatId);
    return false;
  }
  if (eligibility.state !== CHANNEL_GATE.ELIGIBILITY_STATE.LOCKED) {
    channelGateSendTechnicalFailure_(envelope.chatId, null, envelope.userId);
    return false;
  }

  const grant = channelGateReadReentryGrantForUser_(envelope.userId, eligibilityConfig);
  if (!grant.ok) {
    channelGateSendTechnicalFailure_(envelope.chatId, null, envelope.userId);
    channelGateLog_('CHANNEL_GATE_REENTRY_GRANT_READ_FAILED', { reason: grant.reason });
    return false;
  }
  if (grant.exists && grant.effectiveStatus === CHANNEL_GATE.REENTRY_GRANT_STATUS.REENTRY_AUTHORIZED) {
    channelGateSendText_(CHANNEL_GATE.REENTRY_ALREADY_ACTIVE_TEXT, envelope.chatId);
    return false;
  }
  if (!grant.exists ||
      (grant.effectiveStatus !== CHANNEL_GATE.REENTRY_GRANT_STATUS.ISSUED &&
       grant.effectiveStatus !== CHANNEL_GATE.REENTRY_GRANT_STATUS.MEMBERSHIP_PENDING) ||
      grant.targetGeneration !== eligibility.generation + 1 ||
      !channelGateVerifyReentryCode_(unlock.code, grant, eligibilityConfig)) {
    channelGateSendText_(CHANNEL_GATE.REENTRY_INVALID_TEXT, envelope.chatId);
    channelGateLog_('CHANNEL_GATE_REENTRY_CODE_REJECTED', {
      generation: eligibility.generation,
      grantStatus: grant.exists ? grant.effectiveStatus : 'ABSENT'
    });
    return false;
  }

  let pending = grant;
  if (grant.effectiveStatus === CHANNEL_GATE.REENTRY_GRANT_STATUS.ISSUED) {
    pending = channelGatePersistReentryGrantStatus_(grant, CHANNEL_GATE.REENTRY_GRANT_STATUS.MEMBERSHIP_PENDING);
    if (!pending.ok) {
      channelGateSendTechnicalFailure_(envelope.chatId, null, envelope.userId);
      return false;
    }
  }
  return channelGateCompletePendingReentryMembership_(envelope, lock, eligibilityConfig, eligibility, pending);
}

function channelGateCompletePendingReentryMembership_(envelope, lock, eligibilityConfig, eligibility, grant) {
  if (!channelGateAssertHeldLock_(lock, 'complete_reentry_membership')) return false;
  const freshGrant = channelGateReadReentryGrantForUser_(envelope.userId, eligibilityConfig);
  if (!freshGrant.ok || !freshGrant.exists ||
      freshGrant.effectiveStatus !== CHANNEL_GATE.REENTRY_GRANT_STATUS.MEMBERSHIP_PENDING ||
      freshGrant.targetGeneration !== eligibility.generation + 1) {
    channelGateSendText_(CHANNEL_GATE.REENTRY_INVALID_TEXT, envelope.chatId);
    return false;
  }

  const channel = channelGateReadRequiredChannel_();
  if (!channel.ok) {
    channelGateSendTechnicalFailure_(envelope.chatId, null, envelope.userId);
    return false;
  }

  // Force a fresh current-channel authority check. Do not trust any old
  // membership cache when activating a repeat-participation grant.
  const membership = channelGateFetchMembership_(channel.identity, envelope.userId);
  if (membership.kind === 'nonmember') {
    channelGateSendJoinPrompt_(envelope.chatId, envelope.userId, channel);
    channelGateLog_('CHANNEL_GATE_REENTRY_BLOCKED_NONMEMBER', {
      grantId: freshGrant.grantId,
      targetGeneration: freshGrant.targetGeneration,
      status: membership.status
    });
    return false;
  }
  if (membership.kind !== 'member') {
    channelGateSendTechnicalFailure_(envelope.chatId, channel, envelope.userId);
    channelGateLog_('CHANNEL_GATE_REENTRY_MEMBERSHIP_TECHNICAL_FAILURE', {
      grantId: freshGrant.grantId,
      targetGeneration: freshGrant.targetGeneration,
      reason: membership.reason || 'unknown'
    });
    return false;
  }

  const membershipKey = channelGateStorageKey_(channel.identity, envelope.userId);
  if (!channelGatePersistVerification_(membershipKey)) {
    channelGateSendTechnicalFailure_(envelope.chatId, channel, envelope.userId);
    return false;
  }

  const authorized = channelGatePersistReentryGrantStatus_(freshGrant, CHANNEL_GATE.REENTRY_GRANT_STATUS.REENTRY_AUTHORIZED);
  if (!authorized.ok) {
    channelGateSendTechnicalFailure_(envelope.chatId, channel, envelope.userId);
    return false;
  }

  channelGateLog_('CHANNEL_GATE_REENTRY_AUTHORIZED', {
    grantId: authorized.grantId,
    targetGeneration: authorized.targetGeneration
  });
  channelGateConvertVerifyCallbackToStart_(envelope);
  return true;
}

function channelGateValidateEnvelope_(envelope) {
  if (!envelope || typeof envelope !== 'object') return { ok: false, reason: 'missing_envelope' };
  if (String(envelope.chatType || '') !== 'private') return { ok: false, reason: 'private_chat_required' };
  if (!channelGatePositiveIntegerLike_(envelope.userId)) return { ok: false, reason: 'invalid_user_id' };
  if (!channelGateIntegerLike_(envelope.chatId)) return { ok: false, reason: 'invalid_chat_id' };
  return { ok: true };
}

function channelGatePositiveIntegerLike_(value) {
  const s = String(value === undefined || value === null ? '' : value);
  return /^[1-9][0-9]*$/.test(s);
}

function channelGateIntegerLike_(value) {
  const s = String(value === undefined || value === null ? '' : value);
  return /^-?[1-9][0-9]*$/.test(s);
}

function channelGateHasHeldLock_(lock) {
  if (!lock || typeof lock.hasLock !== 'function') return false;
  try { return lock.hasLock() === true; }
  catch (error) { return false; }
}

function channelGateAssertHeldLock_(lock, operationName) {
  if (channelGateHasHeldLock_(lock)) return true;
  channelGateLog_('CHANNEL_GATE_LOCK_REQUIRED', { operation: String(operationName || '') });
  return false;
}

/**
 * Syntax-level validation for public Telegram usernames.
 */
function channelGateNormalizeChannel_(rawValue) {
  const raw = String(rawValue || '').trim();
  if (!raw) return { ok: false, reason: 'required_channel_missing' };
  if (raw.charAt(0) !== '@') return { ok: false, reason: 'required_channel_must_start_at' };
  const username = raw.slice(1);
  if (!/^[A-Za-z0-9_]{1,32}$/.test(username)) return { ok: false, reason: 'required_channel_malformed' };
  const canonicalUsername = username.toLowerCase();
  return {
    ok: true,
    identity: '@' + canonicalUsername,
    username: canonicalUsername,
    joinUrl: 'https://t.me/' + encodeURIComponent(canonicalUsername)
  };
}

function channelGateReadRequiredChannel_() {
  try {
    const raw = PropertiesService.getScriptProperties().getProperty(CHANNEL_GATE.REQUIRED_CHANNEL_PROPERTY);
    return channelGateNormalizeChannel_(raw);
  } catch (error) {
    return { ok: false, reason: 'required_channel_read_failed' };
  }
}

/**
 * Membership-cache key only. This deliberately preserves the original V1
 * channel-scoped construction and prefix for deployed cache compatibility.
 */
function channelGateStorageKey_(channelIdentity, userId) {
  const seed = 'channel-gate-v1|' + String(channelIdentity).toLowerCase() + '|' + String(userId);
  return CHANNEL_GATE.MEMBERSHIP_STORAGE_PREFIX +
    channelGateSha256Hex_(seed).slice(0, CHANNEL_GATE.MEMBERSHIP_KEY_HASH_HEX_LENGTH);
}

function channelGateSha256Hex_(value) {
  if (typeof Utilities !== 'undefined' && Utilities.computeDigest && Utilities.DigestAlgorithm) {
    const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value));
    return channelGateBytesToHex_(bytes);
  }
  throw new Error('CHANNEL_GATE_DIGEST_UNAVAILABLE');
}

function channelGateHmacSha256Hex_(value, key) {
  if (typeof Utilities !== 'undefined' && Utilities.computeHmacSha256Signature) {
    const bytes = Utilities.computeHmacSha256Signature(String(value), String(key));
    return channelGateBytesToHex_(bytes);
  }
  throw new Error('CHANNEL_GATE_HMAC_UNAVAILABLE');
}

function channelGateBytesToHex_(bytes) {
  return bytes.map(function(b) {
    const n = b < 0 ? b + 256 : b;
    return n.toString(16).padStart(2, '0');
  }).join('');
}

function channelGateEligibilityConfig_() {
  let props;
  let pepper;
  let keyVersion;
  try {
    props = PropertiesService.getScriptProperties();
    pepper = String(props.getProperty(CHANNEL_GATE.ELIGIBILITY_IDENTITY_PEPPER_PROPERTY) || '');
    keyVersion = String(props.getProperty(CHANNEL_GATE.ELIGIBILITY_IDENTITY_KEY_VERSION_PROPERTY) || '');
  } catch (error) {
    return { ok: false, reason: 'identity_configuration_read_failed' };
  }

  if (pepper.length < CHANNEL_GATE.ELIGIBILITY_MIN_PEPPER_LENGTH ||
      pepper.length > CHANNEL_GATE.ELIGIBILITY_MAX_PEPPER_LENGTH) {
    return { ok: false, reason: 'identity_pepper_missing_or_invalid' };
  }
  if (keyVersion !== CHANNEL_GATE.ELIGIBILITY_IDENTITY_KEY_VERSION) {
    return { ok: false, reason: 'identity_key_version_missing_or_unexpected' };
  }
  return { ok: true, pepper: pepper, keyVersion: keyVersion };
}

function channelGateEligibilityStorageKeyFromConfig_(userId, config) {
  if (!channelGatePositiveIntegerLike_(userId)) throw new Error('CHANNEL_GATE_INVALID_USER_ID');
  if (!config || config.ok !== true || !config.pepper || !config.keyVersion) {
    throw new Error('CHANNEL_GATE_ELIGIBILITY_CONFIG_REQUIRED');
  }
  const message = CHANNEL_GATE.ELIGIBILITY_IDENTITY_CONTEXT + String(config.keyVersion) + '|' + String(userId);
  return CHANNEL_GATE.ELIGIBILITY_STORAGE_PREFIX + channelGateHmacSha256Hex_(message, config.pepper);
}

function channelGateEligibilityStorageKey_(userId) {
  const config = channelGateEligibilityConfig_();
  if (!config.ok) throw new Error('CHANNEL_GATE_ELIGIBILITY_CONFIG_INVALID:' + config.reason);
  return channelGateEligibilityStorageKeyFromConfig_(userId, config);
}

function channelGateEligibilityRecordValue_(state, generation) {
  const allowed = CHANNEL_GATE.ELIGIBILITY_STATE;
  if (state !== allowed.ENROLLED && state !== allowed.RETIRING && state !== allowed.LOCKED) {
    throw new Error('CHANNEL_GATE_ELIGIBILITY_STATE_INVALID');
  }
  const n = Number(generation);
  if (!Number.isInteger(n) || n < 1 || n > 999999) throw new Error('CHANNEL_GATE_ELIGIBILITY_GENERATION_INVALID');
  return 'v' + CHANNEL_GATE.ELIGIBILITY_VERSION + '|' + state + '|' + String(n);
}

function channelGateParseEligibilityRecord_(rawValue) {
  const raw = rawValue === null || rawValue === undefined ? '' : String(rawValue);
  if (!raw) return { ok: true, exists: false, state: '', generation: 0 };

  const parts = raw.split('|');
  if (parts.length !== 3 || parts[0] !== 'v' + CHANNEL_GATE.ELIGIBILITY_VERSION) {
    return { ok: false, exists: true, reason: 'format_or_version_invalid' };
  }
  const state = parts[1];
  if (state !== CHANNEL_GATE.ELIGIBILITY_STATE.ENROLLED &&
      state !== CHANNEL_GATE.ELIGIBILITY_STATE.RETIRING &&
      state !== CHANNEL_GATE.ELIGIBILITY_STATE.LOCKED) {
    return { ok: false, exists: true, reason: 'state_invalid' };
  }
  if (!/^[1-9][0-9]*$/.test(parts[2])) {
    return { ok: false, exists: true, reason: 'generation_invalid' };
  }
  const generation = Number(parts[2]);
  if (!Number.isSafeInteger(generation) || generation < 1 || generation > 999999) {
    return { ok: false, exists: true, reason: 'generation_invalid' };
  }
  return { ok: true, exists: true, state: state, generation: generation };
}

/**
 * Read lifetime eligibility under the already-held R21 ScriptLock.
 * No raw Telegram user ID is persisted by this function.
 */
function channelGateReadEligibility_(userId, lock) {
  if (!channelGateAssertHeldLock_(lock, 'read_eligibility')) return { ok: false, reason: 'lock_required' };
  if (!channelGatePositiveIntegerLike_(userId)) return { ok: false, reason: 'invalid_user_id' };

  const config = channelGateEligibilityConfig_();
  if (!config.ok) return { ok: false, reason: config.reason };

  try {
    const key = channelGateEligibilityStorageKeyFromConfig_(userId, config);
    const raw = PropertiesService.getScriptProperties().getProperty(key);
    const record = channelGateParseEligibilityRecord_(raw);
    if (!record.ok) return { ok: false, reason: 'corrupt_record:' + record.reason };
    return record;
  } catch (error) {
    return { ok: false, reason: 'eligibility_read_failed:' + channelGateSafeError_(error) };
  }
}

/**
 * Record/confirm first enrollment or one PE05-authorized later enrollment.
 * Missing -> ENROLLED generation 1 remains the ordinary first-enrollment path;
 * existing ENROLLED remains idempotent; LOCKED can advance only through a
 * valid REENTRY_AUTHORIZED grant for exactly generation N+1.
 */
function channelGateRecordEnrollment_(userId, lock) {
  if (!channelGateAssertHeldLock_(lock, 'record_enrollment')) return false;
  const current = channelGateReadEligibility_(userId, lock);
  if (!current.ok) return false;

  // First-ever enrollment.
  if (!current.exists) {
    return channelGateWriteEligibilityState_(userId, CHANNEL_GATE.ELIGIBILITY_STATE.ENROLLED, 1, lock);
  }

  // Same-lineage enrollment reconciliation is read-only, except for the narrow
  // crash-recovery case where a PE05 grant reached CONSUMING after generation
  // advancement but before the final CONSUMED write.
  if (current.state === CHANNEL_GATE.ELIGIBILITY_STATE.ENROLLED) {
    const grant = channelGateReadReentryGrantForUser_(userId);
    if (!grant.ok) return false;
    if (grant.exists &&
        grant.effectiveStatus === CHANNEL_GATE.REENTRY_GRANT_STATUS.CONSUMING &&
        grant.targetGeneration === current.generation) {
      const consumed = channelGatePersistReentryGrantStatus_(grant, CHANNEL_GATE.REENTRY_GRANT_STATUS.CONSUMED);
      if (consumed.ok === true) {
        const cleanup = channelGateCleanupTerminalRequestForGrant_(consumed);
        if (!cleanup.ok) channelGateLog_('CHANNEL_GATE_REENTRY_REQUEST_CLEANUP_PENDING', { targetGeneration: consumed.targetGeneration });
        return true;
      }
      return false;
    }
    return true;
  }

  if (current.state === CHANNEL_GATE.ELIGIBILITY_STATE.RETIRING) return false;
  if (current.state !== CHANNEL_GATE.ELIGIBILITY_STATE.LOCKED) return false;

  const grant = channelGateReadReentryGrantForUser_(userId);
  if (!grant.ok || !grant.exists ||
      grant.effectiveStatus !== CHANNEL_GATE.REENTRY_GRANT_STATUS.REENTRY_AUTHORIZED ||
      grant.targetGeneration !== current.generation + 1) {
    return false;
  }

  // Crash-safe three-step finalization under R21's already-held ScriptLock:
  // AUTHORIZED -> CONSUMING -> lifetime ENROLLED generation N+1 -> CONSUMED.
  // If lifetime advancement fails, attempt to restore AUTHORIZED. If final
  // CONSUMED persistence fails after advancement, the grant remains CONSUMING;
  // the next common enrollment reconciliation finalizes it before a Session.
  const consuming = channelGatePersistReentryGrantStatus_(grant, CHANNEL_GATE.REENTRY_GRANT_STATUS.CONSUMING);
  if (!consuming.ok) return false;

  if (!channelGateWriteEligibilityState_(userId, CHANNEL_GATE.ELIGIBILITY_STATE.ENROLLED, grant.targetGeneration, lock)) {
    const rollback = channelGatePersistReentryGrantStatus_(consuming, CHANNEL_GATE.REENTRY_GRANT_STATUS.REENTRY_AUTHORIZED);
    if (!rollback.ok) {
      channelGateLog_('CHANNEL_GATE_REENTRY_ROLLBACK_UNCONFIRMED', {
        grantId: grant.grantId,
        targetGeneration: grant.targetGeneration
      });
    }
    return false;
  }

  const persisted = channelGateReadEligibility_(userId, lock);
  if (!persisted.ok || !persisted.exists ||
      persisted.state !== CHANNEL_GATE.ELIGIBILITY_STATE.ENROLLED ||
      persisted.generation !== grant.targetGeneration) {
    return false;
  }

  const consumed = channelGatePersistReentryGrantStatus_(consuming, CHANNEL_GATE.REENTRY_GRANT_STATUS.CONSUMED);
  if (!consumed.ok) {
    channelGateLog_('CHANNEL_GATE_REENTRY_CONSUMPTION_FINALIZATION_PENDING', {
      grantId: grant.grantId,
      targetGeneration: grant.targetGeneration
    });
    return false;
  }
  const cleanup = channelGateCleanupTerminalRequestForGrant_(consumed);
  if (!cleanup.ok) channelGateLog_('CHANNEL_GATE_REENTRY_REQUEST_CLEANUP_PENDING', { targetGeneration: consumed.targetGeneration });
  return true;
}

function channelGateBeginRetirement_(userId, lock) {
  if (!channelGateAssertHeldLock_(lock, 'begin_retirement')) return false;
  const current = channelGateReadEligibility_(userId, lock);
  if (!current.ok || !current.exists) return false;
  if (current.state === CHANNEL_GATE.ELIGIBILITY_STATE.RETIRING) return true;
  if (current.state !== CHANNEL_GATE.ELIGIBILITY_STATE.ENROLLED) return false;
  return channelGateWriteEligibilityState_(userId, CHANNEL_GATE.ELIGIBILITY_STATE.RETIRING, current.generation, lock);
}

function channelGateCompleteRetirement_(userId, lock) {
  if (!channelGateAssertHeldLock_(lock, 'complete_retirement')) return false;
  const current = channelGateReadEligibility_(userId, lock);
  if (!current.ok || !current.exists) return false;
  if (current.state === CHANNEL_GATE.ELIGIBILITY_STATE.LOCKED) return true;
  if (current.state !== CHANNEL_GATE.ELIGIBILITY_STATE.RETIRING) return false;
  return channelGateWriteEligibilityState_(userId, CHANNEL_GATE.ELIGIBILITY_STATE.LOCKED, current.generation, lock);
}


// -----------------------------------------------------------------------------
// PE07 — Script Properties capacity governance.
// Full-store inspection occurs only on mutation/operator paths, never on the
// ordinary verified/LOCKED/RETIRING read hot path.
// -----------------------------------------------------------------------------

function channelGateUtf8ByteLength_(value) {
  const s = String(value == null ? '' : value);
  if (typeof Utilities !== 'undefined' && typeof Utilities.newBlob === 'function') {
    return Utilities.newBlob(s).getBytes().length;
  }
  // Test/runtime fallback; access-control keys/values are ASCII in production.
  return unescape(encodeURIComponent(s)).length;
}

function channelGatePropertyPayloadBytes_(key, value) {
  return channelGateUtf8ByteLength_(key) + channelGateUtf8ByteLength_(value);
}

function channelGatePropertyStoreCapacitySnapshot_() {
  try {
    const props = PropertiesService.getScriptProperties();
    const all = props.getProperties();
    let used = 0;
    let eligibilityCount = 0;
    let grantCount = 0;
    let membershipCount = 0;
    let requestCount = 0;
    Object.keys(all).forEach(function(key) {
      used += channelGatePropertyPayloadBytes_(key, all[key]);
      if (String(key).indexOf(CHANNEL_GATE.ELIGIBILITY_STORAGE_PREFIX) === 0) eligibilityCount++;
      else if (String(key).indexOf(CHANNEL_GATE.REENTRY_GRANT_STORAGE_PREFIX) === 0) grantCount++;
      else if (String(key).indexOf(CHANNEL_GATE.MEMBERSHIP_STORAGE_PREFIX) === 0) membershipCount++;
      else if (String(key).indexOf(CHANNEL_GATE.REENTRY_REQUEST_STORAGE_PREFIX) === 0) requestCount++;
    });
    const status = used >= CHANNEL_GATE.PROPERTY_STORE_GROWTH_STOP_BYTES ? 'GROWTH_STOP' :
      (used >= CHANNEL_GATE.PROPERTY_STORE_WARNING_BYTES ? 'WARNING' : 'OK');
    return {
      ok: true,
      estimatedPayloadBytes: used,
      documentedLimitBytes: CHANNEL_GATE.PROPERTY_STORE_DOCUMENTED_LIMIT_BYTES,
      warningBytes: CHANNEL_GATE.PROPERTY_STORE_WARNING_BYTES,
      growthStopBytes: CHANNEL_GATE.PROPERTY_STORE_GROWTH_STOP_BYTES,
      status: status,
      eligibilityCount: eligibilityCount,
      grantCount: grantCount,
      membershipCount: membershipCount,
      requestCount: requestCount
    };
  } catch (error) {
    return { ok: false, reason: 'property_capacity_read_failed:' + channelGateSafeError_(error) };
  }
}

function channelGateCapacityAllowsWrite_(storageKey, value) {
  try {
    const props = PropertiesService.getScriptProperties();
    const all = props.getProperties();
    let used = 0;
    Object.keys(all).forEach(function(key) {
      used += channelGatePropertyPayloadBytes_(key, all[key]);
    });
    const key = String(storageKey);
    const oldExists = Object.prototype.hasOwnProperty.call(all, key);
    const oldBytes = oldExists ? channelGatePropertyPayloadBytes_(key, all[key]) : 0;
    const nextBytes = channelGatePropertyPayloadBytes_(key, String(value));
    const projected = used - oldBytes + nextBytes;

    // At/above the growth stop, non-growing updates remain permitted so
    // ENROLLED -> RETIRING -> LOCKED and grant reconciliation can finish.
    if (projected <= used) return { ok: true, usedBytes: used, projectedBytes: projected, growthBytes: projected - used };
    if (projected > CHANNEL_GATE.PROPERTY_STORE_GROWTH_STOP_BYTES) {
      channelGateLog_('CHANNEL_GATE_PROPERTY_CAPACITY_GROWTH_BLOCKED', {
        usedBytes: used,
        projectedBytes: projected,
        growthStopBytes: CHANNEL_GATE.PROPERTY_STORE_GROWTH_STOP_BYTES
      });
      return { ok: false, reason: 'property_capacity_growth_stop', usedBytes: used, projectedBytes: projected };
    }
    return { ok: true, usedBytes: used, projectedBytes: projected, growthBytes: projected - used };
  } catch (error) {
    return { ok: false, reason: 'property_capacity_preflight_failed:' + channelGateSafeError_(error) };
  }
}

function inspectEligibilityCapacityOnce_() {
  return channelGateWithOperatorScriptLock_(function(lock) {
    const snapshot = channelGatePropertyStoreCapacitySnapshot_();
    if (!snapshot.ok) throw new Error('ELIGIBILITY_CAPACITY_INSPECTION_FAILED:' + snapshot.reason);
    return snapshot;
  });
}

function channelGateWriteEligibilityState_(userId, state, generation, lock) {
  if (!channelGateAssertHeldLock_(lock, 'write_eligibility')) return false;
  const config = channelGateEligibilityConfig_();
  if (!config.ok) return false;

  try {
    const props = PropertiesService.getScriptProperties();
    const key = channelGateEligibilityStorageKeyFromConfig_(userId, config);
    const value = channelGateEligibilityRecordValue_(state, generation);
    const capacity = channelGateCapacityAllowsWrite_(key, value);
    if (!capacity.ok) return false;
    props.setProperty(key, value);
    return String(props.getProperty(key) || '') === value;
  } catch (error) {
    channelGateLog_('CHANNEL_GATE_ELIGIBILITY_PERSISTENCE_EXCEPTION', { message: channelGateSafeError_(error) });
    return false;
  }
}


// -----------------------------------------------------------------------------
// PE05 — owner-authorized re-entry grant subsystem.
// These Script Properties are access/governance state only; none are research
// measures and no raw authorization code is persisted.
// -----------------------------------------------------------------------------

function channelGateIdentityDigestFromConfig_(userId, config) {
  if (!channelGatePositiveIntegerLike_(userId)) throw new Error('CHANNEL_GATE_INVALID_USER_ID');
  if (!config || config.ok !== true || !config.pepper || !config.keyVersion) {
    throw new Error('CHANNEL_GATE_ELIGIBILITY_CONFIG_REQUIRED');
  }
  const message = CHANNEL_GATE.ELIGIBILITY_IDENTITY_CONTEXT + String(config.keyVersion) + '|' + String(userId);
  return channelGateHmacSha256Hex_(message, config.pepper);
}

function channelGateGrantStorageKeyFromDigest_(identityDigest) {
  const digest = String(identityDigest || '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(digest)) throw new Error('CHANNEL_GATE_IDENTITY_DIGEST_INVALID');
  return CHANNEL_GATE.REENTRY_GRANT_STORAGE_PREFIX + digest;
}

function channelGateGrantStorageKeyForUser_(userId, config) {
  return channelGateGrantStorageKeyFromDigest_(channelGateIdentityDigestFromConfig_(userId, config));
}

function channelGateParseUnlockCommand_(text) {
  const raw = String(text == null ? '' : text).trim();
  const match = /^\/unlock(?:@[A-Za-z0-9_]+)?(?:\s+(.+))?$/i.exec(raw);
  if (!match) return { isCommand: false, valid: false, code: '' };
  if (!match[1]) return { isCommand: true, valid: false, code: '' };
  const code = String(match[1]).toUpperCase().replace(/[\s-]+/g, '');
  if (!new RegExp('^[0-9A-F]{' + CHANNEL_GATE.REENTRY_CODE_HEX_LENGTH + '}$').test(code)) {
    return { isCommand: true, valid: false, code: '' };
  }
  return { isCommand: true, valid: true, code: code };
}

function channelGateReentryTtlMinutes_() {
  let raw = '';
  try {
    raw = String(PropertiesService.getScriptProperties().getProperty(CHANNEL_GATE.REENTRY_TTL_PROPERTY) || '').trim();
  } catch (error) {
    return { ok: false, reason: 'ttl_configuration_read_failed' };
  }
  if (!raw) return { ok: true, minutes: CHANNEL_GATE.REENTRY_DEFAULT_TTL_MINUTES, source: 'default' };
  if (!/^[0-9]+$/.test(raw)) return { ok: false, reason: 'ttl_configuration_invalid' };
  const minutes = Number(raw);
  if (!Number.isSafeInteger(minutes) ||
      minutes < CHANNEL_GATE.REENTRY_MIN_TTL_MINUTES ||
      minutes > CHANNEL_GATE.REENTRY_MAX_TTL_MINUTES) {
    return { ok: false, reason: 'ttl_configuration_out_of_range' };
  }
  return { ok: true, minutes: minutes, source: 'property' };
}

function channelGateGrantReasonAllowed_(reason) {
  const r = String(reason || '');
  const allowed = CHANNEL_GATE.REENTRY_REASON;
  return r === allowed.TECHNICAL_REPLACEMENT ||
    r === allowed.APPROVED_REPEAT_PARTICIPATION ||
    r === allowed.VALIDATION_TEST_IDENTITY ||
    r === allowed.OTHER_OWNER_AUTHORIZED;
}

function channelGateGrantStatusAllowed_(status) {
  const s = String(status || '');
  const allowed = CHANNEL_GATE.REENTRY_GRANT_STATUS;
  return s === allowed.ISSUED ||
    s === allowed.MEMBERSHIP_PENDING ||
    s === allowed.REENTRY_AUTHORIZED ||
    s === allowed.CONSUMING ||
    s === allowed.CONSUMED ||
    s === allowed.REVOKED;
}

function channelGateGrantRecordValue_(record) {
  if (!record || record.ok === false) throw new Error('CHANNEL_GATE_GRANT_RECORD_REQUIRED');
  if (!channelGateGrantStatusAllowed_(record.status)) throw new Error('CHANNEL_GATE_GRANT_STATUS_INVALID');
  const generation = Number(record.targetGeneration);
  const expiresAt = Number(record.expiresAt);
  const issuedAt = Number(record.issuedAt);
  if (!Number.isSafeInteger(generation) || generation < 2 || generation > 999999) throw new Error('CHANNEL_GATE_GRANT_GENERATION_INVALID');
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= 0) throw new Error('CHANNEL_GATE_GRANT_EXPIRY_INVALID');
  if (!Number.isSafeInteger(issuedAt) || issuedAt <= 0 || issuedAt > expiresAt) throw new Error('CHANNEL_GATE_GRANT_ISSUED_AT_INVALID');
  const verifier = String(record.verifier || '').toLowerCase();
  const grantId = String(record.grantId || '').toLowerCase();
  const identityDigest = String(record.identityDigest || '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(verifier)) throw new Error('CHANNEL_GATE_GRANT_VERIFIER_INVALID');
  if (!new RegExp('^[0-9a-f]{' + CHANNEL_GATE.REENTRY_GRANT_ID_HEX_LENGTH + '}$').test(grantId)) throw new Error('CHANNEL_GATE_GRANT_ID_INVALID');
  if (!/^[0-9a-f]{64}$/.test(identityDigest)) throw new Error('CHANNEL_GATE_GRANT_IDENTITY_INVALID');
  if (!channelGateGrantReasonAllowed_(record.reason)) throw new Error('CHANNEL_GATE_GRANT_REASON_INVALID');

  const cvPresent = record.cv !== undefined && record.cv !== null && record.cv !== '';
  const codeVersion = cvPresent ? Number(record.cv) : 1;
  const origin = record.issuanceOrigin == null ? '' : String(record.issuanceOrigin);
  const requestId = record.requestId == null ? '' : String(record.requestId).toLowerCase();
  if (cvPresent && record.cv !== CHANNEL_GATE.REENTRY_CODE_VERSION_V2) throw new Error('CHANNEL_GATE_GRANT_CODE_VERSION_INVALID');
  if (!cvPresent && (origin || requestId)) throw new Error('CHANNEL_GATE_GRANT_V1_EXTENSION_INVALID');
  if (codeVersion === CHANNEL_GATE.REENTRY_CODE_VERSION_V2) {
    if (origin !== CHANNEL_GATE.REENTRY_ISSUANCE_ORIGIN.TELEGRAM_OWNER &&
        origin !== CHANNEL_GATE.REENTRY_ISSUANCE_ORIGIN.OPERATOR) throw new Error('CHANNEL_GATE_GRANT_ORIGIN_INVALID');
    if (origin === CHANNEL_GATE.REENTRY_ISSUANCE_ORIGIN.TELEGRAM_OWNER) {
      if (!new RegExp('^[0-9a-f]{' + CHANNEL_GATE.REENTRY_REQUEST_ID_HEX_LENGTH + '}$').test(requestId)) throw new Error('CHANNEL_GATE_GRANT_REQUEST_ID_REQUIRED');
    } else if (requestId) {
      throw new Error('CHANNEL_GATE_GRANT_OPERATOR_REQUEST_ID_NOT_ALLOWED');
    }
  }

  const out = {
    v: CHANNEL_GATE.REENTRY_GRANT_VERSION,
    s: String(record.status),
    g: generation,
    exp: expiresAt,
    iat: issuedAt,
    verifier: verifier,
    id: grantId,
    identity: identityDigest,
    reason: String(record.reason)
  };
  if (codeVersion === CHANNEL_GATE.REENTRY_CODE_VERSION_V2) {
    out.cv = CHANNEL_GATE.REENTRY_CODE_VERSION_V2;
    out.origin = origin;
    if (origin === CHANNEL_GATE.REENTRY_ISSUANCE_ORIGIN.TELEGRAM_OWNER) out.rid = requestId;
  }
  return JSON.stringify(out);
}

function channelGateParseGrantRecord_(rawValue, expectedIdentityDigest) {
  const raw = rawValue == null ? '' : String(rawValue);
  if (!raw) return { ok: true, exists: false, status: '', effectiveStatus: '', targetGeneration: 0 };
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (error) { return { ok: false, exists: true, reason: 'grant_json_invalid' }; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, exists: true, reason: 'grant_shape_invalid' };
  if (String(parsed.v || '') !== CHANNEL_GATE.REENTRY_GRANT_VERSION) return { ok: false, exists: true, reason: 'grant_version_invalid' };
  const status = String(parsed.s || '');
  if (!channelGateGrantStatusAllowed_(status)) return { ok: false, exists: true, reason: 'grant_status_invalid' };
  const targetGeneration = Number(parsed.g);
  const expiresAt = Number(parsed.exp);
  const issuedAt = Number(parsed.iat);
  const verifier = String(parsed.verifier || '').toLowerCase();
  const grantId = String(parsed.id || '').toLowerCase();
  const identityDigest = String(parsed.identity || '').toLowerCase();
  const reason = String(parsed.reason || '');
  if (!Number.isSafeInteger(targetGeneration) || targetGeneration < 2 || targetGeneration > 999999) return { ok: false, exists: true, reason: 'grant_generation_invalid' };
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= 0) return { ok: false, exists: true, reason: 'grant_expiry_invalid' };
  if (!Number.isSafeInteger(issuedAt) || issuedAt <= 0 || issuedAt > expiresAt) return { ok: false, exists: true, reason: 'grant_issued_at_invalid' };
  if (!/^[0-9a-f]{64}$/.test(verifier)) return { ok: false, exists: true, reason: 'grant_verifier_invalid' };
  if (!new RegExp('^[0-9a-f]{' + CHANNEL_GATE.REENTRY_GRANT_ID_HEX_LENGTH + '}$').test(grantId)) return { ok: false, exists: true, reason: 'grant_id_invalid' };
  if (!/^[0-9a-f]{64}$/.test(identityDigest)) return { ok: false, exists: true, reason: 'grant_identity_invalid' };
  if (expectedIdentityDigest && identityDigest !== String(expectedIdentityDigest).toLowerCase()) return { ok: false, exists: true, reason: 'grant_identity_mismatch' };
  if (!channelGateGrantReasonAllowed_(reason)) return { ok: false, exists: true, reason: 'grant_reason_invalid' };

  const cvPresent = Object.prototype.hasOwnProperty.call(parsed, 'cv');
  let codeVersion = 1;
  let issuanceOrigin = '';
  let requestId = '';
  if (cvPresent) {
    if (parsed.cv !== CHANNEL_GATE.REENTRY_CODE_VERSION_V2) {
      return { ok: false, exists: true, reason: 'grant_code_version_invalid' };
    }
    codeVersion = CHANNEL_GATE.REENTRY_CODE_VERSION_V2;
    issuanceOrigin = String(parsed.origin || '');
    requestId = String(parsed.rid || '').toLowerCase();
    if (issuanceOrigin !== CHANNEL_GATE.REENTRY_ISSUANCE_ORIGIN.TELEGRAM_OWNER &&
        issuanceOrigin !== CHANNEL_GATE.REENTRY_ISSUANCE_ORIGIN.OPERATOR) return { ok: false, exists: true, reason: 'grant_origin_invalid' };
    if (issuanceOrigin === CHANNEL_GATE.REENTRY_ISSUANCE_ORIGIN.TELEGRAM_OWNER) {
      if (!new RegExp('^[0-9a-f]{' + CHANNEL_GATE.REENTRY_REQUEST_ID_HEX_LENGTH + '}$').test(requestId)) return { ok: false, exists: true, reason: 'grant_request_id_invalid' };
    } else if (requestId) {
      return { ok: false, exists: true, reason: 'grant_operator_request_id_invalid' };
    }
  } else if (Object.prototype.hasOwnProperty.call(parsed, 'origin') || Object.prototype.hasOwnProperty.call(parsed, 'rid')) {
    return { ok: false, exists: true, reason: 'grant_v1_extension_invalid' };
  }

  let effectiveStatus = status;
  if ((status === CHANNEL_GATE.REENTRY_GRANT_STATUS.ISSUED ||
       status === CHANNEL_GATE.REENTRY_GRANT_STATUS.MEMBERSHIP_PENDING ||
       status === CHANNEL_GATE.REENTRY_GRANT_STATUS.REENTRY_AUTHORIZED) &&
      Date.now() > expiresAt) {
    effectiveStatus = 'EXPIRED';
  }

  return {
    ok: true,
    exists: true,
    status: status,
    effectiveStatus: effectiveStatus,
    targetGeneration: targetGeneration,
    expiresAt: expiresAt,
    issuedAt: issuedAt,
    verifier: verifier,
    grantId: grantId,
    identityDigest: identityDigest,
    reason: reason,
    codeVersion: codeVersion,
    cv: codeVersion === CHANNEL_GATE.REENTRY_CODE_VERSION_V2 ? CHANNEL_GATE.REENTRY_CODE_VERSION_V2 : null,
    issuanceOrigin: issuanceOrigin,
    requestId: requestId
  };
}

function channelGateReadReentryGrantForDigest_(identityDigest) {
  try {
    const key = channelGateGrantStorageKeyFromDigest_(identityDigest);
    const raw = PropertiesService.getScriptProperties().getProperty(key);
    return channelGateParseGrantRecord_(raw, identityDigest);
  } catch (error) {
    return { ok: false, exists: false, reason: 'grant_read_failed:' + channelGateSafeError_(error) };
  }
}

function channelGateReadReentryGrantForUser_(userId, optionalConfig) {
  const config = optionalConfig && optionalConfig.ok === true ? optionalConfig : channelGateEligibilityConfig_();
  if (!config.ok) return { ok: false, exists: false, reason: config.reason };
  try {
    const digest = channelGateIdentityDigestFromConfig_(userId, config);
    return channelGateReadReentryGrantForDigest_(digest);
  } catch (error) {
    return { ok: false, exists: false, reason: 'grant_identity_failed:' + channelGateSafeError_(error) };
  }
}

function channelGatePersistReentryGrant_(record) {
  try {
    const props = PropertiesService.getScriptProperties();
    const key = channelGateGrantStorageKeyFromDigest_(record.identityDigest);
    const value = channelGateGrantRecordValue_(record);
    const capacity = channelGateCapacityAllowsWrite_(key, value);
    if (!capacity.ok) return { ok: false, reason: capacity.reason || 'grant_capacity_blocked' };
    props.setProperty(key, value);
    const persisted = String(props.getProperty(key) || '');
    if (persisted !== value) return { ok: false, reason: 'grant_persistence_mismatch' };
    const parsed = channelGateParseGrantRecord_(persisted, record.identityDigest);
    if (!parsed.ok || !parsed.exists) return { ok: false, reason: parsed.reason || 'grant_verify_failed' };
    return parsed;
  } catch (error) {
    channelGateLog_('CHANNEL_GATE_REENTRY_GRANT_PERSISTENCE_EXCEPTION', { message: channelGateSafeError_(error) });
    return { ok: false, reason: 'grant_persistence_exception' };
  }
}

function channelGatePersistReentryGrantStatus_(grant, status) {
  if (!grant || grant.ok !== true || grant.exists !== true) return { ok: false, reason: 'grant_required' };
  const next = {
    status: String(status),
    targetGeneration: grant.targetGeneration,
    expiresAt: grant.expiresAt,
    issuedAt: grant.issuedAt,
    verifier: grant.verifier,
    grantId: grant.grantId,
    identityDigest: grant.identityDigest,
    reason: grant.reason
  };
  if (grant.codeVersion === CHANNEL_GATE.REENTRY_CODE_VERSION_V2 || grant.cv === CHANNEL_GATE.REENTRY_CODE_VERSION_V2) {
    next.cv = CHANNEL_GATE.REENTRY_CODE_VERSION_V2;
    next.issuanceOrigin = grant.issuanceOrigin;
    if (grant.issuanceOrigin === CHANNEL_GATE.REENTRY_ISSUANCE_ORIGIN.TELEGRAM_OWNER) next.requestId = grant.requestId;
  }
  return channelGatePersistReentryGrant_(next);
}

function channelGateReentryVerifier_(identityDigest, code, config) {
  const normalized = String(code || '').toUpperCase().replace(/[\s-]+/g, '');
  if (!new RegExp('^[0-9A-F]{' + CHANNEL_GATE.REENTRY_CODE_HEX_LENGTH + '}$').test(normalized)) {
    throw new Error('CHANNEL_GATE_REENTRY_CODE_INVALID');
  }
  return channelGateHmacSha256Hex_(
    CHANNEL_GATE.REENTRY_VERIFIER_CONTEXT + String(identityDigest).toLowerCase() + '|' + normalized,
    config.pepper
  );
}

function channelGateVerifyReentryCode_(code, grant, config) {
  if (!grant || !grant.exists || !grant.verifier || !grant.identityDigest) return false;
  try {
    const candidate = channelGateReentryVerifier_(grant.identityDigest, code, config);
    return channelGateConstantTimeEqual_(candidate, grant.verifier);
  } catch (error) {
    return false;
  }
}

function channelGateConstantTimeEqual_(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  const n = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < n; i++) {
    diff |= (a.charCodeAt(i % Math.max(1, a.length)) || 0) ^
      (b.charCodeAt(i % Math.max(1, b.length)) || 0);
  }
  return diff === 0;
}

function channelGateGenerateReentryCode_(identityDigest, config) {
  if (typeof Utilities === 'undefined' || typeof Utilities.getUuid !== 'function') {
    throw new Error('CHANNEL_GATE_UUID_UNAVAILABLE');
  }
  const nonce = String(Utilities.getUuid()) + '|' + String(Date.now()) + '|' + String(identityDigest);
  return channelGateHmacSha256Hex_(CHANNEL_GATE.REENTRY_CODE_DERIVATION_CONTEXT + nonce, config.pepper)
    .slice(0, CHANNEL_GATE.REENTRY_CODE_HEX_LENGTH)
    .toUpperCase();
}

function channelGateDeriveReentryCodeV2_(identityDigest, grantId, targetGeneration, expiresAt, config) {
  const identity = String(identityDigest || '').toLowerCase();
  const id = String(grantId || '').toLowerCase();
  const generation = Number(targetGeneration);
  const expiry = Number(expiresAt);
  if (!/^[0-9a-f]{64}$/.test(identity)) throw new Error('CHANNEL_GATE_V2_IDENTITY_INVALID');
  if (!new RegExp('^[0-9a-f]{' + CHANNEL_GATE.REENTRY_GRANT_ID_HEX_LENGTH + '}$').test(id)) throw new Error('CHANNEL_GATE_V2_GRANT_ID_INVALID');
  if (!Number.isSafeInteger(generation) || generation < 2 || generation > 999999) throw new Error('CHANNEL_GATE_V2_GENERATION_INVALID');
  if (!Number.isSafeInteger(expiry) || expiry <= 0) throw new Error('CHANNEL_GATE_V2_EXPIRY_INVALID');
  if (!config || config.ok !== true || !config.pepper) throw new Error('CHANNEL_GATE_V2_CONFIG_REQUIRED');
  const message = CHANNEL_GATE.REENTRY_CODE_V2_DERIVATION_CONTEXT +
    'cv=2|identity=' + identity +
    '|grant=' + id +
    '|generation=' + String(generation) +
    '|expires=' + String(expiry);
  return channelGateHmacSha256Hex_(message, config.pepper)
    .slice(0, CHANNEL_GATE.REENTRY_CODE_HEX_LENGTH)
    .toUpperCase();
}

function channelGateV2GrantActionable_(grant) {
  return !!(grant && grant.ok === true && grant.exists === true &&
    (grant.effectiveStatus === CHANNEL_GATE.REENTRY_GRANT_STATUS.ISSUED ||
     grant.effectiveStatus === CHANNEL_GATE.REENTRY_GRANT_STATUS.MEMBERSHIP_PENDING ||
     grant.effectiveStatus === CHANNEL_GATE.REENTRY_GRANT_STATUS.REENTRY_AUTHORIZED));
}

function channelGateV2GrantMatchesTelegramRequest_(grant, identityDigest, targetGeneration, reason, requestId) {
  return channelGateV2GrantActionable_(grant) &&
    grant.codeVersion === CHANNEL_GATE.REENTRY_CODE_VERSION_V2 &&
    grant.identityDigest === String(identityDigest).toLowerCase() &&
    grant.targetGeneration === Number(targetGeneration) &&
    grant.reason === String(reason) &&
    grant.issuanceOrigin === CHANNEL_GATE.REENTRY_ISSUANCE_ORIGIN.TELEGRAM_OWNER &&
    grant.requestId === String(requestId || '').toLowerCase();
}

function channelGateV2GrantCorrelatesTelegramRequest_(grant, identityDigest, targetGeneration, reason, requestId) {
  return !!(grant && grant.ok === true && grant.exists === true &&
    grant.codeVersion === CHANNEL_GATE.REENTRY_CODE_VERSION_V2 &&
    grant.identityDigest === String(identityDigest || '').toLowerCase() &&
    grant.targetGeneration === Number(targetGeneration) &&
    grant.reason === String(reason) &&
    grant.issuanceOrigin === CHANNEL_GATE.REENTRY_ISSUANCE_ORIGIN.TELEGRAM_OWNER &&
    grant.requestId === String(requestId || '').toLowerCase());
}

function channelGateRecoverV2Code_(grant, eligibilityConfig) {
  if (!grant || grant.ok !== true || grant.exists !== true ||
      grant.codeVersion !== CHANNEL_GATE.REENTRY_CODE_VERSION_V2) {
    return { ok: false, reason: 'v2_grant_required' };
  }
  if (!eligibilityConfig || eligibilityConfig.ok !== true) return { ok: false, reason: 'eligibility_configuration_invalid' };
  try {
    const rawCode = channelGateDeriveReentryCodeV2_(
      grant.identityDigest, grant.grantId, grant.targetGeneration, grant.expiresAt, eligibilityConfig
    );
    const verifier = channelGateReentryVerifier_(grant.identityDigest, rawCode, eligibilityConfig);
    if (!channelGateConstantTimeEqual_(verifier, grant.verifier)) return { ok: false, reason: 'v2_verifier_mismatch' };
    return { ok: true, code: channelGateFormatReentryCode_(rawCode) };
  } catch (error) {
    return { ok: false, reason: 'v2_code_recovery_failed:' + channelGateSafeError_(error) };
  }
}

function channelGateGrantTerminalForRequestCleanup_(grant) {
  if (!grant || grant.exists !== true) return true;
  return grant.effectiveStatus === 'EXPIRED' ||
    grant.effectiveStatus === CHANNEL_GATE.REENTRY_GRANT_STATUS.REVOKED ||
    grant.effectiveStatus === CHANNEL_GATE.REENTRY_GRANT_STATUS.CONSUMED;
}

function channelGateCleanupTerminalRequestForGrant_(grant) {
  if (!grant || grant.ok !== true) return { ok: false, pruned: false, reason: 'grant_required' };
  if (grant.exists && grant.effectiveStatus === CHANNEL_GATE.REENTRY_GRANT_STATUS.CONSUMING) {
    return { ok: true, pruned: false, reconciliation: true };
  }
  if (grant.exists && !channelGateGrantTerminalForRequestCleanup_(grant)) {
    return { ok: true, pruned: false, actionable: true };
  }
  const identityDigest = grant.identityDigest ? String(grant.identityDigest).toLowerCase() : '';
  if (!/^[0-9a-f]{64}$/.test(identityDigest)) return { ok: false, pruned: false, reason: 'grant_identity_invalid' };
  const request = channelGateReadRequestForDigest_(identityDigest);
  if (!request.ok) return { ok: false, pruned: false, reason: request.reason || 'request_read_failed' };
  if (!request.exists) return { ok: true, pruned: false, absent: true };
  if (grant.exists && grant.codeVersion === CHANNEL_GATE.REENTRY_CODE_VERSION_V2 &&
      grant.issuanceOrigin === CHANNEL_GATE.REENTRY_ISSUANCE_ORIGIN.TELEGRAM_OWNER) {
    if (request.requestId !== grant.requestId) return { ok: false, pruned: false, reason: 'request_grant_request_id_mismatch' };
    if (request.status === CHANNEL_GATE.REENTRY_REQUEST_STATUS.APPROVED &&
        request.linkedGrantId !== grant.grantId) return { ok: false, pruned: false, reason: 'request_grant_link_mismatch' };
  }
  if (!channelGateDeleteRequestForDigest_(identityDigest)) return { ok: false, pruned: false, reason: 'request_delete_failed' };
  return { ok: true, pruned: true };
}

function channelGateCleanupApprovedRequestWithoutActionableGrant_(identityDigest, request, grant) {
  if (!request || request.exists !== true || request.status !== CHANNEL_GATE.REENTRY_REQUEST_STATUS.APPROVED) {
    return { ok: true, pruned: false };
  }
  if (!grant || grant.ok !== true) return { ok: false, pruned: false, reason: 'grant_read_failed' };
  if (grant.exists && grant.effectiveStatus === CHANNEL_GATE.REENTRY_GRANT_STATUS.CONSUMING) {
    return { ok: true, pruned: false, reconciliation: true };
  }
  if (grant.exists && !channelGateGrantTerminalForRequestCleanup_(grant)) {
    return { ok: true, pruned: false, actionable: true };
  }
  if (grant.exists && request.linkedGrantId !== grant.grantId) {
    return { ok: false, pruned: false, reason: 'approved_request_grant_link_mismatch' };
  }
  if (!channelGateDeleteRequestForDigest_(identityDigest)) return { ok: false, pruned: false, reason: 'approved_request_delete_failed' };
  return { ok: true, pruned: true };
}

function channelGateGenerateGrantId_(identityDigest, config) {
  if (typeof Utilities === 'undefined' || typeof Utilities.getUuid !== 'function') {
    throw new Error('CHANNEL_GATE_UUID_UNAVAILABLE');
  }
  const nonce = String(Utilities.getUuid()) + '|' + String(Date.now()) + '|' + String(identityDigest);
  return channelGateHmacSha256Hex_(CHANNEL_GATE.REENTRY_GRANT_ID_CONTEXT + nonce, config.pepper)
    .slice(0, CHANNEL_GATE.REENTRY_GRANT_ID_HEX_LENGTH);
}

function channelGateFormatReentryCode_(code) {
  const raw = String(code || '').toUpperCase().replace(/[^0-9A-F]/g, '');
  return raw.replace(/(.{4})(?=.)/g, '$1-');
}

function channelGateLockedCommand_(text) {
  const raw = String(text == null ? '' : text).trim();
  const match = /^(\/(?:privacy|help|delete-data|acute|recovery))(?:@[A-Za-z0-9_]+)?(?:\s|$)/i.exec(raw);
  return match ? String(match[1]).toLowerCase() : '';
}

function channelGateSendLockedStatic_(command, chatId) {
  const cmd = String(command || '').toLowerCase();
  if (cmd === '/privacy') return channelGateSendText_(CHANNEL_GATE.LOCKED_PRIVACY_TEXT, chatId);
  if (cmd === '/help') return channelGateSendText_(CHANNEL_GATE.LOCKED_HELP_TEXT, chatId);
  if (cmd === '/delete-data') return channelGateSendText_(CHANNEL_GATE.LOCKED_DELETE_TEXT, chatId);
  if (cmd === '/acute') return channelGateSendText_(CHANNEL_GATE.LOCKED_ACUTE_TEXT, chatId);
  if (cmd === '/recovery') return channelGateSendText_(CHANNEL_GATE.LOCKED_RECOVERY_TEXT, chatId);
  return false;
}

function channelGateSendLockedExplanation_(chatId, userId, config) {
  const ownerConfig = channelGateOwnerConfig_();
  if (!ownerConfig.ok) return channelGateSendText_(CHANNEL_GATE.REQUEST_UNAVAILABLE_TEXT, chatId);
  return channelGateSendText_(CHANNEL_GATE.LOCKED_TEXT, chatId, [[
    { text: 'Request re-entry', callback_data: CHANNEL_GATE.REENTRY_REQUEST_ACTION }
  ]]);
}

function channelGateResolveOperatorTarget_() {
  const config = channelGateEligibilityConfig_();
  if (!config.ok) return { ok: false, reason: config.reason };
  let props;
  let userId = '';
  try {
    props = PropertiesService.getScriptProperties();
    userId = String(props.getProperty(CHANNEL_GATE.REENTRY_OPERATOR_TARGET_USER_ID_PROPERTY) || '').trim();
  } catch (error) {
    return { ok: false, reason: 'operator_target_read_failed' };
  }
  if (!channelGatePositiveIntegerLike_(userId)) return { ok: false, reason: 'operator_user_id_missing_or_invalid' };

  let identityDigest;
  let eligibility;
  try {
    identityDigest = channelGateIdentityDigestFromConfig_(userId, config);
    const raw = props.getProperty(CHANNEL_GATE.ELIGIBILITY_STORAGE_PREFIX + identityDigest);
    eligibility = channelGateParseEligibilityRecord_(raw);
  } catch (error) {
    return { ok: false, reason: 'operator_eligibility_read_failed' };
  }
  if (!eligibility.ok) return { ok: false, reason: 'operator_eligibility_corrupt:' + eligibility.reason };
  if (!eligibility.exists) return { ok: false, reason: 'operator_target_has_no_lifetime_record' };

  return {
    ok: true,
    config: config,
    props: props,
    userId: userId,
    identityDigest: identityDigest,
    eligibility: eligibility
  };
}

// R21/PE04 readiness proof for initial/reissued grants. LOCKED alone is not
// sufficient because PE04 can intentionally reach LOCKED while a retained
// DataControlRequests reconciliation handle still exists. A grant cannot be
// issued until no deletion request remains and no reliable enrolled research
// record exists. A fresh pre-enrollment setup row from an expired/revoked prior
// grant is permitted because it is not a completed participation.
function channelGateReentryTargetReady_(userId) {
  if (typeof latestDeletionRequest_ !== 'function' ||
      typeof reliableDeletionEnrollmentEvidence_ !== 'function') {
    return { ok: false, reason: 'core_reentry_readiness_api_unavailable' };
  }
  try {
    const request = latestDeletionRequest_(String(userId));
    if (request) return { ok: false, reason: 'deletion_reconciliation_not_complete' };
    const evidence = reliableDeletionEnrollmentEvidence_(String(userId));
    if (!evidence || evidence.ok !== true) {
      return { ok: false, reason: evidence && evidence.reason ? String(evidence.reason) : 'enrollment_evidence_unresolved' };
    }
    if (evidence.reliable === true) return { ok: false, reason: 'retained_durable_participation_record' };
    return { ok: true, participantExists: evidence.participantExists === true };
  } catch (error) {
    return { ok: false, reason: 'core_reentry_readiness_check_failed:' + channelGateSafeError_(error) };
  }
}

function channelGateIssueReentryGrant_(userId, reason, lock, options) {
  if (!channelGateAssertHeldLock_(lock, 'issue_reentry_grant')) return { ok: false, reason: 'lock_required' };
  if (!channelGatePositiveIntegerLike_(userId)) return { ok: false, reason: 'user_id_invalid' };
  const config = channelGateEligibilityConfig_();
  if (!config.ok) return { ok: false, reason: config.reason };
  if (!channelGateGrantReasonAllowed_(reason)) return { ok: false, reason: 'grant_reason_invalid' };

  const opts = options && typeof options === 'object' ? options : {};
  const origin = String(opts.issuanceOrigin || '');
  const requestId = opts.requestId == null ? '' : String(opts.requestId).toLowerCase();
  if (origin !== CHANNEL_GATE.REENTRY_ISSUANCE_ORIGIN.TELEGRAM_OWNER &&
      origin !== CHANNEL_GATE.REENTRY_ISSUANCE_ORIGIN.OPERATOR) return { ok: false, reason: 'issuance_origin_invalid' };
  if (origin === CHANNEL_GATE.REENTRY_ISSUANCE_ORIGIN.TELEGRAM_OWNER) {
    if (!new RegExp('^[0-9a-f]{' + CHANNEL_GATE.REENTRY_REQUEST_ID_HEX_LENGTH + '}$').test(requestId)) return { ok: false, reason: 'request_id_invalid' };
    if (String(reason) !== CHANNEL_GATE.REENTRY_REASON.APPROVED_REPEAT_PARTICIPATION) return { ok: false, reason: 'telegram_owner_reason_invalid' };
  } else if (requestId) {
    return { ok: false, reason: 'operator_request_id_not_allowed' };
  }

  let identityDigest;
  let eligibility;
  try {
    identityDigest = channelGateIdentityDigestFromConfig_(String(userId), config);
    const raw = PropertiesService.getScriptProperties().getProperty(CHANNEL_GATE.ELIGIBILITY_STORAGE_PREFIX + identityDigest);
    eligibility = channelGateParseEligibilityRecord_(raw);
  } catch (error) {
    return { ok: false, reason: 'eligibility_read_failed' };
  }
  if (!eligibility.ok || !eligibility.exists) return { ok: false, reason: 'eligibility_missing_or_invalid' };
  if (eligibility.state !== CHANNEL_GATE.ELIGIBILITY_STATE.LOCKED) return { ok: false, reason: 'locked_required' };
  if (!Number.isSafeInteger(eligibility.generation) || eligibility.generation < 1 || eligibility.generation > 999998) return { ok: false, reason: 'generation_ceiling_reached' };

  const readiness = channelGateReentryTargetReady_(String(userId));
  if (!readiness.ok) return { ok: false, reason: 'reentry_target_not_ready:' + readiness.reason };
  const ttl = channelGateReentryTtlMinutes_();
  if (!ttl.ok) return { ok: false, reason: 'grant_ttl_invalid:' + ttl.reason };
  const targetGeneration = eligibility.generation + 1;
  const existing = channelGateReadReentryGrantForDigest_(identityDigest);
  if (!existing.ok) return { ok: false, reason: 'existing_grant_invalid:' + existing.reason };

  if (existing.exists &&
      existing.effectiveStatus !== 'EXPIRED' &&
      existing.effectiveStatus !== CHANNEL_GATE.REENTRY_GRANT_STATUS.CONSUMED &&
      existing.effectiveStatus !== CHANNEL_GATE.REENTRY_GRANT_STATUS.REVOKED) {
    if (origin === CHANNEL_GATE.REENTRY_ISSUANCE_ORIGIN.TELEGRAM_OWNER &&
        channelGateV2GrantMatchesTelegramRequest_(existing, identityDigest, targetGeneration, reason, requestId)) {
      const reusedCode = channelGateDeriveReentryCodeV2_(existing.identityDigest, existing.grantId, existing.targetGeneration, existing.expiresAt, config);
      const reusedVerifier = channelGateReentryVerifier_(existing.identityDigest, reusedCode, config);
      if (!channelGateConstantTimeEqual_(reusedVerifier, existing.verifier)) return { ok: false, reason: 'existing_v2_verifier_mismatch' };
      return {
        ok: true,
        reused: true,
        code: channelGateFormatReentryCode_(reusedCode),
        grantId: existing.grantId,
        targetGeneration: existing.targetGeneration,
        expiresAt: existing.expiresAt,
        reason: existing.reason,
        cv: CHANNEL_GATE.REENTRY_CODE_VERSION_V2,
        issuanceOrigin: existing.issuanceOrigin,
        requestId: existing.requestId,
        grant: existing
      };
    }
    return { ok: false, reason: 'active_or_reconciliation_grant_exists' };
  }

  const now = Date.now();
  const expiresAt = now + ttl.minutes * 60000;
  const grantId = channelGateGenerateGrantId_(identityDigest, config);
  const rawCode = channelGateDeriveReentryCodeV2_(identityDigest, grantId, targetGeneration, expiresAt, config);
  const record = {
    status: CHANNEL_GATE.REENTRY_GRANT_STATUS.ISSUED,
    targetGeneration: targetGeneration,
    expiresAt: expiresAt,
    issuedAt: now,
    verifier: channelGateReentryVerifier_(identityDigest, rawCode, config),
    grantId: grantId,
    identityDigest: identityDigest,
    reason: String(reason),
    cv: CHANNEL_GATE.REENTRY_CODE_VERSION_V2,
    issuanceOrigin: origin
  };
  if (origin === CHANNEL_GATE.REENTRY_ISSUANCE_ORIGIN.TELEGRAM_OWNER) record.requestId = requestId;
  const persisted = channelGatePersistReentryGrant_(record);
  if (!persisted.ok) return { ok: false, reason: 'grant_persistence_failed:' + persisted.reason };
  return {
    ok: true,
    reused: false,
    code: channelGateFormatReentryCode_(rawCode),
    grantId: persisted.grantId,
    targetGeneration: persisted.targetGeneration,
    expiresAt: persisted.expiresAt,
    reason: persisted.reason,
    cv: CHANNEL_GATE.REENTRY_CODE_VERSION_V2,
    issuanceOrigin: persisted.issuanceOrigin,
    requestId: persisted.requestId,
    grant: persisted
  };
}

function channelGateRevokeReentryGrant_(userId, lock) {
  if (!channelGateAssertHeldLock_(lock, 'revoke_reentry_grant')) return { ok: false, reason: 'lock_required' };
  if (!channelGatePositiveIntegerLike_(userId)) return { ok: false, reason: 'user_id_invalid' };
  const config = channelGateEligibilityConfig_();
  if (!config.ok) return { ok: false, reason: config.reason };
  let identityDigest;
  let eligibility;
  try {
    identityDigest = channelGateIdentityDigestFromConfig_(String(userId), config);
    eligibility = channelGateParseEligibilityRecord_(PropertiesService.getScriptProperties().getProperty(CHANNEL_GATE.ELIGIBILITY_STORAGE_PREFIX + identityDigest));
  } catch (error) {
    return { ok: false, reason: 'eligibility_read_failed' };
  }
  if (!eligibility.ok || !eligibility.exists || eligibility.state !== CHANNEL_GATE.ELIGIBILITY_STATE.LOCKED) return { ok: false, reason: 'locked_required' };
  const grant = channelGateReadReentryGrantForDigest_(identityDigest);
  if (!grant.ok || !grant.exists) return { ok: false, reason: 'grant_not_found' };
  if (grant.effectiveStatus === CHANNEL_GATE.REENTRY_GRANT_STATUS.CONSUMING) return { ok: false, reason: 'consumption_reconciliation_required' };
  if (grant.effectiveStatus === CHANNEL_GATE.REENTRY_GRANT_STATUS.CONSUMED) return { ok: false, reason: 'already_consumed' };
  if (grant.effectiveStatus === CHANNEL_GATE.REENTRY_GRANT_STATUS.REVOKED) return { ok: true, status: 'REVOKED', grantId: grant.grantId, grant: grant, idempotent: true };
  const revoked = channelGatePersistReentryGrantStatus_(grant, CHANNEL_GATE.REENTRY_GRANT_STATUS.REVOKED);
  if (!revoked.ok) return { ok: false, reason: 'revocation_failed:' + (revoked.reason || '') };
  return { ok: true, status: 'REVOKED', grantId: revoked.grantId, grant: revoked, idempotent: false };
}

function channelGateWithOperatorScriptLock_(callback) {
  if (typeof LockService === 'undefined' || !LockService.getScriptLock) throw new Error('CHANNEL_GATE_LOCK_SERVICE_UNAVAILABLE');
  const lock = LockService.getScriptLock();
  let acquired = false;
  try {
    lock.waitLock(30000);
    acquired = true;
    if (!channelGateHasHeldLock_(lock)) throw new Error('CHANNEL_GATE_OPERATOR_LOCK_UNCONFIRMED');
    return callback(lock);
  } finally {
    if (acquired) lock.releaseLock();
  }
}

function channelGateClearOperatorInputs_(props, includeReason) {
  const names = [CHANNEL_GATE.REENTRY_OPERATOR_TARGET_USER_ID_PROPERTY];
  if (includeReason) names.push(CHANNEL_GATE.REENTRY_OPERATOR_REASON_PROPERTY);
  let ok = true;
  names.forEach(function(name) {
    try {
      props.deleteProperty(name);
      if (String(props.getProperty(name) || '') !== '') ok = false;
    } catch (error) { ok = false; }
  });
  return ok;
}

/**
 * Operator entry point.
 *
 * Set SCB_REENTRY_OPERATOR_TARGET_USER_ID to the target Telegram user ID and
 * SCB_REENTRY_OPERATOR_REASON to one PE01-approved reason.
 *
 * Optional: SCB_REENTRY_GRANT_TTL_MINUTES (default 1440, allowed 5..10080).
 *
 * Returns the V2 code to the operator without persisting or logging it. Active
 * V2 code recovery remains available through inspectReentryGrantOnce_(). The target must be LOCKED and the R21/PE04 readiness check must also
 * confirm that no retained deletion request or reliable enrolled research record
 * remains. This prevents grant issuance during unfinished deletion reconciliation
 * and prevents resetting a retained completed/withdrawn participant row in place.
 */
function issueReentryGrantOnce_() {
  return channelGateWithOperatorScriptLock_(function(lock) {
    const target = channelGateResolveOperatorTarget_();
    if (!target.ok) throw new Error('REENTRY_GRANT_TARGET_INVALID:' + target.reason);
    const reason = String(target.props.getProperty(CHANNEL_GATE.REENTRY_OPERATOR_REASON_PROPERTY) || '').trim();
    const issued = channelGateIssueReentryGrant_(target.userId, reason, lock, {
      issuanceOrigin: CHANNEL_GATE.REENTRY_ISSUANCE_ORIGIN.OPERATOR
    });
    if (!issued.ok) throw new Error('REENTRY_GRANT_ISSUANCE_FAILED:' + issued.reason);
    const inputCleared = channelGateClearOperatorInputs_(target.props, true);
    channelGateLog_('CHANNEL_GATE_REENTRY_GRANT_ISSUED', {
      grantId: issued.grantId,
      targetGeneration: issued.targetGeneration,
      expiresAt: issued.expiresAt,
      reason: issued.reason,
      cv: issued.cv,
      issuanceOrigin: issued.issuanceOrigin,
      operatorInputCleared: inputCleared
    });
    return {
      ok: true,
      code: issued.code,
      grantId: issued.grantId,
      targetGeneration: issued.targetGeneration,
      expiresAt: new Date(issued.expiresAt).toISOString(),
      reason: issued.reason,
      cv: issued.cv,
      issuanceOrigin: issued.issuanceOrigin,
      operatorInputCleared: inputCleared
    };
  });
}

function revokeReentryGrantOnce_() {
  return channelGateWithOperatorScriptLock_(function(lock) {
    const target = channelGateResolveOperatorTarget_();
    if (!target.ok) throw new Error('REENTRY_GRANT_TARGET_INVALID:' + target.reason);
    const revoked = channelGateRevokeReentryGrant_(target.userId, lock);
    if (!revoked.ok) throw new Error('REENTRY_GRANT_REVOCATION_FAILED:' + revoked.reason);
    const inputCleared = channelGateClearOperatorInputs_(target.props, false);
    if (!revoked.idempotent) {
      channelGateLog_('CHANNEL_GATE_REENTRY_GRANT_REVOKED', {
        grantId: revoked.grantId,
        targetGeneration: revoked.grant.targetGeneration,
        operatorInputCleared: inputCleared
      });
    }
    return { ok: true, status: 'REVOKED', grantId: revoked.grantId, operatorInputCleared: inputCleared };
  });
}

function inspectReentryGrantOnce_() {
  return channelGateWithOperatorScriptLock_(function(lock) {
    const target = channelGateResolveOperatorTarget_();
    if (!target.ok) throw new Error('REENTRY_GRANT_TARGET_INVALID:' + target.reason);
    const grant = channelGateReadReentryGrantForDigest_(target.identityDigest);
    if (!grant.ok) throw new Error('REENTRY_GRANT_STATE_INVALID:' + grant.reason);
    const inputCleared = channelGateClearOperatorInputs_(target.props, false);
    if (!grant.exists) {
      return {
        ok: true,
        eligibilityState: target.eligibility.state,
        participationGeneration: target.eligibility.generation,
        grantExists: false,
        operatorInputCleared: inputCleared
      };
    }
    const out = {
      ok: true,
      eligibilityState: target.eligibility.state,
      participationGeneration: target.eligibility.generation,
      grantExists: true,
      grantId: grant.grantId,
      grantStatus: grant.effectiveStatus,
      targetGeneration: grant.targetGeneration,
      expiresAt: new Date(grant.expiresAt).toISOString(),
      reason: grant.reason,
      codeVersion: grant.codeVersion,
      issuanceOrigin: grant.issuanceOrigin || '',
      requestId: grant.requestId || '',
      codeRecoverable: false,
      operatorInputCleared: inputCleared
    };
    if (grant.codeVersion === CHANNEL_GATE.REENTRY_CODE_VERSION_V2 && channelGateV2GrantActionable_(grant)) {
      const rawCode = channelGateDeriveReentryCodeV2_(grant.identityDigest, grant.grantId, grant.targetGeneration, grant.expiresAt, target.config);
      const verifier = channelGateReentryVerifier_(grant.identityDigest, rawCode, target.config);
      if (!channelGateConstantTimeEqual_(verifier, grant.verifier)) throw new Error('REENTRY_GRANT_V2_RECOVERY_VERIFIER_MISMATCH');
      out.code = channelGateFormatReentryCode_(rawCode);
      out.codeRecoverable = true;
    }
    return out;
  });
}

function channelGateMigrationAccessRef_(userId, config) {
  return channelGateIdentityDigestFromConfig_(userId, config).slice(0, 16).toUpperCase();
}

function channelGateLegacyMembershipVerified_(userId) {
  const channel = channelGateReadRequiredChannel_();
  if (!channel.ok) return { ok: false, reason: 'required_channel_unavailable' };
  try {
    const key = channelGateStorageKey_(channel.identity, userId);
    return {
      ok: true,
      verified: String(PropertiesService.getScriptProperties().getProperty(key) || '') === CHANNEL_GATE.MEMBERSHIP_VERIFIED_VALUE
    };
  } catch (error) {
    return { ok: false, reason: 'legacy_membership_read_failed:' + channelGateSafeError_(error) };
  }
}

function channelGateLegacyDeletedAuditEvidence_(userId) {
  if (typeof participantFingerprint_ !== 'function' ||
      typeof getDataControlAuditSheet_ !== 'function' ||
      typeof readRows_ !== 'function' ||
      typeof COLS === 'undefined' || !COLS.DATA_CONTROL_AUDIT) {
    return { ok: false, reliable: false, reason: 'legacy_deletion_audit_api_unavailable' };
  }
  let fingerprint;
  try { fingerprint = String(participantFingerprint_(String(userId)) || ''); }
  catch (error) { return { ok: false, reliable: false, reason: 'legacy_fingerprint_unavailable' }; }
  if (!fingerprint) return { ok: false, reliable: false, reason: 'legacy_fingerprint_empty' };

  try {
    const rows = readRows_(getDataControlAuditSheet_());
    const matches = rows.filter(function(row) {
      return String(row[COLS.DATA_CONTROL_AUDIT.PARTICIPANT_FINGERPRINT]) === fingerprint &&
        String(row[COLS.DATA_CONTROL_AUDIT.ACTION]) === 'DELETE' &&
        String(row[COLS.DATA_CONTROL_AUDIT.OUTCOME]) === 'PURGE_CONFIRMED';
    });
    return {
      ok: true,
      reliable: matches.length > 0,
      matchCount: matches.length,
      reason: matches.length > 0 ? 'legacy_delete_purge_confirmed' : 'no_confirmed_delete_audit'
    };
  } catch (error) {
    return { ok: false, reliable: false, reason: 'legacy_deletion_audit_read_failed:' + channelGateSafeError_(error) };
  }
}

function channelGateLegacyParticipantClassification_(userId) {
  if (typeof reliableDeletionEnrollmentEvidence_ !== 'function' ||
      typeof participantRowById_ !== 'function' ||
      typeof COLS === 'undefined' || !COLS.PARTICIPANTS) {
    return { ok: false, reason: 'core_legacy_classification_api_unavailable' };
  }
  let evidence;
  try { evidence = reliableDeletionEnrollmentEvidence_(String(userId)); }
  catch (error) { return { ok: false, reason: 'enrollment_evidence_read_failed:' + channelGateSafeError_(error) }; }
  if (!evidence || evidence.ok !== true) {
    return { ok: false, reason: evidence && evidence.reason ? String(evidence.reason) : 'enrollment_evidence_unresolved' };
  }
  if (!evidence.participantExists) return { ok: true, participantExists: false, reliableEnrollment: false };

  let found;
  try { found = participantRowById_(String(userId)); }
  catch (error) { return { ok: false, reason: 'participant_row_read_failed:' + channelGateSafeError_(error) }; }
  if (!found || !found.row) return { ok: false, reason: 'participant_row_missing_after_evidence' };

  const row = found.row;
  const consent = String(row[COLS.PARTICIPANTS.CONSENT_STATUS] || '');
  const windowStatus = String(row[COLS.PARTICIPANTS.WINDOW_STATUS] || '');
  if (evidence.reliable === true) {
    if (windowStatus === 'ENDED_21_CALENDAR_DAYS') return { ok: true, participantExists: true, reliableEnrollment: true, legacyClass: 'CLASS_5_COMPLETED_WINDOW', desiredState: CHANNEL_GATE.ELIGIBILITY_STATE.ENROLLED };
    if (windowStatus === 'EARLY_STOP') return { ok: true, participantExists: true, reliableEnrollment: true, legacyClass: 'CLASS_6_EARLY_STOP', desiredState: CHANNEL_GATE.ELIGIBILITY_STATE.ENROLLED };
    if (!windowStatus || windowStatus === 'ACTIVE') return { ok: true, participantExists: true, reliableEnrollment: true, legacyClass: 'CLASS_4_DURABLY_ENROLLED_CURRENT', desiredState: CHANNEL_GATE.ELIGIBILITY_STATE.ENROLLED };
    return { ok: false, reason: 'legacy_window_status_unrecognized:' + windowStatus };
  }
  if (consent === 'DECLINED') return { ok: true, participantExists: true, reliableEnrollment: false, legacyClass: 'CLASS_3_DECLINED_PRE_ENROLLMENT', desiredState: '' };
  if (consent === 'CONSENTED') return { ok: true, participantExists: true, reliableEnrollment: false, legacyClass: 'CLASS_2_PRECONSENT_OR_SETUP_ONLY', desiredState: '' };
  return { ok: true, participantExists: true, reliableEnrollment: false, legacyClass: 'CLASS_2_PRECONSENT_OR_SETUP_ONLY', desiredState: '' };
}

function channelGateClassifyLegacyUser_(userId, lock) {
  if (!channelGateAssertHeldLock_(lock, 'legacy_classify')) return { ok: false, reason: 'lock_required' };
  if (!channelGatePositiveIntegerLike_(userId)) return { ok: false, reason: 'invalid_user_id' };
  const config = channelGateEligibilityConfig_();
  if (!config.ok) return { ok: false, reason: config.reason };
  const accessRef = channelGateMigrationAccessRef_(userId, config);

  const eligibility = channelGateReadEligibility_(userId, lock);
  if (!eligibility.ok) return { ok: false, accessRef: accessRef, reason: eligibility.reason };
  if (eligibility.exists) {
    return {
      ok: true, accessRef: accessRef, legacyClass: 'ALREADY_MIGRATED',
      desiredState: eligibility.state, generation: eligibility.generation, writeRequired: false
    };
  }

  const participant = channelGateLegacyParticipantClassification_(userId);
  if (!participant.ok) {
    return { ok: true, accessRef: accessRef, legacyClass: 'CLASS_8_AMBIGUOUS', desiredState: '', writeRequired: false, reason: participant.reason };
  }
  if (participant.participantExists) {
    return {
      ok: true, accessRef: accessRef, legacyClass: participant.legacyClass,
      desiredState: participant.desiredState || '', generation: participant.desiredState ? 1 : 0,
      writeRequired: !!participant.desiredState
    };
  }

  const deleted = channelGateLegacyDeletedAuditEvidence_(userId);
  if (!deleted.ok) {
    return { ok: true, accessRef: accessRef, legacyClass: 'CLASS_8_AMBIGUOUS', desiredState: '', writeRequired: false, reason: deleted.reason };
  }
  if (deleted.reliable) {
    return {
      ok: true, accessRef: accessRef, legacyClass: 'CLASS_7_CONFIRMED_DELETED',
      desiredState: CHANNEL_GATE.ELIGIBILITY_STATE.LOCKED, generation: 1, writeRequired: true,
      bridgeEvidenceCount: deleted.matchCount
    };
  }

  const membership = channelGateLegacyMembershipVerified_(userId);
  if (!membership.ok) {
    return { ok: true, accessRef: accessRef, legacyClass: 'CLASS_8_AMBIGUOUS', desiredState: '', writeRequired: false, reason: membership.reason };
  }
  if (membership.verified) {
    return { ok: true, accessRef: accessRef, legacyClass: 'CLASS_1_MEMBERSHIP_VERIFIED_ONLY', desiredState: '', writeRequired: false };
  }

  return {
    ok: true, accessRef: accessRef, legacyClass: 'CLASS_8_AMBIGUOUS',
    desiredState: '', writeRequired: false, reason: 'no_reconstructable_legacy_evidence'
  };
}

function channelGateMigrationCandidateUserIds_() {
  const ids = {};
  if (typeof getParticipantsSheet_ !== 'function' || typeof readRows_ !== 'function' ||
      typeof COLS === 'undefined' || !COLS.PARTICIPANTS) {
    return { ok: false, reason: 'participants_inventory_api_unavailable' };
  }
  try {
    readRows_(getParticipantsSheet_()).forEach(function(row) {
      const id = String(row[COLS.PARTICIPANTS.ID] || '').trim();
      if (channelGatePositiveIntegerLike_(id)) ids[id] = true;
    });
    const props = PropertiesService.getScriptProperties();
    const raw = String(props.getProperty(CHANNEL_GATE.MIGRATION_CANDIDATE_USER_IDS_PROPERTY) || '');
    raw.split(/[\s,;]+/).forEach(function(id) {
      const normalized = String(id || '').trim();
      if (channelGatePositiveIntegerLike_(normalized)) ids[normalized] = true;
    });
    return { ok: true, ids: Object.keys(ids).sort() };
  } catch (error) {
    return { ok: false, reason: 'migration_candidate_inventory_failed:' + channelGateSafeError_(error) };
  }
}

function channelGateMigrationPlan_(lock) {
  if (!channelGateAssertHeldLock_(lock, 'migration_plan')) return { ok: false, reason: 'lock_required' };
  const candidates = channelGateMigrationCandidateUserIds_();
  if (!candidates.ok) return candidates;
  const items = [];
  const counts = {};
  let unresolved = 0;
  candidates.ids.forEach(function(userId) {
    const classified = channelGateClassifyLegacyUser_(userId, lock);
    if (!classified.ok) {
      unresolved++;
      items.push({ accessRef: '', legacyClass: 'CLASS_8_AMBIGUOUS', desiredState: '', writeRequired: false, reason: classified.reason || 'classification_failed' });
      return;
    }
    counts[classified.legacyClass] = (counts[classified.legacyClass] || 0) + 1;
    if (classified.legacyClass === 'CLASS_8_AMBIGUOUS') unresolved++;
    items.push({
      accessRef: classified.accessRef,
      legacyClass: classified.legacyClass,
      desiredState: classified.desiredState || '',
      generation: Number(classified.generation || 0),
      writeRequired: classified.writeRequired === true,
      reason: classified.reason || '',
      bridgeEvidenceCount: Number(classified.bridgeEvidenceCount || 0)
    });
  });
  items.sort(function(a, b) { return String(a.accessRef).localeCompare(String(b.accessRef)); });

  let unlinkedMembershipCacheKeyCount = 0;
  try {
    const all = PropertiesService.getScriptProperties().getProperties();
    Object.keys(all).forEach(function(key) {
      if (String(key).indexOf(CHANNEL_GATE.MEMBERSHIP_STORAGE_PREFIX) === 0 &&
          String(all[key]) === CHANNEL_GATE.MEMBERSHIP_VERIFIED_VALUE) unlinkedMembershipCacheKeyCount++;
    });
  } catch (error) {
    return { ok: false, reason: 'membership_cache_inventory_failed:' + channelGateSafeError_(error) };
  }

  const canonical = JSON.stringify({
    migrationVersion: CHANNEL_GATE.MIGRATION_VERSION,
    eligibilityKeyVersion: CHANNEL_GATE.ELIGIBILITY_IDENTITY_KEY_VERSION,
    items: items
  });
  const dryRunHash = channelGateSha256Hex_(canonical);
  return {
    ok: true,
    migrationVersion: CHANNEL_GATE.MIGRATION_VERSION,
    eligibilityKeyVersion: CHANNEL_GATE.ELIGIBILITY_IDENTITY_KEY_VERSION,
    candidateCount: items.length,
    counts: counts,
    unresolvedCount: unresolved,
    unlinkedMembershipCacheKeyCount: unlinkedMembershipCacheKeyCount,
    dryRunHash: dryRunHash,
    items: items
  };
}

function dryRunEligibilityMigrationOnce_() {
  return channelGateWithOperatorScriptLock_(function(lock) {
    const plan = channelGateMigrationPlan_(lock);
    if (!plan.ok) throw new Error('ELIGIBILITY_MIGRATION_DRY_RUN_FAILED:' + plan.reason);
    return plan;
  });
}

function applyEligibilityMigrationOnce_() {
  return channelGateWithOperatorScriptLock_(function(lock) {
    const plan = channelGateMigrationPlan_(lock);
    if (!plan.ok) throw new Error('ELIGIBILITY_MIGRATION_PLAN_FAILED:' + plan.reason);
    const props = PropertiesService.getScriptProperties();
    const approved = String(props.getProperty(CHANNEL_GATE.MIGRATION_APPROVED_DRY_RUN_HASH_PROPERTY) || '').trim().toLowerCase();
    if (!approved || approved !== String(plan.dryRunHash).toLowerCase()) {
      throw new Error('ELIGIBILITY_MIGRATION_DRY_RUN_APPROVAL_REQUIRED');
    }

    let writes = 0;
    let verified = 0;
    const failures = [];
    plan.items.forEach(function(item) {
      if (!item.writeRequired) return;
      // Recover the raw candidate only in-memory by matching the access ref.
      const candidates = channelGateMigrationCandidateUserIds_();
      if (!candidates.ok) { failures.push({ accessRef: item.accessRef, reason: candidates.reason }); return; }
      const config = channelGateEligibilityConfig_();
      const userId = candidates.ids.find(function(id) { return channelGateMigrationAccessRef_(id, config) === item.accessRef; });
      if (!userId) { failures.push({ accessRef: item.accessRef, reason: 'candidate_identity_not_recoverable' }); return; }

      const current = channelGateReadEligibility_(userId, lock);
      if (!current.ok) { failures.push({ accessRef: item.accessRef, reason: current.reason }); return; }
      if (current.exists) {
        if (current.state === item.desiredState && current.generation === item.generation) verified++;
        else failures.push({ accessRef: item.accessRef, reason: 'existing_lifetime_state_conflict' });
        return;
      }
      writes++;
      if (!channelGateWriteEligibilityState_(userId, item.desiredState, item.generation, lock)) {
        failures.push({ accessRef: item.accessRef, reason: 'lifetime_write_failed' });
        return;
      }
      const check = channelGateReadEligibility_(userId, lock);
      if (!check.ok || !check.exists || check.state !== item.desiredState || check.generation !== item.generation) {
        failures.push({ accessRef: item.accessRef, reason: 'lifetime_write_verification_failed' });
        return;
      }
      verified++;
    });

    if (failures.length) {
      throw new Error('ELIGIBILITY_MIGRATION_PARTIAL_FAILURE:' + JSON.stringify(failures));
    }
    props.deleteProperty(CHANNEL_GATE.MIGRATION_APPROVED_DRY_RUN_HASH_PROPERTY);
    props.deleteProperty(CHANNEL_GATE.MIGRATION_CANDIDATE_USER_IDS_PROPERTY);
    return {
      ok: true,
      dryRunHash: plan.dryRunHash,
      writesAttempted: writes,
      writesVerified: verified,
      ambiguousUnchanged: plan.unresolvedCount,
      membershipCachePreserved: true
    };
  });
}

function channelGateEligibilityKeyCustodyFingerprint_() {
  const config = channelGateEligibilityConfig_();
  if (!config.ok) return { ok: false, reason: config.reason };
  return {
    ok: true,
    keyVersion: config.keyVersion,
    pepperLength: String(config.pepper).length,
    custodyFingerprint: channelGateSha256Hex_('scb-eligibility-custody-v1|' + String(config.keyVersion) + '|' + String(config.pepper)).slice(0, 16)
  };
}

function inspectEligibilityKeyCustodyOnce_() {
  return channelGateWithOperatorScriptLock_(function(lock) {
    const out = channelGateEligibilityKeyCustodyFingerprint_();
    if (!out.ok) throw new Error('ELIGIBILITY_KEY_CUSTODY_INVALID:' + out.reason);
    return out;
  });
}

function channelGateEligibilityBackupPayload_() {
  const config = channelGateEligibilityConfig_();
  if (!config.ok) return { ok: false, reason: config.reason };
  const custody = channelGateEligibilityKeyCustodyFingerprint_();
  if (!custody.ok) return { ok: false, reason: custody.reason };
  try {
    const all = PropertiesService.getScriptProperties().getProperties();
    const records = [];
    Object.keys(all).sort().forEach(function(key) {
      if (String(key).indexOf(CHANNEL_GATE.ELIGIBILITY_STORAGE_PREFIX) === 0 ||
          String(key).indexOf(CHANNEL_GATE.REENTRY_GRANT_STORAGE_PREFIX) === 0) {
        records.push({ key: String(key), value: String(all[key]) });
      }
    });
    const base = {
      formatVersion: CHANNEL_GATE.BACKUP_FORMAT_VERSION,
      channelGateVersion: CHANNEL_GATE.VERSION,
      eligibilityKeyVersion: custody.keyVersion,
      custodyFingerprint: custody.custodyFingerprint,
      createdAt: new Date().toISOString(),
      records: records
    };
    const baseCanonical = JSON.stringify(base);
    const integrityMac = channelGateHmacSha256Hex_(CHANNEL_GATE.BACKUP_INTEGRITY_CONTEXT + baseCanonical, config.pepper);
    const manifest = {
      formatVersion: base.formatVersion,
      channelGateVersion: base.channelGateVersion,
      eligibilityKeyVersion: base.eligibilityKeyVersion,
      custodyFingerprint: base.custodyFingerprint,
      createdAt: base.createdAt,
      records: base.records,
      integrityMac: integrityMac
    };
    const canonical = JSON.stringify(manifest);
    return { ok: true, manifest: manifest, sha256: channelGateSha256Hex_(canonical), canonical: canonical };
  } catch (error) {
    return { ok: false, reason: 'eligibility_backup_snapshot_failed:' + channelGateSafeError_(error) };
  }
}

function createEligibilityRegistryBackupOnce_() {
  return channelGateWithOperatorScriptLock_(function(lock) {
    if (typeof DriveApp === 'undefined' || typeof DriveApp.createFile !== 'function') {
      throw new Error('ELIGIBILITY_BACKUP_DRIVE_UNAVAILABLE');
    }
    const payload = channelGateEligibilityBackupPayload_();
    if (!payload.ok) throw new Error('ELIGIBILITY_BACKUP_FAILED:' + payload.reason);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const name = 'SCB_ELIGIBILITY_BACKUP_' + stamp + '_' + payload.sha256.slice(0, 12) + '.json';
    const file = DriveApp.createFile(name, payload.canonical, 'application/json');
    if (!file || typeof file.setSharing !== 'function' ||
        !DriveApp.Access || !DriveApp.Permission || DriveApp.Access.PRIVATE === undefined) {
      throw new Error('ELIGIBILITY_BACKUP_PRIVATE_SHARING_API_UNAVAILABLE');
    }
    file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.VIEW);
    if (typeof file.getSharingAccess === 'function' && file.getSharingAccess() !== DriveApp.Access.PRIVATE) {
      throw new Error('ELIGIBILITY_BACKUP_PRIVATE_SHARING_UNCONFIRMED');
    }
    return {
      ok: true,
      fileId: String(file.getId()),
      name: name,
      sha256: payload.sha256,
      recordCount: payload.manifest.records.length,
      eligibilityKeyVersion: payload.manifest.eligibilityKeyVersion,
      custodyFingerprint: payload.manifest.custodyFingerprint
    };
  });
}

function restoreEligibilityRegistryBackupOnce_() {
  return channelGateWithOperatorScriptLock_(function(lock) {
    if (typeof DriveApp === 'undefined' || typeof DriveApp.getFileById !== 'function') {
      throw new Error('ELIGIBILITY_RESTORE_DRIVE_UNAVAILABLE');
    }
    const props = PropertiesService.getScriptProperties();
    const fileId = String(props.getProperty(CHANNEL_GATE.RESTORE_BACKUP_FILE_ID_PROPERTY) || '').trim();
    if (!fileId) throw new Error('ELIGIBILITY_RESTORE_FILE_ID_REQUIRED');

    let raw;
    try { raw = String(DriveApp.getFileById(fileId).getBlob().getDataAsString('UTF-8')); }
    catch (error) { throw new Error('ELIGIBILITY_RESTORE_FILE_READ_FAILED'); }
    let manifest;
    try { manifest = JSON.parse(raw); }
    catch (error) { throw new Error('ELIGIBILITY_RESTORE_JSON_INVALID'); }
    if (!manifest || String(manifest.formatVersion || '') !== CHANNEL_GATE.BACKUP_FORMAT_VERSION || !Array.isArray(manifest.records)) {
      throw new Error('ELIGIBILITY_RESTORE_FORMAT_INVALID');
    }
    const custody = channelGateEligibilityKeyCustodyFingerprint_();
    if (!custody.ok) throw new Error('ELIGIBILITY_RESTORE_KEY_INVALID:' + custody.reason);
    if (String(manifest.eligibilityKeyVersion || '') !== String(custody.keyVersion) ||
        String(manifest.custodyFingerprint || '') !== String(custody.custodyFingerprint)) {
      throw new Error('ELIGIBILITY_RESTORE_KEY_MISMATCH');
    }
    const config = channelGateEligibilityConfig_();
    if (!config.ok) throw new Error('ELIGIBILITY_RESTORE_KEY_INVALID:' + config.reason);
    const integrityBase = {
      formatVersion: String(manifest.formatVersion || ''),
      channelGateVersion: String(manifest.channelGateVersion || ''),
      eligibilityKeyVersion: String(manifest.eligibilityKeyVersion || ''),
      custodyFingerprint: String(manifest.custodyFingerprint || ''),
      createdAt: String(manifest.createdAt || ''),
      records: manifest.records
    };
    const expectedMac = channelGateHmacSha256Hex_(CHANNEL_GATE.BACKUP_INTEGRITY_CONTEXT + JSON.stringify(integrityBase), config.pepper);
    if (!channelGateConstantTimeEqual_(expectedMac, String(manifest.integrityMac || '').toLowerCase())) {
      throw new Error('ELIGIBILITY_RESTORE_INTEGRITY_FAILED');
    }

    const seen = {};
    let restored = 0;
    let alreadyPresent = 0;
    manifest.records.forEach(function(record) {
      const key = String(record && record.key || '');
      const value = String(record && record.value || '');
      if (!key || seen[key]) throw new Error('ELIGIBILITY_RESTORE_DUPLICATE_OR_EMPTY_KEY');
      seen[key] = true;

      if (key.indexOf(CHANNEL_GATE.ELIGIBILITY_STORAGE_PREFIX) === 0) {
        const digest = key.slice(CHANNEL_GATE.ELIGIBILITY_STORAGE_PREFIX.length);
        if (!/^[0-9a-f]{64}$/.test(digest)) throw new Error('ELIGIBILITY_RESTORE_KEY_INVALID');
        const parsed = channelGateParseEligibilityRecord_(value);
        if (!parsed.ok || !parsed.exists) throw new Error('ELIGIBILITY_RESTORE_RECORD_INVALID');
      } else if (key.indexOf(CHANNEL_GATE.REENTRY_GRANT_STORAGE_PREFIX) === 0) {
        const digest = key.slice(CHANNEL_GATE.REENTRY_GRANT_STORAGE_PREFIX.length);
        const parsed = channelGateParseGrantRecord_(value, digest);
        if (!parsed.ok || !parsed.exists) throw new Error('ELIGIBILITY_RESTORE_GRANT_INVALID');
      } else {
        throw new Error('ELIGIBILITY_RESTORE_PREFIX_INVALID');
      }

      const existing = props.getProperty(key);
      if (existing !== null && existing !== undefined && String(existing) !== '') {
        if (String(existing) !== value) throw new Error('ELIGIBILITY_RESTORE_CONFLICT');
        alreadyPresent++;
        return;
      }
      const capacity = channelGateCapacityAllowsWrite_(key, value);
      if (!capacity.ok) throw new Error('ELIGIBILITY_RESTORE_CAPACITY_BLOCKED');
      props.setProperty(key, value);
      if (String(props.getProperty(key) || '') !== value) throw new Error('ELIGIBILITY_RESTORE_VERIFY_FAILED');
      restored++;
    });
    props.deleteProperty(CHANNEL_GATE.RESTORE_BACKUP_FILE_ID_PROPERTY);
    return { ok: true, restored: restored, alreadyPresent: alreadyPresent, recordCount: manifest.records.length };
  });
}

/**
 * Delete only the current required-channel membership cache. Lifetime eligibility
 * is intentionally untouched.
 */
function channelGateForgetMembership_(userId, lock) {
  if (!channelGateAssertHeldLock_(lock, 'forget_membership')) return false;
  if (!channelGatePositiveIntegerLike_(userId)) return false;
  const channel = channelGateReadRequiredChannel_();
  if (!channel.ok) return false;
  try {
    const props = PropertiesService.getScriptProperties();
    const key = channelGateStorageKey_(channel.identity, userId);
    props.deleteProperty(key);
    return String(props.getProperty(key) || '') === '';
  } catch (error) {
    channelGateLog_('CHANNEL_GATE_MEMBERSHIP_DELETE_EXCEPTION', { message: channelGateSafeError_(error) });
    return false;
  }
}

// PE04: the legacy one-argument channelGateForget_ compatibility wrapper was
// removed. R21 deletion uses only explicit lock-aware membership/lifetime APIs.
// PE05 adds grant state separately; deletion never calls a generic grant/lifetime forget API.

function channelGateParseVerifyCallback_(callbackData) {
  if (callbackData === null || callbackData === undefined || callbackData === '') {
    return { isGateCallback: false, valid: false, reason: '' };
  }
  const raw = String(callbackData);
  if (raw === CHANNEL_GATE.VERIFY_ACTION) {
    return { isGateCallback: true, valid: false, reason: 'unbound_verify_callback' };
  }
  if (raw.indexOf(CHANNEL_GATE.VERIFY_ACTION + ':') !== 0) {
    return { isGateCallback: false, valid: false, reason: '' };
  }
  const userId = raw.slice((CHANNEL_GATE.VERIFY_ACTION + ':').length);
  if (!channelGatePositiveIntegerLike_(userId)) {
    return { isGateCallback: true, valid: false, reason: 'malformed_user_binding' };
  }
  return { isGateCallback: true, valid: true, boundUserId: userId, reason: '' };
}

function channelGateVerifyCallbackData_(userId) {
  const data = CHANNEL_GATE.VERIFY_ACTION + ':' + String(userId);
  if (data.length > 64) throw new Error('CHANNEL_GATE_CALLBACK_TOO_LONG');
  return data;
}

/**
 * Telegram membership authority. BOT_TOKEN is read only when a real
 * getChatMember call is required; verified/locked/retiring hot paths do not read
 * it for membership qualification.
 */
function channelGateFetchMembership_(channelIdentity, userId) {
  let token;
  try {
    token = String(PropertiesService.getScriptProperties().getProperty(CHANNEL_GATE.BOT_TOKEN_PROPERTY) || '').trim();
  } catch (error) {
    return { kind: 'technical', reason: 'bot_token_read_failed' };
  }
  if (!token || token === 'YOUR_BOT_TOKEN_HERE') {
    return { kind: 'technical', reason: 'bot_token_missing' };
  }

  let response;
  try {
    response = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/getChatMember', {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ chat_id: channelIdentity, user_id: Number(userId) }),
      muteHttpExceptions: true
    });
  } catch (error) {
    return { kind: 'technical', reason: 'network_exception', detail: channelGateSafeError_(error) };
  }

  const api = channelGateTelegramApiResponse_(response);
  if (api.httpStatus < 200 || api.httpStatus >= 300) {
    return { kind: 'technical', reason: 'telegram_http_' + api.httpStatus };
  }
  if (api.parseError) return { kind: 'technical', reason: 'telegram_malformed_json' };
  if (!api.ok) return { kind: 'technical', reason: 'telegram_ok_false' };

  const result = api.result;
  if (!result || typeof result !== 'object' || typeof result.status !== 'string') {
    return { kind: 'technical', reason: 'membership_result_malformed' };
  }
  if (!result.user || !channelGatePositiveIntegerLike_(result.user.id) || String(result.user.id) !== String(userId)) {
    return { kind: 'technical', reason: 'membership_user_mismatch' };
  }

  const status = String(result.status);
  if (status === 'creator' || status === 'administrator' || status === 'member') {
    return { kind: 'member', status: status };
  }
  if (status === 'restricted') {
    if (result.is_member === true) return { kind: 'member', status: status };
    if (result.is_member === false) return { kind: 'nonmember', status: status };
    return { kind: 'technical', reason: 'restricted_membership_malformed', status: status };
  }
  if (status === 'left' || status === 'kicked') {
    return { kind: 'nonmember', status: status };
  }

  return { kind: 'technical', reason: 'unknown_membership_status', status: status };
}

function channelGateTelegramApiResponse_(response) {
  if (typeof telegramApiResponse_ === 'function') return telegramApiResponse_(response);

  const status = response && response.getResponseCode ? response.getResponseCode() : 0;
  let body = null;
  let parseError = false;
  try { body = JSON.parse(response.getContentText()); }
  catch (error) { parseError = true; }
  return {
    httpStatus: status,
    parseError: parseError,
    ok: !!(body && body.ok === true),
    result: body ? body.result : undefined,
    errorCode: body && body.error_code !== undefined ? body.error_code : null,
    description: body && typeof body.description === 'string' ? body.description : ''
  };
}

function channelGatePersistVerification_(storageKey) {
  try {
    const props = PropertiesService.getScriptProperties();
    const capacity = channelGateCapacityAllowsWrite_(storageKey, CHANNEL_GATE.MEMBERSHIP_VERIFIED_VALUE);
    if (!capacity.ok) return false;
    props.setProperty(storageKey, CHANNEL_GATE.MEMBERSHIP_VERIFIED_VALUE);
    return String(props.getProperty(storageKey) || '') === CHANNEL_GATE.MEMBERSHIP_VERIFIED_VALUE;
  } catch (error) {
    channelGateLog_('CHANNEL_GATE_PERSISTENCE_EXCEPTION', { message: channelGateSafeError_(error) });
    return false;
  }
}

function channelGateSendJoinPrompt_(chatId, userId, channel) {
  const keyboard = [[
    { text: 'Join Channel', url: channel.joinUrl }
  ], [
    { text: '✓ I\'ve Joined', callback_data: channelGateVerifyCallbackData_(userId) }
  ]];
  return channelGateSendText_(CHANNEL_GATE.NONMEMBER_TEXT, chatId, keyboard);
}

function channelGateSendTechnicalFailure_(chatId, channel, userId) {
  let keyboard = null;
  if (channel && channel.ok) {
    keyboard = [[
      { text: 'Join Channel', url: channel.joinUrl }
    ], [
      { text: '✓ I\'ve Joined', callback_data: channelGateVerifyCallbackData_(userId) }
    ]];
  }
  return channelGateSendText_(CHANNEL_GATE.TECHNICAL_FAILURE_TEXT, chatId, keyboard);
}

function channelGateSendText_(text, chatId, keyboard) {
  if (typeof sendTelegram_ !== 'function') {
    channelGateLog_('CHANNEL_GATE_SEND_HELPER_UNAVAILABLE', {});
    return false;
  }
  try {
    const result=sendTelegramDetailed_(text,chatId,keyboard||null);
    if(typeof scbGateDeliveryState_!=='undefined')
      scbGateDeliveryState_=result.ok?'CONFIRMED':(result.unknown?'UNKNOWN':'FAILED');
    return !!result.ok;
  } catch(error) {
    if(typeof scbGateDeliveryState_!=='undefined')scbGateDeliveryState_='UNKNOWN';
    channelGateLog_('CHANNEL_GATE_SEND_EXCEPTION', { message: channelGateSafeError_(error) });
    return false;
  }
}

function channelGateAckBlockedCallback_(envelope) {
  if (!envelope || !envelope.callbackQueryId) return false;
  if (typeof answerCallbackQuery_ !== 'function') return false;
  try { return answerCallbackQuery_(envelope.callbackQueryId); }
  catch (error) {
    channelGateLog_('CHANNEL_GATE_CALLBACK_ACK_EXCEPTION', { message: channelGateSafeError_(error) });
    return false;
  }
}

function channelGateConvertVerifyCallbackToStart_(envelope) {
  // The gate callback is fully consumed here. R21 receives a normal /start
  // message, never CHANNEL_VERIFY, so no gate action can enter its state machine.
  envelope.callbackData = null;
  envelope.callbackQueryId = null;
  envelope.text = '/start';
}

function channelGateSafeError_(error) {
  if (typeof safeErrorMessage_ === 'function') {
    try { return safeErrorMessage_(error); } catch (ignored) {}
  }
  return error && error.message ? String(error.message).slice(0, 160) : 'unknown_error';
}

function channelGateLog_(eventName, fields) {
  if (typeof log_ !== 'function') return;
  try { log_(eventName, fields || {}); } catch (ignored) {}
}
