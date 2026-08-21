// Drift-Wächter: Das Tempo-Modell des Servers ist eine KOPIE des Web-Modells
// (src/film-axis.ts). Sie ist erzwungen und bleibt es — `server/tsconfig.json`
// hat `rootDir: "."`, ein Import aus `../../src/` fiele heraus. Läuft die Kopie
// auseinander, bemisst die Pipeline Rampen und Ton-Anker nach einem Tempo, das
// der Player gar nicht fährt.
//
// Geprüft wird seit Paket D gegen ein VERHALTENS-FIXTURE
// (test/fixtures/film-axis.json), nicht mehr gegen den Quelltext von
// src/tour.ts. Die Regex-Wächter davor hingen an Schreibweisen: Sie prüften,
// ob `const MODE_SPEED = {` dasteht — und einer, ob ein KOMMENTAR dasteht. Eine
// Umbenennung ließ sie still durchlaufen, eine Formatierung ließ sie grundlos
// fallen. Die Web-Hälfte desselben Fixtures steht in test/filmachse.test.ts.
//
// Die Fälle fahren mit 1 m/s: Aufnahmesekunde und Streckenmeter sind dieselbe
// Zahl, und die zeitparametrisierte Server-Achse lässt sich damit gegen
// dieselben Erwartungen prüfen wie die strecken-parametrisierte des Webs.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  buildFilmAxis,
  filmTimeAtRecordingTime,
  recordingTimeAtFilmTime,
} from '../src/pipeline/film-axis.js'
import {
  BASE_TEMPO_MS,
  STOP_FADE_OUT_S,
  STOP_ENGINE_S,
  TRAVEL_MODE_TEMPO,
  MOMENT_DEFAULT_S,
  NEAR_M,
  mediumHoldS,
  filmSeconds,
  metersForFilmSeconds,
  momentHoldS,
  tempoMs,
} from '../src/pipeline/film-tempo.js'
import { buildTimeSeries } from '../src/pipeline/time.js'
import { CAMERA_MOMENT_KINDS } from '../src/schema/edits.js'
import { TRAVEL_MODES, type TravelMode } from '../src/schema/upload.js'

interface Case {
  name: string
  segments: Array<{ fromM: number; mode: string }>
  totalM: number
  stops: Array<{ meterM: number; breiteS: number }>
  rampM: number
  totalS: number
  filmTimeAtDistance: Array<[number, number]>
  distanceAtFilmTime: Array<[number, number]>
}
interface Fixture {
  tempoMs: Record<string, number>
  hold: { photoS: number; fadeOutS: number; momentS: Record<string, number> }
  stopSpacingM: number
  cases: Case[]
}

const fixture: Fixture = JSON.parse(
  readFileSync(new URL('../../test/fixtures/film-axis.json', import.meta.url), 'utf8'),
) as Fixture

/**
 * Einen Fixture-Fall als Aufzeichnung nachstellen: am Äquator nach Osten, 1 m/s.
 * Dort ist `meterZwischen` exakt `Δlng · 111 320` — die Meterwerte des Fixtures
 * kommen also unverfälscht in der Achse an.
 */
function alsZeitreihe(fall: Case) {
  const grad = (m: number) => m / 111_320
  const segmente = fall.segments.map((a, i) => {
    const bisM = fall.segments[i + 1]?.fromM ?? fall.totalM
    return {
      mode: a.mode as TravelMode,
      pts: [
        [grad(a.fromM), 0, 0, a.fromM],
        [grad(bisM), 0, 0, bisM],
      ] as Array<[number, number, number, number]>,
    }
  })
  return buildTimeSeries(segmente)
}

