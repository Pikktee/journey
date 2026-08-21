// Anreicherungs-Pipeline: rendert aus dem unantastbaren Original-Upload
// (Manifest + Medien) das abspielfertige Tour-JSON (`maptale/tour@2`).
// Umfang: Benennung, Track-Vereinfachung, Statistik, Medien-URLs, Timeline
// (nichtlineare Pseudo-Zeit, M2) und Auto-Wetter (Open-Meteo, M2).
// Später ergänzt (gleiche Stelle, gleiche Signatur): Bildanalyse (M5),
// GPX-Quelle + Medien-Platzierung (M6), Edit-Overlay (M7).

import { STUDIO_GAIN, type EditOverlay, type CameraMomentKind } from '../schema/edits.js'
import type { UploadManifest, UploadPoint } from '../schema/upload.js'
import { mediumFilename } from '../schema/upload.js'
import { applyEditsToSegments, applyMediaEdits } from './edits.js'
import {
  type AxisStop,
  buildAxisStops,
  buildFilmAxis,
  buildMomentStops,
  filmTimeAtRecordingTime,
  projectOntoTimeSeries,
  recordingTimeAtFilmTime,
} from './film-axis.js'
import { computeStats, simplifyIndices, type TourStats } from './geo.js'
import { buildSignature } from './signature.js'
import { buildNaming, nameTour, type Naming, type Endpoints, type Geocoder } from './naming.js'
import { placeMedia, type Placement } from './placement.js'
import type { PhotoMeta } from './image.js'
import type { VideoMeta } from './video.js'
import type { ImageFinding } from './vision.js'
import { refineWeatherWithPhotos } from './vision.js'
import {
  computeWeather,
  weatherFromOverlay,
  type WeatherKeyframe,
  type WeatherSource,
} from './weather.js'
import { buildTimeSeries, distillTimeline, positionAtTime } from './time.js'

export const TOUR_SCHEMA_ID = 'maptale/tour@2'

/** Abspielfertiges Tour-JSON — bewusst nah an der cfg-Form des Players. */
export interface TourJson {
  schema: typeof TOUR_SCHEMA_ID
  id: string
  no: string
  status: 'ready'
  brandTitle: string
  kicker: string
  titleHtml: string
  stops: string[]
  /** Ob der Player den „Ziel erreicht"-Screen zeigt (sonst zurück zum Start) */
  showFinale: boolean
  finaleTitle: string
  description: string | null
  time: { start: string; end: string; zone: string }
  segments: Array<{
    mode: string
    label: string
    pts: Array<[number, number, number]>
    /**
     * Streckenanteil je Punkt von `pts`, auf der ROHEN Geometrie gemessen (E11).
     * Damit übersetzt der Player jeden `f`-Anker exakt in seine Streckenmeter,
     * statt `f × route.total` zu rechnen. Fehlt bei Touren, die vor E11
     * gerendert wurden — dort bleibt es beim Rückfall.
     */
    f?: number[]
  }>
  media: Array<{
    id: string
    type: 'photo' | 'video'
    src: string
    title: string
    caption: string
    /** Anker [lng,lat] auf dem Track; null = unplatziert (Player überspringt, Editor setzt, M6/M7) */
    anchor: [number, number] | null
    /** Herkunft des Ankers (M6): gps | time | manual | unplaced */
    placement: Placement
    takenAt: string
    durationS?: number
    /** Video-Standbild fürs Foto-Overlay (M4) */
    poster?: string
    /** Kachel-Fassung für Listen und Zeitleiste (image.ts); fehlt bei Altbestand */
    thumb?: string
    /** Anzeige-Optionen des Foto-Stopps aus dem Edit-Overlay (Baukasten) */
    display?: { holdS?: number; kenBurns?: boolean }
    /** Platz innerhalb des Foto-Stopps (0-basiert, aus dem Edit-Overlay) */
    order?: number
  }>
  /** Stützstellen Streckenanteil → Pseudo-Zeit (Pausen komprimiert, M2) */
  timeline?: Array<{ f: number; t: string }>
  /** Auto-Wetter-Keyframes (M2, Open-Meteo; ab M5 auch source "photo") */
  weather?: Array<{ f: number; mode: string; k: number; source: string }>
  /**
   * Kamera-Keyframes. `f` ist der Streckenanteil, `filmS` die Filmsekunde
   * (E10) — der Player nimmt `filmS`, wo es steht, sonst `f` wie bisher.
   */
  camera?: Array<{ f: number; preset: string; scale?: number; filmS?: number }>
  /**
   * Kamera-Momente. `filmS` ist hier eine AUSKUNFT: Der Player verankert einen
   * Moment weiter an `f`, weil die Film-Achse aus den Momenten gebaut wird.
   */
  moments?: Array<{ f: number; kind: string; durationS?: number; filmS?: number }>
  audio?: Array<{
    type: string
    src: string
    f0: number
    f1: number
    gain?: number
    /** Wiederholung; fehlt = Vorgabe des Players (Musik loopt, SFX nicht) */
    loop?: boolean
    /** Einstieg in die Datei (s) — Start-Seek beim Eintritt in den Bereich */
    startS?: number
    /**
     * Filmsekunde des Einsatzes (E10) — geht `f0` vor. Sie ist die einzige
     * Größe, die einen Klip MITTEN in einer Standzeit verorten kann: Dort läuft
     * der Film, während die Strecke steht, und jedes `f` fällt auf die
     * Halt-Kante.
     */
    filmS?: number
    /** Filmsekunde des Endes; nur bei Bereichen (ein One-Shot hat keine) */
    filmToS?: number
  }>
  stats: TourStats
}

