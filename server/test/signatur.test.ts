// Routen-Signatur: die Form einer Tour als winziger SVG-Pfad für die Kachel.
import { describe, expect, it } from 'vitest'
import { baueSignatur } from '../src/pipeline/signatur.js'

/** Zahlen aus einem SVG-`d` als Punktepaare. */
function punkteAus(d: string): Array<[number, number]> {
  return [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])])
}

describe('baueSignatur', () => {
  it('legt eine Route in den 0..100-Kasten', () => {
    const sig = baueSignatur([
      [8, 47],
      [8.1, 47],
      [8.1, 47.1],
    ])
    expect(sig).not.toBeNull()
    const punkte = punkteAus(sig!.d)
    const xs = punkte.map((p) => p[0])
    const ys = punkte.map((p) => p[1])
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...xs)).toBeLessThanOrEqual(100)
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...ys)).toBeLessThanOrEqual(100)
  })

  it('dreht y um — Norden liegt oben', () => {
    const sig = baueSignatur([
      [8, 47],
      [8, 47.2],
    ])!
    // Der SÜDLICHERE Punkt bekommt das GRÖSSERE y (SVG zählt nach unten)
    expect(sig.start[1]).toBeGreaterThan(sig.ende[1])
  })

  it('behält das Seitenverhältnis — eine schmale Route bleibt schmal', () => {
    // Weit in Nord-Süd, kaum in Ost-West: gedehnt sähe das aus wie ein Zickzack
    // über die ganze Kachel, obwohl die Tour eine Gerade ist.
    const sig = baueSignatur([
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
    const sig = baueSignatur(viele)!
    const punkte = punkteAus(sig.d)
    expect(punkte.length).toBeLessThanOrEqual(91)
    expect(punkte[0]).toEqual(sig.start)
    expect(punkte[punkte.length - 1]).toEqual(sig.ende)
  })

  it('liefert null, wo es keine Form gibt', () => {
    expect(baueSignatur([])).toBeNull()
    expect(baueSignatur([[8, 47]])).toBeNull()
    // Alle Punkte auf derselben Stelle (Aufzeichnung im Stand)
    expect(
      baueSignatur([
        [8, 47],
        [8, 47],
        [8, 47],
      ]),
    ).toBeNull()
  })
})
