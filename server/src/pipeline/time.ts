// Zeit-Werkzeuge der Anreicherungs-Pipeline: verkettet die Segmente zu einer
// Zeitreihe (Position + kumulierte Distanz + Zeit-Offset je Punkt) und
// destilliert daraus die `timeline`-Stützstellen f→Pseudo-Zeit fürs Tour-JSON.
//
// Kern-Designentscheid: Eine Pause hat keine Streckenausdehnung — der Film
// fährt nach Strecke, die Uhr läuft nach Zeit. Zwei Stunden Kino wären an
// dieser Stelle also ein SPRUNG der Pseudo-Uhr (und damit der Sonne) von hell
// auf dunkel, mitten in der Fahrt.
//
// Bis Juli 2026 wurde die Pause deshalb auf zwei Minuten gestaucht. Das nahm
// den Ruck, verschob aber alles Folgende: Nach zwei Stunden Pause zeigte die
// Telemetrie bis zum Tourende gut zwei Stunden zu früh an — an einer echten
// Tour endete die Anzeige um 20:51, während die Fotos derselben Minuten schon
// „22:48" untertitelt waren und es draußen längst dunkel war.
//
// Stattdessen läuft die Pause jetzt als ZEITRAFFER ab: außerhalb eines kurzen
// Streckenfensters um die Pause gilt überall die echte Aufnahmezeit, im Fenster
// vergeht sie im Schnelldurchlauf. Der Himmel dreht dort sichtbar von Dämmerung
// auf Nacht — ein etabliertes filmisches Mittel, das die Pause miterzählt,
// statt sie zu verschlucken. Bemessen wird das Fenster in FILMsekunden
// (film-tempo.ts), nicht in Metern: 200 m sind zu Fuß vier Sekunden und auf der
// Fähre eine halbe.

import type { TravelMode, UploadPoint, UploadSegment } from '../schema/upload.js'
import { metersForFilmSeconds } from './film-tempo.js'
import { distanceM } from './geo.js'

/** Punkt der verketteten Zeitreihe. */
export interface TimePoint {
  lng: number
  lat: number
  /** kumulierte Distanz ab Tour-Start (m), inkl. Sprünge zwischen Segmenten */
  dist: number
  /** Sekunden ab time.start — monoton nicht-fallend erzwungen */
  tSec: number
  /** Fortbewegung des Segments, aus dem der Punkt stammt */
  mode: TravelMode
}

export interface TimeSeries {
  points: TimePoint[]
  totalM: number
  durationS: number
}

/** Pause: Indexbereich in der Zeitreihe, in dem Zeit ohne Ortswechsel verging. */
export interface Pause {
  fromIdx: number
  toIdx: number
  durationS: number
}

/** Pausen ab dieser Dauer laufen als Zeitraffer ab. */
export const PAUSE_MIN_S = 15 * 60

/**
 * Filmdauer des Zeitraffers — kurze Pause / sehr lange Pause.
 *
 * Die Rampe wächst mit der übersprungenen Dauer: Zwanzig Minuten sind ein
 * Wimpernschlag Dämmerung, zwei Stunden ein halber Sonnenuntergang. Bekäme
 * beides dieselben drei Sekunden, zuckte das Licht bei der langen Pause.
 */
export const RAMP_MIN_FILM_S = 3
export const RAMP_MAX_FILM_S = 7
/** Ab dieser Pausendauer ist die Rampe voll ausgefahren. */
const RAMP_FULL_S = 4 * 3600
// Aufenthaltsradius: GPS rauscht im Stand (Accuracy-Filter der App lässt bis
// 30 m durch) und eine „Pause" darf ein kurzer Gang zum Kiosk sein.
const PAUSE_RADIUS_M = 150
// Zielgenauigkeit des Destillats: max. Abweichung der stückweise linearen
// Pseudo-Zeit von der komprimierten Wahrheit (die Sonne wandert ~1° je 4 min).
const DISTILL_TOLERANCE_S = 45
const DISTILL_MAX_POINTS = 300

/** Segmente zu einer Zeitreihe verketten; Zeit-Offsets werden monoton geklemmt. */
export function buildTimeSeries(segments: readonly UploadSegment[]): TimeSeries {
  const points: TimePoint[] = []
  let dist = 0
  let tSec = 0
  for (const seg of segments) {
    for (const p of seg.pts) {
      const [lng = 0, lat = 0, , t = 0] = p
      const before = points[points.length - 1]
      if (before) dist += distanceM([before.lng, before.lat], [lng, lat])
      tSec = Math.max(tSec, t)
      points.push({ lng, lat, dist, tSec, mode: seg.mode })
    }
  }
  const first = points[0]
  const last = points[points.length - 1]
  return { points, totalM: dist, durationS: first && last ? last.tSec - first.tSec : 0 }
}

