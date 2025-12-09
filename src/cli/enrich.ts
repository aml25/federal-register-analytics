#!/usr/bin/env node
import 'dotenv/config';

/**
 * CLI for enriching executive orders
 *
 * Usage:
 *   npm run enrich -- --year 2025
 *   npm run enrich -- --year 2025 --limit 5
 *   npm run enrich -- --force
 *   npm run enrich -- --eo 14350           # Enrich specific EO
 *   npm run enrich -- --year 2025 --pass2-only  # Re-run population analysis only
 */

import { enrich } from '../enrich.js';
import { parseArgs } from '../utils.js';

const args = parseArgs(process.argv.slice(2));

const options = {
  year: args.year ? parseInt(String(args.year), 10) : undefined,
  limit: args.limit ? parseInt(String(args.limit), 10) : undefined,
  force: Boolean(args.force),
  eoNumber: args.eo ? parseInt(String(args.eo), 10) : undefined,
  pass2Only: Boolean(args['pass2-only'])
};

enrich(options).catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
