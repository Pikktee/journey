// Der Weg aus dem Newsletter — beide Male OHNE Anmeldung.
//
// Ein Widerruf muss so einfach sein wie die Einwilligung (Art. 7 Abs. 3 DSGVO),
// und die Einwilligung war ein Kästchen. Wer sich abmelden will, steht im
// Zweifel in einem Postfach auf einem Gerät, auf dem er nie angemeldet war —
// eine Anmeldemaske davor wäre keine Sicherheitsmaßnahme, sondern eine Hürde
// vor einer Löschung. Der signierte Token IST der Nachweis (s. newsletter.ts);
// mehr kann er auch nicht: Er trägt genau ein Konto und genau eine Wirkung.
//
// Zwei Eingänge für dieselbe Sache:
//
//   - `POST /api/newsletter/abmelden` — der Knopf auf der Seite, die der Link
//     aus der Mail öffnet.
//   - `POST /api/newsletter/ein-klick/:token` — der Ein-Klick-Widerruf, den
//     Gmail und Apple Mail neben dem Absender einblenden (RFC 8058). Er kommt
//     ohne Zutun des Empfängers durch, sobald der auf „Abbestellen" tippt.
//
// **Der Link aus der Mail löst NICHTS aus, er zeigt nur einen Knopf.**
// Mail-Scanner öffnen Links vorab; eine Abmeldung durch einen Virenscanner
// wollte niemand. Beim Ein-Klick-Weg ist das kein Thema — er ist ein POST, und
// den schickt kein Scanner.

import type { FastifyInstance } from 'fastify'
import { baueBremse } from '../bremse.js'
import { pruefeAbmeldeToken } from '../newsletter.js'

const tokenSchema = { type: 'string', maxLength: 400 } as const

export function registriereNewsletterRouten(app: FastifyInstance): void {
  const { konfig } = app.deps
  const gebremst = baueBremse(20, 10 * 60_000)

  /**
   * Austragen — und immer „ok".
   *
   * Auch ein Token, der niemanden trifft, bekommt eine gute Antwort: Das Ziel
   * des Aufrufers ist, keine Post mehr zu bekommen, und das ist erreicht. Nur
   * eine kaputte SIGNATUR wird als Fehler gemeldet — dort kann der Absender
   * etwas tun (der Schalter steht in den Kontoeinstellungen).
   */
  const trageAus = (token: string): boolean => {
    const userId = pruefeAbmeldeToken(token, konfig.cookieSecret)
    if (!userId) return false
    // Der Zustand wird auch dann geschrieben, wenn er schon „aus" war: Die
    // zweite Zeile in der Historie ist der Beleg, dass jemand es noch einmal
    // versucht hat.
    if (app.auth.benutzerNachId(userId)) app.newsletter.setze(userId, false, 'abmeldelink')
    return true
  }

  app.post<{ Body: { token: string } }>(
    '/api/newsletter/abmelden',
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
      if (gebremst(`ip:${request.ip}`)) {
        return reply
          .code(429)
          .send({ fehler: 'Zu viele Versuche. Bitte versuche es später erneut.' })
      }
      if (!trageAus(request.body.token)) {
        return reply.code(400).send({
          fehler:
            'Dieser Abmeldelink gilt nicht mehr. In den Kontoeinstellungen kannst du den Schalter selbst umlegen.',
        })
      }
      return { ok: true }
    },
  )

  // — Ein-Klick (RFC 8058) —
  //
  // Der Token steht im PFAD, nicht im Körper: Mail-Programme schicken hier
  // `List-Unsubscribe=One-Click` als Formularfeld und sonst nichts. Der Körper
  // wird deshalb gar nicht gelesen (die App parst `*` ohnehin als Stream), und
  // die Antwort ist absichtlich leer — sie geht an ein Programm, nicht an einen
  // Menschen.
  app.post<{ Params: { token: string } }>(
    '/api/newsletter/ein-klick/:token',
    async (request, reply) => {
      if (gebremst(`ip:${request.ip}`)) return reply.code(429).send()
      if (!trageAus(request.params.token)) return reply.code(400).send()
      return reply.code(200).send()
    },
  )
}
