// Zeitreihe, Pausen-Erkennung/-Kompression und Timeline-Destillat — die
// Grundlage der nichtlinearen Pseudo-Zeit im Player (M2).

import { describe, expect, it } from 'vitest'
import { meterFuerFilmsekunden } from '../src/pipeline/filmtempo.js'
import {
  KOLLAPS_MIN_REST_M,
  RAMPE_MIN_FILM_S,
  baueZeitreihe,
  destilliereTimeline,
  findePausen,
  kollabierePausen,
  positionZurZeit,
  raffePausen,
  zeitZurPosition,
} from '../src/pipeline/zeit.js'
import type { UploadSegment } from '../src/schema/upload.js'

const LAT = 46.59
const GRAD_PRO_M = 1 / (111_320 * Math.cos((LAT * Math.PI) / 180))

/**
 * Synthetischer Marsch nach Osten mit konstantem Tempo; optional eine
 * stationäre Pause (Punktwolke im Stand, wie die App sie alle 30 s ablegt).
 */
function marsch({
  dauerS = 3600,
  schrittS = 30,
  tempoMs = 1.4,
  pause,
}: {
  dauerS?: number
  schrittS?: number
  tempoMs?: number
  pause?: { abS: number; dauerS: number }
} = {}): UploadSegment {
  const pts: UploadSegment['pts'] = []
  let strecke = 0
  for (let t = 0; t <= dauerS; t += schrittS) {
    pts.push([8.0 + strecke * GRAD_PRO_M, LAT, 500, t])
    const inPause = pause && t >= pause.abS && t < pause.abS + pause.dauerS
    if (!inPause) strecke += tempoMs * schrittS
  }
  return { mode: 'walk', pts }
}

describe('baueZeitreihe', () => {
  it('verkettet Segmente mit kumulierter Distanz inkl. Segment-Sprung', () => {
    const reihe = baueZeitreihe([
      {
        mode: 'walk',
        pts: [
          [8.0, LAT, 500, 0],
          [8.0 + 100 * GRAD_PRO_M, LAT, 500, 60],
        ],
      },
      {
        mode: 'bike',
        pts: [
          [8.0 + 150 * GRAD_PRO_M, LAT, 500, 90],
          [8.0 + 350 * GRAD_PRO_M, LAT, 500, 150],
        ],
      },
    ])
    expect(reihe.punkte).toHaveLength(4)
    expect(reihe.gesamtM).toBeCloseTo(350, -1)
    expect(reihe.dauerS).toBe(150)
  })

  it('klemmt rückwärts laufende Zeit-Offsets monoton', () => {
    const reihe = baueZeitreihe([
      {
        mode: 'walk',
        pts: [
          [8.0, LAT, 500, 0],
          [8.001, LAT, 500, 100],
          [8.002, LAT, 500, 40],
        ],
      },
    ])
    expect(reihe.punkte.map((p) => p.tSek)).toEqual([0, 100, 100])
  })
})

describe('findePausen', () => {
  it('findet eine stationäre Punktwolke (Mittagspause der App)', () => {
    const reihe = baueZeitreihe([marsch({ dauerS: 7200, pause: { abS: 1800, dauerS: 1500 } })])
    const pausen = findePausen(reihe)
    expect(pausen).toHaveLength(1)
    // Der Aufenthaltsradius verwischt das Ende um wenige Punkte — das ist ok
    expect(pausen[0]?.dauerS).toBeGreaterThanOrEqual(1500)
    expect(pausen[0]?.dauerS).toBeLessThan(1500 + 240)
  })

  it('findet die einzelne Aufzeichnungslücke am selben Ort', () => {
    const reihe = baueZeitreihe([
      {
        mode: 'walk',
        pts: [
          [8.0, LAT, 500, 0],
          [8.0 + 500 * GRAD_PRO_M, LAT, 500, 600],
          [8.0 + 500 * GRAD_PRO_M, LAT, 500, 2400], // 30 min später, gleiche Stelle
          [8.0 + 1000 * GRAD_PRO_M, LAT, 500, 3000],
        ],
      },
    ])
    const pausen = findePausen(reihe)
    expect(pausen).toHaveLength(1)
    expect(pausen[0]?.dauerS).toBe(1800)
  })

  it('meldet keine Pause bei durchgehender Bewegung', () => {
    expect(findePausen(baueZeitreihe([marsch({ dauerS: 7200 })]))).toHaveLength(0)
  })

  it('behandelt eine Lücke MIT Ortswechsel nicht als Pause', () => {
    // Aufzeichnung 30 min aus, 5 km weiter wieder an: die Zeit verteilt sich
    // über echte Strecke — kein Sonnensprung, nichts zu komprimieren
    const reihe = baueZeitreihe([
      {
        mode: 'walk',
        pts: [
          [8.0, LAT, 500, 0],
          [8.0 + 500 * GRAD_PRO_M, LAT, 500, 600],
          [8.0 + 5500 * GRAD_PRO_M, LAT, 500, 2400],
          [8.0 + 6000 * GRAD_PRO_M, LAT, 500, 3000],
        ],
      },
    ])
    expect(findePausen(reihe)).toHaveLength(0)
  })
})

