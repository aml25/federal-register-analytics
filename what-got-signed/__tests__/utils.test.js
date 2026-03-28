// Tests for public/utils.js — wrapPresidentNames, linkThemeNames, escapeRegex
// Loads the browser globals file via vm.runInContext so we test the actual production code.

import { describe, it, expect, beforeAll } from 'vitest';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const utilsCode = readFileSync(join(__dirname, '../public/utils.js'), 'utf-8');

/** @type {{ escapeRegex: Function, wrapPresidentNames: Function, linkThemeNames: Function }} */
let utils;

beforeAll(() => {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(utilsCode, ctx);
  utils = ctx;
});

// ─── escapeRegex ─────────────────────────────────────────────────────────────

describe('escapeRegex', () => {
  it('escapes regex special characters', () => {
    expect(utils.escapeRegex('a.b*c?')).toBe('a\\.b\\*c\\?');
  });

  it('passes through plain strings unchanged', () => {
    expect(utils.escapeRegex('hello world')).toBe('hello world');
  });

  it('escapes parentheses and brackets', () => {
    expect(utils.escapeRegex('(a|b)[c]')).toBe('\\(a\\|b\\)\\[c\\]');
  });
});

// ─── wrapPresidentNames ──────────────────────────────────────────────────────

describe('wrapPresidentNames', () => {
  it('wraps full name with span and data-president attribute', () => {
    const result = utils.wrapPresidentNames('Donald Trump signed this.', 'Donald Trump');
    expect(result).toContain('data-president=');
    expect(result).toContain('Donald Trump');
  });

  it('wraps last name only', () => {
    const result = utils.wrapPresidentNames('Trump signed this.', 'Donald Trump');
    expect(result).toContain('data-president=');
  });

  it('returns text unchanged when name is not present', () => {
    const text = 'No president mentioned here.';
    const result = utils.wrapPresidentNames(text, 'Joe Biden');
    expect(result).toBe(text);
  });

  it('handles multi-word last names', () => {
    // Roosevelt → "Roosevelt" should be matched
    const result = utils.wrapPresidentNames('Roosevelt signed the order.', 'Theodore Roosevelt');
    expect(result).toContain('data-president=');
  });
});

// ─── linkThemeNames ──────────────────────────────────────────────────────────

describe('linkThemeNames', () => {
  const themes = [
    { id: 'immigration', name: 'Immigration' },
    { id: 'national_security_defense', name: 'National Security' },
  ];

  it('links theme names in text', () => {
    const text = 'This EO concerns immigration policy.';
    const result = utils.linkThemeNames(text, themes);
    expect(result).toContain('href="/detail/theme/immigration"');
    expect(result).toContain('wa-link');
  });

  it('links theme names case-insensitively', () => {
    const text = 'IMMIGRATION was the main topic.';
    const result = utils.linkThemeNames(text, themes);
    expect(result).toContain('href="/detail/theme/immigration"');
  });

  it('does not double-link already-linked text', () => {
    // If theme appears twice, it should link both occurrences
    const text = 'immigration and immigration are mentioned.';
    const result = utils.linkThemeNames(text, themes);
    const linkCount = (result.match(/href="\/detail\/theme\/immigration"/g) || []).length;
    expect(linkCount).toBe(2);
  });

  it('links multi-word theme names', () => {
    const text = 'national security was discussed.';
    const result = utils.linkThemeNames(text, themes);
    expect(result).toContain('href="/detail/theme/national_security_defense"');
  });

  it('returns text unchanged when no themes match', () => {
    const text = 'Healthcare policy was the focus.';
    const result = utils.linkThemeNames(text, themes);
    expect(result).toBe(text);
  });

  it('handles empty themes array', () => {
    const text = 'Some text here.';
    expect(utils.linkThemeNames(text, [])).toBe(text);
  });
});
