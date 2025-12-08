/**
 * Generate LLM-powered narrative summaries for presidential terms and monthly periods
 */

import OpenAI from 'openai';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { AGGREGATED_DIR, OPENAI_MODEL } from './config.js';
import { loadThemes, loadPopulations, writeJson } from './utils.js';
import {
  loadAllEnriched,
  detectPresidentTerms,
  getTermKey,
  countThemes,
  OFFICIAL_TERMS
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
  narrative: string[];
  generated_at: string;
  model_used: string;
}

interface TermNarrativesFile {
  narratives: TermNarrative[];
  generated_at: string;
}

interface PresidentOrderCount {
  president_id: string;
  president_name: string;
  order_count: number;
}

interface MonthlyNarrative {
  year: number;
  month: number;
  month_name: string;
  presidents: PresidentOrderCount[];  // Supports transition months with multiple presidents
  total_order_count: number;
  narrative: string[];
  generated_at: string;
  model_used: string;
}

interface MonthlyNarrativesFile {
  narratives: MonthlyNarrative[];
  generated_at: string;
}

// =============================================================================
// HELPERS
// =============================================================================

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

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
 * Build context for LLM to generate term narrative
 */
function buildTermContext(
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

  return `
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
}

/**
 * Build context for LLM to generate monthly narrative
 * Handles transition months with multiple presidents
 */
function buildMonthlyContext(
  orders: EnrichedExecutiveOrder[],
  themes: ThemeRegistry,
  populations: PopulationRegistry,
  presidents: PresidentOrderCount[],
  year: number,
  month: number,
  monthName: string
): string {
  const topThemes = countThemes(orders, themes).slice(0, 10);
  const positivePopulations = countPopulations(orders, populations, 'positive').slice(0, 10);
  const negativePopulations = countPopulations(orders, populations, 'negative').slice(0, 10);
  const concerns = collectConcerns(orders);

  // Build president summary line
  const isTransitionMonth = presidents.length > 1;
  let presidentSummary: string;
  if (isTransitionMonth) {
    presidentSummary = presidents
      .map(p => `${p.president_name} (${p.order_count} orders)`)
      .join(' and ');
  } else {
    presidentSummary = presidents[0].president_name;
  }

  // All order titles for a month, grouped by president for transition months
  let orderTitles: string;
  if (isTransitionMonth) {
    const ordersByPresident = new Map<string, EnrichedExecutiveOrder[]>();
    for (const order of orders) {
      const id = order.president.identifier;
      if (!ordersByPresident.has(id)) {
        ordersByPresident.set(id, []);
      }
      ordersByPresident.get(id)!.push(order);
    }

    orderTitles = presidents.map(p => {
      const presOrders = ordersByPresident.get(p.president_id) || [];
      const titles = presOrders.map(o => `  - EO ${o.executive_order_number}: ${o.title}`).join('\n');
      return `${p.president_name}:\n${titles}`;
    }).join('\n\n');
  } else {
    orderTitles = orders.map(o =>
      `- EO ${o.executive_order_number}: ${o.title}`
    ).join('\n');
  }

  const transitionNote = isTransitionMonth
    ? '\nNOTE: This is a presidential transition month with orders from both the outgoing and incoming administration.\n'
    : '';

  return `
PRESIDENT(S): ${presidentSummary}
PERIOD: ${monthName} ${year}
TOTAL EXECUTIVE ORDERS: ${orders.length}
${transitionNote}
TOP THEMES (by frequency):
${topThemes.map(t => `- ${t.name}: ${t.count} orders`).join('\n')}

POPULATIONS AIMED TO POSITIVELY IMPACT:
${positivePopulations.map(p => `- ${p.name}: ${p.count} orders`).join('\n')}

POPULATIONS AIMED TO NEGATIVELY IMPACT:
${negativePopulations.map(p => `- ${p.name}: ${p.count} orders`).join('\n')}

ALL ORDERS THIS MONTH:
${orderTitles}

NOTABLE CONCERNS RAISED:
${concerns.slice(0, 10).map(c => `- ${c}`).join('\n')}
`.trim();
}

/**
 * Generate term narrative using OpenAI
 */
async function generateTermNarrativeWithLLM(
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

  return parseNarrativeResponse(response.choices[0]?.message?.content?.trim() || '[]');
}

/**
 * Generate monthly narrative using OpenAI
 */
async function generateMonthlyNarrativeWithLLM(
  openai: OpenAI,
  context: string,
  presidents: PresidentOrderCount[],
  monthName: string,
  year: number,
  totalOrderCount: number
): Promise<string[]> {
  const isTransitionMonth = presidents.length > 1;

  const systemPrompt = `You are a political analyst writing concise monthly summaries of executive order activity.

Guidelines:
- Write 1-2 SHORT paragraphs (50-80 words each, 120 words max total)
- Be direct and dense with information - no filler words or fluff
- Factual and neutral tone
- Use specific numbers
- Past tense for past months, present tense for current month
- No editorializing
- When discussing impacted populations, use language like "aimed to positively impact" or "aimed to negatively impact" rather than presuming actual outcomes
${isTransitionMonth ? '- This is a presidential transition month - acknowledge both administrations and their respective order counts' : ''}

Format: Return ONLY a JSON array of strings, each string being one paragraph. Example:
["First paragraph here.", "Second paragraph here."]`;

  let userPrompt: string;
  if (isTransitionMonth) {
    const presidentSummary = presidents
      .map(p => `${p.president_name} (${p.order_count})`)
      .join(' and ');
    userPrompt = `Summarize the ${totalOrderCount} executive orders from ${monthName} ${year}, signed by ${presidentSummary}, based on this data:

${context}

Return JSON array of 1-2 concise paragraphs:`;
  } else {
    userPrompt = `Summarize ${presidents[0].president_name}'s ${totalOrderCount} executive orders from ${monthName} ${year} based on this data:

${context}

Return JSON array of 1-2 concise paragraphs:`;
  }

  const response = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0.7,
    max_completion_tokens: 300,
    response_format: { type: 'json_object' }
  });

  return parseNarrativeResponse(response.choices[0]?.message?.content?.trim() || '[]');
}

/**
 * Parse LLM response into array of paragraphs
 */
function parseNarrativeResponse(content: string): string[] {
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      return parsed;
    } else if (parsed.paragraphs && Array.isArray(parsed.paragraphs)) {
      return parsed.paragraphs;
    } else if (parsed.narrative && Array.isArray(parsed.narrative)) {
      return parsed.narrative;
    }
    const values = Object.values(parsed);
    const arrayValue = values.find(v => Array.isArray(v));
    if (arrayValue) {
      return arrayValue as string[];
    }
    return [content];
  } catch {
    return content.split(/\n\n+/).filter(p => p.trim());
  }
}

/**
 * Load existing monthly narratives file
 */
async function loadExistingMonthlyNarratives(): Promise<MonthlyNarrativesFile | null> {
  try {
    const filePath = join(AGGREGATED_DIR, 'monthly-narratives.json');
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

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

// =============================================================================
// TERM NARRATIVES
// =============================================================================

/**
 * Generate term narratives
 */
export async function generateTermNarratives(options: {
  president?: string;
  force?: boolean;
} = {}): Promise<void> {
  console.log(`\n=== Generating Term Narratives ===\n`);

  const openai = new OpenAI();

  let orders = await loadAllEnriched();
  console.log(`Loaded ${orders.length} enriched orders`);

  if (orders.length === 0) {
    console.log('No enriched orders found. Run enrich first.');
    return;
  }

  if (options.president) {
    orders = filterByPresident(orders, options.president);
    console.log(`Filtered to ${orders.length} orders for "${options.president}"`);

    if (orders.length === 0) {
      console.log('No orders match that president.');
      return;
    }
  }

  const themes = await loadThemes();
  const populations = await loadPopulations();

  const terms = detectPresidentTerms(orders);
  const narratives: TermNarrative[] = [];

  for (const [presidentId, presTerms] of terms) {
    for (const term of presTerms) {
      const officialTerms = OFFICIAL_TERMS[presidentId];
      const officialTerm = officialTerms?.find(t =>
        new Date(t.start).getFullYear() === term.start
      );

      const termOrders = orders.filter(o => {
        if (o.president.identifier !== presidentId) return false;

        if (officialTerm) {
          const orderDate = new Date(o.signing_date);
          const startDate = new Date(officialTerm.start);
          const endDate = officialTerm.end ? new Date(officialTerm.end) : new Date('2099-12-31');
          return orderDate >= startDate && orderDate < endDate;
        } else {
          const year = new Date(o.signing_date).getFullYear();
          const endYear = term.end || new Date().getFullYear() + 1;
          return year >= term.start && year < endYear;
        }
      });

      if (termOrders.length === 0) continue;

      const presidentName = term.name;
      const termEnd = term.end || 'present';

      console.log(`\nGenerating narrative for ${presidentName} (${term.start}-${termEnd})...`);
      console.log(`  ${termOrders.length} orders to analyze`);

      const context = buildTermContext(
        termOrders,
        themes,
        populations,
        presidentName,
        term.start,
        termEnd
      );

      const charCount = context.length;
      const estimatedTokens = Math.ceil(charCount / 4);
      console.log(`  Context: ${charCount.toLocaleString()} chars, ~${estimatedTokens.toLocaleString()} tokens`);

      const narrative = await generateTermNarrativeWithLLM(
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

  narratives.sort((a, b) => {
    const aEnd = a.term_end === 'present' ? 9999 : a.term_end;
    const bEnd = b.term_end === 'present' ? 9999 : b.term_end;
    return bEnd - aEnd || b.term_start - a.term_start;
  });

  const output: TermNarrativesFile = {
    narratives,
    generated_at: new Date().toISOString()
  };

  await writeJson(join(AGGREGATED_DIR, 'narratives.json'), output);
  console.log(`\nSaved ${narratives.length} term narratives to narratives.json`);

  console.log('\nDone!');
}

// =============================================================================
// MONTHLY NARRATIVES
// =============================================================================

/**
 * Generate monthly narratives
 */
export async function generateMonthlyNarratives(options: {
  year?: number;
  month?: number;
  force?: boolean;
} = {}): Promise<void> {
  console.log(`\n=== Generating Monthly Narratives ===\n`);

  const openai = new OpenAI();

  const orders = await loadAllEnriched();
  console.log(`Loaded ${orders.length} enriched orders`);

  if (orders.length === 0) {
    console.log('No enriched orders found. Run enrich first.');
    return;
  }

  const themes = await loadThemes();
  const populations = await loadPopulations();

  // Load existing narratives to support incremental generation
  const existingFile = await loadExistingMonthlyNarratives();
  const existingNarratives = existingFile?.narratives || [];
  const existingKeys = new Set(
    existingNarratives.map(n => `${n.year}-${n.month}`)
  );

  // Group orders by year-month
  const byMonth = new Map<string, EnrichedExecutiveOrder[]>();
  for (const order of orders) {
    const date = new Date(order.signing_date);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;

    // Filter by year if specified
    if (options.year && year !== options.year) continue;

    // Filter by month if specified
    if (options.month && month !== options.month) continue;

    const key = `${year}-${month}`;
    if (!byMonth.has(key)) {
      byMonth.set(key, []);
    }
    byMonth.get(key)!.push(order);
  }

  if (byMonth.size === 0) {
    console.log('No orders match the specified criteria.');
    return;
  }

  // Sort by date (oldest first)
  const sortedKeys = Array.from(byMonth.keys()).sort();

  const newNarratives: MonthlyNarrative[] = [];
  let skipped = 0;

  for (const key of sortedKeys) {
    const [yearStr, monthStr] = key.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);
    const monthName = MONTH_NAMES[month - 1];

    // Skip if already exists (unless force)
    if (!options.force && existingKeys.has(key)) {
      skipped++;
      continue;
    }

    const monthOrders = byMonth.get(key)!;

    // Count orders by president to handle transition months
    const orderCountByPresident = new Map<string, { name: string; count: number }>();
    for (const order of monthOrders) {
      const id = order.president.identifier;
      if (!orderCountByPresident.has(id)) {
        orderCountByPresident.set(id, { name: order.president.name, count: 0 });
      }
      orderCountByPresident.get(id)!.count++;
    }

    // Build presidents array sorted by date of first order (outgoing president first)
    const presidentFirstOrder = new Map<string, Date>();
    for (const order of monthOrders) {
      const id = order.president.identifier;
      const orderDate = new Date(order.signing_date);
      if (!presidentFirstOrder.has(id) || orderDate < presidentFirstOrder.get(id)!) {
        presidentFirstOrder.set(id, orderDate);
      }
    }

    const presidents: PresidentOrderCount[] = Array.from(orderCountByPresident.entries())
      .sort((a, b) => presidentFirstOrder.get(a[0])!.getTime() - presidentFirstOrder.get(b[0])!.getTime())
      .map(([id, data]) => ({
        president_id: id,
        president_name: data.name,
        order_count: data.count
      }));

    const isTransitionMonth = presidents.length > 1;
    const presidentLabel = isTransitionMonth
      ? presidents.map(p => `${p.president_name} (${p.order_count})`).join(' + ')
      : presidents[0].president_name;

    console.log(`\nGenerating narrative for ${monthName} ${year}...`);
    console.log(`  ${monthOrders.length} orders to analyze${isTransitionMonth ? ' (transition month)' : ''}`);
    console.log(`  President(s): ${presidentLabel}`);

    const context = buildMonthlyContext(
      monthOrders,
      themes,
      populations,
      presidents,
      year,
      month,
      monthName
    );

    const charCount = context.length;
    const estimatedTokens = Math.ceil(charCount / 4);
    console.log(`  Context: ${charCount.toLocaleString()} chars, ~${estimatedTokens.toLocaleString()} tokens`);

    const narrative = await generateMonthlyNarrativeWithLLM(
      openai,
      context,
      presidents,
      monthName,
      year,
      monthOrders.length
    );

    const wordCount = narrative.reduce((acc, p) => acc + p.split(' ').length, 0);
    console.log(`  Generated ${narrative.length} paragraphs, ${wordCount} words`);

    newNarratives.push({
      year,
      month,
      month_name: monthName,
      presidents,
      total_order_count: monthOrders.length,
      narrative,
      generated_at: new Date().toISOString(),
      model_used: OPENAI_MODEL
    });
  }

  if (skipped > 0) {
    console.log(`\nSkipped ${skipped} months (already generated, use --force to regenerate)`);
  }

  // Merge with existing narratives
  const allNarratives = [...existingNarratives];

  for (const newNarrative of newNarratives) {
    const key = `${newNarrative.year}-${newNarrative.month}`;
    const existingIndex = allNarratives.findIndex(
      n => `${n.year}-${n.month}` === key
    );
    if (existingIndex >= 0) {
      allNarratives[existingIndex] = newNarrative;
    } else {
      allNarratives.push(newNarrative);
    }
  }

  // Sort by date (most recent first)
  allNarratives.sort((a, b) => {
    if (a.year !== b.year) return b.year - a.year;
    return b.month - a.month;
  });

  const output: MonthlyNarrativesFile = {
    narratives: allNarratives,
    generated_at: new Date().toISOString()
  };

  await writeJson(join(AGGREGATED_DIR, 'monthly-narratives.json'), output);
  console.log(`\nSaved ${allNarratives.length} monthly narratives to monthly-narratives.json`);
  if (newNarratives.length > 0) {
    console.log(`  (${newNarratives.length} newly generated)`);
  }

  console.log('\nDone!');
}

// =============================================================================
// MAIN ENTRY POINT
// =============================================================================

export type NarrativeType = 'term' | 'monthly' | 'all';

export interface GenerateNarrativesOptions {
  type?: NarrativeType;
  president?: string;
  year?: number;
  month?: number;
  force?: boolean;
}

/**
 * Main narrative generation function
 */
export async function generateNarratives(options: GenerateNarrativesOptions = {}): Promise<void> {
  const type = options.type || 'all';

  if (type === 'term' || type === 'all') {
    await generateTermNarratives({
      president: options.president,
      force: options.force
    });
  }

  if (type === 'monthly' || type === 'all') {
    await generateMonthlyNarratives({
      year: options.year,
      month: options.month,
      force: options.force
    });
  }
}
