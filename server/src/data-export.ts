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

type Zeile = {
  id: string
  user_id: string
  status: 'running' | 'done' | 'failed'
  requested_at: string
  finished_at: string | null
  expires_at: string | null
  bytes: number | null
  file_count: number | null
}

const alsStand = (z: Zeile): DataExportStatus => ({
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
    private readonly jetzt: () => Date = () => new Date(),
  ) {}

  /** Der jüngste Auftrag eines Kontos — für die Anzeige im Konto. */
  stand(benutzerId: string): DataExportStatus | null {
    const z = this.db
      .prepare('SELECT * FROM data_exports WHERE user_id = ? ORDER BY requested_at DESC LIMIT 1')
      .get(benutzerId) as Zeile | undefined
    return z ? alsStand(z) : null
  }

  /**
   * Einen Auftrag anlegen — oder den laufenden zurückgeben.
   *
   * `neu` sagt dem Aufrufer, ob er den Bau anstoßen und später eine Mail
   * schicken soll. Bei `false` läuft bereits einer: Dann passiert NICHTS
   * weiter, insbesondere geht keine zweite Mail raus.
   */
  fordereAn(benutzerId: string): { stand: DataExportStatus; neu: boolean } {
    const jetzt = this.jetzt().toISOString()
    const id = newDataExportId()
    try {
      this.db
        .prepare(
          `INSERT INTO data_exports (id, user_id, status, requested_at) VALUES (?, ?, 'running', ?)`,
        )
        .run(id, benutzerId, jetzt)
    } catch {
      // Der partielle UNIQUE-Index hat zugeschlagen: Es läuft schon einer.
      // Kein Fehler nach außen — der Wunsch ist ja bereits erfüllt.
      const laufend = this.db
        .prepare(`SELECT * FROM data_exports WHERE user_id = ? AND status = 'running'`)
        .get(benutzerId) as Zeile | undefined
      if (laufend) return { stand: alsStand(laufend), neu: false }
      throw new Error('Export konnte nicht angelegt werden')
    }
    return { stand: this.stand(benutzerId)!, neu: true }
  }

  /** Auftrag als fertig eintragen und die Frist setzen. */
  melde(id: string, bytes: number, dateien: number): DataExportStatus | null {
    const fertig = this.jetzt()
    const ablauf = new Date(fertig.getTime() + EXPIRY_HOURS * 60 * 60 * 1000)
    this.db
      .prepare(
        `UPDATE data_exports SET status = 'done', finished_at = ?, expires_at = ?, bytes = ?, file_count = ?
         WHERE id = ? AND status = 'running'`,
      )
      .run(fertig.toISOString(), ablauf.toISOString(), bytes, dateien, id)
    const z = this.db.prepare('SELECT * FROM data_exports WHERE id = ?').get(id) as
      Zeile | undefined
    return z ? alsStand(z) : null
  }

  /** Auftrag als gescheitert eintragen — der Grund bleibt intern. */
  meldeFehler(id: string, grund: string): void {
    this.db
      .prepare(
        `UPDATE data_exports SET status = 'failed', error = ? WHERE id = ? AND status = 'running'`,
      )
      .run(grund.slice(0, 500), id)
  }

  /** Ein abrufbares Archiv: fertig UND innerhalb der Frist. */
  abrufbar(id: string): DataExportStatus | null {
    const z = this.db
      .prepare(`SELECT * FROM data_exports WHERE id = ? AND status = 'done'`)
      .get(id) as Zeile | undefined
    if (!z?.expires_at) return null
    return new Date(z.expires_at) > this.jetzt() ? alsStand(z) : null
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
  async raeumeAuf(): Promise<number> {
    const jetzt = this.jetzt()
    const grenze = jetzt.toISOString()
    const haenger = new Date(jetzt.getTime() - 6 * 60 * 60 * 1000).toISOString()
    this.db
      .prepare(
        `UPDATE data_exports SET status = 'failed', error = 'Abgebrochen (Neustart oder Absturz)'
                WHERE status = 'running' AND requested_at < ?`,
      )
      .run(haenger)
    const alt = this.db
      .prepare(
        `SELECT id FROM data_exports
         WHERE (status = 'done' AND expires_at <= ?)
            OR (status = 'failed' AND requested_at <= ?)`,
      )
      .all(
        grenze,
        new Date(jetzt.getTime() - EXPIRY_HOURS * 60 * 60 * 1000).toISOString(),
      ) as Array<{ id: string }>
    for (const { id } of alt) {
      await this.archive.loescheTour(id).catch(() => undefined)
      this.db.prepare('DELETE FROM data_exports WHERE id = ?').run(id)
    }
    return alt.length
  }

  /**
   * Der Download-Token: Auftrags-ID plus Signatur.
   *
   * Er trägt keine Frist in sich — die steht in der Zeile, und der Abruf prüft
   * sie dort. Ein Ablauf IM Token wäre eine zweite Wahrheit daneben, und beim
   * vorzeitigen Löschen (Konto weg) hülfe er gar nicht: Was zählt, ist, ob es
   * die Zeile noch gibt.
   */
  static token(id: string, geheimnis: string): string {
    const signatur = createHmac('sha256', geheimnis).update(`export:${id}`).digest('base64url')
    return `${id}.${signatur}`
  }

  /** Token → Auftrags-ID; null bei Unfug oder falscher Signatur. */
  static ausToken(token: string, geheimnis: string): string | null {
    const punkt = token.lastIndexOf('.')
    if (punkt <= 0) return null
    const id = token.slice(0, punkt)
    const signatur = token.slice(punkt + 1)
    const erwartet = createHmac('sha256', geheimnis).update(`export:${id}`).digest('base64url')
    if (signatur.length !== erwartet.length) return null
    return timingSafeEqual(Buffer.from(signatur), Buffer.from(erwartet)) ? id : null
  }
}

/** Eine Datei, wie sie ins Archiv geht. */
export type ArchiveEntry = {
  /** Pfad IM Archiv, immer mit Schrägstrichen. */
  name: string
  /** Kleine Inhalte direkt; große kommen als Stream. */
  inhalt: Buffer | string | (() => Readable)
  /** Schon komprimiert? Dann nicht noch einmal durch Deflate. */
  gepackt?: boolean
}

/**
 * Baut das ZIP und gibt seinen Lesestrom zurück.
 *
 * Kein Zwischenspeichern im Arbeitsspeicher: yazl schreibt fortlaufend, der
 * Aufrufer schiebt den Strom direkt in die Ablage. Bei zwei Gigabyte Medien
 * ist das der Unterschied zwischen „läuft nebenher" und „Prozess weg".
 */
export function buildArchive(eintraege: ArchiveEntry[]): Readable {
  const zip = new ZipFile()
  for (const e of eintraege) {
    const opts = { compress: !e.gepackt }
    if (typeof e.inhalt === 'function') zip.addReadStream(e.inhalt(), e.name, opts)
    else
      zip.addBuffer(
        Buffer.isBuffer(e.inhalt) ? e.inhalt : Buffer.from(e.inhalt, 'utf8'),
        e.name,
        opts,
      )
  }
  zip.end()
  return zip.outputStream as Readable
}
