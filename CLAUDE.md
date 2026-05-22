# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AutoApplyMax is a Chrome Extension (Manifest V3) that automates LinkedIn Easy Apply. It requires no build step — all files are plain JavaScript loaded directly as an unpacked extension.

## Loading the Extension

1. Open `chrome://extensions/` in Chrome.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the `AutoApplyMax/` folder.
4. After any JS/CSS change, click the refresh icon on the extension card in `chrome://extensions/`.
   - For `content-simple.js` changes, also reload the active LinkedIn tab.
   - For `background.js` changes, the service worker restarts automatically.

There are no build, lint, or test commands — edits are applied by reloading the extension.

## Architecture

The extension has three communication layers:

```
popup.html / popup.js / popup-improvements.js
        ↕ chrome.storage.local / chrome.storage.sync
background.js (service worker)
        ↕ chrome.runtime.sendMessage
content-simple.js (injected on-demand into linkedin.com)
```

### background.js — Service Worker

- **OpenRouter proxy**: Handles all `askLLM` and `askLLMBatch` messages from the content script. Never called from popup.
- **LLM cache**: Two-level (in-memory `Map` + `chrome.storage.local`). Cache key is FNV-1a hash of `question|fieldType|options`.
- **Batch answering**: `callOpenRouterBatch` sends all unanswered questions for a modal step in one API call; falls back to per-question `callOpenRouter` calls.
- **Placeholder detection**: `isPlaceholderAnswer()` rejects `/`, `-`, `N/A`, refusals, and empty replies; triggers one retry with a nudge message.

### content-simple.js — Main Automation

Injected on demand (not auto-loaded). Entry point is `mainLoop()`, started by a `start` message from the popup.

Key subsystems:
- **Selectors**: Locale-independent — prefers `data-*` attributes (`data-live-test-easy-apply-submit-button`, etc.) over translated text. Text fallbacks exist for 10+ locales.
- **Cooldown state machine**: Two storage flags coordinate a two-reload cycle:
  - `cooldownPending=true` → wait timer running, page will reload at end.
  - `cooldownReadyToResume=true` → post-wait reload; script probes for a live Easy Apply button before resuming.
  - Retries escalate 90s → 3min → 6min; stops after 3 consecutive throttles.
  - `cooldownAborted` flag lets Stop break the wait loop immediately.
- **Security gate**: `userExplicitlyClickedStart` must be `true` for `click()` to fire. Prevents accidental automation on script reload.
- **Stuck detection**: 2-minute inactivity triggers a page reload and retry.

### popup.js + popup-improvements.js

- `popup.js`: Main UI logic — tabs, config save/load, start/stop, status polling, applied-jobs list, CSV export.
- `popup-improvements.js`: Toast notifications, field validation, first-run onboarding overlay.
- Status display reads `cooldownPending`/`cooldownReadyToResume` from storage and shows `Cooldown (n/3) — Xs` or `Resuming (n/3)…` accordingly.

## Storage Schema

| Store | Key | Purpose |
|-------|-----|---------|
| `sync` | `openrouterApiKey`, `openrouterModel`, `aiEnabled` | OpenRouter config |
| `sync` | `firstName`, `lastName`, `email`, `phone`, `phoneCountryCode`, `city`, `yearsOfExperience`, `expectedSalary`, `visaSponsorship`, `legallyAuthorized`, `willingToRelocate`, `driversLicense` | Candidate profile |
| `sync` | `keywords`, `minYearsFilter` | Blacklist filters |
| `local` | `isRunning`, `appliedCount`, `skippedCount`, `appliedJobs` | Runtime counters |
| `local` | `resumeText`, `resumeFile`, `resumeFileName`, `resumeFileType` | Resume data |
| `local` | `cooldownPending`, `cooldownReadyToResume`, `cooldownStartTime`, `cooldownDuration`, `cooldownRetries` | Cooldown state |
| `local` | `llm_<hash>` | Per-question LLM answer cache |
| `local` | `onboardingCompleted` | First-run flag |

