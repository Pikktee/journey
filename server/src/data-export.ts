/**
 * Datenexport — alles, was zu einem Konto gehört, als ZIP (Art. 20 DSGVO).
 *
 * Der einzige Teil von Maptale mit echtem HINTERGRUNDLAUF. Alles andere
 * antwortet in derselben Anfrage oder ist eine Pipeline, die an einer Tour
 * hängt; hier läuft ein Archiv über womöglich zwei Gigabyte durch, während die
 * API weiter bedient.
 *
 * Vier Entscheidungen tragen das, und jede lässt sich „vereinfachen", bis sie
 * kippt:
 *
 * 1. **Gegen Doppelläufe hilft nur die Datenbank.** Zwei Klicks auf denselben
 *    Knopf kommen als zwei Anfragen an, und zwischen „läuft schon einer?" und
 *    dem INSERT liegt ein Fenster, in dem beide dasselbe sehen. Deshalb ein
 *    partieller UNIQUE-Index (`WHERE status = 'laeuft'`, Migration 16): Der
 *    zweite INSERT scheitert an der Datenbank, und `fordereAn` liefert den
 *    vorhandenen Job zurück, statt einen zweiten zu starten.
 * 2. **Medien werden GESPEICHERT, nicht komprimiert.** Fotos und Videos sind
 *    schon komprimiert; sie durch Deflate zu schicken kostet die CPU des ganzen
 *    Servers und spart nichts (an einer echten Tour: 0,4 %). Nur die
 *    JSON-Dateien und die Lies-mich werden gepackt.
 * 3. **Die Frist steht in der Zeile, nicht in einer Konstante.** Sie beginnt
 *    mit der FERTIGSTELLUNG und wird beim Verschicken in die Mail geschrieben;
 *    eine später geänderte Konstante darf einen Link, der in einem Postfach
 *    liegt, nicht rückwirkend verkürzen.
 * 4. **Aufgeräumt wird stündlich, nicht täglich.** Ein Archiv mit allen Fotos
 *    einer Person ist das Gegenteil von „nur so lange wie nötig": Bei einem
 *    täglichen Lauf läge es im ungünstigen Fall 72 statt 48 Stunden herum.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { Readable } from 'node:stream'
import { ZipFile } from 'yazl'
import type { Db } from './db.js'
import { newDataExportId } from './ids.js'
import type { Storage } from './storage.js'

/** Wie lange ein fertiges Archiv abrufbar bleibt. */
export const EXPIRY_HOURS = 48

/** Zustand eines Auftrags, wie ihn die Oberfläche sieht. */
export type DataExportStatus = {
  id: string
  status: 'running' | 'done' | 'failed'
  requestedAt: string
  finishedAt: string | null
  expiresAt: string | null
  bytes: number | null
  files: number | null
}

type ExportRow = {
  id: string
  user_id: string
  status: 'running' | 'done' | 'failed'
  requested_at: string
  finished_at: string | null
  expires_at: string | null
  bytes: number | null
  file_count: number | null
}

const toState = (z: ExportRow): DataExportStatus => ({
  id: z.id,
  status: z.status,
  requestedAt: z.requested_at,
  finishedAt: z.finished_at,
  expiresAt: z.expires_at,
  bytes: z.bytes,
  files: z.file_count,
})

/** Die Datei im Archiv-Ablagebereich — ein Bereich je Auftrag. */
export const ARCHIVE_FILE = 'maptale-export.zip'

