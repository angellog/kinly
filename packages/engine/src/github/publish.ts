import { createHash } from "node:crypto";
import type { GitHubClient } from "./client.js";

/**
 * Commit files into a GitHub repository with the Git Data API in one commit:
 * blobs → tree (on top of the branch head) → commit → ref update. Needs a
 * token with `contents: write` on that repository. Idempotent in effect: a
 * file whose content is unchanged is skipped, and an empty change set
 * produces no commit.
 */

export interface PublishFile {
  path: string;
  content: string;
}

export interface PublishResult {
  committed: boolean;
  sha: string | null;
  changed: string[];
  skipped: string[];
  url: string | null;
}

interface RefResponse {
  object: { sha: string };
}
interface CommitResponse {
  sha: string;
  tree: { sha: string };
  html_url?: string;
}
interface TreeResponse {
  sha: string;
  tree: Array<{ path: string; sha: string; type: string }>;
  truncated?: boolean;
}

export async function publishFiles(
  client: GitHubClient,
  repo: string,
  branch: string,
  files: readonly PublishFile[],
  message: string,
  options: { log?: (m: string) => void } = {},
): Promise<PublishResult> {
  const log = options.log ?? (() => undefined);
  if (!client.authenticated) throw new Error("publishFiles requires a GitHub token");
  if (files.length === 0) return { committed: false, sha: null, changed: [], skipped: [], url: null };
  const ref = await client.rest<RefResponse>(`/repos/${repo}/git/ref/heads/${branch}`);
  if (!ref) throw new Error(`branch ${branch} not found on ${repo}`);
  const headSha = ref.object.sha;
  const head = await client.rest<CommitResponse>(`/repos/${repo}/git/commits/${headSha}`);
  if (!head) throw new Error("head commit not found");

  // Compare against the existing tree so unchanged files are skipped.
  const existing = await client.rest<TreeResponse>(`/repos/${repo}/git/trees/${head.tree.sha}`, { recursive: 1 });
  const existingSha = new Map<string, string>();
  if (existing && !existing.truncated) for (const e of existing.tree) if (e.type === "blob") existingSha.set(e.path, e.sha);

  const treeEntries: Array<{ path: string; mode: "100644"; type: "blob"; sha: string }> = [];
  const changed: string[] = [];
  const skipped: string[] = [];
  for (const f of files) {
    const blobSha = gitBlobSha(f.content);
    if (existingSha.get(f.path) === blobSha) {
      skipped.push(f.path);
      continue;
    }
    const created = await restPost<{ sha: string }>(client, `/repos/${repo}/git/blobs`, { content: f.content, encoding: "utf-8" });
    treeEntries.push({ path: f.path, mode: "100644", type: "blob", sha: created.sha });
    changed.push(f.path);
  }
  if (treeEntries.length === 0) {
    log("publish: nothing changed");
    return { committed: false, sha: headSha, changed, skipped, url: null };
  }
  const tree = await restPost<{ sha: string }>(client, `/repos/${repo}/git/trees`, { base_tree: head.tree.sha, tree: treeEntries });
  const commit = await restPost<CommitResponse>(client, `/repos/${repo}/git/commits`, { message, tree: tree.sha, parents: [headSha] });
  await restPatch(client, `/repos/${repo}/git/refs/heads/${branch}`, { sha: commit.sha, force: false });
  log(`publish: committed ${changed.length} file(s) as ${commit.sha.slice(0, 7)}`);
  return { committed: true, sha: commit.sha, changed, skipped, url: commit.html_url ?? `https://github.com/${repo}/commit/${commit.sha}` };
}

/** SHA-1 of a git blob ("blob <len>\0<content>"), to compare against the tree without fetching blobs. */
export function gitBlobSha(content: string): string {
  const buf = Buffer.from(content, "utf8");
  return createHash("sha1").update(`blob ${buf.length}\0`).update(buf).digest("hex");
}

async function restPost<T>(client: GitHubClient, path: string, body: unknown): Promise<T> {
  return mutate<T>(client, "POST", path, body);
}

async function restPatch<T = unknown>(client: GitHubClient, path: string, body: unknown): Promise<T> {
  return mutate<T>(client, "PATCH", path, body);
}

async function mutate<T>(client: GitHubClient, method: "POST" | "PATCH" | "PUT", path: string, body: unknown): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${client.token}`,
      "content-type": "application/json",
      "user-agent": "KinlyBot/0.1 (+https://github.com/angellog/kinly)",
      "x-github-api-version": "2022-11-28",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub ${method} ${path} failed: ${res.status} ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}
