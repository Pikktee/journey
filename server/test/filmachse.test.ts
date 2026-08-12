// Die Film-Achse der Pipeline (Etappe 4): Aufnahmezeit ↔ Filmsekunde.
//
// Sie ist der Server-Spiegel von `baueAchse` in src/studio/zeitleiste.ts. Beide
// müssen dasselbe rechnen — sonst startet ein Ton-Klip im fertigen Film
// woanders, als der Editor ihn gezeigt hat. Ein Drift-Wächter am Ende hält die
// Interpolations-Konvention gegen die Studio-Quelle.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  baueAchsenHalte,
  baueFilmAchse,
  baueMomentHalte,
  filmBeiZeit,
  projiziereAufReihe,
  zeitBeiFilm,
} from '../src/pipeline/filmachse.js'
import { HALT_AUSBLEND_S, HALT_ENGINE_S, MOMENT_DEFAULT_S } from '../src/pipeline/filmtempo.js'
import { baueZeitreihe } from '../src/pipeline/zeit.js'
import type { UploadSegment } from '../src/schema/upload.js'

/** Gerade Ost-Strecke: `meterProSchritt` je Punkt, ein Punkt je `sekProSchritt`. */
function geradeStrecke(
  punkte: number,
  meterProSchritt: number,
  sekProSchritt: number,
  mode: UploadSegment['mode'] = 'walk',
): UploadSegment {
  const gradProMeter = 1 / (111_320 * Math.cos((46.6 * Math.PI) / 180))
  return {
    mode,
    pts: Array.from({ length: punkte }, (_, i) => [
      7.9 + i * meterProSchritt * gradProMeter,
      46.6,
      800,
      i * sekProSchritt,
    ]),
  }
}

describe('baueFilmAchse', () => {
  it('rechnet Fahrzeit aus Strecke ÷ Modus-Tempo', () => {
    // Zu Fuß: 48 m/s Filmtempo. 10 Schritte à 96 m = 960 m → 20 Filmsekunden.
    const achse = baueFilmAchse(baueZeitreihe([geradeStrecke(11, 96, 60)]), [])
    expect(achse).not.toBeNull()
    expect(achse?.gesamtS).toBeCloseTo(20, 1)
    // Aufnahmezeit läuft 600 s, Filmzeit 20 s — die Achse ist kein Zeitmaß
    expect(filmBeiZeit(achse!, 300)).toBeCloseTo(10, 1)
  })

  it('webt einen Halt als Plateau ein: Film läuft, Aufnahmeuhr steht', () => {
    const reihe = baueZeitreihe([geradeStrecke(11, 96, 60)])
    const achse = baueFilmAchse(reihe, [{ offsetS: 300, breiteS: 6 }])!
    // Der Halt kostet 6 Filmsekunden, die Tour wird also um 6 s länger
    expect(achse.gesamtS).toBeCloseTo(26, 1)
    // Auf der Halt-Zeit steht die ANKUNFT (lower_bound-Konvention)
    expect(filmBeiZeit(achse, 300)).toBeCloseTo(10, 1)
    // Und mitten im Halt: dieselbe Aufnahmezeit, verschiedene Filmsekunden
    expect(zeitBeiFilm(achse, 10)).toBeCloseTo(300, 1)
    expect(zeitBeiFilm(achse, 13)).toBeCloseTo(300, 1)
    expect(zeitBeiFilm(achse, 16)).toBeCloseTo(300, 1)
    // Direkt dahinter läuft die Uhr weiter
    expect(zeitBeiFilm(achse, 17)).toBeGreaterThan(300)
  })

  it('genau das kann die reine Aufnahmezeit NICHT — deshalb gibt es sie', () => {
    // Der Kernbefund aus docs §1: In Aufnahmezeit hat „mitten im Halt" keinen
    // Wert. Über die Film-Achse hat es drei verschiedene.
    const reihe = baueZeitreihe([geradeStrecke(11, 96, 60)])
    const achse = baueFilmAchse(reihe, [{ offsetS: 300, breiteS: 6 }])!
    const drin = [10.5, 12, 15].map((f) => zeitBeiFilm(achse, f))
    expect(new Set(drin).size).toBe(1) // in Aufnahmezeit ununterscheidbar
    expect(new Set([10.5, 12, 15]).size).toBe(3) // im Film sehr wohl
  })

  it('gibt null zurück, wo es nichts abzubilden gibt', () => {
    expect(baueFilmAchse(baueZeitreihe([]), [])).toBeNull()
    expect(baueFilmAchse(baueZeitreihe([geradeStrecke(1, 96, 60)]), [])).toBeNull()
    // Punktförmige Tour: Zeit vergeht, aber keine Strecke → keine Filmzeit
    expect(baueFilmAchse(baueZeitreihe([geradeStrecke(5, 0, 60)]), [])).toBeNull()
  })

  it('schnellere Fortbewegung staucht die Achse', () => {
    const zuFuss = baueFilmAchse(baueZeitreihe([geradeStrecke(11, 96, 60, 'walk')]), [])!
    const faehre = baueFilmAchse(baueZeitreihe([geradeStrecke(11, 96, 60, 'ferry')]), [])!
    // ferry ist 2,5/0,4 = 6,25× so schnell wie walk
    expect(zuFuss.gesamtS / faehre.gesamtS).toBeCloseTo(6.25, 2)
  })
})

