# Changelog

All notable changes to Project Kinly. Versions follow [semver](https://semver.org); the API's `/api/health` reports
the deployed commit as `version` and the package release as `release`.

## Unreleased

### Fixed
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
