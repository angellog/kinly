import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { classifyRepo } from "./classify/rules.js";
import type { KinlyConfig } from "./config.js";
import { GitHubClient, GitHubHttpError, RateLimitExhausted } from "./github/client.js";
import { fetchStarHistory, STAR_HISTORY_PAGE } from "./github/star-history.js";
import { enrichRepos } from "./github/enrich.js";
import { publishFiles, type PublishFile } from "./github/publish.js";
import { heuristicSummary, Llm } from "./llm/anthropic.js";
import { dailyReport, dailySelection } from "./reports/daily.js";
import type { RunHealth } from "./reports/markdown.js";
import { landscapeReport } from "./reports/landscape.js";
import { resourceFileName, resourcePage } from "./reports/resource.js";
import { weeklyReport, weeklySelection } from "./reports/weekly.js";
import { buildProfile } from "./score/profile.js";
import { fetchLarsbijlDay } from "./sources/larsbijl-archive.js";
import { fetchNewHighGrowth } from "./sources/gh-search.js";
import { listSnapshotFiles, readSnapshotFile, writeSnapshotFile } from "./sources/snapshot-files.js";
import { detectStalls, listKey } from "./sources/stall.js";
import { fetchUserStars, readStarsFile, type UserStar } from "./sources/stars.js";
import { fetchAllTrending } from "./sources/trending-page.js";
import { fetchVitaletsComments, parseVitaletsComment } from "./sources/vitalets-archive.js";
import type { Store } from "./store/store.js";
import type { Profile, RepoRecord, Snapshot } from "./types.js";
import { addDays, dateRange, isoDate, isoNow, isoWeek } from "./util/dates.js";
import { isFullName } from "./util/text.js";
import { rankedList, rescoreAll, repoView } from "./views.js";

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
  /** Pause between trending page fetches; tests set 0. */
  scrapeDelayMs?: number;
}

export function makeContext(store: Store, config: KinlyConfig, options: { log?: Logger; fetchImpl?: typeof fetch; llm?: Llm; github?: GitHubClient; scrapeDelayMs?: number } = {}): JobContext {
  const log = options.log ?? ((m: string) => console.error(`[kinly] ${m}`));
  const github = options.github ?? new GitHubClient({ token: config.githubToken, log, ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}) });
  const llm = options.llm ?? new Llm({ apiKey: config.anthropicKey, model: config.llmModel, dailyCapTokens: config.llmDailyCap, store, log });
  return { store, config, github, llm, log, ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}), ...(options.scrapeDelayMs !== undefined ? { scrapeDelayMs: options.scrapeDelayMs } : {}) };
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
  const starsFile = path.join(ctx.config.dataDir, "raw", "stars.json");
  const exported = existsSync(starsFile) ? readStarsFile(starsFile) : [];
  const stars: UserStar[] = exported.length
    ? exported
    : ctx.store.userStars().map((s) => {
        const r = ctx.store.getRepo(s.full_name);
        return { full_name: s.full_name, starred_at: s.starred_at, description: r?.description ?? null, language: r?.language ?? null, topics: r?.topics ?? [] };
      });
  const categories = stars.map((s) => classifyRepo({ full_name: s.full_name, description: s.description ?? null, topics: s.topics ?? [], readme_excerpt: null, language: s.language ?? null }).category);
  const profile = buildProfile(stars, {}, categories);
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
    const { snapshots, failures } = await fetchAllTrending({ listDate: date, ...(ctx.fetchImpl ? { fetchImpl: ctx.fetchImpl } : {}), ...(ctx.scrapeDelayMs !== undefined ? { delayMs: ctx.scrapeDelayMs, retries: 0 } : {}) });
    const yesterdayFile = listSnapshotFiles(ctx.config.dataDir, "trending-page").find((f) => f.date === addDays(date, -1));
    const stalled = detectStalls(snapshots, yesterdayFile ? (readSnapshotFile(yesterdayFile.file)?.lists ?? []) : []);
    ctx.store.setMeta(`stalled_${date}`, JSON.stringify(stalled));
    if (stalled.length) ctx.log(`collect: stalled lists (identical to yesterday): ${stalled.join(", ")}`);
    let inserted = 0;
    // A stalled list is archived as observed but earns no appearances.
    for (const s of snapshots) if (!stalled.includes(listKey(s))) inserted += ctx.store.ingestSnapshot(s).inserted;
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
    if (snapshots.length === 0) throw new Error(`collect ${date}: every trending list failed (${failures.map((f) => `${f.window}/${f.language}: ${f.error}`).join("; ")})`);
    return { date, lists: snapshots.length, inserted, stalled, searchEntries, failures: failures.map((f) => `${f.window}/${f.language}: ${f.error}`) };
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
    const diskByDate = new Map(listSnapshotFiles(ctx.config.dataDir, "larsbijl-archive").map((f) => [f.date, f] as const));
    for (const date of dates) {
      const onDisk = diskByDate.get(date);
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
    for (const r of res.renamed) ctx.store.renameRepo(r.from, r.to);
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
    ctx.log(`enrich: ${res.found.length} enriched, ${res.renamed.length} renamed, ${res.missing.length} missing, ${res.skipped.length} skipped (budget), ${res.errors.length} errors`);
    return { enriched: res.found.length, renamed: res.renamed.length, missing: res.missing.length, skipped: res.skipped.length, errors: res.errors.length, errorDetail: res.errors.slice(0, 5) };
  });
}

