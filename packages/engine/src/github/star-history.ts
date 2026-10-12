import type { StarWeek } from "../types.js";
import { addDays } from "../util/dates.js";
import { GitHubHttpError, type GitHubClient } from "./client.js";

/**
 * `GET /repos/{owner}/{repo}/stargazers/history` (shipped 2026-09-04, D13):
 * weekly buckets of stars created per day, newest first, any public repo,
 * one core request per page of up to 30 weeks, back to the creation week.
 * Day boundaries are GitHub's, not UTC, so cells are compared with each
 * other and never with Kinly's own UTC snapshots. The sum of buckets counts
 * star creations and can exceed the live star count (un-stars); the two are
 * stored apart and never reconciled.
 */

interface Bucket {
  week: number;
  total: number;
  days: number[];
}

export const STAR_HISTORY_PAGE = 30;
export const STAR_HISTORY_MAX_PAGES = 100;

function toWeek(b: Bucket): StarWeek {
  return {
    week_start: new Date(b.week * 1000).toISOString().slice(0, 10),
    total: Number.isFinite(b.total) ? b.total : 0,
    days: Array.isArray(b.days) ? b.days.slice(0, 7).map((d) => (Number.isFinite(d) ? d : 0)) : [0, 0, 0, 0, 0, 0, 0],
  };
}

/** Up to `weeks` most recent weeks, newest first; null when the repo is gone. */
export async function fetchStarHistory(client: GitHubClient, fullName: string, weeks: number): Promise<StarWeek[] | null> {
  const want = Math.max(1, Math.min(weeks, STAR_HISTORY_PAGE * STAR_HISTORY_MAX_PAGES));
  const perPage = Math.min(STAR_HISTORY_PAGE, want);
  const out: StarWeek[] = [];
  for (let page = 1; out.length < want && page <= STAR_HISTORY_MAX_PAGES; page++) {
    let rows: Bucket[] | null;
    try {
      rows = await client.rest<Bucket[]>(`/repos/${fullName}/stargazers/history`, { per_page: perPage, page }, { allow404: true });
    } catch (err) {
      if (err instanceof GitHubHttpError && err.status === 422) break; // past the 100-page window
      throw err;
    }
    if (rows === null) return page === 1 ? null : out;
    if (!Array.isArray(rows) || rows.length === 0) break;
    out.push(...rows.map(toWeek));
    if (rows.length < perPage) break;
  }
  return out.slice(0, want);
}

/** Per-day series, oldest first, cut at `asOf` (days after it are not yet observed). */
export function dailySeries(weeks: readonly StarWeek[], asOf: string): Array<{ date: string; stars: number }> {
  const series: Array<{ date: string; stars: number }> = [];
  for (const w of [...weeks].sort((a, b) => a.week_start.localeCompare(b.week_start))) {
    w.days.forEach((stars, i) => {
      const date = addDays(w.week_start, i);
      if (date <= asOf) series.push({ date, stars });
    });
  }
  return series;
}

/** Stars over the last seven observed days, and the per-day average; null without data. */
export function sevenDay(weeks: readonly StarWeek[], asOf: string): { stars7d: number; perDay: number } | null {
  // The fetch day is still in progress; the last seven *complete* days end the day before (review G1-cor12).
  const s = dailySeries(weeks, addDays(asOf, -1));
  if (s.length < 2) return null;
  const last = s.slice(-7);
  const total = last.reduce((a, d) => a + d.stars, 0);
  return { stars7d: total, perDay: total / last.length };
}

/** The biggest week on record, for "peak" in the landscape report. */
export function peakWeek(weeks: readonly StarWeek[]): StarWeek | null {
  let best: StarWeek | null = null;
  for (const w of weeks) if (!best || w.total > best.total) best = w;
  return best;
}
