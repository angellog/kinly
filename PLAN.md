# Project Kinly — Plan

**Developed by Vantik Systems.** GitHub trend intelligence: what is trending, what trended, what it does, and how it can be used in the business.

Plan v1.1 · 2026-10-12 · v1.0 written 2026-10-08 · status: **reviewed** — 24 findings from a three-lens adversarial panel, each accepted, adapted or rejected with a reason in `## GSTACK REVIEW REPORT` at the end. Where v1.1 changed a v1.0 decision the row says so.

---

## 1. What Kinly is

Kinly is a GitHub researcher that runs unattended and answers four questions every day:

1. **What is trending right now** (today), **this week**, **this month** — and what **kept trending** over the last 18 months.
2. **What each repo does**, in one plain sentence, and **how Angelo could use it** in Vantik Systems (AI transformation advisory, content pipeline, Paperclip operation) or FeetBit (sneaker retail on Instagram/WhatsApp).
3. **Which repos are worth adding to a workspace and testing** — ranked lists of 5 / 10 / 15 per category, filtered for relevance and persistence, never the raw firehose.
4. **What happened after testing** — a shortlist → test → rate → resource workflow, where every rated repo gets a resource page in the public repo.

It is three deliverables that share one engine:

| Deliverable | Where it lives | What it is |
|---|---|---|
| **Engine + API** | Railway service `kinly` (Node 24, TypeScript, SQLite on a volume) | Collects trending data daily, enriches via the GitHub API, classifies, scores, writes daily/weekly reports, serves a JSON API, answers questions |
| **Public repos** | `github.com/angellog/kinly` (code, docs, research) and `github.com/angellog/kinly-data` (every report, resource page and data snapshot) | Two repos so the service that writes reports can never write the code it runs (R1 in the review). Together they are the public record and enough to rebuild the database |
| **Paperclip plugin** | `vantik.kinly`, installed once on the instance, visible in every company (GST, VAN, FEEA, FEE) | Console page, sidebar entry, dashboard widget, agent tools, a managed **Kinly** agent persona, a managed skill, and a daily-brief job |

## 2. Decisions (made, with reasons)

