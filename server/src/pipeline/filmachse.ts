// Die Film-Achse der Pipeline: Aufnahmezeit ↔ Filmsekunde ↔ Streckenanteil.
//
// Warum der Server das braucht: Ein Ton-Klip hängt seit Etappe 4 an einem ANKER
// in Aufnahmezeit plus einem VERSATZ in Filmsekunden (docs §2E). Der Versatz
// darf mitten in einer Standzeit liegen — dort steht die Aufnahmeuhr still,
// während der Film weiterläuft. Ohne eine Achse, die die Halte kennt, wäre
// „3 Sekunden nach dem Anker" beim Rendern nicht auffindbar.
//
// Das hier ist der SERVER-Spiegel von `baueAchse` in src/studio/zeitleiste.ts.
// Beide müssen dasselbe rechnen, sonst startet ein Klip im fertigen Film woanders
// als im Editor gezeigt — genau die Sorte Drift, an der schon die
// Gehabschnitts-Erkennung einmal hing. Deshalb: dieselbe Gruppierung (120
// Streckenmeter, src/geo.ts), dieselben Halt-Dauern (`aufnahmeHaltS` +
// Ausblendung) und dieselbe Interpolations-Konvention (Plateau → Ankunft).

import type { MomentArt } from '../schema/edits.js'
import { HALT_AUSBLEND_S, NAHE_M, aufnahmeHaltS, momentHaltS, tempoMs } from './filmtempo.js'
import type { Zeitreihe } from './zeit.js'

/** Ein Halt auf der Achse: wann er beginnt (Aufnahmezeit) und was er im Film kostet. */
export interface AchsenHalt {
  offsetS: number
  breiteS: number
}

/**
 * Stückweise lineare Abbildung Aufnahmezeit ↔ Filmzeit.
 *
 * `tS` ist nicht streng monoton: Jeder Halt liegt als PAAR gleicher Zeiten
 * darin (Ankunft und Abfahrt) — das Plateau, in dem der Film läuft und die Uhr
 * steht. Genau dafür ist die Achse da.
 */
export interface FilmAchse {
  tS: number[]
  filmS: number[]
  gesamtS: number
}

/** Meter zwischen zwei Punkten (lokale Plattkarte — auf Segmentlänge genau genug). */
function meterZwischen(a: { lng: number; lat: number }, b: { lng: number; lat: number }): number {
  const kx = 111_320 * Math.cos((a.lat * Math.PI) / 180)
  const dx = (b.lng - a.lng) * kx
  const dy = (b.lat - a.lat) * 110_540
  return Math.sqrt(dx * dx + dy * dy)
}

/**
 * Lineare Interpolation mit lower_bound-Konvention.
 *
 * Bei doppelten Stützstellen (Halt) liefert sie den LINKEN Wert — die Ankunft.
 * Dieselbe Konvention wie `interpoliere` in src/studio/zeitleiste.ts; eine
 * andere Wahl verschöbe jeden Anker, der genau auf einer Halt-Zeit sitzt, um
 * die ganze Standzeit.
 */
function interpoliere(xs: readonly number[], ys: readonly number[], x: number): number {
  const n = xs.length
  if (n === 0) return 0
  if (x <= (xs[0] as number)) return ys[0] as number
  if (x >= (xs[n - 1] as number)) return ys[n - 1] as number
  let lo = 0
  let hi = n - 1
  while (lo < hi) {
    const mitte = (lo + hi) >> 1
    if ((xs[mitte] as number) < x) lo = mitte + 1
    else hi = mitte
  }
  const a = xs[lo - 1] as number
  const b = xs[lo] as number
  const spanne = b - a
  const u = spanne > 0 ? (x - a) / spanne : 1
  return (ys[lo - 1] as number) + u * ((ys[lo] as number) - (ys[lo - 1] as number))
}

/**
 * Halte als Sprünge einweben: an der Halt-Zeit zwei Stützstellen (Film vor und
 * nach der Standzeit), alle späteren Werte heben sich um die Breite. Aufsteigend
 * gewebt, damit `filmAmHalt` die früheren Halte schon trägt.
 */
function webeHalte(tS: number[], filmS: number[], halte: readonly AchsenHalt[]): void {
  for (const h of [...halte].sort((a, b) => a.offsetS - b.offsetS)) {
    if (!(h.breiteS > 0)) continue
    const filmAmHalt = interpoliere(tS, filmS, h.offsetS)
    let i = tS.length
    while (i > 0 && (tS[i - 1] as number) > h.offsetS) i--
    for (let j = i; j < tS.length; j++) filmS[j] = (filmS[j] as number) + h.breiteS
    tS.splice(i, 0, h.offsetS, h.offsetS)
    filmS.splice(i, 0, filmAmHalt, filmAmHalt + h.breiteS)
  }
}

/**
 * Film-Achse aus der (bereits getrimmten) Zeitreihe und den Halten.
 *
 * Fahrzeit kommt aus Strecke ÷ modusabhängigem Tempo — dieselbe Rechnung, mit
 * der die Engine fährt (filmtempo.ts). `null`, wenn zu wenig Material für eine
 * Abbildung da ist; der Aufrufer fällt dann auf die alte Aufnahmezeit-
 * Verankerung zurück, statt zu raten.
 */
