// Die Film-Achse der Pipeline (Etappe 4): Aufnahmezeit ↔ Filmsekunde.
//
// Sie ist der Server-Spiegel der geteilten Achse (src/film-axis.ts, von Player
// und Studio benutzt). Beide müssen dasselbe rechnen — sonst startet ein
// Ton-Klip im fertigen Film woanders, als der Editor ihn gezeigt hat. Die Zahlen
// hält das gemeinsame Verhaltens-Fixture zusammen (filmtempo.test.ts), die
// Konvention der Drift-Wächter am Ende.

import { describe, expect, it } from 'vitest'
import {
  buildAxisStops,
  buildFilmAxis,
  buildMomentStops,
  filmTimeAtRecordingTime,
  projectOntoTimeSeries,
  recordingTimeAtFilmTime,
} from '../src/pipeline/film-axis.js'
import {
  STOP_FADE_OUT_S,
  STOP_ENGINE_S,
  MOMENT_DEFAULT_S,
  tempoMs,
} from '../src/pipeline/film-tempo.js'
import { buildTimeSeries } from '../src/pipeline/time.js'
import type { UploadSegment } from '../src/schema/upload.js'

/** Gerade Ost-Strecke: `meterProSchritt` je Punkt, ein Punkt je `sekProSchritt`. */
function geradeStrecke(
  points: number,
  meterProSchritt: number,
  sekProSchritt: number,
  mode: UploadSegment['mode'] = 'walk',
): UploadSegment {
  const gradProMeter = 1 / (111_320 * Math.cos((46.6 * Math.PI) / 180))
  return {
    mode,
    pts: Array.from({ length: points }, (_, i) => [
      7.9 + i * meterProSchritt * gradProMeter,
      46.6,
      800,
      i * sekProSchritt,
    ]),
  }
}

