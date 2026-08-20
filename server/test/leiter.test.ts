// Die Leiter von unten: eine leere Datei bis Stand 22 hochziehen, in JEDE
// Tabelle eine Zeile legen und den Welle-1-Schritt darüber laufen lassen.
//
// Ein Schema-Neubau nach dem SQLite-Rezept ist die eine Migrationsform, bei der
// stilles Datenverlieren wahrscheinlich ist: `DROP TABLE` räumt bei
// eingeschalteten Fremdschlüsseln die Kindzeilen mit ab, und eine
// `INSERT … SELECT`-Spaltenliste, die um eins verrutscht, fällt bei leerem
// Bestand nicht auf. Deshalb steht hier je Tabelle eine WERTE-Zeile, nicht bloß
// der Aufruf.
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { MIGRATIONS_STAND, migriereBis } from '../src/db.js'

const JETZT = '2026-08-20T10:00:00.000Z'

/** Datenbank auf Stand 22, mit je einer Zeile in jeder Tabelle. */
function gefuellteAltDatenbank(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  migriereBis(db, 22)
  db.exec(`
    INSERT INTO users (id, email, pw_hash, name, created_at, rolle, profil_sichtbarkeit,
      anzeigename, handle, titelbild, newsletter, suchmaschinen)
      VALUES ('u1', 'mira@example.com', 'hash', 'Mira', '${JETZT}', 'admin', 'public',
      'Mira W.', 'mira', 'titelbild/kueste.jpg', 1, 1);
    INSERT INTO tokens (id, hash, user_id, label, created_at) VALUES ('t1', 'h1', 'u1', 'Pixel', '${JETZT}');
    INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent, ip_praefix, zuletzt_gesehen, token_id)
      VALUES ('s1', 'u1', '${JETZT}', '${JETZT}', 'Chrome', '203.0', '${JETZT}', 't1');
    INSERT INTO mail_tokens (id, user_id, zweck, hash, nutzlast, created_at, expires_at)
      VALUES ('mt1', 'u1', 'email', 'h2', 'neu@example.com', '${JETZT}', '${JETZT}');
    INSERT INTO tours (id, owner_id, no, status, visibility, title, stats_json, fehler,
      created_at, updated_at, finale_ziel, dachzeile)
      VALUES ('tr1', 'u1', 1, 'bereit', 'public', 'Bucht',
      '{"fotos":3,"spur":"abc","ende":12}', NULL, '${JETZT}', '${JETZT}', 'galerie', 'Koh Pha-ngan');
    INSERT INTO einladungen (code, notiz, erstellt_von, erstellt_am) VALUES ('ABC-123', 'für Mira', 'u1', '${JETZT}');
    INSERT INTO einstellungen (schluessel, wert) VALUES ('einladung_pflicht', '1'), ('warteliste_offen', '1');
    INSERT INTO warteliste (id, email, token_hash, eingetragen_am, bestaetigt_am)
      VALUES ('w1', 'gast@example.com', 'h3', '${JETZT}', '${JETZT}');
    INSERT INTO mailvorlagen (schluessel, betreff, titel, text, knopf, fuss, geaendert_am)
      VALUES ('warteliste-einladung', 'Dein Platz, {{name}}', 'Willkommen',
      'Dein Export ist {{groesse}} groß und {{frist}} gültig.', 'Los', 'Abmelden: {{austragenLink}}', '${JETZT}');
    INSERT INTO handles_reserviert (handle, user_id, frei_ab) VALUES ('mira-alt', 'u1', '${JETZT}');
    INSERT INTO newsletter_einwilligungen (id, benutzer_id, zeitpunkt, zustand, quelle, textfassung)
      VALUES ('n1', 'u1', '${JETZT}', 'an', 'registrierung', 'registrierung-2026-08-06');
    INSERT INTO exporte (id, benutzer_id, status, angefordert_am, bytes, dateien)
      VALUES ('e1', 'u1', 'fertig', '${JETZT}', 1024, 7);
    INSERT INTO tracker_verknuepfungen (id, benutzer_id, anbieter, tokens, status, verbunden_am)
      VALUES ('v1', 'u1', 'polar', 'geheim', 'aktiv', '${JETZT}');
    INSERT INTO tracker_importe (id, benutzer_id, anbieter, externe_id, status, tour_id, gemeldet_am)
      VALUES ('i1', 'u1', 'polar', '123', 'uebersprungen', 'tr1', '${JETZT}');
    INSERT INTO push_geraete (id, benutzer_id, token_id, plattform, token, angelegt_am, zuletzt_gesehen_am)
      VALUES ('p1', 'u1', 't1', 'android', 'fid-1', '${JETZT}', '${JETZT}');
    INSERT INTO rueckmeldungen (id, benutzer_id, text, kontext, quelle, status, angelegt_am)
      VALUES ('r1', 'u1', 'Der Knopf fehlt', '{"geraet":"Pixel 9","plattform":"Android","schirm":"412x915","seite":"/app","sprache":"de"}',
      'app', 'offen', '${JETZT}');
  `)
  return db
}

