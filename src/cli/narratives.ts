#!/usr/bin/env node
/**
 * CLI for generating term narratives
 *
 * Usage:
 *   npm run generate-narratives                          # Generate all
 *   npm run generate-narratives -- --president trump     # Generate only Trump
 */

import 'dotenv/config';
import { generateNarratives } from '../narratives.js';
import { parseArgs } from '../utils.js';

const args = parseArgs(process.argv.slice(2));
const president = args.president ? String(args.president) : undefined;

generateNarratives({ president }).catch(console.error);
