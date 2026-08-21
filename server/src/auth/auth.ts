// Auth-Kern: Benutzer, Sessions (Web/Studio, httpOnly-Cookie) und API-Tokens
// (Android-App, `Authorization: Bearer …`). Mehrbenutzer-Fundament ab Tag 1 —
// M9 setzt Registrierung/Passwort-Reset oben drauf, ohne dass sich hier die
// Struktur ändert. Tokens werden nur als SHA-256-Hash gespeichert; das Klartext-
// Token sieht ausschließlich die Antwort des Login-Aufrufs.

import { createHash, timingSafeEqual } from 'node:crypto'
import type { Db } from '../db.js'
import { findFreeHandle, handleFromEmail, validateHandleForm, type HandleError } from '../handle.js'
import { newSessionId, newTokenSecret, newUserId } from '../ids.js'
import { normalizeInstagram, normalizeWebsite } from '../profile-fields.js'
import { hashPassword, checkPassword } from './password.js'

/** Zwei Rollen genügen: wer verwalten darf, und wer seine eigenen Touren hat. */
export type Role = 'user' | 'admin'

export interface User {
  id: string
  email: string
  name: string
  role: Role
}

/** Eine Zeile der Benutzerverwaltung — Konto plus das, was daran hängt. */
export interface UserRow extends User {
  verified: boolean
  createdAt: string
  displayName: string | null
  tours: number
}

/** Änderungswunsch am Konto; fehlende Felder bleiben, wie sie sind. */
export interface AccountUpdate {
  email?: string
  name?: string
  role?: Role
  verified?: boolean
}

/** Doppelte E-Mail — vom Aufrufer in eine 409-Antwort übersetzt. */
export class EmailTakenError extends Error {
  constructor() {
    super('Diese E-Mail ist bereits registriert')
    this.name = 'EmailTakenError'
  }
}

const asRole = (value: unknown): Role => (value === 'admin' ? 'admin' : 'user')

/**
 * Das öffentliche Profil — bewusst getrennt vom Konto.
 *
 * `anzeigename` ist NICHT der Klarname aus der Registrierung: wer sich mit
 * seinem echten Namen anmeldet, soll ihn nicht nebenbei veröffentlichen. Ohne
 * gesetzten Anzeigenamen erscheint eine öffentliche Tour ohne Urheber.
 */
export interface Profile {
  /** Die Adresse der Person: `maptale.io/@henrik`. Immer gesetzt (s. handle.ts). */
  handle: string | null
  displayName: string | null
  bio: string | null
  /** Freitext („Frankfurt am Main"), keine Koordinate — er wird gelesen, nicht gerechnet. */
  location: string | null
  /** NACKTE Formen ohne Schema bzw. ohne `@` — s. Migration 13. */
  website: string | null
  instagram: string | null
  /** Dateiname im Benutzer-Storage; null = kein Bild */
  avatar: string | null
  /** Vorschlag (`serpentinen.jpg`) oder eigener Pfad (`banner/…`) — s. Migration 13. */
  banner: string | null
  visibility: 'private' | 'public'
}

/** Änderungswunsch am Profil; fehlende Felder bleiben, wie sie sind. */
export interface ProfileUpdate {
  displayName?: string
  bio?: string
  location?: string
  website?: string
  instagram?: string
  visibility?: 'private' | 'public'
}

/** Leerer oder nur aus Leerraum bestehender Text heißt: Feld leeren. */
const emptyAsNull = (value: string): string | null => value.trim() || null

export type MailPurpose = 'verify' | 'reset' | 'email'

/**
 * Woher eine Sitzung kommt — so viel, wie zum Wiedererkennen nötig ist.
 *
 * Der User-Agent bleibt roh: Wie daraus „Chrome auf macOS" wird, ist eine Frage
 * der Anzeige und ändert sich häufiger als das Schema (s. `account-model.ts`).
 * Die IP wird auf ZWEI Oktette gekürzt — die vollständige Adresse wäre ein
 * Bewegungsprofil, „84.119.x.x" beantwortet die einzige Frage, die hier
 * gestellt wird.
 */
export interface SessionFingerprint {
  userAgent?: string | null
  ip?: string | null
  /**
   * Das App-Token, für das diese Sitzung ausgestellt wurde (Player-Tausch).
   *
   * Gesetzt heißt: kein eigenes Gerät, sondern ein zweiter Ausweis desselben —
   * die Geräteliste zeigt sie deshalb nicht, und mit dem Token fällt sie.
   */
  tokenId?: string | null
}

/** Ein angemeldetes Gerät — Browser-Sitzung oder App-Token. */
export interface Device {
  /** `session:<id>` oder `app:<id>` — beide Listen haben eigene Tabellen. */
  id: string
  kind: 'session' | 'app'
  /** Roher User-Agent (Sitzung) bzw. das bei der Anmeldung gesetzte Label (App). */
  label: string | null
  ipPrefix: string | null
  signedInAt: string
  lastSeenAt: string | null
}

