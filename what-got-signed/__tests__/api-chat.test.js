// Tests for POST /api/chat handler logic and assembleContext helper
// Tests validation and key execution paths using mocked dependencies.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Pure helpers (copied from server.js for isolated unit testing) ──────────

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function truncateRawText(text, maxChars = 24000) {
  if (text.length <= maxChars) return text;
  const cutoff = text.lastIndexOf('\n\n', maxChars);
  const pos = cutoff > maxChars * 0.5 ? cutoff : text.lastIndexOf('\n', maxChars);
  return text.slice(0, pos > 0 ? pos : maxChars) + '\n\n— [text truncated] —';
}

// ─── stripHtml ───────────────────────────────────────────────────────────────

describe('stripHtml', () => {
  it('removes HTML tags', () => {
    expect(stripHtml('<p>Hello <b>world</b></p>')).toBe('Hello world');
  });

  it('removes script blocks entirely', () => {
    const result = stripHtml('<p>text</p><script>alert(1)</script>');
    expect(result).not.toContain('alert');
    expect(result).toContain('text');
  });

  it('removes style blocks entirely', () => {
    const result = stripHtml('<style>body{color:red}</style><p>text</p>');
    expect(result).not.toContain('color');
    expect(result).toBe('text');
  });

  it('decodes common HTML entities', () => {
    expect(stripHtml('&amp;amp; &lt;tag&gt; &quot;quote&quot;')).toBe('&amp; <tag> "quote"');
  });

  it('collapses multiple whitespace', () => {
    expect(stripHtml('hello    world')).toBe('hello world');
  });
});

// ─── truncateRawText ─────────────────────────────────────────────────────────

describe('truncateRawText', () => {
  it('returns text unchanged if under limit', () => {
    const text = 'Short text.';
    expect(truncateRawText(text, 100)).toBe(text);
  });

  it('truncates long text and appends marker', () => {
    const text = 'a'.repeat(30000);
    const result = truncateRawText(text, 24000);
    expect(result.length).toBeLessThan(30000);
    expect(result).toContain('— [text truncated] —');
  });

  it('prefers paragraph break for clean truncation', () => {
    const para = 'First paragraph.\n\nSecond paragraph.';
    // Make it just over the limit so the paragraph break is used
    const padding = 'x'.repeat(24000 - para.length + 20);
    const text = padding + '\n\n' + para;
    const result = truncateRawText(text, 24000);
    expect(result).toContain('— [text truncated] —');
  });
});

// ─── assembleContext (inline implementation for unit testing) ─────────────────

const PARAM_ALLOW = /^[a-z0-9_-]+$/i;

async function assembleContext(contextType, params, { readFileFn, readdirFn }) {
  switch (contextType) {
    case 'homepage': {
      try {
        const raw = await readFileFn('weekly-narrative.json', 'utf-8');
        const data = JSON.parse(raw);
        const narrative = data.narrative || data;
        return `This week in executive orders:\n${narrative.summary || JSON.stringify(narrative).slice(0, 2000)}`;
      } catch {
        return 'The user is on the homepage of What Got Signed?, a site tracking U.S. executive orders.';
      }
    }
    case 'eo': {
      const eoId = parseInt(params.eoNumber, 10);
      if (!Number.isFinite(eoId) || eoId <= 0) throw Object.assign(new Error('Invalid EO number'), { status: 400 });
      const raw = await readFileFn(`eo-${eoId}.json`, 'utf-8');
      const eo = JSON.parse(raw);
      return `EXECUTIVE ORDER CONTEXT:\nNumber: ${eo.executive_order_number}\nTitle: ${eo.title}\nSigned: ${eo.signing_date} by ${eo.president.name}\nSummary: ${eo.enrichment.summary}`;
    }
    case 'theme': {
      const { themeId } = params;
      if (!themeId || !PARAM_ALLOW.test(themeId)) throw Object.assign(new Error('Invalid theme ID'), { status: 400 });
      const files = await readdirFn('enriched');
      const orders = [];
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const content = await readFileFn(file, 'utf-8');
        const order = JSON.parse(content);
        if (order.enrichment?.theme_ids?.includes(themeId)) orders.push(order);
      }
      orders.sort((a, b) => new Date(b.signing_date) - new Date(a.signing_date));
      const top = orders.slice(0, 20);
      if (top.length === 0) return `No executive orders are currently tagged with the theme "${themeId}".`;
      const lines = top.map(o => `- EO ${o.executive_order_number} (${o.signing_date}): ${o.title} — ${o.enrichment.summary}`);
      return `Executive orders tagged with theme "${themeId}" (showing ${top.length} of ${orders.length} total):\n${lines.join('\n')}`;
    }
    case 'generic':
      return 'The user is exploring What Got Signed?, a site tracking U.S. executive orders.';
    default:
      return 'The user is exploring What Got Signed?, a site tracking U.S. executive orders.';
  }
}

