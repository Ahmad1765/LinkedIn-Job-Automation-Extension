# AutoApplyMax

A Chrome extension that automates LinkedIn **Easy Apply** with AI-assisted question answering, daily-limit detection, and automatic cooldown recovery when LinkedIn rate-limits the session.

> Open-source core. Distributed under [AGPL-3.0](LICENSE).

---

## Features

- **One-click automation** of LinkedIn Easy Apply across `/jobs/search/` and `/jobs/collections/`.
- **Multi-locale UI handling** — locale-independent DOM selectors plus translated text fallbacks for English, French, Spanish, German, Italian, Dutch, Polish, Japanese, Chinese, and Korean LinkedIn accounts.
- **AI-assisted question answering** via OpenRouter (BYO API key). Falls back to safe defaults for "years of experience" questions when the LLM is unavailable.
- **Resume upload & reuse** — picks an existing uploaded resume or uploads a new PDF.
- **Blacklist filtering** by keyword, title, and minimum years of experience.
- **Daily-limit detection** — stops the bot cleanly when LinkedIn shows "You've reached today's Easy Apply limit".
- **Cooldown auto-resume** *(new)* — when LinkedIn temporarily throttles the bot ("applying too quickly"), the extension waits with exponential backoff (90s → 3min → 6min), refreshes the page, verifies Easy Apply is available again, and resumes automatically. Stops after three consecutive throttles.
- **Stuck-state recovery** — detects frozen modals and unresponsive loading popups, refreshes, and retries.
- **CSV export** of every applied job.

---

## Installation

This repository contains the unpacked extension. Install it in developer mode:

1. Clone or download this repository.
2. Open `chrome://extensions/` in Chrome.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the `AutoApplyMax` folder.
5. Pin the extension to the toolbar.

---

## Usage

1. Open the extension popup and fill in your profile (name, email, phone, years of experience, location, resume).
2. Add an OpenRouter API key for AI question answering (optional but recommended).
3. Navigate to `https://www.linkedin.com/jobs/search/` and apply the **Easy Apply** filter.
4. Click **Start** in the extension popup.
5. The bot iterates through the visible jobs, fills each form, and submits.

Status displayed in the popup:

| State | Meaning |
|-------|---------|
| `Stopped` | Bot idle, waiting for Start. |
| `Running` | Bot processing jobs. |
| `Cooldown (n/3) — Xs` | Rate-limited; refreshing and waiting `X` seconds before retrying attempt `n` of 3. |
| `Stopped (rate-limited)` | Three consecutive throttles. Wait 15–30 minutes before restarting. |

---

## Configuration

Stored locally in `chrome.storage.local`. No data leaves the browser except question text sent to OpenRouter (only when AI answering is enabled).

| Field | Purpose |
|-------|---------|
| Personal info | First/last name, email, phone, city, years of experience. |
| Resume PDF | Uploaded once; reused across applications. |
| Keywords | Comma-separated; jobs are blacklisted by title match. |
| Min years filter | Skips jobs requiring more years than configured. |
| OpenRouter API key | For AI question answering (optional). |

---

## How the Cooldown Works

LinkedIn enforces both a hard daily cap (≈ 50–100 applications) and a soft per-minute throttle. AutoApplyMax distinguishes them:

- **Daily limit** → bot stops permanently for the day.
- **Soft throttle** → bot enters cooldown:
  1. Stores cooldown state in `chrome.storage.local` (start time, duration, retry count).
  2. Reloads the page.
  3. On script reload, waits the remaining cooldown.
  4. Probes for a live Easy Apply button and checks that the throttle banner is gone.
  5. If both pass, restores the running flags and resumes the main loop.
  6. If still blocked, escalates to the next backoff tier and refreshes again.
  7. After three failed cycles, stops and alerts the user.

A successful application resets the retry counter so isolated throttles do not pre-escalate later ones.

---

## Project Structure

```
AutoApplyMax/
├── manifest.json          MV3 manifest
├── background.js          Service worker, OpenRouter proxy
├── content-simple.js      Main automation: detection, filling, cooldown, mainLoop
├── popup.html / popup.js  Extension UI, status, config
├── popup-improvements.js  Toasts, validation, onboarding
├── vendor/                pdf.js (resume parsing)
├── icons/                 Extension icons
└── docs/                  Static site assets
```

---

## Permissions

| Permission | Reason |
|------------|--------|
| `storage` | Persist config, counters, applied-job history, cooldown state. |
| `activeTab` | Read the current LinkedIn page when the popup is open. |
| `scripting` | Inject the content script on demand (no auto-load). |
| Host `https://www.linkedin.com/*` | Automate Easy Apply. |
| Host `https://openrouter.ai/*` | Send question text for AI answering when enabled. |

---

## Disclaimer

This extension automates interactions with LinkedIn. Automated activity may violate LinkedIn's Terms of Service and can result in account restrictions or bans. Use at your own risk. The authors accept no liability for account actions taken by LinkedIn.

---

## License

[GNU Affero General Public License v3.0](LICENSE).
