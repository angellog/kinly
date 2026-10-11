import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { classifyRepo } from "./classify/rules.js";
import type { KinlyConfig } from "./config.js";
import { GitHubClient } from "./github/client.js";
import { enrichRepos } from "./github/enrich.js";
import { publishFiles, type PublishFile } from "./github/publish.js";
import { heuristicSummary, Llm } from "./llm/anthropic.js";
import { dailyReport } from "./reports/daily.js";
import { landscapeReport } from "./reports/landscape.js";
import { resourceFileName, resourcePage } from "./reports/resource.js";
import { weeklyReport } from "./reports/weekly.js";
import { buildProfile } from "./score/profile.js";
import { fetchLarsbijlDay } from "./sources/larsbijl-archive.js";
import { fetchNewHighGrowth } from "./sources/gh-search.js";
import { listSnapshotFiles, readSnapshotFile, writeSnapshotFile } from "./sources/snapshot-files.js";
import { fetchUserStars, readStarsFile, type UserStar } from "./sources/stars.js";
import { fetchAllTrending } from "./sources/trending-page.js";
import { fetchVitaletsComments, parseVitaletsComment } from "./sources/vitalets-archive.js";
import type { Store } from "./store/store.js";
import type { Profile, RepoRecord, Snapshot } from "./types.js";
import { addDays, dateRange, isoDate, isoNow, isoWeek } from "./util/dates.js";
import { isFullName } from "./util/text.js";
import { rescoreAll, repoView } from "./views.js";

/**
 * The jobs: every unit of work the CLI, the scheduler and the API can run.
 * Each one records a `runs` row and returns plain stats.
 */

export type Logger = (msg: string) => void;

export interface JobContext {
  store: Store;
  config: KinlyConfig;
  github: GitHubClient;
  llm: Llm;
  log: Logger;
  fetchImpl?: typeof fetch;
}

export function makeContext(store: Store, config: KinlyConfig, options: { log?: Logger; fetchImpl?: typeof fetch; llm?: Llm; github?: GitHubClient } = {}): JobContext {
  const log = options.log ?? ((m: string) => console.error(`[kinly] ${m}`));
  const github = options.github ?? new GitHubClient({ token: config.githubToken, log, ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}) });
  const llm = options.llm ?? new Llm({ apiKey: config.anthropicKey, model: config.llmModel, dailyCapTokens: config.llmDailyCap, store, log });
  return { store, config, github, llm, log, ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}) };
}

