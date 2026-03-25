# TODOS

Items deferred from plan reviews and development sessions.

---

## P1 — High Priority

### [SEC-001] Sanitize LLM-generated content before innerHTML injection
**What:** Replace `innerHTML` injection of LLM narrative content with DOMPurify or textContent where HTML isn't needed.
**Why:** `narrative.summary` and `narrative.potential_impact` from OpenAI are injected via `innerHTML` in `detail.js` and `app.js` without sanitization. Confirmed via grep. Low probability but real XSS vector.
**Pros:** Eliminates a concrete security vulnerability.
**Cons:** DOMPurify adds a dependency; using `textContent` loses the `wrapPresidentNames` HTML styling.
**Context:** The `wrapPresidentNames()` function wraps president name strings in `<span>` tags for styling — this is why plain `textContent` won't work directly. Options: run DOMPurify allowlist on the output, or sanitize only the specific span injection pattern.
**Where to start:** `what-got-signed/public/detail.js` lines ~130, 194, 263 and `app.js`.
**Effort:** S (human: ~2h / CC: ~10min)
**Priority:** P1
**Depends on:** None

---

### [INFRA-001] Enable branch protection on `main` in GitHub Settings
**What:** Prevent force-push to `main` from CI (automated pipeline) or human error.
**Why:** The daily sync workflow commits directly to `main`. A misconfigured `git push --force` from CI would silently wipe commit history.
**Pros:** Protects against catastrophic data loss.
**Cons:** None — this is a GitHub UI toggle, not code.
**Context:** Do this BEFORE enabling the daily cron workflow. Go to GitHub repo → Settings → Branches → Add protection rule for `main`: check "Restrict force pushes".
**Effort:** S (5 minutes in GitHub UI)
**Priority:** P1
**Depends on:** None (do before enabling cron)

---

## P2 — Medium Priority

### [FEAT-001] Cross-administration comparison tool
**What:** A page where users pick 2+ presidents and a theme to see side-by-side EO counts, top orders, and a comparative LLM narrative.
**Why:** The unique differentiator of this site — anyone can look up a single EO, but head-to-head admin comparison is genuinely novel.
**Pros:** Sticky feature; data already exists; high user value.
**Cons:** Need to decide: pre-generate all combinations at build time (O(presidents² × themes) narratives) vs. on-demand LLM with caching (requires server-side state). This decision was deferred.
**Context:** The `what-got-signed/data/enriched/` files have president + theme tags for all EOs going back to Obama. The aggregation logic in `aggregate.ts` is the right starting point. Resolve the pre-generate vs. on-demand question before implementing.
**Effort:** M (human: ~1 week / CC: ~45min)
**Priority:** P2
**Depends on:** Automated pipeline (INFRA-002) ideally

---

### [FEAT-002] Personalization / "affects me" filter
**What:** A form where users pick their role (nurse, small business owner, veteran...) or concern and the site surfaces relevant EOs using the existing 158-population taxonomy.
**Why:** Directly fulfills "everyday impacts" vision. The population taxonomy already tags every EO by impacted group — this is mostly a UI feature on top of existing data.
**Pros:** High user value, low engineering cost (taxonomy already exists).
**Cons:** UX design needed for the population picker (158 populations needs grouping/search).
**Context:** Start with `what-got-signed/data/taxonomy.json` populations. The enriched EOs have `impacted_populations.positive_ids` and `negative_ids`. Filter UI could live on the existing timeline or as a new "find your EOs" page.
**Effort:** S–M (human: ~1 week / CC: ~30min)
**Priority:** P2
**Depends on:** None

---

### [TEST-001] Unit tests for aggregate utility functions
**What:** ~~A Vitest test suite for the new utility functions: `weekOf()`, `decadeTrends()`, `policyMomentum()`.~~ RESOLVED: Vitest added and tests written as part of the pipeline + time-scale views PR. See `src/__tests__/`.
**Priority:** DONE

---

