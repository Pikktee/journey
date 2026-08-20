// Editor-Modell (M7): reine Logik des Studio-Editors (src/studio/editmodell.ts).
// Die Karten-/DOM-Verdrahtung (editor.ts) läuft im Browser-E2E, nicht hier.

import { describe, expect, it } from 'vitest'
import {
  effectiveMedia,
  thumbnailSource,
  isoToOffset,
  EMPTY_OVERLAY,
  materializeTravelModes,
  withMediaEdit,
  withTravelModeBoundary,
  withTourTrim,
  nearestPointIndex,
  offsetToIso,
  withoutTravelModeBoundary,
  validateOverlay,
  splitForDisplay,
  type EditorSegment,
  type MediaBase,
  type TrackPoint,
} from '../src/studio/editmodell'

const START = '2026-07-04T08:00:00Z'
const iso = (s: number): string => offsetToIso(START, s)

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
  it('offsetToIso/isoToOffset sind Umkehrfunktionen', () => {
    expect(offsetToIso(START, 600)).toBe('2026-07-04T08:10:00Z')
    expect(isoToOffset(START, '2026-07-04T08:10:00Z')).toBe(600)
  })
})

describe('nearestPointIndex', () => {
  it('findet den nächstgelegenen Trackpunkt', () => {
    const pts = segmente()[0]!.pts
    expect(nearestPointIndex(pts, 7.906, 46.506)).toBe(1)
    expect(nearestPointIndex(pts, 7.999, 46.599)).toBe(3)
  })
})

describe('Overlay-Mutationen', () => {
  it('withMediaEdit merged, räumt Leeres weg und bleibt immutabel', () => {
    const a = withMediaEdit(EMPTY_OVERLAY, 'm1', { caption: 'Hallo' })
    expect(a.media?.['m1']).toEqual({ caption: 'Hallo' })
    expect(EMPTY_OVERLAY.media).toBeUndefined()

    const b = withMediaEdit(a, 'm1', { anchor: [7.9, 46.5] })
    expect(b.media?.['m1']).toEqual({ caption: 'Hallo', anchor: [7.9, 46.5] })

    // caption: undefined entfernt den Override, removed: false ebenso
    const c = withMediaEdit(b, 'm1', { caption: undefined, anchor: undefined })
    expect(c.media).toBeUndefined()
    const d = withMediaEdit(withMediaEdit(EMPTY_OVERLAY, 'm1', { removed: true }), 'm1', {
      removed: false,
    })
    expect(d.media).toBeUndefined()
  })

  it('withTravelModeBoundary ersetzt gleiche Zeitpunkte und sortiert', () => {
    const a = withTravelModeBoundary(
      withTravelModeBoundary(EMPTY_OVERLAY, iso(600), 'ferry'),
      iso(300),
      'tram',
    )
    expect(a.travelModes?.map((g) => g.mode)).toEqual(['tram', 'ferry'])
    const b = withTravelModeBoundary(a, iso(600), 'walk')
    expect(b.travelModes?.map((g) => g.mode)).toEqual(['tram', 'walk'])
    expect(
      withoutTravelModeBoundary(withoutTravelModeBoundary(b, iso(300)), iso(600)).travelModes,
    ).toBeUndefined()
  })

  it('withTourTrim setzt und entfernt Kanten', () => {
    const a = withTourTrim(EMPTY_OVERLAY, 'start', iso(300))
    expect(a.trim).toEqual({ start: iso(300) })
    expect(withTourTrim(a, 'start', null).trim).toBeUndefined()
    expect(validateOverlay(withTourTrim(a, 'end', iso(100)))).toMatch(/Trim-Start/)
    expect(validateOverlay(withTourTrim(a, 'end', iso(900)))).toBeNull()
  })
})

