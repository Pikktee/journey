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
  SFX_KANTE_S,
  VIDEO_DUCK,
  VIDEO_FADE_S,
  videoTonHuelle,
  videoLautstaerke,
  videoMusikDuck,
} from '../src/audiotracks.js'
import { NOT_DECKEL_S } from '../src/filmuhr.js'

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

describe('istAktiv (Musik-Bereich [filmVonS, filmBisS))', () => {
  // Gerechnet wird in FILMSEKUNDEN (E10): Ein Bereich, der ganz in einer
  // Standzeit liegt, hat dort eine Länge — im Streckenanteil hätte er keine.
  const spur = { filmVonS: 20, filmBisS: 60 }

  it('ist innerhalb des Bereichs aktiv', () => {
    expect(istAktiv(spur, 40)).toBe(true)
  })

  it('schließt die Startgrenze ein, die Endgrenze aus (halboffen)', () => {
    expect(istAktiv(spur, 20)).toBe(true)
    expect(istAktiv(spur, 60)).toBe(false)
  })

  it('ist außerhalb inaktiv', () => {
    expect(istAktiv(spur, 10)).toBe(false)
    expect(istAktiv(spur, 90)).toBe(false)
  })

  it('deckt einen Klip AB, der ganz in einer Standzeit liegt', () => {
    // Der Fall, um den es in E10 geht: Der Halt beginnt bei Filmsekunde 100 und
    // dauert 5,2 s; der Klip setzt 2 s hinein ein. Im Streckenanteil wäre
    // f0 === f1 (die Strecke steht) und die Spur bliebe stumm.
    const imHalt = { filmVonS: 102, filmBisS: 105.2 }
    expect(istAktiv(imHalt, 101.9)).toBe(false)
    expect(istAktiv(imHalt, 102)).toBe(true)
    expect(istAktiv(imHalt, 104)).toBe(true)
    expect(istAktiv(imHalt, 105.2)).toBe(false)
  })

  it('deckt „Musik bis zum Ende" ab (Filmende: davor aktiv, darauf nicht)', () => {
    const bisEnde = { filmVonS: 300, filmBisS: 640 }
    expect(istAktiv(bisEnde, 639.9)).toBe(true)
    expect(istAktiv(bisEnde, 640)).toBe(false) // exakt am Ziel: Finale übernimmt
  })
})

describe('sfxSollFeuern (One-Shot-Kante über die Filmsekunde)', () => {
  it('feuert beim Vorwärts-Überfahren mit Frame-kleiner Sprungweite', () => {
    expect(sfxSollFeuern(119.98, 120.02, 120, true)).toBe(true)
  })

  it('feuert auch, wenn der Schritt exakt auf die Marke landet', () => {
    expect(sfxSollFeuern(119.98, 120, 120, true)).toBe(true)
  })

  it('feuert NICHT ohne Wiedergabe (Scrub/Seek: istPlayback false)', () => {
    expect(sfxSollFeuern(119.98, 120.02, 120, false)).toBe(false)
  })

  it('feuert NICHT bei Sprüngen ab SFX_KANTE_S (Seek quer über die Marke)', () => {
    expect(sfxSollFeuern(118, 122, 120, true)).toBe(false)
    // knapp unter der Schwelle feuert noch
    expect(sfxSollFeuern(120 - SFX_KANTE_S + 0.001, 120, 120, true)).toBe(true)
  })

  it('lässt das längste reale Frame durch — die Schwelle ist der Notdeckel', () => {
    // Die 0,02 der frac-Fassung waren 2 % der TOUR (auf Koh Pha-ngan ~4,4 s);
    // naiv als „0,02 s" übernommen hätte sie jedes Frame verschluckt. Gemessen
    // sind 205 ms bei 12× Drosselung das schlechteste Frame, und weiter als
    // NOT_DECKEL_S kann ein Frame die Filmzeit gar nicht tragen.
    expect(SFX_KANTE_S).toBe(NOT_DECKEL_S)
    expect(sfxSollFeuern(119.9, 120.105, 120, true)).toBe(true) // 205-ms-Frame
  })

  it('feuert NICHT rückwärts über die Marke', () => {
    expect(sfxSollFeuern(120.02, 119.98, 120, true)).toBe(false)
  })

  it('feuert NICHT erneut, wenn die Marke schon passiert ist', () => {
    // vorher wird nach jedem Aufruf hart nachgezogen — hinter der Marke ist Ruhe
    expect(sfxSollFeuern(120, 120.02, 120, true)).toBe(false)
    expect(sfxSollFeuern(120.5, 120.52, 120, true)).toBe(false)
  })

  it('feuert bei Filmsekunde 0 beim ersten Vorwärts-Tick aus der Nullposition', () => {
    // Sonderfall: „vorher < 0" gibt es nie — die Start-Marke feuert stattdessen,
    // sobald der Playhead die 0 verlässt
    expect(sfxSollFeuern(0, 0.016, 0, true)).toBe(true)
  })

  it('feuert bei Filmsekunde 0 NICHT im Stillstand und nicht ohne Wiedergabe', () => {
    expect(sfxSollFeuern(0, 0, 0, true)).toBe(false)
    expect(sfxSollFeuern(0, 0.016, 0, false)).toBe(false)
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
    // ein Punkt und läuft weiter über die Kantenerkennung.
    expect(hatBereich({ filmVonS: 20, filmBisS: 60 })).toBe(true)
    expect(hatBereich({ filmVonS: 40, filmBisS: 40 })).toBe(false)
  })

  it('sieht die Länge eines Klips, der ganz in einer Standzeit liegt', () => {
    // Genau der Klip, den enrich.ts bis E10 mit „liegt ganz in einer Standzeit"
    // verworfen hat — in Filmzeit gemessen hat er 3,2 Sekunden.
    expect(hatBereich({ filmVonS: 102, filmBisS: 105.2 })).toBe(true)
  })
})
