import type { RepoView } from "../types.js";
import { isoNow } from "../util/dates.js";
import { fmtInt } from "../util/text.js";
import { categoryLabel, licenseLabel, repoLink, verdictBadge } from "./markdown.js";

/** The resource page for one repo: what it is, why it trended, how to use it, how it tested. */
export function resourcePage(v: RepoView, options: { generatedAt?: string; quickStart?: string | null; testLog?: string | null } = {}): string {
  const generatedAt = options.generatedAt ?? isoNow();
  const r = v.repo;
  const lines: string[] = [];
  lines.push(`# ${r.full_name}`);
  lines.push("");
  lines.push(`> ${r.summary ?? r.description ?? "No description."}`);
  lines.push("");
  lines.push(`| | |`);
  lines.push(`|---|---|`);
  lines.push(`| Repository | ${repoLink(r.full_name)} |`);
  lines.push(`| Category | ${categoryLabel(r.category)} |`);
  lines.push(`| Stars | ${fmtInt(r.stars)} (${fmtInt(r.forks)} forks) |`);
  lines.push(`| Language | ${r.language ?? "—"} |`);
  lines.push(`| Licence | ${licenseLabel(v)} |`);
  lines.push(`| Created | ${r.created_at?.slice(0, 10) ?? "—"} · last push ${r.pushed_at?.slice(0, 10) ?? "—"} |`);
  lines.push(`| Latest release | ${r.latest_release ?? "—"}${r.latest_release_at ? ` (${r.latest_release_at.slice(0, 10)})` : ""} |`);
  lines.push(`| Homepage | ${r.homepage ?? "—"} |`);
  lines.push(`| Kinly score | **${v.score.total}/100** — ${v.score.reasons.join(" · ")} |`);
  lines.push(`| Verdict | **${verdictBadge(v)}** |`);
  lines.push(`| Relevance | ${v.relevance}/100 |`);
  lines.push(`| Trending history | ${v.signals.distinct_days} day(s), ${v.signals.distinct_weeks} week(s); first ${v.signals.first_seen ?? "—"}, last ${v.signals.last_seen ?? "—"}; best day ${v.signals.peak_stars_period !== null ? `${fmtInt(v.signals.peak_stars_period)} stars` : "—"}${v.signals.peak_week_stars !== null ? `; best week ${fmtInt(v.signals.peak_week_stars)} stars` : ""}${v.signals.stars_7d !== null ? `; last 7 days ${fmtInt(v.signals.stars_7d)} stars` : ""} |`);
  if (r.topics.length) lines.push(`| Topics | ${r.topics.map((t) => `\`${t}\``).join(" ")} |`);
  lines.push("");
  lines.push(`## What it is`);
  lines.push("");
  lines.push(r.summary ?? r.description ?? "_No summary yet._");
  lines.push("");
  lines.push(`## Why it trended`);
  lines.push("");
  lines.push(
    v.signals.distinct_weeks >= 3
      ? `It returned to the trending lists across ${v.signals.distinct_weeks} distinct weeks between ${v.signals.first_seen} and ${v.signals.last_seen}, which puts it in the persistent tier rather than a one-day spike.`
      : v.signals.appearances > 0
        ? `It appeared on ${v.signals.appearances} trending list(s) between ${v.signals.first_seen} and ${v.signals.last_seen}${v.signals.peak_stars_period ? `, gaining up to ${fmtInt(v.signals.peak_stars_period)} stars in a single day` : ""}.`
        : "It has not appeared on a trending list in Kinly's window; it was added by hand or from your stars.",
  );
  lines.push("");
  lines.push(`## How Vantik Systems or FeetBit could use it`);
  lines.push("");
  lines.push(r.business_use ?? "_Not written yet. Rate the repo after a test and Kinly will draft this section._");
  lines.push("");
  lines.push(`## 15-minute quick start`);
  lines.push("");
  lines.push(
    options.quickStart ??
      `Run it in a throwaway container, never on a machine that holds credentials:\n\n\`\`\`bash\ndocker run --rm -it --name kinly-test node:24 bash        # or python:3.13 for a Python repo\ngit clone --depth 1 https://github.com/${r.full_name} && cd ${r.name}\nnpm install --ignore-scripts                              # pip install --no-deps -r requirements.txt\n# read any install/postinstall script before re-enabling it; then follow the README's quick start\n\`\`\`\n\nLook for a Docker image, a one-line installer or a hosted demo first; if none exists, budget more than 15 minutes.`,
  );
  lines.push("");
  lines.push(`## Licence note`);
  lines.push("");
  lines.push(
    r.license_class === "permissive"
      ? `${r.license_spdx ?? "Permissive"}: usable commercially, in client work and in products, with attribution.`
      : r.license_class === "weak-copyleft"
        ? `${r.license_spdx ?? "Weak copyleft"}: usable commercially; changes to the library itself must be shared under the same licence.`
        : r.license_class === "strong-copyleft"
          ? `${r.license_spdx ?? "Strong copyleft"}: fine to run internally; shipping it inside a product or a hosted service for clients carries share-alike obligations (AGPL covers network use). Check before building on it for a client.`
          : r.license_class === "source-available"
            ? `${r.license_spdx ?? "Source-available"}: **restricted**. Read the licence before any commercial use; "open" here does not mean open source.`
            : r.license_class === "none"
              ? "No licence file: by default all rights reserved. Do not use in client work without the author's permission."
              : "Licence unknown: check the repository before use.",
  );
  if (r.open_core) lines.push("\nOpen-core: an `ee/` or `enterprise/` tree exists. The free edition and the paid edition differ; confirm the feature you need is in the free one.");
  lines.push("");
  lines.push(`## Test log`);
  lines.push("");
  if (v.agent_rating) {
    lines.push(`Kinly agent${v.agent_rating.agent ? ` (${v.agent_rating.agent})` : ""}: **${v.agent_rating.rating}/5**, ${v.agent_rating.updated_at.slice(0, 10)}${v.agent_rating.notes ? ` — ${v.agent_rating.notes}` : ""}`);
    if (v.agent_rating.test_log) {
      lines.push("");
      lines.push("```text");
      lines.push(v.agent_rating.test_log.replace(/```/g, "ʼʼʼ"));
      lines.push("```");
    }
  } else if (!options.testLog) {
    lines.push("_Not tested yet._");
  }
  if (options.testLog) {
    lines.push("");
    lines.push(options.testLog);
  }
  lines.push("");
  lines.push(`## Owner rating`);
  lines.push("");
  if (v.rating) {
    lines.push(`**${"★".repeat(v.rating.rating)}${"☆".repeat(5 - v.rating.rating)}** tested ${v.rating.tested_at ?? "—"}${v.rating.verdict_override ? ` · verdict overridden to ${v.rating.verdict_override}` : ""}`);
    lines.push("");
    lines.push(v.rating.notes ?? "_No notes._");
  } else {
    lines.push("_Not rated yet. Only the owner's rating moves a repo to rated._");
  }
  if (v.shortlist) lines.push(`\n_Shortlist status: ${v.shortlist.status} (${v.shortlist.updated_at.slice(0, 10)})${v.shortlist.note ? ` — ${v.shortlist.note}` : ""}_`);
  lines.push("");
  lines.push(`---\n\n_Resource page generated by Project Kinly (Vantik Systems) at ${generatedAt}._`);
  return lines.join("\n");
}

export function resourceFileName(fullName: string): string {
  return `${fullName.replace("/", "--")}.md`;
}
