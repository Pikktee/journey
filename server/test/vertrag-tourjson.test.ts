// VERTRAGSTEST: Bestands-Overlays rendern unverändert.
//
// Etappe 4 des Zeitleisten-Umbaus (docs/architecture/zeitleiste-umbau.md §3) erweitert
// `maptale/edits@1` additiv um Ton-Anker (anker/versatzFilmS/dauerFilmS/einstiegS/
// loop) und Video-Trim. Additiv heißt: ein Overlay OHNE die neuen Felder muss
// exakt dasselbe Tour-JSON ergeben wie heute — kein Bestandsfilm darf sich beim
// nächsten Rendern still verändern.
//
// Dieser Test hält das fest, indem er das gerenderte tour.json mehrerer echter
// Overlay-Formen als Schnappschuss festschreibt. Er ist bewusst GROB: er prüft
// nicht eine Regel, sondern das gesamte Ergebnis. Schlägt er nach einer Änderung
// aus, ist das die Frage „war diese Verschiebung beabsichtigt?" — und bei einer
// rein additiven Schema-Erweiterung lautet die Antwort nein.
//
// Alles hier ist deterministisch: reichereAn ist eine reine Funktion, Geocoder
// und Wetterquelle sind fest, die Pipeline zieht weder Uhr noch Zufall.

import { describe, expect, it } from 'vitest'
import { reichereAn } from '../src/pipeline/enrich.js'
import { FesterGeocoder } from '../src/pipeline/naming.js'
import { klemmeSchnitt, schnittVideoDateiname, type VideoMeta } from '../src/pipeline/video.js'
import type { FotoMeta } from '../src/pipeline/bild.js'
import { FesteWetterQuelle, testRaster } from '../src/pipeline/weather.js'
import type { EditOverlay } from '../src/schema/edits.js'
import type { UploadManifest } from '../src/schema/upload.js'

/**
 * Aufzeichnung im Berner Oberland: zwei Fortbewegungs-Abschnitte, eine echte
 * Pause (drei Punkte auf der Stelle), drei Aufnahmen (Foto · Video · Foto).
 * Reicher als `beispielManifest()` aus helfer.ts — der Vertrag soll auch
 * Video-Dauer, Foto-Fassungen und die Pausen-Raffung mit einschließen.
 */
function vertragManifest(): UploadManifest {
  return {
    schema: 'maptale/upload@1',
    clientTourId: 'vertrag-tour-1',
    title: null,
    description: null,
    time: { start: '2026-07-04T08:12:31+02:00', end: '2026-07-04T14:03:10+02:00', zone: 'Europe/Zurich' },
    segments: [
      {
        mode: 'walk',
        pts: [
          [7.9086, 46.5934, 800, 0],
          [7.9105, 46.59, 830, 620],
          // Pause: drei Punkte praktisch am selben Ort über 20 Minuten
          [7.9121, 46.5885, 860, 1100],
          [7.9121, 46.5885, 861, 1700],
          [7.9122, 46.5886, 860, 2300],
          [7.9142, 46.5872, 905, 2900],
        ],
      },
      {
        mode: 'bike',
        pts: [
          [7.9142, 46.5872, 905, 2900],
          [7.9184, 46.5891, 1005, 3600],
          [7.9605, 46.6042, 1120, 9000],
          [8.0341, 46.6244, 1034, 21000],
        ],
      },
    ],
    media: [
      {
        id: 'm1',
        type: 'photo',
        file: 'IMG_0012.JPG',
        takenAt: '2026-07-04T08:22:51+02:00',
        anchor: [7.9105, 46.59],
        caption: null,
      },
      {
        id: 'm2',
        type: 'video',
        file: 'VID_0033.mp4',
        takenAt: '2026-07-04T09:12:31+02:00',
        anchor: [7.9184, 46.5891],
        caption: null,
      },
      {
        id: 'm3',
        type: 'photo',
        file: 'IMG_0044.JPG',
        takenAt: '2026-07-04T10:42:31+02:00',
        anchor: [7.9605, 46.6042],
        caption: null,
      },
    ],
  }
}

const VIDEO_QUELL_S = 34.2

/**
 * Video-Metadaten, wie sie die Route liefern würde.
 *
 * Der Schnitt (Etappe 4) wirkt NICHT in `reichereAn`, sondern in
 * `bereiteVideosAuf` — es ist die Aufbereitung, die eine geschnittene Datei
 * erzeugt und die Länge kürzt. Damit der Vertrag den sichtbaren Effekt trotzdem
 * abdeckt, spiegelt der Harnisch hier, was tours.ts tut: klemmen, benennen,
 * Länge setzen.
 */
