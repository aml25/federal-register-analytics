/**
 * Type definitions for the Federal Register analytics pipeline
 */

// =============================================================================
// RAW DATA TYPES (from Federal Register API)
// =============================================================================

export interface RawExecutiveOrder {
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
  full_text?: string;
}

// =============================================================================
// THEME TYPES
// =============================================================================

export interface Theme {
  id: string;
  name: string;
  description: string;
  created_at: string;
}

export interface ThemeRegistry {
  themes: Theme[];
  updated_at: string;
}

// =============================================================================
// ENRICHED DATA TYPES
// =============================================================================

export interface ImpactedPopulations {
  positive: string[];
  negative: string[];
}

export interface Enrichment {
  summary: string;
  theme_ids: string[];
  impacted_populations: ImpactedPopulations;
  enriched_at: string;
  model_used: string;
}

export interface EnrichedExecutiveOrder extends RawExecutiveOrder {
  enrichment: Enrichment;
}

// =============================================================================
// AGGREGATED DATA TYPES
// =============================================================================

export interface PresidentSummary {
  identifier: string;
  name: string;
  terms: PresidentTermSummary[];
}

export interface PresidentTermSummary {
  start_year: number;
  end_year: number;
  total_orders: number;
  top_themes: ThemeCount[];
  most_impacted_positive: string[];
  most_impacted_negative: string[];
}

export interface ThemeCount {
  theme_id: string;
  theme_name: string;
  count: number;
}

export interface TimelinePeriod {
  year: number;
  month: number;
  orders: TimelineOrder[];
  theme_summary: string[];
}

export interface TimelineOrder {
  executive_order_number: number;
  title: string;
  signing_date: string;
  president: string;
  theme_ids: string[];
}

// =============================================================================
// LLM RESPONSE TYPES
// =============================================================================

export interface LLMEnrichmentResponse {
  summary: string;
  existing_theme_ids: string[];
  proposed_themes: ProposedTheme[];
  impacted_populations: ImpactedPopulations;
}

export interface ProposedTheme {
  name: string;
  description: string;
  justification: string;
}
