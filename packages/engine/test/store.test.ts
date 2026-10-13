import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Store } from "../src/store/store.js";
import type { Snapshot } from "../src/types.js";
import { meta, NOW } from "./helpers.js";

function snap(over: Partial<Snapshot> & Pick<Snapshot, "list_date">): Snapshot {
  return {
    source: "trending-page",
    window: "daily",
    language_list: "all",
    fetched_at: `${over.list_date}T06:00:00Z`,
    entries: [],
    ...over,
  };
}

function seeded(): Store {
  const s = new Store(":memory:");
  // Mon 2026-10-05 .. Thu 2026-10-08
  s.ingestSnapshot(snap({ list_date: "2026-10-05", entries: [{ full_name: "a/old", rank: 1, stars_period: 900, stars_total: 10_000 }] }));
  s.ingestSnapshot(snap({ list_date: "2026-10-06", entries: [{ full_name: "a/old", rank: 1, stars_period: 700 }, { full_name: "b/new", rank: 2, stars_period: 300 }] }));
  s.ingestSnapshot(
    snap({
      list_date: "2026-10-08",
      entries: [
        { full_name: "b/new", rank: 1, stars_period: 1200, description: "fresh" },
        { full_name: "c/three", rank: 2, stars_period: 400 },
      ],
    }),
  );
  s.ingestSnapshot(snap({ list_date: "2026-10-08", language_list: "python", entries: [{ full_name: "d/py", rank: 1, stars_period: 5000 }] }));
  s.ingestSnapshot(snap({ list_date: "2026-10-08", window: "weekly", entries: [{ full_name: "c/three", rank: 1, stars_period: 8000 }, { full_name: "b/new", rank: 2, stars_period: 2000 }] }));
  // older history so a/old is "persistent" (3 distinct weeks)
  s.ingestSnapshot(snap({ source: "larsbijl-archive", list_date: "2026-09-14", language_list: "go", entries: [{ full_name: "a/old", rank: 3 }] }));
  s.ingestSnapshot(snap({ source: "larsbijl-archive", list_date: "2026-09-22", language_list: "go", entries: [{ full_name: "a/old", rank: 4 }] }));
  return s;
}

