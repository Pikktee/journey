// Gehabschnitts-Erkennung an synthetischen Tracks: gerade Strecke nach Osten,
// die Punkte im gewünschten Tempo gesetzt.
import { describe, expect, it } from 'vitest'
import { applyTravelModes } from '../src/pipeline/edits.js'
import { collapsePauses } from '../src/pipeline/time.js'
import {
  isRecording,
  speedProfileKmh,
  splitWalkSegments,
  splitWalkSegmentsInSegments,
} from '../src/pipeline/tempo.js'
import type { TravelMode, UploadPoint, UploadSegment } from '../src/schema/upload.js'

/** Grad Länge je Meter auf ~46,6° Nord (Berner Oberland). */
const GRAD_PRO_METER = 1 / (111_320 * Math.cos((46.59 * Math.PI) / 180))

/**
 * Track aus Abschnitten `[kmh, dauerS]` bauen; ein Punkt je 5 Sekunden.
 * Die Punkte liegen auf einer Linie nach Osten — die Distanz ist damit exakt
 * berechenbar und das Tempo genau das gewünschte.
 */
function track(abschnitte: Array<[number, number]>): UploadPoint[] {
  const pts: UploadPoint[] = []
  let lng = 7.9
  let t = 0
  pts.push([Number(lng.toFixed(6)), 46.59, 800, 0])
  for (const [kmh, dauerS] of abschnitte) {
    const schritte = Math.round(dauerS / 5)
    for (let i = 0; i < schritte; i++) {
      lng += (kmh / 3.6) * 5 * GRAD_PRO_METER
      t += 5
      pts.push([Number(lng.toFixed(6)), 46.59, 800, t])
    }
  }
  return pts
}

// Echte Aufzeichnungen haben SEHR ungleiche Punktabstände: im Stand alle paar
// Sekunden einer, auf der Landstraße alle paar hundert Meter. Genau daraus
// entstehen die Fehler, die `track` (ein Punkt je 5 s) nie zeigen würde.

/** Ein Streckenteil, der dort anschließt, wo der vorige endete. */
type Teil = (lng: number, t: number) => UploadPoint[]

/** Stillstand mit GPS-Rauschen: Punkte im 10-s-Takt, ±3 m um denselben Ort. */
const halt =
  (dauerS: number): Teil =>
  (lng, t0) => {
    const pts: UploadPoint[] = []
    for (let t = 10; t <= dauerS; t += 10) {
      pts.push([Number((lng + Math.sin(t) * 3 * GRAD_PRO_METER).toFixed(6)), 46.59, 800, t0 + t])
    }
    return pts
  }

/** Fahrt mit weit auseinanderliegenden Punkten (`taktS` Sekunden je Punkt). */
const fahrt =
  (kmh: number, dauerS: number, taktS: number): Teil =>
  (lngStart, t0) => {
    const pts: UploadPoint[] = []
    let lng = lngStart
    for (let t = taktS; t <= dauerS; t += taktS) {
      lng += (kmh / 3.6) * taktS * GRAD_PRO_METER
      pts.push([Number(lng.toFixed(6)), 46.59, 800, t0 + t])
    }
    return pts
  }

/** Echtes Gehen: dichte Punkte, echte Strecke. */
const gehen = (dauerS: number): Teil => fahrt(4.5, dauerS, 5)

/** Teile aneinanderhängen; jeder beginnt an Ort und Zeit des vorigen. */
function kette(...teile: Teil[]): UploadPoint[] {
  const pts: UploadPoint[] = [[7.9, 46.59, 800, 0]]
  for (const teil of teile) {
    const letzter = pts[pts.length - 1]!
    pts.push(...teil(letzter[0], letzter[3]))
  }
  return pts
}

const segment = (mode: TravelMode, pts: UploadPoint[]): UploadSegment => ({ mode, pts })

/** Modi und ihre Dauer in Sekunden — so lassen sich Ergebnisse knapp prüfen. */
function verlauf(segmente: UploadSegment[]): Array<[TravelMode, number]> {
  return segmente.map((s) => [s.mode, s.pts[s.pts.length - 1]![3] - s.pts[0]![3]])
}

