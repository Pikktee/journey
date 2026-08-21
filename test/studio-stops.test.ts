// Foto-Stopps: Aufnahmen am selben Ort gehören zu EINEM Halt.
// Reine Logik (src/studio/stops.ts) plus ein Drift-Wächter gegen die
// Player-Gruppierung (src/geo.ts) — beide müssen dieselbe Regel anwenden,
// sonst plant man im Editor zwölf Halte und sieht im Film acht.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  effectiveMedia,
  EMPTY_OVERLAY,
  withMediaEdit,
  offsetToIso,
  type MediaBase,
  type TrackPoint,
} from '../src/studio/edit-model'
import {
  buildStops,
  dOffsetWithoutCluster,
  metersWithoutCluster,
  NEAR_M,
  assignOrder,
  snapTarget,
  stopSignature,
  stopOf,
} from '../src/studio/stops'
import { cumMeters, metersToOffset, offsetAtMeters } from '../src/studio/timeline'
import { NEAR_M as PLAYER_NAHE_M } from '../src/geo.js'
import { orderInStop } from '../src/card-timing.js'

const START = '2026-03-12T07:10:00Z'
const iso = (s: number): string => offsetToIso(START, s)

// Gerade Ost-West-Linie auf 47° Breite: 0,01° ≈ 759 m. 11 Punkte = ~7,6 km.
const GRAD_JE_METER = 1 / (111_320 * Math.cos((47 * Math.PI) / 180))
const track: TrackPoint[] = Array.from(
  { length: 11 },
  (_, i) => [9 + i * 0.01, 47, 0, i * 360] as TrackPoint,
)
const kum = cumMeters(track)

/** Ein Foto, dessen Anker `meters` weit auf der Strecke liegt. */
function foto(id: string, meters: number, takenAtS = 0): MediaBase {
  return {
    id,
    type: 'photo',
    src: `/m/${id}`,
    takenAt: iso(takenAtS),
    caption: '',
    anchor: [9 + meters * GRAD_JE_METER, 47],
    placement: 'gps',
  }
}
const stopps = (basis: MediaBase[], edits = EMPTY_OVERLAY): ReturnType<typeof buildStops> =>
  buildStops(effectiveMedia(basis, edits), track, kum)

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
    const ohneAnker: MediaBase[] = [
      ...basis,
      { ...foto('c', 0), anchor: null, placement: 'unplaced' },
    ]
    expect(stopps(ohneAnker)).toHaveLength(2)
    const geloescht = withMediaEdit(EMPTY_OVERLAY, 'b', { removed: true })
    expect(stopps(basis, geloescht)).toHaveLength(1)
  })

  it('ordnet innerhalb des Stopps nach `reihe`, sonst nach Aufnahmezeit', () => {
    // c wurde zuerst aufgenommen, liegt aber am weitesten — ohne reihe zählt die Zeit
    const basis = [foto('a', 1000, 300), foto('b', 1050, 600), foto('c', 1100, 0)]
    expect(stopps(basis)[0]!.items.map((m) => m.id)).toEqual(['c', 'a', 'b'])

    let e = assignOrder(EMPTY_OVERLAY, ['b', 'a', 'c'])
    expect(stopps(basis, e)[0]!.items.map((m) => m.id)).toEqual(['b', 'a', 'c'])

    // Lücke: wer keine reihe hat, kommt ans Ende (nach Aufnahmezeit)
    e = withMediaEdit(EMPTY_OVERLAY, 'b', { order: 0 })
    expect(stopps(basis, e)[0]!.items.map((m) => m.id)).toEqual(['b', 'c', 'a'])
  })

  it('behält `order: 0` — sie darf nicht als „leer" wegfallen', () => {
    const e = withMediaEdit(EMPTY_OVERLAY, 'x', { order: 0 })
    expect(e.media?.['x']?.order).toBe(0)
    // undefined räumt sie dagegen weg
    expect(withMediaEdit(e, 'x', { order: undefined }).media).toBeUndefined()
  })

  it('liefert Ort und Zeit des Halts als Mittel seiner Mitglieder', () => {
    const s = stopps([foto('a', 1000), foto('b', 1100)])[0]!
    expect(s.meters).toBeCloseTo(1050, 0)
    // 1050 m auf 7,6 km bei 3600 s Gesamtdauer
    expect(s.offsetS).toBeGreaterThan(400)
    expect(s.offsetS).toBeLessThan(600)
  })

  it('findet den Stopp einer Aufnahme und erkennt Änderungen der Gruppierung', () => {
    const basis = [foto('a', 1000), foto('b', 1050), foto('c', 5000)]
    const s = stopps(basis)
    expect(stopOf(s, 'b')?.items.map((m) => m.id)).toEqual(['a', 'b'])
    expect(stopOf(s, 'weg')).toBeUndefined()
    expect(stopSignature(s)).toBe('a+b|c')
    // Auseinandergezogen → andere Signatur, also Neuaufbau nötig
    const getrennt = stopps([foto('a', 1000), foto('b', 2000), foto('c', 5000)])
    expect(stopSignature(getrennt)).not.toBe(stopSignature(s))
  })
})

describe('snapZiel', () => {
  const fremde = [
    { id: 'a', meters: 1000 },
    { id: 'b', meters: 4000 },
  ]
  it('rastet auf die nächste fremde Aufnahme in Reichweite', () => {
    expect(snapTarget(1080, fremde)).toEqual({ id: 'a', meters: 1000 })
    expect(snapTarget(3950, fremde)).toEqual({ id: 'b', meters: 4000 })
  })
  it('rastet nicht, wenn nichts nah genug liegt', () => {
    expect(snapTarget(2500, fremde)).toBeNull()
    expect(snapTarget(1000, [])).toBeNull()
  })
})

