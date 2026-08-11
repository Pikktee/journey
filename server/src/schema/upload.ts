// Austauschformat `maptale/upload@1` (auch `luhambo/upload@1` kompatibel): das Manifest, das App/Studio/CLI hochladen.
// TypeScript-Typen + JSON-Schema (Fastify validiert Requests damit).
// Dokumentation: docs/austauschformat.md im Repo-Root.

export const UPLOAD_SCHEMA_ID = 'maptale/upload@1'

/**
 * Fortbewegungs-Modi — muss deckungsgleich mit der Player-Engine bleiben
 * (MODE_SPEED/MODE_SCALE in src/tour.ts, MODE_ICONS in src/map.ts,
 * MODE_SOUND in src/vehicle.ts). Eine Quelle für Typ UND JSON-Schema-Enums,
 * damit die drei Stellen nicht wieder auseinanderlaufen.
 */
export const MODI = ['walk', 'moped', 'bike', 'jeep', 'tram', 'ferry'] as const

export type Modus = (typeof MODI)[number]

/** Trackpunkt: [lng, lat, ele(m), tOffset(s ab time.start)] */
export type UploadPunkt = [number, number, number, number]

export interface UploadSegment {
  mode: Modus
  label?: string
  pts: UploadPunkt[]
}

export interface UploadMedium {
  /** Client-vergebene, tour-eindeutige ID (wird Teil der Medien-URL) */
  id: string
  type: 'photo' | 'video'
  /** Original-Dateiname (nur für die Dateiendung relevant) */
  file: string
  /** Aufnahmezeitpunkt, ISO 8601 */
  takenAt: string
  /** GPS-Anker [lng, lat]; fehlt er, greift später die Zeit-Platzierung (M6) */
  anchor?: [number, number]
  caption?: string | null
  durationS?: number
  /**
   * Woher das Medium beim Client stammt — die Idempotenz-Schlüssel des
   * Nachreichens (z. B. `galerie:1234` für eine MediaStore-Kennung).
   *
   * **Der Dedup-Riegel des Foto-Nachzugs, und er liegt im MANIFEST.** Die App
   * kann nicht zuverlässig wissen, was eine Tour schon hat: Sie sieht das
   * gerenderte `tour.json`, und das kennt nachgereichte Bilder erst nach dem
   * Rendern. Scheitert das (409 während einer laufenden Verarbeitung, Netz
   * weg), schlüge der nächste Lauf dieselben Fotos erneut vor und lüde sie ein
   * zweites Mal hoch — sichtbar würde es erst danach, mit jedem Bild doppelt
   * in der Tour. Das Manifest dagegen kennt den Eintrag SOFORT.
   *
   * Optional: Das Studio-Nachreichen setzt ihn nicht (dort wählt ein Mensch
   * Dateien aus, und zwei Aufnahmen desselben Augenblicks sind dann Absicht).
   */
  quelle?: string
  /**
   * Tombstone: Medium wurde ENDGÜLTIG gelöscht (Dateien weg, Speicher frei).
   *
   * Der Eintrag bleibt stehen, weil das Manifest das Protokoll dessen ist, was
   * hochgeladen wurde — und weil nur so keine Medien-ID je wiederverwendet
   * wird. Setzt ausschließlich der SERVER (DELETE-Route); im Upload-Schema
   * fehlt das Feld absichtlich, ein Client kann es nicht mitschicken.
   * Pipeline, Editor und finalize überspringen Tombstones.
   */
  entfernt?: boolean
}

/** Ein nachzureichendes Medium: wie UploadMedium, aber die ID vergibt der SERVER. */
export type NachreichMedium = Omit<UploadMedium, 'id' | 'entfernt'>

export interface UploadManifest {
  schema: typeof UPLOAD_SCHEMA_ID
  /** ID der App-lokalen Tour (für idempotente Wiederholung des Anlegens) */
  clientTourId?: string
  title?: string | null
  description?: string | null
  time: { start: string; end: string; zone: string }
  /** Segmente ODER trackFile (genau eines) — bei trackFile parst der Server das GPX */
  segments?: UploadSegment[]
  /** Referenz auf ein per PUT hochzuladendes GPX (statt segments), M6 */
  trackFile?: string
  /** Gewünschter Modus fürs GPX-Segment; fehlt er, rät der Server aus dem Tempo */
  trackMode?: Modus
  /**
   * Wurde die Aufteilung von der App ERKANNT statt vom Nutzer angegeben?
   *
   * Nur dann darf der Server sie verfeinern (etwa ein Fahrzeug an seiner Trasse
   * als Straßenbahn). Ohne das Feld sähe er nur Modi und könnte eine Angabe
   * nicht von einer Vorgabe unterscheiden — „walk" heißt in der App zugleich
   * „zu Fuß" und „Automatisch".
   */
  modiAutomatisch?: boolean
  media: UploadMedium[]
}

