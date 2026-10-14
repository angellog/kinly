# Changelog

All notable changes to Project Kinly. Versions follow [semver](https://semver.org); the API's `/api/health` reports
the deployed commit as `version` and the package release as `release`.

## 0.2.2 — 2026-10-14

### Fixed
- **0.2.1's one-time reclassification moved 1,018 repositories, many of them wrongly.** A published store carries no
  README excerpts (by design, R6), so the server classified each repo on less text than the run that first filed it, and
  repos whose only signal was their README (for example `0xSero/litter`, an agent) fell to "other". The categories
  were restored from `angellog/kinly-data` with the import job. Reclassification after a rules change is now
  conservative: a repo moves only to a real category, never to "other", and only when the new category beats the current
  one by a full topic's weight (`RECLASSIFY_MARGIN`). Each heuristic business line is then realigned with its repo's
  category, rewriting only a line that is another category's template; summaries and model-written lines are never
  touched. `RULES_VERSION` 3 runs this once. Tests pin the README-less case, the narrow-margin case and the LLM case.

## 0.2.1 — 2026-10-14

Three bugs the Kinly agent found in its own first run (VAN-66), and the instructions that let it run at all.

### Fixed
- **Misfiled repositories stay misfiled (H13).** `bilawalsidhu/gods-eye-view`, a geospatial globe tagged `osint`,
  was filed under Security with that category's boilerplate business line. Geospatial and mapping signals now count
  towards Data & analytics. The daily run only reclassifies repos still in "other", so a better rule never reached a
  repo it had already misfiled: `RULES_VERSION` now makes the next boot (and daily) reclassify every rule-sourced repo
  once and rewrite the heuristic text of each repo that moved. Owner and LLM/curated categories are never touched.
- **Text cut mid-word (H14).** Tool output clipped business lines at 300 characters mid-word, which dropped the AGPL
  clause from `debpalash/VoiceStudio`. Clipping now ends on a whole sentence (or a whole word, marked "…"), the business
  line gets 500 characters, and the ingest sanitiser cuts on a word boundary too.
- **A cold start read as an outage (H15).** One failed request made the plugin report "Kinly API unreachable". Reads are
  retried once after 1.5 s; writes and timeouts never are (a lost reply to a write may mean it was applied).
- The Kinly agent could not find its tools. In a `claude_local` (ACP) run, Paperclip delivers only connected-app MCP
  tools to the session; plugin tools are reached over `POST /api/plugins/tools/execute` with the run's own agent key.
  `AGENTS.md` and the `kinly` skill now say so and carry a `kinly <tool> '<json>'` helper built only from the
  variables Paperclip sets for every run (verified against the live route). Found by the VAN-66 smoke test.

## 0.2.0 — 2026-10-14

Operating it: the agent can use its tools, the weekly report is always a whole week, and the setup is reproducible.

### Added
- `packages/paperclip-plugin/scripts/grant-kinly-tools.mjs`: keeps a "Kinly tools" access profile in every company
  that allows exactly the plugin's declared tools and assigns it to the plugin-managed Kinly agent only. Idempotent;
  `--check` reports access without writing. Tested.
- `/api/health` returns `release` (the package version) next to `version` (the deployed commit).
- `docs/PAPERCLIP.md`: why plugin tools are denied by default, the exact-name rule, and how to check an agent's access.
- `CHANGELOG.md`.

### Changed
- The worker resets the managed Kinly agent when its stored instructions differ from the shipped `AGENTS.md`. The
  host's reconcile never rewrites instructions, so after 0.1.0 every Kinly kept an older text (no read-only review
  rule, no "test logs are public" rule). A reset also restores the plugin's declared defaults, which drops the host's
  default `canCreateAgents` / `canCreateSkills` permissions: a researcher has no reason to hire agents.
  Agents pending board approval are left alone.

### Fixed
- A weekly report written while its week was still running (2026-W42, generated on its own Monday) was served as
  "the latest weekly". Weekly reports generated on or before the Sunday that ends their week are now dropped on boot
  and on import, so the latest weekly is always the last completed week.

### Verified in production
- First unattended daily with the GitHub token (2026-10-13): no degraded banner, 60 of 60 listed repositories enriched.
- The Kinly agent is allowed all eight `vantik.kinly:*` tools in VAN, FEE, GST and FEEA; every other agent is denied.

## 0.1.0 — 2026-10-12

First release: the engine (sources, enrichment, classifier, scorer, reports, CLI), the API and scheduler on Railway,
the `angellog/kinly-data` publishing split, and the Paperclip plugin `vantik.kinly` (console, eight agent tools,
managed Kinly agent and skill, daily brief). See `PLAN.md` for the design and its review.
