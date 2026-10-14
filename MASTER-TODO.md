# Project Kinly — Master To-Do

Loop rule: every item below must be ticked `[x]` before the loop stops. An item is ticked only when it is done and verified, never when it is "planned". Human-only items are marked **(Angelo)** and are ticked when the evidence of the human step exists, or moved to the hand-off list at the bottom with the exact command/link.

## A. Plan and research
- [x] A1 Read vault context, existing Paperclip plugins, SDK surface, Railway access, GitHub auth
- [x] A2 Export Angelo's 206 stars with timestamps to `data/raw/stars.json`
- [x] A3 Write `PLAN.md` (architecture, decisions, risks)
- [x] A4 Deep-research workflow complete: 8 topics researched, claims verified, report at `research/reports/`
- [x] A5 Adversarial plan review (eng / risk / devex panel) run and findings folded into `PLAN.md` with a `## GSTACK REVIEW REPORT`

## B. Engine (`packages/engine`)
- [x] B1 Monorepo scaffold: workspaces, tsconfig, eslint-free strict TS, `npm test` runs node:test, CI workflow
- [x] B2 Store: SQLite schema + migrations + typed queries (`node:sqlite`), import/export to `data/`
- [x] B3 Sources: `trending-page` parser with committed fixture; `larsbijl-archive`; `vitalets-archive`; `gh-search-new`; `stars`
- [x] B4 GitHub client: REST + GraphQL, rate-limit pacing, keyless fallback, enrichment incl. licence class + open-core detection
- [x] B5 Classifier: 16 categories, rule tables, tests on ≥ 40 real repos; LLM refinement hook
- [x] B6 Scorer: relevance profile from stars + `data/user/profile.json`; Kinly score; verdict; tests
- [x] B7 Reports: daily, weekly, landscape, resource page renderers; deterministic output; tests
- [x] B8 LLM module (Anthropic, `claude-opus-5-5` default per the claude-api skill — override with `KINLY_LLM_MODEL`; cached by README hash, daily token cap, keyless-safe)
- [x] B9 CLI `kinly`: `collect | backfill | enrich | classify | score | report | stars | import | export | research | resource | serve`

## C. Data and reports (the research product)
- [x] C1 Backfill 2025-04-01 → 2026-10-08 from the archives; snapshots committed under `data/snapshots/`
- [x] C2 Enrich every backfilled repo (local, authenticated); `data/repos/*.json` committed
- [x] C3 Classify + score all; sanity-check category distribution by hand on the top 100
- [x] C4 `reports/landscape-2025-04-to-2026-10.md` generated and merged with the research report's narrative
- [x] C5 First real `reports/daily/2026-10-08.md` and `reports/weekly/2026-W41.md` generated from live data
- [x] C6 Stars folded in: `data/user/profile.json` derived; "My stars" overlap in reports

## D. Server and Railway
- [x] D1 HTTP API per PLAN §3.8 with bearer auth on writes; tests
- [x] D2 Scheduler (cron matcher, UTC) + `runs` ledger + `/api/status`
- [x] D3 Boot import from the public repo when the DB is empty
- [x] D4 Repo sync (Contents / Git Data API) behind `GITHUB_TOKEN`; no-op without it
- [x] D5 Dockerfile + `.env.example` (no `railway.toml` — deprecated for new services); local Docker-free smoke run of the built server
- [x] D6 Railway project `kinly` + service `kinly-api` + 1 GB volume at `/data` + domain `kinly-api-production.up.railway.app`; variables set without printing values (token via CLI); healthcheck + restart + watch patterns set via MCP `update-service`. *The SKIPPED-deployment check needs push events, which need the Railway GitHub app to see the repo: hand-off item.*
- [x] D7 Deployed service answers `/api/health` and `/api/trending?window=today` with real rows

## E. Paperclip plugin (`packages/paperclip-plugin`, id `vantik.kinly`)
- [x] E1 Manifest (capabilities, config schema, tools, jobs, managed agent, managed skill, UI slots) validated against the host schema
- [x] E2 Worker: data handlers, actions, 8 agent tools, daily-brief job, managed agent/skill reconcile for every enabled company
- [x] E3 UI: page with 8 tabs, sidebar link, dashboard widget, Vantik Signal styling, real decision buttons
- [x] E4 `AGENTS.md` for the Kinly agent (persona, tool usage, clone → test → rate → resource protocol)
- [x] E5 Tests (config, tool handlers against a fake API, brief idempotency); `npm run check` green
- [x] E6 Installed on this instance (`paperclipai plugin install`), config set for all four companies, page renders at `/VAN/kinly`

