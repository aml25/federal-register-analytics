// chat.js — Chat overlay logic for /detail/eo/:eoNumber
// Requires: utils.js (wrapPresidentNames, linkThemeNames, escapeRegex)
//           DOMPurify (loaded before this file)

const MAX_TURNS = 10;
const CONTEXT_TIMEOUT_MS = 8000;
const FINDINGS_KEY_PREFIX = 'eo-findings-';

// ── State ────────────────────────────────────────────────────────────────────

let eoCtx = null;          // {eoNumber, title, presidentName, signingDate, htmlUrl, themes, populations}
let messages = [];         // [{role: 'user'|'assistant', content: string}]
let chatInitialized = false;
let lastQuestion = '';     // question text of the in-flight request (for Retry)

// ── DOM refs (populated after DOMContentLoaded) ───────────────────────────────

let overlay, chipsEl, inputEl, sendBtn, messagesEl, panelsEl;
let turnCounterEl, turnCapEl, copyBtn, copyFromCapBtn, newConvBtn;
let findingsListEl, closeBtn, tabChat, tabFindings;
let convPanel, findingsPanel;

// ── Context init ─────────────────────────────────────────────────────────────

function initWithContext(ctx) {
  if (chatInitialized) return;
  chatInitialized = true;
  eoCtx = ctx;

  buildChips(ctx);
  chipsEl.style.display = 'flex';
  inputEl.disabled = false;
  sendBtn.disabled = false;

  loadFindings();
}

function enterDegradedMode() {
  if (chatInitialized) return;
  chatInitialized = true;
  // Bar enabled, no chips
  inputEl.disabled = false;
  sendBtn.disabled = false;
}

// ── Chip generation ───────────────────────────────────────────────────────────

function buildSuggestedChips(ctx) {
  const chips = [
    'What legal authority does this order cite?',
    'Which federal agencies are directed to act?',
  ];
  if (ctx && ctx.populations?.negative?.length) {
    chips.push('Who is most negatively impacted?');
  } else if (ctx && ctx.populations?.positive?.length) {
    chips.push('Who benefits from this order?');
  }
  if (ctx && ctx.themes?.length) {
    chips.push(`How does this relate to ${ctx.themes[0].name}?`);
  }
  return chips.slice(0, 3);
}

function buildChips(ctx) {
  const labels = buildSuggestedChips(ctx);
  chipsEl.innerHTML = labels.map(label =>
    `<button class="chat-chip" type="button" aria-label="${label}">${label}</button>`
  ).join('');

  chipsEl.querySelectorAll('.chat-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const question = btn.getAttribute('aria-label');
      inputEl.value = question;
      expandOverlay();
      sendMessage(question);
    });
  });
}

// ── Overlay expand / collapse ─────────────────────────────────────────────────

function expandOverlay() {
  if (overlay.classList.contains('chat-overlay--expanded')) return;
  overlay.classList.remove('chat-overlay--collapsed');
  overlay.classList.add('chat-overlay--expanded');
  panelsEl.removeAttribute('aria-hidden');
  chipsEl.style.display = 'none';

  // Mobile: visualViewport resize to stay above soft keyboard
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', handleViewportResize);
  }

  // Show conversation tab by default on mobile
  showMobileTab('chat');

  // Scroll messages to bottom
  scrollToBottom();
}

function collapseOverlay() {
  overlay.classList.remove('chat-overlay--expanded');
  overlay.classList.add('chat-overlay--collapsed');
  panelsEl.setAttribute('aria-hidden', 'true');
  if (chatInitialized && eoCtx) chipsEl.style.display = 'flex';

  if (window.visualViewport) {
    window.visualViewport.removeEventListener('resize', handleViewportResize);
  }
  // Reset overlay height (was adjusted for keyboard)
  overlay.style.height = '';
}

function handleViewportResize() {
  if (overlay.classList.contains('chat-overlay--expanded')) {
    overlay.style.height = `${window.visualViewport.height}px`;
  }
}

// ── Mobile tabs ───────────────────────────────────────────────────────────────

