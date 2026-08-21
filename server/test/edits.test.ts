// Edit-Overlay (M7): Trim, Modus-Grenzen und Medien-Overrides als reine
// Funktionen über den Rohdaten — plus ein reichereAn-Durchstich, der die
// Plan-Kriterien prüft („Trim verschiebt keine Anker", Edits im Tour-JSON).

import { describe, expect, it } from 'vitest'
import {
  applyEditsToSegments,
  applyMediaEdits,
  applyTravelModes,
  applyTourTrim,
} from '../src/pipeline/edits.js'
import { enrichTour } from '../src/pipeline/enrich.js'
import { FixedGeocoder } from '../src/pipeline/naming.js'
import type { PlacedMedium } from '../src/pipeline/placement.js'
import { validateEditsSemantics, STUDIO_GAIN, type EditOverlay } from '../src/schema/edits.js'
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
    const out = applyTourTrim(segmente(), { start: iso(300), end: iso(1200) }, START_MS)
    expect(out).toHaveLength(2)
    expect(out[0]?.pts.map((p) => p[3])).toEqual([300, 600, 900])
    expect(out[1]?.pts.map((p) => p[3])).toEqual([900, 1200])
  })

  it('lässt Segmente mit < 2 Restpunkten fallen', () => {
    const out = applyTourTrim(segmente(), { end: iso(600) }, START_MS)
    expect(out).toHaveLength(1)
    expect(out[0]?.mode).toBe('walk')
  })

  it('ist ohne Trim eine Kopie', () => {
    expect(applyTourTrim(segmente(), undefined, START_MS)).toEqual(segmente())
  })

  it('kann alles entfernen (leeres Ergebnis, Fehler wirft die Pipeline)', () => {
    expect(applyTourTrim(segmente(), { start: iso(9000) }, START_MS)).toEqual([])
  })
})

describe('wendeModiAn', () => {
  it('zerschneidet am Grenzpunkt mit GETEILTEM Übergabepunkt (main.js verkettet via slice(1))', () => {
    const out = applyTravelModes(segmente(), [{ from: iso(600), mode: 'ferry' }], START_MS)
    expect(out.map((s) => s.mode)).toEqual(['walk', 'ferry', 'ferry'])
    // Grenzpunkt t=600 schließt walk ab UND eröffnet ferry — kein Punktverlust
    expect(out[0]?.pts.map((p) => p[3])).toEqual([0, 300, 600])
    expect(out[1]?.pts.map((p) => p[3])).toEqual([600, 900])
    // Original-Label „Talfahrt" gehörte zum bike-Segment → beim Umstellen weg
    expect(out[2]?.label).toBeUndefined()
  })

  it('setzt vor der ersten Grenze den Original-Modus fort und wechselt danach mehrfach', () => {
    const out = applyTravelModes(
      segmente(),
      [
        { from: iso(600), mode: 'ferry' },
        { from: iso(1200), mode: 'walk' },
      ],
      START_MS,
    )
    expect(out.map((s) => s.mode)).toEqual(['walk', 'ferry', 'ferry', 'walk'])
    expect(out[2]?.pts.map((p) => p[3])).toEqual([900, 1200])
    expect(out[3]?.pts.map((p) => p[3])).toEqual([1200, 1500, 1800])
  })

  it('gilt ab Grenze VOR dem Track-Start für alles', () => {
    const out = applyTravelModes(segmente(), [{ from: iso(-600), mode: 'tram' }], START_MS)
    expect(out.map((s) => s.mode)).toEqual(['tram', 'tram'])
  })

  it('erlaubt eine Grenze am letzten Punkt (1-Punkt-Scheibe, Punkt bleibt geteilt)', () => {
    const out = applyTravelModes(segmente(), [{ from: iso(1800), mode: 'tram' }], START_MS)
    expect(out.map((s) => s.mode)).toEqual(['walk', 'bike', 'tram'])
    expect(out[1]?.pts).toHaveLength(4) // bike behält seinen Endpunkt
    expect(out[1]?.label).toBe('Talfahrt')
    expect(out[2]?.pts.map((p) => p[3])).toEqual([1800])
  })

  it('entfernt redundante 1-Punkt-Scheiben am Segment-Übergabepunkt', () => {
    // Grenze exakt auf dem geteilten Punkt t=900: die 1-Punkt-ferry-Scheibe
    // aus seg1 ist im ferry-gewordenen seg2 bereits enthalten
    const out = applyTravelModes(segmente(), [{ from: iso(900), mode: 'ferry' }], START_MS)
    expect(out.map((s) => s.mode)).toEqual(['walk', 'ferry'])
    expect(out[0]?.pts.map((p) => p[3])).toEqual([0, 300, 600, 900])
    expect(out[1]?.pts.map((p) => p[3])).toEqual([900, 1200, 1500, 1800])
  })

  it('ist ohne Grenzen eine Kopie', () => {
    expect(applyTravelModes(segmente(), [], START_MS)).toEqual(segmente())
  })
})

