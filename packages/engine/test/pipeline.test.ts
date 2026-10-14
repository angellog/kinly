import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { loadConfig } from "../src/config.js";
import { GitHubClient } from "../src/github/client.js";
import * as jobs from "../src/jobs.js";
import { Store } from "../src/store/store.js";
import { fixture, meta } from "./helpers.js";

const dirs: string[] = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function context(fetchImpl: typeof fetch) {
  const root = mkdtempSync(path.join(tmpdir(), "kinly-pipe-"));
  dirs.push(root);
  const config = loadConfig({ root, dataRoot: root, dbPath: ":memory:", githubToken: null, anthropicKey: "", apiToken: null });
  const store = new Store(":memory:");
  const logs: string[] = [];
  const github = new GitHubClient({ token: null, fetchImpl, retries: 0 });
  const ctx = jobs.makeContext(store, config, { fetchImpl, github, scrapeDelayMs: 0, log: (m) => logs.push(m) });
  return { ctx, store, config, logs };
}

const daily = fixture("trending-daily-2026-10-08.html");
const monthly = fixture("trending-monthly-2026-10-08.html");

/** github.com/trending answers from fixtures; api.github.com is unreachable (keyless, offline). */
const offlineGitHub = (async (input: string | URL | Request) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith("https://github.com/trending")) return new Response(url.includes("monthly") ? monthly : daily, { status: 200 });
  return new Response("{}", { status: 503 });
}) as typeof fetch;

const githubDown = (async () => new Response("down", { status: 503 })) as typeof fetch;

describe("daily pipeline (D12)", () => {
  it("stops at a failed collect: no report, no last_daily_ok", async () => {
    const { ctx, store, config } = context(githubDown);
    await assert.rejects(jobs.runDaily(ctx, { date: "2026-10-08", publish: false }), /every trending list failed/);
    assert.equal(store.getMeta("last_daily_ok"), null);
    assert.equal(existsSync(path.join(config.reportsDir, "daily", "2026-10-08.md")), false);
    const runs = store.recentRuns(10);
    assert.ok(runs.some((r) => r.job === "collect" && r.ok === false));
    assert.ok(!runs.some((r) => r.job === "report-daily"));
    store.close();
  });

  it("runs keyless and offline end to end, marks the day done, and says it is degraded", async () => {
    const { ctx, store, config } = context(offlineGitHub);
    const out = await jobs.runDaily(ctx, { date: "2026-10-08", publish: false });
    assert.equal(store.getMeta("last_daily_ok"), "2026-10-08");
    assert.deepEqual(out["credentials"], { github: "absent", anthropic: "absent" });
    const md = readFileSync(path.join(config.reportsDir, "daily", "2026-10-08.md"), "utf8");
    assert.match(md, /Kinly Daily — 2026-10-08/);
    assert.match(md, /Degraded run/);
    assert.match(md, /Credentials: github absent, anthropic absent/);
    assert.ok(existsSync(path.join(config.dataDir, "snapshots")), "snapshots archived");
    const jobsRun = new Set(store.recentRuns(20).map((r) => r.job));
    for (const j of ["collect", "enrich", "classify", "score", "report-daily", "export"]) assert.ok(jobsRun.has(j), `no runs row for ${j}`);
    store.close();
  });
});