## Key Constraints

- **No external build**: Do not introduce a bundler, transpiler, or npm dependencies. The extension must remain loadable as a plain unpacked folder.
- **Locale independence**: All LinkedIn DOM selectors must use `data-*` attributes or structural CSS classes, never translated text alone. Add translated text only as a fallback after data-attr checks fail.
- **Cooldown staleness guard**: The popup treats cooldown storage as stale after 30 minutes (`COOLDOWN_STALE_MS`). Any cooldown timing changes must stay under this threshold or update the guard.
- **Content script injection**: `content-simple.js` has no `run_at` in the manifest; it is injected via `chrome.scripting.executeScript` from the popup. Do not add it to `content_scripts` in the manifest.

---

## GitHub-Powered Tailored CV — Added in v1.7.0

### New Files
- `cv-generator.js` — `window.AutoApplyMax` namespace. `generateCVPdf(cvJson, profile)`, `cvToBase64(cvJson, profile)`, `hashJobDesc(text)`. Injected before `content-simple.js` and loaded in `popup.html`. Depends on `window.jspdf` from `vendor/jspdf.umd.min.js`.
- `github-popup.js` — GitHub tab UI logic. Loaded in `popup.html`. Entry point: `initGitHubTab()` called from `popup.js` `DOMContentLoaded`.
- `vendor/jspdf.umd.min.js` — jsPDF 2.5.1 UMD build (client-side PDF generation).
- `test-cv-generator.html` — Browser test page for `cv-generator.js` (not shipped, development only).

### Injection Chain (popup.js → executeScript)
```
['vendor/jspdf.umd.min.js', 'cv-generator.js', 'content-simple.js']
```
All three run in the same isolated world on the LinkedIn tab. `window.AutoApplyMax` and `window.jspdf` are available to `content-simple.js`.

### New Message Actions (background.js)
| Action | Input | Returns |
|--------|-------|---------|
| `githubTestConnection` | `{ pat }` | `{ ok, username, avatarUrl }` |
| `githubFetchUserRepos` | `{ pat }` | `{ ok, repos: [{name, fullName, language, stars, updatedAt, isPrivate, isFork}] }` |
| `githubFetchRepoDetails` | `{ pat, fullName }` | `{ ok, details: { languages, readmeContent, packageJson, contributionStats } }` |
| `generateTailoredCV` | `{ jobDesc, githubProjects, profile }` | `{ ok, cvJson: { summary, skills, projects, githubUrl } }` |

### New Storage Keys
| Store | Key | Purpose |
|-------|-----|---------|
| `sync` | `githubPAT` | Personal Access Token |
| `sync` | `tailoredCVEnabled` | Feature on/off |
| `sync` | `githubPinnedRepos` | `string[]` of `"owner/repo"` to enrich |
| `local` | `githubUsername` | Authenticated GitHub username |
| `local` | `githubConnectionStatus` | `"disconnected" / "connected" / "error"` |
| `local` | `githubAllRepos` | Basic repo list (for checkbox display) |
| `local` | `githubRepos` | Enriched data for pinned repos only |
| `local` | `githubReposFetchedAt` | Timestamp ms of last detail fetch |
| `local` | `cv_<hash>` | `{ pdf: base64, name: string, ts: number }` — cached generated CVs (max 20) |
| `local` | `lastTailoredCVName` | Filename of last generated CV |
| `local` | `lastTailoredCVData` | Base64 PDF of last generated CV (for popup download) |

### Key Constraints Added
- **CV cache limit:** `cv_<hash>` entries capped at 20; oldest is evicted when limit is reached.
- **jsPDF only in isolated world:** `window.jspdf` is accessible in content script and popup page. It is NOT available in `background.js` (service worker — no DOM).
- **Fallback guarantee:** `tryUploadTailoredCV()` catches all errors and returns `false`, guaranteeing the static resume upload block runs if tailored CV fails.