function showMobileTab(tab) {
  const isMobile = window.innerWidth < 768;
  if (!isMobile) {
    // Desktop: both panels always visible via CSS
    convPanel.classList.remove('chat-panel--visible');
    findingsPanel.classList.remove('chat-panel--visible');
    return;
  }
  if (tab === 'chat') {
    convPanel.classList.add('chat-panel--visible');
    findingsPanel.classList.remove('chat-panel--visible');
    tabChat.setAttribute('aria-selected', 'true');
    tabChat.classList.add('chat-tab--active');
    tabFindings.setAttribute('aria-selected', 'false');
    tabFindings.classList.remove('chat-tab--active');
    findingsPanel.setAttribute('aria-hidden', 'true');
    convPanel.removeAttribute('aria-hidden');
  } else {
    findingsPanel.classList.add('chat-panel--visible');
    convPanel.classList.remove('chat-panel--visible');
    tabFindings.setAttribute('aria-selected', 'true');
    tabFindings.classList.add('chat-tab--active');
    tabChat.setAttribute('aria-selected', 'false');
    tabChat.classList.remove('chat-tab--active');
    convPanel.setAttribute('aria-hidden', 'true');
    findingsPanel.removeAttribute('aria-hidden');
  }
}

// ── Messaging ─────────────────────────────────────────────────────────────────

function scrollToBottom() {
  const shouldScroll = messagesEl.scrollTop + messagesEl.clientHeight >= messagesEl.scrollHeight - 50;
  if (shouldScroll || messagesEl.scrollHeight === 0) {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
}

function appendUserBubble(question) {
  const div = document.createElement('div');
  div.className = 'chat-message chat-message--user';
  div.innerHTML = `<div class="chat-bubble">${DOMPurify.sanitize(question, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] })}</div>`;
  messagesEl.appendChild(div);
  scrollToBottom();
}

function showTypingIndicator() {
  const div = document.createElement('div');
  div.className = 'chat-message chat-message--assistant';
  div.id = 'chat-typing';
  div.setAttribute('aria-label', 'Thinking…');
  div.innerHTML = `
    <div class="chat-bubble chat-typing">
      <span class="chat-typing-dot"></span>
      <span class="chat-typing-dot"></span>
      <span class="chat-typing-dot"></span>
    </div>
  `;
  messagesEl.appendChild(div);
  messagesEl.setAttribute('aria-busy', 'true');
  scrollToBottom();
}

function removeTypingIndicator() {
  const el = document.getElementById('chat-typing');
  if (el) el.remove();
  messagesEl.removeAttribute('aria-busy');
}

function renderMessage(rawAnswer) {
  // SEC-001: sanitize LLM content before injecting
  // Allow <a>, <strong>, <em>, <span> since wrapPresidentNames + linkThemeNames add these post-sanitize
  let text = DOMPurify.sanitize(rawAnswer, {
    ALLOWED_TAGS: ['a', 'strong', 'em', 'span'],
    ALLOWED_ATTR: ['href', 'class', 'data-president', 'name', 'image', 'shape'],
  });
  if (eoCtx) {
    text = wrapPresidentNames(text, eoCtx.presidentName);
    text = linkThemeNames(text, eoCtx.themes || []);
  }

  const messageDiv = document.createElement('div');
  messageDiv.className = 'chat-message chat-message--assistant';

  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble';
  bubble.innerHTML = text;

  const addBtn = document.createElement('button');
  addBtn.className = 'chat-add-finding';
  addBtn.textContent = '+ Add to findings';
  addBtn.setAttribute('aria-label', 'Add this response to findings');
  addBtn.addEventListener('click', () => {
    addFinding(rawAnswer, lastQuestion);
    addBtn.textContent = '✓ Added';
    addBtn.disabled = true;
    setTimeout(() => { addBtn.textContent = '+ Add to findings'; addBtn.disabled = false; }, 1000);
  });

  messageDiv.appendChild(bubble);
  messageDiv.appendChild(addBtn);
  messagesEl.appendChild(messageDiv);
  scrollToBottom();
}

function showChatError(message, retryQuestion) {
  const div = document.createElement('div');
  div.className = 'chat-message chat-message--assistant';
  div.innerHTML = `
    <div class="chat-error">
      <span>${DOMPurify.sanitize(message, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] })}</span>
      ${retryQuestion ? `<button class="chat-retry-btn" data-question="${DOMPurify.sanitize(retryQuestion, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] })}">Retry</button>` : ''}
    </div>
  `;
  const retryBtn = div.querySelector('.chat-retry-btn');
  if (retryBtn) {
    retryBtn.addEventListener('click', () => {
      div.remove();
      sendMessage(retryQuestion);
    });
  }
  messagesEl.appendChild(div);
  scrollToBottom();
}

function updateTurnCounter() {
  const turnCount = messages.filter(m => m.role === 'user').length;
  if (turnCount >= MAX_TURNS) {
    // Show terminal state
    turnCounterEl.style.display = 'none';
    turnCapEl.style.display = '';
    inputEl.disabled = true;
    sendBtn.disabled = true;
    return;
  }
  if (turnCount >= 8) {
    const remaining = MAX_TURNS - turnCount;
    turnCounterEl.textContent = remaining === 1 ? '1 question remaining' : `${remaining} questions remaining`;
    turnCounterEl.style.display = '';
  } else {
    turnCounterEl.style.display = 'none';
  }
}

async function sendMessage(question) {
  if (!question.trim()) return;
  if (messages.filter(m => m.role === 'user').length >= MAX_TURNS) return;

  lastQuestion = question;
  inputEl.value = '';
  inputEl.disabled = true;
  sendBtn.disabled = true;

  appendUserBubble(question);
  showTypingIndicator();

  // Add user turn to history before API call
  messages.push({ role: 'user', content: question });

  try {
    const body = {
      subject: { type: 'eo', id: eoCtx ? eoCtx.eoNumber : getEoNumberFromUrl() },
      messages: messages.slice(0, -1), // history excluding current question
      question,
    };

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    removeTypingIndicator();

    if (res.status === 429) {
      messages.pop(); // remove user turn we added
      showChatError('Too many requests — try again in a moment.', null);
      inputEl.disabled = false;
      sendBtn.disabled = false;
      return;
    }

    if (res.status === 400) {
      const errData = await res.json().catch(() => ({}));
      messages.pop();
      showChatError(errData.error || "Couldn't get a response. Try again.", question);
      inputEl.disabled = false;
      sendBtn.disabled = false;
      return;
    }

    if (!res.ok) {
      messages.pop();
      showChatError("Couldn't get a response. Try again.", question);
      inputEl.disabled = false;
      sendBtn.disabled = false;
      return;
    }

    const data = await res.json();
    const answer = data.answer || '';

    messages.push({ role: 'assistant', content: answer });
    renderMessage(answer);
    updateTurnCounter();

    // Re-enable input unless at turn cap
    const userTurns = messages.filter(m => m.role === 'user').length;
    if (userTurns < MAX_TURNS) {
      inputEl.disabled = false;
      sendBtn.disabled = false;
      inputEl.focus();
    }

  } catch (err) {
    removeTypingIndicator();
    messages.pop();
    showChatError("Couldn't get a response. Try again.", question);
    inputEl.disabled = false;
    sendBtn.disabled = false;
  }
}

function getEoNumberFromUrl() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  return parts[2] || '';
}

