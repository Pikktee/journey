// Ton-Klips auf der Filmzeit-Achse (Etappe 4, docs §2E) — DOM-frei.
//
// Zwei Regeln stehen hier im Mittelpunkt, weil sie leicht verlorengehen:
// Trimmen hat an BEIDEN Kanten das Material als Anschlag, und Loop hebt nur den
// RECHTEN auf — vor dem Dateianfang gibt es nichts zu wiederholen.

import { describe, expect, it } from 'vitest'
import type { AudioEntry, TrackPoint } from '../src/studio/edit-model'
import {
  AUDIO_MIN_S,
  resolveAudioClips,
  commitAudioClip,
  audioLanes,
  loopAfterRoleChange,
  setLoop,
  trimLeft,
  trimRight,
  anchorClips,
  moveAudioClip,
  waveformPosition,
  type AudioClip,
} from '../src/studio/audio-clip'
import { RAMP_M, tempoMs } from '../src/film-axis'
import { buildTimelineAxis, type TimelineAxis } from '../src/studio/timeline'

const START = '2026-07-04T08:00:00.000Z'

/** Gerade Strecke: 96 m je 60 s, zu Fuß → 2 Filmsekunden je Punkt. */
function track(punkte = 31): TrackPoint[] {
  const gradProMeter = 1 / (111_320 * Math.cos((46.6 * Math.PI) / 180))
  return Array.from({ length: punkte }, (_, i): TrackPoint => [
    7.9 + i * 96 * gradProMeter,
    46.6,
    800,
    i * 60,
  ])
}

/**
 * Achse ohne Halte: 30 Schritte à 2 Filmsekunden = 60 s Film, 1800 s Aufnahme —
 * dazu die Anfahrt aus dem Stand, die seit E14 in der Achse liegt (120 m zu Fuß
 * = 2,5 Filmsekunden, `RAMP_M`).
 */
function achseOhneHalt(): TimelineAxis {
  return buildTimelineAxis([{ mode: 'walk', active: true, pts: track() }], [], {
    fromS: 0,
    toS: 1800,
  })
}

/** Dieselbe Achse mit einem 6-s-Halt bei Aufnahmesekunde 600. */
function achseMitHalt(): TimelineAxis {
  return buildTimelineAxis(
    [{ mode: 'walk', active: true, pts: track() }],
    [{ offsetS: 600, widthS: 6 }],
    {
      fromS: 0,
      toS: 1800,
    },
  )
}

const klipVon = (klips: readonly AudioClip[], index = 0): AudioClip => klips[index] as AudioClip

/** Zuschlag einer Anfahr-/Ausrollrampe zu Fuß (s). */
const RAMPE = RAMP_M / tempoMs('walk')
/** Filmsekunden für die ersten 300 Aufnahmesekunden (480 m zu Fuß). */
const BIS_300 = 480 / tempoMs('walk')