describe('raffePausen', () => {
  const mitPause = () =>
    baueZeitreihe([marsch({ dauerS: 7200, pause: { abS: 1800, dauerS: 1500 } })])

  it('lässt die Tour in ihrer echten Länge enden', () => {
    // Der Kern der Umstellung: Früher wurde die Pause auf 2 min gestaucht und
    // alles danach lief der Wirklichkeit um die Restdauer hinterher — die
    // Telemetrie zeigte am Tourende Stunden zu früh an.
    const reihe = mitPause()
    const roh = raffePausen(reihe, findePausen(reihe))
    expect(roh[roh.length - 1]).toBe(7200)
    expect(roh[0]).toBe(0)
  })

  it('lässt außerhalb des Rampenfensters die echte Zeit unangetastet', () => {
    const reihe = mitPause()
    const pause = findePausen(reihe)[0]
    if (!pause) throw new Error('Pause erwartet')
    const roh = raffePausen(reihe, [pause])
    // Die Rampe reicht eine halbe Filmsekunden-Länge über die Pause hinaus;
    // alles, was weiter weg liegt, trägt exakt seinen Aufnahmezeitstempel.
    const halbeRampeM = meterFuerFilmsekunden(RAMPE_MIN_FILM_S, 'walk') / 2
    const pausenM = (reihe.punkte[pause.vonIdx] as { dist: number }).dist
    let geprueft = 0
    reihe.punkte.forEach((p, i) => {
      if (Math.abs(p.dist - pausenM) < halbeRampeM * 2) return
      expect(roh[i]).toBe(p.tSek)
      geprueft++
    })
    expect(geprueft).toBeGreaterThan(reihe.punkte.length / 2)
  })

  it('erreicht am Fensterende wieder die echte Zeit (kein Rückstand)', () => {
    // Die alte Kompression sparte die Pausendauer ein und ließ alles Folgende
    // um sie zurückhängen. Die Rampe holt sie im Fenster komplett auf.
    const reihe = mitPause()
    const roh = raffePausen(reihe, findePausen(reihe))
    const pause = findePausen(reihe)[0]!
    // Direkt hinter der Pause ist der Rückstand schon aufgeholt …
    const kurzDahinter = reihe.punkte.findIndex(
      (p, i) =>
        i > pause.bisIdx && p.dist > (reihe.punkte[pause.bisIdx] as { dist: number }).dist + 200,
    )
    expect(roh[kurzDahinter]).toBe((reihe.punkte[kurzDahinter] as { tSek: number }).tSek)
  })

  it('bleibt monoton und lässt Touren ohne Pausen unverändert', () => {
    const reihe = baueZeitreihe([marsch()])
    expect(raffePausen(reihe, [])).toEqual(reihe.punkte.map((p) => p.tSek))

    const roh = raffePausen(mitPause(), findePausen(mitPause()))
    for (let i = 1; i < roh.length; i++) expect(roh[i]).toBeGreaterThanOrEqual(roh[i - 1] as number)
  })

  it('verschmilzt überlappende Rampenfenster zweier dichter Pausen', () => {
    // Zwei Pausen keine 200 m auseinander: Ohne Verschmelzung zöge die zweite
    // Rampe den von der ersten vorgezogenen Rand wieder zurück — die Uhr liefe
    // an der Nahtstelle rückwärts.
    const reihe = baueZeitreihe([marsch({ dauerS: 3600, pause: { abS: 900, dauerS: 1200 } })])
    const pausen = findePausen(reihe)
    const roh = raffePausen(reihe, pausen)
    for (let i = 1; i < roh.length; i++) expect(roh[i]).toBeGreaterThanOrEqual(roh[i - 1] as number)
    expect(roh[roh.length - 1]).toBe(3600)
  })
})