describe('tempoVerlaufKmh', () => {
  it('misst gleichmäßige Fahrt korrekt', () => {
    const tempo = speedProfileKmh(track([[20, 300]]))
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
    const tempo = speedProfileKmh(pts)
    expect(Math.max(...tempo)).toBeLessThan(8)
  })
})

describe('trenneGehabschnitte', () => {
  it('schneidet eine Gehpause aus einer Radfahrt', () => {
    const s = segment(
      'bike',
      track([
        [20, 600],
        [4, 600],
        [20, 600],
      ]),
    )
    expect(verlauf(splitWalkSegments(s)).map((v) => v[0])).toEqual(['bike', 'walk', 'bike'])
  })

  it('der Grenzpunkt gehört beiden Abschnitten', () => {
    // Sonst entsteht beim Verketten eine Lücke im Track (Konvention wie bei
    // den Modus-Grenzen aus dem Editor).
    const teile = splitWalkSegments(
      segment(
        'bike',
        track([
          [20, 600],
          [4, 600],
        ]),
      ),
    )
    expect(teile).toHaveLength(2)
    expect(teile[0]!.pts[teile[0]!.pts.length - 1]).toEqual(teile[1]!.pts[0])
  })

  it('eine Ampelphase ist kein Spaziergang', () => {
    // 40 s Stillstand liegen unter der Mindestdauer und gehen im Nachbarn auf
    const s = segment(
      'bike',
      track([
        [20, 400],
        [0, 40],
        [20, 400],
      ]),
    )
    expect(splitWalkSegments(s)).toHaveLength(1)
  })

  it('ein kurzes Rollstück unterbricht das Wandern nicht', () => {
    const s = segment(
      'walk',
      track([
        [4, 500],
        [16, 60],
        [4, 500],
      ]),
    )
    expect(splitWalkSegments(s)).toHaveLength(1)
  })

  it('flackert nicht bei Tempo um die Schwelle herum', () => {
    // Wechselt zwischen 5 und 7 km/h — beides liegt zwischen den beiden
    // Schwellen, die Hysterese hält den Abschnitt zusammen.
    const s = segment(
      'bike',
      track([
        [5, 200],
        [7, 200],
        [5, 200],
        [7, 200],
      ]),
    )
    expect(splitWalkSegments(s)).toHaveLength(1)
  })

  it('ein Fotostopp ist kein Gehabschnitt', () => {
    // Der Kernfall echter Aufnahmen: Wer zehn Minuten am Aussichtspunkt steht,
    // legt nur GPS-Rauschen zurück. Ohne die Strecken-Schranke bekäme jedes
    // Foto einer Mopedtour seinen eigenen „Zu Fuß"-Abschnitt.
    const s = segment('moped', kette(fahrt(30, 600, 60), halt(600), fahrt(30, 600, 60)))
    expect(splitWalkSegments(s).map((t) => t.mode)).toEqual(['moped'])
  })

  it('markiert keine Fahrt als Gehen, weil der Median nachhinkt', () => {
    // Nach der Pause stehen die Punkte weit auseinander (Landstraße), der
    // gleitende Median kippt deshalb erst nach etlichen hundert Metern Fahrt.
    // Ohne geschärfte Grenze fiele diese Strecke in den Gehabschnitt.
    const s = segment('moped', kette(gehen(300), halt(600), fahrt(30, 900, 60)))
    for (const teil of splitWalkSegments(s)) {
      if (teil.mode !== 'walk') continue
      const dauerS = teil.pts[teil.pts.length - 1]![3] - teil.pts[0]![3]
      let meter = 0
      for (let i = 1; i < teil.pts.length; i++) {
        meter += (teil.pts[i]![0] - teil.pts[i - 1]![0]) / GRAD_PRO_METER
      }
      expect((meter / dauerS) * 3.6, 'Gehabschnitt schneller als Gehtempo').toBeLessThanOrEqual(8.5)
    }
  })

  it('behält den angegebenen Primärmodus bei', () => {
    // Nicht „bike" raten: die Angabe des Nutzers gilt für die Fahrabschnitte
    const s = segment(
      'moped',
      track([
        [45, 600],
        [4, 600],
        [45, 600],
      ]),
    )
    expect(verlauf(splitWalkSegments(s)).map((v) => v[0])).toEqual(['moped', 'walk', 'moped'])
  })

  it('ohne Angabe wird aus schnellem walk ein bike', () => {
    const s = segment('walk', track([[22, 900]]))
    expect(splitWalkSegments(s).map((t) => t.mode)).toEqual(['bike'])
  })

  it('ohne Angabe bleibt langsames walk unangetastet', () => {
    const s = segment('walk', track([[4, 900]]))
    const teile = splitWalkSegments(s)
    expect(teile).toHaveLength(1)
    expect(teile[0]).toBe(s) // unverändert durchgereicht
  })

  it('eine reine Fahrt bleibt ein Segment', () => {
    const s = segment('bike', track([[20, 900]]))
    expect(splitWalkSegments(s)).toEqual([s])
  })

  it('sehr kurze Tracks bleiben unangetastet', () => {
    const s = segment('bike', track([[20, 10]]))
    expect(splitWalkSegments(s)).toEqual([s])
  })

  it('deckt den Track lückenlos ab', () => {
    const s = segment(
      'bike',
      track([
        [20, 600],
        [4, 600],
        [20, 600],
        [3, 400],
      ]),
    )
    const teile = splitWalkSegments(s)
    expect(teile[0]!.pts[0]).toEqual(s.pts[0])
    expect(teile[teile.length - 1]!.pts.at(-1)).toEqual(s.pts.at(-1))
    for (let i = 1; i < teile.length; i++) {
      expect(teile[i]!.pts[0]).toEqual(teile[i - 1]!.pts.at(-1))
    }
  })
})

