// Zeitreihe, Pausen-Erkennung/-Kompression und Timeline-Destillat — die
// Grundlage der nichtlinearen Pseudo-Zeit im Player (M2).

import { describe, expect, it } from 'vitest'
import {
  PAUSE_ERSATZ_S,
  baueZeitreihe,
  destilliereTimeline,
  findePausen,
  komprimiereZeiten,
  positionZurZeit,
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
      { mode: 'walk', pts: [[8.0, LAT, 500, 0], [8.0 + 100 * GRAD_PRO_M, LAT, 500, 60]] },
      { mode: 'bike', pts: [[8.0 + 150 * GRAD_PRO_M, LAT, 500, 90], [8.0 + 350 * GRAD_PRO_M, LAT, 500, 150]] },
    ])
    expect(reihe.punkte).toHaveLength(4)
    expect(reihe.gesamtM).toBeCloseTo(350, -1)
    expect(reihe.dauerS).toBe(150)
  })

  it('klemmt rückwärts laufende Zeit-Offsets monoton', () => {
    const reihe = baueZeitreihe([
      { mode: 'walk', pts: [[8.0, LAT, 500, 0], [8.001, LAT, 500, 100], [8.002, LAT, 500, 40]] },
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

describe('komprimiereZeiten', () => {
  it('ersetzt die Pausendauer durch die Ersatzdauer, Rest bleibt', () => {
    const reihe = baueZeitreihe([marsch({ dauerS: 7200, pause: { abS: 1800, dauerS: 1500 } })])
    const pausen = findePausen(reihe)
    const komp = komprimiereZeiten(reihe, pausen)
    const pause = pausen[0]
    if (!pause) throw new Error('Pause erwartet')
    const gespart = pause.dauerS - PAUSE_ERSATZ_S
    expect(komp[komp.length - 1]).toBeCloseTo(7200 - gespart, 5)
    // Vor der Pause läuft die Zeit unverändert
    expect(komp[pause.vonIdx]).toBe(reihe.punkte[pause.vonIdx]?.tSek)
    // Am Pausenende sind genau PAUSE_ERSATZ_S vergangen
    expect(komp[pause.bisIdx]).toBeCloseTo((komp[pause.vonIdx] ?? 0) + PAUSE_ERSATZ_S, 5)
  })

  it('lässt Touren ohne Pausen unverändert', () => {
    const reihe = baueZeitreihe([marsch()])
    expect(komprimiereZeiten(reihe, [])).toEqual(reihe.punkte.map((p) => p.tSek))
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

  it('komprimiert die Pause und bleibt monoton', () => {
    const timeline = destilliereTimeline(
      baueZeitreihe([marsch({ dauerS: 7200, pause: { abS: 1800, dauerS: 1500 } })]),
      START,
    )
    if (!timeline) throw new Error('Timeline erwartet')
    expect(timeline[0]).toEqual({ f: 0, t: '2026-07-04T06:00:00Z' })
    expect(timeline[timeline.length - 1]?.f).toBe(1)
    // Pseudo-Spanne = echte Spanne minus eingesparte Pausenzeit (± Radius-Unschärfe)
    const spanneS = (Date.parse(timeline[timeline.length - 1]?.t ?? '') - Date.parse(timeline[0]?.t ?? '')) / 1000
    expect(spanneS).toBeLessThanOrEqual(7200 - 1500 + PAUSE_ERSATZ_S)
    expect(spanneS).toBeGreaterThan(7200 - 1800 + PAUSE_ERSATZ_S - 300)
    for (let i = 1; i < timeline.length; i++) {
      expect(timeline[i]?.f).toBeGreaterThanOrEqual(timeline[i - 1]?.f ?? 0)
      expect(Date.parse(timeline[i]?.t ?? '')).toBeGreaterThanOrEqual(Date.parse(timeline[i - 1]?.t ?? ''))
    }
  })

  it('gibt bei degenerierten Touren undefined zurück', () => {
    // keine Strecke
    expect(
      destilliereTimeline(
        baueZeitreihe([{ mode: 'walk', pts: [[8.0, LAT, 500, 0], [8.0, LAT, 500, 600]] }]),
        START,
      ),
    ).toBeUndefined()
    // kaputter Startzeitpunkt
    expect(destilliereTimeline(baueZeitreihe([marsch()]), 'kein-datum')).toBeUndefined()
    // keine Zeitspanne
    expect(
      destilliereTimeline(
        baueZeitreihe([{ mode: 'walk', pts: [[8.0, LAT, 500, 0], [8.01, LAT, 500, 0]] }]),
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