describe('kollabierePausen', () => {
  /**
   * Marsch mit DRIFTENDER Pause: im Stand pendelt das GPS deterministisch
   * (±50 m Sinus-Zickzack) um den Pausenort — die Erscheinungsform, die als
   * Fake-Strecke in Route und Statistik landete.
   */
  function marschMitDrift({ dauerS = 5400, abS = 1800, pauseS = 1500 } = {}): UploadSegment {
    const pts: UploadSegment['pts'] = []
    let strecke = 0
    for (let t = 0; t <= dauerS; t += 30) {
      if (t >= abS && t < abS + pauseS) {
        const zickzack = Math.sin(t / 90) * 50
        pts.push([
          8.0 + (strecke + zickzack) * GRAD_PRO_M,
          LAT + Math.cos(t / 70) * 30 * GRAD_PRO_M,
          500,
          t,
        ])
      } else {
        pts.push([8.0 + strecke * GRAD_PRO_M, LAT, 500, t])
        if (!(t >= abS && t < abS + pauseS)) strecke += 1.4 * 30
      }
    }
    return { mode: 'walk', pts }
  }

  it('zieht die Drift-Wolke auf einen Ort — die Fake-Strecke verschwindet', () => {
    const roh = [marschMitDrift()]
    const vorher = baueZeitreihe(roh).gesamtM
    const erg = kollabierePausen(roh)
    const nachher = baueZeitreihe(erg).gesamtM
    // Die Drift summierte hunderte Meter; übrig bleibt die Marschstrecke
    expect(vorher - nachher).toBeGreaterThan(300)

    // Alle Pausen-Punkte liegen jetzt exakt auf EINEM Ort im Drift-Gebiet
    const pause = (erg[0] as UploadSegment).pts.filter((p) => p[3] >= 1800 && p[3] < 3300)
    const orte = new Set(pause.map((p) => `${p[0]},${p[1]}`))
    expect(pause.length).toBeGreaterThan(10)
    expect(orte.size).toBe(1)
  })

  it('lässt Zeiten und Außenpunkte unangetastet und mutiert die Eingabe nicht', () => {
    const roh = [marschMitDrift()]
    const kopie = JSON.parse(JSON.stringify(roh)) as UploadSegment[]
    const erg = kollabierePausen(roh)
    // Eingabe byte-gleich geblieben
    expect(roh).toEqual(kopie)
    // Zeiten des Ergebnisses identisch zur Eingabe
    expect((erg[0] as UploadSegment).pts.map((p) => p[3])).toEqual(roh[0]?.pts.map((p) => p[3]))
    // Punkte klar außerhalb der Pause unverändert — die Erkennung verwischt
    // die Ränder um wenige Rasterpunkte (s. findePausen-Test: < +240 s)
    const aussen = (p: readonly number[]): boolean => p[3]! < 1800 - 240 || p[3]! >= 3300 + 240
    const aussenRoh = roh[0]?.pts.filter(aussen)
    const aussenErg = (erg[0] as UploadSegment).pts.filter(aussen)
    expect(aussenErg?.length).toBeGreaterThan(50)
    expect(aussenErg).toEqual(aussenRoh)
  })

  it('zieht das Naht-Duplikat an der Segmentgrenze mit — kein künstlicher Sprung', () => {
    // Segmentwechsel MITTEN in der Pause: der Grenzpunkt liegt als Kopie in
    // beiden Segmenten (Server-Konvention). Bliebe eine Kopie stehen, hätte
    // die Route dort einen Sprung vom Schwerpunkt zum alten Drift-Ort.
    const ganz = marschMitDrift()
    const naht = ganz.pts.findIndex((p) => p[3] >= 2400)
    const segmente: UploadSegment[] = [
      { mode: 'walk', pts: ganz.pts.slice(0, naht + 1) },
      { mode: 'bike', pts: ganz.pts.slice(naht) },
    ]
    const erg = kollabierePausen(segmente)
    const endeA = (erg[0] as UploadSegment).pts.at(-1)
    const anfangB = (erg[1] as UploadSegment).pts[0]
    expect(endeA).toEqual(anfangB)
    // Beide Kopien liegen auf dem Schwerpunkt, nicht auf dem alten Drift-Ort
    const mitte = (erg[0] as UploadSegment).pts.find((p) => p[3] >= 1800 && p[3] < 3300)
    expect(endeA?.[0]).toBeCloseTo(mitte?.[0] ?? 0, 10)
  })

  it('bleibt aus, wenn danach fast keine Strecke übrig wäre (Player-Schutz)', () => {
    // 20 m Marsch + 25 min Drift-Pause: ohne Wächter kollabierte die Tour zur
    // punktförmigen Route (route.total = 0 → NaN im Player).
    const kurz = marschMitDrift({ dauerS: 1560, abS: 30, pauseS: 1500 })
    const erg = kollabierePausen([kurz])
    expect(baueZeitreihe(erg).gesamtM).toBe(baueZeitreihe([kurz]).gesamtM)
    expect(erg[0]).toBe(kurz)
    expect(KOLLAPS_MIN_REST_M).toBeGreaterThan(10) // Destillat-Schwelle bleibt darunter
  })

  it('reicht Touren ohne Pause identisch durch', () => {
    const seg = marsch()
    const erg = kollabierePausen([seg])
    expect(erg[0]).toBe(seg)
  })

  it('Timeline-Destillat bleibt nach dem Kollaps monoton (senkrechter f-Sprung)', () => {
    const erg = kollabierePausen([marschMitDrift({ dauerS: 7200 })])
    const timeline = destilliereTimeline(baueZeitreihe(erg), '2026-07-04T06:00:00Z')
    if (!timeline) throw new Error('Timeline erwartet')
    for (let i = 1; i < timeline.length; i++) {
      expect(timeline[i]?.f).toBeGreaterThanOrEqual(timeline[i - 1]?.f ?? 0)
      expect(Date.parse(timeline[i]?.t ?? '')).toBeGreaterThanOrEqual(
        Date.parse(timeline[i - 1]?.t ?? ''),
      )
    }
  })
})

