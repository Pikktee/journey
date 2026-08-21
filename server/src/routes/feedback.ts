// Rückmeldungen — öffentlicher Eingang und Verwaltung in einer Datei, weil sie
// dieselbe Zeile von zwei Seiten sind (wie bei der Warteliste).
//
// Der Eingang ist bewusst OHNE Anmeldung erreichbar: Die Meldung „ich komme
// nicht rein" kann per Definition niemand angemeldet abschicken. Wer angemeldet
// ist, hängt seine Konto-Kennung automatisch an — das ist der Unterschied
// zwischen „ich kann zurückfragen" und „ich rate".

import type { FastifyInstance } from 'fastify'
import { requireAdmin } from '../app.js'
import { buildRateLimit } from '../rate-limit.js'
import { MAX_EMAIL, MAX_TEXT, type FeedbackContext, type FeedbackStatus } from '../feedback.js'

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/**
 * Was im Kontext stehen darf — eine feste Liste und kein freies Objekt.
 *
 * Der Client entscheidet, OB er technische Angaben mitschickt; WAS darin stehen
 * kann, entscheidet der Server. Sonst wäre das Feld ein offener Kanal, durch
 * den ein manipulierter Client beliebige Daten in die Tabelle legt — und die
 * Datenschutzerklärung nennt dann eine Aufzählung, die nicht mehr stimmt.
 */
const CONTEXT_FIELDS = [
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

const MAX_CONTEXT_VALUE = 300

/** Nimmt nur die bekannten Felder und kürzt jeden Wert. */
export function cleanContext(raw: unknown): FeedbackContext | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const source2 = raw as Record<string, unknown>
  const clean: FeedbackContext = {}
  for (const field of CONTEXT_FIELDS) {
    const value = source2[field]
    if (typeof value === 'string' && value.trim())
      clean[field] = value.trim().slice(0, MAX_CONTEXT_VALUE)
    else if (typeof value === 'number' && Number.isFinite(value)) clean[field] = value
    else if (typeof value === 'boolean') clean[field] = value
  }
  return Object.keys(clean).length ? clean : null
}

const STATUS: FeedbackStatus[] = ['open', 'in_progress', 'done']

export function registerFeedbackRoutes(app: FastifyInstance): void {
  // Großzügiger als die Warteliste: Wer drei Fehler hintereinander findet, soll
  // sie auch melden dürfen. Eng genug, dass ein Skript die Tabelle nicht füllt.
  const limited = buildRateLimit(10, 10 * 60_000)

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
      if (limited(`ip:${request.ip}`)) {
        return reply
          .code(429)
          .send({ error: 'Zu viele Meldungen. Bitte versuche es später erneut.' })
      }
      // Eine unbrauchbare Adresse wird verworfen und nicht bemängelt: Sie ist
      // freiwillig, und die Meldung ist auch ohne sie etwas wert.
      const email = request.body.email?.trim()
      app.feedback.submit({
        text,
        email: email && EMAIL_PATTERN.test(email) ? email : null,
        userId: request.user?.id ?? null,
        context: cleanContext(request.body.context),
        source: request.body.source ?? 'web',
      })
      return reply.send({ ok: true })
    },
  )

  // — Verwaltung —

  app.get<{ Querystring: { status?: FeedbackStatus } }>(
    '/api/admin/feedback',
    async (request, reply) => {
      if (!requireAdmin(request, reply)) return
      const status = request.query.status
      return {
        feedback: app.feedback.list(status && STATUS.includes(status) ? { status } : undefined),
        counts: app.feedback.counts(),
      }
    },
  )

  app.patch<{
    Params: { id: string }
    Body: { status?: FeedbackStatus; note?: string | null }
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
      if (!requireAdmin(request, reply)) return
      const change: { status?: FeedbackStatus; note?: string | null } = {}
      if (request.body.status !== undefined) change.status = request.body.status
      if (request.body.note !== undefined) change.note = request.body.note
      const saved = app.feedback.update(request.params.id, change)
      if (!saved) return reply.code(404).send({ error: 'Diese Rückmeldung gibt es nicht.' })
      return reply.send({ feedback: saved })
    },
  )

  app.delete<{ Params: { id: string } }>('/api/admin/feedback/:id', async (request, reply) => {
    if (!requireAdmin(request, reply)) return
    if (!app.feedback.remove(request.params.id)) {
      return reply.code(404).send({ error: 'Diese Rückmeldung gibt es nicht.' })
    }
    return reply.send({ ok: true })
  })
}
