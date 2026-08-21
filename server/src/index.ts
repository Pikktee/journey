// Einstiegspunkt: Konfiguration lesen, echte Abhängigkeiten aufbauen, starten.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { buildApp } from './app.js'
import { configFromEnv } from './config.js'
import { openDb } from './db.js'
import { FcmPush } from './fcm.js'
import { ConsoleMail, ResendMail, type MailTransport } from './mail.js'
import type { PushTransport } from './push.js'
import { backfillCovers } from './pipeline/cover.js'
import { FfmpegImageTool } from './pipeline/image.js'
import { backfillImageVariants } from './pipeline/image-addendum.js'
import { NominatimGeocoder } from './pipeline/naming.js'
import { OverpassRails } from './pipeline/rails.js'
import { PolarProvider } from './tracker/provider/polar.js'
import { FfmpegVideoTool } from './pipeline/video.js'
import { OpenRouterClassifier, type ImageClassifier } from './pipeline/vision.js'
import { OpenMeteoSource } from './pipeline/weather.js'
import { TOUR_JSON_PATH } from './routes/tours.js'
import { FsStorage } from './storage.js'

const config = configFromEnv()
await mkdir(config.dataDir, { recursive: true })

const db = openDb(join(config.dataDir, 'maptale.db'))
const storage = new FsStorage(join(config.dataDir, 'tours'))
// Benutzerdateien (Avatare) liegen getrennt von den Touren, mit der Benutzer-ID
// als Bereichsnamen — so räumt das Konto-Löschen sie mit einem Aufruf weg.
const userStorage = new FsStorage(join(config.dataDir, 'benutzer'))
// Datenexport-Archive: eigener Bereich, eigene Lebensdauer (48 h, s. export.ts).
const archive = new FsStorage(join(config.dataDir, 'exporte'))

const geocoder = new NominatimGeocoder()
const weather = new OpenMeteoSource()
const videoTool = new FfmpegVideoTool()
const imageTool = new FfmpegImageTool()
const rails = new OverpassRails()
// Bildanalyse (M5) nur mit Key — sonst null (No-Op, Wetter exakt wie M2).
const imageClassifier: ImageClassifier | null = config.openRouterKey
  ? new OpenRouterClassifier(config.openRouterKey, undefined, config.visionModel)
  : null
// Mit RESEND_API_KEY: echter Versand; ohne (Dev/kleine Instanz): Link ins Log.
const mail: MailTransport = process.env.RESEND_API_KEY
  ? new ResendMail(process.env.RESEND_API_KEY, config.mailFrom)
  : new ConsoleMail()
// Tracker-Anbieter. Sie werden IMMER registriert, auch ohne Zugangsdaten:
// Die Registry meldet einen unkonfigurierten Anbieter als „nicht verfügbar",
// und die Kontoseite kann „Polar (noch nicht eingerichtet)" zeigen. Verschwiege
// man ihn ganz, wäre das keine Auskunft.
const trackerProvider = [new PolarProvider(config.polar)]
// Push nur mit Dienstkonto. Ohne bleibt es beim periodischen Abruf der App —
// derselbe Weg, der auch mit Push für Geräte ohne Play Services weiterläuft.
// Ein kaputtes Dienstkonto ist dagegen ein Einrichtungsfehler und soll laut
// sein: `FcmPush` wirft im Konstruktor mit einer Meldung, die sagt, was fehlt.
const push: PushTransport | null = config.fcmServiceAccount
  ? new FcmPush(config.fcmServiceAccount)
  : null

const app = buildApp({
  config,
  db,
  storage,
  userStorage,
  archive,
  geocoder,
  weather,
  videoTool,
  imageTool,
  imageClassifier,
  rails,
  trackerProvider,
  push,
  mail,
})
await app.auth.seedAdmin(config.adminEmail, config.adminPassword)
// Boot-Garantie: Die konfigurierten Adressen sind Admin — auch wenn das Konto
// erst nach dem letzten Start entstanden ist. Damit sperrt sich niemand aus.
const promoted = app.auth.promoteAdmins(config.adminEmails)
if (promoted > 0) app.log.info(`${promoted} Konto/Konten auf die Admin-Rolle gehoben`)

// Abgelaufene Wartelisten-Einträge löschen: einmal beim Start und danach
// täglich. `unref` hält den Prozess nicht wach — die Aufräumerei ist nichts,
// worauf ein Herunterfahren warten müsste.
// Dazu die überholten Newsletter-Protokollzeilen: Der Nachweis muss drei Jahre
// tragen, danach ist er Sammeln ohne Zweck (s. NewsletterService.raeumeAuf).
const purgeWaitlist = (): void => {
  const removed = app.waitlist.purgeExpired()
  if (removed > 0) app.log.info(`${removed} abgelaufene Wartelisten-Einträge gelöscht`)
  const oldConsents = app.newsletter.purgeOld()
  if (oldConsents > 0) app.log.info(`${oldConsents} alte Newsletter-Protokollzeilen gelöscht`)
  // Rückmeldungen verfallen ebenfalls: erledigte nach einem halben Jahr, offene
  // nach anderthalb. Ein Eingang, den niemand leert, wird sonst zur Sammlung.
  const oldFeedback = app.feedback.purgeExpired()
  if (oldFeedback > 0) app.log.info(`${oldFeedback} abgelaufene Rückmeldungen gelöscht`)
}
purgeWaitlist()
setInterval(purgeWaitlist, 24 * 60 * 60 * 1000).unref()

// Abgelaufene Export-Archive: STÜNDLICH, nicht täglich. Ein ZIP mit allen
// Fotos einer Person ist das Gegenteil von „nur so lange wie nötig" — bei
// einem täglichen Lauf läge es im ungünstigen Fall 72 statt 48 Stunden herum.
// Derselbe Lauf befreit Konten, deren Export beim letzten Neustart mittendrin
// abgebrochen ist (sonst blockierte er sie für immer).
const purgeExports = (): void => {
  void app.dataExport
    .purgeExpired()
    .then((removed) => {
      if (removed > 0) app.log.info(`${removed} abgelaufene Export-Archive gelöscht`)
    })
    .catch((error) => app.log.error({ error }, 'Aufräumen der Export-Archive fehlgeschlagen'))
}
purgeExports()
setInterval(purgeExports, 60 * 60 * 1000).unref()

await app.listen({ port: config.port, host: '0.0.0.0' })
app.log.info(`Maptale-API läuft auf Port ${config.port}`)

// Titelbilder der Bestandstouren nachtragen — nach dem listen, damit ein
// langsamer Durchlauf die Bereitschaft der API nicht verzögert.
void backfillCovers(db, storage, TOUR_JSON_PATH, (n) => app.log.warn(n))
  .then((count) => {
    if (count > 0) app.log.info(`Titelbild nachgetragen für ${count} Tour(en)`)
  })
  .catch((error: unknown) => app.log.error(error, 'Titelbild-Nachtrag fehlgeschlagen'))
  // Danach, nicht daneben: Der Bild-Nachtrag liest das Titelbild aus der
  // Datenbank — läuft er zeitgleich, greift er bei Bestandstouren ins Leere.
  .then(() => backfillImageVariants(db, storage, TOUR_JSON_PATH, imageTool, (n) => app.log.warn(n)))
  .then(({ tours, saved }) => {
    if (tours > 0) {
      app.log.info(
        `Bild-Fassungen nachgetragen für ${tours} Tour(en), ${(saved / 1048576).toFixed(1)} MB frei`,
      )
    }
  })
  .catch((error: unknown) => app.log.error(error, 'Bild-Nachtrag fehlgeschlagen'))
