import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { envInt, loadEnv, resolveGitHubToken } from "./util/env.js";

/**
 * Runtime configuration, resolved once. Paths default to the repository that
 * contains this package so `kinly` works from any cwd inside the checkout
 * and from /app on Railway.
 */

export interface KinlyConfig {
  root: string;
  dataDir: string;
  reportsDir: string;
  resourcesDir: string;
  dbPath: string;
  githubToken: string | null;
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
  const dataDir = overrides.dataDir ?? (process.env["KINLY_DATA_DIR"] ? path.resolve(process.env["KINLY_DATA_DIR"]) : path.join(root, "data"));
  return {
    root,
    dataDir,
    reportsDir: overrides.reportsDir ?? path.join(root, "reports"),
    resourcesDir: overrides.resourcesDir ?? path.join(root, "resources"),
    dbPath: overrides.dbPath ?? (process.env["KINLY_DB"] ? path.resolve(process.env["KINLY_DB"]) : path.join(dataDir, "kinly.db")),
    githubToken: overrides.githubToken !== undefined ? overrides.githubToken : resolveGitHubToken(),
    anthropicKey: overrides.anthropicKey !== undefined ? overrides.anthropicKey : (process.env["ANTHROPIC_API_KEY"] ?? null),
    llmModel: overrides.llmModel ?? process.env["KINLY_LLM_MODEL"] ?? "claude-opus-5-5",
    llmDailyCap: overrides.llmDailyCap ?? envInt("KINLY_LLM_DAILY_CAP", 400_000),
    apiToken: overrides.apiToken !== undefined ? overrides.apiToken : (process.env["KINLY_API_TOKEN"] ?? null),
    dataRepo: overrides.dataRepo ?? process.env["KINLY_DATA_REPO"] ?? "angellog/kinly",
    dataBranch: overrides.dataBranch ?? process.env["KINLY_DATA_BRANCH"] ?? "main",
    port: overrides.port ?? envInt("PORT", 8787),
  };
}
