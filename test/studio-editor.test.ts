// Editor-Modell (M7): reine Logik des Studio-Editors (src/studio/editmodell.ts).
// Die Karten-/DOM-Verdrahtung (editor.ts) läuft im Browser-E2E, nicht hier.

import { describe, expect, it } from 'vitest'
import {
  effektiveMedien,
  isoZuOffset,
  LEERES_OVERLAY,
  mitMedienEdit,
  mitModusGrenze,
  mitTrim,
  naechsterPunktIndex,
  offsetZuIso,
  ohneModusGrenze,
  pruefeOverlay,
  zerlegeFuerAnzeige,
  type EditorSegment,
  type MediumBasis,
  type TrackPunkt,
} from '../src/studio/editmodell'

const START = '2026-07-04T08:00:00Z'
const iso = (s: number): string => offsetZuIso(START, s)

const segmente = (): EditorSegment[] => [
  {
    mode: 'walk',
    pts: [
      [7.9, 46.5, 800, 0],
      [7.905, 46.505, 805, 300],
      [7.91, 46.51, 810, 600],
      [7.915, 46.515, 815, 900],
    ],
  },
]

describe('Zeit-Umrechnung', () => {
  it('offsetZuIso/isoZuOffset sind Umkehrfunktionen', () => {
    expect(offsetZuIso(START, 600)).toBe('2026-07-04T08:10:00Z')
    expect(isoZuOffset(START, '2026-07-04T08:10:00Z')).toBe(600)
  })
})

describe('naechsterPunktIndex', () => {
  it('findet den nächstgelegenen Trackpunkt', () => {
    const pts = segmente()[0]!.pts
    expect(naechsterPunktIndex(pts, 7.906, 46.506)).toBe(1)
    expect(naechsterPunktIndex(pts, 7.999, 46.599)).toBe(3)
  })
})

describe('Overlay-Mutationen', () => {
  it('mitMedienEdit merged, räumt Leeres weg und bleibt immutabel', () => {
    const a = mitMedienEdit(LEERES_OVERLAY, 'm1', { caption: 'Hallo' })
    expect(a.medien?.['m1']).toEqual({ caption: 'Hallo' })
    expect(LEERES_OVERLAY.medien).toBeUndefined()

    const b = mitMedienEdit(a, 'm1', { anchor: [7.9, 46.5] })
    expect(b.medien?.['m1']).toEqual({ caption: 'Hallo', anchor: [7.9, 46.5] })

    // caption: undefined entfernt den Override, geloescht: false ebenso
    const c = mitMedienEdit(b, 'm1', { caption: undefined, anchor: undefined })
    expect(c.medien).toBeUndefined()
    const d = mitMedienEdit(mitMedienEdit(LEERES_OVERLAY, 'm1', { geloescht: true }), 'm1', { geloescht: false })
    expect(d.medien).toBeUndefined()
  })

  it('mitModusGrenze ersetzt gleiche Zeitpunkte und sortiert', () => {
    const a = mitModusGrenze(mitModusGrenze(LEERES_OVERLAY, iso(600), 'ferry'), iso(300), 'tram')
    expect(a.modi?.map((g) => g.mode)).toEqual(['tram', 'ferry'])
    const b = mitModusGrenze(a, iso(600), 'walk')
    expect(b.modi?.map((g) => g.mode)).toEqual(['tram', 'walk'])
    expect(ohneModusGrenze(ohneModusGrenze(b, iso(300)), iso(600)).modi).toBeUndefined()
  })

  it('mitTrim setzt und entfernt Kanten', () => {
    const a = mitTrim(LEERES_OVERLAY, 'start', iso(300))
    expect(a.trim).toEqual({ start: iso(300) })
    expect(mitTrim(a, 'start', null).trim).toBeUndefined()
    expect(pruefeOverlay(mitTrim(a, 'ende', iso(100)))).toMatch(/Trim-Start/)
    expect(pruefeOverlay(mitTrim(a, 'ende', iso(900)))).toBeNull()
  })
})

describe('zerlegeFuerAnzeige', () => {
  it('teilt an Modus-Grenzen mit geteiltem Randpunkt (alte Gruppe besitzt den Verbinder)', () => {
    const out = zerlegeFuerAnzeige(segmente(), mitModusGrenze(LEERES_OVERLAY, iso(600), 'ferry'), START)
    expect(out.map((a) => a.mode)).toEqual(['walk', 'ferry'])
    // walk endet AM Grenzpunkt (t=600), ferry beginnt dort — Linie bleibt verbunden
    expect(out[0]?.pts.map((p) => p[3])).toEqual([0, 300, 600])
    expect(out[1]?.pts.map((p) => p[3])).toEqual([600, 900])
  })

  it('markiert getrimmte Bereiche als inaktiv (Verbinder wird grau)', () => {
    const edits = mitTrim(mitTrim(LEERES_OVERLAY, 'start', iso(300)), 'ende', iso(600))
    const out = zerlegeFuerAnzeige(segmente(), edits, START)
    expect(out.map((a) => [a.aktiv, a.pts.map((p) => p[3])])).toEqual([
      [false, [0, 300]], // vor dem Trim-Start: grau bis einschließlich Eintrittspunkt
      [true, [300, 600]], // aktive Spanne
      [false, [600, 900]], // nach dem Trim-Ende: Verbinder gehört der grauen Gruppe
    ])
  })

  it('liefert ohne Overlay einen einzigen aktiven Abschnitt', () => {
    const out = zerlegeFuerAnzeige(segmente(), LEERES_OVERLAY, START)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ mode: 'walk', aktiv: true })
    expect(out[0]?.pts).toHaveLength(4)
  })
})

describe('effektiveMedien', () => {
  const basis = (): MediumBasis[] => [
    { id: 'm1', type: 'photo', src: '/a.jpg', takenAt: iso(300), caption: 'Alt', anchor: [7.9, 46.5], placement: 'gps' },
    { id: 'm2', type: 'photo', src: '/b.jpg', takenAt: iso(600), caption: '', anchor: null, placement: 'unplatziert' },
  ]

  it('legt Overrides über die Auto-Platzierung; Gelöschte bleiben markiert drin', () => {
    const edits = mitMedienEdit(
      mitMedienEdit(LEERES_OVERLAY, 'm1', { geloescht: true }),
      'm2',
      { anchor: [7.91, 46.51], caption: 'Neu' },
    )
    const [m1, m2] = effektiveMedien(basis(), edits)
    expect(m1).toMatchObject({ geloescht: true, caption: 'Alt', placement: 'gps' })
    expect(m2).toMatchObject({ geloescht: false, caption: 'Neu', placement: 'manuell', anchor: [7.91, 46.51] })
  })

  it('ist ohne Overlay die Basis mit geloescht=false', () => {
    const out = effektiveMedien(basis(), LEERES_OVERLAY)
    expect(out.map((m) => m.geloescht)).toEqual([false, false])
    expect(out[0]?.placement).toBe('gps')
  })
})

// Verhindert stilles Auseinanderlaufen von Anzeige-Logik (Client) und
// Render-Logik (Server): ein Punkt exakt auf der Trim-Kante zählt als aktiv.
describe('Trim-Kanten-Semantik (inklusiv, wie serverseitig)', () => {
  it('behandelt die Kantenpunkte als Teil der aktiven Spanne', () => {
    const edits = mitTrim(mitTrim(LEERES_OVERLAY, 'start', iso(0)), 'ende', iso(900))
    const out = zerlegeFuerAnzeige(segmente(), edits, START)
    expect(out).toHaveLength(1)
    expect(out[0]?.aktiv).toBe(true)
  })
})
