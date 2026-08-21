// Nutzer-API der Tracker-Verknüpfungen: verbinden, trennen, Stand ansehen.
//
// **Die Pfade sind englisch**, anders als die Bezeichner im Server: Sie sind
// Außenfläche, und die Callback-URL brennt in der Registrierung beim Anbieter
// ein — ein späterer Umzug auf englische Pfade bräche alle Verknüpfungen.

import type { FastifyInstance } from 'fastify'
import { requireUser } from '../app.js'
import { buildRateLimit } from '../rate-limit.js'
import { WEB_PATHS } from '../web-paths.js'
import { runImports } from '../tracker/import-run.js'
import {
  PROVIDER_NAMES,
  InvalidTokensError,
  type TrackerProviderId,
  type TrackerProvider,
} from '../tracker/contract.js'

/**
 * Wie viele Aktivitäten ein „Jetzt abrufen" abwartet, bevor der Rest in den
 * Hintergrund geht. Drei sind der Normalfall (ein paar Tage Rückstand); die
 * Nachhol-Fälle nach längerer Funkstille sollen die Anfrage nicht blockieren.
 */
const SYNC_IMMEDIATE = 3

/** Die Adresse, an die der Anbieter zurückschickt — muss dort hinterlegt sein. */
export function returnUrl(baseUrl: string, providerId: string): string {
  return `${baseUrl.replace(/\/$/, '')}/api/tracker/${providerId}/callback`
}

const targetSchema = {
  type: 'object',
  additionalProperties: false,
  properties: { target: { enum: ['web', 'app'] } },
} as const

/**
 * Der Weg zurück auf die Kontoseite, mit einem Wort über den Ausgang im Hash.
 *
 * `webUrl` und NICHT `baseUrl`: Die Kontoseite ist eine Seite des Web, der
 * Callback aber eine Route der API. Live sind das dieselbe Adresse und der
 * Unterschied kostet nichts; lokal liegt das Web auf dem Vite-Port und die API
 * auf ihrem eigenen — dort landete jede Rückkehr vom Anbieter im 404 der API,
 * und zwar NACH der erfolgreichen Verknüpfung. Der Pfad kommt aus `WEB_PATHS`,
 * damit er nicht die vierte handgeschriebene Kopie von `/konto` ist.
 */
function accountReturn(webUrl: string, outcome: string): string {
  return `${webUrl.replace(/\/+$/, '')}${WEB_PATHS.account}#tracker=${outcome}`
}

