// Die geteilte Filmachse (Konzept E3/E12) — und die Web-Hälfte des
// Verhaltens-Fixtures, das sie mit dem Server-Spiegel zusammenhält.
//
// Der Server rechnet dieselben Fälle in server/test/filmtempo.test.ts durch.
// Was hier NICHT mehr steht: ein Wächter, der den Quelltext von src/tour.ts
// nach `MODE_SPEED` absucht — die Tabelle IST jetzt diese Datei, tour.ts liest
// sie.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { HOLD_AUSBLEND, HOLD_HIDE, standzeitS } from '../src/einblendung'
import {
  MOMENT_DEFAULT_S,
  RAMPE_M,
  baueFilmachse,
  filmBeiStrecke,
  haltBeiFilm,
  interpoliere,
  momentHaltS,
  streckeBeiFilm,
  tempoMs,
} from '../src/filmachse'
import { NAHE_M } from '../src/geo'
import { musikVersatzS } from '../src/audiotracks'
import { seitKlipbeginnS } from '../src/studio/abspielen'
import {
  buildTimelineAxis,
  buildPlaybackCurve,
  filmAt,
  filmToFraction,
} from '../src/studio/zeitleiste'
import type { TrackPoint } from '../src/studio/editmodell'

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
  readFileSync(new URL('./fixtures/filmachse.json', import.meta.url), 'utf8'),
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
    expect(HOLD_HIDE).toBe(fixture.standzeit.fotoS)
    expect(HOLD_AUSBLEND).toBe(fixture.standzeit.ausblendS)
    expect(MOMENT_DEFAULT_S).toEqual(fixture.standzeit.momentS)
    expect(NAHE_M).toBe(fixture.haltAbstandM)
  })

  it.each(fixture.faelle)('$name', (fall) => {
    const achse = baueFilmachse(fall.abschnitte, fall.gesamtM, fall.halte, { rampeM: fall.rampeM })
    expect(achse.gesamtS).toBeCloseTo(fall.gesamtS, 6)
    for (const [meterM, filmS] of fall.filmBeiStrecke) {
      expect(filmBeiStrecke(achse, meterM), `Film bei ${meterM} m`).toBeCloseTo(filmS, 6)
    }
    for (const [filmS, meterM] of fall.streckeBeiFilm) {
      expect(streckeBeiFilm(achse, filmS), `Strecke bei ${filmS} s`).toBeCloseTo(meterM, 6)
    }
  })
})

