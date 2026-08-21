// Gehpausen erkennen: Wer mit dem Rad unterwegs ist, schiebt bergauf, geht
// durch die Altstadt und steht an Ampeln. In der Kamerafahrt sah das bisher
// aus wie eine langsame Radfahrt, weil die App EINEN Modus für die ganze Tour
// kannte — und die Chip-Reihe, mit der man ihn unterwegs hätte umschalten
// können, hat niemand bedient.
//
// Das Fortbewegungsmittel bleibt die Angabe des Nutzers (aus dem Start-Blatt
// oder dem Editor). Hier wird nur getrennt, wo er stattdessen zu Fuß war.
// Bewusst konservativ: aus dem Tempo lässt sich Gehen von Fahren
// unterscheiden, aber nicht Moped von Jeep von Tram.

import { distanceM } from './geo.js'
import type { TravelMode, UploadPoint, UploadSegment } from '../schema/upload.js'

/** Halbe Fensterbreite für den gleitenden Median (s). */
const WINDOW_S = 30

/** Unter diesem Tempo beginnt ein Gehabschnitt (km/h). */
const WALK_IN_KMH = 5.5

/**
 * Erst darüber endet er wieder — die Lücke zwischen den Schwellen verhindert,
 * dass ein Abschnitt bei jedem Schwanken um den Grenzwert zerfällt.
 */
const WALK_OUT_KMH = 8

/** Kürzere Abschnitte gehen im Nachbarn auf (s). */
const MIN_WALK_S = 120
const MIN_RIDE_S = 90

/**
 * Unter dieser VERDRÄNGUNG war es ein Halt, kein Gehen (m).
 *
 * Gemessen wird die Luftlinie zwischen Anfang und Ende, nicht die aufaddierte
 * Weglänge: Im Stand zittert das GPS um ein paar Meter, und über eine
 * Viertelstunde summiert sich dieses Zittern auf hunderte Meter „Strecke", die
 * niemand gegangen ist. Wer steht, kommt nicht vom Fleck — das ist das
 * belastbare Merkmal.
 *
 * Ohne diese Schranke bekäme jeder Fotostopp einer Mopedtour einen
 * Gehabschnitt; bei zwölf Fotos zwölf falsche Wechsel. Wie lange die Pause im
 * fertigen Film dauert, entscheidet die Zeitachse (zeit.ts), nicht die
 * Fortbewegung.
 */
const MIN_WALK_DISPLACEMENT_M = 60

/** Ab diesem Median-Tempo gilt eine Tour ohne Angabe als Radfahrt (km/h). */
const RAD_AB_KMH = 7

/** So dicht liegen die Punkte einer echten Aufzeichnung mindestens (s). */
const RECORDING_INTERVAL_S = 35
/** So viele Punkte braucht es, damit der Takt überhaupt etwas aussagt. */
const RECORDING_MIN_POINTS = 30
/** So viele Abstände müssen im Takt liegen. */
const RECORDING_SHARE = 0.8

/**
 * Sind diese Segmente eine AUFZEICHNUNG — oder gesetzte Wegpunkte?
 *
 * Die Unterscheidung entscheidet, ob die Tempo-Automatik überhaupt laufen darf:
 * Zwischen zwei Foto-Orten liegt eine Luftlinie, und jedes daraus gerechnete
 * Tempo wäre Zufall. Ein Manifest-Feld dafür gibt es nicht (und Bestandstouren
 * hätten es ohnehin nicht), aber die Form der Daten verrät es: Die App legt im
 * Stand wie in Fahrt spätestens alle 30 s einen Punkt ab (PunktFilter), eine
 * Aufzeichnung hat also ein dichtes, regelmäßiges Zeitraster. Foto-Zeiten sind
 * unregelmäßig und Minuten bis Stunden auseinander.
 *
 * Verlangt wird der Takt für die MEHRHEIT der Abstände, nicht für alle: Ein
 * Tunnel ohne Empfang oder ein kurz pausierter Track reißt sonst jede
 * Aufzeichnung aus der Wertung.
 */
export function isRecording(segs: readonly UploadSegment[]): boolean {
  const times = segs.flatMap((s) => s.pts.map((p) => p[3]))
  if (times.length < RECORDING_MIN_POINTS) return false
  let onBeat = 0
  for (let i = 1; i < times.length; i++) {
    const dt = (times[i] as number) - (times[i - 1] as number)
    if (dt >= 0 && dt <= RECORDING_INTERVAL_S) onBeat++
  }
  return onBeat / (times.length - 1) >= RECORDING_SHARE
}

/**
 * Tempo je Punkt als gleitender Median über ±FENSTER_S.
 *
 * Median statt Mittelwert, weil GPS-Ausreißer sonst einzelne Punkte auf
 * 80 km/h schleudern und dort einen Fahrabschnitt erfinden würden.
 */