describe('wendeMedienEditsAn', () => {
  const platziert = (): PlacedMedium[] => [
    {
      medium: { id: 'm1', type: 'photo', file: 'a.jpg', takenAt: iso(300), caption: 'Original' },
      anchor: [7.905, 46.505],
      placement: 'gps',
    },
    {
      medium: { id: 'm2', type: 'photo', file: 'b.jpg', takenAt: iso(600) },
      anchor: null,
      placement: 'unplaced',
    },
  ]

  it('entfernt gelöschte, übersteuert Caption und setzt manuelle Anker', () => {
    const edits: EditOverlay = {
      schema: 'maptale/edits@2',
      media: {
        m1: { caption: '' },
        m2: { anchor: [7.91, 46.51] },
      },
    }
    const out = applyMediaEdits(platziert(), edits)
    expect(out[0]?.medium.caption).toBe('')
    expect(out[0]?.placement).toBe('gps') // Anker unangetastet
    expect(out[1]?.anchor).toEqual([7.91, 46.51])
    expect(out[1]?.placement).toBe('manual')

    const geloescht = applyMediaEdits(platziert(), {
      schema: 'maptale/edits@2',
      media: { m1: { removed: true } },
    })
    expect(geloescht.map((p) => p.medium.id)).toEqual(['m2'])
  })

  it('ist ohne Overlay eine Kopie', () => {
    expect(applyMediaEdits(platziert(), null)).toEqual(platziert())
  })
})

