// Edit-Overlay `maptale/edits@2`: alle Bearbeitungen einer Tour leben in
// EINER Datei (edits.json) neben den unantastbaren Rohdaten unter original/.
// Die Pipeline rendert das Player-JSON stets aus Rohdaten + Overlay neu —
// Wetter/Benennung lassen sich jederzeit neu ableiten, ohne Edits zu verlieren.

import { WEATHER_MODES, type WeatherMode } from '../pipeline/weather.js'
import { ISO_TIME_MAX_LENGTH, ISO_TIME_PATTERN, TRAVEL_MODES, type TravelMode } from './upload.js'

export const EDITS_SCHEMA_ID = 'maptale/edits@2'

// Erlaubter Audio-Dateiname (Basisname + Audio-Endung) — geteilt vom
// Overlay-Schema, den Audio-Routen (PUT/DELETE) und dem Editor-Filter.
export const AUDIO_FILE_PATTERN = '^[A-Za-z0-9_-]{1,64}\\.(mp3|m4a|ogg|wav)$'
const AUDIO_DATEI_REGEX = new RegExp(AUDIO_FILE_PATTERN)

/**
 * Reglerstellung eines Ton-Klips ohne eigenen Wert. Der Studio-Abspieler hört
 * genau damit vor (`TON_PEGEL_VORGABE` in src/studio/editmodell.ts, Drift-Wächter
 * in test/studio-baukasten.test.ts), und `enrich.ts` schreibt sie ins Tour-JSON:
 * Der Player kennt die Vorgabe sonst nicht und spielte mit 1.0 — der Film wäre
 * lauter als der Schnitt.
 */
export const STUDIO_GAIN = 0.8

/** true, wenn der Dateiname eine zulässige Audio-Datei unter media/ bezeichnet. */
export function isAudioFile(name: string): boolean {
  return AUDIO_DATEI_REGEX.test(name)
}

export interface MediaEdit {
  /**
   * DER Nutzertext des Mediums ('' = leeren; fehlt = Original behalten).
   *
   * Achtung, der Begriff wechselt dreimal den Namen: In der Oberfläche (App und
   * Studio) heißt er „Titel", hier im Overlay `caption`, und im gerenderten
   * Tour-JSON landet er als `title` — der Player zeigt ihn als ÜBERSCHRIFT des
   * Foto-Stopps, die Uhrzeit rutscht darunter (siehe enrich.ts). Der Feldname
   * ist historisch; wer ihn „korrigiert", indem er den Text wieder in die
   * Unterzeile schiebt, macht die Überschrift zur Maschinenangabe zurück.
   * Käme je eine zweite Zeile dazu, hieße sie `untertitel`.
   */
  caption?: string
  /** Manuell gesetzter Anker [lng,lat] → placement 'manual' */
  anchor?: [number, number]
  /** true = Medium aus der Wiedergabe nehmen (die Rohdatei bleibt liegen) */
  removed?: boolean
  /** Anzeige-Optionen des Foto-Stopps: Standzeit (s) + Ken-Burns-Drift an/aus */
  display?: { holdS?: number; kenBurns?: boolean }
  /**
   * Platz INNERHALB des Foto-Stopps (0-basiert). Der Player fasst Aufnahmen, die
   * weniger als 120 Streckenmeter auseinanderliegen, zu EINEM Halt zusammen und
   * zeigt sie nacheinander; ohne dieses Feld entschiede allein die Projektion
   * der Anker auf die Route über die Abfolge — für den Autor unkontrollierbar.
   * Wirkt nur innerhalb eines Stopps; die Reihenfolge der Stopps untereinander
   * bleibt die Strecke (gruppiereStopps in src/geo.ts).
   */
  order?: number
  /**
   * Schnitt eines Videos in DATEI-Sekunden (nur `type: 'video'`).
   *
   * Der Anschlag ist an beiden Kanten das MATERIAL: `fromS` ≥ 0, `toS` ≤ Länge
   * der Datei — Trimmen legt frei, was da ist, und erfindet nichts. Fehlt
   * `toS`, läuft das Video bis zum Dateiende.
   *
   * Rein additiv: ohne dieses Feld bleibt alles wie bisher (ganze Datei). Der
   * Schnitt wird in der Pipeline ANGEWANDT (video.ts erzeugt eine geschnittene
   * Auslieferungsdatei) — nicht im Player, der nur `durationS` sieht.
   */
  trim?: { fromS: number; toS?: number }
}

