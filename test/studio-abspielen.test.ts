// Wiedergabe in der Zeitleiste: die reine Schrittlogik (src/studio/abspielen.ts).
// Die rAF-Schleife und der Ton hängen am DOM und bleiben hier außen vor —
// geprüft wird, was ohne Browser entscheidbar ist: wo die Marke nach einem
// Schritt steht, wann sie ruht und wann sie anhält.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  erzeugeAbspieler,
  klipsBei,
  musikVersatzS,
  tick,
  type SpielStand,
  type Spielplan,
} from '../src/studio/abspielen'
import type { Filmkurve } from '../src/studio/zeitleiste'

/** Tour, die bei 1× in 100 Sekunden durchläuft (lineare Kurve). */
const LINEAR_100: Filmkurve = { anteile: [0, 1], filmS: [0, 100], gesamtS: 100 }
/** Spielkurve mit Trim-Plateau: 50 s Film — Plateau — 50 s Film. */
const MIT_PAUSE: Filmkurve = { anteile: [0, 0.25, 0.75, 1], filmS: [0, 50, 50, 100], gesamtS: 100 }
const plan = (kurve: Filmkurve = LINEAR_100): Spielplan => ({ marke: 0, kurve, musik: [], klaenge: [] })
const stand = (teil: Partial<SpielStand> = {}): SpielStand => ({ marke: 0, tempo: 1, ...teil })

describe('tick — Fahrt', () => {
  it('bewegt die Marke im Filmtempo der Kurve', () => {
    const s = tick(stand(), 1, plan())
    expect(s.stand.marke).toBeCloseTo(0.01, 6)
    expect(s.vorher).toBe(0)
    expect(s.ende).toBe(false)
  })

  it('läuft im Schnelllauf schneller und rückwärts zurück', () => {
    expect(tick(stand({ tempo: 4 }), 1, plan()).stand.marke).toBeCloseTo(0.04, 6)
    expect(tick(stand({ marke: 0.5, tempo: -2 }), 1, plan()).stand.marke).toBeCloseTo(0.48, 6)
  })

  it('hält das Ende RICHTUNGSABHÄNGIG — ein Start bei 0 stoppt nicht sofort', () => {
    // Der erste Frame hat dt = 0. Prüfte man beide Ränder, träfe die Marke 0
    // die Bedingung „≤ 0" und die Wiedergabe wäre vorbei, bevor sie beginnt.
    const erster = tick(stand(), 0, plan())
    expect(erster.ende).toBe(false)
    expect(erster.stand.marke).toBe(0)

    expect(tick(stand({ marke: 0.99 }), 5, plan()).stand.marke).toBe(1)
    expect(tick(stand({ marke: 0.99 }), 5, plan()).ende).toBe(true)
    // rückwärts am Anfang
    expect(tick(stand({ marke: 0.01, tempo: -1 }), 5, plan()).ende).toBe(true)
    // rückwärts am ENDE ist kein Ende
    expect(tick(stand({ marke: 1, tempo: -1 }), 1, plan()).ende).toBe(false)
  })

  it('überspringt eine reale Pause in einem Wimpernschlag', () => {
    // Bei Marke 0,2 sind 40 Filmsekunden vergangen; 11 s später steckt die
    // Marke nicht in der Pause (0,25–0,75), sondern ist schon dahinter.
    const s = tick(stand({ marke: 0.2 }), 11, plan(MIT_PAUSE))
    expect(s.stand.marke).toBeCloseTo(0.755, 6)
  })

  it('springt aus der Mitte einer Pause nie rückwärts (Richtungsklemme)', () => {
    // Dorthin kommt man nur per Scrub. Der Kurven-Roundtrip lieferte den
    // Pausen-ANFANG — vorwärts darf die Marke davon nichts merken.
    const ruhend = tick(stand({ marke: 0.5 }), 0, plan(MIT_PAUSE))
    expect(ruhend.stand.marke).toBe(0.5)
    const weiter = tick(stand({ marke: 0.5 }), 1, plan(MIT_PAUSE))
    expect(weiter.stand.marke).toBeCloseTo(0.755, 6)
    // Rückwärts verlässt sie die Pause nach hinten
    const zurueck = tick(stand({ marke: 0.5, tempo: -1 }), 1, plan(MIT_PAUSE))
    expect(zurueck.stand.marke).toBeCloseTo(0.245, 6)
  })

  it('läuft auf einer nichtlinearen Kurve je Achsenstück verschieden schnell', () => {
    // Erste Achsenhälfte 20 Filmsekunden, zweite 80: nach 20 s steht die
    // Marke bei 0,5, nach weiteren 40 s bei 0,75.
    const kurve: Filmkurve = { anteile: [0, 0.5, 1], filmS: [0, 20, 100], gesamtS: 100 }
    expect(tick(stand(), 20, plan(kurve)).stand.marke).toBeCloseTo(0.5, 6)
    expect(tick(stand({ marke: 0.5 }), 40, plan(kurve)).stand.marke).toBeCloseTo(0.75, 6)
  })
})

