/**
 * Taxonomy loader and formatter for executive order enrichment
 *
 * The taxonomy file (taxonomy.json) is the single source of truth for
 * themes and populations. It lives in what-got-signed/data/ for deployment.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { slugify } from './utils.js';
import { TAXONOMY_FILE } from './config.js';

// =============================================================================
// TAXONOMY TYPES
// =============================================================================

export interface TaxonomyEntry {
  name: string;
  definition: string;
}

export interface TaxonomyData {
  themes: {
    national_security_defense: TaxonomyEntry[];
    immigration: TaxonomyEntry[];
    economy_trade: TaxonomyEntry[];
    energy_environment: TaxonomyEntry[];
    healthcare: TaxonomyEntry[];
    civil_rights_equity: TaxonomyEntry[];
    education: TaxonomyEntry[];
    government_operations: TaxonomyEntry[];
    foreign_policy: TaxonomyEntry[];
    country_region_specific: TaxonomyEntry[];
    law_enforcement_justice: TaxonomyEntry[];
    technology_innovation: TaxonomyEntry[];
    infrastructure: TaxonomyEntry[];
    labor_workforce: TaxonomyEntry[];
    agriculture_rural: TaxonomyEntry[];
    disaster_emergency: TaxonomyEntry[];
    administrative_procedural: TaxonomyEntry[];
    social_cultural: TaxonomyEntry[];
    international_institutions: TaxonomyEntry[];
  };
  impacted_populations: {
    demographic_groups: {
      racial_ethnic: TaxonomyEntry[];
      gender_identity_sexuality: TaxonomyEntry[];
      age_groups: TaxonomyEntry[];
      religious_groups: TaxonomyEntry[];
      disability_status: TaxonomyEntry[];
    };
    immigration_status: TaxonomyEntry[];
    employment_sectors: {
      government: TaxonomyEntry[];
      private_sector: TaxonomyEntry[];
      industry_specific: TaxonomyEntry[];
    };
    economic_status: TaxonomyEntry[];
    geographic_communities: {
      domestic: TaxonomyEntry[];
      regional: TaxonomyEntry[];
    };
    institutional_groups: {
      education: TaxonomyEntry[];
      healthcare: TaxonomyEntry[];
      justice_system: TaxonomyEntry[];
    };
    special_populations: TaxonomyEntry[];
    foreign_populations: TaxonomyEntry[];
    organizational_entities: TaxonomyEntry[];
  };
  impact_type: string[];
  metadata: {
    version: string;
    created: string;
    source: string;
    notes: string;
  };
  suggestions: {
    themes: ThemeSuggestion[];
    impacted_populations: PopulationSuggestion[];
  };
}

export interface ThemeSuggestion {
  name: string;
  suggested_category: string;
  eo_number: number;
  eo_title: string;
  justification: string;
  suggested_at: string;
}

export interface PopulationSuggestion {
  name: string;
  suggested_category: string;
  impact_type: string;
  eo_number: number;
  eo_title: string;
  justification: string;
  suggested_at: string;
}

export interface TaxonomyItem {
  id: string;
  name: string;
  category: string;
  definition: string;
}

// Category labels for display
export const THEME_CATEGORY_LABELS: Record<string, string> = {
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

// =============================================================================
// LOAD TAXONOMY
// =============================================================================

let cachedTaxonomy: TaxonomyData | null = null;

export async function loadTaxonomy(): Promise<TaxonomyData> {
  if (cachedTaxonomy) {
    return cachedTaxonomy;
  }

  const content = await readFile(TAXONOMY_FILE, 'utf-8');
  cachedTaxonomy = JSON.parse(content) as TaxonomyData;
  return cachedTaxonomy;
}

/**
 * Clear the cached taxonomy (useful for testing or reloading)
 */
export function clearTaxonomyCache(): void {
  cachedTaxonomy = null;
}

// =============================================================================
// FORMAT TAXONOMY FOR PROMPTS
// =============================================================================

/**
 * Format themes taxonomy as hierarchical text for LLM prompt
 */
export function formatThemesForPrompt(taxonomy: TaxonomyData): string {
  const lines: string[] = [];
  const themes = taxonomy.themes;

  for (const [key, label] of Object.entries(THEME_CATEGORY_LABELS)) {
    const items = themes[key as keyof typeof themes];
    if (items && items.length > 0) {
      lines.push(`\n### ${label}`);
      for (const entry of items) {
        const id = slugify(entry.name);
        lines.push(`- ${id}: ${entry.name}`);
      }
    }
  }

  return lines.join('\n');
}

/**
 * Format populations taxonomy as hierarchical text for LLM prompt
 */
