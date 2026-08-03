// Die Warteliste — der Weg herein für alle, die keinen Einladungscode haben.
//
// Sie ist die Kehrseite des Einladungs-Schalters: Solange eine Einladung Pflicht
// ist, steht vor der Tür ein Formular, in das man seine Adresse legt; der
// Betreiber lädt daraus gezielt nach ([einladungen.ts](./einladungen.ts) erzeugt
// den Code, diese Datei nur die Schlange davor).
//
// Drei Dinge unterscheiden sie von einer simplen Adressliste:
//
//   1. **Double-Opt-in.** Ein Eintrag zählt erst nach dem Klick in der
//      Bestätigungsmail. Ohne das trüge jeder beliebige Adressen ein — die
//      Betroffenen bekämen später ungefragt eine Einladung, und der Nachweis
//      der Einwilligung (Art. 7 Abs. 1 DSGVO) fehlte.
//   2. **Austragen ohne Konto.** Derselbe Token öffnet beide Türen; er steht in
//      jeder Mail. Wer die Löschung sonst nur per Mail an den Betreiber bekommt,
//      hat sein Recht auf Löschung (Art. 17) nur auf dem Papier.
//   3. **Fristen.** Eine Adresse, die nie bestätigt wurde, ist nach zwei Wochen
//      wertlos; eine eingeladene nach dem Ablauf ihres Codes. `raeumeAuf` löscht
//      beides von selbst — Speicherbegrenzung (Art. 5 Abs. 1 lit. e) ist keine
//      Aufgabe, an die man sich erinnern sollte.

import { createHash } from 'node:crypto'
import type { Db } from '../db.js'
import { neueSessionId, neuesTokenSecret } from '../ids.js'

/** Nie bestätigte Einträge verfallen — die Adresse gehörte womöglich nie dem Absender. */
export const FRIST_UNBESTAETIGT_TAGE = 14
/** Bestätigte, aber nie eingeladene Einträge: ein Jahr, dann ist die Absicht verjährt. */
export const FRIST_WARTEND_TAGE = 365
/** Nach der Einladung ist der Zweck erfüllt; der Code selbst läuft ohnehin früher ab. */
export const FRIST_EINGELADEN_TAGE = 90

const SCHLUESSEL_OFFEN = 'warteliste_offen'

/**
 * Wird die Warteliste vor der Tür angeboten?
 *
 * Sie ist der Ersatz für eine Tür, die nicht offen steht — steht sie offen
 * (keine Einladungspflicht, kein Riegel), wäre ein Formular „trag dich ein, wir
 * melden uns" eine Schikane: Man kann sich ja anmelden. Deshalb hängt das
 * Angebot an DREI Werten und nicht nur am eigenen Schalter.
 */
export const wartelisteAngeboten = (
  offen: boolean,
  einladungPflicht: boolean,
  registrierungOffen: boolean,
): boolean => offen && (einladungPflicht || !registrierungOffen)

export type WartelistenZustand = 'unbestaetigt' | 'wartend' | 'eingeladen'

export interface WartelistenEintrag {
  id: string
  email: string
  /** Freiwillige Angabe des Anmelders („Was willst du aufnehmen?") */
  notiz: string | null
  eingetragenAm: string
  bestaetigtAm: string | null
  eingeladenAm: string | null
  /** Der erzeugte Einladungscode — der Faden zur Einladungs-Liste */
  eingeladenCode: string | null
  zustand: WartelistenZustand
}

/** Was der Aufrufer nach einem Eintragungsversuch tun soll. */
export interface Eintragung {
  /** Klartext-Token für den Bestätigungslink — null heißt: keine Mail senden. */
  token: string | null
}

interface Zeile {
  id: string
  email: string
  notiz: string | null
  eingetragen_am: string
  bestaetigt_am: string | null
  eingeladen_am: string | null
  eingeladen_code: string | null
}

const sha256 = (wert: string): string => createHash('sha256').update(wert).digest('hex')

const SPALTEN = 'id, email, notiz, eingetragen_am, bestaetigt_am, eingeladen_am, eingeladen_code'

