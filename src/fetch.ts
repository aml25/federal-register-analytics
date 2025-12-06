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

  let totalPages = 0;
  let totalCount = 0;

  while (hasMore) {
    const url = new URL(`${FEDERAL_REGISTER_BASE_URL}/documents.json`);
    url.searchParams.set('conditions[type]', 'PRESDOCU');
    url.searchParams.set('conditions[presidential_document_type]', 'executive_order');
    url.searchParams.set('conditions[publication_date][year]', String(year));
    url.searchParams.set('conditions[correction]', '0');
    url.searchParams.set('per_page', '100');
    url.searchParams.set('page', String(page));
    // Use append for fields[] since we need multiple values with the same key
    url.searchParams.append('fields[]', 'document_number');
    url.searchParams.append('fields[]', 'executive_order_number');
    url.searchParams.append('fields[]', 'title');
    url.searchParams.append('fields[]', 'abstract');
    url.searchParams.append('fields[]', 'signing_date');
    url.searchParams.append('fields[]', 'publication_date');
    url.searchParams.append('fields[]', 'president');
    url.searchParams.append('fields[]', 'html_url');
    url.searchParams.append('fields[]', 'pdf_url');
    url.searchParams.append('fields[]', 'raw_text_url');

    const response = await fetch(url.toString());

    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as FederalRegisterResponse;

    // On first page, print total count and pages
    if (page === 1) {
      totalPages = data.total_pages;
      totalCount = data.count;
      console.log(`  Found ${totalCount} executive orders across ${totalPages} page${totalPages === 1 ? '' : 's'}`);
    }

    console.log(`  Fetching page ${page}/${totalPages}...`);

    for (const doc of data.results) {
      // Skip documents without an EO number (may be other presidential documents)
      if (!doc.executive_order_number) {
        console.log(`    Skipping document ${doc.document_number} (no EO number)`);
        continue;
      }

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
        raw_text_url: doc.raw_text_url,
      };

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
 * Fetch a single executive order by EO number
 */
export async function fetchExecutiveOrderByNumber(eoNumber: number): Promise<RawExecutiveOrder | null> {
  console.log(`Fetching EO ${eoNumber}...`);

  const url = new URL(`${FEDERAL_REGISTER_BASE_URL}/documents.json`);
  url.searchParams.set('conditions[type]', 'PRESDOCU');
  url.searchParams.set('conditions[presidential_document_type]', 'executive_order');
  // Use term search since the API doesn't support direct EO number filtering
  url.searchParams.set('conditions[term]', String(eoNumber));
  url.searchParams.append('fields[]', 'document_number');
  url.searchParams.append('fields[]', 'executive_order_number');
  url.searchParams.append('fields[]', 'title');
  url.searchParams.append('fields[]', 'abstract');
  url.searchParams.append('fields[]', 'signing_date');
  url.searchParams.append('fields[]', 'publication_date');
  url.searchParams.append('fields[]', 'president');
  url.searchParams.append('fields[]', 'html_url');
  url.searchParams.append('fields[]', 'pdf_url');
  url.searchParams.append('fields[]', 'raw_text_url');

  const response = await fetch(url.toString());

  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as FederalRegisterResponse;

  // Filter to exact EO number match (term search may return multiple results)
  // Use == for comparison since API may return string or number
  const doc = data.results.find(d => d.executive_order_number == eoNumber);

  if (!doc) {
    console.log(`  EO ${eoNumber} not found`);
    return null;
  }
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
    raw_text_url: doc.raw_text_url,
  };

  console.log(`  Found: ${order.title}`);
  return order;
}

/**
 * Main fetch function
 */
export async function fetchOrders(options: {
  year?: number;
  fromYear?: number;
  toYear?: number;
  eoNumber?: number;
} = {}): Promise<void> {
  console.log(`\n=== Fetching Executive Orders ===\n`);

  if (options.eoNumber) {
    const order = await fetchExecutiveOrderByNumber(options.eoNumber);
    if (order) {
      await saveRawOrders([order]);
    }
  } else if (options.fromYear && options.toYear) {
    // Fetch a range of years
    if (options.fromYear > options.toYear) {
      throw new Error(`--from year must be <= --to year`);
    }
    const allOrders: RawExecutiveOrder[] = [];
    for (let y = options.fromYear; y <= options.toYear; y++) {
      const orders = await fetchExecutiveOrdersByYear(y);
      allOrders.push(...orders);
    }
    await saveRawOrders(allOrders);
  } else {
    const year = options.year ?? new Date().getFullYear();
    const orders = await fetchExecutiveOrdersByYear(year);
    await saveRawOrders(orders);
  }

  console.log(`\nDone!`);
}
