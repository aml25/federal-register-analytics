/**
 * Configuration for the pipeline
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Data directory is at the root of the project
export const DATA_DIR = join(__dirname, '..', '..', 'data');
export const RAW_DIR = join(DATA_DIR, 'raw');
export const ENRICHED_DIR = join(DATA_DIR, 'enriched');
export const AGGREGATED_DIR = join(DATA_DIR, 'aggregated');

export const THEMES_FILE = join(DATA_DIR, 'themes.json');
export const RAW_ORDERS_FILE = join(RAW_DIR, 'executive-orders.json');

// Federal Register API
export const FEDERAL_REGISTER_BASE_URL = 'https://www.federalregister.gov/api/v1';

// Claude API
export const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

// Rate limiting
export const ENRICH_DELAY_MS = 1000; // Delay between API calls