/**
 * Pausen finden: maximale Bereiche, in denen alle Punkte im Aufenthaltsradius
 * um den Bereichs-Anfang bleiben und dabei ≥ PAUSE_MIN_S vergehen. Das fängt
 * beide Erscheinungsformen — die Punktwolke im Stand (App speichert alle 30 s
 * weiter) wie die einzelne Aufzeichnungslücke am selben Ort.
 */
export function findPauses(series: TimeSeries): Pause[] {
  const { points } = series
  // Fürs Suchen reicht ein ≥10-s-Zeitraster — das deckelt die Fensterbreite
  // (und damit die Distanzrechnungen) auch bei sekündlich dichten GPX-Quellen.
  const grid: number[] = []
  let lastT = -Infinity
  for (let i = 0; i < points.length; i++) {
    const p = points[i] as TimePoint
    if (p.tSec - lastT >= 10 || i === points.length - 1) {
      grid.push(i)
      lastT = p.tSec
    }
  }

  const pauses: Pause[] = []
  let a = 0
  while (a < grid.length - 1) {
    const anchor = points[grid[a] as number] as TimePoint
    let b = a
    while (b + 1 < grid.length) {
      const candidate = points[grid[b + 1] as number] as TimePoint
      if (distanceM([anchor.lng, anchor.lat], [candidate.lng, candidate.lat]) > PAUSE_RADIUS_M)
        break
      b++
    }
    const end = points[grid[b] as number] as TimePoint
    if (b > a && end.tSec - anchor.tSec >= PAUSE_MIN_S) {
      pauses.push({
        fromIdx: grid[a] as number,
        toIdx: grid[b] as number,
        durationS: end.tSec - anchor.tSec,
      })
      a = b
    } else {
      a++
    }
  }
  return pauses
}

/** Filmdauer des Zeitraffers für eine Pause dieser Länge (s). */
function rampFilmS(durationS: number): number {
  const u = Math.min(1, Math.max(0, durationS) / RAMP_FULL_S)
  return RAMP_MIN_FILM_S + u * (RAMP_MAX_FILM_S - RAMP_MIN_FILM_S)
}

/**
 * Pseudo-Zeit je Punkt (s ab time.start): überall die ECHTE Aufnahmezeit, nur
 * um jede Pause herum ein Zeitraffer.
 *
 * Das Fenster reicht eine halbe Rampenlänge vor die Pause und ebenso weit
 * dahinter; innerhalb läuft die Zeit linear mit der STRECKE, außerhalb bleibt
 * sie unangetastet. Am Fensterrand stimmen beide überein — nach der Pause geht
 * die Uhr also wieder richtig, und das Tourende trägt die Uhrzeit, zu der es
 * wirklich stattfand.
 *
 * Die Pausenpunkte selbst liegen (nach `collapsePauses`) alle auf demselben
 * Ort und bekommen deshalb dieselbe Pseudo-Zeit — im Film ist die Pause ein
 * Augenblick, kein Halt. Erzählt wird sie von der Rampe drumherum.
 */
export function compressPauses(series: TimeSeries, pauses: readonly Pause[]): number[] {
  const { points } = series
  const out = points.map((p) => p.tSec)
  if (points.length < 2 || !pauses.length) return out

  // Fenster in Indizes: letzte Stützstelle vor der Rampe → erste dahinter.
  // Überlappende Fenster (zwei Pausen dicht beieinander) werden verschmolzen —
  // sonst überschriebe die zweite Rampe den vorgezogenen Rand der ersten und
  // die Uhr liefe an der Nahtstelle rückwärts.
  const window: Array<{ a: number; b: number }> = []
  for (const pause of pauses) {
    const halfM =
      metersForFilmSeconds(rampFilmS(pause.durationS), (points[pause.fromIdx] as TimePoint).mode) /
      2
    const fromM = (points[pause.fromIdx] as TimePoint).dist - halfM
    const toM = (points[pause.toIdx] as TimePoint).dist + halfM
    let a = pause.fromIdx
    while (a > 0 && (points[a - 1] as TimePoint).dist >= fromM) a--
    let b = pause.toIdx
    while (b < points.length - 1 && (points[b + 1] as TimePoint).dist <= toM) b++
    const lastItem = window[window.length - 1]
    if (lastItem && a <= lastItem.b) lastItem.b = Math.max(lastItem.b, b)
    else window.push({ a, b })
  }

  for (const { a, b } of window) {
    const from = points[a] as TimePoint
    const to = points[b] as TimePoint
    const spanM = to.dist - from.dist
    for (let i = a + 1; i < b; i++) {
      const p = points[i] as TimePoint
      const u = spanM > 0 ? (p.dist - from.dist) / spanM : 0
      out[i] = from.tSec + u * (to.tSec - from.tSec)
    }
  }

  // Netz gegen Rundungsreste: die Pseudo-Zeit muss monoton bleiben, sonst
  // liefe die Sonne stellenweise rückwärts.
  for (let i = 1; i < out.length; i++) out[i] = Math.max(out[i] as number, out[i - 1] as number)
  return out
}