describe('destilliereTimeline', () => {
  const START = '2026-07-04T06:00:00Z'

  it('destilliert konstantes Tempo auf zwei Stützstellen', () => {
    const timeline = destilliereTimeline(baueZeitreihe([marsch()]), START)
    expect(timeline).toEqual([
      { f: 0, t: '2026-07-04T06:00:00Z' },
      { f: 1, t: '2026-07-04T07:00:00Z' },
    ])
  })

  it('rafft die Pause und behält Anfangs- wie Endzeit der Aufnahme', () => {
    const timeline = destilliereTimeline(
      baueZeitreihe([marsch({ dauerS: 7200, pause: { abS: 1800, dauerS: 1500 } })]),
      START,
    )
    if (!timeline) throw new Error('Timeline erwartet')
    expect(timeline[0]).toEqual({ f: 0, t: '2026-07-04T06:00:00Z' })
    expect(timeline[timeline.length - 1]).toEqual({ f: 1, t: '2026-07-04T08:00:00Z' })
    for (let i = 1; i < timeline.length; i++) {
      expect(timeline[i]?.f).toBeGreaterThanOrEqual(timeline[i - 1]?.f ?? 0)
      expect(Date.parse(timeline[i]?.t ?? '')).toBeGreaterThanOrEqual(
        Date.parse(timeline[i - 1]?.t ?? ''),
      )
    }
  })

  it('legt die gesamte Pausendauer in ein schmales Streckenfenster', () => {
    // Das ist der Zeitraffer: Auf wenigen Prozent der Strecke vergeht der
    // Löwenanteil der Zeit — dort dreht der Himmel von hell auf dunkel.
    const timeline = destilliereTimeline(
      baueZeitreihe([marsch({ dauerS: 7200, pause: { abS: 1800, dauerS: 1500 } })]),
      START,
    )
    if (!timeline) throw new Error('Timeline erwartet')
    // Steilheit = Sekunden je Streckenanteil. Der steilste Abschnitt ist die
    // Rampe; die normale Fahrt hat zwar größere Zeitsprünge, aber über weite
    // Strecken.
    let steilstesDt = 0
    let steilstesDf = 1
    for (let i = 1; i < timeline.length; i++) {
      const dt = (Date.parse(timeline[i]!.t) - Date.parse(timeline[i - 1]!.t)) / 1000
      const df = timeline[i]!.f - timeline[i - 1]!.f
      if (df > 0 && dt / df > steilstesDt / steilstesDf) {
        steilstesDt = dt
        steilstesDf = df
      }
    }
    // Der Löwenanteil der Pause (1500 s) steckt in diesem einen Abschnitt …
    expect(steilstesDt).toBeGreaterThan(1200)
    // … der weniger als 5 % der Strecke einnimmt
    expect(steilstesDf).toBeLessThan(0.05)
  })

  it('gibt bei degenerierten Touren undefined zurück', () => {
    // keine Strecke
    expect(
      destilliereTimeline(
        baueZeitreihe([
          {
            mode: 'walk',
            pts: [
              [8.0, LAT, 500, 0],
              [8.0, LAT, 500, 600],
            ],
          },
        ]),
        START,
      ),
    ).toBeUndefined()
    // kaputter Startzeitpunkt
    expect(destilliereTimeline(baueZeitreihe([marsch()]), 'kein-datum')).toBeUndefined()
    // keine Zeitspanne
    expect(
      destilliereTimeline(
        baueZeitreihe([
          {
            mode: 'walk',
            pts: [
              [8.0, LAT, 500, 0],
              [8.01, LAT, 500, 0],
            ],
          },
        ]),
        START,
      ),
    ).toBeUndefined()
  })
})

