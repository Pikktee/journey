// Kreativbaukasten (Editor-Seite): Segment-Projektion, Audio-/Kamera-/Display-
// Mutatoren und die Zeitleisten-Helfer — alles reine Logik ohne DOM.

import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { STUDIO_PEGEL_VORGABE } from '../src/audiotracks.js'
import { HOLD_AUSBLEND, HOLD_HIDE } from '../src/einblendung.js'
import {
  MODUS_TEMPO,
  MOMENT_DEFAULT_S as ENGINE_MOMENT_DEFAULT_S,
  RAMPE_M,
  rampenVersatzS,
  tempoMs,
} from '../src/filmachse.js'
import {
  effektiveMedien,
  erfasseUndo,
  isoZuOffset,
  HISTORIE_MAX,
  LEERES_OVERLAY,
  mitAudioEintrag,
  mitAudioPatch,
  mitKameraGrenze,
  mitMedienEdit,
  mitModusGrenze,
  mitMoment,
  mitTrim,
  mitWetterGrenze,
  MODI,
  MOMENT_DEFAULT_S,
  offsetZuIso,
  ohneAudioEintrag,
  ohneKameraGrenze,
  ohneModusGrenze,
  ohneMoment,
  ohneWetterGrenze,
  projiziereAufTrack,
  pruefeOverlay,
  punktZuOffset,
  WETTER_MODI,
  zerlegeFuerAnzeige,
  type EditOverlay,
  type MediumBasis,
  type Modus,
  type TrackPunkt,
} from '../src/studio/editmodell'
import { SFX_BIBLIOTHEK, SFX_DATEIEN, sfxEffekt } from '../src/studio/sfxbibliothek'
import {
  ankerScroll,
  anteilBei,
  anteilZuOffset,
  audioWirdVerworfen,
  aufnahmeHaltS,
  baueAchse,
  baueAudioBalken,
  baueFilmMassband,
  baueMedienDots,
  baueGrenzKurve,
  baueSkala,
  baueSpielKurve,
  baueSzenenKlips,
  baueTrimGriffe,
  baueZustandsBaender,
  beschreibeHaltStand,
  filmBei,
  filmDauerBeiGrenze,
  filmZuAnteil,
  filmZuOffset,
  formatiereDauer,
  formatiereFilmzeit,
  formatiereSekunden,
  HALT_AUSBLEND_S,
  HALT_ENGINE_S,
  haltBeiFilmS,
  haltedauerS,
  haltInnenBei,
  klemmeFilmS,
  klemmeGrenze,
  klemmeMomentDauer,
  klemmeStandzeit,
  klemmeVideoTrim,
  loeseFokusAuf,
  kumMeter,
  meterZuOffset,
  musikLanes,
  offsetZuAnteil,
  ordneEin,
  platzInKette,
  rasteAnHalt,
  RAST_HINTER_S,
  schaetzeAnimationsdauer,
  zeitBeiFilm,
  type Achse,
  BAND_MIN_PX,
  MOMENT_MAX_S,
  MOMENT_MIN_S,
  STANDZEIT_MAX_S,
  STANDZEIT_MIN_S,
  schrittFilmS,
  waehleFilmStufe,
  videoFilmS,
  videoStandS,
  VIDEO_TRIM_MIN_S,
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

  it('Default-Dauern SIND die der Engine, keine Kopie davon', () => {
    // Seit Paket D liest `tour.ts` dieselbe Tabelle (src/filmachse.ts) — der
    // Wächter vergleicht deshalb keine Zeichenkette mehr, sondern die Identität.
    expect(MOMENT_DEFAULT_S).toBe(ENGINE_MOMENT_DEFAULT_S)
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
  // Touren konnten diese Modi deshalb nie bekommen. tour.ts lädt MapLibre und
  // ist im Node-Test nicht importierbar, also über den Quelltext.
  it('decken sich mit der Tempo-Tabelle der Engine', () => {
    // `MODUS_TEMPO` steht seit Paket D in src/filmachse.ts und wird von der
    // Engine, vom Studio und (als erzwungener Spiegel) vom Server gelesen —
    // kein Quelltext-Vergleich mehr nötig.
    expect(Object.keys(MODUS_TEMPO).slice().sort()).toEqual([...MODI].slice().sort())
  })

  it('Tempo-Faktoren der Dauerschätzung stimmen mit der Engine überein', () => {
    // Eine 12 km lange Fahrt je Modus: die geschätzte Dauer muss exakt
    // Länge / (120 · Faktor) sein — prüft Faktor UND Basistempo.
    for (const [modus, faktor] of Object.entries(MODUS_TEMPO)) {
      const strecke: TrackPunkt[] = [
        [9, 47, 0, 0],
        [9 + 12000 / (111_320 * Math.cos((47 * Math.PI) / 180)), 47, 0, 3600],
      ]
      const sek = schaetzeAnimationsdauer([{ mode: modus as never, aktiv: true, pts: strecke }], [])
      expect(sek, `Tempo für ${modus}`).toBeCloseTo(12000 / (120 * faktor), 1)
    }
  })

  // Die Haltezeiten sind seit Paket A KEINE Kopie mehr, sondern derselbe Wert:
  // `einblendung.ts` ist DOM- und importfrei, das Studio liest ihn direkt. Der
  // Wächter prüft deshalb keine Zeichenkette mehr, sondern die Identität — er
  // fällt erst, wenn jemand die Werte wieder auseinanderschreibt.
  it('Haltezeiten SIND HOLD_HIDE/HOLD_AUSBLEND, keine Kopie davon', () => {
    expect(HALT_ENGINE_S).toBe(HOLD_HIDE)
    expect(HALT_AUSBLEND_S).toBe(HOLD_AUSBLEND)
  })

  it('haben in der Engine auch eine Kamera-Skala', () => {
    const quelle = readFileSync(new URL('../src/tour.ts', import.meta.url), 'utf8')
    const block = quelle.match(/const MODE_SCALE = \{([\s\S]*?)\n\}/)
    const engine = [...(block?.[1] ?? '').matchAll(/^\s{2}(\w+)\s*:/gm)].map((m) => m[1] as string)
    expect(engine.slice().sort()).toEqual([...MODI].slice().sort())
  })

  // Der Läufer im Editor soll dasselbe Zeichen tragen wie der Fahrer im Player.
  // Das Studio hat einen eigenen Sprite (studio.html), die Engine ihre MODE_ICONS
  // (src/map.ts) — zwei Orte, ein Bild. Hier wird beides verglichen: dass es je
  // Modus ein Symbol gibt UND dass die Pfade wirklich deckungsgleich sind.
  it('haben im Studio-Sprite ein zeichengleiches Piktogramm', () => {
    const engineQuelle = readFileSync(new URL('../src/map.ts', import.meta.url), 'utf8')
    const engineBlock = engineQuelle.match(/export const MODE_ICONS(?::[^=]+)? = \{([\s\S]*?)\n\}/)
    expect(engineBlock, 'MODE_ICONS in src/map.ts nicht gefunden').not.toBeNull()
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

  // Drift-Wächter: die Reglerstellung ohne eigenen Wert steht zweimal — im
  // Studio (Vorhören, Abspielen, Regler) und im Server, der sie als `gain` ins
  // Tour-JSON schreibt. Laufen sie auseinander, klingt der Film leiser oder
  // lauter als der Schnitt, den man geprüft hat — und man hört es erst im Player.
  it('STUDIO_PEGEL_VORGABE deckt sich mit STUDIO_PEGEL im Server', () => {
    const quelle = readFileSync(new URL('../server/src/schema/edits.ts', import.meta.url), 'utf8')
    const treffer = quelle.match(/STUDIO_PEGEL = ([0-9.]+)/)
    expect(treffer, 'STUDIO_PEGEL in server/src/schema/edits.ts nicht gefunden').not.toBeNull()
    expect(Number(treffer?.[1])).toBe(STUDIO_PEGEL_VORGABE)
  })

  // Und der Server muss ihn UNBEDINGT schreiben: `gain` weglassen hieße im
  // Player 1.0 (kein Wissen über die Studio-Vorgabe), also lauter als der Schnitt.
  it('enrich.ts schreibt gain immer, nicht nur bei gesetztem Wert', () => {
    const quelle = readFileSync(new URL('../server/src/pipeline/enrich.ts', import.meta.url), 'utf8')
    expect(quelle).toMatch(/gain: spur\.lautstaerke \?\? STUDIO_PEGEL/)
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
    // Seit E14 bringt die Achse ihre RAMPEN mit. Bei Radtempo (120 m/s) kostet
    // eine 120-m-Rampe genau eine Filmsekunde. Hier sind es drei: aus dem Stand
    // los, vor dem Halt bremsen, danach wieder anfahren — am Tour-Ende wird
    // nicht gebremst. Der Halt liegt dadurch bei 52 statt 50 Filmsekunden.
    const R = RAMPE_M / tempoMs('bike')
    /**
     * Was eine MODUS-Rampe die ganze Tour kostet: ihre Dauer minus die Reise,
     * die sie ersetzt. Sie liegt ganz im SCHNELLEREN Abschnitt, ersetzt dort
     * also `RAMPE_M` Meter — und kostet damit Zeit, statt welche zu sparen.
     */
    const modusRampeS = (v0: number, v1: number): number =>
      (2 * RAMPE_M) / (v0 + v1) - RAMPE_M / Math.max(v0, v1)

    it('Halte bekommen ihre Standzeit als Achsenbreite', () => {
      expect(gesamt).toBeCloseTo(120 + 3 * R, 1) // 100 s Fahrt + 20 s Halt + 3 Rampen
      // Der Halt belegt (52..72)/123 der Achse
      expect(offsetZuAnteil(achse, 599)).toBeLessThan((50 + 2 * R) / gesamt)
      expect(offsetZuAnteil(achse, 601)).toBeGreaterThan((70 + 2 * R) / gesamt - 0.01)
    })

    it('Sprung-Konventionen: Halt-Zeit → Sprunganfang, Anteil im Sprung → Halt-Zeit', () => {
      expect(offsetZuAnteil(achse, 600)).toBeCloseTo((50 + 2 * R) / gesamt, 4)
      // Mitten im Halt-Sprung steht die Aufnahmezeit still
      expect(anteilZuOffset(achse, (60 + 2 * R) / gesamt)).toBeCloseTo(600, 4)
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
      expect(a2.kurve?.gesamtS).toBeCloseTo(100 + R, 1) // + Anfahrt aus dem Stand
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
      expect(filmZuOffset(achse, 300)).toBeCloseTo(25 + R, 1)
      expect(filmZuOffset(achse, 600)).toBeCloseTo(50 + 2 * R, 1) // Sprunganfang
      expect(filmZuOffset(achse, 1200)).toBeCloseTo(120 + 3 * R, 1)
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
      // Die Schätzung ist die reine REISEzeit — sie kennt die Rampen nicht (und
      // kann sie nicht kennen: wo sie liegen, entscheiden die Halte). Was beide
      // teilen müssen, ist das Tempo-Modell, und genau das prüft die Zeile.
      const gesamtOhneHalt = baueAchse(abschnitte, [], fSkala).kurve?.gesamtS
      expect(gesamtOhneHalt).toBeCloseTo(schaetzeAnimationsdauer(abschnitte, []) + R, 6)
    })

    it('Halte kommen als INTERVALLE zurück — in Aufnahmezeit gibt es sie nicht', () => {
      const gerundet = (a: typeof achse): number[][] =>
        (a.halte ?? []).map((h) => [h.offsetS, h.breiteS, +h.filmVon.toFixed(3), +h.filmBis.toFixed(3)])
      expect(gerundet(achse)).toEqual([[600, 20, 50 + 2 * R, 70 + 2 * R]])
      // `indizes` reicht die Achse unverändert durch (Rückweg zum Stopp)
      const mitId = baueAchse(abschnitte, [{ offsetS: 600, breiteS: 20, indizes: [3] }], fSkala)
      expect(mitId.halte?.[0]?.indizes).toEqual([3])
      // Zwei Halte: der spätere kennt die Filmzeit des früheren schon
      const zwei = baueAchse(
        abschnitte,
        [
          { offsetS: 900, breiteS: 6 },
          { offsetS: 600, breiteS: 20 },
        ],
        fSkala,
      )
      // Der zweite Halt bringt seine eigenen zwei Rampen mit: 75 s Reise + 20 s
      // Standzeit + vier Rampen bis dorthin.
      expect(gerundet(zwei)).toEqual([
        [600, 20, 50 + 2 * R, 70 + 2 * R],
        [900, 6, 95 + 4 * R, 101 + 4 * R],
      ])
      // Halte ohne Breite werden nicht eingewebt und tauchen nicht auf
      expect(baueAchse(abschnitte, [{ offsetS: 600, breiteS: 0 }], fSkala).halte).toEqual([])
    })

    it('haltBeiFilmS sagt, WO im Halt der Kopf steht', () => {
      expect(haltBeiFilmS(achse, 50 + 2 * R - 0.1)).toBeNull()
      const ankunft = haltBeiFilmS(achse, 50 + 2 * R)
      expect(ankunft?.index).toBe(0)
      expect(ankunft?.imHaltS).toBeCloseTo(0, 6)
      expect(ankunft?.restS).toBeCloseTo(20, 6)
      expect(haltBeiFilmS(achse, 62.1 + 2 * R)?.imHaltS).toBeCloseTo(12.1, 6)
      expect(haltBeiFilmS(achse, 62.1 + 2 * R)?.restS).toBeCloseTo(7.9, 6)
      // Die Abfahrt gehört schon zur Weiterfahrt
      expect(haltBeiFilmS(achse, 70.1 + 2 * R)).toBeNull()
      // … außer der Film endet im Halt: dann steht der Kopf bis zuletzt darin
      const amEnde = baueAchse(abschnitte, [{ offsetS: 1200, breiteS: 8 }], fSkala)
      expect(haltBeiFilmS(amEnde, amEnde.kurve!.gesamtS)?.imHaltS).toBeCloseTo(8, 6)
      // Ohne Halte gibt es nichts zu melden
      expect(haltBeiFilmS(baueAchse(abschnitte, [], fSkala), 10)).toBeNull()
    })

    it('ein Halt aus drei Aufnahmen löst sich zu „Aufnahme n von m" auf', () => {
      // Drei Fotos à 5,2 s + 0,8 s Ausblendung = 6 s je Aufnahme, 18 s Halt
      const stuecke = ['m1', 'm2', 'm3'].map((id) => ({ id, dauerS: 6 }))
      const drei = baueAchse(abschnitte, [{ offsetS: 600, breiteS: 18, stuecke }], fSkala)
      const halt = drei.halte?.[0]
      expect(halt?.filmBis! - halt!.filmVon).toBeCloseTo(18, 6)

      // Kopf 8 Filmsekunden nach der Ankunft: zweite Aufnahme, 2 s in ihr drin
      const mitten = haltBeiFilmS(drei, halt!.filmVon + 8)
      expect(mitten?.stueck).toMatchObject({ nr: 2, anzahl: 3, id: 'm2' })
      expect(mitten?.stueck?.imS).toBeCloseTo(2, 6)
      expect(beschreibeHaltStand(mitten!)).toBe('Aufnahme 2 von 3 · 2,0 s von 6,0 s')

      // Kanten: Ankunft ist die erste, kurz vor der Abfahrt die letzte
      expect(haltBeiFilmS(drei, halt!.filmVon)?.stueck?.nr).toBe(1)
      expect(haltBeiFilmS(drei, halt!.filmVon + 17.9)?.stueck?.nr).toBe(3)
      // Eine einzelne Aufnahme braucht kein Zählwerk („Aufnahme 1 von 1")
      const eine = baueAchse(abschnitte, [{ offsetS: 600, breiteS: 6, stuecke: [{ id: 'm1', dauerS: 6 }] }], fSkala)
      expect(beschreibeHaltStand(haltBeiFilmS(eine, eine.halte![0]!.filmVon + 2.5)!)).toBe('2,5 s von 6,0 s')
      // Ohne bekannte Stücke zählt die Zeit im ganzen Halt
      expect(beschreibeHaltStand(haltBeiFilmS(achse, 62.1 + 2 * R)!)).toBe('12,1 s von 20,0 s')
    })

    it('5-Filmsekunden-Schritte überspringen keinen Halt', () => {
      // Der alte Weg rechnete in AUFNAHMEzeit: an einem 6-s-Halt kam man nie
      // vorbei, weil die Rückrechnung immer auf die linke Haltkante fiel.
      const halte = [
        { offsetS: 300, breiteS: 6 },
        { offsetS: 600, breiteS: 6 },
        { offsetS: 900, breiteS: 5.2 },
      ]
      const a = baueAchse(abschnitte, halte, fSkala)
      const besucht = new Set<number>()
      for (let f = 0; f <= a.kurve!.gesamtS; f = schrittFilmS(a, f, 5)) {
        const stand = haltBeiFilmS(a, f)
        if (stand) besucht.add(stand.index)
        if (f >= a.kurve!.gesamtS) break
      }
      expect([...besucht].sort()).toEqual([0, 1, 2])

      // Der Schritt klemmt an den Enden der Achse und geht auch rückwärts
      expect(schrittFilmS(a, 0, -5)).toBe(0)
      expect(schrittFilmS(a, a.kurve!.gesamtS, 5)).toBeCloseTo(a.kurve!.gesamtS, 6)
      expect(schrittFilmS(a, 20, -5)).toBeCloseTo(15, 6)

      // Zum Vergleich der ALTE Weg (Aufnahmezeit als führende Größe): er bleibt
      // an der Haltkante hängen, ein Schritt bringt keine Filmsekunde Gewinn.
      const kante = a.halte![0]!
      const zeitImHalt = anteilZuOffset(a, filmZuAnteil(a, kante.filmVon + 3))
      expect(filmZuAnteil(a, filmZuOffset(a, zeitImHalt))).toBeCloseTo(filmZuAnteil(a, kante.filmVon), 6)
    })

    it('die Achse rechnet ein Video mit seiner echten Länge', () => {
      // Ein 34-s-Video bekam als „Foto" 5,2 s — an einer 293-s-Tour ~34 px
      // statt ~200 px Achsenbreite (docs/architecture/zeitleiste-umbau.md §6).
      expect(aufnahmeHaltS({ type: 'video', dauerS: 34 })).toBe(34)
      // holdS ist bei Video wirkungslos: der Player läuft bis zum Dateiende
      expect(aufnahmeHaltS({ type: 'video', dauerS: 34, display: { holdS: 8 } })).toBe(34)
      // Ohne bekannte Länge (unverarbeiteter Altbestand) bleibt die Annahme
      expect(aufnahmeHaltS({ type: 'video' })).toBe(HALT_ENGINE_S)
      // Fotos bleiben, wie sie waren
      expect(aufnahmeHaltS({ type: 'photo' })).toBe(HALT_ENGINE_S)
      expect(aufnahmeHaltS({ type: 'photo', display: { holdS: 12 } })).toBe(12)

      const video = { id: 'v1', dauerS: aufnahmeHaltS({ type: 'video', dauerS: 34 }) + HALT_AUSBLEND_S }
      const mitVideo = baueAchse(abschnitte, [{ offsetS: 600, breiteS: video.dauerS, stuecke: [video] }], fSkala)
      // 100 s Fahrt + 34,8 s Video statt 100 + 6, dazu die drei Rampen
      expect(mitVideo.kurve?.gesamtS).toBeCloseTo(134.8 + 3 * R, 1)
      expect(mitVideo.halte?.[0]?.breiteS).toBeCloseTo(34.8, 6)
      // … und der Kopf steht mitten im Video, nicht in einer 6-s-Annahme
      expect(haltBeiFilmS(mitVideo, mitVideo.halte![0]!.filmVon + 20)?.stueck?.imS).toBeCloseTo(20, 6)
    })

    it('Szenen-Klips: ein Halt ist eine Kette, jede Aufnahme mit eigener Breite', () => {
      // Drei Aufnahmen am selben Ort: 6 s + 34,8 s Video + 6 s = 46,8 s Halt
      const stuecke = [
        { id: 'm1', dauerS: 6 },
        { id: 'v1', dauerS: 34.8 },
        { id: 'm2', dauerS: 6 },
      ]
      const kette = baueAchse(
        abschnitte,
        [
          { offsetS: 600, breiteS: 46.8, stuecke },
          { offsetS: 900, breiteS: 6, stuecke: [{ id: 'm3', dauerS: 6 }] },
        ],
        fSkala,
      )
      const klips = baueSzenenKlips(kette)
      expect(klips.map((k) => k.id)).toEqual(['m1', 'v1', 'm2', 'm3'])
      // Lückenlos aneinander, jeder mit seiner eigenen Filmbreite
      const halt = kette.halte![0]!
      expect(klips[0]!.filmVon).toBeCloseTo(halt.filmVon, 6)
      expect(klips[0]!.filmBis).toBeCloseTo(klips[1]!.filmVon, 6)
      expect(klips[1]!.filmBis - klips[1]!.filmVon).toBeCloseTo(34.8, 6)
      expect(klips[2]!.filmBis).toBeCloseTo(halt.filmBis, 6)
      // Der Platz in der Kette ist der Rückweg zum Halt
      expect(klips.map((k) => [k.haltIndex, k.platz, k.anzahl])).toEqual([
        [0, 0, 3],
        [0, 1, 3],
        [0, 2, 3],
        [1, 0, 1],
      ])
      // Halte ohne bekannte Stücke (Kamera-Momente) haben keine Klips
      expect(baueSzenenKlips(baueAchse(abschnitte, [{ offsetS: 600, breiteS: 6 }], fSkala))).toEqual([])
    })

    it('die Karte steht so lange wie ihr Klip — dieselbe Größe, nicht zwei', () => {
      // Die Foto-Einblendung hängt an der Kopfposition (`haltBeiFilmS`), die
      // Klips an `baueSzenenKlips` — beide lesen dieselben Stücke der Achse.
      // Vorher lief ein Timer über die reine STANDZEIT, der Klip aber über
      // Standzeit + Ausblendung: das Bild ging 0,8 s vor seinem Klip aus.
      const stuecke = [
        { id: 'm1', dauerS: HALT_ENGINE_S + HALT_AUSBLEND_S },
        { id: 'm2', dauerS: 12 + HALT_AUSBLEND_S },
      ]
      const breite = stuecke.reduce((s2, x) => s2 + x.dauerS, 0)
      const a = baueAchse(abschnitte, [{ offsetS: 600, breiteS: breite, stuecke }], fSkala)
      for (const k of baueSzenenKlips(a)) {
        // Kurz vor der rechten Kante läuft die Karte noch …
        const drin = haltBeiFilmS(a, k.filmBis - 0.01)
        expect(drin?.stueck?.id).toBe(k.id)
        expect(drin!.stueck!.dauerS).toBeCloseTo(k.filmBis - k.filmVon, 6)
        // … und an der Ankunft gehört sie schon dem Klip selbst
        expect(haltBeiFilmS(a, k.filmVon + 0.01)?.stueck?.id).toBe(k.id)
      }
      // Hinter dem letzten Klip ist die Karte weg — nicht davor
      expect(haltBeiFilmS(a, a.halte![0]!.filmBis)).toBeNull()
    })

    it('Klip-Zug in der Kette: der Platz entscheidet sich an der MITTE', () => {
      const stuecke = ['a', 'b', 'c'].map((id) => ({ id, dauerS: 6 }))
      const kette = baueAchse(abschnitte, [{ offsetS: 600, breiteS: 18, stuecke }], fSkala)
      const halt = kette.halte![0]!
      // Vor der Mitte des ersten Klips: Platz 0, die Marke steht an der Ankunft
      expect(platzInKette(halt, halt.filmVon + 1)).toEqual({ platz: 0, filmS: halt.filmVon })
      // Über die Mitte hinaus rutscht sie eine Fuge weiter
      expect(platzInKette(halt, halt.filmVon + 4)).toEqual({ platz: 1, filmS: halt.filmVon + 6 })
      expect(platzInKette(halt, halt.filmVon + 10)).toEqual({ platz: 2, filmS: halt.filmVon + 12 })
      // Ganz hinten: Platz 3 von 3 (die Fuge hinter dem letzten Klip)
      expect(platzInKette(halt, halt.filmBis)).toEqual({ platz: 3, filmS: halt.filmBis })

      // … und daraus wird die neue Reihenfolge. Nach hinten geschoben rückt
      // alles dazwischen um eins vor — ohne das landete a immer zu weit rechts.
      expect(ordneEin(['a', 'b', 'c'], 'a', 0)).toEqual(['a', 'b', 'c'])
      expect(ordneEin(['a', 'b', 'c'], 'a', 1)).toEqual(['a', 'b', 'c'])
      expect(ordneEin(['a', 'b', 'c'], 'a', 2)).toEqual(['b', 'a', 'c'])
      expect(ordneEin(['a', 'b', 'c'], 'a', 3)).toEqual(['b', 'c', 'a'])
      expect(ordneEin(['a', 'b', 'c'], 'c', 0)).toEqual(['c', 'a', 'b'])
      // Unbekannte ID lässt die Liste in Ruhe
      expect(ordneEin(['a', 'b'], 'x', 0)).toEqual(['a', 'b'])
    })

    it('Andocken: nur das INNERE eines fremden Halts zählt', () => {
      const halt = achse.halte![0]!
      expect(haltInnenBei(achse, halt.filmVon - 0.1)).toBeNull()
      // Die Ankunft gehört noch der Fahrt: dort setzt man eine Aufnahme davor ab
      expect(haltInnenBei(achse, halt.filmVon)).toBeNull()
      expect(haltInnenBei(achse, halt.filmVon + 0.1)?.offsetS).toBe(600)
      expect(haltInnenBei(achse, halt.filmBis - 0.1)?.offsetS).toBe(600)
      // Die Abfahrt ebenso — sonst käme man hinter dem Halt nie zum Stehen
      expect(haltInnenBei(achse, halt.filmBis)).toBeNull()
      expect(haltInnenBei(baueAchse(abschnitte, [], fSkala), 10)).toBeNull()
    })

    it('Standzeit am Griff: Zehntel und die Grenzen des Server-Schemas', () => {
      expect(klemmeStandzeit(7.34)).toBe(7.3)
      expect(klemmeStandzeit(7.36)).toBe(7.4)
      // Ohne Klemme liefe der Griff in einen Wert, den das Speichern ablehnt
      expect(klemmeStandzeit(-40)).toBe(STANDZEIT_MIN_S)
      expect(klemmeStandzeit(999)).toBe(STANDZEIT_MAX_S)
      expect(formatiereSekunden(5.2)).toBe('5,2 s')
    })

    it('Moment-Dauer am Griff: dieselbe Geste, die Grenzen des Moment-Schemas', () => {
      // Ein Moment ist seit dem Nachtrag zu Etappe 2 ein Klip der Szenen-Bahn
      // und hat damit denselben rechten Griff wie ein Foto — nur andere
      // Grenzen (schema/edits.ts: 1..30 statt 2..60).
      expect(klemmeMomentDauer(6.34)).toBe(6.3)
      expect(klemmeMomentDauer(0)).toBe(MOMENT_MIN_S)
      expect(klemmeMomentDauer(999)).toBe(MOMENT_MAX_S)
    })

    it('Fortbewegungs-Zug: die Grenze landet, wo sie losgelassen wurde (Fixpunkt)', () => {
      // Die Grenze beeinflusst die Abbildung, auf der sie liegt — mit der Achse
      // des Vorframes gerechnet sprang sie beim Loslassen 116 px (docs §6).
      // Die Zug-Kurve rechnet stattdessen, was VOR der Kante liegt: das ändert
      // sich beim Ziehen nicht, also ist sie exakt umkehrbar. Erst dadurch darf
      // der Zug live ins Modell schreiben — die Kante steht nach jedem
      // Neuaufbau wieder unter dem Zeiger.
      const halte = [{ offsetS: 300, breiteS: 12 }]
      const a = baueAchse(abschnitte, halte, fSkala)
      const kurve = baueGrenzKurve(fahrTrack, fSkala.vonS, fSkala.bisS, { davor: null, links: 'walk', rechts: 'bike' }, 0, a.halte ?? [])!

      // Die PROBE, die der Live-Zug macht: Zeit aus der Kurve holen, damit die
      // Achse NEU bauen — und die Kante muss wieder auf derselben Filmsekunde
      // stehen. (Ohne die Kurve wich das um bis zu 5,4 s ab.)
      const achseMitGrenze = (t: number): Achse =>
        baueAchse(
          zerlegeFuerAnzeige(
            [{ mode: 'bike', pts: fahrTrack }],
            { schema: 'maptale/edits@1', modi: [{ ab: iso(fSkala.vonS), mode: 'walk' }, { ab: iso(t), mode: 'bike' }] },
            START,
          ),
          halte,
          fSkala,
        )
      // Die Restabweichung ist die SEKUNDENRUNDUNG des Ankers: `offsetZuIso`
      // schneidet die Millisekunden ab, eine Sekunde Aufnahmezeit sind hier
      // 0,05 Filmsekunden (zu Fuß ≈ 0,2 px). Darunter geht es nicht, und mehr
      // braucht es nicht.
      // Ziele als ANTEILE der Zug-Kurve, nicht als feste Sekunden: Sonst hängt
      // der Test daran, wie schnell zu Fuß gerade ist.
      for (const ziel of [0.12, 0.36, 0.7, 0.95].map((f) => f * kurve.gesamtS)) {
        const t = zeitBeiFilm(kurve, ziel)
        expect(Math.abs(filmZuOffset(achseMitGrenze(t), t) - ziel)).toBeLessThan(0.1)
      }

      // Monoton und im Fenster geklemmt
      expect(zeitBeiFilm(kurve, -50)).toBeCloseTo(fSkala.vonS, 6)
      expect(zeitBeiFilm(kurve, 1e6)).toBeCloseTo(fSkala.bisS, 6)
      // Der Halt im Fenster kostet Filmzeit, ohne von der Grenze abzuhängen —
      // dazu seine beiden Rampen und die Anfahrt aus dem Stand (zu Fuß 2,5 s je
      // Rampe).
      // Dazu der halbe Rampen-Versatz der gezogenen Kante selbst: Ihre Rampe
      // liegt zur Hälfte VOR ihr und wird nicht mehr im linken Tempo gefahren.
      expect(kurve.gesamtS).toBeCloseTo(
        12 + 12000 / tempoMs('walk') + (3 * RAMPE_M) / tempoMs('walk') + rampenVersatzS(tempoMs('walk'), tempoMs('bike')),
        1,
      )
      expect(baueGrenzKurve([], 0, 10, { davor: null, links: 'walk', rechts: 'bike' }, 0, [])).toBeNull()
    })

    it('Filmdauer-Vorschau: nur die umgewidmete Strecke ändert sich', () => {
      // Moped (1,15) → Fähre (2,5): dieselbe Strecke braucht weniger Film.
      const meterAlt = 0
      const meterNeu = 12000
      const laenger = filmDauerBeiGrenze(200, meterAlt, meterNeu, 'walk', 'bike')
      // 12 km wechseln von Rad auf zu Fuß — die Differenz der Kehrwerte der Tempi
      const mehr = 12000 / tempoMs('walk') - 12000 / tempoMs('bike')
      expect(laenger).toBeCloseTo(200 + mehr, 3)
      // Zurückgezogen kehrt sich das Vorzeichen um
      expect(filmDauerBeiGrenze(200, meterNeu, meterAlt, 'walk', 'bike')).toBeCloseTo(200 - mehr, 3)
      // Gleicher Modus links wie rechts ändert nichts
      expect(filmDauerBeiGrenze(200, 0, 5000, 'bike', 'bike')).toBeCloseTo(200, 6)
    })

    it('Einrasten an Haltkanten: ±0,5 s Aufnahmezeit, „dahinter" strikt danach', () => {
      const a = baueAchse(abschnitte, [{ offsetS: 600, breiteS: 20 }], fSkala)
      const halte = a.halte!
      const halt = halte[0]!
      // Knapp davor: rastet auf die Halt-Zeit selbst (= vor dem Sprung)
      expect(rasteAnHalt(halte, 599.7, halt.filmVon - 0.3)).toMatchObject({ tOffsetS: 600, hinter: false })
      // Knapp dahinter: STRIKT nach der Haltzeit — ein Epsilon fiele auf
      // dieselbe Sekunde zurück (ISO-Anker sind sekundengenau).
      expect(rasteAnHalt(halte, 600.3, halt.filmBis + 0.3)).toMatchObject({ tOffsetS: 600 + RAST_HINTER_S, hinter: true })
      // Außerhalb der Toleranz bleibt die Zeit, wie sie ist
      expect(rasteAnHalt(halte, 597, halt.filmVon - 40)).toEqual({ tOffsetS: 597, halt: null, hinter: false })
      // MITTEN im Halt gibt es keine Zwischenposition — die Zeigerhälfte entscheidet
      expect(rasteAnHalt(halte, 600, halt.filmVon + 1).hinter).toBe(false)
      expect(rasteAnHalt(halte, 600, halt.filmBis - 1).hinter).toBe(true)
    })

    it('Mitten in einem Halt gibt es keine Zeit — dort MUSS gerastet werden', () => {
      // Zeigt der Zeiger auf eine Filmsekunde INNERHALB eines Halts, liefert die
      // Umkehrung dessen Zeit — und die Hin-Richtung fällt per lower_bound auf
      // seine LINKE Flanke zurück. Ohne Rasten spränge die Kante beim Loslassen
      // um bis zu eine ganze Standzeit (gemessen 5,4 s / 17,6 px); genau
      // deshalb ist das Einrasten hier keine Bequemlichkeit, sondern die
      // einzige Art, in einem Halt überhaupt eine Position zu benennen.
      const a = baueAchse(abschnitte, [{ offsetS: 600, breiteS: 12 }], fSkala)
      const halte = a.halte!
      const halt = halte[0]!
      const mitten = halt.filmVon + 6

      // Roh: nicht umkehrbar
      const roh = anteilZuOffset(a, filmZuAnteil(a, mitten))
      expect(filmZuOffset(a, roh)).toBeCloseTo(halt.filmVon, 6)
      // Gerastet: die rechte Flanke, und die ist umkehrbar
      const kur = rasteAnHalt(halte, roh, mitten)
      expect(kur.hinter).toBe(true)
      expect(kur.tOffsetS).toBe(600 + RAST_HINTER_S)
      expect(filmZuOffset(a, kur.tOffsetS)).toBeGreaterThanOrEqual(halt.filmBis)

      // Außerhalb jedes Halts bleibt die Zeit unangetastet — der Fixpunkt
      const frei = halt.filmVon - 20
      const freiT = anteilZuOffset(a, filmZuAnteil(a, frei))
      expect(rasteAnHalt(halte, freiT, frei).tOffsetS).toBeCloseTo(freiT, 6)
      expect(filmZuOffset(a, freiT)).toBeCloseTo(frei, 6)
    })

    it('Klemmen in PIXELN hält das Band greifbar', () => {
      // Mit ±1 s konnten zwei Grenzen so nah zusammenrücken, dass das Band
      // dazwischen unsichtbar und unanfassbar wurde.
      const px = 10 // 10 px je Filmsekunde → 14 px = 1,4 s Mindestabstand
      expect(klemmeFilmS(50, 40, 100, px)).toBe(50)
      expect(klemmeFilmS(40, 40, 100, px)).toBeCloseTo(40 + BAND_MIN_PX / px, 6)
      expect(klemmeFilmS(1000, 40, 100, px)).toBeCloseTo(100 - BAND_MIN_PX / px, 6)
      // Stark gezoomt schrumpft die Luft in Sekunden — die Pixel bleiben gleich
      expect(klemmeFilmS(40, 40, 100, 100)).toBeCloseTo(40.14, 6)
      // Fenster schmaler als zweimal Luft: nur die Mitte bleibt übrig
      expect(klemmeFilmS(41, 40, 42, px)).toBe(41)
    })

    // — Der ganze Loslass-Weg, DOM-frei nachgebaut —
    //
    // Die Bausteine sind einzeln geprüft (Grenzkurve, Rasten, Klemmen). Was
    // schiefging, war ihr ZUSAMMENSPIEL: gemischte Koordinatensysteme, die
    // Sekundenrundung des ISO-Ankers, die Klemme gegen den Nachbarn. Deshalb
    // fahren die folgenden Tests die Kette so ab, wie `kantenZugBewegen` sie
    // fährt — klemmen → rasten → schreiben → Achse NEU bauen — und messen am
    // Ende dort, wo der Nutzer hinsieht: an der fertigen Leiste.
    describe('Kantenzug: wo die Grenze landet', () => {
      const halte = [{ offsetS: 600, breiteS: 20 }]
      /** Achse aus einem Overlay — genau das, was der Editor je Frame neu baut. */
      const achseVon = (edits: EditOverlay): Achse =>
        baueAchse(zerlegeFuerAnzeige([{ mode: 'bike', pts: fahrTrack }], edits, START), halte, fSkala)

      /** `verschiebeGrenze('modus', …)` aus editor.ts, ohne Zustand. */
      function schreibeGrenze(edits: EditOverlay, altAb: string, zielS: number): { edits: EditOverlay; ab: string } {
        const geklemmt = klemmeGrenze(
          edits.modi ?? [],
          altAb,
          START,
          Math.max(fSkala.vonS, Math.min(fSkala.bisS, zielS)),
        )
        const neuAb = iso(geklemmt)
        if (neuAb === altAb) return { edits, ab: altAb }
        const alt = edits.modi?.find((g) => g.ab === altAb)
        if (!alt || edits.modi?.some((g) => g.ab === neuAb)) return { edits, ab: altAb }
        return { edits: mitModusGrenze(ohneModusGrenze(edits, altAb), neuAb, alt.mode), ab: neuAb }
      }

      /** Ein Zieh-Frame: Zeiger zeigt auf `zielFilmS`. */
      function ziehFrame(
        edits: EditOverlay,
        ab: string,
        zielFilmS: number,
        zug: { vonS: number; bisS: number; minFilmS: number; maxFilmS: number; zeitBei: (f: number) => number },
        pxProFilmS: number,
      ): { edits: EditOverlay; ab: string; gerastet: boolean; hinter: boolean } {
        const achse = achseVon(edits)
        const filmS = klemmeFilmS(zielFilmS, zug.minFilmS, zug.maxFilmS, pxProFilmS)
        // Gerastet wird an den Halten, wie sie JETZT auf der Leiste stehen
        const sichtbar = (achse.halte ?? []).filter((h) => h.offsetS > zug.vonS && h.offsetS <= zug.bisS)
        const rast = rasteAnHalt(sichtbar, anteilZuOffset(achse, filmZuAnteil(achse, filmS)), filmS)
        const ziel = rast.halt ? rast.tOffsetS : zug.zeitBei(filmS)
        return { ...schreibeGrenze(edits, ab, ziel), gerastet: !!rast.halt, hinter: rast.hinter }
      }

      /** Zug-Start für eine Fortbewegungs-Kante bei `kanteS` (Vorgänger bei `vonS`). */
      function starte(edits: EditOverlay, kanteS: number, vonS: number, links: Modus, rechts: Modus, davor: Modus | null = null) {
        const achse = achseVon(edits)
        const kurve = baueGrenzKurve(fahrTrack, vonS, fSkala.bisS, { davor, links, rechts }, filmZuOffset(achse, vonS), achse.halte ?? [])!
        return {
          vonS,
          bisS: fSkala.bisS,
          minFilmS: filmZuOffset(achse, vonS),
          maxFilmS: kurve.gesamtS,
          zeitBei: (f: number): number => zeitBeiFilm(kurve, f),
        }
      }

      /** Filmsekunde, auf der die Kante nach dem Loslassen steht. */
      const landung = (edits: EditOverlay, ab: string): number =>
        filmZuOffset(achseVon(edits), isoZuOffset(START, ab))

      // Eine Aufnahme-Sekunde ist die feinste Auflösung, die ein Overlay-Anker
      // hat (`offsetZuIso` schneidet die Millisekunden ab) — mehr Genauigkeit
      // ist gar nicht speicherbar. In Filmsekunden hängt sie am Tempo: der
      // Track läuft mit 10 m/s, zu Fuß sind das 0,21 Filmsekunden je
      // Aufnahmesekunde (≈ 2 px), mit dem Rad 0,08.
      const RUNDUNG_WALK_S = 10 / (120 * 0.4)
      const RUNDUNG_BIKE_S = 10 / 120

      it('(a) Fortbewegung: die Kante landet auf der Filmsekunde, auf die gezogen wurde', () => {
        // Die Fortbewegung ist der harte Fall: ihr Tempo ändert die Achse, auf
        // der sie selbst liegt. Gemessen wird deshalb NICHT die Zwischenrechnung,
        // sondern die fertige Leiste — dieselbe Probe, die der Nutzer macht.
        const start: EditOverlay = {
          schema: 'maptale/edits@1',
          modi: [
            { ab: iso(0), mode: 'walk' },
            { ab: iso(600), mode: 'bike' },
          ],
        }
        const zug = starte(start, 600, 0, 'walk', 'bike')

        for (const ziel of [20, 40, 100, 200]) {
          const f = ziehFrame(start, iso(600), ziel, zug, 10)
          expect(f.gerastet).toBe(false) // fern jedes Halts — hier gilt der Fixpunkt
          expect(Math.abs(landung(f.edits, f.ab) - ziel)).toBeLessThan(RUNDUNG_WALK_S + 0.01)
        }

        // Und über viele Frames hinweg: der Zug schreibt live, jeder Frame baut
        // auf dem vorigen auf — die Kante darf dabei nicht davonwandern.
        let stand = { edits: start, ab: iso(600) }
        for (const ziel of [200, 150, 100, 60, 100, 150, 200]) {
          const f = ziehFrame(stand.edits, stand.ab, ziel, zug, 10)
          stand = { edits: f.edits, ab: f.ab }
          if (f.gerastet) continue // Rasten ist die eine gewollte Ausnahme (s. u.)
          expect(Math.abs(landung(stand.edits, stand.ab) - ziel)).toBeLessThan(RUNDUNG_WALK_S + 0.01)
        }
        // Am Ende der Bewegung steht die Kante wieder genau unter dem Zeiger
        expect(Math.abs(landung(stand.edits, stand.ab) - 200)).toBeLessThan(RUNDUNG_WALK_S + 0.01)
      })

      it('(a) Ausnahme: in einen Halt VOR sich kann die Fortbewegungs-Kante nicht landen', () => {
        // Der einzige Fall, in dem die Kante nicht unter dem Zeiger bleibt —
        // und er ist keine Rechenschwäche, sondern die Sache selbst: Ein Halt
        // RECHTS der Kante liegt auf einer Filmposition, die von der Filmzeit
        // VOR ihm abhängt — also von der Kante. Zieht man die Kante in ihn
        // hinein, rutscht er im selben Zug nach hinten weg. Einen Fixpunkt
        // gibt es dafür nicht: „vor dem Halt" und „auf dem Pixel, wo der Halt
        // gerade gezeichnet ist" sind hier zwei verschiedene Orte.
        const start: EditOverlay = {
          schema: 'maptale/edits@1',
          modi: [
            { ab: iso(0), mode: 'walk' },
            { ab: iso(288), mode: 'bike' },
          ],
        }
        const zug = starte(start, 288, 0, 'walk', 'bike')
        const halt = achseVon(start).halte![0]!
        // 60 s Fußweg + 26 s Rad bis zum Halt, dazu die Anfahrt aus dem Stand
        // (+2,5 s), das Bremsen vor dem Halt (+1 s) und die Rampe an der
        // Modus-Grenze selbst, die etwas EINSPART.
        // 2880 m zu Fuß + 3120 m mit dem Rad bis zum Halt
        const bis =
          2880 / tempoMs('walk') +
          3120 / tempoMs('bike') +
          RAMPE_M / tempoMs('walk') +
          RAMPE_M / tempoMs('bike') +
          modusRampeS(tempoMs('walk'), tempoMs('bike'))
        expect(halt.filmVon).toBeCloseTo(bis, 6) // rechts der Kante
        expect(halt.filmBis).toBeCloseTo(bis + 20, 6)

        const f = ziehFrame(start, iso(288), halt.filmVon + 10, zug, 10)
        expect(f.gerastet).toBe(true)
        expect(isoZuOffset(START, f.ab)).toBe(600 + RAST_HINTER_S)
        // Der Halt ist mitgewandert (mehr Fußweg davor) — die Kante steht
        // dahinter, nicht mehr auf dem angepeilten Pixel.
        // Alles bis zum Halt ist jetzt Fußweg: 6000 m plus Anfahrt und Bremsen.
        expect(achseVon(f.edits).halte![0]!.filmVon).toBeCloseTo(
          6000 / tempoMs('walk') + (2 * RAMPE_M) / tempoMs('walk'),
          6,
        )

        // Wichtig ist nur, dass sich das im nächsten Frame FÄNGT: der Zeiger
        // liegt jetzt links des Halts, also gilt wieder der Fixpunkt. Es
        // pendelt nicht — ein Halt liegt in ruhiger Lage stets RECHTS der
        // Kante, ein Dauerflackern ist damit ausgeschlossen.
        const f2 = ziehFrame(f.edits, f.ab, halt.filmVon + 10, zug, 10)
        expect(f2.gerastet).toBe(false)
        expect(Math.abs(landung(f2.edits, f2.ab) - (halt.filmVon + 10))).toBeLessThan(RUNDUNG_WALK_S + 0.01)
      })

      it('(a) Kamera: ohne Rückwirkung auf die Achse landet die Kante exakt', () => {
        // Kamera und Wetter ändern die Filmdauer nicht — hier ist `zeitBei` die
        // Achse selbst, und die Landung muss auf das Tausendstel stimmen.
        const achse = achseVon(LEERES_OVERLAY)
        for (const ziel of [10, 35, 90, 115]) {
          const t = anteilZuOffset(achse, filmZuAnteil(achse, ziel))
          // außerhalb der Halt-Sprungs bleibt die Umkehrung exakt
          if (haltInnenBei(achse, ziel)) continue
          expect(filmZuOffset(achse, t)).toBeCloseTo(ziel, 3)
        }
      })

      it('(b) Einrasten trifft die Seite, auf die gezeigt wird', () => {
        const start: EditOverlay = {
          schema: 'maptale/edits@1',
          modi: [
            { ab: iso(0), mode: 'walk' },
            { ab: iso(300), mode: 'bike' },
          ],
        }
        const zug = starte(start, 300, 0, 'walk', 'bike')
        const halt = achseVon(start).halte!.find((h) => h.offsetS === 600)!

        // Vordere Hälfte des Halts → die Grenze landet VOR ihm: er läuft
        // vollständig im neuen Zustand ab.
        const vorne = ziehFrame(start, iso(300), halt.filmVon + 1, zug, 10)
        expect(vorne).toMatchObject({ gerastet: true, hinter: false })
        expect(isoZuOffset(START, vorne.ab)).toBe(600)
        const aVorne = achseVon(vorne.edits)
        expect(landung(vorne.edits, vorne.ab)).toBeCloseTo(aVorne.halte![0]!.filmVon, 6)

        // Hintere Hälfte → dahinter, und zwar eine GANZE Sekunde: ein Epsilon
        // fiele durch die Sekundenrundung des Ankers wieder davor.
        const hinten = ziehFrame(start, iso(300), halt.filmBis - 1, zug, 10)
        expect(hinten).toMatchObject({ gerastet: true, hinter: true })
        expect(isoZuOffset(START, hinten.ab)).toBe(600 + RAST_HINTER_S)
        const aHinten = achseVon(hinten.edits)
        expect(landung(hinten.edits, hinten.ab)).toBeGreaterThanOrEqual(aHinten.halte![0]!.filmBis)

        // Der Halt bleibt dabei ein Halt — er wird nicht zerschnitten
        expect(aHinten.halte![0]!.filmBis - aHinten.halte![0]!.filmVon).toBeCloseTo(20, 6)
      })

      it('(c) zwei Grenzen können nicht unter die Mindestbreite zusammenrücken', () => {
        const px = 10
        const start: EditOverlay = {
          schema: 'maptale/edits@1',
          modi: [
            { ab: iso(0), mode: 'walk' },
            { ab: iso(300), mode: 'bike' },
            { ab: iso(900), mode: 'jeep' },
          ],
        }
        // Die hintere Kante ganz nach links gezogen — auf ihren Vorgänger
        const zug = starte(start, 900, 300, 'bike', 'jeep', 'walk')
        const gezogen = ziehFrame(start, iso(900), -1000, zug, px)
        const neu = achseVon(gezogen.edits)
        const breitePx = (landung(gezogen.edits, gezogen.ab) - filmZuOffset(neu, 300)) * px
        // Mindestens ein greifbares Band — bis auf die Sekundenrundung des Ankers
        expect(breitePx).toBeGreaterThan(BAND_MIN_PX - RUNDUNG_BIKE_S * px - 0.01)
        expect(breitePx).toBeLessThan(BAND_MIN_PX + 1)

        // Ohne die Pixel-Klemme wäre das Band verschwunden — unsichtbar UND
        // nicht mehr anzufassen (das war der Bug, den BAND_MIN_PX behebt).
        const ohneKlemme = schreibeGrenze(start, iso(900), zug.zeitBei(zug.minFilmS))
        const aOhne = achseVon(ohneKlemme.edits)
        const engPx = (filmZuOffset(aOhne, isoZuOffset(START, ohneKlemme.ab)) - filmZuOffset(aOhne, 300)) * px
        expect(engPx).toBeLessThan(2)

        // Und die vordere Grenze steht danach unverändert da: was VOR der
        // gezogenen Kante liegt, rührt der Zug nicht an.
        expect(filmZuOffset(neu, 300)).toBeCloseTo(filmZuOffset(achseVon(start), 300), 6)
      })
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
      // Erster Abschnitt (50 s Fahrt + 20 s Halt + drei Rampen) spielt, der
      // getrimmte nicht
      const bisTrim = 70 + 3 * R
      expect(spiel.gesamtS).toBeCloseTo(bisTrim, 1)
      expect(filmBei(spiel, 1)).toBeCloseTo(bisTrim, 1)
      // Hinter der Trim-Grenze wächst die Spielzeit nicht mehr (Plateau)
      const grenzAnteil = offsetZuAnteil(a2, 600)
      expect(filmBei(spiel, grenzAnteil + 0.1)).toBeCloseTo(bisTrim, 1)
    })
  })

  describe('Undo: ein Zug ist ein Schritt', () => {
    // Der Editor setzt Undo-Punkte per REFERENZvergleich beim Voll-Render
    // (`letzterStand`). Ein Zeitleisten-Zug schreibt je Frame ein neues
    // Overlay, ruft dazwischen aber nur `renderNachZug()` — der Stand wird
    // dort nicht fortgeschrieben. Genau dieses Zusammenspiel ist hier
    // nachgebaut: `rendere()` steht für `renderAlles`, alles andere für die
    // Frames dazwischen.
    const start = () => {
      const stapel = { historie: [] as EditOverlay[], zukunft: [] as EditOverlay[] }
      let letzterStand: EditOverlay | null = null
      let edits: EditOverlay = LEERES_OVERLAY
      const rendere = (): void => {
        erfasseUndo(stapel, letzterStand, edits)
        letzterStand = edits
      }
      rendere() // Editor geöffnet
      return {
        stapel,
        rendere,
        get edits() {
          return edits
        },
        set edits(e: EditOverlay) {
          edits = e
        },
      }
    }

    it('ein Klip-Zug über viele Frames erzeugt genau EINEN Undo-Schritt', () => {
      const e = start()
      const vorher = e.edits
      // 12 Zieh-Frames: jeder schreibt live ins Overlay (die Leiste wird ja in
      // den Zielzustand gesetzt), aber KEIN Voll-Render dazwischen.
      for (let i = 0; i < 12; i++) e.edits = mitMedienEdit(e.edits, 'm1', { anchor: [9 + i / 1000, 47] })
      expect(e.stapel.historie).toHaveLength(0)
      e.rendere() // Loslassen
      expect(e.stapel.historie).toHaveLength(1)
      // Und der eine Schritt führt genau vor den Zug zurück
      expect(e.stapel.historie[0]).toBe(vorher)

      // Ein zweiter Zug legt genau einen weiteren Schritt ab
      const zwischen = e.edits
      for (let i = 0; i < 5; i++) e.edits = mitMedienEdit(e.edits, 'm1', { display: { holdS: 6 + i } })
      e.rendere()
      expect(e.stapel.historie).toHaveLength(2)
      expect(e.stapel.historie[1]).toBe(zwischen)
    })

    it('ein Zug, der nichts ändert, ist auch kein Schritt', () => {
      // `reiheVergeben` schriebe auch für eine unveränderte Reihenfolge ein
      // neues Overlay — und das wäre ein Undo-Schritt, den man später einmal
      // umsonst rückgängig macht. Der Editor schreibt deshalb gar nicht erst.
      const e = start()
      e.rendere()
      e.rendere()
      expect(e.stapel.historie).toHaveLength(0)
    })

    it('eine neue Änderung verwirft die Redo-Zukunft', () => {
      const e = start()
      e.stapel.zukunft.push(LEERES_OVERLAY)
      e.edits = mitMedienEdit(e.edits, 'm1', { caption: 'Hafen' })
      e.rendere()
      expect(e.stapel.historie).toHaveLength(1)
      expect(e.stapel.zukunft).toHaveLength(0)
    })

    it('die Historie wächst nicht über HISTORIE_MAX, der jüngste Stand bleibt', () => {
      const e = start()
      for (let i = 0; i < HISTORIE_MAX + 5; i++) {
        e.edits = mitMedienEdit(e.edits, 'm1', { caption: `s${i}` })
        e.rendere()
      }
      expect(e.stapel.historie).toHaveLength(HISTORIE_MAX)
      expect(e.stapel.historie[HISTORIE_MAX - 1]?.medien?.['m1']?.caption).toBe(`s${HISTORIE_MAX + 3}`)
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
    const gesamtS = achse.kurve!.gesamtS // 120 s + drei Rampen à 1 s
    const marken = baueFilmMassband(achse, 5) // 123 s × 5 px/s → 15-s-Stufe
    expect(marken.map((m) => m.text)).toEqual(['0:00', '0:15', '0:30', '0:45', '1:00', '1:15', '1:30', '1:45', '2:00'])
    // film-linear ⇒ äquidistant
    for (let i = 1; i < marken.length; i++) {
      expect((marken[i]?.anteil ?? 0) - (marken[i - 1]?.anteil ?? 0)).toBeCloseTo(15 / gesamtS, 6)
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

// — Video-Schnitt: die Leiste zeigt, was der Server schneidet (Etappe 4, §2F) —

describe('klemmeVideoTrim (Drift-Wächter gegen video.ts)', () => {
  it('hat an BEIDEN Kanten das Material als Anschlag', () => {
    expect(klemmeVideoTrim({ vonS: 2, bisS: 100 }, 30)).toEqual({ vonS: 2, bisS: 30 })
    expect(klemmeVideoTrim({ vonS: -5, bisS: 100 }, 30)).toBeNull() // = ganze Datei
    expect(klemmeVideoTrim({ vonS: 50, bisS: 60 }, 30)).toBeNull()
    expect(klemmeVideoTrim({ vonS: 4 }, 30)).toEqual({ vonS: 4, bisS: 30 })
    expect(klemmeVideoTrim(undefined, 30)).toBeNull()
  })

  it('deckt sich mit der Klemmung, die der Server anwendet', () => {
    // Die Regeln stehen zweimal: Der Server MUSS klemmen (er schneidet), die
    // Leiste SOLL dieselbe Breite zeigen. Laufen sie auseinander, plant man
    // einen Schnitt und sieht später einen anderen.
    const quelle = readFileSync(new URL('../server/src/pipeline/video.ts', import.meta.url), 'utf8')
    expect(quelle).toMatch(/if \(!\(bisS - vonS > 0\.05\)\) return null/)
    expect(VIDEO_TRIM_MIN_S).toBe(0.05)
    // Der Vollschnitt gilt auf beiden Seiten als „kein Schnitt"
    expect(quelle).toMatch(/if \(vonS <= 0 && bisS >= dauerS\) return null/)
  })

  it('macht den Ripple zur Folge der Breite, nicht zu eigenem Code', () => {
    // Ein Video liegt in einer Halt-Kette ohne Lücken: wird es kürzer, wird sein
    // Halt schmaler und alles Folgende rückt vor. Es gibt keinen Ripple-Zweig.
    const ganz = aufnahmeHaltS({ type: 'video', dauerS: 34 })
    const geschnitten = aufnahmeHaltS({ type: 'video', dauerS: 34, trim: { vonS: 6, bisS: 20 } })
    expect(ganz).toBe(34)
    expect(geschnitten).toBe(14)
    expect(videoFilmS(34, { vonS: 0, bisS: 34 })).toBe(34) // Vollschnitt ändert nichts
  })

  it('lässt einen Foto-Halt unberührt — dort gibt es nichts zu schneiden', () => {
    expect(aufnahmeHaltS({ type: 'photo', trim: { vonS: 2, bisS: 3 } })).toBe(HALT_ENGINE_S)
  })
})

describe('videoStandS: der Klip ist länger als das Material', () => {
  it('klemmt am Materialende statt über die Dauer hinaus zu zielen', () => {
    // Mitten im Video: unverändert die Kopfposition
    expect(videoStandS(0, 34, 12).zielS).toBeCloseTo(12, 6)
    expect(videoStandS(0, 34, 12).ausgelaufen).toBe(false)
    // In der Ausblendung (Klip = 34 + HALT_AUSBLEND_S): das Material ist zu Ende
    const inDerAusblendung = videoStandS(0, 34, 34 + HALT_AUSBLEND_S)
    expect(inDerAusblendung.zielS).toBeLessThan(34)
    expect(inDerAusblendung.zielS).toBeCloseTo(33.96, 6)
    expect(inDerAusblendung.ausgelaufen).toBe(true)
  })

  it('rechnet den Schnitt mit: das Ende ist bisS, nicht das Dateiende', () => {
    // Ausschnitt 6–20 s einer 34-s-Datei → der Klip ist 14 s lang
    expect(videoStandS(6, 20, 0).zielS).toBeCloseTo(6, 6)
    expect(videoStandS(6, 20, 13).zielS).toBeCloseTo(19, 6)
    expect(videoStandS(6, 20, 14).ausgelaufen).toBe(true)
    expect(videoStandS(6, 20, 14).zielS).toBeCloseTo(19.96, 6)
  })

  it('bleibt im Material, wenn der Klip kürzer ist als das Video', () => {
    // Ohne bekannte `dauerS` ist der Klip die Foto-Standzeit lang
    expect(videoStandS(0, 34, HALT_ENGINE_S).ausgelaufen).toBe(false)
  })
})

describe('loeseFokusAuf: Ton-Spanne kommt aus der FILM-Achse (Etappe 4)', () => {
  const AUDIO_EDITS = {
    schema: 'maptale/edits@1' as const,
    audio: [
      // Aufgewertet: anker/versatz/dauer gelten, `ab`/`bis` sind nur noch Fallback
      { datei: 'a.mp3', typ: 'musik' as const, ab: iso(60), bis: iso(300), anker: iso(600), versatzFilmS: 0, dauerFilmS: 12 },
    ],
  }
  const track = [
    [7.9, 46.6, 800, 0],
    [7.91, 46.6, 800, 600],
    [7.92, 46.6, 800, 1200],
  ] as TrackPunkt[]
  const abschnitte = [{ mode: 'walk' as const, aktiv: true, pts: track }]

  it('nimmt die gelieferte Spanne, nicht ab/bis', () => {
    const info = loeseFokusAuf({ art: 'audio', index: 0 }, AUDIO_EDITS, abschnitte, track, START, [], () => ({
      vonS: 600,
      bisS: 660,
    }))
    expect(info?.vonS).toBe(600)
    expect(info?.bisS).toBe(660)
  })

  it('fällt ohne Achse auf ab/bis zurück — Bestandsdaten bleiben lesbar', () => {
    const info = loeseFokusAuf({ art: 'audio', index: 0 }, AUDIO_EDITS, abschnitte, track, START, [])
    expect(info?.vonS).toBe(60)
    expect(info?.bisS).toBe(300)
  })
})