describe("boot import and publish guards (D3, D4, D5)", () => {
  it("rebuilds an empty store from the data repo's manifest over raw URLs, refusing paths outside data/", async () => {
    const snapshot = { source: "larsbijl-archive", list_date: "2026-10-07", written_at: "x", lists: [{ source: "larsbijl-archive", window: "daily", list_date: "2026-10-07", language_list: "go", fetched_at: "x", entries: [{ full_name: "ollama/ollama", rank: 1 }] }] };
    const files: Record<string, string> = {
      "data/manifest.json": JSON.stringify({ files: ["data/snapshots/larsbijl-archive/2026-10/2026-10-07.json", "reports/daily/2026-10-07.md", "../etc/passwd", "packages/evil.js"] }),
      "reports/daily/2026-10-07.md": "# Kinly Daily — 2026-10-07\n",
      "data/snapshots/larsbijl-archive/2026-10/2026-10-07.json": JSON.stringify(snapshot),
    };
    const requested: string[] = [];
    const raw = (async (input: string | URL | Request) => {
      const url = String(input);
      requested.push(url);
      const key = url.replace("https://raw.githubusercontent.com/angellog/kinly-data/main/", "");
      return key in files ? new Response(files[key], { status: 200 }) : new Response("404", { status: 404 });
    }) as typeof fetch;
    const { ctx, store } = context(raw);
    const got = await jobs.fetchDataFromRepo(ctx, { fetchImpl: raw });
    assert.equal(got.files, 2);
    assert.ok(!requested.some((u) => u.includes("passwd") || u.includes("evil")));
    const imported = jobs.importData(ctx);
    assert.ok(imported.appearances >= 1);
    assert.equal(store.signals("ollama/ollama").distinct_days, 1);
    assert.equal(imported.reports, 1);
    assert.match(store.getReport("daily", "2026-10-07")?.markdown ?? "", /Kinly Daily/);
    store.close();
  });

  it("publish is a no-op without a token and refuses the owner's gh token unless asked", async () => {
    const { ctx, store } = context(offlineGitHub);
    assert.deepEqual(await jobs.publishToRepo(ctx), { committed: false, reason: "no token" });
    const root = mkdtempSync(path.join(tmpdir(), "kinly-pub-"));
    dirs.push(root);
    const ghConfig = loadConfig({ root, dataRoot: root, dbPath: ":memory:", githubToken: "gho_x", githubTokenSource: "gh", anthropicKey: "", apiToken: null });
    const ghCtx = jobs.makeContext(store, ghConfig, { fetchImpl: offlineGitHub, log: () => undefined });
    assert.deepEqual(await jobs.publishToRepo(ghCtx), { committed: false, reason: "gh token refused" });
    store.close();
  });
});

describe("curated summaries", () => {
  it("applies valid entries, follows aliases, and skips the rest", () => {
    const { ctx, store } = context(offlineGitHub);
    store.ingestSnapshot({ source: "trending-page", window: "daily", list_date: "2026-10-08", language_list: "all", fetched_at: "x", entries: [{ full_name: "new/name", rank: 1 }] });
    store.renameRepo("old/name", "new/name");
    const res = jobs.importSummaries(ctx, [
      { full_name: "old/name", summary: "Does X for Y.", business_use: "Vantik could use it to Z.", category: "mcp-tools" },
      { full_name: "missing/repo", summary: "a", business_use: "b" },
      { full_name: "new/name", summary: "", business_use: "b" },
    ]);
    assert.equal(res.applied, 1);
    assert.deepEqual(res.skipped, ["missing/repo", "new/name"]);
    const r = store.getRepo("new/name");
    assert.equal(r?.summary_source, "llm");
    assert.equal(r?.category, "mcp-tools");
    assert.throws(() => jobs.importSummaries(ctx, { not: "an array" }));
    store.close();
  });
});

describe("pull from server", () => {
  it("imports owner state and resource pages from /api/export, newer wins", async () => {
    const bundle = {
      exported_at: "x", repos: [], appearances: [], star_history: [], user_stars: [], reports: [], meta: {},
      shortlist: [{ full_name: "a/b", status: "testing", note: null, updated_at: "2026-10-12T00:00:00Z" }],
      ratings: [],
      agent_ratings: [{ full_name: "a/b", rating: 3, notes: "ok", test_log: "read-only", agent: "kinly", updated_at: "2026-10-12T00:00:00Z" }],
      resources: [{ full_name: "a/b", generated_at: "2026-10-12T01:00:00Z", markdown: "# a/b\\n" }],
      aliases: [],
    };
    let auth = "";
    const server = (async (_u: string | URL | Request, init?: RequestInit) => {
      auth = String((init?.headers as Record<string, string>)["authorization"]);
      return new Response(JSON.stringify(bundle), { status: 200 });
    }) as typeof fetch;
    const { ctx, store, config } = context(offlineGitHub);
    const res = await jobs.pullFromServer(ctx, { url: "https://kinly.test/", token: "tok", fetchImpl: server });
    assert.equal(auth, "Bearer tok");
    assert.deepEqual(res, { shortlist: 1, ratings: 0, agentRatings: 1, resources: 1 });
    assert.equal(store.getAgentRating("a/b")?.test_log, "read-only");
    assert.ok(existsSync(path.join(config.resourcesDir, "a--b.md")));
    assert.equal((await jobs.pullFromServer(ctx, { url: "https://kinly.test", token: "tok", fetchImpl: server })).resources, 0, "idempotent");
    store.close();
  });
});

