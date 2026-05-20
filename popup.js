// Popup script for UI management
let isRunning = false;

// Load running state from storage
async function loadRunningState() {
  const local = await chrome.storage.local.get(['isRunning']);
  isRunning = local.isRunning || false;
  updateButtons();
  updateStatusDisplay(isRunning ? 'Running' : 'Stopped', isRunning);
}

// Load config on startup
document.addEventListener('DOMContentLoaded', async () => {
  await loadConfig();
  await updateStatus();
  await loadRunningState(); // Load current running state
  setupTabs();
  setupResumeUpload();
  setupValidation(); // Setup field validation
  checkOnboarding(); // Check if first time user
});

// Setup tabs
function setupTabs() {
  const tabs = document.querySelectorAll('.tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      // Remove active from all
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));

      // Add active to clicked
      tab.classList.add('active');
      const tabName = tab.getAttribute('data-tab');
      document.getElementById(`${tabName}-tab`).classList.add('active');

      // Load applied jobs when tab is opened
      if (tabName === 'applied') {
        loadAppliedJobs();
      }
    });
  });
}

// Load saved configuration
async function loadConfig() {
  const config = await chrome.storage.sync.get([
    'firstName', 'lastName', 'email', 'phone', 'phoneCountryCode', 'city',
    'yearsOfExperience', 'maxYearsRequired', 'blacklistKeywords', 'autoNextPage', 'expectedSalary',
    'visaSponsorship', 'legallyAuthorized', 'willingToRelocate', 'driversLicense',
    'whitelistKeywords', 'searchKeywords', 'searchLocation', 'autoSearchOnStart',
    'aiEnabled', 'openrouterApiKey', 'openrouterModel'
  ]);

  // Load from local storage for larger data (resume + extracted text)
  const local = await chrome.storage.local.get(['resumeFile', 'resumeFileName', 'resumeText']);

  document.getElementById('firstName').value = config.firstName || '';
  document.getElementById('lastName').value = config.lastName || '';
  document.getElementById('email').value = config.email || '';
  document.getElementById('phoneCountryCode').value = config.phoneCountryCode || '+1';
  document.getElementById('phone').value = config.phone || '';
  document.getElementById('city').value = config.city || '';
  document.getElementById('yearsOfExperience').value = config.yearsOfExperience || '2';
  document.getElementById('maxYearsRequired').value = config.maxYearsRequired || '3';
  document.getElementById('expectedSalary').value = config.expectedSalary || '';
  document.getElementById('blacklistKeywords').value = config.blacklistKeywords || '';
  document.getElementById('autoNextPage').checked = config.autoNextPage !== false;

  // Job targeting fields
  document.getElementById('whitelistKeywords').value = config.whitelistKeywords || '';
  document.getElementById('searchKeywords').value = config.searchKeywords || '';
  document.getElementById('searchLocation').value = config.searchLocation || '';
  document.getElementById('autoSearchOnStart').checked = config.autoSearchOnStart !== false;

  // AI fields
  document.getElementById('aiEnabled').checked = !!config.aiEnabled;
  document.getElementById('openrouterApiKey').value = config.openrouterApiKey || '';
  document.getElementById('openrouterModel').value = config.openrouterModel || 'openai/gpt-4o-mini';
  document.getElementById('resumeText').value = local.resumeText || '';
  const statusEl = document.getElementById('resumeTextStatus');
  if (local.resumeText) {
    statusEl.textContent = `✓ ${local.resumeText.length} chars parsed`;
    statusEl.style.color = '#059669';
  }

  // Load common questions (with smart defaults)
  document.getElementById('visaSponsorship').value = config.visaSponsorship || 'no';
  document.getElementById('legallyAuthorized').value = config.legallyAuthorized || 'yes';
  document.getElementById('willingToRelocate').value = config.willingToRelocate || 'yes';
  document.getElementById('driversLicense').value = config.driversLicense || 'yes';

  // Load resume if exists
  if (local.resumeFileName) {
    document.getElementById('resumeFileName').textContent = local.resumeFileName;
    document.getElementById('resumeFileName').classList.add('has-file');
    document.getElementById('removeResumeBtn').style.display = 'inline-flex';
  }

  // Setup auto-save on all fields
  setupAutoSave();
  setupResumeUpload();
}

// Auto-save indicator
let saveTimeout;
function showAutoSaveIndicator(saving = false) {
  const indicator = document.getElementById('autosave-indicator');
  indicator.classList.remove('show', 'saving');

  if (saving) {
    indicator.classList.add('saving', 'show');
    indicator.querySelector('span').textContent = 'Saving...';
  } else {
    indicator.classList.add('show');
    indicator.querySelector('span').textContent = 'Saved';
    setTimeout(() => {
      indicator.classList.remove('show');
    }, 2000);
  }
}

