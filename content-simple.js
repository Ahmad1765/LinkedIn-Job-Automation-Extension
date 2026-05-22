// ULTRA SIMPLE - COPIE EXACTE DU PYTHON
let isRunning = false;
let config = {};
let appliedCount = 0;
let skippedCount = 0;
let appliedJobs = []; // Liste des jobs appliqués pour export
let lastActivityTime = Date.now(); // Track last activity for stuck detection
let lastJobIndex = -1; // Track last job processed
const STUCK_TIMEOUT = 120000; // 2 minutes without activity = stuck

// SECURITY: Ultimate protection flag - bot can ONLY run if user explicitly clicked Start
let userExplicitlyClickedStart = false;

// Resume/CV data for automatic upload
let resumeFile = null; // Base64 data
let resumeFileName = null;
let resumeFileType = null;

// Logs simples
function log(msg) {
  console.log('[LinkedIn Bot]', msg);
  try {
    chrome.runtime.sendMessage({ type: 'log', message: msg });
  } catch (e) {}
}

// Attendre
function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Cliquer - PROTECTED: Only works if bot is running
async function click(element) {
  // CRITICAL SECURITY CHECK: Prevent ANY clicks if bot is not explicitly started
  if (!isRunning || !userExplicitlyClickedStart) {
    console.error('🚨 SECURITY VIOLATION: Attempted click() but bot is NOT running!');
    console.error('🔒 isRunning:', isRunning, '| userExplicitlyClickedStart:', userExplicitlyClickedStart);
    console.error('🚫 Click BLOCKED for security');
    console.trace('Call stack:'); // Show where this was called from
    return; // BLOCK THE CLICK
  }

  element.click();
  updateActivity(); // Update activity on every click
  await wait(500);
}

// Update last activity time
function updateActivity() {
  lastActivityTime = Date.now();
}

// Check if script is stuck (no activity for STUCK_TIMEOUT)
function isStuck() {
  const timeSinceActivity = Date.now() - lastActivityTime;
  return timeSinceActivity > STUCK_TIMEOUT;
}

// ===== Locale-independent LinkedIn selectors =====
// LinkedIn translates UI text (button labels, aria-labels) per account language.
// Match on DOM structure + data-attrs (not translated) rather than visible text
// wherever possible, so the bot works for non-English LinkedIn accounts.

// Easy Apply button. Excludes external-apply buttons (which embed a
// link-external icon) without relying on the localized "Easy Apply" aria-label.
function findEasyApplyButton(scope = document) {
  const candidates = scope.querySelectorAll('button.jobs-apply-button');
  for (const btn of candidates) {
    if (!btn.offsetParent || btn.disabled) continue;
    const external = btn.querySelector(
      'li-icon[type="link-external"], ' +
      '[data-test-icon*="link-external"], ' +
      'svg[data-test-icon*="link-external"], ' +
      'use[href*="link-external"]'
    );
    if (external) continue;
    return btn;
  }
  return null;
}

// Primary action button in an Easy Apply modal step.
// Returns { btn, type: 'next' | 'review' | 'submit' } or null.
// Prefers LinkedIn's internal data-attrs which are NOT localized.
function findModalStepButton(modal) {
  if (!modal) return null;
  const visible = (el) => el && el.offsetParent !== null && !el.disabled;

  let btn = modal.querySelector(
    'button[data-live-test-easy-apply-submit-button], ' +
    'button[data-control-name="submit_unify"]'
  );
  if (visible(btn)) return { btn, type: 'submit' };

  btn = modal.querySelector(
    'button[data-live-test-easy-apply-review-button], ' +
    'button[data-control-name="review_unify"]'
  );
  if (visible(btn)) return { btn, type: 'review' };

  btn = modal.querySelector(
    'button[data-easy-apply-next-button], ' +
    'button[data-live-test-easy-apply-next-button], ' +
    'button[data-control-name="continue_unify"]'
  );
  if (visible(btn)) return { btn, type: 'next' };

  // Fallback: right-most primary button in the action bar / footer.
  const footer =
    modal.querySelector('.artdeco-modal__actionbar') ||
    modal.querySelector('footer') ||
    modal.querySelector('.jobs-easy-apply-modal__footer');
  if (footer) {
    const primaries = Array.from(
      footer.querySelectorAll('button.artdeco-button--primary')
    ).filter(visible);
    if (primaries.length) {
      const primary = primaries[primaries.length - 1];
      const t = (primary.textContent || '').toLowerCase().trim();
      // Multi-locale "submit" hint — last-resort heuristic; data-attrs above
      // are the authoritative path.
      const submitWords = /(submit|envoyer|soumettre|enviar|absenden|senden|invia|inviare|wyślij|verzenden|送信|提交|إرسال|kandidatur|kandidatuur|kandidaturen)/i;
      return { btn: primary, type: submitWords.test(t) ? 'submit' : 'next' };
    }
  }
  return null;
}

// Primary button in the "safety reminder" pre-apply dialog.
function findSafetyContinueButton(modal) {
  if (!modal) return null;
  const visible = (el) => el && el.offsetParent !== null;
  const scope =
    modal.querySelector('.artdeco-modal__actionbar') ||
    modal.querySelector('footer') ||
    modal;
  const primary = scope.querySelector('button.artdeco-button--primary');
  return visible(primary) ? primary : null;
}

// Check for LinkedIn's daily Easy Apply limit
function checkDailyLimit() {
  try {
    // List of limit message patterns (case-insensitive)
    const limitPatterns = [
      "You've reached today's Easy Apply limit",
      "You've reached today's easy apply limit",
      "reached today's Easy Apply limit",
      "Great effort applying today",
      "we limit daily submissions",
      "continue applying tomorrow",
      "Save this job and continue applying tomorrow",
      "exceeded the daily application limit",
      "reached today\\'s easy apply limit",
      "daily Easy Apply limit",
      "limit daily submissions"
    ];

    // Search in entire page text
    const bodyText = document.body.innerText || '';

    for (const pattern of limitPatterns) {
      if (bodyText.toLowerCase().includes(pattern.toLowerCase())) {
        log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        log('🚫 DAILY LIMIT REACHED!');
        log(`   Message detected: "${pattern}"`);
        log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        log('LinkedIn limits Easy Apply to ~50-100 per day');
        log('📊 Session stats:');
        log(`   ✅ Applied: ${appliedCount}`);
        log(`   ⏭️  Skipped: ${skippedCount}`);
        log('⏰ You can continue applying tomorrow!');
        log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

        // Show visual notification to user
        alert(`🚫 LinkedIn Daily Limit Reached!\n\n` +
              `You've reached LinkedIn's daily Easy Apply limit (~50-100 applications).\n\n` +
              `📊 Today's Stats:\n` +
              `   ✅ Applied: ${appliedCount}\n` +
              `   ⏭️  Skipped: ${skippedCount}\n\n` +
              `⏰ You can continue applying tomorrow!\n\n` +
              `The bot has been stopped automatically.`);

        return true;
      }
    }

    // Also check for specific error messages in modal/toast elements
    const errorElements = document.querySelectorAll('.artdeco-inline-feedback, .artdeco-toast-item, .artdeco-modal__content');
    for (const element of errorElements) {
      const elementText = element.textContent || '';
      for (const pattern of limitPatterns) {
        if (elementText.toLowerCase().includes(pattern.toLowerCase())) {
          log('🚫 DAILY LIMIT DETECTED in error element!');
          return true;
        }
      }
    }

    return false;
  } catch (error) {
    log(`⚠️ Error checking daily limit: ${error.message}`);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Temporary throttle ("applying too quickly") — distinct from daily limit.
// LinkedIn shows a transient block when the bot fires Easy Apply too fast.
// Strategy: detect → store cooldown state → reload page → resume mainLoop
// after waiting (handled by the init IIFE at the bottom of this file).
// ─────────────────────────────────────────────────────────────────────────────

const COOLDOWN_STEPS_MS = [90000, 180000, 360000]; // 90s, 3min, 6min
const COOLDOWN_MAX_RETRIES = COOLDOWN_STEPS_MS.length;
const COOLDOWN_STALE_MS = 30 * 60 * 1000; // ignore stored cooldown older than 30min

// Throttle phrases (multilingual where it's cheap). Daily-limit phrases stay in
// checkDailyLimit() — those must keep stopping the bot, not refresh-and-resume.
const THROTTLE_PATTERNS = [
  "applying too quickly",
  "you're applying too fast",
  "you are applying too fast",
  "please slow down",
  "slow down",
  "try again later",
  "temporarily restricted",
  "temporarily blocked",
  "too many requests",
  "try again in a few",
  "candidatures trop rapides",     // FR
  "ralentissez",                   // FR
  "réessayer plus tard",           // FR
  "demasiado rápido",              // ES
  "intenta de nuevo más tarde",    // ES
  "zu schnell",                    // DE
  "später erneut versuchen"        // DE
];

function checkRateLimitBlock() {
  try {
    const bodyText = (document.body.innerText || '').toLowerCase();
    for (const phrase of THROTTLE_PATTERNS) {
      if (bodyText.includes(phrase)) {
        return { blocked: true, reason: `phrase:${phrase}` };
      }
    }
    // Also check the artdeco toast/inline-feedback containers (LinkedIn surfaces
    // throttles there even when body text is masked by overlays).
    const noticeEls = document.querySelectorAll(
      '.artdeco-inline-feedback, .artdeco-toast-item, .artdeco-modal__content'
    );
    for (const el of noticeEls) {
      const t = (el.textContent || '').toLowerCase();
      for (const phrase of THROTTLE_PATTERNS) {
        if (t.includes(phrase)) {
          return { blocked: true, reason: `notice:${phrase}` };
        }
      }
    }
    return { blocked: false };
  } catch (error) {
    log(`⚠️ checkRateLimitBlock error: ${error.message}`);
    return { blocked: false };
  }
}

// Stash resume state and reload. The init IIFE at the bottom of this file picks
// up the flag, waits the remaining cooldown, then restarts mainLoop.
async function triggerCooldownAndRefresh(reason) {
  try {
    const existing = await chrome.storage.local.get([
      'cooldownRetries', 'cooldownStartTime'
    ]);

    // Reset retry counter if last cooldown is stale (clean session).
    const lastStart = existing.cooldownStartTime || 0;
    const stale = !lastStart || (Date.now() - lastStart) > COOLDOWN_STALE_MS;
    const retries = stale ? 0 : (existing.cooldownRetries || 0);

    if (retries >= COOLDOWN_MAX_RETRIES) {
      log('🛑 Cooldown retries exhausted — stopping bot.');
      log(`   Reason: ${reason} | retries: ${retries}/${COOLDOWN_MAX_RETRIES}`);
      isRunning = false;
      userExplicitlyClickedStart = false;
      await chrome.storage.local.set({
        isRunning: false,
        cooldownPending: false,
        cooldownRetries: 0
      });
      try {
        chrome.runtime.sendMessage({
          type: 'cooldownExhausted',
          retries,
          reason
        });
      } catch (_) {}
      try {
        alert(
          `🛑 LinkedIn rate-limited the bot ${retries} times in a row.\n\n` +
          `Detected: ${reason}\n\n` +
          `Bot stopped. Wait a while (15-30 min) then click Start again.`
        );
      } catch (_) {}
      return false;
    }

    const durationMs = COOLDOWN_STEPS_MS[retries];
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    log(`⏸️  RATE LIMIT DETECTED — entering cooldown`);
    log(`   Reason: ${reason}`);
    log(`   Cooldown: ${Math.round(durationMs / 1000)}s  (attempt ${retries + 1}/${COOLDOWN_MAX_RETRIES})`);
    log('   Will refresh page and auto-resume after cooldown.');
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    await chrome.storage.local.set({
      cooldownPending: true,
      cooldownStartTime: Date.now(),
      cooldownDuration: durationMs,
      cooldownRetries: retries + 1,
      cooldownReason: reason,
      // Persist "was running" so we know to auto-resume after reload.
      cooldownPrevRunning: true
    });

    try {
      chrome.runtime.sendMessage({
        type: 'cooldownStarted',
        durationMs,
        retries: retries + 1,
        reason
      });
    } catch (_) {}

    // Flip security flags off BEFORE reload so any racing code in flight stops.
    isRunning = false;

    // Hard reload — init IIFE handles resume.
    location.reload();
    return true;
  } catch (error) {
    log(`❌ triggerCooldownAndRefresh error: ${error.message}`);
    return false;
  }
}

// IMPROVED: Function to find and click Done button with exhaustive search
async function findAndClickDoneButton(contextElement = document, contextName = 'page', maxAttempts = 15) {
  log(`🔍 [${contextName}] Starting exhaustive search for Done button...`);

  // FAST PATH (locale-independent): the post-submit success modal has an
  // artdeco close (X) button that dismisses it regardless of UI language.
  const dismissBtn = contextElement.querySelector(
    'button.artdeco-modal__dismiss, ' +
    'button[data-control-name="dismiss"], ' +
    'button[data-test-modal-close-btn]'
  );
  if (dismissBtn && dismissBtn.offsetParent !== null) {
    log(`✅ [${contextName}] Locale-independent dismiss button found, clicking`);
    try { dismissBtn.click(); } catch (_) {
      try { dismissBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })); } catch (_) {}
    }
    updateActivity();
    await wait(700);
    return { success: true, clicked: true };
  }

  // Localized text fallbacks — covers many LinkedIn UI languages.
  const doneTexts = [
    'Done', 'Terminé', 'Fertig', 'Hecho', 'Concluído', 'Concluido', 'Fatto', 'Klaar', 'Gotowe', '完了', '完成', '완료',
    'Submit application', 'Soumettre la candidature', 'Bewerbung absenden', 'Enviar candidatura', 'Invia candidatura', 'Verzenden', 'Wyślij',
    'Dismiss', 'Close', 'Fermer', 'Schließen', 'Cerrar', 'Fechar', 'Chiudi', 'Sluiten', 'Zamknij', '閉じる', '关闭', '닫기'
  ];
  let doneBtn = null;

  for (let attempt = 0; attempt < maxAttempts && !doneBtn; attempt++) {
    await wait(1000);

    // Log what we're looking for on first attempt
    if (attempt === 0) {
      log(`   Looking for buttons with text: ${doneTexts.join(', ')}`);
    }

    // METHOD 1: Search by SPAN text (Python method - most reliable)
    for (let targetText of doneTexts) {
      // Find ALL spans in context
      const spans = Array.from(contextElement.querySelectorAll('span.artdeco-button__text, span'));

      for (let span of spans) {
        const spanText = span.textContent.trim();

        if (spanText === targetText) {
          // Find clickable parent
          let clickableElement = span.closest('button, [role="button"], .artdeco-button');

          if (!clickableElement) {
            clickableElement = span;
          }

          // Check if visible
          if (clickableElement.offsetParent !== null) {
            doneBtn = clickableElement;
            log(`   ✅ [METHOD 1] Found via SPAN: "${targetText}"`);
            break;
          }
        }
      }
      if (doneBtn) break;
    }

    // METHOD 2: Direct button search (fallback)
    if (!doneBtn) {
      const buttons = Array.from(contextElement.querySelectorAll('button, [role="button"]'));
      for (let btn of buttons) {
        const btnText = btn.textContent.trim();
        for (let targetText of doneTexts) {
          if (btnText === targetText && btn.offsetParent !== null) {
            doneBtn = btn;
            log(`   ✅ [METHOD 2] Found via direct button search: "${targetText}"`);
            break;
          }
        }
        if (doneBtn) break;
      }
    }

    // METHOD 3: Search by aria-label
    if (!doneBtn) {
      for (let targetText of doneTexts) {
        const ariaBtn = contextElement.querySelector(`button[aria-label*="${targetText}"], [role="button"][aria-label*="${targetText}"]`);
        if (ariaBtn && ariaBtn.offsetParent !== null) {
          doneBtn = ariaBtn;
          log(`   ✅ [METHOD 3] Found via aria-label: "${targetText}"`);
          break;
        }
      }
    }

    // METHOD 4: Search by data-control-name (LinkedIn specific)
    if (!doneBtn) {
      const controlNames = ['done', 'submit', 'continue_application'];
      for (let name of controlNames) {
        const controlBtn = contextElement.querySelector(`button[data-control-name*="${name}"]`);
        if (controlBtn && controlBtn.offsetParent !== null) {
          doneBtn = controlBtn;
          log(`   ✅ [METHOD 4] Found via data-control-name: "${name}"`);
          break;
        }
      }
    }

    // Debug: Log all visible buttons on first and every 5th attempt
    if (attempt === 0 || attempt % 5 === 0) {
      if (!doneBtn) {
        const allButtons = Array.from(contextElement.querySelectorAll('button, [role="button"]'));
        const visibleButtons = allButtons.filter(b => b.offsetParent !== null);
        log(`   [DEBUG Attempt ${attempt + 1}/${maxAttempts}] Found ${visibleButtons.length} visible buttons:`);
        visibleButtons.slice(0, 10).forEach((btn, i) => {
          const text = btn.textContent.trim().substring(0, 30);
          const ariaLabel = btn.getAttribute('aria-label') || 'none';
          const dataControl = btn.getAttribute('data-control-name') || 'none';
          log(`      ${i + 1}. Text: "${text}" | Aria: "${ariaLabel}" | Data: "${dataControl}"`);
        });
      }
    }

    if (!doneBtn && (attempt === 0 || attempt % 5 === 0)) {
      log(`   ⏳ [${contextName}] Attempt ${attempt + 1}/${maxAttempts}: Still searching...`);
    }
  }

  // Try to click if found
  if (doneBtn) {
    log(`✅✅✅ [${contextName}] Done button FOUND! Attempting click...`);

    let clickSuccessful = false;

    // Method 1: Standard click
    try {
      log('   Click Method 1: Standard click...');
      doneBtn.click();
      await wait(500);
      log('   ✅ Standard click successful');
      clickSuccessful = true;
    } catch (e1) {
      log(`   ⚠️ Standard click failed: ${e1.message}`);

      // Method 2: MouseEvent
      try {
        log('   Click Method 2: MouseEvent dispatch...');
        doneBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        await wait(500);
        log('   ✅ MouseEvent click successful');
        clickSuccessful = true;
      } catch (e2) {
        log(`   ⚠️ MouseEvent failed: ${e2.message}`);

        // Method 3: Focus + Enter
        try {
          log('   Click Method 3: Keyboard Enter...');
          doneBtn.focus();
          await wait(200);
          doneBtn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
          doneBtn.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
          await wait(500);
          log('   ✅ Keyboard trigger successful');
          clickSuccessful = true;
        } catch (e3) {
          log(`   ❌ All click methods failed: ${e3.message}`);
        }
      }
    }

    if (clickSuccessful) {
      updateActivity();
      await wait(700); // Ultra optimized job card click wait
      return { success: true, clicked: true };
    } else {
      return { success: false, clicked: false, reason: 'Click failed' };
    }
  } else {
    log(`❌ [${contextName}] Done button NOT FOUND after ${maxAttempts} attempts`);
    return { success: false, clicked: false, reason: 'Button not found' };
  }
}

