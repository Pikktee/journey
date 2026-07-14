// Edit-Overlay (M7): Trim, Modus-Grenzen und Medien-Overrides als reine
// Funktionen über den Rohdaten — plus ein reichereAn-Durchstich, der die
// Plan-Kriterien prüft („Trim verschiebt keine Anker", Edits im Tour-JSON).

import { describe, expect, it } from 'vitest'
import {
  wendeEditsAufSegmenteAn,
  wendeMedienEditsAn,
  wendeModiAn,
  wendeTrimAn,
} from '../src/pipeline/edits.js'
import { reichereAn } from '../src/pipeline/enrich.js'
import { FesterGeocoder } from '../src/pipeline/naming.js'
import type { PlatziertesMedium } from '../src/pipeline/placement.js'
import { pruefeEditsSemantik, type EditOverlay } from '../src/schema/edits.js'
import type { UploadManifest, UploadSegment } from '../src/schema/upload.js'

const START_MS = Date.parse('2026-07-04T08:00:00Z')
const iso = (offsetS: number): string => new Date(START_MS + offsetS * 1000).toISOString()

/** 2 Segmente à 4 Punkte; Offsets 0–900 (walk) und 900–1800 (bike, Label). */
const segmente = (): UploadSegment[] => [
  {
    mode: 'walk',
    pts: [
      [7.9, 46.5, 800, 0],
      [7.905, 46.505, 805, 300],
      [7.91, 46.51, 810, 600],
      [7.915, 46.515, 815, 900],
    ],
  },
  {
    mode: 'bike',
    label: 'Talfahrt',
    pts: [
      [7.915, 46.515, 815, 900],
      [7.92, 46.52, 700, 1200],
      [7.925, 46.525, 650, 1500],
      [7.93, 46.53, 600, 1800],
    ],
  },
]

describe('wendeTrimAn', () => {
  it('behält nur Punkte innerhalb der Trim-Spanne', () => {
    const out = wendeTrimAn(segmente(), { start: iso(300), ende: iso(1200) }, START_MS)
    expect(out).toHaveLength(2)
    expect(out[0]?.pts.map((p) => p[3])).toEqual([300, 600, 900])
    expect(out[1]?.pts.map((p) => p[3])).toEqual([900, 1200])
  })

  it('lässt Segmente mit < 2 Restpunkten fallen', () => {
    const out = wendeTrimAn(segmente(), { ende: iso(600) }, START_MS)
    expect(out).toHaveLength(1)
    expect(out[0]?.mode).toBe('walk')
  })

  it('ist ohne Trim eine Kopie', () => {
    expect(wendeTrimAn(segmente(), undefined, START_MS)).toEqual(segmente())
  })

  it('kann alles entfernen (leeres Ergebnis, Fehler wirft die Pipeline)', () => {
    expect(wendeTrimAn(segmente(), { start: iso(9000) }, START_MS)).toEqual([])
  })
})

describe('wendeModiAn', () => {
  it('zerschneidet am Grenzpunkt mit GETEILTEM Übergabepunkt (main.js verkettet via slice(1))', () => {
    const out = wendeModiAn(segmente(), [{ ab: iso(600), mode: 'ferry' }], START_MS)
    expect(out.map((s) => s.mode)).toEqual(['walk', 'ferry', 'ferry'])
    // Grenzpunkt t=600 schließt walk ab UND eröffnet ferry — kein Punktverlust
    expect(out[0]?.pts.map((p) => p[3])).toEqual([0, 300, 600])
    expect(out[1]?.pts.map((p) => p[3])).toEqual([600, 900])
    // Original-Label „Talfahrt" gehörte zum bike-Segment → beim Umstellen weg
    expect(out[2]?.label).toBeUndefined()
  })

  it('setzt vor der ersten Grenze den Original-Modus fort und wechselt danach mehrfach', () => {
    const out = wendeModiAn(
      segmente(),
      [
        { ab: iso(600), mode: 'ferry' },
        { ab: iso(1200), mode: 'walk' },
      ],
      START_MS,
    )
    expect(out.map((s) => s.mode)).toEqual(['walk', 'ferry', 'ferry', 'walk'])
    expect(out[2]?.pts.map((p) => p[3])).toEqual([900, 1200])
    expect(out[3]?.pts.map((p) => p[3])).toEqual([1200, 1500, 1800])
  })

  it('gilt ab Grenze VOR dem Track-Start für alles', () => {
    const out = wendeModiAn(segmente(), [{ ab: iso(-600), mode: 'tram' }], START_MS)
    expect(out.map((s) => s.mode)).toEqual(['tram', 'tram'])
  })

  it('erlaubt eine Grenze am letzten Punkt (1-Punkt-Scheibe, Punkt bleibt geteilt)', () => {
    const out = wendeModiAn(segmente(), [{ ab: iso(1800), mode: 'tram' }], START_MS)
    expect(out.map((s) => s.mode)).toEqual(['walk', 'bike', 'tram'])
    expect(out[1]?.pts).toHaveLength(4) // bike behält seinen Endpunkt
    expect(out[1]?.label).toBe('Talfahrt')
    expect(out[2]?.pts.map((p) => p[3])).toEqual([1800])
  })

  it('entfernt redundante 1-Punkt-Scheiben am Segment-Übergabepunkt', () => {
    // Grenze exakt auf dem geteilten Punkt t=900: die 1-Punkt-ferry-Scheibe
    // aus seg1 ist im ferry-gewordenen seg2 bereits enthalten
    const out = wendeModiAn(segmente(), [{ ab: iso(900), mode: 'ferry' }], START_MS)
    expect(out.map((s) => s.mode)).toEqual(['walk', 'ferry'])
    expect(out[0]?.pts.map((p) => p[3])).toEqual([0, 300, 600, 900])
    expect(out[1]?.pts.map((p) => p[3])).toEqual([900, 1200, 1500, 1800])
  })

  it('ist ohne Grenzen eine Kopie', () => {
    expect(wendeModiAn(segmente(), [], START_MS)).toEqual(segmente())
  })
})

