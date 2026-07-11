import { describe, expect, it } from 'vitest'
import { reichereAn } from '../src/pipeline/enrich.js'
import { FesterGeocoder } from '../src/pipeline/naming.js'
import { FesteWetterQuelle, testRaster } from '../src/pipeline/weather.js'
import { mediumDateiname } from '../src/schema/upload.js'
import { beispielManifest } from './helfer.js'

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
  })

  it('lässt Medien ohne Anker in M1 weg', async () => {
    const manifest = beispielManifest()
    manifest.media.push({ id: 'm2', type: 'photo', file: 'x.jpg', takenAt: '2026-07-04T10:00:00+02:00' })
    const tour = await reichereAn(eingabe({ manifest }))
    expect(tour.media.map((m) => m.id)).toEqual(['m1'])
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
