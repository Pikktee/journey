// Tour-Audio (src/audiotracks.ts): getestet werden NUR die reinen, DOM-freien
// Helfer — createAudioTracks braucht window/Audio und läuft nur im Browser
// (Vitest läuft in Node). Die Kantenerkennung ist die eigentliche Logik:
// Musik-Bereiche als halboffene Intervalle, SFX nur beim echten Vorwärts-Überfahren.

import { describe, expect, it } from 'vitest'
// audiotracks.js ist BEWUSST JS im Stil der Nachbarn music.js/vehicle.js;
// tsconfig (allowJs: false) kennt dafür keine Typen — Import daher ungeprüft.
// @ts-ignore
import {
  hatBereich,
  istAktiv,
  loopAktiv,
  sfxSollFeuern,
  VIDEO_DUCK,
  VIDEO_FADE_S,
  videoTonHuelle,
  videoLautstaerke,
  videoMusikDuck,
} from '../src/audiotracks.js'

describe('VIDEO_DUCK (Default-Ducking bei Video-Ton)', () => {
  it('liegt als hörbare Absenkung zwischen still und voll', () => {
    expect(VIDEO_DUCK).toBeGreaterThan(0)
    expect(VIDEO_DUCK).toBeLessThan(0.5)
  })
})

describe('videoTonHuelle (Ein-/Ausblende über die Videodauer)', () => {
  it('ist am Anfang 0 und steigt über die Fade-Dauer auf 1', () => {
    expect(videoTonHuelle(0, 10, 2)).toBe(0)
    expect(videoTonHuelle(1, 10, 2)).toBeCloseTo(0.5, 6)
    expect(videoTonHuelle(2, 10, 2)).toBe(1)
    expect(videoTonHuelle(5, 10, 2)).toBe(1)
  })

  it('fällt zum Ende über die Fade-Dauer auf 0', () => {
    expect(videoTonHuelle(8, 10, 2)).toBe(1)
    expect(videoTonHuelle(9, 10, 2)).toBeCloseTo(0.5, 6)
    expect(videoTonHuelle(10, 10, 2)).toBe(0)
  })

  it('klemmt die Fade-Dauer auf höchstens die Hälfte bei kurzen Clips', () => {
    // dauer=2, fadeS=2 → effektiv 1 s Ein und 1 s Aus, Plateau entfällt
    expect(videoTonHuelle(0, 2, 2)).toBe(0)
    expect(videoTonHuelle(1, 2, 2)).toBe(1)
    expect(videoTonHuelle(2, 2, 2)).toBe(0)
  })

  it('liefert 0 ohne gültige Dauer oder außerhalb', () => {
    expect(videoTonHuelle(1, 0)).toBe(0)
    expect(videoTonHuelle(-0.1, 10)).toBe(0)
    expect(videoTonHuelle(10.1, 10)).toBe(0)
  })

  it('nutzt VIDEO_FADE_S als Default', () => {
    expect(VIDEO_FADE_S).toBeGreaterThan(0.5)
    expect(videoTonHuelle(VIDEO_FADE_S, 30)).toBe(1)
    expect(videoTonHuelle(VIDEO_FADE_S / 2, 30)).toBeCloseTo(0.5, 6)
  })
})

describe('Equal-Power-Crossfade (Video ↔ Musik)', () => {
  it('lässt Video bei Hülle 0 still und Musik voll', () => {
    expect(videoLautstaerke(0)).toBeCloseTo(0, 6)
    expect(videoMusikDuck(0)).toBeCloseTo(1, 6)
  })

  it('lässt Video bei Hülle 1 voll und Musik auf VIDEO_DUCK', () => {
    expect(videoLautstaerke(1)).toBeCloseTo(1, 6)
    expect(videoMusikDuck(1)).toBeCloseTo(VIDEO_DUCK, 6)
  })

  it('hält die Equal-Power-Summe bei mittlerer Hülle ungefähr konstant', () => {
    // sin²+cos² = 1; Musik sitzt auf VIDEO_DUCK+(1-VIDEO_DUCK)*cos —
    // die Video-Kurve allein ist sin; bei g=0.5 ist sin≈cos≈√2/2
    const g = 0.5
    expect(videoLautstaerke(g)).toBeCloseTo(Math.SQRT1_2, 6)
    expect(videoMusikDuck(g)).toBeCloseTo(VIDEO_DUCK + (1 - VIDEO_DUCK) * Math.SQRT1_2, 6)
  })
})

