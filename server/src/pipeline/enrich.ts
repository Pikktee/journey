// Anreicherungs-Pipeline: rendert aus dem unantastbaren Original-Upload
// (Manifest + Medien) das abspielfertige Tour-JSON (`luhambo/tour@1`).
// Umfang: Benennung, Track-Vereinfachung, Statistik, Medien-URLs, Timeline
// (nichtlineare Pseudo-Zeit, M2) und Auto-Wetter (Open-Meteo, M2).
// Später ergänzt (gleiche Stelle, gleiche Signatur): Bildanalyse (M5),
// GPX-Quelle + Medien-Platzierung (M6), Edit-Overlay (M7).

import type { UploadManifest, UploadPunkt } from '../schema/upload.js'
import { mediumDateiname } from '../schema/upload.js'
import { berechneStats, vereinfacheSegment, type TourStats } from './geo.js'
import { benenneTour, type Geocoder } from './naming.js'
import type { VideoMeta } from './video.js'
import { berechneWetter, type WetterQuelle } from './weather.js'
import { baueZeitreihe, destilliereTimeline } from './zeit.js'

export const TOUR_SCHEMA_ID = 'luhambo/tour@1'

/** Abspielfertiges Tour-JSON — bewusst nah an der cfg-Form des Players. */
export interface TourJson {
  schema: typeof TOUR_SCHEMA_ID
  id: string
  no: string
  status: 'bereit'
  brandTitle: string
  kicker: string
  titleHtml: string
  stops: string[]
  finaleTitle: string
  description: string | null
  time: { start: string; end: string; zone: string }
  segments: Array<{ mode: string; label: string; pts: Array<[number, number, number]> }>
  media: Array<{
    id: string
    type: 'photo' | 'video'
    src: string
    title: string
    caption: string
    anchor: [number, number]
    takenAt: string
    durationS?: number
    /** Video-Standbild fürs Foto-Overlay (M4) */
    poster?: string
  }>
  /** Stützstellen Streckenanteil → Pseudo-Zeit (Pausen komprimiert, M2) */
  timeline?: Array<{ f: number; t: string }>
  /** Auto-Wetter-Keyframes (M2, Open-Meteo; ab M5 auch source "photo") */
  weather?: Array<{ f: number; mode: string; k: number; source: string }>
  camera?: Array<{ f: number; preset: string }>
  audio?: Array<{ type: string; src: string; f0: number; f1: number }>
  stats: TourStats
}

const MODE_LABELS: Record<string, string> = {
  walk: 'Zu Fuß',
  bike: 'Rad',
  tram: 'Tram',
  ferry: 'Fähre',
}

const uhrzeit = (iso: string, zone: string): string => {
  try {
    return new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: zone }).format(
      new Date(iso),
    )
  } catch {
    return ''
  }
}

export interface EnrichEingabe {
  tourId: string
  /** Fortlaufende Nummer aus der DB */
  nummer: number
  manifest: UploadManifest
  /** Nutzer-Overrides aus der DB (PATCH); null = Auto-Benennung */
  titelOverride: string | null
  beschreibungOverride: string | null
  geocoder: Geocoder
  /** Auto-Wetter-Quelle; fehlt sie, bleibt `weather` weg (Client-Fallback) */
  wetter?: WetterQuelle | null
  /** Aufbereitete Video-Metadaten je Medien-ID (M4; Dauer/Poster/Auslieferungspfad) */
  videoMeta?: Map<string, VideoMeta>
  /** Hinweis-Kanal für nicht-fatale Ausfälle (z. B. Wetterdienst down) */
  protokoll?: (nachricht: string) => void
}

/**
 * Kern der Pipeline — reine Funktion über der Eingabe (I/O macht der Aufrufer:
 * Manifest lesen, tour.json schreiben, Status setzen). Dadurch vollständig
 * ohne Netz und Dateisystem testbar.
 */
