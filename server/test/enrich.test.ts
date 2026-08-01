import { describe, expect, it } from 'vitest'
import { bestimmeCover, reichereAn } from '../src/pipeline/enrich.js'
import { FesterGeocoder } from '../src/pipeline/naming.js'
import type { BildBefund } from '../src/pipeline/vision.js'
import { FesteWetterQuelle, testRaster } from '../src/pipeline/weather.js'
import { kollabierePausen } from '../src/pipeline/zeit.js'
import { mediumDateiname, type UploadManifest, type UploadPunkt } from '../src/schema/upload.js'
import { beispielManifest } from './helfer.js'

const bewoelkt = () => new FesteWetterQuelle(testRaster('2026-07-04T06', Array.from({ length: 7 }, () => ({ wolken: 80 }))))
const regnerisch = () =>
  new FesteWetterQuelle(testRaster('2026-07-04T06', Array.from({ length: 7 }, () => ({ code: 61, regenMm: 1, wolken: 95 }))))

const eingabe = (patch: Partial<Parameters<typeof reichereAn>[0]> = {}) => ({
  tourId: 't_test1234',
  nummer: 7,
  manifest: beispielManifest(),
  titelOverride: null,
  beschreibungOverride: null,
  geocoder: new FesterGeocoder(['Lauterbrunnen', 'Grindelwald']),
  ...patch,
})

