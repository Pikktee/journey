// Aus einem Rohtrack wird eine Tour — über DIESELBEN Pfade wie ein Upload.
//
// Der TourAnleger ruft `createTour` und `finalizeTour` aus routes/tours.ts;
// er baut kein eigenes Manifest-Format, keine eigene Statuslogik und keinen
// zweiten Pipeline-Zweig. Genau das ist die dritte Anforderung des Konzepts:
// Eine Cloud-Tour ist nach dem Anlegen von einer App-Tour nicht mehr zu
// unterscheiden — sonst hätte der Player einen Sonderfall und jede spätere
// Änderung zwei Orte.

import type { FastifyInstance } from 'fastify'
import { finalizeTour, loadTour, createTour, TRACK_PATH } from '../routes/tours.js'
import { checkQuota } from '../quota.js'
import type { TravelMode, UploadManifest } from '../schema/upload.js'
import { UPLOAD_SCHEMA_ID } from '../schema/upload.js'
import { toGpx } from './normalizer.js'
import { NoRouteError, TooSmallError, type RawTrack, type TrackerProviderId } from './contract.js'

/**
 * Sportart des Anbieters → Fortbewegungs-Modus.
 *
 * Die Tabelle steht im KERN und nicht in jedem Adapter: „Ride" heißt bei allen
 * dasselbe, und eine Zuordnung je Anbieter liefe unweigerlich auseinander.
 * Sie ist bewusst grob — was wirklich gefahren wurde, klärt die vorhandene
 * Server-Erkennung darüber (Tempo, Schienenabgleich), und die kann nur
 * verfeinern, was nicht als Angabe festgeschrieben ist.
 */
const SPORT_MODES: Array<[RegExp, TravelMode]> = [
  [/ride|cycl|bike|biking|velo/i, 'bike'],
  [/run|walk|hike|hiking|trek|nordic/i, 'walk'],
  [/motor|scooter|moped/i, 'moped'],
  [/drive|car/i, 'jeep'],
  [/kayak|canoe|row|sail|boat|swim/i, 'ferry'],
]

/** Modus aus der Sportart raten; `null` heißt „keine Angabe" (der Server rät selbst). */
export function travelModeFromSport(sport: string | null | undefined): TravelMode | null {
  if (!sport) return null
  for (const [pattern, mode] of SPORT_MODES) {
    if (pattern.test(sport)) return mode
  }
  return null
}

/**
 * Mindestgröße einer importierten Aktivität — die Schwelle gegen VERSEHEN,
 * nicht gegen kurze Touren.
 *
 * **Sie stand bis 2026-08-10 bei 1 km / 10 min, und das war falsch gedacht.**
 * Die Begründung lautete „sonst ist die Bibliothek nach einer Woche Müll" — nur
 * hat diese Entscheidung längst jemand anders getroffen: Wer bei Polar eine
 * kurze Einheit speichert, wird dort ausdrücklich gefragt, ob er sie behalten
 * will. Sagt er ja und Maptale verwirft sie trotzdem, überstimmen wir eine
 * Entscheidung, die der Nutzer bewusst gefällt hat — und er sucht den Fehler
 * bei uns. Genau so gemeldet, an einer 521-m-Runde.
 *
 * Was bleibt, ist eine Schwelle gegen das, was NIEMAND entschieden hat: die
 * versehentlich gestartete und gleich wieder beendete Aufzeichnung, die Uhr in
 * der Jackentasche. Dafür genügen hundert Meter und zwei Minuten.
 *
 * Beide Bedingungen müssen zutreffen (`&&`): Eine halbe Stunde auf der Stelle
 * ist eine Aufzeichnung, kein Versehen — und eine, die jemand behalten wollte.
 */
export const MIN_DISTANCE_M = 100
export const MIN_DURATION_S = 120

export interface CreationSource {
  providerOf: TrackerProviderId
  externalId: string
  track: RawTrack
}

export interface CreationResult {
  tourId: string
  /** true = dieselbe Aktivität lag schon vor (wiederholte Zustellung). */
  reused: boolean
}

