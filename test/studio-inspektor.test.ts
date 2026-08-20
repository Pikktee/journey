// Inspector-Logik des Studio-Editors: Fokus-Auflösung und Zeit-Eingabe.
// Wie überall im Studio ist hier nur die REINE Logik getestet — die DOM- und
// MapLibre-Verdrahtung (editor.ts) läuft im Browser-E2E, nicht hier.

import { describe, expect, it } from 'vitest'
import {
  EMPTY_OVERLAY,
  withCameraBoundary,
  withTravelModeBoundary,
  withCameraMoment,
  withWeatherBoundary,
  offsetToIso,
  splitForDisplay,
  type EditorSegment,
  type TrackPoint,
} from '../src/studio/editmodell'
import {
  clampBoundary,
  resolveSelection,
  parseClockMinutes,
  clockDiffToOffset,
} from '../src/studio/zeitleiste'

const START = '2026-03-12T07:10:00Z'
const iso = (s: number): string => offsetToIso(START, s)

// Eine Stunde Fahrt auf gerader Linie, alle 10 Minuten ein Punkt. Die
// Zerlegung kann nur AN Trackpunkten trennen — mit zu grobem Track rutschen
// Grenzen auf den nächsten Punkt und der Test prüft etwas anderes als gemeint.
const track: TrackPoint[] = Array.from(
  { length: 7 },
  (_, i) => [9 + i * 0.02, 47, 400, i * 600] as TrackPoint,
)
const segmente: EditorSegment[] = [{ mode: 'bike', pts: track }]
const abschnitte = (edits = EMPTY_OVERLAY): ReturnType<typeof splitForDisplay> =>
  splitForDisplay(segmente, edits, START)

