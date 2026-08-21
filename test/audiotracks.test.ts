// Tour-Audio (src/audiotracks.ts): getestet werden NUR die reinen, DOM-freien
// Helfer — createAudioTracks braucht window/Audio und läuft nur im Browser
// (Vitest läuft in Node). Die Kantenerkennung ist die eigentliche Logik:
// Musik-Bereiche als halboffene Intervalle, SFX nur beim echten Vorwärts-Überfahren.

import { describe, expect, it } from 'vitest'
// audiotracks.js ist BEWUSST JS im Stil der Nachbarn music.js/vehicle.js;
// tsconfig (allowJs: false) kennt dafür keine Typen — Import daher ungeprüft.
// @ts-ignore
import {
  hasRange,
  isActive,
  loopEnabled,
  sfxShouldFire,
  SFX_EDGE_S,
  VIDEO_DUCK,
  VIDEO_FADE_S,
  videoVolumeEnvelope,
  rampedVolume,
  VIDEO_VOLUME_PER_S,
  videoVolume,
  musicDuck,
} from '../src/audiotracks.js'
import { FRAME_CAP_S } from '../src/film-clock.js'

describe('VIDEO_DUCK (Default-Ducking bei Video-Ton)', () => {
  it('liegt als hörbare Absenkung zwischen still und voll', () => {
    expect(VIDEO_DUCK).toBeGreaterThan(0)
    expect(VIDEO_DUCK).toBeLessThan(0.5)
  })
})

describe('videoTonHuelle (Ein-/Ausblende über die Videodauer)', () => {
  it('ist am Anfang 0 und steigt über die Fade-Dauer auf 1', () => {
    expect(videoVolumeEnvelope(0, 10, 2)).toBe(0)
    expect(videoVolumeEnvelope(1, 10, 2)).toBeCloseTo(0.5, 6)
    expect(videoVolumeEnvelope(2, 10, 2)).toBe(1)
    expect(videoVolumeEnvelope(5, 10, 2)).toBe(1)
  })

  it('fällt zum Ende über die Fade-Dauer auf 0', () => {
    expect(videoVolumeEnvelope(8, 10, 2)).toBe(1)
    expect(videoVolumeEnvelope(9, 10, 2)).toBeCloseTo(0.5, 6)
    expect(videoVolumeEnvelope(10, 10, 2)).toBe(0)
  })

  it('klemmt die Fade-Dauer auf höchstens die Hälfte bei kurzen Clips', () => {
    // dauer=2, fadeS=2 → effektiv 1 s Ein und 1 s Aus, Plateau entfällt
    expect(videoVolumeEnvelope(0, 2, 2)).toBe(0)
    expect(videoVolumeEnvelope(1, 2, 2)).toBe(1)
    expect(videoVolumeEnvelope(2, 2, 2)).toBe(0)
  })

  it('liefert 0 ohne gültige Dauer oder außerhalb', () => {
    expect(videoVolumeEnvelope(1, 0)).toBe(0)
    expect(videoVolumeEnvelope(-0.1, 10)).toBe(0)
    expect(videoVolumeEnvelope(10.1, 10)).toBe(0)
  })

  it('nutzt VIDEO_FADE_S als Default', () => {
    expect(VIDEO_FADE_S).toBeGreaterThan(0.5)
    expect(videoVolumeEnvelope(VIDEO_FADE_S, 30)).toBe(1)
    expect(videoVolumeEnvelope(VIDEO_FADE_S / 2, 30)).toBeCloseTo(0.5, 6)
  })
})

describe('Equal-Power-Crossfade (Video ↔ Musik)', () => {
  it('lässt Video bei Hülle 0 still und Musik voll', () => {
    expect(videoVolume(0)).toBeCloseTo(0, 6)
    expect(musicDuck(0)).toBeCloseTo(1, 6)
  })

  it('lässt Video bei Hülle 1 voll und Musik auf VIDEO_DUCK', () => {
    expect(videoVolume(1)).toBeCloseTo(1, 6)
    expect(musicDuck(1)).toBeCloseTo(VIDEO_DUCK, 6)
  })

  it('hält die Equal-Power-Summe bei mittlerer Hülle ungefähr konstant', () => {
    // sin²+cos² = 1; Musik sitzt auf VIDEO_DUCK+(1-VIDEO_DUCK)*cos —
    // die Video-Kurve allein ist sin; bei g=0.5 ist sin≈cos≈√2/2
    const g = 0.5
    expect(videoVolume(g)).toBeCloseTo(Math.SQRT1_2, 6)
    expect(musicDuck(g)).toBeCloseTo(VIDEO_DUCK + (1 - VIDEO_DUCK) * Math.SQRT1_2, 6)
  })
})

