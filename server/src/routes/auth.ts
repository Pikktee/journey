// Auth-Routen: Login (Web-Session und/oder App-Token), Logout, Ich-Abfrage
// sowie der M9-Betriebsteil — Selbst-Registrierung mit E-Mail-Bestätigung,
// Passwort-Reset und Konto-Löschung. Alle unauthentifizierten, teuren oder
// mail-auslösenden Endpunkte sind pro Quelle/Adresse gebremst.

import type { FastifyInstance } from 'fastify'
import { erfordereBenutzer, SESSION_COOKIE } from '../app.js'
import { baueResetMail, baueVerifikationsMail } from '../mail.js'
import { quotaStand } from '../quota.js'

interface LoginBody {
  email: string
  passwort: string
  /** Gesetzt (z. B. „Pixel 9"): zusätzlich ein API-Token für die App erzeugen */
  tokenLabel?: string
}

// Einfache In-Memory-Bremse pro Schlüssel (IP und/oder E-Mail): max. N Ereignisse
// je Fenster. Bewusst schlank — hinter Caddy zählt die Proxy-Quelle, daher
// zusätzlich je Adresse bremsen. Zustand PRO App-Instanz (Closure), damit
// parallele Instanzen (v. a. Tests) sich nicht gegenseitig blockieren.
function baueBremse(maxVersuche: number, fensterMs = 60_000) {
  const versuche = new Map<string, { n: number; reset: number }>()
  return (...schluessel: string[]): boolean => {
    const jetzt = Date.now()
    if (versuche.size > 10_000) versuche.clear() // Speicher-Backstop
    let gebremst = false
    for (const key of schluessel) {
      const e = versuche.get(key)
      if (!e || e.reset < jetzt) versuche.set(key, { n: 1, reset: jetzt + fensterMs })
      else if (++e.n > maxVersuche) gebremst = true
    }
    return gebremst
  }
}

const emailSchema = { type: 'string', maxLength: 254 } as const
const passwortSchema = { type: 'string', minLength: 8, maxLength: 1024 } as const

