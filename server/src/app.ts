// App-Fabrik und DI-Wurzel: baut die Fastify-Instanz aus explizit übergebenen
// Abhängigkeiten (DB, Storage, Geocoder, Konfiguration). Produktion reicht die
// echten Implementierungen herein (index.ts), Tests die Fakes — die Routen
// kennen den Unterschied nicht.

import fastifyCookie from '@fastify/cookie'
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import { AuthDienst, type Benutzer } from './auth/auth.js'
import { EinladungsDienst } from './auth/einladungen.js'
import { WartelistenDienst } from './auth/warteliste.js'
import type { Konfig } from './config.js'
import type { Db } from './db.js'
import type { MailVersand } from './mail.js'
import { MailVorlagenDienst } from './mailvorlagen.js'
import { NewsletterDienst } from './newsletter.js'
import { RueckmeldungsDienst } from './rueckmeldungen.js'
import { PushDienst, type PushVersand } from './push.js'
import { registrierePushRouten } from './routes/push.js'
import type { Geocoder } from './pipeline/naming.js'
import type { SchienenQuelle } from './pipeline/schienen.js'
import type { BildWerkzeug } from './pipeline/bild.js'
import type { VideoWerkzeug } from './pipeline/video.js'
import type { BildKlassifikator } from './pipeline/vision.js'
import type { WetterQuelle } from './pipeline/weather.js'
import { registriereAdminRouten } from './routes/admin.js'
import { registriereAuthRouten } from './routes/auth.js'
import { registriereBibliotheksRouten } from './routes/bibliothek.js'
import { registriereGalerieRouten } from './routes/galerie.js'
import { registriereMediaRouten } from './routes/media.js'
import { registriereNewsletterRouten } from './routes/newsletter.js'
import { registriereRueckmeldungsRouten } from './routes/rueckmeldungen.js'
import { registriereExportRouten } from './routes/export.js'
import { registriereSeitenRouten } from './routes/seiten.js'
import { registriereTourRouten } from './routes/tours.js'
import { registriereWartelistenRouten } from './routes/warteliste.js'
import { registriereTrackerRouten } from './routes/tracker.js'
import { registriereTrackerWebhookRouten } from './routes/tracker-webhooks.js'
import { Registry } from './tracker/registry.js'
import { TrackerDienst } from './tracker/tracker.js'
import type { TrackerProvider } from './tracker/vertrag.js'
import { Protokoll, protokollZiel } from './protokoll.js'
import { ExportDienst } from './export.js'
import { SeitenQuelle } from './seiten.js'
import type { Storage } from './storage.js'
import { ZuGrossFehler } from './storage.js'

export const SESSION_COOKIE = 'maptale_session'
/** JS-lesbarer UX-Hinweis „Sitzung steht" — kein Geheimnis, parallel zur httpOnly-Session. */
export const SESSION_HINWEIS_COOKIE = 'maptale_dabei'

export interface AppAbhaengigkeiten {
  konfig: Konfig
  db: Db
  storage: Storage
  /**
   * Ablage für Benutzerdateien (bisher nur Avatare) — dieselbe Storage-Klasse
   * unter einem anderen Wurzelverzeichnis.
   *
   * Das Interface ist auf Touren zugeschnitten, aber tatsächlich ein
   * ID-benannter Ablagebereich: Pfadprüfung, atomares Schreiben, Größenlimit
   * und das Wegräumen eines ganzen Bereichs (`loescheTour`) passen unverändert.
   * Der erste Parameter jeder Methode ist hier die Benutzer-ID.
   */
  benutzerStorage: Storage
  geocoder: Geocoder
  /** Auto-Wetter-Quelle (M2); null = Feature aus, Player-Fallback greift */
  wetter: WetterQuelle | null
  /** Video-Aufbereitung (M4); null = keine Videos verarbeiten (Original ohne Poster) */
  videoWerkzeug: VideoWerkzeug | null
  /** Bild-Aufbereitung (Anzeige- und Kachel-Fassung); null = Originale ausliefern */
  bildWerkzeug: BildWerkzeug | null
  /** Bild-Klassifikator für die Wetter-Verfeinerung (M5); null = Feature aus */
  bildKlassifikator: BildKlassifikator | null
  /** OSM-Schienen für die Straßenbahn-Erkennung; null = Feature aus (bleibt bei Rad) */
  schienen: SchienenQuelle | null
  /** Mail-Versand (M9): Registrierungs-Bestätigung + Passwort-Reset */
  mail: MailVersand
  /**
   * Ablage der Datenexport-Archive (`daten/exporte/<auftrag>/`).
   *
   * Ein dritter Bereich neben Touren und Benutzerdateien, kein Unterordner:
   * Ein Archiv gehört zu keiner Tour, es hat eine eigene Lebensdauer (48 h),
   * und `loescheTour(auftragId)` räumt es in einem Zug weg.
   */
  archive: Storage
  /**
   * Quelle der gebauten HTML-Seiten für `/@handle` (s. seiten.ts).
   *
   * Optional, weil die Produktion sie nicht setzt — dort genügt der Standard,
   * der über `konfig.webUrl` an Nginx geht. Tests reichen eine Fassung mit
   * festem HTML herein und kommen ohne Netz aus.
   */
  seiten?: SeitenQuelle
  /**
   * Die Tracker-Anbieter (Polar, Wahoo, …) — injiziert wie `geocoder` und
   * `wetter`: Produktion reicht die echten Adapter herein, Tests einen
   * erfundenen mit festen Antworten. Ohne Eintrag gibt es keine Anbieter, und
   * die Routen antworten mit einer leeren Liste statt zu fehlen.
   */
  trackerProvider?: TrackerProvider[]
  /**
   * Push-Versand (FCM); null = Feature aus, nicht kaputt. Die App merkt das an
   * der Registrier-Route und bleibt bei ihrem periodischen Abruf — den es aus
   * genau diesem Grund weiter gibt. Erforderlich wie `wetter` und
   * `bildKlassifikator`: Ein „aus" soll man beim Verdrahten SEHEN.
   */
  push: PushVersand | null
}

