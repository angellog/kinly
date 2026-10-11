/**
 * SQLite schema. Migrations are append-only: add a new entry, never edit an
 * applied one. `schema_version` in `meta` records the last applied index.
 */
export const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS repos (
    full_name         TEXT PRIMARY KEY,
    owner             TEXT NOT NULL,
    name              TEXT NOT NULL,
    description       TEXT,
    language          TEXT,
    topics            TEXT NOT NULL DEFAULT '[]',
    stars             INTEGER,
    forks             INTEGER,
    created_at        TEXT,
    pushed_at         TEXT,
    license_spdx      TEXT,
    license_class     TEXT NOT NULL DEFAULT 'unknown',
    open_core         INTEGER NOT NULL DEFAULT 0,
    archived          INTEGER NOT NULL DEFAULT 0,
    homepage          TEXT,
    latest_release    TEXT,
    latest_release_at TEXT,
    readme_excerpt    TEXT,
    readme_hash       TEXT,
    summary           TEXT,
    business_use      TEXT,
    summary_source    TEXT,
    summary_hash      TEXT,
    category          TEXT NOT NULL DEFAULT 'other',
    category_source   TEXT NOT NULL DEFAULT 'rule',
    enriched_at       TEXT,
    summary_at        TEXT
  );
  CREATE TABLE IF NOT EXISTS appearances (
    id            INTEGER PRIMARY KEY,
    full_name     TEXT NOT NULL,
    source        TEXT NOT NULL,
    window        TEXT NOT NULL,
    list_date     TEXT NOT NULL,
    language_list TEXT NOT NULL,
    rank          INTEGER NOT NULL,
    stars_period  INTEGER,
    stars_total   INTEGER,
    UNIQUE (full_name, source, window, list_date, language_list)
  );
  CREATE INDEX IF NOT EXISTS idx_appearances_date ON appearances (list_date);
  CREATE INDEX IF NOT EXISTS idx_appearances_name ON appearances (full_name);
  CREATE INDEX IF NOT EXISTS idx_appearances_window_date ON appearances (window, list_date);
  CREATE TABLE IF NOT EXISTS star_history (
    full_name   TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    stars       INTEGER NOT NULL,
    PRIMARY KEY (full_name, observed_at)
  );
  CREATE TABLE IF NOT EXISTS user_stars (
    full_name  TEXT PRIMARY KEY,
    starred_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS shortlist (
    full_name  TEXT PRIMARY KEY,
    status     TEXT NOT NULL,
    note       TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ratings (
    full_name        TEXT PRIMARY KEY,
    rating           INTEGER NOT NULL,
    notes            TEXT,
    tested_at        TEXT,
    verdict_override TEXT,
    updated_at       TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS runs (
    id          INTEGER PRIMARY KEY,
    job         TEXT NOT NULL,
    started_at  TEXT NOT NULL,
    finished_at TEXT,
    ok          INTEGER,
    stats       TEXT NOT NULL DEFAULT '{}',
    error       TEXT
  );
  CREATE TABLE IF NOT EXISTS reports (
    kind         TEXT NOT NULL,
    id           TEXT NOT NULL,
    generated_at TEXT NOT NULL,
    markdown     TEXT NOT NULL,
    PRIMARY KEY (kind, id)
  );
  CREATE TABLE IF NOT EXISTS resources (
    full_name    TEXT PRIMARY KEY,
    generated_at TEXT NOT NULL,
    markdown     TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS scores (
    full_name   TEXT PRIMARY KEY,
    relevance   REAL NOT NULL,
    total       REAL NOT NULL,
    verdict     TEXT NOT NULL,
    breakdown   TEXT NOT NULL,
    computed_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_scores_total ON scores (total);
  CREATE TABLE IF NOT EXISTS snapshot_files (
    source    TEXT NOT NULL,
    list_date TEXT NOT NULL,
    imported_at TEXT NOT NULL,
    PRIMARY KEY (source, list_date)
  );
  `,
];
