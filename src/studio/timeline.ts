// Zeitleiste des Editors (Kreativbaukasten): reine Skalen- und Positions-
// Helfer über der Aufnahme-Zeitachse. Alles hier ist DOM-frei und unter
// Vitest testbar — die Leisten-Verdrahtung (Drag, Hover, Render) liegt in
// editor.ts. Positionen sind Anteile 0..1 der Aufnahmespanne, KEIN f
// (Streckenanteil): die Leiste zeigt die ZEIT der Aufzeichnung, damit
// Trim/Grenzen/Audio exakt an den absoluten Zeit-Ankern des Overlays hängen.

import { HOLD_AUSBLEND, HOLD_HIDE, standzeitS } from '../einblendung.js'
import {
  baueFilmachse,
  filmBeiStrecke,
  interpoliere,
  rampenVersatzS,
  streckeBeiFilm,
  tempoMs,
  type Filmachse,
  type Streckenabschnitt,
} from '../filmachse.js'
import {
  isoToOffset,
  offsetToIso,
  projectOntoTrack,
  pointAtOffset,
  type DisplaySegment,
  type AudioEntry,
  type EditOverlay,
  type CameraPreset,
  type MediaView,
  type CameraMomentKind,
  type TravelMode,
  type TrackPoint,
  type WeatherMode,
} from './edit-model.js'

/** Zeitspanne der Aufzeichnung: Offsets (s) des ersten/letzten Trackpunkts. */
export interface TimeScale {
  fromS: number
  toS: number
}

/**
 * Aufnahmezeit ↔ Filmzeit — seit Paket D über die STRECKE (Konzept E12).
 *
 * Die Rechnung selbst steht in [src/filmachse.ts](../filmachse.ts) und ist mit
 * dem Player geteilt; hier liegt der ADAPTER, den der Editor dafür braucht:
 * `tS`/`mM` sind parallel (je Stützpunkt seine Aufnahmezeit und sein
 * Streckenmeter), `core` ist die Achse darüber.
 *
 * Warum diese Zerlegung: Der Editor verankert alles in AUFNAHMEZEIT (Medien,
 * Ton-Klips, Zustandsgrenzen — trim-stabil, so begründet es die Spec), die
 * Achse muss aber Filmsekunde → Streckenposition liefern können, sonst kann der
 * Player sie nicht antreiben. Also: Anker in Zeit, Achse in Metern, dazwischen
 * dieser Adapter.
 *
 * `mM` ist monoton nicht-fallend; ein Plateau darin ist eine reale PAUSE (Zeit
 * vergeht, Strecke steht). Die Halte sind keine Stützstellen dieser Tabelle
 * mehr — sie stecken im Kern.
 */
export interface AxisCurve {
  tS: number[]
  mM: number[]
  core: Filmachse<AxisStopM>
  /** Filmzeit der ganzen Achse inkl. Halte */
  totalS: number
  /**
   * Filmsekunde, bei der `core` beginnt. Null für die ganze Achse; das
   * Zug-FENSTER einer Fortbewegungs-Grenze (`buildBoundaryCurve`) sitzt dagegen
   * mitten im Film und rechnet trotzdem in absoluten Filmsekunden.
   */
  offsetS?: number
}

/** Aufnahmezeit → Streckenmeter. Ein Plateau darin ist eine reale Pause. */
function metersAtTime(curve: AxisCurve, tOffsetS: number): number {
  return interpoliere(curve.tS, curve.mM, tOffsetS)
}

/** Streckenmeter → Aufnahmezeit (Umkehrung; Plateau → Ankunft). */
function timeAtMeters(curve: AxisCurve, meterM: number): number {
  return interpoliere(curve.mM, curve.tS, meterM)
}

/**
 * Die Achse der Zeitleiste. Mit `kurve` ist die Leiste FILM-proportional:
 * gleich breit heißt gleich lang im fertigen Film (eine Fähre schrumpft, ein
 * Foto-Halt bekommt seine Standzeit als Breite, eine reale Pause verschwindet
 * fast). Ohne `kurve` bleibt sie linear über der Aufnahmezeit — der Fallback
 * für degenerierte Touren und der Not-Schalter des Umbaus.
 */
export interface TimelineAxis extends TimeScale {
  curve?: AxisCurve
  /**
   * Die eingewebten Halte als INTERVALLE (Filmsekunden). Die Achse weiß als
   * Einzige, wie viel Filmzeit jeder Halt belegt — ohne diese Liste gibt es die
   * Auskunft „steht der Kopf in einem Halt, und wo darin?" nicht: in
   * AUFNAHMEzeit hat ein Halt keine Ausdehnung (zwei Stützstellen auf derselben
   * Sekunde), jede Rückrechnung fällt auf seine linke Kante.
   */
  stops?: readonly StopInterval[]
}

export function buildScale(track: readonly TrackPoint[]): TimeScale | null {
  const first = track[0]
  const last = track[track.length - 1]
  if (!first || !last || last[3] <= first[3]) return null
  return { fromS: first[3], toS: last[3] }
}

/**
 * Anteil 0..1 auf der Leiste → Zeit-Offset (s), geklemmt. Auf der Filmzeit-
 * Achse liefert ein Anteil INNERHALB eines Halt-Sprungs die Halt-Zeit —
 * die Interpolation zwischen zwei gleichen `tS`-Stützstellen ist konstant.
 */
export function fractionToOffset(scale: TimeScale | TimelineAxis, fraction: number): number {
  const a = Math.max(0, Math.min(1, fraction))
  const curve = (scale as TimelineAxis).curve
  if (curve) return recordingTimeAtFilmTime(curve, a * curve.totalS)
  return scale.fromS + a * (scale.toS - scale.fromS)
}

/**
 * Zeit-Offset (s) → Anteil 0..1, geklemmt. Auf der Filmzeit-Achse landet die
 * Halt-Zeit selbst am Sprung-ANFANG (lower_bound trifft die erste Stützstelle
 * der Stufe); knapp danach liegt hinter dem Sprung.
 */
export function offsetToFraction(scale: TimeScale | TimelineAxis, tOffsetS: number): number {
  const curve = (scale as TimelineAxis).curve
  if (curve) return filmTimeAtRecordingTime(curve, tOffsetS) / curve.totalS
  return Math.max(0, Math.min(1, (tOffsetS - scale.fromS) / (scale.toS - scale.fromS)))
}

/** Film-Sekunde der ACHSE (inkl. Halte) zu einem Zeit-Offset — für Kopf-Uhr
 *  und Spielkurve. Ohne Kurve linear auf [0, 1] skaliert (degenerierter Fall). */
export function filmToOffset(axis: TimelineAxis, tOffsetS: number): number {
  if (axis.curve) return filmTimeAtRecordingTime(axis.curve, tOffsetS)
  return offsetToFraction(axis, tOffsetS)
}

/**
 * Wird ein Audio-Eintrag beim Rendern verworfen, weil er vollständig außerhalb
 * des (getrimmten) Tracks liegt? Spiegelt die Pipeline-Semantik (enrich.ts):
 * SFX außerhalb [Start,Ende] fliegen raus, Musik mit leerer geklemmter Spanne
 * ebenso — der Editor warnt dann, statt still nichts abzuspielen.
 */
export function audioWouldBeDropped(
  a: AudioEntry,
  edits: EditOverlay,
  startIso: string,
  scale: TimeScale,
): boolean {
  const fromS =
    edits.trim?.start !== undefined ? isoToOffset(startIso, edits.trim.start) : scale.fromS
  const toS = edits.trim?.end !== undefined ? isoToOffset(startIso, edits.trim.end) : scale.toS
  const abS = isoToOffset(startIso, a.from)
  if (a.type === 'sfx') return abS < fromS || abS > toS
  const endS = a.to !== undefined ? isoToOffset(startIso, a.to) : toS
  return Math.min(endS, toS) <= Math.max(abS, fromS)
}

// — Bausteine der Leiste (alle Positionen als Anteil 0..1) —

export interface TimeBand {
  from: number
  to: number
  mode: TravelMode
  active: boolean
}

/** Modus-Bänder aus den Anzeige-Abschnitten (gleiche Quelle wie der Karten-Track). */
export function buildBands(
  displaySegments: readonly DisplaySegment[],
  scale: TimeScale,
): TimeBand[] {
  return displaySegments
    .map((a) => {
      const first = a.pts[0] as TrackPoint
      const last = a.pts[a.pts.length - 1] as TrackPoint
      return {
        from: offsetToFraction(scale, first[3]),
        to: offsetToFraction(scale, last[3]),
        mode: a.mode,
        active: a.active,
      }
    })
    .filter((b) => b.to > b.from)
}

export interface MediaDot {
  id: string
  fraction: number
  type: 'photo' | 'video'
  removed: boolean
}

/**
 * Wiedergabe-Position der Medien auf der Zeitachse: der Anker wird auf die
 * Track-Linie projiziert, sein Zeit-Offset bestimmt den Dot. Unplatzierte
 * (anker null) erscheinen nicht — der Editor zählt sie separat.
 */
