/**
 * Enrich executive orders with LLM-generated metadata
 */

import OpenAI from 'openai';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ENRICHED_DIR, OPENAI_MODEL, ENRICH_DELAY_MS } from './config.js';
import { loadThemes, saveThemes, loadPopulations, savePopulations, readJson, writeJson, slugify, sleep } from './utils.js';
import { loadRawOrders } from './fetch.js';
import type {
  RawExecutiveOrder,
  EnrichedExecutiveOrder,
  ThemeRegistry,
  PopulationRegistry,
  Theme,
  Population,
  LLMEnrichmentResponse,
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
 * Build the prompt for enriching an executive order
 */
function buildEnrichmentPrompt(
  order: RawExecutiveOrder,
  fullText: string | null,
  themes: ThemeRegistry,
  populations: PopulationRegistry
): string {
  const themesList = themes.themes.length > 0
    ? themes.themes.map(t => `- ${t.id}: ${t.name} - ${t.description}`).join('\n')
    : '(No themes defined yet)';

  const populationsList = populations.populations.length > 0
    ? populations.populations.map(p => `- ${p.id}: ${p.name} - ${p.description}`).join('\n')
    : '(No populations defined yet)';

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

## Existing Impacted Populations

These population groups have already been identified from other executive orders. Prefer using these when they fit:

${populationsList}

## Your Task

Analyze this executive order and provide:

1. **Summary**: A plain-language summary (2-3 sentences) that a non-expert could understand. Focus on what the order actually does, not bureaucratic language.

2. **Themes**: Identify the main policy themes/categories.
   - STRONGLY prefer using existing themes - only propose new ones if absolutely necessary
   - Themes should be reusable across multiple executive orders
   - Use lowercase with dashes for names (e.g., "national-security", "foreign-policy")
   - Aim for 2-3 word theme names that are descriptive but not overly specific
   - BAD (too specific): "semiconductor-manufacturing", "tiktok-ban", "investment-facilitation-and-regulatory-simplification"
   - BAD (too broad): "policy", "government", "economy"
   - GOOD (balanced): "trade-policy", "immigration-enforcement", "federal-workforce", "artificial-intelligence", "environmental-regulation"

3. **Impacted Populations**: Who is affected by this order?
   - STRONGLY prefer using existing populations - only propose new ones if absolutely necessary
   - Populations should be reusable groups that appear across multiple orders
   - Use lowercase with dashes for names (e.g., "federal-employees", "tech-industry")
   - Aim for 2-3 word names that are descriptive but not overly specific
   - BAD (too specific): "large-corporations-with-legal-teams", "tiktok-users-under-18", "semiconductor-factory-workers"
   - BAD (too broad): "researchers", "workers", "companies"
   - GOOD (balanced): "scientific-researchers", "manufacturing-workers", "tech-companies", "undocumented-immigrants", "federal-contractors"

   Categories to consider:
   - **Countries/Regions**: Nations or regions (e.g., "china", "european-union")
   - **Demographics**: Ethnic, cultural, or religious groups (e.g., "asian-americans", "muslim-americans")
   - **Professions/Industries**: Workers or sectors (e.g., "federal-employees", "tech-industry", "agricultural-workers")
   - **Economic/Social**: Life circumstances (e.g., "low-income-families", "military-veterans", "legal-immigrants")
   - **Government entities**: Agencies or officials (e.g., "doj", "state-governments", "federal-agencies")
   - **Advocacy/Interest groups**: Groups with policy interests (e.g., "environmental-advocates", "civil-liberties-groups", "industry-lobbyists")

   For each population:
   - First, check if any existing population IDs apply and list them
   - Only propose NEW populations if existing ones don't cover the group
   - IMPORTANT: Be thorough in identifying BOTH positive AND negative impacts
   - Almost every policy has winners AND losers - think critically about who might be harmed or disadvantaged
   - Consider indirect impacts: if one group benefits, who loses out? If regulations are removed, who was protected by them?
   - For negative impacts, consider: groups losing protections, industries facing new competition, communities affected by environmental changes, workers displaced, etc.

4. **Potential Concerns**: Identify potential concerns related to this order. Consider:
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
  "existing_population_ids": {
    "positive": ["federal-employees"],
    "negative": ["undocumented-immigrants"]
  },
  "proposed_populations": {
    "positive": [
      {
        "name": "population-name-here",
        "description": "Brief description of this population group"
      }
    ],
    "negative": [
      {
        "name": "population-name-here",
        "description": "Brief description of this population group"
      }
    ]
  },
  "potential_concerns": [
    "Concern 1 in one sentence.",
    "Concern 2 in one sentence."
  ]
}`;
}

/**
 * Call OpenAI to enrich an executive order
 */
async function callLLM(prompt: string): Promise<LLMEnrichmentResponse> {
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

  // Extract text content
  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('No text response from OpenAI');
  }

  // Parse JSON from response
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Could not find JSON in OpenAI response');
  }

  return JSON.parse(jsonMatch[0]) as LLMEnrichmentResponse;
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
 * Add proposed themes to the registry
 */
function addProposedThemes(
  registry: ThemeRegistry,
  proposed: LLMEnrichmentResponse['proposed_themes']
): string[] {
  const newIds: string[] = [];

  for (const theme of proposed) {
    const id = slugify(theme.name);

    // Check if theme already exists
    if (registry.themes.some(t => t.id === id)) {
      console.log(`    Theme "${id}" already exists, skipping`);
      newIds.push(id);
      continue;
    }

    const newTheme: Theme = {
      id,
      name: theme.name,
      description: theme.description,
      created_at: new Date().toISOString()
    };

    registry.themes.push(newTheme);
    newIds.push(id);
    console.log(`    Added new theme: ${theme.name}`);
  }

  return newIds;
}

/**
 * Add proposed populations to the registry
 */
function addProposedPopulations(
  registry: PopulationRegistry,
  proposed: LLMEnrichmentResponse['proposed_populations']['positive'] | LLMEnrichmentResponse['proposed_populations']['negative']
): string[] {
  const newIds: string[] = [];

  for (const pop of proposed) {
    const id = slugify(pop.name);

    // Check if population already exists
    if (registry.populations.some(p => p.id === id)) {
      newIds.push(id);
      continue;
    }

    const newPop: Population = {
      id,
      name: pop.name,
      description: pop.description,
      created_at: new Date().toISOString()
    };

    registry.populations.push(newPop);
    newIds.push(id);
    console.log(`    Added new population: ${pop.name}`);
  }

  return newIds;
}

/**
 * Enrich a single executive order
 */
async function enrichOrder(
  order: RawExecutiveOrder,
  themes: ThemeRegistry,
  populations: PopulationRegistry
): Promise<EnrichedExecutiveOrder> {
  // Fetch full text on demand
  const fullText = await fetchFullText(order);

  const prompt = buildEnrichmentPrompt(order, fullText, themes, populations);
  const response = await callLLM(prompt);

  // Add any proposed themes to the registry
  const newThemeIds = addProposedThemes(themes, response.proposed_themes || []);

  // Combine existing and new theme IDs
  const allThemeIds = [...(response.existing_theme_ids || []), ...newThemeIds];

  // Auto-create any "existing" theme IDs that don't actually exist
  // (LLM sometimes assumes common themes exist when they don't)
  for (const id of response.existing_theme_ids || []) {
    if (!themes.themes.some(t => t.id === id)) {
      const newTheme: Theme = {
        id,
        name: id, // Use ID as name since we don't have a better name
        description: `Auto-created theme for ${id.replace(/-/g, ' ')}`,
        created_at: new Date().toISOString()
      };
      themes.themes.push(newTheme);
    }
  }

  // Now all theme IDs should be valid
  const validThemeIds = allThemeIds.filter(id =>
    themes.themes.some(t => t.id === id)
  );

  // Add any proposed populations to the registry
  const newPositivePopIds = addProposedPopulations(populations, response.proposed_populations?.positive || []);
  const newNegativePopIds = addProposedPopulations(populations, response.proposed_populations?.negative || []);

  // Auto-create any "existing" population IDs that don't actually exist
  const allExistingPopIds = [
    ...(response.existing_population_ids?.positive || []),
    ...(response.existing_population_ids?.negative || [])
  ];
  for (const id of allExistingPopIds) {
    if (!populations.populations.some(p => p.id === id)) {
      const newPop: Population = {
        id,
        name: id, // Use ID as name
        description: `Auto-created population for ${id.replace(/-/g, ' ')}`,
        created_at: new Date().toISOString()
      };
      populations.populations.push(newPop);
    }
  }

  // Combine existing and new population IDs
  const allPositivePopIds = [...(response.existing_population_ids?.positive || []), ...newPositivePopIds];
  const allNegativePopIds = [...(response.existing_population_ids?.negative || []), ...newNegativePopIds];

  // Now all population IDs should be valid
  const validPositivePopIds = allPositivePopIds.filter(id =>
    populations.populations.some(p => p.id === id)
  );
  const validNegativePopIds = allNegativePopIds.filter(id =>
    populations.populations.some(p => p.id === id)
  );

  const enrichment: Enrichment = {
    summary: response.summary,
    theme_ids: validThemeIds,
    impacted_populations: {
      positive_ids: validPositivePopIds,
      negative_ids: validNegativePopIds
    },
    potential_concerns: response.potential_concerns,
    enriched_at: new Date().toISOString(),
    model_used: OPENAI_MODEL
  };

  return {
    ...order,
    enrichment
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
} = {}): Promise<void> {
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
