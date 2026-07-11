// App-Fabrik und DI-Wurzel: baut die Fastify-Instanz aus explizit übergebenen
// Abhängigkeiten (DB, Storage, Geocoder, Konfiguration). Produktion reicht die
// echten Implementierungen herein (index.ts), Tests die Fakes — die Routen
// kennen den Unterschied nicht.

import fastifyCookie from '@fastify/cookie'
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import { AuthDienst, type Benutzer } from './auth/auth.js'
import type { Konfig } from './config.js'
import type { Db } from './db.js'
import type { Geocoder } from './pipeline/naming.js'
import type { WetterQuelle } from './pipeline/weather.js'
import { registriereAuthRouten } from './routes/auth.js'
import { registriereMediaRouten } from './routes/media.js'
import { registriereTourRouten } from './routes/tours.js'
import type { Storage } from './storage.js'
import { ZuGrossFehler } from './storage.js'

export const SESSION_COOKIE = 'luhambo_session'

export interface AppAbhaengigkeiten {
  konfig: Konfig
  db: Db
  storage: Storage
  geocoder: Geocoder
  /** Auto-Wetter-Quelle (M2); null = Feature aus, Player-Fallback greift */
  wetter: WetterQuelle | null
}

// Fastify-Typen um unsere Dekorationen erweitern
declare module 'fastify' {
  interface FastifyInstance {
    deps: AppAbhaengigkeiten
    auth: AuthDienst
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
  })

  app.decorate('deps', deps)
  app.decorate('auth', new AuthDienst(deps.db))
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
  registriereTourRouten(app)
  registriereMediaRouten(app)

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
