// Rückmeldungen: der Eingang der Alpha.
//
// Für den Absender ist das ein Feld, für den Betreiber eine Liste mit Status
// und Notiz. Diese Asymmetrie ist Absicht: In der Alpha ist Feedback die
// knappste Ressource, und jede Pflichtangabe im Formular kostet Meldungen.
// Kategorie und Priorität vergibt, wer sichtet — nicht, wer schreibt.
//
// Drei Entscheidungen, die man beim Ausbauen leicht kippt:
//
//   1. **Der technische Kontext ist freiwillig und wird deshalb VOLLSTÄNDIG
//      gespeichert oder gar nicht.** Ein halb gefülltes Kontext-Objekt (Seite
//      ja, Browser nein) sähe in der Liste aus wie ein Übertragungsfehler, und
//      niemand könnte sagen, ob die Angabe fehlte oder abgewählt war.
//   2. **Die Route verrät nichts über Konten.** Eine hinterlassene Adresse wird
//      nicht gegen `users` geprüft — die Antwort ist immer dieselbe.
//   3. **Gelöscht wird nach Frist** (`raeumeAuf`), wie bei Warteliste und
//      Export. Ein Eingang, den niemand leert, wird zur Sammlung.

import type { Db } from './db.js'
import { neueSessionId } from './ids.js'

/** Erledigte Meldungen verfallen; der Sachverhalt steckt dann im Code oder in einer Notiz. */
export const FRIST_ERLEDIGT_TAGE = 180
/** Offene Meldungen halten länger, aber nicht ewig — sonst wächst der Eingang nur. */
export const FRIST_OFFEN_TAGE = 540

/**
 * Ein Freitextfeld, aber kein Aufsatz: Was länger ist, gehört in eine Mail.
 * Der Server klemmt hart, damit ein Skript die Tabelle nicht vollschreibt.
 */
export const MAX_TEXT = 4000
/** Die Adresse ist freiwillig; die Länge folgt der Spezifikation für Mail-Adressen. */
export const MAX_EMAIL = 254

export type RueckmeldungStatus = 'offen' | 'in_arbeit' | 'erledigt'
export type RueckmeldungQuelle = 'web' | 'app'

/**
 * Was der Client freiwillig mitschickt. Bewusst offen typisiert und als JSON
 * gespeichert: Die App kennt Angaben, die der Browser nie hat (Gerätemodell,
 * Android-Fassung), und eine neue Angabe soll keine Migration kosten.
 */
export type RueckmeldungKontext = Record<string, string | number | boolean | null>

export interface Rueckmeldung {
  id: string
  benutzerId: string | null
  /** Anzeigename des Kontos, falls die Meldung von einem Angemeldeten kam. */
  benutzerName: string | null
  email: string | null
  text: string
  kontext: RueckmeldungKontext | null
  quelle: RueckmeldungQuelle
  status: RueckmeldungStatus
  notiz: string | null
  angelegtAm: string
  geaendertAm: string | null
}

type Zeile = {
  id: string
  benutzer_id: string | null
  benutzer_name: string | null
  email: string | null
  text: string
  kontext: string | null
  quelle: RueckmeldungQuelle
  status: RueckmeldungStatus
  notiz: string | null
  angelegt_am: string
  geaendert_am: string | null
}

function zuRueckmeldung(z: Zeile): Rueckmeldung {
  let kontext: RueckmeldungKontext | null = null
  if (z.kontext) {
    // Kaputtes JSON darf die Liste nicht sprengen: Eine unlesbare Angabe ist
    // dasselbe wie keine — der Text der Meldung bleibt lesbar.
    try {
      kontext = JSON.parse(z.kontext) as RueckmeldungKontext
    } catch {
      kontext = null
    }
  }
  return {
    id: z.id,
    benutzerId: z.benutzer_id,
    benutzerName: z.benutzer_name,
    email: z.email,
    text: z.text,
    kontext,
    quelle: z.quelle,
    status: z.status,
    notiz: z.notiz,
    angelegtAm: z.angelegt_am,
    geaendertAm: z.geaendert_am,
  }
}

const SPALTEN = `r.id, r.benutzer_id, u.name AS benutzer_name, r.email, r.text, r.kontext,
  r.quelle, r.status, r.notiz, r.angelegt_am, r.geaendert_am`

export class RueckmeldungsDienst {
  constructor(private db: Db) {}

