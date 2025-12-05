#!/usr/bin/env node
/**
 * CLI for fetching executive orders
 *
 * Usage:
 *   npm run fetch -- --year=2025
 */

import { fetchOrders } from '../fetch.js';
import { parseArgs } from '../utils.js';

const args = parseArgs(process.argv.slice(2));

const year = args.year ? parseInt(String(args.year), 10) : undefined;

fetchOrders({ year }).catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