// Refresh page and return to job search
async function refreshAndReturnToSearch() {
  log('🔄 REFRESHING page due to stuck detection...');
  try {
    // Reload the page
    location.reload();
    // Wait will happen automatically when page reloads
    return true;
  } catch (error) {
    log(`❌ Error refreshing page: ${error.message}`);
    return false;
  }
}

// Discard application (Python ligne 1500-1580) - ULTRA AGGRESSIVE VERSION + STUCK DETECTION
async function discardApplication() {
  log('🚀 DISCARD: Starting SAFE discard sequence...');

  // Multi-locale fallback. The class-based dismiss above (STEP 1) handles
  // most cases; this is defense in depth for confirmation dialogs.
  const discardTexts = [
    'discard', 'cancel',
    'annuler', 'abandonner',         // FR
    'descartar', 'cancelar',         // ES/PT
    'verwerfen', 'abbrechen',        // DE
    'scarta', 'annulla',             // IT
    'verwijderen', 'annuleren',      // NL
    'odrzuć', 'anuluj',              // PL
    '破棄', 'キャンセル',             // JA
    '丢弃', '取消',                   // ZH
    '취소'                            // KO
  ];

  try {
    // 🆕 DETECTION CRITIQUE: Vérifier si popup de chargement est bloqué (Python ligne 1547-1558)
    if (checkForStuckLoadingPopup()) {
      log('🚨 POPUP DE CHARGEMENT BLOQUÉ DÉTECTÉ!');
      log('🔄 REFRESH DE LA PAGE POUR DÉBLOQUER...');
      try {
        location.reload();
        await wait(2000); // Optimized refresh wait
        log('✅ Page rafraîchie avec succès');
        return true;
      } catch (error) {
        log(`❌ Erreur lors du refresh: ${error.message}`);
      }
    }

    // STEP 1: Force close with X button (MOST RELIABLE METHOD - moved to first)
    log('🔍 STEP 1: Looking for X/Close button...');
    const closeButtons = document.querySelectorAll('button[aria-label*="Dismiss"], button[aria-label*="Close"], button.artdeco-modal__dismiss');

    for (let btn of closeButtons) {
      if (btn.offsetParent) {
        log(`✅ Clicking close button: ${btn.getAttribute('aria-label')}`);
        btn.click();
        await wait(1000);

        // Look for discard confirmation again
        const discardBtn = Array.from(document.querySelectorAll('button')).find(b =>
          b.offsetParent && discardTexts.some(t => b.textContent.trim().toLowerCase().includes(t))
        );

        if (discardBtn) {
          log('✅ Clicking discard confirmation');
          discardBtn.click();
          await wait(1500);
        }

        const modal = document.querySelector('.jobs-easy-apply-modal');
        if (!modal || modal.offsetParent === null) {
          log('✅✅✅ MODAL CLOSED!');
          return true;
        }
      }
    }

    // STEP 2: Press ESC key (fallback)
    log('📤 STEP 2: Pressing ESC key...');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', keyCode: 27, bubbles: true }));
    await wait(1000); // Optimized ESC wait

    // STEP 3: Look for ANY discard/cancel button (last resort)
    log('🔍 STEP 3: Searching for Discard/Cancel buttons...');

    // Try 3 times to find the button (it may appear slowly)
    for (let attempt = 1; attempt <= 3; attempt++) {
      log(`   Attempt ${attempt}/3...`);

      // Get ALL buttons on page (including in dialogs/modals)
      const allButtons = Array.from(document.querySelectorAll('button, [role="button"]'));
      log(`   Found ${allButtons.length} total buttons`);

      for (let btn of allButtons) {
        // Skip invisible buttons
        if (!btn.offsetParent) continue;

        // Get text from button and nested elements
        const btnText = btn.textContent.trim().toLowerCase();
        const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
        const dataControl = (btn.getAttribute('data-control-name') || '').toLowerCase();

        // Check if it's a discard/cancel button
        const isDiscardButton = discardTexts.some(text =>
          btnText === text ||
          btnText.includes(text) ||
          ariaLabel.includes(text) ||
          dataControl.includes(text)
        );

        if (isDiscardButton) {
          log(`✅ FOUND: "${btn.textContent.trim()}" (visible, will click)`);

          // Click with multiple methods
          try {
            btn.click();
            await wait(300);
            btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          } catch (e) {
            log(`⚠️ Click error: ${e.message}`);
          }

          await wait(1500);

          // Check if modal closed
          const modal = document.querySelector('.jobs-easy-apply-modal');
          if (!modal || modal.offsetParent === null) {
            log('✅✅✅ MODAL CLOSED SUCCESSFULLY!');
            return true;
          }
        }
      }

      await wait(1000); // Wait before retry
    }

    log('❌ DISCARD FAILED: Could not close modal after all attempts');
    return false;

  } catch (error) {
    log(`❌ Error discarding: ${error.message}`);
    return false;
  }
}

// Remplir un champ - PROTECTED: Only works if bot is running
function fill(input, value) {
  // CRITICAL SECURITY CHECK: Prevent ANY form filling if bot is not explicitly started
  if (!isRunning || !userExplicitlyClickedStart) {
    console.error('🚨 SECURITY VIOLATION: Attempted fill() but bot is NOT running!');
    console.error('🔒 isRunning:', isRunning, '| userExplicitlyClickedStart:', userExplicitlyClickedStart);
    console.error('🚫 Fill BLOCKED for security');
    return; // BLOCK THE FILL
  }

  const strVal = value == null ? '' : String(value);

  // React-compatible setter: writes through React's internal value tracker
  // so React-controlled inputs (like LinkedIn's Easy Apply form) reflect the change.
  try {
    const proto = input.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (nativeSetter) {
      nativeSetter.call(input, strVal);
    } else {
      input.value = strVal;
    }
  } catch (_) {
    input.value = strVal;
  }

  // Focus first so React sees field as "touched"
  try { input.focus(); } catch (_) {}

  // Dispatch the events React/LinkedIn listens for
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  // Some LinkedIn fields validate on blur — give them a synthetic blur after a tick
  try { input.blur(); } catch (_) {}
}

// Convert base64 to File object for resume upload
function base64ToFile(base64String, filename, mimeType) {
  try {
    // Remove data URL prefix if present (e.g., "data:application/pdf;base64,")
    const base64Data = base64String.includes(',') ? base64String.split(',')[1] : base64String;

    // Convert base64 to binary
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);

    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Create File object
    const file = new File([bytes], filename, { type: mimeType });
    return file;
  } catch (error) {
    log(`❌ Error converting base64 to file: ${error.message}`);
    return null;
  }
}

// Fill file input with resume
async function fillFileInput(fileInput, file) {
  try {
    // Create a DataTransfer object to set files
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);

    // Set the files property
    fileInput.files = dataTransfer.files;

    // Trigger change event
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));

    log(`✅ Resume uploaded: ${file.name}`);
    return true;
  } catch (error) {
    log(`❌ Error filling file input: ${error.message}`);
    return false;
  }
}

