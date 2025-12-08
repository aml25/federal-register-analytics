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
        <div class="definition-name">
          <a href="/detail.html?type=theme&theme=${encodeURIComponent(theme.id)}" class="theme-link">${theme.name}</a>
        </div>
        <div class="definition-description">${theme.description}</div>
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
        <div class="definition-name">${pop.name}</div>
        <div class="definition-description">${pop.description}</div>
      </div>
    `).join('');
  } catch (err) {
    container.innerHTML = '<p>Failed to load populations.</p>';
  }
}

// Tab switching
function setupTabs() {
  const tabs = document.querySelectorAll('.tab');
  const themesDescription = document.getElementById('themes-description');
  const populationsDescription = document.getElementById('populations-description');
  const themesList = document.getElementById('themes-list');
  const populationsList = document.getElementById('populations-list');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      // Update active tab
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      // Show/hide content
      const selected = tab.dataset.tab;
      if (selected === 'themes') {
        themesDescription.style.display = 'block';
        populationsDescription.style.display = 'none';
        themesList.style.display = 'flex';
        populationsList.style.display = 'none';
      } else {
        themesDescription.style.display = 'none';
        populationsDescription.style.display = 'block';
        themesList.style.display = 'none';
        populationsList.style.display = 'flex';
      }
    });
  });
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadThemes();
  loadPopulations();
  setupTabs();
});
