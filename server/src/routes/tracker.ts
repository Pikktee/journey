// Nutzer-API der Tracker-Verknüpfungen: verbinden, trennen, Stand ansehen.
//
// **Die Pfade sind englisch**, anders als die Bezeichner im Server: Sie sind
// Außenfläche, und die Callback-URL brennt in der Registrierung beim Anbieter
// ein — ein späterer Umzug auf englische Pfade bräche alle Verknüpfungen.

import type { FastifyInstance } from 'fastify'
import { erfordereBenutzer } from '../app.js'
import { baueBremse } from '../bremse.js'
import { fuehreImporteAus } from '../tracker/importlauf.js'
import {
  ANBIETER_NAMEN,
  TokensUngueltigFehler,
  type TrackerAnbieter,
  type TrackerProvider,
} from '../tracker/vertrag.js'

/**
 * Wie viele Aktivitäten ein „Jetzt abrufen" abwartet, bevor der Rest in den
 * Hintergrund geht. Drei sind der Normalfall (ein paar Tage Rückstand); die
 * Nachhol-Fälle nach längerer Funkstille sollen die Anfrage nicht blockieren.
 */
const SYNC_SOFORT = 3

/** Die Adresse, an die der Anbieter zurückschickt — muss dort hinterlegt sein. */
export function rueckkehrUrl(basisUrl: string, anbieter: string): string {
  return `${basisUrl.replace(/\/$/, '')}/api/tracker/${anbieter}/callback`
}

const zielSchema = {
  type: 'object',
  additionalProperties: false,
  properties: { target: { enum: ['web', 'app'] } },
} as const