const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000 // 30 Tage
/** Wie lange ein aufgegebener Handle für seinen früheren Besitzer gesperrt bleibt. */
const HANDLE_LOCK_MS = 90 * 24 * 60 * 60 * 1000
// Lebensdauer der Einmal-Token: E-Mail-Bestätigung großzügig, Passwort-Reset kurz.
const MAIL_TOKEN_DURATION_MS: Record<MailPurpose, number> = {
  verify: 24 * 60 * 60 * 1000, // 24 h
  reset: 60 * 60 * 1000, // 1 h
  // Der Wechsel der Adresse liegt dazwischen: Er ist nicht so dringlich wie ein
  // Reset, aber die Mail geht an eine Adresse, die noch niemandem gehört —
  // sie soll nicht tagelang einlösbar bleiben.
  email: 2 * 60 * 60 * 1000, // 2 h
}

/**
 * Wie lange eine Sitzung ihren Zeitstempel behält, bevor er neu geschrieben
 * wird. Ein UPDATE pro Anfrage wäre ein Schreibvorgang für jedes geladene Bild;
 * für die Frage „zuletzt gestern" genügt eine Auflösung von Minuten.
 */
const LAST_SEEN_INTERVAL_MS = 5 * 60 * 1000

/**
 * `84.119.12.7` → `84.119.x.x`, `2001:db8::1` → `2001:db8:x`.
 *
 * Zwei Gruppen genügen, um ein fremdes Gerät zu erkennen („das war nicht mein
 * Anschluss"), und sie sind zu grob, um daraus einen Aufenthaltsort zu machen.
 */
export function ipPrefix(ip: string | null | undefined): string | null {
  if (!ip) return null
  const value = ip.replace(/^::ffff:/, '')
  if (value.includes(':')) {
    const parts = value.split(':').filter(Boolean).slice(0, 2)
    return parts.length ? `${parts.join(':')}:x` : null
  }
  const parts = value.split('.')
  if (parts.length !== 4) return null
  return `${parts[0]}.${parts[1]}.x.x`
}

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')

/**
 * Ein Anzeigename aus der Adresse — die Registrierung fragt nur noch nach
 * E-Mail und Passwort.
 *
 * `users.name` ist NOT NULL und trägt zwei sichtbare Dinge: die Mail-Anrede
 * („Hallo Mira,") und den Konto-Chip, solange im Profil kein Anzeigename
 * gesetzt ist. Leer hieße also „Hallo ,". Deshalb wird der lokale Teil der
 * Adresse aufbereitet: Plus-Zusatz weg (`mira+maptale@` → `mira`),
 * Trennzeichen zu Leerraum, jedes Wort groß.
 *
 * Das ist eine VORGABE, keine Behauptung über den Menschen — im Profil lässt
 * sich der Anzeigename jederzeit überschreiben. Und es ist der Grund, warum
 * das Feld nicht einfach leer bleibt: Ein Pflichtfeld weniger im Formular darf
 * nicht als „Hallo ," in der Bestätigungsmail wieder auftauchen.
 */
export function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? ''
  const withoutTag = local.split('+')[0] ?? local
  const words = withoutTag
    .split(/[._-]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
  // Die Rückfallkette greift nur bei Adressen, die die Prüfung davor gar nicht
  // durchlassen würde („...@x.de"). Erfunden wird nichts.
  return (words.join(' ') || withoutTag || local || email).slice(0, 80)
}

export class AuthService {
  constructor(private readonly db: Db) {}

