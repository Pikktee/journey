// Die Film-Achse der Pipeline: Aufnahmezeit ↔ Filmsekunde ↔ Streckenanteil.
//
// Warum der Server das braucht: Ein Ton-Klip hängt seit Etappe 4 an einem ANKER
// in Aufnahmezeit plus einem VERSATZ in Filmsekunden (docs §2E). Der Versatz
// darf mitten in einer Standzeit liegen — dort steht die Aufnahmeuhr still,
// während der Film weiterläuft. Ohne eine Achse, die die Halte kennt, wäre
// „3 Sekunden nach dem Anker" beim Rendern nicht auffindbar.
//
// Das hier ist der SERVER-Spiegel von `baueFilmachse` in src/film-axis.ts.
// Beide müssen dasselbe rechnen, sonst startet ein Klip im fertigen Film woanders
// als im Editor gezeigt — genau die Sorte Drift, an der schon die
// Gehabschnitts-Erkennung einmal hing. Deshalb: dieselbe Gruppierung (120
// Streckenmeter, src/geo.ts), dieselben Halt-Dauern (`mediumHoldS` +
// Ausblendung), dieselben RAMPEN (E14 — an jedem Tempowechsel, am Halt auf
// beiden Seiten, an einer Modus-Grenze ganz im schnelleren Abschnitt) und
// dieselbe Interpolations-Konvention (Plateau → Ankunft).
//
// **Gerechnet wird über die STRECKE, die Anker bleiben Aufnahmezeit** — genau
// wie im Editor (src/studio/timeline.ts, `baueAchse`). Das ist seit E12 keine
// Wahl mehr: Die Rampen sind eine Form über einer STRECKE, über der Aufnahmeuhr
// ließen sie sich nicht ausdrücken. Aufnahmezeit ↔ Filmzeit geht deshalb in
// zwei Schritten, über den Adapter `tS`/`mM`.

import type { CameraMomentKind } from '../schema/edits.js'
import {
  STOP_FADE_OUT_S,
  NEAR_M,
  RAMP_M,
  mediumHoldS,
  momentHoldS,
  tempoMps,
} from './film-tempo.js'
import type { TimeSeries } from './time.js'

/** Ein Halt auf der Achse: wann er beginnt (Aufnahmezeit) und was er im Film kostet. */
export interface AxisStop {
  offsetS: number
  widthS: number
}

/**
 * Aufnahmezeit ↔ Strecke ↔ Filmzeit, stückweise linear.
 *
 * `tS`/`mM` ist der Zeit→Strecke-Adapter (je Stützpunkt seine Aufnahmesekunde
 * und sein Meterstand); `sM`/`filmS` ist die eigentliche Achse. `sM` ist nicht
 * streng monoton: Jeder Halt liegt als PAAR gleicher Meterwerte darin (Ankunft
 * und Abfahrt) — das Plateau, in dem der Film läuft und die Strecke steht.
 */
export interface FilmAxis {
  tS: number[]
  mM: number[]
  sM: number[]
  filmS: number[]
  totalS: number
}

/** Meter zwischen zwei Punkten (lokale Plattkarte — auf Segmentlänge genau genug). */
function metersBetween(a: { lng: number; lat: number }, b: { lng: number; lat: number }): number {
  const kx = 111_320 * Math.cos((a.lat * Math.PI) / 180)
  const dx = (b.lng - a.lng) * kx
  const dy = (b.lat - a.lat) * 110_540
  return Math.sqrt(dx * dx + dy * dy)
}

/**
 * Lineare Interpolation mit lower_bound-Konvention.
 *
 * Bei doppelten Stützstellen (Halt) liefert sie den LINKEN Wert — die Ankunft.
 * Dieselbe Konvention wie `interpoliere` in src/studio/timeline.ts; eine
 * andere Wahl verschöbe jeden Anker, der genau auf einer Halt-Zeit sitzt, um
 * die ganze Standzeit.
 */
