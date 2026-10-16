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
