# GitHub-Powered Tailored CV Generation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add GitHub repo analysis + AI-powered per-job PDF CV generation to AutoApplyMax, with automatic LinkedIn upload and zero regression to existing features.

**Architecture:** Inject `jspdf.umd.min.js` + new `cv-generator.js` alongside `content-simple.js` so PDF generation works headlessly during automation. All GitHub API calls route through `background.js` (service worker). A new `github-popup.js` file owns the 4th popup tab. `content-simple.js` gets a ~50-line surgical addition — one fallback branch in the resume upload block.

**Tech Stack:** Chrome Extension MV3, plain vanilla JS (no bundler), jsPDF 2.5.1 UMD, GitHub REST API v3, OpenRouter (existing).

**Spec:** `docs/superpowers/specs/2026-05-22-github-tailored-cv-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `manifest.json` | Add `https://api.github.com/*` host permission |
| Add | `vendor/jspdf.umd.min.js` | jsPDF library (downloaded) |
| **Create** | `cv-generator.js` | `window.AutoApplyMax` namespace: `generateCVPdf`, `cvToBase64`, `hashJobDesc` |
| **Create** | `test-cv-generator.html` | Browser test page for cv-generator (no chrome.* needed) |
| Modify | `background.js` | 4 new message handlers + GitHub API helper functions |
| Modify | `popup.html` | 4th tab button + GitHub tab `<div>` + 3 new `<script>` tags |
| Modify | `popup.css` | GitHub tab styles (status badge, repo list, progress bar) |
| **Create** | `github-popup.js` | All GitHub tab UI logic |
| Modify | `popup.js` | 2 lines: update `executeScript` files + call `initGitHubTab()` |
| Modify | `content-simple.js` | 3 module vars + `extractJobDescription()` + `extractCompanyName()` + `tryUploadTailoredCV()` |
| Modify | `CLAUDE.md` | Document new subsystems, message types, storage keys |

---

## Task 1: Manifest + jsPDF Download

**Files:**
- Modify: `manifest.json`
- Add: `vendor/jspdf.umd.min.js` (downloaded)

- [ ] **Step 1: Add GitHub host permission to manifest.json**

Open `manifest.json`. Change `host_permissions` from:
```json
"host_permissions": [
  "https://www.linkedin.com/*",
  "https://openrouter.ai/*"
]
```
to:
```json
"host_permissions": [
  "https://www.linkedin.com/*",
  "https://openrouter.ai/*",
  "https://api.github.com/*"
]
```