function videoMetaFuer(edits: EditOverlay | null): Map<string, VideoMeta> {
  const schnitt = klemmeSchnitt(edits?.medien?.['m2']?.trim, VIDEO_QUELL_S)
  return new Map<string, VideoMeta>([
    [
      'm2',
      schnitt
        ? {
            dauerS: (schnitt.bisS ?? VIDEO_QUELL_S) - schnitt.vonS,
            videoDatei: schnittVideoDateiname('m2'),
            posterDatei: 'm2.poster.jpg',
            quellDauerS: VIDEO_QUELL_S,
          }
        : {
            dauerS: VIDEO_QUELL_S,
            videoDatei: 'm2.web.mp4',
            posterDatei: 'm2.poster.jpg',
            quellDauerS: VIDEO_QUELL_S,
          },
    ],
  ])
}
const fotoMeta = new Map<string, FotoMeta>([
  ['m1', { anzeigeDatei: 'm1.w1920.jpg', thumbDatei: 'm1.t480.jpg' }],
  ['m3', { anzeigeDatei: 'm3.w1920.jpg', thumbDatei: 'm3.t480.jpg' }],
])

// Bedeckt mit einem nassen Fenster am Vormittag (UTC 06:00 … 13:00) — genug,
// damit das Auto-Wetter überhaupt Keyframes erzeugt und die Stufen sichtbar sind.
const wetterQuelle = () =>
  new FesteWetterQuelle(
    testRaster('2026-07-04T06', [
      { wolken: 20 },
      { wolken: 60 },
      { code: 61, regenMm: 1.2, wolken: 95 },
      { code: 61, regenMm: 0.8, wolken: 90 },
      { wolken: 70 },
      { wolken: 40 },
      { wolken: 15 },
      { wolken: 10 },
    ]),
  )

async function rendere(edits: EditOverlay | null) {
  return reichereAn({
    tourId: 't_vertrag01',
    nummer: 42,
    manifest: vertragManifest(),
    titelOverride: null,
    beschreibungOverride: null,
    edits,
    geocoder: new FesterGeocoder(['Lauterbrunnen', 'Grindelwald']),
    wetter: wetterQuelle(),
    videoMeta: videoMetaFuer(edits),
    fotoMeta,
    audioDateien: ['eigene-spur.mp3'],
    benutzerAudioDateien: ['mein-stueck.mp3'],
  })
}

/**
 * Die Overlay-Formen, die im Bestand tatsächlich vorkommen — je eine für sich
 * (damit ein Ausschlag zeigt, WELCHER Teil sich bewegt hat) und einmal alles
 * zusammen, wie eine im Studio durchgearbeitete Tour aussieht.
 */
