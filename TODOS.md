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

### [FEAT-003] Interactive LLM chat interface
**What:** A context-aware conversational interface where users ask questions about EOs in natural language and get sourced answers.
**Why:** Core "help people understand" feature from the product vision. Currently all LLM use is at build time; this adds query-time AI. "Get inspired by static, dig in with chat" is the product vision.
**Pros:** Highest single-feature user value; makes the site feel like a tool, not a browser.
**Cons:** Significant product decision — moderation, cost, abuse vectors, UX.
**Architecture (decided in advisory session 2026-03-17):**
- **Retrieval**: Use pipeline theme/population tags + title search to find relevant EOs for a user's query
- **Generation**: Send raw EO text (via `raw_text_url`) to the LLM — NOT the pipeline's LLM-generated summaries (bypasses pipeline quality issues)
- **Context-aware**: Chat widget is pre-loaded with page context (which EO/theme/president the user is viewing)
- **Backend candidate**: `federal-register-mcp` (https://github.com/aml25/federal-register-mcp) already exposes Federal Register data via MCP — could serve as the data layer, avoiding duplication
- **NOT needed**: Vector embeddings or semantic search for v1; theme tag retrieval is sufficient to start
**Effort:** L (human: ~3 weeks / CC: ~2h)
**Priority:** P3
**Depends on:** Traffic data to understand what users actually ask; ideally some user research first

---

### [FEAT-004] Email/theme subscription system
**What:** Users subscribe to a theme and receive weekly email digests of new EOs with plain-language summaries.
**Why:** Converts the site from pull to push; dramatically improves retention.
**Cons:** Requires user identity infrastructure (no DB in current stack). Email addresses cannot go in git.
**Context:** Deferred because it requires choosing a DB or managed email service (Buttondown, ConvertKit, etc.) and introduces user identity complexity the team isn't ready for.
**Effort:** M (human: ~1 week / CC: ~30min)
**Priority:** P3
**Depends on:** Decision on data storage / user identity infrastructure
