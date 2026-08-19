// Einladungen und der Schalter „Registrierung nur mit Code".
//
// Beides gehört zusammen: Der Schalter entscheidet, ob eine Einladung nötig
// ist, die Einladung ist der Schlüssel dazu. Er liegt in der `einstellungen`-
// Tabelle und nicht in der Umgebung, weil er zur LAUFZEIT umgelegt wird — eine
// Env-Variable bräuchte für jede Änderung einen Neustart des Containers.
//
// Eine Einladung ist EINMAL einlösbar: Sie gilt einer Person. Wer mehrere
// Menschen einlädt, erzeugt mehrere Codes — das kostet einen Klick und macht
// dafür jede Zeile der Liste zu einer beantwortbaren Frage („wer ist das, und
// ist er schon da?"). Eingelöste Einladungen bleiben stehen; sie sind die
// einzige Stelle, an der später noch steht, wer wen hereingeholt hat.

import type { Db } from '../db.js'
import { neuerEinladungsCode } from '../ids.js'

/** Vorgabe, wenn der Aufrufer keine Gültigkeit nennt: ein Monat. */
export const GUELTIG_TAGE_STANDARD = 30

export type EinladungsZustand = 'offen' | 'eingeloest' | 'abgelaufen'

export interface Einladung {
  code: string
  notiz: string | null
  erstelltAm: string
  /** E-Mail des Erstellers; null, wenn das Konto inzwischen weg ist */
  erstelltVon: string | null
  /** ISO-Zeitpunkt oder null = läuft nicht ab */
  ablauf: string | null
  eingeloestAm: string | null
  eingeloestVon: string | null
  zustand: EinladungsZustand
}

/** Warum ein Code nicht zieht — Klartext für die Antwort an den Anmelder. */
export type EinladungsFehler = 'unbekannt' | 'verbraucht' | 'abgelaufen'

const SCHLUESSEL_PFLICHT = 'einladung_pflicht'

interface EinladungsZeile {
  code: string
  notiz: string | null
  erstellt_am: string
  ersteller: string | null
  ablauf: string | null
  eingeloest_am: string | null
  einloeser: string | null
}

export class EinladungsDienst {
  constructor(private readonly db: Db) {}

  // — Schalter —

  /**
   * Ist ein Einladungscode Pflicht? Vorgabe: ja.
   *
   * Die Vorgabe steht bewusst auf „zu": Eine frisch aufgesetzte Instanz soll
   * nicht offen im Netz stehen, bis jemand daran denkt, sie zu schließen.
   */
  pflicht(): boolean {
    const zeile = this.db
      .prepare('SELECT wert FROM einstellungen WHERE schluessel = ?')
      .get(SCHLUESSEL_PFLICHT) as { wert: string } | undefined
    return zeile ? zeile.wert === '1' : true
  }

  setzePflicht(wert: boolean): void {
    this.db
      .prepare(
        `INSERT INTO einstellungen (schluessel, wert) VALUES (?, ?)
         ON CONFLICT(schluessel) DO UPDATE SET wert = excluded.wert`,
      )
      .run(SCHLUESSEL_PFLICHT, wert ? '1' : '0')
  }

  // — Einladungen —

  erstelle(
    erstellerId: string,
    notiz: string | null,
    gueltigTage: number | null = GUELTIG_TAGE_STANDARD,
  ): Einladung {
    const code = neuerEinladungsCode()
    const jetzt = new Date()
    const ablauf =
      gueltigTage && gueltigTage > 0
        ? new Date(jetzt.getTime() + gueltigTage * 24 * 60 * 60 * 1000).toISOString()
        : null
    this.db
      .prepare(
        'INSERT INTO einladungen (code, notiz, erstellt_von, erstellt_am, ablauf) VALUES (?, ?, ?, ?, ?)',
      )
      .run(code, notiz?.trim() || null, erstellerId, jetzt.toISOString(), ablauf)
    return this.alle().find((e) => e.code === code) as Einladung
  }

  alle(): Einladung[] {
    const zeilen = this.db
      .prepare(
        `SELECT e.code, e.notiz, e.erstellt_am, e.ablauf, e.eingeloest_am,
                ersteller.email AS ersteller, einloeser.email AS einloeser
         FROM einladungen e
         LEFT JOIN users ersteller ON ersteller.id = e.erstellt_von
         LEFT JOIN users einloeser ON einloeser.id = e.eingeloest_von
         ORDER BY e.erstellt_am DESC`,
      )
      .all() as EinladungsZeile[]
    const jetzt = Date.now()
    return zeilen.map((z) => ({
      code: z.code,
      notiz: z.notiz,
      erstelltAm: z.erstellt_am,
      erstelltVon: z.ersteller,
      ablauf: z.ablauf,
      eingeloestAm: z.eingeloest_am,
      eingeloestVon: z.einloeser,
      zustand: z.eingeloest_am
        ? 'eingeloest'
        : z.ablauf && Date.parse(z.ablauf) < jetzt
          ? 'abgelaufen'
          : ('offen' as EinladungsZustand),
    }))
  }

  /** Entfernt eine Einladung; false, wenn es den Code nicht (mehr) gibt. */
  widerrufe(code: string): boolean {
    return this.db.prepare('DELETE FROM einladungen WHERE code = ?').run(normiere(code)).changes > 0
  }

  /**
   * Prüft einen Code, ohne ihn zu verbrauchen — für die Antwort VOR dem Anlegen
   * des Kontos. Null heißt: geht.
   */
  pruefe(code: string): EinladungsFehler | null {
    const zeile = this.db
      .prepare('SELECT ablauf, eingeloest_am FROM einladungen WHERE code = ?')
      .get(normiere(code)) as { ablauf: string | null; eingeloest_am: string | null } | undefined
    if (!zeile) return 'unbekannt'
    if (zeile.eingeloest_am) return 'verbraucht'
    if (zeile.ablauf && Date.parse(zeile.ablauf) < Date.now()) return 'abgelaufen'
    return null
  }

  /**
   * Verbraucht den Code für `userId` — atomar über eine bedingte UPDATE-Klausel.
   *
   * `false` heißt: Zwischen `pruefe` und hier war jemand schneller (oder der
   * Code lief in derselben Sekunde ab). Der Aufrufer muss dann das eben
   * angelegte Konto wieder zurücknehmen; ein zweistufiger Ablauf ohne diese
   * Klemme würde denselben Code beliebig oft einlösbar machen.
   */
  loeseEin(code: string, userId: string): boolean {
    const erg = this.db
      .prepare(
        `UPDATE einladungen SET eingeloest_von = ?, eingeloest_am = ?
         WHERE code = ? AND eingeloest_am IS NULL AND (ablauf IS NULL OR ablauf > ?)`,
      )
      .run(userId, new Date().toISOString(), normiere(code), new Date().toISOString())
    return erg.changes > 0
  }
}

/**
 * Codes werden abgetippt: Kleinschreibung und Leerzeichen sind kein Fehler des
 * Eingeladenen, sondern einer der Eingabe. Der Bindestrich bleibt erhalten, er
 * gehört zur Form.
 */
const normiere = (code: string): string => code.trim().toUpperCase().replace(/\s+/g, '')
