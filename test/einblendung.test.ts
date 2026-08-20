// Die Foto-titel: was Player und Editor gemeinsam wissen müssen.
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
  VIDEO_DRIFT_LAUF_S,
  VIDEO_DRIFT_STAND_S,
  VIDEO_HAT_FRAME,
  VIDEO_HAT_MASSE,
  VIDEO_LAEUFT_WEITER,
  VIDEO_SUCH_PAUSE_S,
  ausschnittDauerS,
  balkenAnteil,
  kartenZeiten,
  klemmeSeitenverhaeltnis,
  klipDauerS,
  videoNachfuehrung,
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

describe('ausschnittDauerS', () => {
  // Die Ton-Hülle blendet über den AUSSCHNITT ein und aus, nicht über die
  // Datei. Beide Bühnen rechneten ihn bis zur Szene-Schicht (§9) getrennt:
  // der Player `endeS` roh, der Editor `endeS - vonS`.
  it('nimmt im Player die geschnittene Fassung (kein linker Schnitt)', () => {
    expect(ausschnittDauerS(12, 0, 9)).toBe(9)
  })

  it('zieht im Editor die linke Kante ab (ungeschnittener Master)', () => {
    expect(ausschnittDauerS(30, 4, 13)).toBe(9)
  })

  // Der Fall, der die beiden Formeln verband: DERSELBE Ausschnitt, einmal als
  // geschnittene Datei, einmal als Master mit Kanten — dieselbe Blenddauer.
  it('ergibt für denselben Ausschnitt dieselbe Länge', () => {
    expect(ausschnittDauerS(9, 0, 9)).toBe(ausschnittDauerS(30, 4, 13))
  })

  // Ohne rechten Schnitt gilt das Dateiende — und die linke Kante zählt auch
  // dort. Genau hier lag der stille Unterschied: Der Player nahm `dauerS`
  // ungekürzt, was für ihn richtig war (vonS = 0) und für sonst niemanden.
  it('fällt ohne rechten Schnitt auf das Dateiende zurück', () => {
    expect(ausschnittDauerS(12)).toBe(12)
    expect(ausschnittDauerS(12, 0, Number.POSITIVE_INFINITY)).toBe(12)
    expect(ausschnittDauerS(12, 3)).toBe(9)
  })

  // Ein Video, dessen Metadaten noch fehlen (`duration` = NaN), darf keine
  // negative oder unendliche Blenddauer erzeugen: `videoTonHuelle` bekäme
  // sonst eine Zahl, aus der jeder Pegel NaN wird — also Stille ohne Grund.
  it('bleibt bei unbekannter Dauer bei 0', () => {
    expect(ausschnittDauerS(Number.NaN)).toBe(0)
    expect(ausschnittDauerS(Number.POSITIVE_INFINITY, 0, Number.NaN)).toBe(0)
    expect(ausschnittDauerS(5, 9)).toBe(0) // linke Kante hinter dem Ende
  })
})

