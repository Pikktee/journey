// Inspector-Logik des Studio-Editors: Fokus-Auflösung und Zeit-Eingabe.
// Wie überall im Studio ist hier nur die REINE Logik getestet — die DOM- und
// MapLibre-Verdrahtung (editor.ts) läuft im Browser-E2E, nicht hier.

import { describe, expect, it } from 'vitest'
import {
  LEERES_OVERLAY,
  mitKameraGrenze,
  mitModusGrenze,
  mitMoment,
  mitWetterGrenze,
  offsetZuIso,
  zerlegeFuerAnzeige,
  type EditorSegment,
  type TrackPunkt,
} from '../src/studio/editmodell'
import {
  klemmeGrenze,
  loeseFokusAuf,
  parseUhrMinuten,
  uhrDiffZuOffset,
} from '../src/studio/zeitleiste'

const START = '2026-03-12T07:10:00Z'
const iso = (s: number): string => offsetZuIso(START, s)

// Eine Stunde Fahrt auf gerader Linie, alle 10 Minuten ein Punkt. Die
// Zerlegung kann nur AN Trackpunkten trennen — mit zu grobem Track rutschen
// Grenzen auf den nächsten Punkt und der Test prüft etwas anderes als gemeint.
const track: TrackPunkt[] = Array.from(
  { length: 7 },
  (_, i) => [9 + i * 0.02, 47, 400, i * 600] as TrackPunkt,
)
const segmente: EditorSegment[] = [{ mode: 'bike', pts: track }]
const abschnitte = (edits = LEERES_OVERLAY): ReturnType<typeof zerlegeFuerAnzeige> =>
  zerlegeFuerAnzeige(segmente, edits, START)

