#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { loadConfig } from "./config.js";
import * as jobs from "./jobs.js";
import { Store } from "./store/store.js";
import { CATEGORY_IDS, LIST_KINDS, SHORTLIST_STATUSES, type CategoryId, type ListKind, type ShortlistStatus, type Verdict } from "./types.js";
import { addDays, isIsoDate, isoDate } from "./util/dates.js";
import { isFullName } from "./util/text.js";
import { rankedList, repoView } from "./views.js";

/**
 * kinly — the command line.
 *
 *   kinly collect [--date D]                 fetch today's trending lists (+ search) into the store and data/snapshots
 *   kinly backfill --from D [--to D] [--vitalets]   18-month archive backfill
 *   kinly import                             ingest data/ (snapshots, repo shards, owner state) into the store
 *   kinly export                             write data/repos/*.json, data/user/*.json, data/index.json, data/manifest.json
 *   kinly stars [--file]                     sync the owner's stars and rebuild the profile
 *   kinly enrich [--limit N] [--stale-days N] [--names a/b,c/d]
 *   kinly star-history [--names a/b,c/d | --top N] [--weeks W]   stargazers history (default: top 50 persistent, 78 weeks)
 *   kinly classify [--all]
 *   kinly summarize [--limit N] [--since D] [--heuristic]
 *   kinly import-summaries FILE              load curated { full_name, summary, business_use, category? } entries
 *   kinly score
 *   kinly report daily|weekly|landscape [--date D] [--from D --to D] [--narrative FILE]
 *   kinly daily [--no-publish] [--weekly]    the whole unattended pipeline
 *   kinly list today|week|month|persistent|rising|new [--category C] [--limit N] [--min-relevance N]
 *   kinly show owner/repo
 *   kinly shortlist owner/repo <status> [--note "..."]
 *   kinly rate owner/repo <1-5> [--notes "..."] [--verdict BUILD|WATCH|SKIP]
 *   kinly resource owner/repo [--test-log FILE]
 *   kinly publish [--message "..."] [--use-gh-token]   push data/, reports/, resources/ to KINLY_DATA_REPO (needs GITHUB_TOKEN;
 *                                            --use-gh-token allows the owner's gh login for an attended run)
 *   kinly status
 */

interface Args {
  cmd: string;
  positional: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): Args {
  const [cmd = "help", ...rest] = argv;
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i] ?? "";
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = rest[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else flags[key] = true;
    } else positional.push(a);
  }
  return { cmd, positional, flags };
}

function flagStr(flags: Args["flags"], key: string): string | undefined {
  const v = flags[key];
  return typeof v === "string" ? v : undefined;
}

function flagInt(flags: Args["flags"], key: string): number | undefined {
  const v = flagStr(flags, key);
  if (v === undefined) return undefined;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : undefined;
}

function dateFlag(flags: Args["flags"], key: string, fallback?: string): string {
  const v = flagStr(flags, key) ?? fallback ?? isoDate();
  if (!isIsoDate(v)) throw new Error(`--${key} must be YYYY-MM-DD`);
  return v;
}

function print(obj: unknown): void {
  console.log(JSON.stringify(obj, null, 2));
}

