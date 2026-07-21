// Gehabschnitts-Erkennung an synthetischen Tracks: gerade Strecke nach Osten,
// die Punkte im gewünschten Tempo gesetzt.
import { describe, expect, it } from 'vitest'
import { wendeModiAn } from '../src/pipeline/edits.js'
import { tempoVerlaufKmh, trenneGehabschnitte, trenneGehabschnitteInSegmenten } from '../src/pipeline/tempo.js'
import type { Modus, UploadPunkt, UploadSegment } from '../src/schema/upload.js'

/** Grad Länge je Meter auf ~46,6° Nord (Berner Oberland). */
const GRAD_PRO_METER = 1 / (111_320 * Math.cos((46.59 * Math.PI) / 180))

/**
 * Track aus Abschnitten `[kmh, dauerS]` bauen; ein Punkt je 5 Sekunden.
 * Die Punkte liegen auf einer Linie nach Osten — die Distanz ist damit exakt
 * berechenbar und das Tempo genau das gewünschte.
 */
function track(abschnitte: Array<[number, number]>): UploadPunkt[] {
  const pts: UploadPunkt[] = []
  let lng = 7.9
  let t = 0
  pts.push([Number(lng.toFixed(6)), 46.59, 800, 0])
  for (const [kmh, dauerS] of abschnitte) {
    const schritte = Math.round(dauerS / 5)
    for (let i = 0; i < schritte; i++) {
      lng += ((kmh / 3.6) * 5) * GRAD_PRO_METER
      t += 5
      pts.push([Number(lng.toFixed(6)), 46.59, 800, t])
    }
  }
  return pts
}

const segment = (mode: Modus, pts: UploadPunkt[]): UploadSegment => ({ mode, pts })

/** Modi und ihre Dauer in Sekunden — so lassen sich Ergebnisse knapp prüfen. */
function verlauf(segmente: UploadSegment[]): Array<[Modus, number]> {
  return segmente.map((s) => [s.mode, s.pts[s.pts.length - 1]![3] - s.pts[0]![3]])
}

describe('tempoVerlaufKmh', () => {
  it('misst gleichmäßige Fahrt korrekt', () => {
    const tempo = tempoVerlaufKmh(track([[20, 300]]))
    const mitte = tempo[Math.floor(tempo.length / 2)]!
    expect(mitte).toBeGreaterThan(19)
    expect(mitte).toBeLessThan(21)
  })

  it('lässt sich von einem GPS-Ausreißer nicht beeindrucken', () => {
    // Ein einzelner Sprung darf keinen Fahrabschnitt erfinden — genau dafür
    // steht hier der Median statt eines Mittelwerts.
    const pts = track([[4, 600]])
    const ausreisser = pts[40]!
    pts[40] = [ausreisser[0] + 300 * GRAD_PRO_METER, ausreisser[1], ausreisser[2], ausreisser[3]]
    const tempo = tempoVerlaufKmh(pts)
    expect(Math.max(...tempo)).toBeLessThan(8)
  })
})

