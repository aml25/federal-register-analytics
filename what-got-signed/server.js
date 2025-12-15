import express from 'express';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');

// Category labels for themes
const THEME_CATEGORY_LABELS = {
  national_security_defense: 'National Security & Defense',
  immigration: 'Immigration',
  economy_trade: 'Economy & Trade',
  energy_environment: 'Energy & Environment',
  healthcare: 'Healthcare',
  civil_rights_equity: 'Civil Rights & Equity',
  education: 'Education',
  government_operations: 'Government Operations',
  foreign_policy: 'Foreign Policy',
  country_region_specific: 'Country/Region-Specific',
  law_enforcement_justice: 'Law Enforcement & Justice',
  technology_innovation: 'Technology & Innovation',
  infrastructure: 'Infrastructure',
  labor_workforce: 'Labor & Workforce',
  agriculture_rural: 'Agriculture & Rural',
  disaster_emergency: 'Disaster & Emergency',
  administrative_procedural: 'Administrative/Procedural',
  social_cultural: 'Social & Cultural',
  international_institutions: 'International Institutions'
};

/**
 * Generate slug ID from a name
 */
function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Load taxonomy from data folder
 */
async function loadTaxonomy() {
  const content = await readFile(join(DATA_DIR, 'taxonomy.json'), 'utf-8');
  return JSON.parse(content);
}

/**
 * Generate themes registry from taxonomy
 */
function generateThemesFromTaxonomy(taxonomy) {
  const themes = [];
  const now = new Date().toISOString();

  for (const [key, items] of Object.entries(taxonomy.themes)) {
    const category = THEME_CATEGORY_LABELS[key] || key;
    for (const entry of items) {
      themes.push({
        id: slugify(entry.name),
        name: entry.name,
        definition: entry.definition || '',
        category: category,
        category_key: key,
        created_at: now
      });
    }
  }

  return { themes, updated_at: now };
}

/**
 * Generate populations registry from taxonomy
 */
function generatePopulationsFromTaxonomy(taxonomy) {
  const populations = [];
  const now = new Date().toISOString();
  const pops = taxonomy.impacted_populations;

  const addFromCategory = (entries, category, categoryKey) => {
    for (const entry of entries) {
      populations.push({
        id: slugify(entry.name),
        name: entry.name,
        definition: entry.definition || '',
        category: category,
        category_key: categoryKey,
        created_at: now
      });
    }
  };

  // Demographic groups
  addFromCategory(pops.demographic_groups.racial_ethnic, 'Demographic Groups > Racial/Ethnic', 'demographic_groups.racial_ethnic');
  addFromCategory(pops.demographic_groups.gender_identity_sexuality, 'Demographic Groups > Gender Identity & Sexuality', 'demographic_groups.gender_identity_sexuality');
  addFromCategory(pops.demographic_groups.age_groups, 'Demographic Groups > Age Groups', 'demographic_groups.age_groups');
  addFromCategory(pops.demographic_groups.religious_groups, 'Demographic Groups > Religious Groups', 'demographic_groups.religious_groups');
  addFromCategory(pops.demographic_groups.disability_status, 'Demographic Groups > Disability Status', 'demographic_groups.disability_status');

  // Immigration status
  addFromCategory(pops.immigration_status, 'Immigration Status', 'immigration_status');

  // Employment sectors
  addFromCategory(pops.employment_sectors.government, 'Employment Sectors > Government', 'employment_sectors.government');
  addFromCategory(pops.employment_sectors.private_sector, 'Employment Sectors > Private Sector', 'employment_sectors.private_sector');
  addFromCategory(pops.employment_sectors.industry_specific, 'Employment Sectors > Industry-Specific', 'employment_sectors.industry_specific');

  // Economic status
  addFromCategory(pops.economic_status, 'Economic Status', 'economic_status');

  // Geographic communities
  addFromCategory(pops.geographic_communities.domestic, 'Geographic Communities > Domestic', 'geographic_communities.domestic');
  addFromCategory(pops.geographic_communities.regional, 'Geographic Communities > Regional', 'geographic_communities.regional');

  // Institutional groups
  addFromCategory(pops.institutional_groups.education, 'Institutional Groups > Education', 'institutional_groups.education');
  addFromCategory(pops.institutional_groups.healthcare, 'Institutional Groups > Healthcare', 'institutional_groups.healthcare');
  addFromCategory(pops.institutional_groups.justice_system, 'Institutional Groups > Justice System', 'institutional_groups.justice_system');

  // Special populations
  addFromCategory(pops.special_populations, 'Special Populations', 'special_populations');

  // Foreign populations
  addFromCategory(pops.foreign_populations, 'Foreign Populations', 'foreign_populations');

  // Organizational entities
  addFromCategory(pops.organizational_entities, 'Organizational Entities', 'organizational_entities');

  return { populations, updated_at: now };
}