describe('resolveAudioClips — alte und neue Verankerung nebeneinander', () => {
  const achse = achseOhneHalt()

  it('liest einen Bestands-Eintrag über ab/bis (unverändert)', () => {
    const audio: AudioEntry[] = [{ file: 'a.mp3', type: 'music', from: '2026-07-04T08:05:00.000Z' }]
    const k = klipVon(resolveAudioClips(audio, START, achse))
    expect(k.legacyAnchored).toBe(true)
    expect(k.filmFrom).toBeCloseTo(BIS_300 + RAMPE, 6) // 300 Aufnahmesekunden Reise + Anfahrt
    expect(k.filmTo).toBeCloseTo(achse.curve?.totalS ?? 0, 6) // ohne `bis`: bis zum Schluss
    expect(k.hasExplicitLength).toBe(false)
    expect(k.loop).toBe(true) // Vorgabe für Musik — das bisherige Verhalten
  })

  it('bevorzugt Anker + Versatz, sobald sie dastehen', () => {
    const audio: AudioEntry[] = [
      {
        file: 'a.mp3',
        type: 'music',
        from: '2026-07-04T08:00:00.000Z', // absichtlich woanders — darf nicht gewinnen
        anchor: '2026-07-04T08:05:00.000Z',
        offsetFilmS: 2.5,
        durationFilmS: 8,
      },
    ]
    const k = klipVon(resolveAudioClips(audio, START, achse))
    expect(k.legacyAnchored).toBe(false)
    expect(k.filmFrom).toBeCloseTo(BIS_300 + 2.5 + RAMPE, 6)
    expect(k.filmTo).toBeCloseTo(BIS_300 + 10.5 + RAMPE, 6)
    expect(k.hasExplicitLength).toBe(true)
  })

  it('gibt einem Effekt die Breite seiner DATEI — die Marke war eine Lüge der Anzeige', () => {
    // Der Player spielt einen One-Shot bis zum Dateiende; als Punkt gezeichnet
    // verschwieg die Leiste nur, wie lange er klingt.
    const audio: AudioEntry[] = [
      { file: 'sfx-moewe.mp3', type: 'sfx', from: '2026-07-04T08:05:00.000Z' },
    ]
    const ohneMass = klipVon(resolveAudioClips(audio, START, achse))
    expect(ohneMass.filmTo).toBe(ohneMass.filmFrom) // ungemessen: bleibt ein Punkt
    expect(ohneMass.loop).toBe(false) // Vorgabe für Effekte

    const gemessen = klipVon(
      resolveAudioClips(audio, START, achse, new Map([['sfx-moewe.mp3', 3.5]])),
    )
    expect(gemessen.filmTo - gemessen.filmFrom).toBeCloseTo(3.5, 6)
    expect(gemessen.hasExplicitLength).toBe(false) // abgeleitet, nicht entschieden
  })

  it('stapelt Überlappungen in Unterzeilen — der Player mischt sie', () => {
    const audio: AudioEntry[] = [
      {
        file: 'a.mp3',
        type: 'music',
        from: START,
        anchor: START,
        offsetFilmS: 0,
        durationFilmS: 20,
      },
      {
        file: 'b.mp3',
        type: 'music',
        from: START,
        anchor: START,
        offsetFilmS: 10,
        durationFilmS: 20,
      },
      {
        file: 'c.mp3',
        type: 'music',
        from: START,
        anchor: START,
        offsetFilmS: 40,
        durationFilmS: 10,
      },
    ]
    const klips = resolveAudioClips(audio, START, achse)
    expect(klips.map((k) => k.lane)).toEqual([0, 1, 0]) // c passt wieder in Zeile 0
    expect(audioLanes(klips)).toBe(2)
  })
})

describe('anchorClips — Anker in Aufnahmezeit, Feinlage in Filmsekunden', () => {
  it('hält die Filmposition exakt, obwohl der Anker auf Sekunden rundet', () => {
    const achse = achseOhneHalt()
    for (const filmS of [0, 3.7, 12.25, 41.9]) {
      const { anchor, offsetFilmS } = anchorClips(achse, START, filmS)
      const klips = resolveAudioClips(
        [{ file: 'a.mp3', type: 'music', from: anchor, offsetFilmS }],
        START,
        achse,
      )
      // Auf die Millisekunde: der Versatz wird auf drei Stellen gerundet, damit
      // das Overlay lesbar bleibt. Bei jedem denkbaren Maßstab liegt das weit
      // unter einem Pixel.
      expect(klipVon(klips).filmFrom).toBeCloseTo(filmS, 3)
    }
  })

  it('trifft auch eine Stelle MITTEN in einem Halt — das kann Aufnahmezeit nicht', () => {
    // Der Kernbefund aus §1: Im Halt gibt es keine unterscheidbare Aufnahmezeit.
    // Der Versatz trägt die Feinlage, deshalb landet der Klip trotzdem genau dort.
    const achse = achseMitHalt()
    const imHalt = achse.stops![0]!.filmFrom + 3
    const { anchor, offsetFilmS } = anchorClips(achse, START, imHalt)
    expect(offsetFilmS).toBeGreaterThan(0) // ohne ihn fiele die Lage auf die Haltkante
    const klips = resolveAudioClips(
      [{ file: 'a.mp3', type: 'music', from: anchor, offsetFilmS }],
      START,
      achse,
    )
    expect(klipVon(klips).filmFrom).toBeCloseTo(imHalt, 6)
  })
})