// ── Findings ──────────────────────────────────────────────────────────────────

function findingsKey() {
  const num = eoCtx ? eoCtx.eoNumber : getEoNumberFromUrl();
  return `${FINDINGS_KEY_PREFIX}${num}`;
}

function loadFindings() {
  renderFindingsList(getFindings());
}

function getFindings() {
  try {
    const raw = localStorage.getItem(findingsKey());
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveFindings(list) {
  try {
    localStorage.setItem(findingsKey(), JSON.stringify(list));
    return true;
  } catch (err) {
    if (err.name === 'QuotaExceededError') {
      showToast("Couldn't save — storage full. Your finding is shown but not persisted.");
    }
    return false;
  }
}

function addFinding(text, question) {
  const findings = getFindings();
  findings.push({
    text: text.trim(),
    question: question.trim(),
    addedAt: new Date().toISOString(),
  });
  saveFindings(findings);
  renderFindingsList(findings);
}

function removeFinding(index) {
  const findings = getFindings();
  findings.splice(index, 1);
  saveFindings(findings);
  renderFindingsList(findings);
}

function renderFindingsList(findings) {
  if (!findings.length) {
    findingsListEl.innerHTML = '<p class="chat-findings-empty wa-body-s wa-color-text-quiet">Nothing saved yet. Hit "+ Add to findings" after any response.</p>';
    copyBtn.disabled = true;
    return;
  }

  copyBtn.disabled = false;
  findingsListEl.innerHTML = findings.map((f, i) => `
    <div class="chat-finding-item" data-index="${i}">
      <div class="chat-finding-question wa-caption-s wa-color-text-quiet">From: "${DOMPurify.sanitize(f.question, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] })}"</div>
      <div class="chat-finding-text">${DOMPurify.sanitize(f.text, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] })}</div>
      <button class="chat-finding-remove" aria-label="Remove finding" data-index="${i}">
        <wa-icon name="xmark"></wa-icon>
      </button>
    </div>
  `).join('');

  findingsListEl.querySelectorAll('.chat-finding-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      removeFinding(parseInt(btn.dataset.index, 10));
    });
  });
}