  /** Legt den Seed-Benutzer an, falls die Datenbank noch leer ist (Erststart). */
  async seedAdmin(email: string | null, password: string | null): Promise<void> {
    const count = (this.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n
    if (count > 0 || !email || !password) return
    await this.createUser(email, password, email.split('@')[0] ?? 'admin', true, 'admin')
  }

  /**
   * Hebt die konfigurierten Adressen auf die Admin-Rolle — bei JEDEM Start.
   *
   * Damit kann sich niemand über die Verwaltung selbst aussperren, und ein
   * Konto, das beim Umstellen noch nicht existierte, wird Admin, sobald es
   * angelegt ist. Gibt zurück, wie viele Zeilen tatsächlich gehoben wurden
   * (für die Start-Meldung — im Normalfall 0).
   */
  promoteAdmins(emails: readonly string[]): number {
    if (!emails.length) return 0
    const placeholders = emails.map(() => '?').join(', ')
    const result = this.db
      .prepare(
        `UPDATE users SET role = 'admin' WHERE role != 'admin' AND email IN (${placeholders})`,
      )
      .run(...emails.map((e) => e.toLowerCase().trim()))
    return result.changes
  }

  /**
   * Legt einen Benutzer an. `verifiziert` ist absichtlich per Default true
   * (Seed-Admin, Tests, Direktanlage) — die Selbst-Registrierung (M9) setzt es
   * explizit auf false und schaltet erst nach E-Mail-Bestätigung frei.
   */
  async createUser(
    email: string,
    password: string,
    name: string,
    verified = true,
    role: Role = 'user',
  ): Promise<User> {
    const user: User = {
      id: newUserId(),
      email: email.toLowerCase().trim(),
      name,
      role: role,
    }
    const pwHash = await hashPassword(password)
    // Jedes Konto bekommt sofort eine Adresse — ein Profil ohne Handle wäre
    // nicht verlinkbar, und ein nachgereichter Handle hieße, dass die halbe
    // Anwendung mit „vielleicht keiner" rechnen müsste.
    const handle = findFreeHandle(
      handleFromEmail(user.email),
      (h) => !this.handleAvailable(h, null),
    )
    try {
      this.db
        .prepare(
          'INSERT INTO users (id, email, pw_hash, name, created_at, email_verified, role, handle) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          user.id,
          user.email,
          pwHash,
          user.name,
          new Date().toISOString(),
          verified ? 1 : 0,
          role,
          handle,
        )
    } catch (error) {
      // Die UNIQUE-Verletzung ist der einzige erwartbare Fall — als eigener
      // Fehlertyp, damit die Route 409 statt 500 antworten kann.
      if (String(error).includes('UNIQUE')) throw new EmailTakenError()
      throw error
    }
    return user
  }

  /** Existiert bereits ein Benutzer mit dieser E-Mail? (Registrierungs-Vorabprüfung) */
  emailTaken(email: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM users WHERE email = ?').get(email.toLowerCase().trim())
  }

  isVerified(userId: string): boolean {
    const row = this.db.prepare('SELECT email_verified FROM users WHERE id = ?').get(userId) as
      { email_verified: number } | undefined
    return !!row?.email_verified
  }

  /** E-Mail + Passwort prüfen; null bei Fehlschlag (bewusst ohne Grund-Detail). */
  async login(email: string, password: string): Promise<User | null> {
    const row = this.db
      .prepare('SELECT id, email, pw_hash, name, role FROM users WHERE email = ?')
      .get(email.toLowerCase().trim()) as
      { id: string; email: string; pw_hash: string; name: string; role: string } | undefined
    if (!row) {
      // Dummy-Prüfung gegen Timing-Unterschied „Benutzer existiert (nicht)"
      await checkPassword(
        '$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        password,
      )
      return null
    }
    const ok = await checkPassword(row.pw_hash, password)
    return ok ? { id: row.id, email: row.email, name: row.name, role: asRole(row.role) } : null
  }

  // — Sessions (Web) —

  createSession(
    userId: string,
    fingerprint: SessionFingerprint = {},
  ): { id: string; expiresAt: Date } {
    const id = newSessionId()
    const now = Date.now()
    const expiresAt = new Date(now + SESSION_DURATION_MS)
    this.db
      .prepare(
        `INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent, ip_prefix, last_seen_at, token_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        userId,
        new Date(now).toISOString(),
        expiresAt.toISOString(),
        fingerprint.userAgent?.slice(0, 300) ?? null,
        ipPrefix(fingerprint.ip),
        new Date(now).toISOString(),
        fingerprint.tokenId ?? null,
      )
    return { id, expiresAt }
  }

  /**
   * Die noch gültige Player-Sitzung eines App-Tokens — oder `null`.
   *
   * Der Grund, warum es sie gibt: Die App tauscht ihr Token vor JEDEM
   * Abspielen gegen eine Sitzung. Jedes Mal eine neue anzulegen füllte die
   * Geräteliste mit Kopien desselben Telefons; wiederverwendet bleibt es bei
   * einer je Installation.
   *
   * Die jüngste gewinnt: Nach einer Migration oder einem Zurückdrehen der Uhr
   * können mehrere dastehen, und die zuletzt ausgestellte hat die längste
   * Restlaufzeit.
   */
  sessionForToken(tokenId: string): { id: string; expiresAt: Date } | null {
    const row = this.db
      .prepare(
        `SELECT id, expires_at FROM sessions
         WHERE token_id = ? AND expires_at > ? ORDER BY created_at DESC LIMIT 1`,
      )
      .get(tokenId, new Date().toISOString()) as { id: string; expires_at: string } | undefined
    return row ? { id: row.id, expiresAt: new Date(row.expires_at) } : null
  }

  userFromSession(sessionId: string): User | null {
    const row = this.db
      .prepare(
        `SELECT u.id, u.email, u.name, u.role, s.expires_at, s.last_seen_at FROM sessions s
         JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
      )
      .get(sessionId) as
      | {
          id: string
          email: string
          name: string
          role: string
          expires_at: string
          last_seen_at: string | null
        }
      | undefined
    if (!row) return null
    if (Date.parse(row.expires_at) < Date.now()) {
      this.endSession(sessionId)
      return null
    }
    // Gedrosselt: „zuletzt gerade eben" braucht keine Auflösung von
    // Millisekunden, ein Schreibvorgang je Anfrage aber sehr wohl eine Platte.
    const lastSeen = row.last_seen_at ? Date.parse(row.last_seen_at) : 0
    if (Date.now() - lastSeen > LAST_SEEN_INTERVAL_MS) {
      this.db
        .prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?')
        .run(new Date().toISOString(), sessionId)
    }
    return { id: row.id, email: row.email, name: row.name, role: asRole(row.role) }
  }

  endSession(sessionId: string): void {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId)
  }