describe('trenneGehabschnitteInSegmenten', () => {
  it('greift bei genau einem Segment', () => {
    const s = segment(
      'bike',
      track([
        [20, 600],
        [4, 600],
      ]),
    )
    expect(splitWalkSegmentsInSegments([s]).length).toBe(2)
  })

  it('lässt bewusst gesetzte Modus-Wechsel in Ruhe', () => {
    // Mehrere Segmente heißen: jemand hat den Modus selbst umgeschaltet
    // (ältere Aufnahmen mit der Chip-Reihe). Das wird nicht überschrieben.
    const segmente = [
      segment(
        'bike',
        track([
          [20, 600],
          [4, 600],
        ]),
      ),
      segment('ferry', track([[30, 600]])),
    ]
    expect(splitWalkSegmentsInSegments(segmente)).toEqual(segmente)
  })

  it('verträgt eine leere Liste', () => {
    expect(splitWalkSegmentsInSegments([])).toEqual([])
  })
})

describe('Zusammenspiel mit dem Pausen-Kollaps (ladeOriginalSegmente-Reihenfolge)', () => {
  it('nach dem Kollaps entsteht aus einer langen Fotopause weiter kein Gehabschnitt', () => {
    // Die Pipeline kollabiert Pausen VOR der Gehabschnitts-Erkennung: das
    // Momentantempo in der Pause ist danach exakt 0 (statt GPS-Zittern), die
    // Verdrängung bleibt unter der Schranke — die Erkennung darf sich davon
    // nicht anders verhalten als vorher.
    const s = segment('moped', kette(fahrt(30, 600, 10), halt(1200), fahrt(30, 600, 10)))
    const erg = splitWalkSegmentsInSegments(collapsePauses([s]))
    expect(erg.map((t) => t.mode)).toEqual(['moped'])
  })

  it('der Kollaps nimmt der Median-Nachhinker-Falle die Nahrung, ändert aber nichts am Ergebnis', () => {
    const s = segment('moped', kette(gehen(300), halt(1200), fahrt(30, 900, 60)))
    const mit = verlauf(splitWalkSegmentsInSegments(collapsePauses([s])))
    const ohne = verlauf(splitWalkSegmentsInSegments([s]))
    expect(mit.map((v) => v[0])).toEqual(ohne.map((v) => v[0]))
  })
})

