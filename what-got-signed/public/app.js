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

// Render themes as clickable links
function renderThemeLinks(themes) {
  return themes.map(t =>
    `<a href="/detail/theme/${t.id}" class="wa-link">${t.name.toLowerCase()}</a>`
  ).join(', ');
}

// Fetch and render term summaries
async function loadTermSummaries() {
  const container = document.getElementById('term-summaries');

  try {
    const response = await fetch('/api/term-summaries');
    const data = await response.json();

    container.innerHTML = data.summaries.map(term => {
      const termEnd = term.term_end === 'present' ? 'present' : term.term_end;
      const themeVerb = term.term_end === 'present' ? 'have been' : 'were';
      const themeLinks = renderThemeLinks(term.top_themes);
      const styledName = wrapPresidentNames(term.president_name, term.president_name);

      return `
        <div class="term-summary">
          <p class="wa-body-m">${styledName} signed ${term.order_count} executive order${term.order_count !== 1 ? 's' : ''} from ${term.term_start} until ${termEnd}. The top themes ${themeVerb}: ${themeLinks}.</p>
          <wa-button class="arrow-button" variant="brand" appearance="plain" href="/detail/term/${term.president_id}/${term.term_start}">
            <wa-icon name="arrow-right" label="View details"></wa-icon>
          </wa-button>
        </div>
      `;
    }).join('');
  } catch (err) {
    container.innerHTML = '<p>Failed to load term summaries.</p>';
  }
}

// Store timeline data globally for filtering
let timelineData = [];

// Render a single timeline period
function renderTimelinePeriod(period) {
  // Make theme names in the summary clickable
  let summary = period.theme_summary;

  // Style president names with avatars (handle multiple presidents separated by " and ")
  if (period.president_name) {
    const presidentNames = period.president_name.split(' and ');
    for (const name of presidentNames) {
      summary = wrapPresidentNames(summary, name.trim());
    }
  }

  // Replace theme names with links using top_themes array
  for (const theme of period.top_themes || []) {
    const regex = new RegExp(`\\b${theme.name.toLowerCase()}\\b`, 'gi');
    summary = summary.replace(regex,
      `<a href="/detail/theme/${theme.id}" class="wa-link">${theme.name.toLowerCase()}</a>`
    );
  }

  return `
    <div class="timeline-item">
      <div class="timeline-date wa-caption-s wa-color-text-quiet">${period.quarter_name}</div>
      <div class="timeline-dot"></div>
      <div class="timeline-content">
        <p class="wa-body-s">${summary}</p>
        <wa-button class="arrow-button" variant="brand" appearance="plain" href="/detail/quarter/${period.year}/${period.quarter}">
          <wa-icon name="arrow-right" label="View details"></wa-icon>
        </wa-button>
      </div>
    </div>
  `;
}

// Render timeline with optional filter
function renderTimeline(periods) {
  const container = document.getElementById('timeline-items');
  container.innerHTML = '<div class="timeline-line"></div>' + periods.map(renderTimelinePeriod).join('');
  alignTimeline();
}

// Populate filter options from timeline data
function populateTimelineFilter(periods) {
  const filter = document.getElementById('timeline-filter');
  if (!filter) return;

  // Get unique years sorted descending (newest first)
  const years = [...new Set(periods.map(p => p.year))].sort((a, b) => b - a);

  // Create options for each year
  filter.innerHTML = years.map(year =>
    `<wa-option value="${year}">${year}</wa-option>`
  ).join('');
}

// Handle filter changes
function setupTimelineFilter() {
  const filter = document.getElementById('timeline-filter');
  if (!filter) return;

  filter.addEventListener('change', () => {
    const selectedValues = filter.value || [];

    if (selectedValues.length === 0) {
      // No selection = show all
      renderTimeline(timelineData);
    } else {
      // Filter to selected years
      const selectedYears = selectedValues.map(v => parseInt(v, 10));
      const filtered = timelineData.filter(period =>
        selectedYears.includes(period.year)
      );
      renderTimeline(filtered);
    }
  });
}