async function recorded<T extends Record<string, unknown>>(ctx: JobContext, job: string, fn: () => Promise<T>): Promise<T> {
  const id = ctx.store.startRun(job);
  try {
    const stats = await fn();
    ctx.store.finishRun(id, true, stats);
    return stats;
  } catch (err) {
    ctx.store.finishRun(id, false, {}, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

// ─── profile ─────────────────────────────────────────────────────────────────

export function profilePath(config: KinlyConfig): string {
  return path.join(config.dataDir, "user", "profile.json");
}

export function loadProfile(ctx: JobContext): Profile {
  const file = profilePath(ctx.config);
  if (existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as Profile;
      if (parsed && parsed.category_weights && parsed.keywords) return parsed;
    } catch {
      // rebuild below
    }
  }
  const stars = ctx.store.userStars().map((s) => ({ full_name: s.full_name, starred_at: s.starred_at, topics: ctx.store.getRepo(s.full_name)?.topics ?? [] }));
  const profile = buildProfile(stars);
  saveProfile(ctx, profile);
  return profile;
}

export function saveProfile(ctx: JobContext, profile: Profile): void {
  const file = profilePath(ctx.config);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(profile, null, 2)}\n`);
}

// ─── stars ───────────────────────────────────────────────────────────────────

export async function syncStars(ctx: JobContext, options: { fromFile?: boolean } = {}): Promise<{ stars: number; source: string }> {
  return recorded(ctx, "stars", async () => {
    let stars: UserStar[];
    let source: string;
    const file = path.join(ctx.config.dataDir, "raw", "stars.json");
    if (!options.fromFile && ctx.github.authenticated) {
      try {
        stars = await fetchUserStars(ctx.github);
        source = "api";
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, `${JSON.stringify(stars, null, 0)}\n`);
      } catch (err) {
        ctx.log(`stars via api failed (${err instanceof Error ? err.message : String(err)}); falling back to file`);
        stars = existsSync(file) ? readStarsFile(file) : [];
        source = "file";
      }
    } else {
      stars = existsSync(file) ? readStarsFile(file) : [];
      source = "file";
    }
    const n = ctx.store.replaceUserStars(stars.map((s) => ({ full_name: s.full_name, starred_at: s.starred_at })));
    // Seed descriptions/topics from the star export so unenriched stars still classify.
    for (const s of stars) {
      const existing = ctx.store.getRepo(s.full_name);
      if (existing && !existing.enriched_at && (s.description || (s.topics && s.topics.length))) {
        ctx.store.upsertRepoMeta({
          ...existing,
          description: existing.description ?? s.description ?? null,
          language: existing.language ?? s.language ?? null,
          topics: existing.topics.length ? existing.topics : (s.topics ?? []),
          stars: existing.stars ?? s.stars ?? null,
          enriched_at: null,
        });
      }
    }
    const profile = buildProfile(stars);
    saveProfile(ctx, profile);
    ctx.log(`stars: ${n} synced from ${source}; profile rebuilt`);
    return { stars: n, source };
  });
}

// ─── collect (live) ──────────────────────────────────────────────────────────

export async function collectLive(ctx: JobContext, options: { date?: string; search?: boolean } = {}): Promise<Record<string, unknown>> {
  return recorded(ctx, "collect", async () => {
    const date = options.date ?? isoDate();
    const { snapshots, failures } = await fetchAllTrending({ listDate: date, ...(ctx.fetchImpl ? { fetchImpl: ctx.fetchImpl } : {}) });
    let inserted = 0;
    for (const s of snapshots) inserted += ctx.store.ingestSnapshot(s).inserted;
    if (snapshots.length > 0) {
      writeSnapshotFile(ctx.config.dataDir, "trending-page", date, snapshots);
      ctx.store.markSnapshotImported("trending-page", date);
    }
    let searchEntries = 0;
    if (options.search !== false) {
      try {
        const snap = await fetchNewHighGrowth(ctx.github, { listDate: date });
        searchEntries = snap.entries.length;
        ctx.store.ingestSnapshot(snap);
        writeSnapshotFile(ctx.config.dataDir, "gh-search-new", date, [snap]);
        ctx.store.markSnapshotImported("gh-search-new", date);
      } catch (err) {
        failures.push({ window: "monthly", language: "search", error: err instanceof Error ? err.message : String(err) });
      }
    }
    for (const f of failures) ctx.log(`collect: ${f.window}/${f.language} failed: ${f.error}`);
    ctx.log(`collect ${date}: ${snapshots.length} lists, ${inserted} new appearances, ${searchEntries} search rows, ${failures.length} failures`);
    return { date, lists: snapshots.length, inserted, searchEntries, failures: failures.map((f) => `${f.window}/${f.language}: ${f.error}`) };
  });
}

// ─── backfill (archives) ─────────────────────────────────────────────────────

export async function backfill(ctx: JobContext, options: { from: string; to?: string; refetch?: boolean; vitalets?: boolean }): Promise<Record<string, unknown>> {
  return recorded(ctx, "backfill", async () => {
    const to = options.to ?? isoDate();
    const dates = dateRange(options.from, to);
    let fetched = 0;
    let fromDisk = 0;
    let missing = 0;
    let errors = 0;
    let inserted = 0;
    for (const date of dates) {
      const onDisk = listSnapshotFiles(ctx.config.dataDir, "larsbijl-archive").find((f) => f.date === date);
      if (onDisk && !options.refetch) {
        if (!ctx.store.hasSnapshot("larsbijl-archive", date)) {
          const file = readSnapshotFile(onDisk.file);
          if (file) {
            for (const s of file.lists) inserted += ctx.store.ingestSnapshot(s).inserted;
            ctx.store.markSnapshotImported("larsbijl-archive", date);
          }
        }
        fromDisk++;
        continue;
      }
      const res = await fetchLarsbijlDay(date, ctx.fetchImpl ?? fetch);
      if (res.status === "ok") {
        fetched++;
        for (const s of res.snapshots) inserted += ctx.store.ingestSnapshot(s).inserted;
        writeSnapshotFile(ctx.config.dataDir, "larsbijl-archive", date, res.snapshots);
        ctx.store.markSnapshotImported("larsbijl-archive", date);
      } else if (res.status === "missing") {
        missing++;
      } else {
        errors++;
        ctx.log(`backfill ${date}: ${res.error}`);
      }
      if ((fetched + missing + errors) % 25 === 0) ctx.log(`backfill: ${fetched} fetched, ${fromDisk} from disk, ${missing} missing, ${errors} errors, ${inserted} appearances`);
      await new Promise((r) => setTimeout(r, 250));
    }
    let vitalets = 0;
    if (options.vitalets && ctx.github.authenticated) {
      for (const window of ["daily", "weekly"] as const) {
        try {
          const comments = await fetchVitaletsComments(window, (p, params) => ctx.github.rest(p, params ?? {}), 10);
          const byDate = new Map<string, Snapshot>();
          for (const c of comments) {
            const snap = parseVitaletsComment(c, window);
            if (snap && snap.list_date >= options.from && snap.list_date <= to && !byDate.has(snap.list_date)) byDate.set(snap.list_date, snap);
          }
          for (const [date, snap] of byDate) {
            inserted += ctx.store.ingestSnapshot(snap).inserted;
            writeSnapshotFile(ctx.config.dataDir, "vitalets-archive", date, [snap]);
            ctx.store.markSnapshotImported("vitalets-archive", date);
            vitalets++;
          }
        } catch (err) {
          ctx.log(`vitalets ${window}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
    ctx.log(`backfill done: ${fetched} fetched, ${fromDisk} from disk, ${missing} missing, ${errors} errors, ${vitalets} vitalets days, ${inserted} appearances`);
    return { from: options.from, to, fetched, fromDisk, missing, errors, vitalets, inserted };
  });
}

