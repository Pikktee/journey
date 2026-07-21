// Auth-Routen: Login (Web-Session und/oder App-Token), Logout, Ich-Abfrage
// sowie der M9-Betriebsteil — Selbst-Registrierung mit E-Mail-Bestätigung,
// Passwort-Reset und Konto-Löschung. Alle unauthentifizierten, teuren oder
// mail-auslösenden Endpunkte sind pro Quelle/Adresse gebremst.

import type { Readable } from 'node:stream'
import type { FastifyInstance } from 'fastify'
import { erfordereBenutzer, SESSION_COOKIE } from '../app.js'
import type { ProfilAenderung } from '../auth/auth.js'
import { baueResetMail, baueVerifikationsMail } from '../mail.js'
import { quotaStand } from '../quota.js'

interface LoginBody {
  email: string
  passwort: string
  /** Gesetzt (z. B. „Pixel 9"): zusätzlich ein API-Token für die App erzeugen */
  tokenLabel?: string
}

type ProfilBody = ProfilAenderung

/**
 * Ein Profilbild ist ein Vorschaubild, kein Foto-Upload — die App skaliert vor
 * dem Senden auf ~512 px. Das Limit fängt nur ab, wenn jemand am Client
 * vorbei ein Rohfoto schickt.
 */
const MAX_AVATAR_BYTES = 2 * 1024 * 1024

/**
 * Öffentlicher Pfad eines Avatars.
 *
 * Der Dateiname hängt als Parameter dran, obwohl die Route ihn nicht braucht:
 * Er macht die URL nach jedem Upload zu einer neuen und bricht damit den
 * Cache. Ohne ihn zeigte der Browser nach einem Bildwechsel weiter das alte
 * Bild — bei `immutable` ein Jahr lang.
 */
