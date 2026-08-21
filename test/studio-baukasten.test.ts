// Kreativbaukasten (Editor-Seite): Segment-Projektion, Audio-/Kamera-/Display-
// Mutatoren und die Zeitleisten-Helfer — alles reine Logik ohne DOM.

import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { STUDIO_GAIN_DEFAULT } from '../src/audiotracks.js'
import { HOLD_FADE_OUT_S, HOLD_HIDE } from '../src/card-timing.js'
import {
  TRAVEL_MODE_TEMPO,
  MOMENT_DEFAULT_S as ENGINE_MOMENT_DEFAULT_S,
  RAMP_M,
  rampOffsetS,
  tempoMs,
} from '../src/film-axis.js'
import {
  effectiveMedia,
  recordUndo,
  isoToOffset,
  HISTORY_MAX,
  EMPTY_OVERLAY,
  withAudioEntry,
  mitAudioPatch,
  withCameraBoundary,
  withMediaEdit,
  withTravelModeBoundary,
  withCameraMoment,
  withTourTrim,
  withWeatherBoundary,
  weatherAtTime,
  TRAVEL_MODES,
  MOMENT_DEFAULT_S,
  offsetToIso,
  withoutAudioEntry,
  withoutCameraBoundary,
  withoutTravelModeBoundary,
  withoutCameraMoment,
  withoutWeatherBoundary,
  projectOntoTrack,
  validateOverlay,
  pointAtOffset,
  WEATHER_MODES,
  splitForDisplay,
  type EditOverlay,
  type MediaBase,
  type TravelMode,
  type TrackPoint,
} from '../src/studio/edit-model'
import { SFX_LIBRARY, SFX_FILES, sfxEffect } from '../src/studio/sfx-library'
import {
  scrollAnchor,
  fractionAt,
  fractionToOffset,
  audioWouldBeDropped,
  mediumHoldS,
  buildTimelineAxis,
  buildAudioBars,
  buildFilmRuler,
  buildMediaDots,
  buildBoundaryCurve,
  buildScale,
  buildPlaybackCurve,
  buildSceneClips,
  buildTrimHandles,
  buildStateBands,
  describeStopState,
  filmAt,
  filmDurationAtBoundary,
  filmToFraction,
  filmToOffset,
  formatDuration,
  formatFilmTime,
  formatSeconds,
  STOP_FADE_OUT_S,
  STOP_ENGINE_S,
  stopAtFilmS,
  photoHoldS,
  stopInnerAt,
  clampFilmS,
  clampBoundary,
  clampMomentDuration,
  clampHoldS,
  clampMediaTrim,
  resolveSelection,
  cumMeters,
  metersToOffset,
  musicLanes,
  offsetToFraction,
  moveToSlot,
  slotInChain,
  snapToStop,
  SNAP_BEHIND_S,
  estimateAnimationDuration,
  recordingTimeAtFilmTime,
  type TimelineAxis,
  BAND_MIN_PX,
  MOMENT_MAX_S,
  MOMENT_MIN_S,
  HOLD_MAX_S,
  HOLD_MIN_S,
  stepFilmS,
  chooseFilmStep,
  videoFilmS,
  videoPositionS,
  VIDEO_TRIM_MIN_S,
} from '../src/studio/timeline'

const START = '2026-07-12T17:45:00Z'
const iso = (s: number): string => offsetToIso(START, s)

// Langer gerader Abschnitt (Fähren-Szenario): nur zwei Stützpunkte
const track: TrackPoint[] = [
  [9.0, 47.0, 400, 0],
  [9.1, 47.0, 400, 600],
  [9.1, 47.05, 400, 1200],
]

describe('projectOntoTrack', () => {
  it('projiziert auf die LINIE zwischen weit entfernten Stützpunkten (Fähren-Bug)', () => {
    // Klick mittig auf die Gerade, leicht daneben — der nächste VERTEX wäre km entfernt
    const { point, index } = projectOntoTrack(track, 9.05, 47.001)
    expect(index).toBe(0)
    expect(point[0]).toBeCloseTo(9.05, 4)
    expect(point[1]).toBeCloseTo(47.0, 4)
    // tOffset wird mit interpoliert: halbe Strecke = halbe Zeit
    expect(point[3]).toBeCloseTo(300, 0)
  })

  it('klemmt vor dem Anfang und nach dem Ende auf die Endpunkte', () => {
    expect(projectOntoTrack(track, 8.9, 47.0).point[3]).toBe(0)
    expect(projectOntoTrack(track, 9.1, 47.2).point[3]).toBe(1200)
  })

  it('fällt bei weniger als zwei Punkten auf den vorhandenen Punkt zurück', () => {
    expect(projectOntoTrack([[9, 47, 0, 42]], 10, 48).point[3]).toBe(42)
  })
})

describe('pointAtOffset', () => {
  it('interpoliert zwischen den Stützpunkten', () => {
    const p = pointAtOffset(track, 300)
    expect(p?.[0]).toBeCloseTo(9.05, 6)
  })
  it('klemmt außerhalb der Spanne', () => {
    expect(pointAtOffset(track, -10)?.[3]).toBe(0)
    expect(pointAtOffset(track, 9999)?.[3]).toBe(1200)
    expect(pointAtOffset([], 0)).toBeNull()
  })
})

describe('Kamera-Grenzen', () => {
  it('setzt, ersetzt (gleicher ab) und sortiert', () => {
    let e = withCameraBoundary(EMPTY_OVERLAY, iso(600), 'far')
    e = withCameraBoundary(e, iso(100), 'near')
    e = withCameraBoundary(e, iso(600), 'mid')
    expect(e.camera).toEqual([
      { from: iso(100), preset: 'near' },
      { from: iso(600), preset: 'mid' },
    ])
    e = withoutCameraBoundary(e, iso(100))
    e = withoutCameraBoundary(e, iso(600))
    expect('camera' in e).toBe(false)
  })

  it('Feinjustierung: skala wird gehalten, bei 1/undefined weggelassen', () => {
    expect(withCameraBoundary(EMPTY_OVERLAY, iso(0), 'near', 1.4).camera).toEqual([
      { from: iso(0), preset: 'near', scale: 1.4 },
    ])
    // skala 1 oder undefined = kein Feld (minimales JSON)
    expect(withCameraBoundary(EMPTY_OVERLAY, iso(0), 'near', 1).camera).toEqual([
      { from: iso(0), preset: 'near' },
    ])
    expect(withCameraBoundary(EMPTY_OVERLAY, iso(0), 'near').camera).toEqual([
      { from: iso(0), preset: 'near' },
    ])
    // validateOverlay: 0.5..2 erlaubt, außerhalb abgelehnt
    expect(
      validateOverlay({
        schema: 'maptale/edits@2',
        camera: [{ from: iso(0), preset: 'near', scale: 0.4 }],
      }),
    ).toMatch(/Feinjustierung/)
    expect(
      validateOverlay({
        schema: 'maptale/edits@2',
        camera: [{ from: iso(0), preset: 'near', scale: 1.5 }],
      }),
    ).toBeNull()
  })
})

describe('Kamera-Momente', () => {
  it('setzt, ersetzt (gleicher ab), sortiert und räumt auf', () => {
    let e = withCameraMoment(EMPTY_OVERLAY, iso(600), 'orbit')
    e = withCameraMoment(e, iso(100), 'linger', 8)
    e = withCameraMoment(e, iso(600), 'ascend') // ersetzt den Umkreisen-Moment
    expect(e.moments).toEqual([
      { from: iso(100), kind: 'linger', durationS: 8 },
      { from: iso(600), kind: 'ascend' },
    ])
    e = withoutCameraMoment(e, iso(100))
    e = withoutCameraMoment(e, iso(600))
    expect('momente' in e).toBe(false)
  })

  it('validateOverlay lehnt unparsebare Zeit und Dauer außerhalb 1..30 ab', () => {
    expect(
      validateOverlay({ schema: 'maptale/edits@2', moments: [{ from: 'quatsch', kind: 'orbit' }] }),
    ).toMatch(/Moment/)
    expect(
      validateOverlay({
        schema: 'maptale/edits@2',
        moments: [{ from: iso(0), kind: 'orbit', durationS: 99 }],
      }),
    ).toMatch(/Dauer/)
    expect(
      validateOverlay({
        schema: 'maptale/edits@2',
        moments: [{ from: iso(0), kind: 'orbit', durationS: 6 }],
      }),
    ).toBeNull()
  })

  it('Default-Dauern SIND die der Engine, keine Kopie davon', () => {
    // Seit Paket D liest `tour.ts` dieselbe Tabelle (src/film-axis.ts) — der
    // Wächter vergleicht deshalb keine Zeichenkette mehr, sondern die Identität.
    expect(MOMENT_DEFAULT_S).toBe(ENGINE_MOMENT_DEFAULT_S)
  })
})

describe('Audio-Einträge', () => {
  it('fügt hinzu, patcht per Index und räumt beim letzten Entfernen auf', () => {
    let e = withAudioEntry(EMPTY_OVERLAY, { file: 'a.mp3', type: 'music', from: iso(0) })
    e = withAudioEntry(e, { file: 'b.mp3', type: 'sfx', from: iso(60) })
    e = mitAudioPatch(e, 0, { to: iso(600), volume: 0.5 })
    expect(e.audio?.[0]).toEqual({
      file: 'a.mp3',
      type: 'music',
      from: iso(0),
      to: iso(600),
      volume: 0.5,
    })
    // undefined entfernt den Schlüssel
    e = mitAudioPatch(e, 0, { volume: undefined })
    expect('lautstaerke' in (e.audio?.[0] ?? {})).toBe(false)
    e = withoutAudioEntry(e, 1)
    e = withoutAudioEntry(e, 0)
    expect('audio' in e).toBe(false)
  })

  it('Wechsel auf sfx wirft das Ende weg', () => {
    let e = withAudioEntry(EMPTY_OVERLAY, {
      file: 'a.mp3',
      type: 'music',
      from: iso(0),
      to: iso(60),
    })
    e = mitAudioPatch(e, 0, { type: 'sfx' })
    expect(e.audio?.[0]).toEqual({ file: 'a.mp3', type: 'sfx', from: iso(0) })
  })

  it('Stück tauschen: datei+quelle ersetzen, die Platzierung bleibt', () => {
    // Ausgangslage: Bibliotheks-Musik mit gesetztem Bereich und Lautstärke
    let e = withAudioEntry(EMPTY_OVERLAY, {
      file: 'mus-aufbruch.mp3',
      type: 'music',
      from: iso(0),
      to: iso(600),
      volume: 0.5,
      source: 'library',
    })
    // „Ändern …": eigener Upload übernimmt — ab/bis/lautstaerke unangetastet
    e = mitAudioPatch(e, 0, { file: 'meine-musik.mp3', source: 'user' })
    expect(e.audio?.[0]).toEqual({
      file: 'meine-musik.mp3',
      type: 'music',
      from: iso(0),
      to: iso(600),
      volume: 0.5,
      source: 'user',
    })
    // Tausch gegen einen Katalog-Effekt wechselt die Art mit → Ende fällt weg
    e = mitAudioPatch(e, 0, { file: 'sfx-moewe.mp3', source: 'library', type: 'sfx' })
    expect(e.audio?.[0]).toEqual({
      file: 'sfx-moewe.mp3',
      type: 'sfx',
      from: iso(0),
      volume: 0.5,
      source: 'library',
    })
    // source: undefined heißt ausdrücklich „tour-lokal" — der Schlüssel verschwindet
    e = mitAudioPatch(e, 0, { file: 'lokal.mp3', source: undefined })
    expect(e.audio?.[0]).toEqual({ file: 'lokal.mp3', type: 'sfx', from: iso(0), volume: 0.5 })
  })
})

