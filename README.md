# Federal Register Analytics

Data enrichment pipeline for Federal Register executive orders. Uses OpenAI to generate summaries, themes, impact analysis, and potential concerns.

## Features

- **Fetch**: Download executive orders from the Federal Register API
- **Enrich**: Use OpenAI to analyze each order and generate:
  - Plain-language summary
  - Thematic categorization (with cohesive theme registry)
  - Impacted populations (with cohesive population registry)
  - Potential concerns (risks, controversies, unintended consequences)
- **Aggregate**: Generate term summaries and timeline data (fast, no API calls)
- **Generate Narratives**: LLM-generated paragraph summaries per presidential term (uses OpenAI API)

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

Process orders through OpenAI for enrichment:

```bash
# Enrich all orders from a specific year
npm run enrich -- --year 2025

# Limit number of orders to process
npm run enrich -- --year 2025 --limit 5

# Re-process already enriched orders
npm run enrich -- --force

# Re-enrich a specific executive order
npm run enrich -- --eo 14350
```

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

Generate LLM-powered narrative summaries for presidential terms and monthly periods. This step uses the OpenAI API and may incur costs:

```bash
# Generate all narratives (term + monthly)
npm run generate-narratives

# Generate term narratives only
npm run generate-narratives -- --type term

# Generate monthly narratives only
npm run generate-narratives -- --type monthly

# Generate monthly narratives for a specific year
npm run generate-narratives -- --type monthly --year 2025

# Generate narrative for a specific month
npm run generate-narratives -- --type monthly --year 2025 --month 3

# Filter by president (term narratives only)
npm run generate-narratives -- --president trump

# Force regeneration (skip incremental checks)
npm run generate-narratives -- --force
```

Outputs:
- `data/aggregated/narratives.json` - Term narratives with 2-3 paragraph summaries covering order count, main themes, temporal trends, impacted populations, and notable concerns
- `data/aggregated/monthly-narratives.json` - Monthly narratives with 1-2 paragraph summaries for each month

Monthly narratives support incremental generation - only new months are processed unless `--force` is used.

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
    "model_used": "gpt-4o"
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
│   ├── narratives.ts   # LLM-generated term narratives
│   ├── index.ts        # Main exports
│   └── cli/            # CLI entry points
│       ├── fetch.ts
│       ├── enrich.ts
│       ├── aggregate.ts
│       └── narratives.ts
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