// Auto-save configuration
async function saveConfig() {
  const config = {
    firstName: document.getElementById('firstName').value,
    lastName: document.getElementById('lastName').value,
    email: document.getElementById('email').value,
    phoneCountryCode: document.getElementById('phoneCountryCode').value,
    phone: document.getElementById('phone').value,
    city: document.getElementById('city').value,
    yearsOfExperience: document.getElementById('yearsOfExperience').value,
    maxYearsRequired: document.getElementById('maxYearsRequired').value,
    expectedSalary: document.getElementById('expectedSalary').value,
    blacklistKeywords: document.getElementById('blacklistKeywords').value,
    autoNextPage: document.getElementById('autoNextPage').checked,
    visaSponsorship: document.getElementById('visaSponsorship').value,
    legallyAuthorized: document.getElementById('legallyAuthorized').value,
    willingToRelocate: document.getElementById('willingToRelocate').value,
    driversLicense: document.getElementById('driversLicense').value,
    whitelistKeywords: document.getElementById('whitelistKeywords').value,
    searchKeywords: document.getElementById('searchKeywords').value,
    searchLocation: document.getElementById('searchLocation').value,
    autoSearchOnStart: document.getElementById('autoSearchOnStart').checked,
    aiEnabled: document.getElementById('aiEnabled').checked,
    openrouterApiKey: document.getElementById('openrouterApiKey').value,
    openrouterModel: document.getElementById('openrouterModel').value
  };

  showAutoSaveIndicator(true);
  await chrome.storage.sync.set(config);
  // resumeText goes to local storage (can be larger than sync's 8KB-per-item limit)
  const resumeTextVal = document.getElementById('resumeText').value;
  await chrome.storage.local.set({ resumeText: resumeTextVal });
  showAutoSaveIndicator(false);
}

// Setup auto-save on all form fields
function setupAutoSave() {
  const inputFields = [
    'firstName', 'lastName', 'email', 'phone', 'phoneCountryCode',
    'city', 'yearsOfExperience', 'maxYearsRequired', 'expectedSalary', 'blacklistKeywords',
    'visaSponsorship', 'legallyAuthorized', 'willingToRelocate', 'driversLicense',
    'whitelistKeywords', 'searchKeywords', 'searchLocation',
    'openrouterApiKey', 'openrouterModel', 'resumeText'
  ];

  inputFields.forEach(fieldId => {
    const field = document.getElementById(fieldId);
    if (field) {
      field.addEventListener('input', () => {
        // Debounce: wait 500ms after user stops typing
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
          saveConfig();
        }, 500);
      });
    }
  });

  // For checkboxes, save immediately
  ['autoNextPage', 'autoSearchOnStart', 'aiEnabled'].forEach(id => {
    const cb = document.getElementById(id);
    if (cb) {
      cb.addEventListener('change', () => {
        saveConfig();
      });
    }
  });
}

// Build LinkedIn Easy Apply search URL from user keywords + location
function buildLinkedInSearchUrl(keywords, location) {
  const base = 'https://www.linkedin.com/jobs/search/';
  const params = new URLSearchParams();
  if (keywords && keywords.trim()) params.set('keywords', keywords.trim());
  if (location && location.trim()) params.set('location', location.trim());
  params.set('f_AL', 'true'); // Easy Apply filter ON
  params.set('sortBy', 'DD');  // Date Descending = newest first
  return `${base}?${params.toString()}`;
}

// Wait for a tab to finish loading after a navigation
function waitForTabComplete(tabId, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(true);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    // Hard timeout safety net
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(Date.now() - startedAt >= timeoutMs ? false : true);
    }, timeoutMs);
  });
}

