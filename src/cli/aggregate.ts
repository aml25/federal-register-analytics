#!/usr/bin/env node
/**
 * CLI for aggregating enriched executive orders
 *
 * Usage:
 *   npm run aggregate                          # Aggregate all
 *   npm run aggregate -- --president trump     # Aggregate only Trump
 */

import { aggregate } from '../aggregate.js';
import { parseArgs } from '../utils.js';

const args = parseArgs(process.argv.slice(2));
const president = args.president ? String(args.president) : undefined;

aggregate({ president }).catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
