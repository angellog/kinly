import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { MIGRATIONS } from "./schema.js";
import { peakWeek, sevenDay } from "../github/star-history.js";
import {
  CATEGORY_IDS,
  LIST_KINDS,
  SHORTLIST_STATUSES,
  type AgentRating,
  type CategoryId,
  type CategorySource,
  type LicenseClass,
  type ListKind,
  type Rating,
  type RepoMeta,
  type RepoRecord,
  type RunRecord,
  type ScoreBreakdown,
  type ShortlistEntry,
  type ShortlistStatus,
  type Snapshot,
  type SourceId,
  type StarWeek,
  type TrendSignals,
  type Verdict,
  type Window,
} from "../types.js";
import { addDays, isoNow, monthStart, weekStart } from "../util/dates.js";
import { cleanText, cleanTopics, cleanUrl, isFullName } from "../util/text.js";

type Row = Record<string, SQLInputValue>;

/** One row of a ranked list, before it is joined with the repo view. */
export interface ListRow {
  full_name: string;
  /** The number that ordered the list (stars today, days on list, weeks, velocity ...). */
  metric: number;
  /** A one-line explanation of the metric for reports ("4,655 stars today"). */
  metric_label: string;
  rank: number;
}

export interface RepoFilter {
  q?: string;
  category?: CategoryId;
  verdict?: Verdict;
  license_class?: LicenseClass;
  min_relevance?: number;
  min_score?: number;
  starred?: boolean;
  shortlisted?: boolean;
  sort?: "score" | "relevance" | "stars" | "recent" | "name";
  limit?: number;
  offset?: number;
}

export interface StoreStats {
  repos: number;
  enriched: number;
  summarized: number;
  appearances: number;
  first_list_date: string | null;
  last_list_date: string | null;
  snapshots: number;
  user_stars: number;
  shortlist: number;
  ratings: number;
  reports: number;
  resources: number;
  scores: number;
}

export interface ExportBundle {
  exported_at: string;
  repos: RepoRecord[];
  appearances: Array<{
    full_name: string;
    source: SourceId;
    window: Window;
    list_date: string;
    language_list: string;
    rank: number;
    stars_period: number | null;
    stars_total: number | null;
  }>;
  star_history: Array<{ full_name: string; observed_at: string; stars: number }>;
  user_stars: Array<{ full_name: string; starred_at: string }>;
  shortlist: ShortlistEntry[];
  ratings: Rating[];
  agent_ratings?: AgentRating[];
  aliases?: Array<{ from_name: string; to_name: string }>;
  reports: Array<{ kind: string; id: string; generated_at: string; markdown: string }>;
  resources: Array<{ full_name: string; generated_at: string; markdown: string }>;
  meta: Record<string, string>;
}

function bool(v: SQLInputValue | undefined): boolean {
  return v === 1 || v === "1" || (typeof v === "bigint" && v === 1n);
}

function str(v: SQLInputValue | undefined): string | null {
  if (v === null || v === undefined) return null;
  return String(v);
}

function num(v: SQLInputValue | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "bigint" ? Number(v) : Number(v);
  return Number.isFinite(n) ? n : null;
}

function rowToRepo(r: Row): RepoRecord {
  let topics: string[] = [];
  try {
    const parsed: unknown = JSON.parse(String(r["topics"] ?? "[]"));
    if (Array.isArray(parsed)) topics = parsed.filter((t): t is string => typeof t === "string");
  } catch {
    topics = [];
  }
  const category = String(r["category"] ?? "other");
  return {
    full_name: String(r["full_name"]),
    owner: String(r["owner"]),
    name: String(r["name"]),
    description: str(r["description"]),
    language: str(r["language"]),
    topics,
    stars: num(r["stars"]),
    forks: num(r["forks"]),
    created_at: str(r["created_at"]),
    pushed_at: str(r["pushed_at"]),
    license_spdx: str(r["license_spdx"]),
    license_class: (str(r["license_class"]) ?? "unknown") as LicenseClass,
    open_core: bool(r["open_core"]),
    archived: bool(r["archived"]),
    homepage: str(r["homepage"]),
    latest_release: str(r["latest_release"]),
    latest_release_at: str(r["latest_release_at"]),
    readme_excerpt: str(r["readme_excerpt"]),
    readme_hash: str(r["readme_hash"]),
    summary: str(r["summary"]),
    business_use: str(r["business_use"]),
    summary_source: (str(r["summary_source"]) as "llm" | "heuristic" | null) ?? null,
    summary_hash: str(r["summary_hash"]),
    category: (CATEGORY_IDS as readonly string[]).includes(category) ? (category as CategoryId) : "other",
    category_source: (str(r["category_source"]) as CategorySource | null) ?? "rule",
    enriched_at: str(r["enriched_at"]),
    summary_at: str(r["summary_at"]),
  };
}

function rowToShortlist(r: Row): ShortlistEntry {
  return {
    full_name: String(r["full_name"]),
    status: String(r["status"]) as ShortlistStatus,
    note: str(r["note"]),
    updated_at: String(r["updated_at"]),
  };
}

function rowToAgentRating(r: Row): AgentRating {
  return {
    full_name: String(r["full_name"]),
    rating: num(r["rating"]) ?? 0,
    notes: str(r["notes"]),
    test_log: str(r["test_log"]),
    agent: str(r["agent"]),
    updated_at: String(r["updated_at"]),
  };
}

function rowToRating(r: Row): Rating {
  return {
    full_name: String(r["full_name"]),
    rating: num(r["rating"]) ?? 0,
    notes: str(r["notes"]),
    tested_at: str(r["tested_at"]),
    verdict_override: (str(r["verdict_override"]) as Verdict | null) ?? null,
    updated_at: String(r["updated_at"]),
  };
}

/**
 * The Kinly store. One SQLite file (or ":memory:"), opened synchronously.
 * Every method is synchronous; the engine is single-process and the queries
 * are small, so there is no benefit in an async wrapper.
 */
export class Store {
  readonly db: DatabaseSync;
  readonly path: string;

