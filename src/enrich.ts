/**
 * Enrich executive orders with LLM-generated metadata
 */

import OpenAI from 'openai';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ENRICHED_DIR, OPENAI_MODEL, OPENAI_MODEL_POPULATIONS, ENRICH_DELAY_MS } from './config.js';
import { loadThemes, saveThemes, loadPopulations, savePopulations, readJson, writeJson, slugify, sleep } from './utils.js';
import { loadRawOrders } from './fetch.js';
import type {
  RawExecutiveOrder,
  EnrichedExecutiveOrder,
  ThemeRegistry,
  PopulationRegistry,
  Theme,
  Population,
  LLMFirstPassResponse,
  LLMPopulationsResponse,
  Enrichment
} from './types.js';

const openai = new OpenAI();

/**
 * Fetch full text for an executive order from its raw_text_url
 */
export async function fetchFullText(order: RawExecutiveOrder): Promise<string | null> {
  if (!order.raw_text_url) {
    return null;
  }

  try {
    console.log(`    Fetching full text...`);
    const response = await fetch(order.raw_text_url);
    if (response.ok) {
      return await response.text();
    }
  } catch (err) {
    console.warn(`    Warning: Could not fetch full text`);
  }

  return null;
}

/**
 * Build the first pass prompt (summary, themes, concerns - NO populations)
 */
function buildFirstPassPrompt(
  order: RawExecutiveOrder,
  fullText: string | null,
  themes: ThemeRegistry
): string {
  const themesList = themes.themes.length > 0
    ? themes.themes.map(t => `- ${t.id}: ${t.name} - ${t.description}`).join('\n')
    : '(No themes defined yet)';

  return `You are analyzing an executive order to extract structured metadata.

## Executive Order Information

**EO Number:** ${order.executive_order_number}
**Title:** ${order.title}
**Signing Date:** ${order.signing_date}
**President:** ${order.president.name}

**Abstract:**
${order.abstract || '(No abstract available)'}

**Full Text:**
${fullText || '(Full text not available - use abstract and title only)'}

## Existing Themes

These themes have already been identified from other executive orders. Prefer using these when they fit:

${themesList}

## Your Task

Analyze this executive order and provide:

1. **Summary**: A plain-language summary (2-3 sentences) that a non-expert could understand. Focus on what the order actually does, not bureaucratic language.

2. **Themes**: Identify the main policy themes/categories.
   - STRONGLY prefer using existing themes - only propose new ones if absolutely necessary
   - CRITICAL: Only list theme IDs in "existing_theme_ids" if they EXACTLY match an ID from the Existing Themes list above
   - If a theme you want to use is NOT in the existing list, you MUST add it to "proposed_themes" with a full name and description
   - Themes should be reusable across multiple executive orders
   - Use lowercase with dashes for names (e.g., "national-security", "foreign-policy")
   - Aim for 2-3 word theme names that are descriptive but not overly specific
   - BAD (too specific): "semiconductor-manufacturing", "tiktok-ban", "investment-facilitation-and-regulatory-simplification"
   - BAD (too broad): "policy", "government", "economy"
   - GOOD (balanced): "trade-policy", "immigration-enforcement", "federal-workforce", "artificial-intelligence", "environmental-regulation"

3. **Potential Concerns**: Identify potential concerns related to this order. Consider:
   - Unintended consequences that could arise from implementation
   - Risks or potential downsides
   - Points of controversy or debate
   - Implementation challenges
   - Areas that critics, experts, or affected parties might worry about
   - Provide 2-5 concise, specific concerns (one sentence each)

Respond in this exact JSON format:
{
  "summary": "Plain language summary here...",
  "existing_theme_ids": ["trade-policy", "national-security"],
  "proposed_themes": [
    {
      "name": "theme-name-here",
      "description": "Brief description of what this theme covers",
      "justification": "Why this theme is needed and different from existing themes"
    }
  ],
  "potential_concerns": [
    "Concern 1 in one sentence.",
    "Concern 2 in one sentence."
  ]
}`;
}