describe('Leiter bis Welle 1', () => {
  it('hebt jede Zeile mit — nichts fällt beim Tabellen-Neubau heraus', () => {
    const db = gefuellteAltDatenbank()
    migriereBis(db, MIGRATIONS_STAND)

    expect(db.pragma('user_version', { simple: true })).toBe(MIGRATIONS_STAND)
    expect(db.pragma('foreign_key_check')).toEqual([])
    // Und die Fremdschlüssel stehen danach wieder an.
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)

    const zahl = (tabelle: string): number =>
      (db.prepare(`SELECT count(*) AS n FROM ${tabelle}`).get() as { n: number }).n
    for (const tabelle of [
      'users',
      'tokens',
      'sessions',
      'mail_tokens',
      'tours',
      'invitations',
      'waitlist',
      'mail_templates',
      'reserved_handles',
      'newsletter_consents',
      'data_exports',
      'tracker_links',
      'tracker_imports',
      'push_devices',
      'feedback',
    ]) {
      expect(zahl(tabelle), tabelle).toBe(1)
    }
    expect(zahl('settings')).toBe(2)
  })

  it('zieht die Werte mit, die Teil des Vertrags sind', () => {
    const db = gefuellteAltDatenbank()
    migriereBis(db, MIGRATIONS_STAND)

    const nutzer = db.prepare('SELECT * FROM users').get() as Record<string, unknown>
    expect(nutzer['role']).toBe('admin')
    expect(nutzer['profile_visibility']).toBe('public')
    // Die SPALTE heißt jetzt `banner`, ihr WERT zeigt aber noch auf den alten
    // Ordner: Den zieht die Start-Migration nach, weil sie dabei die Dateien
    // umbenennt (§4.2). Nur die Spalte umzubenennen bräche jedes Banner.
    expect(nutzer['banner']).toBe('titelbild/kueste.jpg')

    const tour = db.prepare('SELECT * FROM tours').get() as Record<string, unknown>
    expect(tour['status']).toBe('ready')
    // Die Statistik ist ein JSON-Feld: Ihre Schlüssel wandern mit dem Vertrag.
    expect(JSON.parse(tour['stats_json'] as string)).toEqual({
      placedMedia: 3,
      trackSignature: 'abc',
      end: 12,
    })

    const schluessel = (
      db.prepare('SELECT key FROM settings ORDER BY key').all() as { key: string }[]
    ).map((z) => z.key)
    expect(schluessel).toEqual(['invitation_required', 'waitlist_open'])

    const vorlage = db.prepare('SELECT * FROM mail_templates').get() as Record<string, unknown>
    expect(vorlage['key']).toBe('waitlist-invitation')
    // Auch die Platzhalter IM Text — eine Vorlage mit `{{groesse}}` bliebe
    // stehen, und die Mail ginge mit der rohen Klammer heraus.
    expect(vorlage['body']).toBe('Dein Export ist {{size}} groß und {{deadline}} gültig.')
    expect(vorlage['footer']).toBe('Abmelden: {{leaveLink}}')

    const einwilligung = db.prepare('SELECT * FROM newsletter_consents').get() as Record<
      string,
      unknown
    >
    expect(einwilligung['state']).toBe('on')
    expect(einwilligung['source']).toBe('signup')
    // Die Textfassung ist ein NACHWEIS (Art. 7 Abs. 1) und kein Bezeichner:
    // Sie benennt den Satz, den jemand gelesen hat, und bleibt deutsch.
    expect(einwilligung['text_version']).toBe('registrierung-2026-08-06')

    expect((db.prepare('SELECT status FROM data_exports').get() as { status: string }).status).toBe(
      'done',
    )
    expect(
      (db.prepare('SELECT status FROM tracker_links').get() as { status: string }).status,
    ).toBe('active')
    expect(
      (db.prepare('SELECT status FROM tracker_imports').get() as { status: string }).status,
    ).toBe('skipped')

    const rueckmeldung = db.prepare('SELECT * FROM feedback').get() as Record<string, unknown>
    expect(rueckmeldung['status']).toBe('open')
    expect(rueckmeldung['source']).toBe('app')
    expect(JSON.parse(rueckmeldung['context'] as string)).toEqual({
      device: 'Pixel 9',
      platform: 'Android',
      screen: '412x915',
      page: '/app',
      language: 'de',
    })
  })
})