// Alle Modi aus TRAVEL_MODES (schema/upload.ts) — fehlt einer, zeigt der Player den
// rohen Schlüssel („moped" statt „Moped").
const MODE_LABELS: Record<string, string> = {
  walk: 'Zu Fuß',
  bike: 'Rad',
  moped: 'Moped',
  jeep: 'Jeep',
  tram: 'Tram',
  ferry: 'Fähre',
}

/** Titelbild in zwei Größen: groß für Detailansichten, Kachel für Listen. */
export interface Cover {
  /** Anzeigegröße (Foto-Fassung bzw. Video-Standbild) */
  cover: string
  /** Kachel-Fassung; null bei Altbestand ohne aufbereitete Fassungen */
  thumb: string | null
}

/**
 * Titelbild einer fertig gerenderten Tour. Die Wahl des Nutzers
 * (`edits.cover`) gewinnt; zeigt sie ins Leere (gelöschtes oder unbekanntes
 * Medium), wird still das erste platzierte Foto genommen. Ein Video taugt nur
 * mit Standbild.
 *
 * Beide Größen kommen aus DERSELBEN Wahl — eine zweite Funktion mit eigener
 * Reihenfolge liefe irgendwann auseinander und zeigte in der Liste ein anderes
 * Bild als in der Ansicht.
 */
export function chooseCover(media: TourJson['media'], cover2?: string): Cover | null {
  const chosen = cover2 ? media.find((m) => m.id === cover2) : undefined
  const asCover = (m: TourJson['media'][number] | undefined): Cover | null => {
    if (!m) return null
    const big = m.type === 'photo' ? m.src : m.poster
    return big ? { cover: big, thumb: m.thumb ?? null } : null
  }
  return (
    asCover(chosen) ??
    asCover(media.find((m) => m.type === 'photo' && m.anchor)) ??
    asCover(media.find((m) => m.type === 'video' && m.anchor && m.poster)) ??
    // Auch ein unplatziertes Foto ist ein besseres Titelbild als gar keins
    asCover(media.find((m) => m.type === 'photo'))
  )
}

const clockTime = (iso: string, zone: string): string => {
  try {
    return new Intl.DateTimeFormat('de-DE', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: zone,
    }).format(new Date(iso))
  } catch {
    return ''
  }
}

export interface EnrichmentInput {
  tourId: string
  /** Fortlaufende Nummer aus der DB */
  no: number
  manifest: UploadManifest
  /** Nutzer-Overrides aus der DB (PATCH); null = Auto-Benennung */
  titleOverride: string | null
  descriptionOverride: string | null
  /**
   * Die Dachzeile über dem Titel. `null` = nie gesetzt (Vorbelegung greift),
   * leerer String = ausdrücklich keine Zeile (s. buildNaming).
   */
  kickerOverride?: string | null
  /** Endscreen zeigen? Default false — die meisten Touren haben kein konkretes Ziel */
  showFinale?: boolean
  /** Zielname für den Endscreen; null/leer = geocodierter Ortsname */
  finaleTargetOverride?: string | null
  /** Edit-Overlay (M7): Trim/Modus-Grenzen/Medien-Overrides; null = keins */
  edits?: EditOverlay | null
  /** Vorhandene Audio-Dateinamen unter media/ (Baukasten) — edits.audio-Verweise ohne Datei werden übersprungen */
  audioFiles?: readonly string[]
  /** Dateinamen der benutzerweiten Audio-Bibliothek des Tour-Eigentümers
   *  (quelle 'benutzer') — Verweise ohne Datei werden ebenso übersprungen */
  userAudioFiles?: readonly string[]
  /** Geocoder für die Auto-Benennung. Optional: ist `places` vorgegeben (Cache),
   *  wird NICHT geocodiert und der Geocoder nicht gebraucht. */
  geocoder?: Geocoder
  /** Vorgegebene Ortsnamen aus dem Anreicherungs-Cache. Ist es gesetzt, wird die
   *  Benennung daraus + dem aktuellen Titel lokal gebaut (kein Netz). */
  places?: Endpoints
  /** Auto-Wetter-Quelle; fehlt sie, bleibt `weather` weg (Client-Fallback) */
  weatherSource?: WeatherSource | null
  /** Vorgegebene rohe Wetter-Keyframes aus dem Cache. `undefined` = aus der
   *  Quelle berechnen; `null`/`[]` = kein Auto-Wetter. Die Foto-Verfeinerung
   *  (M5) läuft danach IMMER lokal, weil sie an den platzierten Fotos hängt. */
  weatherRaw?: WeatherKeyframe[] | null
  /** Aufbereitete Video-Metadaten je Medien-ID (M4; Dauer/Poster/Auslieferungspfad) */
  videoMeta?: Map<string, VideoMeta>
  /** Aufbereitete Bild-Fassungen je Medien-ID (image.ts; Anzeige + Kachel).
   *  Fehlt der Eintrag, bleibt es beim Original — so bleibt Altbestand spielbar. */
  photoMeta?: Map<string, PhotoMeta>
  /** Bild-Befunde je Medien-ID (M5; vom Aufrufer per Klassifikator vorbereitet) —
   *  verfeinern das Auto-Wetter lokal am Foto-Anker. Fehlt die Map, bleibt das
   *  Wetter exakt wie in M2 (No-Op ohne konfigurierten Klassifikator). */
  imageFindings?: Map<string, ImageFinding>
  /** Hinweis-Kanal für nicht-fatale Ausfälle (z. B. Wetterdienst down) */
  log?: (message: string) => void
}

