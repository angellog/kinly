# API

The base URL is the Railway service, for example `https://kinly-api-production.up.railway.app`. Responses are JSON.

- **GET** routes are public, sent with `Cache-Control: public, max-age=300`, and rate-limited per client IP to 60 a minute with a burst of 120.
- **POST** routes and `/api/export` need `Authorization: Bearer <KINLY_API_TOKEN>`.
- Request bodies are JSON objects of at most 64 KB.

## Read

| Route | Parameters | Returns |
|---|---|---|
| `GET /api/health` | — | `{ ok, service, version, started_at }` |
| `GET /api/status` | — | Public: `ok`, `started_at`, `last_daily_ok`, `last_weekly_ok` and store stats. **With the bearer token** it adds credential states (`present`, `absent` or `rejected`), LLM usage, scheduler state and recent runs |
| `GET /api/trending` | `window` = `today`, `week`, `month`, `persistent`, `rising` or `new` (`daily`, `weekly` and `monthly` are also accepted); `category`; `limit` ≤ 100; `min_relevance`; `date` | `{ window, date, count, items: RepoView[] }` |
| `GET /api/repos` | `q`, `category`, `verdict`, `sort` (`score`, `relevance`, `stars`, `recent`, `name`), `starred`, `shortlisted`, `limit` ≤ 100, `offset` | `{ total, items }` |
| `GET /api/repos/:owner/:name` | — | A RepoView plus `appearances`, `star_weeks` and `resource` |
| `GET /api/categories` | — | Each category's label, repo count, BUILD count and owner weight |
| `GET /api/stars` | `limit` ≤ 300 | The owner's stars with their views, star topics and category weights |
| `GET /api/shortlist` | `include_dropped` | The testing bench, `wip` and `wip_limit` (5) |
| `GET /api/reports` | `kind`, `limit` | Report index |
| `GET /api/reports/latest` | `kind` (default `daily`) | `{ kind, id, generated_at, markdown }` |
| `GET /api/reports/:kind/:id` | — | One report |
| `GET /api/resources` | — | Resource page index |
| `GET /api/export` | **bearer** | Owner state and pages (`shortlist`, `ratings`, `agent_ratings`, `aliases`, `picks`, `resources`), which is what `kinly pull` reads. Add `?full=1` for the whole store, without README text |

A **RepoView** has these fields:

- `repo`: metadata, summary, business use, category and licence class
- `signals`: days and weeks on trending, first and last seen, best day, stars in the last 7 days, best week
- `score`: the score breakdown, `total`, `verdict` and `reasons`
- `relevance`, `shortlist`, `rating`, `agent_rating` and `starred`

## Write (bearer)

| Route | Body | Effect |
|---|---|---|
| `POST /api/repos/:o/:n/shortlist` | `{ status, note? }`, where `status` is `discovered`, `shortlisted`, `testing`, `rated`, `resourced` or `dropped` | Moves the repository on the bench |
| `POST /api/repos/:o/:n/agent-rating` | `{ rating: 1–5, notes?, test_log?, agent? }` | Records the agent's test and moves the repository to `testing` |
| `POST /api/repos/:o/:n/rating` | `{ rating: 1–5, notes?, verdict_override? }` | Records the owner's rating and moves the repository to `rated` |
| `POST /api/repos/:o/:n/resource` | `{ test_log? }` | Writes the resource page and moves `rated` to `resourced` |
| `POST /api/ask` | `{ question }` | An answer from the database (LLM, capped). Without a key, returns the closest repositories |
| `POST /api/research` | `{ topic?, category? }` | A ranked list plus a synthesis |
| `POST /api/jobs/run` | Answers **202** and runs in the background; the outcome appears in `/api/status` `recent_runs`. `daily` and `collect` only run for today. Answers 503 while a fresh store is still being rebuilt. Body: `{ job, date? }`, where `job` is `daily`, `weekly`, `collect`, `enrich`, `score`, `star-history`, `export`, `publish` or `import` (re-sync from the data repo) | Runs one job. Answers `409` while another is running |

Errors look like `{ "error": "…" }`, with status `400`, `401`, `404`, `409`, `413`, `429`, `503` (writes are off because no token is set), or `500`.
