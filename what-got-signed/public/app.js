// Escape special regex characters
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Render themes as clickable links
function renderThemeLinks(themes) {
  return themes.map(t =>
    `<a href="/detail?type=theme&theme=${encodeURIComponent(t.id)}" class="wa-link">${t.name.toLowerCase()}</a>`
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

      return `
        <div class="term-summary">
          <p class="wa-body-m"><span class="wa-font-weight-semibold">${term.president_name}</span> signed ${term.order_count} executive order${term.order_count !== 1 ? 's' : ''} from ${term.term_start} until ${termEnd}. The top themes ${themeVerb}: ${themeLinks}.</p>
          <wa-button class="arrow-button" variant="brand" appearance="plain" href="/detail?type=term&president=${term.president_id}&start=${term.term_start}">
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

  // Style president name with semibold
  if (period.president_name) {
    const presidentRegex = new RegExp(escapeRegex(period.president_name), 'g');
    summary = summary.replace(presidentRegex,
      `<span class="wa-font-weight-semibold">${period.president_name}</span>`
    );
  }

  // Replace theme names with links using top_themes array
  for (const theme of period.top_themes || []) {
    const regex = new RegExp(`\\b${theme.name.toLowerCase()}\\b`, 'gi');
    summary = summary.replace(regex,
      `<a href="/detail?type=theme&theme=${encodeURIComponent(theme.id)}" class="wa-link">${theme.name.toLowerCase()}</a>`
    );
  }

  return `
    <div class="timeline-item">
      <div class="timeline-date wa-caption-s wa-color-text-quiet">${period.quarter_name}</div>
      <div class="timeline-dot"></div>
      <div class="timeline-content">
        <p class="wa-body-s">${summary}</p>
        <wa-button class="arrow-button" variant="brand" appearance="plain" href="/detail?type=quarter&year=${period.year}&quarter=${period.quarter}">
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

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadTermSummaries();
  loadTimeline();
});

// Re-align on window resize
window.addEventListener('resize', alignTimeline);
