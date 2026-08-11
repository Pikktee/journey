// Foto-Stopps: Aufnahmen am selben Ort gehören zu EINEM Halt.
// Reine Logik (src/studio/stopps.ts) plus ein Drift-Wächter gegen die
// Player-Gruppierung (src/geo.ts) — beide müssen dieselbe Regel anwenden,
// sonst plant man im Editor zwölf Halte und sieht im Film acht.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  effektiveMedien,
  LEERES_OVERLAY,
  mitMedienEdit,
  offsetZuIso,
  type MediumBasis,
  type TrackPunkt,
} from '../src/studio/editmodell'
import { baueStopps, dOffsetOhneCluster, meterOhneCluster, NAHE_M, reiheVergeben, snapZiel, stoppSignatur, stoppVon } from '../src/studio/stopps'
import { kumMeter, meterZuOffset, offsetBeiMeter } from '../src/studio/zeitleiste'
import { NAHE_M as PLAYER_NAHE_M } from '../src/geo.js'

const START = '2026-03-12T07:10:00Z'
const iso = (s: number): string => offsetZuIso(START, s)

// Gerade Ost-West-Linie auf 47° Breite: 0,01° ≈ 759 m. 11 Punkte = ~7,6 km.
const GRAD_JE_METER = 1 / (111_320 * Math.cos((47 * Math.PI) / 180))
const track: TrackPunkt[] = Array.from({ length: 11 }, (_, i) => [9 + i * 0.01, 47, 0, i * 360] as TrackPunkt)
const kum = kumMeter(track)

/** Ein Foto, dessen Anker `meter` weit auf der Strecke liegt. */
function foto(id: string, meter: number, takenAtS = 0): MediumBasis {
  return {
    id,
    type: 'photo',
    src: `/m/${id}`,
    takenAt: iso(takenAtS),
    caption: '',
    anchor: [9 + meter * GRAD_JE_METER, 47],
    placement: 'gps',
  }
}
const stopps = (basis: MediumBasis[], edits = LEERES_OVERLAY): ReturnType<typeof baueStopps> =>
  baueStopps(effektiveMedien(basis, edits), track, kum)

describe('baueStopps', () => {
  it('fasst Aufnahmen unter 120 m zusammen und trennt darüber', () => {
    const knapp = stopps([foto('a', 1000), foto('b', 1000 + 119)])
    expect(knapp).toHaveLength(1)
    expect(knapp[0]!.items.map((m) => m.id)).toEqual(['a', 'b'])

    const weit = stopps([foto('a', 1000), foto('b', 1000 + 121)])
    expect(weit).toHaveLength(2)
  })

  it('misst zum ANFANG des Halts, nicht zum Vorgänger', () => {
    // Sonst verschmölze eine Perlenkette knapp benachbarter Aufnahmen zu einem
    // beliebig langen Stopp. Bei 100-m-Schritten macht der Halt nach zwei
    // Aufnahmen zu und der nächste beginnt — so entscheidet es auch der Player.
    const kette = stopps([foto('a', 1000), foto('b', 1100), foto('c', 1200), foto('d', 1300)])
    expect(kette.map((s) => s.items.map((m) => m.id))).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })

  it('überspringt Unplatzierte und Gelöschte', () => {
    const basis = [foto('a', 1000), foto('b', 3000)]
    const ohneAnker: MediumBasis[] = [...basis, { ...foto('c', 0), anchor: null, placement: 'unplatziert' }]
    expect(stopps(ohneAnker)).toHaveLength(2)
    const geloescht = mitMedienEdit(LEERES_OVERLAY, 'b', { geloescht: true })
    expect(stopps(basis, geloescht)).toHaveLength(1)
  })

  it('ordnet innerhalb des Stopps nach `reihe`, sonst nach Aufnahmezeit', () => {
    // c wurde zuerst aufgenommen, liegt aber am weitesten — ohne reihe zählt die Zeit
    const basis = [foto('a', 1000, 300), foto('b', 1050, 600), foto('c', 1100, 0)]
    expect(stopps(basis)[0]!.items.map((m) => m.id)).toEqual(['c', 'a', 'b'])

    let e = reiheVergeben(LEERES_OVERLAY, ['b', 'a', 'c'])
    expect(stopps(basis, e)[0]!.items.map((m) => m.id)).toEqual(['b', 'a', 'c'])

    // Lücke: wer keine reihe hat, kommt ans Ende (nach Aufnahmezeit)
    e = mitMedienEdit(LEERES_OVERLAY, 'b', { reihe: 0 })
    expect(stopps(basis, e)[0]!.items.map((m) => m.id)).toEqual(['b', 'c', 'a'])
  })

  it('behält `reihe: 0` — sie darf nicht als „leer" wegfallen', () => {
    const e = mitMedienEdit(LEERES_OVERLAY, 'x', { reihe: 0 })
    expect(e.medien?.['x']?.reihe).toBe(0)
    // undefined räumt sie dagegen weg
    expect(mitMedienEdit(e, 'x', { reihe: undefined }).medien).toBeUndefined()
  })

  it('liefert Ort und Zeit des Halts als Mittel seiner Mitglieder', () => {
    const s = stopps([foto('a', 1000), foto('b', 1100)])[0]!
    expect(s.meter).toBeCloseTo(1050, 0)
    // 1050 m auf 7,6 km bei 3600 s Gesamtdauer
    expect(s.offsetS).toBeGreaterThan(400)
    expect(s.offsetS).toBeLessThan(600)
  })

  it('findet den Stopp einer Aufnahme und erkennt Änderungen der Gruppierung', () => {
    const basis = [foto('a', 1000), foto('b', 1050), foto('c', 5000)]
    const s = stopps(basis)
    expect(stoppVon(s, 'b')?.items.map((m) => m.id)).toEqual(['a', 'b'])
    expect(stoppVon(s, 'weg')).toBeUndefined()
    expect(stoppSignatur(s)).toBe('a+b|c')
    // Auseinandergezogen → andere Signatur, also Neuaufbau nötig
    const getrennt = stopps([foto('a', 1000), foto('b', 2000), foto('c', 5000)])
    expect(stoppSignatur(getrennt)).not.toBe(stoppSignatur(s))
  })
})

