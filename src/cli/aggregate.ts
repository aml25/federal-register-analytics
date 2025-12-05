#!/usr/bin/env node
/**
 * CLI for aggregating enriched executive orders
 *
 * Usage:
 *   npm run aggregate
 */

import { aggregate } from '../aggregate.js';

aggregate().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
