// Wiedergabe in der Zeitleiste: die reine Schrittlogik (src/studio/abspielen.ts).
// Die rAF-Schleife und der Ton hängen am DOM und bleiben hier außen vor —
// geprüft wird, was ohne Browser entscheidbar ist: wo die Marke nach einem
// Schritt steht, wann sie ruht und wann sie anhält.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  erzeugeAbspieler,
  klipBei,
  musikVersatzS,
  tick,
  ueberquert,
  type Halt,
  type SpielStand,
  type Spielplan,
} from '../src/studio/abspielen'

/** Tour, die bei 1× in 100 Sekunden durchläuft. */
const plan = (halte: Halt[] = []): Spielplan => ({ marke: 0, rate: 1 / 100, halte, musik: [], klaenge: [] })
const stand = (teil: Partial<SpielStand> = {}): SpielStand => ({ marke: 0, tempo: 1, restS: 0, folge: [], ...teil })

describe('tick — Fahrt', () => {
  it('bewegt die Marke mit Tempo × Rate', () => {
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
})

describe('tick — Halte an den Aufnahmen', () => {
  const halt = (anteil: number, ...dauern: number[]): Halt => ({
    anteil,
    fotos: dauern.map((dauerS, i) => ({ id: `m${i + 1}`, dauerS })),
  })

  it('hält AM Halt an und blendet die erste Aufnahme ein', () => {
    const s = tick(stand(), 1, plan([halt(0.005, 5)]))
    // Die Marke springt exakt auf den Halt — stünde sie dahinter, gälte er beim
    // Weiterfahren als noch nicht passiert.
    expect(s.stand.marke).toBe(0.005)
    expect(s.zeige?.id).toBe('m1')
    expect(s.stand.restS).toBe(5)
    expect(s.ende).toBe(false)
  })

  it('ruht, bis die Standzeit um ist, und fährt dann weiter', () => {
    let s = tick(stand(), 1, plan([halt(0.005, 5)]))
    const beiHalt = s.stand.marke
    s = tick(s.stand, 3, plan([halt(0.005, 5)]))
    expect(s.stand.marke).toBe(beiHalt) // Position gehalten
    expect(s.stand.restS).toBeCloseTo(2, 6)
    expect(s.zeige).toBeNull()
    // Der Rest des Schritts fährt schon wieder: 2 s Halt + 1 s Fahrt
    s = tick(s.stand, 3, plan([halt(0.005, 5)]))
    expect(s.stand.restS).toBe(0)
    expect(s.stand.marke).toBeCloseTo(0.005 + 0.01, 6)
  })

  it('zeigt die Aufnahmen eines Halts NACHEINANDER', () => {
    // Drei Bilder am selben Ort liegen auf derselben Zeit — nur die erste würde
    // je „überquert", die anderen kämen ohne Warteschlange nie vor.
    const p = plan([halt(0.005, 4, 3, 2)])
    let s = tick(stand(), 1, p)
    expect(s.zeige?.id).toBe('m1')
    expect(s.stand.folge.map((f) => f.id)).toEqual(['m2', 'm3'])
    s = tick(s.stand, 4, p)
    expect(s.zeige?.id).toBe('m2')
    expect(s.stand.restS).toBeCloseTo(3, 6)
    s = tick(s.stand, 3, p)
    expect(s.zeige?.id).toBe('m3')
    s = tick(s.stand, 3, p) // 2 s Standzeit + 1 s Fahrt
    expect(s.zeige).toBeNull()
    expect(s.stand.restS).toBe(0)
    expect(s.stand.marke).toBeGreaterThan(0.005) // fährt wieder
  })

  it('nimmt den ERSTEN überfahrenen Halt, auch wenn ein Schritt zwei trifft', () => {
    const s = tick(stand(), 10, plan([halt(0.08, 5), halt(0.02, 5)]))
    expect(s.stand.marke).toBe(0.02)
    expect(s.zeige?.id).toBe('m1')
  })

  it('hält nur bei normaler Vorwärtsfahrt — nicht im Schnelllauf, nicht rückwärts', () => {
    const p = plan([halt(0.02, 5)])
    expect(tick(stand({ tempo: 2 }), 10, p).zeige).toBeNull()
    expect(tick(stand({ marke: 0.5, tempo: -1 }), 100, p).zeige).toBeNull()
  })

  it('überspringt einen Halt ohne Aufnahmen (leere Gruppe)', () => {
    const s = tick(stand(), 1, plan([{ anteil: 0.005, fotos: [] }]))
    expect(s.zeige).toBeNull()
    expect(s.stand.marke).toBeCloseTo(0.01, 6)
  })

  it('macht denselben Halt nicht zweimal', () => {
    const p = plan([halt(0.005, 1)])
    let s = tick(stand(), 1, p)
    s = tick(s.stand, 2, p) // Standzeit vorbei, fährt weiter
    expect(s.stand.marke).toBeGreaterThan(0.005)
    s = tick(s.stand, 1, p)
    expect(s.zeige).toBeNull()
  })
})

describe('ueberquert', () => {
  it('erkennt die Kante in beide Richtungen, aber nicht im Stillstand', () => {
    expect(ueberquert(0.5, 0.4, 0.6)).toBe(true)
    expect(ueberquert(0.5, 0.6, 0.4)).toBe(true)
    expect(ueberquert(0.5, 0.5, 0.5)).toBe(false)
    expect(ueberquert(0.5, 0.1, 0.2)).toBe(false)
    // Halboffen, damit dieselbe Marke nicht zweimal auslöst: erreicht zählt,
    // verlassen nicht. Wer schon auf ihr stand, überquert sie nicht noch einmal.
    expect(ueberquert(0.5, 0.4, 0.5)).toBe(true)
    expect(ueberquert(0.5, 0.5, 0.4)).toBe(false)
    expect(ueberquert(0.5, 0.6, 0.5)).toBe(true)
  })
})

describe('Musik', () => {
  const musik = [
    { von: 0.1, bis: 0.4, url: '/a.mp3', lautstaerke: 0.6 },
    { von: 0.6, bis: 1, url: '/b.mp3', lautstaerke: 0.5 },
  ]

  it('findet den Bereich halboffen [von, bis)', () => {
    expect(klipBei(musik, 0.1)?.url).toBe('/a.mp3')
    expect(klipBei(musik, 0.39)?.url).toBe('/a.mp3')
    expect(klipBei(musik, 0.4)).toBeNull() // Endgrenze gehört nicht mehr dazu
    expect(klipBei(musik, 0.5)).toBeNull()
    expect(klipBei(musik, 0.9)?.url).toBe('/b.mp3')
  })

  it('setzt an der Stelle ein, die im fertigen Film liefe', () => {
    // Bereich beginnt bei 0,1; Einstieg bei 0,3 → 0,2 × 100 s Animationszeit
    expect(musikVersatzS(0.3, 0.1, 1 / 100)).toBeCloseTo(20, 6)
    // Kürzere Datei läuft im Loop: 20 s in einer 8-s-Datei = 4 s
    expect(musikVersatzS(0.3, 0.1, 1 / 100, 8)).toBeCloseTo(4, 6)
    // Am Anfang des Bereichs (und davor) von vorn
    expect(musikVersatzS(0.1, 0.1, 1 / 100, 8)).toBe(0)
    expect(musikVersatzS(0.05, 0.1, 1 / 100, 8)).toBe(0)
  })
})

describe('Drift-Wächter: geteilte Klang-Regel', () => {
  const js = readFileSync(new URL('../src/audiotracks.js', import.meta.url), 'utf8')
  const dts = readFileSync(new URL('../src/audiotracks.d.ts', import.meta.url), 'utf8')
  const modul = readFileSync(new URL('../src/studio/abspielen.ts', import.meta.url), 'utf8')

  it('das Studio benutzt die Auslöse-Regel des Players, keine eigene', () => {
    // Eine zweite, leicht andere Regel hieße: im Studio klingt es anders als im
    // fertigen Film — genau der Unterschied, den man hier prüfen will.
    expect(modul).toMatch(/import \{ sfxSollFeuern \} from '\.\.\/audiotracks\.js'/)
  })

  it('die Typdeklaration deckt sich mit der JS-Signatur', () => {
    // audiotracks.js ist Vanilla-JS (allowJs ist aus), die .d.ts also von Hand
    // geschrieben — sie könnte stumm falsch werden.
    const namen = (liste: string): string[] =>
      liste
        .split(',')
        .map((p) => (p.split(':')[0] as string).trim())
        .filter(Boolean)
    for (const name of ['istAktiv', 'sfxSollFeuern']) {
      const inJs = new RegExp(`export function ${name}\\(([^)]*)\\)`).exec(js)
      const inDts = new RegExp(`export function ${name}\\(([^)]*)\\)`).exec(dts)
      expect(inJs, `${name} fehlt in src/audiotracks.js`).not.toBeNull()
      expect(inDts, `${name} fehlt in src/audiotracks.d.ts`).not.toBeNull()
      expect(namen(inDts?.[1] ?? '')).toEqual(namen(inJs?.[1] ?? ''))
    }
  })
})

describe('erzeugeAbspieler', () => {
  // Die Schleife braucht rAF und Audio; hier wird nur geprüft, dass der
  // Abspieler ohne Plan nicht losläuft und dass „anhalten" wirklich anhält.
  it('startet nicht, wenn es nichts abzuspielen gibt', () => {
    let tempoAnzeige = -1
    const a = erzeugeAbspieler({
      hole: () => null,
      setzeMarke: () => {},
      zeigeFoto: () => {},
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
