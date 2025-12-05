/**
 * Utility functions for the pipeline
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ThemeRegistry } from './types.js';
import { THEMES_FILE } from './config.js';

/**
 * Ensure a directory exists, creating it if necessary
 */
export async function ensureDir(dirPath: string): Promise<void> {
  if (!existsSync(dirPath)) {
    await mkdir(dirPath, { recursive: true });
  }
}

/**
 * Read JSON file with type safety
 */
export async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

/**
 * Write JSON file with pretty printing
 */
export async function writeJson<T>(filePath: string, data: T): Promise<void> {
  await ensureDir(dirname(filePath));
  await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Load the theme registry, creating empty one if it doesn't exist
 */
export async function loadThemes(): Promise<ThemeRegistry> {
  const existing = await readJson<ThemeRegistry>(THEMES_FILE);
  if (existing) {
    return existing;
  }

  const empty: ThemeRegistry = {
    themes: [],
    updated_at: new Date().toISOString()
  };
  await writeJson(THEMES_FILE, empty);
  return empty;
}

/**
 * Save the theme registry
 */
export async function saveThemes(registry: ThemeRegistry): Promise<void> {
  registry.updated_at = new Date().toISOString();
  await writeJson(THEMES_FILE, registry);
}

/**
 * Generate a slug ID from a theme name
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Sleep for a specified number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Parse command line arguments
 */
export function parseArgs(args: string[]): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};

  for (const arg of args) {
    if (arg.startsWith('--')) {
      const [key, value] = arg.slice(2).split('=');
      result[key] = value ?? true;
    }
  }

  return result;
}