export function buildMediaDots(
  media: readonly MediaView[],
  track: readonly TrackPoint[],
  scale: TimeScale,
): MediaDot[] {
  const dots: MediaDot[] = []
  for (const m of media) {
    if (!m.anchor || m.removed) continue
    const projection = projectOntoTrack(track, m.anchor[0], m.anchor[1])
    dots.push({
      id: m.id,
      fraction: offsetToFraction(scale, projection.point[3]),
      type: m.type,
      removed: m.removed,
    })
  }
  return dots.sort((a, b) => a.fraction - b.fraction)
}

/** Abschnitt gleichen Zustands — mit Anfang UND Ende. */
export interface StateBand<T> {
  fromFraction: number
  toFraction: number
  value: T
  /**
   * ISO-Anker der Grenze, die dieses Band eröffnet — null beim Grundband vor
   * der ersten Grenze. Identität für Ziehen/Entfernen (wie bei den Pins zuvor).
   */
  from: string | null
}

/**
 * Grenzen („gilt ab T") in lückenlose Bänder übersetzen: jedes Band reicht bis
 * zur nächsten Grenze, das letzte bis ans Ende der Leiste.
 *
 * Der Punkt der Übung: Eine Grenze zeigt nur, wo ein Zustand ANFÄNGT — wo er
 * aufhört, musste man sich bisher aus der nächsten Grenze zusammenreimen. Als
 * Band ist beides dieselbe Kante.
 */
export function buildStateBands<T>(
  boundaries: ReadonlyArray<{ from: string; value: T }>,
  startIso: string,
  scale: TimeScale,
  baseValue: T,
): Array<StateBand<T>> {
  const sorted = boundaries
    .map((g) => ({
      from: g.from,
      value: g.value,
      fraction: offsetToFraction(scale, isoToOffset(startIso, g.from)),
    }))
    .filter((g) => Number.isFinite(g.fraction))
    .sort((a, b) => a.fraction - b.fraction)

  const bands: Array<StateBand<T>> = []
  let fromFraction = 0
  let value = baseValue
  let from: string | null = null
  for (const g of sorted) {
    bands.push({ fromFraction, toFraction: g.fraction, value, from })
    fromFraction = g.fraction
    value = g.value
    from = g.from
  }
  bands.push({ fromFraction, toFraction: 1, value, from })
  // Null-breite Bänder (Grenze bei 0, zwei Grenzen auf demselben Punkt) fallen weg
  return bands.filter((b) => b.toFraction > b.fromFraction)
}

/** Default-Haltedauer eines Fotos — entspricht „Auto (5 s)" im Editor. */
export const HOLD_DEFAULT_S = 5

export interface AudioBar {
  /** Index im Overlay-Array (Identität für Patch/Entfernen) */
  index: number
  type: 'music' | 'sfx'
  from: number
  /** bei sfx gleich `from` */
  to: number
  file: string
  /**
   * Unterzeile innerhalb der Musik-Bahn (0-basiert). Der Player MISCHT
   * überlappende Musik-Bereiche (je Spur ein eigenes Element — Musik plus
   * Atmosphäre gleichzeitig ist gewollt); deckungsgleich übereinander
   * gezeichnet wäre der untere Klip aber unsichtbar und ungreifbar. Wie in
   * einem Schnittprogramm rückt ein überlappender Klip deshalb eine Zeile
   * tiefer. Effekt-Pins haben ihre eigene Lane oben und bleiben bei 0.
   */
  lane: number
}

export function buildAudioBars(
  audio: readonly AudioEntry[],
  startIso: string,
  scale: TimeScale,
): AudioBar[] {
  const bars: AudioBar[] = []
  audio.forEach((a, index) => {
    const fromS = isoToOffset(startIso, a.from)
    if (!Number.isFinite(fromS)) return
    const fromFraction = offsetToFraction(scale, fromS)
    let toFraction = fromFraction
    if (a.type === 'music') {
      const to = a.to !== undefined ? isoToOffset(startIso, a.to) : scale.toS
      toFraction = Number.isFinite(to) ? offsetToFraction(scale, to) : 1
    }
    bars.push({ index, type: a.type, from: fromFraction, to: toFraction, file: a.file, lane: 0 })
  })
  // Unterzeilen für überlappende Musik-Klips: klassische Intervall-Färbung —
  // nach Beginn sortiert bekommt jeder Klip die oberste Zeile, deren letzter
  // Klip vor ihm endet. Die Zuordnung ist stabil gegenüber dem Overlay-Index
  // (Sortierung nur fürs Färben; zurück kommt die Original-Reihenfolge).
  const music = bars
    .filter((b) => b.type === 'music')
    .sort((a, b) => a.from - b.from || a.index - b.index)
  const laneEnds: number[] = []
  for (const b of music) {
    let lane = laneEnds.findIndex((end) => end <= b.from)
    if (lane === -1) {
      lane = laneEnds.length
      laneEnds.push(0)
    }
    laneEnds[lane] = b.to
    b.lane = lane
  }
  return bars
}

/** Zahl der Unterzeilen der Musik-Bahn (mindestens 1) — für ihre Höhe. */
export function musicLanes(bars: readonly AudioBar[]): number {
  return bars.reduce((max, b) => (b.type === 'music' ? Math.max(max, b.lane + 1) : max), 1)
}

// — Zeit-Eingabe im Inspector —
//
// Ein Zeitfeld zeigt „14:03" und meint einen Offset in Sekunden seit Tourbeginn.
// Die Rückrichtung läuft bewusst über die DIFFERENZ zur angezeigten Zeit statt
// über eine echte Wanduhr→Zeitpunkt-Umkehrung: Letztere müsste die Zeitzone
// invertieren und stolperte über Sommerzeit-Sprünge und über Touren, die über
// Mitternacht laufen.

/** „14:03", „1403", „14.3" → Minuten seit Mitternacht; null bei Unsinn. */
export function parseClockMinutes(text: string): number | null {
  const raw = text.trim()
  const hit = /^(\d{1,2})\s*[:.\s]?\s*(\d{2})$/.exec(raw)
  if (!hit) return null
  const std = Number(hit[1])
  const min = Number(hit[2])
  if (!(std >= 0 && std <= 23 && min >= 0 && min <= 59)) return null
  return std * 60 + min
}

/**
 * Neue Uhrzeit im Feld → neuer Zeit-Offset (s). Gerechnet wird die Differenz zur
 * bisher angezeigten Zeit; „00:05" nach „23:50" heißt deshalb +15 Minuten und
 * nicht ein Sprung um fast einen ganzen Tag zurück.
 */
export function clockDiffToOffset(
  oldOffsetS: number,
  oldText: string,
  newText: string,
): number | null {
  const oldMin = parseClockMinutes(oldText)
  const newMin = parseClockMinutes(newText)
  if (oldMin === null || newMin === null) return null
  let diffMin = newMin - oldMin
  if (diffMin > 720) diffMin -= 1440
  if (diffMin < -720) diffMin += 1440
  return oldOffsetS + diffMin * 60
}

// — Fokus: die gemeinsame Auswahl von Zeitleiste, Karte und Inspector —
//
// Gespeichert wird bewusst nur die IDENTITÄT. Bänder entstehen aus Overlay +
// Track und würden als kopierte Spanne veralten, sobald man eine Grenze
// verschiebt; `resolveSelection` löst sie deshalb bei JEDEM Render neu auf.

export type EditorSelection =
  | { kind: 'travelMode'; atS: number }
  | { kind: 'camera'; atS: number }
  | { kind: 'weather'; atS: number }
  | { kind: 'moment'; from: string }
  | { kind: 'audio'; index: number }
  | { kind: 'medium'; id: string }

/** Aufgelöster Fokus: was der Inspector zeigt und was auf der Karte leuchtet. */
export interface EditorSelectionTarget {
  kind: EditorSelection['kind']
  fromS: number
  toS: number
  /**
   * Overlay-Grenze, die dieses Band ERÖFFNET — null heißt: das Band stammt aus
   * der Aufzeichnung (oder ist das Grundband) und lässt sich nicht entfernen,
   * nur überschreiben. Im Inspector ist „Beginnt um" dann fest.
   */
  from: string | null
  /**
   * Grenze, die dieses Band SCHLIESST (= eröffnet das nächste). Anfang des
   * einen und Ende des anderen Zustands sind dieselbe Kante — über dieses Feld
   * kann der Inspector auch das Ende verschieben. null = Band endet am Tourende.
   */
  nextFrom: string | null
  mode?: TravelMode
  preset?: CameraPreset
  weatherMode?: WeatherMode
  intensity?: number
  momentKind?: CameraMomentKind
  durationS?: number
  index?: number
  id?: string
}

