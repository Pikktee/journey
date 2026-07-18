// Edit-Overlay `luhambo/edits@1` (M7): alle Bearbeitungen einer Tour leben in
// EINER Datei (edits.json) neben den unantastbaren Rohdaten unter original/.
// Die Pipeline rendert das Player-JSON stets aus Rohdaten + Overlay neu —
// Wetter/Benennung lassen sich jederzeit neu ableiten, ohne Edits zu verlieren.
//
// Kern-Designentscheid (Plan): Edits referenzieren STABILE Anker — Medien-IDs,
// Koordinaten und absolute Zeitstempel, nie den Streckenanteil f. Ein Trim
// verschiebt so keine nachfolgenden Bearbeitungen.
//
// Titel/Beschreibung liegen bewusst NICHT hier, sondern in den DB-Spalten
// (PATCH /api/tours/:id) — eine Quelle der Wahrheit pro Feld.

import { ISO_ZEIT_MAXLAENGE, ISO_ZEIT_PATTERN, type Modus } from './upload.js'

export const EDITS_SCHEMA_ID = 'luhambo/edits@1'

// Erlaubter Audio-Dateiname (Basisname + Audio-Endung) — geteilt vom
// Overlay-Schema, den Audio-Routen (PUT/DELETE) und dem Editor-Filter.
export const AUDIO_DATEI_PATTERN = '^[A-Za-z0-9_-]{1,64}\\.(mp3|m4a|ogg|wav)$'
const AUDIO_DATEI_REGEX = new RegExp(AUDIO_DATEI_PATTERN)

/** true, wenn der Dateiname eine zulässige Audio-Datei unter media/ bezeichnet. */
export function istAudioDatei(name: string): boolean {
  return AUDIO_DATEI_REGEX.test(name)
}

export interface MediumEdit {
  /** Bildunterschrift-Override ('' = leeren; fehlt = Original behalten) */
  caption?: string
  /** Manuell gesetzter Anker [lng,lat] → placement 'manuell' */
  anchor?: [number, number]
  /** true = Medium aus der Wiedergabe nehmen (die Rohdatei bleibt liegen) */
  geloescht?: boolean
  /** Anzeige-Optionen des Foto-Stopps: Standzeit (s) + Ken-Burns-Drift an/aus */
  display?: { holdS?: number; kenBurns?: boolean }
}

/** Kamera-Preset ab einem absoluten Zeitpunkt — gilt bis zur nächsten Grenze (wie modi). */
export interface KameraGrenze {
  /** ISO 8601, absolut (stabil gegenüber Trim) */
  ab: string
  preset: 'nah' | 'mittel' | 'weit'
}

/** Audio-Spur (Musik) oder One-Shot (SFX), verankert an absoluten Zeitpunkten. */
export interface AudioEdit {
  /** Dateiname unter media/ (per PUT /api/tours/:id/audio/:datei hochgeladen) */
  datei: string
  typ: 'musik' | 'sfx'
  ab: string
  /** Ende (nur bei typ musik erlaubt); fehlt = bis zum Tour-Ende */
  bis?: string
  /** 0..1; fehlt = Standard-Lautstärke des Players */
  lautstaerke?: number
}

/** Fortbewegung ab einem absoluten Zeitpunkt — gilt bis zur nächsten Grenze. */
export interface ModusGrenze {
  /** ISO 8601, absolut (stabil gegenüber Trim) */
  ab: string
  mode: Modus
}

export interface EditOverlay {
  schema: typeof EDITS_SCHEMA_ID
  /** Overrides je Medien-ID des Upload-Manifests */
  medien?: Record<string, MediumEdit>
  /** Modus-Grenzen, wirksam ab `ab` bis zur nächsten Grenze bzw. zum Tour-Ende */
  modi?: ModusGrenze[]
  /** Track auf [start, ende] beschneiden (absolute Zeitstempel, je optional) */
  trim?: { start?: string; ende?: string }
  /** Kamera-Presets, wirksam ab `ab` bis zur nächsten Grenze (Punktfunktion wie modi) */
  kamera?: KameraGrenze[]
  /** Audio-Spuren/Effekte — f-Bereiche entstehen erst beim Rendern */
  audio?: AudioEdit[]
}

// Gleiche (voll verankerte) ISO-Prüfung wie im Upload-Schema — die Semantik
// prüft Date.parse in pruefeEditsSemantik.

