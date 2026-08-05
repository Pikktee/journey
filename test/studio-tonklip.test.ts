// Ton-Klips auf der Filmzeit-Achse (Etappe 4, docs §2E) — DOM-frei.
//
// Zwei Regeln stehen hier im Mittelpunkt, weil sie leicht verlorengehen:
// Trimmen hat an BEIDEN Kanten das Material als Anschlag, und Loop hebt nur den
// RECHTEN auf — vor dem Dateianfang gibt es nichts zu wiederholen.

import { describe, expect, it } from 'vitest'
import type { AudioEintrag, TrackPunkt } from '../src/studio/editmodell'
import {
  TON_MIN_S,
  loeseTonKlips,
  schreibeTonFest,
  tonLanes,
  loopNachRollenwechsel,
  setzeLoop,
  trimmeLinks,
  trimmeRechts,
  verankere,
  verschiebeTon,
  wellenLage,
  type TonKlip,
} from '../src/studio/tonklip'
import { baueAchse, type Achse } from '../src/studio/zeitleiste'

const START = '2026-07-04T08:00:00.000Z'

/** Gerade Strecke: 96 m je 60 s, zu Fuß → 2 Filmsekunden je Punkt. */
function track(punkte = 31): TrackPunkt[] {
  const gradProMeter = 1 / (111_320 * Math.cos((46.6 * Math.PI) / 180))
  return Array.from({ length: punkte }, (_, i): TrackPunkt => [7.9 + i * 96 * gradProMeter, 46.6, 800, i * 60])
}

/** Achse ohne Halte: 30 Schritte à 2 Filmsekunden = 60 s Film, 1800 s Aufnahme. */
function achseOhneHalt(): Achse {
  return baueAchse([{ mode: 'walk', aktiv: true, pts: track() }], [], { vonS: 0, bisS: 1800 })
}

/** Dieselbe Achse mit einem 6-s-Halt bei Aufnahmesekunde 600. */
function achseMitHalt(): Achse {
  return baueAchse([{ mode: 'walk', aktiv: true, pts: track() }], [{ offsetS: 600, breiteS: 6 }], {
    vonS: 0,
    bisS: 1800,
  })
}

const klipVon = (klips: readonly TonKlip[], index = 0): TonKlip => klips[index] as TonKlip

describe('loeseTonKlips — alte und neue Verankerung nebeneinander', () => {
  const achse = achseOhneHalt()

  it('liest einen Bestands-Eintrag über ab/bis (unverändert)', () => {
    const audio: AudioEintrag[] = [{ datei: 'a.mp3', typ: 'musik', ab: '2026-07-04T08:05:00.000Z' }]
    const k = klipVon(loeseTonKlips(audio, START, achse))
    expect(k.altVerankert).toBe(true)
    expect(k.filmVon).toBeCloseTo(10, 6) // 300 Aufnahmesekunden = 10 Filmsekunden
    expect(k.filmBis).toBeCloseTo(achse.kurve?.gesamtS ?? 0, 6) // ohne `bis`: bis zum Schluss
    expect(k.laengeGesetzt).toBe(false)
    expect(k.loop).toBe(true) // Vorgabe für Musik — das bisherige Verhalten
  })

  it('bevorzugt Anker + Versatz, sobald sie dastehen', () => {
    const audio: AudioEintrag[] = [
      {
        datei: 'a.mp3',
        typ: 'musik',
        ab: '2026-07-04T08:00:00.000Z', // absichtlich woanders — darf nicht gewinnen
        anker: '2026-07-04T08:05:00.000Z',
        versatzFilmS: 2.5,
        dauerFilmS: 8,
      },
    ]
    const k = klipVon(loeseTonKlips(audio, START, achse))
    expect(k.altVerankert).toBe(false)
    expect(k.filmVon).toBeCloseTo(12.5, 6)
    expect(k.filmBis).toBeCloseTo(20.5, 6)
    expect(k.laengeGesetzt).toBe(true)
  })

  it('gibt einem Effekt die Breite seiner DATEI — die Marke war eine Lüge der Anzeige', () => {
    // Der Player spielt einen One-Shot bis zum Dateiende; als Punkt gezeichnet
    // verschwieg die Leiste nur, wie lange er klingt.
    const audio: AudioEintrag[] = [{ datei: 'sfx-moewe.mp3', typ: 'sfx', ab: '2026-07-04T08:05:00.000Z' }]
    const ohneMass = klipVon(loeseTonKlips(audio, START, achse))
    expect(ohneMass.filmBis).toBe(ohneMass.filmVon) // ungemessen: bleibt ein Punkt
    expect(ohneMass.loop).toBe(false) // Vorgabe für Effekte

    const gemessen = klipVon(loeseTonKlips(audio, START, achse, new Map([['sfx-moewe.mp3', 3.5]])))
    expect(gemessen.filmBis - gemessen.filmVon).toBeCloseTo(3.5, 6)
    expect(gemessen.laengeGesetzt).toBe(false) // abgeleitet, nicht entschieden
  })

  it('stapelt Überlappungen in Unterzeilen — der Player mischt sie', () => {
    const audio: AudioEintrag[] = [
      { datei: 'a.mp3', typ: 'musik', ab: START, anker: START, versatzFilmS: 0, dauerFilmS: 20 },
      { datei: 'b.mp3', typ: 'musik', ab: START, anker: START, versatzFilmS: 10, dauerFilmS: 20 },
      { datei: 'c.mp3', typ: 'musik', ab: START, anker: START, versatzFilmS: 40, dauerFilmS: 10 },
    ]
    const klips = loeseTonKlips(audio, START, achse)
    expect(klips.map((k) => k.lane)).toEqual([0, 1, 0]) // c passt wieder in Zeile 0
    expect(tonLanes(klips)).toBe(2)
  })
})