function interpolate(xs: readonly number[], ys: readonly number[], x: number): number {
  const n = xs.length
  if (n === 0) return 0
  if (x <= (xs[0] as number)) return ys[0] as number
  if (x >= (xs[n - 1] as number)) return ys[n - 1] as number
  let lo = 0
  let hi = n - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if ((xs[mid] as number) < x) lo = mid + 1
    else hi = mid
  }
  const a = xs[lo - 1] as number
  const b = xs[lo] as number
  const span = b - a
  const u = span > 0 ? (x - a) / span : 1
  return (ys[lo - 1] as number) + u * ((ys[lo] as number) - (ys[lo - 1] as number))
}

/**
 * Weganteil der Rampe nach dem Zeitanteil `u`, von Tempo `v0` auf `v1` —
 * Spiegel von `rampenWeg` in src/film-axis.ts.
 *
 * Die Geschwindigkeit folgt `v0 + (v1 − v0) · smoothstep(u)`: sanft an, in der
 * Mitte am stärksten, sanft ins neue Tempo. Daraus die zwei Zahlen, die die
 * Rechnung tragen: `w(1) = 1` und die Dauer `T = 2L / (v0 + v1)` — die Strecke
 * durch das MITTLERE Tempo. Für `v0 = 0` fällt daraus die Halt-Rampe heraus
 * (`2u³ − u⁴`, `T = 2L/v1`).
 */
function rampDistance(u: number, v0: number, v1: number): number {
  const mean = (v0 + v1) / 2
  if (!(mean > 0)) return u
  return (v0 * u + (v1 - v0) * (u * u * u - (u * u * u * u) / 2)) / mean
}

/** Stützstellen je Rampe — dieselbe Abtastung wie im Web. */
const RAMP_STEPS = 12

/** Ein Punkt der Achse, an dem sich das Tempo ändert — Spiegel von `Rampenknoten`. */
interface RampNode {
  at: number
  stops: AxisStop[]
  vLeft: number
  vRight: number
  wantL: number
  wantR: number
  lenL: number
  lenR: number
}

/**
 * Film-Achse aus der (bereits getrimmten) Zeitreihe und den Halten.
 *
 * Fahrzeit kommt aus Strecke ÷ modusabhängigem Tempo — dieselbe Rechnung, mit
 * der die Engine fährt (film-tempo.ts) —, dazu die Rampen. Sie liegen an JEDEM
 * Tempowechsel: am Start, an jedem Halt (Sonderfall „von oder auf null") und an
 * jeder Modus-Grenze, dort ganz im schnelleren Abschnitt. `null`, wenn zu wenig
 * Material für eine Abbildung da ist; der Aufrufer fällt dann auf die alte
 * Aufnahmezeit-Verankerung zurück, statt zu raten.
 *
 * `rampeM` ist nur für das Verhaltens-Fixture offen: Es beschreibt die FORM der
 * Rampe mit runden Längen, die Dosierung steht als `RAMP_M` in film-tempo.ts.
 */