describe('splitForDisplay', () => {
  it('teilt an Modus-Grenzen mit geteiltem Randpunkt (alte Gruppe besitzt den Verbinder)', () => {
    const out = splitForDisplay(
      segmente(),
      withTravelModeBoundary(EMPTY_OVERLAY, iso(600), 'ferry'),
      START,
    )
    expect(out.map((a) => a.mode)).toEqual(['walk', 'ferry'])
    // walk endet AM Grenzpunkt (t=600), ferry beginnt dort — Linie bleibt verbunden
    expect(out[0]?.pts.map((p) => p[3])).toEqual([0, 300, 600])
    expect(out[1]?.pts.map((p) => p[3])).toEqual([600, 900])
  })

  it('interpoliert Grenzen zwischen Stützpunkten auf die Linie', () => {
    // Ohne Interpolation gehörte die ganze Kante 300→600 noch dem alten Modus —
    // Ziehen rastete optisch nur an Punkten ein.
    const out = splitForDisplay(
      segmente(),
      withTravelModeBoundary(EMPTY_OVERLAY, iso(450), 'ferry'),
      START,
    )
    expect(out.map((a) => a.mode)).toEqual(['walk', 'ferry'])
    expect(out[0]?.pts.map((p) => p[3])).toEqual([0, 300, 450])
    expect(out[1]?.pts.map((p) => p[3])).toEqual([450, 600, 900])
    const schnitt = out[0]?.pts[out[0].pts.length - 1]
    expect(schnitt?.[0]).toBeCloseTo(7.905 + (7.91 - 7.905) * 0.5, 8)
    expect(schnitt?.[1]).toBeCloseTo(46.505 + (46.51 - 46.505) * 0.5, 8)
  })

  it('markiert getrimmte Bereiche als inaktiv (Verbinder wird grau)', () => {
    const edits = withTourTrim(withTourTrim(EMPTY_OVERLAY, 'start', iso(300)), 'end', iso(600))
    const out = splitForDisplay(segmente(), edits, START)
    expect(out.map((a) => [a.active, a.pts.map((p) => p[3])])).toEqual([
      [false, [0, 300]], // vor dem Trim-Start: grau bis einschließlich Eintrittspunkt
      [true, [300, 600]], // aktive Spanne
      [false, [600, 900]], // nach dem Trim-Ende: Verbinder gehört der grauen Gruppe
    ])
  })

  it('liefert ohne Overlay einen einzigen aktiven Abschnitt', () => {
    const out = splitForDisplay(segmente(), EMPTY_OVERLAY, START)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ mode: 'walk', active: true })
    expect(out[0]?.pts).toHaveLength(4)
  })

  it('führt gleiche Modi über Tempo-Segmentnähte zusammen (keine Doppel-Bänder)', () => {
    // Tempo-Automatik liefert getrennte Segmente. Nach materializeTravelModes die
    // Walk-Grenze von 300 auf 450 schieben: ohne Merge lägen zwei Moped-Bänder
    // an der alten Naht (t=300) — optisch verdoppelt, ohne Kante dazwischen.
    const erkannt: EditorSegment[] = [
      {
        mode: 'moped',
        pts: [
          [7.9, 46.5, 800, 0],
          [7.905, 46.505, 805, 300],
        ],
      },
      {
        mode: 'walk',
        pts: [
          [7.905, 46.505, 805, 300],
          [7.91, 46.51, 810, 600],
        ],
      },
      {
        mode: 'moped',
        pts: [
          [7.91, 46.51, 810, 600],
          [7.915, 46.515, 815, 900],
        ],
      },
    ]
    const edits = withTravelModeBoundary(
      withTravelModeBoundary(
        withTravelModeBoundary(EMPTY_OVERLAY, iso(0), 'moped'),
        iso(450),
        'walk',
      ),
      iso(600),
      'moped',
    )
    const out = splitForDisplay(erkannt, edits, START)
    expect(out.map((a) => [a.mode, a.pts.map((p) => p[3])])).toEqual([
      ['moped', [0, 300, 450]],
      ['walk', [450, 600]],
      ['moped', [600, 900]],
    ])
  })
})

describe('materializeTravelModes', () => {
  // Mehrere Segmente = die Aufteilung, die der Server aus dem Tempo erkannt hat.
  const erkannt = (): EditorSegment[] => [
    {
      mode: 'moped',
      pts: [
        [7.9, 46.5, 800, 0],
        [7.905, 46.505, 805, 300],
      ],
    },
    {
      mode: 'walk',
      pts: [
        [7.905, 46.505, 805, 300],
        [7.91, 46.51, 810, 600],
      ],
    },
    {
      mode: 'moped',
      pts: [
        [7.91, 46.51, 810, 600],
        [7.915, 46.515, 815, 900],
      ],
    },
  ]

  it('schreibt die erkannte Aufteilung als Grenzen fest', () => {
    const out = materializeTravelModes(EMPTY_OVERLAY, erkannt(), START)
    expect(out.travelModes).toEqual([
      { from: iso(0), mode: 'moped' },
      { from: iso(300), mode: 'walk' },
      { from: iso(600), mode: 'moped' },
    ])
  })

  it('ändert an der sichtbaren Aufteilung nichts', () => {
    // Der Punkt der ganzen Übung: erst danach lässt sich EINE Kante bewegen,
    // ohne dass die folgenden Abschnitte mitgerissen werden.
    const vorher = splitForDisplay(erkannt(), EMPTY_OVERLAY, START)
    const nachher = splitForDisplay(
      erkannt(),
      materializeTravelModes(EMPTY_OVERLAY, erkannt(), START),
      START,
    )
    expect(nachher.map((a) => [a.mode, a.pts.map((p) => p[3])])).toEqual(
      vorher.map((a) => [a.mode, a.pts.map((p) => p[3])]),
    )
  })

  it('ist idempotent', () => {
    const einmal = materializeTravelModes(EMPTY_OVERLAY, erkannt(), START)
    expect(materializeTravelModes(einmal, erkannt(), START).travelModes).toEqual(einmal.travelModes)
  })

  it('behält vorhandene Grenzen bei und ergänzt die erkannten', () => {
    const mit = withTravelModeBoundary(EMPTY_OVERLAY, iso(450), 'ferry')
    const out = materializeTravelModes(mit, erkannt(), START)
    expect(out.travelModes).toEqual([
      { from: iso(0), mode: 'moped' },
      { from: iso(300), mode: 'walk' },
      { from: iso(600), mode: 'ferry' }, // ab 450 gilt ferry — beim nächsten Punkt sichtbar
    ])
  })

  it('lässt andere Overlay-Teile unberührt', () => {
    const mit = withTourTrim(EMPTY_OVERLAY, 'start', iso(300))
    expect(materializeTravelModes(mit, erkannt(), START).trim).toEqual({ start: iso(300) })
  })

  it('liefert bei leerer Aufzeichnung das Overlay unverändert', () => {
    expect(materializeTravelModes(EMPTY_OVERLAY, [], START)).toBe(EMPTY_OVERLAY)
  })
})

