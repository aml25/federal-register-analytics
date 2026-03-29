// chat.js — Global always-on chat overlay for whatgotsigned.com
// Requires: utils.js (wrapPresidentNames, linkThemeNames)
//           DOMPurify (loaded before this file)
// Injected into every page via head.ejs (defer)

const MAX_TURNS = 10;
const SESSION_KEY = 'wgs-chat-v1';

// ── Page context detection ────────────────────────────────────────────────────

function getPageContext() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  // /detail/eo/:eoNumber
  if (parts[0] === 'detail' && parts[1] === 'eo' && parts[2]) {
    return { type: 'eo', params: { eoNumber: parts[2] } };
  }
  // /detail/term/:president/:start
  if (parts[0] === 'detail' && parts[1] === 'term' && parts[2] && parts[3]) {
    return { type: 'term', params: { presidentId: parts[2], termStart: parts[3] } };
  }
  // /detail/quarter/:year/:quarter
  if (parts[0] === 'detail' && parts[1] === 'quarter' && parts[2] && parts[3]) {
    return { type: 'quarter', params: { year: parts[2], quarter: parts[3] } };
  }
  // /detail/theme/:themeId
  if (parts[0] === 'detail' && parts[1] === 'theme' && parts[2]) {
    return { type: 'theme', params: { themeId: parts[2] } };
  }
  // homepage
  if (parts.length === 0 || (parts.length === 1 && parts[0] === 'index')) {
    return { type: 'homepage', params: {} };
  }
  return { type: 'generic', params: {} };
}

function ctxLabel(ctx) {
  switch (ctx.type) {
    case 'eo':       return `EO ${ctx.params.eoNumber}`;
    case 'theme':    return `theme: ${ctx.params.themeId}`;
    case 'term':     return `${ctx.params.presidentId} term (${ctx.params.termStart})`;
    case 'quarter':  return `Q${ctx.params.quarter} ${ctx.params.year}`;
    case 'homepage': return 'this week';
    default:         return 'this page';
  }
}

// ── sessionStorage ────────────────────────────────────────────────────────────

function loadSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveSession(context, msgs) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ context, messages: msgs }));
  } catch { /* storage unavailable */ }
}

function clearSession() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
}

// ── HTML injection ────────────────────────────────────────────────────────────

function buildChatHtml() {
  return `
    <div class="chat-backdrop" id="chat-backdrop" aria-hidden="true"></div>
    <div class="chat-overlay" id="chat-overlay" role="complementary" aria-label="Chat assistant">
      <div class="chat-context-banner" id="chat-context-banner" style="display:none">
        <span class="chat-context-banner-text" id="chat-context-banner-text"></span>
        <div class="chat-context-banner-actions">
          <button class="chat-context-btn" id="chat-context-new">Start fresh</button>
          <button class="chat-context-keep" id="chat-context-keep">Keep chatting</button>
        </div>
      </div>
      <div class="chat-messages" id="chat-messages" role="log" aria-live="polite" aria-relevant="additions"></div>
      <div class="chat-bar" id="chat-bar">
        <div class="chat-chips" id="chat-chips"></div>
        <div class="chat-input-row">
          <input
            type="text"
            class="chat-input"
            id="chat-input"
            placeholder="Ask about executive orders…"
            autocomplete="off"
            aria-label="Chat input"
          />
          <button class="chat-send" id="chat-send" aria-label="Send">
            <wa-icon name="paper-plane"></wa-icon>
          </button>
        </div>
      </div>
      <button class="chat-close" id="chat-close" aria-label="Close chat" style="display:none">
        <wa-icon name="xmark"></wa-icon>
      </button>
    </div>
  `;
}

// ── State ─────────────────────────────────────────────────────────────────────

let pageCtx = null;
let messages = [];
let isExpanded = false;

// ── DOM refs ──────────────────────────────────────────────────────────────────

let overlayEl, backdropEl, messagesEl, inputEl, sendBtn, chipsEl, closeBtn, bannerEl, bannerTextEl, bannerNewBtn, bannerKeepBtn;

// ── Overlay open/close ────────────────────────────────────────────────────────

function openOverlay() {
  if (isExpanded) return;
  isExpanded = true;
  overlayEl.classList.add('chat-overlay--expanded');
  backdropEl.classList.add('chat-backdrop--visible');
  document.getElementById('chat-close').style.display = '';
  inputEl.focus();
}

function closeOverlay() {
  if (!isExpanded) return;
  isExpanded = false;
  overlayEl.classList.remove('chat-overlay--expanded');
  backdropEl.classList.remove('chat-backdrop--visible');
  document.getElementById('chat-close').style.display = 'none';
}

// ── Context banner ────────────────────────────────────────────────────────────

function showContextBanner(savedCtx) {
  bannerTextEl.textContent = `Your conversation was about ${ctxLabel(savedCtx)}. Start fresh or keep chatting.`;
  bannerEl.style.display = '';
}

function hideContextBanner() {
  bannerEl.style.display = 'none';
}

// ── Message rendering ─────────────────────────────────────────────────────────

