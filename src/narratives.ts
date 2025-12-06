/**
 * Generate LLM-powered narrative summaries for presidential terms
 */

import OpenAI from 'openai';
import { join } from 'node:path';
import { AGGREGATED_DIR, OPENAI_MODEL } from './config.js';
import { loadThemes, loadPopulations, writeJson } from './utils.js';
import {
  loadAllEnriched,
  detectPresidentTerms,
  getTermKey,
  countThemes
} from './aggregate.js';
import type {
  EnrichedExecutiveOrder,
  ThemeRegistry,
  PopulationRegistry
} from './types.js';

// =============================================================================
// TYPES
// =============================================================================

interface TermNarrative {
  president_id: string;
  president_name: string;
  term_start: number;
  term_end: number | 'present';
  order_count: number;
  narrative: string[]; // 1-3 concise paragraphs as array items
  generated_at: string;
  model_used: string;
}

interface NarrativesFile {
  narratives: TermNarrative[];
  generated_at: string;
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Count population occurrences and return sorted
 */
function countPopulations(
  orders: EnrichedExecutiveOrder[],
  populationRegistry: PopulationRegistry,
  type: 'positive' | 'negative'
): { id: string; name: string; count: number }[] {
  const counts = new Map<string, number>();

  for (const order of orders) {
    const ids = type === 'positive'
      ? order.enrichment.impacted_populations.positive_ids
      : order.enrichment.impacted_populations.negative_ids;

    for (const popId of ids) {
      counts.set(popId, (counts.get(popId) || 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([id, count]) => ({
      id,
      name: populationRegistry.populations.find(p => p.id === id)?.name || id,
      count
    }));
}

/**
 * Get all unique concerns from orders
 */
function collectConcerns(orders: EnrichedExecutiveOrder[]): string[] {
  const concerns = new Set<string>();
  for (const order of orders) {
    for (const concern of order.enrichment.potential_concerns) {
      concerns.add(concern);
    }
  }
  return Array.from(concerns);
}

/**
 * Build context for LLM to generate narrative
 */
function buildNarrativeContext(
  orders: EnrichedExecutiveOrder[],
  themes: ThemeRegistry,
  populations: PopulationRegistry,
  presidentName: string,
  termStart: number,
  termEnd: number | 'present'
): string {
  const topThemes = countThemes(orders, themes).slice(0, 20);
  const positivePopulations = countPopulations(orders, populations, 'positive').slice(0, 20);
  const negativePopulations = countPopulations(orders, populations, 'negative').slice(0, 20);
  const concerns = collectConcerns(orders);

  // Group orders by quarter to show temporal patterns
  const byQuarter = new Map<string, EnrichedExecutiveOrder[]>();
  for (const order of orders) {
    const date = new Date(order.signing_date);
    const quarter = Math.ceil((date.getMonth() + 1) / 3);
    const key = `${date.getFullYear()} Q${quarter}`;
    if (!byQuarter.has(key)) {
      byQuarter.set(key, []);
    }
    byQuarter.get(key)!.push(order);
  }

  // Build temporal theme progression
  const temporalData: string[] = [];
  const sortedQuarters = Array.from(byQuarter.keys()).sort();
  for (const quarter of sortedQuarters) {
    const quarterOrders = byQuarter.get(quarter)!;
    const quarterThemes = countThemes(quarterOrders, themes).slice(0, 3);
    const themeNames = quarterThemes.map(t => t.name).join(', ');
    temporalData.push(`${quarter}: ${quarterOrders.length} orders - top themes: ${themeNames}`);
  }

  // Sample of order titles
  const titleSample = orders.slice(0, 40).map(o =>
    `- EO ${o.executive_order_number}: ${o.title}`
  ).join('\n');

  const context = `
PRESIDENT: ${presidentName}
TERM: ${termStart} to ${termEnd}
TOTAL EXECUTIVE ORDERS: ${orders.length}

TOP THEMES (by frequency):
${topThemes.map(t => `- ${t.name}: ${t.count} orders`).join('\n')}

MOST POSITIVELY IMPACTED POPULATIONS:
${positivePopulations.map(p => `- ${p.name}: ${p.count} orders`).join('\n')}

MOST NEGATIVELY IMPACTED POPULATIONS:
${negativePopulations.map(p => `- ${p.name}: ${p.count} orders`).join('\n')}

TEMPORAL PROGRESSION:
${temporalData.join('\n')}

SAMPLE OF ORDER TITLES:
${titleSample}

NOTABLE CONCERNS RAISED:
${concerns.slice(0, 20).map(c => `- ${c}`).join('\n')}
`.trim();

  return context;
}

/**
 * Generate narrative using OpenAI
 */
async function generateNarrativeWithLLM(
  openai: OpenAI,
  context: string,
  presidentName: string,
  orderCount: number
): Promise<string[]> {
  const systemPrompt = `You are a political analyst writing concise summaries of executive order activity.

Guidelines:
- Write 2-3 SHORT paragraphs (50-80 words each, 150 words max total)
- Be direct and dense with information - no filler words or fluff
- Factual and neutral tone
- Use specific numbers
- Past tense for completed terms, present tense for ongoing
- No editorializing
- When discussing impacted populations, use language like "aimed to positively impact" or "aimed to negatively impact" rather than presuming actual outcomes

Format: Return ONLY a JSON array of strings, each string being one paragraph. Example:
["First paragraph here.", "Second paragraph here.", "Third paragraph here."]`;

  const userPrompt = `Summarize ${presidentName}'s ${orderCount} executive orders based on this data:

${context}

Return JSON array of 2-3 concise paragraphs:`;

  const response = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0.7,
    max_completion_tokens: 400,
    response_format: { type: 'json_object' }
  });

  const content = response.choices[0]?.message?.content?.trim() || '[]';

  try {
    const parsed = JSON.parse(content);
    // Handle both direct array and object with paragraphs key
    if (Array.isArray(parsed)) {
      return parsed;
    } else if (parsed.paragraphs && Array.isArray(parsed.paragraphs)) {
      return parsed.paragraphs;
    } else if (parsed.narrative && Array.isArray(parsed.narrative)) {
      return parsed.narrative;
    }
    // Fallback: extract any array values from the object
    const values = Object.values(parsed);
    const arrayValue = values.find(v => Array.isArray(v));
    if (arrayValue) {
      return arrayValue as string[];
    }
    return [content];
  } catch {
    // If parsing fails, split by double newlines
    return content.split(/\n\n+/).filter(p => p.trim());
  }
}

// =============================================================================
// MAIN
// =============================================================================

/**
 * Filter orders by president identifier (partial match)
 */
function filterByPresident(
  orders: EnrichedExecutiveOrder[],
  president: string
): EnrichedExecutiveOrder[] {
  const search = president.toLowerCase();
  return orders.filter(o =>
    o.president.identifier.toLowerCase().includes(search) ||
    o.president.name.toLowerCase().includes(search)
  );
}

/**
 * Main narrative generation function
 */
export async function generateNarratives(options: { president?: string } = {}): Promise<void> {
  console.log(`\n=== Generating Term Narratives ===\n`);

  // Initialize OpenAI
  const openai = new OpenAI();

  // Load all enriched orders
  let orders = await loadAllEnriched();
  console.log(`Loaded ${orders.length} enriched orders`);

  if (orders.length === 0) {
    console.log('No enriched orders found. Run enrich first.');
    return;
  }

  // Filter by president if specified
  if (options.president) {
    orders = filterByPresident(orders, options.president);
    console.log(`Filtered to ${orders.length} orders for "${options.president}"`);

    if (orders.length === 0) {
      console.log('No orders match that president.');
      return;
    }
  }

  // Load registries
  const themes = await loadThemes();
  const populations = await loadPopulations();

  const terms = detectPresidentTerms(orders);
  const narratives: TermNarrative[] = [];

  for (const [presidentId, presTerms] of terms) {
    for (const term of presTerms) {
      const termOrders = orders.filter(o => {
        if (o.president.identifier !== presidentId) return false;
        const year = new Date(o.signing_date).getFullYear();
        const endYear = term.end || new Date().getFullYear() + 1;
        return year >= term.start && year < endYear;
      });

      if (termOrders.length === 0) continue;

      const presidentName = term.name;
      const termEnd = term.end || 'present';
      const termKey = getTermKey(presidentId, term.start);

      console.log(`\nGenerating narrative for ${presidentName} (${term.start}-${termEnd})...`);
      console.log(`  ${termOrders.length} orders to analyze`);

      // Build context and generate narrative
      const context = buildNarrativeContext(
        termOrders,
        themes,
        populations,
        presidentName,
        term.start,
        termEnd
      );

      // Estimate token count (~4 chars per token is a rough estimate for English)
      const charCount = context.length;
      const estimatedTokens = Math.ceil(charCount / 4);
      console.log(`  Context: ${charCount.toLocaleString()} chars, ~${estimatedTokens.toLocaleString()} tokens`);

      const narrative = await generateNarrativeWithLLM(
        openai,
        context,
        presidentName,
        termOrders.length
      );

      const wordCount = narrative.reduce((acc, p) => acc + p.split(' ').length, 0);
      console.log(`  Generated ${narrative.length} paragraphs, ${wordCount} words`);

      narratives.push({
        president_id: presidentId,
        president_name: presidentName,
        term_start: term.start,
        term_end: termEnd,
        order_count: termOrders.length,
        narrative,
        generated_at: new Date().toISOString(),
        model_used: OPENAI_MODEL
      });
    }
  }

  // Sort by term (most recent first)
  narratives.sort((a, b) => {
    const aEnd = a.term_end === 'present' ? 9999 : a.term_end;
    const bEnd = b.term_end === 'present' ? 9999 : b.term_end;
    return bEnd - aEnd || b.term_start - a.term_start;
  });

  // Write narratives file
  const output: NarrativesFile = {
    narratives,
    generated_at: new Date().toISOString()
  };

  await writeJson(join(AGGREGATED_DIR, 'narratives.json'), output);
  console.log(`\nSaved ${narratives.length} narratives to narratives.json`);

  console.log('\nDone!');
}
