import { describe, expect, it } from 'vitest'
import { chooseCover, enrichTour } from '../src/pipeline/enrich.js'
import { distanceM } from '../src/pipeline/geo.js'
import { FixedGeocoder } from '../src/pipeline/naming.js'
import type { ImageFinding } from '../src/pipeline/vision.js'
import { FixedWeatherSource, testGrid } from '../src/pipeline/weather.js'
import { collapsePauses } from '../src/pipeline/time.js'
import { mediumFilename, type UploadManifest, type UploadPoint } from '../src/schema/upload.js'
import { beispielManifest } from './helfer.js'

const bewoelkt = () =>
  new FixedWeatherSource(
    testGrid(
      '2026-07-04T06',
      Array.from({ length: 7 }, () => ({ wolken: 80 })),
    ),
  )
const regnerisch = () =>
  new FixedWeatherSource(
    testGrid(
      '2026-07-04T06',
      Array.from({ length: 7 }, () => ({ code: 61, regenMm: 1, wolken: 95 })),
    ),
  )

const eingabe = (patch: Partial<Parameters<typeof enrichTour>[0]> = {}) => ({
  tourId: 't_test1234',
  nummer: 7,
  manifest: beispielManifest(),
  titelOverride: null,
  beschreibungOverride: null,
  geocoder: new FixedGeocoder(['Lauterbrunnen', 'Grindelwald']),
  ...patch,
})