describe('trimLeft — Anfang und Datei-Einstieg wandern gemeinsam', () => {
  const achse = achseOhneHalt()
  const klip = (patch: Partial<AudioClip> = {}): AudioClip => ({
    index: 0,
    type: 'music',
    file: 'a.mp3',
    filmFrom: 10,
    filmTo: 30,
    startS: 0,
    loop: true,
    fileS: 60,
    lane: 0,
    legacyAnchored: false,
    hasExplicitLength: true,
    ...patch,
  })

  it('legt frei statt zu verschieben: der Inhalt bleibt an seinem Platz im Film', () => {
    const { patch } = trimLeft(achse, START, klip(), 14)
    expect(patch.startS).toBeCloseTo(4, 3) // 4 s Datei fallen vorne weg
    expect(patch.durationFilmS).toBeCloseTo(16, 3) // rechte Kante bleibt bei 30
  })

  it('hat den DATEIANFANG als Anschlag — und Loop ändert daran nichts', () => {
    // Loop springt am Dateiende auf den Dateianfang. Eine Wiederholung VOR dem
    // Anfang gibt es nicht; wer sie zuließ, ließ das Stück mitten drin einsetzen.
    for (const loop of [true, false]) {
      const a = klip({ startS: 3, loop })
      const { patch, atLimit } = trimLeft(achse, START, a, 0) // weit nach links gezogen
      expect(patch.startS).toBe(0)
      expect(atLimit).toBe(true)
      // Die Kante steht bei filmFrom − einstiegS = 7, nicht bei 0
      expect(patch.durationFilmS).toBeCloseTo(23, 3)
    }
  })

  it('lässt den Klip nicht auf null zusammenschnurren', () => {
    const { patch } = trimLeft(achse, START, klip({ startS: 30 }), 99)
    expect(patch.durationFilmS).toBeCloseTo(AUDIO_MIN_S, 6)
  })
})

describe('trimRight — nur das Ende, Loop hebt den Anschlag auf', () => {
  const achse = achseOhneHalt()
  const klip = (patch: Partial<AudioClip> = {}): AudioClip => ({
    index: 0,
    type: 'sfx',
    file: 'sfx-brandung.mp3',
    filmFrom: 10,
    filmTo: 14,
    startS: 0,
    loop: false,
    fileS: 8,
    lane: 0,
    legacyAnchored: false,
    hasExplicitLength: true,
    ...patch,
  })

  it('stoppt ohne Loop am Material', () => {
    const { patch, atLimit } = trimRight(achse, START, klip(), 40)
    expect(patch.durationFilmS).toBeCloseTo(8, 3) // die ganze Datei, kein Meter mehr
    expect(atLimit).toBe(true)
  })

  it('zieht den Anschlag um den Einstieg mit — getrimmtes Material ist weg', () => {
    const { patch } = trimRight(achse, START, klip({ startS: 3 }), 40)
    expect(patch.durationFilmS).toBeCloseTo(5, 3) // 8 s Datei minus 3 s Einstieg
  })

  it('wächst MIT Loop beliebig weiter', () => {
    const { patch, atLimit } = trimRight(achse, START, klip({ loop: true }), 40)
    expect(patch.durationFilmS).toBeCloseTo(30, 3)
    expect(atLimit).toBe(false)
  })

  it('klemmt nicht, solange die Datei nicht gemessen ist', () => {
    const ohne = klip()
    delete (ohne as { fileS?: number }).fileS
    const { patch, atLimit } = trimRight(achse, START, ohne, 40)
    expect(patch.durationFilmS).toBeCloseTo(30, 3)
    expect(atLimit).toBe(false)
  })

  it('rührt die linke Kante nicht an', () => {
    const a = klip({ startS: 2 })
    const { patch } = trimRight(achse, START, a, 12)
    const klips = resolveAudioClips(
      [{ file: a.file, type: a.type, from: patch.anchor, ...patch }],
      START,
      achse,
      new Map([[a.file, 8]]),
    )
    expect(klipVon(klips).filmFrom).toBeCloseTo(a.filmFrom, 3)
    expect(klipVon(klips).startS).toBeCloseTo(2, 3)
  })
})

