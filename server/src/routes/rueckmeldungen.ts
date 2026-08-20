// Rückmeldungen — öffentlicher Eingang und Verwaltung in einer Datei, weil sie
// dieselbe Zeile von zwei Seiten sind (wie bei der Warteliste).
//
// Der Eingang ist bewusst OHNE Anmeldung erreichbar: Die Meldung „ich komme
// nicht rein" kann per Definition niemand angemeldet abschicken. Wer angemeldet
// ist, hängt seine Konto-Kennung automatisch an — das ist der Unterschied
// zwischen „ich kann zurückfragen" und „ich rate".

import type { FastifyInstance } from 'fastify'
import { erfordereAdmin } from '../app.js'
import { baueBremse } from '../bremse.js'
import {
  MAX_EMAIL,
  MAX_TEXT,
  type RueckmeldungKontext,
  type RueckmeldungStatus,
} from '../rueckmeldungen.js'

const EMAIL_FORM = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/**
 * Was im Kontext stehen darf — eine feste Liste und kein freies Objekt.
 *
 * Der Client entscheidet, OB er technische Angaben mitschickt; WAS darin stehen
 * kann, entscheidet der Server. Sonst wäre das Feld ein offener Kanal, durch
 * den ein manipulierter Client beliebige Daten in die Tabelle legt — und die
 * Datenschutzerklärung nennt dann eine Aufzählung, die nicht mehr stimmt.
 */
const KONTEXT_FELDER = [
  'page',
  'version',
  'browser',
  'platform',
  'screen',
  'language',
  'appVersion',
  'device',
  'androidVersion',
] as const

const MAX_KONTEXT_WERT = 300

/** Nimmt nur die bekannten Felder und kürzt jeden Wert. */
export function saubereKontext(roh: unknown): RueckmeldungKontext | null {
  if (!roh || typeof roh !== 'object' || Array.isArray(roh)) return null
  const quelle = roh as Record<string, unknown>
  const sauber: RueckmeldungKontext = {}
  for (const feld of KONTEXT_FELDER) {
    const wert = quelle[feld]
    if (typeof wert === 'string' && wert.trim())
      sauber[feld] = wert.trim().slice(0, MAX_KONTEXT_WERT)
    else if (typeof wert === 'number' && Number.isFinite(wert)) sauber[feld] = wert
    else if (typeof wert === 'boolean') sauber[feld] = wert
  }
  return Object.keys(sauber).length ? sauber : null
}

const STATUS: RueckmeldungStatus[] = ['open', 'in_progress', 'done']

export function registriereRueckmeldungsRouten(app: FastifyInstance): void {
  // Großzügiger als die Warteliste: Wer drei Fehler hintereinander findet, soll
  // sie auch melden dürfen. Eng genug, dass ein Skript die Tabelle nicht füllt.
  const gebremst = baueBremse(10, 10 * 60_000)

  app.post<{
    Body: { text: string; email?: string; context?: unknown; source?: 'web' | 'app' }
  }>(
    '/api/feedback',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['text'],
          properties: {
            text: { type: 'string', minLength: 1, maxLength: MAX_TEXT },
            email: { type: 'string', maxLength: MAX_EMAIL },
            context: { type: 'object' },
            source: { type: 'string', enum: ['web', 'app'] },
          },
        },
      },
    },
    async (request, reply) => {
      const text = request.body.text.trim()
      if (!text) return reply.code(400).send({ error: 'Bitte schreib kurz, worum es geht.' })
      if (gebremst(`ip:${request.ip}`)) {
        return reply
          .code(429)
          .send({ error: 'Zu viele Meldungen. Bitte versuche es später erneut.' })
      }
      // Eine unbrauchbare Adresse wird verworfen und nicht bemängelt: Sie ist
      // freiwillig, und die Meldung ist auch ohne sie etwas wert.
      const email = request.body.email?.trim()
      app.rueckmeldungen.nimmAn({
        text,
        email: email && EMAIL_FORM.test(email) ? email : null,
        userId: request.benutzer?.id ?? null,
        context: saubereKontext(request.body.context),
        source: request.body.source ?? 'web',
      })
      return reply.send({ ok: true })
    },
  )

  // — Verwaltung —

  app.get<{ Querystring: { status?: RueckmeldungStatus } }>(
    '/api/admin/feedback',
    async (request, reply) => {
      if (!erfordereAdmin(request, reply)) return
      const status = request.query.status
      return {
        feedback: app.rueckmeldungen.liste(
          status && STATUS.includes(status) ? { status } : undefined,
        ),
        counts: app.rueckmeldungen.zaehlung(),
      }
    },
  )

  app.patch<{
    Params: { id: string }
    Body: { status?: RueckmeldungStatus; note?: string | null }
  }>(
    '/api/admin/feedback/:id',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            status: { type: 'string', enum: STATUS },
            note: { type: ['string', 'null'], maxLength: 4000 },
          },
        },
      },
    },
    async (request, reply) => {
      if (!erfordereAdmin(request, reply)) return
      const aenderung: { status?: RueckmeldungStatus; note?: string | null } = {}
      if (request.body.status !== undefined) aenderung.status = request.body.status
      if (request.body.note !== undefined) aenderung.note = request.body.note
      const gespeichert = app.rueckmeldungen.aktualisiere(request.params.id, aenderung)
      if (!gespeichert) return reply.code(404).send({ error: 'Diese Rückmeldung gibt es nicht.' })
      return reply.send({ feedback: gespeichert })
    },
  )

  app.delete<{ Params: { id: string } }>(
    '/api/admin/feedback/:id',
    async (request, reply) => {
      if (!erfordereAdmin(request, reply)) return
      if (!app.rueckmeldungen.loesche(request.params.id)) {
        return reply.code(404).send({ error: 'Diese Rückmeldung gibt es nicht.' })
      }
      return reply.send({ ok: true })
    },
  )
}
