// Die Warteliste — öffentlicher Teil (eintragen, bestätigen, austragen) und
// Verwaltung (Liste, einladen, löschen) in einer Datei, weil sie eine Sache
// sind: dieselbe Zeile, einmal von vorn und einmal von hinten gesehen.
//
// Zwei Regeln ziehen sich durch:
//
//   1. **Die öffentlichen Routen antworten immer gleich.** Ob eine Adresse neu
//      ist, schon wartet oder längst ein Konto hat, verrät die Antwort nicht —
//      sonst wäre die Route ein Auskunftsdienst darüber, wer sich bei Maptale
//      angemeldet hat. Dasselbe Muster wie beim Passwort-Reset.
//   2. **Eingeladen wird nur, wer bestätigt hat.** Eine Mail an eine
//      unbestätigte Adresse wäre genau die Nachricht, gegen die das
//      Double-Opt-in gebaut ist.

import type { FastifyInstance } from 'fastify'
import { requireAdmin } from '../app.js'
import { DEFAULT_VALID_DAYS } from '../auth/invitations.js'
import { waitlistOffered } from '../auth/waitlist.js'
import { buildRateLimit } from '../rate-limit.js'
import { WEB_PATHS } from '../web-paths.js'

const emailSchema = { type: 'string', maxLength: 254 } as const
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const tokenSchema = { type: 'string', maxLength: 200 } as const

/**
 * Die freiwillige Angabe ist kurz gehalten.
 *
 * Sie soll dem Betreiber die Frage „wen lade ich als Nächstes ein?"
 * beantworten, nicht ein Anschreiben werden — und je länger das Feld, desto
 * mehr steht am Ende darin, was niemand erhoben hat.
 */
const MAX_NOTE = 300

