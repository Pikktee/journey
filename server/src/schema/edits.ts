// Edit-Overlay `maptale/edits@1` (auch `luhambo/edits@1` kompatibel): alle Bearbeitungen einer Tour leben in
// EINER Datei (edits.json) neben den unantastbaren Rohdaten unter original/.
// Die Pipeline rendert das Player-JSON stets aus Rohdaten + Overlay neu —
// Wetter/Benennung lassen sich jederzeit neu ableiten, ohne Edits zu verlieren.

import { WETTER_MODI, type WetterModus } from '../pipeline/weather.js'
import { ISO_ZEIT_MAXLAENGE, ISO_ZEIT_PATTERN, MODI, type Modus } from './upload.js'

export const EDITS_SCHEMA_ID = 'maptale/edits@1'

// Erlaubter Audio-Dateiname (Basisname + Audio-Endung) — geteilt vom
// Overlay-Schema, den Audio-Routen (PUT/DELETE) und dem Editor-Filter.
export const AUDIO_DATEI_PATTERN = '^[A-Za-z0-9_-]{1,64}\\.(mp3|m4a|ogg|wav)$'
const AUDIO_DATEI_REGEX = new RegExp(AUDIO_DATEI_PATTERN)

/** true, wenn der Dateiname eine zulässige Audio-Datei unter media/ bezeichnet. */
export function istAudioDatei(name: string): boolean {
  return AUDIO_DATEI_REGEX.test(name)
}

export interface MediumEdit {
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
  /** Manuell gesetzter Anker [lng,lat] → placement 'manuell' */
  anchor?: [number, number]
  /** true = Medium aus der Wiedergabe nehmen (die Rohdatei bleibt liegen) */
  geloescht?: boolean
  /** Anzeige-Optionen des Foto-Stopps: Standzeit (s) + Ken-Burns-Drift an/aus */
  display?: { holdS?: number; kenBurns?: boolean }
  /**
   * Platz INNERHALB des Foto-Stopps (0-basiert). Der Player fasst Aufnahmen, die
   * weniger als 120 Streckenmeter auseinanderliegen, zu EINEM Halt zusammen und
   * zeigt sie nacheinander; ohne dieses Feld entschiede allein die Projektion
   * der Anker auf die Route über die Abfolge — für den Autor unkontrollierbar.
   * Wirkt nur innerhalb eines Stopps; die Reihenfolge der Stopps untereinander
   * bleibt die Strecke (gruppiereStopps in src/geo.js).
   */
  reihe?: number
  /**
   * Schnitt eines Videos in DATEI-Sekunden (nur `type: 'video'`).
   *
   * Der Anschlag ist an beiden Kanten das MATERIAL: `vonS` ≥ 0, `bisS` ≤ Länge
   * der Datei — Trimmen legt frei, was da ist, und erfindet nichts. Fehlt
   * `bisS`, läuft das Video bis zum Dateiende.
   *
   * Rein additiv: ohne dieses Feld bleibt alles wie bisher (ganze Datei). Der
   * Schnitt wird in der Pipeline ANGEWANDT (video.ts erzeugt eine geschnittene
   * Auslieferungsdatei) — nicht im Player, der nur `durationS` sieht.
   */
  trim?: { vonS: number; bisS?: number }
}

/** Kamera-Preset ab einem absoluten Zeitpunkt — gilt bis zur nächsten Grenze (wie modi). */
export interface KameraGrenze {
  /** ISO 8601, absolut (stabil gegenüber Trim) */
  ab: string
  /**
   * `standard` ist ein Wert wie die anderen drei: „hier gilt, was der Zuschauer
   * im Player eingestellt hat". Additive Erweiterung des Enums — ältere
   * Overlays kennen ihn schlicht nicht, ihr Verhalten ändert sich nicht.
   */
  preset: 'nah' | 'mittel' | 'weit' | 'standard'
  /** Stufenlose Feinjustierung Abstand+Höhe (0.5..2); fehlt/1 = Preset unverändert */
  skala?: number
}

