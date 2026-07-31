// Kreativbaukasten (Editor-Seite): Segment-Projektion, Audio-/Kamera-/Display-
// Mutatoren und die Zeitleisten-Helfer — alles reine Logik ohne DOM.

import { existsSync, readFileSync } from 'node:fs'
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
  mitWetterGrenze,
  MODI,
  MOMENT_DEFAULT_S,
  offsetZuIso,
  ohneAudioEintrag,
  ohneKameraGrenze,
  ohneMoment,
  ohneWetterGrenze,
  projiziereAufTrack,
  pruefeOverlay,
  punktZuOffset,
  WETTER_MODI,
  type EditOverlay,
  type MediumBasis,
  type TrackPunkt,
} from '../src/studio/editmodell'
import { SFX_BIBLIOTHEK, SFX_DATEIEN, sfxEffekt } from '../src/studio/sfxbibliothek'
import {
  ankerScroll,
  anteilBei,
  anteilZuOffset,
  audioWirdVerworfen,
  baueAchse,
  baueAudioBalken,
  baueFilmMassband,
  baueMedienDots,
  baueSkala,
  baueSpielKurve,
  baueTrimGriffe,
  baueZustandsBaender,
  filmBei,
  filmZuOffset,
  formatiereDauer,
  formatiereFilmzeit,
  HALT_AUSBLEND_S,
  HALT_ENGINE_S,
  haltedauerS,
  kumMeter,
  meterZuOffset,
  musikLanes,
  offsetZuAnteil,
  schaetzeAnimationsdauer,
  waehleFilmStufe,
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
    expect(pruefeOverlay({ schema: 'maptale/edits@1', kamera: [{ ab: iso(0), preset: 'nah', skala: 0.4 }] })).toMatch(/Feinjustierung/)
    expect(pruefeOverlay({ schema: 'maptale/edits@1', kamera: [{ ab: iso(0), preset: 'nah', skala: 1.5 }] })).toBeNull()
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
    expect(pruefeOverlay({ schema: 'maptale/edits@1', momente: [{ ab: 'quatsch', art: 'umkreisen' }] })).toMatch(/Moment/)
    expect(pruefeOverlay({ schema: 'maptale/edits@1', momente: [{ ab: iso(0), art: 'umkreisen', dauerS: 99 }] })).toMatch(/Dauer/)
    expect(pruefeOverlay({ schema: 'maptale/edits@1', momente: [{ ab: iso(0), art: 'umkreisen', dauerS: 6 }] })).toBeNull()
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

  it('Stück tauschen: datei+quelle ersetzen, die Platzierung bleibt', () => {
    // Ausgangslage: Bibliotheks-Musik mit gesetztem Bereich und Lautstärke
    let e = mitAudioEintrag(LEERES_OVERLAY, {
      datei: 'mus-aufbruch.mp3',
      typ: 'musik',
      ab: iso(0),
      bis: iso(600),
      lautstaerke: 0.5,
      quelle: 'bibliothek',
    })
    // „Ändern …": eigener Upload übernimmt — ab/bis/lautstaerke unangetastet
    e = mitAudioPatch(e, 0, { datei: 'meine-musik.mp3', quelle: 'benutzer' })
    expect(e.audio?.[0]).toEqual({
      datei: 'meine-musik.mp3',
      typ: 'musik',
      ab: iso(0),
      bis: iso(600),
      lautstaerke: 0.5,
      quelle: 'benutzer',
    })
    // Tausch gegen einen Katalog-Effekt wechselt die Art mit → Ende fällt weg
    e = mitAudioPatch(e, 0, { datei: 'sfx-moewe.mp3', quelle: 'bibliothek', typ: 'sfx' })
    expect(e.audio?.[0]).toEqual({
      datei: 'sfx-moewe.mp3',
      typ: 'sfx',
      ab: iso(0),
      lautstaerke: 0.5,
      quelle: 'bibliothek',
    })
    // quelle: undefined heißt ausdrücklich „tour-lokal" — der Schlüssel verschwindet
    e = mitAudioPatch(e, 0, { datei: 'lokal.mp3', quelle: undefined })
    expect(e.audio?.[0]).toEqual({ datei: 'lokal.mp3', typ: 'sfx', ab: iso(0), lautstaerke: 0.5 })
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
  const basis = (audio: NonNullable<EditOverlay['audio']>): EditOverlay => ({ schema: 'maptale/edits@1', audio })
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
    expect(pruefeOverlay({ schema: 'maptale/edits@1', kamera: [{ ab: 'quatsch', preset: 'nah' }] })).toMatch(/Kamera/)
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

  // Die Haltezeit-Spiegel (HALT_ENGINE_S/HALT_AUSBLEND_S) hatten als einzige
  // KEINEN Wächter — eine Engine-Änderung wäre in Dauer-Schätzung und
  // Filmzeit-Kurve unbemerkt verhallt.
  it('Haltezeiten decken sich mit HOLD_HIDE/HOLD_AUSBLEND der Engine', () => {
    const quelle = readFileSync(new URL('../src/tour.js', import.meta.url), 'utf8')
    const hide = quelle.match(/const HOLD_HIDE = ([\d.]+)/)
    const ausblend = quelle.match(/const HOLD_AUSBLEND = ([\d.]+)/)
    expect(hide, 'HOLD_HIDE in src/tour.js nicht gefunden').not.toBeNull()
    expect(ausblend, 'HOLD_AUSBLEND in src/tour.js nicht gefunden').not.toBeNull()
    expect(Number(hide?.[1])).toBe(HALT_ENGINE_S)
    expect(Number(ausblend?.[1])).toBe(HALT_AUSBLEND_S)
  })

  it('haben in der Engine auch eine Kamera-Skala', () => {
    const quelle = readFileSync(new URL('../src/tour.js', import.meta.url), 'utf8')
    const block = quelle.match(/const MODE_SCALE = \{([\s\S]*?)\n\}/)
    const engine = [...(block?.[1] ?? '').matchAll(/^\s{2}(\w+)\s*:/gm)].map((m) => m[1] as string)
    expect(engine.slice().sort()).toEqual([...MODI].slice().sort())
  })

  // Der Läufer im Editor soll dasselbe Zeichen tragen wie der Fahrer im Player.
  // Das Studio hat einen eigenen Sprite (studio.html), die Engine ihre MODE_ICONS
  // (src/map.js) — zwei Orte, ein Bild. Hier wird beides verglichen: dass es je
  // Modus ein Symbol gibt UND dass die Pfade wirklich deckungsgleich sind.
  it('haben im Studio-Sprite ein zeichengleiches Piktogramm', () => {
    const engineQuelle = readFileSync(new URL('../src/map.js', import.meta.url), 'utf8')
    const engineBlock = engineQuelle.match(/export const MODE_ICONS = \{([\s\S]*?)\n\}/)
    expect(engineBlock, 'MODE_ICONS in src/map.js nicht gefunden').not.toBeNull()
    const studioQuelle = readFileSync(new URL('../studio.html', import.meta.url), 'utf8')

    /** Alle `d="…"`-Pfade eines SVG-Schnipsels, Leerraum normalisiert. */
    const pfade = (text: string): string[] =>
      [...text.matchAll(/\sd="([^"]+)"/g)].map((m) => (m[1] as string).replace(/\s+/g, ' ').trim())

    for (const modus of MODI) {
      const engineIcon = (engineBlock?.[1] ?? '').match(
        new RegExp(`(?:^|\\n)\\s*(?://[^\\n]*\\n\\s*)?${modus}:\\s*\`([\\s\\S]*?)\``),
      )
      expect(engineIcon, `MODE_ICONS.${modus} nicht gefunden`).not.toBeNull()
      const studioIcon = studioQuelle.match(new RegExp(`<symbol id="i-m-${modus}"([\\s\\S]*?)</symbol>`))
      expect(studioIcon, `Sprite #i-m-${modus} fehlt in studio.html`).not.toBeNull()
      expect(pfade(studioIcon?.[1] ?? ''), `Pfade von ${modus}`).toEqual(pfade(engineIcon?.[1] ?? ''))
    }
  })
})

describe('Wetter-Grenzen', () => {
  it('setzt und ersetzt am selben ab, sortiert nach Zeit', () => {
    let e: EditOverlay = LEERES_OVERLAY
    e = mitWetterGrenze(e, iso(600), 'rain')
    e = mitWetterGrenze(e, iso(0), 'clouds')
    e = mitWetterGrenze(e, iso(600), 'storm', 0.9) // ersetzt die rain-Grenze
    expect(e.wetter).toEqual([
      { ab: iso(0), mode: 'clouds' },
      { ab: iso(600), mode: 'storm', staerke: 0.9 },
    ])
  })

  it('lässt staerke 1/undefined weg, hält das JSON minimal', () => {
    const e = mitWetterGrenze(LEERES_OVERLAY, iso(0), 'fog')
    expect(e.wetter).toEqual([{ ab: iso(0), mode: 'fog' }])
  })

  it('entfernt die Grenze und räumt das leere Feld weg (zurück zum Auto-Wetter)', () => {
    const e = mitWetterGrenze(LEERES_OVERLAY, iso(0), 'snow')
    const ohne = ohneWetterGrenze(e, iso(0))
    expect('wetter' in ohne).toBe(false)
  })

  it('pruefeOverlay lehnt Stärke außerhalb [0,1] ab', () => {
    expect(pruefeOverlay({ schema: 'maptale/edits@1', wetter: [{ ab: iso(0), mode: 'rain', staerke: 1.4 }] })).toMatch(
      /Wetter-Stärke/,
    )
    expect(pruefeOverlay({ schema: 'maptale/edits@1', wetter: [{ ab: iso(0), mode: 'rain', staerke: 0.5 }] })).toBeNull()
  })

  // Drift-Wächter: die Wetter-Modi müssen client- und serverseitig gleich sein
  // (der JSON-Schema-Enum und die Studio-Auswahl teilen dieselbe Wetterwelt).
  it('decken sich mit WETTER_MODI im Server (schema/pipeline)', () => {
    const quelle = readFileSync(new URL('../server/src/pipeline/weather.ts', import.meta.url), 'utf8')
    const block = quelle.match(/WETTER_MODI = \[([^\]]*)\]/)
    expect(block, 'WETTER_MODI in server/src/pipeline/weather.ts nicht gefunden').not.toBeNull()
    const server = [...(block?.[1] ?? '').matchAll(/'([a-z]+)'/g)].map((m) => m[1] as string)
    expect(server).toEqual([...WETTER_MODI])
  })
})

