// Editor-Modell (M7): reine Logik des Studio-Editors (src/studio/editmodell.ts).
// Die Karten-/DOM-Verdrahtung (editor.ts) läuft im Browser-E2E, nicht hier.

import { describe, expect, it } from 'vitest'
import {
  effektiveMedien,
  isoZuOffset,
  LEERES_OVERLAY,
  materialisiereModi,
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

  it('interpoliert Grenzen zwischen Stützpunkten auf die Linie', () => {
    // Ohne Interpolation gehörte die ganze Kante 300→600 noch dem alten Modus —
    // Ziehen rastete optisch nur an Punkten ein.
    const out = zerlegeFuerAnzeige(segmente(), mitModusGrenze(LEERES_OVERLAY, iso(450), 'ferry'), START)
    expect(out.map((a) => a.mode)).toEqual(['walk', 'ferry'])
    expect(out[0]?.pts.map((p) => p[3])).toEqual([0, 300, 450])
    expect(out[1]?.pts.map((p) => p[3])).toEqual([450, 600, 900])
    const schnitt = out[0]?.pts[out[0].pts.length - 1]
    expect(schnitt?.[0]).toBeCloseTo(7.905 + (7.91 - 7.905) * 0.5, 8)
    expect(schnitt?.[1]).toBeCloseTo(46.505 + (46.51 - 46.505) * 0.5, 8)
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

  it('führt gleiche Modi über Tempo-Segmentnähte zusammen (keine Doppel-Bänder)', () => {
    // Tempo-Automatik liefert getrennte Segmente. Nach materialisiereModi die
    // Walk-Grenze von 300 auf 450 schieben: ohne Merge lägen zwei Moped-Bänder
    // an der alten Naht (t=300) — optisch verdoppelt, ohne Kante dazwischen.
    const erkannt: EditorSegment[] = [
      { mode: 'moped', pts: [[7.9, 46.5, 800, 0], [7.905, 46.505, 805, 300]] },
      { mode: 'walk', pts: [[7.905, 46.505, 805, 300], [7.91, 46.51, 810, 600]] },
      { mode: 'moped', pts: [[7.91, 46.51, 810, 600], [7.915, 46.515, 815, 900]] },
    ]
    const edits = mitModusGrenze(
      mitModusGrenze(mitModusGrenze(LEERES_OVERLAY, iso(0), 'moped'), iso(450), 'walk'),
      iso(600),
      'moped',
    )
    const out = zerlegeFuerAnzeige(erkannt, edits, START)
    expect(out.map((a) => [a.mode, a.pts.map((p) => p[3])])).toEqual([
      ['moped', [0, 300, 450]],
      ['walk', [450, 600]],
      ['moped', [600, 900]],
    ])
  })
})

describe('materialisiereModi', () => {
  // Mehrere Segmente = die Aufteilung, die der Server aus dem Tempo erkannt hat.
  const erkannt = (): EditorSegment[] => [
    { mode: 'moped', pts: [[7.9, 46.5, 800, 0], [7.905, 46.505, 805, 300]] },
    { mode: 'walk', pts: [[7.905, 46.505, 805, 300], [7.91, 46.51, 810, 600]] },
    { mode: 'moped', pts: [[7.91, 46.51, 810, 600], [7.915, 46.515, 815, 900]] },
  ]

  it('schreibt die erkannte Aufteilung als Grenzen fest', () => {
    const out = materialisiereModi(LEERES_OVERLAY, erkannt(), START)
    expect(out.modi).toEqual([
      { ab: iso(0), mode: 'moped' },
      { ab: iso(300), mode: 'walk' },
      { ab: iso(600), mode: 'moped' },
    ])
  })

  it('ändert an der sichtbaren Aufteilung nichts', () => {
    // Der Punkt der ganzen Übung: erst danach lässt sich EINE Kante bewegen,
    // ohne dass die folgenden Abschnitte mitgerissen werden.
    const vorher = zerlegeFuerAnzeige(erkannt(), LEERES_OVERLAY, START)
    const nachher = zerlegeFuerAnzeige(erkannt(), materialisiereModi(LEERES_OVERLAY, erkannt(), START), START)
    expect(nachher.map((a) => [a.mode, a.pts.map((p) => p[3])])).toEqual(
      vorher.map((a) => [a.mode, a.pts.map((p) => p[3])]),
    )
  })

  it('ist idempotent', () => {
    const einmal = materialisiereModi(LEERES_OVERLAY, erkannt(), START)
    expect(materialisiereModi(einmal, erkannt(), START).modi).toEqual(einmal.modi)
  })

  it('behält vorhandene Grenzen bei und ergänzt die erkannten', () => {
    const mit = mitModusGrenze(LEERES_OVERLAY, iso(450), 'ferry')
    const out = materialisiereModi(mit, erkannt(), START)
    expect(out.modi).toEqual([
      { ab: iso(0), mode: 'moped' },
      { ab: iso(300), mode: 'walk' },
      { ab: iso(600), mode: 'ferry' }, // ab 450 gilt ferry — beim nächsten Punkt sichtbar
    ])
  })

  it('lässt andere Overlay-Teile unberührt', () => {
    const mit = mitTrim(LEERES_OVERLAY, 'start', iso(300))
    expect(materialisiereModi(mit, erkannt(), START).trim).toEqual({ start: iso(300) })
  })

  it('liefert bei leerer Aufzeichnung das Overlay unverändert', () => {
    expect(materialisiereModi(LEERES_OVERLAY, [], START)).toBe(LEERES_OVERLAY)
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
