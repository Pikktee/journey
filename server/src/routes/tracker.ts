// Nutzer-API der Tracker-Verknüpfungen: verbinden, trennen, Stand ansehen.
//
// **Die Pfade sind englisch**, anders als die Bezeichner im Server: Sie sind
// Außenfläche, und die Callback-URL brennt in der Registrierung beim Anbieter
// ein — ein späterer Umzug auf englische Pfade bräche alle Verknüpfungen.

import type { FastifyInstance } from 'fastify'
import { erfordereBenutzer } from '../app.js'
import { fuehreImporteAus } from '../tracker/importlauf.js'
import { ANBIETER_NAMEN, type TrackerAnbieter, type TrackerProvider } from '../tracker/vertrag.js'

/** Die Adresse, an die der Anbieter zurückschickt — muss dort hinterlegt sein. */
export function rueckkehrUrl(basisUrl: string, anbieter: string): string {
  return `${basisUrl.replace(/\/$/, '')}/api/tracker/${anbieter}/callback`
}

const zielSchema = {
  type: 'object',
  additionalProperties: false,
  properties: { ziel: { enum: ['web', 'app'] } },
} as const

export function registriereTrackerRouten(app: FastifyInstance): void {
  const { konfig } = app.deps

  /** Ein Anbieter für die Oberfläche: was er ist, ob er kann, wie es steht. */
  const zeigeAnbieter = (provider: TrackerProvider, benutzerId: string | null): Record<string, unknown> => {
    const verknuepfung = benutzerId ? app.tracker.verknuepfung(benutzerId, provider.id) : null
    return {
      id: provider.id,
      name: ANBIETER_NAMEN[provider.id],
      // Ohne Zugangsdaten ODER ohne Token-Schlüssel kann niemand verbinden.
      // Beides zusammen, weil ein Anbieter mit Client-ID, aber ohne
      // Schlüssel Tokens im Klartext ablegen müsste — und das tun wir nicht.
      verfuegbar: provider.konfiguriert && app.tracker.einsatzbereit,
      verbunden: verknuepfung?.status === 'aktiv',
      status: verknuepfung?.status ?? null,
      verbundenSeit: verknuepfung?.verbundenAm ?? null,
      zuletztSync: verknuepfung?.zuletztSyncAm ?? null,
      fehler: verknuepfung?.letzterFehler ?? null,
    }
  }

  // — Liste: welche Anbieter es gibt und wie es um sie steht —
  app.get('/api/tracker/providers', async (request, reply) => {
    const benutzer = erfordereBenutzer(request, reply)
    if (!benutzer) return
    return { anbieter: app.trackerRegistry.alle().map((p) => zeigeAnbieter(p, benutzer.id)) }
  })

  // — Verbinden: Autorisierungs-URL samt `state` ausgeben —
  app.post<{ Params: { provider: string }; Body: { ziel?: 'web' | 'app' } }>(
    '/api/tracker/:provider/connect',
    { schema: { body: zielSchema } },
    async (request, reply) => {
      const benutzer = erfordereBenutzer(request, reply)
      if (!benutzer) return
      const provider = app.trackerRegistry.hole(request.params.provider)
      if (!provider || !app.tracker.einsatzbereit) {
        return reply.code(404).send({ fehler: 'Anbieter nicht verfügbar' })
      }
      const redirectUri = rueckkehrUrl(konfig.basisUrl, provider.id)
      // Der `state` ist Pflicht und wird SERVERSEITIG gehalten: Ohne ihn ließe
      // sich einem Angemeldeten ein fremdes Anbieter-Konto unterschieben.
      const zustand = app.tracker.merkeZustand(benutzer.id, provider.id, request.body?.ziel ?? 'web', redirectUri)
      return { autorisierungsUrl: provider.autorisierungsUrl(zustand, redirectUri) }
    },
  )

  // — Rückkehr vom Anbieter: Code tauschen, Verknüpfung anlegen —
  app.get<{ Params: { provider: string }; Querystring: { code?: string; state?: string; error?: string } }>(
    '/api/tracker/:provider/callback',
    async (request, reply) => {
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
        app.log.warn(`Tracker-Verknüpfung fehlgeschlagen (${provider.id}): ${(fehler as Error).message}`)
        return reply.redirect(`${konfig.basisUrl}/konto#tracker=fehler`)
      }
      // Die App bekommt einen Deep Link zurück; im Web genügt die Kontoseite.
      return reply.redirect(
        zustand.ziel === 'app' ? `maptale://tracker/${provider.id}?ok=1` : `${konfig.basisUrl}/konto#tracker=verbunden`,
      )
    },
  )

  // — Trennen —
  app.delete<{ Params: { provider: string } }>('/api/tracker/:provider', async (request, reply) => {
    const benutzer = erfordereBenutzer(request, reply)
    if (!benutzer) return
    const anbieter = request.params.provider as TrackerAnbieter
    const verknuepfung = app.tracker.verknuepfung(benutzer.id, anbieter)
    if (!verknuepfung) return reply.code(404).send({ fehler: 'Nicht verbunden' })
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
        app.log.warn(`Abmelden beim Anbieter fehlgeschlagen (${anbieter}): ${(fehler as Error).message}`)
      }
    }
    app.tracker.trenne(benutzer.id, anbieter)
    // Die Touren bleiben — sie gehören dem Nutzer, nicht der Verknüpfung.
    return { ok: true, tourenBleiben: true }
  })

  // — Manuell nachziehen (Polling-Anbieter, „hat nicht geklappt"-Knopf) —
  app.post<{ Params: { provider: string } }>('/api/tracker/:provider/sync', async (request, reply) => {
    const benutzer = erfordereBenutzer(request, reply)
    if (!benutzer) return
    const provider = app.trackerRegistry.hole(request.params.provider)
    const verknuepfung = provider ? app.tracker.verknuepfung(benutzer.id, provider.id) : null
    if (!provider || !verknuepfung) return reply.code(404).send({ fehler: 'Nicht verbunden' })
    if (!provider.listeNeue) return reply.code(409).send({ fehler: 'Dieser Anbieter meldet sich von selbst' })
    if (verknuepfung.status !== 'aktiv') {
      return reply.code(409).send({ fehler: 'Verknüpfung ist nicht aktiv, bitte neu verbinden' })
    }

    const tokens = await app.tracker.gueltigeTokens(verknuepfung, provider)
    const ereignisse = await provider.listeNeue(tokens, verknuepfung.zuletztSyncAm)
    const auftraege = ereignisse
      .filter((e) => e.art === 'aktivitaet')
      .map((e) => ({ verknuepfung, provider, externeId: e.externeId }))
    // Anders als beim Webhook wird hier GEWARTET: Wer den Knopf drückt, will
    // das Ergebnis sehen — und die Zahl der Aktivitäten ist begrenzt.
    const ergebnisse = await fuehreImporteAus(app, app.tracker, auftraege)
    app.tracker.merkeSync(verknuepfung.id)
    return { gefunden: auftraege.length, neu: ergebnisse.length }
  })

  // — Importe: die Liste im Konto —
  app.get('/api/tracker/imports', async (request, reply) => {
    const benutzer = erfordereBenutzer(request, reply)
    if (!benutzer) return
    return { importe: app.tracker.importe(benutzer.id) }
  })

  // — Was der Client noch nicht gesehen hat (Grundlage der Benachrichtigung) —
  app.get<{ Querystring: { gesehen?: string } }>('/api/tracker/imports/pending', async (request, reply) => {
    const benutzer = erfordereBenutzer(request, reply)
    if (!benutzer) return
    const offen = app.tracker.offeneImporte(benutzer.id)
    // Erst mit `?gesehen=1` gelten sie als abgeholt. Ohne diesen Schritt
    // verschwände eine Meldung schon dadurch, dass ein Hintergrundlauf sie
    // gelesen hat — der Nutzer hätte sie nie zu Gesicht bekommen.
    if (request.query.gesehen === '1') app.tracker.markiereGesehen(benutzer.id, offen.map((i) => i.id))
    return { importe: offen }
  })
}
