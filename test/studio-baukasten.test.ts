// Kreativbaukasten (Editor-Seite): Segment-Projektion, Audio-/Kamera-/Display-
// Mutatoren und die Zeitleisten-Helfer — alles reine Logik ohne DOM.

import { describe, expect, it } from 'vitest'
import {
  effektiveMedien,
  LEERES_OVERLAY,
  mitAudioEintrag,
  mitAudioPatch,
  mitKameraGrenze,
  mitMedienEdit,
  mitTrim,
  offsetZuIso,
  ohneAudioEintrag,
  ohneKameraGrenze,
  projiziereAufTrack,
  pruefeOverlay,
  punktZuOffset,
  type EditOverlay,
  type MediumBasis,
  type TrackPunkt,
} from '../src/studio/editmodell'
import {
  anteilZuOffset,
  audioWirdVerworfen,
  baueAudioBalken,
  baueMedienDots,
  baueSkala,
  baueTicks,
  baueTrimGriffe,
  offsetZuAnteil,
} from '../src/studio/zeitleiste'

const START = '2026-07-12T17:45:00Z'
const iso = (s: number): string => offsetZuIso(START, s)

// Langer gerader Abschnitt (Fähren-Szenario): nur zwei Stützpunkte
const track: TrackPunkt[] = [
  [9.0, 47.0, 400, 0],
  [9.1, 47.0, 400, 600],
  [9.1, 47.05, 400, 1200],
]

describe('projiziereAufTrack', () => {
  it('projiziert auf die LINIE zwischen weit entfernten Stützpunkten (Fähren-Bug)', () => {
    // Klick mittig auf die Gerade, leicht daneben — der nächste VERTEX wäre km entfernt
    const { punkt, index } = projiziereAufTrack(track, 9.05, 47.001)
    expect(index).toBe(0)
    expect(punkt[0]).toBeCloseTo(9.05, 4)
    expect(punkt[1]).toBeCloseTo(47.0, 4)
    // tOffset wird mit interpoliert: halbe Strecke = halbe Zeit
    expect(punkt[3]).toBeCloseTo(300, 0)
  })

  it('klemmt vor dem Anfang und nach dem Ende auf die Endpunkte', () => {
    expect(projiziereAufTrack(track, 8.9, 47.0).punkt[3]).toBe(0)
    expect(projiziereAufTrack(track, 9.1, 47.2).punkt[3]).toBe(1200)
  })

  it('fällt bei weniger als zwei Punkten auf den vorhandenen Punkt zurück', () => {
    expect(projiziereAufTrack([[9, 47, 0, 42]], 10, 48).punkt[3]).toBe(42)
  })
})

describe('punktZuOffset', () => {
  it('interpoliert zwischen den Stützpunkten', () => {
    const p = punktZuOffset(track, 300)
    expect(p?.[0]).toBeCloseTo(9.05, 6)
  })
  it('klemmt außerhalb der Spanne', () => {
    expect(punktZuOffset(track, -10)?.[3]).toBe(0)
    expect(punktZuOffset(track, 9999)?.[3]).toBe(1200)
    expect(punktZuOffset([], 0)).toBeNull()
  })
})

describe('Kamera-Grenzen', () => {
  it('setzt, ersetzt (gleicher ab) und sortiert', () => {
    let e = mitKameraGrenze(LEERES_OVERLAY, iso(600), 'weit')
    e = mitKameraGrenze(e, iso(100), 'nah')
    e = mitKameraGrenze(e, iso(600), 'mittel')
    expect(e.kamera).toEqual([
      { ab: iso(100), preset: 'nah' },
      { ab: iso(600), preset: 'mittel' },
    ])
    e = ohneKameraGrenze(e, iso(100))
    e = ohneKameraGrenze(e, iso(600))
    expect('kamera' in e).toBe(false)
  })
})