describe('wendeMedienEditsAn', () => {
  const platziert = (): PlatziertesMedium[] => [
    {
      medium: { id: 'm1', type: 'photo', file: 'a.jpg', takenAt: iso(300), caption: 'Original' },
      anchor: [7.905, 46.505],
      placement: 'gps',
    },
    {
      medium: { id: 'm2', type: 'photo', file: 'b.jpg', takenAt: iso(600) },
      anchor: null,
      placement: 'unplatziert',
    },
  ]

  it('entfernt gelöschte, übersteuert Caption und setzt manuelle Anker', () => {
    const edits: EditOverlay = {
      schema: 'luhambo/edits@1',
      medien: {
        m1: { caption: '' },
        m2: { anchor: [7.91, 46.51] },
      },
    }
    const out = wendeMedienEditsAn(platziert(), edits)
    expect(out[0]?.medium.caption).toBe('')
    expect(out[0]?.placement).toBe('gps') // Anker unangetastet
    expect(out[1]?.anchor).toEqual([7.91, 46.51])
    expect(out[1]?.placement).toBe('manuell')

    const geloescht = wendeMedienEditsAn(platziert(), {
      schema: 'luhambo/edits@1',
      medien: { m1: { geloescht: true } },
    })
    expect(geloescht.map((p) => p.medium.id)).toEqual(['m2'])
  })

  it('ist ohne Overlay eine Kopie', () => {
    expect(wendeMedienEditsAn(platziert(), null)).toEqual(platziert())
  })
})

describe('pruefeEditsSemantik', () => {
  it('akzeptiert Gültiges und meldet kaputte Zeiten/Spannen', () => {
    expect(pruefeEditsSemantik({ schema: 'luhambo/edits@1' })).toBeNull()
    expect(
      pruefeEditsSemantik({ schema: 'luhambo/edits@1', trim: { start: iso(0), ende: iso(600) } }),
    ).toBeNull()
    expect(
      pruefeEditsSemantik({ schema: 'luhambo/edits@1', trim: { start: iso(600), ende: iso(600) } }),
    ).toMatch(/Trim-Start/)
    expect(
      pruefeEditsSemantik({ schema: 'luhambo/edits@1', modi: [{ ab: '2026-13-99T99:99:99Z', mode: 'walk' }] }),
    ).toMatch(/Modus-Grenze/)
    // JSON.parse('1e999') → Infinity rutscht am Ajv-Typ "number" vorbei
    expect(
      pruefeEditsSemantik({ schema: 'luhambo/edits@1', medien: { m1: { anchor: [Infinity, 46.5] } } }),
    ).toMatch(/Anker/)
  })
})

describe('reichereAn mit Edit-Overlay', () => {
  const manifest = (): UploadManifest => ({
    schema: 'luhambo/upload@1',
    title: null,
    description: null,
    time: { start: iso(0), end: iso(1800), zone: 'UTC' },
    segments: segmente(),
    media: [
      // GPS-Anker exakt auf dem Trackpunkt bei t=600
      { id: 'm1', type: 'photo', file: 'a.jpg', takenAt: iso(600), anchor: [7.91, 46.51], caption: 'Alt' },
      { id: 'm2', type: 'photo', file: 'b.jpg', takenAt: iso(1200) },
    ],
  })

  const eingabe = (edits: EditOverlay | null) => ({
    tourId: 't1',
    nummer: 1,
    manifest: manifest(),
    titelOverride: null,
    beschreibungOverride: null,
    ...(edits ? { edits } : {}),
    geocoder: new FesterGeocoder(['Start', 'Ziel']),
  })

  it('Trim verschiebt keine Anker; Modus/Caption/Löschung erreichen das Tour-JSON', async () => {
    const ohne = await reichereAn(eingabe(null))
    const mit = await reichereAn(
      eingabe({
        schema: 'luhambo/edits@1',
        trim: { start: iso(300) },
        modi: [{ ab: iso(900), mode: 'ferry' }],
        medien: { m1: { caption: 'Neu' }, m2: { geloescht: true } },
      }),
    )

    // Anker hängt an der Koordinate, nicht an f → durch den Trim unverändert
    expect(mit.media[0]?.anchor).toEqual(ohne.media[0]?.anchor)
    expect(mit.media[0]?.placement).toBe('gps')
    expect(mit.media[0]?.caption).toBe('Neu')
    // Gelöschtes Medium fehlt in der Wiedergabe
    expect(mit.media.map((m) => m.id)).toEqual(['m1'])
    // Modus-Grenze: ab t=900 Fähre
    expect(mit.segments.map((s) => s.mode)).toEqual(['walk', 'ferry'])
    // Trim: der erste Punkt (t=0) ist weg → Tour ist kürzer
    expect(mit.stats.km).toBeLessThan(ohne.stats.km)
  })

  it('wirft, wenn der Trim den kompletten Track entfernt', async () => {
    await expect(
      reichereAn(eingabe({ schema: 'luhambo/edits@1', trim: { start: iso(90000) } })),
    ).rejects.toThrow(/Kein Track/)
  })
})
