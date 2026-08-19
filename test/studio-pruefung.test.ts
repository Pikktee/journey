// Prüf-Screen „Neue Tour": was Luhambo aus den abgelegten Dateien liest,
// bevor irgendetwas hochgeladen wird. Reine Logik (src/studio/pruefung.ts).

import { describe, expect, it } from 'vitest'
import {
  baueFotoSegmente,
  formatiereAbstand,
  gpxPunkte,
  medienAusBefund,
  projiziereVorschau,
  pruefe,
  punktZuZeit,
  schaetzeFahrtS,
  type AufnahmeBefund,
} from '../src/studio/pruefung'

const T0 = Date.parse('2026-07-21T07:00:00Z')
const min = (n: number): number => T0 + n * 60_000

const gpx = (punkte: Array<[number, number, number]>): string =>
  `<?xml version="1.0"?><gpx><trk><trkseg>${punkte
    .map(
      ([lng, lat, m]) =>
        `<trkpt lat="${lat}" lon="${lng}"><ele>10</ele><time>${new Date(min(m)).toISOString()}</time></trkpt>`,
    )
    .join('')}</trkseg></trk></gpx>`

const track = gpx([
  [100.0, 9.7, 0],
  [100.05, 9.75, 60],
  [100.1, 9.8, 120],
])

const foto = (
  datei: string,
  m: number,
  ort: [number, number] | null = null,
  zeitGeraten = false,
): AufnahmeBefund => ({
  datei,
  typ: 'photo',
  zeitMs: min(m),
  zeitGeraten,
  ort,
})

describe('gpxPunkte', () => {
  it('liest Ort und Zeit jedes Trackpunkts', () => {
    const p = gpxPunkte(track)
    expect(p).toHaveLength(3)
    expect(p[0]![0]).toBeCloseTo(100.0, 5)
    expect(p[0]![1]).toBeCloseTo(9.7, 5)
    expect(p[2]![2]).toBe(min(120))
  })

  it('überspringt Punkte ohne Koordinaten und verträgt fehlende Zeiten', () => {
    const xml = '<gpx><trkpt lat="9.7"></trkpt><trkpt lat="9.7" lon="100"></trkpt></gpx>'
    const p = gpxPunkte(xml)
    expect(p).toHaveLength(1)
    expect(Number.isNaN(p[0]![2])).toBe(true)
  })
})

describe('projiziereVorschau', () => {
  it('legt die Route in den 0..100-Kasten und liefert je Punkt ein Bild', () => {
    const v = projiziereVorschau([
      [100, 9.7],
      [100.1, 9.8],
    ])!
    expect(v.bild).toHaveLength(2)
    for (const [x, y] of v.bild) {
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThanOrEqual(100)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(y).toBeLessThanOrEqual(100)
    }
    // Norden oben: der nördlichere Punkt hat das kleinere y
    expect(v.bild[1]![1]).toBeLessThan(v.bild[0]![1])
  })

  it('gibt null zurück, wo es keine Ausdehnung gibt', () => {
    expect(projiziereVorschau([[100, 9.7]])).toBeNull()
    expect(
      projiziereVorschau([
        [100, 9.7],
        [100, 9.7],
      ]),
    ).toBeNull()
  })
})

describe('punktZuZeit', () => {
  it('findet den zeitlich nächsten Trackpunkt', () => {
    const p = gpxPunkte(track)
    expect(punktZuZeit(p, min(55))).toBe(1)
    expect(punktZuZeit(p, min(0))).toBe(0)
    expect(punktZuZeit(p, min(9999))).toBe(2)
  })
})