| # | Decision | Why |
|---|---|---|
| D1 | **Railway is the single writer** of `angellog/kinly-data`; GitHub Actions runs CI only on `angellog/kinly`. *(v1.1: data moved to its own repo.)* Until Railway holds a token the Mac writes `kinly-data`; the hand-over rule is in `docs/WORKFLOW.md`. | Two writers to one repo means conflicts. Railway holds the DB, so it is the one that knows what changed. |
| D2 | **`kinly-data`'s `data/` is the durable archive; the SQLite DB is derived and rebuildable** (`kinly import`). On first boot with an empty DB the server imports from the repo over public raw URLs. | A Railway volume can be lost; git cannot. A fresh deploy gets 18 months of history with zero manual steps. |
| D3 | **SQLite via `node:sqlite`**, no native modules, no Postgres. | Zero build risk on Railway, one file to back up, data fits in tens of MB. Node 24 ships it. |
| D4 | **Keyless mode keeps the channel alive; it is not a substitute for a token.** *(v1.1, review E-B1.)* Without `GITHUB_TOKEN` the engine scrapes `github.com/trending`, enriches a bounded batch per hour through REST (60 req/h), and every report prints `enriched N of M` with a **degraded** banner under 50%. Credentials are reported as `present · absent · rejected` in `/api/status` and the report footer, so a dead key is visible the same day. A read-only fine-grained PAT is the first hand-off item. Without `ANTHROPIC_API_KEY` summaries come from the README/description. | The channel must never go dark because a key is missing — and must never look healthy when it is degraded. |
| D5 | **No personal `gh` OAuth token is deployed anywhere, and nothing publishes with it unattended.** The Railway `GITHUB_TOKEN` must be a fine-grained PAT (public read + `contents: write` on `angellog/kinly-data` only — never on `angellog/kinly`). `kinly publish` refuses the `gh auth token` fallback unless `--use-gh-token` is passed by hand. Until Angelo mints the PAT, Railway runs keyless (D4) and `kinly-data` is updated from this Mac. | The `gh` token carries `repo` scope across every repo Angelo owns. A server compromise would expose all of them. Not a trade worth making silently. |
| D6 | **Backfill runs locally, once, with the authenticated `gh` CLI (5,000 req/h)**, and the resulting snapshots are committed. | 18 months × multiple sources is thousands of repos to enrich; that belongs on the Mac, not in a 60 req/h degraded server. |
| D7 | **Categories are rule-based first, LLM-refined second, owner-overridable always.** | Deterministic classification makes reports reproducible; an LLM pass improves edge cases; the owner's word is final. |
| D8 | **Paperclip plugin talks only to the Railway API** (plain `fetch`), never to the DB. One source of truth, one auth token. | Keeps the plugin thin and the API the only contract. |
| D9 | **The Kinly managed agent is created `paused`** in every company. | A managed agent that starts running costs tokens; Angelo resumes it where he wants it. |
| D10 | **Public repos, MIT licence for code and Kinly-authored prose, Vantik Systems as author.** Third-party descriptions are reproduced for identification under their owners' terms; README text is never committed (only Kinly's own summary), and the larsbijl snapshots carry that archive's MIT notice. *(v1.1, review R6.)* | Angelo asked for a public repo. MIT keeps it reusable; republishing text Kinly cannot license is not. |
| D11 | **Model for write-ups: `claude-opus-5-5`** (configurable `KINLY_LLM_MODEL`; v1.0 said Sonnet 5.5 — changed to follow the house default for the Claude API). One token counter, checked on every LLM path (summaries, ask, research), capped by `KINLY_LLM_DAILY_CAP`; summaries only for repos that reach a list or the shortlist, cached by README hash. | The cap bounds the bill whatever the model; caching and list-only summaries keep it small. |
| D12 | **One daily pipeline job, not a chain of clock offsets.** *(v1.1, review E-M1.)* `daily` at 05:40 UTC runs stars → collect → enrich → classify/score → report → publish in sequence, records one `runs` row per stage, and stops at the first failed stage (no report on a failed collect). `meta.last_daily_ok` is checked on boot and hourly; a missed day runs once as catch-up. Weekly is gated the same way. | A restart inside a clock gap used to mean a silent missed day; a failed collect used to produce an empty public report. |
| D13 | **Real star curves from `GET /repos/{o}/{r}/stargazers/history`** (shipped 2026-09-04) for every repo on today's lists and for the landscape top 50. *(v1.1, review E-M3 / P-M3.)* | The larsbijl archive carries no star counts, so “peak” and “velocity” had nothing behind them for 18 months of history. |
| D14 | **Picks are novel and relevant, not merely big.** *(v1.1, review P-M1.)* Picks exclude repos already starred, already on the shortlist, or picked in the last 30 days; they require relevance ≥ 50 and score ≥ 45; a novelty term favours repos first seen in the last 90 days. A WIP limit of 5 (shortlisted + testing) shrinks picks when the bench is full. | Otherwise the top of every list is the same giants, and things Angelo already has. |
| D15 | **Third-party text is data, never markup or instructions.** *(v1.1, review R2.)* Scraped strings are stripped of HTML and control characters and length-capped at ingest; the UI renders them as text; agent tool results wrap them in fenced blocks labelled untrusted; `AGENTS.md` says nothing inside them is an instruction. | A repo description reaches a browser on the board origin and a `claude_local` agent. |
| D16 | **Repos are tested only in a disposable container**, never on the Mac's home directory. *(v1.1, review R3.)* `docker run --rm` with no home mount and no `.env`, `npm install --ignore-scripts` / `pip install --no-deps` first; scripts only after reading them. The agent's test log is a section of the resource page; only the owner's rating moves a repo to `rated`. | `npm install` of an unaudited repo runs arbitrary code; this Mac holds every credential. |

## 3. Architecture