describe('reichereAn', () => {
  it('rendert ein abspielfertiges Tour-JSON', async () => {
    const tour = await enrichTour(eingabe())
    expect(tour.schema).toBe('maptale/tour@2')
    expect(tour.no).toBe('N°07')
    expect(tour.brandTitle).toBe('Lauterbrunnen → Grindelwald')
    expect(tour.stops).toEqual(['Lauterbrunnen', 'Grindelwald'])
    expect(tour.showFinale).toBe(false)
    expect(tour.finaleTitle).toBe('Grindelwald')
    expect(tour.time.zone).toBe('Europe/Zurich')
    // Segmente: Modus + Label + Punkte OHNE Zeit-Offset
    expect(tour.segments).toHaveLength(2)
    expect(tour.segments[0]?.label).toBe('Zu Fuß')
    expect(tour.segments[0]?.pts[0]).toHaveLength(3)
    expect(tour.stats.km).toBeGreaterThan(9)
  })

  // E11 (Gleichlauf-Konzept §8D): Ohne dieses Feld muss der Player `f × total`
  // auf seiner 2–3 % längeren Catmull-Rom-Route rechnen, und der Fehler ist
  // ungleichmäßig verteilt.
  it('schickt je ausgeliefertem Wegpunkt sein f mit', async () => {
    const tour = await enrichTour(eingabe())
    const alle: number[] = []
    for (const seg of tour.segments) {
      expect(seg.f).toHaveLength(seg.pts.length)
      alle.push(...(seg.f as number[]))
    }
    // Über alle Segmente hinweg monoton von 0 bis 1 — der Nahtpunkt kommt
    // zweimal vor (der Player wirft die Kopie mit `slice(1)` weg) und trägt
    // deshalb beide Male denselben Wert.
    expect(alle[0]).toBe(0)
    expect(alle.at(-1)).toBeCloseTo(1, 12)
    for (let i = 1; i < alle.length; i++)
      expect(alle[i]).toBeGreaterThanOrEqual(alle[i - 1] as number)
    const naht = tour.segments[0]?.f?.at(-1)
    expect(tour.segments[1]?.f?.[0]).toBe(naht)
  })

  it('misst f auf der ROHEN Geometrie, nicht auf den ausgelieferten Punkten', async () => {
    // Ein Bogen mit vielen Zwischenpunkten: Douglas-Peucker wirft sie weg,
    // ihre Länge bleibt im `f`. Würde `f` aus den gelieferten Punkten gerechnet,
    // läge der Mittelpunkt woanders.
    const manifest = beispielManifest()
    const bogen: UploadPoint[] = Array.from({ length: 41 }, (_, i) => {
      const t = i / 40
      return [8 + t * 0.02, 46 + Math.sin(t * Math.PI) * 0.004, 500, i * 30]
    })
    manifest.segments = [{ mode: 'walk', pts: bogen }]
    manifest.media = []
    const tour = await enrichTour(eingabe({ manifest }))
    const seg = tour.segments[0]
    expect(seg?.pts.length).toBeLessThan(bogen.length) // vereinfacht
    // f des zweiten gelieferten Punktes = Rohdistanz bis dorthin / Gesamt-Roh
    const rohBis = (bis: number) => {
      let m = 0
      for (let i = 1; i <= bis; i++)
        m += distanceM(bogen[i - 1] as UploadPoint, bogen[i] as UploadPoint)
      return m
    }
    const zweiter = seg?.pts[1] as [number, number, number]
    const idx = bogen.findIndex((p) => p[0] === zweiter[0] && p[1] === zweiter[1])
    expect(idx).toBeGreaterThan(0)
    // Auf 8 Nachkommastellen — genau die Rundung, mit der `f` geschrieben wird.
    expect(seg?.f?.[1]).toBeCloseTo(rohBis(idx) / rohBis(bogen.length - 1), 8)
  })

  it('schreibt f gerundet — sonst kostet das Feld mehr als die Achse, die §12 ablehnt', () => {
    // Roh serialisiert JSON bis zu 17 signifikante Stellen (~21 Zeichen je
    // Punkt): +19,8 % auf das größte lokale tour.json gegen +11,2 % gerundet.
    // Acht Nachkommastellen sind bei 41,8 km ein Weg von 0,4 mm — die Grenze
    // liegt weit jenseits dessen, was die Route auflöst (14-m-Raster).
    const lang = (x: number) => (String(x).split('.')[1] ?? '').length
    return enrichTour(eingabe()).then((tour) => {
      const stellen = tour.segments.flatMap((s) => s.f ?? []).map(lang)
      expect(stellen.length).toBeGreaterThan(0)
      expect(Math.max(...stellen)).toBeLessThanOrEqual(8)
    })
  })

  it('rendert Medien mit URL und Anker, ohne erfundene Texte', async () => {
    const tour = await enrichTour(eingabe())
    expect(tour.media).toHaveLength(1)
    const m = tour.media[0]
    expect(m?.src).toBe('/api/media/t_test1234/m1.jpg')
    // Ohne Beschriftung bleiben BEIDE Felder leer: „Foto · 09:01" stand als
    // Titel in der größten Schrift der Karte und sagte, was man dem Bild
    // ohnehin ansieht. Die Uhrzeit ist eine Angabe und kein Text — der Player
    // setzt sie aus `takenAt` neben den Kilometerstand.
    expect(m?.title).toBe('')
    expect(m?.anchor).toEqual([7.9105, 46.59])
    expect(m?.placement).toBe('gps') // Anker liegt auf dem Track
    expect(m?.caption).toBe('')
    expect(m?.takenAt).toBe('2026-07-04T09:01:12+02:00')
  })

  it('beschriftetes Foto: der Nutzertext wird die Überschrift', async () => {
    const manifest = beispielManifest()
    manifest.media[0]!.caption = 'Blick über das Tal'
    const tour = await enrichTour(eingabe({ manifest }))
    const m = tour.media[0]
    expect(m?.title).toBe('Blick über das Tal')
    expect(m?.caption).toBe('')
  })

  it('Leerraum als Beschriftung zählt als keine Beschriftung', async () => {
    const manifest = beispielManifest()
    manifest.media[0]!.caption = '   '
    const tour = await enrichTour(eingabe({ manifest }))
    expect(tour.media[0]?.title).toBe('')
    expect(tour.media[0]?.caption).toBe('')
  })

  it('Foto außerhalb der Tour-Zeitspanne bekommt keine Uhrzeit', async () => {
    const manifest = beispielManifest()
    // Zeitstempel aus einem mtime-Fallback: liegt Tage neben der Tour
    manifest.media[0]!.takenAt = '2026-07-01T09:01:12+02:00'
    manifest.media[0]!.caption = 'Trotzdem beschriftet'
    const tour = await enrichTour(eingabe({ manifest }))
    expect(tour.media[0]?.title).toBe('Trotzdem beschriftet')
    // Keine Uhrzeit, und die Gattung ist kein Ersatz dafür: Die Unterzeile
    // bleibt leer, statt „Foto" zu behaupten.
    expect(tour.media[0]?.caption).toBe('')
  })

  it('setzt Video-Src, Poster und Dauer aus der Aufbereitung (M4)', async () => {
    const manifest = beispielManifest()
    manifest.media.push({
      id: 'm2',
      type: 'video',
      file: 'VID_0007.mov',
      takenAt: '2026-07-04T10:15:00+02:00',
      anchor: [7.9142, 46.5872],
      caption: null,
    })
    const videoMeta = new Map([
      ['m2', { durationS: 12.5, videoFile: 'm2.web.mp4', posterFile: 'm2.poster.jpg' }],
    ])
    const tour = await enrichTour(eingabe({ manifest, videoMeta }))
    const v = tour.media.find((m) => m.id === 'm2')
    expect(v?.type).toBe('video')
    expect(v?.src).toBe('/api/media/t_test1234/m2.web.mp4') // transkodierte Datei
    expect(v?.poster).toBe('/api/media/t_test1234/m2.poster.jpg')
    expect(v?.durationS).toBe(12.5)
    expect(v?.title).toBe('')
  })

  it('fällt ohne Video-Aufbereitung auf das Original ohne Poster zurück', async () => {
    const manifest = beispielManifest()
    manifest.media.push({
      id: 'm2',
      type: 'video',
      file: 'VID.mp4',
      takenAt: '2026-07-04T10:15:00+02:00',
      anchor: [7.9142, 46.5872],
    })
    const tour = await enrichTour(eingabe({ manifest })) // keine videoMeta
    const v = tour.media.find((m) => m.id === 'm2')
    expect(v?.src).toBe('/api/media/t_test1234/m2.mp4')
    expect(v?.poster).toBeUndefined()
  })

  it('platziert ein Medium ohne Anker per Zeit-Mapping (M6)', async () => {
    const manifest = beispielManifest()
    manifest.media.push({
      id: 'm2',
      type: 'photo',
      file: 'x.jpg',
      takenAt: '2026-07-04T10:00:00+02:00',
    })
    const tour = await enrichTour(eingabe({ manifest }))
    expect(tour.media.map((m) => m.id)).toEqual(['m1', 'm2'])
    const m2 = tour.media.find((m) => m.id === 'm2')
    expect(m2?.placement).toBe('time')
    expect(m2?.anchor).not.toBeNull()
  })

  it('lässt ein Medium außerhalb der Tour-Zeit ohne Anker unplatziert (M6)', async () => {
    const manifest = beispielManifest()
    // takenAt VOR time.start (08:12) → keine Track-Zeit, kein GPS → unplatziert
    manifest.media.push({
      id: 'm2',
      type: 'photo',
      file: 'x.jpg',
      takenAt: '2026-07-04T06:00:00+02:00',
    })
    const tour = await enrichTour(eingabe({ manifest }))
    const m2 = tour.media.find((m) => m.id === 'm2')
    expect(m2?.placement).toBe('unplaced')
    expect(m2?.anchor).toBeNull()
  })

  it('reicht auch tourfremde Zeitstempel durch — geprüft wird beim Anzeigen', async () => {
    const manifest = beispielManifest()
    // VOR time.start (08:12) bzw. NACH time.end (14:03): mtime-Fallback
    // tourfremder Dateien. Die Uhrzeit wäre Unsinn — sie wird deshalb NICHT
    // angezeigt, aber das entscheidet der Player (`UI.zeitfenster` in
    // src/ui.ts), nicht die Pipeline: `takenAt` bleibt roh im JSON, weil das
    // Auto-Wetter und die Sortierung daran hängen.
    manifest.media.push({
      id: 'vorher',
      type: 'photo',
      file: 'x.jpg',
      takenAt: '2026-07-04T06:00:00+02:00',
    })
    manifest.media.push({
      id: 'nachher',
      type: 'video',
      file: 'y.mp4',
      takenAt: '2026-07-04T20:00:00+02:00',
    })
    const tour = await enrichTour(eingabe({ manifest }))
    expect(tour.media.find((m) => m.id === 'vorher')?.takenAt).toBe('2026-07-04T06:00:00+02:00')
    expect(tour.media.find((m) => m.id === 'nachher')?.takenAt).toBe('2026-07-04T20:00:00+02:00')
    expect(tour.media.every((m) => m.title === '' || m.title.length > 0)).toBe(true)
  })

  it('sortiert Medien nach Aufnahmezeit', async () => {
    const manifest = beispielManifest()
    manifest.media.unshift({
      id: 'spaeter',
      type: 'photo',
      file: 'y.jpg',
      takenAt: '2026-07-04T13:00:00+02:00',
      anchor: [8.03, 46.62],
    })
    const tour = await enrichTour(eingabe({ manifest }))
    expect(tour.media.map((m) => m.id)).toEqual(['m1', 'spaeter'])
  })

  it('respektiert Titel-Override aus der DB', async () => {
    const tour = await enrichTour(eingabe({ titelOverride: 'Mein Tag im Oberland' }))
    expect(tour.brandTitle).toBe('Mein Tag im Oberland')
    expect(tour.titleHtml).toContain('<br />')
  })

  it('Endscreen: Default aus, Zielname aus Override oder Geocoding', async () => {
    const aus = await enrichTour(eingabe())
    expect(aus.showFinale).toBe(false)
    expect(aus.finaleTitle).toBe('Grindelwald')

    const an = await enrichTour(
      eingabe({ showFinale: true, finaleZielOverride: 'Gletscherschlucht' }),
    )
    expect(an.showFinale).toBe(true)
    expect(an.finaleTitle).toBe('Gletscherschlucht')

    const leer = await enrichTour(eingabe({ showFinale: true, finaleZielOverride: '  ' }))
    expect(leer.finaleTitle).toBe('Grindelwald')
  })

  it('rendert eine monotone timeline aus den Zeit-Offsets (M2)', async () => {
    const tour = await enrichTour(eingabe())
    if (!tour.timeline) throw new Error('timeline erwartet')
    expect(tour.timeline[0]?.f).toBe(0)
    expect(tour.timeline[0]?.t).toBe('2026-07-04T06:12:31Z')
    expect(tour.timeline[tour.timeline.length - 1]?.f).toBe(1)
    for (let i = 1; i < tour.timeline.length; i++) {
      expect(tour.timeline[i]?.f).toBeGreaterThanOrEqual(tour.timeline[i - 1]?.f ?? 0)
      expect(Date.parse(tour.timeline[i]?.t ?? '')).toBeGreaterThanOrEqual(
        Date.parse(tour.timeline[i - 1]?.t ?? ''),
      )
    }
  })

  it('rendert Auto-Wetter-Keyframes, wenn eine Quelle da ist (M2)', async () => {
    // Tour läuft 06:12–12:02 UTC → 7 Stunden-Raster deckt alle Samples
    const wetter = new FixedWeatherSource(
      testGrid(
        '2026-07-04T06',
        Array.from({ length: 7 }, () => ({ wolken: 80 })),
      ),
    )
    const tour = await enrichTour(eingabe({ wetter }))
    expect(tour.weather).toEqual([{ f: 0, mode: 'clouds', k: 0.84, source: 'openmeteo' }])
    expect(wetter.abfragen[0]?.startTag).toBe('2026-07-04')
  })

  it('lässt weather bei Quellen-Ausfall weg statt zu scheitern', async () => {
    const kaputt = new FixedWeatherSource({
      zeiten: [],
      code: [],
      wolken: [],
      regen: [],
      schnee: [],
    })
    const meldungen: string[] = []
    const tour = await enrichTour(
      eingabe({ wetter: kaputt, protokoll: (m: string) => meldungen.push(m) }),
    )
    expect(tour.status).toBe('ready')
    expect(tour.weather).toBeUndefined()
    expect(tour.timeline).toBeDefined()
    expect(meldungen[0]).toMatch(/Auto-Wetter nicht verfügbar/)
  })

  // — Wetter-Verfeinerung per Bildanalyse (M5) —

  const gewitterBefund: ImageFinding = {
    himmel: 'bedeckt',
    niederschlag: 'gewitter',
    himmelSichtbar: true,
    konfidenz: 0.9,
  }

  it('verfeinert das Wetter mit Foto-Befunden: ein source:photo-Keyframe erscheint (M5)', async () => {
    const bildBefunde = new Map<string, ImageFinding>([['m1', gewitterBefund]])
    const tour = await enrichTour(eingabe({ wetter: bewoelkt(), bildBefunde }))
    const photo = tour.weather?.filter((w) => w.source === 'photo') ?? []
    expect(photo.length).toBeGreaterThan(0)
    expect(photo.every((w) => w.mode === 'storm')).toBe(true)
    // Die Basis (openmeteo) bleibt außerhalb des Fensters erhalten
    expect(tour.weather?.some((w) => w.source === 'openmeteo' && w.mode === 'clouds')).toBe(true)
  })

  it('lässt API-Niederschlag gegen ein klar-Foto stehen (M5)', async () => {
    const bildBefunde = new Map<string, ImageFinding>([
      ['m1', { himmel: 'klar', niederschlag: 'kein', himmelSichtbar: true, konfidenz: 0.95 }],
    ])
    const tour = await enrichTour(eingabe({ wetter: regnerisch(), bildBefunde }))
    expect(tour.weather?.some((w) => w.source === 'photo')).toBeFalsy()
    expect(tour.weather?.every((w) => w.mode === 'rain')).toBe(true)
  })

  it('überspringt unplatzierte Fotos bei der Verfeinerung (M5)', async () => {
    const manifest = beispielManifest()
    // takenAt VOR time.start → unplatziert (kein Anker) → Befund wird ignoriert
    manifest.media.push({
      id: 'm2',
      type: 'photo',
      file: 'x.jpg',
      takenAt: '2026-07-04T06:00:00+02:00',
    })
    const bildBefunde = new Map<string, ImageFinding>([['m2', gewitterBefund]])
    const tour = await enrichTour(eingabe({ manifest, wetter: bewoelkt(), bildBefunde }))
    expect(tour.weather?.some((w) => w.source === 'photo')).toBeFalsy()
  })

  it('lässt das Wetter ohne Bild-Befunde exakt wie in M2 (Regressionsschutz)', async () => {
    const tour = await enrichTour(eingabe({ wetter: bewoelkt() }))
    expect(tour.weather).toEqual([{ f: 0, mode: 'clouds', k: 0.84, source: 'openmeteo' }])
  })

  // — Studio-Wetter (edits.weather) ersetzt das Auto-Wetter vollständig —

  const START_MS = Date.parse(beispielManifest().time.start)
  const abZeit = (offsetS: number): string => new Date(START_MS + offsetS * 1000).toISOString()

  it('edits.weather ersetzt das Auto-Wetter und ruft die Quelle gar nicht', async () => {
    const wetter = bewoelkt()
    const tour = await enrichTour(
      eingabe({
        wetter,
        edits: { schema: 'maptale/edits@2', weather: [{ from: abZeit(0), mode: 'rain' }] },
      }),
    )
    expect(tour.weather?.every((w) => w.source === 'studio')).toBe(true)
    expect(tour.weather?.every((w) => w.mode === 'rain')).toBe(true) // Grenze am Start → ganze Tour Regen
    expect(wetter.abfragen).toHaveLength(0) // Auto-Wetter-Pfad übersprungen
  })

  it('überspringt bei edits.weather auch die Foto-Verfeinerung (M5)', async () => {
    const bildBefunde = new Map<string, ImageFinding>([['m1', gewitterBefund]])
    const tour = await enrichTour(
      eingabe({
        wetter: bewoelkt(),
        bildBefunde,
        edits: { schema: 'maptale/edits@2', weather: [{ from: abZeit(0), mode: 'clouds' }] },
      }),
    )
    expect(tour.weather?.some((w) => w.source === 'photo')).toBeFalsy()
    expect(tour.weather?.every((w) => w.source === 'studio' && w.mode === 'clouds')).toBe(true)
  })

  it('eine Wetter-Grenze in der Mitte schaltet exakt dort um', async () => {
    const tour = await enrichTour(
      eingabe({
        edits: { schema: 'maptale/edits@2', weather: [{ from: abZeit(10500), mode: 'storm' }] },
      }),
    )
    const w = tour.weather ?? []
    expect(w[0]).toMatchObject({ f: 0, mode: 'off' }) // Grund vor der Grenze = klar
    expect(w[w.length - 1]).toMatchObject({ f: 1, mode: 'storm' })
    // Umschalt-Paar: zwei Marken auf demselben f, alter → neuer Modus
    const paar = w.findIndex(
      (k, i) => i > 0 && w[i - 1]?.f === k.f && w[i - 1]?.mode === 'off' && k.mode === 'storm',
    )
    expect(paar).toBeGreaterThan(0)
  })
})

