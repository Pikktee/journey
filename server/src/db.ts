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
  // M9 (offener Betrieb): E-Mail-Bestätigung + Passwort-Reset. Beide laufen
  // über kurzlebige, nur als Hash gespeicherte Einmal-Token (Tabelle
  // mail_tokens). `email_verified` gatet das Hochladen — anmelden darf man
  // sofort, Touren anlegen erst nach Bestätigung.
  `
  ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;
  CREATE TABLE mail_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    zweck TEXT NOT NULL CHECK (zweck IN ('verify','reset')),
    hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT
  );
  CREATE INDEX idx_mail_tokens_user ON mail_tokens(user_id, zweck);
  `,
  // Titelbild der Tour (Pfad wie media[].src im tour.json). Es steht hier und
  // nicht nur im tour.json, weil die Tourliste sonst je Eintrag eine Datei
  // lesen müsste — sie ist der heißeste Aufruf der API. Gefüllt wird die
  // Spalte beim Rendern, genau wie stats_json daneben.
  `
  ALTER TABLE tours ADD COLUMN cover TEXT;
  `,
  // Öffentliches Profil. Getrennt vom Konto-Namen: `name` ist der Klarname aus
  // der Registrierung und bleibt privat, `anzeigename` ist der selbstgewählte
  // Name, unter dem jemand in Galerie und auf seiner Profilseite auftaucht.
  // Ohne diese Trennung würde eine Anmeldung mit dem echten Namen automatisch
  // zur Veröffentlichung desselben führen. `profil_sichtbarkeit` steht deshalb
  // ebenfalls auf 'private'.
  `
  ALTER TABLE users ADD COLUMN anzeigename TEXT;
  ALTER TABLE users ADD COLUMN bio TEXT;
  ALTER TABLE users ADD COLUMN avatar TEXT;
  ALTER TABLE users ADD COLUMN profil_sichtbarkeit TEXT NOT NULL DEFAULT 'private'
    CHECK (profil_sichtbarkeit IN ('private','public'));
  `,
  // Optionaler Endscreen („Ziel erreicht"). Standard aus: die meisten Touren
  // haben kein konkretes Ziel — der Player kehrt dann zum Startscreen zurück.
  // `finale_ziel` ist der vom Autor gesetzte Zielname; leer = Ortsname am Ende.
  `
  ALTER TABLE tours ADD COLUMN finale INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE tours ADD COLUMN finale_ziel TEXT;
  `,
  // Benutzerverwaltung: Rollen, Einladungen, umschaltbare Registrierung.
  //
  // `rolle` ist bewusst ein Textfeld mit zwei Werten und keine eigene Tabelle —
  // es gibt genau zwei Rollen, und ein Rechtesystem für zwei Rollen wäre
  // Beiwerk. Bestandskonten werden 'nutzer'; wer Admin ist, entscheidet beim
  // Start die Konfiguration (s. AuthDienst.hebeAdmins).
  //
  // Einladungen sind EINMAL einlösbar: eine Einladung gilt einer Person. Der
  // Code steht im Klartext, weil der Admin ihn weitergeben können muss — er ist
  // ein Türöffner zur Registrierung, kein Geheimnis eines Kontos. Eingelöste
  // Einladungen bleiben als Herkunftsnachweis stehen ('wer kam über welchen
  // Code'), deshalb kein DELETE beim Einlösen.
  `
  ALTER TABLE users ADD COLUMN rolle TEXT NOT NULL DEFAULT 'nutzer'
    CHECK (rolle IN ('nutzer','admin'));
  CREATE TABLE einladungen (
    code TEXT PRIMARY KEY,
    notiz TEXT,
    erstellt_von TEXT REFERENCES users(id) ON DELETE SET NULL,
    erstellt_am TEXT NOT NULL,
    ablauf TEXT,
    eingeloest_von TEXT REFERENCES users(id) ON DELETE SET NULL,
    eingeloest_am TEXT
  );
  CREATE TABLE einstellungen (
    schluessel TEXT PRIMARY KEY,
    wert TEXT NOT NULL
  );
  `,
  // Kachel-Fassung des Titelbilds. Neben `cover` und nicht statt dessen: Listen
  // zeigen 300 px, Detailansichten formatfüllend — mit nur einem Pfad wäre das
  // eine von beiden Größen falsch. NULL bei Touren, die noch keine aufbereiteten
  // Fassungen haben (der Bild-Nachtrag beim Start füllt sie).
  `
  ALTER TABLE tours ADD COLUMN cover_thumb TEXT;
  `,
  // Warteliste für Einladungen: Wer keinen Code hat, hinterlässt seine Adresse,
  // der Betreiber lädt gezielt nach.
  //
  // Der Eintrag entsteht im DOUBLE-OPT-IN: erst der Klick auf den Link in der
  // Bestätigungsmail macht ihn zu einem Platz in der Schlange. Ohne das könnte
  // jeder fremde Adressen eintragen, und dem Betreiber fehlte der Nachweis der
  // Einwilligung (Art. 7 Abs. 1 DSGVO) — deshalb stehen Zeitpunkt UND Quelle
  // beider Schritte in der Zeile.
  //
  // `token_hash` trägt BEIDE Wege aus der Mail: bestätigen und wieder
  // austragen. Er überlebt die Bestätigung, denn sonst liefe der
  // Austragen-Link ins Leere und die Löschung wäre nur über eine Mail an den
  // Betreiber zu haben. Gespeichert wird nur der Hash — wer die Datenbank
  // liest, kann damit niemanden austragen; die Kehrseite ist, dass die
  // Einladungsmail einen FRISCHEN Token braucht (der alte lässt sich nicht
  // wieder herstellen), es also immer der Link aus der jüngsten Mail gilt.
  //
  // Die Adresse steht dagegen im Klartext — sie IST der Zweck der Tabelle, an
  // sie geht die Einladung.
  `
  CREATE TABLE warteliste (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    notiz TEXT,
    token_hash TEXT NOT NULL UNIQUE,
    eingetragen_am TEXT NOT NULL,
    eingetragen_ip TEXT,
    bestaetigt_am TEXT,
    bestaetigt_ip TEXT,
    eingeladen_am TEXT,
    eingeladen_code TEXT
  );
  CREATE INDEX idx_warteliste_reihe ON warteliste(bestaetigt_am);
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
