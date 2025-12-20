#!/usr/bin/env node
/**
 * CLI for syncing/updating executive orders
 *
 * Usage:
 *   npm run update                      # Check current year for new EOs and process them
 *   npm run update -- --year 2025       # Check specific year
 *   npm run update -- --check           # Check only, don't process
 *   npm run update -- --skip-narratives # Skip narrative generation
 */

import 'dotenv/config';
import { sync } from '../sync.js';
import { parseArgs } from '../utils.js';

const args = parseArgs(process.argv.slice(2));

const year = args.year ? Number(args.year) : undefined;
const checkOnly = Boolean(args.check);
const skipNarratives = Boolean(args['skip-narratives']);

sync({ year, checkOnly, skipNarratives }).catch((err) => {
  console.error('Sync error:', err.message);
  process.exit(1);
});
