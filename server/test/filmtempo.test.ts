// Drift-Wächter: Das Tempo-Modell des Servers ist eine KOPIE des Web-Modells
// (src/filmachse.ts). Sie ist erzwungen und bleibt es — `server/tsconfig.json`
// hat `rootDir: "."`, ein Import aus `../../src/` fiele heraus. Läuft die Kopie
// auseinander, bemisst die Pipeline Rampen und Ton-Anker nach einem Tempo, das
// der Player gar nicht fährt.
//
// Geprüft wird seit Paket D gegen ein VERHALTENS-FIXTURE
// (test/fixtures/filmachse.json), nicht mehr gegen den Quelltext von
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
import { baueFilmAchse, filmBeiZeit, zeitBeiFilm } from '../src/pipeline/filmachse.js'
import {
  BASIS_TEMPO_MS,
  HALT_AUSBLEND_S,
  HALT_ENGINE_S,
  MODUS_TEMPO,
  MOMENT_DEFAULT_S,
  NAHE_M,
  aufnahmeHaltS,
  filmsekunden,
  meterFuerFilmsekunden,
  momentHaltS,
  tempoMs,
} from '../src/pipeline/filmtempo.js'
import { baueZeitreihe } from '../src/pipeline/zeit.js'
import { MOMENT_ARTEN } from '../src/schema/edits.js'
import { MODI, type Modus } from '../src/schema/upload.js'

interface Fall {
  name: string
  abschnitte: Array<{ abM: number; mode: string }>
  gesamtM: number
  halte: Array<{ meterM: number; breiteS: number }>
  rampeM: number
  gesamtS: number
  filmBeiStrecke: Array<[number, number]>
  streckeBeiFilm: Array<[number, number]>
}
interface Fixture {
  tempoMs: Record<string, number>
  standzeit: { fotoS: number; ausblendS: number; momentS: Record<string, number> }
  haltAbstandM: number
  faelle: Fall[]
}

const fixture: Fixture = JSON.parse(
  readFileSync(new URL('../../test/fixtures/filmachse.json', import.meta.url), 'utf8'),
) as Fixture

/**
 * Einen Fixture-Fall als Aufzeichnung nachstellen: am Äquator nach Osten, 1 m/s.
 * Dort ist `meterZwischen` exakt `Δlng · 111 320` — die Meterwerte des Fixtures
 * kommen also unverfälscht in der Achse an.
 */
function alsZeitreihe(fall: Fall) {
  const grad = (m: number) => m / 111_320
  const segmente = fall.abschnitte.map((a, i) => {
    const bisM = fall.abschnitte[i + 1]?.abM ?? fall.gesamtM
    return {
      mode: a.mode as Modus,
      pts: [
        [grad(a.abM), 0, 0, a.abM],
        [grad(bisM), 0, 0, bisM],
      ] as Array<[number, number, number, number]>,
    }
  })
  return baueZeitreihe(segmente)
}

