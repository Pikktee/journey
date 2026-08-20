// Aus einem Rohtrack wird eine Tour — über DIESELBEN Pfade wie ein Upload.
//
// Der TourAnleger ruft `legeTourAn` und `finalisiereTour` aus routes/tours.ts;
// er baut kein eigenes Manifest-Format, keine eigene Statuslogik und keinen
// zweiten Pipeline-Zweig. Genau das ist die dritte Anforderung des Konzepts:
// Eine Cloud-Tour ist nach dem Anlegen von einer App-Tour nicht mehr zu
// unterscheiden — sonst hätte der Player einen Sonderfall und jede spätere
// Änderung zwei Orte.

import type { FastifyInstance } from 'fastify'
import { finalisiereTour, ladeTour, legeTourAn, TRACK_PFAD } from '../routes/tours.js'
import { pruefeQuota } from '../quota.js'
import type { Modus, UploadManifest } from '../schema/upload.js'
import { UPLOAD_SCHEMA_ID } from '../schema/upload.js'
import { zuGpx } from './normalisierer.js'
import { OhneRouteFehler, ZuKleinFehler, type RohTrack, type TrackerAnbieter } from './vertrag.js'

/**
 * Sportart des Anbieters → Fortbewegungs-Modus.
 *
 * Die Tabelle steht im KERN und nicht in jedem Adapter: „Ride" heißt bei allen
 * dasselbe, und eine Zuordnung je Anbieter liefe unweigerlich auseinander.
 * Sie ist bewusst grob — was wirklich gefahren wurde, klärt die vorhandene
 * Server-Erkennung darüber (Tempo, Schienenabgleich), und die kann nur
 * verfeinern, was nicht als Angabe festgeschrieben ist.
 */
const SPORT_MODI: Array<[RegExp, Modus]> = [
  [/ride|cycl|bike|biking|velo/i, 'bike'],
  [/run|walk|hike|hiking|trek|nordic/i, 'walk'],
  [/motor|scooter|moped/i, 'moped'],
  [/drive|car/i, 'jeep'],
  [/kayak|canoe|row|sail|boat|swim/i, 'ferry'],
]

