import { describe, it, expect, vi, beforeEach } from 'vitest';
import { withRetry, requireJson } from '../utils.js';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ---------------------------------------------------------------------------
// withRetry
// ---------------------------------------------------------------------------

describe('withRetry', () => {
  it('returns result immediately on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries and succeeds on second attempt', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValue('ok');
    const result = await withRetry(fn, () => true, 3);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('exhausts all attempts and throws the last error', async () => {
    const err = new Error('always fails');
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withRetry(fn, () => true, 3)).rejects.toThrow('always fails');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws immediately on non-retryable error', async () => {
    const err = new Error('fatal');
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withRetry(fn, () => false, 3)).rejects.toThrow('fatal');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// requireJson
// ---------------------------------------------------------------------------

describe('requireJson', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
  });

  it('returns typed data for a valid JSON file', async () => {
    const path = join(tmpDir, 'valid.json');
    await writeFile(path, JSON.stringify({ foo: 'bar' }), 'utf-8');
    const result = await requireJson<{ foo: string }>(path);
    expect(result.foo).toBe('bar');
  });

  it('throws with the path in the message when file is missing', async () => {
    const path = join(tmpDir, 'missing.json');
    await expect(requireJson(path)).rejects.toThrow(path);
  });

  it('throws (not silent null) when file contains corrupt JSON', async () => {
    const path = join(tmpDir, 'corrupt.json');
    await writeFile(path, '{ not valid json', 'utf-8');
    await expect(requireJson(path)).rejects.toThrow();
  });
});