describe('baueAchsenHalte', () => {
  const foto = (meter: number, offsetS: number) => ({ type: 'photo' as const, meter, offsetS })

  it('fasst Aufnahmen unter 120 Streckenmetern zu EINEM Halt zusammen', () => {
    const halte = baueAchsenHalte([foto(0, 10), foto(50, 20), foto(119, 30), foto(400, 90)])
    expect(halte).toHaveLength(2)
    // Drei Aufnahmen = dreimal Standzeit samt Ausblendung
    expect(halte[0]?.breiteS).toBeCloseTo(3 * (HALT_ENGINE_S + HALT_AUSBLEND_S), 6)
    expect(halte[0]?.offsetS).toBeCloseTo(20, 6) // Mittel der Mitglieder
    expect(halte[1]?.breiteS).toBeCloseTo(HALT_ENGINE_S + HALT_AUSBLEND_S, 6)
  })

  it('misst zum ANFANG des Halts, nicht zum Vorgänger', () => {
    // Perlenkette: jeder Nachbar ist 100 m entfernt, der erste aber 300 m. Ohne
    // diese Regel verschmölze die ganze Kette zu einem beliebig langen Stopp.
    const halte = baueAchsenHalte([foto(0, 0), foto(100, 10), foto(200, 20), foto(300, 30)])
    expect(halte.map((h) => h.breiteS / (HALT_ENGINE_S + HALT_AUSBLEND_S))).toEqual([2, 2])
  })

  it('ein Video zählt mit seiner echten Länge', () => {
    const halte = baueAchsenHalte([{ type: 'video', meter: 0, offsetS: 5, dauerS: 34.2 }])
    expect(halte[0]?.breiteS).toBeCloseTo(34.2 + HALT_AUSBLEND_S, 6)
  })

  it('eine eigene Standzeit schlägt die Vorgabe', () => {
    const halte = baueAchsenHalte([{ type: 'photo', meter: 0, offsetS: 5, display: { holdS: 12 } }])
    expect(halte[0]?.breiteS).toBeCloseTo(12 + HALT_AUSBLEND_S, 6)
  })
})

