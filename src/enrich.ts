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

  return `You are a policy analyst identifying which groups of people are impacted by an executive order.

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

These population groups have already been identified from other executive orders. Prefer using these when they fit:

${populationsList}

## Your Task

Identify who is positively and negatively impacted by this executive order.

**Guidelines:**
- STRONGLY prefer using existing populations - only propose new ones if absolutely necessary
- CRITICAL: Only list population IDs in "existing_population_ids" if they EXACTLY match an ID from the Existing Impacted Populations list above
- If a population you want to use is NOT in the existing list, you MUST add it to "proposed_populations" with a full name and description
- Populations should be reusable groups that appear across multiple orders
- Use lowercase with dashes for names (e.g., "federal-employees", "tech-industry")
- Aim for 2-3 word names that are descriptive but not overly specific
- BAD (too specific): "large-corporations-with-legal-teams", "tiktok-users-under-18"
- BAD (too broad): "researchers", "workers", "companies"
- GOOD (balanced): "scientific-researchers", "manufacturing-workers", "tech-companies"

**Categories to consider:**
- **Countries/Regions**: Nations or regions (e.g., "china", "european-union")
- **Demographics**: Ethnic, cultural, or religious groups (e.g., "asian-americans", "muslim-americans")
- **Professions/Industries**: Workers or sectors (e.g., "federal-employees", "tech-industry", "agricultural-workers")
- **Economic/Social**: Life circumstances (e.g., "low-income-families", "military-veterans", "legal-immigrants")
- **Government entities**: Agencies or officials (e.g., "doj", "state-governments", "federal-agencies")
- **Advocacy/Interest groups**: Groups with policy interests (e.g., "environmental-advocates", "civil-liberties-groups")

**CRITICAL - NEGATIVE IMPACTS ARE REQUIRED:**
- You MUST identify at least 1-2 negatively impacted populations for almost every executive order
- Very few policies are universally beneficial - think critically about trade-offs
- If you initially think there are no negative impacts, reconsider more carefully

**Types of negative impacts to consider:**
- **Resource reallocation**: If funding goes to X, who loses funding? If priorities shift, whose priorities are deprioritized?
- **Regulatory burden**: Who faces new compliance costs, paperwork, or restrictions?
- **Competition effects**: If one group is favored (union workers, domestic producers, specific industries), who is disadvantaged?
- **Foreign entities**: Trade policies, sanctions, and domestic preference rules often negatively impact foreign countries, companies, or workers
- **Opposing interests**: Labor-friendly policies may burden employers; business-friendly policies may harm workers or consumers
- **Implementation costs**: Taxpayers, agencies with stretched resources, or entities bearing compliance costs

**Examples of commonly missed negative impacts:**
- Pro-labor orders → employers, non-union workers/contractors
- Research funding initiatives → research areas not prioritized, competing funding recipients
- Domestic preference policies → foreign suppliers, importers, countries affected by trade restrictions
- New regulations → regulated industries, small businesses facing compliance costs
- Government reorganizations → workers in eliminated programs, communities losing services

Respond in this exact JSON format:
{
  "existing_population_ids": {
    "positive": ["federal-employees", "tech-industry"],
    "negative": ["undocumented-immigrants", "foreign-suppliers"]
  },
  "proposed_populations": {
    "positive": [
      {
        "name": "population-name-here",
        "description": "Brief description of this population group and why they benefit"
      }
    ],
    "negative": [
      {
        "name": "population-name-here",
        "description": "Brief description of this population group and why they are negatively impacted"
      }
    ]
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

  for (const pop of proposed) {
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