/** Modus aus der Sportart raten; `null` heißt „keine Angabe" (der Server rät selbst). */
export function modusAusSportart(sportart: string | null | undefined): Modus | null {
  if (!sportart) return null
  for (const [muster, modus] of SPORT_MODI) {
    if (muster.test(sportart)) return modus
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
export const MIN_STRECKE_M = 100
export const MIN_DAUER_S = 120

export interface AnlageQuelle {
  anbieter: TrackerAnbieter
  externeId: string
  track: RohTrack
}

export interface AnlageErgebnis {
  tourId: string
  /** true = dieselbe Aktivität lag schon vor (wiederholte Zustellung). */
  wiederverwendet: boolean
}

/** Länge eines GPX in Metern (grob, für die Mindestgröße — nicht für Statistik). */
function streckeM(gpx: string): number {
  const punkte: Array<[number, number]> = []
  const re =
    /<trkpt\b[^>]*lat="([^"]+)"[^>]*lon="([^"]+)"|<trkpt\b[^>]*lon="([^"]+)"[^>]*lat="([^"]+)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(gpx))) {
    const lat = Number(m[1] ?? m[4])
    const lng = Number(m[2] ?? m[3])
    if (Number.isFinite(lat) && Number.isFinite(lng)) punkte.push([lat, lng])
  }
  let summe = 0
  for (let i = 1; i < punkte.length; i++) {
    const [aLat = 0, aLng = 0] = punkte[i - 1] as [number, number]
    const [bLat = 0, bLng = 0] = punkte[i] as [number, number]
    const dLat = ((bLat - aLat) * Math.PI * 6371000) / 180
    const dLng =
      (((bLng - aLng) * Math.PI * 6371000) / 180) * Math.cos(((aLat + bLat) / 2) * (Math.PI / 180))
    summe += Math.hypot(dLat, dLng)
  }
  return summe
}

/** Wird geworfen, wenn der Speicher des Kontos voll ist (→ `uebersprungen` mit Hinweis). */
export class QuotaFehler extends Error {
  constructor(nachricht: string) {
    super(nachricht)
    this.name = 'QuotaFehler'
  }
}

/**
 * Rohtrack → fertig angestoßene Tour.
 *
 * Der Ablauf ist exakt der des Uploads: Manifest anlegen → `track.gpx`
 * schreiben → finalisieren. Die Reihenfolge ist keine Geschmacksfrage —
 * `finalisiereTour` prüft, ob die Track-Datei liegt, und gäbe sonst 409
 * zurück.
 */
export async function legeTourAusTrackAn(
  app: FastifyInstance,
  benutzerId: string,
  quelle: AnlageQuelle,
): Promise<AnlageErgebnis> {
  const { storage, benutzerStorage, konfig, db } = app.deps
  const gpx = zuGpx(quelle.track)

  const startMs = Date.parse(quelle.track.start)
  const endeMs = Date.parse(quelle.track.ende)
  if (!Number.isFinite(startMs) || !Number.isFinite(endeMs) || endeMs <= startMs) {
    throw new Error('Aktivität ohne brauchbare Zeitspanne')
  }
  const dauerS = (endeMs - startMs) / 1000
  const strecke = streckeM(gpx)
  if (strecke < MIN_STRECKE_M && dauerS < MIN_DAUER_S) {
    throw new ZuKleinFehler(
      `Zu kurz für eine Tour (${Math.round(strecke)} m, ${Math.round(dauerS / 60)} min)`,
    )
  }

  // Quota VOR dem Anlegen: Eine Tour anzulegen und sie dann am vollen Speicher
  // scheitern zu lassen, hinterließe eine leere Hülle im Konto.
  const quotaFehler = await pruefeQuota(
    db,
    storage,
    benutzerStorage,
    benutzerId,
    konfig.maxSpeicherProBenutzer,
    Buffer.byteLength(gpx),
  )
  if (quotaFehler) throw new QuotaFehler(quotaFehler)

  const modus = modusAusSportart(quelle.track.sportart)
  const manifest: UploadManifest = {
    schema: UPLOAD_SCHEMA_ID,
    // Der Dedup-Riegel: Dieselbe Aktivität ein zweites Mal gemeldet trifft auf
    // den vorhandenen UNIQUE(owner_id, client_tour_id) und bekommt dieselbe
    // Tour-ID zurück, statt eine zweite anzulegen.
    clientTourId: `${quelle.anbieter}:${quelle.externeId}`,
    title: quelle.track.titel ?? null,
    description: null,
    time: {
      start: new Date(startMs).toISOString(),
      end: new Date(endeMs).toISOString(),
      // Die Zone des Anbieters ist unbekannt; UTC ist die ehrliche Angabe.
      // Sie steht im Manifest und ist im Studio änderbar — geraten wäre sie
      // dort nicht mehr als solche zu erkennen.
      zone: 'UTC',
    },
    trackFile: 'track.gpx',
    ...(modus ? { trackMode: modus } : {}),
    // Ohne Modus-Angabe darf die Server-Erkennung arbeiten; mit einer
    // geratenen Sportart-Zuordnung wäre sie stillgelegt.
    ...(modus ? {} : { modiAutomatisch: true }),
    media: [],
  }

  const angelegt = await legeTourAn(app, benutzerId, manifest)
  if (!angelegt.ok) throw new Error(angelegt.error)
  if (angelegt.reused) return { tourId: angelegt.id, wiederverwendet: true }

  await storage.schreibe(angelegt.id, TRACK_PFAD, gpx)
  const tour = ladeTour(app, angelegt.id)
  if (!tour) throw new Error('Tour verschwand zwischen Anlegen und Finalisieren')
  const fertig = await finalisiereTour(app, tour)
  if (!fertig.ok) throw new Error(fertig.error)
  return { tourId: angelegt.id, wiederverwendet: false }
}

export { OhneRouteFehler, ZuKleinFehler }
