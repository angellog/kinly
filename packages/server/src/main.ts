import { createServer } from "node:http";
import { jobs, loadConfig, Store } from "@kinly/engine";
import { createApi } from "./api.js";
import { Scheduler } from "./scheduler.js";

/**
 * Railway entrypoint: open the store, rebuild it from the data repo when it
 * is empty (D2), start the scheduler (D12), serve the API (PLAN §3.8).
 */

const log = (m: string): void => console.log(`[kinly] ${new Date().toISOString()} ${m}`);

/** One job at a time across the scheduler and the API. */
function makeLock() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    const run = tail.then(
      () => {
        log(`lock: ${name}`);
        return fn();
      },
      () => fn(),
    );
    tail = run.catch(() => undefined);
    return run;
  };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const store = new Store(config.dbPath);
  const ctx = jobs.makeContext(store, config, { log });
  const lock = makeLock();
  log(`db ${config.dbPath} · data ${config.dataRoot} → ${config.dataRepo} · github ${ctx.github.authenticated ? `token (${config.githubTokenSource})` : "keyless"} · llm ${ctx.llm.available ? ctx.llm.model : "off"} · writes ${config.apiToken ? "on" : "off (no KINLY_API_TOKEN)"}`);

  const schedulerOff = process.env["KINLY_SCHEDULER"] === "off";
  const scheduler = new Scheduler({
    store,
    log,
    keyless: !ctx.github.authenticated,
    ...(process.env["KINLY_DAILY_CRON"] ? { dailyCron: process.env["KINLY_DAILY_CRON"] } : {}),
    ...(process.env["KINLY_WEEKLY_CRON"] ? { weeklyCron: process.env["KINLY_WEEKLY_CRON"] } : {}),
    jobs: {
      daily: (date) => lock("daily", () => jobs.runDaily(ctx, { date })),
      weekly: (date) => lock("weekly", () => jobs.runWeekly(ctx, { date })),
      enrichKeyless: () => lock("enrich-keyless", () => jobs.enrichPending(ctx, { limit: 20 })),
    },
  });

  const handler = createApi({ ctx, scheduler, runExclusive: lock, version: process.env["RAILWAY_GIT_COMMIT_SHA"]?.slice(0, 7) ?? "0.1.0" });
  const server = createServer((req, res) => void handler(req, res));
  server.requestTimeout = 120_000;
  server.listen(config.port, "0.0.0.0", () => log(`listening on :${config.port}`));

  // Listen first so the platform healthcheck passes; rebuild an empty store from the data repo in the background (D3),
  // and only then start the scheduler, so a catch-up run never races the import.
  void (async () => {
    if (store.stats().appearances === 0 && process.env["KINLY_BOOT_IMPORT"] !== "off") {
      try {
        const fetched = await jobs.fetchDataFromRepo(ctx);
        const imported = jobs.importData(ctx);
        log(`boot import: ${fetched.files} files fetched, ${imported.repos} repos, ${imported.snapshots} snapshot files, ${imported.appearances} appearances`);
        jobs.scoreAll(ctx, jobs.loadProfile(ctx));
      } catch (err) {
        log(`boot import failed (the scheduler will collect fresh data): ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (!schedulerOff) scheduler.start();
    else log("scheduler off (KINLY_SCHEDULER=off)");
  })();

  const shutdown = (signal: string): void => {
    log(`${signal}: shutting down`);
    scheduler.stop();
    server.close(() => {
      store.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
