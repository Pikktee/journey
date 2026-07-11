// Einstiegspunkt: Konfiguration lesen, echte Abhängigkeiten aufbauen, starten.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { baueApp } from './app.js'
import { konfigAusEnv } from './config.js'
import { oeffneDb } from './db.js'
import { NominatimGeocoder } from './pipeline/naming.js'
import { OpenMeteoQuelle } from './pipeline/weather.js'
import { FsStorage } from './storage.js'

const konfig = konfigAusEnv()
await mkdir(konfig.datenDir, { recursive: true })

const db = oeffneDb(join(konfig.datenDir, 'luhambo.db'))
const storage = new FsStorage(join(konfig.datenDir, 'tours'))
const geocoder = new NominatimGeocoder()
const wetter = new OpenMeteoQuelle()

const app = baueApp({ konfig, db, storage, geocoder, wetter })
await app.auth.seedeAdmin(konfig.adminEmail, konfig.adminPasswort)

await app.listen({ port: konfig.port, host: '0.0.0.0' })
app.log.info(`Luhambo-API läuft auf Port ${konfig.port}`)