describe('reichereAn', () => {
  it('rendert ein abspielfertiges Tour-JSON', async () => {
    const tour = await reichereAn(eingabe())
    expect(tour.schema).toBe('maptale/tour@1')
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

  it('rendert Medien mit URL, Uhrzeit-Titel und Anker', async () => {
    const tour = await reichereAn(eingabe())
    expect(tour.media).toHaveLength(1)
    const m = tour.media[0]
    expect(m?.src).toBe('/api/media/t_test1234/m1.jpg')
    expect(m?.title).toBe('Foto · 09:01')
    expect(m?.anchor).toEqual([7.9105, 46.59])
    expect(m?.placement).toBe('gps') // Anker liegt auf dem Track
    expect(m?.caption).toBe('') // ohne Nutzertext bleibt die Unterzeile leer
  })

  it('beschriftetes Foto: Nutzertext wird Überschrift, Uhrzeit die Unterzeile', async () => {
    const manifest = beispielManifest()
    manifest.media[0]!.caption = 'Blick über das Tal'
    const tour = await reichereAn(eingabe({ manifest }))
    const m = tour.media[0]
    expect(m?.title).toBe('Blick über das Tal')
    expect(m?.caption).toBe('Foto · 09:01')
  })

  it('Leerraum als Beschriftung zählt als keine Beschriftung', async () => {
    const manifest = beispielManifest()
    manifest.media[0]!.caption = '   '
    const tour = await reichereAn(eingabe({ manifest }))
    expect(tour.media[0]?.title).toBe('Foto · 09:01')
    expect(tour.media[0]?.caption).toBe('')
  })

  it('Foto außerhalb der Tour-Zeitspanne bekommt keine Uhrzeit', async () => {
    const manifest = beispielManifest()
    // Zeitstempel aus einem mtime-Fallback: liegt Tage neben der Tour
    manifest.media[0]!.takenAt = '2026-07-01T09:01:12+02:00'
    manifest.media[0]!.caption = 'Trotzdem beschriftet'
    const tour = await reichereAn(eingabe({ manifest }))
    expect(tour.media[0]?.title).toBe('Trotzdem beschriftet')
    expect(tour.media[0]?.caption).toBe('Foto')
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
    const videoMeta = new Map([['m2', { dauerS: 12.5, videoDatei: 'm2.web.mp4', posterDatei: 'm2.poster.jpg' }]])
    const tour = await reichereAn(eingabe({ manifest, videoMeta }))
    const v = tour.media.find((m) => m.id === 'm2')
    expect(v?.type).toBe('video')
    expect(v?.src).toBe('/api/media/t_test1234/m2.web.mp4') // transkodierte Datei
    expect(v?.poster).toBe('/api/media/t_test1234/m2.poster.jpg')
    expect(v?.durationS).toBe(12.5)
    expect(v?.title).toBe('Video · 10:15')
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
    const tour = await reichereAn(eingabe({ manifest })) // keine videoMeta
    const v = tour.media.find((m) => m.id === 'm2')
    expect(v?.src).toBe('/api/media/t_test1234/m2.mp4')
    expect(v?.poster).toBeUndefined()
  })

  it('platziert ein Medium ohne Anker per Zeit-Mapping (M6)', async () => {
    const manifest = beispielManifest()
    manifest.media.push({ id: 'm2', type: 'photo', file: 'x.jpg', takenAt: '2026-07-04T10:00:00+02:00' })
    const tour = await reichereAn(eingabe({ manifest }))
    expect(tour.media.map((m) => m.id)).toEqual(['m1', 'm2'])
    const m2 = tour.media.find((m) => m.id === 'm2')
    expect(m2?.placement).toBe('zeit')
    expect(m2?.anchor).not.toBeNull()
  })

  it('lässt ein Medium außerhalb der Tour-Zeit ohne Anker unplatziert (M6)', async () => {
    const manifest = beispielManifest()
    // takenAt VOR time.start (08:12) → keine Track-Zeit, kein GPS → unplatziert
    manifest.media.push({ id: 'm2', type: 'photo', file: 'x.jpg', takenAt: '2026-07-04T06:00:00+02:00' })
    const tour = await reichereAn(eingabe({ manifest }))
    const m2 = tour.media.find((m) => m.id === 'm2')
    expect(m2?.placement).toBe('unplatziert')
    expect(m2?.anchor).toBeNull()
  })

  it('lässt die Uhrzeit im Titel weg, wenn takenAt außerhalb der Tour-Zeit liegt (Bughunt-Befund)', async () => {
    const manifest = beispielManifest()
    // VOR time.start (08:12): mtime-Fallback einer tourfremden Datei —
    // die Uhrzeit wäre Unsinn, der Titel bleibt nackt.
    manifest.media.push({ id: 'vorher', type: 'photo', file: 'x.jpg', takenAt: '2026-07-04T06:00:00+02:00' })
    // NACH time.end (14:03) — Video, gleiche Regel
    manifest.media.push({ id: 'nachher', type: 'video', file: 'y.mp4', takenAt: '2026-07-04T20:00:00+02:00' })
    const tour = await reichereAn(eingabe({ manifest }))
    expect(tour.media.find((m) => m.id === 'vorher')?.title).toBe('Foto')
    expect(tour.media.find((m) => m.id === 'nachher')?.title).toBe('Video')
    // Innerhalb der Spanne bleibt die Uhrzeit
    expect(tour.media.find((m) => m.id === 'm1')?.title).toBe('Foto · 09:01')
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
    const tour = await reichereAn(eingabe({ manifest }))
    expect(tour.media.map((m) => m.id)).toEqual(['m1', 'spaeter'])
  })

  it('respektiert Titel-Override aus der DB', async () => {
    const tour = await reichereAn(eingabe({ titelOverride: 'Mein Tag im Oberland' }))
    expect(tour.brandTitle).toBe('Mein Tag im Oberland')
    expect(tour.titleHtml).toContain('<br />')
  })

  it('Endscreen: Default aus, Zielname aus Override oder Geocoding', async () => {
    const aus = await reichereAn(eingabe())
    expect(aus.showFinale).toBe(false)
    expect(aus.finaleTitle).toBe('Grindelwald')

    const an = await reichereAn(eingabe({ showFinale: true, finaleZielOverride: 'Gletscherschlucht' }))
    expect(an.showFinale).toBe(true)
    expect(an.finaleTitle).toBe('Gletscherschlucht')

    const leer = await reichereAn(eingabe({ showFinale: true, finaleZielOverride: '  ' }))
    expect(leer.finaleTitle).toBe('Grindelwald')
  })

  it('rendert eine monotone timeline aus den Zeit-Offsets (M2)', async () => {
    const tour = await reichereAn(eingabe())
    if (!tour.timeline) throw new Error('timeline erwartet')
    expect(tour.timeline[0]?.f).toBe(0)
    expect(tour.timeline[0]?.t).toBe('2026-07-04T06:12:31Z')
    expect(tour.timeline[tour.timeline.length - 1]?.f).toBe(1)
    for (let i = 1; i < tour.timeline.length; i++) {
      expect(tour.timeline[i]?.f).toBeGreaterThanOrEqual(tour.timeline[i - 1]?.f ?? 0)
      expect(Date.parse(tour.timeline[i]?.t ?? '')).toBeGreaterThanOrEqual(Date.parse(tour.timeline[i - 1]?.t ?? ''))
    }
  })

  it('rendert Auto-Wetter-Keyframes, wenn eine Quelle da ist (M2)', async () => {
    // Tour läuft 06:12–12:02 UTC → 7 Stunden-Raster deckt alle Samples
    const wetter = new FesteWetterQuelle(
      testRaster('2026-07-04T06', Array.from({ length: 7 }, () => ({ wolken: 80 }))),
    )
    const tour = await reichereAn(eingabe({ wetter }))
    expect(tour.weather).toEqual([{ f: 0, mode: 'clouds', k: 0.84, source: 'openmeteo' }])
    expect(wetter.abfragen[0]?.startTag).toBe('2026-07-04')
  })

  it('lässt weather bei Quellen-Ausfall weg statt zu scheitern', async () => {
    const kaputt = new FesteWetterQuelle({ zeiten: [], code: [], wolken: [], regen: [], schnee: [] })
    const meldungen: string[] = []
    const tour = await reichereAn(eingabe({ wetter: kaputt, protokoll: (m) => meldungen.push(m) }))
    expect(tour.status).toBe('bereit')
    expect(tour.weather).toBeUndefined()
    expect(tour.timeline).toBeDefined()
    expect(meldungen[0]).toMatch(/Auto-Wetter nicht verfügbar/)
  })

  // — Wetter-Verfeinerung per Bildanalyse (M5) —

  const gewitterBefund: BildBefund = { himmel: 'bedeckt', niederschlag: 'gewitter', himmelSichtbar: true, konfidenz: 0.9 }

  it('verfeinert das Wetter mit Foto-Befunden: ein source:photo-Keyframe erscheint (M5)', async () => {
    const bildBefunde = new Map<string, BildBefund>([['m1', gewitterBefund]])
    const tour = await reichereAn(eingabe({ wetter: bewoelkt(), bildBefunde }))
    const photo = tour.weather?.filter((w) => w.source === 'photo') ?? []
    expect(photo.length).toBeGreaterThan(0)
    expect(photo.every((w) => w.mode === 'storm')).toBe(true)
    // Die Basis (openmeteo) bleibt außerhalb des Fensters erhalten
    expect(tour.weather?.some((w) => w.source === 'openmeteo' && w.mode === 'clouds')).toBe(true)
  })

  it('lässt API-Niederschlag gegen ein klar-Foto stehen (M5)', async () => {
    const bildBefunde = new Map<string, BildBefund>([
      ['m1', { himmel: 'klar', niederschlag: 'kein', himmelSichtbar: true, konfidenz: 0.95 }],
    ])
    const tour = await reichereAn(eingabe({ wetter: regnerisch(), bildBefunde }))
    expect(tour.weather?.some((w) => w.source === 'photo')).toBeFalsy()
    expect(tour.weather?.every((w) => w.mode === 'rain')).toBe(true)
  })

  it('überspringt unplatzierte Fotos bei der Verfeinerung (M5)', async () => {
    const manifest = beispielManifest()
    // takenAt VOR time.start → unplatziert (kein Anker) → Befund wird ignoriert
    manifest.media.push({ id: 'm2', type: 'photo', file: 'x.jpg', takenAt: '2026-07-04T06:00:00+02:00' })
    const bildBefunde = new Map<string, BildBefund>([['m2', gewitterBefund]])
    const tour = await reichereAn(eingabe({ manifest, wetter: bewoelkt(), bildBefunde }))
    expect(tour.weather?.some((w) => w.source === 'photo')).toBeFalsy()
  })

  it('lässt das Wetter ohne Bild-Befunde exakt wie in M2 (Regressionsschutz)', async () => {
    const tour = await reichereAn(eingabe({ wetter: bewoelkt() }))
    expect(tour.weather).toEqual([{ f: 0, mode: 'clouds', k: 0.84, source: 'openmeteo' }])
  })

  // — Studio-Wetter (edits.wetter) ersetzt das Auto-Wetter vollständig —

  const START_MS = Date.parse(beispielManifest().time.start)
  const abZeit = (offsetS: number): string => new Date(START_MS + offsetS * 1000).toISOString()

  it('edits.wetter ersetzt das Auto-Wetter und ruft die Quelle gar nicht', async () => {
    const wetter = bewoelkt()
    const tour = await reichereAn(
      eingabe({ wetter, edits: { schema: 'maptale/edits@1', wetter: [{ ab: abZeit(0), mode: 'rain' }] } }),
    )
    expect(tour.weather?.every((w) => w.source === 'studio')).toBe(true)
    expect(tour.weather?.every((w) => w.mode === 'rain')).toBe(true) // Grenze am Start → ganze Tour Regen
    expect(wetter.abfragen).toHaveLength(0) // Auto-Wetter-Pfad übersprungen
  })

  it('überspringt bei edits.wetter auch die Foto-Verfeinerung (M5)', async () => {
    const bildBefunde = new Map<string, BildBefund>([['m1', gewitterBefund]])
    const tour = await reichereAn(
      eingabe({
        wetter: bewoelkt(),
        bildBefunde,
        edits: { schema: 'maptale/edits@1', wetter: [{ ab: abZeit(0), mode: 'clouds' }] },
      }),
    )
    expect(tour.weather?.some((w) => w.source === 'photo')).toBeFalsy()
    expect(tour.weather?.every((w) => w.source === 'studio' && w.mode === 'clouds')).toBe(true)
  })

  it('eine Wetter-Grenze in der Mitte schaltet exakt dort um', async () => {
    const tour = await reichereAn(
      eingabe({ edits: { schema: 'maptale/edits@1', wetter: [{ ab: abZeit(10500), mode: 'storm' }] } }),
    )
    const w = tour.weather ?? []
    expect(w[0]).toMatchObject({ f: 0, mode: 'off' }) // Grund vor der Grenze = klar
    expect(w[w.length - 1]).toMatchObject({ f: 1, mode: 'storm' })
    // Umschalt-Paar: zwei Marken auf demselben f, alter → neuer Modus
    const paar = w.findIndex((k, i) => i > 0 && w[i - 1]?.f === k.f && w[i - 1]?.mode === 'off' && k.mode === 'storm')
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
    placement: (anchor ? 'gps' : 'unplatziert') as 'gps' | 'unplatziert',
    takenAt: '2026-07-04T09:01:12+02:00',
  })
  const video = (id: string, poster?: string) => ({
    ...foto(id),
    type: 'video' as const,
    src: `/api/media/t1/${id}.mp4`,
    ...(poster ? { poster } : {}),
  })

  it('nimmt ohne Wahl das erste platzierte Foto', () => {
    expect(bestimmeCover([foto('m1'), foto('m2')])).toBe('/api/media/t1/m1.jpg')
  })

  it('die Wahl des Nutzers gewinnt', () => {
    expect(bestimmeCover([foto('m1'), foto('m2')], 'm2')).toBe('/api/media/t1/m2.jpg')
  })

  it('gewähltes Video liefert sein Standbild', () => {
    expect(bestimmeCover([foto('m1'), video('m2', '/api/media/t1/m2.poster.jpg')], 'm2')).toBe(
      '/api/media/t1/m2.poster.jpg',
    )
  })

  it('zeigt die Wahl ins Leere, wird still das erste Foto genommen', () => {
    // z. B. weil das gewählte Medium inzwischen aus der Tour genommen wurde
    expect(bestimmeCover([foto('m1')], 'geloescht')).toBe('/api/media/t1/m1.jpg')
    // Video ohne Standbild taugt nicht als Titelbild
    expect(bestimmeCover([video('m1'), foto('m2')], 'm1')).toBe('/api/media/t1/m2.jpg')
  })

  it('unplatziertes Foto ist besser als gar keins', () => {
    expect(bestimmeCover([foto('m1', null)])).toBe('/api/media/t1/m1.jpg')
  })

  it('ohne brauchbares Medium bleibt es leer', () => {
    expect(bestimmeCover([])).toBeNull()
    expect(bestimmeCover([video('m1')])).toBeNull()
  })
})

describe('mediumDateiname', () => {
  it('normalisiert jpeg → jpg und nutzt die Medien-ID', () => {
    expect(mediumDateiname({ id: 'abc', type: 'photo', file: 'Foto.JPEG', takenAt: '' })).toBe('abc.jpg')
  })

  it('verweigert unzulässige Endungen', () => {
    expect(() => mediumDateiname({ id: 'abc', type: 'photo', file: 'boese.exe', takenAt: '' })).toThrow(/Unzulässige/)
    expect(() => mediumDateiname({ id: 'abc', type: 'video', file: 'clip.jpg', takenAt: '' })).toThrow(/Unzulässige/)
  })
})

describe('Pausen-Kollaps in der Pipeline (Kette wie in verarbeite)', () => {
  const GRAD_PRO_M = 1 / (111_320 * Math.cos((46.59 * Math.PI) / 180))

  /** Marsch mit 25-min-Drift-Pause (GPS-Zickzack ±60 m) und Foto mittendrin. */
  function manifestMitPause(): UploadManifest {
    const pts: UploadPunkt[] = []
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
      schema: 'maptale/upload@1',
      clientTourId: 'pause-e2e-1',
      title: null,
      description: null,
      time: { start: '2026-07-04T08:00:00+02:00', end: '2026-07-04T09:30:00+02:00', zone: 'Europe/Zurich' },
      segments: [{ mode: 'walk', pts }],
      media: [
        // Mitten in der Pause aufgenommen, OHNE GPS-Anker → Zeit-Mapping
        { id: 'mp1', type: 'photo', file: 'IMG_1.JPG', takenAt: '2026-07-04T08:40:00+02:00', caption: null },
      ],
    }
  }

  it('Drift wird keine Strecke; das Pausen-Foto ankert am Schwerpunkt', async () => {
    const roh = manifestMitPause()
    // verarbeite() setzt manifest.segments = ladeOriginalSegmente(...) — hier
    // dieselbe Kette ohne HTTP: kollabieren, dann rendern.
    const kollabiert = { ...roh, segments: kollabierePausen(roh.segments ?? []) }

    const mitKollaps = await reichereAn(eingabe({ manifest: kollabiert }))
    const ohneKollaps = await reichereAn(eingabe({ manifest: roh }))

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
    const kollabiert = { ...roh, segments: kollabierePausen(roh.segments ?? []) }
    const tour = await reichereAn(eingabe({ manifest: kollabiert }))

    const tl = tour.timeline ?? []
    const letzterPunkt = kollabiert.segments?.[0]?.pts.at(-1)
    const echtesEndeMs = Date.parse(roh.time.start) + (letzterPunkt?.[3] ?? 0) * 1000
    expect(Date.parse(tl.at(-1)?.t ?? '')).toBe(echtesEndeMs)
    expect(tl.at(-1)?.f).toBe(1)
    expect(Date.parse(tl[0]?.t ?? '')).toBe(Date.parse(roh.time.start))
  })

  it('die Pausendauer vergeht auf einem schmalen Stück Strecke (Zeitraffer)', async () => {
    const roh = manifestMitPause()
    const kollabiert = { ...roh, segments: kollabierePausen(roh.segments ?? []) }
    const tl = (await reichereAn(eingabe({ manifest: kollabiert }))).timeline ?? []

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
