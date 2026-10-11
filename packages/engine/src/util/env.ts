import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

/**
 * Load KEY=VALUE pairs from a .env file into process.env without overriding
 * values that are already set. Lines starting with # are comments; values may
 * be quoted with single or double quotes; inline comments after an unquoted
 * value are stripped.
 */
export function loadEnv(file: string = path.resolve(process.cwd(), ".env")): Record<string, string> {
  const loaded: Record<string, string> = {};
  if (!existsSync(file)) return loaded;
  const text = readFileSync(file, "utf8");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      const hash = value.indexOf(" #");
      if (hash >= 0) value = value.slice(0, hash).trim();
    }
    // A pasted secret can carry invisible line/paragraph separators.
    value = value.replace(new RegExp("[\\u2028\\u2029\\u200b\\ufeff]", "g"), "").trim();
    if (!(key in process.env)) process.env[key] = value;
    loaded[key] = value;
  }
  return loaded;
}

/**
 * The GitHub token to use: GITHUB_TOKEN / GH_TOKEN from the environment, else
 * the local `gh auth token` when the gh CLI is installed and logged in. The
 * fallback is for local runs on the owner's machine; a server has no gh.
 */
export function resolveGitHubToken(): string | null {
  const fromEnv = process.env["GITHUB_TOKEN"] ?? process.env["GH_TOKEN"];
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  if (process.env["KINLY_NO_GH_FALLBACK"] === "1") return null;
  try {
    const out = execFileSync("gh", ["auth", "token"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 });
    const token = out.trim();
    return token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

export function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function envBool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return /^(1|true|yes|on)$/i.test(v);
}
