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
  raw_text_url?: string;
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
// POPULATION TYPES
// =============================================================================

export interface Population {
  id: string;
  name: string;
  description: string;
  created_at: string;
}

export interface PopulationRegistry {
  populations: Population[];
  updated_at: string;
}

// =============================================================================
// ENRICHED DATA TYPES
// =============================================================================

export interface ImpactedPopulations {
  positive_ids: string[];
  negative_ids: string[];
}

export interface Enrichment {
  summary: string;
  theme_ids: string[];
  impacted_populations: ImpactedPopulations;
  potential_concerns: string[];
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
  existing_population_ids: {
    positive: string[];
    negative: string[];
  };
  proposed_populations: {
    positive: ProposedPopulation[];
    negative: ProposedPopulation[];
  };
  potential_concerns: string[];
}

// First pass response (summary, themes - no populations)
export interface LLMFirstPassResponse {
  summary: string;
  existing_theme_ids: string[];
  proposed_themes: ProposedTheme[];
  potential_concerns: string[];
}

// Second pass response (populations only - from advanced model)
export interface LLMPopulationsResponse {
  existing_population_ids: {
    positive: string[];
    negative: string[];
  };
  proposed_populations: {
    positive: ProposedPopulation[];
    negative: ProposedPopulation[];
  };
}

// =============================================================================
// TAXONOMY-BASED LLM RESPONSE TYPES (Two-pass with static taxonomy)
// =============================================================================

// Pass 1: Summary + Themes (using static taxonomy)
export interface LLMTaxonomyPass1Response {
  summary: string;
  theme_ids: string[];
  suggested_themes: SuggestedTaxonomyItem[];
}

// Pass 2: Populations + Concerns (using static taxonomy + themes from Pass 1)
export interface LLMTaxonomyPass2Response {
  population_ids: {
    positive: string[];
    negative: string[];
  };
  suggested_populations: {
    positive: SuggestedTaxonomyItem[];
    negative: SuggestedTaxonomyItem[];
  };
  potential_concerns: string[];
}

// Suggestion for a new taxonomy item (not auto-added, saved to markdown)
export interface SuggestedTaxonomyItem {
  name: string;
  category: string;
  justification: string;
}

export interface ProposedTheme {
  name: string;
  description: string;
  justification: string;
}

export interface ProposedPopulation {
  name: string;
  description: string;
}
