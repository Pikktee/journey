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
export type InvitationError = 'unknown' | 'used' | 'expired'

const SETTING_INVITATION_REQUIRED = 'invitation_required'

interface InvitationRow {
  code: string
  note: string | null
  created_at: string
  created_by_email: string | null
  expires_at: string | null
  redeemed_at: string | null
  redeemed_by_email: string | null
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
  required(): boolean {
    const row = this.db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get(SETTING_INVITATION_REQUIRED) as { value: string } | undefined
    return row ? row.value === '1' : true
  }

  setRequired(value: boolean): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(SETTING_INVITATION_REQUIRED, value ? '1' : '0')
  }

  // — Einladungen —

  create(
    createdById: string,
    note: string | null,
    validDays: number | null = DEFAULT_VALID_DAYS,
  ): Invitation {
    const code = newInvitationCode()
    const now = new Date()
    const expiresAt =
      validDays && validDays > 0
        ? new Date(now.getTime() + validDays * 24 * 60 * 60 * 1000).toISOString()
        : null
    this.db
      .prepare(
        'INSERT INTO invitations (code, note, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(code, note?.trim() || null, createdById, now.toISOString(), expiresAt)
    return this.all().find((e) => e.code === code) as Invitation
  }

  all(): Invitation[] {
    const rows = this.db
      .prepare(
        `SELECT e.code, e.note, e.created_at, e.expires_at, e.redeemed_at,
                createdBy.email AS created_by_email, redeemedBy.email AS redeemed_by_email
         FROM invitations e
         LEFT JOIN users createdBy ON createdBy.id = e.created_by
         LEFT JOIN users redeemedBy ON redeemedBy.id = e.redeemed_by
         ORDER BY e.created_at DESC`,
      )
      .all() as InvitationRow[]
    const now = Date.now()
    return rows.map((row) => ({
      code: row.code,
      note: row.note,
      createdAt: row.created_at,
      createdBy: row.created_by_email,
      expiresAt: row.expires_at,
      redeemedAt: row.redeemed_at,
      redeemedBy: row.redeemed_by_email,
      state: row.redeemed_at
        ? 'redeemed'
        : row.expires_at && Date.parse(row.expires_at) < now
          ? 'expired'
          : ('open' as InvitationStatus),
    }))
  }

  /** Entfernt eine Einladung; false, wenn es den Code nicht (mehr) gibt. */
  revoke(code: string): boolean {
    return (
      this.db.prepare('DELETE FROM invitations WHERE code = ?').run(normalize(code)).changes > 0
    )
  }

  /**
   * Prüft einen Code, ohne ihn zu verbrauchen — für die Antwort VOR dem Anlegen
   * des Kontos. Null heißt: geht.
   */
  check(code: string): InvitationError | null {
    const row = this.db
      .prepare('SELECT expires_at, redeemed_at FROM invitations WHERE code = ?')
      .get(normalize(code)) as { expires_at: string | null; redeemed_at: string | null } | undefined
    if (!row) return 'unknown'
    if (row.redeemed_at) return 'used'
    if (row.expires_at && Date.parse(row.expires_at) < Date.now()) return 'expired'
    return null
  }

  /**
   * Verbraucht den Code für `userId` — atomar über eine bedingte UPDATE-Klausel.
   *
   * `false` heißt: Zwischen `check` und hier war jemand schneller (oder der
   * Code lief in derselben Sekunde ab). Der Aufrufer muss dann das eben
   * angelegte Konto wieder zurücknehmen; ein zweistufiger Ablauf ohne diese
   * Klemme würde denselben Code beliebig oft einlösbar machen.
   */
  redeem(code: string, userId: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE invitations SET redeemed_by = ?, redeemed_at = ?
         WHERE code = ? AND redeemed_at IS NULL AND (expires_at IS NULL OR expires_at > ?)`,
      )
      .run(userId, new Date().toISOString(), normalize(code), new Date().toISOString())
    return result.changes > 0
  }
}

/**
 * Codes werden abgetippt: Kleinschreibung und Leerzeichen sind kein Fehler des
 * Eingeladenen, sondern einer der Eingabe. Der Bindestrich bleibt erhalten, er
 * gehört zur Form.
 */
const normalize = (code: string): string => code.trim().toUpperCase().replace(/\s+/g, '')
