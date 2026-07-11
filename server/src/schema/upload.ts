// Austauschformat `luhambo/upload@1`: das Manifest, das App/Studio/CLI hochladen.
// TypeScript-Typen + JSON-Schema (Fastify validiert Requests damit).
// Dokumentation: docs/austauschformat.md im Repo-Root.

export const UPLOAD_SCHEMA_ID = 'luhambo/upload@1'

export type Modus = 'walk' | 'bike' | 'tram' | 'ferry'

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
}

export interface UploadManifest {
  schema: typeof UPLOAD_SCHEMA_ID
  /** ID der App-lokalen Tour (für idempotente Wiederholung des Anlegens) */
  clientTourId?: string
  title?: string | null
  description?: string | null
  time: { start: string; end: string; zone: string }
  segments: UploadSegment[]
  media: UploadMedium[]
}

// ISO-8601-Zeitstempel (grobe Struktur; die Semantik prüft Date.parse in der
// Pipeline). Bewusst KEIN `format: 'date-time'` — Fastifys Ajv bringt ohne
// ajv-formats keine Format-Prüfer mit und würde beim Registrieren scheitern.
const ISO_ZEIT_PATTERN = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}'

// JSON-Schema für die Fastify-Validierung. Bewusst strikt (additionalProperties
// false) — Tippfehler im Client fallen sofort auf statt still zu verschwinden.
export const uploadManifestJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['schema', 'time', 'segments', 'media'],
  properties: {
    schema: { const: UPLOAD_SCHEMA_ID },
    clientTourId: { type: 'string', maxLength: 100 },
    title: { type: ['string', 'null'], maxLength: 200 },
    description: { type: ['string', 'null'], maxLength: 5000 },
    time: {
      type: 'object',
      additionalProperties: false,
      required: ['start', 'end', 'zone'],
      properties: {
        start: { type: 'string', pattern: ISO_ZEIT_PATTERN },
        end: { type: 'string', pattern: ISO_ZEIT_PATTERN },
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
          mode: { enum: ['walk', 'bike', 'tram', 'ferry'] },
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
          type: { enum: ['photo', 'video'] },
          file: { type: 'string', minLength: 1, maxLength: 255 },
          takenAt: { type: 'string', pattern: ISO_ZEIT_PATTERN },
          anchor: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'number' } },
          caption: { type: ['string', 'null'], maxLength: 1000 },
          durationS: { type: 'number', minimum: 0 },
        },
      },
    },
  },
} as const

/** Erlaubte Datei-Endungen je Medientyp (bestimmt die abgelegte Datei) */
const ENDUNGEN: Record<UploadMedium['type'], string[]> = {
  photo: ['jpg', 'jpeg', 'png', 'webp'],
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
