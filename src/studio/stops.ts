// Foto-Stopps: Aufnahmen, die am selben Ort gemacht wurden, gehören zusammen.
//
// Der Player gruppiert Fotos, deren Anker weniger als 120 STRECKENMETER
// auseinanderliegen, zu EINEM Halt und zeigt sie dort nacheinander (src/geo.ts,
// gruppiereStopps). Der Editor muss dieselbe Gruppierung zeigen — sonst plant
// man zwölf Halte und sieht später acht.
//
// Wie überall im Studio ist das hier reine, DOM-freie Logik; die Verdrahtung
// (Ziehen, Filmstreifen) liegt in editor.ts.

import { orderInStop } from '../card-timing.js'
import {
  withMediaEdit,
  projectOntoTrack,
  type EditOverlay,
  type MediaView,
  type TrackPoint,
} from './edit-model.js'
import { metersToOffset, offsetAtMeters } from './timeline.js'

/**
 * Abstand, unter dem zwei Aufnahmen als „am selben Ort" gelten (Streckenmeter).
 * MUSS mit NAHE_M in src/geo.ts übereinstimmen — ein Drift-Wächter in
 * test/studio-stopps.test.ts vergleicht beide.
 */
export const NEAR_M = 120

export interface Stop {
  /** Aufnahmen des Halts, in ihrer Reihenfolge (siehe MediaEdit.order) */
  items: MediaView[]
  /** Streckenmeter des Halts (Mittel der Mitglieder) */
  meters: number
  /** Zeit-Offset (s) des Halts — dort steht seine Miniatur auf der Achse */
  offsetS: number
}

/** Streckenmeter und Zeit-Offset einer Aufnahme (Anker auf die Linie projiziert). */
function placeOf(
  m: MediaView,
  track: readonly TrackPoint[],
  cum: readonly number[],
): { meters: number; offsetS: number } | null {
  if (!m.anchor || m.removed) return null
  const p = projectOntoTrack(track, m.anchor[0], m.anchor[1])
  return { meters: metersToOffset(cum, track, p.point[3]), offsetS: p.point[3] }
}

/**
 * Platzierte Aufnahmen zu Stopps gruppieren.
 *
 * Gruppiert wird über die STRECKE (wie im Player), geordnet innerhalb eines
 * Stopps über `order` — welches Bild zuerst kommt, ist eine Entscheidung des
 * Autors und keine Messung. Ohne `order` entscheidet die Aufnahmezeit.
 */
export function buildStops(
  media: readonly MediaView[],
  track: readonly TrackPoint[],
  cum: readonly number[],
): Stop[] {
  const withPlace = media
    .map((m) => ({ m, place: placeOf(m, track, cum) }))
    .filter(
      (x): x is { m: MediaView; place: { meters: number; offsetS: number } } => x.place !== null,
    )
    .sort((a, b) => a.place.meters - b.place.meters)

  const groups: Array<{ items: MediaView[]; meters: number[]; offsets: number[] }> = []
  for (const x of withPlace) {
    const last = groups[groups.length - 1]
    // Gemessen wird zum ANFANG des Halts, nicht zum Vorgänger — sonst könnte
    // eine Perlenkette knapp benachbarter Aufnahmen zu einem beliebig langen
    // Stopp verschmelzen. Genau so entscheidet es der Player (gruppiereStopps
    // in src/geo.ts); ein Drift-Wächter vergleicht beide Wege.
    const start = last?.meters[0]
    if (last && start !== undefined && x.place.meters - start < NEAR_M) {
      last.items.push(x.m)
      last.meters.push(x.place.meters)
      last.offsets.push(x.place.offsetS)
    } else {
      groups.push({ items: [x.m], meters: [x.place.meters], offsets: [x.place.offsetS] })
    }
  }

  return groups.map((g) => ({
    items: sortItems(g.items),
    meters: g.meters.reduce((s, v) => s + v, 0) / g.meters.length,
    offsetS: g.offsets.reduce((s, v) => s + v, 0) / g.offsets.length,
  }))
}

/**
 * `order` zuerst (0-basiert), danach die Aufnahmezeit.
 *
 * Die Regel ist mit dem Player geteilt (`orderInStop` in
 * src/card-timing.ts); verschieden ist nur die natürliche Ordnung dahinter —
 * dort die Streckenmeter, hier die Aufnahmezeit. Eine Aufnahme ohne
 * verlässlichen Ort ist im Editor trotzdem einzuordnen.
 */