describe('Display-Optionen je Medium', () => {
  it('setzt holdS/kenBurns und räumt leere display-Objekte weg', () => {
    let e = withMediaEdit(EMPTY_OVERLAY, 'm1', { display: { holdS: 8, kenBurns: false } })
    expect(e.media?.['m1']?.display).toEqual({ holdS: 8, kenBurns: false })
    e = withMediaEdit(e, 'm1', { display: { kenBurns: false } })
    expect(e.media?.['m1']?.display).toEqual({ kenBurns: false })
    e = withMediaEdit(e, 'm1', { display: {} })
    expect('medien' in e).toBe(false)
  })

  it('effectiveMedia reicht display nur durch, wenn gesetzt', () => {
    const basis: MediaBase[] = [
      {
        id: 'm1',
        type: 'photo',
        src: '/x',
        takenAt: iso(0),
        caption: '',
        anchor: [9, 47],
        placement: 'gps',
      },
    ]
    const ohne = effectiveMedia(basis, EMPTY_OVERLAY)[0]!
    expect('display' in ohne).toBe(false)
    const mit = effectiveMedia(
      basis,
      withMediaEdit(EMPTY_OVERLAY, 'm1', { display: { holdS: 12 } }),
    )[0]!
    expect(mit.display).toEqual({ holdS: 12 })
  })
})

describe('validateOverlay (Baukasten-Fälle)', () => {
  const basis = (audio: NonNullable<EditOverlay['audio']>): EditOverlay => ({
    schema: 'maptale/edits@2',
    audio,
  })
  it('lehnt Ende vor Beginn ab', () => {
    expect(
      validateOverlay(basis([{ file: 'a.mp3', type: 'music', from: iso(60), to: iso(30) }])),
    ).toMatch(/Ende/)
  })
  it('lehnt Ende bei SFX ab', () => {
    expect(
      validateOverlay(basis([{ file: 'a.mp3', type: 'sfx', from: iso(0), to: iso(30) }])),
    ).toMatch(/Musik/)
  })
  it('lehnt Lautstärke außerhalb 0..1 ab', () => {
    expect(
      validateOverlay(basis([{ file: 'a.mp3', type: 'music', from: iso(0), volume: 1.2 }])),
    ).toMatch(/Lautstärke/)
  })
  it('lehnt Haltedauern außerhalb 2..60 ab', () => {
    const e = withMediaEdit(EMPTY_OVERLAY, 'm1', { display: { holdS: 99 } })
    expect(validateOverlay(e)).toMatch(/Haltedauer/)
    expect(
      validateOverlay(withMediaEdit(EMPTY_OVERLAY, 'm1', { display: { holdS: 8 } })),
    ).toBeNull()
  })
  it('lehnt unparsebare Kamera-Grenzen ab', () => {
    expect(
      validateOverlay({ schema: 'maptale/edits@2', camera: [{ from: 'quatsch', preset: 'near' }] }),
    ).toMatch(/Kamera/)
  })
  it('lehnt zu viele Audio-Einträge ab (Server-Limit 50 gespiegelt)', () => {
    const viele = Array.from({ length: 51 }, () => ({
      file: 'a.mp3',
      type: 'music' as const,
      from: iso(0),
    }))
    expect(validateOverlay(basis(viele))).toMatch(/maximal 50/)
  })
  it('lehnt zu lange Beschreibungen ab (Server-Limit 1000 gespiegelt)', () => {
    const e = withMediaEdit(EMPTY_OVERLAY, 'm1', { caption: 'x'.repeat(1001) })
    expect(validateOverlay(e)).toMatch(/1000/)
  })
})

describe('audioWouldBeDropped (Trim-Warnung im Editor)', () => {
  const skala = buildScale(track)!
  it('meldet SFX im weggetrimmten Vorlauf', () => {
    const edits = withTourTrim(EMPTY_OVERLAY, 'start', iso(300))
    expect(
      audioWouldBeDropped({ file: 's.mp3', type: 'sfx', from: iso(120) }, edits, START, skala),
    ).toBe(true)
    expect(
      audioWouldBeDropped({ file: 's.mp3', type: 'sfx', from: iso(600) }, edits, START, skala),
    ).toBe(false)
  })
  it('meldet Musik, deren Spanne komplett vor dem Trim-Start liegt', () => {
    const edits = withTourTrim(EMPTY_OVERLAY, 'start', iso(600))
    expect(
      audioWouldBeDropped(
        { file: 'm.mp3', type: 'music', from: iso(60), to: iso(300) },
        edits,
        START,
        skala,
      ),
    ).toBe(true)
    expect(
      audioWouldBeDropped({ file: 'm.mp3', type: 'music', from: iso(60) }, edits, START, skala),
    ).toBe(false)
  })
})

describe('Fortbewegungs-Modi', () => {
  // Drift-Wächter: Studio und Player-Engine müssen dieselben Modi kennen. Sie
  // liefen auseinander — das Studio bot nur walk/bike/tram/ferry an, während
  // Engine, Icons und Motorsound moped/jeep längst unterstützten; aufgezeichnete
  // Touren konnten diese Modi deshalb nie bekommen. tour.ts lädt MapLibre und
  // ist im Node-Test nicht importierbar, also über den Quelltext.
  it('decken sich mit der Tempo-Tabelle der Engine', () => {
    // `TRAVEL_MODE_TEMPO` steht seit Paket D in src/film-axis.ts und wird von der
    // Engine, vom Studio und (als erzwungener Spiegel) vom Server gelesen —
    // kein Quelltext-Vergleich mehr nötig.
    expect(Object.keys(TRAVEL_MODE_TEMPO).slice().sort()).toEqual([...TRAVEL_MODES].slice().sort())
  })

  it('Tempo-Faktoren der Dauerschätzung stimmen mit der Engine überein', () => {
    // Eine 12 km lange Fahrt je Modus: die geschätzte Dauer muss exakt
    // Länge / (120 · Faktor) sein — prüft Faktor UND Basistempo.
    for (const [modus, faktor] of Object.entries(TRAVEL_MODE_TEMPO)) {
      const strecke: TrackPoint[] = [
        [9, 47, 0, 0],
        [9 + 12000 / (111_320 * Math.cos((47 * Math.PI) / 180)), 47, 0, 3600],
      ]
      const sek = estimateAnimationDuration(
        [{ mode: modus as never, active: true, pts: strecke }],
        [],
      )
      expect(sek, `Tempo für ${modus}`).toBeCloseTo(12000 / (120 * faktor), 1)
    }
  })

  // Die Haltezeiten sind seit Paket A KEINE Kopie mehr, sondern derselbe Wert:
  // `card-timing.ts` ist DOM- und importfrei, das Studio liest ihn direkt. Der
  // Wächter prüft deshalb keine Zeichenkette mehr, sondern die Identität — er
  // fällt erst, wenn jemand die Werte wieder auseinanderschreibt.
  it('Haltezeiten SIND HOLD_HIDE/HOLD_AUSBLEND, keine Kopie davon', () => {
    expect(STOP_ENGINE_S).toBe(HOLD_HIDE)
    expect(STOP_FADE_OUT_S).toBe(HOLD_FADE_OUT_S)
  })

  it('haben in der Engine auch eine Kamera-Skala', () => {
    const quelle = readFileSync(new URL('../src/tour.ts', import.meta.url), 'utf8')
    const block = quelle.match(/const MODE_SCALE = \{([\s\S]*?)\n\}/)
    const engine = [...(block?.[1] ?? '').matchAll(/^\s{2}(\w+)\s*:/gm)].map((m) => m[1] as string)
    expect(engine.slice().sort()).toEqual([...TRAVEL_MODES].slice().sort())
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

    for (const modus of TRAVEL_MODES) {
      const engineIcon = (engineBlock?.[1] ?? '').match(
        new RegExp(`(?:^|\\n)\\s*(?://[^\\n]*\\n\\s*)?${modus}:\\s*\`([\\s\\S]*?)\``),
      )
      expect(engineIcon, `MODE_ICONS.${modus} nicht gefunden`).not.toBeNull()
      const studioIcon = studioQuelle.match(
        new RegExp(`<symbol id="i-m-${modus}"([\\s\\S]*?)</symbol>`),
      )
      expect(studioIcon, `Sprite #i-m-${modus} fehlt in studio.html`).not.toBeNull()
      expect(pfade(studioIcon?.[1] ?? ''), `Pfade von ${modus}`).toEqual(
        pfade(engineIcon?.[1] ?? ''),
      )
    }
  })
})

describe('Wetter-Grenzen', () => {
  it('setzt und ersetzt am selben ab, sortiert nach Zeit', () => {
    let e: EditOverlay = EMPTY_OVERLAY
    e = withWeatherBoundary(e, iso(600), 'rain')
    e = withWeatherBoundary(e, iso(0), 'clouds')
    e = withWeatherBoundary(e, iso(600), 'storm', 0.9) // ersetzt die rain-Grenze
    expect(e.weather).toEqual([
      { from: iso(0), mode: 'clouds' },
      { from: iso(600), mode: 'storm', intensity: 0.9 },
    ])
  })

  it('lässt staerke 1/undefined weg, hält das JSON minimal', () => {
    const e = withWeatherBoundary(EMPTY_OVERLAY, iso(0), 'fog')
    expect(e.weather).toEqual([{ from: iso(0), mode: 'fog' }])
  })

  it('entfernt die Grenze und räumt das leere Feld weg (zurück zum Auto-Wetter)', () => {
    const e = withWeatherBoundary(EMPTY_OVERLAY, iso(0), 'snow')
    const ohne = withoutWeatherBoundary(e, iso(0))
    expect('weather' in ohne).toBe(false)
  })

  // `weatherAtTime` beantwortet punktuell, was die Wetter-Bahn als Bänder
  // zeichnet — die Karte im Editor (§10) fragt darüber, was sie zeigen soll.
  describe('weatherAtTime', () => {
    const grenzen = [
      { from: iso(0), mode: 'clouds' as const },
      { from: iso(600), mode: 'rain' as const, intensity: 0.9 },
      { from: iso(1200), mode: 'off' as const },
    ]

    it('gilt AB ihrer Grenze und bis zur nächsten', () => {
      expect(weatherAtTime(grenzen, iso(0))?.mode).toBe('clouds')
      expect(weatherAtTime(grenzen, iso(599))?.mode).toBe('clouds')
      expect(weatherAtTime(grenzen, iso(600))?.mode).toBe('rain')
      expect(weatherAtTime(grenzen, iso(1199))?.mode).toBe('rain')
      expect(weatherAtTime(grenzen, iso(5000))?.mode).toBe('off')
    })

    it('reicht die Stärke durch', () => {
      expect(weatherAtTime(grenzen, iso(700))?.intensity).toBe(0.9)
      expect(weatherAtTime(grenzen, iso(100))?.intensity).toBeUndefined()
    })

    // Der Unterschied, der leicht verlorengeht: VOR der ersten Grenze hat sich
    // niemand geäußert (null). Als 'off' gelesen wäre das die AUSSAGE „klares
    // Wetter" — und eine Tour ohne jede Wetterangabe zeigte dann ausdrücklich
    // klares Wetter statt gar keines.
    it('sagt vor der ersten Grenze nichts — und nicht `off`', () => {
      expect(weatherAtTime(grenzen, iso(-1))).toBeNull()
      expect(weatherAtTime([], iso(500))).toBeNull()
    })

    it('verträgt eine unbrauchbare Zeit', () => {
      expect(weatherAtTime(grenzen, 'morgen früh')).toBeNull()
    })
  })

  it('validateOverlay lehnt Stärke außerhalb [0,1] ab', () => {
    expect(
      validateOverlay({
        schema: 'maptale/edits@2',
        weather: [{ from: iso(0), mode: 'rain', intensity: 1.4 }],
      }),
    ).toMatch(/Wetter-Stärke/)
    expect(
      validateOverlay({
        schema: 'maptale/edits@2',
        weather: [{ from: iso(0), mode: 'rain', intensity: 0.5 }],
      }),
    ).toBeNull()
  })

  // Drift-Wächter: die Wetter-Modi müssen client- und serverseitig gleich sein
  // (der JSON-Schema-Enum und die Studio-Auswahl teilen dieselbe Wetterwelt).
  it('decken sich mit WETTER_MODI im Server (schema/pipeline)', () => {
    const quelle = readFileSync(
      new URL('../server/src/pipeline/weather.ts', import.meta.url),
      'utf8',
    )
    const block = quelle.match(/WEATHER_MODES = \[([^\]]*)\]/)
    expect(block, 'WEATHER_MODES in server/src/pipeline/weather.ts nicht gefunden').not.toBeNull()
    const server = [...(block?.[1] ?? '').matchAll(/'([a-z]+)'/g)].map((m) => m[1] as string)
    expect(server).toEqual([...WEATHER_MODES])
  })

  // Drift-Wächter: die Reglerstellung ohne eigenen Wert steht zweimal — im
  // Studio (Vorhören, Abspielen, Regler) und im Server, der sie als `gain` ins
  // Tour-JSON schreibt. Laufen sie auseinander, klingt der Film leiser oder
  // lauter als der Schnitt, den man geprüft hat — und man hört es erst im Player.
  it('STUDIO_PEGEL_VORGABE deckt sich mit STUDIO_PEGEL im Server', () => {
    const quelle = readFileSync(new URL('../server/src/schema/edits.ts', import.meta.url), 'utf8')
    const treffer = quelle.match(/STUDIO_GAIN = ([0-9.]+)/)
    expect(treffer, 'STUDIO_GAIN in server/src/schema/edits.ts nicht gefunden').not.toBeNull()
    expect(Number(treffer?.[1])).toBe(STUDIO_GAIN_DEFAULT)
  })

  // Und der Server muss ihn UNBEDINGT schreiben: `gain` weglassen hieße im
  // Player 1.0 (kein Wissen über die Studio-Vorgabe), also lauter als der Schnitt.
  it('enrich.ts schreibt gain immer, nicht nur bei gesetztem Wert', () => {
    const quelle = readFileSync(
      new URL('../server/src/pipeline/enrich.ts', import.meta.url),
      'utf8',
    )
    expect(quelle).toMatch(/gain: spur\.volume \?\? STUDIO_GAIN/)
  })
})