/** Unter dieser Rest-Strecke bleibt der Kollaps aus — eine Tour, die fast nur
 *  aus Pause besteht, würde sonst zur punktförmigen Route (Player: NaN). */
export const COLLAPSE_MIN_REMAINDER_M = 30

/**
 * GPS-Drift in Pausen geometrisch stilllegen: Wer steht, kommt nicht vom
 * Fleck — das GPS schon (200 m in 23 min sind normal). Diese Drift wurde zu
 * echter Strecke: die Kamera zitterte im Film minutenlang auf der Stelle, die
 * km-Statistik zählte Meter, die niemand gegangen ist.
 *
 * Alle Punkte einer erkannten Pause (findePausen: ≥ 15 min im 150-m-Radius)
 * rücken auf ihren Schwerpunkt; die ZEITEN bleiben unangetastet — jeder
 * Overlay-Anker (ISO-Zeitstempel) und die Pseudo-Zeit-Kompression gelten
 * weiter. An Segment-Nähten liegt der Grenzpunkt als Kopie in beiden
 * Segmenten; ragt eine Pause bis an die Naht, werden zeit- und ortsgleiche
 * Duplikate mitgezogen, sonst bliebe eine Kopie stehen und risse einen
 * künstlichen Sprung in die Route.
 */
export function collapsePauses(segs: readonly UploadSegment[]): UploadSegment[] {
  const series = buildTimeSeries(segs)
  const pauses = findPauses(series)
  if (!pauses.length) return [...segs]

  // Flach-Index → (Segment, Punkt), in der Verkettungsreihenfolge der Zeitreihe
  const byIndex: Array<{ seg: number; pt: number }> = []
  segs.forEach((s, seg) => s.pts.forEach((_, pt) => byIndex.push({ seg, pt })))

  const pointAt = (i: number): TimePoint => series.points[i] as TimePoint
  const duplicate = (a: TimePoint, b: TimePoint): boolean =>
    a.tSec === b.tSec && a.lng === b.lng && a.lat === b.lat

  // Ziel-Koordinate je betroffenem Flach-Index
  const out2 = new Map<number, [number, number, number]>()
  for (const pause of pauses) {
    let from = pause.fromIdx
    let to = pause.toIdx
    while (from > 0 && duplicate(pointAt(from - 1), pointAt(from))) from--
    while (to < series.points.length - 1 && duplicate(pointAt(to + 1), pointAt(to))) to++

    let sLng = 0
    let sLat = 0
    let sEle = 0
    const n = to - from + 1
    for (let i = from; i <= to; i++) {
      const { seg, pt } = byIndex[i] as { seg: number; pt: number }
      const [lng = 0, lat = 0, ele = 0] = (segs[seg] as UploadSegment).pts[pt] as UploadPoint
      sLng += lng
      sLat += lat
      sEle += ele
    }
    for (let i = from; i <= to; i++) out2.set(i, [sLng / n, sLat / n, sEle / n])
  }

  // Nur betroffene Segmente kopieren; die Zeiten (Index 3) bleiben byte-gleich
  const segStart: number[] = []
  let run = 0
  for (const s of segs) {
    segStart.push(run)
    run += s.pts.length
  }
  const fresh = segs.map((s, seg) => {
    const start = segStart[seg] as number
    if (!s.pts.some((_, pt) => out2.has(start + pt))) return s
    return {
      ...s,
      pts: s.pts.map((p, pt): UploadPoint => {
        const z = out2.get(start + pt)
        return z ? [z[0], z[1], z[2], p[3]] : p
      }),
    }
  })

  return buildTimeSeries(fresh).totalM < COLLAPSE_MIN_REMAINDER_M ? [...segs] : fresh
}

