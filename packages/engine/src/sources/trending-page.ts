import type { Snapshot, TrendingEntry, Window } from "../types.js";
import { isoDate, isoNow } from "../util/dates.js";
import { decodeEntities, isFullName, parseCount, squash, stripTags } from "../util/text.js";

/**
 * github.com/trending — the live list, parsed from HTML.
 *
 * The page is server-rendered and served without authentication. Each repo is
 * an `<article class="Box-row">`; the fields we need are stable landmarks
 * inside it (the h2 link, the `col-9` description paragraph, the
 * `itemprop="programmingLanguage"` span, the stargazers/forks links and the
 * "N stars today|this week|this month" span). A page that parses to zero rows
 * is an error, not an empty list: GitHub does serve the page with a
 * "trending repositories are being dissected" notice during rebuilds.
 */

export const TRENDING_LANGUAGES: readonly string[] = [
  "python",
  "typescript",
  "javascript",
  "rust",
  "go",
  "jupyter-notebook",
  "html",
  "css",
  "swift",
  "shell",
];

export const WINDOW_TO_SINCE: Record<Window, string> = { daily: "daily", weekly: "weekly", monthly: "monthly" };

const PERIOD_LABEL: Record<Window, string> = { daily: "today", weekly: "this week", monthly: "this month" };

const USER_AGENT = "Mozilla/5.0 (compatible; KinlyBot/0.1; +https://github.com/angellog/kinly)";

export function trendingUrl(window: Window, language = "all"): string {
  const base = language === "all" ? "https://github.com/trending" : `https://github.com/trending/${encodeURIComponent(language)}`;
  return `${base}?since=${WINDOW_TO_SINCE[window]}`;
}

export class TrendingParseError extends Error {
  override readonly name = "TrendingParseError";
}

/** Parse a trending page's HTML into entries. Throws when no rows are found. */
export function parseTrendingHtml(html: string, window: Window): TrendingEntry[] {
  const rows = html.match(/<article class="Box-row">[\s\S]*?<\/article>/g) ?? [];
  if (rows.length === 0) {
    if (/trending repositories are being dissected|currently being dissected/i.test(html)) {
      throw new TrendingParseError("github.com/trending is being rebuilt (\"dissected\"); retry later");
    }
    throw new TrendingParseError("no Box-row articles found: the trending page layout may have changed");
  }
  const entries: TrendingEntry[] = [];
  const periodRe = new RegExp(`([\\d,]+)\\s+stars?\\s+${PERIOD_LABEL[window].replace(" ", "\\s+")}`, "i");
  let rank = 0;
  for (const row of rows) {
    const nameMatch = /<h2[^>]*>[\s\S]*?<a[^>]*href="\/([^/"]+\/[^/"?#]+)"/.exec(row);
    const fullName = nameMatch?.[1] ? decodeEntities(nameMatch[1]).trim() : null;
    if (!fullName || !isFullName(fullName)) continue;
    rank++;
    const descMatch = /<p class="[^"]*col-9[^"]*"[^>]*>([\s\S]*?)<\/p>/.exec(row);
    const langMatch = /itemprop="programmingLanguage">([^<]+)</.exec(row);
    const starsMatch = /href="\/[^"]+\/stargazers"[^>]*>([\s\S]*?)<\/a>/.exec(row);
    const forksMatch = /href="\/[^"]+\/forks"[^>]*>([\s\S]*?)<\/a>/.exec(row);
    const periodMatch = periodRe.exec(stripTags(row));
    entries.push({
      full_name: fullName,
      rank,
      description: descMatch?.[1] ? squash(decodeEntities(stripTags(descMatch[1]))) || null : null,
      language: langMatch?.[1] ? squash(decodeEntities(langMatch[1])) : null,
      stars_total: starsMatch?.[1] ? parseCount(starsMatch[1]) : null,
      forks: forksMatch?.[1] ? parseCount(forksMatch[1]) : null,
      stars_period: periodMatch?.[1] ? parseCount(periodMatch[1]) : null,
    });
  }
  if (entries.length === 0) throw new TrendingParseError("rows were found but none parsed to a repository name");
  return entries;
}

export interface FetchTrendingOptions {
  fetchImpl?: typeof fetch;
  /** The date to stamp the list with; defaults to today (UTC). */
  listDate?: string;
  retries?: number;
}

/** Fetch and parse one live trending list. */
export async function fetchTrending(window: Window, language = "all", options: FetchTrendingOptions = {}): Promise<Snapshot> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = trendingUrl(window, language);
  const retries = options.retries ?? 2;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchImpl(url, { headers: { "user-agent": USER_AGENT, accept: "text/html" }, redirect: "follow" });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status} from ${url}`);
      if (!res.ok) throw new TrendingParseError(`HTTP ${res.status} from ${url}`);
      const html = await res.text();
      const entries = parseTrendingHtml(html, window);
      return {
        source: "trending-page",
        window,
        list_date: options.listDate ?? isoDate(),
        language_list: language,
        fetched_at: isoNow(),
        entries,
      };
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Fetch every list the daily collect uses: all three windows for "all", plus daily per language. */
export async function fetchAllTrending(options: FetchTrendingOptions & { languages?: readonly string[]; windows?: readonly Window[] } = {}): Promise<{
  snapshots: Snapshot[];
  failures: Array<{ window: Window; language: string; error: string }>;
}> {
  const windows = options.windows ?? (["daily", "weekly", "monthly"] as const);
  const languages = options.languages ?? TRENDING_LANGUAGES;
  const snapshots: Snapshot[] = [];
  const failures: Array<{ window: Window; language: string; error: string }> = [];
  const jobs: Array<{ window: Window; language: string }> = [];
  for (const w of windows) jobs.push({ window: w, language: "all" });
  for (const l of languages) jobs.push({ window: "daily", language: l });
  for (const job of jobs) {
    try {
      snapshots.push(await fetchTrending(job.window, job.language, options));
    } catch (err) {
      failures.push({ window: job.window, language: job.language, error: err instanceof Error ? err.message : String(err) });
    }
    // Be a polite scraper: ~1 request/second.
    await new Promise((r) => setTimeout(r, 900));
  }
  return { snapshots, failures };
}
