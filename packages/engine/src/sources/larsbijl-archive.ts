import type { Snapshot, TrendingEntry } from "../types.js";
import { isoNow } from "../util/dates.js";
import { isFullName, squash } from "../util/text.js";

/**
 * larsbijl/trending_archive — a daily markdown archive of github.com/trending
 * per language (python, go, rust, cpp, javascript, typescript), updated every
 * day since 2014. This is the 18-month backfill source.
 *
 * File layout (verified 2026-10-08):
 *   2026-10/2026-10-07.md            months of the current year are top-level
 *   2025/2025-04/2025-04-01.md       older years nest months under the year
 * Each file: `### YYYY-MM-DD`, then `#### <language>` sections with
 * `* [owner/repo](url): description` bullets. A `_short.md` sibling holds only
 * the day's new entries; we read the full file.
 */

export const LARSBIJL_RAW = "https://raw.githubusercontent.com/larsbijl/trending_archive/master";

/** Candidate raw URLs for a date, most likely first. */
export function larsbijlCandidateUrls(date: string): string[] {
  const year = date.slice(0, 4);
  const month = date.slice(0, 7);
  return [`${LARSBIJL_RAW}/${month}/${date}.md`, `${LARSBIJL_RAW}/${year}/${month}/${date}.md`];
}

/** Map the archive's section names to the language slugs the trending page uses. */
const SECTION_TO_LANGUAGE: Record<string, string> = {
  python: "python",
  go: "go",
  rust: "rust",
  cpp: "c++",
  "c++": "c++",
  javascript: "javascript",
  typescript: "typescript",
  coffeescript: "coffeescript",
};

export function parseLarsbijlMarkdown(markdown: string, date: string): Snapshot[] {
  const snapshots: Snapshot[] = [];
  let current: { language: string; entries: TrendingEntry[] } | null = null;
  const flush = (): void => {
    if (current && current.entries.length > 0) {
      snapshots.push({
        source: "larsbijl-archive",
        window: "daily",
        list_date: date,
        language_list: current.language,
        fetched_at: isoNow(),
        entries: current.entries,
      });
    }
    current = null;
  };
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const section = /^####\s+(.+?)\s*$/.exec(line);
    if (section?.[1]) {
      flush();
      const key = section[1].trim().toLowerCase();
      current = { language: SECTION_TO_LANGUAGE[key] ?? key, entries: [] };
      continue;
    }
    if (!current) continue;
    const bullet = /^\*\s+\[([^\]]+)\]\(https?:\/\/github\.com\/[^)]+\)\s*:?\s*(.*)$/.exec(line);
    if (!bullet?.[1]) continue;
    const fullName = bullet[1].trim();
    if (!isFullName(fullName)) continue;
    const description = squash(bullet[2] ?? "");
    current.entries.push({
      full_name: fullName,
      rank: current.entries.length + 1,
      description: description.length > 0 ? description : null,
      language: current.language,
    });
  }
  flush();
  return snapshots;
}

export interface LarsbijlFetchResult {
  date: string;
  url: string | null;
  status: "ok" | "missing" | "error";
  snapshots: Snapshot[];
  error?: string;
}

export async function fetchLarsbijlDay(date: string, fetchImpl: typeof fetch = fetch): Promise<LarsbijlFetchResult> {
  let lastError: string | undefined;
  for (const url of larsbijlCandidateUrls(date)) {
    try {
      const res = await fetchImpl(url, { headers: { "user-agent": "KinlyBot/0.1 (+https://github.com/angellog/kinly)" } });
      if (res.status === 404) continue;
      if (!res.ok) {
        lastError = `HTTP ${res.status} from ${url}`;
        continue;
      }
      const md = await res.text();
      return { date, url, status: "ok", snapshots: parseLarsbijlMarkdown(md, date) };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  return lastError ? { date, url: null, status: "error", snapshots: [], error: lastError } : { date, url: null, status: "missing", snapshots: [] };
}
