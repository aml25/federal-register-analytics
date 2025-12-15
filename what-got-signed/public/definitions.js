// Group items by category
function groupByCategory(items) {
  const groups = new Map();

  for (const item of items) {
    const category = item.category;
    if (!groups.has(category)) {
      groups.set(category, []);
    }
    groups.get(category).push(item);
  }

  // Sort items within each category alphabetically
  for (const items of groups.values()) {
    items.sort((a, b) => a.name.localeCompare(b.name));
  }

  return groups;
}

// Render a single item with optional definition
function renderItem(item, isTheme = false) {
  const nameHtml = isTheme
    ? `<a href="/detail?type=theme&theme=${encodeURIComponent(item.id)}" class="wa-link">${item.name}</a>`
    : item.name;

  const definitionHtml = item.definition
    ? `<div class="definition-text wa-body-s">${item.definition}</div>`
    : '';

  return `
    <div class="definition-item">
      <div class="definition-name wa-font-weight-semibold">${nameHtml}</div>
      ${definitionHtml}
    </div>
  `;
}

// Render grouped items with category headers
function renderGroupedItems(groups, isTheme = false) {
  const html = [];

  // Sort categories alphabetically
  const sortedCategories = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  for (const [category, items] of sortedCategories) {
    html.push(`
      <div class="definition-category">
        <h3 class="definition-category-header wa-font-weight-semibold">${category}</h3>
        <div class="definition-category-items">
          ${items.map(item => renderItem(item, isTheme)).join('')}
        </div>
      </div>
    `);
  }

  return html.join('');
}

// Load and render themes
async function loadThemes() {
  const container = document.getElementById('themes-list');

  try {
    const response = await fetch('/api/themes');
    const data = await response.json();

    // Group by category
    const groups = groupByCategory(data.themes);

    container.innerHTML = renderGroupedItems(groups, true);
  } catch (err) {
    container.innerHTML = '<p>Failed to load themes.</p>';
  }
}

// Load and render populations
async function loadPopulations() {
  const container = document.getElementById('populations-list');

  try {
    const response = await fetch('/api/populations');
    const data = await response.json();

    // Group by category
    const groups = groupByCategory(data.populations);

    container.innerHTML = renderGroupedItems(groups, false);
  } catch (err) {
    container.innerHTML = '<p>Failed to load populations.</p>';
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadThemes();
  loadPopulations();
});