describe('verankere — Anker in Aufnahmezeit, Feinlage in Filmsekunden', () => {
  it('hält die Filmposition exakt, obwohl der Anker auf Sekunden rundet', () => {
    const achse = achseOhneHalt()
    for (const filmS of [0, 3.7, 12.25, 41.9]) {
      const { anker, versatzFilmS } = verankere(achse, START, filmS)
      const klips = loeseTonKlips([{ datei: 'a.mp3', typ: 'musik', ab: anker, anker, versatzFilmS }], START, achse)
      // Auf die Millisekunde: der Versatz wird auf drei Stellen gerundet, damit
      // das Overlay lesbar bleibt. Bei jedem denkbaren Maßstab liegt das weit
      // unter einem Pixel.
      expect(klipVon(klips).filmVon).toBeCloseTo(filmS, 3)
    }
  })

  it('trifft auch eine Stelle MITTEN in einem Halt — das kann Aufnahmezeit nicht', () => {
    // Der Kernbefund aus §1: Im Halt gibt es keine unterscheidbare Aufnahmezeit.
    // Der Versatz trägt die Feinlage, deshalb landet der Klip trotzdem genau dort.
    const achse = achseMitHalt()
    const imHalt = 20 + 3 // Halt beginnt bei Filmsekunde 20 (600 s ÷ 30 s/Filmsek.)
    const { anker, versatzFilmS } = verankere(achse, START, imHalt)
    expect(versatzFilmS).toBeGreaterThan(0) // ohne ihn fiele die Lage auf die Haltkante
    const klips = loeseTonKlips([{ datei: 'a.mp3', typ: 'musik', ab: anker, anker, versatzFilmS }], START, achse)
    expect(klipVon(klips).filmVon).toBeCloseTo(imHalt, 6)
  })
})

