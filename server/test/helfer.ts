// Test-Aufbau: App mit In-Memory-Abhängigkeiten (SQLite :memory:, MemStorage,
// fester Geocoder) plus angemeldetem Testbenutzer. Spiegelbild der DI-Wurzel
// in index.ts — nur eben ohne Netz und Dateisystem.

import type { FastifyInstance } from 'fastify'
import { baueApp } from '../src/app.js'
import type { Konfig } from '../src/config.js'
import { oeffneDb } from '../src/db.js'
import type { MailNachricht, MailVersand } from '../src/mail.js'
import type { PushNachricht, PushVersand, Zustellung } from '../src/push.js'
import { FesterGeocoder } from '../src/pipeline/naming.js'
import type { BildWerkzeug } from '../src/pipeline/bild.js'
import type { VideoWerkzeug } from '../src/pipeline/video.js'
import type { SchienenQuelle } from '../src/pipeline/schienen.js'
import type { BildKlassifikator } from '../src/pipeline/vision.js'
import type { WetterQuelle } from '../src/pipeline/weather.js'
import { SeitenQuelle } from '../src/seiten.js'
import type { TrackerProvider } from '../src/tracker/vertrag.js'
import { MemStorage } from '../src/storage.js'
import type { UploadManifest } from '../src/schema/upload.js'

/**
 * Die gebaute `profil.html`, wie der Server sie über Nginx bekäme — auf das
 * Nötige gekürzt. Fest hinterlegt statt aus dem Repo gelesen: Der Test prüft,
 * ob der Server den Block zwischen den Markern ersetzt, nicht, was die echte
 * Seite sonst enthält. Dass die Marker dort tatsächlich stehen, prüft der
 * Wächter im Web-Test (test/routen.test.ts).
 */
export const TEST_PROFIL_HTML =
  '<!doctype html><html><head>\n  <!-- maptale:meta -->\n  <title>Profil · Maptale</title>\n  <meta name="robots" content="noindex" />\n  <!-- /maptale:meta -->\n  <link rel="stylesheet" href="/assets/profil-abc123.css" />\n</head><body>Profil</body></html>'

/** Dasselbe für den Player — der Kopf, den die mitgelieferten Touren behalten. */
export const TEST_PLAYER_HTML = TEST_PROFIL_HTML.replace(
  '<title>Profil · Maptale</title>',
  '<title>Maptale — 3D-Reiseflug</title>',
).replace('profil-abc123.css', 'erlebnis-def456.css')

export const TEST_KONFIG: Konfig = {
  port: 0,
  datenDir: '/nirgendwo',
  cookieSecret: 'test',
  adminEmail: null,
  adminPasswort: null,
  adminEmails: [],
  maxMediumBytes: 1024 * 1024,
  maxAudioBytes: 1024 * 1024,
  maxSpeicherProBenutzer: 50 * 1024 * 1024,
  hinterTls: false,
  registrierungOffen: true,
  basisUrl: 'http://localhost:5173',
  webUrl: 'https://maptale.test',
  mailAbsender: 'Luhambo <noreply@test>',
  openRouterKey: null,
  visionModell: 'google/gemini-2.5-flash-lite',
  // Ohne Passwort läuft im Test nie ein `docker exec` — die Statistik-Route
  // antwortet mit ihrem leeren Ergebnis.
  umamiDbPasswort: null,
  // Fester Schlüssel statt null: Die Tracker-Tests brauchen verschlüsselbare
  // Tokens, und ein zufälliger Wert je Lauf machte gespeicherte Fixtures
  // unlesbar. Echte Anbieter bleiben trotzdem aus — dafür fehlen die
  // Client-IDs, und die Registry meldet sie als „nicht verfügbar".
  trackerSchluessel: 'test-tracker-schluessel',
  polar: { clientId: null, clientSecret: null, webhookGeheimnis: null },
  // Kein Dienstkonto: index.ts baut daraus keinen FcmPush. Tests, die Push
  // brauchen, reichen einen SammelPush an `baueTestApp` durch — an der
  // Konfiguration hängt nur die Produktions-Verdrahtung.
  fcmDienstkonto: null,
}

