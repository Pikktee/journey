// Geometrie-Helfer: Haversine, Kurswinkel, Catmull-Rom-Glättung, gleichmäßiges Resampling.
import { reihenfolgeImHalt } from './einblendung.js'
import type { Wegpunkt } from './tours.js'

const D2R = Math.PI / 180
const R = 6371000

/** Punkt mit mindestens [lng, lat] — die Höhe interessiert Distanz und Kurs nicht. */
export type LngLat = [number, number] | Wegpunkt

/**
 * Die geglättete, gleichmäßig abgetastete Route. `cum[i]` ist der Streckenmeter
 * von `coords[i]`; `s` (der Streckenmeter) ist die eine Zustandsvariable des Players.
 */
export interface Route {
  coords: Wegpunkt[]
  cum: number[]
  /** Gesamtlänge in Metern */
  total: number
  /** Summe aller Anstiege in Metern */
  gain: number
  /**
   * Streckenmeter je EINGABE-Wegpunkt (parallel zur Liste, die `buildRoute`
   * bekam) — die Hälfte der f-Übersetzung, die auf dieser Seite liegt
   * (Gleichlauf-Konzept §8D). Zusammen mit dem `f` je Wegpunkt aus dem
   * Tour-JSON wird daraus die Tabelle, mit der `src/streckenanker.ts` jeden
   * f-Anker exakt nach `s` übersetzt.
   */
  wpS: number[]
}

export function dist(a: LngLat, b: LngLat): number {
  const dLat = (b[1] - a[1]) * D2R
  const dLng = (b[0] - a[0]) * D2R
  const la1 = a[1] * D2R
  const la2 = b[1] * D2R
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export function bearing(a: LngLat, b: LngLat): number {
  const la1 = a[1] * D2R
  const la2 = b[1] * D2R
  const dLng = (b[0] - a[0]) * D2R
  const y = Math.sin(dLng) * Math.cos(la2)
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLng)
  return (Math.atan2(y, x) / D2R + 360) % 360
}

// Kürzeste Winkeldifferenz b−a in (−180, 180]
export function angleDelta(a: number, b: number): number {
  return ((b - a + 540) % 360) - 180
}

// Zielpunkt: von `[lng, lat]` aus `distM` Meter in Richtung `bearingDeg`
export function destination(
  [lng, lat]: LngLat,
  distM: number,
  bearingDeg: number,
): [number, number] {
  const delta = distM / R
  const theta = bearingDeg * D2R
  const phi1 = lat * D2R
  const lambda1 = lng * D2R
  const phi2 = Math.asin(
    Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(theta),
  )
  const lambda2 =
    lambda1 +
    Math.atan2(
      Math.sin(theta) * Math.sin(delta) * Math.cos(phi1),
      Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2),
    )
  return [lambda2 / D2R, phi2 / D2R]
}

function cr(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t
  const t3 = t2 * t
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  )
}

/**
 * Höchster Abstand zweier STÜTZPUNKTE, bevor Catmull-Rom über sie glättet.
 *
 * **Die Glättung beult aus, und der Überschuss sitzt in den Kurven** — je weiter
 * die Stützpunkte auseinanderliegen, desto weiter der Bogen. Solange die Engine
 * ihre Position selbst integrierte, war das nur eine etwas zu lange Route.
 * Seit die Position aus der Filmachse kommt (Etappe 4), ist es ein
 * TEMPOfehler: Die Achse rechnet in rohen Wegpunkt-Metern, die Kamera fährt auf
 * der gezeichneten Route — wo die länger ist, muss die Kamera schneller
 * werden. An Stockholm gemessen lief der Film in Schlenkern mit bis zu 95 m/s
 * statt 60, also fast doppelt so schnell wie auf der Geraden (in der alten
 * Engine war beides gleich schnell).
 *
 * Vorverdichten behebt das an der Wurzel: Zwischen zwei weit auseinander
 * liegenden Stützpunkten liegt die Catmull-Rom-Kurve durch kollineare Punkte
 * praktisch auf der Geraden. Gemessen an Stockholm fällt die Streckung
 * Route/Roh im 95. Perzentil von 1,92 auf 1,01 und im Maximum von 4,88 auf
 * 1,34; die Gesamtlänge nähert sich der echten (24,85 → 24,24 km bei 24,19 km
 * roh).
 *
 * **Verdichtet wird nur, wo es zu dünn ist.** Dichte Abschnitte (Fußwege,
 * Aufzeichnungen) bleiben Punkt für Punkt, wie sie sind — dort ändert sich
 * nichts. Der Preis ist, dass die gezeichnete Linie den gesetzten Punkten enger
 * folgt, also formal eckiger wird; für die Kamera macht das nichts, weil ihr
 * Kurs ohnehin durch einen eigenen Tiefpass läuft (src/tour.ts).
 */