describe('Musik- und Klangbibliothek', () => {
  it('Katalog ist konsistent: eindeutige Dateien, Kategorie passt zum Typ', () => {
    const dateien = SFX_LIBRARY.map((e) => e.file)
    expect(new Set(dateien).size, 'doppelte Dateinamen im Katalog').toBe(dateien.length)
    for (const e of SFX_LIBRARY) {
      expect(e.file, `${e.name}: Dateiname`).toMatch(/^[A-Za-z0-9_-]{1,64}\.mp3$/)
      // Musik und Umgebung laufen als Loop über eine Spanne (musik),
      // Effekte als One-Shot an einem Punkt (sfx)
      expect(e.type, `${e.name}: Typ passt zur Kategorie`).toBe(
        e.category === 'sfx' ? 'sfx' : 'music',
      )
    }
    expect(SFX_FILES.has(SFX_LIBRARY[0]!.file)).toBe(true)
    expect(sfxEffect(SFX_LIBRARY[0]!.file)?.name).toBe(SFX_LIBRARY[0]!.name)
    expect(sfxEffect('gibtsnicht.mp3')).toBeUndefined()
  })

  it('bietet Musik an — nicht nur Atmosphären und Effekte', () => {
    // Die Spur heißt „Musik & Sound"; ohne Musik wäre sie eine Ankündigung.
    const musik = SFX_LIBRARY.filter((e) => e.category === 'music')
    expect(musik.length).toBeGreaterThanOrEqual(10)
    expect(musik.every((e) => e.type === 'music')).toBe(true)
  })

  it('deckt sich mit den erzeugten Clips (Drift-Wächter Katalog ↔ Skripte)', async () => {
    // Die Generier-Skripte exportieren ihre Prompts; der Katalog die Anzeige.
    // Die Dateinamen-Mengen müssen exakt übereinstimmen, sonst wählt das Studio
    // Stücke, die nie erzeugt werden — oder umgekehrt.
    // @ts-expect-error — reines .mjs-Generier-Skript ohne Typdeklaration
    const { CLIPS } = (await import('../scripts/gen-sfx-library.mjs')) as {
      CLIPS: Array<{ name: string }>
    }
    // @ts-expect-error — dito
    const { MUSIK_CLIPS } = (await import('../scripts/gen-music-library.mjs')) as {
      MUSIK_CLIPS: Array<{ name: string }>
    }
    const ausSkript = [...CLIPS, ...MUSIK_CLIPS].map((c) => `${c.name}.mp3`).sort()
    const ausKatalog = SFX_LIBRARY.map((e) => e.file)
      .slice()
      .sort()
    expect(ausSkript).toEqual(ausKatalog)
  })

  it('jede Katalogdatei liegt wirklich unter public/audio/sfx/', () => {
    // Ein Katalogeintrag ohne Datei ist ein Eintrag, der beim Anklicken schweigt.
    for (const e of SFX_LIBRARY) {
      const pfad = new URL(`../public/audio/sfx/${e.file}`, import.meta.url)
      expect(existsSync(pfad), `${e.name}: ${e.file} fehlt`).toBe(true)
    }
  })

  // Drift-Wächter: Der Server vergibt beim ersten Verarbeiten selbst ein
  // Musikstück und führt dafür eine eigene Dateiliste (er kann den Client-
  // Katalog nicht importieren). Driftet sie ab, setzt die Automatik eine
  // Referenz, die es nicht gibt — im Player bliebe es still.
  it('die Auto-Musik des Servers steht wirklich im Katalog', () => {
    const quelle = readFileSync(
      new URL('../server/src/pipeline/music-choice.ts', import.meta.url),
      'utf8',
    )
    const block = quelle.match(/AUTO_MUSIC = \{([\s\S]*?)\} as const/)
    expect(block, 'AUTO_MUSIC in server/src/pipeline/music-choice.ts nicht gefunden').not.toBeNull()
    const dateien = [...(block?.[1] ?? '').matchAll(/'([^']+\.mp3)'/g)].map((m) => m[1] as string)
    expect(dateien.length, 'AUTO_MUSIC ist leer').toBeGreaterThanOrEqual(5)
    for (const datei of dateien) {
      expect(SFX_FILES.has(datei), `${datei} fehlt im Studio-Katalog`).toBe(true)
      expect(sfxEffect(datei)?.category, `${datei} ist keine Musik`).toBe('music')
    }
  })
})