const FAELLE: Array<[name: string, edits: EditOverlay | null]> = [
  ['ohne Overlay', null],
  ['leeres Overlay', { schema: 'maptale/edits@1' }],
  [
    'Medien-Edits',
    {
      schema: 'maptale/edits@1',
      medien: {
        m1: { caption: 'Blick über das Tal', display: { holdS: 8, kenBurns: true }, reihe: 1 },
        m2: { anchor: [7.92, 46.5895] },
        m3: { geloescht: true },
      },
      titelbild: 'm1',
    },
  ],
  [
    'Modus-Grenzen',
    {
      schema: 'maptale/edits@1',
      modi: [
        { ab: '2026-07-04T08:12:31+02:00', mode: 'walk' },
        { ab: '2026-07-04T09:12:31+02:00', mode: 'moped' },
        { ab: '2026-07-04T11:30:00+02:00', mode: 'ferry' },
      ],
    },
  ],
  [
    'Kamera und Momente',
    {
      schema: 'maptale/edits@1',
      kamera: [
        { ab: '2026-07-04T08:12:31+02:00', preset: 'mittel' },
        { ab: '2026-07-04T09:30:00+02:00', preset: 'weit', skala: 1.4 },
      ],
      momente: [
        { ab: '2026-07-04T08:22:51+02:00', art: 'umkreisen' },
        { ab: '2026-07-04T10:42:31+02:00', art: 'innehalten', dauerS: 6 },
      ],
    },
  ],
  [
    'Audio (alle drei Quellen)',
    {
      schema: 'maptale/edits@1',
      audio: [
        // tour-lokal hochgeladen, begrenzter Bereich, eigene Lautstärke
        {
          datei: 'eigene-spur.mp3',
          typ: 'musik',
          ab: '2026-07-04T08:12:31+02:00',
          bis: '2026-07-04T09:30:00+02:00',
          lautstaerke: 0.6,
        },
        // benutzerweite Bibliothek, offenes Ende
        { datei: 'mein-stueck.mp3', typ: 'musik', ab: '2026-07-04T09:30:00+02:00', quelle: 'benutzer' },
        // kuratierter Effekt, One-Shot
        { datei: 'sfx-moewen.mp3', typ: 'sfx', ab: '2026-07-04T10:42:31+02:00', quelle: 'bibliothek' },
      ],
    },
  ],
  [
    'Wetter-Override',
    {
      schema: 'maptale/edits@1',
      wetter: [
        { ab: '2026-07-04T08:12:31+02:00', mode: 'fog', staerke: 0.4 },
        { ab: '2026-07-04T10:00:00+02:00', mode: 'storm' },
        { ab: '2026-07-04T12:00:00+02:00', mode: 'off' },
      ],
    },
  ],
  [
    'Trim (Altbestand, nicht mehr bedienbar)',
    {
      schema: 'maptale/edits@1',
      trim: { start: '2026-07-04T08:30:00+02:00', ende: '2026-07-04T13:00:00+02:00' },
      audio: [{ datei: 'eigene-spur.mp3', typ: 'musik', ab: '2026-07-04T08:12:31+02:00' }],
    },
  ],
  // Ab hier die Formen, die Etappe 4 hinzufügt. Sie stehen mit im Vertrag,
  // damit auch die NEUEN Felder ab jetzt einen Schnappschuss haben — die
  // Aussage „additiv" gilt in beide Richtungen: Altes bleibt, Neues bewegt sich
  // nicht mehr unbemerkt.
  [
    'Ton am Film-Anker (Etappe 4)',
    {
      schema: 'maptale/edits@1',
      audio: [
        {
          datei: 'eigene-spur.mp3',
          typ: 'musik',
          ab: '2026-07-04T08:12:31+02:00',
          anker: '2026-07-04T08:12:31+02:00',
          versatzFilmS: 2.5,
          dauerFilmS: 40,
          einstiegS: 8,
          loop: false,
        },
        // Effekt MIT Länge — als Marke ohne Ausdehnung verschwieg die Leiste,
        // wie lange er klingt
        {
          datei: 'sfx-brandung.mp3',
          typ: 'sfx',
          ab: '2026-07-04T10:00:00+02:00',
          anker: '2026-07-04T10:00:00+02:00',
          dauerFilmS: 12,
          loop: true,
          quelle: 'bibliothek',
        },
      ],
    },
  ],
  [
    'Ton am Film-Anker HINTER einem Moment',
    {
      schema: 'maptale/edits@1',
      // Der Fall, in dem sich der Moment-Halt der Film-Achse überhaupt zeigt:
      // ein Versatz, der über den Moment hinwegreicht. Ohne ihn läge der Klip
      // an einer anderen Streckenstelle, als der Editor zeigt.
      momente: [{ ab: '2026-07-04T08:22:51+02:00', art: 'umkreisen' }],
      audio: [
        {
          datei: 'eigene-spur.mp3',
          typ: 'musik',
          ab: '2026-07-04T08:12:31+02:00',
          anker: '2026-07-04T08:12:31+02:00',
          versatzFilmS: 30,
          dauerFilmS: 25,
        },
      ],
    },
  ],
  [
    'Video-Schnitt (Etappe 4)',
    {
      schema: 'maptale/edits@1',
      medien: { m2: { trim: { vonS: 6, bisS: 20 } } },
    },
  ],
  [
    'durchgearbeitete Tour (alles zusammen)',
    {
      schema: 'maptale/edits@1',
      medien: {
        m1: { caption: 'Blick über das Tal', display: { holdS: 9 } },
        m2: { caption: 'Abfahrt' },
        m3: { anchor: [7.96, 46.604], reihe: 0 },
      },
      titelbild: 'm3',
      modi: [
        { ab: '2026-07-04T08:12:31+02:00', mode: 'walk' },
        { ab: '2026-07-04T09:12:31+02:00', mode: 'jeep' },
      ],
      kamera: [{ ab: '2026-07-04T08:40:00+02:00', preset: 'nah', skala: 0.8 }],
      momente: [{ ab: '2026-07-04T09:12:31+02:00', art: 'aufstieg', dauerS: 4 }],
      audio: [
        { datei: 'mein-stueck.mp3', typ: 'musik', ab: '2026-07-04T08:12:31+02:00', quelle: 'benutzer' },
        { datei: 'sfx-wind.mp3', typ: 'sfx', ab: '2026-07-04T09:12:31+02:00', quelle: 'bibliothek' },
      ],
      wetter: [{ ab: '2026-07-04T08:12:31+02:00', mode: 'clouds' }],
    },
  ],
]

describe('Vertrag: gerendertes Tour-JSON je Overlay-Form', () => {
  for (const [name, edits] of FAELLE) {
    it(`bleibt unverändert — ${name}`, async () => {
      const tour = await rendere(edits)
      expect(tour).toMatchSnapshot()
    })
  }

  // Der Schnappschuss allein sagt nicht, dass die Fälle sich überhaupt
  // unterscheiden — ohne diese Probe könnten acht identische Ergebnisse
  // „grün" sein und der Vertrag bewachte nichts.
  it('die Fälle unterscheiden sich tatsächlich voneinander', async () => {
    const fassungen = await Promise.all(FAELLE.map(([, edits]) => rendere(edits)))
    const serialisiert = fassungen.map((t) => JSON.stringify(t))
    // „ohne Overlay" und „leeres Overlay" MÜSSEN gleich sein (das ist die Zusage);
    // alle übrigen Fälle sind paarweise verschieden.
    expect(serialisiert[0]).toBe(serialisiert[1])
    const uebrige = serialisiert.slice(1)
    expect(new Set(uebrige).size).toBe(uebrige.length)
  })
})