export const STUETZ_MAX_M = 25

/**
 * Wegpunkte linear nachverdichten, bevor geglättet wird.
 *
 * Gibt neben den dichteren Punkten die Indizes der ORIGINALE zurück: `wpS`
 * muss weiterhin je EINGEGEBENEM Wegpunkt einen Wegstand liefern — daran hängen
 * die `f`-Anker (src/streckenanker.ts) und die Roh-Meter-Tabelle (src/main.ts).
 */
function verdichte(waypoints: Wegpunkt[], maxM: number): { pts: Wegpunkt[]; original: number[] } {
  const pts: Wegpunkt[] = [waypoints[0]!]
  const original: number[] = [0]
  for (let i = 1; i < waypoints.length; i++) {
    const a = waypoints[i - 1]!
    const b = waypoints[i]!
    const n = Math.max(1, Math.ceil(dist(a, b) / maxM))
    for (let k = 1; k <= n; k++) {
      const t = k / n
      pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t])
    }
    original.push(pts.length - 1)
  }
  return { pts, original }
}

// Wegpunkte [lng, lat, ele] → geglättete, alle `step` Meter abgetastete Route
// mit kumulierten Distanzen. Catmull-Rom wirkt pro Dimension, daher direkt auf lng/lat/ele.
//
// Die `!` in den Schleifen unten sind allesamt Laufindizes innerhalb der eigenen
// Länge — der Aufrufer schuldet nur eine nicht leere Wegpunktliste.
export function buildRoute(waypoints: Wegpunkt[], step = 14, stuetzMaxM = STUETZ_MAX_M): Route {
  const { pts: stuetz, original } = verdichte(waypoints, stuetzMaxM)
  const erster = stuetz[0]!
  const letzter = stuetz[stuetz.length - 1]!
  const pts = [erster, ...stuetz, letzter]
  const dense: Wegpunkt[] = []
  const SEGS = 18
  for (let i = 0; i < pts.length - 3; i++) {
    const [p0, p1, p2, p3] = [pts[i]!, pts[i + 1]!, pts[i + 2]!, pts[i + 3]!]
    for (let j = 0; j < SEGS; j++) {
      const t = j / SEGS
      dense.push([
        cr(p0[0], p1[0], p2[0], p3[0], t),
        cr(p0[1], p1[1], p2[1], p3[1], t),
        cr(p0[2], p1[2], p2[2], p3[2], t),
      ])
    }
  }
  dense.push([...letzter])

  const coords: Wegpunkt[] = [dense[0]!]
  const cum = [0]
  // Wegstand je Stützpunkt der dichten Kurve — daraus fällt `wpS` ab: Wegpunkt
  // `k` steckt in `dense[k * SEGS]` (die Schleife oben setzt bei `j === 0` genau
  // `pts[i + 1]` ab, und der letzte kommt aus dem `dense.push` danach).
  const denseCum = new Array<number>(dense.length)
  denseCum[0] = 0
  let travelled = 0
  let emitted = 0
  for (let i = 1; i < dense.length; i++) {
    const a = dense[i - 1]!
    const b = dense[i]!
    const d = dist(a, b)
    if (d === 0) {
      denseCum[i] = travelled
      continue
    }
    while (travelled + d >= (emitted + 1) * step) {
      const t = ((emitted + 1) * step - travelled) / d
      coords.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t])
      cum.push((emitted + 1) * step)
      emitted++
    }
    travelled += d
    denseCum[i] = travelled
  }
  coords.push(dense[dense.length - 1]!)
  cum.push(travelled)
  // `wpS` bleibt je EINGEGEBENEM Wegpunkt ein Wert — die Zwischenpunkte der
  // Verdichtung tauchen hier nicht auf. Stützpunkt `k` steckt in
  // `dense[k * SEGS]`, also der Original-Wegpunkt `j` in `original[j] * SEGS`.
  const wpS = original.map((k) => denseCum[Math.min(k * SEGS, dense.length - 1)] ?? 0)

  let gain = 0
  for (let i = 1; i < coords.length; i++) {
    const dEle = coords[i]![2] - coords[i - 1]![2]
    if (dEle > 0) gain += dEle
  }

  return { coords, cum, total: travelled, gain, wpS }
}

