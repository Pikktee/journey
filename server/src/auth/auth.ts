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

const SESSION_DAUER_MS = 30 * 24 * 60 * 60 * 1000 // 30 Tage

const sha256 = (wert: string): string => createHash('sha256').update(wert).digest('hex')

export class AuthDienst {
  constructor(private readonly db: Db) {}

  /** Legt den Seed-Benutzer an, falls die Datenbank noch leer ist (Erststart). */
  async seedeAdmin(email: string | null, passwort: string | null): Promise<void> {
    const anzahl = (this.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n
    if (anzahl > 0 || !email || !passwort) return
    await this.legeBenutzerAn(email, passwort, email.split('@')[0] ?? 'admin')
  }

  async legeBenutzerAn(email: string, passwort: string, name: string): Promise<Benutzer> {
    const benutzer: Benutzer = { id: neueUserId(), email: email.toLowerCase().trim(), name }
    const pwHash = await hashePasswort(passwort)
    this.db
      .prepare('INSERT INTO users (id, email, pw_hash, name, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(benutzer.id, benutzer.email, pwHash, benutzer.name, new Date().toISOString())
    return benutzer
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
}