// Die Fälle hier prüfen HALTE und Tempo und rechnen deshalb mit `rampeM = 0` —
// mit Rampe stünde in jeder Erwartung noch ihr Zuschlag, und der Test sagte
// nicht mehr, worüber er redet. Die Rampe hat ihren eigenen Fall am Ende und
// ihre Zahlen im Verhaltens-Fixture (filmtempo.test.ts).
describe('baueFilmAchse', () => {
  it('rechnet Fahrzeit aus Strecke ÷ Modus-Tempo', () => {
    // Zu Fuß: 60 m/s Filmtempo. 10 Schritte à 96 m = 960 m → 16 Filmsekunden.
    const achse = buildFilmAxis(buildTimeSeries([geradeStrecke(11, 96, 60)]), [], 0)
    expect(achse).not.toBeNull()
    expect(achse?.totalS).toBeCloseTo(960 / tempoMs('walk'), 1)
    // Aufnahmezeit läuft 600 s, Filmzeit 16 s — die Achse ist kein Zeitmaß
    expect(filmTimeAtRecordingTime(achse!, 300)).toBeCloseTo(480 / tempoMs('walk'), 1)
  })

  it('webt einen Halt als Plateau ein: Film läuft, Aufnahmeuhr steht', () => {
    const reihe = buildTimeSeries([geradeStrecke(11, 96, 60)])
    const achse = buildFilmAxis(reihe, [{ offsetS: 300, widthS: 6 }], 0)!
    const ankunft = 480 / tempoMs('walk')
    // Der Halt kostet 6 Filmsekunden, die Tour wird also um 6 s länger
    expect(achse.totalS).toBeCloseTo(960 / tempoMs('walk') + 6, 1)
    // Auf der Halt-Zeit steht die ANKUNFT (lower_bound-Konvention)
    expect(filmTimeAtRecordingTime(achse, 300)).toBeCloseTo(ankunft, 1)
    // Und mitten im Halt: dieselbe Aufnahmezeit, verschiedene Filmsekunden
    expect(recordingTimeAtFilmTime(achse, ankunft)).toBeCloseTo(300, 1)
    expect(recordingTimeAtFilmTime(achse, ankunft + 3)).toBeCloseTo(300, 1)
    expect(recordingTimeAtFilmTime(achse, ankunft + 6)).toBeCloseTo(300, 1)
    // Direkt dahinter läuft die Uhr weiter
    expect(recordingTimeAtFilmTime(achse, ankunft + 7)).toBeGreaterThan(300)
  })

  it('genau das kann die reine Aufnahmezeit NICHT — deshalb gibt es sie', () => {
    // Der Kernbefund aus docs §1: In Aufnahmezeit hat „mitten im Halt" keinen
    // Wert. Über die Film-Achse hat es drei verschiedene.
    const reihe = buildTimeSeries([geradeStrecke(11, 96, 60)])
    const achse = buildFilmAxis(reihe, [{ offsetS: 300, widthS: 6 }], 0)!
    const ankunft = 480 / tempoMs('walk')
    const drin = [0.5, 2, 5].map((f) => recordingTimeAtFilmTime(achse, ankunft + f))
    expect(new Set(drin).size).toBe(1) // in Aufnahmezeit ununterscheidbar
    expect(new Set([0.5, 2, 5]).size).toBe(3) // im Film sehr wohl
  })

  it('gibt null zurück, wo es nichts abzubilden gibt', () => {
    expect(buildFilmAxis(buildTimeSeries([]), [], 0)).toBeNull()
    expect(buildFilmAxis(buildTimeSeries([geradeStrecke(1, 96, 60)]), [], 0)).toBeNull()
    // Punktförmige Tour: Zeit vergeht, aber keine Strecke → keine Filmzeit
    expect(buildFilmAxis(buildTimeSeries([geradeStrecke(5, 0, 60)]), [], 0)).toBeNull()
  })

  it('legt die Rampen wie die Web-Achse in die Kurve (E14)', () => {
    // Der Grund, warum diese Kopie in DERSELBEN Auslieferung mitgeht: Kennt die
    // Server-Achse die Rampen nicht, löst `anker + versatzFilmS` im Render
    // anders auf als im Studio — genau die Drift, die Etappe 3 beendet hat.
    const reihe = buildTimeSeries([geradeStrecke(11, 96, 60)]) // 960 m zu Fuß
    // Ein Halt bei 480 m: drei Rampen à 240 m (Start, Bremsen, Anfahren), jede
    // kostet eine Reisezeit ihrer Strecke. Am Tour-Ende wird nicht gebremst.
    const r = 240 / tempoMs('walk')
    const achse = buildFilmAxis(reihe, [{ offsetS: 300, widthS: 6 }], 240)!
    expect(achse.totalS).toBeCloseTo(960 / tempoMs('walk') + 6 + 3 * r, 4)
    // Ankunft am Halt: Reise bis 480 m plus die zwei Rampen davor
    expect(filmTimeAtRecordingTime(achse, 300)).toBeCloseTo(480 / tempoMs('walk') + 2 * r, 4)
    // Und die Rampe ist eine FORM, kein Sprung: Nach der halben Rampenzeit sind
    // erst 3/16 ihrer Strecke gefahren — 45 der 240 m, in Aufnahmezeit
    // 45/96 × 60 s.
    expect(recordingTimeAtFilmTime(achse, r)).toBeCloseTo((45 / 96) * 60, 4)
  })

  it('schnellere Fortbewegung staucht die Achse', () => {
    const zuFuss = buildFilmAxis(buildTimeSeries([geradeStrecke(11, 96, 60, 'walk')]), [], 0)!
    const faehre = buildFilmAxis(buildTimeSeries([geradeStrecke(11, 96, 60, 'ferry')]), [], 0)!
    expect(zuFuss.totalS / faehre.totalS).toBeCloseTo(tempoMs('ferry') / tempoMs('walk'), 2)
  })
})

