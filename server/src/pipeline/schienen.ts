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

import { distanzM } from './geo.js'
import type { Modus, UploadPunkt, UploadSegment } from '../schema/upload.js'

/** Eine Schienenlinie als Folge von [lng, lat]. */
export type Schienenweg = ReadonlyArray<readonly [number, number]>

export interface SchienenQuelle {
  /**
   * Straßenbahn-/Stadtbahngleise im umschließenden Rechteck.
   * Wirft bei Fehlern — der Aufrufer behandelt das als „nichts gefunden".
   */
  gleise(box: { sued: number; west: number; nord: number; ost: number }): Promise<Schienenweg[]>
}

/**
 * Halber Korridor um ein Gleis (m).
 *
 * Großzügiger als es klingt: Ein Handy im Straßenbahnwagen misst mit ±10 m
 * Genauigkeit, zweigleisige Strecken liegen ~6 m auseinander, und OSM-Geometrie
 * ist gemittelt. Enger würde die halbe Fahrt aus dem Korridor fallen.
 */
const KORRIDOR_M = 30

/**
 * So viel eines Abschnitts muss im Korridor liegen.
 *
 * Hoch angesetzt, weil die Länge allein nicht trägt (s. u.): Eine Straßenbahn
 * ist IMMER auf den Gleisen, ein Auto nur stückweise und zufällig. Die Deckung
 * unterscheidet beide besser als jede Streckenschranke.
 */
const ANTEIL = 0.85

/**
 * So lang muss ein Abschnitt sein, damit er als Bahnfahrt zählt (m).
 *
 * An einer echten Tour nachgemessen (Frankfurt, Juli 2026): Zwei Fahrten von
 * zwei und vier Minuten — in der Stadt sind das ein paar hundert Meter. Eine
 * Schranke von anderthalb Kilometern, wie sie für Überlandfahrten naheliegt,
 * hätte beide verworfen. Zwei Haltestellen sind die kürzeste Fahrt, die man
 * überhaupt als solche erzählt.
 */
const MIN_STRECKE_M = 500

/** Rand um die Tour für die Abfrage (Grad, ~1 km). */
const BOX_RAND = 0.01

/** Umschließendes Rechteck aller Punkte, mit Rand. */
export function umgebungsBox(segmente: readonly UploadSegment[]): {
  sued: number
  west: number
  nord: number
  ost: number
} | null {
  const pts = segmente.flatMap((s) => s.pts)
  if (!pts.length) return null
  let sued = 90
  let west = 180
  let nord = -90
  let ost = -180
  for (const [lng = 0, lat = 0] of pts) {
    sued = Math.min(sued, lat)
    nord = Math.max(nord, lat)
    west = Math.min(west, lng)
    ost = Math.max(ost, lng)
  }
  return { sued: sued - BOX_RAND, west: west - BOX_RAND, nord: nord + BOX_RAND, ost: ost + BOX_RAND }
}

/** Abstand eines Punktes zur Strecke a→b (m), über eine lokale Ebene genähert. */
function abstandZurStrecke(p: readonly number[], a: readonly number[], b: readonly number[]): number {
  const mLng = 111_320 * Math.cos(((a[1] as number) * Math.PI) / 180)
  const mLat = 110_540
  const ax = 0
  const ay = 0
  const bx = ((b[0] as number) - (a[0] as number)) * mLng
  const by = ((b[1] as number) - (a[1] as number)) * mLat
  const px = ((p[0] as number) - (a[0] as number)) * mLng
  const py = ((p[1] as number) - (a[1] as number)) * mLat
  const laenge2 = (bx - ax) ** 2 + (by - ay) ** 2
  if (laenge2 === 0) return Math.hypot(px, py)
  const u = Math.max(0, Math.min(1, (px * bx + py * by) / laenge2))
  return Math.hypot(px - u * bx, py - u * by)
}

/**
 * Gleis mit vorberechnetem Umgriff.
 *
 * Der Vorfilter muss die BOX des ganzen Weges prüfen, nicht die Nähe zu seinen
 * Endpunkten: Ein drei Kilometer langes Gleis hat beide Enden weit weg von
 * jedem Punkt in seiner Mitte — genau dort, wo die Bahn fährt.
 */
