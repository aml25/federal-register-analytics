// Escape special regex characters
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Extract last name, ignoring suffixes like Jr., Sr., III, etc.
function getLastName(fullName) {
  const suffixes = ['jr.', 'jr', 'sr.', 'sr', 'ii', 'iii', 'iv', 'v'];
  const parts = fullName.split(' ');
  for (let i = parts.length - 1; i >= 0; i--) {
    if (!suffixes.includes(parts[i].toLowerCase())) {
      return parts[i];
    }
  }
  return parts[parts.length - 1];
}

// Get regex pattern for matching president name variations
function getPresidentNamePattern(fullName) {
  const lastName = getLastName(fullName);
  // Match: full name, "President LastName", or just "LastName" - with optional possessive 's
  // Use negative lookahead (?!\w) instead of \b to handle names ending in periods (e.g., "Jr.")
  return new RegExp(
    `(${escapeRegex(fullName)}|President ${escapeRegex(lastName)}|${escapeRegex(lastName)})('s)?(?!\\w)`,
    'g'
  );
}

// Convert full name to president ID (e.g., "Donald Trump" -> "donald-trump")
function getPresidentId(fullName) {
  return fullName.toLowerCase().replace(/\./g, '').replace(/\s+/g, '-');
}

// Wrap president name mentions with styled span and avatar
function wrapPresidentNames(text, fullName) {
  const pattern = getPresidentNamePattern(fullName);
  const presidentId = getPresidentId(fullName);
  const initials = fullName.split(' ').map(n => n[0]).join('');

  return text.replace(pattern, (match) => {
    return `<span class="president-name" data-president="${presidentId}"><wa-avatar name="${initials}" image="/avatars/${presidentId}.jpg" shape="rounded"></wa-avatar>${match}</span>`;
  });
}

// Parse URL params
function getParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    type: params.get('type'),
    president: params.get('president'),
    start: params.get('start'),
    year: params.get('year'),
    quarter: params.get('quarter'),
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
    return `<a href="/detail?type=theme&theme=${encodeURIComponent(id)}" class="wa-link">${name}</a>`;
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
      <p class="order-meta wa-caption-s wa-color-text-quiet">${formatDateShort(order.signing_date)} | ${order.president.name}</p>
      
      <div class="order-header">
        <h4 class="order-title"><a href="${order.html_url}" target="_blank" class="wa-link">${order.title} <wa-icon name="arrow-up-right-from-square" label="Open on Federal Register" style="font-size: 0.8em;"></wa-icon></a></h4>
        <p class="order-summary">${order.enrichment.summary}</p>
      </div>
      <div class="order-themes-section">
        <h5 class="order-themes-label">Themes</h5>
        <div class="order-themes wa-body-m">${themes}</div>
      </div>
      <div class="order-impact-section">
        <h5 class="order-impact-label">Potential impact</h5>
        <div class="order-populations wa-body-m">
          ${positive ? `<div>👍 ${positive}</div>` : ''}
          ${negative ? `<div>😢 ${negative}</div>` : ''}
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

      // Wrap president names in narrative summaries
      const styledSummary = wrapPresidentNames(narrative.summary, narrative.president_name);
      const styledImpact = wrapPresidentNames(narrative.potential_impact, narrative.president_name);

      summaryEl.innerHTML = `<p>${styledSummary}</p>`;
      impactEl.innerHTML = `<p>${styledImpact}</p>`;
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

// Load quarter detail
async function loadQuarterDetail(year, quarter) {
  const titleEl = document.getElementById('page-title');
  const summaryEl = document.getElementById('summary-content');
  const impactEl = document.getElementById('impact-content');
  const ordersEl = document.getElementById('orders-content');

  const quarterName = `Q${quarter} ${year}`;

  try {
    // Load quarterly narratives for the summary
    const narrativesRes = await fetch('/api/quarterly-narratives');
    const narrativesData = await narrativesRes.json();

    const narrative = narrativesData.narratives.find(
      n => n.year === parseInt(year, 10) && n.quarter === parseInt(quarter, 10)
    );

    titleEl.textContent = `Review of executive orders for ${quarterName}.`;

    if (narrative) {
      // Style president names in narrative summaries
      let styledSummary = narrative.summary;
      let styledImpact = narrative.potential_impact;

      for (const president of narrative.presidents || []) {
        styledSummary = wrapPresidentNames(styledSummary, president.president_name);
        styledImpact = wrapPresidentNames(styledImpact, president.president_name);
      }

      summaryEl.innerHTML = `<p>${styledSummary}</p>`;
      impactEl.innerHTML = `<p>${styledImpact}</p>`;
    } else {
      summaryEl.innerHTML = '<p>No narrative available.</p>';
      impactEl.innerHTML = '<p>No narrative available.</p>';
    }

    // Load orders
    const ordersRes = await fetch(`/api/orders/quarter/${year}/${quarter}`);
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
    // Load orders, narratives, themes, and populations in parallel
    const [ordersRes, narrativesRes, themesRes, populationsRes] = await Promise.all([
      fetch(`/api/orders/theme/${themeId}`),
      fetch('/api/theme-narratives'),
      fetch('/api/themes'),
      fetch('/api/populations')
    ]);

    const ordersData = await ordersRes.json();
    const narrativesData = await narrativesRes.json();
    const themesData = await themesRes.json();
    const populationsData = await populationsRes.json();

    const themeMap = new Map(themesData.themes.map(t => [t.id, t.name]));
    const popMap = new Map(populationsData.populations.map(p => [p.id, p.name]));

    const narrative = narrativesData.narratives.find(n => n.theme_id === themeId);
    const orderCount = ordersData.orders.length;

    if (narrative) {
      titleEl.textContent = `Review of executive orders for ${narrative.theme_name}.`;

      // Style president names in narrative summaries
      let styledSummary = narrative.summary;
      let styledImpact = narrative.potential_impact;

      for (const president of narrative.presidents || []) {
        styledSummary = wrapPresidentNames(styledSummary, president.president_name);
        styledImpact = wrapPresidentNames(styledImpact, president.president_name);
      }

      summaryEl.innerHTML = `<p>${styledSummary}</p>`;
      impactEl.innerHTML = `<p>${styledImpact}</p>`;
    } else {
      // No narrative - show callout and hide summary/impact sections
      const theme = themesData.themes.find(t => t.id === themeId);
      const themeName = theme?.name || themeId;
      titleEl.textContent = `Review of executive orders for ${themeName}.`;

      const callout = document.getElementById('detail-callout');
      const calloutMessage = document.getElementById('detail-callout-message');
      const summarySection = document.getElementById('summary-section');
      const impactSection = document.getElementById('impact-section');
      const ordersSection = document.getElementById('orders-section');

      let message = '';
      if (orderCount === 0) {
        message = `There aren't any executive orders tagged with this theme yet. Check back later as more orders are analyzed.`;
        ordersSection.style.display = 'none';
      } else if (orderCount === 1) {
        message = `There's only one executive order with this theme, so there isn't a summary yet. Take a look at the order below to learn more.`;
      } else {
        message = `A summary for this theme is still in progress. In the meantime, browse the ${orderCount} orders below.`;
      }

      calloutMessage.textContent = message;
      callout.style.display = '';
      summarySection.style.display = 'none';
      impactSection.style.display = 'none';
    }

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
  } else if (params.type === 'quarter' && params.year && params.quarter) {
    loadQuarterDetail(params.year, params.quarter);
  } else if (params.type === 'theme' && params.theme) {
    loadThemeDetail(params.theme);
  } else {
    document.getElementById('page-title').textContent = 'Invalid request';
  }

});
