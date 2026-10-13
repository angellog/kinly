# Changelog

All notable changes to Project Kinly. Versions follow [semver](https://semver.org); the API's `/api/health` reports
the deployed commit as `version` and the package release as `release`.

## 0.2.0 — 2026-10-14

Operating it: the agent can use its tools, the weekly report is always a whole week, and the setup is reproducible.

### Added
- `packages/paperclip-plugin/scripts/grant-kinly-tools.mjs`: keeps a "Kinly tools" access profile in every company
  that allows exactly the plugin's declared tools and assigns it to the plugin-managed Kinly agent only. Idempotent;
  `--check` reports access without writing. Tested.
- `/api/health` returns `release` (the package version) next to `version` (the deployed commit).
- `docs/PAPERCLIP.md`: why plugin tools are denied by default, the exact-name rule, and how to check an agent's access.
- `CHANGELOG.md`.

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