describe('loeseFokusAuf', () => {
  it('liefert null ohne Fokus und für verschwundene Objekte', () => {
    expect(loeseFokusAuf(null, LEERES_OVERLAY, abschnitte(), track, START, [])).toBeNull()
    // Moment, den es nicht (mehr) gibt
    expect(
      loeseFokusAuf(
        { art: 'moment', ab: iso(600) },
        LEERES_OVERLAY,
        abschnitte(),
        track,
        START,
        [],
      ),
    ).toBeNull()
  })

  it('löst ein Fortbewegungs-Band auf die Segment-Spanne auf', () => {
    const ziel = loeseFokusAuf(
      { art: 'modus', bezugS: 1200 },
      LEERES_OVERLAY,
      abschnitte(),
      track,
      START,
      [],
    )
    expect(ziel).toMatchObject({ art: 'modus', vonS: 0, bisS: 3600, mode: 'bike' })
    // Ohne eigene Grenze: aus der Aufzeichnung — weder entfernbar noch verschiebbar
    expect(ziel?.ab).toBeNull()
    expect(ziel?.naechsteAb).toBeNull()
  })

  it('gibt auch erkannten Modus-Kanten eine Identität', () => {
    // Mehrere Segmente = die vom Server erkannte Aufteilung. Ihre Kanten stehen
    // (noch) nicht im Overlay, müssen sich aber anfassen lassen.
    const erkannt: EditorSegment[] = [
      { mode: 'moped', pts: track.slice(0, 4) },
      { mode: 'walk', pts: track.slice(3) },
    ]
    const a = zerlegeFuerAnzeige(erkannt, LEERES_OVERLAY, START)
    const erstes = loeseFokusAuf({ art: 'modus', bezugS: 600 }, LEERES_OVERLAY, a, track, START, [])
    expect(erstes?.ab).toBeNull() // Tour-Anfang bleibt fest
    expect(erstes?.naechsteAb).toBe(iso(1800))
    const zweites = loeseFokusAuf(
      { art: 'modus', bezugS: 2400 },
      LEERES_OVERLAY,
      a,
      track,
      START,
      [],
    )
    expect(zweites).toMatchObject({ mode: 'walk', ab: iso(1800), naechsteAb: null })
  })

  it('hält eine Trim-Kante nicht für eine Modus-Grenze', () => {
    // Trim teilt das Band ebenfalls — links und rechts derselbe Modus. Zöge man
    // dort, entstünde ein Modus-Wechsel aus dem Nichts.
    const e = { ...LEERES_OVERLAY, trim: { start: iso(1200) } }
    const ziel = loeseFokusAuf({ art: 'modus', bezugS: 2400 }, e, abschnitte(e), track, START, [])
    expect(ziel?.ab).toBeNull()
  })

  it('kennt die Grenze, die ein Band eröffnet UND die, die es schließt', () => {
    let e = mitModusGrenze(LEERES_OVERLAY, iso(1200), 'moped')
    e = mitModusGrenze(e, iso(2400), 'walk')
    // Das mittlere Band (Moped) hat beide Kanten
    const mitte = loeseFokusAuf({ art: 'modus', bezugS: 1800 }, e, abschnitte(e), track, START, [])
    expect(mitte).toMatchObject({ mode: 'moped', vonS: 1200, bisS: 2400 })
    expect(mitte?.ab).toBe(iso(1200))
    expect(mitte?.naechsteAb).toBe(iso(2400))
    // Das letzte Band endet am Tourende — kein Nachfolger, also kein Ende-Feld
    const letztes = loeseFokusAuf(
      { art: 'modus', bezugS: 3000 },
      e,
      abschnitte(e),
      track,
      START,
      [],
    )
    expect(letztes?.ab).toBe(iso(2400))
    expect(letztes?.naechsteAb).toBeNull()
  })

  it('Kamera: Grundband ohne Grenze, danach Preset samt Feinjustierung', () => {
    const e = mitKameraGrenze(LEERES_OVERLAY, iso(1800), 'nah', 1.3)
    const grund = loeseFokusAuf({ art: 'kamera', bezugS: 600 }, e, abschnitte(e), track, START, [])
    expect(grund).toMatchObject({ art: 'kamera', ab: null, naechsteAb: iso(1800) })
    expect(grund?.preset).toBeUndefined() // „Preset des Zuschauers"
    const nah = loeseFokusAuf({ art: 'kamera', bezugS: 2400 }, e, abschnitte(e), track, START, [])
    expect(nah).toMatchObject({ preset: 'nah', staerke: 1.3, ab: iso(1800), naechsteAb: null })
  })

  it('Wetter: sobald eine Grenze gesetzt ist, gilt davor „klar" statt „automatisch"', () => {
    const ohne = loeseFokusAuf(
      { art: 'wetter', bezugS: 600 },
      LEERES_OVERLAY,
      abschnitte(),
      track,
      START,
      [],
    )
    expect(ohne?.wetterMode).toBeUndefined() // automatisch
    const e = mitWetterGrenze(LEERES_OVERLAY, iso(1800), 'rain', 0.7)
    const davor = loeseFokusAuf({ art: 'wetter', bezugS: 600 }, e, abschnitte(e), track, START, [])
    expect(davor?.wetterMode).toBe('off') // das Overlay ersetzt das Auto-Wetter
    const regen = loeseFokusAuf({ art: 'wetter', bezugS: 2400 }, e, abschnitte(e), track, START, [])
    expect(regen).toMatchObject({ wetterMode: 'rain', staerke: 0.7, ab: iso(1800) })
  })

  it('Moment ist ein Zeitpunkt: Anfang und Ende fallen zusammen', () => {
    const e = mitMoment(LEERES_OVERLAY, iso(900), 'umkreisen', 8)
    const ziel = loeseFokusAuf({ art: 'moment', ab: iso(900) }, e, abschnitte(e), track, START, [])
    expect(ziel).toMatchObject({
      art: 'moment',
      vonS: 900,
      bisS: 900,
      momentArt: 'umkreisen',
      dauerS: 8,
    })
  })

  it('Audio: Musik hat eine Spanne, ein Klang nur einen Zeitpunkt', () => {
    const e: typeof LEERES_OVERLAY = {
      ...LEERES_OVERLAY,
      audio: [
        { datei: 'a.mp3', typ: 'musik', ab: iso(600), bis: iso(1800) },
        { datei: 'moewe.mp3', typ: 'sfx', ab: iso(2400), quelle: 'bibliothek' },
      ],
    }
    expect(
      loeseFokusAuf({ art: 'audio', index: 0 }, e, abschnitte(e), track, START, []),
    ).toMatchObject({
      vonS: 600,
      bisS: 1800,
      index: 0,
    })
    const klang = loeseFokusAuf({ art: 'audio', index: 1 }, e, abschnitte(e), track, START, [])
    expect(klang?.vonS).toBe(klang?.bisS)
    // Musik ohne `bis` läuft bis zum Tourende
    const offen: typeof LEERES_OVERLAY = {
      ...LEERES_OVERLAY,
      audio: [{ datei: 'a.mp3', typ: 'musik', ab: iso(600) }],
    }
    expect(
      loeseFokusAuf({ art: 'audio', index: 0 }, offen, abschnitte(offen), track, START, [])?.bisS,
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
        geloescht: false,
      },
    ]
    const ziel = loeseFokusAuf(
      { art: 'medium', id: 'm1' },
      LEERES_OVERLAY,
      abschnitte(),
      track,
      START,
      medien,
    )
    expect(ziel).toMatchObject({ art: 'medium', id: 'm1' })
    expect(ziel?.vonS).toBeCloseTo(1800, 0)
    // Unplatziert (kein Anker) → nichts zu zeigen
    const ohneAnker = [{ ...medien[0]!, anchor: null }]
    expect(
      loeseFokusAuf(
        { art: 'medium', id: 'm1' },
        LEERES_OVERLAY,
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
    expect(parseUhrMinuten('14:03')).toBe(14 * 60 + 3)
    expect(parseUhrMinuten(' 1403 ')).toBe(14 * 60 + 3)
    expect(parseUhrMinuten('14.03')).toBe(14 * 60 + 3)
    expect(parseUhrMinuten('9:05')).toBe(9 * 60 + 5)
    expect(parseUhrMinuten('00:00')).toBe(0)
    expect(parseUhrMinuten('24:00')).toBeNull()
    expect(parseUhrMinuten('14:60')).toBeNull()
    expect(parseUhrMinuten('abc')).toBeNull()
    expect(parseUhrMinuten('')).toBeNull()
  })

  it('rechnet die Differenz zur angezeigten Zeit, nicht die Uhrzeit selbst', () => {
    // 14:03 → 14:20 sind +17 Minuten, egal welcher Tag oder welche Zone
    expect(uhrDiffZuOffset(3600, '14:03', '14:20')).toBe(3600 + 17 * 60)
    expect(uhrDiffZuOffset(3600, '14:03', '13:53')).toBe(3600 - 10 * 60)
  })

  it('deutet einen Sprung über Mitternacht als kurzen Schritt', () => {
    // 23:50 → 00:05 heißt +15 Min, nicht fast ein Tag zurück
    expect(uhrDiffZuOffset(10_000, '23:50', '00:05')).toBe(10_000 + 15 * 60)
    expect(uhrDiffZuOffset(10_000, '00:05', '23:50')).toBe(10_000 - 15 * 60)
  })

  it('gibt bei unlesbarer Eingabe null zurück (Feld springt zurück)', () => {
    expect(uhrDiffZuOffset(3600, '14:03', 'morgen')).toBeNull()
    expect(uhrDiffZuOffset(3600, '', '14:20')).toBeNull()
  })
})

describe('klemmeGrenze', () => {
  const grenzen = [{ ab: iso(0) }, { ab: iso(1200) }, { ab: iso(2400) }]

  it('lässt eine Grenze zwischen ihren Nachbarn frei laufen', () => {
    expect(klemmeGrenze(grenzen, iso(1200), START, 1500)).toBe(1500)
  })

  it('lässt sie den Nachfolger nicht überholen', () => {
    // Der eigentliche Fehler: ein schneller Zug schob die Kante über die
    // nächste hinaus — der gezogene Abschnitt war danach verschwunden.
    expect(klemmeGrenze(grenzen, iso(1200), START, 9000)).toBe(2399)
  })

  it('lässt sie nicht hinter den Vorgänger zurückfallen', () => {
    expect(klemmeGrenze(grenzen, iso(1200), START, -500)).toBe(1)
  })

  it('klemmt nur an vorhandenen Seiten', () => {
    expect(klemmeGrenze(grenzen, iso(2400), START, 9000)).toBe(9000)
    expect(klemmeGrenze([{ ab: iso(600) }], iso(600), START, -900)).toBe(-900)
  })

  it('lässt mit Trackzeiten immer einen Punkt im Abschnitt', () => {
    // Sonst gälte der Zustand für keinen einzigen Punkt: das Band verschwände
    // aus der Anzeige, obwohl seine Grenze noch im Overlay steht — und wäre
    // damit nicht mehr anzufassen.
    const punkte = track.map((p) => p[3]) // 0, 600, …, 3600
    expect(klemmeGrenze(grenzen, iso(1200), START, 9000, punkte)).toBe(1800)
    expect(klemmeGrenze(grenzen, iso(1200), START, -500, punkte)).toBe(600)
  })
})
