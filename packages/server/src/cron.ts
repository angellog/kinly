/**
 * A five-field cron matcher in UTC: minute hour day-of-month month day-of-week.
 * Supports `*`, numbers, lists (`1,15`), ranges (`1-5`) and steps (`* /10`,
 * `0-30/5`). Day-of-week 0 and 7 are Sunday. When both day fields are
 * restricted, either may match (classic cron semantics).
 */

export interface CronSpec {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
  domRestricted: boolean;
  dowRestricted: boolean;
  source: string;
}

function parseField(field: string, min: number, max: number): Set<number> {
  const out = new Set<number>();
  for (const part of field.split(",")) {
    const [rangePart, stepPart] = part.split("/") as [string, string | undefined];
    const step = stepPart === undefined ? 1 : Number.parseInt(stepPart, 10);
    if (!Number.isInteger(step) || step < 1) throw new Error(`bad step in "${field}"`);
    let lo: number;
    let hi: number;
    if (rangePart === "*") {
      lo = min;
      hi = max;
    } else if (rangePart.includes("-")) {
      const [a, b] = rangePart.split("-");
      lo = Number.parseInt(a ?? "", 10);
      hi = Number.parseInt(b ?? "", 10);
    } else {
      lo = Number.parseInt(rangePart, 10);
      hi = stepPart === undefined ? lo : max;
    }
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < min || hi > max || lo > hi) throw new Error(`out of range in "${field}" (${min}-${max})`);
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

export function parseCron(expr: string): CronSpec {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error(`cron needs 5 fields, got ${fields.length}: "${expr}"`);
  const [mi, ho, dm, mo, dw] = fields as [string, string, string, string, string];
  const dow = parseField(dw, 0, 7);
  if (dow.has(7)) {
    dow.delete(7);
    dow.add(0);
  }
  return {
    minute: parseField(mi, 0, 59),
    hour: parseField(ho, 0, 23),
    dom: parseField(dm, 1, 31),
    month: parseField(mo, 1, 12),
    dow,
    domRestricted: dm !== "*",
    dowRestricted: dw !== "*",
    source: expr,
  };
}

export function cronMatches(spec: CronSpec, at: Date): boolean {
  if (!spec.minute.has(at.getUTCMinutes()) || !spec.hour.has(at.getUTCHours()) || !spec.month.has(at.getUTCMonth() + 1)) return false;
  const domOk = spec.dom.has(at.getUTCDate());
  const dowOk = spec.dow.has(at.getUTCDay());
  if (spec.domRestricted && spec.dowRestricted) return domOk || dowOk;
  return domOk && dowOk;
}

/** The first minute at or after `from` that matches, searching up to `days` ahead. */
export function nextFire(spec: CronSpec, from: Date, days = 366): Date | null {
  const t = new Date(from);
  t.setUTCSeconds(0, 0);
  const end = from.getTime() + days * 86_400_000;
  while (t.getTime() <= end) {
    if (cronMatches(spec, t)) return t;
    t.setUTCMinutes(t.getUTCMinutes() + 1);
  }
  return null;
}

/** The most recent minute at or before `at` that matched, searching back up to `days`. */
export function lastFire(spec: CronSpec, at: Date, days = 8): Date | null {
  const t = new Date(at);
  t.setUTCSeconds(0, 0);
  const end = at.getTime() - days * 86_400_000;
  while (t.getTime() >= end) {
    if (cronMatches(spec, t)) return t;
    t.setUTCMinutes(t.getUTCMinutes() - 1);
  }
  return null;
}
