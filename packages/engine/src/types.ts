/**
 * Shared types for the Kinly engine.
 *
 * Everything that crosses a module boundary is declared here so the store,
 * the sources, the scorer and the reports agree on one vocabulary.
 */

/** A trending window as GitHub names it. */
export type Window = "daily" | "weekly" | "monthly";

/** The lists a reader can ask for. */
export type ListKind = "today" | "week" | "month" | "persistent" | "rising" | "new";

export const LIST_KINDS: readonly ListKind[] = ["today", "week", "month", "persistent", "rising", "new"];

/** Where a trending observation came from. */
export type SourceId =
  | "trending-page"
  | "larsbijl-archive"
  | "vitalets-archive"
  | "gh-search-new"
  | "stars";

export const SOURCE_IDS: readonly SourceId[] = [
  "trending-page",
  "larsbijl-archive",
  "vitalets-archive",
  "gh-search-new",
  "stars",
];

/** One row of a trending list, exactly as the source presented it. */
export interface TrendingEntry {
  full_name: string;
  rank: number;
  description?: string | null;
  language?: string | null;
  stars_total?: number | null;
  forks?: number | null;
  /** Stars gained over the list's window ("N stars today / this week / this month"). */
  stars_period?: number | null;
}

/**
 * A trending list observed at one moment: one source, one window, one date,
 * one language list ("all" or a GitHub language slug). This is the unit the
 * archive under data/snapshots stores, and the unit the store ingests.
 */
export interface Snapshot {
  source: SourceId;
  window: Window;
  /** ISO date (YYYY-MM-DD) the list is for. */
  list_date: string;
  /** "all" or the language slug used in the URL (python, typescript, ...). */
  language_list: string;
  /** ISO timestamp when it was fetched or, for archives, when the archive recorded it. */
  fetched_at: string;
  entries: TrendingEntry[];
}

export type LicenseClass =
  | "permissive"
  | "weak-copyleft"
  | "strong-copyleft"
  | "source-available"
  | "none"
  | "unknown";

export const CATEGORY_IDS = [
  "ai-agents",
  "mcp-tools",
  "llm-infra",
  "design-ui",
  "content-media",
  "automation-workflow",
  "social-marketing",
  "business-ops",
  "data-analytics",
  "devtools",
  "infra-devops",
  "security",
  "learning-reference",
  "web-mobile",
  "systems-languages",
  "other",
] as const;

export type CategoryId = (typeof CATEGORY_IDS)[number];

export type CategorySource = "rule" | "llm" | "owner";

export type Verdict = "BUILD" | "WATCH" | "SKIP";

/** Enriched repository record as stored. */
export interface RepoRecord {
  full_name: string;
  owner: string;
  name: string;
  description: string | null;
  language: string | null;
  topics: string[];
  stars: number | null;
  forks: number | null;
  created_at: string | null;
  pushed_at: string | null;
  license_spdx: string | null;
  license_class: LicenseClass;
  open_core: boolean;
  archived: boolean;
  homepage: string | null;
  latest_release: string | null;
  latest_release_at: string | null;
  readme_excerpt: string | null;
  readme_hash: string | null;
  summary: string | null;
  business_use: string | null;
  summary_source: "llm" | "heuristic" | null;
  summary_hash: string | null;
  category: CategoryId;
  category_source: CategorySource;
  enriched_at: string | null;
  summary_at: string | null;
}

/** The subset of a RepoRecord that enrichment produces. */
export type RepoMeta = Omit<
  RepoRecord,
  | "summary"
  | "business_use"
  | "summary_source"
  | "summary_hash"
  | "category"
  | "category_source"
  | "summary_at"
>;

/** Trend signals computed from appearances and star history. */
export interface TrendSignals {
  full_name: string;
  appearances: number;
  distinct_days: number;
  distinct_weeks: number;
  first_seen: string | null;
  last_seen: string | null;
  /** Most stars gained in one day on a daily list ("N stars today"). */
  peak_stars_period: number | null;
  /** Stars per day over the last 7 days: from stargazers history when fresh, else from star-count snapshots; null without data. */
  velocity_7d: number | null;
  /** Stars created in the last 7 days per stargazers history (D13), null when not fetched. */
  stars_7d: number | null;
  /** The biggest week on record per stargazers history, null when not fetched. */
  peak_week_stars: number | null;
  sources: SourceId[];
}

export interface ScoreBreakdown {
  adoption: number;
  maintenance: number;
  persistence: number;
  license: number;
  relevance: number;
  total: number;
  verdict: Verdict;
  reasons: string[];
}

export type ShortlistStatus = "discovered" | "shortlisted" | "testing" | "rated" | "resourced" | "dropped";

export const SHORTLIST_STATUSES: readonly ShortlistStatus[] = [
  "discovered",
  "shortlisted",
  "testing",
  "rated",
  "resourced",
  "dropped",
];

export interface ShortlistEntry {
  full_name: string;
  status: ShortlistStatus;
  note: string | null;
  updated_at: string;
}

export interface Rating {
  full_name: string;
  rating: number;
  notes: string | null;
  tested_at: string | null;
  verdict_override: Verdict | null;
  updated_at: string;
}

/** The Kinly agent's own test result. Kept apart from the owner's rating: only the owner moves a repo to `rated` (P-M5). */
export interface AgentRating {
  full_name: string;
  rating: number;
  notes: string | null;
  /** What was run, in which container, and what happened. Shown on the resource page. */
  test_log: string | null;
  agent: string | null;
  updated_at: string;
}

/** One week of the stargazers/history endpoint: stars created per day, Sunday first (D13). */
export interface StarWeek {
  week_start: string;
  total: number;
  days: number[];
}

/** A repo as the API and the reports present it: record + signals + score + owner state. */
export interface RepoView {
  repo: RepoRecord;
  signals: TrendSignals;
  score: ScoreBreakdown;
  relevance: number;
  shortlist: ShortlistEntry | null;
  rating: Rating | null;
  agent_rating: AgentRating | null;
  /** True when the owner has starred it. */
  starred: boolean;
}

export interface RunRecord {
  id: number;
  job: string;
  started_at: string;
  finished_at: string | null;
  ok: boolean | null;
  stats: Record<string, unknown>;
  error: string | null;
}

/** The owner's interest profile: what "relevant" means. */
export interface Profile {
  /** Category weights 0..1. Missing categories default to 0.3. */
  category_weights: Partial<Record<CategoryId, number>>;
  /** Keywords with weights; matched against name, description and topics. */
  keywords: Record<string, number>;
  /** Topic frequencies derived from the owner's stars. */
  star_topics: Record<string, number>;
  /** Free-text description of the business, used by the LLM when writing business uses. */
  business_context: string;
  generated_at: string;
}
