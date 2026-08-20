// Foto-Stopps: Aufnahmen, die am selben Ort gemacht wurden, gehören zusammen.
//
// Der Player gruppiert Fotos, deren Anker weniger als 120 STRECKENMETER
// auseinanderliegen, zu EINEM Halt und zeigt sie dort nacheinander (src/geo.ts,
// gruppiereStopps). Der Editor muss dieselbe Gruppierung zeigen — sonst plant
// man zwölf Halte und sieht später acht.
//
// Wie überall im Studio ist das hier reine, DOM-freie Logik; die Verdrahtung
// (Ziehen, Filmstreifen) liegt in editor.ts.

import { reihenfolgeImHalt } from '../einblendung.js'
import {
  withMediaEdit,
  projectOntoTrack,
  type EditOverlay,
  type MediaView,
  type TrackPoint,
} from './editmodell.js'
import { metersToOffset, offsetAtMeters } from './zeitleiste.js'

/**
 * Abstand, unter dem zwei Aufnahmen als „am selben Ort" gelten (Streckenmeter).
 * MUSS mit NAHE_M in src/geo.ts übereinstimmen — ein Drift-Wächter in
 * test/studio-stopps.test.ts vergleicht beide.
 */
export const NAHE_M = 120

export interface Stopp {
  /** Aufnahmen des Halts, in ihrer Reihenfolge (siehe MediaEdit.order) */
  items: MediaView[]
  /** Streckenmeter des Halts (Mittel der Mitglieder) */
  meter: number
  /** Zeit-Offset (s) des Halts — dort steht seine Miniatur auf der Achse */
  offsetS: number
}

/** Streckenmeter und Zeit-Offset einer Aufnahme (Anker auf die Linie projiziert). */
function ortVon(
  m: MediaView,
  track: readonly TrackPoint[],
  kum: readonly number[],
): { meter: number; offsetS: number } | null {
  if (!m.anchor || m.removed) return null
  const p = projectOntoTrack(track, m.anchor[0], m.anchor[1])
  return { meter: metersToOffset(kum, track, p.point[3]), offsetS: p.point[3] }
}

/**
 * Platzierte Aufnahmen zu Stopps gruppieren.
 *
 * Gruppiert wird über die STRECKE (wie im Player), geordnet innerhalb eines
 * Stopps über `order` — welches Bild zuerst kommt, ist eine Entscheidung des
 * Autors und keine Messung. Ohne `order` entscheidet die Aufnahmezeit.
 */
export function baueStopps(
  media: readonly MediaView[],
  track: readonly TrackPoint[],
  kum: readonly number[],
): Stopp[] {
  const mitOrt = media
    .map((m) => ({ m, ort: ortVon(m, track, kum) }))
    .filter((x): x is { m: MediaView; ort: { meter: number; offsetS: number } } => x.ort !== null)
    .sort((a, b) => a.ort.meter - b.ort.meter)

  const gruppen: Array<{ items: MediaView[]; meter: number[]; offsets: number[] }> = []
  for (const x of mitOrt) {
    const letzte = gruppen[gruppen.length - 1]
    // Gemessen wird zum ANFANG des Halts, nicht zum Vorgänger — sonst könnte
    // eine Perlenkette knapp benachbarter Aufnahmen zu einem beliebig langen
    // Stopp verschmelzen. Genau so entscheidet es der Player (gruppiereStopps
    // in src/geo.ts); ein Drift-Wächter vergleicht beide Wege.
    const anfang = letzte?.meter[0]
    if (letzte && anfang !== undefined && x.ort.meter - anfang < NAHE_M) {
      letzte.items.push(x.m)
      letzte.meter.push(x.ort.meter)
      letzte.offsets.push(x.ort.offsetS)
    } else {
      gruppen.push({ items: [x.m], meter: [x.ort.meter], offsets: [x.ort.offsetS] })
    }
  }

  return gruppen.map((g) => ({
    items: sortiereItems(g.items),
    meter: g.meter.reduce((s, v) => s + v, 0) / g.meter.length,
    offsetS: g.offsets.reduce((s, v) => s + v, 0) / g.offsets.length,
  }))
}

/**
 * `order` zuerst (0-basiert), danach die Aufnahmezeit.
 *
 * Die Regel ist mit dem Player geteilt (`reihenfolgeImHalt` in
 * src/einblendung.ts); verschieden ist nur die natürliche Ordnung dahinter —
 * dort die Streckenmeter, hier die Aufnahmezeit. Eine Aufnahme ohne
 * verlässlichen Ort ist im Editor trotzdem einzuordnen.
 */