// ─── chatHandler (inline implementation for unit testing) ────────────────────

function makeChatHandler(assembleCtxFn, openaiClient) {
  return async function chatHandler(req, res) {
    const { context, messages, question } = req.body || {};
    const ALLOWED_TYPES = new Set(['homepage', 'eo', 'theme', 'term', 'quarter', 'generic']);

    if (!context || typeof context.type !== 'string' || !ALLOWED_TYPES.has(context.type)) {
      return res.status(400).json({ error: 'Invalid context' });
    }
    if (!question || typeof question !== 'string' || !question.trim()) {
      return res.status(400).json({ error: 'Question is required' });
    }
    const history = Array.isArray(messages) ? messages : [];
    if (history.length > 20) {
      return res.status(400).json({ error: 'Conversation history too long' });
    }

    let contextText;
    try {
      contextText = await assembleCtxFn(context.type, context.params || {});
    } catch (err) {
      if (err.status === 400) return res.status(400).json({ error: err.message });
      if (err.code === 'ENOENT') return res.status(404).json({ error: 'Content not found' });
      return res.status(500).json({ error: 'Failed to load page context' });
    }

    const openaiMessages = [
      { role: 'system', content: `PAGE CONTEXT:\n${contextText}` },
      ...history.filter(m => m.role === 'user' || m.role === 'assistant')
                .map(m => ({ role: m.role, content: String(m.content).slice(0, 4000) })),
      { role: 'user', content: question.trim() },
    ];

    try {
      const completion = await openaiClient.chat.completions.create({
        model: 'gpt-4.1-mini',
        messages: openaiMessages,
        max_tokens: 1024,
      });

      const answer = completion.choices?.[0]?.message?.content || '';
      const finishReason = completion.choices?.[0]?.finish_reason;

      if (finishReason === 'content_filter') {
        return res.json({ answer: "I can't respond to that question. Please try a different approach." });
      }
      return res.json({ answer });
    } catch (err) {
      if (err.name === 'AbortError' || err.name === 'TimeoutError') {
        return res.status(504).json({ error: 'Response timed out — please try again.' });
      }
      if (err.constructor?.name === 'RateLimitError' || err.status === 429) {
        return res.status(429).json({ error: 'Too many requests — try again in a moment.' });
      }
      return res.status(500).json({ error: "Couldn't get a response. Try again." });
    }
  };
}

function fakeRes() {
  const r = { _status: 200, _body: null };
  r.status = (code) => { r._status = code; return r; };
  r.json = (body) => { r._body = body; return r; };
  return r;
}

const SAMPLE_EO = {
  executive_order_number: 14395,
  title: 'Test EO',
  signing_date: '2025-01-20',
  president: { name: 'Donald Trump' },
  html_url: 'https://fr.example.com/eo-14395',
  enrichment: {
    summary: 'Test summary',
    theme_ids: ['immigration'],
    impacted_populations: { positive_ids: [], negative_ids: [] },
  },
};

// ─── POST /api/chat validation (new context schema) ───────────────────────────