function sortItems(items: MediaView[]): MediaView[] {
  return orderInStop(items, (m) => Date.parse(m.takenAt))
}

/** Stopp, zu dem eine Aufnahme gehört. */
export function stopOf(stops: readonly Stop[], id: string): Stop | undefined {
  return stops.find((s) => s.items.some((m) => m.id === id))
}

/**
 * Nächste FREMDE Aufnahme in Schnapp-Nähe (Streckenmeter) — beim Ziehen rastet
 * ein Stopp auf ihr ein. „An derselben Stelle" trifft man sonst nie auf den Pixel.
 */
export function snapTarget(
  targetMeters: number,
  others: ReadonlyArray<{ id: string; meters: number }>,
  thresholdM = NEAR_M,
): { id: string; meters: number } | null {
  let best: { id: string; meters: number } | null = null
  let bestDist = Infinity
  for (const f of others) {
    const from = Math.abs(f.meters - targetMeters)
    if (from < bestDist) {
      bestDist = from
      best = f
    }
  }
  return best && bestDist <= thresholdM ? best : null
}

/**
 * Streckenmeter so verschieben, dass der Halt nicht unter `schwelleM` an eine
 * fremde Aufnahme gerät. Ohne Kollision unverändert. Bewusst ≥ schwelleM:
 * `buildStops` gruppiert nur bei Abstand *strikt kleiner* als NAHE_M.
 */
export function metersWithoutCluster(
  targetMeters: number,
  otherMeters: readonly number[],
  thresholdM = NEAR_M,
): number {
  let m = targetMeters
  for (let n = 0; n < otherMeters.length + 1; n++) {
    let hit: { meters: number } | null = null
    let bestDist = Infinity
    for (const f of otherMeters) {
      const from = Math.abs(f - m)
      if (from < thresholdM && from < bestDist) {
        bestDist = from
        hit = { meters: f }
      }
    }
    if (!hit) return m
    m = hit.meters + (m >= hit.meters ? 1 : -1) * thresholdM
  }
  return m
}

/**
 * Gemeinsamen Zeit-Versatz so wählen, dass KEIN Gruppenmitglied mit einer
 * fremden Aufnahme unter NAHE_M fällt — nur wer beim Ziehen explizit einrastet,
 * soll clustern. Ohne Kollision: `dOffset` unverändert.
 */
export function dOffsetWithoutCluster(
  groupOffset0: readonly number[],
  dOffset: number,
  otherMeters: readonly number[],
  cum: readonly number[],
  track: readonly TrackPoint[],
  thresholdM = NEAR_M,
): number {
  if (otherMeters.length === 0 || groupOffset0.length === 0) return dOffset
  const head = groupOffset0[0]
  if (head === undefined) return dOffset
  let d = dOffset
  for (let iter = 0; iter < otherMeters.length + 1; iter++) {
    let deltaM: number | null = null
    for (const o0 of groupOffset0) {
      const m = metersToOffset(cum, track, o0 + d)
      for (const f of otherMeters) {
        const from = m - f
        if (Math.abs(from) < thresholdM) {
          const targetM = from >= 0 ? f + thresholdM : f - thresholdM
          const needs = targetM - m
          if (deltaM === null || Math.abs(needs) > Math.abs(deltaM)) deltaM = needs
        }
      }
    }
    if (deltaM === null) return d
    const mNow = metersToOffset(cum, track, head + d)
    d = offsetAtMeters(cum, track, mNow + deltaM) - head
  }
  return d
}

/**
 * Billiger Vergleich, ob sich die GRUPPIERUNG geändert hat. Beim Scrubben eines
 * Zeitfeldes sollen nur Positionen nachrücken; erst wenn Stopps entstehen oder
 * zerfallen, lohnt der Neuaufbau der Bahn.
 */
export function stopSignature(stops: readonly Stop[]): string {
  return stops.map((s) => s.items.map((m) => m.id).join('+')).join('|')
}

/**
 * Die Reihenfolge eines Stopps festschreiben: jedes Mitglied bekommt seinen
 * Platz als `order` 0..n−1. Ohne das Feld entschiede die Projektion auf die
 * Route über die Abfolge — für den Autor unkontrollierbar.
 */
export function assignOrder(edits: EditOverlay, ids: readonly string[]): EditOverlay {
  let next = edits
  ids.forEach((id, i) => {
    next = withMediaEdit(next, id, { order: i })
  })
  return next
}
