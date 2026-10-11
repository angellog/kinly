# Architecture

Kinly is three deliverables built on one engine. The decisions behind it, and the review that changed them, are in [PLAN.md](../PLAN.md).

| Part | Where | Role |
|---|---|---|
| Engine | `packages/engine` | Sources, the GitHub client, the classifier, the scorer, reports and the CLI, over a `node:sqlite` store |
| Server | `packages/server` | The JSON API, the in-process scheduler and the boot import. Runs on Railway |
| Plugin | `packages/paperclip-plugin` | `vantik.kinly` in Paperclip: the console, agent tools, the managed agent and skill, and the brief job |
| Data | [angellog/kinly-data](https://github.com/angellog/kinly-data) | The durable archive: snapshots, repository shards, owner state, reports and resource pages |

## Data flow

1. **Collect.** Kinly scrapes `github.com/trending` once a day. That is three windows for all languages plus ten per-language daily lists, 13 pages in total, about one a second, identified as KinlyBot. A search for new, fast-growing repositories adds candidates. Every list is written to `data/snapshots/<source>/<YYYY-MM>/<date>.json` as observed. Before it is ingested, each daily list is diffed against the previous day's. A list identical to yesterday's is **stalled**: it is archived but earns no appearances.
2. **Backfill.** History from 2025-04-01 comes from the [larsbijl trending archive](https://github.com/larsbijl/trending_archive) (MIT). It has six per-language daily lists and no all-languages list, and the reports state that coverage limit.
3. **Enrich.** GraphQL fetches 25 repositories per query: metadata, topics, licence, latest release, the head of the README, and whether an `ee/` or `enterprise/` tree exists (the open-core tell). Without a token it falls back to REST at 60 requests an hour, in hourly batches. Renamed or transferred repositories are folded into their current name, and the old name becomes an alias.
4. **Star history.** `GET /repos/{o}/{r}/stargazers/history` returns weekly buckets of stars per day. Kinly fetches it for every repository on today's and this week's lists, and for the landscape leaders. It provides the 7-day velocity and the best week.
5. **Classify.** Rule tables assign one of 16 categories ([CATEGORIES.md](CATEGORIES.md)). An LLM pass may refine the category, and the owner's choice always overrides both.
6. **Summarize.** With an Anthropic key, the summary and business use come from Claude (`claude-opus-5-5` by default), capped by a daily token budget. Without a key, a heuristic writes them. Summaries are cached by README hash.
7. **Score.** Score = adoption + maintenance + persistence + licence + relevance, which gives a verdict ([SCORING.md](SCORING.md)).
8. **Report and publish.** The daily, weekly, landscape and resource markdown is written. The engine then exports `data/` and commits everything changed to `kinly-data` in **one** Git Data API commit. Unchanged files are skipped by blob SHA, and the ref update is a compare-and-swap (`force: false`).

## Trust boundaries

- **Code and data are separate repositories.** Railway deploys from `angellog/kinly` and holds no token for it. Its fine-grained PAT can write `angellog/kinly-data` only, so a compromised service cannot change the code it runs.
- **The owner's `gh` login never publishes unattended.** `kinly publish` refuses that token unless `--use-gh-token` is passed by hand.
- **Third-party text is data.** Descriptions, topics and README text are stripped of HTML and control characters, and length-capped, at ingest. The UI renders them as text nodes. Agent tool results wrap them in `<<< >>>`. Prompts and `AGENTS.md` say that text inside the fence is never an instruction.
- **README text is never published.** It stays in SQLite. The public shards carry only Kinly's own summary.
- **Writes need the bearer token.** It is compared in constant time. `/api/export` needs it too. GET routes are cached for five minutes, capped at `limit=100`, and rate-limited per IP.
- **Testing happens in a container.** See [WORKFLOW.md](WORKFLOW.md).

## Scraping position

`github.com/robots.txt` names neither `/trending` nor `/explore`. GitHub's Acceptable Use Policies allow scraping public data for research and archival purposes. Kinly scrapes 13 pages a day, identifies itself, honours `Retry-After`, backs off exponentially on 429 and 5xx, and is capped by a test at 10 languages plus "all".

## Failure behaviour

| Failure | What happens |
|---|---|
| The trending page changes layout | The parser throws on zero rows and the collect stage fails. No report is written, and the scheduler retries once an hour |
| Railway restarts at 05:40 | On boot, and every minute after, the scheduler checks `meta.last_daily_ok` and runs the missed day once |
| No GitHub token | Keyless mode. Reports carry a degraded banner and the footer shows `github absent` |
| A token is rejected | `/api/status` and the report footer show `rejected` the same day |
| The volume is lost | Boot import rebuilds the database from `kinly-data` over raw URLs |
| The LLM hits its cap | Heuristic summaries, and the cap is shown in `/api/status` |