/** Momentantempo je Punkt aus dem Abstand zu seinen Nachbarn (km/h). */
function rawSpeedKmh(pts: readonly UploadPoint[]): number[] {
  const raw: number[] = []
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)]!
    const b = pts[Math.min(pts.length - 1, i + 1)]!
    const dt = b[3] - a[3]
    raw.push(dt > 0 ? (distanceM([a[0], a[1]], [b[0], b[1]]) / dt) * 3.6 : 0)
  }
  return raw
}

export function speedProfileKmh(pts: readonly UploadPoint[]): number[] {
  if (pts.length < 2) return pts.map(() => 0)

  const raw = rawSpeedKmh(pts)

  return pts.map((p, i) => {
    const window: number[] = []
    for (let j = i; j >= 0 && p[3] - pts[j]![3] <= WINDOW_S; j--) window.push(raw[j]!)
    for (let j = i + 1; j < pts.length && pts[j]![3] - p[3] <= WINDOW_S; j++) window.push(raw[j]!)
    window.sort((x, y) => x - y)
    const mid = Math.floor(window.length / 2)
    return window.length % 2 ? window[mid]! : (window[mid - 1]! + window[mid]!) / 2
  })
}

/** Ein zusammenhängender Abschnitt gleicher Fortbewegung. */
interface Section {
  fromIndex: number
  toIndex: number
  walking: boolean
}

/** Punkte anhand des Tempos in Geh- und Fahrabschnitte teilen (mit Hysterese). */
function splitBySpeed(tempo: readonly number[]): Section[] {
  const sections: Section[] = []
  let walking = tempo[0]! < WALK_IN_KMH
  let start = 0
  for (let i = 1; i < tempo.length; i++) {
    const switches = walking ? tempo[i]! > WALK_OUT_KMH : tempo[i]! < WALK_IN_KMH
    if (!switches) continue
    sections.push({ fromIndex: start, toIndex: i, walking })
    walking = !walking
    start = i
  }
  sections.push({ fromIndex: start, toIndex: tempo.length - 1, walking })
  return sections
}

/**
 * Die Grenzen auf den tatsächlichen Bewegungswechsel ziehen.
 *
 * Der gleitende Median hinkt naturgemäß nach: Nach einer Fotopause zeigt er noch
 * Stillstand an, während das Moped längst fährt. Weil GPS-Punkte im Stand dicht
 * und auf der Landstraße weit auseinander liegen, sind das schnell einige
 * hundert Meter Fahrt, die als Gehstrecke gälten. Das MOMENTANtempo weiß es
 * genauer — es zittert nur zu sehr, um allein die Abschnitte zu setzen. Also:
 * Abschnitte per Median finden, ihre Kanten per Momentantempo schärfen.
 */
function sharpenBoundaries(sections: Section[], raw: readonly number[]): Section[] {
  for (let i = 1; i < sections.length; i++) {
    const before = sections[i - 1]!
    const after = sections[i]!
    const alreadyIncluded = (tempo: number): boolean =>
      after.walking ? tempo < WALK_IN_KMH : tempo > WALK_OUT_KMH
    let boundary = after.fromIndex
    while (boundary > before.fromIndex + 1 && alreadyIncluded(raw[boundary - 1]!)) boundary--
    before.toIndex = boundary
    after.fromIndex = boundary
  }
  return sections
}

/**
 * Hält dieser Abschnitt der Nachprüfung stand — oder soll er im Nachbarn
 * aufgehen? Eine Ampel ist kein Spaziergang, und ein Meter Rollen mitten im
 * Wandern keine Radfahrt.
 *
 * Für Gehabschnitte kommen zwei Proben am ERGEBNIS dazu, die das punktweise
 * Tempo allein nicht leisten kann:
 *
 * 1. **Ohne Strecke kein Gehen.** Ein Halt sieht im Tempo aus wie Schritttempo,
 *    kommt aber nicht vom Fleck.
 * 2. **Wer im Schnitt fuhr, ging nicht.** Der gleitende Median hinkt nach, und
 *    weil GPS-Punkte im Stand dicht und auf der Landstraße weit auseinander
 *    liegen, kann ein einziger Punkt einen Kilometer Fahrt vertreten. Bis der
 *    Median nach einer Pause kippt, ist die halbe Ausfahrt als „zu Fuß"
 *    markiert — es sei denn, man misst am Ende nach.
 */