/** Kamera-Preset ab einem absoluten Zeitpunkt — gilt bis zur nächsten Grenze (wie travelModes). */
export interface CameraBoundary {
  /** ISO 8601, absolut (stabil gegenüber Trim) */
  from: string
  /**
   * `default` ist ein Wert wie die anderen drei: „hier gilt, was der Zuschauer
   * im Player eingestellt hat". Additive Erweiterung des Enums — ältere
   * Overlays kennen ihn schlicht nicht, ihr Verhalten ändert sich nicht.
   */
  preset: 'near' | 'mid' | 'far' | 'default'
  /** Stufenlose Feinjustierung Abstand+Höhe (0.5..2); fehlt/1 = Preset unverändert */
  scale?: number
}

/**
 * Audio-Spur (Musik) oder One-Shot (SFX), verankert an absoluten Zeitpunkten.
 *
 * ZWEI Verankerungen liegen hier nebeneinander, und das ist Absicht:
 *
 * - ALT (`ab`/`bis`): reine Aufnahmezeit. Sie kann nicht ausdrücken, wo in
 *   einer Standzeit ein Klip einsetzt — dort steht die Aufnahmeuhr still,
 *   während der Film weiterläuft (docs/architecture/zeitleiste-umbau.md §1).
 * - NEU (`anker` + `versatzFilmS` + `dauerFilmS`): der FCPX-„connected clip".
 *   Der Anker sagt, WO AUF DER REISE der Klip hängt, der Versatz in
 *   FILMsekunden sagt, wo genau — auch mitten in einem Halt. Dadurch rückt Ton
 *   mit, wenn sich Standzeiten oder die Fortbewegung ändern; vorher war er das
 *   einzige Element, das liegen blieb.
 *
 * Aufwertung nach dem Muster von `materialisiereModi`/`schreibeWetterFest`:
 * Das Studio schreibt die neuen Felder beim ersten Eingriff fest, der Render
 * bevorzugt sie, `ab`/`bis` bleiben als Fallback lesbar. Bestands-Overlays
 * ohne die neuen Felder rendern unverändert (Vertragstest).
 */
export interface AudioEdit {
  /** Dateiname unter media/ (hochgeladen) bzw. unter public/audio/sfx/ (Bibliothek) */
  file: string
  type: 'music' | 'sfx'
  from: string
  /** Ende (nur bei type music erlaubt); fehlt = bis zum Tour-Ende */
  to?: string
  /**
   * NEU: Anker in Aufnahmezeit (ISO) — die Stelle der REISE, an der der Klip
   * hängt. Vorrang vor `ab`; fehlt er, gilt `ab` wie bisher.
   */
  anchor?: string
  /**
   * NEU: Feinlage relativ zum Anker in FILMsekunden (darf in einer Standzeit
   * liegen, negativ = davor). Ohne `anker` wirkungslos.
   */
  offsetFilmS?: number
  /**
   * NEU: Länge im Film in Sekunden. Vorrang vor `bis`. Auch für SFX erlaubt —
   * ein Effekt hat eine Länge (die seiner Datei), er ist nur bisher als Marke
   * ohne Ausdehnung gezeichnet worden. Fehlt beides, läuft Musik bis zum
   * Tour-Ende und ein Effekt bleibt der One-Shot, der er heute ist.
   */
  durationFilmS?: number
  /**
   * NEU: Einstieg in die DATEI in Sekunden (linker Trim). Default 0.
   *
   * Linke Kante heißt in FCPX: Anfang UND Datei-Einstieg wandern gemeinsam —
   * der Inhalt bleibt an seinem Platz im Film, vorne fällt etwas weg. Anschlag
   * ist der Dateianfang; auch mit `loop` gibt es davor nichts zu wiederholen.
   */
  startS?: number
  /**
   * NEU: Wiederholung über das Dateiende hinaus.
   *
   * Default (fehlt) = `typ === 'musik'` — exakt das heutige Player-Verhalten
   * (`el.loop = true` für Musik, One-Shot für SFX), also kein Verhaltensbruch
   * für Bestandsdaten. Loop hebt NUR den RECHTEN Materialanschlag auf: `el.loop`
   * springt am Dateiende auf den Anfang, eine Wiederholung VOR dem Anfang gibt
   * es nicht.
   */
  loop?: boolean
  /** 0..1; fehlt = {@link STUDIO_PEGEL} (die Reglerstellung, die der Editor zeigt) */
  volume?: number
  /**
   * Herkunft. Fehlt = tour-lokal hochgeladen (Datei muss unter media/ liegen).
   * 'library' = kuratierter, global ausgelieferter Effekt; die Datei wird
   * NICHT gegen media/ geprüft und über /audio/sfx/ statt /api/media/ geladen.
   * 'user' = eigener Upload in der benutzerweiten Audio-Bibliothek
   * (projektübergreifend, liegt unter <userId>/audio/ und wird über
   * /api/tours/:id/library-audio/ im Sichtbarkeits-Kontext der Tour geladen).
   */
  source?: 'library' | 'user'
}