interface GleisMitBox {
  weg: Schienenweg
  sued: number
  west: number
  nord: number
  ost: number
}

function mitBox(weg: Schienenweg): GleisMitBox {
  let sued = 90
  let west = 180
  let nord = -90
  let ost = -180
  for (const [lng, lat] of weg) {
    sued = Math.min(sued, lat)
    nord = Math.max(nord, lat)
    west = Math.min(west, lng)
    ost = Math.max(ost, lng)
  }
  // Box um den Korridor weiten, damit der Grobtest nie einen echten Treffer wegwirft
  const dLat = KORRIDOR_M / 110_540
  const dLng = KORRIDOR_M / (111_320 * Math.max(0.05, Math.cos((sued * Math.PI) / 180)))
  return { weg, sued: sued - dLat, west: west - dLng, nord: nord + dLat, ost: ost + dLng }
}

/** Liegt der Punkt im Korridor irgendeines Gleises? */
function aufGleis(p: UploadPunkt, gleise: readonly GleisMitBox[]): boolean {
  const lng = p[0]
  const lat = p[1]
  for (const g of gleise) {
    if (lat < g.sued || lat > g.nord || lng < g.west || lng > g.ost) continue
    for (let i = 1; i < g.weg.length; i++) {
      if (abstandZurStrecke(p, g.weg[i - 1] as readonly [number, number], g.weg[i] as readonly [number, number]) <= KORRIDOR_M) {
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
export function hebeSchienenAbschnitte(
  segmente: readonly UploadSegment[],
  gleise: readonly Schienenweg[],
): UploadSegment[] {
  if (!gleise.length) return [...segmente]
  const mitBoxen = gleise.map(mitBox)
  return segmente.map((s) => {
    if (s.mode === 'walk' || s.pts.length < 2) return s
    let strecke = 0
    for (let i = 1; i < s.pts.length; i++) strecke += distanzM(s.pts[i - 1] as UploadPunkt, s.pts[i] as UploadPunkt)
    if (strecke < MIN_STRECKE_M) return s
    const treffer = s.pts.filter((p) => aufGleis(p, mitBoxen)).length
    return treffer / s.pts.length >= ANTEIL ? { ...s, mode: 'tram' as Modus } : s
  })
}

/** Overpass-Anbindung (OpenStreetMap). */
export class OverpassSchienen implements SchienenQuelle {
  constructor(
    private readonly basisUrl = 'https://overpass-api.de/api/interpreter',
    private readonly userAgent = 'Maptale/0.1 (https://maptale.io)',
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async gleise(box: { sued: number; west: number; nord: number; ost: number }): Promise<Schienenweg[]> {
    const rechteck = `${box.sued},${box.west},${box.nord},${box.ost}`
    // `out geom` liefert die Stützpunkte gleich mit — sonst bräuchte es einen
    // zweiten Durchgang für die Knoten.
    const abfrage = `[out:json][timeout:25];way["railway"~"^(tram|light_rail)$"](${rechteck});out geom;`
    const antwort = await this.fetchFn(this.basisUrl, {
      method: 'POST',
      body: `data=${encodeURIComponent(abfrage)}`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': this.userAgent },
      signal: AbortSignal.timeout(30_000),
    })
    if (!antwort.ok) throw new Error(`Overpass ${antwort.status}`)
    const daten = (await antwort.json()) as { elements?: Array<{ geometry?: Array<{ lat: number; lon: number }> }> }
    return (daten.elements ?? [])
      .map((e) => (e.geometry ?? []).map((g): readonly [number, number] => [g.lon, g.lat]))
      .filter((w) => w.length >= 2)
  }
}

/** Test-Doppel mit Mitschnitt der Abfragen. */
export class FesteSchienen implements SchienenQuelle {
  readonly abfragen: Array<{ sued: number; west: number; nord: number; ost: number }> = []

  constructor(private readonly antwort: Schienenweg[] = []) {}

  async gleise(box: { sued: number; west: number; nord: number; ost: number }): Promise<Schienenweg[]> {
    this.abfragen.push(box)
    return this.antwort
  }
}
