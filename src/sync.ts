/**
 * Sync module - check for new executive orders and update the pipeline
 */

import { readdirSync } from 'node:fs';
import { ENRICHED_DIR } from './config.js';
import { fetchExecutiveOrdersByYear, saveRawOrders } from './fetch.js';
import { enrich } from './enrich.js';
import { aggregate } from './aggregate.js';
import { generateNarratives } from './narratives.js';
import type { RawExecutiveOrder } from './types.js';

/**
 * Get set of EO numbers that already have enriched files
 */
function getExistingEONumbers(): Set<number> {
  const existing = new Set<number>();

  try {
    const files = readdirSync(ENRICHED_DIR);
    for (const file of files) {
      // Files are named like eo-14350.json
      const match = file.match(/^eo-(\d+)\.json$/);
      if (match) {
        existing.add(parseInt(match[1], 10));
      }
    }
  } catch (err) {
    // Directory might not exist yet
    console.log('No existing enriched files found');
  }

  return existing;
}

/**
 * Check for new EOs and return them
 */
async function checkForNewOrders(year: number): Promise<RawExecutiveOrder[]> {
  console.log(`Checking for new executive orders in ${year}...`);

  // Fetch current EOs from API
  const apiOrders = await fetchExecutiveOrdersByYear(year);

  // Get existing enriched EO numbers
  const existingEONumbers = getExistingEONumbers();

  // Find new orders (convert to number since API returns string)
  const newOrders = apiOrders.filter(
    order => !existingEONumbers.has(Number(order.executive_order_number))
  );

  return newOrders;
}

export interface SyncOptions {
  year?: number;
  checkOnly?: boolean;
  skipNarratives?: boolean;
}

/**
 * Main sync function
 */
export async function sync(options: SyncOptions = {}): Promise<void> {
  const year = options.year ?? new Date().getFullYear();
  const checkOnly = options.checkOnly ?? false;
  const skipNarratives = options.skipNarratives ?? false;

  console.log(`\n========================================`);
  console.log(`Checking for updates (${year})`);
  console.log(`========================================\n`);

  // Check for new orders
  const newOrders = await checkForNewOrders(year);

  if (newOrders.length === 0) {
    console.log(`\nNo new executive orders found for ${year}.`);
    console.log(`All ${getExistingEONumbers().size} orders are up to date.\n`);
    return;
  }

  console.log(`\nFound ${newOrders.length} new executive order(s):`);
  for (const order of newOrders) {
    console.log(`  - EO ${order.executive_order_number}: ${order.title}`);
  }

  if (checkOnly) {
    console.log(`\nRun without --check to process these orders.\n`);
    return;
  }

  console.log(`\n----------------------------------------`);
  console.log(`Processing new orders...`);
  console.log(`----------------------------------------\n`);

  // Step 1: Save new orders to raw file
  console.log(`[1/4] Saving raw orders...`);
  await saveRawOrders(newOrders);
  console.log('');

  // Step 2: Enrich new orders
  console.log(`[2/4] Enriching new orders...`);
  // Enrich only the specific EO numbers
  for (const order of newOrders) {
    await enrich({ eoNumber: order.executive_order_number });
  }
  console.log('');

  // Step 3: Aggregate
  console.log(`[3/4] Aggregating data...`);
  await aggregate({});
  console.log('');

  // Step 4: Generate narratives (staleness detection handles what needs updating)
  if (!skipNarratives) {
    console.log(`[4/4] Updating narratives...`);
    await generateNarratives({}); // Will auto-detect stale narratives
    console.log('');
  } else {
    console.log(`[4/4] Skipping narratives (--skip-narratives)`);
    console.log('');
  }

  console.log(`========================================`);
  console.log(`Sync complete! Processed ${newOrders.length} new order(s).`);
  console.log(`========================================\n`);
}
