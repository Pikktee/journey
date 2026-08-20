// Aufnahmen zu einer BESTEHENDEN Tour hinzufügen: die rechnenden Teile.
//
// Die Frage ist eine andere als beim Anlegen (pruefung.ts): Dort entsteht die
// Zeitachse erst aus dem Material, hier gibt es sie schon. Deshalb wird jede
// neue Datei GEGEN die vorhandene Tour eingeordnet — und die Oberfläche zeigt
// beides nebeneinander, damit man sieht, ob die Bilder die Lücken füllen oder
// daneben liegen (docs/mockups/studio-aufnahmen-nachreichen.html).
//
// DOM-frei und ohne fetch, damit es unter Vitest prüfbar bleibt.

import { distanzM } from './pruefung.js'

/** Was aus einer gewählten Datei gelesen wurde (EXIF, sonst Datei-Datum). */
export interface NeueAufnahme {
  file: string
  type: 'photo' | 'video'
  /** Aufnahmezeit in ms — aus EXIF, sonst der Dateizeit (dann `zeitGeraten`) */
  zeitMs: number
  zeitGeraten: boolean
  ort: [number, number] | null
  groesse: number
}

/**
 * Wo eine Aufnahme landet:
 * - `ort`  — sie trägt Koordinaten und sitzt sofort auf der Strecke.
 * - `zeit` — kein Ort, aber ihre Uhrzeit liegt in der Aufzeichnung: Die
 *            Zeit-Platzierung des Servers findet den Punkt.
 * - `ablage` — weder noch. Sie kommt ins Fach und bekommt dort von Hand
 *            einen Platz; wegzulassen ist die zweite brauchbare Antwort.
 */
export type Einordnung = 'ort' | 'zeit' | 'ablage'

export interface EingeordneteAufnahme extends NeueAufnahme {
  einordnung: Einordnung
}

/**
 * Wie weit ein GPS-Anker von der Strecke abliegen darf, um noch als „sitzt auf
 * der Strecke" zu gelten — DIESELBE Zahl wie `MAX_ABSTAND_M` in
 * [server/src/pipeline/placement.ts]. Der Dialog trifft hier eine Ansage über
 * das, was der Server gleich tun wird; wer sie großzügiger fasst, verspricht
 * eine Platzierung, die dann doch in der Ablage endet.
 */
export const MAX_ABSTAND_M = 500

/**
 * Die Tour, gegen die eingeordnet wird. `abstandZurStrecke` ist optional: Ohne
 * sie gilt ein Anker als gültig (so verhält es sich beim Anlegen, wo die
 * Strecke erst aus dem Material entsteht).
 */
