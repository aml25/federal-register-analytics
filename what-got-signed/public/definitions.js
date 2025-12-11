// Load and render themes
async function loadThemes() {
  const container = document.getElementById('themes-list');

  try {
    const response = await fetch('/api/themes');
    const data = await response.json();

    // Sort alphabetically by name
    const sorted = data.themes.sort((a, b) => a.name.localeCompare(b.name));

    container.innerHTML = sorted.map(theme => `
      <div class="definition-item">
        <div class="definition-name wa-font-weight-semibold">
          <a href="/detail?type=theme&theme=${encodeURIComponent(theme.id)}" class="wa-link">${theme.name}</a>
        </div>
        <div class="definition-description wa-body-s wa-color-text-quiet">${theme.description}</div>
      </div>
    `).join('');
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

    // Sort alphabetically by name
    const sorted = data.populations.sort((a, b) => a.name.localeCompare(b.name));

    container.innerHTML = sorted.map(pop => `
      <div class="definition-item">
        <div class="definition-name wa-font-weight-semibold">${pop.name}</div>
        <div class="definition-description wa-body-s wa-color-text-quiet">${pop.description}</div>
      </div>
    `).join('');
  } catch (err) {
    container.innerHTML = '<p>Failed to load populations.</p>';
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadThemes();
  loadPopulations();
});
