// Aufnahmen zu einer BESTEHENDEN Tour hinzufügen: die rechnenden Teile.
//
// Die Frage ist eine andere als beim Anlegen (import-validation.ts): Dort entsteht die
// Zeitachse erst aus dem Material, hier gibt es sie schon. Deshalb wird jede
// neue Datei GEGEN die vorhandene Tour eingeordnet — und die Oberfläche zeigt
// beides nebeneinander, damit man sieht, ob die Bilder die Lücken füllen oder
// daneben liegen (docs/mockups/studio-aufnahmen-nachreichen.html).
//
// DOM-frei und ohne fetch, damit es unter Vitest prüfbar bleibt.

import { distanceM } from './import-validation.js'

/** Was aus einer gewählten Datei gelesen wurde (EXIF, sonst Datei-Datum). */
export interface NewMedium {
  file: string
  type: 'photo' | 'video'
  /** Aufnahmezeit in ms — aus EXIF, sonst der Dateizeit (dann `timeGuessed`) */
  timeMs: number
  timeGuessed: boolean
  location: [number, number] | null
  size: number
}

/**
 * Wo eine Aufnahme landet:
 * - `ort`  — sie trägt Koordinaten und sitzt sofort auf der Strecke.
 * - `zeit` — kein Ort, aber ihre Uhrzeit liegt in der Aufzeichnung: Die
 *            Zeit-Platzierung des Servers findet den Punkt.
 * - `ablage` — weder noch. Sie kommt ins Fach und bekommt dort von Hand
 *            einen Platz; wegzulassen ist die zweite brauchbare Antwort.
 */
export type Classification = 'ort' | 'zeit' | 'ablage'

export interface ClassifiedMedium extends NewMedium {
  classification: Classification
}

/**
 * Wie weit ein GPS-Anker von der Strecke abliegen darf, um noch als „sitzt auf
 * der Strecke" zu gelten — DIESELBE Zahl wie `MAX_DISTANCE_M` in
 * [server/src/pipeline/placement.ts]. Der Dialog trifft hier eine Ansage über
 * das, was der Server gleich tun wird; wer sie großzügiger fasst, verspricht
 * eine Platzierung, die dann doch in der Ablage endet.
 */
export const MAX_DISTANCE_M = 500

/**
 * Die Tour, gegen die eingeordnet wird. `distanceToRoute` ist optional: Ohne
 * sie gilt ein Anker als gültig (so verhält es sich beim Anlegen, wo die
 * Strecke erst aus dem Material entsteht).
 */
export interface AddMediaTarget {
  startMs: number
  endMs: number
  distanceToRoute?: (location: readonly [number, number]) => number
}

/**
 * Jede neue Aufnahme gegen die bestehende Tour einordnen — in genau der
 * Reihenfolge, in der `bestimmePlatzierung` (server/src/pipeline/placement.ts)
 * sie später entscheidet:
 *
 * 1. GPS-Anker NAHE GENUG an der Strecke → sitzt sofort.
 * 2. sonst Aufnahmezeit INNERHALB der Aufzeichnung → Zeit-Platzierung.
 * 3. sonst Ablage.
 *
 * **Ohne Toleranz um die Zeitspanne herum**, anders als beim Anlegen
 * (import-validation.ts): Dort entsteht die Zeitachse erst aus dem Material, ein Foto
 * kurz vor dem Start DEHNT sie also. Hier steht sie schon fest, und der Server
 * findet außerhalb von ihr keinen Trackpunkt — jede Toleranz wäre ein
 * Versprechen, das die Platzierung gleich darauf bricht.
 *
 * Eine GERATENE Zeit (Datei-Datum statt EXIF) allein reicht nicht für die
 * Ablage: Bei Dateien, die direkt von der Kamera kommen, ist sie meist richtig
 * — sie muss nur im Zeitfenster liegen.
 */
export function classify(media: readonly NewMedium[], tour: AddMediaTarget): ClassifiedMedium[] {
  return media.map((a) => {
    if (
      a.location &&
      (!tour.distanceToRoute || tour.distanceToRoute(a.location) <= MAX_DISTANCE_M)
    ) {
      return { ...a, classification: 'ort' as const }
    }
    const inside = Number.isFinite(a.timeMs) && a.timeMs >= tour.startMs && a.timeMs <= tour.endMs
    return { ...a, classification: inside ? ('zeit' as const) : ('ablage' as const) }
  })
}