describe('resolveSelection', () => {
  it('liefert null ohne Fokus und für verschwundene Objekte', () => {
    expect(resolveSelection(null, EMPTY_OVERLAY, abschnitte(), track, START, [])).toBeNull()
    // Moment, den es nicht (mehr) gibt
    expect(
      resolveSelection(
        { kind: 'moment', from: iso(600) },
        EMPTY_OVERLAY,
        abschnitte(),
        track,
        START,
        [],
      ),
    ).toBeNull()
  })

  it('löst ein Fortbewegungs-Band auf die Segment-Spanne auf', () => {
    const ziel = resolveSelection(
      { kind: 'modus', atS: 1200 },
      EMPTY_OVERLAY,
      abschnitte(),
      track,
      START,
      [],
    )
    expect(ziel).toMatchObject({ kind: 'modus', fromS: 0, toS: 3600, mode: 'bike' })
    // Ohne eigene Grenze: aus der Aufzeichnung — weder entfernbar noch verschiebbar
    expect(ziel?.from).toBeNull()
    expect(ziel?.nextFrom).toBeNull()
  })

  it('gibt auch erkannten Modus-Kanten eine Identität', () => {
    // Mehrere Segmente = die vom Server erkannte Aufteilung. Ihre Kanten stehen
    // (noch) nicht im Overlay, müssen sich aber anfassen lassen.
    const erkannt: EditorSegment[] = [
      { mode: 'moped', pts: track.slice(0, 4) },
      { mode: 'walk', pts: track.slice(3) },
    ]
    const a = splitForDisplay(erkannt, EMPTY_OVERLAY, START)
    const erstes = resolveSelection({ kind: 'modus', atS: 600 }, EMPTY_OVERLAY, a, track, START, [])
    expect(erstes?.from).toBeNull() // Tour-Anfang bleibt fest
    expect(erstes?.nextFrom).toBe(iso(1800))
    const zweites = resolveSelection(
      { kind: 'modus', atS: 2400 },
      EMPTY_OVERLAY,
      a,
      track,
      START,
      [],
    )
    expect(zweites).toMatchObject({ mode: 'walk', from: iso(1800), nextFrom: null })
  })

  it('hält eine Trim-Kante nicht für eine Modus-Grenze', () => {
    // Trim teilt das Band ebenfalls — links und rechts derselbe Modus. Zöge man
    // dort, entstünde ein Modus-Wechsel aus dem Nichts.
    const e = { ...EMPTY_OVERLAY, trim: { start: iso(1200) } }
    const ziel = resolveSelection({ kind: 'modus', atS: 2400 }, e, abschnitte(e), track, START, [])
    expect(ziel?.from).toBeNull()
  })

  it('kennt die Grenze, die ein Band eröffnet UND die, die es schließt', () => {
    let e = withTravelModeBoundary(EMPTY_OVERLAY, iso(1200), 'moped')
    e = withTravelModeBoundary(e, iso(2400), 'walk')
    // Das mittlere Band (Moped) hat beide Kanten
    const mitte = resolveSelection({ kind: 'modus', atS: 1800 }, e, abschnitte(e), track, START, [])
    expect(mitte).toMatchObject({ mode: 'moped', fromS: 1200, toS: 2400 })
    expect(mitte?.from).toBe(iso(1200))
    expect(mitte?.nextFrom).toBe(iso(2400))
    // Das letzte Band endet am Tourende — kein Nachfolger, also kein Ende-Feld
    const letztes = resolveSelection(
      { kind: 'modus', atS: 3000 },
      e,
      abschnitte(e),
      track,
      START,
      [],
    )
    expect(letztes?.from).toBe(iso(2400))
    expect(letztes?.nextFrom).toBeNull()
  })

  it('Kamera: Grundband ohne Grenze, danach Preset samt Feinjustierung', () => {
    const e = withCameraBoundary(EMPTY_OVERLAY, iso(1800), 'near', 1.3)
    const grund = resolveSelection({ kind: 'kamera', atS: 600 }, e, abschnitte(e), track, START, [])
    expect(grund).toMatchObject({ kind: 'kamera', from: null, nextFrom: iso(1800) })
    expect(grund?.preset).toBeUndefined() // „Preset des Zuschauers"
    const nah = resolveSelection({ kind: 'kamera', atS: 2400 }, e, abschnitte(e), track, START, [])
    expect(nah).toMatchObject({ preset: 'near', intensity: 1.3, from: iso(1800), nextFrom: null })
  })

  it('Wetter: sobald eine Grenze gesetzt ist, gilt davor „klar" statt „automatisch"', () => {
    const ohne = resolveSelection(
      { kind: 'wetter', atS: 600 },
      EMPTY_OVERLAY,
      abschnitte(),
      track,
      START,
      [],
    )
    expect(ohne?.weatherMode).toBeUndefined() // automatisch
    const e = withWeatherBoundary(EMPTY_OVERLAY, iso(1800), 'rain', 0.7)
    const davor = resolveSelection({ kind: 'wetter', atS: 600 }, e, abschnitte(e), track, START, [])
    expect(davor?.weatherMode).toBe('off') // das Overlay ersetzt das Auto-Wetter
    const regen = resolveSelection(
      { kind: 'wetter', atS: 2400 },
      e,
      abschnitte(e),
      track,
      START,
      [],
    )
    expect(regen).toMatchObject({ weatherMode: 'rain', intensity: 0.7, from: iso(1800) })
  })

  it('Moment ist ein Zeitpunkt: Anfang und Ende fallen zusammen', () => {
    const e = withCameraMoment(EMPTY_OVERLAY, iso(900), 'orbit', 8)
    const ziel = resolveSelection(
      { kind: 'moment', from: iso(900) },
      e,
      abschnitte(e),
      track,
      START,
      [],
    )
    expect(ziel).toMatchObject({
      kind: 'moment',
      fromS: 900,
      toS: 900,
      momentKind: 'orbit',
      durationS: 8,
    })
  })

  it('Audio: Musik hat eine Spanne, ein Klang nur einen Zeitpunkt', () => {
    const e: typeof EMPTY_OVERLAY = {
      ...EMPTY_OVERLAY,
      audio: [
        { file: 'a.mp3', type: 'music', from: iso(600), to: iso(1800) },
        { file: 'moewe.mp3', type: 'sfx', from: iso(2400), source: 'library' },
      ],
    }
    expect(
      resolveSelection({ kind: 'audio', index: 0 }, e, abschnitte(e), track, START, []),
    ).toMatchObject({
      fromS: 600,
      toS: 1800,
      index: 0,
    })
    const klang = resolveSelection({ kind: 'audio', index: 1 }, e, abschnitte(e), track, START, [])
    expect(klang?.fromS).toBe(klang?.toS)
    // Musik ohne `bis` läuft bis zum Tourende
    const offen: typeof EMPTY_OVERLAY = {
      ...EMPTY_OVERLAY,
      audio: [{ file: 'a.mp3', type: 'music', from: iso(600) }],
    }
    expect(
      resolveSelection({ kind: 'audio', index: 0 }, offen, abschnitte(offen), track, START, [])
        ?.toS,
    ).toBe(3600)
  })

  it('Medium: die Zeit kommt aus dem auf den Track projizierten Anker', () => {
    const medien = [
      {
        id: 'm1',
        type: 'photo' as const,
        src: '/x',
        takenAt: iso(0),
        caption: '',
        anchor: [9.06, 47.001] as [number, number],
        placement: 'gps' as const,
        removed: false,
      },
    ]
    const ziel = resolveSelection(
      { kind: 'medium', id: 'm1' },
      EMPTY_OVERLAY,
      abschnitte(),
      track,
      START,
      medien,
    )
    expect(ziel).toMatchObject({ kind: 'medium', id: 'm1' })
    expect(ziel?.fromS).toBeCloseTo(1800, 0)
    // Unplatziert (kein Anker) → nichts zu zeigen
    const ohneAnker = [{ ...medien[0]!, anchor: null }]
    expect(
      resolveSelection(
        { kind: 'medium', id: 'm1' },
        EMPTY_OVERLAY,
        abschnitte(),
        track,
        START,
        ohneAnker,
      ),
    ).toBeNull()
  })
})