describe('pruefeEditsSemantik', () => {
  it('akzeptiert Gültiges und meldet kaputte Zeiten/Spannen', () => {
    expect(validateEditsSemantics({ schema: 'maptale/edits@2' })).toBeNull()
    expect(
      validateEditsSemantics({ schema: 'maptale/edits@2', trim: { start: iso(0), end: iso(600) } }),
    ).toBeNull()
    expect(
      validateEditsSemantics({
        schema: 'maptale/edits@2',
        trim: { start: iso(600), end: iso(600) },
      }),
    ).toMatch(/Trim-Start/)
    expect(
      validateEditsSemantics({
        schema: 'maptale/edits@2',
        travelModes: [{ from: '2026-13-99T99:99:99Z', mode: 'walk' }],
      }),
    ).toMatch(/Modus-Grenze/)
    // JSON.parse('1e999') → Infinity rutscht am Ajv-Typ "number" vorbei
    expect(
      validateEditsSemantics({
        schema: 'maptale/edits@2',
        media: { m1: { anchor: [Infinity, 46.5] } },
      }),
    ).toMatch(/Anker/)
  })

  it('prüft Kamera-Grenzen (Baukasten)', () => {
    expect(
      validateEditsSemantics({
        schema: 'maptale/edits@2',
        camera: [{ from: iso(0), preset: 'near' }],
      }),
    ).toBeNull()
    expect(
      validateEditsSemantics({
        schema: 'maptale/edits@2',
        camera: [{ from: '2026-13-99T99:99:99Z', preset: 'near' }],
      }),
    ).toMatch(/Kamera-Grenze/)
  })

  it('prüft Audio-Einträge: Zeiten, Spanne, bis nur bei Musik, Lautstärke endlich', () => {
    const basis = { file: 'a1.mp3', from: iso(0) } as const
    expect(
      validateEditsSemantics({
        schema: 'maptale/edits@2',
        audio: [{ ...basis, type: 'music', to: iso(600), volume: 0.5 }],
      }),
    ).toBeNull()
    expect(
      validateEditsSemantics({ schema: 'maptale/edits@2', audio: [{ ...basis, type: 'sfx' }] }),
    ).toBeNull()
    expect(
      validateEditsSemantics({
        schema: 'maptale/edits@2',
        audio: [{ file: 'a1.mp3', type: 'music', from: '2026-13-99T99:99:99Z' }],
      }),
    ).toMatch(/Audio-Start/)
    expect(
      validateEditsSemantics({
        schema: 'maptale/edits@2',
        audio: [{ ...basis, type: 'music', to: '2026-13-99T99:99:99Z' }],
      }),
    ).toMatch(/Audio-Ende/)
    // bis <= ab: leere Spanne
    expect(
      validateEditsSemantics({
        schema: 'maptale/edits@2',
        audio: [{ ...basis, type: 'music', to: iso(0) }],
      }),
    ).toMatch(/Audio-Ende muss nach/)
    expect(
      validateEditsSemantics({
        schema: 'maptale/edits@2',
        audio: [{ ...basis, type: 'sfx', to: iso(600) }],
      }),
    ).toMatch(/nur bei Musik/)
    // JSON.parse('1e999') → Infinity: minimum/maximum fangen das im Schema,
    // die Semantik bleibt trotzdem wasserdicht (Number.isFinite)
    expect(
      validateEditsSemantics({
        schema: 'maptale/edits@2',
        audio: [{ ...basis, type: 'music', volume: Infinity }],
      }),
    ).toMatch(/Lautstärke/)
  })

  it('prüft die Film-Verankerung des Tons (Etappe 4)', () => {
    const basis = { file: 'a1.mp3' as const, from: iso(0), type: 'music' as const }
    expect(
      validateEditsSemantics({
        schema: 'maptale/edits@2',
        audio: [
          { ...basis, anchor: iso(300), offsetFilmS: -2, durationFilmS: 8, startS: 3, loop: false },
        ],
      }),
    ).toBeNull()
    expect(
      validateEditsSemantics({
        schema: 'maptale/edits@2',
        audio: [{ ...basis, anchor: '2026-13-99T99:99:99Z' }],
      }),
    ).toMatch(/Audio-Anker/)
    expect(
      validateEditsSemantics({
        schema: 'maptale/edits@2',
        audio: [{ ...basis, offsetFilmS: Infinity }],
      }),
    ).toMatch(/Audio-Versatz/)
    // Ein Klip ohne Länge ist kein Klip
    expect(
      validateEditsSemantics({
        schema: 'maptale/edits@2',
        audio: [{ ...basis, durationFilmS: 0 }],
      }),
    ).toMatch(/Audio-Länge/)
    expect(
      validateEditsSemantics({
        schema: 'maptale/edits@2',
        audio: [{ ...basis, durationFilmS: -3 }],
      }),
    ).toMatch(/Audio-Länge/)
    // Der linke Trim hat den Dateianfang als Anschlag — auch mit Loop
    expect(
      validateEditsSemantics({
        schema: 'maptale/edits@2',
        audio: [{ ...basis, startS: -1, loop: true }],
      }),
    ).toMatch(/Datei-Einstieg/)
  })

  it('prüft den Video-Schnitt (Etappe 4)', () => {
    const mit = (trim: { fromS: number; toS?: number }): string | null =>
      validateEditsSemantics({ schema: 'maptale/edits@2', media: { m1: { trim } } })
    expect(mit({ fromS: 2, toS: 9 })).toBeNull()
    expect(mit({ fromS: 2 })).toBeNull() // ohne Ende: bis zum Dateiende
    expect(mit({ fromS: -1 })).toMatch(/Video-Schnitt/)
    expect(mit({ fromS: 2, toS: Infinity })).toMatch(/Video-Schnitt/)
    expect(mit({ fromS: 9, toS: 9 })).toMatch(/Video-Schnittende/)
    expect(mit({ fromS: 9, toS: 2 })).toMatch(/Video-Schnittende/)
  })

  it('lehnt einen nicht-ganzzahligen Platz im Stopp ab', () => {
    expect(
      validateEditsSemantics({ schema: 'maptale/edits@2', media: { m1: { order: 0 } } }),
    ).toBeNull()
    expect(
      validateEditsSemantics({ schema: 'maptale/edits@2', media: { m1: { order: 1.5 } } }),
    ).toMatch(/Platz im Stopp/)
    expect(
      validateEditsSemantics({ schema: 'maptale/edits@2', media: { m1: { order: Infinity } } }),
    ).toMatch(/Platz im Stopp/)
  })

  it('prüft display.holdS auf Endlichkeit (Baukasten)', () => {
    expect(
      validateEditsSemantics({
        schema: 'maptale/edits@2',
        media: { m1: { display: { holdS: 8, kenBurns: false } } },
      }),
    ).toBeNull()
    expect(
      validateEditsSemantics({
        schema: 'maptale/edits@2',
        media: { m1: { display: { holdS: Infinity } } },
      }),
    ).toMatch(/Standzeit/)
  })

  it('prüft Wetter-Grenzen: Zeit parsebar, Stärke endlich und in [0,1]', () => {
    expect(
      validateEditsSemantics({
        schema: 'maptale/edits@2',
        weather: [{ from: iso(0), mode: 'rain', intensity: 0.6 }],
      }),
    ).toBeNull()
    expect(
      validateEditsSemantics({
        schema: 'maptale/edits@2',
        weather: [{ from: '2026-13-99T99:99:99Z', mode: 'rain' }],
      }),
    ).toMatch(/Wetter-Grenze/)
    expect(
      validateEditsSemantics({
        schema: 'maptale/edits@2',
        weather: [{ from: iso(0), mode: 'rain', intensity: Infinity }],
      }),
    ).toMatch(/Wetter-Stärke/)
    expect(
      validateEditsSemantics({
        schema: 'maptale/edits@2',
        weather: [{ from: iso(0), mode: 'rain', intensity: 1.5 }],
      }),
    ).toMatch(/Wetter-Stärke/)
  })
})