/** Liegt `offsetS` (etwa) auf der Grenze `from`? Toleranz gegen Rundung. */
const boundaryAt = (
  boundaries: ReadonlyArray<{ from: string }>,
  startIso: string,
  offsetS: number,
): string | null =>
  boundaries.find((g) => Math.abs(isoToOffset(startIso, g.from) - offsetS) < 1)?.from ?? null

/**
 * Eine Zustands-Grenze bleibt zwischen ihren Nachbarn. Ohne diese Klemme
 * überholt ein schneller Zug die nächste Grenze: die Reihenfolge der Zustände
 * wäre danach eine andere als die, die man beim Anfassen sah, und der gezogene
 * Abschnitt selbst wäre verschwunden.
 *
 * `pointsS` (Trackzeiten) ist optional und nur noch für Spuren nötig, die
 * Zustand ausschließlich an Stützpunkten auswerten. Fortbewegung interpoliert
 * Zwischenzeiten auf die Linie (`splitForDisplay`) — dort reicht eine
 * Sekunde Abstand, sonst rastete die Kante auf dünnen Tracks in großen
 * Schritten. Ohne `pointsS` genügt diese Sekunde sowieso: zwei Grenzen auf
 * derselben Sekunde verschlucken sich gegenseitig (Ersetzen-Semantik).
 */
export function clampBoundary(
  boundaries: ReadonlyArray<{ from: string }>,
  oldFrom: string,
  startIso: string,
  offsetS: number,
  pointsS?: readonly number[],
): number {
  const times = boundaries
    .map((g) => isoToOffset(startIso, g.from))
    .filter((s) => Number.isFinite(s))
    .sort((a, b) => a - b)
  const own = isoToOffset(startIso, oldFrom)
  const before = times.filter((s) => s < own).pop()
  const after = times.find((s) => s > own)
  /** Späteste Zeit, die den Abschnitt bis `boundaryS` noch mit einem Punkt füllt. */
  const lastPointBefore = (boundaryS: number): number =>
    pointsS?.filter((p) => p < boundaryS).pop() ?? boundaryS - 1
  const firstPointAfter = (boundaryS: number): number =>
    pointsS?.find((p) => p > boundaryS) ?? boundaryS + 1

  let value = offsetS
  if (before !== undefined) value = Math.max(value, firstPointAfter(before))
  if (after !== undefined) value = Math.min(value, lastPointBefore(after))
  return value
}

export function resolveSelection(
  selection: EditorSelection | null,
  edits: EditOverlay,
  displaySegments: readonly DisplaySegment[],
  track: readonly TrackPoint[],
  startIso: string,
  media: readonly MediaView[],
  /**
   * Spanne eines Ton-Klips in AUFNAHMEZEIT-Offsets, aufgelöst über die
   * Film-Achse (der Aufrufer kennt sie, dieses Modul nicht).
   *
   * Ohne sie fiele die Auflösung auf `from`/`to` zurück — und die haben seit
   * Etappe 4 keinen Vorrang mehr: Der Inspector zeigte dann die ALTE Lage,
   * während die Leiste daneben die neue zeichnet.
   */
  audioSpan?: (index: number) => { fromS: number; toS: number } | null,
): EditorSelectionTarget | null {
  if (!selection) return null
  const scale = buildScale(track)
  if (!scale) return null

  if (selection.kind === 'travelMode') {
    // Aus den Anzeige-Abschnitten: die tragen echte Trackpunkte, also echte Zeiten
    const i = displaySegments.findIndex((a) => {
      const fromT = (a.pts[0] as TrackPoint)[3]
      const to = (a.pts[a.pts.length - 1] as TrackPoint)[3]
      return selection.atS >= fromT && selection.atS <= to
    })
    const hit = displaySegments[i]
    if (!hit) return null
    const fromS = (hit.pts[0] as TrackPoint)[3]
    const toS = (hit.pts[hit.pts.length - 1] as TrackPoint)[3]
    // Verantwortliche Grenze: die letzte, die zu Bandbeginn schon gilt und
    // denselben Modus setzt.
    let from: string | null = null
    for (const g of edits.travelModes ?? []) {
      const gS = isoToOffset(startIso, g.from)
      if (!Number.isFinite(gS) || gS > fromS + 1) break
      if (g.mode === hit.mode) from = g.from
    }
    // Fehlt sie, stammt die Kante aus der Aufzeichnung — sie bekommt trotzdem
    // eine Identität, damit sie sich anfassen lässt (`materializeTravelModes`
    // schreibt die erkannte Aufteilung beim ersten Zug fest). NUR echte
    // Modus-Wechsel zählen: eine Trim-Kante teilt das Band ebenfalls, ist aber
    // keine Grenze — würde man an ihr ziehen, entstünde ein Wechsel aus dem
    // Nichts. Der Tour-Anfang bleibt fest.
    const changeAt = (neighbor: DisplaySegment | undefined, offsetS: number): string | null =>
      neighbor && neighbor.mode !== hit.mode ? offsetToIso(startIso, offsetS) : null
    return {
      kind: 'travelMode',
      fromS,
      toS,
      from: from ?? changeAt(displaySegments[i - 1], fromS),
      nextFrom:
        boundaryAt(edits.travelModes ?? [], startIso, toS) ?? changeAt(displaySegments[i + 1], toS),
      mode: hit.mode,
    }
  }

  if (selection.kind === 'camera' || selection.kind === 'weather') {
    const isWeather = selection.kind === 'weather'
    // Wetter-Grund ist „klar" (off), sobald IRGENDeine Grenze existiert — dann
    // ersetzt das Overlay das Auto-Wetter vollständig; sonst „automatisch".
    const boundaries = isWeather
      ? (edits.weather ?? []).map((g) => ({
          from: g.from,
          value: g.mode as CameraPreset | WeatherMode,
        }))
      : (edits.camera ?? []).map((g) => ({
          from: g.from,
          value: g.preset as CameraPreset | WeatherMode,
        }))
    const baseValue: CameraPreset | WeatherMode | null =
      isWeather && boundaries.length > 0 ? 'off' : null
    const bands = buildStateBands(boundaries, startIso, scale, baseValue)
    const i = bands.findIndex(
      (b) =>
        selection.atS >= fractionToOffset(scale, b.fromFraction) &&
        selection.atS <= fractionToOffset(scale, b.toFraction),
    )
    const hit = bands[i]
    if (!hit) return null
    const target: EditorSelectionTarget = {
      kind: selection.kind,
      fromS: fractionToOffset(scale, hit.fromFraction),
      toS: fractionToOffset(scale, hit.toFraction),
      from: hit.from,
      nextFrom: bands[i + 1]?.from ?? null,
    }
    if (hit.value) {
      if (isWeather) target.weatherMode = hit.value as WeatherMode
      else target.preset = hit.value as CameraPreset
    }
    if (isWeather && hit.from !== null) {
      const intensity = edits.weather?.find((g) => g.from === hit.from)?.intensity
      if (intensity !== undefined) target.intensity = intensity
    }
    if (!isWeather && hit.from !== null) {
      const fineScale = edits.camera?.find((g) => g.from === hit.from)?.scale
      if (fineScale !== undefined) target.intensity = fineScale
    }
    return target
  }

  if (selection.kind === 'moment') {
    const m = (edits.moments ?? []).find((x) => x.from === selection.from)
    if (!m) return null
    const s = isoToOffset(startIso, m.from)
    return {
      kind: 'moment',
      fromS: s,
      toS: s,
      from: m.from,
      nextFrom: null,
      momentKind: m.kind,
      ...(m.durationS !== undefined ? { durationS: m.durationS } : {}),
    }
  }

  if (selection.kind === 'audio') {
    const a = (edits.audio ?? [])[selection.index]
    if (!a) return null
    const fromAxis = audioSpan?.(selection.index)
    const fromS = fromAxis ? fromAxis.fromS : isoToOffset(startIso, a.from)
    const toS = fromAxis
      ? fromAxis.toS
      : a.type === 'sfx'
        ? fromS
        : a.to !== undefined
          ? isoToOffset(startIso, a.to)
          : scale.toS
    return { kind: 'audio', fromS, toS, from: a.from, nextFrom: null, index: selection.index }
  }

  const m = media.find((x) => x.id === selection.id)
  if (!m?.anchor) return null
  const p = projectOntoTrack(track, m.anchor[0], m.anchor[1])
  return {
    kind: 'medium',
    fromS: p.point[3],
    toS: p.point[3],
    from: null,
    nextFrom: null,
    id: m.id,
  }
}

/** Trim-Griffe als Anteile (Default 0/1, wenn kein Trim gesetzt). */
export function buildTrimHandles(
  edits: EditOverlay,
  startIso: string,
  scale: TimeScale,
): { start: number; end: number } {
  const start =
    edits.trim?.start !== undefined
      ? offsetToFraction(scale, isoToOffset(startIso, edits.trim.start))
      : 0
  const end =
    edits.trim?.end !== undefined
      ? offsetToFraction(scale, isoToOffset(startIso, edits.trim.end))
      : 1
  return { start, end }
}

