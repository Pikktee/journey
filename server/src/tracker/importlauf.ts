// Die Hintergrundarbeit nach einer Webhook-Zustellung: Track holen →
// normalisieren → Tour anlegen → finalisieren.
//
// **Webhooks antworten sofort.** Strava verlangt eine Antwort in unter zwei
// Sekunden, und einen Download plus Pipeline schafft das niemand in dieser
// Zeit. Muster ist der Datenexport: Route antwortet 200, Arbeit läuft danach.
// Wie bei `app.verarbeitungen` wird der laufende Import in einer Map gehalten,
// damit Tests gezielt darauf warten können, statt zu pollen.

import type { FastifyInstance } from 'fastify'
import { QuotaFehler, ZuKleinFehler, legeTourAusTrackAn } from './touranleger.js'
import type { ImportZeile, TrackerDienst, Verknuepfung } from './tracker.js'
import { OhneRouteFehler, TokensUngueltigFehler, type TrackerProvider } from './vertrag.js'

/**
 * Fehler, die eine Aktivität ÜBERSPRINGEN statt scheitern lassen.
 *
 * Der Unterschied ist keine Kosmetik: Ein Vielsportler meldet jede Woche
 * Hallentrainings ohne GPS. Als Fehler geführt, stünde seine Liste dauerhaft
 * rot, und die eine echte Störung ginge darin unter.
 */
function istUebersprungen(fehler: unknown): boolean {
  return fehler instanceof OhneRouteFehler || fehler instanceof ZuKleinFehler || fehler instanceof QuotaFehler
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
  const importZeile = dienst.beanspruche(verknuepfung.benutzerId, verknuepfung.anbieter, externeId)
  if (!importZeile) return null

  try {
    const tokens = await dienst.gueltigeTokens(verknuepfung, provider)
    const track = await provider.holeTrack(tokens, externeId)
    const { tourId } = await legeTourAusTrackAn(app, verknuepfung.benutzerId, {
      anbieter: verknuepfung.anbieter,
      externeId,
      track,
    })
    dienst.schliesseImportAb(importZeile.id, 'fertig', tourId)
    dienst.merkeSync(verknuepfung.id)
  } catch (fehler) {
    const nachricht = (fehler as Error).message
    if (istUebersprungen(fehler)) {
      dienst.schliesseImportAb(importZeile.id, 'uebersprungen', null, nachricht)
    } else {
      dienst.schliesseImportAb(importZeile.id, 'fehler', null, nachricht)
      // Eine tote Verknüpfung muss SICHTBAR tot sein: Der Nutzer wartet sonst
      // auf Touren, die nie kommen.
      if (fehler instanceof TokensUngueltigFehler) {
        dienst.setzeStatus(verknuepfung.id, 'abgelaufen', 'Zugang abgelaufen, bitte neu verbinden')
      } else {
        app.log.warn(`Tracker-Import fehlgeschlagen (${verknuepfung.anbieter}/${externeId}): ${nachricht}`)
      }
    }
  }
  return dienst.importZeile(importZeile.id)
}

/**
 * Mehrere Importe nacheinander — bewusst NICHT nebenläufig.
 *
 * Jeder Import stößt eine Pipeline-Verarbeitung an (Geocoding, Wetter,
 * Bildanalyse); ein Anbieter, der nach einer Woche Funkstille zwanzig
 * Aktivitäten auf einmal meldet, würde parallel den ganzen Server belegen.
 */
export async function fuehreImporteAus(
  app: FastifyInstance,
  dienst: TrackerDienst,
  auftraege: readonly ImportAuftrag[],
): Promise<ImportZeile[]> {
  const ergebnisse: ImportZeile[] = []
  for (const auftrag of auftraege) {
    const zeile = await fuehreImportAus(app, dienst, auftrag)
    if (zeile) ergebnisse.push(zeile)
  }
  return ergebnisse
}