describe('trenneGehabschnitte', () => {
  it('schneidet eine Gehpause aus einer Radfahrt', () => {
    const s = segment('bike', track([[20, 600], [4, 600], [20, 600]]))
    expect(verlauf(trenneGehabschnitte(s)).map((v) => v[0])).toEqual(['bike', 'walk', 'bike'])
  })

  it('der Grenzpunkt gehört beiden Abschnitten', () => {
    // Sonst entsteht beim Verketten eine Lücke im Track (Konvention wie bei
    // den Modus-Grenzen aus dem Editor).
    const teile = trenneGehabschnitte(segment('bike', track([[20, 600], [4, 600]])))
    expect(teile).toHaveLength(2)
    expect(teile[0]!.pts[teile[0]!.pts.length - 1]).toEqual(teile[1]!.pts[0])
  })

  it('eine Ampelphase ist kein Spaziergang', () => {
    // 40 s Stillstand liegen unter der Mindestdauer und gehen im Nachbarn auf
    const s = segment('bike', track([[20, 400], [0, 40], [20, 400]]))
    expect(trenneGehabschnitte(s)).toHaveLength(1)
  })

  it('ein kurzes Rollstück unterbricht das Wandern nicht', () => {
    const s = segment('walk', track([[4, 500], [16, 60], [4, 500]]))
    expect(trenneGehabschnitte(s)).toHaveLength(1)
  })

  it('flackert nicht bei Tempo um die Schwelle herum', () => {
    // Wechselt zwischen 5 und 7 km/h — beides liegt zwischen den beiden
    // Schwellen, die Hysterese hält den Abschnitt zusammen.
    const s = segment('bike', track([[5, 200], [7, 200], [5, 200], [7, 200]]))
    expect(trenneGehabschnitte(s)).toHaveLength(1)
  })

  it('behält den angegebenen Primärmodus bei', () => {
    // Nicht „bike" raten: die Angabe des Nutzers gilt für die Fahrabschnitte
    const s = segment('moped', track([[45, 600], [4, 600], [45, 600]]))
    expect(verlauf(trenneGehabschnitte(s)).map((v) => v[0])).toEqual(['moped', 'walk', 'moped'])
  })

  it('ohne Angabe wird aus schnellem walk ein bike', () => {
    const s = segment('walk', track([[22, 900]]))
    expect(trenneGehabschnitte(s).map((t) => t.mode)).toEqual(['bike'])
  })

  it('ohne Angabe bleibt langsames walk unangetastet', () => {
    const s = segment('walk', track([[4, 900]]))
    const teile = trenneGehabschnitte(s)
    expect(teile).toHaveLength(1)
    expect(teile[0]).toBe(s) // unverändert durchgereicht
  })

  it('eine reine Fahrt bleibt ein Segment', () => {
    const s = segment('bike', track([[20, 900]]))
    expect(trenneGehabschnitte(s)).toEqual([s])
  })

  it('sehr kurze Tracks bleiben unangetastet', () => {
    const s = segment('bike', track([[20, 10]]))
    expect(trenneGehabschnitte(s)).toEqual([s])
  })

  it('deckt den Track lückenlos ab', () => {
    const s = segment('bike', track([[20, 600], [4, 600], [20, 600], [3, 400]]))
    const teile = trenneGehabschnitte(s)
    expect(teile[0]!.pts[0]).toEqual(s.pts[0])
    expect(teile[teile.length - 1]!.pts.at(-1)).toEqual(s.pts.at(-1))
    for (let i = 1; i < teile.length; i++) {
      expect(teile[i]!.pts[0]).toEqual(teile[i - 1]!.pts.at(-1))
    }
  })
})

describe('trenneGehabschnitteInSegmenten', () => {
  it('greift bei genau einem Segment', () => {
    const s = segment('bike', track([[20, 600], [4, 600]]))
    expect(trenneGehabschnitteInSegmenten([s]).length).toBe(2)
  })

  it('lässt bewusst gesetzte Modus-Wechsel in Ruhe', () => {
    // Mehrere Segmente heißen: jemand hat den Modus selbst umgeschaltet
    // (ältere Aufnahmen mit der Chip-Reihe). Das wird nicht überschrieben.
    const segmente = [
      segment('bike', track([[20, 600], [4, 600]])),
      segment('ferry', track([[30, 600]])),
    ]
    expect(trenneGehabschnitteInSegmenten(segmente)).toEqual(segmente)
  })

  it('verträgt eine leere Liste', () => {
    expect(trenneGehabschnitteInSegmenten([])).toEqual([])
  })
})

describe('Zusammenspiel mit den Modus-Grenzen des Editors', () => {
  it('eine gesetzte Grenze übersteuert die Automatik', () => {
    // Die Automatik ist ein Vorschlag auf den Rohdaten; wer im Editor eine
    // Grenze zieht, hat das letzte Wort.
    const startMs = Date.parse('2026-07-04T08:00:00Z')
    const roh = trenneGehabschnitteInSegmenten([segment('bike', track([[20, 600], [4, 600]]))])
    expect(roh.map((s) => s.mode)).toEqual(['bike', 'walk'])

    const mitGrenze = wendeModiAn(roh, [{ ab: new Date(startMs).toISOString(), mode: 'ferry' }], startMs)
    // Ab dem Tour-Anfang gilt Fähre — der erkannte Gehabschnitt verschwindet
    expect([...new Set(mitGrenze.map((s) => s.mode))]).toEqual(['ferry'])
  })

  it('ohne Grenzen bleibt die erkannte Aufteilung stehen', () => {
    const startMs = Date.parse('2026-07-04T08:00:00Z')
    const roh = trenneGehabschnitteInSegmenten([segment('bike', track([[20, 600], [4, 600]]))])
    expect(wendeModiAn(roh, [], startMs).map((s) => s.mode)).toEqual(['bike', 'walk'])
  })
})