  /**
   * Die angemeldeten Geräte eines Kontos — Browser-Sitzungen UND App-Tokens.
   *
   * Beides zusammen, weil beides dasselbe ist: ein Zugang, den jemand behalten
   * oder wegnehmen will. Die App meldet sich nicht mit einer Sitzung an, sondern
   * mit einem Token — eine Liste, die nur Sitzungen zeigte, hätte genau das
   * Gerät nicht dabei, an das die meisten zuerst denken.
   *
   * Abgelaufene Sitzungen fallen heraus; sie sind kein Zugang mehr und in der
   * Liste nur eine Frage ohne Antwort.
   *
   * Sitzungen MIT `token_id` ebenfalls: Das sind die Player-Sitzungen der App
   * (der WebView kann kein Bearer-Token schicken). Sie sind kein zweites
   * Gerät, sondern ein zweiter Ausweis desselben — das Telefon steht in
   * derselben Liste bereits als App-Token, und mit ihm fällt die Sitzung.
   * Einzeln gezeigt waren sie das Gegenteil dessen, wofür die Liste da ist:
   * Wer ein fremdes Gerät sucht, fand eine Handvoll „Unbekanntes Gerät", die
   * alle ihm selbst gehörten.
   */
  devices(userId: string): Device[] {
    const now = new Date().toISOString()
    const sessions = this.db
      .prepare(
        `SELECT id, created_at, user_agent, ip_prefix, last_seen_at FROM sessions
         WHERE user_id = ? AND expires_at > ? AND token_id IS NULL ORDER BY created_at DESC`,
      )
      .all(userId, now) as Array<{
      id: string
      created_at: string
      user_agent: string | null
      ip_prefix: string | null
      last_seen_at: string | null
    }>
    const tokens = this.db
      .prepare(
        'SELECT id, label, created_at, last_used_at FROM tokens WHERE user_id = ? ORDER BY created_at DESC',
      )
      .all(userId) as Array<{
      id: string
      label: string
      created_at: string
      last_used_at: string | null
    }>
    return [
      ...sessions.map((s) => ({
        id: `session:${s.id}`,
        kind: 'session' as const,
        label: s.user_agent,
        ipPrefix: s.ip_prefix,
        signedInAt: s.created_at,
        lastSeenAt: s.last_seen_at,
      })),
      ...tokens.map((t) => ({
        id: `app:${t.id}`,
        kind: 'app' as const,
        label: t.label,
        ipPrefix: null,
        signedInAt: t.created_at,
        lastSeenAt: t.last_used_at,
      })),
    ]
  }

  /**
   * Ein Gerät abmelden. Die `user_id` steht in der Bedingung und nicht in einer
   * Prüfung davor: Sonst wäre zwischen „gehört mir?" und dem DELETE eine Lücke,
   * und eine fremde ID ließe sich mit genügend Versuchen finden.
   */
  signOutDevice(userId: string, deviceId: string): boolean {
    const [kind, id] = [
      deviceId.slice(0, deviceId.indexOf(':')),
      deviceId.slice(deviceId.indexOf(':') + 1),
    ]
    if (!id) return false
    if (kind === 'session') {
      return (
        this.db.prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?').run(id, userId)
          .changes > 0
      )
    }
    if (kind === 'app') {
      return (
        this.db.prepare('DELETE FROM tokens WHERE id = ? AND user_id = ?').run(id, userId).changes >
        0
      )
    }
    return false
  }

  // — API-Tokens (App) —