describe('trimmeLinks — Anfang und Datei-Einstieg wandern gemeinsam', () => {
  const achse = achseOhneHalt()
  const klip = (patch: Partial<TonKlip> = {}): TonKlip => ({
    index: 0,
    typ: 'musik',
    datei: 'a.mp3',
    filmVon: 10,
    filmBis: 30,
    einstiegS: 0,
    loop: true,
    dateiS: 60,
    lane: 0,
    altVerankert: false,
    laengeGesetzt: true,
    ...patch,
  })

  it('legt frei statt zu verschieben: der Inhalt bleibt an seinem Platz im Film', () => {
    const { patch } = trimmeLinks(achse, START, klip(), 14)
    expect(patch.einstiegS).toBeCloseTo(4, 3) // 4 s Datei fallen vorne weg
    expect(patch.dauerFilmS).toBeCloseTo(16, 3) // rechte Kante bleibt bei 30
  })

  it('hat den DATEIANFANG als Anschlag — und Loop ändert daran nichts', () => {
    // Loop springt am Dateiende auf den Dateianfang. Eine Wiederholung VOR dem
    // Anfang gibt es nicht; wer sie zuließ, ließ das Stück mitten drin einsetzen.
    for (const loop of [true, false]) {
      const a = klip({ einstiegS: 3, loop })
      const { patch, amAnschlag } = trimmeLinks(achse, START, a, 0) // weit nach links gezogen
      expect(patch.einstiegS).toBe(0)
      expect(amAnschlag).toBe(true)
      // Die Kante steht bei filmVon − einstiegS = 7, nicht bei 0
      expect(patch.dauerFilmS).toBeCloseTo(23, 3)
    }
  })

  it('lässt den Klip nicht auf null zusammenschnurren', () => {
    const { patch } = trimmeLinks(achse, START, klip({ einstiegS: 30 }), 99)
    expect(patch.dauerFilmS).toBeCloseTo(TON_MIN_S, 6)
  })
})

describe('trimmeRechts — nur das Ende, Loop hebt den Anschlag auf', () => {
  const achse = achseOhneHalt()
  const klip = (patch: Partial<TonKlip> = {}): TonKlip => ({
    index: 0,
    typ: 'sfx',
    datei: 'sfx-brandung.mp3',
    filmVon: 10,
    filmBis: 14,
    einstiegS: 0,
    loop: false,
    dateiS: 8,
    lane: 0,
    altVerankert: false,
    laengeGesetzt: true,
    ...patch,
  })

  it('stoppt ohne Loop am Material', () => {
    const { patch, amAnschlag } = trimmeRechts(achse, START, klip(), 40)
    expect(patch.dauerFilmS).toBeCloseTo(8, 3) // die ganze Datei, kein Meter mehr
    expect(amAnschlag).toBe(true)
  })

  it('zieht den Anschlag um den Einstieg mit — getrimmtes Material ist weg', () => {
    const { patch } = trimmeRechts(achse, START, klip({ einstiegS: 3 }), 40)
    expect(patch.dauerFilmS).toBeCloseTo(5, 3) // 8 s Datei minus 3 s Einstieg
  })

  it('wächst MIT Loop beliebig weiter', () => {
    const { patch, amAnschlag } = trimmeRechts(achse, START, klip({ loop: true }), 40)
    expect(patch.dauerFilmS).toBeCloseTo(30, 3)
    expect(amAnschlag).toBe(false)
  })

  it('klemmt nicht, solange die Datei nicht gemessen ist', () => {
    const ohne = klip()
    delete (ohne as { dateiS?: number }).dateiS
    const { patch, amAnschlag } = trimmeRechts(achse, START, ohne, 40)
    expect(patch.dauerFilmS).toBeCloseTo(30, 3)
    expect(amAnschlag).toBe(false)
  })

  it('rührt die linke Kante nicht an', () => {
    const a = klip({ einstiegS: 2 })
    const { patch } = trimmeRechts(achse, START, a, 12)
    const klips = loeseTonKlips(
      [{ datei: a.datei, typ: a.typ, ab: patch.anker, ...patch }],
      START,
      achse,
      new Map([[a.datei, 8]]),
    )
    expect(klipVon(klips).filmVon).toBeCloseTo(a.filmVon, 3)
    expect(klipVon(klips).einstiegS).toBeCloseTo(2, 3)
  })
})