describe('Musik- und Klangbibliothek', () => {
  it('Katalog ist konsistent: eindeutige Dateien, Kategorie passt zum Typ', () => {
    const dateien = SFX_BIBLIOTHEK.map((e) => e.datei)
    expect(new Set(dateien).size, 'doppelte Dateinamen im Katalog').toBe(dateien.length)
    for (const e of SFX_BIBLIOTHEK) {
      expect(e.datei, `${e.name}: Dateiname`).toMatch(/^[A-Za-z0-9_-]{1,64}\.mp3$/)
      // Musik und Umgebung laufen als Loop über eine Spanne (musik),
      // Effekte als One-Shot an einem Punkt (sfx)
      expect(e.typ, `${e.name}: Typ passt zur Kategorie`).toBe(e.kategorie === 'effekt' ? 'sfx' : 'musik')
    }
    expect(SFX_DATEIEN.has(SFX_BIBLIOTHEK[0]!.datei)).toBe(true)
    expect(sfxEffekt(SFX_BIBLIOTHEK[0]!.datei)?.name).toBe(SFX_BIBLIOTHEK[0]!.name)
    expect(sfxEffekt('gibtsnicht.mp3')).toBeUndefined()
  })

  it('bietet Musik an — nicht nur Atmosphären und Effekte', () => {
    // Die Spur heißt „Musik & Sound"; ohne Musik wäre sie eine Ankündigung.
    const musik = SFX_BIBLIOTHEK.filter((e) => e.kategorie === 'musik')
    expect(musik.length).toBeGreaterThanOrEqual(10)
    expect(musik.every((e) => e.typ === 'musik')).toBe(true)
  })

  it('deckt sich mit den erzeugten Clips (Drift-Wächter Katalog ↔ Skripte)', async () => {
    // Die Generier-Skripte exportieren ihre Prompts; der Katalog die Anzeige.
    // Die Dateinamen-Mengen müssen exakt übereinstimmen, sonst wählt das Studio
    // Stücke, die nie erzeugt werden — oder umgekehrt.
    // @ts-expect-error — reines .mjs-Generier-Skript ohne Typdeklaration
    const { CLIPS } = (await import('../scripts/gen-sfx-library.mjs')) as { CLIPS: Array<{ name: string }> }
    // @ts-expect-error — dito
    const { MUSIK_CLIPS } = (await import('../scripts/gen-music-library.mjs')) as {
      MUSIK_CLIPS: Array<{ name: string }>
    }
    const ausSkript = [...CLIPS, ...MUSIK_CLIPS].map((c) => `${c.name}.mp3`).sort()
    const ausKatalog = SFX_BIBLIOTHEK.map((e) => e.datei).slice().sort()
    expect(ausSkript).toEqual(ausKatalog)
  })

  it('jede Katalogdatei liegt wirklich unter public/audio/sfx/', () => {
    // Ein Katalogeintrag ohne Datei ist ein Eintrag, der beim Anklicken schweigt.
    for (const e of SFX_BIBLIOTHEK) {
      const pfad = new URL(`../public/audio/sfx/${e.datei}`, import.meta.url)
      expect(existsSync(pfad), `${e.name}: ${e.datei} fehlt`).toBe(true)
    }
  })

  // Drift-Wächter: Der Server vergibt beim ersten Verarbeiten selbst ein
  // Musikstück und führt dafür eine eigene Dateiliste (er kann den Client-
  // Katalog nicht importieren). Driftet sie ab, setzt die Automatik eine
  // Referenz, die es nicht gibt — im Player bliebe es still.
  it('die Auto-Musik des Servers steht wirklich im Katalog', () => {
    const quelle = readFileSync(new URL('../server/src/pipeline/musikwahl.ts', import.meta.url), 'utf8')
    const block = quelle.match(/AUTO_MUSIK = \{([\s\S]*?)\} as const/)
    expect(block, 'AUTO_MUSIK in server/src/pipeline/musikwahl.ts nicht gefunden').not.toBeNull()
    const dateien = [...(block?.[1] ?? '').matchAll(/'([^']+\.mp3)'/g)].map((m) => m[1] as string)
    expect(dateien.length, 'AUTO_MUSIK ist leer').toBeGreaterThanOrEqual(5)
    for (const datei of dateien) {
      expect(SFX_DATEIEN.has(datei), `${datei} fehlt im Studio-Katalog`).toBe(true)
      expect(sfxEffekt(datei)?.kategorie, `${datei} ist keine Musik`).toBe('musik')
    }
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
    expect(balken[0]).toMatchObject({ index: 0, von: 0.25, bis: 1, lane: 0 })
    expect(balken[1]).toMatchObject({ index: 1, von: 0.5, bis: 0.5, lane: 0 })
  })

  it('stapelt überlappende Musik-Klips in Unterzeilen — Nachbarn teilen die Zeile', () => {
    // Zwei vollflächige Klips (der Bug-Fall: Auto-Musik + nachträglich
    // Eingesetztes ab Tour-Beginn) dürfen sich nicht verdecken.
    const voll = baueAudioBalken(
      [
        { datei: 'mus-regentag.mp3', typ: 'musik', ab: iso(0), quelle: 'bibliothek' },
        { datei: 'amb-hafen.mp3', typ: 'musik', ab: iso(0), quelle: 'bibliothek' },
      ],
      START,
      skala,
    )
    expect(voll.map((b) => b.lane)).toEqual([0, 1])
    expect(musikLanes(voll)).toBe(2)

    // Aneinandergrenzende Klips (bis = ab des nächsten) bleiben in EINER Zeile;
    // ein dritter, der beide überspannt, rückt in die zweite. Effekt-Pins haben
    // ihre eigene Lane oben und zählen nicht mit.
    const gemischt = baueAudioBalken(
      [
        { datei: 'a.mp3', typ: 'musik', ab: iso(0), bis: iso(600) },
        { datei: 'b.mp3', typ: 'musik', ab: iso(600), bis: iso(1200) },
        { datei: 'c.mp3', typ: 'musik', ab: iso(300), bis: iso(900) },
        { datei: 'd.mp3', typ: 'sfx', ab: iso(300) },
      ],
      START,
      skala,
    )
    expect(gemischt.map((b) => b.lane)).toEqual([0, 0, 1, 0])
    expect(musikLanes(gemischt)).toBe(2)

    // Leere Bahn: mindestens eine Zeile (die Bahnhöhe rechnet damit)
    expect(musikLanes([])).toBe(1)
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

  describe('Filmzeit-Achse', () => {
    const dLng6km = 6000 / (111_320 * Math.cos((47 * Math.PI) / 180))
    // Zwei Fahr-Hälften à 6 km bike (je 50 s Film), Halt bei t=600 (20 s Film)
    const fahrTrack: TrackPunkt[] = [
      [9, 47, 0, 0],
      [9 + dLng6km, 47, 0, 600],
      [9 + 2 * dLng6km, 47, 0, 1200],
    ]
    const fSkala = baueSkala(fahrTrack)!
    const abschnitte = [{ mode: 'bike' as const, aktiv: true, pts: fahrTrack }]
    const achse = baueAchse(abschnitte, [{ offsetS: 600, breiteS: 20 }], fSkala)
    const gesamt = achse.kurve?.gesamtS ?? 0

    it('Halte bekommen ihre Standzeit als Achsenbreite', () => {
      expect(gesamt).toBeCloseTo(120, 1) // 100 s Fahrt + 20 s Halt
      // Der Halt belegt (50..70)/120 der Achse
      expect(offsetZuAnteil(achse, 599)).toBeLessThan(50 / 120)
      expect(offsetZuAnteil(achse, 601)).toBeGreaterThan(70 / 120 - 0.01)
    })

    it('Sprung-Konventionen: Halt-Zeit → Sprunganfang, Anteil im Sprung → Halt-Zeit', () => {
      expect(offsetZuAnteil(achse, 600)).toBeCloseTo(50 / 120, 4)
      // Mitten im Halt-Sprung (Filmzeit 60 von 120) steht die Aufnahmezeit still
      expect(anteilZuOffset(achse, 60 / 120)).toBeCloseTo(600, 4)
      // Außerhalb des Sprungs normale Umkehrung
      expect(anteilZuOffset(achse, offsetZuAnteil(achse, 300))).toBeCloseTo(300, 4)
    })

    it('ohne Kurve fällt die Abbildung auf die lineare Aufnahmezeit zurück', () => {
      expect(offsetZuAnteil(fSkala, 600)).toBeCloseTo(0.5, 6)
      expect(anteilZuOffset(fSkala, 0.25)).toBeCloseTo(300, 6)
    })

    it('Trim wird für die ACHSE ignoriert — weggetrimmte Ränder bleiben anfassbar', () => {
      const mitTrim = [
        { mode: 'bike' as const, aktiv: true, pts: [fahrTrack[0]!, fahrTrack[1]!] },
        { mode: 'bike' as const, aktiv: false, pts: [fahrTrack[1]!, fahrTrack[2]!] },
      ]
      const a2 = baueAchse(mitTrim, [], fSkala)
      expect(a2.kurve?.gesamtS).toBeCloseTo(100, 1)
    })

    it('ohne Fahrstrecke tragen die HALTE die Achse — der Film ist ja fast nur Standzeit', () => {
      const stand: TrackPunkt[] = [
        [9, 47, 0, 0],
        [9, 47, 0, 3000],
      ]
      const nurFotos = baueAchse(
        [{ mode: 'walk', aktiv: true, pts: stand }],
        [{ offsetS: 100, breiteS: 6 }],
        baueSkala(stand)!,
      )
      expect(nurFotos.kurve?.gesamtS).toBeCloseTo(6, 3)
      // Erst ohne Fahrzeit UND ohne Halte ist nichts zu zeigen: linearer Fallback
      const leer = baueAchse([{ mode: 'walk', aktiv: true, pts: stand }], [], baueSkala(stand)!)
      expect(leer.kurve).toBeUndefined()
    })

    it('filmZuOffset liefert die Film-Sekunde der Achse (Kopf-Uhr)', () => {
      expect(filmZuOffset(achse, 300)).toBeCloseTo(25, 1)
      expect(filmZuOffset(achse, 600)).toBeCloseTo(50, 1) // Sprunganfang
      expect(filmZuOffset(achse, 1200)).toBeCloseTo(120, 1)
    })

    it('eine reale Pause fällt zum Plateau zusammen — Umkehrung liefert die Ankunft', () => {
      // Fahrt (6 km) → Pause (1380 s, 0 m) → Fahrt (6 km), keine Halte
      const pausenTrack: TrackPunkt[] = [
        [9, 47, 0, 0],
        [9 + dLng6km, 47, 0, 600],
        [9 + dLng6km, 47, 0, 1980],
        [9 + 2 * dLng6km, 47, 0, 2580],
      ]
      const a2 = baueAchse([{ mode: 'bike', aktiv: true, pts: pausenTrack }], [], baueSkala(pausenTrack)!)
      // Beide Pausen-Ränder liegen auf demselben Anteil (0 Filmzeit dazwischen)
      expect(offsetZuAnteil(a2, 1980)).toBeCloseTo(offsetZuAnteil(a2, 600.01), 4)
      // Ein Anteil exakt auf der Plateau-Kante übersetzt zur ANKUNFT
      expect(anteilZuOffset(a2, offsetZuAnteil(a2, 600))).toBeCloseTo(600, 2)
    })

    it('Fahranteil der Achse stimmt mit der Dauer-Schätzung überein (eine Formel)', () => {
      const gesamtOhneHalt = baueAchse(abschnitte, [], fSkala).kurve?.gesamtS
      expect(gesamtOhneHalt).toBeCloseTo(schaetzeAnimationsdauer(abschnitte, []), 6)
    })

    it('Spielkurve: Identität ohne Trim, Plateau über weggetrimmten Bereichen', () => {
      const identitaet = baueSpielKurve(achse, abschnitte)
      expect(identitaet).toEqual({ anteile: [0, 1], filmS: [0, gesamt], gesamtS: gesamt })

      const mitTrim = [
        { mode: 'bike' as const, aktiv: true, pts: [fahrTrack[0]!, fahrTrack[1]!] },
        { mode: 'bike' as const, aktiv: false, pts: [fahrTrack[1]!, fahrTrack[2]!] },
      ]
      const a2 = baueAchse(mitTrim, [{ offsetS: 300, breiteS: 20 }], fSkala)
      const spiel = baueSpielKurve(a2, mitTrim)
      // Erster Abschnitt (50 s Fahrt + 20 s Halt) spielt, der getrimmte nicht
      expect(spiel.gesamtS).toBeCloseTo(70, 1)
      expect(filmBei(spiel, 1)).toBeCloseTo(70, 1)
      // Hinter der Trim-Grenze wächst die Spielzeit nicht mehr (Plateau)
      const grenzAnteil = offsetZuAnteil(a2, 600)
      expect(filmBei(spiel, grenzAnteil + 0.1)).toBeCloseTo(70, 1)
    })
  })

  it('formatiert Filmzeit als m:ss bzw. h:mm:ss', () => {
    expect(formatiereFilmzeit(0)).toBe('0:00')
    expect(formatiereFilmzeit(38)).toBe('0:38')
    expect(formatiereFilmzeit(90)).toBe('1:30')
    expect(formatiereFilmzeit(3600)).toBe('1:00:00')
    expect(formatiereFilmzeit(3725)).toBe('1:02:05')
    expect(formatiereFilmzeit(-5)).toBe('0:00')
  })

  it('Film-Maßband-Stufe ist die feinste, die noch lesbar bleibt', () => {
    expect(waehleFilmStufe(60)).toBe(1)
    expect(waehleFilmStufe(30)).toBe(2)
    expect(waehleFilmStufe(12)).toBe(5)
    expect(waehleFilmStufe(1)).toBe(60)
    expect(waehleFilmStufe(0.001)).toBe(3600)
  })

  it('Film-Maßband: äquidistante Marken, volle Minuten kräftig, Ränder markiert', () => {
    const dLng6km = 6000 / (111_320 * Math.cos((47 * Math.PI) / 180))
    const track2: TrackPunkt[] = [
      [9, 47, 0, 0],
      [9 + dLng6km, 47, 0, 600],
      [9 + 2 * dLng6km, 47, 0, 1200],
    ]
    const achse = baueAchse(
      [{ mode: 'bike', aktiv: true, pts: track2 }],
      [{ offsetS: 600, breiteS: 20 }],
      baueSkala(track2)!,
    )
    const marken = baueFilmMassband(achse, 5) // 120 s × 5 px/s → 15-s-Stufe
    expect(marken.map((m) => m.text)).toEqual(['0:00', '0:15', '0:30', '0:45', '1:00', '1:15', '1:30', '1:45', '2:00'])
    // film-linear ⇒ äquidistant
    for (let i = 1; i < marken.length; i++) {
      expect((marken[i]?.anteil ?? 0) - (marken[i - 1]?.anteil ?? 0)).toBeCloseTo(15 / 120, 6)
    }
    expect(marken.filter((m) => m.voll).map((m) => m.text)).toEqual(['0:00', '1:00', '2:00'])
    expect(marken[0]?.rand).toBe('anfang')
    expect(marken[marken.length - 1]?.rand).toBe('ende')
    // Degeneriert: nichts zu beschriften
    expect(baueFilmMassband({ vonS: 0, bisS: 100 }, 5)).toEqual([])
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

  it('Streckenmeter: kumuliert je Punkt, dazwischen interpoliert', () => {
    const kum = kumMeter(track)
    expect(kum[0]).toBe(0)
    expect(kum[1]).toBeCloseTo(7592, -1) // 0,1° Länge auf 47° Breite
    expect(kum[2]).toBeCloseTo(7592 + 5527, -1) // + 0,05° Breite
    expect(meterZuOffset(kum, track, 0)).toBe(0)
    expect(meterZuOffset(kum, track, 300)).toBeCloseTo(kum[1]! / 2, 3) // Mitte des ersten Segments
    expect(meterZuOffset(kum, track, 1200)).toBeCloseTo(kum[2]!, 6)
    expect(meterZuOffset(kum, track, 99_999)).toBeCloseTo(kum[2]!, 6) // hinterm Ende geklemmt
    expect(meterZuOffset(kum, track, -50)).toBe(0)
  })

  it('Zoom-Anker: die angepeilte Stelle bleibt im Fenster stehen', () => {
    // Anker in der Mitte einer 1000-px-Achse soll bei Fenster-x 300 landen
    expect(ankerScroll(0.5, 1000, 300, 168)).toBe(368)
    // Nie negativ scrollen: am Anfang klebt die Achse links
    expect(ankerScroll(0, 1000, 500, 168)).toBe(0)
  })
})