describe('pruefe — mit Aufzeichnung', () => {
  it('liest Strecke, Spanne und Aufnahmen', () => {
    const b = pruefe(track, [foto('a.jpg', 30, [100.02, 9.72]), foto('b.jpg', 90)])
    expect(b.quelle).toBe('aufzeichnung')
    expect(b.bereit).toBe(true)
    expect(b.track!.km).toBeGreaterThan(10)
    expect(b.vonMs).toBe(min(0))
    expect(b.bisMs).toBe(min(120))
  })

  it('sortiert die Aufnahmen nach Zeit', () => {
    const b = pruefe(track, [foto('spaet.jpg', 90), foto('frueh.jpg', 10)])
    expect(b.aufnahmen.map((a) => a.datei)).toEqual(['frueh.jpg', 'spaet.jpg'])
  })

  it('meldet fehlende Ortsangaben als Hinweis — die Uhrzeit reicht', () => {
    const b = pruefe(track, [foto('a.jpg', 30), foto('b.jpg', 60)])
    const m = b.meldungen.find((x) => x.art === 'ohne-ort')!
    expect(m.ton).toBe('hinweis')
    expect(m.dateien).toEqual(['a.jpg', 'b.jpg'])
  })

  it('meldet Aufnahmen außerhalb der Aufzeichnung als Warnung', () => {
    // 101 min nach dem Track-Ende — jemand hat ein fremdes Foto mit hineingezogen
    const b = pruefe(track, [foto('fremd.jpg', 221, [100, 9.7])])
    const m = b.meldungen.find((x) => x.art === 'ausserhalb')!
    expect(m.ton).toBe('warnung')
    expect(m.text).toContain('1 h 41 min')
    expect(m.dateien).toEqual(['fremd.jpg'])
  })

  it('lässt eine Aufnahme kurz vor dem Start in Ruhe', () => {
    // 10 min davor: das ist das Foto vom Aufbruch, kein Ausreißer
    const b = pruefe(track, [foto('start.jpg', -10, [100, 9.7])])
    expect(b.meldungen.some((m) => m.art === 'ausserhalb')).toBe(false)
  })

  it('nimmt Ausreißer in die Zeitachse auf — sonst sähe man sie nicht', () => {
    const b = pruefe(track, [foto('fremd.jpg', 300, [100, 9.7])])
    expect(b.bisMs).toBe(min(300))
  })

  it('meldet geratene Zeitstempel', () => {
    const b = pruefe(track, [foto('a.jpg', 30, [100, 9.7], true)])
    expect(b.meldungen.find((m) => m.art === 'ohne-zeit')?.text).toContain('Datum der Datei')
  })
})

describe('pruefe — ohne Aufzeichnung', () => {
  it('macht aus verorteten Fotos eine Strecke', () => {
    const b = pruefe(null, [foto('a.jpg', 0, [100, 9.7]), foto('b.jpg', 30, [100.1, 9.8])])
    expect(b.quelle).toBe('fotos')
    expect(b.bereit).toBe(true)
    expect(b.meldungen.find((m) => m.art === 'ohne-track')?.text).toContain('von Foto zu Foto')
  })

  it('sagt klar, was fehlt, wenn es keine zwei Orte gibt', () => {
    const b = pruefe(null, [foto('a.jpg', 0), foto('b.jpg', 30, [100, 9.7])])
    expect(b.quelle).toBe('keine')
    expect(b.bereit).toBe(false)
    expect(b.meldungen.find((m) => m.art === 'keine-orte')?.ton).toBe('warnung')
  })

  it('ohne Aufzeichnung wiegt eine fehlende Ortsangabe schwerer', () => {
    // Mit Track ist das ein Hinweis; ohne Track fehlt dem Foto sein Platz.
    const b = pruefe(null, [
      foto('a.jpg', 0, [100, 9.7]),
      foto('b.jpg', 30, [100.1, 9.8]),
      foto('c.jpg', 60),
    ])
    expect(b.meldungen.find((m) => m.art === 'ohne-ort')?.ton).toBe('warnung')
  })

  it('verträgt gar nichts', () => {
    const b = pruefe(null, [])
    expect(b.bereit).toBe(false)
    expect(b.meldungen).toEqual([])
    expect(b.aufnahmen).toEqual([])
  })
})

describe('baueFotoSegmente', () => {
  it('reiht die verorteten Fotos zeitlich auf', () => {
    const seg = baueFotoSegmente(
      [foto('b.jpg', 30, [100.1, 9.8]), foto('a.jpg', 0, [100, 9.7]), foto('x.jpg', 5)],
      'walk',
    )
    expect(seg).toHaveLength(1)
    expect(seg[0]!.mode).toBe('walk')
    expect(seg[0]!.pts).toEqual([
      [100, 9.7, 0, 0],
      [100.1, 9.8, 0, 1800],
    ])
  })

  it('liefert nichts, wo keine Strecke entstehen kann', () => {
    expect(baueFotoSegmente([foto('a.jpg', 0, [100, 9.7])], 'walk')).toEqual([])
  })
})

describe('Kleinteile', () => {
  it('formatiert Abstände in lesbaren Größen', () => {
    expect(formatiereAbstand(18 * 60_000)).toBe('18 min')
    expect(formatiereAbstand(101 * 60_000)).toBe('1 h 41 min')
    expect(formatiereAbstand(120 * 60_000)).toBe('2 h')
  })

  it('schätzt die Fahrtdauer aus Strecke und Halten', () => {
    expect(schaetzeFahrtS(10, 5)).toBe(270)
  })

  it('macht aus dem Befund Medien-Einträge in Zeitreihenfolge', () => {
    const b = pruefe(track, [foto('spaet.jpg', 90, [100.1, 9.8]), foto('frueh.jpg', 10)])
    const medien = medienAusBefund(b, (ms) => new Date(ms).toISOString())
    expect(medien.map((m) => [m.id, m.file])).toEqual([
      ['m1', 'frueh.jpg'],
      ['m2', 'spaet.jpg'],
    ])
    expect(medien[0]!.anchor).toBeUndefined()
    expect(medien[1]!.anchor).toEqual([100.1, 9.8])
  })
})