- [ ] **Step 2: Download jsPDF into vendor/**

Run in PowerShell from `AutoApplyMax/`:
```powershell
Invoke-WebRequest -Uri "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js" -OutFile "vendor\jspdf.umd.min.js"
```
Expected: `vendor\jspdf.umd.min.js` exists, ~500 KB.

- [ ] **Step 3: Verify extension still loads**

In Chrome: `chrome://extensions/` → click refresh on the extension card. No red error banner should appear. Open popup — all 3 existing tabs work.

- [ ] **Step 4: Commit**

```bash
git add manifest.json vendor/jspdf.umd.min.js
git commit -m "feat: add github host permission + jsPDF vendor library"
```

---

## Task 2: cv-generator.js — PDF Generation Module

**Files:**
- Create: `cv-generator.js`
- Create: `test-cv-generator.html` (test only, not shipped)

- [ ] **Step 1: Create the test page first**

Create `test-cv-generator.html`:
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>cv-generator tests</title>
</head>
<body>
  <h2>cv-generator.js Tests</h2>
  <pre id="output"></pre>
  <script src="vendor/jspdf.umd.min.js"></script>
  <script src="cv-generator.js"></script>
  <script>
    const out = document.getElementById('output');
    function pass(msg) { out.textContent += '✅ ' + msg + '\n'; }
    function fail(msg) { out.textContent += '❌ FAIL: ' + msg + '\n'; console.error(msg); }

    // Test 1: namespace exists
    if (window.AutoApplyMax && typeof window.AutoApplyMax.generateCVPdf === 'function') {
      pass('AutoApplyMax.generateCVPdf is a function');
    } else {
      fail('AutoApplyMax.generateCVPdf missing');
    }

    // Test 2: hashJobDesc produces consistent hex strings
    const h1 = window.AutoApplyMax.hashJobDesc('Senior React Developer');
    const h2 = window.AutoApplyMax.hashJobDesc('Senior React Developer');
    if (h1 === h2 && h1.startsWith('cv_') && h1.length > 5) {
      pass('hashJobDesc is deterministic: ' + h1);
    } else {
      fail('hashJobDesc inconsistent: ' + h1 + ' vs ' + h2);
    }

    // Test 3: different inputs produce different hashes
    const h3 = window.AutoApplyMax.hashJobDesc('Backend Python Engineer');
    if (h1 !== h3) {
      pass('hashJobDesc differentiates inputs');
    } else {
      fail('hashJobDesc collision on different inputs');
    }

    // Test 4: cvToBase64 returns non-empty base64 string
    const sampleCV = {
      summary: 'Experienced full-stack developer with 5 years building scalable web apps.',
      skills: ['React', 'Node.js', 'TypeScript', 'PostgreSQL'],
      projects: [
        {
          name: 'my-portfolio',
          description: 'Personal portfolio built with React and deployed on Vercel.',
          technologies: ['React', 'CSS'],
          url: 'https://github.com/user/my-portfolio'
        }
      ],
      githubUrl: 'https://github.com/user'
    };
    const sampleProfile = {
      firstName: 'John', lastName: 'Doe',
      email: 'john@example.com', phone: '+1 555 0100', city: 'New York'
    };

    try {
      const b64 = window.AutoApplyMax.cvToBase64(sampleCV, sampleProfile);
      if (typeof b64 === 'string' && b64.length > 1000) {
        pass('cvToBase64 returns base64 string (' + b64.length + ' chars)');
      } else {
        fail('cvToBase64 returned short/invalid string: ' + b64.substring(0, 50));
      }
    } catch (e) {
      fail('cvToBase64 threw: ' + e.message);
    }

    // Test 5: idempotent guard — double-loading should not throw
    try {
      // Simulate re-injection by re-running the guard
      const orig = window.AutoApplyMax.generateCVPdf;
      window.AutoApplyMax.generateCVPdf = orig; // no-op guard test
      pass('Idempotent re-assign safe');
    } catch (e) {
      fail('Idempotent test threw: ' + e.message);
    }
  </script>
</body>
</html>
```

- [ ] **Step 2: Run tests — expect all FAIL (cv-generator.js doesn't exist yet)**

Open `test-cv-generator.html` in Chrome via `File > Open File` or `file:///...` path.  
Expected: All tests show `❌ FAIL`.

- [ ] **Step 3: Create cv-generator.js**

Create `cv-generator.js` in the `AutoApplyMax/` root:
```javascript
// cv-generator.js — Shared PDF generation module
// Loaded in: popup.html (via <script>), content-script context (injected before content-simple.js)
// Depends on: window.jspdf (from vendor/jspdf.umd.min.js)

(function () {
  'use strict';

  // Idempotent guard — safe to inject multiple times
  if (window.AutoApplyMax && window.AutoApplyMax.generateCVPdf) return;

  window.AutoApplyMax = window.AutoApplyMax || {};

  // ── FNV-1a 32-bit hash (same algorithm as background.js cacheKey) ──────────
  function hashJobDesc(text) {
    let h = 0x811c9dc5;
    const norm = (text || '').toLowerCase().trim();
    for (let i = 0; i < norm.length; i++) {
      h ^= norm.charCodeAt(i);
      h = (h * 0x01000193) >>> 0;
    }
    return 'cv_' + h.toString(16);
  }

  // ── Generate jsPDF document from structured CV JSON + profile ───────────────
  function generateCVPdf(cvJson, profile) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });

    const pageW = 210;
    const margin = 18;
    const contentW = pageW - margin * 2;
    let y = 20;

    function rgb(r, g, b) { doc.setTextColor(r, g, b); }
    function drawLine() {
      doc.setDrawColor(200, 200, 200);
      doc.line(margin, y, pageW - margin, y);
      y += 5;
    }

    // ── Header: Name ─────────────────────────────────────────────────────────
    const name = ((profile.firstName || '') + ' ' + (profile.lastName || '')).trim() || 'Candidate';
    doc.setFontSize(20);
    doc.setFont('helvetica', 'bold');
    rgb(30, 30, 30);
    doc.text(name, margin, y);
    y += 7;

    // Contact line
    const contactParts = [profile.email, profile.phone, profile.city].filter(Boolean);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    rgb(100, 100, 100);
    if (contactParts.length) {
      doc.text(contactParts.join('  •  '), margin, y);
      y += 5;
    }

    // GitHub URL
    if (cvJson.githubUrl) {
      doc.setFontSize(9);
      rgb(10, 102, 194);
      doc.textWithLink(cvJson.githubUrl, margin, y, { url: cvJson.githubUrl });
      y += 5;
    }

    drawLine();

    // ── Professional Summary ──────────────────────────────────────────────────
    if (cvJson.summary) {
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      rgb(30, 30, 30);
      doc.text('Professional Summary', margin, y);
      y += 5;

      doc.setFontSize(9.5);
      doc.setFont('helvetica', 'italic');
      rgb(50, 50, 50);
      const summaryLines = doc.splitTextToSize(cvJson.summary, contentW);
      doc.text(summaryLines, margin, y);
      y += summaryLines.length * 5 + 4;
    }

    // ── Technical Skills ──────────────────────────────────────────────────────
    if (cvJson.skills && cvJson.skills.length > 0) {
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      rgb(30, 30, 30);
      doc.text('Technical Skills', margin, y);
      y += 5;

      doc.setFontSize(9.5);
      doc.setFont('helvetica', 'normal');
      rgb(50, 50, 50);
      const skillText = cvJson.skills.join('  ·  ');
      const skillLines = doc.splitTextToSize(skillText, contentW);
      doc.text(skillLines, margin, y);
      y += skillLines.length * 5 + 4;
    }

    // ── Project Experience ────────────────────────────────────────────────────
    if (cvJson.projects && cvJson.projects.length > 0) {
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      rgb(30, 30, 30);
      doc.text('Project Experience', margin, y);
      y += 6;

      for (const proj of cvJson.projects.slice(0, 5)) {
        if (y > 265) break; // page overflow guard

        // Project name (linked if URL provided)
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        rgb(10, 102, 194);
        if (proj.url) {
          doc.textWithLink(proj.name || 'Project', margin, y, { url: proj.url });
        } else {
          doc.text(proj.name || 'Project', margin, y);
        }

        // Tech stack inline after name
        if (proj.technologies && proj.technologies.length > 0) {
          const nameW = doc.getTextWidth(proj.name || 'Project') + 4;
          doc.setFontSize(8.5);
          doc.setFont('helvetica', 'italic');
          rgb(100, 100, 100);
          doc.text(proj.technologies.join(', '), margin + nameW, y);
        }
        y += 5;

        // Description
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        rgb(50, 50, 50);
        const descLines = doc.splitTextToSize(proj.description || '', contentW);
        doc.text(descLines, margin + 3, y);
        y += descLines.length * 4.5 + 5;
      }
    }

    return doc;
  }

  // ── Returns base64 string (no data-URI prefix) ────────────────────────────
  function cvToBase64(cvJson, profile) {
    const doc = generateCVPdf(cvJson, profile);
    return doc.output('datauristring').split(',')[1];
  }

  window.AutoApplyMax.generateCVPdf = generateCVPdf;
  window.AutoApplyMax.cvToBase64    = cvToBase64;
  window.AutoApplyMax.hashJobDesc   = hashJobDesc;
})();
```

- [ ] **Step 4: Run tests — expect all PASS**

Reload `test-cv-generator.html` in Chrome.  
Expected output:
```
✅ AutoApplyMax.generateCVPdf is a function
✅ hashJobDesc is deterministic: cv_<hex>
✅ hashJobDesc differentiates inputs
✅ cvToBase64 returns base64 string (NNNN chars)
✅ Idempotent re-assign safe
```

- [ ] **Step 5: Commit**

```bash
git add cv-generator.js test-cv-generator.html
git commit -m "feat: add cv-generator.js PDF generation module with browser tests"
```

---

## Task 3: background.js — GitHub API Handlers

**Files:**
- Modify: `background.js` (append before the closing `});` of the message listener)

- [ ] **Step 1: Add GitHub helper functions to background.js**

Open `background.js`. BEFORE the `// Message listener` comment (line ~345), insert:
```javascript
// ═══════════════════════════════════════════════════════════════════════════
// GITHUB INTEGRATION
// ═══════════════════════════════════════════════════════════════════════════

const GITHUB_API = 'https://api.github.com';

function githubHeaders(pat) {
  return {
    'Authorization': `token ${pat.trim()}`,
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'AutoApplyMax-Extension'
  };
}

async function githubGet(pat, path) {
  const resp = await fetch(`${GITHUB_API}${path}`, { headers: githubHeaders(pat) });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    const e = new Error(err.message || `GitHub API error ${resp.status}`);
    e.status = resp.status;
    throw e;
  }
  return resp.json();
}

async function handleGithubTestConnection(pat) {
  const user = await githubGet(pat, '/user');
  return { ok: true, username: user.login, avatarUrl: user.avatar_url };
}

async function handleGithubFetchUserRepos(pat) {
  const repos = [];
  let page = 1;
  while (true) {
    const batch = await githubGet(pat, `/user/repos?per_page=100&sort=updated&type=all&page=${page}`);
    if (!batch.length) break;
    for (const r of batch) {
      repos.push({
        name: r.name,
        fullName: r.full_name,
        description: r.description || '',
        language: r.language || null,
        stars: r.stargazers_count || 0,
        updatedAt: r.updated_at,
        isPrivate: r.private,
        isFork: r.fork
      });
    }
    if (batch.length < 100) break;
    page++;
  }
  return { ok: true, repos };
}

async function handleGithubFetchRepoDetails(pat, fullName) {
  // Parallel: languages + commits (both reliable)
  const [langData, commitsData] = await Promise.all([
    githubGet(pat, `/repos/${fullName}/languages`).catch(() => ({})),
    githubGet(pat, `/repos/${fullName}/commits?per_page=1`).catch(() => ([]))
  ]);

  // README — 404 is expected for repos without one
  let readmeContent = '';
  try {
    const readme = await githubGet(pat, `/repos/${fullName}/readme`);
    readmeContent = atob(readme.content.replace(/\n/g, '')).substring(0, 3000);
  } catch (_) { /* no readme */ }

  // package.json — 404 is expected for non-JS repos
  let packageJson = null;
  try {
    const pkg = await githubGet(pat, `/repos/${fullName}/contents/package.json`);
    const parsed = JSON.parse(atob(pkg.content.replace(/\n/g, '')));
    packageJson = {
      dependencies: parsed.dependencies || {},
      devDependencies: parsed.devDependencies || {}
    };
  } catch (_) { /* no package.json */ }

  return {
    languages: langData,
    readmeContent,
    packageJson,
    contributionStats: {
      lastCommitDate: commitsData[0]?.commit?.committer?.date || null
    }
  };
}
```

- [ ] **Step 2: Add GitHub message handlers to the listener**

Inside `chrome.runtime.onMessage.addListener(...)`, find the very last handler — `askLLM` ends with:
```javascript
    return true; // keep channel open for async sendResponse
  }
});
```

Replace that closing section with:
```javascript
    return true; // keep channel open for async sendResponse
  } else if (message.action === 'githubTestConnection') {
    (async () => {
      try {
        sendResponse(await handleGithubTestConnection(message.pat));
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  } else if (message.action === 'githubFetchUserRepos') {
    (async () => {
      try {
        sendResponse(await handleGithubFetchUserRepos(message.pat));
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  } else if (message.action === 'githubFetchRepoDetails') {
    (async () => {
      try {
        const details = await handleGithubFetchRepoDetails(message.pat, message.fullName);
        sendResponse({ ok: true, details });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }
});
```

- [ ] **Step 3: Test in Chrome DevTools**

Reload the extension. Open the popup, open DevTools on the popup (right-click → Inspect), and run in the Console (replace `YOUR_PAT`):
```javascript
chrome.runtime.sendMessage(
  { action: 'githubTestConnection', pat: 'YOUR_PAT' },
  r => console.log(r)
);
```
Expected: `{ ok: true, username: "your-github-username", avatarUrl: "..." }`

Test repo fetch (limit to 1 page for speed):
```javascript
chrome.runtime.sendMessage(
  { action: 'githubFetchUserRepos', pat: 'YOUR_PAT' },
  r => console.log('repos:', r.repos?.length, r.repos?.[0])
);
```
Expected: `{ ok: true, repos: [...] }` with `repos.length > 0`.

Test repo details (use a real repo full name):
```javascript
chrome.runtime.sendMessage(
  { action: 'githubFetchRepoDetails', pat: 'YOUR_PAT', fullName: 'YOUR_USER/YOUR_REPO' },
  r => console.log(r)
);
```
Expected: `{ ok: true, details: { languages: {...}, readmeContent: "...", packageJson: ..., contributionStats: {...} } }`

- [ ] **Step 4: Commit**

```bash
git add background.js
git commit -m "feat: add GitHub API handlers to background.js (test/fetch/details)"
```

---

## Task 4: background.js — generateTailoredCV Handler

**Files:**
- Modify: `background.js`

- [ ] **Step 1: Add generateTailoredCV helper function**

Add after `handleGithubFetchRepoDetails` (before the message listener):
```javascript
async function handleGenerateTailoredCV({ jobDesc, githubProjects, profile }) {
  const cfg = await chrome.storage.sync.get(['openrouterApiKey', 'openrouterModel']);
  if (!cfg.openrouterApiKey || !cfg.openrouterApiKey.trim()) {
    throw new Error('OpenRouter API key not set');
  }

  // Build project summaries (max 15 repos, capped for token efficiency)
  const projectSummaries = (githubProjects || []).slice(0, 15).map(r => {
    const langs = Object.keys(r.languages || {}).slice(0, 5).join(', ');
    const pkgDeps = r.packageJson
      ? Object.keys({ ...r.packageJson.dependencies, ...r.packageJson.devDependencies }).slice(0, 10).join(', ')
      : '';
    return [
      `Repo: ${r.fullName || r.name}`,
      langs          ? `Languages: ${langs}`     : (r.language ? `Language: ${r.language}` : ''),
      pkgDeps        ? `Packages: ${pkgDeps}`     : '',
      r.description  ? `Description: ${r.description}` : '',
      r.readmeContent ? `README: ${r.readmeContent.substring(0, 400)}` : ''
    ].filter(Boolean).join('\n');
  }).join('\n\n---\n\n');

  const systemPrompt = `You are a professional CV writer. Given a job description and a developer's GitHub projects, produce a tailored, ATS-friendly CV section.

Output ONLY valid JSON — no prose, no markdown fences, no extra keys:
{
  "summary": "2-3 sentence professional summary emphasising fit for this role",
  "skills": ["skill1", "skill2"],
  "projects": [
    {
      "name": "Repo Name",
      "description": "1-2 sentences emphasising relevance to the job",
      "technologies": ["Tech1", "Tech2"],
      "url": "https://github.com/owner/repo"
    }
  ],
  "githubUrl": "https://github.com/<username>"
}

Rules:
- Include 3-5 most relevant projects only
- skills: 8-15 items, prioritise skills from the job description
- summary: first person, professional, directly addresses role requirements
- githubUrl: derive from the fullName fields (owner part)`;

  const userPrompt = `CANDIDATE PROFILE:
Name: ${((profile.firstName || '') + ' ' + (profile.lastName || '')).trim()}
Email: ${profile.email || ''}
Phone: ${profile.phone || ''}
City: ${profile.city || ''}
Years of Experience: ${profile.yearsOfExperience || ''}

JOB DESCRIPTION (first 3000 chars):
${(jobDesc || '').substring(0, 3000)}

GITHUB PROJECTS:
${projectSummaries || '(none provided — generate skills-only CV)'}`;

  const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${cfg.openrouterApiKey.trim()}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/local/job-auto-apply',
      'X-Title': 'Job Auto Apply'
    },
    body: JSON.stringify({
      model: (cfg.openrouterModel || 'openai/gpt-4o-mini').trim(),
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt }
      ],
      max_tokens: 1200,
      temperature: 0.4
    })
  });

  if (!resp.ok) {
    const errBody = await resp.json().catch(() => ({}));
    throw new Error(`OpenRouter ${resp.status}: ${errBody.error?.message || 'unknown error'}`);
  }

  const data = await resp.json();
  const raw = data.choices?.[0]?.message?.content || '';

  // Strip accidental markdown fences before parsing
  const jsonStr = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const cvJson = JSON.parse(jsonStr);
  return { ok: true, cvJson };
}
```

- [ ] **Step 2: Add generateTailoredCV message handler**

Inside the message listener, add after the `githubFetchRepoDetails` handler (before the closing `}`):
```javascript
  } else if (message.action === 'generateTailoredCV') {
    (async () => {
      try {
        sendResponse(await handleGenerateTailoredCV(message));
      } catch (err) {
        console.error('generateTailoredCV error:', err);
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }
```

- [ ] **Step 3: Test in popup DevTools console**

Make sure OpenRouter API key is saved in the popup Settings first. Then run (replace sample data):
```javascript
chrome.runtime.sendMessage({
  action: 'generateTailoredCV',
  jobDesc: 'Senior React Developer. Must know React, TypeScript, Node.js. 3+ years experience.',
  githubProjects: [],
  profile: { firstName: 'John', lastName: 'Doe', email: 'john@example.com', city: 'NYC', yearsOfExperience: '4' }
}, r => console.log('CV JSON:', r));
```
Expected: `{ ok: true, cvJson: { summary: "...", skills: [...], projects: [...], githubUrl: "..." } }`

- [ ] **Step 4: Commit**

```bash
git add background.js
git commit -m "feat: add generateTailoredCV LLM handler to background.js"
```

---

## Task 5: popup.html — 4th GitHub Tab

**Files:**
- Modify: `popup.html`

- [ ] **Step 1: Add the GitHub tab button**

Find the tabs block (around line 41-45):
```html
    <div class="tabs">
      <button class="tab active" data-tab="personal">Personal Info</button>
      <button class="tab" data-tab="settings">Settings</button>
      <button class="tab" data-tab="applied">Applied Jobs</button>
    </div>
```
Replace with:
```html
    <div class="tabs">
      <button class="tab active" data-tab="personal">Personal Info</button>
      <button class="tab" data-tab="settings">Settings</button>
      <button class="tab" data-tab="applied">Applied Jobs</button>
      <button class="tab" data-tab="github">GitHub</button>
    </div>
```

- [ ] **Step 2: Add the GitHub tab content div**

Find `<!-- Instructions -->` section near the bottom of the tab content area (around line 484). Insert the GitHub tab div BEFORE the instructions div:

```html
    <!-- GitHub Tab -->
    <div id="github-tab" class="tab-content">

      <!-- Connection Section -->
      <div class="section-header">GitHub Connection</div>
      <div class="form-group">
        <label>Personal Access Token</label>
        <div class="pat-input-row">
          <input type="password" id="githubPAT" placeholder="ghp_xxxxxxxxxxxxxxxxxxxx" autocomplete="off">
          <button id="githubPATToggle" class="btn-icon" title="Show/hide token">👁</button>
          <button id="githubTestBtn" class="btn btn-secondary btn-sm">Test</button>
        </div>
        <span id="githubConnectionStatus" class="github-status disconnected">○ Not connected</span>
      </div>

      <!-- Repository Section -->
      <div class="section-header">Repositories</div>
      <div class="github-repo-actions">
        <button id="githubFetchReposBtn" class="btn btn-secondary btn-sm" disabled>Fetch All Repos</button>
        <button id="githubFetchDetailsBtn" class="btn btn-primary btn-sm" disabled>Fetch Details ↓</button>
      </div>
      <div class="github-progress" id="githubProgressContainer" style="display:none">
        <div class="github-progress-bar-track">
          <div class="github-progress-bar" id="githubProgressBar" style="width:0%"></div>
        </div>
        <span id="githubProgressText" class="github-progress-text"></span>
      </div>
      <div id="githubRepoList" class="github-repo-list">
        <span class="github-muted">Click "Fetch All Repos" to load your repositories.</span>
      </div>
      <div class="github-repo-controls" id="githubRepoControls" style="display:none">
        <button id="githubSelectAll" class="btn btn-link btn-sm">Select All</button>
        <button id="githubDeselectAll" class="btn btn-link btn-sm">Deselect All</button>
        <span id="githubDetailsStatus" class="github-muted"></span>
      </div>

      <!-- AI-Tailored CV Section -->
      <div class="section-header">AI-Tailored CV</div>
      <div class="toggle-group">
        <label class="toggle">
          <input type="checkbox" id="tailoredCVEnabled">
          <span class="toggle-slider"></span>
          <span class="toggle-label">Enable tailored CV per job</span>
        </label>
      </div>

      <div class="form-group" style="margin-top:12px">
        <label>Paste a job description to preview a CV:</label>
        <textarea id="githubJobDescPreview" rows="4"
          placeholder="Senior React Developer at Acme Corp…&#10;&#10;Requirements: 3+ years React experience…"
          style="resize:vertical; font-size:12px"></textarea>
      </div>
      <button id="githubPreviewCVBtn" class="btn btn-primary" style="width:100%">
        Generate &amp; Preview CV
      </button>
      <div id="githubLastCV" class="github-last-cv" style="margin-top:8px">
        <span class="github-muted">No CV generated yet</span>
      </div>

    </div><!-- /github-tab -->
```

- [ ] **Step 3: Add script tags for new files**

Find the script tags near the bottom of `popup.html` (lines 498-500):
```html
  <script src="vendor/pdf.min.js"></script>
  <script src="popup-improvements.js"></script>
  <script src="popup.js"></script>
```
Replace with:
```html
  <script src="vendor/pdf.min.js"></script>
  <script src="vendor/jspdf.umd.min.js"></script>
  <script src="cv-generator.js"></script>
  <script src="popup-improvements.js"></script>
  <script src="github-popup.js"></script>
  <script src="popup.js"></script>
```

- [ ] **Step 4: Verify HTML renders**

Reload extension. Open popup. A "GitHub" tab should appear. Clicking it shows the GitHub UI (unstyled for now). No JS errors in popup DevTools console (github-popup.js doesn't exist yet so there will be a script error — that's expected at this stage).

- [ ] **Step 5: Commit**

```bash
git add popup.html
git commit -m "feat: add GitHub tab markup to popup.html"
```

---

## Task 6: popup.css — GitHub Tab Styles

**Files:**
- Modify: `popup.css`

- [ ] **Step 1: Append GitHub styles to popup.css**

Open `popup.css`, scroll to the very end, and append:
```css
/* ═══════════════════════════════════════════════
   GITHUB INTEGRATION STYLES
═══════════════════════════════════════════════ */

/* PAT input row */
.pat-input-row {
  display: flex;
  gap: 6px;
  align-items: center;
}
.pat-input-row input {
  flex: 1;
  min-width: 0;
}

/* Small button variant */
.btn-sm {
  padding: 4px 10px;
  font-size: 12px;
  height: 30px;
  white-space: nowrap;
  flex-shrink: 0;
}
.btn-icon {
  background: none;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  cursor: pointer;
  padding: 4px 8px;
  font-size: 14px;
  line-height: 1;
  flex-shrink: 0;
}
.btn-icon:hover { background: #f3f4f6; }
.btn-link {
  background: none;
  border: none;
  color: #0a66c2;
  cursor: pointer;
  padding: 0;
  font-size: 12px;
  text-decoration: underline;
}
.btn-link:hover { color: #004182; }

/* Connection status badge */
.github-status {
  display: block;
  font-size: 12px;
  margin-top: 5px;
  font-weight: 500;
}
.github-status.connected    { color: #16a34a; }
.github-status.disconnected { color: #6b7280; }
.github-status.error        { color: #dc2626; }

/* Repo action buttons row */
.github-repo-actions {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}

/* Progress bar */
.github-progress {
  margin-bottom: 8px;
}
.github-progress-bar-track {
  height: 6px;
  background: #e5e7eb;
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: 4px;
}
.github-progress-bar {
  height: 100%;
  background: #0a66c2;
  border-radius: 3px;
  transition: width 0.3s ease;
}
.github-progress-text {
  font-size: 11px;
  color: #6b7280;
}

/* Repo list */
.github-repo-list {
  max-height: 180px;
  overflow-y: auto;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 4px;
  margin-bottom: 6px;
  background: #fafafa;
}
.github-repo-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 6px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  transition: background 0.15s;
}
.github-repo-item:hover { background: #f0f2f5; }
.github-repo-item.is-fork { opacity: 0.55; }
.github-repo-check { flex-shrink: 0; cursor: pointer; }
.github-repo-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.github-repo-name em { font-style: italic; color: #9ca3af; font-size: 11px; }
.github-repo-meta { display: flex; gap: 6px; align-items: center; flex-shrink: 0; }
.github-lang  { color: #6b7280; font-size: 11px; }
.github-stars { color: #f59e0b; font-size: 11px; }

/* Repo controls (select all / deselect all) */
.github-repo-controls {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-bottom: 10px;
}

/* Last CV row */
.github-last-cv {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #374151;
}
.github-last-cv button {
  background: none;
  border: 1px solid #d1d5db;
  border-radius: 5px;
  padding: 2px 8px;
  cursor: pointer;
  font-size: 12px;
}
.github-last-cv button:hover { background: #f3f4f6; }

/* Muted text */
.github-muted { font-size: 11px; color: #9ca3af; }

/* No repos message */
.github-no-repos {
  font-size: 12px;
  color: #9ca3af;
  text-align: center;
  padding: 12px;
}

/* Section headers within tabs */
.section-header {
  font-size: 12px;
  font-weight: 600;
  color: #374151;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 14px 0 8px;
  padding-bottom: 4px;
  border-bottom: 1px solid #e5e7eb;
}
```

- [ ] **Step 2: Verify styles render correctly**

Reload extension. Open popup → GitHub tab. Check:
- Status badge shows "○ Not connected" in gray
- "Fetch All Repos" and "Fetch Details ↓" buttons are disabled and styled correctly
- Repo list area has a bordered box with faint background
- Toggle switch uses existing toggle-slider style
- All text is readable, no overflow

- [ ] **Step 3: Commit**

```bash
git add popup.css
git commit -m "feat: add GitHub tab CSS styles"
```

---

## Task 7: github-popup.js — Full UI Logic

**Files:**
- Create: `github-popup.js`

- [ ] **Step 1: Create github-popup.js**

Create `github-popup.js` in the `AutoApplyMax/` root:
```javascript
// github-popup.js — GitHub tab UI logic
// Loaded in popup.html after cv-generator.js, before popup.js

'use strict';

// ─── Entry Point ─────────────────────────────────────────────────────────────
function initGitHubTab() {
  loadGitHubSettings();
  setupGitHubEventListeners();
}

// ─── Settings Load/Save ──────────────────────────────────────────────────────
async function loadGitHubSettings() {
  const [sync, local] = await Promise.all([
    chrome.storage.sync.get(['githubPAT', 'tailoredCVEnabled', 'githubPinnedRepos']),
    chrome.storage.local.get(['githubUsername', 'githubConnectionStatus', 'githubAllRepos',
                              'githubRepos', 'githubReposFetchedAt', 'lastTailoredCVName'])
  ]);

  // PAT field
  const patInput = document.getElementById('githubPAT');
  if (patInput && sync.githubPAT) patInput.value = sync.githubPAT;

  // Tailored CV toggle
  const toggle = document.getElementById('tailoredCVEnabled');
  if (toggle) toggle.checked = !!sync.tailoredCVEnabled;

  // Connection status
  updateConnectionStatus(local.githubConnectionStatus || 'disconnected', local.githubUsername || '');

  // Enable Fetch Repos if we have a token
  if (sync.githubPAT) {
    const fetchReposBtn = document.getElementById('githubFetchReposBtn');
    if (fetchReposBtn) fetchReposBtn.disabled = false;
  }

  // Repo list (if already fetched)
  if (local.githubAllRepos && local.githubAllRepos.length > 0) {
    renderRepoList(local.githubAllRepos, sync.githubPinnedRepos || []);
    document.getElementById('githubFetchDetailsBtn').disabled = false;
    document.getElementById('githubRepoControls').style.display = 'flex';
    updateDetailsStatus(local.githubRepos, local.githubReposFetchedAt);
  }

  // Last CV link
  updateLastCVLink(local.lastTailoredCVName || '');
}

async function saveGitHubSettings() {
  const pat     = document.getElementById('githubPAT')?.value || '';
  const enabled = document.getElementById('tailoredCVEnabled')?.checked || false;
  const pinned  = getPinnedRepos();
  await chrome.storage.sync.set({ githubPAT: pat, tailoredCVEnabled: enabled, githubPinnedRepos: pinned });
}

// ─── Event Listeners ─────────────────────────────────────────────────────────
function setupGitHubEventListeners() {
  // PAT visibility toggle
  document.getElementById('githubPATToggle')?.addEventListener('click', () => {
    const inp = document.getElementById('githubPAT');
    const btn = document.getElementById('githubPATToggle');
    if (!inp) return;
    inp.type = inp.type === 'password' ? 'text' : 'password';
    btn.textContent = inp.type === 'password' ? '👁' : '🙈';
  });

  // Auto-save PAT on blur
  document.getElementById('githubPAT')?.addEventListener('change', saveGitHubSettings);

  document.getElementById('githubTestBtn')?.addEventListener('click', testGitHubConnection);
  document.getElementById('githubFetchReposBtn')?.addEventListener('click', fetchAllRepos);
  document.getElementById('githubFetchDetailsBtn')?.addEventListener('click', fetchSelectedDetails);
  document.getElementById('githubSelectAll')?.addEventListener('click', () => { setAllRepoChecks(true); saveGitHubSettings(); });
  document.getElementById('githubDeselectAll')?.addEventListener('click', () => { setAllRepoChecks(false); saveGitHubSettings(); });
  document.getElementById('tailoredCVEnabled')?.addEventListener('change', saveGitHubSettings);
  document.getElementById('githubPreviewCVBtn')?.addEventListener('click', generatePreviewCV);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function getPinnedRepos() {
  return Array.from(document.querySelectorAll('.github-repo-check:checked'))
              .map(cb => cb.dataset.fullName);
}

function setAllRepoChecks(checked) {
  document.querySelectorAll('.github-repo-check').forEach(cb => { cb.checked = checked; });
}

function updateConnectionStatus(status, username) {
  const el = document.getElementById('githubConnectionStatus');
  if (!el) return;
  const map = {
    connected:    ['connected',    `● Connected: ${username}`],
    error:        ['error',        '✗ Connection error — check your PAT'],
    disconnected: ['disconnected', '○ Not connected']
  };
  const [cls, text] = map[status] || map.disconnected;
  el.className = `github-status ${cls}`;
  el.textContent = text;
}

function updateDetailsStatus(githubRepos, fetchedAt) {
  const el = document.getElementById('githubDetailsStatus');
  if (!el) return;
  if (githubRepos && githubRepos.length > 0 && fetchedAt) {
    const mins = Math.round((Date.now() - fetchedAt) / 60000);
    el.textContent = `${githubRepos.length} enriched · ${mins < 1 ? 'just now' : mins + 'm ago'}`;
  }
}

function updateLastCVLink(fileName) {
  const el = document.getElementById('githubLastCV');
  if (!el) return;
  if (fileName) {
    el.innerHTML = `<span>${fileName}</span><button id="githubDownloadLastCV">↓ Download</button>`;
    document.getElementById('githubDownloadLastCV')?.addEventListener('click', downloadLastCV);
  } else {
    el.innerHTML = '<span class="github-muted">No CV generated yet</span>';
  }
}

// ─── Test Connection ──────────────────────────────────────────────────────────
async function testGitHubConnection() {
  const pat = document.getElementById('githubPAT')?.value?.trim();
  const statusEl = document.getElementById('githubConnectionStatus');
  if (!pat) {
    statusEl.className = 'github-status error';
    statusEl.textContent = '✗ Enter a Personal Access Token first';
    return;
  }
  const testBtn = document.getElementById('githubTestBtn');
  testBtn.disabled = true;
  testBtn.textContent = '…';
  try {
    const resp = await chrome.runtime.sendMessage({ action: 'githubTestConnection', pat });
    if (resp.ok) {
      await chrome.storage.local.set({ githubUsername: resp.username, githubConnectionStatus: 'connected' });
      await chrome.storage.sync.set({ githubPAT: pat });
      updateConnectionStatus('connected', resp.username);
      document.getElementById('githubFetchReposBtn').disabled = false;
      if (typeof showToast === 'function') showToast(`Connected as ${resp.username}`, 'success');
    } else {
      await chrome.storage.local.set({ githubConnectionStatus: 'error' });
      updateConnectionStatus('error', '');
      document.getElementById('githubConnectionStatus').textContent = `✗ ${resp.error}`;
    }
  } catch (err) {
    updateConnectionStatus('error', '');
  } finally {
    testBtn.disabled = false;
    testBtn.textContent = 'Test';
  }
}

// ─── Fetch All Repos ──────────────────────────────────────────────────────────
async function fetchAllRepos() {
  const pat = document.getElementById('githubPAT')?.value?.trim();
  if (!pat) return;
  const btn = document.getElementById('githubFetchReposBtn');
  btn.disabled = true;
  btn.textContent = 'Fetching…';
  try {
    const resp = await chrome.runtime.sendMessage({ action: 'githubFetchUserRepos', pat });
    if (resp.ok) {
      await chrome.storage.local.set({ githubAllRepos: resp.repos });

      // Default pinned = all non-forks (if user hasn't pinned anything yet)
      const syncData = await chrome.storage.sync.get(['githubPinnedRepos']);
      let pinned = syncData.githubPinnedRepos || [];
      if (pinned.length === 0) {
        pinned = resp.repos.filter(r => !r.isFork).map(r => r.fullName);
        await chrome.storage.sync.set({ githubPinnedRepos: pinned });
      }

      renderRepoList(resp.repos, pinned);
      document.getElementById('githubFetchDetailsBtn').disabled = false;
      document.getElementById('githubRepoControls').style.display = 'flex';
      if (typeof showToast === 'function') showToast(`${resp.repos.length} repos loaded`, 'success');
    } else {
      if (typeof showToast === 'function') showToast(`GitHub error: ${resp.error}`, 'error');
    }
  } catch (err) {
    if (typeof showToast === 'function') showToast('Failed to fetch repos', 'error');
    console.error('fetchAllRepos error:', err);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Fetch All Repos';
  }
}

// ─── Render Repo List ─────────────────────────────────────────────────────────
function renderRepoList(repos, pinnedRepos) {
  const container = document.getElementById('githubRepoList');
  if (!container) return;
  if (!repos || repos.length === 0) {
    container.innerHTML = '<div class="github-no-repos">No repositories found.</div>';
    return;
  }
  container.innerHTML = repos.map(r => `
    <label class="github-repo-item${r.isFork ? ' is-fork' : ''}">
      <input type="checkbox"
             class="github-repo-check"
             data-full-name="${escapeAttr(r.fullName)}"
             ${pinnedRepos.includes(r.fullName) ? 'checked' : ''}>
      <span class="github-repo-name">${escapeHtml(r.name)}${r.isFork ? ' <em>(fork)</em>' : ''}</span>
      <span class="github-repo-meta">
        ${r.language ? `<span class="github-lang">${escapeHtml(r.language)}</span>` : ''}
        <span class="github-stars">★ ${r.stars || 0}</span>
      </span>
    </label>
  `).join('');

  container.querySelectorAll('.github-repo-check').forEach(cb => {
    cb.addEventListener('change', saveGitHubSettings);
  });
}

function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function escapeAttr(str) {
  return String(str).replace(/"/g, '&quot;');
}

// ─── Fetch Details for Selected Repos ────────────────────────────────────────
async function fetchSelectedDetails() {
  const pat = document.getElementById('githubPAT')?.value?.trim();
  if (!pat) return;
  const pinned = getPinnedRepos();
  if (pinned.length === 0) {
    if (typeof showToast === 'function') showToast('Select at least one repo first', 'warning');
    return;
  }

  const btn         = document.getElementById('githubFetchDetailsBtn');
  const progressCtr = document.getElementById('githubProgressContainer');
  const progressBar = document.getElementById('githubProgressBar');
  const progressTxt = document.getElementById('githubProgressText');

  btn.disabled = true;
  progressCtr.style.display = 'block';

  const localData  = await chrome.storage.local.get(['githubAllRepos']);
  const allRepos   = localData.githubAllRepos || [];
  const enriched   = [];

  for (let i = 0; i < pinned.length; i++) {
    const fullName = pinned[i];
    const pct = Math.round(((i + 1) / pinned.length) * 100);
    if (progressTxt) progressTxt.textContent = `Fetching ${i + 1} of ${pinned.length} repos…`;
    if (progressBar) progressBar.style.width = `${pct}%`;

    try {
      const basicRepo = allRepos.find(r => r.fullName === fullName) || { fullName };
      const resp = await chrome.runtime.sendMessage({ action: 'githubFetchRepoDetails', pat, fullName });
      if (resp.ok) {
        enriched.push({ ...basicRepo, ...resp.details, fullName });
      } else {
        enriched.push({ ...basicRepo, fullName }); // include with basic info only
      }
    } catch (err) {
      console.warn('fetchSelectedDetails: error for', fullName, err);
    }
  }

  await chrome.storage.local.set({ githubRepos: enriched, githubReposFetchedAt: Date.now() });
  if (progressTxt) progressTxt.textContent = `${enriched.length} repos enriched ✓`;
  if (progressBar) progressBar.style.width = '100%';
  btn.disabled = false;
  updateDetailsStatus(enriched, Date.now());
  if (typeof showToast === 'function') showToast(`Enriched ${enriched.length} repos`, 'success');
}

// ─── Download Last CV ─────────────────────────────────────────────────────────
async function downloadLastCV() {
  const local = await chrome.storage.local.get(['lastTailoredCVName', 'lastTailoredCVData']);
  if (!local.lastTailoredCVData) {
    if (typeof showToast === 'function') showToast('No CV data found', 'error');
    return;
  }
  openBase64PDF(local.lastTailoredCVData, local.lastTailoredCVName || 'Tailored_CV.pdf');
}

function openBase64PDF(base64, fileName) {
  const byteChars = atob(base64);
  const bytes = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}

// ─── Generate & Preview CV ────────────────────────────────────────────────────
async function generatePreviewCV() {
  const jobDesc = document.getElementById('githubJobDescPreview')?.value?.trim();
  if (!jobDesc) {
    if (typeof showToast === 'function') showToast('Paste a job description first', 'warning');
    return;
  }

  const previewBtn = document.getElementById('githubPreviewCVBtn');
  previewBtn.disabled = true;
  previewBtn.textContent = 'Generating…';

  try {
    const [sync, local] = await Promise.all([
      chrome.storage.sync.get(['firstName', 'lastName', 'email', 'phone', 'phoneCountryCode', 'city', 'yearsOfExperience']),
      chrome.storage.local.get(['githubRepos'])
    ]);

    const profile = {
      firstName: sync.firstName || '',
      lastName:  sync.lastName  || '',
      email:     sync.email     || '',
      phone:     ((sync.phoneCountryCode || '') + ' ' + (sync.phone || '')).trim(),
      city:      sync.city      || '',
      yearsOfExperience: sync.yearsOfExperience || ''
    };

    const resp = await chrome.runtime.sendMessage({
      action:        'generateTailoredCV',
      jobDesc,
      githubProjects: local.githubRepos || [],
      profile
    });
    if (!resp.ok) throw new Error(resp.error || 'LLM error');

    const base64  = window.AutoApplyMax.cvToBase64(resp.cvJson, profile);
    const cvName  = `${profile.firstName}_${profile.lastName}_Tailored_CV.pdf`.replace(/\s+/g, '_');

    await chrome.storage.local.set({ lastTailoredCVName: cvName, lastTailoredCVData: base64 });
    updateLastCVLink(cvName);

    // Open preview in new tab
    const byteChars = atob(base64);
    const bytes = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url  = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 30000);

    if (typeof showToast === 'function') showToast('CV generated — opened in new tab', 'success');
  } catch (err) {
    if (typeof showToast === 'function') showToast(`CV failed: ${err.message}`, 'error');
    console.error('generatePreviewCV error:', err);
  } finally {
    previewBtn.disabled = false;
    previewBtn.textContent = 'Generate & Preview CV';
  }
}
```

- [ ] **Step 2: Verify GitHub tab is fully functional**

Reload extension. Open popup → GitHub tab:
1. Enter a valid GitHub PAT → click "Test" → badge shows "● Connected: username"
2. Click "Fetch All Repos" → repo checklist appears with checkboxes
3. Check a few repos → click "Fetch Details ↓" → progress bar advances → "N repos enriched ✓"
4. Paste a job description → click "Generate & Preview CV" → PDF opens in new tab
5. "No CV generated yet" changes to the CV filename with a download button

- [ ] **Step 3: Commit**

```bash
git add github-popup.js
git commit -m "feat: add github-popup.js UI logic for GitHub tab"
```

---

## Task 8: popup.js — Wire Up Injection + initGitHubTab

**Files:**
- Modify: `popup.js`

- [ ] **Step 1: Update executeScript to inject jsPDF and cv-generator.js**

Find (around line 307-310):
```javascript
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content-simple.js']
    });
```
Replace with:
```javascript
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['vendor/jspdf.umd.min.js', 'cv-generator.js', 'content-simple.js']
    });
```

- [ ] **Step 2: Call initGitHubTab() on DOMContentLoaded**

Find (around line 48-52):
```javascript
document.addEventListener('DOMContentLoaded', async () => {
  await loadConfig();
  await updateStatus();
  await loadRunningState(); // Load current running state
  setupTabs();
```
Replace with:
```javascript
document.addEventListener('DOMContentLoaded', async () => {
  await loadConfig();
  await updateStatus();
  await loadRunningState(); // Load current running state
  setupTabs();
  initGitHubTab(); // GitHub tab (defined in github-popup.js)
```

- [ ] **Step 3: Verify Start still works**

Reload extension. Navigate to LinkedIn with Easy Apply jobs. Click Start in the popup.  
Open the browser console on the LinkedIn tab and confirm:
```
[LinkedIn Bot] 📄 Resume loaded: ...    (or "No resume uploaded")
[LinkedIn Bot] Config: ...
```
No errors about `jsPDF` or `AutoApplyMax`. The automation should proceed exactly as before.

- [ ] **Step 4: Commit**

```bash
git add popup.js
git commit -m "feat: inject jsPDF+cv-generator alongside content-simple.js, wire initGitHubTab"
```

---

## Task 9: content-simple.js — GitHub Settings Loading + Helpers

**Files:**
- Modify: `content-simple.js`

- [ ] **Step 1: Add module-level variables for GitHub/CV state**

Find (around line 18-21):
```javascript
// Resume/CV data for automatic upload
let resumeFile = null; // Base64 data
let resumeFileName = null;
let resumeFileType = null;
```
Replace with:
```javascript
// Resume/CV data for automatic upload
let resumeFile = null; // Base64 data
let resumeFileName = null;
let resumeFileType = null;

// GitHub-powered tailored CV
let tailoredCVEnabled = false;
let githubRepos = []; // Enriched repo objects from local storage
```

- [ ] **Step 2: Load GitHub settings alongside the existing resume loading**

Find (around line 2819-2827):
```javascript
        // Load resume data if available
        resumeFile = local.resumeFile || null;
        resumeFileName = local.resumeFileName || null;
        resumeFileType = local.resumeFileType || null;

        if (resumeFile) {
          log(`📄 Resume loaded: ${resumeFileName}`);
        } else {
          log('ℹ️ No resume uploaded - file upload fields will be skipped');
        }
```
Replace with:
```javascript
        // Load resume data if available
        resumeFile = local.resumeFile || null;
        resumeFileName = local.resumeFileName || null;
        resumeFileType = local.resumeFileType || null;

        if (resumeFile) {
          log(`📄 Resume loaded: ${resumeFileName}`);
        } else {
          log('ℹ️ No resume uploaded - file upload fields will be skipped');
        }

        // Load GitHub tailored CV settings
        const githubSync  = await chrome.storage.sync.get(['tailoredCVEnabled']);
        const githubLocal = await chrome.storage.local.get(['githubRepos']);
        tailoredCVEnabled = !!githubSync.tailoredCVEnabled;
        githubRepos       = githubLocal.githubRepos || [];
        if (tailoredCVEnabled) {
          log(`🎯 Tailored CV enabled — ${githubRepos.length} enriched repos loaded`);
        }
```

- [ ] **Step 3: Add extractJobDescription() and extractCompanyName() helper functions**

Find the `base64ToFile` function (search for `function base64ToFile`). Add the two new helpers BEFORE it:

```javascript
// Extract job description text from LinkedIn job detail panel
function extractJobDescription() {
  const selectors = [
    '.jobs-description__content',
    '.jobs-box__html-content',
    '.jobs-description-content__text',
    '.job-details-about-the-job-module__description',
    '[data-job-id] .description__text',
    'article.jobs-description',
    '.job-view-layout .jobs-description'
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && el.innerText && el.innerText.trim().length > 50) {
      return el.innerText.trim().substring(0, 4000);
    }
  }
  return '';
}

// Extract company name from LinkedIn job card header
function extractCompanyName() {
  const selectors = [
    '.jobs-unified-top-card__company-name',
    '.job-details-jobs-unified-top-card__company-name',
    '.topcard__org-name-link',
    '[data-test-id="job-details-company-name"]',
    '.jobs-top-card__company-name'
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && el.innerText.trim()) return el.innerText.trim();
  }
  return 'Company';
}
```

- [ ] **Step 4: Reload extension and verify no regressions**

Reload the extension and the LinkedIn tab. Click Start. Confirm in console:
- Bot starts normally
- `🎯 Tailored CV enabled — N enriched repos loaded` appears (if tailoredCVEnabled is true)
- OR tailored CV message is absent (if feature is off) — both correct

No exceptions from the new variables. Automation continues through jobs as before.

- [ ] **Step 5: Commit**

```bash
git add content-simple.js
git commit -m "feat: load GitHub CV settings and add job/company extractors to content-simple.js"
```

---

## Task 10: content-simple.js — tryUploadTailoredCV Integration

**Files:**
- Modify: `content-simple.js`

- [ ] **Step 1: Add tryUploadTailoredCV() function**

Find the `extractCompanyName` function you added in Task 9. Add `tryUploadTailoredCV` AFTER it:

```javascript
// Attempt to generate and upload a tailored CV for the current job.
// Returns true if a tailored CV was successfully uploaded, false on any failure
// (caller falls through to static resume upload).
async function tryUploadTailoredCV(fileInput) {
  try {
    // Guard: require AutoApplyMax namespace (injected before this script)
    if (!window.AutoApplyMax || typeof window.AutoApplyMax.cvToBase64 !== 'function') {
      log('⚠️ Tailored CV: AutoApplyMax not loaded, falling back to static resume');
      return false;
    }

    const jobDesc = extractJobDescription();
    if (!jobDesc) {
      log('ℹ️ Tailored CV: no job description found — using static resume');
      return false;
    }

    const companyName = extractCompanyName();
    const hashKey     = window.AutoApplyMax.hashJobDesc(jobDesc);

    // Check cache
    const cached = await chrome.storage.local.get([hashKey]);
    let base64PDF, cvFileName;

    if (cached[hashKey] && cached[hashKey].pdf) {
      log(`📋 Tailored CV: cache hit for ${hashKey.substring(0, 12)}…`);
      base64PDF = cached[hashKey].pdf;
      cvFileName = cached[hashKey].name;
    } else {
      log('🤖 Tailored CV: generating via LLM…');
      const syncData = await chrome.storage.sync.get([
        'firstName', 'lastName', 'email', 'phone', 'phoneCountryCode', 'city', 'yearsOfExperience'
      ]);
      const profile = {
        firstName: syncData.firstName || '',
        lastName:  syncData.lastName  || '',
        email:     syncData.email     || '',
        phone:     ((syncData.phoneCountryCode || '') + ' ' + (syncData.phone || '')).trim(),
        city:      syncData.city      || '',
        yearsOfExperience: syncData.yearsOfExperience || ''
      };

      const resp = await chrome.runtime.sendMessage({
        action:         'generateTailoredCV',
        jobDesc,
        githubProjects: githubRepos,
        profile
      });

      if (!resp || !resp.ok) {
        log(`⚠️ Tailored CV: LLM failed (${resp?.error || 'no response'}) — using static resume`);
        return false;
      }

      base64PDF = window.AutoApplyMax.cvToBase64(resp.cvJson, profile);
      const safeName = companyName.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30);
      cvFileName = `${profile.firstName}_${profile.lastName}_CV_${safeName}.pdf`.replace(/_{2,}/g, '_');

      // Evict oldest CV from cache if over 20 entries
      const allLocal = await chrome.storage.local.get(null);
      const cvKeys   = Object.keys(allLocal).filter(k => k.startsWith('cv_'));
      if (cvKeys.length >= 20) {
        const oldestKey = cvKeys.sort((a, b) => ((allLocal[a] && allLocal[a].ts) || 0) - ((allLocal[b] && allLocal[b].ts) || 0))[0];
        await chrome.storage.local.remove(oldestKey);
      }

      await chrome.storage.local.set({
        [hashKey]:          { pdf: base64PDF, name: cvFileName, ts: Date.now() },
        lastTailoredCVName: cvFileName,
        lastTailoredCVData: base64PDF
      });
      log(`✅ Tailored CV generated: ${cvFileName}`);
    }

    // Build File object and upload using existing fillFileInput()
    const byteChars = atob(base64PDF);
    const bytes     = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
    const file = new File([bytes], cvFileName, { type: 'application/pdf' });

    const success = await fillFileInput(fileInput, file);
    if (success) {
      log(`📎 Tailored CV uploaded: ${cvFileName}`);
      return true;
    }
    log('⚠️ Tailored CV: fillFileInput failed — using static resume');
    return false;
  } catch (err) {
    log(`⚠️ Tailored CV error: ${err.message} — falling back to static resume`);
    console.error('[LinkedIn Bot] tryUploadTailoredCV:', err);
    return false;
  }
}
```

- [ ] **Step 2: Add tailored CV branch in the resume upload block**

Find (around line 1632):
```javascript
          // STEP 2b: If no existing resume found/selected, upload new one (only once per session)
          if (!resumeAlreadySelected && resumeFile && resumeFileName && resumeFileType) {
```
Insert the tailored CV branch BEFORE that line:

```javascript
          // STEP 2b-i: Tailored CV upload (if feature enabled, runs before static resume fallback)
          if (!resumeAlreadySelected && tailoredCVEnabled && githubRepos.length > 0) {
            const fileInputs = modal.querySelectorAll('input[type="file"]');
            for (const fileInput of fileInputs) {
              if (fileInput.files && fileInput.files.length > 0) continue;
              // Check if this is a resume/CV input (same label check as static resume)
              let labelText = ' ' + (fileInput.getAttribute('aria-label') || '')
                            + ' ' + (fileInput.getAttribute('name') || '');
              const inputId = fileInput.getAttribute('id');
              if (inputId) {
                const labelEl = modal.querySelector(`label[for="${inputId}"]`);
                if (labelEl) labelText += ' ' + labelEl.textContent;
              }
              const parentLabel = fileInput.closest('label');
              if (parentLabel) labelText += ' ' + parentLabel.textContent;
              if (labelText.toLowerCase().match(/resume|cv|curriculum|vitae|upload.*document|file/)) {
                const uploaded = await tryUploadTailoredCV(fileInput);
                if (uploaded) {
                  resumeAlreadySelected = true;
                  break;
                }
                // Fall through: static resume upload below will run
              }
            }
          }

          // STEP 2b: If no existing resume found/selected, upload new one (only once per session)
          if (!resumeAlreadySelected && resumeFile && resumeFileName && resumeFileType) {
```

- [ ] **Step 3: End-to-end test with tailored CV OFF**

Reload extension. Make sure tailoredCVEnabled toggle is OFF in the GitHub tab.  
Navigate to a LinkedIn Easy Apply job. Click Start.  
Expected console output: No `🎯 Tailored CV` or `🤖 Tailored CV` messages. Bot applies normally with static resume (or skips file upload if no resume set).

- [ ] **Step 4: End-to-end test with tailored CV ON**

In popup GitHub tab:
1. Connect GitHub + fetch repos + fetch details for at least 1 repo
2. Enable "Enable tailored CV per job" toggle

Navigate to an Easy Apply job. Click Start.  
Expected console output:
```
[LinkedIn Bot] 🎯 Tailored CV enabled — N enriched repos loaded
...
[LinkedIn Bot] 🤖 Tailored CV: generating via LLM…
[LinkedIn Bot] ✅ Tailored CV generated: FirstName_LastName_CV_CompanyName.pdf
[LinkedIn Bot] 📎 Tailored CV uploaded: FirstName_LastName_CV_CompanyName.pdf
```

Second job should show:
```
[LinkedIn Bot] 📋 Tailored CV: cache hit for cv_xxxxxxxx…
[LinkedIn Bot] 📎 Tailored CV uploaded: ...
```

- [ ] **Step 5: Regression test — existing features unchanged**

Verify these continue to work exactly as before:
- [ ] Cooldown system: manually trigger rate limit scenario (or wait for daily limit), confirm `Cooldown (1/3)` appears in popup status
- [ ] LLM question answering: on a job with custom questions, confirm AI answers appear in form fields
- [ ] Applied Jobs tab: confirm applied jobs are tracked and CSV export works
- [ ] Stop button: confirm automation stops immediately
- [ ] Error handling: disable tailored CV, restart — static resume uploads correctly

- [ ] **Step 6: Commit**

```bash
git add content-simple.js
git commit -m "feat: integrate tryUploadTailoredCV into Easy Apply resume upload flow"
```

---

## Task 11: CLAUDE.md Update + Final Commit

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update CLAUDE.md with new architecture details**

Open `CLAUDE.md`. Append after the existing content:

```markdown

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
```

- [ ] **Step 2: Final commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with GitHub tailored CV architecture"
```

- [ ] **Step 3: Tag the release**

```bash
git tag v1.7.0 -m "v1.7.0 — GitHub-powered tailored CV generation"
```

---

## Acceptance Checklist

- [ ] User can enter a GitHub PAT → see "● Connected: username"
- [ ] User can fetch repos → see scrollable checklist with checkboxes
- [ ] User can fetch details for selected repos → progress bar works
- [ ] "Enable tailored CV per job" toggle saves and persists across popup reopen
- [ ] "Generate & Preview CV" button opens a valid PDF in a new tab
- [ ] Download button on last CV downloads the PDF
- [ ] During automation with feature ON: tailored CV is generated and uploaded to LinkedIn
- [ ] Second application to same-company job: uses cached CV (console shows "cache hit")
- [ ] With feature OFF: static resume upload works unchanged
- [ ] Any failure in CV generation → bot falls back to static resume, automation continues
- [ ] Cooldown system, LLM question answering, CSV export all work as before