/** Pseudo-Zeit der ganzen Tour je Punkt (echte Zeit + Zeitraffer an den Pausen). */
export function pseudoTimes(series: TimeSeries): number[] {
  return compressPauses(series, findPauses(series))
}

/**
 * Streckenanteil, an dem die Pseudo-Uhr die Aufnahmezeit `tSek` ZEIGT.
 *
 * Die Umkehrung von `compressPauses` und damit das Gegenstück zu
 * `positionAtTime`: Jene beantwortet „wo war die Tour um 21 Uhr?" (der Ort,
 * für den das Wetter gilt), diese „an welcher Stelle des Films steht 21 Uhr
 * auf der Uhr?". In einer Pause fallen alle Stunden auf denselben ORT — aber
 * auf verschiedene Stellen der Zeitraffer-Rampe. Ohne diese Unterscheidung
 * landeten alle Wetter-Samples einer Pause auf demselben f und nur der letzte
 * überlebte: Ein Regen, der während der Pause einsetzte und wieder aufhörte,
 * verschwand spurlos.
 */
export function clockTimeAtFraction(
  series: TimeSeries,
  pseudo: readonly number[],
  tSec: number,
): number {
  const { points, totalM } = series
  if (points.length < 2 || totalM <= 0) return 0
  const frac = (i: number): number => (points[i] as TimePoint).dist / totalM
  if (tSec <= (pseudo[0] as number)) return frac(0)
  const last = pseudo.length - 1
  if (tSec >= (pseudo[last] as number)) return frac(last)

  // Binärsuche: erster Index mit pseudo >= gesucht (pseudo ist monoton)
  let lo = 0
  let hi = last
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if ((pseudo[mid] as number) < tSec) lo = mid + 1
    else hi = mid
  }
  const span = (pseudo[lo] as number) - (pseudo[lo - 1] as number)
  const u = span > 0 ? (tSec - (pseudo[lo - 1] as number)) / span : 0
  return frac(lo - 1) + u * (frac(lo) - frac(lo - 1))
}

/**
 * Timeline-Destillat: wenige Stützstellen [{f, t}] (stückweise linear), die die
 * gerafften Zeitkurve bis auf DESTILLAT_TOLERANZ_S treffen. `undefined` bei
 * degenerierten Touren (keine Strecke / keine Zeitspanne / kaputter Start) —
 * der Player fällt dann auf die lineare Pseudo-Zeit zurück.
 *
 * Die Zeitraffer-Rampe übersteht das Destillat unbeschadet: Sie ist linear in
 * der Strecke und damit durch ihre beiden Endpunkte exakt beschrieben, und ihre
 * Knicke sind die Stellen mit der größten Abweichung — genau das, was
 * Douglas-Peucker als Erstes behält.
 */
export function distillTimeline(
  series: TimeSeries,
  startIso: string,
): Array<{ f: number; t: string }> | undefined {
  const startMs = Date.parse(startIso)
  if (!Number.isFinite(startMs)) return undefined
  if (series.points.length < 2 || series.totalM < 10 || series.durationS <= 0) return undefined

  const tCompressed = pseudoTimes(series)
  const f = series.points.map((p) => p.dist / series.totalM)

  let tolerance = DISTILL_TOLERANCE_S
  let keep = distill(f, tCompressed, tolerance)
  while (keep.length > DISTILL_MAX_POINTS) {
    tolerance *= 2
    keep = distill(f, tCompressed, tolerance)
  }

  const iso = (sec: number): string =>
    `${new Date(startMs + sec * 1000).toISOString().split('.')[0]}Z`
  const timeline: Array<{ f: number; t: string }> = []
  for (const i of keep) {
    const entry = { f: Math.round((f[i] as number) * 1e4) / 1e4, t: iso(tCompressed[i] as number) }
    const before = timeline[timeline.length - 1]
    if (before && before.f === entry.f && before.t === entry.t) continue
    timeline.push(entry)
  }
  return timeline.length >= 2 ? timeline : undefined
}

