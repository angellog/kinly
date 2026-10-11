import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { loadConfig } from "../src/config.js";
import { GitHubClient } from "../src/github/client.js";
import * as jobs from "../src/jobs.js";
import { Store } from "../src/store/store.js";
import { fixture } from "./helpers.js";

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
