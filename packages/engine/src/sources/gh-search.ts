import type { Snapshot, TrendingEntry } from "../types.js";
import { isoDate, isoNow } from "../util/dates.js";
import { isFullName, squash } from "../util/text.js";
import type { GitHubClient } from "../github/client.js";

/**
 * "New high-growth" repos from the GitHub search API: created within the
 * window and already above a star threshold. This is the only source that
 * catches a repo before it reaches the trending page, and it works keyless
 * (10 searches/min unauthenticated, 30/min with a token).
 */

interface SearchItem {
  full_name: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
}

export interface SearchNewOptions {
  /** Created on or after this ISO date (default: 30 days ago). */
  createdSince?: string;
  /** Minimum stars (default 300). */
  minStars?: number;
  /** Up to 100 per page; one page by default. */
  perPage?: number;
  listDate?: string;
}

export async function fetchNewHighGrowth(client: GitHubClient, options: SearchNewOptions = {}): Promise<Snapshot> {
  const since = options.createdSince ?? new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const minStars = options.minStars ?? 300;
  const q = `created:>=${since} stars:>=${minStars} is:public archived:false`;
  const data = await client.rest<{ items: SearchItem[] }>("/search/repositories", {
    q,
    sort: "stars",
    order: "desc",
    per_page: Math.min(100, Math.max(1, options.perPage ?? 100)),
  });
  const entries: TrendingEntry[] = [];
  for (const item of data?.items ?? []) {
    if (!isFullName(item.full_name)) continue;
    entries.push({
      full_name: item.full_name,
      rank: entries.length + 1,
      description: item.description ? squash(item.description) : null,
      language: item.language,
      stars_total: item.stargazers_count,
      forks: item.forks_count,
    });
  }
  return {
    source: "gh-search-new",
    window: "monthly",
    list_date: options.listDate ?? isoDate(),
    language_list: "all",
    fetched_at: isoNow(),
    entries,
  };
}