// BOUCLE PRINCIPALE - EXACTEMENT COMME PYTHON
async function mainLoop() {
  // SECURITY: Triple-layer protection - bot MUST be explicitly started by user
  if (!isRunning) {
    log('⚠️ SECURITY BLOCK 1/3: mainLoop called but isRunning=false - ABORTING');
    return;
  }

  if (!userExplicitlyClickedStart) {
    log('🚨 SECURITY BLOCK 2/3: mainLoop called but user did NOT click Start - ABORTING');
    log('🔒 This prevents any automatic execution. Bot ONLY runs when you click Start.');
    isRunning = false; // Force stop for safety
    await chrome.storage.local.set({ isRunning: false });
    return;
  }

  // Final sanity check
  if (!config || !config.email) {
    log('⚠️ SECURITY BLOCK 3/3: No config loaded - ABORTING');
    isRunning = false;
    userExplicitlyClickedStart = false;
    await chrome.storage.local.set({ isRunning: false });
    return;
  }

  console.log('%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'color: green; font-weight: bold;');
  console.log('%c🚀 BOT STARTED - User clicked START button', 'color: green; font-weight: bold; font-size: 14px;');
  console.log('%c✅ ALL SECURITY CHECKS PASSED', 'color: green; font-weight: bold;');
  console.log('%c🔓 Click() and Fill() functions are now ENABLED', 'color: green; font-weight: bold;');
  console.log('%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'color: green; font-weight: bold;');
  log('🚀 ✅ ALL SECURITY CHECKS PASSED - Bot started by user');

  // Detect page type ONCE at start
  const isCollectionsPage = window.location.href.includes('/jobs/collections/');
  if (isCollectionsPage) {
    log('📋 Page type: COLLECTIONS (infinite scroll mode)');
  } else {
    log('📋 Page type: SEARCH (pagination mode)');
  }
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  while (isRunning) {
    try {
      // 🆕 CHECK: Daily limit reached?
      if (checkDailyLimit()) {
        log('⛔ Stopping bot: Daily limit reached');
        isRunning = false;
        userExplicitlyClickedStart = false; // Clear security flag

        // Update storage
        await chrome.storage.local.set({ isRunning: false });

        // Notify popup
        try {
          chrome.runtime.sendMessage({
            type: 'updateStatus',
            status: 'stopped',
            message: 'Daily limit reached'
          });
        } catch (e) {
          // Popup may be closed
        }
        break;
      }

      // 🆕 CHECK: Script stuck? (no activity for 2 minutes)
      if (isStuck()) {
        log('🚨 SCRIPT STUCK DETECTED: No activity for 2 minutes!');
        log('🔄 Refreshing page to recover...');
        await refreshAndReturnToSearch();
        await wait(2500); // Optimized stuck recovery wait
        updateActivity(); // Reset activity after refresh
        continue;
      }

      // Primary selector — older LinkedIn DOM
      let jobCards = document.querySelectorAll('li[data-occludable-job-id]');

      // Broader fallback chain — try newer LinkedIn DOM variants on any page type.
      // LinkedIn frequently changes class names; cascade through known variants.
      if (jobCards.length === 0) {
        const fallbackSelectors = [
          'li.scaffold-layout__list-item',
          'li.jobs-search-results__list-item',
          'div.job-card-container',
          'li.ember-view.jobs-search-results__list-item',
          '[data-job-id]',
          '.jobs-search-results-list__list-item',
          'div[data-view-name="job-card"]'
        ];
        for (const sel of fallbackSelectors) {
          const found = document.querySelectorAll(sel);
          if (found.length > 0) {
            jobCards = found;
            log(`📋 Found ${found.length} jobs using fallback selector: ${sel}`);
            break;
          }
        }
      }

      if (jobCards.length === 0) {
        log(`Aucune offre trouvée. Attente 5s...`);
        log(`   URL: ${location.href}`);
        // Diagnostic: count anything that LOOKS like a job result container
        const diag = {
          'li[data-occludable-job-id]': document.querySelectorAll('li[data-occludable-job-id]').length,
          'li.scaffold-layout__list-item': document.querySelectorAll('li.scaffold-layout__list-item').length,
          'div.job-card-container': document.querySelectorAll('div.job-card-container').length,
          '[data-job-id]': document.querySelectorAll('[data-job-id]').length,
          'a[href*="/jobs/view/"]': document.querySelectorAll('a[href*="/jobs/view/"]').length
        };
        log(`   Diag: ${JSON.stringify(diag)}`);
        // Detect "0 results" state vs. "DOM out of date" state
        const noResultsBanner = document.body.innerText.match(/no (?:matching )?jobs?(?: found)?|no results|aucun emploi|aucune offre/i);
        if (noResultsBanner) {
          log(`   ℹ️ LinkedIn says: "${noResultsBanner[0]}" — broaden your search keywords or remove location filter.`);
        }

        // Check if page is unrecognized (no jobs for too long)
        if (isStuck()) {
          log('🚨 Page might be unrecognized (no jobs found + stuck)');
          log('🔄 Refreshing to return to job search...');
          await refreshAndReturnToSearch();
          await wait(2500); // Optimized refresh recovery wait
          updateActivity();
        }

        await wait(2500); // Optimized no jobs wait
        continue;
      }

      log(`${jobCards.length} offres trouvées`);
      updateActivity(); // Found jobs = activity

      // Python ligne 1701: for job in job_listings
      for (let i = 0; i < jobCards.length; i++) {
        if (!isRunning) break;

        const job = jobCards[i];
        const jobId = job.getAttribute('data-occludable-job-id');

        log(`\n--- Job ${i + 1}/${jobCards.length} (ID: ${jobId}) ---`);

        // CRITICAL: Check if modal from previous job is still open (stuck scenario)
        const leftoverModal = document.querySelector('.jobs-easy-apply-modal');
        if (leftoverModal && leftoverModal.offsetParent !== null) {
          log('⚠️ WARNING: Modal from previous job still open! Cleaning up...');
          await discardApplication();
          await wait(1000); // Optimized cleanup wait

          // Verify it's closed
          const stillOpen = document.querySelector('.jobs-easy-apply-modal');
          if (stillOpen && stillOpen.offsetParent !== null) {
            log('❌ CRITICAL: Could not close leftover modal, skipping this job');
            skippedCount++;
            updateSkippedCount();
            continue;
          } else {
            log('✅ Leftover modal cleaned up successfully');
          }
        }

        // Get job info for filtering — broad selector cascade for resilience to LinkedIn DOM changes
        const jobTitle = extractJobTitle(job);
        const jobCompany = extractJobCompany(job);
        const jobDescription = extractJobDescription(job);
        log(`   📝 Title: "${jobTitle}" | Company: "${jobCompany}"`);

        // Check blacklist keywords
        if (shouldSkipByBlacklist(jobTitle, jobCompany, jobDescription, config.blacklistKeywords)) {
          skippedCount++;
          updateSkippedCount();
          continue;
        }

        // Check whitelist keywords — only apply if title matches at least one
        if (shouldSkipByWhitelist(jobTitle, config.whitelistKeywords)) {
          skippedCount++;
          updateSkippedCount();
          continue;
        }

        // Check max years required
        if (shouldSkipByExperience(job, parseInt(config.maxYearsRequired))) {
          skippedCount++;
          updateSkippedCount();
          continue;
        }

        // Scroll and click (Python line 371)
        job.scrollIntoView({ block: 'start', behavior: 'smooth' });
        await wait(500);

        const link = job.querySelector('a');
        if (link) {
          await click(link);
          await wait(600); // Ultra optimized job link wait
        }

        // Easy Apply — locale-independent: button.jobs-apply-button without
        // a link-external icon. LinkedIn translates the aria-label per account
        // language, so text matching breaks for non-English users.
        const easyApplyBtn = findEasyApplyButton(document);

        if (!easyApplyBtn) {
          log('Pas Easy Apply, skip');
          skippedCount++;
          updateSkippedCount();
          continue;
        }

        await click(easyApplyBtn);
        await wait(800); // Ultra optimized Easy Apply wait

        // Safety reminder modal ("Continue applying") — locale-independent:
        // if a generic dialog appears BEFORE the Easy Apply form modal,
        // click its primary action button.
        const safetyModal = document.querySelector('[role="dialog"], .artdeco-modal');
        const easyApplyModalOpen = document.querySelector('.jobs-easy-apply-modal');
        if (safetyModal && safetyModal.offsetParent !== null && !easyApplyModalOpen) {
          const continueBtn = findSafetyContinueButton(safetyModal);
          if (continueBtn) {
            log('Safety reminder detected — clicking primary button...');
            await click(continueBtn);
            await wait(1000);
          }
        }

        // CHECK: Temporary throttle ("applying too quickly") — recoverable.
        // Runs BEFORE daily-limit check because throttle phrases never overlap
        // with daily-limit phrases, and throttle path refreshes instead of stopping.
        {
          const throttle = checkRateLimitBlock();
          if (throttle.blocked) {
            log(`⏸️  Throttle detected after Easy Apply click — ${throttle.reason}`);
            await triggerCooldownAndRefresh(throttle.reason);
            return; // location.reload() in flight; abort mainLoop cleanly
          }
        }

        // CRITICAL: Check for daily limit immediately after clicking Easy Apply
        // This catches the network error case where modal doesn't appear
        if (checkDailyLimit()) {
          log('');
          log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          log('🚫 LINKEDIN DAILY LIMIT REACHED!');
          log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          log('LinkedIn limits Easy Apply to ~50-100 per day');
          log(`✅ Applied today: ${appliedCount}`);
          log(`⏭️  Skipped today: ${skippedCount}`);
          log('⏰ You can continue applying tomorrow!');
          log('🛑 Bot stopped automatically');
          log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          log('');

          isRunning = false;
          userExplicitlyClickedStart = false; // Clear security flag

          // Update storage
          await chrome.storage.local.set({ isRunning: false });

          try {
            chrome.runtime.sendMessage({
              type: 'updateStatus',
              status: 'stopped',
              message: 'Daily limit reached'
            });
          } catch (e) {
            // Popup might be closed
          }

          break; // Exit job loop
        }

        // Verify that modal appeared (if not, might be limit reached)
        const modalCheck = document.querySelector('.jobs-easy-apply-modal');
        if (!modalCheck || modalCheck.offsetParent === null) {
          log('⚠️ Easy Apply modal did not appear - checking for limit...');
          await wait(1000); // Optimized modal check wait

          // CHECK: Throttle first (recoverable) before daily-limit (terminal).
          {
            const throttle = checkRateLimitBlock();
            if (throttle.blocked) {
              log(`⏸️  Throttle detected on missing modal — ${throttle.reason}`);
              await triggerCooldownAndRefresh(throttle.reason);
              return;
            }
          }

          if (checkDailyLimit()) {
            log('');
            log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            log('🚫 LINKEDIN DAILY LIMIT REACHED!');
            log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            log('LinkedIn limits Easy Apply to ~50-100 per day');
            log(`✅ Applied today: ${appliedCount}`);
            log(`⏭️  Skipped today: ${skippedCount}`);
            log('⏰ You can continue applying tomorrow!');
            log('🛑 Bot stopped automatically');
            log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            log('');

            isRunning = false;
            userExplicitlyClickedStart = false; // Clear security flag

            // Update storage
            await chrome.storage.local.set({ isRunning: false });

            try {
              chrome.runtime.sendMessage({
                type: 'updateStatus',
                status: 'stopped',
                message: 'Daily limit reached'
              });
            } catch (e) {
              // Popup might be closed
            }

            break; // Exit job loop
          }

          // Modal still not there and no limit message - skip job
          log('❌ Modal did not appear (unknown reason), skipping job');
          skippedCount++;
          updateSkippedCount();
          continue;
        }

        // Infos du job déjà extraites plus haut pour blacklist, on les réutilise
        const jobLink = job.querySelector('a')?.href || window.location.href;

        // Remplir formulaire multi-étapes avec TIMEOUT (Python ligne 528-529)
        let step = 0;
        const applicationStartTime = Date.now();
        const applicationTimeout = 180000; // 3 minutes max par candidature
        let loadingScreenTimeout = 20000; // 20 secondes pour écran de chargement (Python ligne 1481-1497)
        let lastActivityTime = Date.now();
        let disabledRetries = 0;         // counts consecutive "Next disabled" attempts before discard
        let validationRetries = 0;       // counts consecutive validation-error sightings before discard
        const MAX_DISABLED_RETRIES = 4;  // ~6s of retry time
        const MAX_VALIDATION_RETRIES = 3;

        while (step < 30) {  // allow more iterations (multi-step apps with retries can exceed 10)
          step++;

          // TIMEOUT CHECK (Python ligne 639)
          if (Date.now() - applicationStartTime > applicationTimeout) {
            log('⏰ TIMEOUT 3min - Discarding application');
            await discardApplication();
            skippedCount++;
            updateSkippedCount();
            break;
          }

          // 🆕 RE-CHECK: Popup bloqué avant chaque step (Python ligne 1563-1568)
          if (checkForStuckLoadingPopup()) {
            log('🚨 POPUP TOUJOURS BLOQUÉ - REFRESH...');
            location.reload();
            await wait(2000); // Optimized refresh wait
            skippedCount++;
            updateSkippedCount();
            break;
          }

          // CHECK FOR VALIDATION ERRORS EARLY — but give the fill pass a chance to retry first
          let modal = document.querySelector('.jobs-easy-apply-modal');
          if (modal) {
            // Locale-independent: error elements use stable LinkedIn CSS
            // classes; visible presence = validation failure, no text check
            // needed (which would fail for non-English UI languages).
            const errors = modal.querySelectorAll(
              '.artdeco-inline-feedback--error, ' +
              '.fb-form-element-label__error, ' +
              '[role="alert"].artdeco-inline-feedback'
            );
            let validationErrorSeen = false;
            for (let error of errors) {
              if (error.offsetParent !== null && error.textContent.trim()) {
                validationErrorSeen = true;
                log(`⚠️ Validation error visible (retry ${validationRetries + 1}/${MAX_VALIDATION_RETRIES}): ${error.textContent.substring(0, 60)}`);
                break;
              }
            }
            if (validationErrorSeen) {
              validationRetries++;
              if (validationRetries >= MAX_VALIDATION_RETRIES) {
                log('❌ Validation error persists after retries — DISCARDING');
                await discardApplication();
                skippedCount++;
                updateSkippedCount();
                step = 999;
                break;
              }
              // Don't discard yet — fall through to fill pass, give AI/rules another chance
            } else {
              validationRetries = 0; // reset on clean step
            }
          }

          // CHECK LOADING SCREEN (Python ligne 1481-1497)
          if (await isPageLoadingSlow()) {
            log('⏳ Loading screen detected...');
            const loadingStart = Date.now();

            while (await isPageLoadingSlow()) {
              if (Date.now() - loadingStart > loadingScreenTimeout) {
                log('⏰ Loading screen TIMEOUT 20s - Discarding application');

                // Use the discardApplication function to properly close modal
                const discarded = await discardApplication();

                if (discarded) {
                  log('✅ Modal closed successfully, moving to next job');
                } else {
                  log('⚠️ Modal may not be closed, forcing break anyway');
                }

                skippedCount++;
                updateSkippedCount();

                // Wait to ensure modal is closed and page is stable
                await wait(1000); // Optimized modal stable wait

                // Exit the step loop to move to next job
                break;
              }
              await wait(1000);
            }

            if (Date.now() - loadingStart > loadingScreenTimeout) {
              break; // Sortir du while principal pour passer au job suivant
            }
          }

          log(`Step ${step}`);

          // Find modal (reuse variable from earlier)
          modal = document.querySelector('.jobs-easy-apply-modal');
          if (!modal) {
            log('Modal closed');
            break;
          }

          // 0. AI BATCH PREFETCH — one API call answers all AI-needed questions on this step.
          // Populates the cache; the per-field askLLM calls below become free cache hits.
          await prefetchAIQuestions(modal);

          // 1. TEXT FIELDS (Python line 1102) - Multilingual support
          const textInputs = modal.querySelectorAll('input[type="text"], input[type="email"], input[type="tel"], input[type="number"]');
          for (let input of textInputs) {
            if (input.value) continue; // Skip if already filled

            // Get label from multiple sources
            let labelText = '';

            // aria-label
            labelText += ' ' + (input.getAttribute('aria-label') || '');

            // name attribute
            labelText += ' ' + (input.getAttribute('name') || '');

            // Associated <label> element
            const inputId = input.getAttribute('id');
            if (inputId) {
              const labelEl = modal.querySelector(`label[for="${inputId}"]`);
              if (labelEl) labelText += ' ' + labelEl.textContent;
            }

            // Parent label
            const parentLabel = input.closest('label');
            if (parentLabel) labelText += ' ' + parentLabel.textContent;

            const label = labelText.toLowerCase();

            // Years of experience (EN/FR/ES/DE/IT) — require a year-word AND treat skill-specific questions as AI-eligible
            // We only auto-answer GENERIC "years of experience" with the default. Skill-specific ones go to AI.
            const isGenericYearsQuestion = label.match(/(years?|yrs?|années?|años|jahre|anni)\b/) &&
                                           !label.match(/with|in|of|avec|en|dans|with the|with our/);
            if (isGenericYearsQuestion) {
              fill(input, config.yearsOfExperience || '2');
              log(`Years exp: ${config.yearsOfExperience || '2'}`);
            }
            // Salary / Compensation (EN/FR/ES/DE/IT)
            else if (label.match(/salary|compensation|remuneration|salaire|rémunération|sueldo|salario|gehalt|stipendio/)) {
              if (config.expectedSalary) {
                fill(input, config.expectedSalary);
                log(`Salary filled: ${config.expectedSalary}`);
              } else {
                log(`⚠️ Salary question detected but no expected salary configured`);
              }
            }
            // Email
            else if (label.match(/email|e-mail|courriel|correo/)) fill(input, config.email);
            // First name (EN/FR/ES/DE/IT)
            else if (label.match(/first|prénom|prenom|nombre|vorname|nome/)) fill(input, config.firstName);
            // Last name (EN/FR/ES/DE/IT)
            else if (label.match(/last|nom|apellido|nachname|cognome/)) fill(input, config.lastName);
            // Phone (EN/FR/ES/DE/IT) - includes "portable", "cell", "móvil"
            else if (label.match(/phone|téléphone|telefono|telefon|mobile|portable|cell|móvil|cellulare/)) {
              fill(input, config.phone);
              log(`Phone filled: ${config.phone}`);
            }
            // City/Location (EN/FR/ES/DE/IT) - with autocomplete handling
            else if (label.match(/city|ville|ciudad|stadt|città|location|localisation|ubicación|standort/)) {
              fill(input, config.city || '');
              log(`Location filled: ${config.city}`);

              // Wait for autocomplete dropdown to appear
              await wait(1000);

              // Try multiple selectors for autocomplete dropdown
              let dropdown = null;
              const dropdownSelectors = [
                '[role="listbox"]',
                '.basic-typeahead__selectable',
                '.artdeco-typeahead__results',
                '.artdeco-dropdown__content-inner',
                'ul[role="listbox"]',
                '.typeahead-results'
              ];

              for (let selector of dropdownSelectors) {
                dropdown = document.querySelector(selector);
                if (dropdown && dropdown.offsetParent !== null) { // Visible
                  break;
                }
              }

              if (dropdown) {
                // Find first option
                const optionSelectors = [
                  '[role="option"]:first-child',
                  'li:first-child',
                  '.basic-typeahead__selectable-item:first-child'
                ];

                let firstOption = null;
                for (let selector of optionSelectors) {
                  firstOption = dropdown.querySelector(selector);
                  if (firstOption) break;
                }

                if (firstOption) {
                  firstOption.click();
                  log(`✓ Location autocomplete: ${firstOption.textContent.substring(0, 30)}`);
                  await wait(500);
                }
              } else {
                // Fallback: Keyboard navigation (Arrow Down + Enter)
                log('Using keyboard fallback for location');
                input.focus();
                await wait(300);
                input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', keyCode: 40, bubbles: true }));
                await wait(500);
                input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
                await wait(300);
              }
            }
            // AI FALLBACK: any unknown text input → ask the LLM
            else {
              const cleanQuestion = labelText.replace(/\s+/g, ' ').trim();
              // Detect numeric intent even when input.type is "text" — LinkedIn does this often
              const looksNumeric =
                input.type === 'number' ||
                input.getAttribute('inputmode') === 'numeric' ||
                /\b(numeric|number)\b/.test(input.getAttribute('pattern') || '') ||
                /(whole\s+number|how\s+many|how\s+much|number\s+between|enter\s+a\s+number|years?\b|nombre|combien|cuántos|wieviel|quanti)/i.test(cleanQuestion);
              const fieldType = looksNumeric ? 'number' : 'text';

              // Parse min/max from the question text to give the model a tighter constraint
              let minMax = '';
              const rangeMatch = cleanQuestion.match(/between\s+(\d+)\s+and\s+(\d+)/i);
              if (rangeMatch) minMax = ` Answer must be between ${rangeMatch[1]} and ${rangeMatch[2]}.`;
              const maxAttr = input.getAttribute('max');
              const minAttr = input.getAttribute('min');
              if (!minMax && (minAttr || maxAttr)) {
                minMax = ` Answer must be between ${minAttr || 0} and ${maxAttr || 99}.`;
              }

              // Detect "years of experience with X" so we have a safe fallback
              const isYearsWithSkill = /\byears?\b.*\bwith\b|\bhow\s+many\s+years?\b/i.test(cleanQuestion);

              const applyNumeric = (val) => {
                let finalValue = String(val);
                const digits = finalValue.match(/\d+/)?.[0];
                finalValue = digits || '1';
                if (rangeMatch) {
                  const lo = parseInt(rangeMatch[1]);
                  const hi = parseInt(rangeMatch[2]);
                  finalValue = String(Math.max(lo, Math.min(hi, parseInt(finalValue))));
                } else if (minAttr || maxAttr) {
                  const lo = parseInt(minAttr || '0');
                  const hi = parseInt(maxAttr || '99');
                  finalValue = String(Math.max(lo, Math.min(hi, parseInt(finalValue))));
                }
                return finalValue;
              };

              if (!cleanQuestion) {
                log(`⚠️ Unknown text input has no detectable label/aria-label — cannot fill (input.id=${input.id || 'none'}, name=${input.name || 'none'})`);
              } else if (!config?.aiEnabled) {
                // AI off — still try the safe years-fallback so application can proceed
                if (fieldType === 'number' && isYearsWithSkill) {
                  const fallback = applyNumeric(config.yearsOfExperience || '2');
                  fill(input, fallback);
                  log(`📌 AI off — used default years (${fallback}) for: "${cleanQuestion.substring(0, 60)}"`);
                } else {
                  log(`⚠️ Unknown ${fieldType} question detected but AI is OFF — enable "AI Assistance" in Settings: "${cleanQuestion.substring(0, 60)}"`);
                }
              } else {
                log(`🔎 Unknown ${fieldType} question, asking AI: "${cleanQuestion.substring(0, 60)}"`);
                const aiAnswer = await askLLM(cleanQuestion + minMax, fieldType, []);
                if (aiAnswer) {
                  const finalValue = fieldType === 'number' ? applyNumeric(aiAnswer) : aiAnswer;
                  fill(input, finalValue);
                  log(`✏️ AI filled "${cleanQuestion.substring(0, 40)}" with "${finalValue.substring(0, 50)}"`);
                } else if (fieldType === 'number' && isYearsWithSkill) {
                  // SAFETY NET: AI failed (rate-limited / refused) but we know this is a "years with X" question.
                  // Use the configured default years so application isn't blocked by one missing answer.
                  const fallback = applyNumeric(config.yearsOfExperience || '2');
                  fill(input, fallback);
                  log(`🛟 AI failed — used default years (${fallback}) as safe fallback for: "${cleanQuestion.substring(0, 60)}"`);
                } else {
                  log(`❌ AI returned no answer for "${cleanQuestion.substring(0, 60)}" — leaving blank (will likely block Submit)`);
                }
              }
            }
          }

          // 1b. TEXTAREAS (long-form questions like "Why do you want this job?")
          const textareas = modal.querySelectorAll('textarea');
          for (let ta of textareas) {
            if (ta.value && ta.value.trim()) continue; // already filled
            let labelText = '';
            labelText += ' ' + (ta.getAttribute('aria-label') || '');
            labelText += ' ' + (ta.getAttribute('name') || '');
            const taId = ta.getAttribute('id');
            if (taId) {
              const labelEl = modal.querySelector(`label[for="${taId}"]`);
              if (labelEl) labelText += ' ' + labelEl.textContent;
            }
            const parentLabel = ta.closest('label');
            if (parentLabel) labelText += ' ' + parentLabel.textContent;

            const cleanQuestion = labelText.replace(/\s+/g, ' ').trim();
            if (!cleanQuestion) {
              log(`⚠️ Textarea has no label, skipping (id=${ta.id || 'none'})`);
              continue;
            }
            if (!config?.aiEnabled) {
              log(`⚠️ Textarea found but AI is OFF — enable "AI Assistance" in Settings: "${cleanQuestion.substring(0, 60)}"`);
              continue;
            }
            log(`🔎 Textarea question, asking AI: "${cleanQuestion.substring(0, 60)}"`);
            const aiAnswer = await askLLM(cleanQuestion, 'textarea', []);
            if (aiAnswer) {
              fill(ta, aiAnswer);
              log(`✏️ AI filled textarea "${cleanQuestion.substring(0, 40)}"`);
            } else {
              log(`❌ AI returned no answer for textarea "${cleanQuestion.substring(0, 60)}"`);
            }
          }

          // 2. FILE INPUTS (Resume/CV Upload) - SMART: Select existing or upload once
          // LinkedIn remembers previously uploaded CVs - we should select those instead of re-uploading

          // STEP 2a: First, try to select an existing/previously uploaded resume
          let resumeAlreadySelected = false;

          // Look for resume selection cards/radio buttons (LinkedIn shows previously uploaded resumes)
          const resumeSelectors = [
            // Radio buttons for resume selection
            'input[type="radio"][name*="resume"]',
            'input[type="radio"][name*="cv"]',
            'input[type="radio"][id*="resume"]',
            'input[type="radio"][id*="document"]',
            // Clickable resume cards
            '[data-test-document-upload-item]',
            '.jobs-document-upload-redesign-card',
            '.jobs-document-upload__container',
            '.document-upload-item',
            // Resume list items
            '[class*="resume-card"]',
            '[class*="document-card"]'
          ];

          for (let selector of resumeSelectors) {
            const resumeOptions = modal.querySelectorAll(selector);
            if (resumeOptions.length > 0) {
              // Find the first/most recent resume option
              for (let option of resumeOptions) {
                if (option.offsetParent !== null) { // Visible
                  // For radio buttons
                  if (option.type === 'radio') {
                    if (!option.checked) {
                      const label = modal.querySelector(`label[for="${option.id}"]`);
                      if (label) {
                        label.click();
                        log(`✅ Selected existing resume: ${label.textContent.substring(0, 40)}`);
                      } else {
                        option.click();
                        log(`✅ Selected existing resume (radio)`);
                      }
                      resumeAlreadySelected = true;
                      await wait(500);
                      break;
                    } else {
                      log(`✅ Resume already selected`);
                      resumeAlreadySelected = true;
                      break;
                    }
                  } else {
                    // For clickable cards - click if not already selected
                    const isSelected = option.classList.contains('selected') ||
                                      option.getAttribute('aria-selected') === 'true' ||
                                      option.querySelector('input[type="radio"]:checked');
                    if (!isSelected) {
                      option.click();
                      log(`✅ Selected existing resume card`);
                      resumeAlreadySelected = true;
                      await wait(500);
                      break;
                    } else {
                      log(`✅ Resume card already selected`);
                      resumeAlreadySelected = true;
                      break;
                    }
                  }
                }
              }
              if (resumeAlreadySelected) break;
            }
          }

          // STEP 2b: If no existing resume found/selected, upload new one (only once per session)
          if (!resumeAlreadySelected && resumeFile && resumeFileName && resumeFileType) {
            const fileInputs = modal.querySelectorAll('input[type="file"]');

            for (let fileInput of fileInputs) {
              // Check if already has a file
              if (fileInput.files && fileInput.files.length > 0) {
                log(`⏭️ File input already has file: ${fileInput.files[0].name}`);
                continue;
              }

              // Get label to understand what file is requested
              let labelText = '';
              labelText += ' ' + (fileInput.getAttribute('aria-label') || '');
              labelText += ' ' + (fileInput.getAttribute('name') || '');

              const inputId = fileInput.getAttribute('id');
              if (inputId) {
                const labelEl = modal.querySelector(`label[for="${inputId}"]`);
                if (labelEl) labelText += ' ' + labelEl.textContent;
              }

              const parentLabel = fileInput.closest('label');
              if (parentLabel) labelText += ' ' + parentLabel.textContent;

              const label = labelText.toLowerCase();

              // Check if it's asking for resume/CV (multilingual)
              const isResumeInput = label.match(/resume|cv|curriculum|vitae|upload.*document|file/);

              if (isResumeInput) {
                log(`📎 File input detected (no existing resume found): ${labelText.substring(0, 50)}`);

                // Convert base64 to File object
                const file = base64ToFile(resumeFile, resumeFileName, resumeFileType);

                if (file) {
                  const success = await fillFileInput(fileInput, file);

                  if (success) {
                    log(`✅ Resume uploaded successfully (first time upload)`);
                    await wait(500); // Wait for LinkedIn to process the upload
                  } else {
                    log(`⚠️ Failed to upload resume to file input`);
                  }
                } else {
                  log(`❌ Failed to convert resume to File object`);
                }
              } else {
                log(`⏭️ Skipping file input (not resume): ${labelText.substring(0, 50)}`);
              }
            }
          } else if (!resumeAlreadySelected && modal.querySelector('input[type="file"]')) {
            // File input found but no resume uploaded in extension
            const fileInputsCount = modal.querySelectorAll('input[type="file"]').length;
            log(`⚠️ ${fileInputsCount} file input(s) found but no resume uploaded in extension`);
            log(`   Upload your resume in the extension popup to auto-fill file uploads`);
          }

          // 3. CHECKBOXES (consent, terms, etc.)
          const checkboxes = modal.querySelectorAll('input[type="checkbox"]');
          for (let checkbox of checkboxes) {
            if (checkbox.id === 'follow-company-checkbox') continue; // Skip follow company (handled later)

            // Get associated label
            const checkboxLabel = modal.querySelector(`label[for="${checkbox.id}"]`);
            const labelText = checkboxLabel ? checkboxLabel.textContent.toLowerCase() : '';

            // Check for consent, terms, conditions, etc.
            if (labelText.match(/consent|agree|terms|conditions|policy|privacy|accept|j'accepte|j'autorise|consentement/)) {
              if (!checkbox.checked) {
                checkboxLabel ? checkboxLabel.click() : checkbox.click();
                log(`✓ Checkbox: ${labelText.substring(0, 40)}`);
                await wait(300);
              }
            }
          }

          // 4. RADIO BUTTONS (Python ligne 1037)
          const radios = modal.querySelectorAll('fieldset[data-test-form-builder-radio-button-form-component]');
          for (let fieldset of radios) {
            const questionLabel = fieldset.querySelector('legend, span[class*="title"]');
            const questionText = questionLabel ? questionLabel.textContent.toLowerCase() : '';

            const radioInputs = fieldset.querySelectorAll('input[type="radio"]');
            let answered = false;

            // SMART DETECTION: Check for specific questions and use user's configuration
            let desiredAnswer = 'yes'; // default

            // Visa sponsorship question
            if (questionText.match(/visa|sponsor|sponsorship/i) && config.visaSponsorship) {
              desiredAnswer = config.visaSponsorship;
              log(`⚙️ Visa question detected, answering: ${desiredAnswer}`);
            }
            // Work authorization question
            else if (questionText.match(/author|legal.*work|permit.*work|eligib.*work|right.*work/i) && config.legallyAuthorized) {
              desiredAnswer = config.legallyAuthorized;
              log(`⚙️ Work authorization question detected, answering: ${desiredAnswer}`);
            }
            // Relocation question
            else if (questionText.match(/relocat|move.*locat|willing.*move/i) && config.willingToRelocate) {
              desiredAnswer = config.willingToRelocate;
              log(`⚙️ Relocation question detected, answering: ${desiredAnswer}`);
            }
            // Security clearance question (always answer No)
            else if (questionText.match(/security.*clearance|clearance/i)) {
              desiredAnswer = 'no';
              log(`⚙️ Security clearance question detected, answering: no (default)`);
            }
            // Driver's license question
            else if (questionText.match(/driver.*license|driving.*license|valid.*license/i) && config.driversLicense) {
              desiredAnswer = config.driversLicense;
              log(`⚙️ Driver's license question detected, answering: ${desiredAnswer}`);
            }

            // Click the appropriate answer (Yes or No)
            for (let radio of radioInputs) {
              const radioLabel = fieldset.querySelector(`label[for="${radio.id}"]`);
              const radioText = radioLabel ? radioLabel.textContent.trim().toLowerCase() : '';

              // Match Yes/No in multiple languages
              const isYes = radioText.match(/^(yes|oui|sí|si|ja|y)$/);
              const isNo = radioText.match(/^(no|non|nein|n)$/);

              if ((desiredAnswer === 'yes' && isYes) || (desiredAnswer === 'no' && isNo)) {
                if (!radio.checked) {
                  radioLabel ? radioLabel.click() : radio.click();
                  log(`Radio ${desiredAnswer}: ${questionText.substring(0, 30)}`);
                  answered = true;
                }
                break;
              }
            }

            // AI FALLBACK: ask LLM to pick the right option label
            if (!answered) {
              const radioOptions = Array.from(radioInputs).map(r => {
                const lab = fieldset.querySelector(`label[for="${r.id}"]`);
                return (lab ? lab.textContent : r.value || '').trim();
              }).filter(t => t);

              if (radioOptions.length > 0) {
                const cleanQuestion = (questionLabel?.textContent || '').replace(/\s+/g, ' ').trim();
                const aiAnswer = await askLLM(cleanQuestion, 'radio', radioOptions);
                if (aiAnswer) {
                  const aiLower = aiAnswer.toLowerCase().trim();
                  for (let radio of radioInputs) {
                    const lab = fieldset.querySelector(`label[for="${radio.id}"]`);
                    const labText = (lab ? lab.textContent : '').trim().toLowerCase();
                    if (labText === aiLower || labText.includes(aiLower) || aiLower.includes(labText)) {
                      if (!radio.checked) {
                        lab ? lab.click() : radio.click();
                        log(`🤖 Radio AI-picked "${labText}" for: ${cleanQuestion.substring(0, 30)}`);
                        answered = true;
                      }
                      break;
                    }
                  }
                }
              }
            }

            // If no specific answer found, look for "Yes" as default (backward compatibility)
            if (!answered) {
              for (let radio of radioInputs) {
                const radioLabel = fieldset.querySelector(`label[for="${radio.id}"]`);
                const radioText = radioLabel ? radioLabel.textContent.trim().toLowerCase() : '';

                // Yes in multiple languages: EN, FR, ES, DE, IT
                if (radioText.match(/^(yes|oui|sí|si|ja|y)$/)) {
                  if (!radio.checked) {
                    radioLabel ? radioLabel.click() : radio.click();
                    log(`Radio Yes (default): ${questionText.substring(0, 30)}`);
                    answered = true;
                  }
                  break;
                }
              }
            }

            // If still no answer, check first option as last resort
            if (!answered && radioInputs.length > 0 && !radioInputs[0].checked) {
              const firstLabel = fieldset.querySelector(`label[for="${radioInputs[0].id}"]`);
              firstLabel ? firstLabel.click() : radioInputs[0].click();
              log(`Radio first option: ${questionText.substring(0, 30)}`);
            }
          }

          // 5. DROPDOWN/SELECT (Python ligne 661)
          const selects = modal.querySelectorAll('select');
          for (let select of selects) {
            if (select.selectedIndex > 0) continue; // Skip si déjà sélectionné

            // Get label from multiple sources
            let labelText = '';
            labelText += ' ' + (select.getAttribute('aria-label') || '');
            labelText += ' ' + (select.getAttribute('name') || '');
            const selectId = select.getAttribute('id');
            if (selectId) {
              const labelEl = modal.querySelector(`label[for="${selectId}"]`);
              if (labelEl) labelText += ' ' + labelEl.textContent;
            }
            const parentLabel = select.closest('label');
            if (parentLabel) labelText += ' ' + parentLabel.textContent;

            const label = labelText.toLowerCase();
            const options = Array.from(select.options);

            // Essayer de trouver une option intelligente
            let selectedOption = null;

            // Language proficiency questions (English, French, Spanish, etc.)
            // "What is your level of proficiency in English?"
            if (label.match(/proficiency|level.*english|level.*french|level.*spanish|level.*german|niveau.*anglais|niveau.*français|nivel.*inglés/)) {
              // Priority order: Native > Fluent > Professional > Intermediate
              selectedOption = options.find(opt => {
                const text = opt.text.toLowerCase();
                return text.includes('native') || text.includes('bilingual') || text.includes('bilingue') || text.includes('langue maternelle');
              });

              if (!selectedOption) {
                selectedOption = options.find(opt => {
                  const text = opt.text.toLowerCase();
                  return text.includes('fluent') || text.includes('courant') || text.includes('fluide');
                });
              }

              if (!selectedOption) {
                selectedOption = options.find(opt => {
                  const text = opt.text.toLowerCase();
                  return text.includes('professional') || text.includes('professionnel') || text.includes('advanced');
                });
              }

              log(`Dropdown language proficiency: ${selectedOption ? selectedOption.text : 'fallback'}`);
            }
            // General language questions
            else if (label.match(/english|anglais|language|langue|french|français|spanish|español|german|deutsch/)) {
              selectedOption = options.find(opt => {
                const text = opt.text.toLowerCase();
                return text.includes('native') || text.includes('bilingual') || text.includes('fluent') ||
                       text.includes('courant') || text.includes('professionnel') || text.includes('bilingue');
              });
              log(`Dropdown language: ${selectedOption ? selectedOption.text : 'fallback'}`);
            }

            // AI FALLBACK: ask LLM to choose
            if (!selectedOption && options.length > 1) {
              const optionTexts = options.map(o => o.text.trim()).filter(t => t && !/^(select|choose|choisir|please)/i.test(t));
              const cleanQuestion = labelText.replace(/\s+/g, ' ').trim();
              if (optionTexts.length > 0 && cleanQuestion) {
                const aiAnswer = await askLLM(cleanQuestion, 'select', optionTexts);
                if (aiAnswer) {
                  const aiLower = aiAnswer.toLowerCase().trim();
                  selectedOption = options.find(o => {
                    const t = o.text.toLowerCase().trim();
                    return t === aiLower || t.includes(aiLower) || aiLower.includes(t);
                  });
                  if (selectedOption) {
                    log(`🤖 Select AI-picked "${selectedOption.text}" for: ${cleanQuestion.substring(0, 30)}`);
                  }
                }
              }
            }

            // Si pas trouvé, prendre option 1 (pas 0 car souvent "Select...")
            if (!selectedOption && options.length > 1) {
              selectedOption = options[1];
            }

            if (selectedOption) {
              select.value = selectedOption.value;
              select.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }

          // 6. DROPDOWN CUSTOM LINKEDIN (Python ligne 668)
          const customDropdowns = modal.querySelectorAll('button[aria-haspopup="listbox"], button.artdeco-dropdown__trigger');
          for (let dropdown of customDropdowns) {
            // Get label/question text for smart selection
            let questionText = '';
            questionText += ' ' + (dropdown.getAttribute('aria-label') || '');
            questionText += ' ' + (dropdown.textContent || '');

            // Look for associated label
            const dropdownId = dropdown.getAttribute('id');
            if (dropdownId) {
              const labelEl = modal.querySelector(`label[for="${dropdownId}"]`);
              if (labelEl) questionText += ' ' + labelEl.textContent;
            }
            const parentDiv = dropdown.closest('div[class*="form-component"]');
            if (parentDiv) {
              const label = parentDiv.querySelector('label, legend, span[class*="label"]');
              if (label) questionText += ' ' + label.textContent;
            }

            const question = questionText.toLowerCase();

            // Cliquer pour ouvrir
            dropdown.click();
            await wait(500);

            // Chercher les options
            const listbox = document.querySelector('[role="listbox"]');
            if (listbox) {
              const options = Array.from(listbox.querySelectorAll('[role="option"]'));
              if (options.length > 0) {
                let selectedOption = null;

                // Language proficiency questions
                if (question.match(/proficiency|level.*english|level.*french|level.*spanish|niveau.*anglais|nivel.*inglés/)) {
                  // Try: Native/Bilingual first
                  selectedOption = options.find(opt => {
                    const text = opt.textContent.toLowerCase();
                    return text.includes('native') || text.includes('bilingual') || text.includes('bilingue');
                  });

                  // Then: Fluent
                  if (!selectedOption) {
                    selectedOption = options.find(opt => {
                      const text = opt.textContent.toLowerCase();
                      return text.includes('fluent') || text.includes('courant');
                    });
                  }

                  // Then: Professional
                  if (!selectedOption) {
                    selectedOption = options.find(opt => {
                      const text = opt.textContent.toLowerCase();
                      return text.includes('professional') || text.includes('professionnel') || text.includes('advanced');
                    });
                  }

                  log(`Custom dropdown language: ${selectedOption ? selectedOption.textContent.substring(0, 30) : 'fallback'}`);
                }

                // AI FALLBACK: let LLM pick best option from the list
                if (!selectedOption) {
                  const optionTexts = options
                    .map(o => o.textContent.trim())
                    .filter(t => t && !/^(select|choose|choisir|please)/i.test(t));
                  const cleanQuestion = questionText.replace(/\s+/g, ' ').trim();
                  if (optionTexts.length > 0 && cleanQuestion) {
                    const aiAnswer = await askLLM(cleanQuestion, 'select', optionTexts);
                    if (aiAnswer) {
                      const aiLower = aiAnswer.toLowerCase().trim();
                      selectedOption = options.find(o => {
                        const t = o.textContent.toLowerCase().trim();
                        return t === aiLower || t.includes(aiLower) || aiLower.includes(t);
                      });
                      if (selectedOption) {
                        log(`🤖 Custom dropdown AI-picked "${selectedOption.textContent.trim().substring(0, 30)}" for: ${cleanQuestion.substring(0, 30)}`);
                      }
                    }
                  }
                }

                // If no smart match, take first valid option (not "Select...")
                if (!selectedOption) {
                  selectedOption = options.find(opt =>
                    !opt.textContent.toLowerCase().includes('select') &&
                    !opt.textContent.toLowerCase().includes('choose') &&
                    !opt.textContent.toLowerCase().includes('choisir')
                  );
                }

                if (selectedOption) {
                  selectedOption.click();
                  log(`Dropdown custom: ${selectedOption.textContent.substring(0, 30)}`);
                  await wait(300);
                }
              }
            }
          }

          await wait(1500);

          // Locale-independent: detect primary step button via LinkedIn's
          // internal data-attrs (not translated) with text fallback.
          const stepBtn = findModalStepButton(modal);
          if (!stepBtn) {
            log('Pas de bouton trouvé');
            break;
          }
          const nextBtn = stepBtn.btn;
          const isSubmit = stepBtn.type === 'submit';

          // IMPORTANT: Unfollow AVANT de cliquer Submit (Python ligne 1974)
          if (isSubmit) {
            log('Avant Submit: unfollow entreprise...');

            // Scroll vers le bas de la modale pour voir la checkbox
            nextBtn.scrollIntoView({ block: 'end', behavior: 'smooth' });
            await wait(800);

            // Chercher checkbox Follow company (Python ligne 1319)
            const followCheckbox = modal.querySelector('input[id="follow-company-checkbox"]') ||
                                  modal.querySelector('input[id*="follow-company"][type="checkbox"]');

            if (followCheckbox && followCheckbox.checked) {
              // Scroll vers la checkbox
              followCheckbox.scrollIntoView({ block: 'center', behavior: 'smooth' });
              await wait(500);

              // Cliquer sur le label (Python ligne 1321)
              const label = modal.querySelector(`label[for="${followCheckbox.id}"]`);
              if (label) {
                await click(label);
                log('✅ Entreprise UNFOLLOWED');
              } else {
                followCheckbox.click();
                log('✅ Entreprise UNFOLLOWED (fallback)');
              }
            } else {
              log('Checkbox Follow déjà décochée ou non trouvée');
            }

            await wait(500);
          }

          // Vérifier que le bouton n'est pas disabled — RETRY rather than instant discard
          if (nextBtn.disabled || nextBtn.getAttribute('aria-disabled') === 'true') {
            disabledRetries++;
            log(`⚠️ Next button disabled (retry ${disabledRetries}/${MAX_DISABLED_RETRIES}) on step ${step}`);

            if (disabledRetries >= MAX_DISABLED_RETRIES) {
              log('❌ Next button still disabled after all retries — DISCARDING');
              log('   Likely cause: a required field could not be filled. Check AI settings / API key / model.');
              await discardApplication();
              skippedCount++;
              updateSkippedCount();
              break;
            }

            // Wait longer + give the fill pass another chance (loop continues, fills again)
            await wait(2000);
            updateActivity();
            continue;
          }
          disabledRetries = 0; // reset on successful click attempt

          await click(nextBtn);

          // Attendre que la page change
          await wait(1000); // Optimized page change wait

          // Vérifier si vraiment passé à l'étape suivante (post-click validation)
          const stillSameModal = document.querySelector('.jobs-easy-apply-modal');
          if (stillSameModal && !isSubmit) {
            const errorMessages = [
              '[role="alert"]',
              '.artdeco-inline-feedback--error',
              '.fb-form-element-label__error'
            ];

            let postClickErrorSeen = false;
            let postClickErrorText = '';
            for (let selector of errorMessages) {
              const errors = stillSameModal.querySelectorAll(selector);
              for (let error of errors) {
                if (error.offsetParent !== null && error.textContent.trim()) {
                  // Locale-independent: presence of a visible error element
                  // is the signal; text content varies by UI language.
                  postClickErrorSeen = true;
                  postClickErrorText = error.textContent.substring(0, 60);
                  break;
                }
              }
              if (postClickErrorSeen) break;
            }

            if (postClickErrorSeen) {
              validationRetries++;
              log(`⚠️ Post-click validation error (retry ${validationRetries}/${MAX_VALIDATION_RETRIES}): ${postClickErrorText}`);
              if (validationRetries >= MAX_VALIDATION_RETRIES) {
                log('❌ Validation error persists after retries — DISCARDING');
                await discardApplication();
                skippedCount++;
                updateSkippedCount();
                step = 999;
                break;
              }
              // Don't break — let next iteration's fill pass try again
              await wait(1500);
              continue;
            }
          }

          if (isSubmit) {
            log('✅ Submit cliqué !');
            appliedCount++;

            // Sauvegarder le job appliqué pour export
            appliedJobs.push({
              title: jobTitle,
              company: jobCompany,
              link: jobLink,
              date: new Date().toISOString()
            });
            updateAppliedCount();
            saveAppliedJobsToStorage();

            // OPTIMIZED: Check modal status immediately after Submit
            log('🔍 Checking if modal closed after Submit...');
            await wait(1000); // Short wait to let page process

            // OPTIMIZATION: Check if modal already closed (means application is complete)
            let modalCheck = document.querySelector('.jobs-easy-apply-modal, [role="dialog"], .artdeco-modal');
            if (!modalCheck || modalCheck.offsetParent === null) {
              log('✅ Modal closed immediately - Application completed!');
              updateActivity();

              // Skip all waiting - application is done
              log('--- End of job processing, moving to next ---');
              await wait(500); // Ultra optimized wait before next job
              break;
            }

            // Modal still open - need to find Done button
            log('⏳ Modal still open, searching for Done button...');
            await wait(1000); // Optimized Done button wait

            // Use improved Done button finder
            const result = await findAndClickDoneButton(document, 'Main Modal', 15);

            if (!result.clicked) {
              log('⚠️ Done button not found, checking modal status...');
              const modal = document.querySelector('.jobs-easy-apply-modal');
              if (modal && modal.offsetParent !== null) {
                log('⚠️ Modal still open, trying to close it...');
                await discardApplication();
              } else {
                log('✅ Modal closed during search');
              }
            }

            // Final check: is there an "Application sent" modal?
            await wait(1500);
            let sentModal = document.querySelector('.jobs-easy-apply-modal, [role="dialog"], .artdeco-modal');
            if (sentModal && sentModal.offsetParent !== null) {
              log('📨 "Application sent" modal detected, clicking Done...');
              const sentResult = await findAndClickDoneButton(sentModal, 'Application Sent Modal', 8);

              if (!sentResult.clicked) {
                log('⚠️ Done button not found in sent modal, forcing discard');
                await discardApplication();
              }
            }

            // Application completed
            log('✅ Application completed, moving to next job');
            log('--- End of job processing ---');
            await wait(500); // Ultra optimized wait before next job
            break;
          }
        }
      }

      // Check if bot was stopped during job processing (e.g., daily limit reached)
      if (!isRunning) {
        log('🛑 Bot stopped during job processing - Exiting main loop');
        break; // Exit the while loop
      }

      // Page suivante (Python ligne 2047) - IMPROVED WITH FALLBACKS
      log('🔍 Recherche page suivante...');
      let nextPageClicked = false;

      // COLLECTIONS PAGE: Use infinite scroll instead of pagination
      if (isCollectionsPage) {
        log('📜 Collections page - using infinite scroll');

        // Get the job list container
        const jobListContainer = document.querySelector('.jobs-search-results-list, .scaffold-layout__list-container, .jobs-search-results__list');

        if (jobListContainer) {
          const currentJobCount = jobCards.length;

          // Scroll to bottom to trigger loading more jobs
          jobListContainer.scrollTo({ top: jobListContainer.scrollHeight, behavior: 'smooth' });
          window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });

          log('📜 Scrolled down to load more jobs...');
          await wait(2000);

          // Check if new jobs were loaded
          const newJobCount = document.querySelectorAll('li[data-occludable-job-id], .jobs-search-results__list-item, .scaffold-layout__list-item').length;

          if (newJobCount > currentJobCount) {
            log(`✅ Loaded ${newJobCount - currentJobCount} more jobs (total: ${newJobCount})`);
            nextPageClicked = true;
          } else {
            log('📋 No more jobs to load (reached end of collection)');
          }
        }
      }

      // SEARCH PAGE: Use standard pagination
      // METHOD 1: Try pagination by page number
      const pagination = document.querySelector('.jobs-search-pagination__pages');
      if (!nextPageClicked) {
        if (pagination) {
          const activeBtn = pagination.querySelector('button.active, button[aria-current="true"], li.active button, li.selected button');
          if (activeBtn) {
            const currentPage = parseInt(activeBtn.textContent);
            log(`📄 Page actuelle: ${currentPage}`);

            // Try to find next page button
            const nextPageBtn = pagination.querySelector(`button[aria-label="Page ${currentPage + 1}"]`) ||
                               pagination.querySelector(`button[data-test-pagination-page-btn="${currentPage + 1}"]`);

            if (nextPageBtn && nextPageBtn.offsetParent !== null) {
              log(`✅ Clique sur page ${currentPage + 1}`);
              await click(nextPageBtn);
              await wait(1000); // Ultra optimized page load wait
              nextPageClicked = true;
            }
          }
        }
      }

      // METHOD 2: Try "Next" button (fallback)
      if (!nextPageClicked) {
        log('🔍 Recherche bouton "Next"...');
        const nextButtons = Array.from(document.querySelectorAll('button, [role="button"]'));

        for (let btn of nextButtons) {
          if (!btn.offsetParent) continue; // Skip hidden

          const btnText = btn.textContent.trim().toLowerCase();
          const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();

          // Check for "Next" in multiple languages
          if (btnText === 'next' || btnText === 'suivant' || btnText === 'siguiente' ||
              ariaLabel.includes('next') || ariaLabel.includes('suivant')) {

            // Make sure it's the pagination next, not a form next
            const isPaginationNext = btn.closest('.jobs-search-pagination') ||
                                    btn.closest('[class*="pagination"]') ||
                                    btn.getAttribute('aria-label')?.includes('page');

            if (isPaginationNext) {
              log('✅ Clique sur bouton Next');
              await click(btn);
              await wait(1000); // Ultra optimized page load wait
              nextPageClicked = true;
              break;
            }
          }
        }
      }

      // METHOD 3: Try icon-based next button (LinkedIn uses icons)
      if (!nextPageClicked) {
        const iconNextBtn = document.querySelector('.jobs-search-pagination button[aria-label*="Next"], .jobs-search-pagination button svg[class*="chevron-right"]')?.closest('button');
        if (iconNextBtn && iconNextBtn.offsetParent !== null && !iconNextBtn.disabled) {
          log('✅ Clique sur bouton Next (icône)');
          await click(iconNextBtn);
          await wait(1000); // Ultra optimized page load wait
          nextPageClicked = true;
        }
      }

      // METHOD 4: Newer LinkedIn — .artdeco-pagination wrapper
      if (!nextPageClicked) {
        const artdecoNext = document.querySelector(
          'button.artdeco-pagination__button--next, ' +
          '.artdeco-pagination button[aria-label*="Next"], ' +
          '.artdeco-pagination button[aria-label*="next"], ' +
          '.artdeco-pagination button[aria-label*="suivant"]'
        );
        if (artdecoNext && artdecoNext.offsetParent !== null && !artdecoNext.disabled) {
          log('✅ Clique sur bouton Next (.artdeco-pagination)');
          await click(artdecoNext);
          await wait(1500);
          nextPageClicked = true;
        }
      }

      // METHOD 5: Last resort — scroll the results list to trigger infinite-scroll loading
      if (!nextPageClicked) {
        log('🔍 No pagination found, trying infinite scroll on results list...');
        const beforeCount = document.querySelectorAll('li[data-occludable-job-id], li.scaffold-layout__list-item, div.job-card-container').length;
        const scrollContainer =
          document.querySelector('.jobs-search-results-list, .scaffold-layout__list-container, .jobs-search-results__list, main') ||
          document.scrollingElement;
        if (scrollContainer) {
          scrollContainer.scrollTop = scrollContainer.scrollHeight;
          window.scrollTo(0, document.body.scrollHeight);
          await wait(2500);
          const afterCount = document.querySelectorAll('li[data-occludable-job-id], li.scaffold-layout__list-item, div.job-card-container').length;
          if (afterCount > beforeCount) {
            log(`✅ Infinite scroll loaded ${afterCount - beforeCount} more jobs (total: ${afterCount})`);
            nextPageClicked = true;
          }
        }
      }

      if (nextPageClicked) {
        log('✅ Passage à la page suivante réussi');
        updateActivity();
        continue;
      } else {
        log('📋 Fin des pages - Aucune page suivante trouvée');
        log(`   Final URL: ${location.href}`);
        log(`   Tip: if there were more jobs you expected, LinkedIn may have changed pagination DOM; report this log.`);
        break;
      }

    } catch (error) {
      log(`Erreur: ${error.message}`);
      await wait(1500); // Optimized error wait
    }
  }

  log('Arrêt');
}

// Vérifier si le job contient des mots blacklistés
function shouldSkipByBlacklist(title, company, description, blacklistKeywords) {
  if (!blacklistKeywords || blacklistKeywords.trim() === '') return false;

  // Parse keywords (comma-separated)
  const keywords = blacklistKeywords.toLowerCase().split(',').map(k => k.trim()).filter(k => k);
  if (keywords.length === 0) return false;

  // Combine all job text
  const jobText = (title + ' ' + company + ' ' + description).toLowerCase();

  // Check each keyword
  for (let keyword of keywords) {
    if (jobText.includes(keyword)) {
      log(`⏭️ Skip (Blacklist): "${keyword}" found in job`);
      log(`   Title: ${title.substring(0, 50)}`);
      return true;
    }
  }

  return false;
}

// Collect the human-readable question label for an input/textarea/select.
function _collectLabelFor(el, modal) {
  let labelText = '';
  labelText += ' ' + (el.getAttribute('aria-label') || '');
  labelText += ' ' + (el.getAttribute('name') || '');
  const id = el.getAttribute('id');
  if (id) {
    const labelEl = modal.querySelector(`label[for="${id}"]`);
    if (labelEl) labelText += ' ' + labelEl.textContent;
  }
  const parentLabel = el.closest('label');
  if (parentLabel) labelText += ' ' + parentLabel.textContent;
  return labelText.replace(/\s+/g, ' ').trim();
}

// Detect numeric-intent for an input (even when type=text)
function _detectNumericIntent(input, cleanQuestion) {
  return input.type === 'number' ||
         input.getAttribute('inputmode') === 'numeric' ||
         /\b(numeric|number)\b/.test(input.getAttribute('pattern') || '') ||
         /(whole\s+number|how\s+many|how\s+much|number\s+between|enter\s+a\s+number|years?\b|nombre|combien|cuántos|wieviel|quanti)/i.test(cleanQuestion);
}

// Build the min/max suffix appended to the question for numeric fields
function _detectRangeSuffix(input, cleanQuestion) {
  const rangeMatch = cleanQuestion.match(/between\s+(\d+)\s+and\s+(\d+)/i);
  if (rangeMatch) return ` Answer must be between ${rangeMatch[1]} and ${rangeMatch[2]}.`;
  const minAttr = input.getAttribute('min');
  const maxAttr = input.getAttribute('max');
  if (minAttr || maxAttr) return ` Answer must be between ${minAttr || 0} and ${maxAttr || 99}.`;
  return '';
}

// Return true if question matches one of the hardcoded fast-path rules (no AI needed)
function _matchesHardcodedRule(cleanQuestion) {
  const label = cleanQuestion.toLowerCase();
  if (label.match(/(years?|yrs?|années?|años|jahre|anni)\b/) && !label.match(/with|in|of|avec|en|dans|with the|with our/)) return true;
  if (label.match(/salary|compensation|remuneration|salaire|rémunération|sueldo|salario|gehalt|stipendio/)) return true;
  if (label.match(/email|e-mail|courriel|correo/)) return true;
  if (label.match(/first|prénom|prenom|nombre|vorname|nome/)) return true;
  if (label.match(/last|nom|apellido|nachname|cognome/)) return true;
  if (label.match(/phone|téléphone|telefono|telefon|mobile|portable|cell|móvil|cellulare/)) return true;
  if (label.match(/city|ville|ciudad|stadt|città|location|localisation|ubicación|standort/)) return true;
  return false;
}

// PREFETCH: walk the modal and batch-ask LLM for all AI-needed answers BEFORE the fill pass.
// Populates the per-question cache so the fill pass becomes free cache hits = 1 API call total per step.
async function prefetchAIQuestions(modal) {
  if (!config?.aiEnabled) return;
  if (!modal) return;
  const items = [];

  // Text/number/tel/email inputs (skip those handled by hardcoded rules)
  const textInputs = modal.querySelectorAll('input[type="text"], input[type="number"], input[type="tel"], input[type="email"]');
  for (const input of textInputs) {
    if (input.value && input.value.trim()) continue;
    const cleanQuestion = _collectLabelFor(input, modal);
    if (!cleanQuestion) continue;
    if (_matchesHardcodedRule(cleanQuestion)) continue;
    const isNumeric = _detectNumericIntent(input, cleanQuestion);
    const minMax = isNumeric ? _detectRangeSuffix(input, cleanQuestion) : '';
    items.push({
      question: cleanQuestion + minMax,
      fieldType: isNumeric ? 'number' : 'text',
      options: []
    });
  }

  // Textareas (always AI-needed)
  const textareas = modal.querySelectorAll('textarea');
  for (const ta of textareas) {
    if (ta.value && ta.value.trim()) continue;
    const cleanQuestion = _collectLabelFor(ta, modal);
    if (!cleanQuestion) continue;
    items.push({ question: cleanQuestion, fieldType: 'textarea', options: [] });
  }

  // Radios — fallback when hardcoded keyword rules don't match
  const radioFieldsets = modal.querySelectorAll('fieldset[data-test-form-builder-radio-button-form-component]');
  for (const fs of radioFieldsets) {
    const radioInputs = fs.querySelectorAll('input[type="radio"]');
    // Skip if any radio already selected
    if (Array.from(radioInputs).some(r => r.checked)) continue;
    const questionLabel = fs.querySelector('legend, span[class*="title"]');
    const qText = questionLabel ? questionLabel.textContent.toLowerCase() : '';
    if (!qText) continue;
    // Skip if hardcoded rule will handle (visa, work auth, relocate, clearance, license)
    if (qText.match(/visa|sponsor|sponsorship|author|legal.*work|permit.*work|eligib.*work|right.*work|relocat|move.*locat|willing.*move|security.*clearance|clearance|driver.*license|driving.*license|valid.*license/i)) continue;
    const optTexts = Array.from(radioInputs).map(r => {
      const lab = fs.querySelector(`label[for="${r.id}"]`);
      return (lab ? lab.textContent : r.value || '').trim();
    }).filter(t => t);
    if (optTexts.length === 0) continue;
    items.push({ question: questionLabel.textContent.replace(/\s+/g, ' ').trim(), fieldType: 'radio', options: optTexts });
  }

  // Native <select> dropdowns — skip if hardcoded language rule will handle
  const selects = modal.querySelectorAll('select');
  for (const sel of selects) {
    if (sel.selectedIndex > 0) continue;
    const cleanQuestion = _collectLabelFor(sel, modal);
    if (!cleanQuestion) continue;
    const ql = cleanQuestion.toLowerCase();
    if (ql.match(/proficiency|level.*english|level.*french|level.*spanish|level.*german|niveau.*anglais|niveau.*français|nivel.*inglés|english|anglais|language|langue|french|français|spanish|español|german|deutsch/)) continue;
    const optTexts = Array.from(sel.options).map(o => o.text.trim()).filter(t => t && !/^(select|choose|choisir|please)/i.test(t));
    if (optTexts.length === 0) continue;
    items.push({ question: cleanQuestion, fieldType: 'select', options: optTexts });
  }

  if (items.length === 0) return;

  log(`🚀 Prefetching ${items.length} AI answers in 1 batched call (saves ${items.length - 1} requests)`);
  updateActivity();
  const ticker = setInterval(() => updateActivity(), 5000);

  try {
    const resp = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'askLLMBatch', items }, (r) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(r);
        }
      });
      // Generous timeout for batch (model has to write all answers)
      setTimeout(() => resolve({ ok: false, error: 'batch timeout' }), 90000);
    });
    updateActivity();
    if (resp?.ok) {
      log(`✅ Batch prefetched: ${resp.prefetched} new, ${resp.fromCache} from cache, ${resp.skipped} skipped`);
    } else {
      log(`⚠️ Batch prefetch failed (${resp?.error}) — will fall through to per-field calls`);
    }
  } catch (err) {
    log(`⚠️ Batch prefetch exception: ${err.message}`);
  } finally {
    clearInterval(ticker);
  }
}