// Fastify-Typen um unsere Dekorationen erweitern
declare module 'fastify' {
  interface FastifyInstance {
    deps: AppAbhaengigkeiten
    auth: AuthDienst
    einladungen: EinladungsDienst
    warteliste: WartelistenDienst
    /** Texte der System-Mails — Katalog im Code, Anpassungen in der DB. */
    mailvorlagen: MailVorlagenDienst
    /** Newsletter-Einwilligung: Zustand, Historie, Empfängerliste. */
    newsletter: NewsletterDienst
    /** Rückmeldungen aus der Alpha: Eingang, Status, Notizen. */
    rueckmeldungen: RueckmeldungsDienst
    /** Laufende Finalize-Verarbeitungen — Tests können gezielt darauf warten. */
    verarbeitungen: Map<string, Promise<void>>
    /** Die letzten Warnungen und Fehler für die Verwaltung (s. protokoll.ts). */
    protokoll: Protokoll
    /** Gebaute HTML-Seiten für die Routen, die der Server selbst beantwortet. */
    seiten: SeitenQuelle
    /** Datenexport: Auftragsverwaltung, Fristen, Aufräumen (Art. 20 DSGVO). */
    exporte: ExportDienst
    /** Cloud-Verknüpfungen zu Sport-Trackern: Tokens, Importe, Zuordnung. */
    tracker: TrackerDienst
    /** Welche Tracker-Anbieter es gibt und welche davon konfiguriert sind. */
    trackerRegistry: Registry
    /** Laufende Tracker-Importe — Tests warten gezielt darauf, statt zu pollen. */
    trackerLaeufe: Map<string, Promise<unknown>>
    /** Push-Geräte und der Versand dorthin; ohne Dienstkonto ein No-Op. */
    push: PushDienst
  }
  interface FastifyRequest {
    benutzer: Benutzer | null
    /**
     * Mit WELCHEM App-Token diese Anfrage kam (null bei Sitzungs-Cookie).
     *
     * Nur die Push-Registrierung liest das: Ihr Gerät soll mit genau diesem
     * Zugang stehen und fallen (s. `AuthDienst.anmeldungAusToken`).
     */
    appTokenId: string | null
  }
}