describe('Audio-Einträge', () => {
  it('fügt hinzu, patcht per Index und räumt beim letzten Entfernen auf', () => {
    let e = mitAudioEintrag(LEERES_OVERLAY, { datei: 'a.mp3', typ: 'musik', ab: iso(0) })
    e = mitAudioEintrag(e, { datei: 'b.mp3', typ: 'sfx', ab: iso(60) })
    e = mitAudioPatch(e, 0, { bis: iso(600), lautstaerke: 0.5 })
    expect(e.audio?.[0]).toEqual({ datei: 'a.mp3', typ: 'musik', ab: iso(0), bis: iso(600), lautstaerke: 0.5 })
    // undefined entfernt den Schlüssel
    e = mitAudioPatch(e, 0, { lautstaerke: undefined })
    expect('lautstaerke' in (e.audio?.[0] ?? {})).toBe(false)
    e = ohneAudioEintrag(e, 1)
    e = ohneAudioEintrag(e, 0)
    expect('audio' in e).toBe(false)
  })

  it('Wechsel auf sfx wirft das Ende weg', () => {
    let e = mitAudioEintrag(LEERES_OVERLAY, { datei: 'a.mp3', typ: 'musik', ab: iso(0), bis: iso(60) })
    e = mitAudioPatch(e, 0, { typ: 'sfx' })
    expect(e.audio?.[0]).toEqual({ datei: 'a.mp3', typ: 'sfx', ab: iso(0) })
  })
})

describe('Display-Optionen je Medium', () => {
  it('setzt holdS/kenBurns und räumt leere display-Objekte weg', () => {
    let e = mitMedienEdit(LEERES_OVERLAY, 'm1', { display: { holdS: 8, kenBurns: false } })
    expect(e.medien?.['m1']?.display).toEqual({ holdS: 8, kenBurns: false })
    e = mitMedienEdit(e, 'm1', { display: { kenBurns: false } })
    expect(e.medien?.['m1']?.display).toEqual({ kenBurns: false })
    e = mitMedienEdit(e, 'm1', { display: {} })
    expect('medien' in e).toBe(false)
  })

  it('effektiveMedien reicht display nur durch, wenn gesetzt', () => {
    const basis: MediumBasis[] = [
      { id: 'm1', type: 'photo', src: '/x', takenAt: iso(0), caption: '', anchor: [9, 47], placement: 'gps' },
    ]
    const ohne = effektiveMedien(basis, LEERES_OVERLAY)[0]!
    expect('display' in ohne).toBe(false)
    const mit = effektiveMedien(basis, mitMedienEdit(LEERES_OVERLAY, 'm1', { display: { holdS: 12 } }))[0]!
    expect(mit.display).toEqual({ holdS: 12 })
  })
})

describe('pruefeOverlay (Baukasten-Fälle)', () => {
  const basis = (audio: NonNullable<EditOverlay['audio']>): EditOverlay => ({ schema: 'luhambo/edits@1', audio })
  it('lehnt Ende vor Beginn ab', () => {
    expect(pruefeOverlay(basis([{ datei: 'a.mp3', typ: 'musik', ab: iso(60), bis: iso(30) }]))).toMatch(/Ende/)
  })
  it('lehnt Ende bei SFX ab', () => {
    expect(pruefeOverlay(basis([{ datei: 'a.mp3', typ: 'sfx', ab: iso(0), bis: iso(30) }]))).toMatch(/Musik/)
  })
  it('lehnt Lautstärke außerhalb 0..1 ab', () => {
    expect(pruefeOverlay(basis([{ datei: 'a.mp3', typ: 'musik', ab: iso(0), lautstaerke: 1.2 }]))).toMatch(/Lautstärke/)
  })
  it('lehnt Haltedauern außerhalb 2..60 ab', () => {
    const e = mitMedienEdit(LEERES_OVERLAY, 'm1', { display: { holdS: 99 } })
    expect(pruefeOverlay(e)).toMatch(/Haltedauer/)
    expect(pruefeOverlay(mitMedienEdit(LEERES_OVERLAY, 'm1', { display: { holdS: 8 } }))).toBeNull()
  })
  it('lehnt unparsebare Kamera-Grenzen ab', () => {
    expect(pruefeOverlay({ schema: 'luhambo/edits@1', kamera: [{ ab: 'quatsch', preset: 'nah' }] })).toMatch(/Kamera/)
  })
  it('lehnt zu viele Audio-Einträge ab (Server-Limit 50 gespiegelt)', () => {
    const viele = Array.from({ length: 51 }, () => ({ datei: 'a.mp3', typ: 'musik' as const, ab: iso(0) }))
    expect(pruefeOverlay(basis(viele))).toMatch(/maximal 50/)
  })
  it('lehnt zu lange Beschreibungen ab (Server-Limit 1000 gespiegelt)', () => {
    const e = mitMedienEdit(LEERES_OVERLAY, 'm1', { caption: 'x'.repeat(1001) })
    expect(pruefeOverlay(e)).toMatch(/1000/)
  })
})