export class DataExportService {
  constructor(
    private readonly db: Db,
    /** Eigener Ablagebereich (`daten/exporte/<id>/`), nicht neben den Touren. */
    private readonly archive: Storage,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Der jüngste Auftrag eines Kontos — für die Anzeige im Konto. */
  state2(userId: string): DataExportStatus | null {
    const z = this.db
      .prepare('SELECT * FROM data_exports WHERE user_id = ? ORDER BY requested_at DESC LIMIT 1')
      .get(userId) as ExportRow | undefined
    return z ? toState(z) : null
  }

  /**
   * Einen Auftrag anlegen — oder den laufenden zurückgeben.
   *
   * `neu` sagt dem Aufrufer, ob er den Bau anstoßen und später eine Mail
   * schicken soll. Bei `false` läuft bereits einer: Dann passiert NICHTS
   * weiter, insbesondere geht keine zweite Mail raus.
   */
  request(userId: string): { state2: DataExportStatus; fresh: boolean } {
    const now = this.now().toISOString()
    const id = newDataExportId()
    try {
      this.db
        .prepare(
          `INSERT INTO data_exports (id, user_id, status, requested_at) VALUES (?, ?, 'running', ?)`,
        )
        .run(id, userId, now)
    } catch {
      // Der partielle UNIQUE-Index hat zugeschlagen: Es läuft schon einer.
      // Kein Fehler nach außen — der Wunsch ist ja bereits erfüllt.
      const running = this.db
        .prepare(`SELECT * FROM data_exports WHERE user_id = ? AND status = 'running'`)
        .get(userId) as ExportRow | undefined
      if (running) return { state2: toState(running), fresh: false }
      throw new Error('Export konnte nicht angelegt werden')
    }
    return { state2: this.state2(userId)!, fresh: true }
  }

  /** Auftrag als fertig eintragen und die Frist setzen. */
  finish(id: string, bytes: number, fileCount: number): DataExportStatus | null {
    const finishedAt2 = this.now()
    const expiresAt2 = new Date(finishedAt2.getTime() + EXPIRY_HOURS * 60 * 60 * 1000)
    this.db
      .prepare(
        `UPDATE data_exports SET status = 'done', finished_at = ?, expires_at = ?, bytes = ?, file_count = ?
         WHERE id = ? AND status = 'running'`,
      )
      .run(finishedAt2.toISOString(), expiresAt2.toISOString(), bytes, fileCount, id)
    const z = this.db.prepare('SELECT * FROM data_exports WHERE id = ?').get(id) as
      ExportRow | undefined
    return z ? toState(z) : null
  }

  /** Auftrag als gescheitert eintragen — der Grund bleibt intern. */
  reportError(id: string, reason: string): void {
    this.db
      .prepare(
        `UPDATE data_exports SET status = 'failed', error = ? WHERE id = ? AND status = 'running'`,
      )
      .run(reason.slice(0, 500), id)
  }

  /** Ein abrufbares Archiv: fertig UND innerhalb der Frist. */
  downloadable(id: string): DataExportStatus | null {
    const z = this.db
      .prepare(`SELECT * FROM data_exports WHERE id = ? AND status = 'done'`)
      .get(id) as ExportRow | undefined
    if (!z?.expires_at) return null
    return new Date(z.expires_at) > this.now() ? toState(z) : null
  }

  /**
   * Abgelaufene Archive löschen — Datei zuerst, dann die Zeile.
   *
   * In dieser Reihenfolge, weil ein Abbruch dazwischen sonst eine Datei
   * hinterließe, zu der es keinen Eintrag mehr gibt: unauffindbar und trotzdem
   * da. Andersherum bleibt schlimmstenfalls eine Zeile ohne Datei stehen, und
   * die nächste Runde räumt sie weg.
   *
   * Gescheiterte Aufträge gehen nach derselben Frist: Ihre Zeile ist nur noch
   * die Auskunft „das ging schief", und die braucht niemand nach zwei Tagen.
   * Ein Lauf, der länger als sechs Stunden „läuft", gilt als abgestürzt —
   * sonst blockierte er das Konto für immer (der UNIQUE-Index lässt keinen
   * zweiten zu).
   */
  async purgeExpired(): Promise<number> {
    const now = this.now()
    const cutoff = now.toISOString()
    const stale = new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString()
    this.db
      .prepare(
        `UPDATE data_exports SET status = 'failed', error = 'Abgebrochen (Neustart oder Absturz)'
                WHERE status = 'running' AND requested_at < ?`,
      )
      .run(stale)
    const previous = this.db
      .prepare(
        `SELECT id FROM data_exports
         WHERE (status = 'done' AND expires_at <= ?)
            OR (status = 'failed' AND requested_at <= ?)`,
      )
      .all(cutoff, new Date(now.getTime() - EXPIRY_HOURS * 60 * 60 * 1000).toISOString()) as Array<{
      id: string
    }>
    for (const { id } of previous) {
      await this.archive.removeTour(id).catch(() => undefined)
      this.db.prepare('DELETE FROM data_exports WHERE id = ?').run(id)
    }
    return previous.length
  }

  /**
   * Der Download-Token: Auftrags-ID plus Signatur.
   *
   * Er trägt keine Frist in sich — die steht in der Zeile, und der Abruf prüft
   * sie dort. Ein Ablauf IM Token wäre eine zweite Wahrheit daneben, und beim
   * vorzeitigen Löschen (Konto weg) hülfe er gar nicht: Was zählt, ist, ob es
   * die Zeile noch gibt.
   */
  static token(id: string, secret: string): string {
    const signature = createHmac('sha256', secret).update(`export:${id}`).digest('base64url')
    return `${id}.${signature}`
  }

  /** Token → Auftrags-ID; null bei Unfug oder falscher Signatur. */
  static byToken(token: string, secret: string): string | null {
    const dot = token.lastIndexOf('.')
    if (dot <= 0) return null
    const id = token.slice(0, dot)
    const signature = token.slice(dot + 1)
    const expected = createHmac('sha256', secret).update(`export:${id}`).digest('base64url')
    if (signature.length !== expected.length) return null
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) ? id : null
  }
}

/** Eine Datei, wie sie ins Archiv geht. */
export type ArchiveEntry = {
  /** Pfad IM Archiv, immer mit Schrägstrichen. */
  name: string
  /** Kleine Inhalte direkt; große kommen als Stream. */
  content: Buffer | string | (() => Readable)
  /** Schon komprimiert? Dann nicht noch einmal durch Deflate. */
  packed?: boolean
}

/**
 * Baut das ZIP und gibt seinen Lesestrom zurück.
 *
 * Kein Zwischenspeichern im Arbeitsspeicher: yazl schreibt fortlaufend, der
 * Aufrufer schiebt den Strom direkt in die Ablage. Bei zwei Gigabyte Medien
 * ist das der Unterschied zwischen „läuft nebenher" und „Prozess weg".
 */
export function buildArchive(entries: ArchiveEntry[]): Readable {
  const zip = new ZipFile()
  for (const e of entries) {
    const opts = { compress: !e.packed }
    if (typeof e.content === 'function') zip.addReadStream(e.content(), e.name, opts)
    else
      zip.addBuffer(
        Buffer.isBuffer(e.content) ? e.content : Buffer.from(e.content, 'utf8'),
        e.name,
        opts,
      )
  }
  zip.end()
  return zip.outputStream as Readable
}
