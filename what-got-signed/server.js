import express from 'express';
import { readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import OpenAI from 'openai';
import rateLimit from 'express-rate-limit';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');
const PARAM_ALLOW = /^[a-z0-9_-]+$/i;

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

app.get('/detail/term/:president/:start', (req, res) => {
  res.render('detail');
});

app.get('/detail/quarter/:year/:quarter', (req, res) => {
  res.render('detail');
});

app.get('/detail/theme/:themeId', (req, res) => {
  res.render('detail');
});

app.get('/definitions', (req, res) => {
  res.render('definitions');
});

// Serve DOMPurify browser build from node_modules
app.use('/dompurify.min.js', express.static(join(__dirname, 'node_modules/dompurify/dist/purify.min.js')));

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

// API: Get quarterly narratives
app.get('/api/quarterly-narratives', async (req, res) => {
  try {
    const data = await readFile(join(DATA_DIR, 'aggregated', 'quarterly-narratives.json'), 'utf-8');
    res.json(JSON.parse(data));
  } catch (err) {
    res.status(500).json({ error: 'Failed to load quarterly narratives' });
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

// API: Get enriched orders for a quarter
app.get('/api/orders/quarter/:year/:quarter', async (req, res) => {
  try {
    const { year, quarter } = req.params;
    const yearNum = parseInt(year, 10);
    const quarterNum = parseInt(quarter, 10);
    const enrichedDir = join(DATA_DIR, 'enriched');
    const { readdir } = await import('node:fs/promises');
    const files = await readdir(enrichedDir);

    // Calculate which months are in this quarter
    const startMonth = (quarterNum - 1) * 3 + 1; // Q1=1, Q2=4, Q3=7, Q4=10
    const endMonth = quarterNum * 3; // Q1=3, Q2=6, Q3=9, Q4=12

    const orders = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const content = await readFile(join(enrichedDir, file), 'utf-8');
      const order = JSON.parse(content);

      const orderDate = new Date(order.signing_date);
      const orderYear = orderDate.getFullYear();
      const orderMonth = orderDate.getMonth() + 1;

      if (orderYear === yearNum && orderMonth >= startMonth && orderMonth <= endMonth) {
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

// API: Get weekly digest
app.get('/api/weekly-narrative', async (req, res) => {
  try {
    const data = await readFile(join(DATA_DIR, 'aggregated', 'weekly-narrative.json'), 'utf-8');
    res.json(JSON.parse(data));
  } catch (err) {
    res.status(404).json({ error: 'Weekly narrative not yet generated' });
  }
});

// ─── EO detail page route ────────────────────────────────────────────────────

app.get('/detail/eo/:eoNumber', (req, res) => {
  res.render('eo-detail');
});

// ─── API: Get single enriched EO ─────────────────────────────────────────────

app.get('/api/eo/:eoNumber', async (req, res) => {
  const eoNumber = parseInt(req.params.eoNumber, 10);
  if (!Number.isFinite(eoNumber) || eoNumber <= 0) {
    return res.status(400).json({ error: 'Invalid EO number' });
  }
  const filePath = join(DATA_DIR, 'enriched', `eo-${eoNumber}.json`);
  try {
    const raw = await readFile(filePath, 'utf-8');
    let data;
    try {
      data = JSON.parse(raw);
    } catch (parseErr) {
      console.error(`JSON parse error for eo-${eoNumber}.json:`, parseErr.message);
      return res.status(500).json({ error: 'Failed to parse EO data' });
    }
    res.json(data);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.status(404).json({ error: 'EO not found' });
    }
    console.error(`Failed to load eo-${eoNumber}.json:`, err.message);
    res.status(500).json({ error: 'Failed to load EO' });
  }
});

// ─── API: Chat ────────────────────────────────────────────────────────────────

// In-process cache: EO number → stripped text (lives for the lifetime of this serverless instance)
const eoTextCache = new Map();

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function truncateRawText(text, maxChars = 24000) {
  if (text.length <= maxChars) return text;
  const cutoff = text.lastIndexOf('\n\n', maxChars);
  const pos = cutoff > maxChars * 0.5 ? cutoff : text.lastIndexOf('\n', maxChars);
  return text.slice(0, pos > 0 ? pos : maxChars) + '\n\n— [text truncated] —';
}

async function fetchEoRawText(htmlUrl, eoId) {
  if (eoTextCache.has(eoId)) return eoTextCache.get(eoId);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch(htmlUrl, { signal: controller.signal });
    const html = await res.text();
    const text = truncateRawText(stripHtml(html));
    eoTextCache.set(eoId, text);
    return text;
  } catch (err) {
    if (err.name === 'AbortError') {
      console.warn(`FR API timeout for EO ${eoId} — degrading to summary only`);
    } else {
      console.warn(`FR API error for EO ${eoId}:`, err.message);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function assembleContext(contextType, params) {
  switch (contextType) {
    case 'homepage': {
      try {
        const raw = await readFile(join(DATA_DIR, 'aggregated', 'weekly-narrative.json'), 'utf-8');
        const data = JSON.parse(raw);
        const narrative = data.narrative || data;
        return `This week in executive orders:\n${narrative.summary || JSON.stringify(narrative).slice(0, 2000)}`;
      } catch {
        return 'The user is on the homepage of What Got Signed?, a site tracking U.S. executive orders.';
      }
    }
    case 'eo': {
      const eoId = parseInt(params.eoNumber, 10);
      if (!Number.isFinite(eoId) || eoId <= 0) throw Object.assign(new Error('Invalid EO number'), { status: 400 });
      const raw = await readFile(join(DATA_DIR, 'enriched', `eo-${eoId}.json`), 'utf-8');
      const eo = JSON.parse(raw);
      const rawText = await fetchEoRawText(eo.html_url, eoId);
      const rawBlock = rawText ? `\nFULL ORDER TEXT:\n${rawText}` : '\n(Full text unavailable.)';
      return `EXECUTIVE ORDER CONTEXT:\nNumber: ${eo.executive_order_number}\nTitle: ${eo.title}\nSigned: ${eo.signing_date} by ${eo.president.name}\nSummary: ${eo.enrichment.summary}\n${rawBlock}`;
    }
    case 'theme': {
      const { themeId } = params;
      if (!themeId || !PARAM_ALLOW.test(themeId)) throw Object.assign(new Error('Invalid theme ID'), { status: 400 });
      const enrichedDir = join(DATA_DIR, 'enriched');
      const files = await readdir(enrichedDir);
      const orders = [];
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const content = await readFile(join(enrichedDir, file), 'utf-8');
        const order = JSON.parse(content);
        if (order.enrichment?.theme_ids?.includes(themeId)) orders.push(order);
      }
      orders.sort((a, b) => new Date(b.signing_date) - new Date(a.signing_date));
      const top = orders.slice(0, 20);
      if (top.length === 0) return `No executive orders are currently tagged with the theme "${themeId}".`;
      const lines = top.map(o => `- EO ${o.executive_order_number} (${o.signing_date}): ${o.title} — ${o.enrichment.summary}`);
      return `Executive orders tagged with theme "${themeId}" (showing ${top.length} of ${orders.length} total):\n${lines.join('\n')}`;
    }
    case 'term': {
      const { presidentId, termStart } = params;
      if (!presidentId || !PARAM_ALLOW.test(presidentId)) throw Object.assign(new Error('Invalid president ID'), { status: 400 });
      const termStartYear = parseInt(termStart, 10);
      if (!Number.isFinite(termStartYear) || termStartYear < 1900) throw Object.assign(new Error('Invalid term start'), { status: 400 });
      const enrichedDir = join(DATA_DIR, 'enriched');
      const files = await readdir(enrichedDir);
      const termEndYear = termStartYear + 4;
      const orders = [];
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const content = await readFile(join(enrichedDir, file), 'utf-8');
        const order = JSON.parse(content);
        if (order.president?.identifier === presidentId) {
          const y = new Date(order.signing_date).getFullYear();
          if (y >= termStartYear && y <= termEndYear) orders.push(order);
        }
      }
      orders.sort((a, b) => new Date(b.signing_date) - new Date(a.signing_date));
      const top = orders.slice(0, 20);
      if (top.length === 0) return `No executive orders found for president "${presidentId}" starting ${termStartYear}.`;
      const lines = top.map(o => `- EO ${o.executive_order_number} (${o.signing_date}): ${o.title} — ${o.enrichment.summary}`);
      return `Executive orders by president "${presidentId}" (term starting ${termStartYear}, showing ${top.length} of ${orders.length} total):\n${lines.join('\n')}`;
    }
    case 'quarter': {
      const { year, quarter } = params;
      const yearNum = parseInt(year, 10);
      const quarterNum = parseInt(quarter, 10);
      if (!Number.isFinite(yearNum) || yearNum < 1900) throw Object.assign(new Error('Invalid year'), { status: 400 });
      if (!Number.isFinite(quarterNum) || quarterNum < 1 || quarterNum > 4) throw Object.assign(new Error('Invalid quarter'), { status: 400 });
      const enrichedDir = join(DATA_DIR, 'enriched');
      const files = await readdir(enrichedDir);
      const startMonth = (quarterNum - 1) * 3 + 1;
      const endMonth = quarterNum * 3;
      const orders = [];
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const content = await readFile(join(enrichedDir, file), 'utf-8');
        const order = JSON.parse(content);
        const d = new Date(order.signing_date);
        const m = d.getMonth() + 1;
        if (d.getFullYear() === yearNum && m >= startMonth && m <= endMonth) orders.push(order);
      }
      orders.sort((a, b) => new Date(b.signing_date) - new Date(a.signing_date));
      const top = orders.slice(0, 20);
      if (top.length === 0) return `No executive orders found for Q${quarterNum} ${yearNum}.`;
      const lines = top.map(o => `- EO ${o.executive_order_number} (${o.signing_date}): ${o.title} — ${o.enrichment.summary}`);
      return `Executive orders for Q${quarterNum} ${yearNum} (showing ${top.length} of ${orders.length} total):\n${lines.join('\n')}`;
    }
    default:
      return 'The user is exploring What Got Signed?, a site tracking U.S. executive orders.';
  }
}

const chatLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — try again in a moment.' },
});

let _openai = null;
function getOpenAI() {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

async function chatHandler(req, res) {
  const { context, messages, question } = req.body || {};
  const ALLOWED_TYPES = new Set(['homepage', 'eo', 'theme', 'term', 'quarter', 'generic']);

  if (!context || typeof context.type !== 'string' || !ALLOWED_TYPES.has(context.type)) {
    return res.status(400).json({ error: 'Invalid context' });
  }
  if (!question || typeof question !== 'string' || !question.trim()) {
    return res.status(400).json({ error: 'Question is required' });
  }
  const history = Array.isArray(messages) ? messages : [];
  if (history.length > 20) {
    return res.status(400).json({ error: 'Conversation history too long' });
  }

  let contextText;
  try {
    contextText = await assembleContext(context.type, context.params || {});
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'Content not found' });
    console.error('assembleContext error:', err.message);
    return res.status(500).json({ error: 'Failed to load page context' });
  }

  const systemPrompt = `You are a research assistant helping users understand U.S. executive orders on the site What Got Signed?
Answer questions accurately and concisely. Cite specific executive order numbers when relevant.
Flag when something requires legal interpretation beyond what the data shows.

PAGE CONTEXT:
${contextText}`;

  const openaiMessages = [
    { role: 'system', content: systemPrompt },
    ...history.filter(m => m.role === 'user' || m.role === 'assistant')
               .map(m => ({ role: m.role, content: String(m.content).slice(0, 4000) })),
    { role: 'user', content: question.trim() },
  ];

  const t0 = Date.now();
  try {
    const completion = await getOpenAI().chat.completions.create(
      { model: 'gpt-4.1-mini', messages: openaiMessages, max_tokens: 1024 },
      { signal: AbortSignal.timeout(15000) },
    );

    const answer = completion.choices?.[0]?.message?.content || '';
    const finishReason = completion.choices?.[0]?.finish_reason;
    const durationMs = Date.now() - t0;
    console.log(JSON.stringify({ t: 'chat', contextType: context.type, durationMs, tokens: completion.usage?.total_tokens }));

    if (finishReason === 'content_filter') {
      return res.json({ answer: "I can't respond to that question. Please try a different approach." });
    }
    return res.json({ answer });
  } catch (err) {
    if (err.name === 'AbortError' || err.name === 'TimeoutError' || err.name === 'APIUserAbortError') {
      return res.status(504).json({ error: 'Response timed out — please try again.' });
    }
    if (err.constructor?.name === 'RateLimitError' || err.status === 429) {
      return res.status(429).json({ error: 'Too many requests — try again in a moment.' });
    }
    console.error('OpenAI API error:', err.message);
    res.status(500).json({ error: "Couldn't get a response. Try again." });
  }
}

app.post('/api/chat', chatLimiter, express.json(), chatHandler);

app.listen(PORT, () => {
  console.log(`What Got Signed? running at http://localhost:${PORT}`);
});
