# Project Kinly — Plan

**Developed by Vantik Systems.** GitHub trend intelligence: what is trending, what trended, what it does, and how it can be used in the business.

Plan v1.0 · 2026-10-08 · author: Claude (Fable 5.1) for Angelo · status: under adversarial review (see `## GSTACK REVIEW REPORT` at the end)

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
| **Public repo** | `github.com/angellog/kinly` | The source, every report (`reports/daily`, `reports/weekly`, the 18-month landscape), every resource page, and the data snapshots that let anyone rebuild the database |
| **Paperclip plugin** | `vantik.kinly`, installed once on the instance, visible in every company (GST, VAN, FEEA, FEE) | Console page, sidebar entry, dashboard widget, agent tools, a managed **Kinly** agent persona, a managed skill, and a daily-brief job |

## 2. Decisions (made, with reasons)

| # | Decision | Why |
|---|---|---|
| D1 | **Railway is the single writer** of reports into the public repo; GitHub Actions runs CI only. | Two writers to one repo means conflicts. Railway holds the DB, so it is the one that knows what changed. |
| D2 | **The repo's `data/` is the durable archive; the SQLite DB is derived and rebuildable** (`kinly import`). On first boot with an empty DB the server imports from the repo over public raw URLs. | A Railway volume can be lost; git cannot. A fresh deploy gets 18 months of history with zero manual steps. |
| D3 | **SQLite via `node:sqlite`**, no native modules, no Postgres. | Zero build risk on Railway, one file to back up, data fits in tens of MB. Node 24 ships it. |
| D4 | **Keyless degraded mode is a first-class mode.** Without `GITHUB_TOKEN` the engine scrapes `github.com/trending` (no auth needed) and enriches through REST at 60 req/h. Without `ANTHROPIC_API_KEY` summaries come from the README/description, not an LLM. | The channel must never go dark because a key is missing. Keys only make it better. |
| D5 | **No personal `gh` OAuth token is deployed anywhere.** The Railway `GITHUB_TOKEN` must be a fine-grained PAT (public read + `contents: write` on `angellog/kinly` only). Until Angelo mints it, Railway runs keyless (D4) and the repo is updated from this Mac. | The `gh` token carries `repo` scope across every repo Angelo owns. A server compromise would expose all of them. Not a trade worth making silently. |
| D6 | **Backfill runs locally, once, with the authenticated `gh` CLI (5,000 req/h)**, and the resulting snapshots are committed. | 18 months × multiple sources is thousands of repos to enrich; that belongs on the Mac, not in a 60 req/h degraded server. |
| D7 | **Categories are rule-based first, LLM-refined second, owner-overridable always.** | Deterministic classification makes reports reproducible; an LLM pass improves edge cases; the owner's word is final. |
| D8 | **Paperclip plugin talks only to the Railway API** (plain `fetch`), never to the DB. One source of truth, one auth token. | Keeps the plugin thin and the API the only contract. |
| D9 | **The Kinly managed agent is created `paused`** in every company. | A managed agent that starts running costs tokens; Angelo resumes it where he wants it. |
| D10 | **Public repo, MIT licence, Vantik Systems as author.** | Angelo asked for a public repo. MIT keeps it reusable by the people the reports are for. |
| D11 | **Model for write-ups: `claude-sonnet-5-5`** (configurable `KINLY_LLM_MODEL`), summaries cached per repo and only regenerated when the README changes. | Sonnet is the cost/quality point for ~100 short summaries a day; caching keeps the daily bill in cents. |

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
Scheduler (UTC): stars 05:30 · collect 05:40 · enrich 05:50 · daily report 06:20 · weekly report Monday 06:40 · repo sync after each report (only with a token).

### 3.9 Paperclip plugin `vantik.kinly`

- **Capabilities**: `ui.page.register`, `ui.sidebar.register`, `ui.dashboardWidget.register`, `ui.action.register`, `jobs.schedule`, `plugin.state.read/write`, `companies.read`, `agents.read`, `agents.managed`, `skills.managed`, `agent.tools.register`, `issues.read/create/update`, `issue.comments.create`.
- **Config per company** (`instanceConfigSchema`): `enabled` (default **true** — Angelo wants it everywhere), `apiUrl` (default the Railway domain), `apiToken`, `dailyBrief` (default false), `briefAssigneeAgentId`.
- **UI**: page `/<prefix>/kinly` with tabs Today · This Week · Categories · Persistent · My Stars · Shortlist · Reports · Ask Kinly; repo cards with score, verdict, licence; actions Shortlist / Rate / Make resource / Add to workspace (creates an issue for the Kinly agent with the clone-and-test protocol). Sidebar link. Dashboard widget: today's top 3 + counts.
- **Tools** (`vantik.kinly:*`): `trending`, `search`, `repo`, `report`, `shortlist`, `rate`, `resource`, `research`.
- **Managed agent** `kinly` ("Kinly", `claude_local`, created paused, instructions = `AGENTS.md`: researcher persona, tool usage, the clone → test → rate → resource protocol, never installs or publishes without approval).
- **Managed skill** `kinly`: how any agent uses the tools.
- **Job** `daily-brief` 07:00 UTC: for each enabled company with `dailyBrief`, upsert one issue per day with the daily report (idempotent `originId`).

### 3.10 Deployment

Dockerfile (`node:24-alpine`, `npm ci`, build, `node packages/server/dist/main.js`), `railway.toml` (healthcheck `/api/health`, restart `ON_FAILURE`), volume at `/data` (1 GB), env: `PORT`, `KINLY_DB=/data/kinly.db`, `KINLY_DATA_REPO=angellog/kinly`, `KINLY_API_TOKEN`, optional `GITHUB_TOKEN`, `ANTHROPIC_API_KEY`, `KINLY_LLM_MODEL`. Railway project `kinly`, service from the GitHub repo, public domain generated.

## 4. Build order

1. Scaffold the monorepo, git, CI skeleton. 2. Engine: store → sources (with fixtures) → github client → classify → score → reports → CLI → tests. 3. Backfill locally; commit snapshots + landscape report. 4. Server + scheduler + Dockerfile; deploy to Railway; verify `/api/health` and one real `collect`. 5. Plugin: manifest → worker (tools, jobs, managed agent/skill) → UI → tests → install. 6. Public repo push; Railway connected to the repo. 7. Docs, vault notes, memory. 8. Final review workflow + QA.

## 5. Risks and how they are handled

| Risk | Handling |
|---|---|
| `github.com/trending` HTML changes | Parser tested against a committed fixture; a parse that yields 0 rows fails loudly and the archive source still runs |
| Archive sources stop updating | Each adapter reports `last_available_date`; the daily report prints a "sources" footer; CI has a liveness test marked `net` |
| Rate limits | Pacing from `X-RateLimit-Remaining`; GraphQL batching; keyless mode caps enrichment per run |
| LLM cost | Summaries cached per repo by README hash; `KINLY_LLM_DAILY_CAP` tokens; keyless mode has no LLM at all |
| Railway volume loss | D2: repo is the archive; boot import rebuilds |
| Paperclip plugin install is board-only | Install runs from the local CLI on this Mac (same path kickshot used); documented |
| Plugin SDK version drift | SDK pinned to the host's exact version `2026.1005.0`; manifest validated against the host's own schema before install |
| Secrets | `.env` gitignored, `.env.example` committed, nothing printed, no personal OAuth token on a server (D5) |

## 6. Out of scope (v1)

Auto-installing repos into workspaces without a human; publishing anything to social; star-history backfill per repo beyond snapshot diffs; a web UI outside Paperclip (the public repo's markdown is the public UI).