// Ask the AI fallback (OpenRouter via background) for a field answer.
// Returns the answer string, or null on disabled/error.
// fieldType: 'text' | 'textarea' | 'number' | 'radio' | 'select'
// options: array of strings (for radio/select). Ignored for text/textarea/number.
async function askLLM(question, fieldType, options) {
  if (!config?.aiEnabled) return null;
  if (!question || !question.trim()) return null;

  // Tick activity to prevent stuck-watchdog from firing during LLM wait
  updateActivity();
  // Also tick periodically while waiting (LLM can take 10-20s)
  const ticker = setInterval(() => updateActivity(), 5000);

  try {
    const resp = await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { action: 'askLLM', question, fieldType, options: options || [] },
        (r) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(r);
          }
        }
      );
      // Hard timeout safety net (LLM should respond in 5-15s)
      setTimeout(() => resolve({ ok: false, error: 'timeout' }), 30000);
    });

    updateActivity(); // tick again after response

    if (resp?.ok && resp.answer) {
      log(`🤖 AI ${resp.fromCache ? '(cached)' : ''} answered "${question.substring(0, 50)}" → "${(resp.answer || '').substring(0, 50)}"`);
      return resp.answer;
    }
    if (resp?.ok && !resp.answer) {
      log(`⚠️ AI returned empty answer for "${question.substring(0, 50)}" — leaving blank`);
      return null;
    }
    log(`⚠️ AI fallback failed: ${resp?.error || 'unknown'}`);
    return null;
  } catch (err) {
    log(`⚠️ AI fallback exception: ${err.message}`);
    return null;
  } finally {
    clearInterval(ticker);
  }
}

