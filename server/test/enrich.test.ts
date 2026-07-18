import { describe, expect, it } from 'vitest'
import { reichereAn } from '../src/pipeline/enrich.js'
import { FesterGeocoder } from '../src/pipeline/naming.js'
import type { BildBefund } from '../src/pipeline/vision.js'
import { FesteWetterQuelle, testRaster } from '../src/pipeline/weather.js'
import { mediumDateiname } from '../src/schema/upload.js'
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
    expect(tour.schema).toBe('luhambo/tour@1')
    expect(tour.no).toBe('N°07')
    expect(tour.brandTitle).toBe('Lauterbrunnen → Grindelwald')
    expect(tour.stops).toEqual(['Lauterbrunnen', 'Grindelwald'])
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
