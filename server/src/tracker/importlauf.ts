// Die Hintergrundarbeit nach einer Webhook-Zustellung: Track holen →
// normalisieren → Tour anlegen → finalisieren.
//
// **Webhooks antworten sofort.** Strava verlangt eine Antwort in unter zwei
// Sekunden, und einen Download plus Pipeline schafft das niemand in dieser
// Zeit. Muster ist der Datenexport: Route antwortet 200, Arbeit läuft danach.
// Wie bei `app.verarbeitungen` wird der laufende Import in einer Map gehalten,
// damit Tests gezielt darauf warten können, statt zu pollen.

import type { FastifyInstance } from 'fastify'
import { QuotaFehler, legeTourAusTrackAn } from './touranleger.js'
import { MAX_VERSUCHE, type ImportZeile, type TrackerDienst, type Verknuepfung } from './tracker.js'
import {
  OhneRouteFehler,
  TokensUngueltigFehler,
  ZuKleinFehler,
  type TrackerProvider,
} from './vertrag.js'

/**
 * Fehler, die eine Aktivität ÜBERSPRINGEN statt scheitern lassen.
 *
 * Der Unterschied ist keine Kosmetik: Ein Vielsportler meldet jede Woche
 * Hallentrainings ohne GPS. Als Fehler geführt, stünde seine Liste dauerhaft
 * rot, und die eine echte Störung ginge darin unter.
 */
function istUebersprungen(fehler: unknown): boolean {
  return (
    fehler instanceof OhneRouteFehler ||
    fehler instanceof ZuKleinFehler ||
    fehler instanceof QuotaFehler
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
function istWiederholbar(fehler: unknown): boolean {
  return !(fehler instanceof OhneRouteFehler || fehler instanceof ZuKleinFehler)
}

export interface ImportAuftrag {
  verknuepfung: Verknuepfung
  provider: TrackerProvider
  externeId: string
}

/**
 * Einen einzelnen Import ausführen. Wirft NICHT — jedes Ergebnis landet als
 * Status am Import, damit es im Konto sichtbar ist statt im Log-Nirvana.
 */
export async function fuehreImportAus(
  app: FastifyInstance,
  dienst: TrackerDienst,
  auftrag: ImportAuftrag,
): Promise<ImportZeile | null> {
  const { verknuepfung, provider, externeId } = auftrag
  // Der erste Dedup-Riegel. Der zweite ist `client_tour_id` beim Anlegen —
  // keiner davon ist der einzige, weil beide unterschiedliche Wege abdecken:
  // dieser die wiederholte Zustellung, jener den parallelen Anlege-Versuch.
  const importZeile = dienst.beanspruche(verknuepfung.userId, verknuepfung.provider, externeId)
  if (!importZeile) return null

  let fertigeTour: string | null = null
  try {
    const tokens = await dienst.gueltigeTokens(verknuepfung, provider)
    const track = await provider.holeTrack(tokens, externeId)
    const { tourId } = await legeTourAusTrackAn(app, verknuepfung.userId, {
      anbieter: verknuepfung.provider,
      externeId,
      track,
    })
    dienst.schliesseImportAb(importZeile.id, 'done', tourId)
    fertigeTour = tourId
  } catch (fehler) {
    const nachricht = (fehler as Error).message
    // Am Deckel ist Schluss. Das steht NICHT im Fehlertext, sondern in den
    // Feldern (`retryable` + `attempts`): Die Oberfläche formuliert daraus
    // „wird noch einmal versucht" oder „aufgegeben nach 3 Versuchen" — in den
    // Text geschrieben stünde es dort ein zweites Mal.
    const wiederholbar = istWiederholbar(fehler) && importZeile.attempts < MAX_VERSUCHE
    if (istUebersprungen(fehler)) {
      dienst.schliesseImportAb(importZeile.id, 'skipped', null, nachricht, wiederholbar)
    } else {
      dienst.schliesseImportAb(importZeile.id, 'failed', null, nachricht, wiederholbar)
      // Eine tote Verknüpfung muss SICHTBAR tot sein: Der Nutzer wartet sonst
      // auf Touren, die nie kommen.
      if (fehler instanceof TokensUngueltigFehler) {
        dienst.setzeStatus(verknuepfung.id, 'expired', 'Zugang abgelaufen, bitte neu verbinden')
      } else {
        app.log.warn(
          `Tracker-Import fehlgeschlagen (${verknuepfung.provider}/${externeId}): ${nachricht}`,
        )
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
  if (fertigeTour) {
    await app.push.melde(verknuepfung.userId, {
      type: 'import-finished',
      tourId: fertigeTour,
      importId: importZeile.id,
    })
  }
  return dienst.importZeile(importZeile.id)
}

/**
 * Mehrere Importe nacheinander — bewusst NICHT nebenläufig.
 *
 * Jeder Import stößt eine Pipeline-Verarbeitung an (Geocoding, Wetter,
 * Bildanalyse); ein Anbieter, der nach einer Woche Funkstille zwanzig
 * Aktivitäten auf einmal meldet, würde parallel den ganzen Server belegen.
 *
 * Der Sync-Zeitpunkt wird am ENDE gesetzt und nur, wenn nichts offen blieb.
 * Er ist beim Polling-Weg der CURSOR (`listeNeue(tokens, zuletztSyncAm)`):
 * Vorgerückt, obwohl eine Aktivität gescheitert ist, listet der Anbieter sie
 * beim nächsten Mal nicht mehr — und damit wäre sie auch dann verloren, wenn
 * der neue Anlauf sie längst wieder annehmen würde. Je Verknüpfung entschieden,
 * weil ein Stapel Aufträge aus mehreren stammen kann.
 */
export async function fuehreImporteAus(
  app: FastifyInstance,
  dienst: TrackerDienst,
  auftraege: readonly ImportAuftrag[],
): Promise<ImportZeile[]> {
  const ergebnisse: ImportZeile[] = []
  const beteiligt = new Set<string>()
  const offen = new Set<string>()
  for (const auftrag of auftraege) {
    beteiligt.add(auftrag.verknuepfung.id)
    const zeile = await fuehreImportAus(app, dienst, auftrag)
    if (!zeile) continue
    ergebnisse.push(zeile)
    // Offen ist genau das, was noch einmal drankommen soll — dieselbe Frage,
    // die `beanspruche` beim nächsten Anlauf stellt.
    if (zeile.retryable) offen.add(auftrag.verknuepfung.id)
  }
  for (const id of beteiligt) {
    if (!offen.has(id)) dienst.merkeSync(id)
  }
  return ergebnisse
}