// Whitelist: skip job if its title does NOT contain at least one whitelist keyword.
// Empty/missing whitelist = disabled (apply to all that pass blacklist).
function shouldSkipByWhitelist(title, whitelistKeywords) {
  if (!whitelistKeywords || whitelistKeywords.trim() === '') return false;

  const keywords = whitelistKeywords.toLowerCase().split(',').map(k => k.trim()).filter(k => k);
  if (keywords.length === 0) return false;

  const titleLower = (title || '').toLowerCase();
  // Title extraction failed entirely — let it through rather than skip everything.
  // The pipeline still has blacklist + Easy Apply detection to filter junk.
  if (!titleLower) {
    log(`⚠️ Whitelist check: title empty, allowing job through (extraction failed for this card layout)`);
    return false;
  }

  const hit = keywords.some(k => titleLower.includes(k));
  if (!hit) {
    log(`⏭️ Skip (Whitelist): no match in title "${title.substring(0, 60)}"`);
    log(`   Wanted any of: ${keywords.join(', ')}`);
    return true;
  }
  return false;
}

// Broad title extraction — tries multiple selectors + falls back to aria-label parsing
function extractJobTitle(jobCard) {
  // Selector cascade
  const titleSelectors = [
    '.job-card-list__title',
    '.job-card-list__title--link',
    '.artdeco-entity-lockup__title a',
    '.artdeco-entity-lockup__title',
    '.job-card-container__link strong',
    '.job-card-container__link',
    'a[class*="job-card"] strong',
    'a.job-card-list__title',
    'a[data-control-name="job_card_click"]'
  ];
  for (const sel of titleSelectors) {
    const el = jobCard.querySelector(sel);
    const text = el?.textContent?.trim();
    if (text) return text;
    // aria-label sometimes carries the title even when textContent is empty
    const aria = el?.getAttribute?.('aria-label')?.trim();
    if (aria) return aria.split(/\s+at\s+|\s+chez\s+/i)[0].trim();
  }
  // Last resort: any anchor pointing at /jobs/view/
  const anchor = jobCard.querySelector('a[href*="/jobs/view/"]');
  if (anchor) {
    const aria = anchor.getAttribute('aria-label')?.trim();
    if (aria) {
      // LinkedIn often uses "View [Title] at [Company]" or just "[Title]"
      const cleaned = aria.replace(/^view\s+/i, '').split(/\s+at\s+|\s+chez\s+/i)[0].trim();
      if (cleaned) return cleaned;
    }
    const txt = anchor.textContent?.trim();
    if (txt) return txt.split('\n')[0].trim();
  }
  return '';
}