describe('reichereAn mit Edit-Overlay', () => {
  const manifest = (): UploadManifest => ({
    schema: 'maptale/upload@2',
    title: null,
    description: null,
    time: { start: iso(0), end: iso(1800), zone: 'UTC' },
    segments: segmente(),
    media: [
      // GPS-Anker exakt auf dem Trackpunkt bei t=600
      {
        id: 'm1',
        type: 'photo',
        file: 'a.jpg',
        takenAt: iso(600),
        anchor: [7.91, 46.51],
        caption: 'Alt',
      },
      { id: 'm2', type: 'photo', file: 'b.jpg', takenAt: iso(1200) },
    ],
  })

  const eingabe = (edits: EditOverlay | null) => ({
    tourId: 't1',
    no: 1,
    manifest: manifest(),
    titleOverride: null,
    descriptionOverride: null,
    ...(edits ? { edits } : {}),
    geocoder: new FixedGeocoder(['Start', 'Ziel']),
  })

  it('Trim verschiebt keine Anker; Modus/Caption/Löschung erreichen das Tour-JSON', async () => {
    const ohne = await enrichTour(eingabe(null))
    const mit = await enrichTour(
      eingabe({
        schema: 'maptale/edits@2',
        trim: { start: iso(300) },
        travelModes: [{ from: iso(900), mode: 'ferry' }],
        media: { m1: { caption: 'Neu' }, m2: { removed: true } },
      }),
    )

    // Anker hängt an der Koordinate, nicht an f → durch den Trim unverändert
    expect(mit.media[0]?.anchor).toEqual(ohne.media[0]?.anchor)
    expect(mit.media[0]?.placement).toBe('gps')
    expect(mit.media[0]?.title).toBe('Neu')
    // Gelöschtes Medium fehlt in der Wiedergabe
    expect(mit.media.map((m) => m.id)).toEqual(['m1'])
    // Modus-Grenze: ab t=900 Fähre
    expect(mit.segments.map((s) => s.mode)).toEqual(['walk', 'ferry'])
    // Trim: der erste Punkt (t=0) ist weg → Tour ist kürzer
    expect(mit.stats.km).toBeLessThan(ohne.stats.km)
  })

  it('wirft, wenn der Trim den kompletten Track entfernt', async () => {
    await expect(
      enrichTour(eingabe({ schema: 'maptale/edits@2', trim: { start: iso(90000) } })),
    ).rejects.toThrow(/Kein Track/)
  })

  it('rendert Kamera-Keyframes: ab-Zeit → f, nach f sortiert (Baukasten)', async () => {
    const tour = await enrichTour(
      eingabe({
        schema: 'maptale/edits@2',
        // absichtlich unsortiert übergeben
        camera: [
          { from: iso(900), preset: 'near' },
          { from: iso(0), preset: 'far' },
        ],
      }),
    )
    expect(tour.camera).toHaveLength(2)
    expect(tour.camera?.[0]).toEqual({ f: 0, preset: 'far', filmS: 0 })
    expect(tour.camera?.[1]?.preset).toBe('near')
    // t=900 liegt in der Streckenmitte (gleichförmige Punkte)
    expect(tour.camera?.[1]?.f).toBeGreaterThan(0.4)
    expect(tour.camera?.[1]?.f).toBeLessThan(0.6)
  })

  it('klemmt Kamera-Grenzen vor dem Trim-Start auf f=0 — der spätere ab gewinnt', async () => {
    const tour = await enrichTour(
      eingabe({
        schema: 'maptale/edits@2',
        trim: { start: iso(300) },
        camera: [
          { from: iso(0), preset: 'near' },
          { from: iso(120), preset: 'far' },
        ],
      }),
    )
    // Beide Grenzen liegen vor dem getrimmten Track → beide auf f=0 geklemmt,
    // nur die spätere überlebt (Punktfunktion: sie gilt „ab hier")
    expect(tour.camera).toEqual([{ f: 0, preset: 'far', filmS: 0 }])
  })

  it('verwirft Kamera-Grenzen hinter dem Track-Ende (statt auf f=1 zu klemmen)', async () => {
    const meldungen: string[] = []
    const tour = await enrichTour({
      ...eingabe({
        schema: 'maptale/edits@2',
        camera: [
          { from: iso(600), preset: 'near' },
          { from: iso(3600), preset: 'far' }, // weit hinter dem Track-Ende (t=1800)
        ],
      }),
      log: (m) => meldungen.push(m),
    })
    // Nur die gültige Grenze bleibt; die späte fällt raus (kein Umschalten am Finale)
    expect(tour.camera).toHaveLength(1)
    expect(tour.camera?.[0]?.preset).toBe('near')
    expect(meldungen.some((m) => /Kamera-Grenze hinter dem Track-Ende/.test(m))).toBe(true)
  })

  it('reicht die Kamera-Feinjustierung (skala) durch, lässt 1 weg', async () => {
    const tour = await enrichTour(
      eingabe({
        schema: 'maptale/edits@2',
        camera: [
          { from: iso(300), preset: 'near', scale: 1.4 },
          { from: iso(600), preset: 'far', scale: 1 }, // skala 1 → kein Feld
        ],
      }),
    )
    expect(tour.camera?.[0]).toMatchObject({ preset: 'near', scale: 1.4 })
    expect(tour.camera?.[1] && 'skala' in tour.camera[1]).toBe(false)
  })

  it('rendert Kamera-Momente an f, verwirft solche hinter dem Track-Ende', async () => {
    const meldungen: string[] = []
    const tour = await enrichTour({
      ...eingabe({
        schema: 'maptale/edits@2',
        moments: [
          { from: iso(600), kind: 'orbit', durationS: 8 },
          { from: iso(300), kind: 'linger' }, // Default-Dauer (kein dauerS)
          { from: iso(3600), kind: 'ascend' }, // hinter Track-Ende (t=1800) → weg
        ],
      }),
      log: (m) => meldungen.push(m),
    })
    expect(tour.moments).toHaveLength(2)
    // sortiert nach f (300 vor 600)
    expect(tour.moments?.[0]).toMatchObject({ kind: 'linger' })
    expect(tour.moments?.[0] && 'dauerS' in tour.moments[0]).toBe(false)
    expect(tour.moments?.[1]).toMatchObject({ kind: 'orbit', durationS: 8 })
    expect(tour.moments?.[0]?.f).toBeLessThan(tour.moments?.[1]?.f ?? 0)
    expect(meldungen.some((m) => /Kamera-Moment hinter dem Track-Ende/.test(m))).toBe(true)
  })

  it('rendert Audio-Spuren: musik als Bereich mit gain, sfx als Punkt (Baukasten)', async () => {
    const meldungen: string[] = []
    const tour = await enrichTour({
      ...eingabe({
        schema: 'maptale/edits@2',
        audio: [
          { file: 'knall.wav', type: 'sfx', from: iso(900) },
          { file: 'musik.mp3', type: 'music', from: iso(0), volume: 0.7 },
        ],
      }),
      audioFiles: ['musik.mp3', 'knall.wav'],
      log: (m) => meldungen.push(m),
    })
    expect(meldungen).toEqual([])
    expect(tour.audio).toHaveLength(2)
    // sortiert nach Filmsekunde: Musik (ab 0) vor SFX. Neben `f0`/`f1` stehen
    // seit E10 die Film-Anker — der Bereich läuft bis ans Filmende.
    const musik = tour.audio?.[0]
    expect(musik).toMatchObject({
      type: 'music',
      src: '/api/media/t1/musik.mp3',
      f0: 0,
      f1: 1,
      gain: 0.7,
    })
    expect(musik?.filmS).toBe(0)
    expect(musik?.filmToS).toBeGreaterThan(0)
    const sfx = tour.audio?.[1]
    expect(sfx?.type).toBe('sfx')
    expect(sfx?.f0).toBe(sfx?.f1)
    // `gain` steht IMMER — ohne ihn spielte der Player mit 1.0, der Film wäre
    // lauter als der Schnitt. Ohne eigenen Wert gilt die Reglerstellung des
    // Studios (STUDIO_GAIN), nicht „kein Feld".
    expect(sfx?.gain).toBe(STUDIO_GAIN)
  })

  it('Bibliotheks-Audio: /audio/sfx-URL, keine media/-Prüfung', async () => {
    const meldungen: string[] = []
    const tour = await enrichTour({
      ...eingabe({
        schema: 'maptale/edits@2',
        audio: [
          { file: 'sfx-moewe.mp3', type: 'sfx', from: iso(900), source: 'library' },
          { file: 'amb-hafen.mp3', type: 'music', from: iso(0), source: 'library' },
        ],
      }),
      audioFiles: [], // Bibliothekseffekte liegen NICHT unter media/
      log: (m) => meldungen.push(m),
    })
    expect(meldungen).toEqual([]) // nicht als fehlend gemeldet
    expect(tour.audio).toHaveLength(2)
    expect(tour.audio?.[0]).toMatchObject({ type: 'music', src: '/audio/sfx/amb-hafen.mp3', f0: 0 })
    expect(tour.audio?.[1]).toMatchObject({ type: 'sfx', src: '/audio/sfx/sfx-moewe.mp3' })
  })

  it('überspringt fehlende Audio-Dateien mit Warnung — audio bleibt dann weg', async () => {
    const meldungen: string[] = []
    const tour = await enrichTour({
      ...eingabe({
        schema: 'maptale/edits@2',
        audio: [{ file: 'fehlt.mp3', type: 'music', from: iso(0) }],
      }),
      audioFiles: ['musik.mp3'],
      log: (m) => meldungen.push(m),
    })
    expect(meldungen).toEqual(['Audio-Datei fehlt: fehlt.mp3'])
    expect(tour.audio).toBeUndefined()
  })

  it('Trim-Wechselwirkung: geklemmte Musik spielt ab 0, leere Spannen und SFX außerhalb fliegen raus', async () => {
    const meldungen: string[] = []
    const tour = await enrichTour({
      ...eingabe({
        schema: 'maptale/edits@2',
        trim: { start: iso(300) },
        audio: [
          // komplett vor dem Trim-Start: f0=f1=0 → verworfen
          { file: 'vorher.mp3', type: 'music', from: iso(0), to: iso(300) },
          // Start vor dem Trim, Ende offen → auf f0=0 geklemmt, spielt die ganze Tour
          { file: 'musik.mp3', type: 'music', from: iso(0) },
          // SFX vor dem getrimmten Track: würde sonst am Tour-Start knallen → verworfen
          { file: 'knall.wav', type: 'sfx', from: iso(0) },
          // SFX innerhalb bleibt
          { file: 'ping.ogg', type: 'sfx', from: iso(600) },
        ],
      }),
      audioFiles: ['vorher.mp3', 'musik.mp3', 'knall.wav', 'ping.ogg'],
      log: (m) => meldungen.push(m),
    })
    expect(meldungen).toEqual([
      'Audio außerhalb des Tracks übersprungen: vorher.mp3',
      'Audio außerhalb des Tracks übersprungen: knall.wav',
    ])
    expect(tour.audio?.map((a) => a.src)).toEqual([
      '/api/media/t1/musik.mp3',
      '/api/media/t1/ping.ogg',
    ])
    expect(tour.audio?.[0]).toMatchObject({ f0: 0, f1: 1 })
  })

  it('reicht display aus dem Overlay in die Medien durch — nur wo gesetzt', async () => {
    const tour = await enrichTour(
      eingabe({
        schema: 'maptale/edits@2',
        media: { m1: { display: { holdS: 12, kenBurns: false } } },
      }),
    )
    expect(tour.media[0]?.display).toEqual({ holdS: 12, kenBurns: false })
    const m2 = tour.media.find((m) => m.id === 'm2')
    expect(m2 && 'display' in m2).toBe(false)
  })

  // Der Platz im Foto-Stopp wird hier nur DURCHGEREICHT — gruppiert wird erst
  // im Player (gruppiereStopps in src/geo.ts), der Server kennt keine Stopps.
  it('reicht reihe aus dem Overlay in die Medien durch — nur wo gesetzt', async () => {
    const tour = await enrichTour(
      eingabe({
        schema: 'maptale/edits@2',
        media: { m1: { order: 0 }, m2: { order: 1 } },
      }),
    )
    expect(tour.media.find((m) => m.id === 'm1')?.order).toBe(0)
    expect(tour.media.find((m) => m.id === 'm2')?.order).toBe(1)
    const ohne = await enrichTour(eingabe({ schema: 'maptale/edits@2' }))
    expect('reihe' in (ohne.media[0] ?? {})).toBe(false)
  })
})

