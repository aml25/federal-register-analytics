#!/usr/bin/env node
/**
 * CLI for fetching executive orders
 *
 * Usage:
 *   npm run fetch -- --year 2025           # Fetch all EOs from 2025
 *   npm run fetch -- --from 2020 --to 2025 # Fetch EOs from 2020-2025
 *   npm run fetch -- --eo 14123            # Fetch a single EO by number
 */

import { fetchOrders } from '../fetch.js';
import { parseArgs } from '../utils.js';

const args = parseArgs(process.argv.slice(2));

const year = args.year ? parseInt(String(args.year), 10) : undefined;
const fromYear = args.from ? parseInt(String(args.from), 10) : undefined;
const toYear = args.to ? parseInt(String(args.to), 10) : undefined;
const eoNumber = args.eo ? parseInt(String(args.eo), 10) : undefined;

fetchOrders({ year, fromYear, toYear, eoNumber }).catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