describe('moveAudioClip — der Klip hängt danach woanders an der Reise', () => {
  const achse = achseOhneHalt()
  const basis: AudioClip = {
    index: 0,
    type: 'music',
    file: 'a.mp3',
    filmFrom: 10,
    filmTo: 30,
    startS: 4,
    loop: true,
    fileS: 60,
    lane: 0,
    legacyAnchored: false,
    hasExplicitLength: true,
  }

  it('nimmt Länge und Einstieg unverändert mit', () => {
    const patch = moveAudioClip(achse, START, basis, 25)
    expect(patch.durationFilmS).toBeCloseTo(20, 3)
    expect(patch.startS).toBeCloseTo(4, 3)
    const klips = resolveAudioClips(
      [{ file: 'a.mp3', type: 'music', from: patch.anchor, ...patch }],
      START,
      achse,
    )
    expect(klipVon(klips).filmFrom).toBeCloseTo(25, 3)
  })

  it('schreibt KEINE Länge fest, wo sie nur abgeleitet war', () => {
    // „Läuft bis zum Schluss" darf durch bloßes Verschieben nicht zu einer
    // festen Dauer werden — und ein One-Shot nicht zum Bereich.
    const offen = { ...basis, hasExplicitLength: false, filmTo: achse.curve?.totalS ?? 0 }
    expect(moveAudioClip(achse, START, offen, 25).durationFilmS).toBeUndefined()
  })
})