/**
 * Build the second pass prompt (populations only - using advanced model)
 */
function buildPopulationsPrompt(
  order: RawExecutiveOrder,
  fullText: string | null,
  summary: string,
  populations: PopulationRegistry
): string {
  const populationsList = populations.populations.length > 0
    ? populations.populations.map(p => `- ${p.id}: ${p.name} - ${p.description}`).join('\n')
    : '(No populations defined yet)';

  return `You are a policy analyst identifying which groups are DIRECTLY and MEANINGFULLY impacted by an executive order.

## Executive Order Information

**EO Number:** ${order.executive_order_number}
**Title:** ${order.title}
**Signing Date:** ${order.signing_date}
**President:** ${order.president.name}

**Summary (already generated):**
${summary}

**Abstract:**
${order.abstract || '(No abstract available)'}

**Full Text:**
${fullText || '(Full text not available - use abstract and title only)'}

## Existing Impacted Populations

IMPORTANT: You MUST STRONGLY consider populations from this list. Only propose new ones if absolutely no existing population fits.

${populationsList}

## CRITICAL: Direct vs Indirect Impact

Only tag populations that are DIRECTLY and MEANINGFULLY impacted. Do NOT tag populations that merely:
- Implement or administer the policy (federal employees implement most orders - that's not "impact")
- Are tangentially related
- Might theoretically be affected in some minor way

**WRONG approach:**
- Tagging "federal-employees" on every order because they implement federal policy
- Tagging "taxpayers" on every order because government costs money
- Tagging "american-consumers" on every trade order

**RIGHT approach:**
- Tag "federal-employees" ONLY when the order specifically changes their pay, benefits, hiring, working conditions, or job security
- Tag "taxpayers" ONLY when there's a significant, direct fiscal impact explicitly discussed
- Tag specific groups whose lives, livelihoods, or rights are directly changed by the order
- Also consider at least one politically-driven impact to a population. For example, an order that helps faith-based organizations might indirectly negatively impact religious freedom advocates who fight for keeping the government out of religious bias

## Guidelines

1. **BE SELECTIVE**: Most orders should have 2-4 total populations tagged, not 6-10
2. **USE EXISTING POPULATIONS**: Strongly prefer the list above. Propose new ones only if truly necessary.
3. **KEEP IT BROAD**: Use general categories, not hyper-specific ones
   - WRONG: "long-island-railroad-workers", "tiktok-users-under-18", "wilmerhale-clients"
   - RIGHT: "railroad-workers", "social-media-users", "law-firm-clients"
4. **MAX 1 NEW POPULATION**: Propose at most 1 new population per category (positive/negative). Usually propose none.

## Negative Impacts

Most orders have trade-offs. Identify 1-2 groups that face genuine negative consequences:
- Resource reallocation (who loses funding/priority?)
- Regulatory burden (who faces new compliance costs?)
- Competition effects (if one group is favored, who is disadvantaged?)
- Foreign entities affected by domestic preference or sanctions

If an order is purely ceremonial/symbolic with no real policy impact, it's okay to have empty negative impacts.

Respond in this exact JSON format:
{
  "existing_population_ids": {
    "positive": ["tech-industry"],
    "negative": ["foreign-suppliers"]
  },
  "proposed_populations": {
    "positive": [],
    "negative": []
  }
}`;
}

/**
 * Call OpenAI for first pass (summary, themes, concerns)
 */
async function callFirstPassLLM(prompt: string): Promise<LLMFirstPassResponse> {
  const response = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    max_completion_tokens: 2048,
    messages: [
      {
        role: 'user',
        content: prompt
      }
    ]
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('No text response from OpenAI (first pass)');
  }

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Could not find JSON in OpenAI response (first pass)');
  }

  return JSON.parse(jsonMatch[0]) as LLMFirstPassResponse;
}

/**
 * Call OpenAI for second pass (populations) using advanced model
 */