export function registerWaitlistRoutes(app: FastifyInstance): void {
  const { config, mail } = app.deps
  // Streng: Ein Mensch trägt sich einmal ein. Die Bremse zählt IP und Adresse,
  // damit weder ein Skript viele Adressen noch viele Quellen eine Adresse
  // zuschütten können.
  const joinLimited = buildRateLimit(3, 10 * 60_000)
  const tokenLimited = buildRateLimit(20, 10 * 60_000)

  /** Steht das Formular vor der Tür überhaupt? */
  const offered2 = (): boolean =>
    waitlistOffered(app.waitlist.open(), app.invitations.required(), config.registrationOpen)

  const confirmLink = (token: string): string =>
    `${config.baseUrl}${WEB_PATHS.register}#warteliste=${token}`
  const leaveLink2 = (token: string): string =>
    `${config.baseUrl}${WEB_PATHS.register}#warteliste-austragen=${token}`

  // — Eintragen —
  //
  // Die Antwort ist immer dieselbe: „Wenn alles stimmt, ist eine Mail
  // unterwegs." Verschickt wird sie nur, wenn die Adresse noch kein Konto hat
  // und noch nicht bestätigt auf der Liste steht.
  app.post<{ Body: { email: string; note?: string } }>(
    '/api/auth/waitlist',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['email'],
          properties: { email: emailSchema, note: { type: 'string', maxLength: MAX_NOTE } },
        },
      },
    },
    async (request, reply) => {
      if (!offered2())
        return reply.code(403).send({ error: 'Die Warteliste ist zurzeit geschlossen.' })
      const email = request.body.email.toLowerCase().trim()
      if (!EMAIL_PATTERN.test(email))
        return reply.code(400).send({ error: 'Diese E-Mail-Adresse stimmt nicht.' })
      if (joinLimited(`ip:${request.ip}`, `mail:${email}`)) {
        return reply
          .code(429)
          .send({ error: 'Zu viele Anfragen. Bitte versuche es später erneut.' })
      }
      // Wer schon ein Konto hat, gehört nicht auf die Warteliste — er soll sich
      // anmelden. Auch das bleibt unbeantwortet: Die Route sagt nicht, welche
      // Adressen registriert sind.
      if (!app.auth.emailTaken(email)) {
        const { token } = app.waitlist.join(email, request.body.note ?? null, request.ip || null)
        if (token) {
          const { subject, text, html } = app.mailTemplates.render(
            'waitlist',
            {},
            { baseUrl: config.baseUrl, link: confirmLink(token) },
          )
          try {
            await mail.send({ to2: email, subject, text, html })
          } catch (error) {
            app.log.error({ error }, 'Warteliste-Bestätigungsmail konnte nicht versendet werden')
          }
        }
      }
      return { ok: true }
    },
  )

  // — Bestätigen (der Klick aus der Mail) —
  app.post<{ Body: { token: string } }>(
    '/api/auth/waitlist/confirm',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['token'],
          properties: { token: tokenSchema },
        },
      },
    },
    async (request, reply) => {
      if (tokenLimited(`ip:${request.ip}`)) {
        return reply
          .code(429)
          .send({ error: 'Zu viele Versuche. Bitte versuche es später erneut.' })
      }
      const entry2 = app.waitlist.confirm(request.body.token, request.ip || null)
      if (!entry2) return reply.code(400).send({ error: 'Dieser Link gilt nicht mehr.' })
      return { ok: true, email: entry2.email }
    },
  )

  // — Austragen (Art. 17: Löschung ohne Umweg über den Betreiber) —
  //
  // Auch ein Token, der nichts mehr trifft, bekommt „ok": Das Ziel des
  // Aufrufers ist, nicht mehr auf der Liste zu stehen — und das ist erreicht.
  app.post<{ Body: { token: string } }>(
    '/api/auth/waitlist/leave',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['token'],
          properties: { token: tokenSchema },
        },
      },
    },
    async (request, reply) => {
      if (tokenLimited(`ip:${request.ip}`)) {
        return reply
          .code(429)
          .send({ error: 'Zu viele Versuche. Bitte versuche es später erneut.' })
      }
      // Mit dem Eintrag geht die Einladung, die noch offen auf diese Adresse
      // wartet: Sie trägt die Adresse als Notiz, und „wir löschen sie sofort"
      // wäre sonst nur halb wahr. Eine EINGELÖSTE Einladung bleibt stehen —
      // dann gibt es ein Konto, und sie ist dessen Herkunftsnachweis.
      const entry2 = app.waitlist.byToken(request.body.token)
      if (entry2?.invitedCode && app.invitations.check(entry2.invitedCode) !== 'used') {
        app.invitations.revoke(entry2.invitedCode)
      }
      app.waitlist.leave(request.body.token)
      return { ok: true }
    },
  )

  // — Verwaltung —

  app.get('/api/admin/waitlist', async (request, reply) => {
    if (!requireAdmin(request, reply)) return
    return {
      entries: app.waitlist.all(),
      waitlistOpen: app.waitlist.open(),
      /** Ob das Formular gerade wirklich vor der Tür steht — der Schalter allein sagt das nicht. */
      offered: offered2(),
    }
  })

  // Einladen: Code erzeugen, Mail schicken, Eintrag als eingeladen markieren.
  //
  // Schlägt der Versand fehl, wird der eben erzeugte Code wieder widerrufen —
  // ein Code, den niemand bekommen hat, wäre eine offene Einladung ohne
  // Adressaten, und die Zeile behauptete „eingeladen", obwohl nichts ankam.
  app.post<{ Params: { id: string }; Body: { validDays?: number } }>(
    '/api/admin/waitlist/:id/invite',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: { validDays: { type: 'integer', minimum: 0, maximum: 365 } },
        },
      },
    },
    async (request, reply) => {
      const admin = requireAdmin(request, reply)
      if (!admin) return
      const entry2 = app.waitlist.byId(request.params.id)
      if (!entry2) return reply.code(404).send({ error: 'Unbekannter Eintrag' })
      if (entry2.state === 'unconfirmed') {
        return reply.code(409).send({ error: 'Diese Adresse ist noch nicht bestätigt' })
      }
      if (entry2.state === 'invited') {
        return reply.code(409).send({ error: 'Diese Adresse wurde bereits eingeladen' })
      }
      if (app.auth.emailTaken(entry2.email)) {
        return reply.code(409).send({ error: 'Zu dieser Adresse gibt es bereits ein Konto' })
      }

      const days = request.body?.validDays ?? DEFAULT_VALID_DAYS
      // Die Adresse als Notiz: In der Einladungsliste steht später sonst ein
      // Code ohne Empfänger.
      const invitation2 = app.invitations.create(admin.id, entry2.email, days || null)
      // Frischer Token für den Austragen-Link: Den aus der Bestätigungsmail
      // kennt der Server nur als Hash. Die jüngste Mail trägt damit immer den
      // gültigen Weg hinaus — die ältere wird still stumpf.
      const leaveToken = app.waitlist.renewToken(entry2.id)
      const { subject, text, html } = app.mailTemplates.render(
        'waitlist-invitation',
        { code: invitation2.code, leaveLink: leaveLink2(leaveToken) },
        {
          baseUrl: config.baseUrl,
          link: `${config.baseUrl}${WEB_PATHS.register}#einladung=${encodeURIComponent(invitation2.code)}`,
        },
      )
      try {
        await mail.send({ to2: entry2.email, subject, text, html })
      } catch (error) {
        app.invitations.revoke(invitation2.code)
        app.log.error({ error }, 'Warteliste-Einladungsmail konnte nicht versendet werden')
        return reply.code(502).send({ error: 'Die Einladung konnte nicht versendet werden' })
      }
      app.waitlist.markInvited(entry2.id, invitation2.code)
      return { entry: app.waitlist.byId(entry2.id), invitation: invitation2 }
    },
  )

  app.delete<{ Params: { id: string } }>('/api/admin/waitlist/:id', async (request, reply) => {
    if (!requireAdmin(request, reply)) return
    if (!app.waitlist.remove(request.params.id)) {
      return reply.code(404).send({ error: 'Unbekannter Eintrag' })
    }
    return { ok: true }
  })
}
