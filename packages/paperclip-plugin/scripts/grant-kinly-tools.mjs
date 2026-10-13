// Give the managed Kinly agent its vantik.kinly:* tools in every company of the local Paperclip instance (H3).
//
// Paperclip denies plugin tools to agents by default: an agent can call a plugin tool only when an access profile
// assigned to it allows that tool by its exact name (profile entries match `tool_name` by equality, so a wildcard
// such as `vantik.kinly:*` matches nothing). This script keeps one profile per company, "Kinly tools", that allows
// exactly the plugin's declared tools, and assigns it to the plugin-managed Kinly agent only.
//
// Board-only: run on the machine that hosts Paperclip (local_trusted). Idempotent; a second run changes nothing.
// Usage: node scripts/grant-kinly-tools.mjs [--check]     (--check reads and reports, never writes)
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const PLUGIN_KEY = "vantik.kinly";
export const PROFILE_KEY = "kinly-tools";
export const PROFILE_NAME = "Kinly tools";
const DESCRIPTION = "Lets the Kinly researcher call the vantik.kinly:* plugin tools. Nothing else.";

/** The exact tool names an agent calls, e.g. vantik.kinly:trending. */
export function toolNames(manifest) {
  return (manifest.tools ?? []).map((t) => `${PLUGIN_KEY}:${t.name}`).sort();
}

/** The agent this plugin manages in a company (matched by its managed-resource record, never by display name). */
export function isKinlyAgent(agent) {
  const r = agent?.metadata?.paperclipManagedResource;
  return r?.pluginKey === PLUGIN_KEY && r?.resourceKind === "agent" && r?.resourceKey === "kinly";
}

/**
 * What to do in one company, given its profiles, the Kinly agent and the profile's current agent bindings.
 * Returns { profile: "create" | "update" | "ok", bind: boolean, entries }.
 */
export function plan({ profiles, names, agentId, boundAgentIds = [] }) {
  const entries = names.map((toolName) => ({ selectorType: "tool_name", effect: "include", toolName }));
  const existing = profiles.find((p) => p.profileKey === PROFILE_KEY || p.name === PROFILE_NAME) ?? null;
  if (!existing) return { profile: "create", bind: true, entries, profileId: null };
  const have = (existing.entries ?? [])
    .filter((e) => e.selectorType === "tool_name" && e.effect === "include")
    .map((e) => e.toolName)
    .sort();
  const extra = (existing.entries ?? []).some((e) => e.selectorType !== "tool_name" || e.effect !== "include");
  const same = !extra && have.length === names.length && have.every((n, i) => n === names[i]);
  const current = same && existing.status === "active" && existing.defaultAction === "deny";
  return { profile: current ? "ok" : "update", bind: !boundAgentIds.includes(agentId), entries, profileId: existing.id };
}

async function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const host = process.env.PAPERCLIP_URL ?? "http://127.0.0.1:3100";
  const check = process.argv.includes("--check");
  const { default: manifest } = await import(pathToFileURL(path.resolve(here, "../dist/manifest.js")).href);
  const names = toolNames(manifest);

  const api = async (method, p, body) => {
    const res = await fetch(`${host}/api${p}`, { method, headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${p} → ${res.status} ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  };
  const list = (x, k) => (Array.isArray(x) ? x : (x?.[k] ?? []));
  const decide = async (companyId, agentId, toolName) =>
    (await api("POST", `/companies/${companyId}/tools/policy/test`, {
      companyId,
      actor: { actorType: "agent", actorId: agentId, agentId },
      request: { toolName, providerType: "paperclip_plugin", riskLevel: "read" },
    })).decision.decision;

  let failed = false;
  for (const company of list(await api("GET", "/companies"), "companies")) {
    const prefix = company.issuePrefix ?? company.name;
    const agent = list(await api("GET", `/companies/${company.id}/agents`), "agents").find(isKinlyAgent);
    if (!agent) {
      console.log(`${prefix}: no managed Kinly agent (plugin not enabled here?) — skipped`);
      continue;
    }
    const profiles = list(await api("GET", `/companies/${company.id}/tools/profiles`), "profiles");
    const existing = profiles.find((p) => p.profileKey === PROFILE_KEY || p.name === PROFILE_NAME);
    let bound = [];
    if (existing) {
      const eff = await api("GET", `/companies/${company.id}/tools/profiles/effective/agents/${agent.id}`);
      if ((eff?.profiles ?? []).some((p) => p.id === existing.id)) bound = [agent.id];
    }
    const step = plan({ profiles, names, agentId: agent.id, boundAgentIds: bound });
    if (!check) {
      let profileId = step.profileId;
      if (step.profile === "create") {
        const r = await api("POST", `/companies/${company.id}/tools/profiles`, { profileKey: PROFILE_KEY, name: PROFILE_NAME, description: DESCRIPTION, status: "active", defaultAction: "deny", entries: step.entries });
        profileId = (r?.profile ?? r).id;
      } else if (step.profile === "update") {
        await api("PATCH", `/tool-profiles/${profileId}`, { description: DESCRIPTION, status: "active", defaultAction: "deny", entries: step.entries });
      }
      if (step.bind) await api("POST", `/companies/${company.id}/tools/profiles/${profileId}/bind`, { targetType: "agent", targetId: agent.id });
    }
    const results = await Promise.all(names.map(async (n) => [n, await decide(company.id, agent.id, n)]));
    const denied = results.filter(([, d]) => d !== "allow").map(([n, d]) => `${n}=${d}`);
    const did = check ? `would ${step.profile === "ok" ? "keep" : step.profile} profile${step.bind ? " + assign" : ""}` : `profile ${step.profile}${step.bind ? " + assigned" : ""}`;
    console.log(`${prefix}: ${did}; Kinly ${denied.length ? `DENIED ${denied.join(", ")}` : `allowed all ${names.length}`}`);
    if (denied.length && !check) failed = true;
  }
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
