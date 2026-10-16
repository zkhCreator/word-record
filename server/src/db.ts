import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export type DB = Database.Database;

// Append-only: each entry runs once, in order, tracked via PRAGMA user_version.
const migrations: string[] = [
  `
  CREATE TABLE entries (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    text          TEXT NOT NULL,
    normalized    TEXT NOT NULL UNIQUE,
    kind          TEXT NOT NULL DEFAULT 'word',
    lemma         TEXT,
    phonetic      TEXT,
    pos           TEXT,
    meaning       TEXT,
    definition_en TEXT,
    form_note     TEXT,
    senses        TEXT NOT NULL DEFAULT '[]',
    examples      TEXT NOT NULL DEFAULT '[]',
    notes         TEXT NOT NULL DEFAULT '',
    enrich_status TEXT NOT NULL DEFAULT 'pending',
    enrich_error  TEXT,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
  );
  CREATE INDEX idx_entries_lemma ON entries(lemma);
  CREATE INDEX idx_entries_created ON entries(created_at DESC);

  CREATE TABLE contexts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id    INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    sentence    TEXT NOT NULL,
    url         TEXT,
    title       TEXT,
    meaning     TEXT,
    explanation TEXT,
    translation TEXT,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX idx_contexts_entry ON contexts(entry_id);
  `,
  `
  CREATE TABLE reviews (
    entry_id         INTEGER PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE,
    stage            INTEGER NOT NULL DEFAULT 0,
    due_at           INTEGER NOT NULL,
    reps             INTEGER NOT NULL DEFAULT 0,
    lapses           INTEGER NOT NULL DEFAULT 0,
    last_reviewed_at INTEGER
  );
  CREATE INDEX idx_reviews_due ON reviews(due_at);

  CREATE TABLE review_logs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id     INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    grade        TEXT NOT NULL,
    stage_before INTEGER NOT NULL,
    stage_after  INTEGER NOT NULL,
    reviewed_at  INTEGER NOT NULL
  );
  CREATE INDEX idx_review_logs_time ON review_logs(reviewed_at);

  INSERT INTO reviews (entry_id, due_at) SELECT id, created_at FROM entries;
  `,
  `
  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  ALTER TABLE entries ADD COLUMN enrich_model TEXT;
  `,
];

export function openDb(file: string): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function migrate(db: DB) {
  const current = db.pragma('user_version', { simple: true }) as number;
  for (let v = current; v < migrations.length; v++) {
    db.transaction(() => {
      db.exec(migrations[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}