// Start automation
document.getElementById('start-btn').addEventListener('click', async () => {
  try {
    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // Validate fields before starting
    if (!validateAllFields()) {
      showToast('Please fix the errors in your personal information before starting', 'error');
      return;
    }

    // Read auto-search config
    const cfg = await chrome.storage.sync.get(['autoSearchOnStart', 'searchKeywords', 'searchLocation']);
    const autoSearch = cfg.autoSearchOnStart !== false;
    const hasSearchTerms = (cfg.searchKeywords && cfg.searchKeywords.trim()) ||
                           (cfg.searchLocation && cfg.searchLocation.trim());

    // Decide whether to navigate. Trigger nav if:
    //   - autoSearch is on AND user has search terms, AND
    //   - either not on LinkedIn at all, not on a /jobs/ page, or not on /jobs/search/
    const onLinkedIn = tab.url && tab.url.includes('linkedin.com');
    const onJobsSearch = onLinkedIn && tab.url.includes('/jobs/search/');
    const shouldNavigate = autoSearch && hasSearchTerms && !onJobsSearch;

    if (shouldNavigate) {
      const url = buildLinkedInSearchUrl(cfg.searchKeywords, cfg.searchLocation);
      console.log('🔎 Auto-navigating to LinkedIn search:', url);
      showToast('Navigating to LinkedIn search...', 'info', 3000);
      await chrome.tabs.update(tab.id, { url });
      await waitForTabComplete(tab.id);
      // Give LinkedIn SPA a moment to render results
      await new Promise(r => setTimeout(r, 1500));
      // Re-fetch tab info now that URL changed
      [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    } else {
      // Manual mode: must already be on a LinkedIn /jobs/ page
      if (!onLinkedIn) {
        showToast('Please open a LinkedIn jobs page first, OR set Auto-Search Keywords in Settings.', 'warning', 6000);
        return;
      }
      if (!tab.url.includes('/jobs/')) {
        showToast('Please navigate to LinkedIn Jobs page, OR enable Auto-Search in Settings.', 'warning', 6000);
        return;
      }
    }

    console.log('🔒 SECURITY: Injecting content script ONLY when user clicks Start...');

    // CRITICAL: Inject content script ONLY when user clicks Start
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content-simple.js']
      });
      console.log('✅ Content script injected successfully');

      // Wait a bit for script to initialize
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (injectError) {
      console.log('⚠️ Script may already be injected, continuing...');
    }

    // Send message and wait for response
    const response = await chrome.tabs.sendMessage(tab.id, { action: 'start' });

    if (response && response.success) {
      console.log('Bot started successfully:', response.message);
    }

    // Content script will send botStarted/botStopped messages
    await new Promise(resolve => setTimeout(resolve, 300));
  } catch (error) {
    console.error('Start error:', error);
    showToast('Error starting bot. Please reload the LinkedIn page (F5) and try again.', 'error');
  }
});

// Stop automation
document.getElementById('stop-btn').addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // Check if we're on LinkedIn
    if (!tab.url || !tab.url.includes('linkedin.com')) {
      // If not on LinkedIn, just update local state
      await chrome.storage.local.set({ isRunning: false });
      await loadRunningState();
      console.log('Bot stopped (not on LinkedIn page)');
      return;
    }

    // Send message and wait for response
    const response = await chrome.tabs.sendMessage(tab.id, { action: 'stop' });

    if (response && response.success) {
      console.log('Bot stopped successfully:', response.message);
    }

    // Content script will send botStarted/botStopped messages
    await new Promise(resolve => setTimeout(resolve, 300));
  } catch (error) {
    console.error('Stop error:', error);

    // Even if error, try to stop by updating storage directly
    await chrome.storage.local.set({ isRunning: false });
    await loadRunningState();
    console.log('Bot stopped (via storage fallback)');
  }
});

// Update button states
function updateButtons() {
  document.getElementById('start-btn').disabled = isRunning;
  document.getElementById('stop-btn').disabled = !isRunning;
}

// Update status display
function updateStatusDisplay(text, running) {
  const statusEl = document.getElementById('status');
  statusEl.textContent = text;
  statusEl.className = running ? 'status-value running' : 'status-value stopped';
}

// Update status from storage
async function updateStatus() {
  const local = await chrome.storage.local.get(['appliedCount', 'skippedCount']);
  document.getElementById('applied-count').textContent = local.appliedCount || 0;
  document.getElementById('skipped-count').textContent = local.skippedCount || 0;
}

// Listen for updates from content script
chrome.runtime.onMessage.addListener((request) => {
  if (request.type === 'updateCount') {
    document.getElementById('applied-count').textContent = request.count;
  } else if (request.type === 'updateSkippedCount') {
    document.getElementById('skipped-count').textContent = request.count;
  } else if (request.type === 'botStarted') {
    // Bot has started in content script
    isRunning = true;
    updateButtons();
    updateStatusDisplay('Running', true);
  } else if (request.type === 'botStopped') {
    // Bot has stopped in content script
    isRunning = false;
    updateButtons();
    updateStatusDisplay('Stopped', false);
  }
});

// Update status (counters) every 2 seconds
// NOTE: isRunning state is NOT in storage anymore, managed by messages from content script
setInterval(async () => {
  await updateStatus();
}, 2000);