export interface AddMediaReport {
  media: ClassifiedMedium[]
  /** Anzahl je Einordnung — die Zusammenfassung über den Zeilen. */
  withLocation: number
  afterTime: number
  inTray: number
  totalBytes: number
  /**
   * Zeitfenster des Streifens: Tour UND neue Aufnahmen. Ein Bild, das weit
   * daneben liegt, muss SICHTBAR daneben liegen — ein auf die Tour
   * beschnittener Streifen verstiege sich darauf, alles passe schon.
   */
  fromMs: number
  toMs: number
}

export function summarize(media: readonly NewMedium[], tour: AddMediaTarget): AddMediaReport {
  const classified = classify(media, tour).sort((a, b) => a.timeMs - b.timeMs)
  const zeiten = classified.map((a) => a.timeMs).filter((t) => Number.isFinite(t))
  return {
    media: classified,
    withLocation: classified.filter((a) => a.classification === 'ort').length,
    afterTime: classified.filter((a) => a.classification === 'zeit').length,
    inTray: classified.filter((a) => a.classification === 'ablage').length,
    totalBytes: classified.reduce((sum, a) => sum + a.size, 0),
    fromMs: Math.min(tour.startMs, ...(zeiten.length ? zeiten : [tour.startMs])),
    toMs: Math.max(tour.endMs, ...(zeiten.length ? zeiten : [tour.endMs])),
  }
}

/**
 * Die Sätze über den Zeilen — je Gruppe einer, und nur für Gruppen, die es
 * gibt. Eine Zeile „0 Aufnahmen ohne Ortsangabe" wäre eine Auskunft über
 * nichts.
 */
export function reportSentences(report: AddMediaReport): string[] {
  const sentences: string[] = []
  if (report.withLocation) {
    sentences.push(
      report.withLocation === 1
        ? 'Eine Aufnahme mit Ortsangabe — sie sitzt sofort auf der Strecke.'
        : `${report.withLocation} Aufnahmen mit Ortsangabe — sie sitzen sofort auf der Strecke.`,
    )
  }
  if (report.afterTime) {
    sentences.push(
      report.afterTime === 1
        ? 'Eine Aufnahme ohne Ortsangabe — eingeordnet nach ihrer Uhrzeit.'
        : `${report.afterTime} Aufnahmen ohne Ortsangabe — eingeordnet nach ihrer Uhrzeit.`,
    )
  }
  if (report.inTray) {
    sentences.push(
      report.inTray === 1
        ? 'Eine Aufnahme ohne Zeit und Ort — sie geht in die Ablage und bekommt dort von Hand einen Platz.'
        : `${report.inTray} Aufnahmen ohne Zeit und Ort — sie gehen in die Ablage und bekommen dort von Hand einen Platz.`,
    )
  }
  return sentences
}

/** Kurzform der Einordnung für die Zeile (das, was in der Spalte steht). */
export function classificationWord(classification: Classification): string {
  return classification === 'ort'
    ? 'Ort'
    : classification === 'zeit'
      ? 'nach Uhrzeit'
      : 'in die Ablage'
}

/** Position auf dem Streifen (0–1); außerhalb wird geklemmt, nie verworfen. */
export function stripFraction(ms: number, fromMs: number, toMs: number): number {
  if (!(toMs > fromMs) || !Number.isFinite(ms)) return 0
  return Math.min(1, Math.max(0, (ms - fromMs) / (toMs - fromMs)))
}

/**
 * Aus den Trackpunkten einer Tour die Abstandsfunktion für `classify` bauen
 * (kleinster Abstand zu irgendeinem Punkt — wie `abstandZumTrack` im Server).
 * Der Editor-Track ist serverseitig auf 5 m vereinfacht; bei 500 m Schwelle
 * fällt das nicht ins Gewicht.
 */
export function distanceFunction(
  points: ReadonlyArray<readonly number[]>,
): ((location: readonly [number, number]) => number) | undefined {
  if (points.length < 2) return undefined
  return (location) => {
    let best = Infinity
    for (const p of points) {
      const d = distanceM(location, p)
      if (d < best) best = d
    }
    return best
  }
}

/** „46,2 MB" — Größen im Dialog, deutsche Schreibweise mit Komma. */
export function megabyte(bytes: number): string {
  return `${(bytes / 1048576).toFixed(1).replace('.', ',')} MB`
}
