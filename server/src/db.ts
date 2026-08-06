// SQLite-Zugriff (better-sqlite3, synchron — ein Schreiber genügt hier) samt
// Schema-Migrationen. Die DB hält nur Auth- und Listen-Metadaten; die
// eigentlichen Tour-Daten (Manifest, Medien, gerendertes tour.json) liegen als
// Dateien im Storage — das hält die DB klein und den Umzug auf Postgres/R2 trivial.

import Database from 'better-sqlite3'
import { freierHandle, handleAusEmail } from './handle.js'

export type Db = Database.Database

/**
 * Ein Migrationsschritt ist SQL — oder Code, wo SQL nicht reicht.
 *
 * Die Handle-Vergabe für Bestandskonten (Schritt 11) rechnet pro Zeile aus der
 * E-Mail einen Namen und hängt bei Kollision einen Zähler an; das ist in SQLite
 * nicht auszudrücken, ohne es zu erfinden. Beide Formen laufen in derselben
 * Transaktion wie die Versionsnummer.
 */
type Migration = string | ((db: Db) => void)

// Migrationen laufen der Reihe nach; `user_version` merkt den Stand.
const MIGRATIONEN: Migration[] = [
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
  // Angepasste Texte der System-Mails. Die Tabelle hält nur ABWEICHUNGEN vom
  // Katalog in mailvorlagen.ts — eine leere Tabelle ist der Normalfall, und
  // eine bessere Formulierung im Code erreicht dann alle. Deshalb auch kein
  // Vorbefüllen beim Anlegen: Wer nichts geändert hat, hängt am Code.
  `
  CREATE TABLE mailvorlagen (
    schluessel TEXT PRIMARY KEY,
    betreff TEXT NOT NULL,
    titel TEXT NOT NULL,
    text TEXT NOT NULL,
    knopf TEXT NOT NULL,
    fuss TEXT NOT NULL,
    geaendert_am TEXT NOT NULL,
    geaendert_von TEXT REFERENCES users(id) ON DELETE SET NULL
  );
  `,
  // Der Handle: die Adresse einer Person (`maptale.io/@henrik`). Regeln und
  // reservierte Wörter stehen in handle.ts.
  //
  // UNIQUE steht als INDEX und nicht an der Spalte, weil SQLite ein
  // `ALTER TABLE … ADD COLUMN … UNIQUE` nicht kennt. Der Index ist
  // NOCASE — Groß/Klein unterscheidet in einer URL nicht, und zwei Konten
  // „@Henrik" und „@henrik" wären dieselbe Adresse mit zwei Besitzern.
  //
  // `handles_reserviert` hält aufgegebene Handles 90 Tage fest. Das trennt zwei
  // Dinge, die nicht dieselbe Dauer brauchen: Alte LINKS leiten weiter, solange
  // die Adresse niemandem sonst gehört (kostet nichts); die SPERRE schützt
  // davor, dass jemand die Adresse übernimmt und die alten Links miterbt. 90
  // Tage sind der Ausgleich — lang genug gegen Identitätsübernahme, kurz genug,
  // dass Namen nicht auf Jahre blockiert sind (Instagram sperrt 14 Tage, GitHub
  // gibt sofort frei; beides zu wenig für einen Link in einem Reisebericht).
  `
  ALTER TABLE users ADD COLUMN handle TEXT;
  ALTER TABLE users ADD COLUMN handle_geaendert_am TEXT;
  CREATE UNIQUE INDEX idx_users_handle ON users(handle COLLATE NOCASE) WHERE handle IS NOT NULL;
  CREATE TABLE handles_reserviert (
    handle TEXT PRIMARY KEY COLLATE NOCASE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    frei_ab TEXT NOT NULL
  );
  `,
  // Bestandskonten bekommen ihren Handle. Einmalig und deterministisch: nach
  // Anlegedatum, aus der E-Mail abgeleitet, bei Kollision mit Zähler — wer
  // zuerst da war, bekommt den kurzen Namen. Einmal vergeben ist er in der
  // Welt, deshalb läuft das hier und nicht beim nächsten Login.
  vergibFehlendeHandles,
  // Die übrigen Profilfelder (Etappe 2). Alle optional und alle NULL by default:
  // Ein Profil ist eine Einladung, kein Formular — wer nichts einträgt, hat
  // trotzdem eine vollständige Seite.
  //
  // `website` und `instagram` stehen als getrennte Spalten und nicht als Liste
  // von Links: Es sind genau zwei, jeder mit eigener Darstellung, und eine
  // Tabelle für zwei Zeilen wäre Beiwerk. Gespeichert wird jeweils die NACKTE
  // Form (`henrikheil.net`, `henrik.unterwegs`) — das Schema bzw. das `@` gehört
  // zur Anzeige, nicht zum Wert, sonst stünde dieselbe Adresse in drei
  // Schreibweisen in der Spalte.
  //
  // `titelbild` trägt entweder den Namen eines mitgelieferten Bildes
  // (`serpentinen.jpg`, s. public/titelbilder/) oder einen Pfad im
  // Benutzer-Storage (`titelbild/<zeitstempel>.jpg`). Die beiden lassen sich am
  // Schrägstrich unterscheiden — ein Vorschlag hat keinen.
  `
  ALTER TABLE users ADD COLUMN ort TEXT;
  ALTER TABLE users ADD COLUMN website TEXT;
  ALTER TABLE users ADD COLUMN instagram TEXT;
  ALTER TABLE users ADD COLUMN titelbild TEXT;
  `,
  // Kontoeinstellungen (Etappe 3): angemeldete Geräte sichtbar machen und der
  // E-Mail-Wechsel.
  //
  // **Die Sitzung bekommt ein Gesicht.** Ohne Gerät und Ort ist eine Liste von
  // Sitzungen eine Liste von IDs, an der niemand erkennt, welche die fremde
  // ist. Vom Absender bleibt deshalb genau so viel stehen, wie zum Wiedererkennen
  // nötig ist: `user_agent` roh (die Deutung — „Chrome auf macOS" — passiert in
  // der Anzeige, damit eine bessere Deutung keine Migration braucht) und
  // `ip_praefix` mit nur ZWEI Oktetten. Die vollständige Adresse wäre ein
  // Bewegungsprofil in der Datenbank; „84.119.x.x" beantwortet dagegen die
  // einzige Frage, die hier gestellt wird — war ich das, oder war das jemand
  // anderes?
  //
  // `zuletzt_gesehen` wird gedrosselt fortgeschrieben (s. AuthDienst.sieheSession):
  // ein UPDATE pro Anfrage wäre ein Schreibvorgang für jedes geladene Bild.
  //
  // Der E-Mail-Wechsel braucht einen dritten Token-Zweck UND einen Platz für
  // die neue Adresse — sie darf erst nach dem Klick in `users` landen, sonst
  // gehörte das Konto ab dem Absenden einer Adresse, die niemand bestätigt hat.
  // SQLite kann ein CHECK nicht ändern, also wird die Tabelle neu gebaut.
  `
  ALTER TABLE sessions ADD COLUMN user_agent TEXT;
  ALTER TABLE sessions ADD COLUMN ip_praefix TEXT;
  ALTER TABLE sessions ADD COLUMN zuletzt_gesehen TEXT;

  CREATE TABLE mail_tokens_neu (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    zweck TEXT NOT NULL CHECK (zweck IN ('verify','reset','email')),
    hash TEXT NOT NULL UNIQUE,
    nutzlast TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT
  );
  INSERT INTO mail_tokens_neu (id, user_id, zweck, hash, nutzlast, created_at, expires_at, used_at)
    SELECT id, user_id, zweck, hash, NULL, created_at, expires_at, used_at FROM mail_tokens;
  DROP TABLE mail_tokens;
  ALTER TABLE mail_tokens_neu RENAME TO mail_tokens;
  CREATE INDEX idx_mail_tokens_user ON mail_tokens(user_id, zweck);
  `,
  // Newsletter-Einwilligung (Etappe 4).
  //
  // **Ein Boolean allein reicht nicht.** Im Streitfall stünde dort „an", und
  // niemand wüsste seit wann, woher und wozu. Art. 7 Abs. 1 DSGVO verlangt, dass
  // der Verantwortliche die Einwilligung NACHWEISEN kann — deshalb die Historie
  // daneben: Zeitpunkt, Zustand, Quelle und der Wortlaut, dem zugestimmt wurde.
  // Der aktuelle Zustand bleibt trotzdem als Spalte an `users`: Der Versand
  // fragt ihn für jeden Empfänger, und „letzte Zeile der Historie" wäre dafür
  // eine Unterabfrage je Konto.
  //
  // `textfassung` trägt eine LABEL-Fassung (`registrierung-2026-08-06`), nicht
  // den Wortlaut selbst — sonst stünde derselbe Satz tausendfach in der
  // Tabelle. Die Zuordnung Label → Wortlaut steht in newsletter.ts, und ein
  // Drift-Wächter hält sie gegen die Sätze in der Oberfläche: Wer den Text
  // ändert, ohne das Label zu heben, würde sonst still eine Zustimmung zu
  // etwas anderem behaupten.
  //
  // ON DELETE CASCADE ist Absicht: Mit dem Konto geht die Adresse, und ohne
  // Adresse gibt es nichts mehr zu belegen. Die drei Jahre Aufbewahrung gelten
  // der ABMELDUNG (die Zeile bleibt, wenn jemand den Schalter umlegt), nicht
  // dem gelöschten Konto — dort schlägt Art. 17 durch.
  `
  ALTER TABLE users ADD COLUMN newsletter INTEGER NOT NULL DEFAULT 0;
  CREATE TABLE newsletter_einwilligungen (
    id TEXT PRIMARY KEY,
    benutzer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    zeitpunkt TEXT NOT NULL,
    zustand TEXT NOT NULL CHECK (zustand IN ('an','aus')),
    quelle TEXT NOT NULL CHECK (quelle IN ('registrierung','konto','abmeldelink')),
    textfassung TEXT NOT NULL
  );
  CREATE INDEX idx_newsletter_einwilligungen ON newsletter_einwilligungen(benutzer_id, zeitpunkt);
  `,

  // 15 — „In Suchmaschinen erscheinen".
  //
  // Ein eigenes Feld neben `profil_sichtbarkeit` und nicht dessen dritte Stufe:
  // Ein Profil über den Link zu teilen ist etwas anderes, als unter dem eigenen
  // Namen auffindbar zu sein. Wer seine Reisen in einer Gruppe herumreicht, hat
  // damit nicht eingewilligt, dass die Adresse dauerhaft in einer Suche steht.
  //
  // **Standard aus.** Bei einem Feld, das eine Person unter ihrem Namen
  // auffindbar macht, ist der stille Standard die Entscheidung — nicht der
  // Schalter, den kaum jemand sucht. Bestandskonten bekommen deshalb 0, obwohl
  // ihre Profile schon öffentlich sein können: Öffentlich war bisher „wer den
  // Link hat", und dabei bleibt es, bis jemand aktiv etwas anderes will.
  //
  // Wirksam wird das Feld nur ZUSAMMEN mit `profil_sichtbarkeit = 'public'`
  // (s. server/src/seiten.ts) — ein privates Profil ist nie indexierbar, egal
  // was hier steht.
  `
  ALTER TABLE users ADD COLUMN suchmaschinen INTEGER NOT NULL DEFAULT 0;
  `,

  // 16 — Datenexport (Art. 20 DSGVO): die Job-Verwaltung.
  //
  // Eine Zeile je Anforderung, nicht je Konto: Was jemand wann angefordert hat,
  // ist die Auskunft, die man später braucht („mein Link ist abgelaufen").
  //
  // **Der partielle UNIQUE-Index ist der Kern.** Zwei Klicks auf denselben
  // Knopf dürfen keine zwei Archive bauen — und eine Prüfung im Code („läuft
  // schon einer?") hilft dagegen nicht: Zwischen SELECT und INSERT liegt ein
  // Fenster, in dem die zweite Anfrage dieselbe Antwort bekommt. Der Index
  // schließt es in der Datenbank: Ein zweiter laufender Job je Konto ist
  // schlicht nicht speicherbar, der INSERT scheitert, und die Route liefert
  // den vorhandenen zurück.
  //
  // `laeuft_ab_am` steht in der Zeile und wird nicht gerechnet: Die Frist gilt
  // ab FERTIGSTELLUNG, und eine später geänderte Konstante darf einen bereits
  // verschickten Link nicht rückwirkend verkürzen oder verlängern.
  `
  CREATE TABLE exporte (
    id TEXT PRIMARY KEY,
    benutzer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('laeuft','fertig','fehler')),
    angefordert_am TEXT NOT NULL,
    fertig_am TEXT,
    laeuft_ab_am TEXT,
    bytes INTEGER,
    dateien INTEGER,
    fehler TEXT
  );
  CREATE UNIQUE INDEX idx_exporte_laufend ON exporte(benutzer_id) WHERE status = 'laeuft';
  CREATE INDEX idx_exporte_benutzer ON exporte(benutzer_id, angefordert_am);
  `,
]

