// SQLite-Zugriff (better-sqlite3, synchron — ein Schreiber genügt hier) samt
// Schema-Migrationen. Die DB hält nur Auth- und Listen-Metadaten; die
// eigentlichen Tour-Daten (Manifest, Medien, gerendertes tour.json) liegen als
// Dateien im Storage — das hält die DB klein und den Umzug auf Postgres/R2 trivial.

import Database from 'better-sqlite3'

export type Db = Database.Database

// Migrationen laufen der Reihe nach; `user_version` merkt den Stand.
const MIGRATIONEN: string[] = [
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    pw_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE tokens (
    id TEXT PRIMARY KEY,
    hash TEXT NOT NULL UNIQUE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_used_at TEXT
  );
  CREATE TABLE tours (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    no INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('angelegt','verarbeitung','bereit','fehler')),
    visibility TEXT NOT NULL DEFAULT 'unlisted' CHECK (visibility IN ('private','unlisted','public')),
    client_tour_id TEXT,
    title TEXT,
    description TEXT,
    stats_json TEXT,
    fehler TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_tours_owner ON tours(owner_id, created_at DESC);
  CREATE UNIQUE INDEX idx_tours_client ON tours(owner_id, client_tour_id) WHERE client_tour_id IS NOT NULL;
  `,
]

export function oeffneDb(pfad: string): Db {
  const db = new Database(pfad)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migriere(db)
  return db
}

function migriere(db: Db): void {
  const stand = db.pragma('user_version', { simple: true }) as number
  for (let i = stand; i < MIGRATIONEN.length; i++) {
    const schritt = MIGRATIONEN[i]
    if (!schritt) continue
    db.transaction(() => {
      db.exec(schritt)
      db.pragma(`user_version = ${i + 1}`)
    })()
  }
}