// — Wiedergabedauer schätzen —
//
// Die Zeitleiste zeigt AUFNAHMEZEIT; wie lang die fertige Animation läuft, ist
// eine andere Größe (die Engine fährt die Strecke mit eigenem Tempo ab und hält
// an jedem Foto an). Beides auf einer Achse zu zeigen wäre verwirrend — deshalb
// nur diese eine Zahl.
//
// Das Tempo-Modell ist seit Paket D KEINE Kopie mehr: `filmachse.ts` ist DOM-
// und importfrei, Studio und Player lesen dieselben Zahlen (`tempoMs`). Genauso
// stehen Standzeit und Ausblendung in `einblendung.ts`. Die alten Namen bleiben,
// sie stehen im ganzen Editor.
export const STOP_ENGINE_S = HOLD_HIDE
export const STOP_FADE_OUT_S = HOLD_AUSBLEND

/** Meter zwischen zwei Trackpunkten (lokale Plattkarte — auf Segmentlänge genau genug). */
function metersBetween(a: TrackPoint, b: TrackPoint): number {
  const kx = 111_320 * Math.cos((a[1] * Math.PI) / 180)
  const dx = (b[0] - a[0]) * kx
  const dy = (b[1] - a[1]) * 110_540
  return Math.sqrt(dx * dx + dy * dy)
}

/**
 * Grobe Laufzeit der fertigen Animation in Sekunden: Fahrzeit je Abschnitt
 * (Länge ÷ modusabhängiges Tempo) plus die Haltezeit an jedem Foto.
 *
 * BEWUSST eine Näherung: Die Engine glättet und resampled die Route beim Laden
 * (buildRoute), beschleunigt weich an und hat ein Intro, das läuft, bis der
 * Zuschauer startet. Für die Frage „grob zwei Minuten oder eher zehn?" reicht
 * das; deshalb wird der Wert auch mit „~" angezeigt.
 */
export function estimateAnimationDuration(
  displaySegments: ReadonlyArray<{ mode: TravelMode; active: boolean; pts: readonly TrackPoint[] }>,
  holdDurationsS: readonly number[],
): number {
  let seconds = 0
  for (const a of displaySegments) {
    if (!a.active) continue // weggetrimmt: läuft nicht mit
    seconds += rideS(a)
  }
  for (const stop of holdDurationsS) seconds += stop + STOP_FADE_OUT_S
  return seconds
}

/** Fahr-Filmzeit eines Abschnitts (s): Länge ÷ modusabhängiges Tempo. */
function rideS(a: { mode: TravelMode; pts: readonly TrackPoint[] }): number {
  let meters = 0
  for (let i = 1; i < a.pts.length; i++) {
    meters += metersBetween(a.pts[i - 1] as TrackPoint, a.pts[i] as TrackPoint)
  }
  return meters / tempoMs(a.mode)
}

/** Haltedauer eines Fotos, wie die Engine sie anwendet (display.holdS oder Default). */
export function holdS(display?: { holdS?: number }): number {
  return display?.holdS ?? STOP_ENGINE_S
}

/**
 * Filmzeit, die EINE Aufnahme im Halt belegt (ohne Ausblendung).
 *
 * Für ein Video ist das seine echte Länge und sonst nichts: Der Player läuft
 * bis zum Ende der Datei, `display.holdS` ist dort wirkungslos (src/tour.js) —
 * ein Griff dafür wäre eine Lüge. Kennt der Server die Länge noch nicht
 * (unverarbeiteter Altbestand, `durationS` fehlt), bleibt es bei der Foto-Annahme;
 * die Leiste zeigt dann zu wenig, aber nichts bricht.
 */
export function mediumHoldS(m: {
  type: 'photo' | 'video'
  durationS?: number
  display?: { holdS?: number }
  trim?: { fromS: number; toS?: number }
}): number {
  if (m.type === 'video' && m.durationS !== undefined && m.durationS > 0)
    return videoFilmS(m.durationS, m.trim)
  // Ohne Schnitt ist es dieselbe Regel wie im Player (`standzeitS`) — der
  // Video-Trim ist der eine Zusatz, den nur der Editor kennt.
  return standzeitS(m)
}

/**
 * Video-Schnitt auf das MATERIAL klemmen — Spiegel von `klemmeSchnitt`
 * (server/src/pipeline/video.ts), wo er tatsächlich angewandt wird.
 *
 * `null` heißt „kein wirksamer Schnitt" = ganze Datei. Die Regeln stehen
 * zweimal, weil sie an zwei Orten gebraucht werden: Der Server MUSS klemmen
 * (er schneidet), die Leiste SOLL dieselbe Breite zeigen — sonst plant man
 * einen Schnitt und sieht später einen anderen. Ein Drift-Wächter in
 * test/studio-baukasten.test.ts hält beide zusammen.
 */
export function clampMediaTrim(
  trim: { fromS: number; toS?: number } | undefined,
  fileS: number,
): { fromS: number; toS: number } | null {
  if (!trim || !(fileS > 0)) return null
  const fromS = Math.min(Math.max(0, trim.fromS), fileS)
  const toS = trim.toS === undefined ? fileS : Math.min(Math.max(0, trim.toS), fileS)
  if (!(toS - fromS > VIDEO_TRIM_MIN_S)) return null
  if (fromS <= 0 && toS >= fileS) return null // Vollschnitt ist kein Schnitt
  return { fromS, toS }
}

/** Kürzester Video-Ausschnitt (s) — Spiegel der Schranke in video.ts. */
export const VIDEO_TRIM_MIN_S = 0.05

/**
 * Filmzeit eines Videos: die getrimmte Länge, sonst die ganze Datei.
 *
 * Hier entsteht der RIPPLE aus §2F, ohne dass ihn jemand programmiert:
 * Ein Video liegt in einer Halt-Kette, die keine Lücken kennt. Wird es kürzer,
 * wird sein Halt schmaler, die Achse baut sich neu — und alles Folgende rückt
 * vor. Eine Lücke kann gar nicht entstehen.
 */
export function videoFilmS(fileS: number, trim?: { fromS: number; toS?: number }): number {
  const clamped = clampMediaTrim(trim, fileS)
  return clamped ? clamped.toS - clamped.fromS : fileS
}

/**
 * Wo das Video steht, wenn der Kopf `imS` Sekunden im Klip ist.
 *
 * Die Rechnung wohnt seit E15 in [einblendung.ts](../einblendung.ts) — der
 * Player braucht sie genauso, und ein Import Player→Studio ist die eine
 * Richtung, die das Gleichlauf-Konzept ausschließt (§8C). Hier bleibt sie
 * lesbar, weil `syncImage` sie unter diesem Namen kennt.
 */
export { videoStandS } from '../einblendung.js'

/**
 * Dauer in Sekunden → kurze Anzeige („2:05 Std", „14 Min", „38 Sek").
 * Für den Inspector: Zu einem Band gehört nicht nur „ab wann", sondern auch,
 * wie lange es gilt.
 */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s} Sek`
  const min = Math.round(s / 60)
  if (min < 60) return `${min} Min`
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')} Std`
}

// — Filmkurve (Wiedergabe) —
//
// Übersetzt zwischen Achsen-ANTEIL und FILMSEKUNDE der Wiedergabe — das
// Tempo-Gesetz des Abspielens (playback.ts). Auf der film-proportionalen
// Achse ist sie die Identität; Plateaus entstehen über weggetrimmten
// Bereichen (`buildPlaybackCurve`), die der Kopf überfliegt.
//
// Beide Richtungen laufen über dieselbe lower_bound-Interpolation. Deren eine
// Konvention trägt alle Sonderfälle: Über einem Plateau ist `filmS` konstant
// — die Umkehrung liefert dort die FRÜHESTE Stützstelle, also den Moment des
// Ankommens (dieselbe Wahl wie `zeitZurPosition` im Server).

/** Achsen-Anteil ↔ Filmsekunden, beide Arrays monoton nicht-fallend. */
export interface FilmCurve {
  fractions: number[]
  filmS: number[]
  /** Filmzeit der ganzen Wiedergabe (letzter filmS-Wert) */
  totalS: number
}

// `interpoliere` mit ihrer lower_bound-Konvention steht seit Paket D in
// filmachse.ts — sie war zwischen Studio und Server schon byte-identisch.

/** Fahr-Filmsekunde an einem Achsen-Anteil. */
export function filmAt(curve: FilmCurve, fraction: number): number {
  return interpoliere(curve.fractions, curve.filmS, fraction)
}

/** Achsen-Anteil zu einer Fahr-Filmsekunde (Umkehrung; Plateau → Ankunft). */
export function fractionAt(curve: FilmCurve, filmS: number): number {
  return interpoliere(curve.filmS, curve.fractions, filmS)
}

// — Filmzeit-ACHSE —
//
// Ab hier wird die Kurve zur Leiste selbst: Position ∝ Filmzeit. Anders als
// die Spielplan-Kurve (oben) rechnet die Achsen-Kurve in ZEIT-OFFSETS und
// enthält die Foto-Halte als Sprünge — bei foto-lastigen Kurztouren IST der
// Film überwiegend Standzeit (56-min-Beispiel: ~48 s Halte vs. ~8 s Fahrt);
// ohne die Halte fände der Großteil des Films auf null Breite statt.

