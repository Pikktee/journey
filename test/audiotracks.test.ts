// Tour-Audio (src/audiotracks.js): getestet werden NUR die reinen, DOM-freien
// Helfer — createAudioTracks braucht window/Audio und läuft nur im Browser
// (Vitest läuft in Node). Die Kantenerkennung ist die eigentliche Logik:
// Musik-Bereiche als halboffene Intervalle, SFX nur beim echten Vorwärts-Überfahren.

import { describe, expect, it } from 'vitest'
// audiotracks.js ist BEWUSST JS im Stil der Nachbarn music.js/vehicle.js;
// tsconfig (allowJs: false) kennt dafür keine Typen — Import daher ungeprüft.
// @ts-ignore
import { istAktiv, sfxSollFeuern } from '../src/audiotracks.js'

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