// Export jobs to CSV
document.getElementById('export-csv-btn').addEventListener('click', async () => {
  try {
    // Read directly from storage instead of content script
    const local = await chrome.storage.local.get(['appliedJobs']);
    const jobs = local.appliedJobs || [];

    if (jobs.length === 0) {
      showToast('No jobs applied yet. Start the bot first!', 'info');
      return;
    }

    // Convert to CSV
    const csvContent = convertToCSV(jobs);

    // Download CSV
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `linkedin_applied_jobs_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);

    // Visual feedback
    const btn = document.getElementById('export-csv-btn');
    const originalHTML = btn.innerHTML;
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> Exported ${jobs.length} jobs!`;
    btn.style.background = '#059669';

    setTimeout(() => {
      btn.innerHTML = originalHTML;
      btn.style.background = '';
    }, 3000);
  } catch (error) {
    console.error('Export error:', error);
    showToast('Error exporting jobs: ' + error.message, 'error');
  }
});

// Reset counters
document.getElementById('reset-counters-btn').addEventListener('click', async () => {
  if (!confirm('Reset all counters and clear applied jobs list?')) return;

  try {
    // Update storage directly - more reliable than messaging content script
    await chrome.storage.local.set({
      appliedCount: 0,
      skippedCount: 0,
      appliedJobs: []
    });

    // Also try to notify content script if it's running
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab.url && tab.url.includes('linkedin.com')) {
        await chrome.tabs.sendMessage(tab.id, { action: 'resetCounters' });
      }
    } catch (e) {
      // Content script not available, that's ok - we already updated storage
      console.log('Content script not available, counters reset in storage only');
    }

    // Update display
    document.getElementById('applied-count').textContent = '0';
    document.getElementById('skipped-count').textContent = '0';

    // Visual feedback
    const btn = document.getElementById('reset-counters-btn');
    const originalHTML = btn.innerHTML;
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> Reset!`;
    btn.style.background = '#059669';

    setTimeout(() => {
      btn.innerHTML = originalHTML;
      btn.style.background = '';
    }, 2000);
  } catch (error) {
    console.error(error);
  }
});

// Convert jobs to CSV
function convertToCSV(jobs) {
  const headers = ['Date', 'Job Title', 'Company', 'Link'];
  const rows = jobs.map(job => [
    new Date(job.date).toLocaleString(),
    `"${job.title.replace(/"/g, '""')}"`, // Escape quotes
    `"${job.company.replace(/"/g, '""')}"`,
    job.link
  ]);

  return [
    headers.join(','),
    ...rows.map(row => row.join(','))
  ].join('\n');
}

// Load and display applied jobs
async function loadAppliedJobs() {
  try {
    const { appliedJobs = [] } = await chrome.storage.local.get(['appliedJobs']);

    const listContainer = document.getElementById('applied-jobs-list');
    const countElement = document.getElementById('applied-jobs-count');

    countElement.textContent = appliedJobs.length;

    if (appliedJobs.length === 0) {
      listContainer.innerHTML = `
        <div class="empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M20 6H16V4C16 2.89543 15.1046 2 14 2H10C8.89543 2 8 2.89543 8 4V6H4C2.89543 6 2 6.89543 2 8V19C2 20.1046 2.89543 21 4 21H20C21.1046 21 22 20.1046 22 19V8C22 6.89543 21.1046 6 20 6Z" stroke="currentColor" stroke-width="2"/>
            <path d="M8 6V4H16V6" stroke="currentColor" stroke-width="2"/>
            <path d="M12 11V17M9 14H15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
          <p>No applications yet</p>
          <small>Start applying to see your job applications here</small>
        </div>
      `;
      return;
    }

    // Sort by date (most recent first)
    const sortedJobs = [...appliedJobs].sort((a, b) => new Date(b.date) - new Date(a.date));

    listContainer.innerHTML = sortedJobs.map(job => `
      <div class="job-card">
        <div class="job-card-header">
          <div>
            <h4 class="job-title">${escapeHtml(job.title)}</h4>
            <p class="job-company">${escapeHtml(job.company)}</p>
            ${job.location ? `<p class="job-location">📍 ${escapeHtml(job.location)}</p>` : ''}
          </div>
          <span class="job-time">${formatTimeAgo(job.date)}</span>
        </div>
        <a href="${job.link}" target="_blank" class="job-link">
          View on LinkedIn
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </a>
      </div>
    `).join('');

  } catch (error) {
    console.error('Error loading applied jobs:', error);
  }
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Format time ago
function formatTimeAgo(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const seconds = Math.floor((now - date) / 1000);

  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;

  return date.toLocaleDateString();
}

// Clear all applied jobs
document.getElementById('clear-applied-jobs')?.addEventListener('click', async () => {
  if (!confirm('Clear all applied jobs from the list? This cannot be undone.')) return;

  try {
    await chrome.storage.local.set({ appliedJobs: [] });
    loadAppliedJobs();

    // Also try to clear from content script
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      try {
        await chrome.tabs.sendMessage(tab.id, { action: 'clearAppliedJobs' });
      } catch (e) {
        // Content script might not be loaded, that's okay
      }
    }
  } catch (error) {
    console.error('Error clearing applied jobs:', error);
  }
});

