// Auth-Kern: Benutzer, Sessions (Web/Studio, httpOnly-Cookie) und API-Tokens
// (Android-App, `Authorization: Bearer …`). Mehrbenutzer-Fundament ab Tag 1 —
// M9 setzt Registrierung/Passwort-Reset oben drauf, ohne dass sich hier die
// Struktur ändert. Tokens werden nur als SHA-256-Hash gespeichert; das Klartext-
// Token sieht ausschließlich die Antwort des Login-Aufrufs.

import { createHash, timingSafeEqual } from 'node:crypto'
import type { Db } from '../db.js'
import { freierHandle, handleAusEmail, pruefeHandleForm, type HandleFehler } from '../handle.js'
import { neueSessionId, neuesTokenSecret, neueUserId } from '../ids.js'
import { nacktesInstagram, nacktesWeb } from '../profilfelder.js'
import { hashePasswort, pruefePasswort } from './passwort.js'

/** Zwei Rollen genügen: wer verwalten darf, und wer seine eigenen Touren hat. */
export type Rolle = 'nutzer' | 'admin'

export interface Benutzer {
  id: string
  email: string
  name: string
  rolle: Rolle
}

/** Eine Zeile der Benutzerverwaltung — Konto plus das, was daran hängt. */
export interface BenutzerZeile extends Benutzer {
  verifiziert: boolean
  angelegtAm: string
  anzeigename: string | null
  touren: number
}

/** Änderungswunsch am Konto; fehlende Felder bleiben, wie sie sind. */
export interface KontoAenderung {
  email?: string
  name?: string
  rolle?: Rolle
  verifiziert?: boolean
}

/** Doppelte E-Mail — vom Aufrufer in eine 409-Antwort übersetzt. */
export class EmailVergebenFehler extends Error {
  constructor() {
    super('Diese E-Mail ist bereits registriert')
    this.name = 'EmailVergebenFehler'
  }
}

const alsRolle = (wert: unknown): Rolle => (wert === 'admin' ? 'admin' : 'nutzer')

/**
 * Das öffentliche Profil — bewusst getrennt vom Konto.
 *
 * `anzeigename` ist NICHT der Klarname aus der Registrierung: wer sich mit
 * seinem echten Namen anmeldet, soll ihn nicht nebenbei veröffentlichen. Ohne
 * gesetzten Anzeigenamen erscheint eine öffentliche Tour ohne Urheber.
 */
export interface Profil {
  /** Die Adresse der Person: `maptale.io/@henrik`. Immer gesetzt (s. handle.ts). */
  handle: string | null
  anzeigename: string | null
  bio: string | null
  /** Freitext („Frankfurt am Main"), keine Koordinate — er wird gelesen, nicht gerechnet. */
  ort: string | null
  /** NACKTE Formen ohne Schema bzw. ohne `@` — s. Migration 13. */
  website: string | null
  instagram: string | null
  /** Dateiname im Benutzer-Storage; null = kein Bild */
  avatar: string | null
  /** Vorschlag (`serpentinen.jpg`) oder eigener Pfad (`titelbild/…`) — s. Migration 13. */
  titelbild: string | null
  sichtbarkeit: 'private' | 'public'
}

/** Änderungswunsch am Profil; fehlende Felder bleiben, wie sie sind. */
export interface ProfilAenderung {
  anzeigename?: string
  bio?: string
  ort?: string
  website?: string
  instagram?: string
  sichtbarkeit?: 'private' | 'public'
}

/** Leerer oder nur aus Leerraum bestehender Text heißt: Feld leeren. */
const leerAlsNull = (wert: string): string | null => wert.trim() || null

export type MailZweck = 'verify' | 'reset' | 'email'

/**
 * Woher eine Sitzung kommt — so viel, wie zum Wiedererkennen nötig ist.
 *
 * Der User-Agent bleibt roh: Wie daraus „Chrome auf macOS" wird, ist eine Frage
 * der Anzeige und ändert sich häufiger als das Schema (s. `kontomodell.ts`).
 * Die IP wird auf ZWEI Oktette gekürzt — die vollständige Adresse wäre ein
 * Bewegungsprofil, „84.119.x.x" beantwortet die einzige Frage, die hier
 * gestellt wird.
 */
