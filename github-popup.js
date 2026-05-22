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
