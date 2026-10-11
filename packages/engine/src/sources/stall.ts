import type { Snapshot } from "../types.js";

/**
 * A daily trending list that is identical, name for name and in order, to
 * the previous day's is not news: GitHub's list has stalled (it happens
 * while the page is being rebuilt). Stalled lists earn no persistence credit
 * and are named in the report footer (review E-M4b).
 *
 * Only daily lists are judged: a weekly or monthly list can legitimately
 * repeat from one day to the next.
 */
export function listKey(s: Pick<Snapshot, "window" | "language_list">): string {
  return `${s.window}/${s.language_list}`;
}

export function detectStalls(today: readonly Snapshot[], yesterday: readonly Snapshot[]): string[] {
  const prev = new Map(yesterday.filter((s) => s.window === "daily").map((s) => [listKey(s), s.entries.map((e) => e.full_name).join("\n")] as const));
  const stalled: string[] = [];
  for (const s of today) {
    if (s.window !== "daily" || s.entries.length < 3) continue;
    const before = prev.get(listKey(s));
    if (before !== undefined && before === s.entries.map((e) => e.full_name).join("\n")) stalled.push(listKey(s));
  }
  return stalled.sort();
}