export function buildFilmAxis(
  series: TimeSeries,
  stops: readonly AxisStop[],
  rampM: number = RAMP_M,
): FilmAxis | null {
  // — Der Zeit→Strecke-Adapter und die Tempo-Stufen über der Strecke —
  const tS: number[] = []
  const mM: number[] = []
  const steps: Array<{ abM: number; v: number }> = []
  let meters = 0
  const points = series.points
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    if (!p) continue
    if (i > 0) {
      const before = points[i - 1]
      // Das Tempo des Punktes, VON dem gefahren wird — Grenzen wirken ab ihrem
      // Punkt, exakt wie in der Studio-Achse.
      if (before) meters += metersBetween(before, p)
    }
    const v = tempoMps(p.mode)
    const last = steps[steps.length - 1]
    if (!last) steps.push({ abM: 0, v })
    else if (last.abM === meters) last.v = v
    else if (last.v !== v) steps.push({ abM: meters, v })
    const prev = tS.length - 1
    if (prev >= 0 && tS[prev] === p.tSec && mM[prev] === meters) continue
    tS.push(p.tSec)
    mM.push(meters)
  }
  if (tS.length < 2 || !(meters > 0) || steps.length === 0) return null
  const totalM = meters
  // Tempowechsel in der Rampenzone eines Halts wandern AUF den Halt — sonst
  // quetschen sich Wechsel- und Halt-Rampe in die paar Meter dazwischen, und
  // der Film beschleunigt auf voller Höhe, um sofort wieder zu stehen (an
  // Stockholm gemessen: Grenze zu Fuß → Fähre 13 m vor einem Halt).
  const stopPositions = [...stops]
    .filter((h) => h.widthS > 0)
    .map((h) => Math.max(0, Math.min(totalM, interpolate(tS, mM, h.offsetS))))
    .sort((a, b) => a - b)
  if (rampM > 0 && stopPositions.length > 0 && steps.length > 1) {
    for (const st of steps.slice(1)) {
      let nextPoint: number | undefined
      for (const o of stopPositions) {
        const dist = Math.abs(o - st.abM)
        if (dist < rampM && (nextPoint === undefined || dist < Math.abs(nextPoint - st.abM)))
          nextPoint = o
      }
      if (nextPoint !== undefined) st.abM = nextPoint
    }
    steps.sort((a, b) => a.abM - b.abM)
    const cleared: Array<{ abM: number; v: number }> = []
    for (const st of steps) {
      const last = cleared[cleared.length - 1]
      if (!last) cleared.push(st)
      else if (last.abM === st.abM) last.v = st.v
      else if (last.v !== st.v) cleared.push(st)
    }
    steps.length = 0
    steps.push(...cleared)
  }

  const tempoAt = (m: number): number => {
    let v = (steps[0] as { v: number }).v
    for (const st of steps) if (st.abM <= m) v = st.v
    return v
  }

  // — Die Rampenknoten —
  //
  // Halte auf die Strecke ziehen — nach ZEIT vorsortiert, damit mehrere Halte
  // in derselben realen Pause (gleicher Meterstand) ihre Reihenfolge behalten.
  const nodes: RampNode[] = []
  const nodeAt = (at: number): RampNode => {
    const da = nodes.find((k) => k.at === at)
    if (da) return da
    const fresh: RampNode = {
      at,
      stops: [],
      vLeft: at <= 0 ? 0 : tempoAt(at - 1e-9),
      vRight: at >= totalM ? 0 : tempoAt(at),
      wantL: 0,
      wantR: 0,
      lenL: 0,
      lenR: 0,
    }
    nodes.push(fresh)
    return fresh
  }
  nodeAt(0)
  nodeAt(totalM)
  for (const st of steps.slice(1)) if (st.abM > 0 && st.abM < totalM) nodeAt(st.abM)
  for (const h of [...stops].filter((x) => x.widthS > 0).sort((a, b) => a.offsetS - b.offsetS)) {
    nodeAt(Math.max(0, Math.min(totalM, interpolate(tS, mM, h.offsetS)))).stops.push(h)
  }
  nodes.sort((a, b) => a.at - b.at)

  for (const k of nodes) {
    const atStart = k.at <= 0
    const atEnd = k.at >= totalM
    if (k.stops.length > 0) {
      k.wantL = atStart ? 0 : rampM
      k.wantR = atEnd ? 0 : rampM
    } else if (atStart) {
      k.wantR = rampM
    } else if (!atEnd) {
      // Modus-Grenze: EINE Rampe, ganz im SCHNELLEREN Abschnitt — beim
      // Beschleunigen hinter der Grenze, beim Verzögern davor. Symmetrisch
      // gelegt liefe der langsamere Modus auf seinen letzten Metern schon mit
      // dem Tempo des schnelleren.
      if (k.vRight > k.vLeft) k.wantR = rampM
      else k.wantL = rampM
    }
  }
  // Kollidierende Rampen teilen sich die Lücke anteilig nach ihrem Bedarf.
  for (let i = 0; i + 1 < nodes.length; i++) {
    const left = nodes[i] as RampNode
    const right = nodes[i + 1] as RampNode
    const gap = Math.max(0, right.at - left.at)
    const need = left.wantR + right.wantL
    const factor = need > gap ? (need > 0 ? gap / need : 0) : 1
    left.lenR = left.wantR * factor
    right.lenL = right.wantL * factor
  }

  // — Der Durchgang —
  const sM: number[] = [0]
  const filmS: number[] = [0]
  let pos = 0
  let filmAt = 0

  const put = (m: number, f: number): void => {
    const n = sM.length
    if (n > 0 && sM[n - 1] === m && filmS[n - 1] === f) return
    sM.push(m)
    filmS.push(f)
  }

  const travel = (to: number): void => {
    while (pos < to) {
      let next = to
      for (const st of steps) if (st.abM > pos && st.abM < next) next = st.abM
      filmAt += (next - pos) / tempoAt(pos)
      pos = next
      put(pos, filmAt)
    }
  }

  const ramp = (from: number, length: number, v0: number, v1: number): void => {
    if (!(length > 0) || !(v0 + v1 > 0)) return
    const duration = (2 * length) / (v0 + v1)
    const base = filmAt
    for (let k = 1; k <= RAMP_STEPS; k++) {
      const u = k / RAMP_STEPS
      put(from + length * rampDistance(u, v0, v1), base + duration * u)
    }
    filmAt = base + duration
    pos = from + length
  }

  for (const k of nodes) {
    travel(k.at - k.lenL)
    if (k.stops.length > 0) {
      ramp(pos, k.lenL, k.vLeft, 0)
      for (const h of k.stops) {
        put(k.at, filmAt)
        sM.push(k.at)
        filmS.push(filmAt + h.widthS)
        filmAt += h.widthS
      }
      pos = k.at
      ramp(k.at, k.lenR, 0, k.vRight)
    } else {
      ramp(k.at - k.lenL, k.lenL + k.lenR, k.vLeft, k.vRight)
    }
  }
  travel(totalM)

  const totalS = filmS[filmS.length - 1] as number
  if (!(totalS > 0)) return null
  return { tS, mM, sM, filmS, totalS }
}

