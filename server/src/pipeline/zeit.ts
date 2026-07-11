// Zeit-Werkzeuge der Anreicherungs-Pipeline: verkettet die Segmente zu einer
// Zeitreihe (Position + kumulierte Distanz + Zeit-Offset je Punkt) und
// destilliert daraus die `timeline`-Stützstellen f→Pseudo-Zeit fürs Tour-JSON.
//
// Kern-Designentscheid (Plan M2): Pausen > 15 min werden auf 2 min komprimiert.
// Eine Mittagspause hat keine Streckenausdehnung — beim Abspielen würde die
// Pseudo-Uhr (und damit die Sonne) an dieser Stelle sonst um Stunden springen.
// Preis der Kompression: nach jeder Pause läuft die Pseudo-Uhr der echten Zeit
// hinterher; das ist gewollt (weiche Sonne schlägt exakte Uhrzeit).

import type { UploadSegment } from '../schema/upload.js'
import { distanzM } from './geo.js'

/** Punkt der verketteten Zeitreihe. */
export interface ZeitPunkt {
  lng: number
  lat: number
  /** kumulierte Distanz ab Tour-Start (m), inkl. Sprünge zwischen Segmenten */
  dist: number
  /** Sekunden ab time.start — monoton nicht-fallend erzwungen */
  tSek: number
}

export interface Zeitreihe {
  punkte: ZeitPunkt[]
  gesamtM: number
  dauerS: number
}

/** Pause: Indexbereich in der Zeitreihe, in dem Zeit ohne Ortswechsel verging. */
export interface Pause {
  vonIdx: number
  bisIdx: number
  dauerS: number
}

/** Pausen ab dieser Dauer werden komprimiert … */
export const PAUSE_MIN_S = 15 * 60
/** … auf diese Ersatzdauer. */
export const PAUSE_ERSATZ_S = 120
// Aufenthaltsradius: GPS rauscht im Stand (Accuracy-Filter der App lässt bis
// 30 m durch) und eine „Pause" darf ein kurzer Gang zum Kiosk sein.
const PAUSE_RADIUS_M = 150
// Zielgenauigkeit des Destillats: max. Abweichung der stückweise linearen
// Pseudo-Zeit von der komprimierten Wahrheit (die Sonne wandert ~1° je 4 min).
const DESTILLAT_TOLERANZ_S = 45
const DESTILLAT_MAX_PUNKTE = 300

/** Segmente zu einer Zeitreihe verketten; Zeit-Offsets werden monoton geklemmt. */
export function baueZeitreihe(segments: readonly UploadSegment[]): Zeitreihe {
  const punkte: ZeitPunkt[] = []
  let dist = 0
  let tSek = 0
  for (const seg of segments) {
    for (const p of seg.pts) {
      const [lng = 0, lat = 0, , t = 0] = p
      const vorher = punkte[punkte.length - 1]
      if (vorher) dist += distanzM([vorher.lng, vorher.lat], [lng, lat])
      tSek = Math.max(tSek, t)
      punkte.push({ lng, lat, dist, tSek })
    }
  }
  const erster = punkte[0]
  const letzter = punkte[punkte.length - 1]
  return { punkte, gesamtM: dist, dauerS: erster && letzter ? letzter.tSek - erster.tSek : 0 }
}

/**
 * Pausen finden: maximale Bereiche, in denen alle Punkte im Aufenthaltsradius
 * um den Bereichs-Anfang bleiben und dabei ≥ PAUSE_MIN_S vergehen. Das fängt
 * beide Erscheinungsformen — die Punktwolke im Stand (App speichert alle 30 s
 * weiter) wie die einzelne Aufzeichnungslücke am selben Ort.
 */
export function findePausen(reihe: Zeitreihe): Pause[] {
  const { punkte } = reihe
  // Fürs Suchen reicht ein ≥10-s-Zeitraster — das deckelt die Fensterbreite
  // (und damit die Distanzrechnungen) auch bei sekündlich dichten GPX-Quellen.
  const raster: number[] = []
  let letztT = -Infinity
  for (let i = 0; i < punkte.length; i++) {
    const p = punkte[i] as ZeitPunkt
    if (p.tSek - letztT >= 10 || i === punkte.length - 1) {
      raster.push(i)
      letztT = p.tSek
    }
  }

  const pausen: Pause[] = []
  let a = 0
  while (a < raster.length - 1) {
    const anker = punkte[raster[a] as number] as ZeitPunkt
    let b = a
    while (b + 1 < raster.length) {
      const kandidat = punkte[raster[b + 1] as number] as ZeitPunkt
      if (distanzM([anker.lng, anker.lat], [kandidat.lng, kandidat.lat]) > PAUSE_RADIUS_M) break
      b++
    }
    const ende = punkte[raster[b] as number] as ZeitPunkt
    if (b > a && ende.tSek - anker.tSek >= PAUSE_MIN_S) {
      pausen.push({ vonIdx: raster[a] as number, bisIdx: raster[b] as number, dauerS: ende.tSek - anker.tSek })
      a = b
    } else {
      a++
    }
  }
  return pausen
}

/** Zeit-Offsets mit komprimierten Pausen: je Punkt der Pseudo-Zeit-Offset (s). */
export function komprimiereZeiten(reihe: Zeitreihe, pausen: readonly Pause[]): number[] {
  const { punkte } = reihe
  if (!punkte.length) return []
  const out = new Array<number>(punkte.length)
  out[0] = (punkte[0] as ZeitPunkt).tSek
  let pauseIdx = 0
  for (let i = 1; i < punkte.length; i++) {
    let dt = (punkte[i] as ZeitPunkt).tSek - (punkte[i - 1] as ZeitPunkt).tSek
    while (pauseIdx < pausen.length && (pausen[pauseIdx] as Pause).bisIdx <= i - 1) pauseIdx++
    const pause = pausen[pauseIdx]
    if (pause && i - 1 >= pause.vonIdx && i <= pause.bisIdx && pause.dauerS > 0) {
      dt *= PAUSE_ERSATZ_S / pause.dauerS
    }
    out[i] = (out[i - 1] as number) + dt
  }
  return out
}