describe('istAktiv (Musik-Bereich [f0,f1))', () => {
  const spur = { f0: 0.2, f1: 0.6 }

  it('ist innerhalb des Bereichs aktiv', () => {
    expect(istAktiv(spur, 0.4)).toBe(true)
  })

  it('schließt die Startgrenze ein, die Endgrenze aus (halboffen)', () => {
    expect(istAktiv(spur, 0.2)).toBe(true)
    expect(istAktiv(spur, 0.6)).toBe(false)
  })

  it('ist außerhalb inaktiv', () => {
    expect(istAktiv(spur, 0.1)).toBe(false)
    expect(istAktiv(spur, 0.9)).toBe(false)
  })

  it('deckt „Musik bis zum Ende“ ab (f1 = 1: frac < 1 bleibt aktiv)', () => {
    const bisEnde = { f0: 0.5, f1: 1 }
    expect(istAktiv(bisEnde, 0.999)).toBe(true)
    expect(istAktiv(bisEnde, 1)).toBe(false) // exakt am Ziel: Finale übernimmt
  })
})

describe('sfxSollFeuern (One-Shot-Kante über f0)', () => {
  it('feuert beim Vorwärts-Überfahren mit Frame-kleiner Sprungweite', () => {
    expect(sfxSollFeuern(0.499, 0.5005, 0.5, true)).toBe(true)
  })

  it('feuert auch, wenn der Schritt exakt auf f0 landet', () => {
    expect(sfxSollFeuern(0.499, 0.5, 0.5, true)).toBe(true)
  })

  it('feuert NICHT ohne Wiedergabe (Scrub/Seek: istPlayback false)', () => {
    expect(sfxSollFeuern(0.499, 0.5005, 0.5, false)).toBe(false)
  })

  it('feuert NICHT bei Sprüngen ≥ 0.02 (Seek quer über die Marke)', () => {
    expect(sfxSollFeuern(0.4, 0.6, 0.5, true)).toBe(false)
    // knapp unter der Schwelle feuert noch
    expect(sfxSollFeuern(0.49, 0.5, 0.5, true)).toBe(true)
  })

  it('feuert NICHT rückwärts über die Marke', () => {
    expect(sfxSollFeuern(0.5005, 0.499, 0.5, true)).toBe(false)
  })

  it('feuert NICHT erneut, wenn die Marke schon passiert ist', () => {
    // vorher wird nach jedem Aufruf hart nachgezogen — hinter f0 ist Ruhe
    expect(sfxSollFeuern(0.5, 0.5005, 0.5, true)).toBe(false)
    expect(sfxSollFeuern(0.51, 0.511, 0.5, true)).toBe(false)
  })

  it('feuert bei f0=0 beim ersten Vorwärts-Tick aus der Nullposition', () => {
    // Sonderfall: „vorher < 0" gibt es nie — die Start-Marke feuert stattdessen,
    // sobald der Playhead die 0 verlässt
    expect(sfxSollFeuern(0, 0.001, 0, true)).toBe(true)
  })

  it('feuert bei f0=0 NICHT im Stillstand auf der Null und nicht ohne Wiedergabe', () => {
    expect(sfxSollFeuern(0, 0, 0, true)).toBe(false)
    expect(sfxSollFeuern(0, 0.001, 0, false)).toBe(false)
  })
})

describe('loopAktiv (Etappe 4: Wiederholung aus dem Overlay)', () => {
  it('bildet ohne Angabe das bisherige Verhalten ab', () => {
    // Musik lief immer geloopt (`el.loop = true`), ein Effekt war ein One-Shot.
    // Ein Tour-JSON von vor Etappe 4 klingt dadurch exakt wie vorher.
    expect(loopAktiv({ type: 'music' })).toBe(true)
    expect(loopAktiv({ type: 'sfx' })).toBe(false)
  })

  it('lässt sich in beide Richtungen übersteuern', () => {
    expect(loopAktiv({ type: 'music', loop: false })).toBe(false) // Musik, die einmal läuft
    expect(loopAktiv({ type: 'sfx', loop: true })).toBe(true) // Brandung statt Zikaden
  })
})

describe('hatBereich (Klip oder Marke?)', () => {
  it('entscheidet an der Ausdehnung, nicht am Typ', () => {
    // Seit Etappe 4 darf auch ein Effekt eine Länge haben; ein One-Shot bleibt
    // ein Punkt (f0 === f1) und läuft weiter über die Kantenerkennung.
    expect(hatBereich({ f0: 0.2, f1: 0.6 })).toBe(true)
    expect(hatBereich({ f0: 0.4, f1: 0.4 })).toBe(false)
  })
})