describe('Zusammenspiel mit den Modus-Grenzen des Editors', () => {
  it('eine gesetzte Grenze übersteuert die Automatik', () => {
    // Die Automatik ist ein Vorschlag auf den Rohdaten; wer im Editor eine
    // Grenze zieht, hat das letzte Wort.
    const startMs = Date.parse('2026-07-04T08:00:00Z')
    const roh = splitWalkSegmentsInSegments([
      segment(
        'bike',
        track([
          [20, 600],
          [4, 600],
        ]),
      ),
    ])
    expect(roh.map((s) => s.mode)).toEqual(['bike', 'walk'])

    const mitGrenze = applyTravelModes(
      roh,
      [{ from: new Date(startMs).toISOString(), mode: 'ferry' }],
      startMs,
    )
    // Ab dem Tour-Anfang gilt Fähre — der erkannte Gehabschnitt verschwindet
    expect([...new Set(mitGrenze.map((s) => s.mode))]).toEqual(['ferry'])
  })

  it('ohne Grenzen bleibt die erkannte Aufteilung stehen', () => {
    const startMs = Date.parse('2026-07-04T08:00:00Z')
    const roh = splitWalkSegmentsInSegments([
      segment(
        'bike',
        track([
          [20, 600],
          [4, 600],
        ]),
      ),
    ])
    expect(applyTravelModes(roh, [], startMs).map((s) => s.mode)).toEqual(['bike', 'walk'])
  })
})

describe('istAufzeichnung', () => {
  it('erkennt einen aufgezeichneten Track am dichten Zeitraster', () => {
    // `track` legt einen Punkt je 5 s — genau die Form, die die App liefert
    expect(isRecording([segment('walk', track([[5, 900]]))])).toBe(true)
  })

  it('verwirft gesetzte Wegpunkte einer Foto-Tour', () => {
    // Foto-Orte liegen Minuten auseinander; jedes Tempo dazwischen ist Zufall
    const pts: UploadPoint[] = []
    for (let i = 0; i < 40; i++) pts.push([7.9 + i * 300 * GRAD_PRO_METER, 46.59, 800, i * 420])
    expect(isRecording([{ mode: 'walk', pts }])).toBe(false)
  })

  it('verwirft zu kurze Spuren, deren Takt nichts aussagt', () => {
    expect(isRecording([segment('walk', track([[5, 60]]))])).toBe(false)
    expect(isRecording([])).toBe(false)
  })

  it('erträgt Lücken (Tunnel, kurz pausierter Track)', () => {
    const pts = kette(fahrt(20, 600, 10), fahrt(20, 600, 10))
    // Eine 4-min-Lücke mittendrin darf die Aufzeichnung nicht disqualifizieren
    const mitLuecke: UploadPoint[] = pts.map((p, i) =>
      i > pts.length / 2 ? [p[0], p[1], p[2], p[3] + 240] : p,
    )
    expect(isRecording([{ mode: 'walk', pts: mitLuecke }])).toBe(true)
  })
})

describe('Aufnahme ohne Modus-Angabe (der Tram-Fall)', () => {
  // Die App schickt „Automatisch" als `walk` — vom echten Zu-Fuß nicht
  // unterscheidbar. Bis Juli 2026 lief bei App-Aufnahmen zudem gar keine
  // Erkennung (die Automatik hing an `trackFile`, das nur der GPX-Import
  // setzt). Eine Straßenbahnfahrt mit Fußwegen blieb dadurch ein einziges
  // „zu Fuß" über die ganze Tour.
  it('trennt Fahrt und Fußweg, obwohl „zu Fuß" angegeben war', () => {
    const s = segment('walk', kette(fahrt(22, 420, 10), gehen(600), fahrt(22, 420, 10)))
    const erg = splitWalkSegmentsInSegments([s])
    expect(erg.map((t) => t.mode)).toEqual(['bike', 'walk', 'bike'])
  })

  it('lässt eine echte Wanderung in Ruhe', () => {
    const erg = splitWalkSegmentsInSegments([segment('walk', kette(gehen(1800)))])
    expect(erg.map((t) => t.mode)).toEqual(['walk'])
  })
})
