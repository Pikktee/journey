// Auth-Kern: Benutzer, Sessions (Web/Studio, httpOnly-Cookie) und API-Tokens
// (Android-App, `Authorization: Bearer …`). Mehrbenutzer-Fundament ab Tag 1 —
// M9 setzt Registrierung/Passwort-Reset oben drauf, ohne dass sich hier die
// Struktur ändert. Tokens werden nur als SHA-256-Hash gespeichert; das Klartext-
// Token sieht ausschließlich die Antwort des Login-Aufrufs.

import { createHash, timingSafeEqual } from 'node:crypto'
import type { Db } from '../db.js'
import { neueSessionId, neuesTokenSecret, neueUserId } from '../ids.js'
import { hashePasswort, pruefePasswort } from './passwort.js'

export interface Benutzer {
  id: string
  email: string
  name: string
}

/**
 * Das öffentliche Profil — bewusst getrennt vom Konto.
 *
 * `anzeigename` ist NICHT der Klarname aus der Registrierung: wer sich mit
 * seinem echten Namen anmeldet, soll ihn nicht nebenbei veröffentlichen. Ohne
 * gesetzten Anzeigenamen erscheint eine öffentliche Tour ohne Urheber.
 */
export interface Profil {
  anzeigename: string | null
  bio: string | null
  /** Dateiname im Benutzer-Storage; null = kein Bild */
  avatar: string | null
  sichtbarkeit: 'private' | 'public'
}

/** Änderungswunsch am Profil; fehlende Felder bleiben, wie sie sind. */
export interface ProfilAenderung {
  anzeigename?: string
  bio?: string
  sichtbarkeit?: 'private' | 'public'
}

/** Leerer oder nur aus Leerraum bestehender Text heißt: Feld leeren. */
const leerAlsNull = (wert: string): string | null => wert.trim() || null

export type MailZweck = 'verify' | 'reset'

const SESSION_DAUER_MS = 30 * 24 * 60 * 60 * 1000 // 30 Tage
// Lebensdauer der Einmal-Token: E-Mail-Bestätigung großzügig, Passwort-Reset kurz.
const MAIL_TOKEN_DAUER_MS: Record<MailZweck, number> = {
  verify: 24 * 60 * 60 * 1000, // 24 h
  reset: 60 * 60 * 1000, // 1 h
}

const sha256 = (wert: string): string => createHash('sha256').update(wert).digest('hex')

export class AuthDienst {
  constructor(private readonly db: Db) {}

