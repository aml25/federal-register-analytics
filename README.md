# Federal Register Analytics

Data enrichment pipeline for Federal Register executive orders. Uses Claude to generate summaries, themes, and impact analysis.

## Features

- **Fetch**: Download executive orders from the Federal Register API
- **Enrich**: Use Claude to analyze each order and generate:
  - Plain-language summary
  - Thematic categorization (with cohesive theme registry)
  - Impacted populations (positive and negative effects)
- **Aggregate**: Generate president summaries and timeline data

## Installation

```bash
npm install
npm run build
```

## Configuration

Create a `.env` file with your Anthropic API key:

```
ANTHROPIC_API_KEY=your-api-key-here
```

## Usage

### 1. Fetch Executive Orders

Download executive orders for a specific year:

```bash
npm run fetch -- --year=2025
```

Raw data is saved to `data/raw/`.

### 2. Enrich with AI Analysis

Process orders through Claude for enrichment:

```bash
# Enrich all orders from a specific year
npm run enrich -- --year=2025

# Limit number of orders to process
npm run enrich -- --year=2025 --limit=5

# Re-process already enriched orders
npm run enrich -- --force
```

Enriched data is saved to `data/enriched/`. The theme registry is maintained in `data/themes.json`.

### 3. Aggregate Data

Generate summaries and timeline data:

```bash
npm run aggregate
```

Aggregated data is saved to `data/aggregated/`:
- `presidents.json` - Summary data by president
- `timeline.json` - Chronological order data for timeline views

## Data Structure

### Theme Registry (`data/themes.json`)

Themes are tracked globally to ensure consistency across all executive orders:

```json
{
  "themes": [
    {
      "id": "immigration-enforcement",
      "name": "Immigration Enforcement",
      "description": "Policies related to border security and immigration law enforcement"
    }
  ]
}
```

### Enriched Order

Each enriched order includes:

```json
{
  "document_number": "2025-12345",
  "title": "Executive Order Title",
  "signing_date": "2025-01-20",
  "president": "Donald Trump",
  "full_text": "...",
  "enrichment": {
    "summary": "Plain-language summary of the order...",
    "theme_ids": ["immigration-enforcement", "national-security"],
    "impacted_populations": {
      "positive": ["Border patrol agents", "..."],
      "negative": ["Undocumented immigrants", "..."]
    },
    "enriched_at": "2025-01-15T10:30:00.000Z"
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
│   ├── enrich.ts       # Claude enrichment logic
│   ├── aggregate.ts    # Data aggregation
│   ├── index.ts        # Main exports
│   └── cli/            # CLI entry points
│       ├── fetch.ts
│       ├── enrich.ts
│       └── aggregate.ts
├── data/
│   ├── themes.json     # Theme registry (committed)
│   ├── raw/            # Raw API data (gitignored)
│   ├── enriched/       # Enriched data (gitignored)
│   └── aggregated/     # Aggregated data (gitignored)
└── dist/               # Compiled JavaScript (gitignored)
```

## License

MIT
