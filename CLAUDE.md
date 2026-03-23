# CLAUDE.md — whatgotsigned.com project conventions

## Standing rules for all new features

### President name styling
Every president name that appears in user-visible text **must** be wrapped with the
`wrapPresidentNames(text, fullName)` function (defined in `what-got-signed/public/app.js`).
This applies to all narrative text, summaries, and labels rendered on the frontend.
The function adds the president's avatar and bold styling automatically.

Do not render a president's name as plain text anywhere on the site.

### Theme name links
Every theme name that appears in user-visible narrative or summary text **must** be
converted to a clickable link pointing to `/detail/theme/{themeId}` using the `wa-link`
class. This applies to all LLM-generated prose and aggregated summaries rendered on
the frontend.

Use the pattern from `renderTimelinePeriod` in `app.js` as the reference implementation:
```js
const regex = new RegExp(`\\b${escapeRegex(theme.name.toLowerCase())}\\b`, 'gi');
text = text.replace(regex,
  `<a href="/detail/theme/${theme.id}" class="wa-link">${theme.name.toLowerCase()}</a>`
);
```

Themes must be passed from the data layer (e.g., `top_themes` in the weekly narrative,
`top_themes` in timeline periods) — do not fetch them separately unless necessary.