const app = express();
const PORT = process.env.PORT || 3000;

// Additional allowed origins (optional, comma-separated)
// Use this to allow extra domains beyond same-origin, e.g., for admin dashboards
const EXTRA_ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : [];

// Middleware to restrict API access to same-origin requests (plus any extra allowed origins)
function restrictApiOrigin(req, res, next) {
  const origin = req.get('Origin');
  const referer = req.get('Referer');
  const host = req.get('Host');

  // No Origin header = same-origin request (browsers don't send Origin for same-origin)
  // This covers normal page loads and same-origin fetch/XHR
  if (!origin) {
    return next();
  }

  // Check if Origin matches the Host (same-origin)
  // Origin format: "https://example.com" or "http://localhost:3000"
  // Host format: "example.com" or "localhost:3000"
  try {
    const originUrl = new URL(origin);
    if (originUrl.host === host) {
      return next();
    }
  } catch (e) {
    // Invalid origin URL, reject
  }

  // Check against extra allowed origins (if configured)
  if (EXTRA_ALLOWED_ORIGINS.length > 0) {
    if (EXTRA_ALLOWED_ORIGINS.some(allowed => origin.startsWith(allowed))) {
      return next();
    }
  }

  // Reject cross-origin requests from unauthorized origins
  res.status(403).json({ error: 'Access denied: cross-origin request not allowed' });
}

// Set up EJS as the view engine
app.set('view engine', 'ejs');
app.set('views', join(__dirname, 'views'));

// Page routes (before static middleware to take priority)
app.get('/', (req, res) => {
  res.render('index');
});

app.get('/detail', (req, res) => {
  res.render('detail');
});

app.get('/definitions', (req, res) => {
  res.render('definitions');
});

// Serve static files (CSS, JS, images)
app.use(express.static(join(__dirname, 'public')));

// Apply origin restriction to all API routes
app.use('/api', restrictApiOrigin);

// API: Get term summaries
app.get('/api/term-summaries', async (req, res) => {
  try {
    const data = await readFile(join(DATA_DIR, 'aggregated', 'term-summaries.json'), 'utf-8');
    res.json(JSON.parse(data));
  } catch (err) {
    res.status(500).json({ error: 'Failed to load term summaries' });
  }
});

// API: Get term narratives
app.get('/api/narratives', async (req, res) => {
  try {
    const data = await readFile(join(DATA_DIR, 'aggregated', 'narratives.json'), 'utf-8');
    res.json(JSON.parse(data));
  } catch (err) {
    res.status(500).json({ error: 'Failed to load narratives' });
  }
});

// API: Get timeline data
app.get('/api/timeline', async (req, res) => {
  try {
    const data = await readFile(join(DATA_DIR, 'aggregated', 'timeline.json'), 'utf-8');
    res.json(JSON.parse(data));
  } catch (err) {
    res.status(500).json({ error: 'Failed to load timeline' });
  }
});

// API: Get monthly narratives
app.get('/api/monthly-narratives', async (req, res) => {
  try {
    const data = await readFile(join(DATA_DIR, 'aggregated', 'monthly-narratives.json'), 'utf-8');
    res.json(JSON.parse(data));
  } catch (err) {
    res.status(500).json({ error: 'Failed to load monthly narratives' });
  }
});

// API: Get themes (generated from taxonomy)
app.get('/api/themes', async (req, res) => {
  try {
    const taxonomy = await loadTaxonomy();
    res.json(generateThemesFromTaxonomy(taxonomy));
  } catch (err) {
    res.status(500).json({ error: 'Failed to load themes' });
  }
});

