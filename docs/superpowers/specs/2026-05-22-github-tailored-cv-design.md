# Design: GitHub-Powered Tailored CV Generation

**Date:** 2026-05-22  
**Project:** AutoApplyMax — Chrome Extension (MV3)  
**Status:** Approved — ready for implementation planning

---

## 1. Goal

Add GitHub integration to AutoApplyMax that:
1. Connects to the user's GitHub via a Personal Access Token (PAT)
2. Lets the user select which of their repos to include in CV generation
3. Fetches enriched data (languages, README, commits) for selected repos only
4. Generates a tailored PDF CV per job using the existing OpenRouter LLM integration
5. Automatically uploads the tailored CV in LinkedIn Easy Apply instead of the static resume
6. Falls back silently to the static resume on any failure

All existing functionality is preserved. This is purely additive.

---

## 2. Architecture

### Component map

```
popup.html (4 tabs — NEW: GitHub tab)
  ├── popup.js              ← existing; 2 small changes
  ├── github-popup.js       ← NEW: GitHub tab UI logic (~300 lines)
  ├── cv-generator.js       ← NEW: jsPDF wrapper, shared context (~150 lines)
  └── vendor/jspdf.umd.min.js  ← NEW: jsPDF library (~500 KB)

background.js (service worker)
  ├── [existing: askLLM, askLLMBatch, incrementCount, …]
  └── [NEW message handlers]:
        githubTestConnection
        githubFetchUserRepos
        githubFetchRepoDetails
        generateTailoredCV

content-simple.js (injected into linkedin.com)
  └── [MODIFIED: resume upload block, ~40 lines added]
        - loads tailoredCVEnabled + githubRepos at startup
        - extracts job description from LinkedIn panel
        - tailored-CV branch with static-resume fallback

Injection chain (popup.js → chrome.scripting.executeScript):
  BEFORE: ['content-simple.js']
  AFTER:  ['vendor/jspdf.umd.min.js', 'cv-generator.js', 'content-simple.js']
```

### Why inject jsPDF with the content script

`background.js` is an MV3 service worker — no DOM, no canvas, cannot run jsPDF.  
`popup.js` has DOM but is only open when the user has the popup visible — unreliable during automation.  
Injecting `jspdf.umd.min.js` + `cv-generator.js` before `content-simple.js` gives all three files the same isolated-world context on the LinkedIn tab. `cv-generator.js` exposes `window.AutoApplyMax.generateCVPdf()` which `content-simple.js` calls. The popup independently loads the same two `<script>` tags for manual preview. No logic duplication.

---

## 3. Data Flow

### GitHub setup (one-time, in popup)

```
User enters PAT → "Test Connection"
  background: GET https://api.github.com/user
  → { login, avatar_url }
  popup: status badge "● Connected: <username>"
  store: githubUsername (local), githubConnectionStatus = "connected" (local)

"Fetch All Repos"
  background: GET /user/repos?per_page=100&sort=updated&type=all (paginate)
  → basic array: { name, fullName, language, stars, updatedAt, isPrivate, isFork }
  popup: renders scrollable checklist, pre-checks non-forks
  store: githubAllRepos (local), githubPinnedRepos = [checked fullNames] (sync)

"Fetch Details for Selected"
  for each pinned repo (sequential, not parallel):
    background: GET /languages, /readme, /commits?per_page=1, /contents/package.json
  popup: progress bar "Fetching 3 of 12 repos…"
  store: githubRepos = enriched array (local), githubReposFetchedAt (local)
```

### Automation flow (per job, in content-simple.js)