describe('baueAchsenHalte', () => {
  const foto = (meters: number, offsetS: number) => ({ type: 'photo' as const, meters, offsetS })

  it('fasst Aufnahmen unter 120 Streckenmetern zu EINEM Halt zusammen', () => {
    const halte = buildAxisStops([foto(0, 10), foto(50, 20), foto(119, 30), foto(400, 90)])
    expect(halte).toHaveLength(2)
    // Drei Aufnahmen = dreimal Standzeit samt Ausblendung
    expect(halte[0]?.widthS).toBeCloseTo(3 * (STOP_ENGINE_S + STOP_FADE_OUT_S), 6)
    expect(halte[0]?.offsetS).toBeCloseTo(20, 6) // Mittel der Mitglieder
    expect(halte[1]?.widthS).toBeCloseTo(STOP_ENGINE_S + STOP_FADE_OUT_S, 6)
  })

  it('misst zum ANFANG des Halts, nicht zum Vorgänger', () => {
    // Perlenkette: jeder Nachbar ist 100 m entfernt, der erste aber 300 m. Ohne
    // diese Regel verschmölze die ganze Kette zu einem beliebig langen Stopp.
    const halte = buildAxisStops([foto(0, 0), foto(100, 10), foto(200, 20), foto(300, 30)])
    expect(halte.map((h) => h.widthS / (STOP_ENGINE_S + STOP_FADE_OUT_S))).toEqual([2, 2])
  })

  it('ein Video zählt mit seiner echten Länge', () => {
    const halte = buildAxisStops([{ type: 'video', meters: 0, offsetS: 5, dauerS: 34.2 }])
    expect(halte[0]?.widthS).toBeCloseTo(34.2 + STOP_FADE_OUT_S, 6)
  })

  it('eine eigene Standzeit schlägt die Vorgabe', () => {
    const halte = buildAxisStops([{ type: 'photo', meters: 0, offsetS: 5, display: { holdS: 12 } }])
    expect(halte[0]?.widthS).toBeCloseTo(12 + STOP_FADE_OUT_S, 6)
  })
})

describe('baueMomentHalte', () => {
  it('nimmt die Dauer der Art — ohne Ausblendung', () => {
    const halte = buildMomentStops([
      { offsetS: 100, kind: 'orbit' },
      { offsetS: 200, kind: 'linger', dauerS: 9 },
    ])
    // Ein Moment endet in der Engine direkt in der Weiterfahrt; 0,8 s
    // Ausblendung wie am Foto-Halt gibt es dort nicht.
    expect(halte).toEqual([
      { offsetS: 100, widthS: MOMENT_DEFAULT_S.orbit },
      { offsetS: 200, widthS: 9 },
    ])
  })

  it('gruppiert NICHT: zwei dichte Momente sind zwei Halte', () => {
    // Anders als Aufnahmen (120-m-Kette): jeder Moment ist ein eigenes
    // Ereignis mit eigener Kamerabewegung.
    const halte = buildMomentStops([
      { offsetS: 100, kind: 'linger' },
      { offsetS: 101, kind: 'linger' },
    ])
    expect(halte).toHaveLength(2)
  })

  it('verlängert die Achse und schiebt alles Spätere nach hinten', () => {
    // Der eigentliche Befund: Ohne den Moment-Halt löst der Render einen
    // Ton-Klip, der über anker + versatzFilmS DAHINTER liegt, gegen eine zu
    // kurze Achse auf — er landete im Film um die Momentdauer zu früh.
    const reihe = buildTimeSeries([geradeStrecke(11, 96, 60)])
    const ohne = buildFilmAxis(reihe, [], 0)!
    const mit = buildFilmAxis(reihe, buildMomentStops([{ offsetS: 300, kind: 'orbit' }]), 0)!
    expect(mit.totalS - ohne.totalS).toBeCloseTo(MOMENT_DEFAULT_S.orbit, 6)
    // Ein Anker VOR dem Moment liegt unverändert; 6 Filmsekunden nach ihm steht
    // die Aufnahmeuhr noch im Moment, statt schon weitergelaufen zu sein.
    expect(filmTimeAtRecordingTime(mit, 120)).toBeCloseTo(filmTimeAtRecordingTime(ohne, 120), 6)
    expect(recordingTimeAtFilmTime(mit, filmTimeAtRecordingTime(mit, 300) + 3)).toBeCloseTo(300, 6)
    expect(recordingTimeAtFilmTime(ohne, filmTimeAtRecordingTime(ohne, 300) + 3)).toBeGreaterThan(
      300,
    )
  })

  it('reiht sich mit den Aufnahme-Halten in EINE Achse', () => {
    const reihe = buildTimeSeries([geradeStrecke(11, 96, 60)])
    const achse = buildFilmAxis(
      reihe,
      [
        ...buildAxisStops([{ type: 'photo', meters: 480, offsetS: 300 }]),
        ...buildMomentStops([{ offsetS: 480, kind: 'ascend' }]),
      ],
      0,
    )!
    // Fahrt + Foto (Standzeit samt Ausblendung) + Moment (nur Dauer)
    expect(achse.totalS).toBeCloseTo(
      960 / tempoMs('walk') + STOP_ENGINE_S + STOP_FADE_OUT_S + MOMENT_DEFAULT_S.ascend,
      6,
    )
  })
})

