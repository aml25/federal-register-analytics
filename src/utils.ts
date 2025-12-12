/**
 * Utility functions for the pipeline
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ThemeRegistry, PopulationRegistry, Theme, Population } from './types.js';
import { TAXONOMY_FILE } from './config.js';
import type { TaxonomyData } from './taxonomy.js';

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

// Category labels for themes
const THEME_CATEGORY_LABELS: Record<string, string> = {
  national_security_defense: 'National Security & Defense',
  immigration: 'Immigration',
  economy_trade: 'Economy & Trade',
  energy_environment: 'Energy & Environment',
  healthcare: 'Healthcare',
  civil_rights_equity: 'Civil Rights & Equity',
  education: 'Education',
  government_operations: 'Government Operations',
  foreign_policy: 'Foreign Policy',
  country_region_specific: 'Country/Region-Specific',
  law_enforcement_justice: 'Law Enforcement & Justice',
  technology_innovation: 'Technology & Innovation',
  infrastructure: 'Infrastructure',
  labor_workforce: 'Labor & Workforce',
  agriculture_rural: 'Agriculture & Rural',
  disaster_emergency: 'Disaster & Emergency',
  administrative_procedural: 'Administrative/Procedural',
  social_cultural: 'Social & Cultural',
  international_institutions: 'International Institutions'
};

/**
 * Load taxonomy from the data folder
 */
async function loadTaxonomyData(): Promise<TaxonomyData> {
  const content = await readFile(TAXONOMY_FILE, 'utf-8');
  return JSON.parse(content) as TaxonomyData;
}

/**
 * Load themes from taxonomy (generates ThemeRegistry format for compatibility)
 */
export async function loadThemes(): Promise<ThemeRegistry> {
  const taxonomy = await loadTaxonomyData();
  const themes: Theme[] = [];
  const now = new Date().toISOString();

  for (const [key, items] of Object.entries(taxonomy.themes)) {
    const category = THEME_CATEGORY_LABELS[key] || key;
    for (const item of items) {
      themes.push({
        id: slugify(item),
        name: item,
        description: category,
        created_at: now
      });
    }
  }

  return {
    themes,
    updated_at: now
  };
}

/**
 * Load populations from taxonomy (generates PopulationRegistry format for compatibility)
 */
export async function loadPopulations(): Promise<PopulationRegistry> {
  const taxonomy = await loadTaxonomyData();
  const populations: Population[] = [];
  const now = new Date().toISOString();
  const pops = taxonomy.impacted_populations;

  const addFromCategory = (items: string[], category: string) => {
    for (const item of items) {
      populations.push({
        id: slugify(item),
        name: item,
        description: category,
        created_at: now
      });
    }
  };

  // Demographic groups
  addFromCategory(pops.demographic_groups.racial_ethnic, 'Demographic Groups > Racial/Ethnic');
  addFromCategory(pops.demographic_groups.gender_identity_sexuality, 'Demographic Groups > Gender Identity & Sexuality');
  addFromCategory(pops.demographic_groups.age_groups, 'Demographic Groups > Age Groups');
  addFromCategory(pops.demographic_groups.religious_groups, 'Demographic Groups > Religious Groups');
  addFromCategory(pops.demographic_groups.disability_status, 'Demographic Groups > Disability Status');

  // Immigration status
  addFromCategory(pops.immigration_status, 'Immigration Status');

  // Employment sectors
  addFromCategory(pops.employment_sectors.government, 'Employment Sectors > Government');
  addFromCategory(pops.employment_sectors.private_sector, 'Employment Sectors > Private Sector');
  addFromCategory(pops.employment_sectors.industry_specific, 'Employment Sectors > Industry-Specific');

  // Economic status
  addFromCategory(pops.economic_status, 'Economic Status');

  // Geographic communities
  addFromCategory(pops.geographic_communities.domestic, 'Geographic Communities > Domestic');
  addFromCategory(pops.geographic_communities.regional, 'Geographic Communities > Regional');

  // Institutional groups
  addFromCategory(pops.institutional_groups.education, 'Institutional Groups > Education');
  addFromCategory(pops.institutional_groups.healthcare, 'Institutional Groups > Healthcare');
  addFromCategory(pops.institutional_groups.justice_system, 'Institutional Groups > Justice System');

  // Special populations
  addFromCategory(pops.special_populations, 'Special Populations');

  // Foreign populations
  addFromCategory(pops.foreign_populations, 'Foreign Populations');

  // Organizational entities
  addFromCategory(pops.organizational_entities, 'Organizational Entities');

  return {
    populations,
    updated_at: now
  };
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
