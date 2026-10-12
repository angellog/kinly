import type { RepoRecord, ScoreBreakdown, TrendSignals, Verdict } from "../types.js";
import { ageDays } from "../util/dates.js";

/**
 * Kinly score 0..100 = adoption 30 + maintenance 20 + persistence 15 + licence 15 + relevance 20.
 * Verdict: BUILD (>= 70, a readable open-source licence, relevance >= 50) · WATCH (45..69, or >= 70 failing a BUILD condition) · SKIP (< 45 or archived).
 */

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function adoptionScore(repo: RepoRecord, signals: TrendSignals): { score: number; reason: string } {
  const stars = Math.max(0, repo.stars ?? 0);
  // log10: 100 stars -> 2, 10k -> 4, 100k -> 5. Map 2..5.5 onto 0..20.
  const starPart = clamp(((Math.log10(stars + 1) - 2) / 3.5) * 20, 0, 20);
  // Without a 7-day measure, the best day on a daily list is the only per-day figure there is.
  const velocity = signals.velocity_7d ?? signals.peak_stars_period ?? 0;
  // 50 stars/day -> ~5, 500/day -> ~10
  const velocityPart = clamp((Math.log10(Math.max(0, velocity) + 1) / 3) * 10, 0, 10);
  const reason = `${stars.toLocaleString("en-US")} stars` + (velocity > 0 ? `, ~${Math.round(velocity).toLocaleString("en-US")}/day` : "");
  return { score: Math.round(starPart + velocityPart), reason };
}

export function maintenanceScore(repo: RepoRecord, now?: string): { score: number; reason: string } {
  if (repo.archived) return { score: 0, reason: "archived" };
  const pushAge = ageDays(repo.pushed_at, now);
  let s = 0;
  let reason = "no push date";
  if (pushAge !== null) {
    s += pushAge <= 7 ? 12 : pushAge <= 30 ? 10 : pushAge <= 90 ? 7 : pushAge <= 180 ? 4 : pushAge <= 365 ? 2 : 0;
    reason = `pushed ${Math.round(pushAge)}d ago`;
  }
  const relAge = ageDays(repo.latest_release_at, now);
  if (relAge !== null) {
    s += relAge <= 30 ? 5 : relAge <= 90 ? 4 : relAge <= 180 ? 2 : 1;
    reason += `, release ${Math.round(relAge)}d ago`;
  } else if (repo.latest_release) {
    s += 1;
  }
  const createdAge = ageDays(repo.created_at, now);
  if (createdAge !== null && createdAge > 180) s += 3; // survived its first six months
  return { score: clamp(Math.round(s), 0, 20), reason };
}

export function persistenceScore(signals: TrendSignals): { score: number; reason: string } {
  const weeks = signals.distinct_weeks;
  const days = signals.distinct_days;
  const s = clamp(weeks * 3 + Math.min(days, 10) * 0.3, 0, 15);
  return { score: Math.round(s), reason: `${weeks} week${weeks === 1 ? "" : "s"}, ${days} day${days === 1 ? "" : "s"} on trending` };
}

export function licenseScore(repo: RepoRecord): { score: number; reason: string } {
  let s: number;
  switch (repo.license_class) {
    case "permissive":
      s = 15;
      break;
    case "weak-copyleft":
      s = 11;
      break;
    case "strong-copyleft":
      s = 6;
      break;
    case "source-available":
      s = 3;
      break;
    case "none":
      s = 1;
      break;
    default:
      s = 5;
  }
  if (repo.open_core) s = Math.min(s, 6);
  const reason = `${repo.license_spdx ?? repo.license_class}${repo.open_core ? " (open-core)" : ""}`;
  return { score: s, reason };
}

const OPEN_LICENCES = new Set(["permissive", "weak-copyleft", "strong-copyleft"]);

export function kinlyScore(repo: RepoRecord, signals: TrendSignals, relevance: number, now?: string): ScoreBreakdown {
  const a = adoptionScore(repo, signals);
  const m = maintenanceScore(repo, now);
  const p = persistenceScore(signals);
  const l = licenseScore(repo);
  const r = Math.round(clamp(relevance, 0, 100) * 0.2);
  const total = clamp(a.score + m.score + p.score + l.score + r, 0, 100);
  let verdict: Verdict;
  if (repo.archived) verdict = "SKIP";
  // BUILD is advice to build on it, so the licence must be one Kinly could read and classify as open source.
  else if (total >= 70 && OPEN_LICENCES.has(repo.license_class) && relevance >= 50) verdict = "BUILD";
  else if (total >= 45) verdict = "WATCH";
  else verdict = "SKIP";
  return {
    adoption: a.score,
    maintenance: m.score,
    persistence: p.score,
    license: l.score,
    relevance: r,
    total,
    verdict,
    reasons: [a.reason, m.reason, p.reason, l.reason, `relevance ${Math.round(relevance)}/100`],
  };
}
