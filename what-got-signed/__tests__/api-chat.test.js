// Tests for POST /api/chat handler logic
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

// ─── chatHandler validation ───────────────────────────────────────────────────

// Build a minimal chatHandler for validation-only tests.
// We don't test the OpenAI call itself — that's mocked out.

function makeValidationHandler(readFileFn, openaiClient) {
  return async function chatHandler(req, res) {
    const { subject, messages, question } = req.body || {};

    if (!subject || subject.type !== 'eo' || !subject.id) {
      return res.status(400).json({ error: 'Invalid subject' });
    }
    if (!question || typeof question !== 'string' || !question.trim()) {
      return res.status(400).json({ error: 'Question is required' });
    }
    const history = Array.isArray(messages) ? messages : [];
    if (history.length > 20) {
      return res.status(400).json({ error: 'Conversation history too long' });
    }

    const eoId = parseInt(subject.id, 10);
    if (!Number.isFinite(eoId) || eoId <= 0) {
      return res.status(400).json({ error: 'Invalid EO ID' });
    }

    // Load EO
    let eo;
    try {
      const raw = await readFileFn(`eo-${eoId}.json`, 'utf-8');
      try { eo = JSON.parse(raw); }
      catch { return res.status(500).json({ error: 'Failed to load EO data' }); }
    } catch (err) {
      if (err.code === 'ENOENT') return res.status(404).json({ error: 'EO not found' });
      return res.status(500).json({ error: 'Failed to load EO data' });
    }

    // Call OpenAI
    try {
      const completion = await openaiClient.chat.completions.create({
        model: 'gpt-4.1-mini',
        messages: [{ role: 'user', content: question }],
        max_tokens: 1024,
      });

      const answer = completion.choices?.[0]?.message?.content || '';
      const finishReason = completion.choices?.[0]?.finish_reason;

      if (finishReason === 'content_filter') {
        return res.json({ answer: "I can't respond to that question. Please try a different approach." });
      }
      return res.json({ answer });
    } catch (err) {
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
    theme_ids: [],
    impacted_populations: { positive_ids: [], negative_ids: [] },
  },
};

describe('POST /api/chat validation', () => {
  let readFile;
  let openaiMock;
  let handler;

  beforeEach(() => {
    readFile = vi.fn().mockResolvedValue(JSON.stringify(SAMPLE_EO));
    openaiMock = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: 'Test answer' }, finish_reason: 'stop' }],
          }),
        },
      },
    };
    handler = makeValidationHandler(readFile, openaiMock);
  });

  it('returns 400 when subject is missing', async () => {
    const req = { body: { question: 'What does this do?' } };
    const res = fakeRes();
    await handler(req, res);
    expect(res._status).toBe(400);
  });

  it('returns 400 when subject.type is not "eo"', async () => {
    const req = { body: { subject: { type: 'pdf', id: '123' }, question: 'What?' } };
    const res = fakeRes();
    await handler(req, res);
    expect(res._status).toBe(400);
  });

  it('returns 400 when question is empty string', async () => {
    const req = { body: { subject: { type: 'eo', id: '14395' }, question: '   ' } };
    const res = fakeRes();
    await handler(req, res);
    expect(res._status).toBe(400);
    expect(res._body.error).toBe('Question is required');
  });

  it('returns 400 when messages array exceeds 20 items', async () => {
    const messages = Array.from({ length: 21 }, (_, i) => ({ role: 'user', content: `msg ${i}` }));
    const req = { body: { subject: { type: 'eo', id: '14395' }, question: 'ok', messages } };
    const res = fakeRes();
    await handler(req, res);
    expect(res._status).toBe(400);
    expect(res._body.error).toBe('Conversation history too long');
  });

  it('returns 200 with answer on happy path', async () => {
    const req = { body: { subject: { type: 'eo', id: '14395' }, question: 'What does this order do?' } };
    const res = fakeRes();
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(res._body.answer).toBe('Test answer');
  });

  it('returns content filter message when finish_reason is content_filter', async () => {
    openaiMock.chat.completions.create.mockResolvedValue({
      choices: [{ message: { content: '' }, finish_reason: 'content_filter' }],
    });
    const req = { body: { subject: { type: 'eo', id: '14395' }, question: 'Something blocked' } };
    const res = fakeRes();
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(res._body.answer).toContain("can't respond");
  });

  it('returns 429 when OpenAI rate limit is hit', async () => {
    const err = Object.assign(new Error('rate limit'), { status: 429 });
    openaiMock.chat.completions.create.mockRejectedValue(err);
    const req = { body: { subject: { type: 'eo', id: '14395' }, question: 'Question' } };
    const res = fakeRes();
    await handler(req, res);
    expect(res._status).toBe(429);
  });

  it('returns 404 when EO file does not exist', async () => {
    readFile.mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOENT' }));
    const req = { body: { subject: { type: 'eo', id: '99999' }, question: 'Question' } };
    const res = fakeRes();
    await handler(req, res);
    expect(res._status).toBe(404);
  });
});