describe('baueMomentHalte', () => {
  it('nimmt die Dauer der Art — ohne Ausblendung', () => {
    const halte = baueMomentHalte([
      { offsetS: 100, art: 'umkreisen' },
      { offsetS: 200, art: 'innehalten', dauerS: 9 },
    ])
    // Ein Moment endet in der Engine direkt in der Weiterfahrt; 0,8 s
    // Ausblendung wie am Foto-Halt gibt es dort nicht.
    expect(halte).toEqual([
      { offsetS: 100, breiteS: MOMENT_DEFAULT_S.umkreisen },
      { offsetS: 200, breiteS: 9 },
    ])
  })

  it('gruppiert NICHT: zwei dichte Momente sind zwei Halte', () => {
    // Anders als Aufnahmen (120-m-Kette): jeder Moment ist ein eigenes
    // Ereignis mit eigener Kamerabewegung.
    const halte = baueMomentHalte([
      { offsetS: 100, art: 'innehalten' },
      { offsetS: 101, art: 'innehalten' },
    ])
    expect(halte).toHaveLength(2)
  })

  it('verlängert die Achse und schiebt alles Spätere nach hinten', () => {
    // Der eigentliche Befund: Ohne den Moment-Halt löst der Render einen
    // Ton-Klip, der über anker + versatzFilmS DAHINTER liegt, gegen eine zu
    // kurze Achse auf — er landete im Film um die Momentdauer zu früh.
    const reihe = baueZeitreihe([geradeStrecke(11, 96, 60)])
    const ohne = baueFilmAchse(reihe, [])!
    const mit = baueFilmAchse(reihe, baueMomentHalte([{ offsetS: 300, art: 'umkreisen' }]))!
    expect(mit.gesamtS - ohne.gesamtS).toBeCloseTo(MOMENT_DEFAULT_S.umkreisen, 6)
    // Ein Anker VOR dem Moment liegt unverändert; 6 Filmsekunden nach ihm steht
    // die Aufnahmeuhr noch im Moment, statt schon weitergelaufen zu sein.
    expect(filmBeiZeit(mit, 120)).toBeCloseTo(filmBeiZeit(ohne, 120), 6)
    expect(zeitBeiFilm(mit, filmBeiZeit(mit, 300) + 3)).toBeCloseTo(300, 6)
    expect(zeitBeiFilm(ohne, filmBeiZeit(ohne, 300) + 3)).toBeGreaterThan(300)
  })

  it('reiht sich mit den Aufnahme-Halten in EINE Achse', () => {
    const reihe = baueZeitreihe([geradeStrecke(11, 96, 60)])
    const achse = baueFilmAchse(reihe, [
      ...baueAchsenHalte([{ type: 'photo', meter: 480, offsetS: 300 }]),
      ...baueMomentHalte([{ offsetS: 480, art: 'aufstieg' }]),
    ])!
    // 20 s Fahrt + Foto (Standzeit samt Ausblendung) + Moment (nur Dauer)
    expect(achse.gesamtS).toBeCloseTo(20 + HALT_ENGINE_S + HALT_AUSBLEND_S + MOMENT_DEFAULT_S.aufstieg, 6)
  })
})

describe('projiziereAufReihe', () => {
  it('trifft Punkte ZWISCHEN den Stützstellen', () => {
    // Auf grob abgetasteten Tracks liegen 60 s zwischen zwei Punkten — würde auf
    // den nächsten Stützpunkt gerundet, spränge ein Halt um eine halbe Minute.
    const reihe = baueZeitreihe([geradeStrecke(3, 1000, 60)])
    const mitte = reihe.punkte[1]!
    const gradProMeter = 1 / (111_320 * Math.cos((46.6 * Math.PI) / 180))
    const ort = projiziereAufReihe(reihe, 7.9 + 500 * gradProMeter, 46.6)
    expect(ort.offsetS).toBeCloseTo(30, 0)
    // Auf einen Meter genau: die Zeitreihe misst mit Haversine, die Projektion
    // mit lokaler Plattkarte — über 1 km sind das gut 0,5 m Unterschied.
    expect(Math.abs(ort.meter - 500)).toBeLessThan(2)
    expect(mitte.tSek).toBe(60) // die nächste Stützstelle wäre 60 gewesen
  })

  it('klemmt seitlich neben der Strecke auf den nächstgelegenen Punkt', () => {
    const reihe = baueZeitreihe([geradeStrecke(3, 1000, 60)])
    const ort = projiziereAufReihe(reihe, 7.9, 46.61) // 1,1 km nördlich vom Start
    expect(ort.offsetS).toBeCloseTo(0, 6)
  })
})

describe('Drift-Wächter gegen die Studio-Achse', () => {
  it('teilt die lower_bound-Konvention von src/studio/zeitleiste.ts', () => {
    // Die Studio-Interpolation liefert bei doppelten Stützstellen den LINKEN
    // Wert („Plateau → Ankunft"). Kippte eine der beiden Seiten auf rechts,
    // spränge jeder Anker, der auf einer Halt-Zeit sitzt, um die Standzeit.
    const quelle = readFileSync(new URL('../../src/studio/zeitleiste.ts', import.meta.url), 'utf8')
    expect(quelle).toMatch(/Umkehrung; Plateau → Ankunft/)
    expect(quelle).toMatch(/if \(\(xs\[mitte\] as number\) < x\) lo = mitte \+ 1/)
  })

  it('webt Halte wie die Studio-Achse: zwei Stützstellen, Späteres hebt sich', () => {
    const quelle = readFileSync(new URL('../../src/studio/zeitleiste.ts', import.meta.url), 'utf8')
    expect(quelle).toMatch(/tS\.splice\(i, 0, h\.offsetS, h\.offsetS\)/)
    expect(quelle).toMatch(/filmS\.splice\(i, 0, filmAmHalt, filmAmHalt \+ h\.breiteS\)/)
  })
})
