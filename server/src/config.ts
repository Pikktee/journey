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
  /** Maximale Größe einer einzelnen Mediendatei (Bytes) */
  maxMediumBytes: number
  /** Maximale Größe einer Audio-Datei (Bytes, Baukasten) — deutlich unter Video */
  maxAudioBytes: number
  /** Speicher-Quota pro Benutzer (Bytes, M9) — deckelt VPS-Platz und Vision-Kosten */
  maxSpeicherProBenutzer: number
  /** true hinter TLS (Prod): Cookies bekommen `secure` */
  hinterTls: boolean
  /** M9: Selbst-Registrierung offen? (Default an; für private Instanzen abschaltbar) */
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

export function konfigAusEnv(env: NodeJS.ProcessEnv = process.env): Konfig {
  return {
    port: zahl(env.PORT, 8787),
    datenDir: text(env.LUHAMBO_DATEN_DIR, './daten'),
    cookieSecret: text(env.LUHAMBO_COOKIE_SECRET, 'dev-geheimnis-nicht-fuer-prod'),
    adminEmail: env.LUHAMBO_ADMIN_EMAIL || null,
    adminPasswort: env.LUHAMBO_ADMIN_PASSWORT || null,
    maxMediumBytes: zahl(env.LUHAMBO_MAX_MEDIUM_BYTES, 500 * 1024 * 1024),
    maxAudioBytes: zahl(env.LUHAMBO_MAX_AUDIO_BYTES, 25 * 1024 * 1024),
    maxSpeicherProBenutzer: zahl(env.LUHAMBO_MAX_SPEICHER_PRO_BENUTZER, 2 * 1024 * 1024 * 1024),
    hinterTls: env.LUHAMBO_HINTER_TLS === '1',
    registrierungOffen: env.LUHAMBO_REGISTRIERUNG_OFFEN !== '0',
    basisUrl: text(env.LUHAMBO_BASIS_URL, 'http://localhost:5173'),
    mailAbsender: text(env.LUHAMBO_MAIL_ABSENDER, 'Luhambo <noreply@luhambo.app>'),
    // Leer (docker-compose ${VAR:-}) wie „nicht gesetzt" behandeln → Feature aus.
    openRouterKey: env.OPEN_ROUTER_KEY?.trim() ? env.OPEN_ROUTER_KEY.trim() : null,
    visionModell: text(env.LUHAMBO_VISION_MODELL, VISION_MODELL_DEFAULT),
  }
}
