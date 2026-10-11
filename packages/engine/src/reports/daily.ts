import type { Store } from "../store/store.js";
import type { Profile } from "../types.js";
import { CATEGORY_LABELS } from "../classify/rules.js";
import { addDays, isoNow } from "../util/dates.js";
import { fmtInt } from "../util/text.js";
import { perCategory, rankedList, repoView, type RankedView } from "../views.js";
import { businessUse, categoryLabel, footer, h1, licenseLabel, oneLiner, pickBlock, rankedTable, repoLink, table, verdictBadge } from "./markdown.js";

export interface DailyReportOptions {
  date: string;
  topN?: number;
  picks?: number;
  perCategory?: number;
  generatedAt?: string;
  sources?: readonly string[];
}

/** The daily brief for one date. */
export function dailyReport(store: Store, profile: Profile | null, options: DailyReportOptions): string {
  const date = options.date;
  const topN = options.topN ?? 10;
  const picksN = options.picks ?? 5;
  const perCat = options.perCategory ?? 3;
  const generatedAt = options.generatedAt ?? isoNow();

  const today = rankedList(store, "today", profile, { date, limit: 60, candidates: 120 });
  const topToday = today.slice(0, topN);
  const picks = [...today]
    .filter((v) => v.relevance >= 40 && v.score.verdict !== "SKIP")
    .sort((a, b) => b.relevance * 0.6 + b.score.total * 0.4 - (a.relevance * 0.6 + a.score.total * 0.4))
    .slice(0, picksN);
  const repeaters = today.filter((v) => v.signals.distinct_days >= 3).sort((a, b) => b.signals.distinct_days - a.signals.distinct_days).slice(0, 10);
  const newcomers = today.filter((v) => v.signals.first_seen !== null && v.signals.first_seen >= addDays(date, -1)).slice(0, 10);
  const byCat = perCategory(today, perCat);
  const stars = today.filter((v) => v.starred);
  const nudges = store
    .listShortlist()
    .filter((s) => s.status === "testing" && s.updated_at < `${addDays(date, -14)}T00:00:00Z`)
    .slice(0, 10);

  const parts: string[] = [];
  parts.push(h1(`Kinly Daily — ${date}`, `What trended on GitHub today, what it is for, and which of it is worth your time. ${today.length} repositories on today's lists; ${picks.length} picks for Vantik Systems / FeetBit.`));

  parts.push(`## Top ${topToday.length} today\n`);
  parts.push(rankedTable(topToday, { metricHeader: "Today" }));

  parts.push(`\n## Picks for Vantik Systems and FeetBit\n`);
  if (picks.length === 0) parts.push("_Nothing on today's list clears the relevance bar (40/100). That is a valid answer; the firehose is not the product._\n");
  picks.forEach((v, i) => parts.push(pickBlock(v, i + 1)));

  parts.push(`\n## Repeat trenders (3+ days on the list)\n`);
  parts.push(
    table(
      ["Repository", "Days", "Weeks", "First seen", "Score", "Verdict"],
      repeaters.map((v) => [repoLink(v.repo.full_name), v.signals.distinct_days, v.signals.distinct_weeks, v.signals.first_seen, v.score.total, verdictBadge(v)]),
    ),
  );

  parts.push(`\n## New entrants (first seen today or yesterday)\n`);
  parts.push(
    table(
      ["Repository", "Today", "Stars", "Category", "Licence", "What it does"],
      newcomers.map((v) => [repoLink(v.repo.full_name), v.metric_label, fmtInt(v.repo.stars), categoryLabel(v.repo.category), licenseLabel(v), oneLiner(v, 100)]),
    ),
  );

  parts.push(`\n## By category\n`);
  for (const [cat, views] of [...byCat.entries()].sort((a, b) => b[1].length - a[1].length)) {
    parts.push(`### ${CATEGORY_LABELS[cat]}\n`);
    parts.push(
      table(
        ["Repository", "Today", "Score", "Verdict", "Use"],
        views.map((v) => [repoLink(v.repo.full_name), v.metric_label, v.score.total, verdictBadge(v), businessUse(v, 120)]),
      ),
    );
  }

  if (stars.length > 0) {
    parts.push(`\n## Your stars on today's list\n`);
    parts.push(table(["Repository", "Today", "Score"], stars.map((v) => [repoLink(v.repo.full_name), v.metric_label, v.score.total])));
  }

  if (nudges.length > 0) {
    parts.push(`\n## Shortlist nudges (in testing for 14+ days)\n`);
    parts.push(
      table(
        ["Repository", "Since", "Note"],
        nudges.map((s) => {
          const repo = store.getRepo(s.full_name);
          const v = repo ? repoView(store, repo, profile) : null;
          return [repoLink(s.full_name), s.updated_at.slice(0, 10), s.note ?? (v ? businessUse(v, 80) : "—")];
        }),
      ),
    );
  }

  parts.push(footer(generatedAt, options.sources ?? []));
  return parts.join("\n");
}

export type { RankedView };