function isCredible(a: Section, pts: readonly UploadPoint[]): boolean {
  const durationS = pts[a.toIndex]![3] - pts[a.fromIndex]![3]
  if (durationS < (a.walking ? MIN_WALK_S : MIN_RIDE_S)) return false
  if (!a.walking) return true

  const from = pts[a.fromIndex]!
  const to = pts[a.toIndex]!
  if (distanceM([from[0], from[1]], [to[0], to[1]]) < MIN_WALK_DISPLACEMENT_M) return false

  // Fürs Tempo zählt dagegen der zurückgelegte Weg — sonst spräche eine Kurve
  // einen zu schnellen Abschnitt frei, nur weil sie zum Ausgangspunkt zurückführt.
  let distance = 0
  for (let i = a.fromIndex + 1; i <= a.toIndex; i++) {
    const v = pts[i - 1]!
    const n = pts[i]!
    distance += distanceM([v[0], v[1]], [n[0], n[1]])
  }
  return durationS <= 0 || (distance / durationS) * 3.6 <= WALK_OUT_KMH
}

/** Unglaubwürdige Abschnitte im (zeitlich) größeren Nachbarn aufgehen lassen. */
function mergeShort(sections: Section[], pts: readonly UploadPoint[]): Section[] {
  const duration = (a: Section): number => pts[a.toIndex]![3] - pts[a.fromIndex]![3]
  let list = sections
  let changed = true
  while (changed && list.length > 1) {
    changed = false
    for (let i = 0; i < list.length; i++) {
      const a = list[i]!
      if (isCredible(a, pts)) continue
      // In den (zeitlich) größeren Nachbarn schlucken, damit kurze Stücke
      // nicht reihum die Richtung wechseln
      const before = list[i - 1]
      const after = list[i + 1]
      const out = !before
        ? after
        : !after
          ? before
          : duration(before) >= duration(after)
            ? before
            : after
      if (!out) break
      out.fromIndex = Math.min(out.fromIndex, a.fromIndex)
      out.toIndex = Math.max(out.toIndex, a.toIndex)
      list = list.filter((x) => x !== a)
      // Gleichartige Nachbarn zusammenziehen, die durch das Schlucken entstanden
      list = list.reduce<Section[]>((acc, x) => {
        const last = acc[acc.length - 1]
        if (last && last.walking === x.walking) {
          last.toIndex = Math.max(last.toIndex, x.toIndex)
          return acc
        }
        acc.push(x)
        return acc
      }, [])
      changed = true
      break
    }
  }
  return list
}

/**
 * Primärmodus einer Tour ohne Angabe: Nur die Hebung walk → bike wird geraten.
 * Moped, Jeep, Tram und Fähre lassen sich am Tempo nicht auseinanderhalten —
 * sie bleiben Sache des Nutzers.
 */
function primaryWithoutHint(tempo: readonly number[]): TravelMode {
  const riding = tempo.filter((t) => t >= WALK_IN_KMH).sort((a, b) => a - b)
  if (!riding.length) return 'walk'
  const median = riding[Math.floor(riding.length / 2)]!
  return median > RAD_AB_KMH ? 'bike' : 'walk'
}

/**
 * Ein Segment in Geh- und Primärabschnitte zerlegen.
 *
 * Der Grenzpunkt gehört BEIDEN Abschnitten — dieselbe Konvention wie bei den
 * Modus-Grenzen aus dem Editor, sonst entsteht beim Verketten eine Lücke.
 * Ändert sich nichts, kommt das Segment unverändert zurück.
 */
export function splitWalkSegments(seg2: UploadSegment): UploadSegment[] {
  if (seg2.pts.length < 4) return [seg2]

  const tempo = speedProfileKmh(seg2.pts)
  const primary: TravelMode = seg2.mode === 'walk' ? primaryWithoutHint(tempo) : seg2.mode
  // Ohne erkennbare Fahrt bleibt alles, wie es ist
  if (primary === 'walk') return [seg2]

  const sections = mergeShort(
    sharpenBoundaries(splitBySpeed(tempo), rawSpeedKmh(seg2.pts)),
    seg2.pts,
  )
  if (sections.length < 2) {
    // Ein einziger Abschnitt: nur der Modus kann sich noch geändert haben.
    // Das Label des Originals fällt dabei weg — es beschrieb den alten Modus.
    const mode: TravelMode = sections[0]?.walking ? 'walk' : primary
    return mode === seg2.mode ? [seg2] : [{ mode, pts: seg2.pts }]
  }

  return sections.map((a) => ({
    mode: a.walking ? ('walk' as TravelMode) : primary,
    pts: seg2.pts.slice(a.fromIndex, a.toIndex + 1),
  }))
}

/**
 * Automatik für eine ganze Aufzeichnung.
 *
 * Sie greift nur, wenn genau EIN Segment vorliegt: Mehrere Segmente heißen,
 * dass jemand den Modus bewusst umgeschaltet hat (ältere Aufnahmen mit der
 * Chip-Reihe, oder ein GPX-Import mit Vorgabe) — diese Entscheidung wird nicht
 * überschrieben.
 */
export function splitWalkSegmentsInSegments(segs: readonly UploadSegment[]): UploadSegment[] {
  if (segs.length !== 1) return [...segs]
  return splitWalkSegments(segs[0]!)
}