/** Eine Aufnahme innerhalb eines Halts — Kette statt Stapel (docs §2A). */
export interface StopItem {
  id: string
  /** Filmzeit dieser Aufnahme inkl. ihrer Ausblendung */
  durationS: number
}

/** Ein Halt für die Achse: wo er liegt und wie viel Filmzeit er kostet. */
export interface AxisStop {
  offsetS: number
  breiteS: number
  /**
   * Was für ein Halt das ist (im Editor: Aufnahmen oder Kamera-Moment). Für die
   * Achse sind alle Halte gleich — sie kosten Filmzeit und kosten keine
   * Aufnahmezeit; das Wort braucht nur, wer den Stand benennen will.
   */
  kind?: string
  /**
   * Wer diesen Halt bildet — Indizes in der Liste des Aufrufers (im Editor die
   * Stopps). Die Achse rechnet damit nicht, sie reicht sie durch: Wer beim
   * Kopfstand „Halt · ‹Titel›" schreiben will, braucht den Rückweg zum Objekt.
   */
  indices?: readonly number[]
  /**
   * Stabile Identität des Halts (im Editor: `from` eines Moments). Anders als
   * `indizes` übersteht sie das Weglassen eines Halts — und genau das braucht
   * jeder Zug: Er rechnet px → Zeit auf einer Achse OHNE das gezogene Objekt,
   * sonst läge um dessen Ruhelage eine tote Zone von seiner eigenen Breite.
   */
  key?: string
  /**
   * Die Aufnahmen des Halts in Abspielreihenfolge. Erst damit lässt sich sagen,
   * WELCHE Aufnahme gerade steht — ein Halt mit drei Fotos ist im Film eine
   * Folge von dreien, kein einzelner Block.
   */
  items?: readonly StopItem[]
}

/**
 * Ein Halt, dessen Ort auf der STRECKE bekannt ist — das Ergebnis des
 * Zeit→Strecke-Adapters (E12). Der Editor gibt Halte in Aufnahmezeit herein,
 * die Achse rechnet in Metern.
 */
export interface AxisStopM extends AxisStop {
  meterM: number
}

/** Ein eingewebter Halt: dazu, wo er im FILM liegt. */
export interface StopInterval extends AxisStopM {
  filmVon: number
  filmBis: number
}

/** Wo der Kopf in einem Halt steht — die Auskunft für die Statuszeile. */
export interface StopState {
  /** Index in `achse.halte` */
  index: number
  stop: StopInterval
  /** verstrichene Standzeit (s) */
  inStopS: number
  /** verbleibende Standzeit (s) */
  remainingS: number
  /** Welche Aufnahme des Halts gerade steht — fehlt, wenn keine bekannt sind. */
  item?: {
    /** 1-basiert, wie es in der Statuszeile steht */
    no: number
    count: number
    id: string
    /** verstrichene Zeit IN dieser Aufnahme */
    inS: number
    durationS: number
  }
}

/**
 * Steht die Filmsekunde `filmS` in einem Halt — und wo darin?
 *
 * Die Ankunft (`filmVon`) zählt dazu, die Abfahrt (`filmBis`) nicht: dort läuft
 * die Fahrt schon wieder. Ausnahme ist das Ende der Achse — endet der Film in
 * einem Halt, steht der Kopf dort bis zur letzten Sekunde in ihm und nicht im
 * Nichts dahinter.
 */
export function stopAtFilmS(axis: TimelineAxis, filmS: number): StopState | null {
  const stops = axis.stops
  if (!stops?.length) return null
  const end = axis.curve?.totalS ?? 0
  for (const [index, stop] of stops.entries()) {
    if (filmS < stop.filmVon) return null // Halte sind sortiert — ab hier kommt nur Späteres
    // Toleranz gegen die Rundung der Achsen-Summe: der letzte Halt endet
    // rechnerisch selten exakt auf `totalS`.
    const atEnd = stop.filmBis >= end - 1e-6
    const inside = filmS < stop.filmBis || (atEnd && filmS <= end + 1e-6)
    if (inside) {
      const inStopS = Math.min(Math.max(filmS - stop.filmVon, 0), stop.breiteS)
      const item = itemAt(stop.items, inStopS)
      return { index, stop, inStopS, remainingS: stop.breiteS - inStopS, ...(item ? { item } : {}) }
    }
  }
  return null
}

/** Welche Aufnahme der Kette bei `imHaltS` läuft (letzte gewinnt am Ende). */
function itemAt(items: readonly StopItem[] | undefined, inStopS: number): StopState['item'] | null {
  if (!items?.length) return null
  let elapsed = 0
  for (const [i, s] of items.entries()) {
    const last = i === items.length - 1
    if (inStopS < elapsed + s.durationS || last) {
      return {
        no: i + 1,
        count: items.length,
        id: s.id,
        inS: Math.min(Math.max(inStopS - elapsed, 0), s.durationS),
        durationS: s.durationS,
      }
    }
    elapsed += s.durationS
  }
  return null
}

// — Szenen-Bahn: ein Halt ist eine KETTE, kein Stapel —
//
// Der „Cluster" war nie ein eigenes Ding, sondern die Folge zusammenfallender
// Anker — als Stapel gezeichnet, weil PUNKTE an derselben Stelle
// übereinanderlägen. Klips mit Breite haben das Problem nicht: jede Aufnahme
// belegt ihre eigene Filmzeit (Standzeit bzw. Videolänge, je plus Ausblendung),
// und die Kette liegt lückenlos hintereinander.

/** Eine Aufnahme als Klip der Szenen-Bahn — von Filmsekunde bis Filmsekunde. */
export interface SceneClip {
  id: string
  /** Index des Halts in `achse.halte` — der Rückweg zur Kette */
  stopIndex: number
  /** Platz in der Kette (0-basiert) und deren Länge */
  slot: number
  count: number
  filmVon: number
  filmBis: number
}

/**
 * Die Klips aller Halte, in Abspielreihenfolge. Halte ohne bekannte Stücke
 * (Kamera-Momente: sie halten den Film an, aber keine Aufnahme steht dahinter)
 * bleiben außen vor — sie haben ihre eigene Bahn.
 */
export function buildSceneClips(axis: TimelineAxis): SceneClip[] {
  const clips: SceneClip[] = []
  for (const [stopIndex, stop] of (axis.stops ?? []).entries()) {
    const items = stop.items
    if (!items?.length) continue
    let film = stop.filmVon
    for (const [slot, s] of items.entries()) {
      clips.push({
        id: s.id,
        stopIndex,
        slot,
        count: items.length,
        filmVon: film,
        filmBis: film + s.durationS,
      })
      film += s.durationS
    }
  }
  return clips
}

/** Einfüge-Platz in einer Kette samt der Filmsekunde, an der die Marke steht. */
export interface ChainSlot {
  /** 0..n — vor dem ersten Klip bis hinter den letzten */
  slot: number
  /** Filmsekunde der Fuge (dort steht die Einfügemarke) */
  filmS: number
}

/**
 * Wohin fällt ein Klip, der bei `filmS` losgelassen wird? Entschieden wird an
 * der MITTE jedes Klips: bis dahin gehört der Zeiger noch davor. Ein Vergleich
 * gegen die Kanten ließe die Marke erst umspringen, wenn man den Nachbarn
 * schon ganz überfahren hat.
 */
export function slotInChain(stop: StopInterval, filmS: number): ChainSlot {
  let gap = stop.filmVon
  let slot = 0
  for (const s of stop.items ?? []) {
    if (filmS < gap + s.durationS / 2) break
    slot += 1
    gap += s.durationS
  }
  return { slot, filmS: gap }
}

/**
 * `id` an Platz `platz` der Liste schieben (Platz zählt die FUGEN, 0..n).
 * Wandert der Eintrag nach hinten, rückt alles dazwischen um eins vor —
 * deshalb `platz - 1`, sonst landete er immer eine Stelle zu weit rechts.
 */
export function moveToSlot(ids: readonly string[], id: string, slot: number): string[] {
  const current = ids.indexOf(id)
  if (current < 0) return [...ids]
  const target = Math.max(0, Math.min(ids.length - 1, slot > current ? slot - 1 : slot))
  if (target === current) return [...ids]
  const next = [...ids]
  next.splice(current, 1)
  next.splice(target, 0, id)
  return next
}

/**
 * Halt, in dessen INNEREM `filmS` liegt — das Andockziel eines Klip-Zugs.
 *
 * Anders als `stopAtFilmS` zählen die Kanten NICHT dazu: genau dort beginnt
 * bzw. endet die Fahrt, und ein Klip, der an der Ankunft schon andockte,
 * ließe sich nicht mehr davor absetzen.
 */
