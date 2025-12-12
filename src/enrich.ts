/**
 * Enrich executive orders with LLM-generated metadata
 *
 * Uses a two-pass approach with static taxonomy:
 * - Pass 1: Summary + Themes (from taxonomy)
 * - Pass 2: Populations + Concerns (from taxonomy, using themes from Pass 1)
 */

import OpenAI from 'openai';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ENRICHED_DIR, OPENAI_MODEL, ENRICH_DELAY_MS } from './config.js';
import { readJson, writeJson, sleep } from './utils.js';
import { loadRawOrders } from './fetch.js';
import {
  loadTaxonomy,
  formatThemesForPrompt,
  formatPopulationsForPrompt,
  getAllThemeIds,
  getAllPopulationIds,
  appendSuggestionToGuide,
  type TaxonomyData
} from './taxonomy.js';
import type {
  RawExecutiveOrder,
  EnrichedExecutiveOrder,
  LLMTaxonomyPass1Response,
  LLMTaxonomyPass2Response,
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
 * Build Pass 1 prompt (summary + themes from static taxonomy)
 */
function buildPass1Prompt(
  order: RawExecutiveOrder,
  fullText: string | null,
  taxonomy: TaxonomyData
): string {
  const themesFormatted = formatThemesForPrompt(taxonomy);

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

## Theme Taxonomy

Select themes ONLY from this taxonomy. The ID is shown before the colon, the display name after.
${themesFormatted}

## Your Task

Analyze this executive order and provide:

1. **Summary**: A plain-language summary (2-3 sentences) that a non-expert could understand. Focus on what the order actually does, not bureaucratic language.

2. **Themes**: Select the most relevant themes from the taxonomy above.
   - Use the exact IDs from the taxonomy (the text before the colon)
   - Select 2-5 themes that best capture the order's policy areas
   - Only select themes that are directly relevant, not tangentially related
   - If you believe a theme is missing from the taxonomy and is essential, add it to "suggested_themes"

Respond in this exact JSON format:
{
  "summary": "Plain language summary here...",
  "theme_ids": ["military-readiness-force-structure", "defense-industrial-base"],
  "suggested_themes": [
    {
      "name": "Suggested Theme Name",
      "category": "Which taxonomy category it should belong to",
      "justification": "Why this theme is needed and not covered by existing taxonomy"
    }
  ]
}

IMPORTANT: Only include "suggested_themes" if absolutely necessary. The taxonomy is comprehensive.`;
}

/**
 * Build Pass 2 prompt (populations + concerns from static taxonomy)
 * Receives themes from Pass 1 to inform concern generation
 */
function buildPass2Prompt(
  order: RawExecutiveOrder,
  fullText: string | null,
  summary: string,
  themeIds: string[],
  taxonomy: TaxonomyData
): string {
  const populationsFormatted = formatPopulationsForPrompt(taxonomy);

  return `You are a policy analyst identifying which groups are DIRECTLY and MEANINGFULLY impacted by an executive order, and what concerns might arise from its implementation.

## Executive Order Information

**EO Number:** ${order.executive_order_number}
**Title:** ${order.title}
**Signing Date:** ${order.signing_date}
**President:** ${order.president.name}

**Summary (already generated):**
${summary}

**Themes identified:** ${themeIds.join(', ')}

**Abstract:**
${order.abstract || '(No abstract available)'}

**Full Text:**
${fullText || '(Full text not available - use abstract and title only)'}

## Population Taxonomy

Select populations ONLY from this taxonomy. The ID is shown before the colon, the display name after.
${populationsFormatted}

## CRITICAL: Direct vs Indirect Impact

Only tag populations that are DIRECTLY and MEANINGFULLY impacted. Do NOT tag populations that merely:
- Implement or administer the policy (federal employees implement most orders - that's not "impact")
- Are tangentially related
- Might theoretically be affected in some minor way

**WRONG approach:**
- Tagging "federal-employees" on every order because they implement federal policy
- Tagging "taxpayers" on every order because government costs money
- Tagging "consumers" on every trade order

**RIGHT approach:**
- Tag "federal-employees" ONLY when the order specifically changes their pay, benefits, hiring, working conditions, or job security
- Tag "taxpayers" ONLY when there's a significant, direct fiscal impact explicitly discussed
- Tag specific groups whose lives, livelihoods, or rights are directly changed by the order

## Your Task

1. **Populations**: Select impacted populations from the taxonomy above.
   - Use the exact IDs from the taxonomy (the text before the colon)
   - BE SELECTIVE: Most orders should have 2-4 total populations, not 6-10
   - Identify both positive impacts (benefits, expanded rights) and negative impacts (burdens, restrictions)
   - Most orders have trade-offs - consider who loses when others gain
   - If you believe a population is missing from the taxonomy and is essential, add it to "suggested_populations"

2. **Concerns**: Based on the themes (${themeIds.join(', ')}) and populations you identified, generate 2-5 potential concerns about this order's implementation.
   - Focus on INTENDED consequences (what the order aims to do that could be controversial)
   - Focus on UNINTENDED consequences (side effects that might not have been considered)
   - Reference specific populations that might be affected
   - Be specific and actionable, not vague
   - Each concern should be one concise sentence

Respond in this exact JSON format:
{
  "population_ids": {
    "positive": ["veterans", "military-personnel-active-duty"],
    "negative": ["federal-contractors"]
  },
  "suggested_populations": {
    "positive": [],
    "negative": [
      {
        "name": "Suggested Population Name",
        "category": "Which taxonomy category it should belong to",
        "justification": "Why this population is needed and not covered by existing taxonomy"
      }
    ]
  },
  "potential_concerns": [
    "Concern 1 referencing specific themes and populations affected.",
    "Concern 2 about unintended consequences for a specific group."
  ]
}

IMPORTANT: Only include "suggested_populations" if absolutely necessary. The taxonomy is comprehensive.`;
}

/**
 * Call OpenAI for Pass 1 (summary + themes)
 */
async function callPass1LLM(prompt: string): Promise<LLMTaxonomyPass1Response> {
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
    throw new Error('No text response from OpenAI (Pass 1)');
  }

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Could not find JSON in OpenAI response (Pass 1)');
  }

  return JSON.parse(jsonMatch[0]) as LLMTaxonomyPass1Response;
}

/**
 * Call OpenAI for Pass 2 (populations + concerns)
 */
async function callPass2LLM(prompt: string): Promise<LLMTaxonomyPass2Response> {
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
    throw new Error('No text response from OpenAI (Pass 2)');
  }

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Could not find JSON in OpenAI response (Pass 2)');
  }

  return JSON.parse(jsonMatch[0]) as LLMTaxonomyPass2Response;
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
 * Enrich a single executive order using static taxonomy (two-pass approach)
 * Pass 1: Summary + Themes
 * Pass 2: Populations + Concerns (using themes from Pass 1)
 */
async function enrichOrder(
  order: RawExecutiveOrder,
  taxonomy: TaxonomyData
): Promise<EnrichedExecutiveOrder> {
  // Fetch full text on demand
  const fullText = await fetchFullText(order);

  // Get valid IDs from taxonomy for validation
  const validThemeIds = getAllThemeIds(taxonomy);
  const validPopulationIds = getAllPopulationIds(taxonomy);

  // =====================================================================
  // PASS 1: Summary + Themes (using static taxonomy)
  // =====================================================================
  console.log(`    [Pass 1/${OPENAI_MODEL}] Summary + themes...`);
  const pass1Prompt = buildPass1Prompt(order, fullText, taxonomy);
  const pass1Response = await callPass1LLM(pass1Prompt);

  // Validate theme IDs against taxonomy
  const themeIds = (pass1Response.theme_ids || []).filter(id => {
    if (validThemeIds.has(id)) {
      return true;
    }
    console.log(`    Warning: Theme "${id}" not in taxonomy, skipping`);
    return false;
  });

  // Handle suggested themes (save to markdown, don't auto-add)
  for (const suggestion of pass1Response.suggested_themes || []) {
    await appendSuggestionToGuide({
      eoNumber: order.executive_order_number,
      eoTitle: order.title,
      type: 'theme',
      suggestedName: suggestion.name,
      suggestedCategory: suggestion.category,
      justification: suggestion.justification
    });
  }

  // =====================================================================
  // PASS 2: Populations + Concerns (using themes from Pass 1)
  // =====================================================================
  console.log(`    [Pass 2/${OPENAI_MODEL}] Populations + concerns...`);
  const pass2Prompt = buildPass2Prompt(order, fullText, pass1Response.summary, themeIds, taxonomy);
  const pass2Response = await callPass2LLM(pass2Prompt);

  // Validate population IDs against taxonomy
  const positivePopIds = (pass2Response.population_ids?.positive || []).filter(id => {
    if (validPopulationIds.has(id)) {
      return true;
    }
    console.log(`    Warning: Population "${id}" not in taxonomy, skipping`);
    return false;
  });

  const negativePopIds = (pass2Response.population_ids?.negative || []).filter(id => {
    if (validPopulationIds.has(id)) {
      return true;
    }
    console.log(`    Warning: Population "${id}" not in taxonomy, skipping`);
    return false;
  });

  // Handle suggested populations (save to markdown, don't auto-add)
  for (const suggestion of pass2Response.suggested_populations?.positive || []) {
    await appendSuggestionToGuide({
      eoNumber: order.executive_order_number,
      eoTitle: order.title,
      type: 'population',
      suggestedName: suggestion.name,
      suggestedCategory: `${suggestion.category} (positive impact)`,
      justification: suggestion.justification
    });
  }

  for (const suggestion of pass2Response.suggested_populations?.negative || []) {
    await appendSuggestionToGuide({
      eoNumber: order.executive_order_number,
      eoTitle: order.title,
      type: 'population',
      suggestedName: suggestion.name,
      suggestedCategory: `${suggestion.category} (negative impact)`,
      justification: suggestion.justification
    });
  }

  // =====================================================================
  // Combine results from both passes
  // =====================================================================
  const enrichment: Enrichment = {
    summary: pass1Response.summary,
    theme_ids: themeIds,
    impacted_populations: {
      positive_ids: positivePopIds,
      negative_ids: negativePopIds
    },
    potential_concerns: pass2Response.potential_concerns || [],
    enriched_at: new Date().toISOString(),
    model_used: OPENAI_MODEL
  };

  return {
    ...order,
    enrichment
  };
}

/**
 * Main enrich function - uses static taxonomy from metadata-config/
 */
export async function enrich(options: {
  force?: boolean;
  limit?: number;
  year?: number;
  eoNumber?: number;
  existingOnly?: boolean;
} = {}): Promise<void> {
  console.log(`\n=== Enriching Executive Orders (Static Taxonomy) ===\n`);

  // Load static taxonomy
  const taxonomy = await loadTaxonomy();
  const themeCount = getAllThemeIds(taxonomy).size;
  const populationCount = getAllPopulationIds(taxonomy).size;
  console.log(`Loaded taxonomy: ${themeCount} themes, ${populationCount} populations\n`);

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

    // Filter based on enrichment status
    if (options.existingOnly) {
      // Re-enrich only already-enriched orders
      orders = orders.filter(o => isEnriched(o.executive_order_number));
      console.log(`${orders.length} already-enriched orders to re-process`);
    } else if (!options.force) {
      // Default: only unenriched orders
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

  // Process each order
  let processed = 0;
  let errors = 0;

  for (const order of orders) {
    console.log(`Processing EO ${order.executive_order_number}: ${order.title.slice(0, 50)}...`);

    try {
      const enriched = await enrichOrder(order, taxonomy);

      // Save enriched order
      await writeJson(getEnrichedPath(order.executive_order_number), enriched);

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
