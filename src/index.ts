/**
 * Federal Register Analytics
 *
 * Data enrichment pipeline for Federal Register executive orders.
 * Uses LLM to generate summaries, themes, and impact analysis.
 */

export { fetchOrders, fetchExecutiveOrdersByYear, loadRawOrders } from './fetch.js';
export { enrich } from './enrich.js';
export { aggregate } from './aggregate.js';
export * from './types.js';