/**
 * Kern der Pipeline — reine Funktion über der Eingabe (I/O macht der Aufrufer:
 * Manifest lesen, tour.json schreiben, Status setzen). Dadurch vollständig
 * ohne Netz und Dateisystem testbar.
 */
export async function enrichTour(input: EnrichmentInput): Promise<TourJson> {
  const {
    tourId,
    no,
    manifest,
    titleOverride,
    descriptionOverride,
    kickerOverride,
    showFinale = false,
    finaleTargetOverride = null,
    edits,
    audioFiles,
    userAudioFiles,
    geocoder,
    places,
    weatherSource,
    weatherRaw,
    videoMeta,
    photoMeta,
    imageFindings,
    log,
  } = input

  // Segmente kommen entweder direkt aus dem Manifest oder — bei GPX-Quelle —
  // vom Aufrufer bereits geparst hineingereicht (processTour in tours.ts).
  // Das Edit-Overlay (M7) greift direkt danach: Trim + Modus-Grenzen formen
  // den Track, ALLES Nachgelagerte (Benennung, Timeline, Wetter, Platzierung)
  // rechnet auf dem bearbeiteten Stand.
  const startMs = Date.parse(manifest.time.start)
  const endMs = Date.parse(manifest.time.end)
  const rawSegments = applyEditsToSegments(manifest.segments ?? [], edits, startMs)
  if (!rawSegments.length)
    throw new Error('Kein Track übrig (Segmente fehlen oder der Trim entfernt alles)')
  const firstSegment = rawSegments[0]
  const lastSegment = rawSegments[rawSegments.length - 1]
  if (!firstSegment || !lastSegment) throw new Error('Manifest ohne Segmente')
  const startPoint = firstSegment.pts[0] as UploadPoint
  const endPoint = lastSegment.pts[lastSegment.pts.length - 1] as UploadPoint

  // Benennung: bevorzugt aus gecachten Ortsnamen + aktuellem Titel lokal bauen
  // (kein Netz); nur ohne Cache wird direkt geocodiert (Direktaufruf/Test).
  const userTitle = titleOverride ?? manifest.title ?? null
  let naming: Naming
  if (places) {
    naming = buildNaming({
      ...places,
      userTitle,
      kickerText: kickerOverride ?? null,
      timeStart: manifest.time.start,
      zone: manifest.time.zone,
    })
  } else {
    if (!geocoder) throw new Error('reichereAn: weder places noch geocoder übergeben')
    naming = await nameTour({
      userTitle,
      kickerText: kickerOverride ?? null,
      startPoint: [startPoint[0], startPoint[1]],
      endPoint: [endPoint[0], endPoint[1]],
      timeStart: manifest.time.start,
      zone: manifest.time.zone,
      geocoder,
    })
  }

  // Zeitreihe der ROHEN (getrimmten) Punkte: Sie trägt die kumulierte Distanz,
  // aus der jedes `f` dieses Tour-JSONs entsteht — Timeline, Kamera-Keyframes,
  // Ton-Bereiche, Wetter UND seit E11 der Wegpunkt selbst.
  const series = buildTimeSeries(rawSegments)

  // Statistik auf den ROHDATEN (volle Auflösung), Ausgabe-Punkte vereinfacht.
  const stats = computeStats(rawSegments)
  // Je ausgeliefertem Wegpunkt sein `f` (E11, Gleichlauf-Konzept §8D). Ohne das
  // Feld muss der Player `f × route.total` rechnen — und seine Route ist durch
  // Catmull-Rom + 14-m-Resampling 2,2–3,0 % länger als die Rohgeometrie, in der
  // hier gemessen wird, UNGLEICHMÄSSIG verteilt. Der Rest ist nicht clientseitig
  // zu beheben: `simplifySegment` wirft Punkte weg, die Länge tragen.
  // Das Feld ist additiv — Bestandstouren bekommen es
  // bei ihrem nächsten Render.
  let pointIndex = 0
  const segments = rawSegments.map((seg) => {
    const base = pointIndex
    pointIndex += seg.pts.length
    const indices = simplifyIndices(seg.pts)
    const entry: TourJson['segments'][number] = {
      mode: seg.mode,
      label: seg.label ?? MODE_LABELS[seg.mode] ?? seg.mode,
      pts: indices.map((i): [number, number, number] => {
        const p = seg.pts[i] as UploadPoint
        return [p[0], p[1], p[2]]
      }),
    }
    // gesamtM = 0 gibt es nur bei einer Tour ohne Ausdehnung — dort wäre jedes
    // `f` eine Null-Division, und der Rückfall im Player ist genauso gut.
    if (series.totalM > 0) {
      // GERUNDET, und das ist kein Kosmetik-Schritt: Roh serialisiert JSON jede
      // Zahl mit bis zu 17 signifikanten Stellen (`0.057312851865195705`), also
      // ~21 Zeichen je Punkt. Auf der größten lokalen Tour sind das +19,8 % auf
      // das `tour.json` — mehr als die +17,8 %, mit denen das Gleichlauf-Konzept
      // den Export der Filmachse ABLEHNT (§12). Acht Nachkommastellen kosten
      // +11,2 % und sind absurd genau: Bei 41,8 km Streckenlänge entspricht
      // 1e-8 einem Weg von 0,4 mm.
      entry.f = indices.map((i) =>
        Number(((series.points[base + i]?.dist ?? 0) / series.totalM).toFixed(8)),
      )
    }
    return entry
  })

  // Medien-Platzierung (M6): jedem Medium einen Track-Anker geben (GPS nah am
  // Track, sonst Zeit-Mapping, sonst unplatziert). Unplatzierte bleiben mit im
  // tour.json (fürs Studio/den Editor), der Player überspringt sie (kein Anker).
  const allTrackPoints = rawSegments.flatMap((s) => s.pts)
  const media = applyMediaEdits(placeMedia(manifest.media, allTrackPoints, startMs), edits)
    // `|| 0`: ein (schema-durchgerutschtes) unparsebares takenAt darf die
    // Sortierung nicht in NaN-Vergleiche kippen (undefinierte Reihenfolge)
    .sort((a, b) => (Date.parse(a.medium.takenAt) || 0) - (Date.parse(b.medium.takenAt) || 0))
    .map(({ medium: m, anchor, placement }) => {
      // Video-Aufbereitung (M4) liefert Dauer, Poster und den Auslieferungspfad
      // (transkodiert oder Original). Fehlt sie (Foto, oder Aufbereitung fiel
      // aus), bleibt es beim Original ohne Poster.
      const meta = videoMeta?.get(m.id)
      // Fotos werden in einer Anzeige-Fassung ausgeliefert (image.ts); das
      // Original ist danach verworfen. Ohne Fassung — Altbestand oder
      // fehlgeschlagene Aufbereitung — bleibt der Originalname stehen.
      const variants = photoMeta?.get(m.id)
      const file = meta?.videoFile ?? variants?.displayFile ?? mediumFilename(m)
      // Der Nutzertext ist der TITEL der Aufnahme, und er ist der einzige Text,
      // den eine Aufnahme trägt.
      //
      // Bis zum 2026-08-18 standen hier zwei erfundene Texte: „Foto · 09:09" als
      // Titel, wenn keiner gesetzt war, und die Uhrzeit als `caption`. Beide
      // sind weg. „Foto" war die eine Auskunft, die man dem Bild ansieht, und
      // sie stand in der größten Schrift der Karte. Die Uhrzeit ist eine ANGABE
      // und keine Bildunterschrift — der Player setzt sie aus `takenAt` neben
      // den Kilometerstand, genau wie der Editor (src/ui.ts).
      //
      // `caption` bleibt im Schema und ist seither IMMER leer: Die Foto-Karte
      // hat keine Bildunterschrift mehr (ein Halt steht 5,2 s, die kuratierten
      // Texte waren im Median 84 Zeichen — wer sie las, sah das Bild nicht).
      // Das Feld bleibt nur, weil Bestandstouren es tragen.
      const userText = m.caption?.trim() ?? ''
      const entry: TourJson['media'][number] = {
        id: m.id,
        type: m.type,
        src: `/api/media/${tourId}/${file}`,
        title: userText,
        caption: '',
        anchor,
        placement,
        takenAt: m.takenAt,
      }
      const duration = meta?.durationS ?? m.durationS
      if (duration !== undefined) entry.durationS = duration
      if (meta?.posterFile) entry.poster = `/api/media/${tourId}/${meta.posterFile}`
      if (variants?.thumbFile) entry.thumb = `/api/media/${tourId}/${variants.thumbFile}`
      // Anzeige-Optionen aus dem Overlay (Baukasten) — nur wenn dort gesetzt
      const display = edits?.media?.[m.id]?.display
      if (display) entry.display = display
      // Platz im Foto-Stopp: wirkt erst im Player, wo die Gruppierung entsteht
      const series = edits?.media?.[m.id]?.order
      if (series !== undefined) entry.order = series
      return entry
    })

  // Nichtlineare Pseudo-Zeit: Stützstellen f→Zeit mit komprimierten Pausen.
  // Auto-Wetter ist eine ANREICHERUNG, kein Muss — fällt die Quelle aus, wird
  // `weather` weggelassen und der Player nutzt sein Client-Auto-Wetter.
  const timeline = distillTimeline(series, manifest.time.start)

  // Kamera-Keyframes (Baukasten): absolute `ab`-Zeiten → Streckenanteil f über
  // die Zeitreihe des GETRIMMTEN Tracks (tSek relativ zu manifest.time.start,
  // exakt wie die tOffsets der Punkte). positionZurZeit klemmt außerhalb —
  // eine Grenze vor dem Trim-Start landet auf f des Track-Anfangs (gewollt:
  // „gilt ab hier" bleibt auch nach dem Beschneiden wahr).
  // Kamera-Momente: Punkt-Ereignisse. Wie Kamera-Grenzen an f verankert; ein
  // Moment hinter dem (getrimmten) Track-Ende ergibt keinen Sinn → verwerfen.
  //
  // Sie stehen VOR der Achse, weil sie zu ihr gehören: Ein Moment hält den Film
  // an, seine Standzeit ist Achsenbreite. Ein hinter dem Track-Ende verworfener
  // Moment darf die Achse nicht verlängern — deshalb ist es genau die gefilterte
  // Liste, die unten in die Halte geht.
  let momentStops: AxisStop[] = []
  let filteredMoments: Array<{
    offsetS: number
    kind: CameraMomentKind
    durationS: number | undefined
  }> = []
  if (edits?.moments?.length) {
    const trackEndSec = series.points[series.points.length - 1]?.tSec
    filteredMoments = edits.moments
      .map((m) => ({
        offsetS: (Date.parse(m.from) - startMs) / 1000,
        kind: m.kind,
        durationS: m.durationS,
      }))
      .filter((m) => Number.isFinite(m.offsetS))
      .filter((m) => {
        if (trackEndSec === undefined || m.offsetS <= trackEndSec) return true
        log?.(`Kamera-Moment hinter dem Track-Ende übersprungen (${m.kind})`)
        return false
      })
      .sort((a, b) => a.offsetS - b.offsetS)
    momentStops = buildMomentStops(
      filteredMoments.map((m) => ({ offsetS: m.offsetS, kind: m.kind, durationS: m.durationS })),
    )
  }

  /**
   * Die Film-Achse der Tour — Aufnahmezeit ↔ Strecke ↔ Filmsekunde.
   *
   * Sie stand bis E10 im Audio-Block und wurde nur gebaut, wenn ein Klip die
   * neuen Anker-Felder benutzte. Seit E10 bekommt JEDES Ereignis seine
   * Filmsekunde mit ins Tour-JSON (Ton-Klips, Kamera-Keyframes, Momente), also
   * braucht sie jeder Zweig — einmal gebaut, von allen gelesen.
   *
   * Ihre Halte sind die Aufnahmen (Standzeit + Ausblendung) und die Momente;
   * exakt dieselben, mit denen der Player seine Achse baut (src/film-axis.ts).
   * `null` nur bei einer degenerierten Tour ohne Zeitreihe — dann bleibt es
   * überall beim reinen `f`, also beim Verhalten von vorher.
   */
  const axis =
    series.points.length > 0
      ? buildFilmAxis(series, [
          ...buildAxisStops(
            media
              .filter((m) => m.anchor)
              .map((m) => {
                const place = projectOntoTimeSeries(
                  series,
                  (m.anchor as [number, number])[0],
                  (m.anchor as [number, number])[1],
                )
                return {
                  type: m.type,
                  meters: place.meters,
                  offsetS: place.offsetS,
                  ...(m.durationS !== undefined ? { durationS: m.durationS } : {}),
                  ...(m.display ? { display: m.display } : {}),
                }
              }),
          ),
          // Momente halten den Film genauso an wie eine Aufnahme — im Studio
          // kosten sie längst Achsenbreite (achsenHalte in editor.ts). Fehlten
          // sie hier, klänge jeder Ton-Klip, dessen Versatz über einen Moment
          // reicht, im Render an einer anderen Stelle als im Editor.
          ...momentStops,
        ])
      : null

  /**
   * Filmsekunde eines Ereignisses fürs Tour-JSON — gerundet wie `segments[].f`.
   *
   * Acht Nachkommastellen, aus demselben Grund wie dort: Roh serialisiert JSON
   * bis zu 17 signifikante Stellen, und ein Feld je Ereignis kostete damit mehr
   * als die Filmachse, deren Export das Gleichlauf-Konzept ausdrücklich ablehnt
   * (§12). Ohne Achse gibt es keine Filmsekunde — dann bleibt das Feld weg und
   * der Player rechnet wie bisher aus `f`.
   */
  const filmNumber = (filmS: number): number => Number(filmS.toFixed(8))
  const filmField = (tSek: number): number | undefined =>
    axis ? filmNumber(filmTimeAtRecordingTime(axis, tSek)) : undefined

  let camera: TourJson['camera']
  if (edits?.camera?.length) {
    // Eine Grenze HINTER dem (getrimmten) Track-Ende würde auf f=1 geklemmt —
    // die Kamera schaltete dann sichtbar exakt am Finale um, wo die Grenze nie
    // gemeint war → verwerfen. Vor dem Start bleibt die Klemmung („gilt ab hier").
    const trackEndSec = series.points[series.points.length - 1]?.tSec
    const keyframes = edits.camera
      .map((g) => ({ abMs: Date.parse(g.from), preset: g.preset, scale: g.scale }))
      .filter((g) => Number.isFinite(g.abMs))
      .filter((g) => {
        if (trackEndSec === undefined || (g.abMs - startMs) / 1000 <= trackEndSec) return true
        log?.(`Kamera-Grenze hinter dem Track-Ende übersprungen (${g.preset})`)
        return false
      })
      // positionZurZeit ist monoton in der Zeit → nach `ab` sortiert ist auch
      // f sortiert; bei gleichem f gewinnt unten der spätere `ab`.
      .sort((a, b) => a.abMs - b.abMs)
      .map((g) => {
        const tSek = (g.abMs - startMs) / 1000
        const filmS = filmField(tSek)
        return {
          f: positionAtTime(series, tSek).f,
          preset: g.preset,
          ...(g.scale !== undefined && g.scale !== 1 ? { scale: g.scale } : {}),
          ...(filmS !== undefined ? { filmS } : {}),
        }
      })
    const deduped: NonNullable<TourJson['camera']> = []
    for (const k of keyframes) {
      const last = deduped[deduped.length - 1]
      if (last && last.f === k.f) {
        last.preset = k.preset
        if (k.scale !== undefined) last.scale = k.scale
        else delete last.scale
        // Der spätere Keyframe gewinnt — auch mit seiner Filmsekunde. Bei
        // gleichem `f` können sie sich unterscheiden: genau dann, wenn beide
        // in derselben Standzeit liegen.
        if (k.filmS !== undefined) last.filmS = k.filmS
      } else deduped.push(k)
    }
    if (deduped.length) camera = deduped
  }

  let moments: TourJson['moments']
  if (filteredMoments.length) {
    moments = filteredMoments.map((m) => {
      const filmS = filmField(m.offsetS)
      return {
        f: positionAtTime(series, m.offsetS).f,
        kind: m.kind,
        ...(m.durationS !== undefined ? { durationS: m.durationS } : {}),
        // Die Filmsekunde des Moments ist eine AUSKUNFT, kein Eingang: Der
        // Player verankert ihn weiter an `f`, weil die Achse aus den Momenten
        // gebaut wird und ein Moment über sie zu verorten ein Kreis wäre
        // (s. src/main.ts). Sie steht hier, damit ein Leser des Tour-JSON
        // dieselbe Filmzeit sieht wie Editor und Player.
        ...(filmS !== undefined ? { filmS } : {}),
      }
    })
  }

  // Audio-Spuren (Baukasten): absolute Zeiten → f-Bereiche. Fehlende Dateien
  // und Bereiche, die der Trim vollständig entfernt hat, werden mit Warnung
  // übersprungen — ein kaputter Verweis darf den Render nie scheitern lassen.
  let audio: TourJson['audio']
  if (edits?.audio?.length) {
    const available = new Set(audioFiles ?? [])
    const userAvailable = new Set(userAudioFiles ?? [])
    const firstPoint = series.points[0]
    const lastPoint = series.points[series.points.length - 1]
    /** Streckenanteil zu einer Filmsekunde (über die Achse zurück in die Zeit). */
    const fAtFilm = (filmS: number): number =>
      positionAtTime(series, recordingTimeAtFilmTime(axis as NonNullable<typeof axis>, filmS)).f
    const tracks: NonNullable<TourJson['audio']> = []
    for (const track of edits.audio) {
      const fromLibrary = track.source === 'library'
      const fromUserLibrary = track.source === 'user'
      // Tour-lokale Dateien müssen unter media/ liegen, Benutzer-Uploads in der
      // Bibliothek des Eigentümers; kuratierte Effekte sind global
      // (public/audio/sfx/) und werden hier nicht geprüft.
      if (!fromLibrary && !fromUserLibrary && !available.has(track.file)) {
        log?.(`Audio-Datei fehlt: ${track.file}`)
        continue
      }
      if (fromUserLibrary && !userAvailable.has(track.file)) {
        log?.(`Bibliotheks-Audio fehlt: ${track.file}`)
        continue
      }
      // Die Film-Verankerung gilt nur, wenn sie auch benutzt wird UND die Achse
      // steht (eine degenerierte Tour hat keine). Sonst der Weg von vorher —
      // Bestands-Overlays laufen dadurch buchstäblich durch denselben Code.
      const filmAnchored =
        axis !== null &&
        (track.anchor !== undefined ||
          track.offsetFilmS !== undefined ||
          track.durationFilmS !== undefined)
      const tAb = (Date.parse(track.anchor ?? track.from) - startMs) / 1000
      const tBis = track.to !== undefined ? (Date.parse(track.to) - startMs) / 1000 : undefined
      let f0: number
      let f1: number
      // Die Filmsekunden des Klips (E10) — die eigentliche Auskunft, seit der
      // Player in Filmzeit rechnet. `undefined` nur ohne Achse.
      let filmFromS: number | undefined
      let filmToS: number | undefined
      if (filmAnchored) {
        // Anker → Filmsekunde → Versatz drauf → zurück in Zeit und Anteil.
        const filmFrom = filmTimeAtRecordingTime(axis, tAb) + (track.offsetFilmS ?? 0)
        f0 = fAtFilm(filmFrom)
        filmFromS = filmFrom
        if (track.durationFilmS !== undefined) {
          filmToS = filmFrom + track.durationFilmS
          f1 = fAtFilm(filmToS)
        } else if (track.type === 'music') {
          filmToS = tBis !== undefined ? filmTimeAtRecordingTime(axis, tBis) : axis.totalS
          f1 = tBis !== undefined ? positionAtTime(series, tBis).f : 1
        } else {
          filmToS = filmFrom
          f1 = f0
        }
      } else {
        f0 = positionAtTime(series, tAb).f
        filmFromS = axis ? filmTimeAtRecordingTime(axis, tAb) : undefined
        if (track.type === 'music') {
          f1 = tBis !== undefined ? positionAtTime(series, tBis).f : 1
          filmToS = axis
            ? tBis !== undefined
              ? filmTimeAtRecordingTime(axis, tBis)
              : axis.totalS
            : undefined
        } else {
          // SFX: One-Shot exakt bei f0. Liegt `ab` außerhalb des (getrimmten)
          // Tracks, würde die Klemmung den Knall an den Tour-Start/-Ende legen,
          // wo er nie gemeint war → überspringen.
          if (firstPoint && lastPoint && (tAb < firstPoint.tSec || tAb > lastPoint.tSec)) {
            log?.(`Audio außerhalb des Tracks übersprungen: ${track.file}`)
            continue
          }
          f1 = f0
        }
      }
      // Ein Musik-Klip ohne Ausdehnung wäre stumm (`istAktiv` prüft
      // Von ≤ x < Bis) — nur gilt das seit E10 in FILMZEIT und nicht mehr im
      // Streckenanteil. Genau darin liegt der Unterschied: Ein Klip, der ganz
      // in einer Standzeit oder einer Ex-Pause liegt, fällt im `f`-Raum auf
      // einen Punkt zusammen (dort steht die Strecke, während der Film läuft)
      // und wurde deshalb bis hierher VERWORFEN. Er hat sehr wohl eine Länge,
      // man muss sie nur in der richtigen Größe messen. Übrig bleibt der Fall,
      // in dem auch der Film keine Zeit dafür hat — etwa eine Spanne, die der
      // Trim vollständig vor den Track-Anfang klemmt.
      const empty =
        filmFromS !== undefined && filmToS !== undefined ? !(filmToS > filmFromS) : f1 <= f0
      if (track.type === 'music' && empty) {
        log?.(`Audio außerhalb des Tracks übersprungen: ${track.file}`)
        continue
      }
      tracks.push({
        type: track.type === 'music' ? 'music' : 'sfx',
        // Bibliothek: statisch ausgeliefert (wie ambient.mp3). Benutzer-Upload:
        // über die Tour ausgeliefert, damit deren Sichtbarkeit den Zugriff regelt.
        src: fromLibrary
          ? `/audio/sfx/${track.file}`
          : fromUserLibrary
            ? `/api/tours/${tourId}/library-audio/${track.file}`
            : `/api/media/${tourId}/${track.file}`,
        f0,
        f1,
        // IMMER mitschreiben, anders als loop/startS darunter: Der Player kennt
        // die Vorgabe des Studio-Reglers (0.8) nicht, und ohne Wert spielte er
        // mit 1.0 — der Film klänge lauter als der Schnitt. Der Wert ist hier
        // absolut; den Master setzt remote.ts auf 1 (s. TourConfig.audioPegel).
        gain: track.volume ?? STUDIO_GAIN,
        // Nur mitschreiben, was ausdrücklich gesetzt ist: Der Player kennt
        // dieselben Vorgaben (Musik loopt, SFX nicht) und würde sie sonst aus
        // einem geschriebenen Wert lesen statt aus der Regel — Bestandsdaten
        // bekämen ein Feld, das sie nie hatten.
        ...(track.loop !== undefined ? { loop: track.loop } : {}),
        ...(track.startS ? { startS: track.startS } : {}),
        // Die Film-Anker (E10). `filmS` steht bei jedem Klip, `filmToS` nur bei
        // einem BEREICH: Ein One-Shot hat keine Länge, und ein zweites Feld mit
        // demselben Wert wäre eine Angabe über nichts. Der Player fällt je
        // Endpunkt einzeln auf `f0`/`f1` zurück — ein Bereich ohne `filmToS`
        // bleibt dadurch ein Bereich.
        ...(filmFromS !== undefined ? { filmS: filmNumber(filmFromS) } : {}),
        ...(filmToS !== undefined && filmFromS !== undefined && filmToS > filmFromS
          ? { filmToS: filmNumber(filmToS) }
          : {}),
      })
    }
    // Sortiert nach FILMSEKUNDE, wo es sie gibt: Zwei Klips in derselben
    // Standzeit haben dasselbe `f0` und stünden sonst in beliebiger Reihenfolge.
    tracks.sort((a, b) => (a.filmS ?? a.f0) - (b.filmS ?? b.f0) || a.f0 - b.f0)
    if (tracks.length) audio = tracks
  }

  let weather: TourJson['weather']
  if (edits?.weather?.length) {
    // Studio-Wetter (Baukasten): eine bewusst gesetzte Stufenfunktion ersetzt
    // das Auto-Wetter VOLLSTÄNDIG — auch die Foto-Verfeinerung entfällt, weil der
    // Nutzer hier korrigiert, was Open-Meteo/Bildanalyse falsch hatten.
    const keyframes = weatherFromOverlay(edits.weather, series, startMs)
    if (keyframes.length) weather = keyframes
  } else {
    // Roh-Wetter: bevorzugt vorgegeben (Anreicherungs-Cache, kein Netz); sonst aus
    // der Quelle berechnen (Direktaufruf/Test). `weatherRaw === undefined` heißt
    // „nicht im Cache" → berechnen; `null`/`[]` heißt „berechnet, aber kein Wetter".
    const weatherGiven = weatherRaw !== undefined
    try {
      let keyframes: WeatherKeyframe[]
      if (weatherGiven) {
        keyframes = weatherRaw ?? []
      } else if (weatherSource) {
        keyframes = await computeWeather({
          series,
          startIso: manifest.time.start,
          source: weatherSource,
        })
      } else {
        keyframes = []
      }
      // Bildanalyse (M5): platzierte Fotos mit Befund lokal auf ihre f-Position
      // abbilden (Aufnahmezeit → Zeitreihe, wie die Kamera-Keyframes) und das
      // API-Wetter dort verfeinern. Ohne Befunde bleibt `keyframes` unberührt.
      if (keyframes.length && imageFindings?.size) {
        const photos: Array<{ f: number; finding: ImageFinding }> = []
        for (const m of media) {
          if (m.type !== 'photo' || m.anchor === null) continue // nur platzierte Fotos
          const finding = imageFindings.get(m.id)
          if (!finding) continue
          const tSek = (Date.parse(m.takenAt) - startMs) / 1000
          if (!Number.isFinite(tSek)) continue
          photos.push({ f: positionAtTime(series, tSek).f, finding })
        }
        if (photos.length) keyframes = refineWeatherWithPhotos(keyframes, photos)
      }
      if (keyframes.length) weather = keyframes
    } catch (error) {
      log?.(`Auto-Wetter nicht verfügbar (${tourId}): ${(error as Error).message}`)
    }
  }

  return {
    schema: TOUR_SCHEMA_ID,
    id: tourId,
    no: `N°${String(no).padStart(2, '0')}`,
    status: 'ready',
    brandTitle: naming.brandTitle,
    kicker: naming.kicker,
    titleHtml: naming.titleHtml,
    stops: naming.stops,
    showFinale,
    finaleTitle: finaleTargetOverride?.trim() || naming.finaleTitle,
    description: descriptionOverride ?? manifest.description ?? null,
    time: manifest.time,
    segments,
    media,
    ...(timeline ? { timeline } : {}),
    ...(weather ? { weather } : {}),
    ...(camera ? { camera } : {}),
    ...(moments ? { moments } : {}),
    ...(audio ? { audio } : {}),
    // Die Bibliothek zeigt jede Tour als Kachel: Anzahl der Aufnahmen und die
    // Form der Route stehen deshalb mit in der Statistik. Beides fällt hier
    // ohnehin an — die Liste soll dafür keine Tour-Dateien öffnen müssen.
    stats: {
      ...stats,
      placedMedia: media.filter((m) => m.anchor).length,
      ...(() => {
        const track = buildSignature(
          segments.flatMap((s) => s.pts.map((p) => [p[0], p[1]] as const)),
        )
        return track ? { trackSignature: track } : {}
      })(),
      ...(axis ? { filmS: Math.round(axis.totalS * 10) / 10 } : {}),
      ...(showFinale ? { finale: true } : {}),
    },
  }
}
