// Absicherung des Routen-Kerns (src/geo.ts) — die eine Zustandsvariable des
// Players ist der Streckenmeter s; buildRoute/pointAt/nearestS übersetzen
// zwischen s, Koordinaten und Ankern. Bisher ungetestet, jetzt Pflicht:
// Remote-Touren hängen an exakt diesem Verhalten.

import { describe, expect, it } from 'vitest'
import { bearingAt, buildRoute, dist, gruppiereStopps, nearestS, pointAt } from '../src/geo.js'
import type { Wegpunkt } from '../src/tours.js'

// Gerade West→Ost auf 46° Breite, sanft steigend — 5 Wegpunkte à ~770 m
const wegpunkte: Wegpunkt[] = [
  [8.0, 46.0, 500],
  [8.01, 46.0, 520],
  [8.02, 46.0, 540],
  [8.03, 46.0, 560],
  [8.04, 46.0, 580],
]

describe('buildRoute', () => {
  it('resampelt auf ~14-m-Schritte mit kumulierten Distanzen', () => {
    const route = buildRoute(wegpunkte)
    expect(route.total).toBeGreaterThan(2800)
    expect(route.total).toBeLessThan(3400)
    // Schrittweite: innere Stützpunkte liegen exakt 14 m auseinander
    expect(route.cum[1]! - route.cum[0]!).toBeCloseTo(14, 5)
    expect(route.cum[2]! - route.cum[1]!).toBeCloseTo(14, 5)
    // Monoton steigend bis total
    for (let i = 1; i < route.cum.length; i++)
      expect(route.cum[i]).toBeGreaterThanOrEqual(route.cum[i - 1]!)
    expect(route.cum[route.cum.length - 1]).toBe(route.total)
  })

  it('startet und endet exakt an den Wegpunkten', () => {
    const route = buildRoute(wegpunkte)
    expect(route.coords[0]!.slice(0, 2)).toEqual([8.0, 46.0])
    const ende = route.coords[route.coords.length - 1]!
    expect(ende[0]).toBeCloseTo(8.04, 10)
    expect(ende[1]).toBeCloseTo(46.0, 10)
  })

  it('summiert Höhenmeter über die geglättete Linie', () => {
    const route = buildRoute(wegpunkte)
    expect(route.gain).toBeGreaterThan(75)
    expect(route.gain).toBeLessThan(90)
  })

  // `wpS` ist die Player-Hälfte der f-Übersetzung (§8D): je EINGABE-Wegpunkt
  // sein Wegstand auf der gebauten Route. Verrutscht die Zuordnung um einen
  // Index, trägt jeder Anker das f seines Nachbarn.
  describe('wpS — Wegstand je Wegpunkt', () => {
    it('hat je Wegpunkt einen Eintrag, von 0 bis total', () => {
      const route = buildRoute(wegpunkte)
      expect(route.wpS).toHaveLength(wegpunkte.length)
      expect(route.wpS[0]).toBe(0)
      expect(route.wpS[route.wpS.length - 1]).toBeCloseTo(route.total, 9)
      for (let i = 1; i < route.wpS.length; i++)
        expect(route.wpS[i]).toBeGreaterThan(route.wpS[i - 1]!)
    })

    it('trifft den Ort des Wegpunktes (Gegenprobe über pointAt)', () => {
      const route = buildRoute(wegpunkte)
      for (let i = 0; i < wegpunkte.length; i++) {
        const p = pointAt(route, route.wpS[i]!)
        // Innerhalb eines 14-m-Schritts — genauer geht es nicht, die Route ist
        // in genau diesem Raster abgetastet.
        expect(dist(p, wegpunkte[i]!)).toBeLessThan(14)
      }
    })

    it('kommt auch mit einem einzelnen Wegpunkt zurecht', () => {
      const route = buildRoute([[8, 46, 500]])
      expect(route.wpS).toEqual([0])
    })
  })
})