function buildMarkdownExport() {
  const findings = getFindings();
  const ctx = eoCtx || {};
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const signedDate = ctx.signingDate ? new Date(ctx.signingDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }) : '';
  const themeNames = (ctx.themes || []).map(t => t.name).join(', ');
  const lines = [
    `# Investigation: EO ${ctx.eoNumber || ''} — ${ctx.title || ''}`,
    `*Investigated on ${date} · whatgotsigned.com*`,
    '',
    '## Key Findings',
    ...findings.map((f, i) => `${i + 1}. ${f.text}  _(from question: "${f.question}")_`),
    '',
    '## Subject',
    `Executive Order ${ctx.eoNumber || ''} | Signed ${signedDate} | ${ctx.presidentName || ''}`,
    themeNames ? `Themes: ${themeNames}` : '',
  ].filter(line => line !== null);
  return lines.join('\n');
}

async function copyFindingsToClipboard() {
  const md = buildMarkdownExport();
  try {
    await navigator.clipboard.writeText(md);
    showToast('Copied to clipboard');
  } catch (err) {
    showToast('Copy failed — your browser blocked clipboard access. Use Ctrl+C.');
  }
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function showToast(message) {
  const existing = document.querySelector('.chat-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'chat-toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2000);
}

// ── New conversation ───────────────────────────────────────────────────────────

function startNewConversation() {
  messages = [];
  lastQuestion = '';
  messagesEl.innerHTML = '';
  turnCounterEl.style.display = 'none';
  turnCapEl.style.display = 'none';
  inputEl.disabled = false;
  sendBtn.disabled = false;
  inputEl.focus();
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  overlay = document.getElementById('chat-overlay');
  chipsEl = document.getElementById('chat-chips');
  inputEl = document.getElementById('chat-input');
  sendBtn = document.getElementById('chat-send');
  messagesEl = document.getElementById('chat-messages');
  panelsEl = document.getElementById('chat-panels');
  turnCounterEl = document.getElementById('chat-turn-counter');
  turnCapEl = document.getElementById('chat-turn-cap');
  copyBtn = document.getElementById('chat-copy');
  copyFromCapBtn = document.getElementById('chat-copy-from-cap');
  newConvBtn = document.getElementById('chat-new-conversation');
  findingsListEl = document.getElementById('chat-findings-list');
  closeBtn = document.getElementById('chat-close');
  tabChat = document.getElementById('tab-chat');
  tabFindings = document.getElementById('tab-findings');
  convPanel = document.getElementById('chat-conversation-panel');
  findingsPanel = document.getElementById('chat-findings-panel');

  // Input focus → expand overlay
  inputEl.addEventListener('focus', () => {
    if (!overlay.classList.contains('chat-overlay--expanded')) {
      expandOverlay();
    }
  });

  // Send on button click
  sendBtn.addEventListener('click', () => {
    const q = inputEl.value.trim();
    if (q) sendMessage(q);
  });

  // Send on Enter (not Shift+Enter)
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const q = inputEl.value.trim();
      if (q) sendMessage(q);
    }
  });

  // Close button
  closeBtn.addEventListener('click', collapseOverlay);

  // Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay.classList.contains('chat-overlay--expanded')) {
      collapseOverlay();
    }
  });

  // Copy findings
  copyBtn.addEventListener('click', copyFindingsToClipboard);
  copyFromCapBtn.addEventListener('click', copyFindingsToClipboard);

  // New conversation
  newConvBtn.addEventListener('click', startNewConversation);

  // Mobile tabs
  tabChat.addEventListener('click', () => showMobileTab('chat'));
  tabFindings.addEventListener('click', () => showMobileTab('findings'));

  // Keyboard nav for tabs (arrow keys per ARIA tablist pattern)
  [tabChat, tabFindings].forEach((tab, i, tabs) => {
    tab.addEventListener('keydown', (e) => {
      let next = null;
      if (e.key === 'ArrowRight') next = tabs[(i + 1) % tabs.length];
      if (e.key === 'ArrowLeft') next = tabs[(i - 1 + tabs.length) % tabs.length];
      if (next) { next.focus(); next.click(); }
    });
  });

  // Context-ready check: fast path via window.__eoContext, fallback via event
  const ctxTimeout = setTimeout(() => enterDegradedMode(), CONTEXT_TIMEOUT_MS);

  if (window.__eoContext) {
    clearTimeout(ctxTimeout);
    initWithContext(window.__eoContext);
  } else {
    document.addEventListener('eo-context-ready', (e) => {
      clearTimeout(ctxTimeout);
      initWithContext(e.detail);
    }, { once: true });
  }
});
