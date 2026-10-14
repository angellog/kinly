import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { categoryScores, classifyRepo, RULES_VERSION } from "./classify/rules.js";
import type { KinlyConfig } from "./config.js";
import { GitHubClient, GitHubHttpError, RateLimitExhausted } from "./github/client.js";
import { fetchStarHistory, STAR_HISTORY_PAGE } from "./github/star-history.js";
import { enrichRepos } from "./github/enrich.js";
import { publishFiles, type PublishFile } from "./github/publish.js";
import { heuristicSummary, Llm, USE_TEMPLATES } from "./llm/anthropic.js";
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
import type { ExportBundle, Store } from "./store/store.js";
import { CATEGORY_IDS, type CategoryId, type Profile, type RepoRecord, type RepoView, type Snapshot } from "./types.js";
import { addDays, dateRange, isoDate, isoNow, isoWeek, weekStart } from "./util/dates.js";
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
      writeSnapshotFile(ctx.config.dataDir, "trending-page", date, snapshots.map((sn) => (stalled.includes(listKey(sn)) ? { ...sn, stalled: true } : sn)));
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
    for (const s of parsed.lists) if (!s.stalled) inserted += ctx.store.ingestSnapshot(s).inserted;
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
        if (repo && repo.category_source !== "owner" && repo.category_source !== "llm") {
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
      // Rules never overwrite a category the owner set or an LLM/curated pass refined.
      if (!repo || repo.category_source === "owner" || repo.category_source === "llm") continue;
      if (options.onlyUnclassified && repo.category !== "other") continue;
      const c = classifyRepo(repo);
      if (c.category !== repo.category) ctx.store.setCategory(name, c.category, "rule");
      n++;
    }
  });
  return { classified: n };
}

/**
 * When the classifier's rules changed (RULES_VERSION), reclassify rule-sourced repos once (H13). The daily run only
 * classifies "other" repos, so without this a better rule never reaches a repo it already misfiled.
 *
 * Conservative on purpose: a published store carries no README excerpts (R6), so the server classifies on less text
 * than the run that first filed the repo. A repo therefore moves only to a real category, never to "other", and only
 * when the new category beats the current one by a full topic's weight. Owner and LLM/curated categories are never
 * touched. Afterwards every heuristic business line is realigned with its repo's category. Returns the repos moved.
 */
export const RECLASSIFY_MARGIN = 3;

export function reclassifyOnRuleChange(ctx: JobContext): { version: number; changed: string[]; realigned: number } {
  if (ctx.store.getMeta("classify_rules_version") === String(RULES_VERSION)) return { version: RULES_VERSION, changed: [], realigned: 0 };
  const changed: string[] = [];
  let realigned = 0;
  ctx.store.transaction(() => {
    for (const name of ctx.store.allRepoNames()) {
      const repo = ctx.store.getRepo(name);
      if (!repo || repo.category_source === "owner" || repo.category_source === "llm") continue;
      const c = classifyRepo(repo);
      if (c.category === repo.category || c.category === "other") continue;
      const current = categoryScores(repo).get(repo.category) ?? 0;
      if (c.score < current + RECLASSIFY_MARGIN) continue;
      ctx.store.setCategory(name, c.category, "rule");
      changed.push(name);
    }
    realigned = alignHeuristicUse(ctx);
    ctx.store.setMeta("classify_rules_version", String(RULES_VERSION));
  });
  if (changed.length || realigned) ctx.log(`classify: rules v${RULES_VERSION} moved ${changed.length} repos (${changed.slice(0, 5).join(", ")}${changed.length > 5 ? ", …" : ""}); ${realigned} heuristic business lines realigned`);
  return { version: RULES_VERSION, changed, realigned };
}

/**
 * A heuristic business line is its category's template. When a repo's category changes after its heuristic summary
 * was written, the line still names the old category (gods-eye-view read "Security hygiene…"). Rewrite only a line
 * that is some other category's template; a model-written line or the summary itself is never touched.
 */
