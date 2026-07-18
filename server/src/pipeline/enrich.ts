// Anreicherungs-Pipeline: rendert aus dem unantastbaren Original-Upload
// (Manifest + Medien) das abspielfertige Tour-JSON (`luhambo/tour@1`).
// Umfang: Benennung, Track-Vereinfachung, Statistik, Medien-URLs, Timeline
// (nichtlineare Pseudo-Zeit, M2) und Auto-Wetter (Open-Meteo, M2).
// Später ergänzt (gleiche Stelle, gleiche Signatur): Bildanalyse (M5),
// GPX-Quelle + Medien-Platzierung (M6), Edit-Overlay (M7).

import type { EditOverlay } from '../schema/edits.js'
import type { UploadManifest, UploadPunkt } from '../schema/upload.js'
import { mediumDateiname } from '../schema/upload.js'
import { wendeEditsAufSegmenteAn, wendeMedienEditsAn } from './edits.js'
import { berechneStats, vereinfacheSegment, type TourStats } from './geo.js'
import { benenneTour, type Geocoder } from './naming.js'
import { platziereMedien, type Platzierung } from './placement.js'
import type { VideoMeta } from './video.js'
import type { BildBefund } from './vision.js'
import { verfeinereWetterMitFotos } from './vision.js'
import { berechneWetter, type WetterQuelle } from './weather.js'
import { baueZeitreihe, destilliereTimeline, positionZurZeit } from './zeit.js'

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
    /** Anker [lng,lat] auf dem Track; null = unplatziert (Player überspringt, Editor setzt, M6/M7) */
    anchor: [number, number] | null
    /** Herkunft des Ankers (M6): gps | zeit | manuell | unplatziert */
    placement: Platzierung
    takenAt: string
    durationS?: number
    /** Video-Standbild fürs Foto-Overlay (M4) */
    poster?: string
    /** Anzeige-Optionen des Foto-Stopps aus dem Edit-Overlay (Baukasten) */
    display?: { holdS?: number; kenBurns?: boolean }
  }>
  /** Stützstellen Streckenanteil → Pseudo-Zeit (Pausen komprimiert, M2) */
  timeline?: Array<{ f: number; t: string }>
  /** Auto-Wetter-Keyframes (M2, Open-Meteo; ab M5 auch source "photo") */
  weather?: Array<{ f: number; mode: string; k: number; source: string }>
  camera?: Array<{ f: number; preset: string }>
  audio?: Array<{ type: string; src: string; f0: number; f1: number; gain?: number }>
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
  /** Edit-Overlay (M7): Trim/Modus-Grenzen/Medien-Overrides; null = keins */
  edits?: EditOverlay | null
  /** Vorhandene Audio-Dateinamen unter media/ (Baukasten) — edits.audio-Verweise ohne Datei werden übersprungen */
  audioDateien?: readonly string[]
  geocoder: Geocoder
  /** Auto-Wetter-Quelle; fehlt sie, bleibt `weather` weg (Client-Fallback) */
  wetter?: WetterQuelle | null
  /** Aufbereitete Video-Metadaten je Medien-ID (M4; Dauer/Poster/Auslieferungspfad) */
  videoMeta?: Map<string, VideoMeta>
  /** Bild-Befunde je Medien-ID (M5; vom Aufrufer per Klassifikator vorbereitet) —
   *  verfeinern das Auto-Wetter lokal am Foto-Anker. Fehlt die Map, bleibt das
   *  Wetter exakt wie in M2 (No-Op ohne konfigurierten Klassifikator). */
  bildBefunde?: Map<string, BildBefund>
  /** Hinweis-Kanal für nicht-fatale Ausfälle (z. B. Wetterdienst down) */
  protokoll?: (nachricht: string) => void
}

/**
 * Kern der Pipeline — reine Funktion über der Eingabe (I/O macht der Aufrufer:
 * Manifest lesen, tour.json schreiben, Status setzen). Dadurch vollständig
 * ohne Netz und Dateisystem testbar.
 */
