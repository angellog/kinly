import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildProfile, starCategoryWeights } from "../src/score/profile.js";
import { Store } from "../src/store/store.js";
import { rankedList, rescoreAll, selectPicks } from "../src/views.js";
import { meta, NOW } from "./helpers.js";

const profile = { ...buildProfile([]), generated_at: NOW };

function world(): Store {
  const s = new Store(":memory:");
  const names = ["a/mcp-one", "b/mcp-two", "c/mcp-three", "d/mcp-four", "e/mcp-five", "f/mcp-six"];
  s.ingestSnapshot({ source: "trending-page", window: "daily", list_date: "2026-10-08", language_list: "all", fetched_at: NOW, entries: names.map((n, i) => ({ full_name: n, rank: i + 1, stars_period: 1000 - i * 10 })) });
  for (const n of names) {
    s.upsertRepoMeta(meta(n, { description: "MCP server for Instagram and Claude Code agents", topics: ["mcp", "instagram", "claude-code"], stars: 30_000, created_at: "2026-06-01T00:00:00Z", latest_release: "v1", latest_release_at: "2026-10-01T00:00:00Z" }));
    s.setCategory(n, "mcp-tools", "rule");
  }
  rescoreAll(s, profile, undefined, NOW);
  return s;
}

describe("picks (D14)", () => {
  it("skips what the owner already starred, shortlisted or was offered in the last 30 days", () => {
    const s = world();
    s.replaceUserStars([{ full_name: "a/mcp-one", starred_at: NOW }]);
    s.setShortlist("b/mcp-two", "shortlisted", null);
    s.recordPicks("daily", "2026-09-20", ["c/mcp-three"]);
    s.recordPicks("daily", "2026-08-01", ["d/mcp-four"]); // older than 30 days: eligible again
    const views = rankedList(s, "today", profile, { date: "2026-10-08", limit: 20 });
    const { picks, known, wip } = selectPicks(s, views, { date: "2026-10-08", n: 5 });
    const names = picks.map((v) => v.repo.full_name);
    assert.ok(!names.includes("a/mcp-one") && !names.includes("b/mcp-two") && !names.includes("c/mcp-three"), names.join());
    assert.ok(names.includes("d/mcp-four"));
    assert.deepEqual(wip, ["b/mcp-two"]);
    assert.ok(known.some((v) => v.repo.full_name === "a/mcp-one"));
    assert.ok(picks.length <= 4, "one slot is taken by the shortlisted repo");
    s.close();
  });

  it("offers nothing when the testing bench is full", () => {
    const s = world();
    for (const n of ["x/1", "x/2", "x/3", "x/4", "x/5"]) s.setShortlist(n, "testing", null);
    const views = rankedList(s, "today", profile, { date: "2026-10-08", limit: 20 });
    assert.equal(selectPicks(s, views, { date: "2026-10-08", n: 5 }).picks.length, 0);
    s.close();
  });

  it("does not hold a weekly pick back because of a daily pick", () => {
    const s = world();
    s.recordPicks("daily", "2026-10-06", ["e/mcp-five"]);
    const views = rankedList(s, "today", profile, { date: "2026-10-08", limit: 20 });
    assert.ok(selectPicks(s, views, { date: "2026-10-08", n: 6, kind: "weekly" }).picks.some((v) => v.repo.full_name === "e/mcp-five"));
    s.close();
  });

  it("derives category weights from the owner's stars, keeping a floor from the defaults", () => {
    const w = starCategoryWeights(["mcp-tools", "mcp-tools", "ai-agents", "systems-languages"]);
    assert.equal(w["mcp-tools"], 1);
    assert.ok((w["social-marketing"] ?? 0) >= 0.45, "business categories keep half their default");
    assert.ok((w["systems-languages"] ?? 0) > 0.1);
    assert.deepEqual(starCategoryWeights([]), {});
  });
});