async function main(argv: string[]): Promise<number> {
  const { cmd, positional, flags } = parseArgs(argv);
  if (cmd === "help" || cmd === "--help" || cmd === "-h") {
    console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").filter((l) => l.startsWith(" *")).map((l) => l.replace(/^ \*\s?/, "")).join("\n"));
    return 0;
  }
  const config = loadConfig();
  const store = new Store(config.dbPath);
  const ctx = jobs.makeContext(store, config);
  try {
    switch (cmd) {
      case "status": {
        print({
          db: config.dbPath,
          dataRoot: config.dataRoot,
          dataRepo: config.dataRepo,
          github: ctx.github.authenticated ? `token (${config.githubTokenSource})` : "keyless",
          llm: ctx.llm.available ? ctx.llm.model : "unavailable",
          llmTokensToday: ctx.llm.tokensUsedToday(),
          stats: store.stats(),
          recentRuns: store.recentRuns(8),
        });
        return 0;
      }
      case "collect": {
        print(await jobs.collectLive(ctx, { date: dateFlag(flags, "date"), search: flags["no-search"] !== true }));
        return 0;
      }
      case "backfill": {
        const from = dateFlag(flags, "from", addDays(isoDate(), -548));
        const to = dateFlag(flags, "to");
        print(await jobs.backfill(ctx, { from, to, refetch: flags["refetch"] === true, vitalets: flags["vitalets"] === true }));
        return 0;
      }
      case "import": {
        print(jobs.importData(ctx));
        return 0;
      }
      case "export": {
        print({ ...jobs.exportData(ctx), manifest: jobs.writeDataManifest(ctx) });
        return 0;
      }
      case "stars": {
        print(await jobs.syncStars(ctx, { fromFile: flags["file"] === true }));
        return 0;
      }
      case "enrich": {
        const names = flagStr(flags, "names")?.split(",").map((s) => s.trim()).filter(isFullName);
        print(await jobs.enrichPending(ctx, { ...(flagInt(flags, "limit") !== undefined ? { limit: flagInt(flags, "limit") as number } : {}), ...(flagInt(flags, "stale-days") !== undefined ? { staleDays: flagInt(flags, "stale-days") as number } : {}), ...(names && names.length ? { names } : {}) }));
        return 0;
      }
      case "star-history": {
        // --names a/b,c/d  or  --top N (persistent leaders over the backfill window)  [--weeks W]
        const weeks = flagInt(flags, "weeks") ?? 78;
        let names = flagStr(flags, "names")?.split(",").map((s) => s.trim()).filter(isFullName) ?? [];
        if (names.length === 0) names = store.list("persistent", { limit: flagInt(flags, "top") ?? 50, since: dateFlag(flags, "since", addDays(isoDate(), -548)) }).map((r) => r.full_name);
        print(await jobs.fetchStarHistories(ctx, names, { weeks, maxAgeHours: flagInt(flags, "max-age-hours") ?? 20 }));
        return 0;
      }
      case "classify": {
        print(jobs.classifyAll(ctx, { onlyUnclassified: flags["all"] !== true }));
        return 0;
      }
      case "summarize": {
        const profile = jobs.loadProfile(ctx);
        print(await jobs.summarizePending(ctx, profile, { ...(flagInt(flags, "limit") !== undefined ? { limit: flagInt(flags, "limit") as number } : {}), ...(flagStr(flags, "since") ? { since: dateFlag(flags, "since") } : {}), heuristicOnly: flags["heuristic"] === true }));
        return 0;
      }
      case "import-summaries": {
        const file = positional[0] ?? flagStr(flags, "file");
        if (!file) throw new Error("import-summaries needs a JSON file");
        print(jobs.importSummaries(ctx, JSON.parse(readFileSync(file, "utf8"))));
        return 0;
      }
      case "score": {
        print(jobs.scoreAll(ctx, jobs.loadProfile(ctx)));
        return 0;
      }
      case "report": {
        const kind = positional[0];
        const profile = jobs.loadProfile(ctx);
        if (kind === "daily") print(jobs.writeDaily(ctx, profile, dateFlag(flags, "date", store.latestListDate("daily") ?? isoDate())));
        else if (kind === "weekly") print(jobs.writeWeekly(ctx, profile, dateFlag(flags, "date", store.latestListDate("daily") ?? isoDate())));
        else if (kind === "landscape") {
          const narrativeFile = flagStr(flags, "narrative");
          const narrative = narrativeFile ? readFileSync(narrativeFile, "utf8") : undefined;
          print(jobs.writeLandscape(ctx, profile, dateFlag(flags, "from", addDays(isoDate(), -548)), dateFlag(flags, "to"), narrative));
        } else throw new Error("report kind must be daily | weekly | landscape");
        return 0;
      }
      case "daily": {
        print(await jobs.runDaily(ctx, { date: dateFlag(flags, "date"), publish: flags["no-publish"] !== true, ...(flags["weekly"] === true ? { weekly: true } : {}) }));
        return 0;
      }
      case "list": {
        const kind = (positional[0] ?? "today") as ListKind;
        if (!LIST_KINDS.includes(kind)) throw new Error(`list kind must be one of ${LIST_KINDS.join(", ")}`);
        const category = flagStr(flags, "category") as CategoryId | undefined;
        if (category && !(CATEGORY_IDS as readonly string[]).includes(category)) throw new Error(`unknown category ${category}`);
        const profile = jobs.loadProfile(ctx);
        const views = rankedList(store, kind, profile, {
          limit: flagInt(flags, "limit") ?? 15,
          ...(category ? { category } : {}),
          ...(flagInt(flags, "min-relevance") !== undefined ? { min_relevance: flagInt(flags, "min-relevance") as number } : {}),
          ...(flagStr(flags, "date") ? { date: dateFlag(flags, "date") } : {}),
        });
        for (const v of views) {
          console.log(`${String(v.rank).padStart(2)}. ${v.repo.full_name.padEnd(42)} ${v.metric_label.padEnd(28)} ★${String(v.repo.stars ?? "?").padStart(7)}  ${v.repo.category.padEnd(20)} score ${String(v.score.total).padStart(3)} ${v.score.verdict.padEnd(5)} rel ${String(v.relevance).padStart(3)}  ${(v.repo.summary ?? v.repo.description ?? "").slice(0, 70)}`);
        }
        return 0;
      }
      case "show": {
        const name = positional[0] ?? "";
        if (!isFullName(name)) throw new Error("show needs owner/repo");
        const repo = store.getRepo(name);
        if (!repo) throw new Error(`unknown repo ${name}`);
        print({ ...repoView(store, repo, jobs.loadProfile(ctx)), appearances: store.appearancesFor(name, 30), star_history: store.starHistory(name, 30) });
        return 0;
      }
      case "shortlist": {
        const name = positional[0] ?? "";
        const status = (positional[1] ?? "shortlisted") as ShortlistStatus;
        if (!isFullName(name)) throw new Error("shortlist needs owner/repo");
        if (!SHORTLIST_STATUSES.includes(status)) throw new Error(`status must be one of ${SHORTLIST_STATUSES.join(", ")}`);
        print(store.setShortlist(name, status, flagStr(flags, "note") ?? null));
        return 0;
      }
      case "rate": {
        const name = positional[0] ?? "";
        const rating = Number.parseInt(positional[1] ?? "", 10);
        if (!isFullName(name)) throw new Error("rate needs owner/repo");
        const verdict = flagStr(flags, "verdict") as Verdict | undefined;
        print(store.setRating(name, { rating, notes: flagStr(flags, "notes") ?? null, verdict_override: verdict ?? null }));
        return 0;
      }
      case "resource": {
        const name = positional[0] ?? "";
        if (!isFullName(name)) throw new Error("resource needs owner/repo");
        const testLogFile = flagStr(flags, "test-log");
        const res = jobs.writeResource(ctx, jobs.loadProfile(ctx), name, { testLog: testLogFile ? readFileSync(testLogFile, "utf8") : null });
        console.log(res.file);
        return 0;
      }
      case "publish": {
        print(await jobs.publishToRepo(ctx, { allowGhToken: flags["use-gh-token"] === true, ...(flagStr(flags, "message") ? { message: flagStr(flags, "message") as string } : {}) }));
        return 0;
      }
      default:
        console.error(`unknown command: ${cmd}`);
        return 2;
    }
  } finally {
    store.close();
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  },
);
