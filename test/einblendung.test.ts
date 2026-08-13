// Die Foto-Karte: was Player und Editor gemeinsam wissen müssen.
//
// Beide Zahlen hier hatten vorher eine stille Abweichung — die Standzeit stand
// an vier Stellen (eine davon roh und ungewacht), das Seitenverhältnis war im
// Player gemessen und im Editor fest 3:2. Der Test hält die Regel fest, nicht
// die Rechnung: `Math.max/min` prüft man nicht, die GRENZEN schon.

import { describe, expect, it } from 'vitest'
import { AR_MAX, AR_MIN, HOLD_AUSBLEND, HOLD_HIDE, klemmeSeitenverhaeltnis } from '../src/einblendung.js'

describe('Standzeit der Foto-Karte', () => {
  it('ist die Zahl, gegen die Studio und Server ihre Spiegel halten', () => {
    expect(HOLD_HIDE).toBe(5.2)
    expect(HOLD_AUSBLEND).toBe(0.8)
  })
})

describe('klemmeSeitenverhaeltnis', () => {
  it('gibt gewöhnliche Formate unverändert zurück', () => {
    expect(klemmeSeitenverhaeltnis(3000, 2000)).toBeCloseTo(1.5, 6) // Querformat 3:2
    expect(klemmeSeitenverhaeltnis(2000, 3000)).toBeCloseTo(0.6667, 4) // Hochformat 2:3
    expect(klemmeSeitenverhaeltnis(1920, 1080)).toBeCloseTo(1.7778, 4) // 16:9
  })

  it('deckelt Panoramen und extreme Hochformate', () => {
    expect(klemmeSeitenverhaeltnis(6000, 2000)).toBe(AR_MAX) // 3:1
    expect(klemmeSeitenverhaeltnis(1080, 2400)).toBe(AR_MIN) // Handy-Hochformat 9:20
  })

  // Der Rückfall ist ausdrücklich `null` und NICHT 3:2: Der Aufrufer lässt
  // das bisherige Verhältnis stehen. Ein Vorgabewert ließe den Rahmen bei
  // jedem noch nicht vermessenen Medium kurz in die falsche Form springen.
  it('meldet unbekannte Maße als null', () => {
    expect(klemmeSeitenverhaeltnis(0, 0)).toBeNull()
    expect(klemmeSeitenverhaeltnis(1000, 0)).toBeNull()
    expect(klemmeSeitenverhaeltnis(Number.NaN, 100)).toBeNull()
  })

  // Ein Hochformat im 3:2-Rahmen mit `object-fit: cover` verliert oben und
  // unten je ~29 % der Bildhöhe — genau der Beschnitt, den der Editor bis
  // Paket A hatte und den der Player-Kommentar ausdrücklich vermeiden will.
  it('hält ein Hochformat im Hochformat', () => {
    const ar = klemmeSeitenverhaeltnis(2000, 3000)
    expect(ar).not.toBeNull()
    expect(ar as number).toBeLessThan(1)
  })
})