/**
 * Wiederholt dieser Klip? DIE eine Stelle für den Default.
 *
 * Musik lief im Player immer geloopt (`el.loop = true`), ein Effekt war immer
 * ein One-Shot. Genau das steht hier als Vorgabe — ein Bestands-Overlay ohne
 * `loop` verhält sich dadurch exakt wie vorher. Editor, Render, Player und
 * Studio-Abspieler fragen alle hier, sonst driftete der Default auseinander.
 */
export function loopEnabled(spur: Pick<AudioEdit, 'type' | 'loop'>): boolean {
  return spur.loop ?? spur.type === 'music'
}

/** Fortbewegung ab einem absoluten Zeitpunkt — gilt bis zur nächsten Grenze. */
export interface TravelModeBoundary {
  /** ISO 8601, absolut (stabil gegenüber Trim) */
  from: string
  mode: TravelMode
}

/**
 * Wetter-Override ab einem absoluten Zeitpunkt — gilt bis zur nächsten Grenze
 * (Punktfunktion wie modi/kamera). Ist überhaupt eine Wetter-Grenze gesetzt,
 * ERSETZT das Overlay das Auto-Wetter der Tour vollständig (Grund vor der ersten
 * Grenze = klar). Bewusste Korrektur, wenn das automatische Wetter danebenlag.
 */
export interface WeatherBoundary {
  /** ISO 8601, absolut (stabil gegenüber Trim) */
  from: string
  mode: WeatherMode
  /** Stärke k (0..1, stufenlos); fehlt = Standardstärke des Players */
  intensity?: number
}

/** Moment-Arten — muss mit der Engine (src/tour.ts) synchron bleiben. */
export const CAMERA_MOMENT_KINDS = ['orbit', 'ascend', 'linger'] as const
export type CameraMomentKind = (typeof CAMERA_MOMENT_KINDS)[number]

/** Kamera-Moment: Punkt-Ereignis, an dem die Fahrt anhält und die Kamera agiert. */
export interface CameraMoment {
  from: string
  kind: CameraMomentKind
  /** Dauer in s (1..30); fehlt = Default der Art im Player. */
  durationS?: number
}