export interface NachreichZiel {
  startMs: number
  endMs: number
  abstandZurStrecke?: (ort: readonly [number, number]) => number
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
 * (pruefung.ts): Dort entsteht die Zeitachse erst aus dem Material, ein Foto
 * kurz vor dem Start DEHNT sie also. Hier steht sie schon fest, und der Server
 * findet außerhalb von ihr keinen Trackpunkt — jede Toleranz wäre ein
 * Versprechen, das die Platzierung gleich darauf bricht.
 *
 * Eine GERATENE Zeit (Datei-Datum statt EXIF) allein reicht nicht für die
 * Ablage: Bei Dateien, die direkt von der Kamera kommen, ist sie meist richtig
 * — sie muss nur im Zeitfenster liegen.
 */
export function ordneEin(
  aufnahmen: readonly NeueAufnahme[],
  tour: NachreichZiel,
): EingeordneteAufnahme[] {
  return aufnahmen.map((a) => {
    if (a.ort && (!tour.abstandZurStrecke || tour.abstandZurStrecke(a.ort) <= MAX_ABSTAND_M)) {
      return { ...a, einordnung: 'ort' as const }
    }
    const drin = Number.isFinite(a.zeitMs) && a.zeitMs >= tour.startMs && a.zeitMs <= tour.endMs
    return { ...a, einordnung: drin ? ('zeit' as const) : ('ablage' as const) }
  })
}

export interface NachreichBefund {
  aufnahmen: EingeordneteAufnahme[]
  /** Anzahl je Einordnung — die Zusammenfassung über den Zeilen. */
  mitOrt: number
  nachZeit: number
  inAblage: number
  gesamtBytes: number
  /**
   * Zeitfenster des Streifens: Tour UND neue Aufnahmen. Ein Bild, das weit
   * daneben liegt, muss SICHTBAR daneben liegen — ein auf die Tour
   * beschnittener Streifen verstiege sich darauf, alles passe schon.
   */
  vonMs: number
  bisMs: number
}

export function fasseZusammen(
  aufnahmen: readonly NeueAufnahme[],
  tour: NachreichZiel,
): NachreichBefund {
  const eingeordnet = ordneEin(aufnahmen, tour).sort((a, b) => a.zeitMs - b.zeitMs)
  const zeiten = eingeordnet.map((a) => a.zeitMs).filter((t) => Number.isFinite(t))
  return {
    aufnahmen: eingeordnet,
    mitOrt: eingeordnet.filter((a) => a.einordnung === 'ort').length,
    nachZeit: eingeordnet.filter((a) => a.einordnung === 'zeit').length,
    inAblage: eingeordnet.filter((a) => a.einordnung === 'ablage').length,
    gesamtBytes: eingeordnet.reduce((summe, a) => summe + a.groesse, 0),
    vonMs: Math.min(tour.startMs, ...(zeiten.length ? zeiten : [tour.startMs])),
    bisMs: Math.max(tour.endMs, ...(zeiten.length ? zeiten : [tour.endMs])),
  }
}

/**
 * Die Sätze über den Zeilen — je Gruppe einer, und nur für Gruppen, die es
 * gibt. Eine Zeile „0 Aufnahmen ohne Ortsangabe" wäre eine Auskunft über
 * nichts.
 */
export function befundSaetze(befund: NachreichBefund): string[] {
  const saetze: string[] = []
  if (befund.mitOrt) {
    saetze.push(
      befund.mitOrt === 1
        ? 'Eine Aufnahme mit Ortsangabe — sie sitzt sofort auf der Strecke.'
        : `${befund.mitOrt} Aufnahmen mit Ortsangabe — sie sitzen sofort auf der Strecke.`,
    )
  }
  if (befund.nachZeit) {
    saetze.push(
      befund.nachZeit === 1
        ? 'Eine Aufnahme ohne Ortsangabe — eingeordnet nach ihrer Uhrzeit.'
        : `${befund.nachZeit} Aufnahmen ohne Ortsangabe — eingeordnet nach ihrer Uhrzeit.`,
    )
  }
  if (befund.inAblage) {
    saetze.push(
      befund.inAblage === 1
        ? 'Eine Aufnahme ohne Zeit und Ort — sie geht in die Ablage und bekommt dort von Hand einen Platz.'
        : `${befund.inAblage} Aufnahmen ohne Zeit und Ort — sie gehen in die Ablage und bekommen dort von Hand einen Platz.`,
    )
  }
  return saetze
}

/** Kurzform der Einordnung für die Zeile (das, was in der Spalte steht). */
export function einordnungWort(einordnung: Einordnung): string {
  return einordnung === 'ort' ? 'Ort' : einordnung === 'zeit' ? 'nach Uhrzeit' : 'in die Ablage'
}

/** Position auf dem Streifen (0–1); außerhalb wird geklemmt, nie verworfen. */
export function streifenAnteil(ms: number, vonMs: number, bisMs: number): number {
  if (!(bisMs > vonMs) || !Number.isFinite(ms)) return 0
  return Math.min(1, Math.max(0, (ms - vonMs) / (bisMs - vonMs)))
}

/**
 * Aus den Trackpunkten einer Tour die Abstandsfunktion für `ordneEin` bauen
 * (kleinster Abstand zu irgendeinem Punkt — wie `abstandZumTrack` im Server).
 * Der Editor-Track ist serverseitig auf 5 m vereinfacht; bei 500 m Schwelle
 * fällt das nicht ins Gewicht.
 */
export function abstandsFunktion(
  punkte: ReadonlyArray<readonly number[]>,
): ((ort: readonly [number, number]) => number) | undefined {
  if (punkte.length < 2) return undefined
  return (ort) => {
    let best = Infinity
    for (const p of punkte) {
      const d = distanzM(ort, p)
      if (d < best) best = d
    }
    return best
  }
}

/** „46,2 MB" — Größen im Dialog, deutsche Schreibweise mit Komma. */
export function megabyte(bytes: number): string {
  return `${(bytes / 1048576).toFixed(1).replace('.', ',')} MB`
}
