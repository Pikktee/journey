// Zentrale Konfiguration aus der Umgebung. Alle Werte haben Dev-taugliche
// Defaults; in Produktion (Docker Compose) kommen sie aus dem Environment.

import { VISION_MODEL_DEFAULT } from './pipeline/vision.js'

export interface Config {
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
  /**
   * Woher der Server das GEBAUTE HTML holt, wenn er eine Seite selbst
   * beantwortet (`seiten.ts`, `/@handle`).
   *
   * Normalerweise dieselbe Adresse wie `basisUrl` — der Container holt die
   * Datei über denselben Nginx, der sie auch dem Browser ausliefert. Getrennt
   * konfigurierbar bleibt sie, weil der Weg dorthin ein anderer sein kann als
   * der, unter dem die Seite öffentlich steht (anderer Port, interner Name).
   */
  webUrl: string
  /** Absender der System-Mails */
  mailAbsender: string
  /** OpenRouter-API-Key für die Wetter-Bildanalyse (M5); null = Feature aus (No-Op) */
  openRouterKey: string | null
  /** Vision-Modell (M5) über OpenRouter; Default gutes Preis/Leistung, via Env überschreibbar */
  visionModell: string
  /**
   * Passwort der Umami-Postgres-Datenbank (Reichweitenmessung, selbst gehostet
   * im Nachbar-Container). Nur der Statistik-Reiter der Verwaltung liest damit.
   *
   * Kein Default: Ein Geheimnis gehört nicht in den Quelltext — fehlt der Wert,
   * bleibt die Statistik leer, statt dass irgendwo ein eingebautes Passwort
   * mitläuft.
   */
  umamiDbPasswort: string | null
  /**
   * Schlüssel für die OAuth-Tokens der Tracker-Anbieter (AES-256-GCM).
   *
   * Bewusst EIGENE Variable und nicht aus `cookieSecret` abgeleitet: Ein
   * Cookie-Geheimnis rotiert man beiläufig (alle Sitzungen weg, halb so
   * schlimm) — mit demselben Handgriff wären dann alle Verknüpfungen tot und
   * müssten neu autorisiert werden. Fehlt der Schlüssel, sind alle
   * OAuth-Anbieter „nicht konfiguriert"; Klartext als Rückfall gibt es nicht.
   */
  trackerSchluessel: string | null
  /** Zugangsdaten je Tracker-Anbieter; fehlen sie, ist der Anbieter aus (nicht kaputt). */
  polar: ProviderCredentials
  /**
   * Dienstkonto-JSON eines Firebase-Projekts für den Push-Versand (FCM
   * HTTP v1). Fehlt es, ist Push aus — die App fällt auf ihren periodischen
   * Abruf zurück, den es aus genau diesem Grund weiter gibt.
   *
   * Aufbewahrt wird der ROHE JSON-Text, nicht das geparste Objekt: Was hier
   * ankommt, ist eine Umgebungsvariable, und ob sie brauchbar ist, entscheidet
   * der Versand beim Bauen (`FcmPush`) — dort steht auch die Fehlermeldung, die
   * jemandem beim Einrichten hilft.
   *
   * Die Variable heißt englisch (`MAPTALE_FCM_SERVICE_ACCOUNT`), der Bezeichner
   * hier deutsch — dieselbe Linie wie bei den Tracker-Routen: Was nach außen
   * zeigt und in einer fremden Konsole eingetippt wird, ist Außenfläche.
   */
  fcmDienstkonto: string | null
}

/** Client-ID/-Secret plus Webhook-Geheimnis eines OAuth-Anbieters. */
export interface ProviderCredentials {
  clientId: string | null
  clientSecret: string | null
  /** Signatur-Schlüssel des Webhooks; bei Polar die Antwort auf `POST /v3/webhooks`. */
  webhookGeheimnis: string | null
}

// Docker-Compose reicht Variablen als ${VAR:-} durch — nicht gesetzte werden zu
// LEEREN Strings, nicht zu undefined. `??` fängt die nicht → Number('')===0
// (Quota 0 = alle Uploads blockiert!) bzw. leere URL/Absender. Diese Helfer
// behandeln leer wie „nicht gesetzt" und fallen auf den Default zurück.
const text = (wert: string | undefined, standard: string): string =>
  wert && wert.trim() ? wert : standard
const zahl = (wert: string | undefined, standard: number): number => {
  const n = Number(wert)
  return wert && wert.trim() && Number.isFinite(n) ? n : standard
}
/** Geheimnis aus der Umgebung: leer (docker-compose `${VAR:-}`) zählt wie nicht gesetzt. */
const geheim = (wert: string | undefined): string | null => (wert?.trim() ? wert.trim() : null)
/**
 * Ein mehrzeiliges Geheimnis (Dienstkonto-JSON) aus der Umgebung.
 *
 * Beide Formen werden angenommen, und das ist kein Wischiwaschi: In der
 * `.env` des Servers steht **Base64** — ein JSON mit eingebetteten `\n` im
 * privaten Schlüssel überlebt keine `.env`-Zeile —, beim lokalen Ausprobieren
 * dagegen kopiert man die Datei roh in die Variable. Erkannt wird an der Form
 * (`{` = JSON), nicht an einer zweiten Variablen: Zwei Variablen für dieselbe
 * Sache wären genau der Schalter, den man am Einrichtungstag falsch stellt.
 */
const mehrzeilig = (wert: string | undefined): string | null => {
  const roh = wert?.trim()
  if (!roh) return null
  if (roh.startsWith('{')) return roh
  const entpackt = Buffer.from(roh, 'base64').toString('utf8').trim()
  return entpackt.startsWith('{') ? entpackt : null
}
/** Kommagetrennte Adressliste, normalisiert wie in der users-Tabelle (lowercase). */
const adressen = (wert: string | undefined, standard: string): string[] =>
  text(wert, standard)
    .split(',')
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean)

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): Config {
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
    webUrl: text(env.MAPTALE_WEB_URL, text(env.MAPTALE_BASIS_URL, 'http://localhost:5173')),
    mailAbsender: text(env.MAPTALE_MAIL_ABSENDER, 'Maptale <noreply@maptale.io>'),
    // Leer (docker-compose ${VAR:-}) wie „nicht gesetzt" behandeln → Feature aus.
    openRouterKey: env.OPEN_ROUTER_KEY?.trim() ? env.OPEN_ROUTER_KEY.trim() : null,
    visionModell: text(env.MAPTALE_VISION_MODELL, VISION_MODEL_DEFAULT),
    umamiDbPasswort: env.MAPTALE_UMAMI_DB_PASSWORT?.trim()
      ? env.MAPTALE_UMAMI_DB_PASSWORT.trim()
      : null,
    trackerSchluessel: geheim(env.MAPTALE_TRACKER_SECRET),
    polar: {
      clientId: geheim(env.MAPTALE_POLAR_CLIENT_ID),
      clientSecret: geheim(env.MAPTALE_POLAR_CLIENT_SECRET),
      webhookGeheimnis: geheim(env.MAPTALE_POLAR_WEBHOOK_SECRET),
    },
    fcmDienstkonto: mehrzeilig(env.MAPTALE_FCM_SERVICE_ACCOUNT),
  }
}
