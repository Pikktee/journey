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
import { fuehreImporteAus, type ImportAuftrag } from '../tracker/importlauf.js'
import type { WebhookAnfrage } from '../tracker/vertrag.js'

/** Fastify-Request → die anbieterneutrale Form aus dem Vertrag. */
function zuAnfrage(request: FastifyRequest & { rohBody?: string }): WebhookAnfrage {
  return {
    rohBody: request.rohBody ?? '',
    kopfzeilen: request.headers as Record<string, string | undefined>,
    query: (request.query ?? {}) as Record<string, string | undefined>,
  }
}

export async function registriereTrackerWebhookRouten(app: FastifyInstance): Promise<void> {
  // Eigener JSON-Parser NUR in diesem Bereich: Er hebt den rohen Text auf und
  // parst ihn zusätzlich. Global gesetzt hinge der rohe Body an jeder Route
  // (Manifeste sind mehrere MB).
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, fertig) => {
    ;(request as FastifyRequest & { rohBody?: string }).rohBody = body as string
    try {
      fertig(null, body ? JSON.parse(body as string) : {})
    } catch (fehler) {
      fertig(fehler as Error, undefined)
    }
  })

  // Manche Anbieter prüfen ihr Abo mit einem GET (Strava: `hub.challenge`).
  app.get<{ Params: { provider: string } }>('/api/webhooks/tracker/:provider', async (request, reply) => {
    const provider = app.trackerRegistry.hole(request.params.provider)
    if (!provider?.webhook?.antwort) return reply.code(404).send({ fehler: 'Nicht gefunden' })
    return provider.webhook.antwort(zuAnfrage(request))
  })

  app.post<{ Params: { provider: string } }>('/api/webhooks/tracker/:provider', async (request, reply) => {
    const provider = app.trackerRegistry.hole(request.params.provider)
    if (!provider?.webhook) return reply.code(404).send({ fehler: 'Nicht gefunden' })
    const anfrage = zuAnfrage(request)

    // Der Erreichbarkeits-Test des Anbieters läuft VOR der Signaturprüfung und
    // ist der einzige Weg an ihr vorbei — notgedrungen: Polar schickt ihn beim
    // ANLEGEN des Webhooks, und der Signatur-Schlüssel entsteht erst als
    // Antwort auf genau diesen Aufruf. Ohne diesen Zweig scheiterte jede
    // Registrierung an der eigenen Prüfung („Ping failed, response was 401").
    // Ungefährlich, weil er nichts auslöst: 200, sonst nichts.
    if (provider.webhook.istPing?.(anfrage)) return reply.code(200).send({ ok: true })

    // Verifikation ZUERST — vor jedem Datenbankzugriff. Falsche Signatur:
    // 401, kein Eintrag, kein Log-Spam (sonst wäre schon das Protokoll ein
    // Ziel für Müll von außen).
    if (!(await provider.webhook.verifiziere(anfrage))) {
      return reply.code(401).send({ fehler: 'Signatur ungültig' })
    }

    const ereignisse = provider.webhook.parseEreignisse(anfrage)
    const auftraege: ImportAuftrag[] = []
    for (const ereignis of ereignisse) {
      const verknuepfung = app.tracker.ausExternerKennung(provider.id, ereignis.externerNutzer)
      // Zustellung für ein Konto, das wir nicht (mehr) kennen: still
      // verwerfen. Eine Fehlermeldung wäre eine Auskunft darüber, welche
      // Anbieter-Konten bei uns liegen.
      if (!verknuepfung) continue
      if (ereignis.art === 'abmeldung') {
        // Von außen abgemeldet (Strava sendet das ausdrücklich): sichtbar
        // machen statt still verstummen — der Nutzer wartet sonst auf
        // Touren, die nie kommen.
        app.tracker.setzeStatus(verknuepfung.id, 'abgelaufen', 'Zugriff beim Anbieter widerrufen')
        continue
      }
      if (verknuepfung.status !== 'aktiv') continue
      auftraege.push({ verknuepfung, provider, externeId: ereignis.externeId })
    }

    // ANTWORTEN, DANN ARBEITEN. Strava verlangt eine Antwort in unter zwei
    // Sekunden; ein Download plus Pipeline schafft das nie. Der Lauf landet in
    // `app.trackerLaeufe`, damit Tests gezielt darauf warten können, statt zu
    // pollen — dasselbe Muster wie `app.verarbeitungen`.
    if (auftraege.length) {
      const schluessel = `${provider.id}:${auftraege.map((a) => a.externeId).join(',')}`
      app.trackerLaeufe.set(
        schluessel,
        fuehreImporteAus(app, app.tracker, auftraege).finally(() => app.trackerLaeufe.delete(schluessel)),
      )
    }
    const antwort = provider.webhook.antwort?.(anfrage)
    return reply.code(200).send(antwort ?? { ok: true })
  })
}
