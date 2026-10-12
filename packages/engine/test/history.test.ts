import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GitHubClient } from "../src/github/client.js";
import { dailySeries, fetchStarHistory, peakWeek, sevenDay } from "../src/github/star-history.js";
import { Store } from "../src/store/store.js";
import { isoDate } from "../src/util/dates.js";
import { meta } from "./helpers.js";

// 2026-10-04 is a Sunday; 1791072000 is the newest bucket the research note recorded live.
const SUN = (d: string) => Date.parse(`${d}T00:00:00Z`) / 1000;

describe("stargazers history (D13)", () => {
  it("pages newest-first buckets and stops at the requested number of weeks", async () => {
    const calls: string[] = [];
    const fakeFetch = (async (input: string | URL | Request) => {
      const url = new URL(String(input));
      calls.push(url.search);
      const page = Number(url.searchParams.get("page"));
      const per = Number(url.searchParams.get("per_page"));
      const rows = Array.from({ length: per }, (_, i) => ({ week: SUN("2026-10-04") - (page - 1) * per * 7 * 86400 - i * 7 * 86400, total: 70, days: [10, 10, 10, 10, 10, 10, 10] }));
      return new Response(JSON.stringify(rows), { status: 200, headers: { "x-ratelimit-remaining": "4000" } });
    }) as typeof fetch;
    const client = new GitHubClient({ token: "t", fetchImpl: fakeFetch });
    const weeks = await fetchStarHistory(client, "a/b", 45);
    assert.equal(weeks?.length, 45);
    assert.equal(calls.length, 2);
    assert.equal(weeks?.[0]?.week_start, "2026-10-04");
  });

  it("returns null for a missing repo", async () => {
    const client = new GitHubClient({ token: null, fetchImpl: (async () => new Response("{}", { status: 404 })) as typeof fetch });
    assert.equal(await fetchStarHistory(client, "gone/repo", 2), null);
  });

  it("derives a 7-day figure that ignores days not yet observed", () => {
    const weeks = [
      { week_start: "2026-10-04", total: 348, days: [91, 74, 88, 91, 4, 0, 0] },
      { week_start: "2026-09-27", total: 700, days: [100, 100, 100, 100, 100, 100, 100] },
    ];
    // fetched Thursday 2026-10-08: the last 7 complete days are Thu 10-01 .. Wed 10-07 (today is in progress)
    const sd = sevenDay(weeks, "2026-10-08");
    assert.equal(sd?.stars7d, 300 + 91 + 74 + 88 + 91);
    assert.equal(dailySeries(weeks, "2026-10-05").at(-1)?.date, "2026-10-05");
    assert.equal(peakWeek(weeks)?.total, 700);
  });

  it("feeds trend signals when fresh", () => {
    const s = new Store(":memory:");
    s.upsertRepoMeta(meta("a/b"));
    const today = isoDate();
    s.saveStarWeeks("a/b", [{ week_start: today, total: 70, days: [70, 0, 0, 0, 0, 0, 0] }, { week_start: "2026-01-04", total: 900, days: [900, 0, 0, 0, 0, 0, 0] }]);
    const sig = s.signals("a/b");
    assert.equal(sig.peak_week_stars, 900);
    assert.ok(sig.stars_7d !== null && sig.stars_7d >= 70);
    s.close();
  });
});

describe("renames (E-m1)", () => {
  it("folds the old name into the new one and aliases future archive rows", () => {
    const s = new Store(":memory:");
    const snap = (name: string, date: string) => ({ source: "larsbijl-archive" as const, window: "daily" as const, list_date: date, language_list: "go", fetched_at: "", entries: [{ full_name: name, rank: 1 }] });
    s.ingestSnapshot(snap("old/name", "2026-01-01"));
    s.ingestSnapshot(snap("new/name", "2026-01-02"));
    s.setShortlist("old/name", "shortlisted", "keep me");
    s.renameRepo("old/name", "new/name");
    assert.equal(s.getRepo("old/name"), null);
    assert.equal(s.signals("new/name").distinct_days, 2);
    assert.equal(s.getShortlist("new/name")?.note, "keep me");
    s.ingestSnapshot(snap("old/name", "2026-01-03"));
    assert.equal(s.getRepo("old/name"), null, "alias catches the old name");
    assert.equal(s.signals("new/name").distinct_days, 3);
    s.close();
  });
});

describe("agent vs owner ratings (P-M5)", () => {
  it("an agent rating moves a repo to testing, only the owner's moves it to rated", () => {
    const s = new Store(":memory:");
    s.setShortlist("a/b", "shortlisted", null);
    s.setAgentRating("a/b", { rating: 4, test_log: "docker run … ok", agent: "kinly" });
    assert.equal(s.getShortlist("a/b")?.status, "testing");
    assert.equal(s.getAgentRating("a/b")?.test_log, "docker run … ok");
    s.setRating("a/b", { rating: 3 });
    assert.equal(s.getShortlist("a/b")?.status, "rated");
    s.close();
  });
});
