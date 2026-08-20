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
import { newSessionId } from './ids.js'

/** Erledigte Meldungen verfallen; der Sachverhalt steckt dann im Code oder in einer Notiz. */
export const DONE_RETENTION_DAYS = 180
/** Offene Meldungen halten länger, aber nicht ewig — sonst wächst der Eingang nur. */
export const OPEN_RETENTION_DAYS = 540

/**
 * Ein Freitextfeld, aber kein Aufsatz: Was länger ist, gehört in eine Mail.
 * Der Server klemmt hart, damit ein Skript die Tabelle nicht vollschreibt.
 */
export const MAX_TEXT = 4000
/** Die Adresse ist freiwillig; die Länge folgt der Spezifikation für Mail-Adressen. */
export const MAX_EMAIL = 254

export type FeedbackStatus = 'open' | 'in_progress' | 'done'
export type FeedbackSource = 'web' | 'app'

/**
 * Was der Client freiwillig mitschickt. Bewusst offen typisiert und als JSON
 * gespeichert: Die App kennt Angaben, die der Browser nie hat (Gerätemodell,
 * Android-Fassung), und eine neue Angabe soll keine Migration kosten.
 */
export type FeedbackContext = Record<string, string | number | boolean | null>

export interface Feedback {
  id: string
  userId: string | null
  /** Anzeigename des Kontos, falls die Meldung von einem Angemeldeten kam. */
  userName: string | null
  email: string | null
  text: string
  context: FeedbackContext | null
  source: FeedbackSource
  status: FeedbackStatus
  note: string | null
  createdAt: string
  updatedAt: string | null
}

type Zeile = {
  id: string
  user_id: string | null
  user_name: string | null
  email: string | null
  text: string
  context: string | null
  source: FeedbackSource
  status: FeedbackStatus
  note: string | null
  created_at: string
  updated_at: string | null
}

function zuRueckmeldung(z: Zeile): Feedback {
  let kontext: FeedbackContext | null = null
  if (z.context) {
    // Kaputtes JSON darf die Liste nicht sprengen: Eine unlesbare Angabe ist
    // dasselbe wie keine — der Text der Meldung bleibt lesbar.
    try {
      kontext = JSON.parse(z.context) as FeedbackContext
    } catch {
      kontext = null
    }
  }
  return {
    id: z.id,
    userId: z.user_id,
    userName: z.user_name,
    email: z.email,
    text: z.text,
    context: kontext,
    source: z.source,
    status: z.status,
    note: z.note,
    createdAt: z.created_at,
    updatedAt: z.updated_at,
  }
}

const SPALTEN = `r.id, r.user_id, u.name AS user_name, r.email, r.text, r.context,
  r.source, r.status, r.note, r.created_at, r.updated_at`

export class FeedbackService {
  constructor(private db: Db) {}

  /** Nimmt eine Meldung an. Kürzt statt abzulehnen — ein 400 ginge hier zulasten des Absenders. */
  nimmAn(eingang: {
    text: string
    email?: string | null
    userId?: string | null
    context?: FeedbackContext | null
    source?: FeedbackSource
  }): Feedback {
    const id = newSessionId()
    const jetzt = new Date().toISOString()
    const text = eingang.text.trim().slice(0, MAX_TEXT)
    const email = eingang.email?.trim().slice(0, MAX_EMAIL) || null
    this.db
      .prepare(
        `INSERT INTO feedback (id, user_id, email, text, context, source, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`,
      )
      .run(
        id,
        eingang.userId ?? null,
        email,
        text,
        eingang.context ? JSON.stringify(eingang.context) : null,
        eingang.source ?? 'web',
        jetzt,
      )
    return this.eine(id) as Feedback
  }

  eine(id: string): Feedback | null {
    const z = this.db
      .prepare(
        `SELECT ${SPALTEN} FROM feedback r
         LEFT JOIN users u ON u.id = r.user_id WHERE r.id = ?`,
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
  liste(filter?: { status?: FeedbackStatus }): Feedback[] {
    const wo = filter?.status ? 'WHERE r.status = ?' : ''
    const zeilen = this.db
      .prepare(
        `SELECT ${SPALTEN} FROM feedback r
         LEFT JOIN users u ON u.id = r.user_id
         ${wo} ORDER BY r.created_at DESC, r.rowid DESC LIMIT 500`,
      )
      .all(...(filter?.status ? [filter.status] : [])) as Zeile[]
    return zeilen.map(zuRueckmeldung)
  }

  /** Zähler je Status — die Verwaltung zeigt sie an den Filtern. */
  zaehlung(): Record<FeedbackStatus | 'total', number> {
    const zeilen = this.db
      .prepare(`SELECT status, COUNT(*) AS n FROM feedback GROUP BY status`)
      .all() as Array<{ status: FeedbackStatus; n: number }>
    const z = { open: 0, in_progress: 0, done: 0, total: 0 }
    for (const zeile of zeilen) {
      z[zeile.status] = zeile.n
      z.total += zeile.n
    }
    return z
  }

  /** Status und/oder Notiz setzen. Gibt `null` zurück, wenn es die Meldung nicht gibt. */
  aktualisiere(
    id: string,
    aenderung: { status?: FeedbackStatus; note?: string | null },
  ): Feedback | null {
    if (!this.eine(id)) return null
    const jetzt = new Date().toISOString()
    if (aenderung.status !== undefined) {
      this.db
        .prepare(`UPDATE feedback SET status = ?, updated_at = ? WHERE id = ?`)
        .run(aenderung.status, jetzt, id)
    }
    if (aenderung.note !== undefined) {
      this.db
        .prepare(`UPDATE feedback SET note = ?, updated_at = ? WHERE id = ?`)
        .run(aenderung.note?.trim() || null, jetzt, id)
    }
    return this.eine(id)
  }

  loesche(id: string): boolean {
    return this.db.prepare(`DELETE FROM feedback WHERE id = ?`).run(id).changes > 0
  }

  /**
   * Speicherbegrenzung (Art. 5 Abs. 1 lit. e DSGVO): Erledigtes verfällt früher
   * als Offenes. Läuft im täglichen Aufräumlauf mit.
   */
  raeumeAuf(jetzt = new Date()): number {
    const grenze = (tage: number): string =>
      new Date(jetzt.getTime() - tage * 86_400_000).toISOString()
    const a = this.db
      .prepare(`DELETE FROM feedback WHERE status = 'done' AND created_at < ?`)
      .run(grenze(DONE_RETENTION_DAYS)).changes
    const b = this.db
      .prepare(`DELETE FROM feedback WHERE status <> 'done' AND created_at < ?`)
      .run(grenze(OPEN_RETENTION_DAYS)).changes
    return a + b
  }
}
