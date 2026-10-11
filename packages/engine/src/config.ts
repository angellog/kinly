import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { envInt, loadEnv, resolveGitHubTokenWithSource } from "./util/env.js";

/**
 * Runtime configuration, resolved once. Paths default to the repository that
 * contains this package so `kinly` works from any cwd inside the checkout
 * and from /app on Railway.
 */

export interface KinlyConfig {
  /** The code checkout (angellog/kinly). */
  root: string;
  /**
   * The data checkout (angellog/kinly-data): holds data/, reports/ and
   * resources/, and is what `publish` mirrors. Defaults to the code root so a
   * single checkout still works; set KINLY_DATA_ROOT (relative to root or
   * absolute) to point at a separate checkout.
   */
  dataRoot: string;
  dataDir: string;
  reportsDir: string;
  resourcesDir: string;
  dbPath: string;
  githubToken: string | null;
  /** `gh` means the owner's full-scope CLI token: usable for reads, refused for publishing unless asked for by hand. */
  githubTokenSource: "env" | "gh" | null;
  anthropicKey: string | null;
  llmModel: string;
  llmDailyCap: number;
  apiToken: string | null;
  dataRepo: string;
  dataBranch: string;
  port: number;
}

function findRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 8; i++) {
    const pkg = path.join(dir, "package.json");
    if (existsSync(pkg)) {
      try {
        const parsed = JSON.parse(readFileSync(pkg, "utf8")) as { name?: string };
        if (parsed.name === "kinly") return dir;
      } catch {
        // keep walking
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return start;
}

export function resolveRoot(): string {
  if (process.env["KINLY_ROOT"]) return path.resolve(process.env["KINLY_ROOT"]);
  const here = path.dirname(fileURLToPath(import.meta.url));
  const fromModule = findRoot(here);
  if (fromModule !== here) return fromModule;
  return findRoot(process.cwd());
}

export function loadConfig(overrides: Partial<KinlyConfig> = {}): KinlyConfig {
  const root = overrides.root ?? resolveRoot();
  loadEnv(path.join(root, ".env"));
  const dataRoot = overrides.dataRoot ?? (process.env["KINLY_DATA_ROOT"] ? path.resolve(root, process.env["KINLY_DATA_ROOT"]) : root);
  const dataDir = overrides.dataDir ?? (process.env["KINLY_DATA_DIR"] ? path.resolve(root, process.env["KINLY_DATA_DIR"]) : path.join(dataRoot, "data"));
  const tok = overrides.githubToken !== undefined ? { token: overrides.githubToken, source: overrides.githubTokenSource ?? (overrides.githubToken ? "env" : null) } : resolveGitHubTokenWithSource();
  return {
    root,
    dataRoot,
    dataDir,
    reportsDir: overrides.reportsDir ?? path.join(dataRoot, "reports"),
    resourcesDir: overrides.resourcesDir ?? path.join(dataRoot, "resources"),
    dbPath: overrides.dbPath ?? (process.env["KINLY_DB"] ? path.resolve(root, process.env["KINLY_DB"]) : path.join(root, ".kinly", "kinly.db")),
    githubToken: tok.token,
    githubTokenSource: tok.source,
    anthropicKey: overrides.anthropicKey !== undefined ? overrides.anthropicKey : (process.env["ANTHROPIC_API_KEY"]?.trim() || null),
    llmModel: overrides.llmModel ?? process.env["KINLY_LLM_MODEL"] ?? "claude-opus-5-5",
    llmDailyCap: overrides.llmDailyCap ?? envInt("KINLY_LLM_DAILY_CAP", 400_000),
    apiToken: overrides.apiToken !== undefined ? overrides.apiToken : (process.env["KINLY_API_TOKEN"]?.trim() || null),
    dataRepo: overrides.dataRepo ?? process.env["KINLY_DATA_REPO"] ?? "angellog/kinly-data",
    dataBranch: overrides.dataBranch ?? process.env["KINLY_DATA_BRANCH"] ?? "main",
    port: overrides.port ?? envInt("PORT", 8787),
  };
}