describe('meterOhneCluster / dOffsetOhneCluster', () => {
  it('lässt weit genug entfernte Ziele unverändert', () => {
    expect(metersWithoutCluster(2000, [1000, 4000])).toBe(2000)
  })

  it('schiebt knapp benachbarte Ziele auf genau NAHE_M Abstand', () => {
    expect(metersWithoutCluster(1050, [1000])).toBe(1000 + NEAR_M)
    expect(metersWithoutCluster(980, [1000])).toBe(1000 - NEAR_M)
  })

  it('hält den Zeit-Versatz ohne Kollision', () => {
    // 1000 m ≈ Offset 1000/7600*3600 ≈ 473 s; Fremder bei 3000 m ist weit weg
    const d = dOffsetWithoutCluster([500], 0, [3000], kum, track)
    expect(d).toBe(0)
  })

  it('verschiebt den Versatz, wenn der Drop sonst clustern würde', () => {
    // Kopf bei Offset 0 → Meter 0; Ziel-Versatz auf Meter ~50 (unter NAHE_M zu 0)
    // Fremder bei Meter 0: nach dem Zug auf ~50 m müsste er auf 120 m rutschen
    const fremdBei0 = 0
    const zielOffset = offsetAtMeters(kum, track, 50)
    const d = dOffsetWithoutCluster([0], zielOffset, [fremdBei0], kum, track)
    const meter = metersToOffset(kum, track, 0 + d)
    expect(meter).toBeGreaterThanOrEqual(NEAR_M)
    expect(
      buildStops(effectiveMedia([foto('a', meter), foto('b', 0)], EMPTY_OVERLAY), track, kum),
    ).toHaveLength(2)
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
    expect(PLAYER_NAHE_M).toBe(NEAR_M)
  })

  it('messen beide zum ANFANG des Halts', () => {
    // Der Player vergleicht `p.s - last.s`, wobei last.s der Stopp-Anfang ist.
    // Verglichen mit dem Vorgänger könnten Perlenketten beliebig verschmelzen.
    expect(geo).toMatch(/p\.s - last\.s < nearM/)
  })

  // Die Reihenfolge im Halt war bis zur Szene-Schicht (§9) ein Textvergleich:
  // Der Wächter suchte den Quelltext des Players nach
  // `a.order ?? Number.POSITIVE_INFINITY` ab. Ein Regex auf einen Rumpf hält
  // keine Regel zusammen — er meldet jede Umformulierung als Bruch und lässt
  // jede echte Änderung der Studio-Seite durch. Beide rufen jetzt dieselbe
  // Funktion auf, und geprüft wird das VERHALTEN an denselben Beispielen.
  // Eine Aufnahme, wie beide Bühnen sie kennen: ein Ort (der Player misst
  // Meter) UND eine Zeit (das Studio ordnet danach). `reihe` ist optional.
  type Aufnahme = { s: number; takenAt: string; order?: number }
  const auf = (s: number, min: number, order?: number): Aufnahme => ({
    s,
    takenAt: `2026-05-02T10:${String(min).padStart(2, '0')}:00Z`,
    ...(order !== undefined ? { order } : {}),
  })
  const nachOrt = (x: Aufnahme) => x.s
  const nachZeit = (x: Aufnahme) => Date.parse(x.takenAt)

  it('beide ordnen innerhalb eines Stopps nach `reihe` — Verhalten, nicht Quelltext', () => {
    expect(geo).toMatch(/orderInStop\(/)

    // `reihe` schlägt die natürliche Ordnung, in beiden Welten.
    const spaet = auf(900, 5, 0)
    const frueh = auf(800, 0)
    expect(orderInStop([frueh, spaet], nachOrt).map(nachOrt)).toEqual([900, 800])
    expect(orderInStop([frueh, spaet], nachZeit).map(nachOrt)).toEqual([900, 800])
  })

  it('ohne `reihe` gilt die natürliche Ordnung — und die ist je Bühne verschieden', () => {
    // Der Player misst Meter, das Studio die Aufnahmezeit. Bei einer Aufnahme,
    // die später entstand, aber weiter vorn liegt (Umkehr auf der Strecke),
    // kommen beide deshalb LEGITIM zu verschiedenen Folgen — genau darum ist
    // der Zweitschlüssel ein Argument und keine feste Regel.
    const a = auf(900, 0)
    const b = auf(800, 5)
    expect(orderInStop([a, b], nachOrt).map(nachOrt)).toEqual([800, 900])
    expect(orderInStop([a, b], nachZeit).map(nachOrt)).toEqual([900, 800])
  })

  it('ohne `reihe` steht eine Aufnahme HINTEN, nicht vorn', () => {
    // Sonst schöbe sich ein unbenanntes Bild vor eines, das der Autor
    // ausdrücklich an den Anfang gestellt hat.
    expect(orderInStop([auf(100, 0), auf(900, 5, 5)], nachOrt).map(nachOrt)).toEqual([900, 100])
  })

  it('lässt die Eingabe unangetastet', () => {
    const liste = [auf(900, 0), auf(800, 5)]
    orderInStop(liste, nachOrt)
    expect(liste.map(nachOrt)).toEqual([900, 800])
  })

  it('das Studio-Schema kennt `reihe` genauso wie das Server-Schema', () => {
    const server = readFileSync(new URL('../server/src/schema/edits.ts', import.meta.url), 'utf8')
    expect(server).toMatch(/order\?: number/)
    expect(server).toMatch(/order: \{ type: 'integer'/)
  })
})
