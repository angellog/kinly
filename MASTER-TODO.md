# Project Kinly — Master To-Do

Loop rule: every item below must be ticked `[x]` before the loop stops. An item is ticked only when it is done and verified, never when it is "planned". Human-only items are marked **(Angelo)** and are ticked when the evidence of the human step exists, or moved to the hand-off list at the bottom with the exact command/link.

## A. Plan and research
- [x] A1 Read vault context, existing Paperclip plugins, SDK surface, Railway access, GitHub auth
- [x] A2 Export Angelo's 206 stars with timestamps to `data/raw/stars.json`
- [x] A3 Write `PLAN.md` (architecture, decisions, risks)
- [ ] A4 Deep-research workflow complete: 8 topics researched, claims verified, report at `research/reports/`
- [ ] A5 Adversarial plan review (eng / risk / devex panel) run and findings folded into `PLAN.md` with a `## GSTACK REVIEW REPORT`

## B. Engine (`packages/engine`)
- [ ] B1 Monorepo scaffold: workspaces, tsconfig, eslint-free strict TS, `npm test` runs node:test, CI workflow
- [ ] B2 Store: SQLite schema + migrations + typed queries (`node:sqlite`), import/export to `data/`
- [ ] B3 Sources: `trending-page` parser with committed fixture; `larsbijl-archive`; `vitalets-archive`; `gh-search-new`; `stars`
- [ ] B4 GitHub client: REST + GraphQL, rate-limit pacing, keyless fallback, enrichment incl. licence class + open-core detection
- [ ] B5 Classifier: 16 categories, rule tables, tests on ≥ 40 real repos; LLM refinement hook
- [ ] B6 Scorer: relevance profile from stars + `data/user/profile.json`; Kinly score; verdict; tests
- [ ] B7 Reports: daily, weekly, landscape, resource page renderers; deterministic output; tests
- [ ] B8 LLM module (Anthropic, Sonnet 5.5 default, cached, capped, keyless-safe)
- [ ] B9 CLI `kinly`: `collect | backfill | enrich | classify | score | report | stars | import | export | research | resource | serve`

## C. Data and reports (the research product)
- [ ] C1 Backfill 2025-04-01 → 2026-10-08 from the archives; snapshots committed under `data/snapshots/`
- [ ] C2 Enrich every backfilled repo (local, authenticated); `data/repos/*.json` committed
- [ ] C3 Classify + score all; sanity-check category distribution by hand on the top 100
- [ ] C4 `reports/landscape-2025-04-to-2026-10.md` generated and merged with the research report's narrative
- [ ] C5 First real `reports/daily/2026-10-08.md` and `reports/weekly/2026-W41.md` generated from live data
- [ ] C6 Stars folded in: `data/user/profile.json` derived; "My stars" overlap in reports

## D. Server and Railway
- [ ] D1 HTTP API per PLAN §3.8 with bearer auth on writes; tests
- [ ] D2 Scheduler (cron matcher, UTC) + `runs` ledger + `/api/status`
- [ ] D3 Boot import from the public repo when the DB is empty
- [ ] D4 Repo sync (Contents / Git Data API) behind `GITHUB_TOKEN`; no-op without it
- [ ] D5 Dockerfile + `railway.toml` + `.env.example`; local Docker-free smoke run of the built server
- [ ] D6 Railway project `kinly` + service + 1 GB volume at `/data` + public domain; variables set without printing values
- [ ] D7 Deployed service answers `/api/health` and `/api/trending?window=today` with real rows

## E. Paperclip plugin (`packages/paperclip-plugin`, id `vantik.kinly`)
- [ ] E1 Manifest (capabilities, config schema, tools, jobs, managed agent, managed skill, UI slots) validated against the host schema
- [ ] E2 Worker: data handlers, actions, 8 agent tools, daily-brief job, managed agent/skill reconcile for every enabled company
- [ ] E3 UI: page with 8 tabs, sidebar link, dashboard widget, Vantik Signal styling, real decision buttons
- [ ] E4 `AGENTS.md` for the Kinly agent (persona, tool usage, clone → test → rate → resource protocol)
- [ ] E5 Tests (config, tool handlers against a fake API, brief idempotency); `npm run check` green
- [ ] E6 Installed on this instance (`paperclipai plugin install`), config set for all four companies, page renders at `/VAN/kinly`

## F. Public repo and docs
- [ ] F1 `git init`, `.gitignore`, MIT LICENSE, first commit
- [ ] F2 `gh repo create angellog/kinly --public --source . --push`
- [ ] F3 Railway service connected to the GitHub repo (deploy on push)
- [ ] F4 README (what Kinly is, quick start, architecture, how to read a report, how to rate)
- [ ] F5 docs/: ARCHITECTURE, API, CATEGORIES, SCORING, PAPERCLIP, RAILWAY, WORKFLOW
- [ ] F6 CI green on `main`

## G. Verification and hand-off
- [ ] G1 Final code-review workflow (correctness + security + cost lenses) and findings fixed
- [ ] G2 End-to-end: Paperclip page → Railway API → rate a repo → resource page appears in the repo
- [ ] G3 Obsidian: `Projects/kinly.md`, daily note, `Ongoing.md`, decision note
- [ ] G4 Memory file for Kinly written
- [ ] G5 Hand-off message with the exact human steps

## Hand-off list (Angelo)
- **(Angelo)** Mint a fine-grained GitHub PAT (public repos: read; `angellog/kinly`: Contents read/write) and set it on Railway as `GITHUB_TOKEN`
- **(Angelo)** Decide whether the Anthropic key from another project stays on Railway (set by the build, see D6 notes)
- **(Angelo)** In Paperclip, allow `vantik.kinly:*` tools for the agents that should use them; resume the Kinly agent in the companies where it should work