/**
 * Stargazers history (D13) for the given repos, skipping any fetched within
 * `maxAgeHours`. Bounded by the rate budget: keyless runs fetch what the
 * hour allows and leave the rest for the next run.
 */
export async function fetchStarHistories(ctx: JobContext, names: readonly string[], options: { weeks?: number; maxAgeHours?: number } = {}): Promise<Record<string, unknown>> {
  return recorded(ctx, "star-history", async () => {
    const weeks = options.weeks ?? 2;
    const cutoff = Date.now() - (options.maxAgeHours ?? 20) * 3_600_000;
    let fetched = 0;
    let fresh = 0;
    let gone = 0;
    let skipped = 0;
    const errors: string[] = [];
    for (const name of new Set(names)) {
      const at = ctx.store.starWeeksFetchedAt(name);
      if (at && Date.parse(at) >= cutoff) {
        fresh++;
        continue;
      }
      const pages = Math.ceil(weeks / STAR_HISTORY_PAGE);
      if (ctx.github.budget() < pages) {
        skipped++;
        continue;
      }
      try {
        const hist = await fetchStarHistory(ctx.github, name, weeks);
        if (hist === null) gone++;
        else {
          ctx.store.saveStarWeeks(name, hist);
          fetched++;
        }
      } catch (err) {
        if (err instanceof RateLimitExhausted) {
          skipped++;
          break;
        }
        errors.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    ctx.log(`star-history: ${fetched} fetched, ${fresh} fresh, ${gone} gone, ${skipped} skipped (budget), ${errors.length} errors`);
    return { fetched, fresh, gone, skipped, errors: errors.length, errorDetail: errors.slice(0, 5) };
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

/** Credential state per service, for /api/status and report footers (R8). Cheap: /rate_limit does not count against the limit. */
export async function credentialStates(ctx: JobContext): Promise<Record<"github" | "anthropic", "present" | "absent" | "rejected">> {
  let github: "present" | "absent" | "rejected" = "absent";
  if (ctx.github.authenticated) {
    try {
      await ctx.github.rateLimit();
      github = "present";
    } catch (err) {
      github = err instanceof GitHubHttpError && (err.status === 401 || err.status === 403) ? "rejected" : "present";
    }
  }
  let anthropic: "present" | "absent" | "rejected" = ctx.llm.available ? "present" : "absent";
  const authErr = ctx.store.getMeta("llm_auth_error_at");
  if (anthropic === "present" && authErr && authErr.slice(0, 10) === isoDate()) anthropic = "rejected";
  return { github, anthropic };
}

function runHealth(ctx: JobContext, date: string, credentials?: Record<string, string>): RunHealth {
  let stalled: string[] = [];
  try {
    stalled = JSON.parse(ctx.store.getMeta(`stalled_${date}`) ?? "[]") as string[];
  } catch {
    stalled = [];
  }
  return { stalled, ...(credentials ? { credentials } : {}) };
}

export function writeDaily(ctx: JobContext, profile: Profile, date: string, sources: string[] = [], credentials?: Record<string, string>): { id: string; file: string } {
  const md = dailyReport(ctx.store, profile, { date, sources, health: runHealth(ctx, date, credentials) });
  ctx.store.recordPicks("daily", date, dailySelection(ctx.store, profile, date).selection.picks.map((v) => v.repo.full_name));
  ctx.store.saveReport("daily", date, md);
  const file = path.join(ctx.config.reportsDir, "daily", `${date}.md`);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, md);
  return { id: date, file };
}

export function writeWeekly(ctx: JobContext, profile: Profile, date: string, sources: string[] = [], credentials?: Record<string, string>): { id: string; file: string } {
  const id = isoWeek(date);
  const md = weeklyReport(ctx.store, profile, { date, sources, health: runHealth(ctx, date, credentials) });
  const weekList = rankedList(ctx.store, "week", profile, { date, limit: 120, candidates: 300 });
  ctx.store.recordPicks("weekly", date, weeklySelection(ctx.store, weekList, date).picks.map((v) => v.repo.full_name));
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
    // README text belongs to its authors; only Kinly's own summary is published (R6).
    arr.push({ ...r, readme_excerpt: null });
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
    const out = path.join(ctx.config.dataRoot, rel);
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, text);
    files++;
  }
  ctx.log(`fetchDataFromRepo: ${files} files from ${dataRepo}`);
  return { files };
}

/** Sources whose rows Kinly may read but has no licence to republish (R6): never published, never in the manifest. */
const LOCAL_ONLY_SOURCES = new Set(["vitalets-archive"]);

/** Write data/manifest.json: every file under data/ that the server should mirror on boot. */
export function writeDataManifest(ctx: JobContext): { files: number } {
  const root = ctx.config.dataRoot;
  const dataDir = ctx.config.dataDir;
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith(".json") && entry.name !== "manifest.json" && ![...LOCAL_ONLY_SOURCES].some((src) => full.includes(`${path.sep}${src}${path.sep}`))) files.push(path.relative(root, full).split(path.sep).join("/"));
    }
  };
  walk(dataDir);
  files.sort();
  writeFileSync(path.join(dataDir, "manifest.json"), `${JSON.stringify({ generated_at: isoNow(), files }, null, 0)}\n`);
  return { files: files.length };
}

