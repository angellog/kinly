import type { Snapshot, TrendingEntry, Window } from "../types.js";
import { isoNow } from "../util/dates.js";
import { isFullName, parseCount, squash } from "../util/text.js";

/**
 * vitalets/github-trending-repos — a bot that comments on one GitHub issue per
 * (language, period) with the repos that newly entered trending. Issue 6 is
 * "New daily trending repos in all languages", issue 15 the weekly list.
 *
 * Comment body format (one repo per bullet):
 *   **[owner/repo](https://github.com/owner/repo)**
 *   description
 *   +N stars today | this week
 * The exact spacing has varied over the years, so parsing is forgiving: any
 * bold-linked owner/repo starts an entry; "+N stars" within the entry sets
 * stars_period.
 *
 * Liveness is not assumed: the archive's `pushed_at` stalled in 2025-11 and
 * the comment counts on the all-language issues are low. `fetchVitaletsComments`
 * reports the newest comment date so the collector can decide whether the
 * source is worth consulting.
 */

export const VITALETS_REPO = "vitalets/github-trending-repos";
export const VITALETS_ISSUES: Record<Window, number> = { daily: 6, weekly: 15, monthly: 0 };

export interface VitaletsComment {
  created_at: string;
  body: string;
}

export function parseVitaletsComment(comment: VitaletsComment, window: Window): Snapshot | null {
  const text = comment.body;
  const entries: TrendingEntry[] = [];
  const re = /\*\*\[([^\]]+)\]\(https?:\/\/github\.com\/[^)]+\)\*\*([\s\S]*?)(?=\*\*\[|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const fullName = (m[1] ?? "").trim();
    if (!isFullName(fullName)) continue;
    const rest = m[2] ?? "";
    const stars = /\+\s*([\d,]+)\s*stars?/i.exec(rest);
    const lines = rest
      .split(/\r?\n/)
      .map((l) => squash(l))
      .filter((l) => l.length > 0 && !/^\+\s*[\d,]+\s*stars?/i.test(l) && !/^-{3,}$/.test(l));
    entries.push({
      full_name: fullName,
      rank: entries.length + 1,
      description: lines[0] ?? null,
      stars_period: stars?.[1] ? parseCount(stars[1]) : null,
    });
  }
  if (entries.length === 0) return null;
  const date = comment.created_at.slice(0, 10);
  return { source: "vitalets-archive", window, list_date: date, language_list: "all", fetched_at: isoNow(), entries };
}

export interface GitHubJsonFetcher {
  (path: string, params?: Record<string, string | number>): Promise<unknown>;
}

/** Fetch comments on the archive issue for a window, newest first, up to `pages` pages of 100. */
export async function fetchVitaletsComments(window: Window, api: GitHubJsonFetcher, pages = 1): Promise<VitaletsComment[]> {
  const issue = VITALETS_ISSUES[window];
  if (!issue) return [];
  const out: VitaletsComment[] = [];
  for (let page = 1; page <= pages; page++) {
    const raw = await api(`/repos/${VITALETS_REPO}/issues/${issue}/comments`, { per_page: 100, page, sort: "created", direction: "desc" });
    if (!Array.isArray(raw) || raw.length === 0) break;
    for (const c of raw as Array<{ created_at?: string; body?: string }>) {
      if (typeof c.created_at === "string" && typeof c.body === "string") out.push({ created_at: c.created_at, body: c.body });
    }
    if (raw.length < 100) break;
  }
  return out;
}