/**
 * Push-Fake: sammelt Nachrichten, statt sie zu senden.
 *
 * `abgemeldeteTokens` ist der Hebel für den einen Fall, den kein anderer Test
 * erreicht: FCM lehnt einen Token ab, weil die App deinstalliert wurde — und
 * die Zeile muss dann verschwinden, nicht ins Protokoll.
 */
export class SammelPush implements PushVersand {
  readonly einsatzbereit = true
  gesendet: Array<{ tokens: string[]; nachricht: PushNachricht }> = []
  abgemeldeteTokens = new Set<string>()
  /** Auf `true` gesetzt wirft der Versand — der Import darf davon nicht kippen. */
  faelltAus = false

  async sende(tokens: readonly string[], nachricht: PushNachricht): Promise<Zustellung[]> {
    if (this.faelltAus) throw new Error('FCM antwortet nicht')
    this.gesendet.push({ tokens: [...tokens], nachricht })
    return tokens.map((token) => ({ token, abgemeldet: this.abgemeldeteTokens.has(token) }))
  }
}

/** Mail-Fake: sammelt Nachrichten, statt sie zu versenden (Auth-Flüsse testbar). */
export class SammelMail implements MailVersand {
  nachrichten: MailNachricht[] = []
  async sende(nachricht: MailNachricht): Promise<void> {
    this.nachrichten.push(nachricht)
  }
  /** Letzten Link (verify/reset) aus dem Mail-Text ziehen — für die Token-Einlösung. */
  letzterLink(): string | null {
    const text = this.nachrichten.at(-1)?.text ?? ''
    return text.match(/https?:\/\/\S+/)?.[0] ?? null
  }
}

export interface TestUmgebung {
  app: FastifyInstance
  storage: MemStorage
  /** Ablage für Benutzerdateien (Avatare) */
  benutzerStorage: MemStorage
  /** Ablage der Datenexport-Archive. */
  archive: MemStorage
  mail: SammelMail
  /** Session-Cookie des angemeldeten Testbenutzers, für inject() */
  cookies: { maptale_session: string }
  apiToken: string
}

export async function baueTestApp(
  geocoderAntworten: Array<string | null> = ['Lauterbrunnen', 'Grindelwald'],
  // Default null: Wetter aus — Tests, die Keyframes brauchen, geben eine
  // FesteWetterQuelle herein (Spiegelbild der OpenMeteoQuelle in index.ts)
  wetter: WetterQuelle | null = null,
  // Default null: keine Video-Aufbereitung — Video-Tests geben einen
  // FakeVideoWerkzeug herein (Spiegelbild des FfmpegWerkzeug in index.ts)
  videoWerkzeug: VideoWerkzeug | null = null,
  // M9: einzelne Konfig-Werte übersteuern (Quota, Registrierung offen/zu …)
  konfigPatch: Partial<Konfig> = {},
  // Default null: keine Bildanalyse (M5) — Vision-Tests geben einen
  // FesterKlassifikator herein (Spiegelbild des OpenRouterKlassifikator in index.ts)
  bildKlassifikator: BildKlassifikator | null = null,
  // Default null: kein Schienen-Abgleich — Tram-Tests geben FesteSchienen
  // herein (Spiegelbild der OverpassSchienen in index.ts)
  schienen: SchienenQuelle | null = null,
  // Default null: keine Bild-Aufbereitung — Medien bleiben Originale. Tests zu
  // den Fassungen geben ein FakeBildWerkzeug herein (Spiegelbild des
  // FfmpegBildWerkzeug in index.ts)
  bildWerkzeug: BildWerkzeug | null = null,
  // Default leer: keine Tracker-Anbieter — die Routen antworten mit einer
  // leeren Liste. Tracker-Tests geben einen TestProvider herein (Spiegelbild
  // der echten Adapter in index.ts).
  trackerProvider: TrackerProvider[] = [],
  // Default null: kein Push — die Registrier-Route antwortet mit `push: false`
  // und der Importlauf meldet nichts. Push-Tests geben einen SammelPush herein
  // (Spiegelbild des FcmPush in index.ts).
  push: PushVersand | null = null,
): Promise<TestUmgebung> {
  const db = oeffneDb(':memory:')
  const storage = new MemStorage()
  const benutzerStorage = new MemStorage()
  const archive = new MemStorage()
  const mail = new SammelMail()
  const app = baueApp({
    konfig: { ...TEST_KONFIG, ...konfigPatch },
    db,
    storage,
    benutzerStorage,
    archive,
    geocoder: new FesterGeocoder(geocoderAntworten),
    wetter,
    videoWerkzeug,
    bildWerkzeug,
    bildKlassifikator,
    schienen,
    trackerProvider,
    push,
    mail,
    // Ohne Netz: Der Server holt die gebaute Seite sonst über konfig.webUrl.
    seiten: new SeitenQuelle({ webUrl: 'https://maptale.test' }, async (url) =>
      url.endsWith('erlebnis.html') ? TEST_PLAYER_HTML : TEST_PROFIL_HTML,
    ),
  })
  await app.auth.legeBenutzerAn('test@example.com', 'geheim123', 'Testerin')

  // ZWEI Anmeldungen, weil es zwei Sorten Client gibt und sie sich seit
  // 2026-08-10 ausschließen: Der Browser bekommt eine Sitzung, der API-Client
  // ein Token (und ausdrücklich keine Sitzung — s. Login-Route). Die
  // Testumgebung spielt beide, deshalb steht hier, was in echt zwei Geräte
  // wären.
  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'test@example.com', password: 'geheim123' },
  })
  if (login.statusCode !== 200) throw new Error(`Test-Login fehlgeschlagen: ${login.body}`)
  const sessionCookie = login.cookies.find((c) => c.name === 'maptale_session')
  const appLogin = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'test@example.com', password: 'geheim123', tokenLabel: 'Testgerät' },
  })
  const apiToken = (appLogin.json() as { apiToken: string }).apiToken

  return {
    app,
    storage,
    benutzerStorage,
    archive,
    mail,
    cookies: { maptale_session: sessionCookie?.value ?? '' },
    apiToken,
  }
}