export function baueApp(deps: AppAbhaengigkeiten): FastifyInstance {
  // Mitschrift der Warnungen und Fehler für die Verwaltung. Sie hängt am
  // Logger-Ziel, nicht an einzelnen Aufrufstellen: Sonst gäbe es zwei Wege,
  // etwas zu melden, und der zweite bliebe irgendwann liegen. Im Test ist der
  // Logger aus — dort füllt sich der Puffer nicht von selbst.
  const protokoll = new Protokoll()
  const app = Fastify({
    logger: process.env.NODE_ENV !== 'test' && { level: 'info', stream: protokollZiel(protokoll) },
    // Manifeste langer Aufzeichnungen können mehrere MB JSON sein
    bodyLimit: 64 * 1024 * 1024,
    // Hinter Caddy (Prod): request.ip aus X-Forwarded-For nehmen, damit die
    // Rate-Limits (Login/Registrierung/Reset) pro CLIENT greifen — ohne das
    // wäre die Proxy-IP EIN globaler Eimer. Das api-Image ist nur über das
    // Compose-Netz (nur Caddy) erreichbar, der Header ist also vertrauenswürdig.
    trustProxy: true,
  })

  app.decorate('deps', deps)
  app.decorate('auth', new AuthDienst(deps.db))
  app.decorate('einladungen', new EinladungsDienst(deps.db))
  app.decorate('warteliste', new WartelistenDienst(deps.db))
  app.decorate('mailvorlagen', new MailVorlagenDienst(deps.db))
  app.decorate('newsletter', new NewsletterDienst(deps.db))
  app.decorate('rueckmeldungen', new RueckmeldungsDienst(deps.db))
  app.decorate('verarbeitungen', new Map())
  app.decorate('protokoll', protokoll)
  app.decorate('seiten', deps.seiten ?? new SeitenQuelle(deps.konfig))
  app.decorate('exporte', new ExportDienst(deps.db, deps.archive))
  app.decorate('tracker', new TrackerDienst(deps.db, deps.konfig.trackerSchluessel))
  app.decorate('trackerRegistry', new Registry(deps.trackerProvider ?? []))
  app.decorate('trackerLaeufe', new Map())
  app.decorate('push', new PushDienst(deps.db, deps.push))
  app.decorateRequest('benutzer', null)
  app.decorateRequest('appTokenId', null)

  app.register(fastifyCookie, { secret: deps.konfig.cookieSecret })

  // Binäre Uploads (Medien) kommen als roher Stream durch — kein Puffern im
  // Speicher. JSON behält den eingebauten Parser.
  app.addContentTypeParser('*', (_req, payload, done) => done(null, payload))

  // Benutzer auflösen: API-Token (App) vor Session-Cookie (Web/Studio)
  app.addHook('preHandler', async (request) => {
    const auth = request.headers.authorization
    if (auth?.startsWith('Bearer ')) {
      const anmeldung = app.auth.anmeldungAusToken(auth.slice('Bearer '.length).trim())
      request.benutzer = anmeldung?.benutzer ?? null
      request.appTokenId = anmeldung?.tokenId ?? null
      return
    }
    const sessionId = request.cookies[SESSION_COOKIE]
    if (sessionId) request.benutzer = app.auth.benutzerAusSession(sessionId)
  })

  app.setErrorHandler(
    (fehler: Error & { validation?: unknown; statusCode?: number }, _request, reply) => {
      if (fehler instanceof ZuGrossFehler) {
        return reply.code(413).send({ error: fehler.message })
      }
      if (fehler.validation) {
        return reply.code(400).send({ error: 'Ungültige Anfrage', details: fehler.message })
      }
      // Fastifys eigene Client-Fehler tragen ihren Code SELBST — zu großer Body
      // (413), kaputtes JSON (400), unbekannter Content-Type (415). Alles auf 500
      // zu werfen machte aus „du hast zu viel geschickt" ein „bei uns ist etwas
      // kaputt": Der Aufrufer sucht dann bei uns, und im Log steht eine Störung,
      // die keine ist. Nur die Serverfehler bleiben stumm und geloggt.
      const code = fehler.statusCode ?? 500
      if (code >= 400 && code < 500) return reply.code(code).send({ error: fehler.message })
      app.log.error(fehler)
      return reply.code(500).send({ error: 'Interner Fehler' })
    },
  )

  // Verwaiste Verarbeitungen aufräumen: 'processing' lebt nur im Prozess —
  // nach einem Crash/Neustart wäre die Tour sonst für immer blockiert
  // (finalize antwortet 409). Beim Start ehrlich als Fehler markieren;
  // ein erneutes finalize startet die Anreicherung sauber neu.
  deps.db
    .prepare(
      `UPDATE tours SET status = 'failed', error = 'Verarbeitung unterbrochen (Neustart)' WHERE status = 'processing'`,
    )
    .run()

  registriereAuthRouten(app)
  registriereAdminRouten(app)
  registriereTourRouten(app)
  registriereMediaRouten(app)
  registriereBibliotheksRouten(app)
  registriereGalerieRouten(app)
  registriereWartelistenRouten(app)
  registriereNewsletterRouten(app)
  registriereRueckmeldungsRouten(app)
  registriereSeitenRouten(app)
  registriereExportRouten(app)
  registriereTrackerRouten(app)
  registrierePushRouten(app)
  // Als eigener Plugin-Bereich registriert: Die Webhook-Routen brauchen den
  // ROHEN Body für die Signaturprüfung, und ein Content-Type-Parser gilt in
  // Fastify je Bereich — global gesetzt läge der rohe Body an jeder Route.
  app.register(registriereTrackerWebhookRouten)

  app.get('/api/health', async () => ({ ok: true }))

  return app
}

/** Gemeinsamer Guard: 401, wenn kein Benutzer aufgelöst wurde. */
export function erfordereBenutzer(request: FastifyRequest, reply: FastifyReply): Benutzer | null {
  if (!request.benutzer) {
    reply.code(401).send({ error: 'Nicht angemeldet' })
    return null
  }
  return request.benutzer
}

/**
 * Guard der Verwaltung: 401 ohne Anmeldung, 403 ohne Admin-Rolle.
 *
 * Die Unterscheidung ist Absicht: Ein 404 („die Route gibt es nicht") würde
 * nichts verbergen, denn die Verwaltungsseite liegt im ausgelieferten Build und
 * ist für jeden aufrufbar. Das 403 sagt dem Angemeldeten stattdessen klar, dass
 * er an der richtigen Stelle, aber nicht berechtigt ist.
 */
export function erfordereAdmin(request: FastifyRequest, reply: FastifyReply): Benutzer | null {
  const benutzer = erfordereBenutzer(request, reply)
  if (!benutzer) return null
  if (benutzer.role !== 'admin') {
    reply.code(403).send({ error: 'Nur für Administratoren' })
    return null
  }
  return benutzer
}
