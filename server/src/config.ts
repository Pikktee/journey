// Zentrale Konfiguration aus der Umgebung. Alle Werte haben Dev-taugliche
// Defaults; in Produktion (Docker Compose) kommen sie aus dem Environment.

import { VISION_MODELL_DEFAULT } from './pipeline/vision.js'

export interface Konfig {
  /** TCP-Port der API */
  port: number
  /** Datenverzeichnis: SQLite-Datei + Tour-Ablage (Medien, Manifeste, tour.json) */
  datenDir: string
  /** Geheimnis zum Signieren der Session-Cookies */
  cookieSecret: string
  /** Seed-Admin: wird beim Start angelegt, falls noch kein Benutzer existiert */
  adminEmail: string | null
  adminPasswort: string | null
  /**
   * Adressen, die bei jedem Start auf die Admin-Rolle gehoben werden.
   *
   * Bewusst eine Boot-Garantie und keine einmalige Migration: Wer hier steht,
   * kann sich aus der Benutzerverwaltung nicht aussperren, und ein Konto, das
   * es beim Umstellen noch gar nicht gab, wird Admin, sobald es angelegt ist.
   * Die Kehrseite: Diese Konten lassen sich in der Oberfläche nicht
   * herabstufen — die Route lehnt das ab, statt es beim nächsten Neustart
   * still rückgängig zu machen.
   */
  adminEmails: string[]
  /** Maximale Größe einer einzelnen Mediendatei (Bytes) */
  maxMediumBytes: number
  /** Maximale Größe einer Audio-Datei (Bytes, Baukasten) — deutlich unter Video */
  maxAudioBytes: number
  /** Speicher-Quota pro Benutzer (Bytes, M9) — deckelt VPS-Platz und Vision-Kosten */
  maxSpeicherProBenutzer: number
  /** true hinter TLS (Prod): Cookies bekommen `secure` */
  hinterTls: boolean
  /**
   * Harter Riegel: Registrierung überhaupt möglich? (Default an)
   *
   * Steht ÜBER dem umschaltbaren Einladungs-Schalter aus der Datenbank — ist
   * dieser Riegel zu, hilft auch kein gültiger Code. Gedacht für Instanzen,
   * die gar keine neuen Konten wollen; der Alltagsfall („nur mit Einladung")
   * läuft über die Verwaltung, nicht über die Umgebung.
   */
  registrierungOffen: boolean
  /** Öffentliche Basis-URL (für Links in Bestätigungs-/Reset-Mails), z. B. https://luhambo.app */
  basisUrl: string
  /** Absender der System-Mails */
  mailAbsender: string
  /** OpenRouter-API-Key für die Wetter-Bildanalyse (M5); null = Feature aus (No-Op) */
  openRouterKey: string | null
  /** Vision-Modell (M5) über OpenRouter; Default gutes Preis/Leistung, via Env überschreibbar */
  visionModell: string
}

// Docker-Compose reicht Variablen als ${VAR:-} durch — nicht gesetzte werden zu
// LEEREN Strings, nicht zu undefined. `??` fängt die nicht → Number('')===0
// (Quota 0 = alle Uploads blockiert!) bzw. leere URL/Absender. Diese Helfer
// behandeln leer wie „nicht gesetzt" und fallen auf den Default zurück.
const text = (wert: string | undefined, standard: string): string => (wert && wert.trim() ? wert : standard)
const zahl = (wert: string | undefined, standard: number): number => {
  const n = Number(wert)
  return wert && wert.trim() && Number.isFinite(n) ? n : standard
}
/** Kommagetrennte Adressliste, normalisiert wie in der users-Tabelle (lowercase). */
const adressen = (wert: string | undefined, standard: string): string[] =>
  text(wert, standard)
    .split(',')
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean)

export function konfigAusEnv(env: NodeJS.ProcessEnv = process.env): Konfig {
  return {
    port: zahl(env.PORT, 8787),
    datenDir: text(env.MAPTALE_DATEN_DIR, './daten'),
    cookieSecret: text(env.MAPTALE_COOKIE_SECRET, 'dev-geheimnis-nicht-fuer-prod'),
    adminEmail: env.MAPTALE_ADMIN_EMAIL || null,
    adminPasswort: env.MAPTALE_ADMIN_PASSWORT || null,
    adminEmails: adressen(env.MAPTALE_ADMINS, 'contact@henrikheil.net,henrik.heil@gmail.com'),
    maxMediumBytes: zahl(env.MAPTALE_MAX_MEDIUM_BYTES, 500 * 1024 * 1024),
    maxAudioBytes: zahl(env.MAPTALE_MAX_AUDIO_BYTES, 25 * 1024 * 1024),
    maxSpeicherProBenutzer: zahl(env.MAPTALE_MAX_SPEICHER_PRO_BENUTZER, 2 * 1024 * 1024 * 1024),
    hinterTls: env.MAPTALE_HINTER_TLS === '1',
    registrierungOffen: env.MAPTALE_REGISTRIERUNG_OFFEN !== '0',
    basisUrl: text(env.MAPTALE_BASIS_URL, 'http://localhost:5173'),
    mailAbsender: text(env.MAPTALE_MAIL_ABSENDER, 'Maptale <noreply@maptale.io>'),
    // Leer (docker-compose ${VAR:-}) wie „nicht gesetzt" behandeln → Feature aus.
    openRouterKey: env.OPEN_ROUTER_KEY?.trim() ? env.OPEN_ROUTER_KEY.trim() : null,
    visionModell: text(env.MAPTALE_VISION_MODELL, VISION_MODELL_DEFAULT),
  }
}
