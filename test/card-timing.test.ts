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
  HOLD_FADE_OUT_S,
  HOLD_HIDE,
  VIDEO_DRIFT_PLAYING_S,
  VIDEO_DRIFT_PAUSED_S,
  VIDEO_HAS_FRAME,
  VIDEO_HAS_METADATA,
  VIDEO_HAS_FUTURE_DATA,
  VIDEO_SEEK_COOLDOWN_S,
  trimmedDurationS,
  barFraction,
  cardTimings,
  clampAspectRatio,
  clipDurationS,
  videoSeekDecision,
} from '../src/card-timing.js'

describe('Standzeit der Foto-Karte', () => {
  it('ist die Zahl, gegen die Studio und Server ihre Spiegel halten', () => {
    expect(HOLD_HIDE).toBe(5.2)
    expect(HOLD_FADE_OUT_S).toBe(0.8)
  })

  // Die 1-Sekunden-Abweichung aus §6C des Gleichlauf-Konzepts: Der Player
  // rechnete den Ken-Burns-Zug über `holdS + 1.8`, der Editor über `holdS +
  // 0.8`. Seit E15 ziehen beide dieselbe Zahl aus dieser Funktion.
  it('ist mit der Ausblendung die Länge des Klips — in BEIDEN Bühnen', () => {
    expect(clipDurationS(HOLD_HIDE)).toBeCloseTo(6.0, 6)
    expect(clipDurationS(20)).toBeCloseTo(20.8, 6)
  })
})

describe('balkenAnteil', () => {
  it('füllt über den ganzen Klip, nicht nur über die Standzeit', () => {
    expect(barFraction(0, 6)).toBe(0)
    expect(barFraction(3, 6)).toBeCloseTo(0.5, 6)
    expect(barFraction(6, 6)).toBe(1)
  })

  it('klemmt außerhalb und überlebt einen Klip ohne Länge', () => {
    expect(barFraction(-2, 6)).toBe(0)
    expect(barFraction(9, 6)).toBe(1)
    expect(barFraction(1, 0)).toBe(0)
  })
})

describe('kartenZeiten', () => {
  // Der Kunstgriff: Die Animationen laufen NIE, ihr Fortschritt ist ein
  // negatives Delay. Deshalb ist die Karte rückwärts und beim Scrubben dort,
  // wo die Filmzeit steht — eine Wanduhr-Transition kann das nicht.
  it('gibt den Stand im Klip als negatives Delay', () => {
    expect(cardTimings(0, 6).timeS).toBe(-0)
    expect(cardTimings(2.5, 6).timeS).toBeCloseTo(-2.5, 6)
  })

  it('legt den Abgang in die letzten HOLD_AUSBLEND des Klips', () => {
    const anfang = cardTimings(0, 6)
    expect(anfang.exitDurationS).toBeCloseTo(HOLD_FADE_OUT_S, 6)
    // Positiv = die Animation steht noch aus; sie beginnt bei 5,2 s.
    expect(anfang.exitTimeS).toBeCloseTo(5.2, 6)
    expect(cardTimings(5.2, 6).exitTimeS).toBeCloseTo(0, 6)
    expect(cardTimings(6, 6).exitTimeS).toBeCloseTo(-0.8, 6)
  })

  // Ein Klip, der kürzer ist als die Ausblendung, darf keinen Abgang bekommen,
  // der länger dauert als er selbst — sonst bliebe die Karte bis in den
  // nächsten Halt sichtbar.
  it('deckelt den Abgang auf die Klip-Länge', () => {
    const kurz = cardTimings(0, 0.4)
    expect(kurz.exitDurationS).toBeCloseTo(0.4, 6)
    expect(kurz.kenBurnsDurationS).toBeCloseTo(0.4, 6)
  })

  // Eine Ken-Burns-Dauer von 0 ließe die Animation gar nicht rechnen.
  it('hält die Ken-Burns-Dauer über null', () => {
    expect(cardTimings(0, 0).kenBurnsDurationS).toBeGreaterThan(0)
  })
})

