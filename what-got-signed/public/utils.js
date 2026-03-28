// Shared utilities — loaded before app.js, detail.js, and chat.js
// via <script src="/utils.js"> in each view.

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

// Wrap president name mentions with styled span and avatar.
// Always run POST-sanitize — output is trusted HTML, not user content.
function wrapPresidentNames(text, fullName) {
  const pattern = getPresidentNamePattern(fullName);
  const presidentId = getPresidentId(fullName);
  const initials = fullName.split(' ').map(n => n[0]).join('');

  return text.replace(pattern, (match) => {
    return `<span class="president-name" data-president="${presidentId}"><wa-avatar name="${initials}" image="/avatars/${presidentId}.jpg" shape="rounded"></wa-avatar>${match}</span>`;
  });
}

// Link theme name mentions in text to /detail/theme/:id.
// themes: {id: string, name: string}[]
// Always run POST-sanitize — output is trusted HTML, not user content.
function linkThemeNames(text, themes) {
  for (const theme of themes) {
    const regex = new RegExp(`\\b${escapeRegex(theme.name.toLowerCase())}\\b`, 'gi');
    text = text.replace(regex,
      `<a href="/detail/theme/${theme.id}" class="wa-link">${theme.name.toLowerCase()}</a>`
    );
  }
  return text;
}