/** Filmsekunde zu einer Aufnahmezeit — zwei Schritte: Zeit → Strecke → Film. */
export function filmTimeAtRecordingTime(axis: FilmAxis, tSek: number): number {
  return interpolate(axis.sM, axis.filmS, interpolate(axis.tS, axis.mM, tSek))
}

/**
 * Aufnahmezeit zu einer Filmsekunde (Umkehrung; im Halt → dessen Zeit).
 *
 * Der Rückweg Strecke → Zeit ist in einer realen PAUSE mehrdeutig — dort gilt
 * die Ankunft, dieselbe lower_bound-Konvention wie überall.
 */
export function recordingTimeAtFilmTime(axis: FilmAxis, filmS: number): number {
  return interpolate(axis.mM, axis.tS, interpolate(axis.filmS, axis.sM, filmS))
}

/**
 * Anker [lng,lat] auf die Zeitreihe projizieren: Streckenmeter und Zeit-Offset.
 *
 * Gemessen wird auf die STRECKE zwischen zwei Stützpunkten, nicht auf den
 * nächsten Stützpunkt — auf einem grob abgetasteten Track (Alpen-Serpentinen,
 * 30-s-Raster) liegen die Punkte weit auseinander, und ein Halt spränge sonst
 * um mehrere Sekunden. Spiegel von `projiziereAufTrack` (edit-model.ts).
 */