export interface EditOverlay {
  schema: typeof EDITS_SCHEMA_ID
  /** Overrides je Medien-ID des Upload-Manifests */
  media?: Record<string, MediaEdit>
  /** Modus-Grenzen, wirksam ab `from` bis zur nächsten Grenze bzw. zum Tour-Ende */
  travelModes?: TravelModeBoundary[]
  /** Track auf [start, end] beschneiden (absolute Zeitstempel, je optional) */
  trim?: { start?: string; end?: string }
  /** Kamera-Presets, wirksam ab `from` bis zur nächsten Grenze (Punktfunktion wie travelModes) */
  camera?: CameraBoundary[]
  /** Kamera-Momente: Punkt-Ereignisse (Umkreisen/Aufstieg/Innehalten) */
  moments?: CameraMoment[]
  /** Audio-Spuren/Effekte — f-Bereiche entstehen erst beim Rendern */
  audio?: AudioEdit[]
  /** Wetter-Grenzen — ersetzen (sobald gesetzt) das Auto-Wetter vollständig */
  weather?: WeatherBoundary[]
  /**
   * Medien-ID des Bildes, das die Tour in Listen und Galerie vertritt. Fehlt
   * es (oder zeigt es auf ein gelöschtes/unbekanntes Medium), wählt der Render
   * das erste platzierte Foto.
   */
  cover?: string
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
    // Medien-ID wie in `media` — auf Existenz wird bewusst nicht geprüft, der
    // Render fällt bei einer unbekannten ID auf das erste Foto zurück.
    cover: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,64}$' },
    media: {
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
          removed: { type: 'boolean' },
          display: {
            type: 'object',
            additionalProperties: false,
            properties: {
              holdS: { type: 'number', minimum: 2, maximum: 60 },
              kenBurns: { type: 'boolean' },
            },
          },
          order: { type: 'integer', minimum: 0, maximum: 499 },
          // Video-Schnitt in Dateisekunden. Keine Obergrenze im Schema — der
          // Anschlag ist die Länge DIESER Datei, die nur die Pipeline kennt
          // (video.ts klemmt darauf).
          trim: {
            type: 'object',
            additionalProperties: false,
            required: ['fromS'],
            properties: {
              fromS: { type: 'number', minimum: 0 },
              toS: { type: 'number', minimum: 0 },
            },
          },
        },
      },
    },
    travelModes: {
      type: 'array',
      maxItems: 200,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['from', 'mode'],
        properties: {
          from: { type: 'string', pattern: ISO_TIME_PATTERN, maxLength: ISO_TIME_MAX_LENGTH },
          mode: { enum: [...TRAVEL_MODES] },
        },
      },
    },
    trim: {
      type: 'object',
      additionalProperties: false,
      properties: {
        start: { type: 'string', pattern: ISO_TIME_PATTERN, maxLength: ISO_TIME_MAX_LENGTH },
        end: { type: 'string', pattern: ISO_TIME_PATTERN, maxLength: ISO_TIME_MAX_LENGTH },
      },
    },
    camera: {
      type: 'array',
      maxItems: 100,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['from', 'preset'],
        properties: {
          from: { type: 'string', pattern: ISO_TIME_PATTERN, maxLength: ISO_TIME_MAX_LENGTH },
          preset: { enum: ['near', 'mid', 'far', 'default'] },
          scale: { type: 'number', minimum: 0.5, maximum: 2 },
        },
      },
    },
    moments: {
      type: 'array',
      maxItems: 100,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['from', 'kind'],
        properties: {
          from: { type: 'string', pattern: ISO_TIME_PATTERN, maxLength: ISO_TIME_MAX_LENGTH },
          kind: { enum: [...CAMERA_MOMENT_KINDS] },
          durationS: { type: 'number', minimum: 1, maximum: 30 },
        },
      },
    },
    audio: {
      type: 'array',
      maxItems: 50,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['file', 'type', 'from'],
        properties: {
          file: { type: 'string', pattern: AUDIO_FILE_PATTERN },
          type: { enum: ['music', 'sfx'] },
          from: { type: 'string', pattern: ISO_TIME_PATTERN, maxLength: ISO_TIME_MAX_LENGTH },
          to: { type: 'string', pattern: ISO_TIME_PATTERN, maxLength: ISO_TIME_MAX_LENGTH },
          volume: { type: 'number', minimum: 0, maximum: 1 },
          source: { enum: ['library', 'user'] },
          anchor: { type: 'string', pattern: ISO_TIME_PATTERN, maxLength: ISO_TIME_MAX_LENGTH },
          // Versatz darf negativ sein (Klip liegt VOR seinem Anker); die
          // Schranken sind großzügig — geklemmt wird beim Rendern an der Achse.
          offsetFilmS: { type: 'number', minimum: -86400, maximum: 86400 },
          durationFilmS: { type: 'number', exclusiveMinimum: 0, maximum: 86400 },
          startS: { type: 'number', minimum: 0, maximum: 86400 },
          loop: { type: 'boolean' },
        },
      },
    },
    weather: {
      type: 'array',
      maxItems: 200,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['from', 'mode'],
        properties: {
          from: { type: 'string', pattern: ISO_TIME_PATTERN, maxLength: ISO_TIME_MAX_LENGTH },
          mode: { enum: [...WEATHER_MODES] },
          intensity: { type: 'number', minimum: 0, maximum: 1 },
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
export function validateEditsSemantics(edits: EditOverlay): string | null {
  for (const grenze of edits.travelModes ?? []) {
    if (!Number.isFinite(Date.parse(grenze.from))) return `Unparsebare Modus-Grenze: ${grenze.from}`
  }
  // JSON.parse('1e999') liefert Infinity — Ajv-Typ "number" lässt das durch,
  // ein unendlicher Anker würde erst im Player als NaN explodieren. Deshalb
  // hier Number.isFinite auf ALLEN Zahlfeldern (auch holdS/lautstaerke).
  for (const [id, medium] of Object.entries(edits.media ?? {})) {
    if (medium.anchor && !medium.anchor.every(Number.isFinite))
      return `Ungültiger Anker für Medium ${id}`
    if (medium.display?.holdS !== undefined && !Number.isFinite(medium.display.holdS)) {
      return `Ungültige Standzeit für Medium ${id}`
    }
    if (medium.order !== undefined && !Number.isInteger(medium.order)) {
      return `Ungültiger Platz im Stopp für Medium ${id}`
    }
    if (medium.trim) {
      const { fromS, toS } = medium.trim
      if (!(Number.isFinite(fromS) && fromS >= 0))
        return `Ungültiger Video-Schnitt für Medium ${id}`
      if (toS !== undefined) {
        if (!Number.isFinite(toS)) return `Ungültiger Video-Schnitt für Medium ${id}`
        // Ein Schnitt ohne Inhalt ist keine Geschmacksfrage: er ließe ein
        // Medium zurück, das im Film null Sekunden dauert.
        if (toS <= fromS) return `Video-Schnittende muss hinter dem Anfang liegen (${id})`
      }
    }
  }
  for (const grenze of edits.camera ?? []) {
    if (!Number.isFinite(Date.parse(grenze.from)))
      return `Unparsebare Kamera-Grenze: ${grenze.from}`
    if (grenze.scale !== undefined && !Number.isFinite(grenze.scale))
      return `Ungültige Kamera-Feinjustierung: ${grenze.from}`
  }
  for (const moment of edits.moments ?? []) {
    if (!Number.isFinite(Date.parse(moment.from)))
      return `Unparsebarer Kamera-Moment: ${moment.from}`
    if (moment.durationS !== undefined && !Number.isFinite(moment.durationS))
      return `Ungültige Moment-Dauer: ${moment.from}`
  }
  for (const spur of edits.audio ?? []) {
    if (!Number.isFinite(Date.parse(spur.from))) return `Unparsebarer Audio-Start: ${spur.from}`
    if (spur.to !== undefined) {
      // Ein SFX ist ein One-Shot ohne Ausdehnung — ein „bis" wäre stille Absicht,
      // die nie wirkt: lieber laut ablehnen als still ignorieren.
      if (spur.type !== 'music') return `„to" ist nur bei Musik erlaubt (${spur.file})`
      if (!Number.isFinite(Date.parse(spur.to))) return `Unparsebares Audio-Ende: ${spur.to}`
      if (Date.parse(spur.to) <= Date.parse(spur.from)) {
        return `Audio-Ende muss nach dem Audio-Start liegen (${spur.file})`
      }
    }
    if (
      spur.volume !== undefined &&
      !(Number.isFinite(spur.volume) && spur.volume >= 0 && spur.volume <= 1)
    ) {
      return `Ungültige Lautstärke (${spur.file})`
    }
    // Die neue (Film-)Verankerung. `anker` ist die Stelle der Reise, alles
    // andere hängt an ihr — deshalb wird jedes Feld einzeln auf Endlichkeit
    // geprüft (JSON.parse('1e999') ist Infinity und käme durch Ajv „number").
    if (spur.anchor !== undefined && !Number.isFinite(Date.parse(spur.anchor))) {
      return `Unparsebarer Audio-Anker: ${spur.anchor}`
    }
    if (spur.offsetFilmS !== undefined && !Number.isFinite(spur.offsetFilmS)) {
      return `Ungültiger Audio-Versatz (${spur.file})`
    }
    if (
      spur.durationFilmS !== undefined &&
      !(Number.isFinite(spur.durationFilmS) && spur.durationFilmS > 0)
    ) {
      return `Ungültige Audio-Länge (${spur.file})`
    }
    // Der linke Trim hat den Dateianfang als Anschlag — auch mit Loop, denn vor
    // dem Anfang gibt es nichts zu wiederholen. Die Obergrenze (Dateilänge)
    // kennt nur der Editor; hier steht die Hälfte, die immer gilt.
    if (spur.startS !== undefined && !(Number.isFinite(spur.startS) && spur.startS >= 0)) {
      return `Ungültiger Datei-Einstieg (${spur.file})`
    }
  }
  for (const grenze of edits.weather ?? []) {
    if (!Number.isFinite(Date.parse(grenze.from)))
      return `Unparsebare Wetter-Grenze: ${grenze.from}`
    if (
      grenze.intensity !== undefined &&
      !(Number.isFinite(grenze.intensity) && grenze.intensity >= 0 && grenze.intensity <= 1)
    ) {
      return `Ungültige Wetter-Stärke: ${grenze.from}`
    }
  }
  const { start, end } = edits.trim ?? {}
  if (start !== undefined && !Number.isFinite(Date.parse(start)))
    return `Unparsebarer Trim-Start: ${start}`
  if (end !== undefined && !Number.isFinite(Date.parse(end)))
    return `Unparsebares Trim-Ende: ${end}`
  if (start !== undefined && end !== undefined && Date.parse(start) >= Date.parse(end)) {
    return 'Trim-Start muss vor dem Trim-Ende liegen'
  }
  return null
}