### [FEAT-005] Policy momentum signal on /trends page
**What:** A visual indicator showing which themes are accelerating (more EOs than prior period) or decelerating. Displayed alongside the decade trend chart.
**Why:** Completes the "different time scales" vision — decade chart shows history, momentum shows direction. Answers "what's happening NOW vs the trend?"
**Pros:** High signal-to-noise for users who want to know what the current administration is prioritizing.
**Cons:** Definition needs to be settled: quarter-over-quarter delta (simpler, noisier) vs rolling 3-quarter slope (smoother, more complex to explain).
**Context:** Deferred from plan-eng-review 2026-03-18 because definition was ambiguous. The `decade-trends.json` data from the time-scale views PR provides the raw input — implement this after that PR ships.
**Effort:** S (human: ~2 days / CC: ~20min)
**Priority:** P2
**Depends on:** /trends page shipping (fully deferred as of design review 2026-03-18); decade-trends.json is generated as part of that work

---

## P3 — Future / Deferred

### [FEAT-003] Interactive LLM chat interface — DESIGN COMPLETE
**Status:** Design approved 2026-03-24. Architecture locked in eng review 2026-03-24.
**Design doc:** `~/.gstack/projects/aml25-federal-register-analytics/adamlaskowitz-main-design-20260324-221236.md`
**What was decided:**
- Standalone `/investigate` page (not sidebar) — 3-column workspace
- `/api/chat` POST endpoint on Express server; direct Federal Register API + enriched JSON (no MCP)
- OpenAI `gpt-4.1-mini`, full response (no streaming in v1), 10-turn cap
- Raw EO text via `html_url` with 3s AbortController timeout; HTML-stripped + 24,000-char truncation
- Findings: user-curated, localStorage persistence keyed by EO ID, clipboard export
- Rate limiting: `express-rate-limit` in-process for v1; Upstash upgrade path for v2
- `utils.js` shared module for `wrapPresidentNames()` + `linkThemeNames()` (CLAUDE.md compliance)
**Ready to implement** — close SEC-001 + INFRA-001 first, then follow Next Steps in design doc.
**Effort:** L (human: ~3 weeks / CC: ~2h)
**Priority:** P2 (promoted — design complete, ready to build)

---

### [FEAT-006] Related EOs in /api/chat — theme-index.json build step
**What:** Add `data/aggregated/theme-index.json` generation to `aggregate.ts` (maps `themeId → [eoNumbers]`). Use it in `/api/chat` to include top 3 related EOs by theme overlap in the system prompt.
**Why:** v1 dropped related EOs because `timeline.json` doesn't have per-EO theme data. This is the correct data structure to fix that gap.
**Pros:** Enriches the chat context; enables smarter suggested prompts. Index is small (one file), fast to query.
**Cons:** Adds a build step. Not needed for the core v1 chat experience.
**Context:** Discovered during eng review 2026-03-24 — `timeline.json` is a quarterly aggregate, not a per-EO theme index. The enriched files have `enrichment.theme_ids` but scanning all of them on every chat request is too slow.
**Effort:** S (human: ~2h / CC: ~15min)
**Priority:** P3
**Depends on:** FEAT-003 (investigate feature) shipped

---

### [FEAT-007] Shareable investigation URLs via Upstash KV
**What:** POST `/api/investigation/save` stores the markdown findings report, returns a short ID. URL: `/investigation/{id}`. Same Upstash Redis service as the FEAT-003 v2 rate limiting upgrade.
**Why:** Copy-to-clipboard is an export, not a share. Shareable URLs let users send their investigation to others.
**Pros:** Completes the "keep or share" promise from the product vision. Low implementation cost once Upstash is added for rate limiting.
**Cons:** Requires Upstash Redis free tier. Stored payload is the markdown report, not the conversation.
**Context:** Explicitly deferred from FEAT-003 v1. Adding Upstash for rate limiting first reduces the marginal cost of this feature.
**Effort:** S (human: ~3h / CC: ~20min)
**Priority:** P3
**Depends on:** FEAT-003 (investigate feature) shipped; Upstash added for rate limiting

---

### [FEAT-004] Email/theme subscription system
**What:** Users subscribe to a theme and receive weekly email digests of new EOs with plain-language summaries.
**Why:** Converts the site from pull to push; dramatically improves retention.
**Cons:** Requires user identity infrastructure (no DB in current stack). Email addresses cannot go in git.
**Context:** Deferred because it requires choosing a DB or managed email service (Buttondown, ConvertKit, etc.) and introduces user identity complexity the team isn't ready for.
**Effort:** M (human: ~1 week / CC: ~30min)
**Priority:** P3
**Depends on:** Decision on data storage / user identity infrastructure