  /** Nimmt eine Meldung an. Kürzt statt abzulehnen — ein 400 ginge hier zulasten des Absenders. */
  nimmAn(eingang: {
    text: string
    email?: string | null
    benutzerId?: string | null
    kontext?: RueckmeldungKontext | null
    quelle?: RueckmeldungQuelle
  }): Rueckmeldung {
    const id = neueSessionId()
    const jetzt = new Date().toISOString()
    const text = eingang.text.trim().slice(0, MAX_TEXT)
    const email = eingang.email?.trim().slice(0, MAX_EMAIL) || null
    this.db
      .prepare(
        `INSERT INTO rueckmeldungen (id, benutzer_id, email, text, kontext, quelle, status, angelegt_am)
         VALUES (?, ?, ?, ?, ?, ?, 'offen', ?)`,
      )
      .run(
        id,
        eingang.benutzerId ?? null,
        email,
        text,
        eingang.kontext ? JSON.stringify(eingang.kontext) : null,
        eingang.quelle ?? 'web',
        jetzt,
      )
    return this.eine(id) as Rueckmeldung
  }

  eine(id: string): Rueckmeldung | null {
    const z = this.db
      .prepare(
        `SELECT ${SPALTEN} FROM rueckmeldungen r
         LEFT JOIN users u ON u.id = r.benutzer_id WHERE r.id = ?`,
      )
      .get(id) as Zeile | undefined
    return z ? zuRueckmeldung(z) : null
  }

  /**
   * Der Eingang, neueste zuerst. Ohne Filter kommt alles — auch Erledigtes:
   * Eine Liste, die stillschweigend etwas weglässt, lässt einen suchen.
   *
   * `rowid` als zweites Sortierkriterium, weil der Zeitstempel nur auf die
   * Millisekunde genau ist: Zwei Meldungen aus derselben Millisekunde stünden
   * sonst in beliebiger, zwischen zwei Aufrufen wechselnder Reihenfolge.
   */
  liste(filter?: { status?: RueckmeldungStatus }): Rueckmeldung[] {
    const wo = filter?.status ? 'WHERE r.status = ?' : ''
    const zeilen = this.db
      .prepare(
        `SELECT ${SPALTEN} FROM rueckmeldungen r
         LEFT JOIN users u ON u.id = r.benutzer_id
         ${wo} ORDER BY r.angelegt_am DESC, r.rowid DESC LIMIT 500`,
      )
      .all(...(filter?.status ? [filter.status] : [])) as Zeile[]
    return zeilen.map(zuRueckmeldung)
  }

  /** Zähler je Status — die Verwaltung zeigt sie an den Filtern. */
  zaehlung(): Record<RueckmeldungStatus | 'gesamt', number> {
    const zeilen = this.db
      .prepare(`SELECT status, COUNT(*) AS n FROM rueckmeldungen GROUP BY status`)
      .all() as Array<{ status: RueckmeldungStatus; n: number }>
    const z = { offen: 0, in_arbeit: 0, erledigt: 0, gesamt: 0 }
    for (const zeile of zeilen) {
      z[zeile.status] = zeile.n
      z.gesamt += zeile.n
    }
    return z
  }

  /** Status und/oder Notiz setzen. Gibt `null` zurück, wenn es die Meldung nicht gibt. */
  aktualisiere(
    id: string,
    aenderung: { status?: RueckmeldungStatus; notiz?: string | null },
  ): Rueckmeldung | null {
    if (!this.eine(id)) return null
    const jetzt = new Date().toISOString()
    if (aenderung.status !== undefined) {
      this.db
        .prepare(`UPDATE rueckmeldungen SET status = ?, geaendert_am = ? WHERE id = ?`)
        .run(aenderung.status, jetzt, id)
    }
    if (aenderung.notiz !== undefined) {
      this.db
        .prepare(`UPDATE rueckmeldungen SET notiz = ?, geaendert_am = ? WHERE id = ?`)
        .run(aenderung.notiz?.trim() || null, jetzt, id)
    }
    return this.eine(id)
  }

  loesche(id: string): boolean {
    return this.db.prepare(`DELETE FROM rueckmeldungen WHERE id = ?`).run(id).changes > 0
  }

  /**
   * Speicherbegrenzung (Art. 5 Abs. 1 lit. e DSGVO): Erledigtes verfällt früher
   * als Offenes. Läuft im täglichen Aufräumlauf mit.
   */
  raeumeAuf(jetzt = new Date()): number {
    const grenze = (tage: number): string =>
      new Date(jetzt.getTime() - tage * 86_400_000).toISOString()
    const a = this.db
      .prepare(`DELETE FROM rueckmeldungen WHERE status = 'erledigt' AND angelegt_am < ?`)
      .run(grenze(FRIST_ERLEDIGT_TAGE)).changes
    const b = this.db
      .prepare(`DELETE FROM rueckmeldungen WHERE status <> 'erledigt' AND angelegt_am < ?`)
      .run(grenze(FRIST_OFFEN_TAGE)).changes
    return a + b
  }
}
