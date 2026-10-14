import { createHash } from "node:crypto";

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Collapse whitespace and trim. */
export function squash(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

/** Decode the HTML entities GitHub's trending page uses. */
export function decodeEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number.parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

export function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

/** "4,655" -> 4655; "1.2k" -> 1200; returns null when nothing numeric is there. */
export function parseCount(text: string | null | undefined): number | null {
  if (!text) return null;
  const t = squash(stripTags(text)).toLowerCase().replace(/,/g, "");
  const m = /([\d.]+)\s*([km])?/.exec(t);
  if (!m || m[1] === undefined) return null;
  const n = Number.parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  if (m[2] === "k") return Math.round(n * 1_000);
  if (m[2] === "m") return Math.round(n * 1_000_000);
  return Math.round(n);
}

/** Truncate on a word boundary and add an ellipsis. */
export function truncate(text: string, max: number): string {
  const t = squash(text);
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${space > max * 0.6 ? cut.slice(0, space) : cut}…`;
}

/** owner/name validation as GitHub allows it. */
export const FULL_NAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9_.-]{1,100}$/;

export function isFullName(s: unknown): s is string {
  return typeof s === "string" && FULL_NAME_RE.test(s) && !s.endsWith(".git");
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Markdown table cell escaping. */
export function cell(text: string | number | null | undefined): string {
  if (text === null || text === undefined) return "—";
  return String(text).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

export function fmtInt(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US").format(Math.round(n));
}

// ─── untrusted third-party text (D15) ────────────────────────────────────────

// C0/C1 controls (keeping tab and newline), zero-width and bidi-override characters.
const CONTROL_RE = new RegExp("[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u2064\\u2066-\\u2069\\ufeff]", "g");

/**
 * Normalize a string that came from someone else's repository: decode
 * entities, drop tags and control/bidi characters, collapse whitespace, cap
 * the length. The result is plain text; renderers still escape it.
 */
export function cleanText(text: string | null | undefined, max: number, options: { multiline?: boolean } = {}): string | null {
  if (text === null || text === undefined) return null;
  let t = decodeEntities(String(text));
  t = t.replace(/<!--[\s\S]*?-->/g, " ").replace(/<\/?[a-z][^>]*>/gi, " ");
  t = t.replace(CONTROL_RE, "");
  t = options.multiline ? t.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim() : squash(t);
  if (t.length === 0) return null;
  if (t.length <= max) return t;
  // Cut on a word boundary when one is reasonably close, never mid-word (H14).
  const cut = t.slice(0, max - 1);
  const space = Math.max(cut.lastIndexOf(" "), cut.lastIndexOf("\n"));
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** An http(s) URL or null; anything else (javascript:, data:, relative) is dropped. */
export function cleanUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const t = url.trim();
  try {
    const u = new URL(t);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString().slice(0, 300) : null;
  } catch {
    return null;
  }
}

/** GitHub topic syntax only: lowercase letters, digits, hyphens; at most 30 topics of 50 chars. */
export function cleanTopics(topics: readonly string[] | null | undefined): string[] {
  const out: string[] = [];
  for (const t of topics ?? []) {
    const v = String(t).toLowerCase().trim();
    if (/^[a-z0-9][a-z0-9-]{0,49}$/.test(v) && !out.includes(v)) out.push(v);
    if (out.length >= 30) break;
  }
  return out;
}

// Token-shaped strings that must never reach a public page or repo (review G1-sec4).
const SECRET_RE = /\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-ant-[A-Za-z0-9_-]{16,}|sk-[A-Za-z0-9]{20,}|ak_[A-Za-z0-9]{16,}|xox[abp]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b|\b([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD))\s*[=:]\s*\S+|-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g;

export function redactSecrets(text: string | null | undefined): string | null {
  if (text === null || text === undefined) return null;
  return text.replace(SECRET_RE, (m, _tok, name) => (name ? `${name}=[redacted]` : "[redacted]"));
}

/** Escape markdown so third-party text renders as text: no links, images, emphasis or headings (review G1-sec6). */
export function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_{}\[\]()#+!<>|~]/g, (c) => `\\${c}`);
}