/** JSON-Schema für PUT /api/tours/:id/edits (Fastify/Ajv validiert die Form). */
export const editsJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['schema'],
  properties: {
    schema: { const: EDITS_SCHEMA_ID },
    medien: {
      type: 'object',
      maxProperties: 500,
      // Schlüssel = Medien-IDs (gleiche Form wie im Upload-Schema)
      propertyNames: { pattern: '^[A-Za-z0-9_-]{1,64}$' },
      additionalProperties: {
        type: 'object',
        additionalProperties: false,
        properties: {
          caption: { type: 'string', maxLength: 1000 },
          anchor: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'number' } },
          geloescht: { type: 'boolean' },
          display: {
            type: 'object',
            additionalProperties: false,
            properties: {
              holdS: { type: 'number', minimum: 2, maximum: 60 },
              kenBurns: { type: 'boolean' },
            },
          },
        },
      },
    },
    modi: {
      type: 'array',
      maxItems: 200,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['ab', 'mode'],
        properties: {
          ab: { type: 'string', pattern: ISO_ZEIT_PATTERN, maxLength: ISO_ZEIT_MAXLAENGE },
          mode: { enum: ['walk', 'bike', 'tram', 'ferry'] },
        },
      },
    },
    trim: {
      type: 'object',
      additionalProperties: false,
      properties: {
        start: { type: 'string', pattern: ISO_ZEIT_PATTERN, maxLength: ISO_ZEIT_MAXLAENGE },
        ende: { type: 'string', pattern: ISO_ZEIT_PATTERN, maxLength: ISO_ZEIT_MAXLAENGE },
      },
    },
    kamera: {
      type: 'array',
      maxItems: 100,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['ab', 'preset'],
        properties: {
          ab: { type: 'string', pattern: ISO_ZEIT_PATTERN, maxLength: ISO_ZEIT_MAXLAENGE },
          preset: { enum: ['nah', 'mittel', 'weit'] },
        },
      },
    },
    audio: {
      type: 'array',
      maxItems: 50,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['datei', 'typ', 'ab'],
        properties: {
          datei: { type: 'string', pattern: AUDIO_DATEI_PATTERN },
          typ: { enum: ['musik', 'sfx'] },
          ab: { type: 'string', pattern: ISO_ZEIT_PATTERN, maxLength: ISO_ZEIT_MAXLAENGE },
          bis: { type: 'string', pattern: ISO_ZEIT_PATTERN, maxLength: ISO_ZEIT_MAXLAENGE },
          lautstaerke: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
  },
} as const

/**
 * Semantik-Prüfung über das JSON-Schema hinaus: Zeitstempel parsebar,
 * Trim-Spanne echt (start < ende), Audio-Spannen echt, Zahlen endlich.
 * Liefert die Fehlermeldung oder null.
 */
export function pruefeEditsSemantik(edits: EditOverlay): string | null {
  for (const grenze of edits.modi ?? []) {
    if (!Number.isFinite(Date.parse(grenze.ab))) return `Unparsebare Modus-Grenze: ${grenze.ab}`
  }
  // JSON.parse('1e999') liefert Infinity — Ajv-Typ "number" lässt das durch,
  // ein unendlicher Anker würde erst im Player als NaN explodieren. Deshalb
  // hier Number.isFinite auf ALLEN Zahlfeldern (auch holdS/lautstaerke).
  for (const [id, medium] of Object.entries(edits.medien ?? {})) {
    if (medium.anchor && !medium.anchor.every(Number.isFinite)) return `Ungültiger Anker für Medium ${id}`
    if (medium.display?.holdS !== undefined && !Number.isFinite(medium.display.holdS)) {
      return `Ungültige Standzeit für Medium ${id}`
    }
  }
  for (const grenze of edits.kamera ?? []) {
    if (!Number.isFinite(Date.parse(grenze.ab))) return `Unparsebare Kamera-Grenze: ${grenze.ab}`
  }
  for (const spur of edits.audio ?? []) {
    if (!Number.isFinite(Date.parse(spur.ab))) return `Unparsebarer Audio-Start: ${spur.ab}`
    if (spur.bis !== undefined) {
      // Ein SFX ist ein One-Shot ohne Ausdehnung — ein „bis" wäre stille Absicht,
      // die nie wirkt: lieber laut ablehnen als still ignorieren.
      if (spur.typ !== 'musik') return `„bis" ist nur bei Musik erlaubt (${spur.datei})`
      if (!Number.isFinite(Date.parse(spur.bis))) return `Unparsebares Audio-Ende: ${spur.bis}`
      if (Date.parse(spur.bis) <= Date.parse(spur.ab)) {
        return `Audio-Ende muss nach dem Audio-Start liegen (${spur.datei})`
      }
    }
    if (
      spur.lautstaerke !== undefined &&
      !(Number.isFinite(spur.lautstaerke) && spur.lautstaerke >= 0 && spur.lautstaerke <= 1)
    ) {
      return `Ungültige Lautstärke (${spur.datei})`
    }
  }
  const { start, ende } = edits.trim ?? {}
  if (start !== undefined && !Number.isFinite(Date.parse(start))) return `Unparsebarer Trim-Start: ${start}`
  if (ende !== undefined && !Number.isFinite(Date.parse(ende))) return `Unparsebares Trim-Ende: ${ende}`
  if (start !== undefined && ende !== undefined && Date.parse(start) >= Date.parse(ende)) {
    return 'Trim-Start muss vor dem Trim-Ende liegen'
  }
  return null
}
