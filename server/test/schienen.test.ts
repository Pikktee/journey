// Straßenbahn-Erkennung am OSM-Schienennetz: Am Tempo sind Moped, Jeep und
// Tram nicht zu unterscheiden — an der Trasse schon. Geprüft wird die reine
// Geometrie (hebeSchienenAbschnitte) und die Overpass-Anbindung gegen ein
// injiziertes fetch.

import { describe, expect, it, vi } from 'vitest'
import {
  FesteSchienen,
  OverpassSchienen,
  hebeSchienenAbschnitte,
  umgebungsBox,
} from '../src/pipeline/schienen.js'
import type { Schienenweg } from '../src/pipeline/schienen.js'
import type { UploadPunkt, UploadSegment } from '../src/schema/upload.js'

const LAT = 50.1
const GRAD_PRO_M = 1 / (111_320 * Math.cos((LAT * Math.PI) / 180))
const GRAD_PRO_M_LAT = 1 / 110_540

/** Gerade Fahrt nach Osten: `meter` lang, ein Punkt je 15 s. */
function fahrt(meter: number, kmh = 22, versatzM = 0): UploadPunkt[] {
  const pts: UploadPunkt[] = []
  const schritt = (kmh / 3.6) * 15
  for (let s = 0, t = 0; s <= meter; s += schritt, t += 15) {
    pts.push([8.68 + s * GRAD_PRO_M, LAT + versatzM * GRAD_PRO_M_LAT, 110, t])
  }
  return pts
}

/** Gleis entlang derselben Linie. */
const gleisGerade = (vonM = -500, bisM = 5000, versatzM = 0): Schienenweg => [
  [8.68 + vonM * GRAD_PRO_M, LAT + versatzM * GRAD_PRO_M_LAT],
  [8.68 + bisM * GRAD_PRO_M, LAT + versatzM * GRAD_PRO_M_LAT],
]

const segment = (mode: UploadSegment['mode'], pts: UploadPunkt[]): UploadSegment => ({ mode, pts })

describe('hebeSchienenAbschnitte', () => {
  it('hebt eine lange Fahrt auf der Trasse zur Straßenbahn', () => {
    const erg = hebeSchienenAbschnitte([segment('bike', fahrt(3000))], [gleisGerade()])
    expect(erg[0]?.mode).toBe('tram')
    // Die Punkte bleiben unangetastet — nur das Etikett wechselt
    expect(erg[0]?.pts).toHaveLength(fahrt(3000).length)
  })

  it('lässt einen Fußweg neben den Gleisen zu Fuß', () => {
    // Wer neben der Trasse HER geht, sitzt nicht in der Bahn
    const erg = hebeSchienenAbschnitte([segment('walk', fahrt(3000, 4.5))], [gleisGerade()])
    expect(erg[0]?.mode).toBe('walk')
  })

  it('lässt eine Fahrt abseits der Gleise in Ruhe', () => {
    // 80 m parallel — außerhalb des Korridors
    const erg = hebeSchienenAbschnitte([segment('bike', fahrt(3000, 22, 80))], [gleisGerade()])
    expect(erg[0]?.mode).toBe('bike')
  })

  it('braucht eine Mindeststrecke — ein Stück Gleis ist noch keine Bahnfahrt', () => {
    // Ein paar Meter auf der Trasse hat jeder mal; unter zwei Haltestellen
    // erzählt niemand von einer Fahrt.
    const erg = hebeSchienenAbschnitte([segment('bike', fahrt(300))], [gleisGerade()])
    expect(erg[0]?.mode).toBe('bike')
  })

  it('erkennt die kurze Stadtfahrt über zwei Haltestellen', () => {
    // An einer echten Frankfurter Tour nachgemessen: Die Fahrten dauerten zwei
    // und vier Minuten — eine 1,5-km-Schranke hätte beide verworfen.
    const erg = hebeSchienenAbschnitte([segment('bike', fahrt(700))], [gleisGerade()])
    expect(erg[0]?.mode).toBe('tram')
  })

  it('verlangt, dass der Abschnitt fast GANZ auf der Trasse liegt', () => {
    // Gleis endet nach 900 m, die Fahrt geht 3 km weiter → 30 % Deckung.
    // Eine Straßenbahn ist immer auf den Gleisen, ein Auto nur stückweise.
    const erg = hebeSchienenAbschnitte([segment('bike', fahrt(3000))], [gleisGerade(-100, 900)])
    expect(erg[0]?.mode).toBe('bike')
  })

  it('verwirft ein Auto, das nur zeitweise der Gleisstraße folgt', () => {
    // 2 km auf der Trasse, dann 1 km abseits = 66 % — zu wenig
    const erg = hebeSchienenAbschnitte([segment('bike', fahrt(3000))], [gleisGerade(-100, 2000)])
    expect(erg[0]?.mode).toBe('bike')
  })

  it('hebt nur die betroffenen Abschnitte einer gemischten Tour', () => {
    const erg = hebeSchienenAbschnitte(
      [
        segment('bike', fahrt(3000)),
        segment('walk', fahrt(800, 4.5)),
        segment('bike', fahrt(3000)),
      ],
      [gleisGerade()],
    )
    expect(erg.map((s) => s.mode)).toEqual(['tram', 'walk', 'tram'])
  })

  it('gibt die Eingabe unverändert zurück, wenn OSM nichts liefert', () => {
    const ein = [segment('bike', fahrt(3000))]
    expect(hebeSchienenAbschnitte(ein, []).map((s) => s.mode)).toEqual(['bike'])
  })
})

