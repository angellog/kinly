import type { Store } from "../store/store.js";
import type { CategoryId, Profile } from "../types.js";
import { CATEGORY_IDS } from "../types.js";
import { CATEGORY_LABELS } from "../classify/rules.js";
import { isoNow } from "../util/dates.js";
import { fmtInt } from "../util/text.js";
import { rankedList, repoView } from "../views.js";
import { categoryLabel, footer, h1, licenseLabel, oneLiner, pickBlock, repoLink, table, verdictBadge } from "./markdown.js";

export interface LandscapeOptions {
  from: string;
  to: string;
  perMonth?: number;
  topAllTime?: number;
  perCategory?: number;
  generatedAt?: string;
  /** Optional narrative (e.g. from the research report) inserted after the intro. */
  narrative?: string;
}

/** The 18-month backfill report: month by month, category by category, all-time persistence. */
export function landscapeReport(store: Store, profile: Profile | null, options: LandscapeOptions): string {
  const perMonth = options.perMonth ?? 10;
  const topAllTime = options.topAllTime ?? 50;
  const perCat = options.perCategory ?? 10;
  const generatedAt = options.generatedAt ?? isoNow();
  const stats = store.stats();

  const parts: string[] = [];
  parts.push(h1(`Kinly Landscape — ${options.from} to ${options.to}`, `What trended on GitHub over ${options.from} → ${options.to}, from ${fmtInt(stats.appearances)} list appearances across ${fmtInt(stats.repos)} repositories, read month by month and category by category.`));
  parts.push(
    `> **Coverage.** ${options.from} → ${options.to}. Until 2026-10-08 the only daily record is the larsbijl trending archive, which keeps six per-language lists (Python, Go, Rust, C++, JavaScript, TypeScript) and no all-languages list; repositories that trended only under other languages are missing from those months. From 2026-10-08 Kinly also collects the live all-languages, weekly, monthly and ten per-language lists. Persistence counts distinct ISO weeks on any of these lists; star curves for the leaders come from GitHub's stargazers history.\n`,
  );
  if (options.narrative) parts.push(`${options.narrative.trim()}\n`);

  // All-time persistence
  const persistent = rankedList(store, "persistent", profile, { date: options.to, since: options.from, limit: topAllTime, candidates: topAllTime * 2 });
  parts.push(`## The ${persistent.length} repositories that kept trending\n`);
  parts.push("_Ranked by distinct weeks on any trending list in the window. Persistence is the strongest signal this data has: a repo that returns week after week has a reason._\n");
  parts.push(
    table(
      ["#", "Repository", "Weeks", "Stars", "Best week", "Category", "Licence", "Score", "Verdict", "What it does"],
      persistent.map((v) => [v.rank, repoLink(v.repo.full_name) + (v.starred ? " ⭐" : ""), v.signals.distinct_weeks, fmtInt(v.repo.stars), v.signals.peak_week_stars !== null ? `+${fmtInt(v.signals.peak_week_stars)}` : "—", categoryLabel(v.repo.category), licenseLabel(v), v.score.total, verdictBadge(v), oneLiner(v, 100)]),
    ),
  );

  // Picks across the window
  const picks = persistent.filter((v) => v.score.verdict === "BUILD" && !v.starred && !(v.shortlist && v.shortlist.status !== "discovered")).slice(0, 10);
  parts.push(`\n## Ten to test first\n`);
  parts.push("_BUILD-grade leaders you have not starred or shortlisted yet._\n");
  if (picks.length === 0) parts.push("_No BUILD-grade repositories yet; enrich and score first._\n");
  picks.forEach((v, i) => parts.push(pickBlock(v, i + 1)));

  // Month by month
  parts.push(`\n## Month by month\n`);
  const months = store.monthlyLeaders(options.from, options.to, perMonth);
  for (const [month, rows] of [...months.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    parts.push(`### ${month}\n`);
    const catCounts = new Map<CategoryId, number>();
    const tableRows: Array<(string | number | null)[]> = [];
    for (const r of rows) {
      const repo = store.getRepo(r.full_name);
      if (!repo) continue;
      catCounts.set(repo.category, (catCounts.get(repo.category) ?? 0) + 1);
      const v = repoView(store, repo, profile, options.from);
      tableRows.push([r.rank, repoLink(repo.full_name), r.metric, fmtInt(repo.stars), categoryLabel(repo.category), v.score.total, oneLiner(v, 90)]);
    }
    const wave = [...catCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c, n]) => `${CATEGORY_LABELS[c]} (${n})`).join(", ");
    if (wave) parts.push(`_Dominant: ${wave}._\n`);
    parts.push(table(["#", "Repository", "Days", "Stars", "Category", "Score", "What it does"], tableRows));
  }

  // Category leaderboards
  parts.push(`\n## By category (all-time, top ${perCat} by persistence)\n`);
  const allPersistent = rankedList(store, "persistent", profile, { date: options.to, since: options.from, limit: 1000, candidates: 1500 });
  for (const cat of CATEGORY_IDS) {
    const views = allPersistent.filter((v) => v.repo.category === cat).slice(0, perCat);
    if (views.length === 0) continue;
    parts.push(`### ${CATEGORY_LABELS[cat]}\n`);
    parts.push(
      table(
        ["Repository", "Weeks", "Stars", "Licence", "Score", "Verdict", "What it does"],
        views.map((v) => [repoLink(v.repo.full_name), v.signals.distinct_weeks, fmtInt(v.repo.stars), licenseLabel(v), v.score.total, verdictBadge(v), oneLiner(v, 90)]),
      ),
    );
  }

  // Category share
  parts.push(`\n## Category share of the window\n`);
  const counts = store.categoryCounts();
  parts.push(table(["Category", "Repos", "BUILD verdicts"], counts.map((c) => [CATEGORY_LABELS[c.category] ?? c.category, c.count, c.build])));

  parts.push(footer(generatedAt, ["larsbijl-archive", "trending-page", "gh-search-new"]));
  return parts.join("\n");
}