describe('bestimmeCover', () => {
  const foto = (id: string, anchor: [number, number] | null = [7.9, 46.6]) => ({
    id,
    type: 'photo' as const,
    src: `/api/media/t1/${id}.jpg`,
    title: '',
    caption: '',
    anchor,
    placement: (anchor ? 'gps' : 'unplaced') as 'gps' | 'unplaced',
    takenAt: '2026-07-04T09:01:12+02:00',
  })
  const video = (id: string, poster?: string) => ({
    ...foto(id),
    type: 'video' as const,
    src: `/api/media/t1/${id}.mp4`,
    ...(poster ? { poster } : {}),
  })

  it('nimmt ohne Wahl das erste platzierte Foto', () => {
    expect(chooseCover([foto('m1'), foto('m2')])?.cover).toBe('/api/media/t1/m1.jpg')
  })

  it('die Wahl des Nutzers gewinnt', () => {
    expect(chooseCover([foto('m1'), foto('m2')], 'm2')?.cover).toBe('/api/media/t1/m2.jpg')
  })

  it('gewähltes Video liefert sein Standbild', () => {
    expect(chooseCover([foto('m1'), video('m2', '/api/media/t1/m2.poster.jpg')], 'm2')?.cover).toBe(
      '/api/media/t1/m2.poster.jpg',
    )
  })

  it('zeigt die Wahl ins Leere, wird still das erste Foto genommen', () => {
    // z. B. weil das gewählte Medium inzwischen aus der Tour genommen wurde
    expect(chooseCover([foto('m1')], 'geloescht')?.cover).toBe('/api/media/t1/m1.jpg')
    // Video ohne Standbild taugt nicht als Titelbild
    expect(chooseCover([video('m1'), foto('m2')], 'm1')?.cover).toBe('/api/media/t1/m2.jpg')
  })

  it('unplatziertes Foto ist besser als gar keins', () => {
    expect(chooseCover([foto('m1', null)])?.cover).toBe('/api/media/t1/m1.jpg')
  })

  it('ohne brauchbares Medium bleibt es leer', () => {
    expect(chooseCover([])).toBeNull()
    expect(chooseCover([video('m1')])).toBeNull()
  })
})

