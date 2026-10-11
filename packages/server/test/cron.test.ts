import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cronMatches, lastFire, nextFire, parseCron } from "../src/cron.js";

const at = (iso: string) => new Date(iso);

describe("cron (UTC)", () => {
  it("matches the daily and weekly schedules", () => {
    const daily = parseCron("40 5 * * *");
    assert.ok(cronMatches(daily, at("2026-10-12T05:40:00Z")));
    assert.ok(!cronMatches(daily, at("2026-10-12T05:41:00Z")));
    const weekly = parseCron("40 6 * * 1");
    assert.ok(cronMatches(weekly, at("2026-10-12T06:40:00Z")), "2026-10-12 is a Monday");
    assert.ok(!cronMatches(weekly, at("2026-10-13T06:40:00Z")));
  });

  it("supports lists, ranges, steps and Sunday as 7", () => {
    const s = parseCron("*/15 9-17 * * 1-5");
    assert.ok(cronMatches(s, at("2026-10-14T09:45:00Z")));
    assert.ok(!cronMatches(s, at("2026-10-14T09:50:00Z")));
    assert.ok(!cronMatches(s, at("2026-10-18T09:45:00Z")), "Sunday");
    assert.ok(cronMatches(parseCron("0 0 * * 7"), at("2026-10-18T00:00:00Z")));
    assert.ok(cronMatches(parseCron("0 12 1,15 * *"), at("2026-10-15T12:00:00Z")));
  });

  it("rejects malformed expressions", () => {
    assert.throws(() => parseCron("* * * *"));
    assert.throws(() => parseCron("61 * * * *"));
    assert.throws(() => parseCron("*/0 * * * *"));
  });

  it("finds the next and the last fire", () => {
    const s = parseCron("40 5 * * *");
    assert.equal(nextFire(s, at("2026-10-12T06:00:00Z"))?.toISOString(), "2026-10-13T05:40:00.000Z");
    assert.equal(lastFire(s, at("2026-10-12T06:00:00Z"))?.toISOString(), "2026-10-12T05:40:00.000Z");
    assert.equal(lastFire(s, at("2026-10-12T05:00:00Z"))?.toISOString(), "2026-10-11T05:40:00.000Z");
  });
});