describe('istAktiv (Musik-Bereich [filmVonS, filmBisS))', () => {
  // Gerechnet wird in FILMSEKUNDEN (E10): Ein Bereich, der ganz in einer
  // Standzeit liegt, hat dort eine Länge — im Streckenanteil hätte er keine.
  const spur = { filmFromS: 20, filmToS: 60 }

  it('ist innerhalb des Bereichs aktiv', () => {
    expect(isActive(spur, 40)).toBe(true)
  })

  it('schließt die Startgrenze ein, die Endgrenze aus (halboffen)', () => {
    expect(isActive(spur, 20)).toBe(true)
    expect(isActive(spur, 60)).toBe(false)
  })

  it('ist außerhalb inaktiv', () => {
    expect(isActive(spur, 10)).toBe(false)
    expect(isActive(spur, 90)).toBe(false)
  })

  it('deckt einen Klip AB, der ganz in einer Standzeit liegt', () => {
    // Der Fall, um den es in E10 geht: Der Halt beginnt bei Filmsekunde 100 und
    // dauert 5,2 s; der Klip setzt 2 s hinein ein. Im Streckenanteil wäre
    // f0 === f1 (die Strecke steht) und die Spur bliebe stumm.
    const imHalt = { filmFromS: 102, filmToS: 105.2 }
    expect(isActive(imHalt, 101.9)).toBe(false)
    expect(isActive(imHalt, 102)).toBe(true)
    expect(isActive(imHalt, 104)).toBe(true)
    expect(isActive(imHalt, 105.2)).toBe(false)
  })

  it('deckt „Musik bis zum Ende" ab (Filmende: davor aktiv, darauf nicht)', () => {
    const bisEnde = { filmFromS: 300, filmToS: 640 }
    expect(isActive(bisEnde, 639.9)).toBe(true)
    expect(isActive(bisEnde, 640)).toBe(false) // exakt am Ziel: Finale übernimmt
  })
})

describe('sfxSollFeuern (One-Shot-Kante über die Filmsekunde)', () => {
  it('feuert beim Vorwärts-Überfahren mit Frame-kleiner Sprungweite', () => {
    expect(sfxShouldFire(119.98, 120.02, 120, true)).toBe(true)
  })

  it('feuert auch, wenn der Schritt exakt auf die Marke landet', () => {
    expect(sfxShouldFire(119.98, 120, 120, true)).toBe(true)
  })

  it('feuert NICHT ohne Wiedergabe (Scrub/Seek: istPlayback false)', () => {
    expect(sfxShouldFire(119.98, 120.02, 120, false)).toBe(false)
  })

  it('feuert NICHT bei Sprüngen ab SFX_KANTE_S (Seek quer über die Marke)', () => {
    expect(sfxShouldFire(118, 122, 120, true)).toBe(false)
    // knapp unter der Schwelle feuert noch
    expect(sfxShouldFire(120 - SFX_EDGE_S + 0.001, 120, 120, true)).toBe(true)
  })

  it('lässt das längste reale Frame durch — die Schwelle ist der Notdeckel', () => {
    // Die 0,02 der frac-Fassung waren 2 % der TOUR (auf Koh Pha-ngan ~4,4 s);
    // naiv als „0,02 s" übernommen hätte sie jedes Frame verschluckt. Gemessen
    // sind 205 ms bei 12× Drosselung das schlechteste Frame, und weiter als
    // NOT_DECKEL_S kann ein Frame die Filmzeit gar nicht tragen.
    expect(SFX_EDGE_S).toBe(FRAME_CAP_S)
    expect(sfxShouldFire(119.9, 120.105, 120, true)).toBe(true) // 205-ms-Frame
  })

  it('feuert NICHT rückwärts über die Marke', () => {
    expect(sfxShouldFire(120.02, 119.98, 120, true)).toBe(false)
  })

  it('feuert NICHT erneut, wenn die Marke schon passiert ist', () => {
    // vorher wird nach jedem Aufruf hart nachgezogen — hinter der Marke ist Ruhe
    expect(sfxShouldFire(120, 120.02, 120, true)).toBe(false)
    expect(sfxShouldFire(120.5, 120.52, 120, true)).toBe(false)
  })

  it('feuert bei Filmsekunde 0 beim ersten Vorwärts-Tick aus der Nullposition', () => {
    // Sonderfall: „vorher < 0" gibt es nie — die Start-Marke feuert stattdessen,
    // sobald der Playhead die 0 verlässt
    expect(sfxShouldFire(0, 0.016, 0, true)).toBe(true)
  })

  it('feuert bei Filmsekunde 0 NICHT im Stillstand und nicht ohne Wiedergabe', () => {
    expect(sfxShouldFire(0, 0, 0, true)).toBe(false)
    expect(sfxShouldFire(0, 0.016, 0, false)).toBe(false)
  })
})