export function baueFilmAchse(reihe: Zeitreihe, halte: readonly AchsenHalt[]): FilmAchse | null {
  const tS: number[] = []
  const filmS: number[] = []
  let film = 0
  const punkte = reihe.punkte
  for (let i = 0; i < punkte.length; i++) {
    const p = punkte[i]
    if (!p) continue
    if (i > 0) {
      const vor = punkte[i - 1]
      // Das Tempo des Punktes, VON dem gefahren wird — Grenzen wirken ab ihrem
      // Punkt, exakt wie in der Studio-Achse.
      if (vor) film += meterZwischen(vor, p) / tempoMs(vor.mode)
    }
    const letzter = tS.length - 1
    if (letzter >= 0 && tS[letzter] === p.tSek && filmS[letzter] === film) continue
    tS.push(p.tSek)
    filmS.push(film)
  }
  if (tS.length < 2) return null
  webeHalte(tS, filmS, halte)
  const gesamtS = filmS[filmS.length - 1] as number
  if (!(gesamtS > 0)) return null
  return { tS, filmS, gesamtS }
}

/** Filmsekunde zu einer Aufnahmezeit (Plateau → Ankunft). */
export function filmBeiZeit(achse: FilmAchse, tSek: number): number {
  return interpoliere(achse.tS, achse.filmS, tSek)
}

/** Aufnahmezeit zu einer Filmsekunde (Umkehrung; im Halt → dessen Zeit). */
export function zeitBeiFilm(achse: FilmAchse, filmS: number): number {
  return interpoliere(achse.filmS, achse.tS, filmS)
}

/**
 * Anker [lng,lat] auf die Zeitreihe projizieren: Streckenmeter und Zeit-Offset.
 *
 * Gemessen wird auf die STRECKE zwischen zwei Stützpunkten, nicht auf den
 * nächsten Stützpunkt — auf einem grob abgetasteten Track (Alpen-Serpentinen,
 * 30-s-Raster) liegen die Punkte weit auseinander, und ein Halt spränge sonst
 * um mehrere Sekunden. Spiegel von `projiziereAufTrack` (editmodell.ts).
 */
export function projiziereAufReihe(reihe: Zeitreihe, lng: number, lat: number): { meter: number; offsetS: number } {
  const punkte = reihe.punkte
  const erster = punkte[0]
  if (!erster) return { meter: 0, offsetS: 0 }
  const kx = 111_320 * Math.cos((erster.lat * Math.PI) / 180)
  let besteD2 = Infinity
  let meter = erster.dist
  let offsetS = erster.tSek
  for (let i = 1; i < punkte.length; i++) {
    const a = punkte[i - 1]
    const b = punkte[i]
    if (!a || !b) continue
    const ax = a.lng * kx
    const ay = a.lat * 110_540
    const bx = b.lng * kx
    const by = b.lat * 110_540
    const px = lng * kx
    const py = lat * 110_540
    const dx = bx - ax
    const dy = by - ay
    const laenge2 = dx * dx + dy * dy
    const u = laenge2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / laenge2)) : 0
    const fx = ax + u * dx
    const fy = ay + u * dy
    const d2 = (px - fx) * (px - fx) + (py - fy) * (py - fy)
    if (d2 < besteD2) {
      besteD2 = d2
      meter = a.dist + u * (b.dist - a.dist)
      offsetS = a.tSek + u * (b.tSek - a.tSek)
    }
  }
  return { meter, offsetS }
}

/**
 * Aufnahmen zu Halten gruppieren — Spiegel von `baueStopps`
 * (src/studio/stopps.ts) und `gruppiereStopps` (src/geo.ts).
 *
 * Gemessen wird zum ANFANG des Halts, nicht zum Vorgänger: sonst könnte eine
 * Perlenkette knapp benachbarter Aufnahmen zu einem beliebig langen Stopp
 * verschmelzen. Die Breite ist die Summe der Standzeiten samt Ausblendung —
 * ein Halt mit drei Fotos ist im Film eine Folge von dreien.
 */
export function baueAchsenHalte(
  medien: ReadonlyArray<{
    type: 'photo' | 'video'
    /** Streckenmeter des Ankers (unplatzierte Medien gehören nicht in die Liste) */
    meter: number
    /** Sekunden ab time.start */
    offsetS: number
    dauerS?: number
    display?: { holdS?: number }
  }>,
  naheM = NAHE_M,
): AchsenHalt[] {
  const sortiert = [...medien].sort((a, b) => a.meter - b.meter)
  const gruppen: Array<{ anfangM: number; offsets: number[]; breiteS: number }> = []
  for (const m of sortiert) {
    const letzte = gruppen[gruppen.length - 1]
    const dauer = aufnahmeHaltS(m) + HALT_AUSBLEND_S
    if (letzte && m.meter - letzte.anfangM < naheM) {
      letzte.offsets.push(m.offsetS)
      letzte.breiteS += dauer
    } else {
      gruppen.push({ anfangM: m.meter, offsets: [m.offsetS], breiteS: dauer })
    }
  }
  return gruppen.map((g) => ({
    offsetS: g.offsets.reduce((s, v) => s + v, 0) / g.offsets.length,
    breiteS: g.breiteS,
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
export function baueMomentHalte(
  momente: ReadonlyArray<{
    /** Sekunden ab time.start */
    offsetS: number
    art: MomentArt
    dauerS?: number | undefined
  }>,
): AchsenHalt[] {
  return momente.map((m) => ({ offsetS: m.offsetS, breiteS: momentHaltS(m) }))
}