describe("review G1 hardening (engine)", () => {
  it("a boot import that cannot fetch a listed file fails instead of half-importing", async () => {
    const files: Record<string, string> = { "data/manifest.json": JSON.stringify({ files: ["data/user/shortlist.json"] }) };
    const flaky = (async (input: string | URL | Request) => {
      const key = String(input).replace("https://raw.githubusercontent.com/angellog/kinly-data/main/", "");
      return key in files ? new Response(files[key], { status: 200 }) : new Response("boom", { status: 503 });
    }) as typeof fetch;
    const { ctx, store } = context(flaky);
    await assert.rejects(jobs.fetchDataFromRepo(ctx, { fetchImpl: flaky }), /could not fetch data\/user\/shortlist.json/);
    store.setMeta(jobs.IMPORT_PENDING, "1");
    assert.throws(() => jobs.exportData(ctx), /still being rebuilt/);
    store.close();
  });

  it("pull refuses names that would escape the resources folder", async () => {
    const bundle = { exported_at: "x", shortlist: [], ratings: [], agent_ratings: [], aliases: [], picks: [], resources: [{ full_name: "../../../../.claude/CLAUDE", generated_at: "2026-10-12T00:00:00Z", markdown: "pwned" }] };
    const server = (async () => new Response(JSON.stringify(bundle), { status: 200 })) as typeof fetch;
    const { ctx, store } = context(offlineGitHub);
    assert.equal((await jobs.pullFromServer(ctx, { url: "https://kinly.test", token: "t", fetchImpl: server })).resources, 0);
    store.close();
  });

  it("Monday's weekly covers the week that just ended", () => {
    assert.equal(jobs.completedWeekEnd("2026-10-12"), "2026-10-11");
    assert.equal(jobs.completedWeekEnd("2026-10-14"), "2026-10-11");
  });
});

describe("rule changes reach already-filed repos (H13)", () => {
  it("reclassifies rule-sourced repos once, refreshes heuristic text, and leaves owner categories alone", async () => {
    const { ctx, store } = context(offlineGitHub);
    const globe = "bilawalsidhu/gods-eye-view";
    store.upsertRepoMeta({ ...meta(globe), description: "A spy satellite simulator in your browser. Live open source spatial intelligence on a photorealistic 3D globe.", topics: ["osint", "geospatial", "gis", "3d-globe", "cesium"] });
    store.setCategory(globe, "security", "rule");
    store.setSummary(globe, { summary: "A globe.", business_use: "Security hygiene; relevant for the client-facing services and stored tokens.", source: "heuristic", hash: "" });
    const mine = "someone/owner-filed";
    store.upsertRepoMeta({ ...meta(mine), description: "A satellite imagery viewer", topics: ["gis"] });
    store.setCategory(mine, "security", "owner");

    const first = jobs.reclassifyOnRuleChange(ctx);
    assert.deepEqual(first.changed, [globe]);
    assert.equal(store.getRepo(globe)?.category, "data-analytics");
    assert.doesNotMatch(store.getRepo(globe)?.business_use ?? "", /Security hygiene/, "the category template moved with the category");
    assert.equal(store.getRepo(mine)?.category, "security", "an owner's category is never overridden");
    assert.deepEqual(jobs.reclassifyOnRuleChange(ctx).changed, [], "runs once per rules version");
    store.close();
  });
});