export function formatPopulationsForPrompt(taxonomy: TaxonomyData): string {
  const lines: string[] = [];
  const pops = taxonomy.impacted_populations;

  const formatEntries = (entries: TaxonomyEntry[]) => {
    for (const entry of entries) {
      lines.push(`- ${slugify(entry.name)}: ${entry.name}`);
    }
  };

  // Demographic Groups
  lines.push('\n### Demographic Groups');

  lines.push('\n**Racial/Ethnic:**');
  formatEntries(pops.demographic_groups.racial_ethnic);

  lines.push('\n**Gender Identity & Sexuality:**');
  formatEntries(pops.demographic_groups.gender_identity_sexuality);

  lines.push('\n**Age Groups:**');
  formatEntries(pops.demographic_groups.age_groups);

  lines.push('\n**Religious Groups:**');
  formatEntries(pops.demographic_groups.religious_groups);

  lines.push('\n**Disability Status:**');
  formatEntries(pops.demographic_groups.disability_status);

  // Immigration Status
  lines.push('\n### Immigration Status');
  formatEntries(pops.immigration_status);

  // Employment Sectors
  lines.push('\n### Employment Sectors');

  lines.push('\n**Government:**');
  formatEntries(pops.employment_sectors.government);

  lines.push('\n**Private Sector:**');
  formatEntries(pops.employment_sectors.private_sector);

  lines.push('\n**Industry-Specific:**');
  formatEntries(pops.employment_sectors.industry_specific);

  // Economic Status
  lines.push('\n### Economic Status');
  formatEntries(pops.economic_status);

  // Geographic Communities
  lines.push('\n### Geographic Communities');

  lines.push('\n**Domestic:**');
  formatEntries(pops.geographic_communities.domestic);

  lines.push('\n**Regional:**');
  formatEntries(pops.geographic_communities.regional);

  // Institutional Groups
  lines.push('\n### Institutional Groups');

  lines.push('\n**Education:**');
  formatEntries(pops.institutional_groups.education);

  lines.push('\n**Healthcare:**');
  formatEntries(pops.institutional_groups.healthcare);

  lines.push('\n**Justice System:**');
  formatEntries(pops.institutional_groups.justice_system);

  // Special Populations
  lines.push('\n### Special Populations');
  formatEntries(pops.special_populations);

  // Foreign Populations
  lines.push('\n### Foreign Populations');
  formatEntries(pops.foreign_populations);

  // Organizational Entities
  lines.push('\n### Organizational Entities');
  formatEntries(pops.organizational_entities);

  return lines.join('\n');
}

// =============================================================================
// GET ALL VALID IDS
// =============================================================================

/**
 * Get all valid theme IDs from taxonomy
 */
export function getAllThemeIds(taxonomy: TaxonomyData): Set<string> {
  const ids = new Set<string>();
  const themes = taxonomy.themes;

  for (const key of Object.keys(themes)) {
    const items = themes[key as keyof typeof themes];
    for (const entry of items) {
      ids.add(slugify(entry.name));
    }
  }

  return ids;
}

/**
 * Get all valid population IDs from taxonomy
 */
export function getAllPopulationIds(taxonomy: TaxonomyData): Set<string> {
  const ids = new Set<string>();
  const pops = taxonomy.impacted_populations;

  const addIds = (entries: TaxonomyEntry[]) => {
    for (const entry of entries) {
      ids.add(slugify(entry.name));
    }
  };

  // Demographic groups
  addIds(pops.demographic_groups.racial_ethnic);
  addIds(pops.demographic_groups.gender_identity_sexuality);
  addIds(pops.demographic_groups.age_groups);
  addIds(pops.demographic_groups.religious_groups);
  addIds(pops.demographic_groups.disability_status);

  // Immigration status
  addIds(pops.immigration_status);

  // Employment sectors
  addIds(pops.employment_sectors.government);
  addIds(pops.employment_sectors.private_sector);
  addIds(pops.employment_sectors.industry_specific);

  // Economic status
  addIds(pops.economic_status);

  // Geographic communities
  addIds(pops.geographic_communities.domestic);
  addIds(pops.geographic_communities.regional);

  // Institutional groups
  addIds(pops.institutional_groups.education);
  addIds(pops.institutional_groups.healthcare);
  addIds(pops.institutional_groups.justice_system);

  // Special populations
  addIds(pops.special_populations);

  // Foreign populations
  addIds(pops.foreign_populations);

  // Organizational entities
  addIds(pops.organizational_entities);

  return ids;
}

// =============================================================================
// LOOKUP HELPERS (for converting IDs to display names)
// =============================================================================

/**
 * Build a map of theme ID -> { name, category, definition } for lookups
 */
