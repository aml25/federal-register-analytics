# Federal Register Analytics

Data enrichment pipeline for Federal Register executive orders. Uses OpenAI to generate summaries, themes, impact analysis, and potential concerns.

**Live site**: [What Got Signed?](https://whatgotsigned.com) (or run locally with the included Express server)

## TODO: Data Quality Improvements

For now, the todo list is about data quality. The data pipeline was done relatively quickly to get a first version out and needs a lot of work in order to generate trusted and useful data.

- [ ] Thorough spot-checking of generated data against trusted sources
- [ ] Compare summaries and impact analysis with expert policy analysis
- [ ] Improve prompts to reduce over-tagging (e.g., not every order impacts "federal employees")
- [ ] Evaluate alternative models for better accuracy/cost trade-offs
- [ ] Review and consolidate similar population categories
- [ ] Add validation step to flag potentially inaccurate enrichments for human review

## Features

- **Fetch**: Download executive orders from the Federal Register API
- **Enrich**: Use OpenAI to analyze each order with a two-pass approach:
  - **Pass 1** (gpt-4.1-mini): Plain-language summary, thematic categorization, and potential concerns
  - **Pass 2** (gpt-4o): Nuanced population impact analysis using an advanced reasoning model
  - Cohesive theme and population registries maintained across all orders
- **Aggregate**: Generate term summaries and timeline data (fast, no API calls)
- **Generate Narratives**: LLM-generated summaries and impact analysis per presidential term, month, and theme (uses OpenAI API)
- **Web Frontend**: Express server with a clean UI to browse executive orders by term, month, or theme

## Installation

```bash
npm install
npm run build
```

## Configuration

Copy the example environment file and add your OpenAI API key:

```bash
cp .env.example .env
```

Then edit `.env` with your API key from https://platform.openai.com/api-keys

## Usage

### Overview diagram

flowchart LR
    A[Fetch executive orders\nfrom Federal Register API] --> B[Enrich data:\nsummaries, themes,\nimpacted populations,\npotential concerns]
    B --> C[Aggregate data for\npresidential term and\nmonthly timelines]
    C --> D[Generate narratives\nfor detailed\nEO reviews]
    
    B --- E[Pass 1 - gpt 4.1 mini:\nSummaries, themes, concerns]
    E --- F[Pass 2 - gpt 4o:\nImpacted populations]

### 1. Fetch Executive Orders

Download executive orders for a specific year:

```bash
npm run fetch -- --year 2025
```

Fetch a range of years:

```bash
npm run fetch -- --from 2020 --to 2025
```

Or fetch a single executive order by number:

```bash
npm run fetch -- --eo 14350
```

Raw data is saved to `data/raw/executive-orders.json`.

### 2. Enrich with AI Analysis

Process orders through OpenAI for enrichment. The enrichment uses a **two-pass approach**:

1. **Pass 1** (gpt-4.1-mini): Generates the summary, identifies themes, and extracts potential concerns
2. **Pass 2** (gpt-4o): Uses an advanced reasoning model for nuanced population impact analysis, determining which groups are positively or negatively affected

This approach optimizes for both speed/cost (using the faster model for straightforward analysis) and quality (using the advanced reasoning model for the more nuanced population impact assessment).

```bash
# Enrich all orders from a specific year
npm run enrich -- --year 2025

# Limit number of orders to process
npm run enrich -- --year 2025 --limit 5

# Re-process already enriched orders
npm run enrich -- --force

# Re-enrich a specific executive order
npm run enrich -- --eo 14350

# Re-run population analysis only (pass 2) on already-enriched orders
npm run enrich -- --year 2025 --pass2-only

# Re-run pass 2 on a specific EO
npm run enrich -- --eo 14350 --pass2-only
```

The `--pass2-only` flag re-runs only the population analysis (using gpt-4o) on already-enriched orders. This is useful if you want to improve population tagging without regenerating summaries, themes, or concerns. The summary, themes, and concerns from the original enrichment are preserved.

After processing, orphaned populations (those no longer referenced by any enriched EO) are automatically removed from the registry.

Enriched data is saved to `data/enriched/`. The theme registry is maintained in `data/themes.json` and the population registry in `data/populations.json`.

### 3. Aggregate Data

Generate term summaries and timeline data (no API calls required):

```bash
# Aggregate all data
npm run aggregate

# Aggregate for a specific president
npm run aggregate -- --president trump
```

Aggregated data is saved to `data/aggregated/`:
- `term-summaries.json` - Summary data per presidential term with top themes
- `timeline.json` - Monthly timeline data with theme summaries

### 4. Generate Narratives (Optional)

Generate LLM-powered narrative summaries for presidential terms, monthly periods, and themes. This step uses the OpenAI API and may incur costs:

```bash
# Generate all narratives (term + monthly + theme)
npm run generate-narratives

# Generate term narratives only
npm run generate-narratives -- --type term

# Generate monthly narratives only
npm run generate-narratives -- --type monthly

# Generate theme narratives only
npm run generate-narratives -- --type theme

# Generate monthly narratives for a specific year
npm run generate-narratives -- --type monthly --year 2025

# Generate narrative for a specific month
npm run generate-narratives -- --type monthly --year 2025 --month 3

# Filter by president (term narratives only)
npm run generate-narratives -- --president trump

# Filter by theme (theme narratives only)
npm run generate-narratives -- --type theme --theme immigration

# Force regeneration (skip incremental checks)
npm run generate-narratives -- --force
```

Outputs:
- `data/aggregated/narratives.json` - Term narratives with summary and potential impact paragraphs
- `data/aggregated/monthly-narratives.json` - Monthly narratives with summary and potential impact paragraphs
- `data/aggregated/theme-narratives.json` - Theme narratives with summary and potential impact paragraphs

Narratives support incremental generation - only new items are processed unless `--force` is used.

### 5. Run Full Pipeline

Run the entire pipeline (fetch, enrich, aggregate, generate narratives) for a given year:

```bash
# Run full pipeline for 2025
npm run pipeline -- --year 2025

# Skip fetching (use existing raw data)
npm run pipeline -- --year 2025 --skip-fetch

# Skip narrative generation
npm run pipeline -- --year 2025 --skip-narratives

# Force re-enrichment and narrative regeneration
npm run pipeline -- --year 2025 --force
```

### 6. Run the Web Frontend

Start the Express server to browse executive orders:

```bash
cd what-got-signed
npm install
node server.js
```

Then open http://localhost:3000 in your browser.

## Data Structure

### Theme Registry (`data/themes.json`)

Themes are tracked globally to ensure consistency across all executive orders:

```json
{
  "themes": [
    {
      "id": "immigration-enforcement",
      "name": "Immigration Enforcement",
      "description": "Policies related to border security and immigration law enforcement",
      "created_at": "2025-01-15T10:30:00.000Z"
    }
  ],
  "updated_at": "2025-01-15T10:30:00.000Z"
}
```

### Population Registry (`data/populations.json`)

Impacted populations are tracked globally to ensure consistency. Populations can include countries, demographics, professions, industries, political groups, government entities, and more:

```json
{
  "populations": [
    {
      "id": "federal-employees",
      "name": "Federal Employees",
      "description": "Workers employed by the federal government",
      "created_at": "2025-01-15T10:30:00.000Z"
    }
  ],
  "updated_at": "2025-01-15T10:30:00.000Z"
}
```

### Enriched Order

Each enriched order includes:

```json
{
  "document_number": "2025-12345",
  "executive_order_number": 14350,
  "title": "Executive Order Title",
  "signing_date": "2025-01-20",
  "president": {
    "name": "Donald Trump",
    "identifier": "donald-trump"
  },
  "html_url": "https://www.federalregister.gov/...",
  "raw_text_url": "https://www.federalregister.gov/.../raw_text",
  "enrichment": {
    "summary": "Plain-language summary of the order...",
    "theme_ids": ["immigration-enforcement", "national-security"],
    "impacted_populations": {
      "positive_ids": ["border-patrol-agents"],
      "negative_ids": ["undocumented-immigrants"]
    },
    "potential_concerns": [
      "Implementation may strain agency resources.",
      "Could face legal challenges on constitutional grounds."
    ],
    "enriched_at": "2025-01-15T10:30:00.000Z",
    "model_used": "gpt-4.1-mini + gpt-4o"
  }
}
```

## Project Structure

```
federal-register-analytics/
├── src/
│   ├── types.ts        # TypeScript type definitions
│   ├── config.ts       # Configuration constants
│   ├── utils.ts        # Utility functions
│   ├── fetch.ts        # Federal Register API fetching
│   ├── enrich.ts       # OpenAI enrichment logic
│   ├── aggregate.ts    # Data aggregation (term summaries, timeline)
│   ├── narratives.ts   # LLM-generated narratives (term, monthly, theme)
│   ├── index.ts        # Main exports
│   └── cli/            # CLI entry points
│       ├── fetch.ts
│       ├── enrich.ts
│       ├── aggregate.ts
│       ├── narratives.ts
│       └── pipeline.ts
├── what-got-signed/    # Web frontend
│   ├── server.js       # Express server
│   └── public/         # Static HTML, CSS, JS
├── data/
│   ├── themes.json     # Theme registry (committed)
│   ├── populations.json # Population registry (committed)
│   ├── enriched/       # Enriched data (committed)
│   ├── raw/            # Raw API data (gitignored)
│   └── aggregated/     # Aggregated data (gitignored)
└── dist/               # Compiled JavaScript (gitignored)
```

## Data Files

- `data/enriched/` - Enriched executive order data (committed to repo)
- `data/themes.json` - Theme registry (committed to repo)
- `data/populations.json` - Population registry (committed to repo)
- `data/raw/` - Raw API data (gitignored)
- `data/aggregated/` - Aggregated data (gitignored)

To generate the raw and aggregated data locally:
1. `npm run fetch -- --from 2017 --to 2025`
2. `npm run aggregate`
3. `npm run generate-narratives` (optional)

## License

MIT
