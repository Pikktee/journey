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
import { pruefeEditsSemantik, STUDIO_PEGEL, type EditOverlay } from '../src/schema/edits.js'
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
      schema: 'maptale/edits@1',
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
      schema: 'maptale/edits@1',
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
    expect(pruefeEditsSemantik({ schema: 'maptale/edits@1' })).toBeNull()
    expect(
      pruefeEditsSemantik({ schema: 'maptale/edits@1', trim: { start: iso(0), ende: iso(600) } }),
    ).toBeNull()
    expect(
      pruefeEditsSemantik({ schema: 'maptale/edits@1', trim: { start: iso(600), ende: iso(600) } }),
    ).toMatch(/Trim-Start/)
    expect(
      pruefeEditsSemantik({ schema: 'maptale/edits@1', modi: [{ ab: '2026-13-99T99:99:99Z', mode: 'walk' }] }),
    ).toMatch(/Modus-Grenze/)
    // JSON.parse('1e999') → Infinity rutscht am Ajv-Typ "number" vorbei
    expect(
      pruefeEditsSemantik({ schema: 'maptale/edits@1', medien: { m1: { anchor: [Infinity, 46.5] } } }),
    ).toMatch(/Anker/)
  })

  it('prüft Kamera-Grenzen (Baukasten)', () => {
    expect(
      pruefeEditsSemantik({ schema: 'maptale/edits@1', kamera: [{ ab: iso(0), preset: 'nah' }] }),
    ).toBeNull()
    expect(
      pruefeEditsSemantik({ schema: 'maptale/edits@1', kamera: [{ ab: '2026-13-99T99:99:99Z', preset: 'nah' }] }),
    ).toMatch(/Kamera-Grenze/)
  })

  it('prüft Audio-Einträge: Zeiten, Spanne, bis nur bei Musik, Lautstärke endlich', () => {
    const basis = { datei: 'a1.mp3', ab: iso(0) } as const
    expect(
      pruefeEditsSemantik({ schema: 'maptale/edits@1', audio: [{ ...basis, typ: 'musik', bis: iso(600), lautstaerke: 0.5 }] }),
    ).toBeNull()
    expect(
      pruefeEditsSemantik({ schema: 'maptale/edits@1', audio: [{ ...basis, typ: 'sfx' }] }),
    ).toBeNull()
    expect(
      pruefeEditsSemantik({ schema: 'maptale/edits@1', audio: [{ datei: 'a1.mp3', typ: 'musik', ab: '2026-13-99T99:99:99Z' }] }),
    ).toMatch(/Audio-Start/)
    expect(
      pruefeEditsSemantik({ schema: 'maptale/edits@1', audio: [{ ...basis, typ: 'musik', bis: '2026-13-99T99:99:99Z' }] }),
    ).toMatch(/Audio-Ende/)
    // bis <= ab: leere Spanne
    expect(
      pruefeEditsSemantik({ schema: 'maptale/edits@1', audio: [{ ...basis, typ: 'musik', bis: iso(0) }] }),
    ).toMatch(/Audio-Ende muss nach/)
    expect(
      pruefeEditsSemantik({ schema: 'maptale/edits@1', audio: [{ ...basis, typ: 'sfx', bis: iso(600) }] }),
    ).toMatch(/nur bei Musik/)
    // JSON.parse('1e999') → Infinity: minimum/maximum fangen das im Schema,
    // die Semantik bleibt trotzdem wasserdicht (Number.isFinite)
    expect(
      pruefeEditsSemantik({ schema: 'maptale/edits@1', audio: [{ ...basis, typ: 'musik', lautstaerke: Infinity }] }),
    ).toMatch(/Lautstärke/)
  })

  it('prüft die Film-Verankerung des Tons (Etappe 4)', () => {
    const basis = { datei: 'a1.mp3' as const, ab: iso(0), typ: 'musik' as const }
    expect(pruefeEditsSemantik({ schema: 'maptale/edits@1', audio: [{ ...basis, anker: iso(300), versatzFilmS: -2, dauerFilmS: 8, einstiegS: 3, loop: false }] })).toBeNull()
    expect(
      pruefeEditsSemantik({ schema: 'maptale/edits@1', audio: [{ ...basis, anker: '2026-13-99T99:99:99Z' }] }),
    ).toMatch(/Audio-Anker/)
    expect(
      pruefeEditsSemantik({ schema: 'maptale/edits@1', audio: [{ ...basis, versatzFilmS: Infinity }] }),
    ).toMatch(/Audio-Versatz/)
    // Ein Klip ohne Länge ist kein Klip
    expect(pruefeEditsSemantik({ schema: 'maptale/edits@1', audio: [{ ...basis, dauerFilmS: 0 }] })).toMatch(/Audio-Länge/)
    expect(pruefeEditsSemantik({ schema: 'maptale/edits@1', audio: [{ ...basis, dauerFilmS: -3 }] })).toMatch(/Audio-Länge/)
    // Der linke Trim hat den Dateianfang als Anschlag — auch mit Loop
    expect(pruefeEditsSemantik({ schema: 'maptale/edits@1', audio: [{ ...basis, einstiegS: -1, loop: true }] })).toMatch(
      /Datei-Einstieg/,
    )
  })

  it('prüft den Video-Schnitt (Etappe 4)', () => {
    const mit = (trim: { vonS: number; bisS?: number }): string | null =>
      pruefeEditsSemantik({ schema: 'maptale/edits@1', medien: { m1: { trim } } })
    expect(mit({ vonS: 2, bisS: 9 })).toBeNull()
    expect(mit({ vonS: 2 })).toBeNull() // ohne Ende: bis zum Dateiende
    expect(mit({ vonS: -1 })).toMatch(/Video-Schnitt/)
    expect(mit({ vonS: 2, bisS: Infinity })).toMatch(/Video-Schnitt/)
    expect(mit({ vonS: 9, bisS: 9 })).toMatch(/Video-Schnittende/)
    expect(mit({ vonS: 9, bisS: 2 })).toMatch(/Video-Schnittende/)
  })

  it('lehnt einen nicht-ganzzahligen Platz im Stopp ab', () => {
    expect(pruefeEditsSemantik({ schema: 'maptale/edits@1', medien: { m1: { reihe: 0 } } })).toBeNull()
    expect(pruefeEditsSemantik({ schema: 'maptale/edits@1', medien: { m1: { reihe: 1.5 } } })).toMatch(/Platz im Stopp/)
    expect(pruefeEditsSemantik({ schema: 'maptale/edits@1', medien: { m1: { reihe: Infinity } } })).toMatch(/Platz im Stopp/)
  })

  it('prüft display.holdS auf Endlichkeit (Baukasten)', () => {
    expect(
      pruefeEditsSemantik({ schema: 'maptale/edits@1', medien: { m1: { display: { holdS: 8, kenBurns: false } } } }),
    ).toBeNull()
    expect(
      pruefeEditsSemantik({ schema: 'maptale/edits@1', medien: { m1: { display: { holdS: Infinity } } } }),
    ).toMatch(/Standzeit/)
  })

  it('prüft Wetter-Grenzen: Zeit parsebar, Stärke endlich und in [0,1]', () => {
    expect(
      pruefeEditsSemantik({ schema: 'maptale/edits@1', wetter: [{ ab: iso(0), mode: 'rain', staerke: 0.6 }] }),
    ).toBeNull()
    expect(
      pruefeEditsSemantik({ schema: 'maptale/edits@1', wetter: [{ ab: '2026-13-99T99:99:99Z', mode: 'rain' }] }),
    ).toMatch(/Wetter-Grenze/)
    expect(
      pruefeEditsSemantik({ schema: 'maptale/edits@1', wetter: [{ ab: iso(0), mode: 'rain', staerke: Infinity }] }),
    ).toMatch(/Wetter-Stärke/)
    expect(
      pruefeEditsSemantik({ schema: 'maptale/edits@1', wetter: [{ ab: iso(0), mode: 'rain', staerke: 1.5 }] }),
    ).toMatch(/Wetter-Stärke/)
  })
})