function extractJobCompany(jobCard) {
  const selectors = [
    '.job-card-container__primary-description',
    '.artdeco-entity-lockup__subtitle',
    '.artdeco-entity-lockup__caption',
    '.job-card-container__company-name'
  ];
  for (const sel of selectors) {
    const t = jobCard.querySelector(sel)?.textContent?.trim();
    if (t) return t;
  }
  return '';
}

function extractJobDescription(jobCard) {
  const selectors = [
    '.job-card-container__metadata-item',
    '.job-card-list__insight',
    '.job-card-container__metadata-wrapper'
  ];
  for (const sel of selectors) {
    const t = jobCard.querySelector(sel)?.textContent?.trim();
    if (t) return t;
  }
  return '';
}

// Extraire années d'expérience requises du texte (multilingue)
function extractYearsRequired(text) {
  if (!text) return 0;

  const lowerText = text.toLowerCase();

  // Patterns multilingues pour années d'expérience
  const patterns = [
    // English: "5+ years", "5-8 years", "5 years"
    /(\d+)\+?\s*(?:years?|yrs?)/gi,
    // French: "5 ans", "5+ ans", "5 années"
    /(\d+)\+?\s*(?:ans?|années?)/gi,
    // Spanish: "5 años"
    /(\d+)\+?\s*años?/gi,
    // German: "5 Jahre"
    /(\d+)\+?\s*jahre?/gi,
    // Italian: "5 anni"
    /(\d+)\+?\s*anni?/gi
  ];

  const years = [];
  patterns.forEach(pattern => {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      const num = parseInt(match[1]);
      if (num > 0 && num <= 20) years.push(num);
    }
  });

  return years.length > 0 ? Math.max(...years) : 0;
}