export function stopInnerAt(axis: TimelineAxis, filmS: number): StopInterval | null {
  for (const stop of axis.stops ?? []) {
    if (filmS <= stop.filmVon) break // Halte sind sortiert
    if (filmS < stop.filmBis) return stop
  }
  return null
}

/** Grenzen der Standzeit (s) — Spiegel des Server-Schemas (schema/edits.ts). */
export const HOLD_MIN_S = 2
export const HOLD_MAX_S = 60

/**
 * Standzeit auf gültige Grenzen und Zehntelsekunden bringen. Ohne die Rundung
 * schriebe jeder Zieh-Frame eine neue Nachkommastelle ins Overlay; ohne die
 * Klemme liefe der Griff in einen Wert, den der Server beim Speichern ablehnt.
 */
export function clampHoldS(seconds: number): number {
  const s = Math.round(seconds * 10) / 10
  return Math.max(HOLD_MIN_S, Math.min(HOLD_MAX_S, s))
}

/** Grenzen der Moment-Dauer (s) — Spiegel des Server-Schemas (schema/edits.ts). */
export const MOMENT_MIN_S = 1
export const MOMENT_MAX_S = 30

/** Wie `clampHoldS`, nur für die Dauer eines Kamera-Moments. */
export function clampMomentDuration(seconds: number): number {
  const s = Math.round(seconds * 10) / 10
  return Math.max(MOMENT_MIN_S, Math.min(MOMENT_MAX_S, s))
}

/** Filmsekunde → Anteil 0..1 auf der Leiste (die Achse IST film-proportional). */
export function filmToFraction(axis: TimelineAxis, filmS: number): number {
  const total = axis.curve?.totalS ?? 0
  return total > 0 ? Math.max(0, Math.min(1, filmS / total)) : 0
}

/** Anteil 0..1 → Filmsekunde. */
export function fractionToFilm(axis: TimelineAxis, fraction: number): number {
  return Math.max(0, Math.min(1, fraction)) * (axis.curve?.totalS ?? 0)
}

/** Sekunden für die Statuszeile: „2,1" — eine Nachkommastelle, deutsches Komma. */
const secondsText = (s: number): string => s.toFixed(1).replace('.', ',')

/** Sekunden mit Einheit („5,2 s") — für Klip-Beschriftung und Dauer-Blase. */
export function formatSeconds(seconds: number): string {
  return `${secondsText(seconds)} s`
}

/**
 * Der Halt-Stand als Satzteil: „Aufnahme 2 von 3 · 2,1 s von 6,0 s".
 *
 * Bei einer einzigen Aufnahme bleibt das Zählwerk weg — „Aufnahme 1 von 1"
 * sagt nichts, was man nicht sieht. Ohne bekannte Stücke zählt die Zeit im
 * ganzen Halt.
 */
export function describeStopState(state: StopState): string {
  const s = state.item
  if (!s) return `${secondsText(state.inStopS)} s von ${secondsText(state.stop.breiteS)} s`
  const time = `${secondsText(s.inS)} s von ${secondsText(s.durationS)} s`
  return s.count > 1 ? `Aufnahme ${s.no} von ${s.count} · ${time}` : time
}

/**
 * Kopfposition um `deltaFilmS` verschieben (Pfeiltasten), geklemmt auf die
 * Achse. Führende Größe ist die FILMsekunde — genau deshalb überspringt der
 * Schritt keinen Halt mehr: in Aufnahmezeit gerechnet fiel er auf die linke
 * Haltkante zurück und kam an einem 6-s-Halt nie vorbei (docs §1).
 */
export function stepFilmS(axis: TimelineAxis, filmS: number, deltaFilmS: number): number {
  const total = axis.curve?.totalS ?? 0
  return Math.max(0, Math.min(total, filmS + deltaFilmS))
}

/**
 * Die Filmzeit-Achse aus Anzeige-Abschnitten und Foto-Halten.
 *
 * Trim wird bewusst IGNORIERT (alle Abschnitte zählen voll): die Achse ist
 * Bearbeitungsfläche — ein weggetrimmter Rand mit Breite 0 wäre nicht mehr
 * anfassbar. Wie lang der Film WIRKLICH läuft, sagt die Spielkurve
 * (`buildPlaybackCurve`), die über getrimmte Bereiche hinwegfliegt.
 *
 * Degeneriert-Wächter: erst NACH dem Einweben der Halte — eine Foto-Tour ohne
 * nennenswerte Fahrstrecke hat trotzdem einen echten Film (fast nur
 * Standzeiten; 8 Fotos ≈ 48 s), und genau dort wäre eine lineare
 * Aufnahmezeit-Achse am falschesten. Ohne Fahrzeit UND ohne Halte kommt die
 * Achse OHNE Kurve zurück (linearer Fallback).
 */
export function buildTimelineAxis(
  displaySegments: ReadonlyArray<{ mode: TravelMode; active: boolean; pts: readonly TrackPoint[] }>,
  stops: readonly AxisStop[],
  scale: TimeScale,
): TimelineAxis {
  const adapter = buildAdapter(displaySegments)
  if (adapter.tS.length < 2) return { ...scale, stops: [] }

  const core = baueFilmachse(adapter.boundaries, adapter.totalM, stopsOnDistance(adapter, stops))
  // Degeneriert-Wächter erst NACH den Halten: Eine Foto-Tour ohne nennenswerte
  // Fahrstrecke hat trotzdem einen echten Film (fast nur Standzeiten).
  if (core.gesamtS < 1) return { ...scale, stops: [] }
  return {
    ...scale,
    curve: { tS: adapter.tS, mM: adapter.mM, core, totalS: core.gesamtS },
    stops: core.halte,
  }
}

/** Der Zeit→Strecke-Adapter: je Stützpunkt seine Zeit und sein Streckenmeter. */
interface Adapter {
  tS: number[]
  mM: number[]
  boundaries: Streckenabschnitt[]
  totalM: number
}

/**
 * Trackpunkte in den Adapter überführen — je Abschnitt eine Modus-Grenze in
 * Metern, je Punkt ein Stützwert.
 *
 * Der Abstand ZWISCHEN zwei Abschnitten wird bewusst nicht gezählt: Sie teilen
 * sich ihren Wechselpunkt (`splitForDisplay`), er zählt also bereits im
 * linken. Die Dedup-Regel („gleiche Zeit UND gleicher Meterstand") hält die
 * Naht aus der Tabelle heraus.
 */
function buildAdapter(
  displaySegments: ReadonlyArray<{ mode: TravelMode; pts: readonly TrackPoint[] }>,
): Adapter {
  const tS: number[] = []
  const mM: number[] = []
  const boundaries: Streckenabschnitt[] = []
  let meters = 0
  for (const a of displaySegments) {
    boundaries.push({ abM: meters, mode: a.mode })
    for (let i = 0; i < a.pts.length; i++) {
      const p = a.pts[i] as TrackPoint
      if (i > 0) meters += metersBetween(a.pts[i - 1] as TrackPoint, p)
      const last = tS.length - 1
      if (last >= 0 && tS[last] === p[3] && mM[last] === meters) continue
      tS.push(p[3])
      mM.push(meters)
    }
  }
  return { tS, mM, boundaries, totalM: meters }
}

/**
 * Halte von der Aufnahmezeit auf die Strecke ziehen.
 *
 * Nach Zeit vorsortiert: Liegen mehrere Halte in derselben realen PAUSE, haben
 * sie denselben Meterstand (dort steht die Strecke) — die stabile Sortierung im
 * Kern behält dann ihre Reihenfolge im Film. Genau dorthin wandert mit E12 die
 * Mehrdeutigkeit, die vorher bei den Pausen lag.
 */
function stopsOnDistance(adapter: Adapter, stops: readonly AxisStop[]): AxisStopM[] {
  return [...stops]
    .sort((a, b) => a.offsetS - b.offsetS)
    .map((h) => ({ ...h, meterM: interpoliere(adapter.tS, adapter.mM, h.offsetS) }))
}

// — Der Zug einer FORTBEWEGUNGS-Grenze: analytisch, nicht per Bisektion —
//
// Die Grenze beeinflusst die Abbildung, auf der sie selbst liegt: im Tempo je
// Modus steckt die Filmzeit, eine verschobene Kante dehnt oder staucht also die
// Achse. Mit der Achse des letzten Frames gerechnet sprang die Kante beim
// Loslassen um 116 px (docs §2D).
//
// Der Ausweg im Konzept war eine Bisektion (14 Achsenbauten je Zieh-Frame). An
// echten Tracks gemessen trägt die nicht: 335 Punkte kosten 0,6 ms, aber 10 000
// Punkte 12,5 ms — über dem 8-ms-Budget, und das ohne den Rest des Frames.
//
// Sie ist auch unnötig. Die Filmposition der Grenze hängt NUR von dem ab, was
// VOR ihr liegt: bis zur vorigen Grenze ändert sich gar nichts, und dazwischen
// gilt das Tempo des LINKEN Bands — unabhängig davon, wohin man zieht. Also ist
// F(t) eine feste, stückweise lineare, monotone Funktion, die man EINMAL beim
// Zug-Start aufbaut und danach in beide Richtungen auswertet. Exakt statt auf
// 0,2 s genau, und je Frame nur eine Interpolation.

