# github.com/trending mechanics and the GitHub REST/GraphQL APIs for live trend detection (Project Kinly)

Research window: 2025-04-01 to 2026-10-08. All live observations below were made on **2026-10-08 between 07:30 and 07:50 UTC** from this machine with the authenticated `gh` CLI (account `angellog`, OAuth token scopes `gist, read:org, repo, workflow`) and plain `curl`. Anything older than the window is labelled **(pre-window)**. Anything I could not confirm is labelled **UNVERIFIED**.

**Headline finding that changes Kinly's design:** on 2026-06-30 GitHub gated the stargazer *listing* endpoints (REST `/repos/{owner}/{repo}/stargazers`, the `/stargazers` UI page, and in practice the GraphQL `stargazers` connection) to repository admins and collaborators, and on 2026-09-04 shipped a replacement, `GET /repos/{owner}/{repo}/stargazers/history`, which returns weekly buckets with per-day star counts for any public repository, unauthenticated, back to the repository's creation week. The classic "star timestamps via `application/vnd.github.star+json`" velocity technique the task asked about **no longer works for repositories you do not own**; the new endpoint is cheaper and officially sanctioned. Everything in Q3 below is built on that.

---

## Q1. github.com/trending: URL parameters, live HTML structure, rows per page, JS requirement, robots.txt, failure modes

### Takeaway
The page is fully server-rendered (plain `curl` with or without a User-Agent returns the rows), keyed on `article.Box-row`, and today returned **13 / 11 / 25 rows** for daily / weekly / monthly — not a fixed 25. GitHub documents no API for it, the ranking is undocumented, the page's data pipeline has stalled at least twice in the window (Nov 2025, Apr 2026), and robots.txt does not mention `/trending` at all.

### Cited Findings

