// ERZEUGT — nicht von Hand ändern.
//
// Quelle: docs/specs/abbildungstabelle.tsv (Zeilen mit welle=1 und den Arten
// json-feld, json-wert, schema-kennung). Neu erzeugen mit
// `node scripts/keys-v2-generieren.mjs`.
//
// Die Start-Migration (§4.3 des Englisch-Konzepts) bildet damit die Schlüssel
// der drei Dateien auf Platte ab — `tour.json` steht bewusst NICHT dabei: die
// wird nicht umgeschrieben, sondern neu gerendert.

/** Alte Schema-Kennung → neue (beide Präfixe, s. §4.3). */
export const SCHEMA_KENNUNGEN: Readonly<Record<string, string>> = {
  'luhambo/anreicherung@1': 'maptale/enrichment@2',
  'luhambo/edits@1': 'maptale/edits@2',
  'luhambo/tour@1': 'maptale/tour@2',
  'luhambo/upload@1': 'maptale/upload@2',
  'maptale/anreicherung@1': 'maptale/enrichment@2',
  'maptale/edits@1': 'maptale/edits@2',
  'maptale/tour@1': 'maptale/tour@2',
  'maptale/upload@1': 'maptale/upload@2',
} as const

/** Feldnamen je Datei: alt → neu. */
export const FELDER = {
  manifest: {
    entfernt: 'removed',
    modiAutomatisch: 'travelModesAuto',
    quelle: 'source',
  },
  edits: {
    ab: 'from',
    anker: 'anchor',
    art: 'kind',
    bis: 'to',
    bisS: 'toS',
    datei: 'file',
    dauerFilmS: 'durationFilmS',
    dauerS: 'durationS',
    einstiegS: 'startS',
    ende: 'end',
    geloescht: 'removed',
    kamera: 'camera',
    lautstaerke: 'volume',
    medien: 'media',
    modi: 'travelModes',
    momente: 'moments',
    quelle: 'source',
    reihe: 'order',
    skala: 'scale',
    staerke: 'intensity',
    titelbild: 'cover',
    typ: 'type',
    versatzFilmS: 'offsetFilmS',
    vonS: 'fromS',
    wetter: 'weather',
  },
  enrichment: {
    befunde: 'findings',
    dauerS: 'durationS',
    orte: 'places',
    trimSignatur: 'trimSignature',
    videoSchnittSignatur: 'videoCutSignature',
    wetterRoh: 'weatherRaw',
  },
} as const

/**
 * Werte je Datei und FELD: alt → neu.
 *
 * Feldweise und nicht global, weil derselbe Wortlaut in zwei Feldern
 * Verschiedenes heißt — `mode: 'rain'` bleibt, `typ: 'musik'` wird `music`.
 * Geprüft wird gegen den NEUEN Feldnamen, denn die Felder wandern zuerst.
 */
export const WERTE = {
  manifest: {},
  edits: {
    kind: {
      aufstieg: 'ascend',
      innehalten: 'linger',
      umkreisen: 'orbit',
    },
    preset: {
      mittel: 'mid',
      nah: 'near',
      standard: 'default',
      weit: 'far',
    },
    source: {
      benutzer: 'user',
      bibliothek: 'library',
    },
    type: {
      musik: 'music',
    },
  },
  enrichment: {},
} as const