// — Ton-Verankerung an der Film-Achse (Etappe 4, docs §2E) —

describe('reichereAn: Ton am Film-Anker', () => {
  const manifest = (): UploadManifest => ({
    schema: 'maptale/upload@2',
    title: null,
    description: null,
    time: { start: iso(0), end: iso(1800), zone: 'UTC' },
    segments: segmente(),
    media: [{ id: 'm1', type: 'photo', file: 'a.jpg', takenAt: iso(600), anchor: [7.91, 46.51] }],
  })

  const rendere = (edits: EditOverlay) =>
    enrichTour({
      tourId: 't1',
      no: 1,
      manifest: manifest(),
      titleOverride: null,
      descriptionOverride: null,
      edits,
      geocoder: new FixedGeocoder(['Start', 'Ziel']),
      audioFiles: ['musik.mp3', 'knall.wav'],
    })

  it('ohne die neuen Felder rendert der Anker wie „ab" — Zeichen für Zeichen', async () => {
    const alt = await rendere({
      schema: 'maptale/edits@2',
      audio: [{ file: 'musik.mp3', type: 'music', from: iso(600) }],
    })
    const neu = await rendere({
      schema: 'maptale/edits@2',
      audio: [{ file: 'musik.mp3', type: 'music', from: iso(600), anchor: iso(600) }],
    })
    expect(neu.audio?.[0]?.f0).toBeCloseTo(alt.audio?.[0]?.f0 ?? -1, 9)
  })

  it('der Versatz rechnet in FILMsekunden, nicht in Aufnahmezeit', async () => {
    // 5 Filmsekunden sind zu Fuß 240 Streckenmeter — nicht 5 Sekunden Uhrzeit.
    const ohne = await rendere({
      schema: 'maptale/edits@2',
      audio: [{ file: 'musik.mp3', type: 'music', from: iso(0), anchor: iso(300), offsetFilmS: 0 }],
    })
    const mit = await rendere({
      schema: 'maptale/edits@2',
      audio: [{ file: 'musik.mp3', type: 'music', from: iso(0), anchor: iso(300), offsetFilmS: 5 }],
    })
    expect(mit.audio?.[0]?.f0).toBeGreaterThan(ohne.audio?.[0]?.f0 ?? 1)
  })

  it('IN einer Standzeit trägt die FILMSEKUNDE den Versatz — f steht still (E10)', async () => {
    // Die bewusste Kante: Der Film läuft im Halt weiter, die Strecke nicht. Ein
    // Versatz von 5 s ab dem Foto (Standzeit 6 s) landet auf demselben `f` —
    // daran ändert E10 nichts, das ist die Eigenschaft des Streckenanteils.
    // Was sich ändert: Die Filmsekunde daneben sagt, WO im Halt der Klip
    // einsetzt, und genau um diese 5 Sekunden rückt sie mit.
    const gleich = await Promise.all(
      [0, 5].map((v) =>
        enrichTour({
          tourId: 't1',
          no: 1,
          manifest: manifest(),
          titleOverride: null,
          descriptionOverride: null,
          edits: {
            schema: 'maptale/edits@2',
            audio: [
              {
                file: 'musik.mp3',
                type: 'music',
                from: iso(0),
                anchor: iso(600),
                offsetFilmS: v,
                durationFilmS: 20,
              },
            ],
          },
          geocoder: new FixedGeocoder(['Start', 'Ziel']),
          audioFiles: ['musik.mp3'],
        }),
      ),
    )
    expect(gleich[0]?.audio?.[0]?.f0).toBeCloseTo(gleich[1]?.audio?.[0]?.f0 ?? -1, 9)
    const ankunft = gleich[0]?.audio?.[0]?.filmS ?? 0 // Versatz 0 = die Halt-Kante
    const drin5 = gleich[1]?.audio?.[0]?.filmS ?? 0
    expect(drin5 - ankunft).toBeCloseTo(5, 6)
    // ... und zwar MITTEN im Halt, nicht an dessen Ende: Die Standzeit ist 6 s.
    expect(drin5).toBeLessThan(ankunft + 6)

    // Und wer GANZ im Halt bleibt, wird nicht mehr übersprungen: Bis E10 fiel
    // genau dieser Klip heraus („liegt ganz in einer Standzeit"), weil seine
    // Spanne im f-Raum auf einen Punkt zusammenfällt. In Filmzeit hat er sehr
    // wohl eine Länge — hier die drei Sekunden aus `dauerFilmS`.
    const meldungen: string[] = []
    const drin = await enrichTour({
      tourId: 't1',
      no: 1,
      manifest: manifest(),
      titleOverride: null,
      descriptionOverride: null,
      edits: {
        schema: 'maptale/edits@2',
        audio: [
          {
            file: 'musik.mp3',
            type: 'music',
            from: iso(0),
            anchor: iso(600),
            offsetFilmS: 1,
            durationFilmS: 3,
          },
        ],
      },
      geocoder: new FixedGeocoder(['Start', 'Ziel']),
      audioFiles: ['musik.mp3'],
      log: (m) => meldungen.push(m),
    })
    const klip = drin.audio?.[0]
    expect(klip).toBeDefined()
    expect(klip?.f0).toBeCloseTo(klip?.f1 ?? -1, 9) // im f-Raum weiterhin ein Punkt
    expect((klip?.filmToS ?? 0) - (klip?.filmS ?? 0)).toBeCloseTo(3, 6)
    expect(meldungen.some((m) => /Standzeit/.test(m))).toBe(false)
  })

  it('ein Klip rückt mit, wenn eine Standzeit davor wächst', async () => {
    // Die Zusage aus §2E: Ton war vorher das einzige Element, das liegen blieb.
    // Der Anker liegt HINTER dem Foto, dessen Standzeit sich ändert.
    const basis = {
      file: 'musik.mp3' as const,
      type: 'music' as const,
      from: iso(1200),
      anchor: iso(1200),
      offsetFilmS: 0,
      durationFilmS: 4,
    }
    const kurz = await rendere({ schema: 'maptale/edits@2', audio: [basis] })
    const lang = await rendere({
      schema: 'maptale/edits@2',
      media: { m1: { display: { holdS: 30 } } },
      audio: [basis],
    })
    // Der ANKER (Stelle der Reise) bleibt, die Filmlage wächst mit dem Halt —
    // im f-Raum heißt das: gleicher Startanteil, gleiche Streckenspanne.
    expect(lang.audio?.[0]?.f0).toBeCloseTo(kurz.audio?.[0]?.f0 ?? -1, 9)
    expect((lang.audio?.[0]?.f1 ?? 0) - (lang.audio?.[0]?.f0 ?? 0)).toBeCloseTo(
      (kurz.audio?.[0]?.f1 ?? 0) - (kurz.audio?.[0]?.f0 ?? 0),
      9,
    )
  })

  it('ein Kamera-Moment kostet Filmzeit — ein Klip dahinter rückt mit', async () => {
    // Ein Moment hält den Film an (src/tour.ts, Phase `moment`) und kostet im
    // Studio Achsenbreite. Fehlte er in der Server-Achse, löste der Render
    // einen Versatz, der ÜBER den Moment reicht, gegen eine zu kurze Achse auf:
    // Editor und fertiger Film zeigten den Klip an verschiedenen Stellen.
    const spur = {
      file: 'musik.mp3' as const,
      type: 'music' as const,
      from: iso(0),
      anchor: iso(0),
      offsetFilmS: 20,
      durationFilmS: 4,
    }
    const moment = { from: iso(150), kind: 'orbit' as const } // 6 Filmsekunden
    const ohne = await rendere({ schema: 'maptale/edits@2', audio: [spur] })
    const mit = await rendere({ schema: 'maptale/edits@2', moments: [moment], audio: [spur] })
    // Sechs der zwanzig Filmsekunden vergehen jetzt im Moment — der Klip setzt
    // entsprechend früher auf der STRECKE ein.
    expect(mit.audio?.[0]?.f0).toBeLessThan(ohne.audio?.[0]?.f0 ?? 1)
    // Und zwar um MEHR als die Momentdauer: Seit E14 bringt jeder Halt seine
    // Rampen mit — vor ihm wird gebremst, danach wieder angefahren, und beides
    // kostet Filmzeit, ohne Strecke zu machen. Ein Klip 20 Filmsekunden hinter
    // dem Anker kommt deshalb weiter vorn heraus als bei einem Moment, der nur
    // seine nackte Dauer kostete.
    const gekuerzt = await rendere({
      schema: 'maptale/edits@2',
      audio: [{ ...spur, offsetFilmS: 20 - 6 }],
    })
    expect(mit.audio?.[0]?.f0).toBeLessThan(gekuerzt.audio?.[0]?.f0 ?? -1)
  })

  it('ein Moment hinter dem Track-Ende verlängert die Achse nicht', async () => {
    // Verworfen wird er ohnehin (er steht nicht in `moments`) — er darf dann
    // auch die Ton-Verankerung nicht anfassen.
    const spur = {
      file: 'musik.mp3' as const,
      type: 'music' as const,
      from: iso(0),
      anchor: iso(0),
      offsetFilmS: 20,
      durationFilmS: 4,
    }
    const ohne = await rendere({ schema: 'maptale/edits@2', audio: [spur] })
    const dahinter = await rendere({
      schema: 'maptale/edits@2',
      moments: [{ from: iso(3600), kind: 'orbit' }],
      audio: [spur],
    })
    expect(dahinter.moments).toBeUndefined()
    expect(dahinter.audio?.[0]?.f0).toBeCloseTo(ohne.audio?.[0]?.f0 ?? -1, 9)
  })

  it('dauerFilmS schlägt „bis" — und gibt auch einem Effekt eine Länge', async () => {
    const tour = await rendere({
      schema: 'maptale/edits@2',
      audio: [
        { file: 'musik.mp3', type: 'music', from: iso(0), to: iso(1800), durationFilmS: 3 },
        { file: 'knall.wav', type: 'sfx', from: iso(300), durationFilmS: 2 },
      ],
    })
    const musik = tour.audio?.find((a) => a.type === 'music')
    const sfx = tour.audio?.find((a) => a.type === 'sfx')
    expect(musik?.f1).toBeLessThan(1) // „bis Tour-Ende" hätte f1 = 1 ergeben
    expect(sfx?.f1).toBeGreaterThan(sfx?.f0 ?? 1) // heute wäre f1 === f0
  })

  it('schreibt loop und startS nur, wenn sie gesetzt sind', async () => {
    const still = await rendere({
      schema: 'maptale/edits@2',
      audio: [{ file: 'musik.mp3', type: 'music', from: iso(0) }],
    })
    expect('loop' in (still.audio?.[0] ?? {})).toBe(false)
    expect('startS' in (still.audio?.[0] ?? {})).toBe(false)

    const gesetzt = await rendere({
      schema: 'maptale/edits@2',
      audio: [{ file: 'musik.mp3', type: 'music', from: iso(0), loop: false, startS: 12.5 }],
    })
    expect(gesetzt.audio?.[0]?.loop).toBe(false)
    expect(gesetzt.audio?.[0]?.startS).toBe(12.5)
  })
})
