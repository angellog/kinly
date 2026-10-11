import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Snapshot, SourceId } from "../types.js";
import { SOURCE_IDS } from "../types.js";
import { isIsoDate } from "../util/dates.js";

/**
 * The on-disk archive under data/snapshots:
 *   data/snapshots/<source>/<YYYY-MM>/<YYYY-MM-DD>.json
 * One file per source per day, holding every list observed that day. This is
 * what the public repo commits and what a fresh database is rebuilt from.
 */

export interface SnapshotFile {
  source: SourceId;
  list_date: string;
  written_at: string;
  lists: Snapshot[];
}

export function snapshotFilePath(root: string, source: SourceId, date: string): string {
  return path.join(root, "snapshots", source, date.slice(0, 7), `${date}.json`);
}

/** Write (merge) lists into the day file. Existing lists with the same window+language are replaced. */
export function writeSnapshotFile(root: string, source: SourceId, date: string, lists: Snapshot[]): string {
  const file = snapshotFilePath(root, source, date);
  mkdirSync(path.dirname(file), { recursive: true });
  let existing: SnapshotFile | null = null;
  if (existsSync(file)) {
    try {
      existing = JSON.parse(readFileSync(file, "utf8")) as SnapshotFile;
    } catch {
      existing = null;
    }
  }
  const merged = new Map<string, Snapshot>();
  for (const s of existing?.lists ?? []) merged.set(`${s.window}:${s.language_list}`, s);
  for (const s of lists) merged.set(`${s.window}:${s.language_list}`, s);
  const out: SnapshotFile = {
    source,
    list_date: date,
    written_at: new Date().toISOString(),
    lists: [...merged.values()].sort((a, b) => `${a.window}:${a.language_list}`.localeCompare(`${b.window}:${b.language_list}`)),
  };
  writeFileSync(file, `${JSON.stringify(out, null, 0)}\n`);
  return file;
}

export function readSnapshotFile(file: string): SnapshotFile | null {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as SnapshotFile;
    if (!parsed || !Array.isArray(parsed.lists) || !isIsoDate(parsed.list_date)) return null;
    if (!SOURCE_IDS.includes(parsed.source)) return null;
    // A snapshot from the public repo is input from the internet (R1): keep only well-formed lists of the file's own source and date.
    const lists = parsed.lists.filter(
      (l) => l && l.source === parsed.source && l.list_date === parsed.list_date && ["daily", "weekly", "monthly"].includes(l.window) && typeof l.language_list === "string" && l.language_list.length <= 40 && Array.isArray(l.entries) && l.entries.length <= 500,
    );
    return { ...parsed, lists };
  } catch {
    return null;
  }
}

/** Every snapshot file under data/snapshots, oldest first. */
export function listSnapshotFiles(root: string, source?: SourceId): Array<{ source: SourceId; date: string; file: string }> {
  const base = path.join(root, "snapshots");
  if (!existsSync(base)) return [];
  const out: Array<{ source: SourceId; date: string; file: string }> = [];
  for (const src of readdirSync(base)) {
    if (!SOURCE_IDS.includes(src as SourceId)) continue;
    if (source && src !== source) continue;
    const srcDir = path.join(base, src);
    for (const month of readdirSync(srcDir)) {
      const monthDir = path.join(srcDir, month);
      let files: string[] = [];
      try {
        files = readdirSync(monthDir);
      } catch {
        continue;
      }
      for (const f of files) {
        const date = f.replace(/\.json$/, "");
        if (!isIsoDate(date)) continue;
        out.push({ source: src as SourceId, date, file: path.join(monthDir, f) });
      }
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.source.localeCompare(b.source));
}