const zuEintrag = (z: Zeile): WartelistenEintrag => ({
  id: z.id,
  email: z.email,
  notiz: z.notiz,
  eingetragenAm: z.eingetragen_am,
  bestaetigtAm: z.bestaetigt_am,
  eingeladenAm: z.eingeladen_am,
  eingeladenCode: z.eingeladen_code,
  zustand: z.eingeladen_am ? 'eingeladen' : z.bestaetigt_am ? 'wartend' : 'unbestaetigt',
})

const vorTagen = (tage: number): string => new Date(Date.now() - tage * 24 * 60 * 60 * 1000).toISOString()

export class WartelistenDienst {
  constructor(private readonly db: Db) {}

  // — Schalter —

  /**
   * Wird die Warteliste angeboten? Vorgabe: ja.
   *
   * Anders als die Einladungspflicht ist das kein Sicherheitsriegel, sondern
   * eine Frage des Betriebs: Wer keine Adressen sammeln will, schaltet sie aus
   * und zeigt vor der Tür nur noch das Codefeld.
   */
  offen(): boolean {
    const zeile = this.db.prepare('SELECT wert FROM einstellungen WHERE schluessel = ?').get(SCHLUESSEL_OFFEN) as
      | { wert: string }
      | undefined
    return zeile ? zeile.wert === '1' : true
  }

  setzeOffen(wert: boolean): void {
    this.db
      .prepare(
        `INSERT INTO einstellungen (schluessel, wert) VALUES (?, ?)
         ON CONFLICT(schluessel) DO UPDATE SET wert = excluded.wert`,
      )
      .run(SCHLUESSEL_OFFEN, wert ? '1' : '0')
  }

  // — Eintragen und bestätigen —