describe('Zeitleiste', () => {
  const skala = buildScale(track)!

  it('baut die Skala aus erstem/letztem Punkt (und null bei zu wenig Spanne)', () => {
    expect(skala).toEqual({ fromS: 0, toS: 1200 })
    expect(buildScale([[9, 47, 0, 5]])).toBeNull()
  })

  it('rechnet Anteil↔Offset geklemmt um', () => {
    expect(offsetToFraction(skala, 600)).toBeCloseTo(0.5)
    expect(offsetToFraction(skala, -50)).toBe(0)
    expect(fractionToOffset(skala, 0.25)).toBeCloseTo(300)
    expect(fractionToOffset(skala, 2)).toBe(1200)
  })

  it('setzt Medien-Dots an die projizierte Wiedergabe-Zeit (ohne gelöschte/unplatzierte)', () => {
    const basis: MediaBase[] = [
      {
        id: 'far',
        type: 'photo',
        src: '/x',
        takenAt: iso(0),
        caption: '',
        anchor: [9.05, 47.002],
        placement: 'gps',
      },
      {
        id: 'weg',
        type: 'photo',
        src: '/x',
        takenAt: iso(0),
        caption: '',
        anchor: [9.0, 47.0],
        placement: 'gps',
      },
      {
        id: 'ohne',
        type: 'photo',
        src: '/x',
        takenAt: iso(0),
        caption: '',
        anchor: null,
        placement: 'unplaced',
      },
    ]
    const edits = withMediaEdit(EMPTY_OVERLAY, 'weg', { removed: true })
    const dots = buildMediaDots(effectiveMedia(basis, edits), track, skala)
    expect(dots.map((d) => d.id)).toEqual(['far'])
    expect(dots[0]?.fraction).toBeCloseTo(0.25, 2)
  })

  it('baut Audio-Balken: Musik ohne bis läuft bis 1, SFX ist punktförmig', () => {
    const balken = buildAudioBars(
      [
        { file: 'a.mp3', type: 'music', from: iso(300) },
        { file: 'b.mp3', type: 'sfx', from: iso(600) },
      ],
      START,
      skala,
    )
    expect(balken[0]).toMatchObject({ index: 0, from: 0.25, to: 1, lane: 0 })
    expect(balken[1]).toMatchObject({ index: 1, from: 0.5, to: 0.5, lane: 0 })
  })

  it('stapelt überlappende Musik-Klips in Unterzeilen — Nachbarn teilen die Zeile', () => {
    // Zwei vollflächige Klips (der Bug-Fall: Auto-Musik + nachträglich
    // Eingesetztes ab Tour-Beginn) dürfen sich nicht verdecken.
    const voll = buildAudioBars(
      [
        { file: 'mus-regentag.mp3', type: 'music', from: iso(0), source: 'library' },
        { file: 'amb-hafen.mp3', type: 'music', from: iso(0), source: 'library' },
      ],
      START,
      skala,
    )
    expect(voll.map((b) => b.lane)).toEqual([0, 1])
    expect(musicLanes(voll)).toBe(2)

    // Aneinandergrenzende Klips (bis = ab des nächsten) bleiben in EINER Zeile;
    // ein dritter, der beide überspannt, rückt in die zweite. Effekt-Pins haben
    // ihre eigene Lane oben und zählen nicht mit.
    const gemischt = buildAudioBars(
      [
        { file: 'a.mp3', type: 'music', from: iso(0), to: iso(600) },
        { file: 'b.mp3', type: 'music', from: iso(600), to: iso(1200) },
        { file: 'c.mp3', type: 'music', from: iso(300), to: iso(900) },
        { file: 'd.mp3', type: 'sfx', from: iso(300) },
      ],
      START,
      skala,
    )
    expect(gemischt.map((b) => b.lane)).toEqual([0, 0, 1, 0])
    expect(musicLanes(gemischt)).toBe(2)

    // Leere Bahn: mindestens eine Zeile (die Bahnhöhe rechnet damit)
    expect(musicLanes([])).toBe(1)
  })

  it('Trim-Griffe: Default 0/1, sonst Anteil der Trim-Zeiten', () => {
    expect(buildTrimHandles(EMPTY_OVERLAY, START, skala)).toEqual({ start: 0, end: 1 })
    const e = withTourTrim(withTourTrim(EMPTY_OVERLAY, 'start', iso(300)), 'end', iso(900))
    expect(buildTrimHandles(e, START, skala)).toEqual({ start: 0.25, end: 0.75 })
  })

  it('Zustandsbänder: lückenlos, jedes Band endet an der nächsten Grenze', () => {
    const baender = buildStateBands(
      [
        { from: iso(300), value: 'near' },
        { from: iso(900), value: 'far' },
      ],
      START,
      skala,
      null,
    )
    expect(baender).toEqual([
      { fromFraction: 0, toFraction: 0.25, value: null, from: null },
      { fromFraction: 0.25, toFraction: 0.75, value: 'near', from: iso(300) },
      { fromFraction: 0.75, toFraction: 1, value: 'far', from: iso(900) },
    ])
    // lückenlos: das Ende jedes Bandes ist der Anfang des nächsten
    for (let i = 1; i < baender.length; i++)
      expect(baender[i]?.fromFraction).toBe(baender[i - 1]?.toFraction)
  })

  it('Zustandsbänder: Grenze bei 0 erzeugt kein leeres Grundband, Doppelgrenzen kein Null-Band', () => {
    const abNull = buildStateBands([{ from: iso(0), value: 'near' }], START, skala, null)
    expect(abNull).toEqual([{ fromFraction: 0, toFraction: 1, value: 'near', from: iso(0) }])

    const doppelt = buildStateBands(
      [
        { from: iso(600), value: 'near' },
        { from: iso(600), value: 'far' },
      ],
      START,
      skala,
      null,
    )
    expect(doppelt.every((b) => b.toFraction > b.fromFraction)).toBe(true)
    expect(doppelt[doppelt.length - 1]).toMatchObject({ value: 'far', toFraction: 1 })
  })

  it('Zustandsbänder: unparsebare Grenzen fallen weg', () => {
    const baender = buildStateBands([{ from: 'quatsch', value: 'near' }], START, skala, 'mid')
    expect(baender).toEqual([{ fromFraction: 0, toFraction: 1, value: 'mid', from: null }])
  })

  it('schätzt die Animationsdauer aus Fahrzeit und Foto-Stopps', () => {
    // 12 km mit dem Rad (Faktor 1) = 12000/120 = 100 s
    const strecke: TrackPoint[] = [
      [9, 47, 0, 0],
      [9 + 12000 / (111_320 * Math.cos((47 * Math.PI) / 180)), 47, 0, 3600],
    ]
    expect(
      estimateAnimationDuration([{ mode: 'bike', active: true, pts: strecke }], []),
    ).toBeCloseTo(100, 1)
    // Weggetrimmte Abschnitte zählen nicht mit
    expect(estimateAnimationDuration([{ mode: 'bike', active: false, pts: strecke }], [])).toBe(0)
    // Je Foto Haltedauer + 0,8 s Ausblendung
    expect(estimateAnimationDuration([], [5.2, 12])).toBeCloseTo(5.2 + 12 + 1.6, 6)
    // Default-Haltedauer entspricht HOLD_HIDE der Engine, nicht dem UI-Label „5 s"
    expect(photoHoldS()).toBe(5.2)
    expect(photoHoldS({ holdS: 20 })).toBe(20)
  })

  describe('Filmzeit-Achse', () => {
    const dLng6km = 6000 / (111_320 * Math.cos((47 * Math.PI) / 180))
    // Zwei Fahr-Hälften à 6 km bike (je 50 s Film), Halt bei t=600 (20 s Film)
    const fahrTrack: TrackPoint[] = [
      [9, 47, 0, 0],
      [9 + dLng6km, 47, 0, 600],
      [9 + 2 * dLng6km, 47, 0, 1200],
    ]
    const fSkala = buildScale(fahrTrack)!
    const abschnitte = [{ mode: 'bike' as const, active: true, pts: fahrTrack }]
    const achse = buildTimelineAxis(abschnitte, [{ offsetS: 600, widthS: 20 }], fSkala)
    const gesamt = achse.curve?.totalS ?? 0
    // Seit E14 bringt die Achse ihre RAMPEN mit. Bei Radtempo (120 m/s) kostet
    // eine 120-m-Rampe genau eine Filmsekunde. Hier sind es drei: aus dem Stand
    // los, vor dem Halt bremsen, danach wieder anfahren — am Tour-Ende wird
    // nicht gebremst. Der Halt liegt dadurch bei 52 statt 50 Filmsekunden.
    const R = RAMP_M / tempoMs('bike')
    /**
     * Was eine MODUS-Rampe die ganze Tour kostet: ihre Dauer minus die Reise,
     * die sie ersetzt. Sie liegt ganz im SCHNELLEREN Abschnitt, ersetzt dort
     * also `RAMP_M` Meter — und kostet damit Zeit, statt welche zu sparen.
     */
    const modusRampeS = (v0: number, v1: number): number =>
      (2 * RAMP_M) / (v0 + v1) - RAMP_M / Math.max(v0, v1)

    it('Halte bekommen ihre Standzeit als Achsenbreite', () => {
      expect(gesamt).toBeCloseTo(120 + 3 * R, 1) // 100 s Fahrt + 20 s Halt + 3 Rampen
      // Der Halt belegt (52..72)/123 der Achse
      expect(offsetToFraction(achse, 599)).toBeLessThan((50 + 2 * R) / gesamt)
      expect(offsetToFraction(achse, 601)).toBeGreaterThan((70 + 2 * R) / gesamt - 0.01)
    })

    it('Sprung-Konventionen: Halt-Zeit → Sprunganfang, Anteil im Sprung → Halt-Zeit', () => {
      expect(offsetToFraction(achse, 600)).toBeCloseTo((50 + 2 * R) / gesamt, 4)
      // Mitten im Halt-Sprung steht die Aufnahmezeit still
      expect(fractionToOffset(achse, (60 + 2 * R) / gesamt)).toBeCloseTo(600, 4)
      // Außerhalb des Sprungs normale Umkehrung
      expect(fractionToOffset(achse, offsetToFraction(achse, 300))).toBeCloseTo(300, 4)
    })

    it('ohne Kurve fällt die Abbildung auf die lineare Aufnahmezeit zurück', () => {
      expect(offsetToFraction(fSkala, 600)).toBeCloseTo(0.5, 6)
      expect(fractionToOffset(fSkala, 0.25)).toBeCloseTo(300, 6)
    })

    it('Trim wird für die ACHSE ignoriert — weggetrimmte Ränder bleiben anfassbar', () => {
      const mitTrim = [
        { mode: 'bike' as const, active: true, pts: [fahrTrack[0]!, fahrTrack[1]!] },
        { mode: 'bike' as const, active: false, pts: [fahrTrack[1]!, fahrTrack[2]!] },
      ]
      const a2 = buildTimelineAxis(mitTrim, [], fSkala)
      expect(a2.curve?.totalS).toBeCloseTo(100 + R, 1) // + Anfahrt aus dem Stand
    })

    it('ohne Fahrstrecke tragen die HALTE die Achse — der Film ist ja fast nur Standzeit', () => {
      const stand: TrackPoint[] = [
        [9, 47, 0, 0],
        [9, 47, 0, 3000],
      ]
      const nurFotos = buildTimelineAxis(
        [{ mode: 'walk', active: true, pts: stand }],
        [{ offsetS: 100, widthS: 6 }],
        buildScale(stand)!,
      )
      expect(nurFotos.curve?.totalS).toBeCloseTo(6, 3)
      // Erst ohne Fahrzeit UND ohne Halte ist nichts zu zeigen: linearer Fallback
      const leer = buildTimelineAxis(
        [{ mode: 'walk', active: true, pts: stand }],
        [],
        buildScale(stand)!,
      )
      expect(leer.curve).toBeUndefined()
    })

    it('filmToOffset liefert die Film-Sekunde der Achse (Kopf-Uhr)', () => {
      expect(filmToOffset(achse, 300)).toBeCloseTo(25 + R, 1)
      expect(filmToOffset(achse, 600)).toBeCloseTo(50 + 2 * R, 1) // Sprunganfang
      expect(filmToOffset(achse, 1200)).toBeCloseTo(120 + 3 * R, 1)
    })

    it('eine reale Pause fällt zum Plateau zusammen — Umkehrung liefert die Ankunft', () => {
      // Fahrt (6 km) → Pause (1380 s, 0 m) → Fahrt (6 km), keine Halte
      const pausenTrack: TrackPoint[] = [
        [9, 47, 0, 0],
        [9 + dLng6km, 47, 0, 600],
        [9 + dLng6km, 47, 0, 1980],
        [9 + 2 * dLng6km, 47, 0, 2580],
      ]
      const a2 = buildTimelineAxis(
        [{ mode: 'bike', active: true, pts: pausenTrack }],
        [],
        buildScale(pausenTrack)!,
      )
      // Beide Pausen-Ränder liegen auf demselben Anteil (0 Filmzeit dazwischen)
      expect(offsetToFraction(a2, 1980)).toBeCloseTo(offsetToFraction(a2, 600.01), 4)
      // Ein Anteil exakt auf der Plateau-Kante übersetzt zur ANKUNFT
      expect(fractionToOffset(a2, offsetToFraction(a2, 600))).toBeCloseTo(600, 2)
    })

    it('Fahranteil der Achse stimmt mit der Dauer-Schätzung überein (eine Formel)', () => {
      // Die Schätzung ist die reine REISEzeit — sie kennt die Rampen nicht (und
      // kann sie nicht kennen: wo sie liegen, entscheiden die Halte). Was beide
      // teilen müssen, ist das Tempo-Modell, und genau das prüft die Zeile.
      const gesamtOhneHalt = buildTimelineAxis(abschnitte, [], fSkala).curve?.totalS
      expect(gesamtOhneHalt).toBeCloseTo(estimateAnimationDuration(abschnitte, []) + R, 6)
    })

    it('Halte kommen als INTERVALLE zurück — in Aufnahmezeit gibt es sie nicht', () => {
      const gerundet = (a: typeof achse): number[][] =>
        (a.stops ?? []).map((h) => [
          h.offsetS,
          h.widthS,
          +h.filmFrom.toFixed(3),
          +h.filmTo.toFixed(3),
        ])
      expect(gerundet(achse)).toEqual([[600, 20, 50 + 2 * R, 70 + 2 * R]])
      // `indizes` reicht die Achse unverändert durch (Rückweg zum Stopp)
      const mitId = buildTimelineAxis(
        abschnitte,
        [{ offsetS: 600, widthS: 20, indices: [3] }],
        fSkala,
      )
      expect(mitId.stops?.[0]?.indices).toEqual([3])
      // Zwei Halte: der spätere kennt die Filmzeit des früheren schon
      const zwei = buildTimelineAxis(
        abschnitte,
        [
          { offsetS: 900, widthS: 6 },
          { offsetS: 600, widthS: 20 },
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
      expect(buildTimelineAxis(abschnitte, [{ offsetS: 600, widthS: 0 }], fSkala).stops).toEqual([])
    })

    it('stopAtFilmS sagt, WO im Halt der Kopf steht', () => {
      expect(stopAtFilmS(achse, 50 + 2 * R - 0.1)).toBeNull()
      const ankunft = stopAtFilmS(achse, 50 + 2 * R)
      expect(ankunft?.index).toBe(0)
      expect(ankunft?.inStopS).toBeCloseTo(0, 6)
      expect(ankunft?.remainingS).toBeCloseTo(20, 6)
      expect(stopAtFilmS(achse, 62.1 + 2 * R)?.inStopS).toBeCloseTo(12.1, 6)
      expect(stopAtFilmS(achse, 62.1 + 2 * R)?.remainingS).toBeCloseTo(7.9, 6)
      // Die Abfahrt gehört schon zur Weiterfahrt
      expect(stopAtFilmS(achse, 70.1 + 2 * R)).toBeNull()
      // … außer der Film endet im Halt: dann steht der Kopf bis zuletzt darin
      const amEnde = buildTimelineAxis(abschnitte, [{ offsetS: 1200, widthS: 8 }], fSkala)
      expect(stopAtFilmS(amEnde, amEnde.curve!.totalS)?.inStopS).toBeCloseTo(8, 6)
      // Ohne Halte gibt es nichts zu melden
      expect(stopAtFilmS(buildTimelineAxis(abschnitte, [], fSkala), 10)).toBeNull()
    })

    it('ein Halt aus drei Aufnahmen löst sich zu „Aufnahme n von m" auf', () => {
      // Drei Fotos à 5,2 s + 0,8 s Ausblendung = 6 s je Aufnahme, 18 s Halt
      const items = ['m1', 'm2', 'm3'].map((id) => ({ id, durationS: 6 }))
      const drei = buildTimelineAxis(abschnitte, [{ offsetS: 600, widthS: 18, items }], fSkala)
      const halt = drei.stops?.[0]
      expect(halt?.filmTo! - halt!.filmFrom).toBeCloseTo(18, 6)

      // Kopf 8 Filmsekunden nach der Ankunft: zweite Aufnahme, 2 s in ihr drin
      const mitten = stopAtFilmS(drei, halt!.filmFrom + 8)
      expect(mitten?.item).toMatchObject({ no: 2, count: 3, id: 'm2' })
      expect(mitten?.item?.inS).toBeCloseTo(2, 6)
      expect(describeStopState(mitten!)).toBe('Aufnahme 2 von 3 · 2,0 s von 6,0 s')

      // Kanten: Ankunft ist die erste, kurz vor der Abfahrt die letzte
      expect(stopAtFilmS(drei, halt!.filmFrom)?.item?.no).toBe(1)
      expect(stopAtFilmS(drei, halt!.filmFrom + 17.9)?.item?.no).toBe(3)
      // Eine einzelne Aufnahme braucht kein Zählwerk („Aufnahme 1 von 1")
      const eine = buildTimelineAxis(
        abschnitte,
        [{ offsetS: 600, widthS: 6, items: [{ id: 'm1', durationS: 6 }] }],
        fSkala,
      )
      expect(describeStopState(stopAtFilmS(eine, eine.stops![0]!.filmFrom + 2.5)!)).toBe(
        '2,5 s von 6,0 s',
      )
      // Ohne bekannte Stücke zählt die Zeit im ganzen Halt
      expect(describeStopState(stopAtFilmS(achse, 62.1 + 2 * R)!)).toBe('12,1 s von 20,0 s')
    })

    it('5-Filmsekunden-Schritte überspringen keinen Halt', () => {
      // Der alte Weg rechnete in AUFNAHMEzeit: an einem 6-s-Halt kam man nie
      // vorbei, weil die Rückrechnung immer auf die linke Haltkante fiel.
      const halte = [
        { offsetS: 300, widthS: 6 },
        { offsetS: 600, widthS: 6 },
        { offsetS: 900, widthS: 5.2 },
      ]
      const a = buildTimelineAxis(abschnitte, halte, fSkala)
      const besucht = new Set<number>()
      for (let f = 0; f <= a.curve!.totalS; f = stepFilmS(a, f, 5)) {
        const stand = stopAtFilmS(a, f)
        if (stand) besucht.add(stand.index)
        if (f >= a.curve!.totalS) break
      }
      expect([...besucht].sort()).toEqual([0, 1, 2])

      // Der Schritt klemmt an den Enden der Achse und geht auch rückwärts
      expect(stepFilmS(a, 0, -5)).toBe(0)
      expect(stepFilmS(a, a.curve!.totalS, 5)).toBeCloseTo(a.curve!.totalS, 6)
      expect(stepFilmS(a, 20, -5)).toBeCloseTo(15, 6)

      // Zum Vergleich der ALTE Weg (Aufnahmezeit als führende Größe): er bleibt
      // an der Haltkante hängen, ein Schritt bringt keine Filmsekunde Gewinn.
      const kante = a.stops![0]!
      const zeitImHalt = fractionToOffset(a, filmToFraction(a, kante.filmFrom + 3))
      expect(filmToFraction(a, filmToOffset(a, zeitImHalt))).toBeCloseTo(
        filmToFraction(a, kante.filmFrom),
        6,
      )
    })

    it('die Achse rechnet ein Video mit seiner echten Länge', () => {
      // Ein 34-s-Video bekam als „Foto" 5,2 s — an einer 293-s-Tour ~34 px
      // statt ~200 px Achsenbreite (docs/archive/zeitleiste-umbau.md §6).
      expect(mediumHoldS({ type: 'video', durationS: 34 })).toBe(34)
      // holdS ist bei Video wirkungslos: der Player läuft bis zum Dateiende
      expect(mediumHoldS({ type: 'video', durationS: 34, display: { holdS: 8 } })).toBe(34)
      // Ohne bekannte Länge (unverarbeiteter Altbestand) bleibt die Annahme
      expect(mediumHoldS({ type: 'video' })).toBe(STOP_ENGINE_S)
      // Fotos bleiben, wie sie waren
      expect(mediumHoldS({ type: 'photo' })).toBe(STOP_ENGINE_S)
      expect(mediumHoldS({ type: 'photo', display: { holdS: 12 } })).toBe(12)

      const video = {
        id: 'v1',
        durationS: mediumHoldS({ type: 'video', durationS: 34 }) + STOP_FADE_OUT_S,
      }
      const mitVideo = buildTimelineAxis(
        abschnitte,
        [{ offsetS: 600, widthS: video.durationS, items: [video] }],
        fSkala,
      )
      // 100 s Fahrt + 34,8 s Video statt 100 + 6, dazu die drei Rampen
      expect(mitVideo.curve?.totalS).toBeCloseTo(134.8 + 3 * R, 1)
      expect(mitVideo.stops?.[0]?.widthS).toBeCloseTo(34.8, 6)
      // … und der Kopf steht mitten im Video, nicht in einer 6-s-Annahme
      expect(stopAtFilmS(mitVideo, mitVideo.stops![0]!.filmFrom + 20)?.item?.inS).toBeCloseTo(20, 6)
    })

    it('Szenen-Klips: ein Halt ist eine Kette, jede Aufnahme mit eigener Breite', () => {
      // Drei Aufnahmen am selben Ort: 6 s + 34,8 s Video + 6 s = 46,8 s Halt
      const items = [
        { id: 'm1', durationS: 6 },
        { id: 'v1', durationS: 34.8 },
        { id: 'm2', durationS: 6 },
      ]
      const kette = buildTimelineAxis(
        abschnitte,
        [
          { offsetS: 600, widthS: 46.8, items },
          { offsetS: 900, widthS: 6, items: [{ id: 'm3', durationS: 6 }] },
        ],
        fSkala,
      )
      const klips = buildSceneClips(kette)
      expect(klips.map((k) => k.id)).toEqual(['m1', 'v1', 'm2', 'm3'])
      // Lückenlos aneinander, jeder mit seiner eigenen Filmbreite
      const halt = kette.stops![0]!
      expect(klips[0]!.filmFrom).toBeCloseTo(halt.filmFrom, 6)
      expect(klips[0]!.filmTo).toBeCloseTo(klips[1]!.filmFrom, 6)
      expect(klips[1]!.filmTo - klips[1]!.filmFrom).toBeCloseTo(34.8, 6)
      expect(klips[2]!.filmTo).toBeCloseTo(halt.filmTo, 6)
      // Der Platz in der Kette ist der Rückweg zum Halt
      expect(klips.map((k) => [k.stopIndex, k.slot, k.count])).toEqual([
        [0, 0, 3],
        [0, 1, 3],
        [0, 2, 3],
        [1, 0, 1],
      ])
      // Halte ohne bekannte Stücke (Kamera-Momente) haben keine Klips
      expect(
        buildSceneClips(buildTimelineAxis(abschnitte, [{ offsetS: 600, widthS: 6 }], fSkala)),
      ).toEqual([])
    })

    it('die Karte steht so lange wie ihr Klip — dieselbe Größe, nicht zwei', () => {
      // Die Foto-Einblendung hängt an der Kopfposition (`stopAtFilmS`), die
      // Klips an `buildSceneClips` — beide lesen dieselben Stücke der Achse.
      // Vorher lief ein Timer über die reine STANDZEIT, der Klip aber über
      // Standzeit + Ausblendung: das Bild ging 0,8 s vor seinem Klip aus.
      const items = [
        { id: 'm1', durationS: STOP_ENGINE_S + STOP_FADE_OUT_S },
        { id: 'm2', durationS: 12 + STOP_FADE_OUT_S },
      ]
      const breite = items.reduce((s2, x) => s2 + x.durationS, 0)
      const a = buildTimelineAxis(abschnitte, [{ offsetS: 600, widthS: breite, items }], fSkala)
      for (const k of buildSceneClips(a)) {
        // Kurz vor der rechten Kante läuft die Karte noch …
        const drin = stopAtFilmS(a, k.filmTo - 0.01)
        expect(drin?.item?.id).toBe(k.id)
        expect(drin!.item!.durationS).toBeCloseTo(k.filmTo - k.filmFrom, 6)
        // … und an der Ankunft gehört sie schon dem Klip selbst
        expect(stopAtFilmS(a, k.filmFrom + 0.01)?.item?.id).toBe(k.id)
      }
      // Hinter dem letzten Klip ist die Karte weg — nicht davor
      expect(stopAtFilmS(a, a.stops![0]!.filmTo)).toBeNull()
    })

    it('Klip-Zug in der Kette: der Platz entscheidet sich an der MITTE', () => {
      const items = ['a', 'b', 'c'].map((id) => ({ id, durationS: 6 }))
      const kette = buildTimelineAxis(abschnitte, [{ offsetS: 600, widthS: 18, items }], fSkala)
      const halt = kette.stops![0]!
      // Vor der Mitte des ersten Klips: Platz 0, die Marke steht an der Ankunft
      expect(slotInChain(halt, halt.filmFrom + 1)).toEqual({ slot: 0, filmS: halt.filmFrom })
      // Über die Mitte hinaus rutscht sie eine Fuge weiter
      expect(slotInChain(halt, halt.filmFrom + 4)).toEqual({ slot: 1, filmS: halt.filmFrom + 6 })
      expect(slotInChain(halt, halt.filmFrom + 10)).toEqual({ slot: 2, filmS: halt.filmFrom + 12 })
      // Ganz hinten: Platz 3 von 3 (die Fuge hinter dem letzten Klip)
      expect(slotInChain(halt, halt.filmTo)).toEqual({ slot: 3, filmS: halt.filmTo })

      // … und daraus wird die neue Reihenfolge. Nach hinten geschoben rückt
      // alles dazwischen um eins vor — ohne das landete a immer zu weit rechts.
      expect(moveToSlot(['a', 'b', 'c'], 'a', 0)).toEqual(['a', 'b', 'c'])
      expect(moveToSlot(['a', 'b', 'c'], 'a', 1)).toEqual(['a', 'b', 'c'])
      expect(moveToSlot(['a', 'b', 'c'], 'a', 2)).toEqual(['b', 'a', 'c'])
      expect(moveToSlot(['a', 'b', 'c'], 'a', 3)).toEqual(['b', 'c', 'a'])
      expect(moveToSlot(['a', 'b', 'c'], 'c', 0)).toEqual(['c', 'a', 'b'])
      // Unbekannte ID lässt die Liste in Ruhe
      expect(moveToSlot(['a', 'b'], 'x', 0)).toEqual(['a', 'b'])
    })

    it('Andocken: nur das INNERE eines fremden Halts zählt', () => {
      const halt = achse.stops![0]!
      expect(stopInnerAt(achse, halt.filmFrom - 0.1)).toBeNull()
      // Die Ankunft gehört noch der Fahrt: dort setzt man eine Aufnahme davor ab
      expect(stopInnerAt(achse, halt.filmFrom)).toBeNull()
      expect(stopInnerAt(achse, halt.filmFrom + 0.1)?.offsetS).toBe(600)
      expect(stopInnerAt(achse, halt.filmTo - 0.1)?.offsetS).toBe(600)
      // Die Abfahrt ebenso — sonst käme man hinter dem Halt nie zum Stehen
      expect(stopInnerAt(achse, halt.filmTo)).toBeNull()
      expect(stopInnerAt(buildTimelineAxis(abschnitte, [], fSkala), 10)).toBeNull()
    })

    it('Standzeit am Griff: Zehntel und die Grenzen des Server-Schemas', () => {
      expect(clampHoldS(7.34)).toBe(7.3)
      expect(clampHoldS(7.36)).toBe(7.4)
      // Ohne Klemme liefe der Griff in einen Wert, den das Speichern ablehnt
      expect(clampHoldS(-40)).toBe(HOLD_MIN_S)
      expect(clampHoldS(999)).toBe(HOLD_MAX_S)
      expect(formatSeconds(5.2)).toBe('5,2 s')
    })

    it('Moment-Dauer am Griff: dieselbe Geste, die Grenzen des Moment-Schemas', () => {
      // Ein Moment ist seit dem Nachtrag zu Etappe 2 ein Klip der Szenen-Bahn
      // und hat damit denselben rechten Griff wie ein Foto — nur andere
      // Grenzen (schema/edits.ts: 1..30 statt 2..60).
      expect(clampMomentDuration(6.34)).toBe(6.3)
      expect(clampMomentDuration(0)).toBe(MOMENT_MIN_S)
      expect(clampMomentDuration(999)).toBe(MOMENT_MAX_S)
    })

    it('Fortbewegungs-Zug: die Grenze landet, wo sie losgelassen wurde (Fixpunkt)', () => {
      // Die Grenze beeinflusst die Abbildung, auf der sie liegt — mit der Achse
      // des Vorframes gerechnet sprang sie beim Loslassen 116 px (docs §6).
      // Die Zug-Kurve rechnet stattdessen, was VOR der Kante liegt: das ändert
      // sich beim Ziehen nicht, also ist sie exakt umkehrbar. Erst dadurch darf
      // der Zug live ins Modell schreiben — die Kante steht nach jedem
      // Neuaufbau wieder unter dem Zeiger.
      const halte = [{ offsetS: 300, widthS: 12 }]
      const a = buildTimelineAxis(abschnitte, halte, fSkala)
      const kurve = buildBoundaryCurve(
        fahrTrack,
        fSkala.fromS,
        fSkala.toS,
        { before: null, left: 'walk', right: 'bike' },
        0,
        a.stops ?? [],
      )!

      // Die PROBE, die der Live-Zug macht: Zeit aus der Kurve holen, damit die
      // Achse NEU bauen — und die Kante muss wieder auf derselben Filmsekunde
      // stehen. (Ohne die Kurve wich das um bis zu 5,4 s ab.)
      const achseMitGrenze = (t: number): TimelineAxis =>
        buildTimelineAxis(
          splitForDisplay(
            [{ mode: 'bike', pts: fahrTrack }],
            {
              schema: 'maptale/edits@2',
              travelModes: [
                { from: iso(fSkala.fromS), mode: 'walk' },
                { from: iso(t), mode: 'bike' },
              ],
            },
            START,
          ),
          halte,
          fSkala,
        )
      // Die Restabweichung ist die SEKUNDENRUNDUNG des Ankers: `offsetToIso`
      // schneidet die Millisekunden ab, eine Sekunde Aufnahmezeit sind hier
      // 0,05 Filmsekunden (zu Fuß ≈ 0,2 px). Darunter geht es nicht, und mehr
      // braucht es nicht.
      // Ziele als ANTEILE der Zug-Kurve, nicht als feste Sekunden: Sonst hängt
      // der Test daran, wie schnell zu Fuß gerade ist.
      for (const ziel of [0.12, 0.36, 0.7, 0.95].map((f) => f * kurve.totalS)) {
        const t = recordingTimeAtFilmTime(kurve, ziel)
        expect(Math.abs(filmToOffset(achseMitGrenze(t), t) - ziel)).toBeLessThan(0.1)
      }

      // Monoton und im Fenster geklemmt
      expect(recordingTimeAtFilmTime(kurve, -50)).toBeCloseTo(fSkala.fromS, 6)
      expect(recordingTimeAtFilmTime(kurve, 1e6)).toBeCloseTo(fSkala.toS, 6)
      // Der Halt im Fenster kostet Filmzeit, ohne von der Grenze abzuhängen —
      // dazu seine beiden Rampen und die Anfahrt aus dem Stand (zu Fuß 2,5 s je
      // Rampe).
      // Dazu der halbe Rampen-Versatz der gezogenen Kante selbst: Ihre Rampe
      // liegt zur Hälfte VOR ihr und wird nicht mehr im linken Tempo gefahren.
      expect(kurve.totalS).toBeCloseTo(
        12 +
          12000 / tempoMs('walk') +
          (3 * RAMP_M) / tempoMs('walk') +
          rampOffsetS(tempoMs('walk'), tempoMs('bike')),
        1,
      )
      expect(
        buildBoundaryCurve([], 0, 10, { before: null, left: 'walk', right: 'bike' }, 0, []),
      ).toBeNull()
    })

    it('Filmdauer-Vorschau: nur die umgewidmete Strecke ändert sich', () => {
      // Moped (1,15) → Fähre (2,5): dieselbe Strecke braucht weniger Film.
      const meterAlt = 0
      const meterNeu = 12000
      const laenger = filmDurationAtBoundary(200, meterAlt, meterNeu, 'walk', 'bike')
      // 12 km wechseln von Rad auf zu Fuß — die Differenz der Kehrwerte der Tempi
      const mehr = 12000 / tempoMs('walk') - 12000 / tempoMs('bike')
      expect(laenger).toBeCloseTo(200 + mehr, 3)
      // Zurückgezogen kehrt sich das Vorzeichen um
      expect(filmDurationAtBoundary(200, meterNeu, meterAlt, 'walk', 'bike')).toBeCloseTo(
        200 - mehr,
        3,
      )
      // Gleicher Modus links wie rechts ändert nichts
      expect(filmDurationAtBoundary(200, 0, 5000, 'bike', 'bike')).toBeCloseTo(200, 6)
    })

    it('Einrasten an Haltkanten: ±0,5 s Aufnahmezeit, „dahinter" strikt danach', () => {
      const a = buildTimelineAxis(abschnitte, [{ offsetS: 600, widthS: 20 }], fSkala)
      const halte = a.stops!
      const halt = halte[0]!
      // Knapp davor: rastet auf die Halt-Zeit selbst (= vor dem Sprung)
      expect(snapToStop(halte, 599.7, halt.filmFrom - 0.3)).toMatchObject({
        tOffsetS: 600,
        behind: false,
      })
      // Knapp dahinter: STRIKT nach der Haltzeit — ein Epsilon fiele auf
      // dieselbe Sekunde zurück (ISO-Anker sind sekundengenau).
      expect(snapToStop(halte, 600.3, halt.filmTo + 0.3)).toMatchObject({
        tOffsetS: 600 + SNAP_BEHIND_S,
        behind: true,
      })
      // Außerhalb der Toleranz bleibt die Zeit, wie sie ist
      expect(snapToStop(halte, 597, halt.filmFrom - 40)).toEqual({
        tOffsetS: 597,
        stop: null,
        behind: false,
      })
      // MITTEN im Halt gibt es keine Zwischenposition — die Zeigerhälfte entscheidet
      expect(snapToStop(halte, 600, halt.filmFrom + 1).behind).toBe(false)
      expect(snapToStop(halte, 600, halt.filmTo - 1).behind).toBe(true)
    })

    it('Mitten in einem Halt gibt es keine Zeit — dort MUSS gerastet werden', () => {
      // Zeigt der Zeiger auf eine Filmsekunde INNERHALB eines Halts, liefert die
      // Umkehrung dessen Zeit — und die Hin-Richtung fällt per lower_bound auf
      // seine LINKE Flanke zurück. Ohne Rasten spränge die Kante beim Loslassen
      // um bis zu eine ganze Standzeit (gemessen 5,4 s / 17,6 px); genau
      // deshalb ist das Einrasten hier keine Bequemlichkeit, sondern die
      // einzige Art, in einem Halt überhaupt eine Position zu benennen.
      const a = buildTimelineAxis(abschnitte, [{ offsetS: 600, widthS: 12 }], fSkala)
      const halte = a.stops!
      const halt = halte[0]!
      const mitten = halt.filmFrom + 6

      // Roh: nicht umkehrbar
      const roh = fractionToOffset(a, filmToFraction(a, mitten))
      expect(filmToOffset(a, roh)).toBeCloseTo(halt.filmFrom, 6)
      // Gerastet: die rechte Flanke, und die ist umkehrbar
      const kur = snapToStop(halte, roh, mitten)
      expect(kur.behind).toBe(true)
      expect(kur.tOffsetS).toBe(600 + SNAP_BEHIND_S)
      expect(filmToOffset(a, kur.tOffsetS)).toBeGreaterThanOrEqual(halt.filmTo)

      // Außerhalb jedes Halts bleibt die Zeit unangetastet — der Fixpunkt
      const frei = halt.filmFrom - 20
      const freiT = fractionToOffset(a, filmToFraction(a, frei))
      expect(snapToStop(halte, freiT, frei).tOffsetS).toBeCloseTo(freiT, 6)
      expect(filmToOffset(a, freiT)).toBeCloseTo(frei, 6)
    })

    it('Klemmen in PIXELN hält das Band greifbar', () => {
      // Mit ±1 s konnten zwei Grenzen so nah zusammenrücken, dass das Band
      // dazwischen unsichtbar und unanfassbar wurde.
      const px = 10 // 10 px je Filmsekunde → 14 px = 1,4 s Mindestabstand
      expect(clampFilmS(50, 40, 100, px)).toBe(50)
      expect(clampFilmS(40, 40, 100, px)).toBeCloseTo(40 + BAND_MIN_PX / px, 6)
      expect(clampFilmS(1000, 40, 100, px)).toBeCloseTo(100 - BAND_MIN_PX / px, 6)
      // Stark gezoomt schrumpft die Luft in Sekunden — die Pixel bleiben gleich
      expect(clampFilmS(40, 40, 100, 100)).toBeCloseTo(40.14, 6)
      // Fenster schmaler als zweimal Luft: nur die Mitte bleibt übrig
      expect(clampFilmS(41, 40, 42, px)).toBe(41)
    })

    // — Der ganze Loslass-Weg, DOM-frei nachgebaut —
    //
    // Die Bausteine sind einzeln geprüft (Grenzkurve, Rasten, Klemmen). Was
    // schiefging, war ihr ZUSAMMENSPIEL: gemischte Koordinatensysteme, die
    // Sekundenrundung des ISO-Ankers, die Klemme gegen den Nachbarn. Deshalb
    // fahren die folgenden Tests die Kette so ab, wie `moveEdgeDrag` sie
    // fährt — klemmen → rasten → schreiben → Achse NEU bauen — und messen am
    // Ende dort, wo der Nutzer hinsieht: an der fertigen Leiste.
    describe('Kantenzug: wo die Grenze landet', () => {
      const halte = [{ offsetS: 600, widthS: 20 }]
      /** Achse aus einem Overlay — genau das, was der Editor je Frame neu baut. */
      const achseVon = (edits: EditOverlay): TimelineAxis =>
        buildTimelineAxis(
          splitForDisplay([{ mode: 'bike', pts: fahrTrack }], edits, START),
          halte,
          fSkala,
        )

      /** `moveBoundary('travelMode', …)` aus editor.ts, ohne Zustand. */
      function schreibeGrenze(
        edits: EditOverlay,
        altAb: string,
        zielS: number,
      ): { edits: EditOverlay; from: string } {
        const geklemmt = clampBoundary(
          edits.travelModes ?? [],
          altAb,
          START,
          Math.max(fSkala.fromS, Math.min(fSkala.toS, zielS)),
        )
        const neuAb = iso(geklemmt)
        if (neuAb === altAb) return { edits, from: altAb }
        const alt = edits.travelModes?.find((g) => g.from === altAb)
        if (!alt || edits.travelModes?.some((g) => g.from === neuAb)) return { edits, from: altAb }
        return {
          edits: withTravelModeBoundary(withoutTravelModeBoundary(edits, altAb), neuAb, alt.mode),
          from: neuAb,
        }
      }

      /** Ein Zieh-Frame: Zeiger zeigt auf `zielFilmS`. */
      function ziehFrame(
        edits: EditOverlay,
        from: string,
        zielFilmS: number,
        zug: {
          fromS: number
          toS: number
          minFilmS: number
          maxFilmS: number
          zeitBei: (f: number) => number
        },
        pxProFilmS: number,
      ): { edits: EditOverlay; from: string; gerastet: boolean; behind: boolean } {
        const achse = achseVon(edits)
        const filmS = clampFilmS(zielFilmS, zug.minFilmS, zug.maxFilmS, pxProFilmS)
        // Gerastet wird an den Halten, wie sie JETZT auf der Leiste stehen
        const sichtbar = (achse.stops ?? []).filter(
          (h) => h.offsetS > zug.fromS && h.offsetS <= zug.toS,
        )
        const rast = snapToStop(
          sichtbar,
          fractionToOffset(achse, filmToFraction(achse, filmS)),
          filmS,
        )
        const ziel = rast.stop ? rast.tOffsetS : zug.zeitBei(filmS)
        return { ...schreibeGrenze(edits, from, ziel), gerastet: !!rast.stop, behind: rast.behind }
      }

      /** Zug-Start für eine Fortbewegungs-Kante bei `kanteS` (Vorgänger bei `vonS`). */
      function starte(
        edits: EditOverlay,
        kanteS: number,
        fromS: number,
        left: TravelMode,
        right: TravelMode,
        before: TravelMode | null = null,
      ) {
        const achse = achseVon(edits)
        const kurve = buildBoundaryCurve(
          fahrTrack,
          fromS,
          fSkala.toS,
          { before, left, right },
          filmToOffset(achse, fromS),
          achse.stops ?? [],
        )!
        return {
          fromS,
          toS: fSkala.toS,
          minFilmS: filmToOffset(achse, fromS),
          maxFilmS: kurve.totalS,
          zeitBei: (f: number): number => recordingTimeAtFilmTime(kurve, f),
        }
      }

      /** Filmsekunde, auf der die Kante nach dem Loslassen steht. */
      const landung = (edits: EditOverlay, from: string): number =>
        filmToOffset(achseVon(edits), isoToOffset(START, from))

      // Eine Aufnahme-Sekunde ist die feinste Auflösung, die ein Overlay-Anker
      // hat (`offsetToIso` schneidet die Millisekunden ab) — mehr Genauigkeit
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
          schema: 'maptale/edits@2',
          travelModes: [
            { from: iso(0), mode: 'walk' },
            { from: iso(600), mode: 'bike' },
          ],
        }
        const zug = starte(start, 600, 0, 'walk', 'bike')

        for (const ziel of [20, 40, 100, 200]) {
          const f = ziehFrame(start, iso(600), ziel, zug, 10)
          expect(f.gerastet).toBe(false) // fern jedes Halts — hier gilt der Fixpunkt
          expect(Math.abs(landung(f.edits, f.from) - ziel)).toBeLessThan(RUNDUNG_WALK_S + 0.01)
        }

        // Und über viele Frames hinweg: der Zug schreibt live, jeder Frame baut
        // auf dem vorigen auf — die Kante darf dabei nicht davonwandern.
        let stand = { edits: start, from: iso(600) }
        for (const ziel of [200, 150, 100, 60, 100, 150, 200]) {
          const f = ziehFrame(stand.edits, stand.from, ziel, zug, 10)
          stand = { edits: f.edits, from: f.from }
          if (f.gerastet) continue // Rasten ist die eine gewollte Ausnahme (s. u.)
          expect(Math.abs(landung(stand.edits, stand.from) - ziel)).toBeLessThan(
            RUNDUNG_WALK_S + 0.01,
          )
        }
        // Am Ende der Bewegung steht die Kante wieder genau unter dem Zeiger
        expect(Math.abs(landung(stand.edits, stand.from) - 200)).toBeLessThan(RUNDUNG_WALK_S + 0.01)
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
          schema: 'maptale/edits@2',
          travelModes: [
            { from: iso(0), mode: 'walk' },
            { from: iso(288), mode: 'bike' },
          ],
        }
        const zug = starte(start, 288, 0, 'walk', 'bike')
        const halt = achseVon(start).stops![0]!
        // 60 s Fußweg + 26 s Rad bis zum Halt, dazu die Anfahrt aus dem Stand
        // (+2,5 s), das Bremsen vor dem Halt (+1 s) und die Rampe an der
        // Modus-Grenze selbst, die etwas EINSPART.
        // 2880 m zu Fuß + 3120 m mit dem Rad bis zum Halt
        const bis =
          2880 / tempoMs('walk') +
          3120 / tempoMs('bike') +
          RAMP_M / tempoMs('walk') +
          RAMP_M / tempoMs('bike') +
          modusRampeS(tempoMs('walk'), tempoMs('bike'))
        expect(halt.filmFrom).toBeCloseTo(bis, 6) // rechts der Kante
        expect(halt.filmTo).toBeCloseTo(bis + 20, 6)

        const f = ziehFrame(start, iso(288), halt.filmFrom + 10, zug, 10)
        expect(f.gerastet).toBe(true)
        expect(isoToOffset(START, f.from)).toBe(600 + SNAP_BEHIND_S)
        // Der Halt ist mitgewandert (mehr Fußweg davor) — die Kante steht
        // dahinter, nicht mehr auf dem angepeilten Pixel.
        // Alles bis zum Halt ist jetzt Fußweg: 6000 m plus Anfahrt und Bremsen.
        expect(achseVon(f.edits).stops![0]!.filmFrom).toBeCloseTo(
          6000 / tempoMs('walk') + (2 * RAMP_M) / tempoMs('walk'),
          6,
        )

        // Wichtig ist nur, dass sich das im nächsten Frame FÄNGT: der Zeiger
        // liegt jetzt links des Halts, also gilt wieder der Fixpunkt. Es
        // pendelt nicht — ein Halt liegt in ruhiger Lage stets RECHTS der
        // Kante, ein Dauerflackern ist damit ausgeschlossen.
        const f2 = ziehFrame(f.edits, f.from, halt.filmFrom + 10, zug, 10)
        expect(f2.gerastet).toBe(false)
        expect(Math.abs(landung(f2.edits, f2.from) - (halt.filmFrom + 10))).toBeLessThan(
          RUNDUNG_WALK_S + 0.01,
        )
      })

      it('(a) Kamera: ohne Rückwirkung auf die Achse landet die Kante exakt', () => {
        // Kamera und Wetter ändern die Filmdauer nicht — hier ist `zeitBei` die
        // Achse selbst, und die Landung muss auf das Tausendstel stimmen.
        const achse = achseVon(EMPTY_OVERLAY)
        for (const ziel of [10, 35, 90, 115]) {
          const t = fractionToOffset(achse, filmToFraction(achse, ziel))
          // außerhalb der Halt-Sprungs bleibt die Umkehrung exakt
          if (stopInnerAt(achse, ziel)) continue
          expect(filmToOffset(achse, t)).toBeCloseTo(ziel, 3)
        }
      })

      it('(b) Einrasten trifft die Seite, auf die gezeigt wird', () => {
        const start: EditOverlay = {
          schema: 'maptale/edits@2',
          travelModes: [
            { from: iso(0), mode: 'walk' },
            { from: iso(300), mode: 'bike' },
          ],
        }
        const zug = starte(start, 300, 0, 'walk', 'bike')
        const halt = achseVon(start).stops!.find((h) => h.offsetS === 600)!

        // Vordere Hälfte des Halts → die Grenze landet VOR ihm: er läuft
        // vollständig im neuen Zustand ab.
        const vorne = ziehFrame(start, iso(300), halt.filmFrom + 1, zug, 10)
        expect(vorne).toMatchObject({ gerastet: true, behind: false })
        expect(isoToOffset(START, vorne.from)).toBe(600)
        const aVorne = achseVon(vorne.edits)
        expect(landung(vorne.edits, vorne.from)).toBeCloseTo(aVorne.stops![0]!.filmFrom, 6)

        // Hintere Hälfte → dahinter, und zwar eine GANZE Sekunde: ein Epsilon
        // fiele durch die Sekundenrundung des Ankers wieder davor.
        const hinten = ziehFrame(start, iso(300), halt.filmTo - 1, zug, 10)
        expect(hinten).toMatchObject({ gerastet: true, behind: true })
        expect(isoToOffset(START, hinten.from)).toBe(600 + SNAP_BEHIND_S)
        const aHinten = achseVon(hinten.edits)
        expect(landung(hinten.edits, hinten.from)).toBeGreaterThanOrEqual(aHinten.stops![0]!.filmTo)

        // Der Halt bleibt dabei ein Halt — er wird nicht zerschnitten
        expect(aHinten.stops![0]!.filmTo - aHinten.stops![0]!.filmFrom).toBeCloseTo(20, 6)
      })

      it('(c) zwei Grenzen können nicht unter die Mindestbreite zusammenrücken', () => {
        const px = 10
        const start: EditOverlay = {
          schema: 'maptale/edits@2',
          travelModes: [
            { from: iso(0), mode: 'walk' },
            { from: iso(300), mode: 'bike' },
            { from: iso(900), mode: 'jeep' },
          ],
        }
        // Die hintere Kante ganz nach links gezogen — auf ihren Vorgänger
        const zug = starte(start, 900, 300, 'bike', 'jeep', 'walk')
        const gezogen = ziehFrame(start, iso(900), -1000, zug, px)
        const neu = achseVon(gezogen.edits)
        const breitePx = (landung(gezogen.edits, gezogen.from) - filmToOffset(neu, 300)) * px
        // Mindestens ein greifbares Band — bis auf die Sekundenrundung des Ankers
        expect(breitePx).toBeGreaterThan(BAND_MIN_PX - RUNDUNG_BIKE_S * px - 0.01)
        expect(breitePx).toBeLessThan(BAND_MIN_PX + 1)

        // Ohne die Pixel-Klemme wäre das Band verschwunden — unsichtbar UND
        // nicht mehr anzufassen (das war der Bug, den BAND_MIN_PX behebt).
        const ohneKlemme = schreibeGrenze(start, iso(900), zug.zeitBei(zug.minFilmS))
        const aOhne = achseVon(ohneKlemme.edits)
        const engPx =
          (filmToOffset(aOhne, isoToOffset(START, ohneKlemme.from)) - filmToOffset(aOhne, 300)) * px
        expect(engPx).toBeLessThan(2)

        // Und die vordere Grenze steht danach unverändert da: was VOR der
        // gezogenen Kante liegt, rührt der Zug nicht an.
        expect(filmToOffset(neu, 300)).toBeCloseTo(filmToOffset(achseVon(start), 300), 6)
      })
    })

    it('Spielkurve: Identität ohne Trim, Plateau über weggetrimmten Bereichen', () => {
      const identitaet = buildPlaybackCurve(achse, abschnitte)
      expect(identitaet).toEqual({ fractions: [0, 1], filmS: [0, gesamt], totalS: gesamt })

      const mitTrim = [
        { mode: 'bike' as const, active: true, pts: [fahrTrack[0]!, fahrTrack[1]!] },
        { mode: 'bike' as const, active: false, pts: [fahrTrack[1]!, fahrTrack[2]!] },
      ]
      const a2 = buildTimelineAxis(mitTrim, [{ offsetS: 300, widthS: 20 }], fSkala)
      const spiel = buildPlaybackCurve(a2, mitTrim)
      // Erster Abschnitt (50 s Fahrt + 20 s Halt + drei Rampen) spielt, der
      // getrimmte nicht
      const bisTrim = 70 + 3 * R
      expect(spiel.totalS).toBeCloseTo(bisTrim, 1)
      expect(filmAt(spiel, 1)).toBeCloseTo(bisTrim, 1)
      // Hinter der Trim-Grenze wächst die Spielzeit nicht mehr (Plateau)
      const grenzAnteil = offsetToFraction(a2, 600)
      expect(filmAt(spiel, grenzAnteil + 0.1)).toBeCloseTo(bisTrim, 1)
    })
  })

  describe('Undo: ein Zug ist ein Schritt', () => {
    // Der Editor setzt Undo-Punkte per REFERENZvergleich beim Voll-Render
    // (`lastState`). Ein Zeitleisten-Zug schreibt je Frame ein neues
    // Overlay, ruft dazwischen aber nur `renderAfterDrag()` — der Stand wird
    // dort nicht fortgeschrieben. Genau dieses Zusammenspiel ist hier
    // nachgebaut: `render()` steht für `renderAll`, alles andere für die
    // Frames dazwischen.
    const start = () => {
      const stack = { past: [] as EditOverlay[], future: [] as EditOverlay[] }
      let lastState: EditOverlay | null = null
      let edits: EditOverlay = EMPTY_OVERLAY
      const render = (): void => {
        recordUndo(stack, lastState, edits)
        lastState = edits
      }
      render() // Editor geöffnet
      return {
        stack,
        render,
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
      for (let i = 0; i < 12; i++)
        e.edits = withMediaEdit(e.edits, 'm1', { anchor: [9 + i / 1000, 47] })
      expect(e.stack.past).toHaveLength(0)
      e.render() // Loslassen
      expect(e.stack.past).toHaveLength(1)
      // Und der eine Schritt führt genau vor den Zug zurück
      expect(e.stack.past[0]).toBe(vorher)

      // Ein zweiter Zug legt genau einen weiteren Schritt ab
      const zwischen = e.edits
      for (let i = 0; i < 5; i++)
        e.edits = withMediaEdit(e.edits, 'm1', { display: { holdS: 6 + i } })
      e.render()
      expect(e.stack.past).toHaveLength(2)
      expect(e.stack.past[1]).toBe(zwischen)
    })

    it('ein Zug, der nichts ändert, ist auch kein Schritt', () => {
      // `assignOrder` schriebe auch für eine unveränderte Reihenfolge ein
      // neues Overlay — und das wäre ein Undo-Schritt, den man später einmal
      // umsonst rückgängig macht. Der Editor schreibt deshalb gar nicht erst.
      const e = start()
      e.render()
      e.render()
      expect(e.stack.past).toHaveLength(0)
    })

    it('eine neue Änderung verwirft die Redo-Zukunft', () => {
      const e = start()
      e.stack.future.push(EMPTY_OVERLAY)
      e.edits = withMediaEdit(e.edits, 'm1', { caption: 'Hafen' })
      e.render()
      expect(e.stack.past).toHaveLength(1)
      expect(e.stack.future).toHaveLength(0)
    })

    it('die Historie wächst nicht über HISTORIE_MAX, der jüngste Stand bleibt', () => {
      const e = start()
      for (let i = 0; i < HISTORY_MAX + 5; i++) {
        e.edits = withMediaEdit(e.edits, 'm1', { caption: `s${i}` })
        e.render()
      }
      expect(e.stack.past).toHaveLength(HISTORY_MAX)
      expect(e.stack.past[HISTORY_MAX - 1]?.media?.['m1']?.caption).toBe(`s${HISTORY_MAX + 3}`)
    })
  })

  it('formatiert Filmzeit als m:ss bzw. h:mm:ss', () => {
    expect(formatFilmTime(0)).toBe('0:00')
    expect(formatFilmTime(38)).toBe('0:38')
    expect(formatFilmTime(90)).toBe('1:30')
    expect(formatFilmTime(3600)).toBe('1:00:00')
    expect(formatFilmTime(3725)).toBe('1:02:05')
    expect(formatFilmTime(-5)).toBe('0:00')
  })

  it('Film-Maßband-Stufe ist die feinste, die noch lesbar bleibt', () => {
    expect(chooseFilmStep(60)).toBe(1)
    expect(chooseFilmStep(30)).toBe(2)
    expect(chooseFilmStep(12)).toBe(5)
    expect(chooseFilmStep(1)).toBe(60)
    expect(chooseFilmStep(0.001)).toBe(3600)
  })

  it('Film-Maßband: äquidistante Marken, volle Minuten kräftig, Ränder markiert', () => {
    const dLng6km = 6000 / (111_320 * Math.cos((47 * Math.PI) / 180))
    const track2: TrackPoint[] = [
      [9, 47, 0, 0],
      [9 + dLng6km, 47, 0, 600],
      [9 + 2 * dLng6km, 47, 0, 1200],
    ]
    const achse = buildTimelineAxis(
      [{ mode: 'bike', active: true, pts: track2 }],
      [{ offsetS: 600, widthS: 20 }],
      buildScale(track2)!,
    )
    const gesamtS = achse.curve!.totalS // 120 s + drei Rampen à 1 s
    const marken = buildFilmRuler(achse, 5) // 123 s × 5 px/s → 15-s-Stufe
    expect(marken.map((m) => m.text)).toEqual([
      '0:00',
      '0:15',
      '0:30',
      '0:45',
      '1:00',
      '1:15',
      '1:30',
      '1:45',
      '2:00',
    ])
    // film-linear ⇒ äquidistant
    for (let i = 1; i < marken.length; i++) {
      expect((marken[i]?.fraction ?? 0) - (marken[i - 1]?.fraction ?? 0)).toBeCloseTo(
        15 / gesamtS,
        6,
      )
    }
    expect(marken.filter((m) => m.full).map((m) => m.text)).toEqual(['0:00', '1:00', '2:00'])
    expect(marken[0]?.edge).toBe('start')
    expect(marken[marken.length - 1]?.edge).toBe('end')
    // Degeneriert: nichts zu beschriften
    expect(buildFilmRuler({ fromS: 0, toS: 100 }, 5)).toEqual([])
  })

  it('formatiert Dauern je nach Größenordnung', () => {
    expect(formatDuration(0)).toBe('0 Sek')
    expect(formatDuration(38)).toBe('38 Sek')
    expect(formatDuration(60)).toBe('1 Min')
    expect(formatDuration(870)).toBe('15 Min')
    expect(formatDuration(3600)).toBe('1:00 Std')
    expect(formatDuration(7500)).toBe('2:05 Std')
    expect(formatDuration(-5)).toBe('0 Sek')
  })

  it('Streckenmeter: kumuliert je Punkt, dazwischen interpoliert', () => {
    const kum = cumMeters(track)
    expect(kum[0]).toBe(0)
    expect(kum[1]).toBeCloseTo(7592, -1) // 0,1° Länge auf 47° Breite
    expect(kum[2]).toBeCloseTo(7592 + 5527, -1) // + 0,05° Breite
    expect(metersToOffset(kum, track, 0)).toBe(0)
    expect(metersToOffset(kum, track, 300)).toBeCloseTo(kum[1]! / 2, 3) // Mitte des ersten Segments
    expect(metersToOffset(kum, track, 1200)).toBeCloseTo(kum[2]!, 6)
    expect(metersToOffset(kum, track, 99_999)).toBeCloseTo(kum[2]!, 6) // hinterm Ende geklemmt
    expect(metersToOffset(kum, track, -50)).toBe(0)
  })

  it('Zoom-Anker: die angepeilte Stelle bleibt im Fenster stehen', () => {
    // Anker in der Mitte einer 1000-px-Achse soll bei Fenster-x 300 landen
    expect(scrollAnchor(0.5, 1000, 300, 168)).toBe(368)
    // Nie negativ scrollen: am Anfang klebt die Achse links
    expect(scrollAnchor(0, 1000, 500, 168)).toBe(0)
  })
})

