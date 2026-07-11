// Absicherung des Routen-Kerns (src/geo.js) — die eine Zustandsvariable des
// Players ist der Streckenmeter s; buildRoute/pointAt/nearestS übersetzen
// zwischen s, Koordinaten und Ankern. Bisher ungetestet, jetzt Pflicht:
// Remote-Touren hängen an exakt diesem Verhalten.

import { describe, expect, it } from 'vitest'
import { bearingAt, buildRoute, dist, nearestS, pointAt } from '../src/geo.js'

// Gerade West→Ost auf 46° Breite, sanft steigend — 5 Wegpunkte à ~770 m
const wegpunkte = [
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
    expect(route.cum[1] - route.cum[0]).toBeCloseTo(14, 5)
    expect(route.cum[2] - route.cum[1]).toBeCloseTo(14, 5)
    // Monoton steigend bis total
    for (let i = 1; i < route.cum.length; i++) expect(route.cum[i]).toBeGreaterThanOrEqual(route.cum[i - 1])
    expect(route.cum[route.cum.length - 1]).toBe(route.total)
  })

  it('startet und endet exakt an den Wegpunkten', () => {
    const route = buildRoute(wegpunkte)
    expect(route.coords[0].slice(0, 2)).toEqual([8.0, 46.0])
    const ende = route.coords[route.coords.length - 1]
    expect(ende[0]).toBeCloseTo(8.04, 10)
    expect(ende[1]).toBeCloseTo(46.0, 10)
  })

  it('summiert Höhenmeter über die geglättete Linie', () => {
    const route = buildRoute(wegpunkte)
    expect(route.gain).toBeGreaterThan(75)
    expect(route.gain).toBeLessThan(90)
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