  /** Erzeugt ein Token; der Klartext wird NUR hier zurückgegeben. */
  createToken(userId: string, label: string): string {
    const plaintext = newTokenSecret()
    this.db
      .prepare('INSERT INTO tokens (id, hash, user_id, label, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(newSessionId(), sha256(plaintext), userId, label, new Date().toISOString())
    return plaintext
  }

  /**
   * Auflösung eines App-Tokens — Benutzer UND die Kennung des Tokens selbst.
   *
   * Die zweite Hälfte braucht genau ein Aufrufer: Ein Push-Gerät hängt am
   * Token, mit dem es sich angemeldet hat, damit „Gerät abmelden" in den
   * Kontoeinstellungen die Meldungen dorthin mit beendet. Die App kann das
   * nicht selbst aufräumen — sie ist in diesem Moment gerade ausgesperrt worden.
   */
  resolveToken(plaintext: string): { user: User; tokenId: string } | null {
    const hash = sha256(plaintext)
    const row = this.db
      .prepare(
        `SELECT u.id, u.email, u.name, u.role, t.id AS token_id, t.hash FROM tokens t
         JOIN users u ON u.id = t.user_id WHERE t.hash = ?`,
      )
      .get(hash) as
      | { id: string; email: string; name: string; role: string; token_id: string; hash: string }
      | undefined
    if (!row) return null
    // Vergleich in konstanter Zeit (Hash-Lookup wäre theoretisch genug, kostet nichts)
    if (!timingSafeEqual(Buffer.from(row.hash), Buffer.from(hash))) return null
    this.db
      .prepare('UPDATE tokens SET last_used_at = ? WHERE id = ?')
      .run(new Date().toISOString(), row.token_id)
    return {
      user: {
        id: row.id,
        email: row.email,
        name: row.name,
        role: asRole(row.role),
      },
      tokenId: row.token_id,
    }
  }

  userFromToken(plaintext: string): User | null {
    return this.resolveToken(plaintext)?.user ?? null
  }

  revokeTokens(userId: string): void {
    this.db.prepare('DELETE FROM tokens WHERE user_id = ?').run(userId)
  }

  // — Mail-Token: E-Mail-Bestätigung + Passwort-Reset (M9) —

  /**
   * Erzeugt einen Einmal-Token für `zweck`; nur der Hash landet in der DB, der
   * Klartext wandert direkt in die Mail. Frühere offene Token desselben Zwecks
   * werden verworfen (ein angefordertes Reset entwertet das vorige).
   */
  createMailToken(userId: string, purpose: MailPurpose, payload: string | null = null): string {
    this.db
      .prepare('DELETE FROM mail_tokens WHERE user_id = ? AND purpose = ? AND used_at IS NULL')
      .run(userId, purpose)
    const plaintext = newTokenSecret()
    const now = Date.now()
    this.db
      .prepare(
        'INSERT INTO mail_tokens (id, user_id, purpose, hash, payload, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        newSessionId(),
        userId,
        purpose,
        sha256(plaintext),
        payload,
        new Date(now).toISOString(),
        new Date(now + MAIL_TOKEN_DURATION_MS[purpose]).toISOString(),
      )
    return plaintext
  }

  /**
   * Löst einen Mail-Token ein: prüft Zweck, Ablauf und Einmaligkeit, markiert
   * ihn als verbraucht und gibt die user_id zurück (null bei ungültig/abgelaufen/
   * schon benutzt). Bewusst atomar in einer Transaktion gegen Doppel-Einlösung.
   */
  resolveMailToken(plaintext: string, purpose: MailPurpose): string | null {
    return this.resolveMailTokenWithPayload(plaintext, purpose)?.userId ?? null
  }

  /**
   * Dasselbe, aber mit dem, was beim Erzeugen mitgegeben wurde.
   *
   * Der E-Mail-Wechsel braucht das: Die neue Adresse darf erst nach dem Klick in
   * `users` stehen — bis dahin wohnt sie im Token. Stünde sie vorher dort,
   * gehörte das Konto ab dem Absenden einer Adresse, die niemand bestätigt hat.
   */
  resolveMailTokenWithPayload(
    plaintext: string,
    purpose: MailPurpose,
  ): { userId: string; payload: string | null } | null {
    const hash = sha256(plaintext)
    return this.db.transaction(() => {
      const row = this.db
        .prepare(
          'SELECT id, user_id, payload, expires_at, used_at FROM mail_tokens WHERE hash = ? AND purpose = ?',
        )
        .get(hash, purpose) as
        | {
            id: string
            user_id: string
            payload: string | null
            expires_at: string
            used_at: string | null
          }
        | undefined
      if (!row || row.used_at || Date.parse(row.expires_at) < Date.now()) return null
      this.db
        .prepare('UPDATE mail_tokens SET used_at = ? WHERE id = ?')
        .run(new Date().toISOString(), row.id)
      return { userId: row.user_id, payload: row.payload }
    })()
  }

  verifyEmail(userId: string): void {
    this.db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(userId)
  }

  /** E-Mail → user_id (für den Reset-Anstoß); null, ohne die Existenz zu verraten. */
  userIdForEmail(email: string): string | null {
    const row = this.db
      .prepare('SELECT id FROM users WHERE email = ?')
      .get(email.toLowerCase().trim()) as { id: string } | undefined
    return row?.id ?? null
  }

  /**
   * Passwort setzen und alle Zugänge beenden.
   *
   * `behalteSession` lässt genau eine Sitzung stehen — die des Wechselnden. Der
   * Reset-Weg gibt sie nicht an (dort steht der Nutzer vor einem Formular ohne
   * Sitzung und wird danach frisch eingeloggt); die Kontoeinstellungen schon,
   * sonst wirft der eigene Passwortwechsel einen aus der Seite, auf der man
   * gerade steht. Die App-Tokens fallen in BEIDEN Fällen: Wer sein Passwort
   * wechselt, weil er sich Sorgen macht, meint auch das Telefon.
   */
  async setPassword(userId: string, password: string, keepSession?: string): Promise<void> {
    const pwHash = await hashPassword(password)
    this.db.prepare('UPDATE users SET pw_hash = ? WHERE id = ?').run(pwHash, userId)
    if (keepSession) {
      this.db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(userId, keepSession)
    } else {
      this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId)
    }
    this.db.prepare('DELETE FROM tokens WHERE user_id = ?').run(userId)
  }