  constructor(file: string) {
    this.path = file;
    if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;");
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    const current = Number.parseInt(this.getMeta("schema_version") ?? "0", 10);
    for (let i = current; i < MIGRATIONS.length; i++) {
      const sql = MIGRATIONS[i];
      if (sql === undefined) continue;
      this.db.exec("BEGIN");
      try {
        this.db.exec(sql);
        this.setMeta("schema_version", String(i + 1));
        this.db.exec("COMMIT");
      } catch (err) {
        this.db.exec("ROLLBACK");
        throw err;
      }
    }
  }

  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN");
    try {
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  // ─── meta ────────────────────────────────────────────────────────────────

  getMeta(key: string): string | null {
    const r = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as Row | undefined;
    return r ? String(r["value"]) : null;
  }

  setMeta(key: string, value: string): void {
    this.db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
  }

  allMeta(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const r of this.db.prepare("SELECT key, value FROM meta").all() as Row[]) out[String(r["key"])] = String(r["value"]);
    return out;
  }

  // ─── snapshots / appearances ─────────────────────────────────────────────

  /**
   * Ingest one trending list. Appearances are unique per (repo, source,
   * window, date, language list), so re-ingesting a snapshot is a no-op.
   * Repo rows are created when missing and only their null fields are filled,
   * so a later enrichment is never overwritten by a thinner source.
   */
  ingestSnapshot(snap: Snapshot): { inserted: number; skipped: number } {
    const insApp = this.db.prepare(
      `INSERT OR IGNORE INTO appearances (full_name, source, window, list_date, language_list, rank, stars_period, stars_total)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insRepo = this.db.prepare(
      `INSERT INTO repos (full_name, owner, name, description, language, stars, forks)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(full_name) DO UPDATE SET
         description = COALESCE(repos.description, excluded.description),
         language    = COALESCE(repos.language, excluded.language),
         stars       = CASE WHEN repos.enriched_at IS NULL THEN COALESCE(excluded.stars, repos.stars) ELSE repos.stars END,
         forks       = CASE WHEN repos.enriched_at IS NULL THEN COALESCE(excluded.forks, repos.forks) ELSE repos.forks END`,
    );
    const insStar = this.db.prepare("INSERT OR IGNORE INTO star_history (full_name, observed_at, stars) VALUES (?, ?, ?)");
    let inserted = 0;
    let skipped = 0;
    this.transaction(() => {
      for (const e of snap.entries) {
        if (!isFullName(e.full_name)) {
          skipped++;
          continue;
        }
        const fullName = this.resolveAlias(e.full_name);
        const [owner, name] = fullName.split("/") as [string, string];
        insRepo.run(fullName, owner, name, cleanText(e.description, 500), cleanText(e.language, 40), e.stars_total ?? null, e.forks ?? null);
        const res = insApp.run(
          fullName,
          snap.source,
          snap.window,
          snap.list_date,
          snap.language_list,
          e.rank,
          e.stars_period ?? null,
          e.stars_total ?? null,
        );
        if (Number(res.changes) > 0) inserted++;
        else skipped++;
        if (typeof e.stars_total === "number" && Number.isFinite(e.stars_total)) {
          insStar.run(fullName, `${snap.list_date}T00:00:00Z`, Math.round(e.stars_total));
        }
      }
    });
    return { inserted, skipped };
  }

  markSnapshotImported(source: SourceId, listDate: string): void {
    this.db
      .prepare("INSERT OR REPLACE INTO snapshot_files (source, list_date, imported_at) VALUES (?, ?, ?)")
      .run(source, listDate, isoNow());
  }

  hasSnapshot(source: SourceId, listDate: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM snapshot_files WHERE source = ? AND list_date = ?").get(source, listDate));
  }

  snapshotDates(source: SourceId): string[] {
    return (this.db.prepare("SELECT list_date FROM snapshot_files WHERE source = ? ORDER BY list_date").all(source) as Row[]).map((r) =>
      String(r["list_date"]),
    );
  }

  /** Latest list date present for a window (and optionally a source). */
  latestListDate(window: Window, source?: SourceId): string | null {
    const r = source
      ? (this.db.prepare("SELECT MAX(list_date) d FROM appearances WHERE window = ? AND source = ?").get(window, source) as Row | undefined)
      : (this.db.prepare("SELECT MAX(list_date) d FROM appearances WHERE window = ?").get(window) as Row | undefined);
    return r ? str(r["d"]) : null;
  }

  // ─── repos ───────────────────────────────────────────────────────────────

  getRepo(fullName: string): RepoRecord | null {
    const r = this.db.prepare("SELECT * FROM repos WHERE full_name = ?").get(fullName) as Row | undefined;
    return r ? rowToRepo(r) : null;
  }

  getRepos(names: readonly string[]): Map<string, RepoRecord> {
    const out = new Map<string, RepoRecord>();
    const stmt = this.db.prepare("SELECT * FROM repos WHERE full_name = ?");
    for (const n of names) {
      const r = stmt.get(n) as Row | undefined;
      if (r) out.set(n, rowToRepo(r));
    }
    return out;
  }

  hasRepo(fullName: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM repos WHERE full_name = ?").get(fullName));
  }

  ensureRepo(fullName: string): void {
    if (!isFullName(fullName)) throw new Error(`invalid repo name: ${fullName}`);
    const [owner, name] = fullName.split("/") as [string, string];
    this.db.prepare("INSERT OR IGNORE INTO repos (full_name, owner, name) VALUES (?, ?, ?)").run(fullName, owner, name);
  }

  upsertRepoMeta(meta: RepoMeta): void {
    this.db
      .prepare(
        `INSERT INTO repos (full_name, owner, name, description, language, topics, stars, forks, created_at, pushed_at,
           license_spdx, license_class, open_core, archived, homepage, latest_release, latest_release_at,
           readme_excerpt, readme_hash, enriched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(full_name) DO UPDATE SET
           description = excluded.description, language = excluded.language, topics = excluded.topics,
           stars = excluded.stars, forks = excluded.forks, created_at = excluded.created_at, pushed_at = excluded.pushed_at,
           license_spdx = excluded.license_spdx, license_class = excluded.license_class, open_core = excluded.open_core,
           archived = excluded.archived, homepage = excluded.homepage, latest_release = excluded.latest_release,
           latest_release_at = excluded.latest_release_at, readme_excerpt = excluded.readme_excerpt,
           readme_hash = excluded.readme_hash, enriched_at = excluded.enriched_at`,
      )
      .run(
        meta.full_name,
        meta.owner,
        meta.name,
        cleanText(meta.description, 500),
        cleanText(meta.language, 40),
        JSON.stringify(cleanTopics(meta.topics)),
        meta.stars,
        meta.forks,
        meta.created_at,
        meta.pushed_at,
        meta.license_spdx,
        meta.license_class,
        meta.open_core ? 1 : 0,
        meta.archived ? 1 : 0,
        cleanUrl(meta.homepage),
        cleanText(meta.latest_release, 120),
        meta.latest_release_at,
        cleanText(meta.readme_excerpt, 6000, { multiline: true }),
        meta.readme_hash,
        meta.enriched_at,
      );
    if (typeof meta.stars === "number" && meta.enriched_at) {
      this.db
        .prepare("INSERT OR IGNORE INTO star_history (full_name, observed_at, stars) VALUES (?, ?, ?)")
        .run(meta.full_name, meta.enriched_at, Math.round(meta.stars));
    }
  }

  /** Mark a repo as enriched-but-missing (404 / renamed), so it is not retried every run. */
  markRepoGone(fullName: string, at: string = isoNow()): void {
    this.db.prepare("UPDATE repos SET archived = 1, enriched_at = ? WHERE full_name = ?").run(at, fullName);
  }

  setSummary(fullName: string, input: { summary: string; business_use: string; source: "llm" | "heuristic"; hash: string }): void {
    this.db
      .prepare("UPDATE repos SET summary = ?, business_use = ?, summary_source = ?, summary_hash = ?, summary_at = ? WHERE full_name = ?")
      .run(cleanText(input.summary, 600) ?? "", cleanText(input.business_use, 1200) ?? "", input.source, input.hash, isoNow(), fullName);
  }

  setCategory(fullName: string, category: CategoryId, source: CategorySource): void {
    this.db.prepare("UPDATE repos SET category = ?, category_source = ? WHERE full_name = ?").run(category, source, fullName);
  }

  /** Repos never enriched, or enriched before `staleBefore`, most-recently-trending first. */
  namesNeedingEnrichment(staleBefore: string, limit: number): string[] {
    const rows = this.db
      .prepare(
        `SELECT r.full_name, MAX(a.list_date) AS last_seen
         FROM repos r LEFT JOIN appearances a ON a.full_name = r.full_name
         WHERE (r.enriched_at IS NULL OR r.enriched_at < ?) AND r.archived = 0
         GROUP BY r.full_name
         ORDER BY last_seen DESC, r.full_name
         LIMIT ?`,
      )
      .all(staleBefore, limit) as Row[];
    return rows.map((r) => String(r["full_name"]));
  }

  /** Enriched repos whose summary is missing or whose README changed since it was written. */
  namesNeedingSummary(limit: number, onlyListedSince?: string): string[] {
    const since = onlyListedSince ?? "0000-00-00";
    const rows = this.db
      .prepare(
        `SELECT r.full_name, MAX(a.list_date) AS last_seen
         FROM repos r JOIN appearances a ON a.full_name = r.full_name
         WHERE r.enriched_at IS NOT NULL AND r.archived = 0
           AND (r.summary IS NULL OR r.summary_source = 'heuristic' OR r.summary_hash IS NULL OR r.summary_hash != COALESCE(r.readme_hash, ''))
           AND a.list_date >= ?
         GROUP BY r.full_name
         ORDER BY last_seen DESC, r.full_name
         LIMIT ?`,
      )
      .all(since, limit) as Row[];
    return rows.map((r) => String(r["full_name"]));
  }

  allRepoNames(): string[] {
    return (this.db.prepare("SELECT full_name FROM repos ORDER BY full_name").all() as Row[]).map((r) => String(r["full_name"]));
  }

  listRepos(filter: RepoFilter = {}): { rows: RepoRecord[]; total: number } {
    const where: string[] = [];
    const params: SQLInputValue[] = [];
    if (filter.q) {
      const like = `%${filter.q.toLowerCase().slice(0, 100).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      where.push("(LOWER(r.full_name) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(r.description,'')) LIKE ? ESCAPE '\\' OR LOWER(r.topics) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(r.summary,'')) LIKE ? ESCAPE '\\')");
      params.push(like, like, like, like);
    }
    if (filter.category) {
      where.push("r.category = ?");
      params.push(filter.category);
    }
    if (filter.license_class) {
      where.push("r.license_class = ?");
      params.push(filter.license_class);
    }
    if (filter.verdict) {
      where.push("s.verdict = ?");
      params.push(filter.verdict);
    }
    if (typeof filter.min_relevance === "number") {
      where.push("COALESCE(s.relevance, 0) >= ?");
      params.push(filter.min_relevance);
    }
    if (typeof filter.min_score === "number") {
      where.push("COALESCE(s.total, 0) >= ?");
      params.push(filter.min_score);
    }
    if (filter.starred) where.push("u.full_name IS NOT NULL");
    if (filter.shortlisted) where.push("sl.full_name IS NOT NULL AND sl.status != 'dropped'");
    const order =
      filter.sort === "relevance"
        ? "COALESCE(s.relevance, 0) DESC, COALESCE(s.total, 0) DESC"
        : filter.sort === "stars"
          ? "COALESCE(r.stars, 0) DESC"
          : filter.sort === "recent"
            ? "COALESCE(r.pushed_at, '') DESC"
            : filter.sort === "name"
              ? "r.full_name ASC"
              : "COALESCE(s.total, 0) DESC, COALESCE(r.stars, 0) DESC";
    const base = `FROM repos r
      LEFT JOIN scores s ON s.full_name = r.full_name
      LEFT JOIN user_stars u ON u.full_name = r.full_name
      LEFT JOIN shortlist sl ON sl.full_name = r.full_name
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}`;
    const total = num((this.db.prepare(`SELECT COUNT(*) c ${base}`).get(...params) as Row)["c"]) ?? 0;
    const limit = Math.max(1, Math.min(500, filter.limit ?? 50));
    const offset = Math.max(0, filter.offset ?? 0);
    const rows = (this.db.prepare(`SELECT r.* ${base} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...params, limit, offset) as Row[]).map(rowToRepo);
    return { rows, total };
  }

  categoryCounts(): Array<{ category: CategoryId; count: number; build: number }> {
    const rows = this.db
      .prepare(
        `SELECT r.category AS category, COUNT(*) AS count, SUM(CASE WHEN s.verdict = 'BUILD' THEN 1 ELSE 0 END) AS build
         FROM repos r LEFT JOIN scores s ON s.full_name = r.full_name
         GROUP BY r.category ORDER BY count DESC`,
      )
      .all() as Row[];
    return rows.map((r) => ({ category: String(r["category"]) as CategoryId, count: num(r["count"]) ?? 0, build: num(r["build"]) ?? 0 }));
  }

  // ─── signals ─────────────────────────────────────────────────────────────

  signals(fullName: string, since?: string): TrendSignals {
    const from = since ?? "0000-00-00";
    const agg = this.db
      .prepare(
        `SELECT COUNT(*) AS n, COUNT(DISTINCT list_date) AS days, COUNT(DISTINCT strftime('%Y-%W', list_date)) AS weeks,
                MIN(list_date) AS first_seen, MAX(list_date) AS last_seen, MAX(CASE WHEN window = 'daily' THEN stars_period END) AS peak,
                GROUP_CONCAT(DISTINCT source) AS sources
         FROM appearances WHERE full_name = ? AND list_date >= ?`,
      )
      .get(fullName, from) as Row;
    return {
      full_name: fullName,
      appearances: num(agg["n"]) ?? 0,
      distinct_days: num(agg["days"]) ?? 0,
      distinct_weeks: num(agg["weeks"]) ?? 0,
      first_seen: str(agg["first_seen"]),
      last_seen: str(agg["last_seen"]),
      peak_stars_period: num(agg["peak"]),
      ...this.historySignals(fullName),
      sources: (str(agg["sources"]) ?? "").split(",").filter((s): s is SourceId => s.length > 0),
    };
  }

  /** Velocity from stargazers history when it was fetched in the last 3 days, else from star-count snapshots. */
  private historySignals(fullName: string): Pick<TrendSignals, "velocity_7d" | "stars_7d" | "peak_week_stars"> {
    const fetched = this.starWeeksFetchedAt(fullName);
    if (fetched) {
      const weeks = this.starWeeks(fullName, 156);
      const peak = peakWeek(weeks);
      const fresh = Date.parse(fetched) >= Date.now() - 3 * 86_400_000;
      const sd = sevenDay(weeks, fetched.slice(0, 10));
      return {
        velocity_7d: fresh && sd ? sd.perDay : this.velocity(fullName, 7),
        stars_7d: fresh && sd ? sd.stars7d : null,
        peak_week_stars: peak ? peak.total : null,
      };
    }
    return { velocity_7d: this.velocity(fullName, 7), stars_7d: null, peak_week_stars: null };
  }

  /** Stars per day between the oldest and newest observation within the last `days` days. */
  velocity(fullName: string, days: number): number | null {
    const rows = this.db
      .prepare(
        `SELECT observed_at, stars FROM star_history WHERE full_name = ? AND observed_at >= ?
         ORDER BY observed_at`,
      )
      .all(fullName, new Date(Date.now() - days * 86_400_000).toISOString()) as Row[];
    if (rows.length < 2) return null;
    const first = rows[0];
    const last = rows[rows.length - 1];
    if (!first || !last) return null;
    const span = (Date.parse(String(last["observed_at"])) - Date.parse(String(first["observed_at"]))) / 86_400_000;
    if (span < 0.5) return null;
    return ((num(last["stars"]) ?? 0) - (num(first["stars"]) ?? 0)) / span;
  }

  appearancesFor(fullName: string, limit = 200): ExportBundle["appearances"] {
    const rows = this.db
      .prepare("SELECT * FROM appearances WHERE full_name = ? ORDER BY list_date DESC, window, language_list LIMIT ?")
      .all(fullName, limit) as Row[];
    return rows.map((r) => ({
      full_name: String(r["full_name"]),
      source: String(r["source"]) as SourceId,
      window: String(r["window"]) as Window,
      list_date: String(r["list_date"]),
      language_list: String(r["language_list"]),
      rank: num(r["rank"]) ?? 0,
      stars_period: num(r["stars_period"]),
      stars_total: num(r["stars_total"]),
    }));
  }

  starHistory(fullName: string, limit = 400): Array<{ observed_at: string; stars: number }> {
    const rows = this.db
      .prepare("SELECT observed_at, stars FROM star_history WHERE full_name = ? ORDER BY observed_at DESC LIMIT ?")
      .all(fullName, limit) as Row[];
    return rows.map((r) => ({ observed_at: String(r["observed_at"]), stars: num(r["stars"]) ?? 0 })).reverse();
  }

  // ─── ranked lists ─────────────────────────────────────────────────────────

  /**
   * A ranked list of repo names for a list kind. `date` is the anchor day
   * (default: the latest daily list date in the store). The result is not
   * filtered by relevance or category; callers join the repo view and filter.
   */
  list(kind: ListKind, options: { date?: string; limit?: number; since?: string } = {}): ListRow[] {
    if (!LIST_KINDS.includes(kind)) throw new Error(`unknown list kind: ${kind}`);
    const limit = Math.max(1, Math.min(1000, options.limit ?? 100));
    const date = options.date ?? this.latestListDate("daily") ?? this.latestListDate("weekly") ?? this.latestListDate("monthly");
    if (!date) return [];
    switch (kind) {
      case "today":
        return this.listToday(date, limit);
      case "week":
        return this.listWindow("weekly", weekStart(date), date, limit, "this week");
      case "month":
        return this.listWindow("monthly", monthStart(date), date, limit, "this month");
      case "persistent":
        return this.listPersistent(options.since ?? addDays(date, -548), 3, limit);
      case "rising":
        return this.listRising(14, limit);
      case "new":
        return this.listNew(addDays(date, -7), date, limit);
      default:
        return [];
    }
  }

  private listToday(date: string, limit: number): ListRow[] {
    const rows = this.db
      .prepare(
        `SELECT full_name, MAX(stars_period) AS sp, MIN(rank) AS r,
                SUM(CASE WHEN language_list = 'all' THEN 1 ELSE 0 END) AS on_all,
                COUNT(DISTINCT language_list) AS lists
         FROM appearances
         WHERE window = 'daily' AND list_date = ?
         GROUP BY full_name
         ORDER BY on_all DESC, sp DESC, lists DESC, r ASC
         LIMIT ?`,
      )
      .all(date, limit) as Row[];
    return rows.map((r, i) => {
      const sp = num(r["sp"]);
      return {
        full_name: String(r["full_name"]),
        metric: sp ?? 0,
        metric_label: sp !== null ? `${sp.toLocaleString("en-US")} stars today` : `rank ${num(r["r"]) ?? 0} on ${num(r["lists"]) ?? 1} list(s)`,
        rank: i + 1,
      };
    });
  }

  private listWindow(window: Window, from: string, to: string, limit: number, label: string): ListRow[] {
    const rows = this.db
      .prepare(
        `SELECT full_name,
                COUNT(DISTINCT CASE WHEN window = 'daily' THEN list_date END) AS days,
                MAX(CASE WHEN window = ? THEN stars_period END) AS wsp,
                MAX(stars_period) AS sp,
                MIN(rank) AS r
         FROM appearances
         WHERE list_date BETWEEN ? AND ? AND window IN ('daily', ?)
         GROUP BY full_name
         ORDER BY (wsp IS NOT NULL) DESC, wsp DESC, days DESC, sp DESC, r ASC
         LIMIT ?`,
      )
      .all(window, from, to, window, limit) as Row[];
    return rows.map((r, i) => {
      const wsp = num(r["wsp"]);
      const days = num(r["days"]) ?? 0;
      return {
        full_name: String(r["full_name"]),
        metric: wsp ?? days,
        metric_label: wsp !== null ? `${wsp.toLocaleString("en-US")} stars ${label}` : `${days} day${days === 1 ? "" : "s"} on the daily list`,
        rank: i + 1,
      };
    });
  }

  private listPersistent(since: string, minWeeks: number, limit: number): ListRow[] {
    const rows = this.db
      .prepare(
        `SELECT full_name, COUNT(DISTINCT strftime('%Y-%W', list_date)) AS weeks, COUNT(*) AS n,
                MIN(list_date) AS first_seen, MAX(list_date) AS last_seen
         FROM appearances WHERE list_date >= ?
         GROUP BY full_name HAVING weeks >= ?
         ORDER BY weeks DESC, n DESC, last_seen DESC
         LIMIT ?`,
      )
      .all(since, minWeeks, limit) as Row[];
    return rows.map((r, i) => {
      const weeks = num(r["weeks"]) ?? 0;
      return {
        full_name: String(r["full_name"]),
        metric: weeks,
        metric_label: `${weeks} distinct weeks on trending (${str(r["first_seen"])} → ${str(r["last_seen"])})`,
        rank: i + 1,
      };
    });
  }

  private listRising(days: number, limit: number): ListRow[] {
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const rows = this.db
      .prepare(
        `WITH obs AS (SELECT full_name, observed_at, stars FROM star_history WHERE observed_at >= ?),
              agg AS (SELECT full_name, MIN(observed_at) a0, MAX(observed_at) a1 FROM obs GROUP BY full_name HAVING COUNT(*) >= 2)
         SELECT agg.full_name, s0.stars AS s0, s1.stars AS s1, julianday(agg.a1) - julianday(agg.a0) AS d
         FROM agg
         JOIN obs s0 ON s0.full_name = agg.full_name AND s0.observed_at = agg.a0
         JOIN obs s1 ON s1.full_name = agg.full_name AND s1.observed_at = agg.a1
         WHERE d >= 0.5 AND s1.stars > s0.stars
         ORDER BY (s1.stars - s0.stars) / d DESC
         LIMIT ?`,
      )
      .all(since, limit) as Row[];
    return rows.map((r, i) => {
      const v = ((num(r["s1"]) ?? 0) - (num(r["s0"]) ?? 0)) / Math.max(0.5, num(r["d"]) ?? 1);
      return { full_name: String(r["full_name"]), metric: Math.round(v), metric_label: `+${Math.round(v).toLocaleString("en-US")} stars/day`, rank: i + 1 };
    });
  }

  private listNew(from: string, to: string, limit: number): ListRow[] {
    const rows = this.db
      .prepare(
        `SELECT full_name, MIN(list_date) AS first_seen, COUNT(*) AS n, MAX(stars_period) AS sp
         FROM appearances GROUP BY full_name
         HAVING first_seen BETWEEN ? AND ?
         ORDER BY sp DESC, n DESC, first_seen DESC
         LIMIT ?`,
      )
      .all(from, to, limit) as Row[];
    return rows.map((r, i) => ({
      full_name: String(r["full_name"]),
      metric: num(r["sp"]) ?? num(r["n"]) ?? 0,
      metric_label: `first seen ${str(r["first_seen"])}`,
      rank: i + 1,
    }));
  }

  /** Per-month top repos by distinct days on daily lists — the landscape report's spine. */
  monthlyLeaders(from: string, to: string, perMonth: number): Map<string, ListRow[]> {
    const rows = this.db
      .prepare(
        `SELECT substr(list_date, 1, 7) AS month, full_name, COUNT(DISTINCT list_date) AS days, MAX(stars_period) AS sp, COUNT(*) AS n
         FROM appearances WHERE list_date BETWEEN ? AND ?
         GROUP BY month, full_name
         ORDER BY month, days DESC, sp DESC, n DESC`,
      )
      .all(from, to) as Row[];
    const out = new Map<string, ListRow[]>();
    for (const r of rows) {
      const month = String(r["month"]);
      const list = out.get(month) ?? [];
      if (list.length >= perMonth) continue;
      const days = num(r["days"]) ?? 0;
      list.push({ full_name: String(r["full_name"]), metric: days, metric_label: `${days} days on trending in ${month}`, rank: list.length + 1 });
      out.set(month, list);
    }
    return out;
  }

  // ─── owner state ─────────────────────────────────────────────────────────

  replaceUserStars(stars: Array<{ full_name: string; starred_at: string }>): number {
    return this.transaction(() => {
      this.db.exec("DELETE FROM user_stars");
      const ins = this.db.prepare("INSERT OR REPLACE INTO user_stars (full_name, starred_at) VALUES (?, ?)");
      let n = 0;
      for (const s of stars) {
        if (!isFullName(s.full_name)) continue;
        ins.run(s.full_name, s.starred_at);
        this.ensureRepo(s.full_name);
        n++;
      }
      return n;
    });
  }

  userStars(): Array<{ full_name: string; starred_at: string }> {
    return (this.db.prepare("SELECT full_name, starred_at FROM user_stars ORDER BY starred_at DESC").all() as Row[]).map((r) => ({
      full_name: String(r["full_name"]),
      starred_at: String(r["starred_at"]),
    }));
  }

  isStarred(fullName: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM user_stars WHERE full_name = ?").get(fullName));
  }

  setShortlist(fullName: string, status: ShortlistStatus, note: string | null): ShortlistEntry {
    if (!SHORTLIST_STATUSES.includes(status)) throw new Error(`invalid shortlist status: ${status}`);
    this.ensureRepo(fullName);
    const now = isoNow();
    this.db
      .prepare(
        `INSERT INTO shortlist (full_name, status, note, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(full_name) DO UPDATE SET status = excluded.status, note = COALESCE(excluded.note, shortlist.note), updated_at = excluded.updated_at`,
      )
      .run(fullName, status, note, now);
    return this.getShortlist(fullName) as ShortlistEntry;
  }

  getShortlist(fullName: string): ShortlistEntry | null {
    const r = this.db.prepare("SELECT * FROM shortlist WHERE full_name = ?").get(fullName) as Row | undefined;
    return r ? rowToShortlist(r) : null;
  }

  listShortlist(includeDropped = false): ShortlistEntry[] {
    const rows = this.db
      .prepare(`SELECT * FROM shortlist ${includeDropped ? "" : "WHERE status != 'dropped'"} ORDER BY updated_at DESC`)
      .all() as Row[];
    return rows.map(rowToShortlist);
  }

  setRating(fullName: string, input: { rating: number; notes?: string | null; tested_at?: string | null; verdict_override?: Verdict | null }): Rating {
    if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) throw new Error("rating must be an integer 1..5");
    this.ensureRepo(fullName);
    const now = isoNow();
    this.db
      .prepare(
        `INSERT INTO ratings (full_name, rating, notes, tested_at, verdict_override, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(full_name) DO UPDATE SET rating = excluded.rating, notes = COALESCE(excluded.notes, ratings.notes),
           tested_at = COALESCE(excluded.tested_at, ratings.tested_at), verdict_override = excluded.verdict_override, updated_at = excluded.updated_at`,
      )
      .run(fullName, input.rating, input.notes ?? null, input.tested_at ?? now.slice(0, 10), input.verdict_override ?? null, now);
    // A rating implies the repo has been tested.
    const sl = this.getShortlist(fullName);
    if (!sl || sl.status === "discovered" || sl.status === "shortlisted" || sl.status === "testing") this.setShortlist(fullName, "rated", null);
    return this.getRating(fullName) as Rating;
  }

  getRating(fullName: string): Rating | null {
    const r = this.db.prepare("SELECT * FROM ratings WHERE full_name = ?").get(fullName) as Row | undefined;
    return r ? rowToRating(r) : null;
  }

  listRatings(): Rating[] {
    return (this.db.prepare("SELECT * FROM ratings ORDER BY updated_at DESC").all() as Row[]).map(rowToRating);
  }

  /** The agent's test result. Moves `shortlisted` to `testing`, never to `rated` (P-M5). */
  setAgentRating(fullName: string, input: { rating: number; notes?: string | null; test_log?: string | null; agent?: string | null }): AgentRating {
    if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) throw new Error("rating must be an integer 1..5");
    this.ensureRepo(fullName);
    this.db
      .prepare(
        `INSERT INTO agent_ratings (full_name, rating, notes, test_log, agent, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(full_name) DO UPDATE SET rating = excluded.rating, notes = excluded.notes,
           test_log = COALESCE(excluded.test_log, agent_ratings.test_log), agent = excluded.agent, updated_at = excluded.updated_at`,
      )
      .run(fullName, input.rating, cleanText(input.notes, 2000), cleanText(input.test_log, 20_000, { multiline: true }), cleanText(input.agent, 80), isoNow());
    const sl = this.getShortlist(fullName);
    if (!sl || sl.status === "discovered" || sl.status === "shortlisted") this.setShortlist(fullName, "testing", sl?.note ?? null);
    return this.getAgentRating(fullName) as AgentRating;
  }

  getAgentRating(fullName: string): AgentRating | null {
    const r = this.db.prepare("SELECT * FROM agent_ratings WHERE full_name = ?").get(fullName) as Row | undefined;
    return r ? rowToAgentRating(r) : null;
  }

  listAgentRatings(): AgentRating[] {
    return (this.db.prepare("SELECT * FROM agent_ratings ORDER BY updated_at DESC").all() as Row[]).map(rowToAgentRating);
  }

  // ─── renames (E-m1) ──────────────────────────────────────────────────────

  /** The current name for a repo that was renamed or transferred, else the name itself. */
  resolveAlias(fullName: string): string {
    const r = this.db.prepare("SELECT to_name FROM aliases WHERE from_name = ?").get(fullName) as Row | undefined;
    return r ? String(r["to_name"]) : fullName;
  }

  /**
   * Fold a repo's old name into its current one: history, owner state and
   * stars move to the new name in one transaction, and the old name becomes
   * an alias so archive rows that still carry it land on the right repo.
   */
  renameRepo(from: string, to: string): void {
    if (from === to || !isFullName(to)) return;
    const [owner, name] = to.split("/") as [string, string];
    this.transaction(() => {
      const target = this.db.prepare("SELECT 1 FROM repos WHERE full_name = ?").get(to);
      if (target) this.db.prepare("DELETE FROM repos WHERE full_name = ?").run(from);
      else this.db.prepare("UPDATE repos SET full_name = ?, owner = ?, name = ? WHERE full_name = ?").run(to, owner, name, from);
      for (const table of ["appearances", "star_history", "star_weeks", "picks", "shortlist", "ratings", "agent_ratings", "resources", "user_stars"]) {
        this.db.prepare(`UPDATE OR IGNORE ${table} SET full_name = ? WHERE full_name = ?`).run(to, from);
        this.db.prepare(`DELETE FROM ${table} WHERE full_name = ?`).run(from);
      }
      this.db.prepare("DELETE FROM scores WHERE full_name = ?").run(from);
      this.db.prepare("UPDATE aliases SET to_name = ? WHERE to_name = ?").run(to, from);
      this.db.prepare("INSERT OR REPLACE INTO aliases (from_name, to_name, seen_at) VALUES (?, ?, ?)").run(from, to, isoNow());
    });
  }

  listAliases(): Array<{ from_name: string; to_name: string }> {
    return (this.db.prepare("SELECT from_name, to_name FROM aliases ORDER BY from_name").all() as Row[]).map((r) => ({ from_name: String(r["from_name"]), to_name: String(r["to_name"]) }));
  }

  /** Load aliases and fold any history already stored under an old name into the new one. */
  importAliases(aliases: ReadonlyArray<{ from_name: string; to_name: string }>): number {
    let n = 0;
    for (const a of aliases) {
      if (!isFullName(a.from_name) || !isFullName(a.to_name) || a.from_name === a.to_name) continue;
      this.renameRepo(a.from_name, a.to_name);
      n++;
    }
    return n;
  }

  // ─── stargazers history (D13) ────────────────────────────────────────────

  saveStarWeeks(fullName: string, weeks: readonly StarWeek[], fetchedAt: string = isoNow()): void {
    const ins = this.db.prepare(
      `INSERT INTO star_weeks (full_name, week_start, total, days, fetched_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(full_name, week_start) DO UPDATE SET total = excluded.total, days = excluded.days, fetched_at = excluded.fetched_at`,
    );
    this.transaction(() => {
      for (const w of weeks) ins.run(fullName, w.week_start, Math.max(0, Math.round(w.total)), JSON.stringify(w.days.slice(0, 7).map((d) => Math.max(0, Math.round(d)))), fetchedAt);
    });
  }

  /** Weeks newest first. */
  starWeeks(fullName: string, limit = 104): StarWeek[] {
    const rows = this.db.prepare("SELECT week_start, total, days FROM star_weeks WHERE full_name = ? ORDER BY week_start DESC LIMIT ?").all(fullName, limit) as Row[];
    return rows.map((r) => ({ week_start: String(r["week_start"]), total: num(r["total"]) ?? 0, days: JSON.parse(String(r["days"])) as number[] }));
  }

  /** When the history was last fetched for a repo, or null. */
  starWeeksFetchedAt(fullName: string): string | null {
    const r = this.db.prepare("SELECT MAX(fetched_at) AS f FROM star_weeks WHERE full_name = ?").get(fullName) as Row | undefined;
    return r ? str(r["f"]) : null;
  }

  // ─── pick memory (D14) ───────────────────────────────────────────────────

  recordPicks(kind: string, date: string, names: readonly string[]): void {
    const ins = this.db.prepare("INSERT OR IGNORE INTO picks (full_name, kind, pick_date) VALUES (?, ?, ?)");
    this.transaction(() => {
      for (const n of names) ins.run(n, kind, date);
    });
  }

  /** Repos picked on any day in [since, before), optionally only by one kind of report. */
  pickedBetween(since: string, before: string, kind?: string): Set<string> {
    const rows = (kind
      ? this.db.prepare("SELECT DISTINCT full_name FROM picks WHERE pick_date >= ? AND pick_date < ? AND kind = ?").all(since, before, kind)
      : this.db.prepare("SELECT DISTINCT full_name FROM picks WHERE pick_date >= ? AND pick_date < ?").all(since, before)) as Row[];
    return new Set(rows.map((r) => String(r["full_name"])));
  }

  // ─── scores ──────────────────────────────────────────────────────────────

  upsertScore(fullName: string, relevance: number, score: ScoreBreakdown): void {
    this.db
      .prepare(
        `INSERT INTO scores (full_name, relevance, total, verdict, breakdown, computed_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(full_name) DO UPDATE SET relevance = excluded.relevance, total = excluded.total, verdict = excluded.verdict,
           breakdown = excluded.breakdown, computed_at = excluded.computed_at`,
      )
      .run(fullName, relevance, score.total, score.verdict, JSON.stringify(score), isoNow());
  }

  getScore(fullName: string): { relevance: number; score: ScoreBreakdown } | null {
    const r = this.db.prepare("SELECT relevance, breakdown FROM scores WHERE full_name = ?").get(fullName) as Row | undefined;
    if (!r) return null;
    try {
      return { relevance: num(r["relevance"]) ?? 0, score: JSON.parse(String(r["breakdown"])) as ScoreBreakdown };
    } catch {
      return null;
    }
  }

  // ─── runs ────────────────────────────────────────────────────────────────

  startRun(job: string): number {
    const res = this.db.prepare("INSERT INTO runs (job, started_at) VALUES (?, ?)").run(job, isoNow());
    return Number(res.lastInsertRowid);
  }

  finishRun(id: number, ok: boolean, stats: Record<string, unknown>, error?: string): void {
    this.db
      .prepare("UPDATE runs SET finished_at = ?, ok = ?, stats = ?, error = ? WHERE id = ?")
      .run(isoNow(), ok ? 1 : 0, JSON.stringify(stats), error ?? null, id);
  }

  recentRuns(limit = 30): RunRecord[] {
    const rows = this.db.prepare("SELECT * FROM runs ORDER BY id DESC LIMIT ?").all(limit) as Row[];
    return rows.map((r) => {
      let stats: Record<string, unknown> = {};
      try {
        stats = JSON.parse(String(r["stats"] ?? "{}")) as Record<string, unknown>;
      } catch {
        stats = {};
      }
      const ok = r["ok"];
      return {
        id: num(r["id"]) ?? 0,
        job: String(r["job"]),
        started_at: String(r["started_at"]),
        finished_at: str(r["finished_at"]),
        ok: ok === null || ok === undefined ? null : bool(ok),
        stats,
        error: str(r["error"]),
      };
    });
  }

  lastSuccessfulRun(job: string): RunRecord | null {
    return this.recentRuns(500).find((r) => r.job === job && r.ok === true) ?? null;
  }

  // ─── reports / resources ─────────────────────────────────────────────────

  saveReport(kind: string, id: string, markdown: string): void {
    this.db
      .prepare(
        `INSERT INTO reports (kind, id, generated_at, markdown) VALUES (?, ?, ?, ?)
         ON CONFLICT(kind, id) DO UPDATE SET generated_at = excluded.generated_at, markdown = excluded.markdown`,
      )
      .run(kind, id, isoNow(), markdown);
  }

  getReport(kind: string, id: string): { kind: string; id: string; generated_at: string; markdown: string } | null {
    const r = this.db.prepare("SELECT * FROM reports WHERE kind = ? AND id = ?").get(kind, id) as Row | undefined;
    return r ? { kind: String(r["kind"]), id: String(r["id"]), generated_at: String(r["generated_at"]), markdown: String(r["markdown"]) } : null;
  }

  listReports(kind?: string, limit = 100): Array<{ kind: string; id: string; generated_at: string; bytes: number }> {
    const rows = (
      kind
        ? this.db.prepare("SELECT kind, id, generated_at, length(markdown) AS bytes FROM reports WHERE kind = ? ORDER BY id DESC LIMIT ?").all(kind, limit)
        : this.db.prepare("SELECT kind, id, generated_at, length(markdown) AS bytes FROM reports ORDER BY kind, id DESC LIMIT ?").all(limit)
    ) as Row[];
    return rows.map((r) => ({ kind: String(r["kind"]), id: String(r["id"]), generated_at: String(r["generated_at"]), bytes: num(r["bytes"]) ?? 0 }));
  }

  latestReport(kind: string): { kind: string; id: string; generated_at: string; markdown: string } | null {
    const r = this.db.prepare("SELECT * FROM reports WHERE kind = ? ORDER BY id DESC LIMIT 1").get(kind) as Row | undefined;
    return r ? { kind: String(r["kind"]), id: String(r["id"]), generated_at: String(r["generated_at"]), markdown: String(r["markdown"]) } : null;
  }

  /** Store a resource page. A synced copy keeps its original timestamp. */
  saveResource(fullName: string, markdown: string, options: { generatedAt?: string } = {}): void {
    this.db
      .prepare(
        `INSERT INTO resources (full_name, generated_at, markdown) VALUES (?, ?, ?)
         ON CONFLICT(full_name) DO UPDATE SET generated_at = excluded.generated_at, markdown = excluded.markdown`,
      )
      .run(fullName, options.generatedAt ?? isoNow(), markdown);
    // Bench status is not changed here: only a page written after the owner's rating moves `rated` to `resourced` (the API does that).
  }

  getResource(fullName: string): { full_name: string; generated_at: string; markdown: string } | null {
    const r = this.db.prepare("SELECT * FROM resources WHERE full_name = ?").get(fullName) as Row | undefined;
    return r ? { full_name: String(r["full_name"]), generated_at: String(r["generated_at"]), markdown: String(r["markdown"]) } : null;
  }

  listResources(): Array<{ full_name: string; generated_at: string }> {
    return (this.db.prepare("SELECT full_name, generated_at FROM resources ORDER BY generated_at DESC").all() as Row[]).map((r) => ({
      full_name: String(r["full_name"]),
      generated_at: String(r["generated_at"]),
    }));
  }

  // ─── stats / export / import ─────────────────────────────────────────────

  stats(): StoreStats {
    const one = (sql: string): Row => this.db.prepare(sql).get() as Row;
    const repos = one("SELECT COUNT(*) c, SUM(enriched_at IS NOT NULL) e, SUM(summary IS NOT NULL) s FROM repos");
    const apps = one("SELECT COUNT(*) c, MIN(list_date) f, MAX(list_date) l FROM appearances");
    return {
      repos: num(repos["c"]) ?? 0,
      enriched: num(repos["e"]) ?? 0,
      summarized: num(repos["s"]) ?? 0,
      appearances: num(apps["c"]) ?? 0,
      first_list_date: str(apps["f"]),
      last_list_date: str(apps["l"]),
      snapshots: num(one("SELECT COUNT(*) c FROM snapshot_files")["c"]) ?? 0,
      user_stars: num(one("SELECT COUNT(*) c FROM user_stars")["c"]) ?? 0,
      shortlist: num(one("SELECT COUNT(*) c FROM shortlist WHERE status != 'dropped'")["c"]) ?? 0,
      ratings: num(one("SELECT COUNT(*) c FROM ratings")["c"]) ?? 0,
      reports: num(one("SELECT COUNT(*) c FROM reports")["c"]) ?? 0,
      resources: num(one("SELECT COUNT(*) c FROM resources")["c"]) ?? 0,
      scores: num(one("SELECT COUNT(*) c FROM scores")["c"]) ?? 0,
    };
  }

  exportBundle(): ExportBundle {
    const all = (sql: string): Row[] => this.db.prepare(sql).all() as Row[];
    return {
      exported_at: isoNow(),
      repos: all("SELECT * FROM repos ORDER BY full_name").map(rowToRepo),
      appearances: all("SELECT * FROM appearances ORDER BY list_date, source, window, language_list, rank").map((r) => ({
        full_name: String(r["full_name"]),
        source: String(r["source"]) as SourceId,
        window: String(r["window"]) as Window,
        list_date: String(r["list_date"]),
        language_list: String(r["language_list"]),
        rank: num(r["rank"]) ?? 0,
        stars_period: num(r["stars_period"]),
        stars_total: num(r["stars_total"]),
      })),
      star_history: all("SELECT * FROM star_history ORDER BY full_name, observed_at").map((r) => ({
        full_name: String(r["full_name"]),
        observed_at: String(r["observed_at"]),
        stars: num(r["stars"]) ?? 0,
      })),
      user_stars: this.userStars(),
      shortlist: this.listShortlist(true),
      ratings: this.listRatings(),
      agent_ratings: this.listAgentRatings(),
      aliases: this.listAliases(),
      reports: all("SELECT * FROM reports ORDER BY kind, id").map((r) => ({
        kind: String(r["kind"]),
        id: String(r["id"]),
        generated_at: String(r["generated_at"]),
        markdown: String(r["markdown"]),
      })),
      resources: all("SELECT * FROM resources ORDER BY full_name").map((r) => ({
        full_name: String(r["full_name"]),
        generated_at: String(r["generated_at"]),
        markdown: String(r["markdown"]),
      })),
      meta: this.allMeta(),
    };
  }

  /** Import repo records (enrichment cache). Existing rows are replaced only when the incoming record is newer. */
  importRepos(repos: readonly RepoRecord[]): number {
    let n = 0;
    this.transaction(() => {
      for (const r of repos) {
        if (!isFullName(r.full_name)) continue;
        const existing = this.getRepo(r.full_name);
        if (existing?.enriched_at && r.enriched_at && existing.enriched_at > r.enriched_at) continue;
        // Published shards carry no README text; keep the local copy when the README has not changed.
        const excerpt = r.readme_excerpt ?? (existing && existing.readme_hash === r.readme_hash ? existing.readme_excerpt : null);
        this.upsertRepoMeta({ ...r, readme_excerpt: excerpt });
        if (r.summary && r.business_use && r.summary_source && r.summary_hash) {
          this.setSummary(r.full_name, { summary: r.summary, business_use: r.business_use, source: r.summary_source, hash: r.summary_hash });
        }
        if (r.category !== "other" || r.category_source === "owner") this.setCategory(r.full_name, r.category, r.category_source);
        n++;
      }
    });
    return n;
  }

  importOwnerState(input: { shortlist?: ShortlistEntry[]; ratings?: Rating[] }): void {
    this.transaction(() => {
      for (const s of input.shortlist ?? []) {
        const cur = this.getShortlist(s.full_name);
        if (cur && cur.updated_at >= s.updated_at) continue;
        this.ensureRepo(s.full_name);
        this.db
          .prepare("INSERT OR REPLACE INTO shortlist (full_name, status, note, updated_at) VALUES (?, ?, ?, ?)")
          .run(s.full_name, s.status, s.note, s.updated_at);
      }
      for (const r of input.ratings ?? []) {
        const cur = this.getRating(r.full_name);
        if (cur && cur.updated_at >= r.updated_at) continue;
        this.ensureRepo(r.full_name);
        this.db
          .prepare("INSERT OR REPLACE INTO ratings (full_name, rating, notes, tested_at, verdict_override, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
          .run(r.full_name, r.rating, r.notes, r.tested_at, r.verdict_override, r.updated_at);
      }
    });
  }
}
