// Welches Fahrzeug war das? — Straßenbahnen verraten sich durch ihre Schienen.
//
// Am Tempo lassen sich Moped, Jeep und Tram nicht auseinanderhalten
// (tempo.ts): Die Automatik hebt eine Aufnahme ohne Angabe deshalb höchstens
// von „zu Fuß" auf „Rad". Die Geometrie weiß mehr — wer über Kilometer im
// Meterbereich einer Straßenbahntrasse folgt, saß in der Straßenbahn.
//
// Abgefragt wird OpenStreetMap über die Overpass-API. Das ist bewusst ein
// EINMALIGER Schritt beim Verarbeiten: Das Ergebnis wandert als Modus-Grenze
// ins Edit-Overlay, wo es sichtbar und korrigierbar ist — genau wie eine im
// Studio gezogene Kante. Wer die Fortbewegung selbst angegeben hat, wird nie
// überstimmt (der Aufrufer prüft das).

import { distanceM } from './geo.js'
import type { TravelMode, UploadPoint, UploadSegment } from '../schema/upload.js'

/** Eine Schienenlinie als Folge von [lng, lat]. */
export type RailPath = ReadonlyArray<readonly [number, number]>

export interface RailSource {
  /**
   * Straßenbahn-/Stadtbahngleise im umschließenden Rechteck.
   * Wirft bei Fehlern — der Aufrufer behandelt das als „nichts gefunden".
   */
  rails(box: { south: number; west: number; north: number; east: number }): Promise<RailPath[]>
}

/**
 * Halber Korridor um ein Gleis (m).
 *
 * Großzügiger als es klingt: Ein Handy im Straßenbahnwagen misst mit ±10 m
 * Genauigkeit, zweigleisige Strecken liegen ~6 m auseinander, und OSM-Geometrie
 * ist gemittelt. Enger würde die halbe Fahrt aus dem Korridor fallen.
 */
const CORRIDOR_M = 30

/**
 * So viel eines Abschnitts muss im Korridor liegen.
 *
 * Hoch angesetzt, weil die Länge allein nicht trägt (s. u.): Eine Straßenbahn
 * ist IMMER auf den Gleisen, ein Auto nur stückweise und zufällig. Die Deckung
 * unterscheidet beide besser als jede Streckenschranke.
 */
const SHARE = 0.85

/**
 * So lang muss ein Abschnitt sein, damit er als Bahnfahrt zählt (m).
 *
 * An einer echten Tour nachgemessen (Frankfurt, Juli 2026): Zwei Fahrten von
 * zwei und vier Minuten — in der Stadt sind das ein paar hundert Meter. Eine
 * Schranke von anderthalb Kilometern, wie sie für Überlandfahrten naheliegt,
 * hätte beide verworfen. Zwei Haltestellen sind die kürzeste Fahrt, die man
 * überhaupt als solche erzählt.
 */
const MIN_DISTANCE_M = 500

/** Rand um die Tour für die Abfrage (Grad, ~1 km). */
const BOX_MARGIN = 0.01

/** Umschließendes Rechteck aller Punkte, mit Rand. */
export function boundingBox(segs: readonly UploadSegment[]): {
  south: number
  west: number
  north: number
  east: number
} | null {
  const pts = segs.flatMap((s) => s.pts)
  if (!pts.length) return null
  let south = 90
  let west = 180
  let north = -90
  let east = -180
  for (const [lng = 0, lat = 0] of pts) {
    south = Math.min(south, lat)
    north = Math.max(north, lat)
    west = Math.min(west, lng)
    east = Math.max(east, lng)
  }
  return {
    south: south - BOX_MARGIN,
    west: west - BOX_MARGIN,
    north: north + BOX_MARGIN,
    east: east + BOX_MARGIN,
  }
}

/** Abstand eines Punktes zur Strecke a→b (m), über eine lokale Ebene genähert. */
function distanceToSegment(
  p: readonly number[],
  a: readonly number[],
  b: readonly number[],
): number {
  const mLng = 111_320 * Math.cos(((a[1] as number) * Math.PI) / 180)
  const mLat = 110_540
  const ax = 0
  const ay = 0
  const bx = ((b[0] as number) - (a[0] as number)) * mLng
  const by = ((b[1] as number) - (a[1] as number)) * mLat
  const px = ((p[0] as number) - (a[0] as number)) * mLng
  const py = ((p[1] as number) - (a[1] as number)) * mLat
  const length2 = (bx - ax) ** 2 + (by - ay) ** 2
  if (length2 === 0) return Math.hypot(px, py)
  const u = Math.max(0, Math.min(1, (px * bx + py * by) / length2))
  return Math.hypot(px - u * bx, py - u * by)
}

