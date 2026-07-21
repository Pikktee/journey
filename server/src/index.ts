// Einstiegspunkt: Konfiguration lesen, echte Abhängigkeiten aufbauen, starten.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { baueApp } from './app.js'
import { konfigAusEnv } from './config.js'
import { oeffneDb } from './db.js'
import { KonsoleMail, ResendMail, type MailVersand } from './mail.js'
import { trageTitelbilderNach } from './pipeline/cover.js'
import { NominatimGeocoder } from './pipeline/naming.js'
import { FfmpegWerkzeug } from './pipeline/video.js'
import { OpenRouterKlassifikator, type BildKlassifikator } from './pipeline/vision.js'
import { OpenMeteoQuelle } from './pipeline/weather.js'
import { TOURJSON_PFAD } from './routes/tours.js'
import { FsStorage } from './storage.js'

const konfig = konfigAusEnv()
await mkdir(konfig.datenDir, { recursive: true })

const db = oeffneDb(join(konfig.datenDir, 'luhambo.db'))
const storage = new FsStorage(join(konfig.datenDir, 'tours'))
// Benutzerdateien (Avatare) liegen getrennt von den Touren, mit der Benutzer-ID
// als Bereichsnamen — so räumt das Konto-Löschen sie mit einem Aufruf weg.
const benutzerStorage = new FsStorage(join(konfig.datenDir, 'benutzer'))
const geocoder = new NominatimGeocoder()
const wetter = new OpenMeteoQuelle()
const videoWerkzeug = new FfmpegWerkzeug()
// Bildanalyse (M5) nur mit Key — sonst null (No-Op, Wetter exakt wie M2).
const bildKlassifikator: BildKlassifikator | null = konfig.openRouterKey
  ? new OpenRouterKlassifikator(konfig.openRouterKey, undefined, konfig.visionModell)
  : null
// Mit RESEND_API_KEY: echter Versand; ohne (Dev/kleine Instanz): Link ins Log.
const mail: MailVersand = process.env.RESEND_API_KEY
  ? new ResendMail(process.env.RESEND_API_KEY, konfig.mailAbsender)
  : new KonsoleMail()

const app = baueApp({
  konfig,
  db,
  storage,
  benutzerStorage,
  geocoder,
  wetter,
  videoWerkzeug,
  bildKlassifikator,
  mail,
})
await app.auth.seedeAdmin(konfig.adminEmail, konfig.adminPasswort)

await app.listen({ port: konfig.port, host: '0.0.0.0' })
app.log.info(`Luhambo-API läuft auf Port ${konfig.port}`)

// Titelbilder der Bestandstouren nachtragen — nach dem listen, damit ein
// langsamer Durchlauf die Bereitschaft der API nicht verzögert.
void trageTitelbilderNach(db, storage, TOURJSON_PFAD, (n) => app.log.warn(n))
  .then((anzahl) => {
    if (anzahl > 0) app.log.info(`Titelbild nachgetragen für ${anzahl} Tour(en)`)
  })
  .catch((fehler: unknown) => app.log.error(fehler, 'Titelbild-Nachtrag fehlgeschlagen'))
