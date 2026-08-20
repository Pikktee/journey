// Einladungen und der Schalter „Registrierung nur mit Code".
//
// Beides gehört zusammen: Der Schalter entscheidet, ob eine Einladung nötig
// ist, die Einladung ist der Schlüssel dazu. Er liegt in der `settings`-
// Tabelle und nicht in der Umgebung, weil er zur LAUFZEIT umgelegt wird — eine
// Env-Variable bräuchte für jede Änderung einen Neustart des Containers.
//
// Eine Einladung ist EINMAL einlösbar: Sie gilt einer Person. Wer mehrere
// Menschen einlädt, erzeugt mehrere Codes — das kostet einen Klick und macht
// dafür jede Zeile der Liste zu einer beantwortbaren Frage („wer ist das, und
// ist er schon da?"). Eingelöste Einladungen bleiben stehen; sie sind die
// einzige Stelle, an der später noch steht, wer wen hereingeholt hat.

import type { Db } from '../db.js'
import { newInvitationCode } from '../ids.js'

/** Vorgabe, wenn der Aufrufer keine Gültigkeit nennt: ein Monat. */
export const DEFAULT_VALID_DAYS = 30

export type InvitationStatus = 'open' | 'redeemed' | 'expired'

export interface Invitation {
  code: string
  note: string | null
  createdAt: string
  /** E-Mail des Erstellers; null, wenn das Konto inzwischen weg ist */
  createdBy: string | null
  /** ISO-Zeitpunkt oder null = läuft nicht ab */
  expiresAt: string | null
  redeemedAt: string | null
  redeemedBy: string | null
  state: InvitationStatus
}

/** Warum ein Code nicht zieht — Klartext für die Antwort an den Anmelder. */
export type InvitationError = 'unbekannt' | 'verbraucht' | 'abgelaufen'

const SCHLUESSEL_PFLICHT = 'invitation_required'

interface EinladungsZeile {
  code: string
  note: string | null
  created_at: string
  ersteller: string | null
  expires_at: string | null
  redeemed_at: string | null
  einloeser: string | null
}

export class InvitationService {
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
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get(SCHLUESSEL_PFLICHT) as { value: string } | undefined
    return zeile ? zeile.value === '1' : true
  }

  setzePflicht(wert: boolean): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(SCHLUESSEL_PFLICHT, wert ? '1' : '0')
  }

  // — Einladungen —

  erstelle(
    erstellerId: string,
    notiz: string | null,
    gueltigTage: number | null = DEFAULT_VALID_DAYS,
  ): Invitation {
    const code = newInvitationCode()
    const jetzt = new Date()
    const ablauf =
      gueltigTage && gueltigTage > 0
        ? new Date(jetzt.getTime() + gueltigTage * 24 * 60 * 60 * 1000).toISOString()
        : null
    this.db
      .prepare(
        'INSERT INTO invitations (code, note, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(code, notiz?.trim() || null, erstellerId, jetzt.toISOString(), ablauf)
    return this.alle().find((e) => e.code === code) as Invitation
  }

  alle(): Invitation[] {
    const zeilen = this.db
      .prepare(
        `SELECT e.code, e.note, e.created_at, e.expires_at, e.redeemed_at,
                ersteller.email AS ersteller, einloeser.email AS einloeser
         FROM invitations e
         LEFT JOIN users ersteller ON ersteller.id = e.created_by
         LEFT JOIN users einloeser ON einloeser.id = e.redeemed_by
         ORDER BY e.created_at DESC`,
      )
      .all() as EinladungsZeile[]
    const jetzt = Date.now()
    return zeilen.map((z) => ({
      code: z.code,
      note: z.note,
      createdAt: z.created_at,
      createdBy: z.ersteller,
      expiresAt: z.expires_at,
      redeemedAt: z.redeemed_at,
      redeemedBy: z.einloeser,
      state: z.redeemed_at
        ? 'redeemed'
        : z.expires_at && Date.parse(z.expires_at) < jetzt
          ? 'expired'
          : ('open' as InvitationStatus),
    }))
  }

  /** Entfernt eine Einladung; false, wenn es den Code nicht (mehr) gibt. */
  widerrufe(code: string): boolean {
    return this.db.prepare('DELETE FROM invitations WHERE code = ?').run(normiere(code)).changes > 0
  }

  /**
   * Prüft einen Code, ohne ihn zu verbrauchen — für die Antwort VOR dem Anlegen
   * des Kontos. Null heißt: geht.
   */
  pruefe(code: string): InvitationError | null {
    const zeile = this.db
      .prepare('SELECT expires_at, redeemed_at FROM invitations WHERE code = ?')
      .get(normiere(code)) as { expires_at: string | null; redeemed_at: string | null } | undefined
    if (!zeile) return 'unbekannt'
    if (zeile.redeemed_at) return 'verbraucht'
    if (zeile.expires_at && Date.parse(zeile.expires_at) < Date.now()) return 'abgelaufen'
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
        `UPDATE invitations SET redeemed_by = ?, redeemed_at = ?
         WHERE code = ? AND redeemed_at IS NULL AND (expires_at IS NULL OR expires_at > ?)`,
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
