// Configure vantik.kinly in every company of the local Paperclip instance (E6):
//   1. a company secret "KINLY_API_TOKEN" holding the Kinly API token (read from ../../.env, never printed),
//   2. the plugin config: enabled, apiUrl, apiTokenRef → that secret, dailyBrief off.
// Board-only: run on the machine that hosts Paperclip (local_trusted). Idempotent.
// Usage: node scripts/configure-companies.mjs [--api-url https://…] [--brief VAN,GST]
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const host = process.env.PAPERCLIP_URL ?? "http://127.0.0.1:3100";
const args = process.argv.slice(2);
const flag = (k) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const apiUrl = flag("--api-url") ?? "https://kinly-api-production.up.railway.app";
const brief = new Set((flag("--brief") ?? "").split(",").filter(Boolean));

const env = readFileSync(path.resolve(here, "../../../.env"), "utf8");
const token = /^KINLY_API_TOKEN=(.+)$/m.exec(env)?.[1]?.trim();
if (!token) throw new Error("KINLY_API_TOKEN missing from the repo .env");

async function api(method, p, body) {
  const res = await fetch(`${host}/api${p}`, { method, headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${p} → ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

const list = (x, k) => (Array.isArray(x) ? x : (x?.[k] ?? []));
const plugins = list(await api("GET", "/plugins"), "plugins");
const plugin = plugins.find((p) => p.pluginKey === "vantik.kinly");
if (!plugin) throw new Error("vantik.kinly is not installed");

for (const company of list(await api("GET", "/companies"), "companies")) {
  const prefix = company.issuePrefix ?? company.prefix ?? company.name;
  const secrets = list(await api("GET", `/companies/${company.id}/secrets`), "secrets");
  let secret = secrets.find((s) => s.key === "KINLY_API_TOKEN" || s.name === "KINLY_API_TOKEN");
  if (!secret) secret = await api("POST", `/companies/${company.id}/secrets`, { name: "KINLY_API_TOKEN", key: "KINLY_API_TOKEN", value: token, description: "Bearer token for the Kinly API (Project Kinly, Vantik Systems). Used by the vantik.kinly plugin for writes." });
  const configJson = { enabled: true, apiUrl, apiTokenRef: { type: "secret_ref", secretId: secret.id, version: "latest" }, dailyBrief: brief.has(prefix), focus: prefix === "FEE" || prefix === "FEEA" ? "FeetBit" : "Vantik Systems and FeetBit" };
  await api("POST", `/plugins/${plugin.id}/config`, { companyId: company.id, configJson });
  console.log(`${prefix}: secret ${secret.id.slice(0, 8)}…, config saved (brief ${configJson.dailyBrief ? "on" : "off"})`);
}