function renderMessage(role, content) {
  const div = document.createElement('div');
  div.className = `chat-bubble chat-bubble--${role}`;
  const clean = DOMPurify.sanitize(content, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
  div.textContent = clean;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return div;
}

function renderTyping() {
  const div = document.createElement('div');
  div.className = 'chat-bubble chat-bubble--assistant chat-typing';
  div.innerHTML = '<span></span><span></span><span></span>';
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return div;
}

function renderError(msg) {
  const div = document.createElement('div');
  div.className = 'chat-error';
  div.textContent = msg;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ── Chips ─────────────────────────────────────────────────────────────────────

function buildChips(ctx) {
  chipsEl.innerHTML = '';
  const suggestions = getChipSuggestions(ctx);
  for (const text of suggestions) {
    const btn = document.createElement('button');
    btn.className = 'chat-chip';
    btn.textContent = text;
    btn.addEventListener('click', () => {
      inputEl.value = text;
      chipsEl.style.display = 'none';
      sendMessage(text);
    });
    chipsEl.appendChild(btn);
  }
  if (suggestions.length > 0) chipsEl.style.display = 'flex';
}

function getChipSuggestions(ctx) {
  switch (ctx.type) {
    case 'eo':
      return [
        'What does this order do?',
        'What legal authority does this cite?',
        'Which agencies are directed to act?',
      ];
    case 'theme':
      return [
        `What are the key EOs in this theme?`,
        'How have these orders changed over time?',
        'Which presidents issued the most orders here?',
      ];
    case 'term':
      return [
        'What were the major themes of these orders?',
        'Which orders had the biggest impact?',
        'How many EOs were signed this term?',
      ];
    case 'quarter':
      return [
        'What was the focus this quarter?',
        'Which orders were most significant?',
      ];
    case 'homepage':
      return [
        'What happened this week?',
        'Which orders are most significant?',
        'What themes are emerging?',
      ];
    default:
      return [
        'What can you help me with?',
        'Tell me about executive orders.',
      ];
  }
}

// ── Send message ──────────────────────────────────────────────────────────────

async function sendMessage(question) {
  if (!question.trim()) return;

  openOverlay();
  chipsEl.style.display = 'none';
  inputEl.value = '';
  sendBtn.disabled = true;
  inputEl.disabled = true;

  renderMessage('user', question);

  messages.push({ role: 'user', content: question.trim() });
  if (messages.length > MAX_TURNS * 2) {
    messages = messages.slice(-MAX_TURNS * 2);
  }

  const typingEl = renderTyping();

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context: pageCtx,
        question: question.trim(),
        messages: messages.slice(0, -1), // exclude the one we just added
      }),
    });

    typingEl.remove();

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      renderError(data.error || `Error ${res.status} — please try again.`);
      messages.pop(); // remove the user message we added
    } else {
      const data = await res.json();
      const answer = data.answer || '(No response)';
      renderMessage('assistant', answer);
      messages.push({ role: 'assistant', content: answer });
      saveSession(pageCtx, messages);
    }
  } catch (err) {
    typingEl.remove();
    renderError('Could not reach the server — check your connection.');
    messages.pop();
  } finally {
    sendBtn.disabled = false;
    inputEl.disabled = false;
    inputEl.focus();
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Inject HTML
  const container = document.createElement('div');
  container.innerHTML = buildChatHtml();
  document.body.appendChild(container);

  // Wire up refs
  overlayEl    = document.getElementById('chat-overlay');
  backdropEl   = document.getElementById('chat-backdrop');
  messagesEl   = document.getElementById('chat-messages');
  inputEl      = document.getElementById('chat-input');
  sendBtn      = document.getElementById('chat-send');
  chipsEl      = document.getElementById('chat-chips');
  closeBtn     = document.getElementById('chat-close');
  bannerEl     = document.getElementById('chat-context-banner');
  bannerTextEl = document.getElementById('chat-context-banner-text');
  bannerNewBtn = document.getElementById('chat-context-new');
  bannerKeepBtn = document.getElementById('chat-context-keep');

  // Determine page context
  pageCtx = getPageContext();

  // Check for existing session
  const saved = loadSession();

  if (saved && saved.context && saved.context.type !== pageCtx.type) {
    // Different page type — show banner, restore old messages
    messages = saved.messages || [];
    for (const msg of messages) {
      renderMessage(msg.role, msg.content);
    }
    showContextBanner(saved.context);

    bannerNewBtn.addEventListener('click', () => {
      messages = [];
      clearSession();
      messagesEl.innerHTML = '';
      hideContextBanner();
      buildChips(pageCtx);
    });

    bannerKeepBtn.addEventListener('click', () => {
      hideContextBanner();
      // Keep messages, update context silently
      saveSession(pageCtx, messages);
    });
  } else if (saved && saved.messages && saved.messages.length > 0) {
    // Same context type — restore silently
    messages = saved.messages;
    for (const msg of messages) {
      renderMessage(msg.role, msg.content);
    }
    // Restore means the overlay should open to show the existing conversation
    openOverlay();
  } else {
    // Fresh start
    buildChips(pageCtx);
  }

  // Input handlers
  inputEl.addEventListener('focus', () => {
    if (!isExpanded) openOverlay();
  });

  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const q = inputEl.value.trim();
      if (q) sendMessage(q);
    }
  });

  sendBtn.addEventListener('click', () => {
    const q = inputEl.value.trim();
    if (q) sendMessage(q);
  });

  closeBtn.addEventListener('click', closeOverlay);

  backdropEl.addEventListener('click', closeOverlay);
});
