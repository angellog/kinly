# Workflow

## Discover → shortlist → test → rate → resource

1. **Discover.** Daily and weekly picks, or any list in the console.
2. **Shortlist.** In the console, press **Shortlist** or **Add to workspace (test)**. The latter also creates an issue for the Kinly agent. At most **five** repositories may be shortlisted or in testing at once. When the bench is full, Kinly offers no new picks until one is rated or dropped.
3. **Test, in a container only.** The Kinly agent works through the protocol in [`AGENTS.md`](../packages/paperclip-plugin/AGENTS.md):
   - `docker run --rm -it node:24 bash` (or `python:3.13`), with no host mounts and no `.env`;
   - `git clone --depth 1 …`, then read the install scripts;
   - `npm install --ignore-scripts` or `pip install --no-deps`;
   - try it on a real Vantik or FeetBit artefact, for about 15 minutes.

   It records an **agent rating** and a test log. That moves the repository to `testing`.
4. **Rate.** The owner rates it 1–5 in the console, with a one-line note on what it replaced or enabled. Only the owner's rating moves a repository to `rated`.
5. **Resource.** **Make resource page** writes `resources/<owner>--<repo>.md` to `kinly-data` on the next sync. The page covers what it is, why it trended, business use, quick start, licence note, test log and ratings. A repository that was `rated` becomes `resourced`.

Nothing is ever installed into a real workspace, published to social media, or pushed to a repository without the owner's approval in the issue thread.

## Who writes `angellog/kinly-data`

- **Before Railway has a `GITHUB_TOKEN`:** this Mac is the only writer. It runs `kinly pull` (shortlist, ratings, agent tests and resource pages from the running server), then `kinly export`, then commits and pushes with `git`; or `kinly publish --use-gh-token` by hand.
- **After the token is set on Railway:** Railway is the **only** writer. Nothing on the Mac commits under `data/`, `reports/` or `resources/`. Before any local edit to that repository, run `git pull --rebase`. Never force-push.
- Railway commits with the Git Data API: one commit per run, containing only changed files, with a compare-and-swap ref update. A rejected update is retried by the next run; it is never forced.

## Daily rhythm

| UTC | What |
|---|---|
| 05:40 | Daily pipeline: stars → collect → enrich → star history → classify → summarize → score → daily report (plus weekly on Mondays) → export → publish |
| 07:00 | Paperclip brief job (companies that opted in) |
| hourly | Catch-up for a missed day; keyless enrichment while there is no token |
