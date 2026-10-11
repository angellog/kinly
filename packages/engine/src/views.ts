import type { ListRow, Store } from "./store/store.js";
import type { CategoryId, ListKind, Profile, RepoRecord, RepoView, ScoreBreakdown, TrendSignals } from "./types.js";
import { kinlyScore } from "./score/kinly-score.js";
import { relevanceScore } from "./score/profile.js";

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
  const candidates = Math.max(60, options.candidates ?? limit * 4);
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
