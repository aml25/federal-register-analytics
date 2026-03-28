// detail-eo.js — EO detail page: fetch EO data, populate page, dispatch context event
// Loaded on /detail/eo/:eoNumber. Requires utils.js (wrapPresidentNames, linkThemeNames).

// Format date string to readable form, UTC-safe
function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

// Extract EO number from URL path: /detail/eo/14395 → "14395"
function getEoNumber() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  // parts: ['detail', 'eo', '14395']
  return parts[2] || null;
}

function showError(message) {
  document.getElementById('eo-skeleton').style.display = 'none';
  document.getElementById('eo-main').style.display = '';
  document.getElementById('eo-error').style.display = '';
  document.getElementById('eo-error-message').textContent = message;
}

function renderEoPage(eo, themes) {
  // Build theme map for linkThemeNames
  const themeMap = new Map(themes.map(t => [t.id, t.name]));

  // Resolve theme IDs to {id, name} pairs
  const eoThemes = (eo.enrichment.theme_ids || [])
    .map(id => ({ id, name: themeMap.get(id) || id }));

  // Resolve population IDs to names (inline from themes endpoint label format)
  const positiveIds = eo.enrichment.impacted_populations.positive_ids || [];
  const negativeIds = eo.enrichment.impacted_populations.negative_ids || [];

  // EO number badge
  const badge = document.getElementById('eo-number-badge');
  if (badge) badge.textContent = `EO ${eo.executive_order_number}`;

  // Page title
  document.title = `EO ${eo.executive_order_number}: ${eo.title} — What Got Signed?`;

  // H1 title
  document.getElementById('eo-title').textContent = eo.title;

  // Signed date
  document.getElementById('eo-date').textContent = formatDate(eo.signing_date);

  // President (with wrapPresidentNames)
  const presidentSpan = document.getElementById('eo-president');
  presidentSpan.innerHTML = wrapPresidentNames(
    DOMPurify.sanitize(eo.president.name, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] }),
    eo.president.name
  );

  // Summary — DOMPurify → wrapPresidentNames → linkThemeNames
  let summary = DOMPurify.sanitize(eo.enrichment.summary, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
  summary = wrapPresidentNames(summary, eo.president.name);
  summary = linkThemeNames(summary, eoThemes);
  document.getElementById('eo-summary').innerHTML = summary;

  // Theme chips (max 6)
  const themesEl = document.getElementById('eo-themes');
  const displayThemes = eoThemes.slice(0, 6);
  if (displayThemes.length) {
    themesEl.innerHTML = displayThemes
      .map(t => `<a href="/detail/theme/${t.id}" class="wa-link">${t.name.toLowerCase()}</a>`)
      .join('');
    const remaining = eoThemes.length - displayThemes.length;
    if (remaining > 0) {
      themesEl.innerHTML += `<span class="wa-caption-s wa-color-text-quiet">+${remaining} more</span>`;
    }
  }

  // Populations (max 3 per category, then "+N more")
  const popsEl = document.getElementById('eo-populations');
  const popLines = [];
  if (positiveIds.length) {
    const shown = positiveIds.slice(0, 3);
    const extra = positiveIds.length - shown.length;
    let line = `<span class="wa-color-text-quiet wa-caption-s">Positively: </span>${shown.map(id => `<span class="wa-body-s">${id.replace(/-/g, ' ')}</span>`).join(', ')}`;
    if (extra > 0) line += ` <span class="wa-caption-s wa-color-text-quiet">+${extra} more</span>`;
    popLines.push(`<p>${line}</p>`);
  }
  if (negativeIds.length) {
    const shown = negativeIds.slice(0, 3);
    const extra = negativeIds.length - shown.length;
    let line = `<span class="wa-color-text-quiet wa-caption-s">Negatively: </span>${shown.map(id => `<span class="wa-body-s">${id.replace(/-/g, ' ')}</span>`).join(', ')}`;
    if (extra > 0) line += ` <span class="wa-caption-s wa-color-text-quiet">+${extra} more</span>`;
    popLines.push(`<p>${line}</p>`);
  }
  if (popLines.length) popsEl.innerHTML = popLines.join('');

  // Hide skeleton, show content
  document.getElementById('eo-skeleton').style.display = 'none';
  document.getElementById('eo-content').style.display = '';

  return {
    eoNumber: String(eo.executive_order_number),
    title: eo.title,
    presidentName: eo.president.name,
    signingDate: eo.signing_date,
    htmlUrl: eo.html_url,
    themes: eoThemes,
    populations: {
      positive: positiveIds.map(id => ({ id, name: id.replace(/-/g, ' ') })),
      negative: negativeIds.map(id => ({ id, name: id.replace(/-/g, ' ') })),
    },
  };
}

async function loadEoDetail() {
  const eoNumber = getEoNumber();
  if (!eoNumber) {
    showError('Invalid URL — no EO number found.');
    return;
  }

  try {
    const [eoRes, themesRes] = await Promise.all([
      fetch(`/api/eo/${eoNumber}`),
      fetch('/api/themes'),
    ]);

    if (eoRes.status === 404) {
      showError('Executive order not found.');
      return;
    }
    if (!eoRes.ok) {
      showError('Could not load this EO. Try refreshing.');
      return;
    }

    let eoData, themesData;
    try {
      eoData = await eoRes.json();
    } catch {
      showError('Could not load this EO. Try refreshing.');
      return;
    }
    try {
      themesData = await themesRes.json();
    } catch {
      themesData = { themes: [] };
    }

    const ctx = renderEoPage(eoData, themesData.themes || []);

    // Store on window for chat.js race-free init, then dispatch event
    window.__eoContext = ctx;
    document.dispatchEvent(new CustomEvent('eo-context-ready', { detail: ctx }));

  } catch (err) {
    console.error('Failed to load EO detail:', err);
    showError('Could not load this EO. Try refreshing.');
  }
}

document.addEventListener('DOMContentLoaded', loadEoDetail);