  /**
   * Die eigene E-Mail-Adresse übernehmen — nach dem Klick im Postfach der NEUEN
   * Adresse.
   *
   * Sie gilt damit als bestätigt: Der Klick ist derselbe Nachweis wie bei der
   * Registrierung, nur an einer anderen Adresse. Ein zweiter Bestätigungslauf
   * danach wäre eine Frage, die schon beantwortet ist.
   *
   * Gibt `false` zurück, wenn die Adresse inzwischen jemand anderem gehört —
   * zwischen dem Absenden und dem Klick können Tage liegen.
   */
  applyEmailChange(userId: string, email: string): boolean {
    try {
      const result = this.db
        .prepare('UPDATE users SET email = ?, email_verified = 1 WHERE id = ?')
        .run(email.toLowerCase().trim(), userId)
      return result.changes > 0
    } catch (error) {
      if (String(error).includes('UNIQUE')) return false
      throw error
    }
  }

  // — Handle (die Adresse einer Person) —

  /**
   * Räumt abgelaufene Reservierungen weg. Läuft vor jeder Handle-Frage, statt
   * als eigener Aufräum-Lauf: Die Tabelle ist klein, und eine Sperre, die
   * abgelaufen ist, muss in DEM Moment weg sein, in dem jemand nach dem Namen
   * fragt — nicht erst beim nächsten Neustart.
   */
  private purgeHandleReservations(): void {
    this.db
      .prepare('DELETE FROM reserved_handles WHERE free_from <= ?')
      .run(new Date().toISOString())
  }

  /**
   * Ist der Handle zu haben? `fuerUserId` darf seinen eigenen behalten und
   * einen selbst aufgegebenen zurücknehmen — die 90-Tage-Sperre richtet sich
   * gegen ÜBERNAHME durch andere, nicht gegen den früheren Besitzer.
   */
  handleAvailable(handle: string, forUserId: string | null): boolean {
    this.purgeHandleReservations()
    const takenBy = this.db
      .prepare('SELECT id FROM users WHERE handle = ? COLLATE NOCASE')
      .get(handle) as { id: string } | undefined
    if (takenBy && takenBy.id !== forUserId) return false
    const reservedFor = this.db
      .prepare('SELECT user_id FROM reserved_handles WHERE handle = ? COLLATE NOCASE')
      .get(handle) as { user_id: string } | undefined
    return !reservedFor || reservedFor.user_id === forUserId
  }

  /**
   * Handle → Benutzer-ID. Fällt auf die Reservierungen zurück, denn genau dafür
   * gibt es sie: Ein Link auf `@altname` soll die 90 Tage über weiter bei
   * derselben Person landen.
   */
  userIdForHandle(handle: string): string | null {
    this.purgeHandleReservations()
    const row = this.db
      .prepare('SELECT id FROM users WHERE handle = ? COLLATE NOCASE')
      .get(handle) as { id: string } | undefined
    if (row) return row.id
    const previous = this.db
      .prepare('SELECT user_id FROM reserved_handles WHERE handle = ? COLLATE NOCASE')
      .get(handle) as { user_id: string } | undefined
    return previous?.user_id ?? null
  }

