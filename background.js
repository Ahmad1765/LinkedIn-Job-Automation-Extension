// Service worker
chrome.runtime.onInstalled.addListener(() => {
  console.log('Job Auto Apply - Extension installed');

  // Initialiser le storage
  chrome.storage.local.set({
    isRunning: false,
    appliedCount: 0,
    skippedCount: 0,
    appliedJobs: [],
    onboardingCompleted: false
  });
});

// In-memory cache for current service-worker lifetime (storage backs it for persistence)
const llmCache = new Map();

// Hash a key for cache (FNV-1a 32-bit, plenty for our use)
function cacheKey(question, fieldType, options) {
  const norm = (question || '').toLowerCase().trim() + '|' + fieldType + '|' + (options || []).join('||');
  let h = 0x811c9dc5;
  for (let i = 0; i < norm.length; i++) {
    h ^= norm.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return 'llm_' + h.toString(16);
}

// Call OpenRouter chat completions
async function callOpenRouter({ apiKey, model, question, fieldType, options, resumeText, profile }) {
  if (!apiKey || !apiKey.trim()) throw new Error('OpenRouter API key not set');
  const chosenModel = (model || 'openai/gpt-4o-mini').trim();

  const profileSummary = profile ? Object.entries(profile)
    .filter(([_, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}: ${v}`).join('\n') : '';

  let formatInstruction = '';
  if (fieldType === 'select' || fieldType === 'radio') {
    formatInstruction = `\nReply with EXACTLY one of these option labels, copied verbatim (case-sensitive): ${JSON.stringify(options)}.
Do NOT invent options. Do NOT explain. Do NOT add quotes.`;
  } else if (fieldType === 'number' || fieldType === 'numeric') {
    formatInstruction = `\nReply with EXACTLY ONE non-negative whole integer. The output must be ONLY digits (e.g. "3", "0", "12"). No words. No units. No "years". No prose. No decimals. No ranges. No commas. No quotes.
If the question asks "how many years of experience with X", count years from candidate's resume; if X isn't on the resume, infer from closely related experience or answer with a small honest number like "1" or "2" — NEVER 0 unless truly zero.
The question text may include "Answer must be between A and B" — your output MUST be in that range.
NEVER reply with "/", "-", "N/A", or any non-numeric placeholder.`;
  } else if (fieldType === 'textarea') {
    formatInstruction = `\nWrite a substantive answer of 3-6 complete sentences (150-600 chars). Plain text, no markdown, no bullets, no quotes around the answer.
Address the question directly. Draw on relevant experience from the candidate's resume where possible; where the resume lacks the exact background, give a thoughtful plausible response using transferable skills and reasonable hypothetical experience.
Always commit to an answer — even for hypothetical scenarios, brainstorm-style questions, case studies, or open-ended prompts. Never refuse, never apologize, never say "I don't know", never leave blank.
Sound enthusiastic and professional, first person ("I would...", "I have...").
NEVER reply with "/", "-", "N/A", "see resume", or any placeholder. NEVER return an empty answer.`;
  } else {
    formatInstruction = `\nReply with a short factual answer (5-100 chars), plain text only. No quotes, no explanation, no symbols-only answers.
NEVER reply with "/", "-", "N/A", "TBD", "see resume", or any placeholder.`;
  }

  const systemPrompt = `You are filling out a job application form on behalf of the candidate.
Answer truthfully based on the candidate's resume and profile below.
If specific information is missing, give a reasonable safe answer that maximizes employability — do not refuse, do not stall, do not output placeholders.
Output ONLY the answer value to put in the form field — no preamble, no labels, no apologies.${formatInstruction}`;

  const userPrompt = `CANDIDATE PROFILE:
${profileSummary || '(no profile data)'}

CANDIDATE RESUME:
${resumeText ? resumeText.substring(0, 6000) : '(no resume text provided)'}

APPLICATION QUESTION:
${question}
`;

  // Tune generation params per field type
  const isTextarea = fieldType === 'textarea';
  const isNumeric = fieldType === 'number' || fieldType === 'numeric';
  const baseTemperature = isTextarea ? 0.75 : isNumeric ? 0.1 : 0.4;
  const baseMaxTokens   = isTextarea ? 700  : isNumeric ? 20  : 120;

  async function doFetch(messages, extraTokens = 0, extraTemp = 0) {
    const doOneCall = async () => {
      return fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey.trim()}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/local/job-auto-apply',
          'X-Title': 'Job Auto Apply'
        },
        body: JSON.stringify({
          model: chosenModel,
          messages,
          max_tokens: baseMaxTokens + extraTokens,
          temperature: Math.min(1.2, baseTemperature + extraTemp)
        })
      });
    };

    let resp = await doOneCall();

    // Handle 429 by parsing the reset header, sleeping, and retrying once
    if (resp.status === 429) {
      const resetHeader = resp.headers.get('X-RateLimit-Reset');
      let waitMs = 8000; // default 8s
      if (resetHeader) {
        const resetTs = parseInt(resetHeader);
        if (!isNaN(resetTs)) {
          // reset is sometimes seconds, sometimes ms — heuristic: > year-2000 in seconds vs ms
          const isMs = resetTs > 1e12;
          const resetAt = isMs ? resetTs : resetTs * 1000;
          waitMs = Math.max(2000, Math.min(90000, resetAt - Date.now() + 500));
        }
      }
      console.warn(`OpenRouter 429 rate-limited — sleeping ${Math.round(waitMs / 1000)}s before single retry`);
      await new Promise(r => setTimeout(r, waitMs));
      resp = await doOneCall();
    }

    if (!resp.ok) {
      const errText = await resp.text();
      // Friendlier message for the common free-tier issue
      if (resp.status === 429) {
        throw new Error(`OpenRouter 429: rate limit still exceeded after backoff. If you're using a ":free" model variant, switch to a paid model (e.g. openai/gpt-4o-mini ~$0.15/M in) — free models cap at 16 req/min.`);
      }
      throw new Error(`OpenRouter ${resp.status}: ${errText.substring(0, 200)}`);
    }
    const data = await resp.json();
    const raw = data?.choices?.[0]?.message?.content?.trim() || '';
    return raw.replace(/^["'`]+|["'`]+$/g, '').trim();
  }

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ];

  let answer = await doFetch(messages);

  // First-pass empty/placeholder → retry with stronger nudge (one extra round-trip max)
  if (!answer || isPlaceholderAnswer(answer, fieldType)) {
    console.warn('LLM returned empty/placeholder on first pass, retrying with nudge:', JSON.stringify(answer));
    const nudgeMessages = [
      ...messages,
      { role: 'assistant', content: answer || '' },
      { role: 'user', content: isTextarea
        ? 'Your previous response was empty. Please write 3-6 complete sentences answering the question. Be specific, use first person, draw on the resume or reasonable hypotheticals. Output ONLY the answer text — no apologies, no preamble, no empty response.'
        : isNumeric
          ? 'Your previous response was invalid. Reply with ONLY a single non-negative integer (digits only, e.g. "2"). If unsure, pick a reasonable small number like 1 or 2.'
          : 'Your previous response was empty. Provide a concrete short answer (5-100 chars). Output ONLY the answer value, no explanation.'
      }
    ];
    answer = await doFetch(nudgeMessages, 100, 0.15);
  }

  if (isPlaceholderAnswer(answer, fieldType)) {
    console.warn('LLM still placeholder after retry, rejecting:', JSON.stringify(answer));
    throw new Error(`LLM returned placeholder "${answer.substring(0, 30)}" — refusing to fill`);
  }
  return answer;
}

function isPlaceholderAnswer(ans, fieldType) {
  if (!ans) return true;
  const stripped = ans.replace(/[\s.,;:!?"'`()]/g, '');
  if (stripped.length < 1) return true;
  // Common refusal/placeholder sentinels
  if (/^(\/+|-+|_+|n\/?a|na|tbd|tba|none|null|undefined|unknown|see\s*resume|n\.a\.?)$/i.test(stripped)) return true;
  // Only punctuation/symbols
  if (/^[\/\-_.,;:!?"'`(){}\[\]\\|*&^%$#@~+=<>]+$/.test(stripped)) return true;
  // Refusal phrases
  if (/^(i\s+(don'?t|cannot|can'?t|won'?t|am\s+unable|do\s+not)|sorry|as\s+an?\s+ai)/i.test(ans.trim())) return true;
  // Numeric fields must have at least one digit
  if ((fieldType === 'number' || fieldType === 'numeric') && !/\d/.test(ans)) return true;
  // Textareas need real substance — single word / very short replies are useless for case-study questions
  if (fieldType === 'textarea' && stripped.length < 20) return true;
  return false;
}

// Persisted cache helpers (writes through to chrome.storage.local)
async function getCached(key) {
  if (llmCache.has(key)) return llmCache.get(key);
  const stored = await chrome.storage.local.get([key]);
  if (stored[key]) {
    llmCache.set(key, stored[key]);
    return stored[key];
  }
  return null;
}
async function setCached(key, value) {
  llmCache.set(key, value);
  await chrome.storage.local.set({ [key]: value });
}

// Call OpenRouter once with MANY questions, return JSON map of id -> answer.
// Validates each answer against fieldType; pre-fills the per-question cache.
async function callOpenRouterBatch({ apiKey, model, items, resumeText, profile }) {
  if (!apiKey || !apiKey.trim()) throw new Error('OpenRouter API key not set');
  const chosenModel = (model || 'openai/gpt-4o-mini').trim();

  const profileSummary = profile ? Object.entries(profile)
    .filter(([_, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}: ${v}`).join('\n') : '';

  // Build a numbered list of questions with type/constraint context
  const questionsBlock = items.map((it, i) => {
    let typeDesc;
    if (it.fieldType === 'textarea') {
      typeDesc = 'type: textarea (3-6 sentences, 150-600 chars, plain prose, first-person, never empty/refused)';
    } else if (it.fieldType === 'number' || it.fieldType === 'numeric') {
      typeDesc = 'type: integer (digits only, no units, no words, no decimals)';
    } else if (it.fieldType === 'radio' || it.fieldType === 'select') {
      typeDesc = `type: pick-one (MUST be EXACTLY one of these options, copy verbatim): ${JSON.stringify(it.options || [])}`;
    } else {
      typeDesc = 'type: short text (5-100 chars, no quotes, no preamble)';
    }
    return `${i + 1}. (${typeDesc})\nQuestion: ${it.question}`;
  }).join('\n\n');

  const systemPrompt = `You are filling MANY fields of a single job application at once.
For each numbered question, produce an answer following its type constraint.
Always commit to an answer — never refuse, never apologize, never output empty, "/", "-", "N/A", or any placeholder.
Use the candidate's resume and profile for accuracy; if a specific detail is missing, infer a reasonable, employable answer (estimate years from related experience, write plausible hypotheticals for case studies).

Return ONE JSON object — and NOTHING else — mapping each question number (as a string) to its answer string. Example:
{"1": "3", "2": "I would prioritize the highest-LTV accounts first because...", "3": "Yes"}

No prose before or after the JSON. No markdown fences. Pure JSON.`;

  const userPrompt = `CANDIDATE PROFILE:
${profileSummary || '(no profile data)'}

CANDIDATE RESUME:
${resumeText ? resumeText.substring(0, 6000) : '(no resume text provided)'}

QUESTIONS TO ANSWER (return JSON map):
${questionsBlock}`;

  const callApi = async (msgs) => {
    const doOneCall = () => fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey.trim()}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/local/job-auto-apply',
        'X-Title': 'Job Auto Apply'
      },
      body: JSON.stringify({
        model: chosenModel,
        messages: msgs,
        // Enough room for all answers — generous because batch
        max_tokens: Math.min(4000, 250 + items.length * 250),
        temperature: 0.6,
        response_format: { type: 'json_object' }
      })
    });

    let resp = await doOneCall();
    if (resp.status === 429) {
      const resetHeader = resp.headers.get('X-RateLimit-Reset');
      let waitMs = 8000;
      if (resetHeader) {
        const ts = parseInt(resetHeader);
        if (!isNaN(ts)) {
          const isMs = ts > 1e12;
          const resetAt = isMs ? ts : ts * 1000;
          waitMs = Math.max(2000, Math.min(90000, resetAt - Date.now() + 500));
        }
      }
      console.warn(`Batch hit 429 — sleeping ${Math.round(waitMs / 1000)}s before retry`);
      await new Promise(r => setTimeout(r, waitMs));
      resp = await doOneCall();
    }
    if (!resp.ok) {
      const errText = await resp.text();
      if (resp.status === 429) {
        throw new Error(`OpenRouter 429: rate limit persists after backoff. Switch off the ":free" model variant.`);
      }
      throw new Error(`OpenRouter batch ${resp.status}: ${errText.substring(0, 200)}`);
    }
    const data = await resp.json();
    return data?.choices?.[0]?.message?.content?.trim() || '';
  };

  let raw = await callApi([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ]);

  // Try to extract JSON object — model may wrap in markdown fences despite instructions
  function extractJson(text) {
    if (!text) return null;
    // Strip ```json fences if present
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenceMatch ? fenceMatch[1] : text;
    // Find first { and last } to be tolerant
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start < 0 || end < 0) return null;
    try {
      return JSON.parse(candidate.substring(start, end + 1));
    } catch {
      return null;
    }
  }

  let parsed = extractJson(raw);

  // One retry if parse failed
  if (!parsed) {
    console.warn('Batch response was not parseable JSON, retrying with stricter prompt');
    raw = await callApi([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
      { role: 'assistant', content: raw },
      { role: 'user', content: 'Your last response was not valid JSON. Return ONLY a JSON object mapping question numbers to answers. No markdown, no prose, no fences. Just the JSON.' }
    ]);
    parsed = extractJson(raw);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Batch: model did not return valid JSON');
  }

  // Validate, normalize, cache each answer
  const result = {};
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const key1 = String(i + 1);
    const ansRaw = parsed[key1] ?? parsed[i + 1];
    if (ansRaw === undefined || ansRaw === null) continue;
    let ans = String(ansRaw).trim().replace(/^["'`]+|["'`]+$/g, '').trim();
    if (isPlaceholderAnswer(ans, it.fieldType)) continue;
    // For numeric, ensure digits only
    if (it.fieldType === 'number' || it.fieldType === 'numeric') {
      const digits = ans.match(/\d+/)?.[0];
      if (!digits) continue;
      ans = digits;
    }
    const cKey = cacheKey(it.question, it.fieldType, it.options);
    await setCached(cKey, ans);
    result[i] = ans;
  }
  return result;
}

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

async function handleGenerateTailoredCV({ jobDesc, githubProjects, profile = {} }) {
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
  let cvJson;
  try {
    cvJson = JSON.parse(jsonStr);
  } catch (e) {
    throw new Error(`LLM returned non-JSON: ${jsonStr.substring(0, 200)}`);
  }
  return { ok: true, cvJson };
}

// Message listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'incrementCount') {
    chrome.storage.local.get(['appliedCount'], (result) => {
      const newCount = (result.appliedCount || 0) + 1;
      chrome.storage.local.set({ appliedCount: newCount });
    });
  } else if (message.type === 'incrementSkippedCount') {
    chrome.storage.local.get(['skippedCount'], (result) => {
      const newCount = (result.skippedCount || 0) + 1;
      chrome.storage.local.set({ skippedCount: newCount });
    });
  } else if (message.type === 'setRunning') {
    chrome.storage.local.set({ isRunning: message.value });
  } else if (message.action === 'askLLMBatch') {
    (async () => {
      try {
        const incoming = Array.isArray(message.items) ? message.items : [];
        if (incoming.length === 0) {
          sendResponse({ ok: true, prefetched: 0, skipped: 0, fromCache: 0 });
          return;
        }
        // Filter to only items not already cached — saves API tokens
        const toFetch = [];
        let fromCache = 0;
        for (const it of incoming) {
          const k = cacheKey(it.question, it.fieldType, it.options || []);
          const c = await getCached(k);
          if (c) { fromCache++; continue; }
          toFetch.push(it);
        }
        if (toFetch.length === 0) {
          sendResponse({ ok: true, prefetched: 0, skipped: 0, fromCache });
          return;
        }
        const cfg = await chrome.storage.sync.get([
          'openrouterApiKey', 'openrouterModel', 'aiEnabled',
          'firstName', 'lastName', 'email', 'phone', 'phoneCountryCode', 'city',
          'yearsOfExperience', 'expectedSalary',
          'visaSponsorship', 'legallyAuthorized', 'willingToRelocate', 'driversLicense'
        ]);
        if (!cfg.aiEnabled) {
          sendResponse({ ok: false, error: 'AI disabled' });
          return;
        }
        const local = await chrome.storage.local.get(['resumeText']);
        const profile = {
          name: `${cfg.firstName || ''} ${cfg.lastName || ''}`.trim(),
          email: cfg.email,
          phone: `${cfg.phoneCountryCode || ''} ${cfg.phone || ''}`.trim(),
          city: cfg.city,
          yearsOfExperience: cfg.yearsOfExperience,
          expectedSalary: cfg.expectedSalary,
          visaSponsorship: cfg.visaSponsorship,
          legallyAuthorized: cfg.legallyAuthorized,
          willingToRelocate: cfg.willingToRelocate,
          driversLicense: cfg.driversLicense
        };
        const result = await callOpenRouterBatch({
          apiKey: cfg.openrouterApiKey,
          model: cfg.openrouterModel,
          items: toFetch,
          resumeText: local.resumeText,
          profile
        });
        sendResponse({ ok: true, prefetched: Object.keys(result).length, skipped: toFetch.length - Object.keys(result).length, fromCache });
      } catch (err) {
        console.error('askLLMBatch error:', err);
        sendResponse({ ok: false, error: err.message || String(err) });
      }
    })();
    return true;
  } else if (message.action === 'askLLM') {
    // Async response
    (async () => {
      try {
        const { question, fieldType, options } = message;
        const key = cacheKey(question, fieldType, options);
        const cached = await getCached(key);
        if (cached) {
          sendResponse({ ok: true, answer: cached, fromCache: true });
          return;
        }
        const cfg = await chrome.storage.sync.get([
          'openrouterApiKey', 'openrouterModel', 'aiEnabled',
          'firstName', 'lastName', 'email', 'phone', 'phoneCountryCode', 'city',
          'yearsOfExperience', 'expectedSalary',
          'visaSponsorship', 'legallyAuthorized', 'willingToRelocate', 'driversLicense'
        ]);
        if (!cfg.aiEnabled) {
          sendResponse({ ok: false, error: 'AI disabled in settings' });
          return;
        }
        const local = await chrome.storage.local.get(['resumeText']);
        const profile = {
          name: `${cfg.firstName || ''} ${cfg.lastName || ''}`.trim(),
          email: cfg.email,
          phone: `${cfg.phoneCountryCode || ''} ${cfg.phone || ''}`.trim(),
          city: cfg.city,
          yearsOfExperience: cfg.yearsOfExperience,
          expectedSalary: cfg.expectedSalary,
          visaSponsorship: cfg.visaSponsorship,
          legallyAuthorized: cfg.legallyAuthorized,
          willingToRelocate: cfg.willingToRelocate,
          driversLicense: cfg.driversLicense
        };
        const answer = await callOpenRouter({
          apiKey: cfg.openrouterApiKey,
          model: cfg.openrouterModel,
          question,
          fieldType,
          options,
          resumeText: local.resumeText,
          profile
        });
        if (answer) {
          await setCached(key, answer);
        }
        sendResponse({ ok: true, answer, fromCache: false });
      } catch (err) {
        console.error('askLLM error:', err);
        sendResponse({ ok: false, error: err.message || String(err) });
      }
    })();
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
});