describe('projiziereAufReihe', () => {
  it('trifft Punkte ZWISCHEN den Stützstellen', () => {
    // Auf grob abgetasteten Tracks liegen 60 s zwischen zwei Punkten — würde auf
    // den nächsten Stützpunkt gerundet, spränge ein Halt um eine halbe Minute.
    const reihe = buildTimeSeries([geradeStrecke(3, 1000, 60)])
    const mitte = reihe.points[1]!
    const gradProMeter = 1 / (111_320 * Math.cos((46.6 * Math.PI) / 180))
    const ort = projectOntoTimeSeries(reihe, 7.9 + 500 * gradProMeter, 46.6)
    expect(ort.offsetS).toBeCloseTo(30, 0)
    // Auf einen Meter genau: die Zeitreihe misst mit Haversine, die Projektion
    // mit lokaler Plattkarte — über 1 km sind das gut 0,5 m Unterschied.
    expect(Math.abs(ort.meters - 500)).toBeLessThan(2)
    expect(mitte.tSec).toBe(60) // die nächste Stützstelle wäre 60 gewesen
  })

  it('klemmt seitlich neben der Strecke auf den nächstgelegenen Punkt', () => {
    const reihe = buildTimeSeries([geradeStrecke(3, 1000, 60)])
    const ort = projectOntoTimeSeries(reihe, 7.9, 46.61) // 1,1 km nördlich vom Start
    expect(ort.offsetS).toBeCloseTo(0, 6)
  })
})

describe('Drift-Wächter gegen die Web-Achse', () => {
  // Die Zahlen prüft das gemeinsame Verhaltens-Fixture (filmtempo.test.ts, und
  // in der Web-Hälfte test/filmachse.test.ts). Hier steht die KONVENTION, an
  // der beide Seiten hängen und die kein Zahlenvergleich sichtbar macht.
  //
  // Vorher stand an dieser Stelle ein Wächter, der src/studio/timeline.ts als
  // TEXT las und auf `tS.splice(i, 0, h.offsetS, h.offsetS)` prüfte. Er fiel mit
  // Paket D — nicht weil das Weben sich geändert hätte, sondern weil es
  // umgezogen ist (src/film-axis.ts) und in Metern rechnet. Genau das ist der
  // Grund, warum ein Quelltext-Wächter keiner ist.

  it('liefert bei doppelten Stützstellen die ANKUNFT, nicht die Abfahrt', () => {
    // Kippte eine der beiden Seiten auf „rechts", spränge jeder Anker, der auf
    // einer Halt-Zeit sitzt, um die ganze Standzeit.
    const reihe = buildTimeSeries([geradeStrecke(11, 96, 60)])
    const achse = buildFilmAxis(reihe, [{ offsetS: 300, widthS: 6 }], 0)!
    const ankunft = 480 / tempoMs('walk')
    expect(filmTimeAtRecordingTime(achse, 300)).toBeCloseTo(ankunft, 6) // nicht die Abfahrt
    expect(recordingTimeAtFilmTime(achse, ankunft + 6)).toBeCloseTo(300, 6) // nicht die Zeit danach
  })

  it('webt einen Halt als PAAR ein: Späteres hebt sich um seine Breite', () => {
    const reihe = buildTimeSeries([geradeStrecke(11, 96, 60)])
    const ohne = buildFilmAxis(reihe, [], 0)!
    const mit = buildFilmAxis(reihe, [{ offsetS: 300, widthS: 6 }], 0)!
    expect(filmTimeAtRecordingTime(mit, 120)).toBeCloseTo(filmTimeAtRecordingTime(ohne, 120), 6) // davor: unverändert
    expect(filmTimeAtRecordingTime(mit, 480)).toBeCloseTo(filmTimeAtRecordingTime(ohne, 480) + 6, 6) // danach: um die Breite
    expect(mit.totalS - ohne.totalS).toBeCloseTo(6, 6)
  })
})
