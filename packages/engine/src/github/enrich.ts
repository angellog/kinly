import type { RepoMeta } from "../types.js";
import { isoNow } from "../util/dates.js";
import { sha256, squash, truncate } from "../util/text.js";
import { GitHubClient, GitHubHttpError, RateLimitExhausted } from "./client.js";
import { classifyLicense } from "./license.js";

/**
 * Enrichment: turn a repo name into a RepoMeta.
 *
 * With a token, GraphQL fetches 25 repos per query with aliases (description,
 * stars, forks, dates, language, topics, licence, archived flag, homepage,
 * latest release, README head, and whether an `ee/` or `enterprise/` directory
 * exists — the open-core tell). Without a token, REST does one repo per two
 * requests (`/repos/{o}/{r}` + `/readme`), paced to the 60/h budget.
 */

export const README_EXCERPT_CHARS = 4000;
export const GRAPHQL_BATCH = 25;

export interface EnrichResult {
  found: RepoMeta[];
  missing: string[];
  /** Names skipped because the rate budget ran out. */
  skipped: string[];
  errors: Array<{ full_name: string; error: string }>;
}

interface GqlRepo {
  nameWithOwner: string;
  description: string | null;
  stargazerCount: number;
  forkCount: number;
  createdAt: string;
  pushedAt: string | null;
  isArchived: boolean;
  homepageUrl: string | null;
  primaryLanguage: { name: string } | null;
  licenseInfo: { spdxId: string | null; name: string } | null;
  repositoryTopics: { nodes: Array<{ topic: { name: string } }> };
  latestRelease: { tagName: string; publishedAt: string | null } | null;
  readme: { text: string } | null;
  readmeLower: { text: string } | null;
  readmeRst: { text: string } | null;
  licenseFile: { text: string } | null;
  ee: { __typename: string } | null;
  enterprise: { __typename: string } | null;
}

function aliasFor(i: number): string {
  return `r${i}`;
}

function buildQuery(names: readonly string[]): string {
  const parts = names.map((n, i) => {
    const [owner, name] = n.split("/") as [string, string];
    return `${aliasFor(i)}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { ...RepoFields }`;
  });
  return `
    query KinlyEnrich {
      ${parts.join("\n")}
    }
    fragment RepoFields on Repository {
      nameWithOwner description stargazerCount forkCount createdAt pushedAt isArchived homepageUrl
      primaryLanguage { name }
      licenseInfo { spdxId name }
      repositoryTopics(first: 20) { nodes { topic { name } } }
      latestRelease { tagName publishedAt }
      readme: object(expression: "HEAD:README.md") { ... on Blob { text } }
      readmeLower: object(expression: "HEAD:readme.md") { ... on Blob { text } }
      readmeRst: object(expression: "HEAD:README.rst") { ... on Blob { text } }
      licenseFile: object(expression: "HEAD:LICENSE") { ... on Blob { text } }
      ee: object(expression: "HEAD:ee") { __typename }
      enterprise: object(expression: "HEAD:enterprise") { __typename }
    }
  `;
}

