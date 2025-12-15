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
  summary: string;
  potential_impact: string;
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

interface QuarterlyNarrative {
  year: number;
  quarter: number;
  quarter_name: string;
  presidents: PresidentOrderCount[];  // Supports transition quarters with multiple presidents
  total_order_count: number;
  summary: string;
  potential_impact: string;
  generated_at: string;
  model_used: string;
}

interface QuarterlyNarrativesFile {
  narratives: QuarterlyNarrative[];
  generated_at: string;
}

// =============================================================================
// HELPERS
// =============================================================================

const QUARTER_NAMES = ['Q1', 'Q2', 'Q3', 'Q4'];

/**
 * Get quarter from month (1-12 -> 1-4)
 */
function getQuarterFromMonth(month: number): number {
  return Math.ceil(month / 3);
}

/**
 * Get quarter display name (e.g., "Q1 2025")
 */
function getQuarterName(quarter: number, year: number): string {
  return `Q${quarter} ${year}`;
}

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
 * Build context for LLM to generate quarterly narrative
 * Handles transition quarters with multiple presidents
 */
function buildQuarterlyContext(
  orders: EnrichedExecutiveOrder[],
  themes: ThemeRegistry,
  populations: PopulationRegistry,
  presidents: PresidentOrderCount[],
  year: number,
  quarter: number,
  quarterName: string
): string {
  const topThemes = countThemes(orders, themes).slice(0, 10);
  const positivePopulations = countPopulations(orders, populations, 'positive').slice(0, 10);
  const negativePopulations = countPopulations(orders, populations, 'negative').slice(0, 10);
  const concerns = collectConcerns(orders);

  // Build president summary line
  const isTransitionQuarter = presidents.length > 1;
  let presidentSummary: string;
  if (isTransitionQuarter) {
    presidentSummary = presidents
      .map(p => `${p.president_name} (${p.order_count} orders)`)
      .join(' and ');
  } else {
    presidentSummary = presidents[0].president_name;
  }

  // All order titles for a quarter, grouped by president for transition quarters
  let orderTitles: string;
  if (isTransitionQuarter) {
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

  const transitionNote = isTransitionQuarter
    ? '\nNOTE: This is a presidential transition quarter with orders from both the outgoing and incoming administration.\n'
    : '';

  return `
PRESIDENT(S): ${presidentSummary}
PERIOD: ${quarterName}
TOTAL EXECUTIVE ORDERS: ${orders.length}
${transitionNote}
TOP THEMES (by frequency):
${topThemes.map(t => `- ${t.name}: ${t.count} orders`).join('\n')}

POPULATIONS AIMED TO POSITIVELY IMPACT:
${positivePopulations.map(p => `- ${p.name}: ${p.count} orders`).join('\n')}

POPULATIONS AIMED TO NEGATIVELY IMPACT:
${negativePopulations.map(p => `- ${p.name}: ${p.count} orders`).join('\n')}

ALL ORDERS THIS QUARTER:
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
  orderCount: number,
  termEnd: number | 'present'
): Promise<{ summary: string; potential_impact: string }> {
  const isOngoing = termEnd === 'present';

  const systemPrompt = `You are a journalist writing engaging summaries of presidential executive order activity for an informed general audience.

Your goal is to write NARRATIVE PROSE that tells a story - NOT bullet points or lists in paragraph form.

Guidelines:
- Write in flowing, narrative prose that weaves facts into a coherent story
- Neutral, factual tone but engaging and readable - like quality journalism
- Use specific numbers naturally within sentences
- Show how themes connect and what priorities defined the term
- Avoid list-like structures ("First... Second... Third..." or "The top themes were X, Y, and Z")
- ${isOngoing ? 'Present tense for ongoing administration' : 'Past tense for completed term'}
- No editorializing - let the facts tell the story
- When discussing impacted populations, use language like "aimed to benefit" or "would affect" rather than presuming actual outcomes

You must return a JSON object with two fields:
1. "summary" - One concise paragraph (60-90 words) telling the story of this president's executive order activity: what policy priorities dominated and what defined the administration's approach. Don't enumerate themes - explain what the president was trying to accomplish.
2. "potential_impact" - One concise paragraph (60-90 words) narratively describing who these orders aimed to affect and what concerns observers raised. Don't list populations - tell the story of winners and losers.

BAD example (too listy): "Biden signed 162 orders. The top themes were climate (25), healthcare (20), and immigration (18). Populations affected include federal employees, businesses, and immigrants."

GOOD example: "Climate action anchored the administration's executive agenda from day one, with early orders rejoining the Paris Agreement and pausing new oil and gas leases on federal lands. Healthcare policy emerged as another defining priority, particularly efforts to strengthen the Affordable Care Act and expand access during the pandemic..."

Return JSON with "summary" and "potential_impact" fields:`;

  const userPrompt = `Analyze ${presidentName}'s ${orderCount} executive orders based on this data:

${context}

Return JSON with "summary" and "potential_impact" fields:`;

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

  return parseSummaryImpactResponse(response.choices[0]?.message?.content?.trim() || '{}');
}

/**
 * Generate quarterly narrative using OpenAI
 */
async function generateQuarterlyNarrativeWithLLM(
  openai: OpenAI,
  context: string,
  presidents: PresidentOrderCount[],
  quarterName: string,
  year: number,
  totalOrderCount: number
): Promise<{ summary: string; potential_impact: string }> {
  const isTransitionQuarter = presidents.length > 1;

  const systemPrompt = `You are a journalist writing engaging quarterly summaries of executive order activity for an informed general audience.

Your goal is to write NARRATIVE PROSE that tells a story - NOT bullet points or lists in paragraph form.

Guidelines:
- Write in flowing, narrative prose that weaves facts into a coherent story
- Neutral, factual tone but engaging and readable - like quality journalism
- Use specific numbers naturally within sentences (e.g., "signed 12 orders focused on..." not "12 orders were signed")
- Show connections between orders and themes - don't just enumerate them
- Avoid list-like structures ("First... Second... Third..." or "The top themes were X, Y, and Z")
- Past tense for past quarters, present tense for current quarter
- No editorializing or opinion - let the facts tell the story
- When discussing impacted populations, use language like "aimed to benefit" or "would affect" rather than presuming actual outcomes
${isTransitionQuarter ? '- This is a presidential transition quarter - weave in the narrative of power changing hands' : ''}

You must return a JSON object with two fields:
1. "summary" - One concise paragraph (60-100 words) that tells the story of this quarter's executive actions: what policy directions emerged and what priorities were evident. Don't just list themes - explain what the president was trying to accomplish.
2. "potential_impact" - One concise paragraph (60-100 words) that narratively describes who these orders aimed to affect and what concerns observers raised. Don't just list populations - tell the story of who stands to gain or lose.

BAD example (too listy): "Trump signed 45 orders in Q1. The top themes were immigration (15 orders), trade (12 orders), and government reform (9 orders). Populations affected include federal employees, immigrants, and businesses."

GOOD example: "The administration moved aggressively on immigration policy throughout the quarter, with orders tightening border enforcement and interior deportation procedures. Trade policy emerged as another priority, as multiple orders imposed new tariffs and renegotiated existing agreements. A quieter but significant thread involved government restructuring..."

Return JSON with "summary" and "potential_impact" fields:`;

  let userPrompt: string;
  if (isTransitionQuarter) {
    const presidentSummary = presidents
      .map(p => `${p.president_name} (${p.order_count})`)
      .join(' and ');
    userPrompt = `Analyze the ${totalOrderCount} executive orders from ${quarterName}, signed by ${presidentSummary}, based on this data:

${context}

Return JSON with "summary" and "potential_impact" fields:`;
  } else {
    userPrompt = `Analyze ${presidents[0].president_name}'s ${totalOrderCount} executive orders from ${quarterName} based on this data:

${context}

Return JSON with "summary" and "potential_impact" fields:`;
  }

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

  return parseSummaryImpactResponse(response.choices[0]?.message?.content?.trim() || '{}');
}

/**
 * Parse LLM response into summary and potential_impact
 */
function parseSummaryImpactResponse(content: string): { summary: string; potential_impact: string } {
  try {
    const parsed = JSON.parse(content);
    return {
      summary: parsed.summary || '',
      potential_impact: parsed.potential_impact || ''
    };
  } catch {
    // Fallback: try to split content into two parts
    const parts = content.split(/\n\n+/).filter(p => p.trim());
    return {
      summary: parts[0] || '',
      potential_impact: parts[1] || ''
    };
  }
}

/**
 * Load existing quarterly narratives file
 */
async function loadExistingQuarterlyNarratives(): Promise<QuarterlyNarrativesFile | null> {
  try {
    const filePath = join(AGGREGATED_DIR, 'quarterly-narratives.json');
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
 * Load existing term narratives file
 */
async function loadExistingTermNarratives(): Promise<TermNarrativesFile | null> {
  try {
    const filePath = join(AGGREGATED_DIR, 'narratives.json');
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Generate term narratives
 */
export async function generateTermNarratives(options: {
  president?: string;
  year?: number;
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

  // If year is specified, identify which presidents have orders in that year
  // Only regenerate narratives for those presidents
  let presidentsToUpdate: Set<string> | null = null;
  if (options.year) {
    presidentsToUpdate = new Set<string>();
    for (const order of orders) {
      const orderYear = new Date(order.signing_date).getFullYear();
      if (orderYear === options.year) {
        presidentsToUpdate.add(order.president.identifier);
      }
    }
    console.log(`Year ${options.year} filter: will update narratives for ${presidentsToUpdate.size} president(s)`);
    if (presidentsToUpdate.size === 0) {
      console.log('No presidents have orders in that year.');
      return;
    }
  }

  const themes = await loadThemes();
  const populations = await loadPopulations();

  // Load existing narratives for incremental generation
  const existingFile = await loadExistingTermNarratives();
  const existingNarratives = existingFile?.narratives || [];

  const terms = detectPresidentTerms(orders);
  const newNarratives: TermNarrative[] = [];
  let skipped = 0;

  for (const [presidentId, presTerms] of terms) {
    // Skip this president if year filter is active and they're not in the update set
    if (presidentsToUpdate && !presidentsToUpdate.has(presidentId)) {
      skipped++;
      continue;
    }

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

      const { summary, potential_impact } = await generateTermNarrativeWithLLM(
        openai,
        context,
        presidentName,
        termOrders.length,
        termEnd
      );

      const wordCount = summary.split(' ').length + potential_impact.split(' ').length;
      console.log(`  Generated summary + impact, ${wordCount} words`);

      newNarratives.push({
        president_id: presidentId,
        president_name: presidentName,
        term_start: term.start,
        term_end: termEnd,
        order_count: termOrders.length,
        summary,
        potential_impact,
        generated_at: new Date().toISOString(),
        model_used: OPENAI_MODEL
      });
    }
  }

  if (skipped > 0) {
    console.log(`\nSkipped ${skipped} president(s) (not in year ${options.year})`);
  }

  // Merge with existing narratives
  const allNarratives = [...existingNarratives];

  for (const newNarrative of newNarratives) {
    const key = `${newNarrative.president_id}-${newNarrative.term_start}`;
    const existingIndex = allNarratives.findIndex(
      n => `${n.president_id}-${n.term_start}` === key
    );
    if (existingIndex >= 0) {
      allNarratives[existingIndex] = newNarrative;
    } else {
      allNarratives.push(newNarrative);
    }
  }

  allNarratives.sort((a, b) => {
    const aEnd = a.term_end === 'present' ? 9999 : a.term_end;
    const bEnd = b.term_end === 'present' ? 9999 : b.term_end;
    return bEnd - aEnd || b.term_start - a.term_start;
  });

  const output: TermNarrativesFile = {
    narratives: allNarratives,
    generated_at: new Date().toISOString()
  };

  await writeJson(join(AGGREGATED_DIR, 'narratives.json'), output);
  console.log(`\nSaved ${allNarratives.length} term narratives to narratives.json`);
  if (newNarratives.length > 0) {
    console.log(`  (${newNarratives.length} newly generated)`);
  }

  console.log('\nDone!');
}

// =============================================================================
// QUARTERLY NARRATIVES
// =============================================================================

/**
 * Generate quarterly narratives
 */
export async function generateQuarterlyNarratives(options: {
  year?: number;
  quarter?: number;
  force?: boolean;
} = {}): Promise<void> {
  console.log(`\n=== Generating Quarterly Narratives ===\n`);

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
  const existingFile = await loadExistingQuarterlyNarratives();
  const existingNarratives = existingFile?.narratives || [];
  const existingKeys = new Set(
    existingNarratives.map(n => `${n.year}-${n.quarter}`)
  );

  // Group orders by year-quarter
  const byQuarter = new Map<string, EnrichedExecutiveOrder[]>();
  for (const order of orders) {
    const date = new Date(order.signing_date);
    const year = date.getFullYear();
    const quarter = getQuarterFromMonth(date.getMonth() + 1);

    // Filter by year if specified
    if (options.year && year !== options.year) continue;

    // Filter by quarter if specified
    if (options.quarter && quarter !== options.quarter) continue;

    const key = `${year}-${quarter}`;
    if (!byQuarter.has(key)) {
      byQuarter.set(key, []);
    }
    byQuarter.get(key)!.push(order);
  }

  if (byQuarter.size === 0) {
    console.log('No orders match the specified criteria.');
    return;
  }

  // Sort by date (oldest first)
  const sortedKeys = Array.from(byQuarter.keys()).sort();

  const newNarratives: QuarterlyNarrative[] = [];
  let skipped = 0;

  for (const key of sortedKeys) {
    const [yearStr, quarterStr] = key.split('-');
    const year = parseInt(yearStr, 10);
    const quarter = parseInt(quarterStr, 10);
    const quarterName = getQuarterName(quarter, year);

    // Skip if already exists (unless force)
    if (!options.force && existingKeys.has(key)) {
      skipped++;
      continue;
    }

    const quarterOrders = byQuarter.get(key)!;

    // Count orders by president to handle transition quarters
    const orderCountByPresident = new Map<string, { name: string; count: number }>();
    for (const order of quarterOrders) {
      const id = order.president.identifier;
      if (!orderCountByPresident.has(id)) {
        orderCountByPresident.set(id, { name: order.president.name, count: 0 });
      }
      orderCountByPresident.get(id)!.count++;
    }

    // Build presidents array sorted by date of first order (outgoing president first)
    const presidentFirstOrder = new Map<string, Date>();
    for (const order of quarterOrders) {
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

    const isTransitionQuarter = presidents.length > 1;
    const presidentLabel = isTransitionQuarter
      ? presidents.map(p => `${p.president_name} (${p.order_count})`).join(' + ')
      : presidents[0].president_name;

    console.log(`\nGenerating narrative for ${quarterName}...`);
    console.log(`  ${quarterOrders.length} orders to analyze${isTransitionQuarter ? ' (transition quarter)' : ''}`);
    console.log(`  President(s): ${presidentLabel}`);

    const context = buildQuarterlyContext(
      quarterOrders,
      themes,
      populations,
      presidents,
      year,
      quarter,
      quarterName
    );

    const charCount = context.length;
    const estimatedTokens = Math.ceil(charCount / 4);
    console.log(`  Context: ${charCount.toLocaleString()} chars, ~${estimatedTokens.toLocaleString()} tokens`);

    const { summary, potential_impact } = await generateQuarterlyNarrativeWithLLM(
      openai,
      context,
      presidents,
      quarterName,
      year,
      quarterOrders.length
    );

    const wordCount = summary.split(' ').length + potential_impact.split(' ').length;
    console.log(`  Generated summary + impact, ${wordCount} words`);

    newNarratives.push({
      year,
      quarter,
      quarter_name: quarterName,
      presidents,
      total_order_count: quarterOrders.length,
      summary,
      potential_impact,
      generated_at: new Date().toISOString(),
      model_used: OPENAI_MODEL
    });
  }

  if (skipped > 0) {
    console.log(`\nSkipped ${skipped} quarters (already generated, use --force to regenerate)`);
  }

  // Merge with existing narratives
  const allNarratives = [...existingNarratives];

  for (const newNarrative of newNarratives) {
    const key = `${newNarrative.year}-${newNarrative.quarter}`;
    const existingIndex = allNarratives.findIndex(
      n => `${n.year}-${n.quarter}` === key
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
    return b.quarter - a.quarter;
  });

  const output: QuarterlyNarrativesFile = {
    narratives: allNarratives,
    generated_at: new Date().toISOString()
  };

  await writeJson(join(AGGREGATED_DIR, 'quarterly-narratives.json'), output);
  console.log(`\nSaved ${allNarratives.length} quarterly narratives to quarterly-narratives.json`);
  if (newNarratives.length > 0) {
    console.log(`  (${newNarratives.length} newly generated)`);
  }

  console.log('\nDone!');
}

// =============================================================================
// THEME NARRATIVES
// =============================================================================

interface ThemeNarrative {
  theme_id: string;
  theme_name: string;
  order_count: number;
  presidents: { president_id: string; president_name: string; order_count: number }[];
  summary: string;
  potential_impact: string;
  generated_at: string;
  model_used: string;
}

interface ThemeNarrativesFile {
  narratives: ThemeNarrative[];
  generated_at: string;
}

/**
 * Build context for LLM to generate theme narrative
 */
function buildThemeContext(
  orders: EnrichedExecutiveOrder[],
  themeName: string,
  populations: PopulationRegistry
): string {
  const positivePopulations = countPopulations(orders, populations, 'positive').slice(0, 10);
  const negativePopulations = countPopulations(orders, populations, 'negative').slice(0, 10);
  const concerns = collectConcerns(orders);

  // Group by president
  const byPresident = new Map<string, EnrichedExecutiveOrder[]>();
  for (const order of orders) {
    const id = order.president.identifier;
    if (!byPresident.has(id)) {
      byPresident.set(id, []);
    }
    byPresident.get(id)!.push(order);
  }

  const presidentSummaries = Array.from(byPresident.entries())
    .map(([_id, presOrders]) => {
      const name = presOrders[0].president.name;
      return `- ${name}: ${presOrders.length} orders`;
    })
    .join('\n');

  // Sample order titles
  const orderTitles = orders.slice(0, 30).map(o =>
    `- EO ${o.executive_order_number}: ${o.title} (${o.president.name})`
  ).join('\n');

  return `
THEME: ${themeName}
TOTAL EXECUTIVE ORDERS: ${orders.length}

ORDERS BY PRESIDENT:
${presidentSummaries}

POPULATIONS AIMED TO POSITIVELY IMPACT:
${positivePopulations.map(p => `- ${p.name}: ${p.count} orders`).join('\n')}

POPULATIONS AIMED TO NEGATIVELY IMPACT:
${negativePopulations.map(p => `- ${p.name}: ${p.count} orders`).join('\n')}

SAMPLE ORDER TITLES:
${orderTitles}

NOTABLE CONCERNS RAISED:
${concerns.slice(0, 15).map(c => `- ${c}`).join('\n')}
`.trim();
}

/**
 * Generate theme narrative using OpenAI
 */
async function generateThemeNarrativeWithLLM(
  openai: OpenAI,
  context: string,
  themeName: string,
  orderCount: number
): Promise<{ summary: string; potential_impact: string }> {
  const systemPrompt = `You are a journalist writing engaging thematic summaries of executive order activity for an informed general audience.

Your goal is to write NARRATIVE PROSE that tells a story - NOT bullet points or lists in paragraph form.

Guidelines:
- Write in flowing, narrative prose that weaves facts into a coherent story
- Neutral, factual tone but engaging and readable - like quality journalism
- Use specific numbers naturally within sentences
- Show how different presidents approached this theme and what patterns emerge
- Avoid list-like structures ("First... Second... Third..." or "Presidents who addressed this include X, Y, and Z")
- No editorializing - let the facts tell the story
- When discussing impacted populations, use language like "aimed to benefit" or "would affect" rather than presuming actual outcomes

You must return a JSON object with two fields:
1. "summary" - One concise paragraph (50-80 words) telling the story of executive action on this theme: what policies presidents pursued and how approaches differed across administrations. Don't list presidents and counts - explain what was done and why it matters.
2. "potential_impact" - One concise paragraph (50-80 words) narratively describing who these orders aimed to affect and what concerns observers raised. Don't list populations - tell the story of who stands to gain or lose.

BAD example (too listy): "This theme covers 45 orders. Trump signed 25 orders on this topic, Biden signed 20. Populations affected include businesses, workers, and consumers."

GOOD example: "Immigration policy has been shaped by sharply contrasting visions across administrations. The Trump administration focused on border enforcement and interior deportation, with orders expanding detention capacity and restricting asylum pathways. The Biden administration largely reversed course, halting wall construction and directing agencies to review enforcement priorities..."

Return JSON with "summary" and "potential_impact" fields:`;

  const userPrompt = `Analyze the ${orderCount} executive orders tagged with the "${themeName}" theme based on this data:

${context}

Return JSON with "summary" and "potential_impact" fields:`;

  const response = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0.7,
    max_completion_tokens: 350,
    response_format: { type: 'json_object' }
  });

  return parseSummaryImpactResponse(response.choices[0]?.message?.content?.trim() || '{}');
}

/**
 * Load existing theme narratives file
 */
async function loadExistingThemeNarratives(): Promise<ThemeNarrativesFile | null> {
  try {
    const filePath = join(AGGREGATED_DIR, 'theme-narratives.json');
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Generate theme narratives
 */
export async function generateThemeNarratives(options: {
  theme?: string;
  force?: boolean;
} = {}): Promise<void> {
  console.log(`\n=== Generating Theme Narratives ===\n`);

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
  const existingFile = await loadExistingThemeNarratives();
  const existingNarratives = existingFile?.narratives || [];
  const existingKeys = new Set(existingNarratives.map(n => n.theme_id));

  // Group orders by theme
  const byTheme = new Map<string, EnrichedExecutiveOrder[]>();
  for (const order of orders) {
    for (const themeId of order.enrichment.theme_ids) {
      if (!byTheme.has(themeId)) {
        byTheme.set(themeId, []);
      }
      byTheme.get(themeId)!.push(order);
    }
  }

  // Filter to specific theme if provided
  const themeIds = options.theme
    ? Array.from(byTheme.keys()).filter(id => id.includes(options.theme!.toLowerCase()))
    : Array.from(byTheme.keys());

  if (themeIds.length === 0) {
    console.log('No themes match the specified criteria.');
    return;
  }

  // Sort themes by order count descending
  themeIds.sort((a, b) => (byTheme.get(b)?.length || 0) - (byTheme.get(a)?.length || 0));

  const newNarratives: ThemeNarrative[] = [];
  let skipped = 0;

  for (const themeId of themeIds) {
    // Skip if already exists (unless force)
    if (!options.force && existingKeys.has(themeId)) {
      skipped++;
      continue;
    }

    const themeOrders = byTheme.get(themeId)!;
    const theme = themes.themes.find(t => t.id === themeId);
    const themeName = theme?.name || themeId;

    // Skip themes with very few orders
    if (themeOrders.length < 2) {
      continue;
    }

    console.log(`\nGenerating narrative for "${themeName}"...`);
    console.log(`  ${themeOrders.length} orders to analyze`);

    // Count orders by president
    const orderCountByPresident = new Map<string, { name: string; count: number }>();
    for (const order of themeOrders) {
      const id = order.president.identifier;
      if (!orderCountByPresident.has(id)) {
        orderCountByPresident.set(id, { name: order.president.name, count: 0 });
      }
      orderCountByPresident.get(id)!.count++;
    }

    const presidents = Array.from(orderCountByPresident.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .map(([id, data]) => ({
        president_id: id,
        president_name: data.name,
        order_count: data.count
      }));

    const context = buildThemeContext(themeOrders, themeName, populations);

    const charCount = context.length;
    const estimatedTokens = Math.ceil(charCount / 4);
    console.log(`  Context: ${charCount.toLocaleString()} chars, ~${estimatedTokens.toLocaleString()} tokens`);

    const { summary, potential_impact } = await generateThemeNarrativeWithLLM(
      openai,
      context,
      themeName,
      themeOrders.length
    );

    const wordCount = summary.split(' ').length + potential_impact.split(' ').length;
    console.log(`  Generated summary + impact, ${wordCount} words`);

    newNarratives.push({
      theme_id: themeId,
      theme_name: themeName,
      order_count: themeOrders.length,
      presidents,
      summary,
      potential_impact,
      generated_at: new Date().toISOString(),
      model_used: OPENAI_MODEL
    });
  }

  if (skipped > 0) {
    console.log(`\nSkipped ${skipped} themes (already generated, use --force to regenerate)`);
  }

  // Merge with existing narratives
  const allNarratives = [...existingNarratives];

  for (const newNarrative of newNarratives) {
    const existingIndex = allNarratives.findIndex(n => n.theme_id === newNarrative.theme_id);
    if (existingIndex >= 0) {
      allNarratives[existingIndex] = newNarrative;
    } else {
      allNarratives.push(newNarrative);
    }
  }

  // Sort by order count descending
  allNarratives.sort((a, b) => b.order_count - a.order_count);

  const output: ThemeNarrativesFile = {
    narratives: allNarratives,
    generated_at: new Date().toISOString()
  };

  await writeJson(join(AGGREGATED_DIR, 'theme-narratives.json'), output);
  console.log(`\nSaved ${allNarratives.length} theme narratives to theme-narratives.json`);
  if (newNarratives.length > 0) {
    console.log(`  (${newNarratives.length} newly generated)`);
  }

  console.log('\nDone!');
}

// =============================================================================
// MAIN ENTRY POINT
// =============================================================================

export type NarrativeType = 'term' | 'quarterly' | 'theme' | 'all';

export interface GenerateNarrativesOptions {
  type?: NarrativeType;
  president?: string;
  year?: number;
  quarter?: number;
  theme?: string;
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
      year: options.year,
      force: options.force
    });
  }

  if (type === 'quarterly' || type === 'all') {
    await generateQuarterlyNarratives({
      year: options.year,
      quarter: options.quarter,
      force: options.force
    });
  }

  if (type === 'theme' || type === 'all') {
    await generateThemeNarratives({
      theme: options.theme,
      force: options.force
    });
  }
}