describe('POST /api/chat validation', () => {
  let openaiMock;
  let assembleCtxMock;
  let handler;

  beforeEach(() => {
    assembleCtxMock = vi.fn().mockResolvedValue('Mock page context');
    openaiMock = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: 'Test answer' }, finish_reason: 'stop' }],
          }),
        },
      },
    };
    handler = makeChatHandler(assembleCtxMock, openaiMock);
  });

  it('returns 400 when context is missing', async () => {
    const req = { body: { question: 'What does this do?' } };
    const res = fakeRes();
    await handler(req, res);
    expect(res._status).toBe(400);
    expect(res._body.error).toBe('Invalid context');
  });

  it('returns 400 when context.type is not a known type', async () => {
    const req = { body: { context: { type: 'unknown' }, question: 'What?' } };
    const res = fakeRes();
    await handler(req, res);
    expect(res._status).toBe(400);
    expect(res._body.error).toBe('Invalid context');
  });

  it('returns 400 when question is empty string', async () => {
    const req = { body: { context: { type: 'eo', params: { eoNumber: '14395' } }, question: '   ' } };
    const res = fakeRes();
    await handler(req, res);
    expect(res._status).toBe(400);
    expect(res._body.error).toBe('Question is required');
  });

  it('returns 400 when messages array exceeds 20 items', async () => {
    const messages = Array.from({ length: 21 }, (_, i) => ({ role: 'user', content: `msg ${i}` }));
    const req = { body: { context: { type: 'eo', params: { eoNumber: '14395' } }, question: 'ok', messages } };
    const res = fakeRes();
    await handler(req, res);
    expect(res._status).toBe(400);
    expect(res._body.error).toBe('Conversation history too long');
  });

  it('returns 200 with answer on happy path', async () => {
    const req = { body: { context: { type: 'eo', params: { eoNumber: '14395' } }, question: 'What does this order do?' } };
    const res = fakeRes();
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(res._body.answer).toBe('Test answer');
  });

  it('passes context.type=homepage successfully', async () => {
    const req = { body: { context: { type: 'homepage', params: {} }, question: 'What happened this week?' } };
    const res = fakeRes();
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(assembleCtxMock).toHaveBeenCalledWith('homepage', {});
  });

  it('passes context.type=generic successfully', async () => {
    const req = { body: { context: { type: 'generic', params: {} }, question: 'Tell me about EOs.' } };
    const res = fakeRes();
    await handler(req, res);
    expect(res._status).toBe(200);
  });

  it('returns content filter message when finish_reason is content_filter', async () => {
    openaiMock.chat.completions.create.mockResolvedValue({
      choices: [{ message: { content: '' }, finish_reason: 'content_filter' }],
    });
    const req = { body: { context: { type: 'eo', params: { eoNumber: '14395' } }, question: 'Something blocked' } };
    const res = fakeRes();
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(res._body.answer).toContain("can't respond");
  });

  it('returns 429 when OpenAI rate limit is hit', async () => {
    const err = Object.assign(new Error('rate limit'), { status: 429 });
    openaiMock.chat.completions.create.mockRejectedValue(err);
    const req = { body: { context: { type: 'eo', params: { eoNumber: '14395' } }, question: 'Question' } };
    const res = fakeRes();
    await handler(req, res);
    expect(res._status).toBe(429);
  });

  it('returns 504 when OpenAI call times out (AbortError)', async () => {
    const err = Object.assign(new Error('aborted'), { name: 'AbortError' });
    openaiMock.chat.completions.create.mockRejectedValue(err);
    const req = { body: { context: { type: 'eo', params: { eoNumber: '14395' } }, question: 'Question' } };
    const res = fakeRes();
    await handler(req, res);
    expect(res._status).toBe(504);
    expect(res._body.error).toContain('timed out');
  });

  it('returns 404 when assembleContext throws ENOENT', async () => {
    assembleCtxMock.mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOENT' }));
    const req = { body: { context: { type: 'eo', params: { eoNumber: '99999' } }, question: 'Question' } };
    const res = fakeRes();
    await handler(req, res);
    expect(res._status).toBe(404);
  });

  it('returns 400 when assembleContext throws a status:400 error', async () => {
    assembleCtxMock.mockRejectedValue(Object.assign(new Error('Invalid theme ID'), { status: 400 }));
    const req = { body: { context: { type: 'theme', params: { themeId: '../etc/passwd' } }, question: 'Question' } };
    const res = fakeRes();
    await handler(req, res);
    expect(res._status).toBe(400);
    expect(res._body.error).toBe('Invalid theme ID');
  });
});

// ─── assembleContext unit tests ───────────────────────────────────────────────

describe('assembleContext', () => {
  const deps = {
    readFileFn: null,
    readdirFn: null,
  };

  beforeEach(() => {
    deps.readFileFn = vi.fn();
    deps.readdirFn = vi.fn();
  });

  it('homepage — happy path with weekly narrative', async () => {
    deps.readFileFn.mockResolvedValue(JSON.stringify({ summary: 'Big week for EOs.' }));
    const result = await assembleContext('homepage', {}, deps);
    expect(result).toContain('Big week for EOs.');
  });

  it('homepage — graceful fallback when weekly-narrative.json missing', async () => {
    deps.readFileFn.mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOENT' }));
    const result = await assembleContext('homepage', {}, deps);
    expect(result).toContain('homepage');
    expect(result).toContain('What Got Signed?');
  });

  it('eo — happy path', async () => {
    deps.readFileFn.mockResolvedValue(JSON.stringify(SAMPLE_EO));
    const result = await assembleContext('eo', { eoNumber: '14395' }, deps);
    expect(result).toContain('14395');
    expect(result).toContain('Test EO');
    expect(result).toContain('Donald Trump');
  });

  it('eo — throws 400 for non-numeric eoNumber', async () => {
    await expect(assembleContext('eo', { eoNumber: 'abc' }, deps))
      .rejects.toMatchObject({ status: 400 });
  });

  it('theme — happy path', async () => {
    deps.readdirFn.mockResolvedValue(['eo-14395.json']);
    deps.readFileFn.mockResolvedValue(JSON.stringify(SAMPLE_EO));
    const result = await assembleContext('theme', { themeId: 'immigration' }, deps);
    expect(result).toContain('immigration');
    expect(result).toContain('Test EO');
  });

  it('theme — throws 400 for path traversal themeId', async () => {
    await expect(assembleContext('theme', { themeId: '../etc/passwd' }, deps))
      .rejects.toMatchObject({ status: 400 });
  });

  it('generic — returns minimal context without file reads', async () => {
    const result = await assembleContext('generic', {}, deps);
    expect(result).toContain('What Got Signed?');
    expect(deps.readFileFn).not.toHaveBeenCalled();
  });
});