describe('commitAudioClip — die Aufwertung ändert die Lage nicht', () => {
  it('bildet einen Bestands-Eintrag an derselben Filmstelle ab', () => {
    const achse = achseMitHalt()
    const audio: AudioEntry[] = [
      {
        file: 'a.mp3',
        type: 'music',
        from: '2026-07-04T08:05:00.000Z',
        to: '2026-07-04T08:15:00.000Z',
      },
    ]
    const vorher = klipVon(resolveAudioClips(audio, START, achse))
    const patch = commitAudioClip(achse, START, vorher)
    const nachher = klipVon(resolveAudioClips([{ ...audio[0]!, ...patch }], START, achse))
    expect(nachher.filmFrom).toBeCloseTo(vorher.filmFrom, 3)
    expect(nachher.filmTo).toBeCloseTo(vorher.filmTo, 3)
    expect(nachher.legacyAnchored).toBe(false)
  })

  it('ist idempotent — zweimal festschreiben ändert nichts mehr', () => {
    const achse = achseMitHalt()
    const audio: AudioEntry[] = [{ file: 'a.mp3', type: 'music', from: '2026-07-04T08:05:00.000Z' }]
    const eins = commitAudioClip(achse, START, klipVon(resolveAudioClips(audio, START, achse)))
    const zwischen = { ...audio[0]!, ...eins }
    const zwei = commitAudioClip(achse, START, klipVon(resolveAudioClips([zwischen], START, achse)))
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
  const achseMitBreite = (widthS: number): TimelineAxis =>
    buildTimelineAxis(
      [{ mode: 'walk', active: true, pts: track() }],
      [{ offsetS: HALT_S, widthS }],
      {
        fromS: 0,
        toS: 1800,
      },
    )

  /** Ein filmverankerter Klip fester Länge an der Filmstelle `filmS` der Basis-Achse. */
  function verankerterKlip(filmS: number): AudioEntry {
    const { anchor, offsetFilmS } = anchorClips(achseMitBreite(BASIS_BREITE), START, filmS)
    return { file: 'a.mp3', type: 'music', from: anchor, offsetFilmS, durationFilmS: 8 }
  }

  const lageBei = (eintrag: AudioEntry, widthS: number): AudioClip =>
    klipVon(resolveAudioClips([eintrag], START, achseMitBreite(widthS)))

  it('lässt einen Klip VOR der Standzeit exakt stehen', () => {
    const klip = verankerterKlip(10)
    for (const widthS of [BASIS_BREITE + 10, BASIS_BREITE - 10]) {
      expect(lageBei(klip, widthS).filmFrom).toBeCloseTo(10, 3)
    }
  })

  it('rückt einen Klip DAHINTER um genau den Zuwachs mit', () => {
    const klip = verankerterKlip(40)
    expect(lageBei(klip, BASIS_BREITE).filmFrom).toBeCloseTo(40, 3)
    expect(lageBei(klip, BASIS_BREITE + 10).filmFrom).toBeCloseTo(50, 3)
    expect(lageBei(klip, BASIS_BREITE - 10).filmFrom).toBeCloseTo(30, 3)
  })

  it('hält die Feinlage INNERHALB der Standzeit, auch wenn diese wächst', () => {
    // Der Versatz misst ab dem Beginn des Halts — der Klip behält seinen Platz
    // darin, statt an die Kante zu rutschen oder mit der Breite zu skalieren.
    const klip = verankerterKlip(23) // 3 Filmsekunden nach Haltbeginn (Filmsekunde 20)
    for (const widthS of [BASIS_BREITE + 10, BASIS_BREITE - 10]) {
      expect(lageBei(klip, widthS).filmFrom).toBeCloseTo(23, 3)
    }
  })

  it('lässt die LÄNGE unangetastet — sie steht in Filmsekunden', () => {
    for (const filmS of [10, 23, 40]) {
      const klip = verankerterKlip(filmS)
      for (const widthS of [BASIS_BREITE, BASIS_BREITE + 10, BASIS_BREITE - 10]) {
        const k = lageBei(klip, widthS)
        expect(k.filmTo - k.filmFrom).toBeCloseTo(8, 3)
      }
    }
  })

  it('zum Vergleich: ein alt verankerter Klip DEHNT sich über der Standzeit', () => {
    // Genau das ist der Unterschied: `ab`/`bis` sind zwei Aufnahmezeiten, und die
    // Standzeit dazwischen zählt in beide hinein. Der Klip wird länger, statt
    // mitzurücken — ein Musikstück, das plötzlich 10 Filmsekunden mehr füllen soll.
    const alt: AudioEntry = {
      file: 'a.mp3',
      type: 'music',
      from: '2026-07-04T08:05:00.000Z', // Aufnahmesekunde 300, vor dem Halt
      to: '2026-07-04T08:20:00.000Z', // Aufnahmesekunde 1200, dahinter
    }
    const basis = lageBei(alt, BASIS_BREITE)
    const breiter = lageBei(alt, BASIS_BREITE + 10)
    expect(basis.legacyAnchored).toBe(true)
    expect(breiter.filmFrom).toBeCloseTo(basis.filmFrom, 3) // der Anfang bleibt
    expect(breiter.filmTo - breiter.filmFrom).toBeCloseTo(basis.filmTo - basis.filmFrom + 10, 3)
  })
})

describe('waveformPosition — die Wellenform gehört zur DATEI, nicht zum Klip', () => {
  const basis: AudioClip = {
    index: 0,
    type: 'music',
    file: 'a.mp3',
    filmFrom: 10,
    filmTo: 30,
    startS: 4,
    loop: false,
    fileS: 60,
    lane: 0,
    legacyAnchored: false,
    hasExplicitLength: true,
  }

  it('misst in DATEI-Breite und schiebt um den Einstieg — man sieht, was wegfällt', () => {
    // Auf Klipbreite gestaucht sähe jeder Trim wie ein Tempowechsel aus.
    const lage = waveformPosition(basis, 120)
    expect(lage?.widthFraction).toBeCloseTo(0.5, 6) // 60 s Datei von 120 s Film
    expect(lage?.offsetFraction).toBeCloseTo(-4 / 120, 6) // um den Einstieg nach links
    expect(lage?.repeats).toBe(1)
  })

  // Der Bug, der das ausgelöst hat: Gerechnet wurde in Pixeln des aktuellen
  // Maßstabs, aber Zoomen baut die Bahnen nicht neu — es schreibt nur
  // `--zeit-breite` fort. Die Wellenform blieb dadurch auf ihrer alten Größe
  // stehen und endete weit vor dem Klip. Als ANTEIL ist sie vom Maßstab
  // unabhängig, und genau das hält dieser Test fest.
  it('hängt nur an der Filmdauer, nicht am Zoom', () => {
    const lage = waveformPosition(basis, 120)
    // Dieselbe Tour, zehnfach hineingezoomt: `totalFilmS` ändert sich dabei
    // nicht — der Anteil also auch nicht.
    expect(waveformPosition(basis, 120)).toEqual(lage)
    // Und ein anderer Film gibt einen anderen Anteil: 60 s Datei füllen einen
    // 60-s-Film ganz.
    expect(waveformPosition(basis, 60)?.widthFraction).toBeCloseTo(1, 6)
  })

  it('wiederholt nur bei Loop', () => {
    expect(waveformPosition({ ...basis, fileS: 8, loop: false }, 120)?.repeats).toBe(1)
    // 4 s Einstieg + 20 s Klip = 24 s über eine 8-s-Datei → drei Durchläufe
    expect(waveformPosition({ ...basis, fileS: 8, loop: true }, 120)?.repeats).toBe(3)
  })

  it('bleibt weg, solange die Datei nicht gemessen ist', () => {
    const ohne = { ...basis }
    delete (ohne as { fileS?: number }).fileS
    expect(waveformPosition(ohne, 120)).toBeNull()
  })

  // Ohne Kurve (degenerierte Tour) fällt `--zeit-breite` auf die Fensterbreite
  // zurück — dann stimmt der Bezug nicht mehr und es gibt nichts zu zeichnen.
  it('bleibt weg, solange es keine Filmdauer gibt', () => {
    expect(waveformPosition(basis, 0)).toBeNull()
  })
})

describe('setLoop — Loop aus holt den Klip ans Material zurück', () => {
  const achse = achseOhneHalt()
  const basis: AudioClip = {
    index: 0,
    type: 'music',
    file: 'a.mp3',
    filmFrom: 10,
    // Unter Loop weit über das Dateiende hinaus gewachsen
    filmTo: 45,
    startS: 0,
    loop: true,
    fileS: 22,
    lane: 0,
    legacyAnchored: false,
    hasExplicitLength: true,
  }

  it('schneidet den stummen Rest weg, statt ihn stehen zu lassen', () => {
    // Ohne das hinge hinter der Wellenform Stille im Klip — und Stille gehört
    // ZWISCHEN die Klips, nie in einen. Man müsste ihn von Hand zurechtziehen,
    // um überhaupt zu sehen, wo sein Material endet.
    expect(setLoop(achse, START, basis, false).durationFilmS).toBeCloseTo(22, 3)
  })

  it('zieht den Einstieg mit ab — getrimmtes Material ist weg', () => {
    expect(setLoop(achse, START, { ...basis, startS: 6 }, false).durationFilmS).toBeCloseTo(16, 3)
  })

  it('lässt einen Klip in Ordnung unangetastet', () => {
    const kurz = { ...basis, filmTo: 18 } // 8 s, passt in die 22-s-Datei
    expect(setLoop(achse, START, kurz, false).durationFilmS).toBeCloseTo(8, 3)
  })

  it('Loop AN nimmt nur den Anschlag weg — die Länge bleibt', () => {
    expect(setLoop(achse, START, basis, true).durationFilmS).toBeCloseTo(35, 3)
  })

  it('friert ohne gemessene Datei nichts ein', () => {
    // Ohne Anschlag gäbe es nichts zurückzuholen; eine Länge festzuschreiben
    // wäre eine Aussage, die niemand getroffen hat.
    const ohne = { ...basis, hasExplicitLength: false }
    delete (ohne as { fileS?: number }).fileS
    expect(setLoop(achse, START, ohne, false).durationFilmS).toBeUndefined()
  })
})

describe('loopAfterRoleChange — die Rolle darf das Verhalten nicht still kippen', () => {
  const k = (type: 'music' | 'sfx', loop: boolean): AudioClip => ({
    index: 0,
    type,
    file: 'a.mp3',
    filmFrom: 0,
    filmTo: 10,
    startS: 0,
    loop,
    lane: 0,
    legacyAnchored: false,
    hasExplicitLength: true,
  })

  it('schreibt das bisherige Verhalten fest, wo die neue Vorgabe es umdrehen würde', () => {
    // Eine durchlaufende Atmosphäre („Filmmusik", loop an) wird zu „Ton der
    // Szene" — dort ist die Vorgabe AUS. Ohne diesen Wert würde sie still zum
    // einmaligen Knall.
    expect(loopAfterRoleChange(k('music', true), 'sfx')).toBe(true)
    expect(loopAfterRoleChange(k('sfx', false), 'music')).toBe(false)
  })

  it('lässt das Feld weg, wo die neue Vorgabe ohnehin passt', () => {
    expect(loopAfterRoleChange(k('sfx', true), 'music')).toBeUndefined()
    expect(loopAfterRoleChange(k('music', false), 'sfx')).toBeUndefined()
  })
})
