// Einstiegspunkt: Konfiguration lesen, echte Abhängigkeiten aufbauen, starten.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { baueApp } from './app.js'
import { konfigAusEnv } from './config.js'
import { oeffneDb } from './db.js'
import { FcmPush } from './fcm.js'
import { KonsoleMail, ResendMail, type MailVersand } from './mail.js'
import type { PushVersand } from './push.js'
import { trageTitelbilderNach } from './pipeline/cover.js'
import { FfmpegBildWerkzeug } from './pipeline/bild.js'
import { trageBildfassungenNach } from './pipeline/bildnachtrag.js'
import { NominatimGeocoder } from './pipeline/naming.js'
import { OverpassSchienen } from './pipeline/schienen.js'
import { PolarProvider } from './tracker/provider/polar.js'
import { FfmpegWerkzeug } from './pipeline/video.js'
import { OpenRouterKlassifikator, type BildKlassifikator } from './pipeline/vision.js'
import { OpenMeteoQuelle } from './pipeline/weather.js'
import { TOURJSON_PFAD } from './routes/tours.js'
import { FsStorage } from './storage.js'

const konfig = konfigAusEnv()
await mkdir(konfig.datenDir, { recursive: true })

const db = oeffneDb(join(konfig.datenDir, 'maptale.db'))
const storage = new FsStorage(join(konfig.datenDir, 'tours'))
// Benutzerdateien (Avatare) liegen getrennt von den Touren, mit der Benutzer-ID
// als Bereichsnamen — so räumt das Konto-Löschen sie mit einem Aufruf weg.
const benutzerStorage = new FsStorage(join(konfig.datenDir, 'benutzer'))
// Datenexport-Archive: eigener Bereich, eigene Lebensdauer (48 h, s. export.ts).
const archive = new FsStorage(join(konfig.datenDir, 'exporte'))
const geocoder = new NominatimGeocoder()
const wetter = new OpenMeteoQuelle()
const videoWerkzeug = new FfmpegWerkzeug()
const bildWerkzeug = new FfmpegBildWerkzeug()
const schienen = new OverpassSchienen()
// Bildanalyse (M5) nur mit Key — sonst null (No-Op, Wetter exakt wie M2).
const bildKlassifikator: BildKlassifikator | null = konfig.openRouterKey
  ? new OpenRouterKlassifikator(konfig.openRouterKey, undefined, konfig.visionModell)
  : null
// Mit RESEND_API_KEY: echter Versand; ohne (Dev/kleine Instanz): Link ins Log.
const mail: MailVersand = process.env.RESEND_API_KEY
  ? new ResendMail(process.env.RESEND_API_KEY, konfig.mailAbsender)
  : new KonsoleMail()
// Tracker-Anbieter. Sie werden IMMER registriert, auch ohne Zugangsdaten:
// Die Registry meldet einen unkonfigurierten Anbieter als „nicht verfügbar",
// und die Kontoseite kann „Polar (noch nicht eingerichtet)" zeigen. Verschwiege
// man ihn ganz, wäre das keine Auskunft.
const trackerProvider = [new PolarProvider(konfig.polar)]
// Push nur mit Dienstkonto. Ohne bleibt es beim periodischen Abruf der App —
// derselbe Weg, der auch mit Push für Geräte ohne Play Services weiterläuft.
// Ein kaputtes Dienstkonto ist dagegen ein Einrichtungsfehler und soll laut
// sein: `FcmPush` wirft im Konstruktor mit einer Meldung, die sagt, was fehlt.
const push: PushVersand | null = konfig.fcmDienstkonto ? new FcmPush(konfig.fcmDienstkonto) : null

const app = baueApp({
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
// tragen, danach ist er Sammeln ohne Zweck (s. NewsletterDienst.raeumeAuf).
const raeumeWarteliste = (): void => {
  const weg = app.warteliste.raeumeAuf()
  if (weg > 0) app.log.info(`${weg} abgelaufene Wartelisten-Einträge gelöscht`)
  const alteEinwilligungen = app.newsletter.raeumeAuf()
  if (alteEinwilligungen > 0) app.log.info(`${alteEinwilligungen} alte Newsletter-Protokollzeilen gelöscht`)
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
void trageTitelbilderNach(db, storage, TOURJSON_PFAD, (n) => app.log.warn(n))
  .then((anzahl) => {
    if (anzahl > 0) app.log.info(`Titelbild nachgetragen für ${anzahl} Tour(en)`)
  })
  .catch((fehler: unknown) => app.log.error(fehler, 'Titelbild-Nachtrag fehlgeschlagen'))
  // Danach, nicht daneben: Der Bild-Nachtrag liest das Titelbild aus der
  // Datenbank — läuft er zeitgleich, greift er bei Bestandstouren ins Leere.
  .then(() => trageBildfassungenNach(db, storage, TOURJSON_PFAD, bildWerkzeug, (n) => app.log.warn(n)))
  .then(({ touren, gespart }) => {
    if (touren > 0) {
      app.log.info(`Bild-Fassungen nachgetragen für ${touren} Tour(en), ${(gespart / 1048576).toFixed(1)} MB frei`)
    }
  })
  .catch((fehler: unknown) => app.log.error(fehler, 'Bild-Nachtrag fehlgeschlagen'))
