import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Store } from "@kinly/engine";
import { Scheduler } from "../src/scheduler.js";

function setup(options: { failDaily?: boolean; keyless?: boolean } = {}) {
  const store = new Store(":memory:");
  const ran: string[] = [];
  const scheduler = new Scheduler({
    store,
    keyless: options.keyless ?? false,
    jobs: {
      daily: async (date) => {
        ran.push(`daily:${date}`);
        if (options.failDaily) throw new Error("collect failed");
        store.setMeta("last_daily_ok", date);
        if (new Date(`${date}T00:00:00Z`).getUTCDay() === 1) store.setMeta("last_weekly_ok", "2026-W42");
      },
      weekly: async () => {
        ran.push("weekly");
        store.setMeta("last_weekly_ok", "2026-W42");
      },
      enrichKeyless: async () => {
        ran.push("enrich");
      },
    },
  });
  return { store, scheduler, ran };
}

const t = (iso: string) => new Date(iso);

describe("scheduler (D12)", () => {
  it("fires daily on the cron minute, once", async () => {
    const { scheduler, ran } = setup();
    await scheduler.tick(t("2026-10-13T05:39:00Z"));
    assert.deepEqual(ran, [], "yesterday's slot is not today's business");
    await scheduler.tick(t("2026-10-13T05:40:00Z"));
    await scheduler.tick(t("2026-10-13T05:40:30Z"));
    assert.deepEqual(ran, ["daily:2026-10-13"]);
  });

  it("catches up after a restart that missed the 05:40 fire", async () => {
    const { scheduler, ran, store } = setup();
    store.setMeta("last_daily_ok", "2026-10-12");
    store.setMeta("last_weekly_ok", "2026-W42");
    await scheduler.tick(t("2026-10-13T05:30:00Z"));
    assert.deepEqual(ran, [], "not due before today's slot");
    await scheduler.tick(t("2026-10-13T09:12:00Z"));
    assert.deepEqual(ran, ["daily:2026-10-13"]);
    await scheduler.tick(t("2026-10-13T09:13:00Z"));
    assert.deepEqual(ran, ["daily:2026-10-13"], "done for the day");
  });

  it("retries a failed day at most once an hour", async () => {
    const { scheduler, ran } = setup({ failDaily: true });
    await scheduler.tick(t("2026-10-13T05:40:00Z"));
    await scheduler.tick(t("2026-10-13T06:10:00Z"));
    await scheduler.tick(t("2026-10-13T06:41:00Z"));
    assert.deepEqual(ran, ["daily:2026-10-13", "daily:2026-10-13"]);
  });

  it("chases a missing weekly report only after the daily is done", async () => {
    const { scheduler, ran, store } = setup();
    store.setMeta("last_daily_ok", "2026-10-13");
    store.setMeta("last_weekly_ok", "2026-W41");
    await scheduler.tick(t("2026-10-13T10:00:00Z")); // Tuesday; Monday's 06:40 slot passed with no weekly
    assert.deepEqual(ran, ["weekly"]);
  });

  it("enriches hourly while keyless, never alongside a due daily", async () => {
    const { scheduler, ran, store } = setup({ keyless: true });
    store.setMeta("last_daily_ok", "2026-10-13");
    store.setMeta("last_weekly_ok", "2026-W42");
    await scheduler.tick(t("2026-10-13T11:17:00Z"));
    await scheduler.tick(t("2026-10-13T11:18:00Z"));
    assert.deepEqual(ran, ["enrich"]);
  });
});
