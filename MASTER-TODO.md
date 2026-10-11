# Project Kinly — Master To-Do

Loop rule: every item below must be ticked `[x]` before the loop stops. An item is ticked only when it is done and verified, never when it is "planned". Human-only items are marked **(Angelo)** and are ticked when the evidence of the human step exists, or moved to the hand-off list at the bottom with the exact command/link.

## A. Plan and research
- [x] A1 Read vault context, existing Paperclip plugins, SDK surface, Railway access, GitHub auth
- [x] A2 Export Angelo's 206 stars with timestamps to `data/raw/stars.json`
- [x] A3 Write `PLAN.md` (architecture, decisions, risks)
- [ ] A4 Deep-research workflow complete: 8 topics researched, claims verified, report at `research/reports/`
- [x] A5 Adversarial plan review (eng / risk / devex panel) run and findings folded into `PLAN.md` with a `## GSTACK REVIEW REPORT`

## B. Engine (`packages/engine`)
- [x] B1 Monorepo scaffold: workspaces, tsconfig, eslint-free strict TS, `npm test` runs node:test, CI workflow
- [x] B2 Store: SQLite schema + migrations + typed queries (`node:sqlite`), import/export to `data/`
- [x] B3 Sources: `trending-page` parser with committed fixture; `larsbijl-archive`; `vitalets-archive`; `gh-search-new`; `stars`
- [ ] B4 GitHub client: REST + GraphQL, rate-limit pacing, keyless fallback, enrichment incl. licence class + open-core detection
- [x] B5 Classifier: 16 categories, rule tables, tests on ≥ 40 real repos; LLM refinement hook
- [x] B6 Scorer: relevance profile from stars + `data/user/profile.json`; Kinly score; verdict; tests
- [x] B7 Reports: daily, weekly, landscape, resource page renderers; deterministic output; tests
- [x] B8 LLM module (Anthropic, `claude-opus-5-5` default per the claude-api skill — override with `KINLY_LLM_MODEL`; cached by README hash, daily token cap, keyless-safe)
- [ ] B9 CLI `kinly`: `collect | backfill | enrich | classify | score | report | stars | import | export | research | resource | serve`

## C. Data and reports (the research product)
- [ ] C1 Backfill 2025-04-01 → 2026-10-08 from the archives; snapshots committed under `data/snapshots/`
- [ ] C2 Enrich every backfilled repo (local, authenticated); `data/repos/*.json` committed
- [ ] C3 Classify + score all; sanity-check category distribution by hand on the top 100
- [ ] C4 `reports/landscape-2025-04-to-2026-10.md` generated and merged with the research report's narrative
- [ ] C5 First real `reports/daily/2026-10-08.md` and `reports/weekly/2026-W41.md` generated from live data
- [ ] C6 Stars folded in: `data/user/profile.json` derived; "My stars" overlap in reports

## D. Server and Railway
- [x] D1 HTTP API per PLAN §3.8 with bearer auth on writes; tests
- [x] D2 Scheduler (cron matcher, UTC) + `runs` ledger + `/api/status`
- [x] D3 Boot import from the public repo when the DB is empty
- [x] D4 Repo sync (Contents / Git Data API) behind `GITHUB_TOKEN`; no-op without it
- [x] D5 Dockerfile + `.env.example` (no `railway.toml` — deprecated for new services); local Docker-free smoke run of the built server
- [ ] D6 Railway project `kinly` + service + 1 GB volume at `/data` + public domain; variables set without printing values; healthcheck + watch patterns set via MCP `update-service`, and a docs-only commit verified SKIPPED in `list-deployments`
- [ ] D7 Deployed service answers `/api/health` and `/api/trending?window=today` with real rows

