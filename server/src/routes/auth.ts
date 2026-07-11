// Auth-Routen: Login (Web-Session und/oder App-Token), Logout, Ich-Abfrage.
// Selbst-Registrierung kommt in M9 — der Seed-Benutzer entsteht beim Start.

import type { FastifyInstance } from 'fastify'
import { erfordereBenutzer, SESSION_COOKIE } from '../app.js'

interface LoginBody {
  email: string
  passwort: string
  /** Gesetzt (z. B. „Pixel 9"): zusätzlich ein API-Token für die App erzeugen */
  tokenLabel?: string
}

// Brute-Force-Bremse für den (teuren, unauthentifizierten) Login: pro Quelle
// max. N Versuche je Fenster, In-Memory. Bewusst simpel — M9 (offener Betrieb)
// bringt echtes Rate-Limiting/Lockout; hinter Caddy zählt die Proxy-Quelle,
// daher zusätzlich je E-Mail gebremst.
const FENSTER_MS = 60_000
const MAX_VERSUCHE = 10

function baueLoginBremse() {
  // Zustand PRO App-Instanz (Closure) — modul-global würden sich parallele
  // Instanzen (v. a. Tests) gegenseitig ausbremsen.
  const versuche = new Map<string, { n: number; reset: number }>()
  return (...schluessel: string[]): boolean => {
    const jetzt = Date.now()
    if (versuche.size > 10_000) versuche.clear() // Speicher-Backstop
    let gebremst = false
    for (const key of schluessel) {
      const e = versuche.get(key)
      if (!e || e.reset < jetzt) versuche.set(key, { n: 1, reset: jetzt + FENSTER_MS })
      else if (++e.n > MAX_VERSUCHE) gebremst = true
    }
    return gebremst
  }
}

export function registriereAuthRouten(app: FastifyInstance): void {
  const loginGebremst = baueLoginBremse()
  app.post<{ Body: LoginBody }>(
    '/api/auth/login',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['email', 'passwort'],
          properties: {
            email: { type: 'string', maxLength: 254 },
            passwort: { type: 'string', maxLength: 1024 },
            tokenLabel: { type: 'string', maxLength: 60 },
          },
        },
      },
    },
    async (request, reply) => {
      if (loginGebremst(`ip:${request.ip}`, `mail:${request.body.email.toLowerCase().trim()}`)) {
        return reply.code(429).send({ fehler: 'Zu viele Anmeldeversuche — bitte kurz warten' })
      }
      const benutzer = await app.auth.login(request.body.email, request.body.passwort)
      if (!benutzer) return reply.code(401).send({ fehler: 'E-Mail oder Passwort falsch' })

      const session = app.auth.erzeugeSession(benutzer.id)
      reply.setCookie(SESSION_COOKIE, session.id, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: app.deps.konfig.hinterTls,
        expires: session.ablauf,
      })

      const antwort: { benutzer: typeof benutzer; apiToken?: string } = { benutzer }
      if (request.body.tokenLabel) {
        antwort.apiToken = app.auth.erzeugeToken(benutzer.id, request.body.tokenLabel)
      }
      return antwort
    },
  )

  app.post('/api/auth/logout', async (request, reply) => {
    const sessionId = request.cookies[SESSION_COOKIE]
    if (sessionId) app.auth.beendeSession(sessionId)
    reply.clearCookie(SESSION_COOKIE, { path: '/' })
    return { ok: true }
  })

  app.get('/api/auth/me', async (request, reply) => {
    const benutzer = erfordereBenutzer(request, reply)
    if (!benutzer) return
    return { benutzer }
  })
}