describe('klemmeSeitenverhaeltnis', () => {
  it('gibt gewöhnliche Formate unverändert zurück', () => {
    expect(clampAspectRatio(3000, 2000)).toBeCloseTo(1.5, 6) // Querformat 3:2
    expect(clampAspectRatio(2000, 3000)).toBeCloseTo(0.6667, 4) // Hochformat 2:3
    expect(clampAspectRatio(1920, 1080)).toBeCloseTo(1.7778, 4) // 16:9
  })

  it('deckelt Panoramen und extreme Hochformate', () => {
    expect(clampAspectRatio(6000, 2000)).toBe(AR_MAX) // 3:1
    expect(clampAspectRatio(1080, 2400)).toBe(AR_MIN) // Handy-Hochformat 9:20
  })

  // Der Rückfall ist ausdrücklich `null` und NICHT 3:2: Der Aufrufer lässt
  // das bisherige Verhältnis stehen. Ein Vorgabewert ließe den Rahmen bei
  // jedem noch nicht vermessenen Medium kurz in die falsche Form springen.
  it('meldet unbekannte Maße als null', () => {
    expect(clampAspectRatio(0, 0)).toBeNull()
    expect(clampAspectRatio(1000, 0)).toBeNull()
    expect(clampAspectRatio(Number.NaN, 100)).toBeNull()
  })

  // Ein Hochformat im 3:2-Rahmen mit `object-fit: cover` verliert oben und
  // unten je ~29 % der Bildhöhe — genau der Beschnitt, den der Editor bis
  // Paket A hatte und den der Player-Kommentar ausdrücklich vermeiden will.
  it('hält ein Hochformat im Hochformat', () => {
    const ar = clampAspectRatio(2000, 3000)
    expect(ar).not.toBeNull()
    expect(ar as number).toBeLessThan(1)
  })
})