// Resume upload functionality
function setupResumeUpload() {
  const fileInput = document.getElementById('resumeFile');
  const uploadBtn = document.getElementById('uploadResumeBtn');
  const fileName = document.getElementById('resumeFileName');
  const removeBtn = document.getElementById('removeResumeBtn');

  // Click upload button triggers file input
  uploadBtn.addEventListener('click', () => {
    fileInput.click();
  });

  // Handle file selection
  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Check file size (max 5MB for Chrome Storage local)
    if (file.size > 5 * 1024 * 1024) {
      showToast('File too large! Please upload a file smaller than 5MB.');
      return;
    }

    // Check file type
    const allowedTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    if (!allowedTypes.includes(file.type)) {
      showToast('Invalid file type! Please upload PDF, DOC, or DOCX files only.');
      return;
    }

    try {
      // Convert file to base64
      const reader = new FileReader();
      reader.onload = async (event) => {
        const base64 = event.target.result;

        // Save to Chrome storage local (larger quota than sync)
        await chrome.storage.local.set({
          resumeFile: base64,
          resumeFileName: file.name,
          resumeFileType: file.type
        });

        // Update UI
        fileName.textContent = file.name;
        fileName.classList.add('has-file');
        removeBtn.style.display = 'inline-flex';

        // Show saved indicator
        showAutoSaveIndicator(false);

        console.log('Resume uploaded successfully:', file.name);

        // Auto-extract text if PDF (only for AI usage)
        if (file.type === 'application/pdf') {
          await extractResumeTextFromPdf(file);
        } else {
          const statusEl = document.getElementById('resumeTextStatus');
          statusEl.textContent = 'PDF auto-extract only. For DOC/DOCX, paste resume text manually below.';
          statusEl.style.color = '#f59e0b';
        }
      };

      reader.readAsDataURL(file);
    } catch (error) {
      console.error('Error uploading resume:', error);
      showToast('Error uploading file. Please try again.');
    }
  });

  // Handle remove button
  removeBtn.addEventListener('click', async () => {
    if (!confirm('Remove uploaded resume?')) return;

    try {
      // Remove from storage (keep extracted resumeText so user can re-edit)
      await chrome.storage.local.remove(['resumeFile', 'resumeFileName', 'resumeFileType']);

      // Reset UI
      fileName.textContent = 'No file chosen';
      fileName.classList.remove('has-file');
      removeBtn.style.display = 'none';
      fileInput.value = '';

      console.log('Resume removed');
    } catch (error) {
      console.error('Error removing resume:', error);
    }
  });
}

// Extract plain text from a PDF File object using PDF.js (loaded via vendor/pdf.min.js)
async function extractResumeTextFromPdf(file) {
  const statusEl = document.getElementById('resumeTextStatus');
  const textarea = document.getElementById('resumeText');
  try {
    if (typeof pdfjsLib === 'undefined') {
      statusEl.textContent = 'PDF.js library not loaded';
      statusEl.style.color = '#dc2626';
      return;
    }
    // Worker config (extension URL)
    pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('vendor/pdf.worker.min.js');

    statusEl.textContent = 'Extracting text from PDF...';
    statusEl.style.color = '#6b7280';

    const arrayBuf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuf }).promise;

    let text = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map(item => item.str).join(' ');
      text += pageText + '\n\n';
    }
    text = text.trim();

    textarea.value = text;
    await chrome.storage.local.set({ resumeText: text });

    statusEl.textContent = `✓ Extracted ${text.length} chars from ${pdf.numPages} page(s)`;
    statusEl.style.color = '#059669';
    console.log('Resume text extracted, length:', text.length);
  } catch (err) {
    console.error('PDF text extraction failed:', err);
    statusEl.textContent = 'Extraction failed: ' + err.message + ' — paste resume text manually below';
    statusEl.style.color = '#dc2626';
  }
}
