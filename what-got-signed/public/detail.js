// Parse URL params
function getParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    type: params.get('type'),
    president: params.get('president'),
    start: params.get('start'),
    year: params.get('year'),
    month: params.get('month'),
    theme: params.get('theme')
  };
}

// Format date
function formatDate(dateStr) {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

// Render themes as clickable links
function renderThemes(themeIds, themeMap) {
  return themeIds.map(id => {
    const name = themeMap.get(id) || id;
    return `<a href="/detail.html?type=theme&theme=${encodeURIComponent(id)}" class="theme-link">${name}</a>`;
  }).join(', ');
}

// Format date shorter
function formatDateShort(dateStr) {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

// Render order item HTML
function renderOrderItem(order, themeMap, popMap) {
  const themes = renderThemes(order.enrichment.theme_ids, themeMap);
  const positiveIds = order.enrichment.impacted_populations.positive_ids || [];
  const negativeIds = order.enrichment.impacted_populations.negative_ids || [];
  const positive = positiveIds.map(id => popMap.get(id) || id).join(', ');
  const negative = negativeIds.map(id => popMap.get(id) || id).join(', ');

  return `
    <div class="order-item">
      <div class="order-meta">${formatDateShort(order.signing_date)} • ${order.president.name}</div>
      <div class="order-title">${order.title} <a href="${order.html_url}" target="_blank" rel="noopener" class="order-external-link" title="Read full executive order"><i class="fa-solid fa-arrow-up-right-from-square"></i></a></div>
      <div class="order-summary">${order.enrichment.summary}</div>
      <div class="order-themes-section">
        <div class="order-themes-label">Themes</div>
        <div class="order-themes">${themes}</div>
      </div>
      <div class="order-impact-section">
        <div class="order-impact-label">Potential impact</div>
        <div class="order-populations">
          ${positive ? `<div>👍 ${positive}</div>` : ''}
          ${negative ? `<div>👎 ${negative}</div>` : ''}
        </div>
      </div>
    </div>
  `;
}

// Load term detail
async function loadTermDetail(presidentId, termStart) {
  const titleEl = document.getElementById('page-title');
  const summaryEl = document.getElementById('summary-content');
  const impactEl = document.getElementById('impact-content');
  const ordersEl = document.getElementById('orders-content');

  try {
    // Load narratives for the summary
    const narrativesRes = await fetch('/api/narratives');
    const narrativesData = await narrativesRes.json();

    const narrative = narrativesData.narratives.find(
      n => n.president_id === presidentId && n.term_start === parseInt(termStart, 10)
    );

    if (narrative) {
      const termEnd = narrative.term_end === 'present' ? 'present' : narrative.term_end;
      titleEl.textContent = `Review of executive orders for ${narrative.president_name} (${narrative.term_start}-${termEnd}).`;
      summaryEl.innerHTML = `<p>${narrative.summary}</p>`;
      impactEl.innerHTML = `<p>${narrative.potential_impact}</p>`;
    } else {
      titleEl.textContent = `Review of executive orders for ${presidentId}.`;
      summaryEl.innerHTML = '<p>No narrative available.</p>';
      impactEl.innerHTML = '<p>No narrative available.</p>';
    }

    // Load orders
    const ordersRes = await fetch(`/api/orders/term/${presidentId}/${termStart}`);
    const ordersData = await ordersRes.json();

    // Load themes and populations for name lookups
    const [themesRes, populationsRes] = await Promise.all([
      fetch('/api/themes'),
      fetch('/api/populations')
    ]);
    const themesData = await themesRes.json();
    const populationsData = await populationsRes.json();

    const themeMap = new Map(themesData.themes.map(t => [t.id, t.name]));
    const popMap = new Map(populationsData.populations.map(p => [p.id, p.name]));

    ordersEl.innerHTML = ordersData.orders.map(order => renderOrderItem(order, themeMap, popMap)).join('');

  } catch (err) {
    console.error(err);
    summaryEl.innerHTML = '<p>Failed to load data.</p>';
  }
}

// Load month detail
async function loadMonthDetail(year, month) {
  const titleEl = document.getElementById('page-title');
  const summaryEl = document.getElementById('summary-content');
  const impactEl = document.getElementById('impact-content');
  const ordersEl = document.getElementById('orders-content');

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const monthName = monthNames[parseInt(month, 10) - 1];

  try {
    // Load monthly narratives for the summary
    const narrativesRes = await fetch('/api/monthly-narratives');
    const narrativesData = await narrativesRes.json();

    const narrative = narrativesData.narratives.find(
      n => n.year === parseInt(year, 10) && n.month === parseInt(month, 10)
    );

    titleEl.textContent = `Review of executive orders for ${monthName} ${year}.`;

    if (narrative) {
      summaryEl.innerHTML = `<p>${narrative.summary}</p>`;
      impactEl.innerHTML = `<p>${narrative.potential_impact}</p>`;
    } else {
      summaryEl.innerHTML = '<p>No narrative available.</p>';
      impactEl.innerHTML = '<p>No narrative available.</p>';
    }

    // Load orders
    const ordersRes = await fetch(`/api/orders/month/${year}/${month}`);
    const ordersData = await ordersRes.json();

    // Load themes and populations for name lookups
    const [themesRes, populationsRes] = await Promise.all([
      fetch('/api/themes'),
      fetch('/api/populations')
    ]);
    const themesData = await themesRes.json();
    const populationsData = await populationsRes.json();

    const themeMap = new Map(themesData.themes.map(t => [t.id, t.name]));
    const popMap = new Map(populationsData.populations.map(p => [p.id, p.name]));

    ordersEl.innerHTML = ordersData.orders.map(order => renderOrderItem(order, themeMap, popMap)).join('');

  } catch (err) {
    console.error(err);
    summaryEl.innerHTML = '<p>Failed to load data.</p>';
  }
}

// Load theme detail
async function loadThemeDetail(themeId) {
  const titleEl = document.getElementById('page-title');
  const summaryEl = document.getElementById('summary-content');
  const impactEl = document.getElementById('impact-content');
  const ordersEl = document.getElementById('orders-content');

  try {
    // Load theme narratives for the summary
    const narrativesRes = await fetch('/api/theme-narratives');
    const narrativesData = await narrativesRes.json();

    const narrative = narrativesData.narratives.find(n => n.theme_id === themeId);

    if (narrative) {
      titleEl.textContent = `Review of executive orders for ${narrative.theme_name}.`;
      summaryEl.innerHTML = `<p>${narrative.summary}</p>`;
      impactEl.innerHTML = `<p>${narrative.potential_impact}</p>`;
    } else {
      // Fall back to themes registry for the name
      const themesRes = await fetch('/api/themes');
      const themesData = await themesRes.json();
      const theme = themesData.themes.find(t => t.id === themeId);
      const themeName = theme?.name || themeId;
      titleEl.textContent = `Review of executive orders for ${themeName}.`;
      summaryEl.innerHTML = '<p>No narrative available.</p>';
      impactEl.innerHTML = '<p>No narrative available.</p>';
    }

    // Load orders
    const ordersRes = await fetch(`/api/orders/theme/${themeId}`);
    const ordersData = await ordersRes.json();

    // Load themes and populations for name lookups
    const [themesRes, populationsRes] = await Promise.all([
      fetch('/api/themes'),
      fetch('/api/populations')
    ]);
    const themesData = await themesRes.json();
    const populationsData = await populationsRes.json();

    const themeMap = new Map(themesData.themes.map(t => [t.id, t.name]));
    const popMap = new Map(populationsData.populations.map(p => [p.id, p.name]));

    ordersEl.innerHTML = ordersData.orders.map(order => renderOrderItem(order, themeMap, popMap)).join('');

  } catch (err) {
    console.error(err);
    summaryEl.innerHTML = '<p>Failed to load data.</p>';
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  const params = getParams();

  if (params.type === 'term' && params.president && params.start) {
    loadTermDetail(params.president, params.start);
  } else if (params.type === 'month' && params.year && params.month) {
    loadMonthDetail(params.year, params.month);
  } else if (params.type === 'theme' && params.theme) {
    loadThemeDetail(params.theme);
  } else {
    document.getElementById('page-title').textContent = 'Invalid request';
  }
});
