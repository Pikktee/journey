// Webhook-Empfang der Tracker-Anbieter.
//
// Diese Route läuft VOR jeder Anmeldeprüfung — sie hat keinen Benutzer. Ihre
// Autorität ist die SIGNATUR, und ihr einziger Schreibzugriff geht über die
// Anbieter-Nutzerkennung (`externer_nutzer`). Eine unsignierte Zustellung, die
// einen Import auslöst, wäre ein kostenloser Weg, fremde Konten mit Arbeit zu
// belasten.
//
// Registriert als eigener Plugin-Bereich (s. app.ts): Für die Signaturprüfung
// braucht es den ROHEN Body — die Signatur wird über die Bytes gebildet, und
// ein `JSON.parse` + `JSON.stringify` liefert nicht zwingend dieselben zurück
// (Schlüsselreihenfolge, Zahlenformat, Unicode-Escapes).

import type { FastifyInstance, FastifyRequest } from 'fastify'
import { runImports, type ImportJob } from '../tracker/import-run.js'
import type { WebhookRequest } from '../tracker/contract.js'

/** Fastify-Request → die anbieterneutrale Form aus dem Vertrag. */
function toWebhookRequest(request: FastifyRequest & { rawBody?: string }): WebhookRequest {
  return {
    rawBody: request.rawBody ?? '',
    headers: request.headers as Record<string, string | undefined>,
    query: (request.query ?? {}) as Record<string, string | undefined>,
  }
}

/**
 * Größte Zustellung, die hier angenommen wird.
 *
 * Der Bereich erbt sonst das globale Limit (64 MB, für Manifeste) — und dieser
 * Eingang ist der einzige OHNE Anmeldung: Bis die Signatur geprüft ist, hat der
 * Server den ganzen Body schon gepuffert und geparst, jeder Unbekannte könnte
 * also 64 MB je Anfrage binden. Echte Zustellungen sind ein paar hundert Byte;
 * 64 KB lassen jedem Anbieter Luft und nehmen dem Eingang die Hebelwirkung.
 */
const WEBHOOK_BODY_MAX = 64 * 1024

export async function registerTrackerWebhookRoutes(app: FastifyInstance): Promise<void> {
  // Eigener JSON-Parser NUR in diesem Bereich: Er hebt den rohen Text auf und
  // parst ihn zusätzlich. Global gesetzt hinge der rohe Body an jeder Route
  // (Manifeste sind mehrere MB).
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
    ;(request as FastifyRequest & { rawBody?: string }).rawBody = body as string
    try {
      done(null, body ? JSON.parse(body as string) : {})
    } catch (error) {
      done(error as Error, undefined)
    }
  })

  // Manche Anbieter prüfen ihr Abo mit einem GET (Strava: `hub.challenge`).
  app.get<{ Params: { provider: string } }>(
    '/api/webhooks/tracker/:provider',
    async (request, reply) => {
      const provider = app.trackerRegistry.get(request.params.provider)
      if (!provider?.webhook?.response) return reply.code(404).send({ error: 'Nicht gefunden' })
      return provider.webhook.response(toWebhookRequest(request))
    },
  )

  app.post<{ Params: { provider: string } }>(
    '/api/webhooks/tracker/:provider',
    {
      bodyLimit: WEBHOOK_BODY_MAX,
    },
    async (request, reply) => {
      const provider = app.trackerRegistry.get(request.params.provider)
      if (!provider?.webhook) return reply.code(404).send({ error: 'Nicht gefunden' })
      const webhookRequest = toWebhookRequest(request)

      // Der Erreichbarkeits-Test des Anbieters läuft VOR der Signaturprüfung und
      // ist der einzige Weg an ihr vorbei — notgedrungen: Polar schickt ihn beim
      // ANLEGEN des Webhooks, und der Signatur-Schlüssel entsteht erst als
      // Antwort auf genau diesen Aufruf. Ohne diesen Zweig scheiterte jede
      // Registrierung an der eigenen Prüfung („Ping failed, response was 401").
      // Ungefährlich, weil er nichts auslöst: 200, sonst nichts.
      if (provider.webhook.isPing?.(webhookRequest)) return reply.code(200).send({ ok: true })

      // Verifikation ZUERST — vor jedem Datenbankzugriff. Falsche Signatur:
      // 401, kein Eintrag, kein Log-Spam (sonst wäre schon das Protokoll ein
      // Ziel für Müll von außen).
      if (!(await provider.webhook.verify(webhookRequest))) {
        return reply.code(401).send({ error: 'Signatur ungültig' })
      }

      const events = provider.webhook.parseEvents(webhookRequest)
      const jobs: ImportJob[] = []
      for (const event of events) {
        const link = app.tracker.byExternalId(provider.id, event.externalUser)
        // Zustellung für ein Konto, das wir nicht (mehr) kennen: still
        // verwerfen. Eine Fehlermeldung wäre eine Auskunft darüber, welche
        // Anbieter-Konten bei uns liegen.
        if (!link) continue
        if (event.kind === 'abmeldung') {
          // Von außen abgemeldet (Strava sendet das ausdrücklich): sichtbar
          // machen statt still verstummen — der Nutzer wartet sonst auf
          // Touren, die nie kommen.
          app.tracker.setStatus(link.id, 'expired', 'Zugriff beim Anbieter widerrufen')
          continue
        }
        if (link.status !== 'active') continue
        jobs.push({ link, provider, externalId: event.externalId })
      }

      // ANTWORTEN, DANN ARBEITEN. Strava verlangt eine Antwort in unter zwei
      // Sekunden; ein Download plus Pipeline schafft das nie. Der Lauf landet in
      // `app.trackerLaeufe`, damit Tests gezielt darauf warten können, statt zu
      // pollen — dasselbe Muster wie `app.verarbeitungen`.
      if (jobs.length) {
        const key = `${provider.id}:${jobs.map((a) => a.externalId).join(',')}`
        app.trackerRuns.set(
          key,
          runImports(app, app.tracker, jobs).finally(() => app.trackerRuns.delete(key)),
        )
      }
      const response = provider.webhook.response?.(webhookRequest)
      return reply.code(200).send(response ?? { ok: true })
    },
  )
}
