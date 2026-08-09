// Aufnahmen zu einer bestehenden Tour nachreichen (rechnende Teile) und das
// zweistufige endgültige Löschen im Overlay.
// Konzept: docs/concepts/konzept_medien_nachreichen_und_loeschen.md

import { describe, expect, it } from 'vitest'
import { endgueltigZuLoeschen, ohneMedien, type EditOverlay } from '../src/studio/editmodell.js'
import {
  abstandsFunktion,
  befundSaetze,
  einordnungWort,
  fasseZusammen,
  MAX_ABSTAND_M,
  megabyte,
  ordneEin,
  streifenAnteil,
  type NeueAufnahme,
} from '../src/studio/nachreichen.js'

const TOUR = { startMs: Date.parse('2026-07-04T08:00:00Z'), endMs: Date.parse('2026-07-04T14:00:00Z') }

function aufnahme(teil: Partial<NeueAufnahme> = {}): NeueAufnahme {
  return {
    datei: 'IMG_0001.jpg',
    typ: 'photo',
    zeitMs: Date.parse('2026-07-04T10:00:00Z'),
    zeitGeraten: false,
    ort: null,
    groesse: 1048576,
    ...teil,
  }
}

describe('ordneEin', () => {
  it('Ort schlägt Zeit — auch weit außerhalb der Aufzeichnung', () => {
    // Dieselbe Regel wie im Manifest: `anchor` gewinnt, die Zeit ist der Rückfall.
    const weit = aufnahme({ ort: [18.07, 59.33], zeitMs: Date.parse('2020-01-01T00:00:00Z') })
    expect(ordneEin([weit], TOUR)[0]?.einordnung).toBe('ort')
  })

  it('ohne Ort entscheidet die Uhrzeit über Strecke oder Ablage', () => {
    const drin = aufnahme({ datei: 'a.jpg', zeitMs: Date.parse('2026-07-04T11:00:00Z') })
    const weit = aufnahme({ datei: 'b.jpg', zeitMs: Date.parse('2026-07-05T11:00:00Z') })
    const [a, b] = ordneEin([drin, weit], TOUR)
    expect(a?.einordnung).toBe('zeit')
    expect(b?.einordnung).toBe('ablage')
  })

  it('kennt KEINE Toleranz um die Aufzeichnung — die Achse steht schon fest', () => {
    // Anders als beim Anlegen: Der Server findet außerhalb der Zeitspanne
    // keinen Trackpunkt, eine Toleranz verspräche eine Platzierung, die dann
    // doch in der Ablage endet.
    const knappDavor = aufnahme({ zeitMs: TOUR.startMs - 60000 })
    const knappDrin = aufnahme({ zeitMs: TOUR.startMs + 60000 })
    expect(ordneEin([knappDavor], TOUR)[0]?.einordnung).toBe('ablage')
    expect(ordneEin([knappDrin], TOUR)[0]?.einordnung).toBe('zeit')
  })

  it('eine GERATENE Zeit im Fenster reicht — sie ist meist die richtige', () => {
    // Datei-Datum statt EXIF: bei Dateien direkt von der Kamera stimmt es.
    const geraten = aufnahme({ zeitGeraten: true, zeitMs: Date.parse('2026-07-04T09:30:00Z') })
    expect(ordneEin([geraten], TOUR)[0]?.einordnung).toBe('zeit')
  })

  it('ein GPS-Anker fern der Strecke sitzt NICHT auf ihr', () => {
    // Genau die Reihenfolge des Servers: zu weit weg → Zeit → sonst Ablage.
    const strecke = [
      [18.07, 59.33],
      [18.08, 59.34],
    ]
    const abstand = abstandsFunktion(strecke)
    expect(abstand).toBeDefined()
    const ziel = { ...TOUR, abstandZurStrecke: abstand! }
    const nah = aufnahme({ datei: 'nah.jpg', ort: [18.0705, 59.3305] })
    // ~1,5 km östlich — jenseits der 500 m, aber mit Zeit in der Aufzeichnung
    const fern = aufnahme({ datei: 'fern.jpg', ort: [18.097, 59.33] })
    const fernOhneZeit = aufnahme({
      datei: 'fern2.jpg',
      ort: [18.097, 59.33],
      zeitMs: Date.parse('2019-01-01T00:00:00Z'),
    })
    expect(ordneEin([nah], ziel)[0]?.einordnung).toBe('ort')
    expect(ordneEin([fern], ziel)[0]?.einordnung).toBe('zeit')
    expect(ordneEin([fernOhneZeit], ziel)[0]?.einordnung).toBe('ablage')
  })

  it('ohne bekannte Strecke bleibt der Anker gültig', () => {
    // Die Abstandsfunktion ist optional — ohne sie gilt die alte, großzügige
    // Regel (so verhält es sich beim Anlegen, wo die Strecke erst entsteht).
    const fern = aufnahme({ ort: [0, 0] })
    expect(ordneEin([fern], TOUR)[0]?.einordnung).toBe('ort')
    expect(abstandsFunktion([[18.07, 59.33]])).toBeUndefined()
  })

  it('hält dieselbe Schwelle wie die Pipeline', () => {
    // Drift-Wächter zu MAX_ABSTAND_M in server/src/pipeline/placement.ts
    expect(MAX_ABSTAND_M).toBe(500)
  })
})