// ISO-8601-Zeitstempel (die Semantik prüft Date.parse in der Pipeline).
// Bewusst KEIN `format: 'date-time'` — Fastifys Ajv bringt ohne ajv-formats
// keine Format-Prüfer mit und würde beim Registrieren scheitern.
// VOLL verankert (^…$): ein unverankertes Präfix-Pattern ließe beliebige
// Anhängsel durch — Zeitstempel landen in Editor/Doku, HTML hat dort nichts
// verloren (Review-Fund M7). Erlaubt: Sekundenbruchteile, `Z` oder `±HH:MM`.
export const ISO_ZEIT_PATTERN = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?(Z|[+-]\\d{2}:\\d{2})?$'
export const ISO_ZEIT_MAXLAENGE = 40

// Eigenschaften eines Medien-Eintrags OHNE die ID — geteilt zwischen dem
// Manifest (Client vergibt die ID) und dem Nachreichen (Server vergibt sie).
// Eine Konstante, damit die beiden Schemata nicht auseinanderlaufen.
const medienEigenschaften = {
  type: { enum: ['photo', 'video'] },
  file: { type: 'string', minLength: 1, maxLength: 255 },
  takenAt: { type: 'string', pattern: ISO_ZEIT_PATTERN, maxLength: ISO_ZEIT_MAXLAENGE },
  anchor: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'number' } },
  caption: { type: ['string', 'null'], maxLength: 1000 },
  durationS: { type: 'number', minimum: 0 },
  quelle: { type: 'string', minLength: 1, maxLength: 200 },
} as const

// JSON-Schema für die Fastify-Validierung. Bewusst strikt (additionalProperties
// false) — Tippfehler im Client fallen sofort auf statt still zu verschwinden.
export const uploadManifestJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['schema', 'time', 'media'],
  // Genau EINE Track-Quelle: entweder eingebettete Segmente oder ein GPX-Verweis.
  oneOf: [{ required: ['segments'] }, { required: ['trackFile'] }],
  properties: {
    schema: { const: UPLOAD_SCHEMA_ID },
    clientTourId: { type: 'string', maxLength: 100 },
    title: { type: ['string', 'null'], maxLength: 200 },
    description: { type: ['string', 'null'], maxLength: 5000 },
    trackFile: { type: 'string', minLength: 1, maxLength: 255 },
    trackMode: { enum: [...MODI] },
    modiAutomatisch: { type: 'boolean' },
    time: {
      type: 'object',
      additionalProperties: false,
      required: ['start', 'end', 'zone'],
      properties: {
        start: { type: 'string', pattern: ISO_ZEIT_PATTERN, maxLength: ISO_ZEIT_MAXLAENGE },
        end: { type: 'string', pattern: ISO_ZEIT_PATTERN, maxLength: ISO_ZEIT_MAXLAENGE },
        zone: { type: 'string', maxLength: 60 },
      },
    },
    segments: {
      type: 'array',
      minItems: 1,
      maxItems: 200,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['mode', 'pts'],
        properties: {
          mode: { enum: [...MODI] },
          label: { type: 'string', maxLength: 60 },
          pts: {
            type: 'array',
            minItems: 2,
            maxItems: 200000,
            items: {
              type: 'array',
              minItems: 4,
              maxItems: 4,
              items: { type: 'number' },
            },
          },
        },
      },
    },
    media: {
      type: 'array',
      maxItems: 500,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'type', 'file', 'takenAt'],
        properties: {
          id: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,64}$' },
          ...medienEigenschaften,
        },
      },
    },
  },
} as const

/** Obergrenze der Medien je Tour — gilt fürs Manifest UND übers Nachreichen hinweg. */
export const MAX_MEDIEN_PRO_TOUR = 500

// Body von `POST /api/tours/:id/medien` (additives Nachreichen): dieselben
// Einträge wie im Manifest, nur ohne ID — die vergibt der Server und gibt sie
// in der Antwort zurück. `entfernt` ist hier wie im Manifest-Schema bewusst
// nicht zugelassen: Tombstones schreibt nur die DELETE-Route.
export const nachreichenJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['medien'],
  properties: {
    medien: {
      type: 'array',
      minItems: 1,
      maxItems: MAX_MEDIEN_PRO_TOUR,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'file', 'takenAt'],
        properties: medienEigenschaften,
      },
    },
  },
} as const

/** Erlaubte Datei-Endungen je Medientyp (bestimmt die abgelegte Datei) */
const ENDUNGEN: Record<UploadMedium['type'], string[]> = {
  // heic/heif: Voreinstellung vieler Kameras (iPhone, viele Androids). Die
  // Pipeline löst sie beim Aufbereiten auf (s. `istKachelbild` in bild.ts) —
  // ausgeliefert wird ohnehin nie das Hochgeladene, sondern die Ableitung.
  photo: ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'],
  video: ['mp4', 'mov', 'webm'],
}

/** Ablage-Dateiname eines Mediums: aus ID + geprüfter Endung (nie Client-Pfade). */
export function mediumDateiname(medium: UploadMedium): string {
  const roh = medium.file.toLowerCase().split('.').pop() ?? ''
  const endung = roh === 'jpeg' ? 'jpg' : roh
  const erlaubt = ENDUNGEN[medium.type]
  if (!erlaubt.includes(endung)) {
    throw new Error(`Unzulässige Dateiendung „${roh}" für ${medium.type}: ${medium.file}`)
  }
  return `${medium.id}.${endung}`
}