describe('reichereAn mit Edit-Overlay', () => {
  const manifest = (): UploadManifest => ({
    schema: 'maptale/upload@1',
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
        schema: 'maptale/edits@1',
        trim: { start: iso(300) },
        modi: [{ ab: iso(900), mode: 'ferry' }],
        medien: { m1: { caption: 'Neu' }, m2: { geloescht: true } },
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
      reichereAn(eingabe({ schema: 'maptale/edits@1', trim: { start: iso(90000) } })),
    ).rejects.toThrow(/Kein Track/)
  })

  it('rendert Kamera-Keyframes: ab-Zeit → f, nach f sortiert (Baukasten)', async () => {
    const tour = await reichereAn(
      eingabe({
        schema: 'maptale/edits@1',
        // absichtlich unsortiert übergeben
        kamera: [
          { ab: iso(900), preset: 'nah' },
          { ab: iso(0), preset: 'weit' },
        ],
      }),
    )
    expect(tour.camera).toHaveLength(2)
    expect(tour.camera?.[0]).toEqual({ f: 0, preset: 'weit', filmS: 0 })
    expect(tour.camera?.[1]?.preset).toBe('nah')
    // t=900 liegt in der Streckenmitte (gleichförmige Punkte)
    expect(tour.camera?.[1]?.f).toBeGreaterThan(0.4)
    expect(tour.camera?.[1]?.f).toBeLessThan(0.6)
  })

  it('klemmt Kamera-Grenzen vor dem Trim-Start auf f=0 — der spätere ab gewinnt', async () => {
    const tour = await reichereAn(
      eingabe({
        schema: 'maptale/edits@1',
        trim: { start: iso(300) },
        kamera: [
          { ab: iso(0), preset: 'nah' },
          { ab: iso(120), preset: 'weit' },
        ],
      }),
    )
    // Beide Grenzen liegen vor dem getrimmten Track → beide auf f=0 geklemmt,
    // nur die spätere überlebt (Punktfunktion: sie gilt „ab hier")
    expect(tour.camera).toEqual([{ f: 0, preset: 'weit', filmS: 0 }])
  })

  it('verwirft Kamera-Grenzen hinter dem Track-Ende (statt auf f=1 zu klemmen)', async () => {
    const meldungen: string[] = []
    const tour = await reichereAn({
      ...eingabe({
        schema: 'maptale/edits@1',
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
        schema: 'maptale/edits@1',
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
        schema: 'maptale/edits@1',
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
        schema: 'maptale/edits@1',
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
    // sortiert nach Filmsekunde: Musik (ab 0) vor SFX. Neben `f0`/`f1` stehen
    // seit E10 die Film-Anker — der Bereich läuft bis ans Filmende.
    const musik = tour.audio?.[0]
    expect(musik).toMatchObject({ type: 'music', src: '/api/media/t1/musik.mp3', f0: 0, f1: 1, gain: 0.7 })
    expect(musik?.filmS).toBe(0)
    expect(musik?.filmBisS).toBeGreaterThan(0)
    const sfx = tour.audio?.[1]
    expect(sfx?.type).toBe('sfx')
    expect(sfx?.f0).toBe(sfx?.f1)
    // `gain` steht IMMER — ohne ihn spielte der Player mit 1.0, der Film wäre
    // lauter als der Schnitt. Ohne eigenen Wert gilt die Reglerstellung des
    // Studios (STUDIO_PEGEL), nicht „kein Feld".
    expect(sfx?.gain).toBe(STUDIO_PEGEL)
  })

  it('Bibliotheks-Audio: /audio/sfx-URL, keine media/-Prüfung', async () => {
    const meldungen: string[] = []
    const tour = await reichereAn({
      ...eingabe({
        schema: 'maptale/edits@1',
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
        schema: 'maptale/edits@1',
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
        schema: 'maptale/edits@1',
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
        schema: 'maptale/edits@1',
        medien: { m1: { display: { holdS: 12, kenBurns: false } } },
      }),
    )
    expect(tour.media[0]?.display).toEqual({ holdS: 12, kenBurns: false })
    const m2 = tour.media.find((m) => m.id === 'm2')
    expect(m2 && 'display' in m2).toBe(false)
  })

  // Der Platz im Foto-Stopp wird hier nur DURCHGEREICHT — gruppiert wird erst
  // im Player (gruppiereStopps in src/geo.ts), der Server kennt keine Stopps.
  it('reicht reihe aus dem Overlay in die Medien durch — nur wo gesetzt', async () => {
    const tour = await reichereAn(
      eingabe({
        schema: 'maptale/edits@1',
        medien: { m1: { reihe: 0 }, m2: { reihe: 1 } },
      }),
    )
    expect(tour.media.find((m) => m.id === 'm1')?.reihe).toBe(0)
    expect(tour.media.find((m) => m.id === 'm2')?.reihe).toBe(1)
    const ohne = await reichereAn(eingabe({ schema: 'maptale/edits@1' }))
    expect('reihe' in (ohne.media[0] ?? {})).toBe(false)
  })
})

// — Ton-Verankerung an der Film-Achse (Etappe 4, docs §2E) —

describe('reichereAn: Ton am Film-Anker', () => {
  const manifest = (): UploadManifest => ({
    schema: 'maptale/upload@1',
    title: null,
    description: null,
    time: { start: iso(0), end: iso(1800), zone: 'UTC' },
    segments: segmente(),
    media: [{ id: 'm1', type: 'photo', file: 'a.jpg', takenAt: iso(600), anchor: [7.91, 46.51] }],
  })

  const rendere = (edits: EditOverlay) =>
    reichereAn({
      tourId: 't1',
      nummer: 1,
      manifest: manifest(),
      titelOverride: null,
      beschreibungOverride: null,
      edits,
      geocoder: new FesterGeocoder(['Start', 'Ziel']),
      audioDateien: ['musik.mp3', 'knall.wav'],
    })

  it('ohne die neuen Felder rendert der Anker wie „ab" — Zeichen für Zeichen', async () => {
    const alt = await rendere({
      schema: 'maptale/edits@1',
      audio: [{ datei: 'musik.mp3', typ: 'musik', ab: iso(600) }],
    })
    const neu = await rendere({
      schema: 'maptale/edits@1',
      audio: [{ datei: 'musik.mp3', typ: 'musik', ab: iso(600), anker: iso(600) }],
    })
    expect(neu.audio?.[0]?.f0).toBeCloseTo(alt.audio?.[0]?.f0 ?? -1, 9)
  })

  it('der Versatz rechnet in FILMsekunden, nicht in Aufnahmezeit', async () => {
    // 5 Filmsekunden sind zu Fuß 240 Streckenmeter — nicht 5 Sekunden Uhrzeit.
    const ohne = await rendere({
      schema: 'maptale/edits@1',
      audio: [{ datei: 'musik.mp3', typ: 'musik', ab: iso(0), anker: iso(300), versatzFilmS: 0 }],
    })
    const mit = await rendere({
      schema: 'maptale/edits@1',
      audio: [{ datei: 'musik.mp3', typ: 'musik', ab: iso(0), anker: iso(300), versatzFilmS: 5 }],
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
        reichereAn({
          tourId: 't1',
          nummer: 1,
          manifest: manifest(),
          titelOverride: null,
          beschreibungOverride: null,
          edits: {
            schema: 'maptale/edits@1',
            audio: [{ datei: 'musik.mp3', typ: 'musik', ab: iso(0), anker: iso(600), versatzFilmS: v, dauerFilmS: 20 }],
          },
          geocoder: new FesterGeocoder(['Start', 'Ziel']),
          audioDateien: ['musik.mp3'],
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
    const drin = await reichereAn({
      tourId: 't1',
      nummer: 1,
      manifest: manifest(),
      titelOverride: null,
      beschreibungOverride: null,
      edits: {
        schema: 'maptale/edits@1',
        audio: [{ datei: 'musik.mp3', typ: 'musik', ab: iso(0), anker: iso(600), versatzFilmS: 1, dauerFilmS: 3 }],
      },
      geocoder: new FesterGeocoder(['Start', 'Ziel']),
      audioDateien: ['musik.mp3'],
      protokoll: (m) => meldungen.push(m),
    })
    const klip = drin.audio?.[0]
    expect(klip).toBeDefined()
    expect(klip?.f0).toBeCloseTo(klip?.f1 ?? -1, 9) // im f-Raum weiterhin ein Punkt
    expect((klip?.filmBisS ?? 0) - (klip?.filmS ?? 0)).toBeCloseTo(3, 6)
    expect(meldungen.some((m) => /Standzeit/.test(m))).toBe(false)
  })

  it('ein Klip rückt mit, wenn eine Standzeit davor wächst', async () => {
    // Die Zusage aus §2E: Ton war vorher das einzige Element, das liegen blieb.
    // Der Anker liegt HINTER dem Foto, dessen Standzeit sich ändert.
    const basis = {
      datei: 'musik.mp3' as const,
      typ: 'musik' as const,
      ab: iso(1200),
      anker: iso(1200),
      versatzFilmS: 0,
      dauerFilmS: 4,
    }
    const kurz = await rendere({ schema: 'maptale/edits@1', audio: [basis] })
    const lang = await rendere({
      schema: 'maptale/edits@1',
      medien: { m1: { display: { holdS: 30 } } },
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
      datei: 'musik.mp3' as const,
      typ: 'musik' as const,
      ab: iso(0),
      anker: iso(0),
      versatzFilmS: 20,
      dauerFilmS: 4,
    }
    const moment = { ab: iso(150), art: 'umkreisen' as const } // 6 Filmsekunden
    const ohne = await rendere({ schema: 'maptale/edits@1', audio: [spur] })
    const mit = await rendere({ schema: 'maptale/edits@1', momente: [moment], audio: [spur] })
    // Sechs der zwanzig Filmsekunden vergehen jetzt im Moment — der Klip setzt
    // entsprechend früher auf der STRECKE ein.
    expect(mit.audio?.[0]?.f0).toBeLessThan(ohne.audio?.[0]?.f0 ?? 1)
    // Und zwar um MEHR als die Momentdauer: Seit E14 bringt jeder Halt seine
    // Rampen mit — vor ihm wird gebremst, danach wieder angefahren, und beides
    // kostet Filmzeit, ohne Strecke zu machen. Ein Klip 20 Filmsekunden hinter
    // dem Anker kommt deshalb weiter vorn heraus als bei einem Moment, der nur
    // seine nackte Dauer kostete.
    const gekuerzt = await rendere({
      schema: 'maptale/edits@1',
      audio: [{ ...spur, versatzFilmS: 20 - 6 }],
    })
    expect(mit.audio?.[0]?.f0).toBeLessThan(gekuerzt.audio?.[0]?.f0 ?? -1)
  })

  it('ein Moment hinter dem Track-Ende verlängert die Achse nicht', async () => {
    // Verworfen wird er ohnehin (er steht nicht in `moments`) — er darf dann
    // auch die Ton-Verankerung nicht anfassen.
    const spur = {
      datei: 'musik.mp3' as const,
      typ: 'musik' as const,
      ab: iso(0),
      anker: iso(0),
      versatzFilmS: 20,
      dauerFilmS: 4,
    }
    const ohne = await rendere({ schema: 'maptale/edits@1', audio: [spur] })
    const dahinter = await rendere({
      schema: 'maptale/edits@1',
      momente: [{ ab: iso(3600), art: 'umkreisen' }],
      audio: [spur],
    })
    expect(dahinter.moments).toBeUndefined()
    expect(dahinter.audio?.[0]?.f0).toBeCloseTo(ohne.audio?.[0]?.f0 ?? -1, 9)
  })

  it('dauerFilmS schlägt „bis" — und gibt auch einem Effekt eine Länge', async () => {
    const tour = await rendere({
      schema: 'maptale/edits@1',
      audio: [
        { datei: 'musik.mp3', typ: 'musik', ab: iso(0), bis: iso(1800), dauerFilmS: 3 },
        { datei: 'knall.wav', typ: 'sfx', ab: iso(300), dauerFilmS: 2 },
      ],
    })
    const musik = tour.audio?.find((a) => a.type === 'music')
    const sfx = tour.audio?.find((a) => a.type === 'sfx')
    expect(musik?.f1).toBeLessThan(1) // „bis Tour-Ende" hätte f1 = 1 ergeben
    expect(sfx?.f1).toBeGreaterThan(sfx?.f0 ?? 1) // heute wäre f1 === f0
  })

  it('schreibt loop und startS nur, wenn sie gesetzt sind', async () => {
    const still = await rendere({
      schema: 'maptale/edits@1',
      audio: [{ datei: 'musik.mp3', typ: 'musik', ab: iso(0) }],
    })
    expect('loop' in (still.audio?.[0] ?? {})).toBe(false)
    expect('startS' in (still.audio?.[0] ?? {})).toBe(false)

    const gesetzt = await rendere({
      schema: 'maptale/edits@1',
      audio: [{ datei: 'musik.mp3', typ: 'musik', ab: iso(0), loop: false, einstiegS: 12.5 }],
    })
    expect(gesetzt.audio?.[0]?.loop).toBe(false)
    expect(gesetzt.audio?.[0]?.startS).toBe(12.5)
  })
})