## F. Public repo and docs
- [x] F1 `git init`, `.gitignore`, MIT LICENSE, first commit
- [x] F2 `gh repo create angellog/kinly --public --source . --push` and `angellog/kinly-data` (public) seeded with data/, reports/, resources/
- [x] F3 Railway service connected to `angellog/kinly` (`main`); deploys run from the repo. *Push-triggered deploys need the Railway GitHub app granted access to the new repo: hand-off item. Until then `connect-service-source` (or the dashboard's Deploy button) ships the head.*
- [x] F4 README (what Kinly is, quick start, architecture, how to read a report, how to rate)
- [x] F5 docs/: ARCHITECTURE, API, CATEGORIES, SCORING, PAPERCLIP, RAILWAY, WORKFLOW
- [x] F6 CI green on `main`

## R. Review changes (PLAN.md `## GSTACK REVIEW REPORT`)
- [x] R-a Split data from code: `KINLY_DATA_ROOT` (data/, reports/, resources/) → `~/Projects/kinly-data` locally, `/data/repo` on Railway; `KINLY_DATA_REPO=angellog/kinly-data`; `publish` refuses the `gh` token without `--use-gh-token` (R1, D5)
- [x] R-b Export never writes `readme_excerpt`; larsbijl snapshots ship its MIT notice; vitalets stays local (R6)
- [x] R-c Ingest sanitizer: strip HTML/control chars, cap lengths; test with `<img onerror>` + injected instruction (R2, D15)
- [x] R-d Picks: suppress starred / shortlisted / picked-in-30-days, relevance ≥ 50 and score ≥ 45, novelty term, WIP limit 5; category weights seeded from stars; daily shows only weighted categories (P-M1, P-M2, D14)
- [x] R-e Stargazers history (`/repos/{o}/{r}/stargazers/history`) for today's lists + landscape top 50; velocity from it, snapshot-diff fallback (D13)
- [x] R-f Stall detection in collect + persistence per source + coverage stated in the landscape header (E-M4b, P-M3)
- [x] R-g Reports print `enriched N of M` with a degraded banner < 50%, plus credential states in the footer (E-B1, R8)
- [x] R-h Rename handling: canonical `nameWithOwner` from enrichment re-points history in one transaction (E-m1)
- [x] R-i Ratings split owner/agent; only owner rating moves status to `rated`; resource page has the test-log section (P-M5, D16)
- [x] R-j Language list capped at 10 + all, with a test; backoff on 429/5xx (R7)

## G. Verification and hand-off
- [x] G1 Final code-review workflow (correctness + security + cost lenses) and findings fixed
- [x] G2 End-to-end: Paperclip page → Railway API → rate a repo → resource page appears in the repo
- [x] G3 Obsidian: `Projects/kinly.md`, daily note, `Ongoing.md`, decision note
- [x] G4 Memory file for Kinly written
- [x] G5 Hand-off message with the exact human steps

## H. v0.2.0 — operate it (added 2026-10-14)

Loop rule unchanged: ticked only when done **and** verified. **(Angelo)** items are ticked when the evidence exists; the loop checks for it every tick and never performs the step itself.

- [x] H1 First unattended daily with the token is clean — `daily/2026-10-13` (05:41 UTC): no degraded banner, `enriched 60 of 60`, footer `github present`
- [x] H2 Kinly can use its tools — a "Kinly tools" access profile (8 exact `vantik.kinly:*` names) assigned to Kinly in VAN, FEE, GST, FEEA; policy test: Kinly `allow` ×8 in all four, every other agent `deny`
- [x] H3 Tool access is reproducible — `packages/paperclip-plugin/scripts/grant-kinly-tools.mjs` (idempotent, `--check` read-only mode) committed; `docs/PAPERCLIP.md` explains default-deny, exact names, no wildcards (verified: `--check` reports "keep profile; allowed all 8" in all four; 5 tests)
- [x] H4 A partial weekly is never served — weekly reports generated before their week ended are dropped on boot and import; `latest weekly` = last completed week; test; deployed; `/api/reports/latest?kind=weekly` answers `2026-W41` (verified on 3400973; W42 partial dropped)
- [x] H5 Kinly works as an agent — VAN-66 (2026-10-14 09:05 UTC): Kinly called `vantik.kinly:trending` over `POST /api/plugins/tools/execute`, returned today's five with verdicts and licences, installed nothing, closed the issue `done`. Two fixes were needed first: the expired Claude Code login (H12) and the instructions — plugin tools are not in an ACP session's tool list, so AGENTS.md and the skill now carry the HTTP helper (c120522; plugin re-upgraded so the host serves the new text)
- [x] H6 Release v0.2.0 — versions bumped (root, 3 packages, plugin manifest), `CHANGELOG.md`, tag `v0.2.0` pushed, plugin upgraded in Paperclip (managed agents' instructions refreshed), Railway `/api/health` version = the tagged commit with `release: 0.2.0`, CI green. *Verified: tag `v0.2.0` → 596ed60; CI (workflow_dispatch) green on 596ed60; host plugin `vantik.kinly 0.2.0 ready`; Kinly instructions refreshed in VAN/GST/FEEA (FEE left alone while pending approval); Railway serves `e020993` with `release: 0.2.0` — the tag differs from it only in plugin, test and docs files, and Railway's watch patterns SKIPPED the docs-only commit, as designed*
- [x] H7 Records — hand-off list rewritten, vault (`Projects/kinly.md`, daily note), memory updated
- [ ] H8 **(Angelo)** Approve Kinly in **FEE** — evidence: agent status is not `pending_approval`
- [ ] H9 **(Angelo)** Railway GitHub app can see `angellog/kinly` — evidence: a push creates a deployment by itself
- [ ] H10 **(Angelo)** Kinly-only Anthropic key on Railway — evidence: a report footer says `anthropic present`
- [x] H12 **(Angelo)** Sign the Mac's Claude Code back in — done 2026-10-14 ~08:29 UTC; Kinly's VAN-66 run completed without an auth error. *Avast, Beacon and Splice are still in `error` from the old failure: resume them in Paperclip where they should work*
- [ ] H11 **(Angelo)** Rate GST-29 (`0xNyk/council-of-high-intelligence`) — evidence: an owner rating exists and the repo is `rated`

### Found by Kinly in VAN-66 (fixed in v0.2.1; H13's rollout corrected in v0.2.2 and v0.2.3, verified live 2026-10-14 09:40 UTC: gods-eye-view → data-analytics, 21 conservative moves, README-less repos untouched)
- [x] H13 `bilawalsidhu/gods-eye-view` (a geospatial viewer) is filed as `security` with that category's boilerplate business line — the category rule matches too loosely; fix the rule and add a regression case
- [x] H14 `debpalash/VoiceStudio`'s business-use text is cut mid-word ("…as a client service wou"), dropping the AGPL clause — the length cap must cut at a sentence or word boundary, never mid-word
- [x] H15 The plugin client reports "Kinly API unreachable … fetch failed" on a single cold-start failure — retry once with a short backoff before reporting the service unreachable

## Hand-off list (Angelo)
- ~~**(Angelo) — blocks every Paperclip agent on this Mac, not just Kinly:** the Mac's Claude Code login has expired~~ **Done 2026-10-14** (Avast, Beacon and Splice still need resuming) ("OAuth session expired and could not be refreshed"; Avast, Beacon, Splice and Kinly are in `error`). In a terminal run `claude`, then `/login`. Then open each agent in `error` and resume it, and re-run VAN-66 (Kinly's read-only tool check). (H12)
- **(Angelo)** Approve Kinly in **FEE**: http://127.0.0.1:3100/FEE/agents/kinly/overview → **Approve agent** (VAN approved 2026-10-14). GST and FEEA are paused: **Resume** where it should work.
- **(Angelo)** Grant the Railway GitHub app access to `angellog/kinly` (github.com/settings/installations → Railway → Repository access → add `kinly`). Then push a docs-only commit and check `railway deployment list` shows it SKIPPED (watch patterns).
- **(Angelo)** Rate `0xNyk/council-of-high-intelligence` in the Kinly console (GST-29 holds the agent's read-only test, 3/5) — the first owner rating closes the loop.
- ~~**(Angelo)** Mint a fine-grained GitHub PAT~~ **Done 2026-10-12** — set on Railway, first publish verified (`5542e87`). Original item: Mint a fine-grained GitHub PAT (`angellog/kinly-data` only, Contents read/write; never `angellog/kinly`) and set it on Railway as `GITHUB_TOKEN`. Exact steps: `docs/RAILWAY.md` → Adding the GitHub token
- **(Angelo)** Mint a Kinly-only Anthropic key in its own Console workspace with a monthly spend limit and set it on Railway as `ANTHROPIC_API_KEY`
- ~~**(Angelo)** Allow `vantik.kinly:*` tools~~ **Done 2026-10-14** — "Kinly tools" access profile in all four companies, assigned to Kinly only (H2)