describe('snapZiel', () => {
  const fremde = [
    { id: 'a', meter: 1000 },
    { id: 'b', meter: 4000 },
  ]
  it('rastet auf die nächste fremde Aufnahme in Reichweite', () => {
    expect(snapZiel(1080, fremde)).toEqual({ id: 'a', meter: 1000 })
    expect(snapZiel(3950, fremde)).toEqual({ id: 'b', meter: 4000 })
  })
  it('rastet nicht, wenn nichts nah genug liegt', () => {
    expect(snapZiel(2500, fremde)).toBeNull()
    expect(snapZiel(1000, [])).toBeNull()
  })
})

describe('meterOhneCluster / dOffsetOhneCluster', () => {
  it('lässt weit genug entfernte Ziele unverändert', () => {
    expect(meterOhneCluster(2000, [1000, 4000])).toBe(2000)
  })

  it('schiebt knapp benachbarte Ziele auf genau NAHE_M Abstand', () => {
    expect(meterOhneCluster(1050, [1000])).toBe(1000 + NAHE_M)
    expect(meterOhneCluster(980, [1000])).toBe(1000 - NAHE_M)
  })

  it('hält den Zeit-Versatz ohne Kollision', () => {
    // 1000 m ≈ Offset 1000/7600*3600 ≈ 473 s; Fremder bei 3000 m ist weit weg
    const d = dOffsetOhneCluster([500], 0, [3000], kum, track)
    expect(d).toBe(0)
  })

  it('verschiebt den Versatz, wenn der Drop sonst clustern würde', () => {
    // Kopf bei Offset 0 → Meter 0; Ziel-Versatz auf Meter ~50 (unter NAHE_M zu 0)
    // Fremder bei Meter 0: nach dem Zug auf ~50 m müsste er auf 120 m rutschen
    const fremdBei0 = 0
    const zielOffset = offsetBeiMeter(kum, track, 50)
    const d = dOffsetOhneCluster([0], zielOffset, [fremdBei0], kum, track)
    const meter = meterZuOffset(kum, track, 0 + d)
    expect(meter).toBeGreaterThanOrEqual(NAHE_M)
    expect(baueStopps(
      effektiveMedien([foto('a', meter), foto('b', 0)], LEERES_OVERLAY),
      track,
      kum,
    )).toHaveLength(2)
  })
})

describe('Drift-Wächter: Editor und Player gruppieren gleich', () => {
  // Seit src/geo.ts TypeScript ist, wird die Schwelle direkt importiert statt
  // aus dem Quelltext gelesen — exakter als jede Regex. Für die beiden Regeln
  // darunter bleibt der Textvergleich: sie stecken im Rumpf, nicht in einer
  // Konstanten. Die Gruppierung selbst prüft test/geo.test.ts an denselben
  // Beispielen.
  const geo = readFileSync(new URL('../src/geo.ts', import.meta.url), 'utf8')

  it('teilen dieselbe Nähe-Schwelle', () => {
    expect(PLAYER_NAHE_M).toBe(NAHE_M)
  })

  it('messen beide zum ANFANG des Halts', () => {
    // Der Player vergleicht `p.s - last.s`, wobei last.s der Stopp-Anfang ist.
    // Verglichen mit dem Vorgänger könnten Perlenketten beliebig verschmelzen.
    expect(geo).toMatch(/p\.s - last\.s < naheM/)
  })

  it('der Player ordnet innerhalb eines Stopps nach `reihe`', () => {
    expect(geo).toMatch(/a\.reihe \?\? Number\.POSITIVE_INFINITY/)
  })

  it('das Studio-Schema kennt `reihe` genauso wie das Server-Schema', () => {
    const server = readFileSync(new URL('../server/src/schema/edits.ts', import.meta.url), 'utf8')
    expect(server).toMatch(/reihe\?: number/)
    expect(server).toMatch(/reihe: \{ type: 'integer'/)
  })
})
