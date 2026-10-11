import { readFileSync } from "node:fs";
import type { GitHubClient } from "../github/client.js";
import { isFullName } from "../util/text.js";

/**
 * The owner's starred repositories with timestamps. Needs a token
 * (`/user/starred` is the authenticated user's list). The raw export under
 * data/raw/stars.json is the keyless fallback: it is what the owner starred
 * when the file was written.
 */

export interface UserStar {
  full_name: string;
  starred_at: string;
  description?: string | null;
  language?: string | null;
  topics?: string[];
  stars?: number | null;
}

interface StarredItem {
  starred_at: string;
  repo: {
    full_name: string;
    description: string | null;
    language: string | null;
    topics?: string[];
    stargazers_count: number;
  };
}

export async function fetchUserStars(client: GitHubClient, maxPages = 30): Promise<UserStar[]> {
  const out: UserStar[] = [];
  for await (const page of client.restPages<StarredItem>("/user/starred", { per_page: 100 }, { accept: "application/vnd.github.star+json", maxPages })) {
    for (const item of page) {
      if (!item.repo || !isFullName(item.repo.full_name)) continue;
      out.push({
        full_name: item.repo.full_name,
        starred_at: item.starred_at,
        description: item.repo.description,
        language: item.repo.language,
        topics: item.repo.topics ?? [],
        stars: item.repo.stargazers_count,
      });
    }
  }
  return out;
}

/** Read the committed export (data/raw/stars.json). */
export function readStarsFile(file: string): UserStar[] {
  const raw = JSON.parse(readFileSync(file, "utf8")) as Array<Record<string, unknown>>;
  const out: UserStar[] = [];
  for (const r of raw) {
    const fullName = r["full_name"];
    const starredAt = r["starred_at"];
    if (typeof fullName !== "string" || typeof starredAt !== "string" || !isFullName(fullName)) continue;
    out.push({
      full_name: fullName,
      starred_at: starredAt,
      description: typeof r["description"] === "string" ? r["description"] : null,
      language: typeof r["language"] === "string" ? r["language"] : null,
      topics: Array.isArray(r["topics"]) ? (r["topics"] as unknown[]).filter((t): t is string => typeof t === "string") : [],
      stars: typeof r["stars"] === "number" ? r["stars"] : null,
    });
  }
  return out;
}