export async function reichereAn(eingabe: EnrichEingabe): Promise<TourJson> {
  const {
    tourId,
    nummer,
    manifest,
    titelOverride,
    beschreibungOverride,
    edits,
    audioDateien,
    geocoder,
    wetter,
    videoMeta,
    bildBefunde,
    protokoll,
  } = eingabe

  // Segmente kommen entweder direkt aus dem Manifest oder — bei GPX-Quelle —
  // vom Aufrufer bereits geparst hineingereicht (verarbeite in tours.ts).
  // Das Edit-Overlay (M7) greift direkt danach: Trim + Modus-Grenzen formen
  // den Track, ALLES Nachgelagerte (Benennung, Timeline, Wetter, Platzierung)
  // rechnet auf dem bearbeiteten Stand.
  const startMs = Date.parse(manifest.time.start)
  const endeMs = Date.parse(manifest.time.end)
  const rohSegmente = wendeEditsAufSegmenteAn(manifest.segments ?? [], edits, startMs)
  if (!rohSegmente.length) throw new Error('Kein Track übrig (Segmente fehlen oder der Trim entfernt alles)')
  const erstesSegment = rohSegmente[0]
  const letztesSegment = rohSegmente[rohSegmente.length - 1]
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
  const stats = berechneStats(rohSegmente)
  const segments = rohSegmente.map((seg) => ({
    mode: seg.mode,
    label: seg.label ?? MODE_LABELS[seg.mode] ?? seg.mode,
    pts: vereinfacheSegment(seg.pts).map((p): [number, number, number] => [p[0], p[1], p[2]]),
  }))

  // Medien-Platzierung (M6): jedem Medium einen Track-Anker geben (GPS nah am
  // Track, sonst Zeit-Mapping, sonst unplatziert). Unplatzierte bleiben mit im
  // tour.json (fürs Studio/den Editor), der Player überspringt sie (kein Anker).
  const alleTrackpunkte = rohSegmente.flatMap((s) => s.pts)
  const media = wendeMedienEditsAn(platziereMedien(manifest.media, alleTrackpunkte, startMs), edits)
    // `|| 0`: ein (schema-durchgerutschtes) unparsebares takenAt darf die
    // Sortierung nicht in NaN-Vergleiche kippen (undefinierte Reihenfolge)
    .sort((a, b) => (Date.parse(a.medium.takenAt) || 0) - (Date.parse(b.medium.takenAt) || 0))
    .map(({ medium: m, anchor, placement }) => {
      // Video-Aufbereitung (M4) liefert Dauer, Poster und den Auslieferungspfad
      // (transkodiert oder Original). Fehlt sie (Foto, oder Aufbereitung fiel
      // aus), bleibt es beim Original ohne Poster.
      const meta = videoMeta?.get(m.id)
      const datei = meta?.videoDatei ?? mediumDateiname(m)
      // Uhrzeit im Titel NUR, wenn takenAt in der Tour-Zeitspanne liegt —
      // mtime-Fallback-Zeiten tourfremder Dateien sind Unsinn (Bughunt-Befund).
      const takenMs = Date.parse(m.takenAt)
      const art = m.type === 'video' ? 'Video' : 'Foto'
      const inSpanne = Number.isFinite(takenMs) && takenMs >= startMs && takenMs <= endeMs
      const eintrag: TourJson['media'][number] = {
        id: m.id,
        type: m.type,
        src: `/api/media/${tourId}/${datei}`,
        title: inSpanne ? `${art} · ${uhrzeit(m.takenAt, manifest.time.zone)}` : art,
        caption: m.caption ?? '',
        anchor,
        placement,
        takenAt: m.takenAt,
      }
      const dauer = meta?.dauerS ?? m.durationS
      if (dauer !== undefined) eintrag.durationS = dauer
      if (meta?.posterDatei) eintrag.poster = `/api/media/${tourId}/${meta.posterDatei}`
      // Anzeige-Optionen aus dem Overlay (Baukasten) — nur wenn dort gesetzt
      const display = edits?.medien?.[m.id]?.display
      if (display) eintrag.display = display
      return eintrag
    })

  // Nichtlineare Pseudo-Zeit: Stützstellen f→Zeit mit komprimierten Pausen.
  // Auto-Wetter ist eine ANREICHERUNG, kein Muss — fällt die Quelle aus, wird
  // `weather` weggelassen und der Player nutzt sein Client-Auto-Wetter.
  const reihe = baueZeitreihe(rohSegmente)
  const timeline = destilliereTimeline(reihe, manifest.time.start)

  // Kamera-Keyframes (Baukasten): absolute `ab`-Zeiten → Streckenanteil f über
  // die Zeitreihe des GETRIMMTEN Tracks (tSek relativ zu manifest.time.start,
  // exakt wie die tOffsets der Punkte). positionZurZeit klemmt außerhalb —
  // eine Grenze vor dem Trim-Start landet auf f des Track-Anfangs (gewollt:
  // „gilt ab hier" bleibt auch nach dem Beschneiden wahr).
  let camera: TourJson['camera']
  if (edits?.kamera?.length) {
    // Eine Grenze HINTER dem (getrimmten) Track-Ende würde auf f=1 geklemmt —
    // die Kamera schaltete dann sichtbar exakt am Finale um, wo die Grenze nie
    // gemeint war → verwerfen. Vor dem Start bleibt die Klemmung („gilt ab hier").
    const trackEndeSek = reihe.punkte[reihe.punkte.length - 1]?.tSek
    const keyframes = edits.kamera
      .map((g) => ({ abMs: Date.parse(g.ab), preset: g.preset }))
      .filter((g) => Number.isFinite(g.abMs))
      .filter((g) => {
        if (trackEndeSek === undefined || (g.abMs - startMs) / 1000 <= trackEndeSek) return true
        protokoll?.(`Kamera-Grenze hinter dem Track-Ende übersprungen (${g.preset})`)
        return false
      })
      // positionZurZeit ist monoton in der Zeit → nach `ab` sortiert ist auch
      // f sortiert; bei gleichem f gewinnt unten der spätere `ab`.
      .sort((a, b) => a.abMs - b.abMs)
      .map((g) => ({ f: positionZurZeit(reihe, (g.abMs - startMs) / 1000).f, preset: g.preset }))
    const dedupliziert: NonNullable<TourJson['camera']> = []
    for (const k of keyframes) {
      const letzter = dedupliziert[dedupliziert.length - 1]
      if (letzter && letzter.f === k.f) letzter.preset = k.preset
      else dedupliziert.push(k)
    }
    if (dedupliziert.length) camera = dedupliziert
  }

  // Audio-Spuren (Baukasten): absolute Zeiten → f-Bereiche. Fehlende Dateien
  // und Bereiche, die der Trim vollständig entfernt hat, werden mit Warnung
  // übersprungen — ein kaputter Verweis darf den Render nie scheitern lassen.
  let audio: TourJson['audio']
  if (edits?.audio?.length) {
    const vorhandene = new Set(audioDateien ?? [])
    const ersterPunkt = reihe.punkte[0]
    const letzterPunkt = reihe.punkte[reihe.punkte.length - 1]
    const spuren: NonNullable<TourJson['audio']> = []
    for (const spur of edits.audio) {
      if (!vorhandene.has(spur.datei)) {
        protokoll?.(`Audio-Datei fehlt: ${spur.datei}`)
        continue
      }
      const tAb = (Date.parse(spur.ab) - startMs) / 1000
      const f0 = positionZurZeit(reihe, tAb).f
      let f1: number
      if (spur.typ === 'musik') {
        f1 = spur.bis !== undefined ? positionZurZeit(reihe, (Date.parse(spur.bis) - startMs) / 1000).f : 1
        // Leere Spanne (z. B. komplett vor den Trim-Start geklemmt) → weg damit
        if (f1 <= f0) {
          protokoll?.(`Audio außerhalb des Tracks übersprungen: ${spur.datei}`)
          continue
        }
      } else {
        // SFX: One-Shot exakt bei f0. Liegt `ab` außerhalb des (getrimmten)
        // Tracks, würde die Klemmung den Knall an den Tour-Start/-Ende legen,
        // wo er nie gemeint war → überspringen.
        if (ersterPunkt && letzterPunkt && (tAb < ersterPunkt.tSek || tAb > letzterPunkt.tSek)) {
          protokoll?.(`Audio außerhalb des Tracks übersprungen: ${spur.datei}`)
          continue
        }
        f1 = f0
      }
      spuren.push({
        type: spur.typ === 'musik' ? 'music' : 'sfx',
        src: `/api/media/${tourId}/${spur.datei}`,
        f0,
        f1,
        ...(spur.lautstaerke !== undefined ? { gain: spur.lautstaerke } : {}),
      })
    }
    spuren.sort((a, b) => a.f0 - b.f0)
    if (spuren.length) audio = spuren
  }

  let weather: TourJson['weather']
  if (wetter) {
    try {
      let keyframes = await berechneWetter({ reihe, startIso: manifest.time.start, quelle: wetter })
      // Bildanalyse (M5): platzierte Fotos mit Befund lokal auf ihre f-Position
      // abbilden (Aufnahmezeit → Zeitreihe, wie die Kamera-Keyframes) und das
      // API-Wetter dort verfeinern. Ohne Befunde bleibt `keyframes` unberührt.
      if (keyframes.length && bildBefunde?.size) {
        const fotos: Array<{ f: number; befund: BildBefund }> = []
        for (const m of media) {
          if (m.type !== 'photo' || m.anchor === null) continue // nur platzierte Fotos
          const befund = bildBefunde.get(m.id)
          if (!befund) continue
          const tSek = (Date.parse(m.takenAt) - startMs) / 1000
          if (!Number.isFinite(tSek)) continue
          fotos.push({ f: positionZurZeit(reihe, tSek).f, befund })
        }
        if (fotos.length) keyframes = verfeinereWetterMitFotos(keyframes, fotos)
      }
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
    ...(camera ? { camera } : {}),
    ...(audio ? { audio } : {}),
    stats,
  }
}
