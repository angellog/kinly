import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gitBlobSha } from "../src/github/publish.js";
import { heuristicSummary, Llm } from "../src/llm/anthropic.js";
import { Store } from "../src/store/store.js";
import { addDays, dateRange, isIsoDate, isoWeek, monthStart, weekStart } from "../src/util/dates.js";
import { isFullName, parseCount } from "../src/util/text.js";
import { repo } from "./helpers.js";

describe("dates", () => {
  it("does ISO weeks, week and month starts", () => {
    assert.equal(isoWeek("2026-10-08"), "2026-W41");
    assert.equal(isoWeek("2026-01-01"), "2026-W01");
    assert.equal(isoWeek("2027-01-01"), "2026-W53");
    assert.equal(weekStart("2026-10-08"), "2026-10-05");
    assert.equal(weekStart("2026-10-05"), "2026-10-05");
    assert.equal(monthStart("2026-10-08"), "2026-10-01");
    assert.equal(addDays("2026-03-01", -1), "2026-02-28");
    assert.deepEqual(dateRange("2025-12-30", "2026-01-02"), ["2025-12-30", "2025-12-31", "2026-01-01", "2026-01-02"]);
    assert.ok(isIsoDate("2026-10-08") && !isIsoDate("2026-13-40") && !isIsoDate("8 Oct"));
  });
});

describe("text", () => {
  it("parses GitHub counts and validates names", () => {
    assert.equal(parseCount("1,234"), 1234);
    assert.equal(parseCount("1.2k"), 1200);
    assert.equal(parseCount(""), null);
    assert.ok(isFullName("vllm-project/vllm"));
    assert.ok(isFullName("a/b.c_d-e"));
    assert.ok(!isFullName("no-slash"));
    assert.ok(!isFullName("a/b/c"));
    assert.ok(!isFullName("-bad/name"));
  });
});

describe("git blob sha", () => {
  it("matches `git hash-object` for known content", () => {
    // printf 'hello\n' | git hash-object --stdin
    assert.equal(gitBlobSha("hello\n"), "ce013625030ba8dba906f756967f9e9ca394464a");
    // empty blob
    assert.equal(gitBlobSha(""), "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
  });
});

describe("llm layer", () => {
  it("is unavailable without a key and never throws", async () => {
    const llm = new Llm({ apiKey: "" });
    assert.equal(llm.available, false);
    assert.equal(await llm.summarizeRepo(repo("a/b"), { category_weights: {}, keywords: {}, star_topics: {}, business_context: "", generated_at: "" }), null);
  });

  it("tracks the token budget in the store", () => {
    const store = new Store(":memory:");
    const llm = new Llm({ apiKey: "", store, dailyCapTokens: 10 });
    assert.equal(llm.tokensUsedToday(), 0);
    store.close();
  });

  it("writes a heuristic summary from the description and the category", () => {
    const h = heuristicSummary(repo("a/b", { description: "A thing.", category: "mcp-tools" }));
    assert.equal(h.summary, "A thing.");
    assert.match(h.business_use, /Claude Code|Paperclip/);
    assert.ok(h.hash.length > 0);
    const blank = heuristicSummary(repo("a/b"));
    assert.match(blank.summary, /a\/b/);
  });
});