function readmeExcerpt(text: string | null | undefined): { excerpt: string | null; hash: string | null } {
  if (!text) return { excerpt: null, hash: null };
  const cleaned = text
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/<img[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { excerpt: truncate(cleaned, README_EXCERPT_CHARS), hash: sha256(cleaned.slice(0, 20_000)) };
}

function fromGql(r: GqlRepo, requested: string): RepoMeta {
  const [owner, name] = r.nameWithOwner.split("/") as [string, string];
  const readme = r.readme?.text ?? r.readmeLower?.text ?? r.readmeRst?.text ?? null;
  const { excerpt, hash } = readmeExcerpt(readme);
  const licenseText = r.licenseFile?.text ?? null;
  const spdx = r.licenseInfo?.spdxId ?? null;
  const lic = classifyLicense(spdx, licenseText);
  const openCore = Boolean(r.ee || r.enterprise) || /\.ee\.|\/ee\//.test(readme ?? "") === true && lic.license_class === "source-available";
  return {
    full_name: r.nameWithOwner || requested,
    owner,
    name,
    description: r.description ? squash(r.description) : null,
    language: r.primaryLanguage?.name ?? null,
    topics: r.repositoryTopics.nodes.map((n) => n.topic.name),
    stars: r.stargazerCount,
    forks: r.forkCount,
    created_at: r.createdAt,
    pushed_at: r.pushedAt,
    license_spdx: spdx && spdx !== "NOASSERTION" ? spdx : lic.note,
    license_class: lic.license_class,
    open_core: openCore,
    archived: r.isArchived,
    homepage: r.homepageUrl || null,
    latest_release: r.latestRelease?.tagName ?? null,
    latest_release_at: r.latestRelease?.publishedAt ?? null,
    readme_excerpt: excerpt,
    readme_hash: hash,
    enriched_at: isoNow(),
  };
}

interface RestRepo {
  full_name: string;
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  created_at: string;
  pushed_at: string | null;
  archived: boolean;
  homepage: string | null;
  language: string | null;
  topics?: string[];
  license: { spdx_id: string | null; key: string } | null;
}

async function enrichOneRest(client: GitHubClient, fullName: string): Promise<RepoMeta | null> {
  const repo = await client.rest<RestRepo>(`/repos/${fullName}`, {}, { allow404: true });
  if (!repo) return null;
  let readme: string | null = null;
  if (client.budget() > 1) {
    try {
      const rd = await client.rest<{ content?: string; encoding?: string }>(`/repos/${fullName}/readme`, {}, { allow404: true });
      if (rd?.content && rd.encoding === "base64") readme = Buffer.from(rd.content, "base64").toString("utf8");
    } catch (err) {
      if (!(err instanceof GitHubHttpError)) throw err;
    }
  }
  const { excerpt, hash } = readmeExcerpt(readme);
  const spdx = repo.license?.spdx_id ?? null;
  const lic = classifyLicense(spdx, null);
  const [owner, name] = repo.full_name.split("/") as [string, string];
  return {
    full_name: repo.full_name,
    owner,
    name,
    description: repo.description ? squash(repo.description) : null,
    language: repo.language,
    topics: repo.topics ?? [],
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    created_at: repo.created_at,
    pushed_at: repo.pushed_at,
    license_spdx: spdx && spdx !== "NOASSERTION" ? spdx : null,
    license_class: lic.license_class,
    open_core: false,
    archived: repo.archived,
    homepage: repo.homepage || null,
    latest_release: null,
    latest_release_at: null,
    readme_excerpt: excerpt,
    readme_hash: hash,
    enriched_at: isoNow(),
  };
}

export async function enrichRepos(client: GitHubClient, names: readonly string[], options: { log?: (m: string) => void } = {}): Promise<EnrichResult> {
  const log = options.log ?? (() => undefined);
  const result: EnrichResult = { found: [], missing: [], skipped: [], errors: [] };
  const unique = [...new Set(names)];
  if (client.authenticated) {
    for (let i = 0; i < unique.length; i += GRAPHQL_BATCH) {
      const batch = unique.slice(i, i + GRAPHQL_BATCH);
      if (client.budget("graphql") < 1) {
        result.skipped.push(...unique.slice(i));
        break;
      }
      try {
        const data = await client.graphql<Record<string, GqlRepo | null>>(buildQuery(batch));
        batch.forEach((n, j) => {
          const r = data[aliasFor(j)];
          if (r) result.found.push(fromGql(r, n));
          else result.missing.push(n);
        });
        log(`enriched ${Math.min(i + GRAPHQL_BATCH, unique.length)}/${unique.length} (graphql)`);
      } catch (err) {
        if (err instanceof RateLimitExhausted) {
          result.skipped.push(...unique.slice(i));
          break;
        }
        // One bad name can poison a batch; fall back to one-by-one via REST for this batch.
        for (const n of batch) {
          try {
            const meta = await enrichOneRest(client, n);
            if (meta) result.found.push(meta);
            else result.missing.push(n);
          } catch (e2) {
            if (e2 instanceof RateLimitExhausted) {
              result.skipped.push(n);
              continue;
            }
            result.errors.push({ full_name: n, error: e2 instanceof Error ? e2.message : String(e2) });
          }
        }
      }
    }
    return result;
  }
  for (const n of unique) {
    if (client.budget() < 2) {
      result.skipped.push(n);
      continue;
    }
    try {
      const meta = await enrichOneRest(client, n);
      if (meta) result.found.push(meta);
      else result.missing.push(n);
    } catch (err) {
      if (err instanceof RateLimitExhausted) {
        result.skipped.push(n);
        continue;
      }
      result.errors.push({ full_name: n, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return result;
}