const avatarUrl = (userId: string, datei: string): string =>
  `/api/benutzer/${userId}/avatar?v=${encodeURIComponent(datei)}`

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
  const { konfig, mail, storage, benutzerStorage, db } = app.deps
  const loginGebremst = baueBremse(10)
  const registrierGebremst = baueBremse(5, 10 * 60_000) // 5 pro 10 min je IP
  const resetGebremst = baueBremse(5, 10 * 60_000)

  const setzeSessionCookie = (
    reply: import('fastify').FastifyReply,
    userId: string,
  ): { id: string; ablauf: Date } => {
    const session = app.auth.erzeugeSession(userId)
    reply.setCookie(SESSION_COOKIE, session.id, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: konfig.hinterTls,
      expires: session.ablauf,
    })
    return session
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

  // — Session aus einem API-Token —
  //
  // Für den Player IN DER APP: der läuft als WebView auf dem Web-Origin und
  // holt Tour-JSON und Medien wie ein Browser, also mit Cookie. Das API-Token
  // der App kann er nicht mitschicken (es steckt im OkHttp-Client, nicht im
  // WebView). Ohne Sitzung sieht der WebView nur Touren, die ohnehin für jeden
  // mit Link sichtbar sind — private Touren wären in der eigenen App
  // unabspielbar. Die App tauscht deshalb vor dem Abspielen ihr Token gegen
  // eine Sitzung und setzt sie als Cookie.
  app.post('/api/auth/session-aus-token', async (request, reply) => {
    const benutzer = erfordereBenutzer(request, reply)
    if (!benutzer) return
    const session = setzeSessionCookie(reply, benutzer.id)
    return { sessionId: session.id, ablauf: session.ablauf.toISOString() }
  })

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
    // Auch die Benutzerdateien (Avatar) — sie hängen an keiner Tour und
    // überlebten den Cascade sonst als Waisen auf der Platte.
    await benutzerStorage.loescheTour(benutzer.id).catch(() => undefined)
    app.auth.loescheBenutzer(benutzer.id)
    reply.clearCookie(SESSION_COOKIE, { path: '/' })
    return { ok: true }
  })

  // — Ich-Abfrage OHNE 401 (Studio pollt bei jedem Laden). Angemeldet: um
  // Verifikations-Stand, Quota und Profil angereichert.
  app.get('/api/auth/me', async (request) => {
    if (!request.benutzer) return { benutzer: null }
    const quota = await quotaStand(db, storage, request.benutzer.id, konfig.maxSpeicherProBenutzer)
    const profil = app.auth.profil(request.benutzer.id)
    return {
      benutzer: request.benutzer,
      verifiziert: app.auth.istVerifiziert(request.benutzer.id),
      quota,
      registrierungOffen: konfig.registrierungOffen,
      profil: {
        anzeigename: profil?.anzeigename ?? null,
        bio: profil?.bio ?? null,
        avatarUrl: profil?.avatar ? avatarUrl(request.benutzer.id, profil.avatar) : null,
        sichtbarkeit: profil?.sichtbarkeit ?? 'private',
      },
    }
  })

  // — Profil ändern —
  app.patch<{ Body: ProfilBody }>(
    '/api/auth/me/profil',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            // '' leert das Feld; fehlt es, bleibt es unverändert
            anzeigename: { type: 'string', maxLength: 80 },
            bio: { type: 'string', maxLength: 500 },
            sichtbarkeit: { enum: ['private', 'public'] },
          },
        },
      },
    },
    async (request, reply) => {
      const benutzer = erfordereBenutzer(request, reply)
      if (!benutzer) return
      app.auth.setzeProfil(benutzer.id, request.body)
      const profil = app.auth.profil(benutzer.id)
      return {
        anzeigename: profil?.anzeigename ?? null,
        bio: profil?.bio ?? null,
        avatarUrl: profil?.avatar ? avatarUrl(benutzer.id, profil.avatar) : null,
        sichtbarkeit: profil?.sichtbarkeit ?? 'private',
      }
    },
  )

  // — Avatar hochladen (roher Bild-Body) —
  //
  // Der Dateiname trägt einen Zeitstempel: Ein fester Name würde nach einem
  // Wechsel aus dem Browser-Cache weiter das alte Bild liefern. Zählt nicht
  // gegen die Tour-Quota — ein Profilbild ist kein Reise-Inhalt.
  app.put('/api/auth/me/avatar', async (request, reply) => {
    const benutzer = erfordereBenutzer(request, reply)
    if (!benutzer) return
    const alt = app.auth.profil(benutzer.id)?.avatar ?? null
    const datei = `avatar/${Date.now()}.jpg`
    await benutzerStorage.schreibeStream(benutzer.id, datei, request.body as Readable, MAX_AVATAR_BYTES)
    app.auth.setzeAvatar(benutzer.id, datei)
    // Erst nach dem erfolgreichen Schreiben aufräumen — bricht der Upload ab,
    // bleibt das bisherige Bild bestehen.
    if (alt && alt !== datei) await benutzerStorage.loesche(benutzer.id, alt).catch(() => undefined)
    return { avatarUrl: avatarUrl(benutzer.id, datei) }
  })

  app.delete('/api/auth/me/avatar', async (request, reply) => {
    const benutzer = erfordereBenutzer(request, reply)
    if (!benutzer) return
    const alt = app.auth.profil(benutzer.id)?.avatar
    if (alt) await benutzerStorage.loesche(benutzer.id, alt).catch(() => undefined)
    app.auth.setzeAvatar(benutzer.id, null)
    return { ok: true }
  })

  // — Avatar ausliefern (öffentlich) —
  //
  // Ohne Anmeldung, wie die Medien geteilter Touren: Ein Avatar erscheint neben
  // öffentlichen Touren in der Galerie und muss dort für jeden ladbar sein. Der
  // Dateiname wechselt bei jedem Upload, deshalb darf lange gecacht werden.
  app.get<{ Params: { id: string } }>('/api/benutzer/:id/avatar', async (request, reply) => {
    const profil = app.auth.profil(request.params.id)
    if (!profil?.avatar) return reply.code(404).send({ fehler: 'Kein Profilbild' })
    const info = await benutzerStorage.info(request.params.id, profil.avatar)
    if (!info) return reply.code(404).send({ fehler: 'Kein Profilbild' })
    return reply
      .header('content-type', 'image/jpeg')
      .header('x-content-type-options', 'nosniff')
      .header('cache-control', 'public, max-age=31536000, immutable')
      .header('content-length', String(info.groesse))
      .send(benutzerStorage.leseStream(request.params.id, profil.avatar))
  })
}
