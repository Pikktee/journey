// Die geteilte Filmachse (Konzept E3/E12) — und die Web-Hälfte des
// Verhaltens-Fixtures, das sie mit dem Server-Spiegel zusammenhält.
//
// Der Server rechnet dieselben Fälle in server/test/filmtempo.test.ts durch.
// Was hier NICHT mehr steht: ein Wächter, der den Quelltext von src/tour.ts
// nach `MODE_SPEED` absucht — die Tabelle IST jetzt diese Datei, tour.ts liest
// sie.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { HOLD_FADE_OUT_S, HOLD_HIDE, holdS } from '../src/card-timing'
import {
  MOMENT_DEFAULT_S,
  RAMP_M,
  buildFilmAxis,
  filmTimeAtDistance,
  stopAtFilmTime,
  interpolate,
  momentHoldS,
  distanceAtFilmTime,
  tempoMs,
} from '../src/film-axis'
import { NEAR_M } from '../src/geo'
import { musicOffsetS } from '../src/audiotracks'
import { sinceClipStartS } from '../src/studio/playback'
import {
  buildTimelineAxis,
  buildPlaybackCurve,
  filmAt,
  filmToFraction,
} from '../src/studio/timeline'
import type { TrackPoint } from '../src/studio/edit-model'

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
  readFileSync(new URL('./fixtures/film-axis.json', import.meta.url), 'utf8'),
) as Fixture

describe('Verhaltens-Fixture (Web-Seite)', () => {
  it('fährt jeden Modus im festgelegten Film-Tempo', () => {
    for (const [mode, erwartet] of Object.entries(fixture.tempoMs)) {
      expect(tempoMs(mode), `Tempo für ${mode}`).toBeCloseTo(erwartet, 9)
    }
  })

  it('kennt genau die Modi des Fixtures — keinen mehr, keinen weniger', () => {
    // Ein hier fehlender Modus fiele sonst still auf den Faktor 1 zurück: Der
    // Player führe ihn mit Radtempo, ohne dass etwas kaputt aussieht.
    expect(Object.keys(fixture.tempoMs).slice().sort()).toEqual(
      Object.keys({ walk: 0, moped: 0, bike: 0, jeep: 0, tram: 0, ferry: 0 }).sort(),
    )
  })

  it('bemisst Standzeiten wie festgelegt', () => {
    expect(HOLD_HIDE).toBe(fixture.hold.photoS)
    expect(HOLD_FADE_OUT_S).toBe(fixture.hold.fadeOutS)
    expect(MOMENT_DEFAULT_S).toEqual(fixture.hold.momentS)
    expect(NEAR_M).toBe(fixture.stopSpacingM)
  })

  it.each(fixture.cases)('$name', (fall) => {
    const achse = buildFilmAxis(fall.segments, fall.totalM, fall.stops, { rampM: fall.rampM })
    expect(achse.totalS).toBeCloseTo(fall.totalS, 6)
    for (const [meterM, filmS] of fall.filmTimeAtDistance) {
      expect(filmTimeAtDistance(achse, meterM), `Film bei ${meterM} m`).toBeCloseTo(filmS, 6)
    }
    for (const [filmS, meterM] of fall.distanceAtFilmTime) {
      expect(distanceAtFilmTime(achse, filmS), `Strecke bei ${filmS} s`).toBeCloseTo(meterM, 6)
    }
  })
})