/**
 * Audio-Spur (Musik) oder One-Shot (SFX), verankert an absoluten Zeitpunkten.
 *
 * ZWEI Verankerungen liegen hier nebeneinander, und das ist Absicht:
 *
 * - ALT (`ab`/`bis`): reine Aufnahmezeit. Sie kann nicht ausdrücken, wo in
 *   einer Standzeit ein Klip einsetzt — dort steht die Aufnahmeuhr still,
 *   während der Film weiterläuft (docs/concepts/zeitleiste-umbau.md §1).
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
  datei: string
  typ: 'musik' | 'sfx'
  ab: string
  /** Ende (nur bei typ musik erlaubt); fehlt = bis zum Tour-Ende */
  bis?: string
  /**
   * NEU: Anker in Aufnahmezeit (ISO) — die Stelle der REISE, an der der Klip
   * hängt. Vorrang vor `ab`; fehlt er, gilt `ab` wie bisher.
   */
  anker?: string
  /**
   * NEU: Feinlage relativ zum Anker in FILMsekunden (darf in einer Standzeit
   * liegen, negativ = davor). Ohne `anker` wirkungslos.
   */
  versatzFilmS?: number
  /**
   * NEU: Länge im Film in Sekunden. Vorrang vor `bis`. Auch für SFX erlaubt —
   * ein Effekt hat eine Länge (die seiner Datei), er ist nur bisher als Marke
   * ohne Ausdehnung gezeichnet worden. Fehlt beides, läuft Musik bis zum
   * Tour-Ende und ein Effekt bleibt der One-Shot, der er heute ist.
   */
  dauerFilmS?: number
  /**
   * NEU: Einstieg in die DATEI in Sekunden (linker Trim). Default 0.
   *
   * Linke Kante heißt in FCPX: Anfang UND Datei-Einstieg wandern gemeinsam —
   * der Inhalt bleibt an seinem Platz im Film, vorne fällt etwas weg. Anschlag
   * ist der Dateianfang; auch mit `loop` gibt es davor nichts zu wiederholen.
   */
  einstiegS?: number
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
  /** 0..1; fehlt = Standard-Lautstärke des Players */
  lautstaerke?: number
  /**
   * Herkunft. Fehlt = tour-lokal hochgeladen (Datei muss unter media/ liegen).
   * 'bibliothek' = kuratierter, global ausgelieferter Effekt; die Datei wird
   * NICHT gegen media/ geprüft und über /audio/sfx/ statt /api/media/ geladen.
   * 'benutzer' = eigener Upload in der benutzerweiten Audio-Bibliothek
   * (projektübergreifend, liegt unter <userId>/audio/ und wird über
   * /api/tours/:id/bibliothek-audio/ im Sichtbarkeits-Kontext der Tour geladen).
   */
  quelle?: 'bibliothek' | 'benutzer'
}

/**
 * Wiederholt dieser Klip? DIE eine Stelle für den Default.
 *
 * Musik lief im Player immer geloopt (`el.loop = true`), ein Effekt war immer
 * ein One-Shot. Genau das steht hier als Vorgabe — ein Bestands-Overlay ohne
 * `loop` verhält sich dadurch exakt wie vorher. Editor, Render, Player und
 * Studio-Abspieler fragen alle hier, sonst driftete der Default auseinander.
 */
export function loopAktiv(spur: Pick<AudioEdit, 'typ' | 'loop'>): boolean {
  return spur.loop ?? spur.typ === 'musik'
}

/** Fortbewegung ab einem absoluten Zeitpunkt — gilt bis zur nächsten Grenze. */
export interface ModusGrenze {
  /** ISO 8601, absolut (stabil gegenüber Trim) */
  ab: string
  mode: Modus
}

/**
 * Wetter-Override ab einem absoluten Zeitpunkt — gilt bis zur nächsten Grenze
 * (Punktfunktion wie modi/kamera). Ist überhaupt eine Wetter-Grenze gesetzt,
 * ERSETZT das Overlay das Auto-Wetter der Tour vollständig (Grund vor der ersten
 * Grenze = klar). Bewusste Korrektur, wenn das automatische Wetter danebenlag.
 */
export interface WetterGrenze {
  /** ISO 8601, absolut (stabil gegenüber Trim) */
  ab: string
  mode: WetterModus
  /** Stärke k (0..1, stufenlos); fehlt = Standardstärke des Players */
  staerke?: number
}

/** Moment-Arten — muss mit der Engine (src/tour.js) synchron bleiben. */
export const MOMENT_ARTEN = ['umkreisen', 'aufstieg', 'innehalten'] as const
export type MomentArt = (typeof MOMENT_ARTEN)[number]