/** Ingest every snapshot file on disk that the store has not seen. */
export function importSnapshots(ctx: JobContext): { files: number; inserted: number } {
  let files = 0;
  let inserted = 0;
  for (const f of listSnapshotFiles(ctx.config.dataDir)) {
    if (ctx.store.hasSnapshot(f.source, f.date)) continue;
    const parsed = readSnapshotFile(f.file);
    if (!parsed) continue;
    for (const s of parsed.lists) inserted += ctx.store.ingestSnapshot(s).inserted;
    ctx.store.markSnapshotImported(f.source, f.date);
    files++;
  }
  if (files) ctx.log(`import: ${files} snapshot files, ${inserted} appearances`);
  return { files, inserted };
}

// ─── enrich / classify / summarize / score ──────────────────────────────────

export async function enrichPending(ctx: JobContext, options: { limit?: number; staleDays?: number; names?: string[] } = {}): Promise<Record<string, unknown>> {
  return recorded(ctx, "enrich", async () => {
    const staleBefore = new Date(Date.now() - (options.staleDays ?? 7) * 86_400_000).toISOString();
    const names = options.names ?? ctx.store.namesNeedingEnrichment(staleBefore, options.limit ?? (ctx.github.authenticated ? 400 : 25));
    if (names.length === 0) return { enriched: 0, missing: 0, skipped: 0, errors: 0 };
    const res = await enrichRepos(ctx.github, names, { log: ctx.log });
    ctx.store.transaction(() => {
      for (const meta of res.found) {
        ctx.store.upsertRepoMeta(meta);
        const repo = ctx.store.getRepo(meta.full_name);
        if (repo && repo.category_source !== "owner") {
          const c = classifyRepo(repo);
          ctx.store.setCategory(repo.full_name, c.category, "rule");
        }
      }
      for (const n of res.missing) ctx.store.markRepoGone(n);
    });
    ctx.log(`enrich: ${res.found.length} enriched, ${res.missing.length} missing, ${res.skipped.length} skipped (budget), ${res.errors.length} errors`);
    return { enriched: res.found.length, missing: res.missing.length, skipped: res.skipped.length, errors: res.errors.length, errorDetail: res.errors.slice(0, 5) };
  });
}

export function classifyAll(ctx: JobContext, options: { onlyUnclassified?: boolean } = {}): { classified: number } {
  let n = 0;
  ctx.store.transaction(() => {
    for (const name of ctx.store.allRepoNames()) {
      const repo = ctx.store.getRepo(name);
      if (!repo || repo.category_source === "owner") continue;
      if (options.onlyUnclassified && repo.category !== "other") continue;
      const c = classifyRepo(repo);
      if (c.category !== repo.category) ctx.store.setCategory(name, c.category, "rule");
      n++;
    }
  });
  return { classified: n };
}

