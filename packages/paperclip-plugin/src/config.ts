/**
 * Per-company configuration for vantik.kinly. The host stores one config row
 * per company, validated against CONFIG_SCHEMA; this module turns that row
 * into something the worker can trust.
 */

export interface SecretRef {
  type: "secret_ref";
  secretId: string;
  version?: number | "latest";
}

export interface KinlyCompanyConfig {
  enabled: boolean;
  apiUrl: string;
  /** Bearer token for writes, as a Paperclip secret reference (review R4). Reads need no token. */
  apiTokenRef: SecretRef | null;
  dailyBrief: boolean;
  briefAssigneeAgentId: string | null;
  /** Which business this company's picks are for, shown in the brief and passed to research prompts. */
  focus: string;
}

/** The Railway service. Updated at deploy time; every company may override it. */
export const DEFAULT_API_URL = "https://kinly-api-production.up.railway.app";

export const CONFIG_SCHEMA = {
  type: "object",
  properties: {
    enabled: { type: "boolean", title: "Enabled in this company", default: true },
    apiUrl: { type: "string", title: "Kinly API URL", description: "The Kinly service on Railway.", default: DEFAULT_API_URL },
    apiTokenRef: {
      type: "object",
      format: "secret-ref",
      title: "Kinly API token (secret)",
      description: "A company secret holding KINLY_API_TOKEN. Needed for shortlisting, rating, resource pages, ask and research. Reading works without it.",
    },
    dailyBrief: { type: "boolean", title: "Post a daily brief issue", description: "At 07:00 UTC, upsert one issue per day with the Kinly daily report.", default: false },
    briefAssigneeAgentId: { type: "string", title: "Brief assignee (agent id)", description: "Optional. Leave empty to leave the brief unassigned.", "x-paperclip-advanced": true },
    focus: { type: "string", title: "Business focus", description: "Vantik Systems, FeetBit, or both.", default: "Vantik Systems and FeetBit", "x-paperclip-advanced": true },
  },
  additionalProperties: false,
} as const;

function isSecretRef(v: unknown): v is SecretRef {
  return !!v && typeof v === "object" && (v as { type?: unknown }).type === "secret_ref" && typeof (v as { secretId?: unknown }).secretId === "string";
}

/** An https URL, or http on loopback for local development; anything else falls back to the default. */
export function normalizeApiUrl(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) return DEFAULT_API_URL;
  try {
    const u = new URL(raw.trim());
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
    if (u.protocol !== "https:" && !(u.protocol === "http:" && loopback)) return DEFAULT_API_URL;
    if (u.username || u.password) return DEFAULT_API_URL;
    return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return DEFAULT_API_URL;
  }
}

export function parseConfig(raw: Record<string, unknown> | null | undefined): KinlyCompanyConfig {
  const r = raw ?? {};
  const assignee = typeof r["briefAssigneeAgentId"] === "string" && /^[0-9a-f-]{36}$/i.test(r["briefAssigneeAgentId"]) ? r["briefAssigneeAgentId"] : null;
  return {
    enabled: r["enabled"] !== false,
    apiUrl: normalizeApiUrl(r["apiUrl"]),
    apiTokenRef: isSecretRef(r["apiTokenRef"]) ? r["apiTokenRef"] : null,
    dailyBrief: r["dailyBrief"] === true,
    briefAssigneeAgentId: assignee,
    focus: typeof r["focus"] === "string" && r["focus"].trim() ? r["focus"].trim().slice(0, 200) : "Vantik Systems and FeetBit",
  };
}
