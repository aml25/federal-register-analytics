/**
 * Taxonomy loader and formatter for executive order enrichment
 *
 * The taxonomy file (taxonomy.json) is the single source of truth for
 * themes and populations. It lives in what-got-signed/data/ for deployment.
 */

import { readFile, appendFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { slugify } from './utils.js';
import { TAXONOMY_FILE } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Guide file stays in metadata-config for documentation and suggestions
export const TAXONOMY_GUIDE_FILE = join(__dirname, '..', 'metadata-config', 'executive_order_taxonomy_guide.md');

// =============================================================================
// TAXONOMY TYPES
// =============================================================================

export interface TaxonomyData {
  impacted_populations: {
    demographic_groups: {
      racial_ethnic: string[];
      gender_identity_sexuality: string[];
      age_groups: string[];
      religious_groups: string[];
      disability_status: string[];
    };
    immigration_status: string[];
    employment_sectors: {
      government: string[];
      private_sector: string[];
      industry_specific: string[];
    };
    economic_status: string[];
    geographic_communities: {
      domestic: string[];
      regional: string[];
    };
    institutional_groups: {
      education: string[];
      healthcare: string[];
      justice_system: string[];
    };
    special_populations: string[];
    foreign_populations: string[];
    organizational_entities: string[];
  };
  themes: {
    national_security_defense: string[];
    immigration: string[];
    economy_trade: string[];
    energy_environment: string[];
    healthcare: string[];
    civil_rights_equity: string[];
    education: string[];
    government_operations: string[];
    foreign_policy: string[];
    country_region_specific: string[];
    law_enforcement_justice: string[];
    technology_innovation: string[];
    infrastructure: string[];
    labor_workforce: string[];
    agriculture_rural: string[];
    disaster_emergency: string[];
    administrative_procedural: string[];
    social_cultural: string[];
    international_institutions: string[];
  };
  impact_type: string[];
  metadata: {
    version: string;
    created: string;
    source: string;
    notes: string;
  };
}

export interface TaxonomyItem {
  id: string;
  name: string;
  category: string;
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
      for (const item of items) {
        const id = slugify(item);
        lines.push(`- ${id}: ${item}`);
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

  // Demographic Groups
  lines.push('\n### Demographic Groups');

  lines.push('\n**Racial/Ethnic:**');
  for (const item of pops.demographic_groups.racial_ethnic) {
    lines.push(`- ${slugify(item)}: ${item}`);
  }

  lines.push('\n**Gender Identity & Sexuality:**');
  for (const item of pops.demographic_groups.gender_identity_sexuality) {
    lines.push(`- ${slugify(item)}: ${item}`);
  }

  lines.push('\n**Age Groups:**');
  for (const item of pops.demographic_groups.age_groups) {
    lines.push(`- ${slugify(item)}: ${item}`);
  }

  lines.push('\n**Religious Groups:**');
  for (const item of pops.demographic_groups.religious_groups) {
    lines.push(`- ${slugify(item)}: ${item}`);
  }

  lines.push('\n**Disability Status:**');
  for (const item of pops.demographic_groups.disability_status) {
    lines.push(`- ${slugify(item)}: ${item}`);
  }

  // Immigration Status
  lines.push('\n### Immigration Status');
  for (const item of pops.immigration_status) {
    lines.push(`- ${slugify(item)}: ${item}`);
  }

  // Employment Sectors
  lines.push('\n### Employment Sectors');

  lines.push('\n**Government:**');
  for (const item of pops.employment_sectors.government) {
    lines.push(`- ${slugify(item)}: ${item}`);
  }

  lines.push('\n**Private Sector:**');
  for (const item of pops.employment_sectors.private_sector) {
    lines.push(`- ${slugify(item)}: ${item}`);
  }

  lines.push('\n**Industry-Specific:**');
  for (const item of pops.employment_sectors.industry_specific) {
    lines.push(`- ${slugify(item)}: ${item}`);
  }

  // Economic Status
  lines.push('\n### Economic Status');
  for (const item of pops.economic_status) {
    lines.push(`- ${slugify(item)}: ${item}`);
  }

  // Geographic Communities
  lines.push('\n### Geographic Communities');

  lines.push('\n**Domestic:**');
  for (const item of pops.geographic_communities.domestic) {
    lines.push(`- ${slugify(item)}: ${item}`);
  }

  lines.push('\n**Regional:**');
  for (const item of pops.geographic_communities.regional) {
    lines.push(`- ${slugify(item)}: ${item}`);
  }

  // Institutional Groups
  lines.push('\n### Institutional Groups');

  lines.push('\n**Education:**');
  for (const item of pops.institutional_groups.education) {
    lines.push(`- ${slugify(item)}: ${item}`);
  }

  lines.push('\n**Healthcare:**');
  for (const item of pops.institutional_groups.healthcare) {
    lines.push(`- ${slugify(item)}: ${item}`);
  }

  lines.push('\n**Justice System:**');
  for (const item of pops.institutional_groups.justice_system) {
    lines.push(`- ${slugify(item)}: ${item}`);
  }

  // Special Populations
  lines.push('\n### Special Populations');
  for (const item of pops.special_populations) {
    lines.push(`- ${slugify(item)}: ${item}`);
  }

  // Foreign Populations
  lines.push('\n### Foreign Populations');
  for (const item of pops.foreign_populations) {
    lines.push(`- ${slugify(item)}: ${item}`);
  }

  // Organizational Entities
  lines.push('\n### Organizational Entities');
  for (const item of pops.organizational_entities) {
    lines.push(`- ${slugify(item)}: ${item}`);
  }

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
    for (const item of items) {
      ids.add(slugify(item));
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

  // Demographic groups
  for (const item of pops.demographic_groups.racial_ethnic) ids.add(slugify(item));
  for (const item of pops.demographic_groups.gender_identity_sexuality) ids.add(slugify(item));
  for (const item of pops.demographic_groups.age_groups) ids.add(slugify(item));
  for (const item of pops.demographic_groups.religious_groups) ids.add(slugify(item));
  for (const item of pops.demographic_groups.disability_status) ids.add(slugify(item));

  // Immigration status
  for (const item of pops.immigration_status) ids.add(slugify(item));

  // Employment sectors
  for (const item of pops.employment_sectors.government) ids.add(slugify(item));
  for (const item of pops.employment_sectors.private_sector) ids.add(slugify(item));
  for (const item of pops.employment_sectors.industry_specific) ids.add(slugify(item));

  // Economic status
  for (const item of pops.economic_status) ids.add(slugify(item));

  // Geographic communities
  for (const item of pops.geographic_communities.domestic) ids.add(slugify(item));
  for (const item of pops.geographic_communities.regional) ids.add(slugify(item));

  // Institutional groups
  for (const item of pops.institutional_groups.education) ids.add(slugify(item));
  for (const item of pops.institutional_groups.healthcare) ids.add(slugify(item));
  for (const item of pops.institutional_groups.justice_system) ids.add(slugify(item));

  // Special populations
  for (const item of pops.special_populations) ids.add(slugify(item));

  // Foreign populations
  for (const item of pops.foreign_populations) ids.add(slugify(item));

  // Organizational entities
  for (const item of pops.organizational_entities) ids.add(slugify(item));

  return ids;
}

// =============================================================================
// LOOKUP HELPERS (for converting IDs to display names)
// =============================================================================

/**
 * Build a map of theme ID -> { name, category } for lookups
 */
export function buildThemeLookup(taxonomy: TaxonomyData): Map<string, TaxonomyItem> {
  const lookup = new Map<string, TaxonomyItem>();

  for (const [key, items] of Object.entries(taxonomy.themes)) {
    const category = THEME_CATEGORY_LABELS[key] || key;
    for (const item of items) {
      const id = slugify(item);
      lookup.set(id, { id, name: item, category });
    }
  }

  return lookup;
}

/**
 * Build a map of population ID -> { name, category } for lookups
 */
export function buildPopulationLookup(taxonomy: TaxonomyData): Map<string, TaxonomyItem> {
  const lookup = new Map<string, TaxonomyItem>();
  const pops = taxonomy.impacted_populations;

  const addToLookup = (items: string[], category: string) => {
    for (const item of items) {
      const id = slugify(item);
      lookup.set(id, { id, name: item, category });
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
// APPEND SUGGESTIONS TO MARKDOWN
// =============================================================================

export interface TaxonomySuggestion {
  eoNumber: number;
  eoTitle: string;
  type: 'theme' | 'population';
  suggestedName: string;
  suggestedCategory: string;
  justification: string;
}

/**
 * Append a suggestion to the taxonomy guide markdown file
 */
export async function appendSuggestionToGuide(suggestion: TaxonomySuggestion): Promise<void> {
  const timestamp = new Date().toISOString().split('T')[0];

  const entry = `
### EO ${suggestion.eoNumber}: ${suggestion.suggestedName}
- **Type:** ${suggestion.type}
- **Suggested Category:** ${suggestion.suggestedCategory}
- **EO Title:** ${suggestion.eoTitle}
- **Justification:** ${suggestion.justification}
- **Date Suggested:** ${timestamp}
`;

  // Check if the suggestions section exists, if not add it
  const content = await readFile(TAXONOMY_GUIDE_FILE, 'utf-8');

  if (!content.includes('## Suggested Additions During Enrichment')) {
    await appendFile(TAXONOMY_GUIDE_FILE, '\n\n---\n\n## Suggested Additions During Enrichment\n\nThe following tags were suggested by the LLM during enrichment but not found in the taxonomy. Review these for potential inclusion.\n');
  }

  await appendFile(TAXONOMY_GUIDE_FILE, entry);
  console.log(`    Suggestion saved: ${suggestion.type} "${suggestion.suggestedName}"`);
}
