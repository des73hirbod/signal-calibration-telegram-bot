# Signal Calibration Bot

A Telegram research prototype for structured daily decision reflection, built with **Google Apps Script** and **Google Sheets**.

## What it does

- Guides participants through an informed-consent and time-zone setup.
- Supports morning decision identification, candidate evaluation, and evening review.
- Records structured sessions, Signal history, and calibration/review data in Google Sheets.
- Includes safety-oriented exit paths and participant data-control commands.
- Provides a channel-membership access gate and controlled repeat-participation authorization.

## Tech stack

- **Google Apps Script** — Telegram webhook and application logic
- **Google Sheets** — structured storage
- **Telegram Bot API** — messaging and interactive callbacks
- **Script Properties** — deployment settings and secrets (never commit real values)

## Source files

| File | Purpose |
| --- | --- |
| `SignalCalibrationBot.gs` | Core bot, session flow, storage, reviews, and Telegram webhook |
| `ChannelGate.gs` | Channel-membership verification, participation eligibility, and owner controls |

Both `.gs` files belong to **the same Apps Script project**. The ChannelGate module depends on functions provided by the core module.

## Configuration overview

1. Create a Telegram bot and a Google spreadsheet; open a Google Apps Script project.
2. Add both `.gs` files to **the same** Apps Script project.
3. In **Project Settings → Script properties**, configure the required values:

   | Property | Purpose |
   | --- | --- |
   | `BOT_TOKEN` | Telegram bot token from BotFather |
   | `WEBHOOK_SECRET` | Strong random string, at least 32 characters |
   | `STORAGE_SPREADSHEET_ID` | Google Sheets spreadsheet ID |
   | `REQUIRED_CHANNEL_USERNAME` | Required Telegram channel username |
   | `ACCESS_IDENTITY_PEPPER` | Stable, secret random value, 32–512 characters |
   | `ACCESS_IDENTITY_PEPPER_VERSION` | `1` |
   | `WEB_APP_URL` | The deployed Apps Script Web App `/exec` URL |

4. Grant the bot the Telegram channel permissions needed to check membership. Deploy the Apps Script project as a web app with an accessible endpoint. Set `WEB_APP_URL` to that deployment's `/exec` URL.
5. From the Apps Script editor, manually run `configureWebhookOnce` to register and verify the webhook.

Optional configuration includes `OWNER_TELEGRAM_USER_ID` for owner controls and `TESTER_USER_IDS` for the restricted `/gate` test entry point. Advanced data migrations, owner authorization, backup/recovery, and deployment permissions require operator review before use.

**Important:** These steps describe the source-level integration, not a validated end-to-end deployment guide. The repository does not include a copied live Apps Script project manifest or an executable regression test suite.

## Project status and limitations

**Research / release-candidate source; not presented as production-ready.** The source describes a small formative usability phase, and contains operator procedures and known limitations in its comments. It does not establish clinical efficacy, provide emergency services, or support unsupervised production operation by itself.

## Privacy and security

- Do **not** commit bot tokens, webhook URLs containing tokens, identity peppers, participant records, private spreadsheet exports, or live configuration snapshots.
- Participant information may be sensitive. Publish source code only, not research data.
- The bot's data-deletion flow retains limited pseudonymous governance/access-control records after enrolled-participant deletion; read the source's privacy disclosures before deploying it.
- `WEBHOOK_SECRET` is passed through the Apps Script webhook URL query string. Keep both it and `BOT_TOKEN` confidential.

## License

No license has been granted in this repository. Contact the repository owner for permission to reuse or distribute the code until a license is selected.
