// Kreativbaukasten (Editor-Seite): Segment-Projektion, Audio-/Kamera-/Display-
// Mutatoren und die Zeitleisten-Helfer — alles reine Logik ohne DOM.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  effektiveMedien,
  LEERES_OVERLAY,
  mitAudioEintrag,
  mitAudioPatch,
  mitKameraGrenze,
  mitMedienEdit,
  mitMoment,
  mitTrim,
  MODI,
  MOMENT_DEFAULT_S,
  offsetZuIso,
  ohneAudioEintrag,
  ohneKameraGrenze,
  ohneMoment,
  projiziereAufTrack,
  pruefeOverlay,
  punktZuOffset,
  type EditOverlay,
  type MediumBasis,
  type TrackPunkt,
} from '../src/studio/editmodell'
import { SFX_BIBLIOTHEK, SFX_DATEIEN, sfxEffekt } from '../src/studio/sfxbibliothek'
import {
  anteilZuOffset,
  audioWirdVerworfen,
  baueAudioBalken,
  baueMedienDots,
  baueMedienMarken,
  baueSkala,
  baueTicks,
  baueTrimGriffe,
  baueZustandsBaender,
  formatiereDauer,
  haltedauerS,
  HALTEDAUER_DEFAULT_S,
  offsetZuAnteil,
  schaetzeAnimationsdauer,
  type MedienMarke,
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

  it('Feinjustierung: skala wird gehalten, bei 1/undefined weggelassen', () => {
    expect(mitKameraGrenze(LEERES_OVERLAY, iso(0), 'nah', 1.4).kamera).toEqual([{ ab: iso(0), preset: 'nah', skala: 1.4 }])
    // skala 1 oder undefined = kein Feld (minimales JSON)
    expect(mitKameraGrenze(LEERES_OVERLAY, iso(0), 'nah', 1).kamera).toEqual([{ ab: iso(0), preset: 'nah' }])
    expect(mitKameraGrenze(LEERES_OVERLAY, iso(0), 'nah').kamera).toEqual([{ ab: iso(0), preset: 'nah' }])
    // pruefeOverlay: 0.5..2 erlaubt, außerhalb abgelehnt
    expect(pruefeOverlay({ schema: 'luhambo/edits@1', kamera: [{ ab: iso(0), preset: 'nah', skala: 0.4 }] })).toMatch(/Feinjustierung/)
    expect(pruefeOverlay({ schema: 'luhambo/edits@1', kamera: [{ ab: iso(0), preset: 'nah', skala: 1.5 }] })).toBeNull()
  })
})