describe('mediumDateiname', () => {
  it('normalisiert jpeg → jpg und nutzt die Medien-ID', () => {
    expect(mediumFilename({ id: 'abc', type: 'photo', file: 'Foto.JPEG', takenAt: '' })).toBe(
      'abc.jpg',
    )
  })

  it('verweigert unzulässige Endungen', () => {
    expect(() =>
      mediumFilename({ id: 'abc', type: 'photo', file: 'boese.exe', takenAt: '' }),
    ).toThrow(/Unzulässige/)
    expect(() =>
      mediumFilename({ id: 'abc', type: 'video', file: 'clip.jpg', takenAt: '' }),
    ).toThrow(/Unzulässige/)
  })
})

describe('Pausen-Kollaps in der Pipeline (Kette wie in processTour)', () => {
  const GRAD_PRO_M = 1 / (111_320 * Math.cos((46.59 * Math.PI) / 180))

  /** Marsch mit 25-min-Drift-Pause (GPS-Zickzack ±60 m) und Foto mittendrin. */
  function manifestMitPause(): UploadManifest {
    const pts: UploadPoint[] = []
    let strecke = 0
    for (let t = 0; t <= 5400; t += 30) {
      if (t >= 1800 && t < 3300) {
        pts.push([
          7.9 + (strecke + Math.sin(t / 90) * 60) * GRAD_PRO_M,
          46.59 + Math.cos(t / 70) * 30 * GRAD_PRO_M,
          800,
          t,
        ])
      } else {
        pts.push([7.9 + strecke * GRAD_PRO_M, 46.59, 800, t])
        strecke += 1.5 * 30
      }
    }
    return {
      schema: 'maptale/upload@2',
      clientTourId: 'pause-e2e-1',
      title: null,
      description: null,
      time: {
        start: '2026-07-04T08:00:00+02:00',
        end: '2026-07-04T09:30:00+02:00',
        zone: 'Europe/Zurich',
      },
      segments: [{ mode: 'walk', pts }],
      media: [
        // Mitten in der Pause aufgenommen, OHNE GPS-Anker → Zeit-Mapping
        {
          id: 'mp1',
          type: 'photo',
          file: 'IMG_1.JPG',
          takenAt: '2026-07-04T08:40:00+02:00',
          caption: null,
        },
      ],
    }
  }

  it('Drift wird keine Strecke; das Pausen-Foto ankert am Schwerpunkt', async () => {
    const roh = manifestMitPause()
    // processTour() setzt manifest.segments = ladeOriginalSegmente(...) — hier
    // dieselbe Kette ohne HTTP: kollabieren, dann rendern.
    const kollabiert = { ...roh, segments: collapsePauses(roh.segments ?? []) }

    const mitKollaps = await enrichTour(eingabe({ manifest: kollabiert }))
    const ohneKollaps = await enrichTour(eingabe({ manifest: roh }))

    // Das GPS-Zickzack der Pause (≈ 1 km Fake-Strecke) verschwindet
    expect(ohneKollaps.stats.km - mitKollaps.stats.km).toBeGreaterThan(0.5)
    expect(mitKollaps.stats.km).toBeGreaterThan(5.5)
    expect(mitKollaps.stats.km).toBeLessThan(6.2)

    // Zeit-gemapptes Foto liegt exakt auf dem Kollaps-Ort
    const seg = kollabiert.segments?.[0]
    const punktInPause = seg?.pts.find((p) => p[3] >= 2300 && p[3] <= 2500)
    const anker = mitKollaps.media[0]?.anchor
    expect(punktInPause).toBeDefined()
    expect(anker?.[0]).toBeCloseTo(punktInPause?.[0] ?? 0, 6)
    expect(anker?.[1]).toBeCloseTo(punktInPause?.[1] ?? 0, 6)

    // Timeline bleibt monoton (die Pause ist dort eine sehr steile Rampe)
    const tl = mitKollaps.timeline ?? []
    expect(tl.length).toBeGreaterThanOrEqual(2)
    for (let i = 1; i < tl.length; i++) {
      expect(tl[i]?.f).toBeGreaterThanOrEqual(tl[i - 1]?.f ?? 0)
    }
  })

  it('die Uhr am Tourende zeigt die echte Endzeit, nicht Stunden zu früh', async () => {
    // Der Fehler, der das ausgelöst hat: Nach zwei Stunden Kino-Pause endete die
    // Anzeige um 20:51, während die Fotos derselben Minuten mit „22:48"
    // untertitelt waren. Die Pause wurde aus der Uhr herausgekürzt, statt
    // gerafft zu werden.
    const roh = manifestMitPause()
    const kollabiert = { ...roh, segments: collapsePauses(roh.segments ?? []) }
    const tour = await enrichTour(eingabe({ manifest: kollabiert }))

    const tl = tour.timeline ?? []
    const letzterPunkt = kollabiert.segments?.[0]?.pts.at(-1)
    const echtesEndeMs = Date.parse(roh.time.start) + (letzterPunkt?.[3] ?? 0) * 1000
    expect(Date.parse(tl.at(-1)?.t ?? '')).toBe(echtesEndeMs)
    expect(tl.at(-1)?.f).toBe(1)
    expect(Date.parse(tl[0]?.t ?? '')).toBe(Date.parse(roh.time.start))
  })

  it('die Pausendauer vergeht auf einem schmalen Stück Strecke (Zeitraffer)', async () => {
    const roh = manifestMitPause()
    const kollabiert = { ...roh, segments: collapsePauses(roh.segments ?? []) }
    const tl = (await enrichTour(eingabe({ manifest: kollabiert }))).timeline ?? []

    let steilstesDt = 0
    let steilstesDf = 1
    for (let i = 1; i < tl.length; i++) {
      const dt = (Date.parse(tl[i]!.t) - Date.parse(tl[i - 1]!.t)) / 1000
      const df = tl[i]!.f - tl[i - 1]!.f
      if (df > 0 && dt / df > steilstesDt / steilstesDf) {
        steilstesDt = dt
        steilstesDf = df
      }
    }
    // Die 25-min-Pause steckt im steilsten Abschnitt, der nur wenige Prozent
    // der Strecke breit ist — dort dreht der Himmel im Schnelldurchlauf.
    expect(steilstesDt).toBeGreaterThan(1200)
    expect(steilstesDf).toBeLessThan(0.06)
  })
})