// Fetch and render timeline
async function loadTimeline() {
  const container = document.getElementById('timeline-items');

  try {
    const response = await fetch('/api/timeline');
    const data = await response.json();

    // Sort descending (newest first) - flex-direction: row-reverse puts newest on the right
    timelineData = data.periods.sort((a, b) => {
      if (a.year !== b.year) return b.year - a.year;
      return b.quarter - a.quarter;
    });

    // Populate filter options
    populateTimelineFilter(timelineData);

    // Setup filter event handler
    setupTimelineFilter();

    // Render all periods initially
    renderTimeline(timelineData);
  } catch (err) {
    container.innerHTML = '<p>Failed to load timeline.</p>';
  }
}

// Align timeline with content area
function alignTimeline() {
  const content = document.querySelector('.content');
  const timelineItems = document.querySelector('.timeline-items');
  const scrollContainer = document.querySelector('.timeline-scroll');

  if (content && timelineItems) {
    const contentRect = content.getBoundingClientRect();
    const contentPadding = 24; // matches --content-padding in CSS
    // Add content padding to align with actual text, not container edge
    const paddingLeft = contentRect.left + contentPadding;
    const paddingRight = window.innerWidth - contentRect.right + contentPadding;

    timelineItems.style.paddingLeft = `${paddingLeft}px`;
    timelineItems.style.paddingRight = `${paddingRight}px`;
  }

}

// Fetch and render weekly digest
async function loadWeeklyDigest() {
  const section = document.getElementById('this-week-section');
  const container = document.getElementById('this-week-content');

  try {
    const response = await fetch('/api/weekly-narrative');

    if (!response.ok) {
      // weekly-narrative.json not yet generated — hide the section silently
      section.style.display = 'none';
      return;
    }

    const data = await response.json();
    section.removeAttribute('aria-busy');

    // Empty week
    if (!data.narrative && data.orders.length === 0) {
      container.innerHTML = `
        <p class="wa-heading-xs this-week-date">${data.date_range}</p>
        <p class="wa-body-m">A quiet week — no executive orders were signed.</p>
      `;
      return;
    }

    // Style president names with avatars in narrative prose
    let narrative = data.narrative;
    const presidentNames = [...new Set(
      (data.orders || []).map(o => o.president_name).filter(Boolean)
    )];
    for (const name of presidentNames) {
      narrative = wrapPresidentNames(narrative, name);
    }

    // Replace theme names with links (same pattern as timeline)
    for (const theme of data.top_themes || []) {
      const regex = new RegExp(`\\b${escapeRegex(theme.name.toLowerCase())}\\b`, 'gi');
      narrative = narrative.replace(regex,
        `<a href="/detail/theme/${theme.id}" class="wa-link">${theme.name.toLowerCase()}</a>`
      );
    }

    // EO list as plain links, not buttons
    const orderListHtml = data.orders.map(o =>
      `<li><a href="${o.url}" class="wa-link" target="_blank" rel="noopener">EO ${o.number} — ${o.title}</a></li>`
    ).join('');

    container.innerHTML = `
      <p class="wa-heading-l this-week-date" aria-label="Week of ${data.date_range}">${data.date_range}</p>
      <p class="wa-body-m" id="weekly-narrative">${narrative}</p>
      <div class="weekly-eos">
        <p class="wa-body-s wa-color-text-quiet">Executive orders this week</p>
        <ul class="weekly-orders">${orderListHtml}</ul>
      </div>
    `;
  } catch (err) {
    section.removeAttribute('aria-busy');
    container.innerHTML = `
      <wa-callout variant="warning">
        <wa-icon slot="icon" name="circle-exclamation"></wa-icon>
        Couldn't load this week's summary. Check back soon.
      </wa-callout>
    `;
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadWeeklyDigest();
  loadTermSummaries();
  loadTimeline();
});

// Re-align on window resize
window.addEventListener('resize', alignTimeline);
