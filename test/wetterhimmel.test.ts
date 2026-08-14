// Die Wetter-Regel, die Player und Editor teilen: aus Lage und Stärke werden
// Deckung, Schwere und Nebel — im Player für Atmosphäre und Grading, im Editor
// für den flachen Schleier über der Karte.

import { describe, expect, it } from 'vitest'
import { himmelBei, schleierFuer, WETTER_HIMMEL, type SzenenWetter } from '../src/wetterhimmel.js'
// Die Studio-Liste und nicht die des Servers: Sie ist von hier importierbar
// (server/ hat einen eigenen `rootDir`) und ihrerseits gegen das Server-Schema
// gewacht — test/studio-baukasten.test.ts vergleicht beide.
import { WETTER_MODI } from '../src/studio/editmodell.js'

const MODI: SzenenWetter[] = ['off', 'clouds', 'fog', 'rain', 'snow', 'storm']

describe('himmelBei', () => {
  it('kennt jede Lage, die das Overlay setzen kann', () => {
    // Die Liste ist die des Servers — läuft sie auseinander, zeigt der Editor
    // für eine gültige Grenze gar nichts, und niemand meldet es.
    for (const m of WETTER_MODI) expect(WETTER_HIMMEL[m as SzenenWetter]).toBeDefined()
  })

  it('spannt die Deckung über die Stärke', () => {
    const leicht = himmelBei('clouds', 0.4)
    const stark = himmelBei('clouds', 1)
    expect(leicht.cover).toBeCloseTo(0.28, 3) // einzelne Wolken, Sonne frei
    expect(stark.cover).toBeCloseTo(0.98, 3) // geschlossene Decke
  })

  // Auch leichter Regen fällt nicht aus heiterem Himmel — die
  // Niederschlags-Lagen starten deutlich über „wolkig".
  it('lässt Niederschlag schon bei geringer Stärke bedeckt sein', () => {
    expect(himmelBei('rain', 0.4).cover).toBeGreaterThan(himmelBei('clouds', 0.4).cover)
    expect(himmelBei('storm', 0.4).cover).toBeGreaterThan(himmelBei('rain', 0.4).cover)
  })

  // Unterhalb der UI-Stufen (künftiges stufenloses Echtwetter) bleibt die
  // Deckung am unteren Ende der Spanne, statt unter sie zu fallen.
  it('klemmt unter der kleinsten Stufe statt zu unterschreiten', () => {
    expect(himmelBei('rain', 0).cover).toBeCloseTo(WETTER_HIMMEL.rain.c0, 3)
    expect(himmelBei('rain', -1).cover).toBeCloseTo(WETTER_HIMMEL.rain.c0, 3)
  })

  it('gibt bei `off` überall null', () => {
    expect(himmelBei('off', 1)).toEqual({ cover: 0, dark: 0, fog: 0 })
  })
})

describe('schleierFuer', () => {
  it('zeigt bei `off` nichts', () => {
    expect(schleierFuer('off', 1)).toEqual({ wasch: '', schatten: '', nebel: 0, schnee: 0 })
  })

  // Der Punkt der ganzen Umstellung: `clouds` und `fog` haben im
  // Partikel-Overlay KEIN Profil — dort blieb die Karte leer. Hier haben sie
  // eine Farbe wie jede andere Lage.
  it('stellt JEDE Lage dar, auch die ohne Partikel', () => {
    for (const m of MODI.filter((x) => x !== 'off')) {
      const s = schleierFuer(m, 0.7)
      expect(s.wasch, `${m} ohne Farbschleier`).not.toBe('')
      expect(s.schatten, `${m} ohne Abdunklung`).not.toBe('')
    }
  })

  it('wird mit der Stärke dichter', () => {
    const a = alpha(schleierFuer('rain', 0.4).wasch)
    const b = alpha(schleierFuer('rain', 1).wasch)
    expect(b).toBeGreaterThan(a)
  })

  // Der Schleier färbt die Karte, er deckt sie nicht zu — man arbeitet
  // darunter. Im Player rettet die Bewegung der Tropfen ein dichteres Bild,
  // hier gibt es keine.
  it('bleibt auch beim Gewitter durchsichtig genug zum Arbeiten', () => {
    const s = schleierFuer('storm', 1)
    expect(alpha(s.wasch) + alpha(s.schatten)).toBeLessThan(0.4)
  })

  // Nur Schnee legt sich auf den BODEN — dieselbe Kopplung wie im Player
  // (`dayNight.setSnow`), damit eine Winterfahrt eine weiße Landschaft zeigt
  // und nicht bloß einen grauen Schleier darüber.
  it('gibt nur bei Schnee eine Schneedecke', () => {
    expect(schleierFuer('snow', 1).schnee).toBeGreaterThan(0)
    for (const m of MODI.filter((x) => x !== 'snow')) {
      expect(schleierFuer(m, 1).schnee, `${m} sollte keinen Bodenschnee haben`).toBe(0)
    }
  })

  it('nennt Nebel nur, wo Nebel ist', () => {
    expect(schleierFuer('fog', 1).nebel).toBeGreaterThan(0.5)
    expect(schleierFuer('clouds', 1).nebel).toBe(0)
  })
})

/** Deckkraft aus einer `rgba(…)`-Zeichenkette. */
function alpha(farbe: string): number {
  const m = /rgba\([^)]*,\s*([\d.]+)\s*\)/.exec(farbe)
  expect(m, `keine rgba-Farbe: ${farbe}`).not.toBeNull()
  return Number((m as RegExpExecArray)[1])
}