export async function reichereAn(eingabe: EnrichEingabe): Promise<TourJson> {
  const { tourId, nummer, manifest, titelOverride, beschreibungOverride, geocoder, wetter, videoMeta, protokoll } =
    eingabe

  const erstesSegment = manifest.segments[0]
  const letztesSegment = manifest.segments[manifest.segments.length - 1]
  if (!erstesSegment || !letztesSegment) throw new Error('Manifest ohne Segmente')
  const startPunkt = erstesSegment.pts[0] as UploadPunkt
  const zielPunkt = letztesSegment.pts[letztesSegment.pts.length - 1] as UploadPunkt

  const benennung = await benenneTour({
    nutzerTitel: titelOverride ?? manifest.title ?? null,
    startPunkt: [startPunkt[0], startPunkt[1]],
    zielPunkt: [zielPunkt[0], zielPunkt[1]],
    zeitStart: manifest.time.start,
    zone: manifest.time.zone,
    geocoder,
  })

  // Statistik auf den ROHDATEN (volle Auflösung), Ausgabe-Punkte vereinfacht.
  const stats = berechneStats(manifest.segments)
  const segments = manifest.segments.map((seg) => ({
    mode: seg.mode,
    label: seg.label ?? MODE_LABELS[seg.mode] ?? seg.mode,
    pts: vereinfacheSegment(seg.pts).map((p): [number, number, number] => [p[0], p[1], p[2]]),
  }))

  // Medien ohne Anker bleiben in M1 außen vor (Zeit-Platzierung kommt in M6);
  // der Player kann ohne Anker nichts verorten.
  const media = manifest.media
    .filter((m) => Array.isArray(m.anchor))
    .sort((a, b) => Date.parse(a.takenAt) - Date.parse(b.takenAt))
    .map((m) => {
      // Video-Aufbereitung (M4) liefert Dauer, Poster und den Auslieferungspfad
      // (transkodiert oder Original). Fehlt sie (Foto, oder Aufbereitung fiel
      // aus), bleibt es beim Original ohne Poster.
      const meta = videoMeta?.get(m.id)
      const datei = meta?.videoDatei ?? mediumDateiname(m)
      const eintrag: TourJson['media'][number] = {
        id: m.id,
        type: m.type,
        src: `/api/media/${tourId}/${datei}`,
        title: `${m.type === 'video' ? 'Video' : 'Foto'} · ${uhrzeit(m.takenAt, manifest.time.zone)}`,
        caption: m.caption ?? '',
        anchor: m.anchor as [number, number],
        takenAt: m.takenAt,
      }
      const dauer = meta?.dauerS ?? m.durationS
      if (dauer !== undefined) eintrag.durationS = dauer
      if (meta?.posterDatei) eintrag.poster = `/api/media/${tourId}/${meta.posterDatei}`
      return eintrag
    })

  // Nichtlineare Pseudo-Zeit: Stützstellen f→Zeit mit komprimierten Pausen.
  // Auto-Wetter ist eine ANREICHERUNG, kein Muss — fällt die Quelle aus, wird
  // `weather` weggelassen und der Player nutzt sein Client-Auto-Wetter.
  const reihe = baueZeitreihe(manifest.segments)
  const timeline = destilliereTimeline(reihe, manifest.time.start)
  let weather: TourJson['weather']
  if (wetter) {
    try {
      const keyframes = await berechneWetter({ reihe, startIso: manifest.time.start, quelle: wetter })
      if (keyframes.length) weather = keyframes
    } catch (fehler) {
      protokoll?.(`Auto-Wetter nicht verfügbar (${tourId}): ${(fehler as Error).message}`)
    }
  }

  return {
    schema: TOUR_SCHEMA_ID,
    id: tourId,
    no: `N°${String(nummer).padStart(2, '0')}`,
    status: 'bereit',
    brandTitle: benennung.brandTitle,
    kicker: benennung.kicker,
    titleHtml: benennung.titleHtml,
    stops: benennung.stops,
    finaleTitle: benennung.finaleTitle,
    description: beschreibungOverride ?? manifest.description ?? null,
    time: manifest.time,
    segments,
    media,
    ...(timeline ? { timeline } : {}),
    ...(weather ? { weather } : {}),
    stats,
  }
}
