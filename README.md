# Project Kinly

**GitHub trend intelligence, built by [Vantik Systems](https://github.com/angellog).** Kinly reads GitHub's trending lists every day. For each repository it tells you what it is for and whether it is worth an hour of your time. It also keeps the record of what trended over the last 18 months.

Every repository gets:

- **What it does**, in one or two plain sentences.
- **How a business could use it.** Tuned for Vantik Systems (AI transformation advisory, a content pipeline, a multi-agent operation) and FeetBit (sneaker retail on Instagram and WhatsApp).
- **A licence class:** permissive, weak copyleft, strong copyleft or source-available, plus open-core detection.
- **A Kinly score and verdict.** The score is 0–100. The verdict is BUILD, WATCH or SKIP.
- **Trend history:** days and weeks on trending, best day, best week, and a 7-day star velocity from GitHub's stargazers history.

**Reports, resource pages and data:** [angellog/kinly-data](https://github.com/angellog/kinly-data).

| Report | Where | What is in it |
|---|---|---|
| Daily | `reports/daily/YYYY-MM-DD.md` | Top 10 today, five picks that are new and relevant, repeat trenders, new entrants, picks by category |
| Weekly | `reports/weekly/YYYY-Www.md` | Top 15 of the week, top 5 per category, rising, persistence leaderboard, five repositories to test this week, each with a 15-minute plan |
| Landscape | `reports/landscape-2025-04-to-2026-10.md` | The 18-month view: the repositories that kept trending, month by month, category waves |
| Resource pages | `resources/<owner>--<repo>.md` | One page per tested repository: what it is, why it trended, business use, quick start in a container, licence note, test log, ratings |

## How it works

```
github.com/trending ─┐                      ┌──────────────── Railway: kinly ────────────────┐
larsbijl archive ────┤  collect → enrich →  │  SQLite on a volume · JSON API · daily 05:40   │──▶ angellog/kinly-data
GitHub search ───────┤  classify → score →  │  pipeline (stage-gated, catches up after a     │    (reports, resources,
stargazers history ──┤  report → publish    │  restart) · weekly on Mondays                  │     snapshots, user state)
your GitHub stars ───┘                      └─────────────────────┬──────────────────────────┘
                                                                  │ https
                                      Paperclip plugin vantik.kinly (console, 8 agent tools,
                                      a managed Kinly researcher, a skill, a daily brief)
```

- `packages/engine` holds the sources (trending page, larsbijl archive, GitHub search, stars), the GitHub client (REST, GraphQL and stargazers history), the classifier (16 categories), the scorer, the reports and the `kinly` CLI. It stores everything in SQLite through `node:sqlite`, with no native modules.
- `packages/server` serves the JSON API and runs the scheduler. It is deployed to Railway.
- `packages/paperclip-plugin` is the Paperclip plugin `vantik.kinly`.

Data and code live in separate repositories on purpose. The service that writes reports holds a token for `kinly-data` only, never for this repository. A compromised service therefore cannot change the code it runs. The full design and its review are in [PLAN.md](PLAN.md).

## Quick start (local)

```bash
git clone https://github.com/angellog/kinly && cd kinly
git clone https://github.com/angellog/kinly-data ../kinly-data
cp .env.example .env              # KINLY_DATA_ROOT=../kinly-data is already set
npm ci && npm run build
node packages/engine/dist/src/cli.js import       # load the archive into .kinly/kinly.db
node packages/engine/dist/src/cli.js list week --limit 10
node packages/engine/dist/src/cli.js show vllm-project/vllm
```

Run the API locally:

```bash
KINLY_API_TOKEN=$(openssl rand -hex 24) KINLY_SCHEDULER=off node packages/server/dist/src/main.js   # binds 127.0.0.1 locally; tokens under 32 chars disable writes
curl 'http://localhost:8787/api/trending?window=week&limit=5'
```

CLI commands include `collect`, `backfill`, `enrich`, `star-history`, `classify`, `summarize`, `score`, `report daily|weekly|landscape`, `daily`, `list`, `show`, `shortlist`, `rate`, `resource`, `export`, `import`, `publish` and `status`. `node packages/engine/dist/src/cli.js help` prints them all.

Without a `GITHUB_TOKEN`, Kinly still runs, in a degraded mode. It scrapes the trending page, enriches a small batch each hour, and labels every report **degraded** when fewer than half the listed repositories are enriched. Without an `ANTHROPIC_API_KEY`, summaries come from the README and description instead of a model.

## Reading a report

- **Verdict.** BUILD means worth testing now: score ≥ 70, relevance ≥ 50, and not source-available. WATCH means 45–69. SKIP covers everything below 45 and anything archived. See [docs/SCORING.md](docs/SCORING.md).
- **Picks.** Picks are new and relevant. They leave out what you already starred, already shortlisted, or were offered in the last 30 days. At most five repositories sit on the testing bench at once.
- **Coverage.** Before 2026-10-08, the daily record is the larsbijl archive, which keeps six per-language lists and no all-languages list. Every landscape report says so.

## Rating a repository

Use the Kinly console in Paperclip, or the API:

```bash
curl -X POST -H "authorization: Bearer $KINLY_API_TOKEN" -H 'content-type: application/json' \
  -d '{"rating":4,"notes":"replaced our caption scheduler"}' \
  https://<kinly-host>/api/repos/owner/name/rating
```

Repositories are tested in a throwaway container, never on a machine that holds credentials. See [docs/WORKFLOW.md](docs/WORKFLOW.md).

## Docs

- [ARCHITECTURE](docs/ARCHITECTURE.md)
- [API](docs/API.md)
- [CATEGORIES](docs/CATEGORIES.md)
- [SCORING](docs/SCORING.md)
- [PAPERCLIP](docs/PAPERCLIP.md)
- [RAILWAY](docs/RAILWAY.md)
- [WORKFLOW](docs/WORKFLOW.md)

## Licence

[MIT](LICENSE) © Vantik Systems, for the code and for Kinly-authored prose. Repository names and descriptions are quoted from their owners for identification and remain under their owners' terms. The larsbijl trending archive snapshots carry that archive's MIT notice.