describe('Filmachse', () => {
  // Diese Fälle prüfen das Weben der HALTE und rechnen deshalb ohne Rampe
  // (`rampM: 0`) — sonst stünde in jeder Erwartung noch ein Rampen-Zuschlag,
  // und der Test sagte nicht mehr, worüber er redet. Die Rampe selbst hat ihre
  // eigenen Fälle im Fixture.
  const walk960 = () =>
    buildFilmAxis([{ fromM: 0, mode: 'walk' }], 960, [{ meterM: 480, breiteS: 6 }], { rampM: 0 })
  /** Filmsekunden für 480 m zu Fuß — aus der Tabelle, nicht als Zahl im Test. */
  const halbeStrecke = 480 / tempoMs('walk')

  it('gibt einem Halt seine Filmsekunden — die Strecke hat dort keine Ausdehnung', () => {
    const achse = walk960()
    expect(achse.stops).toHaveLength(1)
    expect(achse.stops[0]?.filmVon).toBeCloseTo(halbeStrecke, 6)
    expect(achse.stops[0]?.filmBis).toBeCloseTo(halbeStrecke + 6, 6)
    // Genau das kann die reine Strecke NICHT: drei Filmsekunden, ein Meterwert.
    const drin = [0.5, 2, 5].map((f) => distanceAtFilmTime(achse, halbeStrecke + f))
    expect(new Set(drin).size).toBe(1)
  })

  it('sagt, ob eine Filmsekunde in einem Halt steht — Ankunft ja, Abfahrt nein', () => {
    const achse = walk960()
    expect(stopAtFilmTime(achse, halbeStrecke - 0.1)).toBeNull()
    expect(stopAtFilmTime(achse, halbeStrecke)?.breiteS).toBe(6)
    expect(stopAtFilmTime(achse, halbeStrecke + 5.9)?.breiteS).toBe(6)
    expect(stopAtFilmTime(achse, halbeStrecke + 6)).toBeNull() // dort läuft die Fahrt schon wieder
  })

  it('überspringt Halte ohne Breite, statt sie als Stufe einzuweben', () => {
    const achse = buildFilmAxis([{ fromM: 0, mode: 'walk' }], 960, [{ meterM: 480, breiteS: 0 }], {
      rampM: 0,
    })
    expect(achse.stops).toEqual([])
    expect(achse.totalS).toBeCloseTo(2 * halbeStrecke, 6)
  })

  it('klemmt Halte außerhalb der Strecke auf ihre Enden', () => {
    // Ein Anker kann hinter dem Tour-Ende landen (Trim, Projektionsfehler). Die
    // Standzeit gehört dann ans Ende — nicht in eine Achse, die dort schon
    // vorbei ist.
    const achse = buildFilmAxis([{ fromM: 0, mode: 'walk' }], 960, [{ meterM: 5000, breiteS: 6 }], {
      rampM: 0,
    })
    expect(achse.totalS).toBeCloseTo(2 * halbeStrecke + 6, 6)
    expect(achse.stops[0]?.filmVon).toBeCloseTo(2 * halbeStrecke, 6)
  })

  it('hält die lower_bound-Konvention „Plateau → Ankunft"', () => {
    // Sie wechselt mit E12 nur ihren Ort: Über der Aufnahmezeit waren die
    // Plateaus die realen Pausen, über der Strecke sind es die Halte. Kippte
    // sie auf „rechts", spränge jeder Anker auf einer Halt-Position um die
    // ganze Standzeit.
    expect(interpolate([0, 5, 5, 9], [0, 1, 2, 3], 5)).toBe(1)
    expect(interpolate([0, 5, 5, 9], [0, 1, 2, 3], 5.0001)).toBeCloseTo(2, 3)
  })

  it('rechnet einen Moment ohne Ausblendung, eine Aufnahme mit', () => {
    // Die Engine geht nach `momentDauer` direkt zurück in die Fahrt (tour.ts);
    // ein Foto-Halt hat sein Nachspiel.
    expect(momentHoldS({ kind: 'orbit' })).toBe(6)
    expect(momentHoldS({ kind: 'ascend', durationS: 12 })).toBe(12)
    expect(momentHoldS({ kind: 'unbekannt' })).toBe(5)
    expect(holdS({ type: 'photo' })).toBe(HOLD_HIDE)
    expect(holdS({ type: 'photo', display: { holdS: 9 } })).toBe(9)
    expect(holdS({ type: 'video', durationS: 34.2 })).toBe(34.2)
    // `display.holdS` ist bei Video wirkungslos — der Player läuft bis zum Ende
    expect(holdS({ type: 'video', durationS: 34.2, display: { holdS: 9 } })).toBe(34.2)
    // Länge unbekannt: dieselbe Foto-Annahme wie im Editor (Konzept, Falle 4)
    expect(holdS({ type: 'video' })).toBe(HOLD_HIDE)
  })

  it('bleibt brauchbar, wo es nichts abzubilden gibt', () => {
    const leer = buildFilmAxis([], 0, [])
    expect(leer.totalS).toBe(0)
    expect(filmTimeAtDistance(leer, 100)).toBe(0)
    expect(distanceAtFilmTime(leer, 100)).toBe(0)
  })
})

