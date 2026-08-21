// Die Hintergrundarbeit nach einer Webhook-Zustellung: Track holen →
// normalisieren → Tour anlegen → finalisieren.
//
// **Webhooks antworten sofort.** Strava verlangt eine Antwort in unter zwei
// Sekunden, und einen Download plus Pipeline schafft das niemand in dieser
// Zeit. Muster ist der Datenexport: Route antwortet 200, Arbeit läuft danach.
// Wie bei `app.verarbeitungen` wird der laufende Import in einer Map gehalten,
// damit Tests gezielt darauf warten können, statt zu pollen.

import type { FastifyInstance } from 'fastify'
import { QuotaError, createTourFromTrack } from './tour-creator.js'
import { MAX_ATTEMPTS, type ImportRow, type TrackerService, type TrackerLink } from './tracker.js'
import {
  NoRouteError,
  InvalidTokensError,
  TooSmallError,
  type TrackerProvider,
} from './contract.js'

/**
 * Fehler, die eine Aktivität ÜBERSPRINGEN statt scheitern lassen.
 *
 * Der Unterschied ist keine Kosmetik: Ein Vielsportler meldet jede Woche
 * Hallentrainings ohne GPS. Als Fehler geführt, stünde seine Liste dauerhaft
 * rot, und die eine echte Störung ginge darin unter.
 */
function isSkipped(error: unknown): boolean {
  return (
    error instanceof NoRouteError || error instanceof TooSmallError || error instanceof QuotaError
  )
}

/**
 * Hätte ein neuer Anlauf Sinn?
 *
 * Das ist eine Frage an den GRUND, nicht an den Status. „Ohne Route" und „zu
 * kurz" sind Aussagen über die Aktivität — die bleiben wahr, so oft man es
 * auch versucht. Alles andere ist eine Aussage über den Moment: ein voller
 * Speicher, den jemand aufräumt, ein Anbieter, der gerade nicht antwortet,
 * ein Netzaussetzer. Genau diese Fälle brachte die erste Fassung um: Die Zeile
 * blieb als `fehler` stehen, und jede weitere Zustellung lief wirkungslos in
 * den Dedup-Index.
 */
function isRetryable(error: unknown): boolean {
  return !(error instanceof NoRouteError || error instanceof TooSmallError)
}

export interface ImportJob {
  link: TrackerLink
  provider: TrackerProvider
  externalId: string
}

/**
 * Einen einzelnen Import ausführen. Wirft NICHT — jedes Ergebnis landet als
 * Status am Import, damit es im Konto sichtbar ist statt im Log-Nirvana.
 */
export async function runImport(
  app: FastifyInstance,
  service: TrackerService,
  job: ImportJob,
): Promise<ImportRow | null> {
  const { link, provider, externalId } = job
  // Der erste Dedup-Riegel. Der zweite ist `client_tour_id` beim Anlegen —
  // keiner davon ist der einzige, weil beide unterschiedliche Wege abdecken:
  // dieser die wiederholte Zustellung, jener den parallelen Anlege-Versuch.
  const importRow = service.claim(link.userId, link.provider, externalId)
  if (!importRow) return null

  let finishedTour: string | null = null
  try {
    const tokens = await service.validTokens(link, provider)
    const track = await provider.fetchTrack(tokens, externalId)
    const { tourId } = await createTourFromTrack(app, link.userId, {
      providerOf: link.provider,
      externalId,
      track,
    })
    service.finishImport(importRow.id, 'done', tourId)
    finishedTour = tourId
  } catch (error) {
    const message = (error as Error).message
    // Am Deckel ist Schluss. Das steht NICHT im Fehlertext, sondern in den
    // Feldern (`retryable` + `attempts`): Die Oberfläche formuliert daraus
    // „wird noch einmal versucht" oder „aufgegeben nach 3 Versuchen" — in den
    // Text geschrieben stünde es dort ein zweites Mal.
    const retryable = isRetryable(error) && importRow.attempts < MAX_ATTEMPTS
    if (isSkipped(error)) {
      service.finishImport(importRow.id, 'skipped', null, message, retryable)
    } else {
      service.finishImport(importRow.id, 'failed', null, message, retryable)
      // Eine tote Verknüpfung muss SICHTBAR tot sein: Der Nutzer wartet sonst
      // auf Touren, die nie kommen.
      if (error instanceof InvalidTokensError) {
        service.setStatus(link.id, 'expired', 'Zugang abgelaufen, bitte neu verbinden')
      } else {
        app.log.warn(`Tracker-Import fehlgeschlagen (${link.provider}/${externalId}): ${message}`)
      }
    }
  }
  // Gemeldet wird NUR das Fertige — und zwar AUSSERHALB des try: Ein Fehler
  // beim Benachrichtigen darf einen gelungenen Import nicht nachträglich zum
  // Fehlschlag machen (der stünde dann als „fehler" in der Liste, obwohl die
  // Tour spielbar im Konto liegt). Eine übersprungene Halleneinheit und ein
  // Fehler, den niemand beheben kann, sind kein Ereignis für den
  // Sperrbildschirm; beide stehen in der Liste im Konto.
  //
  // Gewartet wird trotzdem, damit Tests dem Lauf folgen können, statt auf eine
  // offene Zusage zu pollen. `melde` wirft selbst nicht.
  if (finishedTour) {
    await app.push.notify(link.userId, {
      type: 'import-finished',
      tourId: finishedTour,
      importId: importRow.id,
    })
  }
  return service.importRow(importRow.id)
}

/**
 * Mehrere Importe nacheinander — bewusst NICHT nebenläufig.
 *
 * Jeder Import stößt eine Pipeline-Verarbeitung an (Geocoding, Wetter,
 * Bildanalyse); ein Anbieter, der nach einer Woche Funkstille zwanzig
 * Aktivitäten auf einmal meldet, würde parallel den ganzen Server belegen.
 *
 * Der Sync-Zeitpunkt wird am ENDE gesetzt und nur, wenn nichts offen blieb.
 * Er ist beim Polling-Weg der CURSOR (`listNew(tokens, lastSyncAt)`):
 * Vorgerückt, obwohl eine Aktivität gescheitert ist, listet der Anbieter sie
 * beim nächsten Mal nicht mehr — und damit wäre sie auch dann verloren, wenn
 * der neue Anlauf sie längst wieder annehmen würde. Je Verknüpfung entschieden,
 * weil ein Stapel Aufträge aus mehreren stammen kann.
 */
export async function runImports(
  app: FastifyInstance,
  service: TrackerService,
  jobs: readonly ImportJob[],
): Promise<ImportRow[]> {
  const results: ImportRow[] = []
  const involved = new Set<string>()
  const pending = new Set<string>()
  for (const job of jobs) {
    involved.add(job.link.id)
    const row = await runImport(app, service, job)
    if (!row) continue
    results.push(row)
    // Offen ist genau das, was noch einmal drankommen soll — dieselbe Frage,
    // die `claim` beim nächsten Anlauf stellt.
    if (row.retryable) pending.add(job.link.id)
  }
  for (const id of involved) {
    if (!pending.has(id)) service.noteSync(id)
  }
  return results
}
