import type { RepoView } from "../types.js";
import { CATEGORY_LABELS } from "../classify/rules.js";
import { LICENSE_CLASS_LABEL } from "../github/license.js";
import { cell, escapeMarkdown, fmtInt, truncate } from "../util/text.js";

/** Shared markdown helpers for every report. Deterministic: no timestamps except the ones passed in. */

export function table(headers: readonly string[], rows: readonly (readonly (string | number | null | undefined)[])[]): string {
  if (rows.length === 0) return "_Nothing to show._\n";
  const head = `| ${headers.map(cell).join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => `| ${r.map(cell).join(" | ")} |`).join("\n");
  return `${head}\n${sep}\n${body}\n`;
}

export function repoLink(fullName: string): string {
  return `[${fullName}](https://github.com/${fullName})`;
}

export function verdictBadge(v: RepoView): string {
  const override = v.rating?.verdict_override;
  const verdict = override ?? v.score.verdict;
  const stars = v.rating ? ` · ${"★".repeat(v.rating.rating)}${"☆".repeat(5 - v.rating.rating)}` : "";
  return `${verdict}${override ? " (owner)" : ""}${stars}`;
}

export function licenseLabel(v: RepoView): string {
  const base = v.repo.license_spdx ?? LICENSE_CLASS_LABEL[v.repo.license_class];
  return v.repo.open_core ? `${base} · open-core` : base;
}

export function categoryLabel(id: RepoView["repo"]["category"]): string {
  return CATEGORY_LABELS[id] ?? id;
}

/** Third-party (or model-written) text, shown as text: truncated, then markdown-escaped. */
export function plain(text: string | null | undefined, max = 600): string {
  const t = truncate(text ?? "", max);
  return t ? escapeMarkdown(t) : "";
}

export function oneLiner(v: RepoView, max = 140): string {
  return plain(v.repo.summary ?? v.repo.description, max) || "—";
}

export function businessUse(v: RepoView, max = 220): string {
  return plain(v.repo.business_use, max) || "—";
}

/** The standard ranked table used by every list. */
export function rankedTable(views: readonly (RepoView & { rank: number; metric_label: string })[], options: { metricHeader?: string } = {}): string {
  return table(
    ["#", "Repository", options.metricHeader ?? "Signal", "Stars", "Category", "Licence", "Score", "Verdict", "What it does"],
    views.map((v) => [
      v.rank,
      repoLink(v.repo.full_name) + (v.starred ? " ⭐" : ""),
      v.metric_label,
      fmtInt(v.repo.stars),
      categoryLabel(v.repo.category),
      licenseLabel(v),
      `${v.score.total}`,
      verdictBadge(v),
      oneLiner(v, 110),
    ]),
  );
}

/** A "pick" block: the full story for one repo, used in Picks sections. */
export function pickBlock(v: RepoView & { rank?: number; metric_label?: string }, index: number): string {
  const lines: string[] = [];
  lines.push(`### ${index}. ${repoLink(v.repo.full_name)}${v.starred ? " ⭐ (you starred it)" : ""}`);
  lines.push("");
  lines.push(`**${categoryLabel(v.repo.category)}** · ${fmtInt(v.repo.stars)} stars · ${licenseLabel(v)} · Kinly score **${v.score.total}** · verdict **${verdictBadge(v)}** · relevance ${v.relevance}/100${v.metric_label ? ` · ${v.metric_label}` : ""}`);
  lines.push("");
  lines.push(`**What it does.** ${plain(v.repo.summary ?? v.repo.description, 600) || "No description yet."}`);
  lines.push("");
  lines.push(`**How you could use it.** ${plain(v.repo.business_use, 800) || "Not written yet — rate it after a test and Kinly will draft the resource page."}`);
  lines.push("");
  lines.push(`**Why it scores this way.** ${v.score.reasons.join(" · ")}`);
  if (v.signals.first_seen) lines.push(`\n_Trending history: first seen ${v.signals.first_seen}, last seen ${v.signals.last_seen}, ${v.signals.distinct_days} day(s) across ${v.signals.distinct_weeks} week(s)._`);
  lines.push("");
  return lines.join("\n");
}

export function h1(title: string, subtitle?: string): string {
  return `# ${title}\n${subtitle ? `\n${subtitle}\n` : ""}`;
}

/** What a report knows about the run that produced it (D4, review E-B1 / R8). */
export interface RunHealth {
  /** Credential state per service: present · absent · rejected. */
  credentials?: Record<string, string>;
  /** Lists that were identical to the previous day's and earned no credit. */
  stalled?: readonly string[];
}

/** One line on coverage, and a visible banner when under half of the listed repos are enriched. */
export function coverageNote(views: readonly RepoView[]): string {
  const listed = views.length;
  const enriched = views.filter((v) => v.repo.enriched_at !== null).length;
  if (listed === 0) return "";
  const line = `_Coverage: enriched ${enriched} of ${listed} listed repositories._`;
  if (enriched / listed >= 0.5) return `${line}\n`;
  return `> **Degraded run.** Only ${enriched} of ${listed} listed repositories have GitHub metadata, so stars, licences and verdicts are missing for the rest. This is what a run without a GitHub token looks like; it is not a quiet day.\n\n${line}\n`;
}

export function footer(generatedAt: string, sources: readonly string[], health: RunHealth = {}): string {
  const creds = health.credentials ? Object.entries(health.credentials).map(([k, v]) => `${k} ${v}`).join(", ") : "";
  const stalled = health.stalled && health.stalled.length ? ` Stalled lists (identical to the previous day, no credit given): ${health.stalled.join(", ")}.` : "";
  return `\n---\n\n_Generated by Project Kinly (Vantik Systems) at ${generatedAt}. Sources this run: ${sources.join(", ") || "none"}.${creds ? ` Credentials: ${creds}.` : ""}${stalled} Scores are heuristics, not endorsements; licences are read from GitHub and must be checked before commercial use. Repository descriptions are quoted from their owners for identification._\n`;
}
