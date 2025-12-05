/**
 * Fetch executive orders from Federal Register API
 */

import { FEDERAL_REGISTER_BASE_URL, RAW_ORDERS_FILE } from './config.js';
import { readJson, writeJson, sleep } from './utils.js';
import type { RawExecutiveOrder } from './types.js';

interface FederalRegisterResponse {
  count: number;
  total_pages: number;
  results: FederalRegisterDocument[];
}

interface FederalRegisterDocument {
  document_number: string;
  executive_order_number: number;
  title: string;
  abstract?: string;
  signing_date: string;
  publication_date: string;
  president: {
    name: string;
    identifier: string;
  };
  html_url: string;
  pdf_url?: string;
  raw_text_url?: string;
}

/**
 * Fetch executive orders for a given year
 */
export async function fetchExecutiveOrdersByYear(year: number): Promise<RawExecutiveOrder[]> {
  console.log(`Fetching executive orders for ${year}...`);

  const allOrders: RawExecutiveOrder[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const url = new URL(`${FEDERAL_REGISTER_BASE_URL}/documents.json`);
    url.searchParams.set('conditions[type]', 'PRESDOCU');
    url.searchParams.set('conditions[presidential_document_type]', 'executive_order');
    url.searchParams.set('conditions[publication_date][year]', String(year));
    url.searchParams.set('conditions[correction]', '0');
    url.searchParams.set('per_page', '100');
    url.searchParams.set('page', String(page));
    url.searchParams.set('fields[]', 'document_number');
    url.searchParams.set('fields[]', 'executive_order_number');
    url.searchParams.set('fields[]', 'title');
    url.searchParams.set('fields[]', 'abstract');
    url.searchParams.set('fields[]', 'signing_date');
    url.searchParams.set('fields[]', 'publication_date');
    url.searchParams.set('fields[]', 'president');
    url.searchParams.set('fields[]', 'html_url');
    url.searchParams.set('fields[]', 'pdf_url');
    url.searchParams.set('fields[]', 'raw_text_url');

    console.log(`  Page ${page}...`);
    const response = await fetch(url.toString());

    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as FederalRegisterResponse;

    for (const doc of data.results) {
      const order: RawExecutiveOrder = {
        document_number: doc.document_number,
        executive_order_number: doc.executive_order_number,
        title: doc.title,
        abstract: doc.abstract,
        signing_date: doc.signing_date,
        publication_date: doc.publication_date,
        president: doc.president,
        html_url: doc.html_url,
        pdf_url: doc.pdf_url,
      };

      // Fetch full text if available
      if (doc.raw_text_url) {
        try {
          console.log(`    Fetching full text for EO ${doc.executive_order_number}...`);
          const textResponse = await fetch(doc.raw_text_url);
          if (textResponse.ok) {
            order.full_text = await textResponse.text();
          }
          await sleep(200); // Rate limit
        } catch (err) {
          console.warn(`    Warning: Could not fetch full text for EO ${doc.executive_order_number}`);
        }
      }

      allOrders.push(order);
    }

    hasMore = page < data.total_pages;
    page++;

    if (hasMore) {
      await sleep(500); // Rate limit between pages
    }
  }

  console.log(`  Found ${allOrders.length} executive orders for ${year}`);
  return allOrders;
}

/**
 * Load existing raw orders
 */
export async function loadRawOrders(): Promise<RawExecutiveOrder[]> {
  const data = await readJson<{ orders: RawExecutiveOrder[] }>(RAW_ORDERS_FILE);
  return data?.orders ?? [];
}

/**
 * Save raw orders, merging with existing
 */
export async function saveRawOrders(newOrders: RawExecutiveOrder[]): Promise<void> {
  const existing = await loadRawOrders();

  // Create a map for deduplication by EO number
  const orderMap = new Map<number, RawExecutiveOrder>();

  for (const order of existing) {
    orderMap.set(order.executive_order_number, order);
  }

  for (const order of newOrders) {
    orderMap.set(order.executive_order_number, order);
  }

  // Sort by EO number descending (newest first)
  const allOrders = Array.from(orderMap.values()).sort(
    (a, b) => b.executive_order_number - a.executive_order_number
  );

  await writeJson(RAW_ORDERS_FILE, {
    orders: allOrders,
    updated_at: new Date().toISOString(),
    count: allOrders.length
  });

  console.log(`Saved ${allOrders.length} total executive orders`);
}

/**
 * Main fetch function
 */
export async function fetchOrders(options: { year?: number } = {}): Promise<void> {
  const year = options.year ?? new Date().getFullYear();

  console.log(`\n=== Fetching Executive Orders ===\n`);

  const orders = await fetchExecutiveOrdersByYear(year);
  await saveRawOrders(orders);

  console.log(`\nDone!`);
}
