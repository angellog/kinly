import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dailyReport } from "../src/reports/daily.js";
import { landscapeReport } from "../src/reports/landscape.js";
import { resourceFileName, resourcePage } from "../src/reports/resource.js";
import { weeklyReport, weekIdFor } from "../src/reports/weekly.js";
import { buildProfile } from "../src/score/profile.js";
import { Store } from "../src/store/store.js";
import { rankedList, repoView, rescoreAll } from "../src/views.js";
import { meta, NOW } from "./helpers.js";

const profile = { ...buildProfile([]), generated_at: NOW };

function world(): Store {
  const s = new Store(":memory:");
  const days = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"];
  days.forEach((d, i) => {
    s.ingestSnapshot({
      source: "trending-page",
      window: "daily",
      list_date: d,
      language_list: "all",
      fetched_at: `${d}T06:00:00Z`,
      entries: [
        { full_name: "acme/mcp-instagram", rank: 1, stars_period: 800 + i * 100 },
        { full_name: "torvalds/linux", rank: 2, stars_period: 100 },
        ...(i === 3 ? [{ full_name: "fresh/remotion-kit", rank: 3, stars_period: 2000 }] : []),
      ],
    });
  });
  s.upsertRepoMeta(meta("acme/mcp-instagram", { description: "MCP server for Instagram publishing and insights", topics: ["mcp", "instagram"], stars: 25_000, latest_release: "v2", latest_release_at: "2026-10-01T00:00:00Z" }));
  s.upsertRepoMeta(meta("torvalds/linux", { description: "Linux kernel source tree", language: "C", stars: 200_000, license_spdx: "GPL-2.0", license_class: "strong-copyleft" }));
  s.upsertRepoMeta(meta("fresh/remotion-kit", { description: "Make carousel videos with Remotion and React", topics: ["video", "remotion"], stars: 3000, created_at: "2026-10-01T00:00:00Z" }));
  s.setCategory("acme/mcp-instagram", "mcp-tools", "rule");
  s.setCategory("torvalds/linux", "systems-languages", "rule");
  s.setCategory("fresh/remotion-kit", "content-media", "rule");
  s.setSummary("acme/mcp-instagram", { summary: "An MCP server that lets an agent publish to Instagram.", business_use: "Lets the Vantik carousel pipeline publish through one tool call.", source: "heuristic", hash: "x" });
  s.replaceUserStars([{ full_name: "acme/mcp-instagram", starred_at: NOW }]);
  rescoreAll(s, profile, undefined, NOW);
  return s;
}

describe("reports", () => {
  it("daily report is deterministic and complete", () => {
    const s = world();
    const a = dailyReport(s, profile, { date: "2026-10-08", generatedAt: NOW, sources: ["trending-page"] });
    const b = dailyReport(s, profile, { date: "2026-10-08", generatedAt: NOW, sources: ["trending-page"] });
    assert.equal(a, b);
    assert.match(a, /^# Kinly Daily — 2026-10-08/);
    for (const h of ["## Top", "## Picks for Vantik Systems and FeetBit", "## Repeat trenders", "## New entrants", "## By category", "## Your stars on today's list"]) assert.ok(a.includes(h), `missing ${h}`);
    assert.ok(a.includes("[acme/mcp-instagram](https://github.com/acme/mcp-instagram)"));
    assert.ok(a.indexOf("fresh/remotion-kit") > -1, "new entrant listed");
    assert.ok(!/\bunlock\b|revolutioni[sz]e|supercharge/i.test(a), "no banned hype words");
    s.close();
  });

  it("picks favour the relevant repo over the kernel", () => {
    const s = world();
    const md = dailyReport(s, profile, { date: "2026-10-08", generatedAt: NOW });
    const picks = md.slice(md.indexOf("## Picks"), md.indexOf("## Repeat"));
    assert.ok(picks.includes("acme/mcp-instagram"));
    assert.ok(!picks.includes("torvalds/linux"));
    s.close();
  });

  it("weekly report covers the ISO week", () => {
    const s = world();
    assert.equal(weekIdFor("2026-10-08"), "2026-W41");
    const md = weeklyReport(s, profile, { date: "2026-10-08", generatedAt: NOW });
    assert.equal(md, weeklyReport(s, profile, { date: "2026-10-08", generatedAt: NOW }));
    assert.match(md, /2026-W41/);
    assert.ok(md.includes("acme/mcp-instagram"));
    s.close();
  });

  it("landscape report runs over a range", () => {
    const s = world();
    const md = landscapeReport(s, profile, { from: "2026-09-01", to: "2026-10-08", generatedAt: NOW, narrative: "Narrative paragraph." });
    assert.ok(md.includes("Narrative paragraph."));
    assert.ok(md.includes("2026-10"));
    s.close();
  });

  it("resource page carries score, verdict, licence and the test log", () => {
    const s = world();
    const repo = s.getRepo("acme/mcp-instagram");
    assert.ok(repo);
    const v = repoView(s, repo, profile);
    const md = resourcePage(v, { generatedAt: NOW, testLog: "npm test → 12 passing" });
    assert.match(md, /^# acme\/mcp-instagram/);
    assert.ok(md.includes(`**${v.score.total}/100**`));
    assert.ok(md.includes("npm test → 12 passing"));
    assert.equal(resourceFileName("Acme/MCP.Instagram"), resourceFileName("Acme/MCP.Instagram"));
    assert.match(resourceFileName("acme/mcp-instagram"), /^[a-z0-9._-]+\.md$/);
    s.close();
  });

  it("ranked lists filter by category and re-rank", () => {
    const s = world();
    const media = rankedList(s, "today", profile, { date: "2026-10-08", category: "content-media" });
    assert.deepEqual(media.map((v) => [v.rank, v.repo.full_name]), [[1, "fresh/remotion-kit"]]);
    s.close();
  });
});
