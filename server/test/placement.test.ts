// Medien-Platzierung (M6): GPS nah am Track → gps, sonst Zeit-Mapping, sonst
// unplatziert. Reine Geometrie über Track + Medien.
import { describe, expect, it } from 'vitest'
import { platziereMedien } from '../src/pipeline/placement.js'
import type { UploadMedium, UploadPunkt } from '../src/schema/upload.js'

const START_MS = Date.parse('2026-07-04T08:00:00Z')
// Track mit Offsets 0 / 600 / 1800 s
const TRACK: UploadPunkt[] = [
  [7.9086, 46.5934, 800, 0],
  [7.9105, 46.59, 830, 600],
  [7.9142, 46.5872, 905, 1800],
]

const medium = (patch: Partial<UploadMedium>): UploadMedium => ({
  id: 'm1',
  type: 'photo',
  file: 'x.jpg',
  takenAt: '2026-07-04T08:10:00Z',
  ...patch,
})

describe('platziereMedien', () => {
  it('verankert einen GPS-Anker nah am Track (gps)', () => {
    const [p] = platziereMedien([medium({ anchor: [7.9105, 46.59] })], TRACK, START_MS)
    expect(p?.placement).toBe('gps')
    expect(p?.anchor).toEqual([7.9105, 46.59])
  })

  it('mappt einen fernen GPS-Anker über die Zeit auf den Track (zeit)', () => {
    // Anker ~150 km weg → > 500 m → Zeit-Mapping greift (takenAt 08:10 = Offset 600)
    const [p] = platziereMedien([medium({ anchor: [9.5, 47.5], takenAt: '2026-07-04T08:10:00Z' })], TRACK, START_MS)
    expect(p?.placement).toBe('zeit')
    expect(p?.anchor?.[0]).toBeCloseTo(7.9105, 4) // Trackpunkt bei Offset 600
  })

  it('mappt ein Medium ohne Anker über die Aufnahmezeit (zeit)', () => {
    const [p] = platziereMedien([medium({ takenAt: '2026-07-04T08:05:00Z' })], TRACK, START_MS)
    expect(p?.placement).toBe('zeit')
    // Offset 300 s: zwischen Punkt 0 (t=0) und 1 (t=600), interpoliert
    expect(p?.anchor?.[0]).toBeCloseTo((7.9086 + 7.9105) / 2, 4)
  })

  it('lässt Medien außerhalb der Tour-Zeit unplatziert', () => {
    const vorher = platziereMedien([medium({ takenAt: '2026-07-04T07:00:00Z' })], TRACK, START_MS)
    const nachher = platziereMedien([medium({ takenAt: '2026-07-04T09:00:00Z' })], TRACK, START_MS)
    expect(vorher[0]?.placement).toBe('unplatziert')
    expect(vorher[0]?.anchor).toBeNull()
    expect(nachher[0]?.placement).toBe('unplatziert')
  })

  it('lässt bei zu kurzem Track alles unplatziert', () => {
    const [p] = platziereMedien([medium({ anchor: [7.9105, 46.59] })], [TRACK[0]!], START_MS)
    expect(p?.placement).toBe('unplatziert')
  })

  it('platziert korrekt trotz unsortierter Track-Zeiten (Review-Fund)', () => {
    // Offsets in Fahrreihenfolge, aber Zeit springt zurück (Geräteuhr)
    const track: UploadPunkt[] = [
      [7.9, 46.59, 800, 0],
      [7.95, 46.6, 850, 1800],
      [7.92, 46.595, 820, 600],
    ]
    const [p] = platziereMedien([medium({ takenAt: '2026-07-04T08:10:00Z' })], track, START_MS)
    // Offset 600 s → der (nach Zeit sortiert) passende Punkt ist [7.92, 46.595]
    expect(p?.placement).toBe('zeit')
    expect(p?.anchor?.[0]).toBeCloseTo(7.92, 4)
  })
})