**URL parameters (all verified live, HTTP 200 each):**
- `https://github.com/trending` (defaults to daily), `?since=daily|weekly|monthly`, `/trending/<language-slug>` (e.g. `/trending/python?since=daily`), `?spoken_language_code=<ISO-639-1>` (e.g. `/trending/typescript?since=weekly&spoken_language_code=en`), and `/trending/developers` — [live fetch, verification log #3](https://github.com/trending)
- The page's own `<select>` markup offers **830 language slugs** (`href="/trending/<slug>?since=..."`, e.g. `1c-enterprise`, `abap`, `adblock-filter-list`) and **184 spoken-language codes** — [live HTML, log #2](https://github.com/trending?since=daily)
- An invalid `since=` value (`?since=bogus`) silently falls back to the daily list — the row list was byte-for-byte identical to `?since=daily` — [live fetch, log #3/#13](https://github.com/trending?since=bogus)
- An unknown language slug (`/trending/not-a-language-xyz`) returns **HTTP 200 with zero `article.Box-row` elements**, not a 404 — [live fetch, log #3](https://github.com/trending/not-a-language-xyz)

**Rows per page (observed 2026-10-08 07:33 UTC):**
- `?since=daily` → **13 rows**; `?since=weekly` → **11 rows**; `?since=monthly` → **25 rows**; `/trending/python?since=daily` → **12 rows**; `/trending/typescript?since=weekly&spoken_language_code=en` → **25 rows**; `/trending/developers` → **25 rows** — [live fetch, log #3](https://github.com/trending)
- GitHub's own (pre-window, 2013) description says "only the top 25 projects are featured", "across three time frames — daily, weekly, and monthly — by updating the data eight times a day", with trending "determined by various data points like stars, forks, commits, follows, and pageviews" — [GitHub blog, Jon Rohan, 2013-08-13, via mirror](https://www.plushcap.com/content/github/blog/github-explore-what-is-trending-on-github) **(pre-window)**
- Two fetches of `?since=daily` 20 seconds apart returned the identical 13-row ordered list — [log #11](https://github.com/trending?since=daily)

**Served without JS:** `curl` with no User-Agent returned HTTP 200, 608,270 bytes, 13 `article.Box-row` elements; with a Chrome UA, 611,764 bytes, 13 rows. The response carries `cache-control: max-age=0, private, must-revalidate`, a weak `etag: W/"..."`, and `vary: X-PJAX, ... Turbo-Frame, ..., Accept-Encoding, Accept` — [log #3, #11](https://github.com/trending?since=daily)

**Current HTML structure, recorded from row 1 of the live page (repo `morluto/rea`)** — [raw markup, log #6](https://github.com/trending?since=daily):
- Row container: `<article class="Box-row">` (the developers page uses `<article class="Box-row d-flex" id="pa-<login>">`, so match `article.Box-row`, not the exact class string).
- Repo link: `h2.h3.lh-condensed > a.Link` with `href="/owner/repo"`. Its `data-hydro-click` JSON carries `"record_id":1209966933`, and the Star button's payload on the same row carries `"repository_id":1209966933` — i.e. the **numeric repository id is in the page**, usable with `GET /repositories/{id}` and stable across renames.
- Description: `<p class="col-9 color-fg-muted my-1 tmp-pr-4">`. Note the utility class is now `tmp-pr-4`, not `pr-4`; the footer spans are `tmp-mr-3`, `tmp-ml-0`. Two of 25 monthly rows had no `<p>` at all (repos without a description) — [log #13].
- Language: `<span itemprop="programmingLanguage">TypeScript</span>` preceded by `<span class="repo-language-color" style="background-color: #3178c6">`.
- Total stars / forks: `<a href="/owner/repo/stargazers" class="tmp-mr-3 Link Link--muted d-inline-block">17,677</a>` and the same with `/forks` → `1,851` (comma-formatted integers).
- Built by: `<span class="tmp-mr-3 d-inline-block">Built by <a data-hovercard-type="user" href="/login"><img class="avatar ... avatar-user" alt="@login"></a>...` (up to five contributor logins).
- Period stars: `<span data-view-component="true" class="d-inline-block float-sm-right"><svg/> 4,655 stars today</span>`. The exact strings are `N stars today` (daily), `N stars this week` (weekly), `N stars this month` (monthly); observed ranges today: daily 44–4,655, weekly 639–6,912, monthly 2,181–30,152, python-daily 18–766 — [log #14].
- Page `<h1>` is `Trending`. No "being dissected" or outage notice text was present.

**robots.txt (fetched live, 16,739 bytes, 475 Disallow lines):**
- Neither `/trending` nor `/explore` appears anywhere in the file — [log #4](https://github.com/robots.txt)
- The `User-agent: *` group disallows path patterns such as `/*/*/stargazers`, `/*/*/watchers`, `/*/*/forks`, `/*/*/commits/`, `/*/tree/`, `/search$`, `/*.atom$`, `/*/archive/`, `/*/raw/`; `/trending` is not among them — [log #4](https://github.com/robots.txt)
- A separate group for `GPTBot, OAI-SearchBot, ClaudeBot, anthropic-ai, PerplexityBot` lists 15 `Allow` lines (marketing pages) and the same 177 path-pattern Disallows, with **no root `Disallow: /`**; only `Bytespider` gets `Disallow: /` — [log #4/#13](https://github.com/robots.txt)

**Known failure modes (in window):**
- **Frozen lists, 2025-11-13 → 2025-12-04.** Users reported the same repositories on Trending while star counts kept updating; GitHub's adrianTJenkins wrote on 2025-12-03 "we are aware of the trending developer and repo lists failing to be updated since November 13" and on 2025-12-04 "Today we've fixed a data pipeline issue that was likely preventing the trending lists from updating". Follow-ups on Dec 16 and Dec 28 still reported missing/sparse lists; the thread is marked Unanswered — [community discussion #179946](https://github.com/orgs/community/discussions/179946)
- **Static lists again, April 2026.** A 2026-04-13 bug report states the daily Go and Java lists are "largely unchanged across consecutive days" while "Star counts continue to update normally, but the ranking or project selection does not seem to refresh"; only an automated bot acknowledgment, no staff reply — [community discussion #192324](https://github.com/orgs/community/discussions/192324)
- **Sunset announced and paused (pre-window).** GitHub announced in 2022 that the Trending tab would be shut down on September 30 (2022) citing stagnant usage and a hard-to-maintain data pipeline; after ~300 comments the removal was paused; a June 2025 reply in the thread says the page was removed from the dashboard/prominent navigation but is still served at github.com/trending — [community discussion #31644](https://github.com/orgs/community/discussions/31644); the "GitHub will discontinue Trending on 30 September" article circulating is this 2022 item (its only source link is discussion 31644) — [tabnews article](https://www.tabnews.com.br/gugadeschamps/github-vai-descontinuar-pagina-trending-com-repositorios-e-desenvolvedores-em-destaque-na-plataforma)
- **Short lists.** Daily and weekly lists today held 13 and 11 rows, i.e. fewer than the nominal 25 — [log #3].
- **Ranking is undocumented.** The only "answer" in GitHub's community forum (2025-06-24, a community member, not staff) says "GitHub hasn't published the exact algorithm (probably to prevent gaming)" and speculates on star velocity vs history, engagement beyond stars, time weighting, per-language thresholds — [community discussion #163970](https://github.com/orgs/community/discussions/163970)
- **"Trending is being dissected" message: UNVERIFIED.** No source in the window, and no occurrence on the live page today; two targeted searches returned nothing — [search 1](https://github.com/orgs/community/discussions/179946), [search 2](https://surrealdb.com/blog/we-think-we-have-broken-github.md) (neither contains the phrase).

### Inferences
- Select by structure (`article.Box-row`, `h2 a[href]`, `p`, `span[itemprop=programmingLanguage]`, `a[href$="/stargazers"]`, `a[href$="/forks"]`, `span.float-sm-right`) rather than by Primer utility classes; the `pr-4`→`tmp-pr-4` rename shows the utility classes are mid-migration and will change again.
- Parse the numeric `record_id`/`repository_id` out of `data-hydro-click`; it lets Kinly dedupe across renames and query `GET /repositories/{id}` directly.
- Treat **0 rows as an alarm**, never as "nothing trending": a typo in the language slug and a pipeline outage both produce HTTP 200 with no rows. Treat a list identical to yesterday's for N consecutive days as a probable pipeline stall (Nov 2025 and Apr 2026 pattern) and fall back to the API path in Q2/Q3.
- Three fetches a day per (window × language) is far below anything GitHub would notice; the page is cheap to scrape but *untrustworthy as the sole signal*. Kinly should store the per-row `N stars today/this week/this month` numbers because they are the only GitHub-published velocity figure for repos not yet in Kinly's own history.
- Fetch with a browser-like User-Agent, send `If-None-Match` with the stored weak ETag, and respect `cache-control: private` (no shared cache).

### Gaps
- Refresh cadence today is unknown; the 2013 "eight times a day" figure is pre-window and the 2025/2026 stalls show it is not reliable.
- Whether the daily list is capped below 25 by a quality threshold or by the pipeline is not documented anywhere I found.

---

## Q2. GitHub REST search for repositories: syntax, the 1,000-result cap, the 30/min limit, approximating "trending"

### Takeaway
`GET /search/repositories` with `q=created:>=YYYY-MM-DD stars:>N&sort=stars` is a workable, official "new and fast-growing" detector (152 repos created in the last 14 days with >300 stars today); it is limited to 1,000 results per query (hard 422 at page 11×100), 30 requests/min authenticated, 256-character queries and ≤5 boolean operators.

### Cited Findings
- Rate limit: "30 requests per minute for all search endpoints" when authenticated, except code search at 10/min; unauthenticated "up to 10 requests per minute" — [REST search docs](https://docs.github.com/en/rest/search/search?apiVersion=2022-11-28). Live headers on a search call: `X-Ratelimit-Limit: 30`, `X-Ratelimit-Resource: search`, `X-Ratelimit-Used: 1` — [log #7]. The `rate_limit` endpoint reports `search.limit 30`, `code_search.limit 10`, `core 5000`, `graphql 5000` — [log #4].
- Result cap: "up to 1,000 results for each search" — [REST search docs](https://docs.github.com/en/rest/search/search?apiVersion=2022-11-28). Live: `q=stars:>1000&per_page=100&page=11` → `422 "Only the first 1000 search results are available"` — [log #5].
- Query limits: a query fails if longer than 256 characters (not counting operators/qualifiers) or using more than five `AND`/`OR`/`NOT` operators → "Validation failed" — [REST search docs](https://docs.github.com/en/rest/search/search?apiVersion=2022-11-28)
- Parameters: `q` (required), `sort` ∈ `stars | forks | help-wanted-issues | updated` (default "best match"), `order` ∈ `desc` (default) | `asc` (ignored without `sort`), `per_page` max 100 (default 30), `page`; `incomplete_results: true` when the query hit the time limit — "Reaching a timeout does not necessarily mean that search results are incomplete" — [REST search docs](https://docs.github.com/en/rest/search/search?apiVersion=2022-11-28)
- Qualifier syntax: `created:<YYYY-MM-DD`, `pushed:>YYYY-MM-DD` (results then sorted by most recent commit on any branch), `stars:n`, `stars:n..n`, `stars:>=n`, `forks:n..n`, `size:n..n` (KB), `topic:TOPIC`, `topics:>n`, `language:LANG`, `license:apache-2.0`, `is:public`, `archived:false`, `template:false`, `fork:true|only`, `user:`/`org:`, `in:name,description,readme,topics` (default searches name, description, topics), `mirror:`, `good-first-issues:>n`, `help-wanted-issues:>n`, `followers:n..n`; dates are ISO 8601 `YYYY-MM-DD` with optional `THH:MM:SS+00:00`; `>`, `<`, `>=`, `<=`, `..` ranges; multi-word terms need quotes; case-insensitive — [Searching for repositories](https://docs.github.com/en/search-github/searching-on-github/searching-for-repositories)
- Live approximation of "trending now": `q=created:>=2026-09-24 stars:>300`, `sort=stars` → `total_count 152`, `incomplete_results false`; top items `storytold/photocraft` 19,925★ (created 2026-09-30), `Niko1221/Strata` 17,568★, `openai/math` 10,642★ (created 2026-10-06), `CopilotKit/OpenDots` 4,300★, `storytold/filmcraft` 3,791★ — [log #5]
- Live topic+freshness query: `q=topic:instagram pushed:>=2026-09-01 stars:>50`, `sort=updated` → `total_count 84`; note the top hits were spam-ish ("Whatsapp-spy", "INSTAHACK") plus `mvanhorn/last30days-skill` 63,718★ — [log #5]
- The `text-match` media type (`application/vnd.github.text-match+json`) returns highlight metadata for name and description — [REST search docs](https://docs.github.com/en/rest/search/search?apiVersion=2022-11-28)
- GraphQL `search(type: REPOSITORY, first: 50)` on the same query returned `repositoryCount 152` at `cost 1` — [log #8]

### Inferences
- Because results are capped at 1,000, **slice the window**: run one query per `created:` day (or per language) and never page past 10×100. For Kinly's daily job, ~10–20 search calls (one per slice) fits comfortably in a single 30/min window if issued serially with a 2-second gap.
- "Trending" ≈ stars gained in a window, not total stars. The search API cannot express "gained N stars since Monday", so use search only to **generate candidates** (created in the last 7/14/30 days with a stars floor; or `pushed:` recently with a higher floor for older repos), then rank candidates with the star-history endpoint in Q3.
- Topic queries attract spam-named repos; always enrich and apply an archived/disabled/license/README-size filter before ranking (Q4).

### Gaps
- GitHub does not document how "best match" is computed; for deterministic runs always pass `sort`.

---

## Q3. Star timestamps and star velocity: `star+json`, the 40,000 cap, GraphQL `STARRED_AT`, and what replaced them in 2026

### Takeaway
Per-stargazer timestamps are gone for repos you do not administer (REST returns 404, GraphQL returns an empty connection), but `GET /repos/{owner}/{repo}/stargazers/history` (shipped 2026-09-04) gives weekly buckets with per-day counts, unauthenticated, one core request per repo — a cheaper and more accurate velocity source than paging stargazers ever was.

### Cited Findings

**The restriction:**
- Changelog 2026-06-30, "Upcoming access restrictions to public API endpoints and UI views": REST `/repos/{owner}/{repo}/stargazers` and `/repos/{owner}/{repo}/subscribers` become "limited to admins and collaborators"; `/users/{username}/subscriptions` is deprecated and "will remain accessible but will return empty responses"; UI views `/stargazers`, `/stargazers/you_know`, `/watchers` restricted; "Some users may begin receiving empty responses or a 403 Forbidden status"; reason: the lists "have been misused to collect user data for spam" — [GitHub changelog](https://github.blog/changelog/2026-06-30-upcoming-access-restrictions-to-public-api-endpoints-and-ui-views/)
- REST starring docs: "In July 2026, to ensure responsible use of this data and to protect users from misuse, we are introducing new access restrictions to the endpoints related to starring. Access to the stargazers listing endpoints will be limited to admins and collaborators." — [REST starring docs](https://docs.github.com/en/rest/activity/starring?apiVersion=2022-11-28)
- Community: "As of June 30 all repositories now return a 404 for /stargazers"; a 2026-07-17 comment reports "github has sneakily added the stargazer restriction to GraphQL"; Star History, OSS Insight and gitranc.com broke; a 2026-09-09 comment says Star History works again via the new API; no human staff reply in the thread — [community discussion #201209](https://github.com/orgs/community/discussions/201209)
- star-history.com (2026-07-06, updated Sep 2026): authenticated requests for repos you do not own/collaborate on return "Not Found"; tokens created with no scopes stop working even for your own repos; the September replacement endpoint "returns exact daily star counts for any public repository back to its creation" — [star-history.com blog](https://www.star-history.com/blog/github-stargazer-api-restriction/)
- **Live confirmation (2026-10-08):** `GET /repos/n8n-io/n8n/stargazers?per_page=2` with `Accept: application/vnd.github.star+json` → **404 Not Found**; same for `mvanhorn/last30days-skill` and `openai/math` (with and without the media type); `angellog/vantik-case` (own repo) → **200** — [log #7]. GraphQL `repository(owner:"n8n-io",name:"n8n"){ stargazerCount stargazers(first:2, orderBy:{field:STARRED_AT,direction:DESC}){ totalCount edges{starredAt} } }` → `stargazerCount 206858` but `stargazers { totalCount: 0, edges: [] }` (same for `openai/math`) — [log #7]
- **Still works:** `GET /user/starred` and `GET /users/{username}/starred` with `star+json` → 200 with `starred_at` (verified on `angellog` and on `cathrynlavery`); `sort=created|updated`, `direction=asc|desc`, `per_page` max 100 — [REST starring docs](https://docs.github.com/en/rest/activity/starring?apiVersion=2022-11-28); [log #7, #12]. `angellog` has **206** public starred repositories (`user(login:"angellog"){ starredRepositories { totalCount } }`); newest: `angellog/ai-instagram-agent` 2026-09-30, `cathrynlavery/diagram-design` 2026-09-30 (45,345★), `charlierguo/gmail` 2026-09-22 — [log #7]
- **The 40,000-stargazer cap is no longer in the docs** (the current starring page does not mention any such limit; it documents only `422 Validation failed, or the endpoint has been spammed`) — [REST starring docs](https://docs.github.com/en/rest/activity/starring?apiVersion=2022-11-28). **UNVERIFIED in-window**; moot now that the listing is gated.

**The replacement, `GET /repos/{owner}/{repo}/stargazers/history`:**
- Changelog 2026-09-04: "New API endpoint provides privacy-safe star history data" — "Retrieve historical star counts with timestamps without exposing individual stargazer data"; docs link `…/starring?apiVersion=2026-03-10#get-repository-star-history` — [GitHub changelog](https://github.blog/changelog/2026-09-04-new-api-endpoint-provides-privacy-safe-star-history-data/)
- Docs: `GET /repos/{owner}/{repo}/stargazers/history`; `per_page` default 30, **max 30**; `page` default 1, **max 100**; response is an array (max 30) of `{ week: int, total: int, days: int[7] }`, "most recent first. Pages move backward toward the repository's creation week, and weeks within a page are ordered newest to oldest"; days "starting on Sunday"; "Weeks without stars contain zero counts"; "Week and day boundaries are not guaranteed to align with UTC"; statuses `200`, `422` — [REST starring docs, 2026-03-10](https://docs.github.com/en/rest/activity/starring?apiVersion=2026-03-10)
- **Live:** `n8n-io/n8n`, `per_page=3`, `X-GitHub-Api-Version: 2026-03-10` → 200, `X-Ratelimit-Resource: core`, body `[{"week":1791072000,"total":348,"days":[91,74,88,91,4,0,0]},{"week":1790467200,"total":683,"days":[94,101,105,102,94,103,84]},{"week":1789862400,"total":793,"days":[113,159,116,95,93,125,92]}]`; `1791072000` = 2026-10-04T00:00:00Z (Sunday), so `days[4]=4` is Thursday 2026-10-08 in progress — [log #12]
- **Live:** works under the default `2022-11-28` version too (`X-Github-Api-Version-Selected: 2022-11-28`, 200) — [log #12]
- **Live:** `page=101` → `422 "Pagination is limited to 100 pages."`; `per_page=31` → 200 (whether it clamps to 30 is UNVERIFIED, output truncated) — [log #12]
- **Live:** young repo `storytold/photocraft` (created 2026-09-30) → exactly two weeks: `[{"week":1791072000,"total":19646,"days":[677,1165,7638,9774,392,0,0]},{"week":1790467200,"total":442,"days":[0,0,0,0,13,112,317]}]` — 9,774 stars on Wednesday 2026-10-07 alone — [log #12]
- **Live, unauthenticated** (`env -i curl`, no token): 200, `x-ratelimit-limit: 60`, `x-ratelimit-resource: core` — public repos need no auth — [log #12]
- **Live:** `GET /repos/n8n-io/n8n/stargazers/count` (also listed in the 2026-03-10 docs path index) → `{"count":206859}` — [log #12]

**Other velocity sources:**
- GH Archive still publishes hourly files: `https://data.gharchive.org/2026-10-07-15.json.gz` → 200, 7,125,323 bytes, `last-modified Wed, 07 Oct 2026 16:05:04 GMT`; the first `WatchEvent` records in it are `{"repo":"skxdoom/UnVaultLauncher","created_at":"2026-10-07T15:00:07Z","action":"started"}` and `LizardByte/Sunshine` — [log #9](https://data.gharchive.org/2026-10-07-15.json.gz)
- GraphQL `rateLimit` returns `nodeCount` alongside `cost/limit/remaining/resetAt` (live: `{"cost":1,"nodeCount":6,"remaining":4980}`) — [log #7]

### Inferences
- **Velocity recipe for Kinly:** for each candidate, one `GET /repos/{o}/{r}/stargazers/history?per_page=4` call (core resource, 5,000/h authenticated) yields today's, this week's and last four weeks' star counts; "stars today" = `days[weekday]` of the first bucket, "stars this week" = `total` of the first bucket, 7-day velocity = sum of the trailing 7 day cells across the first two buckets. 500 candidates/day = 500 core calls = 10% of one hour's budget.
- Summing `total` across all buckets for `storytold/photocraft` gives 20,088 while `stargazerCount` was 19,952; the history counts star *creations*, so un-stars make the sum exceed the live count — store both and never reconcile them to each other.
- Because day boundaries are "not guaranteed to align with UTC", do not compare a history cell against a UTC-dated snapshot of your own; compare history cells to each other (same clock) and `stargazerCount` snapshots to each other.
- GH Archive is the only way to compute velocity for *every* repo on GitHub in one pass (24 files/day, ~7 MB each compressed, no GitHub rate limit) — a reasonable weekly "what did we miss" sweep, but overkill for the daily report.
- Angelo's own 206 stars (`/user/starred` with `star+json`) remain fully readable with timestamps and should seed Kinly's "already in my workspace" list; other users' public star lists (`/users/{login}/starred`) also still work, so a curated list of 10–20 builders' stars is a legitimate secondary signal.

### Gaps
- No document states the response code non-admins receive from GraphQL `stargazers`; observed behaviour is an empty connection (`totalCount 0`) rather than an error — treat `totalCount 0` on a repo with `stargazerCount > 0` as "gated", not "no stars".
- The exact calendar used for `week`/`days` boundaries is not published.

---

## Q4. GraphQL batching for enrichment: fields, point cost, node limits

### Takeaway
One GraphQL request can enrich 25 repositories with description, topics, license, language, dates, counts, latest release and the full README text for **1 point** (nodeCount 500, ~476 KB response); the hard wall is 500,000 nodes per query and 5,000 points/hour, so a daily batch of several hundred repos costs a handful of points.

### Cited Findings
- Node rules: every connection needs `first` or `last` (1–100); "Individual calls cannot request more than 500,000 total nodes"; nodes counted as each top-level connection size plus products of nested sizes — [GraphQL rate/node limits](https://docs.github.com/en/graphql/overview/rate-limits-and-node-limits-for-the-graphql-api)
- Points: users (PATs and apps acting for a user) get 5,000 points/hour; cost = sum of requests each unique connection would need at its `first/last` maximum, divided by 100, rounded, minimum 1; secondary limit 2,000 points/min for GraphQL, 60 s CPU per 60 s; requests taking >10 s are terminated with 502/504 and "deduct extra points" for the next hour — [GraphQL rate/node limits](https://docs.github.com/en/graphql/overview/rate-limits-and-node-limits-for-the-graphql-api)
- **Live 3-repo batch** (fragment with `nameWithOwner description url homepageUrl createdAt pushedAt updatedAt stargazerCount forkCount watchers{totalCount} isArchived isFork isTemplate isDisabled primaryLanguage{name color} licenseInfo{spdxId name} repositoryTopics(first:20){nodes{topic{name}}} latestRelease{tagName publishedAt url} defaultBranchRef{name target{... on Commit{committedDate history(first:1){totalCount}}}} issues(states:OPEN){totalCount} readme: object(expression:"HEAD:README.md"){... on Blob{byteSize text}} stargazers(last:100,…)`) → `rateLimit {cost:1, nodeCount:363}`; returned `n8n-io/n8n` README 4,023 bytes, `latestRelease n8n@2.42.5`, license `NOASSERTION`, 20 topics; `storytold/photocraft` README 26,736 bytes, release `v0.3.0`, 12 topics; `openai/math` no release, 0 topics — [log #8]
- **Live 25-repo alias batch** (same fields minus stargazers, README `text` included) → `rateLimit {cost:1, nodeCount:500}`, 25/25 resolved, 0 missing `HEAD:README.md`, README sizes 3,650–70,133 bytes, 16/25 had topics, 17/25 had a release, 0 with missing/NOASSERTION license, total response 476,473 bytes, query 8,536 bytes — [log #10]
- **Live over-limit probe:** `search(first:100){ nodes{ stargazers(first:100){ edges{ node{ starredRepositories(first:100) …` → error `MAX_NODE_LIMIT_EXCEEDED: "By the time this query traverses to the starredRepositories connection, it is requesting up to 1,000,000 possible nodes which exceeds the maximum limit of 500,000."` — [log #8]
- `object(expression:"HEAD:README.md")` is case-sensitive: the lowercase alias `HEAD:readme.md` returned null for all three repos — [log #8]
- Fine-grained PATs can call GraphQL (since the 2023-04-27 changelog, which lifted the beta's REST-only limitation) **(pre-window)** — [GitHub changelog](https://github.blog/changelog/2023-04-27-graphql-improvements-for-fine-grained-pats-and-github-apps)

### Inferences
- Alias-batch 25–50 repositories per request (25 ≈ 8.5 KB query, 476 KB response with READMEs; 50 would double both and stay at cost 1–2). Keep README text out of the batch for the first pass and fetch it only for the shortlist; use `byteSize` to skip empty/placeholder READMEs.
- Query `object(expression:"HEAD:README.md")`, `"HEAD:readme.md"`, `"HEAD:README.rst"` as three aliases, or use REST `GET /repos/{o}/{r}/readme` (case-insensitive, Contents read) for the shortlist.
- Keep each batch under the 10-second server timeout: README-heavy batches of 25 ran in well under that today, but a timeout costs extra points for an hour, so split rather than grow.

### Gaps
- The docs page does not document `rateLimit.nodeCount`; it is present in live responses.

---

## Q5. Tokens, permissions, secondary limits and pacing

### Takeaway
For Kinly's reads nothing beyond public access is needed (unauthenticated calls even work for star history, at 60/h); authenticate anyway for 5,000/h; a fine-grained PAT scoped to the single `kinly` repo with **Contents: write** (Metadata read is implied) is the minimum for writing report files via `PUT /repos/{o}/{r}/contents/{path}`; pace serially, ≥1 s between writes, honour `retry-after`, use ETags.

### Cited Findings
- Primary limits: unauthenticated 60/h per IP; PAT / user-authorized app 5,000/h per user; GitHub App installation 5,000 minimum (up to 12,500 by repo/user count; 15,000 on Enterprise Cloud); `GITHUB_TOKEN` in Actions 1,000/h per repo — [REST rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api?apiVersion=2022-11-28)
- Secondary limits: max 100 concurrent requests across REST+GraphQL; 900 points/min per REST endpoint (GET/HEAD/OPTIONS = 1 point, most POST/PATCH/PUT/DELETE = 5); 2,000 points/min GraphQL; 90 s CPU per 60 s (≤60 s from GraphQL); content-creation ~80/min and 500/h — [REST rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api?apiVersion=2022-11-28)
- Headers `x-ratelimit-limit/remaining/used/reset/resource`; values can differ between responses because requests are served from multiple regions; on 403/429: if `retry-after` present wait that many seconds; if `x-ratelimit-remaining` is 0 wait until `x-ratelimit-reset`; otherwise wait at least one minute, then back off exponentially; continuing to send while limited "can get your integration banned" — [REST rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api?apiVersion=2022-11-28)
- Best practices: "make requests serially instead of concurrently"; for many POST/PATCH/PUT/DELETE requests "wait at least one second between each request"; "Making a conditional request does not count against your primary rate limit if a 304 response is returned"; follow redirects; "subscribe to webhook events instead of polling" — [REST best practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api?apiVersion=2022-11-28)
- Fine-grained permissions table: `GET /repos/{owner}/{repo}` Metadata (read); `GET /repos/{owner}/{repo}/topics` Metadata (read); `GET …/license` Metadata (read); `GET …/readme`, `GET …/contents/{path}`, `GET …/releases`, `GET …/releases/latest` Contents (read); `PUT /repos/{owner}/{repo}/contents/{path}` Contents (write) (also listed under Workflows write, for `.github/workflows` paths); `GET /user/starred` and `GET /users/{username}/starred` user permission **Starring (read)**; the page says "Some endpoints can also be used to access public resources without these permissions" and defers to each endpoint's docs; `GET /search/repositories` does not appear on the page — [Fine-grained PAT permissions](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens?apiVersion=2022-11-28)
- Contents PUT: required `message` and base64 `content`; `sha` of the existing blob required when updating; `branch` optional (default branch); `committer` must include name+email or 422; "OAuth app tokens and personal access tokens (classic) need the `repo` scope" (plus `workflow` to touch `.github/workflows`); running create/update and delete in parallel conflicts — run serially; GET contents supports files ≤1 MB fully, 1–100 MB only via `raw`/`object` media types, >100 MB unsupported — [REST contents docs](https://docs.github.com/en/rest/repos/contents?apiVersion=2022-11-28)
- REST API versions: `2026-03-10` released 2026-03-10; `2022-11-28` supported until 2028-03-10 and is the default when `X-GitHub-Api-Version` is omitted; each version supported 24 months after its successor; expired versions get `410 Gone` — [REST API versions](https://docs.github.com/en/rest/about-the-rest-api/api-versions?apiVersion=2026-03-10)
- API Terms: "Abuse or excessively frequent requests to GitHub via the API may result in the temporary or permanent suspension" of access; "You may not share API tokens to exceed GitHub's rate limitations" — [GitHub Terms of Service, §H](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service)
- Live: the `rate_limit` endpoint itself did not consume core quota (`core.used 0` after several calls); the search window reset within a minute between probes — [log #4, #5]

### Inferences
- **Token plan:** one fine-grained PAT, resource owner `angellog`, repository access = only the public `kinly` repo, permissions Contents: write (Metadata: read auto-added), 1-year expiry; set `X-GitHub-Api-Version: 2026-03-10` on every call so the Railway service never drifts onto the deprecated default. Classic alternative: `public_repo` scope for a public repo (`repo` per the docs' wording; `public_repo` sufficiency UNVERIFIED here).
- **Daily budget at full scale:** ~15 trending fetches (3 windows × 5 languages), ~20 search calls, ~10 GraphQL batches (≤10 points), ~500 star-history calls, ~10 contents writes — under 600 core requests and 20 search requests per day, i.e. <1% of the hourly budgets even if run in one burst, provided it is serial.
- Use conditional GETs (`If-None-Match`) on the trending page and on the `kinly` repo's own files so re-runs that find nothing new are free.

### Gaps
- Whether a fine-grained PAT with no permissions can call `GET /search/repositories` is not documented; it worked here with an OAuth token, and the endpoint has no listed permission. UNVERIFIED for a fine-grained PAT specifically.

---

## Q6. Terms-of-service posture for scraping /trending for personal use

### Takeaway
GitHub's Acceptable Use Policies define scraping as automated extraction outside the API and prohibit it only for spam and selling personal data; the ToS explicitly says the terms "do not restrict lawful access to or use of the contents of public repositories by third parties"; robots.txt is silent on `/trending`. The one hard line GitHub drew in 2026 was around *per-user* star/watch data, which Kinly does not need.

### Cited Findings
- "Scraping refers to extracting information from our Service via an automated process, such as a bot or webcrawler. Scraping does not refer to the collection of information through our API." Researchers "may use public, non-personal information from the Service for research purposes" if "any publications resulting from that research are open access"; archivists "may use public information from the Service for archival purposes"; information may not be used "for spamming purposes" or "selling personal information, such as to recruiters, headhunters, and job boards" — [GitHub Acceptable Use Policies, §7](https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies)
- Prohibited: "automated excessive bulk activity and coordinated inauthentic activity"; "using our servers for any form of excessive automated bulk activity"; bandwidth "significantly excessive in relation to other users of similar features" may be limited — [GitHub Acceptable Use Policies, §4, §9](https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies)
- ToS §D.8: the terms "do not restrict lawful access to or use of the contents of public repositories by third parties"; §H (API): abuse / excessively frequent requests may lead to suspension, with "a reasonable attempt to warn you via email prior to suspension"; the ToS contains no "no scraping" clause — [GitHub Terms of Service](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service)
- The 2026-06-30 restriction's stated reason: the stargazer/watcher lists "have been misused to collect user data for spam" — [GitHub changelog](https://github.blog/changelog/2026-06-30-upcoming-access-restrictions-to-public-api-endpoints-and-ui-views/)
- robots.txt: `/trending` is not named in any group; AI crawlers (`ClaudeBot`, `anthropic-ai`, `GPTBot`, `PerplexityBot`, `OAI-SearchBot`) are not root-disallowed; only `Bytespider` is — [robots.txt, log #4](https://github.com/robots.txt)

### Inferences
- A few HTTP GETs per day of a public, server-rendered page, used to build a private/public research digest and never to contact or profile people, is squarely the "research/archival, non-personal, non-spam" posture the AUP permits; the only thing that would move Kinly into the grey zone is harvesting the "Built by" logins/avatars. Store repository-level data only; do not persist the contributor logins from the trending rows (or keep them unindexed and never use them for outreach).
- Prefer the API for everything the API can do (search, star history, enrichment, writes) and reserve scraping for the one thing it cannot: the trending lists themselves.

### Gaps
- GitHub publishes no explicit guidance for /trending scrapers; the position above is an inference from the AUP, ToS and robots.txt, not a statement by GitHub.

---

## Sources
- https://github.com/trending?since=daily · https://github.com/trending?since=weekly · https://github.com/trending?since=monthly · https://github.com/trending/python?since=daily · https://github.com/trending/typescript?since=weekly&spoken_language_code=en · https://github.com/trending/developers · https://github.com/trending?since=bogus · https://github.com/trending/not-a-language-xyz (live HTML, 2026-10-08)
- https://github.com/robots.txt (live, 2026-10-08)
- https://docs.github.com/en/rest/search/search?apiVersion=2022-11-28
- https://docs.github.com/en/search-github/searching-on-github/searching-for-repositories
- https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api?apiVersion=2022-11-28
- https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api?apiVersion=2022-11-28
- https://docs.github.com/en/graphql/overview/rate-limits-and-node-limits-for-the-graphql-api
- https://docs.github.com/en/rest/activity/starring?apiVersion=2022-11-28
- https://docs.github.com/en/rest/activity/starring?apiVersion=2026-03-10
- https://docs.github.com/en/rest/repos/contents?apiVersion=2022-11-28
- https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens?apiVersion=2022-11-28
- https://docs.github.com/en/rest/about-the-rest-api/api-versions?apiVersion=2026-03-10
- https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies
- https://docs.github.com/en/site-policy/github-terms/github-terms-of-service
- https://github.blog/changelog/2026-06-30-upcoming-access-restrictions-to-public-api-endpoints-and-ui-views/
- https://github.blog/changelog/2026-09-04-new-api-endpoint-provides-privacy-safe-star-history-data/
- https://github.blog/changelog/2023-04-27-graphql-improvements-for-fine-grained-pats-and-github-apps (pre-window)
- https://github.com/orgs/community/discussions/179946 · https://github.com/orgs/community/discussions/192324 · https://github.com/orgs/community/discussions/163970 · https://github.com/orgs/community/discussions/201209 · https://github.com/orgs/community/discussions/31644 (2022, pre-window)
- https://www.star-history.com/blog/github-stargazer-api-restriction/
- https://www.tabnews.com.br/gugadeschamps/github-vai-descontinuar-pagina-trending-com-repositorios-e-desenvolvedores-em-destaque-na-plataforma (2022 item, pre-window)
- https://www.plushcap.com/content/github/blog/github-explore-what-is-trending-on-github (mirror of GitHub blog 2013-08-13, pre-window)
- https://data.gharchive.org/2026-10-07-15.json.gz
- Web searches (2026-10-08): `github.com/trending "being dissected" message`; `github trending page scraper 25 repositories html changed 2025`; `GitHub trending page sunset discussion community "trending" September 30`; `"currently being dissected" github trending`; `github changelog stargazers list endpoint restricted admins collaborators 2026`; `fine-grained personal access tokens GraphQL API support github changelog`

## Verification log (all run 2026-10-08, 07:30–07:50 UTC, cwd = session scratchpad)
1. `gh auth status` → logged in as `angellog`, token scopes `gist, read:org, repo, workflow`.
2. `curl -sS -L -A "<Chrome UA>" -o trending.html -w ... "https://github.com/trending?since=daily"` → HTTP 200, 611,764 bytes, `text/html`; `grep -c '<article class="Box-row"'` → 13; Python parse of row 1 → link `/morluto/rea`, record_id 1209966933, TypeScript `#3178c6`, 17,677 stars, 1,851 forks, "4,655 stars today"; page offers 830 language slugs and 184 `spoken_language_code` values; 10 `<script>` tags.
3. Loop of `curl` over 8 URLs (daily, weekly, monthly, python daily, typescript weekly+en, since=bogus, bogus language, developers) → all HTTP 200; rows 13 / 11 / 25 / 12 / 25 / 13 / 0 / 25. `curl` with **no** User-Agent → 200, 608,270 bytes, 13 rows.
4. `curl https://github.com/robots.txt` → 200, 16,739 bytes, 475 Disallow lines, groups at lines 3 (AI crawlers), 205 (Bytespider `Disallow: /`), 208–331 (ad/search bots), 335 (`*`); no `trending`/`explore` anywhere. `gh api rate_limit` → core 5000/5000, search 30/30, graphql 5000/5000, code_search 10/10.
5. `gh api -X GET search/repositories -f q='created:>=2026-09-24 stars:>300' -f sort=stars -f per_page=10` → total_count 152, incomplete_results false, top `storytold/photocraft` 19,925★. `… -f q='topic:instagram pushed:>=2026-09-01 stars:>50' -f sort=updated` → total_count 84. `… -f q='stars:>1000' -f per_page=100 -f page=11` → HTTP 422 "Only the first 1000 search results are available".
6. Python dump of row 1 markup after `</h2>` (SVGs stripped) → recorded the description `<p class="col-9 color-fg-muted my-1 tmp-pr-4">`, language span, stargazers/forks anchors, "Built by" span with five `a[data-hovercard-type=user]`, and `span.d-inline-block.float-sm-right` "4,655 stars today"; `<h1>` = Trending; no outage notice.
7. `gh api -i -H "Accept: application/vnd.github.star+json" repos/{n8n-io/n8n, mvanhorn/last30days-skill, openai/math}/stargazers?per_page=2` → **404** each (`X-Ratelimit-Resource: core`); `repos/angellog/vantik-case/stargazers` → 200; `repos/openai/math/stargazers` without the media type → 404. GraphQL `stargazers(first:2, orderBy:STARRED_AT)` on n8n → `stargazerCount 206858`, `stargazers {totalCount 0, edges []}`; same on openai/math; `rateLimit {cost 1, nodeCount 6}`. `gh api -i -H star+json "user/starred?per_page=3&sort=created&direction=desc"` → 200, Link `rel="last"` page=69, newest `angellog/ai-instagram-agent` starred 2026-09-30T18:12:33Z. GraphQL `user(login:"angellog"){starredRepositories{totalCount}}` → 206. `gh api -i -X GET search/repositories -f q='created:>=2026-10-01 stars:>100' -f per_page=1` → `X-Ratelimit-Limit: 30`, `X-Ratelimit-Resource: search`, `X-Ratelimit-Used: 1`.
8. `gh api graphql -F query=@enrich.graphql` (3 repos, fragment listed in Q4) → `rateLimit {cost 1, nodeCount 363, remaining 4979}`; READMEs 26,736 / 4,023 / 4,190 bytes; `HEAD:readme.md` null for all; `stargazers(last:100)` → totalCount 0 for all three. `search(... first:50)` → repositoryCount 152, cost 1. Over-limit query → `MAX_NODE_LIMIT_EXCEEDED … 1,000,000 … maximum limit of 500,000`.
9. `curl -sS -I https://data.gharchive.org/2026-10-07-15.json.gz` → 200, `application/gzip`, 7,125,323 bytes, last-modified 2026-10-07 16:05:04 GMT; `curl -r 0-2000000 … | gunzip | grep -m2 WatchEvent` → `skxdoom/UnVaultLauncher` 15:00:07Z and `LizardByte/Sunshine` 15:00:16Z, `action: started`.
10. Python-built 25-alias GraphQL batch (`names.txt` from the live search, `batch25.graphql` 8,536 bytes) → `rateLimit {cost 1, nodeCount 500, remaining 4976}`, 25 resolved, 0 null, 0 missing `HEAD:README.md`, README sizes 3,650–70,133 bytes, response 476,473 bytes, no errors. (An earlier attempt reported "Could not resolve storytold/huashu-art-motion" — that was a zsh word-splitting bug in my loop that spliced two names, not a GitHub fault.)
11. `curl -I "https://github.com/trending?since=daily"` → `cache-control: max-age=0, private, must-revalidate`, `etag: W/"0623ad7685d4bd9850dbdb469f980204"`, `vary: X-PJAX, X-PJAX-Container, Turbo-Visit, Turbo-Frame, …`; two GETs 20 s apart → identical 13-row ordered list (`/morluto/rea`, `/mattpocock/skills`, `/boykopovar/AnyPS5`, `/ayghri/i-have-adhd`, `/cathrynlavery/diagram-design`, `/addyosmani/agent-skills`, `/EpicGames/raddebugger`, `/thedotmack/claude-mem`, `/manaflow-ai/cmux`, `/trycua/cua`, `/cloudflare/security-audit-skill`, `/tester-army/e2e`, `/DuarteSantos8/openGym`).
12. `curl -sS -L "https://docs.github.com/en/rest/activity/starring?apiVersion=2026-03-10"` → 200, 458,080 bytes; grep found paths `/repos/{owner}/{repo}/stargazers`, `…/stargazers/count`, `…/stargazers/history`. `gh api -i -H "X-GitHub-Api-Version: 2026-03-10" "/repos/n8n-io/n8n/stargazers/history?per_page=3"` → 200, `X-Github-Api-Version-Selected: 2026-03-10`, `X-Ratelimit-Resource: core`, 3 weekly buckets (first `week 1791072000`, `total 348`, `days [91,74,88,91,4,0,0]`), Link `rel="last"` page=100. Same path without the header → 200, version-selected 2022-11-28. `?page=101` → 422 "Pagination is limited to 100 pages."; `?per_page=31` → 200 (count not captured). `/repos/storytold/photocraft/stargazers/history` → 2 buckets, `[677,1165,7638,9774,392,0,0]` and `[0,0,0,0,13,112,317]`. `/repos/n8n-io/n8n/stargazers/count` → 200 `{"count":206859}`. `env -i /usr/bin/curl` (no token) on photocraft history → 200, `x-ratelimit-limit: 60`. `gh api -i -H star+json "users/cathrynlavery/starred?per_page=2"` → 200 with `starred_at` 2026-10-06T14:49:07Z (`pbakaus/impeccable`). (A first run of this step failed with "command not found: head" because a shell variable named `path` clobbered zsh's `PATH`; re-run with `EP`.)
13. Python re-parse of saved pages → `since=bogus` list identical to daily; monthly has 2 rows without a `<p>` description; `1791072000`/`1790467200`/`1789862400` → Sundays 2026-10-04 / 09-27 / 09-20 UTC; AI-crawler robots group (lines 3–204) = 15 Allow + 177 path Disallows, no root `Disallow: /`.
14. Python re-parse with attribute-order-tolerant regex → period strings exactly `N stars today` (daily; 44–4,655), `N stars this week` (weekly; 639–6,912), `N stars this month` (monthly; 2,181–30,152), `N stars today` (python daily; 18–766), `N stars this week` (typescript weekly en; 7–459); developers page rows are `<article class="Box-row d-flex" id="pa-<login>">`.