// ─── publish to the repo ─────────────────────────────────────────────────────

/** Push the day's artefacts (reports, snapshots, user state, manifest) to the public repo. No-op without a token. */
export async function publishToRepo(ctx: JobContext, options: { paths?: string[]; message?: string; allowGhToken?: boolean } = {}): Promise<Record<string, unknown>> {
  if (!ctx.github.authenticated) {
    ctx.log("publish: no GITHUB_TOKEN; skipping repo sync");
    return { committed: false, reason: "no token" };
  }
  if (ctx.config.githubTokenSource === "gh" && !options.allowGhToken) {
    // D5: the gh CLI token has repo scope on every repo the owner has. It may read; it never publishes unattended.
    ctx.log("publish: refusing the gh CLI token; set GITHUB_TOKEN to a fine-grained PAT, or pass --use-gh-token by hand");
    return { committed: false, reason: "gh token refused" };
  }
  const root = ctx.config.dataRoot;
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
  const root = ctx.config.dataRoot;
  const today = isoDate();
  const out = new Set<string>();
  const add = (abs: string): void => {
    if (existsSync(abs)) out.add(path.relative(root, abs).split(path.sep).join("/"));
  };
  add(path.join(ctx.config.reportsDir, "daily", `${today}.md`));
  add(path.join(ctx.config.reportsDir, "daily", `${addDays(today, -1)}.md`));
  add(path.join(ctx.config.reportsDir, "weekly", `${isoWeek(today)}.md`));
  for (const f of listSnapshotFiles(ctx.config.dataDir)) if (f.date >= addDays(today, -3) && !LOCAL_ONLY_SOURCES.has(f.source)) add(f.file);
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

/**
 * The daily pipeline (D12): stars → collect → enrich → classify/summarize/score
 * → reports → export → publish, in order. Each stage records its own `runs`
 * row (the job functions do that); the first stage that throws stops the
 * pipeline, so a failed collect never produces a public report. Stars and
 * publish are best-effort: a missing token must not block the report.
 * `meta.last_daily_ok` is the date the whole pipeline last finished, which is
 * what the scheduler's catch-up checks.
 */
export async function runDaily(ctx: JobContext, options: { date?: string; publish?: boolean; weekly?: boolean; allowGhToken?: boolean } = {}): Promise<Record<string, unknown>> {
  const date = options.date ?? isoDate();
  const out: Record<string, unknown> = { date };
  const sources: string[] = [];
  const credentials = await credentialStates(ctx);
  out["credentials"] = credentials;
  if (ctx.github.authenticated) {
    try {
      out["stars"] = await syncStars(ctx);
    } catch (err) {
      ctx.log(`stars (non-blocking): ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const collect = await collectLive(ctx, { date });
  out["collect"] = collect;
  if ((collect["lists"] as number) > 0) sources.push("trending-page");
  if ((collect["searchEntries"] as number) > 0) sources.push("gh-search-new");
  out["enrich"] = await enrichPending(ctx, {});
  const listed = [...ctx.store.list("today", { date, limit: 150 }), ...ctx.store.list("week", { date, limit: 100 })].map((r) => r.full_name);
  out["starHistory"] = await fetchStarHistories(ctx, listed, { weeks: 2 });
  const profile = loadProfile(ctx);
  out["classify"] = await recorded(ctx, "classify", async () => classifyAll(ctx, { onlyUnclassified: true }));
  out["summarize"] = await summarizePending(ctx, profile, { since: addDays(date, -14) });
  out["score"] = await recorded(ctx, "score", async () => scoreAll(ctx, profile));
  out["daily"] = await recorded(ctx, "report-daily", async () => writeDaily(ctx, profile, date, sources, credentials));
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  if (options.weekly ?? dow === 1) {
    out["weekly"] = await recorded(ctx, "report-weekly", async () => writeWeekly(ctx, profile, date, sources, credentials));
    ctx.store.setMeta("last_weekly_ok", isoWeek(date));
  }
  out["export"] = await recorded(ctx, "export", async () => ({ ...exportData(ctx), manifest: writeDataManifest(ctx) }));
  ctx.store.setMeta("last_daily_ok", date);
  if (options.publish ?? true) {
    try {
      out["publish"] = await recorded(ctx, "publish", () => publishToRepo(ctx, { message: `kinly: daily ${date}`, ...(options.allowGhToken ? { allowGhToken: true } : {}) }));
    } catch (err) {
      // The report exists locally and in the DB; a failed push is retried by the next run.
      out["publish"] = { committed: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
  return out;
}
