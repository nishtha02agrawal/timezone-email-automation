# Timezone-Aware Email Automation (Google Sheets + Gmail)

Send personalised email sequences to an international contact list — each email lands **during the recipient's own working hours** (Mon–Fri, 9 AM–5 PM in their local time), not yours.

Built with Google Apps Script. Free, no server, runs 24×7 in Google's cloud.

## Features

- **Local-time sending** — maps each contact's country (and state/city for multi-timezone countries like the US, Canada, Australia) to an IANA timezone and only sends inside their 9–5.
- **Local weekends** — respects Fri–Sat weekends in Saudi Arabia, Qatar, Kuwait, Egypt, Israel, Bangladesh and others.
- **3-step sequences** — first email + follow-ups after configurable wait days, sent as replies in the same Gmail thread.
- **Auto-stop** — a contact's sequence stops when they reply or the email bounces (checked again right before every follow-up).
- **Personalisation** — `{{FirstName}}`, `{{Company}}` or any column header, with fallbacks: `{{FirstName|there}}`. Contacts missing required data are skipped and flagged instead of receiving a broken email.
- **Deliverability guardrails** — daily cap, per-run cap and randomised gaps between sends.
- **Audit trail** — Status column per contact and a Log tab with every send and the recipient's local time.

## How it works

```
Every 15 min (time-driven trigger)
  ├─ Fill missing timezones from Country / State-City
  ├─ Scan Gmail for replies & bounces → stop those sequences
  ├─ Pick contacts whose next email is due AND who are inside local 9–5
  └─ Send via Gmail API (follow-ups threaded with In-Reply-To / References)
```

## Setup

1. Create a Google Sheet and import your contacts. Required columns: **Email**, **Country**. Recommended: **Name**, **Company**, **State / City**. See [`sample_contacts.csv`](sample_contacts.csv).
2. **Extensions → Apps Script.** Replace the default code with [`Code.gs`](Code.gs) and save.
3. Enable the Gmail API: **Services (+) → Gmail API → Add**, or show `appsscript.json` in Project Settings and replace it with [`appsscript.json`](appsscript.json).
4. Reload the sheet and use the **Email Automation** menu:
   1. **Set up sheets** — adds Templates, Settings and Log tabs plus tracking columns
   2. **Fill timezones** — check the Notes column for anything flagged
   3. Write your emails in **Templates**
   4. **Send test emails to me**
   5. **Start automation**

## Settings

| Setting | Default | Purpose |
|---|---|---|
| `START_HOUR` / `END_HOUR` | 9 / 17 | Sending window in the contact's local time |
| `SKIP_WEEKENDS` | TRUE | Skip the contact's local weekend |
| `DAILY_LIMIT` | 80 | Max emails per day (free Gmail: ≤ 100) |
| `PER_RUN` | 5 | Max emails per 15-minute run |
| `GAP_SECONDS` | 30 | Pause between sends (±30% random) |
| `SENDER_NAME` | — | Display name in the From field |
| `FOOTER` | — | Line appended to every email (e.g. opt-out note) |
| `PAUSED` | FALSE | Pause without removing the trigger |

## Status values

`Active` · `Completed` · `Replied` · `Bounced` · `Error` · `Duplicate` · `Invalid email` — type `Skip` to exclude a contact manually.

## Limitations

- Public holidays are not skipped.
- Gmail sending limits apply (≈100/day on free Gmail, ≈1,500/day on Workspace).
- Contacts without a country (or with an unrecognised one) are skipped until a timezone is added.

## Tech

Google Apps Script (V8) · Gmail API (Advanced Service) · Google Sheets
