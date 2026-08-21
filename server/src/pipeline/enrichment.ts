// Anreicherungs-Cache (`maptale/enrichment@2`): die TEUREN, extern beschafften
// Ergebnisse der Pipeline liegen als eigenes Artefakt neben tour.json — sie
// hängen alle an den UNVERÄNDERLICHEN Rohdaten, nicht am Edit-Overlay. Dadurch
// muss ein Edit-Speichern nur noch das Overlay lokal anwenden (Sekunden­bruchteil)
// statt Bildanalyse, Reverse-Geocoding und Open-Meteo erneut aufzurufen.
//
// Zwei Gültigkeitsklassen:
//  - `findings`, `videoMeta` hängen NUR an den Rohfotos/-videos → immer gültig,
//    nur ein „Neu verarbeiten" (frisch) erneuert sie.
//  - `places`, `weatherRaw` hängen am (getrimmten) Track → gültig für die
//    `trimSignature`, unter der sie berechnet wurden. Ändert sich der Trim,
//    werden nur diese beiden neu geholt (Bildanalyse bleibt gecacht).

import type { EditOverlay } from '../schema/edits.js'
import type { UploadManifest, UploadPoint } from '../schema/upload.js'
import { applyEditsToSegments } from './edits.js'
import { geocodeEndpoints, type Endpoints, type Geocoder } from './naming.js'
import type { VideoMeta } from './video.js'
import type { ImageFinding } from './vision.js'
import { computeWeather, type WeatherKeyframe, type WeatherSource } from './weather.js'
import { buildTimeSeries } from './time.js'

export const ENRICHMENT_SCHEMA_ID = 'maptale/enrichment@2'

export interface EnrichmentCache {
  schema: typeof ENRICHMENT_SCHEMA_ID
  /** Foto-Befunde je Medien-ID (M5) — hängen NUR an den Rohfotos (nie Trim/Titel) */
  findings: Record<string, ImageFinding>
  /** Video-Metadaten je Medien-ID (M4) — hängen an den Roh-Videos UND am Schnitt */
  videoMeta: Record<string, VideoMeta>
  /**
   * Video-Schnitt-Zustand, unter dem `videoMeta` galt (Etappe 4).
   *
   * Die Video-Aufbereitung war bis dahin rein von den Rohdaten abhängig und
   * überlebte deshalb jedes Edit-Speichern im Cache. Ein Schnitt ist aber ein
   * EDIT, der die ausgelieferte Datei und ihre Länge verändert — ohne diese
   * Signatur bliebe er bis zum nächsten „Neu verarbeiten" folgenlos.
   * Fehlt das Feld (Cache von vor Etappe 4), zählt das wie „kein Schnitt".
   */
  videoCutSignature?: string
  /** Trim-Zustand, unter dem `places`+`weatherRaw` galten (JSON von edits.trim) */
  trimSignature: string
  /** Reverse-Geocoding der Endpunkte (Ortsnamen) — trim-abhängig */
  places: Endpoints
  /** Rohe Wetter-Keyframes vor Foto-Verfeinerung — trim-abhängig; null = kein Wetter */
  weatherRaw: WeatherKeyframe[] | null
}

/**
 * Signatur des Trim-Zustands: nur der Trim bewegt Start-/Zielpunkt und die
 * Zeitreihe und macht damit `places`/`weatherRaw` ungültig. Alle anderen Edits
 * (Caption, Modus, Kamera, Audio, Momente, Titel) lassen sie unberührt.
 */
export const trimSignature = (edits?: EditOverlay | null): string =>
  JSON.stringify(edits?.trim ?? null)

/**
 * Signatur der Video-Schnitte: nur sie machen `videoMeta` ungültig.
 *
 * Sortiert nach Medien-ID, damit die Reihenfolge im Overlay keinen Unterschied
 * macht — sonst löste eine Umsortierung ohne inhaltliche Änderung einen
 * Transcode aus. Ohne jeden Schnitt ist die Signatur `'[]'` und deckt sich mit
 * dem Zustand eines Caches von vor Etappe 4 (Feld fehlt → Default).
 */
export const videoCutSignature = (edits?: EditOverlay | null): string =>
  JSON.stringify(
    Object.entries(edits?.media ?? {})
      .filter(([, m]) => m?.trim)
      .map(([id, m]) => [id, m.trim?.fromS ?? 0, m.trim?.toS ?? null])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  )

/** Map → JSON-serialisierbares Record (Cache schreiben). */
export const mapToRecord = <V>(m: Map<string, V> | undefined): Record<string, V> =>
  Object.fromEntries(m ?? [])
/** Record → Map (Cache lesen). */
export const recordToMap = <V>(r: Record<string, V> | undefined): Map<string, V> =>
  new Map(Object.entries(r ?? {}))

/**
 * Die trim-abhängigen Roh-Ergebnisse frisch beschaffen: Endpunkte geocodieren
 * und das Auto-Wetter der (getrimmten) Strecke aus der Quelle ziehen. Beides sind
 * die externen Aufrufe — der Aufrufer (processTour) ruft das nur bei `frisch` oder
 * geänderter Trim-Signatur. Wirft nur, wenn der Track leer ist (wie reichereAn);
 * ein Wetterdienst-Ausfall führt zu `weatherRaw: null` (Client-Fallback).
 */
export async function computeRawEnrichment(e: {
  manifest: UploadManifest
  edits?: EditOverlay | null
  geocoder: Geocoder
  weather?: WeatherSource | null
  protokoll?: (nachricht: string) => void
}): Promise<{ places: Endpoints; weatherRaw: WeatherKeyframe[] | null }> {
  const startMs = Date.parse(e.manifest.time.start)
  const rohSegmente = applyEditsToSegments(e.manifest.segments ?? [], e.edits ?? null, startMs)
  const erstes = rohSegmente[0]
  const letztes = rohSegmente[rohSegmente.length - 1]
  if (!erstes || !letztes)
    throw new Error('Kein Track übrig (Segmente fehlen oder der Trim entfernt alles)')
  const startPunkt = erstes.pts[0] as UploadPoint
  const zielPunkt = letztes.pts[letztes.pts.length - 1] as UploadPoint

  const places = await geocodeEndpoints(
    e.geocoder,
    [startPunkt[0], startPunkt[1]],
    [zielPunkt[0], zielPunkt[1]],
  )

  let weatherRaw: WeatherKeyframe[] | null = null
  if (e.weather) {
    try {
      weatherRaw = await computeWeather({
        reihe: buildTimeSeries(rohSegmente),
        startIso: e.manifest.time.start,
        quelle: e.weather,
      })
    } catch (fehler) {
      e.protokoll?.(`Auto-Wetter nicht verfügbar: ${(fehler as Error).message}`)
    }
  }
  return { places, weatherRaw }
}
