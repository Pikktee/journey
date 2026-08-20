// Push-Geräte an- und abmelden.
//
// Zwei Routen, mehr braucht es nicht: Die App meldet ihren FCM-Token an, wenn
// sie ihn bekommt (und bei jeder Erneuerung erneut), und meldet ihn ab, wenn
// sich jemand abmeldet oder die Meldungen abstellt. Alles andere — welche
// Geräte es gibt, wann zuletzt gesehen — ist Sache des Dienstes.
//
// **Die Pfade sind englisch** wie die der Tracker-Routen: Sie sind Außenfläche.

import type { FastifyInstance } from 'fastify'
import { erfordereBenutzer } from '../app.js'

const geraetSchema = {
  type: 'object',
  required: ['token', 'platform'],
  additionalProperties: false,
  properties: {
    // 4 KB Deckel: FCM-Tokens liegen bei ~160 Zeichen. Die Grenze steht hier
    // nicht gegen einen Angriff (die Route ist angemeldet), sondern gegen eine
    // kaputte App-Fassung, die versehentlich ein ganzes JSON hereinschiebt.
    token: { type: 'string', minLength: 8, maxLength: 4096 },
    platform: { enum: ['android', 'ios'] },
  },
} as const

export function registrierePushRouten(app: FastifyInstance): void {
  // — Gerät anmelden (auch zum Erneuern: die Route schreibt um) —
  app.post<{ Body: { token: string; platform: 'android' | 'ios' } }>(
    '/api/push/devices',
    { schema: { body: geraetSchema } },
    async (request, reply) => {
      const benutzer = erfordereBenutzer(request, reply)
      if (!benutzer) return
      // Ohne Dienstkonto gibt es keinen Versandweg. Das ist KEIN Fehler,
      // sondern eine Auskunft: Die App hört auf, es zu versuchen, und bleibt
      // bei ihrem periodischen Abruf — statt einen Token zu hinterlegen, an
      // den nie etwas geht.
      if (!app.push.einsatzbereit) return reply.code(200).send({ ok: false, push: false })
      const geraet = app.push.registriere(
        benutzer.id,
        request.body.token,
        request.body.platform,
        // Das Gerät hängt am Zugang, mit dem es kam: Wer die App in
        // „Angemeldete Geräte" abmeldet, beendet damit auch die Meldungen
        // dorthin. Bei einer Sitzung (Web) gibt es nichts zu binden — dort
        // wird heute ohnehin nicht registriert.
        request.appTokenId,
      )
      return { ok: true, push: true, deviceId: geraet.id }
    },
  )

  // — Gerät abmelden —
  //
  // Über den Token im Body und nicht als Pfad-Segment: Ein FCM-Token ist lang
  // und enthält `:` und `-`; in einer URL landete er in Server-Logs und
  // Zugriffsprotokollen, wo er nichts zu suchen hat.
  app.delete<{ Body: { token: string } }>(
    '/api/push/devices',
    {
      schema: {
        body: {
          type: 'object',
          required: ['token'],
          additionalProperties: false,
          properties: { token: { type: 'string', minLength: 8, maxLength: 4096 } },
        },
      },
    },
    async (request, reply) => {
      const benutzer = erfordereBenutzer(request, reply)
      if (!benutzer) return
      // Auch ein unbekannter Token antwortet mit `ok` — die App hat dann
      // erreicht, was sie wollte, und ein 404 machte aus dem Abmelden eines
      // längst gelöschten Geräts einen Fehler, den niemand beheben kann.
      app.push.entferne(benutzer.id, request.body.token)
      return { ok: true }
    },
  )
}
