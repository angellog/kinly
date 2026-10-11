import { dates, type Store } from "@kinly/engine";
import { cronMatches, lastFire, parseCron, type CronSpec } from "./cron.js";

/**
 * The in-process scheduler (D12). One tick a minute (the timer runs every
 * 20 s and de-duplicates by minute):
 *
 * - `daily` fires on its cron, or as **catch-up** whenever today's scheduled
 *   time has passed and `meta.last_daily_ok` is not today — so a restart,
 *   a redeploy or a failed run is retried, at most once an hour.
 * - `weekly` fires on its cron, or as catch-up when this ISO week has no
 *   weekly report yet and its scheduled time has passed.
 * - `enrichKeyless` runs hourly while there is no GitHub token, spreading
 *   enrichment over the day inside the 60 req/h budget.
 *
 * Jobs never overlap. Every decision is a pure function of (now, meta), so
 * the catch-up is tested with an injected clock.
 */

export interface SchedulerJobs {
  daily: (date: string) => Promise<unknown>;
  weekly: (date: string) => Promise<unknown>;
  enrichKeyless?: () => Promise<unknown>;
}

export interface SchedulerOptions {
  store: Store;
  jobs: SchedulerJobs;
  dailyCron?: string;
  weeklyCron?: string;
  keyless?: boolean;
  log?: (m: string) => void;
  now?: () => Date;
  /** Minimum gap between two catch-up attempts of the same job (default 60 min). */
  retryGapMs?: number;
}

export class Scheduler {
  readonly daily: CronSpec;
  readonly weekly: CronSpec;
  private readonly store: Store;
  private readonly jobs: SchedulerJobs;
  private readonly keyless: boolean;
  private readonly log: (m: string) => void;
  private readonly now: () => Date;
  private readonly retryGapMs: number;
  private busy: string | null = null;
  private lastMinute = "";
  private timer: NodeJS.Timeout | null = null;

  constructor(options: SchedulerOptions) {
    this.store = options.store;
    this.jobs = options.jobs;
    this.daily = parseCron(options.dailyCron ?? "40 5 * * *");
    this.weekly = parseCron(options.weeklyCron ?? "40 6 * * 1");
    this.keyless = options.keyless ?? false;
    this.log = options.log ?? (() => undefined);
    this.now = options.now ?? (() => new Date());
    this.retryGapMs = options.retryGapMs ?? 60 * 60_000;
  }

  get running(): string | null {
    return this.busy;
  }

  /** What the scheduler would run at `at`, without running it. */
  due(at: Date): Array<"daily" | "weekly" | "enrichKeyless"> {
    const out: Array<"daily" | "weekly" | "enrichKeyless"> = [];
    const today = dates.isoDate(at);
    const lastDailyOk = this.store.getMeta("last_daily_ok");
    const dailyFire = lastFire(this.daily, at, 2);
    const dailyMissed = lastDailyOk !== today && dailyFire !== null && dates.isoDate(dailyFire) === today;
    if (cronMatches(this.daily, at) || (dailyMissed && this.gapOk("daily", at))) out.push("daily");
    const week = dates.isoWeek(today);
    const weeklyFire = lastFire(this.weekly, at, 8);
    const weeklyMissed = this.store.getMeta("last_weekly_ok") !== week && weeklyFire !== null && dates.isoWeek(dates.isoDate(weeklyFire)) === week;
    // The Monday daily run writes the weekly report itself; only chase it once the daily is done.
    if (!out.includes("daily") && (cronMatches(this.weekly, at) || (weeklyMissed && lastDailyOk === today && this.gapOk("weekly", at)))) out.push("weekly");
    if (this.keyless && this.jobs.enrichKeyless && at.getUTCMinutes() === 17 && out.length === 0) out.push("enrichKeyless");
    return out;
  }

  private gapOk(job: string, at: Date): boolean {
    const last = this.store.getMeta(`last_${job}_attempt`);
    return !last || at.getTime() - Date.parse(last) >= this.retryGapMs;
  }

  /** Run whatever is due now. Returns the jobs it ran. */
  async tick(at: Date = this.now()): Promise<string[]> {
    const minute = at.toISOString().slice(0, 16);
    if (minute === this.lastMinute || this.busy) return [];
    this.lastMinute = minute;
    const ran: string[] = [];
    for (const job of this.due(at)) {
      this.busy = job;
      this.store.setMeta(`last_${job}_attempt`, at.toISOString());
      const date = dates.isoDate(at);
      try {
        this.log(`scheduler: ${job} start (${date})`);
        if (job === "daily") await this.jobs.daily(date);
        else if (job === "weekly") await this.jobs.weekly(date);
        else await this.jobs.enrichKeyless?.();
        this.log(`scheduler: ${job} done`);
      } catch (err) {
        this.log(`scheduler: ${job} failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        this.busy = null;
      }
      ran.push(job);
    }
    return ran;
  }

  start(intervalMs = 20_000): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  status(at: Date = this.now()): Record<string, unknown> {
    return {
      running: this.busy,
      daily_cron: this.daily.source,
      weekly_cron: this.weekly.source,
      last_daily_ok: this.store.getMeta("last_daily_ok"),
      last_weekly_ok: this.store.getMeta("last_weekly_ok"),
      last_daily_attempt: this.store.getMeta("last_daily_attempt"),
      due_now: this.due(at),
    };
  }
}
