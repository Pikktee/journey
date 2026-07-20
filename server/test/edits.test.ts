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

  it('prüft Kamera-Grenzen (Baukasten)', () => {
    expect(
      pruefeEditsSemantik({ schema: 'luhambo/edits@1', kamera: [{ ab: iso(0), preset: 'nah' }] }),
    ).toBeNull()
    expect(
      pruefeEditsSemantik({ schema: 'luhambo/edits@1', kamera: [{ ab: '2026-13-99T99:99:99Z', preset: 'nah' }] }),
    ).toMatch(/Kamera-Grenze/)
  })

  it('prüft Audio-Einträge: Zeiten, Spanne, bis nur bei Musik, Lautstärke endlich', () => {
    const basis = { datei: 'a1.mp3', ab: iso(0) } as const
    expect(
      pruefeEditsSemantik({ schema: 'luhambo/edits@1', audio: [{ ...basis, typ: 'musik', bis: iso(600), lautstaerke: 0.5 }] }),
    ).toBeNull()
    expect(
      pruefeEditsSemantik({ schema: 'luhambo/edits@1', audio: [{ ...basis, typ: 'sfx' }] }),
    ).toBeNull()
    expect(
      pruefeEditsSemantik({ schema: 'luhambo/edits@1', audio: [{ datei: 'a1.mp3', typ: 'musik', ab: '2026-13-99T99:99:99Z' }] }),
    ).toMatch(/Audio-Start/)
    expect(
      pruefeEditsSemantik({ schema: 'luhambo/edits@1', audio: [{ ...basis, typ: 'musik', bis: '2026-13-99T99:99:99Z' }] }),
    ).toMatch(/Audio-Ende/)
    // bis <= ab: leere Spanne
    expect(
      pruefeEditsSemantik({ schema: 'luhambo/edits@1', audio: [{ ...basis, typ: 'musik', bis: iso(0) }] }),
    ).toMatch(/Audio-Ende muss nach/)
    expect(
      pruefeEditsSemantik({ schema: 'luhambo/edits@1', audio: [{ ...basis, typ: 'sfx', bis: iso(600) }] }),
    ).toMatch(/nur bei Musik/)
    // JSON.parse('1e999') → Infinity: minimum/maximum fangen das im Schema,
    // die Semantik bleibt trotzdem wasserdicht (Number.isFinite)
    expect(
      pruefeEditsSemantik({ schema: 'luhambo/edits@1', audio: [{ ...basis, typ: 'musik', lautstaerke: Infinity }] }),
    ).toMatch(/Lautstärke/)
  })

  it('prüft display.holdS auf Endlichkeit (Baukasten)', () => {
    expect(
      pruefeEditsSemantik({ schema: 'luhambo/edits@1', medien: { m1: { display: { holdS: 8, kenBurns: false } } } }),
    ).toBeNull()
    expect(
      pruefeEditsSemantik({ schema: 'luhambo/edits@1', medien: { m1: { display: { holdS: Infinity } } } }),
    ).toMatch(/Standzeit/)
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

  it('rendert Kamera-Keyframes: ab-Zeit → f, nach f sortiert (Baukasten)', async () => {
    const tour = await reichereAn(
      eingabe({
        schema: 'luhambo/edits@1',
        // absichtlich unsortiert übergeben
        kamera: [
          { ab: iso(900), preset: 'nah' },
          { ab: iso(0), preset: 'weit' },
        ],
      }),
    )
    expect(tour.camera).toHaveLength(2)
    expect(tour.camera?.[0]).toEqual({ f: 0, preset: 'weit' })
    expect(tour.camera?.[1]?.preset).toBe('nah')
    // t=900 liegt in der Streckenmitte (gleichförmige Punkte)
    expect(tour.camera?.[1]?.f).toBeGreaterThan(0.4)
    expect(tour.camera?.[1]?.f).toBeLessThan(0.6)
  })

  it('klemmt Kamera-Grenzen vor dem Trim-Start auf f=0 — der spätere ab gewinnt', async () => {
    const tour = await reichereAn(
      eingabe({
        schema: 'luhambo/edits@1',
        trim: { start: iso(300) },
        kamera: [
          { ab: iso(0), preset: 'nah' },
          { ab: iso(120), preset: 'weit' },
        ],
      }),
    )
    // Beide Grenzen liegen vor dem getrimmten Track → beide auf f=0 geklemmt,
    // nur die spätere überlebt (Punktfunktion: sie gilt „ab hier")
    expect(tour.camera).toEqual([{ f: 0, preset: 'weit' }])
  })

  it('verwirft Kamera-Grenzen hinter dem Track-Ende (statt auf f=1 zu klemmen)', async () => {
    const meldungen: string[] = []
    const tour = await reichereAn({
      ...eingabe({
        schema: 'luhambo/edits@1',
        kamera: [
          { ab: iso(600), preset: 'nah' },
          { ab: iso(3600), preset: 'weit' }, // weit hinter dem Track-Ende (t=1800)
        ],
      }),
      protokoll: (m) => meldungen.push(m),
    })
    // Nur die gültige Grenze bleibt; die späte fällt raus (kein Umschalten am Finale)
    expect(tour.camera).toHaveLength(1)
    expect(tour.camera?.[0]?.preset).toBe('nah')
    expect(meldungen.some((m) => /Kamera-Grenze hinter dem Track-Ende/.test(m))).toBe(true)
  })

  it('reicht die Kamera-Feinjustierung (skala) durch, lässt 1 weg', async () => {
    const tour = await reichereAn(
      eingabe({
        schema: 'luhambo/edits@1',
        kamera: [
          { ab: iso(300), preset: 'nah', skala: 1.4 },
          { ab: iso(600), preset: 'weit', skala: 1 }, // skala 1 → kein Feld
        ],
      }),
    )
    expect(tour.camera?.[0]).toMatchObject({ preset: 'nah', skala: 1.4 })
    expect(tour.camera?.[1] && 'skala' in tour.camera[1]).toBe(false)
  })

  it('rendert Kamera-Momente an f, verwirft solche hinter dem Track-Ende', async () => {
    const meldungen: string[] = []
    const tour = await reichereAn({
      ...eingabe({
        schema: 'luhambo/edits@1',
        momente: [
          { ab: iso(600), art: 'umkreisen', dauerS: 8 },
          { ab: iso(300), art: 'innehalten' }, // Default-Dauer (kein dauerS)
          { ab: iso(3600), art: 'aufstieg' }, // hinter Track-Ende (t=1800) → weg
        ],
      }),
      protokoll: (m) => meldungen.push(m),
    })
    expect(tour.moments).toHaveLength(2)
    // sortiert nach f (300 vor 600)
    expect(tour.moments?.[0]).toMatchObject({ art: 'innehalten' })
    expect(tour.moments?.[0] && 'dauerS' in tour.moments[0]).toBe(false)
    expect(tour.moments?.[1]).toMatchObject({ art: 'umkreisen', dauerS: 8 })
    expect(tour.moments?.[0]?.f).toBeLessThan(tour.moments?.[1]?.f ?? 0)
    expect(meldungen.some((m) => /Kamera-Moment hinter dem Track-Ende/.test(m))).toBe(true)
  })

  it('rendert Audio-Spuren: musik als Bereich mit gain, sfx als Punkt (Baukasten)', async () => {
    const meldungen: string[] = []
    const tour = await reichereAn({
      ...eingabe({
        schema: 'luhambo/edits@1',
        audio: [
          { datei: 'knall.wav', typ: 'sfx', ab: iso(900) },
          { datei: 'musik.mp3', typ: 'musik', ab: iso(0), lautstaerke: 0.7 },
        ],
      }),
      audioDateien: ['musik.mp3', 'knall.wav'],
      protokoll: (m) => meldungen.push(m),
    })
    expect(meldungen).toEqual([])
    expect(tour.audio).toHaveLength(2)
    // sortiert nach f0: Musik (f0=0) vor SFX (f0≈0.5)
    expect(tour.audio?.[0]).toEqual({ type: 'music', src: '/api/media/t1/musik.mp3', f0: 0, f1: 1, gain: 0.7 })
    const sfx = tour.audio?.[1]
    expect(sfx?.type).toBe('sfx')
    expect(sfx?.f0).toBe(sfx?.f1)
    expect(sfx && 'gain' in sfx).toBe(false)
  })

  it('Bibliotheks-Audio: /audio/sfx-URL, keine media/-Prüfung', async () => {
    const meldungen: string[] = []
    const tour = await reichereAn({
      ...eingabe({
        schema: 'luhambo/edits@1',
        audio: [
          { datei: 'sfx-moewe.mp3', typ: 'sfx', ab: iso(900), quelle: 'bibliothek' },
          { datei: 'amb-hafen.mp3', typ: 'musik', ab: iso(0), quelle: 'bibliothek' },
        ],
      }),
      audioDateien: [], // Bibliothekseffekte liegen NICHT unter media/
      protokoll: (m) => meldungen.push(m),
    })
    expect(meldungen).toEqual([]) // nicht als fehlend gemeldet
    expect(tour.audio).toHaveLength(2)
    expect(tour.audio?.[0]).toMatchObject({ type: 'music', src: '/audio/sfx/amb-hafen.mp3', f0: 0 })
    expect(tour.audio?.[1]).toMatchObject({ type: 'sfx', src: '/audio/sfx/sfx-moewe.mp3' })
  })

  it('überspringt fehlende Audio-Dateien mit Warnung — audio bleibt dann weg', async () => {
    const meldungen: string[] = []
    const tour = await reichereAn({
      ...eingabe({
        schema: 'luhambo/edits@1',
        audio: [{ datei: 'fehlt.mp3', typ: 'musik', ab: iso(0) }],
      }),
      audioDateien: ['musik.mp3'],
      protokoll: (m) => meldungen.push(m),
    })
    expect(meldungen).toEqual(['Audio-Datei fehlt: fehlt.mp3'])
    expect(tour.audio).toBeUndefined()
  })

  it('Trim-Wechselwirkung: geklemmte Musik spielt ab 0, leere Spannen und SFX außerhalb fliegen raus', async () => {
    const meldungen: string[] = []
    const tour = await reichereAn({
      ...eingabe({
        schema: 'luhambo/edits@1',
        trim: { start: iso(300) },
        audio: [
          // komplett vor dem Trim-Start: f0=f1=0 → verworfen
          { datei: 'vorher.mp3', typ: 'musik', ab: iso(0), bis: iso(300) },
          // Start vor dem Trim, Ende offen → auf f0=0 geklemmt, spielt die ganze Tour
          { datei: 'musik.mp3', typ: 'musik', ab: iso(0) },
          // SFX vor dem getrimmten Track: würde sonst am Tour-Start knallen → verworfen
          { datei: 'knall.wav', typ: 'sfx', ab: iso(0) },
          // SFX innerhalb bleibt
          { datei: 'ping.ogg', typ: 'sfx', ab: iso(600) },
        ],
      }),
      audioDateien: ['vorher.mp3', 'musik.mp3', 'knall.wav', 'ping.ogg'],
      protokoll: (m) => meldungen.push(m),
    })
    expect(meldungen).toEqual([
      'Audio außerhalb des Tracks übersprungen: vorher.mp3',
      'Audio außerhalb des Tracks übersprungen: knall.wav',
    ])
    expect(tour.audio?.map((a) => a.src)).toEqual(['/api/media/t1/musik.mp3', '/api/media/t1/ping.ogg'])
    expect(tour.audio?.[0]).toMatchObject({ f0: 0, f1: 1 })
  })

  it('reicht display aus dem Overlay in die Medien durch — nur wo gesetzt', async () => {
    const tour = await reichereAn(
      eingabe({
        schema: 'luhambo/edits@1',
        medien: { m1: { display: { holdS: 12, kenBurns: false } } },
      }),
    )
    expect(tour.media[0]?.display).toEqual({ holdS: 12, kenBurns: false })
    const m2 = tour.media.find((m) => m.id === 'm2')
    expect(m2 && 'display' in m2).toBe(false)
  })
})