async function callPopulationsLLM(prompt: string): Promise<LLMPopulationsResponse> {
  const response = await openai.chat.completions.create({
    model: OPENAI_MODEL_POPULATIONS,
    max_completion_tokens: 2048,
    messages: [
      {
        role: 'user',
        content: prompt
      }
    ]
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('No text response from OpenAI (populations pass)');
  }

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Could not find JSON in OpenAI response (populations pass)');
  }

  return JSON.parse(jsonMatch[0]) as LLMPopulationsResponse;
}

/**
 * Get the file path for an enriched order
 */
function getEnrichedPath(eoNumber: number): string {
  return join(ENRICHED_DIR, `eo-${eoNumber}.json`);
}

/**
 * Check if an order has already been enriched
 */
function isEnriched(eoNumber: number): boolean {
  return existsSync(getEnrichedPath(eoNumber));
}

/**
 * Load an existing enriched order
 */
async function loadEnrichedOrder(eoNumber: number): Promise<EnrichedExecutiveOrder | null> {
  const path = getEnrichedPath(eoNumber);
  if (!existsSync(path)) {
    return null;
  }
  return readJson<EnrichedExecutiveOrder>(path);
}

/**
 * Clean up orphaned populations that are no longer referenced by any enriched EO
 */
async function cleanOrphanedPopulations(populations: PopulationRegistry): Promise<number> {
  const { readdirSync } = await import('node:fs');

  // Get all enriched order files
  const enrichedFiles = readdirSync(ENRICHED_DIR)
    .filter(f => f.startsWith('eo-') && f.endsWith('.json'))
    .map(f => parseInt(f.replace('eo-', '').replace('.json', ''), 10))
    .filter(n => !isNaN(n));

  // Collect all population IDs used across all enriched EOs
  const usedPopulationIds = new Set<string>();

  for (const eoNum of enrichedFiles) {
    const enriched = await loadEnrichedOrder(eoNum);
    if (enriched?.enrichment?.impacted_populations) {
      for (const id of enriched.enrichment.impacted_populations.positive_ids || []) {
        usedPopulationIds.add(id);
      }
      for (const id of enriched.enrichment.impacted_populations.negative_ids || []) {
        usedPopulationIds.add(id);
      }
    }
  }

  // Find orphaned populations
  const orphanedIds = populations.populations
    .filter(p => !usedPopulationIds.has(p.id))
    .map(p => p.id);

  if (orphanedIds.length === 0) {
    return 0;
  }

  // Remove orphaned populations
  console.log(`\nCleaning up ${orphanedIds.length} orphaned population(s):`);
  for (const id of orphanedIds) {
    const pop = populations.populations.find(p => p.id === id);
    console.log(`  - ${pop?.name || id}`);
  }

  populations.populations = populations.populations.filter(p => usedPopulationIds.has(p.id));
  populations.updated_at = new Date().toISOString();

  return orphanedIds.length;
}

/**
 * Convert a slug or name to a proper display name
 * e.g., "privacy-and-data-security" -> "Privacy And Data Security"
 */
