/**
 * Aggregate enriched executive orders into summaries
 */

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ENRICHED_DIR, AGGREGATED_DIR } from './config.js';
import { loadThemes, readJson, writeJson } from './utils.js';
import type {
  EnrichedExecutiveOrder,
  PresidentSummary,
  PresidentTermSummary,
  ThemeCount,
  TimelinePeriod,
  TimelineOrder
} from './types.js';

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

  // Sort by signing date descending
  return orders.sort((a, b) =>
    new Date(b.signing_date).getTime() - new Date(a.signing_date).getTime()
  );
}

/**
 * Count theme occurrences
 */
function countThemes(orders: EnrichedExecutiveOrder[]): Map<string, number> {
  const counts = new Map<string, number>();

  for (const order of orders) {
    for (const themeId of order.enrichment.theme_ids) {
      counts.set(themeId, (counts.get(themeId) || 0) + 1);
    }
  }

  return counts;
}

/**
 * Get top N themes by count
 */
function getTopThemes(
  counts: Map<string, number>,
  themeNames: Map<string, string>,
  n: number
): ThemeCount[] {
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([id, count]) => ({
      theme_id: id,
      theme_name: themeNames.get(id) || id,
      count
    }));
}

/**
 * Count population impacts
 */
function countImpacts(orders: EnrichedExecutiveOrder[]): {
  positive: Map<string, number>;
  negative: Map<string, number>;
} {
  const positive = new Map<string, number>();
  const negative = new Map<string, number>();

  for (const order of orders) {
    for (const pop of order.enrichment.impacted_populations.positive) {
      positive.set(pop, (positive.get(pop) || 0) + 1);
    }
    for (const pop of order.enrichment.impacted_populations.negative) {
      negative.set(pop, (negative.get(pop) || 0) + 1);
    }
  }

  return { positive, negative };
}

/**
 * Get top N impacted populations
 */
function getTopImpacted(counts: Map<string, number>, n: number): string[] {
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([pop]) => pop);
}

/**
 * Determine presidential terms
 */
function getPresidentTerms(): Map<string, { start: number; end: number }[]> {
  // Hardcoded known terms - could be expanded
  return new Map([
    ['donald-trump', [
      { start: 2017, end: 2021 },
      { start: 2025, end: 2029 }
    ]],
    ['joe-biden', [
      { start: 2021, end: 2025 }
    ]],
    ['barack-obama', [
      { start: 2009, end: 2017 }
    ]],
    ['george-w-bush', [
      { start: 2001, end: 2009 }
    ]]
  ]);
}

/**
 * Generate president summaries
 */
async function generatePresidentSummaries(
  orders: EnrichedExecutiveOrder[],
  themeNames: Map<string, string>
): Promise<PresidentSummary[]> {
  const terms = getPresidentTerms();
  const byPresident = new Map<string, EnrichedExecutiveOrder[]>();

  // Group orders by president
  for (const order of orders) {
    const id = order.president.identifier;
    if (!byPresident.has(id)) {
      byPresident.set(id, []);
    }
    byPresident.get(id)!.push(order);
  }

  const summaries: PresidentSummary[] = [];

  for (const [identifier, presOrders] of byPresident) {
    const presidentTerms = terms.get(identifier) || [];
    const termSummaries: PresidentTermSummary[] = [];

    for (const term of presidentTerms) {
      const termOrders = presOrders.filter(o => {
        const year = new Date(o.signing_date).getFullYear();
        return year >= term.start && year < term.end;
      });

      if (termOrders.length === 0) continue;

      const themeCounts = countThemes(termOrders);
      const impacts = countImpacts(termOrders);

      termSummaries.push({
        start_year: term.start,
        end_year: term.end,
        total_orders: termOrders.length,
        top_themes: getTopThemes(themeCounts, themeNames, 5),
        most_impacted_positive: getTopImpacted(impacts.positive, 5),
        most_impacted_negative: getTopImpacted(impacts.negative, 5)
      });
    }

    if (termSummaries.length > 0) {
      summaries.push({
        identifier,
        name: presOrders[0].president.name,
        terms: termSummaries
      });
    }
  }

  return summaries;
}

/**
 * Generate timeline data grouped by month
 */
function generateTimeline(orders: EnrichedExecutiveOrder[]): TimelinePeriod[] {
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

  // Convert to timeline periods
  const periods: TimelinePeriod[] = [];

  for (const [key, monthOrders] of byMonth) {
    const [year, month] = key.split('-').map(Number);

    // Get unique themes for this period
    const themeSet = new Set<string>();
    for (const order of monthOrders) {
      for (const themeId of order.enrichment.theme_ids) {
        themeSet.add(themeId);
      }
    }

    periods.push({
      year,
      month,
      orders: monthOrders.map(o => ({
        executive_order_number: o.executive_order_number,
        title: o.title,
        signing_date: o.signing_date,
        president: o.president.identifier,
        theme_ids: o.enrichment.theme_ids
      })),
      theme_summary: Array.from(themeSet)
    });
  }

  // Sort by date descending
  return periods.sort((a, b) => {
    if (a.year !== b.year) return b.year - a.year;
    return b.month - a.month;
  });
}

/**
 * Main aggregate function
 */
export async function aggregate(): Promise<void> {
  console.log(`\n=== Aggregating Executive Orders ===\n`);

  // Load all enriched orders
  const orders = await loadAllEnriched();
  console.log(`Loaded ${orders.length} enriched orders`);

  if (orders.length === 0) {
    console.log('No enriched orders found. Run enrich first.');
    return;
  }

  // Load themes for name lookup
  const themes = await loadThemes();
  const themeNames = new Map(themes.themes.map(t => [t.id, t.name]));

  // Generate president summaries
  console.log('\nGenerating president summaries...');
  const presidentSummaries = await generatePresidentSummaries(orders, themeNames);
  await writeJson(join(AGGREGATED_DIR, 'presidents.json'), {
    summaries: presidentSummaries,
    generated_at: new Date().toISOString()
  });
  console.log(`  Generated summaries for ${presidentSummaries.length} presidents`);

  // Generate timeline
  console.log('\nGenerating timeline...');
  const timeline = generateTimeline(orders);
  await writeJson(join(AGGREGATED_DIR, 'timeline.json'), {
    periods: timeline,
    generated_at: new Date().toISOString()
  });
  console.log(`  Generated ${timeline.length} timeline periods`);

  console.log('\nDone!');
}
