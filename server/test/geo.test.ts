import { describe, expect, it } from 'vitest'
import {
  berechneStats,
  distanzM,
  glaette,
  vereinfacheIndizes,
  vereinfacheSegment,
} from '../src/pipeline/geo.js'
import type { UploadPunkt } from '../src/schema/upload.js'

describe('distanzM', () => {
  it('liefert bekannte Distanzen (±1 %)', () => {
    // Lauterbrunnen → Grindelwald Luftlinie ≈ 10,3 km
    const d = distanzM([7.9086, 46.5934], [8.0341, 46.6244])
    expect(d).toBeGreaterThan(9500)
    expect(d).toBeLessThan(10800)
  })

  it('ist 0 für identische Punkte', () => {
    expect(distanzM([8, 46], [8, 46])).toBe(0)
  })
})

describe('vereinfacheSegment', () => {
  it('entfernt kollineare Zwischenpunkte', () => {
    // 11 Punkte auf einer geraden Linie → nur Start und Ende überleben
    const pts: UploadPunkt[] = Array.from({ length: 11 }, (_, i) => [
      8 + i * 0.001,
      46,
      500,
      i * 10,
    ])
    const ergebnis = vereinfacheSegment(pts, 5)
    expect(ergebnis).toHaveLength(2)
    expect(ergebnis[0]).toEqual(pts[0])
    expect(ergebnis[1]).toEqual(pts[10])
  })

  it('behält markante Ecken samt Höhe und Zeit-Offset', () => {
    const ecke: UploadPunkt = [8.005, 46.005, 777, 300]
    const pts: UploadPunkt[] = [
      [8, 46, 500, 0],
      [8.0025, 46.0025, 600, 150],
      ecke, // deutlicher Knick
      [8.0025, 46.0075, 800, 450],
      [8, 46.01, 900, 600],
    ]
    const ergebnis = vereinfacheSegment(pts, 5)
    expect(ergebnis).toContainEqual(ecke)
  })

  it('lässt Segmente mit ≤ 2 Punkten unangetastet', () => {
    const pts: UploadPunkt[] = [
      [8, 46, 0, 0],
      [8.001, 46.001, 10, 60],
    ]
    expect(vereinfacheSegment(pts)).toEqual(pts)
  })
})

describe('vereinfacheIndizes', () => {
  // Die Indizes sind die Brücke zum `f` je Wegpunkt (E11): enrich.ts findet
  // darüber jeden überlebenden Punkt in der rohen Zeitreihe wieder. Läuft das
  // auseinander, trägt jeder Wegpunkt das `f` eines anderen.
  it('liefert dieselbe Auswahl wie vereinfacheSegment', () => {
    const pts: UploadPunkt[] = [
      [8, 46, 500, 0],
      [8.0025, 46.0025, 600, 150],
      [8.005, 46.005, 777, 300], // deutlicher Knick
      [8.0025, 46.0075, 800, 450],
      [8, 46.01, 900, 600],
    ]
    const indizes = vereinfacheIndizes(pts, 5)
    expect(indizes.map((i) => pts[i])).toEqual(vereinfacheSegment(pts, 5))
    expect(indizes[0]).toBe(0)
    expect(indizes.at(-1)).toBe(pts.length - 1)
  })

  it('zählt auch bei ≤ 2 Punkten durch', () => {
    expect(vereinfacheIndizes([[8, 46, 0, 0]])).toEqual([0])
    expect(
      vereinfacheIndizes([
        [8, 46, 0, 0],
        [8.001, 46.001, 10, 60],
      ]),
    ).toEqual([0, 1])
  })
})

describe('berechneStats', () => {
  it('summiert Distanz über Segmente und rundet auf 100 m', () => {
    const { km } = berechneStats([
      {
        mode: 'walk',
        pts: [
          [8, 46, 500, 0],
          [8.013, 46, 500, 600], // ≈ 1 km auf 46° Breite
        ],
      },
    ])
    expect(km).toBeGreaterThan(0.8)
    expect(km).toBeLessThan(1.2)
  })

  it('glättet GPS-Höhenrauschen vor den Höhenmetern', () => {
    // ±3 m Zickzack um 500 m: roh wären das >100 Höhenmeter, geglättet ≈ 0
    const pts: UploadPunkt[] = Array.from({ length: 60 }, (_, i) => [
      8 + i * 0.0002,
      46,
      500 + (i % 2 ? 3 : -3),
      i * 10,
    ])
    const { gainM } = berechneStats([{ mode: 'walk', pts }])
    expect(gainM).toBeLessThan(10)
  })

  it('zählt echte Anstiege', () => {
    const pts: UploadPunkt[] = Array.from({ length: 50 }, (_, i) => [
      8 + i * 0.0005,
      46,
      500 + i * 10,
      i * 30,
    ])
    const { gainM } = berechneStats([{ mode: 'walk', pts }])
    expect(gainM).toBeGreaterThan(400)
    expect(gainM).toBeLessThan(500)
  })
})

describe('glaette', () => {
  it('mittelt über das Fenster', () => {
    expect(glaette([0, 10, 0], 1)).toEqual([5, 10 / 3, 5])
  })
})