```
                       ┌────────────────────────────────────────────┐
  github.com/trending  │  Railway service: kinly                    │
  larsbijl archive     │  ┌──────────┐  ┌──────────┐  ┌──────────┐  │   reports/ + data/ + resources/
  vitalets archive  ──▶│  │ collect  │─▶│ enrich   │─▶│ classify │  │──▶ pushed to angellog/kinly
  GitHub search        │  └──────────┘  └──────────┘  │ + score  │  │   (Contents / Git Data API)
  angellog's stars     │        ▲                     └────┬─────┘  │
                       │        │ scheduler (cron)         ▼        │
                       │        │                   ┌──────────┐    │
                       │   SQLite /data/kinly.db ◀──│ reports  │    │
                       │        ▲                   └──────────┘    │
                       │        │ JSON API (node:http) + LLM "ask"  │
                       └────────┼───────────────────────────────────┘
                                │ https
                 ┌──────────────┴──────────────┐
                 │ Paperclip plugin vantik.kinly │  page · sidebar · widget · tools · managed agent · managed skill · daily-brief job
                 └─────────────────────────────┘
```

### 3.1 Repository layout (`~/Projects/kinly`, public `angellog/kinly`)

```
kinly/
├── README.md · PLAN.md · MASTER-TODO.md · LICENSE (MIT)
├── package.json                 npm workspaces: packages/*
├── packages/
│   ├── engine/                  @kinly/engine — the library + `kinly` CLI
│   │   └── src/ sources/ github/ store/ classify/ score/ reports/ llm/ cli.ts
│   ├── server/                  @kinly/server — HTTP API + scheduler (runs on Railway)
│   └── paperclip-plugin/        @kinly/paperclip-plugin — manifest, worker, ui
├── data/
│   ├── snapshots/<source>/<date>.json      who trended, when, where (the archive)
│   ├── repos/<shard>.json                  enrichment cache, keyed by full_name
│   ├── user/{profile,ratings,shortlist}.json
│   └── raw/stars.json                      angellog's stars with timestamps
├── reports/daily/YYYY-MM-DD.md · reports/weekly/YYYY-Www.md · reports/landscape-2025-04-to-2026-10.md
├── resources/<owner>--<repo>.md            one page per rated repo
├── research/                               the deep-research notes + report behind the plan
├── docs/ ARCHITECTURE.md API.md CATEGORIES.md SCORING.md PAPERCLIP.md RAILWAY.md WORKFLOW.md
├── .github/workflows/ci.yml
└── Dockerfile · railway.toml · .env.example
```

### 3.2 Data model (SQLite)

- `repos(full_name PK, owner, name, description, language, topics JSON, stars, forks, created_at, pushed_at, license_spdx, license_class, open_core INT, archived, homepage, latest_release, readme_excerpt, summary, business_use, category, category_source, enriched_at, summary_at)`
- `appearances(id PK, full_name, source, window, list_date, language_list, rank, stars_today, stars_total)` — one row per (repo, source, window, date, list)
- `star_history(full_name, observed_at, stars)` — one row per observation; drives velocity
- `user_stars(full_name, starred_at)`
- `shortlist(full_name PK, status, note, updated_at)` — status: discovered · shortlisted · testing · rated · resourced · dropped
- `ratings(full_name PK, rating 1–5, notes, tested_at, verdict_override)`
- `runs(id, job, started_at, finished_at, ok, stats JSON, error)`
- `kv(key, value)` — profile, last-run markers

### 3.3 Sources (adapters, each returns a normalized list)

| Adapter | Auth | Covers | Used for |
|---|---|---|---|
| `trending-page` — `github.com/trending?since=daily|weekly|monthly` (+ `/trending/<lang>` for 10 languages) | none | now | daily collect |
| `larsbijl-archive` — `larsbijl/trending_archive` daily markdown | none (raw URLs) | 2025-04 → today | 18-month backfill |
| `vitalets-archive` — issue comments per language/period | gh (local) | per language, if still updating | backfill cross-check |
| `gh-search-new` — `created:>=D stars:>=N sort:stars` | token or 10/min unauth | new high-growth repos | weekly "new entrants" |
| `stars` — `/user/starred` with `star+json` | gh (local) / token | angellog's 206 stars | relevance profile, "stars you'd like" |

Exact formats and liveness come from the research report (`research/reports/`); the adapters are written against fixtures captured from the live sources so a format change fails a test, not a nightly run.

### 3.4 Enrichment