describe('ausschnittDauerS', () => {
  // Die Ton-Hülle blendet über den AUSSCHNITT ein und aus, nicht über die
  // Datei. Beide Bühnen rechneten ihn bis zur Szene-Schicht (§9) getrennt:
  // der Player `endeS` roh, der Editor `endeS - vonS`.
  it('nimmt im Player die geschnittene Fassung (kein linker Schnitt)', () => {
    expect(trimmedDurationS(12, 0, 9)).toBe(9)
  })

  it('zieht im Editor die linke Kante ab (ungeschnittener Master)', () => {
    expect(trimmedDurationS(30, 4, 13)).toBe(9)
  })

  // Der Fall, der die beiden Formeln verband: DERSELBE Ausschnitt, einmal als
  // geschnittene Datei, einmal als Master mit Kanten — dieselbe Blenddauer.
  it('ergibt für denselben Ausschnitt dieselbe Länge', () => {
    expect(trimmedDurationS(9, 0, 9)).toBe(trimmedDurationS(30, 4, 13))
  })

  // Ohne rechten Schnitt gilt das Dateiende — und die linke Kante zählt auch
  // dort. Genau hier lag der stille Unterschied: Der Player nahm `dauerS`
  // ungekürzt, was für ihn richtig war (vonS = 0) und für sonst niemanden.
  it('fällt ohne rechten Schnitt auf das Dateiende zurück', () => {
    expect(trimmedDurationS(12)).toBe(12)
    expect(trimmedDurationS(12, 0, Number.POSITIVE_INFINITY)).toBe(12)
    expect(trimmedDurationS(12, 3)).toBe(9)
  })

  // Ein Video, dessen Metadaten noch fehlen (`duration` = NaN), darf keine
  // negative oder unendliche Blenddauer erzeugen: `videoTonHuelle` bekäme
  // sonst eine Zahl, aus der jeder Pegel NaN wird — also Stille ohne Grund.
  it('bleibt bei unbekannter Dauer bei 0', () => {
    expect(trimmedDurationS(Number.NaN)).toBe(0)
    expect(trimmedDurationS(Number.POSITIVE_INFINITY, 0, Number.NaN)).toBe(0)
    expect(trimmedDurationS(5, 9)).toBe(0) // linke Kante hinter dem Ende
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
  const lauf = (drift: number, mehr: Partial<Parameters<typeof videoSeekDecision>[0]> = {}) =>
    videoSeekDecision({
      targetS: 10,
      isS: 10 - drift,
      playing: true,
      paused: false,
      seeking: false,
      readyState: VIDEO_HAS_FUTURE_DATA,
      sinceSeekS: 99,
      ...mehr,
    })

  it('lässt das Video im Lauf seine eigene Uhr tragen', () => {
    expect(lauf(VIDEO_DRIFT_PLAYING_S - 0.01).seek).toBe(false)
    expect(lauf(VIDEO_DRIFT_PLAYING_S + 0.01).seek).toBe(true)
    // Voraus zählt wie zurück — beides ist Versatz.
    expect(lauf(-(VIDEO_DRIFT_PLAYING_S + 0.01)).seek).toBe(true)
  })

  it('überholt keinen laufenden Suchlauf', () => {
    // Der Sturm in einer Zeile: Das Ziel wandert weiter, also verlangt jeder
    // Frame den nächsten Sprung — und jeder neue bricht den vorigen ab.
    expect(lauf(3, { seeking: true }).seek).toBe(false)
  })

  it('springt im Lauf nicht in ungepufferte Daten', () => {
    expect(lauf(3, { readyState: VIDEO_HAS_FRAME }).seek).toBe(false)
    expect(lauf(3, { readyState: VIDEO_HAS_METADATA }).seek).toBe(false)
    expect(lauf(3, { readyState: 0 }).seek).toBe(false)
  })

  it('lässt zwischen zwei Suchläufen Wanduhr-Ruhe', () => {
    expect(lauf(3, { sinceSeekS: VIDEO_SEEK_COOLDOWN_S - 0.01 }).seek).toBe(false)
    expect(lauf(3, { sinceSeekS: VIDEO_SEEK_COOLDOWN_S }).seek).toBe(true)
  })

  // Im Stand führt der Finger. Dort IST die gesuchte Stelle das, was man sehen
  // will — also feine Schwelle, kein Warten auf Puffer, keine Ruhe; nur ein
  // laufender Suchlauf wird abgewartet, sonst käme keiner an.
  it('folgt im Stand fein und ohne Wartezeit', () => {
    const stand = (drift: number, mehr = {}) =>
      videoSeekDecision({
        targetS: 10,
        isS: 10 - drift,
        playing: false,
        paused: true,
        seeking: false,
        readyState: VIDEO_HAS_METADATA,
        sinceSeekS: 0,
        ...mehr,
      })
    expect(stand(VIDEO_DRIFT_PAUSED_S + 0.001).seek).toBe(true)
    expect(stand(VIDEO_DRIFT_PAUSED_S - 0.001).seek).toBe(false)
    expect(stand(1, { seeking: true }).seek).toBe(false)
    expect(stand(1, { readyState: 0 }).seek).toBe(false)
  })

  // Im Film gibt es keine Toleranz: Je Filmbild vergehen 0,3–2 s Wanduhr, ein
  // nebenher laufendes Video stünde beim Abgreifen irgendwo. Also steht es und
  // wird gesucht — dieselbe Regel wie im Stand.
  it('sucht für den Export jedes Bild und lässt das Video nie laufen', () => {
    const film = (drift: number, mehr = {}) => lauf(drift, { frameExact: true, ...mehr })
    expect(film(0.1).seek).toBe(true)
    expect(film(0.1).pause).toBe(true)
    expect(film(0.1, { paused: true }).play).toBe(false)
    // Auch hier gilt: einen laufenden Suchlauf abwarten.
    expect(film(0.1, { seeking: true }).seek).toBe(false)
    // Aber keine Wanduhr-Ruhe — sie käme aus einer Uhr, die der Film nicht hat.
    expect(film(0.1, { seitSuchlaufS: 0 }).seek).toBe(true)
  })

  it('startet nur im Lauf und hält nur außerhalb an', () => {
    expect(lauf(0, { paused: true }).play).toBe(true)
    expect(lauf(0).play).toBe(false)
    expect(lauf(0).pause).toBe(false)
    const aus = lauf(0, { playing: false })
    expect(aus.pause).toBe(true)
    expect(aus.play).toBe(false)
  })
})
