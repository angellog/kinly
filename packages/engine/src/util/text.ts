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
