// Die Foto-Karte: was Player und Editor gemeinsam wissen müssen.
//
// Beide Zahlen hier hatten vorher eine stille Abweichung — die Standzeit stand
// an vier Stellen (eine davon roh und ungewacht), das Seitenverhältnis war im
// Player gemessen und im Editor fest 3:2. Der Test hält die Regel fest, nicht
// die Rechnung: `Math.max/min` prüft man nicht, die GRENZEN schon.

import { describe, expect, it } from 'vitest'
import {
  AR_MAX,
  AR_MIN,
  HOLD_AUSBLEND,
  HOLD_HIDE,
  balkenAnteil,
  kartenZeiten,
  klemmeSeitenverhaeltnis,
  klipDauerS,
} from '../src/einblendung.js'

describe('Standzeit der Foto-Karte', () => {
  it('ist die Zahl, gegen die Studio und Server ihre Spiegel halten', () => {
    expect(HOLD_HIDE).toBe(5.2)
    expect(HOLD_AUSBLEND).toBe(0.8)
  })

  // Die 1-Sekunden-Abweichung aus §6C des Gleichlauf-Konzepts: Der Player
  // rechnete den Ken-Burns-Zug über `holdS + 1.8`, der Editor über `holdS +
  // 0.8`. Seit E15 ziehen beide dieselbe Zahl aus dieser Funktion.
  it('ist mit der Ausblendung die Länge des Klips — in BEIDEN Bühnen', () => {
    expect(klipDauerS(HOLD_HIDE)).toBeCloseTo(6.0, 6)
    expect(klipDauerS(20)).toBeCloseTo(20.8, 6)
  })
})

describe('balkenAnteil', () => {
  it('füllt über den ganzen Klip, nicht nur über die Standzeit', () => {
    expect(balkenAnteil(0, 6)).toBe(0)
    expect(balkenAnteil(3, 6)).toBeCloseTo(0.5, 6)
    expect(balkenAnteil(6, 6)).toBe(1)
  })

  it('klemmt außerhalb und überlebt einen Klip ohne Länge', () => {
    expect(balkenAnteil(-2, 6)).toBe(0)
    expect(balkenAnteil(9, 6)).toBe(1)
    expect(balkenAnteil(1, 0)).toBe(0)
  })
})

describe('kartenZeiten', () => {
  // Der Kunstgriff: Die Animationen laufen NIE, ihr Fortschritt ist ein
  // negatives Delay. Deshalb ist die Karte rückwärts und beim Scrubben dort,
  // wo die Filmzeit steht — eine Wanduhr-Transition kann das nicht.
  it('gibt den Stand im Klip als negatives Delay', () => {
    expect(kartenZeiten(0, 6).zeitS).toBe(-0)
    expect(kartenZeiten(2.5, 6).zeitS).toBeCloseTo(-2.5, 6)
  })

  it('legt den Abgang in die letzten HOLD_AUSBLEND des Klips', () => {
    const anfang = kartenZeiten(0, 6)
    expect(anfang.ausDauerS).toBeCloseTo(HOLD_AUSBLEND, 6)
    // Positiv = die Animation steht noch aus; sie beginnt bei 5,2 s.
    expect(anfang.ausZeitS).toBeCloseTo(5.2, 6)
    expect(kartenZeiten(5.2, 6).ausZeitS).toBeCloseTo(0, 6)
    expect(kartenZeiten(6, 6).ausZeitS).toBeCloseTo(-0.8, 6)
  })

  // Ein Klip, der kürzer ist als die Ausblendung, darf keinen Abgang bekommen,
  // der länger dauert als er selbst — sonst bliebe die Karte bis in den
  // nächsten Halt sichtbar.
  it('deckelt den Abgang auf die Klip-Länge', () => {
    const kurz = kartenZeiten(0, 0.4)
    expect(kurz.ausDauerS).toBeCloseTo(0.4, 6)
    expect(kurz.kbDauerS).toBeCloseTo(0.4, 6)
  })

  // Eine Ken-Burns-Dauer von 0 ließe die Animation gar nicht rechnen.
  it('hält die Ken-Burns-Dauer über null', () => {
    expect(kartenZeiten(0, 0).kbDauerS).toBeGreaterThan(0)
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