function sortiereItems(items: MediaView[]): MediaView[] {
  return reihenfolgeImHalt(items, (m) => Date.parse(m.takenAt))
}

/** Stopp, zu dem eine Aufnahme gehört. */
export function stoppVon(stopps: readonly Stopp[], id: string): Stopp | undefined {
  return stopps.find((s) => s.items.some((m) => m.id === id))
}

/**
 * Nächste FREMDE Aufnahme in Schnapp-Nähe (Streckenmeter) — beim Ziehen rastet
 * ein Stopp auf ihr ein. „An derselben Stelle" trifft man sonst nie auf den Pixel.
 */
export function snapZiel(
  zielMeter: number,
  fremde: ReadonlyArray<{ id: string; meter: number }>,
  schwelleM = NAHE_M,
): { id: string; meter: number } | null {
  let best: { id: string; meter: number } | null = null
  let bestAb = Infinity
  for (const f of fremde) {
    const from = Math.abs(f.meter - zielMeter)
    if (from < bestAb) {
      bestAb = from
      best = f
    }
  }
  return best && bestAb <= schwelleM ? best : null
}

/**
 * Streckenmeter so verschieben, dass der Halt nicht unter `schwelleM` an eine
 * fremde Aufnahme gerät. Ohne Kollision unverändert. Bewusst ≥ schwelleM:
 * `baueStopps` gruppiert nur bei Abstand *strikt kleiner* als NAHE_M.
 */
export function meterOhneCluster(
  zielMeter: number,
  fremdeMeter: readonly number[],
  schwelleM = NAHE_M,
): number {
  let m = zielMeter
  for (let n = 0; n < fremdeMeter.length + 1; n++) {
    let hit: { meter: number } | null = null
    let bestAb = Infinity
    for (const f of fremdeMeter) {
      const from = Math.abs(f - m)
      if (from < schwelleM && from < bestAb) {
        bestAb = from
        hit = { meter: f }
      }
    }
    if (!hit) return m
    m = hit.meter + (m >= hit.meter ? 1 : -1) * schwelleM
  }
  return m
}

/**
 * Gemeinsamen Zeit-Versatz so wählen, dass KEIN Gruppenmitglied mit einer
 * fremden Aufnahme unter NAHE_M fällt — nur wer beim Ziehen explizit einrastet,
 * soll clustern. Ohne Kollision: `dOffset` unverändert.
 */
export function dOffsetOhneCluster(
  gruppeOffset0: readonly number[],
  dOffset: number,
  fremdeMeter: readonly number[],
  kum: readonly number[],
  track: readonly TrackPoint[],
  schwelleM = NAHE_M,
): number {
  if (fremdeMeter.length === 0 || gruppeOffset0.length === 0) return dOffset
  const kopf = gruppeOffset0[0]
  if (kopf === undefined) return dOffset
  let d = dOffset
  for (let iter = 0; iter < fremdeMeter.length + 1; iter++) {
    let deltaM: number | null = null
    for (const o0 of gruppeOffset0) {
      const m = metersToOffset(kum, track, o0 + d)
      for (const f of fremdeMeter) {
        const from = m - f
        if (Math.abs(from) < schwelleM) {
          const zielM = from >= 0 ? f + schwelleM : f - schwelleM
          const braucht = zielM - m
          if (deltaM === null || Math.abs(braucht) > Math.abs(deltaM)) deltaM = braucht
        }
      }
    }
    if (deltaM === null) return d
    const mJetzt = metersToOffset(kum, track, kopf + d)
    d = offsetAtMeters(kum, track, mJetzt + deltaM) - kopf
  }
  return d
}

/**
 * Billiger Vergleich, ob sich die GRUPPIERUNG geändert hat. Beim Scrubben eines
 * Zeitfeldes sollen nur Positionen nachrücken; erst wenn Stopps entstehen oder
 * zerfallen, lohnt der Neuaufbau der Bahn.
 */
export function stoppSignatur(stopps: readonly Stopp[]): string {
  return stopps.map((s) => s.items.map((m) => m.id).join('+')).join('|')
}

/**
 * Die Reihenfolge eines Stopps festschreiben: jedes Mitglied bekommt seinen
 * Platz als `order` 0..n−1. Ohne das Feld entschiede die Projektion auf die
 * Route über die Abfolge — für den Autor unkontrollierbar.
 */
export function reiheVergeben(edits: EditOverlay, ids: readonly string[]): EditOverlay {
  let naechste = edits
  ids.forEach((id, i) => {
    naechste = withMediaEdit(naechste, id, { order: i })
  })
  return naechste
}