// — Player und Editor gegen DIESELBE Filmsekunde —
//
// Das „Fertig, wenn" der Etappe: Ein Sprung mitten in ein Musikstück setzt den
// Ton dort fort, wo der Film steht — auf beiden Bühnen gleich. Der Player
// rechnet über die Strecken-Achse, der Editor über seine Spielkurve; ab
// `musikVersatzS` ist es dieselbe Funktion (src/audiotracks.ts).

describe('Gleichlauf: Ton am selben Punkt', () => {
  const METER = 960
  const HALT_M = 480
  const HALT_S = 6
  /** Aufzeichnung am Äquator, 1 m/s — Sekunde und Meter sind dieselbe Zahl. */
  const track: TrackPoint[] = Array.from({ length: METER / 60 + 1 }, (_, i) => [
    (i * 60) / 111_320,
    0,
    0,
    i * 60,
  ])

  /** Die Achse des PLAYERS (main.ts baut sie genauso). */
  const spieler = buildFilmAxis([{ fromM: 0, mode: 'walk' }], METER, [
    { meterM: HALT_M, breiteS: HALT_S },
  ])
  /** Die Achse des EDITORS samt Spielkurve (timeline.ts). */
  const editor = buildTimelineAxis(
    [{ mode: 'walk', active: true, pts: track }],
    [{ offsetS: HALT_M, breiteS: HALT_S }],
    {
      fromS: 0,
      toS: METER,
    },
  )
  const spielkurve = buildPlaybackCurve(editor, [{ active: true, pts: track }])

  it('misst dieselbe Filmdauer — Rampen inklusive', () => {
    // DREI Rampen: aus dem Stand los, vor dem Halt bremsen, danach wieder
    // anfahren. Am Tour-ENDE wird nicht gebremst — der Film läuft dort aus, wie
    // er es heute tut. Jede Rampe kostet eine Reisezeit ihrer Strecke (E14).
    expect(spieler.totalS).toBeCloseTo(
      METER / tempoMs('walk') + HALT_S + (3 * RAMP_M) / tempoMs('walk'),
      6,
    )
    expect(editor.curve?.totalS).toBeCloseTo(spieler.totalS, 6)
  })

  it.each([0, 240, 480, 600, 960])(
    'setzt den Ton bei %i m an derselben Stelle der Datei ein',
    (meter) => {
      const imPlayer = filmTimeAtDistance(spieler, meter)
      const imEditor = filmAt(spielkurve, filmToFraction(editor, imPlayer))
      expect(imEditor).toBeCloseTo(imPlayer, 6)
      // Ein Musikstück ab Filmsekunde 0, Datei 30 s, Loop — beide Bühnen greifen
      // auf dieselbe Datei-Position zu.
      expect(musicOffsetS(imPlayer, 30)).toBeCloseTo(
        musicOffsetS(sinceClipStartS(filmToFraction(editor, imEditor), 0, spielkurve), 30),
        6,
      )
    },
  )

  it('hält im HALT die Filmzeit auseinander, obwohl die Strecke steht', () => {
    // Der eigentliche Gewinn: Mitten im Halt gibt es keine Streckenposition, die
    // sich unterscheidet — die Filmsekunde und damit die Stelle in der Datei
    // sehr wohl. Vorher setzte der Player hier hart auf den Dateianfang.
    // Ankunft: 480 m Reise plus die zwei Rampen davor (je RAMPE_M zu Fuß).
    const ankunft = filmTimeAtDistance(spieler, HALT_M)
    expect(ankunft).toBeCloseTo((HALT_M + 2 * RAMP_M) / tempoMs('walk'), 6)
    expect(musicOffsetS(ankunft, 30)).toBeCloseTo(ankunft, 6)
    expect(musicOffsetS(ankunft + 3, 30)).toBeCloseTo(ankunft + 3, 6)
    expect(distanceAtFilmTime(spieler, ankunft)).toBeCloseTo(
      distanceAtFilmTime(spieler, ankunft + 3),
      6,
    )
  })
})
