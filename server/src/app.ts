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
import { registriereTourRouten } from './routes/tours.js'
import { registriereWartelistenRouten } from './routes/warteliste.js'
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
    /** Laufende Finalize-Verarbeitungen — Tests können gezielt darauf warten. */
    verarbeitungen: Map<string, Promise<void>>
  }
  interface FastifyRequest {
    benutzer: Benutzer | null
  }
}

export function baueApp(deps: AppAbhaengigkeiten): FastifyInstance {
  const app = Fastify({
    logger: process.env.NODE_ENV !== 'test' && { level: 'info' },
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
  app.decorate('verarbeitungen', new Map())
  app.decorateRequest('benutzer', null)

  app.register(fastifyCookie, { secret: deps.konfig.cookieSecret })

  // Binäre Uploads (Medien) kommen als roher Stream durch — kein Puffern im
  // Speicher. JSON behält den eingebauten Parser.
  app.addContentTypeParser('*', (_req, payload, done) => done(null, payload))

  // Benutzer auflösen: API-Token (App) vor Session-Cookie (Web/Studio)
  app.addHook('preHandler', async (request) => {
    const auth = request.headers.authorization
    if (auth?.startsWith('Bearer ')) {
      request.benutzer = app.auth.benutzerAusToken(auth.slice('Bearer '.length).trim())
      return
    }
    const sessionId = request.cookies[SESSION_COOKIE]
    if (sessionId) request.benutzer = app.auth.benutzerAusSession(sessionId)
  })

  app.setErrorHandler((fehler: Error & { validation?: unknown }, _request, reply) => {
    if (fehler instanceof ZuGrossFehler) {
      return reply.code(413).send({ fehler: fehler.message })
    }
    if (fehler.validation) {
      return reply.code(400).send({ fehler: 'Ungültige Anfrage', details: fehler.message })
    }
    app.log.error(fehler)
    return reply.code(500).send({ fehler: 'Interner Fehler' })
  })

  // Verwaiste Verarbeitungen aufräumen: 'verarbeitung' lebt nur im Prozess —
  // nach einem Crash/Neustart wäre die Tour sonst für immer blockiert
  // (finalize antwortet 409). Beim Start ehrlich als Fehler markieren;
  // ein erneutes finalize startet die Anreicherung sauber neu.
  deps.db
    .prepare(`UPDATE tours SET status = 'fehler', fehler = 'Verarbeitung unterbrochen (Neustart)' WHERE status = 'verarbeitung'`)
    .run()

  registriereAuthRouten(app)
  registriereAdminRouten(app)
  registriereTourRouten(app)
  registriereMediaRouten(app)
  registriereBibliotheksRouten(app)
  registriereGalerieRouten(app)
  registriereWartelistenRouten(app)

  app.get('/api/gesundheit', async () => ({ ok: true }))

  return app
}

/** Gemeinsamer Guard: 401, wenn kein Benutzer aufgelöst wurde. */
export function erfordereBenutzer(request: FastifyRequest, reply: FastifyReply): Benutzer | null {
  if (!request.benutzer) {
    reply.code(401).send({ fehler: 'Nicht angemeldet' })
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
  if (benutzer.rolle !== 'admin') {
    reply.code(403).send({ fehler: 'Nur für Administratoren' })
    return null
  }
  return benutzer
}
