// Test-Aufbau: App mit In-Memory-Abhängigkeiten (SQLite :memory:, MemStorage,
// fester Geocoder) plus angemeldetem Testbenutzer. Spiegelbild der DI-Wurzel
// in index.ts — nur eben ohne Netz und Dateisystem.

import type { FastifyInstance } from 'fastify'
import { baueApp } from '../src/app.js'
import type { Konfig } from '../src/config.js'
import { oeffneDb } from '../src/db.js'
import { FesterGeocoder } from '../src/pipeline/naming.js'
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
  hinterTls: false,
}

export interface TestUmgebung {
  app: FastifyInstance
  storage: MemStorage
  /** Session-Cookie des angemeldeten Testbenutzers, für inject() */
  cookies: { luhambo_session: string }
  apiToken: string
}

export async function baueTestApp(
  geocoderAntworten: Array<string | null> = ['Lauterbrunnen', 'Grindelwald'],
  // Default null: Wetter aus — Tests, die Keyframes brauchen, geben eine
  // FesteWetterQuelle herein (Spiegelbild der OpenMeteoQuelle in index.ts)
  wetter: WetterQuelle | null = null,
): Promise<TestUmgebung> {
  const db = oeffneDb(':memory:')
  const storage = new MemStorage()
  const app = baueApp({
    konfig: TEST_KONFIG,
    db,
    storage,
    geocoder: new FesterGeocoder(geocoderAntworten),
    wetter,
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

  return { app, storage, cookies: { luhambo_session: sessionCookie?.value ?? '' }, apiToken }
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