export function registriereAuthRouten(app: FastifyInstance): void {
  const { konfig, mail, storage, db } = app.deps
  const loginGebremst = baueBremse(10)
  const registrierGebremst = baueBremse(5, 10 * 60_000) // 5 pro 10 min je IP
  const resetGebremst = baueBremse(5, 10 * 60_000)

  const setzeSessionCookie = (reply: import('fastify').FastifyReply, userId: string): void => {
    const session = app.auth.erzeugeSession(userId)
    reply.setCookie(SESSION_COOKIE, session.id, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: konfig.hinterTls,
      expires: session.ablauf,
    })
  }

  // — Login —
  app.post<{ Body: LoginBody }>(
    '/api/auth/login',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['email', 'passwort'],
          properties: { email: emailSchema, passwort: { type: 'string', maxLength: 1024 }, tokenLabel: { type: 'string', maxLength: 60 } },
        },
      },
    },
    async (request, reply) => {
      if (loginGebremst(`ip:${request.ip}`, `mail:${request.body.email.toLowerCase().trim()}`)) {
        return reply.code(429).send({ fehler: 'Zu viele Anmeldeversuche — bitte kurz warten' })
      }
      const benutzer = await app.auth.login(request.body.email, request.body.passwort)
      if (!benutzer) return reply.code(401).send({ fehler: 'E-Mail oder Passwort falsch' })

      setzeSessionCookie(reply, benutzer.id)
      const antwort: { benutzer: typeof benutzer; apiToken?: string } = { benutzer }
      if (request.body.tokenLabel) antwort.apiToken = app.auth.erzeugeToken(benutzer.id, request.body.tokenLabel)
      return antwort
    },
  )

  // — Selbst-Registrierung (M9) — legt einen UNbestätigten Benutzer an und
  // verschickt den Bestätigungslink. Anmelden geht sofort, Hochladen erst nach
  // Bestätigung (Gate in POST /api/tours).
  app.post<{ Body: { email: string; passwort: string; name: string } }>(
    '/api/auth/register',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['email', 'passwort', 'name'],
          properties: { email: emailSchema, passwort: passwortSchema, name: { type: 'string', minLength: 1, maxLength: 80 } },
        },
      },
    },
    async (request, reply) => {
      if (!konfig.registrierungOffen) return reply.code(403).send({ fehler: 'Registrierung ist geschlossen' })
      if (registrierGebremst(`ip:${request.ip}`)) {
        return reply.code(429).send({ fehler: 'Zu viele Registrierungen — bitte später erneut versuchen' })
      }
      const email = request.body.email.toLowerCase().trim()
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return reply.code(400).send({ fehler: 'Ungültige E-Mail-Adresse' })
      if (app.auth.emailVergeben(email)) return reply.code(409).send({ fehler: 'Diese E-Mail ist bereits registriert' })

      const benutzer = await app.auth.legeBenutzerAn(email, request.body.passwort, request.body.name.trim(), false)
      const token = app.auth.erzeugeMailToken(benutzer.id, 'verify')
      const link = `${konfig.basisUrl}/studio.html#verify=${token}`
      const { betreff, text } = baueVerifikationsMail(benutzer.name, link)
      try {
        await mail.sende({ an: benutzer.email, betreff, text })
      } catch (fehler) {
        app.log.error({ fehler }, 'Bestätigungsmail konnte nicht versendet werden')
      }
      // Direkt einloggen (Cookie) — der Nutzer sieht sofort sein Studio mit dem
      // Hinweis „E-Mail bestätigen", statt nach der Registrierung ausgesperrt zu sein.
      setzeSessionCookie(reply, benutzer.id)
      return reply.code(201).send({ benutzer, verifiziert: false })
    },
  )

  // — E-Mail bestätigen — Token aus dem Mail-Link einlösen; danach eingeloggt.
  app.post<{ Body: { token: string } }>(
    '/api/auth/verifiziere',
    { schema: { body: { type: 'object', additionalProperties: false, required: ['token'], properties: { token: { type: 'string', maxLength: 200 } } } } },
    async (request, reply) => {
      const userId = app.auth.loeseMailToken(request.body.token, 'verify')
      if (!userId) return reply.code(400).send({ fehler: 'Bestätigungslink ungültig oder abgelaufen' })
      app.auth.verifiziereEmail(userId)
      setzeSessionCookie(reply, userId)
      return { ok: true }
    },
  )

  // — Passwort-Reset anfordern — IMMER 200 (keine Existenz-Auskunft); nur wenn
  // die Adresse existiert, wird ein Reset-Token verschickt.
  app.post<{ Body: { email: string } }>(
    '/api/auth/passwort-reset-anfordern',
    { schema: { body: { type: 'object', additionalProperties: false, required: ['email'], properties: { email: emailSchema } } } },
    async (request, reply) => {
      const email = request.body.email.toLowerCase().trim()
      if (resetGebremst(`ip:${request.ip}`, `mail:${email}`)) {
        return reply.code(429).send({ fehler: 'Zu viele Anfragen — bitte später erneut versuchen' })
      }
      const userId = app.auth.benutzerIdFuerEmail(email)
      if (userId) {
        const token = app.auth.erzeugeMailToken(userId, 'reset')
        const link = `${konfig.basisUrl}/studio.html#reset=${token}`
        const { betreff, text } = baueResetMail(email.split('@')[0] ?? 'du', link)
        try {
          await mail.sende({ an: email, betreff, text })
        } catch (fehler) {
          app.log.error({ fehler }, 'Reset-Mail konnte nicht versendet werden')
        }
      }
      return { ok: true }
    },
  )

  // — Passwort neu setzen — Token einlösen, Passwort ersetzen, alle Sitzungen
  // beenden, den Nutzer frisch einloggen.
  app.post<{ Body: { token: string; passwort: string } }>(
    '/api/auth/passwort-reset',
    { schema: { body: { type: 'object', additionalProperties: false, required: ['token', 'passwort'], properties: { token: { type: 'string', maxLength: 200 }, passwort: passwortSchema } } } },
    async (request, reply) => {
      const userId = app.auth.loeseMailToken(request.body.token, 'reset')
      if (!userId) return reply.code(400).send({ fehler: 'Reset-Link ungültig oder abgelaufen' })
      await app.auth.setzePasswort(userId, request.body.passwort)
      setzeSessionCookie(reply, userId)
      return { ok: true }
    },
  )

  app.post('/api/auth/logout', async (request, reply) => {
    const sessionId = request.cookies[SESSION_COOKIE]
    if (sessionId) app.auth.beendeSession(sessionId)
    reply.clearCookie(SESSION_COOKIE, { path: '/' })
    return { ok: true }
  })

  // — Konto samt aller Daten löschen (DSGVO) — Storage-Dateien zuerst (die DB
  // kennt sie nicht mehr, sobald der Cascade greift), dann die DB-Zeile.
  app.delete('/api/auth/me', async (request, reply) => {
    const benutzer = erfordereBenutzer(request, reply)
    if (!benutzer) return
    for (const tourId of app.auth.tourIds(benutzer.id)) await storage.loescheTour(tourId)
    app.auth.loescheBenutzer(benutzer.id)
    reply.clearCookie(SESSION_COOKIE, { path: '/' })
    return { ok: true }
  })

  // — Ich-Abfrage OHNE 401 (Studio pollt bei jedem Laden). Angemeldet: um
  // Verifikations-Stand und Quota angereichert.
  app.get('/api/auth/me', async (request) => {
    if (!request.benutzer) return { benutzer: null }
    const quota = await quotaStand(db, storage, request.benutzer.id, konfig.maxSpeicherProBenutzer)
    return {
      benutzer: request.benutzer,
      verifiziert: app.auth.istVerifiziert(request.benutzer.id),
      quota,
      registrierungOffen: konfig.registrierungOffen,
    }
  })
}