```
Bot loads → reads tailoredCVEnabled (sync), githubRepos (local)

Bot encounters Easy Apply file-upload field:
  if !tailoredCVEnabled → existing static resume upload [NO CHANGE]
  if tailoredCVEnabled:
    1. extractJobDescription() → scrape LinkedIn job detail panel text
    2. hash = fnv1a(jobDescription)
    3. check chrome.storage.local["cv_" + hash]
       HIT  → decode base64, create File, upload ✓
       MISS →
         a. sendMessage({ action: "generateTailoredCV", jobDesc, profile, githubProjects })
         b. background → OpenRouter → returns cvJson
         c. AutoApplyMax.cvToBase64(cvJson, profile) → base64 PDF
         d. store as cv_<hash>, evict oldest if cache > 20 entries
         e. upload ✓
    4. ANY error → log warning, fall back to static resume upload
```

### Manual preview flow (popup GitHub tab)

```
User pastes job description → "Generate & Preview CV"
  github-popup.js:
    sendMessage(generateTailoredCV) → cvJson
    AutoApplyMax.cvToBase64(cvJson, profile) → base64
    Blob URL → window.open() → PDF in new tab
  store: lastTailoredCVName (local)
```

---

## 4. New Components

### 4.1 `background.js` additions

**`githubTestConnection`**
- Input: `{ action, pat }`
- Reads PAT from message (not storage, so it can test before saving)
- `GET /user` with `Authorization: token <pat>`
- Returns `{ ok: true, username, avatarUrl }` or `{ ok: false, error }`

**`githubFetchUserRepos`**
- Input: `{ action, pat }`
- Paginates `GET /user/repos?per_page=100&sort=updated&type=all` until no next page
- Returns `{ ok: true, repos: [{name, fullName, language, stars, updatedAt, isPrivate, isFork}] }`
- Rate-limit header checked; if < 50 remaining, returns partial with a warning flag

**`githubFetchRepoDetails`**
- Input: `{ action, pat, fullName }` e.g. `"ahmad1765/my-project"`
- Parallel fetch of: `/languages`, `/readme` (base64-decoded, first 3000 chars), `/commits?per_page=1`, `/contents/package.json` (parsed if present)
- Returns enriched repo object (see storage schema)
- 404s on readme/package.json are silently swallowed

**`generateTailoredCV`**
- Input: `{ action, jobDesc, githubProjects, profile }`
- Reads `openrouterApiKey`, `openrouterModel` from sync storage
- System prompt instructs LLM to return **valid JSON only** matching this schema:
  ```json
  {
    "summary": "2-3 sentence professional summary",
    "skills": ["skill1", "skill2"],
    "projects": [
      {
        "name": "Repo Name",
        "description": "1-2 sentence description",
        "technologies": ["React", "Node.js"],
        "url": "https://github.com/..."
      }
    ],
    "githubUrl": "https://github.com/username"
  }
  ```
- Max 5 projects (LLM selects most relevant to job description)
- Returns `{ ok: true, cvJson }` or `{ ok: false, error }`
- Uses same `callOpenRouter` infrastructure as existing `askLLM`; no new HTTP layer needed

### 4.2 `cv-generator.js`

Exposes `window.AutoApplyMax` namespace. Safe to double-load (guard: `if (window.AutoApplyMax) return`).

**`AutoApplyMax.generateCVPdf(cvJson, profile)`**
- Creates `new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' })`
- Layout (top-down):
  - **Header**: Name (bold 16pt), City • Email • Phone (9pt gray)
  - **GitHub URL** (9pt blue, clickable via `doc.textWithLink`)
  - **Summary** (10pt, italic)
  - **Technical Skills** (comma-separated, 9pt)
  - **Projects** (each: name bold + tech stack italic + description)
- Returns the `jsPDF` doc instance

**`AutoApplyMax.cvToBase64(cvJson, profile)`**
- Calls `generateCVPdf`, returns `doc.output('datauristring').split(',')[1]`

**`AutoApplyMax.hashJobDesc(text)`**
- FNV-1a 32-bit, same algorithm as `cacheKey()` in `background.js`
- Returns hex string for use as `cv_<hash>` storage key

### 4.3 `github-popup.js`

Initialised by `initGitHubTab()` called from `popup.js` on `DOMContentLoaded`.