export function alignHeuristicUse(ctx: JobContext): number {
  const templates = new Set(Object.values(USE_TEMPLATES));
  let n = 0;
  for (const name of ctx.store.allRepoNames()) {
    const repo = ctx.store.getRepo(name);
    if (!repo || repo.summary_source !== "heuristic" || !repo.summary || !repo.business_use) continue;
    const want = USE_TEMPLATES[repo.category];
    if (repo.business_use === want || !templates.has(repo.business_use)) continue;
    ctx.store.setSummary(name, { summary: repo.summary, business_use: want, source: "heuristic", hash: repo.summary_hash ?? "", at: repo.summary_at });
    n++;
  }
  return n;
}

export async function summarizePending(ctx: JobContext, profile: Profile, options: { limit?: number; since?: string; heuristicOnly?: boolean } = {}): Promise<Record<string, unknown>> {
  return recorded(ctx, "summarize", async () => {
    const limit = options.limit ?? 120;
    // A repo the model failed on three times stays heuristic instead of being paid for every day (review G1-ops3).
    const failures = (n: string): number => Number.parseInt(ctx.store.getMeta(`llm_fail:${n}`) ?? "0", 10) || 0;
    const names = ctx.store.namesNeedingSummary(limit * 2, options.since).filter((n) => failures(n) < 3).slice(0, limit);
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
        else ctx.store.setMeta(`llm_fail:${name}`, String(failures(name) + 1));
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

/** Set while a fresh server is still rebuilding from the data repo; export and publish refuse to run. */
export const IMPORT_PENDING = "import_pending";

function assertNotRebuilding(ctx: JobContext): void {
  if (ctx.store.getMeta(IMPORT_PENDING) === "1") throw new Error("the store is still being rebuilt from the data repo; refusing to export over it");
}

export function exportData(ctx: JobContext): { repos: number; shards: number } {
  assertNotRebuilding(ctx);
  const bundle = { ...ctx.store.ownerBundle(), repos: ctx.store.exportRepos() };
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
  // One repo per line: a day's star-count changes become small line diffs in git, not whole-shard rewrites (review G1-ops7).
  for (const [k, arr] of shards) writeFileSync(path.join(reposDir, `${k}.json`), `[\n${arr.map((r) => JSON.stringify(r)).join(",\n")}\n]\n`);
  const userDir = path.join(ctx.config.dataDir, "user");
  mkdirSync(userDir, { recursive: true });
  writeFileSync(path.join(userDir, "shortlist.json"), `${JSON.stringify(bundle.shortlist, null, 2)}\n`);
  writeFileSync(path.join(userDir, "ratings.json"), `${JSON.stringify(bundle.ratings, null, 2)}\n`);
  writeFileSync(path.join(userDir, "agent-ratings.json"), `${JSON.stringify(ctx.store.listAgentRatings(), null, 2)}\n`);
  writeFileSync(path.join(userDir, "picks.json"), `${JSON.stringify(ctx.store.listPicks(), null, 0)}\n`);
  writeFileSync(path.join(ctx.config.dataDir, "aliases.json"), `${JSON.stringify(ctx.store.listAliases(), null, 0)}\n`);
  writeFileSync(
    path.join(ctx.config.dataDir, "index.json"),
    `${JSON.stringify({ exported_at: bundle.exported_at, repos: bundle.repos.length, shards: [...shards.keys()].sort(), stats: ctx.store.stats() }, null, 2)}\n`,
  );
  ctx.log(`export: ${bundle.repos.length} repos in ${shards.size} shards`);
  return { repos: bundle.repos.length, shards: shards.size };
}

/** Load report and resource markdown from the data checkout into the store (only ids it does not have yet). */
export function importReportFiles(ctx: JobContext): { reports: number; resources: number } {
  let reports = 0;
  let resources = 0;
  // The published file is the record: load it when the store lacks it or holds a different version.
  const add = (kind: string, id: string, file: string): void => {
    const markdown = readFileSync(file, "utf8");
    if (ctx.store.getReport(kind, id)?.markdown === markdown) return;
    ctx.store.saveReport(kind, id, markdown);
    reports++;
  };
  const dir = ctx.config.reportsDir;
  for (const kind of ["daily", "weekly"]) {
    const sub = path.join(dir, kind);
    if (existsSync(sub)) for (const f of readdirSync(sub)) if (/^[\w-]+\.md$/.test(f)) add(kind, f.slice(0, -3), path.join(sub, f));
  }
  if (existsSync(dir)) for (const f of readdirSync(dir)) if (/^landscape-[\w-]+\.md$/.test(f)) add("landscape", f.slice(0, -3), path.join(dir, f));
  const res = ctx.config.resourcesDir;
  if (existsSync(res))
    for (const f of readdirSync(res)) {
      const m = /^([\w.-]+)--([\w.-]+)\.md$/.exec(f);
      if (!m || ctx.store.getResource(`${m[1]}/${m[2]}`)) continue;
      ctx.store.saveResource(`${m[1]}/${m[2]}`, readFileSync(path.join(res, f), "utf8"));
      resources++;
    }
  return { reports, resources };
}

export function importData(ctx: JobContext): { repos: number; snapshots: number; appearances: number; reports: number; resources: number } {
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
  ctx.store.importPicks(readJson<Array<{ full_name: string; kind: string; pick_date: string }>>(path.join(userDir, "picks.json")) ?? []);
  for (const a of readJson<Array<{ full_name: string; rating: number; notes: string | null; test_log: string | null; agent: string | null }>>(path.join(userDir, "agent-ratings.json")) ?? []) {
    if (isFullName(a.full_name) && !ctx.store.getAgentRating(a.full_name) && Number.isInteger(a.rating)) ctx.store.setAgentRating(a.full_name, a);
  }
  // Aliases before snapshots, so archive rows under an old name land on the current repo.
  const aliases = readJson<Array<{ from_name: string; to_name: string }>>(path.join(ctx.config.dataDir, "aliases.json")) ?? [];
  const merged = ctx.store.importAliases(aliases);
  const snaps = importSnapshots(ctx);
  const docs = importReportFiles(ctx);
  const partial = ctx.store.dropPartialWeeklies();
  if (merged) ctx.log(`import: ${merged} aliases applied`);
  if (partial.length) ctx.log(`import: dropped partial weekly ${partial.join(", ")}`);
  ctx.log(`import: ${repos} repos, ${snaps.files} snapshot files, ${docs.reports} reports, ${docs.resources} resource pages`);
  return { repos, snapshots: snaps.files, appearances: snaps.inserted, reports: docs.reports, resources: docs.resources };
}

/** Download the public repo's data/ tree (raw URLs) into dataDir, for a server with an empty disk. */
/**
 * All or nothing (review G1-cor1): a manifest that cannot be read, or any listed file that cannot be fetched
 * after a retry, throws — a half-rebuilt store must never be exported over the public data repo. A data repo
 * with no manifest at all (a first deployment) returns `{ files: 0, empty: true }`.
 */
export async function fetchDataFromRepo(ctx: JobContext, options: { fetchImpl?: typeof fetch } = {}): Promise<{ files: number; empty?: boolean }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const { dataRepo, dataBranch } = ctx.config;
  const base = `https://raw.githubusercontent.com/${dataRepo}/${dataBranch}`;
  const get = async (p: string): Promise<string | null> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetchImpl(`${base}/${p}`);
        if (res.status === 404) return null;
        if (res.ok) return await res.text();
      } catch {
        // retry once
      }
    }
    throw new Error(`could not fetch ${p} from ${dataRepo}@${dataBranch}`);
  };
  const manifest = await get("data/manifest.json");
  if (!manifest) {
    ctx.log(`fetchDataFromRepo: no data/manifest.json at ${dataRepo}@${dataBranch} (empty data repo)`);
    return { files: 0, empty: true };
  }
  const list = JSON.parse(manifest) as { files: string[] };
  const wanted = list.files.filter((rel) => /^(data\/[\w./-]+\.json|reports\/[\w./-]+\.md|resources\/[\w.-]+\.md)$/.test(rel) && !rel.includes(".."));
  let files = 0;
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < wanted.length) {
      const rel = wanted[next++] as string;
      const text = await get(rel);
      if (text === null) throw new Error(`manifest lists ${rel} but it is missing from ${dataRepo}`);
      const out = path.join(ctx.config.dataRoot, rel);
      mkdirSync(path.dirname(out), { recursive: true });
      writeFileSync(out, text);
      files++;
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
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
  // Reports and resource pages too, so a fresh server can serve them before its first run.
  const walkMd = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walkMd(full);
      else if (entry.isFile() && entry.name.endsWith(".md")) files.push(path.relative(root, full).split(path.sep).join("/"));
    }
  };
  walkMd(ctx.config.reportsDir);
  walkMd(ctx.config.resourcesDir);
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
  assertNotRebuilding(ctx);
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
  // Weekly reports are named for the completed week (review G1-cor3), so publish that one, never the week in progress.
  add(path.join(ctx.config.reportsDir, "weekly", `${isoWeek(completedWeekEnd(today))}.md`));
  for (const f of listSnapshotFiles(ctx.config.dataDir)) if (f.date >= addDays(today, -3) && !LOCAL_ONLY_SOURCES.has(f.source)) add(f.file);
  add(path.join(ctx.config.dataDir, "user", "shortlist.json"));
  add(path.join(ctx.config.dataDir, "user", "ratings.json"));
  add(path.join(ctx.config.dataDir, "user", "profile.json"));
  add(path.join(ctx.config.dataDir, "user", "agent-ratings.json"));
  add(path.join(ctx.config.dataDir, "user", "picks.json"));
  add(path.join(ctx.config.dataDir, "aliases.json"));
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
  out["classify"] = await recorded(ctx, "classify", async () => ({ ...classifyAll(ctx, { onlyUnclassified: true }), rules: reclassifyOnRuleChange(ctx).changed.length }));
  out["summarize"] = await summarizePending(ctx, profile, { since: addDays(date, -14) });
  out["score"] = await recorded(ctx, "score", async () => scoreAll(ctx, profile));
  out["daily"] = await recorded(ctx, "report-daily", async () => writeDaily(ctx, profile, date, sources, credentials));
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  if (options.weekly ?? dow === 1) {
    // Monday's run reports the week that just ended, Monday..Sunday (review G1-cor3).
    out["weekly"] = await recorded(ctx, "report-weekly", async () => writeWeekly(ctx, profile, completedWeekEnd(date), sources, credentials));
    ctx.store.setMeta("last_weekly_ok", isoWeek(date));
  }
  out["export"] = await recorded(ctx, "export", async () => ({ ...exportData(ctx), manifest: writeDataManifest(ctx) }));
  // Never move the marker backwards: a re-run for an old date must not make today look undone (review G1-cor6).
  if ((ctx.store.getMeta("last_daily_ok") ?? "") < date) ctx.store.setMeta("last_daily_ok", date);
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