describe('effectiveMedia', () => {
  const basis = (): MediaBase[] => [
    {
      id: 'm1',
      type: 'photo',
      src: '/a.jpg',
      takenAt: iso(300),
      caption: 'Alt',
      anchor: [7.9, 46.5],
      placement: 'gps',
    },
    {
      id: 'm2',
      type: 'photo',
      src: '/b.jpg',
      takenAt: iso(600),
      caption: '',
      anchor: null,
      placement: 'unplaced',
    },
  ]

  it('legt Overrides über die Auto-Platzierung; Gelöschte bleiben markiert drin', () => {
    const edits = withMediaEdit(withMediaEdit(EMPTY_OVERLAY, 'm1', { removed: true }), 'm2', {
      anchor: [7.91, 46.51],
      caption: 'Neu',
    })
    const [m1, m2] = effectiveMedia(basis(), edits)
    expect(m1).toMatchObject({ removed: true, caption: 'Alt', placement: 'gps' })
    expect(m2).toMatchObject({
      removed: false,
      caption: 'Neu',
      placement: 'manual',
      anchor: [7.91, 46.51],
    })
  })

  it('ist ohne Overlay die Basis mit geloescht=false', () => {
    const out = effectiveMedia(basis(), EMPTY_OVERLAY)
    expect(out.map((m) => m.removed)).toEqual([false, false])
    expect(out[0]?.placement).toBe('gps')
  })
})

// Verhindert stilles Auseinanderlaufen von Anzeige-Logik (Client) und
// Render-Logik (Server): ein Punkt exakt auf der Trim-Kante zählt als active.
describe('Trim-Kanten-Semantik (inklusiv, wie serverseitig)', () => {
  it('behandelt die Kantenpunkte als Teil der aktiven Spanne', () => {
    const edits = withTourTrim(withTourTrim(EMPTY_OVERLAY, 'start', iso(0)), 'end', iso(900))
    const out = splitForDisplay(segmente(), edits, START)
    expect(out).toHaveLength(1)
    expect(out[0]?.active).toBe(true)
  })
})

describe('thumbnailSource', () => {
  const foto = {
    type: 'photo' as const,
    src: '/api/media/t1/m1.w1920.jpg',
    thumb: '/api/media/t1/m1.t480.jpg',
  }
  const video = {
    type: 'video' as const,
    src: '/api/media/t1/m2.web.mp4',
    poster: '/api/media/t1/m2.poster.jpg',
    thumb: '/api/media/t1/m2.t480.jpg',
  }

  it('nimmt die Kachel-Fassung, wo es sie gibt', () => {
    expect(thumbnailSource(foto)).toBe('/api/media/t1/m1.t480.jpg')
    expect(thumbnailSource(video)).toBe('/api/media/t1/m2.t480.jpg')
  })

  it('fällt bei Altbestand auf das vorhandene Bild zurück — lieber groß als gar nicht', () => {
    const { thumb: _f, ...fotoAlt } = foto
    const { thumb: _v, ...videoAlt } = video
    expect(thumbnailSource(fotoAlt)).toBe('/api/media/t1/m1.w1920.jpg')
    expect(thumbnailSource(videoAlt)).toBe('/api/media/t1/m2.poster.jpg')
  })

  it('nimmt für ein Video ohne Standbild die Videodatei — nie ein leeres src', () => {
    expect(thumbnailSource({ type: 'video', src: '/api/media/t1/m3.mp4' })).toBe(
      '/api/media/t1/m3.mp4',
    )
  })
})