describe('fasseZusammen', () => {
  it('zählt je Gruppe, summiert die Bytes und sortiert nach Zeit', () => {
    const befund = fasseZusammen(
      [
        aufnahme({ datei: 'spaet.jpg', zeitMs: Date.parse('2026-07-04T13:00:00Z'), groesse: 2 * 1048576 }),
        aufnahme({ datei: 'ort.jpg', ort: [18.07, 59.33], zeitMs: Date.parse('2026-07-04T09:00:00Z') }),
        aufnahme({ datei: 'weg.jpg', zeitMs: Date.parse('2019-01-01T00:00:00Z') }),
      ],
      TOUR,
    )
    expect(befund.aufnahmen.map((a) => a.datei)).toEqual(['weg.jpg', 'ort.jpg', 'spaet.jpg'])
    expect([befund.mitOrt, befund.nachZeit, befund.inAblage]).toEqual([1, 1, 1])
    expect(befund.gesamtBytes).toBe(4 * 1048576)
  })

  it('dehnt den Streifen über Ausreißer — daneben muss SICHTBAR daneben sein', () => {
    const frueh = Date.parse('2026-07-01T00:00:00Z')
    const befund = fasseZusammen([aufnahme({ zeitMs: frueh })], TOUR)
    expect(befund.vonMs).toBe(frueh)
    expect(befund.bisMs).toBe(TOUR.endMs)
  })

  it('ohne neue Aufnahmen bleibt der Streifen die Tour', () => {
    const befund = fasseZusammen([], TOUR)
    expect([befund.vonMs, befund.bisMs]).toEqual([TOUR.startMs, TOUR.endMs])
  })
})

describe('befundSaetze', () => {
  it('nennt nur Gruppen, die es gibt — und im Singular ohne Zahl', () => {
    const saetze = befundSaetze(fasseZusammen([aufnahme({ ort: [18.07, 59.33] })], TOUR))
    expect(saetze).toHaveLength(1)
    expect(saetze[0]).toContain('Eine Aufnahme mit Ortsangabe')
  })

  it('zählt ab zwei', () => {
    const saetze = befundSaetze(
      fasseZusammen([aufnahme({ datei: 'a.jpg' }), aufnahme({ datei: 'b.jpg' })], TOUR),
    )
    expect(saetze[0]).toContain('2 Aufnahmen ohne Ortsangabe')
  })

  it('ohne Auswahl gibt es keinen Satz über nichts', () => {
    expect(befundSaetze(fasseZusammen([], TOUR))).toEqual([])
  })
})

describe('Anzeige-Helfer', () => {
  it('benennt die Einordnung so, wie sie in der Zeile steht', () => {
    expect(einordnungWort('ort')).toBe('Ort')
    expect(einordnungWort('zeit')).toBe('nach Uhrzeit')
    expect(einordnungWort('ablage')).toBe('in die Ablage')
  })

  it('klemmt den Streifen-Anteil, statt Punkte zu verlieren', () => {
    expect(streifenAnteil(50, 0, 100)).toBeCloseTo(0.5)
    expect(streifenAnteil(-10, 0, 100)).toBe(0)
    expect(streifenAnteil(999, 0, 100)).toBe(1)
    // Entartete Spanne (alles zur selben Zeit) darf nicht NaN liefern
    expect(streifenAnteil(5, 5, 5)).toBe(0)
  })

  it('schreibt Größen deutsch, mit Komma', () => {
    expect(megabyte(46.2 * 1048576)).toBe('46,2 MB')
  })
})

describe('Endgültiges Löschen im Overlay', () => {
  const overlay: EditOverlay = {
    schema: 'maptale/edits@1',
    titelbild: 'm1',
    medien: {
      m1: { geloescht: true },
      m2: { caption: 'Abfahrt' },
      m3: { geloescht: true, caption: 'weg damit' },
    },
  }

  it('findet, was beim Speichern endgültig verschwindet', () => {
    expect(endgueltigZuLoeschen(overlay).sort()).toEqual(['m1', 'm3'])
  })

  it('meldet nichts, wenn nichts entfernt wurde', () => {
    expect(endgueltigZuLoeschen({ schema: 'maptale/edits@1' })).toEqual([])
    expect(endgueltigZuLoeschen({ schema: 'maptale/edits@1', medien: { m1: { caption: 'da' } } })).toEqual([])
  })

  it('tilgt Overlay-Spuren gelöschter Medien samt Titelbild-Verweis', () => {
    const danach = ohneMedien(overlay, ['m1', 'm3'])
    expect(Object.keys(danach.medien ?? {})).toEqual(['m2'])
    // Ein Titelbild, das ins Leere zeigt, verhinderte die Neuwahl beim Render
    expect(danach.titelbild).toBeUndefined()
  })

  it('lässt ein Titelbild stehen, das ein anderes Medium meint', () => {
    const danach = ohneMedien({ ...overlay, titelbild: 'm2' }, ['m1'])
    expect(danach.titelbild).toBe('m2')
  })

  it('räumt den leeren medien-Block weg (das gespeicherte JSON bleibt minimal)', () => {
    const danach = ohneMedien({ schema: 'maptale/edits@1', medien: { m1: { geloescht: true } } }, ['m1'])
    expect('medien' in danach).toBe(false)
  })

  it('ändert nichts an anderen Spuren', () => {
    const mitTon: EditOverlay = {
      ...overlay,
      audio: [{ datei: 'mus-aufbruch.mp3', typ: 'musik', ab: '2026-07-04T08:00:00Z' }],
    }
    expect(ohneMedien(mitTon, ['m1']).audio).toEqual(mitTon.audio)
  })
})
