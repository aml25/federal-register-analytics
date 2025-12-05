#!/usr/bin/env node
/**
 * CLI for enriching executive orders
 *
 * Usage:
 *   npm run enrich -- --year=2025
 *   npm run enrich -- --year=2025 --limit=5
 *   npm run enrich -- --force
 */

import { enrich } from '../enrich.js';
import { parseArgs } from '../utils.js';

const args = parseArgs(process.argv.slice(2));

const options = {
  year: args.year ? parseInt(String(args.year), 10) : undefined,
  limit: args.limit ? parseInt(String(args.limit), 10) : undefined,
  force: Boolean(args.force)
};

enrich(options).catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