/**
 * Registrierung ohne Einladungscode erlauben.
 *
 * Die Vorgabe einer frischen Instanz ist „nur mit Code" (s. EinladungsDienst) —
 * Tests, die den offenen Fluss prüfen, machen die Tür hier ausdrücklich auf.
 */
export function oeffneRegistrierung(u: TestUmgebung): void {
  u.app.einladungen.setzePflicht(false)
}

/** Zweiter Benutzer mit Admin-Rolle, samt Session-Cookie für inject(). */
export async function legeAdminAn(
  u: TestUmgebung,
  email = 'chefin@example.com',
  password = 'adminadmin',
): Promise<{ id: string; cookies: { maptale_session: string } }> {
  const user = await u.app.auth.legeBenutzerAn(email, password, 'Chefin', true, 'admin')
  const login = await u.app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password },
  })
  if (login.statusCode !== 200) throw new Error(`Admin-Login fehlgeschlagen: ${login.body}`)
  return {
    id: user.id,
    cookies: {
      maptale_session: login.cookies.find((c) => c.name === 'maptale_session')?.value ?? '',
    },
  }
}

/** Minimales, gültiges Upload-Manifest: 2 Segmente, 1 Foto (Berner Oberland). */
export function beispielManifest(): UploadManifest {
  return {
    schema: 'maptale/upload@1',
    clientTourId: 'client-tour-1',
    title: null,
    description: null,
    time: {
      start: '2026-07-04T08:12:31+02:00',
      end: '2026-07-04T14:03:10+02:00',
      zone: 'Europe/Zurich',
    },
    segments: [
      {
        mode: 'walk',
        pts: [
          [7.9086, 46.5934, 800, 0],
          [7.9105, 46.59, 830, 620],
          [7.9142, 46.5872, 905, 1400],
        ],
      },
      {
        mode: 'bike',
        pts: [
          [7.9142, 46.5872, 905, 1400],
          [7.9184, 46.5891, 1005, 2000],
          [8.0341, 46.6244, 1034, 21000],
        ],
      },
    ],
    media: [
      {
        id: 'm1',
        type: 'photo',
        file: 'IMG_0012.JPG',
        takenAt: '2026-07-04T09:01:12+02:00',
        anchor: [7.9105, 46.59],
        caption: null,
      },
    ],
  }
}