describe('Musik', () => {
  const musik = [
    { von: 0.1, bis: 0.4, url: '/a.mp3', lautstaerke: 0.6 },
    { von: 0.6, bis: 1, url: '/b.mp3', lautstaerke: 0.5 },
  ]

  it('findet Bereiche halboffen [von, bis)', () => {
    expect(klipsBei(musik, 0.1)).toEqual([0])
    expect(klipsBei(musik, 0.39)).toEqual([0])
    expect(klipsBei(musik, 0.4)).toEqual([]) // Endgrenze gehört nicht mehr dazu
    expect(klipsBei(musik, 0.5)).toEqual([])
    expect(klipsBei(musik, 0.9)).toEqual([1])
  })

  it('liefert bei Überlappung ALLE Bereiche — sie mischen sich wie im Film', () => {
    const ueberlappend = [
      { von: 0, bis: 1, url: '/musik.mp3', lautstaerke: 0.8 },
      { von: 0.2, bis: 0.7, url: '/atmo.mp3', lautstaerke: 0.6 },
      // Dieselbe Datei ein zweites Mal: die Identität ist der Platz im Plan
      { von: 0.5, bis: 0.9, url: '/musik.mp3', lautstaerke: 0.4 },
    ]
    expect(klipsBei(ueberlappend, 0.1)).toEqual([0])
    expect(klipsBei(ueberlappend, 0.3)).toEqual([0, 1])
    expect(klipsBei(ueberlappend, 0.6)).toEqual([0, 1, 2])
    expect(klipsBei(ueberlappend, 0.8)).toEqual([0, 2])
  })

  it('setzt an der Stelle ein, die im fertigen Film liefe', () => {
    // Bereich beginnt bei 0,1; Einstieg bei 0,3 → 0,2 × 100 s Animationszeit
    expect(musikVersatzS(0.3, 0.1, LINEAR_100)).toBeCloseTo(20, 6)
    // Kürzere Datei läuft im Loop: 20 s in einer 8-s-Datei = 4 s
    expect(musikVersatzS(0.3, 0.1, LINEAR_100, 8)).toBeCloseTo(4, 6)
    // Am Anfang des Bereichs (und davor) von vorn
    expect(musikVersatzS(0.1, 0.1, LINEAR_100, 8)).toBe(0)
    expect(musikVersatzS(0.05, 0.1, LINEAR_100, 8)).toBe(0)
  })

  it('setzt am EINSTIEG an — der linke Trim verschiebt den Nullpunkt in der Datei', () => {
    // Wer die linke Kante 3 s nach innen zieht, will den Anfang loswerden: die
    // Datei beginnt hier bei 3, nicht bei 0.
    expect(musikVersatzS(0.1, 0.1, LINEAR_100, 30, 3)).toBeCloseTo(3, 6)
    expect(musikVersatzS(0.2, 0.1, LINEAR_100, 30, 3)).toBeCloseTo(13, 6)
  })

  it('Loop hebt nur den RECHTEN Anschlag auf — er springt auf den DATEIanfang', () => {
    // `el.loop` springt am Dateiende auf 0 zurück, nicht auf den Einstieg. Wer
    // hier stattdessen im Rest hinter dem Einstieg rechnet, lässt das Stück nach
    // dem ersten Durchlauf mitten drin einsetzen — vom Nutzer gefunden (docs §2E).
    // Einstieg 8 in einer 10-s-Datei: nach 2 Filmsekunden ist das Ende erreicht,
    // danach läuft die Datei von vorn.
    expect(musikVersatzS(0.02, 0, LINEAR_100, 10, 8)).toBeCloseTo(0, 6) // 8 + 2 = 10 → 0
    expect(musikVersatzS(0.05, 0, LINEAR_100, 10, 8)).toBeCloseTo(3, 6) // 8 + 5 = 13 → 3
  })

  it('ohne Loop bleibt die Position am Material stehen, statt vorn neu zu beginnen', () => {
    // Ein Effekt ohne Wiederholung (Zikaden) ist nach seiner Länge fertig. Das
    // Element ist dann `ended` und schweigt — es fängt nicht wieder an.
    expect(musikVersatzS(0.05, 0, LINEAR_100, 10, 0, false)).toBeCloseTo(5, 6)
    expect(musikVersatzS(0.3, 0, LINEAR_100, 10, 0, false)).toBe(10)
    expect(musikVersatzS(0.3, 0, LINEAR_100, 10, 4, false)).toBe(10)
  })

  it('bleibt für Bestandsdaten bei genau der alten Rechnung', () => {
    // Ohne Einstieg und mit Loop ist der neue Weg Zeichen für Zeichen der alte.
    for (const [anteil, dauer] of [[0.3, 8], [0.5, 30], [0.9, 12]] as const) {
      expect(musikVersatzS(anteil, 0.1, LINEAR_100, dauer)).toBeCloseTo(
        musikVersatzS(anteil, 0.1, LINEAR_100, dauer, 0, true),
        9,
      )
    }
  })

  it('zählt eine reale Pause im Bereich nicht als Spielzeit', () => {
    // Klip ab 0,2, Einstieg bei 0,8 — dazwischen liegt die Pause (0,25–0,75).
    // Im Film sind seit Klipbeginn 20 FAHR-Sekunden vergangen, nicht 60 % der
    // Achse: die alte lineare Rechnung lag hier um Minuten daneben.
    expect(musikVersatzS(0.8, 0.2, MIT_PAUSE)).toBeCloseTo(20, 6)
  })
})