describe('Zeit-Eingabe', () => {
  it('liest Uhrzeiten in den üblichen Schreibweisen', () => {
    expect(parseClockMinutes('14:03')).toBe(14 * 60 + 3)
    expect(parseClockMinutes(' 1403 ')).toBe(14 * 60 + 3)
    expect(parseClockMinutes('14.03')).toBe(14 * 60 + 3)
    expect(parseClockMinutes('9:05')).toBe(9 * 60 + 5)
    expect(parseClockMinutes('00:00')).toBe(0)
    expect(parseClockMinutes('24:00')).toBeNull()
    expect(parseClockMinutes('14:60')).toBeNull()
    expect(parseClockMinutes('abc')).toBeNull()
    expect(parseClockMinutes('')).toBeNull()
  })

  it('rechnet die Differenz zur angezeigten Zeit, nicht die Uhrzeit selbst', () => {
    // 14:03 → 14:20 sind +17 Minuten, egal welcher Tag oder welche Zone
    expect(clockDiffToOffset(3600, '14:03', '14:20')).toBe(3600 + 17 * 60)
    expect(clockDiffToOffset(3600, '14:03', '13:53')).toBe(3600 - 10 * 60)
  })

  it('deutet einen Sprung über Mitternacht als kurzen Schritt', () => {
    // 23:50 → 00:05 heißt +15 Min, nicht fast ein Tag zurück
    expect(clockDiffToOffset(10_000, '23:50', '00:05')).toBe(10_000 + 15 * 60)
    expect(clockDiffToOffset(10_000, '00:05', '23:50')).toBe(10_000 - 15 * 60)
  })

  it('gibt bei unlesbarer Eingabe null zurück (Feld springt zurück)', () => {
    expect(clockDiffToOffset(3600, '14:03', 'morgen')).toBeNull()
    expect(clockDiffToOffset(3600, '', '14:20')).toBeNull()
  })
})

describe('clampBoundary', () => {
  const grenzen = [{ from: iso(0) }, { from: iso(1200) }, { from: iso(2400) }]

  it('lässt eine Grenze zwischen ihren Nachbarn frei laufen', () => {
    expect(clampBoundary(grenzen, iso(1200), START, 1500)).toBe(1500)
  })

  it('lässt sie den Nachfolger nicht überholen', () => {
    // Der eigentliche Fehler: ein schneller Zug schob die Kante über die
    // nächste hinaus — der gezogene Abschnitt war danach verschwunden.
    expect(clampBoundary(grenzen, iso(1200), START, 9000)).toBe(2399)
  })

  it('lässt sie nicht hinter den Vorgänger zurückfallen', () => {
    expect(clampBoundary(grenzen, iso(1200), START, -500)).toBe(1)
  })

  it('klemmt nur an vorhandenen Seiten', () => {
    expect(clampBoundary(grenzen, iso(2400), START, 9000)).toBe(9000)
    expect(clampBoundary([{ from: iso(600) }], iso(600), START, -900)).toBe(-900)
  })

  it('lässt mit Trackzeiten immer einen Punkt im Abschnitt', () => {
    // Sonst gälte der Zustand für keinen einzigen Punkt: das Band verschwände
    // aus der Anzeige, obwohl seine Grenze noch im Overlay steht — und wäre
    // damit nicht mehr anzufassen.
    const punkte = track.map((p) => p[3]) // 0, 600, …, 3600
    expect(clampBoundary(grenzen, iso(1200), START, 9000, punkte)).toBe(1800)
    expect(clampBoundary(grenzen, iso(1200), START, -500, punkte)).toBe(600)
  })
})