describe('Filmtempo', () => {
  it('kennt genau die Modi des Austauschformats', () => {
    expect(Object.keys(TRAVEL_MODE_TEMPO).slice().sort()).toEqual([...TRAVEL_MODES].slice().sort())
  })

  it('fährt jeden Modus im festgelegten Film-Tempo (Fixture)', () => {
    for (const [mode, erwartet] of Object.entries(fixture.tempoMs)) {
      expect(tempoMs(mode as TravelMode), `Tempo für ${mode}`).toBeCloseTo(erwartet, 9)
    }
    // Basistempo und Faktoren einzeln — sonst könnten sich zwei Fehler
    // gegenseitig aufheben und das Produkt bliebe richtig.
    expect(BASE_TEMPO_MS).toBe(120)
    expect(Object.keys(TRAVEL_MODE_TEMPO).slice().sort()).toEqual(
      Object.keys(fixture.tempoMs).slice().sort(),
    )
  })

  it('bemisst Standzeiten wie festgelegt (Fixture)', () => {
    // Sie bemessen, wie viel FILMzeit eine Aufnahme kostet — die Grundlage der
    // Film-Achse, über die die Ton-Anker übersetzt werden.
    expect(STOP_ENGINE_S).toBe(fixture.hold.photoS)
    expect(STOP_FADE_OUT_S).toBe(fixture.hold.fadeOutS)
    expect(MOMENT_DEFAULT_S).toEqual(fixture.hold.momentS)
    // Wer Aufnahmen anders gruppiert als der Player, webt die Halte an andere
    // Stellen der Achse — und ein Ton-Klip landete neben seinem Anker.
    expect(NEAR_M).toBe(fixture.stopSpacingM)
  })

  it.each(fixture.cases)('rechnet den Fixture-Fall „$name" wie die Web-Achse', (fall) => {
    const achse = buildFilmAxis(
      alsZeitreihe(fall),
      fall.stops.map((h) => ({ offsetS: h.meterM, breiteS: h.breiteS })),
      fall.rampM,
    )
    expect(achse).not.toBeNull()
    expect(achse?.totalS).toBeCloseTo(fall.totalS, 4)
    for (const [meterM, filmS] of fall.filmTimeAtDistance) {
      expect(filmTimeAtRecordingTime(achse!, meterM), `Film bei ${meterM} m`).toBeCloseTo(filmS, 4)
    }
    for (const [filmS, meterM] of fall.distanceAtFilmTime) {
      expect(recordingTimeAtFilmTime(achse!, filmS), `Strecke bei ${filmS} s`).toBeCloseTo(
        meterM,
        4,
      )
    }
  })

  it('kennt genau die Moment-Arten des Overlay-Schemas', () => {
    expect(Object.keys(MOMENT_DEFAULT_S).slice().sort()).toEqual(
      [...CAMERA_MOMENT_KINDS].slice().sort(),
    )
  })

  it('bemisst einen Moment OHNE Ausblendung — anders als eine Aufnahme', () => {
    // Die Engine geht nach `momentDauer` direkt zurück auf `ride`; es gibt kein
    // HOLD_AUSBLEND-Nachspiel wie am Foto-Halt. Spiegel von `momentDurationS` in
    // src/studio/editor.ts.
    expect(momentHoldS({ art: 'orbit' })).toBe(6)
    expect(momentHoldS({ art: 'linger' })).toBe(4)
    expect(momentHoldS({ art: 'ascend', dauerS: 12 })).toBe(12)
    expect(momentHoldS({ art: 'ascend' })).not.toBe(MOMENT_DEFAULT_S.ascend + STOP_FADE_OUT_S)
  })

  it('bemisst eine Aufnahme wie die Engine: Video mit seiner Länge, Foto mit der Standzeit', () => {
    expect(mediumHoldS({ type: 'photo' })).toBe(STOP_ENGINE_S)
    expect(mediumHoldS({ type: 'photo', display: { holdS: 9 } })).toBe(9)
    expect(mediumHoldS({ type: 'video', dauerS: 34.2 })).toBe(34.2)
    // `display.holdS` ist bei Video wirkungslos — der Player läuft bis zum Ende
    expect(mediumHoldS({ type: 'video', dauerS: 34.2, display: { holdS: 9 } })).toBe(34.2)
    // Länge unbekannt (unverarbeiteter Altbestand): Foto-Annahme, nichts bricht
    expect(mediumHoldS({ type: 'video' })).toBe(STOP_ENGINE_S)
  })

  it('rechnet Strecke und Filmdauer ineinander um', () => {
    expect(tempoMs('walk')).toBe(60)
    expect(tempoMs('ferry')).toBe(300)
    // Zu Fuß dauern 240 m vier Filmsekunden — auf der Fähre keine Sekunde
    expect(filmSeconds(240, 'walk')).toBe(4)
    expect(metersForFilmSeconds(4, 'walk')).toBe(240)
    expect(filmSeconds(metersForFilmSeconds(3, 'tram'), 'tram')).toBeCloseTo(3, 9)
  })
})
