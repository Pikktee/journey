// App-Fabrik und DI-Wurzel: baut die Fastify-Instanz aus explizit übergebenen
// Abhängigkeiten (DB, Storage, Geocoder, Konfiguration). Produktion reicht die
// echten Implementierungen herein (index.ts), Tests die Fakes — die Routen
// kennen den Unterschied nicht.

import fastifyCookie from '@fastify/cookie'
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import { AuthService, type User } from './auth/auth.js'
import { InvitationService } from './auth/invitations.js'
import { WaitlistService } from './auth/waitlist.js'
import type { Config } from './config.js'
import type { Db } from './db.js'
import type { MailTransport } from './mail.js'
import { MailTemplateService } from './mail-templates.js'
import { NewsletterService } from './newsletter.js'
import { FeedbackService } from './feedback.js'
import { PushService, type PushTransport } from './push.js'
import { registerPushRoutes } from './routes/push.js'
import type { Geocoder } from './pipeline/naming.js'
import type { RailSource } from './pipeline/rails.js'
import type { ImageTool } from './pipeline/image.js'
import type { VideoTool } from './pipeline/video.js'
import type { ImageClassifier } from './pipeline/vision.js'
import type { WeatherSource } from './pipeline/weather.js'
import { registerAdminRoutes } from './routes/admin.js'
import { registerAuthRoutes } from './routes/auth.js'
import { registerAudioLibraryRoutes } from './routes/audio-library.js'
import { registerGalleryRoutes } from './routes/gallery.js'
import { registerMediaRoutes } from './routes/media.js'
import { registerNewsletterRoutes } from './routes/newsletter.js'
import { registerFeedbackRoutes } from './routes/feedback.js'
import { registerDataExportRoutes } from './routes/export.js'
import { registerPageRoutes } from './routes/pages.js'
import { registerTourRoutes } from './routes/tours.js'
import { registerWaitlistRoutes } from './routes/waitlist.js'
import { registerTrackerRoutes } from './routes/tracker.js'
import { registerTrackerWebhookRoutes } from './routes/tracker-webhooks.js'
import { Registry } from './tracker/registry.js'
import { TrackerService } from './tracker/tracker.js'
import type { TrackerProvider } from './tracker/contract.js'
import { AuditLog, auditLogTarget } from './audit-log.js'
import { DataExportService } from './data-export.js'
import { PageSource } from './page-meta.js'
import type { Storage } from './storage.js'
import { TooLargeError } from './storage.js'

export const SESSION_COOKIE = 'maptale_session'
/** JS-lesbarer UX-Hinweis „Sitzung steht" — kein Geheimnis, parallel zur httpOnly-Session. */
export const SESSION_NOTICE_COOKIE = 'maptale_returning'

export interface AppDependencies {
  config: Config
  db: Db
  storage: Storage
  /**
   * Ablage für Benutzerdateien (bisher nur Avatare) — dieselbe Storage-Klasse
   * unter einem anderen Wurzelverzeichnis.
   *
   * Das Interface ist auf Touren zugeschnitten, aber tatsächlich ein
   * ID-benannter Ablagebereich: Pfadprüfung, atomares Schreiben, Größenlimit
   * und das Wegräumen eines ganzen Bereichs (`removeTour`) passen unverändert.
   * Der erste Parameter jeder Methode ist hier die Benutzer-ID.
   */
  userStorage: Storage
  geocoder: Geocoder
  /** Auto-Wetter-Quelle (M2); null = Feature aus, Player-Fallback greift */
  weather: WeatherSource | null
  /** Video-Aufbereitung (M4); null = keine Videos verarbeiten (Original ohne Poster) */
  videoTool: VideoTool | null
  /** Bild-Aufbereitung (Anzeige- und Kachel-Fassung); null = Originale ausliefern */
  imageTool: ImageTool | null
  /** Bild-Klassifikator für die Wetter-Verfeinerung (M5); null = Feature aus */
  imageClassifier: ImageClassifier | null
  /** OSM-Schienen für die Straßenbahn-Erkennung; null = Feature aus (bleibt bei Rad) */
  rails: RailSource | null
  /** Mail-Versand (M9): Registrierungs-Bestätigung + Passwort-Reset */
  mail: MailTransport
  /**
   * Ablage der Datenexport-Archive (`daten/exporte/<auftrag>/`).
   *
   * Ein dritter Bereich neben Touren und Benutzerdateien, kein Unterordner:
   * Ein Archiv gehört zu keiner Tour, es hat eine eigene Lebensdauer (48 h),
   * und `removeTour(exportId)` räumt es in einem Zug weg.
   */
  archive: Storage
  /**
   * Quelle der gebauten HTML-Seiten für `/@handle` (s. page-meta.ts).
   *
   * Optional, weil die Produktion sie nicht setzt — dort genügt der Standard,
   * der über `config.webUrl` an Nginx geht. Tests reichen eine Fassung mit
   * festem HTML herein und kommen ohne Netz aus.
   */
  pages?: PageSource
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
  push: PushTransport | null
}