/** Länge eines GPX in Metern (grob, für die Mindestgröße — nicht für Statistik). */
function distanceM(gpx: string): number {
  const points: Array<[number, number]> = []
  const re =
    /<trkpt\b[^>]*lat="([^"]+)"[^>]*lon="([^"]+)"|<trkpt\b[^>]*lon="([^"]+)"[^>]*lat="([^"]+)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(gpx))) {
    const lat = Number(m[1] ?? m[4])
    const lng = Number(m[2] ?? m[3])
    if (Number.isFinite(lat) && Number.isFinite(lng)) points.push([lat, lng])
  }
  let sum = 0
  for (let i = 1; i < points.length; i++) {
    const [aLat = 0, aLng = 0] = points[i - 1] as [number, number]
    const [bLat = 0, bLng = 0] = points[i] as [number, number]
    const dLat = ((bLat - aLat) * Math.PI * 6371000) / 180
    const dLng =
      (((bLng - aLng) * Math.PI * 6371000) / 180) * Math.cos(((aLat + bLat) / 2) * (Math.PI / 180))
    sum += Math.hypot(dLat, dLng)
  }
  return sum
}

/** Wird geworfen, wenn der Speicher des Kontos voll ist (→ `uebersprungen` mit Hinweis). */
export class QuotaError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'QuotaFehler'
  }
}

/**
 * Rohtrack → fertig angestoßene Tour.
 *
 * Der Ablauf ist exakt der des Uploads: Manifest anlegen → `track.gpx`
 * schreiben → finalisieren. Die Reihenfolge ist keine Geschmacksfrage —
 * `finalizeTour` prüft, ob die Track-Datei liegt, und gäbe sonst 409
 * zurück.
 */
export async function createTourFromTrack(
  app: FastifyInstance,
  userId: string,
  source: CreationSource,
): Promise<CreationResult> {
  const { storage, userStorage, config, db } = app.deps
  const gpx = toGpx(source.track)

  const startMs = Date.parse(source.track.start)
  const endMs = Date.parse(source.track.end)
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    throw new Error('Aktivität ohne brauchbare Zeitspanne')
  }
  const durationS = (endMs - startMs) / 1000
  const distance = distanceM(gpx)
  if (distance < MIN_DISTANCE_M && durationS < MIN_DURATION_S) {
    throw new TooSmallError(
      `Zu kurz für eine Tour (${Math.round(distance)} m, ${Math.round(durationS / 60)} min)`,
    )
  }

  // Quota VOR dem Anlegen: Eine Tour anzulegen und sie dann am vollen Speicher
  // scheitern zu lassen, hinterließe eine leere Hülle im Konto.
  const quotaError = await checkQuota(
    db,
    storage,
    userStorage,
    userId,
    config.maxStoragePerUser,
    Buffer.byteLength(gpx),
  )
  if (quotaError) throw new QuotaError(quotaError)

  const mode = travelModeFromSport(source.track.sport)
  const manifest: UploadManifest = {
    schema: UPLOAD_SCHEMA_ID,
    // Der Dedup-Riegel: Dieselbe Aktivität ein zweites Mal gemeldet trifft auf
    // den vorhandenen UNIQUE(owner_id, client_tour_id) und bekommt dieselbe
    // Tour-ID zurück, statt eine zweite anzulegen.
    clientTourId: `${source.providerOf}:${source.externalId}`,
    title: source.track.title ?? null,
    description: null,
    time: {
      start: new Date(startMs).toISOString(),
      end: new Date(endMs).toISOString(),
      // Die Zone des Anbieters ist unbekannt; UTC ist die ehrliche Angabe.
      // Sie steht im Manifest und ist im Studio änderbar — geraten wäre sie
      // dort nicht mehr als solche zu erkennen.
      zone: 'UTC',
    },
    trackFile: 'track.gpx',
    ...(mode ? { trackMode: mode } : {}),
    // Ohne Modus-Angabe darf die Server-Erkennung arbeiten; mit einer
    // geratenen Sportart-Zuordnung wäre sie stillgelegt.
    ...(mode ? {} : { travelModesAuto: true }),
    media: [],
  }

  const created = await createTour(app, userId, manifest)
  if (!created.ok) throw new Error(created.error)
  if (created.reused) return { tourId: created.id, reused: true }

  await storage.write(created.id, TRACK_PATH, gpx)
  const tour = loadTour(app, created.id)
  if (!tour) throw new Error('Tour verschwand zwischen Anlegen und Finalisieren')
  const finished = await finalizeTour(app, tour)
  if (!finished.ok) throw new Error(finished.error)
  return { tourId: created.id, reused: false }
}

export { NoRouteError, TooSmallError }