// Vérifier si le job doit être skippé selon années requises
function shouldSkipByExperience(jobCard, maxYearsRequired) {
  if (!maxYearsRequired || maxYearsRequired <= 0) return false;

  try {
    // Chercher dans le titre et la description visible
    const title = jobCard.querySelector('.job-card-list__title, .artdeco-entity-lockup__title')?.textContent || '';
    const subtitle = jobCard.querySelector('.job-card-container__metadata-item')?.textContent || '';
    const combinedText = title + ' ' + subtitle;

    const yearsRequired = extractYearsRequired(combinedText);

    if (yearsRequired > 0 && yearsRequired > maxYearsRequired) {
      log(`⏭️ Skip: ${yearsRequired}+ years required (max: ${maxYearsRequired})`);
      return true;
    }
  } catch (error) {
    // Si erreur, ne pas skipper
  }

  return false;
}

// Fonction pour détecter si la page charge lentement (Python ligne 1440-1479)
async function isPageLoadingSlow() {
  try {
    // Check document readyState (Python ligne 1446)
    if (document.readyState !== 'complete') {
      log(`⏳ Page still loading (readyState: ${document.readyState})`);
      return true;
    }

    // Chercher des spinners/loaders visibles (Python ligne 1517-1528)
    const spinners = document.querySelectorAll('[role="progressbar"], .artdeco-loader, .loading-spinner, .spinner, .loading');
    for (let spinner of spinners) {
      if (spinner.offsetParent !== null) { // Visible
        return true;
      }
    }

    // Vérifier si la modal est visible (Python ligne 1466-1469)
    const modal = document.querySelector('.jobs-easy-apply-modal');
    if (!modal || !modal.offsetParent) {
      return true; // Modal pas visible = en chargement
    }

    return false;
  } catch (error) {
    return true; // Assume slow loading on error (Python ligne 1477)
  }
}