describe('Filmachse', () => {
  // Diese Fälle prüfen das Weben der HALTE und rechnen deshalb ohne Rampe
  // (`rampeM: 0`) — sonst stünde in jeder Erwartung noch ein Rampen-Zuschlag,
  // und der Test sagte nicht mehr, worüber er redet. Die Rampe selbst hat ihre
  // eigenen Fälle im Fixture.
  const walk960 = () =>
    baueFilmachse([{ abM: 0, mode: 'walk' }], 960, [{ meterM: 480, breiteS: 6 }], { rampeM: 0 })
  /** Filmsekunden für 480 m zu Fuß — aus der Tabelle, nicht als Zahl im Test. */
  const halbeStrecke = 480 / tempoMs('walk')

  it('gibt einem Halt seine Filmsekunden — die Strecke hat dort keine Ausdehnung', () => {
    const achse = walk960()
    expect(achse.halte).toHaveLength(1)
    expect(achse.halte[0]?.filmVon).toBeCloseTo(halbeStrecke, 6)
    expect(achse.halte[0]?.filmBis).toBeCloseTo(halbeStrecke + 6, 6)
    // Genau das kann die reine Strecke NICHT: drei Filmsekunden, ein Meterwert.
    const drin = [0.5, 2, 5].map((f) => streckeBeiFilm(achse, halbeStrecke + f))
    expect(new Set(drin).size).toBe(1)
  })

  it('sagt, ob eine Filmsekunde in einem Halt steht — Ankunft ja, Abfahrt nein', () => {
    const achse = walk960()
    expect(haltBeiFilm(achse, halbeStrecke - 0.1)).toBeNull()
    expect(haltBeiFilm(achse, halbeStrecke)?.breiteS).toBe(6)
    expect(haltBeiFilm(achse, halbeStrecke + 5.9)?.breiteS).toBe(6)
    expect(haltBeiFilm(achse, halbeStrecke + 6)).toBeNull() // dort läuft die Fahrt schon wieder
  })

  it('überspringt Halte ohne Breite, statt sie als Stufe einzuweben', () => {
    const achse = baueFilmachse([{ abM: 0, mode: 'walk' }], 960, [{ meterM: 480, breiteS: 0 }], {
      rampeM: 0,
    })
    expect(achse.halte).toEqual([])
    expect(achse.gesamtS).toBeCloseTo(2 * halbeStrecke, 6)
  })

  it('klemmt Halte außerhalb der Strecke auf ihre Enden', () => {
    // Ein Anker kann hinter dem Tour-Ende landen (Trim, Projektionsfehler). Die
    // Standzeit gehört dann ans Ende — nicht in eine Achse, die dort schon
    // vorbei ist.
    const achse = baueFilmachse([{ abM: 0, mode: 'walk' }], 960, [{ meterM: 5000, breiteS: 6 }], {
      rampeM: 0,
    })
    expect(achse.gesamtS).toBeCloseTo(2 * halbeStrecke + 6, 6)
    expect(achse.halte[0]?.filmVon).toBeCloseTo(2 * halbeStrecke, 6)
  })

  it('hält die lower_bound-Konvention „Plateau → Ankunft"', () => {
    // Sie wechselt mit E12 nur ihren Ort: Über der Aufnahmezeit waren die
    // Plateaus die realen Pausen, über der Strecke sind es die Halte. Kippte
    // sie auf „rechts", spränge jeder Anker auf einer Halt-Position um die
    // ganze Standzeit.
    expect(interpoliere([0, 5, 5, 9], [0, 1, 2, 3], 5)).toBe(1)
    expect(interpoliere([0, 5, 5, 9], [0, 1, 2, 3], 5.0001)).toBeCloseTo(2, 3)
  })

  it('rechnet einen Moment ohne Ausblendung, eine Aufnahme mit', () => {
    // Die Engine geht nach `momentDauer` direkt zurück in die Fahrt (tour.ts);
    // ein Foto-Halt hat sein Nachspiel.
    expect(momentHaltS({ art: 'orbit' })).toBe(6)
    expect(momentHaltS({ art: 'ascend', dauerS: 12 })).toBe(12)
    expect(momentHaltS({ art: 'unbekannt' })).toBe(5)
    expect(standzeitS({ type: 'photo' })).toBe(HOLD_HIDE)
    expect(standzeitS({ type: 'photo', display: { holdS: 9 } })).toBe(9)
    expect(standzeitS({ type: 'video', dauerS: 34.2 })).toBe(34.2)
    // `display.holdS` ist bei Video wirkungslos — der Player läuft bis zum Ende
    expect(standzeitS({ type: 'video', dauerS: 34.2, display: { holdS: 9 } })).toBe(34.2)
    // Länge unbekannt: dieselbe Foto-Annahme wie im Editor (Konzept, Falle 4)
    expect(standzeitS({ type: 'video' })).toBe(HOLD_HIDE)
  })

  it('bleibt brauchbar, wo es nichts abzubilden gibt', () => {
    const leer = baueFilmachse([], 0, [])
    expect(leer.gesamtS).toBe(0)
    expect(filmBeiStrecke(leer, 100)).toBe(0)
    expect(streckeBeiFilm(leer, 100)).toBe(0)
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
  const spieler = baueFilmachse([{ abM: 0, mode: 'walk' }], METER, [
    { meterM: HALT_M, breiteS: HALT_S },
  ])
  /** Die Achse des EDITORS samt Spielkurve (zeitleiste.ts). */
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
    expect(spieler.gesamtS).toBeCloseTo(
      METER / tempoMs('walk') + HALT_S + (3 * RAMPE_M) / tempoMs('walk'),
      6,
    )
    expect(editor.curve?.totalS).toBeCloseTo(spieler.gesamtS, 6)
  })

  it.each([0, 240, 480, 600, 960])(
    'setzt den Ton bei %i m an derselben Stelle der Datei ein',
    (meter) => {
      const imPlayer = filmBeiStrecke(spieler, meter)
      const imEditor = filmAt(spielkurve, filmToFraction(editor, imPlayer))
      expect(imEditor).toBeCloseTo(imPlayer, 6)
      // Ein Musikstück ab Filmsekunde 0, Datei 30 s, Loop — beide Bühnen greifen
      // auf dieselbe Datei-Position zu.
      expect(musikVersatzS(imPlayer, 30)).toBeCloseTo(
        musikVersatzS(seitKlipbeginnS(filmToFraction(editor, imEditor), 0, spielkurve), 30),
        6,
      )
    },
  )

  it('hält im HALT die Filmzeit auseinander, obwohl die Strecke steht', () => {
    // Der eigentliche Gewinn: Mitten im Halt gibt es keine Streckenposition, die
    // sich unterscheidet — die Filmsekunde und damit die Stelle in der Datei
    // sehr wohl. Vorher setzte der Player hier hart auf den Dateianfang.
    // Ankunft: 480 m Reise plus die zwei Rampen davor (je RAMPE_M zu Fuß).
    const ankunft = filmBeiStrecke(spieler, HALT_M)
    expect(ankunft).toBeCloseTo((HALT_M + 2 * RAMPE_M) / tempoMs('walk'), 6)
    expect(musikVersatzS(ankunft, 30)).toBeCloseTo(ankunft, 6)
    expect(musikVersatzS(ankunft + 3, 30)).toBeCloseTo(ankunft + 3, 6)
    expect(streckeBeiFilm(spieler, ankunft)).toBeCloseTo(streckeBeiFilm(spieler, ankunft + 3), 6)
  })
})