// Erster Stützpunkt-Index mit cum[i] >= s (binäre Suche)
export function indexAt(route: Route, s: number): number {
  const { cum } = route
  let lo = 0
  let hi = cum.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (cum[mid]! < s) lo = mid + 1
    else hi = mid
  }
  return lo
}

// Position [lng, lat, ele] bei Streckenmeter s
export function pointAt(route: Route, s: number): Wegpunkt {
  const { coords, cum, total } = route
  const c = Math.max(0, Math.min(s, total))
  const i = Math.max(1, indexAt(route, c))
  const a = coords[i - 1]!
  const b = coords[i]!
  const span = cum[i]! - cum[i - 1]! || 1
  const t = (c - cum[i - 1]!) / span
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

export function bearingAt(route: Route, s: number): number {
  const a = pointAt(route, s)
  const b = pointAt(route, Math.min(s + 30, route.total))
  if (dist(a, b) < 1) return bearing(pointAt(route, Math.max(0, s - 30)), a)
  return bearing(a, b)
}

// Streckenmeter des Punktes, der `lnglat` am nächsten liegt
export function nearestS(route: Route, lnglat: LngLat): number {
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < route.coords.length; i++) {
    const d = dist(route.coords[i]!, lnglat)
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return route.cum[best]!
}

/**
 * Streckenmeter, unter denen zwei Fotos als „am selben Ort" gelten.
 * Das Studio spiegelt den Wert (NAHE_M in src/studio/stopps.ts); ein
 * Drift-Wächter in test/studio-stopps.test.ts vergleicht beide.
 */
export const NAHE_M = 120

/** Ein Foto, wie die Gruppierung es braucht: verankert an `s`, optional gereiht. */
export interface StoppFoto {
  /** Streckenmeter des Ankers */
  s: number
  /** Platz im Halt (0-basiert, im Studio gesetzt) */
  order?: number
}

/** Ein Halt: Streckenmeter des ERSTEN Fotos plus alle Aufnahmen dort. */
export interface Stopp<T extends StoppFoto> {
  s: number
  items: T[]
}

/**
 * Fotos zu Stopps gruppieren: Wer weniger als `naheM` Streckenmeter vom
 * Vorgänger entfernt liegt, gehört zum selben Halt — dort werden die Bilder
 * nacheinander gezeigt (ein Halt, mehrere Aufnahmen).
 *
 * Innerhalb eines Stopps entscheidet `reihe` (im Studio gesetzt) über die
 * Abfolge; ohne das Feld bleibt es bei der Reihenfolge nach Streckenmetern.
 * Das ist der einzige Ort, an dem `reihe` wirkt — die Sortierung der Stopps
 * untereinander bleibt die Strecke.
 *
 * Erwartet Fotos MIT `s` (Streckenmeter), aufsteigend sortiert.
 */
export function gruppiereStopps<T extends StoppFoto>(photos: T[], naheM = NAHE_M): Array<Stopp<T>> {
  const stops: Array<Stopp<T>> = []
  for (const p of photos) {
    const last = stops[stops.length - 1]
    if (last && p.s - last.s < naheM) last.items.push(p)
    else stops.push({ s: p.s, items: [p] })
  }
  for (const stop of stops) {
    if (stop.items.length < 2) continue
    // Geteilt mit dem Editor (src/einblendung.ts) — die natürliche Ordnung ist
    // hier die Strecke, im Studio die Aufnahmezeit.
    stop.items = reihenfolgeImHalt(stop.items, (p) => p.s)
  }
  return stops
}