// — Video-Schnitt: die Leiste zeigt, was der Server schneidet (Etappe 4, §2F) —

describe('clampMediaTrim (Drift-Wächter gegen video.ts)', () => {
  it('hat an BEIDEN Kanten das Material als Anschlag', () => {
    expect(clampMediaTrim({ fromS: 2, toS: 100 }, 30)).toEqual({ fromS: 2, toS: 30 })
    expect(clampMediaTrim({ fromS: -5, toS: 100 }, 30)).toBeNull() // = ganze Datei
    expect(clampMediaTrim({ fromS: 50, toS: 60 }, 30)).toBeNull()
    expect(clampMediaTrim({ fromS: 4 }, 30)).toEqual({ fromS: 4, toS: 30 })
    expect(clampMediaTrim(undefined, 30)).toBeNull()
  })

  it('deckt sich mit der Klemmung, die der Server anwendet', () => {
    // Die Regeln stehen zweimal: Der Server MUSS klemmen (er schneidet), die
    // Leiste SOLL dieselbe Breite zeigen. Laufen sie auseinander, plant man
    // einen Schnitt und sieht später einen anderen.
    const quelle = readFileSync(new URL('../server/src/pipeline/video.ts', import.meta.url), 'utf8')
    expect(quelle).toMatch(/if \(!\(toS - fromS > 0\.05\)\) return null/)
    expect(VIDEO_TRIM_MIN_S).toBe(0.05)
    // Der Vollschnitt gilt auf beiden Seiten als „kein Schnitt"
    expect(quelle).toMatch(/if \(fromS <= 0 && toS >= durationS\) return null/)
  })

  it('macht den Ripple zur Folge der Breite, nicht zu eigenem Code', () => {
    // Ein Video liegt in einer Halt-Kette ohne Lücken: wird es kürzer, wird sein
    // Halt schmaler und alles Folgende rückt vor. Es gibt keinen Ripple-Zweig.
    const ganz = mediumHoldS({ type: 'video', durationS: 34 })
    const geschnitten = mediumHoldS({ type: 'video', durationS: 34, trim: { fromS: 6, toS: 20 } })
    expect(ganz).toBe(34)
    expect(geschnitten).toBe(14)
    expect(videoFilmS(34, { fromS: 0, toS: 34 })).toBe(34) // Vollschnitt ändert nichts
  })

  it('lässt einen Foto-Halt unberührt — dort gibt es nichts zu schneiden', () => {
    expect(mediumHoldS({ type: 'photo', trim: { fromS: 2, toS: 3 } })).toBe(STOP_ENGINE_S)
  })
})