describe('verschiebeTon — der Klip hängt danach woanders an der Reise', () => {
  const achse = achseOhneHalt()
  const basis: TonKlip = {
    index: 0,
    typ: 'musik',
    datei: 'a.mp3',
    filmVon: 10,
    filmBis: 30,
    einstiegS: 4,
    loop: true,
    dateiS: 60,
    lane: 0,
    altVerankert: false,
    laengeGesetzt: true,
  }

  it('nimmt Länge und Einstieg unverändert mit', () => {
    const patch = verschiebeTon(achse, START, basis, 25)
    expect(patch.dauerFilmS).toBeCloseTo(20, 3)
    expect(patch.einstiegS).toBeCloseTo(4, 3)
    const klips = loeseTonKlips([{ datei: 'a.mp3', typ: 'musik', ab: patch.anker, ...patch }], START, achse)
    expect(klipVon(klips).filmVon).toBeCloseTo(25, 3)
  })

  it('schreibt KEINE Länge fest, wo sie nur abgeleitet war', () => {
    // „Läuft bis zum Schluss" darf durch bloßes Verschieben nicht zu einer
    // festen Dauer werden — und ein One-Shot nicht zum Bereich.
    const offen = { ...basis, laengeGesetzt: false, filmBis: achse.kurve?.gesamtS ?? 0 }
    expect(verschiebeTon(achse, START, offen, 25).dauerFilmS).toBeUndefined()
  })
})

describe('schreibeTonFest — die Aufwertung ändert die Lage nicht', () => {
  it('bildet einen Bestands-Eintrag an derselben Filmstelle ab', () => {
    const achse = achseMitHalt()
    const audio: AudioEintrag[] = [
      { datei: 'a.mp3', typ: 'musik', ab: '2026-07-04T08:05:00.000Z', bis: '2026-07-04T08:15:00.000Z' },
    ]
    const vorher = klipVon(loeseTonKlips(audio, START, achse))
    const patch = schreibeTonFest(achse, START, vorher)
    const nachher = klipVon(loeseTonKlips([{ ...audio[0]!, ...patch }], START, achse))
    expect(nachher.filmVon).toBeCloseTo(vorher.filmVon, 3)
    expect(nachher.filmBis).toBeCloseTo(vorher.filmBis, 3)
    expect(nachher.altVerankert).toBe(false)
  })

  it('ist idempotent — zweimal festschreiben ändert nichts mehr', () => {
    const achse = achseMitHalt()
    const audio: AudioEintrag[] = [{ datei: 'a.mp3', typ: 'musik', ab: '2026-07-04T08:05:00.000Z' }]
    const eins = schreibeTonFest(achse, START, klipVon(loeseTonKlips(audio, START, achse)))
    const zwischen = { ...audio[0]!, ...eins }
    const zwei = schreibeTonFest(achse, START, klipVon(loeseTonKlips([zwischen], START, achse)))
    expect(zwei).toEqual(eins)
  })
})