/**
 * Timeline-Destillat: wenige Stützstellen [{f, t}] (stückweise linear), die die
 * komprimierte Zeitkurve bis auf DESTILLAT_TOLERANZ_S treffen. `undefined` bei
 * degenerierten Touren (keine Strecke / keine Zeitspanne / kaputter Start) —
 * der Player fällt dann auf die lineare Pseudo-Zeit zurück.
 */
export function destilliereTimeline(
  reihe: Zeitreihe,
  startIso: string,
): Array<{ f: number; t: string }> | undefined {
  const startMs = Date.parse(startIso)
  if (!Number.isFinite(startMs)) return undefined
  if (reihe.punkte.length < 2 || reihe.gesamtM < 10 || reihe.dauerS <= 0) return undefined

  const tKomp = komprimiereZeiten(reihe, findePausen(reihe))
  const f = reihe.punkte.map((p) => p.dist / reihe.gesamtM)

  let toleranz = DESTILLAT_TOLERANZ_S
  let behalten = destilliere(f, tKomp, toleranz)
  while (behalten.length > DESTILLAT_MAX_PUNKTE) {
    toleranz *= 2
    behalten = destilliere(f, tKomp, toleranz)
  }

  const iso = (sek: number): string => `${new Date(startMs + sek * 1000).toISOString().split('.')[0]}Z`
  const timeline: Array<{ f: number; t: string }> = []
  for (const i of behalten) {
    const eintrag = { f: Math.round((f[i] as number) * 1e4) / 1e4, t: iso(tKomp[i] as number) }
    const vorher = timeline[timeline.length - 1]
    if (vorher && vorher.f === eintrag.f && vorher.t === eintrag.t) continue
    timeline.push(eintrag)
  }
  return timeline.length >= 2 ? timeline : undefined
}

// Douglas-Peucker über der (monotonen) Kurve f→t mit vertikaler Zeit-Abweichung
// als Maß. Iterativ (Stack) wie vereinfacheSegment — lange Aufzeichnungen
// sollen keinen Callstack sprengen. Liefert sortierte Index-Liste.
function destilliere(f: readonly number[], t: readonly number[], toleranzS: number): number[] {
  const n = f.length
  const behalten = new Array<boolean>(n).fill(false)
  behalten[0] = behalten[n - 1] = true
  const stapel: Array<[number, number]> = [[0, n - 1]]
  while (stapel.length) {
    const [von, bis] = stapel.pop() as [number, number]
    const fVon = f[von] as number
    const fBis = f[bis] as number
    const tVon = t[von] as number
    const tBis = t[bis] as number
    const spanne = fBis - fVon
    let maxAbstand = 0
    let index = -1
    for (let i = von + 1; i < bis; i++) {
      // Senkrechter f-Sprung (Pause): jede Zeitabweichung zählt gegen den Anfang
      const erwartet = spanne <= 0 ? tVon : tVon + (((f[i] as number) - fVon) / spanne) * (tBis - tVon)
      const abstand = Math.abs((t[i] as number) - erwartet)
      if (abstand > maxAbstand) {
        maxAbstand = abstand
        index = i
      }
    }
    if (index >= 0 && maxAbstand > toleranzS) {
      behalten[index] = true
      stapel.push([von, index], [index, bis])
    }
  }
  const indizes: number[] = []
  for (let i = 0; i < n; i++) if (behalten[i]) indizes.push(i)
  return indizes
}

/**
 * Position (und Streckenanteil) zur Tour-Zeit `tSek` — linear zwischen den
 * umgebenden Punkten interpoliert, außerhalb geklemmt. Grundlage der
 * Raum-Zeit-Samples des Auto-Wetters („wo war die Tour um 14 Uhr?").
 */
export function positionZurZeit(reihe: Zeitreihe, tSek: number): { lng: number; lat: number; f: number } {
  const { punkte, gesamtM } = reihe
  const erster = punkte[0] as ZeitPunkt
  const letzter = punkte[punkte.length - 1] as ZeitPunkt
  const anteil = (p: ZeitPunkt): number => (gesamtM > 0 ? p.dist / gesamtM : 0)
  if (tSek <= erster.tSek) return { lng: erster.lng, lat: erster.lat, f: anteil(erster) }
  if (tSek >= letzter.tSek) return { lng: letzter.lng, lat: letzter.lat, f: anteil(letzter) }

  // Binärsuche: erster Punkt mit tSek >= gesucht (tSek ist monoton)
  let lo = 0
  let hi = punkte.length - 1
  while (lo < hi) {
    const mitte = (lo + hi) >> 1
    if ((punkte[mitte] as ZeitPunkt).tSek < tSek) lo = mitte + 1
    else hi = mitte
  }
  const b = punkte[lo] as ZeitPunkt
  const a = punkte[lo - 1] as ZeitPunkt
  const spanne = b.tSek - a.tSek
  const u = spanne > 0 ? (tSek - a.tSek) / spanne : 1
  return {
    lng: a.lng + u * (b.lng - a.lng),
    lat: a.lat + u * (b.lat - a.lat),
    f: anteil(a) + u * (anteil(b) - anteil(a)),
  }
}