describe('videoStandS: der Klip ist länger als das Material', () => {
  it('klemmt am Materialende statt über die Dauer hinaus zu zielen', () => {
    // Mitten im Video: unverändert die Kopfposition
    expect(videoPositionS(0, 34, 12).targetS).toBeCloseTo(12, 6)
    expect(videoPositionS(0, 34, 12).atEnd).toBe(false)
    // In der Ausblendung (Klip = 34 + HALT_AUSBLEND_S): das Material ist zu Ende
    const inDerAusblendung = videoPositionS(0, 34, 34 + STOP_FADE_OUT_S)
    expect(inDerAusblendung.targetS).toBeLessThan(34)
    expect(inDerAusblendung.targetS).toBeCloseTo(33.96, 6)
    expect(inDerAusblendung.atEnd).toBe(true)
  })

  it('rechnet den Schnitt mit: das Ende ist bisS, nicht das Dateiende', () => {
    // Ausschnitt 6–20 s einer 34-s-Datei → der Klip ist 14 s lang
    expect(videoPositionS(6, 20, 0).targetS).toBeCloseTo(6, 6)
    expect(videoPositionS(6, 20, 13).targetS).toBeCloseTo(19, 6)
    expect(videoPositionS(6, 20, 14).atEnd).toBe(true)
    expect(videoPositionS(6, 20, 14).targetS).toBeCloseTo(19.96, 6)
  })

  it('bleibt im Material, wenn der Klip kürzer ist als das Video', () => {
    // Ohne bekannte `dauerS` ist der Klip die Foto-Standzeit lang
    expect(videoPositionS(0, 34, STOP_ENGINE_S).atEnd).toBe(false)
  })
})

