/**
 * Enrich executive orders with LLM-generated metadata
 */

import Anthropic from '@anthropic-ai/sdk';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ENRICHED_DIR, CLAUDE_MODEL, ENRICH_DELAY_MS } from './config.js';
import { loadThemes, saveThemes, readJson, writeJson, slugify, sleep } from './utils.js';
import { loadRawOrders } from './fetch.js';
import type {
  RawExecutiveOrder,
  EnrichedExecutiveOrder,
  ThemeRegistry,
  Theme,
  LLMEnrichmentResponse,
  Enrichment
} from './types.js';

const anthropic = new Anthropic();

/**
 * Build the prompt for enriching an executive order
 */
function buildEnrichmentPrompt(order: RawExecutiveOrder, themes: ThemeRegistry): string {
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
${order.full_text || '(Full text not available - use abstract and title only)'}

## Existing Themes

These themes have already been identified from other executive orders. Prefer using these when they fit:

${themesList}

## Your Task

Analyze this executive order and provide:

1. **Summary**: A plain-language summary (2-3 sentences) that a non-expert could understand. Focus on what the order actually does, not bureaucratic language.

2. **Themes**: Identify the main policy themes/categories.
   - First, check if any existing themes apply and list their IDs
   - Only propose NEW themes if the existing ones don't adequately capture the subject matter
   - New themes should be specific and descriptive (e.g., "semiconductor-manufacturing" not "technology")
   - Avoid overly broad themes like "policy", "government", "reform"

3. **Impacted Populations**: Who is affected by this order?
   - List groups that benefit or are positively impacted
   - List groups that are negatively impacted or face new restrictions/burdens
   - Be specific (e.g., "undocumented immigrants" not "some people")

Respond in this exact JSON format:
{
  "summary": "Plain language summary here...",
  "existing_theme_ids": ["theme-id-1", "theme-id-2"],
  "proposed_themes": [
    {
      "name": "Theme Name",
      "description": "Brief description of what this theme covers",
      "justification": "Why this theme is needed and different from existing themes"
    }
  ],
  "impacted_populations": {
    "positive": ["group1", "group2"],
    "negative": ["group3", "group4"]
  }
}`;
}

/**
 * Call Claude to enrich an executive order
 */
async function callClaude(prompt: string): Promise<LLMEnrichmentResponse> {
  const message = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content: prompt
      }
    ]
  });

  // Extract text content
  const textContent = message.content.find(c => c.type === 'text');
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text response from Claude');
  }

  // Parse JSON from response
  const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Could not find JSON in Claude response');
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
 * Enrich a single executive order
 */
async function enrichOrder(
  order: RawExecutiveOrder,
  themes: ThemeRegistry
): Promise<EnrichedExecutiveOrder> {
  const prompt = buildEnrichmentPrompt(order, themes);
  const response = await callClaude(prompt);

  // Add any proposed themes to the registry
  const newThemeIds = addProposedThemes(themes, response.proposed_themes);

  // Combine existing and new theme IDs
  const allThemeIds = [...response.existing_theme_ids, ...newThemeIds];

  // Validate theme IDs exist
  const validThemeIds = allThemeIds.filter(id =>
    themes.themes.some(t => t.id === id)
  );

  const enrichment: Enrichment = {
    summary: response.summary,
    theme_ids: validThemeIds,
    impacted_populations: response.impacted_populations,
    enriched_at: new Date().toISOString(),
    model_used: CLAUDE_MODEL
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
} = {}): Promise<void> {
  console.log(`\n=== Enriching Executive Orders ===\n`);

  // Load raw orders
  const allOrders = await loadRawOrders();
  if (allOrders.length === 0) {
    console.log('No raw orders found. Run fetch first.');
    return;
  }

  // Filter by year if specified
  let orders = allOrders;
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

  if (orders.length === 0) {
    console.log('No orders to enrich.');
    return;
  }

  // Load themes
  const themes = await loadThemes();
  console.log(`Loaded ${themes.themes.length} existing themes\n`);

  // Process each order
  let processed = 0;
  let errors = 0;

  for (const order of orders) {
    console.log(`Processing EO ${order.executive_order_number}: ${order.title.slice(0, 50)}...`);

    try {
      const enriched = await enrichOrder(order, themes);

      // Save enriched order
      await writeJson(getEnrichedPath(order.executive_order_number), enriched);

      // Save updated themes after each order (in case of interruption)
      await saveThemes(themes);

      console.log(`  ✓ Enriched with ${enriched.enrichment.theme_ids.length} themes`);
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
}