  /** Legt den Seed-Benutzer an, falls die Datenbank noch leer ist (Erststart). */
  async seedeAdmin(email: string | null, passwort: string | null): Promise<void> {
    const anzahl = (this.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n
    if (anzahl > 0 || !email || !passwort) return
    await this.legeBenutzerAn(email, passwort, email.split('@')[0] ?? 'admin')
  }

  /**
   * Legt einen Benutzer an. `verifiziert` ist absichtlich per Default true
   * (Seed-Admin, Tests, Direktanlage) — die Selbst-Registrierung (M9) setzt es
   * explizit auf false und schaltet erst nach E-Mail-Bestätigung frei.
   */
  async legeBenutzerAn(email: string, passwort: string, name: string, verifiziert = true): Promise<Benutzer> {
    const benutzer: Benutzer = { id: neueUserId(), email: email.toLowerCase().trim(), name }
    const pwHash = await hashePasswort(passwort)
    this.db
      .prepare('INSERT INTO users (id, email, pw_hash, name, created_at, email_verified) VALUES (?, ?, ?, ?, ?, ?)')
      .run(benutzer.id, benutzer.email, pwHash, benutzer.name, new Date().toISOString(), verifiziert ? 1 : 0)
    return benutzer
  }

  /** Existiert bereits ein Benutzer mit dieser E-Mail? (Registrierungs-Vorabprüfung) */
  emailVergeben(email: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM users WHERE email = ?').get(email.toLowerCase().trim())
  }

  istVerifiziert(userId: string): boolean {
    const zeile = this.db.prepare('SELECT email_verified FROM users WHERE id = ?').get(userId) as
      | { email_verified: number }
      | undefined
    return !!zeile?.email_verified
  }

  /** E-Mail + Passwort prüfen; null bei Fehlschlag (bewusst ohne Grund-Detail). */
  async login(email: string, passwort: string): Promise<Benutzer | null> {
    const zeile = this.db
      .prepare('SELECT id, email, pw_hash, name FROM users WHERE email = ?')
      .get(email.toLowerCase().trim()) as { id: string; email: string; pw_hash: string; name: string } | undefined
    if (!zeile) {
      // Dummy-Prüfung gegen Timing-Unterschied „Benutzer existiert (nicht)"
      await pruefePasswort('$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', passwort)
      return null
    }
    const ok = await pruefePasswort(zeile.pw_hash, passwort)
    return ok ? { id: zeile.id, email: zeile.email, name: zeile.name } : null
  }

  // — Sessions (Web) —

  erzeugeSession(userId: string): { id: string; ablauf: Date } {
    const id = neueSessionId()
    const jetzt = Date.now()
    const ablauf = new Date(jetzt + SESSION_DAUER_MS)
    this.db
      .prepare('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(id, userId, new Date(jetzt).toISOString(), ablauf.toISOString())
    return { id, ablauf }
  }

  benutzerAusSession(sessionId: string): Benutzer | null {
    const zeile = this.db
      .prepare(
        `SELECT u.id, u.email, u.name, s.expires_at FROM sessions s
         JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
      )
      .get(sessionId) as { id: string; email: string; name: string; expires_at: string } | undefined
    if (!zeile) return null
    if (Date.parse(zeile.expires_at) < Date.now()) {
      this.beendeSession(sessionId)
      return null
    }
    return { id: zeile.id, email: zeile.email, name: zeile.name }
  }

  beendeSession(sessionId: string): void {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId)
  }

  // — API-Tokens (App) —

  /** Erzeugt ein Token; der Klartext wird NUR hier zurückgegeben. */
  erzeugeToken(userId: string, label: string): string {
    const klartext = neuesTokenSecret()
    this.db
      .prepare('INSERT INTO tokens (id, hash, user_id, label, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(neueSessionId(), sha256(klartext), userId, label, new Date().toISOString())
    return klartext
  }

  benutzerAusToken(klartext: string): Benutzer | null {
    const hash = sha256(klartext)
    const zeile = this.db
      .prepare(
        `SELECT u.id, u.email, u.name, t.id AS token_id, t.hash FROM tokens t
         JOIN users u ON u.id = t.user_id WHERE t.hash = ?`,
      )
      .get(hash) as { id: string; email: string; name: string; token_id: string; hash: string } | undefined
    if (!zeile) return null
    // Vergleich in konstanter Zeit (Hash-Lookup wäre theoretisch genug, kostet nichts)
    if (!timingSafeEqual(Buffer.from(zeile.hash), Buffer.from(hash))) return null
    this.db.prepare('UPDATE tokens SET last_used_at = ? WHERE id = ?').run(new Date().toISOString(), zeile.token_id)
    return { id: zeile.id, email: zeile.email, name: zeile.name }
  }

  widerrufeTokens(userId: string): void {
    this.db.prepare('DELETE FROM tokens WHERE user_id = ?').run(userId)
  }

  // — Mail-Token: E-Mail-Bestätigung + Passwort-Reset (M9) —

  /**
   * Erzeugt einen Einmal-Token für `zweck`; nur der Hash landet in der DB, der
   * Klartext wandert direkt in die Mail. Frühere offene Token desselben Zwecks
   * werden verworfen (ein angefordertes Reset entwertet das vorige).
   */
  erzeugeMailToken(userId: string, zweck: MailZweck): string {
    this.db.prepare('DELETE FROM mail_tokens WHERE user_id = ? AND zweck = ? AND used_at IS NULL').run(userId, zweck)
    const klartext = neuesTokenSecret()
    const jetzt = Date.now()
    this.db
      .prepare('INSERT INTO mail_tokens (id, user_id, zweck, hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(
        neueSessionId(),
        userId,
        zweck,
        sha256(klartext),
        new Date(jetzt).toISOString(),
        new Date(jetzt + MAIL_TOKEN_DAUER_MS[zweck]).toISOString(),
      )
    return klartext
  }

  /**
   * Löst einen Mail-Token ein: prüft Zweck, Ablauf und Einmaligkeit, markiert
   * ihn als verbraucht und gibt die user_id zurück (null bei ungültig/abgelaufen/
   * schon benutzt). Bewusst atomar in einer Transaktion gegen Doppel-Einlösung.
   */
  loeseMailToken(klartext: string, zweck: MailZweck): string | null {
    const hash = sha256(klartext)
    return this.db.transaction(() => {
      const zeile = this.db
        .prepare('SELECT id, user_id, expires_at, used_at FROM mail_tokens WHERE hash = ? AND zweck = ?')
        .get(hash, zweck) as { id: string; user_id: string; expires_at: string; used_at: string | null } | undefined
      if (!zeile || zeile.used_at || Date.parse(zeile.expires_at) < Date.now()) return null
      this.db.prepare('UPDATE mail_tokens SET used_at = ? WHERE id = ?').run(new Date().toISOString(), zeile.id)
      return zeile.user_id
    })()
  }

  verifiziereEmail(userId: string): void {
    this.db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(userId)
  }

  /** E-Mail → user_id (für den Reset-Anstoß); null, ohne die Existenz zu verraten. */
  benutzerIdFuerEmail(email: string): string | null {
    const zeile = this.db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim()) as
      | { id: string }
      | undefined
    return zeile?.id ?? null
  }

  async setzePasswort(userId: string, passwort: string): Promise<void> {
    const pwHash = await hashePasswort(passwort)
    this.db.prepare('UPDATE users SET pw_hash = ? WHERE id = ?').run(pwHash, userId)
    // Sicherheitshalber alle Sessions/Tokens beenden — nach einem Reset soll
    // niemand mit einer alten Sitzung weiterlaufen.
    this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId)
    this.db.prepare('DELETE FROM tokens WHERE user_id = ?').run(userId)
  }

  /** Öffentliches Profil eines Benutzers; null, wenn es ihn nicht gibt. */
  profil(userId: string): Profil | null {
    const zeile = this.db
      .prepare('SELECT anzeigename, bio, avatar, profil_sichtbarkeit FROM users WHERE id = ?')
      .get(userId) as
      | { anzeigename: string | null; bio: string | null; avatar: string | null; profil_sichtbarkeit: string }
      | undefined
    if (!zeile) return null
    return {
      anzeigename: zeile.anzeigename,
      bio: zeile.bio,
      avatar: zeile.avatar,
      sichtbarkeit: zeile.profil_sichtbarkeit === 'public' ? 'public' : 'private',
    }
  }

  /**
   * Profilfelder ändern. Nur übergebene Felder werden angefasst; ein leerer
   * String leert das Feld.
   *
   * Das SET wird aus den vorhandenen Feldern gebaut statt mit COALESCE: dort
   * wäre NULL sowohl „leeren" als auch „nicht angefasst" — ein geleerter
   * Anzeigename bliebe stehen. (Die Spaltennamen stammen aus dem Code, nicht
   * aus der Anfrage.)
   */
  setzeProfil(userId: string, aenderung: ProfilAenderung): void {
    const zuweisungen: string[] = []
    const werte: Array<string | null> = []
    if (aenderung.anzeigename !== undefined) {
      zuweisungen.push('anzeigename = ?')
      werte.push(leerAlsNull(aenderung.anzeigename))
    }
    if (aenderung.bio !== undefined) {
      zuweisungen.push('bio = ?')
      werte.push(leerAlsNull(aenderung.bio))
    }
    if (aenderung.sichtbarkeit !== undefined) {
      zuweisungen.push('profil_sichtbarkeit = ?')
      werte.push(aenderung.sichtbarkeit)
    }
    if (zuweisungen.length === 0) return
    this.db.prepare(`UPDATE users SET ${zuweisungen.join(', ')} WHERE id = ?`).run(...werte, userId)
  }

  /** Avatar-Dateiname vermerken (die Datei selbst legt der Aufrufer ab). */
  setzeAvatar(userId: string, datei: string | null): void {
    this.db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(datei, userId)
  }

  /** IDs aller Touren des Benutzers (für die Storage-Aufräumung vor dem Löschen). */
  tourIds(userId: string): string[] {
    return (this.db.prepare('SELECT id FROM tours WHERE owner_id = ?').all(userId) as Array<{ id: string }>).map(
      (z) => z.id,
    )
  }

  /**
   * Löscht den Benutzer samt aller DB-Daten (Sessions, Tokens, Mail-Token und
   * Touren via ON DELETE CASCADE). Die Storage-Dateien räumt der Aufrufer davor
   * ab (er kennt den Storage) — hier fällt nur die DB-Seite.
   */
  loescheBenutzer(userId: string): void {
    this.db.prepare('DELETE FROM users WHERE id = ?').run(userId)
  }
}