describe("store", () => {
  it("ingests idempotently", () => {
    const s = new Store(":memory:");
    const sn = snap({ list_date: "2026-10-08", entries: [{ full_name: "a/b", rank: 1, stars_period: 10 }] });
    assert.deepEqual(s.ingestSnapshot(sn), { inserted: 1, skipped: 0 });
    assert.deepEqual(s.ingestSnapshot(sn), { inserted: 0, skipped: 1 });
    assert.equal(s.appearancesFor("a/b").length, 1);
    s.close();
  });

  it("does not let a thin source overwrite enrichment", () => {
    const s = new Store(":memory:");
    s.upsertRepoMeta(meta("a/b", { description: "rich description", stars: 5000 }));
    s.ingestSnapshot(snap({ list_date: "2026-10-08", entries: [{ full_name: "a/b", rank: 1, description: "thin", stars_total: 1 }] }));
    assert.equal(s.getRepo("a/b")?.description, "rich description");
    assert.equal(s.getRepo("a/b")?.stars, 5000);
    s.close();
  });

  it("ranks today: the all-languages list first, then stars today", () => {
    const s = seeded();
    const today = s.list("today", { date: "2026-10-08" }).map((r) => r.full_name);
    assert.deepEqual(today, ["b/new", "c/three", "d/py"]);
    assert.equal(s.list("today", { date: "2026-10-08" })[0]?.metric_label, "1,200 stars today");
    s.close();
  });

  it("ranks the week by the weekly list's stars, then days on the daily list", () => {
    const s = seeded();
    const week = s.list("week", { date: "2026-10-08" }).map((r) => r.full_name);
    assert.deepEqual(week.slice(0, 2), ["c/three", "b/new"]);
    assert.ok(week.includes("a/old"));
    s.close();
  });

  it("finds persistent and new repos", () => {
    const s = seeded();
    assert.deepEqual(s.list("persistent", { date: "2026-10-08" }).map((r) => r.full_name), ["a/old"]);
    const fresh = s.list("new", { date: "2026-10-08" }).map((r) => r.full_name);
    assert.ok(fresh.includes("b/new") && fresh.includes("d/py"));
    assert.ok(!fresh.includes("a/old"), "first seen in September is not new");
    s.close();
  });

  it("computes trend signals", () => {
    const s = seeded();
    const sig = s.signals("a/old");
    assert.equal(sig.distinct_days, 4);
    assert.equal(sig.first_seen, "2026-09-14");
    assert.equal(sig.last_seen, "2026-10-06");
    assert.equal(sig.peak_stars_period, 900);
    assert.deepEqual([...sig.sources].sort(), ["larsbijl-archive", "trending-page"]);
    s.close();
  });

  it("records shortlist, ratings and runs", () => {
    const s = seeded();
    s.setShortlist("b/new", "testing", "try on FeetBit catalog");
    assert.equal(s.getShortlist("b/new")?.status, "testing");
    const r = s.setRating("b/new", { rating: 4, notes: "works", verdict_override: "BUILD" });
    assert.equal(r.rating, 4);
    assert.throws(() => s.setRating("b/new", { rating: 9 }));
    const id = s.startRun("collect");
    s.finishRun(id, true, { rows: 3 });
    assert.equal(s.lastSuccessfulRun("collect")?.stats["rows"], 3);
    s.close();
  });

  it("round-trips through export and import", () => {
    const a = seeded();
    a.upsertRepoMeta(meta("b/new", { description: "fresh", stars: 2500, topics: ["mcp"] }));
    a.setSummary("b/new", { summary: "Does X.", business_use: "Use for Y.", source: "heuristic", hash: "h" });
    a.setCategory("b/new", "mcp-tools", "rule");
    a.setShortlist("b/new", "shortlisted", null);
    a.setRating("b/new", { rating: 5 });
    const bundle = a.exportBundle();
    const b = new Store(":memory:");
    b.importRepos(bundle.repos);
    b.importOwnerState({ shortlist: bundle.shortlist, ratings: bundle.ratings });
    const got = b.getRepo("b/new");
    assert.equal(got?.summary, "Does X.");
    assert.equal(got?.category, "mcp-tools");
    assert.deepEqual(got?.topics, ["mcp"]);
    assert.equal(b.getShortlist("b/new")?.status, "rated", "a rating promotes the shortlist entry");
    assert.equal(b.getRating("b/new")?.rating, 5);
    a.close();
    b.close();
  });

  it("keeps the newer enrichment on import", () => {
    const s = new Store(":memory:");
    s.upsertRepoMeta(meta("a/b", { stars: 9, enriched_at: "2026-10-08T00:00:00Z" }));
    s.importRepos([{ ...meta("a/b", { stars: 1, enriched_at: "2026-01-01T00:00:00Z" }), summary: null, business_use: null, summary_source: null, summary_hash: null, category: "other", category_source: "rule", summary_at: null }]);
    assert.equal(s.getRepo("a/b")?.stars, 9);
    s.close();
  });

  it("stores the owner's stars", () => {
    const s = new Store(":memory:");
    s.replaceUserStars([{ full_name: "a/b", starred_at: NOW }]);
    assert.ok(s.isStarred("a/b"));
    assert.ok(!s.isStarred("a/c"));
    s.close();
  });
});

describe("aliases round trip", () => {
  it("exports aliases and merges a split history on import", () => {
    const a = new Store(":memory:");
    a.renameRepo("old/name", "new/name");
    const aliases = a.listAliases();
    assert.deepEqual(aliases, [{ from_name: "old/name", to_name: "new/name" }]);
    const b = new Store(":memory:");
    b.ingestSnapshot(snap({ list_date: "2026-01-01", entries: [{ full_name: "old/name", rank: 1 }] }));
    b.ingestSnapshot(snap({ list_date: "2026-01-02", entries: [{ full_name: "new/name", rank: 1 }] }));
    assert.equal(b.importAliases(aliases), 1);
    assert.equal(b.getRepo("old/name"), null);
    assert.equal(b.signals("new/name").distinct_days, 2);
    a.close();
    b.close();
  });
});