export function projectOntoTimeSeries(
  series: TimeSeries,
  lng: number,
  lat: number,
): { meters: number; offsetS: number } {
  const points = series.points
  const first = points[0]
  if (!first) return { meters: 0, offsetS: 0 }
  const kx = 111_320 * Math.cos((first.lat * Math.PI) / 180)
  let bestD2 = Infinity
  let meters = first.dist
  let offsetS = first.tSec
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    if (!a || !b) continue
    const ax = a.lng * kx
    const ay = a.lat * 110_540
    const bx = b.lng * kx
    const by = b.lat * 110_540
    const px = lng * kx
    const py = lat * 110_540
    const dx = bx - ax
    const dy = by - ay
    const length2 = dx * dx + dy * dy
    const u =
      length2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length2)) : 0
    const fx = ax + u * dx
    const fy = ay + u * dy
    const d2 = (px - fx) * (px - fx) + (py - fy) * (py - fy)
    if (d2 < bestD2) {
      bestD2 = d2
      meters = a.dist + u * (b.dist - a.dist)
      offsetS = a.tSec + u * (b.tSec - a.tSec)
    }
  }
  return { meters, offsetS }
}

/**
 * Aufnahmen zu Halten gruppieren — Spiegel von `baueStopps`
 * (src/studio/stops.ts) und `gruppiereStopps` (src/geo.ts).
 *
 * Gemessen wird zum ANFANG des Halts, nicht zum Vorgänger: sonst könnte eine
 * Perlenkette knapp benachbarter Aufnahmen zu einem beliebig langen Stopp
 * verschmelzen. Die Breite ist die Summe der Standzeiten samt Ausblendung —
 * ein Halt mit drei Fotos ist im Film eine Folge von dreien.
 */
export function buildAxisStops(
  media: ReadonlyArray<{
    type: 'photo' | 'video'
    /** Streckenmeter des Ankers (unplatzierte Medien gehören nicht in die Liste) */
    meters: number
    /** Sekunden ab time.start */
    offsetS: number
    durationS?: number
    display?: { holdS?: number }
  }>,
  nearM = NEAR_M,
): AxisStop[] {
  const sorted = [...media].sort((a, b) => a.meters - b.meters)
  const groups: Array<{ startM: number; offsets: number[]; widthS: number }> = []
  for (const m of sorted) {
    const last = groups[groups.length - 1]
    const duration = mediumHoldS(m) + STOP_FADE_OUT_S
    if (last && m.meters - last.startM < nearM) {
      last.offsets.push(m.offsetS)
      last.widthS += duration
    } else {
      groups.push({ startM: m.meters, offsets: [m.offsetS], widthS: duration })
    }
  }
  return groups.map((g) => ({
    offsetS: g.offsets.reduce((s, v) => s + v, 0) / g.offsets.length,
    widthS: g.widthS,
  }))
}

/**
 * Kamera-Momente als Halte — Spiegel von `achsenHalte` (src/studio/editor.ts).
 *
 * Ein Moment ist grammatikalisch ein HALT: die Fahrt steht, die Kamera tut
 * etwas, Filmzeit vergeht (src/tour.ts, Phase `moment`). Er gehört deshalb
 * genauso in die Achse wie eine Foto-Kette — fehlte er, wäre die Achse um seine
 * Dauer zu kurz: Ein Ton-Klip, dessen Versatz (Anker + Filmsekunden) ÜBER den
 * Moment reicht, bekäme eine zu weit vorn liegende Streckenstelle und klänge im
 * fertigen Film um die Momentdauer SPÄTER als im Editor gezeigt — der Player
 * fährt den Moment ja mit.
 *
 * Anders als Aufnahmen werden Momente NICHT gruppiert: Jeder ist ein eigenes
 * Ereignis mit eigener Dauer, und zwei dicht beieinander sind im Film zwei
 * Halte hintereinander. `webeHalte` sortiert selbst.
 */
export function buildMomentStops(
  moments: ReadonlyArray<{
    /** Sekunden ab time.start */
    offsetS: number
    kind: CameraMomentKind
    durationS?: number | undefined
  }>,
): AxisStop[] {
  return moments.map((m) => ({ offsetS: m.offsetS, widthS: momentHoldS(m) }))
}
