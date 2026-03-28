// Tests for GET /api/eo/:eoNumber route logic
// Tests the handler in isolation using fake req/res objects + mocked readFile.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { join } from 'node:path';

// We test the handler logic directly rather than importing the full server.js
// (which has top-level side effects: OpenAI init, app.listen).

const DATA_DIR = '/fake/data';

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

// Inline implementation matching server.js GET /api/eo/:eoNumber
function makeEoHandler(readFileFn) {
  return async function eoHandler(req, res) {
    const eoNumber = parseInt(req.params.eoNumber, 10);
    if (!Number.isFinite(eoNumber) || eoNumber <= 0) {
      return res.status(400).json({ error: 'Invalid EO number' });
    }
    const filePath = join(DATA_DIR, 'enriched', `eo-${eoNumber}.json`);
    try {
      const raw = await readFileFn(filePath, 'utf-8');
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        return res.status(500).json({ error: 'Failed to parse EO data' });
      }
      return res.json(data);
    } catch (err) {
      if (err.code === 'ENOENT') {
        return res.status(404).json({ error: 'EO not found' });
      }
      return res.status(500).json({ error: 'Failed to load EO' });
    }
  };
}

function fakeRes() {
  const r = { _status: 200, _body: null };
  r.status = (code) => { r._status = code; return r; };
  r.json = (body) => { r._body = body; return r; };
  return r;
}

describe('GET /api/eo/:eoNumber handler', () => {
  let readFile;
  let handler;

  beforeEach(() => {
    readFile = vi.fn();
    handler = makeEoHandler(readFile);
  });

  it('returns 200 with EO JSON on happy path', async () => {
    readFile.mockResolvedValue(JSON.stringify(SAMPLE_EO));
    const req = { params: { eoNumber: '14395' } };
    const res = fakeRes();
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(res._body.executive_order_number).toBe(14395);
    expect(res._body.title).toBe('Test EO');
  });

  it('returns 404 when file does not exist (ENOENT)', async () => {
    const err = Object.assign(new Error('not found'), { code: 'ENOENT' });
    readFile.mockRejectedValue(err);
    const req = { params: { eoNumber: '99999' } };
    const res = fakeRes();
    await handler(req, res);
    expect(res._status).toBe(404);
    expect(res._body.error).toBe('EO not found');
  });

  it('returns 500 when JSON is malformed', async () => {
    readFile.mockResolvedValue('{ invalid json {{{{');
    const req = { params: { eoNumber: '14395' } };
    const res = fakeRes();
    await handler(req, res);
    expect(res._status).toBe(500);
    expect(res._body.error).toBe('Failed to parse EO data');
  });

  it('returns 400 for non-numeric EO number', async () => {
    const req = { params: { eoNumber: 'abc' } };
    const res = fakeRes();
    await handler(req, res);
    expect(res._status).toBe(400);
    expect(res._body.error).toBe('Invalid EO number');
  });

  it('returns 400 for zero', async () => {
    const req = { params: { eoNumber: '0' } };
    const res = fakeRes();
    await handler(req, res);
    expect(res._status).toBe(400);
  });

  it('returns 400 for negative EO number', async () => {
    const req = { params: { eoNumber: '-5' } };
    const res = fakeRes();
    await handler(req, res);
    expect(res._status).toBe(400);
  });
});
