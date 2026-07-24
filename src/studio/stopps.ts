// Foto-Stopps: Aufnahmen, die am selben Ort gemacht wurden, gehören zusammen.
//
// Der Player gruppiert Fotos, deren Anker weniger als 120 STRECKENMETER
// auseinanderliegen, zu EINEM Halt und zeigt sie dort nacheinander (src/geo.js,
// gruppiereStopps). Der Editor muss dieselbe Gruppierung zeigen — sonst plant
// man zwölf Halte und sieht später acht.
//
// Wie überall im Studio ist das hier reine, DOM-freie Logik; die Verdrahtung
// (Ziehen, Filmstreifen) liegt in editor.ts.

import { mitMedienEdit, projiziereAufTrack, type EditOverlay, type MediumAnzeige, type TrackPunkt } from './editmodell.js'
import { meterZuOffset } from './zeitleiste.js'

/**
 * Abstand, unter dem zwei Aufnahmen als „am selben Ort" gelten (Streckenmeter).
 * MUSS mit NAHE_M in src/geo.js übereinstimmen — ein Drift-Wächter in
 * test/studio-stopps.test.ts vergleicht beide.
 */
export const NAHE_M = 120

export interface Stopp {
  /** Aufnahmen des Halts, in ihrer Reihenfolge (siehe MediumEdit.reihe) */
  items: MediumAnzeige[]
  /** Streckenmeter des Halts (Mittel der Mitglieder) */
  meter: number
  /** Zeit-Offset (s) des Halts — dort steht seine Miniatur auf der Achse */
  offsetS: number
}

/** Streckenmeter und Zeit-Offset einer Aufnahme (Anker auf die Linie projiziert). */
function ortVon(m: MediumAnzeige, track: readonly TrackPunkt[], kum: readonly number[]): { meter: number; offsetS: number } | null {
  if (!m.anchor || m.geloescht) return null
  const p = projiziereAufTrack(track, m.anchor[0], m.anchor[1])
  return { meter: meterZuOffset(kum, track, p.punkt[3]), offsetS: p.punkt[3] }
}

/**
 * Platzierte Aufnahmen zu Stopps gruppieren.
 *
 * Gruppiert wird über die STRECKE (wie im Player), geordnet innerhalb eines
 * Stopps über `reihe` — welches Bild zuerst kommt, ist eine Entscheidung des
 * Autors und keine Messung. Ohne `reihe` entscheidet die Aufnahmezeit.
 */
export function baueStopps(
  medien: readonly MediumAnzeige[],
  track: readonly TrackPunkt[],
  kum: readonly number[],
): Stopp[] {
  const mitOrt = medien
    .map((m) => ({ m, ort: ortVon(m, track, kum) }))
    .filter((x): x is { m: MediumAnzeige; ort: { meter: number; offsetS: number } } => x.ort !== null)
    .sort((a, b) => a.ort.meter - b.ort.meter)

  const gruppen: Array<{ items: MediumAnzeige[]; meter: number[]; offsets: number[] }> = []
  for (const x of mitOrt) {
    const letzte = gruppen[gruppen.length - 1]
    // Gemessen wird zum ANFANG des Halts, nicht zum Vorgänger — sonst könnte
    // eine Perlenkette knapp benachbarter Aufnahmen zu einem beliebig langen
    // Stopp verschmelzen. Genau so entscheidet es der Player (gruppiereStopps
    // in src/geo.js); ein Drift-Wächter vergleicht beide Wege.
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

/** `reihe` zuerst (0-basiert), danach die Aufnahmezeit. */
function sortiereItems(items: MediumAnzeige[]): MediumAnzeige[] {
  return [...items].sort((a, b) => {
    const ra = a.reihe ?? Number.POSITIVE_INFINITY
    const rb = b.reihe ?? Number.POSITIVE_INFINITY
    if (ra !== rb) return ra - rb
    return Date.parse(a.takenAt) - Date.parse(b.takenAt)
  })
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
    const ab = Math.abs(f.meter - zielMeter)
    if (ab < bestAb) {
      bestAb = ab
      best = f
    }
  }
  return best && bestAb <= schwelleM ? best : null
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
 * Platz als `reihe` 0..n−1. Ohne das Feld entschiede die Projektion auf die
 * Route über die Abfolge — für den Autor unkontrollierbar.
 */
export function reiheVergeben(edits: EditOverlay, ids: readonly string[]): EditOverlay {
  let naechste = edits
  ids.forEach((id, i) => {
    naechste = mitMedienEdit(naechste, id, { reihe: i })
  })
  return naechste
}
