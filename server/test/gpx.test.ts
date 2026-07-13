// GPX-Parsing + Segment-Bau (M6): reine Funktionen über GPX-XML.
import { describe, expect, it } from 'vitest'
import { baueSegmentAusGpx, modusAusTempo, parseGpx } from '../src/pipeline/gpx.js'

const GPX_MIT_ZEIT = `<?xml version="1.0"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1">
  <trk><trkseg>
    <trkpt lat="46.5934" lon="7.9086"><ele>800.0</ele><time>2026-07-04T08:00:00Z</time></trkpt>
    <trkpt lat="46.5900" lon="7.9105"><ele>830.5</ele><time>2026-07-04T08:10:00Z</time></trkpt>
    <trkpt lat="46.5872" lon="7.9142"><ele>905.0</ele><time>2026-07-04T08:30:00Z</time></trkpt>
  </trkseg></trk>
</gpx>`

const GPX_OHNE_ZEIT = `<gpx>
  <trkpt lat="46.5934" lon="7.9086"><ele>800</ele></trkpt>
  <trkpt lat="46.5900" lon="7.9105"><ele>830</ele></trkpt>
</gpx>`

describe('parseGpx', () => {
  it('liest Trackpunkte mit lng/lat/ele/time', () => {
    const p = parseGpx(GPX_MIT_ZEIT)
    expect(p).toHaveLength(3)
    expect(p[0]).toEqual({ lng: 7.9086, lat: 46.5934, ele: 800, timeMs: Date.parse('2026-07-04T08:00:00Z') })
    expect(p[2]?.ele).toBe(905)
  })

  it('setzt timeMs null, wenn keine <time> vorhanden ist', () => {
    const p = parseGpx(GPX_OHNE_ZEIT)
    expect(p).toHaveLength(2)
    expect(p[0]?.timeMs).toBeNull()
    expect(p[0]?.lng).toBe(7.9086)
  })

  it('ignoriert Punkte ohne lat/lon', () => {
    expect(parseGpx('<gpx><trkpt lat="1.0"></trkpt></gpx>')).toHaveLength(0)
  })

  it('parst linear bei 100k unvollständigen Tags — Review-Fund DoS', () => {
    // 100 000 öffnende <trkpt ohne Schluss-Tag (2,3 MB). Sowohl die lazy Regex
    // als auch ein unbeschränktes indexOf('</trkpt>') sind hier O(N²) (→ Minuten,
    // Vitest-Timeout schlägt an); der Fenster-Parser ist ~30 ms.
    const boese = `<gpx>${'<trkpt lat="1" lon="2">'.repeat(100_000)}</gpx>`
    expect(parseGpx(boese)).toHaveLength(100_000)
  })

  it('behandelt kaputtes <ele> als 0 statt NaN', () => {
    const p = parseGpx('<gpx><trkpt lat="46" lon="7"><ele>abc</ele></trkpt><trkpt lat="47" lon="8"><ele>100</ele></trkpt></gpx>')
    expect(p[0]?.ele).toBe(0)
    expect(p[1]?.ele).toBe(100)
  })
})

describe('modusAusTempo', () => {
  it('rät Gehen unter 7 km/h, sonst Rad', () => {
    expect(modusAusTempo(5000, 3600)).toBe('walk') // 5 km/h
    expect(modusAusTempo(15000, 3600)).toBe('bike') // 15 km/h
    expect(modusAusTempo(1000, 0)).toBe('bike') // keine Dauer → Default
  })
})

describe('baueSegmentAusGpx', () => {
  const startMs = Date.parse('2026-07-04T08:00:00Z')
  const endMs = Date.parse('2026-07-04T08:30:00Z')

  it('nutzt echte Zeitstempel für die Offsets', () => {
    const { segment, hatZeit } = baueSegmentAusGpx(parseGpx(GPX_MIT_ZEIT), { startMs, endMs })
    expect(hatZeit).toBe(true)
    expect(segment.pts[0]?.[3]).toBe(0) // erster Punkt bei t=0
    expect(segment.pts[1]?.[3]).toBe(600) // +10 min
    expect(segment.pts[2]?.[3]).toBe(1800) // +30 min
    expect(segment.pts[0]).toEqual([7.9086, 46.5934, 800, 0])
  })

  it('verteilt Offsets distanzproportional, wenn Zeitstempel fehlen', () => {
    const { segment, hatZeit } = baueSegmentAusGpx(parseGpx(GPX_OHNE_ZEIT), { startMs, endMs })
    expect(hatZeit).toBe(false)
    expect(segment.pts[0]?.[3]).toBe(0)
    expect(segment.pts[1]?.[3]).toBe(1800) // einziges Intervall → volle Spanne
  })

  it('übernimmt einen vorgegebenen Modus, sonst Tempo-Heuristik', () => {
    expect(baueSegmentAusGpx(parseGpx(GPX_MIT_ZEIT), { startMs, endMs, modus: 'ferry' }).segment.mode).toBe('ferry')
    // ~0,7 km in 30 min = ~1,4 km/h → walk
    expect(baueSegmentAusGpx(parseGpx(GPX_MIT_ZEIT), { startMs, endMs }).segment.mode).toBe('walk')
  })

  it('wirft bei zu wenigen Punkten', () => {
    expect(() => baueSegmentAusGpx([{ lng: 1, lat: 1, ele: 0, timeMs: 0 }], { startMs, endMs })).toThrow(/zu wenige/)
  })
})
