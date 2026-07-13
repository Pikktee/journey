// Studio-Upload-Logik (M6): reine Manifest-Bau-Funktionen (src/studio/upload.ts).
// Die EXIF-Byte-Extraktion (exif.ts) und die DOM-Verdrahtung (studio.ts) laufen
// im Browser-E2E, nicht hier.

import { describe, expect, it } from 'vitest'
import {
  baueUploadManifest,
  exifDatumZuMs,
  gpxPunktAnzahl,
  gpxZeitspanne,
  isoMitZone,
  medientyp,
} from '../src/studio/upload'

const GPX = `<gpx><trk><trkseg>
  <trkpt lat="46.5" lon="7.9"><time>2026-07-04T08:00:00Z</time></trkpt>
  <trkpt lat="46.6" lon="7.95"><time>2026-07-04T08:30:00Z</time></trkpt>
  <trkpt lat="46.7" lon="8.0"><time>2026-07-04T09:15:00Z</time></trkpt>
</trkseg></trk></gpx>`

describe('gpxZeitspanne / gpxPunktAnzahl', () => {
  it('liefert früheste und späteste Trackpunkt-Zeit', () => {
    const s = gpxZeitspanne(GPX)
    expect(s?.startMs).toBe(Date.parse('2026-07-04T08:00:00Z'))
    expect(s?.endMs).toBe(Date.parse('2026-07-04T09:15:00Z'))
    expect(gpxPunktAnzahl(GPX)).toBe(3)
  })

  it('gibt null ohne Zeitstempel', () => {
    expect(gpxZeitspanne('<gpx><trkpt lat="1" lon="2"></trkpt></gpx>')).toBeNull()
  })

  it('parst nicht-backtrackend und verlangt eine echte Spanne (Review-Funde)', () => {
    // 100k unvollständige Tags → keine Zeiten → null (linear, kein O(N²)-Hängen)
    expect(gpxZeitspanne(`<gpx>${'<trkpt lat="1" lon="2">'.repeat(100_000)}</gpx>`)).toBeNull()
    // zwei identische Zeiten → keine Spanne → null (verhindert start == end → 400)
    const gleich =
      '<gpx><trkpt lat="1" lon="2"><time>2026-07-04T08:00:00Z</time></trkpt>' +
      '<trkpt lat="1" lon="2"><time>2026-07-04T08:00:00Z</time></trkpt></gpx>'
    expect(gpxZeitspanne(gleich)).toBeNull()
  })
})

describe('medientyp', () => {
  it('unterscheidet Foto/Video/unbekannt', () => {
    expect(medientyp('IMG.JPG')).toBe('photo')
    expect(medientyp('clip.mov')).toBe('video')
    expect(medientyp('clip.mp4')).toBe('video')
    expect(medientyp('notiz.txt')).toBeNull()
  })
})

describe('isoMitZone / exifDatumZuMs', () => {
  it('formatiert mit Zonen-Offset', () => {
    expect(isoMitZone(Date.parse('2026-07-04T08:00:00Z'), 'UTC')).toBe('2026-07-04T08:00:00+00:00')
    // Sommerzeit Berlin = +02:00
    expect(isoMitZone(Date.parse('2026-07-04T06:00:00Z'), 'Europe/Berlin')).toBe('2026-07-04T08:00:00+02:00')
  })

  it('deutet zonenlose EXIF-Zeit in der Tour-Zone', () => {
    const d = { y: 2026, mo: 7, d: 4, hh: 8, mm: 0, ss: 0 }
    expect(exifDatumZuMs(d, 'UTC')).toBe(Date.parse('2026-07-04T08:00:00Z'))
    // 08:00 Berliner Sommerzeit = 06:00 UTC
    expect(exifDatumZuMs(d, 'Europe/Berlin')).toBe(Date.parse('2026-07-04T06:00:00Z'))
  })
})

describe('baueUploadManifest', () => {
  it('baut ein trackFile-Manifest mit Zeit und Medien', () => {
    const m = baueUploadManifest({
      clientTourId: 'studio:tour.gpx:123',
      title: 'Mein Tag',
      zeitspanne: { startMs: Date.parse('2026-07-04T08:00:00Z'), endMs: Date.parse('2026-07-04T09:00:00Z') },
      zone: 'UTC',
      trackMode: 'bike',
      medien: [{ id: 'm1', type: 'photo', file: 'a.jpg', takenAt: '2026-07-04T08:10:00+00:00', anchor: [7.9, 46.5] }],
    })
    expect(m.schema).toBe('luhambo/upload@1')
    expect(m.trackFile).toBe('track.gpx')
    expect(m.trackMode).toBe('bike')
    expect(m.time.start).toBe('2026-07-04T08:00:00+00:00')
    expect(m.media[0]?.anchor).toEqual([7.9, 46.5])
    expect(m.title).toBe('Mein Tag')
  })
})
