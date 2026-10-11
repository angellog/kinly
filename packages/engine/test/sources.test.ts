import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { larsbijlCandidateUrls, parseLarsbijlMarkdown } from "../src/sources/larsbijl-archive.js";
import { parseTrendingHtml, trendingUrl, TrendingParseError } from "../src/sources/trending-page.js";
import { parseVitaletsComment } from "../src/sources/vitalets-archive.js";
import { isFullName } from "../src/util/text.js";
import { fixture } from "./helpers.js";

describe("trending page parser", () => {
  it("parses the daily all-languages page (13 rows)", () => {
    const rows = parseTrendingHtml(fixture("trending-daily-2026-10-08.html"), "daily");
    assert.equal(rows.length, 13);
    rows.forEach((r, i) => {
      assert.equal(r.rank, i + 1);
      assert.ok(isFullName(r.full_name), r.full_name);
      assert.ok(typeof r.stars_total === "number" && r.stars_total > 0, `${r.full_name} stars_total`);
      assert.ok(typeof r.stars_period === "number" && r.stars_period >= 0, `${r.full_name} stars_period`);
    });
    assert.equal(new Set(rows.map((r) => r.full_name)).size, rows.length, "no duplicates");
  });

  it("parses the monthly page (25 rows) and the python weekly page (15 rows)", () => {
    assert.equal(parseTrendingHtml(fixture("trending-monthly-2026-10-08.html"), "monthly").length, 25);
    const py = parseTrendingHtml(fixture("trending-python-weekly-2026-10-08.html"), "weekly");
    assert.equal(py.length, 15);
    // The language list is a filter, but each row shows the repo's own primary language, which can differ.
    assert.ok(py.filter((r) => r.language === "Python").length >= 10);
  });

  it("throws a parse error on a page with no rows, rather than returning an empty list", () => {
    assert.throws(() => parseTrendingHtml("<html><body>Something went wrong</body></html>", "daily"), TrendingParseError);
  });

  it("builds trending URLs", () => {
    assert.equal(trendingUrl("daily"), "https://github.com/trending?since=daily");
    assert.equal(trendingUrl("weekly", "python"), "https://github.com/trending/python?since=weekly");
  });
});

describe("larsbijl archive", () => {
  it("splits sections into language snapshots", () => {
    const snaps = parseLarsbijlMarkdown(fixture("larsbijl-2026-10-07.md"), "2026-10-07");
    assert.ok(snaps.length >= 5, `got ${snaps.length} sections`);
    const python = snaps.find((s) => s.language_list === "python");
    assert.ok(python);
    assert.equal(python.entries[0]?.full_name, "ayghri/i-have-adhd");
    assert.equal(python.entries[0]?.rank, 1);
    assert.ok(snaps.every((s) => s.source === "larsbijl-archive" && s.window === "daily" && s.list_date === "2026-10-07"));
    const go = snaps.find((s) => s.language_list === "go");
    assert.ok(go?.entries.some((e) => e.full_name === "ollama/ollama"));
  });

  it("uses the year folder for past years and the flat layout for the current year", () => {
    const old = larsbijlCandidateUrls("2025-04-01");
    assert.ok(old.some((u) => u.endsWith("/2025/2025-04/2025-04-01.md")), old.join("\n"));
    const cur = larsbijlCandidateUrls("2026-10-07");
    assert.ok(cur.some((u) => u.endsWith("/2026-10/2026-10-07.md")), cur.join("\n"));
  });

  it("ignores non-repo bullets", () => {
    const md = "#### python\n* [not a repo](https://github.com/)\n* [a/b](https://github.com/a/b): ok\n";
    const snaps = parseLarsbijlMarkdown(md, "2026-01-01");
    assert.deepEqual(snaps[0]?.entries.map((e) => e.full_name), ["a/b"]);
  });
});

describe("vitalets archive", () => {
  it("parses bold-linked bullets with star counts", () => {
    const body = [
      "**[foo/bar](https://github.com/foo/bar)**",
      "A thing that does stuff",
      "+1,234 stars today",
      "",
      "**[baz/qux](https://github.com/baz/qux)**",
      "Another one",
      "+56 stars today",
    ].join("\n");
    const snap = parseVitaletsComment({ created_at: "2026-09-01T10:00:00Z", body }, "daily");
    assert.ok(snap);
    assert.equal(snap.list_date, "2026-09-01");
    assert.deepEqual(
      snap.entries.map((e) => [e.full_name, e.description, e.stars_period]),
      [
        ["foo/bar", "A thing that does stuff", 1234],
        ["baz/qux", "Another one", 56],
      ],
    );
  });

  it("returns null for a comment without repos", () => {
    assert.equal(parseVitaletsComment({ created_at: "2026-09-01T00:00:00Z", body: "nothing here" }, "daily"), null);
  });
});