export function registriereTrackerRouten(app: FastifyInstance): void {
  const { konfig } = app.deps

  /** Ein Anbieter für die Oberfläche: was er ist, ob er kann, wie es steht. */
  const zeigeAnbieter = (
    provider: TrackerProvider,
    benutzerId: string | null,
  ): Record<string, unknown> => {
    const verknuepfung = benutzerId ? app.tracker.verknuepfung(benutzerId, provider.id) : null
    return {
      id: provider.id,
      name: ANBIETER_NAMEN[provider.id],
      // Ohne Zugangsdaten ODER ohne Token-Schlüssel kann niemand verbinden.
      // Beides zusammen, weil ein Anbieter mit Client-ID, aber ohne
      // Schlüssel Tokens im Klartext ablegen müsste — und das tun wir nicht.
      available: provider.konfiguriert && app.tracker.einsatzbereit,
      connected: verknuepfung?.status === 'active',
      status: verknuepfung?.status ?? null,
      connectedAt: verknuepfung?.connectedAt ?? null,
      lastSyncAt: verknuepfung?.lastSyncAt ?? null,
      error: verknuepfung?.lastError ?? null,
    }
  }

  // — Liste: welche Anbieter es gibt und wie es um sie steht —
  app.get('/api/tracker/providers', async (request, reply) => {
    const benutzer = erfordereBenutzer(request, reply)
    if (!benutzer) return
    return { providers: app.trackerRegistry.alle().map((p) => zeigeAnbieter(p, benutzer.id)) }
  })

  // — Verbinden: Autorisierungs-URL samt `state` ausgeben —
  app.post<{ Params: { provider: string }; Body: { target?: 'web' | 'app' } }>(
    '/api/tracker/:provider/connect',
    { schema: { body: zielSchema } },
    async (request, reply) => {
      const benutzer = erfordereBenutzer(request, reply)
      if (!benutzer) return
      const provider = app.trackerRegistry.hole(request.params.provider)
      if (!provider || !app.tracker.einsatzbereit) {
        return reply.code(404).send({ error: 'Anbieter nicht verfügbar' })
      }
      const redirectUri = rueckkehrUrl(konfig.basisUrl, provider.id)
      // Der `state` ist Pflicht und wird SERVERSEITIG gehalten: Ohne ihn ließe
      // sich einem Angemeldeten ein fremdes Anbieter-Konto unterschieben.
      const zustand = app.tracker.merkeZustand(
        benutzer.id,
        provider.id,
        request.body?.target ?? 'web',
        redirectUri,
      )
      return { authorizationUrl: provider.autorisierungsUrl(zustand, redirectUri) }
    },
  )

  // — Rückkehr vom Anbieter: Code tauschen, Verknüpfung anlegen —
  app.get<{
    Params: { provider: string }
    Querystring: { code?: string; state?: string; error?: string }
  }>('/api/tracker/:provider/callback', async (request, reply) => {
    const { code, state, error } = request.query
    const provider = app.trackerRegistry.hole(request.params.provider)
    // Abbruch beim Anbieter ist kein Fehlerfall, sondern eine Entscheidung —
    // zurück auf die Kontoseite, mit einem Wort dazu.
    if (error || !code || !state || !provider) {
      return reply.redirect(`${konfig.basisUrl}/konto#tracker=abgebrochen`)
    }
    const zustand = app.tracker.loeseZustandEin(state)
    if (!zustand || zustand.anbieter !== provider.id) {
      return reply.redirect(`${konfig.basisUrl}/konto#tracker=abgelaufen`)
    }
    try {
      let tokens = await provider.tauscheCode(code, zustand.redirectUri)
      // Pflichtschritte des Anbieters (Polar: `POST /v3/users`) — ohne sie
      // liefert die API still nichts, und der Fehler ist beim Debuggen ein
      // stilles Nichts. Was dabei herauskommt (die Nutzerkennung), ist der
      // Zuordnungsweg jedes späteren Webhooks.
      if (provider.nachVerknuepfung) tokens = (await provider.nachVerknuepfung(tokens)) || tokens
      app.tracker.verknuepfe(zustand.benutzerId, provider.id, tokens)
    } catch (fehler) {
      app.log.warn(
        `Tracker-Verknüpfung fehlgeschlagen (${provider.id}): ${(fehler as Error).message}`,
      )
      return reply.redirect(`${konfig.basisUrl}/konto#tracker=fehler`)
    }
    // Die App bekommt einen Deep Link zurück; im Web genügt die Kontoseite.
    return reply.redirect(
      zustand.ziel === 'app'
        ? `maptale://tracker/${provider.id}?ok=1`
        : `${konfig.basisUrl}/konto#tracker=verbunden`,
    )
  })

  // — Trennen —
  app.delete<{ Params: { provider: string } }>('/api/tracker/:provider', async (request, reply) => {
    const benutzer = erfordereBenutzer(request, reply)
    if (!benutzer) return
    const anbieter = request.params.provider as TrackerAnbieter
    const verknuepfung = app.tracker.verknuepfung(benutzer.id, anbieter)
    if (!verknuepfung) return reply.code(404).send({ error: 'Nicht verbunden' })
    const provider = app.trackerRegistry.hole(anbieter)
    // Beim Anbieter abmelden, BEVOR die Tokens verschwinden — danach hätten
    // wir nichts mehr, womit wir uns dort ausweisen könnten. Scheitert es
    // (Anbieter down), wird trotzdem lokal getrennt: Der Nutzer hat es
    // verlangt, und ein hängendes Abo ist besser als eine Verknüpfung, die
    // sich nicht lösen lässt.
    if (provider?.trenne) {
      try {
        await provider.trenne(app.tracker.tokens(verknuepfung.id))
      } catch (fehler) {
        app.log.warn(
          `Abmelden beim Anbieter fehlgeschlagen (${anbieter}): ${(fehler as Error).message}`,
        )
      }
    }
    app.tracker.trenne(benutzer.id, anbieter)
    // Die Touren bleiben — sie gehören dem Nutzer, nicht der Verknüpfung.
    return { ok: true, toursKept: true }
  })

  // — Manuell nachziehen (Polling-Anbieter, „hat nicht geklappt"-Knopf) —
  //
  // Ein Klick kostet einen Anbieter-Aufruf und je Aktivität einen vollen
  // Pipeline-Lauf (Geocoding, Wetter, Video) — dieselbe Sorte Last wie ein
  // Datenexport, und der hat aus demselben Grund eine Bremse.
  const syncGebremst = baueBremse(6, 10 * 60_000) // 6 pro 10 min je Konto
  app.post<{ Params: { provider: string } }>(
    '/api/tracker/:provider/sync',
    async (request, reply) => {
      const benutzer = erfordereBenutzer(request, reply)
      if (!benutzer) return
      if (syncGebremst(benutzer.id)) {
        return reply
          .code(429)
          .send({ error: 'Zu viele Abrufe. Versuch es in ein paar Minuten noch einmal.' })
      }
      const provider = app.trackerRegistry.hole(request.params.provider)
      const verknuepfung = provider ? app.tracker.verknuepfung(benutzer.id, provider.id) : null
      if (!provider || !verknuepfung) return reply.code(404).send({ error: 'Nicht verbunden' })
      if (!provider.listeNeue)
        return reply.code(409).send({ error: 'Dieser Anbieter meldet sich von selbst' })
      if (verknuepfung.status !== 'active') {
        return reply.code(409).send({ error: 'Verknüpfung ist nicht aktiv, bitte neu verbinden' })
      }

      // Abgelaufener Zugang und ein stummer Anbieter sind erwartete Zustände,
      // keine Serverstörungen: Ungefangen liefen beide in den allgemeinen
      // Handler und der Nutzer läse „Interner Fehler" statt dessen, was zu tun
      // ist. `TokensUngueltigFehler` hat die Verknüpfung dabei schon auf
      // `abgelaufen` gesetzt — die Oberfläche zeigt danach „neu verbinden".
      let ereignisse
      let tokens
      try {
        tokens = await app.tracker.gueltigeTokens(verknuepfung, provider)
        ereignisse = await provider.listeNeue(tokens, verknuepfung.lastSyncAt)
      } catch (fehler) {
        if (fehler instanceof TokensUngueltigFehler) {
          return reply.code(409).send({ error: 'Zugang abgelaufen, bitte neu verbinden' })
        }
        app.log.warn(`Tracker-Abruf fehlgeschlagen (${provider.id}): ${(fehler as Error).message}`)
        return reply
          .code(502)
          .send({ error: 'Der Anbieter antwortet gerade nicht. Später noch einmal versuchen.' })
      }

      const auftraege = ereignisse
        .filter((e) => e.art === 'aktivitaet')
        .map((e) => ({ verknuepfung, provider, externeId: e.externeId }))
      // Anders als beim Webhook wird hier GEWARTET: Wer den Knopf drückt, will
      // das Ergebnis sehen. Aber nur auf die ersten paar — nach einer Woche
      // Funkstille kämen zwanzig Aktivitäten, und die Anfrage stünde minutenlang
      // offen, bis der Reverse-Proxy sie abschneidet (der Lauf ginge weiter, der
      // Nutzer sähe 504). Der Rest läuft im Hintergrund weiter, wie beim Webhook.
      const sofort = auftraege.slice(0, SYNC_SOFORT)
      const rest = auftraege.slice(SYNC_SOFORT)
      const ergebnisse = await fuehreImporteAus(app, app.tracker, sofort)
      if (rest.length) {
        const schluessel = `sync:${verknuepfung.id}`
        app.trackerLaeufe.set(
          schluessel,
          fuehreImporteAus(app, app.tracker, rest).finally(() =>
            app.trackerLaeufe.delete(schluessel),
          ),
        )
      }
      // Der Sync-Zeitpunkt kommt aus `fuehreImporteAus` (nur wenn nichts offen
      // blieb — er ist der Cursor des nächsten Abrufs). Ohne Aufträge gibt es
      // dort nichts zu entscheiden, und „nichts Neues" ist ein Erfolg.
      if (!auftraege.length) app.tracker.merkeSync(verknuepfung.id)
      return { found: auftraege.length, new: ergebnisse.length, inBackground: rest.length }
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
    const benutzer = erfordereBenutzer(request, reply)
    if (!benutzer) return
    return { imports: app.tracker.chronik(benutzer.id) }
  })

  // — Was der Client noch nicht gesehen hat (Grundlage der Benachrichtigung) —
  app.get<{ Querystring: { seen?: string } }>(
    '/api/tracker/imports/pending',
    async (request, reply) => {
      const benutzer = erfordereBenutzer(request, reply)
      if (!benutzer) return
      const offen = app.tracker.offeneImporte(benutzer.id)
      // Erst mit `?seen=1` gelten sie als abgeholt. Ohne diesen Schritt
      // verschwände eine Meldung schon dadurch, dass ein Hintergrundlauf sie
      // gelesen hat — der Nutzer hätte sie nie zu Gesicht bekommen.
      //
      // Wer wirklich sicher gehen will, quittiert HINTERHER und namentlich
      // (POST …/seen): `?seen=1` quittiert alles, was gerade offen ist —
      // auch das, was der Aufrufer am Ende gar nicht anzeigt.
      if (request.query.seen === '1')
        app.tracker.markiereGesehen(
          benutzer.id,
          offen.map((i) => i.id),
        )
      return { imports: offen }
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
      const benutzer = erfordereBenutzer(request, reply)
      if (!benutzer) return
      // `markiereGesehen` filtert selbst auf das eigene Konto — fremde IDs
      // laufen ins Leere, statt eine Auskunft darüber zu geben, dass es sie gibt.
      app.tracker.markiereGesehen(benutzer.id, request.body.ids)
      return { ok: true }
    },
  )
}