/**
 * Film ↔ Aufnahmezeit im Zug-Fenster einer Fortbewegungs-Grenze.
 *
 * `fromS`/`toS` sind die Nachbargrenzen (oder die Enden der Tour), `travelModes` die
 * Fortbewegung davor, links und rechts der gezogenen Kante, `filmBeiVon` ihre
 * Filmsekunde in der aktuellen Achse. Halte im Fenster kosten Filmzeit, ohne von
 * der Grenze abzuhängen — sie werden als dieselben Sprünge eingewebt wie in der
 * Achse.
 *
 * **Zwei Rampen ragen ins Fenster**, und beide sind KONSTANT (sie hängen nur an
 * den Tempi, nicht daran, wo die Kante steht) — sie verschieben die Kurve also
 * bloß und lassen sie exakt umkehrbar:
 *
 * - An der LINKEN Fensterkante, wenn der Film dort beschleunigt: Die Rampe
 *   liegt im schnelleren Abschnitt, also im Fenster. Sie kommt als
 *   `startTempoMs` in die Achse, damit sie mitgerechnet wird.
 * - An der gezogenen Kante selbst, wenn der Film dort VERZÖGERT: Dann liegt
 *   ihre Rampe davor, ersetzt also Reise im linken Modus (`rampenVersatzS`).
 *   Beschleunigt er, liegt sie dahinter und geht das Fenster nichts an.
 *
 * Null, wenn im Fenster keine zwei Trackpunkte liegen: dann gibt es nichts zu
 * ziehen.
 */
export function buildBoundaryCurve(
  track: readonly TrackPoint[],
  fromS: number,
  toS: number,
  travelModes: { before: TravelMode | null; left: TravelMode; right: TravelMode },
  filmAtFrom: number,
  stops: readonly AxisStop[],
): AxisCurve | null {
  const { before, left, right } = travelModes
  const pts = pointsBetween(track, fromS, toS)
  if (pts.length < 2) return null
  const adapter = buildAdapter([{ mode: left, pts }])
  // Ein Halt GENAU auf der linken Fensterkante zählt schon zu `filmBeiVon`
  // (lower_bound trifft die Stützstelle vor dem Sprung) — sonst zählte er
  // doppelt und die Kante liefe um seine Standzeit davon.
  const inWindow = stops.filter((h) => h.offsetS > fromS && h.offsetS <= toS)
  // Mit welchem Tempo betritt der Film das Fenster? Am Tour-Anfang aus dem
  // Stand (0), sonst mit dem Tempo des Abschnitts davor — daraus baut die Achse
  // die Rampe an der linken Fensterkante selbst.
  const core = baueFilmachse(
    adapter.boundaries,
    adapter.totalM,
    stopsOnDistance(adapter, inWindow),
    {
      startTempoMs: filmAtFrom <= 0 ? 0 : before === null ? null : tempoMs(before),
    },
  )
  const offsetS = filmAtFrom + rampenVersatzS(tempoMs(left), tempoMs(right))
  return {
    tS: adapter.tS,
    mM: adapter.mM,
    core,
    totalS: offsetS + core.gesamtS,
    offsetS,
  }
}

/** Trackpunkte im Zeitfenster, mit interpolierten Rändern (nie leer bei Bedarf). */
function pointsBetween(track: readonly TrackPoint[], fromS: number, toS: number): TrackPoint[] {
  const edge = (t: number): TrackPoint | null => pointAtOffset(track, t)
  const left = edge(fromS)
  const right = edge(toS)
  if (!left || !right) return []
  const middle = track.filter((p) => p[3] > fromS && p[3] < toS)
  return [left, ...middle, right]
}

/**
 * Aufnahmezeit zu einer Filmsekunde (Umkehrung; außerhalb geklemmt).
 *
 * Zwei Schritte statt einem: Film → Strecke über die geteilte Achse, Strecke →
 * Zeit über den Adapter. In einer realen PAUSE ist der zweite mehrdeutig — dort
 * gilt die Ankunft, dieselbe lower_bound-Konvention wie überall.
 */
export function recordingTimeAtFilmTime(curve: AxisCurve, filmS: number): number {
  return timeAtMeters(curve, streckeBeiFilm(curve.core, filmS - (curve.offsetS ?? 0)))
}

/** Filmsekunde zu einer Aufnahmezeit (Zeit → Strecke → Film). */
export function filmTimeAtRecordingTime(curve: AxisCurve, tOffsetS: number): number {
  return (curve.offsetS ?? 0) + filmBeiStrecke(curve.core, metersAtTime(curve, tOffsetS))
}

/**
 * Filmdauer der GANZEN Tour, wenn die Grenze bei `tOffsetS` läge.
 *
 * Auch das braucht keine zweite Achse: Verschiebt man die Kante, wechselt
 * genau die Strecke zwischen alter und neuer Lage den Modus. Ihre Filmzeit
 * ändert sich um die Differenz der Kehrwerte der Tempi — alles andere bleibt.
 * (Für die Vorschau „Film 3:00 → 3:29" im Zug-Etikett.)
 */
export function filmDurationAtBoundary(
  totalS: number,
  metersOld: number,
  metersNew: number,
  left: TravelMode,
  right: TravelMode,
): number {
  return totalS + (metersNew - metersOld) * (1 / tempoMs(left) - 1 / tempoMs(right))
}

// — Einrasten an Haltkanten —
//
// Toleranz in AUFNAHMEzeit, nicht in Filmsekunden: 0,01 Filmsekunden schmolzen
// auf dem Rückweg durch die Achse auf ein halbes Tausendstel und verloren gegen
// die lower_bound-Konvention — die Kante landete bis 71 px neben der Ziellinie
// (docs §5.6). Eine halbe Sekunde Aufnahmezeit ist eindeutig und auf der Leiste
// unsichtbar schmal.

/** Wie nah an einer Haltkante gerastet wird (Aufnahme-Sekunden). */
export const SNAP_TOLERANCE_S = 0.5
/**
 * Abstand für „hinter dem Halt". Nicht kleiner: Overlay-Anker sind ISO-Zeiten
 * mit SEKUNDEN-Auflösung (`offsetToIso` schneidet die Millisekunden ab) — ein
 * Epsilon fiele auf dieselbe Sekunde zurück und die Kante schnappte sichtbar
 * vor den Halt.
 */
export const SNAP_BEHIND_S = 1

export interface SnapResult {
  tOffsetS: number
  /** Halt, an dem gerastet wurde — null heißt: freie Lage */
  stop: StopInterval | null
  /** true = hinter dem Halt (er läuft davor ab) */
  behind: boolean
}

/**
 * Eine Loslass-Zeit an eine Haltkante rasten.
 *
 * Zwei Wege führen hin: Die Zeit liegt in Toleranz-Nähe einer Halt-Zeit, ODER
 * die Filmsekunde liegt IM Halt — dort gibt es in Aufnahmezeit gar keine
 * Zwischenposition, jede Rückrechnung fällt ohnehin auf seine linke Kante. Auf
 * welcher Seite die Grenze landet, entscheidet die Zeigerhälfte des Halts.
 *
 * `halte`, `filmS` und `tOffsetS` müssen aus DERSELBEN Abbildung stammen — und
 * das ist die, die der Nutzer SIEHT: die Achse. Beim Zug einer
 * Fortbewegungs-Grenze ist die Versuchung groß, hier die Grenzkurve zu nehmen
 * (in ihr rechnet der Zug ja seine Landezeit). Das geht zweimal schief: mit
 * gemischten Systemen rastet der Zug am falschen Halt, und mit durchgehend
 * Kurven-Koordinaten rastet er an einem Halt, der 159 px neben dem Zeiger
 * gezeichnet ist — richtig gerechnet, aber unbedienbar. Wo der Halt beim
 * Loslassen LANDET, ist eine andere Frage; sie hat mit dem Zielen nichts zu tun.
 *
 * Zurück kommt die Landezeit als AUFNAHMEzeit — die ist in beiden Systemen
 * dieselbe Größe und deshalb der einzige saubere Übergabepunkt.
 */
export function snapToStop(
  stops: readonly StopInterval[],
  tOffsetS: number,
  filmS: number,
): SnapResult {
  let hit: StopInterval | null = null
  let bestDelta = Infinity
  for (const h of stops) {
    const inside = filmS > h.filmVon && filmS < h.filmBis
    const from = Math.abs(h.offsetS - tOffsetS)
    if (!inside && from > SNAP_TOLERANCE_S) continue
    if (inside || from < bestDelta) {
      bestDelta = inside ? -1 : from
      hit = h
    }
  }
  if (!hit) return { tOffsetS, stop: null, behind: false }
  const behind = filmS >= (hit.filmVon + hit.filmBis) / 2
  return { tOffsetS: hit.offsetS + (behind ? SNAP_BEHIND_S : 0), stop: hit, behind }
}