export function registerTrackerRoutes(app: FastifyInstance): void {
  const { config } = app.deps

  /** Ein Anbieter für die Oberfläche: was er ist, ob er kann, wie es steht. */
  const describeProvider = (
    provider: TrackerProvider,
    userId: string | null,
  ): Record<string, unknown> => {
    const link = userId ? app.tracker.linkOf(userId, provider.id) : null
    return {
      id: provider.id,
      name: PROVIDER_NAMES[provider.id],
      // Ohne Zugangsdaten ODER ohne Token-Schlüssel kann niemand verbinden.
      // Beides zusammen, weil ein Anbieter mit Client-ID, aber ohne
      // Schlüssel Tokens im Klartext ablegen müsste — und das tun wir nicht.
      available: provider.configured && app.tracker.einsatzbereit,
      connected: link?.status === 'active',
      status: link?.status ?? null,
      connectedAt: link?.connectedAt ?? null,
      lastSyncAt: link?.lastSyncAt ?? null,
      error: link?.lastError ?? null,
    }
  }

  // — Liste: welche Anbieter es gibt und wie es um sie steht —
  app.get('/api/tracker/providers', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) return
    return { providers: app.trackerRegistry.all().map((p) => describeProvider(p, user.id)) }
  })

  // — Verbinden: Autorisierungs-URL samt `state` ausgeben —
  app.post<{ Params: { provider: string }; Body: { target?: 'web' | 'app' } }>(
    '/api/tracker/:provider/connect',
    { schema: { body: targetSchema } },
    async (request, reply) => {
      const user = requireUser(request, reply)
      if (!user) return
      const provider = app.trackerRegistry.get(request.params.provider)
      if (!provider || !app.tracker.einsatzbereit) {
        return reply.code(404).send({ error: 'Anbieter nicht verfügbar' })
      }
      const redirectUri = returnUrl(config.baseUrl, provider.id)
      // Der `state` ist Pflicht und wird SERVERSEITIG gehalten: Ohne ihn ließe
      // sich einem Angemeldeten ein fremdes Anbieter-Konto unterschieben.
      const state = app.tracker.rememberState(
        user.id,
        provider.id,
        request.body?.target ?? 'web',
        redirectUri,
      )
      return { authorizationUrl: provider.authorizationUrl(state, redirectUri) }
    },
  )

  // — Rückkehr vom Anbieter: Code tauschen, Verknüpfung anlegen —
  app.get<{
    Params: { provider: string }
    Querystring: { code?: string; state?: string; error?: string }
  }>('/api/tracker/:provider/callback', async (request, reply) => {
    const { code, state, error } = request.query
    const provider = app.trackerRegistry.get(request.params.provider)
    // Abbruch beim Anbieter ist kein Fehlerfall, sondern eine Entscheidung —
    // zurück auf die Kontoseite, mit einem Wort dazu.
    if (error || !code || !state || !provider) {
      return reply.redirect(accountReturn(config.webUrl, 'abgebrochen'))
    }
    const entry = app.tracker.redeemState(state)
    if (!entry || entry.provider !== provider.id) {
      return reply.redirect(accountReturn(config.webUrl, 'abgelaufen'))
    }
    try {
      let tokens = await provider.exchangeCode(code, entry.redirectUri)
      // Pflichtschritte des Anbieters (Polar: `POST /v3/users`) — ohne sie
      // liefert die API still nichts, und der Fehler ist beim Debuggen ein
      // stilles Nichts. Was dabei herauskommt (die Nutzerkennung), ist der
      // Zuordnungsweg jedes späteren Webhooks.
      if (provider.afterLink) tokens = (await provider.afterLink(tokens)) || tokens
      app.tracker.link(entry.userId, provider.id, tokens)
    } catch (error) {
      app.log.warn(
        `Tracker-Verknüpfung fehlgeschlagen (${provider.id}): ${(error as Error).message}`,
      )
      return reply.redirect(accountReturn(config.webUrl, 'fehler'))
    }
    // Die App bekommt einen Deep Link zurück; im Web genügt die Kontoseite.
    return reply.redirect(
      entry.target === 'app'
        ? `maptale://tracker/${provider.id}?ok=1`
        : accountReturn(config.webUrl, 'verbunden'),
    )
  })

  // — Trennen —
  app.delete<{ Params: { provider: string } }>('/api/tracker/:provider', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) return
    const providerId = request.params.provider as TrackerProviderId
    const link = app.tracker.linkOf(user.id, providerId)
    if (!link) return reply.code(404).send({ error: 'Nicht verbunden' })
    const provider = app.trackerRegistry.get(providerId)
    // Beim Anbieter abmelden, BEVOR die Tokens verschwinden — danach hätten
    // wir nichts mehr, womit wir uns dort ausweisen könnten. Scheitert es
    // (Anbieter down), wird trotzdem lokal getrennt: Der Nutzer hat es
    // verlangt, und ein hängendes Abo ist besser als eine Verknüpfung, die
    // sich nicht lösen lässt.
    if (provider?.unlink) {
      try {
        await provider.unlink(app.tracker.tokens(link.id))
      } catch (error) {
        app.log.warn(
          `Abmelden beim Anbieter fehlgeschlagen (${providerId}): ${(error as Error).message}`,
        )
      }
    }
    app.tracker.unlink(user.id, providerId)
    // Die Touren bleiben — sie gehören dem Nutzer, nicht der Verknüpfung.
    return { ok: true, toursKept: true }
  })

  // — Manuell nachziehen (Polling-Anbieter, „hat nicht geklappt"-Knopf) —
  //
  // Ein Klick kostet einen Anbieter-Aufruf und je Aktivität einen vollen
  // Pipeline-Lauf (Geocoding, Wetter, Video) — dieselbe Sorte Last wie ein
  // Datenexport, und der hat aus demselben Grund eine Bremse.
  const syncLimited = buildRateLimit(6, 10 * 60_000) // 6 pro 10 min je Konto
  app.post<{ Params: { provider: string } }>(
    '/api/tracker/:provider/sync',
    async (request, reply) => {
      const user = requireUser(request, reply)
      if (!user) return
      if (syncLimited(user.id)) {
        return reply
          .code(429)
          .send({ error: 'Zu viele Abrufe. Versuch es in ein paar Minuten noch einmal.' })
      }
      const provider = app.trackerRegistry.get(request.params.provider)
      const link = provider ? app.tracker.linkOf(user.id, provider.id) : null
      if (!provider || !link) return reply.code(404).send({ error: 'Nicht verbunden' })
      if (!provider.listNew)
        return reply.code(409).send({ error: 'Dieser Anbieter meldet sich von selbst' })
      if (link.status !== 'active') {
        return reply.code(409).send({ error: 'Verknüpfung ist nicht aktiv, bitte neu verbinden' })
      }

      // Abgelaufener Zugang und ein stummer Anbieter sind erwartete Zustände,
      // keine Serverstörungen: Ungefangen liefen beide in den allgemeinen
      // Handler und der Nutzer läse „Interner Fehler" statt dessen, was zu tun
      // ist. `InvalidTokensError` hat die Verknüpfung dabei schon auf
      // `abgelaufen` gesetzt — die Oberfläche zeigt danach „neu verbinden".
      let events
      let tokens
      try {
        tokens = await app.tracker.validTokens(link, provider)
        events = await provider.listNew(tokens, link.lastSyncAt)
      } catch (error) {
        if (error instanceof InvalidTokensError) {
          return reply.code(409).send({ error: 'Zugang abgelaufen, bitte neu verbinden' })
        }
        app.log.warn(`Tracker-Abruf fehlgeschlagen (${provider.id}): ${(error as Error).message}`)
        return reply
          .code(502)
          .send({ error: 'Der Anbieter antwortet gerade nicht. Später noch einmal versuchen.' })
      }

      const jobs = events
        .filter((e) => e.kind === 'aktivitaet')
        .map((e) => ({ link, provider, externalId: e.externalId }))
      // Anders als beim Webhook wird hier GEWARTET: Wer den Knopf drückt, will
      // das Ergebnis sehen. Aber nur auf die ersten paar — nach einer Woche
      // Funkstille kämen zwanzig Aktivitäten, und die Anfrage stünde minutenlang
      // offen, bis der Reverse-Proxy sie abschneidet (der Lauf ginge weiter, der
      // Nutzer sähe 504). Der Rest läuft im Hintergrund weiter, wie beim Webhook.
      const immediate = jobs.slice(0, SYNC_IMMEDIATE)
      const rest = jobs.slice(SYNC_IMMEDIATE)
      const results = await runImports(app, app.tracker, immediate)
      if (rest.length) {
        const key = `sync:${link.id}`
        app.trackerRuns.set(
          key,
          runImports(app, app.tracker, rest).finally(() => app.trackerRuns.delete(key)),
        )
      }
      // Der Sync-Zeitpunkt kommt aus `runImports` (nur wenn nichts offen
      // blieb — er ist der Cursor des nächsten Abrufs). Ohne Aufträge gibt es
      // dort nichts zu entscheiden, und „nichts Neues" ist ein Erfolg.
      if (!jobs.length) app.tracker.noteSync(link.id)
      return { found: jobs.length, new: results.length, inBackground: rest.length }
    },
  )

  // — Importe: die Chronik im Konto —
  //
  // Mit der Tour daran (Titel, Länge, Aufnahmen): „Als Tour angelegt" plus
  // Datum war wahr und trotzdem nutzlos — welche Fahrt gemeint war, ließ sich
  // daraus nicht sagen. Die Liste ist länger als die frühere Zehnerauswahl,
  // weil sie im Dialog vollständig gezeigt wird; die Seite schneidet für ihre
  // Vorschau selbst zu.
  app.get('/api/tracker/imports', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) return
    return { imports: app.tracker.history(user.id) }
  })

  // — Was der Client noch nicht gesehen hat (Grundlage der Benachrichtigung) —
  app.get<{ Querystring: { seen?: string } }>(
    '/api/tracker/imports/pending',
    async (request, reply) => {
      const user = requireUser(request, reply)
      if (!user) return
      const pending = app.tracker.pendingImports(user.id)
      // Erst mit `?seen=1` gelten sie als abgeholt. Ohne diesen Schritt
      // verschwände eine Meldung schon dadurch, dass ein Hintergrundlauf sie
      // gelesen hat — der Nutzer hätte sie nie zu Gesicht bekommen.
      //
      // Wer wirklich sicher gehen will, quittiert HINTERHER und namentlich
      // (POST …/seen): `?seen=1` quittiert alles, was gerade offen ist —
      // auch das, was der Aufrufer am Ende gar nicht anzeigt.
      if (request.query.seen === '1')
        app.tracker.markSeen(
          user.id,
          pending.map((i) => i.id),
        )
      return { imports: pending }
    },
  )

  // — Gezielt quittieren: genau das, was auch angezeigt wurde —
  //
  // Der Weg für Clients, die erst melden und dann abhaken (die App): Holen
  // ohne `?seen=1`, Meldung zeigen, DIESE IDs quittieren. Was nicht
  // ankam — weil die Benachrichtigung nicht gezeigt werden durfte oder der
  // Lauf abbrach —, bleibt offen und kommt beim nächsten Mal wieder.
  app.post<{ Body: { ids: string[] } }>(
    '/api/tracker/imports/seen',
    {
      schema: {
        body: {
          type: 'object',
          required: ['ids'],
          additionalProperties: false,
          properties: {
            ids: { type: 'array', maxItems: 200, items: { type: 'string', maxLength: 64 } },
          },
        },
      },
    },
    async (request, reply) => {
      const user = requireUser(request, reply)
      if (!user) return
      // `markiereGesehen` filtert selbst auf das eigene Konto — fremde IDs
      // laufen ins Leere, statt eine Auskunft darüber zu geben, dass es sie gibt.
      app.tracker.markSeen(user.id, request.body.ids)
      return { ok: true }
    },
  )
}