describe('loopAktiv (Etappe 4: Wiederholung aus dem Overlay)', () => {
  it('bildet ohne Angabe das bisherige Verhalten ab', () => {
    // Musik lief immer geloopt (`el.loop = true`), ein Effekt war ein One-Shot.
    // Ein Tour-JSON von vor Etappe 4 klingt dadurch exakt wie vorher.
    expect(loopEnabled({ type: 'music' })).toBe(true)
    expect(loopEnabled({ type: 'sfx' })).toBe(false)
  })

  it('lässt sich in beide Richtungen übersteuern', () => {
    expect(loopEnabled({ type: 'music', loop: false })).toBe(false) // Musik, die einmal läuft
    expect(loopEnabled({ type: 'sfx', loop: true })).toBe(true) // Brandung statt Zikaden
  })
})

describe('hatBereich (Klip oder Marke?)', () => {
  it('entscheidet an der Ausdehnung, nicht am Typ', () => {
    // Seit Etappe 4 darf auch ein Effekt eine Länge haben; ein One-Shot bleibt
    // ein Punkt und läuft weiter über die Kantenerkennung.
    expect(hasRange({ filmFromS: 20, filmToS: 60 })).toBe(true)
    expect(hasRange({ filmFromS: 40, filmToS: 40 })).toBe(false)
  })

  it('sieht die Länge eines Klips, der ganz in einer Standzeit liegt', () => {
    // Genau der Klip, den enrich.ts bis E10 mit „liegt ganz in einer Standzeit"
    // verworfen hat — in Filmzeit gemessen hat er 3,2 Sekunden.
    expect(hasRange({ filmFromS: 102, filmToS: 105.2 })).toBe(true)
  })
})

describe('gerampterPegel (Knacks-Schutz des Video-Tons)', () => {
  it('lässt den Pegel stehen, solange keine Zeit vergangen ist', () => {
    // Der Export ruft je Filmbild auf, ohne dass eine Wanduhr die Rampe führte —
    // dort setzt ui.ts den Zielwert selbst, hier darf nichts kriechen.
    expect(rampedVolume(0.3, 1, 0)).toBeCloseTo(0.3, 6)
    expect(rampedVolume(0.3, 1, -1)).toBeCloseTo(0.3, 6)
  })

  it('deckelt den Sprung eines verspätet anlaufenden Videos', () => {
    // Genau der Knackser: Die Hülle steht schon bei 1, weil die Filmzeit
    // weiterlief, während die Datei noch lud. Ein Frame darf davon nur ein
    // Stück nehmen.
    expect(rampedVolume(0, 1, 1 / 60)).toBeCloseTo(VIDEO_VOLUME_PER_S / 60, 6)
  })

  it('zählt einen Ruckler nur bis zum Deckel', () => {
    // 0,5 s Frame-Lücke: ohne Deckel wäre die Rampe übersprungen.
    expect(rampedVolume(0, 1, 0.5)).toBeCloseTo(VIDEO_VOLUME_PER_S * 0.05, 6)
  })

  it('kommt in rund 125 ms an und schießt nicht über', () => {
    let p = 0
    for (let i = 0; i < 8; i++) p = rampedVolume(p, 1, 1 / 60)
    expect(p).toBe(1)
    expect(rampedVolume(1, 1, 1 / 60)).toBe(1)
  })

  it('rampt auch nach unten und bleibt im Band 0..1', () => {
    expect(rampedVolume(1, 0, 1 / 60)).toBeCloseTo(1 - VIDEO_VOLUME_PER_S / 60, 6)
    expect(rampedVolume(0.02, 0, 1 / 60)).toBe(0)
    // Ziel außerhalb des Bandes wird geklemmt, der Schritt bleibt gedeckelt
    expect(rampedVolume(0.5, 5, 1)).toBeCloseTo(0.5 + VIDEO_VOLUME_PER_S * 0.05, 6)
  })
})