## E. Paperclip plugin (`packages/paperclip-plugin`, id `vantik.kinly`)
- [x] E1 Manifest (capabilities, config schema, tools, jobs, managed agent, managed skill, UI slots) validated against the host schema
- [ ] E2 Worker: data handlers, actions, 8 agent tools, daily-brief job, managed agent/skill reconcile for every enabled company
- [ ] E3 UI: page with 8 tabs, sidebar link, dashboard widget, Vantik Signal styling, real decision buttons
- [x] E4 `AGENTS.md` for the Kinly agent (persona, tool usage, clone → test → rate → resource protocol)
- [x] E5 Tests (config, tool handlers against a fake API, brief idempotency); `npm run check` green
- [ ] E6 Installed on this instance (`paperclipai plugin install`), config set for all four companies, page renders at `/VAN/kinly`

## F. Public repo and docs
- [x] F1 `git init`, `.gitignore`, MIT LICENSE, first commit
- [ ] F2 `gh repo create angellog/kinly --public --source . --push` and `angellog/kinly-data` (public) seeded with data/, reports/, resources/
- [ ] F3 Railway service connected to the GitHub repo (deploy on push)
- [x] F4 README (what Kinly is, quick start, architecture, how to read a report, how to rate)
- [x] F5 docs/: ARCHITECTURE, API, CATEGORIES, SCORING, PAPERCLIP, RAILWAY, WORKFLOW
- [ ] F6 CI green on `main`

## R. Review changes (PLAN.md `## GSTACK REVIEW REPORT`)
- [x] R-a Split data from code: `KINLY_DATA_ROOT` (data/, reports/, resources/) → `~/Projects/kinly-data` locally, `/data/repo` on Railway; `KINLY_DATA_REPO=angellog/kinly-data`; `publish` refuses the `gh` token without `--use-gh-token` (R1, D5)
- [x] R-b Export never writes `readme_excerpt`; larsbijl snapshots ship its MIT notice; vitalets stays local (R6)
- [x] R-c Ingest sanitizer: strip HTML/control chars, cap lengths; test with `<img onerror>` + injected instruction (R2, D15)
- [x] R-d Picks: suppress starred / shortlisted / picked-in-30-days, relevance ≥ 50 and score ≥ 45, novelty term, WIP limit 5; category weights seeded from stars; daily shows only weighted categories (P-M1, P-M2, D14)
- [ ] R-e Stargazers history (`/repos/{o}/{r}/stargazers/history`) for today's lists + landscape top 50; velocity from it, snapshot-diff fallback (D13)
- [x] R-f Stall detection in collect + persistence per source + coverage stated in the landscape header (E-M4b, P-M3)
- [x] R-g Reports print `enriched N of M` with a degraded banner < 50%, plus credential states in the footer (E-B1, R8)
- [x] R-h Rename handling: canonical `nameWithOwner` from enrichment re-points history in one transaction (E-m1)
- [x] R-i Ratings split owner/agent; only owner rating moves status to `rated`; resource page has the test-log section (P-M5, D16)
- [x] R-j Language list capped at 10 + all, with a test; backoff on 429/5xx (R7)

## G. Verification and hand-off
- [ ] G1 Final code-review workflow (correctness + security + cost lenses) and findings fixed
- [ ] G2 End-to-end: Paperclip page → Railway API → rate a repo → resource page appears in the repo
- [ ] G3 Obsidian: `Projects/kinly.md`, daily note, `Ongoing.md`, decision note
- [ ] G4 Memory file for Kinly written
- [ ] G5 Hand-off message with the exact human steps

## Hand-off list (Angelo)
- **(Angelo)** Mint a fine-grained GitHub PAT (public repos: read; `angellog/kinly-data` only: Contents read/write — never `angellog/kinly`) and set it on Railway as `GITHUB_TOKEN`
- **(Angelo)** Mint a Kinly-only Anthropic key in its own Console workspace with a monthly spend limit and set it on Railway as `ANTHROPIC_API_KEY`
- **(Angelo)** In Paperclip, allow `vantik.kinly:*` tools for the agents that should use them; resume the Kinly agent in the companies where it should work
