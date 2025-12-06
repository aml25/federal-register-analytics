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
  month: number;
  month_name: string;
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
 * Dynamically determine presidential terms from enriched orders
 * Detects term boundaries by looking for gaps of 2+ years between orders
 */
function detectPresidentTerms(
  orders: EnrichedExecutiveOrder[]
): Map<string, { start: number; end: number | null; name: string }[]> {
  const currentYear = new Date().getFullYear();
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
    // Sort by signing date
    presOrders.sort((a, b) =>
      new Date(a.signing_date).getTime() - new Date(b.signing_date).getTime()
    );

    const presidentName = presOrders[0].president.name;
    const presTerms: { start: number; end: number | null; name: string }[] = [];
    let currentTermStart: number | null = null;
    let lastYear: number | null = null;

    for (const order of presOrders) {
      const year = new Date(order.signing_date).getFullYear();

      if (currentTermStart === null) {
        // First order - start a new term
        currentTermStart = year;
      } else if (lastYear !== null && year - lastYear > 2) {
        // Gap detected - close previous term and start new one
        presTerms.push({
          start: currentTermStart,
          end: lastYear + 1, // Term ended year after last order
          name: presidentName
        });
        currentTermStart = year;
      }

      lastYear = year;
    }

    // Close final term
    if (currentTermStart !== null && lastYear !== null) {
      // If last order was this year or last year, term is ongoing
      const isOngoing = currentYear - lastYear <= 1;
      presTerms.push({
        start: currentTermStart,
        end: isOngoing ? null : lastYear + 1,
        name: presidentName
      });
    }

    terms.set(presidentId, presTerms);
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
 * Get month name from number
 */
function getMonthName(month: number): string {
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  return months[month - 1] || '';
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
      const termOrders = orders.filter(o => {
        if (o.president.identifier !== presidentId) return false;
        const year = new Date(o.signing_date).getFullYear();
        const endYear = term.end || new Date().getFullYear() + 1;
        return year >= term.start && year < endYear;
      });

      if (termOrders.length === 0) continue;

      const topThemes = countThemes(termOrders, themeRegistry).slice(0, 5);
      const presidentName = term.name;
      const termEnd = term.end || 'present';

      const themeNames = topThemes.slice(0, 5).map(t => t.name.toLowerCase()).join(', ');
      const shortSummary = `${presidentName} signed ${termOrders.length} executive order${termOrders.length !== 1 ? 's' : ''} from ${term.start} until ${termEnd}. The top themes have been: ${themeNames}.`;

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
 * Generate timeline data grouped by month
 */
function generateTimeline(
  orders: EnrichedExecutiveOrder[],
  themeRegistry: ThemeRegistry
): TimelinePeriod[] {
  const byMonth = new Map<string, EnrichedExecutiveOrder[]>();

  // Group by year-month
  for (const order of orders) {
    const date = new Date(order.signing_date);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

    if (!byMonth.has(key)) {
      byMonth.set(key, []);
    }
    byMonth.get(key)!.push(order);
  }

  const periods: TimelinePeriod[] = [];

  for (const [key, monthOrders] of byMonth) {
    const [year, month] = key.split('-').map(Number);

    // Get themes for this month
    const topThemes = countThemes(monthOrders, themeRegistry).slice(0, 5);

    // Get president(s) for this month - usually just one
    const presidents = [...new Set(monthOrders.map(o => o.president.name))];
    const presidentName = presidents.join(' and ');
    const presidentId = monthOrders[0].president.identifier;

    // Generate theme summary text
    const themeText = formatThemeList(topThemes, 3);
    const themeSummary = `${presidentName} signed ${monthOrders.length} executive order${monthOrders.length !== 1 ? 's' : ''}. They cover ${themeText}.`;

    periods.push({
      year,
      month,
      month_name: getMonthName(month),
      president_id: presidentId,
      president_name: presidentName,
      order_count: monthOrders.length,
      top_themes: topThemes.slice(0, 5).map(t => ({ id: t.id, name: t.name })),
      theme_summary: themeSummary,
      order_ids: monthOrders.map(o => o.executive_order_number)
    });
  }

  // Sort by date descending (most recent first)
  return periods.sort((a, b) => {
    if (a.year !== b.year) return b.year - a.year;
    return b.month - a.month;
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
export { loadAllEnriched, detectPresidentTerms, getTermKey, countThemes, formatThemeList };
