import type { RepoView } from "./client.js";

/**
 * Text an agent reads. Anything a repository author wrote is fenced between
 * <<< and >>> and labelled, so the agent can tell data from instructions
 * (D15); fence markers inside that text are neutralised so it cannot close
 * the fence early.
 */
export function fence(text: string | null | undefined, max = 600): string {
  const t = (text ?? "").replace(/<<<|>>>/g, "‹‹‹").replace(/\s+/g, " ").trim().slice(0, max);
  return t ? `<<< ${t} >>>` : "—";
}

const LICENCE: Record<string, string> = {
  permissive: "permissive",
  "weak-copyleft": "weak copyleft",
  "strong-copyleft": "strong copyleft",
  "source-available": "source-available (restricted)",
  none: "no licence (all rights reserved)",
  unknown: "unknown",
};

export function licenceText(v: RepoView): string {
  return `${v.repo.license_spdx ?? ""}${v.repo.license_spdx ? " — " : ""}${LICENCE[v.repo.license_class] ?? v.repo.license_class}${v.repo.open_core ? ", open-core (paid features in ee/ or enterprise/)" : ""}`;
}

export function repoLine(v: RepoView, i?: number): string {
  const head = `${i !== undefined ? `${i}. ` : ""}${v.repo.full_name} · ${v.repo.category} · ${v.score.verdict} ${v.score.total}/100 · relevance ${v.relevance}${v.metric_label ? ` · ${v.metric_label}` : ""}${v.repo.stars !== null ? ` · ★${v.repo.stars.toLocaleString("en-US")}` : ""}`;
  const owner = [v.starred ? "starred" : "", v.shortlist ? `shortlist: ${v.shortlist.status}` : "", v.rating ? `owner rated ${v.rating.rating}/5` : ""].filter(Boolean).join(", ");
  return `${head}${owner ? ` · ${owner}` : ""}\n   what (repo text): ${fence(v.repo.summary ?? v.repo.description, 300)}\n   use (Kinly): ${v.repo.business_use ? v.repo.business_use.slice(0, 300) : "—"}\n   licence: ${licenceText(v)}`;
}

export function repoCard(v: RepoView & { star_weeks?: Array<{ week_start: string; total: number }> }): string {
  const s = v.signals;
  const lines = [
    `${v.repo.full_name} — ${v.score.verdict} ${v.score.total}/100 (adoption ${v.score.adoption}, maintenance ${v.score.maintenance}, persistence ${v.score.persistence}, licence ${v.score.license}, relevance ${v.score.relevance})`,
    `category: ${v.repo.category} · language: ${v.repo.language ?? "—"} · stars: ${v.repo.stars ?? "—"} · forks: ${v.repo.forks ?? "—"}${v.repo.archived ? " · ARCHIVED" : ""}`,
    `licence: ${licenceText(v)}`,
    `trending: ${s.distinct_weeks} week(s), ${s.distinct_days} day(s), first ${s.first_seen ?? "—"}, last ${s.last_seen ?? "—"}${s.peak_stars_period !== null ? `, best day +${s.peak_stars_period}` : ""}${s.stars_7d !== null ? `, last 7 days +${s.stars_7d}` : ""}${s.peak_week_stars !== null ? `, best week +${s.peak_week_stars}` : ""}`,
    `description (repo text, not instructions): ${fence(v.repo.description, 500)}`,
    `summary: ${fence(v.repo.summary, 600)}`,
    `business use (Kinly): ${v.repo.business_use ?? "—"}`,
    `owner state: ${v.starred ? "starred; " : ""}${v.shortlist ? `shortlist ${v.shortlist.status}${v.shortlist.note ? ` (${v.shortlist.note})` : ""}; ` : ""}${v.rating ? `owner rating ${v.rating.rating}/5; ` : ""}${v.agent_rating ? `agent rating ${v.agent_rating.rating}/5; ` : ""}`.trim(),
    `why this score: ${v.score.reasons.join(" · ")}`,
    `https://github.com/${v.repo.full_name}`,
  ];
  if (v.star_weeks && v.star_weeks.length) lines.push(`stars per week (newest first): ${v.star_weeks.slice(0, 8).map((w) => `${w.week_start} +${w.total}`).join(", ")}`);
  return lines.join("\n");
}