// Fonction pour détecter si popup de chargement est BLOQUÉ (Python ligne 1513-1545)
function checkForStuckLoadingPopup() {
  try {
    // Chercher les spinners/loaders de LinkedIn (Python ligne 1517-1528)
    const loadingIndicators = document.querySelectorAll(
      '.artdeco-loader, .loading, .spinner, [role="progressbar"]'
    );

    if (loadingIndicators.length > 0) {
      for (let indicator of loadingIndicators) {
        if (indicator.offsetParent !== null) { // Visible
          log('⚠️ POPUP DE CHARGEMENT DÉTECTÉ ET VISIBLE!');
          return true;
        }
      }
    }

    // Vérifier aussi si le modal est figé (pas de boutons cliquables) (Python ligne 1531-1540)
    const modal = document.querySelector('.jobs-easy-apply-modal');
    if (modal && modal.offsetParent !== null) {
      const buttons = modal.querySelectorAll('button');
      const clickableButtons = Array.from(buttons).filter(b =>
        !b.disabled && b.offsetParent !== null
      );

      if (clickableButtons.length === 0) {
        log('⚠️ MODAL FIGÉ DÉTECTÉ (aucun bouton cliquable)!');
        return true;
      }
    }

    return false;
  } catch (error) {
    log(`⚠️ Erreur lors de la vérification du popup: ${error.message}`);
    return false;
  }
}

// Mettre à jour le compteur appliqués
function updateAppliedCount() {
  // A successful application means we're not currently throttled — reset
  // the cooldown retry counter so a future throttle starts at the shortest
  // backoff instead of escalating from the last cooldown.
  chrome.storage.local.set({ appliedCount: appliedCount, cooldownRetries: 0 });
  try {
    chrome.runtime.sendMessage({ type: 'updateCount', count: appliedCount });
  } catch (e) {}
}

// Mettre à jour le compteur skipped
function updateSkippedCount() {
  chrome.storage.local.set({ skippedCount: skippedCount });
  try {
    chrome.runtime.sendMessage({ type: 'updateSkippedCount', count: skippedCount });
  } catch (e) {}
}

// Sauvegarder les jobs appliqués dans le storage
function saveAppliedJobsToStorage() {
  chrome.storage.local.set({ appliedJobs: appliedJobs });
}

// Écouter les messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Handle async operations properly
  (async () => {
    try {
      if (request.action === 'start') {
        config = await chrome.storage.sync.get([
          'firstName', 'lastName', 'email', 'phone', 'phoneCountryCode',
          'yearsOfExperience', 'maxYearsRequired', 'blacklistKeywords', 'city', 'country', 'expectedSalary',
          'visaSponsorship', 'legallyAuthorized', 'willingToRelocate', 'driversLicense',
          'whitelistKeywords', 'aiEnabled', 'openrouterApiKey', 'openrouterModel'
        ]);

        // Charger les compteurs depuis storage
        const local = await chrome.storage.local.get(['appliedCount', 'skippedCount', 'appliedJobs', 'resumeFile', 'resumeFileName', 'resumeFileType']);
        appliedCount = local.appliedCount || 0;
        skippedCount = local.skippedCount || 0;
        appliedJobs = local.appliedJobs || [];

        // Load resume data if available
        resumeFile = local.resumeFile || null;
        resumeFileName = local.resumeFileName || null;
        resumeFileType = local.resumeFileType || null;

        if (resumeFile) {
          log(`📄 Resume loaded: ${resumeFileName}`);
        } else {
          log('ℹ️ No resume uploaded - file upload fields will be skipped');
        }

        log(`Config: ${config.firstName} ${config.lastName}, exp: ${config.yearsOfExperience || 2}, max required: ${config.maxYearsRequired || 3}`);
        log(`Counters: Applied ${appliedCount}, Skipped ${skippedCount}`);

        // SECURITY: Set both protection flags
        isRunning = true;
        userExplicitlyClickedStart = true; // CRITICAL: Only set when user clicks Start

        log('✅ Bot started by USER');
        log('🔒 Security flags set: isRunning=true, userExplicitlyClickedStart=true');

        // Update storage
        await chrome.storage.local.set({ isRunning: true });

        // Send response before starting main loop
        sendResponse({ success: true, message: 'Bot started' });

        // Notify popup that bot has started
        try {
          chrome.runtime.sendMessage({ type: 'botStarted' });
        } catch (e) {
          // Popup may be closed
        }

        // Start main loop (don't await - let it run in background)
        mainLoop();
      } else if (request.action === 'stop') {
        isRunning = false;
        userExplicitlyClickedStart = false; // Clear security flag
        log('⏸️ Bot stopped by user');
        log('🔒 Security flags cleared: isRunning=false, userExplicitlyClickedStart=false');

        // Update storage
        await chrome.storage.local.set({ isRunning: false });

        sendResponse({ success: true, message: 'Bot stopped' });

        // Notify popup that bot has stopped
        try {
          chrome.runtime.sendMessage({ type: 'botStopped' });
        } catch (e) {
          // Popup may be closed
        }
      } else if (request.action === 'exportJobs') {
        // Exporter les jobs en CSV
        sendResponse({ jobs: appliedJobs });
      } else if (request.action === 'resetCounters') {
        appliedCount = 0;
        skippedCount = 0;
        appliedJobs = [];
        await chrome.storage.local.set({ appliedCount: 0, skippedCount: 0, appliedJobs: [] });
        updateAppliedCount();
        updateSkippedCount();
        sendResponse({ success: true, message: 'Counters reset' });
      } else if (request.action === 'clearAppliedJobs') {
        appliedJobs = [];
        await chrome.storage.local.set({ appliedJobs: [] });
        log('🗑️ Applied jobs list cleared');
        sendResponse({ success: true, message: 'Applied jobs cleared' });
      }
    } catch (error) {
      log(`❌ Message handler error: ${error.message}`);
      sendResponse({ success: false, error: error.message });
    }
  })();

  // Return true to indicate we will send a response asynchronously
  return true;
});

console.log('%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'color: #0a66c2; font-weight: bold;');
console.log('%c🔒 EASYAPPLYMAX v1.5.0 - MANUAL INJECTION MODE', 'color: #0a66c2; font-weight: bold; font-size: 16px;');
console.log('%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'color: #0a66c2; font-weight: bold;');
console.log('%c✅ Script injected ONLY when you clicked START', 'color: green; font-weight: bold;');
console.log('%c🔒 NO automatic loading on LinkedIn pages', 'color: green; font-weight: bold;');
console.log('%c🚀 Bot will start automatically after injection', 'color: orange; font-weight: bold;');
console.log('%c📋 Supports: /jobs/search/ AND /jobs/collections/', 'color: cyan; font-weight: bold;');
console.log('%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'color: #0a66c2; font-weight: bold;');
log('Script loaded v1.5.0 - Supports /jobs/search/ and /jobs/collections/');

// SECURITY: Clear ALL running state on page load to prevent auto-start
// Bot will ONLY start when user explicitly clicks "Start" button.
//
// EXCEPTION: If a cooldown was in flight (LinkedIn rate-limited the bot and we
// scheduled an auto-resume before refreshing), honor it — but only when the
// stored timestamp is fresh and the user had previously clicked Start.
(async () => {
  try {
    // CRITICAL: Clear ALL security flags
    isRunning = false;
    userExplicitlyClickedStart = false;

    // PURGE: Clean any residual running state from storage
    await chrome.storage.local.set({ isRunning: false });

    // Load counters and state for display only (don't start bot)
    const state = await chrome.storage.local.get([
      'appliedCount', 'skippedCount', 'appliedJobs',
      'cooldownPending', 'cooldownStartTime', 'cooldownDuration',
      'cooldownRetries', 'cooldownReason', 'cooldownPrevRunning'
    ]);
    appliedCount = state.appliedCount || 0;
    skippedCount = state.skippedCount || 0;
    appliedJobs = state.appliedJobs || [];

    // ── Cooldown auto-resume path ────────────────────────────────────────────
    const cooldownFresh =
      state.cooldownPending === true &&
      state.cooldownPrevRunning === true &&
      typeof state.cooldownStartTime === 'number' &&
      (Date.now() - state.cooldownStartTime) < COOLDOWN_STALE_MS;

    if (cooldownFresh) {
      const duration = state.cooldownDuration || COOLDOWN_STEPS_MS[0];
      const elapsed = Date.now() - state.cooldownStartTime;
      const remaining = Math.max(0, duration - elapsed);
      const retries = state.cooldownRetries || 1;

      console.log('%c🔄 COOLDOWN RESUME PENDING', 'background: #ff9800; color: white; font-weight: bold; padding: 4px 8px;');
      log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      log(`🔄 Cooldown active (attempt ${retries}/${COOLDOWN_MAX_RETRIES})`);
      log(`   Reason: ${state.cooldownReason || 'unknown'}`);
      log(`   Remaining: ${Math.ceil(remaining / 1000)}s`);
      log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      // Tick popup countdown every second while waiting.
      const tickEnd = Date.now() + remaining;
      const tickInterval = setInterval(() => {
        const secs = Math.max(0, Math.ceil((tickEnd - Date.now()) / 1000));
        try {
          chrome.runtime.sendMessage({
            type: 'cooldownTick',
            remainingSeconds: secs,
            retries
          });
        } catch (_) {}
        if (secs <= 0) clearInterval(tickInterval);
      }, 1000);

      // Wait the remaining cooldown window.
      await new Promise(r => setTimeout(r, remaining));
      clearInterval(tickInterval);

      // Probe: is Easy Apply usable again? Look for any non-disabled
      // Easy Apply button on the page (job detail panel or job cards).
      const probeBtn = findEasyApplyButton(document);
      // Also re-check throttle phrases — if LinkedIn still shows the banner,
      // Easy Apply is still blocked even if a button exists somewhere.
      const stillThrottled = checkRateLimitBlock().blocked;

      if (probeBtn && !stillThrottled) {
        log('✅ Easy Apply available again — resuming automation.');
        isRunning = true;
        userExplicitlyClickedStart = true; // controlled bypass: user had clicked Start before throttle
        await chrome.storage.local.set({
          isRunning: true,
          cooldownPending: false
          // retain cooldownRetries so consecutive throttles escalate the backoff
        });
        try {
          chrome.runtime.sendMessage({
            type: 'cooldownResumed',
            retries
          });
        } catch (_) {}
        log('🔒 Security flags restored (cooldown auto-resume)');
        mainLoop();
        return;
      }

      // Still blocked — escalate via another cooldown+refresh cycle.
      log(`⚠️ Easy Apply still blocked after cooldown (button: ${!!probeBtn}, throttled: ${stillThrottled})`);
      log('   Escalating cooldown and refreshing again...');
      // Preserve the prev-running flag through the next refresh.
      await chrome.storage.local.set({ cooldownPending: false });
      await triggerCooldownAndRefresh(
        stillThrottled ? 'still-throttled-after-cooldown' : 'easy-apply-missing-after-cooldown'
      );
      return;
    }
    // ── End cooldown path ────────────────────────────────────────────────────

    // Clear any stale cooldown state (page loaded without an active cooldown).
    if (state.cooldownPending) {
      await chrome.storage.local.set({
        cooldownPending: false,
        cooldownRetries: 0,
        cooldownPrevRunning: false
      });
    }

    console.log('%c⏸️ BOT STATUS: STOPPED (Waiting for START button)', 'background: #ff9800; color: white; font-weight: bold; padding: 4px 8px; border-radius: 3px;');
    log('ℹ️ Content script loaded - Bot ready (NOT running)');
    log('🔒 Security initialized: isRunning=false, userExplicitlyClickedStart=false');
    log(`📊 Current stats: Applied ${appliedCount}, Skipped ${skippedCount}`);
    log('⏸️ Waiting for user to click START button...');
    console.log('%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'color: #0a66c2; font-weight: bold;');
    console.log('%c⚠️ IF YOU SEE ANY CLICKS WITHOUT CLICKING START:', 'color: red; font-weight: bold;');
    console.log('%c   Check console for 🚨 SECURITY VIOLATION errors', 'color: red; font-weight: bold;');
    console.log('%c   These will show WHERE the unauthorized click came from', 'color: red; font-weight: bold;');
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  } catch (error) {
    log(`⚠️ Initialization error: ${error.message}`);
  }
})();