describe('Filmtempo', () => {
  it('kennt genau die Modi des Austauschformats', () => {
    expect(Object.keys(MODUS_TEMPO).slice().sort()).toEqual([...MODI].slice().sort())
  })

  it('fährt jeden Modus im festgelegten Film-Tempo (Fixture)', () => {
    for (const [mode, erwartet] of Object.entries(fixture.tempoMs)) {
      expect(tempoMs(mode as Modus), `Tempo für ${mode}`).toBeCloseTo(erwartet, 9)
    }
    // Basistempo und Faktoren einzeln — sonst könnten sich zwei Fehler
    // gegenseitig aufheben und das Produkt bliebe richtig.
    expect(BASIS_TEMPO_MS).toBe(120)
    expect(Object.keys(MODUS_TEMPO).slice().sort()).toEqual(Object.keys(fixture.tempoMs).slice().sort())
  })

  it('bemisst Standzeiten wie festgelegt (Fixture)', () => {
    // Sie bemessen, wie viel FILMzeit eine Aufnahme kostet — die Grundlage der
    // Film-Achse, über die die Ton-Anker übersetzt werden.
    expect(HALT_ENGINE_S).toBe(fixture.standzeit.fotoS)
    expect(HALT_AUSBLEND_S).toBe(fixture.standzeit.ausblendS)
    expect(MOMENT_DEFAULT_S).toEqual(fixture.standzeit.momentS)
    // Wer Aufnahmen anders gruppiert als der Player, webt die Halte an andere
    // Stellen der Achse — und ein Ton-Klip landete neben seinem Anker.
    expect(NAHE_M).toBe(fixture.haltAbstandM)
  })

  it.each(fixture.faelle)('rechnet den Fixture-Fall „$name" wie die Web-Achse', (fall) => {
    const achse = baueFilmAchse(
      alsZeitreihe(fall),
      fall.halte.map((h) => ({ offsetS: h.meterM, breiteS: h.breiteS })),
      fall.rampeM,
    )
    expect(achse).not.toBeNull()
    expect(achse?.gesamtS).toBeCloseTo(fall.gesamtS, 4)
    for (const [meterM, filmS] of fall.filmBeiStrecke) {
      expect(filmBeiZeit(achse!, meterM), `Film bei ${meterM} m`).toBeCloseTo(filmS, 4)
    }
    for (const [filmS, meterM] of fall.streckeBeiFilm) {
      expect(zeitBeiFilm(achse!, filmS), `Strecke bei ${filmS} s`).toBeCloseTo(meterM, 4)
    }
  })

  it('kennt genau die Moment-Arten des Overlay-Schemas', () => {
    expect(Object.keys(MOMENT_DEFAULT_S).slice().sort()).toEqual([...MOMENT_ARTEN].slice().sort())
  })

  it('bemisst einen Moment OHNE Ausblendung — anders als eine Aufnahme', () => {
    // Die Engine geht nach `momentDauer` direkt zurück auf `ride`; es gibt kein
    // HOLD_AUSBLEND-Nachspiel wie am Foto-Halt. Spiegel von `momentDauerS` in
    // src/studio/editor.ts.
    expect(momentHaltS({ art: 'umkreisen' })).toBe(6)
    expect(momentHaltS({ art: 'innehalten' })).toBe(4)
    expect(momentHaltS({ art: 'aufstieg', dauerS: 12 })).toBe(12)
    expect(momentHaltS({ art: 'aufstieg' })).not.toBe(MOMENT_DEFAULT_S.aufstieg + HALT_AUSBLEND_S)
  })

  it('bemisst eine Aufnahme wie die Engine: Video mit seiner Länge, Foto mit der Standzeit', () => {
    expect(aufnahmeHaltS({ type: 'photo' })).toBe(HALT_ENGINE_S)
    expect(aufnahmeHaltS({ type: 'photo', display: { holdS: 9 } })).toBe(9)
    expect(aufnahmeHaltS({ type: 'video', dauerS: 34.2 })).toBe(34.2)
    // `display.holdS` ist bei Video wirkungslos — der Player läuft bis zum Ende
    expect(aufnahmeHaltS({ type: 'video', dauerS: 34.2, display: { holdS: 9 } })).toBe(34.2)
    // Länge unbekannt (unverarbeiteter Altbestand): Foto-Annahme, nichts bricht
    expect(aufnahmeHaltS({ type: 'video' })).toBe(HALT_ENGINE_S)
  })

  it('rechnet Strecke und Filmdauer ineinander um', () => {
    expect(tempoMs('walk')).toBe(48)
    expect(tempoMs('ferry')).toBe(300)
    // Zu Fuß dauern 240 m fünf Filmsekunden — auf der Fähre keine Sekunde
    expect(filmsekunden(240, 'walk')).toBe(5)
    expect(meterFuerFilmsekunden(5, 'walk')).toBe(240)
    expect(filmsekunden(meterFuerFilmsekunden(3, 'tram'), 'tram')).toBeCloseTo(3, 9)
  })
})
