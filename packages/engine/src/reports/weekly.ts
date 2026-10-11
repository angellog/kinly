import type { Store } from "../store/store.js";
import type { Profile } from "../types.js";
import { CATEGORY_LABELS } from "../classify/rules.js";
import { addDays, isoNow, isoWeek, weekStart } from "../util/dates.js";
import { fmtInt } from "../util/text.js";
import { perCategory, rankedList, repoView } from "../views.js";
import { businessUse, categoryLabel, footer, h1, licenseLabel, oneLiner, pickBlock, rankedTable, repoLink, table, verdictBadge } from "./markdown.js";

export interface WeeklyReportOptions {
  /** Any date inside the week; the report covers Monday..that date. */
  date: string;
  topN?: number;
  perCategory?: number;
  picks?: number;
  generatedAt?: string;
  sources?: readonly string[];
}

export function weeklyReport(store: Store, profile: Profile | null, options: WeeklyReportOptions): string {
  const date = options.date;
  const week = isoWeek(date);
  const from = weekStart(date);
  const topN = options.topN ?? 15;
  const perCat = options.perCategory ?? 5;
  const picksN = options.picks ?? 5;
  const generatedAt = options.generatedAt ?? isoNow();

  const weekList = rankedList(store, "week", profile, { date, limit: 120, candidates: 300 });
  const top = weekList.slice(0, topN);
  const byCat = perCategory(weekList, perCat);
  const rising = rankedList(store, "rising", profile, { date, limit: 10 });
  const persistent = rankedList(store, "persistent", profile, { date, limit: 15 });
  const picks = [...weekList]
    .filter((v) => v.score.verdict === "BUILD" || (v.score.verdict === "WATCH" && v.relevance >= 60))
    .filter((v) => !v.shortlist || v.shortlist.status === "discovered")
    .sort((a, b) => b.relevance * 0.6 + b.score.total * 0.4 - (a.relevance * 0.6 + a.score.total * 0.4))
    .slice(0, picksN);
  const resources = store.listResources().filter((r) => r.generated_at >= `${from}T00:00:00Z`);
  const ratings = store.listRatings().filter((r) => r.updated_at >= `${from}T00:00:00Z`);

  const parts: string[] = [];
  parts.push(h1(`Kinly Weekly — ${week}`, `Covers ${from} to ${date}. ${weekList.length} repositories touched the lists this week.`));

  parts.push(`## Top ${top.length} of the week\n`);
  parts.push(rankedTable(top, { metricHeader: "This week" }));

  parts.push(`\n## Add to a workspace this week\n`);
  if (picks.length === 0) parts.push("_No new BUILD-grade repos this week. Keep testing what is already on the shortlist._\n");
  picks.forEach((v, i) => {
    parts.push(pickBlock(v, i + 1));
    parts.push(`**15-minute test plan.** \`git clone https://github.com/${v.repo.full_name}\` into a scratch workspace, read the README's quick start, run the one-line install or the Docker image if there is one, and try it on a real artefact from the business (a carousel brief, an Instagram caption, a sneaker photo, a client question). Rate it 1–5 in Kinly and say in one line what it replaced or enabled.\n`);
  });

  parts.push(`\n## By category (top ${perCat})\n`);
  for (const [cat, views] of [...byCat.entries()].sort((a, b) => b[1].length - a[1].length)) {
    parts.push(`### ${CATEGORY_LABELS[cat]}\n`);
    parts.push(
      table(
        ["Repository", "This week", "Stars", "Licence", "Score", "Verdict", "Use"],
        views.map((v) => [repoLink(v.repo.full_name), v.metric_label, fmtInt(v.repo.stars), licenseLabel(v), v.score.total, verdictBadge(v), businessUse(v, 110)]),
      ),
    );
  }

  parts.push(`\n## Rising (fastest star growth, last 14 days)\n`);
  parts.push(
    table(
      ["Repository", "Velocity", "Stars", "Category", "What it does"],
      rising.map((v) => [repoLink(v.repo.full_name), v.metric_label, fmtInt(v.repo.stars), categoryLabel(v.repo.category), oneLiner(v, 100)]),
    ),
  );

  parts.push(`\n## Persistence leaderboard (most distinct weeks on trending, 18 months)\n`);
  parts.push(
    table(
      ["Repository", "Weeks", "Stars", "Category", "Score", "Verdict"],
      persistent.map((v) => [repoLink(v.repo.full_name), v.signals.distinct_weeks, fmtInt(v.repo.stars), categoryLabel(v.repo.category), v.score.total, verdictBadge(v)]),
    ),
  );

  parts.push(`\n## Resources and ratings this week\n`);
  if (resources.length === 0 && ratings.length === 0) parts.push("_No ratings or resource pages this week._\n");
  if (ratings.length > 0) {
    parts.push(
      table(
        ["Repository", "Rating", "Tested", "Notes"],
        ratings.map((r) => [repoLink(r.full_name), "★".repeat(r.rating), r.tested_at ?? "—", r.notes ?? "—"]),
      ),
    );
  }
  if (resources.length > 0) parts.push(resources.map((r) => `- ${repoLink(r.full_name)} → \`resources/${r.full_name.replace("/", "--")}.md\``).join("\n") + "\n");

  const shortlist = store.listShortlist().filter((s) => s.status !== "resourced");
  if (shortlist.length > 0) {
    parts.push(`\n## Shortlist state\n`);
    parts.push(
      table(
        ["Repository", "Status", "Updated", "Score"],
        shortlist.slice(0, 30).map((s) => {
          const repo = store.getRepo(s.full_name);
          const v = repo ? repoView(store, repo, profile) : null;
          return [repoLink(s.full_name), s.status, s.updated_at.slice(0, 10), v ? v.score.total : "—"];
        }),
      ),
    );
  }

  parts.push(footer(generatedAt, options.sources ?? []));
  return parts.join("\n");
}

export function weekIdFor(date: string): string {
  return isoWeek(date);
}

export { addDays };