GraphQL when a token exists (50 repos per query, aliased): description, stars, forks, createdAt, pushedAt, primaryLanguage, topics, licenseInfo, isArchived, homepage, latestRelease, README (first 4,000 chars), presence of `ee/` or `enterprise/` directories. REST fallback (`/repos/{o}/{r}` + `/readme`) when keyless, paced to the remaining rate limit. Licence classified into permissive · weak-copyleft · strong-copyleft · source-available (SUL, BSL, Elastic, FSL, Commons Clause) · none; open-core flagged from `ee/` dirs and licence text.

### 3.5 Classification (16 categories)

`ai-agents` · `mcp-tools` · `llm-infra` · `design-ui` · `content-media` · `automation-workflow` · `social-marketing` · `business-ops` · `data-analytics` · `devtools` · `infra-devops` · `security` · `learning-reference` · `web-mobile` · `systems-languages` · `other`. Rules match topics and description keywords with weights; ties go to the more specific category; `category_source` records `rule` / `llm` / `owner`.

### 3.6 Scoring

- **Trend signals** per repo: appearances, distinct weeks on trending (persistence), first/last seen, peak stars-today, 7-day star velocity from `star_history`.
- **Relevance 0–100**: category weight from `data/user/profile.json` (Vantik + FeetBit interests) + keyword hits + overlap with the topics of Angelo's own stars.
- **Kinly score 0–100** = adoption 30 (log stars, velocity) + maintenance 20 (push recency, release recency, not archived) + persistence 15 + licence 15 + relevance 20.
- **Verdict**: `BUILD` (score ≥ 70, licence not source-available, relevance ≥ 50) · `WATCH` (45–69) · `SKIP` (< 45 or archived). Owner rating (1–5) and notes sit beside it, never replace it.

### 3.7 Lists and reports

Lists: **today** · **this week** · **this month** · **persistent** (≥ 3 distinct weeks in 18 months) · **rising** (velocity) · **new** (first seen ≤ 7 days). Sizes 5 / 10 / 15 are parameters; the report uses 10 for the headline list, 5 per category, 15 for the weekly top.

- `reports/daily/YYYY-MM-DD.md`: Top 10 today · Picks for Vantik (5, with what/why/use) · Repeat trenders · New entrants · By category (top 3 each) · Shortlist nudges.
- `reports/weekly/YYYY-Www.md`: Top 15 of the week · each category's top 5 · Rising · Persistence leaderboard · "Add to a workspace this week" (5, with a 15-minute test plan each) · Resources published · Ratings.
- `reports/landscape-2025-04-to-2026-10.md`: the 18-month backfill — top 10 per month, category waves, all-time top 50 by persistence, the research report's narrative.
- `resources/<owner>--<repo>.md`: what it is · why it trended · business use (Vantik / FeetBit) · 15-minute quick start · licence note · Kinly score + verdict · owner rating + test log · links.

### 3.8 API (Railway, JSON, `node:http`)

GET: `/api/health` · `/api/status` · `/api/trending?window&category&limit&min_relevance` · `/api/repos?q&category&verdict&sort&limit&offset` · `/api/repos/:owner/:name` · `/api/categories` · `/api/stars` · `/api/reports?kind` · `/api/reports/:kind/:id` · `/api/reports/latest?kind` · `/api/shortlist` · `/api/export`
POST (bearer `KINLY_API_TOKEN`): `/api/repos/:owner/:name/shortlist` · `/api/repos/:owner/:name/rating` · `/api/repos/:owner/:name/resource` · `/api/research {topic|category, window}` · `/api/ask {question}` · `/api/jobs/run {job}`
Scheduler (UTC, D12): `daily` pipeline 05:40 (stars → collect → enrich → score → report → publish, stage-gated, catch-up on boot/hourly via `meta.last_daily_ok`) · `weekly` Monday 06:40 (same gating) · `enrich-keyless` hourly while no token. GET routes: `Cache-Control: public, max-age=300`, `limit` ≤ 100, a per-IP token bucket; `/api/export` and every POST need the bearer token (compared in constant time).

### 3.9 Paperclip plugin `vantik.kinly`