function toDisplayName(nameOrSlug: string): string {
  // If it contains dashes and no spaces, it's likely a slug
  if (nameOrSlug.includes('-') && !nameOrSlug.includes(' ')) {
    return nameOrSlug.split('-').map(word =>
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
  }
  // Otherwise assume it's already a proper name
  return nameOrSlug;
}

/**
 * Add proposed themes to the registry
 */
function addProposedThemes(
  registry: ThemeRegistry,
  proposed: LLMFirstPassResponse['proposed_themes']
): string[] {
  const newIds: string[] = [];

  if (!proposed || !Array.isArray(proposed)) {
    return newIds;
  }

  for (const theme of proposed) {
    // Skip invalid entries
    if (!theme || !theme.name || typeof theme.name !== 'string') {
      console.log(`    Skipping invalid theme entry: ${JSON.stringify(theme)}`);
      continue;
    }

    const id = slugify(theme.name);

    // Check if theme already exists
    if (registry.themes.some(t => t.id === id)) {
      console.log(`    Theme "${id}" already exists, skipping`);
      newIds.push(id);
      continue;
    }

    const newTheme: Theme = {
      id,
      name: toDisplayName(theme.name),
      description: theme.description,
      created_at: new Date().toISOString()
    };

    registry.themes.push(newTheme);
    newIds.push(id);
    console.log(`    Added new theme: ${newTheme.name}`);
  }

  return newIds;
}

/**
 * Add proposed populations to the registry
 */
function addProposedPopulations(
  registry: PopulationRegistry,
  proposed: LLMPopulationsResponse['proposed_populations']['positive'] | LLMPopulationsResponse['proposed_populations']['negative']
): string[] {
  const newIds: string[] = [];

  if (!proposed || !Array.isArray(proposed)) {
    return newIds;
  }

  for (const pop of proposed) {
    // Skip invalid entries
    if (!pop || !pop.name || typeof pop.name !== 'string') {
      console.log(`    Skipping invalid population entry: ${JSON.stringify(pop)}`);
      continue;
    }

    const id = slugify(pop.name);

    // Check if population already exists
    if (registry.populations.some(p => p.id === id)) {
      newIds.push(id);
      continue;
    }

    const newPop: Population = {
      id,
      name: toDisplayName(pop.name),
      description: pop.description,
      created_at: new Date().toISOString()
    };

    registry.populations.push(newPop);
    newIds.push(id);
    console.log(`    Added new population: ${newPop.name}`);
  }

  return newIds;
}

/**
 * Enrich a single executive order (two-pass approach)
 */
async function enrichOrder(
  order: RawExecutiveOrder,
  themes: ThemeRegistry,
  populations: PopulationRegistry
): Promise<EnrichedExecutiveOrder> {
  // Fetch full text on demand
  const fullText = await fetchFullText(order);

  // =====================================================================
  // FIRST PASS: Summary, themes, concerns (using fast model)
  // =====================================================================
  console.log(`    [Pass 1/${OPENAI_MODEL}] Summary, themes, concerns...`);
  const firstPassPrompt = buildFirstPassPrompt(order, fullText, themes);
  const firstPassResponse = await callFirstPassLLM(firstPassPrompt);

  // Add any proposed themes to the registry
  const newThemeIds = addProposedThemes(themes, firstPassResponse.proposed_themes || []);

  // Combine existing and new theme IDs
  const allThemeIds = [...(firstPassResponse.existing_theme_ids || []), ...newThemeIds];

  // Auto-create any "existing" theme IDs that don't actually exist
  for (const id of firstPassResponse.existing_theme_ids || []) {
    if (!themes.themes.some(t => t.id === id)) {
      const name = id.split('-').map(word =>
        word.charAt(0).toUpperCase() + word.slice(1)
      ).join(' ');
      const description = `Policies related to ${id.replace(/-/g, ' ')} and associated regulatory, administrative, or legislative actions.`;
      const newTheme: Theme = {
        id,
        name,
        description,
        created_at: new Date().toISOString()
      };
      themes.themes.push(newTheme);
      console.log(`    Auto-added theme "${name}" - consider reviewing description`);
    }
  }

  const validThemeIds = allThemeIds.filter(id =>
    themes.themes.some(t => t.id === id)
  );

  // =====================================================================
  // SECOND PASS: Populations (using advanced model for nuanced analysis)
  // =====================================================================
  console.log(`    [Pass 2/${OPENAI_MODEL_POPULATIONS}] Population analysis...`);
  const populationsPrompt = buildPopulationsPrompt(order, fullText, firstPassResponse.summary, populations);
  const populationsResponse = await callPopulationsLLM(populationsPrompt);

  // Add any proposed populations to the registry
  const newPositivePopIds = addProposedPopulations(populations, populationsResponse.proposed_populations?.positive || []);
  const newNegativePopIds = addProposedPopulations(populations, populationsResponse.proposed_populations?.negative || []);

  // Auto-create any "existing" population IDs that don't actually exist
  const allExistingPopIds = [
    ...(populationsResponse.existing_population_ids?.positive || []),
    ...(populationsResponse.existing_population_ids?.negative || [])
  ];
  for (const id of allExistingPopIds) {
    if (!populations.populations.some(p => p.id === id)) {
      const name = id.split('-').map(word =>
        word.charAt(0).toUpperCase() + word.slice(1)
      ).join(' ');
      const description = `Individuals, organizations, or entities categorized as ${id.replace(/-/g, ' ')} who may be affected by federal policies.`;
      const newPop: Population = {
        id,
        name,
        description,
        created_at: new Date().toISOString()
      };
      populations.populations.push(newPop);
      console.log(`    Auto-added population "${name}" - consider reviewing description`);
    }
  }

  // Combine existing and new population IDs
  const allPositivePopIds = [...(populationsResponse.existing_population_ids?.positive || []), ...newPositivePopIds];
  const allNegativePopIds = [...(populationsResponse.existing_population_ids?.negative || []), ...newNegativePopIds];

  const validPositivePopIds = allPositivePopIds.filter(id =>
    populations.populations.some(p => p.id === id)
  );
  const validNegativePopIds = allNegativePopIds.filter(id =>
    populations.populations.some(p => p.id === id)
  );

  // =====================================================================
  // Combine results from both passes
  // =====================================================================
  const enrichment: Enrichment = {
    summary: firstPassResponse.summary,
    theme_ids: validThemeIds,
    impacted_populations: {
      positive_ids: validPositivePopIds,
      negative_ids: validNegativePopIds
    },
    potential_concerns: firstPassResponse.potential_concerns,
    enriched_at: new Date().toISOString(),
    model_used: `${OPENAI_MODEL} + ${OPENAI_MODEL_POPULATIONS}`
  };

  return {
    ...order,
    enrichment
  };
}

/**
 * Re-run only pass 2 (population analysis) on an already-enriched order
 * Preserves summary, themes, and concerns from the original enrichment
 */
async function rerunPopulationsPass(
  enrichedOrder: EnrichedExecutiveOrder,
  populations: PopulationRegistry
): Promise<EnrichedExecutiveOrder> {
  // Fetch full text on demand (needed for population analysis)
  const fullText = await fetchFullText(enrichedOrder);

  // Use the existing summary from pass 1
  const existingSummary = enrichedOrder.enrichment.summary;

  // Run pass 2 (populations) using advanced model
  console.log(`    [Pass 2 only/${OPENAI_MODEL_POPULATIONS}] Population analysis...`);
  const populationsPrompt = buildPopulationsPrompt(enrichedOrder, fullText, existingSummary, populations);
  const populationsResponse = await callPopulationsLLM(populationsPrompt);

  // Add any proposed populations to the registry
  const newPositivePopIds = addProposedPopulations(populations, populationsResponse.proposed_populations?.positive || []);
  const newNegativePopIds = addProposedPopulations(populations, populationsResponse.proposed_populations?.negative || []);

  // Auto-create any "existing" population IDs that don't actually exist
  const allExistingPopIds = [
    ...(populationsResponse.existing_population_ids?.positive || []),
    ...(populationsResponse.existing_population_ids?.negative || [])
  ];
  for (const id of allExistingPopIds) {
    if (!populations.populations.some(p => p.id === id)) {
      const name = id.split('-').map(word =>
        word.charAt(0).toUpperCase() + word.slice(1)
      ).join(' ');
      const description = `Individuals, organizations, or entities categorized as ${id.replace(/-/g, ' ')} who may be affected by federal policies.`;
      const newPop: Population = {
        id,
        name,
        description,
        created_at: new Date().toISOString()
      };
      populations.populations.push(newPop);
      console.log(`    Auto-added population "${name}" - consider reviewing description`);
    }
  }

  // Combine existing and new population IDs
  const allPositivePopIds = [...(populationsResponse.existing_population_ids?.positive || []), ...newPositivePopIds];
  const allNegativePopIds = [...(populationsResponse.existing_population_ids?.negative || []), ...newNegativePopIds];

  const validPositivePopIds = allPositivePopIds.filter(id =>
    populations.populations.some(p => p.id === id)
  );
  const validNegativePopIds = allNegativePopIds.filter(id =>
    populations.populations.some(p => p.id === id)
  );

  // Update only the populations, preserve everything else
  const updatedEnrichment: Enrichment = {
    ...enrichedOrder.enrichment,
    impacted_populations: {
      positive_ids: validPositivePopIds,
      negative_ids: validNegativePopIds
    },
    enriched_at: new Date().toISOString(),
    model_used: `${enrichedOrder.enrichment.model_used.split(' + ')[0]} + ${OPENAI_MODEL_POPULATIONS} (pass2-rerun)`
  };

  return {
    ...enrichedOrder,
    enrichment: updatedEnrichment
  };
}

/**
 * Main enrich function
 */
export async function enrich(options: {
  force?: boolean;
  limit?: number;
  year?: number;
  eoNumber?: number;
  pass2Only?: boolean;
} = {}): Promise<void> {
  // Pass 2 only mode - re-run population analysis on existing enriched orders
  if (options.pass2Only) {
    console.log(`\n=== Re-running Population Analysis (Pass 2 Only) ===\n`);

    // Load populations registry
    const populations = await loadPopulations();
    console.log(`Loaded ${populations.populations.length} existing populations\n`);

    // Get list of enriched order files
    const { readdirSync } = await import('node:fs');
    const enrichedFiles = readdirSync(ENRICHED_DIR)
      .filter(f => f.startsWith('eo-') && f.endsWith('.json'))
      .map(f => parseInt(f.replace('eo-', '').replace('.json', ''), 10))
      .filter(n => !isNaN(n));

    let eoNumbers = enrichedFiles;

    // Filter by specific EO number if specified
    if (options.eoNumber) {
      if (!enrichedFiles.includes(options.eoNumber)) {
        console.log(`EO ${options.eoNumber} is not enriched yet. Run full enrichment first.`);
        return;
      }
      eoNumbers = [options.eoNumber];
      console.log(`Targeting EO ${options.eoNumber}`);
    } else {
      // Filter by year if specified
      if (options.year) {
        const filteredNumbers: number[] = [];
        for (const eoNum of enrichedFiles) {
          const enriched = await loadEnrichedOrder(eoNum);
          if (enriched && enriched.signing_date.startsWith(String(options.year))) {
            filteredNumbers.push(eoNum);
          }
        }
        eoNumbers = filteredNumbers;
        console.log(`Filtered to ${eoNumbers.length} enriched orders from ${options.year}`);
      }

      // Apply limit
      if (options.limit) {
        eoNumbers = eoNumbers.slice(0, options.limit);
        console.log(`Limited to ${eoNumbers.length} orders`);
      }
    }

    if (eoNumbers.length === 0) {
      console.log('No enriched orders to process.');
      return;
    }

    // Process each enriched order
    let processed = 0;
    let errors = 0;

    for (const eoNum of eoNumbers) {
      const enrichedOrder = await loadEnrichedOrder(eoNum);
      if (!enrichedOrder) {
        console.log(`Could not load EO ${eoNum}, skipping`);
        errors++;
        continue;
      }

      console.log(`Processing EO ${eoNum}: ${enrichedOrder.title.slice(0, 50)}...`);

      try {
        const updated = await rerunPopulationsPass(enrichedOrder, populations);

        // Save updated enriched order
        await writeJson(getEnrichedPath(eoNum), updated);

        // Save updated populations registry after each order
        await savePopulations(populations);

        const popCount = updated.enrichment.impacted_populations.positive_ids.length +
                         updated.enrichment.impacted_populations.negative_ids.length;
        console.log(`  ✓ Updated populations: ${popCount} total (${updated.enrichment.impacted_populations.positive_ids.length}+ / ${updated.enrichment.impacted_populations.negative_ids.length}-)`);
        processed++;
      } catch (err) {
        console.error(`  ✗ Error: ${err instanceof Error ? err.message : err}`);
        errors++;
      }

      // Rate limit
      if (eoNumbers.indexOf(eoNum) < eoNumbers.length - 1) {
        await sleep(ENRICH_DELAY_MS);
      }
    }

    console.log(`\nDone! Processed: ${processed}, Errors: ${errors}`);

    // Clean up orphaned populations
    const orphanedCount = await cleanOrphanedPopulations(populations);
    if (orphanedCount > 0) {
      await savePopulations(populations);
    }

    console.log(`Total populations: ${populations.populations.length}`);
    return;
  }

  // Standard full enrichment mode
  console.log(`\n=== Enriching Executive Orders ===\n`);

  // Load raw orders
  const allOrders = await loadRawOrders();
  if (allOrders.length === 0) {
    console.log('No raw orders found. Run fetch first.');
    return;
  }

  let orders = allOrders;

  // Filter by specific EO number if specified
  if (options.eoNumber) {
    orders = allOrders.filter(o => o.executive_order_number == options.eoNumber);
    if (orders.length === 0) {
      console.log(`EO ${options.eoNumber} not found in raw orders.`);
      return;
    }
    console.log(`Targeting EO ${options.eoNumber}`);
  } else {
    // Filter by year if specified
    if (options.year) {
      orders = allOrders.filter(o =>
        o.signing_date.startsWith(String(options.year))
      );
      console.log(`Filtered to ${orders.length} orders from ${options.year}`);
    }

    // Filter to only unenriched unless force
    if (!options.force) {
      orders = orders.filter(o => !isEnriched(o.executive_order_number));
      console.log(`${orders.length} orders need enrichment`);
    }

    // Apply limit
    if (options.limit) {
      orders = orders.slice(0, options.limit);
      console.log(`Limited to ${orders.length} orders`);
    }
  }

  if (orders.length === 0) {
    console.log('No orders to enrich.');
    return;
  }

  // Load themes and populations
  const themes = await loadThemes();
  const populations = await loadPopulations();
  console.log(`Loaded ${themes.themes.length} existing themes`);
  console.log(`Loaded ${populations.populations.length} existing populations\n`);

  // Process each order
  let processed = 0;
  let errors = 0;

  for (const order of orders) {
    console.log(`Processing EO ${order.executive_order_number}: ${order.title.slice(0, 50)}...`);

    try {
      const enriched = await enrichOrder(order, themes, populations);

      // Save enriched order
      await writeJson(getEnrichedPath(order.executive_order_number), enriched);

      // Save updated registries after each order (in case of interruption)
      await saveThemes(themes);
      await savePopulations(populations);

      const popCount = enriched.enrichment.impacted_populations.positive_ids.length +
                       enriched.enrichment.impacted_populations.negative_ids.length;
      console.log(`  ✓ Enriched with ${enriched.enrichment.theme_ids.length} themes, ${popCount} populations`);
      processed++;
    } catch (err) {
      console.error(`  ✗ Error: ${err instanceof Error ? err.message : err}`);
      errors++;
    }

    // Rate limit
    if (orders.indexOf(order) < orders.length - 1) {
      await sleep(ENRICH_DELAY_MS);
    }
  }

  console.log(`\nDone! Processed: ${processed}, Errors: ${errors}`);
  console.log(`Total themes: ${themes.themes.length}`);
  console.log(`Total populations: ${populations.populations.length}`);

  // Show remaining count if filtering by year
  if (options.year) {
    const yearOrders = allOrders.filter(o =>
      o.signing_date.startsWith(String(options.year))
    );
    const remaining = yearOrders.filter(o => !isEnriched(o.executive_order_number)).length;
    if (remaining > 0) {
      console.log(`\n${remaining} executive order${remaining !== 1 ? 's' : ''} remain for enrichment in year ${options.year}`);
    } else {
      console.log(`\nAll executive orders from ${options.year} have been enriched!`);
    }
  }
}
