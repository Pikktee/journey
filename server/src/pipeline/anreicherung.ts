// Anreicherungs-Cache (`luhambo/anreicherung@1`): die TEUREN, extern beschafften
// Ergebnisse der Pipeline liegen als eigenes Artefakt neben tour.json — sie
// hängen alle an den UNVERÄNDERLICHEN Rohdaten, nicht am Edit-Overlay. Dadurch
// muss ein Edit-Speichern nur noch das Overlay lokal anwenden (Sekunden­bruchteil)
// statt Bildanalyse, Reverse-Geocoding und Open-Meteo erneut aufzurufen.
//
// Zwei Gültigkeitsklassen:
//  - `befunde`, `videoMeta` hängen NUR an den Rohfotos/-videos → immer gültig,
//    nur ein „Neu verarbeiten" (frisch) erneuert sie.
//  - `orte`, `wetterRoh` hängen am (getrimmten) Track → gültig für die
//    `trimSignatur`, unter der sie berechnet wurden. Ändert sich der Trim,
//    werden nur diese beiden neu geholt (Bildanalyse bleibt gecacht).

import type { EditOverlay } from '../schema/edits.js'
import type { UploadManifest, UploadPunkt } from '../schema/upload.js'
import { wendeEditsAufSegmenteAn } from './edits.js'
import { geocodiereEndpunkte, type Endpunkte, type Geocoder } from './naming.js'
import type { VideoMeta } from './video.js'
import type { BildBefund } from './vision.js'
import { berechneWetter, type WetterKeyframe, type WetterQuelle } from './weather.js'
import { baueZeitreihe } from './zeit.js'

export const ANREICHERUNG_SCHEMA_ID = 'luhambo/anreicherung@1'

export interface AnreicherungsCache {
  schema: typeof ANREICHERUNG_SCHEMA_ID
  /** Foto-Befunde je Medien-ID (M5) — hängen NUR an den Rohfotos (nie Trim/Titel) */
  befunde: Record<string, BildBefund>
  /** Video-Metadaten je Medien-ID (M4) — hängen NUR an den Roh-Videos */
  videoMeta: Record<string, VideoMeta>
  /** Trim-Zustand, unter dem `orte`+`wetterRoh` galten (JSON von edits.trim) */
  trimSignatur: string
  /** Reverse-Geocoding der Endpunkte (Ortsnamen) — trim-abhängig */
  orte: Endpunkte
  /** Rohe Wetter-Keyframes vor Foto-Verfeinerung — trim-abhängig; null = kein Wetter */
  wetterRoh: WetterKeyframe[] | null
}

/**
 * Signatur des Trim-Zustands: nur der Trim bewegt Start-/Zielpunkt und die
 * Zeitreihe und macht damit `orte`/`wetterRoh` ungültig. Alle anderen Edits
 * (Caption, Modus, Kamera, Audio, Momente, Titel) lassen sie unberührt.
 */
export const trimSignatur = (edits?: EditOverlay | null): string => JSON.stringify(edits?.trim ?? null)

/** Map → JSON-serialisierbares Record (Cache schreiben). */
export const mapZuRecord = <V>(m: Map<string, V> | undefined): Record<string, V> => Object.fromEntries(m ?? [])
/** Record → Map (Cache lesen). */
export const recordZuMap = <V>(r: Record<string, V> | undefined): Map<string, V> => new Map(Object.entries(r ?? {}))

/**
 * Die trim-abhängigen Roh-Ergebnisse frisch beschaffen: Endpunkte geocodieren
 * und das Auto-Wetter der (getrimmten) Strecke aus der Quelle ziehen. Beides sind
 * die externen Aufrufe — der Aufrufer (verarbeite) ruft das nur bei `frisch` oder
 * geänderter Trim-Signatur. Wirft nur, wenn der Track leer ist (wie reichereAn);
 * ein Wetterdienst-Ausfall führt zu `wetterRoh: null` (Client-Fallback).
 */
export async function berechneRohAnreicherung(e: {
  manifest: UploadManifest
  edits?: EditOverlay | null
  geocoder: Geocoder
  wetter?: WetterQuelle | null
  protokoll?: (nachricht: string) => void
}): Promise<{ orte: Endpunkte; wetterRoh: WetterKeyframe[] | null }> {
  const startMs = Date.parse(e.manifest.time.start)
  const rohSegmente = wendeEditsAufSegmenteAn(e.manifest.segments ?? [], e.edits ?? null, startMs)
  const erstes = rohSegmente[0]
  const letztes = rohSegmente[rohSegmente.length - 1]
  if (!erstes || !letztes) throw new Error('Kein Track übrig (Segmente fehlen oder der Trim entfernt alles)')
  const startPunkt = erstes.pts[0] as UploadPunkt
  const zielPunkt = letztes.pts[letztes.pts.length - 1] as UploadPunkt

  const orte = await geocodiereEndpunkte(e.geocoder, [startPunkt[0], startPunkt[1]], [zielPunkt[0], zielPunkt[1]])

  let wetterRoh: WetterKeyframe[] | null = null
  if (e.wetter) {
    try {
      wetterRoh = await berechneWetter({ reihe: baueZeitreihe(rohSegmente), startIso: e.manifest.time.start, quelle: e.wetter })
    } catch (fehler) {
      e.protokoll?.(`Auto-Wetter nicht verfügbar: ${(fehler as Error).message}`)
    }
  }
  return { orte, wetterRoh }
}
