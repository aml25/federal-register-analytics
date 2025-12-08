#!/usr/bin/env node
/**
 * CLI for running the full pipeline for a given year
 *
 * Usage:
 *   npm run pipeline -- --year 2025                    # Run full pipeline for 2025
 *   npm run pipeline -- --year 2025 --skip-fetch       # Skip fetching (use existing data)
 *   npm run pipeline -- --year 2025 --skip-narratives  # Skip narrative generation
 *   npm run pipeline -- --year 2025 --force            # Force re-enrichment and re-generation
 */

import 'dotenv/config';
import { fetchOrders } from '../fetch.js';
import { enrich } from '../enrich.js';
import { aggregate } from '../aggregate.js';
import { generateNarratives } from '../narratives.js';
import { parseArgs } from '../utils.js';

const args = parseArgs(process.argv.slice(2));

const year = args.year ? parseInt(String(args.year), 10) : undefined;
const skipFetch = Boolean(args['skip-fetch']);
const skipNarratives = Boolean(args['skip-narratives']);
const force = Boolean(args.force);

if (!year) {
  console.error('Usage: npm run pipeline -- --year <year>');
  console.error('');
  console.error('Options:');
  console.error('  --year <year>       Year to process (required)');
  console.error('  --skip-fetch        Skip fetching from Federal Register API');
  console.error('  --skip-narratives   Skip narrative generation');
  console.error('  --force             Force re-enrichment and narrative regeneration');
  process.exit(1);
}

async function runPipeline() {
  console.log(`\n========================================`);
  console.log(`Running pipeline for ${year}`);
  console.log(`========================================\n`);

  // Step 1: Fetch
  if (!skipFetch) {
    console.log(`[1/4] Fetching executive orders for ${year}...`);
    console.log('----------------------------------------');
    await fetchOrders({ year });
    console.log('');
  } else {
    console.log(`[1/4] Skipping fetch (--skip-fetch)`);
    console.log('');
  }

  // Step 2: Enrich
  console.log(`[2/4] Enriching executive orders for ${year}...`);
  console.log('----------------------------------------');
  await enrich({ year, force });
  console.log('');

  // Step 3: Aggregate
  console.log(`[3/4] Aggregating data...`);
  console.log('----------------------------------------');
  await aggregate({});
  console.log('');

  // Step 4: Generate narratives
  if (!skipNarratives) {
    console.log(`[4/4] Generating narratives...`);
    console.log('----------------------------------------');
    // Generate monthly narratives for the year
    await generateNarratives({ type: 'monthly', year, force });
    // Generate term narratives only for presidents with orders in this year
    await generateNarratives({ type: 'term', year, force });
    // Generate theme narratives (incremental - only new themes unless --force)
    await generateNarratives({ type: 'theme', force });
    console.log('');
  } else {
    console.log(`[4/4] Skipping narratives (--skip-narratives)`);
    console.log('');
  }

  console.log(`========================================`);
  console.log(`Pipeline complete for ${year}`);
  console.log(`========================================\n`);
}

runPipeline().catch((err) => {
  console.error('Pipeline error:', err.message);
  process.exit(1);
});