/**
 * Die Zug-Filmsekunde in ihr Fenster klemmen — in PIXELN, nicht in Sekunden.
 *
 * Mit ±1 s konnten zwei Grenzen so nah zusammenrücken, dass das Band dazwischen
 * unsichtbar und unanfassbar wurde (dieselbe Sorge wie `clampBoundary`, die
 * mindestens einen Trackpunkt im Abschnitt lässt). Ein Mindestabstand in
 * Pixeln hält das Band greifbar, egal wie die Achse dort gestaucht ist.
 */
export const BAND_MIN_PX = 14

export function clampFilmS(
  filmS: number,
  minFilmS: number,
  maxFilmS: number,
  pxProFilmS: number,
): number {
  const slack = pxProFilmS > 0 ? BAND_MIN_PX / pxProFilmS : 0
  const min = minFilmS + slack
  const max = maxFilmS - slack
  // Ist das Fenster schmaler als zweimal Luft, bleibt nur seine Mitte übrig —
  // besser als eine Klemme, die sich selbst überkreuzt.
  if (max <= min) return (minFilmS + maxFilmS) / 2
  return Math.max(min, Math.min(max, filmS))
}

/**
 * Abspiel-Kurve über der Achse: Achsen-Anteil → Filmsekunden der WIEDERGABE.
 * Ohne Trim die Identität (die Achse ist ja schon film-proportional); mit
 * Trim Plateaus über den inaktiven Bereichen — der Kopf fliegt darüber
 * hinweg, statt hypothetische Randbereiche abzuspielen.
 */
export function buildPlaybackCurve(
  axis: TimelineAxis,
  displaySegments: ReadonlyArray<{ active: boolean; pts: readonly TrackPoint[] }>,
): FilmCurve {
  const curve = axis.curve
  if (!curve) return { fractions: [0, 1], filmS: [0, 1], totalS: 1 }
  if (displaySegments.every((a) => a.active)) {
    return { fractions: [0, 1], filmS: [0, curve.totalS], totalS: curve.totalS }
  }
  const fractions: number[] = [0]
  const filmS: number[] = [0]
  let film = 0
  for (const a of displaySegments) {
    const fromT = (a.pts[0] as TrackPoint)[3]
    const toT = (a.pts[a.pts.length - 1] as TrackPoint)[3]
    if (a.active) film += filmToOffset(axis, toT) - filmToOffset(axis, fromT)
    fractions.push(offsetToFraction(axis, toT))
    filmS.push(film)
  }
  fractions.push(1)
  filmS.push(film)
  return film >= 1
    ? { fractions, filmS, totalS: film }
    : { fractions: [0, 1], filmS: [0, 1], totalS: 1 }
}

// — Maßband —
//
// Die Achse ist film-proportional, das Maßband zählt deshalb FILMZEIT („0:30",
// „1:00") — gleichmäßige Marken statt des alten Wanduhr-Rasters (die Uhrzeit
// der Aufnahme steht weiter in Kopf-Uhr und Inspector). Beim Hineinzoomen wird
// Platz frei, also darf die Skala feiner werden: die Stufe ist die FEINSTE,
// bei der zwei Beschriftungen noch `MARKE_MIN_PX` auseinanderliegen.

/** Stufen in Film-Sekunden, aufsteigend — von der Sekunde bis zur Stunde. */
const STEPS_S = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600] as const
/** Mindestabstand zweier Beschriftungen in px (eine „m:ss" ist ~34 px breit). */
const MARK_MIN_PX = 58
/** Halbe Beschriftungsbreite — darunter würde die Marke am Rand angeschnitten. */
const MARK_HALF_PX = 20

/** Feinste Stufe (Film-Sekunden), die bei diesem Maßstab noch lesbar bleibt. */
export function chooseFilmStep(pxProS: number): number {
  for (const s of STEPS_S) {
    if (s * pxProS >= MARK_MIN_PX) return s
  }
  return STEPS_S[STEPS_S.length - 1] as number
}

/** Filmzeit als „m:ss", ab einer Stunde „h:mm:ss". */
export function formatFilmTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const mm = Math.floor(s / 60)
  const ss = String(s % 60).padStart(2, '0')
  if (mm < 60) return `${mm}:${ss}`
  return `${Math.floor(mm / 60)}:${String(mm % 60).padStart(2, '0')}:${ss}`
}

export interface RulerMark {
  fraction: number
  text: string
  /** volle Minute — kräftigerer Teilstrich als die Zwischenstufen */
  full: boolean
  /** am Rand angeschnitten? Dann links- statt mittenbündig ausrichten. */
  edge: 'start' | 'end' | null
}

/**
 * Beschriftete Marken der Filmzeit-Achse. Weil die Achse film-linear ist,
 * liegen die Marken äquidistant — auch mitten in einem Foto-Halt vergeht
 * Filmzeit, dort stehen sie genauso. Ohne Kurve (degenerierte Tour) gibt es
 * nichts Sinnvolles zu beschriften: leeres Band.
 */
export function buildFilmRuler(axis: TimelineAxis, pxProS: number): RulerMark[] {
  const totalS = axis.curve?.totalS
  if (!totalS || !(pxProS > 0)) return []

  const stepS = chooseFilmStep(pxProS)
  const widthPx = totalS * pxProS
  const marks: RulerMark[] = []
  for (let filmT = 0; filmT <= totalS; filmT += stepS) {
    const fraction = filmT / totalS
    const x = fraction * widthPx
    marks.push({
      fraction,
      text: formatFilmTime(filmT),
      full: filmT % 60 === 0,
      edge: x < MARK_HALF_PX ? 'start' : x > widthPx - MARK_HALF_PX ? 'end' : null,
    })
  }
  return marks
}

// — Streckenmeter —
//
// Die Leiste zeigt Zeit, die Kopf-Uhr daneben aber „19,2 km / 41,8 km": wo auf
// der STRECKE steht der Abspielkopf? Dafür einmal die kumulierten Meter je
// Trackpunkt aufbauen und zwischen den Punkten linear interpolieren.

/** Kumulierte Streckenmeter je Trackpunkt (Index-gleich zu `track`). */
export function cumMeters(track: readonly TrackPoint[]): number[] {
  const cum: number[] = new Array(track.length)
  cum[0] = 0
  for (let i = 1; i < track.length; i++) {
    cum[i] =
      (cum[i - 1] as number) + metersBetween(track[i - 1] as TrackPoint, track[i] as TrackPoint)
  }
  return cum
}

/** Zurückgelegte Meter zum Zeit-Offset (s), zwischen den Punkten interpoliert. */
export function metersToOffset(
  cum: readonly number[],
  track: readonly TrackPoint[],
  tOffsetS: number,
): number {
  if (track.length === 0) return 0
  const first = track[0] as TrackPoint
  const last = track[track.length - 1] as TrackPoint
  if (tOffsetS <= first[3]) return 0
  if (tOffsetS >= last[3]) return (cum[cum.length - 1] as number) ?? 0
  let i = 1
  while (i < track.length - 1 && (track[i] as TrackPoint)[3] < tOffsetS) i++
  const a = track[i - 1] as TrackPoint
  const b = track[i] as TrackPoint
  const span = b[3] - a[3]
  const f = span > 0 ? (tOffsetS - a[3]) / span : 0
  return (cum[i - 1] as number) + f * ((cum[i] as number) - (cum[i - 1] as number))
}

/** Zeit-Offset (s) zu zurückgelegten Metern — Umkehrung von `metersToOffset`. */
export function offsetAtMeters(
  cum: readonly number[],
  track: readonly TrackPoint[],
  meters: number,
): number {
  if (track.length === 0) return 0
  const first = track[0] as TrackPoint
  const last = track[track.length - 1] as TrackPoint
  const max = (cum[cum.length - 1] as number) ?? 0
  if (meters <= 0) return first[3]
  if (meters >= max) return last[3]
  let i = 1
  while (i < cum.length - 1 && (cum[i] as number) < meters) i++
  const a = cum[i - 1] as number
  const b = cum[i] as number
  const span = b - a
  const f = span > 0 ? (meters - a) / span : 0
  const ta = (track[i - 1] as TrackPoint)[3]
  const tb = (track[i] as TrackPoint)[3]
  return ta + f * (tb - ta)
}

/**
 * Nach dem Zoomen die Ansicht so scrollen, dass der Anker (Anteil 0..1) wieder
 * an derselben Stelle im Fenster steht — sonst springt der Blick beim Zoomen
 * irgendwohin. `laneXPx` ist die feste Breite der Namensspalte links.
 */
export function scrollAnchor(
  anchorFraction: number,
  timeWidthPx: number,
  targetVx: number,
  laneXpx: number,
): number {
  return Math.max(0, laneXpx + anchorFraction * timeWidthPx - targetVx)
}
