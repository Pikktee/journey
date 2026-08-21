// Routen-Signatur: die Form einer Tour als winziger SVG-Pfad für die Kachel.
import { describe, expect, it } from 'vitest'
import { buildSignature } from '../src/pipeline/signature.js'

/** Zahlen aus einem SVG-`d` als Punktepaare. */
function punkteAus(d: string): Array<[number, number]> {
  return [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])])
}

describe('baueSignatur', () => {
  it('legt eine Route in den 0..100-Kasten', () => {
    const sig = buildSignature([
      [8, 47],
      [8.1, 47],
      [8.1, 47.1],
    ])
    expect(sig).not.toBeNull()
    const points = punkteAus(sig!.d)
    const xs = points.map((p) => p[0])
    const ys = points.map((p) => p[1])
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...xs)).toBeLessThanOrEqual(100)
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...ys)).toBeLessThanOrEqual(100)
  })

  it('dreht y um — Norden liegt oben', () => {
    const sig = buildSignature([
      [8, 47],
      [8, 47.2],
    ])!
    // Der SÜDLICHERE Punkt bekommt das GRÖSSERE y (SVG zählt nach unten)
    expect(sig.start[1]).toBeGreaterThan(sig.end[1])
  })

  it('behält das Seitenverhältnis — eine schmale Route bleibt schmal', () => {
    // Weit in Nord-Süd, kaum in Ost-West: gedehnt sähe das aus wie ein Zickzack
    // über die ganze Kachel, obwohl die Tour eine Gerade ist.
    const sig = buildSignature([
      [8, 46],
      [8.001, 46.5],
      [8, 47],
    ])!
    const xs = punkteAus(sig.d).map((p) => p[0])
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(5)
    // … und sie steht mittig, nicht am Rand geklebt
    expect(Math.min(...xs)).toBeGreaterThan(40)
  })

  it('dünnt lange Aufzeichnungen aus, ohne Anfang und Ende zu verlieren', () => {
    const viele = Array.from({ length: 5000 }, (_, i) => [8 + i * 0.0001, 47 + i * 0.0001] as const)
    const sig = buildSignature(viele)!
    const points = punkteAus(sig.d)
    expect(points.length).toBeLessThanOrEqual(91)
    expect(points[0]).toEqual(sig.start)
    expect(points[points.length - 1]).toEqual(sig.end)
  })

  it('liefert null, wo es keine Form gibt', () => {
    expect(buildSignature([])).toBeNull()
    expect(buildSignature([[8, 47]])).toBeNull()
    // Alle Punkte auf derselben Stelle (Aufzeichnung im Stand)
    expect(
      buildSignature([
        [8, 47],
        [8, 47],
        [8, 47],
      ]),
    ).toBeNull()
  })
})
