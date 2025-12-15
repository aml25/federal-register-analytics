/**
 * Aggregate enriched executive orders into summaries
 */

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ENRICHED_DIR, AGGREGATED_DIR } from './config.js';
import { loadThemes, loadPopulations, readJson, writeJson } from './utils.js';
import type {
  EnrichedExecutiveOrder,
  ThemeRegistry,
  PopulationRegistry
} from './types.js';

// =============================================================================
// TYPES
// =============================================================================

interface TermSummary {
  president_id: string;
  president_name: string;
  term_start: number;
  term_end: number | 'present';
  order_count: number;
  top_themes: { id: string; name: string; count: number }[];
  short_summary: string; // e.g., "Donald Trump signed 126 executive orders from 2025 until present. The top themes have been: immigration, trade, deregulation."
}

interface TimelinePeriod {
  year: number;
  quarter: number;
  quarter_name: string; // e.g., "Q1 2025"
  president_id: string;
  president_name: string;
  order_count: number;
  top_themes: { id: string; name: string }[];
  theme_summary: string; // e.g., "Donald Trump signed 3 executive orders. They cover immigration and AI policy."
  order_ids: number[]; // EO numbers for this period
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Load all enriched executive orders
 */
async function loadAllEnriched(): Promise<EnrichedExecutiveOrder[]> {
  const files = await readdir(ENRICHED_DIR);
  const orders: EnrichedExecutiveOrder[] = [];

  for (const file of files) {
    if (!file.endsWith('.json')) continue;

    const order = await readJson<EnrichedExecutiveOrder>(join(ENRICHED_DIR, file));
    if (order) {
      orders.push(order);
    }
  }

  // Sort by signing date ascending (oldest first)
  return orders.sort((a, b) =>
    new Date(a.signing_date).getTime() - new Date(b.signing_date).getTime()
  );
}

/**
 * Official presidential term dates (inauguration dates)
 * Used to correctly label term boundaries regardless of available data
 */
const OFFICIAL_TERMS: Record<string, { start: string; end: string | null }[]> = {
  'donald-trump': [
    { start: '2017-01-20', end: '2021-01-20' },
    { start: '2025-01-20', end: null } // Current term
  ],
  'joe-biden': [
    { start: '2021-01-20', end: '2025-01-20' }
  ],
  'barack-obama': [
    { start: '2009-01-20', end: '2017-01-20' }
  ],
  'george-w-bush': [
    { start: '2001-01-20', end: '2009-01-20' }
  ],
  'bill-clinton': [
    { start: '1993-01-20', end: '2001-01-20' }
  ]
};

/**
 * Find which official term a date falls into
 */
function findOfficialTerm(
  presidentId: string,
  date: string
): { start: string; end: string | null } | null {
  const terms = OFFICIAL_TERMS[presidentId];
  if (!terms) return null;

  const d = new Date(date);
  for (const term of terms) {
    const start = new Date(term.start);
    const end = term.end ? new Date(term.end) : new Date('2099-12-31');
    if (d >= start && d < end) {
      return term;
    }
  }
  return null;
}

/**
 * Dynamically determine presidential terms from enriched orders
 * Uses official term dates when available, falls back to detection
 */
function detectPresidentTerms(
  orders: EnrichedExecutiveOrder[]
): Map<string, { start: number; end: number | null; name: string }[]> {
  const byPresident = new Map<string, EnrichedExecutiveOrder[]>();

  // Group orders by president
  for (const order of orders) {
    const id = order.president.identifier;
    if (!byPresident.has(id)) {
      byPresident.set(id, []);
    }
    byPresident.get(id)!.push(order);
  }

  const terms = new Map<string, { start: number; end: number | null; name: string }[]>();

  for (const [presidentId, presOrders] of byPresident) {
    const presidentName = presOrders[0].president.name;

    // Check if we have official term data
    if (OFFICIAL_TERMS[presidentId]) {
      // Group orders by official term
      const termMap = new Map<string, EnrichedExecutiveOrder[]>();

      for (const order of presOrders) {
        const officialTerm = findOfficialTerm(presidentId, order.signing_date);
        if (officialTerm) {
          const key = officialTerm.start;
          if (!termMap.has(key)) {
            termMap.set(key, []);
          }
          termMap.get(key)!.push(order);
        }
      }

      // Create term entries only for terms that have orders
      const presTerms: { start: number; end: number | null; name: string }[] = [];
      for (const [termStart, _termOrders] of termMap) {
        const officialTerm = OFFICIAL_TERMS[presidentId].find(t => t.start === termStart)!;
        presTerms.push({
          start: new Date(officialTerm.start).getFullYear(),
          end: officialTerm.end ? new Date(officialTerm.end).getFullYear() : null,
          name: presidentName
        });
      }

      // Sort by start year
      presTerms.sort((a, b) => a.start - b.start);
      terms.set(presidentId, presTerms);
    } else {
      // Fallback: detect terms from order gaps (for unknown presidents)
      presOrders.sort((a, b) =>
        new Date(a.signing_date).getTime() - new Date(b.signing_date).getTime()
      );

      const presTerms: { start: number; end: number | null; name: string }[] = [];
      let currentTermStart: number | null = null;
      let lastYear: number | null = null;
      const currentYear = new Date().getFullYear();

      for (const order of presOrders) {
        const year = new Date(order.signing_date).getFullYear();

        if (currentTermStart === null) {
          currentTermStart = year;
        } else if (lastYear !== null && year - lastYear > 2) {
          presTerms.push({
            start: currentTermStart,
            end: lastYear + 1,
            name: presidentName
          });
          currentTermStart = year;
        }

        lastYear = year;
      }

      if (currentTermStart !== null && lastYear !== null) {
        const isOngoing = currentYear - lastYear <= 1;
        presTerms.push({
          start: currentTermStart,
          end: isOngoing ? null : lastYear + 1,
          name: presidentName
        });
      }

      terms.set(presidentId, presTerms);
    }
  }

  return terms;
}

/**
 * Get term key for a president's term (used for file naming)
 */
function getTermKey(presidentId: string, startYear: number): string {
  return `${presidentId}-${startYear}`;
}

/**
 * Count theme occurrences and return sorted
 */
function countThemes(
  orders: EnrichedExecutiveOrder[],
  themeRegistry: ThemeRegistry
): { id: string; name: string; count: number }[] {
  const counts = new Map<string, number>();

  for (const order of orders) {
    for (const themeId of order.enrichment.theme_ids) {
      counts.set(themeId, (counts.get(themeId) || 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([id, count]) => ({
      id,
      name: themeRegistry.themes.find(t => t.id === id)?.name || id,
      count
    }));
}

/**
 * Format theme list as readable text
 * e.g., "immigration, AI policy, and 3 others"
 */
function formatThemeList(themes: { id: string; name: string }[], maxShow: number = 3): string {
  if (themes.length === 0) return 'various topics';

  const shown = themes.slice(0, maxShow).map(t => t.name.toLowerCase());
  const remaining = themes.length - maxShow;

  if (remaining <= 0) {
    if (shown.length === 1) return shown[0];
    if (shown.length === 2) return `${shown[0]} and ${shown[1]}`;
    return `${shown.slice(0, -1).join(', ')}, and ${shown[shown.length - 1]}`;
  }

  return `${shown.join(', ')}, and ${remaining} other${remaining > 1 ? 's' : ''}`;
}

/**
 * Get quarter from month (1-12 -> 1-4)
 */
function getQuarterFromMonth(month: number): number {
  return Math.ceil(month / 3);
}

/**
 * Get quarter name (e.g., "Q1 2025")
 */
function getQuarterName(quarter: number, year: number): string {
  return `Q${quarter} ${year}`;
}

// =============================================================================
// GENERATORS
// =============================================================================

/**
 * Generate term summaries for home page
 */
function generateTermSummaries(
  orders: EnrichedExecutiveOrder[],
  themeRegistry: ThemeRegistry
): TermSummary[] {
  const terms = detectPresidentTerms(orders);
  const summaries: TermSummary[] = [];

  for (const [presidentId, presTerms] of terms) {
    for (const term of presTerms) {
      // Filter orders that belong to this term
      // Use official term dates if available for accurate filtering
      const officialTerms = OFFICIAL_TERMS[presidentId];
      const officialTerm = officialTerms?.find(t =>
        new Date(t.start).getFullYear() === term.start
      );

      const termOrders = orders.filter(o => {
        if (o.president.identifier !== presidentId) return false;

        if (officialTerm) {
          // Use exact dates for known presidents
          const orderDate = new Date(o.signing_date);
          const startDate = new Date(officialTerm.start);
          const endDate = officialTerm.end ? new Date(officialTerm.end) : new Date('2099-12-31');
          return orderDate >= startDate && orderDate < endDate;
        } else {
          // Fallback to year-based filtering
          const year = new Date(o.signing_date).getFullYear();
          const endYear = term.end || new Date().getFullYear() + 1;
          return year >= term.start && year < endYear;
        }
      });

      if (termOrders.length === 0) continue;

      const topThemes = countThemes(termOrders, themeRegistry).slice(0, 5);
      const presidentName = term.name;
      const termEnd = term.end || 'present';
      const isPastTerm = term.end !== null;

      const themeNames = topThemes.slice(0, 5).map(t => t.name.toLowerCase()).join(', ');
      const themeVerb = isPastTerm ? 'were' : 'have been';
      const shortSummary = `${presidentName} signed ${termOrders.length} executive order${termOrders.length !== 1 ? 's' : ''} from ${term.start} until ${termEnd}. The top themes ${themeVerb}: ${themeNames}.`;

      summaries.push({
        president_id: presidentId,
        president_name: presidentName,
        term_start: term.start,
        term_end: termEnd,
        order_count: termOrders.length,
        top_themes: topThemes,
        short_summary: shortSummary
      });
    }
  }

  // Sort by term start descending (most recent first)
  return summaries.sort((a, b) => {
    const aEnd = a.term_end === 'present' ? 9999 : a.term_end;
    const bEnd = b.term_end === 'present' ? 9999 : b.term_end;
    return bEnd - aEnd || b.term_start - a.term_start;
  });
}

/**
 * Generate timeline data grouped by quarter
 */
function generateTimeline(
  orders: EnrichedExecutiveOrder[],
  themeRegistry: ThemeRegistry
): TimelinePeriod[] {
  const byQuarter = new Map<string, EnrichedExecutiveOrder[]>();

  // Group by year-quarter
  for (const order of orders) {
    const date = new Date(order.signing_date);
    const quarter = getQuarterFromMonth(date.getMonth() + 1);
    const key = `${date.getFullYear()}-Q${quarter}`;

    if (!byQuarter.has(key)) {
      byQuarter.set(key, []);
    }
    byQuarter.get(key)!.push(order);
  }

  const periods: TimelinePeriod[] = [];

  for (const [key, quarterOrders] of byQuarter) {
    const [yearStr, quarterStr] = key.split('-');
    const year = Number(yearStr);
    const quarter = Number(quarterStr.replace('Q', ''));

    // Get themes for this quarter
    const topThemes = countThemes(quarterOrders, themeRegistry).slice(0, 5);

    // Get president(s) for this quarter - usually just one, but transition quarters may have two
    const presidents = [...new Set(quarterOrders.map(o => o.president.name))];
    const presidentName = presidents.join(' and ');
    const presidentId = quarterOrders[0].president.identifier;

    // Generate theme summary text
    const themeText = formatThemeList(topThemes, 3);
    const themeSummary = `${presidentName} signed ${quarterOrders.length} executive order${quarterOrders.length !== 1 ? 's' : ''} focused on the themes of ${themeText}.`;

    periods.push({
      year,
      quarter,
      quarter_name: getQuarterName(quarter, year),
      president_id: presidentId,
      president_name: presidentName,
      order_count: quarterOrders.length,
      top_themes: topThemes.slice(0, 5).map(t => ({ id: t.id, name: t.name })),
      theme_summary: themeSummary,
      order_ids: quarterOrders.map(o => o.executive_order_number)
    });
  }

  // Sort by date descending (most recent first)
  return periods.sort((a, b) => {
    if (a.year !== b.year) return b.year - a.year;
    return b.quarter - a.quarter;
  });
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
 * Main aggregate function
 */
export async function aggregate(options: { president?: string } = {}): Promise<void> {
  console.log(`\n=== Aggregating Executive Orders ===\n`);

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
  console.log(`Loaded ${themes.themes.length} themes, ${populations.populations.length} populations`);

  // Generate term summaries
  console.log('\nGenerating term summaries...');
  const termSummaries = generateTermSummaries(orders, themes);
  await writeJson(join(AGGREGATED_DIR, 'term-summaries.json'), {
    summaries: termSummaries,
    generated_at: new Date().toISOString()
  });
  console.log(`  Generated ${termSummaries.length} term summaries`);

  // Generate timeline
  console.log('\nGenerating timeline...');
  const timeline = generateTimeline(orders, themes);
  await writeJson(join(AGGREGATED_DIR, 'timeline.json'), {
    periods: timeline,
    generated_at: new Date().toISOString()
  });
  console.log(`  Generated ${timeline.length} timeline periods`);

  console.log('\nDone!');
}

// Export helpers for use in narratives.ts
export { loadAllEnriched, detectPresidentTerms, getTermKey, countThemes, formatThemeList, OFFICIAL_TERMS };