// Fastify-Typen um unsere Dekorationen erweitern
declare module 'fastify' {
  interface FastifyInstance {
    deps: AppDependencies
    auth: AuthService
    invitations: InvitationService
    waitlist: WaitlistService
    /** Texte der System-Mails — Katalog im Code, Anpassungen in der DB. */
    mailTemplates: MailTemplateService
    /** Newsletter-Einwilligung: Zustand, Historie, Empfängerliste. */
    newsletter: NewsletterService
    /** Rückmeldungen aus der Alpha: Eingang, Status, Notizen. */
    feedback: FeedbackService
    /** Laufende Finalize-Verarbeitungen — Tests können gezielt darauf warten. */
    processing: Map<string, Promise<void>>
    /** Die letzten Warnungen und Fehler für die Verwaltung (s. audit-log.ts). */
    auditLog: AuditLog
    /** Gebaute HTML-Seiten für die Routen, die der Server selbst beantwortet. */
    pages: PageSource
    /** Datenexport: Auftragsverwaltung, Fristen, Aufräumen (Art. 20 DSGVO). */
    dataExport: DataExportService
    /** Cloud-Verknüpfungen zu Sport-Trackern: Tokens, Importe, Zuordnung. */
    tracker: TrackerService
    /** Welche Tracker-Anbieter es gibt und welche davon konfiguriert sind. */
    trackerRegistry: Registry
    /** Laufende Tracker-Importe — Tests warten gezielt darauf, statt zu pollen. */
    trackerRuns: Map<string, Promise<unknown>>
    /** Push-Geräte und der Versand dorthin; ohne Dienstkonto ein No-Op. */
    push: PushService
  }
  interface FastifyRequest {
    user: User | null
    /**
     * Mit WELCHEM App-Token diese Anfrage kam (null bei Sitzungs-Cookie).
     *
     * Nur die Push-Registrierung liest das: Ihr Gerät soll mit genau diesem
     * Zugang stehen und fallen (s. `AuthService.resolveToken`).
     */
    appTokenId: string | null
  }
}