export async function summarizePending(ctx: JobContext, profile: Profile, options: { limit?: number; since?: string; heuristicOnly?: boolean } = {}): Promise<Record<string, unknown>> {
  return recorded(ctx, "summarize", async () => {
    const limit = options.limit ?? 120;
    const names = ctx.store.namesNeedingSummary(limit, options.since);
    let llm = 0;
    let heuristic = 0;
    let capped = false;
    for (const name of names) {
      const repo = ctx.store.getRepo(name);
      if (!repo) continue;
      if (!options.heuristicOnly && ctx.llm.available && !ctx.llm.capReached()) {
        const out = await ctx.llm.summarizeRepo(repo, profile);
        if (out) {
          ctx.store.setSummary(name, { summary: out.summary, business_use: out.business_use, source: "llm", hash: repo.readme_hash ?? "" });
          if (repo.category_source !== "owner" && out.category !== repo.category) ctx.store.setCategory(name, out.category, "llm");
          llm++;
          continue;
        }
        if (ctx.llm.capReached()) capped = true;
      }
      if (!repo.summary) {
        const h = heuristicSummary(repo);
        ctx.store.setSummary(name, { summary: h.summary, business_use: h.business_use, source: "heuristic", hash: h.hash });
        heuristic++;
      }
    }
    ctx.log(`summarize: ${llm} by llm, ${heuristic} heuristic${capped ? " (daily cap reached)" : ""}${ctx.llm.available ? "" : " (no ANTHROPIC_API_KEY)"}`);
    return { candidates: names.length, llm, heuristic, capped, llmAvailable: ctx.llm.available, tokensToday: ctx.llm.tokensUsedToday() };
  });
}

export function scoreAll(ctx: JobContext, profile: Profile): { scored: number } {
  const scored = rescoreAll(ctx.store, profile);
  ctx.log(`score: ${scored} repos scored`);
  return { scored };
}

// ─── reports ─────────────────────────────────────────────────────────────────

export function writeDaily(ctx: JobContext, profile: Profile, date: string, sources: string[] = []): { id: string; file: string } {
  const md = dailyReport(ctx.store, profile, { date, sources });
  ctx.store.saveReport("daily", date, md);
  const file = path.join(ctx.config.reportsDir, "daily", `${date}.md`);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, md);
  return { id: date, file };
}

export function writeWeekly(ctx: JobContext, profile: Profile, date: string, sources: string[] = []): { id: string; file: string } {
  const id = isoWeek(date);
  const md = weeklyReport(ctx.store, profile, { date, sources });
  ctx.store.saveReport("weekly", id, md);
  const file = path.join(ctx.config.reportsDir, "weekly", `${id}.md`);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, md);
  return { id, file };
}

export function writeLandscape(ctx: JobContext, profile: Profile, from: string, to: string, narrative?: string): { id: string; file: string } {
  const id = `landscape-${from.slice(0, 7)}-to-${to.slice(0, 7)}`;
  const md = landscapeReport(ctx.store, profile, { from, to, ...(narrative ? { narrative } : {}) });
  ctx.store.saveReport("landscape", id, md);
  const file = path.join(ctx.config.reportsDir, `${id}.md`);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, md);
  return { id, file };
}

export function writeResource(ctx: JobContext, profile: Profile, fullName: string, options: { testLog?: string | null } = {}): { file: string; markdown: string } {
  const repo = ctx.store.getRepo(fullName);
  if (!repo) throw new Error(`unknown repo ${fullName}`);
  const view = repoView(ctx.store, repo, profile);
  const md = resourcePage(view, { testLog: options.testLog ?? null });
  ctx.store.saveResource(fullName, md);
  const file = path.join(ctx.config.resourcesDir, resourceFileName(fullName));
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, md);
  return { file, markdown: md };
}

// ─── data export / import (the repo is the archive) ──────────────────────────

function shardKey(fullName: string): string {
  const c = fullName[0]?.toLowerCase() ?? "_";
  return /[a-z0-9]/.test(c) ? c : "_";
}