/**
 * Vergibt jedem Konto ohne Handle einen — der Backfill aus Migration 12.
 *
 * Als benannte Funktion und nicht als anonymer Schritt in der Liste, damit sie
 * für sich prüfbar ist: Ein Test, der stattdessen `user_version` zurückdreht,
 * ließe die FOLGENDEN Migrationen ein zweites Mal laufen und scheiterte an der
 * ersten doppelten Spalte.
 *
 * Deterministisch nach Anlegedatum: Wer zuerst da war, bekommt den kurzen
 * Namen. Wiederholbar ist sie auch (`WHERE handle IS NULL`) — einmal Vergebenes
 * fasst sie nie wieder an, denn der Name ist dann in der Welt.
 */
export function vergibFehlendeHandles(db: Db): void {
  const zeilen = db
    .prepare('SELECT id, email FROM users WHERE handle IS NULL ORDER BY created_at ASC, id ASC')
    .all() as Array<{ id: string; email: string }>
  const belegt = new Set(
    (db.prepare('SELECT handle FROM users WHERE handle IS NOT NULL').all() as Array<{ handle: string }>).map((z) =>
      z.handle.toLowerCase(),
    ),
  )
  const setze = db.prepare('UPDATE users SET handle = ? WHERE id = ?')
  for (const zeile of zeilen) {
    const handle = freierHandle(handleAusEmail(zeile.email), (h) => belegt.has(h))
    belegt.add(handle)
    setze.run(handle, zeile.id)
  }
}

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
      if (typeof schritt === 'string') db.exec(schritt)
      else schritt(db)
      db.pragma(`user_version = ${i + 1}`)
    })()
  }
}