// Douglas-Peucker über der (monotonen) Kurve f→t mit vertikaler Zeit-Abweichung
// als Maß. Iterativ (Stack) wie vereinfacheSegment — lange Aufzeichnungen
// sollen keinen Callstack sprengen. Liefert sortierte Index-Liste.
function distill(f: readonly number[], t: readonly number[], toleranceS: number): number[] {
  const n = f.length
  const keep = new Array<boolean>(n).fill(false)
  keep[0] = keep[n - 1] = true
  const stack: Array<[number, number]> = [[0, n - 1]]
  while (stack.length) {
    const [from, to] = stack.pop() as [number, number]
    const fFrom = f[from] as number
    const fTo = f[to] as number
    const tFrom = t[from] as number
    const tTo = t[to] as number
    const span = fTo - fFrom
    let maxDist = 0
    let index = -1
    for (let i = from + 1; i < to; i++) {
      // Senkrechter f-Sprung (Pause): jede Zeitabweichung zählt gegen den Anfang
      const expected =
        span <= 0 ? tFrom : tFrom + (((f[i] as number) - fFrom) / span) * (tTo - tFrom)
      const dist = Math.abs((t[i] as number) - expected)
      if (dist > maxDist) {
        maxDist = dist
        index = i
      }
    }
    if (index >= 0 && maxDist > toleranceS) {
      keep[index] = true
      stack.push([from, index], [index, to])
    }
  }
  const indices: number[] = []
  for (let i = 0; i < n; i++) if (keep[i]) indices.push(i)
  return indices
}

/**
 * Position (und Streckenanteil) zur Tour-Zeit `tSek` — linear zwischen den
 * umgebenden Punkten interpoliert, außerhalb geklemmt. Grundlage der
 * Raum-Zeit-Samples des Auto-Wetters („wo war die Tour um 14 Uhr?").
 */
export function positionAtTime(
  series: TimeSeries,
  tSec: number,
): { lng: number; lat: number; f: number } {
  const { points, totalM } = series
  const first = points[0] as TimePoint
  const last = points[points.length - 1] as TimePoint
  const frac = (p: TimePoint): number => (totalM > 0 ? p.dist / totalM : 0)
  if (tSec <= first.tSec) return { lng: first.lng, lat: first.lat, f: frac(first) }
  if (tSec >= last.tSec) return { lng: last.lng, lat: last.lat, f: frac(last) }

  // Binärsuche: erster Punkt mit tSek >= gesucht (tSek ist monoton)
  let lo = 0
  let hi = points.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if ((points[mid] as TimePoint).tSec < tSec) lo = mid + 1
    else hi = mid
  }
  const b = points[lo] as TimePoint
  const a = points[lo - 1] as TimePoint
  const span = b.tSec - a.tSec
  const u = span > 0 ? (tSec - a.tSec) / span : 1
  return {
    lng: a.lng + u * (b.lng - a.lng),
    lat: a.lat + u * (b.lat - a.lat),
    f: frac(a) + u * (frac(b) - frac(a)),
  }
}

/**
 * Umkehrung von `positionAtTime`: Tour-Zeit zum Streckenanteil `f`.
 *
 * Gebraucht, um Streckenanteile des Tour-JSONs (Wetter-Keyframes) zurück in
 * absolute Zeiten zu übersetzen — die Ankerform aller Studio-Edits. Steht die
 * Tour (Pause), wächst `tSek` bei gleichbleibender Distanz: der Anteil ist dort
 * mehrdeutig, geliefert wird der FRÜHESTE Zeitpunkt (der Moment des Ankommens).
 * Außerhalb 0..1 wird geklemmt — f=1 ist damit immer das Tour-Ende, auch wenn
 * die Tour dort noch steht.
 */
export function timeAtPosition(series: TimeSeries, f: number): number {
  const { points, totalM } = series
  const first = points[0] as TimePoint | undefined
  const last = points[points.length - 1] as TimePoint | undefined
  if (!first || !last) return 0
  const out2 = Math.max(0, Math.min(1, f)) * totalM
  if (out2 <= first.dist) return first.tSec
  if (out2 >= last.dist) return last.tSec

  // Binärsuche: erster Punkt mit dist >= ziel (dist ist monoton)
  let lo = 0
  let hi = points.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if ((points[mid] as TimePoint).dist < out2) lo = mid + 1
    else hi = mid
  }
  const b = points[lo] as TimePoint
  const a = points[lo - 1] as TimePoint
  const span = b.dist - a.dist
  const u = span > 0 ? (out2 - a.dist) / span : 0
  return a.tSec + u * (b.tSec - a.tSec)
}
