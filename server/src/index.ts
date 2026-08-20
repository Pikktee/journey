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
import { trimSignature, videoCutSignature } from './pipeline/enrichment.js'
import type { EditOverlay } from './schema/edits.js'
import { fuehreStartMigrationAus } from './migrations/start.js'
import { rendereVeralteteNach } from './migrations/nachrender.js'
import { FsStorage } from './storage.js'

const konfig = configFromEnv()
await mkdir(konfig.datenDir, { recursive: true })

const db = openDb(join(konfig.datenDir, 'maptale.db'))
const storage = new FsStorage(join(konfig.datenDir, 'tours'))
// Benutzerdateien (Avatare) liegen getrennt von den Touren, mit der Benutzer-ID
// als Bereichsnamen — so räumt das Konto-Löschen sie mit einem Aufruf weg.
const benutzerStorage = new FsStorage(join(konfig.datenDir, 'benutzer'))
// Datenexport-Archive: eigener Bereich, eigene Lebensdauer (48 h, s. export.ts).
const archive = new FsStorage(join(konfig.datenDir, 'exporte'))
// Start-Migration auf Welle 1 (§4.3): die JSON-Dateien auf Platte in die neue
// Form ziehen, BEVOR die erste Anfrage sie liest. Sie hängt an ihrer eigenen
// Leiter (`daten/.schema`) und ist damit nach dem ersten Lauf ein Dateizugriff.
await fuehreStartMigrationAus({
  datenDir: konfig.datenDir,
  tourIds: async () =>
    (db.prepare('SELECT id FROM tours').all() as { id: string }[]).map((z) => z.id),
  signaturen: {
    trimSignature: (edits) => trimSignature(edits as EditOverlay | null),
    videoCutSignature: (edits) => videoCutSignature(edits as EditOverlay | null),
  },
  setzeBanner: (userId, wert) => {
    db.prepare('UPDATE users SET banner = ? WHERE id = ?').run(wert, userId)
  },
  protokoll: (nachricht) => console.log(nachricht),
})

const geocoder = new NominatimGeocoder()
const wetter = new OpenMeteoSource()
const videoWerkzeug = new FfmpegVideoTool()
const bildWerkzeug = new FfmpegImageTool()
const schienen = new OverpassRails()
// Bildanalyse (M5) nur mit Key — sonst null (No-Op, Wetter exakt wie M2).
const bildKlassifikator: ImageClassifier | null = konfig.openRouterKey
  ? new OpenRouterClassifier(konfig.openRouterKey, undefined, konfig.visionModell)
  : null
// Mit RESEND_API_KEY: echter Versand; ohne (Dev/kleine Instanz): Link ins Log.
const mail: MailTransport = process.env.RESEND_API_KEY
  ? new ResendMail(process.env.RESEND_API_KEY, konfig.mailAbsender)
  : new ConsoleMail()
// Tracker-Anbieter. Sie werden IMMER registriert, auch ohne Zugangsdaten:
// Die Registry meldet einen unkonfigurierten Anbieter als „nicht verfügbar",
// und die Kontoseite kann „Polar (noch nicht eingerichtet)" zeigen. Verschwiege
// man ihn ganz, wäre das keine Auskunft.
const trackerProvider = [new PolarProvider(konfig.polar)]
// Push nur mit Dienstkonto. Ohne bleibt es beim periodischen Abruf der App —
// derselbe Weg, der auch mit Push für Geräte ohne Play Services weiterläuft.
// Ein kaputtes Dienstkonto ist dagegen ein Einrichtungsfehler und soll laut
// sein: `FcmPush` wirft im Konstruktor mit einer Meldung, die sagt, was fehlt.
const push: PushTransport | null = konfig.fcmDienstkonto ? new FcmPush(konfig.fcmDienstkonto) : null

const app = buildApp({
  konfig,
  db,
  storage,
  benutzerStorage,
  archive,
  geocoder,
  wetter,
  videoWerkzeug,
  bildWerkzeug,
  bildKlassifikator,
  schienen,
  trackerProvider,
  push,
  mail,
})
await app.auth.seedeAdmin(konfig.adminEmail, konfig.adminPasswort)
// Boot-Garantie: Die konfigurierten Adressen sind Admin — auch wenn das Konto
// erst nach dem letzten Start entstanden ist. Damit sperrt sich niemand aus.
const gehoben = app.auth.hebeAdmins(konfig.adminEmails)
if (gehoben > 0) app.log.info(`${gehoben} Konto/Konten auf die Admin-Rolle gehoben`)