describe('Ton-Magnetik — eine geänderte Standzeit nimmt den Ton mit', () => {
  // Der Grund für die ganze Aufwertung: Ton war das einzige Element, das liegen
  // blieb, wenn sich eine Standzeit änderte. Der Anker in Aufnahmezeit macht ihn
  // magnetisch — was VOR der Standzeit liegt, bleibt exakt stehen, was dahinter
  // liegt, rückt um genau ihren Zuwachs mit.
  const HALT_S = 600 // Aufnahmesekunde des Halts → Filmsekunde 20
  const BASIS_BREITE = 12

  /** Dieselbe Achse, nur mit anderer Haltbreite. 30 Aufnahmesekunden = 1 Filmsekunde. */
  const achseMitBreite = (breiteS: number): Achse =>
    baueAchse([{ mode: 'walk', aktiv: true, pts: track() }], [{ offsetS: HALT_S, breiteS }], { vonS: 0, bisS: 1800 })

  /** Ein filmverankerter Klip fester Länge an der Filmstelle `filmS` der Basis-Achse. */
  function verankerterKlip(filmS: number): AudioEintrag {
    const { anker, versatzFilmS } = verankere(achseMitBreite(BASIS_BREITE), START, filmS)
    return { datei: 'a.mp3', typ: 'musik', ab: anker, anker, versatzFilmS, dauerFilmS: 8 }
  }

  const lageBei = (eintrag: AudioEintrag, breiteS: number): TonKlip =>
    klipVon(loeseTonKlips([eintrag], START, achseMitBreite(breiteS)))

  it('lässt einen Klip VOR der Standzeit exakt stehen', () => {
    const klip = verankerterKlip(10)
    for (const breiteS of [BASIS_BREITE + 10, BASIS_BREITE - 10]) {
      expect(lageBei(klip, breiteS).filmVon).toBeCloseTo(10, 3)
    }
  })

  it('rückt einen Klip DAHINTER um genau den Zuwachs mit', () => {
    const klip = verankerterKlip(40)
    expect(lageBei(klip, BASIS_BREITE).filmVon).toBeCloseTo(40, 3)
    expect(lageBei(klip, BASIS_BREITE + 10).filmVon).toBeCloseTo(50, 3)
    expect(lageBei(klip, BASIS_BREITE - 10).filmVon).toBeCloseTo(30, 3)
  })

  it('hält die Feinlage INNERHALB der Standzeit, auch wenn diese wächst', () => {
    // Der Versatz misst ab dem Beginn des Halts — der Klip behält seinen Platz
    // darin, statt an die Kante zu rutschen oder mit der Breite zu skalieren.
    const klip = verankerterKlip(23) // 3 Filmsekunden nach Haltbeginn (Filmsekunde 20)
    for (const breiteS of [BASIS_BREITE + 10, BASIS_BREITE - 10]) {
      expect(lageBei(klip, breiteS).filmVon).toBeCloseTo(23, 3)
    }
  })

  it('lässt die LÄNGE unangetastet — sie steht in Filmsekunden', () => {
    for (const filmS of [10, 23, 40]) {
      const klip = verankerterKlip(filmS)
      for (const breiteS of [BASIS_BREITE, BASIS_BREITE + 10, BASIS_BREITE - 10]) {
        const k = lageBei(klip, breiteS)
        expect(k.filmBis - k.filmVon).toBeCloseTo(8, 3)
      }
    }
  })

  it('zum Vergleich: ein alt verankerter Klip DEHNT sich über der Standzeit', () => {
    // Genau das ist der Unterschied: `ab`/`bis` sind zwei Aufnahmezeiten, und die
    // Standzeit dazwischen zählt in beide hinein. Der Klip wird länger, statt
    // mitzurücken — ein Musikstück, das plötzlich 10 Filmsekunden mehr füllen soll.
    const alt: AudioEintrag = {
      datei: 'a.mp3',
      typ: 'musik',
      ab: '2026-07-04T08:05:00.000Z', // Aufnahmesekunde 300, vor dem Halt
      bis: '2026-07-04T08:20:00.000Z', // Aufnahmesekunde 1200, dahinter
    }
    const basis = lageBei(alt, BASIS_BREITE)
    const breiter = lageBei(alt, BASIS_BREITE + 10)
    expect(basis.altVerankert).toBe(true)
    expect(breiter.filmVon).toBeCloseTo(basis.filmVon, 3) // der Anfang bleibt
    expect(breiter.filmBis - breiter.filmVon).toBeCloseTo(basis.filmBis - basis.filmVon + 10, 3)
  })
})

describe('wellenLage — die Wellenform gehört zur DATEI, nicht zum Klip', () => {
  const basis: TonKlip = {
    index: 0,
    typ: 'musik',
    datei: 'a.mp3',
    filmVon: 10,
    filmBis: 30,
    einstiegS: 4,
    loop: false,
    dateiS: 60,
    lane: 0,
    altVerankert: false,
    laengeGesetzt: true,
  }

  it('misst in DATEI-Breite und schiebt um den Einstieg — man sieht, was wegfällt', () => {
    // Auf Klipbreite gestaucht sähe jeder Trim wie ein Tempowechsel aus.
    const lage = wellenLage(basis, 10)
    expect(lage?.breitePx).toBeCloseTo(600, 6) // 60 s Datei × 10 px/s
    expect(lage?.versatzPx).toBeCloseTo(-40, 6) // um den Einstieg nach links
    expect(lage?.wiederholungen).toBe(1)
  })

  it('wiederholt nur bei Loop', () => {
    expect(wellenLage({ ...basis, dateiS: 8, loop: false }, 10)?.wiederholungen).toBe(1)
    // 4 s Einstieg + 20 s Klip = 24 s über eine 8-s-Datei → drei Durchläufe
    expect(wellenLage({ ...basis, dateiS: 8, loop: true }, 10)?.wiederholungen).toBe(3)
  })

  it('bleibt weg, solange die Datei nicht gemessen ist', () => {
    const ohne = { ...basis }
    delete (ohne as { dateiS?: number }).dateiS
    expect(wellenLage(ohne, 10)).toBeNull()
  })
})

