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
          <p class="wa-body-m">${term.president_name} signed ${term.order_count} executive order${term.order_count !== 1 ? 's' : ''} from ${term.term_start} until ${termEnd}. The top themes ${themeVerb}: ${themeLinks}.</p>
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

// Fetch and render timeline
async function loadTimeline() {
  const container = document.getElementById('timeline-items');

  try {
    const response = await fetch('/api/timeline');
    const data = await response.json();

    // Sort descending (newest first) - flex-direction: row-reverse puts newest on the right
    const sortedPeriods = data.periods.sort((a, b) => {
      if (a.year !== b.year) return b.year - a.year;
      return b.month - a.month;
    });

    container.innerHTML = '<div class="timeline-line"></div>' + sortedPeriods.map(period => {
      // Make theme names in the summary clickable
      let summary = period.theme_summary;

      // Replace theme names with links using top_themes array
      for (const theme of period.top_themes || []) {
        const regex = new RegExp(`\\b${theme.name.toLowerCase()}\\b`, 'gi');
        summary = summary.replace(regex,
          `<a href="/detail?type=theme&theme=${encodeURIComponent(theme.id)}" class="wa-link">${theme.name.toLowerCase()}</a>`
        );
      }

      return `
        <div class="timeline-item">
          <div class="timeline-date wa-caption-s wa-color-text-quiet">${period.month_name} ${period.year}</div>
          <div class="timeline-dot"></div>
          <div class="timeline-content">
            <p class="wa-body-s">${summary}</p>
            <wa-button class="arrow-button" variant="brand" appearance="plain" href="/detail?type=month&year=${period.year}&month=${period.month}">
              <wa-icon name="arrow-right" label="View details"></wa-icon>
            </wa-button>
          </div>
        </div>
      `;
    }).join('');

    // Align timeline padding with content area and scroll to most recent
    alignTimeline();
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

  // Scroll to show most recent (rightmost)
  if (scrollContainer) {
    scrollContainer.scrollLeft = scrollContainer.scrollWidth;
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadTermSummaries();
  loadTimeline();
});

// Re-align on window resize
window.addEventListener('resize', alignTimeline);
