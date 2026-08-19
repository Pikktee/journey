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
import { erfordereAdmin } from '../app.js'
import { GUELTIG_TAGE_STANDARD } from '../auth/einladungen.js'
import { wartelisteAngeboten } from '../auth/warteliste.js'
import { baueBremse } from '../bremse.js'
import { WEB_PFADE } from '../webpfade.js'

const emailSchema = { type: 'string', maxLength: 254 } as const
const EMAIL_FORM = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const tokenSchema = { type: 'string', maxLength: 200 } as const

/**
 * Die freiwillige Angabe ist kurz gehalten.
 *
 * Sie soll dem Betreiber die Frage „wen lade ich als Nächstes ein?"
 * beantworten, nicht ein Anschreiben werden — und je länger das Feld, desto
 * mehr steht am Ende darin, was niemand erhoben hat.
 */
const MAX_NOTIZ = 300

export function registriereWartelistenRouten(app: FastifyInstance): void {
  const { konfig, mail } = app.deps
  // Streng: Ein Mensch trägt sich einmal ein. Die Bremse zählt IP und Adresse,
  // damit weder ein Skript viele Adressen noch viele Quellen eine Adresse
  // zuschütten können.
  const eintragGebremst = baueBremse(3, 10 * 60_000)
  const tokenGebremst = baueBremse(20, 10 * 60_000)

  /** Steht das Formular vor der Tür überhaupt? */
  const angeboten = (): boolean =>
    wartelisteAngeboten(
      app.warteliste.offen(),
      app.einladungen.pflicht(),
      konfig.registrierungOffen,
    )

  const bestaetigungsLink = (token: string): string =>
    `${konfig.basisUrl}${WEB_PFADE.registrieren}#warteliste=${token}`
  const austragenLink = (token: string): string =>
    `${konfig.basisUrl}${WEB_PFADE.registrieren}#warteliste-austragen=${token}`

  // — Eintragen —
  //
  // Die Antwort ist immer dieselbe: „Wenn alles stimmt, ist eine Mail
  // unterwegs." Verschickt wird sie nur, wenn die Adresse noch kein Konto hat
  // und noch nicht bestätigt auf der Liste steht.
  app.post<{ Body: { email: string; notiz?: string } }>(
    '/api/auth/warteliste',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['email'],
          properties: { email: emailSchema, notiz: { type: 'string', maxLength: MAX_NOTIZ } },
        },
      },
    },
    async (request, reply) => {
      if (!angeboten())
        return reply.code(403).send({ fehler: 'Die Warteliste ist zurzeit geschlossen.' })
      const email = request.body.email.toLowerCase().trim()
      if (!EMAIL_FORM.test(email))
        return reply.code(400).send({ fehler: 'Diese E-Mail-Adresse stimmt nicht.' })
      if (eintragGebremst(`ip:${request.ip}`, `mail:${email}`)) {
        return reply
          .code(429)
          .send({ fehler: 'Zu viele Anfragen. Bitte versuche es später erneut.' })
      }
      // Wer schon ein Konto hat, gehört nicht auf die Warteliste — er soll sich
      // anmelden. Auch das bleibt unbeantwortet: Die Route sagt nicht, welche
      // Adressen registriert sind.
      if (!app.auth.emailVergeben(email)) {
        const { token } = app.warteliste.trageEin(
          email,
          request.body.notiz ?? null,
          request.ip || null,
        )
        if (token) {
          const { betreff, text, html } = app.mailvorlagen.rendere(
            'warteliste',
            {},
            { basisUrl: konfig.basisUrl, link: bestaetigungsLink(token) },
          )
          try {
            await mail.sende({ an: email, betreff, text, html })
          } catch (fehler) {
            app.log.error({ fehler }, 'Warteliste-Bestätigungsmail konnte nicht versendet werden')
          }
        }
      }
      return { ok: true }
    },
  )

  // — Bestätigen (der Klick aus der Mail) —
  app.post<{ Body: { token: string } }>(
    '/api/auth/warteliste/bestaetigen',
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
      if (tokenGebremst(`ip:${request.ip}`)) {
        return reply
          .code(429)
          .send({ fehler: 'Zu viele Versuche. Bitte versuche es später erneut.' })
      }
      const eintrag = app.warteliste.bestaetige(request.body.token, request.ip || null)
      if (!eintrag) return reply.code(400).send({ fehler: 'Dieser Link gilt nicht mehr.' })
      return { ok: true, email: eintrag.email }
    },
  )

  // — Austragen (Art. 17: Löschung ohne Umweg über den Betreiber) —
  //
  // Auch ein Token, der nichts mehr trifft, bekommt „ok": Das Ziel des
  // Aufrufers ist, nicht mehr auf der Liste zu stehen — und das ist erreicht.
  app.post<{ Body: { token: string } }>(
    '/api/auth/warteliste/austragen',
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
      if (tokenGebremst(`ip:${request.ip}`)) {
        return reply
          .code(429)
          .send({ fehler: 'Zu viele Versuche. Bitte versuche es später erneut.' })
      }
      // Mit dem Eintrag geht die Einladung, die noch offen auf diese Adresse
      // wartet: Sie trägt die Adresse als Notiz, und „wir löschen sie sofort"
      // wäre sonst nur halb wahr. Eine EINGELÖSTE Einladung bleibt stehen —
      // dann gibt es ein Konto, und sie ist dessen Herkunftsnachweis.
      const eintrag = app.warteliste.nachToken(request.body.token)
      if (
        eintrag?.eingeladenCode &&
        app.einladungen.pruefe(eintrag.eingeladenCode) !== 'verbraucht'
      ) {
        app.einladungen.widerrufe(eintrag.eingeladenCode)
      }
      app.warteliste.trageAus(request.body.token)
      return { ok: true }
    },
  )

  // — Verwaltung —

  app.get('/api/admin/warteliste', async (request, reply) => {
    if (!erfordereAdmin(request, reply)) return
    return {
      eintraege: app.warteliste.alle(),
      wartelisteOffen: app.warteliste.offen(),
      /** Ob das Formular gerade wirklich vor der Tür steht — der Schalter allein sagt das nicht. */
      angeboten: angeboten(),
    }
  })

  // Einladen: Code erzeugen, Mail schicken, Eintrag als eingeladen markieren.
  //
  // Schlägt der Versand fehl, wird der eben erzeugte Code wieder widerrufen —
  // ein Code, den niemand bekommen hat, wäre eine offene Einladung ohne
  // Adressaten, und die Zeile behauptete „eingeladen", obwohl nichts ankam.
  app.post<{ Params: { id: string }; Body: { gueltigTage?: number } }>(
    '/api/admin/warteliste/:id/einladen',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: { gueltigTage: { type: 'integer', minimum: 0, maximum: 365 } },
        },
      },
    },
    async (request, reply) => {
      const admin = erfordereAdmin(request, reply)
      if (!admin) return
      const eintrag = app.warteliste.nachId(request.params.id)
      if (!eintrag) return reply.code(404).send({ fehler: 'Unbekannter Eintrag' })
      if (eintrag.zustand === 'unbestaetigt') {
        return reply.code(409).send({ fehler: 'Diese Adresse ist noch nicht bestätigt' })
      }
      if (eintrag.zustand === 'eingeladen') {
        return reply.code(409).send({ fehler: 'Diese Adresse wurde bereits eingeladen' })
      }
      if (app.auth.emailVergeben(eintrag.email)) {
        return reply.code(409).send({ fehler: 'Zu dieser Adresse gibt es bereits ein Konto' })
      }

      const tage = request.body?.gueltigTage ?? GUELTIG_TAGE_STANDARD
      // Die Adresse als Notiz: In der Einladungsliste steht später sonst ein
      // Code ohne Empfänger.
      const einladung = app.einladungen.erstelle(admin.id, eintrag.email, tage || null)
      // Frischer Token für den Austragen-Link: Den aus der Bestätigungsmail
      // kennt der Server nur als Hash. Die jüngste Mail trägt damit immer den
      // gültigen Weg hinaus — die ältere wird still stumpf.
      const austragToken = app.warteliste.erneuereToken(eintrag.id)
      const { betreff, text, html } = app.mailvorlagen.rendere(
        'warteliste-einladung',
        { code: einladung.code, austragenLink: austragenLink(austragToken) },
        {
          basisUrl: konfig.basisUrl,
          link: `${konfig.basisUrl}${WEB_PFADE.registrieren}#einladung=${encodeURIComponent(einladung.code)}`,
        },
      )
      try {
        await mail.sende({ an: eintrag.email, betreff, text, html })
      } catch (fehler) {
        app.einladungen.widerrufe(einladung.code)
        app.log.error({ fehler }, 'Warteliste-Einladungsmail konnte nicht versendet werden')
        return reply.code(502).send({ fehler: 'Die Einladung konnte nicht versendet werden' })
      }
      app.warteliste.markiereEingeladen(eintrag.id, einladung.code)
      return { eintrag: app.warteliste.nachId(eintrag.id), einladung }
    },
  )

  app.delete<{ Params: { id: string } }>('/api/admin/warteliste/:id', async (request, reply) => {
    if (!erfordereAdmin(request, reply)) return
    if (!app.warteliste.loesche(request.params.id)) {
      return reply.code(404).send({ fehler: 'Unbekannter Eintrag' })
    }
    return { ok: true }
  })
}
