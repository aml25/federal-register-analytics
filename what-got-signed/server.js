import express from 'express';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');

const app = express();
const PORT = 3000;

// Serve static files
app.use(express.static(join(__dirname, 'public')));

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

// API: Get themes registry
app.get('/api/themes', async (req, res) => {
  try {
    const data = await readFile(join(DATA_DIR, 'themes.json'), 'utf-8');
    res.json(JSON.parse(data));
  } catch (err) {
    res.status(500).json({ error: 'Failed to load themes' });
  }
});

// API: Get populations registry
app.get('/api/populations', async (req, res) => {
  try {
    const data = await readFile(join(DATA_DIR, 'populations.json'), 'utf-8');
    res.json(JSON.parse(data));
  } catch (err) {
    res.status(500).json({ error: 'Failed to load populations' });
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
    const enrichedDir = join(DATA_DIR, 'enriched');
    const { readdir } = await import('node:fs/promises');
    const files = await readdir(enrichedDir);

    const orders = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const content = await readFile(join(enrichedDir, file), 'utf-8');
      const order = JSON.parse(content);

      // Filter by president and term year
      if (order.president.identifier === presidentId) {
        const orderYear = new Date(order.signing_date).getFullYear();
        const termStartYear = parseInt(termStart, 10);
        // Simple year-based filtering for now
        if (orderYear >= termStartYear && orderYear < termStartYear + 4) {
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
