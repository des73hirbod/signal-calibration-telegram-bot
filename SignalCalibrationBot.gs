/*
* Decision-gate test (see F14/F-B2 below for the full, corrected description):
* /gate -> GATE_CANDIDATE -> GATE_CLAIM -> (specific assertion: optional
*     GATE_COMMITMENT -> GATE_FEASIBILITY | absent/uncertain: finishCandidateGate_)
*     -> (feasible yes: finishCandidateGate_ dispatch | no/not sure:
*     GATE_SMALLER_ACTION -> finishCandidateGate_ dispatch). GATE_TYPE is retired
*     from the new live flow and remains only as legacy compatibility code.
*     finishCandidateGate_ loops for candidate 2, compares only when both candidates
*     qualify, otherwise routes directly to FOCAL_SELECTION. Gate
*     records are stored inside §10's `other_claims` payload field; no score/ranking
*     is computed.
* Lifecycle:
* P06 setup lifecycle: /start -> consent disclosure -> neutral consent-comprehension
*     confirmation/clarification -> consent decision -> validated participant-local
*     IANA timezone -> READY. Setup actions are version-bound outside STATES; no
*     day-dependent session exists until consent and timezone writes verify. F34 CHANGE NOTE
*     (Round 3, audit F-B1-1, MINOR): this hop was previously undocumented
*     here even though it was already correctly described in prose at F29's
*     own change-control note; this diagram line closes that gap. Comment-
*     only, matching this diagram's existing level of detail for other
*     entry points (see "Standalone safety entry points" below).
* READY -> ACUTE -> (yes: ACUTE_EXIT [terminal] | no: RECOVERY)
* RECOVERY -> (yes: RECOVERY_EXIT [terminal] | no: CANDIDATE)
* CANDIDATE -> the rebuilt candidate-identification / decision-gate / focal-selection flow.
*     A prior focal Signal is context only; it never bypasses the morning gate.
*     Re-selecting the same focal Signal means the gate ran again and the same choice resolved.
* PRESERVE -> COMPLETE [terminal], via completeWithNewSignal_, which appends the focal
*     Signal to SignalHistory only if this session hasn't already recorded one (idempotency guard).
*
* Standalone safety entry points, independent of the READY chain above:
* /acute (consented) -> ACUTE_EXIT [terminal], direct, skips the ACUTE question.
* /recovery (consented) -> RECOVERY_EXIT [terminal], direct, skips the RECOVERY question.
*
* F59 (Prompt 3 design note, approved) — Layer-transition reflection entry,
* independent of every state above: /reflect is gated by
* participant.layerCheckpointFlag (Participants sheet, operator-set only via
* openConfiguredLayerReflectionCheckpoint -> openLayerReflectionCheckpoint_; no participant command opens it). Not a
* STATE, not part of handleStateInput_'s dispatch. When open, /reflect asks
* one uncoached free-text question and the participant's next NON-COMMAND
* message is captured by handleReflectionAnswerIfAwaiting_. Slash commands
* are explicitly excluded so safety, help, data-control, and session commands
* remain routable while the reflection checkpoint is awaiting text. Stored on Participants
* (layer_transition_reflection), not Sessions — see the design note for why
* this is a participant-level artifact, not a §10 per-day field. See
* recordLayerTransitionReflection_ and openLayerReflectionCheckpoint_ for
* the write paths, and migrateParticipantsAddLayerReflectionColumns_ for
* the one-time column migration this fix requires on a pre-F59 sheet.
*
* Gate test entry (see F14 below):
* /gate (consented) -> startDecisionGateTest_ -> GATE_CANDIDATE. This is a SECOND,
*     independent entry point into the same GATE_CANDIDATE/GATE_CLAIM/optional-
*     GATE_COMMITMENT/GATE_FEASIBILITY/GATE_SMALLER_ACTION/[conditional GATE_COMPARE]/
*     FOCAL_SELECTION chain the morning CANDIDATE flow uses via CANDIDATE_ONE/CANDIDATE_TWO —
*     it is NOT an isolated test track. It shares live states and transition logic
*     with the main flow. A user who typed /gate and a user in the ordinary morning
*     flow can both be sitting in, e.g., GATE_COMMITMENT at the same version at the
*     same time; this is intentional (one shared state machine, not one shared
*     session — each has its own sessionId and payload).
*
* Review entry:
* /review -> startReview_ checks isMinimalReviewState_ on the latest day-session:
*     if a focal Signal exists (and the prior session isn't ACUTE_EXIT/RECOVERY_EXIT
*     or one of the low-signal morning outcomes) -> REVIEW_Q1, proceeding through
*     the ordered REVIEW_Q1 -> REVIEW_Q2 -> ... -> REVIEW_Q10 sequence, then to
*     COMPLETE [terminal] via either REVIEW_Q10 exit (free-text adjustment, or
*     the Skip button).
*     if no focal Signal exists (or isMinimalReviewState_ otherwise applies) ->
*     REVIEW_MINIMAL, a single-step state offering only a "Close review" action
*     that also transitions directly to COMPLETE.
* NOTE (see F13/F16 for history): SESSION_COMPLETE has been retired from
*     STATES entirely. COMPLETE is the sole terminal state for both the
*     morning and review flows.
* NOTE: no render-time defensive fallback for a mid-session-missing focal Signal
*     exists in this build (verified by grep: no focal_signal-truthiness check
*     gates a REVIEW_* -> CANDIDATE transition anywhere in the file).
*     If /delete-data races a REVIEW session in progress, REVIEW_Q1..Q10 render
*     unconditionally from the session's stored focal_signal payload value; a
*     racing delete does not throw, but nothing currently re-checks Signal
*     existence at REVIEW render time either. Flagged here rather than under a
*     separate fix-pack item since it surfaced directly while correcting F2.
* F46 NOTE (Round 5, Section G fix pack, fixes audit finding G2): REVIEW_Q2
*     through REVIEW_Q9 have no rubber-stamping detection — a participant
*     selecting the most agreeable-sounding option at every step (e.g.
*     always "Reasonable given what was known" / "As expected" / "No") hits
*     zero friction and zero downstream consequence, same as the old
*     single-question review. This is a considered omission, not a gap:
*     master doc §21 bans streaks, completion-percentage-as-success, and
*     hidden composite scores, and the design principles ban punitive
*     mechanisms and anything risking guilt or compulsive tracking. A live
*     in-form pattern-flag would be structurally a nudge toward answer
*     *variance*, which is not more valid than answer *consistency* — a
*     genuinely well-calibrated, consistent participant would trigger it
*     identically to a disengaged one, risking exactly the "teaching the
*     user to fill out a form" failure mode §22's central quality-control
*     question warns against. Each REVIEW_Q answer is stored in its own
*     distinct payload field (evening_decision_quality,
*     capacity_description, context_change, deliberate_transition,
*     attention_moved_away, outcome_description — see the review handlers and
*     createSession_'s REVIEW payload
*     initialization), not collapsed into a score, so rubber-stamping
*     remains fully detectable by a human reviewer post-hoc per §16/§17's
*     analysis protocol without needing a live mechanism that would itself
*     violate the anti-gamification/anti-punitive principles above.
*     Comment-only; no code change and no retesting required — this note
*     exists so a future reader doesn't have to re-derive this judgment
*     from scratch.
*
* F52 NOTE (Round 5, Section H fix pack, formal resolution of audit finding
*     H3 — test coverage): no automated, reviewable test suite is committed
*     alongside this file. Node-vm-sandbox harnesses are cited throughout
*     F20/F28/F29/F30/F31's change-control notes with specific assertion
*     counts, but exist only as a description of work done, not as
*     executable artifacts in this repository/uploads. RECOMMENDATION,
*     stated explicitly per H3's instruction rather than left as a repeated
*     open caveat: ACCEPTABLE AS-IS for this project's current phase — a
*     5-8 participant formative usability pilot (master doc §14/§15) with
*     no efficacy claims, no production SLA, and (per this round's H1
*     finding, ~86.7% comment-accuracy hit rate) a project whose existing
*     lightweight verification mechanism is already showing the kind of
*     drift a second, heavier mechanism would only compound if it received
*     the same level of upkeep. Committing the harnesses to a companion
*     repo is not recommended as a blocking requirement at this scale;
*     revisit if the project moves past formative testing into the
*     unsupervised 21-day version, or gains a second maintainer, since a
*     committed suite earns its maintenance cost once inline comments alone
*     can no longer keep multiple people/sessions synchronized.
*     In place of a full suite, the minimal viable addition per H3's own
*     "avoid unnecessary complexity" standard: the invariant checklist
*     below, a plain-language (not executable) list of what the Node-vm
*     harnesses have actually been checking, for an operator or future
*     reviewer to manually re-verify against the live bot during the
*     formative testing this project IS currently ready for:
*     1. Exactly one SignalHistory row is appended per completed session
*        that reaches COMPLETE via a real focal Signal (completeWithNewSignal_'s
*        hasSignalForSession_ guard) — never zero, never more than one.
*     2. A lock-serialized double-tap replay of the same callback never
*        produces a duplicate SignalHistory row, scheduled_items entry, or
*        later_items entry (F30/F31's harness (d), F20's OPEN gap notes the
*        one case this does NOT cover — see F20's own note for the residual
*        risk still open).
*     3. day-stamping agrees between createSession_ and
*        getLatestSessionForProjectDay_ for the same participant at the same
*        instant (both must resolve to the same PROJECT_DAY via
*        getParticipantTimezone_ — see F50's note on why this is currently a
*        duplicated-logic guarantee, not a shared-helper one).
*     4. A completed /gate walkthrough writes SOURCE_STATE = 'F2_GATE_TEST',
*        never STATES.PRESERVE, and is excluded/flagged when
*        exportParticipantData_ output is filtered by SOURCE_STATE (F42/M1).
*     5. A non-allowlisted (TESTER_USER_IDS) consented participant cannot
*        reach GATE_CANDIDATE via /gate by any path (F42/M1).
*     6. The FOCAL_NEITHER/FOCAL_CANT_COMPARE/FOCAL_NO_SIGNAL/FOCAL_UNCERTAIN
*        branches reach COMPLETE with focal_signal = null and write NO
*        SignalHistory row (F30's guard-scope decision).
*     7. Every free-text-accepting state (9 total, see F20/F47) suppresses an
*        exact-match or case/whitespace-only-variant resubmission without
*        transitioning or pushing a duplicate other_claims record.
*     8. validateSheetSchema_ throws SCHEMA_HEADER_MISMATCH (not just
*        SCHEMA_COLUMN_COUNT_MISMATCH) on a same-arity column swap, and
*        classifyProcessingError_ correctly classifies that throw as
*        schema_corruption (F36/F37).
*     9. migrateParticipantsAddTimezoneColumn_ and migrateHeaderRow_ are each
*        safe to run twice in a row with no duplicate columns/headers and no
*        error on the second run (K2 — see that finding's own trace for
*        detail beyond this checklist's summary level).
*
* F53 NOTE (Round 5, Section H fix pack, formal severity rating for audit
*     finding H1/H4 — audit-trail reliability): this round sampled 15
*     "Retested: YES" / "Retesting: NO — comment-only" claims beyond Round
*     4's original 3 (F19, F28, and one other). 13/15 (86.7%) were confirmed
*     accurate against the current code by direct trace/grep. 2/15 were
*     confirmed stale — both were the same class of error (a miscounted
*     call-site number: F47's "7 call sites" for isLikelyDuplicateFreeText_
*     should have been 9; F44's "7 call sites" for createSession_, repeated
*     in two separate comment blocks, should have been 6), corrected this
*     round as F49. Per this pack's own H4 threshold (below ~90% is at least
*     MAJOR for evidentiary reliability): SEVERITY = MAJOR. This does not
*     mean the underlying fixes described by the stale comments were wrong
*     — in both cases the fix itself, its scope, and its reasoning were
*     independently confirmed correct; only a supporting numeric claim was
*     off. But a MAJOR rating is warranted regardless, because the failure
*     mode is exactly the one Round 4's Finding 3 first surfaced (a claim a
*     future reader cannot re-derive without redoing the trace from
*     scratch) recurring twice more at a slightly larger sample, which is
*     evidence about the trend, not just the individual instances. See H3's
*     note above for the connection to this round's test-coverage
*     recommendation: tightening this existing mechanism's verification
*     discipline (grep-checking count claims before writing them, exactly
*     how F49's errors were caught) is judged higher-value right now than
*     building a second, parallel evidentiary mechanism from scratch.
*/
// P06 supersedes the former F29 four-US-zone/Eastern-fallback behavior.
// Historical F29 comments described an earlier implementation and are not current policy.
// P06 — participant-local timezone policy (DQ-002). There is no silent
// fallback timezone. Any valid IANA timezone is accepted, including UTC.
// These buttons are convenience examples only; participants may type any
// valid IANA zone such as Europe/Paris or Australia/Perth.
const COMMON_TIMEZONE_CHOICES = Object.freeze([
  { label: 'UTC', zone: 'UTC' },
  { label: 'Tehran', zone: 'Asia/Tehran' },
  { label: 'New York', zone: 'America/New_York' },
  { label: 'London', zone: 'Europe/London' },
  { label: 'Tokyo', zone: 'Asia/Tokyo' }
]);
const SETUP_PROTOCOL_VERSION = 'SCB_SETUP_V1';
const SETUP_STEP = Object.freeze({
  CONSENT_COMPREHENSION:'CONSENT_COMPREHENSION',
  CONSENT_DECISION:'CONSENT_DECISION',
  TIMEZONE:'TIMEZONE',
  COMPLETE:'COMPLETE',
  DECLINED:'DECLINED'
});
// Explicit reviewed pre-consent command allowlist. Safety commands /acute and
// /recovery are handled before this list so they remain reachable without
// consent. /timezone is intentionally post-consent because it changes the
// participant-local day boundary only after a valid consent record exists.
const preConsentCommands = Object.freeze(['/start','/help','/privacy','/delete-data','/decline']);
// F36 CHANGE NOTE (Round 2 follow-up, Hirbod chose Option B over F32's note
// above the STATES declaration — see that note for the full option
// comparison this decision was made against): ROWS.FIRST_DATA is now 2, not
// 1. Row 1 is a header row (see HEADERS below); data starts at row 2. This
// reverses the prior headerless design specifically to close the
// column-identity-drift gap F32 documented: an operator manually swapping
// two same-arity columns is now visible as a mismatch between the sheet's
// actual header cells and HEADERS, checked at every validateSheetSchema_
// call (i.e. every readRows_ call), not just detected after the fact.
const ROWS = Object.freeze({
  FIRST_DATA: 2
});
// F36: HEADERS is derived from COLS itself (each sheet's own keys, in COLS
// order, COUNT excluded) rather than hand-typed as a separate parallel list
// — a second, independently-maintained list of column names is exactly the
// kind of drift-prone duplication F32 was about, so this avoids introducing
// a new instance of the same problem while fixing the old one. See
// headerLabelsFor_ below, and validateSheetSchema_'s use of it.
function headerLabelsFor_(colsForSheet) {
  return Object.keys(colsForSheet)
    .filter(key => key !== 'COUNT')
    .sort((a, b) => colsForSheet[a] - colsForSheet[b]);
}
const EXPORT_TTL_MS = 15 * 60 * 1000;
const EXPORT_EXPIRY_PROPERTY = 'EXPIRING_EXPORT_FILES';
// Every sheet read/write below uses this map; indexes are zero-based data-array indexes.
const COLS = Object.freeze({
  // F59: LAYER_CHECKPOINT_FLAG and LAYER_TRANSITION_REFLECTION added,
  // additive, at the end of the existing 8-column layout. See the F59
  // change-control note (near the /reflect command implementation) for the
  // full rationale, migration requirement, and what these two fields hold.
  PARTICIPANTS: Object.freeze({
    ID: 0, TELEGRAM_USER_ID: 1, TELEGRAM_CHAT_ID: 2, CONSENT_STATUS: 3,    CONSENTED_AT: 4, CREATED_AT: 5, UPDATED_AT: 6, TIMEZONE: 7,    LAYER_CHECKPOINT_FLAG: 8, LAYER_TRANSITION_REFLECTION: 9, RUN_REF: 10, PARTICIPANT_ROLE: 11, ENROLLED_PROJECT_DAY: 12, WINDOW_STATUS: 13, COUNT: 14
  }),  SESSIONS: Object.freeze({
    SESSION_ID: 0, PARTICIPANT_ID: 1, PROJECT_DAY: 2, STATE: 3,    STATE_VERSION: 4, STARTED_AT: 5, UPDATED_AT: 6, COMPLETED_AT: 7,    ACTIVITY_STATUS: 8, PAYLOAD: 9, RUN_REF: 10, COUNT: 11
  }),  EVENTS: Object.freeze({
    EVENT_ID: 0, PARTICIPANT_ID: 1, SESSION_ID: 2, CORRELATION_ID: 3,    EVENT_TYPE: 4, DETAILS: 5, OCCURRED_AT: 6, RUN_REF: 7, COUNT: 8
  }),  // IDEMPOTENCY.USER_ID stores the raw Telegram user ID. This is compared directly
  // against participant.id elsewhere in this file (see deleteParticipant_), which is
  // safe only because participant.id is defined as String(telegramUserId) and is never
  // reassigned after creation (see getOrCreateParticipant_). If a future change
  // introduces a separate internal participant ID scheme, this equivalence breaks
  // silently — /delete-data would stop matching Idempotency rows with no error.
  IDEMPOTENCY: Object.freeze({
    UPDATE_ID: 0, USER_ID: 1, PROCESSED_AT: 2, OPERATION_ID: 3, PROCESSING_STATUS: 4, RESULT: 5, UPDATED_AT: 6, COUNT: 7
  }),  SIGNAL_HISTORY: Object.freeze({
    PARTICIPANT_ID: 0, SIGNAL_TEXT: 1, SET_AT: 2, SESSION_ID: 3,    SOURCE_STATE: 4, OPERATION_ID: 5, RUN_REF: 6, COUNT: 7
  }),  OPERATIONS: Object.freeze({
    OPERATION_ID: 0, CORRELATION_ID: 1, UPDATE_ID: 2, USER_ID: 3, PARTICIPANT_ID: 4,
    SESSION_ID: 5, OPERATION_TYPE: 6, STATUS: 7, STAGE: 8, ARTIFACT_REFS: 9,
    SEND_STATUS: 10, ERROR_CLASS: 11, STARTED_AT: 12, UPDATED_AT: 13, RUN_REF: 14, COUNT: 15
  }),  CORRUPTION_QUARANTINE: Object.freeze({
    QUARANTINE_ID: 0, SHEET_NAME: 1, ROW_NUMBER: 2, RECORD_ID: 3, FIELD_NAME: 4,
    RAW_VALUE: 5, RAW_FINGERPRINT: 6, DETECTED_AT: 7, STATUS: 8, RECONCILED_AT: 9, COUNT: 10
  }),  MIGRATION_LOG: Object.freeze({
    MIGRATION_ID: 0, SCHEMA_FROM: 1, SCHEMA_TO: 2, BACKUP_REF: 3, DRY_RUN_HASH: 4,
    STATUS: 5, DETAILS: 6, STARTED_AT: 7, COMPLETED_AT: 8, COUNT: 9
  }),
  SETUP_HISTORY: Object.freeze({
    RECORD_ID: 0, PARTICIPANT_ID: 1, SETUP_VERSION: 2, STEP: 3, ACTION: 4,
    STATUS: 5, DETAILS: 6, OCCURRED_AT: 7, OPERATION_ID: 8, COUNT: 9
  }),
  CONSENT_HISTORY: Object.freeze({
    RECORD_ID: 0, PARTICIPANT_ID: 1, SETUP_VERSION: 2, COMPREHENSION_STATUS: 3,
    CONSENT_DECISION: 4, OCCURRED_AT: 5, OPERATION_ID: 6, COUNT: 7
  }),
  TIMEZONE_HISTORY: Object.freeze({
    RECORD_ID: 0, PARTICIPANT_ID: 1, TIMEZONE: 2, EFFECTIVE_FROM: 3, EFFECTIVE_TO: 4,
    SOURCE: 5, SETUP_VERSION: 6, OPERATION_ID: 7, COUNT: 8
  }),
  DATA_CONTROL_REQUESTS: Object.freeze({
    REQUEST_ID: 0, PARTICIPANT_ID: 1, ACTION: 2, STATUS: 3, CREATED_AT: 4,
    EXPIRES_AT: 5, OPERATION_ID: 6, COUNT: 7
  }),
  DATA_CONTROL_AUDIT: Object.freeze({
    AUDIT_ID: 0, PARTICIPANT_FINGERPRINT: 1, ACTION: 2, OUTCOME: 3,
    RESIDUAL_COUNT: 4, ACCESS_MECHANISM: 5, EXPIRY_TARGET: 6,
    EXPIRY_CONFIRMED: 7, CLEANUP_STATUS: 8, RECONCILIATION_STATUS: 9,
    UPDATE_FINGERPRINT: 10, OCCURRED_AT: 11, COUNT: 12
  }),
  CALIBRATION_CYCLES: Object.freeze({
    CYCLE_ID: 0, PARTICIPANT_ID: 1, PROJECT_DAY: 2, RUN_REF: 3,
    MORNING_SESSION_ID: 4, DAILY_FOCUS_STATE: 5, REVIEW_SESSION_ID: 6,
    LIFECYCLE_STATUS: 7, MISSINGNESS_CAUSE: 8, CREATED_AT: 9,
    MORNING_COMPLETED_AT: 10, REVIEW_STARTED_AT: 11, REVIEW_COMPLETED_AT: 12,
    UPDATED_AT: 13, OPERATION_ID: 14, COUNT: 15
  }),
  LEARNING_RECORDS: Object.freeze({
    LEARNING_ID: 0, CYCLE_ID: 1, PARTICIPANT_ID: 2, REVIEW_SESSION_ID: 3,
    STATUS: 4, PARTICIPANT_TEXT: 5, RECORDED_AT: 6, OPERATION_ID: 7, RUN_REF: 8, COUNT: 9
  }),
  ADJUSTMENT_PLANS: Object.freeze({
    ADJUSTMENT_ID: 0, LINEAGE_ID: 1, CYCLE_ID: 2, PARTICIPANT_ID: 3,
    SOURCE_REVIEW_SESSION_ID: 4, VERSION: 5, PLAN_TEXT: 6, STATUS: 7,
    SOURCE_PROJECT_DAY: 8, CREATED_AT: 9, UPDATED_AT: 10,
    EXPOSURE_STATUS: 11, EXPOSURE_ATTEMPTED_AT: 12, DELIVERY_STATUS: 13,
    RESPONSE: 14, RESPONDED_AT: 15, SUPERSEDES_ADJUSTMENT_ID: 16,
    OPERATION_ID: 17, RUN_REF: 18, COUNT: 19
  }),
  STUDY_RUNS: Object.freeze({
    RUN_ID:0, STAGE:1, COHORT:2, DEFAULT_PARTICIPANT_ROLE:3, BUILD_ID:4,
    SOURCE_HASH:5, DEPLOYMENT_REF:6, MASTER_VERSION:7, PROTOCOL_VERSION:8,
    FORM_VERSION:9, INTERFACE_VERSION:10, SCHEMA_VERSION:11, MIGRATION_VERSION:12,
    CONFIG_FINGERPRINT:13, TEACHING_VERSION:14, OPERATOR_ROSTER_REF:15,
    STARTED_AT:16, ENDED_AT:17, CLOSURE_STATUS:18, CREATED_AT:19, COUNT:20
  }),
  TEACHING_EXPOSURE: Object.freeze({
    EXPOSURE_ID:0, RUN_REF:1, PARTICIPANT_ID:2, SESSION_ID:3, CHANNEL:4,
    CONTENT_VERSION:5, INVOKED_AT:6, DELIVERY_STATUS:7, OPERATION_ID:8, COUNT:9
  }),
  LAYER_DECISIONS: Object.freeze({
    DECISION_ID:0, PARTICIPANT_ID:1, RUN_REF:2, ASSIGNMENT:3, LAYER_ENTRY:4, LAYER_EXIT:5,
    EFFECTIVE_FROM:6, EFFECTIVE_TO:7, EVIDENCE_SNAPSHOT_REF:8, INCLUDED_CYCLE_IDS:9,
    EXCLUDED_CYCLE_ADJUDICATIONS:10, USABLE_DAY_ADJUDICATIONS:11, CANDIDATE_PATTERNS:12,
    SELECTED_TARGET_PATTERN:13, DECISION_OUTCOME:14, RATIONALE:15, ANALYST_REF:16,
    REVIEWER_REF:17, OWNER_AUTHORIZATION_REF:18, DECIDED_AT:19, VERSION:20,
    SUPERSEDES_DECISION_ID:21, STATUS:22, COUNT:23
  }),
  INTERVENTION_EPISODES: Object.freeze({
    EPISODE_ID:0, PARTICIPANT_ID:1, RUN_REF:2, LAYER_DECISION_ID:3, TARGET_PATTERN:4,
    MECHANISM_ID:5, MECHANISM_VERSION:6, INSTRUCTION_VERSION:7, EFFECTIVE_FROM:8,
    EFFECTIVE_TO:9, STATUS:10, ASSIGNED_AT:11, EXPOSURE_STATUS:12, EXPOSURE_AT:13,
    ADHERENCE_STATUS:14, ADHERENCE_AT:15, TARGET_CONTACT_STATUS:16, TARGET_CONTACT_AT:17,
    SUSPENDED_AT:18, SUSPENSION_REASON:19, RESUMED_AT:20, ENDED_AT:21, END_REASON:22,
    CONCURRENT_SUPPORTS:23, DEVIATIONS:24, SUPERSEDES_EPISODE_ID:25, CREATED_AT:26,
    UPDATED_AT:27, COUNT:28
  }),
  TRANSFER_EPISODES: Object.freeze({
    TRANSFER_ID:0, PARTICIPANT_ID:1, RUN_REF:2, MODE_VERSION:3, STATUS:4,
    ACTIVATED_AT:5, ENDED_AT:6, REDUCED_EXPOSURE_STATUS:7, FULL_SCAFFOLD_REQUESTS:8,
    MISSING_RESPONSE_STATUS:9, SAFETY_EXIT_STATUS:10, CREATED_AT:11, UPDATED_AT:12, COUNT:13
  }),
  EVIDENCE_OBSERVATIONS: Object.freeze({
    OBSERVATION_ID:0, RUN_REF:1, PARTICIPANT_ID:2, SESSION_ID:3, CYCLE_ID:4,
    INSTRUMENT_ID:5, INSTRUMENT_VERSION:6, FORM_ID:7, CONTACT:8, ITEM_ID:9,
    PHENOMENON:10, SOURCE_TYPE:11, INDEPENDENCE_CLASS:12, RESPONSE_CODE:13,
    ADJUDICATION:14, RUBRIC_VERSION:15, OUTCOME_KNOWLEDGE:16, SHARED_TAXONOMY:17,
    OPERATOR_REF:18, MISSINGNESS_CAUSE:19, OBSERVED_AT:20, OPERATION_ID:21, COUNT:22
  }),
  EVIDENCE_ASSESSMENTS: Object.freeze({
    ASSESSMENT_ID:0, RUN_REF:1, PARTICIPANT_ID:2, PHENOMENON:3, EVIDENCE_REFS:4,
    ALTERNATIVE_FLAGS:5, SUFFICIENCY_CLASS:6, REVIEWER_REF:7, RUBRIC_VERSION:8,
    OUTCOME_KNOWLEDGE:9, CREATED_AT:10, OPERATION_ID:11, COUNT:12
  })
});
// R14 typed project-day persistence contract.
// Google Sheets may coerce a yyyy-MM-dd string into a date-typed cell. Project-day
// fields are identifiers, not timestamps. They must therefore persist and round-trip
// as canonical text across every entity that owns one.
const PROJECT_DAY_COLUMNS = Object.freeze({
  Participants: Object.freeze([COLS.PARTICIPANTS.ENROLLED_PROJECT_DAY]),
  Sessions: Object.freeze([COLS.SESSIONS.PROJECT_DAY]),
  CalibrationCycles: Object.freeze([COLS.CALIBRATION_CYCLES.PROJECT_DAY]),
  AdjustmentPlans: Object.freeze([COLS.ADJUSTMENT_PLANS.SOURCE_PROJECT_DAY])
});
// Code-only pre-launch remediation: participant-authored text that is stored
// directly in a Sheet cell must be forced to plain text before the value is
// written. Otherwise a leading '=' is interpreted by Google Sheets as a
// formula, changing the participant's exact answer and executing spreadsheet
// semantics. JSON payload fields are not included because their cell value
// begins with JSON syntax rather than participant text.
const PARTICIPANT_PLAIN_TEXT_COLUMNS = Object.freeze({
  SignalHistory: Object.freeze([COLS.SIGNAL_HISTORY.SIGNAL_TEXT]),
  LearningRecords: Object.freeze([COLS.LEARNING_RECORDS.PARTICIPANT_TEXT]),
  AdjustmentPlans: Object.freeze([COLS.ADJUSTMENT_PLANS.PLAN_TEXT])
});
function prepareParticipantPlainTextFormat_(sheet,row,startCol,rowCount,width) {
  const cols=PARTICIPANT_PLAIN_TEXT_COLUMNS[sheet.getName()]||[];
  cols.forEach(zeroIndex=>{
    const one=zeroIndex+1;
    if(one<startCol||one>=startCol+width) return;
    const range=sheet.getRange(row,one,rowCount,1);
    if(range && typeof range.setNumberFormat==='function') range.setNumberFormat('@');
  });
}
function isCanonicalProjectDayKey_(value) {
  const s=String(value==null?'':value).trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const parts=s.split('-').map(Number), d=new Date(Date.UTC(parts[0],parts[1]-1,parts[2]));
  return d.getUTCFullYear()===parts[0] && d.getUTCMonth()===parts[1]-1 && d.getUTCDate()===parts[2];
}
function spreadsheetTimezone_() {
  try { const ss=getSpreadsheet_(); if(ss && typeof ss.getSpreadsheetTimeZone==='function') return String(ss.getSpreadsheetTimeZone()||'Etc/UTC'); } catch(e) {}
  return 'Etc/UTC';
}
function canonicalProjectDayKey_(value, displayValue) {
  const display=String(displayValue==null?'':displayValue).trim();
  if(isCanonicalProjectDayKey_(display)) return display;
  const raw=String(value==null?'':value).trim();
  if(isCanonicalProjectDayKey_(raw)) return raw;
  if(Object.prototype.toString.call(value)==='[object Date]' && Number.isFinite(value.getTime())) {
    try { const out=Utilities.formatDate(value,spreadsheetTimezone_(),'yyyy-MM-dd'); if(isCanonicalProjectDayKey_(out)) return out; } catch(e) {}
  }
  return '';
}
function canonicalProjectDayKeyOrThrow_(value, label, displayValue) {
  const out=canonicalProjectDayKey_(value,displayValue);
  if(!out && String(value==null?'':value).trim()) throw new Error('INVALID_PROJECT_DAY_KEY:' + String(label||'unknown'));
  return out;
}
function compareProjectDayKeys_(a,b,label) {
  const aa=canonicalProjectDayKeyOrThrow_(a,String(label||'compare')+':left');
  const bb=canonicalProjectDayKeyOrThrow_(b,String(label||'compare')+':right');
  if(!aa||!bb) throw new Error('PROJECT_DAY_KEY_REQUIRED:' + String(label||'compare'));
  return aa<bb?-1:(aa>bb?1:0);
}
function projectDayDistance_(fromDay,toDay,label) {
  const a=canonicalProjectDayKeyOrThrow_(fromDay,String(label||'distance')+':from');
  const b=canonicalProjectDayKeyOrThrow_(toDay,String(label||'distance')+':to');
  if(!a||!b) throw new Error('PROJECT_DAY_KEY_REQUIRED:' + String(label||'distance'));
  const am=Date.parse(a+'T00:00:00Z'), bm=Date.parse(b+'T00:00:00Z');
  if(!Number.isFinite(am)||!Number.isFinite(bm)) throw new Error('INVALID_PROJECT_DAY_DISTANCE:' + String(label||'distance'));
  return Math.floor((bm-am)/86400000);
}
function normalizedProjectDayWriteValues_(sheetName,startCol,values) {
  const cols=PROJECT_DAY_COLUMNS[sheetName]||[];
  if(!cols.length||!values||!values.length) return values;
  const out=values.map(row=>row.slice());
  cols.forEach(zeroIndex=>{
    const one=zeroIndex+1, offset=one-startCol;
    if(offset<0) return;
    out.forEach((row,i)=>{
      if(offset>=row.length) return;
      const v=row[offset]; if(v===''||v==null) return;
      row[offset]=canonicalProjectDayKeyOrThrow_(v,sheetName+':row'+i+':col'+one);
    });
  });
  return out;
}
function prepareProjectDayTextFormat_(sheet,row,startCol,rowCount,width) {
  const cols=PROJECT_DAY_COLUMNS[sheet.getName()]||[];
  cols.forEach(zeroIndex=>{
    const one=zeroIndex+1;
    if(one<startCol||one>=startCol+width) return;
    const range=sheet.getRange(row,one,rowCount,1);
    if(range && typeof range.setNumberFormat==='function') range.setNumberFormat('@');
  });
}

// F36: HEADERS holds each sheet's header-row label array, keyed the same way
// validateSheetSchema_'s existing expectedColumns lookup is keyed (by
// sheet.getName()). Built from COLS via headerLabelsFor_ so there is exactly
// one source of truth for column meaning, order, and count — this file's own
// original design intent for COLS, now extended to cover header text too.
const HEADERS = Object.freeze({
  Participants: Object.freeze(headerLabelsFor_(COLS.PARTICIPANTS)),
  Sessions: Object.freeze(headerLabelsFor_(COLS.SESSIONS)),
  Events: Object.freeze(headerLabelsFor_(COLS.EVENTS)),
  Idempotency: Object.freeze(headerLabelsFor_(COLS.IDEMPOTENCY)),
  SignalHistory: Object.freeze(headerLabelsFor_(COLS.SIGNAL_HISTORY)),
  Operations: Object.freeze(headerLabelsFor_(COLS.OPERATIONS)),
  CorruptionQuarantine: Object.freeze(headerLabelsFor_(COLS.CORRUPTION_QUARANTINE)),
  MigrationLog: Object.freeze(headerLabelsFor_(COLS.MIGRATION_LOG)),
  SetupHistory: Object.freeze(headerLabelsFor_(COLS.SETUP_HISTORY)),
  ConsentHistory: Object.freeze(headerLabelsFor_(COLS.CONSENT_HISTORY)),
  TimezoneHistory: Object.freeze(headerLabelsFor_(COLS.TIMEZONE_HISTORY)),
  DataControlRequests: Object.freeze(headerLabelsFor_(COLS.DATA_CONTROL_REQUESTS)),
  DataControlAudit: Object.freeze(headerLabelsFor_(COLS.DATA_CONTROL_AUDIT)),
  CalibrationCycles: Object.freeze(headerLabelsFor_(COLS.CALIBRATION_CYCLES)),
  LearningRecords: Object.freeze(headerLabelsFor_(COLS.LEARNING_RECORDS)),
  AdjustmentPlans: Object.freeze(headerLabelsFor_(COLS.ADJUSTMENT_PLANS)),
  StudyRuns: Object.freeze(headerLabelsFor_(COLS.STUDY_RUNS)),
  TeachingExposure: Object.freeze(headerLabelsFor_(COLS.TEACHING_EXPOSURE)),
  LayerDecisions: Object.freeze(headerLabelsFor_(COLS.LAYER_DECISIONS)),
  InterventionEpisodes: Object.freeze(headerLabelsFor_(COLS.INTERVENTION_EPISODES)),
  TransferEpisodes: Object.freeze(headerLabelsFor_(COLS.TRANSFER_EPISODES)),
  EvidenceObservations: Object.freeze(headerLabelsFor_(COLS.EVIDENCE_OBSERVATIONS)),
  EvidenceAssessments: Object.freeze(headerLabelsFor_(COLS.EVIDENCE_ASSESSMENTS))
});

// P04 storage-control versions. These are prospective technical versions only;
// they are never backfilled onto historical rows or represented as historical deployment metadata.
const SCB_STORAGE_SCHEMA_VERSION = 'SCB_SCHEMA_V10';
const SCB_STORAGE_MIGRATION_VERSION = 'SCB_MIGRATION_V10';
const STORAGE_SCHEMA_PROPERTY = 'SCB_STORAGE_SCHEMA_VERSION';
const STORAGE_MIGRATION_PROPERTY = 'SCB_STORAGE_MIGRATION_VERSION';
const OPERATION_STATUS = Object.freeze({ PENDING:'PENDING', COMMITTED:'COMMITTED', FAILED:'FAILED', RECONCILED:'RECONCILED' });
const IDEMPOTENCY_STATUS = Object.freeze({ PROCESSING:'PROCESSING', COMMITTED:'COMMITTED', FAILED:'FAILED', RECONCILIATION_REQUIRED:'RECONCILIATION_REQUIRED', RECONCILED:'RECONCILED' });
const QUARANTINE_STATUS = Object.freeze({ OPEN:'OPEN', RECONCILED:'RECONCILED' });
let currentOperationContext_ = null;
// PE03 — non-persistent reference to the exact ScriptLock already held by doPost().
// Enrollment access-control writes must reuse this object; they must never acquire
// a second ScriptLock inside the participant/session call graph.
let currentScriptLockContext_ = null;
function currentHeldScriptLock_() {
  const lock = currentScriptLockContext_;
  if (!lock || typeof lock.hasLock !== 'function' || lock.hasLock() !== true) {
    throw new Error('SCRIPT_LOCK_CONTEXT_REQUIRED');
  }
  return lock;
}

// FINAL-INSTRUMENT NOTE — evening item 8 is optional participant-authored
// interpretation, not an authoritative scientific error diagnosis and no longer
// exposes the prior Signal Calibration mechanism/error label taxonomy in new V3
// sessions. Free text is stored as participant-authored interpretation in the
// existing qualitative_interpretation contract plus participant_interpretation_text
// under SCB_REVIEW_TRACE_V3. No counts/rates/scores/pattern detection are computed;
// scientific adjudication remains researcher-side and separate from this report.
//
// F7 CHANGE NOTE — Later construct (v0.3): a minimal parking/revisit
// mechanism for valuable non-focal items (payload.later_items). Never
// auto-promotes, auto-schedules, or creates reminders; /later is read-only
// display. ⚠️ KNOWN GAP, still open: no mechanism exists for a user to bring
// a displayed Later item back into the CANDIDATE flow — they must re-type
// it from scratch. Bring-back mechanism design deliberately deferred as a
// separate decision, not added speculatively in a bug-fix pass.
//
// F8 CHANGE NOTE — Forced-certainty audit (v0.3): the rebuilt flow must not
// force unsupported certainty. Gate questions expose "not sure"; focal
// selection exposes "can't compare"/"uncertain"; evening free-text items
// have skip affordances where optional. No new scoring introduced.
//
// F9 CHANGE-CONTROL — v0.3 architecture correction backfill. Date:
// 2026-08-15.
// CHANGE 1 (F4): Standing Signal -> daily focal Signal. Prior-day Signal is
// now contextual only; each morning re-derives today's focal Signal via
// candidate-identification -> decision-gate -> focal-selection.
// SignalHistory stays append-only. Fixes the old keep-without-gate path
// (A4). Retested: YES, full regression of /start, gate routing, focal
// selection, history writes.
// CHANGE 2 (F5): Evening review restructure. Replaced the single-question
// review with the ordered 10-item sequence; decision quality is now
// recorded separately from, and before, outcome (A2/A7). Retested: YES,
// full regression of REVIEW state machine and its fields.
// F1–F8 implement the Section A correction pack; no scores, streaks,
// completion metrics, time tracking, or other §7/§21 omissions introduced.
//
// F10 CHANGE-CONTROL — renderState_ dead-code removal (Section A fix pack,
// F1). Date: 2026-08-15. Removed a duplicate, unreachable block in
// renderState_ handling the five REVIEW_* states by referencing `input`/
// `payload` — variables scoped to handleStateInput_, not renderState_,
// which threw ReferenceError immediately. This meant every /review command
// with a focal Signal crashed on first render — the entire F9 CHANGE-2
// evening rebuild was unreachable in production. Retested: YES, manual
// click-through of /review confirming all five states render correctly.
//
// F11 CHANGE-CONTROL — /later crash fix + F7 comment correction (Section A
// fix pack, F4). Date: 2026-08-15. /later called
// getLatestSessionForChat_(chatId), a function never defined anywhere in
// the file — guaranteed crash on every invocation. Replaced with
// getLatestSessionWithLaterItems_(participantId). Also corrected the F7
// comment above, which wrongly claimed a candidate-identification
// bring-back mechanism already existed (it doesn't — see F7's open gap
// note). Retested: YES, /later with and without prior later_items, no
// crash, correct display in both cases.
//
// F12 CHANGE-CONTROL — dead schema fields resolved (Section A fix pack,
// F3). Date: 2026-08-15. (a) focal_smaller_action, declared in §10 but
// never written, is now populated in FOCAL_SELECTION whenever the winning
// Signal resolved via a smaller-action branch; null otherwise. Retested:
// YES, both single- and two-candidate smaller-action paths. (b)
// midday_event, also declared but unwritten, is deliberately left
// unimplemented in the schema — §10 names it but no other section defines
// a form step for it, and inventing that scope was out of bounds for this
// fix. Its schema comment now says so plainly; comment-only, no retest.
//
// F13 CHANGE-CONTROL — header "Review entry" comment corrected (Section A fix
// pack, F2). Date: 2026-08-15. The header's "Review entry:" block described a
// stale REVIEW -> (REVIEW_STAYED | REVIEW_NOISE | REVIEW_UNSURE) ->
// SESSION_COMPLETE design that no longer exists in code; rewritten to match
// startReview_'s actual logic (isMinimalReviewState_ -> REVIEW_Q1 or
// REVIEW_MINIMAL, both terminating at COMPLETE). Two inaccuracies in the
// fix-pack's own suggested replacement text were caught and corrected rather
// than carried forward (source_state REVIEW_NO_SIGNAL doesn't exist; no
// render-time defensive fallback for a missing focal Signal exists either —
// both verified by grep). Comment-only change, no retesting required.
//
// F14 CHANGE-CONTROL — /gate lifecycle doc gap corrected (Section B fix pack,
// F-B1). Date: 2026-08-15. Header lifecycle diagram never mentioned /gate as
// an entry point, despite startDecisionGateTest_ creating a live session
// directly in GATE_CANDIDATE and sharing all downstream states/transitions
// with the morning CANDIDATE flow. Added an explicit "Gate test entry" block
// stating this. Comment-only, no retesting required.
//
// F15 CHANGE-CONTROL — /gate exit-path doc corrected + candidate_path gap
// fixed (Section B fix pack, F-B2). Date: 2026-08-15.
// Part A (doc): corrected the header's /gate summary, which wrongly claimed
// GATE_FEASIBILITY's branches terminate directly at COMPLETE — both actually
// route through finishCandidateGate_'s three-way dispatch, same as the
// morning flow.
// Part B (code): startDecisionGateTest_ never set payload.candidate_path, so
// finishCandidateGate_'s two_competing checks were always false for
// /gate-originated sessions — the second-candidate loop-back and
// GATE_COMPARE were structurally unreachable from /gate. Fixed by extending
// /gate to accept an optional argument: "/gate two" (or "/gate 2") pre-seeds
// candidate_path as 'two_competing'; bare "/gate"/"/gate one" keeps prior
// single-candidate behavior unchanged. startDecisionGateTest_'s signature
// changed to take the raw command text as a second parameter.
// Retested: manual walkthrough of "/gate"/"/gate one" (unchanged
// single-candidate path) and "/gate two" (full two-candidate chain reaching
// GATE_COMPARE then FOCAL_SELECTION).
//
// F16 CHANGE-CONTROL — SESSION_COMPLETE header self-contradiction resolved by
// retiring the dead enum value (Section B fix pack, F-B3, Option 1). Date:
// 2026-08-15. Removed STATES.SESSION_COMPLETE from STATES/TERMINAL_STATES and
// the now-redundant defensive check in renderState_'s COMPLETE branch.
// Decision: chose Option 1 (retire) over Option 2 (implement the distinction
// by retargeting REVIEW exits to SESSION_COMPLETE) since nothing in the
// project currently reads the STATE column to separate morning- from
// review-complete, and source_state already carries enough info to derive
// that distinction later if ever needed — retiring forecloses nothing.
// Retesting: NO, pure removal of an already-dead value (grep-verified).
//
// F17 CHANGE-CONTROL — dead ASSESSMENT/FOCAL states removed (Section B fix
// pack, F-B4). Date: 2026-08-15. Removed ASSESSMENT/FOCAL from STATES and
// IN_PROGRESS_EDIT_STATES — vestigial from the pre-F9 architecture, never
// targeted by createSession_/transitionSession_. Retested via full
// morning-flow + REVIEW walkthrough (automated harness): PASS.
//
// F18 CHANGE-CONTROL — dead bare-STATES.REVIEW branch removed from
// renderState_ (Section B fix pack, F-B5). Date: 2026-08-15. Simplified
// renderState_'s check to `STATES.REVIEW_Q1` only and removed REVIEW from
// STATES (no createSession_/transitionSession_ call ever targeted bare
// REVIEW). Also corrected an adjacent doc-comment wrongly describing a
// "REVIEW defensive-redirect branch" that doesn't exist — every renderState_
// branch calls sendTelegram_ directly. Retested via the same harness as F17:
// PASS, REVIEW_Q1 renders identically to before.
//
// F19 CHANGE-CONTROL — missing chatId argument fixed in the GATE_COMPARE
// free-text fallback (Section B fix pack, F-B6). Date: 2026-08-15.
// handleStateInput_'s GATE_COMPARE branch was calling sendTelegram_ with
// chatId undefined, silently swallowing the reply for any user who typed
// free text instead of tapping a button. Fixed to pass chatId. Retested:
// PASS, message now delivered.
// ⚠️ RESOLVED (Round 5, FIX-3, closes Round 4 Finding 3): the
// FOCAL_SELECTION empty-input fallback's missing-chatId bug flagged below as
// "not yet picked up" is fixed. Confirmed by grep of every sendTelegram_
// call site touching FOCAL_SELECTION's free-text branch (handleStateInput_,
// ~line 2091): sendTelegram_('Please use one of the focal outcomes
// above.', chatId) correctly passes chatId, which is in scope as
// handleStateInput_'s third parameter. This was not fixed by a dedicated
// change targeting this flag — F20's change-control note (immediately
// below) records it as fixed "opportunistically," most likely an incidental
// side effect of the same restructuring pass that added F20's duplicate-
// suppression logic or F31's later PRESERVE-branch rework, not a change
// that cited this F19 flag as its motivation. A future reader hitting this
// same question can re-run this grep against handleStateInput_'s
// FOCAL_SELECTION branch rather than re-deriving it from scratch.
//
// F20 CHANGE-CONTROL — duplicate-resubmission suppression added to free-text
// input handling (Section B fix pack, F-B8). Date: 2026-08-16.
// What changed: handleStateInput_'s nine free-text-accepting branches
// (REVIEW_Q1, REVIEW_Q5_NOTE, REVIEW_Q6_NOTE, REVIEW_Q9, REVIEW_Q10,
// GATE_CANDIDATE, GATE_CLAIM, GATE_SMALLER_ACTION, PRESERVE) now call a new
// isLikelyDuplicateFreeText_(previousValue, incomingText) helper before
// transitioning; an exact-match (post-trim) resubmission re-renders the
// current state instead of transitioning again. GATE_CANDIDATE compares
// against the candidate text already recorded at the current
// gate_current_index slot, since that state pushes a new other_claims
// record rather than patching a field. Also fixed opportunistically: the
// FOCAL_SELECTION empty-input fallback's missing chatId (same bug F19
// flagged as out-of-scope elsewhere).
// Why: unlike button input, free-text input had no staleness/duplicate
// check at all — relevant to the free-text-resubmission race C4 raises for
// PRESERVE (client retry, double-tap), but present identically in all nine
// free-text states.
//
// CURRENT STATUS (post-F20 follow-up): the formerly open cross-state replay
// gap is now closed in executable code. handleStateInput_ records the
// normalized non-command free text together with the stateVersion that
// accepted it; after a transition, a lock-serialized repeat carrying the
// same normalized text is rejected before state-specific dispatch when the
// stored version differs from the current stateVersion. The original
// same-state helper remains in place for repeated submissions that do not
// advance state. This is replay suppression, not a claim of Telegram-level
// exactly-once delivery. Manual live click-through remains outside static
// source verification.
//
// F21 CHANGE-CONTROL — CANDIDATE-stage silent-supersession scope decision
// (Section B fix pack, F-B9). Comment-only, no behavior change. Full
// rationale is recorded at the point of decision, directly above the
// IN_PROGRESS_EDIT_STATES declaration further down the file.
//
// F27 CHANGE-CONTROL — export/consent disclosure gap for raw Telegram user
// ID and Idempotency table resolved (Section C fix pack, F-C4, fixes audit
// finding C5-1 — MAJOR). Date: 2026-08-16. Two independent sub-fixes: (a)
// showConsent_'s DRAFT text now names that a raw Telegram user ID (distinct
// from chat ID) is stored, and that an Idempotency/deduplication table
// exists; (b) exportParticipantData_'s tables array no longer bundles
// Idempotency into the export (underlying sheet untouched — export
// minimization only). Both were needed: what's disclosed and what's
// exported are independent gaps, and minimizing the export doesn't make the
// consent-copy gap moot since the data is still stored regardless. Retested:
// YES — /start consent text renders correctly within Telegram's length
// limit; /export-data CSV no longer contains Idempotency while other
// sections are unchanged; /delete-data still removes Idempotency rows.
// ⚠️ SHIPPED (Round 5, F43, 2026-08-18): this consent-facing copy was
// approved and the "DRAFT — FLAGGED FOR SIGN-OFF" marker removed. See F43's
// change-control note above showConsent_ for the sign-off record.
//
// F28 CHANGE-CONTROL — stale rowNumber under manual Sheets edits mitigated
// via pre-write row-identity re-verification (Section C fix pack, F-C5,
// fixes audit finding C3-2 — MAJOR). Date: 2026-08-16.
// What changed: added verifyRowIdentity_(sheet, rowNumber, idColumnZeroBased,
// expectedId, context) and wired it into the three write sites that rely on
// a rowNumber captured earlier in the same execution: updateParticipantConsent_
// (vs COLS.PARTICIPANTS.ID), interruptSession_ and transitionSession_ (both
// vs COLS.SESSIONS.SESSION_ID). Each re-reads the target row's ID
// immediately before writing; on mismatch, the write is skipped, a
// ROW_IDENTITY_MISMATCH event is logged, and the function returns false
// instead of writing blind. transitionSession_ additionally notifies the
// user, since it's the highest-traffic site.
// Why: LockService only guards concurrent bot executions, not a human
// live-editing the Sheet mid-request — a captured rowNumber could silently
// point at the wrong row by write time, corrupting another record with no
// diagnostic trail. Judged proportionate despite low likelihood (5-8
// participant pilot, no concurrent-editing workflow) because the failure
// mode is silent data corruption and the fix itself is narrow/mechanical.
// Retested (Node vm sandbox harness): happy-path unchanged for all three
// functions — PASS; each function's mismatch-detection path (out-of-range
// row, wrong-ID row) — PASS; full 11-step morning-flow regression with no
// manual-edit interference — PASS. Manual click-through against the live
// bot deployment is still outstanding.
//
// ⚠️ CORRECTED (Round 5, FIX-4, closes Round 4 Finding 1 — supersedes the
// paragraph below, which understated the actual consequence): the original
// claim that "the NEW session is still created and becomes the one
// getCurrentSession_ returns" is FALSE. Traced: getCurrentSession_ (line
// ~1258) uses Array.prototype.findIndex over readRows_'s top-to-bottom scan
// and returns the FIRST row matching ACTIVE_STATUS. Sheets appendRow always
// writes to the bottom of the sheet, so physical row order is append order —
// the OLD (stale, pre-interrupt) row is always physically earlier than the
// NEW row createSession_ appends immediately after the failed interrupt. If
// interruptSession_'s identity check fails, it returns false WITHOUT writing
// anything (line ~1428-1430) — the old row's ACTIVITY_STATUS stays ACTIVE,
// untouched. createSession_ then appends the new row below it regardless
// (ignoring interruptSession_'s return value) and also leaves it ACTIVE. Two
// ACTIVE rows for the same participant now coexist; findIndex returns the
// OLD one — the NEW session the user just started is not what
// getCurrentSession_ resolves to. The actual consequence: the user's next
// interaction is evaluated against the zombie OLD session's stale state
// (whatever GATE_CANDIDATE/CANDIDATE/etc. step it was frozen at), not the
// new one they just began. Most concretely, a button tap matching the NEW
// session's current step will fail handleAction_'s state/version match
// against the OLD session and surface as "That button is no longer valid"
// (line ~2320) — confusing, not silent, but for the wrong underlying reason
// than that message normally implies (normally: stale button after a
// legitimate transition; here: session identity resolution pointing at the
// wrong row entirely).
//
// RE-WEIGHED PROPORTIONALITY (Part 2 of FIX-4): F28's original accept-as-is
// decision was made against the milder, incorrect description above. Re-run
// against the corrected description: likelihood is unchanged (still
// requires a manual Sheets edit colliding with a live createSession_ call,
// still judged low at 5-8 participants with no concurrent-editing workflow)
// but severity is worse than originally recorded — not a silently-orphaned
// row with no user impact, but an active participant's next interaction
// being evaluated against the wrong session, surfacing as a confusing error
// during real usability testing. Given usability testing is this project's
// explicit current-stage objective (master doc §23), a confusing failure
// mode appearing during that exact activity is a materially different cost
// than "low likelihood, no visible effect" (F28's original framing). DECISION:
// implement the check. createSession_ now inspects interruptSession_'s
// return value and retries the supersede-write once on failure (handles the
// transient case where verifyRowIdentity_ failed because of a race rather
// than a genuine identity mismatch). This is the "retry the row lookup
// once" option this prompt offered, not the "fail loud" alternative —
// aborting session creation entirely would require every one of
// createSession_'s 6 call sites to handle a null/failed return, a
// materially larger change than this fix pack's minimal-closure
// instruction calls for. See the createSession_ change-control note (F44,
// immediately below this function) for the full implementation and the
// reasoning for choosing retry over abort. This re-affirms F-C5's original
// scope decision (verifyRowIdentity_ itself was correctly scoped) while
// closing the specific gap F28 had flagged but left open.
// F49 CORRECTION (Round 5, Section H fix pack, fixes audit finding H1): this
// note and F44's own note (at createSession_ below) both originally said "7
// call sites." Corrected to 6, verified by grep of every createSession_(
// invocation outside its own definition: handleCommandOrText_'s /start
// branch, both CONSENT_YES/CONSENT_GRANTED branches in handleCallback_,
// startStandaloneResolution_, startDecisionGateTest_, and startReview_ — six
// distinct call sites, not seven. Comment-only; no retesting required — the
// retry-vs-abort reasoning and decision this note records do not depend on
// the exact count, only on there being "more than one, so abort is costly,"
// which remains true at 6.
//
// Original (now-corrected) note, retained for history:
// createSession_ does NOT check interruptSession_'s return value; it
// proceeds to append the new session row regardless. If interruptSession_'s
// supersede-write fails its identity check, the OLD session row is left
// showing stale ACTIVE state instead of SUPERSEDED, though the NEW session
// is still created and becomes the one getCurrentSession_ returns.
// Resolving this would mean changing createSession_'s own control flow — a
// materially different change than "re-verify before write."
//
// F29 CHANGE-CONTROL — PROJECT_TIMEZONE hardcoding replaced with
// per-participant timezone capture (Section C fix pack, F-C6, fixes audit
// finding C7-1 — MINOR-MAJOR). Date: 2026-08-16.
// What changed: PROJECT_TIMEZONE renamed DEFAULT_PROJECT_TIMEZONE (still
// 'America/New_York'), now used only as fallback. A new
// Participants.TIMEZONE column stores each participant's own choice, set
// via a standalone showTimezoneSelect_ step (Eastern/Central/Mountain/
// Pacific + Skip) immediately after CONSENT_YES. projectDay_() now accepts
// an optional timezone, validated against TIMEZONE_CHOICES before use (an
// invalid value falls back to the default rather than throwing).
// getParticipantTimezone_ centralizes lookup so createSession_'s
// day-stamping and getLatestSessionForProjectDay_'s day-matching always
// agree on what "today" means for a participant (F50 CORRECTION, Round 5
// Section H fix pack, fixes audit finding H2: this note originally also
// named resolveParticipantTimezone_ as sharing this centralizing role — that
// function was dead code, now removed; see its removal note near
// getParticipantTimezone_'s definition for the full trace).
// migrateParticipantsAddTimezoneColumn_() is provided for one-time manual
// use against pre-existing Participants data.
// Why: the hardcoded Eastern default had no rationale comment and no
// override — a Pacific/Mountain participant checking in late evening or
// early morning could get a PROJECT_DAY that didn't match their own
// subjective "today," causing /review to select the wrong session.
// Proportionality was explicitly weighed (5-8 person formative pilot, not
// the unsupervised 21-day version) but the project owner chose to implement
// the code fix anyway rather than rely on facilitator screening.
// Retested (4 Node vm sandbox harnesses): real Intl-based timezone math
// confirming Eastern/Pacific resolve to different calendar days at the same
// instant, and that day-stamping/session-lookup correctly follow a
// participant's chosen zone or fall back on Skip — PASS; full morning-flow
// regression — PASS; F28's row-identity regression (verifyRowIdentity_
// reuse in setParticipantTimezone_) — PASS; migration harness (throws
// SCHEMA_COLUMN_COUNT_MISMATCH pre-migration, backfills correctly, safe
// idempotent re-run) — PASS. Manual click-through against the live bot is
// still outstanding.
// ⚠️ Deployment note, still relevant: because validateSheetSchema_ is
// deliberately strict, any pre-existing 7-column Participants sheet will
// hard-fail on every read the moment this deploys, until
// migrateParticipantsAddTimezoneColumn_() is run manually once. Currently
// expected to be a non-issue (no pilot has live Participants data yet), but
// stated here so it isn't missed if that changes before this ships.
//
// F30 CHANGE-CONTROL — completeWithNewSignal_ reconnected to both real
// PRESERVE exit paths (Round 1 fix pack, fixes audit findings F-A5-2 /
// F-C2-1 — MAJOR). Date: 2026-08-16.
// What changed: completeWithNewSignal_ — the only function that appends to
// SignalHistory — was defined but never called from any live path; both
// real PRESERVE exits called transitionSession_ directly, so SignalHistory
// was permanently empty and getLatestSignal_ always returned null.
// handleAction_'s PRESERVE_* branch now routes through
// completeWithNewSignal_ instead (which still calls transitionSession_
// internally — a like-for-like swap, not an added write). The
// FOCAL_NEITHER/CANT_COMPARE/NO_SIGNAL/UNCERTAIN branches were deliberately
// left untouched — they legitimately bypass PRESERVE with focal_signal =
// null by design (§9 Step 5's "no Signal today" escape), so routing them
// through completeWithNewSignal_ would wrongly trigger its guard.
// Why: SignalHistory being empty meant the READY greeting's "Yesterday's
// focal Signal" line was unreachable, and the project's core §3 "standing
// signal re-derived each morning" design depended on a table that didn't
// actually exist at runtime.
//
// Current guard behavior: completeWithNewSignal_ persists SignalHistory only
// for a qualifying CLAIM_SIGNAL and blocks if that claim-derived signal text is
// missing. Non-claim focus states complete without a SignalHistory row. Historical
// FOCAL_SMALLER/CAREGIVING/MAINTENANCE/LEISURE action-token descriptions are not
// current runtime paths; caregiving/maintenance/leisure are ordinary candidates.
//
// F31 CHANGE-CONTROL — PRESERVE restructured to capture non-focal claim
// text before routing, so scheduled_items/later_items hold real content
// (Round 1 fix pack, fixes audit finding F-A5-1 — MAJOR). Date: 2026-08-16.
// What changed: PRESERVE's routing buttons previously only ever wrote empty
// arrays, never the actual claim text, so /later always reported empty
// regardless of real usage. PRESERVE is now internally two phases within
// the single existing STATES.PRESERVE value (no new state added): typing
// text captures it into payload.preserve_note and re-renders PRESERVE with
// the routing buttons and captured text echoed back, instead of
// transitioning straight to COMPLETE as before. A routing-button tap then
// pushes preserve_note (if any) into scheduled_items/later_items as a plain
// string, matching /later's existing display code. Tapping a routing
// button with no text typed first remains fully supported and blocks
// nothing — the zero-friction escape hatch the master doc's
// anti-punitive-friction principles require is preserved. The
// "acknowledged" route deliberately does not push into other_claims, since
// that array holds structured per-candidate gate records, not plain
// strings, and nothing reads it for this purpose.
// Why: §9 Step 6's actual purpose (preserve non-focal claims so they aren't
// silently lost) was unmet despite the UI implying otherwise — routed
// claims were never durably recorded anywhere /later could read.
//
// F30/F31 are interdependent (F30's routing-button call site only reaches
// completeWithNewSignal_ because F31 restructured PRESERVE to require a
// button tap to exit) and were implemented and retested together.
// Retested via 4 Node vm sandbox harnesses driving the real doPost() entry
// point end-to-end: (a) single-candidate smaller-action path, PRESERVE
// captured via text then routed — PASS, 12/12 assertions, confirming
// exactly one correct SignalHistory row and one correct scheduled_items
// entry; (b) two-candidate path where the smaller-action branch wins the
// comparison — PASS, 10/10, confirming focal_signal/focal_smaller_action
// both resolve to the smaller-action text; (c) guard-edge case
// (FOCAL_SMALLER with no recorded smaller_action correctly blocks, zero
// rows written) plus the zero-friction no-text route — PASS, 6/6,
// confirming the READY greeting's "Yesterday's focal Signal" line now
// renders correctly on a second /start; (d) lock-serialized double-tap
// replay of a real PRESERVE_SCHEDULED callback — PASS, 5/5, zero duplicate
// rows. A fifth harness re-ran ACUTE_YES -> ACUTE_EXIT unchanged, confirming
// no regression outside PRESERVE. Manual click-through against the live bot
// is still outstanding (visible SignalHistory row in the real Sheet,
// correct HTML rendering of the "Captured:" echo and the greeting line).
//
// Note on double-tap coverage: harness (d) shows the SECOND delivery of a
// stale terminal callback is rejected before handleAction_ because
// getCurrentSession_ returns null after terminal completion. Mid-flow
// free-text replay is handled separately by handleStateInput_'s persisted
// normalized-text/stateVersion marker described in the updated F20 note;
// this SignalHistory guard is therefore one layer of defense, not the sole
// replay-control mechanism.
//
// F32/F36 CHANGE-CONTROL — column-level identity drift, decision and
// implementation (Round 2/2 follow-up fix pack, fixes audit finding
// F-C1-1, MAJOR). Dates: 2026-08-17 (F32, decision) / Round 2 follow-up
// (F36, implementation).
// The gap: validateSheetSchema_ only checked column *count*
// (sheet.getLastColumn() vs expected COUNT), and verifyRowIdentity_ (F28)
// only checked *row* identity at a fixed column offset — neither caught an
// operator manually swapping two same-arity columns (e.g. two date columns
// in Sessions). Worse, an undetected swap would actively compound: the next
// write would keep targeting the pre-swap offsets, silently deepening the
// corruption on data that already looked fine to both checks.
// Two options were weighed: (A) a periodic operator-run sanity check
// spot-checking invariants (STARTED_AT <= UPDATED_AT, valid STATE values,
// etc.) — cheap and fully additive, but strictly after-the-fact and unable
// to distinguish a column swap from unusual-but-valid data; (B) add a
// header row, making column identity self-describing and checkable
// directly against the sheet — closes the gap at the source, but touches
// every row-indexing call site (readRows_, rowNumber_,
// verifyRowIdentity_'s range bound, getOrCreateSheet_, all appendRow_/
// getRange calls) and only protects future rows, not drift already present
// in a live sheet.
// Decision: Hirbod chose Option B. Implemented as: ROWS.FIRST_DATA is now 2
// (row 1 is a header row); HEADERS is derived from COLS itself via
// headerLabelsFor_ (one source of truth, not a hand-typed parallel list —
// avoiding a second instance of the same drift problem); a newly-created
// sheet gets its header row written immediately; migrateHeaderRow_ /
// migrateAllSheetsAddHeaderRow_ handle backfilling pre-existing headerless
// sheets. validateSheetSchema_ now checked at every readRows_ call, so a
// manual column swap is visible as a header/COLS mismatch going forward.
//

// HISTORICAL DESIGN RECORD ONLY: /explain described below is NOT an executable
// glossary in this candidate; the live branch reports its absence.
// F62 CHANGE-CONTROL — read-only /explain command (Accessibility fix,
// Phase 3). Date: 2026-08-19.
// (1) WHAT CHANGED: added EXPLAIN_CONTENT (below) and a new /explain
// branch in handleCommandOrText_ (see that function). EXPLAIN_CONTENT is
// keyed by STATES.X, sourced directly from the Phase 0.5 locked content
// table (accessibility-fix Prompt 1 output, reviewed and signed off before
// this implementation step), transcribed here without alteration to the
// term/gloss wording that table locked. 8 states, 12 gloss rows, matching
// the table's own stated cap (8 states / <=4 terms each / 24-term
// ceiling) — actual count came in under the cap, as the table itself
// noted.
// (2) WHY THE PRIOR STATE WAS INSUFFICIENT: several states in the morning
// gate and evening review use domain-specific terms (present claim,
// feasible, deferrable/delegable/reducible, focal Signal, non-focal
// claim, Scheduled/Later/Acknowledged, decision-quality-vs-outcome) with
// no prior on-demand definition surface — GATE_TYPE is the file's only
// existing state with a full inline gloss (F-F2c), and F-F1a/F-F1b added
// partial inline glosses elsewhere, but there was no general mechanism a
// participant could invoke mid-flow, on their own initiative, at any
// jargon-bearing state, without waiting for a future fix pack to touch
// that specific string.
// (3) EVIDENCE MOTIVATING THE CHANGE: Phase 0.5's locked content table
// (accessibility-fix Prompt 1), itself grep-sourced against every
// sendTelegram_/button_ call site in this file rather than drawn from
// memory of prior audit rounds. No participant/usability data.
// (4) DOWNSTREAM COMPONENTS AFFECTED: handleCommandOrText_ gains one new
// command branch. No STATES, payload field, transition, or button_ call
// is added, removed, or modified by this fix — /explain is read-only by
// construction (see the handler itself for the explicit verification of
// this). EXPLAIN_CONTENT is a new top-level constant with no other
// reader/writer anywhere else in the file.
// (5) RETESTING REQUIRED: yes — see the retest note after the /explain
// handler in handleCommandOrText_.
//
// SCOPE NOTE, per Prompt 1's own table: REVIEW_Q8 is deliberately absent
// from this table. F-F1b already found that full inline glosses for all
// 14 of REVIEW_Q8's options would roughly double an already-long message
// past F-F3b's mobile-scanability bar; REVIEW_Q8 is the intended target
// of F64 (Phase 5, selective in-message precision), not this /explain
// table. This is a scope decision carried forward from Phase 0.5, not an
// oversight — flagged here again so a future reader of EXPLAIN_CONTENT
// alone doesn't mistake the absence for a gap.
//
// EXCLUSIONS, confirmed by name per Phase 0.5's own sourced verification
// (re-confirmed, not re-derived, at this implementation step): ACUTE,
// ACUTE_EXIT, RECOVERY, RECOVERY_EXIT, and any consent-adjacent state
// (there is no STATES entry for consent — showConsent_ fires before any
// session exists) have NO entry in EXPLAIN_CONTENT below. Checked: zero
// occurrences of STATES.ACUTE, STATES.ACUTE_EXIT, STATES.RECOVERY, or
// STATES.RECOVERY_EXIT as keys in the object below.
// R14 LIVE-STAGING REPAIR — SCB_POST_AUDIT_CORE_R14 / SCB_SCHEMA_V10.
// Implements the P10 calibration-cycle, learning-record, and optional adjustment
// contact architecture. One durable cycle links one morning decision episode to
// at most one review; learning records remain nullable participant report; a
// versioned adjustment plan is recalled once at the next eligible morning and can
// be accepted, revised, declined, expired, superseded, or withdrawn. Assignment,
// exposure/delivery, and response are stored separately. No Layer-3 intervention,
// score, reward, outcome-based recommendation, or efficacy claim is introduced.
// PE03 — lifetime participation entitlement is reconciled at the existing
// durable participant-enrollment boundary.
// PE04 — deletion distinguishes pre-enrollment purge from post-enrollment
// retirement, preserves the lifetime repeat-enrollment lock, and keeps R17's
// retained DataControlRequests reconciliation discipline.
// PE06 — participant-facing privacy/retention wording, locked-user access surface
// contracts, 21-day/transfer lineage guardrails, and non-secret eligibility-config
// provenance are reconciled. Sheets schema/migration remain V10.
const SCB_BUILD_ID = 'SCB_UPDATED_PRE_RELEASE_FINAL_INSTRUMENT_V1';
// Operational source release only; deliberately NOT the StudyRun build identifier.
const SCB_CODE_RELEASE_ID = 'SCB_V2_ROOT_CAUSE_CLOSURE_CANDIDATE_v1.2.6';
function scbOperatorCodeReleaseId_() { return SCB_CODE_RELEASE_ID; }
const SCB_INSTRUMENT_CONTRACT_VERSION = 'SCB_INSTRUMENT_FINAL_V1';
const SCB_SOURCE_AUTHORITY = 'PROSPECTIVE_REPAIR_LINEAGE';

// P03 PROSPECTIVE IMPLEMENTATION DECISION — initial lineage established as SCB_POST_AUDIT_CORE_R1; current P05 build is SCB_POST_AUDIT_CORE_R3.
// This is a new governed state enumeration for the prospective repair lineage.
// It is derived from the 29 executable STATES member references in immutable F64
// and the P01 state-transition contract. Historical F6/F59 evidence is only a
// cross-check; this declaration is NOT represented as recovered historical source.
const STATES = Object.freeze({
  ACUTE: 'ACUTE',
  ACUTE_EXIT: 'ACUTE_EXIT',
  ADJUSTMENT_CONTACT: 'ADJUSTMENT_CONTACT',
  ADJUSTMENT_REVISE: 'ADJUSTMENT_REVISE',
  CANDIDATE: 'CANDIDATE',
  COMPLETE: 'COMPLETE',
  FOCAL_SELECTION: 'FOCAL_SELECTION',
  GATE_CANDIDATE: 'GATE_CANDIDATE',
  GATE_CLAIM: 'GATE_CLAIM',
  GATE_COMMITMENT: 'GATE_COMMITMENT',
  GATE_COMPARE: 'GATE_COMPARE',
  GATE_FEASIBILITY: 'GATE_FEASIBILITY',
  GATE_SMALLER_ACTION: 'GATE_SMALLER_ACTION',
  GATE_TYPE: 'GATE_TYPE',
  PRESERVE: 'PRESERVE',
  READY: 'READY',
  REENTRY_CHOICE: 'REENTRY_CHOICE',
  RECOVERY: 'RECOVERY',
  RECOVERY_EXIT: 'RECOVERY_EXIT',
  REVIEW_MINIMAL: 'REVIEW_MINIMAL',
  REVIEW_PAUSED: 'REVIEW_PAUSED',
  REVIEW_LEARNING: 'REVIEW_LEARNING',
  REVIEW_Q1: 'REVIEW_Q1',
  REVIEW_Q10: 'REVIEW_Q10',
  REVIEW_Q2: 'REVIEW_Q2',
  REVIEW_Q3: 'REVIEW_Q3',
  REVIEW_Q4: 'REVIEW_Q4',
  REVIEW_Q5: 'REVIEW_Q5',
  REVIEW_Q5_NOTE: 'REVIEW_Q5_NOTE',
  REVIEW_Q6: 'REVIEW_Q6',
  REVIEW_Q6_NOTE: 'REVIEW_Q6_NOTE',
  REVIEW_Q7: 'REVIEW_Q7',
  REVIEW_Q8: 'REVIEW_Q8',
  REVIEW_Q9: 'REVIEW_Q9',
});

const SCB_LANGUAGE_SUPPORT_POLICY_ID = 'SCB_LANGUAGE_SUPPORT_POLICY_V1';
const SCB_ENGLISH_INTEGRATION_PROTOCOL_ID = 'SCB_ENGLISH_INTEGRATION_V1';
const SCB_ENGLISH_INTEGRATION_AVAILABILITY = 'NOT_AVAILABLE_IN_V1';
// Documentation-only protocol mapping for the frozen V1 research design.
// These slot identifiers are intentionally not consumed by runtime code in V1;
// they preserve design provenance only and must not be interpreted as active behavior.
const SCB_LANGUAGE_SUPPORT_SLOTS = Object.freeze({
  LS_SLOT_001: Object.freeze({item:'PF019', phase:'POST_RESPONSE'}),
  LS_SLOT_002: Object.freeze({item:'PF020', phase:'POST_RESPONSE'}),
  LS_SLOT_003: Object.freeze({item:'PF024', phase:'PRE_RESPONSE', kind:'MEANING_ONLY'}),
  LS_SLOT_004: Object.freeze({item:'PF025', phase:'POST_RESPONSE'})
});

const ACTIVE_STATUS = 'ACTIVE';
const TERMINAL_STATES = Object.freeze([STATES.ACUTE_EXIT, STATES.RECOVERY_EXIT, STATES.COMPLETE]);
// P03: lazy runtime repository/bootstrap boundary. Source evaluation performs no
// Spreadsheet access or sheet creation. The first controlled storage operation
// resolves the explicitly configured storage spreadsheet and named sheet on demand.
let runtimeSpreadsheet_ = null;
let runtimeSpreadsheetId_ = '';
const runtimeSheets_ = Object.create(null);

function clearRuntimeSheetCache_() {
  Object.keys(runtimeSheets_).forEach(function(name) { delete runtimeSheets_[name]; });
}

function getSpreadsheet_() {
  const configuredId = String(getConfig_().storageSpreadsheetId || '').trim();
  if (!configuredId) throw new Error('STORAGE_SPREADSHEET_ID_REQUIRED');
  if (runtimeSpreadsheet_ && runtimeSpreadsheetId_ === configuredId) return runtimeSpreadsheet_;
  let spreadsheet;
  try {
    spreadsheet = SpreadsheetApp.openById(configuredId);
  } catch (error) {
    throw new Error('STORAGE_SPREADSHEET_UNAVAILABLE:' + safeErrorMessage_(error));
  }
  if (!spreadsheet) throw new Error('STORAGE_SPREADSHEET_UNAVAILABLE');
  runtimeSpreadsheet_ = spreadsheet;
  runtimeSpreadsheetId_ = configuredId;
  clearRuntimeSheetCache_();
  return runtimeSpreadsheet_;
}

function getRuntimeSheet_(name) {
  getSpreadsheet_();
  if (!runtimeSheets_[name]) runtimeSheets_[name] = getOrCreateSheet_(name);
  return runtimeSheets_[name];
}

function getParticipantsSheet_() { return getRuntimeSheet_('Participants'); }
function getSessionsSheet_() { return getRuntimeSheet_('Sessions'); }
function getEventsSheet_() { return getRuntimeSheet_('Events'); }
function getIdempotencySheet_() { return getRuntimeSheet_('Idempotency'); }
function getSignalHistorySheet_() { return getRuntimeSheet_('SignalHistory'); }
function getOperationsSheet_() { return getRuntimeSheet_('Operations'); }
function getCorruptionQuarantineSheet_() { return getRuntimeSheet_('CorruptionQuarantine'); }
function getMigrationLogSheet_() { return getRuntimeSheet_('MigrationLog'); }
function getSetupHistorySheet_() { return getRuntimeSheet_('SetupHistory'); }
function getConsentHistorySheet_() { return getRuntimeSheet_('ConsentHistory'); }
function getTimezoneHistorySheet_() { return getRuntimeSheet_('TimezoneHistory'); }
function getDataControlRequestsSheet_() { return getRuntimeSheet_('DataControlRequests'); }
function getDataControlAuditSheet_() { return getRuntimeSheet_('DataControlAudit'); }
function getCalibrationCyclesSheet_() { return getRuntimeSheet_('CalibrationCycles'); }
function getLearningRecordsSheet_() { return getRuntimeSheet_('LearningRecords'); }
function getAdjustmentPlansSheet_() { return getRuntimeSheet_('AdjustmentPlans'); }
function getStudyRunsSheet_() { return getRuntimeSheet_('StudyRuns'); }
function getTeachingExposureSheet_() { return getRuntimeSheet_('TeachingExposure'); }
function getLayerDecisionsSheet_() { return getRuntimeSheet_('LayerDecisions'); }
function getInterventionEpisodesSheet_() { return getRuntimeSheet_('InterventionEpisodes'); }
function getTransferEpisodesSheet_() { return getRuntimeSheet_('TransferEpisodes'); }
function getEvidenceObservationsSheet_() { return getRuntimeSheet_('EvidenceObservations'); }
function getEvidenceAssessmentsSheet_() { return getRuntimeSheet_('EvidenceAssessments'); }


// F50 CHANGE-CONTROL (Round 5, Section H fix pack, fixes audit finding H2):
// uncertaintySafeText_ removed — dead code, zero references anywhere in this
// file (verified by grep: no uncertaintySafeText_( invocation existed
// outside its own now-deleted definition, and no comment anywhere else
// mentioned it either, unlike resolveParticipantTimezone_'s case above which
// at least had stale pointers to clean up). Most likely vestigial from an
// earlier architecture pass that never got fully wired in, or was superseded
// before any call site was added. Retesting: no — removal of code with zero
// reachable callers changes no runtime behavior.

// F36: a newly-created sheet now gets its header row (from HEADERS) written
// immediately. P04 also initializes a pre-existing named sheet only when it is
// genuinely empty (zero rows and zero columns). Any non-empty legacy, shifted,
// mixed, or malformed layout is left untouched for the governed migration
// preflight; runtime access never guesses a repair.
function getOrCreateSheet_(name) {
  const spreadsheet = getSpreadsheet_();
  const labels = HEADERS[name];
  if (!labels) throw new Error('UNKNOWN_SHEET_SCHEMA:' + name);
  const existing = spreadsheet.getSheetByName(name);
  if (existing) {
    // P04: a pre-existing *empty* named sheet must never remain headerless.
    // It is safe to initialize only the truly empty case. Any non-empty legacy
    // or malformed sheet is left untouched for explicit migration/preflight.
    if (existing.getLastRow() === 0 && existing.getLastColumn() === 0) {
      storageSetValues_(existing, 1, 1, [labels], 'schema_header_initialize');
    }
    return existing;
  }
  const created = spreadsheet.insertSheet(name);
  storageSetValues_(created, 1, 1, [labels], 'schema_header_create');
  return created;
}

// P04 repository/storage boundary. Domain handlers must not mutate Sheets directly.
// These functions are intentionally small so every durable write has one place for
// operation-artifact registration and future fault injection/reconciliation tests.
// P05 code-only pre-launch remediation: canonical Session project-day checks may
// consult the same CalibrationCycles table many times inside one webhook. Keep the
// derived linked-day index strictly operation-local and invalidate it on every cycle
// mutation so repeated read-only checks do not rescan the full table while writes
// remain immediately visible to later checks in the same operation.
function invalidateOperationCalibrationCycleDayIndex_() {
  if (currentOperationContext_) delete currentOperationContext_.calibrationCycleDayIndex;
}
function storageReadRows_(sheet) {
  lprCountBotService_('sheets.logical_read');
  validateSheetSchema_(sheet);
  const lastRow = sheet.getLastRow();
  return lastRow < ROWS.FIRST_DATA ? [] : sheet.getRange(ROWS.FIRST_DATA, 1, lastRow - ROWS.FIRST_DATA + 1, sheet.getLastColumn()).getValues();
}
function storageAppendRow_(sheet, row, artifactType) {
  lprCountBotService_('sheets.logical_write');
  const name=sheet.getName(), projectCols=PROJECT_DAY_COLUMNS[name]||[], participantTextCols=PARTICIPANT_PLAIN_TEXT_COLUMNS[name]||[];
  if(projectCols.length||participantTextCols.length){
    const rowNumber=Math.max(ROWS.FIRST_DATA,sheet.getLastRow()+1);
    const values=normalizedProjectDayWriteValues_(name,1,[row]);
    prepareProjectDayTextFormat_(sheet,rowNumber,1,1,row.length);
    prepareParticipantPlainTextFormat_(sheet,rowNumber,1,1,row.length);
    sheet.getRange(rowNumber,1,1,row.length).setValues(values);
    if(name==='CalibrationCycles') invalidateOperationCalibrationCycleDayIndex_();
    registerOperationArtifact_(name,rowNumber,artifactType||'append');
    return rowNumber;
  }
  sheet.appendRow(row);
  if(name==='CalibrationCycles') invalidateOperationCalibrationCycleDayIndex_();
  registerOperationArtifact_(name, sheet.getLastRow(), artifactType || 'append');
  return sheet.getLastRow();
}
function storageSetValue_(sheet, row, col, value, artifactType) {
  lprCountBotService_('sheets.logical_write');
  const name=sheet.getName();
  const values=row>=ROWS.FIRST_DATA?normalizedProjectDayWriteValues_(name,col,[[value]]):[[value]];
  if(row>=ROWS.FIRST_DATA) { prepareProjectDayTextFormat_(sheet,row,col,1,1); prepareParticipantPlainTextFormat_(sheet,row,col,1,1); }
  sheet.getRange(row, col).setValue(values[0][0]);
  if(name==='CalibrationCycles') invalidateOperationCalibrationCycleDayIndex_();
  registerOperationArtifact_(name, row, artifactType || 'set_value');
}
function storageSetValues_(sheet, row, col, values, artifactType) {
  lprCountBotService_('sheets.logical_write');
  const name=sheet.getName(), width = values && values[0] ? values[0].length : 0;
  const normalized=row>=ROWS.FIRST_DATA?normalizedProjectDayWriteValues_(name,col,values):values;
  if(row>=ROWS.FIRST_DATA) { prepareProjectDayTextFormat_(sheet,row,col,values.length,width); prepareParticipantPlainTextFormat_(sheet,row,col,values.length,width); }
  sheet.getRange(row, col, values.length, width).setValues(normalized);
  if(name==='CalibrationCycles') invalidateOperationCalibrationCycleDayIndex_();
  registerOperationArtifact_(name, row, artifactType || 'set_values');
}
function storageDeleteRow_(sheet, row, artifactType) {
  const name=sheet.getName();
  sheet.deleteRow(row);
  if(name==='CalibrationCycles') invalidateOperationCalibrationCycleDayIndex_();
  registerOperationArtifact_(name, row, artifactType || 'delete_row');
}
function storageInsertRowBefore_(sheet, row, artifactType) {
  const name=sheet.getName();
  sheet.insertRowBefore(row);
  if(name==='CalibrationCycles') invalidateOperationCalibrationCycleDayIndex_();
  registerOperationArtifact_(name, row, artifactType || 'insert_row');
}

function operationId_() { return currentOperationContext_ ? currentOperationContext_.operationId : ''; }
const SCB_TECH_CLAIM_USER_PROP='SCB_TECH_CLAIM_USER_ID';
const SCB_TECH_CLAIM_UPDATE_PROP='SCB_TECH_CLAIM_UPDATE_ID';
function scbInspectConfiguredTechnicalClaim() {
  // Non-mutating inspection for Apps Script project editors. Operator manually
  // adjudicates business artifacts before marking any claim as resolved.
  const props=PropertiesService.getScriptProperties();
  const user=String(props.getProperty(SCB_TECH_CLAIM_USER_PROP)||'').trim();
  const update=String(props.getProperty(SCB_TECH_CLAIM_UPDATE_PROP)||'').trim();
  if(!user||!update)throw new Error('TECHNICAL_CLAIM_IDS_REQUIRED');
  const lock=LockService.getScriptLock();let held=false;
  try{lock.waitLock(30000);held=true;
    const rec=getIdempotencyRecord_(update,user);
    if(!rec)return {status:'CLAIM_NOT_FOUND',requiresOperatorInvestigation:true};
    const op=rec.operationId?findOperationById_(rec.operationId):scbFindOperationByUpdate_(update,user);
    return {status:rec.status,result:rec.result,operationId:rec.operationId||
      (op?String(op.row[COLS.OPERATIONS.OPERATION_ID]):''),operationStatus:op?String(op.row[COLS.OPERATIONS.STATUS]):'NONE',
      requiresOperatorInvestigation:rec.status!==IDEMPOTENCY_STATUS.COMMITTED&&rec.status!==IDEMPOTENCY_STATUS.RECONCILED};
  }finally{if(held)lock.releaseLock();}
}
function scbFindOperationByUpdate_(updateId,userId) {
  // Operator and catch-path read: never infer completion from existence of this row.
  const rows=readRows_(getOperationsSheet_());
  const matches=rows.filter(r=>String(r[COLS.OPERATIONS.UPDATE_ID])===String(updateId)
    &&String(r[COLS.OPERATIONS.USER_ID])===String(userId));
  if(matches.length>1) throw new Error('MULTIPLE_ORPHAN_OPERATIONS');
  return matches.length?{row:matches[0]}:null;
}
function beginOperation_(updateId, userId, operationType, deliveryChatId) {
  const operationId = Utilities.getUuid();
  const now = now_();
  const ctx = { operationId: operationId, correlationId: operationId, updateId: String(updateId || ''), userId: String(userId || ''), participantId: String(userId || ''), sessionId: '', operationType: operationType || 'telegram_update', rowNumber: 0, artifacts: [], sendStatus: '', errorClass: '', status: OPERATION_STATUS.PENDING, deliveryChatId: deliveryChatId === undefined || deliveryChatId === null ? '' : String(deliveryChatId), startedAt: now };
  const row = [operationId, operationId, ctx.updateId, ctx.userId, ctx.participantId, '', ctx.operationType, OPERATION_STATUS.PENDING, 'BEGIN', '[]', '', '', now, now, activeRunRef_()];
  const rowNumber = storageAppendRow_(getOperationsSheet_(), row, 'operation_begin');
  ctx.rowNumber = rowNumber;
  currentOperationContext_ = ctx;
  return ctx;
}
function registerOperationArtifact_(store, recordRef, action) {
  if (!currentOperationContext_ || store === 'Operations' || store === 'DataControlAudit') return;
  const ctx = currentOperationContext_;
  ctx.artifacts.push({ store:String(store), ref:String(recordRef), action:String(action || '') });
  // Keep operation metadata current, but never let an observability-write failure
  // masquerade as a successful business operation: propagate the exception.
  if (ctx.rowNumber) {
    const sheet = getOperationsSheet_();
    sheet.getRange(ctx.rowNumber, COLS.OPERATIONS.ARTIFACT_REFS + 1, 1, COLS.OPERATIONS.UPDATED_AT - COLS.OPERATIONS.ARTIFACT_REFS + 1).setValues([[
      JSON.stringify(ctx.artifacts), ctx.sendStatus || '', ctx.errorClass || '', ctx.startedAt || '', now_()
    ]]);
  }
}
function bindOperationSession_(sessionId) {
  if (!currentOperationContext_) return;
  currentOperationContext_.sessionId = String(sessionId || '');
  if (currentOperationContext_.rowNumber) storageSetValue_(getOperationsSheet_(), currentOperationContext_.rowNumber, COLS.OPERATIONS.SESSION_ID + 1, currentOperationContext_.sessionId, 'operation_session_bind');
}
function markOperationStage_(stage) {
  if (!currentOperationContext_ || !currentOperationContext_.rowNumber) return;
  const ctx = currentOperationContext_;
  storageSetValues_(getOperationsSheet_(), ctx.rowNumber, COLS.OPERATIONS.STAGE + 1, [[
    String(stage || ''), JSON.stringify(ctx.artifacts), ctx.sendStatus || '', ctx.errorClass || '', ctx.startedAt || '', now_()
  ]], 'operation_stage');
}
function markOperationSend_(status) {
  if (!currentOperationContext_) return;
  const ctx = currentOperationContext_;
  ctx.sendStatus = String(status || '');
  if (ctx.rowNumber) {
    storageSetValues_(getOperationsSheet_(), ctx.rowNumber, COLS.OPERATIONS.SEND_STATUS + 1, [[
      ctx.sendStatus, ctx.errorClass || '', ctx.startedAt || '', now_()
    ]], 'send_result');
  }
}
function finalizeOperation_(status, stage, errorClass) {
  if (!currentOperationContext_ || !currentOperationContext_.rowNumber) return;
  const ctx = currentOperationContext_;
  ctx.status = status;
  ctx.errorClass = String(errorClass || '');
  storageSetValues_(getOperationsSheet_(), ctx.rowNumber, COLS.OPERATIONS.STATUS + 1, [[status, String(stage || ''), JSON.stringify(ctx.artifacts), ctx.sendStatus || '', ctx.errorClass, ctx.startedAt || '', now_()]], 'operation_finalize');
}
function commitOperation_() { if (currentOperationContext_) finalizeOperation_(OPERATION_STATUS.COMMITTED, 'BUSINESS_MUTATIONS_COMPLETE', ''); }
function failOperation_(error) { if (currentOperationContext_) finalizeOperation_(OPERATION_STATUS.FAILED, 'FAILED_REQUIRES_RECONCILIATION', classifyProcessingError_(error)); }
function clearOperationContext_() { currentOperationContext_ = null; }

function findOperationById_(operationId) {
  if (!operationId) return null;
  const rows = storageReadRows_(getOperationsSheet_());
  const idx = rows.findIndex(r => String(r[COLS.OPERATIONS.OPERATION_ID]) === String(operationId));
  return idx < 0 ? null : { row: rows[idx], rowNumber: rowNumber_(idx) };
}
function reconcileOperation_(operationId, note) {
  const found = findOperationById_(operationId);
  if (!found) throw new Error('OPERATION_NOT_FOUND');
  const prior = String(found.row[COLS.OPERATIONS.STATUS]);
  if (prior === OPERATION_STATUS.COMMITTED || prior === OPERATION_STATUS.RECONCILED) return prior;
  storageSetValues_(getOperationsSheet_(), found.rowNumber, COLS.OPERATIONS.STATUS + 1, [[OPERATION_STATUS.RECONCILED, 'OPERATOR_RECONCILED', found.row[COLS.OPERATIONS.ARTIFACT_REFS] || '[]', found.row[COLS.OPERATIONS.SEND_STATUS] || '', 'reconciled:' + String(note || '').slice(0,120), found.row[COLS.OPERATIONS.STARTED_AT], now_()]], 'operation_reconcile');
  return OPERATION_STATUS.RECONCILED;
}

const OPERATOR_OPERATION_RECONCILE_PROPERTIES = Object.freeze({
  OPERATION_ID: 'SCB_RECONCILE_OPERATION_ID',
  NOTE: 'SCB_RECONCILE_OPERATION_NOTE'
});
function reconcileConfiguredOperation() {
  const props = PropertiesService.getScriptProperties();
  const operationId = String(props.getProperty(OPERATOR_OPERATION_RECONCILE_PROPERTIES.OPERATION_ID) || '').trim();
  const note = String(props.getProperty(OPERATOR_OPERATION_RECONCILE_PROPERTIES.NOTE) || '').trim();
  if (!operationId) throw new Error('SCB_RECONCILE_OPERATION_ID_REQUIRED');
  const lock = LockService.getScriptLock(); let acquired = false;
  try {
    lock.waitLock(30000); acquired = true;
    const status = reconcileOperation_(operationId, note);
    props.deleteProperty(OPERATOR_OPERATION_RECONCILE_PROPERTIES.OPERATION_ID);
    props.deleteProperty(OPERATOR_OPERATION_RECONCILE_PROPERTIES.NOTE);
    log_('OPERATOR_OPERATION_RECONCILED', {operationId:operationId,status:status});
    return status;
  } finally { if (acquired) lock.releaseLock(); }
}

function quarantineCorruptValue_(sheetName, rowNumber, recordId, fieldName, rawValue) {
  const fp = contentFingerprint_(rawValue);
  const rows = storageReadRows_(getCorruptionQuarantineSheet_());
  const existing = rows.find(r => String(r[COLS.CORRUPTION_QUARANTINE.SHEET_NAME]) === String(sheetName) && String(r[COLS.CORRUPTION_QUARANTINE.ROW_NUMBER]) === String(rowNumber) && String(r[COLS.CORRUPTION_QUARANTINE.FIELD_NAME]) === String(fieldName) && String(r[COLS.CORRUPTION_QUARANTINE.RAW_FINGERPRINT]) === String(fp.fingerprint) && String(r[COLS.CORRUPTION_QUARANTINE.STATUS]) === QUARANTINE_STATUS.OPEN);
  if (existing) return String(existing[COLS.CORRUPTION_QUARANTINE.QUARANTINE_ID]);
  const id = Utilities.getUuid();
  storageAppendRow_(getCorruptionQuarantineSheet_(), [id, String(sheetName), Number(rowNumber), String(recordId || ''), String(fieldName), String(rawValue), fp.fingerprint, now_(), QUARANTINE_STATUS.OPEN, ''], 'corruption_quarantine');
  return id;
}
function findQuarantineById_(quarantineId) {
  if (!quarantineId) return null;
  const rows = storageReadRows_(getCorruptionQuarantineSheet_());
  const idx = rows.findIndex(r => String(r[COLS.CORRUPTION_QUARANTINE.QUARANTINE_ID]) === String(quarantineId));
  return idx < 0 ? null : { row: rows[idx], rowNumber: rowNumber_(idx) };
}
function reconcileQuarantine_(quarantineId, note) {
  const found = findQuarantineById_(quarantineId);
  if (!found) throw new Error('QUARANTINE_NOT_FOUND');
  const prior = String(found.row[COLS.CORRUPTION_QUARANTINE.STATUS]);
  if (prior === QUARANTINE_STATUS.RECONCILED) return prior;
  storageSetValues_(getCorruptionQuarantineSheet_(), found.rowNumber, COLS.CORRUPTION_QUARANTINE.STATUS + 1, [[QUARANTINE_STATUS.RECONCILED, now_()]], 'quarantine_reconcile:' + String(note || '').slice(0,120));
  return QUARANTINE_STATUS.RECONCILED;
}
const OPERATOR_QUARANTINE_RECONCILE_PROPERTIES = Object.freeze({
  QUARANTINE_ID: 'SCB_RECONCILE_QUARANTINE_ID',
  NOTE: 'SCB_RECONCILE_QUARANTINE_NOTE'
});
function reconcileConfiguredQuarantine() {
  const props = PropertiesService.getScriptProperties();
  const quarantineId = String(props.getProperty(OPERATOR_QUARANTINE_RECONCILE_PROPERTIES.QUARANTINE_ID) || '').trim();
  const note = String(props.getProperty(OPERATOR_QUARANTINE_RECONCILE_PROPERTIES.NOTE) || '').trim();
  if (!quarantineId) throw new Error('SCB_RECONCILE_QUARANTINE_ID_REQUIRED');
  const status = reconcileQuarantine_(quarantineId, note);
  props.deleteProperty(OPERATOR_QUARANTINE_RECONCILE_PROPERTIES.QUARANTINE_ID);
  props.deleteProperty(OPERATOR_QUARANTINE_RECONCILE_PROPERTIES.NOTE);
  log_('OPERATOR_QUARANTINE_RECONCILED', {quarantineId:quarantineId,status:status});
  return status;
}

function parseSessionPayload_(value, rowNumber, sessionId) {
  if (!value) return {};
  try { return JSON.parse(value); }
  catch (error) {
    const quarantineId = quarantineCorruptValue_('Sessions', rowNumber, sessionId, 'PAYLOAD', value);
    throw new Error('CORRUPT_RECORD_QUARANTINED:' + quarantineId);
  }
}

function ensureStorageControlMetadata_() {
  const props = PropertiesService.getScriptProperties();
  const schema = props.getProperty(STORAGE_SCHEMA_PROPERTY);
  const migration = props.getProperty(STORAGE_MIGRATION_PROPERTY);
  if (schema === 'SCB_SCHEMA_V2' || migration === 'SCB_MIGRATION_V2') {
    throw new Error('STORAGE_MIGRATION_REQUIRED:SCB_SCHEMA_V2->SCB_SCHEMA_V10');
  }
  if (schema === 'SCB_SCHEMA_V3' || migration === 'SCB_MIGRATION_V3') {
    throw new Error('STORAGE_MIGRATION_REQUIRED:SCB_SCHEMA_V3->SCB_SCHEMA_V10');
  }
  if (schema === 'SCB_SCHEMA_V4' || migration === 'SCB_MIGRATION_V4') {
    throw new Error('STORAGE_MIGRATION_REQUIRED:SCB_SCHEMA_V4->SCB_SCHEMA_V10');
  }
  if (schema === 'SCB_SCHEMA_V5' || migration === 'SCB_MIGRATION_V5') {
    throw new Error('STORAGE_MIGRATION_REQUIRED:SCB_SCHEMA_V5->SCB_SCHEMA_V10');
  }
  if (schema === 'SCB_SCHEMA_V6' || migration === 'SCB_MIGRATION_V6') {
    throw new Error('STORAGE_MIGRATION_REQUIRED:SCB_SCHEMA_V6->SCB_SCHEMA_V10');
  }
  if (schema === 'SCB_SCHEMA_V7' || migration === 'SCB_MIGRATION_V7') {
    throw new Error('STORAGE_MIGRATION_REQUIRED:SCB_SCHEMA_V7->SCB_SCHEMA_V10');
  }
  if (schema === 'SCB_SCHEMA_V8' || migration === 'SCB_MIGRATION_V8') {
    throw new Error('STORAGE_MIGRATION_REQUIRED:SCB_SCHEMA_V8->SCB_SCHEMA_V10');
  }
  if (schema === 'SCB_SCHEMA_V9' || migration === 'SCB_MIGRATION_V9') {
    throw new Error('STORAGE_MIGRATION_REQUIRED:SCB_SCHEMA_V9->SCB_SCHEMA_V10');
  }
  if (schema && schema !== SCB_STORAGE_SCHEMA_VERSION) throw new Error('STORAGE_SCHEMA_VERSION_MISMATCH:' + schema);
  if (migration && migration !== SCB_STORAGE_MIGRATION_VERSION) throw new Error('STORAGE_MIGRATION_VERSION_MISMATCH:' + migration);
  if (!schema || !migration) {
    Object.keys(HEADERS).forEach(function(name) { validateSheetSchema_(getRuntimeSheet_(name)); });
  }
  if (!schema) props.setProperty(STORAGE_SCHEMA_PROPERTY, SCB_STORAGE_SCHEMA_VERSION);
  if (!migration) props.setProperty(STORAGE_MIGRATION_PROPERTY, SCB_STORAGE_MIGRATION_VERSION);
  return { schemaVersion:SCB_STORAGE_SCHEMA_VERSION, migrationVersion:SCB_STORAGE_MIGRATION_VERSION };
}


const CONFIG_PROPERTY_NAMES = Object.freeze({
  BOT_TOKEN: 'BOT_TOKEN',
  WEBHOOK_SECRET: 'WEBHOOK_SECRET',
  TESTER_USER_IDS: 'TESTER_USER_IDS',
  WEB_APP_URL: 'WEB_APP_URL',
  STORAGE_SPREADSHEET_ID: 'STORAGE_SPREADSHEET_ID'
});

let executionConfigMemo_ = null;
function resetExecutionConfigMemo_() { executionConfigMemo_ = null; }
function getConfig_() {
  if (executionConfigMemo_ !== null) return executionConfigMemo_;
  const properties = PropertiesService.getScriptProperties();
  executionConfigMemo_ = {
    botToken: properties.getProperty(CONFIG_PROPERTY_NAMES.BOT_TOKEN) || '',
    webhookSecret: properties.getProperty(CONFIG_PROPERTY_NAMES.WEBHOOK_SECRET) || '',
    testerUserIds: properties.getProperty(CONFIG_PROPERTY_NAMES.TESTER_USER_IDS) || '',
    webAppUrl: properties.getProperty(CONFIG_PROPERTY_NAMES.WEB_APP_URL) || '',
    storageSpreadsheetId: properties.getProperty(CONFIG_PROPERTY_NAMES.STORAGE_SPREADSHEET_ID) || ''
  };
  return executionConfigMemo_;
}

function configurationStatus_(config, options) {
  options = options || {};
  const missingProperties = [];
  const invalidProperties = [];
  if (options.requireBotToken !== false &&
      (typeof config.botToken !== 'string' || config.botToken.trim() === '' || config.botToken === 'YOUR_BOT_TOKEN_HERE')) {
    missingProperties.push(CONFIG_PROPERTY_NAMES.BOT_TOKEN);
  }
  if (options.requireWebhookSecret !== false) {
    const secretStatus = validateWebhookSecret_(config);
    if (secretStatus === 'missing') missingProperties.push(CONFIG_PROPERTY_NAMES.WEBHOOK_SECRET);
    if (secretStatus === 'too_short') invalidProperties.push(CONFIG_PROPERTY_NAMES.WEBHOOK_SECRET + ':too_short');
  }
  if (options.requireWebAppUrl === true &&
      (typeof config.webAppUrl !== 'string' || config.webAppUrl.trim() === '')) {
    missingProperties.push(CONFIG_PROPERTY_NAMES.WEB_APP_URL);
  }
  if (options.requireStorage === true &&
      (typeof config.storageSpreadsheetId !== 'string' || config.storageSpreadsheetId.trim() === '')) {
    missingProperties.push(CONFIG_PROPERTY_NAMES.STORAGE_SPREADSHEET_ID);
  }
  return Object.freeze({
    ok: missingProperties.length === 0 && invalidProperties.length === 0,
    missingProperties: Object.freeze(missingProperties.slice()),
    invalidProperties: Object.freeze(invalidProperties.slice())
  });
}

function bootstrapRuntime_(options) {
  options = options || {};
  const config = getConfig_();
  const status = configurationStatus_(config, options);
  if (!status.ok) return { ok: false, config: config, configuration: status };
  if (options.requireStorage === true) {
    Object.keys(HEADERS).forEach(function(name) { getRuntimeSheet_(name); });
    ensureStorageControlMetadata_();
  }
  return { ok: true, config: config, configuration: status };
}

// F42 CHANGE-CONTROL (Round 5, FIX-1, closes Round 4 Finding 2 — BLOCKER):
// reads TESTER_USER_IDS from Script Properties as a comma-separated list of
// raw Telegram user IDs (not participant row IDs, though F27's comment notes
// these are the same string per participant.id === String(telegramUserId) —
// see line ~130). Empty/unset property means no testers are allowlisted,
// i.e. /gate is unreachable by anyone until an operator explicitly
// configures it — fails closed, not open, consistent with F-D2/D3's
// documented invariant for the consent gate. Comparison is string-based via
// String(participantId) against a trimmed, split property value; no
// normalization beyond trim (Telegram user IDs are numeric strings with no
// case-sensitivity concern).
function isTesterParticipant_(participantId) {
  const raw = getConfig_().testerUserIds;
  const ids = raw.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
  return ids.indexOf(String(participantId)) >= 0;
}

// F59 (Prompt 3 design note, approved): operator-only reflection checkpoint
// control. Layer transitions remain a human judgment call; no participant
// command and no automated rule can open a checkpoint. R8 adds the public,
// zero-argument openConfiguredLayerReflectionCheckpoint() entry point below
// because Apps Script's editor Run action cannot supply arguments to this
// internal function. The public entry point reads an explicit one-time target
// and stage from Script Properties, validates them, fails closed, and clears
// the request only after an idempotent/successful open.
const OPERATOR_LAYER_CHECKPOINT_PROPERTIES = Object.freeze({
  TARGET_TELEGRAM_USER_ID: 'OPERATOR_LAYER_CHECKPOINT_TELEGRAM_USER_ID',
  STAGE: 'OPERATOR_LAYER_CHECKPOINT_STAGE'
});

function isAllowedLayerCheckpointStage_(stage) {
  return stage === 'L2_TO_L3' || stage === 'PILOT_END';
}

function normalizeOperatorTelegramUserId_(value) {
  const raw = String(value || '').trim();
  return /^[1-9][0-9]*$/.test(raw) ? raw : '';
}

function openLayerReflectionCheckpoint_(telegramUserId, stage) {
  const normalizedUserId = normalizeOperatorTelegramUserId_(telegramUserId);
  const normalizedStage = String(stage || '').trim();
  if (!normalizedUserId) throw new Error('INVALID_LAYER_CHECKPOINT_TARGET');
  if (!isAllowedLayerCheckpointStage_(normalizedStage)) throw new Error('UNKNOWN_LAYER_CHECKPOINT_STAGE');

  const rows = readRows_(getParticipantsSheet_());
  const matches = [];
  rows.forEach(function(row, index) {
    if (String(row[COLS.PARTICIPANTS.TELEGRAM_USER_ID]) === normalizedUserId) {
      matches.push({ row: row, index: index });
    }
  });
  if (matches.length === 0) throw new Error('PARTICIPANT_NOT_FOUND');
  if (matches.length > 1) throw new Error('PARTICIPANT_IDENTITY_NOT_UNIQUE');

  const match = matches[0];
  const row = match.row;
  const rowNumber = rowNumber_(match.index);
  const participantId = String(row[COLS.PARTICIPANTS.ID]);
  if (String(row[COLS.PARTICIPANTS.CONSENT_STATUS]) !== 'CONSENTED') {
    throw new Error('PARTICIPANT_NOT_CONSENTED');
  }
  if(String(row[COLS.PARTICIPANTS.WINDOW_STATUS]||'')===WINDOW_STATUS.EARLY_STOP) throw new Error('PARTICIPATION_STOPPED_REFLECTION_BLOCKED');

  // Compute the redacted fingerprint before any mutation. This also fails
  // closed if the deployment lacks the webhook-secret redaction key.
  const participantFp = participantFingerprint_(participantId);
  const currentFlag = String(row[COLS.PARTICIPANTS.LAYER_CHECKPOINT_FLAG] || '');
  const awaitingFlag = normalizedStage + LAYER_CHECKPOINT_AWAITING_SUFFIX;
  if (currentFlag === normalizedStage || currentFlag === awaitingFlag) {
    const status = currentFlag === awaitingFlag ? 'ALREADY_AWAITING' : 'ALREADY_OPEN';
    log_('LAYER_CHECKPOINT_ALREADY_OPEN', {
      participantFingerprint: participantFp,
      stage: normalizedStage,
      status: status
    });
    return { status: status, stage: normalizedStage, participantFingerprint: participantFp };
  }
  if (currentFlag) throw new Error('LAYER_CHECKPOINT_CONFLICT');

  if (!verifyRowIdentity_(getParticipantsSheet_(), rowNumber, COLS.PARTICIPANTS.ID, participantId, 'openLayerReflectionCheckpoint_')) {
    throw new Error('ROW_IDENTITY_MISMATCH');
  }
  storageSetValue_(getParticipantsSheet_(), rowNumber, COLS.PARTICIPANTS.LAYER_CHECKPOINT_FLAG + 1, normalizedStage, 'participant_layer_checkpoint');
  storageSetValue_(getParticipantsSheet_(), rowNumber, COLS.PARTICIPANTS.UPDATED_AT + 1, now_(), 'participant_updated_at');
  log_('LAYER_CHECKPOINT_OPENED', {
    participantFingerprint: participantFp,
    stage: normalizedStage,
    status: 'OPENED'
  });
  return { status: 'OPENED', stage: normalizedStage, participantFingerprint: participantFp };
}

// Public zero-argument Apps Script editor entry point. Operator procedure:
// set OPERATOR_LAYER_CHECKPOINT_TELEGRAM_USER_ID and
// OPERATOR_LAYER_CHECKPOINT_STAGE in Script Properties, then run this
// function once from the editor. Allowed stages are exactly L2_TO_L3 and
// PILOT_END. The properties are consumed only after OPENED/ALREADY_* so a
// validation or storage failure leaves the requested operation available
// for diagnosis/retry rather than silently discarding it.
function openConfiguredLayerReflectionCheckpoint() {
  const props = PropertiesService.getScriptProperties();
  const rawUserId = props.getProperty(OPERATOR_LAYER_CHECKPOINT_PROPERTIES.TARGET_TELEGRAM_USER_ID);
  const rawStage = props.getProperty(OPERATOR_LAYER_CHECKPOINT_PROPERTIES.STAGE);
  const telegramUserId = normalizeOperatorTelegramUserId_(rawUserId);
  const stage = String(rawStage || '').trim();

  if (!rawUserId || String(rawUserId).trim() === '') throw new Error('OPERATOR_LAYER_CHECKPOINT_TARGET_REQUIRED');
  if (!telegramUserId) throw new Error('OPERATOR_LAYER_CHECKPOINT_TARGET_INVALID');
  if (!rawStage || stage === '') throw new Error('OPERATOR_LAYER_CHECKPOINT_STAGE_REQUIRED');
  if (!isAllowedLayerCheckpointStage_(stage)) throw new Error('OPERATOR_LAYER_CHECKPOINT_STAGE_INVALID');

  const result = openLayerReflectionCheckpoint_(telegramUserId, stage);
  props.deleteProperty(OPERATOR_LAYER_CHECKPOINT_PROPERTIES.TARGET_TELEGRAM_USER_ID);
  props.deleteProperty(OPERATOR_LAYER_CHECKPOINT_PROPERTIES.STAGE);
  log_('OPERATOR_LAYER_CHECKPOINT_REQUEST_CONSUMED', {
    participantFingerprint: result.participantFingerprint,
    stage: result.stage,
    status: result.status
  });
  return result.status;
}

// F-D1 CHANGE NOTE (Section D fix pack, FIX-D1, fixes audit finding D1-1):
// isConfigured_ previously accepted any non-empty, non-placeholder
// WEBHOOK_SECRET, with no floor on length or entropy — an operator could
// set WEBHOOK_SECRET to a single character and the code would silently
// treat it as "configured," defeating the purpose of a second credential
// independent of BOT_TOKEN. WEBHOOK_SECRET_MIN_LENGTH is split out as its
// own named constant (rather than an inline magic number) so the floor is
// visible and adjustable in one place. 32 was chosen to match the length
// implied by the existing placeholder string itself
// ('YOUR_RANDOM_32_CHAR_SECRET_HERE'), not an arbitrary round number.
// validateWebhookSecret_ is a separate function (not inlined into
// isConfigured_) specifically so a too-short secret can be distinguished
// from a genuinely-missing one via its own log event
// (WEBHOOK_SECRET_TOO_SHORT vs the existing CONFIGURATION_INCOMPLETE) —
// an operator debugging "why won't my webhook authenticate" needs to know
// which of these two distinct problems they have. Retested: YES — confirmed
// configureWebhookOnce_/setTelegramWebhook still succeed end-to-end with a
// 32+ character secret, and a secret of exactly 32 characters is accepted
// (boundary is >=, not >), matching the placeholder string's own length.
const WEBHOOK_SECRET_MIN_LENGTH = 32;

function validateWebhookSecret_(config) {
  if (typeof config.webhookSecret !== 'string' || config.webhookSecret.trim() === '') {
    return 'missing';
  }
  if (config.webhookSecret === 'YOUR_RANDOM_32_CHAR_SECRET_HERE') return 'missing';
  if (config.webhookSecret.length < WEBHOOK_SECRET_MIN_LENGTH) return 'too_short';
  return 'ok';
}

function isConfigured_(config) {
  return configurationStatus_(config, {
    requireBotToken: true,
    requireWebhookSecret: true,
    requireWebAppUrl: false
  }).ok;
}
// The webhook secret is intentionally a query parameter because Apps Script web apps
// do not expose Telegram's arbitrary secret-token request header to doPost(e).
// F-D1 CHANGE NOTE: because Telegram's getWebhookInfo API echoes back the full
// registered webhook URL (including this secret_token query parameter) to
// anyone holding BOT_TOKEN, this secret is NOT independent of the bot token
// in practice — a leaked bot token also leaks this secret. This is a Telegram
// platform constraint, not a bug in this file, and has no code-level fix:
// Apps Script web apps have no other channel for Telegram to deliver a
// secret through. Practically, this means BOT_TOKEN secrecy is load-bearing
// for BOTH webhook control AND webhook-spoofing prevention, not just the
// former — this should be stated in operator setup instructions, not just
// here. (See also the length/entropy floor above: a short secret is
// meaningfully weaker on its own regardless of this exposure, so both are
// worth fixing/documenting independently.)
// LPR01 STAGING-ONLY INSTRUMENTATION — non-semantic, no participant/research storage.
const SCB_LPR_INSTRUMENTATION_VERSION = 'SCB_LPR_INSTRUMENTATION_V1';
let lprTimingContext_ = null;
function lprSafeTag_(value, maxLen) {
  const text = String(value === undefined || value === null ? '' : value).replace(/[^A-Za-z0-9_.:-]/g, '_');
  return text.slice(0, maxLen || 96);
}
function lprInitTiming_(e) {
  const entry = Date.now();
  const p = e && e.parameter ? e.parameter : {};
  const requestedEvidence = String(p.lpr_evidence_level || 'STAGING_RUNTIME');
  const evidenceLevel = requestedEvidence === 'STAGING_FAULT_INJECTION' ? requestedEvidence : 'STAGING_RUNTIME';
  lprTimingContext_ = {
    instrumentation_version: SCB_LPR_INSTRUMENTATION_VERSION,
    run_id: lprSafeTag_(p.lpr_run_id || '', 64),
    execution_id: entry.toString(36) + '-' + Math.floor(Math.random() * 0x100000000).toString(36),
    journey: lprSafeTag_(p.lpr_journey || '', 48),
    fixture_id: lprSafeTag_(p.lpr_fixture_id || '', 64),
    fixture_fingerprint: lprSafeTag_(p.lpr_fixture_fingerprint || '', 96),
    inter_sample_delay_ms: Number(p.lpr_inter_sample_delay_ms || 0) || 0,
    rate_limit_expected: String(p.lpr_rate_limit_expected || 'false') === 'true',
    rate_limit_observed: false,
    rate_limit_class: '',
    error_class: '',
    evidence_level: evidenceLevel,
    bot_service_call_counts: {},
    instrumentation_service_call_counts: {},
    t_webhook_entry: entry
  };
}
function lprMark_(name) { if (lprTimingContext_) lprTimingContext_[name] = Date.now(); }
function lprMarkFirst_(name) { if (lprTimingContext_ && lprTimingContext_[name] === undefined) lprTimingContext_[name] = Date.now(); }
function lprCountBotService_(name) {
  if (!lprTimingContext_) return;
  const key = String(name || 'unknown');
  lprTimingContext_.bot_service_call_counts[key] = Number(lprTimingContext_.bot_service_call_counts[key] || 0) + 1;
}
function lprSetRateLimitObserved_(klass) {
  if (!lprTimingContext_) return;
  lprTimingContext_.rate_limit_observed = true;
  lprTimingContext_.rate_limit_class = lprSafeTag_(klass || 'rate_limited', 48);
}
function lprSetErrorClass_(klass) { if (lprTimingContext_) lprTimingContext_.error_class = lprSafeTag_(klass || '', 64); }
function lprEmitTiming_() {
  if (!lprTimingContext_) return;
  const record = lprTimingContext_;
  lprTimingContext_ = null;
  // The one instrumentation I/O crossing occurs only after the inner doPost has released its ScriptLock.
  record.instrumentation_service_call_counts.console_log = 1;
  try { console.log('SCB_LPR_TIMING ' + JSON.stringify(record)); } catch (ignored) {}
}
function doPost(e) {
  resetExecutionConfigMemo_();
  try { lprInitTiming_(e); } catch (ignored) { lprTimingContext_ = null; }
  try { return lprDoPostInner_(e); }
  finally {
    lprMark_('t_webhook_complete');
    lprEmitTiming_();
  }
}

// SCB-03: send status is scoped to the held webhook execution.
let scbGateDeliveryState_ = 'NO_SEND';
function scbCommitGateClaim_(envelope, reservation, reason) {
  let state = IDEMPOTENCY_STATUS.COMMITTED;
  if (scbGateDeliveryState_ === 'UNKNOWN' || scbGateDeliveryState_ === 'FAILED' || String(reason) === 'GATE_FATAL')
    state = IDEMPOTENCY_STATUS.RECONCILIATION_REQUIRED;
  try {
    updateIdempotencyState_(envelope.updateId,envelope.userId,state,
      'GATE_'+String(reason)+':SEND='+scbGateDeliveryState_,reservation);
  } catch (error) {
    log_('GATE_CLAIM_FINALIZE_FAILED',{updateId:String(envelope.updateId),message:safeErrorMessage_(error)});
  }
  scbGateDeliveryState_ = 'NO_SEND';
}

// SCB-01/04/05: a dedicated bounded fast path; 3 distinct messages per user
// per rolling 60-second burst. Cache is non-durable; persistent idempotency
// is authoritative when available. Provider failures remain best effort.
const SCB_SAFETY_BURST_LIMIT = 3;
const SCB_SAFETY_BURST_SECONDS = 60;
let scbSafetyAlreadyReplied_ = false;
function scbSafetyBurstAllows_(userId) {
  try {
    const cache=CacheService.getScriptCache();
    const key='scb_safety_burst_'+String(userId);
    const current=Number(cache.get(key)||'0');
    if (current>=SCB_SAFETY_BURST_LIMIT) {cache.put(key,String(current),SCB_SAFETY_BURST_SECONDS);return false;}
    cache.put(key,String(current+1),SCB_SAFETY_BURST_SECONDS);
    return true;
  } catch(e) { log_('SAFETY_BURST_CACHE_UNAVAILABLE',{}); return true; }
}
function scbSafetyFallbackAllows_(userId) {
  try {
    const cache=CacheService.getScriptCache(),key='scb_safety_fallback_'+String(userId);
    if(cache.get(key)){cache.put(key,'1',SCB_SAFETY_BURST_SECONDS);return false;}
    cache.put(key,'1',SCB_SAFETY_BURST_SECONDS);
    return true;
  } catch(error) {log_('SAFETY_FALLBACK_CACHE_UNAVAILABLE',{});return false;}
}
const SCB_SAFETY_BOUNDED_FALLBACK = 'If you need urgent help, contact local emergency or crisis services now. Rest or seek support as needed. This does not confirm a session has closed.';
function scbSafetyGuidanceText_(command) {
  return command==='/acute'
    ? 'Get help now if you need urgent medical, safety, or crisis attention. No further reply is required. This message does not confirm that an existing session was closed.'
    : 'Rest now if you need recovery. No further reply is required. This message does not confirm that an existing session was closed.';
}
// TX-REPAIR A01/A02: provider delivery and protection are independent axes.
function scbSafetySecondaryEffects_(envelope,command) {
  let lookup;
  try { lookup=findExistingParticipantForSafetyGate_(envelope.userId); }
  catch(e){log_('SAFETY_PARTICIPANT_LOOKUP_ERROR',{updateId:String(envelope.updateId)});return {status:'EFFECT_PENDING',sessionId:''};}
  if(!lookup||!lookup.ok)return {status:'EFFECT_PENDING',sessionId:''};
  if(!lookup.exists||lookup.consentStatus!=='CONSENTED'||!lookup.participantId)return {status:'NOT_APPLICABLE',sessionId:''};
  let sessionId='';
  try {
    const participant=getParticipantById_(lookup.participantId);
    if(!participant||isParticipantResearchStopped_(participant))return {status:'NOT_APPLICABLE',sessionId:''};
    const current=getCurrentSession_(lookup.participantId);
    sessionId=current?String(current.sessionId):'';
    const resolutionState=command==='/acute'?STATES.ACUTE_EXIT:STATES.RECOVERY_EXIT;
    scbSafetyAlreadyReplied_=true;
    try {startStandaloneResolution_(participant,envelope.chatId,resolutionState);}
    finally {scbSafetyAlreadyReplied_=false;}
    return {status:'EFFECT_DONE',sessionId:sessionId};
  } catch(error){
    log_('SAFETY_SECONDARY_EFFECT_RECONCILIATION_REQUIRED',{updateId:String(envelope.updateId),kind:command,message:safeErrorMessage_(error)});
    return {status:'EFFECT_PENDING',sessionId:sessionId};
  }
}
function scbSafetyFinalize_(envelope,reservation,delivery,effect,command,targetSessionId) {
  // No new Sheet column: preserve independently parseable technical outcomes in RESULT.
  // An incomplete effect is NEVER a committed safety outcome.
  const done=delivery==='CONFIRMED'&&(effect==='EFFECT_DONE'||effect==='NOT_APPLICABLE');
  const result='SAFETY_'+delivery+'|'+String(effect)+'|COMMAND='+String(command||'')+'|TARGET_SESSION='+String(targetSessionId||'');
  try {updateIdempotencyState_(envelope.updateId,envelope.userId,
    done?IDEMPOTENCY_STATUS.COMMITTED:IDEMPOTENCY_STATUS.RECONCILIATION_REQUIRED,result,reservation);}
  catch(e){log_('SAFETY_LEDGER_FINALIZE_FAILED',{updateId:String(envelope.updateId),delivery:delivery,effect:effect});}
}
const SCB_SAFETY_RECONCILE_USER_ID_PROPERTY='SCB_SAFETY_RECONCILE_USER_ID';
const SCB_SAFETY_RECONCILE_UPDATE_ID_PROPERTY='SCB_SAFETY_RECONCILE_UPDATE_ID';
const SCB_SAFETY_RECONCILE_COMMIT_PROPERTY='SCB_SAFETY_RECONCILE_COMMIT';
const SCB_SAFETY_RECONCILE_EVIDENCE_PROPERTY='SCB_SAFETY_RECONCILE_EVIDENCE_REF';
const SCB_SAFETY_RECONCILE_DECISION_PROPERTY='SCB_SAFETY_RECONCILE_DECISION';
// CLOSURE-M01: Operator decisions are claim-scoped and independently validated.
// The original delivery/effect history is never erased. A terminal status alone
// is insufficient to release the research fence.
const SCB_SAFETY_RESOLUTION_VERSION = '1';
// Non-cryptographic accidental-corruption check, not an authorization token.
// Authority remains the protected operator route, lock and evidence review.
function scbSafetyResolutionChecksum_(text) {
  let n=2166136261;
  for(let i=0;i<text.length;i++){n^=text.charCodeAt(i);n=Math.imul(n,16777619)>>>0;}
  return ('00000000'+n.toString(16)).slice(-8);
}
function scbSafetyClaimModel_(row) {
  const value=String(row[COLS.IDEMPOTENCY.RESULT]||'');
  if(value.indexOf('SAFETY_')!==0)return {safety:false};
  const parts=value.split('|');
  const head=parts[0],effect=parts[1]||'';
  const initial={safety:true,head:head,effect:effect,result:value,
    status:String(row[COLS.IDEMPOTENCY.PROCESSING_STATUS]||''),
    updateId:String(row[COLS.IDEMPOTENCY.UPDATE_ID]||''),
    userId:String(row[COLS.IDEMPOTENCY.USER_ID]||''),
    target:'',command:'',resolved:false,malformed:false};
  // A historical marker is not silently made harmless by the status label.
  const rawTarget=parts.filter(p=>p.indexOf('TARGET_SESSION=')===0);
  const rawCommand=parts.filter(p=>p.indexOf('COMMAND=')===0);
  if(rawTarget.length>1||rawCommand.length>1)initial.malformed=true;
  initial.target=rawTarget.length===1?rawTarget[0].slice(15):'';
  initial.command=rawCommand.length===1?rawCommand[0].slice(8):'';
  const ix=parts.lastIndexOf('RESOLUTION_V='+SCB_SAFETY_RESOLUTION_VERSION);
  if(ix<0)return initial;
  // A legacy OPERATOR_DECISION without versioned identity binding is not proof.
  // The versioned suffix must be unique, exact, and last in the result.
  if(parts.filter(p=>p.indexOf('RESOLUTION_V=')===0).length!==1 || parts.length!==ix+7)
    {initial.malformed=true;return initial;}
  const keys=['RESOLUTION_USER=','RESOLUTION_UPDATE=','RESOLUTION_TARGET=','OPERATOR_DECISION=','EVIDENCE=','INTEGRITY='];
  for(let j=0;j<keys.length;j++)if(parts[ix+1+j].indexOf(keys[j])!==0)
    {initial.malformed=true;return initial;}
  const user=parts[ix+1].slice(keys[0].length),update=parts[ix+2].slice(keys[1].length),
    target=parts[ix+3].slice(keys[2].length),decision=parts[ix+4].slice(keys[3].length),
    evidence=parts[ix+5].slice(keys[4].length);
  const validEvidence=!!evidence&&evidence.length<=100&&/^[a-zA-Z0-9._:-]+$/.test(evidence);
  const beforeIntegrity=parts.slice(0,ix+6).join('|');
  const checksum=parts[ix+6].slice(keys[5].length);
  const integrityValid=/^[0-9a-f]{8}$/.test(checksum)&&scbSafetyResolutionChecksum_(beforeIntegrity)===checksum;
  initial.resolved=!initial.malformed&&integrityValid&&user===initial.userId&&update===initial.updateId&&
    target===initial.target&&!!user&&!!update&&validEvidence&&
    (decision==='EFFECT_VERIFIED'||decision==='CONTACT_AND_RIGHTS_RESOLVED')&&
    initial.status===IDEMPOTENCY_STATUS.RECONCILED;
  return initial;
}
function scbInspectConfiguredSafetyReconciliation() {
  // Only project editors can invoke this operator-only entrypoint. No Telegram send.
  const props=PropertiesService.getScriptProperties();
  const userId=String(props.getProperty(SCB_SAFETY_RECONCILE_USER_ID_PROPERTY)||'').trim();
  const updateId=String(props.getProperty(SCB_SAFETY_RECONCILE_UPDATE_ID_PROPERTY)||'').trim();
  if(!userId||!updateId||!/^[A-Za-z0-9_-]+$/.test(userId)||!/^[A-Za-z0-9_-]+$/.test(updateId))
    throw new Error('SAFETY_RECONCILE_IDS_REQUIRED');
  const lock=LockService.getScriptLock();let held=false;
  try{
    lock.waitLock(30000);held=true;
    const rec=getIdempotencyRecord_(updateId,userId);
    if(!rec||String(rec.result||'').indexOf('SAFETY_')!==0)throw new Error('SAFETY_RECONCILE_CLAIM_NOT_FOUND');
    const raw=rec.row;
    if(!raw||String(raw[COLS.IDEMPOTENCY.USER_ID])!==userId||
       String(raw[COLS.IDEMPOTENCY.UPDATE_ID])!==updateId)throw new Error('SAFETY_RECONCILE_CLAIM_IDENTITY_MISMATCH');
    const model=scbSafetyClaimModel_(raw);
    if(model.resolved || (rec.status===IDEMPOTENCY_STATUS.COMMITTED&&!scbSafetyClaimUnresolved_(raw)))
      return {status:'ALREADY_COMPLETE',claimStatus:rec.status};
    if(model.malformed)throw new Error('SAFETY_RECONCILE_MALFORMED_CLAIM');
    if(rec.status===IDEMPOTENCY_STATUS.RECONCILED && model.result.indexOf('RESOLUTION_V=')>=0)
      throw new Error('SAFETY_RECONCILE_CONFLICTING_RESOLUTION');
    let current=null;
    if(model.target){
      // getCurrentSession_ expects participant ID, never Telegram user ID.
      const lookup=findExistingParticipantForSafetyGate_(userId);
      if(!lookup||!lookup.ok||!lookup.exists||!lookup.participantId)
        throw new Error('SAFETY_RECONCILE_PARTICIPANT_UNAVAILABLE');
      current=getCurrentSession_(lookup.participantId);
      if(!current||String(current.sessionId)!==model.target)
        throw new Error('SAFETY_RECONCILE_TARGET_SESSION_CHANGED');
    }
    const commit=String(props.getProperty(SCB_SAFETY_RECONCILE_COMMIT_PROPERTY)||'')==='YES';
    if(!commit)return {status:'DRY_RUN',claimStatus:rec.status,result:rec.result,targetSessionId:model.target,
      currentSessionId:current?String(current.sessionId):'',manualReviewRequired:true};
    const evidence=String(props.getProperty(SCB_SAFETY_RECONCILE_EVIDENCE_PROPERTY)||'').trim();
    const decision=String(props.getProperty(SCB_SAFETY_RECONCILE_DECISION_PROPERTY)||'').trim();
    if(!evidence||evidence.length>100||!/^[a-zA-Z0-9._:-]+$/.test(evidence))
      throw new Error('SAFETY_RECONCILE_EVIDENCE_REQUIRED');
    if(decision!=='EFFECT_VERIFIED'&&decision!=='CONTACT_AND_RIGHTS_RESOLVED')
      throw new Error('SAFETY_RECONCILE_INVALID_DECISION');
    const suffix='|RESOLUTION_V='+SCB_SAFETY_RESOLUTION_VERSION+
      '|RESOLUTION_USER='+userId+'|RESOLUTION_UPDATE='+updateId+'|RESOLUTION_TARGET='+model.target+
      '|OPERATOR_DECISION='+decision+'|EVIDENCE='+evidence;
    const unsignedResult=String(rec.result)+suffix;
    const nextResult=unsignedResult+'|INTEGRITY='+scbSafetyResolutionChecksum_(unsignedResult);
    updateIdempotencyState_(updateId,userId,IDEMPOTENCY_STATUS.RECONCILED,nextResult);
    const reread=getIdempotencyRecord_(updateId,userId);
    if(!reread||reread.status!==IDEMPOTENCY_STATUS.RECONCILED||reread.result!==nextResult||
       !reread.row||!scbSafetyClaimModel_(reread.row).resolved || scbSafetyClaimUnresolved_(reread.row))
      throw new Error('SAFETY_RECONCILE_READBACK_FAILED');
    [SCB_SAFETY_RECONCILE_COMMIT_PROPERTY,SCB_SAFETY_RECONCILE_EVIDENCE_PROPERTY,SCB_SAFETY_RECONCILE_DECISION_PROPERTY,
      SCB_SAFETY_RECONCILE_USER_ID_PROPERTY,SCB_SAFETY_RECONCILE_UPDATE_ID_PROPERTY].forEach(k=>props.deleteProperty(k));
    return {status:'OPERATOR_ADJUDICATED_NO_AUTO_SEND',targetSessionId:model.target,evidenceRef:evidence};
  }finally{if(held)lock.releaseLock();}
}
function scbSafetyClaimUnresolved_(row) {
  const m=scbSafetyClaimModel_(row);
  if(!m.safety)return false;
  if(m.malformed)return true;
  if(m.status===IDEMPOTENCY_STATUS.RECONCILED)return !m.resolved;
  if(m.status!==IDEMPOTENCY_STATUS.COMMITTED)return true;
  if(m.head==='SAFETY_BURST_SUPPRESSED')return false;
  // Only known, genuinely terminal safety outcomes can pass the guard.
  return !(m.head==='SAFETY_CONFIRMED' && (m.effect==='EFFECT_DONE'||m.effect==='NOT_APPLICABLE'));
}
function scbHasUnresolvedSafety_(userId) {
  // Fail closed if the technical safety ledger is unavailable. All claims for
  // this participant must be independently adjudicated before the fence lifts.
  return readRows_(getIdempotencySheet_()).some(r=>
    String(r[COLS.IDEMPOTENCY.USER_ID])===String(userId)&&scbSafetyClaimUnresolved_(r));
}
function scbHandleStatelessSafety_(envelope,command) {
  let lock=null,held=false,reservation=null,claimed=false;
  try {
    try {lock=LockService.getScriptLock();lock.waitLock(1500);held=true;currentScriptLockContext_=lock;}
    catch(e){log_('SAFETY_LOCK_UNAVAILABLE',{updateId:String(envelope.updateId)});}
    if(held){
      try {
        if(isDeletedUpdateReplay_(envelope.userId,envelope.updateId))return;
        if(getIdempotencyRecord_(envelope.updateId,envelope.userId))return;
        // QUAL-SAFETY-01: create a durable safety-typed claim in the SAME append.
        // A crash after the append and before delivery must retain the safety fence.
        reservation=recordUpdateProcessing_(envelope.updateId,envelope.userId,
          'SAFETY_PREPARED|COMMAND='+String(command));claimed=true;
      }catch(e){log_('SAFETY_LEDGER_UNAVAILABLE',{updateId:String(envelope.updateId)});}
    }
    if(!scbSafetyBurstAllows_(envelope.userId)){
      if(scbSafetyFallbackAllows_(envelope.userId)){
        let fallback={ok:false,unknown:true};
        try{fallback=sendTelegramDetailed_(SCB_SAFETY_BOUNDED_FALLBACK,envelope.chatId);}
        catch(e){log_('SAFETY_FALLBACK_SEND_EXCEPTION',{updateId:String(envelope.updateId)});}
        if(claimed)scbSafetyFinalize_(envelope,reservation,fallback.ok?'CONFIRMED':(fallback.unknown?'UNCERTAIN':'FAILED'),'NOT_APPLICABLE','fallback');
      }else if(claimed){
        try{updateIdempotencyState_(envelope.updateId,envelope.userId,IDEMPOTENCY_STATUS.COMMITTED,'SAFETY_BURST_SUPPRESSED',reservation);}
        catch(e){log_('SAFETY_BURST_LEDGER_FAILED',{updateId:String(envelope.updateId)});}
      }
      return;
    }
    let outcome={ok:false,unknown:true};
    try{outcome=sendTelegramDetailed_(scbSafetyGuidanceText_(command),envelope.chatId);}
    catch(e){log_('SAFETY_SEND_EXCEPTION',{updateId:String(envelope.updateId),message:safeErrorMessage_(e)});}
    const delivery=outcome.ok?'CONFIRMED':(outcome.unknown?'UNCERTAIN':'KNOWN_FAILED');
    // A confirmed provider failure must never perform an unannounced terminal closure.
    // Leave a technical protection fence pending for supervised resolution.
    let effect={status:'PROTECTION_PENDING',sessionId:''};
    if(delivery==='CONFIRMED'&&held)effect=scbSafetySecondaryEffects_(envelope,command);
    else if(delivery==='CONFIRMED')effect={status:'EFFECT_PENDING',sessionId:''};
    if(claimed)scbSafetyFinalize_(envelope,reservation,delivery,effect.status,command,effect.sessionId);
    if(!held||!claimed||effect.status==='EFFECT_PENDING'||delivery!=='CONFIRMED')
      log_('SAFETY_RECONCILIATION_REQUIRED',{updateId:String(envelope.updateId),delivery:delivery,effect:effect.status,sessionId:effect.sessionId||'',durable:claimed});
  }finally{
    scbSafetyAlreadyReplied_=false;
    if(currentScriptLockContext_===lock)currentScriptLockContext_=null;
    if(held)lock.releaseLock();
  }
}

function lprDoPostInner_(e) {
  const runtime = bootstrapRuntime_({
    requireBotToken: true,
    requireWebhookSecret: true,
    requireWebAppUrl: false,
    requireStorage: false
  });
  const config = runtime.config;
  if (!runtime.ok) {
    log_('CONFIGURATION_INCOMPLETE', {
      missingProperties: runtime.configuration.missingProperties,
      invalidProperties: runtime.configuration.invalidProperties
    });
    return ok_();
  }

  const suppliedSecret = e && e.parameter ? e.parameter.secret_token : '';
  if (!constantTimeEqual_(suppliedSecret, config.webhookSecret)) {
    log_('WEBHOOK_AUTH_REJECTED', {});
    return HtmlService.createHtmlOutput('Invalid secret');
  }

  const rawContents = (e && e.postData && e.postData.contents) || '';
  let update;
  try {
    update = JSON.parse(rawContents);
  } catch (error) {
    log_('PAYLOAD_PARSE_ERROR', { message: safeErrorMessage_(error) });
    return ok_();
  }

  const validated = validateTelegramUpdate_(update);
  if (!validated.ok) {
    log_('UPDATE_REJECTED', {
      updateId: validated.updateId || '',
      reason: validated.reason,
      chatType: validated.chatType || ''
    });
    return ok_();
  }
  const envelope = validated.envelope;
  const updateId = String(envelope.updateId);

  // SCB-01/04/05: authenticated private-chat safety guidance is independent of
  // consent, timezone, membership, ordinary throttling, and research rows.
  // Actual research effects are best effort AFTER guidance; never imply
  // a session was closed unless storage confirms it.
  if (envelope.callbackData === null && !envelope.unsupportedMessageType) {
    const safetyAddress = scbResolveTelegramCommandText_(envelope.text);
    if (safetyAddress.accepted) {
      const safetyCommand = String(safetyAddress.text || '').trim().toLowerCase();
      if (safetyCommand === '/acute' || safetyCommand === '/recovery') {
        scbHandleStatelessSafety_(envelope, safetyCommand);
        return ok_();
      }
    }
  }

  // Acknowledge Telegram callbacks before any early-return path so a rate-limited
  // button press does not leave Telegram's client-side spinner pending. If the
  // acknowledgement succeeds, clear only callbackQueryId so downstream gate logic
  // cannot acknowledge the same callback twice; callbackData remains intact.
  if (envelope.callbackQueryId !== null) {
    const callbackQueryId = envelope.callbackQueryId;
    lprMark_('t_callback_ack_start');
    if (answerCallbackQuery_(callbackQueryId)) envelope.callbackQueryId = null;
    lprMark_('t_callback_ack_result');
  }

  // TX-REPAIR A07: rate quota checked only for a NEW durable update under ScriptLock.
  const lock = LockService.getScriptLock();
  let lockAcquired = false;
  try {
    try {
      lprMark_('t_lock_request');
      lock.waitLock(30000);
      lprMark_('t_lock_acquired');
      lockAcquired = true;
      currentScriptLockContext_ = lock;
    } catch (lockError) {
      log_('LOCK_TIMEOUT', { updateId:updateId, userId:String(envelope.userId), chatId:String(envelope.chatId), kind:envelope.callbackData !== null ? 'callback' : 'message', message:safeErrorMessage_(lockError) });
      try { sendTelegram_('That took too long to process — please try again.', envelope.chatId); }
      catch (notifyError) { log_('LOCK_TIMEOUT_NOTIFY_FAILED', { updateId:updateId, message:safeErrorMessage_(notifyError) }); }
      return ok_();
    }

    if (isDeletedUpdateReplay_(envelope.userId, envelope.updateId)) {
      log_('DELETED_UPDATE_REPLAY_IGNORED', { updateFingerprint: deletionUpdateFingerprint_(envelope.userId, envelope.updateId) });
      return ok_();
    }

    const existing = getIdempotencyRecord_(envelope.updateId, envelope.userId);
    lprMark_('t_idempotency_resolved');
    if (existing) {
      const effective = reconcileIdempotencyFromOperation_(existing);
      if (effective.status === IDEMPOTENCY_STATUS.COMMITTED || effective.status === IDEMPOTENCY_STATUS.RECONCILED) {
        log_('UPDATE_ALREADY_PROCESSED', { updateId:updateId, status:effective.status, operationId:effective.operationId || '' });
      } else {
        log_('UPDATE_REQUIRES_RECONCILIATION', { updateId:updateId, status:effective.status, operationId:effective.operationId || '' });
      }
      return ok_();
    }

    // TX-REPAIR A07: dedupe first, then charge quota once per NEW update.
    // Distinct floods still use the unchanged burst-until-idle cache limiter.
    if (isRateLimited_(envelope.userId)) {
      lprMark_('t_rate_limit_complete');
      lprSetRateLimitObserved_('burst_until_idle_drop');
      let rateClaim;
      try {rateClaim=recordUpdateProcessing_(envelope.updateId,envelope.userId);}
      catch(err){log_('RATE_LIMIT_CLAIM_STORAGE_UNAVAILABLE',{updateId:updateId});return ok_();}
      let sendStatus='NOT_SENT';
      if(!wasAlreadyNotifiedThisWindow_(envelope.userId)){
        try {const response=sendTelegramDetailed_("You're sending updates a bit fast — please wait a few seconds and try again.",envelope.chatId);
          sendStatus=response.ok?'CONFIRMED':(response.unknown?'UNCERTAIN':'FAILED');}
        catch(err){sendStatus='UNCERTAIN';}
      }
      try {updateIdempotencyState_(envelope.updateId,envelope.userId,
        sendStatus==='UNKNOWN'||sendStatus==='UNCERTAIN'||sendStatus==='FAILED'?IDEMPOTENCY_STATUS.RECONCILIATION_REQUIRED:IDEMPOTENCY_STATUS.COMMITTED,
        'RATE_LIMIT_'+sendStatus,rateClaim);}
      catch(err){log_('RATE_LIMIT_CLAIM_FINALIZE_FAILED',{updateId:updateId});}
      log_('TECHNICAL_MISSINGNESS',{cause:'rate_limit_drop',updateId:updateId,userId:String(envelope.userId)});
      return ok_();
    }
    lprMark_('t_rate_limit_complete');

    // SCB-03: claim update BEFORE Gate's owner, membership, locked and
    // data-rights side effects. This table is technical, not a participant row.
    // On a replay of an in-progress/uncertain claim we fail closed rather
    // than repeat a privileged operation or an ambiguous Telegram send.
    let gateReservation;
    try { gateReservation = recordUpdateProcessing_(envelope.updateId, envelope.userId); }
    catch (claimError) {
      log_('GATE_UPDATE_CLAIM_FAILED', {updateId:updateId, message:safeErrorMessage_(claimError)});
      return ok_();
    }
    scbGateDeliveryState_ = 'NO_SEND';

    // R17 ChannelGate integration: enforce channel verification only after the
    // existing replay/idempotency guards and while this exact ScriptLock is held,
    // but before any Signal Calibration operation or participant record is created.
    // The R15 boundary remains fail-closed even if the companion module is missing
    // or unexpectedly throws.
    let channelGateAllowed = false;
    try {
      if (typeof channelGateAllows_ !== 'function') throw new Error('CHANNEL_GATE_UNAVAILABLE');
      channelGateAllowed = channelGateAllows_(envelope, lock) === true;
      lprMark_('t_channel_gate_complete');
    } catch (gateError) {
      lprMark_('t_channel_gate_complete');
      log_('CHANNEL_GATE_FATAL', {
        updateId:updateId,
        userId:String(envelope.userId),
        message:safeErrorMessage_(gateError)
      });
      scbCommitGateClaim_(envelope,gateReservation,'GATE_FATAL');
      return ok_();
    }
    if (!channelGateAllowed) {
      scbCommitGateClaim_(envelope,gateReservation,'GATE_HANDLED');
      return ok_();
    }

    // Code-only pre-launch remediation: a verified private non-text update
    // (voice/photo/video/audio/etc.) is not research input, but silently
    // dropping it leaves a participant who is awaiting an answer with no
    // usable recovery cue. Give modality guidance before any participant or
    // research mutation. No transcription or media-content processing occurs.
    if (envelope.unsupportedMessageType === true) {
      try {
        sendTelegram_('I can only use text messages and the buttons shown by the bot. Please type your answer or tap a button. If you need to recover your place, use /start.', envelope.chatId);
        log_('UNSUPPORTED_MESSAGE_GUIDANCE_SENT', { updateId:updateId, userId:String(envelope.userId), chatId:String(envelope.chatId) });
      } catch (notifyError) {
        log_('UNSUPPORTED_MESSAGE_GUIDANCE_FAILED', { updateId:updateId, message:safeErrorMessage_(notifyError) });
      }
      scbCommitGateClaim_(envelope,gateReservation,'UNSUPPORTED_MESSAGE');
      return ok_();
    }

    let operation = null;
    let operationInitializationFailed = true;
    let idempotencyReserved = true;
    let idempotencyReservation = gateReservation;
    try {
      operation = beginOperation_(envelope.updateId, envelope.userId, 'telegram_update', envelope.chatId);
      operationInitializationFailed = false;
      // Bind the already-reserved technical claim to the new Core operation.
      if (idempotencyReservation && idempotencyReservation.rowNumber) {
        storageSetValue_(getIdempotencySheet_(), idempotencyReservation.rowNumber,
          COLS.IDEMPOTENCY.OPERATION_ID + 1, operation.operationId, 'gate_claim_operation_bind');
        idempotencyReservation.operationId = operation.operationId;
      }
      markOperationStage_('IDEMPOTENCY_PROCESSING');

      // TX-REPAIR A04/A01: do not accept research inputs while a participant
      // has an unresolved session replacement or safety-protection claim.
      const commandText=String(envelope.text||'').trim().toLowerCase();
      const nonResearchControl=/^\/(stop|privacy|delete-data|delete_data|help|export-data|export_data)(?:\s|$)/.test(commandText);
      if(!nonResearchControl && (scbHasUnreconciledCreation_(String(envelope.userId)) || scbHasUnresolvedSafety_(String(envelope.userId)))){
        log_('RESEARCH_FENCED_PENDING_RECONCILIATION',{updateId:updateId,userId:String(envelope.userId)});
        sendTelegram_('This session needs an operator check before research can continue. /privacy and /delete-data remain available.',envelope.chatId);
        commitOperation_();
        updateIdempotencyState_(envelope.updateId,envelope.userId,IDEMPOTENCY_STATUS.COMMITTED,'RESEARCH_FENCED_NO_MUTATION',idempotencyReservation);
        return ok_();
      }
      const participant = getOrCreateParticipant_(envelope.userId, envelope.chatId);
      lprMark_('t_participant_resolved');
      markOperationStage_('PARTICIPANT_RESOLVED');

      if (envelope.callbackData !== null) handleCallback_(participant, envelope.callbackData, envelope.chatId);
      else handleCommandOrText_(participant, envelope.text, envelope.chatId, envelope.messageId);
      lprMark_('t_business_mutation_complete');

      if (currentOperationContext_ && (currentOperationContext_.participantDataDeleted || currentOperationContext_.dataDeletionOperationPurged)) {
        log_('UPDATE_PROCESSED_AFTER_DELETION', { updateFingerprint: deletionUpdateFingerprint_(envelope.userId, envelope.updateId), deletionAuditId: currentOperationContext_.deletionAuditId || '' });
      } else {
        commitOperation_();
        lprMark_('t_operation_complete');
        const result = 'BUSINESS_MUTATIONS_COMMITTED;SEND=' + String(operation.sendStatus || 'NO_SEND_RECORDED');
        try { updateIdempotencyState_(envelope.updateId, envelope.userId, IDEMPOTENCY_STATUS.COMMITTED, result, idempotencyReservation); }
        catch (idError) { log_('IDEMPOTENCY_RESULT_WRITE_FAILED', { updateId:updateId, operationId:operation.operationId, message:safeErrorMessage_(idError) }); }
        log_('UPDATE_PROCESSED', { updateId:updateId, userId:String(envelope.userId), operationId:operation.operationId, sendStatus:operation.sendStatus || '' });
      }
    } catch (error) {
      try {
        if (!currentOperationContext_ || currentOperationContext_.status !== OPERATION_STATUS.COMMITTED) failOperation_(error);
        lprMark_('t_operation_complete');
      } catch (operationError) { log_('OPERATION_FAILURE_RECORD_ERROR', { message:safeErrorMessage_(operationError) }); }
      const category = classifyProcessingError_(error);
      lprSetErrorClass_(category);
      if (idempotencyReserved) {
        if(operationInitializationFailed){
          try {
            const orphan=scbFindOperationByUpdate_(envelope.updateId,envelope.userId);
            if(orphan && idempotencyReservation && idempotencyReservation.rowNumber){
              storageSetValue_(getIdempotencySheet_(),idempotencyReservation.rowNumber,COLS.IDEMPOTENCY.OPERATION_ID+1,String(orphan.row[COLS.OPERATIONS.OPERATION_ID]),'orphan_operation_bind');
              idempotencyReservation.operationId=String(orphan.row[COLS.OPERATIONS.OPERATION_ID]);
            }
          } catch(orphanError){log_('OPERATION_ORPHAN_LOOKUP_FAILED',{updateId:updateId});}
        }
        try { updateIdempotencyState_(envelope.updateId, envelope.userId, operationInitializationFailed?IDEMPOTENCY_STATUS.RECONCILIATION_REQUIRED:IDEMPOTENCY_STATUS.FAILED, (operationInitializationFailed?'OPERATION_INIT_FAILED:':'PROCESSING_FAILED:') + category, idempotencyReservation); }
        catch (idError) { log_('IDEMPOTENCY_FAILURE_WRITE_FAILED', { updateId:updateId, message:safeErrorMessage_(idError) }); }
      }
      log_('WEBHOOK_PROCESSING_ERROR', { updateId:updateId, category:category, message:safeErrorMessage_(error) });
      if (category === 'processing' || category === 'schema_corruption') {
        const message = category === 'schema_corruption'
          ? 'There\'s a data problem on our end that needs an operator to fix. Please try again later, or contact the bot operator if this repeats.'
          : 'Something went wrong processing that. Please try again.';
        try { sendTelegram_(message, envelope.chatId); }
        catch (notifyError) { log_('WEBHOOK_ERROR_NOTIFY_FAILED', { updateId:updateId, message:safeErrorMessage_(notifyError) }); }
      }
    } finally {
      clearOperationContext_();
    }
  } finally {
    if (currentScriptLockContext_ === lock) currentScriptLockContext_ = null;
    if (lockAcquired) lock.releaseLock();
    if (lockAcquired) lprMark_('t_lock_released');
  }
  return ok_();
}

function validTelegramInteger_(value, allowNegative) {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && (allowNegative ? value !== 0 : value > 0);
}

function validateTelegramUpdate_(update) {
  const updateId = update && validTelegramInteger_(update.update_id, false) ? update.update_id : null;
  if (updateId === null) return {ok:false, reason:'invalid_update_id', updateId:''};

  if (update.message) {
    const message=update.message, chat=message.chat, from=message.from;
    if (!chat || !from) return {ok:false, reason:'message_identity_missing', updateId:String(updateId)};
    if (!validTelegramInteger_(from.id, false) || !validTelegramInteger_(chat.id, true)) return {ok:false, reason:'message_identity_invalid', updateId:String(updateId)};
    const chatType=String(chat.type || '');
    if (chatType !== 'private') return {ok:false, reason:'private_chat_required', updateId:String(updateId), chatType:chatType};
    if (!validTelegramInteger_(message.message_id, false)) return {ok:false, reason:'message_id_invalid', updateId:String(updateId), chatType:chatType};
    const unsupportedMessageType = typeof message.text !== 'string';
    return {ok:true, envelope:{updateId:updateId, chatId:chat.id, chatType:chatType, userId:from.id, text:unsupportedMessageType?'':message.text.trim(), messageId:message.message_id, callbackData:null, callbackQueryId:null, unsupportedMessageType:unsupportedMessageType}};
  }

  if (update.callback_query) {
    const cb=update.callback_query, chat=cb.message && cb.message.chat, from=cb.from;
    if (!chat || !from) return {ok:false, reason:'callback_identity_missing', updateId:String(updateId)};
    if (!validTelegramInteger_(from.id, false) || !validTelegramInteger_(chat.id, true)) return {ok:false, reason:'callback_identity_invalid', updateId:String(updateId)};
    const chatType=String(chat.type || '');
    if (chatType !== 'private') return {ok:false, reason:'private_chat_required', updateId:String(updateId), chatType:chatType};
    if (typeof cb.id !== 'string' || cb.id.trim()==='' || typeof cb.data !== 'string' || cb.data.trim()==='') return {ok:false, reason:'callback_fields_invalid', updateId:String(updateId), chatType:chatType};
    return {ok:true, envelope:{updateId:updateId, chatId:chat.id, chatType:chatType, userId:from.id, text:'', messageId:null, callbackData:cb.data, callbackQueryId:cb.id}};
  }
  return {ok:false, reason:'unsupported_update_type', updateId:String(updateId)};
}

function getUpdateEnvelope_(update) {
  const validated=validateTelegramUpdate_(update);
  return validated.ok ? validated.envelope : null;
}

function ok_() {
  return HtmlService.createHtmlOutput('OK');
}

function constantTimeEqual_(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i++) mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return mismatch === 0;
}

function telegramApiResponse_(response) {
  const status = response && response.getResponseCode ? response.getResponseCode() : 0;
  let body=null, parseError=false;
  try { body=JSON.parse(response.getContentText()); } catch (error) { parseError=true; }
  return {
    httpStatus: status,
    parseError: parseError,
    ok: !!(body && body.ok === true),
    result: body ? body.result : undefined,
    errorCode: body && body.error_code !== undefined ? body.error_code : null,
    description: body && typeof body.description === 'string' ? body.description : '',
    retryAfter: body && body.parameters && typeof body.parameters.retry_after === 'number' ? body.parameters.retry_after : null
  };
}

function answerCallbackQuery_(callbackQueryId) {
  if (!callbackQueryId) return false;
  const config = getConfig_();
  if (!isConfigured_(config)) { log_('TELEGRAM_CALLBACK_ACK_SKIPPED', {reason:'configuration_incomplete'}); return false; }
  try {
    lprCountBotService_('telegram.answerCallbackQuery');
    const response=UrlFetchApp.fetch('https://api.telegram.org/bot'+config.botToken+'/answerCallbackQuery',{method:'post',contentType:'application/json',payload:JSON.stringify({callback_query_id:callbackQueryId}),muteHttpExceptions:true});
    const api=telegramApiResponse_(response);
    if (api.httpStatus < 200 || api.httpStatus >= 300 || !api.ok) {
      log_('TELEGRAM_CALLBACK_ACK_FAILED',{status:api.httpStatus,errorCode:api.errorCode,description:api.description,parseError:api.parseError});
      return false;
    }
    return true;
  } catch(error) { log_('TELEGRAM_CALLBACK_ACK_ERROR',{message:safeErrorMessage_(error)}); return false; }
}

const TELEGRAM_SAFE_TEXT_LIMIT = 3800;
const TELEGRAM_MAX_SEND_ATTEMPTS = 2;
const TELEGRAM_RETRY_BASE_MS = 250;

function telegramPlainText_(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi,'\n').replace(/<\/p>/gi,'\n').replace(/<[^>]*>/g,'')
    .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&');
}
function splitTelegramText_(text, limit) {
  const value=String(text || ''), max=limit || TELEGRAM_SAFE_TEXT_LIMIT;
  if (value.length <= max) return [value];
  const out=[]; let rest=value;
  while (rest.length > max) {
    let cut=rest.lastIndexOf('\n',max);
    if (cut < Math.floor(max*0.55)) cut=rest.lastIndexOf(' ',max);
    if (cut < Math.floor(max*0.55)) cut=max;
    out.push(rest.slice(0,cut)); rest=rest.slice(cut).replace(/^\s+/,'');
  }
  if (rest.length) out.push(rest);
  return out;
}
function prepareTelegramParts_(text, keyboard) {
  const raw=String(text || '');
  if (raw.length <= TELEGRAM_SAFE_TEXT_LIMIT) return [{text:raw,parseMode:'HTML',keyboard:keyboard || null}];
  const plain=telegramPlainText_(raw), chunks=splitTelegramText_(plain,TELEGRAM_SAFE_TEXT_LIMIT);
  return chunks.map((chunk,i)=>({text:chunk,parseMode:null,keyboard:i===chunks.length-1 ? (keyboard || null) : null}));
}
function markSendOutcome_(status) { markOperationSend_(status); return status; }

function sendTelegramPart_(part, chatId, partIndex, partCount) {
  const config=getConfig_();
  const body={chat_id:chatId,text:part.text,disable_web_page_preview:true};
  if (part.parseMode) body.parse_mode=part.parseMode;
  if (part.keyboard) body.reply_markup={inline_keyboard:part.keyboard};
  let totalSleep=0;
  for (let attempt=1; attempt<=TELEGRAM_MAX_SEND_ATTEMPTS; attempt++) {
    markOperationSend_('ATTEMPT_'+attempt+'_PART_'+partIndex+'_OF_'+partCount);
    let response;
    try {
      lprCountBotService_('telegram.sendMessage');
      response=UrlFetchApp.fetch('https://api.telegram.org/bot'+config.botToken+'/sendMessage',{method:'post',contentType:'application/json',payload:JSON.stringify(body),muteHttpExceptions:true});
    } catch(error) {
      log_('TELEGRAM_SEND_ERROR',{chatId:String(chatId),attempt:attempt,part:partIndex,message:safeErrorMessage_(error)});
      markSendOutcome_('UNKNOWN_DELIVERY_EXCEPTION_PART_'+partIndex);
      return {ok:false,knownFailure:false,unknown:true};
    }
    const api=telegramApiResponse_(response);
    if (api.httpStatus>=200 && api.httpStatus<300 && api.ok) {
      const messageId=api.result && validTelegramInteger_(api.result.message_id,false) ? api.result.message_id : null;
      if(messageId===null) log_('TELEGRAM_SEND_MESSAGE_ID_UNCONFIRMED',{chatId:String(chatId),part:partIndex,status:api.httpStatus});
      markSendOutcome_('TELEGRAM_ACCEPTED_PART_'+partIndex+'_OF_'+partCount);
      return {ok:true,knownFailure:false,unknown:false,messageId:messageId};
    }
    log_('TELEGRAM_SEND_FAILED',{chatId:String(chatId),status:api.httpStatus,attempt:attempt,part:partIndex,errorCode:api.errorCode,description:api.description,parseError:api.parseError});

    if (api.httpStatus===429 && !api.parseError && api.ok===false && attempt<TELEGRAM_MAX_SEND_ATTEMPTS) {
      const waitMs=retryAfterMs_(response);
      if (waitMs!==null && totalSleep+waitMs<=RETRY_AFTER_CEILING_MS) { Utilities.sleep(waitMs); totalSleep+=waitMs; continue; }
    }
    if (api.httpStatus>=500 && api.httpStatus<600 && !api.parseError && api.ok===false && attempt<TELEGRAM_MAX_SEND_ATTEMPTS) {
      const waitMs=Math.min(TELEGRAM_RETRY_BASE_MS*Math.pow(2,attempt-1),RETRY_AFTER_CEILING_MS-totalSleep);
      if(waitMs>0){ Utilities.sleep(waitMs); totalSleep+=waitMs; continue; }
    }
    // Network exceptions, malformed 2xx, and unparseable 5xx outcomes are not retried:
    // Telegram has no idempotency key for sendMessage, so retrying an ambiguous
    // acceptance can duplicate a participant-facing message. Retries are limited to
    // explicit API rejection (429 or parseable 5xx with ok:false).
    const unknown = ((api.httpStatus>=500 && api.parseError) || (api.httpStatus>=200 && api.httpStatus<300 && api.parseError));
    markSendOutcome_((unknown?'UNKNOWN_DELIVERY_':'FAILED_')+'HTTP_'+api.httpStatus+'_PART_'+partIndex);
    return {ok:false,knownFailure:!unknown,unknown:unknown};
  }
  markSendOutcome_('FAILED_RETRY_EXHAUSTED_PART_'+partIndex);
  return {ok:false,knownFailure:true,unknown:false};
}

function sendTelegramDetailed_(text, chatId, keyboard) {
  lprMarkFirst_('t_first_send_start');
  markOperationSend_('INTENT_RECORDED');
  const config=getConfig_();
  if (!isConfigured_(config)) { log_('TELEGRAM_SEND_SKIPPED',{reason:'configuration_incomplete'}); markOperationSend_('SKIPPED_CONFIGURATION'); return {ok:false,complete:false,highestMessageId:null,knownFailure:true,unknown:false}; }
  const parts=prepareTelegramParts_(text,keyboard);
  if (parts.length>1) log_('TELEGRAM_MESSAGE_SPLIT',{chatId:String(chatId),parts:parts.length,originalLength:String(text||'').length});
  let accepted=0, highestMessageId=null, allMessageIdsConfirmed=true;
  for (let i=0;i<parts.length;i++) {
    const result=sendTelegramPart_(parts[i],chatId,i+1,parts.length);
    lprMarkFirst_('t_first_send_result');
    if (!result.ok) {
      const status=accepted>0 ? 'PARTIAL_SEND_'+accepted+'_OF_'+parts.length : (result.unknown?'UNKNOWN_DELIVERY':'SEND_FAILED');
      markOperationSend_(status);
      logSendExhausted_(chatId,text,status);
      return {ok:false,complete:false,highestMessageId:highestMessageId,knownFailure:!!result.knownFailure,unknown:!!result.unknown};
    }
    accepted++;
    if(validTelegramInteger_(result.messageId,false)) highestMessageId=highestMessageId===null?result.messageId:Math.max(highestMessageId,result.messageId);
    else allMessageIdsConfirmed=false;
  }
  markOperationSend_('TELEGRAM_ACCEPTED_'+accepted+'_PARTS');
  return {ok:true,complete:allMessageIdsConfirmed&&accepted===parts.length&&highestMessageId!==null,highestMessageId:highestMessageId,knownFailure:false,unknown:false};
}

let currentPromptOwnerContext_ = null;
function withPromptOwnerContext_(context, fn) {
  const prior=currentPromptOwnerContext_;
  currentPromptOwnerContext_=context||null;
  try { return fn(); }
  finally { currentPromptOwnerContext_=prior; }
}
function promptBarrierRecord_(owner, chatId, promptMessageId) {
  return {owner:String(owner||''),chat_id:String(chatId),prompt_message_id:Number(promptMessageId),delivery_status:'TELEGRAM_ACCEPTED_COMPLETE',established_at:now_()};
}
function readVerifiedSessionOwner_(context) {
  if(!context||!verifyRowIdentity_(getSessionsSheet_(),context.rowNumber,COLS.SESSIONS.SESSION_ID,context.sessionId,'prompt_barrier_session_owner')) return null;
  const width=COLS.SESSIONS.PAYLOAD-COLS.SESSIONS.STATE+1;
  const row=getSessionsSheet_().getRange(context.rowNumber,COLS.SESSIONS.STATE+1,1,width).getValues()[0];
  const state=String(row[0]||''), version=Number(row[COLS.SESSIONS.STATE_VERSION-COLS.SESSIONS.STATE]);
  if(state!==String(context.state)||version!==Number(context.stateVersion)) return null;
  let payload={}; try{payload=JSON.parse(row[COLS.SESSIONS.PAYLOAD-COLS.SESSIONS.STATE]||'{}');}catch(e){return null;}
  return {state:state,stateVersion:version,payload:payload};
}
function persistSessionPromptBarrier_(context, promptMessageId) {
  const current=readVerifiedSessionOwner_(context); if(!current) return false;
  const barrier=Object.assign(promptBarrierRecord_('SESSION',context.chatId,promptMessageId),{session_id:String(context.sessionId),state:current.state,state_version:current.stateVersion});
  const payload=Object.assign({},current.payload,{_prompt_barrier:barrier});
  if(isReviewState_(current.state) && payload.review_resume_pending===true && payload.review_pause_reconciliation!==REVIEW_PAUSE_RECONCILIATION.REQUIRED) {
    const latch=reviewReconciliationLatchStatus_(context.participantId,context.sessionId);
    if(latch.ok&&!latch.required) payload.review_resume_pending=false;
  }
  storageSetValue_(getSessionsSheet_(),context.rowNumber,COLS.SESSIONS.PAYLOAD+1,JSON.stringify(payload),'session_prompt_barrier');
  const verified=readVerifiedSessionOwner_(context); if(!verified) return false;
  const b=verified.payload&&verified.payload._prompt_barrier;
  const ok=!!(b&&String(b.owner)==='SESSION'&&String(b.session_id)===String(context.sessionId)&&String(b.state)===String(context.state)&&Number(b.state_version)===Number(context.stateVersion)&&String(b.chat_id)===String(context.chatId)&&Number(b.prompt_message_id)===Number(promptMessageId)&&String(b.delivery_status)==='TELEGRAM_ACCEPTED_COMPLETE');
  if(ok && context.session) context.session.payload=verified.payload;
  return ok;
}
function persistSetupPromptBarrier_(context, promptMessageId) {
  const current=currentSetup_(context.participantId);
  if(!current||current.status!=='ACTIVE'||Number(current.version)!==Number(context.setupVersion)||current.step!==SETUP_STEP.TIMEZONE) return false;
  const details=Object.assign({},current.details||{});
  details._prompt_barrier=Object.assign(promptBarrierRecord_('SETUP_TIMEZONE',context.chatId,promptMessageId),{participant_id:String(context.participantId),setup_version:Number(context.setupVersion),step:'TIMEZONE'});
  appendSetupSnapshot_(context.participantId,current.version,current.step,current.action,current.status,details);
  const verified=currentSetup_(context.participantId), b=verified&&verified.details&&verified.details._prompt_barrier;
  return !!(verified&&verified.status==='ACTIVE'&&Number(verified.version)===Number(context.setupVersion)&&verified.step===SETUP_STEP.TIMEZONE&&b&&String(b.owner)==='SETUP_TIMEZONE'&&String(b.participant_id)===String(context.participantId)&&Number(b.setup_version)===Number(context.setupVersion)&&String(b.step)==='TIMEZONE'&&String(b.chat_id)===String(context.chatId)&&Number(b.prompt_message_id)===Number(promptMessageId)&&String(b.delivery_status)==='TELEGRAM_ACCEPTED_COMPLETE');
}
const REFLECTION_PROMPT_BARRIER_EVENT = 'REFLECTION_PROMPT_BARRIER_ESTABLISHED';
function reflectionGeneration_(participant, stage) {
  const history=participant&&Array.isArray(participant.layerTransitionReflection)?participant.layerTransitionReflection:[];
  return 1+history.filter(function(x){return x&&String(x.stage||'')===String(stage||'');}).length;
}
function persistReflectionPromptBarrier_(context, promptMessageId) {
  const latest=getParticipantById_(context.participantId);
  if(!latest||String(latest.layerCheckpointFlag||'')!==String(context.awaitingFlag)) return false;
  const generation=reflectionGeneration_(latest,context.stage);
  if(Number(generation)!==Number(context.generation)) return false;
  const details=Object.assign(promptBarrierRecord_('REFLECTION',context.chatId,promptMessageId),{participant_id:String(context.participantId),stage:String(context.stage),generation:Number(context.generation),awaiting_flag:String(context.awaitingFlag)});
  appendEvent_(context.participantId,'',REFLECTION_PROMPT_BARRIER_EVENT,details);
  const b=latestReflectionPromptBarrier_(context.participantId,context.stage,context.generation,context.awaitingFlag,context.chatId);
  return !!(b&&Number(b.prompt_message_id)===Number(promptMessageId));
}
function persistPromptBarrierForContext_(context, promptMessageId) {
  if(!context||!validTelegramInteger_(promptMessageId,false)) return false;
  if(context.owner==='SESSION') return persistSessionPromptBarrier_(context,promptMessageId);
  if(context.owner==='SETUP_TIMEZONE') return persistSetupPromptBarrier_(context,promptMessageId);
  if(context.owner==='REFLECTION') return persistReflectionPromptBarrier_(context,promptMessageId);
  return false;
}
function sendTelegram_(text, chatId, keyboard) {
  if (scbSafetyAlreadyReplied_) { log_('SAFETY_SECONDARY_SEND_SUPPRESSED',{}); return true; }
  const result=sendTelegramDetailed_(text,chatId,keyboard);
  if(result.ok && currentPromptOwnerContext_) {
    if(result.complete) {
      try {
        if(!persistPromptBarrierForContext_(currentPromptOwnerContext_,result.highestMessageId)) log_('PROMPT_BARRIER_PERSIST_FAILED',{owner:String(currentPromptOwnerContext_.owner||''),participantId:String(currentPromptOwnerContext_.participantId||''),chatId:String(chatId)});
      } catch(error) { log_('PROMPT_BARRIER_PERSIST_ERROR',{owner:String(currentPromptOwnerContext_.owner||''),participantId:String(currentPromptOwnerContext_.participantId||''),chatId:String(chatId),message:safeErrorMessage_(error)}); }
    } else {
      log_('PROMPT_BARRIER_NOT_ESTABLISHED',{owner:String(currentPromptOwnerContext_.owner||''),participantId:String(currentPromptOwnerContext_.participantId||''),chatId:String(chatId),reason:'PROMPT_MESSAGE_ID_UNCONFIRMED'});
    }
  }
  return result.ok;
}

function contentFingerprint_(text) {
  const value = String(text || '');
  if (!value) return { length: 0, fingerprint: '' };
  const digestBytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value);
  const hex = digestBytes.map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2, '0')).join('');
  return { length: value.length, fingerprint: hex.slice(0, 12) };
}

// Fires once per sendTelegram_ call whose bounded delivery policy cannot confirm
// a complete Telegram API acceptance. This includes explicit failure, ambiguous
// transport/API outcomes, and partial multi-part sends after state may have committed.
// This is deliberately a single, distinctly-named, greppable event separate
// from the per-attempt TELEGRAM_SEND_FAILED/TELEGRAM_SEND_ERROR logs above,
// so an operator can search logs for exactly "notification confirmed not
// delivered" without having to correlate multi-attempt log sequences.
// F-D5 CHANGE NOTE: previously logged a raw 200-character sample of the
// outgoing message text. Several rendered states echo the participant's own
// typed answer back to them (e.g. FOCAL's confirmation), so this could and
// did leak actual participant free-text content into execution logs, which
// showConsent_ never discloses as a data location (audit finding D5-1). Now
// logs a length + short content fingerprint instead — an operator can still
// confirm which specific send failed and correlate it against the actual
// content in Sessions/SignalHistory (which is unaffected; only this log copy
// changes), but can no longer reconstruct the participant's answer from the
// log alone. This is a real reduction in one specific operational
// capability (manually resending from the log sample) in exchange for
// closing the content-leak — see FIX-D5's change-control disclosure for why
// this trade was made rather than the alternative (disclosing logs in
// showConsent_ instead, which was used for the lower-sensitivity ID logging
// elsewhere in this file, but not for this higher-sensitivity content path).
function logSendExhausted_(chatId, text, reason) {
  const fp = contentFingerprint_(text);
  log_('TELEGRAM_SEND_EXHAUSTED_NOTIFICATION_LOST', {
    chatId: String(chatId),
    reason: reason,
    textLength: fp.length,
    textFingerprint: fp.fingerprint
  });
}

// Best-effort normalized Telegram failure detail for internal logging. Never includes
// the raw response body, token, webhook URL, or participant message content.
function telegramErrorDetail_(response) {
  const api=telegramApiResponse_(response);
  const out={};
  if (api.description) out.description=api.description;
  if (api.errorCode!==null) out.errorCode=api.errorCode;
  if (api.parseError) out.parseError=true;
  return out;
}

const RETRY_AFTER_CEILING_MS = 5000;
function retryAfterMs_(response) {
  const api=telegramApiResponse_(response);
  if (typeof api.retryAfter === 'number' && api.retryAfter > 0) {
    const requestedMs=api.retryAfter*1000;
    if (requestedMs>RETRY_AFTER_CEILING_MS) return null;
    return Math.max(requestedMs,TELEGRAM_RETRY_BASE_MS);
  }
  return TELEGRAM_RETRY_BASE_MS;
}

let currentRenderSessionBinding_ = '';
function sessionCallbackTag_(sessionId) {
  const value=String(sessionId||'');
  if(!value) return '';
  const digestBytes=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,'session-callback:'+value);
  const hex=digestBytes.map(b=>(b<0?b+256:b).toString(16).padStart(2,'0')).join('');
  // 24 hex chars = 96 bits. This is collision-resistant while leaving enough
  // callback_data budget for the longest current action plus a 10-digit version.
  return hex.slice(0,24);
}
function button_(label, action, version) {
  const binding=currentRenderSessionBinding_ ? ('|' + currentRenderSessionBinding_) : '';
  const data=action + '|' + version + binding;
  if (data.length > 64) throw new Error('CALLBACK_DATA_TOO_LONG:' + action);
  return { text: label, callback_data: data };
}

function readRows_(sheet) {
  return storageReadRows_(sheet);
}

// F36 CHANGE NOTE: this function's column-*count* check (expectedColumns,
// unchanged in meaning from before F36) is no longer the whole story — see
// the header-*identity* check added below it. The count check alone is what
// F32 found insufficient: it passes unchanged when an operator swaps two
// same-arity columns, since swapping doesn't change how many columns exist.
// The header check closes that specific gap by comparing actual header cell
// text against HEADERS, so a swap (same count, wrong order/identity) is now
// caught here, at the same call site every existing caller already goes
// through (readRows_ -> validateSheetSchema_, i.e. every sheet read).
function validateSheetSchema_(sheet) {
  const name = sheet.getName();
  const expectedColumns = {
    Participants: COLS.PARTICIPANTS.COUNT,
    Sessions: COLS.SESSIONS.COUNT,
    Events: COLS.EVENTS.COUNT,
    Idempotency: COLS.IDEMPOTENCY.COUNT,
    SignalHistory: COLS.SIGNAL_HISTORY.COUNT,
    Operations: COLS.OPERATIONS.COUNT,
    CorruptionQuarantine: COLS.CORRUPTION_QUARANTINE.COUNT,
    MigrationLog: COLS.MIGRATION_LOG.COUNT,
    SetupHistory: COLS.SETUP_HISTORY.COUNT,
    ConsentHistory: COLS.CONSENT_HISTORY.COUNT,
    TimezoneHistory: COLS.TIMEZONE_HISTORY.COUNT,
    DataControlRequests: COLS.DATA_CONTROL_REQUESTS.COUNT,
    DataControlAudit: COLS.DATA_CONTROL_AUDIT.COUNT,
    CalibrationCycles: COLS.CALIBRATION_CYCLES.COUNT,
    LearningRecords: COLS.LEARNING_RECORDS.COUNT,
    AdjustmentPlans: COLS.ADJUSTMENT_PLANS.COUNT,
    StudyRuns: COLS.STUDY_RUNS.COUNT,
    TeachingExposure: COLS.TEACHING_EXPOSURE.COUNT,
    LayerDecisions: COLS.LAYER_DECISIONS.COUNT,
    InterventionEpisodes: COLS.INTERVENTION_EPISODES.COUNT,
    TransferEpisodes: COLS.TRANSFER_EPISODES.COUNT,
    EvidenceObservations: COLS.EVIDENCE_OBSERVATIONS.COUNT,
    EvidenceAssessments: COLS.EVIDENCE_ASSESSMENTS.COUNT
  }[name];

  if (!expectedColumns) {
    throw new Error('UNKNOWN_SHEET_SCHEMA:' + name);
  }

  const actualColumns = sheet.getLastColumn();
  // actualColumns === 0 means the sheet has never been written to at all —
  // no header, no data. getOrCreateSheet_ now writes a header immediately on
  // creation, so this should be rare/transient in practice, but it is kept
  // as a tolerated case (matching pre-F36 behavior) rather than an error,
  // since a header-writing bug elsewhere shouldn't turn "empty sheet" into a
  // hard failure for every downstream read.
  if (actualColumns === 0) throw new Error('SCHEMA_EMPTY_WITHOUT_HEADER:' + name);

  if (actualColumns !== expectedColumns) {
    throw new Error('SCHEMA_COLUMN_COUNT_MISMATCH:' + name);
  }

  // F36: header-identity check. Compares row 1's actual text against
  // HEADERS[name] cell-by-cell (not just "is a header present") so a
  // same-arity column swap is caught: the count check above already passed
  // (same COUNT either way), but the label at the swapped position won't
  // match what HEADERS expects there. This runs only when expectedColumns
  // headroom exists (actualColumns matched above), so there's always at
  // least one row present to read from — sheet.getRange(1, 1, ...) on a
  // sheet with data starting at row 1 (i.e., pre-migration, headerless) is
  // exactly the corruption/staleness case this is meant to catch, not a
  // crash risk: it will read data-row values into the comparison and
  // legitimately fail the check, which is correct — a headerless sheet with
  // this file's current (post-F36) expectations IS a schema mismatch until
  // migrateHeaderRow_ has run. See that function's own note for the
  // one-time migration path.
  const actualHeaders = sheet.getRange(1, 1, 1, expectedColumns).getValues()[0].map(String);
  const expectedHeaders = HEADERS[name];
  for (let i = 0; i < expectedHeaders.length; i++) {
    if (actualHeaders[i] !== expectedHeaders[i]) {
      throw new Error('SCHEMA_HEADER_MISMATCH:' + name + ':col' + (i + 1) +
        ':expected=' + expectedHeaders[i] + ':actual=' + actualHeaders[i]);
    }
  }
}


function rowNumber_(arrayIndex) {
  return ROWS.FIRST_DATA + arrayIndex;
}

function findExistingParticipantForSafetyGate_(telegramUserId) {
  try {
    const spreadsheet=getSpreadsheet_();
    const participantSheet=spreadsheet.getSheetByName('Participants');
    if(!participantSheet) return {ok:false,exists:false,participantId:'',consentStatus:'',reason:'PARTICIPANTS_SHEET_ABSENT'};
    const rows=storageReadRows_(participantSheet);
    const matches=[];
    for(let i=0;i<rows.length;i++) {
      if(String(rows[i][COLS.PARTICIPANTS.TELEGRAM_USER_ID])===String(telegramUserId)) matches.push(rows[i]);
    }
    if(matches.length===0) return {ok:true,exists:false,participantId:'',consentStatus:''};
    if(matches.length!==1) return {ok:false,exists:false,participantId:'',consentStatus:'',reason:'AMBIGUOUS_PARTICIPANT_ROWS'};
    const row=matches[0];
    return {ok:true,exists:true,participantId:String(row[COLS.PARTICIPANTS.ID]||''),consentStatus:String(row[COLS.PARTICIPANTS.CONSENT_STATUS]||'')};
  } catch(error) {
    return {ok:false,exists:false,participantId:'',consentStatus:'',reason:'PARTICIPANT_READ_FAILED'};
  }
}

function getOrCreateParticipant_(telegramUserId, telegramChatId) {
  // PE03 CHANGE-CONTROL: this function may create the pre-consent/setup identity
  // row. Its existence is NOT durable participation evidence and must never
  // consume lifetime eligibility; entitlement is reconciled only by
  // ensureParticipantRunEnrollment_() after its existing enrollment read-back.
  const rows = readRows_(getParticipantsSheet_());
  const existingIndex = rows.findIndex(row => String(row[COLS.PARTICIPANTS.TELEGRAM_USER_ID]) === String(telegramUserId));
  if (existingIndex >= 0) return participantFromRow_(rows[existingIndex], rowNumber_(existingIndex));
  const now = now_();
  // P06: TIMEZONE starts empty. Missing/invalid timezone blocks day-dependent
  // flows; there is no default. The append-only TimezoneHistory store records
  // effective-from correction provenance once a valid IANA zone is supplied.
  const runRef=activeRunRef_(); const row = [String(telegramUserId), telegramUserId, telegramChatId, 'UNKNOWN', '', now, now, '', '', '[]', runRef, participantRoleForRun_(runRef), '', WINDOW_STATUS.ACTIVE];
  storageAppendRow_(getParticipantsSheet_(), row, 'participant_create');
  return participantFromRow_(row, getParticipantsSheet_().getLastRow());
}

function participantFromRow_(row, rowNumber) {
  // F59: layerCheckpointFlag stores which reflection checkpoint (if any) is
  // currently open for this participant — '' (none), 'L2_TO_L3', or
  // 'PILOT_END'. layerTransitionReflection is the stored JSON array of
  // { stage, text, answered_at } entries, parsed defensively so a
  // pre-F59 row (empty string, from readRows_'s width-padding) or any
  // unexpected stored value never throws here.
  let layerTransitionReflection = [];
  const rawReflection = row[COLS.PARTICIPANTS.LAYER_TRANSITION_REFLECTION];
  if (rawReflection) {
    try {
      const parsed = JSON.parse(rawReflection);
      if (Array.isArray(parsed)) layerTransitionReflection = parsed;
    } catch (e) {
      log_('LAYER_TRANSITION_REFLECTION_PARSE_FAILED', { rowNumber: rowNumber, raw: String(rawReflection) });
    }
  }
  return {
    id: String(row[COLS.PARTICIPANTS.ID]),    telegramUserId: row[COLS.PARTICIPANTS.TELEGRAM_USER_ID],    chatId: row[COLS.PARTICIPANTS.TELEGRAM_CHAT_ID],    consentStatus: row[COLS.PARTICIPANTS.CONSENT_STATUS],    timezone: row[COLS.PARTICIPANTS.TIMEZONE],    layerCheckpointFlag: row[COLS.PARTICIPANTS.LAYER_CHECKPOINT_FLAG] || '',    layerTransitionReflection: layerTransitionReflection,    runRef: row[COLS.PARTICIPANTS.RUN_REF] || '', participantRole: row[COLS.PARTICIPANTS.PARTICIPANT_ROLE] || '', enrolledProjectDay: row[COLS.PARTICIPANTS.ENROLLED_PROJECT_DAY] || '', windowStatus: row[COLS.PARTICIPANTS.WINDOW_STATUS] || WINDOW_STATUS.ACTIVE,    rowNumber: rowNumber
  };
}


// F28 CHANGE NOTE — see full change-control note further below (near the
// STATES declaration) for rationale and scope. This helper re-verifies that
// a row captured earlier in the same execution (via its rowNumber) still
// contains the expected ID before a write proceeds, guarding against an
// operator manually editing/inserting/deleting Sheets rows mid-execution,
// which can silently shift what a stale rowNumber actually points at.
// Returns true if the row still matches; false (and logs distinctly) if it
// doesn't, or if the row is now out of range entirely (e.g. rows deleted
// above it). Never throws — a mismatch is reported to the caller to handle,
// not escalated to an exception, since this is a defensive check on data
// that is otherwise attacker-free (only an operator with Sheets edit access
// can trigger it).
function verifyRowIdentity_(sheet, rowNumber, idColumnZeroBased, expectedId, context) {
  const lastRow = sheet.getLastRow();
  if (rowNumber < ROWS.FIRST_DATA || rowNumber > lastRow) {
    log_('ROW_IDENTITY_MISMATCH', {
      context: context, reason: 'row_out_of_range', rowNumber: rowNumber, lastRow: lastRow, expectedId: String(expectedId)
    });
    return false;
  }
  const actualId = String(sheet.getRange(rowNumber, idColumnZeroBased + 1).getValue());
  if (actualId !== String(expectedId)) {
    log_('ROW_IDENTITY_MISMATCH', {
      context: context, reason: 'id_mismatch', rowNumber: rowNumber, expectedId: String(expectedId), actualId: actualId
    });
    return false;
  }
  return true;
}

function updateParticipantConsent_(participant, status) {
  if (!verifyRowIdentity_(getParticipantsSheet_(), participant.rowNumber, COLS.PARTICIPANTS.ID, participant.id, 'updateParticipantConsent_')) return false;
  const now = now_();
  storageSetValues_(getParticipantsSheet_(), participant.rowNumber, COLS.PARTICIPANTS.CONSENT_STATUS + 1, [[status, status === 'CONSENTED' ? now : '']], 'participant_consent');
  storageSetValue_(getParticipantsSheet_(), participant.rowNumber, COLS.PARTICIPANTS.UPDATED_AT + 1, now, 'participant_updated_at');
  const persisted = getParticipantsSheet_().getRange(participant.rowNumber, COLS.PARTICIPANTS.CONSENT_STATUS + 1, 1, 2).getValues()[0];
  if (String(persisted[0]) !== String(status)) return false;
  if (status === 'CONSENTED' && !persisted[1]) return false;
  participant.consentStatus = status;
  return true;
}

// F59 (Prompt 3 design note, approved): appends one { stage, text,
// answered_at } entry to this participant's layer_transition_reflection
// array and clears their layer_checkpoint_flag back to '' (closing the
// checkpoint, so /reflect returns to its "not yet" reply until Hirbod
// opens the next one). Deliberately participant-level, not
// session-level — see design note §3 for why this does not live in
// Sessions' payload/other_claims alongside §10's per-day fields.
// Mirrors updateParticipantConsent_'s verify-then-write pattern.
function recordLayerTransitionReflection_(participant, stage, text) {
  if (!verifyRowIdentity_(getParticipantsSheet_(), participant.rowNumber, COLS.PARTICIPANTS.ID, participant.id, 'recordLayerTransitionReflection_')) {
    return false;
  }
  const now = now_();
  const updated = participant.layerTransitionReflection.slice();
  updated.push({ stage: stage, text: text, answered_at: now });
  storageSetValues_(getParticipantsSheet_(), participant.rowNumber, COLS.PARTICIPANTS.LAYER_CHECKPOINT_FLAG + 1, [['', JSON.stringify(updated)]], 'participant_layer_reflection');
  storageSetValue_(getParticipantsSheet_(), participant.rowNumber, COLS.PARTICIPANTS.UPDATED_AT + 1, now, 'participant_updated_at');
  participant.layerCheckpointFlag = '';
  participant.layerTransitionReflection = updated;
  return true;
}

function sessionFromRow_(row, rowNumber) {
  return {
    sessionId: row[COLS.SESSIONS.SESSION_ID], participantId: String(row[COLS.SESSIONS.PARTICIPANT_ID]),
    projectDay: row[COLS.SESSIONS.PROJECT_DAY], state: row[COLS.SESSIONS.STATE], stateVersion: Number(row[COLS.SESSIONS.STATE_VERSION]),
    startedAt: row[COLS.SESSIONS.STARTED_AT], updatedAt: row[COLS.SESSIONS.UPDATED_AT], completedAt: row[COLS.SESSIONS.COMPLETED_AT],
    activityStatus: row[COLS.SESSIONS.ACTIVITY_STATUS], rowNumber: rowNumber, runRef: String(row[COLS.SESSIONS.RUN_REF] || ''),
    payload: parseSessionPayload_(row[COLS.SESSIONS.PAYLOAD], rowNumber, row[COLS.SESSIONS.SESSION_ID])
  };
}
function findSessionById_(sessionId) {
  if (!sessionId) return null;
  const rows = storageReadRows_(getSessionsSheet_());
  const idx = rows.findIndex(r => String(r[COLS.SESSIONS.SESSION_ID]) === String(sessionId));
  return idx < 0 ? null : sessionFromRow_(rows[idx], rowNumber_(idx));
}
function getActiveSessions_(participantId) {
  const rows=readRows_(getSessionsSheet_()), out=[];
  rows.forEach((row,index)=>{
    if(String(row[COLS.SESSIONS.PARTICIPANT_ID])!==String(participantId)) return;
    const session=sessionFromRow_(row,rowNumber_(index));
    // P06 code-only pre-launch remediation: a prior webhook can fail after the
    // terminal Session row is durable but before its linked transition effects
    // (STATE_TRANSITION event / CalibrationCycle terminalization / review-cycle
    // finalization / marker clear) complete. Any later ordinary participant
    // contact already scans this participant's Sessions here. Reconcile such a
    // terminal marker from that same scan before downstream logic treats the
    // Session as fully complete. This adds no extra Sessions table read in the
    // normal case and is idempotent because the transition-effects reconciler
    // checks each linked effect before writing it.
    if(TERMINAL_STATES.indexOf(String(session.state||''))>=0 && session.payload && session.payload[SESSION_TRANSITION_EFFECTS_PENDING_KEY]) {
      reconcilePendingSessionTransitionEffects_(session);
    }
    if(String(row[COLS.SESSIONS.ACTIVITY_STATUS])!==ACTIVE_STATUS) return;
    out.push(session);
  });
  out.sort((a,b)=>{
    const ta=Date.parse(a.updatedAt||a.startedAt||0)||0, tb=Date.parse(b.updatedAt||b.startedAt||0)||0;
    if(ta!==tb) return tb-ta;
    if(Number(a.stateVersion)!==Number(b.stateVersion)) return Number(b.stateVersion)-Number(a.stateVersion);
    return Number(b.rowNumber)-Number(a.rowNumber);
  });
  return out;
}
function getCurrentSession_(participantId) {
  const active=getActiveSessions_(participantId);
  if(active.length>1) log_('MULTIPLE_ACTIVE_SESSIONS',{participantId:String(participantId),count:active.length,selectedSessionId:active[0].sessionId});
  lprMarkFirst_('t_session_resolved');
  return active.length?active[0]:null;
}

// CS04 surgical remediation: read-only authority for deciding whether another
// ordinary morning may start on the participant's canonical project day.
// This helper deliberately does not use SignalHistory or CalibrationCycles and
// does not call parseSessionPayload_ because that parser can write quarantine
// records. Authorization reads must not mutate research state or repair data.
const KNOWN_NON_MORNING_SESSION_SOURCES_ = Object.freeze([
  'STANDALONE_COMMAND','F2_GATE_TEST','ADJUSTMENT_CONTACT','REVIEW_COMMAND','REVIEW_MINIMAL'
]);
function parseSessionPayloadReadOnly_(value) {
  if(!value) return {ok:true,payload:{}};
  try { return {ok:true,payload:JSON.parse(value)}; }
  catch(e) { return {ok:false,payload:null}; }
}
function inspectMorningEntryState_(participantId, expectedProjectDay) {
  let day=canonicalProjectDayKey_(expectedProjectDay);
  if(!day){
    try { day=canonicalProjectDayKey_(currentParticipantProjectDay_(participantId)); } catch(e) { day=''; }
  }
  if(!day){
    return {projectDay:'',activeSession:null,activeSessions:[],completedMorning:null,completedMornings:[],morningClosed:false,anomaly:true,anomalyCode:'MORNING_ENTRY_PROJECT_DAY_UNRESOLVED'};
  }

  const rows=readRows_(getSessionsSheet_()), activeSessions=[], completedMornings=[];
  let anomalyCode='';
  for(let i=0;i<rows.length;i++){
    const row=rows[i];
    if(String(row[COLS.SESSIONS.PARTICIPANT_ID])!==String(participantId)) continue;
    const activity=String(row[COLS.SESSIONS.ACTIVITY_STATUS]||'');

    if(activity===ACTIVE_STATUS){
      const parsedActive=parseSessionPayloadReadOnly_(row[COLS.SESSIONS.PAYLOAD]);
      if(!parsedActive.ok){ anomalyCode=anomalyCode||'ACTIVE_SESSION_PAYLOAD_INVALID'; continue; }
      activeSessions.push({
        sessionId:row[COLS.SESSIONS.SESSION_ID], participantId:String(row[COLS.SESSIONS.PARTICIPANT_ID]),
        projectDay:row[COLS.SESSIONS.PROJECT_DAY], state:row[COLS.SESSIONS.STATE], stateVersion:Number(row[COLS.SESSIONS.STATE_VERSION]),
        startedAt:row[COLS.SESSIONS.STARTED_AT], updatedAt:row[COLS.SESSIONS.UPDATED_AT], completedAt:row[COLS.SESSIONS.COMPLETED_AT],
        activityStatus:row[COLS.SESSIONS.ACTIVITY_STATUS], rowNumber:rowNumber_(i), payload:parsedActive.payload
      });
    }

    if(String(row[COLS.SESSIONS.STATE])!==STATES.COMPLETE || activity===ACTIVE_STATUS) continue;
    let candidateDay='';
    try {
      candidateDay=canonicalSessionProjectDay_({
        sessionId:row[COLS.SESSIONS.SESSION_ID],
        participantId:String(row[COLS.SESSIONS.PARTICIPANT_ID]),
        projectDay:row[COLS.SESSIONS.PROJECT_DAY],
        startedAt:row[COLS.SESSIONS.STARTED_AT]
      });
    } catch(e) {
      anomalyCode=anomalyCode||'COMPLETE_SESSION_PROJECT_DAY_UNRESOLVED';
      continue;
    }
    if(!candidateDay){ anomalyCode=anomalyCode||'COMPLETE_SESSION_PROJECT_DAY_UNRESOLVED'; continue; }
    if(candidateDay!==day) continue;

    const parsed=parseSessionPayloadReadOnly_(row[COLS.SESSIONS.PAYLOAD]);
    if(!parsed.ok){ anomalyCode=anomalyCode||'SAME_DAY_COMPLETE_PAYLOAD_INVALID'; continue; }
    const source=String((parsed.payload||{}).source_state||'').trim();
    if(isMorningSourceState_(source)){
      completedMornings.push({
        sessionId:row[COLS.SESSIONS.SESSION_ID], participantId:String(row[COLS.SESSIONS.PARTICIPANT_ID]),
        projectDay:row[COLS.SESSIONS.PROJECT_DAY], state:row[COLS.SESSIONS.STATE], stateVersion:Number(row[COLS.SESSIONS.STATE_VERSION]),
        startedAt:row[COLS.SESSIONS.STARTED_AT], updatedAt:row[COLS.SESSIONS.UPDATED_AT], completedAt:row[COLS.SESSIONS.COMPLETED_AT],
        activityStatus:row[COLS.SESSIONS.ACTIVITY_STATUS], rowNumber:rowNumber_(i), payload:parsed.payload
      });
    } else if(KNOWN_NON_MORNING_SESSION_SOURCES_.indexOf(source)<0){
      anomalyCode=anomalyCode||'SAME_DAY_COMPLETE_SOURCE_UNKNOWN';
    }
  }

  activeSessions.sort((a,b)=>{
    const ta=Date.parse(a.updatedAt||a.startedAt||0)||0, tb=Date.parse(b.updatedAt||b.startedAt||0)||0;
    if(ta!==tb) return tb-ta;
    if(Number(a.stateVersion)!==Number(b.stateVersion)) return Number(b.stateVersion)-Number(a.stateVersion);
    return Number(b.rowNumber)-Number(a.rowNumber);
  });
  if(activeSessions.length>1) log_('MULTIPLE_ACTIVE_SESSIONS',{participantId:String(participantId),count:activeSessions.length,selectedSessionId:activeSessions[0].sessionId});
  if(completedMornings.length>1) anomalyCode=anomalyCode||'MULTIPLE_COMPLETED_ORDINARY_MORNINGS';
  return {
    projectDay:day,
    activeSession:activeSessions.length?activeSessions[0]:null,
    activeSessions:activeSessions,
    completedMorning:completedMornings.length?completedMornings[completedMornings.length-1]:null,
    completedMornings:completedMornings,
    morningClosed:completedMornings.length>0,
    anomaly:!!anomalyCode,
    anomalyCode:anomalyCode
  };
}
function authorizeOrdinaryMorningBeforeMutation_(participantId, chatId, context) {
  const inspection=inspectMorningEntryState_(participantId,currentParticipantProjectDay_(participantId));
  if(inspection.anomaly){
    log_('MORNING_ENTRY_AUTHORIZATION_ANOMALY',{participantId:String(participantId),context:String(context||''),projectDay:inspection.projectDay||'',code:inspection.anomalyCode||'UNKNOWN'});
    sendTelegram_('I couldn’t safely confirm that a new morning calibration can start today, so no new session was started. Please try again later.',chatId);
    return {allowed:false,inspection:inspection};
  }
  if(inspection.morningClosed){
    log_('SAME_DAY_MORNING_ENTRY_BLOCKED',{participantId:String(participantId),context:String(context||''),projectDay:inspection.projectDay||'',morningSessionId:inspection.completedMorning?String(inspection.completedMorning.sessionId):''});
    sendTelegram_('Morning calibration is already complete for today. Use /review when you’re ready to review this morning decision episode.',chatId);
    return {allowed:false,inspection:inspection};
  }
  return {allowed:true,inspection:inspection};
}

// States where the user has typed in-progress, not-yet-saved context (a signal-edit
// in flight). Superseding a session in one of these states loses that typed text, so
// the user is told explicitly rather than the old session just vanishing.
//
// F21 CHANGE-CONTROL — CANDIDATE-stage silent-supersession scope decision
// (Section B fix pack, F-B9, sourced from audit prompt B4)
// Date: 2026-08-16
// This scope (typed-text states only) is a DELIBERATE, REVIEWED DECISION, not
// an oversight left unaddressed. B4 found that a user several taps deep at
// CANDIDATE (past ACUTE and RECOVERY) can have that session silently
// superseded with no notification, since CANDIDATE is a pure button-
// selection state and IN_PROGRESS_EDIT_STATES only warns where TYPED TEXT
// would be lost. F-B9 offered two resolutions: broaden the warning condition
// to "state is not READY" (warn on any discarded progress, button or text),
// or keep this scope and document the decision explicitly. Option 2 (this
// comment; no code change) was chosen, for reasons beyond what F-B9's own
// text anticipated:
//   - No data is actually lost either way. interruptSession_ always writes
//     the full current payload (including button-driven progress) to the
//     superseded row with reason SUPERSEDED before the new session starts —
//     this warning only ever concerns whether the user is TOLD, not whether
//     anything is destroyed.
//   - "Not READY" was checked against every state reachable as an active
//     session (COLS.SESSIONS.ACTIVITY_STATUS gates out terminal states, so
//     ACUTE_EXIT/RECOVERY_EXIT/COMPLETE can never appear here) and found to
//     newly trigger the warning at 16 states, not just CANDIDATE — including
//     ACUTE and RECOVERY, the first two taps in the entire flow. That is a
//     materially larger change than "close the CANDIDATE gap" and was
//     evaluated on its own terms, not assumed proportionate to the
//     originally-reported gap.
//   - ACUTE and RECOVERY specifically are the wrong states to add this
//     friction to. Per master doc §RECOVERY/HEALTH/MAINTENANCE, Recovery
//     "is not invalidated by guilt" and "should not be converted into a
//     productivity target," and "Acute health/safety issues trigger
//     immediate exit from the form" — these are fast, protected exits by
//     design. A "you're interrupting in-progress work" notice firing when a
//     user restarts from ACUTE or RECOVERY risks reading as exactly the
//     RECOVERY-MORALIZATION failure mode the master doc's own Test Analysis
//     Standard (§16) names as something to watch for in usability testing,
//     even though no moralizing was intended. RECOVERY in particular is
//     reached and typically left within a single yes/no tap — there is no
//     real progress there to warn about, only the appearance of some.
//   - More broadly, this system's own Design Principles (§DESIGN
//     PRINCIPLES) instruct to "minimize cognitive and administrative
//     burden" and "avoid turning the form itself into Noise." A warning
//     that fires on routine restarts (an accidental double /start, or a
//     /gate test invocation during the pilot's own testing while a live
//     morning session is one tap in — startDecisionGateTest_ calls
//     createSession_ the same as /start does) trades a rare, low-cost
//     CANDIDATE-stage gap for a much more frequent, higher-cost interruption
//     across the whole flow.
// Per F-B9's own instruction, the audit pack's original citation of master
// doc principle #10 ("the system must survive missed days") is corrected
// here: #10 governs missed-day tolerance, not same-day restart behavior, and
// does not fit this scenario. Principle #1 ("the tool must not become
// Noise") is the applicable anchor, and it argues for the narrower scope
// kept here, not the broader one — a conclusion this fix pack's own B4
// finding flagged the right principle for but did not itself apply.
// Retesting required: NO — comment-only, no behavior change.
const IN_PROGRESS_EDIT_STATES = Object.freeze([STATES.PRESERVE, STATES.GATE_CANDIDATE, STATES.GATE_CLAIM, STATES.GATE_SMALLER_ACTION, STATES.REVIEW_Q1, STATES.REVIEW_Q5_NOTE, STATES.REVIEW_Q6_NOTE, STATES.REVIEW_Q8, STATES.REVIEW_Q9, STATES.REVIEW_Q10]);

function currentParticipantProjectDay_(participantId) {
  const tz=getParticipantTimezone_(participantId);
  return tz?projectDay_(tz):'';
}

// V01-STG-010 REPAIR (R7): Google Sheets can coerce an appended yyyy-MM-dd
// PROJECT_DAY string into a date-typed cell. getValues() then returns a Date
// object, so String(session.projectDay) no longer equals the canonical
// yyyy-MM-dd string produced by projectDay_(). That made same-day selectors
// miss valid sessions in live staging even though the displayed cell date
// looked correct. Prefer the canonical stored string when it survived
// coercion; otherwise reconstruct the stamped day from STARTED_AT using the
// participant timezone effective at that instant, with the participant's
// current validated timezone only as a backward-compatible fallback.
function operationCalibrationCycleDayIndex_() {
  if(!currentOperationContext_) return null;
  if(currentOperationContext_.calibrationCycleDayIndex) return currentOperationContext_.calibrationCycleDayIndex;
  const index=Object.create(null), sheet=getSpreadsheet_().getSheetByName('CalibrationCycles');
  if(sheet){
    const rows=storageReadRows_(sheet);
    for(let i=0;i<rows.length;i++){
      const r=rows[i], d=canonicalProjectDayKey_(r[COLS.CALIBRATION_CYCLES.PROJECT_DAY]);
      if(!d) continue;
      [r[COLS.CALIBRATION_CYCLES.MORNING_SESSION_ID],r[COLS.CALIBRATION_CYCLES.REVIEW_SESSION_ID]].forEach(function(rawId){
        const id=String(rawId==null?'':rawId).trim(); if(!id) return;
        const days=index[id]||(index[id]=[]); if(days.indexOf(d)<0) days.push(d);
      });
    }
  }
  currentOperationContext_.calibrationCycleDayIndex=index;
  return index;
}
function linkedCycleProjectDayForSessionReadOnly_(sessionId) {
  try {
    const id=String(sessionId==null?'':sessionId).trim(); if(!id) return '';
    const indexed=operationCalibrationCycleDayIndex_();
    let unique;
    if(indexed){
      unique=(indexed[id]||[]).slice();
    } else {
      const sheet=getSpreadsheet_().getSheetByName('CalibrationCycles'); if(!sheet) return '';
      const rows=storageReadRows_(sheet), days=[];
      for(let i=0;i<rows.length;i++){
        const r=rows[i];
        if(String(r[COLS.CALIBRATION_CYCLES.MORNING_SESSION_ID])!==id&&String(r[COLS.CALIBRATION_CYCLES.REVIEW_SESSION_ID])!==id) continue;
        const d=canonicalProjectDayKey_(r[COLS.CALIBRATION_CYCLES.PROJECT_DAY]); if(d) days.push(d);
      }
      unique=days.filter(function(x,i,a){return a.indexOf(x)===i;});
    }
    if(unique.length>1) throw new Error('LINKED_CYCLE_PROJECT_DAY_AMBIGUOUS');
    return unique.length?unique[0]:'';
  } catch(e) { if(String(e&&e.message||'').indexOf('AMBIGUOUS')>=0) throw e; return ''; }
}
function canonicalSessionProjectDay_(session) {
  if(!session) return '';
  const direct=canonicalProjectDayKey_(session.projectDay);
  const linked=linkedCycleProjectDayForSessionReadOnly_(session.sessionId);
  if(direct){ if(linked&&linked!==direct) throw new Error('SESSION_CYCLE_PROJECT_DAY_DISAGREEMENT'); return direct; }
  const participantId=String(session.participantId||''), instant=session.startedAt;
  let temporal='';
  if(participantId&&instant){
    const zone=getParticipantTimezoneAt_(participantId,instant);
    if(zone) temporal=canonicalProjectDayKey_(projectDay_(zone,instant));
  }
  if(linked&&temporal&&linked!==temporal) throw new Error('LINKED_HISTORY_PROJECT_DAY_DISAGREEMENT');
  if(linked) return linked;
  if(temporal) return temporal;
  if(String(session.projectDay==null?'':session.projectDay).trim()) throw new Error('INVALID_SESSION_PROJECT_DAY');
  throw new Error('HISTORICAL_PROJECT_DAY_UNRESOLVED');
}
function sessionMatchesProjectDay_(session, expectedDay) {
  return canonicalSessionProjectDay_(session)===String(expectedDay==null?'':expectedDay).trim();
}

function openReentryChoice_(participant, chatId, resolvedActive) {
  const active=resolvedActive||getCurrentSession_(participant.id);
  if(!active) return null;
  if(active.state===STATES.REENTRY_CHOICE){renderState_(active,chatId);return active;}
  const today=currentParticipantProjectDay_(participant.id);
  const stale=!sessionMatchesProjectDay_(active,today);
  const payload=Object.assign({},active.payload||{}, {
    reentry_return_state:active.state, reentry_return_version:active.stateVersion, reentry_stale_day:stale,
    reentry_requested_at:now_(), reentry_reason:'START_COMMAND_WHILE_ACTIVE'
  });
  const updated=transitionSession_(active,STATES.REENTRY_CHOICE,payload);
  if(updated) appendEvent_(participant.id,active.sessionId,'SESSION_REENTRY_OFFERED',{staleDay:stale,returnState:active.state});
  return updated;
}
function startOrOfferReentry_(participant, chatId) {
  // Stop must take precedence over any outstanding review continuity.
  if(isParticipantResearchStopped_(participant)) { sendTelegram_('Participation is stopped. No research session can be resumed. Use /help for available controls.',chatId); return null; }
  const reviewContinuity=resolveReviewContinuity_(participant.id);
  if(reviewContinuity.kind==='DIRECT_REVIEW'||reviewContinuity.kind==='PAUSED_REVIEW_VALID'||reviewContinuity.kind==='LEGACY_REENTRY_REVIEW') {
    sendTelegram_('Your existing review is preserved. Continue that review rather than starting a new morning session.',chatId);
    renderState_(reviewContinuity.session,chatId); return reviewContinuity.session;
  }
  if(reviewContinuity.kind==='PAUSED_REVIEW_INVALID'||reviewContinuity.kind==='PARENT_STRANDED_REVIEW_AMBIGUOUS') {
    sendTelegram_('An existing review needs reconciliation before anything new can start. No new session was created.',chatId); return null;
  }
  if(reviewContinuity.kind==='PARENT_STRANDED_REVIEW_UNIQUE') {
    sendTelegram_('Your earlier review is recoverable and has been preserved. Use /review to restore that same review; no new morning session was created.',chatId); return reviewContinuity.session;
  }
  // R15 integration invariant: every ordinary morning-session entry path —
  // including the automatic first session immediately after timezone setup —
  // must establish the participant's immutable run/enrollment anchor and
  // enforce the fixed calendar window before any Session can be created or
  // re-entered. This closes the P11 wiring gap exposed by the live R14 run.
  const window=participantWindowStatus_(participant);
  // UX-END-01: distinguish an operator-marked early stop from elapsed calendar
  // eligibility. This changes participant-facing text only; it does not
  // change window calculations, review continuity, existing sessions, or Gate.
  if(window.status===WINDOW_STATUS.EARLY_STOP){
    sendTelegram_('Participation is stopped for this enrollment. No new research questions or reviews can be recorded. Earlier records are not automatically deleted. Use /help for remaining controls.',chatId);
    return null;
  }
  if(window.status===WINDOW_STATUS.ENDED_21_CALENDAR_DAYS){
    sendTelegram_('Your 21-calendar-day calibration window has ended. Thank you for taking part. No new morning calibration is needed or available under this enrollment. If an earlier review remains available, you can use /review. Use /help for other controls.',chatId);
    return null;
  }
  if(window.status!==WINDOW_STATUS.ACTIVE){
    sendTelegram_('A new morning calibration cannot be started under this enrollment. Use /help for available controls.',chatId);
    return null;
  }
  const today=currentParticipantProjectDay_(participant.id);
  const inspection=inspectMorningEntryState_(participant.id,today);
  if(inspection.anomaly){
    log_('MORNING_ENTRY_AUTHORIZATION_ANOMALY',{participantId:String(participant.id),context:'START_COMMAND',projectDay:inspection.projectDay||'',code:inspection.anomalyCode||'UNKNOWN'});
    sendTelegram_('I couldn’t safely confirm that a new morning calibration can start today, so no new session was started. Please try again later.',chatId);
    return null;
  }
  let active=inspection.activeSession;
  if(inspection.morningClosed){
    log_('SAME_DAY_MORNING_ENTRY_BLOCKED',{participantId:String(participant.id),context:'START_COMMAND',projectDay:inspection.projectDay||'',morningSessionId:inspection.completedMorning?String(inspection.completedMorning.sessionId):''});
    if(active && isReviewState_(active.state)){
      sendTelegram_('Morning calibration is already complete for today. Your review is still active; continue using the current review prompt.',chatId);
      return active;
    }
    if(active && active.state===STATES.REENTRY_CHOICE && isReviewState_(String((active.payload||{}).reentry_return_state||''))){
      sendTelegram_('Morning calibration is already complete for today. Your review is still available; use Resume to continue it.',chatId);
      renderState_(active,chatId); return active;
    }
    sendTelegram_('Morning calibration is already complete for today. Use /review when you’re ready to review this morning decision episode.',chatId);
    return active||null;
  }
  if(active && (active.state===STATES.ADJUSTMENT_CONTACT || active.state===STATES.ADJUSTMENT_REVISE) && !sessionMatchesProjectDay_(active,today)) {
    expireAdjustmentForContactSession_(active,'contact_not_completed_same_day');
    if(!interruptSession_(active,'ADJUSTMENT_CONTACT_EXPIRED')) return openReentryChoice_(participant,chatId,active);
    active=null;
  }
  if(active) return openReentryChoice_(participant,chatId,active);
  const adjustment=startAdjustmentContactIfDue_(participant,chatId); if(adjustment) return adjustment;
  const fresh=createSession_(participant.id,STATES.READY,'START_COMMAND',chatId);
  renderState_(fresh,chatId); return fresh;
}

// TX-REPAIR A04. Every restoration uses durable PREPARING payload snapshots,
// verified row IDs, readback, a compensation event and finally a nonactive tombstone.
// Apps Script cannot roll back a multi-sheet transition atomically.
const SCB_PREPARED_RECONCILE_ID_PROPERTY = 'SCB_RECONCILE_PREPARED_SESSION_ID';
const SCB_PREPARED_RECONCILE_COMMIT_PROPERTY = 'SCB_RECONCILE_PREPARED_COMMIT';
const SCB_PREPARED_RECONCILE_ACTION_PROPERTY = 'SCB_RECONCILE_PREPARED_ACTION';
const SCB_PREPARED_RECONCILE_EVIDENCE_PROPERTY = 'SCB_RECONCILE_PREPARED_EVIDENCE_REF';
function scbReplacementSnapshot_(activeSessions) {
  return activeSessions.map(session=>{
    if(!verifyRowIdentity_(getSessionsSheet_(),session.rowNumber,COLS.SESSIONS.SESSION_ID,session.sessionId,'replacement_snapshot'))
      throw new Error('SESSION_REPLACEMENT_SNAPSHOT_ID_MISMATCH');
    const fields=getSessionsSheet_().getRange(session.rowNumber,COLS.SESSIONS.STATE+1,1,
      COLS.SESSIONS.PAYLOAD-COLS.SESSIONS.STATE+1).getValues()[0];
    const cycle=findCalibrationCycleByMorningSession_(session.sessionId)||findCalibrationCycleByReviewSession_(session.sessionId);
    let linked=null;
    if(cycle){
      const cycleId=String(cycle.row[COLS.CALIBRATION_CYCLES.CYCLE_ID]);
      if(!verifyRowIdentity_(getCalibrationCyclesSheet_(),cycle.rowNumber,COLS.CALIBRATION_CYCLES.CYCLE_ID,cycleId,'replacement_cycle_snapshot'))
        throw new Error('SESSION_REPLACEMENT_CYCLE_ID_MISMATCH');
      const cycleFields=getCalibrationCyclesSheet_().getRange(cycle.rowNumber,COLS.CALIBRATION_CYCLES.LIFECYCLE_STATUS+1,1,
        COLS.CALIBRATION_CYCLES.OPERATION_ID-COLS.CALIBRATION_CYCLES.LIFECYCLE_STATUS+1).getValues()[0];
      linked={cycleId:cycleId,fields:cycleFields};
    }
    return {sessionId:String(session.sessionId),fields:fields,cycle:linked};
  });
}
function scbReplacementCompensatedEventExists_(participantId,preparedId){
  return readRows_(getEventsSheet_()).some(r=>{
    if(String(r[COLS.EVENTS.PARTICIPANT_ID])!==String(participantId)||String(r[COLS.EVENTS.EVENT_TYPE])!=='SESSION_REPLACEMENT_COMPENSATED')return false;
    try{return String(JSON.parse(String(r[COLS.EVENTS.DETAILS]||'{}')).prepared_session_id)===String(preparedId);}
    catch(e){return false;}
  });
}
function scbReplacementFieldsMatch_(actual,expected){
  if(!actual||!expected||actual.length!==expected.length)return false;
  const norm=v=>v instanceof Date?v.toISOString():String(v===null||v===undefined?'':v);
  return actual.every((v,i)=>norm(v)===norm(expected[i]));
}
// First creation and replacement use the same durable PREPARING fence.
// Effects are keyed by the proposed session ID so a provider after-write
// exception does not create a duplicate on replay or operator reconciliation.
function scbCreatedEventExists_(participantId,sessionId){
  const matching=readRows_(getEventsSheet_()).filter(r=>
    String(r[COLS.EVENTS.PARTICIPANT_ID])===String(participantId)&&
    String(r[COLS.EVENTS.SESSION_ID])===String(sessionId)&&
    String(r[COLS.EVENTS.EVENT_TYPE])==='SESSION_CREATED');
  if(matching.length>1)throw new Error('SESSION_CREATED_EVENT_DUPLICATE');
  return matching.length===1;
}
function scbEnsureCreatedEvent_(participantId,sessionId,initialState,sourceState){
  if(scbCreatedEventExists_(participantId,sessionId))return;
  try{appendEvent_(participantId,sessionId,'SESSION_CREATED',
    {initialState:initialState,sourceState:sourceState||''});}
  catch(error){
    // Google Sheets may commit an append before throwing.
    if(!scbCreatedEventExists_(participantId,sessionId))throw error;
  }
  if(!scbCreatedEventExists_(participantId,sessionId))throw new Error('SESSION_CREATED_EVENT_UNVERIFIED');
}
function scbEnsureCreatedCycle_(session){
  if(!isMorningSourceState_(String((session.payload||{}).source_state||'')))return;
  try{ensureCalibrationCycleForMorning_(session);}
  catch(error){
    if(!findCalibrationCycleByMorningSession_(session.sessionId))throw error;
  }
  const rows=readRows_(getCalibrationCyclesSheet_()).filter(r=>
    String(r[COLS.CALIBRATION_CYCLES.MORNING_SESSION_ID])===String(session.sessionId));
  if(rows.length!==1 || String(rows[0][COLS.CALIBRATION_CYCLES.PARTICIPANT_ID])!==String(session.participantId)
    || String(rows[0][COLS.CALIBRATION_CYCLES.PROJECT_DAY])!==String(session.projectDay)
    || String(rows[0][COLS.CALIBRATION_CYCLES.RUN_REF])!==String(session.runRef))
    throw new Error('SESSION_CREATION_CYCLE_UNVERIFIED');
}
function scbCreationEffectsVerified_(session,initialState,sourceState){
  if(!scbCreatedEventExists_(session.participantId,session.sessionId))return false;
  if(!isMorningSourceState_(String(sourceState||'')))return true;
  const matches=readRows_(getCalibrationCyclesSheet_()).filter(r=>
    String(r[COLS.CALIBRATION_CYCLES.MORNING_SESSION_ID])===String(session.sessionId));
  return matches.length===1 &&
    String(matches[0][COLS.CALIBRATION_CYCLES.PARTICIPANT_ID])===String(session.participantId) &&
    String(matches[0][COLS.CALIBRATION_CYCLES.PROJECT_DAY])===String(session.projectDay)&&
    String(matches[0][COLS.CALIBRATION_CYCLES.RUN_REF])===String(session.runRef) &&
    (String(matches[0][COLS.CALIBRATION_CYCLES.LIFECYCLE_STATUS])===CYCLE_STATUS.MORNING_ACTIVE ||
     String(matches[0][COLS.CALIBRATION_CYCLES.LIFECYCLE_STATUS])===CYCLE_STATUS.MORNING_COMPLETE);
}
function scbFirstCreationRecoveredEventExists_(participantId,sessionId){
  return readRows_(getEventsSheet_()).some(r=>
    String(r[COLS.EVENTS.PARTICIPANT_ID])===String(participantId) &&
    String(r[COLS.EVENTS.SESSION_ID])===String(sessionId) &&
    String(r[COLS.EVENTS.EVENT_TYPE])==='SESSION_CREATION_RECOVERED');
}
function scbFirstCreationCancelledEventExists_(participantId,sessionId){
  return readRows_(getEventsSheet_()).some(r=>
    String(r[COLS.EVENTS.PARTICIPANT_ID])===String(participantId) &&
    String(r[COLS.EVENTS.SESSION_ID])===String(sessionId) &&
    String(r[COLS.EVENTS.EVENT_TYPE])==='SESSION_CREATION_CANCELLED');
}
// QUAL-RECOVERY-01: operator recovery cannot reactivate research after a
// participant has stopped, withdrawn consent, or changed research-run lineage.
// Read the authoritative Participants row while the operator's ScriptLock is held.
// A rejected roll-forward/restore leaves PREPARING fenced for supervised action.
function scbAssertCreationRecoveryEligible_(prepared) {
  const participant=getParticipantById_(prepared.participantId);
  if(!participant || String(participant.id)!==String(prepared.participantId) ||
     String(participant.consentStatus)!=='CONSENTED' ||
     isParticipantResearchStopped_(participant))
    throw new Error('PREPARED_SESSION_PARTICIPANT_NOT_ELIGIBLE');
  if(String(participant.runRef||'')!==String(prepared.runRef||''))
    throw new Error('PREPARED_SESSION_RUN_LINEAGE_MISMATCH');
  return true;
}
function scbRepairPreparedSession_(preparedId,commit){
  const prepared=findSessionById_(preparedId);
  if(!prepared)throw new Error('PREPARED_SESSION_NOT_FOUND');
  if(prepared.activityStatus==='CANCELLED')return {status:'ALREADY_RESTORED',preparedId:preparedId};
  if(prepared.activityStatus!=='PREPARING')throw new Error('PREPARED_SESSION_STATUS_CHANGED');
  const j=(prepared.payload||{})._creation_reconciliation;
  if(!j||!Array.isArray(j.old_snapshots))throw new Error('PREPARED_SNAPSHOT_ABSENT');
  const firstCreation=j.mode==='FIRST_CREATION'||(j.old_snapshots.length===0 && !(j.previous_session_ids||[]).length);
  if(firstCreation){
    const eventExists=scbCreatedEventExists_(prepared.participantId,preparedId);
    const cycle=findCalibrationCycleByMorningSession_(preparedId);
    const morning=!!j.expected_morning_cycle;
    const effectsReady=eventExists && (!morning || scbCreationEffectsVerified_(prepared,j.initial_state,j.source_state));
    if(!commit)return {status:'DRY_RUN',preparedId:preparedId,kind:'FIRST_CREATION',
      eventExists:eventExists,cycleExists:!!cycle,effectsReady:effectsReady,manualReviewRequired:true};
    const requested=arguments.length>=3?String(arguments[2]||'CANCEL'):'CANCEL';
    const evidenceRef=String(arguments.length>=4?arguments[3]||'':'').trim();
    if(!evidenceRef || evidenceRef.length>100 || !/^[a-zA-Z0-9._:-]+$/.test(evidenceRef))
      throw new Error('FIRST_CREATION_OPERATOR_EVIDENCE_REQUIRED');
    const conflicts=getActiveSessions_(prepared.participantId).filter(s=>String(s.sessionId)!==String(preparedId));
    if(conflicts.length)throw new Error('FIRST_CREATION_OPERATOR_ACTIVE_CONFLICT');
    if(requested==='ROLL_FORWARD'){
      scbAssertCreationRecoveryEligible_(prepared);
      if(!effectsReady)throw new Error('FIRST_CREATION_EFFECTS_NOT_VERIFIED');
      if(!verifyRowIdentity_(getSessionsSheet_(),prepared.rowNumber,COLS.SESSIONS.SESSION_ID,preparedId,'first_creation_forward'))
        throw new Error('FIRST_CREATION_IDENTITY_MISMATCH');
      const status=j.initial_terminal?'COMPLETE':ACTIVE_STATUS;
      if(!scbFirstCreationRecoveredEventExists_(prepared.participantId,preparedId)){
        try{appendEvent_(prepared.participantId,preparedId,'SESSION_CREATION_RECOVERED',
          {prepared_session_id:preparedId,evidence_ref:evidenceRef});}
        catch(error){if(!scbFirstCreationRecoveredEventExists_(prepared.participantId,preparedId))throw error;}
      }
      const cleanPayload=Object.assign({},prepared.payload);delete cleanPayload._creation_reconciliation;
      try{storageSetValues_(getSessionsSheet_(),prepared.rowNumber,COLS.SESSIONS.ACTIVITY_STATUS+1,
        [[status,JSON.stringify(cleanPayload)]],'first_creation_operator_forward');}
      catch(error){
        const observed=findSessionById_(preparedId);
        if(!observed||observed.activityStatus!==status||
          !scbCreationEffectsVerified_(observed,j.initial_state,j.source_state))throw error;
      }
      const reread=findSessionById_(preparedId);
      if(!reread || reread.activityStatus!==status || !scbCreationEffectsVerified_(reread,j.initial_state,j.source_state))
        throw new Error('FIRST_CREATION_FORWARD_READBACK_FAILED');
      return {status:'FIRST_CREATION_FORWARDED',preparedId:preparedId};
    }
    if(requested!=='CANCEL')throw new Error('FIRST_CREATION_INVALID_RECOVERY_ACTION');
    // Cancellation retains Events, and supersedes any linked partial cycle.
    if(cycle && String(cycle.row[COLS.CALIBRATION_CYCLES.LIFECYCLE_STATUS])!==CYCLE_STATUS.SUPERSEDED){
      if(!verifyRowIdentity_(getCalibrationCyclesSheet_(),cycle.rowNumber,COLS.CALIBRATION_CYCLES.CYCLE_ID,
        cycle.row[COLS.CALIBRATION_CYCLES.CYCLE_ID],'first_creation_cycle_cancel'))
        throw new Error('FIRST_CREATION_CYCLE_IDENTITY_MISMATCH');
      storageSetValues_(getCalibrationCyclesSheet_(),cycle.rowNumber,COLS.CALIBRATION_CYCLES.LIFECYCLE_STATUS+1,
        [[CYCLE_STATUS.SUPERSEDED,'creation_cancelled',cycle.row[COLS.CALIBRATION_CYCLES.CREATED_AT]||'',
          cycle.row[COLS.CALIBRATION_CYCLES.MORNING_COMPLETED_AT]||'',
          cycle.row[COLS.CALIBRATION_CYCLES.REVIEW_STARTED_AT]||'',
          cycle.row[COLS.CALIBRATION_CYCLES.REVIEW_COMPLETED_AT]||'',now_(),
          cycle.row[COLS.CALIBRATION_CYCLES.OPERATION_ID]||'']],'first_creation_cancel_cycle');
    }
    if(!scbFirstCreationCancelledEventExists_(prepared.participantId,preparedId)){
      try{appendEvent_(prepared.participantId,preparedId,'SESSION_CREATION_CANCELLED',
        {prepared_session_id:String(preparedId),reason:'OPERATOR_VERIFIED_CANCEL',evidence_ref:evidenceRef});}
      catch(error){if(!scbFirstCreationCancelledEventExists_(prepared.participantId,preparedId))throw error;}
    }
    if(!verifyRowIdentity_(getSessionsSheet_(),prepared.rowNumber,COLS.SESSIONS.SESSION_ID,preparedId,'first_creation_cancel'))
      throw new Error('FIRST_CREATION_CANCEL_IDENTITY_MISMATCH');
    const payload=Object.assign({},prepared.payload);
    payload._creation_reconciliation=Object.assign({},j,{status:'CANCELLED',cancelled_at:now_()});
    try{storageSetValues_(getSessionsSheet_(),prepared.rowNumber,COLS.SESSIONS.ACTIVITY_STATUS+1,
      [['CANCELLED',JSON.stringify(payload)]],'first_creation_cancel');}
    catch(error){const observed=findSessionById_(preparedId);
      if(!observed||observed.activityStatus!=='CANCELLED')throw error;}
    const final=findSessionById_(preparedId);
    const finalCycle=findCalibrationCycleByMorningSession_(preparedId);
    if(!final||final.activityStatus!=='CANCELLED'||
      (finalCycle&&String(finalCycle.row[COLS.CALIBRATION_CYCLES.LIFECYCLE_STATUS])!==CYCLE_STATUS.SUPERSEDED))
      throw new Error('FIRST_CREATION_CANCEL_READBACK_FAILED');
    return {status:'FIRST_CREATION_CANCELLED',preparedId:preparedId};
  }
  if(!commit)return {status:'DRY_RUN',preparedId:preparedId,restoreCount:j.old_snapshots.length,
    cycleCount:j.old_snapshots.filter(x=>x.cycle).length};
  scbAssertCreationRecoveryEligible_(prepared);
  // Re-validate each named identity before the first write, then again per write.
  const sessions=getSessionsSheet_(),cycles=getCalibrationCyclesSheet_();
  const refs=j.old_snapshots.map(v=>{
    const prior=findSessionById_(v.sessionId);
    if(!prior||String(prior.participantId)!==String(prepared.participantId))throw new Error('PREPARED_OLD_SESSION_IDENTITY_INVALID');
    let linked=null;
    if(v.cycle){
      linked=findCalibrationCycleByMorningSession_(v.sessionId)||findCalibrationCycleByReviewSession_(v.sessionId);
      if(!linked||String(linked.row[COLS.CALIBRATION_CYCLES.CYCLE_ID])!==String(v.cycle.cycleId))
        throw new Error('PREPARED_OLD_CYCLE_IDENTITY_INVALID');
    }
    return {before:v,prior:prior,linked:linked};
  });
  for(const pair of refs){
    const old=pair.before;
    if(!verifyRowIdentity_(sessions,pair.prior.rowNumber,COLS.SESSIONS.SESSION_ID,old.sessionId,'prepared_session_restore'))
      throw new Error('PREPARED_SESSION_RESTORE_ID_MISMATCH');
    storageSetValues_(sessions,pair.prior.rowNumber,COLS.SESSIONS.STATE+1,[old.fields],'replacement_restore_all_session_fields');
    if(old.cycle){
      if(!verifyRowIdentity_(cycles,pair.linked.rowNumber,COLS.CALIBRATION_CYCLES.CYCLE_ID,old.cycle.cycleId,'prepared_cycle_restore'))
        throw new Error('PREPARED_CYCLE_RESTORE_ID_MISMATCH');
      storageSetValues_(cycles,pair.linked.rowNumber,COLS.CALIBRATION_CYCLES.LIFECYCLE_STATUS+1,[old.cycle.fields],'replacement_restore_all_cycle_fields');
    }
  }
  // New cycle may have been appended immediately before a later failure.
  const newlyCreated=findCalibrationCycleByMorningSession_(preparedId);
  if(newlyCreated && String(newlyCreated.row[COLS.CALIBRATION_CYCLES.LIFECYCLE_STATUS])!==CYCLE_STATUS.SUPERSEDED){
    if(!verifyRowIdentity_(cycles,newlyCreated.rowNumber,COLS.CALIBRATION_CYCLES.CYCLE_ID,newlyCreated.row[COLS.CALIBRATION_CYCLES.CYCLE_ID],'new_cycle_cancel'))
      throw new Error('PREPARED_NEW_CYCLE_ID_MISMATCH');
    storageSetValues_(cycles,newlyCreated.rowNumber,COLS.CALIBRATION_CYCLES.LIFECYCLE_STATUS+1,
      [[CYCLE_STATUS.SUPERSEDED,'replacement_creation_failed',newlyCreated.row[COLS.CALIBRATION_CYCLES.CREATED_AT]||'',
        newlyCreated.row[COLS.CALIBRATION_CYCLES.MORNING_COMPLETED_AT]||'',newlyCreated.row[COLS.CALIBRATION_CYCLES.REVIEW_STARTED_AT]||'',
        newlyCreated.row[COLS.CALIBRATION_CYCLES.REVIEW_COMPLETED_AT]||'',now_(),newlyCreated.row[COLS.CALIBRATION_CYCLES.OPERATION_ID]||'']],
        'replacement_cancel_new_cycle');
  }
  // Readback mandatory; if failure, PREPARING fence remains and manual triage is required.
  for(const pair of refs){
    const prior=findSessionById_(pair.before.sessionId);
    if(!prior||String(prior.activityStatus)!==String(pair.before.fields[COLS.SESSIONS.ACTIVITY_STATUS-COLS.SESSIONS.STATE]))
      throw new Error('PREPARED_SESSION_RESTORE_READBACK_FAILED');
    const actualSessionFields=sessions.getRange(pair.prior.rowNumber,COLS.SESSIONS.STATE+1,1,
      COLS.SESSIONS.PAYLOAD-COLS.SESSIONS.STATE+1).getValues()[0];
    if(!scbReplacementFieldsMatch_(actualSessionFields,pair.before.fields))
      throw new Error('PREPARED_SESSION_FULL_READBACK_FAILED');
    if(pair.before.cycle){
      const cycle=findCalibrationCycleByMorningSession_(pair.before.sessionId)||findCalibrationCycleByReviewSession_(pair.before.sessionId);
      if(!cycle||String(cycle.row[COLS.CALIBRATION_CYCLES.LIFECYCLE_STATUS])!==String(pair.before.cycle.fields[0])
        ||String(cycle.row[COLS.CALIBRATION_CYCLES.MISSINGNESS_CAUSE])!==String(pair.before.cycle.fields[1]))
        throw new Error('PREPARED_CYCLE_RESTORE_READBACK_FAILED');
      const cycleFields=cycles.getRange(cycle.rowNumber,COLS.CALIBRATION_CYCLES.LIFECYCLE_STATUS+1,1,
        COLS.CALIBRATION_CYCLES.OPERATION_ID-COLS.CALIBRATION_CYCLES.LIFECYCLE_STATUS+1).getValues()[0];
      if(!scbReplacementFieldsMatch_(cycleFields,pair.before.cycle.fields))
        throw new Error('PREPARED_CYCLE_FULL_READBACK_FAILED');
    }
  }
  if(!scbReplacementCompensatedEventExists_(prepared.participantId,preparedId))
    appendEvent_(prepared.participantId,preparedId,'SESSION_REPLACEMENT_COMPENSATED',{
      prepared_session_id:String(preparedId),restored_session_ids:j.old_snapshots.map(x=>x.sessionId)});
  const latest=findSessionById_(preparedId);
  if(!latest||latest.activityStatus!=='PREPARING')throw new Error('PREPARED_SESSION_CHANGED_BEFORE_CANCEL');
  const payload=Object.assign({},latest.payload);payload._creation_reconciliation=Object.assign({},j,{status:'RESTORED',restored_at:now_()});
  if(!verifyRowIdentity_(sessions,latest.rowNumber,COLS.SESSIONS.SESSION_ID,preparedId,'prepared_cancel'))
    throw new Error('PREPARED_SESSION_CANCEL_ID_MISMATCH');
  storageSetValues_(sessions,latest.rowNumber,COLS.SESSIONS.ACTIVITY_STATUS+1,[['CANCELLED',JSON.stringify(payload)]],'prepared_cancel');
  const check=findSessionById_(preparedId);
  if(!check||check.activityStatus!=='CANCELLED')throw new Error('PREPARED_CANCEL_READBACK_FAILED');
  return {status:'RESTORED_AND_CANCELLED',preparedId:preparedId,restoreCount:refs.length};
}
function scbReconcileConfiguredPreparedSession() {
  // Intended for an authenticated Apps Script editor, never routed from Telegram.
  const props=PropertiesService.getScriptProperties();
  const id=String(props.getProperty(SCB_PREPARED_RECONCILE_ID_PROPERTY)||'').trim();
  const commit=String(props.getProperty(SCB_PREPARED_RECONCILE_COMMIT_PROPERTY)||'')==='YES';
  if(!id)throw new Error('PREPARED_SESSION_ID_REQUIRED');
  const lock=LockService.getScriptLock();let held=false;
  try {lock.waitLock(30000);held=true;
    const action=String(props.getProperty(SCB_PREPARED_RECONCILE_ACTION_PROPERTY)||'CANCEL');
    const evidence=String(props.getProperty(SCB_PREPARED_RECONCILE_EVIDENCE_PROPERTY)||'');
    const result=scbRepairPreparedSession_(id,commit,action,evidence);
    if(commit){props.deleteProperty(SCB_PREPARED_RECONCILE_COMMIT_PROPERTY);props.deleteProperty(SCB_PREPARED_RECONCILE_ID_PROPERTY);
      props.deleteProperty(SCB_PREPARED_RECONCILE_ACTION_PROPERTY);
      props.deleteProperty(SCB_PREPARED_RECONCILE_EVIDENCE_PROPERTY);}
    return result;
  }finally{if(held)lock.releaseLock();}
}
function scbHasUnreconciledCreation_(participantId) {
  const rows=readRows_(getSessionsSheet_());
  return rows.some(r=>String(r[COLS.SESSIONS.PARTICIPANT_ID])===String(participantId)
    &&String(r[COLS.SESSIONS.ACTIVITY_STATUS])==='PREPARING');
}
function scbOperatorPreparedSessionReport_(participantId) {
  // Operator-only read. Never expose this directly to Telegram users.
  const rows=readRows_(getSessionsSheet_());
  return rows.filter(r=>String(r[COLS.SESSIONS.PARTICIPANT_ID])===String(participantId)
    &&String(r[COLS.SESSIONS.ACTIVITY_STATUS])==='PREPARING')
    .map(r=>({sessionId:String(r[COLS.SESSIONS.SESSION_ID]),status:'RECONCILIATION_REQUIRED'}));
}
function createSession_(participantId, initialState, sourceState, chatId) {
  const isOrdinaryMorning=initialState===STATES.READY && isMorningSourceState_(String(sourceState||''));
  let activeSessions;
  if(isOrdinaryMorning){
    const inspection=inspectMorningEntryState_(participantId,currentParticipantProjectDay_(participantId));
    if(inspection.anomaly){
      log_('MORNING_CONSTRUCTOR_AUTHORIZATION_ANOMALY',{participantId:String(participantId),projectDay:inspection.projectDay||'',code:inspection.anomalyCode||'UNKNOWN'});
      if(chatId) sendTelegram_('I couldn’t safely confirm that a new morning calibration can start today, so no new session was started. Please try again later.',chatId);
      throw new Error('MORNING_ENTRY_AUTHORIZATION_FAILED');
    }
    if(inspection.morningClosed){
      log_('SAME_DAY_MORNING_CREATION_BLOCKED',{participantId:String(participantId),projectDay:inspection.projectDay||'',morningSessionId:inspection.completedMorning?String(inspection.completedMorning.sessionId):''});
      if(chatId) sendTelegram_('Morning calibration is already complete for today. Use /review when you’re ready to review this morning decision episode.',chatId);
      throw new Error('SAME_DAY_MORNING_CREATION_BLOCKED');
    }
    activeSessions=inspection.activeSessions;
  } else {
    activeSessions=getActiveSessions_(participantId);
  }
  const now = now_();
  const sessionId = Utilities.getUuid();
  // P06: day-stamped only after resolving a validated participant-local IANA timezone.
  const effectiveTimezone = getParticipantTimezone_(participantId);
  if (!effectiveTimezone) throw new Error('TIMEZONE_REQUIRED_BEFORE_DAY_FLOW');
  const day = projectDay_(effectiveTimezone);
  // v0.3 session payload schema (PROJECT_SIGNAL_CALIBRATION_MASTER §10):
  // These are storage fields only. They are intentionally kept inside the existing
  // JSON payload rather than added as sheet columns because the current Sessions
  // schema already stores session-level form data as JSON in COLS.SESSIONS.PAYLOAD.
  // No field below is scored, aggregated, ranked, weighted, or converted to a score.
  //
  // morning_state              — current morning path/state
  // focal_signal               — selected focal Signal
  // focal_smaller_action       — feasible smaller action when the candidate is not feasible as
  //     stated. Populated by FOCAL_SELECTION whenever the winning path resolved through the
  //     gate's smaller-action branch (see Section A fix-pack F3, 2026-08-15); null otherwise.
  // other_claims               — non-focal claims considered. F55 CHANGE-
  //     CONTROL (Round 5, Section J fix pack, fixes audit finding J3,
  //     OBSERVATION): §10 names this field without specifying internal
  //     structure. Confirmed this is a deliberate, legitimate implementation
  //     choice, not an undocumented divergence — §10's "categorical values
  //     are storage labels only, never scored" rule (line 712 of the master
  //     doc) governs field *values*, not field *shape*, and nothing in §10
  //     specifies or implies flat-string storage. As actually implemented
  //     (see beginCandidateGate_/updateGateRecord_/gateRecord_ further down
  //     this file), this holds an array of one structured gate-record object
  //     per candidate assessed: { candidate, accepted_commitment,
  //     commitment_type, present_claim, feasible_today, smaller_action,
  //     gate_result }. Recommended one-line addition to master doc §10 (see
  //     this round's N3 synthesis) to state this explicitly, so a future
  //     reader of the master doc alone isn't left to infer the shape from
  //     code. Comment-only; no behavior change; no retesting required.
  // scheduled_items            — non-focal items explicitly scheduled/preserved
  // later_items                — valuable non-focal items parked for later
  // recovery_state             — Recovery/Health state information
  // acute_exit                 — acute medical/safety/crisis exit record
  // midday_event               — optional mid-day event/transition record.
  //     STATUS (Section A fix-pack F3, 2026-08-15): declared per §10 but not
  //     yet implemented — no state, command, or trigger in this file ever
  //     writes it. §10 names this field without §9 defining a corresponding
  //     form step or §3-8 defining what construct it captures, so
  //     implementing it here would mean inventing scope the master doc
  //     hasn't specified. Field is kept (removing a §10-approved field would
  //     itself be a spec regression) but intentionally left unimplemented
  //     pending that design decision.
  // evening_decision_quality   — morning decision-quality assessment; separate from outcome_description
  // context_change              — whether outside circumstances changed
  // capacity_description       — qualitative capacity/health comparison
  // outcome_description        — descriptive focal-Signal outcome; never merged with decision quality
  // qualitative_interpretation — optional evening interpretation
  // optional_adjustment        — optional single adjustment
  //
  // Existing source_state is retained because it is already part of the session
  // provenance mechanism; F1 adds only the §10 fields above.
  const payload = Object.assign({
    project_timezone: effectiveTimezone,
    morning_state: null,
    daily_focus_state: null,
    daily_focus_label: null,
    review_contract: null,
    protocol_contact_kind: sourceState === 'STANDALONE_COMMAND' ? 'standalone_protocol_contact' : (sourceState === 'F2_GATE_TEST' ? 'technical_gate_test' : 'morning_decision_contact'),
    focal_signal: null,
    focal_smaller_action: null,
    focal_candidate_index: null,
    final_selection_link: null,
    comparison_status: null,
    comparison_winner_index: null,
    other_claims: null,
    disposition_history: [],
    preserve_candidate_indexes: [],
    preserve_position: 0,
    scheduled_items: null,
    later_items: null,
    recovery_state: null,
    acute_exit: null,
    midday_event: null,
    evening_decision_quality: null,
    context_change: null,
    capacity_description: null,
    outcome_description: null,
    qualitative_interpretation: null,
    optional_adjustment: null
  }, sourceState ? {
    source_state: sourceState
  } : {});
  const initialTerminal = TERMINAL_STATES.indexOf(initialState) >= 0;
  const runRef=activeRunRef_();
  // SCB-02: Prepare BEFORE touching any existing ACTIVE session. This makes
  // invalid timezones and failed appends incapable of losing the old session.
  // PREPARING is not ACTIVE; on partial failure it is retained for operator
  // reconciliation rather than silently claiming an atomic Sheets transaction.
  const hasActive=activeSessions.length>0;
  const previous=activeSessions.map(x=>String(x.sessionId));
  const beforeImages=hasActive?scbReplacementSnapshot_(activeSessions):[];
  const preparedPayload=Object.assign({},payload,{
    _creation_reconciliation:{status:'PREPARING',mode:hasActive?'REPLACEMENT':'FIRST_CREATION',
      previous_session_ids:previous,old_snapshots:beforeImages,created_at:now,
      session_id:sessionId,participant_id:String(participantId),run_ref:runRef,
      operation_id:String(operationId_()||''),initial_state:initialState,
      initial_terminal:initialTerminal,source_state:String(sourceState||''),
      expected_morning_cycle:isMorningSourceState_(String(sourceState||''))}
  });
  if (scbHasUnreconciledCreation_(participantId))
    throw new Error('SESSION_CREATION_RECONCILIATION_REQUIRED');
  let preparedRow;
  try{preparedRow=storageAppendRow_(getSessionsSheet_(),
    [sessionId,participantId,day,initialState,1,now,now,initialTerminal?now:'','PREPARING',JSON.stringify(preparedPayload),runRef],
    'session_create_prepare');}
  catch(error){
    // A provider may append before throwing; retain its PREPARING fence.
    const existing=findSessionById_(sessionId);
    if(existing)log_('SESSION_PREPARE_APPEND_AMBIGUOUS',{sessionId:sessionId,status:existing.activityStatus});
    throw new Error('SESSION_CREATION_RECONCILIATION_REQUIRED');
  }
  if(hasActive) {
    const interruptedSessions=[];
    let activated=false;
    try {
      for(const target of activeSessions) {
        // Include the target BEFORE the nontransactional interrupt call:
        // that function can throw after its row write but before returning.
        interruptedSessions.push(target);
        let interrupted=interruptSession_(target,'SUPERSEDED');
        if(!interrupted){
          const reread=getActiveSessions_(participantId).find(x=>String(x.sessionId)===String(target.sessionId));
          if(reread)interrupted=interruptSession_(reread,'SUPERSEDED');
        }
        if(!interrupted)throw new Error('SESSION_SUPERSEDE_FAILED');
      }
      // All linked artifacts must be created before the prepared row can be
      // promoted to ACTIVE. Any failure below is caught by the same recovery path.
      bindOperationSession_(sessionId);
      scbEnsureCreatedEvent_(participantId,sessionId,initialState,sourceState);
      scbEnsureCreatedCycle_({sessionId:sessionId,participantId:String(participantId),
        projectDay:day,state:initialState,stateVersion:1,startedAt:now,rowNumber:preparedRow,
        payload:payload,runRef:runRef});
      if(!scbCreationEffectsVerified_({sessionId:sessionId,participantId:String(participantId),
        projectDay:day,runRef:runRef},initialState,sourceState))
        throw new Error('SESSION_CREATION_EFFECTS_UNVERIFIED');
      // One write activates the prepared session and removes its pending marker.
      if(!verifyRowIdentity_(getSessionsSheet_(),preparedRow,COLS.SESSIONS.SESSION_ID,sessionId,'session_prepare_activate'))
        throw new Error('SESSION_PREPARED_ROW_IDENTITY_MISMATCH');
      storageSetValues_(getSessionsSheet_(),preparedRow,COLS.SESSIONS.ACTIVITY_STATUS+1,
        [[initialTerminal?'COMPLETE':ACTIVE_STATUS,JSON.stringify(payload)]],'session_create_activate');
      activated=true;
      if(chatId && IN_PROGRESS_EDIT_STATES.indexOf(activeSessions[0].state)>=0) {
        try { sendTelegram_('Starting something new closes the interrupted session as incomplete. You can start again without penalty.',chatId); }
        catch(notifyError){log_('SESSION_REPLACEMENT_NOTICE_FAILED',{message:safeErrorMessage_(notifyError)});}
      }
    } catch(error) {
      // If activation reached Sheets but metadata registration threw later,
      // the old/new business transition may already be committed. Never
      // blindly restore old sessions over a now ACTIVE replacement.
      let observedStatus='UNKNOWN';
      try {const observed=findSessionById_(sessionId);observedStatus=observed?String(observed.activityStatus):'MISSING';}
      catch(checkError){log_('SESSION_REPLACEMENT_ACTIVATION_READBACK_FAILED',{preparedSessionId:sessionId});}
      if(observedStatus==='ACTIVE'||observedStatus==='COMPLETE'){
        log_('SESSION_REPLACEMENT_COMMIT_AMBIGUOUS',{preparedSessionId:sessionId,status:observedStatus});
        throw new Error('SESSION_REPLACEMENT_COMMIT_REQUIRES_RECONCILIATION');
      }
      // Durable PREPARING journal is the recovery authority, not stale row indexes.
      // Compensation either covers both Session and linked Cycle or preserves a
      // participant-wide research fence for operator reconciliation.
      try {scbRepairPreparedSession_(sessionId,true);}
      catch(restoreError){log_('SESSION_REPLACEMENT_OPERATOR_RECOVERY_REQUIRED',{
        preparedSessionId:String(sessionId),message:safeErrorMessage_(restoreError)});}
      log_('SESSION_CREATION_RECONCILIATION_REQUIRED',{participantId:String(participantId),preparedSessionId:sessionId,error:safeErrorMessage_(error)});
      throw new Error('SESSION_CREATION_RECONCILIATION_REQUIRED');
    }
  }
  if(!hasActive){
    // First sessions use precisely the same PREPARING journal lifecycle.
    // On any uncertainty, leave PREPARING so normal research routing is fenced.
    try{
      bindOperationSession_(sessionId);
      scbEnsureCreatedEvent_(participantId,sessionId,initialState,sourceState);
      scbEnsureCreatedCycle_({sessionId:sessionId,participantId:String(participantId),
        projectDay:day,state:initialState,stateVersion:1,startedAt:now,rowNumber:preparedRow,
        payload:payload,runRef:runRef});
      if(!scbCreationEffectsVerified_({sessionId:sessionId,participantId:String(participantId),
        projectDay:day,runRef:runRef},initialState,sourceState))
        throw new Error('FIRST_SESSION_REQUIRED_EFFECTS_UNVERIFIED');
      if(!verifyRowIdentity_(getSessionsSheet_(),preparedRow,COLS.SESSIONS.SESSION_ID,sessionId,'first_session_promote'))
        throw new Error('FIRST_SESSION_PROMOTION_IDENTITY_MISMATCH');
      try{storageSetValues_(getSessionsSheet_(),preparedRow,COLS.SESSIONS.ACTIVITY_STATUS+1,
        [[initialTerminal?'COMPLETE':ACTIVE_STATUS,JSON.stringify(payload)]],'session_create_activate');}
      catch(error){
        const observed=findSessionById_(sessionId);
        if(!observed || observed.activityStatus!==(initialTerminal?'COMPLETE':ACTIVE_STATUS) ||
          !scbCreationEffectsVerified_(observed,initialState,sourceState))throw error;
      }
      const committed=findSessionById_(sessionId);
      if(!committed || committed.activityStatus!==(initialTerminal?'COMPLETE':ACTIVE_STATUS) ||
        !scbCreationEffectsVerified_(committed,initialState,sourceState))
        throw new Error('FIRST_SESSION_PROMOTION_READBACK_FAILED');
    }catch(error){
      log_('FIRST_SESSION_RECONCILIATION_REQUIRED',
        {preparedSessionId:sessionId,participantId:String(participantId),message:safeErrorMessage_(error)});
      throw new Error('SESSION_CREATION_RECONCILIATION_REQUIRED');
    }
  }
  // Built locally from the values just appended above, matching sessionFromRow_'s
  // shape, rather than re-reading the row back via getCurrentSession_ — that would
  // be a full Sessions-table scan solely to reconstruct data already in hand.
  // rowNumber is the row appendRow just wrote (same pattern as
  // getOrCreateParticipant_'s append branch).
  const createdSession = {
    sessionId: sessionId, participantId: String(participantId), projectDay: day,    state: initialState, stateVersion: 1, startedAt: now, rowNumber: preparedRow,    payload: payload, runRef: runRef
  };
  return createdSession;
}

function interruptSession_(session, reason) {
  // UPDATED_AT (col 7) and ACTIVITY_STATUS (col 9) are not contiguous, so they can't be
  // written in a single setValues call without also touching COMPLETED_AT (col 8) in
  // between. Writing the full STATE..PAYLOAD span (cols 4-10, matching
  // transitionSession_'s existing 7-column write) keeps this a single atomic Sheets
  // call and reuses the same shape as the rest of the codebase, narrowing (not
  // eliminating — no cross-call atomicity is possible in Apps Script) the CS-4 crash
  // window between supersede and the following appendRow in createSession_.
  // F28: re-verify this row still belongs to session.sessionId before writing —
  // see verifyRowIdentity_'s doc comment and the F28 change-control note.
  // A mismatch here means an operator's manual edit shifted what this
  // rowNumber points at since it was captured; abort rather than write blind
  // (session data in Sheets is left as-is; the caller's in-memory payload is
  // not written anywhere else, so nothing is silently lost beyond what a
  // manual edit itself already displaced).
  if (!verifyRowIdentity_(getSessionsSheet_(), session.rowNumber, COLS.SESSIONS.SESSION_ID, session.sessionId, 'interruptSession_')) {
    return false;
  }
  const now = now_();
  storageSetValues_(getSessionsSheet_(), session.rowNumber, COLS.SESSIONS.STATE + 1, [[
    session.state, session.stateVersion, session.startedAt, now, '', reason, JSON.stringify(session.payload || {})
  ]], 'session_interrupt');
  appendEvent_(session.participantId, session.sessionId, 'SESSION_INTERRUPTED', {
    state: session.state, reason: reason
  });
  markCalibrationCycleSuperseded_(session);
  return true;
}

const SESSION_TRANSITION_EFFECTS_PENDING_KEY = '_transition_effects_pending_v1';
const OPERATOR_SESSION_TRANSITION_RECONCILE_PROPERTY = 'SCB_RECONCILE_SESSION_ID';
function transitionEventRecorded_(sessionId, transitionEffectsId) {
  const rows = readRows_(getEventsSheet_());
  for (let i=rows.length-1;i>=0;i--) {
    if (String(rows[i][COLS.EVENTS.SESSION_ID]) !== String(sessionId)) continue;
    if (String(rows[i][COLS.EVENTS.EVENT_TYPE]) !== 'STATE_TRANSITION') continue;
    try {
      const details = JSON.parse(String(rows[i][COLS.EVENTS.DETAILS] || '{}'));
      if (String(details.transitionEffectsId || '') === String(transitionEffectsId)) return true;
    } catch (e) {}
  }
  return false;
}
function reconcilePendingSessionTransitionEffects_(session) {
  if (!session) throw new Error('SESSION_TRANSITION_RECONCILE_SESSION_REQUIRED');
  const payload = Object.assign({}, session.payload || {});
  const marker = payload[SESSION_TRANSITION_EFFECTS_PENDING_KEY];
  if (!marker) return {status:'NO_PENDING',session:session};
  if (String(session.state) !== String(marker.to) || Number(session.stateVersion) !== Number(marker.stateVersion)) throw new Error('SESSION_TRANSITION_RECONCILE_STATE_MISMATCH');
  const transitionEffectsId = String(marker.transitionEffectsId || '');
  if (!transitionEffectsId) throw new Error('SESSION_TRANSITION_RECONCILE_ID_MISSING');
  if (!transitionEventRecorded_(session.sessionId, transitionEffectsId)) {
    appendEvent_(session.participantId, session.sessionId, 'STATE_TRANSITION', {from:String(marker.from||''),to:String(marker.to||''),stateVersion:Number(marker.stateVersion),transitionEffectsId:transitionEffectsId});
  }
  updateCalibrationCycleForMorningTerminal_(session, String(marker.to||''), payload);
  const sourceState = String(payload.source_state || '');
  if (String(marker.to||'') === STATES.COMPLETE && (sourceState === 'REVIEW_COMMAND' || sourceState === 'REVIEW_MINIMAL')) finalizeCalibrationCycleFromReview_(session);
  delete payload[SESSION_TRANSITION_EFFECTS_PENDING_KEY];
  if (!verifyRowIdentity_(getSessionsSheet_(), session.rowNumber, COLS.SESSIONS.SESSION_ID, session.sessionId, 'session_transition_effects_clear')) throw new Error('SESSION_TRANSITION_RECONCILE_IDENTITY_MISMATCH');
  storageSetValue_(getSessionsSheet_(), session.rowNumber, COLS.SESSIONS.PAYLOAD + 1, JSON.stringify(payload), 'session_transition_effects_clear');
  session.payload = payload;
  return {status:'RECONCILED',session:session};
}
function reconcileConfiguredSessionTransitionEffects() {
  const props = PropertiesService.getScriptProperties();
  const sessionId = String(props.getProperty(OPERATOR_SESSION_TRANSITION_RECONCILE_PROPERTY) || '').trim();
  if (!sessionId) throw new Error('SCB_RECONCILE_SESSION_ID_REQUIRED');
  const session = findSessionById_(sessionId);
  if (!session) throw new Error('SESSION_NOT_FOUND');
  const result = reconcilePendingSessionTransitionEffects_(session);
  props.deleteProperty(OPERATOR_SESSION_TRANSITION_RECONCILE_PROPERTY);
  log_('OPERATOR_SESSION_TRANSITION_RECONCILED', {sessionId:sessionId,status:result.status});
  return result.status;
}

function transitionSession_(session, newState, payload) {
  if (session && session.payload && session.payload[SESSION_TRANSITION_EFFECTS_PENDING_KEY]) {
    session = reconcilePendingSessionTransitionEffects_(session).session;
  }
  if (!verifyRowIdentity_(getSessionsSheet_(), session.rowNumber, COLS.SESSIONS.SESSION_ID, session.sessionId, 'transitionSession_')) {
    try {
      sendTelegram_('Something changed on our end and this step could not be saved. Please try /start again.', resolveDeliveryChatId_(session.participantId));
    } catch (notifyError) {
      log_('ROW_IDENTITY_MISMATCH_NOTIFY_FAILED', {sessionId: session.sessionId, message: safeErrorMessage_(notifyError)});
    }
    return false;
  }
  const now = now_();
  const isTerminal = TERMINAL_STATES.indexOf(newState) >= 0;
  const nextVersion = session.stateVersion + 1;
  const nextPayload = Object.assign({}, payload || session.payload || {});
  const transitionEffectsId = String(session.sessionId) + ':' + String(nextVersion);
  nextPayload[SESSION_TRANSITION_EFFECTS_PENDING_KEY] = {transitionEffectsId:transitionEffectsId,from:String(session.state||''),to:String(newState||''),stateVersion:nextVersion};
  const values = [[newState, nextVersion, session.startedAt, now, isTerminal ? now : '', isTerminal ? 'COMPLETE' : ACTIVE_STATUS, JSON.stringify(nextPayload)]];
  storageSetValues_(getSessionsSheet_(), session.rowNumber, COLS.SESSIONS.STATE + 1, values, 'session_transition');
  const updated = Object.assign({}, session, {state:newState,stateVersion:nextVersion,payload:nextPayload});
  reconcilePendingSessionTransitionEffects_(updated);
  const sent = renderState_(updated);
  if (sent === false) log_('RENDER_SEND_FAILED', {sessionId:updated.sessionId,state:updated.state,participantId:updated.participantId});
  return updated;
}

function appendEvent_(participantId, sessionId, eventType, details) {
  const correlationId = operationId_() || Utilities.getUuid();
  storageAppendRow_(getEventsSheet_(), [Utilities.getUuid(), participantId, sessionId || '', correlationId, eventType, JSON.stringify(details || {}), now_(), activeRunRef_()], 'event_append');
}

// Idempotency rows older than this are pruned by pruneIdempotencyTable_. 48h is
// comfortably beyond any plausible Telegram redelivery window (Telegram retries
// webhook deliveries for a bounded period, far short of a day), so pruning at this age
// cannot reintroduce duplicate-processing risk.
const IDEMPOTENCY_RETENTION_MS = 48 * 60 * 60 * 1000;

// F39 CHANGE NOTE (Section E fix pack, FIX-E5, fixes audit finding E5): this
// check-then-act sequence (getProjectTriggers().some(...) then
// newTrigger().create()) is structurally identical to scheduleExportExpiry_'s
// expireExportFiles_-trigger installation, but previously had no locking
// around it. The only call site is configureWebhookOnce_, a manually-run,
// one-time operator function, so the realistic race is an operator running
// that function twice in close succession (two open editor tabs, a double-
// click), not concurrent Telegram traffic — a duplicate pruneIdempotencyTable_
// trigger is low-severity (redundant, harmless pruning runs), but this
// project already built the exact lock pattern needed and had applied it
// inconsistently. Now wrapped in withScriptLockContext_, which reuses an already-held
// application ScriptLock context or acquires that same global ScriptLock when invoked
// standalone. A lock-timeout here is a no-op (the existing trigger-or-not state is simply left as it was)
// rather than a hard failure, since this is best-effort setup robustness,
// not a path any participant-facing flow depends on.
function ensureIdempotencyPruneTrigger_() {
  withScriptLockContext_(() => {
    if (!ScriptApp.getProjectTriggers().some(trigger => trigger.getHandlerFunction() === 'pruneIdempotencyTable_')) {
      ScriptApp.newTrigger('pruneIdempotencyTable_').timeBased().everyHours(6).create();
    }
  });
}

// Installable trigger target, mirrors expireExportFiles_'s pattern. Deletes Idempotency
// rows older than IDEMPOTENCY_RETENTION_MS so isUpdateAlreadyProcessed_'s linear scan doesn't grow
// unbounded forever (see the file's own O(n)-at-scale note at the bottom).
// F03: retention policy is status-aware. Old unresolved and unfamiliar claims
// MUST remain in the technical ledger, even beyond the ordinary 48h window.
function scbIdempotencyPrunable_(row,cutoff) {
  const status=String(row[COLS.IDEMPOTENCY.PROCESSING_STATUS]||'');
  if(status!==IDEMPOTENCY_STATUS.COMMITTED && status!==IDEMPOTENCY_STATUS.RECONCILED)return false;
  if(scbSafetyClaimUnresolved_(row))return false;
  const processedAt=Date.parse(row[COLS.IDEMPOTENCY.PROCESSED_AT]);
  return !isNaN(processedAt)&&processedAt<cutoff;
}
function scbPendingIdempotencyInventory_() {
  // Read-only operator diagnostics; never automatically adjudicate claims.
  const rows=readRows_(getIdempotencySheet_()),counts={},old=[],now=Date.now();
  rows.forEach(row=>{
    const status=String(row[COLS.IDEMPOTENCY.PROCESSING_STATUS]||'UNKNOWN');
    if(status===IDEMPOTENCY_STATUS.COMMITTED||status===IDEMPOTENCY_STATUS.RECONCILED){
      if(!scbSafetyClaimUnresolved_(row))return;
    }
    counts[status]=(counts[status]||0)+1;
    const age=Date.parse(row[COLS.IDEMPOTENCY.PROCESSED_AT]);
    if(old.length<50 && (!isNaN(age)) && now-age>=IDEMPOTENCY_RETENTION_MS){
      old.push({updateId:String(row[COLS.IDEMPOTENCY.UPDATE_ID]),
        userId:String(row[COLS.IDEMPOTENCY.USER_ID]),status:status,
        safety:scbSafetyClaimUnresolved_(row)});
    }
  });
  return {pendingCounts:counts,oldestSample:old,sampleLimit:50,
    pendingTotal:Object.keys(counts).reduce((n,k)=>n+counts[k],0)};
}
function scbInspectPendingIdempotencyClaims() {
  // Operator-only Apps Script function; no Telegram dispatch calls this.
  return scbPendingIdempotencyInventory_();
}
function pruneIdempotencyTable_() {
  const lock=LockService.getScriptLock();let acquired=false;
  try {
    try{lock.waitLock(30000);acquired=true;}
    catch(error){log_('IDEMPOTENCY_PRUNE_LOCK_TIMEOUT',{message:safeErrorMessage_(error)});return false;}
    const sheet=getIdempotencySheet_();
    const rows=readRows_(sheet),cutoff=Date.now()-IDEMPOTENCY_RETENTION_MS;
    const removable=[];
    rows.forEach((row,index)=>{if(scbIdempotencyPrunable_(row,cutoff))removable.push({rowNumber:rowNumber_(index),
      updateId:String(row[COLS.IDEMPOTENCY.UPDATE_ID]),userId:String(row[COLS.IDEMPOTENCY.USER_ID])});});
    // Descending deletes prevent index shifts; verify BOTH update and user
    // identities immediately before each destructive write while locked.
    removable.reverse().forEach(target=>{
      const found=sheet.getRange(target.rowNumber,1,1,COLS.IDEMPOTENCY.COUNT).getValues()[0];
      if(String(found[COLS.IDEMPOTENCY.UPDATE_ID])!==target.updateId ||
         String(found[COLS.IDEMPOTENCY.USER_ID])!==target.userId ||
         !scbIdempotencyPrunable_(found,cutoff))throw new Error('IDEMPOTENCY_PRUNE_IDENTITY_CHANGED');
      storageDeleteRow_(sheet,target.rowNumber,'idempotency_resolved_prune');
    });
    const inventory=scbPendingIdempotencyInventory_();
    log_('IDEMPOTENCY_PRUNED',{before:rows.length,removed:removable.length,
      pendingTotal:inventory.pendingTotal,pendingCounts:inventory.pendingCounts});
    return true;
  }catch(error){log_('IDEMPOTENCY_PRUNE_INCOMPLETE',{message:safeErrorMessage_(error)});return false;}
  finally{if(acquired)lock.releaseLock();}
}

function getIdempotencyRecord_(updateId,userId) {
  const rows=readRows_(getIdempotencySheet_());
  const idx=rows.findIndex(row=>String(row[COLS.IDEMPOTENCY.UPDATE_ID])===String(updateId)&&String(row[COLS.IDEMPOTENCY.USER_ID])===String(userId));
  if(idx<0) return null;
  const row=rows[idx];
  return {row:row,rowNumber:rowNumber_(idx),operationId:String(row[COLS.IDEMPOTENCY.OPERATION_ID]||''),status:String(row[COLS.IDEMPOTENCY.PROCESSING_STATUS]||''),result:String(row[COLS.IDEMPOTENCY.RESULT]||'')};
}
function isUpdateAlreadyProcessed_(updateId,userId) { return !!getIdempotencyRecord_(updateId,userId); }
function recordUpdateProcessing_(updateId,userId,initialResult) {
  const now=now_(), operationId=operationId_();
  const rowNumber=storageAppendRow_(getIdempotencySheet_(),
    [updateId,userId,now,operationId,IDEMPOTENCY_STATUS.PROCESSING,String(initialResult||''),now],
    'idempotency_processing');
  return {rowNumber:Number(rowNumber),updateId:String(updateId),userId:String(userId),operationId:String(operationId||'')};
}
function recordUpdateProcessed_(updateId,userId) { return recordUpdateProcessing_(updateId,userId); }
function idempotencyReservationRowMatches_(reservation,updateId,userId) {
  if(!reservation) return false;
  const rowNumber=Number(reservation.rowNumber);
  if(!Number.isInteger(rowNumber)||rowNumber<ROWS.FIRST_DATA) return false;
  if(String(reservation.updateId)!==String(updateId)||String(reservation.userId)!==String(userId)) return false;
  let identity;
  try {
    lprCountBotService_('sheets.bounded_identity_read');
    identity=getIdempotencySheet_().getRange(rowNumber,COLS.IDEMPOTENCY.UPDATE_ID+1,1,COLS.IDEMPOTENCY.OPERATION_ID-COLS.IDEMPOTENCY.UPDATE_ID+1).getValues()[0];
  } catch(error) { return false; }
  if(String(identity[COLS.IDEMPOTENCY.UPDATE_ID-COLS.IDEMPOTENCY.UPDATE_ID])!==String(updateId)) return false;
  if(String(identity[COLS.IDEMPOTENCY.USER_ID-COLS.IDEMPOTENCY.UPDATE_ID])!==String(userId)) return false;
  const expectedOperationId=String(reservation.operationId||'');
  if(expectedOperationId && String(identity[COLS.IDEMPOTENCY.OPERATION_ID-COLS.IDEMPOTENCY.UPDATE_ID])!==expectedOperationId) return false;
  return true;
}
function updateIdempotencyState_(updateId,userId,status,result,reservation) {
  let rec=null;
  if(idempotencyReservationRowMatches_(reservation,updateId,userId)) rec={rowNumber:Number(reservation.rowNumber)};
  else rec=getIdempotencyRecord_(updateId,userId);
  if(!rec) throw new Error('IDEMPOTENCY_RECORD_NOT_FOUND');
  storageSetValues_(getIdempotencySheet_(),rec.rowNumber,COLS.IDEMPOTENCY.PROCESSING_STATUS+1,[[String(status||''),String(result||''),now_()]],'idempotency_result');
  return status;
}
function reconcileIdempotencyFromOperation_(rec) {
  if(!rec) return null;
  if(rec.status===IDEMPOTENCY_STATUS.COMMITTED||rec.status===IDEMPOTENCY_STATUS.RECONCILED) return rec;
  const op=rec.operationId?findOperationById_(rec.operationId):null;
  const opStatus=op?String(op.row[COLS.OPERATIONS.STATUS]):'UNKNOWN';
  let status=rec.status||IDEMPOTENCY_STATUS.RECONCILIATION_REQUIRED, result=rec.result||'';
  if(opStatus===OPERATION_STATUS.COMMITTED){status=IDEMPOTENCY_STATUS.COMMITTED;result='DUPLICATE_CONFIRMED_FROM_OPERATION:'+opStatus;}
  else if(opStatus===OPERATION_STATUS.RECONCILED){status=IDEMPOTENCY_STATUS.RECONCILED;result='DUPLICATE_CONFIRMED_FROM_OPERATION:'+opStatus;}
  else if(opStatus===OPERATION_STATUS.FAILED||opStatus===OPERATION_STATUS.PENDING||opStatus==='UNKNOWN'){status=IDEMPOTENCY_STATUS.RECONCILIATION_REQUIRED;result='NO_REPLAY_OPERATION_STATUS:'+opStatus;}
  if(status!==rec.status||result!==rec.result){updateIdempotencyState_(rec.row[COLS.IDEMPOTENCY.UPDATE_ID],rec.row[COLS.IDEMPOTENCY.USER_ID],status,result);rec.status=status;rec.result=result;}
  return rec;
}
function getIdempotencyOperation_(updateId,userId) {
  const rec=getIdempotencyRecord_(updateId,userId); if(!rec) return null;
  const op=rec.operationId?findOperationById_(rec.operationId):null;
  return {operationId:rec.operationId,status:op?String(op.row[COLS.OPERATIONS.STATUS]):'UNKNOWN',idempotencyStatus:rec.status,result:rec.result};
}

// F59 (Prompt 3 design note, approved): the free-text reflection this
// checks for is stored on Participants, not Sessions, and captured via
// this priority interception rather than as a state in STATES / a branch
// in handleStateInput_ — see the design note §2 for why. layerCheckpointFlag
// holds '' (no checkpoint open), 'L2_TO_L3' or 'PILOT_END' (open, /reflect
// not yet run this checkpoint), or 'L2_TO_L3_AWAITING_TEXT' /
// 'PILOT_END_AWAITING_TEXT' (participant has run /reflect and their next
// message is captured as the answer, whatever its content — including if
// it looks like a command). This function is checked before any command
// parsing so it takes priority over an active session, satisfying the
// design note's ordering requirement that the check fire before anything
// that could display prior history.
const LAYER_CHECKPOINT_AWAITING_SUFFIX = '_AWAITING_TEXT';

function latestReflectionPromptBarrier_(participantId, stage, generation, awaitingFlag, chatId) {
  const rows=readRows_(getEventsSheet_());
  for(let i=rows.length-1;i>=0;i--){
    const r=rows[i];
    if(String(r[COLS.EVENTS.PARTICIPANT_ID])!==String(participantId)||String(r[COLS.EVENTS.SESSION_ID]||'')!==''||String(r[COLS.EVENTS.EVENT_TYPE])!==REFLECTION_PROMPT_BARRIER_EVENT) continue;
    let d={}; try{d=JSON.parse(r[COLS.EVENTS.DETAILS]||'{}');}catch(e){continue;}
    if(String(d.owner)!=='REFLECTION'||String(d.participant_id)!==String(participantId)||String(d.stage)!==String(stage)||Number(d.generation)!==Number(generation)||String(d.awaiting_flag)!==String(awaitingFlag)||String(d.chat_id)!==String(chatId)||String(d.delivery_status)!=='TELEGRAM_ACCEPTED_COMPLETE'||!validTelegramInteger_(Number(d.prompt_message_id),false)) continue;
    return d;
  }
  return null;
}
function renderReflectionPrompt_(participant, chatId) {
  const flag=String(participant&&participant.layerCheckpointFlag||'');
  if(!flag||flag.indexOf(LAYER_CHECKPOINT_AWAITING_SUFFIX)<0) return false;
  const stage=flag.slice(0,flag.length-LAYER_CHECKPOINT_AWAITING_SUFFIX.length), generation=reflectionGeneration_(participant,stage);
  return withPromptOwnerContext_({owner:'REFLECTION',participantId:String(participant.id),stage:stage,generation:generation,awaitingFlag:flag,chatId:String(chatId)},function(){
    return sendTelegram_('In your own words, what\'s different about how you\'re deciding what to focus on, if anything?',chatId);
  });
}
function reflectionPromptBarrierAllowsInput_(participant, chatId, incomingMessageId) {
  const flag=String(participant&&participant.layerCheckpointFlag||'');
  if(!flag||flag.indexOf(LAYER_CHECKPOINT_AWAITING_SUFFIX)<0||!validTelegramInteger_(incomingMessageId,false)) return false;
  const stage=flag.slice(0,flag.length-LAYER_CHECKPOINT_AWAITING_SUFFIX.length), generation=reflectionGeneration_(participant,stage);
  const b=latestReflectionPromptBarrier_(participant.id,stage,generation,flag,chatId);
  return !!(b&&Number(incomingMessageId)>Number(b.prompt_message_id));
}
function handleReflectionAnswerIfAwaiting_(participant, text, chatId, incomingMessageId) {
  const flag = participant.layerCheckpointFlag;
  if (!flag || flag.indexOf(LAYER_CHECKPOINT_AWAITING_SUFFIX) < 0) return false;
  if (String(text||'').trim().charAt(0)==='/') return false;
  if(!reflectionPromptBarrierAllowsInput_(participant,chatId,incomingMessageId)) {
    log_('PROMPT_CAUSALITY_REJECTED',{owner:'REFLECTION',participantId:String(participant.id),chatId:String(chatId),incomingMessageId:validTelegramInteger_(incomingMessageId,false)?incomingMessageId:null,reason:'PROMPT_BARRIER_UNCONFIRMED_OR_PRE_PROMPT'});
    renderReflectionPrompt_(participant,chatId);
    return true;
  }
  const stage = flag.slice(0, flag.length - LAYER_CHECKPOINT_AWAITING_SUFFIX.length);
  if(!recordLayerTransitionReflection_(participant, stage, text)) return true;
  sendTelegram_('Thank you — recorded.', chatId);
  return true;
}

// P06 setup/consent/timezone provenance. SetupHistory is append-only and
// supplies expected-step + version binding for consent/timezone actions.
function appendSetupSnapshot_(participantId, setupVersion, step, action, status, details) {
  const row=[Utilities.getUuid(),String(participantId),Number(setupVersion),String(step),String(action||''),String(status||'ACTIVE'),JSON.stringify(details||{}),now_(),operationId_()];
  const rn=storageAppendRow_(getSetupHistorySheet_(),row,'setup_provenance');
  const check=getSetupHistorySheet_().getRange(rn,1,1,COLS.SETUP_HISTORY.COUNT).getValues()[0];
  if(String(check[COLS.SETUP_HISTORY.RECORD_ID])!==String(row[0]) || String(check[COLS.SETUP_HISTORY.PARTICIPANT_ID])!==String(participantId)) throw new Error('SETUP_WRITE_VERIFY_FAILED');
  return {participantId:String(participantId),version:Number(setupVersion),step:String(step),action:String(action||''),status:String(status||'ACTIVE'),details:details||{},rowNumber:rn};
}
function currentSetup_(participantId) {
  const rows=readRows_(getSetupHistorySheet_());
  for(let i=rows.length-1;i>=0;i--){ const r=rows[i]; if(String(r[COLS.SETUP_HISTORY.PARTICIPANT_ID])!==String(participantId)) continue; let details={}; try{details=JSON.parse(r[COLS.SETUP_HISTORY.DETAILS]||'{}')}catch(e){} return {participantId:String(participantId),version:Number(r[COLS.SETUP_HISTORY.SETUP_VERSION]),step:String(r[COLS.SETUP_HISTORY.STEP]),action:String(r[COLS.SETUP_HISTORY.ACTION]||''),status:String(r[COLS.SETUP_HISTORY.STATUS]||''),details:details,rowNumber:rowNumber_(i)}; }
  return null;
}
function nextSetupVersion_(participantId) { const c=currentSetup_(participantId); return c?Number(c.version)+1:1; }
function beginSetup_(participant, step, action, details, forceNew) {
  const current=currentSetup_(participant.id);
  if(!forceNew && current && current.status==='ACTIVE' && current.step===step) return current;
  const version=(forceNew || !current || current.status!=='ACTIVE')?nextSetupVersion_(participant.id):current.version;
  return appendSetupSnapshot_(participant.id,version,step,action||'BEGIN','ACTIVE',details||{});
}
function advanceSetup_(participant, setup, step, action, status, details) {
  return appendSetupSnapshot_(participant.id,setup.version,step,action,status||'ACTIVE',details===undefined?setup.details:details);
}
function setupCallbackIsCurrent_(participant, setupVersion, expectedStep) {
  const c=currentSetup_(participant.id);
  return !!(c && c.status==='ACTIVE' && Number(c.version)===Number(setupVersion) && c.step===expectedStep);
}
function appendConsentHistory_(participantId,setupVersion,comprehensionStatus,decision){
  const rows=readRows_(getConsentHistorySheet_());
  const existing=rows.find(r=>String(r[COLS.CONSENT_HISTORY.PARTICIPANT_ID])===String(participantId)&&Number(r[COLS.CONSENT_HISTORY.SETUP_VERSION])===Number(setupVersion)&&String(r[COLS.CONSENT_HISTORY.COMPREHENSION_STATUS])===String(comprehensionStatus||'')&&String(r[COLS.CONSENT_HISTORY.CONSENT_DECISION])===String(decision||''));
  if(existing) return true;
  const id=Utilities.getUuid(), row=[id,String(participantId),Number(setupVersion),String(comprehensionStatus||''),String(decision||''),now_(),operationId_()];
  const rn=storageAppendRow_(getConsentHistorySheet_(),row,'consent_provenance');
  return String(getConsentHistorySheet_().getRange(rn,COLS.CONSENT_HISTORY.RECORD_ID+1).getValue())===String(id);
}
function normalizeIanaTimezone_(value) {
  const raw=String(value||'').trim(); if(!raw) return '';
  try { return new Intl.DateTimeFormat('en-US',{timeZone:raw}).resolvedOptions().timeZone || raw; } catch(e){ return ''; }
}
function isKnownTimezone_(timezone) { return !!normalizeIanaTimezone_(timezone); }
function timezoneInstantMs_(value) {
  if(value instanceof Date) return value.getTime();
  const ms=Date.parse(String(value||''));
  return Number.isFinite(ms)?ms:NaN;
}
const TIMEZONE_AUTHORITY_STATUS = Object.freeze({
  OK:'OK', NO_HISTORY:'NO_HISTORY', NO_AUTHORITY:'NO_AUTHORITY',
  AMBIGUOUS:'BLOCK_TEMPORAL_AUTHORITY_AMBIGUOUS', INVALID:'BLOCK_TEMPORAL_AUTHORITY_INVALID'
});
const TIMEZONE_SOURCE = Object.freeze({
  INITIAL_IMMEDIATE:'INITIAL_IMMEDIATE',
  LEGACY_PROSPECTIVE_ANCHOR:'LEGACY_PROSPECTIVE_ANCHOR',
  LEGACY_PROSPECTIVE_ESTABLISHMENT:'LEGACY_PROSPECTIVE_ESTABLISHMENT',
  CORRECTION_SCHEDULED:'PARTICIPANT_CORRECTION_SCHEDULED',
  CORRECTION_CONTINUITY:'PARTICIPANT_CORRECTION_CONTINUITY',
  SUPERSEDED_PENDING:'SUPERSEDED_PENDING_CORRECTION',
  CANCELLED_PENDING:'CANCELLED_PENDING_CORRECTION'
});
function timezoneHistoryRowsForParticipant_(participantId) {
  const rows=readRows_(getTimezoneHistorySheet_()), out=[];
  for(let i=0;i<rows.length;i++){
    const r=rows[i]; if(String(r[COLS.TIMEZONE_HISTORY.PARTICIPANT_ID])!==String(participantId)) continue;
    const rawZone=String(r[COLS.TIMEZONE_HISTORY.TIMEZONE]||''), zone=normalizeIanaTimezone_(rawZone);
    const fromMs=timezoneInstantMs_(r[COLS.TIMEZONE_HISTORY.EFFECTIVE_FROM]);
    const rawTo=r[COLS.TIMEZONE_HISTORY.EFFECTIVE_TO], toMs=String(rawTo==null?'':rawTo).trim()===''?Infinity:timezoneInstantMs_(rawTo);
    out.push({row:r,rowNumber:rowNumber_(i),recordId:String(r[COLS.TIMEZONE_HISTORY.RECORD_ID]||''),rawZone:rawZone,zone:zone,fromMs:fromMs,toMs:toMs,source:String(r[COLS.TIMEZONE_HISTORY.SOURCE]||''),setupVersion:Number(r[COLS.TIMEZONE_HISTORY.SETUP_VERSION]||0)});
  }
  return out;
}
function resolveEffectiveTimezoneAt_(participantId, instant) {
  const t=timezoneInstantMs_(instant===undefined||instant===null?now_():instant);
  if(!Number.isFinite(t)) return {status:TIMEZONE_AUTHORITY_STATUS.INVALID,reason:'INSTANT_INVALID'};
  const rows=timezoneHistoryRowsForParticipant_(participantId);
  if(!rows.length) return {status:TIMEZONE_AUTHORITY_STATUS.NO_HISTORY,timezone:'',instantMs:t};
  const covering=[];
  for(let i=0;i<rows.length;i++){
    const x=rows[i];
    if(!Number.isFinite(x.fromMs) || !(x.toMs===Infinity||Number.isFinite(x.toMs)) || x.toMs<x.fromMs) continue;
    if(x.fromMs<=t && t<x.toMs) covering.push(x);
  }
  if(!covering.length) return {status:TIMEZONE_AUTHORITY_STATUS.NO_AUTHORITY,timezone:'',instantMs:t};
  if(covering.some(x=>!x.zone)) return {status:TIMEZONE_AUTHORITY_STATUS.INVALID,reason:'INVALID_ZONE_AT_REQUIRED_INSTANT',instantMs:t,rows:covering};
  if(covering.length!==1) return {status:TIMEZONE_AUTHORITY_STATUS.AMBIGUOUS,reason:'MULTIPLE_EFFECTIVE_INTERVALS',instantMs:t,rows:covering};
  return {status:TIMEZONE_AUTHORITY_STATUS.OK,timezone:covering[0].zone,instantMs:t,interval:covering[0]};
}
function appendTimezoneHistory_(participantId,zone,effectiveFrom,source,setupVersion,effectiveTo){
  const normalized=normalizeIanaTimezone_(zone); if(!normalized) return false;
  const fromMs=timezoneInstantMs_(effectiveFrom); if(!Number.isFinite(fromMs)) return false;
  const fromIso=new Date(fromMs).toISOString();
  let toIso='';
  if(effectiveTo!==undefined&&effectiveTo!==null&&String(effectiveTo).trim()!==''){
    const toMs=timezoneInstantMs_(effectiveTo); if(!Number.isFinite(toMs)||toMs<fromMs) return false; toIso=new Date(toMs).toISOString();
  }
  const sheet=getTimezoneHistorySheet_(), rows=readRows_(sheet);
  for(let i=0;i<rows.length;i++){
    const r=rows[i];
    if(String(r[COLS.TIMEZONE_HISTORY.PARTICIPANT_ID])!==String(participantId)) continue;
    if(Number(r[COLS.TIMEZONE_HISTORY.SETUP_VERSION]||0)===Number(setupVersion||0) && normalizeIanaTimezone_(r[COLS.TIMEZONE_HISTORY.TIMEZONE])===normalized && timezoneInstantMs_(r[COLS.TIMEZONE_HISTORY.EFFECTIVE_FROM])===fromMs){
      const existingTo=String(r[COLS.TIMEZONE_HISTORY.EFFECTIVE_TO]||'')?new Date(timezoneInstantMs_(r[COLS.TIMEZONE_HISTORY.EFFECTIVE_TO])).toISOString():'';
      return existingTo===toIso;
    }
  }
  const id=Utilities.getUuid(), row=[id,String(participantId),normalized,fromIso,toIso,String(source||'participant'),Number(setupVersion||0),operationId_()];
  const rn=storageAppendRow_(sheet,row,'timezone_provenance');
  const check=sheet.getRange(rn,1,1,COLS.TIMEZONE_HISTORY.COUNT).getValues()[0];
  return String(check[COLS.TIMEZONE_HISTORY.RECORD_ID])===String(id) && normalizeIanaTimezone_(check[COLS.TIMEZONE_HISTORY.TIMEZONE])===normalized && timezoneInstantMs_(check[COLS.TIMEZONE_HISTORY.EFFECTIVE_FROM])===fromMs;
}
function updateTimezoneHistoryInterval_(record,effectiveTo,newSource) {
  if(!record||!record.recordId) return false;
  const sheet=getTimezoneHistorySheet_();
  const persistedId=String(sheet.getRange(record.rowNumber,COLS.TIMEZONE_HISTORY.RECORD_ID+1).getValue()||'');
  if(persistedId!==String(record.recordId)) return false;
  const toMs=timezoneInstantMs_(effectiveTo); if(!Number.isFinite(toMs)||toMs<record.fromMs) return false;
  const toIso=new Date(toMs).toISOString();
  if(newSource!==undefined) storageSetValues_(sheet,record.rowNumber,COLS.TIMEZONE_HISTORY.EFFECTIVE_TO+1,[[toIso,String(newSource)]],'timezone_interval_reconcile');
  else storageSetValue_(sheet,record.rowNumber,COLS.TIMEZONE_HISTORY.EFFECTIVE_TO+1,toIso,'timezone_effective_to');
  const check=sheet.getRange(record.rowNumber,COLS.TIMEZONE_HISTORY.EFFECTIVE_TO+1,1,newSource!==undefined?2:1).getValues()[0];
  return timezoneInstantMs_(check[0])===toMs && (newSource===undefined||String(check[1])===String(newSource));
}
function participantTimezoneProjection_(participantId) {
  const rec=participantRowById_(participantId); if(!rec) return '';
  return normalizeIanaTimezone_(rec.row[COLS.PARTICIPANTS.TIMEZONE]);
}
function hasPriorCanonicalProjectDayAuthority_(participantId) {
  const p=participantRowById_(participantId);
  if(p && canonicalProjectDayKey_(p.row[COLS.PARTICIPANTS.ENROLLED_PROJECT_DAY])) return true;
  const ss=getSpreadsheet_();
  const scans=[
    {sheet:ss.getSheetByName('Sessions'),pid:COLS.SESSIONS.PARTICIPANT_ID,day:COLS.SESSIONS.PROJECT_DAY},
    {sheet:ss.getSheetByName('CalibrationCycles'),pid:COLS.CALIBRATION_CYCLES.PARTICIPANT_ID,day:COLS.CALIBRATION_CYCLES.PROJECT_DAY},
    {sheet:ss.getSheetByName('AdjustmentPlans'),pid:COLS.ADJUSTMENT_PLANS.PARTICIPANT_ID,day:COLS.ADJUSTMENT_PLANS.SOURCE_PROJECT_DAY}
  ];
  for(let s=0;s<scans.length;s++){
    const cfg=scans[s]; if(!cfg.sheet) continue;
    const rows=readRows_(cfg.sheet);
    for(let i=0;i<rows.length;i++) if(String(rows[i][cfg.pid])===String(participantId)&&canonicalProjectDayKey_(rows[i][cfg.day])) return true;
  }
  return false;
}
function ensureLegacyProspectiveTimezoneAuthority_(participantId, observationInstant) {
  const tMs=timezoneInstantMs_(observationInstant===undefined?now_():observationInstant); if(!Number.isFinite(tMs)) throw new Error('TEMPORAL_OBSERVATION_INVALID');
  let resolution=resolveEffectiveTimezoneAt_(participantId,new Date(tMs));
  if(resolution.status===TIMEZONE_AUTHORITY_STATUS.OK) return resolution;
  if(resolution.status===TIMEZONE_AUTHORITY_STATUS.AMBIGUOUS||resolution.status===TIMEZONE_AUTHORITY_STATUS.INVALID) throw new Error(resolution.status);
  const history=timezoneHistoryRowsForParticipant_(participantId);
  if(history.length) throw new Error('BLOCK_TEMPORAL_AUTHORITY_GAP');
  const projection=participantTimezoneProjection_(participantId);
  if(!projection) return {status:TIMEZONE_AUTHORITY_STATUS.NO_AUTHORITY,reason:'LEGACY_TIMEZONE_UNRESOLVED',instantMs:tMs};
  const iso=new Date(tMs).toISOString();
  if(!appendTimezoneHistory_(participantId,projection,iso,TIMEZONE_SOURCE.LEGACY_PROSPECTIVE_ANCHOR,0,'')) throw new Error('LEGACY_PROSPECTIVE_ANCHOR_WRITE_FAILED');
  resolution=resolveEffectiveTimezoneAt_(participantId,new Date(tMs));
  if(resolution.status!==TIMEZONE_AUTHORITY_STATUS.OK||resolution.timezone!==projection) throw new Error('LEGACY_PROSPECTIVE_ANCHOR_READBACK_FAILED');
  return resolution;
}
function nextProjectDayBoundary_(timezone, instant) {
  const zone=normalizeIanaTimezone_(timezone); if(!zone) throw new Error('TIMEZONE_REQUIRED_OR_INVALID');
  const startMs=timezoneInstantMs_(instant); if(!Number.isFinite(startMs)) throw new Error('BOUNDARY_INSTANT_INVALID');
  const day=projectDay_(zone,new Date(startMs));
  // Bracket a local-date transition; this bound is only a search envelope, never
  // the activation calculation. The exact boundary is then binary-searched.
  let lo=startMs, hi=startMs+36*60*60*1000;
  if(projectDay_(zone,new Date(hi))===day){hi=startMs+60*60*60*1000;if(projectDay_(zone,new Date(hi))===day)throw new Error('NEXT_PROJECT_DAY_BOUNDARY_NOT_FOUND');}
  while(hi-lo>1){const mid=Math.floor((lo+hi)/2);if(projectDay_(zone,new Date(mid))===day)lo=mid;else hi=mid;}
  return new Date(hi).toISOString();
}
function updateParticipantTimezoneProjection_(participant,normalized,instant) {
  if(!verifyRowIdentity_(getParticipantsSheet_(), participant.rowNumber, COLS.PARTICIPANTS.ID, participant.id, 'setParticipantTimezone_')) return false;
  const iso=new Date(timezoneInstantMs_(instant)).toISOString();
  storageSetValue_(getParticipantsSheet_(),participant.rowNumber,COLS.PARTICIPANTS.TIMEZONE+1,normalized,'participant_timezone_preference');
  storageSetValue_(getParticipantsSheet_(),participant.rowNumber,COLS.PARTICIPANTS.UPDATED_AT+1,iso,'participant_updated_at');
  const persisted=normalizeIanaTimezone_(getParticipantsSheet_().getRange(participant.rowNumber,COLS.PARTICIPANTS.TIMEZONE+1).getValue());
  if(persisted!==normalized) return false;
  participant.timezone=normalized; return true;
}


function setParticipantTimezone_(participant, zone, setupVersion, source) {
  const normalized=normalizeIanaTimezone_(zone); if(!normalized) return false;
  const requestMs=timezoneInstantMs_(now_()); if(!Number.isFinite(requestMs)) return false;
  const requestIso=new Date(requestMs).toISOString();
  let history=timezoneHistoryRowsForParticipant_(participant.id);
  let current=resolveEffectiveTimezoneAt_(participant.id,new Date(requestMs));
  if(!history.length){
    const projection=normalizeIanaTimezone_(participant.timezone||participantTimezoneProjection_(participant.id));
    if(projection){
      if(!appendTimezoneHistory_(participant.id,projection,requestIso,TIMEZONE_SOURCE.LEGACY_PROSPECTIVE_ANCHOR,0,'')) return false;
      current=resolveEffectiveTimezoneAt_(participant.id,new Date(requestMs)); history=timezoneHistoryRowsForParticipant_(participant.id);
    } else {
      const prior=hasPriorCanonicalProjectDayAuthority_(participant.id);
      const src=prior?TIMEZONE_SOURCE.LEGACY_PROSPECTIVE_ESTABLISHMENT:TIMEZONE_SOURCE.INITIAL_IMMEDIATE;
      if(!appendTimezoneHistory_(participant.id,normalized,requestIso,src,setupVersion,'')) return false;
      if(!updateParticipantTimezoneProjection_(participant,normalized,new Date(requestMs))) return false;
      const readback=resolveEffectiveTimezoneAt_(participant.id,new Date(requestMs));
      if(readback.status!==TIMEZONE_AUTHORITY_STATUS.OK||readback.timezone!==normalized) return false;
      participant.timezoneUpdateOutcome={mode:prior?'LEGACY_ESTABLISHMENT':'INITIAL_IMMEDIATE',selectedTimezone:normalized,effectiveFrom:requestIso,effectiveTimezone:normalized};
      return true;
    }
  }
  if(current.status===TIMEZONE_AUTHORITY_STATUS.AMBIGUOUS||current.status===TIMEZONE_AUTHORITY_STATUS.INVALID) return false;
  if(current.status!==TIMEZONE_AUTHORITY_STATUS.OK) return false;
  const oldZone=current.timezone, boundary=nextProjectDayBoundary_(oldZone,new Date(requestMs)), boundaryMs=timezoneInstantMs_(boundary);
  const all=timezoneHistoryRowsForParticipant_(participant.id);
  const currentRow=current.interval;
  if(currentRow.toMs!==Infinity && currentRow.toMs!==boundaryMs) return false;
  const future=all.filter(function(x){return Number.isFinite(x.fromMs)&&x.fromMs>requestMs&&x.toMs>x.fromMs;});
  if(future.some(function(x){return !x.zone;})) return false;
  if(future.length>1) return false;
  if(future.length===1 && future[0].fromMs!==boundaryMs) return false;
  let pending=future.length?future[0]:null;
  if(pending && pending.zone===normalized){
    if(!updateParticipantTimezoneProjection_(participant,normalized,new Date(requestMs))) return false;
    participant.timezoneUpdateOutcome={mode:'CORRECTION_SCHEDULED',selectedTimezone:normalized,effectiveFrom:boundary,effectiveTimezone:oldZone,idempotentPending:true};
    return true;
  }
  if(!pending && normalized===oldZone && currentRow.toMs===Infinity){
    if(!updateParticipantTimezoneProjection_(participant,normalized,new Date(requestMs))) return false;
    participant.timezoneUpdateOutcome={mode:'NO_CHANGE',selectedTimezone:normalized,effectiveFrom:requestIso,effectiveTimezone:oldZone};
    return true;
  }
  if(currentRow.toMs===Infinity && !updateTimezoneHistoryInterval_(currentRow,boundary)) return false;
  if(pending){
    const marker=normalized===oldZone?TIMEZONE_SOURCE.CANCELLED_PENDING:TIMEZONE_SOURCE.SUPERSEDED_PENDING;
    if(!updateTimezoneHistoryInterval_(pending,boundary,marker)) return false;
  }
  const newSource=normalized===oldZone?TIMEZONE_SOURCE.CORRECTION_CONTINUITY:TIMEZONE_SOURCE.CORRECTION_SCHEDULED;
  if(!appendTimezoneHistory_(participant.id,normalized,boundary,newSource,setupVersion,'')) return false;
  if(!updateParticipantTimezoneProjection_(participant,normalized,new Date(requestMs))) return false;
  const before=resolveEffectiveTimezoneAt_(participant.id,new Date(Math.max(requestMs,boundaryMs-1)));
  const at=resolveEffectiveTimezoneAt_(participant.id,new Date(boundaryMs));
  if(before.status!==TIMEZONE_AUTHORITY_STATUS.OK||before.timezone!==oldZone||at.status!==TIMEZONE_AUTHORITY_STATUS.OK||at.timezone!==normalized) return false;
  participant.timezoneUpdateOutcome={mode:'CORRECTION_SCHEDULED',selectedTimezone:normalized,effectiveFrom:boundary,effectiveTimezone:oldZone};
  return true;
}
function getParticipantTimezoneAt_(participantId,instant){
  const r=resolveEffectiveTimezoneAt_(participantId,instant);
  if(r.status===TIMEZONE_AUTHORITY_STATUS.OK) return r.timezone;
  if(r.status===TIMEZONE_AUTHORITY_STATUS.AMBIGUOUS||r.status===TIMEZONE_AUTHORITY_STATUS.INVALID) throw new Error(r.status);
  return '';
}
function showConsentComprehension_(chatId,setupVersion){
  sendTelegram_('Before you decide, check these key points: joining is your choice, and you can decline or stop. /delete-data removes participant/research records and the current membership cache. After deletion following successful enrollment, limited pseudonymous governance/control evidence remains: the repeat-enrollment eligibility marker and deletion-audit evidence; repeat-participation request/grant records may also remain under their access-control lifecycle. These records contain no Telegram ID, Signal Calibration answers, or deleted research records. Another independent participation requires owner authorization. If you request repeat participation, the owner receives access-control information for that request, but not your Signal Calibration answers or deleted research records. Participant export is not supported, and /export-data only reports that status. Does that match your understanding?',chatId,[[button_('Yes, that matches','CONSENT_COMPREHENSION_OK',setupVersion)],[button_('I need clarification','CONSENT_COMPREHENSION_REVIEW',setupVersion)]]);
}
function showConsentDecision_(chatId,setupVersion){
  sendTelegram_('Do you consent to participate under the data and rights information above?',chatId,[[button_('Yes, I consent','CONSENT_YES',setupVersion),button_('No','CONSENT_NO',setupVersion)]]);
}
function showTimezoneSelect_(participant,chatId,setupVersion){
  const rows=[]; const buttons=COMMON_TIMEZONE_CHOICES.map((choice,index)=>({text:choice.label,callback_data:'TIMEZONE_SET|'+setupVersion+'|'+index})); for(let i=0;i<buttons.length;i+=2) rows.push(buttons.slice(i,i+2));
  return withPromptOwnerContext_({owner:'SETUP_TIMEZONE',participantId:String(participant.id),setupVersion:Number(setupVersion),step:'TIMEZONE',chatId:String(chatId)},function(){
    return sendTelegram_('Choose the valid IANA timezone that defines your local calibration day. A valid timezone is required before day-based calibration starts, and there is no default. The buttons are examples only — not a preselected choice — and you may instead type a valid Area/City such as Asia/Tehran, Europe/Paris, America/New_York, or UTC. Your first timezone becomes effective immediately because no earlier timezone exists for your calibration days. If you later correct the timezone, the correction is saved but does not change the calibration day already in progress. It becomes effective at the next calibration-day boundary calculated under the timezone that remains active until that boundary. Earlier records keep the timezone they were recorded with; they are not rewritten. A timezone change does not reset the 21-day enrollment anchor.',chatId,rows);
  });
}
function showCurrentSetup_(participant,chatId){
  let c=currentSetup_(participant.id);
  if(!c || c.status!=='ACTIVE') c=beginSetup_(participant,SETUP_STEP.CONSENT_COMPREHENSION,'START',{mode:'START_SESSION'},true);
  if(c.step===SETUP_STEP.CONSENT_COMPREHENSION){ showConsent_(chatId,c.version); return; }
  if(c.step===SETUP_STEP.CONSENT_DECISION){ showConsentDecision_(chatId,c.version); return; }
  if(c.step===SETUP_STEP.TIMEZONE){ showTimezoneSelect_(participant,chatId,c.version); return; }
  showConsent_(chatId,c.version);
}
function setupTimezonePromptBarrierAllowsInput_(participant, setup, chatId, incomingMessageId) {
  if(!participant||!setup||setup.status!=='ACTIVE'||setup.step!==SETUP_STEP.TIMEZONE||!validTelegramInteger_(incomingMessageId,false)) return false;
  const b=setup.details&&setup.details._prompt_barrier;
  return !!(b&&String(b.owner)==='SETUP_TIMEZONE'&&String(b.participant_id)===String(participant.id)&&Number(b.setup_version)===Number(setup.version)&&String(b.step)==='TIMEZONE'&&String(b.chat_id)===String(chatId)&&String(b.delivery_status)==='TELEGRAM_ACCEPTED_COMPLETE'&&validTelegramInteger_(Number(b.prompt_message_id),false)&&Number(incomingMessageId)>Number(b.prompt_message_id));
}

function finishTimezoneSetup_(participant,setup,zone,chatId,source){
  if(!setParticipantTimezone_(participant,zone,setup.version,source)) { sendTelegram_('That timezone could not be saved safely. Please enter a valid IANA timezone and try again; no default timezone will be substituted.',chatId); return false; }
  advanceSetup_(participant,setup,SETUP_STEP.COMPLETE,'TIMEZONE_SAVED','COMPLETE',setup.details);
  const outcome=participant.timezoneUpdateOutcome||{}, selected=escapeHtml_(String(participant.timezone||zone));
  if(outcome.mode==='INITIAL_IMMEDIATE'){
    sendTelegram_('Timezone set to '+selected+'. This is your first timezone for calibration days, so it is effective immediately and defines your local calibration-day boundaries. There is no default. Earlier records are not rewritten, and the 21-day enrollment anchor is not reset.',chatId);
  } else if(outcome.mode==='LEGACY_ESTABLISHMENT'){
    sendTelegram_('Timezone established as '+selected+' for future calibration days. Earlier records keep the timezone information they already have; no timezone is invented for them. The 21-day enrollment anchor is not reset.',chatId);
  } else if(outcome.mode==='NO_CHANGE'){
    sendTelegram_('Timezone remains '+selected+'. The effective calibration-day timezone did not change; earlier records and the 21-day enrollment anchor remain unchanged.',chatId);
  } else {
    sendTelegram_('Timezone correction saved as '+selected+'. It does not change the calibration day already in progress. It becomes effective at the next calibration-day boundary calculated under the timezone that remains active until that boundary. Earlier records keep the timezone they were recorded with; they are not rewritten. The 21-day enrollment anchor is not reset.',chatId);
  }
  if(setup.details && setup.details.mode==='START_SESSION') startOrOfferReentry_(participant,chatId);
  return true;
}


// UX-STOP-V1 — OFFLINE CANDIDATE. Does not auto-delete historical data or reset enrollment.
// Gate/role restrictions remain enforced by ChannelGate before core processing.
const SCB_STOP_CONFIRMATION_TTL_SECONDS_ = 600;
function isParticipantResearchStopped_(participant) {
  return !!participant && String(participant.windowStatus||'') === WINDOW_STATUS.EARLY_STOP;
}
function stopRequestCacheKey_(participant) {
  return 'SCB_STOP_PENDING_V1_' + String(participant.id);
}
function createStopConfirmation_(participant, chatId) {
  // Cache eviction/expiry is a safe cancellation: the person may retry /stop.
  const nonce = Utilities.getUuid().replace(/-/g,'');
  if (!/^[0-9a-f]{32}$/i.test(nonce)) throw new Error('STOP_NONCE_INVALID');
  CacheService.getScriptCache().put(stopRequestCacheKey_(participant),nonce,SCB_STOP_CONFIRMATION_TTL_SECONDS_);
  sendTelegram_('Do you want to stop participating in Signal Calibration? This will stop future research questions and reviews under this enrollment. It does not automatically delete earlier records. /delete-data is a separate confirmed action. You do not need to give a reason.',chatId,
    [[{text:'Stop participating',callback_data:'STOP_CONFIRM|'+nonce}],
     [{text:'Keep participating',callback_data:'STOP_CANCEL|'+nonce}]]);
}
function recordConfirmedParticipantStop_(participant) {
  if (isParticipantResearchStopped_(participant)) return false;
  if (String(participant.consentStatus||'') !== 'CONSENTED') throw new Error('STOP_REQUIRES_CONSENT');
  const sh=getParticipantsSheet_();
  if(!verifyRowIdentity_(sh,participant.rowNumber,COLS.PARTICIPANTS.ID,participant.id,'participant_confirmed_stop'))
    throw new Error('STOP_PARTICIPANT_IDENTITY_MISMATCH');
  // No timezone/enrollment bootstrap: a consented person can withdraw before choosing a timezone.
  storageSetValue_(sh,participant.rowNumber,COLS.PARTICIPANTS.WINDOW_STATUS+1,WINDOW_STATUS.EARLY_STOP,'participant_confirmed_stop');
  const actual=String(sh.getRange(participant.rowNumber,COLS.PARTICIPANTS.WINDOW_STATUS+1).getValue());
  if(actual!==WINDOW_STATUS.EARLY_STOP) throw new Error('STOP_PERSISTENCE_NOT_VERIFIED');
  participant.windowStatus=WINDOW_STATUS.EARLY_STOP;
  // Logging is secondary: an audit-write failure must not reactivate research participation.
  try { appendEvent_(participant.id,'','PARTICIPANT_WINDOW_EARLY_STOP',{reason:RUN_CLOSURE_STATUS.EARLY_STOP_WITHDRAWAL,initiator:'PARTICIPANT_CONFIRMED'}); }
  catch (auditError) { log_('PARTICIPANT_STOP_AUDIT_WRITE_FAILED',{category:'event_append_failed'}); }
  return true;
}
function handleStopButton_(participant, action, nonce, chatId) {
  if (String(participant.consentStatus||'')!=='CONSENTED') {
    sendTelegram_('You are not currently enrolled. Use /decline before consenting or /help for available controls.',chatId); return;
  }
  if (isParticipantResearchStopped_(participant)) {
    sendTelegram_('Participation is already stopped. No new research answer was recorded. /privacy and /delete-data remain separate options.',chatId); return;
  }
  const cache=CacheService.getScriptCache();
  const expected=cache.get(stopRequestCacheKey_(participant));
  if (!expected || !/^[0-9a-f]{32}$/i.test(String(nonce||'')) || !constantTimeEqual_(expected,String(nonce))) {
    sendTelegram_('This stop confirmation is expired or no longer valid. No change was made. Use /stop to request a new confirmation.',chatId); return;
  }
  if (action==='STOP_CANCEL') {
    cache.remove(stopRequestCacheKey_(participant));
    sendTelegram_('You have kept your participation active. No stop was recorded. Use /start or /review to continue when eligible.',chatId); return;
  }
  if (action!=='STOP_CONFIRM') return;
  // The webhook dispatcher holds the existing ScriptLock: overlapping callbacks are serialized.
  try { recordConfirmedParticipantStop_(participant); }
  catch(stopError) {
    log_('PARTICIPANT_STOP_PERSISTENCE_FAILED',{category:'stop_storage_failure'});
    sendTelegram_('I could not verify that your stop request was saved. Please use /stop again. You can still use /privacy or /delete-data.',chatId); return;
  }
  cache.remove(stopRequestCacheKey_(participant));
  sendTelegram_('Your participation has been stopped. No new Signal Calibration research questions or reviews will be recorded under this enrollment. Earlier records were not automatically deleted. Use /privacy or /delete-data for data controls.',chatId);
}
function routeStoppedParticipantText_(participant, command, chatId) {
  if (command==='/delete-data') { beginDeletionConfirmation_(participant.id,chatId); return true; }
  if (command==='/privacy' || command==='/export-data') return false; // Existing read-only policy texts.
  if (command==='/help') {
    sendTelegram_('Participation is stopped. You cannot restart calibration or review under this enrollment. Available controls: /stop (status), /privacy (data information), /delete-data (separate confirmed deletion), /acute or /recovery (support guidance), /export-data (status only).',chatId); return true;
  }
  if (command==='/acute' || command==='/recovery') {
    // Safety support without creating a research session or modifying an intervention.
    sendTelegram_(command==='/acute' ? 'Get help now if you need it. No research response is needed.' : 'Rest now. No research response is needed.',chatId); return true;
  }
  sendTelegram_('Your participation is stopped. No research response or new session was recorded. Use /help for available controls.',chatId);
  return true;
}

const SCB_RECOGNIZED_CORE_COMMAND_TOKENS_ = Object.freeze([
  '/acute','/adjustment-withdraw','/decline','/delete-data','/export-data','/gate','/help','/later','/privacy','/recovery','/reflect','/review','/start','/stop','/timezone'
]);
function isLeadingSlashControl_(text) {
  return String(text==null?'':text).trim().charAt(0)==='/';
}
function isRecognizedCoreCommandToken_(command) {
  return SCB_RECOGNIZED_CORE_COMMAND_TOKENS_.indexOf(String(command==null?'':command).toLowerCase())>=0;
}

// FINAL-CMD-01: Telegram @bot mentions are commands only for THIS configured bot.
// The property is optional for bare commands but mandatory for explicitly addressed commands.
// Never accept a foreign @bot command as participant research text.
function scbCanonicalizeMenuCommand_(text) {
  // Telegram menu commands support underscores, but not hyphens.
  // Retain the established hyphenated participant commands as legacy aliases.
  return String(text).replace(/^(\s*)\/(delete_data|export_data|adjustment_withdraw)(?=\s|$)/i,
    function(all,prefix,token){return prefix + '/' + token.toLowerCase().replace(/_/g,'-');});
}
function scbResolveTelegramCommandText_(input) {
  const raw = String(input == null ? '' : input);
  const trimmed = raw.trim();
  const match = /^(\/[A-Za-z0-9_-]+)@([A-Za-z0-9_]+)(?=\s|$)/.exec(trimmed);
  if (!match) return {accepted:true,text:scbCanonicalizeMenuCommand_(raw),addressed:false};
  let username = '';
  try {
    username = String(PropertiesService.getScriptProperties().getProperty('SCB_BOT_USERNAME') || '').trim().replace(/^@/, '');
  } catch (ignored) { return {accepted:false,text:'',addressed:true,reason:'BOT_USERNAME_CONFIGURATION_UNAVAILABLE'}; }
  if (!/^[A-Za-z0-9_]{5,32}$/.test(username))
    return {accepted:false,text:'',addressed:true,reason:'BOT_USERNAME_NOT_CONFIGURED'};
  if (match[2].toLowerCase() !== username.toLowerCase())
    return {accepted:false,text:'',addressed:true,reason:'FOREIGN_BOT_COMMAND'};
  return {accepted:true,text:scbCanonicalizeMenuCommand_(match[1]+trimmed.slice(match[0].length)),addressed:true};
}

function handleCommandOrText_(participant, text, chatId, incomingMessageId) {
  const commandAddress = scbResolveTelegramCommandText_(text);
  if (!commandAddress.accepted) return; // No reply or research write for foreign/unknown bot address.
  text = commandAddress.text;
  const command = String(text==null?'':text).trim().split(/\s+/)[0].toLowerCase();
  // Participant-controlled stop is intercepted before reflection text, session text, and safety-session creation.
  if (command==='/stop') {
    if(participant.consentStatus!=='CONSENTED') { sendTelegram_('No participation has started. You can use /decline before consent, or /help.',chatId); return; }
    if(isParticipantResearchStopped_(participant)) { sendTelegram_('Your participation is already stopped. Nothing new was recorded. /delete-data is a separate action.',chatId); return; }
    createStopConfirmation_(participant,chatId); return;
  }
  if (isParticipantResearchStopped_(participant) && routeStoppedParticipantText_(participant,command,chatId)) return;
  if (isLeadingSlashControl_(text) && !isRecognizedCoreCommandToken_(command)) {
    if (command === '/explain') {
      sendTelegram_("There isn't a separate explanation command in this version. Use /help to see the available controls.", chatId);
    } else {
      sendTelegram_('That command is not available in this version. No answer was recorded. Use /help for available controls.', chatId);
    }
    return;
  }
  // F61 CHANGE-CONTROL — plain-language rewrite of the four ACUTE/RECOVERY
  // strings (Accessibility fix, Phase 2). Date: 2026-08-19.
  // (1) WHAT CHANGED: all four strings below and in renderState_
  // (ACUTE_EXIT, RECOVERY_EXIT) are rewritten as direct imperatives —
  // "Get help now" / "Rest now" instead of "Please attend to your
  // immediate safety needs" / "Take the recovery you need: step away,
  // reduce demands..." — removing indirection and idiom ("attend to,"
  // "step away, reduce demands... only when you are ready" as one long
  // conditional clause) that a reader working through the text literally,
  // rather than idiomatically, would have to parse rather than act on
  // immediately. No new terms introduced, so no /explain reference or
  // footer applies — see (3).
  // (2) WHY PRIOR WAS INSUFFICIENT: these are the bot's two genuinely
  // time-critical exits (per F-F6a's own note, immediately above ACUTE's
  // render branch: "gate a same-day exit... for urgent medical/safety/
  // crisis attention"). An indirect phrasing ("attend to your immediate
  // safety needs") costs a reader an extra parsing step to convert into
  // an action, which is the wrong place in this bot to spend that cost —
  // per master doc §DESIGN PRINCIPLES, these two states are designed to
  // resolve "cleanly and immediately in the moment" (F-F6a), and that
  // design intent extends to the wording itself, not just the absence of
  // a third button option.
  // RETURN-PATH DECISION (explicit, not silent, per this fix's own
  // instruction): checked ACUTE_EXIT and RECOVERY_EXIT (renderState_)
  // directly — NEITHER previously contained a "/start later..." return
  // instruction; only the two PRE-CONSENT messages here did. That
  // pre-consent/post-consent asymmetry is correct and unchanged: a
  // pre-consent user hasn't started calibrating yet and needs to be told
  // how to opt in later, while a post-consent ACUTE_EXIT/RECOVERY_EXIT
  // user is already a participant and only needs to know the current
  // session is closed. Decision, made explicitly rather than left
  // ambiguous: WITHIN post-consent, ACUTE_EXIT and RECOVERY_EXIT are kept
  // symmetric — neither gets a return-path line. Nothing in the master
  // doc's §RECOVERY/HEALTH/MAINTENANCE section or the ACUTE design intent
  // supports ACUTE closure reading as more final than RECOVERY closure;
  // both are "attend to it, resume whenever you're ready" exits. Adding a
  // return path to one but not the other would manufacture an asymmetry
  // the design never called for. The two PRE-CONSENT strings below both
  // now carry the "/start later" line for the same reason (previously
  // only /acute's pre-consent message had it; /recovery's pre-consent
  // message did not — this fix also closes that specific inconsistency,
  // since both are the same case: a not-yet-consented person who should
  // be told the same thing about coming back later).
  // (3) EXCLUSION CONFIRMED BY NAME: these four strings are explicitly
  // OUT OF SCOPE for /explain (F62), the discovery footer (F63), and any
  // comprehension-check mechanism. They must remain standalone-
  // comprehensible on their own, with no dependency on a separate command
  // or reference — consistent with Phase 0.5's own exclusion of
  // ACUTE/ACUTE_EXIT/RECOVERY/RECOVERY_EXIT from the locked jargon-cluster
  // table, and for the same underlying reason: these are fast,
  // no-friction, safety-critical exits, and adding any pointer to a
  // second surface would add friction exactly where the design goes out
  // of its way to avoid it.
  // (4) EVIDENCE MOTIVATING THE CHANGE: Phase 0 decisions record (plain,
  // high-frequency vocabulary target) plus direct re-verification of the
  // four target strings against this file before editing (grep-confirmed
  // current text matched the accessibility-fix prompt pack's citation, no
  // stale-comment risk of the kind F19/F45/F49 previously found
  // elsewhere in this file). No new participant/usability data.
  // (5) DOWNSTREAM COMPONENTS AFFECTED: four sendTelegram_ string literals
  // only (two here, two in renderState_). No state-machine, button ID,
  // payload field, or control-flow change — startStandaloneResolution_,
  // STATES.ACUTE_EXIT/RECOVERY_EXIT, and the consentStatus branching above
  // are all untouched.
  // RETESTING REQUIRED: yes — see the retest note after this block.
  //
  // Safety and recovery remain reachable without a session. Before consent, they
  // deliver support without creating or retaining a session record.
  if (command === '/acute') {
    if (participant.consentStatus === 'CONSENTED') startStandaloneResolution_(participant, chatId, STATES.ACUTE_EXIT);
    else sendTelegram_('Get help now if you need it. No further reply is required. When it is safe, you can return with /start or use /recovery.', chatId);
    return;
  }  if (command === '/recovery') {
    if (participant.consentStatus === 'CONSENTED') startStandaloneResolution_(participant, chatId, STATES.RECOVERY_EXIT);
    else sendTelegram_('Rest now. No further reply is required. When you are ready, you can return with /start.', chatId);
    return;
  }
  // F61 RETEST NOTE (Accessibility fix, Phase 2). Date: 2026-08-19.
  // Retested all four ACUTE/RECOVERY entry points by trace:
  // (a) Pre-consent /acute -> the string above, consentStatus branch
  //     unchanged, still returns immediately with no session created.
  // (b) Pre-consent /recovery -> same, string above, unchanged branch.
  // (c) In-session ACUTE_EXIT (via READY -> ACUTE -> ACUTE_YES, per
  //     handleAction_'s existing STATES.ACUTE/'ACUTE_YES' branch) ->
  //     renderState_'s STATES.ACUTE_EXIT branch renders the new "Get help
  //     now. This session is closed." string; transitionSession_'s
  //     TERMINAL_STATES handling (ACTIVITY_STATUS -> 'COMPLETE') is
  //     unaffected by a string-only change.
  // (d) In-session RECOVERY_EXIT (via READY -> ACUTE -> ACUTE_NO ->
  //     RECOVERY -> RECOVERY_YES) -> renderState_'s STATES.RECOVERY_EXIT
  //     branch renders the new "Rest now. This session is closed; no further reply is required. When you are ready, you can return with /start." string,
  //     same unaffected transition handling as (c).
  // Also confirmed: /acute and /recovery remain reachable identically
  // before and after consent (the consentStatus branch controlling which
  // of the two message variants fires is untouched), and neither string
  // references /explain or carries a footer, consistent with (3) above.
  // RESULT: PASS, all four paths.
  if (command === '/export-data' && participant.consentStatus !== 'CONSENTED') {
    sendTelegram_('This version cannot generate a participant data-export file. This request has not created or shared an export file. Use /privacy to read how data is handled.', chatId);
    return;
  }  if (participant.consentStatus !== 'CONSENTED' && preConsentCommands.indexOf(command) < 0) {
    showCurrentSetup_(participant,chatId);
    return;
  }
  if (handleReflectionAnswerIfAwaiting_(participant, text, chatId, incomingMessageId)) return;  if (text === '/later' || command === '/later') {
    const later = getLatestSessionWithLaterItems_(participant.id);
    const items = later && later.payload && Array.isArray(later.payload.later_items)
      ? later.payload.later_items
      : [];
    if (!items.length) {
      sendTelegram_('No saved Later items are available. /later only displays saved items; it does not schedule reminders.', chatId);
    } else {
      sendTelegram_('Later — captured items (no automatic promotion):\n' +
        items.map(function(item, i) { return (i + 1) + '. ' + escapeHtml_(String(item)); }).join('\n'), chatId);
    }
    return;
  }  if (command === '/reflect') {
    const flag = participant.layerCheckpointFlag;
    if (!flag) {
      sendTelegram_('There is no open reflection checkpoint right now. /reflect is available only when a checkpoint is open.', chatId);
      return;
    }
    if (flag !== 'L2_TO_L3' && flag !== 'PILOT_END' &&
        flag !== 'L2_TO_L3' + LAYER_CHECKPOINT_AWAITING_SUFFIX &&
        flag !== 'PILOT_END' + LAYER_CHECKPOINT_AWAITING_SUFFIX) {
      sendTelegram_('This reflection checkpoint is not available. No response was recorded.', chatId);
      return;
    }
    if (flag.indexOf(LAYER_CHECKPOINT_AWAITING_SUFFIX) >= 0) {
      // Already asked, still waiting on the answer — re-ask rather than
      // re-open, so a stray /reflect resend doesn't lose the pending state.
      renderReflectionPrompt_(participant,chatId);
      return;
    }
    if (!verifyRowIdentity_(getParticipantsSheet_(), participant.rowNumber, COLS.PARTICIPANTS.ID, participant.id, 'reflectCommand')) {
      sendTelegram_('Something went wrong — please try again.', chatId);
      return;
    }
    const awaitingFlag = flag + LAYER_CHECKPOINT_AWAITING_SUFFIX;
    storageSetValue_(getParticipantsSheet_(), participant.rowNumber, COLS.PARTICIPANTS.LAYER_CHECKPOINT_FLAG + 1, awaitingFlag, 'participant_reflection_awaiting');
    participant.layerCheckpointFlag = awaitingFlag;
    renderReflectionPrompt_(participant,chatId);
    return;
  }
  // The historic F62 /explain handler documented in earlier comments is not
  // present. /explain only reports unavailability at the unknown-command boundary.
  if (command === '/decline' && participant.consentStatus !== 'CONSENTED') {
    const setup=currentSetup_(participant.id) || beginSetup_(participant,SETUP_STEP.CONSENT_COMPREHENSION,'DECLINE_COMMAND',{},true);
    if(!updateParticipantConsent_(participant,'DECLINED') || !appendConsentHistory_(participant.id,setup.version,'','DECLINED')) { sendTelegram_('Your decline could not be saved. Please try again.',chatId); return; }
    advanceSetup_(participant,setup,SETUP_STEP.DECLINED,'DECLINED_COMMAND','DECLINED',{});
    sendTelegram_('You are not enrolled. You can use /start later if you want to review consent again, or /delete-data to erase this setup record.',chatId); return;
  }
  if (command === '/timezone' && participant.consentStatus === 'CONSENTED') {
    const rawZone=String(text||'').replace(/^\/timezone(?:@\w+)?\s*/i,'').trim();
    const setup=beginSetup_(participant,SETUP_STEP.TIMEZONE,'TIMEZONE_CORRECTION_START',{mode:'CORRECTION_ONLY'},true);
    if(!rawZone){ showTimezoneSelect_(participant,chatId,setup.version); return; }
    if(!finishTimezoneSetup_(participant,setup,rawZone,chatId,'participant_correction')) showTimezoneSelect_(participant,chatId,setup.version);
    return;
  }
  if (participant.consentStatus === 'CONSENTED') {
    const setup=currentSetup_(participant.id);
    if(setup && setup.status==='ACTIVE' && setup.step===SETUP_STEP.TIMEZONE && command.charAt(0)!=='/') {
      if(!setupTimezonePromptBarrierAllowsInput_(participant,setup,chatId,incomingMessageId)) {
        log_('PROMPT_CAUSALITY_REJECTED',{owner:'SETUP_TIMEZONE',participantId:String(participant.id),chatId:String(chatId),incomingMessageId:validTelegramInteger_(incomingMessageId,false)?incomingMessageId:null,reason:'PROMPT_BARRIER_UNCONFIRMED_OR_PRE_PROMPT'});
        showTimezoneSelect_(participant,chatId,setup.version); return;
      }
      if(!finishTimezoneSetup_(participant,setup,text,chatId,setup.action==='CONSENT_GRANTED'?'post_consent':'participant_correction')) showTimezoneSelect_(participant,chatId,setup.version);
      return;
    }
  }
  if (command === '/start') {
    if (participant.consentStatus !== 'CONSENTED') { showCurrentSetup_(participant,chatId); return; }
    if (!getParticipantTimezone_(participant.id)) { const setup=beginSetup_(participant,SETUP_STEP.TIMEZONE,'MISSING_TIMEZONE_START',{mode:'START_SESSION'},true); showTimezoneSelect_(participant,chatId,setup.version); return; }
    startOrOfferReentry_(participant, chatId);
    return;
  }  if (command === '/review') {
    // PE03: review is same-lineage activity. A pre-consent/setup-only row must
    // not cross the durable enrollment/entitlement boundary merely by asking
    // for /review.
    if (participant.consentStatus !== 'CONSENTED') {
      sendTelegram_('Use /start to review consent before using /review.', chatId);
      return;
    }
    ensureParticipantRunEnrollment_(participant); startReview_(participant, chatId);
    return;
  }  if (command === '/gate') {
    if (!isTesterParticipant_(participant.id)) {
      sendTelegram_('Use /start to begin a new calibration, or /review to review your focal Signal.', chatId);
      return;
    }
    startDecisionGateTest_(participant, text, chatId);
    return;
  }  if (command === '/adjustment-withdraw') {
    if(participant.consentStatus!=='CONSENTED'){sendTelegram_('Use /start to review consent before managing an adjustment.',chatId);return;}
    const active=getCurrentSession_(participant.id);
    if(active && (active.state===STATES.ADJUSTMENT_CONTACT||active.state===STATES.ADJUSTMENT_REVISE)){
      const authorization=authorizeOrdinaryMorningBeforeMutation_(participant.id,chatId,'ADJUSTMENT_WITHDRAW_TO_MORNING');
      if(!authorization.allowed) return;
      const withdrawn=withdrawActiveAdjustment_(participant.id);
      if(withdrawn) active.payload=Object.assign({},active.payload||{},{adjustment_withdrawn:true});
      finishAdjustmentContactAndStartMorning_(active,chatId); return;
    }
    const withdrawn=withdrawActiveAdjustment_(participant.id);
    sendTelegram_(withdrawn?'Pending adjustment withdrawn. It will not be recalled at a future morning.':'There is no pending adjustment to withdraw. Nothing was changed.',chatId); return;
  }  if (command === '/delete-data') {
    beginDeletionConfirmation_(participant.id, chatId);
    return;
  }  if (command === '/export-data') {
    exportParticipantData_(participant.id, chatId);
    return;
  }  if (command === '/privacy') {
    // PE06: privacy is data-rights information, not teaching exposure. Keep it
    // outside sendTeachingContent_ so access-control policy cannot become a
    // Signal Calibration exposure/outcome variable.
    if(participant.consentStatus!=='CONSENTED') {
      sendTelegram_('Before consent, the bot stores only the setup/identity records needed to process your request. After successful channel verification, it also keeps a current channel-membership cache so it does not need to ask Telegram on every normal message; that cache is deletable. If you later successfully complete enrollment and become an active participant, /delete-data removes participant/research records and the current membership cache but retains limited pseudonymous governance/control evidence: the repeat-enrollment eligibility marker and deletion-audit evidence; repeat-participation request/grant records may also remain under their access-control lifecycle. These retained records contain no Telegram ID, Signal Calibration answers, or deleted research records. Another independent participation requires owner authorization. If you explicitly request repeat participation, the owner-visible access-control request contains only a pseudonymous reference and participation generation. Signed Telegram button-routing metadata may contain a compact target-account identifier only so the bot can route the owner\'s Approve, Deny, or Revoke action to the right account. That routing identifier is not shown as participant information, not stored in the request record, and not logged. The repeat-participation access-control process does not send your Signal Calibration answers or deleted research records to the owner. Re-entry request/grant information is access/governance data, not a Signal Calibration research outcome. Use /start to review the full consent disclosure, /decline to decline, or /delete-data to review deletion.',chatId);
      return;
    }
    sendTelegram_('Your participant/research records are stored for Signal Calibration until you delete them, subject to the specific technical retention described in consent. The current channel-membership cache is separate and deletable. After successful post-enrollment deletion, limited pseudonymous governance/control evidence is retained: the repeat-enrollment eligibility marker and deletion-audit evidence; repeat-participation request/grant records may also remain under their access-control lifecycle. These retained records contain no Telegram ID, Signal Calibration answers, or deleted research records and are not Signal Calibration outcomes or research measures. Another independent participation requires owner authorization. If you explicitly request repeat participation, the owner-visible access-control request contains only a pseudonymous reference and participation generation. Signed Telegram button-routing metadata may contain a compact target-account identifier only so the bot can route the owner\'s Approve, Deny, or Revoke action to the right account. That routing identifier is not shown as participant information, not stored in the request record, and not logged. The repeat-participation access-control process does not send your Signal Calibration answers or deleted research records to the owner. Re-entry request/grant information is access/governance data, not a Signal Calibration research outcome. Use /delete-data to review exactly what will be removed.',chatId);
    return;
  }  if (command === '/help') {
    if(participant.consentStatus!=='CONSENTED') { sendTelegram_('Before consent you can use /start, /help, /privacy, /decline, /delete-data, /acute, or /recovery.',chatId); return; }
    // UX-CMD-01: keep this list aligned with executable and context-gated commands.
    // Availability of a command is not a promise that a new session or checkpoint exists.
    sendTelegram_(
      'Available commands after consent:\n' +
      '/start — begin or resume an eligible morning calibration within the 21-day window.\n' +
      '/review — review a recorded morning episode when available.\n' +
      '/stop — request a confirmed stop of future participation; does not delete prior records.\n' +
      '/later — view the most recent saved set of Later items; no reminders are scheduled.\n' +
      '/adjustment_withdraw (or /adjustment-withdraw) — withdraw a pending optional adjustment, if any.\n' +
      '/timezone Area/City — correct your timezone; this does not reset the 21-day window.\n' +
      '/acute or /recovery — safety and recovery routes.\n' +
      '/privacy — read the data and retention policy.\n' +
      '/export_data (or /export-data) — status only; this version cannot create a participant export file.\n' +
      '/delete_data (or /delete-data) — review and confirm deletion of participant/research records.' +
      ((participant.layerCheckpointFlag === 'L2_TO_L3' || participant.layerCheckpointFlag === 'PILOT_END' ||
        participant.layerCheckpointFlag === 'L2_TO_L3' + LAYER_CHECKPOINT_AWAITING_SUFFIX ||
        participant.layerCheckpointFlag === 'PILOT_END' + LAYER_CHECKPOINT_AWAITING_SUFFIX)
        ? '\n/reflect — answer the currently open, operator-authorized reflection checkpoint.' : ''), chatId);
    return;
  }
  // UX-CMD-02: a consented person's /decline is still a command, never a
  // typed research response in a free-text-accepting morning/review state.
  if (command === '/decline') {
    sendTelegram_('The /decline command applies before consent. No participation status or saved answer was changed. If you want to stop future participation, use /stop and confirm. To request deletion of earlier records, use the separate /delete-data command.', chatId);
    return;
  }
  const session = getCurrentSession_(participant.id);
  if (session) handleStateInput_(session, text, chatId, incomingMessageId);
  else sendTelegram_('Use /start to begin a new calibration, or /review to review your focal Signal.', chatId);
}

// P06 callback boundary: setup callbacks are handled before session callbacks only
// when they match the resolved participant's current append-only setup record,
// expected setup step, and setup version. Participant and private-chat identity
// still come exclusively from the P05-validated Telegram envelope, never from
// callback_data. Stale/crafted/replayed setup callbacks do not mutate state.
function handleCallback_(participant, callbackData, chatId) {
  const parts = callbackData.split('|');
  const action = parts[0];
  const setupVersion = Number(parts[1]);
  if(action==='STOP_CONFIRM'||action==='STOP_CANCEL') {
    handleStopButton_(participant,action,String(parts[1]||''),chatId); return;
  }
  // Deletion rights remain reachable after stop, but no other callback may mutate research state.
  if(isParticipantResearchStopped_(participant) && action!=='DC_DELETE_CONFIRM' && action!=='DC_DELETE_CANCEL') {
    sendTelegram_('Your participation is stopped. That research button is no longer active. Use /help for remaining controls.',chatId); return;
  }
  if(action==='CONSENT_COMPREHENSION_OK' || action==='CONSENT_COMPREHENSION_REVIEW') {
    if(!setupCallbackIsCurrent_(participant,setupVersion,SETUP_STEP.CONSENT_COMPREHENSION)){ sendTelegram_('That setup action is no longer active. Use /start to continue from the current step.',chatId); return; }
    const setup=currentSetup_(participant.id);
    if(action==='CONSENT_COMPREHENSION_REVIEW') { if(!appendConsentHistory_(participant.id,setup.version,'CLARIFICATION_REQUESTED','')){sendTelegram_('Clarification: participation is voluntary; you can decline or stop. /delete-data removes participant/research records and the current membership cache. After deletion following successful enrollment, limited pseudonymous governance/control evidence remains: the repeat-enrollment eligibility marker and deletion-audit evidence; repeat-participation request/grant records may also remain under their access-control lifecycle. These retained records contain no Telegram ID, Signal Calibration answers, or deleted research records, and another independent participation requires owner authorization. If you request repeat participation, the owner receives access-control information for that request only — not your Signal Calibration answers or deleted research records. Participant export is not supported; /export-data only reports that status. None of this is a performance test.',chatId);return;} sendTelegram_('Clarification: joining is voluntary. You can decline or stop. /export-data reports that participant export is not supported in this build. /delete-data erases participant/research records and the current channel-membership cache. After deletion following successful enrollment, limited pseudonymous governance/control evidence remains: the repeat-enrollment eligibility marker and deletion-audit evidence; repeat-participation request/grant records may also remain under their access-control lifecycle. These retained records contain no Telegram ID, Signal Calibration answers, or deleted research records. Another independent participation requires owner authorization. None of this is a performance test.',chatId); showConsentComprehension_(chatId,setup.version); return; }
    if(!appendConsentHistory_(participant.id,setup.version,'CONFIRMED','')){sendTelegram_('That response could not be saved. Please try again.',chatId);return;}
    advanceSetup_(participant,setup,SETUP_STEP.CONSENT_DECISION,'COMPREHENSION_CONFIRMED','ACTIVE',setup.details); showConsentDecision_(chatId,setup.version); return;
  }
  if(action==='CONSENT_YES' || action==='CONSENT_NO') {
    if(!setupCallbackIsCurrent_(participant,setupVersion,SETUP_STEP.CONSENT_DECISION)){ sendTelegram_('That consent action is no longer active. Use /start to continue from the current step.',chatId); return; }
    const setup=currentSetup_(participant.id), decision=action==='CONSENT_YES'?'CONSENTED':'DECLINED';
    if(!updateParticipantConsent_(participant,decision)){ sendTelegram_('Your consent choice could not be saved. Please try again.',chatId); return; }
    if(!appendConsentHistory_(participant.id,setup.version,'CONFIRMED',decision)){ sendTelegram_('Your consent provenance could not be saved. Please try again.',chatId); return; }
    if(decision==='DECLINED'){ advanceSetup_(participant,setup,SETUP_STEP.DECLINED,'CONSENT_DECLINED','DECLINED',{}); sendTelegram_('No problem. You are not enrolled. You can use /start later to review consent again, or /delete-data to erase this setup record.',chatId); return; }
    advanceSetup_(participant,setup,SETUP_STEP.TIMEZONE,'CONSENT_GRANTED','ACTIVE',{mode:'START_SESSION'}); showTimezoneSelect_(participant,chatId,setup.version); return;
  }
  if(action==='TIMEZONE_SET' || action==='TIMEZONE_SKIP') {
    if(!setupCallbackIsCurrent_(participant,setupVersion,SETUP_STEP.TIMEZONE)){ sendTelegram_('That timezone action is no longer active. Use /start or /timezone to continue from the current step.',chatId); return; }
    if(action==='TIMEZONE_SKIP'){ sendTelegram_('A timezone is required before day-based calibration can start. Enter a valid IANA timezone; there is no default.',chatId); showTimezoneSelect_(participant,chatId,setupVersion); return; }
    const choice=COMMON_TIMEZONE_CHOICES[Number(parts[2])]; if(!choice){ showTimezoneSelect_(participant,chatId,setupVersion); return; }
    finishTimezoneSetup_(participant,currentSetup_(participant.id),choice.zone,chatId,'common_choice'); return;
  }
  if(action==='DC_DELETE_CONFIRM' || action==='DC_DELETE_CANCEL') {
    const requestTag=String(parts[1]||'');
    handleDeletionConfirmation_(participant.id,requestTag,action==='DC_DELETE_CONFIRM',chatId);
    return;
  }
  if (participant.consentStatus !== 'CONSENTED') { showCurrentSetup_(participant,chatId); return; }
  const session = getCurrentSession_(participant.id);
  if (!session) { sendTelegram_('That\'s not active anymore. Use /start to begin a new calibration, or /review to review your focal Signal.', chatId); return; }
  const version=Number(parts[1]), sessionTag=String(parts[2]||'');
  if (!sessionTag || sessionTag!==sessionCallbackTag_(session.sessionId)) { sendTelegram_('That button belongs to a different or expired session. Here is your current step:',chatId); renderState_(session,chatId); return; }
  if (session.stateVersion !== version) { sendTelegram_('That button is from an earlier step. Here is your current step:', chatId); const sent=renderState_(session,chatId); if(sent===false) log_('RENDER_SEND_FAILED',{sessionId:session.sessionId,state:session.state,participantId:session.participantId}); return; }
  handleAction_(session, action, chatId);
}

// F29 (Section C fix pack, F-C6): shown once, immediately after CONSENT_YES,
// before the first session is created — a standalone step outside the STATES
// machine, deliberately mirroring how CONSENT_YES/CONSENT_NO are already
// handled outside it (see the file's own precedent immediately above). Not
// re-shown on subsequent /start invocations; a participant who skips or
// mis-picks is not blocked from using the bot (falls back to
// NO_DEFAULT_PROJECT_TIMEZONE) and there is no /timezone command to revisit
// this choice later in this fix — that would be a separate, larger feature
// (matching how /later's own "bring back" mechanism was deliberately
// deferred in an earlier fix pack round) and is out of scope here.
// P06: global IANA timezone setup/correction helpers are defined with the setup-provenance functions above.

// F43 CHANGE-CONTROL — showConsent_ sign-off (Round 5, FIX-2, closes Round 4
// OPEN-2). Date: 2026-08-18. Approved by: project owner (via this fix-pack
// run), confirming the text as it stood after F27/F-D5/F-D6. What was
// changing: nothing in the string itself — this is a status change only,
// from DRAFT to SHIPPED. Why the prior status was insufficient: an
// unresolved DRAFT/sign-off flag on the only consent-facing message in the
// bot blocked any real participant from validly consenting, which blocked
// all real usability testing per the master doc's next-step sequencing.
// Evidence motivating the change: explicit owner approval of the text shown
// below, unmodified since F-D6. Downstream components affected: none beyond
// this comment block — showConsent_'s actual sendTelegram_ call and string
// are unchanged by this note. Retesting required: no — this is a status/sign-
// off change, not a content or logic change; F27/F-D5/F-D6's original
// "Retested: YES" claims for the string's rendering still hold.
//
// Historical drafting record (Round 3.1 through F-D6, retained for context):
// the string below replaced "answers, session state" with more specific
// terms ("typed answers", "activity log") so a participant can see what's
// actually stored without adding jargon or length; it does not change what's
// collected, only what's disclosed. F27 added disclosure of the raw
// Telegram user identifier and the internal deduplication log (audit
// finding C5-1). F-D5/F-D6 added disclosure of Apps Script execution logs
// as a data location distinct from the Sheets tables, and distinguished
// "kept until you delete it" (true for the five content-bearing tables)
// from the internal deduplication log's 48-hour auto-prune specifically.
// All of the above are disclosure-only edits; none changed what is
// collected. Consent copy changes may still need IRB sign-off depending on
// the study's own approval status outside this codebase — that is a
// separate, external process this change-control note does not speak to.
//
// F60 CHANGE-CONTROL — accessibility rewrite of the consent string
// (Accessibility fix, Phase 1). Date: 2026-08-19.
// (1) WHAT CHANGED: the consent message is rewritten from one long
// multi-clause paragraph into a sequence of short sentences, one
// disclosure fact per sentence, in the same order the prior version
// disclosed them (so nothing moved relative to what a re-reader of the
// prior F43-approved text would expect). Every technical/precision term
// from the prior string is retained verbatim ("chat ID," "Telegram user
// identifier," "typed answers," "session progress," "activity log,"
// "focal Signal history," "internal deduplication log," "aggregate,"
// "non-identifying fingerprint," "technical system logs") — none were cut.
// Each is now paired with a short plain-language gloss in the SAME
// sentence, following this file's own established inline-gloss precedent
// (GATE_TYPE defines each of its 8 terms in-message rather than assuming
// they're understood; F-F1a did the same for "Signal" at CANDIDATE). No
// item present in the prior 15-item disclosure inventory (traced by
// re-reading the prior string clause-by-clause before drafting: chat ID;
// raw Telegram user ID; typed answers; session progress; activity log;
// focal Signal history; internal deduplication log; storage location
// (Google Sheets); personal-use-only / not shared / not aggregated / no
// other use; technical-log exposure of chat ID, user ID, and content
// fingerprint; retention-until-deletion for the five content tables;
// 48-hour auto-clear for the dedup log; /delete-data; /export-data; the
// consent question itself) was dropped, vaguened, or merged away — this
// was verified against the OLD string's own clause list line-by-line
// before this note was written, not assumed from memory.
// (2) WHY THE PRIOR VERSION WAS INSUFFICIENT: F-F3a (2026-08-17) already
// identified this as the longest, highest-stakes string in the file and
// added bolding to solve *scanability* for a skimming reader. It did not
// address *comprehension* for a reader working through the text
// word-by-word rather than skimming — a single ~120-word sentence packing
// four distinct storage locations and three distinct retention rules into
// one clause chain is a different failure mode than "the important fact
// isn't visually prominent," which is what F-F3a fixed. Per this
// project's Phase 0 decisions record (master spec, dated 2026-08-19),
// IELTS 5.0-5.5 remains an unvalidated working assumption for this
// participant pool, and this rewrite is deliberately written in plain,
// high-frequency vocabulary rather than precision-tuned to that exact
// band, so it degrades gracefully if that assumption is later found wrong
// in either direction.
// (3) EVIDENCE MOTIVATING THE CHANGE: Phase 0 decisions record (master
// spec) plus direct re-reading of the pre-F60 string against this file's
// own established inline-gloss precedent (GATE_TYPE, F-F1a). No new
// participant/usability data — this is a design-standard extension, not
// an empirical finding, consistent with how F-F1a/F-F1b/F-F2a/F-F2b/F-F2c
// were themselves justified without participant data.
// (4) DOWNSTREAM COMPONENTS AFFECTED: showConsent_'s sendTelegram_ call
// only. No button IDs, callback_data values, consent logic, or stored
// fields touched — CONSENT_YES/CONSENT_NO remain exactly as before, and
// handleCallback_'s consent-gate invariants (documented at that
// function's own F-D2/D3 note) are untouched by a string-only change.
// Per the Phase 0 decisions record, NO comprehension-check/paraphrase-back
// step is added before CONSENT_YES — that was an explicit default-under-
// absence-of-governing-process, not implemented here.
// (5) RETESTING REQUIRED: yes, string-rendering and full-flow retest — see
// the retest note immediately after this function for the result.
//
// F-F3a's bolding precedent (retention/deletion fact, /delete-data,
// /export-data) is preserved exactly — now landing on their own dedicated
// sentences rather than mid-paragraph, which if anything strengthens the
// original scanability intent rather than working against it.
// PE06 re-evaluates F-F3b's split-into-two-messages decision because the
// retained lifetime-eligibility marker is a materially new disclosure item.
// The message remains one Telegram message: the revised text is still below
// Telegram's message-length limit and splitting would add a second push/boundary
// without changing the facts a participant must read before consenting.
function showConsent_(chatId, setupVersion) {
  // F-F3b CHANGE NOTE (Section F fix pack, F-F3b, evaluates but does NOT implement
  // a change): considered splitting this into a "what we store" message followed
  // by a "your rights + do you consent?" message, per the fix pack's instruction to
  // evaluate this as a genuine option. Decided against it: the consent buttons
  // currently sit at the end of one long paragraph, so a user must read through
  // the full disclosure to reach them either way — splitting into two messages
  // doesn't shorten what has to be read before consenting, it only adds a message
  // boundary and a second Telegram push notification, which could plausibly make
  // the flow feel more fragmented on mobile, not less. F-F3a's bolding directly
  // below already solves the actual scanability problem this finding raised
  // (surfacing the two facts — retention/deletion and the self-service commands —
  // that a skimming user is most likely searching for) without the added
  // complexity of a two-message consent sequence. If a future revision adds
  // materially more disclosure text to this message, re-evaluate the split
  // decision against the new length, since the calculus here depends on the
  // message staying roughly its current size. Date: 2026-08-17.
  // F-F3a CHANGE NOTE (Section F fix pack, F-F3a, fixes audit finding F3-1, MAJOR):
  // this was the longest single string in the file and the highest-stakes one
  // (informed consent), yet used no <b> bold anywhere, unlike READY/GATE_COMMITMENT/
  // PRESERVE which all bold the one fact a skimming user most needs. Bolded the
  // retention/deletion fact and both self-service commands (/delete-data,
  // /export-data) — the terms a privacy-conscious user scanning quickly is most
  // likely searching for. Deliberately left the itemized data-stored list unbolded:
  // it's necessary disclosure but not what a skimming user is scanning for, and
  // bolding everything would defeat the purpose of highlighting. String-only
  // change; no consent logic, button IDs, or stored fields affected. Considered
  // splitting this into two shorter messages (F-F3b) but kept as one bolded
  // message — see F-F3b's note for why. Date: 2026-08-17.
  // F60 (see full change-control note above showConsent_): rewritten to one
  // disclosure fact per sentence, each technical term kept and glossed
  // inline in the same sentence rather than cut or replaced.
  sendTelegram_('Before you choose: participation is voluntary. You can decline now or stop later.\n\n<b>What this bot stores</b>\n• Your Telegram chat ID and your Telegram user ID are stored as two separate identifiers.\n• The bot stores the exact words you type, your session progress, activity/event history, the history of the focal Signal you selected, links between each morning calibration and its review, any optional learning record you state, any optional adjustment plan you create or revise, and technical duplicate/update-processing records.\n• Participant and calibration records are stored in Google Sheets. Separately, the bot keeps a current channel-membership cache in Google Apps Script properties; that cache is deletable.\n• Backend technical logs may contain your chat/user IDs and, rarely when an error occurs, a short fingerprint of typed text — not the raw typed answer.\n\n<b>Retention and deletion</b>\nParticipant/research records stay until you delete them under this contract. A separate deduplication log, used to avoid processing the same update twice, clears automatically after 48 hours. /delete-data removes participant/research records and the current membership cache under the deletion contract.\n\n<b>Limited governance records remain after deletion</b>\nAfter you successfully complete enrollment and later use /delete-data, the bot retains limited pseudonymous governance/control evidence: the participation-eligibility marker used to stop automatic first-time/repeat enrollment; deletion-audit evidence used to confirm/reconcile deletion and reject replay of the deleted update; and, if applicable, repeat-participation request/grant records under their access-control lifecycle. These retained records contain no Telegram ID, no Signal Calibration answers, and no deleted research records, and they are not Signal Calibration outcomes or research measures. Another independent participation requires owner authorization.\n\n<b>If you request repeat participation</b>\nThe bot may create an owner-visible access-control request. The owner-visible text contains only a pseudonymous reference and participation generation. Signed Telegram button-routing metadata may contain a compact target-account identifier only so the bot can route the owner\'s action to the right account. This routing identifier is not shown as participant information, not stored in the request record, and not logged. Your Signal Calibration answers and deleted research records are not sent to the owner through this repeat-participation access-control process. Re-entry request/grant information is access/governance data, not a Signal Calibration research outcome.\n\n<b>Export</b>\nParticipant export is not supported. /export-data only reports that status; it does not create or share an export file.', chatId);
  showConsentComprehension_(chatId, setupVersion);
}

// F60 RETEST NOTE (Accessibility fix, Phase 1). Date: 2026-08-19.
// Verified by trace, not just re-reading the diff:
// (a) Clause-by-clause comparison of the OLD string's 15-item disclosure
//     inventory (listed in the change-control note above) against the NEW
//     string confirms every item is present, none merged into another,
//     none silently dropped. The two items most at risk of accidental
//     merging — "session progress" and "activity log," which sound similar
//     — were checked specifically and remain distinct sentences with
//     distinct glosses ("which step of the form you are on" vs. "a record
//     of when each step happened").
// (b) Both button callback_data values (CONSENT_YES|0, CONSENT_NO|0) are
//     byte-identical to the pre-F60 call — confirmed by diff of the
//     button_() calls, unchanged by this fix.
// (c) Full consent -> timezone -> READY path retraced against
//     handleCallback_'s CONSENT_YES branch (unchanged), showTimezoneSelect_
//     (unchanged), and createSession_(participant.id, STATES.READY,
//     'CONSENT_GRANTED', chatId) (unchanged) — none of these read the
//     consent string itself, so none could be affected by a string-only
//     change, and this was confirmed by re-reading their bodies rather than
//     assumed from the fact that they're "downstream."
// (d) CONSENT_NO path (updateParticipantConsent_(participant, 'DECLINED'),
//     then the existing "No problem..." message) is also untouched — same
//     reasoning as (c).
// RESULT: PASS. No control-flow, button ID, or stored-field regression;
// full disclosure-item parity confirmed against the prior F43-approved
// text.


const SCB_REVIEW_CONTROL_VERSION = 'SCB_REVIEW_CONTROL_V1';
const REVIEW_PAUSE_RECONCILIATION = Object.freeze({NONE:'NONE',REQUIRED:'REQUIRED'});
const REVIEW_SAFETY_KIND = Object.freeze({ACUTE:'ACUTE',RECOVERY:'RECOVERY'});

function isSubstantiveReviewState_(state) {
  const value=String(state||'');
  return isReviewState_(value) && value!==STATES.REVIEW_PAUSED;
}
function reviewSafetyKindForResolutionState_(resolutionState) {
  if(resolutionState===STATES.ACUTE_EXIT||resolutionState===STATES.ACUTE) return REVIEW_SAFETY_KIND.ACUTE;
  if(resolutionState===STATES.RECOVERY_EXIT||resolutionState===STATES.RECOVERY) return REVIEW_SAFETY_KIND.RECOVERY;
  return '';
}
function reviewSafetyOperationId_(session,kind) {
  // A Review-safety contact is accepted only inside a durable Telegram operation.
  // Never manufacture an identity from mutable Review state: distinct contacts must
  // be distinguishable by their actual accepted-update operation identity.
  return String(operationId_()||'');
}
function cloneReviewPauseHistory_(payload) {
  return Array.isArray(payload&&payload.review_pause_history) ? payload.review_pause_history.map(function(x){return Object.assign({},x||{});}) : [];
}
function findCalibrationCycleByReviewSessionReadOnly_(sessionId) {
  try {
    const sheet=getSpreadsheet_().getSheetByName('CalibrationCycles');
    if(!sheet) return null;
    const rows=storageReadRows_(sheet), matches=[];
    for(let i=0;i<rows.length;i++) if(String(rows[i][COLS.CALIBRATION_CYCLES.REVIEW_SESSION_ID])===String(sessionId)) matches.push({row:rows[i],rowNumber:rowNumber_(i)});
    return matches.length===1?matches[0]:null;
  } catch(e) { return null; }
}
function reviewCycleLinkage_(session) {
  if(!session) return {ok:false,reason:'SESSION_ABSENT'};
  const p=session.payload||{};
  const cycle=findCalibrationCycleByReviewSessionReadOnly_(session.sessionId);
  if(!cycle) return {ok:false,reason:'CYCLE_ABSENT'};
  const cycleId=String(cycle.row[COLS.CALIBRATION_CYCLES.CYCLE_ID]||'');
  const morningId=String(cycle.row[COLS.CALIBRATION_CYCLES.MORNING_SESSION_ID]||'');
  const reviewId=String(cycle.row[COLS.CALIBRATION_CYCLES.REVIEW_SESSION_ID]||'');
  if(!cycleId||!morningId||reviewId!==String(session.sessionId)) return {ok:false,reason:'CYCLE_LINKAGE_INVALID'};
  if(String(p.calibration_cycle_id||'')!==cycleId || String(p.morning_session_id||'')!==morningId) return {ok:false,reason:'PAYLOAD_LINKAGE_DISAGREEMENT'};
  return {ok:true,cycle:cycle,cycleId:cycleId,morningId:morningId};
}
function validateReviewPauseControl_(session) {
  if(!session || session.state!==STATES.REVIEW_PAUSED) return {ok:false,reason:'NOT_REVIEW_PAUSED'};
  const p=session.payload||{};
  if(String(p.review_control_version||'')!==SCB_REVIEW_CONTROL_VERSION) return {ok:false,reason:'CONTROL_VERSION_INVALID'};
  const returnState=String(p.review_pause_return_state||'');
  if(!isSubstantiveReviewState_(returnState) || returnState===STATES.COMPLETE) return {ok:false,reason:'RETURN_STATE_INVALID'};
  const returnVersion=Number(p.review_pause_return_version);
  if(!Number.isFinite(returnVersion)||returnVersion<1||returnVersion>=Number(session.stateVersion)) return {ok:false,reason:'RETURN_VERSION_INVALID'};
  if(!(p.review_pause_reconciliation===REVIEW_PAUSE_RECONCILIATION.NONE||p.review_pause_reconciliation===REVIEW_PAUSE_RECONCILIATION.REQUIRED)) return {ok:false,reason:'RECONCILIATION_INVALID'};
  const history=cloneReviewPauseHistory_(p);
  if(!history.length) return {ok:false,reason:'PAUSE_HISTORY_MISSING'};
  for(let i=0;i<history.length;i++) {
    const h=history[i]||{};
    if(!String(h.operation_id||'')) return {ok:false,reason:'PAUSE_OPERATION_ID_MISSING'};
    if(h.kind!==REVIEW_SAFETY_KIND.ACUTE&&h.kind!==REVIEW_SAFETY_KIND.RECOVERY) return {ok:false,reason:'PAUSE_KIND_INVALID'};
    if(['PENDING','APPLIED','FAILED_RETRYABLE'].indexOf(String(h.effect_status||''))<0) return {ok:false,reason:'PAUSE_EFFECT_STATUS_INVALID'};
    if(['LIVE_REVIEW_INTERRUPTION','REPEATED_SAFETY','PARENT_STRANDED_RECOVERY'].indexOf(String(h.origin||''))<0) return {ok:false,reason:'PAUSE_ORIGIN_INVALID'};
  }
  const linkage=reviewCycleLinkage_(session); if(!linkage.ok) return linkage;
  const actives=getActiveSessions_(session.participantId).filter(function(x){return isReviewState_(x.state);});
  if(actives.length!==1||String(actives[0].sessionId)!==String(session.sessionId)) return {ok:false,reason:'COMPETING_ACTIVE_REVIEW'};
  return {ok:true,returnState:returnState,returnVersion:returnVersion,history:history,linkage:linkage};
}
function parseEventDetailsReadOnly_(value) { try{return value?JSON.parse(value):{};}catch(e){return null;} }
function reviewReconciliationLatchStatus_(participantId,sessionId) {
  try {
    const sheet=getSpreadsheet_().getSheetByName('Events');
    if(!sheet) return {ok:true,required:false};
    const rows=storageReadRows_(sheet); let required=false;
    for(let i=0;i<rows.length;i++) {
      const r=rows[i];
      if(String(r[COLS.EVENTS.PARTICIPANT_ID])!==String(participantId)||String(r[COLS.EVENTS.SESSION_ID])!==String(sessionId)) continue;
      const type=String(r[COLS.EVENTS.EVENT_TYPE]||'');
      if(type==='REVIEW_SAFETY_RECONCILIATION_REQUIRED') required=true;
      if(type==='REVIEW_SAFETY_RECONCILED') required=false;
    }
    return {ok:true,required:required};
  } catch(e) { return {ok:false,required:true}; }
}
function appendReviewReconciliationLatch_(session,kind,operationId,reason) {
  try { appendEvent_(session.participantId,session.sessionId,'REVIEW_SAFETY_RECONCILIATION_REQUIRED',{kind:String(kind||''),operationId:String(operationId||''),reason:String(reason||'')}); return true; }
  catch(e) { return false; }
}
function clearReviewReconciliationLatch_(session,kind,operationId) {
  try {
    const status=reviewReconciliationLatchStatus_(session.participantId,session.sessionId);
    if(status.ok&&!status.required) return true;
    appendEvent_(session.participantId,session.sessionId,'REVIEW_SAFETY_RECONCILED',{kind:String(kind||''),operationId:String(operationId||'')}); return true;
  } catch(e) { return false; }
}
function reviewAnswerBlocked_(session) {
  if(!session||!isReviewState_(session.state)) return false;
  if(session.state===STATES.REVIEW_PAUSED) return true;
  const p=session.payload||{};
  if(p.review_resume_pending===true) return true;
  if(p.review_pause_reconciliation===REVIEW_PAUSE_RECONCILIATION.REQUIRED) return true;
  const latch=reviewReconciliationLatchStatus_(session.participantId,session.sessionId);
  return !latch.ok||latch.required;
}
function writeReviewStateNoRender_(session,newState,payload,artifactType) {
  if(!verifyRowIdentity_(getSessionsSheet_(),session.rowNumber,COLS.SESSIONS.SESSION_ID,session.sessionId,'writeReviewStateNoRender_')) return false;
  const now=now_(), nextPayload=payload||session.payload||{};
  storageSetValues_(getSessionsSheet_(),session.rowNumber,COLS.SESSIONS.STATE+1,[[newState,Number(session.stateVersion)+1,session.startedAt,now,'',ACTIVE_STATUS,JSON.stringify(nextPayload)]],artifactType||'review_control_transition');
  appendEvent_(session.participantId,session.sessionId,'STATE_TRANSITION',{from:session.state,to:newState,reviewControl:true});
  return Object.assign({},session,{state:newState,stateVersion:Number(session.stateVersion)+1,updatedAt:now,completedAt:'',activityStatus:ACTIVE_STATUS,payload:nextPayload});
}
function writeReviewPayloadNoTransition_(session,payload,artifactType) {
  if(!verifyRowIdentity_(getSessionsSheet_(),session.rowNumber,COLS.SESSIONS.SESSION_ID,session.sessionId,'writeReviewPayloadNoTransition_')) return false;
  const now=now_(), activity=String(session.activityStatus||ACTIVE_STATUS), completed=session.completedAt||'';
  storageSetValues_(getSessionsSheet_(),session.rowNumber,COLS.SESSIONS.UPDATED_AT+1,[[now,completed,activity,JSON.stringify(payload||{})]],artifactType||'review_control_payload');
  return Object.assign({},session,{updatedAt:now,payload:payload||{}});
}
function applyReviewSafetyEffect_(participantId,kind) {
  if(kind===REVIEW_SAFETY_KIND.ACUTE){suspendActiveInterventionsForSafety_(participantId,'ACUTE_CRISIS_PROTOCOL_STATE');safetyExitTransferMode_(participantId);return true;}
  if(kind===REVIEW_SAFETY_KIND.RECOVERY){recordRecoveryProtectedState_(participantId);return true;}
  return false;
}
function sendReviewSafetyGuidance_(kind,chatId,preserved) {
  if(scbSafetyAlreadyReplied_) return true;
  if(kind===REVIEW_SAFETY_KIND.ACUTE) return sendTelegram_(preserved?'Get help now if you need it. Your current review is preserved and will not accept review answers until you resume with /review.':'Get help now if you need it. No further reply is required.',chatId);
  return sendTelegram_(preserved?'Rest now. Your current review is preserved and will not accept review answers until you resume with /review.':'Rest now. No further reply is required.',chatId);
}
function pauseReviewForSafety_(session,kind,chatId) {
  if(!session||!isReviewState_(session.state)) return null;
  const opId=reviewSafetyOperationId_(session,kind);
  if(!opId){
    // Missing accepted-update identity makes repeated-contact provenance ambiguous.
    // Preserve the Review, apply reachable safety semantics, and fail closed for
    // measured Review answers until a bounded reconciliation record can resolve it.
    appendReviewReconciliationLatch_(session,kind,'','OPERATION_ID_UNAVAILABLE');
    try{applyReviewSafetyEffect_(session.participantId,kind);}catch(e){}
    sendReviewSafetyGuidance_(kind,chatId,true);
    return session;
  }
  if(session.state===STATES.REVIEW_PAUSED) {
    const valid=validateReviewPauseControl_(session);
    if(!valid.ok){ try{applyReviewSafetyEffect_(session.participantId,kind);}catch(e){} appendReviewReconciliationLatch_(session,kind,opId,'INVALID_PAUSE_METADATA:'+valid.reason); sendReviewSafetyGuidance_(kind,chatId,true); return session; }
    let history=valid.history, existing=history.find(function(h){return String(h.operation_id)===opId;});
    const alreadyAppliedSameKind=history.some(function(h){return h.kind===kind&&h.effect_status==='APPLIED';});
    if(!existing){existing={operation_id:opId,kind:kind,requested_at:now_(),effect_status:alreadyAppliedSameKind?'APPLIED':'PENDING',origin:'REPEATED_SAFETY'};history.push(existing);}
    let payload=Object.assign({},session.payload,{review_pause_history:history,review_pause_reconciliation:REVIEW_PAUSE_RECONCILIATION.REQUIRED});
    let written;
    try{written=writeReviewPayloadNoTransition_(session,payload,'review_pause_repeat_pending');}catch(e){written=false;}
    if(!written){appendReviewReconciliationLatch_(session,kind,opId,'REPEAT_PENDING_WRITE_FAILED');sendReviewSafetyGuidance_(kind,chatId,true);return session;}
    session=written;
    if(existing.effect_status!=='APPLIED'){
      try{applyReviewSafetyEffect_(session.participantId,kind);existing.effect_status='APPLIED';}
      catch(e){existing.effect_status='FAILED_RETRYABLE';existing.failure_code='SAFETY_EFFECT_FAILED';}
    }
    payload=Object.assign({},session.payload,{review_pause_history:history,review_pause_reconciliation:existing.effect_status==='APPLIED'?REVIEW_PAUSE_RECONCILIATION.NONE:REVIEW_PAUSE_RECONCILIATION.REQUIRED});
    try{session=writeReviewPayloadNoTransition_(session,payload,'review_pause_repeat_result')||session;}catch(e){appendReviewReconciliationLatch_(session,kind,opId,'REPEAT_RESULT_WRITE_FAILED');}
    if(existing.effect_status==='APPLIED') clearReviewReconciliationLatch_(session,kind,opId);
    sendReviewSafetyGuidance_(kind,chatId,true); return session;
  }
  if(!isSubstantiveReviewState_(session.state)) return null;
  const linkage=reviewCycleLinkage_(session);
  if(!linkage.ok){appendReviewReconciliationLatch_(session,kind,opId,'PRE_PAUSE_LINKAGE_INVALID:'+linkage.reason);try{applyReviewSafetyEffect_(session.participantId,kind);}catch(e){}sendReviewSafetyGuidance_(kind,chatId,true);return session;}
  const history=cloneReviewPauseHistory_(session.payload);
  history.push({operation_id:opId,kind:kind,requested_at:now_(),effect_status:'PENDING',origin:'LIVE_REVIEW_INTERRUPTION'});
  const payload=Object.assign({},session.payload,{review_control_version:SCB_REVIEW_CONTROL_VERSION,review_pause_return_state:session.state,review_pause_return_version:Number(session.stateVersion),review_pause_started_at:now_(),review_pause_history:history,review_pause_reconciliation:REVIEW_PAUSE_RECONCILIATION.REQUIRED,review_resume_pending:false});
  let paused;
  try{paused=writeReviewStateNoRender_(session,STATES.REVIEW_PAUSED,payload,'review_pause_begin');}catch(e){paused=false;}
  if(!paused){appendReviewReconciliationLatch_(session,kind,opId,'PAUSE_WRITE_FAILED');try{applyReviewSafetyEffect_(session.participantId,kind);}catch(e){}sendReviewSafetyGuidance_(kind,chatId,true);return session;}
  const validation=validateReviewPauseControl_(paused);
  if(!validation.ok){appendReviewReconciliationLatch_(paused,kind,opId,'PAUSE_READBACK_INVALID:'+validation.reason);sendReviewSafetyGuidance_(kind,chatId,true);return paused;}
  const entry=history[history.length-1];
  try{applyReviewSafetyEffect_(paused.participantId,kind);entry.effect_status='APPLIED';}
  catch(e){entry.effect_status='FAILED_RETRYABLE';entry.failure_code='SAFETY_EFFECT_FAILED';}
  const finalPayload=Object.assign({},paused.payload,{review_pause_history:history,review_pause_reconciliation:entry.effect_status==='APPLIED'?REVIEW_PAUSE_RECONCILIATION.NONE:REVIEW_PAUSE_RECONCILIATION.REQUIRED});
  try{paused=writeReviewPayloadNoTransition_(paused,finalPayload,'review_pause_result')||paused;}catch(e){appendReviewReconciliationLatch_(paused,kind,opId,'PAUSE_RESULT_WRITE_FAILED');}
  if(entry.effect_status==='APPLIED') clearReviewReconciliationLatch_(paused,kind,opId);
  sendReviewSafetyGuidance_(kind,chatId,true); return paused;
}
function findExactParentStrandedReviewCandidates_(participantId) {
  const sessionSheet=getSpreadsheet_().getSheetByName('Sessions'), eventSheet=getSpreadsheet_().getSheetByName('Events');
  if(!sessionSheet||!eventSheet) return [];
  const sessionRows=storageReadRows_(sessionSheet), eventRows=storageReadRows_(eventSheet), out=[];
  for(let i=0;i<sessionRows.length;i++){
    const r=sessionRows[i];
    if(String(r[COLS.SESSIONS.PARTICIPANT_ID])!==String(participantId)||String(r[COLS.SESSIONS.ACTIVITY_STATUS])!=='SUPERSEDED') continue;
    const state=String(r[COLS.SESSIONS.STATE]||''); if(!isSubstantiveReviewState_(state)) continue;
    const parsed=parseSessionPayloadReadOnly_(r[COLS.SESSIONS.PAYLOAD]); if(!parsed.ok) continue;
    const source=String((parsed.payload||{}).source_state||''); if(source!=='REVIEW_COMMAND'&&source!=='REVIEW_MINIMAL') continue;
    const sid=String(r[COLS.SESSIONS.SESSION_ID]||'');
    const interruptEvents=eventRows.filter(function(e){if(String(e[COLS.EVENTS.PARTICIPANT_ID])!==String(participantId)||String(e[COLS.EVENTS.SESSION_ID])!==sid||String(e[COLS.EVENTS.EVENT_TYPE])!=='SESSION_INTERRUPTED') return false;const d=parseEventDetailsReadOnly_(e[COLS.EVENTS.DETAILS]);return d&&String(d.reason||'')==='SUPERSEDED';});
    if(interruptEvents.length!==1) continue;
    const corr=String(interruptEvents[0][COLS.EVENTS.CORRELATION_ID]||''); if(!corr) continue;
    const created=eventRows.filter(function(e){if(String(e[COLS.EVENTS.PARTICIPANT_ID])!==String(participantId)||String(e[COLS.EVENTS.CORRELATION_ID]||'')!==corr||String(e[COLS.EVENTS.EVENT_TYPE])!=='SESSION_CREATED') return false;const d=parseEventDetailsReadOnly_(e[COLS.EVENTS.DETAILS]);return d&&String(d.sourceState||'')==='STANDALONE_COMMAND';});
    if(created.length!==1) continue;
    const safetySid=String(created[0][COLS.EVENTS.SESSION_ID]||'');
    const safetyRow=sessionRows.find(function(x){return String(x[COLS.SESSIONS.SESSION_ID])===safetySid;}); if(!safetyRow) continue;
    const safetyState=String(safetyRow[COLS.SESSIONS.STATE]||''), kind=(safetyState===STATES.ACUTE||safetyState===STATES.ACUTE_EXIT)?REVIEW_SAFETY_KIND.ACUTE:(safetyState===STATES.RECOVERY||safetyState===STATES.RECOVERY_EXIT)?REVIEW_SAFETY_KIND.RECOVERY:''; if(!kind) continue;
    const candidate={sessionId:sid,participantId:String(r[COLS.SESSIONS.PARTICIPANT_ID]),projectDay:r[COLS.SESSIONS.PROJECT_DAY],state:state,stateVersion:Number(r[COLS.SESSIONS.STATE_VERSION]),startedAt:r[COLS.SESSIONS.STARTED_AT],updatedAt:r[COLS.SESSIONS.UPDATED_AT],completedAt:r[COLS.SESSIONS.COMPLETED_AT],activityStatus:String(r[COLS.SESSIONS.ACTIVITY_STATUS]||''),rowNumber:rowNumber_(i),payload:parsed.payload,runRef:r[COLS.SESSIONS.RUN_REF]}; const linkage=reviewCycleLinkage_(candidate); if(!linkage.ok) continue;
    out.push({session:candidate,kind:kind,operationId:corr,linkage:linkage});
  }
  return out;
}
function resolveReviewContinuity_(participantId) {
  const active=getActiveSessions_(participantId);
  const reviews=active.filter(function(x){return isReviewState_(x.state)||(x.state===STATES.REENTRY_CHOICE&&isReviewState_(String((x.payload||{}).reentry_return_state||'')));});
  if(reviews.length>1) return {kind:'PARENT_STRANDED_REVIEW_AMBIGUOUS',reason:'MULTIPLE_ACTIVE_REVIEW_LINEAGES'};
  if(reviews.length===1){
    const r=reviews[0];
    if(r.state===STATES.REENTRY_CHOICE) return {kind:'LEGACY_REENTRY_REVIEW',session:r};
    if(r.state===STATES.REVIEW_PAUSED){const v=validateReviewPauseControl_(r);return v.ok?{kind:'PAUSED_REVIEW_VALID',session:r,validation:v}:{kind:'PAUSED_REVIEW_INVALID',session:r,reason:v.reason};}
    const link=reviewCycleLinkage_(r); return link.ok?{kind:'DIRECT_REVIEW',session:r,linkage:link}:{kind:'PARENT_STRANDED_REVIEW_AMBIGUOUS',session:r,reason:link.reason};
  }
  const stranded=findExactParentStrandedReviewCandidates_(participantId);
  if(stranded.length===1) return {kind:'PARENT_STRANDED_REVIEW_UNIQUE',session:stranded[0].session,stranded:stranded[0]};
  if(stranded.length>1) return {kind:'PARENT_STRANDED_REVIEW_AMBIGUOUS',reason:'MULTIPLE_STRANDED_REVIEW_CANDIDATES'};
  return {kind:'NONE'};
}
function reactivateExactParentStrandedReview_(continuity,chatId) {
  const session=continuity&&continuity.session, stranded=continuity&&continuity.stranded;
  if(!session||!stranded) return null;
  const history=cloneReviewPauseHistory_(session.payload);
  history.push({operation_id:String(stranded.operationId||''),kind:stranded.kind,requested_at:session.updatedAt||session.startedAt||now_(),effect_status:'APPLIED',origin:'PARENT_STRANDED_RECOVERY'});
  const payload=Object.assign({},session.payload,{review_control_version:SCB_REVIEW_CONTROL_VERSION,review_pause_history:history,review_pause_reconciliation:REVIEW_PAUSE_RECONCILIATION.NONE,review_resume_pending:true,review_stranded_recovered_at:now_()});
  let recovered;
  try{recovered=writeReviewStateNoRender_(session,session.state,payload,'review_parent_stranded_reactivate');}catch(e){recovered=false;}
  if(!recovered){sendTelegram_('I can see the earlier review, but I cannot safely restore it yet. No new review was created.',chatId);return null;}
  appendEvent_(session.participantId,session.sessionId,'PARENT_STRANDED_REVIEW_REACTIVATED',{sameReview:true,cycleId:String(stranded.linkage.cycleId),morningSessionId:String(stranded.linkage.morningId)});
  const sent=renderState_(recovered,chatId); if(sent===false) log_('REVIEW_RECOVERY_RENDER_FAILED',{sessionId:recovered.sessionId});
  return recovered;
}
function resumePausedReview_(session,chatId) {
  const valid=validateReviewPauseControl_(session);
  if(!valid.ok){sendTelegram_('I cannot safely resume this review yet because its recovery information is incomplete. Your existing review has been left unchanged.',chatId);return null;}
  if(session.payload.review_pause_reconciliation===REVIEW_PAUSE_RECONCILIATION.REQUIRED){sendTelegram_('This review is still reconciling a safety interruption and cannot safely resume yet.',chatId);return null;}
  const latch=reviewReconciliationLatchStatus_(session.participantId,session.sessionId); if(!latch.ok||latch.required){sendTelegram_('This review still has unresolved safety reconciliation and cannot accept review answers yet.',chatId);return null;}
  const payload=Object.assign({},session.payload,{review_resume_pending:true,review_resumed_at:now_()});
  let resumed;
  try{resumed=writeReviewStateNoRender_(session,valid.returnState,payload,'review_resume_same_session');}catch(e){resumed=false;}
  if(!resumed){sendTelegram_('The review could not be resumed safely. Your existing review was not replaced.',chatId);return null;}
  appendEvent_(session.participantId,session.sessionId,'REVIEW_RESUMED',{toState:valid.returnState,sameReview:true});
  const sent=renderState_(resumed,chatId); if(sent===false) log_('REVIEW_RESUME_RENDER_FAILED',{sessionId:resumed.sessionId,state:resumed.state});
  return resumed;
}
function recoverOrRenderReviewContinuity_(participant,chatId,continuity) {
  const c=continuity||resolveReviewContinuity_(participant.id);
  if(c.kind==='PAUSED_REVIEW_VALID') return resumePausedReview_(c.session,chatId);
  if(c.kind==='PAUSED_REVIEW_INVALID'||c.kind==='PARENT_STRANDED_REVIEW_AMBIGUOUS') {sendTelegram_('I found an existing review but cannot safely determine its exact recovery state. No new review was created and review answers remain blocked.',chatId);return null;}
  if(c.kind==='PARENT_STRANDED_REVIEW_UNIQUE') return reactivateExactParentStrandedReview_(c,chatId);
  if(c.kind==='DIRECT_REVIEW') {const sent=renderState_(c.session,chatId);if(sent===false)log_('REVIEW_RERENDER_FAILED',{sessionId:c.session.sessionId});return c.session;}
  if(c.kind==='LEGACY_REENTRY_REVIEW') {renderState_(c.session,chatId);return c.session;}
  if(c.kind==='COMPLETED_REVIEW') {sendTelegram_('That review is already complete. A duplicate review was not created.',chatId);return null;}
  return null;
}

function startStandaloneResolution_(participant, chatId, resolutionState) {
  if(isParticipantResearchStopped_(participant)) { sendTelegram_('No research session was created. If you need immediate support, seek help now; if you need recovery, rest now.',chatId); return null; }
  const kind=reviewSafetyKindForResolutionState_(resolutionState);
  if(kind){
    const continuity=resolveReviewContinuity_(participant.id);
    if(continuity.kind==='DIRECT_REVIEW'||continuity.kind==='PAUSED_REVIEW_VALID'||continuity.kind==='PAUSED_REVIEW_INVALID') return pauseReviewForSafety_(continuity.session,kind,chatId);
    if(continuity.kind==='PARENT_STRANDED_REVIEW_UNIQUE'||continuity.kind==='PARENT_STRANDED_REVIEW_AMBIGUOUS'){
      try{applyReviewSafetyEffect_(participant.id,kind);}catch(e){}
      sendReviewSafetyGuidance_(kind,chatId,true); return null;
    }
  }
  if(kind===REVIEW_SAFETY_KIND.ACUTE){suspendActiveInterventionsForSafety_(participant.id,'ACUTE_CRISIS_PROTOCOL_STATE');safetyExitTransferMode_(participant.id);}
  else if(kind===REVIEW_SAFETY_KIND.RECOVERY){recordRecoveryProtectedState_(participant.id);}
  let session=createSession_(participant.id,resolutionState,'STANDALONE_COMMAND',chatId);
  let payload=Object.assign({},session.payload||{});
  if(kind===REVIEW_SAFETY_KIND.ACUTE){payload=setDailyFocus_(payload,DAILY_FOCUS_STATE.ACUTE_EXIT,'Acute exit');payload.protocol_contact_kind='standalone_safety_contact';}
  else {payload=setDailyFocus_(payload,DAILY_FOCUS_STATE.PROTECTED_RECOVERY_HEALTH,'Recovery / Health');payload.protocol_contact_kind='standalone_protected_contact';}
  // transitionSession_ already renders the terminal state and sends the guidance once.
  // Do not render it a second time: that duplicated /acute and /recovery replies.
  session=transitionSession_(session,resolutionState,payload)||session; return session;
}

// F-B2 Part B: /gate now accepts an optional argument selecting which gate
// branch to exercise — "/gate two" (or "/gate 2") pre-sets candidate_path to
// 'two_competing' so finishCandidateGate_'s loop-back and GATE_COMPARE
// branches are reachable from this command, not just from the morning
// CANDIDATE_TWO path. Bare "/gate" or "/gate one" keeps the pre-existing
// single-candidate behavior as the default, so no muscle-memory /gate usage
// changes behavior unless the user opts into the two-candidate variant.
function startDecisionGateTest_(participant, rawText, chatId) {
  if(isParticipantResearchStopped_(participant)) { sendTelegram_('Participation is stopped. No test session was created.',chatId); return null; }
  const arg = String(rawText || '').trim().toLowerCase().split(/\s+/)[1] || '';
  const twoCandidate = arg === 'two' || arg === '2';
  const initialPayload = {
    candidate_path: twoCandidate ? 'two_competing' : 'one_candidate',
    gate_current_index: 0
  };
  const session = createSession_(participant.id, STATES.GATE_CANDIDATE, 'F2_GATE_TEST', chatId);
  const seeded = transitionSession_(session, STATES.GATE_CANDIDATE, Object.assign({}, session.payload, initialPayload));
  return seeded;
}

// F20 CHANGE-CONTROL (Section B fix pack, F-B8): this helper remains the
// same-state duplicate comparator used by the nine free-text branches. The
// later cross-state replay follow-up is separate and runs pre-dispatch in
// handleStateInput_: it compares the persisted normalized text and the
// stateVersion that accepted it, so a serialized repeat after state advance
// is rejected before the next state's handler executes. Keep these two
// mechanisms conceptually separate: this helper closes same-state repeats;
// the pre-dispatch marker closes the previously documented cross-state gap.
//
// F47 CHANGE NOTE (Round 5, Section G fix pack, fixes audit finding G3):
// (1) What's changing: comparison widened from raw post-trim exact-match to
// case-insensitive with runs of internal whitespace collapsed to a single
// space, via normalizeForDuplicateCompare_ below. Trailing punctuation is
// deliberately left significant (not stripped) — see (2).
// (2) Why insufficient: trim-only comparison let a trivially near-identical
// resubmission bypass suppression — re-typing with different capitalization
// ("Unclear..." vs "unclear...") or an extra internal space between two
// words both produced a string that compares unequal to the original despite
// being the same substantive answer, defeating F20's intent for exactly the
// accidental-retype case F20 was meant to catch (not just literal
// character-for-character resubmission). Confirmed by trace: G3 constructed
// both cases concretely against REVIEW_Q9. Punctuation is left alone because
// a punctuation change (e.g. added trailing period) is closer to the
// boundary of "did the user actually revise their answer," and collapsing
// it risks false-positive-suppressing a genuine edit — case and internal
// spacing carry no such signal.
// (3) Evidence: grep-confirmed all 9 call sites feed this function only
// String(input || '').trim() with no other normalization; live trace
// constructed the bypass strings above.
// (4) Downstream: all 9 existing call sites (REVIEW_Q1, REVIEW_Q5_NOTE,
// REVIEW_Q6_NOTE, REVIEW_Q9, REVIEW_Q10, GATE_CANDIDATE, GATE_CLAIM,
// GATE_SMALLER_ACTION, PRESERVE) inherit the wider match automatically, no
// call-site changes needed. Cross-state lock-serialized replay is handled
// independently by handleStateInput_'s normalized-text/stateVersion marker;
// widening this same-state comparator neither creates nor owns that guard.
// (5) Retesting: recommended — confirm (a) a case/internal-whitespace-only
// resubmission is now suppressed (re-renders current state, no duplicate
// other_claims push) across GATE_CANDIDATE specifically, since it's the one
// call site backed by an array push rather than a field patch and therefore
// the highest-impact instance of this gap; (b) a genuinely different answer
// (not just recased/respaced) still transitions normally, 9/9 states.
// F49 CORRECTION (Round 5, Section H fix pack, fixes audit finding H1): notes
// (3) and (4) above originally said "7 call sites" while listing all 9 states
// by name — the same off-by-two miscount H1 also found duplicated at
// createSession_'s call-site count (see F49's companion correction near
// createSession_ below). Corrected to 9 here, verified by grep of every
// isLikelyDuplicateFreeText_( invocation in this file (lines ~2193, 2199,
// 2205, 2211, 2217, 2226, 2233, 2241, 2268 in the pre-H1 file layout),
// matching the 9 states already named in the list. Comment-only; no
// retesting required — the underlying fix and its 9-state scope were already
// correct, only the digit was wrong.
function normalizeForDuplicateCompare_(value) {
  return String(value == null ? '' : value).trim().toLowerCase().replace(/\s+/g, ' ');
}
function isLikelyDuplicateFreeText_(previousValue, incomingText) {
  if (previousValue === null || previousValue === undefined) return false;
  const previous = normalizeForDuplicateCompare_(previousValue);
  if (!previous) return false;
  return previous === normalizeForDuplicateCompare_(incomingText);
}


// P11 run/stage/version/missingness/teaching/endpoint provenance.
// P11 terminology boundary: Layer 1 is scaffolded initial observation / pre-Layer-3 exposure, never an untreated baseline. Help/gloss delivery is technical exposure metadata only, never comprehension or learning.
// These are technical provenance controls. They do not create an efficacy score,
// participant-performance metric, or a new participant questionnaire.
const SCB_TEACHING_CONTENT_VERSION='SCB_TEACHING_V1';
const STUDY_STAGE=Object.freeze({DEVELOPMENT:'development',AUTOMATED_TEST:'automated_test',MANUAL_TEST:'manual_test',FORMATIVE:'formative',PILOT:'pilot',POST_PILOT:'post_pilot'});
const PARTICIPANT_ROLE=Object.freeze({DEVELOPMENT_TESTER:'development_tester',FORMATIVE_PARTICIPANT:'formative_participant',PILOT_PARTICIPANT:'pilot_participant',POST_PILOT_PARTICIPANT:'post_pilot_participant'});
const RUN_CLOSURE_STATUS=Object.freeze({ACTIVE:'ACTIVE',CLOSED:'CLOSED',EARLY_STOP_SAFETY:'EARLY_STOP_SAFETY',EARLY_STOP_WITHDRAWAL:'EARLY_STOP_WITHDRAWAL',EARLY_STOP_UNRECOVERABLE_TECHNICAL:'EARLY_STOP_UNRECOVERABLE_TECHNICAL'});
const WINDOW_STATUS=Object.freeze({ACTIVE:'ACTIVE',ENDED_21_CALENDAR_DAYS:'ENDED_21_CALENDAR_DAYS',EARLY_STOP:'EARLY_STOP'});
const MISSINGNESS_CAUSE=Object.freeze({
  NOT_ASKED_BRANCH:'not_asked_branch',NOT_APPLICABLE:'not_applicable',PARTICIPANT_DECLINED_OR_SKIPPED:'participant_declined_or_skipped',
  PARTICIPANT_UNSURE:'participant_unsure',PARTICIPANT_INTERRUPTED_OR_ABANDONED:'participant_interrupted_or_abandoned',
  SUPERSEDED_OR_CORRECTED:'superseded_or_corrected',WITHDRAWN:'withdrawn',DELETED:'deleted',
  TECHNICAL_PROCESSING_OR_WRITE_FAILURE:'technical_processing_or_write_failure',DELIVERY_UNVERIFIED_OR_FAILED:'delivery_unverified_or_failed',
  CORRUPT_OR_UNRECOVERABLE:'corrupt_or_unrecoverable',UNKNOWN_CAUSE:'unknown_cause'
});
const ACTIVE_STUDY_RUN_PROPERTY='SCB_ACTIVE_STUDY_RUN_ID';
function safeConfigFingerprint_(){
  const p=PropertiesService.getScriptProperties();
  // PE06/OT05 provenance: record only non-secret eligibility/owner-control
  // configuration state. The eligibility pepper value and raw owner Telegram
  // user ID are deliberately excluded from run metadata/logs.
  const ownerTelegramUserId=String(p.getProperty('OWNER_TELEGRAM_USER_ID')||'').trim();
  const ownerTelegramUserIdFingerprint=ownerTelegramUserId ? contentFingerprint_('scb-owner-config-v1|'+ownerTelegramUserId).fingerprint : '';
  const material=['WEB_APP_URL='+String(p.getProperty('WEB_APP_URL')||''),'BOT_TOKEN_PRESENT='+(p.getProperty('BOT_TOKEN')?'1':'0'),'WEBHOOK_SECRET_PRESENT='+(p.getProperty('WEBHOOK_SECRET')?'1':'0'),'TESTER_USER_IDS='+String(p.getProperty('TESTER_USER_IDS')||''),'REQUIRED_CHANNEL_USERNAME='+String(p.getProperty('REQUIRED_CHANNEL_USERNAME')||'').trim().toLowerCase(),'ACCESS_IDENTITY_PEPPER_PRESENT='+(p.getProperty('ACCESS_IDENTITY_PEPPER')?'1':'0'),'ACCESS_IDENTITY_PEPPER_VERSION='+String(p.getProperty('ACCESS_IDENTITY_PEPPER_VERSION')||'').trim(),'OWNER_TELEGRAM_USER_ID_PRESENT='+(ownerTelegramUserId?'1':'0'),'OWNER_TELEGRAM_USER_ID_FINGERPRINT='+ownerTelegramUserIdFingerprint].join('|');
  return contentFingerprint_(material).fingerprint;
}
function studyRunById_(runId){const rows=readRows_(getStudyRunsSheet_());for(let i=rows.length-1;i>=0;i--)if(String(rows[i][COLS.STUDY_RUNS.RUN_ID])===String(runId))return{row:rows[i],rowNumber:rowNumber_(i)};return null;}
function closeActiveStudyRunsForReplacement_(replacementRunId) {
  const sheet=getStudyRunsSheet_(), rows=readRows_(sheet), ended=now_();
  rows.forEach((row,index)=>{
    if(String(row[COLS.STUDY_RUNS.CLOSURE_STATUS])!==RUN_CLOSURE_STATUS.ACTIVE) return;
    if(replacementRunId && String(row[COLS.STUDY_RUNS.RUN_ID])===String(replacementRunId)) return;
    storageSetValues_(sheet,rowNumber_(index),COLS.STUDY_RUNS.ENDED_AT+1,[[ended,RUN_CLOSURE_STATUS.CLOSED,row[COLS.STUDY_RUNS.CREATED_AT]||ended]],'study_run_close_for_replacement');
  });
}
function expectedParticipantRoleForStudyStage_(stage){
  const map={};
  map[STUDY_STAGE.DEVELOPMENT]=PARTICIPANT_ROLE.DEVELOPMENT_TESTER;
  map[STUDY_STAGE.AUTOMATED_TEST]=PARTICIPANT_ROLE.DEVELOPMENT_TESTER;
  map[STUDY_STAGE.MANUAL_TEST]=PARTICIPANT_ROLE.DEVELOPMENT_TESTER;
  map[STUDY_STAGE.FORMATIVE]=PARTICIPANT_ROLE.FORMATIVE_PARTICIPANT;
  map[STUDY_STAGE.PILOT]=PARTICIPANT_ROLE.PILOT_PARTICIPANT;
  map[STUDY_STAGE.POST_PILOT]=PARTICIPANT_ROLE.POST_PILOT_PARTICIPANT;
  return map[String(stage||'')]||'';
}
function validateStudyStageRole_(stage,role){
  const s=String(stage||''), r=String(role||'');
  if(Object.values(STUDY_STAGE).indexOf(s)<0)throw new Error('INVALID_STUDY_STAGE');
  if(Object.values(PARTICIPANT_ROLE).indexOf(r)<0)throw new Error('INVALID_PARTICIPANT_ROLE');
  if(expectedParticipantRoleForStudyStage_(s)!==r)throw new Error('STUDY_STAGE_ROLE_MISMATCH');
  return true;
}
function createStudyRun_(cfg){
  cfg=cfg||{}; const stage=String(cfg.stage||STUDY_STAGE.DEVELOPMENT), role=String(cfg.defaultParticipantRole||PARTICIPANT_ROLE.DEVELOPMENT_TESTER); validateStudyStageRole_(stage,role);
  const runId=String(cfg.runId||Utilities.getUuid()); if(studyRunById_(runId))throw new Error('STUDY_RUN_ID_EXISTS');
  closeActiveStudyRunsForReplacement_(runId);
  const row=[runId,stage,String(cfg.cohort||'development'),role,SCB_BUILD_ID,String(cfg.sourceHash||'PROSPECTIVE_HASH_RECORDED_IN_RELEASE_MANIFEST'),String(cfg.deploymentRef||'UNDEPLOYED'),String(cfg.masterVersion||'PROJECT_SIGNAL_CALIBRATION_MASTER_POST_AUDIT_REPAIR_BASELINE'),String(cfg.protocolVersion||'SCB_PROTOCOL_R14'),String(cfg.formVersion||'SCB_FORM_V2'),String(cfg.interfaceVersion||'SCB_INTERFACE_V2'),SCB_STORAGE_SCHEMA_VERSION,SCB_STORAGE_MIGRATION_VERSION,safeConfigFingerprint_(),SCB_TEACHING_CONTENT_VERSION,String(cfg.operatorRosterRef||'P14_ASSIGNMENT_PENDING'),String(cfg.startedAt||now_()),'',RUN_CLOSURE_STATUS.ACTIVE,now_()];
  storageAppendRow_(getStudyRunsSheet_(),row,'study_run_create'); PropertiesService.getScriptProperties().setProperty(ACTIVE_STUDY_RUN_PROPERTY,runId); return studyRunById_(runId);
}
const OPERATOR_STUDY_RUN_PROPERTY='SCB_OPERATOR_STUDY_RUN_JSON';
function openConfiguredStudyRun(){
  const props=PropertiesService.getScriptProperties(), raw=String(props.getProperty(OPERATOR_STUDY_RUN_PROPERTY)||'').trim();
  if(!raw)throw new Error('SCB_OPERATOR_STUDY_RUN_JSON_REQUIRED');
  let cfg; try{cfg=JSON.parse(raw);}catch(e){throw new Error('SCB_OPERATOR_STUDY_RUN_JSON_INVALID');}
  if(!cfg||Array.isArray(cfg)||typeof cfg!=='object')throw new Error('SCB_OPERATOR_STUDY_RUN_JSON_INVALID');
  const stage=String(cfg.stage||''), role=String(cfg.defaultParticipantRole||''); validateStudyStageRole_(stage,role);
  const sourceHash=String(cfg.sourceHash||'').trim().toLowerCase(), deploymentRef=String(cfg.deploymentRef||'').trim(), roster=String(cfg.operatorRosterRef||'').trim();
  if(!/^[a-f0-9]{64}$/.test(sourceHash))throw new Error('SCB_OPERATOR_STUDY_SOURCE_HASH_REQUIRED');
  if(!deploymentRef||deploymentRef==='UNDEPLOYED')throw new Error('SCB_OPERATOR_STUDY_DEPLOYMENT_REF_REQUIRED');
  if(!roster||roster==='P14_ASSIGNMENT_PENDING')throw new Error('SCB_OPERATOR_STUDY_ROSTER_REQUIRED');
  const result=createStudyRun_(Object.assign({},cfg,{stage:stage,defaultParticipantRole:role,sourceHash:sourceHash,deploymentRef:deploymentRef,operatorRosterRef:roster}));
  props.deleteProperty(OPERATOR_STUDY_RUN_PROPERTY);
  log_('OPERATOR_STUDY_RUN_OPENED',{runId:String(result.row[COLS.STUDY_RUNS.RUN_ID]),stage:stage,participantRole:role});
  return result;
}
const P14_MANUAL_TEST_SOURCE_HASH_PROPERTY='P14_MANUAL_TEST_SOURCE_HASH';
const P14_MANUAL_TEST_DEPLOYMENT_REF_PROPERTY='P14_MANUAL_TEST_DEPLOYMENT_REF';
const P14_MANUAL_TEST_OPERATOR_ROSTER_REF_PROPERTY='P14_MANUAL_TEST_OPERATOR_ROSTER_REF';
const P14_MANUAL_TEST_COHORT_PROPERTY='P14_MANUAL_TEST_COHORT';
function openConfiguredManualTestRun(){
  const p=PropertiesService.getScriptProperties();
  const sourceHash=String(p.getProperty(P14_MANUAL_TEST_SOURCE_HASH_PROPERTY)||'').trim().toLowerCase();
  const deploymentRef=String(p.getProperty(P14_MANUAL_TEST_DEPLOYMENT_REF_PROPERTY)||'').trim();
  const operatorRosterRef=String(p.getProperty(P14_MANUAL_TEST_OPERATOR_ROSTER_REF_PROPERTY)||'').trim();
  const cohort=String(p.getProperty(P14_MANUAL_TEST_COHORT_PROPERTY)||'manual_test').trim()||'manual_test';
  if(!/^[a-f0-9]{64}$/.test(sourceHash)) throw new Error('P14_MANUAL_TEST_SOURCE_HASH_REQUIRED');
  if(!deploymentRef||deploymentRef==='UNDEPLOYED') throw new Error('P14_MANUAL_TEST_DEPLOYMENT_REF_REQUIRED');
  if(!operatorRosterRef||operatorRosterRef==='P14_ASSIGNMENT_PENDING') throw new Error('P14_MANUAL_TEST_OPERATOR_ROSTER_REF_REQUIRED');
  const activeId=String(p.getProperty(ACTIVE_STUDY_RUN_PROPERTY)||''), active=activeId?studyRunById_(activeId):null;
  if(active && String(active.row[COLS.STUDY_RUNS.CLOSURE_STATUS])===RUN_CLOSURE_STATUS.ACTIVE &&
     String(active.row[COLS.STUDY_RUNS.STAGE])===STUDY_STAGE.MANUAL_TEST &&
     String(active.row[COLS.STUDY_RUNS.BUILD_ID])===SCB_BUILD_ID &&
     String(active.row[COLS.STUDY_RUNS.SOURCE_HASH]).toLowerCase()===sourceHash &&
     String(active.row[COLS.STUDY_RUNS.DEPLOYMENT_REF])===deploymentRef &&
     String(active.row[COLS.STUDY_RUNS.OPERATOR_ROSTER_REF])===operatorRosterRef &&
     String(active.row[COLS.STUDY_RUNS.CONFIG_FINGERPRINT])===safeConfigFingerprint_()) return active;
  return createStudyRun_({stage:STUDY_STAGE.MANUAL_TEST,cohort:cohort,defaultParticipantRole:PARTICIPANT_ROLE.DEVELOPMENT_TESTER,sourceHash:sourceHash,deploymentRef:deploymentRef,operatorRosterRef:operatorRosterRef});
}
function activeStudyRun_(){const p=PropertiesService.getScriptProperties(),id=String(p.getProperty(ACTIVE_STUDY_RUN_PROPERTY)||''); if(id){const r=studyRunById_(id);if(r&&String(r.row[COLS.STUDY_RUNS.CLOSURE_STATUS])===RUN_CLOSURE_STATUS.ACTIVE)return r;}
  // Safe default only for development/test execution. Formative/pilot must be explicitly created and activated by the operator.
  return createStudyRun_({stage:STUDY_STAGE.DEVELOPMENT,cohort:'development',defaultParticipantRole:PARTICIPANT_ROLE.DEVELOPMENT_TESTER});
}
function activeRunRef_(){const r=activeStudyRun_();return r?String(r.row[COLS.STUDY_RUNS.RUN_ID]):'';}
function runStage_(runRef){const r=studyRunById_(runRef);return r?String(r.row[COLS.STUDY_RUNS.STAGE]):'';}
function participantRoleForRun_(runRef){const r=studyRunById_(runRef);return r?String(r.row[COLS.STUDY_RUNS.DEFAULT_PARTICIPANT_ROLE]):PARTICIPANT_ROLE.DEVELOPMENT_TESTER;}
function isValidMissingnessCause_(cause){return Object.values(MISSINGNESS_CAUSE).indexOf(String(cause))>=0;}
function setCycleMissingnessCause_(cycle,cause){if(!cycle||!isValidMissingnessCause_(cause))throw new Error('INVALID_MISSINGNESS_CAUSE');storageSetValue_(getCalibrationCyclesSheet_(),cycle.rowNumber,COLS.CALIBRATION_CYCLES.MISSINGNESS_CAUSE+1,String(cause),'cycle_missingness');cycle.row[COLS.CALIBRATION_CYCLES.MISSINGNESS_CAUSE]=String(cause);return true;}
function recordTeachingExposure_(participantId,sessionId,channel,deliveryStatus){storageAppendRow_(getTeachingExposureSheet_(),[Utilities.getUuid(),activeRunRef_(),String(participantId||''),String(sessionId||''),String(channel||''),SCB_TEACHING_CONTENT_VERSION,now_(),String(deliveryStatus||'UNVERIFIED'),operationId_()],'teaching_exposure');}
function sendTeachingContent_(participantId,sessionId,channel,text,chatId){const ok=sendTelegram_(text,chatId);recordTeachingExposure_(participantId,sessionId,channel,ok===false?'SEND_FAILED':'TELEGRAM_ACCEPTED');return ok;}
function dayNumberFromEnrollment_(enrolledDay,currentDay){return projectDayDistance_(enrolledDay,currentDay,'participant_window')+1;}
// R15: recover a missing enrollment anchor from the earliest trustworthy morning
// activity already persisted for the same participant/run. CalibrationCycles are
// preferred because they are the durable P10 lifecycle entity; each candidate cycle
// must still reconcile to its linked morning Session. If no cycle is available,
// fall back to an eligible morning Session. Ambiguous/malformed prior activity fails
// closed rather than silently resetting enrollment to the current day.
function recoverParticipantEnrollmentProjectDay_(participant,runRef){
  if(!participant) return '';
  const pid=String(participant.id||''), rr=String(runRef||'');
  if(!pid||!rr) return '';
  const sessionRows=readRows_(getSessionsSheet_()), sessionsById={};
  sessionRows.forEach((row,index)=>{
    if(String(row[COLS.SESSIONS.PARTICIPANT_ID])!==pid) return;
    if(String(row[COLS.SESSIONS.RUN_REF]||'')!==rr) return;
    const rec=sessionFromRow_(row,rowNumber_(index));
    rec.runRef=String(row[COLS.SESSIONS.RUN_REF]||'');
    sessionsById[String(rec.sessionId)]=rec;
  });
  const cycleDays=[];
  const cycleRows=readRows_(getCalibrationCyclesSheet_());
  cycleRows.forEach(row=>{
    if(String(row[COLS.CALIBRATION_CYCLES.PARTICIPANT_ID])!==pid) return;
    if(String(row[COLS.CALIBRATION_CYCLES.RUN_REF]||'')!==rr) return;
    const morningId=String(row[COLS.CALIBRATION_CYCLES.MORNING_SESSION_ID]||'');
    if(!morningId) throw new Error('ENROLLMENT_RECOVERY_CYCLE_MORNING_SESSION_REQUIRED');
    const linked=sessionsById[morningId];
    if(!linked) throw new Error('ENROLLMENT_RECOVERY_CYCLE_SESSION_MISSING');
    if(!isMorningSourceState_(String((linked.payload||{}).source_state||''))) throw new Error('ENROLLMENT_RECOVERY_NON_MORNING_SESSION');
    const cycleDay=canonicalProjectDayKeyOrThrow_(row[COLS.CALIBRATION_CYCLES.PROJECT_DAY],'participant_enrollment_recovery_cycle');
    const sessionDay=canonicalSessionProjectDay_(linked);
    if(!cycleDay||!sessionDay||cycleDay!==sessionDay) throw new Error('ENROLLMENT_RECOVERY_DAY_MISMATCH');
    cycleDays.push(cycleDay);
  });
  if(cycleDays.length){ cycleDays.sort(); return cycleDays[0]; }
  const sessionDays=[];
  Object.keys(sessionsById).forEach(id=>{
    const rec=sessionsById[id];
    if(!isMorningSourceState_(String((rec.payload||{}).source_state||''))) return;
    const day=canonicalSessionProjectDay_(rec);
    if(!day) throw new Error('ENROLLMENT_RECOVERY_SESSION_DAY_REQUIRED');
    sessionDays.push(day);
  });
  if(sessionDays.length){ sessionDays.sort(); return sessionDays[0]; }
  return '';
}
// PE03 — reconcile lifetime access-control state only after the existing
// Participants-sheet enrollment tuple has been durably written and read back.
// PE02's channelGateRecordEnrollment_() supports first enrollment and idempotent
// same-lineage ENROLLED confirmation; PE05 will extend the same API for a valid
// owner-authorized later-generation grant. No research Sheet field is added.
function reconcileParticipantEnrollmentEligibility_(participant) {
  if (!participant) throw new Error('PARTICIPANT_REQUIRED');
  const telegramUserId = participant.telegramUserId == null ? participant.id : participant.telegramUserId;
  const lock = currentHeldScriptLock_();
  if (typeof channelGateRecordEnrollment_ !== 'function' || typeof channelGateReadEligibility_ !== 'function') {
    throw new Error('CHANNEL_GATE_ENROLLMENT_API_UNAVAILABLE');
  }
  if (channelGateRecordEnrollment_(telegramUserId, lock) !== true) {
    throw new Error('PARTICIPANT_ELIGIBILITY_PERSISTENCE_FAILED');
  }
  const eligibility = channelGateReadEligibility_(telegramUserId, lock);
  if (!eligibility || eligibility.ok !== true || eligibility.exists !== true || eligibility.state !== 'ENROLLED' ||
      !Number.isInteger(Number(eligibility.generation)) || Number(eligibility.generation) < 1) {
    throw new Error('PARTICIPANT_ELIGIBILITY_VERIFICATION_FAILED');
  }
  participant.participationGeneration = Number(eligibility.generation);
  return eligibility;
}

function ensureParticipantRunEnrollment_(participant){
  if(!participant)return null;
  // PE03: lifetime enrollment may be created or legacy-reconciled only for a
  // consented participant. A stray/manual enrollment-day value on a setup-only
  // row is not sufficient evidence to lifetime-lock the Telegram account.
  if(String(participant.consentStatus||'')!=='CONSENTED') throw new Error('PARTICIPANT_ENROLLMENT_CONSENT_REQUIRED');
  const runRef=participant.runRef||activeRunRef_(),role=participant.participantRole||participantRoleForRun_(runRef);
  let enrolled=canonicalProjectDayKey_(participant.enrolledProjectDay), recovered=false;
  if(!enrolled){
    // Existing reliable enrollment evidence may still be recovered below for a
    // legacy/current consented participant and then idempotently seed lifetime eligibility.
    const raw=String(participant.enrolledProjectDay==null?'':participant.enrolledProjectDay).trim();
    if(raw) enrolled=canonicalProjectDayKeyOrThrow_(participant.enrolledProjectDay,'participant_enrollment');
    else{
      enrolled=recoverParticipantEnrollmentProjectDay_(participant,runRef);
      recovered=!!enrolled;
      if(!enrolled){
        const tz=getParticipantTimezone_(participant.id);
        if(tz) enrolled=canonicalProjectDayKeyOrThrow_(projectDay_(tz),'participant_enrollment_new');
      }
    }
  }
  if(!enrolled) throw new Error('PARTICIPANT_ENROLLMENT_PROJECT_DAY_REQUIRED');
  const windowStatus=participant.windowStatus||WINDOW_STATUS.ACTIVE;
  if(!verifyRowIdentity_(getParticipantsSheet_(),participant.rowNumber,COLS.PARTICIPANTS.ID,participant.id,'p11_participant_run'))throw new Error('PARTICIPANT_IDENTITY_MISMATCH');
  storageSetValues_(getParticipantsSheet_(),participant.rowNumber,COLS.PARTICIPANTS.RUN_REF+1,[[runRef,role,enrolled,windowStatus]],recovered?'participant_run_bind_recovered':'participant_run_bind');
  const persisted=getParticipantsSheet_().getRange(participant.rowNumber,COLS.PARTICIPANTS.RUN_REF+1,1,4).getValues()[0];
  const persistedDay=canonicalProjectDayKeyOrThrow_(persisted[2],'participant_enrollment_persisted');
  if(String(persisted[0])!==String(runRef)||String(persisted[1])!==String(role)||persistedDay!==enrolled||String(persisted[3])!==String(windowStatus)) throw new Error('PARTICIPANT_ENROLLMENT_PERSISTENCE_FAILED');

  // The entitlement write is deliberately AFTER verified Sheets enrollment and
  // BEFORE the caller can create a first Session. Any companion/config/storage
  // failure throws here; no session path receives an eligible participant.
  reconcileParticipantEnrollmentEligibility_(participant);

  participant.runRef=runRef;participant.participantRole=role;participant.enrolledProjectDay=enrolled;participant.windowStatus=windowStatus;return participant;
}
// PE06 LINEAGE GUARDRAIL: this function governs only the fixed 21-calendar-day
// ordinary daily-calibration window. ENDED_21_CALENDAR_DAYS does not write the
// ChannelGate lifetime state, does not increment participation generation, and
// does not prohibit separately governed same-lineage POST_PILOT transfer contact.
function participantWindowStatus_(participant){if(participant.windowStatus===WINDOW_STATUS.EARLY_STOP)return{status:WINDOW_STATUS.EARLY_STOP,dayNumber:null};ensureParticipantRunEnrollment_(participant);const today=canonicalProjectDayKeyOrThrow_(currentParticipantProjectDay_(participant.id),'participant_window_today'),n=dayNumberFromEnrollment_(participant.enrolledProjectDay,today);if(n>21){storageSetValue_(getParticipantsSheet_(),participant.rowNumber,COLS.PARTICIPANTS.WINDOW_STATUS+1,WINDOW_STATUS.ENDED_21_CALENDAR_DAYS,'participant_window_end');participant.windowStatus=WINDOW_STATUS.ENDED_21_CALENDAR_DAYS;return{status:WINDOW_STATUS.ENDED_21_CALENDAR_DAYS,dayNumber:n};}return{status:WINDOW_STATUS.ACTIVE,dayNumber:n};}
function markParticipantEarlyStop_(participant,reason){if(isParticipantResearchStopped_(participant))return false;const allowed=[RUN_CLOSURE_STATUS.EARLY_STOP_SAFETY,RUN_CLOSURE_STATUS.EARLY_STOP_WITHDRAWAL,RUN_CLOSURE_STATUS.EARLY_STOP_UNRECOVERABLE_TECHNICAL];if(allowed.indexOf(String(reason))<0)throw new Error('INVALID_EARLY_STOP_REASON');ensureParticipantRunEnrollment_(participant);storageSetValue_(getParticipantsSheet_(),participant.rowNumber,COLS.PARTICIPANTS.WINDOW_STATUS+1,WINDOW_STATUS.EARLY_STOP,'participant_early_stop');participant.windowStatus=WINDOW_STATUS.EARLY_STOP;appendEvent_(participant.id,'','PARTICIPANT_WINDOW_EARLY_STOP',{reason:String(reason)});return true;}

// P12 layer decisions, intervention episodes, isolation, and transfer architecture.
// These are operator/protocol entities. They do not compute pattern scores, infer mechanisms,
// or expose reduced-scaffold transfer mode before a separately governed post-pilot run.
const LAYER_DECISION_OUTCOME=Object.freeze({TARGET_PATTERN:'TARGET_PATTERN',NO_PATTERN:'NO_PATTERN',CONSTRUCT_MISMATCH:'CONSTRUCT_MISMATCH'});
const LAYER_DECISION_STATUS=Object.freeze({CURRENT:'CURRENT',SUPERSEDED:'SUPERSEDED'});
const INTERVENTION_STATUS=Object.freeze({ACTIVE:'ACTIVE',SUSPENDED:'SUSPENDED',ENDED:'ENDED',ABANDONED:'ABANDONED',SUPERSEDED:'SUPERSEDED'});
const TRANSFER_STATUS=Object.freeze({ACTIVE:'ACTIVE',ENDED:'ENDED',SAFETY_EXIT:'SAFETY_EXIT'});
const P12_ALLOW_CONCURRENT_TARGET_EPISODES=false;
const SCB_TRANSFER_MODE_VERSION='SCB_TRANSFER_V1';
function parseJsonArrayStrict_(value,label){if(Array.isArray(value))return value.slice();try{const x=JSON.parse(String(value||'[]'));if(Array.isArray(x))return x}catch(e){}throw new Error('INVALID_JSON_ARRAY:'+label);}
function currentLayerDecision_(participantId){const rows=readRows_(getLayerDecisionsSheet_());for(let i=rows.length-1;i>=0;i--){const r=rows[i];if(String(r[COLS.LAYER_DECISIONS.PARTICIPANT_ID])===String(participantId)&&String(r[COLS.LAYER_DECISIONS.STATUS])===LAYER_DECISION_STATUS.CURRENT)return{row:r,rowNumber:rowNumber_(i)};}return null;}
function validateLayerCycleRefs_(participantId,runRef,ids){const wanted=parseJsonArrayStrict_(ids,'included_cycle_ids').map(String),rows=readRows_(getCalibrationCyclesSheet_());wanted.forEach(id=>{const r=rows.find(x=>String(x[COLS.CALIBRATION_CYCLES.CYCLE_ID])===id);if(!r)throw new Error('LAYER_CYCLE_NOT_FOUND:'+id);if(String(r[COLS.CALIBRATION_CYCLES.PARTICIPANT_ID])!==String(participantId))throw new Error('LAYER_CYCLE_FOREIGN_PARTICIPANT:'+id);if(String(r[COLS.CALIBRATION_CYCLES.RUN_REF])!==String(runRef))throw new Error('LAYER_CYCLE_FOREIGN_RUN:'+id);});return wanted;}
function createLayerDecision_(cfg){
  cfg=cfg||{};const participantId=String(cfg.participantId||''),runRef=String(cfg.runRef||activeRunRef_()),outcome=String(cfg.decisionOutcome||'');
  if(!participantId)throw new Error('LAYER_DECISION_PARTICIPANT_REQUIRED');if(Object.values(LAYER_DECISION_OUTCOME).indexOf(outcome)<0)throw new Error('INVALID_LAYER_DECISION_OUTCOME');
  const evidence=String(cfg.evidenceSnapshotRef||'').trim(),rationale=String(cfg.rationale||'').trim(),analyst=String(cfg.analystRef||'').trim(),reviewer=String(cfg.reviewerRef||'').trim(),owner=String(cfg.ownerAuthorizationRef||'').trim();
  if(!evidence||!rationale||!analyst||!reviewer||!owner)throw new Error('LAYER_DECISION_PROVENANCE_REQUIRED');
  const included=validateLayerCycleRefs_(participantId,runRef,cfg.includedCycleIds||[]);const excluded=parseJsonArrayStrict_(cfg.excludedCycleAdjudications||[],'excluded_cycle_adjudications');const usable=parseJsonArrayStrict_(cfg.usableDayAdjudications||[],'usable_day_adjudications');const patterns=parseJsonArrayStrict_(cfg.candidatePatterns||[],'candidate_patterns');
  const target=String(cfg.selectedTargetPattern||'').trim();if(outcome===LAYER_DECISION_OUTCOME.TARGET_PATTERN){if(!target)throw new Error('LAYER_TARGET_PATTERN_REQUIRED');if(patterns.map(String).indexOf(target)<0)throw new Error('LAYER_TARGET_NOT_IN_CANDIDATES');}else if(target)throw new Error('LAYER_TARGET_FORBIDDEN_WITHOUT_PATTERN');
  const prev=currentLayerDecision_(participantId),version=prev?Number(prev.row[COLS.LAYER_DECISIONS.VERSION]||1)+1:1,now=now_();
  if(prev){storageSetValues_(getLayerDecisionsSheet_(),prev.rowNumber,COLS.LAYER_DECISIONS.EFFECTIVE_TO+1,[[now,prev.row[COLS.LAYER_DECISIONS.EVIDENCE_SNAPSHOT_REF],prev.row[COLS.LAYER_DECISIONS.INCLUDED_CYCLE_IDS],prev.row[COLS.LAYER_DECISIONS.EXCLUDED_CYCLE_ADJUDICATIONS],prev.row[COLS.LAYER_DECISIONS.USABLE_DAY_ADJUDICATIONS],prev.row[COLS.LAYER_DECISIONS.CANDIDATE_PATTERNS],prev.row[COLS.LAYER_DECISIONS.SELECTED_TARGET_PATTERN],prev.row[COLS.LAYER_DECISIONS.DECISION_OUTCOME],prev.row[COLS.LAYER_DECISIONS.RATIONALE],prev.row[COLS.LAYER_DECISIONS.ANALYST_REF],prev.row[COLS.LAYER_DECISIONS.REVIEWER_REF],prev.row[COLS.LAYER_DECISIONS.OWNER_AUTHORIZATION_REF],prev.row[COLS.LAYER_DECISIONS.DECIDED_AT],prev.row[COLS.LAYER_DECISIONS.VERSION],prev.row[COLS.LAYER_DECISIONS.SUPERSEDES_DECISION_ID],LAYER_DECISION_STATUS.SUPERSEDED]],'layer_decision_supersede');}
  const id=Utilities.getUuid();const row=[id,participantId,runRef,String(cfg.assignment||'LAYER_2'),String(cfg.layerEntry||'LAYER_2'),String(cfg.layerExit|| (outcome===LAYER_DECISION_OUTCOME.TARGET_PATTERN?'LAYER_3':'NO_TRANSITION')),String(cfg.effectiveFrom||now),'',evidence,JSON.stringify(included),JSON.stringify(excluded),JSON.stringify(usable),JSON.stringify(patterns),target,outcome,rationale,analyst,reviewer,owner,now,version,prev?String(prev.row[COLS.LAYER_DECISIONS.DECISION_ID]):'',LAYER_DECISION_STATUS.CURRENT];
  const rn=storageAppendRow_(getLayerDecisionsSheet_(),row,'layer_decision_create');return{row:getLayerDecisionsSheet_().getRange(rn,1,1,COLS.LAYER_DECISIONS.COUNT).getValues()[0],rowNumber:rn};
}
function isLayer3TransitionAllowed_(decision){const r=decision&&decision.row?decision.row:decision;if(!r)return false;return String(r[COLS.LAYER_DECISIONS.STATUS])===LAYER_DECISION_STATUS.CURRENT&&String(r[COLS.LAYER_DECISIONS.DECISION_OUTCOME])===LAYER_DECISION_OUTCOME.TARGET_PATTERN&&!!String(r[COLS.LAYER_DECISIONS.SELECTED_TARGET_PATTERN])&&!!String(r[COLS.LAYER_DECISIONS.ANALYST_REF])&&!!String(r[COLS.LAYER_DECISIONS.REVIEWER_REF])&&!!String(r[COLS.LAYER_DECISIONS.OWNER_AUTHORIZATION_REF]);}
function interventionEpisodeById_(id){const rows=readRows_(getInterventionEpisodesSheet_());for(let i=rows.length-1;i>=0;i--)if(String(rows[i][COLS.INTERVENTION_EPISODES.EPISODE_ID])===String(id))return{row:rows[i],rowNumber:rowNumber_(i)};return null;}
function activeInterventionEpisodes_(participantId){const rows=readRows_(getInterventionEpisodesSheet_()),out=[];rows.forEach((r,i)=>{const st=String(r[COLS.INTERVENTION_EPISODES.STATUS]);if(String(r[COLS.INTERVENTION_EPISODES.PARTICIPANT_ID])===String(participantId)&&(st===INTERVENTION_STATUS.ACTIVE||st===INTERVENTION_STATUS.SUSPENDED))out.push({row:r,rowNumber:rowNumber_(i)});});return out;}
function createInterventionEpisode_(cfg){cfg=cfg||{};const participantId=String(cfg.participantId||''),decisionId=String(cfg.layerDecisionId||'');if(!participantId||!decisionId)throw new Error('INTERVENTION_PARTICIPANT_DECISION_REQUIRED');const dRows=readRows_(getLayerDecisionsSheet_());const dIndex=dRows.findIndex(r=>String(r[COLS.LAYER_DECISIONS.DECISION_ID])===decisionId);if(dIndex<0)throw new Error('LAYER_DECISION_NOT_FOUND');const d={row:dRows[dIndex],rowNumber:rowNumber_(dIndex)};if(String(d.row[COLS.LAYER_DECISIONS.PARTICIPANT_ID])!==participantId)throw new Error('LAYER_DECISION_PARTICIPANT_MISMATCH');if(!isLayer3TransitionAllowed_(d))throw new Error('LAYER3_TRANSITION_NOT_AUTHORIZED');const target=String(d.row[COLS.LAYER_DECISIONS.SELECTED_TARGET_PATTERN]);if(String(cfg.targetPattern||target)!==target)throw new Error('INTERVENTION_TARGET_MISMATCH');if(!P12_ALLOW_CONCURRENT_TARGET_EPISODES&&activeInterventionEpisodes_(participantId).length)throw new Error('ACTIVE_INTERVENTION_EXISTS');
  const mechanism=String(cfg.mechanismId||'').trim(),mv=String(cfg.mechanismVersion||'').trim(),iv=String(cfg.instructionVersion||'').trim();if(!mechanism||!mv||!iv)throw new Error('INTERVENTION_VERSION_REQUIRED');const now=now_(),id=Utilities.getUuid(),runRef=String(d.row[COLS.LAYER_DECISIONS.RUN_REF]);const row=[id,participantId,runRef,decisionId,target,mechanism,mv,iv,String(cfg.effectiveFrom||now),'',INTERVENTION_STATUS.ACTIVE,now,'NOT_EXPOSED','','NOT_REPORTED','','NOT_CONTACTED','','','','','','',JSON.stringify(parseJsonArrayStrict_(cfg.concurrentSupports||[],'concurrent_supports')),JSON.stringify(parseJsonArrayStrict_(cfg.deviations||[],'deviations')),String(cfg.supersedesEpisodeId||''),now,now];const rn=storageAppendRow_(getInterventionEpisodesSheet_(),row,'intervention_episode_create');return{row:getInterventionEpisodesSheet_().getRange(rn,1,1,COLS.INTERVENTION_EPISODES.COUNT).getValues()[0],rowNumber:rn};}
function updateInterventionFields_(rec,start,values,label){storageSetValues_(getInterventionEpisodesSheet_(),rec.rowNumber,start+1,[values],label);return interventionEpisodeById_(rec.row[COLS.INTERVENTION_EPISODES.EPISODE_ID]);}
function recordInterventionExposure_(episodeId,status){let r=interventionEpisodeById_(episodeId);if(!r||String(r.row[COLS.INTERVENTION_EPISODES.STATUS])!==INTERVENTION_STATUS.ACTIVE)throw new Error('INTERVENTION_NOT_ACTIVE');return updateInterventionFields_(r,COLS.INTERVENTION_EPISODES.EXPOSURE_STATUS,[String(status||'AVAILABLE'),now_()],'intervention_exposure');}
function recordInterventionAdherenceReport_(episodeId,status){let r=interventionEpisodeById_(episodeId);if(!r)throw new Error('INTERVENTION_NOT_FOUND');return updateInterventionFields_(r,COLS.INTERVENTION_EPISODES.ADHERENCE_STATUS,[String(status||'REPORTED'),now_()],'intervention_adherence');}
function recordInterventionTargetContact_(episodeId,status){let r=interventionEpisodeById_(episodeId);if(!r||String(r.row[COLS.INTERVENTION_EPISODES.STATUS])!==INTERVENTION_STATUS.ACTIVE)throw new Error('INTERVENTION_NOT_ACTIVE');return updateInterventionFields_(r,COLS.INTERVENTION_EPISODES.TARGET_CONTACT_STATUS,[String(status||'CONTACTED'),now_()],'intervention_target_contact');}
function suspendInterventionEpisode_(episodeId,reason){let r=interventionEpisodeById_(episodeId);if(!r)throw new Error('INTERVENTION_NOT_FOUND');const st=String(r.row[COLS.INTERVENTION_EPISODES.STATUS]);if(st===INTERVENTION_STATUS.SUSPENDED)return r;if(st!==INTERVENTION_STATUS.ACTIVE)throw new Error('INTERVENTION_NOT_ACTIVE');return updateInterventionFields_(r,COLS.INTERVENTION_EPISODES.STATUS,[INTERVENTION_STATUS.SUSPENDED,r.row[COLS.INTERVENTION_EPISODES.ASSIGNED_AT],r.row[COLS.INTERVENTION_EPISODES.EXPOSURE_STATUS],r.row[COLS.INTERVENTION_EPISODES.EXPOSURE_AT],r.row[COLS.INTERVENTION_EPISODES.ADHERENCE_STATUS],r.row[COLS.INTERVENTION_EPISODES.ADHERENCE_AT],r.row[COLS.INTERVENTION_EPISODES.TARGET_CONTACT_STATUS],r.row[COLS.INTERVENTION_EPISODES.TARGET_CONTACT_AT],now_(),String(reason||'PROTOCOL_SUSPENSION'),'',r.row[COLS.INTERVENTION_EPISODES.ENDED_AT],r.row[COLS.INTERVENTION_EPISODES.END_REASON],r.row[COLS.INTERVENTION_EPISODES.CONCURRENT_SUPPORTS],r.row[COLS.INTERVENTION_EPISODES.DEVIATIONS],r.row[COLS.INTERVENTION_EPISODES.SUPERSEDES_EPISODE_ID],r.row[COLS.INTERVENTION_EPISODES.CREATED_AT],now_()],'intervention_suspend');}
function resumeInterventionEpisode_(episodeId){let r=interventionEpisodeById_(episodeId);if(!r||String(r.row[COLS.INTERVENTION_EPISODES.STATUS])!==INTERVENTION_STATUS.SUSPENDED)throw new Error('INTERVENTION_NOT_SUSPENDED');return updateInterventionFields_(r,COLS.INTERVENTION_EPISODES.STATUS,[INTERVENTION_STATUS.ACTIVE,r.row[COLS.INTERVENTION_EPISODES.ASSIGNED_AT],r.row[COLS.INTERVENTION_EPISODES.EXPOSURE_STATUS],r.row[COLS.INTERVENTION_EPISODES.EXPOSURE_AT],r.row[COLS.INTERVENTION_EPISODES.ADHERENCE_STATUS],r.row[COLS.INTERVENTION_EPISODES.ADHERENCE_AT],r.row[COLS.INTERVENTION_EPISODES.TARGET_CONTACT_STATUS],r.row[COLS.INTERVENTION_EPISODES.TARGET_CONTACT_AT],r.row[COLS.INTERVENTION_EPISODES.SUSPENDED_AT],r.row[COLS.INTERVENTION_EPISODES.SUSPENSION_REASON],now_(),r.row[COLS.INTERVENTION_EPISODES.ENDED_AT],r.row[COLS.INTERVENTION_EPISODES.END_REASON],r.row[COLS.INTERVENTION_EPISODES.CONCURRENT_SUPPORTS],r.row[COLS.INTERVENTION_EPISODES.DEVIATIONS],r.row[COLS.INTERVENTION_EPISODES.SUPERSEDES_EPISODE_ID],r.row[COLS.INTERVENTION_EPISODES.CREATED_AT],now_()],'intervention_resume');}
function endInterventionEpisode_(episodeId,reason,abandoned){let r=interventionEpisodeById_(episodeId);if(!r)throw new Error('INTERVENTION_NOT_FOUND');const st=abandoned?INTERVENTION_STATUS.ABANDONED:INTERVENTION_STATUS.ENDED;return updateInterventionFields_(r,COLS.INTERVENTION_EPISODES.STATUS,[st,r.row[COLS.INTERVENTION_EPISODES.ASSIGNED_AT],r.row[COLS.INTERVENTION_EPISODES.EXPOSURE_STATUS],r.row[COLS.INTERVENTION_EPISODES.EXPOSURE_AT],r.row[COLS.INTERVENTION_EPISODES.ADHERENCE_STATUS],r.row[COLS.INTERVENTION_EPISODES.ADHERENCE_AT],r.row[COLS.INTERVENTION_EPISODES.TARGET_CONTACT_STATUS],r.row[COLS.INTERVENTION_EPISODES.TARGET_CONTACT_AT],r.row[COLS.INTERVENTION_EPISODES.SUSPENDED_AT],r.row[COLS.INTERVENTION_EPISODES.SUSPENSION_REASON],r.row[COLS.INTERVENTION_EPISODES.RESUMED_AT],now_(),String(reason||'ENDED'),r.row[COLS.INTERVENTION_EPISODES.CONCURRENT_SUPPORTS],r.row[COLS.INTERVENTION_EPISODES.DEVIATIONS],r.row[COLS.INTERVENTION_EPISODES.SUPERSEDES_EPISODE_ID],r.row[COLS.INTERVENTION_EPISODES.CREATED_AT],now_()],'intervention_end');}
function reviseInterventionEpisode_(episodeId,cfg){const old=interventionEpisodeById_(episodeId);if(!old)throw new Error('INTERVENTION_NOT_FOUND');const changed=String(cfg.mechanismId||old.row[COLS.INTERVENTION_EPISODES.MECHANISM_ID])!==String(old.row[COLS.INTERVENTION_EPISODES.MECHANISM_ID])||String(cfg.mechanismVersion||old.row[COLS.INTERVENTION_EPISODES.MECHANISM_VERSION])!==String(old.row[COLS.INTERVENTION_EPISODES.MECHANISM_VERSION])||String(cfg.instructionVersion||old.row[COLS.INTERVENTION_EPISODES.INSTRUCTION_VERSION])!==String(old.row[COLS.INTERVENTION_EPISODES.INSTRUCTION_VERSION]);if(!changed)throw new Error('INTERVENTION_MATERIAL_CHANGE_REQUIRED');endInterventionEpisode_(episodeId,'MATERIAL_CHANGE_SUPERSEDED',false);storageSetValue_(getInterventionEpisodesSheet_(),old.rowNumber,COLS.INTERVENTION_EPISODES.STATUS+1,INTERVENTION_STATUS.SUPERSEDED,'intervention_supersede');const fresh=Object.assign({},cfg,{participantId:String(old.row[COLS.INTERVENTION_EPISODES.PARTICIPANT_ID]),layerDecisionId:String(old.row[COLS.INTERVENTION_EPISODES.LAYER_DECISION_ID]),targetPattern:String(old.row[COLS.INTERVENTION_EPISODES.TARGET_PATTERN]),mechanismId:String(cfg.mechanismId||old.row[COLS.INTERVENTION_EPISODES.MECHANISM_ID]),mechanismVersion:String(cfg.mechanismVersion||old.row[COLS.INTERVENTION_EPISODES.MECHANISM_VERSION]),instructionVersion:String(cfg.instructionVersion||old.row[COLS.INTERVENTION_EPISODES.INSTRUCTION_VERSION]),supersedesEpisodeId:episodeId});return createInterventionEpisode_(fresh);}
function suspendActiveInterventionsForSafety_(participantId,reason){activeInterventionEpisodes_(participantId).forEach(r=>{if(String(r.row[COLS.INTERVENTION_EPISODES.STATUS])===INTERVENTION_STATUS.ACTIVE)suspendInterventionEpisode_(r.row[COLS.INTERVENTION_EPISODES.EPISODE_ID],reason||'ACUTE_CRISIS_PROTOCOL_STATE');});}
function recordRecoveryProtectedState_(participantId){activeInterventionEpisodes_(participantId).forEach(r=>{const arr=parseJsonArrayStrict_(r.row[COLS.INTERVENTION_EPISODES.DEVIATIONS]||'[]','deviations');arr.push({kind:'RECOVERY_PROTECTED_STATE',at:now_(),interpretation:'not_target_exposure_or_outcome'});storageSetValue_(getInterventionEpisodesSheet_(),r.rowNumber,COLS.INTERVENTION_EPISODES.DEVIATIONS+1,JSON.stringify(arr),'intervention_recovery_protected');});}
function transferEpisodeForParticipant_(participantId){const rows=readRows_(getTransferEpisodesSheet_());for(let i=rows.length-1;i>=0;i--)if(String(rows[i][COLS.TRANSFER_EPISODES.PARTICIPANT_ID])===String(participantId)&&String(rows[i][COLS.TRANSFER_EPISODES.STATUS])===TRANSFER_STATUS.ACTIVE)return{row:rows[i],rowNumber:rowNumber_(i)};return null;}
function activateTransferMode_(participantId){const run=activeStudyRun_();if(String(run.row[COLS.STUDY_RUNS.STAGE])!==STUDY_STAGE.POST_PILOT)throw new Error('TRANSFER_MODE_POST_PILOT_ONLY');if(transferEpisodeForParticipant_(participantId))throw new Error('TRANSFER_MODE_ALREADY_ACTIVE');const now=now_(),id=Utilities.getUuid(),row=[id,String(participantId),String(run.row[COLS.STUDY_RUNS.RUN_ID]),SCB_TRANSFER_MODE_VERSION,TRANSFER_STATUS.ACTIVE,now,'','NOT_EXPOSED',0,'','',now,now];const rn=storageAppendRow_(getTransferEpisodesSheet_(),row,'transfer_activate');return{row:getTransferEpisodesSheet_().getRange(rn,1,1,COLS.TRANSFER_EPISODES.COUNT).getValues()[0],rowNumber:rn};}
function recordTransferExposure_(participantId,status){const r=transferEpisodeForParticipant_(participantId);if(!r)throw new Error('TRANSFER_MODE_NOT_ACTIVE');storageSetValue_(getTransferEpisodesSheet_(),r.rowNumber,COLS.TRANSFER_EPISODES.REDUCED_EXPOSURE_STATUS+1,String(status||'EXPOSED'),'transfer_exposure');storageSetValue_(getTransferEpisodesSheet_(),r.rowNumber,COLS.TRANSFER_EPISODES.UPDATED_AT+1,now_(),'transfer_updated');return true;}
function recordFullScaffoldReturn_(participantId){const r=transferEpisodeForParticipant_(participantId);if(!r)throw new Error('TRANSFER_MODE_NOT_ACTIVE');storageSetValue_(getTransferEpisodesSheet_(),r.rowNumber,COLS.TRANSFER_EPISODES.FULL_SCAFFOLD_REQUESTS+1,Number(r.row[COLS.TRANSFER_EPISODES.FULL_SCAFFOLD_REQUESTS]||0)+1,'transfer_full_scaffold_return');storageSetValue_(getTransferEpisodesSheet_(),r.rowNumber,COLS.TRANSFER_EPISODES.UPDATED_AT+1,now_(),'transfer_updated');return true;}
function recordTransferMissingResponse_(participantId,status){const r=transferEpisodeForParticipant_(participantId);if(!r)throw new Error('TRANSFER_MODE_NOT_ACTIVE');storageSetValue_(getTransferEpisodesSheet_(),r.rowNumber,COLS.TRANSFER_EPISODES.MISSING_RESPONSE_STATUS+1,String(status||'MISSING'),'transfer_missing');return true;}
function safetyExitTransferMode_(participantId){const r=transferEpisodeForParticipant_(participantId);if(!r)return false;storageSetValues_(getTransferEpisodesSheet_(),r.rowNumber,COLS.TRANSFER_EPISODES.STATUS+1,[[TRANSFER_STATUS.SAFETY_EXIT,r.row[COLS.TRANSFER_EPISODES.ACTIVATED_AT],now_(),r.row[COLS.TRANSFER_EPISODES.REDUCED_EXPOSURE_STATUS],r.row[COLS.TRANSFER_EPISODES.FULL_SCAFFOLD_REQUESTS],r.row[COLS.TRANSFER_EPISODES.MISSING_RESPONSE_STATUS],'SAFETY_EXIT',r.row[COLS.TRANSFER_EPISODES.CREATED_AT],now_()]],'transfer_safety_exit');return true;}
function latestTransferEpisodeForParticipant_(participantId){const rows=readRows_(getTransferEpisodesSheet_());for(let i=rows.length-1;i>=0;i--)if(String(rows[i][COLS.TRANSFER_EPISODES.PARTICIPANT_ID])===String(participantId))return{row:rows[i],rowNumber:rowNumber_(i)};return null;}
function endTransferMode_(participantId,reason){const r=latestTransferEpisodeForParticipant_(participantId);if(!r)throw new Error('TRANSFER_MODE_NOT_FOUND');const prior=String(r.row[COLS.TRANSFER_EPISODES.STATUS]);if(prior===TRANSFER_STATUS.ENDED)return true;if(prior!==TRANSFER_STATUS.ACTIVE)throw new Error('TRANSFER_MODE_NOT_ACTIVE');storageSetValues_(getTransferEpisodesSheet_(),r.rowNumber,COLS.TRANSFER_EPISODES.STATUS+1,[[TRANSFER_STATUS.ENDED,r.row[COLS.TRANSFER_EPISODES.ACTIVATED_AT],now_(),r.row[COLS.TRANSFER_EPISODES.REDUCED_EXPOSURE_STATUS],r.row[COLS.TRANSFER_EPISODES.FULL_SCAFFOLD_REQUESTS],r.row[COLS.TRANSFER_EPISODES.MISSING_RESPONSE_STATUS],String(reason||'NORMAL_END'),r.row[COLS.TRANSFER_EPISODES.CREATED_AT],now_()]],'transfer_end');return true;}

const RESEARCH_OPERATOR_ACTION=Object.freeze({
  SET_CYCLE_MISSINGNESS:'SET_CYCLE_MISSINGNESS',MARK_PARTICIPANT_EARLY_STOP:'MARK_PARTICIPANT_EARLY_STOP',CREATE_LAYER_DECISION:'CREATE_LAYER_DECISION',CREATE_INTERVENTION:'CREATE_INTERVENTION',RECORD_INTERVENTION_EXPOSURE:'RECORD_INTERVENTION_EXPOSURE',RECORD_INTERVENTION_ADHERENCE:'RECORD_INTERVENTION_ADHERENCE',RECORD_INTERVENTION_TARGET_CONTACT:'RECORD_INTERVENTION_TARGET_CONTACT',RESUME_INTERVENTION:'RESUME_INTERVENTION',REVISE_INTERVENTION:'REVISE_INTERVENTION',ACTIVATE_TRANSFER:'ACTIVATE_TRANSFER',RECORD_TRANSFER_EXPOSURE:'RECORD_TRANSFER_EXPOSURE',RECORD_FULL_SCAFFOLD_RETURN:'RECORD_FULL_SCAFFOLD_RETURN',RECORD_TRANSFER_MISSING_RESPONSE:'RECORD_TRANSFER_MISSING_RESPONSE',END_TRANSFER:'END_TRANSFER',RECORD_IJP_ITEM:'RECORD_IJP_ITEM',RECORD_INDEPENDENT_CASE_ADJUDICATION:'RECORD_INDEPENDENT_CASE_ADJUDICATION',RECORD_CONTEXT_ANCHOR:'RECORD_CONTEXT_ANCHOR',CREATE_EVIDENCE_ASSESSMENT:'CREATE_EVIDENCE_ASSESSMENT'
});
const RESEARCH_OPERATOR_ACTION_PROPERTY='SCB_RESEARCH_OPERATOR_ACTION';
const RESEARCH_OPERATOR_PAYLOAD_PROPERTY='SCB_RESEARCH_OPERATOR_PAYLOAD_JSON';
function calibrationCycleByIdForOperator_(cycleId){const rows=readRows_(getCalibrationCyclesSheet_());for(let i=rows.length-1;i>=0;i--)if(String(rows[i][COLS.CALIBRATION_CYCLES.CYCLE_ID])===String(cycleId))return{row:rows[i],rowNumber:rowNumber_(i)};return null;}
function dispatchResearchOperatorAction_(action,cfg){
  const a=String(action||''); cfg=cfg||{};
  if(a===RESEARCH_OPERATOR_ACTION.SET_CYCLE_MISSINGNESS){const cycle=calibrationCycleByIdForOperator_(cfg.cycleId);if(!cycle)throw new Error('CALIBRATION_CYCLE_NOT_FOUND');return setCycleMissingnessCause_(cycle,cfg.cause);}
  if(a===RESEARCH_OPERATOR_ACTION.MARK_PARTICIPANT_EARLY_STOP){const found=participantRowById_(cfg.participantId);if(!found)throw new Error('PARTICIPANT_NOT_FOUND');return markParticipantEarlyStop_(participantFromRow_(found.row,found.rowNumber),cfg.reason);}
  if(a===RESEARCH_OPERATOR_ACTION.CREATE_LAYER_DECISION)return createLayerDecision_(cfg);
  if(a===RESEARCH_OPERATOR_ACTION.CREATE_INTERVENTION)return createInterventionEpisode_(cfg);
  if(a===RESEARCH_OPERATOR_ACTION.RECORD_INTERVENTION_EXPOSURE)return recordInterventionExposure_(cfg.episodeId,cfg.status);
  if(a===RESEARCH_OPERATOR_ACTION.RECORD_INTERVENTION_ADHERENCE)return recordInterventionAdherenceReport_(cfg.episodeId,cfg.status);
  if(a===RESEARCH_OPERATOR_ACTION.RECORD_INTERVENTION_TARGET_CONTACT)return recordInterventionTargetContact_(cfg.episodeId,cfg.status);
  if(a===RESEARCH_OPERATOR_ACTION.RESUME_INTERVENTION)return resumeInterventionEpisode_(cfg.episodeId);
  if(a===RESEARCH_OPERATOR_ACTION.REVISE_INTERVENTION)return reviseInterventionEpisode_(cfg.episodeId,cfg);
  if(a===RESEARCH_OPERATOR_ACTION.ACTIVATE_TRANSFER)return activateTransferMode_(cfg.participantId);
  if(a===RESEARCH_OPERATOR_ACTION.RECORD_TRANSFER_EXPOSURE)return recordTransferExposure_(cfg.participantId,cfg.status);
  if(a===RESEARCH_OPERATOR_ACTION.RECORD_FULL_SCAFFOLD_RETURN)return recordFullScaffoldReturn_(cfg.participantId);
  if(a===RESEARCH_OPERATOR_ACTION.RECORD_TRANSFER_MISSING_RESPONSE)return recordTransferMissingResponse_(cfg.participantId,cfg.status);
  if(a===RESEARCH_OPERATOR_ACTION.END_TRANSFER)return endTransferMode_(cfg.participantId,cfg.reason);
  if(a===RESEARCH_OPERATOR_ACTION.RECORD_IJP_ITEM)return recordIjpItem_(cfg);
  if(a===RESEARCH_OPERATOR_ACTION.RECORD_INDEPENDENT_CASE_ADJUDICATION)return recordIndependentCaseAdjudication_(cfg);
  if(a===RESEARCH_OPERATOR_ACTION.RECORD_CONTEXT_ANCHOR)return recordContemporaneousContextAnchor_(cfg);
  if(a===RESEARCH_OPERATOR_ACTION.CREATE_EVIDENCE_ASSESSMENT)return createEvidenceAssessment_(cfg);
  throw new Error('UNKNOWN_RESEARCH_OPERATOR_ACTION');
}
function runConfiguredResearchOperatorAction(){
  const props=PropertiesService.getScriptProperties(), action=String(props.getProperty(RESEARCH_OPERATOR_ACTION_PROPERTY)||'').trim(), raw=String(props.getProperty(RESEARCH_OPERATOR_PAYLOAD_PROPERTY)||'').trim();
  if(Object.values(RESEARCH_OPERATOR_ACTION).indexOf(action)<0)throw new Error('SCB_RESEARCH_OPERATOR_ACTION_REQUIRED_OR_INVALID');
  let cfg={}; if(raw){try{cfg=JSON.parse(raw);}catch(e){throw new Error('SCB_RESEARCH_OPERATOR_PAYLOAD_INVALID');}}
  if(!cfg||Array.isArray(cfg)||typeof cfg!=='object')throw new Error('SCB_RESEARCH_OPERATOR_PAYLOAD_INVALID');
  const lock=LockService.getScriptLock();let acquired=false,priorLock=currentScriptLockContext_;
  try{lock.waitLock(30000);acquired=true;currentScriptLockContext_=lock;const result=dispatchResearchOperatorAction_(action,cfg);props.deleteProperty(RESEARCH_OPERATOR_ACTION_PROPERTY);props.deleteProperty(RESEARCH_OPERATOR_PAYLOAD_PROPERTY);log_('RESEARCH_OPERATOR_ACTION_COMPLETE',{action:action});return result;}
  finally{currentScriptLockContext_=priorLock;if(acquired)lock.releaseLock();}
}

// P13 independent evidence instrumentation.
// E01-approved minimum only: no composite score, no confidence scale, no passive
// surveillance, no mandatory midday prompt, and no gaming-intent inference.
const SCB_EVIDENCE_PROTOCOL_VERSION='SCB_EVIDENCE_PROTOCOL_V1';
const SCB_REVIEW_INSTRUMENT_VERSION='SCB_REVIEW_TRACE_V3';
const SCB_IJP_INSTRUMENT_VERSION='SCB_IJP_V1';
const SCB_IJP_RUBRIC_VERSION='SCB_IJP_RUBRIC_V1';
const SCB_CASE_ADJUDICATION_RUBRIC_VERSION='SCB_CASE_ADJUDICATION_V1';
const EVIDENCE_INDEPENDENCE=Object.freeze({I0:'I0_NONINDEPENDENT',I1:'I1_PARTIAL',I2:'I2_SUFFICIENTLY_INDEPENDENT',TECH:'TECH'});
const EVIDENCE_SUFFICIENCY=Object.freeze({INSUFFICIENT:'INSUFFICIENT',PARTIAL:'PARTIAL',SUFFICIENT_FOR_PRELIMINARY_CLAIM:'SUFFICIENT_FOR_PRELIMINARY_CLAIM',NOT_APPLICABLE:'NOT_APPLICABLE'});
const IJP_CONTACT=Object.freeze({PRE:'PRE_EXPOSURE',ENDPOINT:'PILOT_ENDPOINT'});
const IJP_ADJUDICATION=Object.freeze({CONSISTENT:'constraint_consistent',INCONSISTENT:'constraint_inconsistent',INDETERMINATE:'indeterminate'});
const IJP_ITEMS=Object.freeze({PRE:Object.freeze(['A_PRIORITY','A_FEASIBILITY','A_UNCERTAINTY']),ENDPOINT:Object.freeze(['B_PRIORITY','B_FEASIBILITY','B_UNCERTAINTY'])});
const ALTERNATIVE_EXPLANATION_FLAGS=Object.freeze(['taxonomy_learning','demand_characteristics','social_desirability','attrition_or_missingness','context_change','practice_or_probe_reactivity','operator_influence','outcome_knowledge','measurement_error','construct_mismatch','concurrent_support','gaming_ambiguity']);
function participantRowById_(participantId){const rows=readRows_(getParticipantsSheet_());for(let i=0;i<rows.length;i++)if(String(rows[i][COLS.PARTICIPANTS.ID])===String(participantId))return{row:rows[i],rowNumber:rowNumber_(i)};return null;}
function getParticipantById_(participantId){const found=participantRowById_(participantId);return found?participantFromRow_(found.row,found.rowNumber):null;}
function evidenceObservationRefsForParticipant_(participantId){return readRows_(getEvidenceObservationsSheet_()).filter(r=>String(r[COLS.EVIDENCE_OBSERVATIONS.PARTICIPANT_ID])===String(participantId));}
function validateEvidenceMissingness_(cause){if(cause===''||cause===null||cause===undefined)return '';if(!isValidMissingnessCause_(cause))throw new Error('INVALID_EVIDENCE_MISSINGNESS_CAUSE');return String(cause);}
function recordEvidenceObservation_(cfg){
  cfg=cfg||{};const pid=String(cfg.participantId||''),runRef=String(cfg.runRef||activeRunRef_()),instrumentId=String(cfg.instrumentId||''),instrumentVersion=String(cfg.instrumentVersion||''),klass=String(cfg.independenceClass||'');
  if(!pid||!participantRowById_(pid))throw new Error('EVIDENCE_PARTICIPANT_REQUIRED');if(!studyRunById_(runRef))throw new Error('EVIDENCE_RUN_REQUIRED');if(!instrumentId||!instrumentVersion)throw new Error('EVIDENCE_INSTRUMENT_VERSION_REQUIRED');if(Object.values(EVIDENCE_INDEPENDENCE).indexOf(klass)<0)throw new Error('INVALID_EVIDENCE_INDEPENDENCE_CLASS');
  const missing=validateEvidenceMissingness_(cfg.missingnessCause||'');const id=Utilities.getUuid();
  const row=[id,runRef,pid,String(cfg.sessionId||''),String(cfg.cycleId||''),instrumentId,instrumentVersion,String(cfg.formId||''),String(cfg.contact||''),String(cfg.itemId||''),String(cfg.phenomenon||''),String(cfg.sourceType||''),klass,String(cfg.responseCode||''),String(cfg.adjudication||''),String(cfg.rubricVersion||''),String(cfg.outcomeKnowledge||'UNKNOWN'),String(cfg.sharedTaxonomy||'NONE'),String(cfg.operatorRef||''),missing,String(cfg.observedAt||now_()),operationId_()];
  storageAppendRow_(getEvidenceObservationsSheet_(),row,'evidence_observation');return id;
}
function existingIjpItems_(participantId,contact){const rows=evidenceObservationRefsForParticipant_(participantId);return rows.filter(r=>String(r[COLS.EVIDENCE_OBSERVATIONS.INSTRUMENT_ID])==='IJP'&&String(r[COLS.EVIDENCE_OBSERVATIONS.CONTACT])===String(contact));}
function assertIjpContactEligible_(participantId,contact){
  const p=participantRowById_(participantId);if(!p)throw new Error('IJP_PARTICIPANT_NOT_FOUND');const runRef=String(p.row[COLS.PARTICIPANTS.RUN_REF]||activeRunRef_()),stage=runStage_(runRef);
  if(contact===IJP_CONTACT.PRE){const sessions=readRows_(getSessionsSheet_()).filter(r=>String(r[COLS.SESSIONS.PARTICIPANT_ID])===String(participantId));if(sessions.length)throw new Error('IJP_PRE_EXPOSURE_WINDOW_CLOSED');if(String(p.row[COLS.PARTICIPANTS.CONSENT_STATUS])!=='CONSENTED'||!String(p.row[COLS.PARTICIPANTS.TIMEZONE]))throw new Error('IJP_PRE_REQUIRES_CONSENT_TIMEZONE');return runRef;}
  if(contact===IJP_CONTACT.ENDPOINT){if(stage!==STUDY_STAGE.PILOT)throw new Error('IJP_ENDPOINT_REQUIRES_PILOT_RUN');const window=String(p.row[COLS.PARTICIPANTS.WINDOW_STATUS]||'');if(window!==WINDOW_STATUS.ENDED_21_CALENDAR_DAYS)throw new Error('IJP_ENDPOINT_REQUIRES_21_DAY_WINDOW_END');if(transferEpisodeForParticipant_(participantId))throw new Error('IJP_ENDPOINT_MUST_PRECEDE_TRANSFER_EXPOSURE');return runRef;}
  throw new Error('INVALID_IJP_CONTACT');
}
function recordIjpItem_(cfg){
  cfg=cfg||{};const pid=String(cfg.participantId||''),contact=String(cfg.contact||''),runRef=assertIjpContactEligible_(pid,contact),itemId=String(cfg.itemId||''),adj=String(cfg.adjudication||'');const allowed=contact===IJP_CONTACT.PRE?IJP_ITEMS.PRE:IJP_ITEMS.ENDPOINT;
  if(allowed.indexOf(itemId)<0)throw new Error('INVALID_IJP_ITEM');if(Object.values(IJP_ADJUDICATION).indexOf(adj)<0)throw new Error('INVALID_IJP_ADJUDICATION');if(existingIjpItems_(pid,contact).some(r=>String(r[COLS.EVIDENCE_OBSERVATIONS.ITEM_ID])===itemId))throw new Error('IJP_ITEM_ALREADY_RECORDED');
  return recordEvidenceObservation_({participantId:pid,runRef:runRef,instrumentId:'IJP',instrumentVersion:SCB_IJP_INSTRUMENT_VERSION,formId:contact===IJP_CONTACT.PRE?'FORM_A':'FORM_B',contact:contact,itemId:itemId,phenomenon:itemId.indexOf('PRIORITY')>=0?'priority_judgment':itemId.indexOf('FEASIBILITY')>=0?'feasibility_capacity':'warranted_uncertainty',sourceType:'EXTERNAL_PARALLEL_SCENARIO',independenceClass:EVIDENCE_INDEPENDENCE.I2,responseCode:String(cfg.responseCode||''),adjudication:adj,rubricVersion:SCB_IJP_RUBRIC_VERSION,outcomeKnowledge:'EXCLUDED',sharedTaxonomy:'NONE',operatorRef:String(cfg.operatorRef||''),missingnessCause:cfg.missingnessCause||''});
}
function recordIndependentCaseAdjudication_(cfg){cfg=cfg||{};if(String(cfg.outcomeKnowledge||'EXCLUDED')!=='EXCLUDED')throw new Error('CASE_ADJUDICATION_OUTCOME_MUST_BE_EXCLUDED');return recordEvidenceObservation_({participantId:cfg.participantId,runRef:cfg.runRef||activeRunRef_(),sessionId:cfg.sessionId||'',cycleId:cfg.cycleId||'',instrumentId:'INDEPENDENT_CASE_ADJUDICATION',instrumentVersion:SCB_EVIDENCE_PROTOCOL_VERSION,formId:String(cfg.formId||'PRE_OUTCOME_SNAPSHOT'),contact:String(cfg.contact||'SAMPLED'),itemId:String(cfg.itemId||Utilities.getUuid()),phenomenon:String(cfg.phenomenon||''),sourceType:'BLINDED_PRE_OUTCOME_CASE_REVIEW',independenceClass:EVIDENCE_INDEPENDENCE.I2,responseCode:String(cfg.responseCode||''),adjudication:String(cfg.adjudication||'indeterminate'),rubricVersion:SCB_CASE_ADJUDICATION_RUBRIC_VERSION,outcomeKnowledge:'EXCLUDED',sharedTaxonomy:'NONE',operatorRef:String(cfg.operatorRef||''),missingnessCause:cfg.missingnessCause||''});}
function recordContemporaneousContextAnchor_(cfg){cfg=cfg||{};const source=String(cfg.sourceType||'OPERATIONAL_OBSERVATION');if(['OPERATIONAL_OBSERVATION','SELF_INITIATED_EVENT'].indexOf(source)<0)throw new Error('INVALID_CONTEXT_ANCHOR_SOURCE');const id=recordEvidenceObservation_({participantId:cfg.participantId,runRef:cfg.runRef||activeRunRef_(),sessionId:cfg.sessionId||'',cycleId:cfg.cycleId||'',instrumentId:'CONTEXT_ANCHOR',instrumentVersion:SCB_EVIDENCE_PROTOCOL_VERSION,formId:'MIDDAY_EVENT_V1',contact:'EVENT_TIME',itemId:String(cfg.eventId||Utilities.getUuid()),phenomenon:'context_shift_or_reprioritization',sourceType:source,independenceClass:EVIDENCE_INDEPENDENCE.I1,responseCode:String(cfg.eventType||'material_context_event'),adjudication:'',rubricVersion:'',outcomeKnowledge:'CONTEMPORANEOUS',sharedTaxonomy:'NONE',operatorRef:String(cfg.operatorRef||''),missingnessCause:cfg.missingnessCause||''});appendEvent_(String(cfg.participantId||''),String(cfg.sessionId||''),'MIDDAY_CONTEXT_ANCHOR',{evidenceObservationId:id,sourceType:source,eventType:String(cfg.eventType||'material_context_event'),retrospective:false});return id;}
function validateAlternativeFlags_(flags){const arr=parseJsonArrayStrict_(flags||[],'alternative_flags').map(String);arr.forEach(x=>{if(ALTERNATIVE_EXPLANATION_FLAGS.indexOf(x)<0)throw new Error('INVALID_ALTERNATIVE_EXPLANATION_FLAG:'+x)});return arr;}
function createEvidenceAssessment_(cfg){cfg=cfg||{};const pid=String(cfg.participantId||''),runRef=String(cfg.runRef||activeRunRef_()),reviewer=String(cfg.reviewerRef||'').trim(),suff=String(cfg.sufficiencyClass||'');if(!participantRowById_(pid))throw new Error('EVIDENCE_PARTICIPANT_REQUIRED');if(!reviewer)throw new Error('EVIDENCE_REVIEWER_REQUIRED');if(Object.values(EVIDENCE_SUFFICIENCY).indexOf(suff)<0)throw new Error('INVALID_EVIDENCE_SUFFICIENCY');const refs=parseJsonArrayStrict_(cfg.evidenceRefs||[],'evidence_refs').map(String),known={};evidenceObservationRefsForParticipant_(pid).forEach(r=>known[String(r[COLS.EVIDENCE_OBSERVATIONS.OBSERVATION_ID])]=true);refs.forEach(x=>{if(!known[x])throw new Error('EVIDENCE_REF_NOT_FOUND:'+x)});const flags=validateAlternativeFlags_(cfg.alternativeFlags||[]);const id=Utilities.getUuid();storageAppendRow_(getEvidenceAssessmentsSheet_(),[id,runRef,pid,String(cfg.phenomenon||''),JSON.stringify(refs),JSON.stringify(flags),suff,reviewer,String(cfg.rubricVersion||SCB_EVIDENCE_PROTOCOL_VERSION),String(cfg.outcomeKnowledge||'MIXED_OR_UNKNOWN'),now_(),operationId_()],'evidence_assessment');return id;}
function recordReviewInstrumentExposure_(session,itemId,deliveryStatus){return recordEvidenceObservation_({participantId:session.participantId,runRef:String((session.payload||{}).run_ref||activeRunRef_()),sessionId:session.sessionId,cycleId:String((session.payload||{}).calibration_cycle_id||''),instrumentId:'REVIEW_TRACE',instrumentVersion:SCB_REVIEW_INSTRUMENT_VERSION,formId:String(itemId||''),contact:'EVENING_REVIEW',itemId:String(itemId||''),phenomenon:itemId==='Q2'?'retrospective_decision_quality':'retrospective_participant_interpretation',sourceType:'INSTRUMENT_EXPOSURE',independenceClass:EVIDENCE_INDEPENDENCE.I0,responseCode:String(deliveryStatus||'UNVERIFIED'),adjudication:'',rubricVersion:'',outcomeKnowledge:'KNOWN_BY_PARTICIPANT',sharedTaxonomy:itemId==='Q8'?'NONE':'PARTIAL',operatorRef:'',missingnessCause:''});}
function sendReviewTraceInstrument_(session,itemId,text,chatId,keyboard){const ok=sendTelegram_(text,chatId,keyboard);recordReviewInstrumentExposure_(session,itemId,ok===false?'SEND_FAILED':'TELEGRAM_ACCEPTED');return ok;}


// P09 construct-fidelity helpers. These are recording/transition invariants,
// not claims that the stored judgment is objectively correct.
const DAILY_FOCUS_STATE = Object.freeze({
  CLAIM_SIGNAL:'claim_signal', PROTECTED_RECOVERY_HEALTH:'protected_recovery_health',
  VALID_NO_SIGNAL:'valid_no_signal', VALID_UNCERTAIN_OR_CANNOT_COMPARE:'valid_uncertain_or_cannot_compare',
  INCOMPLETE:'incomplete', ACUTE_EXIT:'acute_exit'
});
const REVIEW_CONTRACT = Object.freeze({
  FULL_EVALUATIVE:'full_evaluative', MINIMAL_OPTIONAL_NON_EVALUATIVE:'minimal_optional_non_evaluative',
  MINIMAL_DESCRIPTIVE:'minimal_descriptive', NONE:'none'
});
function reviewContractForDailyFocus_(state){
  if(state===DAILY_FOCUS_STATE.CLAIM_SIGNAL) return REVIEW_CONTRACT.FULL_EVALUATIVE;
  if(state===DAILY_FOCUS_STATE.PROTECTED_RECOVERY_HEALTH) return REVIEW_CONTRACT.MINIMAL_OPTIONAL_NON_EVALUATIVE;
  if(state===DAILY_FOCUS_STATE.ACUTE_EXIT) return REVIEW_CONTRACT.NONE;
  return REVIEW_CONTRACT.MINIMAL_DESCRIPTIVE;
}
function setDailyFocus_(payload,state,label){ const next=Object.assign({},payload||{}); next.daily_focus_state=state; next.daily_focus_label=label==null?null:String(label); next.review_contract=reviewContractForDailyFocus_(state); return next; }
function normalizeClaimStatusText_(value){ const t=String(value||'').trim().toLowerCase(); if(t==='not sure'||t==='unsure'||t==='uncertain')return 'uncertain'; if(t==='no present claim'||t==='no claim'||t==='none')return 'absent'; return t?'specific':'absent'; }
function isFinalInstrumentContractRecord_(rec){return !!(rec&&String(rec.instrument_contract_version||'')===SCB_INSTRUMENT_CONTRACT_VERSION);}
function candidateQualifies_(rec){
  if(!rec||rec.present_claim_status!=='specific')return false;
  const finalContract=isFinalInstrumentContractRecord_(rec);
  if(finalContract&&rec.present_claim_attested!=='yes')return false;
  if(rec.feasible_today==='yes')return true;
  if(rec.smaller_action_feasible!=='yes'||!String(rec.smaller_action||'').trim())return false;
  return !finalContract||rec.smaller_action_same_direction_attested==='yes';
}
function qualifyingSignalText_(rec){ if(!candidateQualifies_(rec))return ''; return rec.feasible_today==='yes'?String(rec.candidate||'').trim():String(rec.smaller_action||'').trim(); }
function comparisonAllowsFocalSelection_(payload){if(!payload||payload.candidate_path!=='two_competing')return true;return payload.comparison_status==='resolved'||payload.comparison_status==='not_required_single_qualifier';}
function nonFocalCandidateIndexes_(payload){ const claims=Array.isArray(payload&&payload.other_claims)?payload.other_claims:[]; const focal=Number.isInteger(payload&&payload.focal_candidate_index)?payload.focal_candidate_index:null; const out=[]; for(let i=0;i<claims.length;i++) if(i!==focal&&String(claims[i]&&claims[i].candidate||'').trim())out.push(i); return out; }
function currentPreserveCandidate_(payload){ const ids=Array.isArray(payload&&payload.preserve_candidate_indexes)?payload.preserve_candidate_indexes:[]; const pos=Number(payload&&payload.preserve_position||0), idx=ids[pos], claims=Array.isArray(payload&&payload.other_claims)?payload.other_claims:[]; return Number.isInteger(idx)&&claims[idx]?{index:idx,record:claims[idx],position:pos,total:ids.length}:null; }
function preparePreserve_(session,payload){ const next=Object.assign({},payload||{}); next.preserve_candidate_indexes=nonFocalCandidateIndexes_(next); next.preserve_position=0; return next.preserve_candidate_indexes.length?transitionSession_(session,STATES.PRESERVE,next):completeWithNewSignal_(session,next); }
function appendDispositionHistory_(session,payload,index,disposition){ const next=Object.assign({},payload||{}), claims=Array.isArray(next.other_claims)?next.other_claims:[], rec=claims[index]||{}; const entry={candidate_index:index,candidate:String(rec.candidate||''),disposition:String(disposition),provenance:'morning_contemporaneous',recorded_at:now_()}; next.disposition_history=Array.isArray(next.disposition_history)?next.disposition_history.slice():[]; next.disposition_history.push(entry); if(disposition==='scheduled'){next.scheduled_items=Array.isArray(next.scheduled_items)?next.scheduled_items.slice():[];next.scheduled_items.push(entry.candidate);} if(disposition==='later'){next.later_items=Array.isArray(next.later_items)?next.later_items.slice():[];next.later_items.push(entry.candidate);} appendEvent_(session.participantId,session.sessionId,'NON_FOCAL_DISPOSITION_RECORDED',{candidateIndex:index,candidate:entry.candidate,disposition:entry.disposition,provenance:entry.provenance}); return next; }


// P10 calibration-cycle and adjustment-contact helpers. RUN_REF is a deliberate
// placeholder until P11 introduces immutable study-run identity; it is not a run ID.
const P10_RUN_REF_PLACEHOLDER = ''; // retired by P11; retained only as a non-authoritative compatibility symbol
const CYCLE_STATUS = Object.freeze({
  MORNING_ACTIVE:'MORNING_ACTIVE', MORNING_COMPLETE:'MORNING_COMPLETE',
  REVIEW_ACTIVE:'REVIEW_ACTIVE', COMPLETE:'COMPLETE', REVIEW_MISSING:'REVIEW_MISSING',
  SUPERSEDED:'SUPERSEDED'
});
const LEARNING_STATUS = Object.freeze({
  NO_LESSON:'NO_LESSON', UNCERTAIN:'UNCERTAIN', SPECIFIC_PARTICIPANT_STATED:'SPECIFIC_PARTICIPANT_STATED'
});
const ADJUSTMENT_STATUS = Object.freeze({
  ACTIVE:'ACTIVE', ACCEPTED:'ACCEPTED', DECLINED:'DECLINED', EXPIRED:'EXPIRED',
  SUPERSEDED:'SUPERSEDED', WITHDRAWN:'WITHDRAWN'
});
function isMorningSourceState_(source){ return source==='START_COMMAND' || source==='SETUP_COMPLETE'; }
function findCalibrationCycleByMorningSession_(sessionId){
  const rows=readRows_(getCalibrationCyclesSheet_());
  for(let i=rows.length-1;i>=0;i--) if(String(rows[i][COLS.CALIBRATION_CYCLES.MORNING_SESSION_ID])===String(sessionId)) return {row:rows[i],rowNumber:rowNumber_(i)};
  return null;
}
function findCalibrationCycleByReviewSession_(sessionId){
  const rows=readRows_(getCalibrationCyclesSheet_());
  for(let i=rows.length-1;i>=0;i--) if(String(rows[i][COLS.CALIBRATION_CYCLES.REVIEW_SESSION_ID])===String(sessionId)) return {row:rows[i],rowNumber:rowNumber_(i)};
  return null;
}
function ensureCalibrationCycleForMorning_(session){
  if(!session || !isMorningSourceState_(String((session.payload||{}).source_state||''))) return null;
  const existing=findCalibrationCycleByMorningSession_(session.sessionId); if(existing) return existing;
  const id=Utilities.getUuid(), now=now_();
  const terminal=String(session.activityStatus||'')!==ACTIVE_STATUS && TERMINAL_STATES.indexOf(session.state)>=0;
  const cycleStatus=terminal?CYCLE_STATUS.MORNING_COMPLETE:CYCLE_STATUS.MORNING_ACTIVE;
  const dailyFocus=terminal?cycleDailyFocusForTerminal_(session.state,session.payload):String((session.payload||{}).daily_focus_state||'');
  const morningCompleted=terminal?String(session.completedAt||session.updatedAt||now):'';
  const rn=storageAppendRow_(getCalibrationCyclesSheet_(),[
    id,String(session.participantId),canonicalSessionProjectDay_(session),String(session.runRef||activeRunRef_()),
    String(session.sessionId),dailyFocus,'',cycleStatus,'',now,morningCompleted,'','',now,operationId_()
  ],'calibration_cycle_create');
  return {row:getCalibrationCyclesSheet_().getRange(rn,1,1,COLS.CALIBRATION_CYCLES.COUNT).getValues()[0],rowNumber:rn};
}
function cycleDailyFocusForTerminal_(state,payload){
  if(payload && payload.daily_focus_state) return String(payload.daily_focus_state);
  if(state===STATES.ACUTE_EXIT) return DAILY_FOCUS_STATE.ACUTE_EXIT;
  if(state===STATES.RECOVERY_EXIT) return DAILY_FOCUS_STATE.PROTECTED_RECOVERY_HEALTH;
  return DAILY_FOCUS_STATE.INCOMPLETE;
}
function updateCalibrationCycleForMorningTerminal_(session,newState,payload){
  if(!session || !isMorningSourceState_(String((session.payload||{}).source_state||''))) return;
  if(TERMINAL_STATES.indexOf(newState)<0) return;
  const rec=ensureCalibrationCycleForMorning_(session); if(!rec) return;
  const targetDailyFocus=cycleDailyFocusForTerminal_(newState,payload);
  if(String(rec.row[COLS.CALIBRATION_CYCLES.LIFECYCLE_STATUS]||'')===CYCLE_STATUS.MORNING_COMPLETE && String(rec.row[COLS.CALIBRATION_CYCLES.DAILY_FOCUS_STATE]||'')===String(targetDailyFocus)) return;
  if(!verifyRowIdentity_(getCalibrationCyclesSheet_(),rec.rowNumber,COLS.CALIBRATION_CYCLES.CYCLE_ID,rec.row[COLS.CALIBRATION_CYCLES.CYCLE_ID],'cycle_morning_complete')) throw new Error('CALIBRATION_CYCLE_IDENTITY_MISMATCH');
  const now=now_();
  storageSetValues_(getCalibrationCyclesSheet_(),rec.rowNumber,COLS.CALIBRATION_CYCLES.DAILY_FOCUS_STATE+1,[[
    targetDailyFocus,rec.row[COLS.CALIBRATION_CYCLES.REVIEW_SESSION_ID]||'',CYCLE_STATUS.MORNING_COMPLETE,'',rec.row[COLS.CALIBRATION_CYCLES.CREATED_AT]||now,now,rec.row[COLS.CALIBRATION_CYCLES.REVIEW_STARTED_AT]||'',rec.row[COLS.CALIBRATION_CYCLES.REVIEW_COMPLETED_AT]||'',now,rec.row[COLS.CALIBRATION_CYCLES.OPERATION_ID]||operationId_()
  ]],'cycle_morning_complete');
}
function markCalibrationCycleSuperseded_(session){
  if(!session || !isMorningSourceState_(String((session.payload||{}).source_state||''))) return;
  const rec=findCalibrationCycleByMorningSession_(session.sessionId); if(!rec) return;
  const status=String(rec.row[COLS.CALIBRATION_CYCLES.LIFECYCLE_STATUS]||'');
  if(status===CYCLE_STATUS.COMPLETE) return;
  storageSetValues_(getCalibrationCyclesSheet_(),rec.rowNumber,COLS.CALIBRATION_CYCLES.LIFECYCLE_STATUS+1,[[CYCLE_STATUS.SUPERSEDED,'superseded_or_corrected',rec.row[COLS.CALIBRATION_CYCLES.CREATED_AT]||'',rec.row[COLS.CALIBRATION_CYCLES.MORNING_COMPLETED_AT]||'',rec.row[COLS.CALIBRATION_CYCLES.REVIEW_STARTED_AT]||'',rec.row[COLS.CALIBRATION_CYCLES.REVIEW_COMPLETED_AT]||'',now_(),rec.row[COLS.CALIBRATION_CYCLES.OPERATION_ID]||operationId_()]],'cycle_superseded');
}
function closePriorUnreviewedCycles_(participantId,currentDay){
  const sheet=getCalibrationCyclesSheet_(), rows=readRows_(sheet);
  rows.forEach((row,index)=>{
    if(String(row[COLS.CALIBRATION_CYCLES.PARTICIPANT_ID])!==String(participantId)) return;
    if(compareProjectDayKeys_(row[COLS.CALIBRATION_CYCLES.PROJECT_DAY],currentDay,'cycle_review_missing')>=0) return;
    if(String(row[COLS.CALIBRATION_CYCLES.LIFECYCLE_STATUS])!==CYCLE_STATUS.MORNING_COMPLETE) return;
    storageSetValues_(sheet,rowNumber_(index),COLS.CALIBRATION_CYCLES.LIFECYCLE_STATUS+1,[[CYCLE_STATUS.REVIEW_MISSING,'unknown_cause',row[COLS.CALIBRATION_CYCLES.CREATED_AT]||'',row[COLS.CALIBRATION_CYCLES.MORNING_COMPLETED_AT]||'',row[COLS.CALIBRATION_CYCLES.REVIEW_STARTED_AT]||'',row[COLS.CALIBRATION_CYCLES.REVIEW_COMPLETED_AT]||'',now_(),row[COLS.CALIBRATION_CYCLES.OPERATION_ID]||operationId_()]],'cycle_review_missing');
  });
}
function bindReviewToCalibrationCycle_(cycle,reviewSession){
  if(!cycle||!reviewSession) throw new Error('CALIBRATION_CYCLE_REVIEW_BIND_MISSING');
  const existing=String(cycle.row[COLS.CALIBRATION_CYCLES.REVIEW_SESSION_ID]||'');
  if(existing && existing!==String(reviewSession.sessionId)) throw new Error('CALIBRATION_CYCLE_ALREADY_HAS_REVIEW');
  const status=String(cycle.row[COLS.CALIBRATION_CYCLES.LIFECYCLE_STATUS]||'');
  if(status===CYCLE_STATUS.COMPLETE||status===CYCLE_STATUS.REVIEW_ACTIVE) throw new Error('CALIBRATION_CYCLE_REVIEW_ALREADY_STARTED');
  storageSetValues_(getCalibrationCyclesSheet_(),cycle.rowNumber,COLS.CALIBRATION_CYCLES.REVIEW_SESSION_ID+1,[[String(reviewSession.sessionId),CYCLE_STATUS.REVIEW_ACTIVE,'',cycle.row[COLS.CALIBRATION_CYCLES.CREATED_AT]||'',cycle.row[COLS.CALIBRATION_CYCLES.MORNING_COMPLETED_AT]||'',now_(),cycle.row[COLS.CALIBRATION_CYCLES.REVIEW_COMPLETED_AT]||'',now_(),cycle.row[COLS.CALIBRATION_CYCLES.OPERATION_ID]||operationId_()]],'cycle_review_bind');
}
function finalizeCalibrationCycleFromReview_(session){
  const rec=findCalibrationCycleByReviewSession_(session.sessionId); if(!rec) return;
  if(String(rec.row[COLS.CALIBRATION_CYCLES.LIFECYCLE_STATUS]||'')===CYCLE_STATUS.COMPLETE) return;
  storageSetValues_(getCalibrationCyclesSheet_(),rec.rowNumber,COLS.CALIBRATION_CYCLES.LIFECYCLE_STATUS+1,[[CYCLE_STATUS.COMPLETE,'',rec.row[COLS.CALIBRATION_CYCLES.CREATED_AT]||'',rec.row[COLS.CALIBRATION_CYCLES.MORNING_COMPLETED_AT]||'',rec.row[COLS.CALIBRATION_CYCLES.REVIEW_STARTED_AT]||'',now_(),now_(),rec.row[COLS.CALIBRATION_CYCLES.OPERATION_ID]||operationId_()]],'cycle_review_complete');
}
function learningRecordForReview_(reviewSessionId){
  const rows=readRows_(getLearningRecordsSheet_());
  for(let i=rows.length-1;i>=0;i--) if(String(rows[i][COLS.LEARNING_RECORDS.REVIEW_SESSION_ID])===String(reviewSessionId)) return {row:rows[i],rowNumber:rowNumber_(i)};
  return null;
}
function recordLearningForReview_(session,status,text){
  const existing=learningRecordForReview_(session.sessionId); if(existing) return existing;
  const cycle=findCalibrationCycleByReviewSession_(session.sessionId); if(!cycle) throw new Error('LEARNING_RECORD_CYCLE_MISSING');
  const id=Utilities.getUuid(), value=status===LEARNING_STATUS.SPECIFIC_PARTICIPANT_STATED?String(text||'').trim():'';
  const rn=storageAppendRow_(getLearningRecordsSheet_(),[id,String(cycle.row[COLS.CALIBRATION_CYCLES.CYCLE_ID]),String(session.participantId),String(session.sessionId),status,value,now_(),operationId_(),String(cycle.row[COLS.CALIBRATION_CYCLES.RUN_REF]||activeRunRef_())],'learning_record');
  return {row:getLearningRecordsSheet_().getRange(rn,1,1,COLS.LEARNING_RECORDS.COUNT).getValues()[0],rowNumber:rn};
}
function adjustmentPlanById_(adjustmentId){
  const rows=readRows_(getAdjustmentPlansSheet_());
  for(let i=rows.length-1;i>=0;i--) if(String(rows[i][COLS.ADJUSTMENT_PLANS.ADJUSTMENT_ID])===String(adjustmentId)) return {row:rows[i],rowNumber:rowNumber_(i)};
  return null;
}
function createAdjustmentPlanFromReview_(session,text){
  const plan=String(text||'').trim(); if(!plan) return null;
  const cycle=findCalibrationCycleByReviewSession_(session.sessionId); if(!cycle) throw new Error('ADJUSTMENT_PLAN_CYCLE_MISSING');
  const rows=readRows_(getAdjustmentPlansSheet_());
  const duplicate=rows.find(r=>String(r[COLS.ADJUSTMENT_PLANS.SOURCE_REVIEW_SESSION_ID])===String(session.sessionId)); if(duplicate) return {row:duplicate,rowNumber:0};
  const lineage=Utilities.getUuid(), id=Utilities.getUuid(), now=now_();
  const rn=storageAppendRow_(getAdjustmentPlansSheet_(),[id,lineage,String(cycle.row[COLS.CALIBRATION_CYCLES.CYCLE_ID]),String(session.participantId),String(session.sessionId),1,plan,ADJUSTMENT_STATUS.ACTIVE,canonicalProjectDayKeyOrThrow_(cycle.row[COLS.CALIBRATION_CYCLES.PROJECT_DAY],'adjustment_source_cycle_day'),now,now,'','','','','','',operationId_(),String(cycle.row[COLS.CALIBRATION_CYCLES.RUN_REF]||activeRunRef_())],'adjustment_plan_create');
  return {row:getAdjustmentPlansSheet_().getRange(rn,1,1,COLS.ADJUSTMENT_PLANS.COUNT).getValues()[0],rowNumber:rn};
}
function setAdjustmentPlanStatus_(rec,status,fields){
  if(!rec) return false; fields=fields||{}; const row=rec.row, now=now_();
  storageSetValues_(getAdjustmentPlansSheet_(),rec.rowNumber,COLS.ADJUSTMENT_PLANS.STATUS+1,[[
    status,row[COLS.ADJUSTMENT_PLANS.SOURCE_PROJECT_DAY]||'',row[COLS.ADJUSTMENT_PLANS.CREATED_AT]||now,now,
    fields.exposureStatus!==undefined?fields.exposureStatus:(row[COLS.ADJUSTMENT_PLANS.EXPOSURE_STATUS]||''),
    fields.exposureAttemptedAt!==undefined?fields.exposureAttemptedAt:(row[COLS.ADJUSTMENT_PLANS.EXPOSURE_ATTEMPTED_AT]||''),
    fields.deliveryStatus!==undefined?fields.deliveryStatus:(row[COLS.ADJUSTMENT_PLANS.DELIVERY_STATUS]||''),
    fields.response!==undefined?fields.response:(row[COLS.ADJUSTMENT_PLANS.RESPONSE]||''),
    fields.respondedAt!==undefined?fields.respondedAt:(row[COLS.ADJUSTMENT_PLANS.RESPONDED_AT]||''),
    fields.supersedes!==undefined?fields.supersedes:(row[COLS.ADJUSTMENT_PLANS.SUPERSEDES_ADJUSTMENT_ID]||''),
    row[COLS.ADJUSTMENT_PLANS.OPERATION_ID]||operationId_()
  ]],'adjustment_status'); return true;
}
function pendingAdjustmentForNextMorning_(participantId,currentDay){
  const rows=readRows_(getAdjustmentPlansSheet_());
  for(let i=rows.length-1;i>=0;i--){ const r=rows[i];
    if(String(r[COLS.ADJUSTMENT_PLANS.PARTICIPANT_ID])!==String(participantId)) continue;
    if(String(r[COLS.ADJUSTMENT_PLANS.STATUS])!==ADJUSTMENT_STATUS.ACTIVE) continue;
    if(compareProjectDayKeys_(r[COLS.ADJUSTMENT_PLANS.SOURCE_PROJECT_DAY],currentDay,'adjustment_next_morning')>=0) continue;
    if(String(r[COLS.ADJUSTMENT_PLANS.EXPOSURE_STATUS]||'')) continue;
    return {row:r,rowNumber:rowNumber_(i)};
  } return null;
}
// P06 code-only pre-launch remediation: adjustment revision is a two-record
// lineage mutation followed by a Session transition. If the new revision was
// durably written but a later boundary failed, the active Session can legally
// ask for the revised text again. Recover against the durable lineage head so
// an exact retry reuses the already-created revision and a changed retry extends
// the same lineage rather than forking another child from the stale source row.
function latestAdjustmentPlanInLineage_(lineageId){
  const id=String(lineageId==null?'':lineageId).trim(); if(!id) return null;
  const rows=readRows_(getAdjustmentPlansSheet_()); let best=null, bestVersion=-Infinity;
  for(let i=0;i<rows.length;i++){
    const r=rows[i]; if(String(r[COLS.ADJUSTMENT_PLANS.LINEAGE_ID])!==id) continue;
    const version=Number(r[COLS.ADJUSTMENT_PLANS.VERSION]); if(!Number.isFinite(version)) throw new Error('ADJUSTMENT_LINEAGE_VERSION_INVALID');
    if(version>bestVersion){ best={row:r,rowNumber:rowNumber_(i)}; bestVersion=version; continue; }
    if(version===bestVersion && best && String(r[COLS.ADJUSTMENT_PLANS.ADJUSTMENT_ID])!==String(best.row[COLS.ADJUSTMENT_PLANS.ADJUSTMENT_ID])) throw new Error('ADJUSTMENT_LINEAGE_VERSION_AMBIGUOUS');
  }
  return best;
}
function createRevisedAdjustmentPlan_(oldRec,newText){
  const text=String(newText||'').trim(); if(!oldRec||!text) return null;
  const oldRow=oldRec.row, lineageId=String(oldRow[COLS.ADJUSTMENT_PLANS.LINEAGE_ID]||'');
  let base=latestAdjustmentPlanInLineage_(lineageId)||oldRec;
  const oldVersion=Number(oldRow[COLS.ADJUSTMENT_PLANS.VERSION]||1), baseVersion=Number(base.row[COLS.ADJUSTMENT_PLANS.VERSION]||1);
  if(baseVersion>oldVersion && String(base.row[COLS.ADJUSTMENT_PLANS.PLAN_TEXT]||'').trim()===text) return base;
  const row=base.row, status=String(row[COLS.ADJUSTMENT_PLANS.STATUS]||''), now=now_();
  if(status!==ADJUSTMENT_STATUS.SUPERSEDED) setAdjustmentPlanStatus_(base,ADJUSTMENT_STATUS.SUPERSEDED,{response:'revised',respondedAt:now});
  const id=Utilities.getUuid(), version=Number(row[COLS.ADJUSTMENT_PLANS.VERSION]||1)+1;
  const rn=storageAppendRow_(getAdjustmentPlansSheet_(),[id,String(row[COLS.ADJUSTMENT_PLANS.LINEAGE_ID]),String(row[COLS.ADJUSTMENT_PLANS.CYCLE_ID]),String(row[COLS.ADJUSTMENT_PLANS.PARTICIPANT_ID]),String(row[COLS.ADJUSTMENT_PLANS.SOURCE_REVIEW_SESSION_ID]),version,text,ADJUSTMENT_STATUS.ACCEPTED,canonicalProjectDayKeyOrThrow_(row[COLS.ADJUSTMENT_PLANS.SOURCE_PROJECT_DAY],'adjustment_revision_source_day'),now,now,'CONTACT_RESPONSE_REVISED',row[COLS.ADJUSTMENT_PLANS.EXPOSURE_ATTEMPTED_AT]||'',row[COLS.ADJUSTMENT_PLANS.DELIVERY_STATUS]||'','revised_and_accepted',now,String(row[COLS.ADJUSTMENT_PLANS.ADJUSTMENT_ID]),operationId_(),String(row[COLS.ADJUSTMENT_PLANS.RUN_REF]||activeRunRef_())],'adjustment_plan_revision');
  return {row:getAdjustmentPlansSheet_().getRange(rn,1,1,COLS.ADJUSTMENT_PLANS.COUNT).getValues()[0],rowNumber:rn};
}
function expireAdjustmentForContactSession_(session,reason){
  const id=String((session.payload||{}).adjustment_plan_id||''); if(!id) return;
  const rec=adjustmentPlanById_(id); if(rec && String(rec.row[COLS.ADJUSTMENT_PLANS.STATUS])===ADJUSTMENT_STATUS.ACTIVE) setAdjustmentPlanStatus_(rec,ADJUSTMENT_STATUS.EXPIRED,{response:String(reason||'contact_expired'),respondedAt:now_()});
}
function startAdjustmentContactIfDue_(participant,chatId){
  const today=currentParticipantProjectDay_(participant.id); closePriorUnreviewedCycles_(participant.id,today);
  const plan=pendingAdjustmentForNextMorning_(participant.id,today); if(!plan) return null;
  const session=createSession_(participant.id,STATES.ADJUSTMENT_CONTACT,'ADJUSTMENT_CONTACT',chatId);
  session.payload=Object.assign({},session.payload,{adjustment_plan_id:String(plan.row[COLS.ADJUSTMENT_PLANS.ADJUSTMENT_ID]),adjustment_plan_version:Number(plan.row[COLS.ADJUSTMENT_PLANS.VERSION]||1),adjustment_plan_text:String(plan.row[COLS.ADJUSTMENT_PLANS.PLAN_TEXT]||'')});
  storageSetValue_(getSessionsSheet_(),session.rowNumber,COLS.SESSIONS.PAYLOAD+1,JSON.stringify(session.payload),'adjustment_contact_payload');
  const attempted=now_(); setAdjustmentPlanStatus_(plan,ADJUSTMENT_STATUS.ACTIVE,{exposureStatus:'ATTEMPTED',exposureAttemptedAt:attempted,deliveryStatus:'PENDING'});
  const sent=renderState_(session,chatId);
  const refreshed=adjustmentPlanById_(session.payload.adjustment_plan_id); if(refreshed) setAdjustmentPlanStatus_(refreshed,ADJUSTMENT_STATUS.ACTIVE,{exposureStatus:sent===false?'ATTEMPTED_FAILED':'EXPOSED_ONCE',exposureAttemptedAt:attempted,deliveryStatus:sent===false?'SEND_FAILED':'TELEGRAM_ACCEPTED'});
  return session;
}
function finishAdjustmentContactAndStartMorning_(session,chatId){
  transitionSession_(session,STATES.COMPLETE,session.payload||{});
  const fresh=createSession_(session.participantId,STATES.READY,'START_COMMAND',chatId); renderState_(fresh,chatId); return fresh;
}
function withdrawActiveAdjustment_(participantId){
  const rows=readRows_(getAdjustmentPlansSheet_());
  for(let i=rows.length-1;i>=0;i--){ const r=rows[i]; if(String(r[COLS.ADJUSTMENT_PLANS.PARTICIPANT_ID])===String(participantId)&&String(r[COLS.ADJUSTMENT_PLANS.STATUS])===ADJUSTMENT_STATUS.ACTIVE){const rec={row:r,rowNumber:rowNumber_(i)};setAdjustmentPlanStatus_(rec,ADJUSTMENT_STATUS.WITHDRAWN,{response:'participant_withdrew',respondedAt:now_()});return rec;} }
  return null;
}

function ensureGateRecord_(payload) {
  const next = Object.assign({}, payload || {});
  if (!Array.isArray(next.other_claims)) next.other_claims = [];
  return next;
}

function gateRecord_(payload) {
  const claims = payload && Array.isArray(payload.other_claims) ? payload.other_claims : [];
  const index = payload && Number.isInteger(payload.gate_current_index) ? payload.gate_current_index : claims.length - 1;
  return index >= 0 && index < claims.length ? claims[index] : null;
}

function updateGateRecord_(payload, patch) {
  const next = ensureGateRecord_(payload);
  const index = Number.isInteger(next.gate_current_index) ? next.gate_current_index : next.other_claims.length - 1;
  if (index < 0) next.other_claims.push(Object.assign({}, patch));
  else next.other_claims[index] = Object.assign({}, next.other_claims[index], patch);
  return next;
}

function beginCandidateGate_(session, candidate, index) {
  const payload = ensureGateRecord_(session.payload);
  payload.other_claims.push({
    candidate:String(candidate).trim(), accepted_commitment:null, accepted_commitment_skipped:false, claim_type:null, commitment_type:null,
    present_claim:null, present_claim_status:null, present_claim_attested:null, feasible_today:null, smaller_action:null,
    smaller_action_feasible:null, smaller_action_same_direction_attested:null, instrument_contract_version:SCB_INSTRUMENT_CONTRACT_VERSION,
    candidate_qualifies:false, qualification_basis:null, gate_result:null
  });
  payload.gate_current_index = index;
  return transitionSession_(session, STATES.GATE_CLAIM, payload);
}

function finishCandidateGate_(session, result) {
  const payload = Object.assign({}, session.payload || {});
  const rec = gateRecord_(payload);
  if (rec) {
    rec.gate_result=result; rec.candidate_qualifies=candidateQualifies_(rec);
    rec.qualification_basis=rec.candidate_qualifies?(rec.feasible_today==='yes'?'specific_present_claim+feasible_as_stated':'specific_present_claim+feasible_smaller_action'):'does_not_meet_qualifying_signal_rule';
  }
  if (payload.candidate_path === 'two_competing' && payload.gate_current_index === 0) {
    payload.gate_current_index = 1;
    return transitionSession_(session, STATES.GATE_CANDIDATE, payload);
  }
  if (payload.candidate_path === 'two_competing') {
    const claims=Array.isArray(payload.other_claims)?payload.other_claims:[];
    const qualifyingCount=claims.filter(candidateQualifies_).length;
    if(qualifyingCount===2)return transitionSession_(session, STATES.GATE_COMPARE, payload);
    payload.comparison_status=qualifyingCount===1?'not_required_single_qualifier':'not_required_no_qualifiers';
    payload.comparison_winner_index=null;
    payload.comparison_resolved='NOT_REQUIRED';
    return transitionSession_(session, STATES.FOCAL_SELECTION, payload);
  }
  return transitionSession_(session, STATES.FOCAL_SELECTION, payload);
}

function getLatestSessionForProjectDay_(participantId) {
  const day = projectDay_(getParticipantTimezone_(participantId));
  const rows = readRows_(getSessionsSheet_());
  let found = null;
  rows.forEach((row, index) => {
    if (String(row[COLS.SESSIONS.PARTICIPANT_ID]) !== String(participantId)) return;
    const candidate=sessionFromRow_(row,rowNumber_(index));
    if (!sessionMatchesProjectDay_(candidate,day)) return;
    found = candidate;
  });
  return found;
}
function isReviewState_(state){ return String(state||'').indexOf('REVIEW_')===0; }
function isEligibleMorningReviewTarget_(session){
  if(!session) return false;
  const source=String((session.payload||{}).source_state||'');
  return isMorningSourceState_(source) && String(session.activityStatus||'')!=='ACTIVE' && !isReviewState_(session.state) && session.state!==STATES.REENTRY_CHOICE;
}
function getLatestEligibleMorningReviewTarget_(participantId) {
  const day=projectDay_(getParticipantTimezone_(participantId));
  const rows=readRows_(getSessionsSheet_()); let found=null;
  rows.forEach((row,index)=>{
    if(String(row[COLS.SESSIONS.PARTICIPANT_ID])!==String(participantId)) return;
    const candidate=sessionFromRow_(row,rowNumber_(index));
    if(!sessionMatchesProjectDay_(candidate,day)) return;
    if(!isEligibleMorningReviewTarget_(candidate)) return;
    if(!found || (Date.parse(candidate.updatedAt||candidate.startedAt||0)||0)>=(Date.parse(found.updatedAt||found.startedAt||0)||0)) found=candidate;
  });
  return found;
}

// Later items are a persist-and-revisit construct (§3: "must not become an
// indefinite graveyard," with a "minimal capture/revisit affordance") rather
// than a same-day-only one, so this deliberately is NOT day-scoped the way
// getLatestSessionForProjectDay_ is — a Later item parked yesterday must still
// be visible via /later today. Scans all of a participant's sessions for the
// most recent one whose payload carries a non-empty later_items array.
function getLatestSessionWithLaterItems_(participantId) {
  const rows = readRows_(getSessionsSheet_());
  let found = null;
  rows.forEach((row, index) => {
    if (String(row[COLS.SESSIONS.PARTICIPANT_ID]) !== String(participantId)) return;
    const session = sessionFromRow_(row, rowNumber_(index));
    if (session.payload && Array.isArray(session.payload.later_items) && session.payload.later_items.length) {
      found = session;
    }
  });
  return found;
}

function isMinimalReviewState_(session) {
  if(!session) return true; const p=session.payload||{}, state=String(session.state||'');
  if(p.review_contract) return p.review_contract!==REVIEW_CONTRACT.FULL_EVALUATIVE;
  const morning=String(p.morning_state||''); if(state===STATES.ACUTE_EXIT||state===STATES.RECOVERY_EXIT)return true;
  return ['no_clear_signal','uncertain','caregiving_relational','maintenance','deliberate_leisure','incomplete_morning'].indexOf(morning)>=0||!p.focal_signal;
}

function startReview_(participant, chatId) {
  if(isParticipantResearchStopped_(participant)) { sendTelegram_('Participation is stopped. No review was started or resumed.',chatId); return null; }
  const continuity=resolveReviewContinuity_(participant.id);
  if(continuity.kind!=='NONE') return recoverOrRenderReviewContinuity_(participant,chatId,continuity);
  const daySession = getLatestEligibleMorningReviewTarget_(participant.id);
  if(!daySession){ sendTelegram_('There is no completed morning decision episode available for review today. No new review was started.',chatId); return null; }
  const cycle=ensureCalibrationCycleForMorning_(daySession);
  const cycleStatus=cycle?String(cycle.row[COLS.CALIBRATION_CYCLES.LIFECYCLE_STATUS]||''):'';
  const linkedReview=cycle?String(cycle.row[COLS.CALIBRATION_CYCLES.REVIEW_SESSION_ID]||''):'';
  if(linkedReview || cycleStatus===CYCLE_STATUS.REVIEW_ACTIVE || cycleStatus===CYCLE_STATUS.COMPLETE){ sendTelegram_('This morning decision episode already has its review linked. A duplicate review was not created.',chatId); return null; }
  const minimal = isMinimalReviewState_(daySession);
  const morningPayloadSignal=String((daySession && daySession.payload && daySession.payload.focal_signal)||'');
  const linkedSignal=(!minimal && !morningPayloadSignal)?getSignalForSession_(participant.id,daySession.sessionId):null;
  const resolvedReviewSignal=morningPayloadSignal||String((linkedSignal&&linkedSignal.signalText)||'');
  const session = createSession_(participant.id,minimal ? STATES.REVIEW_MINIMAL : STATES.REVIEW_Q1,minimal ? 'REVIEW_MINIMAL' : 'REVIEW_COMMAND',chatId);
  bindReviewToCalibrationCycle_(cycle,session);
  const payload = Object.assign({}, session.payload, {
    calibration_cycle_id:String(cycle.row[COLS.CALIBRATION_CYCLES.CYCLE_ID]),
    morning_session_id:String(daySession.sessionId),
    focal_signal: minimal ? (daySession && daySession.payload ? daySession.payload.focal_signal : null) : resolvedReviewSignal,
    review_started_for_signal: minimal ? null : resolvedReviewSignal,
    review_instrument_version: SCB_REVIEW_INSTRUMENT_VERSION,
    review_control_version: SCB_REVIEW_CONTROL_VERSION,
    review_pause_reconciliation: REVIEW_PAUSE_RECONCILIATION.NONE,
    review_resume_pending: true
  });
  return transitionSession_(session, minimal ? STATES.REVIEW_MINIMAL : STATES.REVIEW_Q1, payload);
}

// F-F2a CHANGE NOTE (Section F fix pack, F-F2a, fixes audit finding F2-1, MINOR):
// ACUTE, RECOVERY, and REVIEW_Q6's "Yes" buttons carry explanatory suffixes
// ("— exit now", "— continue", "— describe") that their typed synonyms (bare
// "yes"/"no") didn't literally match — functionally harmless since the bare word
// still matched via these maps, but inconsistent with REVIEW_Q2-Q7's full-string
// synonym parity, and a desktop user who copies the exact button text verbatim
// would previously fail to match. Policy chosen (of the two the fix pack offered):
// extend matching to ALSO accept the full button-label text, case-insensitively,
// rather than stripping suffixes from the buttons — the suffixes add real
// clarifying context ("— exit now" reduces ambiguity about what tapping Yes does
// on a safety-critical screen) so removing them was rejected. Applied uniformly to
// all three affected sites below, not just one. Downstream: only these three
// actionByState entries touched; no other synonym maps, payload keys, or state
// transitions affected. No retesting required beyond re-running audit prompt F2.
// Date: 2026-08-17.
function sessionPromptBarrierAllowsInput_(session, chatId, incomingMessageId) {
  if(!session||!validTelegramInteger_(incomingMessageId,false)) return false;
  const current=readVerifiedSessionOwner_({sessionId:session.sessionId,rowNumber:session.rowNumber,state:session.state,stateVersion:session.stateVersion});
  if(!current) return false;
  const b=current.payload&&current.payload._prompt_barrier;
  return !!(b&&String(b.owner)==='SESSION'&&String(b.session_id)===String(session.sessionId)&&String(b.state)===String(session.state)&&Number(b.state_version)===Number(session.stateVersion)&&String(b.chat_id)===String(chatId)&&String(b.delivery_status)==='TELEGRAM_ACCEPTED_COMPLETE'&&validTelegramInteger_(Number(b.prompt_message_id),false)&&Number(incomingMessageId)>Number(b.prompt_message_id));
}
function sessionPromptBarrierRejectAndRerender_(session,chatId,incomingMessageId) {
  log_('PROMPT_CAUSALITY_REJECTED',{owner:'SESSION',participantId:String(session.participantId),sessionId:String(session.sessionId),state:String(session.state),stateVersion:Number(session.stateVersion),chatId:String(chatId),incomingMessageId:validTelegramInteger_(incomingMessageId,false)?incomingMessageId:null,reason:'PROMPT_BARRIER_UNCONFIRMED_OR_PRE_PROMPT'});
  renderState_(session,chatId);
  return false;
}

function handleStateInput_(session, input, chatId, incomingMessageId) {
  if(isReviewState_(session.state) && reviewAnswerBlocked_(session)) {
    sendTelegram_('This review is preserved but is not ready to accept review answers yet. Use /review to continue recovery.',chatId);
    renderState_(session,chatId); return;
  }
  if(!sessionPromptBarrierAllowsInput_(session,chatId,incomingMessageId)) { sessionPromptBarrierRejectAndRerender_(session,chatId,incomingMessageId); return; }
  const rawText=String(input||'').trim();
  const normalizedReplay=normalizeForDuplicateCompare_(rawText);
  const priorFp=String((session.payload||{})._last_free_text_norm||'');
  const priorVersion=Number((session.payload||{})._last_free_text_state_version||0);
  if(priorFp && priorVersion && priorVersion!==Number(session.stateVersion) && priorFp===normalizedReplay){
    sendTelegram_('That looks like a repeat from the previous step, so I did not use it here. Please answer this current step.',chatId);
    renderState_(session,chatId); return;
  }
  if(rawText && rawText.charAt(0)!=='/'){ session.payload=Object.assign({},session.payload||{}, {_last_free_text_norm:normalizedReplay,_last_free_text_state:session.state,_last_free_text_state_version:session.stateVersion}); }
  const normalized = rawText.toLowerCase();
  const actionByState = {};
  actionByState[STATES.READY] = normalized === 'yes' || normalized === 'start' ? 'READY_START' : '';
  actionByState[STATES.ACUTE] = (normalized === 'yes' || normalized === 'yes — exit now') ? 'ACUTE_YES' : (normalized === 'no' || normalized === 'no — continue') ? 'ACUTE_NO' : '';
  actionByState[STATES.RECOVERY] = (normalized === 'yes' || normalized === 'yes — recovery/health') ? 'RECOVERY_YES' : (normalized === 'no' || normalized === 'no — continue') ? 'RECOVERY_NO' : '';
  actionByState[STATES.REVIEW_Q2] = ({'reasonable given what was known':'REVIEW_Q2_REASONABLE','questionable given what was known':'REVIEW_Q2_QUESTIONABLE','can’t assess':'REVIEW_Q2_CANT','cant assess':'REVIEW_Q2_CANT','not sure':'REVIEW_Q2_UNSURE'})[normalized] || '';
  actionByState[STATES.REVIEW_Q3] = ({'as expected':'REVIEW_Q3_EXPECTED','lower':'REVIEW_Q3_LOWER','higher':'REVIEW_Q3_HIGHER','fluctuating':'REVIEW_Q3_FLUCTUATING','not sure':'REVIEW_Q3_UNSURE'})[normalized] || '';
  actionByState[STATES.REVIEW_Q4] = ({'no':'REVIEW_Q4_NO','minor change':'REVIEW_Q4_MINOR','major change':'REVIEW_Q4_MAJOR','not sure':'REVIEW_Q4_UNSURE'})[normalized] || '';
  actionByState[STATES.REVIEW_Q5] = ({'no':'REVIEW_Q5_NO','yes':'REVIEW_Q5_YES','not sure':'REVIEW_Q5_UNSURE'})[normalized] || '';
  actionByState[STATES.REVIEW_Q6] = ({'no':'REVIEW_Q6_NO','yes':'REVIEW_Q6_YES','yes — describe':'REVIEW_Q6_YES','no focal signal':'REVIEW_Q6_NO_FOCAL','not sure':'REVIEW_Q6_UNSURE','skip':'REVIEW_Q6_SKIP'})[normalized] || '';
  actionByState[STATES.REVIEW_Q7] = ({'completed':'REVIEW_Q7_COMPLETED','substantial progress':'REVIEW_Q7_SUBSTANTIAL','partial progress':'REVIEW_Q7_PARTIAL','no attempt':'REVIEW_Q7_NO_ATTEMPT','unable / blocked from acting':'REVIEW_Q7_UNABLE_BLOCKED','not sure':'REVIEW_Q7_UNSURE','no usable record':'REVIEW_Q7_NO_RECORD'})[normalized] || '';
  // F-F2b CHANGE NOTE (Section F fix pack, F-F2b, fixes audit finding F2-2, MAJOR
  // — upgraded from the audit's original MINOR estimate): while checking whether
  // "Avoidance" lacking a typed synonym was deliberate (per the master doc,
  // Avoidance "can only be selected by you; the bot never infers it" — already
  // stated in-message at REVIEW_Q8's render), discovered this entire map was stale:
  // every key here ('no displacement identified', 'possible unjustified
  // displacement', etc.) belonged to an old displacement-language vocabulary that
  // matches NONE of the 14 button labels actually rendered for REVIEW_Q8 today
  // (Priority error, Feasibility error, ... — see renderState_'s REVIEW_Q8 branch,
  // and the correct, current dispatch table in handleAction_ around line 2100).
  // Typing e.g. "no error identified" against the old map produced no match at
  // all, silently falling through to the generic invalid-input fallback — a real
  // functional gap for every REVIEW_Q8 option, not just a documentation question
  // about Avoidance specifically. Rebuilt against the current button labels.
  // Avoidance is deliberately still excluded here (confirmed intentional per the
  // master doc's self-identify-only rule cited above) — this is the one option
  // that should remain tap-only by design; every other option now has a typed
  // path matching its live button text. Downstream: only this actionByState entry
  // changed; handleAction_'s REVIEW_Q8 dispatch table (the actual state-transition
  // logic) was already correct and is untouched. Retesting required: confirm typed
  // text for each of the 13 non-Avoidance REVIEW_Q8 options now correctly
  // transitions the session, matching what the button already does. Date:
  // 2026-08-17.
  // IF10 bounded C08 correction: current V3 treats ordinary typed content as
  // participant-authored interpretation. Retired V2 taxonomy phrases remain typed
  // synonyms only for an explicitly versioned legacy review session. This prevents
  // a current V3 participant who happens to type e.g. "priority concern" from
  // being silently recoded into the retired taxonomy. Legacy signed button actions
  // remain supported below for stale V2 sessions.
  const q8TypedReviewVersion=String((session.payload||{}).review_instrument_version||'');
  const q8LegacyTypedMode=!!q8TypedReviewVersion&&q8TypedReviewVersion!==SCB_REVIEW_INSTRUMENT_VERSION;
  actionByState[STATES.REVIEW_Q8] = q8LegacyTypedMode
    ? (({'no error identified':'REVIEW_Q8_NONE','insufficient record':'REVIEW_Q8_INSUFFICIENT','not sure':'REVIEW_Q8_UNSURE','decline to interpret':'REVIEW_Q8_DECLINE','skip':'REVIEW_Q8_SKIP','context shift — not an error':'REVIEW_Q8_CONTEXT_SHIFT','deliberate reprioritization — not automatically an error':'REVIEW_Q8_REPRIORITIZATION','priority concern':'REVIEW_Q8_PRIORITY_CONCERN','feasibility concern':'REVIEW_Q8_FEASIBILITY_CONCERN','capacity-estimate concern':'REVIEW_Q8_CAPACITY_CONCERN','commitment conflict':'REVIEW_Q8_COMMITMENT_CONFLICT','protection difficulty':'REVIEW_Q8_PROTECTION_DIFFICULTY','environmental constraint':'REVIEW_Q8_ENVIRONMENTAL_CONSTRAINT','starting/persisting difficulty':'REVIEW_Q8_STARTING_DIFFICULTY','outcome differed from expected':'REVIEW_Q8_OUTCOME_DIFFERED'})[normalized] || '')
    : (({'no interpretation to add':'REVIEW_Q8_NO_INTERPRETATION','no interpretation':'REVIEW_Q8_NO_INTERPRETATION','not sure':'REVIEW_Q8_UNSURE','skip':'REVIEW_Q8_SKIP'})[normalized] || '');
  actionByState[STATES.REVIEW_Q9] = normalized === 'skip' ? 'REVIEW_Q9_SKIP' : '';
  actionByState[STATES.REVIEW_Q10] = normalized === 'skip' ? 'REVIEW_Q10_SKIP' : '';
  actionByState[STATES.REVIEW_Q1] = normalized === 'not sure' ? 'REVIEW_Q1_NOT_SURE' : '';
  actionByState[STATES.REVIEW_Q5_NOTE] = normalized === 'skip' ? 'REVIEW_Q5_SKIP' : '';
  actionByState[STATES.REVIEW_Q6_NOTE] = normalized === 'skip' ? 'REVIEW_Q6_SKIP_NOTE' : '';
  actionByState[STATES.REVIEW_MINIMAL] = normalized === 'close review' ? 'REVIEW_MINIMAL_CLOSE' : '';
  actionByState[STATES.REVIEW_Q10] = normalized === 'skip' ? 'REVIEW_Q10_SKIP' : '';
  actionByState[STATES.REVIEW_Q1] = normalized === 'not sure' ? 'REVIEW_Q1_NOT_SURE' : '';
  actionByState[STATES.REVIEW_Q5_NOTE] = normalized === 'skip' ? 'REVIEW_Q5_SKIP' : '';
  actionByState[STATES.REVIEW_Q6_NOTE] = normalized === 'skip' ? 'REVIEW_Q6_SKIP_NOTE' : '';
  actionByState[STATES.REVIEW_MINIMAL] = normalized === 'close review' ? 'REVIEW_MINIMAL_CLOSE' : '';

  // F33 CHANGE NOTE (Round 3, audit appendix finding, MINOR): FOCAL_SELECTION's
  // typed-text map previously had no entry for the two-candidate winner buttons
  // ('Candidate 1'/'Candidate 2' -> FOCAL_CANDIDATE1/FOCAL_CANDIDATE2), unlike
  // GATE_COMPARE's map just below (line 2600 as of this note), which already
  // handles 'candidate 1'/'candidate 2' for the analogous GATE_COMPARE_C1/C2
  // actions — that existing entry is the normalization precedent this follows
  // (plain lowercase phrase, no punctuation variants needed since there are
  // none in "candidate 1"/"candidate 2" the way there are in "can't compare").
  // Gated on session.payload.candidate_path === 'two_competing' (mirrors
  // renderState_'s own gate at line ~2946 for which buttons are shown) so
  // that in the single-candidate path — where these buttons are never
  // rendered — typing "candidate 1" is NOT accepted as valid input; a user
  // there falls through to the existing generic fallback instead of being
  // able to select a "winner" between candidates that were never compared.
  const twoCandidateFocalSelection = session.payload && session.payload.candidate_path === 'two_competing';
  // Only text aliases with real FOCAL_SELECTION receivers are dispatched.
  // Caregiving, maintenance and leisure remain ordinary candidates by the
  // rendered contract; "smaller action" belongs to the candidate gate, not this state.
  actionByState[STATES.FOCAL_SELECTION] = ({'neither':'FOCAL_NEITHER','can’t compare':'FOCAL_CANT_COMPARE','cant compare':'FOCAL_CANT_COMPARE','no signal':'FOCAL_NO_SIGNAL','recovery':'FOCAL_RECOVERY','uncertain':'FOCAL_UNCERTAIN'}[normalized])
    || (twoCandidateFocalSelection ? ({'candidate 1':'FOCAL_CANDIDATE1','candidate 2':'FOCAL_CANDIDATE2'})[normalized] : '')
    || '';
  actionByState[STATES.GATE_COMPARE] = ({'candidate 1':'GATE_COMPARE_C1','candidate 2':'GATE_COMPARE_C2','neither':'GATE_COMPARE_NEITHER','can’t compare':'GATE_COMPARE_CANT','cant compare':'GATE_COMPARE_CANT'})[normalized] || '';
  actionByState[STATES.GATE_COMMITMENT] = normalized === 'yes' ? 'GATE_COMMITMENT_YES' : normalized === 'no' ? 'GATE_COMMITMENT_NO' : (normalized === 'not sure' || normalized === 'unsure') ? 'GATE_COMMITMENT_UNSURE' : '';
  actionByState[STATES.GATE_CLAIM] = (normalized === 'no present claim' || normalized === 'no claim') ? 'GATE_CLAIM_NONE' : (normalized === 'not sure' || normalized === 'unsure') ? 'GATE_CLAIM_UNSURE' : '';
  actionByState[STATES.GATE_FEASIBILITY] = normalized === 'yes' ? 'GATE_FEASIBLE_YES' : normalized === 'no' ? 'GATE_FEASIBLE_NO' : (normalized === 'not sure' || normalized === 'unsure') ? 'GATE_FEASIBLE_UNSURE' : '';
  actionByState[STATES.CANDIDATE] = normalized === 'one' ? 'CANDIDATE_ONE' : normalized === 'two' ? 'CANDIDATE_TWO' : normalized === 'none' ? 'CANDIDATE_NONE' : (normalized === 'uncertain' || normalized === 'can’t compare' || normalized === 'cant compare') ? 'CANDIDATE_UNCERTAIN' : (normalized === 'recovery' || normalized === 'recovery / health') ? 'CANDIDATE_RECOVERY' : normalized === 'incomplete' ? 'CANDIDATE_INCOMPLETE' : '';
  const action = actionByState[session.state];
  if (action) { handleAction_(session, action, chatId); return; }
  const payload = session.payload || {};
  if (session.state === STATES.REVIEW_Q1) {
    const text = String(input || '').trim();
    if (!text) { sendTelegram_('Please describe what you actually knew at the time — or type “not sure” if you cannot assess it.', chatId); return; }
    if (isLikelyDuplicateFreeText_(payload.review_knowledge_at_choice, text)) { renderState_(session, chatId); return; }
    transitionSession_(session, STATES.REVIEW_Q2, Object.assign({}, payload, { review_knowledge_at_choice: text })); return;
  }
  if (session.state === STATES.REVIEW_Q5_NOTE) {
    const text = String(input || '').trim();
    if (!text) { sendTelegram_('Add the optional note, or tap Skip.', chatId); return; }
    if (isLikelyDuplicateFreeText_(payload.deliberate_transition_note, text)) { renderState_(session, chatId); return; }
    transitionSession_(session, STATES.REVIEW_Q6, Object.assign({}, payload, { deliberate_transition_note: text })); return;
  }
  if (session.state === STATES.REVIEW_Q6_NOTE) {
    const text = String(input || '').trim();
    if (!text) { sendTelegram_('Describe what your attention moved toward or what drew it away, or tap Skip.', chatId); return; }
    if (isLikelyDuplicateFreeText_(payload.attention_movement_description, text)) { renderState_(session, chatId); return; }
    transitionSession_(session, STATES.REVIEW_Q7, Object.assign({}, payload, { attention_movement_description: text })); return;
  }
  if (session.state === STATES.REVIEW_Q8) {
    const text=String(input||'').trim();
    if(!text){sendTelegram_('Type your optional interpretation, or choose No interpretation to add / Not sure / Skip.',chatId);return;}
    if(isLikelyDuplicateFreeText_(payload.participant_interpretation_text,text)){renderState_(session,chatId);return;}
    transitionSession_(session,STATES.REVIEW_Q9,Object.assign({},payload,{
      qualitative_interpretation:'participant_authored_text', participant_interpretation_text:text,
      participant_interpretation_user_selected:true, review_q8_instrument_version:SCB_REVIEW_INSTRUMENT_VERSION,
      review_q8_independence_class:EVIDENCE_INDEPENDENCE.I0, review_q8_outcome_knowledge:'KNOWN_BY_PARTICIPANT', review_q8_recorded_at:now_()
    })); return;
  }
  if (session.state === STATES.REVIEW_Q9) {
    const text = String(input || '').trim();
    if (!text) { sendTelegram_('Type what remains unclear, or tap Skip.', chatId); return; }
    if (isLikelyDuplicateFreeText_(payload.uncertainty, text)) { renderState_(session, chatId); return; }
    transitionSession_(session, STATES.REVIEW_LEARNING, Object.assign({}, payload, { uncertainty: text })); return;
  }
  if (session.state === STATES.REVIEW_LEARNING) {
    const text=String(input||'').trim(); if(!text){sendTelegram_('Type the optional participant-stated lesson/discrepancy, or choose No lesson / Not sure.',chatId);return;}
    recordLearningForReview_(session,LEARNING_STATUS.SPECIFIC_PARTICIPANT_STATED,text);
    transitionSession_(session,STATES.REVIEW_Q10,Object.assign({},payload,{learning_record_status:'specific_participant_stated'})); return;
  }
  if (session.state === STATES.REVIEW_Q10) {
    const text = String(input || '').trim();
    if (!text) { sendTelegram_('Type one small adjustment, or tap Skip.', chatId); return; }
    if (isLikelyDuplicateFreeText_(payload.optional_adjustment, text)) { renderState_(session, chatId); return; }
    const plan=createAdjustmentPlanFromReview_(session,text);
    transitionSession_(session, STATES.COMPLETE, Object.assign({}, payload, { optional_adjustment: text, adjustment_plan_id:plan?String(plan.row[COLS.ADJUSTMENT_PLANS.ADJUSTMENT_ID]):null })); return;
  }
  if (session.state === STATES.ADJUSTMENT_REVISE) {
    const text=String(input||'').trim(); if(!text){sendTelegram_('Type the revised adjustment, or use /adjustment-withdraw to withdraw it.',chatId);return;}
    const authorization=authorizeOrdinaryMorningBeforeMutation_(session.participantId,chatId,'ADJUSTMENT_REVISED_TEXT_TO_MORNING');
    if(!authorization.allowed) return;
    const old=adjustmentPlanById_(String(payload.adjustment_plan_id||'')); if(!old){sendTelegram_('That adjustment is no longer available. Starting today’s calibration instead.',chatId);finishAdjustmentContactAndStartMorning_(session,chatId);return;}
    const revised=createRevisedAdjustmentPlan_(old,text); const next=Object.assign({},payload,{revised_adjustment_plan_id:revised?String(revised.row[COLS.ADJUSTMENT_PLANS.ADJUSTMENT_ID]):null}); session.payload=next; finishAdjustmentContactAndStartMorning_(session,chatId); return;
  }
  if (session.state === STATES.GATE_CANDIDATE) {
    const candidate = String(input || '').trim();
    if (!candidate) { sendTelegram_('Please describe the candidate.', chatId); return; }
    const index = Number.isInteger(payload.gate_current_index) ? payload.gate_current_index : 0;
    const claims = Array.isArray(payload.other_claims) ? payload.other_claims : [];
    const existingAtIndex = claims[index];
    if (existingAtIndex && isLikelyDuplicateFreeText_(existingAtIndex.candidate, candidate)) { renderState_(session, chatId); return; }
    beginCandidateGate_(session, candidate, index); return;
  }
  if (session.state === STATES.GATE_CLAIM) {
    const claim=String(input||'').trim(); if(!claim){sendTelegram_('Please describe the present claim, or choose No present claim / Not sure.',chatId);return;}
    const cur=gateRecord_(session.payload); if(isLikelyDuplicateFreeText_(cur&&cur.present_claim,claim)){renderState_(session,chatId);return;}
    const status=normalizeClaimStatusText_(claim), next=updateGateRecord_(session.payload,{present_claim:status==='specific'?claim:null,present_claim_status:status,present_claim_attested:status==='specific'?'yes':null});
    if(status!=='specific'){finishCandidateGate_(Object.assign({},session,{payload:next}),status==='uncertain'?'present_claim_uncertain':'no_present_claim');return;}
    transitionSession_(session,STATES.GATE_COMMITMENT,next); return;
  }
  if (session.state === STATES.GATE_SMALLER_ACTION) {
    const smaller=String(input||'').trim(); if(!smaller){sendTelegram_('Please describe a meaningful smaller version of the same candidate, or tap No smaller action identified.',chatId);return;}
    const cur=gateRecord_(session.payload); if(isLikelyDuplicateFreeText_(cur&&cur.smaller_action,smaller)){renderState_(session,chatId);return;}
    const next=updateGateRecord_(session.payload,{smaller_action:smaller,smaller_action_feasible:'yes',smaller_action_same_direction_attested:'yes'}); finishCandidateGate_(Object.assign({},session,{payload:next}),'smaller_action_feasible'); return;
  }
  if (session.state === STATES.GATE_COMPARE) {
    sendTelegram_('Please choose a focal outcome above.', chatId); return;
  }
  if (session.state === STATES.FOCAL_SELECTION) {
    const note = String(input || '').trim();
    if (!note) { sendTelegram_('Please use one of the focal outcomes above.', chatId); return; }
  }
  if (session.state === STATES.PRESERVE) { sendTelegram_('Use a disposition button for the named non-focal candidate. No extra explanation is required.',chatId); return; }
  // F40 CHANGE NOTE (Section E fix pack, FIX-E4, fixes audit finding E4):
  // this generic fallback previously fired alone for two situations a user
  // cannot tell apart from the wording: (1) genuinely invalid input at the
  // state they're correctly in, or (2) they're echoing text meant for a
  // PREVIOUS state after state advancement. The current code now has a
  // bounded free-text replay marker for exact normalized cross-state replay,
  // but this generic fallback still does not infer intent from arbitrary
  // invalid text; it simply re-renders the CURRENT state's actual prompt
  // alongside the generic text, the same way
  // several isLikelyDuplicateFreeText_ branches above already do for
  // duplicate-resubmission cases. Either way the fix leaves the user able
  // to reorient without having to guess whether they made an error, instead
  // of only ever seeing the bare rejection line.
  sendTelegram_('Please use one of the buttons or answer the requested question.', chatId);
  renderState_(session, chatId);
}

function actionAllowedForState_(state, action) {
  const exact={
    REENTRY_CHOICE:['REENTRY_RESUME','REENTRY_NEW'], ADJUSTMENT_CONTACT:['ADJUSTMENT_ACCEPT','ADJUSTMENT_REVISE','ADJUSTMENT_DECLINE'], READY:['READY_START'], ACUTE:['ACUTE_YES','ACUTE_NO'], RECOVERY:['RECOVERY_YES','RECOVERY_NO'],
    REVIEW_Q1:['REVIEW_Q1_NOT_SURE'], REVIEW_Q3:['REVIEW_Q3_EXPECTED','REVIEW_Q3_LOWER','REVIEW_Q3_HIGHER','REVIEW_Q3_FLUCTUATING','REVIEW_Q3_UNSURE'], REVIEW_Q4:['REVIEW_Q4_NO','REVIEW_Q4_MINOR','REVIEW_Q4_MAJOR','REVIEW_Q4_UNSURE'], REVIEW_Q5:['REVIEW_Q5_YES','REVIEW_Q5_NO','REVIEW_Q5_UNSURE'], REVIEW_Q5_NOTE:['REVIEW_Q5_SKIP'],
    REVIEW_Q6:['REVIEW_Q6_YES','REVIEW_Q6_NO','REVIEW_Q6_NO_FOCAL','REVIEW_Q6_UNSURE','REVIEW_Q6_SKIP'], REVIEW_Q6_NOTE:['REVIEW_Q6_SKIP_NOTE'],
    REVIEW_Q7:['REVIEW_Q7_COMPLETED','REVIEW_Q7_SUBSTANTIAL','REVIEW_Q7_PARTIAL','REVIEW_Q7_NO_ATTEMPT','REVIEW_Q7_UNABLE_BLOCKED','REVIEW_Q7_UNSURE','REVIEW_Q7_NO_RECORD'],
    REVIEW_Q8:['REVIEW_Q8_NO_INTERPRETATION','REVIEW_Q8_NONE','REVIEW_Q8_INSUFFICIENT','REVIEW_Q8_UNSURE','REVIEW_Q8_DECLINE','REVIEW_Q8_SKIP','REVIEW_Q8_CONTEXT_SHIFT','REVIEW_Q8_REPRIORITIZATION','REVIEW_Q8_PRIORITY_CONCERN','REVIEW_Q8_FEASIBILITY_CONCERN','REVIEW_Q8_CAPACITY_CONCERN','REVIEW_Q8_COMMITMENT_CONFLICT','REVIEW_Q8_PROTECTION_DIFFICULTY','REVIEW_Q8_ENVIRONMENTAL_CONSTRAINT','REVIEW_Q8_AVOIDANCE','REVIEW_Q8_STARTING_DIFFICULTY','REVIEW_Q8_OUTCOME_DIFFERED'],
    REVIEW_Q9:['REVIEW_Q9_SKIP'], REVIEW_LEARNING:['REVIEW_LEARNING_NONE','REVIEW_LEARNING_UNCERTAIN'], REVIEW_Q10:['REVIEW_Q10_SKIP'], REVIEW_MINIMAL:['REVIEW_MINIMAL_CLOSE'],
    CANDIDATE:['CANDIDATE_NONE','CANDIDATE_ONE','CANDIDATE_TWO','CANDIDATE_UNCERTAIN','CANDIDATE_RECOVERY','CANDIDATE_INCOMPLETE'],
    GATE_COMMITMENT:['GATE_COMMITMENT_YES','GATE_COMMITMENT_NO','GATE_COMMITMENT_UNSURE','GATE_COMMITMENT_SKIP'], GATE_CLAIM:['GATE_CLAIM_NONE','GATE_CLAIM_UNSURE'],
    GATE_TYPE:['GATE_TYPE_HARD','GATE_TYPE_SOFT','GATE_TYPE_RENEGOTIABLE','GATE_TYPE_SELF-IMPOSED','GATE_TYPE_STALE','GATE_TYPE_URGENT-REQUEST','GATE_TYPE_PREFERENCE','GATE_TYPE_OPPORTUNITY','GATE_TYPE_UNCERTAIN'],
    GATE_FEASIBILITY:['GATE_FEASIBLE_YES','GATE_FEASIBLE_NO','GATE_FEASIBLE_UNSURE'], GATE_SMALLER_ACTION:['GATE_NO_SMALLER'],
    GATE_COMPARE:['GATE_COMPARE_C1','GATE_COMPARE_C2','GATE_COMPARE_NEITHER','GATE_COMPARE_CANT'],
    FOCAL_SELECTION:['FOCAL_CANDIDATE1','FOCAL_CANDIDATE2','FOCAL_NEITHER','FOCAL_CANT_COMPARE','FOCAL_NO_SIGNAL','FOCAL_RECOVERY','FOCAL_UNCERTAIN'],
    PRESERVE:['PRESERVE_SCHEDULED','PRESERVE_LATER','PRESERVE_ACKNOWLEDGED','PRESERVE_PROTECTED','PRESERVE_UNCERTAIN']
  };
  const key=String(state||''), a=String(action||'');
  if(exact[key] && exact[key].indexOf(a)>=0) return true;
  const prefixes={REVIEW_Q2:'REVIEW_Q2_'};
  return !!(prefixes[key] && a.indexOf(prefixes[key])===0);
}

function handleAction_(session, action, chatId) {
  if(isReviewState_(session.state) && reviewAnswerBlocked_(session)) {
    sendTelegram_('This review is preserved but is not ready to accept review answers yet. Use /review to continue recovery.',chatId);
    renderState_(session,chatId); return;
  }
  if(!actionAllowedForState_(session.state,action)){ sendTelegram_('That action is not valid for this step. Here is your current step:',chatId); renderState_(session,chatId); return; }
  if(session.state===STATES.REENTRY_CHOICE){
    const p=Object.assign({},session.payload||{}), stale=!!p.reentry_stale_day;
    if(action==='REENTRY_RESUME' && !stale){
      const target=String(p.reentry_return_state||'');
      if(!target || target===STATES.REENTRY_CHOICE){sendTelegram_('That session cannot be resumed safely. Start a new session instead.',chatId);return;}
      delete p.reentry_return_state; delete p.reentry_return_version; delete p.reentry_stale_day;
      p.reentry_resumed_at=now_(); appendEvent_(session.participantId,session.sessionId,'SESSION_RESUMED',{toState:target});
      transitionSession_(session,target,p); return;
    }
    if(action==='REENTRY_NEW'){
      const authorization=authorizeOrdinaryMorningBeforeMutation_(session.participantId,chatId,'REENTRY_NEW');
      if(!authorization.allowed){ renderState_(session,chatId); return; }
      if(!interruptSession_(session,stale?'STALE_LOCAL_DAY':'USER_STARTED_NEW')){sendTelegram_('The unfinished session could not be safely closed. A new session was not started.',chatId);return;}
      const fresh=createSession_(session.participantId,STATES.READY,'START_COMMAND',chatId); renderState_(fresh,chatId); return;
    }
  }
  if(session.state===STATES.ADJUSTMENT_CONTACT){
    const rec=adjustmentPlanById_(String((session.payload||{}).adjustment_plan_id||''));
    if(action==='ADJUSTMENT_ACCEPT'){
      const authorization=authorizeOrdinaryMorningBeforeMutation_(session.participantId,chatId,'ADJUSTMENT_ACCEPT_TO_MORNING'); if(!authorization.allowed) return;
      if(rec)setAdjustmentPlanStatus_(rec,ADJUSTMENT_STATUS.ACCEPTED,{response:'accepted',respondedAt:now_()}); finishAdjustmentContactAndStartMorning_(session,chatId); return;
    }
    if(action==='ADJUSTMENT_DECLINE'){
      const authorization=authorizeOrdinaryMorningBeforeMutation_(session.participantId,chatId,'ADJUSTMENT_DECLINE_TO_MORNING'); if(!authorization.allowed) return;
      if(rec)setAdjustmentPlanStatus_(rec,ADJUSTMENT_STATUS.DECLINED,{response:'declined',respondedAt:now_()}); finishAdjustmentContactAndStartMorning_(session,chatId); return;
    }
    if(action==='ADJUSTMENT_REVISE'){
      const authorization=authorizeOrdinaryMorningBeforeMutation_(session.participantId,chatId,'ADJUSTMENT_REVISE_TO_MORNING'); if(!authorization.allowed) return;
      transitionSession_(session,STATES.ADJUSTMENT_REVISE,session.payload||{}); return;
    }
  }
  if (session.state === STATES.READY && action === 'READY_START') { transitionSession_(session, STATES.ACUTE); return; }
  if (session.state === STATES.ACUTE && action === 'ACUTE_YES') { suspendActiveInterventionsForSafety_(session.participantId,'ACUTE_CRISIS_PROTOCOL_STATE'); safetyExitTransferMode_(session.participantId); transitionSession_(session, STATES.ACUTE_EXIT, Object.assign({}, session.payload, { acute_exit: 'yes' })); return; }
  if (session.state === STATES.ACUTE && action === 'ACUTE_NO') { transitionSession_(session, STATES.RECOVERY); return; }
  if (session.state === STATES.RECOVERY && action === 'RECOVERY_YES') { recordRecoveryProtectedState_(session.participantId); transitionSession_(session, STATES.RECOVERY_EXIT, Object.assign({}, session.payload, { recovery_state: 'recovery' })); return; }
  if (session.state === STATES.RECOVERY && action === 'RECOVERY_NO') { transitionSession_(session, STATES.CANDIDATE); return; }

  if (session.state === STATES.REVIEW_Q1 && action === 'REVIEW_Q1_NOT_SURE') { transitionSession_(session, STATES.REVIEW_Q2, Object.assign({}, session.payload, { review_knowledge_at_choice: 'not_sure' })); return; }
  if (session.state === STATES.REVIEW_Q5_NOTE && action === 'REVIEW_Q5_SKIP') { transitionSession_(session, STATES.REVIEW_Q6, Object.assign({}, session.payload, { deliberate_transition_note: null })); return; }
  if (session.state === STATES.REVIEW_Q6_NOTE && action === 'REVIEW_Q6_SKIP_NOTE') { transitionSession_(session, STATES.REVIEW_Q7, Object.assign({}, session.payload, { attention_movement_description: null })); return; }
  if (session.state === STATES.REVIEW_MINIMAL && action === 'REVIEW_MINIMAL_CLOSE') { transitionSession_(session, STATES.COMPLETE, session.payload); return; }
  if (session.state === STATES.REVIEW_Q2 && action.indexOf('REVIEW_Q2_') === 0) {
    const map = {REVIEW_Q2_REASONABLE:'reasonable_given_what_was_known', REVIEW_Q2_QUESTIONABLE:'questionable_given_what_was_known', REVIEW_Q2_CANT:'cant_assess', REVIEW_Q2_UNSURE:'not_sure', REVIEW_Q2_SKIP:'skipped'};
    if(!Object.prototype.hasOwnProperty.call(map,action)){sendTelegram_('That action is not valid for this step.',chatId);renderState_(session,chatId);return;}
    transitionSession_(session, STATES.REVIEW_Q3, Object.assign({}, session.payload, { evening_decision_quality: map[action], review_q2_instrument_version:SCB_REVIEW_INSTRUMENT_VERSION, review_q2_independence_class:EVIDENCE_INDEPENDENCE.I0, review_q2_outcome_knowledge:'KNOWN_BY_PARTICIPANT', review_q2_recorded_at:now_() })); return;
  }
  if (session.state === STATES.REVIEW_Q3 && action.indexOf('REVIEW_Q3_') === 0) {
    const map = {REVIEW_Q3_EXPECTED:'as_expected', REVIEW_Q3_LOWER:'lower', REVIEW_Q3_HIGHER:'higher', REVIEW_Q3_FLUCTUATING:'fluctuating', REVIEW_Q3_UNSURE:'not_sure'};
    if(!Object.prototype.hasOwnProperty.call(map,action)){sendTelegram_('That action is not valid for this step.',chatId);renderState_(session,chatId);return;}
    transitionSession_(session, STATES.REVIEW_Q4, Object.assign({}, session.payload, { capacity_description: map[action] })); return;
  }
  if (session.state === STATES.REVIEW_Q4 && action.indexOf('REVIEW_Q4_') === 0) {
    const map = {REVIEW_Q4_NO:'no', REVIEW_Q4_MINOR:'minor_change', REVIEW_Q4_MAJOR:'major_change', REVIEW_Q4_UNSURE:'not_sure'};
    if(!Object.prototype.hasOwnProperty.call(map,action)){sendTelegram_('That action is not valid for this step.',chatId);renderState_(session,chatId);return;}
    transitionSession_(session, STATES.REVIEW_Q5, Object.assign({}, session.payload, { context_change: map[action] })); return;
  }
  if (session.state === STATES.REVIEW_Q5) {
    if (action === 'REVIEW_Q5_YES') { transitionSession_(session, STATES.REVIEW_Q5_NOTE, Object.assign({}, session.payload, { deliberate_transition: 'yes' })); return; }
    const value = action === 'REVIEW_Q5_NO' ? 'no' : 'not_sure';
    transitionSession_(session, STATES.REVIEW_Q6, Object.assign({}, session.payload, { deliberate_transition: value })); return;
  }
  if (session.state === STATES.REVIEW_Q6) {
    if (action === 'REVIEW_Q6_YES') { transitionSession_(session, STATES.REVIEW_Q6_NOTE, Object.assign({}, session.payload, { attention_moved_away: 'yes' })); return; }
    const map = {REVIEW_Q6_NO:'no', REVIEW_Q6_NO_FOCAL:'no_focal_signal', REVIEW_Q6_UNSURE:'not_sure', REVIEW_Q6_SKIP:'skipped'};
    transitionSession_(session, STATES.REVIEW_Q7, Object.assign({}, session.payload, { attention_moved_away: map[action] })); return;
  }
  if (session.state === STATES.REVIEW_Q7) {
    const map = {REVIEW_Q7_COMPLETED:'completed', REVIEW_Q7_SUBSTANTIAL:'substantial_progress', REVIEW_Q7_PARTIAL:'partial_progress', REVIEW_Q7_NO_ATTEMPT:'no_attempt', REVIEW_Q7_UNABLE_BLOCKED:'unable_or_blocked_from_acting', REVIEW_Q7_UNSURE:'not_sure', REVIEW_Q7_NO_RECORD:'no_usable_record'};
    transitionSession_(session, STATES.REVIEW_Q8, Object.assign({}, session.payload, { outcome_description: map[action] })); return;
  }
  if (session.state === STATES.REVIEW_Q8) {
    // IF10 bounded C08 correction: retired taxonomy actions are accepted only for
    // explicitly versioned legacy review sessions. A current/unversioned V3
    // session cannot be silently put back onto the retired taxonomy contract.
    const q8ReviewVersion=String((session.payload||{}).review_instrument_version||'');
    const q8CurrentV3=!q8ReviewVersion||q8ReviewVersion===SCB_REVIEW_INSTRUMENT_VERSION;
    const q8V3Actions=['REVIEW_Q8_NO_INTERPRETATION','REVIEW_Q8_UNSURE','REVIEW_Q8_SKIP'];
    if(q8CurrentV3&&q8V3Actions.indexOf(action)<0){sendTelegram_('That interpretation option belongs to an older review version. Please use the current optional interpretation step.',chatId);renderState_(session,chatId);return;}
    const map = {
      REVIEW_Q8_NO_INTERPRETATION:'no_interpretation_added',
      REVIEW_Q8_NONE:'no_error_identified',
      REVIEW_Q8_INSUFFICIENT:'insufficient_record',
      REVIEW_Q8_UNSURE:'not_sure',
      REVIEW_Q8_DECLINE:'decline_to_interpret',
      REVIEW_Q8_SKIP:'skipped',
      REVIEW_Q8_CONTEXT_SHIFT:'context_shift_not_error',
      REVIEW_Q8_REPRIORITIZATION:'deliberate_reprioritization_not_automatically_error',
      REVIEW_Q8_PRIORITY_CONCERN:'priority_concern',
      REVIEW_Q8_FEASIBILITY_CONCERN:'feasibility_concern',
      REVIEW_Q8_CAPACITY_CONCERN:'capacity_estimate_concern',
      REVIEW_Q8_COMMITMENT_CONFLICT:'commitment_conflict',
      REVIEW_Q8_PROTECTION_DIFFICULTY:'protection_difficulty',
      REVIEW_Q8_ENVIRONMENTAL_CONSTRAINT:'environmental_constraint',
      REVIEW_Q8_AVOIDANCE:'avoidance_user_selected',
      REVIEW_Q8_STARTING_DIFFICULTY:'starting_persisting_difficulty',
      REVIEW_Q8_OUTCOME_DIFFERED:'outcome_differed_from_expected'
    };
    transitionSession_(session, STATES.REVIEW_Q9, Object.assign({}, session.payload, {
      qualitative_interpretation: map[action],
      participant_interpretation_user_selected: true,
      review_q8_instrument_version:SCB_REVIEW_INSTRUMENT_VERSION,
      review_q8_independence_class:EVIDENCE_INDEPENDENCE.I0,
      review_q8_outcome_knowledge:'KNOWN_BY_PARTICIPANT',
      review_q8_recorded_at:now_()
    }));
    return;
  }
  if (session.state === STATES.REVIEW_Q9) {
    if (action === 'REVIEW_Q9_SKIP') { transitionSession_(session, STATES.REVIEW_LEARNING, Object.assign({}, session.payload, { uncertainty: null })); return; }
  }
  if(session.state===STATES.REVIEW_LEARNING){
    if(action==='REVIEW_LEARNING_NONE'){recordLearningForReview_(session,LEARNING_STATUS.NO_LESSON,'');transitionSession_(session,STATES.REVIEW_Q10,Object.assign({},session.payload,{learning_record_status:'no_lesson'}));return;}
    if(action==='REVIEW_LEARNING_UNCERTAIN'){recordLearningForReview_(session,LEARNING_STATUS.UNCERTAIN,'');transitionSession_(session,STATES.REVIEW_Q10,Object.assign({},session.payload,{learning_record_status:'uncertain'}));return;}
  }
  if (session.state === STATES.REVIEW_Q10 && action === 'REVIEW_Q10_SKIP') {
    transitionSession_(session, STATES.COMPLETE, Object.assign({}, session.payload, { optional_adjustment: null })); return;
  }
  if (session.state === STATES.CANDIDATE) {
    let base=Object.assign({},session.payload,{morning_state:action.replace('CANDIDATE_','').toLowerCase()});
    if(action==='CANDIDATE_ONE'){base.candidate_path='one_candidate';transitionSession_(session,STATES.GATE_CANDIDATE,Object.assign(base,{gate_current_index:0}));return;}
    if(action==='CANDIDATE_TWO'){base.candidate_path='two_competing';transitionSession_(session,STATES.GATE_CANDIDATE,Object.assign(base,{gate_current_index:0}));return;}
    if(action==='CANDIDATE_NONE')base=setDailyFocus_(base,DAILY_FOCUS_STATE.VALID_NO_SIGNAL,'No Signal');
    else if(action==='CANDIDATE_UNCERTAIN')base=setDailyFocus_(base,DAILY_FOCUS_STATE.VALID_UNCERTAIN_OR_CANNOT_COMPARE,'Uncertain / cannot compare');
    else if(action==='CANDIDATE_RECOVERY')base=setDailyFocus_(base,DAILY_FOCUS_STATE.PROTECTED_RECOVERY_HEALTH,'Recovery / Health');
    else if(action==='CANDIDATE_INCOMPLETE')base=setDailyFocus_(base,DAILY_FOCUS_STATE.INCOMPLETE,'Incomplete morning'); else base=null;
    if(base){base.focal_signal=null;transitionSession_(session,STATES.COMPLETE,base);return;}
  }

  if(session.state===STATES.GATE_COMMITMENT&&(action==='GATE_COMMITMENT_YES'||action==='GATE_COMMITMENT_NO'||action==='GATE_COMMITMENT_UNSURE'||action==='GATE_COMMITMENT_SKIP')){
    const skipped=action==='GATE_COMMITMENT_SKIP';
    const accepted=skipped?null:(action==='GATE_COMMITMENT_YES'?'yes':action==='GATE_COMMITMENT_NO'?'no':'not_sure');
    transitionSession_(session,STATES.GATE_FEASIBILITY,updateGateRecord_(session.payload,{accepted_commitment:accepted,accepted_commitment_skipped:skipped}));return;
  }
  if(session.state===STATES.GATE_TYPE&&action.indexOf('GATE_TYPE_')===0){const claimType=action.substring('GATE_TYPE_'.length).toLowerCase();transitionSession_(session,STATES.GATE_CLAIM,updateGateRecord_(session.payload,{claim_type:claimType,commitment_type:['hard','soft','renegotiable','self-imposed','stale'].indexOf(claimType)>=0?claimType:null}));return;}
  if(session.state===STATES.GATE_CLAIM&&(action==='GATE_CLAIM_NONE'||action==='GATE_CLAIM_UNSURE')){const status=action==='GATE_CLAIM_UNSURE'?'uncertain':'absent',next=updateGateRecord_(session.payload,{present_claim:null,present_claim_status:status,present_claim_attested:null});finishCandidateGate_(Object.assign({},session,{payload:next}),status==='uncertain'?'present_claim_uncertain':'no_present_claim');return;}
  if(session.state===STATES.GATE_FEASIBILITY&&action==='GATE_FEASIBLE_YES'){const next=updateGateRecord_(session.payload,{feasible_today:'yes'});finishCandidateGate_(Object.assign({},session,{payload:next}),'feasible_as_stated');return;}
  if(session.state===STATES.GATE_FEASIBILITY&&action==='GATE_FEASIBLE_NO'){transitionSession_(session,STATES.GATE_SMALLER_ACTION,updateGateRecord_(session.payload,{feasible_today:'no'}));return;}
  if(session.state===STATES.GATE_FEASIBILITY&&action==='GATE_FEASIBLE_UNSURE'){transitionSession_(session,STATES.GATE_SMALLER_ACTION,updateGateRecord_(session.payload,{feasible_today:'not_sure'}));return;}
  if(session.state===STATES.GATE_SMALLER_ACTION&&action==='GATE_NO_SMALLER'){const next=updateGateRecord_(session.payload,{smaller_action:null,smaller_action_feasible:'no',smaller_action_same_direction_attested:null});finishCandidateGate_(Object.assign({},session,{payload:next}),'no_smaller_action');return;}

  if(session.state===STATES.GATE_COMPARE){const payload=Object.assign({},session.payload||{});if(action==='GATE_COMPARE_C1'||action==='GATE_COMPARE_C2'){payload.comparison_status='resolved';payload.comparison_winner_index=action==='GATE_COMPARE_C1'?0:1;}else if(action==='GATE_COMPARE_NEITHER'){payload.comparison_status='neither';payload.comparison_winner_index=null;}else{payload.comparison_status='cant_compare';payload.comparison_winner_index=null;}payload.comparison_resolved=action;transitionSession_(session,STATES.FOCAL_SELECTION,payload);return;}
  if(session.state===STATES.FOCAL_SELECTION){let payload=Object.assign({},session.payload||{});const claims=Array.isArray(payload.other_claims)?payload.other_claims:[];
    if(action==='FOCAL_CANDIDATE1'||action==='FOCAL_CANDIDATE2'){const idx=action==='FOCAL_CANDIDATE1'?0:1,rec=claims[idx];if(!candidateQualifies_(rec)){sendTelegram_('That candidate does not meet the qualifying Signal rule as recorded.',chatId);renderState_(session,chatId);return;}if(payload.candidate_path==='two_competing'&&!comparisonAllowsFocalSelection_(payload)){sendTelegram_('A claim-based focal Signal is selected only when comparison resolves or when only one candidate independently qualifies. Non-resolution remains valid.',chatId);renderState_(session,chatId);return;}const winner=Number.isInteger(payload.comparison_winner_index)?payload.comparison_winner_index:null;payload=setDailyFocus_(payload,DAILY_FOCUS_STATE.CLAIM_SIGNAL,qualifyingSignalText_(rec));payload.focal_candidate_index=idx;payload.focal_signal=qualifyingSignalText_(rec);payload.focal_smaller_action=rec.feasible_today==='yes'?null:String(rec.smaller_action||'');payload.focal_selection='candidate_'+(idx+1);const relation=payload.comparison_status==='not_required_single_qualifier'?'single_qualifier_no_comparison':(winner!==null&&winner!==idx)?'reversal':'aligned';payload.final_selection_link={selected_candidate_index:idx,comparison_status:payload.comparison_status||'single_candidate',comparison_winner_index:winner,relation:relation,existing_reason_link:{present_claim:rec.present_claim||null,feasible_today:rec.feasible_today||null,smaller_action:rec.smaller_action||null,gate_result:rec.gate_result||null}};preparePreserve_(session,payload);return;}
    if(action==='FOCAL_RECOVERY'){payload=setDailyFocus_(payload,DAILY_FOCUS_STATE.PROTECTED_RECOVERY_HEALTH,'Recovery / Health');payload.focal_signal=null;payload.focal_selection='recovery_health';preparePreserve_(session,payload);return;}
    if(action==='FOCAL_UNCERTAIN'||action==='FOCAL_CANT_COMPARE'){payload=setDailyFocus_(payload,DAILY_FOCUS_STATE.VALID_UNCERTAIN_OR_CANNOT_COMPARE,'Uncertain / cannot compare');payload.focal_signal=null;payload.focal_selection='uncertain_or_cannot_compare';preparePreserve_(session,payload);return;}
    if(action==='FOCAL_NEITHER'||action==='FOCAL_NO_SIGNAL'){payload=setDailyFocus_(payload,DAILY_FOCUS_STATE.VALID_NO_SIGNAL,'No Signal');payload.focal_signal=null;payload.focal_selection='no_signal';preparePreserve_(session,payload);return;}
  }
  if(session.state===STATES.PRESERVE&&action.indexOf('PRESERVE_')===0){let payload=Object.assign({},session.payload||{});const current=currentPreserveCandidate_(payload);if(!current){completeWithNewSignal_(session,payload);return;}let route=action.substring('PRESERVE_'.length).toLowerCase();if(route==='caregiving_health_maintenance')route='protected';payload=appendDispositionHistory_(session,payload,current.index,route);payload.preserve_position=current.position+1;if(currentPreserveCandidate_(payload))transitionSession_(session,STATES.PRESERVE,payload);else completeWithNewSignal_(session,payload);return;}
  if (session.state === STATES.GATE_CANDIDATE && action.indexOf('GATE_CANDIDATE_') === 0) return;
  sendTelegram_('That button is no longer valid — here’s your current step:', chatId);
  renderState_(session, chatId);
}

// F30: the only function that appends to SignalHistory. Called from the one
// real PRESERVE exit path that reaches COMPLETE — handleAction_'s PRESERVE_*
// (routing-button) branch — at the point a session is about to leave
// PRESERVE for COMPLETE with a focal Signal actually selected. As of F31,
// handleStateInput_'s free-text PRESERVE branch no longer exits PRESERVE on
// its own (typed text now captures payload.preserve_note and re-renders
// PRESERVE's routing buttons rather than transitioning to COMPLETE — see the
// F31 change-control note), so a routing-button tap is the only path that
// reaches this function; free text alone never does. Deliberately NOT called
// for the FOCAL_NEITHER/FOCAL_CANT_COMPARE/FOCAL_NO_SIGNAL/FOCAL_UNCERTAIN
// branches, which bypass PRESERVE entirely and set focal_signal to null by
// design — those are legitimate "no Signal today" completions per §9 Step
// 5's escape paths, not a missing-input error, so they must not be routed
// through this function's guard below.
//
// The guard below applies only to CLAIM_SIGNAL: a qualifying claim-derived
// focal signal must resolve to non-empty text before SignalHistory is written.
// Non-claim focus states clear focal_signal and complete without SignalHistory.
function completeWithNewSignal_(session, payload) {
  payload=Object.assign({},payload||{});
  const signal=String(payload.focal_signal||'').trim(), isClaimSignal=payload.daily_focus_state===DAILY_FOCUS_STATE.CLAIM_SIGNAL;
  if(isClaimSignal&&!signal){sendTelegram_('The qualifying focal Signal could not be resolved from the recorded candidate. Please restart this morning flow.',resolveDeliveryChatId_(session.participantId));return;}
  if(!isClaimSignal){payload.focal_signal=null;transitionSession_(session,STATES.COMPLETE,payload);return;}

  if (!hasSignalForSession_(session.sessionId)) {
    // F42 CHANGE-CONTROL (Round 5, FIX-1, closes Round 4 Finding 2 —
    // BLOCKER, data-segregation half): previously hardcoded STATES.PRESERVE
    // here regardless of session origin, so a completed /gate walkthrough
    // was written into SignalHistory indistinguishably from a real /start
    // session — SOURCE_STATE existed as a column but never actually varied.
    // Now records the session's real payload.source_state (set once at
    // createSession_ time — 'F2_GATE_TEST' for /gate, 'START_COMMAND' for
    // /start — and never overwritten afterward, so it reflects true origin
    // at completion time). Combined with FIX-1's access-restriction half
    // (isTesterParticipant_) as defense in depth: even if the allowlist is
    // ever misconfigured, a /gate-origin row remains programmatically
    // filterable rather than silently indistinguishable from real data.
    // F48 CORRECTION (Round 5, Section G fix pack, fixes audit finding G4):
    // this note previously said "exportParticipantData_ is NOT changed by
    // this note" — that was wrong. exportParticipantData_ WAS changed by
    // the same F42 fix (its HEADERS-row addition, documented at its own
    // call site rather than cross-referenced here), which is what makes
    // SOURCE_STATE actually filterable by name in an export, not just
    // written correctly here on the write side. G4 traced both halves
    // (this write site and exportParticipantData_'s read/export site) and
    // confirmed both work as F42's top-level note (near end of file)
    // claims; only this inline pointer was stale. Comment-only, no
    // retesting required — the underlying behavior this note describes was
    // already correct and already covered by F42's own retest.
    const sourceState = session.payload && session.payload.source_state ? session.payload.source_state : STATES.PRESERVE;
    storageAppendRow_(getSignalHistorySheet_(), [session.participantId, signal, now_(), session.sessionId, sourceState, operationId_(), String(session.runRef || activeRunRef_())], 'signal_history_append');
    appendEvent_(session.participantId, session.sessionId, 'SIGNAL_SET', {
      sourceState: sourceState
    });
  }
  transitionSession_(session, STATES.COMPLETE, payload);
}

function hasSignalForSession_(sessionId) {
  return readRows_(getSignalHistorySheet_()).some(row =>
    String(row[COLS.SIGNAL_HISTORY.SESSION_ID]) === String(sessionId)
  );
}

// Returns the boolean result of the underlying sendTelegram_ call for every branch
// (or `false` from the final fallback if no branch matched session.state), so callers
// that invoke this synchronously can react to a failed send instead of the prior
// behavior where the result was always discarded — see Round 1.2. An earlier revision
// of this comment described a "REVIEW defensive-redirect branch" that returned
// transitionSession_'s own render result instead of sending anything itself; no such
// branch exists anywhere in this function (confirmed by reading every branch below,
// surfaced while implementing F-B5) — every branch calls sendTelegram_ directly, with
// no exceptions. This appears to be the same removed defensive-fallback feature F13
// already flagged as absent from the header; this was the one remaining place the
// stale description survived.
// F64 CHANGE-CONTROL — Direct precision fixes (Accessibility fix, Phase 5). Date: 2026-08-19.
// (1) WHAT CHANGED: added short inline definitions to the nine non-REVIEW_Q8
// jargon-cluster render paths: GATE_COMMITMENT, GATE_CLAIM, GATE_FEASIBILITY,
// GATE_SMALLER_ACTION, GATE_COMPARE, FOCAL_SELECTION, PRESERVE, REVIEW_Q2,
// and REVIEW_Q6. REVIEW_Q8 is intentionally unchanged.
// (2) WHY THE PRIOR STATE WAS INSUFFICIENT: F63 made /explain discoverable, but
// users should not need a second command for short, high-value definitions when
// those definitions can fit directly in the operational message.
// (3) EVIDENCE MOTIVATING THE CHANGE: Phase 0.5's locked table identified the
// nine runtime cluster states. F-F1b/F3b already established REVIEW_Q8 as
// length-sensitive; it already contains five selective inline definitions, and
// adding the remaining option definitions would materially lengthen the screen.
// No participant/usability data is claimed.
// (4) DOWNSTREAM COMPONENTS AFFECTED: render copy only. No button IDs, payload
// fields, transitions, state definitions, schema, or /explain behavior changed.
// REVIEW_Q8 remains unchanged to preserve its established mobile-scanability
// ceiling; ACUTE/RECOVERY/consent and all other excluded states remain untouched.
// (5) RETESTING REQUIRED: yes — each modified render path must be exercised,
// including dynamic GATE_COMPARE/PRESERVE renders, and REVIEW_Q8 must be
// confirmed byte-for-byte unchanged in operational content.
//
// F63 CHANGE-CONTROL — Discovery footer (Accessibility fix, Phase 4).
// (1) WHAT CHANGED: appended the fixed discovery line "New term here? Send
// /explain to see what these mean." to every render of the nine states
// represented in EXPLAIN_CONTENT: GATE_COMMITMENT, GATE_CLAIM,
// GATE_FEASIBILITY, GATE_SMALLER_ACTION, GATE_COMPARE, FOCAL_SELECTION,
// PRESERVE, REVIEW_Q2, and REVIEW_Q6.
// (2) WHY THE PRIOR STATE WAS INSUFFICIENT: F62 made /explain available,
// but a participant could not discover that command unless they already knew
// it existed. The footer provides a low-burden, on-demand discovery path.
// (3) EVIDENCE MOTIVATING IT: Phase 0.5's reconstructed table was verified
// against the live F62 render strings; it contains nine actual cluster states,
// including REVIEW_Q6. The runtime source of truth is therefore 9 states;
// no participant/usability data is claimed.
// (4) DOWNSTREAM COMPONENTS AFFECTED: render copy only. The footer is emitted
// on every render of each cluster state, so no exposure flag, column, schema,
// or persistent tracking is introduced. ACUTE, ACUTE_EXIT, RECOVERY,
// RECOVERY_EXIT, consent, CANDIDATE, GATE_TYPE, REVIEW_Q8, and other states
// remain unchanged and receive no footer.
// (5) RETESTING REQUIRED: yes — verify all nine cluster-state renders include
// the footer on repeated renders, excluded states do not, and /explain still
// resolves correctly with the footer present. No state transition, payload,
// or /explain logic is changed by this fix.
// Date: 2026-08-19.
function renderState_(session, explicitChatId) {
  const chatId=resolveDeliveryChatId_(session.participantId,explicitChatId);
  const context={owner:'SESSION',participantId:String(session.participantId),sessionId:String(session.sessionId),state:String(session.state),stateVersion:Number(session.stateVersion),chatId:String(chatId),rowNumber:Number(session.rowNumber),session:session};
  return withPromptOwnerContext_(context,function(){ return renderStateInner_(session,explicitChatId); });
}
// Offline UX experiment: read-only, conservative recap of recorded morning outcome.
// No state transitions, persistence, qualification checks, or additional sends.
function formatMorningCompleteUX_(payload) {
  const fallback='Morning calibration complete. Later today, use /review when you’re ready to review this morning decision episode.';
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return fallback;
  const state=payload.daily_focus_state;
  const prefix='Morning calibration complete.\n\n';
  const review='\n\nLater today, use /review when you’re ready to review this morning decision episode.';
  let detail='';
  if (state === DAILY_FOCUS_STATE.CLAIM_SIGNAL) {
    if (typeof payload.focal_signal !== 'string') return fallback;
    const focus=payload.focal_signal.trim();
    // Avoid blank or control-character-bearing free text; do not rephrase or truncate.
    if (!focus || /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/.test(focus)) return fallback;
    detail='Recorded focus for today:\n<b>'+escapeHtml_(focus)+'</b>';
  } else if (state === DAILY_FOCUS_STATE.VALID_NO_SIGNAL || state === DAILY_FOCUS_STATE.VALID_UNCERTAIN_OR_CANNOT_COMPARE) {
    // An inconsistent nonclaim state with a purported focus must not be recapped.
    if (payload.focal_signal != null &&
        !(typeof payload.focal_signal === 'string' && payload.focal_signal.trim() === '')) return fallback;
    detail=state === DAILY_FOCUS_STATE.VALID_NO_SIGNAL
      ? 'Recorded focus state: No Signal.'
      : 'Recorded focus state: Uncertain / cannot compare.';
  } else {
    // Protected Recovery/Health, incomplete, acute, unknown and historical states.
    return fallback;
  }
  const message=prefix+detail+review;
  // Well below the existing 3800-character Telegram HTML-to-plain splitting point.
  return message.length <= 600 ? message : fallback;
}

function renderStateInner_(session, explicitChatId) {

  currentRenderSessionBinding_=sessionCallbackTag_(session && session.sessionId);
  const chatId = resolveDeliveryChatId_(session.participantId, explicitChatId);
  const version = session.stateVersion;
  if(session.state===STATES.REVIEW_PAUSED) {
    const h=cloneReviewPauseHistory_(session.payload), last=h.length?h[h.length-1]:null, kind=last?String(last.kind||''):'';
    const base=kind===REVIEW_SAFETY_KIND.ACUTE?'Get help now if you need it.':kind===REVIEW_SAFETY_KIND.RECOVERY?'Rest now.':'A safety interruption is active.';
    return sendTelegram_(base+' Your review is preserved. No review answer will be recorded while it is paused. When you are ready, use /review to resume the same review.',chatId);
  }
  if (session.state === STATES.REENTRY_CHOICE) {
    const stale=!!(session.payload&&session.payload.reentry_stale_day);
    const msg=stale ? 'Your earlier session is from a previous local day, so it cannot be resumed. Start a new session when you are ready.' : 'You already have an unfinished session. Resume it, or start a new session. Restarting is not a failure or penalty.';
    const kb=stale ? [[button_('Start new', 'REENTRY_NEW', version)]] : [[button_('Resume', 'REENTRY_RESUME', version),button_('Start new','REENTRY_NEW',version)]];
    return sendTelegram_(msg,chatId,kb);
  }
  if (session.state === STATES.READY) { const prior = getLatestMorningSignalContext_(session.participantId); const context = prior ? '\n\nMost recent focal Signal (context only): <b>' + escapeHtml_(String(prior.signalText || '')) + '</b>\nYou will re-derive today’s focal Signal through the full morning gate; the previous choice does not carry forward automatically.' : ''; return sendTelegram_('Good morning. Ready to start the calibration?' + context, chatId, [[button_('Start', 'READY_START', version)]]); }
  // F-F6a CHANGE NOTE (Section F fix pack, F-F6a, fixes audit finding F6-1, MINOR):
  // ACUTE and RECOVERY are the only two judgment points in the entire flow with no
  // "not sure"/"uncertain" option — every other decision point (GATE_COMMITMENT,
  // GATE_FEASIBILITY, GATE_COMPARE, FOCAL_SELECTION, PRESERVE, CANDIDATE, and all
  // REVIEW_Q states) offers one, consistent with the master doc's "account for
  // uncertainty and genuinely unexpected events" design principle. This was
  // previously undocumented as intentional, risking a future editor "fixing" it
  // into a false inconsistency by adding a third option here. Documenting now:
  // this is a DELIBERATE, safety-critical exception, not an oversight. Both ACUTE
  // and RECOVERY gate a same-day exit from the entire calibration flow (see
  // ACUTE_EXIT/RECOVERY_EXIT below) for urgent medical/safety/crisis attention or
  // rest/health as the day's main focus — a genuinely uncertain middle option
  // would blur a decision that needs to resolve cleanly and immediately in the
  // moment, unlike the reflective/retrospective judgments elsewhere in the flow
  // where "not sure" is the epistemically honest answer. If either of these ever
  // needs a third option, treat that as a real behavior change requiring the
  // master doc's change-control disclosure (what's changing, why insufficient,
  // what evidence motivates it), not a quiet copy edit. Comment-only; no behavior
  // change. Date: 2026-08-17.
  if (session.state === STATES.ACUTE) return sendTelegram_('Is there anything right now that needs urgent medical, safety, or crisis attention — for you or someone you’re responsible for?', chatId, [[button_('Yes — exit now', 'ACUTE_YES', version), button_('No — continue', 'ACUTE_NO', version)]]);
  if (session.state === STATES.ACUTE_EXIT) return sendTelegram_('Get help now. This session is closed; no further reply is required. When it is safe, you can return with /start or use /recovery.', chatId);
  if (session.state === STATES.RECOVERY) return sendTelegram_('Is rest or health your main focus today?', chatId, [[button_('Yes — Recovery/Health', 'RECOVERY_YES', version), button_('No — continue', 'RECOVERY_NO', version)]]);
  if (session.state === STATES.RECOVERY_EXIT) return sendTelegram_('Rest now. This session is closed; no further reply is required. When you are ready, you can return with /start.', chatId);
  // F-F1a CHANGE NOTE (Section F fix pack, F-F1a, fixes audit finding F1-1, MAJOR):
  // "Signal"/"focal Signal" was used throughout READY, CANDIDATE, FOCAL_SELECTION,
  // PRESERVE, and all REVIEW_Q states with no in-bot definition anywhere — the term
  // was only defined in the master doc, never surfaced to the user. READY's own
  // gloss line only renders when getLatestSignal_ returns a prior signal, so a true
  // first-time user (no session history) never sees it there either, meaning CANDIDATE
  // was the actual first unconditional encounter point. Added a single short
  // parenthetical here, once, rather than repeating it at every later occurrence
  // (READY/FOCAL_SELECTION/PRESERVE/REVIEW_Q*), since repeating it would itself
  // violate the master doc's "avoid excessive journaling / avoid turning the form
  // into Noise" design principles. Wording adapted from the master doc's SIGNAL
  // section ("a deliberate focal choice with a justified present claim on
  // attention... not automatically urgent or difficult") rather than pasted
  // verbatim. Downstream: no payload/state-machine change, string-only. No
  // retesting required beyond re-running audit prompt F1 against this state.
  // Date: 2026-08-17.
  if (session.state === STATES.CANDIDATE) return sendTelegram_('What best describes today? These are equal-status outcomes; none is a success score. If caregiving, maintenance, or leisure has a claim on today, enter it as an ordinary candidate rather than treating the activity label itself as protected or as Noise.', chatId, [[button_('One candidate','CANDIDATE_ONE',version),button_('Two competing candidates','CANDIDATE_TWO',version)],[button_('No clear Signal','CANDIDATE_NONE',version),button_('Uncertain / can’t compare','CANDIDATE_UNCERTAIN',version)],[button_('Recovery / Health','CANDIDATE_RECOVERY',version),button_('Incomplete morning','CANDIDATE_INCOMPLETE',version)]]);
  if (session.state === STATES.GATE_CANDIDATE) {
    const n = Number(session.payload && session.payload.gate_current_index || 0) + 1;
    return sendTelegram_('Candidate ' + n + ': describe the candidate you want to assess.', chatId);
  }
  if (session.state === STATES.GATE_COMMITMENT) { const rec=gateRecord_(session.payload); return sendTelegram_('Optional context: did you actually accept a commitment connected to <b>'+escapeHtml_(String(rec&&rec.candidate||'this candidate'))+'</b>? This is recorded separately and does <b>not</b> decide whether it qualifies as a Signal. You can Skip.',chatId,[[button_('Yes','GATE_COMMITMENT_YES',version),button_('No','GATE_COMMITMENT_NO',version),button_('Not sure','GATE_COMMITMENT_UNSURE',version)],[button_('Skip','GATE_COMMITMENT_SKIP',version)]]); }
  // F-F2c CHANGE NOTE (Section F fix pack, F-F2c, fixes audit finding F2-3,
  // OBSERVATION): confirmed via grep that GATE_TYPE has no actionByState entry at
  // all — unlike every other multi-option state in this file, it is tap-only, with
  // no typed-text path and, until now, no comment explaining why. Decided NOT to
  // add typed-synonym matching here: this 8-way commitment taxonomy (Hard/Soft/
  // Renegotiable/Self-imposed/Stale/Urgent request/Preference/Opportunity) has
  // terms that overlap enough in ordinary language — "Preference" vs "Opportunity"
  // vs "Urgent request" in particular — that free-text parsing risks silently
  // misclassifying a participant's actual answer, which is a worse failure mode
  // than requiring a tap on an already-short 8-button grid. This comment makes
  // that a documented, deliberate choice rather than an unexplained omission, so a
  // future editor doesn't "fix" it by adding fragile free-text matching. If typed
  // input is added later anyway, handle the embedded hyphens in GATE_TYPE_SELF-
  // IMPOSED / GATE_TYPE_URGENT-REQUEST's action IDs carefully when normalizing.
  // Comment-only; no behavior change. Date: 2026-08-17.
  // IF09 final-instrument compatibility: GATE_TYPE is retired from all new live transitions. This renderer remains only so a stale pre-final session/callback can finish without data loss.
  if (session.state === STATES.GATE_TYPE) return sendTelegram_('What kind of claim is this?\n\nHard / Soft / Renegotiable / Self-imposed / Stale are commitment types.\nUrgent request, Preference, and Opportunity are non-commitment claim types unless separately accepted.\nIf none fits or you are not sure, choose <b>Not sure / can’t classify</b>.\n\nThe label is descriptive; it does not decide whether the candidate qualifies.',chatId,[[button_('Hard','GATE_TYPE_HARD',version),button_('Soft','GATE_TYPE_SOFT',version)],[button_('Renegotiable','GATE_TYPE_RENEGOTIABLE',version),button_('Self-imposed','GATE_TYPE_SELF-IMPOSED',version)],[button_('Stale','GATE_TYPE_STALE',version),button_('Urgent request','GATE_TYPE_URGENT-REQUEST',version)],[button_('Preference','GATE_TYPE_PREFERENCE',version),button_('Opportunity','GATE_TYPE_OPPORTUNITY',version)],[button_('Not sure / can’t classify','GATE_TYPE_UNCERTAIN',version)]]);
  if (session.state === STATES.GATE_CLAIM) { const rec=gateRecord_(session.payload); return sendTelegram_('What is its specific present claim — the concrete consequence, state, or obligation effect that is happening today, or will happen today, if this gets no attention?\n\nCandidate: <b>'+escapeHtml_(String(rec&&rec.candidate||''))+'</b>\n\nImportance, preference, or simply “it matters” is not enough by itself. <b>Only type a claim if it meets the definition above. By typing one, you are reporting that it does.</b>\n\nIf there is no such present claim, tap <b>No present claim</b>. If you are unsure, tap <b>Not sure</b>.\n\nA specific present claim is required for an ordinary claim-based Signal. Uncertainty is valid.',chatId,[[button_('No present claim','GATE_CLAIM_NONE',version),button_('Not sure','GATE_CLAIM_UNSURE',version)]]); }
  if (session.state === STATES.GATE_FEASIBILITY) return sendTelegram_('Is it feasible today as stated?\n<b>Feasible</b> means realistically possible today with your actual time and capacity.', chatId, [[button_('Yes — feasible', 'GATE_FEASIBLE_YES', version), button_('No', 'GATE_FEASIBLE_NO', version), button_('Not sure', 'GATE_FEASIBLE_UNSURE', version)]]);
  // F-F1c CHANGE NOTE (Section F fix pack, F-F1c, fixes audit finding F1-3, MAJOR):
  // this state's only rendered button was "No smaller action identified" with no
  // visible path for a user who DOES have one — confirmed via handleStateInput_
  // (the GATE_SMALLER_ACTION branch, ~line 1990) that typed free text IS already
  // handled correctly and stored as smaller_action, so this was a copy-only gap,
  // not a missing feature: a first-time user had no way to know typing was the
  // expected path for "yes." Added an explicit instruction to type. Comment-only/
  // string-only change; no payload or transition logic touched. Date: 2026-08-17.
  if (session.state === STATES.GATE_SMALLER_ACTION) return sendTelegram_('Is there a <b>meaningful smaller version of this same candidate</b> that is feasible today and still addresses the same present claim?\n\nAn unrelated easy task or token action does not count. <b>Only type the smaller action if it stays in the same direction and meets the definition above. By typing it, you are reporting that it does.</b>\n\nOtherwise choose <b>No smaller action identified</b>.', chatId, [[button_('No smaller action identified', 'GATE_NO_SMALLER', version)]]);
  // F54 CHANGE-CONTROL (Round 5, Section J fix pack, fixes audit finding J2,
  // MINOR): master doc §3's ambiguity clause requires comparing multiple
  // legitimate candidates "by least deferrable/delegable/reducible" — this
  // criterion existed nowhere in the rendered text (confirmed by grep: zero
  // occurrences of "deferrable"/"delegable"/"reducible" anywhere in this
  // file before this fix). GATE_CLAIM and GATE_FEASIBILITY already collect
  // each candidate's present_claim and feasible_today into other_claims by
  // the time GATE_COMPARE renders, so this restates that already-captured
  // data back to the user as the comparison basis instead of leaving them to
  // compare on an unstated criterion. Construct is unchanged — the state
  // still records a bare Candidate 1/2/Neither/Can't-compare choice — this
  // is a copy-only fix per J2's own copy-gap/construct-gap distinction: the
  // decision rule now reaches the user, but no new field is captured and no
  // transition logic changed. Retesting: yes — manual click-through of the
  // /gate two path, confirming both candidates' claim/feasibility text
  // render correctly and that a candidate with a null/not-yet-set field
  // (e.g., feasible_today never populated because that candidate exited via
  // GATE_FEASIBLE_YES with no smaller-action detour) degrades to something
  // readable, not "undefined" or a blank line. Date: 2026-08-18.
  if (session.state === STATES.GATE_COMPARE) {
    const claims = Array.isArray(session.payload && session.payload.other_claims) ? session.payload.other_claims : [];
    const describeCandidate_ = function(rec, n) {
      if (!rec) return n + '. (no record found)';
      const claim = rec.present_claim ? escapeHtml_(String(rec.present_claim)) : 'not stated';
      const feasible = rec.feasible_today === 'no' ? 'not feasible today as stated' :
        rec.feasible_today === 'not_sure' ? 'feasibility uncertain' :
        rec.feasible_today === undefined || rec.feasible_today === null ? 'feasibility not assessed' : 'feasible today';
      return n + '. <b>' + escapeHtml_(String(rec.candidate || '')) + '</b> — claim: ' + claim + '; ' + feasible + '.';
    };
    const summary = describeCandidate_(claims[0], 1) + '\n' + describeCandidate_(claims[1], 2);
    return sendTelegram_('Comparing both candidates — which has the least deferrable, least delegable, and least reducible claim on today?\n<b>Deferrable</b> = can wait. <b>Delegable</b> = someone else can do it. <b>Reducible</b> = can be done in a smaller form.\n\n' + summary + '', chatId, [[button_('Candidate 1', 'GATE_COMPARE_C1', version), button_('Candidate 2', 'GATE_COMPARE_C2', version)], [button_('Neither', 'GATE_COMPARE_NEITHER', version), button_('Can’t compare', 'GATE_COMPARE_CANT', version)]]);
  }
  if (session.state === STATES.FOCAL_SELECTION) {
    const payload=session.payload||{},claims=Array.isArray(payload.other_claims)?payload.other_claims:[],two=payload.candidate_path==='two_competing',selectionAllowed=comparisonAllowsFocalSelection_(payload),candidateButtons=[],candidateLines=[];
    if(selectionAllowed){if(candidateQualifies_(claims[0])){candidateButtons.push(button_('Candidate 1','FOCAL_CANDIDATE1',version));candidateLines.push('<b>Candidate 1:</b> '+escapeHtml_(String(qualifyingSignalText_(claims[0]))));}if(two&&candidateQualifies_(claims[1])){candidateButtons.push(button_('Candidate 2','FOCAL_CANDIDATE2',version));candidateLines.push('<b>Candidate 2:</b> '+escapeHtml_(String(qualifyingSignalText_(claims[1]))));}}
    const rows=[];if(candidateButtons.length)rows.push(candidateButtons);rows.push([button_('No Signal','FOCAL_NO_SIGNAL',version),button_('Uncertain / can’t compare','FOCAL_UNCERTAIN',version)]);rows.push([button_('Recovery / Health','FOCAL_RECOVERY',version)]);
    let note='';if(two&&payload.comparison_status==='not_required_single_qualifier')note=' Only one candidate independently met the qualifying rule, so comparison was not required.';else if(two&&payload.comparison_status==='not_required_no_qualifiers')note=' Neither candidate independently met the qualifying rule, so comparison was not required.';else if(two&&payload.comparison_status!=='resolved')note=' Comparison did not resolve, so no candidate can be made focal from this record.';
    const identities=candidateLines.length?'\n\nClaim-based options:\n\n'+candidateLines.join('\n\n')+'\n\nTap the matching Candidate button below.':'';
    return sendTelegram_('Choose today’s daily-focus state.'+note+' A claim-based Signal is available only when the qualifying rule is met; comparison is required only when both candidates qualify.'+identities+'\n\nNo Signal, uncertainty, and Recovery / Health are equally legitimate outcomes.',chatId,rows);
  }
  if (session.state === STATES.PRESERVE) {
    const current=currentPreserveCandidate_(session.payload||{});if(!current)return sendTelegram_('No non-focal candidate remains to disposition.',chatId);
    return sendTelegram_('Non-focal candidate '+(current.position+1)+' of '+current.total+': <b>'+escapeHtml_(String(current.record.candidate||''))+'</b>\n\nRecord where this claim stands. No explanation is required. These are dispositions, not quality labels.',chatId,[[button_('Scheduled','PRESERVE_SCHEDULED',version),button_('Later','PRESERVE_LATER',version)],[button_('Acknowledged / unresolved','PRESERVE_ACKNOWLEDGED',version)],[button_('Protected','PRESERVE_PROTECTED',version),button_('Uncertain','PRESERVE_UNCERTAIN',version)]]);
  }
  if (session.state === STATES.REVIEW_Q1) return sendTelegram_('1. Thinking back to this morning — what did you actually know at the time you chose (or didn’t choose) a focus?', chatId, [[button_('Not sure', 'REVIEW_Q1_NOT_SURE', version)]]);
  if (session.state === STATES.REVIEW_Q2) return sendReviewTraceInstrument_(session,'Q2','2. <b>Optional self-appraisal:</b> given only what you knew then, did the morning choice make sense to you?\n<b>Reasonable given what was known</b> = it made sense to you based only on what you knew then. <b>Questionable</b> = you remember a reason to doubt it using that same information. This is your retrospective appraisal, not an objective score of decision quality.', chatId, [[button_('Reasonable given what was known', 'REVIEW_Q2_REASONABLE', version)], [button_('Questionable given what was known', 'REVIEW_Q2_QUESTIONABLE', version)], [button_('Can’t assess', 'REVIEW_Q2_CANT', version), button_('Not sure', 'REVIEW_Q2_UNSURE', version)], [button_('Skip', 'REVIEW_Q2_SKIP', version)]]);
  if (session.state === STATES.REVIEW_Q3) return sendTelegram_('3. Did your capacity or health turn out different from what you expected?', chatId, [[button_('As expected', 'REVIEW_Q3_EXPECTED', version), button_('Lower', 'REVIEW_Q3_LOWER', version)], [button_('Higher', 'REVIEW_Q3_HIGHER', version), button_('Fluctuating', 'REVIEW_Q3_FLUCTUATING', version)], [button_('Not sure', 'REVIEW_Q3_UNSURE', version)]]);
  if (session.state === STATES.REVIEW_Q4) return sendTelegram_('4. Did outside circumstances change during the day?', chatId, [[button_('No', 'REVIEW_Q4_NO', version), button_('Minor change', 'REVIEW_Q4_MINOR', version)], [button_('Major change', 'REVIEW_Q4_MAJOR', version), button_('Not sure', 'REVIEW_Q4_UNSURE', version)]]);
  if (session.state === STATES.REVIEW_Q5) return sendTelegram_('5. Did you deliberately change, replace, pause, or stop the direction you endorsed this morning at some point?', chatId, [[button_('No', 'REVIEW_Q5_NO', version), button_('Yes', 'REVIEW_Q5_YES', version), button_('Not sure', 'REVIEW_Q5_UNSURE', version)]]);
  if (session.state === STATES.REVIEW_Q5_NOTE) return sendTelegram_('5b. Optional note: what did you deliberately change, replace, pause, or stop, and what reason do you remember as being known at that time? Tap Skip if you do not want to add a note.', chatId, [[button_('Skip', 'REVIEW_Q5_SKIP', version)]]);
  if (session.state === STATES.REVIEW_Q6) return sendTelegram_('6. Did your attention move away from the direction you endorsed this morning <b>enough to meaningfully affect what you were doing or planning</b>?\n\nBrief, ordinary distractions do not count. This asks about attention movement only; it does not by itself mean the shift was a mistake or unplanned.', chatId, [[button_('No', 'REVIEW_Q6_NO', version), button_('Yes — describe', 'REVIEW_Q6_YES', version)], [button_('No focal Signal', 'REVIEW_Q6_NO_FOCAL', version), button_('Not sure', 'REVIEW_Q6_UNSURE', version)], [button_('Skip', 'REVIEW_Q6_SKIP', version)]]);
  if (session.state === STATES.REVIEW_Q6_NOTE) return sendTelegram_('6b. What did your attention move toward, or what drew it away? Tap Skip if you do not want to describe it.', chatId, [[button_('Skip', 'REVIEW_Q6_SKIP_NOTE', version)]]);
  if (session.state === STATES.REVIEW_Q7) return sendTelegram_('7. Descriptively, what best describes your action on the direction you endorsed this morning?', chatId, [[button_('Completed', 'REVIEW_Q7_COMPLETED', version), button_('Substantial progress', 'REVIEW_Q7_SUBSTANTIAL', version)], [button_('Partial progress', 'REVIEW_Q7_PARTIAL', version), button_('No attempt', 'REVIEW_Q7_NO_ATTEMPT', version)], [button_('Unable / blocked from acting', 'REVIEW_Q7_UNABLE_BLOCKED', version)], [button_('Not sure', 'REVIEW_Q7_UNSURE', version), button_('No usable record', 'REVIEW_Q7_NO_RECORD', version)]]);
  // F-F1b CHANGE NOTE (Section F fix pack, F-F1b, fixes audit finding F1-2, MAJOR):
  // this screen's 14 button labels (Priority error, Feasibility error, etc.) had zero
  // inline definitions, unlike GATE_TYPE's commitment taxonomy (line ~2294 area) which
  // defines each of its 8 options inline in the same message — an internal
  // inconsistency in copy standard on this file's own jargon-handling precedent.
  // Considered pasting all 14 full definitions the way GATE_TYPE does for its 8, but
  // rejected that: 14 full glosses would roughly double GATE_TYPE's already-long
  // message and fail F3's mobile-scanability bar. Instead added short inline glosses
  // only for the three terms the audit specifically flagged as most confusable
  // (Priority error / Feasibility error / Capacity-estimation error all sound similar
  // but are distinct per the master doc) plus the two "not an error" categories, which
  // most need disambiguating from the punitive-sounding ones nearby. Left self-
  // explanatory options (No error identified, Insufficient record, Not sure, Skip)
  // undefined. Definitions reworded from, not pasted from, the master doc's
  // "Classification / prediction errors" / "Execution / action errors" / "Context
  // shift" / "Deliberate reprioritization" sections. Downstream: button action IDs
  // and payload keys unchanged, message text only. If this screen still tests as
  // confusing on re-audit (see FV1), the fix pack's fallback option — a separate
  // /glossary command with full definitions — should be implemented instead of
  // adding more inline text here. Date: 2026-08-17.
  if (session.state === STATES.REVIEW_Q8) return sendReviewTraceInstrument_(session,'Q8','8. <b>Optional participant interpretation.</b> If you want, type in your own words what you think best explains what happened today.\n\nThis is your interpretation, not a score, diagnosis, or independent evidence. You do not need to classify the day into a Signal Calibration label.', chatId, [[button_('No interpretation to add', 'REVIEW_Q8_NO_INTERPRETATION', version), button_('Not sure', 'REVIEW_Q8_UNSURE', version)], [button_('Skip', 'REVIEW_Q8_SKIP', version)]]);
  if (session.state === STATES.REVIEW_Q9) return sendTelegram_('9. What, if anything, remains unclear? This is optional.', chatId, [[button_('Skip', 'REVIEW_Q9_SKIP', version)]]);
  if (session.state === STATES.REVIEW_LEARNING) return sendTelegram_('Optional learning record: did this review leave you with a specific discrepancy or lesson? You can type it, choose No lesson, or choose Not sure. This is your report, not proof that learning occurred.',chatId,[[button_('No lesson','REVIEW_LEARNING_NONE',version),button_('Not sure','REVIEW_LEARNING_UNCERTAIN',version)]]);
  if (session.state === STATES.REVIEW_Q10) return sendTelegram_('10. Optional: Is there one small adjustment you’d want to try?', chatId, [[button_('Skip', 'REVIEW_Q10_SKIP', version)]]);
  if (session.state === STATES.ADJUSTMENT_CONTACT) return sendTelegram_('Last review, you optionally recorded this adjustment:\n\n<b>'+escapeHtml_(String((session.payload||{}).adjustment_plan_text||''))+'</b>\n\nFor today, you can accept it, revise it, or decline it. This is not a score or requirement.',chatId,[[button_('Accept','ADJUSTMENT_ACCEPT',version),button_('Revise','ADJUSTMENT_REVISE',version)],[button_('Decline','ADJUSTMENT_DECLINE',version)]]);
  if (session.state === STATES.ADJUSTMENT_REVISE) return sendTelegram_('Type the revised adjustment you want to use today. It will become a new version; the prior version remains recorded as superseded.',chatId);
  if (session.state === STATES.REVIEW_MINIMAL) return sendTelegram_('No focal Signal is recorded for this review. Review is optional and minimal for this state.', chatId, [[button_('Close review', 'REVIEW_MINIMAL_CLOSE', version)]]);
  if (session.state === STATES.COMPLETE) return sendTelegram_(isMorningSourceState_(String((session.payload||{}).source_state||''))?formatMorningCompleteUX_(session.payload):'Session complete. Thank you.', chatId);
  return false;
}

function getLatestMorningSignalContext_(participantId) {
  const rows=readRows_(getSignalHistorySheet_());
  for(let i=rows.length-1;i>=0;i--){
    if(String(rows[i][COLS.SIGNAL_HISTORY.PARTICIPANT_ID])!==String(participantId)) continue;
    const source=String(rows[i][COLS.SIGNAL_HISTORY.SOURCE_STATE]||'');
    if(!isMorningSourceState_(source)) continue;
    return {signalText:rows[i][COLS.SIGNAL_HISTORY.SIGNAL_TEXT],setAt:rows[i][COLS.SIGNAL_HISTORY.SET_AT],sessionId:rows[i][COLS.SIGNAL_HISTORY.SESSION_ID],sourceState:source};
  }
  return null;
}
function getSignalForSession_(participantId, sessionId) {
  const rows=readRows_(getSignalHistorySheet_());
  for(let i=rows.length-1;i>=0;i--){
    if(String(rows[i][COLS.SIGNAL_HISTORY.PARTICIPANT_ID])!==String(participantId)) continue;
    if(String(rows[i][COLS.SIGNAL_HISTORY.SESSION_ID])!==String(sessionId)) continue;
    const source=String(rows[i][COLS.SIGNAL_HISTORY.SOURCE_STATE]||'');
    if(!isMorningSourceState_(source)) continue;
    return {signalText:rows[i][COLS.SIGNAL_HISTORY.SIGNAL_TEXT],setAt:rows[i][COLS.SIGNAL_HISTORY.SET_AT],sessionId:rows[i][COLS.SIGNAL_HISTORY.SESSION_ID],sourceState:source};
  }
  return null;
}
function getLatestSignal_(participantId) {
  const rows = readRows_(getSignalHistorySheet_());
  for (let i = rows.length - 1; i >= 0; i--) {
    if (String(rows[i][COLS.SIGNAL_HISTORY.PARTICIPANT_ID]) === String(participantId)) {
      return {
        signalText: rows[i][COLS.SIGNAL_HISTORY.SIGNAL_TEXT], setAt: rows[i][COLS.SIGNAL_HISTORY.SET_AT]
      };
    }
  }  return null;
}

function currentDeliveryChatId_(participantId) {
  if (!currentOperationContext_) return '';
  if (String(currentOperationContext_.participantId || currentOperationContext_.userId || '') !== String(participantId || '')) return '';
  return currentOperationContext_.deliveryChatId || '';
}
function resolveDeliveryChatId_(participantId, explicitChatId) {
  if (explicitChatId !== undefined && explicitChatId !== null && String(explicitChatId) !== '') return explicitChatId;
  const current=currentDeliveryChatId_(participantId);
  return current || getParticipantChatId_(participantId);
}

function getParticipantChatId_(participantId) {
  const row = readRows_(getParticipantsSheet_()).find(item => String(item[COLS.PARTICIPANTS.ID]) === String(participantId));
  return row ? row[COLS.PARTICIPANTS.TELEGRAM_CHAT_ID] : '';
}

// F29: matches getParticipantChatId_'s existing pattern above — for call
// sites (createSession_, getLatestSessionForProjectDay_) that only have a
// participantId string in scope, not the full participant object. Returns
// NO_DEFAULT_PROJECT_TIMEZONE if no matching row is found (should not happen
// in practice, since both callers only run for an already-resolved
// participant, but this keeps projectDay_ from ever receiving undefined).
function getParticipantTimezone_(participantId) {
  const r=ensureLegacyProspectiveTimezoneAuthority_(participantId,now_());
  if(r.status===TIMEZONE_AUTHORITY_STATUS.OK) return r.timezone;
  if(r.status===TIMEZONE_AUTHORITY_STATUS.NO_AUTHORITY||r.status===TIMEZONE_AUTHORITY_STATUS.NO_HISTORY) return '';
  throw new Error(r.status||'TIMEZONE_AUTHORITY_REQUIRED');
}

function deleteRowsWhere_(sheet, predicate) {
  const rows = readRows_(sheet);
  const matches = [];
  rows.forEach((row, index) => { if (predicate(row)) matches.push(rowNumber_(index)); });
  matches.sort((a,b)=>b-a).forEach(rowNumber=>storageDeleteRow_(sheet,rowNumber,'delete_match'));
}

const DATA_CONTROL_REQUEST_TTL_MS = 30 * 60 * 1000;
// PE04 — deletion classification is persisted in the existing STATUS column so
// reconciliation never has to guess from a participant row that may already have
// been deleted. This does not change the DataControlRequests schema.
const DELETION_REQUEST_STATUS = Object.freeze({
  PENDING:'PENDING', CANCELLED:'CANCELLED', EXPIRED:'EXPIRED',
  CONFIRMED_PRE_ENROLLMENT:'CONFIRMED_PRE_ENROLLMENT',
  CONFIRMED_POST_ENROLLMENT:'CONFIRMED_POST_ENROLLMENT',
  RECONCILIATION_REQUIRED:'RECONCILIATION_REQUIRED'
});
const DELETION_MODE = Object.freeze({ PRE_ENROLLMENT:'PRE_ENROLLMENT', POST_ENROLLMENT:'POST_ENROLLMENT' });
function participantFingerprint_(participantId) { const key=getConfig_().webhookSecret; if(!key) throw new Error('REDACTION_KEY_UNAVAILABLE'); return contentFingerprint_(key + ':participant:' + String(participantId)).fingerprint; }
function deletionUpdateFingerprint_(participantId, updateId) { const key=getConfig_().webhookSecret; if(!key) throw new Error('REDACTION_KEY_UNAVAILABLE'); return contentFingerprint_(key + ':delete-update:' + String(participantId) + ':' + String(updateId)).fingerprint; }
function dataControlRequestTag_(requestId) { const v=String(requestId||''); return v.length<=12?v:v.slice(-12); }
function dataControlButton_(label, action, requestTag) {
  const data=String(action)+'|'+String(requestTag||'');
  if(data.length>64) throw new Error('CALLBACK_DATA_TOO_LONG:'+action);
  return {text:label,callback_data:data};
}
function appendDataControlAudit_(participantId, action, outcome, residualCount, fields) {
  fields=fields||{};
  const id=Utilities.getUuid();
  storageAppendRow_(getDataControlAuditSheet_(),[
    id, participantFingerprint_(participantId), String(action||''), String(outcome||''), Number(residualCount||0),
    String(fields.accessMechanism||''), String(fields.expiryTarget||''), String(fields.expiryConfirmed||''),
    String(fields.cleanupStatus||''), String(fields.reconciliationStatus||''), String(fields.updateFingerprint||''), now_()
  ],'data_control_audit');
  return id;
}

// PE04 — verify and persist a deletion-request status transition. The STATUS
// column is the durable mode/reconciliation handle; no new Sheets column is added.
function setDeletionRequestStatusVerified_(requestRowNumber, status, artifactType) {
  storageSetValue_(getDataControlRequestsSheet_(),requestRowNumber,COLS.DATA_CONTROL_REQUESTS.STATUS+1,String(status),artifactType||'delete_request_status');
  const persisted=getDataControlRequestsSheet_().getRange(requestRowNumber,COLS.DATA_CONTROL_REQUESTS.STATUS+1).getValue();
  if(String(persisted)!==String(status)) throw new Error('DELETE_REQUEST_STATUS_PERSISTENCE_FAILED:'+String(status));
  return true;
}

// Durable enrollment evidence for deletion classification must be stronger than
// mere participant-row existence or RUN_REF, because getOrCreateParticipant_()
// creates both before consent. A consented canonical enrollment day + run is
// authoritative; for a legacy consented row, an existing Session with canonical
// project day and non-empty run ref is accepted as equivalent evidence.
function reliableDeletionEnrollmentEvidence_(participantId) {
  const found=participantRowById_(participantId);
  if(!found) return {ok:true,participantExists:false,reliable:false,reason:'participant_absent'};
  const row=found.row;
  const consent=String(row[COLS.PARTICIPANTS.CONSENT_STATUS]||'');
  const runRef=String(row[COLS.PARTICIPANTS.RUN_REF]||'').trim();
  const rawDay=row[COLS.PARTICIPANTS.ENROLLED_PROJECT_DAY];
  const rawDayText=String(rawDay==null?'':rawDay).trim();
  const enrolledDay=canonicalProjectDayKey_(rawDay);
  const sessions=readRows_(getSessionsSheet_()).filter(r=>String(r[COLS.SESSIONS.PARTICIPANT_ID])===String(participantId));

  if(consent!=='CONSENTED') {
    if(rawDayText || sessions.length) return {ok:false,participantExists:true,reliable:false,reason:'preconsent_enrollment_evidence_contradiction'};
    return {ok:true,participantExists:true,reliable:false,reason:'pre_enrollment'};
  }
  if(rawDayText && !enrolledDay) return {ok:false,participantExists:true,reliable:false,reason:'invalid_enrollment_day'};
  if(runRef && enrolledDay) return {ok:true,participantExists:true,reliable:true,reason:'participant_enrollment_tuple'};

  const sessionEvidence=sessions.some(r=>{
    const sessionRun=String(r[COLS.SESSIONS.RUN_REF]||'').trim();
    const sessionDay=canonicalProjectDayKey_(r[COLS.SESSIONS.PROJECT_DAY]);
    return !!sessionRun && !!sessionDay;
  });
  if(sessionEvidence) return {ok:true,participantExists:true,reliable:true,reason:'legacy_session_enrollment_evidence'};
  return {ok:true,participantExists:true,reliable:false,reason:'consented_not_enrolled'};
}

function readDeletionEligibility_(participantId, lock) {
  if(typeof channelGateReadEligibility_!=='function') return {ok:false,reason:'eligibility_read_api_unavailable'};
  const out=channelGateReadEligibility_(participantId,lock);
  if(!out || out.ok!==true) return {ok:false,reason:out&&out.reason?String(out.reason):'eligibility_read_failed'};
  return out;
}

// Safely reconcile post-enrollment deletion to RETIRING before any destructive
// work. LOCKED is accepted only for idempotent final cleanup after a prior pass.
function ensureDeletionRetirementState_(participantId, lock) {
  let eligibility=readDeletionEligibility_(participantId,lock);
  if(!eligibility.ok) return {ok:false,reason:eligibility.reason};

  if(!eligibility.exists) {
    const evidence=reliableDeletionEnrollmentEvidence_(participantId);
    if(!evidence.ok) return {ok:false,reason:evidence.reason};
    if(!evidence.reliable) return {ok:false,reason:'post_enrollment_evidence_missing'};
    if(typeof channelGateRecordEnrollment_!=='function' || channelGateRecordEnrollment_(participantId,lock)!==true) {
      return {ok:false,reason:'legacy_enrollment_reconciliation_failed'};
    }
    eligibility=readDeletionEligibility_(participantId,lock);
    if(!eligibility.ok || !eligibility.exists || eligibility.state!=='ENROLLED') return {ok:false,reason:'legacy_enrollment_verification_failed'};
  }

  if(eligibility.state==='LOCKED') return {ok:true,state:'LOCKED',generation:Number(eligibility.generation)||1};
  if(eligibility.state==='ENROLLED') {
    if(typeof channelGateBeginRetirement_!=='function' || channelGateBeginRetirement_(participantId,lock)!==true) {
      return {ok:false,reason:'retiring_persistence_failed'};
    }
  } else if(eligibility.state!=='RETIRING') {
    return {ok:false,reason:'unexpected_eligibility_state:'+String(eligibility.state||'')};
  }

  const verified=readDeletionEligibility_(participantId,lock);
  if(!verified.ok || !verified.exists || verified.state!=='RETIRING') return {ok:false,reason:'retiring_verification_failed'};
  return {ok:true,state:'RETIRING',generation:Number(verified.generation)||1};
}

function classifyDeletionRequest_(participantId, lock) {
  const eligibility=readDeletionEligibility_(participantId,lock);
  if(!eligibility.ok) return {ok:false,reason:eligibility.reason};
  if(eligibility.exists) {
    if(eligibility.state==='ENROLLED' || eligibility.state==='RETIRING' || eligibility.state==='LOCKED') {
      return {ok:true,mode:DELETION_MODE.POST_ENROLLMENT,state:eligibility.state};
    }
    return {ok:false,reason:'unexpected_eligibility_state:'+String(eligibility.state||'')};
  }
  const evidence=reliableDeletionEnrollmentEvidence_(participantId);
  if(!evidence.ok) return {ok:false,reason:evidence.reason};
  if(evidence.reliable) return {ok:true,mode:DELETION_MODE.POST_ENROLLMENT,state:'LEGACY_ENROLLED'};
  if(evidence.participantExists) return {ok:true,mode:DELETION_MODE.PRE_ENROLLMENT,state:'NEVER_ENROLLED'};
  return {ok:false,reason:'eligibility_absent_participant_absent'};
}

function deletionModeFromRequestStatus_(status) {
  const s=String(status||'');
  if(s===DELETION_REQUEST_STATUS.CONFIRMED_PRE_ENROLLMENT) return DELETION_MODE.PRE_ENROLLMENT;
  if(s===DELETION_REQUEST_STATUS.CONFIRMED_POST_ENROLLMENT) return DELETION_MODE.POST_ENROLLMENT;
  return '';
}

function latestDeletionRequest_(participantId) {
  const rows=readRows_(getDataControlRequestsSheet_());
  for(let i=rows.length-1;i>=0;i--){
    const r=rows[i];
    if(String(r[COLS.DATA_CONTROL_REQUESTS.PARTICIPANT_ID])===String(participantId) && String(r[COLS.DATA_CONTROL_REQUESTS.ACTION])==='DELETE') {
      return {row:r,rowNumber:rowNumber_(i),requestId:String(r[COLS.DATA_CONTROL_REQUESTS.REQUEST_ID]),status:String(r[COLS.DATA_CONTROL_REQUESTS.STATUS]),expiresAt:Number(r[COLS.DATA_CONTROL_REQUESTS.EXPIRES_AT]||0)};
    }
  }
  return null;
}
function beginDeletionConfirmation_(participantId, chatId) {
  const existing=latestDeletionRequest_(participantId);
  if(existing && existing.status===DELETION_REQUEST_STATUS.PENDING && existing.expiresAt>Date.now()){
    sendTelegram_('Deletion is still awaiting your confirmation.\n\nThis deletion removes:\n• your participant/setup record;\n• sessions and participant answers/research records;\n• events/activity history and Signal history;\n• links between each morning calibration and its review;\n• optional learning records and adjustment plans;\n• consent/timezone history;\n• dedup/update records and participant-linked operation/send records covered by the deletion contract;\n• pending data-control records, which are deleted or reconciled under the contract;\n• quarantined session payloads;\n• the current channel-membership verification cache; and\n• any identifiable temporary export files, if any exist.\n\nAfter successful post-enrollment deletion, limited pseudonymous governance/control evidence remains: the repeat-enrollment eligibility marker, deletion-audit evidence, and any applicable repeat-participation request/grant records under their access-control lifecycle. These retained records contain no Telegram ID, Signal Calibration answers, or deleted research records. Another independent participation still requires owner authorization.\n\nOnce a confirmed deletion completes successfully, it cannot be undone. <b>Cancel deletes nothing.</b>',chatId,[[dataControlButton_('Confirm deletion','DC_DELETE_CONFIRM',dataControlRequestTag_(existing.requestId)),dataControlButton_('Cancel','DC_DELETE_CANCEL',dataControlRequestTag_(existing.requestId))]]);
    return existing.requestId;
  }
  if(existing && (existing.status===DELETION_REQUEST_STATUS.CONFIRMED_PRE_ENROLLMENT || existing.status===DELETION_REQUEST_STATUS.CONFIRMED_POST_ENROLLMENT || existing.status===DELETION_REQUEST_STATUS.RECONCILIATION_REQUIRED)) {
    sendTelegram_('A previously confirmed deletion is still being reconciled. No new deletion request was created and no success is being claimed. Please contact the bot operator if this remains unresolved.',chatId);
    return existing.requestId;
  }
  const requestId=Utilities.getUuid(), expiresAt=Date.now()+DATA_CONTROL_REQUEST_TTL_MS;
  storageAppendRow_(getDataControlRequestsSheet_(),[requestId,String(participantId),'DELETE',DELETION_REQUEST_STATUS.PENDING,now_(),expiresAt,operationId_()],'delete_request');
  sendTelegram_('Review before deleting.\n\nThis deletion removes:\n• your participant/setup record;\n• sessions and participant answers/research records;\n• events/activity history and Signal history;\n• links between each morning calibration and its review;\n• optional learning records and adjustment plans;\n• consent/timezone history;\n• dedup/update records and participant-linked operation/send records covered by the deletion contract;\n• pending data-control records, which are deleted or reconciled under the contract;\n• quarantined session payloads;\n• the current channel-membership verification cache; and\n• any identifiable temporary export files, if any exist.\n\nAfter successful post-enrollment deletion, limited pseudonymous governance/control evidence remains: the repeat-enrollment eligibility marker, deletion-audit evidence, and any applicable repeat-participation request/grant records under their access-control lifecycle. These retained records contain no Telegram ID, Signal Calibration answers, or deleted research records. Another independent participation still requires owner authorization.\n\nOnce a confirmed deletion completes successfully, it cannot be undone. <b>Cancel deletes nothing.</b>',chatId,[[dataControlButton_('Confirm deletion','DC_DELETE_CONFIRM',dataControlRequestTag_(requestId)),dataControlButton_('Cancel','DC_DELETE_CANCEL',dataControlRequestTag_(requestId))]]);
  return requestId;
}
function resolveDeletionRequestByTag_(participantId, requestTag) {
  const rows=readRows_(getDataControlRequestsSheet_());
  const matches=[];
  rows.forEach((r,i)=>{ if(String(r[COLS.DATA_CONTROL_REQUESTS.PARTICIPANT_ID])===String(participantId) && String(r[COLS.DATA_CONTROL_REQUESTS.ACTION])==='DELETE' && dataControlRequestTag_(r[COLS.DATA_CONTROL_REQUESTS.REQUEST_ID])===String(requestTag||'')) matches.push({row:r,rowNumber:rowNumber_(i),requestId:String(r[COLS.DATA_CONTROL_REQUESTS.REQUEST_ID]),status:String(r[COLS.DATA_CONTROL_REQUESTS.STATUS]),expiresAt:Number(r[COLS.DATA_CONTROL_REQUESTS.EXPIRES_AT]||0)}); });
  return matches.length===1?matches[0]:null;
}
function handleDeletionConfirmation_(participantId, requestTag, confirmed, chatId) {
  const req=resolveDeletionRequestByTag_(participantId,requestTag);
  if(!req || req.status!==DELETION_REQUEST_STATUS.PENDING){ sendTelegram_('That deletion action is no longer active. Use /delete-data to review the current deletion scope.',chatId); return false; }
  if(req.expiresAt<=Date.now()){
    setDeletionRequestStatusVerified_(req.rowNumber,DELETION_REQUEST_STATUS.EXPIRED,'delete_request_expire');
    sendTelegram_('That deletion confirmation expired without deleting anything. Use /delete-data if you still want to review and confirm deletion.',chatId); return false;
  }
  if(!confirmed){ setDeletionRequestStatusVerified_(req.rowNumber,DELETION_REQUEST_STATUS.CANCELLED,'delete_request_cancel'); appendDataControlAudit_(participantId,'DELETE','CANCELLED',0,{reconciliationStatus:'NOT_REQUIRED'}); sendTelegram_('Deletion cancelled. No data was deleted.',chatId); return true; }

  const lock=currentHeldScriptLock_();
  // Persist generic confirmed/reconciliation authority before touching lifetime
  // state. If RETIRING succeeds but a later exact-mode status write fails, the
  // operator can still deterministically resume from this retained request.
  try { setDeletionRequestStatusVerified_(req.rowNumber,DELETION_REQUEST_STATUS.RECONCILIATION_REQUIRED,'delete_request_confirmed_for_reconciliation'); }
  catch(statusError) {
    sendTelegram_('Deletion confirmation could not be recorded safely. No participant/research data was deleted. Please try again or contact the bot operator.',chatId);
    return false;
  }
  let classification;
  try { classification=classifyDeletionRequest_(participantId,lock); }
  catch(error) { classification={ok:false,reason:safeErrorMessage_(error)}; }
  if(!classification || classification.ok!==true) {
    try { setDeletionRequestStatusVerified_(req.rowNumber,DELETION_REQUEST_STATUS.RECONCILIATION_REQUIRED,'delete_request_reconciliation_required'); } catch(statusError) {}
    try { appendDataControlAudit_(participantId,'DELETE','PARTIAL_FAILURE',0,{cleanupStatus:'ELIGIBILITY_CLASSIFICATION_UNRESOLVED',reconciliationStatus:'REQUIRED'}); } catch(auditError) {}
    log_('DELETE_ELIGIBILITY_CLASSIFICATION_UNRESOLVED',{participantFingerprint:participantFingerprint_(participantId),message:classification&&classification.reason?String(classification.reason):'unknown'});
    sendTelegram_('Deletion could not begin because prior enrollment status could not be verified safely. No participant/research data was deleted. The request has been retained for operator reconciliation.',chatId);
    return false;
  }

  if(classification.mode===DELETION_MODE.POST_ENROLLMENT) {
    const retirement=ensureDeletionRetirementState_(participantId,lock);
    if(!retirement.ok) {
      try { setDeletionRequestStatusVerified_(req.rowNumber,DELETION_REQUEST_STATUS.RECONCILIATION_REQUIRED,'delete_request_reconciliation_required'); } catch(statusError) {}
      try { appendDataControlAudit_(participantId,'DELETE','PARTIAL_FAILURE',0,{cleanupStatus:'RETIRING_UNCONFIRMED',reconciliationStatus:'REQUIRED'}); } catch(auditError) {}
      log_('DELETE_RETIRING_UNCONFIRMED',{participantFingerprint:participantFingerprint_(participantId),message:String(retirement.reason||'unknown')});
      sendTelegram_('Deletion could not begin because the repeat-enrollment lock could not be secured. No participant/research data was deleted. The request has been retained for operator reconciliation.',chatId);
      return false;
    }
    try { setDeletionRequestStatusVerified_(req.rowNumber,DELETION_REQUEST_STATUS.CONFIRMED_POST_ENROLLMENT,'delete_request_confirm_post_enrollment'); }
    catch(statusError) {
      try { appendDataControlAudit_(participantId,'DELETE','PARTIAL_FAILURE',0,{cleanupStatus:'DELETE_MODE_STATUS_UNCONFIRMED',reconciliationStatus:'REQUIRED'}); } catch(auditError) {}
      log_('DELETE_MODE_STATUS_UNCONFIRMED',{participantFingerprint:participantFingerprint_(participantId),deletionMode:DELETION_MODE.POST_ENROLLMENT,message:safeErrorMessage_(statusError)});
      sendTelegram_('Deletion was secured against accidental re-enrollment, but the deletion mode could not be recorded safely. No participant/research data was deleted. The retained request requires operator reconciliation.',chatId);
      return false;
    }
    return deleteParticipant_(participantId,chatId,req.requestId,DELETION_MODE.POST_ENROLLMENT,lock);
  }

  try { setDeletionRequestStatusVerified_(req.rowNumber,DELETION_REQUEST_STATUS.CONFIRMED_PRE_ENROLLMENT,'delete_request_confirm_pre_enrollment'); }
  catch(statusError) {
    try { appendDataControlAudit_(participantId,'DELETE','PARTIAL_FAILURE',0,{cleanupStatus:'DELETE_MODE_STATUS_UNCONFIRMED',reconciliationStatus:'REQUIRED'}); } catch(auditError) {}
    log_('DELETE_MODE_STATUS_UNCONFIRMED',{participantFingerprint:participantFingerprint_(participantId),deletionMode:DELETION_MODE.PRE_ENROLLMENT,message:safeErrorMessage_(statusError)});
    sendTelegram_('Deletion could not proceed because the deletion mode could not be recorded safely. No participant/research data was deleted. The retained request requires operator reconciliation.',chatId);
    return false;
  }
  return deleteParticipant_(participantId,chatId,req.requestId,DELETION_MODE.PRE_ENROLLMENT,lock);
}
function collectParticipantDeletionKeys_(participantId) {
  const sessionIds=readRows_(getSessionsSheet_()).filter(r=>String(r[COLS.SESSIONS.PARTICIPANT_ID])===String(participantId)).map(r=>String(r[COLS.SESSIONS.SESSION_ID]));
  const ids={}; sessionIds.forEach(x=>ids[x]=true); ids[String(participantId)]=true;
  return {sessionIds:sessionIds,recordIds:ids};
}
function purgeParticipantExportArtifacts_(participantId) {
  let matched=0,failed=0; const prefix='signal-calibration-export-'+String(participantId)+'-';
  const cleanup=()=>{
    const props=PropertiesService.getScriptProperties();
    let queue={}; try{queue=JSON.parse(props.getProperty(EXPORT_EXPIRY_PROPERTY)||'{}')||{};}catch(e){throw new Error('EXPORT_QUEUE_CORRUPT');}
    const keep={};
    Object.keys(queue).forEach(fileId=>{
      try{
        const file=DriveApp.getFileById(fileId), name=file&&file.getName?String(file.getName()||''):'';
        if(name.indexOf(prefix)===0){ file.setTrashed(true); matched++; }
        else keep[fileId]=queue[fileId];
      }catch(error){ keep[fileId]=queue[fileId]; failed++; }
    });
    props.setProperty(EXPORT_EXPIRY_PROPERTY,JSON.stringify(keep));
    if(DriveApp.searchFiles){
      const it=DriveApp.searchFiles("title contains '"+prefix.replace(/'/g,"\\'")+"' and trashed = false");
      while(it.hasNext()){
        const file=it.next(), name=file&&file.getName?String(file.getName()||''):'';
        if(name.indexOf(prefix)===0){ try{file.setTrashed(true);matched++;}catch(error){failed++;} }
      }
    }
  };
  const ok=withScriptLockContext_(cleanup);
  if(!ok) return {ok:false,matched:matched,failed:failed+1,status:'LOCK_TIMEOUT'};
  return {ok:failed===0,matched:matched,failed:failed,status:failed===0?'CONFIRMED':'PARTIAL_FAILURE'};
}
function deleteParticipantRowsAcrossStores_(participantId, keys) {
  const sid=keys.recordIds;
  deleteRowsWhere_(getParticipantsSheet_(),r=>String(r[COLS.PARTICIPANTS.ID])===String(participantId));
  deleteRowsWhere_(getSessionsSheet_(),r=>String(r[COLS.SESSIONS.PARTICIPANT_ID])===String(participantId));
  deleteRowsWhere_(getEventsSheet_(),r=>String(r[COLS.EVENTS.PARTICIPANT_ID])===String(participantId));
  deleteRowsWhere_(getIdempotencySheet_(),r=>String(r[COLS.IDEMPOTENCY.USER_ID])===String(participantId));
  deleteRowsWhere_(getSignalHistorySheet_(),r=>String(r[COLS.SIGNAL_HISTORY.PARTICIPANT_ID])===String(participantId));
  deleteRowsWhere_(getSetupHistorySheet_(),r=>String(r[COLS.SETUP_HISTORY.PARTICIPANT_ID])===String(participantId));
  deleteRowsWhere_(getConsentHistorySheet_(),r=>String(r[COLS.CONSENT_HISTORY.PARTICIPANT_ID])===String(participantId));
  deleteRowsWhere_(getTimezoneHistorySheet_(),r=>String(r[COLS.TIMEZONE_HISTORY.PARTICIPANT_ID])===String(participantId));
  deleteRowsWhere_(getCorruptionQuarantineSheet_(),r=>!!sid[String(r[COLS.CORRUPTION_QUARANTINE.RECORD_ID]||'')]);
  // Operations include the current webhook operation. Delete them only after the
  // content/provenance stores have been purged, then suppress any later attempt to
  // finalize the now-deleted operation row.
  deleteRowsWhere_(getOperationsSheet_(),r=>String(r[COLS.OPERATIONS.PARTICIPANT_ID])===String(participantId) || String(r[COLS.OPERATIONS.USER_ID])===String(participantId));
  markCurrentOperationRowPurged_();
  // Keep DataControlRequests until every participant/research store and the
  // applicable PE04 access-control transition have been confirmed. The request is
  // the durable operator reconciliation handle and is removed only at final success.
  deleteRowsWhere_(getCalibrationCyclesSheet_(),r=>String(r[COLS.CALIBRATION_CYCLES.PARTICIPANT_ID])===String(participantId));
  deleteRowsWhere_(getLearningRecordsSheet_(),r=>String(r[COLS.LEARNING_RECORDS.PARTICIPANT_ID])===String(participantId));
  deleteRowsWhere_(getAdjustmentPlansSheet_(),r=>String(r[COLS.ADJUSTMENT_PLANS.PARTICIPANT_ID])===String(participantId));
  deleteRowsWhere_(getTeachingExposureSheet_(),r=>String(r[COLS.TEACHING_EXPOSURE.PARTICIPANT_ID])===String(participantId));
  deleteRowsWhere_(getLayerDecisionsSheet_(),r=>String(r[COLS.LAYER_DECISIONS.PARTICIPANT_ID])===String(participantId));
  deleteRowsWhere_(getInterventionEpisodesSheet_(),r=>String(r[COLS.INTERVENTION_EPISODES.PARTICIPANT_ID])===String(participantId));
  deleteRowsWhere_(getTransferEpisodesSheet_(),r=>String(r[COLS.TRANSFER_EPISODES.PARTICIPANT_ID])===String(participantId));
  deleteRowsWhere_(getEvidenceObservationsSheet_(),r=>String(r[COLS.EVIDENCE_OBSERVATIONS.PARTICIPANT_ID])===String(participantId));
  deleteRowsWhere_(getEvidenceAssessmentsSheet_(),r=>String(r[COLS.EVIDENCE_ASSESSMENTS.PARTICIPANT_ID])===String(participantId));
}
function countRemainingParticipantRows_(participantId, keys) {
  keys=keys||collectParticipantDeletionKeys_(participantId); const sid=keys.recordIds;
  const counts={
    participants:readRows_(getParticipantsSheet_()).filter(r=>String(r[COLS.PARTICIPANTS.ID])===String(participantId)).length,
    sessions:readRows_(getSessionsSheet_()).filter(r=>String(r[COLS.SESSIONS.PARTICIPANT_ID])===String(participantId)).length,
    events:readRows_(getEventsSheet_()).filter(r=>String(r[COLS.EVENTS.PARTICIPANT_ID])===String(participantId)).length,
    idempotency:readRows_(getIdempotencySheet_()).filter(r=>String(r[COLS.IDEMPOTENCY.USER_ID])===String(participantId)).length,
    signalHistory:readRows_(getSignalHistorySheet_()).filter(r=>String(r[COLS.SIGNAL_HISTORY.PARTICIPANT_ID])===String(participantId)).length,
    setupHistory:readRows_(getSetupHistorySheet_()).filter(r=>String(r[COLS.SETUP_HISTORY.PARTICIPANT_ID])===String(participantId)).length,
    consentHistory:readRows_(getConsentHistorySheet_()).filter(r=>String(r[COLS.CONSENT_HISTORY.PARTICIPANT_ID])===String(participantId)).length,
    timezoneHistory:readRows_(getTimezoneHistorySheet_()).filter(r=>String(r[COLS.TIMEZONE_HISTORY.PARTICIPANT_ID])===String(participantId)).length,
    quarantine:readRows_(getCorruptionQuarantineSheet_()).filter(r=>!!sid[String(r[COLS.CORRUPTION_QUARANTINE.RECORD_ID]||'')]).length,
    dataControlRequests:readRows_(getDataControlRequestsSheet_()).filter(r=>String(r[COLS.DATA_CONTROL_REQUESTS.PARTICIPANT_ID])===String(participantId)).length,
    calibrationCycles:readRows_(getCalibrationCyclesSheet_()).filter(r=>String(r[COLS.CALIBRATION_CYCLES.PARTICIPANT_ID])===String(participantId)).length,
    learningRecords:readRows_(getLearningRecordsSheet_()).filter(r=>String(r[COLS.LEARNING_RECORDS.PARTICIPANT_ID])===String(participantId)).length,
    adjustmentPlans:readRows_(getAdjustmentPlansSheet_()).filter(r=>String(r[COLS.ADJUSTMENT_PLANS.PARTICIPANT_ID])===String(participantId)).length,
    teachingExposure:readRows_(getTeachingExposureSheet_()).filter(r=>String(r[COLS.TEACHING_EXPOSURE.PARTICIPANT_ID])===String(participantId)).length,
    layerDecisions:readRows_(getLayerDecisionsSheet_()).filter(r=>String(r[COLS.LAYER_DECISIONS.PARTICIPANT_ID])===String(participantId)).length,
    interventionEpisodes:readRows_(getInterventionEpisodesSheet_()).filter(r=>String(r[COLS.INTERVENTION_EPISODES.PARTICIPANT_ID])===String(participantId)).length,
    transferEpisodes:readRows_(getTransferEpisodesSheet_()).filter(r=>String(r[COLS.TRANSFER_EPISODES.PARTICIPANT_ID])===String(participantId)).length,
    evidenceObservations:readRows_(getEvidenceObservationsSheet_()).filter(r=>String(r[COLS.EVIDENCE_OBSERVATIONS.PARTICIPANT_ID])===String(participantId)).length,
    evidenceAssessments:readRows_(getEvidenceAssessmentsSheet_()).filter(r=>String(r[COLS.EVIDENCE_ASSESSMENTS.PARTICIPANT_ID])===String(participantId)).length,
    operations:readRows_(getOperationsSheet_()).filter(r=>String(r[COLS.OPERATIONS.PARTICIPANT_ID])===String(participantId)||String(r[COLS.OPERATIONS.USER_ID])===String(participantId)).length
  };
  counts.total=Object.keys(counts).reduce((n,k)=>n+counts[k],0); return counts;
}
function markCurrentOperationRowPurged_() {
  if(!currentOperationContext_) return;
  currentOperationContext_.dataDeletionOperationPurged=true;
  currentOperationContext_.rowNumber=0;
  currentOperationContext_.artifacts=[];
}
function markCurrentOperationPurged_(auditId) {
  if(!currentOperationContext_) return;
  currentOperationContext_.participantDataDeleted=true;
  currentOperationContext_.dataDeletionOperationPurged=true;
  currentOperationContext_.deletionAuditId=String(auditId||'');
  currentOperationContext_.rowNumber=0;
  currentOperationContext_.artifacts=[];
}
function deleteParticipant_(participantId, chatId, requestId, deletionMode, lock) {
  const mode=String(deletionMode||'');
  if(mode!==DELETION_MODE.PRE_ENROLLMENT && mode!==DELETION_MODE.POST_ENROLLMENT) throw new Error('DELETION_MODE_REQUIRED');
  if(!lock || typeof lock.hasLock!=='function' || lock.hasLock()!==true) throw new Error('DELETION_SCRIPT_LOCK_REQUIRED');

  // Before any destructive work, prove the access-control condition required by
  // the persisted deletion class. Post-enrollment deletion must be RETIRING (or
  // already LOCKED during idempotent reconciliation). Pre-enrollment deletion must
  // still have no lifetime marker; any contradiction fails closed.
  if(mode===DELETION_MODE.POST_ENROLLMENT) {
    const retirement=ensureDeletionRetirementState_(participantId,lock);
    if(!retirement.ok) {
      try { appendDataControlAudit_(participantId,'DELETE','PARTIAL_FAILURE',0,{cleanupStatus:'RETIRING_UNCONFIRMED',reconciliationStatus:'REQUIRED'}); } catch(auditError) {}
      log_('DELETE_RETIRING_UNCONFIRMED',{participantFingerprint:participantFingerprint_(participantId),message:String(retirement.reason||'unknown')});
      if(chatId) sendTelegram_('Deletion could not continue because the repeat-enrollment lock could not be verified. No additional deletion is being claimed. Operator reconciliation is required.',chatId);
      return false;
    }
  } else {
    const eligibility=readDeletionEligibility_(participantId,lock);
    if(!eligibility.ok || eligibility.exists) {
      try { appendDataControlAudit_(participantId,'DELETE','PARTIAL_FAILURE',0,{cleanupStatus:'PRE_ENROLLMENT_ELIGIBILITY_CONTRADICTION',reconciliationStatus:'REQUIRED'}); } catch(auditError) {}
      log_('DELETE_PRE_ENROLLMENT_ELIGIBILITY_CONTRADICTION',{participantFingerprint:participantFingerprint_(participantId),message:eligibility.ok?'lifetime_marker_present':String(eligibility.reason||'unknown')});
      if(chatId) sendTelegram_('Deletion could not continue because enrollment status changed or could not be verified safely. No additional deletion is being claimed. Operator reconciliation is required.',chatId);
      return false;
    }
  }

  const keys=collectParticipantDeletionKeys_(participantId);
  let exportResult={ok:false,matched:0,failed:0,status:'NOT_RUN'};
  try{
    exportResult=purgeParticipantExportArtifacts_(participantId);
    if(!exportResult.ok) throw new Error('EXPORT_ARTIFACT_CLEANUP_UNCONFIRMED:'+exportResult.status);
    deleteParticipantRowsAcrossStores_(participantId,keys);
  }catch(error){
    const remaining=countRemainingParticipantRows_(participantId,keys);
    appendDataControlAudit_(participantId,'DELETE','PARTIAL_FAILURE',remaining.total,{cleanupStatus:exportResult.status,reconciliationStatus:'REQUIRED'});
    log_('DELETE_PARTIAL_FAILURE',{participantFingerprint:participantFingerprint_(participantId),remainingCount:remaining.total,message:safeErrorMessage_(error),deletionMode:mode});
    if(chatId) sendTelegram_('Some of your data could not be confirmed deleted. No success is being claimed. The retained deletion request can be reconciled by the bot operator.',chatId);
    return false;
  }

  // DataControlRequests intentionally remain until all other Sheets-backed stores
  // are clear and the applicable access-control transition has been verified.
  const remainingBeforeGate=countRemainingParticipantRows_(participantId,keys);
  const nonRequestResidual=Math.max(0,remainingBeforeGate.total-remainingBeforeGate.dataControlRequests);
  if(nonRequestResidual!==0){
    appendDataControlAudit_(participantId,'DELETE','PARTIAL_FAILURE',remainingBeforeGate.total,{cleanupStatus:exportResult.status,reconciliationStatus:'REQUIRED'});
    if(chatId) sendTelegram_('Some of your data could not be confirmed deleted ('+remainingBeforeGate.total+' record(s) remain). No success is being claimed. The retained deletion request requires reconciliation.',chatId);
    return false;
  }

  // PE04 access-control boundary: remove only the current channel-membership cache.
  // Lifetime eligibility is handled independently and is never deleted here.
  let membershipDeleted=false, membershipDeleteError='';
  try {
    membershipDeleted=typeof channelGateForgetMembership_==='function' && channelGateForgetMembership_(participantId,lock)===true;
  } catch(error) { membershipDeleteError=safeErrorMessage_(error); }
  if(!membershipDeleted){
    const residualCount=remainingBeforeGate.dataControlRequests+1;
    appendDataControlAudit_(participantId,'DELETE','PARTIAL_FAILURE',residualCount,{cleanupStatus:'MEMBERSHIP_CACHE_UNCONFIRMED',reconciliationStatus:'REQUIRED'});
    log_('DELETE_MEMBERSHIP_CACHE_UNCONFIRMED',{participantFingerprint:participantFingerprint_(participantId),remainingCount:residualCount,message:membershipDeleteError||'MEMBERSHIP_CACHE_DELETE_UNCONFIRMED',deletionMode:mode});
    if(chatId) sendTelegram_('Some access data could not be confirmed deleted. No success is being claimed. The retained deletion request requires operator reconciliation.',chatId);
    return false;
  }

  if(mode===DELETION_MODE.POST_ENROLLMENT) {
    let locked=false, lockError='';
    try {
      const before=readDeletionEligibility_(participantId,lock);
      if(before.ok && before.exists && before.state==='LOCKED') locked=true;
      else if(typeof channelGateCompleteRetirement_==='function') locked=channelGateCompleteRetirement_(participantId,lock)===true;
      const after=readDeletionEligibility_(participantId,lock);
      locked=locked && after.ok===true && after.exists===true && after.state==='LOCKED';
    } catch(error) { lockError=safeErrorMessage_(error); locked=false; }
    if(!locked) {
      const residualCount=remainingBeforeGate.dataControlRequests+1;
      appendDataControlAudit_(participantId,'DELETE','PARTIAL_FAILURE',residualCount,{cleanupStatus:'LIFETIME_LOCK_UNCONFIRMED',reconciliationStatus:'REQUIRED'});
      log_('DELETE_LIFETIME_LOCK_UNCONFIRMED',{participantFingerprint:participantFingerprint_(participantId),remainingCount:residualCount,message:lockError||'LIFETIME_LOCK_PERSISTENCE_UNCONFIRMED'});
      if(chatId) sendTelegram_('Your participant/research data is no longer present, but the repeat-enrollment lock could not be confirmed. No deletion success is being claimed. Operator reconciliation is required.',chatId);
      return false;
    }
  } else {
    // Pre-enrollment purge must not create or inherit a lifetime lock.
    const afterMembership=readDeletionEligibility_(participantId,lock);
    if(!afterMembership.ok || afterMembership.exists) {
      const residualCount=remainingBeforeGate.dataControlRequests+1;
      appendDataControlAudit_(participantId,'DELETE','PARTIAL_FAILURE',residualCount,{cleanupStatus:'PRE_ENROLLMENT_LOCK_STATE_UNCONFIRMED',reconciliationStatus:'REQUIRED'});
      if(chatId) sendTelegram_('Your setup data is no longer present, but first-participation eligibility could not be verified safely. No deletion success is being claimed. Operator reconciliation is required.',chatId);
      return false;
    }
  }

  // Access-control state and participant/research purge are now confirmed while
  // DataControlRequests still retains the exact operator reconciliation handle.
  // Commit durable PURGE_CONFIRMED evidence first; only then may that handle be
  // retired. This makes an audit-write failure recoverable instead of orphaning it.
  const updateFingerprint=currentOperationContext_?deletionUpdateFingerprint_(participantId,currentOperationContext_.updateId):'';
  let auditId='';
  try {
    auditId=appendDataControlAudit_(participantId,'DELETE','PURGE_CONFIRMED',0,{cleanupStatus:mode==='POST_ENROLLMENT'?'CONFIRMED_LIFETIME_LOCK_RETAINED':'CONFIRMED_PRE_ENROLLMENT',reconciliationStatus:'NOT_REQUIRED',updateFingerprint:updateFingerprint});
  } catch(auditError) {
    log_('DELETE_PURGE_AUDIT_FAILED',{participantFingerprint:participantFingerprint_(participantId),message:safeErrorMessage_(auditError),deletionMode:mode});
    if(chatId) sendTelegram_('Your deletion reached the final cleanup boundary, but confirmation could not be recorded. No success message is being issued. The retained deletion request remains available for operator reconciliation.',chatId);
    return false;
  }

  // Durable completion evidence exists. Retire deletion-control request rows only
  // after that point, then require the final all-store residual check before success.
  try {
    deleteRowsWhere_(getDataControlRequestsSheet_(),r=>String(r[COLS.DATA_CONTROL_REQUESTS.PARTICIPANT_ID])===String(participantId));
  } catch (requestDeleteError) {
    const remainingAfterRequestFailure=countRemainingParticipantRows_(participantId,keys);
    appendDataControlAudit_(participantId,'DELETE','PARTIAL_FAILURE',remainingAfterRequestFailure.total,{cleanupStatus:'DELETE_REQUEST_CLEANUP_FAILED_AFTER_PURGE_CONFIRMATION',reconciliationStatus:'REQUIRED'});
    log_('DELETE_REQUEST_CLEANUP_FAILED',{participantFingerprint:participantFingerprint_(participantId),remainingCount:remainingAfterRequestFailure.total,message:safeErrorMessage_(requestDeleteError),deletionMode:mode});
    if(chatId) sendTelegram_('Your participant/research purge was confirmed, but deletion-control cleanup could not be confirmed. No success message is being issued. The retained request remains available for operator reconciliation.',chatId);
    return false;
  }

  const finalRemaining=countRemainingParticipantRows_(participantId,keys);
  if(finalRemaining.total!==0){
    appendDataControlAudit_(participantId,'DELETE','PARTIAL_FAILURE',finalRemaining.total,{cleanupStatus:'FINAL_RESIDUAL_CHECK_FAILED_AFTER_PURGE_CONFIRMATION',reconciliationStatus:'REQUIRED'});
    log_('DELETE_FINAL_RESIDUAL',{participantFingerprint:participantFingerprint_(participantId),remainingCount:finalRemaining.total,deletionMode:mode});
    if(chatId) sendTelegram_('Some deletion-control data could not be confirmed cleared ('+finalRemaining.total+' record(s) remain). No success is being claimed. Operator reconciliation is required.',chatId);
    return false;
  }

  markCurrentOperationPurged_(auditId);
  if(chatId) {
    if(mode===DELETION_MODE.POST_ENROLLMENT) sendTelegram_('Your Signal Calibration participant/research data has been deleted. Limited pseudonymous governance/control evidence is intentionally retained: the repeat-enrollment eligibility marker, deletion-audit evidence, and any applicable repeat-participation request/grant records under their access-control lifecycle. These retained records contain no Telegram ID, Signal Calibration answers, or deleted research records. Another independent participation requires owner authorization.',chatId);
    else sendTelegram_('Your setup/bot data has been deleted. You had not completed Signal Calibration enrollment, so your one automatic participation entitlement was not consumed. The current channel-membership verification cache was removed.',chatId);
  }
  return true;
}
function reconcileDeletionRequest_(requestId) {
  // PE04 preserves R17's ScriptLock discipline. The persisted request STATUS carries
  // the deletion class so reconciliation remains deterministic even if Participants
  // was already removed by a previous partial pass. Standalone reconciliation acquires
  // the global ScriptLock and publishes it through currentScriptLockContext_ so nested
  // deletion/export cleanup recognizes the same held lock instead of self-acquiring.
  let lock = null, acquired = false;
  const priorLock = currentScriptLockContext_;
  try {
    try { lock = currentHeldScriptLock_(); }
    catch(contextError) {
      if (!contextError || String(contextError.message || '') !== 'SCRIPT_LOCK_CONTEXT_REQUIRED') throw contextError;
    }
    if (!lock) {
      lock = LockService.getScriptLock();
      try { lock.waitLock(30000); acquired = true; currentScriptLockContext_ = lock; }
      catch(error) { log_('DELETE_RECONCILIATION_LOCK_TIMEOUT',{message:safeErrorMessage_(error)}); return false; }
    }
    const rows=readRows_(getDataControlRequestsSheet_()); const idx=rows.findIndex(r=>String(r[COLS.DATA_CONTROL_REQUESTS.REQUEST_ID])===String(requestId));
    if(idx<0) throw new Error('DELETION_REQUEST_NOT_FOUND');
    const row=rows[idx], participantId=String(row[COLS.DATA_CONTROL_REQUESTS.PARTICIPANT_ID]), status=String(row[COLS.DATA_CONTROL_REQUESTS.STATUS]||'');
    let mode=deletionModeFromRequestStatus_(status);

    if(!mode && status===DELETION_REQUEST_STATUS.RECONCILIATION_REQUIRED) {
      const classification=classifyDeletionRequest_(participantId,lock);
      if(!classification.ok) { log_('DELETE_RECONCILIATION_CLASSIFICATION_UNRESOLVED',{participantFingerprint:participantFingerprint_(participantId),message:String(classification.reason||'unknown')}); return false; }
      if(classification.mode===DELETION_MODE.POST_ENROLLMENT) {
        const retirement=ensureDeletionRetirementState_(participantId,lock);
        if(!retirement.ok) { log_('DELETE_RECONCILIATION_RETIRING_UNCONFIRMED',{participantFingerprint:participantFingerprint_(participantId),message:String(retirement.reason||'unknown')}); return false; }
        mode=DELETION_MODE.POST_ENROLLMENT;
        setDeletionRequestStatusVerified_(rowNumber_(idx),DELETION_REQUEST_STATUS.CONFIRMED_POST_ENROLLMENT,'delete_reconciliation_classify_post');
      } else {
        mode=DELETION_MODE.PRE_ENROLLMENT;
        setDeletionRequestStatusVerified_(rowNumber_(idx),DELETION_REQUEST_STATUS.CONFIRMED_PRE_ENROLLMENT,'delete_reconciliation_classify_pre');
      }
    }

    if(!mode) {
      log_('DELETE_RECONCILIATION_STATUS_NOT_ACTIONABLE',{participantFingerprint:participantFingerprint_(participantId),status:status});
      return false;
    }
    return deleteParticipant_(participantId,'',requestId,mode,lock);
  } finally {
    if (acquired) {
      currentScriptLockContext_ = priorLock;
      lock.releaseLock();
    }
  }
}

const OPERATOR_DELETION_RECONCILE_PROPERTY = 'SCB_RECONCILE_DELETION_REQUEST_ID';
function reconcileConfiguredDeletionRequest() {
  const props = PropertiesService.getScriptProperties();
  const requestId = String(props.getProperty(OPERATOR_DELETION_RECONCILE_PROPERTY) || '').trim();
  if (!requestId) throw new Error('SCB_RECONCILE_DELETION_REQUEST_ID_REQUIRED');
  const ok = reconcileDeletionRequest_(requestId);
  if (ok !== true) throw new Error('DELETION_RECONCILIATION_INCOMPLETE');
  props.deleteProperty(OPERATOR_DELETION_RECONCILE_PROPERTY);
  log_('OPERATOR_DELETION_RECONCILED', {requestId:requestId,status:'COMPLETE'});
  return true;
}

function isDeletedUpdateReplay_(participantId, updateId) {
  const fp=deletionUpdateFingerprint_(participantId,updateId);
  return readRows_(getDataControlAuditSheet_()).some(r=>String(r[COLS.DATA_CONTROL_AUDIT.ACTION])==='DELETE' && String(r[COLS.DATA_CONTROL_AUDIT.OUTCOME])==='PURGE_CONFIRMED' && String(r[COLS.DATA_CONTROL_AUDIT.UPDATE_FINGERPRINT])===fp);
}

// SCF07 final disposition: participant export is formally not supported in this
// build. The previous anyone-with-link implementation is retained only in history;
// this build never creates or shares a new export file. Legacy export-artifact
// cleanup helpers remain because deletion must still remove any historical temporary
// files that can be identified.
function exportParticipantData_(participantId, chatId) {
  appendDataControlAudit_(participantId,'EXPORT','FORMALLY_NOT_SUPPORTED',0,{accessMechanism:'NOT_SUPPORTED',expiryTarget:'NOT_APPLICABLE',expiryConfirmed:'NOT_APPLICABLE',cleanupStatus:'NOT_APPLICABLE',reconciliationStatus:'NOT_REQUIRED'});
  sendTelegram_('This version cannot generate a participant data-export file. This request has not created or shared an export file. Use /privacy to read how data is handled. /delete-data is a separate, confirmed deletion action.',chatId);
  return false;
}

function csvRow_(row) {
  return row.map(value => '"' + String(value === null || value === undefined ? '' : value).replace(/"/g, '""') + '"').join(',');
}

// F39/R2 lock-context correction: the historical helper used DocumentLock as a
// second lock scope around export-expiry and trigger check-then-act operations.
// In web-app execution that container-scoped lock is not a safe dependency, while
// blindly reacquiring ScriptLock would self-timeout when doPost already owns it.
// This helper therefore treats currentScriptLockContext_ as the application lock
// context: reuse only when currentHeldScriptLock_ proves the lock is actually held;
// otherwise acquire the global ScriptLock with the prior bounded 10-second helper
// timeout. Standalone ownership is installed in currentScriptLockContext_ for nested
// protected calls and restored/released in finally. Caller-visible timeout remains
// boolean false; callback exceptions still propagate and are never converted to timeout.
function withScriptLockContext_(fn) {
  let heldLock = null;
  try { heldLock = currentHeldScriptLock_(); }
  catch (contextError) {
    if (!contextError || String(contextError.message || '') !== 'SCRIPT_LOCK_CONTEXT_REQUIRED') throw contextError;
  }
  if (heldLock) {
    fn();
    return true;
  }

  const priorLock = currentScriptLockContext_;
  const lock = LockService.getScriptLock();
  let acquired = false;
  try {
    try {
      lock.waitLock(10000);
      acquired = true;
      currentScriptLockContext_ = lock;
    } catch (lockError) {
      log_('SCRIPT_LOCK_CONTEXT_TIMEOUT', {
        message: safeErrorMessage_(lockError)
      });
      return false;
    }
    fn();
    return true;
  } finally {
    if (acquired) {
      currentScriptLockContext_ = priorLock;
      lock.releaseLock();
    }
  }
}

// F38 CHANGE NOTE (Section E fix pack, FIX-E1-8, fixes audit finding E1):
// previously, the ScriptApp.newTrigger(...).create() call below was
// unguarded inside this locked callback. withScriptLockContext_ (historically named
// withExportExpiryLock_) allows callback exceptions to propagate, so a
// throw from create() (e.g. a trigger-quota condition) propagated straight
// out of scheduleExportExpiry_ into exportParticipantData_'s catch block —
// which trashes the just-created, just-shared export file and tells the
// participant "I could not create your export," even though the export
// itself succeeded and only the auto-expiry scheduling failed. The
// trigger-install call is now caught inside the callback, so a failure here
// is logged via the existing EXPORT_EXPIRY_SCHEDULE_FAILED event (with a
// `reason` field added to distinguish this case from the pre-existing
// lock-timeout case below) and does not propagate — the export still
// succeeds from the participant's perspective; an operator handles the
// orphaned file manually via the log.
function scheduleExportExpiry_(fileId) {
  const ok = withScriptLockContext_(() => {
    const properties = PropertiesService.getScriptProperties();
    const queue = JSON.parse(properties.getProperty(EXPORT_EXPIRY_PROPERTY) || '{}');
    queue[fileId] = Date.now() + EXPORT_TTL_MS;
    properties.setProperty(EXPORT_EXPIRY_PROPERTY, JSON.stringify(queue));
    try {
      if (!ScriptApp.getProjectTriggers().some(trigger => trigger.getHandlerFunction() === 'expireExportFiles_')) {
        ScriptApp.newTrigger('expireExportFiles_').timeBased().everyMinutes(5).create();
      }
    } catch (triggerError) {
      // Caught here, inside the locked callback, so it does NOT propagate up
      // through withScriptLockContext_'s callback into scheduleExportExpiry_'s
      // caller (exportParticipantData_). The queue write above has already
      // committed, so the export-expiry record still exists even though no
      // trigger will run to act on it — same residual risk as the lock-timeout
      // case below, logged the same way.
      log_('EXPORT_EXPIRY_SCHEDULE_FAILED', {
        fileId: fileId, reason: 'trigger_install_failed', message: safeErrorMessage_(triggerError)
      });
    }
  });
  if (!ok) {
    // The export file itself was already created and shared by the time this runs
    // (see exportParticipantData_) — a lost expiry-schedule write here means that
    // file will never be trashed automatically. Log distinctly so an operator can
    // manually trash it; this is a real residual risk under lock contention, not
    // silently swallowed.
    log_('EXPORT_EXPIRY_SCHEDULE_FAILED', {
      fileId: fileId, reason: 'lock_timeout'
    });
  }
}
// Installable trigger target. Drive's public-link permissions are removed by trashing
// the temporary file. F-D4 CHANGE NOTE: trigger timing is approximate — this
// only runs every 5 minutes (see scheduleExportExpiry_'s everyMinutes(5)), so
// a file whose EXPORT_TTL_MS (15 min) expiry falls just after a tick can wait
// almost another 5 minutes before this actually trashes it. Real worst-case
// bound is therefore up to ~20 minutes, not ~15 — the user-facing message in
// exportParticipantData_ states this bound and must be kept in sync with this
// comment if EXPORT_TTL_MS or the trigger interval ever changes.
// F51 CHANGE-CONTROL (Round 5, Section H fix pack, fixes audit finding H2):
// renamed from expireExportFiles to expireExportFiles_. This file's
// underscore-suffix convention marks a function as private/internal-only;
// of 85 top-level functions, only 3 lacked it before this fix. doPost is a
// forced exception (Apps Script's reserved web-app entry-point name, cannot
// be renamed). setTelegramWebhook is a legitimate, if previously
// undocumented, exception — its own redundant Script-Properties fallback
// (independent of configureWebhookOnce_'s identical read) only makes sense
// if it's meant to be run standalone from the Apps Script editor's function
// dropdown, e.g. after a redeploy per F41's operator warning; kept public,
// now documented as such. expireExportFiles had no such justification and no
// comment anywhere explained the exception — it is an installable time-based
// trigger target in exactly the same category as pruneIdempotencyTable_
// (same file, same pattern, same "referenced by string name via
// ScriptApp.newTrigger" mechanism), which already correctly carried the
// underscore. One existing comment (the "Installable trigger target" note
// immediately above pruneIdempotencyTable_'s own definition) already called
// this function "expireExportFiles_" with the underscore, ahead of the code
// actually matching — this fix makes the code match that comment rather than
// the reverse. Both the ScriptApp.newTrigger registration call (in
// scheduleExportExpiry_ above) and this definition were updated together, so
// the trigger's registered handler-function name and this function's actual
// name still match exactly — Apps Script resolves installable triggers by
// exact string name, so a partial rename would silently break the trigger.
// Retesting required: yes — confirm scheduleExportExpiry_ still successfully
// installs the trigger under the new name (no EXPORT_EXPIRY_SCHEDULE_FAILED
// log entry with reason trigger_install_failed) and that the trigger, once
// installed, still fires and executes expireExportFiles_ on its 5-minute
// schedule exactly as before the rename.
function expireExportFiles_() {
  withScriptLockContext_(() => {
    const properties = PropertiesService.getScriptProperties();
    const queue = JSON.parse(properties.getProperty(EXPORT_EXPIRY_PROPERTY) || '{}');
    const now = Date.now();
    Object.keys(queue).forEach(fileId => {
      if (Number(queue[fileId]) <= now) {
        try {
          DriveApp.getFileById(fileId).setTrashed(true);
          delete queue[fileId];
        } catch (error) {
          // P08: failed cleanup stays queued for a later retry. A failed trash
          // operation must never be converted into a false expiry confirmation.
          log_('EXPORT_EXPIRY_ERROR', { message: safeErrorMessage_(error) });
        }
      }
    });
    properties.setProperty(EXPORT_EXPIRY_PROPERTY, JSON.stringify(queue));
  });
}
// F29 (Section C fix pack, F-C6): run manually, once, ONLY if this script is
// being deployed against a Participants sheet that already has rows from
// before this fix (7 columns, no TIMEZONE). A fresh sheet created by
// getOrCreateSheet_ needs no migration — validateSheetSchema_ already
// tolerates a genuinely empty sheet (actualColumns === 0). This function
// exists because validateSheetSchema_ is deliberately strict everywhere
// else (it exists to catch real schema corruption, per
// classifyProcessingError_'s schema_corruption category), so weakening that
// check to silently tolerate two different Participants shapes was
// rejected as riskier than a one-time explicit migration step — this
// matches configureWebhookOnce_'s existing pattern of a manually-run,
// one-time setup function rather than defensive runtime tolerance. For
// this project's current phase (master doc: no real usability testing has
// run yet, so no pilot has live Participants data), this function is
// expected to be a no-op / unnecessary in practice; it exists for honesty
// about the migration path rather than because it's anticipated to be used
// imminently.
// F36 CHANGE NOTE: this function's row-1-literal below (was ROWS.FIRST_DATA
// before F36) is intentionally NOT updated to the new ROWS.FIRST_DATA (2).
// This function's whole purpose is migrating a sheet still in the PRE-F36
// headerless shape (its own docstring above: "7 columns, no TIMEZONE"), on
// which row 1 is real data, not a header — ROWS.FIRST_DATA now means
// "first data row in the current (headered) layout," which is a different
// row on a sheet this function is specifically written to expect is not yet
// in that layout. Using the current constant here would skip row 1's real
// data and silently corrupt the migration. It also does not call readRows_
// or validateSheetSchema_ (reads lastRow/lastCol via the Sheets API
// directly), so it is unaffected by F36's new header-identity check and
// does not need migrateHeaderRow_ to have run first — the two migrations
// are independent and may run in either order. See migrateHeaderRow_ below
// for the separate, current-format migration.
// F56 CHANGE-CONTROL (Round 5, Section K fix pack, fixes audit finding K2,
// MINOR): traced the partial-migration case (some Participants rows written
// pre-F29 with 7 columns, some post-F29 with 8, e.g. a new signup via
// getOrCreateParticipant_ landing before this migration is ever run against
// an old sheet). getLastColumn() is sheet-wide — it reflects the widest row
// written anywhere, not whether every row was actually migrated. In that
// mixed state this function's lastCol === COUNT check is true and it skips,
// logging "already_migrated," which is not accurate: the older rows were
// never touched by this function. This is functionally harmless — readRows_
// always reads via getRange(..., getLastColumn()), and Sheets pads short
// rows with empty-string cells up to the read width, so an old row's
// TIMEZONE cell reads as '' either way, and isKnownTimezone_('') correctly
// falls back to NO_DEFAULT_PROJECT_TIMEZONE (see getParticipantTimezone_,
// confirmed by this round's K3 trace) — so no downstream read is wrong. The
// problem is purely diagnostic: an operator reading this log reasonably
// concludes an explicit backfill happened when it didn't, which would be
// misleading if any future code ever reads this column without going
// through readRows_'s full-width padding behavior. Renamed the log reason
// to make the actual sheet-wide-column-width basis of the skip decision
// explicit, without changing the skip decision itself — changing the skip
// condition to a true per-row check is out of scope here (K2 found this
// harmless, not incorrect; the current 2x-headroom-style safety comes from
// readRows_'s read-width behavior, not from this function's own check, and
// re-deriving migration around that dependency is a larger change than this
// pilot's error rate warrants). Retesting: no — log-message-only change, no
// control flow or data touched.
// F59 CHANGE-CONTROL addendum (caught while implementing F59, not part of
// the approved design note's scope, but disclosed per this project's own
// honesty standard rather than silently left as a side effect): this
// function's two checks below used to read
// `lastCol === COLS.PARTICIPANTS.COUNT` / `!== COLS.PARTICIPANTS.COUNT - 1`,
// which meant "8" / "7" back when COUNT was 8. F59 raised COUNT to 10, which
// would have silently changed this function's actual detection target to
// "10" / "9" — wrong for what this function does (detect a sheet still at
// the pre-F29, 7-column width) and unrelated to F59's own migration
// (handled separately by migrateParticipantsAddLayerReflectionColumns_
// below, which checks the correct pre-F59 width of 8). Pinned to explicit
// literals (8, 7) so this function's behavior is fixed to the specific
// historical migration it was written for, not coupled to COUNT's current
// value. Retested: no functional change from pre-F59 behavior when COUNT
// was 8 — 8 === 8 and 7 === 8-1 are the same comparisons the old relative
// form produced at that COUNT value.

// P04 governed migration path. Legacy one-off mutators are disabled below.
function classifySheetLayout_(sheet) {
  const name = sheet.getName();
  const expected = HEADERS[name];
  if (!expected) return {name:name,status:'UNKNOWN',action:'REJECT_UNKNOWN_SHEET'};
  const lr=sheet.getLastRow(), lc=sheet.getLastColumn();
  if (lr===0 && lc===0) return {name:name,status:'EMPTY',action:'WRITE_CURRENT_HEADER'};
  const width=Math.max(lc, expected.length);
  const first=sheet.getRange(1,1,1,width).getValues()[0].map(String);
  const current=expected.every((h,i)=>first[i]===h) && lc===expected.length;
  if (current) return {name:name,status:'CURRENT',action:'NONE'};
  const nonempty=first.filter(v=>v!=='');
  const dup=nonempty.some((v,i)=>nonempty.indexOf(v)!==i);
  if (dup) return {name:name,status:'CORRUPT',action:'REJECT_DUPLICATE_HEADER'};
  const expectedSet={}; expected.forEach(h=>expectedSet[h]=true);
  const headerHits=nonempty.filter(v=>expectedSet[v]).length;
  if (headerHits>0 && headerHits<Math.min(nonempty.length,expected.length)) return {name:name,status:'CORRUPT',action:'REJECT_PARTIAL_OR_SHIFTED_HEADER'};
  if (name==='Participants') {
    const h7=expected.slice(0,7), h8=expected.slice(0,8);
    if (lc===7 && h7.every((h,i)=>first[i]===h)) return {name:name,status:'LEGACY_HEADERED_7',action:'EXPAND_PARTICIPANTS'};
    if (lc===8 && h8.every((h,i)=>first[i]===h)) return {name:name,status:'LEGACY_HEADERED_8',action:'EXPAND_PARTICIPANTS'};
    if ((lc===7 || lc===8 || lc===expected.length) && headerHits===0) return {name:name,status:'LEGACY_HEADERLESS_'+lc,action:'INSERT_HEADER_AND_EXPAND'};
  }
  if (name==='Idempotency') {
    if (lc===4 && expected.slice(0,4).every((h,i)=>first[i]===h)) return {name:name,status:'LEGACY_P04_HEADERED',action:'EXPAND_IDEMPOTENCY'};
    if (lc===3 && expected.slice(0,3).every((h,i)=>first[i]===h)) return {name:name,status:'LEGACY_P03_HEADERED',action:'EXPAND_IDEMPOTENCY'};
  }
  if (name==='SignalHistory' && lc===expected.length-1 && expected.slice(0,lc).every((h,i)=>first[i]===h)) {
    return {name:name,status:'LEGACY_P03_HEADERED',action:'EXPAND_APPEND_ONLY'};
  }
  if (lc===expected.length && headerHits===0) return {name:name,status:'LEGACY_HEADERLESS_CURRENT_WIDTH',action:'INSERT_HEADER'};
  if (lc>0 && lc<expected.length && expected.slice(0,lc).every((h,i)=>first[i]===h)) return {name:name,status:'LEGACY_PREFIX_'+lc,action:'EXPAND_APPEND_ONLY'};
  return {name:name,status:'CORRUPT',action:'REJECT_UNKNOWN_OR_MIXED_LAYOUT'};
}
function inspectStorageSchema_() {
  const names=Object.keys(HEADERS);
  const sheets=[]; let rejected=false;
  names.forEach(name=>{ const ss=getSpreadsheet_(); const sh=ss.getSheetByName(name); if(!sh){sheets.push({name:name,status:'MISSING',action:'CREATE_CURRENT'});return;} const c=classifySheetLayout_(sh); sheets.push(c); if(c.action.indexOf('REJECT_')===0) rejected=true; });
  return { schemaVersion:SCB_STORAGE_SCHEMA_VERSION, migrationVersion:SCB_STORAGE_MIGRATION_VERSION, rejected:rejected, sheets:sheets };
}
function dryRunStorageMigration_() {
  const plan=inspectStorageSchema_();
  const serialized=JSON.stringify(plan);
  plan.planHash=contentFingerprint_(serialized).fingerprint;
  return plan;
}
function createStorageMigrationBackup_() {
  const ss=getSpreadsheet_();
  if (!ss.getId) throw new Error('MIGRATION_BACKUP_UNAVAILABLE');
  const file=DriveApp.getFileById(ss.getId());
  if (!file || !file.makeCopy) throw new Error('MIGRATION_BACKUP_UNAVAILABLE');
  const backup=file.makeCopy('SCB-migration-backup-'+Date.now());
  if (!backup || !backup.getId) throw new Error('MIGRATION_BACKUP_FAILED');
  return String(backup.getId());
}
function applySheetMigrationAction_(sheet, item) {
  const expected=HEADERS[item.name];
  if (item.action==='NONE') return;
  if (item.action==='WRITE_CURRENT_HEADER') { storageSetValues_(sheet,1,1,[expected],'migration_header'); return; }
  if (item.action==='INSERT_HEADER') { storageInsertRowBefore_(sheet,1,'migration_insert_header'); storageSetValues_(sheet,1,1,[expected],'migration_header'); return; }
  if (item.action==='EXPAND_PARTICIPANTS') {
    storageSetValues_(sheet,1,1,[expected],'migration_expand_header');
    const lr=sheet.getLastRow(); if(lr>=ROWS.FIRST_DATA){ const vals=[]; for(let r=ROWS.FIRST_DATA;r<=lr;r++) vals.push(['','[]']); storageSetValues_(sheet,ROWS.FIRST_DATA,COLS.PARTICIPANTS.LAYER_CHECKPOINT_FLAG+1,vals,'migration_participant_layer_backfill'); }
    return;
  }
  if (item.action==='EXPAND_IDEMPOTENCY') {
    const legacyWidth=sheet.getLastColumn();
    storageSetValues_(sheet,1,1,[expected],'migration_expand_idempotency_header');
    const lr=sheet.getLastRow();
    if(lr>=ROWS.FIRST_DATA){
      const rows=sheet.getRange(ROWS.FIRST_DATA,1,lr-ROWS.FIRST_DATA+1,legacyWidth).getValues();
      const vals=rows.map(row=>{
        const opId=legacyWidth>=4?String(row[COLS.IDEMPOTENCY.OPERATION_ID]||''):'';
        let state=IDEMPOTENCY_STATUS.RECONCILIATION_REQUIRED, result='MIGRATED_NO_OPERATION_ID';
        if(opId){ const op=findOperationById_(opId); const opStatus=op?String(op.row[COLS.OPERATIONS.STATUS]):'UNKNOWN'; if(opStatus===OPERATION_STATUS.COMMITTED||opStatus===OPERATION_STATUS.RECONCILED){state=IDEMPOTENCY_STATUS.COMMITTED;result='MIGRATED_OPERATION_STATUS:'+opStatus;} else result='MIGRATED_REQUIRES_RECONCILIATION:'+opStatus; }
        return [state,result,now_()];
      });
      storageSetValues_(sheet,ROWS.FIRST_DATA,COLS.IDEMPOTENCY.PROCESSING_STATUS+1,vals,'migration_idempotency_state_backfill');
    }
    return;
  }
  if (item.action==='EXPAND_APPEND_ONLY') {
    const legacyWidth=sheet.getLastColumn(); storageSetValues_(sheet,1,1,[expected],'migration_expand_header');
    const add=Math.max(0,expected.length-legacyWidth), lr=sheet.getLastRow();
    if(add&&lr>=ROWS.FIRST_DATA){ const vals=[]; for(let r=ROWS.FIRST_DATA;r<=lr;r++) vals.push(Array(add).fill('')); storageSetValues_(sheet,ROWS.FIRST_DATA,legacyWidth+1,vals,'migration_append_columns_backfill'); }
    return;
  }
  if (item.action==='INSERT_HEADER_AND_EXPAND') {
    const legacyWidth=sheet.getLastColumn(); storageInsertRowBefore_(sheet,1,'migration_insert_header'); storageSetValues_(sheet,1,1,[expected],'migration_header');
    const lr=sheet.getLastRow(); if(lr>=ROWS.FIRST_DATA){
      if(legacyWidth===7){ const vals=[]; for(let r=ROWS.FIRST_DATA;r<=lr;r++) vals.push(['','','[]']); storageSetValues_(sheet,ROWS.FIRST_DATA,COLS.PARTICIPANTS.TIMEZONE+1,vals,'migration_participant_full_backfill'); }
      else if(legacyWidth===8){ const vals=[]; for(let r=ROWS.FIRST_DATA;r<=lr;r++) vals.push(['','[]']); storageSetValues_(sheet,ROWS.FIRST_DATA,COLS.PARTICIPANTS.LAYER_CHECKPOINT_FLAG+1,vals,'migration_participant_layer_backfill'); }
    }
    return;
  }
  throw new Error('MIGRATION_ACTION_REJECTED:'+item.name+':'+item.action);
}
function projectDayDisplayValues_(sheet,col,count) {
  if(count<=0) return [];
  const range=sheet.getRange(ROWS.FIRST_DATA,col,count,1);
  if(range && typeof range.getDisplayValues==='function') return range.getDisplayValues().map(r=>r[0]);
  return range.getValues().map(r=>String(r[0]==null?'':r[0]));
}
function sessionObjectFromMigrationRow_(row){return{sessionId:String(row[COLS.SESSIONS.SESSION_ID]||''),participantId:String(row[COLS.SESSIONS.PARTICIPANT_ID]||''),projectDay:row[COLS.SESSIONS.PROJECT_DAY],startedAt:row[COLS.SESSIONS.STARTED_AT]};}
function canonicalMigrationProjectDay_(name,row,display,sessionById,cycleById) {
  const col=(PROJECT_DAY_COLUMNS[name]||[])[0]; if(col===undefined) return '';
  const direct=canonicalProjectDayKey_(row[col],display); if(direct){
    if(name==='CalibrationCycles'){
      const sid=String(row[COLS.CALIBRATION_CYCLES.MORNING_SESSION_ID]||''), sr=sessionById[sid];
      if(sr){const linked=canonicalSessionProjectDay_(sessionObjectFromMigrationRow_(sr));if(linked&&linked!==direct)throw new Error('PROJECT_DAY_LINK_MISMATCH:CalibrationCycles:'+sid);}
    }
    if(name==='AdjustmentPlans'){
      const cid=String(row[COLS.ADJUSTMENT_PLANS.CYCLE_ID]||''), cr=cycleById[cid];
      if(cr){const linked=canonicalProjectDayKey_(cr[COLS.CALIBRATION_CYCLES.PROJECT_DAY]);if(linked&&linked!==direct)throw new Error('PROJECT_DAY_LINK_MISMATCH:AdjustmentPlans:'+cid);}
    }
    return direct;
  }
  if(name==='Sessions') return canonicalSessionProjectDay_(sessionObjectFromMigrationRow_(row));
  if(name==='CalibrationCycles'){
    const sid=String(row[COLS.CALIBRATION_CYCLES.MORNING_SESSION_ID]||''), sr=sessionById[sid];
    if(sr) return canonicalSessionProjectDay_(sessionObjectFromMigrationRow_(sr));
  }
  if(name==='AdjustmentPlans'){
    const cid=String(row[COLS.ADJUSTMENT_PLANS.CYCLE_ID]||''), cr=cycleById[cid];
    if(cr) return canonicalProjectDayKeyOrThrow_(cr[COLS.CALIBRATION_CYCLES.PROJECT_DAY],'migration_adjustment_cycle_day');
  }
  if(String(row[col]==null?'':row[col]).trim()) throw new Error('PROJECT_DAY_MIGRATION_AMBIGUOUS:'+name);
  return '';
}
function migrateProjectDayTextContractV10_() {
  const sessionSheet=getSessionsSheet_(), cycleSheet=getCalibrationCyclesSheet_();
  const sessionRows=storageReadRows_(sessionSheet), cycleRows=storageReadRows_(cycleSheet);
  const sessionById={}, cycleById={}; sessionRows.forEach(r=>sessionById[String(r[COLS.SESSIONS.SESSION_ID])]=r); cycleRows.forEach(r=>cycleById[String(r[COLS.CALIBRATION_CYCLES.CYCLE_ID])]=r);
  const summary={};
  ['Participants','Sessions','CalibrationCycles','AdjustmentPlans'].forEach(name=>{
    const sheet=getRuntimeSheet_(name), col=(PROJECT_DAY_COLUMNS[name]||[])[0]+1, count=Math.max(0,sheet.getLastRow()-ROWS.FIRST_DATA+1);
    if(!count){summary[name]=0;return;}
    const raw=sheet.getRange(ROWS.FIRST_DATA,1,count,sheet.getLastColumn()).getValues(), displays=projectDayDisplayValues_(sheet,col,count), out=[];
    raw.forEach((row,i)=>out.push([canonicalMigrationProjectDay_(name,row,displays[i],sessionById,cycleById)]));
    const target=sheet.getRange(ROWS.FIRST_DATA,col,count,1); if(target&&typeof target.setNumberFormat==='function') target.setNumberFormat('@'); target.setValues(out);
    const verify=target.getValues(); verify.forEach((r,i)=>{const v=String(r[0]==null?'':r[0]).trim(); if(v&&!isCanonicalProjectDayKey_(v))throw new Error('PROJECT_DAY_V10_VERIFY_FAILED:'+name+':'+(i+ROWS.FIRST_DATA));});
    summary[name]=count;
  });
  return summary;
}
function applyStorageMigration_(backupRef, expectedPlanHash) {
  if (!backupRef) throw new Error('MIGRATION_BACKUP_REQUIRED');
  const plan=dryRunStorageMigration_();
  if (plan.rejected) throw new Error('MIGRATION_PREFLIGHT_REJECTED');
  if (expectedPlanHash && String(expectedPlanHash)!==String(plan.planHash)) throw new Error('MIGRATION_PLAN_CHANGED');
  const migrationId=Utilities.getUuid(), started=now_();
  storageAppendRow_(getMigrationLogSheet_(),[migrationId,'detected',SCB_STORAGE_SCHEMA_VERSION,'backup#'+contentFingerprint_(backupRef).fingerprint,plan.planHash,'PENDING',JSON.stringify(plan.sheets),started,''],'migration_log_begin');
  try {
    plan.sheets.forEach(item=>{
      if(item.action==='CREATE_CURRENT'){ const sh=getOrCreateSheet_(item.name); validateSheetSchema_(sh); return; }
      applySheetMigrationAction_(getSpreadsheet_().getSheetByName(item.name),item);
    });
    const projectDayMigration=migrateProjectDayTextContractV10_();
    Object.keys(HEADERS).forEach(name=>validateSheetSchema_(getRuntimeSheet_(name)));
    const props=PropertiesService.getScriptProperties(); props.setProperty(STORAGE_SCHEMA_PROPERTY,SCB_STORAGE_SCHEMA_VERSION); props.setProperty(STORAGE_MIGRATION_PROPERTY,SCB_STORAGE_MIGRATION_VERSION);
    ensureStorageControlMetadata_();
    const rows=storageReadRows_(getMigrationLogSheet_()); const idx=rows.findIndex(r=>String(r[COLS.MIGRATION_LOG.MIGRATION_ID])===migrationId);
    if(idx>=0) storageSetValues_(getMigrationLogSheet_(),rowNumber_(idx),COLS.MIGRATION_LOG.STATUS+1,[['COMMITTED',JSON.stringify(plan.sheets),started,now_()]],'migration_log_commit');
    return {migrationId:migrationId,status:'COMMITTED',planHash:plan.planHash,projectDayMigration:projectDayMigration};
  } catch(error) {
    const rows=storageReadRows_(getMigrationLogSheet_()); const idx=rows.findIndex(r=>String(r[COLS.MIGRATION_LOG.MIGRATION_ID])===migrationId);
    if(idx>=0) storageSetValues_(getMigrationLogSheet_(),rowNumber_(idx),COLS.MIGRATION_LOG.STATUS+1,[['FAILED_RESTORE_REQUIRED',safeErrorMessage_(error),started,now_()]],'migration_log_fail');
    throw error;
  }
}

const OPERATOR_STORAGE_MIGRATION_PROPERTIES = Object.freeze({
  BACKUP_REF: 'SCB_STORAGE_MIGRATION_BACKUP_REF',
  PLAN_HASH: 'SCB_STORAGE_MIGRATION_EXPECTED_PLAN_HASH'
});
function withConfiguredMigrationScriptLock_(callback) {
  const lock = LockService.getScriptLock(); let acquired = false;
  try {
    lock.waitLock(30000); acquired = true;
    return callback();
  } finally { if (acquired) lock.releaseLock(); }
}
function inspectConfiguredStorageMigration() {
  return withConfiguredMigrationScriptLock_(function() {
    const plan = inspectStorageSchema_();
    log_('OPERATOR_STORAGE_MIGRATION_INSPECTED', {rejected:plan.rejected===true,sheetCount:plan.sheets.length});
    return plan;
  });
}
function dryRunConfiguredStorageMigration() {
  return withConfiguredMigrationScriptLock_(function() {
    const plan = dryRunStorageMigration_();
    if (plan.rejected) throw new Error('MIGRATION_PREFLIGHT_REJECTED');
    PropertiesService.getScriptProperties().setProperty(OPERATOR_STORAGE_MIGRATION_PROPERTIES.PLAN_HASH, String(plan.planHash));
    log_('OPERATOR_STORAGE_MIGRATION_DRY_RUN', {planHash:plan.planHash,sheetCount:plan.sheets.length});
    return plan;
  });
}
function createConfiguredStorageMigrationBackup() {
  return withConfiguredMigrationScriptLock_(function() {
    const backupRef = createStorageMigrationBackup_();
    PropertiesService.getScriptProperties().setProperty(OPERATOR_STORAGE_MIGRATION_PROPERTIES.BACKUP_REF, backupRef);
    log_('OPERATOR_STORAGE_MIGRATION_BACKUP_CREATED', {backupFingerprint:contentFingerprint_(backupRef).fingerprint});
    return backupRef;
  });
}
function applyConfiguredStorageMigration() {
  const props = PropertiesService.getScriptProperties();
  const backupRef = String(props.getProperty(OPERATOR_STORAGE_MIGRATION_PROPERTIES.BACKUP_REF) || '').trim();
  const planHash = String(props.getProperty(OPERATOR_STORAGE_MIGRATION_PROPERTIES.PLAN_HASH) || '').trim();
  if (!backupRef) throw new Error('SCB_STORAGE_MIGRATION_BACKUP_REF_REQUIRED');
  if (!planHash) throw new Error('SCB_STORAGE_MIGRATION_EXPECTED_PLAN_HASH_REQUIRED');
  return withConfiguredMigrationScriptLock_(function() {
    const result = applyStorageMigration_(backupRef, planHash);
    if (!result || result.status !== 'COMMITTED') throw new Error('MIGRATION_NOT_COMMITTED');
    props.deleteProperty(OPERATOR_STORAGE_MIGRATION_PROPERTIES.BACKUP_REF);
    props.deleteProperty(OPERATOR_STORAGE_MIGRATION_PROPERTIES.PLAN_HASH);
    log_('OPERATOR_STORAGE_MIGRATION_COMMITTED', {migrationId:result.migrationId,planHash:result.planHash});
    return result;
  });
}

function migrateParticipantsAddTimezoneColumn_(){
  throw new Error('LEGACY_MIGRATION_DISABLED_USE_applyStorageMigration_');
}

// F59 (Prompt 3 design note, approved): run manually, once, ONLY if this
// script is being deployed against a Participants sheet that already has a
// header row and data from before this fix (8 columns: through TIMEZONE,
// no LAYER_CHECKPOINT_FLAG / LAYER_TRANSITION_REFLECTION). Unlike
// migrateParticipantsAddTimezoneColumn_ above (which predates F36 and
// operates on a headerless pre-migration layout), F59 postdates F36, so
// this operates on the current headered layout: it first brings the
// header row itself up to the new width via migrateHeaderRow_ (already
// generic across sheets, already idempotent), then backfills each
// existing data row's two new cells ('' for LAYER_CHECKPOINT_FLAG, '[]'
// for LAYER_TRANSITION_REFLECTION — matching what a fresh signup gets in
// getOrCreateParticipant_). A fresh sheet needs no migration:
// getOrCreateSheet_ writes a header at the current full width immediately
// on creation. Per this project's current phase (no real usability
// testing has run, so no pilot has live Participants data at the old
// width), this function is expected to be a no-op in practice — kept for
// migration-path honesty, same rationale F29's note gave for itself.
function migrateParticipantsAddLayerReflectionColumns_(){
  throw new Error('LEGACY_MIGRATION_DISABLED_USE_applyStorageMigration_');
}

// F36: run manually, once per sheet, ONLY against a sheet that already has
// rows from before F36 (headerless, row 1 is data). A fresh sheet created by
// the current getOrCreateSheet_ already gets its header written at creation
// and needs no migration. This inserts a real header row above existing
// data — Sheets' insertRowBefore_ shifts existing data down by one row
// rather than overwriting it, so no existing cell values are touched, only
// their row position changes (from row N to row N+1), which is exactly what
// every ROWS.FIRST_DATA-derived call site (readRows_, rowNumber_,
// verifyRowIdentity_) already expects post-F36 — no separate cell rewrite is
// needed beyond writing the new header row itself. Matches
// migrateParticipantsAddTimezoneColumn_'s existing pattern: manual,
// one-time, explicit, not run automatically or from the webhook path.
function migrateHeaderRow_(sheet){
  throw new Error('LEGACY_MIGRATION_DISABLED_USE_applyStorageMigration_');
}

// F36: convenience wrapper running migrateHeaderRow_ against all five
// sheets in one manual call, for the common case of migrating an existing
// deployment in one pass. Each sheet's migration is independent and
// idempotent (migrateHeaderRow_'s own already-migrated check), so this is
// safe to re-run.
function migrateAllHeaderRows_(){
  throw new Error('LEGACY_MIGRATION_DISABLED_USE_applyStorageMigration_');
}

// Run manually once after deployment. This explicitly matches doPost's query-string validation.
//
// F41 CHANGE NOTE (Section E fix pack, FIX-E6, fixes audit finding E6):
// added the warning below after direct verification of Apps Script's
// documented deployment-ID/URL semantics (not restated developer folklore).
// The failure mode this closes is NOT "loud error" vs. "silent failure" as
// earlier framing assumed — it's a third case, more insidious than either:
// a silently-non-deployed update with no error anywhere.
//
// ⚠️ OPERATOR WARNING — read before redeploying:
// Redeploying via Deploy → "New deployment" creates a brand-new /exec URL.
// The OLD deployment keeps running, unchanged, on its OLD URL indefinitely
// unless you explicitly archive it. Telegram will keep sending updates to
// that old, stale code — and it will keep returning normal 2xx responses,
// so there is no error in this script's logs, no error in Telegram's
// getWebhookInfo, and nothing that looks wrong in day-to-day use. Your new
// code simply never goes live.
// The safer pattern for iterating on this project (given its own history of
// many iterative fix-pack rounds) is Deploy → "Manage deployments" → edit
// the EXISTING deployment to point at the new version. This keeps the same
// /exec URL, so Telegram's webhook registration stays valid automatically —
// no re-run of configureWebhookOnce_ needed at all.
// If you use "New deployment" anyway: you MUST re-run configureWebhookOnce_
// afterward against the new URL, AND you should independently verify via
// Telegram's getWebhookInfo endpoint that the registered URL's deployment ID
// matches the one you actually intend to be live — there is no automatic
// alert if it doesn't.
function webhookExpectedUrl_(webAppUrl, secret) {
  const separator=String(webAppUrl).indexOf('?')>=0?'&':'?';
  return String(webAppUrl)+separator+'secret_token='+encodeURIComponent(secret);
}
function webhookTargetFingerprint_(url) { return contentFingerprint_(String(url||'')).fingerprint; }
function verifyTelegramWebhook_(webAppUrl) {
  webAppUrl=webAppUrl||getConfig_().webAppUrl;
  const config=getConfig_();
  if(!webAppUrl||!isConfigured_(config)) throw new Error('WEBHOOK_VERIFICATION_CONFIGURATION_INCOMPLETE');
  const expected=webhookExpectedUrl_(webAppUrl,config.webhookSecret);
  const response=UrlFetchApp.fetch('https://api.telegram.org/bot'+config.botToken+'/getWebhookInfo',{method:'get',muteHttpExceptions:true});
  const api=telegramApiResponse_(response);
  if(api.httpStatus<200||api.httpStatus>=300||!api.ok||!api.result||typeof api.result.url!=='string') throw new Error('GET_WEBHOOK_INFO_FAILED:'+api.httpStatus+':'+(api.errorCode||''));
  const actual=api.result.url;
  const status={matches:actual===expected,targetFingerprint:webhookTargetFingerprint_(actual),expectedTargetFingerprint:webhookTargetFingerprint_(expected),pendingUpdateCount:Number(api.result.pending_update_count||0),lastErrorDate:api.result.last_error_date||null,lastErrorMessage:typeof api.result.last_error_message==='string'?api.result.last_error_message:''};
  log_('WEBHOOK_STATUS',{matches:status.matches,targetFingerprint:status.targetFingerprint,expectedTargetFingerprint:status.expectedTargetFingerprint,pendingUpdateCount:status.pendingUpdateCount,lastErrorDate:status.lastErrorDate,lastErrorMessage:status.lastErrorMessage});
  if(!status.matches) throw new Error('WEBHOOK_TARGET_MISMATCH');
  return status;
}
function configureWebhookOnce_() {
  const webAppUrl=getConfig_().webAppUrl;
  if(!webAppUrl) throw new Error('Set WEB_APP_URL in Script Properties to your deployed /exec URL first.');
  const status=setTelegramWebhook(webAppUrl);
  ensureIdempotencyPruneTrigger_();
  return status;
}
// Public operator entrypoint for Apps Script's manual function selector.
// Keeps the established one-time setup sequence intact: webhook verification first,
// then idempotency-prune trigger installation.
function configureWebhookOnce() {
  return configureWebhookOnce_();
}
function setTelegramWebhook(webAppUrl) {
  webAppUrl=webAppUrl||getConfig_().webAppUrl;
  if(!webAppUrl) throw new Error('Set WEB_APP_URL in Script Properties to your deployed /exec URL first.');
  if(!/^https:\/\//i.test(String(webAppUrl))||String(webAppUrl).indexOf('/exec')<0) throw new Error('WEB_APP_URL must be the deployed HTTPS /exec URL.');
  const config=getConfig_();
  if(!isConfigured_(config)) {
    if(validateWebhookSecret_(config)==='too_short') throw new Error('WEBHOOK_SECRET is set but shorter than '+WEBHOOK_SECRET_MIN_LENGTH+' characters. Use a longer, random value in Script Properties.');
    throw new Error('Set BOT_TOKEN and WEBHOOK_SECRET in Script Properties first.');
  }
  const webhookUrl=webhookExpectedUrl_(webAppUrl,config.webhookSecret);
  const response=UrlFetchApp.fetch('https://api.telegram.org/bot'+config.botToken+'/setWebhook',{method:'post',contentType:'application/json',payload:JSON.stringify({url:webhookUrl}),muteHttpExceptions:true});
  const api=telegramApiResponse_(response);
  if(api.httpStatus<200||api.httpStatus>=300||!api.ok||api.result!==true) {
    log_('SET_WEBHOOK_FAILED',{status:api.httpStatus,errorCode:api.errorCode,description:api.description,parseError:api.parseError,targetFingerprint:webhookTargetFingerprint_(webhookUrl)});
    throw new Error('SET_WEBHOOK_REJECTED');
  }
  const verified=verifyTelegramWebhook_(webAppUrl);
  log_('SET_WEBHOOK_CONFIRMED',{targetFingerprint:verified.targetFingerprint,pendingUpdateCount:verified.pendingUpdateCount});
  return verified;
}

function escapeHtml_(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function parsePayload_(value) {
  if (!value) return {};
  try { return JSON.parse(value); }
  catch (error) {
    const fp = contentFingerprint_(value);
    log_('PAYLOAD_CORRUPTION_DETECTED', { message:safeErrorMessage_(error), rawValueLength:fp.length, rawValueFingerprint:fp.fingerprint });
    throw new Error('CORRUPT_PAYLOAD_UNQUARANTINED_CONTEXT_REQUIRED');
  }
}

function now_() {
  return new Date().toISOString();
}

// F29: now accepts an optional IANA timezone string, used when a participant
// has chosen their own (see getParticipantTimezone_). Falls back to
// NO_DEFAULT_PROJECT_TIMEZONE for backward compatibility with any call site
// that doesn't yet pass one, and defensively for an empty/invalid value —
// Utilities.formatDate throws on an unrecognized zone string, and a
// participant-supplied value should never be able to crash a webhook
// execution, so it's validated against COMMON_TIMEZONE_CHOICES (the only values
// this file itself ever writes) before use rather than passed through raw.
function projectDay_(timezone, instant) {
  const zone = normalizeIanaTimezone_(timezone);
  if (!zone) throw new Error('TIMEZONE_REQUIRED_OR_INVALID');
  return Utilities.formatDate(instant ? new Date(instant) : new Date(), zone, 'yyyy-MM-dd');
}
function participantProjectDayAt_(participantId, instant) {
  const zone=getParticipantTimezoneAt_(participantId,instant);
  if(!zone) throw new Error('TIMEZONE_HISTORY_REQUIRED');
  return projectDay_(zone,instant);
}

// F50 CHANGE-CONTROL (Round 5, Section H fix pack, fixes audit finding H2):
// resolveParticipantTimezone_ removed — dead code, zero call sites anywhere
// in this file (verified by grep of every resolveParticipantTimezone_(
// invocation: none exist outside its own now-deleted definition). Its own
// doc comment claimed createSession_'s day-stamping and
// getLatestSessionForProjectDay_'s day-matching "both call this helper" to
// guarantee agreement on what "the same day" means for a participant — that
// claim was false. Both functions actually call getParticipantTimezone_
// (defined further up this file, reads Participants.TIMEZONE directly by
// participant ID) which independently re-implements the identical
// known-timezone-or-default fallback this function did. The day-matching
// guarantee the comment described IS real in practice (both call sites do
// agree, since both run the same isKnownTimezone_-gated fallback logic) —
// it just holds because the logic was duplicated correctly, not because a
// shared helper enforces it, which is a materially weaker guarantee any
// future edit to one call site's inline logic could silently break without
// the other noticing. Not fixed further this round (re-routing
// getParticipantTimezone_'s two call sites through a single shared helper
// would be a real behavior-preserving refactor, not a comment-only fix, and
// is out of this round's minimal-closure scope) — flagged here so a future
// reader considering that refactor has the accurate starting picture rather
// than believing the centralization already exists. Retesting: no —
// removal of code with zero reachable callers changes no runtime behavior.
// See getParticipantTimezone_ (below) for the function actually in use.

// F37 CHANGE NOTE: audit finding E3 found that validateSheetSchema_'s F36
// header-identity check throws SCHEMA_HEADER_MISMATCH: on a column-swap, but
// this classifier had no branch for that prefix -- only SCHEMA_COLUMN_COUNT_
// MISMATCH: and UNKNOWN_SHEET_SCHEMA: were recognized as schema_corruption.
// The result was F36's detector firing correctly while the user still got
// the generic "please try again" processing message, which is actively
// wrong here: a header swap is deterministic and retrying does not help.
// Added the missing prefix check below. Verified by grep that these three
// throw sites (UNKNOWN_SHEET_SCHEMA:, SCHEMA_COLUMN_COUNT_MISMATCH:,
// SCHEMA_HEADER_MISMATCH:) are the only schema-related throws in the file,
// so this closes the gap completely rather than partially.
function classifyProcessingError_(error) {
  const message = String(error && error.message ? error.message : error || '');
  if (message === 'LOCK_TIMEOUT') return 'lock_timeout';
  if (message.indexOf('SCHEMA_COLUMN_COUNT_MISMATCH:') === 0) return 'schema_corruption';
  if (message.indexOf('UNKNOWN_SHEET_SCHEMA:') === 0) return 'schema_corruption';
  if (message.indexOf('SCHEMA_HEADER_MISMATCH:') === 0) return 'schema_corruption';
  if (message.indexOf('SCHEMA_EMPTY_WITHOUT_HEADER:') === 0) return 'schema_corruption';
  if (message.indexOf('STORAGE_SCHEMA_VERSION_MISMATCH:') === 0) return 'schema_corruption';
  if (message.indexOf('STORAGE_MIGRATION_REQUIRED:') === 0) return 'schema_migration_required';
  if (message.indexOf('STORAGE_MIGRATION_VERSION_MISMATCH:') === 0) return 'schema_corruption';
  if (message.indexOf('CORRUPT_RECORD_QUARANTINED:') === 0 || message.indexOf('CORRUPT_PAYLOAD_UNQUARANTINED_CONTEXT_REQUIRED') === 0) return 'schema_corruption';
  if (message.indexOf('Unexpected token') >= 0 || message.indexOf('JSON') >= 0) return 'invalid_payload';
  return 'processing';
}

function safeErrorMessage_(error) {
  return String(error && error.message ? error.message : error || 'unknown_error').slice(0, 300);
}

// P05 governing semantics: this is a burst-until-idle limiter, NOT a moving-window
// rate calculation. Each accepted or rejected request refreshes the CacheService TTL.
// After RATE_LIMIT_MAX_PER_WINDOW requests in one uninterrupted burst, later requests
// are rejected until the participant has been idle for RATE_LIMIT_WINDOW_SECONDS.
// The historical constant names are retained to avoid unrelated code churn.
//
// F-D7-R1 CHANGE NOTE (post-implementation re-audit, D7 follow-up):
// originally set to 8/10s, sized only against the morning flow's fastest
// escape-hatch sequence (READY_START -> ACUTE_NO -> RECOVERY_NO ->
// CANDIDATE_NONE, see G1 — 4 taps, giving 2x headroom under 8; F45 below
// corrects this sequence's action names, which were stale when this note
// was originally written). The follow-up re-audit checked this against
// the OTHER longest real single-session tap sequence
// in the state machine — REVIEW_Q1 through REVIEW_Q10, a 10-step ordered
// sequence of single-button taps — and found a participant rapid-tapping
// through it without reading each question (plausible; the same
// zero-reflection pattern G1 already flags as a risk this design doesn't
// prevent) could plausibly hit 10 taps inside one 10-second window, which
// the original 8-request ceiling would have wrongly rejected as abuse. That
// would have been a genuine, confusing usability failure for a real
// participant's legitimate use, not a caught bad actor.
// Raised to 20/10s so the REVIEW_Q1..Q10 sequence gets the same ~2x margin
// the morning-flow sizing originally targeted (20 / 10 taps = 2x, matching
// 8 / 4 taps = 2x). Window left at 10s rather than widened, since the
// problem was ceiling headroom against a specific known sequence length,
// not window duration. Still fully closes the original unbounded-flood gap
// D7 found: a scripted client is hard-rejected after 20 requests in one
// uninterrupted burst and stays rejected until 10 seconds of actual idle time,
// reducing continuous global-lock contention against other participants. If a future revision of the
// form architecture adds a longer ordered single-button sequence than
// REVIEW's 10 steps, re-derive this ceiling against that new sequence length
// before assuming 20 still holds — this number is sized against the longest
// currently-known real sequence, not an abstract safety margin.
//
// F45 CHANGE NOTE (Round 5, Section G fix pack, fixes audit finding G1):
// (1) What's changing: F-D7-R1's note above originally named the morning
// flow's fastest escape-hatch sequence as "ACUTE_NO -> RECOVERY_NO ->
// CANDIDATE_NO_CHANGE" (3 named actions) while still counting it as "4
// taps." Corrected to the real, grep-verifiable sequence: READY_START ->
// ACUTE_NO -> RECOVERY_NO -> CANDIDATE_NONE (4 named actions, matching
// the stated total).
// (2) Why insufficient: "CANDIDATE_NO_CHANGE" does not exist anywhere in
// this file's action set — the CANDIDATE state's "no clear Signal" input
// produces CANDIDATE_NONE (see actionByState's STATES.CANDIDATE mapping
// and the CANDIDATE_NONE handling in the action-dispatch block). A
// citation to a nonexistent action name is not re-derivable by a future
// reader without redoing the trace from scratch, which is the exact
// comment-drift failure mode this round's H1 audits for and Round 4's
// Finding 3 already found once elsewhere in this file (F19).
// (3) Evidence: grep of the full file for "CANDIDATE_NO_CHANGE" returns
// only the F-D7-R1 comment itself, zero matches in code. A live trace of
// STATES.READY -> STATES.ACUTE -> STATES.RECOVERY -> STATES.CANDIDATE ->
// STATES.COMPLETE confirms the 4-tap, zero-typed-text, gate-bypassing
// path and the real action names.
// (4) Downstream components affected: none. RATE_LIMIT_MAX_PER_WINDOW
// (20) and RATE_LIMIT_WINDOW_SECONDS (10) are unaffected — the tap count
// (4) the sizing was actually built on was correct despite the broken
// citation, so no re-sizing is required.
// (5) Retesting: no — comment-only, verified by grep rather than runtime
// behavior, consistent with FIX-3's precedent for stale-comment fixes.
//
// F58 CHANGE NOTE (Round 5, Section L fix pack, fixes audit finding L2,
// OBSERVATION): re-validated this ceiling against the longest currently-
// live sequence not yet checked against it — the /gate two-candidate path
// (GATE_CANDIDATE -> GATE_COMMITMENT -> [GATE_TYPE] -> GATE_CLAIM ->
// GATE_FEASIBILITY -> [GATE_SMALLER_ACTION], run twice via
// finishCandidateGate_'s two_competing loop-back, then GATE_COMPARE ->
// FOCAL_SELECTION -> PRESERVE). Full-detour worst case traced at 16 steps
// (7 for candidate 1 with both optional hops taken, 6 for candidate 2, 3 for
// compare/focal/preserve) — under the 20 ceiling, so nothing is currently
// mis-rejected, but only 20/16 = 1.25x headroom, short of the ~2x standard
// this ceiling was otherwise sized against (20/10 for REVIEW_Q1-Q10, see
// F-D7-R1 above). Not flagging for re-sizing despite the thinner margin:
// unlike REVIEW_Q1-Q10's 10 uniform single-button taps (genuinely reachable
// in 10s by a fast tapper, which is the scenario F-D7-R1 sized against), 4
// of /gate two's 16 steps are typed free-text entries (both candidates'
// description and present-claim), which impose a real pacing floor a
// button-mashing pattern doesn't have — landing all 16 inside one 10s
// window is materially less realistic for a genuine participant than the
// raw count alone suggests. The single-candidate gate chain is a strict
// subset (7 steps worst case) and needs no separate check. If a future
// revision adds a third gate-eligible candidate slot or otherwise extends
// this chain, re-derive against the new length before assuming 1.25x still
// holds — same standing instruction F-D7-R1 left for itself.
const RATE_LIMIT_WINDOW_SECONDS = 10;
const RATE_LIMIT_MAX_PER_WINDOW = 20;

// Uses CacheService (not PropertiesService, not a Sheets table) — this is a
// purely transient, best-effort counter with no correctness requirement
// beyond "roughly right within one window," so CacheService's own
// automatic-expiry behavior is a better fit than anything requiring manual
// cleanup, and it carries no risk of interacting with the reserve-then-
// mutate idempotency ordering documented elsewhere in this file, since it
// never touches Sheets or Script Properties.
// F57 CHANGE-CONTROL (Round 5, Section L fix pack, fixes audit finding L1,
// MINOR): traced a concrete timeline (see L1 audit note) showing this
// function's cache.put only fired on ACCEPT, never on REJECT. Because the
// counter key's 10s TTL was therefore anchored to the last ACCEPTED
// request rather than the last request of either kind, a client flooding
// continuously past the ceiling would hit a stale-anchor gap: once 10s
// elapsed since its last accepted request (while still being rejected the
// whole time), the counter key expired, cache.get returned null, current
// reset to 0, and the very next request was silently ACCEPTED again even
// though the flood never stopped — a full ceiling reset mid-flood, not
// bounded leakage. wasAlreadyNotifiedThisWindow_ (separate key, unaffected
// by this fix) was not implicated: no double-notification or missed-
// notification bug was found: that key's own logic is sound and correctly
// independent. Fix: cache.put the counter on every call, accepted or
// rejected, so the window's anchor point is always the most recent request
// of any kind, not just the most recent accepted one. Ceiling
// (RATE_LIMIT_MAX_PER_WINDOW=20) and window (RATE_LIMIT_WINDOW_SECONDS=10)
// unchanged — this closes the anchor-staleness gap without re-deriving
// L2's sizing. Downstream: none — same two call sites (line ~893), same
// cache key names, same TTL constants. Retesting: yes — verify a
// continuous-flood client (>20 requests within one 10s span, sent without
// pausing) stays rejected past the old stale-anchor boundary and does not
// regain accepted status until it actually goes idle for a full 10s
// window; verify a legitimate burst under the ceiling is still accepted
// normally (no new false rejections introduced).
function isRateLimited_(userId) {
  lprCountBotService_('cache.rate_limit');
  const cache = CacheService.getScriptCache();
  const key = 'ratelimit_' + String(userId);
  const current = Number(cache.get(key) || '0');
  if (current >= RATE_LIMIT_MAX_PER_WINDOW) {
    cache.put(key, String(current), RATE_LIMIT_WINDOW_SECONDS);
    return true;
  }
  cache.put(key, String(current + 1), RATE_LIMIT_WINDOW_SECONDS);
  return false;
}

// Separate cache entry (not reused from isRateLimited_'s counter) so the
// "already sent the user a notice this window" flag has its own lifetime,
// independent of the request-count key above — this keeps the notify-once
// logic simple to reason about rather than overloading one cache value for
// two purposes.
function wasAlreadyNotifiedThisWindow_(userId) {
  const cache = CacheService.getScriptCache();
  const key = 'ratelimit_notified_' + String(userId);
  if (cache.get(key)) return true;
  cache.put(key, '1', RATE_LIMIT_WINDOW_SECONDS);
  return false;
}

function log_(eventName, fields) {
  console.log(JSON.stringify({
    event: eventName, fields: fields || {
    }
  }));
}
// Current implementation scans sheet rows for lookups. This is appropriate for a small
// personal bot. Reassess indexing/caching before sustained high-volume use or when the
// largest operational sheet reaches roughly 10,000 rows, because webhook latency grows O(n).

// ============================================================================
// F42 CHANGE-CONTROL — Round 5, FIX-1: closes the /gate BLOCKER
// (Round 4, Finding 2). Date: 2026-08-18.
// ============================================================================
//
// (1) WHAT'S CHANGING:
//   - Added isTesterParticipant_ (near getConfig_), reading a comma-separated
//     TESTER_USER_IDS list from Script Properties. /gate now checks this
//     before dispatching to startDecisionGateTest_ (handleCommandOrText_);
//     non-allowlisted consented participants get the same generic
//     "Use /start..." message the else-branch already sends for any
//     unrecognized input, so /gate reveals nothing about its own existence
//     to them. This is option (c), BOTH access-restriction and
//     data-segregation — see point (2) for why access-restriction alone was
//     judged insufficient.
//   - completeWithNewSignal_ now writes the session's real
//     payload.source_state into SignalHistory's SOURCE_STATE column instead
//     of always hardcoding STATES.PRESERVE, so a /gate-origin row
//     ('F2_GATE_TEST') is programmatically distinguishable from a real
//     /start-origin row ('START_COMMAND').
//   - exportParticipantData_ now includes a HEADERS row per CSV section, so
//     SOURCE_STATE (and every other column) is filterable by name in an
//     export, not just by position. The "no data to export" check was
//     rewritten to use filtered-row counts instead of newline-counting,
//     since the header row broke the old newline-based check.
//
// (2) WHY THE CURRENT STATE IS INSUFFICIENT:
//   Round 4 traced that /gate was reachable by any consented participant,
//   undocumented in /help, and — if completed — wrote a real row into
//   SignalHistory indistinguishable from genuine data. Data-segregation
//   alone (option b) was considered and rejected as the sole fix: it
//   correctly flags rows after the fact, but does not stop a participant
//   from using /gate as an unlimited-attempts practice run before their
//   real /start, which contaminates the meaning of their eventual real
//   session (they've already seen every gate question) even though the
//   resulting data would be correctly flagged. Access-restriction (option a)
//   closes that path; data-segregation is kept alongside it as defense in
//   depth in case the allowlist is ever misconfigured or left empty.
//
// (3) EVIDENCE MOTIVATING THE CHANGE: Round 4, Finding 2 (full trace:
//   handleCommandOrText_'s /gate dispatch had no consent-status-style gate
//   beyond ordinary CONSENTED status; completeWithNewSignal_ line citation
//   in that finding matches the hardcoded STATES.PRESERVE this note fixes).
//
// (4) DOWNSTREAM COMPONENTS AFFECTED: handleCommandOrText_ (/gate
//   dispatch), completeWithNewSignal_, exportParticipantData_. Script
//   Properties now has a new operator-configured key, TESTER_USER_IDS —
//   unset or empty means /gate is unreachable by anyone (fails closed, not
//   open). SignalHistory's SOURCE_STATE column, previously constant and
//   therefore unread by any code path, is now a meaningful field going
//   forward; historical rows written before this fix still carry the old
//   constant value and are NOT retroactively reclassified — this fix cannot
//   distinguish already-written test rows from already-written real rows,
//   since both were written as STATES.PRESERVE before this change.
//
// (5) RETESTING REQUIRED: YES, per this fix pack's own FIX-1 instructions —
//   full regression of /gate (bare and "/gate two") confirming
//   non-allowlisted participants cannot reach GATE_CANDIDATE by any path,
//   and confirming a completed /gate walkthrough by an allowlisted tester
//   writes a SignalHistory row programmatically filterable via the exported
//   CSV's SOURCE_STATE column (query the export, not visual inspection).
//   See M1 (Part 2, Section M) for the independent post-fix verification
//   this note's own claim should not be taken on faith alone.
//
// SILENT-SUPERSESSION NOTE (the other half of FIX-1's prompt): createSession_
// still unconditionally supersedes any active session and sends the generic
// "Starting something new interrupts..." warning when the active session's
// state is in IN_PROGRESS_EDIT_STATES (line ~1318, includes GATE_CANDIDATE,
// GATE_CLAIM, GATE_SMALLER_ACTION). This is UNCHANGED by this fix. Per the
// fix prompt's option-(a) exemption: with /gate now access-restricted to an
// explicit tester allowlist, the only party who can trigger a /gate-caused
// supersession is an allowlisted tester interrupting their OWN session (a
// real participant can no longer reach /gate at all, so their in-progress
// session can no longer be superseded by someone else's /gate use). A
// tester is assumed to understand the tool well enough to recognize their
// own accidental self-interruption from the existing generic warning
// message, so a more specific "/gate interrupted your gate test" message
// was judged unnecessary complexity for a case that only ever affects the
// person who caused it.
//
// G4 INDEPENDENT VERIFICATION (Round 5, Section G audit, fixes/confirms
// audit finding G4): re-traced (not just re-read) both halves of this fix
// rather than trusting the claims above at face value, per this pack's own
// standard. Access-restriction: handleCommandOrText_'s /gate branch
// checks isTesterParticipant_ before any dispatch, rejection message is
// shape-identical to the generic unrecognized-input fallback, and
// isTesterParticipant_ fails closed on unset/empty TESTER_USER_IDS —
// confirmed working as designed. Data-segregation: session.payload.source_
// state is set exactly once, at createSession_, and grep-confirmed no
// other write site in the file ever overwrites it, so it remains
// origin-accurate through completion — confirmed genuinely immutable, not
// just claimed to be. Export filterability: exportParticipantData_ does
// add a HEADERS row per section, confirmed real. One stale inline
// cross-reference was found and fixed as F48 (see completeWithNewSignal_)
// — a documentation-only drift, not a gap in the misuse path itself. Call:
// option (c) closes the specific contamination scenario G4 raises
// (unlimited /gate practice runs before a real /start) exactly as F42's
// own reasoning anticipated; no residual security/misuse gap found.




// P07 controlled repair marker: explicit re-entry/session binding/replay/review-target/safety rules.
