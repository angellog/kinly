import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { kinlyScore, licenseScore, maintenanceScore, persistenceScore } from "../src/score/kinly-score.js";
import { buildProfile, relevanceScore, starTopicWeights } from "../src/score/profile.js";
import type { TrendSignals } from "../src/types.js";
import { NOW, repo } from "./helpers.js";

function signals(over: Partial<TrendSignals> = {}): TrendSignals {
  return { full_name: "a/b", appearances: 0, distinct_days: 0, distinct_weeks: 0, first_seen: null, last_seen: null, peak_stars_period: null, velocity_7d: null, stars_7d: null, peak_week_stars: null, sources: [], ...over };
}

describe("kinly score", () => {
  it("adds up to the documented maxima (30/20/15/15/20) and never exceeds 100", () => {
    const r = repo("a/b", { stars: 500_000, pushed_at: "2026-10-08T00:00:00Z", latest_release_at: "2026-10-01T00:00:00Z", latest_release: "v1", created_at: "2020-01-01T00:00:00Z" });
    const s = kinlyScore(r, signals({ velocity_7d: 5000, distinct_weeks: 20, distinct_days: 50 }), 100, NOW);
    assert.equal(s.adoption, 30);
    assert.equal(s.maintenance, 20);
    assert.equal(s.persistence, 15);
    assert.equal(s.license, 15);
    assert.equal(s.relevance, 20);
    assert.equal(s.total, 100);
    assert.equal(s.verdict, "BUILD");
  });

  it("never says BUILD for source-available code, however strong", () => {
    const r = repo("a/b", { stars: 200_000, license_spdx: "BUSL-1.1", license_class: "source-available", latest_release_at: "2026-10-01T00:00:00Z", created_at: "2020-01-01T00:00:00Z" });
    const s = kinlyScore(r, signals({ velocity_7d: 3000, distinct_weeks: 20, distinct_days: 40 }), 100, NOW);
    assert.ok(s.total >= 70, `total ${s.total}`);
    assert.equal(s.verdict, "WATCH");
  });

  it("never says BUILD when relevance is under 50", () => {
    const r = repo("a/b", { stars: 200_000, latest_release_at: "2026-10-01T00:00:00Z", created_at: "2020-01-01T00:00:00Z" });
    const s = kinlyScore(r, signals({ velocity_7d: 3000, distinct_weeks: 20, distinct_days: 40 }), 40, NOW);
    assert.ok(s.total >= 70);
    assert.equal(s.verdict, "WATCH");
  });

  it("archived repos are SKIP", () => {
    const s = kinlyScore(repo("a/b", { archived: true, stars: 100_000 }), signals({ distinct_weeks: 10 }), 100, NOW);
    assert.equal(s.verdict, "SKIP");
    assert.equal(s.maintenance, 0);
  });

  it("open-core caps the licence component", () => {
    assert.equal(licenseScore(repo("a/b", { open_core: true })).score, 6);
    assert.equal(licenseScore(repo("a/b")).score, 15);
  });

  it("maintenance decays with push age", () => {
    const fresh = maintenanceScore(repo("a/b", { pushed_at: "2026-10-07T00:00:00Z", created_at: "2026-09-01T00:00:00Z" }), NOW).score;
    const stale = maintenanceScore(repo("a/b", { pushed_at: "2025-06-01T00:00:00Z", created_at: "2026-09-01T00:00:00Z" }), NOW).score;
    assert.ok(fresh > stale, `${fresh} > ${stale}`);
  });

  it("persistence rewards distinct weeks", () => {
    assert.ok(persistenceScore(signals({ distinct_weeks: 4, distinct_days: 6 })).score > persistenceScore(signals({ distinct_weeks: 1, distinct_days: 6 })).score);
  });

  it("is deterministic for a fixed clock", () => {
    const r = repo("a/b", { stars: 12_345 });
    assert.deepEqual(kinlyScore(r, signals({ distinct_weeks: 2 }), 66, NOW), kinlyScore(r, signals({ distinct_weeks: 2 }), 66, NOW));
  });
});

describe("relevance profile", () => {
  const profile = buildProfile([
    { full_name: "x/1", starred_at: NOW, topics: ["mcp", "claude-code"] },
    { full_name: "x/2", starred_at: NOW, topics: ["mcp", "llm"] },
    { full_name: "x/3", starred_at: NOW, topics: ["mcp"] },
  ]);

  it("derives star-topic weights from repeated topics only", () => {
    const w = starTopicWeights([
      { full_name: "x/1", starred_at: NOW, topics: ["mcp", "a"] },
      { full_name: "x/2", starred_at: NOW, topics: ["MCP"] },
    ]);
    assert.deepEqual(w, { mcp: 1 });
  });

  it("scores an MCP repo above a Linux kernel mirror", () => {
    const mcp = relevanceScore(repo("a/mcp-instagram", { category: "mcp-tools", description: "MCP server for Instagram content", topics: ["mcp"] }), profile);
    const kernel = relevanceScore(repo("torvalds/linux", { category: "systems-languages", description: "Linux kernel source tree" }), profile);
    assert.ok(mcp.score > kernel.score + 30, `${mcp.score} vs ${kernel.score}`);
    assert.ok(mcp.score <= 100 && kernel.score >= 0);
    assert.ok(mcp.reasons.some((r) => r.includes("matches your stars")));
  });
});

describe("verdict guards", () => {
  it("does not say BUILD for an unreadable licence", () => {
    const r = repo("a/b", { stars: 200_000, license_spdx: "NOASSERTION", license_class: "unknown", latest_release_at: "2026-10-01T00:00:00Z", created_at: "2020-01-01T00:00:00Z" });
    const s = kinlyScore(r, signals({ velocity_7d: 3000, distinct_weeks: 20, distinct_days: 40 }), 100, NOW);
    assert.ok(s.total >= 70);
    assert.equal(s.verdict, "WATCH");
  });

  it("caps relevance when the written use says it is not for the business", () => {
    const profile = buildProfile([]);
    const base = repo("a/mcp-voice", { category: "mcp-tools", description: "MCP voice assistant", topics: ["mcp"] });
    const high = relevanceScore(base, profile).score;
    const capped = relevanceScore({ ...base, summary_source: "llm", business_use: "Not useful to either business: hardware." }, profile).score;
    assert.ok(high > 30);
    assert.equal(capped, 30);
  });
});