describe('umgebungsBox', () => {
  it('umschließt alle Punkte mit Rand', () => {
    const box = umgebungsBox([segment('bike', fahrt(3000))])
    expect(box).not.toBeNull()
    expect(box!.sued).toBeLessThan(LAT)
    expect(box!.nord).toBeGreaterThan(LAT)
    expect(box!.west).toBeLessThan(8.68)
    expect(box!.ost).toBeGreaterThan(8.68 + 3000 * GRAD_PRO_M)
  })

  it('liefert null ohne Punkte', () => {
    expect(umgebungsBox([])).toBeNull()
  })
})

describe('OverpassSchienen', () => {
  it('fragt Tram- und Stadtbahngleise ab und liest die Geometrie', async () => {
    const fetchFn = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            elements: [
              {
                geometry: [
                  { lat: 50.1, lon: 8.68 },
                  { lat: 50.101, lon: 8.69 },
                ],
              },
              { geometry: [{ lat: 50.1, lon: 8.7 }] }, // zu kurz → fällt weg
            ],
          }),
          { status: 200 },
        ),
    )
    const quelle = new OverpassSchienen(
      'https://overpass.test/api',
      'Test/1',
      fetchFn as unknown as typeof fetch,
    )
    const gleise = await quelle.gleise({ sued: 50, west: 8.6, nord: 50.2, ost: 8.8 })

    expect(gleise).toEqual([
      [
        [8.68, 50.1],
        [8.69, 50.101],
      ],
    ])
    const koerper = decodeURIComponent(String(fetchFn.mock.calls[0]?.[1]?.body))
    expect(koerper).toContain('railway')
    expect(koerper).toContain('tram|light_rail')
    expect(koerper).toContain('50,8.6,50.2,8.8')
  })

  it('wirft bei HTTP-Fehlern (der Aufrufer wertet das als „nichts gefunden")', async () => {
    const fetchFn = vi.fn(async () => new Response('rate limited', { status: 429 }))
    const quelle = new OverpassSchienen(
      'https://overpass.test/api',
      'Test/1',
      fetchFn as unknown as typeof fetch,
    )
    await expect(quelle.gleise({ sued: 50, west: 8.6, nord: 50.2, ost: 8.8 })).rejects.toThrow(
      /429/,
    )
  })
})

describe('FesteSchienen (Test-Doppel)', () => {
  it('schneidet die Abfragen mit', async () => {
    const quelle = new FesteSchienen([gleisGerade()])
    await quelle.gleise({ sued: 50, west: 8.6, nord: 50.2, ost: 8.8 })
    expect(quelle.abfragen).toHaveLength(1)
    expect(quelle.abfragen[0]?.nord).toBe(50.2)
  })
})