describe('pointAt', () => {
  it('interpoliert Position und Höhe entlang s', () => {
    const route = buildRoute(wegpunkte)
    const mitte = pointAt(route, route.total / 2)
    expect(mitte[0]).toBeCloseTo(8.02, 3)
    expect(mitte[1]).toBeCloseTo(46.0, 4)
    expect(mitte[2]).toBeGreaterThan(500)
    expect(mitte[2]).toBeLessThan(580)
  })

  it('klemmt s auf [0, total]', () => {
    const route = buildRoute(wegpunkte)
    expect(pointAt(route, -50)).toEqual(pointAt(route, 0))
    expect(pointAt(route, route.total + 50)).toEqual(pointAt(route, route.total))
  })
})

describe('nearestS', () => {
  it('findet den Streckenmeter zum nächstgelegenen Punkt (Foto-Anker)', () => {
    const route = buildRoute(wegpunkte)
    // Anker leicht neben der Streckenmitte
    const s = nearestS(route, [8.02, 46.0005])
    const erwartet = route.total / 2
    expect(Math.abs(s - erwartet)).toBeLessThan(100)
  })

  it('mappt Anker vor dem Start auf s≈0', () => {
    const route = buildRoute(wegpunkte)
    expect(nearestS(route, [7.99, 46.0])).toBeLessThan(20)
  })
})

describe('bearingAt', () => {
  it('liefert auf der West→Ost-Geraden ~90°', () => {
    const route = buildRoute(wegpunkte)
    const b = bearingAt(route, route.total / 2)
    expect(Math.abs(b - 90)).toBeLessThan(3)
  })
})

describe('dist', () => {
  it('liefert bekannte Distanzen', () => {
    // 0,01° Länge auf 46° Breite ≈ 773 m
    const d = dist([8.0, 46.0], [8.01, 46.0])
    expect(d).toBeGreaterThan(760)
    expect(d).toBeLessThan(790)
  })
})

// — Foto-Stopps —
//
// Aufnahmen dicht beieinander zeigt der Player als EINEN Halt nacheinander.
// Die Regel lag bis dahin ungetestet in main.js; sie ist die Wahrheit, an der
// sich der Studio-Editor ausrichtet (Drift-Wächter in studio-stopps.test.ts).

describe('gruppiereStopps', () => {
  const foto = (id: string, s: number, extra: { order?: number } = {}) => ({ id, s, ...extra })

  it('fasst Aufnahmen unter 120 m zu einem Halt zusammen', () => {
    const stopps = gruppiereStopps([foto('a', 1000), foto('b', 1119), foto('c', 5000)])
    expect(stopps.map((x) => x.items.map((m) => m.id))).toEqual([['a', 'b'], ['c']])
    // Der Halt liegt am ERSTEN Foto, nicht in der Mitte
    expect(stopps[0]!.s).toBe(1000)
  })

  it('misst zum Anfang des Halts — eine Kette verschmilzt nicht endlos', () => {
    const stopps = gruppiereStopps([
      foto('a', 1000),
      foto('b', 1100),
      foto('c', 1200),
      foto('d', 1300),
    ])
    expect(stopps.map((x) => x.items.map((m) => m.id))).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })

  it('ordnet innerhalb eines Halts nach `order`, sonst nach Streckenmetern', () => {
    const mitReihe = gruppiereStopps([
      foto('a', 1000, { order: 2 }),
      foto('b', 1050, { order: 0 }),
      foto('c', 1100, { order: 1 }),
    ])
    expect(mitReihe[0]!.items.map((m) => m.id)).toEqual(['b', 'c', 'a'])
    const ohne = gruppiereStopps([foto('a', 1000), foto('b', 1050)])
    expect(ohne[0]!.items.map((m) => m.id)).toEqual(['a', 'b'])
    // Teilweise gesetzt: wer keine hat, kommt dahinter
    const teils = gruppiereStopps([foto('a', 1000), foto('b', 1050, { order: 0 })])
    expect(teils[0]!.items.map((m) => m.id)).toEqual(['b', 'a'])
  })

  it('kommt mit leerer Liste und Einzelfotos zurecht', () => {
    expect(gruppiereStopps([])).toEqual([])
    expect(gruppiereStopps([foto('a', 500)])).toHaveLength(1)
  })
})