Key functions:
- `loadGitHubSettings()` — reads PAT, pinnedRepos, tailoredCVEnabled from storage; populates UI
- `saveGitHubSettings()` — debounced, writes PAT → sync, pinnedRepos → sync, tailoredCVEnabled → sync
- `testConnection()` — sends `githubTestConnection`, updates `.github-status` badge
- `fetchAllRepos()` — sends `githubFetchUserRepos`, renders repo checklist
- `fetchSelectedDetails()` — iterates checked repos, sends `githubFetchRepoDetails` per repo, updates progress bar
- `generatePreviewCV()` — reads textarea, sends `generateTailoredCV`, calls `AutoApplyMax.cvToBase64`, opens blob URL
- `renderRepoList(repos)` — builds checkbox list; forks shown dimmed; pre-checks non-forks

### 4.4 `content-simple.js` modifications

**At startup** (in the `start` message handler, alongside existing resume/config loading):
```js
const githubLocal = await chrome.storage.local.get(['githubRepos']);
const githubSync  = await chrome.storage.sync.get(['tailoredCVEnabled', 'githubPinnedRepos']);
tailoredCVEnabled = githubSync.tailoredCVEnabled || false;
githubRepos = githubLocal.githubRepos || [];
```

**New function** `extractJobDescription()`:
```
Selectors tried in order:
  1. .jobs-description__content
  2. .jobs-box__html-content
  3. [data-job-id] .description__text
  4. article.jobs-description
Returns innerText of first match, trimmed to 4000 chars. Returns '' on failure.
```

**In resume upload block** — before the existing `if (!resumeAlreadySelected && resumeFile …)` block:
```js
if (!resumeAlreadySelected && tailoredCVEnabled && githubRepos.length > 0) {
  // companyName scraped from .jobs-unified-top-card__company-name or
  // .job-details-jobs-unified-top-card__company-name before entering modal
  const uploaded = await tryUploadTailoredCV(modal, fileInput, companyName);
  if (uploaded) break;
  // fall through to static resume on failure
}
```

`tryUploadTailoredCV(modal, fileInput, companyName)` — async, wraps the full generate→cache→upload flow, returns `true` on success or `false` on any error.

### 4.5 `popup.html` changes

- Add `<button class="tab" data-tab="github">GitHub</button>` (4th tab)
- Add `<div id="github-tab" class="tab-content">` (full GitHub UI, see wireframe)
- Add before `</body>`:
  ```html
  <script src="vendor/jspdf.umd.min.js"></script>
  <script src="cv-generator.js"></script>
  <script src="github-popup.js"></script>
  ```

### 4.6 `popup.js` changes

1. In `executeScript` call, change `files` to:
   ```js
   files: ['vendor/jspdf.umd.min.js', 'cv-generator.js', 'content-simple.js']
   ```
2. In `DOMContentLoaded`, call `initGitHubTab()` (defined in `github-popup.js`)

---

## 5. Storage Schema Additions

| Store | Key | Type | Purpose |
|-------|-----|------|---------|
| sync | `githubPAT` | string | Personal Access Token |
| sync | `tailoredCVEnabled` | boolean | Feature on/off |
| sync | `githubPinnedRepos` | string[] | `["owner/repo", …]` — user-selected repos |
| local | `githubUsername` | string | Authenticated username |
| local | `githubConnectionStatus` | string | `"disconnected"/"connected"/"error"` |
| local | `githubAllRepos` | object[] | Basic repo list for checklist display |
| local | `githubRepos` | object[] | Enriched data for pinned repos only |
| local | `githubReposFetchedAt` | number | Timestamp ms of last detail fetch |
| local | `cv_<hash>` | object | `{pdf: base64, name: string, ts: number}` |
| local | `lastTailoredCVName` | string | Filename of last generated CV |

`chrome.storage.sync` limit: PAT (~94 chars) + pinnedRepos (bounded by user selection) + `tailoredCVEnabled` stays well under 8 KB/item and 100 KB total.  
`cv_<hash>` entries are capped at 20. Each PDF is ~100–200 KB base64 → max ~4 MB of CV cache in `local`.