/**
 * Gleis mit vorberechnetem Umgriff.
 *
 * Der Vorfilter muss die BOX des ganzen Weges prüfen, nicht die Nähe zu seinen
 * Endpunkten: Ein drei Kilometer langes Gleis hat beide Enden weit weg von
 * jedem Punkt in seiner Mitte — genau dort, wo die Bahn fährt.
 */
interface RailWithBox {
  traveled: RailPath
  south: number
  west: number
  north: number
  east: number
}

function withBox(traveled: RailPath): RailWithBox {
  let south = 90
  let west = 180
  let north = -90
  let east = -180
  for (const [lng, lat] of traveled) {
    south = Math.min(south, lat)
    north = Math.max(north, lat)
    west = Math.min(west, lng)
    east = Math.max(east, lng)
  }
  // Box um den Korridor weiten, damit der Grobtest nie einen echten Treffer wegwirft
  const dLat = CORRIDOR_M / 110_540
  const dLng = CORRIDOR_M / (111_320 * Math.max(0.05, Math.cos((south * Math.PI) / 180)))
  return {
    traveled,
    south: south - dLat,
    west: west - dLng,
    north: north + dLat,
    east: east + dLng,
  }
}

/** Liegt der Punkt im Korridor irgendeines Gleises? */
function onRail(p: UploadPoint, rails: readonly RailWithBox[]): boolean {
  const lng = p[0]
  const lat = p[1]
  for (const g of rails) {
    if (lat < g.south || lat > g.north || lng < g.west || lng > g.east) continue
    for (let i = 1; i < g.traveled.length; i++) {
      if (
        distanceToSegment(
          p,
          g.traveled[i - 1] as readonly [number, number],
          g.traveled[i] as readonly [number, number],
        ) <= CORRIDOR_M
      ) {
        return true
      }
    }
  }
  return false
}

/**
 * Fahrabschnitte, die einer Straßenbahntrasse folgen, auf `tram` heben.
 *
 * Angefasst werden nur nicht-`walk`-Abschnitte: Wer neben den Gleisen HER
 * gegangen ist, bleibt zu Fuß. Ändert sich nichts, kommt die Eingabe
 * unverändert zurück.
 */
export function promoteRailSegments(
  segs: readonly UploadSegment[],
  rails: readonly RailPath[],
): UploadSegment[] {
  if (!rails.length) return [...segs]
  const withBoxes = rails.map(withBox)
  return segs.map((s) => {
    if (s.mode === 'walk' || s.pts.length < 2) return s
    let distance = 0
    for (let i = 1; i < s.pts.length; i++)
      distance += distanceM(s.pts[i - 1] as UploadPoint, s.pts[i] as UploadPoint)
    if (distance < MIN_DISTANCE_M) return s
    const hits = s.pts.filter((p) => onRail(p, withBoxes)).length
    return hits / s.pts.length >= SHARE ? { ...s, mode: 'tram' as TravelMode } : s
  })
}

/** Overpass-Anbindung (OpenStreetMap). */
export class OverpassRails implements RailSource {
  constructor(
    private readonly baseUrl = 'https://overpass-api.de/api/interpreter',
    private readonly userAgent = 'Maptale/0.1 (https://maptale.io)',
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async rails(box: {
    south: number
    west: number
    north: number
    east: number
  }): Promise<RailPath[]> {
    const box2 = `${box.south},${box.west},${box.north},${box.east}`
    // `out geom` liefert die Stützpunkte gleich mit — sonst bräuchte es einen
    // zweiten Durchgang für die Knoten.
    const query = `[out:json][timeout:25];way["railway"~"^(tram|light_rail)$"](${box2});out geom;`
    const response = await this.fetchFn(this.baseUrl, {
      method: 'POST',
      body: `data=${encodeURIComponent(query)}`,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': this.userAgent,
      },
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) throw new Error(`Overpass ${response.status}`)
    const data = (await response.json()) as {
      elements?: Array<{ geometry?: Array<{ lat: number; lon: number }> }>
    }
    return (data.elements ?? [])
      .map((e) => (e.geometry ?? []).map((g): readonly [number, number] => [g.lon, g.lat]))
      .filter((w) => w.length >= 2)
  }
}

/** Test-Doppel mit Mitschnitt der Abfragen. */
export class FixedRails implements RailSource {
  readonly queries: Array<{ south: number; west: number; north: number; east: number }> = []

  constructor(private readonly response: RailPath[] = []) {}

  async rails(box: {
    south: number
    west: number
    north: number
    east: number
  }): Promise<RailPath[]> {
    this.queries.push(box)
    return this.response
  }
}
