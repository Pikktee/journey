// Geometrie-Werkzeuge der Anreicherungs-Pipeline: Distanzen, Track-Vereinfachung
// (Douglas-Peucker) und Tour-Statistik. Reine Funktionen — vollständig ohne I/O,
// daher direkt unit-testbar.
//
// Wichtig fürs Gesamtsystem: Der Player baut die Route selbst neu auf
// (Catmull-Rom + Resampling in src/geo.js des Web-Projekts). Die Vereinfachung
// hier dient nur der Payload-Größe; Streckenpositionen tauschen wir als
// Bruchteil f (0..1), nie als absolute Meter.

import type { UploadPunkt, UploadSegment } from '../schema/upload.js'

const ERDRADIUS_M = 6371000
const RAD = Math.PI / 180

/** Haversine-Distanz zweier [lng,lat]-Punkte in Metern. */
export function distanzM(a: readonly number[], b: readonly number[]): number {
  const [lng1 = 0, lat1 = 0] = a
  const [lng2 = 0, lat2 = 0] = b
  const dLat = (lat2 - lat1) * RAD
  const dLng = (lng2 - lng1) * RAD
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLng / 2) ** 2
  return 2 * ERDRADIUS_M * Math.asin(Math.sqrt(h))
}

// Für Douglas-Peucker reicht eine lokale Plattkarte (äquirektangular um die
// mittlere Breite) — auf Tour-Skalen (<100 km) ist der Fehler vernachlässigbar.
function projiziere(pts: readonly UploadPunkt[]): Array<[number, number]> {
  const latMittel = (pts.reduce((s, p) => s + p[1], 0) / pts.length) * RAD
  const kx = ERDRADIUS_M * RAD * Math.cos(latMittel)
  const ky = ERDRADIUS_M * RAD
  return pts.map((p) => [p[0] * kx, p[1] * ky])
}

function abstandZurStrecke(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const laenge2 = dx * dx + dy * dy
  if (laenge2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1])
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / laenge2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

/**
 * Douglas-Peucker auf einem Segment; behält Höhe und Zeit-Offset der
 * überlebenden Originalpunkte. Iterativ (Stack) statt rekursiv — lange
 * Aufzeichnungen sollen keinen Callstack sprengen.
 */
export function vereinfacheSegment(pts: readonly UploadPunkt[], toleranzM = 5): UploadPunkt[] {
  if (pts.length <= 2) return [...pts]
  const xy = projiziere(pts)
  const behalten = new Array<boolean>(pts.length).fill(false)
  behalten[0] = behalten[pts.length - 1] = true

  const stapel: Array<[number, number]> = [[0, pts.length - 1]]
  while (stapel.length) {
    const [von, bis] = stapel.pop() as [number, number]
    let maxAbstand = 0
    let index = -1
    for (let i = von + 1; i < bis; i++) {
      const a = abstandZurStrecke(xy[i] as [number, number], xy[von] as [number, number], xy[bis] as [number, number])
      if (a > maxAbstand) {
        maxAbstand = a
        index = i
      }
    }
    if (index >= 0 && maxAbstand > toleranzM) {
      behalten[index] = true
      stapel.push([von, index], [index, bis])
    }
  }
  return pts.filter((_, i) => behalten[i])
}

export interface TourStats {
  km: number
  gainM: number
}

// Anstiege zählen erst ab dieser Schwelle (m) — Standard-Hysterese gegen
// GPS-Höhenrauschen, das sonst selbst nach Glättung Phantom-Höhenmeter sammelt.
const GAIN_HYSTERESE_M = 5

/**
 * Gesamtdistanz + Höhenmeter über alle Segmente. Höhen werden geglättet UND
 * die Anstiege mit Hysterese aufsummiert: erst wenn es vom letzten Tal aus
 * mehr als GAIN_HYSTERESE_M bergauf ging, zählt der Anstieg. Lange Steigungen
 * verlieren dadurch nichts (sie kommen in >5-m-Schritten), Zickzack fällt raus.
 */
export function berechneStats(segments: readonly UploadSegment[]): TourStats {
  let meter = 0
  let gain = 0
  for (const seg of segments) {
    for (let i = 1; i < seg.pts.length; i++) {
      meter += distanzM(seg.pts[i - 1] as UploadPunkt, seg.pts[i] as UploadPunkt)
    }
    const geglaettet = glaette(seg.pts.map((p) => p[2]), 5)
    let tal = geglaettet[0] ?? 0
    for (const hoehe of geglaettet) {
      if (hoehe < tal) {
        tal = hoehe
      } else if (hoehe - tal >= GAIN_HYSTERESE_M) {
        gain += hoehe - tal
        tal = hoehe
      }
    }
  }
  return { km: Math.round(meter / 100) / 10, gainM: Math.round(gain) }
}

/** Gleitendes Mittel mit Fenster ±n. */
export function glaette(werte: readonly number[], n: number): number[] {
  return werte.map((_, i) => {
    let summe = 0
    let anzahl = 0
    for (let j = Math.max(0, i - n); j <= Math.min(werte.length - 1, i + n); j++) {
      summe += werte[j] ?? 0
      anzahl++
    }
    return summe / anzahl
  })
}
