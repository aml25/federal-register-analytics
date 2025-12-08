#!/usr/bin/env node
/**
 * CLI for generating term and monthly narratives
 *
 * Usage:
 *   npm run generate-narratives                              # Generate all (term + monthly)
 *   npm run generate-narratives -- --type term               # Generate term narratives only
 *   npm run generate-narratives -- --type monthly            # Generate monthly narratives only
 *   npm run generate-narratives -- --type monthly --year 2025            # Monthly for 2025
 *   npm run generate-narratives -- --type monthly --year 2025 --month 3  # March 2025 only
 *   npm run generate-narratives -- --president trump         # Filter by president
 *   npm run generate-narratives -- --force                   # Regenerate even if exists
 */

import 'dotenv/config';
import { generateNarratives, type NarrativeType } from '../narratives.js';
import { parseArgs } from '../utils.js';

const args = parseArgs(process.argv.slice(2));

const type = args.type ? String(args.type) as NarrativeType : undefined;
const president = args.president ? String(args.president) : undefined;
const year = args.year ? Number(args.year) : undefined;
const month = args.month ? Number(args.month) : undefined;
const force = Boolean(args.force);

// Validate type if provided
if (type && !['term', 'monthly', 'all'].includes(type)) {
  console.error(`Invalid --type: ${type}. Must be 'term', 'monthly', or 'all'.`);
  process.exit(1);
}

// Validate month range
if (month !== undefined && (month < 1 || month > 12)) {
  console.error(`Invalid --month: ${month}. Must be between 1 and 12.`);
  process.exit(1);
}

// Warn if month specified without year
if (month !== undefined && year === undefined) {
  console.error('--month requires --year to be specified.');
  process.exit(1);
}

generateNarratives({ type, president, year, month, force }).catch(console.error);