- **Capabilities**: `ui.page.register`, `ui.sidebar.register`, `ui.dashboardWidget.register`, `ui.action.register`, `jobs.schedule`, `plugin.state.read/write`, `companies.read`, `agents.read`, `agents.managed`, `skills.managed`, `agent.tools.register`, `issues.read/create/update`, `issue.comments.create`.
- **Config per company** (`instanceConfigSchema`): `enabled` (default **true** — Angelo wants it everywhere), `apiUrl` (default the Railway domain), `apiTokenRef` (a Paperclip **secret ref**, resolved in the worker; the token never reaches the browser — review R4), `dailyBrief` (default false), `briefAssigneeAgentId`.
- **UI**: page `/<prefix>/kinly` with tabs Today · This Week · Categories · Persistent · My Stars · Shortlist · Reports · Ask Kinly; repo cards with score, verdict, licence; actions Shortlist / Rate / Make resource / Add to workspace (creates an issue for the Kinly agent with the clone-and-test protocol). Sidebar link. Dashboard widget: today's top 3 + counts.
- **Tools** (`vantik.kinly:*`): `trending`, `search`, `repo`, `report`, `shortlist`, `rate`, `resource`, `research`.
- **Managed agent** `kinly` ("Kinly", `claude_local`, created paused, instructions = `AGENTS.md`: researcher persona, tool usage, the clone → test → rate → resource protocol, never installs or publishes without approval).
- **Managed skill** `kinly`: how any agent uses the tools.
- **Job** `daily-brief` 07:00 UTC: for each enabled company with `dailyBrief`, upsert one issue per day with the daily report (idempotent `originId`).

### 3.10 Deployment

Dockerfile (`node:24-alpine`, `npm ci`, build, `node packages/server/dist/main.js`). **No `railway.toml`**: Config-as-Code is deprecated for new services (cutoff 2026-12-01), so the healthcheck, restart policy and **watch patterns** (`packages/**`, `package.json`, `package-lock.json`, `tsconfig.base.json`, `Dockerfile`) are set on the service through the Railway MCP `update-service` call and verified with `list-deployments` (a docs-only commit must show SKIPPED). Volume at `/data` (1 GB), env: `PORT`, `KINLY_DB=/data/kinly.db`, `KINLY_DATA_ROOT=/data/repo`, `KINLY_DATA_REPO=angellog/kinly-data`, `KINLY_API_TOKEN`, optional `GITHUB_TOKEN`, `ANTHROPIC_API_KEY`, `KINLY_LLM_MODEL`. Railway project `kinly`, service from the GitHub repo, public domain generated.

## 4. Build order

*(v1.1, review E-M4: a vertical slice that is shippable at every cut.)* 1. Engine + tests, first commit. 2. Backfill locally; enrich; publish `kinly-data`. 3. Public repos pushed; CI green. 4. Server + scheduler + Dockerfile; deploy to Railway from `angellog/kinly`; watch patterns set; verify `/api/health`, real rows, and one **unattended** scheduler fire in the `runs` ledger (cron pointed at now + 5 min by env override; the first real 05:40 row is a dated follow-up). 5. Plugin: manifest → worker → UI → tests → install in all four companies. 6. Docs, vault notes, memory. 7. Final review workflow + end-to-end QA. Nothing is deferred to a later version: the loop stops only when every item in `MASTER-TODO.md` is ticked.

## 5. Risks and how they are handled

| Risk | Handling |
|---|---|
| `github.com/trending` HTML changes | Parser tested against a committed fixture; a parse that yields 0 rows fails loudly and the archive source still runs |
| Trending page stalls (same list two days running) | Collect diffs each list against yesterday's; two identical days mark the source `stalled` in `runs.stats` and the report footer, and those days earn no persistence credit (review E-M4b) |
| Archive coverage is partial | larsbijl covers six language lists and no all-languages list; the landscape report and `docs/SCORING.md` say so in their headers, and persistence is computed per source (review P-M2) |
| Archive sources stop updating | Each adapter reports `last_available_date`; the daily report prints a "sources" footer; CI has a liveness test marked `net` |
| Rate limits | Pacing from `X-RateLimit-Remaining`; GraphQL batching; keyless mode caps enrichment per run |
| LLM cost | Summaries cached per repo by README hash; `KINLY_LLM_DAILY_CAP` tokens; keyless mode has no LLM at all |
| Railway volume loss | D2: repo is the archive; boot import rebuilds |
| Paperclip plugin install is board-only | Install runs from the local CLI on this Mac (same path kickshot used); documented |
| Plugin SDK version drift | SDK pinned to the host's exact version `2026.1005.0`; manifest validated against the host's own schema before install |
| Secrets | `.env` gitignored, `.env.example` committed, nothing printed, no personal OAuth token on a server (D5) |