  /**
   * Adresse vormerken und den Token für die Bestätigungsmail zurückgeben.
   *
   * Ist die Adresse schon bestätigt (oder bereits eingeladen), kommt `null`
   * zurück: Ein zweiter Eintrag wäre keiner, und eine erneute Mail wäre eine
   * Nachricht, die niemand angefordert hat. Ein noch UNbestätigter Eintrag
   * bekommt dagegen einen frischen Token — die erste Mail ging vielleicht im
   * Spam unter. Der alte Link stirbt damit.
   *
   * Die Route antwortet in allen Fällen gleich; nur so verrät sie nicht, wer
   * schon auf der Liste steht.
   */
  trageEin(email: string, notiz: string | null, ip: string | null): Eintragung {
    const adresse = email.toLowerCase().trim()
    const vorhanden = this.db.prepare(`SELECT ${SPALTEN} FROM warteliste WHERE email = ?`).get(adresse) as
      | Zeile
      | undefined
    if (vorhanden && (vorhanden.bestaetigt_am || vorhanden.eingeladen_am)) return { token: null }

    const token = neuesTokenSecret()
    const jetzt = new Date().toISOString()
    const gestutzt = notiz?.trim() || null
    if (vorhanden) {
      // Die Notiz nur ersetzen, wenn diesmal eine kam — ein zweiter Anlauf mit
      // leerem Feld soll den ersten Satz nicht wegwischen.
      this.db
        .prepare(
          `UPDATE warteliste SET token_hash = ?, eingetragen_am = ?, eingetragen_ip = ?, notiz = COALESCE(?, notiz)
           WHERE id = ?`,
        )
        .run(sha256(token), jetzt, ip, gestutzt, vorhanden.id)
      return { token }
    }
    this.db
      .prepare(
        `INSERT INTO warteliste (id, email, notiz, token_hash, eingetragen_am, eingetragen_ip)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(neueSessionId(), adresse, gestutzt, sha256(token), jetzt, ip)
    return { token }
  }

  /**
   * Den Klick aus der Bestätigungsmail einlösen.
   *
   * Zweimal derselbe Klick ist kein Fehler (Mail-Scanner öffnen Links vorab):
   * Ein bereits bestätigter Eintrag kommt unverändert zurück, statt zu einem
   * „Link ungültig" zu führen, das niemand einordnen könnte.
   */
  bestaetige(token: string, ip: string | null): WartelistenEintrag | null {
    const zeile = this.db.prepare(`SELECT ${SPALTEN} FROM warteliste WHERE token_hash = ?`).get(sha256(token)) as
      | Zeile
      | undefined
    if (!zeile) return null
    if (zeile.bestaetigt_am) return zuEintrag(zeile)
    const jetzt = new Date().toISOString()
    this.db.prepare('UPDATE warteliste SET bestaetigt_am = ?, bestaetigt_ip = ? WHERE id = ?').run(jetzt, ip, zeile.id)
    return zuEintrag({ ...zeile, bestaetigt_am: jetzt })
  }

  /** Austragen über den Link aus der Mail — der Weg zur Löschung ohne Konto. */
  trageAus(token: string): boolean {
    return this.db.prepare('DELETE FROM warteliste WHERE token_hash = ?').run(sha256(token)).changes > 0
  }

  /**
   * Frischen Token setzen und im Klartext zurückgeben — für den Austragen-Link
   * der Einladungsmail.
   *
   * Nötig, weil in der Datenbank nur der Hash steht: Der Token aus der
   * Bestätigungsmail lässt sich nicht wieder herstellen. Der alte Link wird
   * damit stumpf; es gilt immer der aus der JÜNGSTEN Mail.
   */
  erneuereToken(id: string): string {
    const token = neuesTokenSecret()
    this.db.prepare('UPDATE warteliste SET token_hash = ? WHERE id = ?').run(sha256(token), id)
    return token
  }

  // — Verwaltung —

  /**
   * Die ganze Liste, älteste Anmeldung zuerst.
   *
   * Die Reihenfolge ist die Schlange: Wer zuerst kam, steht oben. Sortiert wird
   * nach der EINTRAGUNG, nicht nach der Bestätigung — sonst rutschte nach vorn,
   * wer seine Mail schneller liest.
   */
  alle(): WartelistenEintrag[] {
    const zeilen = this.db
      .prepare(`SELECT ${SPALTEN} FROM warteliste ORDER BY eingetragen_am ASC`)
      .all() as Zeile[]
    return zeilen.map(zuEintrag)
  }

  nachId(id: string): WartelistenEintrag | null {
    const zeile = this.db.prepare(`SELECT ${SPALTEN} FROM warteliste WHERE id = ?`).get(id) as Zeile | undefined
    return zeile ? zuEintrag(zeile) : null
  }

  /** Wer hinter einem Mail-Token steckt — für das Aufräumen VOR dem Austragen. */
  nachToken(token: string): WartelistenEintrag | null {
    const zeile = this.db.prepare(`SELECT ${SPALTEN} FROM warteliste WHERE token_hash = ?`).get(sha256(token)) as
      | Zeile
      | undefined
    return zeile ? zuEintrag(zeile) : null
  }

  /** Hält fest, dass für diesen Eintrag ein Code erzeugt und verschickt wurde. */
  markiereEingeladen(id: string, code: string): void {
    this.db
      .prepare('UPDATE warteliste SET eingeladen_am = ?, eingeladen_code = ? WHERE id = ?')
      .run(new Date().toISOString(), code, id)
  }

  loesche(id: string): boolean {
    return this.db.prepare('DELETE FROM warteliste WHERE id = ?').run(id).changes > 0
  }

  /**
   * Abgelaufene Einträge löschen; gibt die Zahl der entfernten Zeilen zurück.
   *
   * Läuft beim Start und danach täglich. Absichtlich ohne Vorwarnung an den
   * Betreiber: Eine Liste, die nur wächst, ist eine Datensammlung — keine
   * Warteschlange.
   */
  raeumeAuf(): number {
    const erg = this.db
      .prepare(
        `DELETE FROM warteliste WHERE
           (bestaetigt_am IS NULL AND eingetragen_am < ?)
           OR (bestaetigt_am IS NOT NULL AND eingeladen_am IS NULL AND bestaetigt_am < ?)
           OR (eingeladen_am IS NOT NULL AND eingeladen_am < ?)`,
      )
      .run(vorTagen(FRIST_UNBESTAETIGT_TAGE), vorTagen(FRIST_WARTEND_TAGE), vorTagen(FRIST_EINGELADEN_TAGE))
    return erg.changes
  }
}