  /**
   * Handle setzen. Gibt den Grund zurück, warum nicht — `null` heißt erledigt.
   *
   * Der bisherige Handle wandert dabei für 90 Tage in `reserved_handles`:
   * Alte Links leiten weiter, und niemand sonst kann die Adresse übernehmen und
   * die Links miterben. Derselbe Handle noch einmal ist ein No-op, kein Fehler —
   * sonst müsste jedes Formular vorher vergleichen.
   */
  setHandle(userId: string, wanted: string): HandleError | null {
    const handle = wanted.trim().toLowerCase()
    const formError = validateHandleForm(handle)
    if (formError) return formError
    const previous = this.handleOf(userId)
    if (previous && previous.toLowerCase() === handle) return null
    if (!this.handleAvailable(handle, userId)) return 'taken'

    const now = new Date()
    const freeFrom = new Date(now.getTime() + HANDLE_LOCK_MS).toISOString()
    this.db.transaction(() => {
      if (previous) {
        this.db
          .prepare(
            'INSERT OR REPLACE INTO reserved_handles (handle, user_id, free_from) VALUES (?, ?, ?)',
          )
          .run(previous, userId, freeFrom)
      }
      // Die eigene alte Reservierung geht weg — sonst zeigte der Handle
      // gleichzeitig auf den Benutzer und auf sich selbst als „aufgegeben".
      this.db.prepare('DELETE FROM reserved_handles WHERE handle = ? COLLATE NOCASE').run(handle)
      this.db
        .prepare('UPDATE users SET handle = ?, handle_changed_at = ? WHERE id = ?')
        .run(handle, now.toISOString(), userId)
    })()
    return null
  }

  /** Der aktuelle Handle eines Kontos; null nur bei unbekannter ID. */
  handleOf(userId: string): string | null {
    const row = this.db.prepare('SELECT handle FROM users WHERE id = ?').get(userId) as
      { handle: string | null } | undefined
    return row?.handle ?? null
  }

  /** Öffentliches Profil eines Benutzers; null, wenn es ihn nicht gibt. */
  profile(userId: string): Profile | null {
    const row = this.db
      .prepare(
        `SELECT handle, display_name, bio, location, website, instagram, avatar, banner, profile_visibility
         FROM users WHERE id = ?`,
      )
      .get(userId) as
      | {
          handle: string | null
          display_name: string | null
          bio: string | null
          location: string | null
          website: string | null
          instagram: string | null
          avatar: string | null
          banner: string | null
          profile_visibility: string
        }
      | undefined
    if (!row) return null
    return {
      handle: row.handle,
      displayName: row.display_name,
      bio: row.bio,
      location: row.location,
      website: row.website,
      instagram: row.instagram,
      avatar: row.avatar,
      banner: row.banner,
      visibility: row.profile_visibility === 'public' ? 'public' : 'private',
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
  setProfile(userId: string, update: ProfileUpdate): void {
    const assignments: string[] = []
    const values: Array<string | null> = []
    if (update.displayName !== undefined) {
      assignments.push('display_name = ?')
      values.push(emptyAsNull(update.displayName))
    }
    if (update.bio !== undefined) {
      assignments.push('bio = ?')
      values.push(emptyAsNull(update.bio))
    }
    if (update.location !== undefined) {
      assignments.push('location = ?')
      values.push(emptyAsNull(update.location))
    }
    // Website und Instagram werden auf die nackte Form gebracht; was keine
    // Adresse ist, wird zu NULL statt geraten (s. profile-fields.ts). Ein leeres
    // Feld heißt hier wie überall „löschen".
    if (update.website !== undefined) {
      assignments.push('website = ?')
      values.push(normalizeWebsite(update.website))
    }
    if (update.instagram !== undefined) {
      assignments.push('instagram = ?')
      values.push(normalizeInstagram(update.instagram))
    }
    if (update.visibility !== undefined) {
      assignments.push('profile_visibility = ?')
      values.push(update.visibility)
    }
    if (assignments.length === 0) return
    this.db
      .prepare(`UPDATE users SET ${assignments.join(', ')} WHERE id = ?`)
      .run(...values, userId)
  }

  /** Avatar-Dateiname vermerken (die Datei selbst legt der Aufrufer ab). */
  setAvatar(userId: string, datei: string | null): void {
    this.db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(datei, userId)
  }

  /** Titelbild vermerken — Name eines Vorschlags ODER Pfad im Benutzer-Storage. */
  setBanner(userId: string, value: string | null): void {
    this.db.prepare('UPDATE users SET banner = ? WHERE id = ?').run(value, userId)
  }

  /**
   * Kennzahlen einer Person: Touren, Kilometer, Höhenmeter.
   *
   * **Nur über öffentliche, fertige Touren.** Das ist kein Anzeige-Detail,
   * sondern der Grund, warum die Summe hier und nicht im Browser entsteht: Eine
   * Zahl, die private Fahrten mitzählt, verrät sie — „12 Touren" neben drei
   * sichtbaren Karten ist eine Auskunft über die anderen neun.
   *
   * Gerechnet wird über `json_extract` auf `stats_json` statt in JS über alle
   * Zeilen: Die Werte stehen ohnehin dort (`km`, `gainM`, s. pipeline/geo.ts),
   * und so bleibt es eine Abfrage. Touren ohne Statistik zählen als Tour, aber
   * mit 0 km — `SUM` überspringt NULL von selbst.
   */
  profileStats(userId: string): { tours: number; km: number; elevationGain: number } {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS tours,
                COALESCE(SUM(json_extract(stats_json, '$.km')), 0) AS km,
                COALESCE(SUM(json_extract(stats_json, '$.gainM')), 0) AS elevationGain
         FROM tours
         WHERE owner_id = ? AND visibility = 'public' AND status = 'ready'`,
      )
      .get(userId) as { tours: number; km: number; elevationGain: number }
    return { tours: row.tours, km: row.km, elevationGain: Math.round(row.elevationGain) }
  }

  // — Benutzerverwaltung (Admin) —

  /**
   * Alle Konten mit dem, was daran hängt.
   *
   * Die Tourenzahl kommt als Unterabfrage statt als JOIN mit GROUP BY: bei
   * einem JOIN müsste jede weitere Kennzahl in dieselbe Gruppierung, und
   * schon die zweite (Medien) würde die erste vervielfachen. Der belegte
   * Speicher steht bewusst NICHT hier — er liegt im Storage, nicht in der DB,
   * und wird von der Route nachgereicht.
   */
  allUsers(): UserRow[] {
    const rows = this.db
      .prepare(
        `SELECT id, email, name, role, email_verified, created_at, display_name,
                (SELECT COUNT(*) FROM tours WHERE tours.owner_id = users.id) AS tours
         FROM users ORDER BY created_at ASC`,
      )
      .all() as Array<{
      id: string
      email: string
      name: string
      role: string
      email_verified: number
      created_at: string
      display_name: string | null
      tours: number
    }>
    return rows.map((z) => ({
      id: z.id,
      email: z.email,
      name: z.name,
      role: asRole(z.role),
      verified: !!z.email_verified,
      createdAt: z.created_at,
      displayName: z.display_name,
      tours: z.tours,
    }))
  }

  /** Ein Konto der Verwaltung; null, wenn es die ID nicht gibt. */
  userById(userId: string): UserRow | null {
    return this.allUsers().find((b) => b.id === userId) ?? null
  }

  /** Wie viele Konten haben die Admin-Rolle? (Schutz vor dem letzten Abgang.) */
  adminCount(): number {
    return (
      this.db.prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin'`).get() as {
        n: number
      }
    ).n
  }