describe('positionZurZeit', () => {
  const reihe = baueZeitreihe([marsch({ dauerS: 3600 })])

  it('interpoliert linear zwischen den Punkten', () => {
    const mitte = positionZurZeit(reihe, 1800)
    expect(mitte.f).toBeCloseTo(0.5, 2)
    expect(mitte.lat).toBeCloseTo(LAT, 6)
  })

  it('klemmt außerhalb der Zeitspanne auf die Enden', () => {
    expect(positionZurZeit(reihe, -50).f).toBe(0)
    expect(positionZurZeit(reihe, 99999).f).toBe(1)
  })
})

describe('zeitZurPosition (Umkehrung)', () => {
  const reihe = baueZeitreihe([
    {
      mode: 'walk',
      pts: [
        [7.9, 46.5, 0, 0],
        [7.91, 46.51, 0, 1000],
      ],
    },
  ] as UploadSegment[])

  it('führt zu genau der Zeit zurück, aus der der Anteil kam', () => {
    for (const t of [0, 137, 500, 862, 1000]) {
      const f = positionZurZeit(reihe, t).f
      expect(zeitZurPosition(reihe, f)).toBeCloseTo(t, 3)
    }
  })

  it('klemmt außerhalb von 0..1', () => {
    expect(zeitZurPosition(reihe, -0.5)).toBe(0)
    expect(zeitZurPosition(reihe, 4)).toBe(1000)
  })

  it('liefert an einer Pause den Moment des ANKOMMENS, nicht des Weiterfahrens', () => {
    // Punkte 2 und 3 liegen am selben Ort: die Distanz wächst dort nicht, die
    // Zeit schon. Der Anteil ist an dieser Stelle also mehrdeutig — geliefert
    // wird der früheste Zeitpunkt.
    const mitPause = baueZeitreihe([
      {
        mode: 'walk',
        pts: [
          [7.9, 46.5, 0, 0],
          [7.91, 46.51, 0, 600],
          [7.91, 46.51, 0, 3000],
          [7.92, 46.52, 0, 4000],
        ],
      },
    ] as UploadSegment[])
    // Der Anteil AM ENDE der Pause führt auf ihren Anfang zurück
    const fPause = positionZurZeit(mitPause, 3000).f
    expect(zeitZurPosition(mitPause, fPause)).toBeCloseTo(600, 3)
    // Am Tourende greift dagegen die Klemme: dort gilt der letzte Zeitpunkt.
    expect(zeitZurPosition(mitPause, 1)).toBe(4000)
  })
})