describe('resolveSelection: Ton-Spanne kommt aus der FILM-Achse (Etappe 4)', () => {
  const AUDIO_EDITS = {
    schema: 'maptale/edits@2' as const,
    audio: [
      // Aufgewertet: anker/versatz/dauer gelten, `ab`/`bis` sind nur noch Fallback
      {
        file: 'a.mp3',
        type: 'music' as const,
        from: iso(60),
        to: iso(300),
        anchor: iso(600),
        offsetFilmS: 0,
        durationFilmS: 12,
      },
    ],
  }
  const track = [
    [7.9, 46.6, 800, 0],
    [7.91, 46.6, 800, 600],
    [7.92, 46.6, 800, 1200],
  ] as TrackPoint[]
  const abschnitte = [{ mode: 'walk' as const, active: true, pts: track }]

  it('nimmt die gelieferte Spanne, nicht ab/bis', () => {
    const info = resolveSelection(
      { kind: 'audio', index: 0 },
      AUDIO_EDITS,
      abschnitte,
      track,
      START,
      [],
      () => ({
        fromS: 600,
        toS: 660,
      }),
    )
    expect(info?.fromS).toBe(600)
    expect(info?.toS).toBe(660)
  })

  it('fällt ohne Achse auf ab/bis zurück — Bestandsdaten bleiben lesbar', () => {
    const info = resolveSelection(
      { kind: 'audio', index: 0 },
      AUDIO_EDITS,
      abschnitte,
      track,
      START,
      [],
    )
    expect(info?.fromS).toBe(60)
    expect(info?.toS).toBe(300)
  })
})