// ─── ask / research (LLM over the database, capped by D11) ───────────────────

/** A compact, plain-text card for one repo: what the LLM sees as context. Third-party text is fenced as data (D15). */
export function repoCard(v: RepoView): string {
  const r = v.repo;
  return [
    `repo: ${r.full_name}`,
    `category: ${r.category} · stars: ${r.stars ?? "?"} · licence: ${r.license_spdx ?? r.license_class}${r.open_core ? " (open-core)" : ""} · score ${v.score.total} ${v.score.verdict} · relevance ${v.relevance}`,
    `trending: ${v.signals.distinct_weeks} weeks, ${v.signals.distinct_days} days, ${v.signals.first_seen ?? "—"} → ${v.signals.last_seen ?? "—"}`,
    `owner state: ${v.starred ? "starred; " : ""}${v.shortlist ? `shortlist ${v.shortlist.status}; ` : ""}${v.rating ? `rated ${v.rating.rating}/5; ` : ""}`.trim(),
    "description (untrusted, from the repository): <<<",
    (r.summary ?? r.description ?? "").slice(0, 400),
    ">>>",
    r.business_use ? `business use (Kinly): ${r.business_use.slice(0, 400)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function contextFor(ctx: JobContext, profile: Profile, terms: string[], category?: CategoryId, limit = 30): RepoView[] {
  const seen = new Set<string>();
  const out: RepoView[] = [];
  const push = (r: RepoRecord): void => {
    if (seen.has(r.full_name) || out.length >= limit) return;
    seen.add(r.full_name);
    out.push(repoView(ctx.store, r, profile));
  };
  for (const t of terms) for (const r of ctx.store.listRepos({ q: t, ...(category ? { category } : {}), sort: "score", limit: 12 }).rows) push(r);
  if (out.length < limit) for (const r of ctx.store.listRepos({ ...(category ? { category } : {}), sort: "score", limit: limit - out.length }).rows) push(r);
  return out;
}

const STOP = new Set(["the", "a", "an", "and", "or", "for", "to", "of", "in", "on", "is", "are", "what", "which", "how", "can", "i", "we", "my", "our", "me", "with", "that", "this", "it", "be", "do", "should", "best", "good", "any", "there", "repo", "repos", "repository", "repositories", "github", "trending", "use", "using"]);

function searchTerms(text: string): string[] {
  return [...new Set(text.toLowerCase().split(/[^a-z0-9+#.-]+/).filter((w) => w.length >= 3 && !STOP.has(w)))].slice(0, 8);
}

/** Answer a question from the database. Without an LLM it returns the matching repos and says so. */
export async function ask(ctx: JobContext, profile: Profile, question: string): Promise<{ answer: string | null; repos: string[]; llm: boolean; reason?: string }> {
  const q = question.trim().slice(0, 1000);
  if (!q) throw new Error("question is empty");
  const views = contextFor(ctx, profile, searchTerms(q));
  const names = views.map((v) => v.repo.full_name);
  if (!ctx.llm.available) return { answer: null, repos: names.slice(0, 10), llm: false, reason: "no ANTHROPIC_API_KEY: these are the closest matches by keyword and score" };
  if (ctx.llm.capReached()) return { answer: null, repos: names.slice(0, 10), llm: false, reason: "daily LLM token cap reached" };
  const out = await ctx.llm.ask(q, views.map(repoCard), profile);
  if (!out) return { answer: null, repos: names.slice(0, 10), llm: false, reason: "the model did not answer; see the server log" };
  return { answer: out.answer, repos: out.repos.filter((n) => names.includes(n)), llm: true };
}

/** A focused research brief on a topic or category: the ranked repos, plus an LLM synthesis when available. */
export async function research(ctx: JobContext, profile: Profile, input: { topic?: string; category?: CategoryId; limit?: number }): Promise<{ title: string; repos: Array<{ full_name: string; score: number; verdict: string; relevance: number; summary: string | null }>; synthesis: string | null; llm: boolean }> {
  const topic = (input.topic ?? "").trim().slice(0, 200);
  if (!topic && !input.category) throw new Error("research needs a topic or a category");
  const views = contextFor(ctx, profile, topic ? searchTerms(topic) : [], input.category, Math.min(40, input.limit ?? 25));
  views.sort((a, b) => b.relevance * 0.5 + b.score.total * 0.5 - (a.relevance * 0.5 + a.score.total * 0.5));
  const title = topic ? `Research: ${topic}${input.category ? ` (${input.category})` : ""}` : `Research: ${input.category}`;
  let synthesis: string | null = null;
  if (ctx.llm.available && !ctx.llm.capReached() && views.length > 0) {
    const out = await ctx.llm.ask(
      `Write a short research brief for the owner on "${topic || input.category}": which of these repositories matter for Vantik Systems or FeetBit, which to test first and why, and which to skip. Name repositories by owner/name.`,
      views.map(repoCard),
      profile,
    );
    synthesis = out?.answer ?? null;
  }
  return {
    title,
    repos: views.map((v) => ({ full_name: v.repo.full_name, score: v.score.total, verdict: v.score.verdict, relevance: v.relevance, summary: v.repo.summary ?? v.repo.description })),
    synthesis,
    llm: synthesis !== null,
  };
}

/** The Sunday that ends the last complete ISO week before `date`'s week. */
export function completedWeekEnd(date: string): string {
  return addDays(weekStart(date), -1);
}

/** The weekly report on its own (the daily pipeline also writes it on Mondays); used for catch-up. */
export async function runWeekly(ctx: JobContext, options: { date?: string; publish?: boolean; allowGhToken?: boolean } = {}): Promise<Record<string, unknown>> {
  const date = options.date ?? isoDate();
  const credentials = await credentialStates(ctx);
  const profile = loadProfile(ctx);
  const out: Record<string, unknown> = { date };
  out["weekly"] = await recorded(ctx, "report-weekly", async () => writeWeekly(ctx, profile, completedWeekEnd(date), ["trending-page"], credentials));
  ctx.store.setMeta("last_weekly_ok", isoWeek(date));
  out["export"] = await recorded(ctx, "export", async () => ({ ...exportData(ctx), manifest: writeDataManifest(ctx) }));
  if (options.publish ?? true) {
    try {
      out["publish"] = await recorded(ctx, "publish", () => publishToRepo(ctx, { message: `kinly: weekly ${isoWeek(date)}`, ...(options.allowGhToken ? { allowGhToken: true } : {}) }));
    } catch (err) {
      out["publish"] = { committed: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
  return out;
}

/**
 * Load hand- or agent-written summaries (JSON array of { full_name, summary,
 * business_use, category? }). Used for the curated backfill of the repos the
 * reports actually show; marked source "llm" with the current README hash so
 * a later automatic pass only replaces them when the README changes.
 */
export function importSummaries(ctx: JobContext, entries: unknown): { applied: number; skipped: string[] } {
  if (!Array.isArray(entries)) throw new Error("summaries file must be a JSON array");
  let applied = 0;
  const skipped: string[] = [];
  for (const raw of entries) {
    const e = raw as { full_name?: unknown; summary?: unknown; business_use?: unknown; category?: unknown };
    const name = typeof e.full_name === "string" ? ctx.store.resolveAlias(e.full_name) : "";
    const repo = name ? ctx.store.getRepo(name) : null;
    if (!repo || typeof e.summary !== "string" || typeof e.business_use !== "string" || !e.summary.trim() || !e.business_use.trim()) {
      skipped.push(String(e.full_name ?? "?"));
      continue;
    }
    ctx.store.setSummary(name, { summary: e.summary, business_use: e.business_use, source: "llm", hash: repo.readme_hash ?? "" });
    if (typeof e.category === "string" && (CATEGORY_IDS as readonly string[]).includes(e.category) && repo.category_source !== "owner") ctx.store.setCategory(name, e.category as CategoryId, "llm");
    applied++;
  }
  return { applied, skipped };
}

/**
 * Pull owner state and written pages down from a running Kinly server
 * (GET /api/export with the bearer token). This is how the Mac stays the
 * writer of the data repo until Railway holds its own GitHub token
 * (docs/WORKFLOW.md): pull, export, commit, push. Newer wins everywhere.
 */
export async function pullFromServer(ctx: JobContext, options: { url: string; token: string; fetchImpl?: typeof fetch }): Promise<Record<string, number>> {
  const res = await (options.fetchImpl ?? fetch)(`${options.url.replace(/\/+$/, "")}/api/export`, { headers: { authorization: `Bearer ${options.token}`, accept: "application/json" } });
  if (!res.ok) throw new Error(`pull: ${res.status} from ${options.url}/api/export`);
  const b = (await res.json()) as ExportBundle;
  ctx.store.importAliases((b.aliases ?? []).filter((a) => isFullName(a.from_name) && isFullName(a.to_name)));
  ctx.store.importPicks(b.picks ?? []);
  ctx.store.importOwnerState({ shortlist: b.shortlist ?? [], ratings: b.ratings ?? [] });
  let agentRatings = 0;
  // The export is input from a network service: only well-formed names ever become file paths or rows (review G1-sec1).
  for (const a of (b.agent_ratings ?? []).filter((x) => isFullName(x.full_name) && Number.isInteger(x.rating) && x.rating >= 1 && x.rating <= 5)) {
    const cur = ctx.store.getAgentRating(a.full_name);
    if (cur && cur.updated_at >= a.updated_at) continue;
    ctx.store.setAgentRating(a.full_name, a);
    agentRatings++;
  }
  let resources = 0;
  const resRoot = path.resolve(ctx.config.resourcesDir);
  for (const r of (b.resources ?? []).filter((x) => isFullName(x.full_name) && typeof x.markdown === "string" && typeof x.generated_at === "string")) {
    const cur = ctx.store.getResource(r.full_name);
    if (cur && cur.generated_at >= r.generated_at) continue;
    ctx.store.saveResource(r.full_name, r.markdown, { generatedAt: r.generated_at });
    const file = path.resolve(resRoot, resourceFileName(r.full_name));
    if (!file.startsWith(resRoot + path.sep)) continue;
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, r.markdown.slice(0, 200_000));
    resources++;
  }
  return { shortlist: (b.shortlist ?? []).length, ratings: (b.ratings ?? []).length, agentRatings, resources };
}
