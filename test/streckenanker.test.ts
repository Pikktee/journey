import { describe, expect, it } from 'vitest'
import { baueSBeiF } from '../src/streckenanker.js'

describe('baueSBeiF', () => {
  // Die Tabelle des Beispiels: drei Wegpunkte, deren Abstände auf der ROHEN
  // Geometrie (f) und auf der gebauten Route (s) verschieden verteilt sind —
  // genau der Fall, den `f × total` nicht treffen kann.
  const fs = [0, 0.25, 1]
  const ss = [0, 400, 1000]

  it('trifft die Stützstellen exakt', () => {
    const sBeiF = baueSBeiF(fs, ss, 1000)
    expect(sBeiF(0)).toBe(0)
    expect(sBeiF(0.25)).toBe(400)
    expect(sBeiF(1)).toBe(1000)
  })

  it('interpoliert linear dazwischen — nicht f × total', () => {
    const sBeiF = baueSBeiF(fs, ss, 1000)
    expect(sBeiF(0.125)).toBeCloseTo(200, 9) // halber Weg im ersten Abschnitt
    expect(sBeiF(0.5)).toBeCloseTo(400 + (0.25 / 0.75) * 600, 9)
    expect(sBeiF(0.5)).not.toBeCloseTo(500, 1) // so läge der alte Rückfall
  })

  it('klemmt außerhalb von 0..1', () => {
    const sBeiF = baueSBeiF(fs, ss, 1000)
    expect(sBeiF(-3)).toBe(0)
    expect(sBeiF(7)).toBe(1000)
    expect(sBeiF(Number.NaN)).toBe(0)
  })

  it('spiegelt eine rückwärts gelesene Tabelle (?reverse=1)', () => {
    // Rückwärts dreht der Player Segmente UND Punkte um: f läuft absteigend,
    // s weiter aufsteigend. Der Anker gehört trotzdem an seinen physischen Ort.
    const rueck = baueSBeiF([1, 0.75, 0], [0, 600, 1000], 1000)
    expect(rueck(1)).toBe(0)
    expect(rueck(0.75)).toBe(600)
    expect(rueck(0)).toBe(1000)
    expect(rueck(0.875)).toBeCloseTo(300, 9)
  })

  it('nimmt bei gleichem f den LETZTEN Punkt (Nahtpunkt, Stand)', () => {
    // Der Nahtpunkt zweier Segmente kommt doppelt vor; im Stand liefert die
    // Aufzeichnung viele Punkte mit demselben f. Ein Anker genau dort meint
    // das Ende der Standzeit, nicht ihren Anfang.
    const sBeiF = baueSBeiF([0, 0.5, 0.5, 0.5, 1], [0, 300, 310, 320, 1000], 1000)
    expect(sBeiF(0.5)).toBe(320)
  })

  describe('Rückfall auf f × total', () => {
    // Kein Notbehelf: Kuratierte Touren bekommen NIE ein Wegpunkt-f, und
    // aufgezeichnete erst mit ihrem nächsten Render. Der Rückfall IST das
    // Verhalten von vorher.
    const pruefe = (sBeiF: (f: number) => number) => {
      expect(sBeiF(0)).toBe(0)
      expect(sBeiF(0.5)).toBe(500)
      expect(sBeiF(1)).toBe(1000)
    }

    it('ohne Tabelle', () => {
      pruefe(baueSBeiF(null, [], 1000))
      pruefe(baueSBeiF(undefined, [0, 1000], 1000))
    })

    it('bei ungleichen Längen', () => pruefe(baueSBeiF([0, 1], [0, 500, 1000], 1000)))
    it('bei weniger als zwei Punkten', () => pruefe(baueSBeiF([0], [0], 1000)))
    it('bei nicht monotonem f', () => pruefe(baueSBeiF([0, 0.6, 0.4, 1], [0, 300, 600, 1000], 1000)))
    it('bei unendlichen Werten', () => pruefe(baueSBeiF([0, Number.NaN, 1], [0, 300, 1000], 1000)))

    it('bei Route ohne Länge — dort ist jedes s null', () => {
      expect(baueSBeiF([0, 1], [0, 0], 0)(0.5)).toBe(0)
    })
  })
})
