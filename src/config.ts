/**
 * Configuration for the pipeline
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Data directory is at the root of the project
// __dirname is dist/ at runtime, so go up one level
export const DATA_DIR = join(__dirname, '..', 'data');
export const RAW_DIR = join(DATA_DIR, 'raw');
export const ENRICHED_DIR = join(DATA_DIR, 'enriched');
export const AGGREGATED_DIR = join(DATA_DIR, 'aggregated');

export const THEMES_FILE = join(DATA_DIR, 'themes.json');
export const POPULATIONS_FILE = join(DATA_DIR, 'populations.json');
export const RAW_ORDERS_FILE = join(RAW_DIR, 'executive-orders.json');

// Federal Register API
export const FEDERAL_REGISTER_BASE_URL = 'https://www.federalregister.gov/api/v1';

// OpenAI API
export const OPENAI_MODEL = 'gpt-4.1-mini';
export const OPENAI_MODEL_POPULATIONS = 'gpt-4o'; // Advanced model for nuanced population analysis

// Rate limiting
export const ENRICH_DELAY_MS = 1000; // Delay between API calls