describe('setzeLoop — Loop aus holt den Klip ans Material zurück', () => {
  const achse = achseOhneHalt()
  const basis: TonKlip = {
    index: 0,
    typ: 'musik',
    datei: 'a.mp3',
    filmVon: 10,
    // Unter Loop weit über das Dateiende hinaus gewachsen
    filmBis: 45,
    einstiegS: 0,
    loop: true,
    dateiS: 22,
    lane: 0,
    altVerankert: false,
    laengeGesetzt: true,
  }

  it('schneidet den stummen Rest weg, statt ihn stehen zu lassen', () => {
    // Ohne das hinge hinter der Wellenform Stille im Klip — und Stille gehört
    // ZWISCHEN die Klips, nie in einen. Man müsste ihn von Hand zurechtziehen,
    // um überhaupt zu sehen, wo sein Material endet.
    expect(setzeLoop(achse, START, basis, false).dauerFilmS).toBeCloseTo(22, 3)
  })

  it('zieht den Einstieg mit ab — getrimmtes Material ist weg', () => {
    expect(setzeLoop(achse, START, { ...basis, einstiegS: 6 }, false).dauerFilmS).toBeCloseTo(16, 3)
  })

  it('lässt einen Klip in Ordnung unangetastet', () => {
    const kurz = { ...basis, filmBis: 18 } // 8 s, passt in die 22-s-Datei
    expect(setzeLoop(achse, START, kurz, false).dauerFilmS).toBeCloseTo(8, 3)
  })

  it('Loop AN nimmt nur den Anschlag weg — die Länge bleibt', () => {
    expect(setzeLoop(achse, START, basis, true).dauerFilmS).toBeCloseTo(35, 3)
  })

  it('friert ohne gemessene Datei nichts ein', () => {
    // Ohne Anschlag gäbe es nichts zurückzuholen; eine Länge festzuschreiben
    // wäre eine Aussage, die niemand getroffen hat.
    const ohne = { ...basis, laengeGesetzt: false }
    delete (ohne as { dateiS?: number }).dateiS
    expect(setzeLoop(achse, START, ohne, false).dauerFilmS).toBeUndefined()
  })
})

describe('loopNachRollenwechsel — die Rolle darf das Verhalten nicht still kippen', () => {
  const k = (typ: 'musik' | 'sfx', loop: boolean): TonKlip => ({
    index: 0,
    typ,
    datei: 'a.mp3',
    filmVon: 0,
    filmBis: 10,
    einstiegS: 0,
    loop,
    lane: 0,
    altVerankert: false,
    laengeGesetzt: true,
  })

  it('schreibt das bisherige Verhalten fest, wo die neue Vorgabe es umdrehen würde', () => {
    // Eine durchlaufende Atmosphäre („Filmmusik", loop an) wird zu „Ton der
    // Szene" — dort ist die Vorgabe AUS. Ohne diesen Wert würde sie still zum
    // einmaligen Knall.
    expect(loopNachRollenwechsel(k('musik', true), 'sfx')).toBe(true)
    expect(loopNachRollenwechsel(k('sfx', false), 'musik')).toBe(false)
  })

  it('lässt das Feld weg, wo die neue Vorgabe ohnehin passt', () => {
    expect(loopNachRollenwechsel(k('sfx', true), 'musik')).toBeUndefined()
    expect(loopNachRollenwechsel(k('musik', false), 'sfx')).toBeUndefined()
  })
})