describe('Kamera-Momente', () => {
  it('setzt, ersetzt (gleicher ab), sortiert und räumt auf', () => {
    let e = mitMoment(LEERES_OVERLAY, iso(600), 'umkreisen')
    e = mitMoment(e, iso(100), 'innehalten', 8)
    e = mitMoment(e, iso(600), 'aufstieg') // ersetzt den Umkreisen-Moment
    expect(e.momente).toEqual([
      { ab: iso(100), art: 'innehalten', dauerS: 8 },
      { ab: iso(600), art: 'aufstieg' },
    ])
    e = ohneMoment(e, iso(100))
    e = ohneMoment(e, iso(600))
    expect('momente' in e).toBe(false)
  })

  it('pruefeOverlay lehnt unparsebare Zeit und Dauer außerhalb 1..30 ab', () => {
    expect(pruefeOverlay({ schema: 'luhambo/edits@1', momente: [{ ab: 'quatsch', art: 'umkreisen' }] })).toMatch(/Moment/)
    expect(pruefeOverlay({ schema: 'luhambo/edits@1', momente: [{ ab: iso(0), art: 'umkreisen', dauerS: 99 }] })).toMatch(/Dauer/)
    expect(pruefeOverlay({ schema: 'luhambo/edits@1', momente: [{ ab: iso(0), art: 'umkreisen', dauerS: 6 }] })).toBeNull()
  })

  it('Default-Dauern decken sich mit der Engine (Drift-Wächter tour.js)', () => {
    const quelle = readFileSync(new URL('../src/tour.js', import.meta.url), 'utf8')
    const block = quelle.match(/const MOMENT_DEFAULT_S = \{([^}]*)\}/)
    expect(block, 'MOMENT_DEFAULT_S in src/tour.js nicht gefunden').not.toBeNull()
    const engine = Object.fromEntries(
      [...(block?.[1] ?? '').matchAll(/(\w+):\s*(\d+)/g)].map((m) => [m[1] as string, Number(m[2])]),
    )
    expect(engine).toEqual(MOMENT_DEFAULT_S)
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

describe('Fortbewegungs-Modi', () => {
  // Drift-Wächter: Studio und Player-Engine müssen dieselben Modi kennen. Sie
  // liefen auseinander — das Studio bot nur walk/bike/tram/ferry an, während
  // Engine, Icons und Motorsound moped/jeep längst unterstützten; aufgezeichnete
  // Touren konnten diese Modi deshalb nie bekommen. tour.js lädt MapLibre und
  // ist im Node-Test nicht importierbar, also über den Quelltext.
  it('decken sich mit MODE_SPEED der Engine', () => {
    const quelle = readFileSync(new URL('../src/tour.js', import.meta.url), 'utf8')
    const block = quelle.match(/const MODE_SPEED = \{([^}]*)\}/)
    expect(block, 'MODE_SPEED in src/tour.js nicht gefunden').not.toBeNull()
    const engine = [...(block?.[1] ?? '').matchAll(/(\w+)\s*:/g)].map((m) => m[1] as string)
    expect(engine.slice().sort()).toEqual([...MODI].slice().sort())
  })

  it('Tempo-Faktoren der Dauerschätzung stimmen mit der Engine überein', () => {
    const quelle = readFileSync(new URL('../src/tour.js', import.meta.url), 'utf8')
    const block = quelle.match(/const MODE_SPEED = \{([^}]*)\}/)
    const engine = Object.fromEntries(
      [...(block?.[1] ?? '').matchAll(/(\w+)\s*:\s*([\d.]+)/g)].map((m) => [m[1] as string, Number(m[2])]),
    )
    // Eine 12 km lange Fahrt je Modus: die geschätzte Dauer muss exakt
    // Länge / (120 · MODE_SPEED) sein — prüft Faktor UND Basistempo.
    for (const [modus, faktor] of Object.entries(engine)) {
      const strecke: TrackPunkt[] = [
        [9, 47, 0, 0],
        [9 + 12000 / (111_320 * Math.cos((47 * Math.PI) / 180)), 47, 0, 3600],
      ]
      const sek = schaetzeAnimationsdauer([{ mode: modus as never, aktiv: true, pts: strecke }], [])
      expect(sek, `Tempo für ${modus}`).toBeCloseTo(12000 / (120 * faktor), 1)
    }
  })

  it('haben in der Engine auch eine Kamera-Skala', () => {
    const quelle = readFileSync(new URL('../src/tour.js', import.meta.url), 'utf8')
    const block = quelle.match(/const MODE_SCALE = \{([\s\S]*?)\n\}/)
    const engine = [...(block?.[1] ?? '').matchAll(/^\s{2}(\w+)\s*:/gm)].map((m) => m[1] as string)
    expect(engine.slice().sort()).toEqual([...MODI].slice().sort())
  })
})

describe('SFX-Bibliothek', () => {
  it('Katalog ist konsistent: eindeutige Dateien, Kategorie passt zum Typ', () => {
    const dateien = SFX_BIBLIOTHEK.map((e) => e.datei)
    expect(new Set(dateien).size, 'doppelte Dateinamen im Katalog').toBe(dateien.length)
    for (const e of SFX_BIBLIOTHEK) {
      expect(e.datei, `${e.name}: Dateiname`).toMatch(/^[A-Za-z0-9_-]{1,64}\.mp3$/)
      // Umgebung läuft als Loop (musik), Effekt als One-Shot (sfx)
      expect(e.typ, `${e.name}: Typ passt zur Kategorie`).toBe(e.kategorie === 'umgebung' ? 'musik' : 'sfx')
    }
    expect(SFX_DATEIEN.has(SFX_BIBLIOTHEK[0]!.datei)).toBe(true)
    expect(sfxEffekt(SFX_BIBLIOTHEK[0]!.datei)?.name).toBe(SFX_BIBLIOTHEK[0]!.name)
    expect(sfxEffekt('gibtsnicht.mp3')).toBeUndefined()
  })

  it('deckt sich mit den erzeugten Clips (Drift-Wächter Katalog ↔ Skript)', async () => {
    // Das Generier-Skript exportiert CLIPS (Prompts); der Katalog die Anzeige.
    // Die Dateinamen-Mengen müssen exakt übereinstimmen, sonst wählt das Studio
    // Effekte, die nie erzeugt werden — oder umgekehrt.
    // @ts-expect-error — reines .mjs-Generier-Skript ohne Typdeklaration
    const { CLIPS } = (await import('../scripts/gen-sfx-library.mjs')) as { CLIPS: Array<{ name: string }> }
    const ausSkript = CLIPS.map((c) => `${c.name}.mp3`).sort()
    const ausKatalog = SFX_BIBLIOTHEK.map((e) => e.datei).slice().sort()
    expect(ausSkript).toEqual(ausKatalog)
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

  it('Zustandsbänder: lückenlos, jedes Band endet an der nächsten Grenze', () => {
    const baender = baueZustandsBaender(
      [
        { ab: iso(300), wert: 'nah' },
        { ab: iso(900), wert: 'weit' },
      ],
      START,
      skala,
      null,
    )
    expect(baender).toEqual([
      { von: 0, bis: 0.25, wert: null, ab: null },
      { von: 0.25, bis: 0.75, wert: 'nah', ab: iso(300) },
      { von: 0.75, bis: 1, wert: 'weit', ab: iso(900) },
    ])
    // lückenlos: das Ende jedes Bandes ist der Anfang des nächsten
    for (let i = 1; i < baender.length; i++) expect(baender[i]?.von).toBe(baender[i - 1]?.bis)
  })

  it('Zustandsbänder: Grenze bei 0 erzeugt kein leeres Grundband, Doppelgrenzen kein Null-Band', () => {
    const abNull = baueZustandsBaender([{ ab: iso(0), wert: 'nah' }], START, skala, null)
    expect(abNull).toEqual([{ von: 0, bis: 1, wert: 'nah', ab: iso(0) }])

    const doppelt = baueZustandsBaender(
      [
        { ab: iso(600), wert: 'nah' },
        { ab: iso(600), wert: 'weit' },
      ],
      START,
      skala,
      null,
    )
    expect(doppelt.every((b) => b.bis > b.von)).toBe(true)
    expect(doppelt[doppelt.length - 1]).toMatchObject({ wert: 'weit', bis: 1 })
  })

  it('Zustandsbänder: unparsebare Grenzen fallen weg', () => {
    const baender = baueZustandsBaender([{ ab: 'quatsch', wert: 'nah' }], START, skala, 'mittel')
    expect(baender).toEqual([{ von: 0, bis: 1, wert: 'mittel', ab: null }])
  })

  it('Medien-Marken tragen die Haltedauer (Default 5 s, Video 0)', () => {
    const basis: MediumBasis[] = [
      { id: 'lang', type: 'photo', src: '/x', takenAt: iso(0), caption: '', anchor: [9.05, 47.002], placement: 'gps' },
      { id: 'auto', type: 'photo', src: '/x', takenAt: iso(0), caption: '', anchor: [9.1, 47.02], placement: 'gps' },
      { id: 'clip', type: 'video', src: '/x', takenAt: iso(0), caption: '', anchor: [9.1, 47.04], placement: 'gps' },
    ]
    const edits = mitMedienEdit(LEERES_OVERLAY, 'lang', { display: { holdS: 20 } })
    const marken = baueMedienMarken(effektiveMedien(basis, edits), track, skala)
    const nach = (id: string): MedienMarke => marken.find((m) => m.id === id)!
    expect(nach('lang').haltedauerS).toBe(20)
    expect(nach('auto').haltedauerS).toBe(HALTEDAUER_DEFAULT_S)
    expect(nach('clip').haltedauerS).toBe(0)
    // Größenkodierung: viermal so lang = viermal so breit
    expect(nach('lang').breite).toBeCloseTo(4 * nach('auto').breite, 6)
    expect(nach('clip').breite).toBe(0)
  })

  it('schätzt die Animationsdauer aus Fahrzeit und Foto-Stopps', () => {
    // 12 km mit dem Rad (Faktor 1) = 12000/120 = 100 s
    const strecke: TrackPunkt[] = [
      [9, 47, 0, 0],
      [9 + 12000 / (111_320 * Math.cos((47 * Math.PI) / 180)), 47, 0, 3600],
    ]
    expect(schaetzeAnimationsdauer([{ mode: 'bike', aktiv: true, pts: strecke }], [])).toBeCloseTo(100, 1)
    // Weggetrimmte Abschnitte zählen nicht mit
    expect(schaetzeAnimationsdauer([{ mode: 'bike', aktiv: false, pts: strecke }], [])).toBe(0)
    // Je Foto Haltedauer + 0,8 s Ausblendung
    expect(schaetzeAnimationsdauer([], [5.2, 12])).toBeCloseTo(5.2 + 12 + 1.6, 6)
    // Default-Haltedauer entspricht HOLD_HIDE der Engine, nicht dem UI-Label „5 s"
    expect(haltedauerS()).toBe(5.2)
    expect(haltedauerS({ holdS: 20 })).toBe(20)
  })

  it('formatiert Dauern je nach Größenordnung', () => {
    expect(formatiereDauer(0)).toBe('0 Sek')
    expect(formatiereDauer(38)).toBe('38 Sek')
    expect(formatiereDauer(60)).toBe('1 Min')
    expect(formatiereDauer(870)).toBe('15 Min')
    expect(formatiereDauer(3600)).toBe('1:00 Std')
    expect(formatiereDauer(7500)).toBe('2:05 Std')
    expect(formatiereDauer(-5)).toBe('0 Sek')
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