export interface SitzungsKennzeichen {
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
export interface Geraet {
  /** `sitzung:<id>` oder `app:<id>` — beide Listen haben eigene Tabellen. */
  id: string
  art: 'sitzung' | 'app'
  /** Roher User-Agent (Sitzung) bzw. das bei der Anmeldung gesetzte Label (App). */
  kennung: string | null
  ipPraefix: string | null
  angemeldetAm: string
  zuletztGesehen: string | null
}

const SESSION_DAUER_MS = 30 * 24 * 60 * 60 * 1000 // 30 Tage
/** Wie lange ein aufgegebener Handle für seinen früheren Besitzer gesperrt bleibt. */
const HANDLE_SPERRE_MS = 90 * 24 * 60 * 60 * 1000
// Lebensdauer der Einmal-Token: E-Mail-Bestätigung großzügig, Passwort-Reset kurz.
const MAIL_TOKEN_DAUER_MS: Record<MailZweck, number> = {
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
const GESEHEN_TAKT_MS = 5 * 60 * 1000

/**
 * `84.119.12.7` → `84.119.x.x`, `2001:db8::1` → `2001:db8:x`.
 *
 * Zwei Gruppen genügen, um ein fremdes Gerät zu erkennen („das war nicht mein
 * Anschluss"), und sie sind zu grob, um daraus einen Aufenthaltsort zu machen.
 */
export function ipPraefix(ip: string | null | undefined): string | null {
  if (!ip) return null
  const wert = ip.replace(/^::ffff:/, '')
  if (wert.includes(':')) {
    const teile = wert.split(':').filter(Boolean).slice(0, 2)
    return teile.length ? `${teile.join(':')}:x` : null
  }
  const teile = wert.split('.')
  if (teile.length !== 4) return null
  return `${teile[0]}.${teile[1]}.x.x`
}

const sha256 = (wert: string): string => createHash('sha256').update(wert).digest('hex')

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
export function nameAusEmail(email: string): string {
  const lokal = email.split('@')[0] ?? ''
  const ohneZusatz = lokal.split('+')[0] ?? lokal
  const worte = ohneZusatz
    .split(/[._-]+/)
    .filter((wort) => wort.length > 0)
    .map((wort) => wort.charAt(0).toUpperCase() + wort.slice(1))
  // Die Rückfallkette greift nur bei Adressen, die die Prüfung davor gar nicht
  // durchlassen würde („...@x.de"). Erfunden wird nichts.
  return (worte.join(' ') || ohneZusatz || lokal || email).slice(0, 80)
}

export class AuthDienst {
  constructor(private readonly db: Db) {}

  /** Legt den Seed-Benutzer an, falls die Datenbank noch leer ist (Erststart). */
  async seedeAdmin(email: string | null, passwort: string | null): Promise<void> {
    const anzahl = (this.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n
    if (anzahl > 0 || !email || !passwort) return
    await this.legeBenutzerAn(email, passwort, email.split('@')[0] ?? 'admin', true, 'admin')
  }

  /**
   * Hebt die konfigurierten Adressen auf die Admin-Rolle — bei JEDEM Start.
   *
   * Damit kann sich niemand über die Verwaltung selbst aussperren, und ein
   * Konto, das beim Umstellen noch nicht existierte, wird Admin, sobald es
   * angelegt ist. Gibt zurück, wie viele Zeilen tatsächlich gehoben wurden
   * (für die Start-Meldung — im Normalfall 0).
   */
  hebeAdmins(emails: readonly string[]): number {
    if (!emails.length) return 0
    const platzhalter = emails.map(() => '?').join(', ')
    const erg = this.db
      .prepare(`UPDATE users SET rolle = 'admin' WHERE rolle != 'admin' AND email IN (${platzhalter})`)
      .run(...emails.map((e) => e.toLowerCase().trim()))
    return erg.changes
  }

  /**
   * Legt einen Benutzer an. `verifiziert` ist absichtlich per Default true
   * (Seed-Admin, Tests, Direktanlage) — die Selbst-Registrierung (M9) setzt es
   * explizit auf false und schaltet erst nach E-Mail-Bestätigung frei.
   */
  async legeBenutzerAn(
    email: string,
    passwort: string,
    name: string,
    verifiziert = true,
    rolle: Rolle = 'nutzer',
  ): Promise<Benutzer> {
    const benutzer: Benutzer = { id: neueUserId(), email: email.toLowerCase().trim(), name, rolle }
    const pwHash = await hashePasswort(passwort)
    // Jedes Konto bekommt sofort eine Adresse — ein Profil ohne Handle wäre
    // nicht verlinkbar, und ein nachgereichter Handle hieße, dass die halbe
    // Anwendung mit „vielleicht keiner" rechnen müsste.
    const handle = freierHandle(handleAusEmail(benutzer.email), (h) => !this.handleFrei(h, null))
    try {
      this.db
        .prepare(
          'INSERT INTO users (id, email, pw_hash, name, created_at, email_verified, rolle, handle) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(benutzer.id, benutzer.email, pwHash, benutzer.name, new Date().toISOString(), verifiziert ? 1 : 0, rolle, handle)
    } catch (fehler) {
      // Die UNIQUE-Verletzung ist der einzige erwartbare Fall — als eigener
      // Fehlertyp, damit die Route 409 statt 500 antworten kann.
      if (String(fehler).includes('UNIQUE')) throw new EmailVergebenFehler()
      throw fehler
    }
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
      .prepare('SELECT id, email, pw_hash, name, rolle FROM users WHERE email = ?')
      .get(email.toLowerCase().trim()) as
      | { id: string; email: string; pw_hash: string; name: string; rolle: string }
      | undefined
    if (!zeile) {
      // Dummy-Prüfung gegen Timing-Unterschied „Benutzer existiert (nicht)"
      await pruefePasswort('$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', passwort)
      return null
    }
    const ok = await pruefePasswort(zeile.pw_hash, passwort)
    return ok ? { id: zeile.id, email: zeile.email, name: zeile.name, rolle: alsRolle(zeile.rolle) } : null
  }

  // — Sessions (Web) —

  erzeugeSession(userId: string, kennzeichen: SitzungsKennzeichen = {}): { id: string; ablauf: Date } {
    const id = neueSessionId()
    const jetzt = Date.now()
    const ablauf = new Date(jetzt + SESSION_DAUER_MS)
    this.db
      .prepare(
        `INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent, ip_praefix, zuletzt_gesehen, token_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        userId,
        new Date(jetzt).toISOString(),
        ablauf.toISOString(),
        kennzeichen.userAgent?.slice(0, 300) ?? null,
        ipPraefix(kennzeichen.ip),
        new Date(jetzt).toISOString(),
        kennzeichen.tokenId ?? null,
      )
    return { id, ablauf }
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
  sitzungZuToken(tokenId: string): { id: string; ablauf: Date } | null {
    const zeile = this.db
      .prepare(
        `SELECT id, expires_at FROM sessions
         WHERE token_id = ? AND expires_at > ? ORDER BY created_at DESC LIMIT 1`,
      )
      .get(tokenId, new Date().toISOString()) as { id: string; expires_at: string } | undefined
    return zeile ? { id: zeile.id, ablauf: new Date(zeile.expires_at) } : null
  }

  benutzerAusSession(sessionId: string): Benutzer | null {
    const zeile = this.db
      .prepare(
        `SELECT u.id, u.email, u.name, u.rolle, s.expires_at, s.zuletzt_gesehen FROM sessions s
         JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
      )
      .get(sessionId) as
      | { id: string; email: string; name: string; rolle: string; expires_at: string; zuletzt_gesehen: string | null }
      | undefined
    if (!zeile) return null
    if (Date.parse(zeile.expires_at) < Date.now()) {
      this.beendeSession(sessionId)
      return null
    }
    // Gedrosselt: „zuletzt gerade eben" braucht keine Auflösung von
    // Millisekunden, ein Schreibvorgang je Anfrage aber sehr wohl eine Platte.
    const zuletzt = zeile.zuletzt_gesehen ? Date.parse(zeile.zuletzt_gesehen) : 0
    if (Date.now() - zuletzt > GESEHEN_TAKT_MS) {
      this.db.prepare('UPDATE sessions SET zuletzt_gesehen = ? WHERE id = ?').run(new Date().toISOString(), sessionId)
    }
    return { id: zeile.id, email: zeile.email, name: zeile.name, rolle: alsRolle(zeile.rolle) }
  }

  beendeSession(sessionId: string): void {
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
  geraete(userId: string): Geraet[] {
    const jetzt = new Date().toISOString()
    const sitzungen = this.db
      .prepare(
        `SELECT id, created_at, user_agent, ip_praefix, zuletzt_gesehen FROM sessions
         WHERE user_id = ? AND expires_at > ? AND token_id IS NULL ORDER BY created_at DESC`,
      )
      .all(userId, jetzt) as Array<{
      id: string
      created_at: string
      user_agent: string | null
      ip_praefix: string | null
      zuletzt_gesehen: string | null
    }>
    const tokens = this.db
      .prepare('SELECT id, label, created_at, last_used_at FROM tokens WHERE user_id = ? ORDER BY created_at DESC')
      .all(userId) as Array<{ id: string; label: string; created_at: string; last_used_at: string | null }>
    return [
      ...sitzungen.map((s) => ({
        id: `sitzung:${s.id}`,
        art: 'sitzung' as const,
        kennung: s.user_agent,
        ipPraefix: s.ip_praefix,
        angemeldetAm: s.created_at,
        zuletztGesehen: s.zuletzt_gesehen,
      })),
      ...tokens.map((t) => ({
        id: `app:${t.id}`,
        art: 'app' as const,
        kennung: t.label,
        ipPraefix: null,
        angemeldetAm: t.created_at,
        zuletztGesehen: t.last_used_at,
      })),
    ]
  }

  /**
   * Ein Gerät abmelden. Die `user_id` steht in der Bedingung und nicht in einer
   * Prüfung davor: Sonst wäre zwischen „gehört mir?" und dem DELETE eine Lücke,
   * und eine fremde ID ließe sich mit genügend Versuchen finden.
   */
  meldeGeraetAb(userId: string, geraetId: string): boolean {
    const [art, id] = [geraetId.slice(0, geraetId.indexOf(':')), geraetId.slice(geraetId.indexOf(':') + 1)]
    if (!id) return false
    if (art === 'sitzung') {
      return this.db.prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?').run(id, userId).changes > 0
    }
    if (art === 'app') {
      return this.db.prepare('DELETE FROM tokens WHERE id = ? AND user_id = ?').run(id, userId).changes > 0
    }
    return false
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

  /**
   * Auflösung eines App-Tokens — Benutzer UND die Kennung des Tokens selbst.
   *
   * Die zweite Hälfte braucht genau ein Aufrufer: Ein Push-Gerät hängt am
   * Token, mit dem es sich angemeldet hat, damit „Gerät abmelden" in den
   * Kontoeinstellungen die Meldungen dorthin mit beendet. Die App kann das
   * nicht selbst aufräumen — sie ist in diesem Moment gerade ausgesperrt worden.
   */
  anmeldungAusToken(klartext: string): { benutzer: Benutzer; tokenId: string } | null {
    const hash = sha256(klartext)
    const zeile = this.db
      .prepare(
        `SELECT u.id, u.email, u.name, u.rolle, t.id AS token_id, t.hash FROM tokens t
         JOIN users u ON u.id = t.user_id WHERE t.hash = ?`,
      )
      .get(hash) as
      | { id: string; email: string; name: string; rolle: string; token_id: string; hash: string }
      | undefined
    if (!zeile) return null
    // Vergleich in konstanter Zeit (Hash-Lookup wäre theoretisch genug, kostet nichts)
    if (!timingSafeEqual(Buffer.from(zeile.hash), Buffer.from(hash))) return null
    this.db.prepare('UPDATE tokens SET last_used_at = ? WHERE id = ?').run(new Date().toISOString(), zeile.token_id)
    return {
      benutzer: { id: zeile.id, email: zeile.email, name: zeile.name, rolle: alsRolle(zeile.rolle) },
      tokenId: zeile.token_id,
    }
  }

  benutzerAusToken(klartext: string): Benutzer | null {
    return this.anmeldungAusToken(klartext)?.benutzer ?? null
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
  erzeugeMailToken(userId: string, zweck: MailZweck, nutzlast: string | null = null): string {
    this.db.prepare('DELETE FROM mail_tokens WHERE user_id = ? AND zweck = ? AND used_at IS NULL').run(userId, zweck)
    const klartext = neuesTokenSecret()
    const jetzt = Date.now()
    this.db
      .prepare(
        'INSERT INTO mail_tokens (id, user_id, zweck, hash, nutzlast, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        neueSessionId(),
        userId,
        zweck,
        sha256(klartext),
        nutzlast,
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
    return this.loeseMailTokenMitNutzlast(klartext, zweck)?.userId ?? null
  }

  /**
   * Dasselbe, aber mit dem, was beim Erzeugen mitgegeben wurde.
   *
   * Der E-Mail-Wechsel braucht das: Die neue Adresse darf erst nach dem Klick in
   * `users` stehen — bis dahin wohnt sie im Token. Stünde sie vorher dort,
   * gehörte das Konto ab dem Absenden einer Adresse, die niemand bestätigt hat.
   */
  loeseMailTokenMitNutzlast(
    klartext: string,
    zweck: MailZweck,
  ): { userId: string; nutzlast: string | null } | null {
    const hash = sha256(klartext)
    return this.db.transaction(() => {
      const zeile = this.db
        .prepare('SELECT id, user_id, nutzlast, expires_at, used_at FROM mail_tokens WHERE hash = ? AND zweck = ?')
        .get(hash, zweck) as
        | { id: string; user_id: string; nutzlast: string | null; expires_at: string; used_at: string | null }
        | undefined
      if (!zeile || zeile.used_at || Date.parse(zeile.expires_at) < Date.now()) return null
      this.db.prepare('UPDATE mail_tokens SET used_at = ? WHERE id = ?').run(new Date().toISOString(), zeile.id)
      return { userId: zeile.user_id, nutzlast: zeile.nutzlast }
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
  async setzePasswort(userId: string, passwort: string, behalteSession?: string): Promise<void> {
    const pwHash = await hashePasswort(passwort)
    this.db.prepare('UPDATE users SET pw_hash = ? WHERE id = ?').run(pwHash, userId)
    if (behalteSession) {
      this.db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(userId, behalteSession)
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
  uebernimmEigeneEmail(userId: string, email: string): boolean {
    try {
      const erg = this.db
        .prepare('UPDATE users SET email = ?, email_verified = 1 WHERE id = ?')
        .run(email.toLowerCase().trim(), userId)
      return erg.changes > 0
    } catch (fehler) {
      if (String(fehler).includes('UNIQUE')) return false
      throw fehler
    }
  }

  // — Handle (die Adresse einer Person) —

  /**
   * Räumt abgelaufene Reservierungen weg. Läuft vor jeder Handle-Frage, statt
   * als eigener Aufräum-Lauf: Die Tabelle ist klein, und eine Sperre, die
   * abgelaufen ist, muss in DEM Moment weg sein, in dem jemand nach dem Namen
   * fragt — nicht erst beim nächsten Neustart.
   */
  private raeumeHandleReservierungen(): void {
    this.db.prepare('DELETE FROM handles_reserviert WHERE frei_ab <= ?').run(new Date().toISOString())
  }

  /**
   * Ist der Handle zu haben? `fuerUserId` darf seinen eigenen behalten und
   * einen selbst aufgegebenen zurücknehmen — die 90-Tage-Sperre richtet sich
   * gegen ÜBERNAHME durch andere, nicht gegen den früheren Besitzer.
   */
  handleFrei(handle: string, fuerUserId: string | null): boolean {
    this.raeumeHandleReservierungen()
    const belegtVon = this.db.prepare('SELECT id FROM users WHERE handle = ? COLLATE NOCASE').get(handle) as
      | { id: string }
      | undefined
    if (belegtVon && belegtVon.id !== fuerUserId) return false
    const gesperrtFuer = this.db
      .prepare('SELECT user_id FROM handles_reserviert WHERE handle = ? COLLATE NOCASE')
      .get(handle) as { user_id: string } | undefined
    return !gesperrtFuer || gesperrtFuer.user_id === fuerUserId
  }

  /**
   * Handle → Benutzer-ID. Fällt auf die Reservierungen zurück, denn genau dafür
   * gibt es sie: Ein Link auf `@altname` soll die 90 Tage über weiter bei
   * derselben Person landen.
   */
  benutzerIdFuerHandle(handle: string): string | null {
    this.raeumeHandleReservierungen()
    const zeile = this.db.prepare('SELECT id FROM users WHERE handle = ? COLLATE NOCASE').get(handle) as
      | { id: string }
      | undefined
    if (zeile) return zeile.id
    const alt = this.db
      .prepare('SELECT user_id FROM handles_reserviert WHERE handle = ? COLLATE NOCASE')
      .get(handle) as { user_id: string } | undefined
    return alt?.user_id ?? null
  }

  /**
   * Handle setzen. Gibt den Grund zurück, warum nicht — `null` heißt erledigt.
   *
   * Der bisherige Handle wandert dabei für 90 Tage in `handles_reserviert`:
   * Alte Links leiten weiter, und niemand sonst kann die Adresse übernehmen und
   * die Links miterben. Derselbe Handle noch einmal ist ein No-op, kein Fehler —
   * sonst müsste jedes Formular vorher vergleichen.
   */
  setzeHandle(userId: string, wunsch: string): HandleFehler | null {
    const handle = wunsch.trim().toLowerCase()
    const formfehler = pruefeHandleForm(handle)
    if (formfehler) return formfehler
    const alt = this.handleVon(userId)
    if (alt && alt.toLowerCase() === handle) return null
    if (!this.handleFrei(handle, userId)) return 'vergeben'

    const jetzt = new Date()
    const freiAb = new Date(jetzt.getTime() + HANDLE_SPERRE_MS).toISOString()
    this.db.transaction(() => {
      if (alt) {
        this.db
          .prepare('INSERT OR REPLACE INTO handles_reserviert (handle, user_id, frei_ab) VALUES (?, ?, ?)')
          .run(alt, userId, freiAb)
      }
      // Die eigene alte Reservierung geht weg — sonst zeigte der Handle
      // gleichzeitig auf den Benutzer und auf sich selbst als „aufgegeben".
      this.db.prepare('DELETE FROM handles_reserviert WHERE handle = ? COLLATE NOCASE').run(handle)
      this.db
        .prepare('UPDATE users SET handle = ?, handle_geaendert_am = ? WHERE id = ?')
        .run(handle, jetzt.toISOString(), userId)
    })()
    return null
  }

  /** Der aktuelle Handle eines Kontos; null nur bei unbekannter ID. */
  handleVon(userId: string): string | null {
    const zeile = this.db.prepare('SELECT handle FROM users WHERE id = ?').get(userId) as
      | { handle: string | null }
      | undefined
    return zeile?.handle ?? null
  }

  /** Öffentliches Profil eines Benutzers; null, wenn es ihn nicht gibt. */
  profil(userId: string): Profil | null {
    const zeile = this.db
      .prepare(
        `SELECT handle, anzeigename, bio, ort, website, instagram, avatar, titelbild, profil_sichtbarkeit
         FROM users WHERE id = ?`,
      )
      .get(userId) as
      | {
          handle: string | null
          anzeigename: string | null
          bio: string | null
          ort: string | null
          website: string | null
          instagram: string | null
          avatar: string | null
          titelbild: string | null
          profil_sichtbarkeit: string
        }
      | undefined
    if (!zeile) return null
    return {
      handle: zeile.handle,
      anzeigename: zeile.anzeigename,
      bio: zeile.bio,
      ort: zeile.ort,
      website: zeile.website,
      instagram: zeile.instagram,
      avatar: zeile.avatar,
      titelbild: zeile.titelbild,
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
    if (aenderung.ort !== undefined) {
      zuweisungen.push('ort = ?')
      werte.push(leerAlsNull(aenderung.ort))
    }
    // Website und Instagram werden auf die nackte Form gebracht; was keine
    // Adresse ist, wird zu NULL statt geraten (s. profilfelder.ts). Ein leeres
    // Feld heißt hier wie überall „löschen".
    if (aenderung.website !== undefined) {
      zuweisungen.push('website = ?')
      werte.push(nacktesWeb(aenderung.website))
    }
    if (aenderung.instagram !== undefined) {
      zuweisungen.push('instagram = ?')
      werte.push(nacktesInstagram(aenderung.instagram))
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

  /** Titelbild vermerken — Name eines Vorschlags ODER Pfad im Benutzer-Storage. */
  setzeTitelbild(userId: string, wert: string | null): void {
    this.db.prepare('UPDATE users SET titelbild = ? WHERE id = ?').run(wert, userId)
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
  kennzahlen(userId: string): { touren: number; km: number; hm: number } {
    const zeile = this.db
      .prepare(
        `SELECT COUNT(*) AS touren,
                COALESCE(SUM(json_extract(stats_json, '$.km')), 0) AS km,
                COALESCE(SUM(json_extract(stats_json, '$.gainM')), 0) AS hm
         FROM tours
         WHERE owner_id = ? AND visibility = 'public' AND status = 'bereit'`,
      )
      .get(userId) as { touren: number; km: number; hm: number }
    return { touren: zeile.touren, km: zeile.km, hm: Math.round(zeile.hm) }
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
  alleBenutzer(): BenutzerZeile[] {
    const zeilen = this.db
      .prepare(
        `SELECT id, email, name, rolle, email_verified, created_at, anzeigename,
                (SELECT COUNT(*) FROM tours WHERE tours.owner_id = users.id) AS touren
         FROM users ORDER BY created_at ASC`,
      )
      .all() as Array<{
      id: string
      email: string
      name: string
      rolle: string
      email_verified: number
      created_at: string
      anzeigename: string | null
      touren: number
    }>
    return zeilen.map((z) => ({
      id: z.id,
      email: z.email,
      name: z.name,
      rolle: alsRolle(z.rolle),
      verifiziert: !!z.email_verified,
      angelegtAm: z.created_at,
      anzeigename: z.anzeigename,
      touren: z.touren,
    }))
  }

  /** Ein Konto der Verwaltung; null, wenn es die ID nicht gibt. */
  benutzerNachId(userId: string): BenutzerZeile | null {
    return this.alleBenutzer().find((b) => b.id === userId) ?? null
  }

  /** Wie viele Konten haben die Admin-Rolle? (Schutz vor dem letzten Abgang.) */
  anzahlAdmins(): number {
    return (this.db.prepare(`SELECT COUNT(*) AS n FROM users WHERE rolle = 'admin'`).get() as { n: number }).n
  }

  /**
   * Kontofelder ändern. Nur übergebene Felder werden angefasst — dieselbe
   * Bauweise wie `setzeProfil`, aus demselben Grund (COALESCE könnte „leeren"
   * nicht von „nicht angefasst" unterscheiden).
   *
   * Eine geänderte E-Mail gilt als unbestätigt weiter: `verifiziert` wird
   * NICHT automatisch zurückgesetzt, weil ein Admin die Adresse gerade
   * bewusst korrigiert hat — er kann den Haken selbst setzen.
   */
  aendereKonto(userId: string, aenderung: KontoAenderung): void {
    const zuweisungen: string[] = []
    const werte: Array<string | number> = []
    if (aenderung.email !== undefined) {
      zuweisungen.push('email = ?')
      werte.push(aenderung.email.toLowerCase().trim())
    }
    if (aenderung.name !== undefined) {
      zuweisungen.push('name = ?')
      werte.push(aenderung.name.trim())
    }
    if (aenderung.rolle !== undefined) {
      zuweisungen.push('rolle = ?')
      werte.push(aenderung.rolle)
    }
    if (aenderung.verifiziert !== undefined) {
      zuweisungen.push('email_verified = ?')
      werte.push(aenderung.verifiziert ? 1 : 0)
    }
    if (!zuweisungen.length) return
    try {
      this.db.prepare(`UPDATE users SET ${zuweisungen.join(', ')} WHERE id = ?`).run(...werte, userId)
    } catch (fehler) {
      if (String(fehler).includes('UNIQUE')) throw new EmailVergebenFehler()
      throw fehler
    }
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