// Abgelaufene Wartelisten-Einträge löschen: einmal beim Start und danach
// täglich. `unref` hält den Prozess nicht wach — die Aufräumerei ist nichts,
// worauf ein Herunterfahren warten müsste.
// Dazu die überholten Newsletter-Protokollzeilen: Der Nachweis muss drei Jahre
// tragen, danach ist er Sammeln ohne Zweck (s. NewsletterService.raeumeAuf).
const raeumeWarteliste = (): void => {
  const weg = app.warteliste.raeumeAuf()
  if (weg > 0) app.log.info(`${weg} abgelaufene Wartelisten-Einträge gelöscht`)
  const alteEinwilligungen = app.newsletter.raeumeAuf()
  if (alteEinwilligungen > 0)
    app.log.info(`${alteEinwilligungen} alte Newsletter-Protokollzeilen gelöscht`)
  // Rückmeldungen verfallen ebenfalls: erledigte nach einem halben Jahr, offene
  // nach anderthalb. Ein Eingang, den niemand leert, wird sonst zur Sammlung.
  const alteRueckmeldungen = app.rueckmeldungen.raeumeAuf()
  if (alteRueckmeldungen > 0)
    app.log.info(`${alteRueckmeldungen} abgelaufene Rückmeldungen gelöscht`)
}
raeumeWarteliste()
setInterval(raeumeWarteliste, 24 * 60 * 60 * 1000).unref()

// Abgelaufene Export-Archive: STÜNDLICH, nicht täglich. Ein ZIP mit allen
// Fotos einer Person ist das Gegenteil von „nur so lange wie nötig" — bei
// einem täglichen Lauf läge es im ungünstigen Fall 72 statt 48 Stunden herum.
// Derselbe Lauf befreit Konten, deren Export beim letzten Neustart mittendrin
// abgebrochen ist (sonst blockierte er sie für immer).
const raeumeExporte = (): void => {
  void app.exporte
    .raeumeAuf()
    .then((weg) => {
      if (weg > 0) app.log.info(`${weg} abgelaufene Export-Archive gelöscht`)
    })
    .catch((fehler) => app.log.error({ fehler }, 'Aufräumen der Export-Archive fehlgeschlagen'))
}
raeumeExporte()
setInterval(raeumeExporte, 60 * 60 * 1000).unref()

await app.listen({ port: konfig.port, host: '0.0.0.0' })
app.log.info(`Maptale-API läuft auf Port ${konfig.port}`)

// Titelbilder der Bestandstouren nachtragen — nach dem listen, damit ein
// langsamer Durchlauf die Bereitschaft der API nicht verzögert.
void backfillCovers(db, storage, TOUR_JSON_PATH, (n) => app.log.warn(n))
  .then((anzahl) => {
    if (anzahl > 0) app.log.info(`Titelbild nachgetragen für ${anzahl} Tour(en)`)
  })
  .catch((fehler: unknown) => app.log.error(fehler, 'Titelbild-Nachtrag fehlgeschlagen'))
  // Danach, nicht daneben: Der Bild-Nachtrag liest das Titelbild aus der
  // Datenbank — läuft er zeitgleich, greift er bei Bestandstouren ins Leere.
  .then(() =>
    backfillImageVariants(db, storage, TOUR_JSON_PATH, bildWerkzeug, (n) => app.log.warn(n)),
  )
  .then(({ touren, gespart }) => {
    if (touren > 0) {
      app.log.info(
        `Bild-Fassungen nachgetragen für ${touren} Tour(en), ${(gespart / 1048576).toFixed(1)} MB frei`,
      )
    }
  })
  .catch((fehler: unknown) => app.log.error(fehler, 'Bild-Nachtrag fehlgeschlagen'))
  // Zuletzt das Nachrendern der Welle 1: Es ist der teuerste der drei Läufe
  // (voller Pipeline-Durchgang je Tour) und darf den beiden anderen nicht ins
  // Gehege kommen — der Bild-Nachtrag schreibt dieselben Dateien.
  .then(() => rendereVeralteteNach(app))
  .then((anzahl) => {
    if (anzahl > 0) app.log.info(`${anzahl} Tour(en) auf die neue Kennung nachgerendert`)
  })
  .catch((fehler: unknown) => app.log.error(fehler, 'Nachrendern fehlgeschlagen'))
