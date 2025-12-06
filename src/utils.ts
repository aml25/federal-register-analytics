/**
 * Utility functions for the pipeline
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ThemeRegistry, PopulationRegistry } from './types.js';
import { THEMES_FILE, POPULATIONS_FILE } from './config.js';

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
 * Load the population registry, creating empty one if it doesn't exist
 */
export async function loadPopulations(): Promise<PopulationRegistry> {
  const existing = await readJson<PopulationRegistry>(POPULATIONS_FILE);
  if (existing) {
    return existing;
  }

  const empty: PopulationRegistry = {
    populations: [],
    updated_at: new Date().toISOString()
  };
  await writeJson(POPULATIONS_FILE, empty);
  return empty;
}

/**
 * Save the population registry
 */
export async function savePopulations(registry: PopulationRegistry): Promise<void> {
  registry.updated_at = new Date().toISOString();
  await writeJson(POPULATIONS_FILE, registry);
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
 * Supports both --key=value and --key value formats
 */
export function parseArgs(args: string[]): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const eqIndex = arg.indexOf('=');
      if (eqIndex !== -1) {
        // --key=value format
        const key = arg.slice(2, eqIndex);
        const value = arg.slice(eqIndex + 1);
        result[key] = value;
      } else {
        // --key value or --flag format
        const key = arg.slice(2);
        const nextArg = args[i + 1];
        if (nextArg && !nextArg.startsWith('--')) {
          result[key] = nextArg;
          i++; // Skip the next arg since we consumed it as a value
        } else {
          result[key] = true;
        }
      }
    }
  }

  return result;
}
