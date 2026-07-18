// Test-Aufbau: App mit In-Memory-Abhängigkeiten (SQLite :memory:, MemStorage,
// fester Geocoder) plus angemeldetem Testbenutzer. Spiegelbild der DI-Wurzel
// in index.ts — nur eben ohne Netz und Dateisystem.

import type { FastifyInstance } from 'fastify'
import { baueApp } from '../src/app.js'
import type { Konfig } from '../src/config.js'
import { oeffneDb } from '../src/db.js'
import type { MailNachricht, MailVersand } from '../src/mail.js'
import { FesterGeocoder } from '../src/pipeline/naming.js'
import type { VideoWerkzeug } from '../src/pipeline/video.js'
import type { BildKlassifikator } from '../src/pipeline/vision.js'
import type { WetterQuelle } from '../src/pipeline/weather.js'
import { MemStorage } from '../src/storage.js'
import type { UploadManifest } from '../src/schema/upload.js'

export const TEST_KONFIG: Konfig = {
  port: 0,
  datenDir: '/nirgendwo',
  cookieSecret: 'test',
  adminEmail: null,
  adminPasswort: null,
  maxMediumBytes: 1024 * 1024,
  maxAudioBytes: 1024 * 1024,
  maxSpeicherProBenutzer: 50 * 1024 * 1024,
  hinterTls: false,
  registrierungOffen: true,
  basisUrl: 'http://localhost:5173',
  mailAbsender: 'Luhambo <noreply@test>',
  anthropicApiKey: null,
  anthropicModell: 'claude-haiku-4-5-20251001',
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
  mail: SammelMail
  /** Session-Cookie des angemeldeten Testbenutzers, für inject() */
  cookies: { luhambo_session: string }
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
  // FesterKlassifikator herein (Spiegelbild des AnthropicKlassifikator in index.ts)
  bildKlassifikator: BildKlassifikator | null = null,
): Promise<TestUmgebung> {
  const db = oeffneDb(':memory:')
  const storage = new MemStorage()
  const mail = new SammelMail()
  const app = baueApp({
    konfig: { ...TEST_KONFIG, ...konfigPatch },
    db,
    storage,
    geocoder: new FesterGeocoder(geocoderAntworten),
    wetter,
    videoWerkzeug,
    bildKlassifikator,
    mail,
  })
  await app.auth.legeBenutzerAn('test@example.com', 'geheim123', 'Testerin')

  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'test@example.com', passwort: 'geheim123', tokenLabel: 'Testgerät' },
  })
  if (login.statusCode !== 200) throw new Error(`Test-Login fehlgeschlagen: ${login.body}`)
  const sessionCookie = login.cookies.find((c) => c.name === 'luhambo_session')
  const apiToken = (login.json() as { apiToken: string }).apiToken

  return { app, storage, mail, cookies: { luhambo_session: sessionCookie?.value ?? '' }, apiToken }
}

/** Minimales, gültiges Upload-Manifest: 2 Segmente, 1 Foto (Berner Oberland). */
export function beispielManifest(): UploadManifest {
  return {
    schema: 'luhambo/upload@1',
    clientTourId: 'client-tour-1',
    title: null,
    description: null,
    time: { start: '2026-07-04T08:12:31+02:00', end: '2026-07-04T14:03:10+02:00', zone: 'Europe/Zurich' },
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
