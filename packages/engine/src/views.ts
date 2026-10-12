import type { ListRow, Store } from "./store/store.js";
import type { CategoryId, ListKind, Profile, RepoRecord, RepoView, ScoreBreakdown, TrendSignals } from "./types.js";
import { kinlyScore } from "./score/kinly-score.js";
import { relevanceScore } from "./score/profile.js";
import { addDays } from "./util/dates.js";

/** Assemble the RepoView the API and the reports present. Uses stored scores when present. */
export function repoView(store: Store, repo: RepoRecord, profile: Profile | null, since?: string): RepoView {
  const signals: TrendSignals = store.signals(repo.full_name, since);
  const stored = store.getScore(repo.full_name);
  let relevance: number;
  let score: ScoreBreakdown;
  if (stored) {
    relevance = stored.relevance;
    score = stored.score;
  } else {
    relevance = profile ? relevanceScore(repo, profile).score : 0;
    score = kinlyScore(repo, signals, relevance);
  }
  return {
    repo,
    signals,
    score,
    relevance,
    shortlist: store.getShortlist(repo.full_name),
    rating: store.getRating(repo.full_name),
    agent_rating: store.getAgentRating(repo.full_name),
    starred: store.isStarred(repo.full_name),
  };
}

export interface RankedView extends RepoView {
  rank: number;
  metric: number;
  metric_label: string;
}

export interface ListOptions {
  date?: string;
  limit?: number;
  category?: CategoryId;
  min_relevance?: number;
  /** Fetch this many candidates before filtering (default 4x limit, min 60). */
  candidates?: number;
  since?: string;
}

/** A ranked list joined with repo views, filtered by category / relevance, re-ranked after filtering. */
export function rankedList(store: Store, kind: ListKind, profile: Profile | null, options: ListOptions = {}): RankedView[] {
  const limit = Math.max(1, Math.min(200, options.limit ?? 10));
  // Filters run after the list query, so a filtered list needs a much deeper candidate pool.
  const filtered = options.category !== undefined || typeof options.min_relevance === "number";
  const candidates = Math.max(filtered ? 3000 : 60, options.candidates ?? limit * 4);
  const rows: ListRow[] = store.list(kind, { ...(options.date ? { date: options.date } : {}), limit: candidates, ...(options.since ? { since: options.since } : {}) });
  const out: RankedView[] = [];
  for (const row of rows) {
    const repo = store.getRepo(row.full_name);
    if (!repo) continue;
    if (options.category && repo.category !== options.category) continue;
    const view = repoView(store, repo, profile, options.since);
    if (typeof options.min_relevance === "number" && view.relevance < options.min_relevance) continue;
    out.push({ ...view, rank: out.length + 1, metric: row.metric, metric_label: row.metric_label });
    if (out.length >= limit) break;
  }
  return out;
}

export interface PickOptions {
  date: string;
  n: number;
  /** Shortlisted + testing above this many and picks shrink to the free slots (D14). */
  wipLimit?: number;
  minRelevance?: number;
  minScore?: number;
  /** Which report's earlier picks to hold back (default "daily"). */
  kind?: string;
}

export interface PickResult {
  picks: RankedView[];
  /** Repos currently shortlisted or in testing. */
  wip: string[];
  /** Repos left out because they are already known (starred, on the shortlist, or picked in the last 30 days). */
  known: RankedView[];
}

/**
 * Picks are novel and relevant, not merely big (D14): never a repo the owner
 * already starred, already has on the shortlist, or was offered in the last
 * 30 days; relevance and score floors; a novelty bonus for repos first seen
 * in the last 90 days or created in the last year; and no more picks than
 * there are free testing slots.
 */
export function selectPicks(store: Store, views: readonly RankedView[], options: PickOptions): PickResult {
  const wipLimit = options.wipLimit ?? 5;
  const minRel = options.minRelevance ?? 50;
  const minScore = options.minScore ?? 45;
  const wip = store.listShortlist().filter((s) => s.status === "shortlisted" || s.status === "testing").map((s) => s.full_name);
  const recentlyPicked = store.pickedBetween(addDays(options.date, -30), options.date, options.kind ?? "daily");
  const known: RankedView[] = [];
  const eligible: Array<{ v: RankedView; key: number }> = [];
  for (const v of views) {
    const onShortlist = v.shortlist !== null && v.shortlist.status !== "discovered";
    if (v.starred || onShortlist || recentlyPicked.has(v.repo.full_name)) {
      if (v.relevance >= minRel) known.push(v);
      continue;
    }
    if (v.relevance < minRel || v.score.total < minScore || v.score.verdict === "SKIP") continue;
    const firstSeen = v.signals.first_seen;
    const novel = (firstSeen !== null && firstSeen >= addDays(options.date, -90)) || (v.repo.created_at !== null && v.repo.created_at.slice(0, 10) >= addDays(options.date, -365));
    const stale = firstSeen !== null && firstSeen < addDays(options.date, -365) && !(v.repo.latest_release_at && v.repo.latest_release_at.slice(0, 10) >= addDays(options.date, -90));
    eligible.push({ v, key: v.relevance * 0.6 + v.score.total * 0.4 + (novel ? 10 : 0) - (stale ? 10 : 0) });
  }
  eligible.sort((a, b) => b.key - a.key || a.v.rank - b.v.rank);
  const free = Math.max(0, wipLimit - wip.length);
  return { picks: eligible.slice(0, Math.min(options.n, free)).map((e) => e.v), wip, known: known.slice(0, 10) };
}

/** Top-N per category from a list, preserving list order within each category. */
export function perCategory(views: readonly RankedView[], perCat: number): Map<CategoryId, RankedView[]> {
  const out = new Map<CategoryId, RankedView[]>();
  for (const v of views) {
    const arr = out.get(v.repo.category) ?? [];
    if (arr.length >= perCat) continue;
    arr.push(v);
    out.set(v.repo.category, arr);
  }
  return out;
}

/** Recompute and store relevance + score for every repo (or a subset). */
export function rescoreAll(store: Store, profile: Profile, names?: readonly string[], now?: string): number {
  const list = names ?? store.allRepoNames();
  let n = 0;
  store.transaction(() => {
    for (const name of list) {
      const repo = store.getRepo(name);
      if (!repo) continue;
      const signals = store.signals(name);
      const rel = relevanceScore(repo, profile).score;
      const score = kinlyScore(repo, signals, rel, now);
      store.upsertScore(name, rel, score);
      n++;
    }
  });
  return n;
}