## 6. Out of scope (v1)

Auto-installing repos into workspaces without a human; publishing anything to social; a web UI outside Paperclip (the public repo's markdown is the public UI). *(v1.1: star-history per repo moved in scope — D13.)*

---

## GSTACK REVIEW REPORT

**Run:** 2026-10-08, workflow `wf_95a7e7b5-614`. Three reviewer lenses read v1.0: engineering, risk/security/cost, and product/devex. Each finding then went to an adversarial verifier. The weekly usage limit cut the verify phase short: 4 findings were verified (none refuted) and 20 were not. The unverified findings were judged by hand on 2026-10-12 against the code as it stood then. **Verdicts:** engineering *rework*, product *rework*, risk *approve with changes*. Every finding is listed below with what was done about it.

Legend: **A** accepted as written · **A′** accepted with the change noted · **R** rejected, with the reason.

### Engineering

| ID | Sev | Finding | Disposition |
|---|---|---|---|
| E-B1 | blocker | Keyless mode on Railway is not a working mode | **A′** → D4. Keyless runs a bounded hourly enrich. Reports show a degraded banner below 50% enriched. Credential state is surfaced. The read-only PAT is hand-off item 1. Rejected part: forbidding all `api.github.com` calls when keyless; 60 req/h is enough for an hourly batch. |
| E-B2 | blocker (verified) | Railway deploy-on-push plus Railway pushing to the same repo restarts the service every morning | **A′** → §3.10 and D1. The verifier showed `railway.toml` watchPatterns are ignored for new services, so watch patterns are set through MCP `update-service` and checked with `list-deployments`. `ci.yml` ignores data/report/doc paths. The separate `kinly-data` repo (R1) also removes the loop at its root. |
| E-M1 | major (verified) | Fixed-offset cron chain with no stage dependency and no catch-up | **A′** → D12. One stage-gated pipeline. Catch-up uses a generic “last ok < today” predicate checked on boot and hourly, instead of a fixed 07:40 refire. Retries are bounded to one per hour, so keyless rate limits are not burned. Tested with an injected clock. |
| E-M2 | major (verified) | Two writers during launch; commit shape unspecified | **A** → `publish.ts` uses Git Data API only: blobs → tree on `base_tree` → commit → `PATCH ref` with `force:false` (a 422 on a non-fast-forward acts as the compare-and-swap). Unchanged files are skipped by blob SHA. The ownership rule goes in `docs/WORKFLOW.md`. The verifier's aggravator, the `gh auth token` fallback, is closed by D5: `publish` refuses that token without `--use-gh-token`. |
| E-M3 | major | Velocity comes from an empty table; backfill covers six languages, not GitHub | **A** → D13 (stargazers history) and P-M2 (coverage is stated). |
| E-M4 | major (verified) | The scope cannot be executed in one session in the order given | **A′** → §4 reordered into a vertical slice: first commit and public repos come before the server, and the server before the plugin. **R** on deferring the managed agent, skill, brief job and actions to a v1.1: Angelo asked for the whole thing, and the loop runs across sessions until every item is ticked. The unattended-fire proof uses an env-overridden cron in-session; the real 05:40 row is a dated follow-up, as the verifier advised. |
| E-M4b | major | Trending stalls fail silently | **A** → §5 risk row. Collect diffs each list against yesterday's, flags a stall, and suppresses persistence credit for the stalled days. |
| E-m1 | minor | `full_name` keying splits history on rename or transfer | **A′**. Enrichment records the canonical `nameWithOwner`. When it differs, appearances, scores and owner state are re-pointed in one transaction. GitHub's numeric id is not stored: canonical names are enough to merge, and the trending HTML does not carry the id. |

### Product / devex

| ID | Sev | Finding | Disposition |
|---|---|---|---|
| P-B1 | blocker | Keyless default strands hand-authored data and stops the public repo | **A′**. Owner state (shortlist, ratings, resources) goes into `data/user/*.json` on every publish, and `/api/status` says whether those writes are synced or volume-only. **R** on refusing writes with 503 until a token exists: the Railway volume is durable, and blocking the rating workflow on a hand-off item would stall the product for no safety gain. |
| P-M1 | major | Scoring recommends giants and repos Angelo already has | **A** → D14. |
| P-M2 | major | The taxonomy has no category for the owner's dominant interest | **A′**. `mcp-tools` now covers MCP servers, agent skills, plugins and subagents (label “MCP, skills & agent tooling”); `ai-agents` covers coding agents and frameworks. Category weights are seeded from the star-topic histogram. The daily report shows per-category sections only for categories weighted ≥ 0.5; the weekly report shows all 16. **R** on adding a 17th category: the two that exist already split along the line the reviewer drew. |
| P-M3 | major | 18-month persistence rests on a per-language archive | **A** → coverage stated in the landscape header and `docs/SCORING.md`; persistence per source; star curves for the top 50 (D13); vitalets rows stop counting after its last push. |
| P-M4 | major | Velocity ignores stargazers/history, so `rising`/`new` are empty when it matters | **A** → D13. Snapshot-diff velocity stays as the fallback when the endpoint returns 404. |
| P-M5 | major | No intake limit and no defined test artifact | **A** → D14 (WIP limit 5) and D16 (test log = a section of the resource page; agent rating and owner rating are separate fields, and only the owner's rating moves status). |
| P-m1 | minor | Plugin surface over-built for v1 | **R**. Angelo asked for the full console, the tools and the agent. Ask/research stay, under the D11 cap. The brief is opt-in per company (`dailyBrief: false` by default). |
| P-m2 | minor | The plan cites reports that do not exist | **A**. This section now exists. A4 runs as a deep-research pass over the backfilled data, and its narrative is merged into the landscape report. Until then §3.3 relies on the committed fixtures and `research/research_notes/`. |

### Risk / security / cost

| ID | Sev | Finding | Disposition |
|---|---|---|---|
| R1 | blocker | Railway writes to the repo Railway deploys from, so a compromise becomes persistent RCE | **A** → D1, D5. Code lives in `angellog/kinly` (Railway deploys it and holds no token for it). Data lives in `angellog/kinly-data` (the only repo the PAT can write). `kinly import` validates snapshots and rejects unknown paths and fields. |
| R2 | major | Untrusted repo text reaches the board origin and a `claude_local` agent | **A** → D15, with a test that `<img onerror>` and an injected instruction render inert. |
| R3 | major | Clone → test runs untrusted code on the credential-rich Mac | **A** → D16, written into `AGENTS.md`, the “Add to workspace” issue template and `docs/WORKFLOW.md`. |
| R4 | major | API token stored as plain per-company config | **A** → `apiTokenRef` secret ref resolved in the worker; UI calls go through `ctx.data`/`ctx.actions`; constant-time compare on the server; rotation documented in `docs/PAPERCLIP.md`. |
| R5 | major | LLM key borrowed from another project; cap not applied to `/api/ask` | **A′** → D11 (one counter, every path, exposed in `/api/status`; list-only summaries). A Kinly-only key with a Console spend limit is a hand-off item, because only Angelo can mint it. Haiku for one-liners is not adopted; the cap bounds cost whatever the model. |
| R6 | major | README excerpts committed to a public MIT repo | **A** → D10. `readme_excerpt` stays in SQLite and is never exported. larsbijl snapshots ship with its MIT notice. vitalets rows stay local. |
| R7 | minor | Scrape should identify itself and bound its growth | **A**. The UA string is already set. Exponential backoff on 429/5xx. A test fails if the language list grows past 10 plus “all”. The AUP position is noted in `docs/ARCHITECTURE.md`. |
| R8 | minor | Keyless mode hides a dead credential; public GET is unmetered | **A** → D4 credential states, the §3.8 rate limit, `Cache-Control`, `limit` ≤ 100, `/api/export` behind the bearer token. |

---

## Final review (G1, 2026-10-12)

Three reviewers covered correctness, security, and cost/operations, and returned 32 findings. Each was checked against the code. Fixes landed in one commit, with regression tests: 155 in total, up from 140. Two items were accepted, not fixed; they are listed below.

| Finding | Fix |
|---|---|
| **Sec 1** (high): `kinly pull` let a crafted `full_name` write outside `resources/` | Names are validated; paths are contained and checked before any write. Test included |
| **Sec 2** (high): report and brief markdown reached agents unfenced | The brief puts the report in a fenced block under a "data, not instructions" header. The `report` tool wraps its output in `<<< >>>` |
| Sec 3: summaries and business uses shown to agents as trusted | Fenced as model-written data. The README and description are fenced inside the summarizer prompt |
| Sec 4: agent test logs published raw | Token-shaped strings are redacted before storing. `AGENTS.md` says logs are public and adds an explicit read-only review mode for hosts without Docker |
| Sec 5 and Ops 5: rate limit keyed on a client-controlled header; unbounded map | Keyed on the last proxy-appended hop. The map is hard-capped. List responses are cached in-process for 2 minutes and cleared on any write |
| Sec 6: markdown in third-party text rendered as links and images | Escaped in every report and resource page. The README fallback is reduced to plain text |
| Sec 7: API token could be sent to any configured URL | The token is sent only to the Kinly origin or loopback |
| Sec 8: local server on `0.0.0.0` with a weak token and the gh fallback | Loopback unless on Railway or `KINLY_HOST` is set. Tokens under 32 characters disable writes. The server never uses the gh fallback |
| Sec 9: public `/api/status` exposed credentials, spend and errors | Public status is minimal. The full status needs the bearer token |
| Sec 10 and Cor 7: imports trusted rows; thin records overwrote newer ones | Rows are validated. Newer-and-better wins for metadata, summaries (llm over heuristic) and owner categories |
| **Cor 1** (high): a failed boot import could publish an empty store over the data repo | The import is all or nothing and retried. Export and publish refuse while a rebuild is pending. The scheduler waits for the import |
| **Cor 2** (high): re-enrichment overwrote LLM and curated categories | Rules never overwrite `llm` or `owner` categories |
| Cor 3: Monday's weekly reported the week that had just started | Reports the completed ISO week |
| Cor 4: GitHub-search rows counted as trending days and weeks | Signals and lists use trending sources only; days come from daily lists only |
| Cor 5 and Cor 6: API jobs raced the boot import; a past date re-stamped live lists | Jobs answer 503 until the import finishes. `daily` and `collect` only run for today. `last_daily_ok` never moves backwards |
| Cor 8: pick memory was not exported | `data/user/picks.json` is exported and imported |
| Cor 9: stalled lists credited after a rebuild | Stalled lists are flagged in the snapshot file and skipped on import |
| Cor 10: `%Y-%W` split the week that spans New Year | Weeks are keyed on their ISO Monday |
| Cor 11 and Cor 12: daily header count capped at 60; 7-day velocity included a partial day | The count comes from the full list. Velocity uses complete days only |
| **Ops 1** (high): keyless rate state never refreshed, so enrichment stalled after the first run | The rate state resets after its reset time |
| Ops 2 and Ops 3: LLM cap could be overrun; failing repos paid for daily | Tokens are reserved before each call and settled after. Ask and research run under the lock. Three failures stop retries |
| Ops 4: export loaded the whole store into memory (+170 MB) | Export streams repos only. `/api/export` defaults to the owner bundle; `?full=1` gives the whole store |
| Ops 6: GraphQL throttling fanned out to REST | Enrichment stops on 403, 429 or rate-limit errors |
| Ops 7: shards rewritten whole every day | One repo per line, so git stores small diffs |
| Ops 8: full scans; candidate clamp at 1,000 | Indexes on `(full_name, list_date)`, `star_history(observed_at)` and `picks(pick_date)`. `listNew` uses `NOT EXISTS`. The clamp is 3,000 |
| Ops 9: retries could hold the lock for close to an hour | `Retry-After` is capped at 30 s. The scrape has a 3-minute total budget |
| Ops 10: WAL growth; long synchronous job requests | `journal_size_limit`. Jobs return 202 and run in the background |

**Accepted, not fixed:**
- A same-day re-collect can add appearances that the day file, which keeps the last fetch, does not hold (part of Cor 9). The effect is a handful of rows on a retry day.
- A failed daily re-runs from its first stage rather than the failed stage (part of Ops 9). With the scrape budget and the hourly gap, the worst case is bounded.