export function exportData(ctx: JobContext): { repos: number; shards: number } {
  const bundle = ctx.store.exportBundle();
  const reposDir = path.join(ctx.config.dataDir, "repos");
  mkdirSync(reposDir, { recursive: true });
  const shards = new Map<string, RepoRecord[]>();
  for (const r of bundle.repos) {
    const k = shardKey(r.full_name);
    const arr = shards.get(k) ?? [];
    arr.push(r);
    shards.set(k, arr);
  }
  for (const [k, arr] of shards) writeFileSync(path.join(reposDir, `${k}.json`), `${JSON.stringify(arr, null, 0)}\n`);
  const userDir = path.join(ctx.config.dataDir, "user");
  mkdirSync(userDir, { recursive: true });
  writeFileSync(path.join(userDir, "shortlist.json"), `${JSON.stringify(bundle.shortlist, null, 2)}\n`);
  writeFileSync(path.join(userDir, "ratings.json"), `${JSON.stringify(bundle.ratings, null, 2)}\n`);
  writeFileSync(
    path.join(ctx.config.dataDir, "index.json"),
    `${JSON.stringify({ exported_at: bundle.exported_at, repos: bundle.repos.length, appearances: bundle.appearances.length, shards: [...shards.keys()].sort(), stats: ctx.store.stats() }, null, 2)}\n`,
  );
  ctx.log(`export: ${bundle.repos.length} repos in ${shards.size} shards`);
  return { repos: bundle.repos.length, shards: shards.size };
}

export function importData(ctx: JobContext): { repos: number; snapshots: number; appearances: number } {
  const reposDir = path.join(ctx.config.dataDir, "repos");
  let repos = 0;
  if (existsSync(reposDir)) {
    for (const f of readdirSync(reposDir).filter((f) => f.endsWith(".json"))) {
      try {
        const arr = JSON.parse(readFileSync(path.join(reposDir, f), "utf8")) as RepoRecord[];
        repos += ctx.store.importRepos(arr.filter((r) => isFullName(r.full_name)));
      } catch (err) {
        ctx.log(`import ${f}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  const userDir = path.join(ctx.config.dataDir, "user");
  const readJson = <T>(file: string): T | null => {
    try {
      return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : null;
    } catch {
      return null;
    }
  };
  ctx.store.importOwnerState({
    shortlist: readJson(path.join(userDir, "shortlist.json")) ?? [],
    ratings: readJson(path.join(userDir, "ratings.json")) ?? [],
  });
  const starsFile = path.join(ctx.config.dataDir, "raw", "stars.json");
  if (existsSync(starsFile) && ctx.store.userStars().length === 0) {
    const stars = readStarsFile(starsFile);
    ctx.store.replaceUserStars(stars.map((s) => ({ full_name: s.full_name, starred_at: s.starred_at })));
  }
  const snaps = importSnapshots(ctx);
  ctx.log(`import: ${repos} repos, ${snaps.files} snapshot files`);
  return { repos, snapshots: snaps.files, appearances: snaps.inserted };
}

/** Download the public repo's data/ tree (raw URLs) into dataDir, for a server with an empty disk. */
export async function fetchDataFromRepo(ctx: JobContext, options: { fetchImpl?: typeof fetch } = {}): Promise<{ files: number }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const { dataRepo, dataBranch } = ctx.config;
  const base = `https://raw.githubusercontent.com/${dataRepo}/${dataBranch}`;
  const get = async (p: string): Promise<string | null> => {
    const res = await fetchImpl(`${base}/${p}`);
    return res.ok ? res.text() : null;
  };
  const manifest = await get("data/manifest.json");
  if (!manifest) {
    ctx.log(`fetchDataFromRepo: no data/manifest.json at ${dataRepo}@${dataBranch}`);
    return { files: 0 };
  }
  const list = JSON.parse(manifest) as { files: string[] };
  let files = 0;
  for (const rel of list.files) {
    if (!rel.startsWith("data/") || rel.includes("..")) continue;
    const text = await get(rel);
    if (text === null) continue;
    const out = path.join(ctx.config.root, rel);
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, text);
    files++;
  }
  ctx.log(`fetchDataFromRepo: ${files} files from ${dataRepo}`);
  return { files };
}

/** Write data/manifest.json: every file under data/ that the server should mirror on boot. */
export function writeDataManifest(ctx: JobContext): { files: number } {
  const root = ctx.config.root;
  const dataDir = ctx.config.dataDir;
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith(".json") && entry.name !== "manifest.json" && !entry.name.endsWith(".db")) files.push(path.relative(root, full).split(path.sep).join("/"));
    }
  };
  walk(dataDir);
  files.sort();
  writeFileSync(path.join(dataDir, "manifest.json"), `${JSON.stringify({ generated_at: isoNow(), files }, null, 0)}\n`);
  return { files: files.length };
}