describe('Drift-Wächter: geteilte Klang-Regel', () => {
  const modul = readFileSync(new URL('../src/studio/abspielen.ts', import.meta.url), 'utf8')

  it('das Studio benutzt die Auslöse-Regel des Players, keine eigene', () => {
    // Eine zweite, leicht andere Regel hieße: im Studio klingt es anders als im
    // fertigen Film — genau der Unterschied, den man hier prüfen will.
    expect(modul).toMatch(/import \{ sfxSollFeuern \} from '\.\.\/audiotracks\.js'/)
  })

  // Der zweite Wächter dieser Gruppe verglich die handgeschriebene
  // src/audiotracks.d.ts mit der JS-Signatur daneben — sie konnte stumm falsch
  // werden. Seit src/audiotracks.ts TypeScript ist, gibt es nur noch EINE
  // Signatur und `tsc` prüft sie; der Wächter ist ersatzlos entfallen.
})

describe('erzeugeAbspieler', () => {
  // Die Schleife braucht rAF und Audio; hier wird nur geprüft, dass der
  // Abspieler ohne Plan nicht losläuft und dass „anhalten" wirklich anhält.
  it('startet nicht, wenn es nichts abzuspielen gibt', () => {
    let tempoAnzeige = -1
    const a = erzeugeAbspieler({
      hole: () => null,
      setzeMarke: () => {},
      zeigeTempo: (t) => {
        tempoAnzeige = t
      },
    })
    a.setzeTempo(1)
    expect(a.laeuft()).toBe(false)
    expect(tempoAnzeige).toBe(-1) // gar keine Anzeige — es lief nie
    a.halteAn()
    expect(tempoAnzeige).toBe(0)
    expect(a.tempo()).toBe(0)
  })
})
