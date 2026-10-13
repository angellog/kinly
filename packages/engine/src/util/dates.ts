/** Date helpers. Everything in the engine is UTC and ISO-formatted. */

export function isoDate(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export function isoNow(): string {
  return new Date().toISOString();
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

export function daysBetween(a: string, b: string): number {
  const da = Date.parse(`${a.slice(0, 10)}T00:00:00Z`);
  const db = Date.parse(`${b.slice(0, 10)}T00:00:00Z`);
  return Math.round((db - da) / 86_400_000);
}

/** ISO-8601 week id, e.g. 2026-W41. */
export function isoWeek(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** The Monday (ISO) of the week that contains `date`. */
export function weekStart(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - (day - 1));
  return isoDate(d);
}

/** The Sunday that ends ISO week `id` (2026-W41 → 2026-10-11); null for a malformed or non-existent week. */
export function isoWeekEnd(id: string): string | null {
  const m = /^(\d{4})-W(\d{2})$/.exec(id);
  if (!m) return null;
  const monday = addDays(weekStart(`${m[1]}-01-04`), (Number(m[2]) - 1) * 7);
  return isoWeek(monday) === id ? addDays(monday, 6) : null;
}

/** First day of the month of `date`. */
export function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

/** Every ISO date from `from` to `to` inclusive. */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  while (cur <= to) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

export function isIsoDate(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
}

/** Age in days from an ISO timestamp to now (or to `at`). */
export function ageDays(iso: string | null, at: string = isoNow()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, (Date.parse(at) - t) / 86_400_000);
}