// ─── publish to the repo ─────────────────────────────────────────────────────

/** Push the day's artefacts (reports, snapshots, user state, manifest) to the public repo. No-op without a token. */
export async function publishToRepo(ctx: JobContext, options: { paths?: string[]; message?: string } = {}): Promise<Record<string, unknown>> {
  if (!ctx.github.authenticated) {
    ctx.log("publish: no GITHUB_TOKEN; skipping repo sync");
    return { committed: false, reason: "no token" };
  }
  const root = ctx.config.root;
  const rels = options.paths ?? defaultPublishPaths(ctx);
  const files: PublishFile[] = [];
  for (const rel of rels) {
    const abs = path.join(root, rel);
    if (!existsSync(abs)) continue;
    files.push({ path: rel, content: readFileSync(abs, "utf8") });
  }
  const res = await publishFiles(ctx.github, ctx.config.dataRepo, ctx.config.dataBranch, files, options.message ?? `kinly: update ${isoDate()}`, { log: ctx.log });
  return { committed: res.committed, changed: res.changed.length, skipped: res.skipped.length, url: res.url };
}

function defaultPublishPaths(ctx: JobContext): string[] {
  const root = ctx.config.root;
  const today = isoDate();
  const out = new Set<string>();
  const add = (abs: string): void => {
    if (existsSync(abs)) out.add(path.relative(root, abs).split(path.sep).join("/"));
  };
  add(path.join(ctx.config.reportsDir, "daily", `${today}.md`));
  add(path.join(ctx.config.reportsDir, "daily", `${addDays(today, -1)}.md`));
  add(path.join(ctx.config.reportsDir, "weekly", `${isoWeek(today)}.md`));
  for (const f of listSnapshotFiles(ctx.config.dataDir)) if (f.date >= addDays(today, -3)) add(f.file);
  add(path.join(ctx.config.dataDir, "user", "shortlist.json"));
  add(path.join(ctx.config.dataDir, "user", "ratings.json"));
  add(path.join(ctx.config.dataDir, "user", "profile.json"));
  add(path.join(ctx.config.dataDir, "index.json"));
  add(path.join(ctx.config.dataDir, "manifest.json"));
  const resDir = ctx.config.resourcesDir;
  if (existsSync(resDir)) for (const f of readdirSync(resDir)) if (f.endsWith(".md")) add(path.join(resDir, f));
  const reposDir = path.join(ctx.config.dataDir, "repos");
  if (existsSync(reposDir)) for (const f of readdirSync(reposDir)) if (f.endsWith(".json")) add(path.join(reposDir, f));
  return [...out];
}

// ─── the daily pipeline ─────────────────────────────────────────────────────

export async function runDaily(ctx: JobContext, options: { date?: string; publish?: boolean; weekly?: boolean } = {}): Promise<Record<string, unknown>> {
  const date = options.date ?? isoDate();
  const out: Record<string, unknown> = { date };
  const sources: string[] = [];
  const collect = await collectLive(ctx, { date });
  out["collect"] = collect;
  if ((collect["lists"] as number) > 0) sources.push("trending-page");
  if ((collect["searchEntries"] as number) > 0) sources.push("gh-search-new");
  if (ctx.github.authenticated) {
    try {
      out["stars"] = await syncStars(ctx);
    } catch (err) {
      ctx.log(`stars: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  out["enrich"] = await enrichPending(ctx, {});
  const profile = loadProfile(ctx);
  out["classify"] = classifyAll(ctx, { onlyUnclassified: true });
  out["summarize"] = await summarizePending(ctx, profile, { since: addDays(date, -14) });
  out["score"] = scoreAll(ctx, profile);
  out["daily"] = writeDaily(ctx, profile, date, sources);
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  if (options.weekly ?? dow === 1) out["weekly"] = writeWeekly(ctx, profile, date, sources);
  out["export"] = exportData(ctx);
  out["manifest"] = writeDataManifest(ctx);
  if (options.publish ?? true) out["publish"] = await publishToRepo(ctx, { message: `kinly: daily ${date}` });
  return out;
}
