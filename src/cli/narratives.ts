#!/usr/bin/env node
/**
 * CLI for generating term, quarterly, and theme narratives
 *
 * Usage:
 *   npm run generate-narratives                              # Generate all (term + quarterly + theme)
 *   npm run generate-narratives -- --type term               # Generate term narratives only
 *   npm run generate-narratives -- --type quarterly          # Generate quarterly narratives only
 *   npm run generate-narratives -- --type theme              # Generate theme narratives only
 *   npm run generate-narratives -- --type quarterly --year 2025             # Quarterly for 2025
 *   npm run generate-narratives -- --type quarterly --year 2025 --quarter 1 # Q1 2025 only
 *   npm run generate-narratives -- --type theme --theme security            # Filter themes by name
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
const quarter = args.quarter ? Number(args.quarter) : undefined;
const theme = args.theme ? String(args.theme) : undefined;
const force = Boolean(args.force);

// Validate type if provided
if (type && !['term', 'quarterly', 'theme', 'all'].includes(type)) {
  console.error(`Invalid --type: ${type}. Must be 'term', 'quarterly', 'theme', or 'all'.`);
  process.exit(1);
}

// Validate quarter range
if (quarter !== undefined && (quarter < 1 || quarter > 4)) {
  console.error(`Invalid --quarter: ${quarter}. Must be between 1 and 4.`);
  process.exit(1);
}

// Warn if quarter specified without year
if (quarter !== undefined && year === undefined) {
  console.error('--quarter requires --year to be specified.');
  process.exit(1);
}

generateNarratives({ type, president, year, quarter, theme, force }).catch(console.error);