describe("review G1 hardening (store)", () => {
  it("search candidates are not trending: no days, weeks or persistence from gh-search-new", () => {
    const s = new Store(":memory:");
    for (const d of ["2026-10-01", "2026-10-08", "2026-10-15"]) s.ingestSnapshot(snap({ source: "gh-search-new", window: "monthly", list_date: d, entries: [{ full_name: "new/fast", rank: 1 }] }));
    const sig = s.signals("new/fast");
    assert.equal(sig.distinct_days, 0);
    assert.equal(sig.distinct_weeks, 0);
    assert.deepEqual(s.list("persistent", { date: "2026-10-15" }), []);
    s.close();
  });

  it("the week that spans New Year counts once", () => {
    const s = new Store(":memory:");
    for (const d of ["2025-12-29", "2025-12-31", "2026-01-02", "2026-01-04"]) s.ingestSnapshot(snap({ list_date: d, entries: [{ full_name: "a/b", rank: 1 }] }));
    assert.equal(s.signals("a/b").distinct_weeks, 1);
    s.close();
  });

  it("an unenriched or older record never overwrites a newer one on import", () => {
    const s = new Store(":memory:");
    s.upsertRepoMeta(meta("a/b", { stars: 9000, license_class: "permissive", enriched_at: "2026-10-12T00:00:00Z" }));
    s.setSummary("a/b", { summary: "LLM summary.", business_use: "Use.", source: "llm", hash: "h" });
    s.importRepos([{ ...meta("a/b", { stars: null, license_class: "unknown", enriched_at: null }), summary: "Heuristic.", business_use: "Template.", summary_source: "heuristic", summary_hash: "h", category: "other", category_source: "rule", summary_at: "2026-10-13T00:00:00Z" } as never]);
    const r = s.getRepo("a/b");
    assert.equal(r?.stars, 9000);
    assert.equal(r?.summary, "LLM summary.");
    s.close();
  });

  it("pick memory and secrets: picks round-trip; token-shaped strings never reach a test log", () => {
    const s = new Store(":memory:");
    s.recordPicks("daily", "2026-10-12", ["a/b"]);
    const t = new Store(":memory:");
    assert.equal(t.importPicks(s.listPicks()), 1);
    assert.ok(t.pickedBetween("2026-10-01", "2026-10-13").has("a/b"));
    t.setAgentRating("a/b", { rating: 3, test_log: "env: GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz123456 and sk-ant-api03-abcdefghijklmnop" });
    const log = t.getAgentRating("a/b")?.test_log ?? "";
    assert.ok(!/ghp_|sk-ant-/.test(log), log);
    s.close();
    t.close();
  });
});

describe("import keeps curated decisions", () => {
  it("applies a summary for a repo without a README and keeps a curated 'other' with its source and time", () => {
    const s = new Store(":memory:");
    s.upsertRepoMeta(meta("o/imgui", { readme_hash: null }));
    s.importRepos([{ ...meta("o/imgui", { readme_hash: null }), summary: "A C++ GUI library.", business_use: "Not for Vantik or FeetBit.", summary_source: "llm", summary_hash: "", category: "other", category_source: "llm", summary_at: "2026-10-12T00:00:00Z" } as never]);
    const r = s.getRepo("o/imgui");
    assert.equal(r?.summary, "A C++ GUI library.");
    assert.equal(r?.summary_at, "2026-10-12T00:00:00Z");
    assert.equal(r?.category_source, "llm");
    s.close();
  });
});

describe("partial weekly reports (H4)", () => {
  it("drops a weekly generated before its week ended and keeps completed ones", () => {
    const s = new Store(":memory:");
    s.saveReport("weekly", "2026-W41", "# W41", { generatedAt: "2026-10-12T05:40:00Z" }); // Monday after: complete
    s.saveReport("weekly", "2026-W42", "# W42 so far", { generatedAt: "2026-10-12T00:12:43Z" }); // its own Monday: partial
    s.saveReport("weekly", "2026-W40", "# W40", { generatedAt: "2026-10-04T23:59:00Z" }); // its own Sunday: still partial
    s.saveReport("daily", "2026-10-12", "# daily", { generatedAt: "2026-10-12T05:41:00Z" });
    assert.deepEqual(s.dropPartialWeeklies().sort(), ["2026-W40", "2026-W42"]);
    assert.equal(s.latestReport("weekly")?.id, "2026-W41");
    assert.equal(s.latestReport("daily")?.id, "2026-10-12", "dailies are untouched");
    assert.deepEqual(s.dropPartialWeeklies(), [], "idempotent");
  });
});