export function buildApp(deps: AppDependencies): FastifyInstance {
  // Mitschrift der Warnungen und Fehler für die Verwaltung. Sie hängt am
  // Logger-Ziel, nicht an einzelnen Aufrufstellen: Sonst gäbe es zwei Wege,
  // etwas zu melden, und der zweite bliebe irgendwann liegen. Im Test ist der
  // Logger aus — dort füllt sich der Puffer nicht von selbst.
  const auditLog = new AuditLog()
  const app = Fastify({
    logger: process.env.NODE_ENV !== 'test' && { level: 'info', stream: auditLogTarget(auditLog) },
    // Manifeste langer Aufzeichnungen können mehrere MB JSON sein
    bodyLimit: 64 * 1024 * 1024,
    // Hinter Caddy (Prod): request.ip aus X-Forwarded-For nehmen, damit die
    // Rate-Limits (Login/Registrierung/Reset) pro CLIENT greifen — ohne das
    // wäre die Proxy-IP EIN globaler Eimer. Das api-Image ist nur über das
    // Compose-Netz (nur Caddy) erreichbar, der Header ist also vertrauenswürdig.
    trustProxy: true,
  })

  app.decorate('deps', deps)
  app.decorate('auth', new AuthService(deps.db))
  app.decorate('invitations', new InvitationService(deps.db))
  app.decorate('waitlist', new WaitlistService(deps.db))
  app.decorate('mailTemplates', new MailTemplateService(deps.db))
  app.decorate('newsletter', new NewsletterService(deps.db))
  app.decorate('feedback', new FeedbackService(deps.db))
  app.decorate('processing', new Map())
  app.decorate('auditLog', auditLog)
  app.decorate('pages', deps.pages ?? new PageSource(deps.config))
  app.decorate('dataExport', new DataExportService(deps.db, deps.archive))
  app.decorate('tracker', new TrackerService(deps.db, deps.config.trackerSecret))
  app.decorate('trackerRegistry', new Registry(deps.trackerProvider ?? []))
  app.decorate('trackerRuns', new Map())
  app.decorate('push', new PushService(deps.db, deps.push))
  app.decorateRequest('user', null)
  app.decorateRequest('appTokenId', null)

  app.register(fastifyCookie, { secret: deps.config.cookieSecret })

  // Binäre Uploads (Medien) kommen als roher Stream durch — kein Puffern im
  // Speicher. JSON behält den eingebauten Parser.
  app.addContentTypeParser('*', (_req, payload, done) => done(null, payload))

  // Benutzer auflösen: API-Token (App) vor Session-Cookie (Web/Studio)
  app.addHook('preHandler', async (request) => {
    const auth = request.headers.authorization
    if (auth?.startsWith('Bearer ')) {
      const resolved = app.auth.resolveToken(auth.slice('Bearer '.length).trim())
      request.user = resolved?.user ?? null
      request.appTokenId = resolved?.tokenId ?? null
      return
    }
    const sessionId = request.cookies[SESSION_COOKIE]
    if (sessionId) request.user = app.auth.userFromSession(sessionId)
  })

  app.setErrorHandler(
    (error: Error & { validation?: unknown; statusCode?: number }, _request, reply) => {
      if (error instanceof TooLargeError) {
        return reply.code(413).send({ error: error.message })
      }
      if (error.validation) {
        return reply.code(400).send({ error: 'Ungültige Anfrage', details: error.message })
      }
      // Fastifys eigene Client-Fehler tragen ihren Code SELBST — zu großer Body
      // (413), kaputtes JSON (400), unbekannter Content-Type (415). Alles auf 500
      // zu werfen machte aus „du hast zu viel geschickt" ein „bei uns ist etwas
      // kaputt": Der Aufrufer sucht dann bei uns, und im Log steht eine Störung,
      // die keine ist. Nur die Serverfehler bleiben stumm und geloggt.
      const code = error.statusCode ?? 500
      if (code >= 400 && code < 500) return reply.code(code).send({ error: error.message })
      app.log.error(error)
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

  registerAuthRoutes(app)
  registerAdminRoutes(app)
  registerTourRoutes(app)
  registerMediaRoutes(app)
  registerAudioLibraryRoutes(app)
  registerGalleryRoutes(app)
  registerWaitlistRoutes(app)
  registerNewsletterRoutes(app)
  registerFeedbackRoutes(app)
  registerPageRoutes(app)
  registerDataExportRoutes(app)
  registerTrackerRoutes(app)
  registerPushRoutes(app)
  // Als eigener Plugin-Bereich registriert: Die Webhook-Routen brauchen den
  // ROHEN Body für die Signaturprüfung, und ein Content-Type-Parser gilt in
  // Fastify je Bereich — global gesetzt läge der rohe Body an jeder Route.
  app.register(registerTrackerWebhookRoutes)

  app.get('/api/health', async () => ({ ok: true }))

  return app
}

/** Gemeinsamer Guard: 401, wenn kein Benutzer aufgelöst wurde. */
export function requireUser(request: FastifyRequest, reply: FastifyReply): User | null {
  if (!request.user) {
    reply.code(401).send({ error: 'Nicht angemeldet' })
    return null
  }
  return request.user
}

/**
 * Guard der Verwaltung: 401 ohne Anmeldung, 403 ohne Admin-Rolle.
 *
 * Die Unterscheidung ist Absicht: Ein 404 („die Route gibt es nicht") würde
 * nichts verbergen, denn die Verwaltungsseite liegt im ausgelieferten Build und
 * ist für jeden aufrufbar. Das 403 sagt dem Angemeldeten stattdessen klar, dass
 * er an der richtigen Stelle, aber nicht berechtigt ist.
 */
export function requireAdmin(request: FastifyRequest, reply: FastifyReply): User | null {
  const user = requireUser(request, reply)
  if (!user) return null
  if (user.role !== 'admin') {
    reply.code(403).send({ error: 'Nur für Administratoren' })
    return null
  }
  return user
}