export function buildThemeLookup(taxonomy: TaxonomyData): Map<string, TaxonomyItem> {
  const lookup = new Map<string, TaxonomyItem>();

  for (const [key, items] of Object.entries(taxonomy.themes)) {
    const category = THEME_CATEGORY_LABELS[key] || key;
    for (const entry of items) {
      const id = slugify(entry.name);
      lookup.set(id, { id, name: entry.name, category, definition: entry.definition });
    }
  }

  return lookup;
}

/**
 * Build a map of population ID -> { name, category, definition } for lookups
 */
export function buildPopulationLookup(taxonomy: TaxonomyData): Map<string, TaxonomyItem> {
  const lookup = new Map<string, TaxonomyItem>();
  const pops = taxonomy.impacted_populations;

  const addToLookup = (entries: TaxonomyEntry[], category: string) => {
    for (const entry of entries) {
      const id = slugify(entry.name);
      lookup.set(id, { id, name: entry.name, category, definition: entry.definition });
    }
  };

  // Demographic groups
  addToLookup(pops.demographic_groups.racial_ethnic, 'Demographic Groups > Racial/Ethnic');
  addToLookup(pops.demographic_groups.gender_identity_sexuality, 'Demographic Groups > Gender Identity & Sexuality');
  addToLookup(pops.demographic_groups.age_groups, 'Demographic Groups > Age Groups');
  addToLookup(pops.demographic_groups.religious_groups, 'Demographic Groups > Religious Groups');
  addToLookup(pops.demographic_groups.disability_status, 'Demographic Groups > Disability Status');

  // Immigration status
  addToLookup(pops.immigration_status, 'Immigration Status');

  // Employment sectors
  addToLookup(pops.employment_sectors.government, 'Employment Sectors > Government');
  addToLookup(pops.employment_sectors.private_sector, 'Employment Sectors > Private Sector');
  addToLookup(pops.employment_sectors.industry_specific, 'Employment Sectors > Industry-Specific');

  // Economic status
  addToLookup(pops.economic_status, 'Economic Status');

  // Geographic communities
  addToLookup(pops.geographic_communities.domestic, 'Geographic Communities > Domestic');
  addToLookup(pops.geographic_communities.regional, 'Geographic Communities > Regional');

  // Institutional groups
  addToLookup(pops.institutional_groups.education, 'Institutional Groups > Education');
  addToLookup(pops.institutional_groups.healthcare, 'Institutional Groups > Healthcare');
  addToLookup(pops.institutional_groups.justice_system, 'Institutional Groups > Justice System');

  // Special populations
  addToLookup(pops.special_populations, 'Special Populations');

  // Foreign populations
  addToLookup(pops.foreign_populations, 'Foreign Populations');

  // Organizational entities
  addToLookup(pops.organizational_entities, 'Organizational Entities');

  return lookup;
}

// =============================================================================
// APPEND SUGGESTIONS TO TAXONOMY JSON
// =============================================================================

export interface TaxonomySuggestion {
  eoNumber: number;
  eoTitle: string;
  type: 'theme' | 'population';
  suggestedName: string;
  suggestedCategory: string;
  impactType?: string;
  justification: string;
}

/**
 * Append a suggestion to the taxonomy.json file
 */
export async function appendSuggestionToTaxonomy(suggestion: TaxonomySuggestion): Promise<void> {
  // Clear cache to ensure we read the latest
  clearTaxonomyCache();

  const taxonomy = await loadTaxonomy();
  const timestamp = new Date().toISOString().split('T')[0];

  if (suggestion.type === 'theme') {
    const themeSuggestion: ThemeSuggestion = {
      name: suggestion.suggestedName,
      suggested_category: suggestion.suggestedCategory,
      eo_number: suggestion.eoNumber,
      eo_title: suggestion.eoTitle,
      justification: suggestion.justification,
      suggested_at: timestamp
    };
    taxonomy.suggestions.themes.push(themeSuggestion);
  } else {
    const populationSuggestion: PopulationSuggestion = {
      name: suggestion.suggestedName,
      suggested_category: suggestion.suggestedCategory,
      impact_type: suggestion.impactType || 'neutral',
      eo_number: suggestion.eoNumber,
      eo_title: suggestion.eoTitle,
      justification: suggestion.justification,
      suggested_at: timestamp
    };
    taxonomy.suggestions.impacted_populations.push(populationSuggestion);
  }

  // Write back to file
  await writeFile(TAXONOMY_FILE, JSON.stringify(taxonomy, null, 2));

  // Clear cache again so next load gets fresh data
  clearTaxonomyCache();

  console.log(`    Suggestion saved: ${suggestion.type} "${suggestion.suggestedName}"`);
}