// API: Get populations (generated from taxonomy)
app.get('/api/populations', async (req, res) => {
  try {
    const taxonomy = await loadTaxonomy();
    res.json(generatePopulationsFromTaxonomy(taxonomy));
  } catch (err) {
    res.status(500).json({ error: 'Failed to load populations' });
  }
});

// API: Get full taxonomy (hierarchical structure)
app.get('/api/taxonomy', async (req, res) => {
  try {
    const taxonomy = await loadTaxonomy();
    res.json(taxonomy);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load taxonomy' });
  }
});

// API: Get theme narratives
app.get('/api/theme-narratives', async (req, res) => {
  try {
    const data = await readFile(join(DATA_DIR, 'aggregated', 'theme-narratives.json'), 'utf-8');
    res.json(JSON.parse(data));
  } catch (err) {
    res.status(500).json({ error: 'Failed to load theme narratives' });
  }
});

// API: Get enriched orders for a term
app.get('/api/orders/term/:presidentId/:termStart', async (req, res) => {
  try {
    const { presidentId, termStart } = req.params;
    const termStartYear = parseInt(termStart, 10);

    // Look up the actual term end from term summaries
    const termSummariesData = await readFile(join(DATA_DIR, 'aggregated', 'term-summaries.json'), 'utf-8');
    const termSummaries = JSON.parse(termSummariesData);
    const term = termSummaries.summaries.find(t =>
      t.president_id === presidentId && t.term_start === termStartYear
    );

    // Use actual term end, or default to start + 4 if not found
    const termEndYear = term?.term_end === 'present'
      ? new Date().getFullYear() + 1
      : (term?.term_end || termStartYear + 4);

    const enrichedDir = join(DATA_DIR, 'enriched');
    const { readdir } = await import('node:fs/promises');
    const files = await readdir(enrichedDir);

    const orders = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const content = await readFile(join(enrichedDir, file), 'utf-8');
      const order = JSON.parse(content);

      // Filter by president and term year range
      // Use <= for end year since presidents sign EOs until Jan 20 of their final year
      if (order.president.identifier === presidentId) {
        const orderYear = new Date(order.signing_date).getFullYear();
        if (orderYear >= termStartYear && orderYear <= termEndYear) {
          orders.push(order);
        }
      }
    }

    // Sort by date descending
    orders.sort((a, b) => new Date(b.signing_date).getTime() - new Date(a.signing_date).getTime());
    res.json({ orders });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load orders' });
  }
});

// API: Get enriched orders for a month
app.get('/api/orders/month/:year/:month', async (req, res) => {
  try {
    const { year, month } = req.params;
    const enrichedDir = join(DATA_DIR, 'enriched');
    const { readdir } = await import('node:fs/promises');
    const files = await readdir(enrichedDir);

    const orders = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const content = await readFile(join(enrichedDir, file), 'utf-8');
      const order = JSON.parse(content);

      const orderDate = new Date(order.signing_date);
      if (orderDate.getFullYear() === parseInt(year, 10) &&
          orderDate.getMonth() + 1 === parseInt(month, 10)) {
        orders.push(order);
      }
    }

    // Sort by date descending
    orders.sort((a, b) => new Date(b.signing_date).getTime() - new Date(a.signing_date).getTime());
    res.json({ orders });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load orders' });
  }
});

// API: Get enriched orders for a theme
app.get('/api/orders/theme/:themeId', async (req, res) => {
  try {
    const { themeId } = req.params;
    const enrichedDir = join(DATA_DIR, 'enriched');
    const { readdir } = await import('node:fs/promises');
    const files = await readdir(enrichedDir);

    const orders = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const content = await readFile(join(enrichedDir, file), 'utf-8');
      const order = JSON.parse(content);

      if (order.enrichment.theme_ids.includes(themeId)) {
        orders.push(order);
      }
    }

    // Sort by date descending
    orders.sort((a, b) => new Date(b.signing_date).getTime() - new Date(a.signing_date).getTime());
    res.json({ orders });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load orders' });
  }
});

app.listen(PORT, () => {
  console.log(`What Got Signed? running at http://localhost:${PORT}`);
});