// Die Nachführung des Videos — der Teil, an dem der Player auf dem Telefon
// scheiterte. Sichtbar war es als Ruckeln mit schwarzen Bildern dazwischen; die
// Ursache war eine Bedingung ohne Rückfragen: `|currentTime − ziel| > 0.34` in
// JEDEM Frame. Über Mobilfunk braucht ein Video rund eine Sekunde bis zum ersten
// Frame — nach 0,34 s Filmzeit wurde also gesucht, im nächsten Frame erneut, und
// keiner der Suchläufe kam je an. Genau diese vier Regeln stehen hier.
describe('Video-Nachführung', () => {
  /** Der Normalfall: läuft, spielt, gut gepuffert, lange kein Suchlauf. */
  const lauf = (drift: number, mehr: Partial<Parameters<typeof videoNachfuehrung>[0]> = {}) =>
    videoNachfuehrung({
      zielS: 10,
      istS: 10 - drift,
      laeuft: true,
      paused: false,
      seeking: false,
      readyState: VIDEO_LAEUFT_WEITER,
      seitSuchlaufS: 99,
      ...mehr,
    })

  it('lässt das Video im Lauf seine eigene Uhr tragen', () => {
    expect(lauf(VIDEO_DRIFT_LAUF_S - 0.01).suchen).toBe(false)
    expect(lauf(VIDEO_DRIFT_LAUF_S + 0.01).suchen).toBe(true)
    // Voraus zählt wie zurück — beides ist Versatz.
    expect(lauf(-(VIDEO_DRIFT_LAUF_S + 0.01)).suchen).toBe(true)
  })

  it('überholt keinen laufenden Suchlauf', () => {
    // Der Sturm in einer Zeile: Das Ziel wandert weiter, also verlangt jeder
    // Frame den nächsten Sprung — und jeder neue bricht den vorigen ab.
    expect(lauf(3, { seeking: true }).suchen).toBe(false)
  })

  it('springt im Lauf nicht in ungepufferte Daten', () => {
    expect(lauf(3, { readyState: VIDEO_HAT_FRAME }).suchen).toBe(false)
    expect(lauf(3, { readyState: VIDEO_HAT_MASSE }).suchen).toBe(false)
    expect(lauf(3, { readyState: 0 }).suchen).toBe(false)
  })

  it('lässt zwischen zwei Suchläufen Wanduhr-Ruhe', () => {
    expect(lauf(3, { seitSuchlaufS: VIDEO_SUCH_PAUSE_S - 0.01 }).suchen).toBe(false)
    expect(lauf(3, { seitSuchlaufS: VIDEO_SUCH_PAUSE_S }).suchen).toBe(true)
  })

  // Im Stand führt der Finger. Dort IST die gesuchte Stelle das, was man sehen
  // will — also feine Schwelle, kein Warten auf Puffer, keine Ruhe; nur ein
  // laufender Suchlauf wird abgewartet, sonst käme keiner an.
  it('folgt im Stand fein und ohne Wartezeit', () => {
    const stand = (drift: number, mehr = {}) =>
      videoNachfuehrung({
        zielS: 10,
        istS: 10 - drift,
        laeuft: false,
        paused: true,
        seeking: false,
        readyState: VIDEO_HAT_MASSE,
        seitSuchlaufS: 0,
        ...mehr,
      })
    expect(stand(VIDEO_DRIFT_STAND_S + 0.001).suchen).toBe(true)
    expect(stand(VIDEO_DRIFT_STAND_S - 0.001).suchen).toBe(false)
    expect(stand(1, { seeking: true }).suchen).toBe(false)
    expect(stand(1, { readyState: 0 }).suchen).toBe(false)
  })

  // Im Film gibt es keine Toleranz: Je Filmbild vergehen 0,3–2 s Wanduhr, ein
  // nebenher laufendes Video stünde beim Abgreifen irgendwo. Also steht es und
  // wird gesucht — dieselbe Regel wie im Stand.
  it('sucht für den Export jedes Bild und lässt das Video nie laufen', () => {
    const film = (drift: number, mehr = {}) => lauf(drift, { bildgenau: true, ...mehr })
    expect(film(0.1).suchen).toBe(true)
    expect(film(0.1).anhalten).toBe(true)
    expect(film(0.1, { paused: true }).starten).toBe(false)
    // Auch hier gilt: einen laufenden Suchlauf abwarten.
    expect(film(0.1, { seeking: true }).suchen).toBe(false)
    // Aber keine Wanduhr-Ruhe — sie käme aus einer Uhr, die der Film nicht hat.
    expect(film(0.1, { seitSuchlaufS: 0 }).suchen).toBe(true)
  })

  it('startet nur im Lauf und hält nur außerhalb an', () => {
    expect(lauf(0, { paused: true }).starten).toBe(true)
    expect(lauf(0).starten).toBe(false)
    expect(lauf(0).anhalten).toBe(false)
    const aus = lauf(0, { laeuft: false })
    expect(aus.anhalten).toBe(true)
    expect(aus.starten).toBe(false)
  })
})