---

## 6. GitHub Tab UI Wireframe

```
┌────────────────────────────────────────────┐
│  Personal Info │ Settings │ Applied │ GitHub │
├────────────────────────────────────────────┤
│                                            │
│ ── GitHub Connection ─────────────────── │
│  Personal Access Token                     │
│  [••••••••••••••••••] [👁] [Test]          │
│  ● Connected: ahmad1765          (or ✗)   │
│                                            │
│ ── Repositories ────────────────────────  │
│  [Fetch All Repos]   [Fetch Details ↓]    │
│  ████████░░ Fetching 3 of 12 repos…       │
│  ┌──────────────────────────────────────┐ │
│  │ ☑ linkedin-auto-apply   JS  ★ 42    │ │
│  │ ☑ portfolio-site        TS  ★ 8     │ │
│  │ ☐ old-project           Py  ★ 1     │ │
│  │ ☐ forked-thing  (fork)  —   ★ 0     │ │
│  └──────────────────────────────────────┘ │
│  [Select All]  [Deselect All]              │
│                                            │
│ ── AI-Tailored CV ──────────────────────  │
│  Enable tailored CV per job    [● ON ]     │
│                                            │
│  Paste a job description to preview:       │
│  ┌──────────────────────────────────────┐ │
│  │ Senior React Developer at Acme…     │ │
│  └──────────────────────────────────────┘ │
│  [Generate & Preview CV]                   │
│  Last: Ahmad_Zaman_CV_Google.pdf  [↓]     │
│                                            │
└────────────────────────────────────────────┘
```

---

## 7. Error Handling

| Failure | Behaviour |
|---------|-----------|
| Bad/missing PAT | Red badge "✗ Invalid token"; Fetch buttons disabled |
| GitHub 401 | `githubConnectionStatus = "error"`; toast shown |
| GitHub 403 / rate limit | Warning toast with reset time; use cached `githubRepos` |
| Zero repos returned | "No repositories found" in list; tailored CV auto-disabled |
| OpenRouter fails during CV gen | Log warning; fall back to static resume |
| jsPDF crash | Catch block; fall back to static resume |
| No pinned repos | LLM receives empty projects array; generates skills-only CV; still uploads |
| `tailoredCVEnabled` but no PAT or no enriched repos | Silent fall-through to static resume |
| `extractJobDescription()` returns empty | Skip tailored CV; use static resume |

---

## 8. Constraints Verified

- ✅ No build tools, no npm — jsPDF added as `vendor/jspdf.umd.min.js`
- ✅ No breaking changes — all existing functions untouched; resume upload modified only with additive branch
- ✅ `background.js` — only `fetch()` and `chrome.*` APIs used; no DOM
- ✅ `content-simple.js` still injected on-demand via `executeScript`, not added to `content_scripts`
- ✅ Popup stays ~400px wide; 4 tabs use abbreviated labels if needed (`GitHub` is short)
- ✅ Storage limits respected — PAT in sync (<100B), CV cache capped at 20 in local
- ✅ LinkedIn selectors locale-independent — `extractJobDescription()` uses CSS class selectors, not text
- ✅ `CLAUDE.md` to be updated after implementation

---

## 9. Implementation Order

1. `manifest.json` — add `https://api.github.com/*` to `host_permissions`
2. Download `vendor/jspdf.umd.min.js`
3. `background.js` — add 4 new message handlers
4. `cv-generator.js` — create new file
5. `github-popup.js` — create new file
6. `popup.html` — add GitHub tab button + content + script tags
7. `popup.css` — add GitHub tab styles
8. `popup.js` — update `executeScript` files array + call `initGitHubTab()`
9. `content-simple.js` — add startup loading, `extractJobDescription()`, `tryUploadTailoredCV()`
10. `CLAUDE.md` — document new subsystems, message types, storage keys