/** Kamera-Moment: Punkt-Ereignis, an dem die Fahrt anhält und die Kamera agiert. */
export interface KameraMoment {
  ab: string
  art: MomentArt
  /** Dauer in s (1..30); fehlt = Default der Art im Player. */
  dauerS?: number
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
  /** Kamera-Momente: Punkt-Ereignisse (Umkreisen/Aufstieg/Innehalten) */
  momente?: KameraMoment[]
  /** Audio-Spuren/Effekte — f-Bereiche entstehen erst beim Rendern */
  audio?: AudioEdit[]
  /** Wetter-Grenzen — ersetzen (sobald gesetzt) das Auto-Wetter vollständig */
  wetter?: WetterGrenze[]
  /**
   * Medien-ID des Bildes, das die Tour in Listen und Galerie vertritt. Fehlt
   * es (oder zeigt es auf ein gelöschtes/unbekanntes Medium), wählt der Render
   * das erste platzierte Foto.
   */
  titelbild?: string
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
    // Medien-ID wie in `medien` — auf Existenz wird bewusst nicht geprüft, der
    // Render fällt bei einer unbekannten ID auf das erste Foto zurück.
    titelbild: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,64}$' },
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
          reihe: { type: 'integer', minimum: 0, maximum: 499 },
          // Video-Schnitt in Dateisekunden. Keine Obergrenze im Schema — der
          // Anschlag ist die Länge DIESER Datei, die nur die Pipeline kennt
          // (video.ts klemmt darauf).
          trim: {
            type: 'object',
            additionalProperties: false,
            required: ['vonS'],
            properties: {
              vonS: { type: 'number', minimum: 0 },
              bisS: { type: 'number', minimum: 0 },
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
          mode: { enum: [...MODI] },
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
          preset: { enum: ['nah', 'mittel', 'weit', 'standard'] },
          skala: { type: 'number', minimum: 0.5, maximum: 2 },
        },
      },
    },
    momente: {
      type: 'array',
      maxItems: 100,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['ab', 'art'],
        properties: {
          ab: { type: 'string', pattern: ISO_ZEIT_PATTERN, maxLength: ISO_ZEIT_MAXLAENGE },
          art: { enum: [...MOMENT_ARTEN] },
          dauerS: { type: 'number', minimum: 1, maximum: 30 },
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
          quelle: { enum: ['bibliothek', 'benutzer'] },
          anker: { type: 'string', pattern: ISO_ZEIT_PATTERN, maxLength: ISO_ZEIT_MAXLAENGE },
          // Versatz darf negativ sein (Klip liegt VOR seinem Anker); die
          // Schranken sind großzügig — geklemmt wird beim Rendern an der Achse.
          versatzFilmS: { type: 'number', minimum: -86400, maximum: 86400 },
          dauerFilmS: { type: 'number', exclusiveMinimum: 0, maximum: 86400 },
          einstiegS: { type: 'number', minimum: 0, maximum: 86400 },
          loop: { type: 'boolean' },
        },
      },
    },
    wetter: {
      type: 'array',
      maxItems: 200,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['ab', 'mode'],
        properties: {
          ab: { type: 'string', pattern: ISO_ZEIT_PATTERN, maxLength: ISO_ZEIT_MAXLAENGE },
          mode: { enum: [...WETTER_MODI] },
          staerke: { type: 'number', minimum: 0, maximum: 1 },
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
    if (medium.reihe !== undefined && !Number.isInteger(medium.reihe)) {
      return `Ungültiger Platz im Stopp für Medium ${id}`
    }
    if (medium.trim) {
      const { vonS, bisS } = medium.trim
      if (!(Number.isFinite(vonS) && vonS >= 0)) return `Ungültiger Video-Schnitt für Medium ${id}`
      if (bisS !== undefined) {
        if (!Number.isFinite(bisS)) return `Ungültiger Video-Schnitt für Medium ${id}`
        // Ein Schnitt ohne Inhalt ist keine Geschmacksfrage: er ließe ein
        // Medium zurück, das im Film null Sekunden dauert.
        if (bisS <= vonS) return `Video-Schnittende muss hinter dem Anfang liegen (${id})`
      }
    }
  }
  for (const grenze of edits.kamera ?? []) {
    if (!Number.isFinite(Date.parse(grenze.ab))) return `Unparsebare Kamera-Grenze: ${grenze.ab}`
    if (grenze.skala !== undefined && !Number.isFinite(grenze.skala)) return `Ungültige Kamera-Feinjustierung: ${grenze.ab}`
  }
  for (const moment of edits.momente ?? []) {
    if (!Number.isFinite(Date.parse(moment.ab))) return `Unparsebarer Kamera-Moment: ${moment.ab}`
    if (moment.dauerS !== undefined && !Number.isFinite(moment.dauerS)) return `Ungültige Moment-Dauer: ${moment.ab}`
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
    // Die neue (Film-)Verankerung. `anker` ist die Stelle der Reise, alles
    // andere hängt an ihr — deshalb wird jedes Feld einzeln auf Endlichkeit
    // geprüft (JSON.parse('1e999') ist Infinity und käme durch Ajv „number").
    if (spur.anker !== undefined && !Number.isFinite(Date.parse(spur.anker))) {
      return `Unparsebarer Audio-Anker: ${spur.anker}`
    }
    if (spur.versatzFilmS !== undefined && !Number.isFinite(spur.versatzFilmS)) {
      return `Ungültiger Audio-Versatz (${spur.datei})`
    }
    if (spur.dauerFilmS !== undefined && !(Number.isFinite(spur.dauerFilmS) && spur.dauerFilmS > 0)) {
      return `Ungültige Audio-Länge (${spur.datei})`
    }
    // Der linke Trim hat den Dateianfang als Anschlag — auch mit Loop, denn vor
    // dem Anfang gibt es nichts zu wiederholen. Die Obergrenze (Dateilänge)
    // kennt nur der Editor; hier steht die Hälfte, die immer gilt.
    if (spur.einstiegS !== undefined && !(Number.isFinite(spur.einstiegS) && spur.einstiegS >= 0)) {
      return `Ungültiger Datei-Einstieg (${spur.datei})`
    }
  }
  for (const grenze of edits.wetter ?? []) {
    if (!Number.isFinite(Date.parse(grenze.ab))) return `Unparsebare Wetter-Grenze: ${grenze.ab}`
    if (
      grenze.staerke !== undefined &&
      !(Number.isFinite(grenze.staerke) && grenze.staerke >= 0 && grenze.staerke <= 1)
    ) {
      return `Ungültige Wetter-Stärke: ${grenze.ab}`
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