describe('audioWirdVerworfen (Trim-Warnung im Editor)', () => {
  const skala = baueSkala(track)!
  it('meldet SFX im weggetrimmten Vorlauf', () => {
    const edits = mitTrim(LEERES_OVERLAY, 'start', iso(300))
    expect(audioWirdVerworfen({ datei: 's.mp3', typ: 'sfx', ab: iso(120) }, edits, START, skala)).toBe(true)
    expect(audioWirdVerworfen({ datei: 's.mp3', typ: 'sfx', ab: iso(600) }, edits, START, skala)).toBe(false)
  })
  it('meldet Musik, deren Spanne komplett vor dem Trim-Start liegt', () => {
    const edits = mitTrim(LEERES_OVERLAY, 'start', iso(600))
    expect(audioWirdVerworfen({ datei: 'm.mp3', typ: 'musik', ab: iso(60), bis: iso(300) }, edits, START, skala)).toBe(true)
    expect(audioWirdVerworfen({ datei: 'm.mp3', typ: 'musik', ab: iso(60) }, edits, START, skala)).toBe(false)
  })
})

describe('Zeitleiste', () => {
  const skala = baueSkala(track)!

  it('baut die Skala aus erstem/letztem Punkt (und null bei zu wenig Spanne)', () => {
    expect(skala).toEqual({ vonS: 0, bisS: 1200 })
    expect(baueSkala([[9, 47, 0, 5]])).toBeNull()
  })

  it('rechnet Anteil↔Offset geklemmt um', () => {
    expect(offsetZuAnteil(skala, 600)).toBeCloseTo(0.5)
    expect(offsetZuAnteil(skala, -50)).toBe(0)
    expect(anteilZuOffset(skala, 0.25)).toBeCloseTo(300)
    expect(anteilZuOffset(skala, 2)).toBe(1200)
  })

  it('setzt Medien-Dots an die projizierte Wiedergabe-Zeit (ohne gelöschte/unplatzierte)', () => {
    const basis: MediumBasis[] = [
      { id: 'weit', type: 'photo', src: '/x', takenAt: iso(0), caption: '', anchor: [9.05, 47.002], placement: 'gps' },
      { id: 'weg', type: 'photo', src: '/x', takenAt: iso(0), caption: '', anchor: [9.0, 47.0], placement: 'gps' },
      { id: 'ohne', type: 'photo', src: '/x', takenAt: iso(0), caption: '', anchor: null, placement: 'unplatziert' },
    ]
    const edits = mitMedienEdit(LEERES_OVERLAY, 'weg', { geloescht: true })
    const dots = baueMedienDots(effektiveMedien(basis, edits), track, skala)
    expect(dots.map((d) => d.id)).toEqual(['weit'])
    expect(dots[0]?.anteil).toBeCloseTo(0.25, 2)
  })

  it('baut Audio-Balken: Musik ohne bis läuft bis 1, SFX ist punktförmig', () => {
    const balken = baueAudioBalken(
      [
        { datei: 'a.mp3', typ: 'musik', ab: iso(300) },
        { datei: 'b.mp3', typ: 'sfx', ab: iso(600) },
      ],
      START,
      skala,
    )
    expect(balken[0]).toMatchObject({ index: 0, von: 0.25, bis: 1 })
    expect(balken[1]).toMatchObject({ index: 1, von: 0.5, bis: 0.5 })
  })

  it('Trim-Griffe: Default 0/1, sonst Anteil der Trim-Zeiten', () => {
    expect(baueTrimGriffe(LEERES_OVERLAY, START, skala)).toEqual({ start: 0, ende: 1 })
    const e = mitTrim(mitTrim(LEERES_OVERLAY, 'start', iso(300)), 'ende', iso(900))
    expect(baueTrimGriffe(e, START, skala)).toEqual({ start: 0.25, ende: 0.75 })
  })

  it('Ticks: 5-Minuten-Raster bei 20-Minuten-Spanne, innerhalb der Skala', () => {
    const ticks = baueTicks(START, skala, 'UTC')
    expect(ticks.length).toBeGreaterThanOrEqual(3)
    for (const t of ticks) {
      expect(t.anteil).toBeGreaterThanOrEqual(0)
      expect(t.anteil).toBeLessThanOrEqual(1)
      expect(t.text).toMatch(/^\d{2}:(00|05|10|15|20|25|30|35|40|45|50|55)$/)
    }
  })
})
