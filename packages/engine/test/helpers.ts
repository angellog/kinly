import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RepoMeta, RepoRecord } from "../src/types.js";

/** Fixtures live next to the TypeScript sources; tests run from dist/test. */
export function fixture(name: string): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const dir of [path.join(here, "fixtures"), path.join(here, "..", "..", "test", "fixtures")]) {
    try {
      return readFileSync(path.join(dir, name), "utf8");
    } catch {
      // try the next location
    }
  }
  throw new Error(`fixture not found: ${name}`);
}

export const NOW = "2026-10-08T12:00:00.000Z";

export function meta(fullName: string, over: Partial<RepoMeta> = {}): RepoMeta {
  const [owner, name] = fullName.split("/") as [string, string];
  return {
    full_name: fullName,
    owner,
    name,
    description: null,
    language: null,
    topics: [],
    stars: 1000,
    forks: 10,
    created_at: "2025-01-01T00:00:00Z",
    pushed_at: "2026-10-07T00:00:00Z",
    license_spdx: "MIT",
    license_class: "permissive",
    open_core: false,
    archived: false,
    homepage: null,
    latest_release: null,
    latest_release_at: null,
    readme_excerpt: null,
    readme_hash: null,
    enriched_at: NOW,
    ...over,
  };
}

export function repo(fullName: string, over: Partial<RepoRecord> = {}): RepoRecord {
  return {
    ...meta(fullName),
    summary: null,
    business_use: null,
    summary_source: null,
    summary_hash: null,
    category: "other",
    category_source: "rule",
    summary_at: null,
    ...over,
  };
}
