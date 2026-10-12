# Railway

| | |
|---|---|
| Project | `kinly`, in the workspace "angellog's Projects" |
| Service | `kinly-api`, built from `Dockerfile` in `angellog/kinly` (branch `main`) |
| Volume | 1 GB at `/data`. Holds `kinly.db` and the data checkout at `/data/repo` |
| Healthcheck | `/api/health` |
| Restart | on failure |
| Domain | generated `*.up.railway.app` |

## Watch patterns

Config-as-code (`railway.toml`) is deprecated for new services, with a cutoff on 2026-12-01. Watch patterns are therefore set on the service through the Railway API or MCP `update-service`, not in the repository.

The patterns are:

- `packages/engine/**`
- `packages/server/**`
- `package.json`
- `package-lock.json`
- `tsconfig.base.json`
- `Dockerfile`

A commit that touches only docs, the plugin or research shows as **SKIPPED** in the deployment list. Reports and data never trigger a deploy anyway, because they go to `angellog/kinly-data`.

## Variables

| Variable | Value |
|---|---|
| `PORT` | `8787` |
| `KINLY_DB` | `/data/kinly.db` |
| `KINLY_DATA_ROOT` | `/data/repo` |
| `KINLY_DATA_REPO` | `angellog/kinly-data` |
| `KINLY_NO_GH_FALLBACK` | `1` |
| `KINLY_API_TOKEN` | Random, 48 bytes. Also stored as a Paperclip company secret |
| `GITHUB_TOKEN` | **Fine-grained PAT.** Repository access: public repositories (read) plus `angellog/kinly-data` with Contents read/write. **Never** `angellog/kinly`. Expires in at most a year |
| `ANTHROPIC_API_KEY` | A Kinly-only key in its own Console workspace, with a monthly spend limit |
| `KINLY_LLM_MODEL` | Default `claude-opus-5-5` |
| `KINLY_LLM_DAILY_CAP` | Default 400,000 tokens a day, across every LLM path |
| `KINLY_DAILY_CRON` | Default `40 5 * * *` (UTC) |
| `KINLY_WEEKLY_CRON` | Default `40 6 * * 1` (UTC) |

Without `GITHUB_TOKEN`, the service runs keyless. It enriches 20 repositories an hour, reports are marked degraded, and nothing is published to `kinly-data`. Without `ANTHROPIC_API_KEY`, summaries are heuristic.

## Verifying a deploy

```bash
curl -s https://<domain>/api/health
curl -s 'https://<domain>/api/trending?window=week&limit=3'
curl -s https://<domain>/api/status | jq '.credentials, .scheduler, .stats'
```

Check the result in this order:

1. `/api/status` → `scheduler.last_daily_ok` equals today's date after 05:40 UTC.
2. `recent_runs` has one row per stage: `collect`, `enrich`, `star-history`, `classify`, `score`, `report-daily`, `export`, `publish`.
3. A missed day is caught up within the hour after a restart.

## Adding the GitHub token (owner step)

1. Go to https://github.com/settings/personal-access-tokens/new and create a **fine-grained** token:
   - name `kinly-railway`;
   - resource owner `angellog`;
   - expiration 1 year, with a reminder to rotate it;
   - **Only select repositories → `angellog/kinly-data`**;
   - **Repository permissions → Contents: Read and write**. Leave everything else at No access. Read access to public repos is automatic.
2. Put it on Railway without printing it. From `~/Projects/kinly`, with the token on the clipboard, run:
   `railway variables --service kinly-api --set "GITHUB_TOKEN=$(pbpaste)"`.
   Alternatively, use the dashboard: kinly → kinly-api → Variables.
3. Check it: `/api/status` with the bearer token should show `credentials.github: present`. From then on, Railway is the only writer of `kinly-data`; see [WORKFLOW.md](WORKFLOW.md).