  /**
   * Kontofelder ändern. Nur übergebene Felder werden angefasst — dieselbe
   * Bauweise wie `setProfile`, aus demselben Grund (COALESCE könnte „leeren"
   * nicht von „nicht angefasst" unterscheiden).
   *
   * Eine geänderte E-Mail gilt als unbestätigt weiter: `verifiziert` wird
   * NICHT automatisch zurückgesetzt, weil ein Admin die Adresse gerade
   * bewusst korrigiert hat — er kann den Haken selbst setzen.
   */
  updateAccount(userId: string, update: AccountUpdate): void {
    const assignments: string[] = []
    const values: Array<string | number> = []
    if (update.email !== undefined) {
      assignments.push('email = ?')
      values.push(update.email.toLowerCase().trim())
    }
    if (update.name !== undefined) {
      assignments.push('name = ?')
      values.push(update.name.trim())
    }
    if (update.role !== undefined) {
      assignments.push('role = ?')
      values.push(update.role)
    }
    if (update.verified !== undefined) {
      assignments.push('email_verified = ?')
      values.push(update.verified ? 1 : 0)
    }
    if (!assignments.length) return
    try {
      this.db
        .prepare(`UPDATE users SET ${assignments.join(', ')} WHERE id = ?`)
        .run(...values, userId)
    } catch (error) {
      if (String(error).includes('UNIQUE')) throw new EmailTakenError()
      throw error
    }
  }

  /** IDs aller Touren des Benutzers (für die Storage-Aufräumung vor dem Löschen). */
  tourIds(userId: string): string[] {
    return (
      this.db.prepare('SELECT id FROM tours WHERE owner_id = ?').all(userId) as Array<{
        id: string
      }>
    ).map((z) => z.id)
  }

  /**
   * Löscht den Benutzer samt aller DB-Daten (Sessions, Tokens, Mail-Token und
   * Touren via ON DELETE CASCADE). Die Storage-Dateien räumt der Aufrufer davor
   * ab (er kennt den Storage) — hier fällt nur die DB-Seite.
   */
  deleteUser(userId: string): void {
    this.db.prepare('DELETE FROM users WHERE id = ?').run(userId)
  }
}
