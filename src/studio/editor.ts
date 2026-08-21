// Studio-Editor (M7 + Kreativbaukasten): Karten-Editor über den Editor-Daten
// des Backends — Medien platzieren/verschieben/löschen, Captions, Modus- und
// Kamera-Grenzen, Musik/SFX mit Streckenbereich,
// Foto-Anzeigeoptionen. Reine Logik liegt in edit-model.ts + timeline.ts;
// hier nur DOM + MapLibre. Wird aus studio.ts lazy importiert, damit MapLibre
// nur bei Bedarf ins Studio-Bundle kommt.

import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { STUDIO_GAIN_DEFAULT, videoVolume, videoVolumeEnvelope } from '../audiotracks.js'
import {
  trimmedDurationS,
  clampAspectRatio,
  VIDEO_HAS_FRAME,
  videoSeekDecision,
} from '../card-timing.js'
import type { CardMedium, CardSource, CardText } from '../card-painter.js'
import { createCardLayer, type CardLayer } from '../card-layer.js'
import { pfad, tourPfad } from '../routen.js'
import { DESCRIPTION_MAX } from '../tour-texts.js'
import { wireTooltips } from './tooltip.js'
import * as api from './api.js'
import { openExportSheet, closeExportSheet } from './export-sheet.js'
import {
  effectiveMedia,
  idsToDelete,
  recordUndo,
  isoToOffset,
  EMPTY_OVERLAY,
  materializeTravelModes,
  withAudioEntry,
  mitAudioPatch,
  withCameraBoundary,
  withMediaEdit,
  withTravelModeBoundary,
  withCameraMoment,
  withWeatherBoundary,
  MOMENT_DEFAULT_S,
  withoutAudioEntry,
  withoutCameraBoundary,
  withoutMedia,
  withoutTravelModeBoundary,
  withoutCameraMoment,
  withoutWeatherBoundary,
  offsetToIso,
  projectOntoTrack,
  validateOverlay,
  pointAtOffset,
  WEATHER_MODES,
  splitForDisplay,
  type AudioEntry,
  type EditOverlay,
  type EditorSegment,
  type CameraMoment,
  type CameraPreset,
  type MediaView,
  thumbnailSource,
  type MediaBase,
  type TravelMode,
  type CameraMomentKind,
  type TrackPoint,
  weatherAtTime,
  type WeatherMode,
} from './edit-model.js'
import {
  scrollAnchor,
  fractionToFilm,
  fractionToOffset,
  audioWouldBeDropped,
  mediumHoldS,
  buildTimelineAxis,
  buildBands,
  buildFilmRuler,
  buildMediaDots,
  buildBoundaryCurve,
  buildScale,
  buildPlaybackCurve,
  buildSceneClips,
  buildStateBands,
  filmAt,
  filmTimeAtRecordingTime,
  filmDurationAtBoundary,
  filmToFraction,
  filmToOffset,
  formatFilmTime,
  formatSeconds,
  STOP_FADE_OUT_S,
  stopAtFilmS,
  photoHoldS,
  stopInnerAt,
  clampFilmS,
  clampBoundary,
  clampMomentDuration,
  clampHoldS,
  clampMediaTrim,
  VIDEO_TRIM_MIN_S,
  cumMeters,
  resolveSelection as loeseFokusAufRein,
  metersToOffset,
  offsetAtMeters,
  offsetToFraction,
  moveToSlot,
  slotInChain,
  snapToStop,
  stepFilmS,
  clockDiffToOffset,
  videoPositionS,
  recordingTimeAtFilmTime,
  type TimelineAxis,
  type AxisStop,
  type FilmCurve,
  type EditorSelection,
  type EditorSelectionTarget,
  type StopInterval,
  type SceneClip,
  type TimeScale,
} from './timeline.js'
import {
  CATEGORY_NAMES,
  SFX_LIBRARY,
  sfxEffect,
  type SfxEffect,
  type SfxType,
} from './sfx-library.js'
import {
  resolveAudioClips,
  loopAfterRoleChange,
  commitAudioClip,
  setLoop,
  audioLanes,
  trimLeft,
  trimRight,
  moveAudioClip,
  waveformPosition,
  type AudioClip,
  type AudioClipPatch,
} from './audio-clip.js'
import { createMapMood, type MapMood } from './map-mood.js'
import { buildStops, metersWithoutCluster, assignOrder, stopOf, type Stop } from './stops.js'
import { describeCapture, readCapture, readExif, type ExifCapture } from './exif.js'
import {
  distanceFunction,
  reportSentences,
  classificationWord,
  summarize,
  megabyte,
  stripFraction,
  type AddMediaReport,
  type AddMediaTarget,
  type NewMedium,
} from './add-media.js'
import { exifDateToMs, isoWithZone, mediaType } from './upload.js'
// Nur Typen — das Modul selbst wird erst beim ersten Play geladen.
import type { Playback, SoundCue, MusicClip, PlaybackPlan } from './playback.js'

/** Anzeigename eines Audio-Eintrags: Katalogname bei Bibliothek, eigener
 *  Upload ohne Datei-Endung, sonst der rohe Dateiname (tour-lokaler Altbestand). */
function audioName(a: AudioEntry): string {
  if (a.source === 'library') return sfxEffect(a.file)?.name ?? a.file
  if (a.source === 'user') return a.file.replace(/\.[^.]+$/, '')
  return a.file
}

/** Abspiel-URL eines Audio-Eintrags — Bibliothek statisch, eigener Upload über
 *  die Konto-Route (der Player nutzt später die tour-gebundene), sonst tour-lokal. */
function audioUrl(a: AudioEntry, tourId: string): string {
  if (a.source === 'library') return `/audio/sfx/${encodeURIComponent(a.file)}`
  if (a.source === 'user') return `/api/audio-library/${encodeURIComponent(a.file)}`
  return `/api/media/${tourId}/${encodeURIComponent(a.file)}`
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

// Reihenfolge bestimmt die Auswahl-Listen (Object.entries): unmotorisiert →
// motorisiert → öffentlich → Wasser.
const TRAVEL_MODE_NAMES: Record<TravelMode, string> = {
  walk: 'Zu Fuß',
  bike: 'Rad',
  moped: 'Moped',
  jeep: 'Jeep',
  tram: 'Tram',
  ferry: 'Fähre',
}
const TRAVEL_MODE_COLORS: Record<TravelMode, string> = {
  walk: '#3ecf8e',
  bike: '#5b9dff',
  moped: '#ff6f52',
  jeep: '#b98a5a',
  tram: '#f5a524',
  ferry: '#c58bff',
}
/**
 * Kamera-Abstände zur Auswahl — `standard` ist einer davon und steht bewusst
 * VORNE: Er bedeutet „hier gilt, was der Zuschauer im Player einstellt", und
 * genau das ist der Ausgangszustand jeder Tour. Als bloße Abwesenheit eines
 * Werts war er eine Sackgasse — einmal auf Nah gestellt, kam man nur über
 * „Abschnitt entfernen" zurück, und das nahm die Stelle gleich mit.
 */
const PRESET_NAMES: Record<CameraPreset, string> = {
  default: 'Standard',
  near: 'Nah',
  mid: 'Mittel',
  far: 'Weit',
}
const CAMERA_DEFAULT = PRESET_NAMES.default
const CAMERA_DEFAULT_EXPLAINED =
  'Standard: Es gilt der Abstand, den der Zuschauer im Player einstellt (Nah, Mittel oder Weit).'
/** Anzeigenamen der Wetter-Modi (Reihenfolge = Auswahl-Liste). */
const WEATHER_NAMES: Record<WeatherMode, string> = {
  off: 'Klar',
  clouds: 'Wolkig',
  fog: 'Nebel',
  rain: 'Regen',
  snow: 'Schnee',
  storm: 'Gewitter',
}
/** Wetter-Bänder: gedämpfte, mitteldunkle Füllung (helle Bandschrift bleibt lesbar). */
const WEATHER_COLORS: Record<WeatherMode, string> = {
  off: 'rgba(70, 120, 175, 0.55)',
  clouds: 'rgba(120, 132, 148, 0.62)',
  fog: 'rgba(140, 150, 165, 0.55)',
  rain: 'rgba(52, 110, 200, 0.68)',
  snow: 'rgba(150, 170, 195, 0.62)',
  storm: 'rgba(96, 78, 160, 0.72)',
}
/** Standard-Wetterstärke k (Spiegel von WETTER_STANDARD_K im Server). */
const WEATHER_DEFAULT_K = 0.7
const MOMENT_NAMES: Record<CameraMomentKind, string> = {
  orbit: 'Umkreisen',
  ascend: 'Aufstieg',
  linger: 'Innehalten',
}
/** Symbol je Moment-Art auf der Zeitleisten-Marke. */
const MOMENT_GLYPHS: Record<CameraMomentKind, string> = { orbit: '↻', ascend: '↑', linger: '⏸' }
/** Kamera-Bänder: ein Farbton, Deckkraft = Nähe (nah kräftig, weit zurückhaltend). */
const PRESET_COLORS: Record<CameraPreset, string> = {
  // Standard ist keine Distanz, also auch nicht im Distanz-Farbton: dieselbe
  // ruhige Fläche wie das Grundband (.band.grund), damit beide dasselbe sagen.
  default: 'rgba(103, 114, 127, 0.22)',
  near: 'rgba(91, 157, 255, 0.72)',
  mid: 'rgba(91, 157, 255, 0.46)',
  far: 'rgba(91, 157, 255, 0.24)',
}
const PLACEMENT_NAMES: Record<string, string> = {
  gps: 'GPS',
  time: 'Zeit',
  manual: 'manuell',
  unplaced: 'unplatziert',
}
const AUDIO_EXTENSIONS = ['mp3', 'm4a', 'ogg', 'wav']
/** Icon aus dem Sprite in studio.html (nur für vertrauten, statischen Markup-Bau). */
const icon = (name: string): string => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`

/**
 * Fokussiertes Objekt — die gemeinsame Auswahl von Zeitleiste, Karte und
 * Inspector. Bewusst nur die IDENTITÄT: Bänder entstehen aus Overlay + Track
 * und würden als kopierte Spanne veralten, sobald man eine Grenze verschiebt.
 * Die konkrete Spanne löst clearSelectionOn() bei jedem Render neu auf.
 *
 * Getrennt von `cursor` (der Einfügemarke für „ab hier"-Aktionen) — wie
 * Abspielkopf und Selektion in einem Schnittprogramm.
 */
interface State {
  tourId: string
  data: api.EditorPayload
  edits: EditOverlay
  /** JSON-Schnappschuss des gespeicherten Overlays (Dirty-Erkennung) */
  saved: string
  /** Trackpunkte flach über alle Segmente */
  track: TrackPoint[]
  /** Einfügemarke: Punkt AUF der Track-Linie (interpoliert, inkl. tOffset) */
  cursor: TrackPoint | null
  /** fokussiertes Objekt (Band, Audio-Spur, Medium) — siehe Fokus */
  selection: EditorSelection | null
  /**
   * Tour-Einstellungen im Inspector (Titel/Beschreibung/Endscreen).
   * Bewusst getrennt vom Leerzustand und von `selection`: Einstieg über Titel/„…",
   * Auswahl eines Zeitleisten-Objekts schließt die Ansicht wieder.
   */
  tourSettings: boolean
  /** Medien-ID im „auf den Track klicken"-Platzieren-Modus */
  place: string | null
  /** frühere Overlay-Stände (Undo), ältester zuerst */
  past: EditOverlay[]
  /** zurückgenommene Stände (Redo), jüngster zuletzt */
  future: EditOverlay[]
}

let map: maplibregl.Map | null = null
let z: State | null = null
/**
 * Kartenpunkte der Halte, nach ihrer Zusammensetzung geschlüsselt (Wortliste
 * der Medien-IDs). Ein Halt, der sich nicht geändert hat, BEHÄLT sein Element
 * über den nächsten Render hinweg — Abreißen und Neubauen ließ bei jedem Klick
 * alle Bilder kurz zu leeren Kreisen werden (der Browser zeichnet ein frisches
 * `img` erst nach dem Dekodieren).
 */
let marker = new Map<string, MarkerEntry>()
let mediaMarker = new Map<string, HTMLElement>()
/** Medien-ID → Kartenpunkt ihres Halts (für ruckfreies Ziehen). */
let markerToId = new Map<string, maplibregl.Marker>()

interface MarkerEntry {
  mk: maplibregl.Marker
  el: HTMLElement
  /** Aktueller Halt — die Zieh-Handler lesen ihn HIER, nicht aus ihrer Closure. */
  stop: Stop
}
let runner: maplibregl.Marker | null = null
let preview: { audio: HTMLAudioElement; file: string } | null = null
let backCb: (() => void) | null = null
let wired = false
/** Kumulierte Streckenmeter je Trackpunkt — für die km-Anzeige am Abspielkopf. */
let cumDistances: number[] = []
/**
 * Maßstab der Zeitachse in PIXELN JE FILMSEKUNDE — die gespeicherte Zoomgröße.
 *
 * Nicht ein Faktor auf die Fensterbreite: die Fortbewegung bestimmt die
 * Filmdauer, ein Faktor-Modell skalierte deshalb bei jeder Modus-Änderung die
 * ganze Leiste — auch alles VOR der geänderten Stelle, das damit nichts zu tun
 * hat. Mit festem Maßstab bleibt links der Änderung jedes Pixel stehen; nur was
 * dahinter liegt, rückt. 0 = noch nicht gemessen.
 */
let pxPerFilmS = 0

/**
 * Gemessene Länge je Ton-DATEI (s) — der Materialanschlag beider Trimm-Kanten.
 *
 * Sie steht nirgends im Datenmodell: Die kuratierte Bibliothek führt Namen und
 * Charakter, nicht Sekunden, und ein eigener Upload erst recht nicht. Gemessen
 * wird deshalb im Browser über `loadedmetadata` — das lädt nur den Dateikopf.
 * Bis ein Wert da ist, hat die Kante keinen Anschlag (lieber ziehen lassen als
 * grundlos klemmen) und ein Effekt keine Breite; danach rendert die Leiste
 * einmal neu und beides steht.
 */
const audioDurations = new Map<string, number>()
/** Läuft/lief bereits eine Messung? Verhindert Messschleifen bei Fehlern. */
const audioMeasured = new Set<string>()

/**
 * Solange wahr, folgt der Maßstab der Fensterbreite („eingepasst") — der
 * Startzustand und die Untergrenze des Zoomens. Erst eine Nutzerhandlung
 * (Hineinzoomen) friert ihn ein, waagerechter Scroll entsteht nie beim Öffnen.
 */
let autoFit = true
/** Aktives Werkzeug der Zeitleiste (Auswahl · Hand · Zoom), wie in Final Cut. */
let tool: 'select' | 'hand' | 'zoom' = 'select'
/**
 * Schluckt den Klick NACH einem Zug, damit das Loslassen nicht zusätzlich
 * auswählt. Aufgehoben wird die Sperre von der nächsten Zeigergeste (s.
 * verdrahteEinmal) — NICHT vom folgenden `click`: `preventDefault()` im
 * pointerdown unterdrückt die Maus-Kompatibilitätsereignisse, der Klick kommt
 * dann gar nicht, und die Sperre fräße den nächsten echten Klick.
 */
let suppressClick = false
/**
 * Overlay-Stand beim letzten Voll-Render — Grundlage der Undo-Erfassung.
 *
 * Das Overlay wird ausschließlich immutabel fortgeschrieben (edit-model.ts), ein
 * REFERENZ-Vergleich erkennt also jede Änderung, egal aus welchem der ~30
 * Handler sie kam. Das erspart es, jede Mutation einzeln zu instrumentieren.
 * Während eines Zeitleisten-Zugs läuft nur renderAfterDrag(), das den Stand nicht
 * fortschreibt — der ganze Zug wird dadurch zu genau einem Undo-Schritt.
 */
let lastState: EditOverlay | null = null

// — Einstieg —

export async function openEditor(tourId: string, back: () => void): Promise<void> {
  backCb = back
  wireOnce()
  reportedTray = false
  $('editor-view').hidden = false
  status('Editor wird geladen …')
  // Benutzerweite Audio-Bibliothek nebenher holen — der Dialog und die
  // Herkunftszeile im Panel greifen darauf zu, blockieren soll sie nichts.
  void loadLibrary()
  try {
    await loadData(tourId)
    status('')
  } catch (error) {
    status((error as Error).message, 'fehler')
  }
}

async function loadData(tourId: string): Promise<void> {
  const data = await api.loadEditorPayload(tourId)
  const edits = (data.edits as EditOverlay | null) ?? EMPTY_OVERLAY
  const settingsOpen = z?.tourId === tourId && z.tourSettings
  z = {
    tourId,
    data,
    edits,
    saved: JSON.stringify(edits),
    track: data.segments.flatMap((s) => s.pts),
    // Der Abspielkopf steht von Anfang an irgendwo — die Marke ist keine
    // Sonderlage mehr, sondern die immer sichtbare Position auf der Achse.
    cursor: null,
    selection: null,
    tourSettings: !!settingsOpen,
    place: null,
    past: [],
    future: [],
  }
  lastState = edits
  ;($('editor-title') as HTMLInputElement).value = data.title ?? ''
  ;($('editor-description') as HTMLTextAreaElement).value = data.description ?? ''
  countDescription()
  ;($('editor-kicker') as HTMLInputElement).value = data.kicker ?? ''
  buildBasemapPicker(data.kickerSuggestions ?? [])
  const finaleOn = !!data.finale
  ;($('editor-finale') as HTMLInputElement).checked = finaleOn
  ;($('editor-finale-target') as HTMLInputElement).value = data.finaleTarget ?? ''
  ;($('editor-finale-target-field') as HTMLElement).hidden = !finaleOn
  showTitleInHeader()
  ;($('editor-preview') as HTMLAnchorElement).href = tourPfad(`srv:${tourId}`)
  ;($('editor-preview') as HTMLAnchorElement).style.display = data.status === 'ready' ? '' : 'none'
  ;($('editor-film') as HTMLButtonElement).hidden = data.status !== 'ready'

  // Streckenmeter einmal je Tour vorrechnen — die km-Anzeige am Abspielkopf
  // fragt sie bei jeder Bewegung ab.
  cumDistances = cumMeters(z.track)
  const total = document.getElementById('header-km-total')
  if (total) total.textContent = kmText(cumDistances[cumDistances.length - 1] ?? 0)

  if (!map) {
    map = buildMap()
    await new Promise<void>((meets) => map?.once('load', () => meets()))
    buildTrackLayer(map)
    buildMood(map)
    buildCardLayer()
  }
  fitViewport()
  // Abspielkopf auf den Anfang der Tour stellen — er ist ab jetzt immer
  // sichtbar, nicht mehr eine Sonderlage nach dem ersten Klick.
  const rulerInit = buildScale(z.track)
  if (rulerInit) z.cursor = pointAtOffset(z.track, rulerInit.fromS)
  playheadFilmS_ = 0
  renderAll()
  // Die Achsenbreite ERST danach setzen: `renderTimeline` blendet die Leisten-
  // Zone ein, und solange sie `hidden` ist, misst sich ihr Fenster als 0 breit —
  // der Fit hätte auf die Notbreite gerechnet und die Achse gestaucht.
  autoFit = true
  pxPerFilmS = 0
  fit()
}

function close(): void {
  closeExportSheet()
  $('editor-view').hidden = true
  closeLarge()
  stopPreview()
  playback?.close()
  playback = null
  hidePhoto()
  map?.remove()
  map = null
  // Die Stimmung muss AUSDRÜCKLICH zurückgenommen werden. Die Paint-Properties
  // gehen mit `karte.remove()`, aber das Partikel-Overlay hängt an der Bühne
  // und bringt eigene Klang-Loops mit — ohne diesen Aufruf blieben Regenklänge
  // hörbar, nachdem man die Tour längst verlassen hatte (gemeldet). Der
  // Schalter-Zustand lebt in localStorage weiter und wird beim nächsten Aufbau
  // gelesen.
  mood?.destroy()
  mood = null
  // Die Leinwand hängt an der Bühne und bringt zwei Beobachter (Resize) mit —
  // ohne diesen Aufruf blieben sie auf einem Container liegen, den die nächste
  // Tour neu bespielt.
  cardLayer?.destroy()
  cardLayer = null
  z = null
  lastState = null
  marker = new Map()
  mediaMarker = new Map()
  markerToId = new Map()
  clearTourCaches()
  runner = null
  cumDistances = []
  pxPerFilmS = 0
  autoFit = true
  playheadFilmS_ = null
  backCb?.()
}

/**
 * Alle Caches leeren, deren Schlüssel nur INNERHALB einer Tour eindeutig ist.
 *
 * **Medien-IDs sind pro Tour vergeben** — jede Tour beginnt bei `m1`. Ein
 * Cache, der sie als Schlüssel nimmt und den Tourwechsel überlebt, liefert in
 * der zweiten Tour die Daten der ersten. Sichtbar war das an den Miniaturen:
 * Tour 2 zeigte die Fotos von Tour 1, bis jemand die Seite neu lud. Unsichtbar
 * betraf es genauso die Aufnahme-Details (fremde Kamera, fremdes Objektiv) und
 * das Seitenverhältnis der Foto-Karte — falsche Auskünfte, die aussehen wie
 * echte. Bei den Ton-Caches ist der Schlüssel ein Dateiname: für die
 * benutzerweite Bibliothek eindeutig, für tour-lokale `media/`-Klänge nicht.
 *
 * Eine Stelle für alle, damit der nächste Cache hier landet und nicht wieder
 * zwei Jahre still danebenliegt.
 */
function clearTourCaches(): void {
  clipEls = new Map()
  momentEls = new Map()
  exifCache.clear()
  aspectRatios.clear()
  audioDurations.clear()
  waveformImages.clear()
}

/** Von außen (Studio-URL / Zurück-Taste) — no-op, wenn der Editor schon zu ist. */
export function closeEditor(): void {
  if ($('editor-view').hidden) return
  close()
}

// — Karte —

function buildMap(): maplibregl.Map {
  const k = new maplibregl.Map({
    container: 'editor-map',
    // Schlanker Raster-Stil (Esri-Satellit wie im Player) — der Editor braucht
    // kein Terrain und keinen Player: nur Orientierung + Klickbarkeit.
    style: {
      version: 8,
      sources: {
        sat: {
          type: 'raster',
          tiles: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          ],
          tileSize: 256,
          maxzoom: 19,
          attribution: 'Esri, Maxar, Earthstar Geographics',
        },
      },
      layers: [{ id: 'sat', type: 'raster', source: 'sat' }],
    },
    // Die Quellenangabe steht als eigenes (i) unten rechts — die Pflichtnennung
    // bleibt, braucht aber keine Dauerzeile über der Karte.
    attributionControl: false,
  })
  k.on('click', (e) => clickOnMap(e))
  // Follow und Zoom vertragen sich nicht gleichzeitig: jedes Follow-`jumpTo`
  // bricht die Zoom-Animation ab. Bei Nutzer-Zoom Follow kurz pausieren.
  k.on('wheel', () => pauseCardFollow())
  k.on('zoomstart', (e) => {
    if (e.originalEvent) pauseCardFollow()
  })
  return k
}

function buildTrackLayer(k: maplibregl.Map): void {
  k.addSource('track', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  // Dunkle Kontur unter der Linie: Lesbarkeit auf hellem Satellitenbild
  k.addLayer({
    id: 'track-kontur',
    type: 'line',
    source: 'track',
    paint: { 'line-color': '#0a0d12', 'line-width': 7, 'line-opacity': 0.55 },
    layout: { 'line-cap': 'round', 'line-join': 'round' },
  })
  k.addLayer({
    id: 'track-inaktiv',
    type: 'line',
    source: 'track',
    filter: ['==', ['get', 'aktiv'], 0],
    paint: { 'line-color': '#8a95a5', 'line-width': 3, 'line-dasharray': [1.5, 2] },
  })
  k.addLayer({
    id: 'track-aktiv',
    type: 'line',
    source: 'track',
    filter: ['==', ['get', 'aktiv'], 1],
    paint: { 'line-color': ['get', 'farbe'], 'line-width': 4 },
    layout: { 'line-cap': 'round', 'line-join': 'round' },
  })
  // Fokus-Abschnitt: leuchtet über allem. Damit beantwortet die ROUTE die Frage
  // „wo endet das" räumlich — die Zeitleiste sagt wann, die Karte sagt wo.
  k.addSource('fokus', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  k.addLayer({
    id: 'fokus-schein',
    type: 'line',
    source: 'fokus',
    paint: { 'line-color': '#f5a524', 'line-width': 13, 'line-opacity': 0.28, 'line-blur': 4 },
    layout: { 'line-cap': 'round', 'line-join': 'round' },
  })
  k.addLayer({
    id: 'fokus-linie',
    type: 'line',
    source: 'fokus',
    paint: { 'line-color': '#ffd27a', 'line-width': 5 },
    layout: { 'line-cap': 'round', 'line-join': 'round' },
  })
  // Punktförmiger Fokus (Foto, Einzel-Effekt) hat keine Ausdehnung
  k.addLayer({
    id: 'fokus-punkt',
    type: 'circle',
    source: 'fokus',
    filter: ['==', ['geometry-type'], 'Point'],
    paint: {
      'circle-radius': 8,
      'circle-color': '#ffd27a',
      'circle-opacity': 0.9,
      'circle-stroke-width': 2,
      'circle-stroke-color': '#0a0d12',
    },
  })
}

/** Fokussierten Streckenabschnitt auf der Karte hervorheben. */
function drawSelection(): void {
  if (!map || !z) return
  const source = map.getSource('fokus') as maplibregl.GeoJSONSource | undefined
  if (!source) return
  const info = clearSelectionOn()
  const features: GeoJSON.Feature[] = []
  if (info) {
    if (info.toS > info.fromS) {
      // Ränder interpolieren, damit der Abschnitt exakt an der Bandkante endet
      // und nicht am nächsten Stützpunkt (Fähren-Geraden!)
      const points: TrackPoint[] = []
      const start = pointAtOffset(z.track, info.fromS)
      if (start) points.push(start)
      for (const p of z.track) if (p[3] > info.fromS && p[3] < info.toS) points.push(p)
      const end = pointAtOffset(z.track, info.toS)
      if (end) points.push(end)
      if (points.length >= 2) {
        features.push({
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: points.map((p) => [p[0], p[1]]) },
        })
      }
    } else {
      const p = pointAtOffset(z.track, info.fromS)
      if (p)
        features.push({
          type: 'Feature',
          properties: {},
          geometry: { type: 'Point', coordinates: [p[0], p[1]] },
        })
    }
  }
  source.setData({ type: 'FeatureCollection', features })
}

function fitViewport(): void {
  if (!map || !z || !z.track.length) return
  // Der Container ist Teil eines frisch eingeblendeten Grids — Maß nachziehen,
  // bevor der Ausschnitt gerechnet wird (sonst passt fitBounds auf alte Größe).
  map.resize()
  const boundaries = new maplibregl.LngLatBounds()
  for (const p of z.track) boundaries.extend([p[0], p[1]])
  // Unten mehr Luft: dort schwebt die Zeitleiste über der Karte. Auf kleinen
  // (Mobil-)Karten das Padding proportional klemmen — übersteigt es den
  // Container, wirft MapLibre und der Editor bliebe in der Weltansicht.
  const wrap = map.getContainer()
  const scale = Math.min(1, wrap.clientWidth / (70 + 70 + 60), wrap.clientHeight / (70 + 185 + 60))
  const px = (p: number): number => Math.round(p * scale)
  map.fitBounds(boundaries, {
    padding: { top: px(70), right: px(70), bottom: px(185), left: px(70) },
    duration: 0,
  })
}

function clickOnMap(e: maplibregl.MapMouseEvent): void {
  if (!map || !z) return
  const r = 8
  const treffer = map.queryRenderedFeatures(
    [
      [e.point.x - r, e.point.y - r],
      [e.point.x + r, e.point.y + r],
    ],
    { layers: ['track-aktiv', 'track-inaktiv'] },
  )
  if (!treffer.length) return
  // Lotfußpunkt auf der LINIE — nicht der nächste Stützpunkt: der Track ist
  // vereinfacht, auf Geraden (Fähre) liegen Stützpunkte kilometerweit auseinander.
  const projection = projectOntoTrack(z.track, e.lngLat.lng, e.lngLat.lat)
  if (z.place) {
    z.edits = withMediaEdit(z.edits, z.place, {
      anchor: [projection.point[0], projection.point[1]],
    })
    z.place = null
  } else {
    z.cursor = projection.point
  }
  renderAll()
}

// — Anzeige —

function renderAll(): void {
  if (!map || !z) return
  // Jede Bearbeitung und jede Auswahl beendet die Wiedergabe: der Plan des
  // Abspielers ist ein Schnappschuss, er liefe sonst gegen veraltete Halte.
  stopsPlay()
  // Undo-Punkt setzen, wenn sich das Overlay seit dem letzten Voll-Render
  // geändert hat (s. letzterStand). Undo/Redo selbst ziehen den Stand vorher
  // nach und lösen hier deshalb keinen neuen Eintrag aus.
  recordUndo(z, lastState, z.edits)
  lastState = z.edits
  renderHistoryButtons()
  drawTrack()
  drawMarker()
  renderInspector()
  renderTimeline()
  renderTray()
  $('editor-map').classList.toggle('placing', z.place !== null)
  $('editor-media-hint').textContent = z.place
    ? 'Auf den Track klicken, um das Medium dort zu verankern, erneut „Platzieren" drücken bricht ab.'
    : ''
}

// — Undo/Redo: das Overlay ist immutabel, ein Stapel von Ständen genügt —

function undo(): void {
  const zz = z // Modul-let: Narrowing überlebt die Aufrufe unten nicht
  if (!zz?.past.length) return
  zz.future.push(zz.edits)
  zz.edits = zz.past.pop() as EditOverlay
  lastState = zz.edits // der Rücksprung selbst ist kein neuer Undo-Punkt
  renderAll()
  status('Rückgängig gemacht.', 'ok')
}

function redo(): void {
  const zz = z
  if (!zz?.future.length) return
  zz.past.push(zz.edits)
  zz.edits = zz.future.pop() as EditOverlay
  lastState = zz.edits
  renderAll()
  status('Wiederhergestellt.', 'ok')
}

function renderHistoryButtons(): void {
  if (!z) return
  ;($('editor-undo') as HTMLButtonElement).disabled = !z.past.length
  ;($('editor-redo') as HTMLButtonElement).disabled = !z.future.length
}

function drawTrack(): void {
  if (!map || !z) return
  const segments = splitForDisplay(z.data.segments as EditorSegment[], z.edits, z.data.time.start)
  const source = map.getSource('track') as maplibregl.GeoJSONSource
  source.setData({
    type: 'FeatureCollection',
    features: segments.map((a) => ({
      type: 'Feature',
      properties: { color: TRAVEL_MODE_COLORS[a.mode], active: a.active ? 1 : 0 },
      geometry: { type: 'LineString', coordinates: a.pts.map((p) => [p[0], p[1]]) },
    })),
  })
  drawSelection()
}

function drawMarker(): void {
  if (!map || !z) return
  mediaMarker = new Map()
  markerToId = new Map()
  const seen = new Set<string>()

  // Ein HALT ist auch auf der Karte EIN Punkt: drei Bilder vom selben Ort lägen
  // sonst als drei fast deckungsgleiche Kreise übereinander und man sähe nur
  // einen. Das Bild selbst zeigt, was dort wartet — auf einem Satellitenbild
  // wäre ein Punkt nur ein weiterer heller Fleck.
  for (const stop of buildStops(mediaDisplay(), z.track, cumDistances)) {
    const lead = stop.items[0]
    if (!lead?.anchor) continue
    const key = stop.items.map((m) => m.id).join(' ')
    seen.add(key)
    const existing = marker.get(key)
    const entry = existing ?? buildMarkerEntry(stop, key)
    if (!entry) continue
    // Bestehenden Punkt fortschreiben statt neu bauen: dieselben Bilder bleiben
    // dekodiert, der Punkt springt nicht.
    entry.stop = stop
    entry.mk.setLngLat(lead.anchor)
    const selectionId = z.selection?.kind === 'medium' ? z.selection.id : null
    entry.el.classList.toggle('on', !!selectionId && stop.items.some((m) => m.id === selectionId))
    entry.el.title =
      stop.items.length > 1
        ? `Halt mit ${stop.items.length} Aufnahmen · ziehen verankert alle neu`
        : `${lead.caption || lead.id} · ${PLACEMENT_NAMES[lead.placement] ?? lead.placement}, ziehen verankert neu`
    marker.set(key, entry)
    for (const m of stop.items) {
      mediaMarker.set(m.id, entry.el)
      markerToId.set(m.id, entry.mk)
    }
  }

  // Was es nicht mehr gibt (Halt zerfallen, Aufnahme gelöscht), verschwindet
  for (const [key, entry] of marker) {
    if (seen.has(key)) continue
    entry.mk.remove()
    marker.delete(key)
  }

  // Grenz- und Trim-Pins gibt es nicht mehr: WO ein Zustand gilt, beantworten
  // die Bänder der Zeitleiste und der leuchtende Fokus-Abschnitt auf der Karte.
  // Wo der Abspielkopf steht, zeigt der Läufer (setzeLaeufer).
}

/** Kartenpunkt eines Halts aufbauen (einmalig — danach nur noch fortgeschrieben). */
function buildMarkerEntry(stop: Stop, _key: string): MarkerEntry | null {
  const lead = stop.items[0]
  if (!map || !lead?.anchor) return null
  const count = stop.items.length
  const el = document.createElement('div')
  el.className = 'media-dot'
  // Wortliste aller Aufnahmen des Halts — beim Abspielen pulst der Punkt,
  // zu dem die gerade eingeblendete Aufnahme gehört.
  el.dataset['ids'] = stop.items.map((m) => m.id).join(' ')
  const halo = document.createElement('span')
  halo.className = 'halo'
  el.appendChild(halo)
  for (const nr of [2, 1]) {
    if (count > nr) {
      const stack = document.createElement('span')
      stack.className = `stack s${nr}`
      el.appendChild(stack)
    }
  }
  const core = document.createElement('span')
  core.className = 'core'
  const thumb = lead.type === 'photo' || lead.poster ? thumbnailSource(lead) : undefined
  if (thumb) {
    const image = document.createElement('img')
    image.src = thumb
    image.alt = ''
    core.appendChild(image)
  } else {
    core.innerHTML = icon('film')
  }
  el.appendChild(core)
  if (count > 1) {
    const plakette = document.createElement('span')
    plakette.className = 'anzahl'
    plakette.textContent = String(count)
    el.appendChild(plakette)
  }

  const mk = new maplibregl.Marker({ element: el, draggable: true, subpixelPositioning: true })
    .setLngLat(lead.anchor)
    .addTo(map)
  const entry: MarkerEntry = { mk, el, stop }
  let dragged = false
  mk.on('dragstart', () => {
    dragged = true
  })
  mk.on('dragend', () => {
    if (!z) return
    // Beim Ziehen wandert der GANZE Halt: die Abstände der Mitglieder
    // untereinander bleiben, sonst zerfiele er beim ersten Anfassen. Bezug ist
    // der AKTUELLE Halt (eintrag.stopp) — das Element überlebt Renders.
    const current = entry.stop
    const anchorPlayhead = current.items[0]?.anchor
    if (!anchorPlayhead) return
    const target = mk.getLngLat()
    // Karte hat kein Snap-Feedback → ungewolltes Cluster vermeiden.
    const ownIds = new Set(current.items.map((m) => m.id))
    const foreignMeters = mediaDisplay()
      .filter((m) => m.anchor && !m.removed && !ownIds.has(m.id))
      .map((m) => metersToOffset(cumDistances, z!.track, offsetFrom(m)))
    const raw = projectOntoTrack(z.track, target.lng, target.lat)
    const safeMeters = metersWithoutCluster(
      metersToOffset(cumDistances, z.track, raw.point[3]),
      foreignMeters,
    )
    const safe = pointAtOffset(z.track, offsetAtMeters(cumDistances, z.track, safeMeters))
    if (!safe) return
    let next = z.edits
    for (const m of current.items) {
      const dLng = (m.anchor?.[0] ?? anchorPlayhead[0]) - anchorPlayhead[0]
      const dLat = (m.anchor?.[1] ?? anchorPlayhead[1]) - anchorPlayhead[1]
      const p = projectOntoTrack(z.track, safe[0] + dLng, safe[1] + dLat)
      next = withMediaEdit(next, m.id, { anchor: [p.point[0], p.point[1]] })
    }
    z.edits = next
    renderAll()
  })
  el.addEventListener('click', (ev) => {
    ev.stopPropagation()
    if (dragged) {
      dragged = false
      return
    }
    if (!z) return
    // Ist schon ein Mitglied gewählt, bleibt es das — sonst das erste
    const chosen = z.selection?.kind === 'medium' ? z.selection.id : null
    const already = entry.stop.items.find((m) => m.id === chosen)
    z.selection = { kind: 'medium', id: (already ?? (entry.stop.items[0] as MediaView)).id }
    renderAll()
  })
  return entry
}

/** Uhrzeit in der Tour-Zone; Datum nur, wenn es vom Tour-Tag abweicht (mtime-Fallen!). */
function timeText(iso: string): string {
  if (!z) return iso
  try {
    const zone = z.data.time.zone
    const time = new Intl.DateTimeFormat('de-DE', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZone: zone,
    }).format(new Date(iso))
    const dayFmt = new Intl.DateTimeFormat('de-DE', {
      day: '2-digit',
      month: '2-digit',
      timeZone: zone,
    })
    const tag = dayFmt.format(new Date(iso))
    const tourDay = dayFmt.format(new Date(z.data.time.start))
    return tag === tourDay ? time : `${tag}. ${time}`
  } catch {
    return iso
  }
}

/**
 * Fokus-Identität → konkretes Objekt mit Zeitspanne, gegen den AKTUELLEN
 * Overlay-Stand aufgelöst (die Logik liegt DOM-frei in timeline.ts). Liefert
 * null, wenn das Objekt weg ist — der Inspector zeigt dann den Leerzustand.
 */
function clearSelectionOn(): EditorSelectionTarget | null {
  if (!z) return null
  return loeseFokusAufRein(
    z.selection,
    // Anzeige-Sicht: enthält auch das automatisch ermittelte Wetter, damit ein
    // Wetterband beschrieben werden kann, bevor jemand es festschreibt.
    editsForDisplay(),
    splitForDisplay(z.data.segments as EditorSegment[], z.edits, z.data.time.start),
    z.track,
    z.data.time.start,
    mediaDisplay(),
    // Ton-Spannen über die FILM-Achse: `from`/`to` sind seit Etappe 4 nur noch
    // Fallback, und der Inspector muss dasselbe zeigen wie die Leiste.
    (index) => {
      const clip = audioClipFrom(index)
      const curve = currentAxis()?.curve
      if (!clip || !curve) return null
      return {
        fromS: recordingTimeAtFilmTime(curve, clip.filmVon),
        toS: recordingTimeAtFilmTime(curve, clip.filmBis),
      }
    },
  )
}

/** Uhrzeit ohne Sekunden — Inspector-Zeiten sollen überfliegbar sein. */
function clockShort(iso: string): string {
  if (!z) return iso
  try {
    return new Intl.DateTimeFormat('de-DE', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: z.data.time.zone,
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

/** Aufnahmezeit-Offset (s) einer Aufnahme (Anker auf die Linie projiziert). */
function offsetFrom(m: MediaView): number {
  if (!z || !m.anchor) return 0
  return projectOntoTrack(z.track, m.anchor[0], m.anchor[1]).point[3]
}

/** Trackpunkt bei einem Aufnahmezeit-Offset (s) — Umkehrung von offsetVon. */
function trackPointAt(offsetS: number): TrackPoint | null {
  return z ? pointAtOffset(z.track, offsetS) : null
}

// — Ereignis anlegen: Spur-Menüs an der Einfügemarke —
//
// Jede Bahn trägt ein „+". Was dort entsteht, beginnt IMMER an der Marke — das
// ist dieselbe Stelle, die der Abspielkopf zeigt. Früher lag dafür eine
// Knopfleiste in der Sidebar, weit weg von der Bahn, die sie betraf.

let openMenu: HTMLElement | null = null

function closeLaneMenu(): void {
  openMenu?.remove()
  openMenu = null
  document
    .querySelectorAll<HTMLElement>(
      '.lane-plus[aria-expanded="true"], #tray-button[aria-expanded="true"]',
    )
    .forEach((b) => {
      b.setAttribute('aria-expanded', 'false')
    })
}

/** Menü über dem Knopf platzieren (fixed am Body — kein overflow schneidet es ab). */
function showFloatingMenu(content: HTMLElement, button: HTMLElement): void {
  closeLaneMenu()
  document.body.appendChild(content)
  const r = button.getBoundingClientRect()
  const width = content.offsetWidth
  const height = content.offsetHeight
  content.style.left = `${Math.round(Math.max(8, Math.min(r.left, window.innerWidth - width - 8)))}px`
  // Nach oben aufklappen, wenn unten kein Platz ist (die Leiste sitzt unten)
  const bottomPlaceholder = window.innerHeight - r.bottom
  content.style.top =
    bottomPlaceholder > height + 12
      ? `${Math.round(r.bottom + 6)}px`
      : `${Math.round(Math.max(8, r.top - height - 6))}px`
  openMenu = content
  button.setAttribute('aria-expanded', 'true')
}

/** Menü-Eintrag mit optionalem Farbtupfer. */
function menuEntry(text: string, onClick: () => void, color?: string): HTMLElement {
  const b = document.createElement('button')
  b.type = 'button'
  if (color) {
    const point = document.createElement('i')
    point.style.background = color
    b.appendChild(point)
  }
  b.append(text)
  b.addEventListener('click', () => {
    closeLaneMenu()
    onClick()
  })
  return b
}

/** Zeit-Offset der Einfügemarke (Abspielkopf) — Ausgangspunkt jeder Neuanlage. */
function playheadOffset(): number {
  if (!z) return 0
  if (z.cursor) return z.cursor[3]
  const scale = buildScale(z.track)
  return scale?.fromS ?? 0
}

function openLaneMenu(track: string, button: HTMLElement): void {
  if (!z) return
  const start = z.data.time.start
  const fromS = playheadOffset()
  const from = offsetToIso(start, fromS)
  const menu = document.createElement('div')
  menu.className = 'floating-menu'
  const header = document.createElement('div')
  header.className = 'header-row'
  header.textContent = `ab ${clockTimeShort(from)} Uhr`
  menu.appendChild(header)

  if (track === 'travel') {
    for (const [value, name] of Object.entries(TRAVEL_MODE_NAMES)) {
      menu.appendChild(
        menuEntry(
          name,
          () => {
            if (!z) return
            z.edits = withTravelModeBoundary(z.edits, from, value as TravelMode)
            z.selection = { kind: 'travelMode', atS: fromS + 1 }
            renderAll()
          },
          TRAVEL_MODE_COLORS[value as TravelMode],
        ),
      )
    }
  } else if (track === 'camera') {
    for (const [value, name] of Object.entries(PRESET_NAMES)) {
      menu.appendChild(
        menuEntry(
          `Kamera ${name}`,
          () => {
            if (!z) return
            z.edits = withCameraBoundary(z.edits, from, value as CameraPreset)
            z.selection = { kind: 'camera', atS: fromS + 1 }
            renderAll()
          },
          PRESET_COLORS[value as CameraPreset],
        ),
      )
    }
  } else if (track === 'weather') {
    for (const [value, name] of Object.entries(WEATHER_NAMES)) {
      menu.appendChild(
        menuEntry(
          name,
          () => {
            if (!z) return
            // Erst die automatisch ermittelte Einteilung festschreiben, sonst
            // machte die neue Grenze den Rest der Tour schlagartig klar.
            writeWeatherFixed()
            z.edits = withWeatherBoundary(z.edits, from, value as WeatherMode)
            z.selection = { kind: 'weather', atS: fromS + 1 }
            renderAll()
          },
          WEATHER_COLORS[value as WeatherMode],
        ),
      )
    }
  } else if (track === 'moments') {
    for (const [value, name] of Object.entries(MOMENT_NAMES)) {
      menu.appendChild(
        menuEntry(`${MOMENT_GLYPHS[value as CameraMomentKind]}  ${name}`, () => {
          if (!z) return
          z.edits = withCameraMoment(z.edits, from, value as CameraMomentKind)
          z.selection = { kind: 'moment', from }
          renderAll()
        }),
      )
    }
    // Aufnahmen gehören in dieselbe Spur wie die Momente — es ist die Bahn der
    // Szenen. Der Eintrag steht unter dem Trenner, weil er als einziger nicht
    // „ab der Marke" wirkt: Wohin ein Bild fällt, sagt seine eigene Uhrzeit.
    const separator = document.createElement('div')
    separator.className = 'divider'
    menu.appendChild(separator)
    menu.appendChild(
      menuEntry('Aufnahmen hinzufügen …', () => {
        if (canAddMedia()) $('add-file').click()
      }),
    )
  } else if (track === 'music') {
    menu.appendChild(menuEntry('Aus der Bibliothek …', () => openSfxDialog()))
    menu.appendChild(menuEntry('Datei hochladen …', () => $('editor-audio-file').click()))
    // Tour-lokal hochgeladene, aber nicht eingesetzte Dateien direkt anbieten
    // (Altbestand — neue Uploads landen in der benutzerweiten Bibliothek)
    const used = new Set((z.edits.audio ?? []).map((a) => a.file))
    const free = (z.data.audio ?? []).filter((d) => !used.has(d.file))
    if (free.length) {
      const separator = document.createElement('div')
      separator.className = 'divider'
      menu.appendChild(separator)
      for (const d of free) {
        const row = menuEntry(d.file, () => {
          if (!z) return
          void insertAudio({ file: d.file, type: 'music', from })
        })
        const travel = document.createElement('button')
        travel.className = 'remove'
        travel.type = 'button'
        travel.textContent = 'löschen'
        travel.title = `${d.file} vom Server löschen (${(d.size / 1048576).toFixed(1)} MB)`
        travel.addEventListener('click', (e) => {
          e.stopPropagation()
          closeLaneMenu()
          void deleteAudioFile(d.file)
        })
        row.appendChild(travel)
        menu.appendChild(row)
      }
    }
  }
  showFloatingMenu(menu, button)
}

// — Ablage: Aufnahmen, die (noch) nicht auf der Strecke liegen —
//
// Unplatzierte (kein GPS, keine passende Zeit) UND gelöschte in einem Fach:
// beides sind Bilder, die es gibt, die aber nicht mitspielen. Von hier zieht man
// sie auf die Zeitleiste — dort, wo sie hingehören.

function trayMedia(): MediaView[] {
  return mediaDisplay().filter((m) => m.removed || !m.anchor)
}

/** Einmal je geöffneter Tour meldet sich die Ablage von selbst. */
let reportedTray = false

function renderTray(): void {
  const button = $('tray-button')
  const media = trayMedia()
  button.hidden = media.length === 0
  // Ohne Ort ≠ entfernt: Ersteres ist ein FUND (die Aufnahme fehlt im Film,
  // ohne dass jemand das wollte), Letzteres eine Entscheidung. Nur der Fund
  // meldet sich laut — sonst übersieht man ihn zwischen leeren Bahnen.
  const withoutLocation = media.filter((m) => !m.removed).length
  button.classList.toggle('warns', withoutLocation > 0)
  // In der Namensspalte steht die ZAHL, der Satz im Titel: Die Spalte ist
  // 168 px breit und teilt sie sich mit Symbol, Name und ⊕ — ein Satz
  // schöbe das ⊕ aus der Zeile. Gezählt wird, was die Farbe erklärt: bei
  // einem Fund die Funde, sonst alles im Fach.
  $('tray-count').textContent = String(withoutLocation || media.length)
  button.title = withoutLocation
    ? withoutLocation === 1
      ? '1 Aufnahme ohne Ort — zum Verankern auf die Bahn ziehen'
      : `${withoutLocation} Aufnahmen ohne Ort — zum Verankern auf die Bahn ziehen`
    : media.length === 1
      ? '1 entfernte Aufnahme'
      : `${media.length} entfernte Aufnahmen`
  button.setAttribute('aria-label', button.title)
  if (withoutLocation > 0 && !reportedTray) {
    reportedTray = true
    button.classList.add('alerting')
    setTimeout(() => button.classList.remove('alerting'), 4200)
  }
  if (openMenu?.dataset['tray'] === '1') openTray() // offenes Fach mitziehen
}

function openTray(): void {
  const button = $('tray-button')
  const menu = document.createElement('div')
  menu.className = 'floating-menu'
  menu.dataset['tray'] = '1'
  const header = document.createElement('div')
  header.className = 'header-row'
  header.textContent = 'auf die Zeitleiste ziehen'
  menu.appendChild(header)
  const raster = document.createElement('div')
  raster.className = 'tray-grid'
  for (const m of trayMedia()) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = m.removed ? 'removed' : ''
    // Entfernt heißt seit dem endgültigen Löschen: entfernt BIS ZUM SPEICHERN.
    // Bis dahin holt ein Zug auf die Zeitleiste die Aufnahme zurück — danach
    // gibt es sie nicht mehr, und das gehört an die Aufnahme geschrieben.
    b.title = m.removed
      ? `${m.caption || m.id} · entfernt, wird beim Speichern endgültig gelöscht`
      : `${m.caption || m.id} · ohne Ort`
    b.dataset['id'] = m.id
    const image = document.createElement('img')
    image.src = thumbnailSource(m)
    image.alt = ''
    b.appendChild(image)
    b.addEventListener('pointerdown', (e) => dragOffTray(e, m))
    raster.appendChild(b)
  }
  menu.appendChild(raster)
  showFloatingMenu(menu, button)
}

// — Aufnahmen nachreichen —
//
// Bilder kamen lange nur beim ANLEGEN herein; danach war die Menge fest. Wer
// abends die Aufnahmen der richtigen Kamera einliest, musste die ganze Tour neu
// hochladen und verlor dabei jeden Schnitt. Der Weg hierher ist deshalb kein
// neuer Screen, sondern ein zweiter Einstieg in einen, den es schon gibt
// (docs/mockups/studio-aufnahmen-nachreichen.html).
//
// Serverseitig ist das die additive Medien-Route: Manifest-Einträge anmelden
// (IDs vergibt der Server), je Datei ein PUT, danach neu verarbeiten.

/** Die im Dialog gezeigte Auswahl: Befund + die zugehörigen Dateien. */
let addMediaState: {
  report: AddMediaReport
  files: Map<string, File>
  omitted: Set<string>
} | null = null

/**
 * Läuft gerade ein Upload? Solange bleibt der Dialog zu — auch gegen ESC und
 * das „×". Ein weggeklickter Dialog nähme dem Lauf seine einzige Anzeige: Der
 * Fortschritt steht in seiner Fußzeile, ein Fehler ebenso.
 */
let addMediaRunning = false

/**
 * Die Tour, gegen die eingeordnet wird — Zeitspanne UND Strecke.
 *
 * Die Strecke gehört dazu, weil `bestimmePlatzierung` im Server einen
 * GPS-Anker nur bis 500 m an die Route heranlässt; ohne sie verspräche der
 * Dialog „sitzt sofort auf der Strecke" für ein Foto, das der nächste Render
 * in die Ablage legt.
 */
function addMediaTarget(state: State): AddMediaTarget {
  const distance = distanceFunction(state.track)
  return {
    startMs: Date.parse(state.data.time.start),
    endMs: Date.parse(state.data.time.end),
    ...(distance ? { distanceToRoute: distance } : {}),
  }
}

/**
 * Einzug des Streifens in px — die Punkte sitzen ZWISCHEN den Rändern, sonst
 * schnitte der erste und letzte an der Kante ab (samt seiner Uhrzeit). Steht
 * auch als `--strip-margin` im CSS; beide Zahlen müssen gleich sein.
 */
const STRIP_EDGE = 28

/** Anteil 0–1 → `left` innerhalb der eingezogenen Achse. */
function edgePosition(fraction: number): string {
  return `calc(${STRIP_EDGE}px + ${(fraction * 100).toFixed(2)}% - ${(fraction * 2 * STRIP_EDGE).toFixed(1)}px)`
}

/** EXIF lesen wie beim Anlegen — Aufnahmezeit und Ort stehen in der Datei selbst. */
async function readNewMedia(files: readonly File[], zone: string): Promise<NewMedium[]> {
  const read: NewMedium[] = []
  for (const file of files) {
    const type = mediaType(file.name)
    if (!type) continue
    let timeMs = file.lastModified
    let timeGuessed = true
    let location: [number, number] | null = null
    if (type === 'photo') {
      // Der EXIF-Block steht am DATEIANFANG — 256 KB reichen, und bei dreißig
      // Fotos ist das der Unterschied zwischen „gleich da" und Kaffeepause.
      const exif = readExif(await file.slice(0, 262144).arrayBuffer())
      if (exif.date) {
        timeMs = exifDateToMs(exif.date, zone)
        timeGuessed = false
      }
      if (exif.gps) location = exif.gps
    }
    read.push({ file: file.name, type, timeMs, timeGuessed, location, size: file.size })
  }
  return read
}

function addMediaDialog(): HTMLDialogElement {
  return $('add-dialog') as HTMLDialogElement
}

/**
 * Steht noch etwas Ungespeichertes im Editor?
 *
 * Nachreichen endet mit `reprocess` + `loadData` — und `loadData` baut den
 * Zustand aus der SERVER-Fassung neu auf, samt leerer Undo-Historie. Alles,
 * was nur lokal steht, wäre danach weg. Deshalb fragt der Weg dorthin vorher,
 * statt es kommentarlos zu verwerfen (die Fußzeile des Dialogs verspricht
 * ausdrücklich „Deine Schnitte bleiben").
 */
/**
 * Die Vorschläge unter der Dachzeile.
 *
 * Sie kommen aus derselben Geocoder-Antwort, aus der schon der Ortsname
 * stammt — vorher behielten wir davon einen Treffer einer festen Kette
 * (village ?? town ?? city ?? …) und warfen den Rest weg. Welche Ebene richtig
 * ist, hängt aber daran, wie eine Gegend in OSM erfasst ist: dieselbe Runde
 * ergibt in der Stadt einen Stadtteil und auf dem Land einen Landkreis.
 *
 * Ein Klick SETZT nur den Text, er wählt nichts aus: Das Feld bleibt frei
 * beschreibbar, die Knöpfe sind die Abkürzung. Deshalb auch kein Menü — die
 * Vorschläge sind zu zweit bis zu viert und sollen sichtbar sein, statt sich
 * hinter einem Klick zu verstecken.
 */
function buildBasemapPicker(suggestions: readonly string[]): void {
  const box = $('editor-kicker-layers') as HTMLElement | null
  const field = $('editor-kicker') as HTMLInputElement | null
  if (!box || !field) return
  box.replaceChildren()
  box.hidden = suggestions.length === 0
  for (const value of suggestions) {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = value
    button.setAttribute('aria-pressed', String(field.value.trim() === value))
    button.addEventListener('click', () => {
      // Noch einmal auf denselben Vorschlag: die Zeile wieder loswerden. Sonst
      // müsste man das Feld von Hand leeren, um die Zeile abzuschalten.
      field.value = field.value.trim() === value ? '' : value
      markBasemapPicker()
    })
    box.append(button)
  }
}

/** Welcher Vorschlag steht gerade im Feld? */
function markBasemapPicker(): void {
  const box = $('editor-kicker-layers') as HTMLElement | null
  const field = $('editor-kicker') as HTMLInputElement | null
  if (!box || !field) return
  const value = field.value.trim()
  for (const button of box.querySelectorAll('button'))
    button.setAttribute('aria-pressed', String(button.textContent === value))
}

/**
 * Der Zähler unter der Beschreibung.
 *
 * `maxlength` hält die Eingabe an, sagt aber nichts — und die Grenze ist hier
 * eine gestalterische Angabe und keine technische: Der Text steht im
 * Startscreen des Players und in der Vorschau geteilter Links, und nur unter
 * BESCHREIBUNG_MAX Zeichen bleibt er an beiden Stellen ungekürzt. Bestandstexte
 * dürfen länger sein (das Feld lehnt sie nicht ab); dann zählt der Zähler über
 * die Grenze hinaus und färbt sich.
 */
function countDescription(): void {
  const field = $('editor-description') as HTMLTextAreaElement | null
  const counter = $('editor-description-counter') as HTMLElement | null
  if (!field || !counter) return
  const length = field.value.trim().length
  counter.textContent = `${length} / ${DESCRIPTION_MAX}`
  counter.classList.toggle('knapp', length > DESCRIPTION_MAX)
}

function hasUnsaved(state: State): boolean {
  if (JSON.stringify(state.edits) !== state.saved) return true
  const title = ($('editor-title') as HTMLInputElement).value.trim()
  const description = ($('editor-description') as HTMLTextAreaElement).value.trim()
  const kicker = ($('editor-kicker') as HTMLInputElement).value.trim()
  const finale = ($('editor-finale') as HTMLInputElement).checked
  const finaleTarget = ($('editor-finale-target') as HTMLInputElement).value.trim()
  return (
    (!!title && title !== (state.data.title ?? '')) ||
    description !== (state.data.description ?? '') ||
    // Gegen `?? ''` und nicht gegen null: Ein Feld, das noch nie gesetzt wurde,
    // ist leer — erst wenn jemand etwas hineinschreibt, gibt es eine Änderung.
    kicker !== (state.data.kicker ?? '') ||
    finale !== !!state.data.finale ||
    finaleTarget !== (state.data.finaleTarget ?? '')
  )
}

/**
 * Darf jetzt nachgereicht werden? Gefragt wird VOR der Dateiauswahl (sonst
 * sucht man erst dreißig Fotos zusammen und hört dann „erst speichern") und
 * noch einmal beim Öffnen des Dialogs — der Dateidialog steht offen, während
 * nebenan weitergearbeitet werden kann.
 */
function canAddMedia(): boolean {
  if (!z) return false
  if (hasUnsaved(z)) {
    status(
      'Erst speichern: Beim Hinzufügen baut der Server die Tour neu, und alles, was noch nicht gespeichert ist, ginge dabei verloren.',
      'warnung',
    )
    return false
  }
  return true
}

async function openAddMedia(fileList: FileList | null): Promise<void> {
  if (!z || !fileList?.length) return
  const files = [...fileList]
  const usable = files.filter((d) => mediaType(d.name))
  if (!usable.length) {
    status(
      'Keine brauchbare Datei dabei — es gehen Fotos (JPG, PNG, WebP) und Videos (MP4, MOV, WebM).',
      'fehler',
    )
    return
  }
  if (!canAddMedia()) return
  status('Liest die Aufnahmen …')
  const read = await readNewMedia(usable, z.data.time.zone)
  const report = summarize(read, addMediaTarget(z))
  addMediaState = {
    report,
    files: new Map(usable.map((d) => [d.name, d])),
    omitted: new Set(),
  }
  status('')
  renderAddMedia()
  addMediaDialog().showModal()
}

/** Uhrzeit eines ms-Zeitpunkts in der Tour-Zone (der Streifen zeigt die Uhr). */
function clockTimeFromMs(ms: number): string {
  if (!z || !Number.isFinite(ms)) return '—'
  try {
    return new Intl.DateTimeFormat('de-DE', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: z.data.time.zone,
    }).format(new Date(ms))
  } catch {
    return '—'
  }
}

function renderAddMedia(): void {
  if (!z || !addMediaState) return
  const { report, omitted } = addMediaState
  const included = report.media.filter((a) => !omitted.has(a.file))
  // Zahl und Megabyte beschreiben DASSELBE: das, was hochgeht. Sonst stünde
  // neben „5 Dateien" die Größe von dreien und niemand sähe, welche gilt.
  const bytes = included.reduce((sum, a) => sum + a.size, 0)
  const countText =
    included.length === report.media.length
      ? `${included.length} ${included.length === 1 ? 'Datei' : 'Dateien'}`
      : `${included.length} von ${report.media.length} Dateien`
  $('add-subtitle').textContent =
    `${z.data.title ?? 'Ohne Titel'} · ${countText} · ${megabyte(bytes)}`

  // — Streifen: was die Tour hat (unten, grau) und was dazukommt (oben, hell) —
  const strip = $('add-strip')
  strip.replaceChildren()
  const axis = document.createElement('div')
  axis.className = 'axis'
  strip.appendChild(axis)
  const span = document.createElement('div')
  span.className = 'span'
  const fromFraction = stripFraction(Date.parse(z.data.time.start), report.fromMs, report.toMs)
  const toFraction = stripFraction(Date.parse(z.data.time.end), report.fromMs, report.toMs)
  span.style.left = edgePosition(fromFraction)
  span.style.width = `calc(${((toFraction - fromFraction) * 100).toFixed(2)}% - ${(
    (toFraction - fromFraction) *
    2 *
    STRIP_EDGE
  ).toFixed(1)}px)`
  strip.appendChild(span)

  const setPoint = (el: HTMLElement, ms: number): void => {
    el.style.left = edgePosition(stripFraction(ms, report.fromMs, report.toMs))
  }
  const existing = z.data.media.filter((m) => Number.isFinite(Date.parse(m.takenAt)))
  for (const m of existing) {
    const p = document.createElement('div')
    p.className = 'add-dot old'
    p.title = `${clockTimeShort(m.takenAt)} Uhr · ${m.caption || m.id}`
    setPoint(p, Date.parse(m.takenAt))
    p.innerHTML = '<i></i>'
    strip.appendChild(p)
  }
  for (const a of included) {
    const p = document.createElement('div')
    p.className = `add-dot new${a.classification === 'tray' ? ' tray' : ''}`
    setPoint(p, a.timeMs)
    const point = document.createElement('i')
    const clock = document.createElement('span')
    clock.className = 'clock'
    clock.textContent =
      a.classification === 'tray' && a.timeGuessed ? 'ohne Zeit' : clockTimeFromMs(a.timeMs)
    // Uhrzeit ÜBER dem Punkt (Flex-Spalte im CSS) — darunter läge sie auf der Achse
    p.append(clock, point)
    p.title = `${a.file} · ${classificationWord(a.classification)}`
    strip.appendChild(p)
  }
  $('add-old-count').textContent = String(existing.length)
  $('add-new-count').textContent = String(included.length)

  // — Die Sätze: je Gruppe einer, nur für Gruppen, die es gibt —
  //
  // Gezählt wird die AUSWAHL (ohne Weggelassene), gemessen aber weiter am
  // ursprünglichen Befund: Der Streifen soll nicht springen, sobald jemand
  // eine Aufnahme weglässt — die Zeitachse ist der Bezug, nicht das Ergebnis.
  const sentences = $('add-sentences')
  sentences.replaceChildren()
  for (const sentence of reportSentences(summarize(included, addMediaTarget(z)))) {
    const li = document.createElement('li')
    li.textContent = sentence
    sentences.appendChild(li)
  }

  // — Zeilen: „Weglassen" NUR, wo es etwas zu entscheiden gibt —
  const rows = $('add-rows')
  rows.replaceChildren()
  for (const a of report.media) {
    const travel = omitted.has(a.file)
    const row = document.createElement('div')
    row.className = `add-row ${a.classification}${travel ? ' remove' : ''}`
    const time = document.createElement('span')
    time.className = 'zeit'
    time.textContent =
      a.classification === 'tray' && a.timeGuessed ? '—' : clockTimeFromMs(a.timeMs)
    const name = document.createElement('span')
    name.className = 'name'
    name.textContent = a.file
    const whereTo = document.createElement('span')
    whereTo.className = 'placement'
    whereTo.textContent = travel ? 'weggelassen' : classificationWord(a.classification)
    row.append(time, name, whereTo)
    // Nur die Aufnahme ohne Zeit und Ort stellt eine Frage — und selbst die hat
    // mit der Ablage eine brauchbare Vorgabe, damit man sie ignorieren kann.
    if (a.classification === 'tray') {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'omit'
      button.textContent = travel ? 'Doch mitnehmen' : 'Weglassen'
      button.addEventListener('click', () => {
        if (travel) omitted.delete(a.file)
        else omitted.add(a.file)
        renderAddMedia()
      })
      row.appendChild(button)
    }
    rows.appendChild(row)
  }

  const release = $('add-go') as HTMLButtonElement
  release.disabled = included.length === 0
  release.textContent =
    included.length === 1 ? '1 Aufnahme hinzufügen' : `${included.length} Aufnahmen hinzufügen`
}

/**
 * Angemeldete Einträge eines gescheiterten Laufs zurücknehmen.
 *
 * Der POST meldet den ganzen Batch auf einmal an; bricht danach ein Upload ab
 * (Netz, Quota), stünden die übrigen Einträge OHNE Datei für immer im
 * Manifest — der Editor zeigt sie (nur Tombstones filtert er), und ein zweiter
 * Klick auf „Hinzufügen" meldete dieselben Dateien ein zweites Mal an. Das
 * Löschen macht daraus Tombstones: nichts liegt mehr, nichts ist mehr
 * sichtbar, und der nächste Versuch beginnt sauber.
 *
 * Rückgabe: was NICHT weggeräumt werden konnte (dann ist auch das Aufräumen
 * am selben Grund gescheitert — meist die Verbindung).
 */
async function takeAddMediaBack(
  tourId: string,
  ids: readonly string[],
  hint: HTMLElement,
): Promise<string[]> {
  const stays: string[] = []
  for (const [i, id] of ids.entries()) {
    hint.textContent = `Wird zurückgenommen … (${i + 1} von ${ids.length})`
    try {
      await api.deleteMedium(tourId, id)
      // Jedes Löschen stößt einen Render an — der nächste Aufruf träfe sonst
      // auf „verarbeitung" (dieselbe Regel wie beim endgültigen Löschen).
      await waitForReady(tourId)
    } catch {
      stays.push(id)
    }
  }
  return stays
}

/**
 * Hochladen und neu verarbeiten.
 *
 * Reihenfolge: erst alle Einträge anmelden (der Server vergibt die IDs), dann
 * je Datei ein PUT, zuletzt „neu verarbeiten". Der letzte Schritt ist bewusst
 * ein VOLLER Lauf und kein Edit-Speichern: Ein neues Foto hat noch keinen
 * Bildbefund im Anreicherungs-Cache — ohne ihn liefe es ohne Wetter-
 * Verfeinerung und ohne Benennung mit.
 *
 * Der Lauf ist GANZ ODER GAR NICHT — wie der POST selbst: Was er anmeldet,
 * nimmt er bei einem Fehler wieder zurück (s. nimmNachreichenZurueck).
 */
async function addAfter(): Promise<void> {
  if (!z || !addMediaState || addMediaRunning) return
  const { report, files, omitted } = addMediaState
  const included = report.media.filter((a) => !omitted.has(a.file))
  if (!included.length) return
  const release = $('add-go') as HTMLButtonElement
  const cancel = $('add-cancel') as HTMLButtonElement
  const closeButton = $('add-close') as HTMLButtonElement
  const hint = $('add-hint')
  addMediaRunning = true
  release.disabled = true
  cancel.disabled = true
  closeButton.disabled = true
  const tourId = z.tourId
  const zone = z.data.time.zone
  // Was der Server in DIESEM Lauf angelegt hat — die Liste für den Rückzug.
  let registeredIds: string[] = []
  try {
    hint.className = 'add-hint'
    hint.textContent = 'Aufnahmen werden angemeldet …'
    const registered = await api.addMedia(
      tourId,
      included.map((a) => ({
        type: a.type,
        file: a.file,
        takenAt: isoWithZone(a.timeMs, zone),
        ...(a.location ? { anchor: a.location } : {}),
      })),
    )
    registeredIds = registered.media.map((m) => m.id)
    for (const [i, entry] of registered.media.entries()) {
      const source = included[i]
      const file = source ? files.get(source.file) : undefined
      if (!file) continue
      hint.textContent = `Lädt ${i + 1} von ${registered.media.length} …`
      await api.uploadMedium(tourId, entry.id, file)
    }
    hint.textContent = 'Die Tour wird neu gebaut …'
    await api.reprocess(tourId)
    await waitForReady(tourId)
    // Ab hier steht alles beim Server — es gibt nichts mehr zurückzunehmen.
    registeredIds = []
    addMediaRunning = false
    addMediaDialog().close()
    addMediaState = null
    await loadData(tourId)
    status(
      included.length === 1
        ? '1 Aufnahme hinzugefügt.'
        : `${included.length} Aufnahmen hinzugefügt.`,
      'ok',
    )
  } catch (error) {
    const reason = (error as Error).message
    hint.className = 'add-hint fehler'
    const stays = registeredIds.length ? await takeAddMediaBack(tourId, registeredIds, hint) : []
    if (stays.length) {
      // Auch das Aufräumen ist gescheitert: Ein zweiter Versuch legte jetzt
      // Doppelungen an, also bleibt der Knopf zu und der Satz sagt, warum.
      hint.textContent = `${reason} — die halb angelegten Aufnahmen ließen sich nicht zurücknehmen. Bitte den Editor neu laden und es noch einmal versuchen.`
      return
    }
    hint.textContent = `${reason} — es wurde nichts hinzugefügt. Du kannst es gleich noch einmal versuchen.`
    release.disabled = false
  } finally {
    // `los` wird hier NICHT freigegeben: Nach dem harten Fehler wäre ein
    // zweiter Versuch eine Doppelung. Die beiden Wege, an denen er wieder
    // gehen darf, schalten ihn selbst frei (weicher Fehler oben,
    // rendereNachreichen beim nächsten Öffnen).
    addMediaRunning = false
    cancel.disabled = false
    closeButton.disabled = false
  }
}

function wireAddMedia(): void {
  const file = $('add-file') as HTMLInputElement
  file.addEventListener('change', () => {
    void openAddMedia(file.files).finally(() => {
      // Zurücksetzen, sonst löst dieselbe Datei beim zweiten Mal kein `change`
      file.value = ''
    })
  })
  $('add-close').addEventListener('click', () => {
    if (!addMediaRunning) addMediaDialog().close()
  })
  $('add-cancel').addEventListener('click', () => {
    if (!addMediaRunning) addMediaDialog().close()
  })
  $('add-go').addEventListener('click', () => void addAfter())
  // ESC geht an den Knöpfen vorbei — während des Laufs schließt es den Dialog
  // sonst mitsamt der einzigen Anzeige, die vom Upload berichtet.
  addMediaDialog().addEventListener('cancel', (e) => {
    if (addMediaRunning) e.preventDefault()
  })
  addMediaDialog().addEventListener('close', () => {
    addMediaState = null
    const hint = $('add-hint')
    hint.className = 'add-hint'
    hint.textContent =
      'Die Tour wird danach neu gebaut — der Film wird länger. Deine Schnitte bleiben.'
  })
}

/**
 * Eine Aufnahme aus der Ablage auf die Zeitleiste ziehen. Über Fenster-Listener
 * (der 54-px-Knopf verlöre bei schnellen Bewegungen die Capture); losgelassen
 * über der Foto-Bahn bekommt sie dort ihren Anker — und ist damit wieder dabei.
 */
function dragOffTray(e: PointerEvent, m: MediaView): void {
  if (e.button !== 0 || !z) return
  e.preventDefault()
  const start = { x: e.clientX, y: e.clientY }
  let ghost: HTMLElement | null = null
  let dropMark: HTMLElement | null = null
  let targetOffsetS: number | null = null

  const onDrag = (ev: PointerEvent): void => {
    if (!ghost && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 5) return
    if (!ghost) {
      ghost = document.createElement('div')
      ghost.className = 'drag-ghost'
      const image = document.createElement('img')
      image.src = thumbnailSource(m)
      image.alt = ''
      ghost.appendChild(image)
      document.body.appendChild(ghost)
    }
    ghost.style.left = `${ev.clientX}px`
    ghost.style.top = `${ev.clientY}px`
    const laneRect = document.getElementById('lane-photos')?.getBoundingClientRect()
    const scale = currentAxis()
    const aboveLane =
      laneRect &&
      scale &&
      ev.clientX >= laneRect.left &&
      ev.clientX <= laneRect.right &&
      ev.clientY >= laneRect.top - 20 &&
      ev.clientY <= laneRect.bottom + 20
    if (aboveLane) {
      targetOffsetS = fractionToOffset(scale, laneFraction(ev.clientX))
      if (!dropMark) {
        dropMark = document.createElement('div')
        dropMark.className = 'drop-marker'
        document.getElementById('lanes')?.appendChild(dropMark)
      }
      dropMark.style.left = timeX(offsetToFraction(scale, targetOffsetS))
    } else if (dropMark) {
      dropMark.remove()
      dropMark = null
      targetOffsetS = null
    }
  }
  const release = (): void => {
    window.removeEventListener('pointermove', onDrag)
    window.removeEventListener('pointerup', release)
    const droppedAt = targetOffsetS // VOR dem Aufräumen sichern
    ghost?.remove()
    dropMark?.remove()
    if (droppedAt === null || !z) return
    suppressClick = true
    const raw = pointAtOffset(z.track, droppedAt)
    if (!raw) return
    // Ablage hat kein Snap — nicht still mit einem Nachbarn clustern.
    const foreignMeters = mediaDisplay()
      .filter((x) => x.anchor && !x.removed && x.id !== m.id)
      .map((x) => metersToOffset(cumDistances, z!.track, offsetFrom(x)))
    const safeMeters = metersWithoutCluster(
      metersToOffset(cumDistances, z.track, raw[3]),
      foreignMeters,
    )
    const point = pointAtOffset(z.track, offsetAtMeters(cumDistances, z.track, safeMeters))
    if (!point) return
    // Wieder dabei: Anker setzen und, falls es entfernt war, zurückholen
    z.edits = withMediaEdit(z.edits, m.id, { anchor: [point[0], point[1]], removed: false })
    z.selection = { kind: 'medium', id: m.id }
    closeLaneMenu()
    renderAll()
  }
  window.addEventListener('pointermove', onDrag)
  window.addEventListener('pointerup', release)
}

// — Inspector-Bausteine —

/** Erklärender Satz unter einem Feld — leise, aber lesbar. */
function hint(text: string): HTMLElement {
  const p = document.createElement('p')
  p.className = 'inspector-hint'
  p.textContent = text
  return p
}

/** Beschriftetes Feld mit einem Bedienelement darin. */
/** Feld mit Beschriftung; `explanation` hängt als ⓘ-Tooltip an der Beschriftung,
 *  statt sie mit einem Nachsatz zu verlängern (Muster wie in der Bibliothek). */
function field(label: string, content: HTMLElement, explanation?: string): HTMLElement {
  const d = document.createElement('div')
  d.className = 'feld'
  const l = document.createElement('label')
  l.textContent = label
  if (explanation) {
    const how = document.createElement('span')
    how.className = 'field-usage'
    how.tabIndex = 0
    how.setAttribute('aria-label', explanation)
    how.innerHTML = icon('info')
    const bubble = document.createElement('span')
    bubble.className = 'field-usage-bubble'
    bubble.setAttribute('role', 'tooltip')
    bubble.textContent = explanation
    how.appendChild(bubble)
    l.appendChild(how)
  }
  d.append(l, content)
  return d
}

/** Auswahl aus Wert→Name-Paaren; `emptyText` ergänzt eine „noch nichts"-Option. */
function selectField(
  values: Array<[string, string]>,
  current: string | undefined,
  emptyText?: string,
): HTMLSelectElement {
  const s = document.createElement('select')
  if (emptyText !== undefined) {
    const o = document.createElement('option')
    o.value = ''
    o.textContent = emptyText
    o.selected = current === undefined
    s.appendChild(o)
  }
  for (const [value, name] of values) {
    const o = document.createElement('option')
    o.value = value
    o.textContent = name
    o.selected = value === current
    s.appendChild(o)
  }
  return s
}

/** Regler mit Zahlenanzeige daneben (Stärke, Kamera-Feinjustierung). */
function slider(
  attr: { min: number; max: number; step: number; value: number },
  display: (v: number) => string,
  onChange: (v: number) => void,
  // Feuert bei JEDER Bewegung (input), nicht erst beim Loslassen — für Live-
  // Wirkung ohne Overlay-Patch je Pixel (der bliebe ein einziger Undo-Schritt).
  onLive?: (v: number) => void,
): HTMLElement {
  const shell = document.createElement('div')
  shell.className = 'with-value'
  const r = document.createElement('input')
  r.type = 'range'
  r.min = String(attr.min)
  r.max = String(attr.max)
  r.step = String(attr.step)
  r.value = String(attr.value)
  const w = document.createElement('span')
  w.className = 'value'
  w.textContent = display(attr.value)
  r.addEventListener('input', () => {
    const v = Number(r.value)
    w.textContent = display(v)
    onLive?.(v)
  })
  r.addEventListener('change', () => onChange(Number(r.value)))
  shell.append(r, w)
  return shell
}

/**
 * Zeitfeld: tippen, mit ▲▼ steppen ODER darüberziehen (5 px ≈ 1 Minute, wie in
 * Final Cut). Gerechnet wird über die Differenz zur angezeigten Uhrzeit
 * (clockDiffToOffset) — das ist DST-fest und übersteht Mitternacht.
 *
 * `onChange` bekommt den neuen Offset in Sekunden und meldet zurück, welcher
 * Offset tatsächlich gilt (geklemmt) — oder null, wenn nichts geschah.
 */
function buildTimeField(
  offsetS: number,
  onChange: (newOffsetS: number) => number | null,
  onDragEnd?: () => void,
): HTMLElement {
  const zf = document.createElement('div')
  zf.className = 'time-field'
  const input = document.createElement('input')
  input.className = 'time-field-input'
  input.type = 'text'
  input.inputMode = 'numeric'
  // Ohne size greift der Browser-Default (~20 Zeichen) als Mindestbreite —
  // zwei Felder nebeneinander passen dann nicht in den Inspector.
  input.size = 5
  input.value = clockTimeShort(offsetToIso(z?.data.time.start ?? '', offsetS))
  let currentS = offsetS

  /** Neuen Wert anwenden und das Feld auf den tatsächlich geltenden Stand ziehen. */
  const apply = (newOffsetS: number): void => {
    const applies = onChange(newOffsetS)
    if (applies !== null) currentS = applies
    input.value = clockTimeShort(offsetToIso(z?.data.time.start ?? '', currentS))
  }

  input.addEventListener('change', () => {
    const next = clockDiffToOffset(
      currentS,
      clockTimeShort(offsetToIso(z?.data.time.start ?? '', currentS)),
      input.value,
    )
    if (next === null) input.value = clockTimeShort(offsetToIso(z?.data.time.start ?? '', currentS))
    else {
      apply(next)
      onDragEnd?.()
    }
  })
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      input.blur()
      return
    }
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    e.preventDefault()
    apply(currentS + (e.key === 'ArrowUp' ? 60 : -60))
    onDragEnd?.()
  })

  const stepper = document.createElement('div')
  stepper.className = 'time-field-step'
  for (const [label, direction] of [
    ['Eine Minute später', 60],
    ['Eine Minute früher', -60],
  ] as const) {
    const b = document.createElement('button')
    b.type = 'button'
    b.setAttribute('aria-label', label)
    b.tabIndex = -1
    b.addEventListener('click', () => {
      apply(currentS + direction)
      onDragEnd?.()
    })
    stepper.appendChild(b)
  }

  // Scrubben über dem Feld: Fenster-Listener (Capture auf dem schmalen Feld
  // verlöre schnelle Bewegungen), 5 px ≈ 1 Minute. Während des Zugs sofort
  // user-select aus — sonst markiert der Browser den Text schon vor dem
  // Scrub-Schwellwert. Erst ab 3 px Fokus weg und Minute mitlaufen lassen.
  zf.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('.time-field-step')) return
    const startX = e.clientX
    const startS = currentS
    let scrubbing = false
    zf.classList.add('dragging')
    const onDrag = (ev: PointerEvent): void => {
      if (!scrubbing && Math.abs(ev.clientX - startX) < 3) return
      if (!scrubbing) {
        scrubbing = true
        zf.classList.add('scrub')
        input.blur()
        window.getSelection()?.removeAllRanges()
      }
      ev.preventDefault()
      apply(startS + Math.round((ev.clientX - startX) / 5) * 60)
    }
    const release = (): void => {
      window.removeEventListener('pointermove', onDrag)
      window.removeEventListener('pointerup', release)
      zf.classList.remove('scrub', 'dragging')
      if (scrubbing) {
        suppressClick = true
        onDragEnd?.()
      }
    }
    window.addEventListener('pointermove', onDrag)
    window.addEventListener('pointerup', release)
  })

  zf.append(input, stepper)
  return zf
}

/**
 * Neu zeichnen OHNE den Inspector — während ein Zeitfeld gezogen wird, darf er
 * nicht neu entstehen: das gezogene Feld verlöre seinen Cursor, und der ganze
 * Zug soll außerdem EIN Undo-Schritt bleiben (renderAlles setzt je Aufruf einen).
 */
function renderWithoutInspector(): void {
  drawTrack()
  renderTimeline()
}

/** Feste Grenze (Tourbeginn/-ende): kein Feld, sondern eine Aussage. */
function timeFixed(text: string): HTMLElement {
  const d = document.createElement('div')
  d.className = 'time-field ro'
  d.textContent = text
  return d
}

/**
 * Inspector: zeigt das fokussierte Objekt mit seinen Werten und Zeiten und
 * lässt es dort ändern. Beginn UND Ende eines Zustands sind bearbeitbar — sie
 * sind dieselbe Kante wie der Anfang des Nachbarn. Tour-Einstellungen sind
 * eine eigene Ansicht (nicht der Leerzustand).
 */
function renderInspector(): void {
  if (!z) return
  const content = $('inspector-content')
  const footer = $('inspector-footer')
  const empty = $('inspector-empty')
  const tourPanel = $('insp-tour')
  content.innerHTML = ''
  footer.innerHTML = ''
  const info = clearSelectionOn()
  // Zeitleisten-Auswahl verdrängt die Tour-Einstellungen
  if (info) z.tourSettings = false
  if (z.tourSettings) {
    empty.hidden = true
    tourPanel.hidden = false
    content.hidden = true
    footer.hidden = true
    return
  }
  tourPanel.hidden = true
  if (!info) {
    empty.hidden = false
    content.hidden = true
    footer.hidden = true
    return
  }
  empty.hidden = true
  content.hidden = false
  footer.hidden = false
  const start = z.data.time.start
  const atS = (info.fromS + info.toS) / 2

  // — Kopf: nur die Art (Kicker). Kein zweiter Titel wie „Wetter Klar" —
  // die Einstellungen darunter legen das bereits fest.
  const kicker = document.createElement('div')
  kicker.className = 'inspector-type'
  kicker.append(KIND_NAMES[info.kind])
  content.append(kicker)

  // — Werte je Art —
  if (info.kind === 'travelMode' || info.kind === 'camera') {
    const isTravelMode = info.kind === 'travelMode'
    const values = isTravelMode ? Object.entries(TRAVEL_MODE_NAMES) : Object.entries(PRESET_NAMES)
    // Das Grundband trägt keinen eigenen Wert — es IST „Standard", also steht
    // das auch in der Liste ausgewählt da. Ein Platzhalter über der Auswahl
    // machte daraus einen vierten, unerreichbaren Zustand.
    const current = isTravelMode
      ? (info.mode as string | undefined)
      : ((info.preset as string | undefined) ?? 'default')
    const picker = selectField(values, current)
    picker.addEventListener('change', () => {
      if (!z || !picker.value) return
      // Ohne eigene Grenze (Band aus der Aufzeichnung) wird am Bandanfang eine
      // neue gesetzt — so lässt sich JEDER Abschnitt direkt umstellen.
      const from = info.from ?? offsetToIso(start, info.fromS)
      const preset = picker.value as CameraPreset
      z.edits = isTravelMode
        ? withTravelModeBoundary(z.edits, from, picker.value as TravelMode)
        : // Die Feinjustierung gehört zu einem gewählten Abstand: „Standard"
          // reicht sie an die Einstellung des Zuschauers weiter und verböge sie.
          withCameraBoundary(
            z.edits,
            from,
            preset,
            preset === 'default' ? undefined : info.intensity,
          )
      z.selection = isTravelMode ? { kind: 'travelMode', atS } : { kind: 'camera', atS }
      renderAll()
    })
    // „Art" statt einer Wiederholung des Panel-Titels — der sagt schon, worum es geht.
    content.appendChild(field(isTravelMode ? 'Art' : 'Kamera-Abstand', picker))

    if (!isTravelMode && info.preset && info.preset !== 'default') {
      const from = info.from ?? offsetToIso(start, info.fromS)
      const preset = info.preset
      content.appendChild(
        field(
          'Näher ↔ Weiter',
          slider(
            { min: 50, max: 200, step: 5, value: Math.round((info.intensity ?? 1) * 100) },
            (v) => `${v} %`,
            (v) => {
              if (!z) return
              z.edits = withCameraBoundary(z.edits, from, preset, v / 100)
              z.selection = { kind: 'camera', atS }
              renderAll()
            },
          ),
        ),
      )
    }
  } else if (info.kind === 'weather') {
    const picker = selectField(
      Object.entries(WEATHER_NAMES),
      info.weatherMode,
      info.weatherMode ? undefined : 'Automatisch',
    )
    picker.addEventListener('change', () => {
      if (!z || !picker.value) return
      // Ändern übernimmt die bisher automatische Einteilung ins Overlay: dieses
      // ersetzt das Auto-Wetter serverseitig VOLLSTÄNDIG. Stärke bei „Klar" weg.
      writeWeatherFixed()
      const from = info.from ?? offsetToIso(start, info.fromS)
      const next = picker.value as WeatherMode
      z.edits = withWeatherBoundary(
        z.edits,
        from,
        next,
        next === 'off' ? undefined : info.intensity,
      )
      z.selection = { kind: 'weather', atS }
      renderAll()
    })
    content.appendChild(field('Wetterlage', picker))
    if (!(z.edits.weather ?? []).length && info.weatherMode) {
      content.appendChild(
        hint(
          'Automatisch ermittelt aus dem Wetterarchiv, an den Fotos nachgeschärft. Die erste Änderung übernimmt die ganze Einteilung zur Bearbeitung.',
        ),
      )
    }
    if (info.weatherMode && info.weatherMode !== 'off') {
      const from = info.from ?? offsetToIso(start, info.fromS)
      const mode = info.weatherMode
      content.appendChild(
        field(
          'Stärke',
          slider(
            {
              min: 0,
              max: 100,
              step: 10,
              value: Math.round((info.intensity ?? WEATHER_DEFAULT_K) * 100),
            },
            (v) => `${v} %`,
            (v) => {
              if (!z) return
              z.edits = withWeatherBoundary(z.edits, from, mode, v / 100)
              z.selection = { kind: 'weather', atS }
              renderAll()
            },
          ),
        ),
      )
    }
  } else if (info.kind === 'moment') {
    const fromFixed = info.from as string
    const picker = selectField(Object.entries(MOMENT_NAMES), info.momentKind)
    picker.addEventListener('change', () => {
      if (!z) return
      z.edits = withCameraMoment(
        z.edits,
        fromFixed,
        picker.value as CameraMomentKind,
        info.durationS,
      )
      renderAll()
    })
    content.appendChild(field('Was die Kamera tut', picker))
    const duration = document.createElement('input')
    duration.type = 'number'
    duration.min = '1'
    duration.max = '30'
    duration.value = info.durationS !== undefined ? String(info.durationS) : ''
    duration.placeholder = `${MOMENT_DEFAULT_S[info.momentKind as CameraMomentKind]} (Standard)`
    duration.addEventListener('change', () => {
      if (!z) return
      const v =
        duration.value.trim() === '' ? undefined : Math.max(1, Math.min(30, Number(duration.value)))
      z.edits = withCameraMoment(z.edits, fromFixed, info.momentKind as CameraMomentKind, v)
      renderAll()
    })
    content.appendChild(field('Dauer in Sekunden', duration))
  } else if (info.kind === 'audio') {
    const index = info.index as number
    const entry = (z.edits.audio ?? [])[index]
    if (entry) content.appendChild(buildAudioFields(index, entry))
  } else {
    const medium = mediaDisplay().find((m) => m.id === info.id)
    if (medium) content.appendChild(buildMediumFields(medium))
  }

  // — Zeiten: Beginn und Ende, beides bearbeitbar, wo eine Grenze dahintersteht —
  if (info.kind !== 'medium') content.appendChild(buildTimes(info))

  // — Fuß: Löschen (Backspace tut dasselbe) —
  const { text, locked, reason } = deleteInfo(info)
  const travel = document.createElement('button')
  travel.className = 'inspector-delete'
  travel.innerHTML = `${icon('trash')}<span>${text}</span>`
  travel.disabled = locked
  if (reason) travel.title = reason
  travel.addEventListener('click', () => deleteSelection())
  footer.appendChild(travel)
}

/** Kicker-Text je Art. */
const KIND_NAMES: Record<EditorSelectionTarget['kind'], string> = {
  travelMode: 'Fortbewegung',
  camera: 'Kamera',
  weather: 'Wetter',
  moment: 'Moment',
  audio: 'Musik & Effekte',
  medium: 'Aufnahme',
}

/**
 * Beginn und Ende eines Zustands. „Endet um" verschiebt die Grenze des
 * NACHFOLGERS — Ende des einen und Anfang des anderen sind dieselbe Kante.
 * Wo keine Overlay-Grenze dahintersteht (Tourbeginn/-ende, Band aus der
 * Aufzeichnung), steht statt des Feldes eine Aussage.
 */
/**
 * Steht dieses Band ganz am Anfang der Tour?
 *
 * Ein Band ohne eigene Grenze beginnt fast immer dort — und dann heißt es für
 * ALLE drei Bahnen dasselbe. Die Fortbewegung sagte hier „aus der Aufzeichnung"
 * und meinte damit die Herkunft ihres WERTES, nicht ihren Beginn; neben Kamera
 * und Wetter („mit dem Tourbeginn") las sich das wie ein Unterschied, den es
 * nicht gibt. Übrig bleibt der eine Fall, in dem es wirklich stimmt: ein Band,
 * das eine Trim-Kante mitten in der Tour anschneidet.
 */
function startsAtTourStart(info: EditorSelectionTarget): boolean {
  const scale = z ? buildScale(z.track) : null
  return !scale || info.fromS <= scale.fromS + 1
}

function buildTimes(info: EditorSelectionTarget): HTMLElement {
  const paar = document.createElement('div')
  paar.className = 'time-pair'
  const pointEvent = info.toS <= info.fromS

  const start =
    info.from && info.kind !== 'audio' && info.kind !== 'medium'
      ? field(
          pointEvent ? 'Zeitpunkt' : 'Beginnt um',
          boundaryTimeField(
            info.kind as BoundaryKind,
            info.from,
            info.fromS,
            (next) => (next + info.toS) / 2,
          ),
        )
      : field(
          'Beginnt',
          timeFixed(startsAtTourStart(info) ? 'mit dem Tourbeginn' : 'aus der Aufzeichnung'),
        )

  if (info.kind === 'audio') {
    const index = info.index as number
    paar.append(
      field(
        'Beginnt um',
        buildTimeField(info.fromS, (next) => setAudioTime(index, 'from', next)),
      ),
      field(
        'Endet um',
        // „Effekt, keine Dauer" stimmt seit Etappe 4 nicht mehr — auch ein Ton
        // der Szene hat eine Länge. Ohne gemessene Datei kennt die Leiste sie
        // nur noch nicht.
        info.toS > info.fromS
          ? buildTimeField(info.toS, (next) => setAudioTime(index, 'to', next))
          : timeFixed('Länge noch unbekannt'),
      ),
    )
    return paar
  }

  paar.appendChild(start)
  if (!pointEvent) {
    paar.appendChild(
      info.nextFrom
        ? field(
            'Endet um',
            boundaryTimeField(
              info.kind as BoundaryKind,
              info.nextFrom,
              info.toS,
              (next) => (info.fromS + next) / 2,
            ),
          )
        : field('Endet', timeFixed('am Tourende')),
    )
  }
  return paar
}

type BoundaryKind = 'travelMode' | 'camera' | 'weather' | 'moment'

/**
 * Zeitfeld, das eine Zustands-Grenze verschiebt.
 *
 * Der ISO-Anker wandert bei JEDER Änderung mit (`fromCurrent`) — sonst suchte der
 * zweite Zugschritt noch nach der ursprünglichen Grenze, fände sie nicht mehr
 * und der Zug bliebe nach dem ersten Ruck stehen. Während des Zugs wird der
 * Inspector NICHT neu gebaut (das Feld verlöre sich selbst); erst am Zugende
 * macht ein voller Render daraus einen Undo-Schritt.
 */
function boundaryTimeField(
  kind: BoundaryKind,
  from: string,
  offsetS: number,
  ref: (newOffsetS: number) => number,
): HTMLElement {
  let fromCurrent = from
  return buildTimeField(
    offsetS,
    (next) => {
      if (!z) return null
      const newFrom = moveBoundary(kind, fromCurrent, next)
      if (!newFrom) return null
      fromCurrent = newFrom
      if (kind !== 'moment') z.selection = { kind, atS: ref(next) }
      renderWithoutInspector()
      return isoToOffset(z.data.time.start, newFrom)
    },
    () => renderAll(),
  )
}

/** Audio-Anfang/-Ende setzen (geklemmt gegen die eigene Spanne). */
/**
 * Zeitfeld eines Ton-Klips („Beginnt um" / „Endet um").
 *
 * Es geht über DIESELBEN Funktionen wie der Zug an der Kante — nicht über
 * `from`/`to`. Seit Etappe 4 haben die keinen Vorrang mehr: Nach dem ersten
 * Kantenzug ist der Klip film-verankert, ein Schreiben auf `from` wäre dann still
 * wirkungslos. Genau die Sorte zweiter Weg, der liegen bleibt.
 *
 * Damit gelten hier auch die Trimm-Regeln: „Endet um" schlägt am Material an
 * (außer bei Loop), „Beginnt um" verschiebt den ganzen Klip und lässt Länge und
 * Datei-Einstieg unberührt.
 */
function setAudioTime(index: number, part: 'from' | 'to', newOffsetS: number): number | null {
  if (!z) return null
  const axis = currentAxis()
  const clip = audioClipFrom(index)
  if (!axis?.curve || !clip) return null
  const start = z.data.time.start
  const targetFilmS = filmToOffset(axis, newOffsetS)
  const patch =
    part === 'from'
      ? moveAudioClip(axis, start, clip, targetFilmS)
      : trimRight(axis, start, clip, targetFilmS).patch
  z.edits = mitAudioPatch(z.edits, index, {
    ...patch,
    startS: patch.startS && patch.startS > 0 ? patch.startS : undefined,
    // `to` ist die alte Endmarke; die Länge steht jetzt in `durationFilmS`. Zwei
    // Quellen für dasselbe Ende wären eine Einladung zum Auseinanderlaufen.
    to: undefined,
  })
  renderAll()
  // Was tatsächlich herauskam, zurück in Aufnahmezeit — das Feld soll den
  // geklemmten Wert zeigen, nicht den getippten.
  const next = audioClipFrom(index)
  const curve = currentAxis()?.curve
  if (!next || !curve) return newOffsetS
  return Math.round(recordingTimeAtFilmTime(curve, part === 'from' ? next.filmVon : next.filmBis))
}

// — Aufnahme-Details (ausklappbar): was in der Datei über die Aufnahme steht —
//
// Die Kameradaten stehen im EXIF-Block der JPEG-Datei, also am DATEIANFANG:
// geholt werden per Range-Request nur die ersten 256 KB, und das auch erst beim
// ersten Aufklappen. Das Panel bleibt dadurch so schnell wie zuvor, und wer die
// Details nie öffnet, lädt nie ein Byte extra.

/** Aufgeklappt? Modulweit, damit ein Render den Bereich nicht wieder zuklappt. */
let infoOpen = false
/** EXIF je Medien-ID; null = geladen, aber ohne Kameradaten (oder Fehler). */
const exifCache = new Map<string, ExifCapture | null>()
/** Erste Bytes einer Datei — mehr braucht der EXIF-Block nie. */
const EXIF_BYTES = 262_144

async function loadMediumData(m: MediaView): Promise<ExifCapture | null> {
  try {
    const response = await fetch(m.src, {
      credentials: 'same-origin',
      headers: { range: `bytes=0-${EXIF_BYTES - 1}` },
    })
    if (!response.ok) return null
    const data = readCapture(await response.arrayBuffer())
    return Object.keys(data).length ? data : null
  } catch {
    return null // offline o. Ä. — der Bereich zeigt dann nur die bekannten Angaben
  }
}

/** Zeilen-Paar für das Angaben-Raster. */
function infoRow(label: string, value: string): HTMLElement {
  const z = document.createElement('div')
  z.className = 'inspector-info-row'
  const b = document.createElement('dt')
  b.textContent = label
  const w = document.createElement('dd')
  w.textContent = value
  z.append(b, w)
  return z
}

/** Raster füllen: erst die Angaben aus der Aufzeichnung, dann die aus der Datei. */
function fillInfoGrid(
  raster: HTMLElement,
  m: MediaView,
  exif: ExifCapture | null | undefined,
): void {
  raster.innerHTML = ''
  raster.appendChild(infoRow('Aufgenommen', `${timeText(m.takenAt)} Uhr`))
  raster.appendChild(infoRow('Verortet über', PLACEMENT_NAMES[m.placement] ?? m.placement))
  if (m.anchor) {
    raster.appendChild(
      infoRow('Koordinaten', `${m.anchor[1].toFixed(5)}, ${m.anchor[0].toFixed(5)}`),
    )
  }
  for (const [label, value] of exif ? describeCapture(exif) : []) {
    raster.appendChild(infoRow(label, value))
  }
  const footer = document.createElement('p')
  footer.className = 'inspector-info-footer'
  footer.textContent =
    exif === undefined
      ? 'Kameradaten werden gelesen …'
      : exif === null
        ? m.type === 'video'
          ? 'Die Videodatei trägt keine auslesbaren Kameradaten.'
          : 'Das Foto trägt keine Kameradaten. Viele Dienste entfernen sie beim Export.'
        : 'Aus der Datei gelesen. Die Aufnahmezeit selbst lässt sich nicht ändern. Verschiebe den Ort, um sie umzuhängen.'
  raster.appendChild(footer)
}

/** Ausklappbarer Info-Bereich einer Aufnahme (nativ über <details>). */
function buildInfoSection(m: MediaView): HTMLElement {
  const block = document.createElement('details')
  block.className = 'insp-info'
  block.open = infoOpen
  const header = document.createElement('summary')
  header.innerHTML = `${icon('info')}<span>Aufnahme-Details</span>${icon('arrow-r')}`
  block.appendChild(header)
  const raster = document.createElement('dl')
  raster.className = 'inspector-info-grid'
  block.appendChild(raster)

  const cached = exifCache.get(m.id)
  fillInfoGrid(raster, m, cached)

  const load = (): void => {
    if (exifCache.has(m.id)) return
    fillInfoGrid(raster, m, undefined) // „wird gelesen …"
    void loadMediumData(m).then((data) => {
      exifCache.set(m.id, data)
      // Nur DIESES Raster nachziehen — ein voller Render risse den Fokus und
      // die Scroll-Position des Panels weg.
      if (raster.isConnected) fillInfoGrid(raster, m, data)
    })
  }
  block.addEventListener('toggle', () => {
    infoOpen = block.open
    if (block.open) load()
  })
  if (block.open) load()
  return block
}

/** Herkunfts-/Beschreibungszeile eines Audio-Eintrags für die Stück-Karte. */
function audioOrigin(a: AudioEntry): string {
  if (a.source === 'library') {
    const eff = sfxEffect(a.file)
    return eff ? `${CATEGORY_NAMES[eff.category]} · ${eff.description}` : 'Bibliothek'
  }
  if (a.source === 'user') {
    const entry = library?.find((d) => d.file === a.file)
    return entry ? `Eigener Upload · ${(entry.size / 1048576).toFixed(1)} MB` : 'Eigener Upload'
  }
  return 'In dieser Tour hochgeladen'
}

/** Felder eines Audio-Eintrags — früher nur über das Sidebar-Panel erreichbar. */
function buildAudioFields(index: number, a: AudioEntry): HTMLElement {
  const shell = document.createElement('div')
  shell.style.display = 'contents'

  // — Das Stück selbst: was läuft, woher es kommt — und der Griff zum Tausch.
  // „Ändern …" öffnet die Bibliothek im Ersetzen-Modus: die Platzierung
  // (ab/bis/Lautstärke) bleibt, nur die Datei wird ausgetauscht.
  const piece = document.createElement('div')
  piece.className = 'inspector-piece'
  const running = preview?.file === a.file
  const previewButton = document.createElement('button')
  previewButton.type = 'button'
  previewButton.className = 'inspector-piece-preview'
  previewButton.innerHTML = running ? '<span class="stop"></span>' : icon('play')
  previewButton.title = running ? 'Vorhören stoppen' : 'Vorhören'
  previewButton.setAttribute('aria-label', previewButton.title)
  previewButton.addEventListener('click', () => {
    if (running) stopPreview()
    else startPreview(a)
    renderInspector()
  })
  const text = document.createElement('div')
  text.className = 'inspector-piece-text'
  const nm = document.createElement('div')
  nm.className = 'inspector-piece-name'
  nm.textContent = audioName(a)
  const from = document.createElement('div')
  from.className = 'inspector-piece-origin'
  from.textContent = audioOrigin(a)
  text.append(nm, from)
  const switchButton = document.createElement('button')
  switchButton.type = 'button'
  switchButton.className = 'inspector-piece-swap'
  switchButton.textContent = 'Ändern …'
  switchButton.title = 'Anderes Stück aus der Bibliothek wählen, die Platzierung bleibt'
  switchButton.addEventListener('click', () => openSfxDialog({ travelMode: 'ersetzen', index }))
  piece.append(previewButton, text, switchButton)
  shell.appendChild(piece)

  // — Rolle, nicht Form.
  //
  // Bis Etappe 4 hieß das hier „Art: Musik (über eine Strecke) / Effekt (ein
  // Zeitpunkt)" — eine Aussage über die FORM. Die stimmt nicht mehr: Beide sind
  // Klips mit Länge, beide können wiederholen, beide mischen sich. Was
  // tatsächlich unterschiedlich bleibt, ist die ROLLE im Film, und die zeigt
  // sich an zwei Stellen im Player: Der Zuschauer-Schalter „Musik" nimmt die
  // Filmmusik weg und lässt den Ton des Ortes stehen, und unter dem eigenen Ton
  // eines Videos taucht die Musik ab, die Umgebung nicht.
  const type = selectField(
    [
      ['music', 'Filmmusik'],
      ['sfx', 'Ton der Szene'],
    ],
    a.type,
  )
  type.addEventListener('change', () => {
    if (!z) return
    const next = type.value as 'music' | 'sfx'
    const k = audioClipFrom(index)
    const axis = currentAxis()
    // Die Rolle ändert die LÄNGE nicht. Zwei Dinge kippten hier früher still:
    // `to` (nur bei Musik erlaubt) fiel beim Wechsel ersatzlos weg, und die
    // Loop-Vorgabe hängt an der Rolle — ein Klip ohne eigenes `loop` hätte sein
    // Verhalten gewechselt, ohne dass jemand etwas dazu gesagt hat.
    const length =
      k && axis
        ? commitAudioClip(axis, z.data.time.start, {
            ...k,
            hasExplicitLength: k.filmBis > k.filmVon,
          })
        : null
    z.edits = mitAudioPatch(z.edits, index, {
      type: next,
      ...(length ?? {}),
      ...(k ? { loop: loopAfterRoleChange(k, next) } : {}),
      to: undefined,
    })
    renderAll()
  })
  shell.appendChild(
    field(
      'Rolle',
      type,
      'Filmmusik verstummt mit dem Musik-Schalter des Zuschauers und taucht unter dem Ton eines Videos ab. Der Ton der Szene bleibt beides Mal stehen.',
    ),
  )

  shell.appendChild(
    field(
      'Lautstärke',
      slider(
        {
          min: 0,
          max: 100,
          step: 5,
          value: Math.round((a.volume ?? STUDIO_GAIN_DEFAULT) * 100),
        },
        (v) => `${v} %`,
        (v) => {
          if (!z) return
          z.edits = mitAudioPatch(z.edits, index, { volume: v / 100 })
          renderAll()
        },
        // Läuft gerade das Vorhören dieses Eintrags, folgt es dem Zug sofort —
        // so stellt man die Lautstärke nach Gehör ein, nicht nach Zahl.
        (v) => {
          if (preview?.file === a.file) preview.audio.volume = v / 100
        },
      ),
    ),
  )

  // — Wiederholung: eine EINSTELLUNG, kein Griff am Klip (docs §2E).
  //
  // Auf dem Klip wäre sie eine Ausnahme, die Lautstärke, Blende und
  // Dateiwechsel nicht auch bekommen könnten; dort steht nur das ⟲-Zeichen.
  const clip = audioClipFrom(index)
  const wdh = document.createElement('label')
  wdh.className = 'kb'
  const wdhBox = document.createElement('input')
  wdhBox.type = 'checkbox'
  wdhBox.checked = a.loop ?? a.type === 'music'
  wdhBox.addEventListener('change', () => {
    if (!z) return
    const axis = currentAxis()
    // Loop AUS heißt: der rechte Materialanschlag gilt wieder — der Klip kommt
    // ans Dateiende zurück, statt mit einem stummen Rest dazustehen. Stille
    // gehört ZWISCHEN die Klips, nie in einen (docs §2E).
    const back = clip && axis ? setLoop(axis, z.data.time.start, clip, wdhBox.checked) : null
    // `loop` nur schreiben, wenn es von der Vorgabe der Rolle abweicht — sonst
    // trüge jedes angefasste Overlay ein Feld, das nichts sagt.
    const fallback = a.type === 'music'
    z.edits = mitAudioPatch(z.edits, index, {
      ...(back ?? {}),
      loop: wdhBox.checked === fallback ? undefined : wdhBox.checked,
    })
    renderAll()
  })
  wdh.append(wdhBox, document.createTextNode('Wiederholen, wenn die Datei zu Ende ist'))
  shell.appendChild(wdh)

  // Was von der Datei zu hören ist — die Auskunft zu den beiden Trimm-Kanten.
  if (clip?.fileS) {
    const length = clip.filmBis - clip.filmVon
    const isTrimmed = clip.startS > 0 || length < clip.fileS - 0.05
    const info = document.createElement('p')
    info.className = 'inspector-hint'
    info.textContent = isTrimmed
      ? `${formatFilmTime(length)} von ${formatFilmTime(clip.fileS)}` +
        (clip.startS > 0 ? ` · ab ${formatFilmTime(clip.startS)} der Datei` : '')
      : `${formatFilmTime(clip.fileS)}, die ganze Datei`
    shell.appendChild(info)
  }

  if (
    z &&
    audioWouldBeDropped(a, z.edits, z.data.time.start, buildScale(z.track) ?? { fromS: 0, toS: 0 })
  ) {
    const warn = document.createElement('p')
    warn.className = 'inspector-warning'
    warn.textContent = 'Liegt außerhalb der Tour und wird beim Rendern verworfen.'
    shell.appendChild(warn)
  }
  return shell
}

/** Felder einer Aufnahme — früher nur über die Medien-Liste erreichbar. */
function buildMediumFields(m: MediaView): HTMLElement {
  const shell = document.createElement('div')
  shell.style.display = 'contents'

  // Der Filmstreifen ist entfallen: Was der Film an diesem Halt TUT, steht
  // seit der Klip-Kette auf der Leiste — umschalten heißt dort einen Klip
  // anklicken, umordnen ihn schieben. Eine zweite Miniaturenreihe im Inspector
  // wäre ein zweiter Weg zur selben Sache, nur ohne Zeitbezug.
  const stop = z ? stopOf(buildStops(mediaDisplay(), z.track, cumDistances), m.id) : undefined

  const imageShell = document.createElement('div')
  imageShell.className = 'inspector-image-wrap'
  const image = document.createElement('img')
  image.className = 'inspector-image'
  image.src = m.type === 'video' ? (m.poster ?? m.src) : m.src
  image.alt = ''
  image.title = m.type === 'video' ? 'Video groß ansehen' : 'Groß ansehen'
  image.addEventListener('click', () => showLarge(m.id))
  imageShell.appendChild(image)
  if (m.type === 'video') {
    const badge = document.createElement('span')
    badge.className = 'inspector-image-badge'
    badge.innerHTML = `${icon('play')}Video`
    imageShell.appendChild(badge)
  }
  shell.appendChild(imageShell)

  // Der Nutzertext wird beim Rendern zur ÜBERSCHRIFT des Foto-Stopps — deshalb
  // hier „Titel", nicht „Bildunterschrift". Die Uhrzeit steht seit dem
  // 2026-08-18 NEBEN dem Titel und nicht darunter (src/card-painter.ts).
  const title = document.createElement('input')
  title.type = 'text'
  title.value = m.caption
  title.placeholder = 'ohne Titel'
  title.addEventListener('change', () => {
    if (!z) return
    z.edits = withMediaEdit(z.edits, m.id, { caption: title.value.trim() })
    renderAll()
  })
  shell.appendChild(
    field(
      'Titel',
      title,
      'Erscheint im Film als Überschrift des Foto-Stopps, rechts daneben stehen Uhrzeit und Kilometerstand.',
    ),
  )

  if (m.type === 'photo') {
    const stop = selectField(
      [
        ['', 'Automatisch (5 s)'],
        ['3', '3 Sekunden'],
        ['5', '5 Sekunden'],
        ['8', '8 Sekunden'],
        ['12', '12 Sekunden'],
        ['20', '20 Sekunden'],
      ],
      m.display?.holdS !== undefined ? String(m.display.holdS) : '',
    )
    stop.addEventListener('change', () => {
      if (!z) return
      const v = stop.value === '' ? undefined : Number(stop.value)
      const d = { ...m.display }
      if (v === undefined) delete d.holdS
      else d.holdS = v
      z.edits = withMediaEdit(z.edits, m.id, { display: d })
      renderAll()
    })
    shell.appendChild(field('Standzeit', stop))

    const kb = document.createElement('label')
    kb.className = 'kb'
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.checked = m.display?.kenBurns !== false
    box.addEventListener('change', () => {
      if (!z) return
      const d = { ...m.display }
      if (box.checked) delete d.kenBurns
      else d.kenBurns = false
      z.edits = withMediaEdit(z.edits, m.id, { display: d })
      renderAll()
    })
    kb.append(box, document.createTextNode('Langsam heranfahren (Ken Burns)'))
    shell.appendChild(kb)
  }

  const buttons = document.createElement('div')
  buttons.className = 'inspector-buttons'
  // „Auf der Karte platzieren" NUR für Aufnahmen ohne Ort: liegt eine erst
  // einmal auf der Strecke, verschiebt man sie direkt — Punkt auf der Karte
  // ziehen (Ort zeigen) oder Miniatur in der Zeitleiste (Zeit zeigen). Ein
  // Knopf, der denselben Zug über einen Modus nachbaut, wäre ein dritter Weg
  // zum selben Anker. Ohne Anker gibt es dagegen keinen Punkt zum Anfassen.
  if (!m.anchor) {
    const place = document.createElement('button')
    place.textContent = z?.place === m.id ? 'Platzieren abbrechen' : 'Auf der Karte platzieren'
    if (z?.place === m.id) place.classList.add('aktiv')
    place.addEventListener('click', () => {
      if (!z) return
      z.place = z.place === m.id ? null : m.id
      renderAll()
    })
    buttons.appendChild(place)
  }
  if (m.placement === 'manual') {
    const back = document.createElement('button')
    back.textContent = 'Automatischen Ort zurückholen'
    back.addEventListener('click', () => {
      if (!z) return
      z.edits = withMediaEdit(z.edits, m.id, { anchor: undefined })
      renderAll()
    })
    buttons.appendChild(back)
  }
  if (buttons.childElementCount) shell.appendChild(buttons)

  shell.appendChild(buildInfoSection(m))

  if (stop && stop.items.length > 1) {
    // Was der Halt im fertigen Film wirklich kostet: die Summe seiner
    // Aufnahmen — ein Video mit seiner Laufzeit, ein Foto mit seiner Standzeit.
    const sum = stop.items.reduce((sum, x) => sum + mediumHoldS(x), 0)
    const row = document.createElement('div')
    row.className = 'stop-total'
    const links = document.createElement('span')
    links.textContent = `Halt insgesamt · ${stop.items.length} Aufnahmen`
    const right = document.createElement('b')
    right.textContent = `${Math.round(sum)} s`
    row.append(links, right)
    shell.appendChild(row)
    const hint = document.createElement('p')
    hint.className = 'inspector-note'
    hint.textContent =
      'Auf der Zeitleiste liegt jede Aufnahme als eigener Klip: innerhalb des Halts ziehen ordnet sie um, darüber hinaus löst sie heraus und gibt ihr einen eigenen Ort. Die rechte Kante eines Fotos zieht seine Standzeit; der Punkt auf der Karte bewegt den ganzen Halt.'
    shell.appendChild(hint)
  }
  return shell
}

/**
 * Großansicht einer Aufnahme — wie im Mockup: dunkler Overlay, Blättern durch
 * alle (nicht gelöschten) Aufnahmen der Tour, Esc / Klick auf den Grund schließt.
 */
function showLarge(id: string): void {
  closeLarge()
  if (!z) return
  const list = largeList()
  const idx = list.findIndex((m) => m.id === id)
  const m = idx >= 0 ? list[idx] : mediaDisplay().find((x) => x.id === id)
  if (!m) return
  const i = idx >= 0 ? idx : 0
  const n = Math.max(list.length, 1)

  const el = document.createElement('div')
  el.className = 'lightbox'
  el.setAttribute('role', 'dialog')
  el.setAttribute('aria-modal', 'true')
  el.setAttribute('aria-label', 'Großansicht')

  const to = document.createElement('button')
  to.type = 'button'
  to.className = 'lightbox-close'
  to.setAttribute('aria-label', 'Schließen')
  to.innerHTML = icon('x')
  to.addEventListener('click', closeLarge)

  const links = document.createElement('button')
  links.type = 'button'
  links.className = 'browse links'
  links.setAttribute('aria-label', 'Vorige')
  links.innerHTML = icon('arrow-l')
  links.disabled = i <= 0
  links.addEventListener('click', () => {
    const prev = list[i - 1]
    if (prev) showLarge(prev.id)
  })

  const right = document.createElement('button')
  right.type = 'button'
  right.className = 'browse right'
  right.setAttribute('aria-label', 'Nächste')
  right.innerHTML = icon('arrow-r')
  right.disabled = i >= n - 1
  right.addEventListener('click', () => {
    const after = list[i + 1]
    if (after) showLarge(after.id)
  })

  const figure = document.createElement('figure')
  if (m.type === 'video') {
    const video = document.createElement('video')
    video.src = m.src
    video.controls = true
    video.autoplay = true
    video.loop = true
    video.playsInline = true
    figure.appendChild(video)
  } else {
    const img = document.createElement('img')
    img.src = m.src
    img.alt = m.caption || ''
    figure.appendChild(img)
  }

  const cap = document.createElement('figcaption')
  const gt = document.createElement('div')
  gt.className = 'lightbox-title'
  gt.textContent = m.caption || (m.type === 'video' ? 'Video' : 'Aufnahme')
  if (m.type === 'video') {
    const chip = document.createElement('span')
    chip.className = 'lightbox-title-video'
    chip.textContent = 'Video'
    gt.appendChild(chip)
  }
  const gm = document.createElement('div')
  gm.className = 'lightbox-meta'
  const parts: string[] = [`${clockTimeShort(m.takenAt)} Uhr`]
  if (m.anchor) {
    const meters = metersToOffset(cumDistances, z.track, offsetFrom(m))
    parts.push(`km ${kmText(meters)}`)
  } else {
    parts.push('ohne Ort')
  }
  parts.push(`${i + 1} von ${n}`)
  gm.textContent = parts.join(' · ')
  cap.append(gt, gm)
  figure.appendChild(cap)

  el.append(to, links, right, figure)
  el.addEventListener('click', (ev) => {
    if (ev.target === el) closeLarge()
  })
  document.body.appendChild(el)
  stopsPlay()
}

/** Aufnahmen in Tour-Reihenfolge (Stopps entlang der Strecke, sonst Aufnahmezeit). */
function largeList(): MediaView[] {
  if (!z) return []
  const all = mediaDisplay().filter((m) => !m.removed)
  const stops = buildStops(all, z.track, cumDistances)
  const seen = new Set<string>()
  const list: MediaView[] = []
  for (const s of stops) {
    for (const m of s.items) {
      list.push(m)
      seen.add(m.id)
    }
  }
  // Unplatzierte (Ablage) ans Ende, nach Aufnahmezeit
  const rest = all
    .filter((m) => !seen.has(m.id))
    .sort((a, b) => Date.parse(a.takenAt) - Date.parse(b.takenAt))
  return list.concat(rest)
}

function closeLarge(): void {
  document.querySelector('.lightbox')?.remove()
}

/** Was der Löschknopf tut — und wann er gesperrt ist. */
function deleteInfo(info: EditorSelectionTarget): {
  text: string
  locked: boolean
  reason?: string
} {
  if (info.kind === 'medium') {
    const m = mediaDisplay().find((x) => x.id === info.id)
    return { text: m?.type === 'video' ? 'Video entfernen' : 'Foto entfernen', locked: false }
  }
  if (info.kind === 'audio') return { text: 'Aus der Tour nehmen', locked: false }
  if (info.kind === 'moment') return { text: 'Moment entfernen', locked: false }
  // Das ERSTE Band hat keine eigene Grenze (es gilt von Anfang an). Entfernen
  // heißt hier: die Grenze an seinem ENDE rutscht an den Tour-Anfang, das
  // zweite Band nimmt seinen Platz ein. Das geht nur, wenn es ein zweites gibt
  // — sonst wäre die Bahn danach leer, und eine lückenlose Bahn ist die ganze
  // Idee der Zustandsbänder.
  if (startsAtTourStart(info) && !info.nextFrom) {
    return {
      text: 'Abschnitt entfernen',
      locked: true,
      reason:
        'Dieser Zustand deckt die ganze Tour, es gibt keinen zweiten, der seinen Platz einnehmen könnte.',
    }
  }
  return { text: 'Abschnitt entfernen', locked: false }
}

/**
 * Das fokussierte Objekt löschen — Knopf im Fuß oder Backspace/Entf. Bei
 * Zustands-Bändern verschwindet die GRENZE: der vorherige Zustand gilt dann
 * weiter, die Tour bleibt lückenlos gedeckt.
 */
function deleteSelection(): void {
  if (!z) return
  const info = clearSelectionOn()
  if (!info || deleteInfo(info).locked) return
  // Das vorderste Band geht einen eigenen Weg (s. loescheErstesBand) — und
  // zwar an seiner LAGE erkannt, nicht daran, ob es eine eigene Grenze hat.
  // Nach dem ersten Löschen hat es eine: Sie zu entfernen machte das Band
  // wieder implizit, ohne dass sich sichtbar etwas änderte — man musste
  // zweimal löschen, und der erste Klick sah wie ein Fehlschlag aus.
  if (STATE_KINDS.has(info.kind) && startsAtTourStart(info) && info.nextFrom) {
    deleteFirstBand(info)
    return
  }
  // Beim Modus zählt die Kante, nicht das Band: fällt sie weg, gilt der Modus
  // davor weiter. Für erkannte Kanten muss die Aufteilung erst festgeschrieben
  // sein, sonst gäbe es gar nichts zu entfernen.
  if (info.kind === 'travelMode' && info.from) {
    if (!writeTravelModesFixed(info.from)) return
    z.edits = withoutTravelModeBoundary(z.edits, info.from)
  } else if (info.kind === 'camera' && info.from)
    z.edits = withoutCameraBoundary(z.edits, info.from)
  else if (info.kind === 'weather' && info.from) {
    // Wie beim Modus: die automatisch ermittelte Einteilung erst festschreiben,
    // sonst löschte man eine Grenze, die im Overlay noch gar nicht steht.
    if (!writeWeatherFixed()) return
    z.edits = withoutWeatherBoundary(z.edits, info.from)
  } else if (info.kind === 'moment' && info.from) z.edits = withoutCameraMoment(z.edits, info.from)
  else if (info.kind === 'audio' && info.index !== undefined)
    z.edits = withoutAudioEntry(z.edits, info.index)
  else if (info.kind === 'medium' && info.id)
    z.edits = withMediaEdit(z.edits, info.id, { removed: true })
  else return
  z.selection = null
  renderAll()
}

/**
 * Das erste Band einer Zustandsbahn entfernen.
 *
 * Bei jedem anderen Band fällt seine eigene Grenze weg und der Zustand DAVOR
 * gilt weiter. Das erste hat keine solche Grenze — davor liegt nichts. Es
 * verschwindet stattdessen dadurch, dass die Grenze an seinem ENDE an den
 * Tour-Anfang rutscht: Das zweite Band deckt dann von Sekunde 0, die Bahn
 * bleibt lückenlos, und keine spätere Grenze verschiebt sich.
 *
 * Modus und Wetter müssen vorher festgeschrieben werden (`writeTravelModesFixed` /
 * `writeWeatherFixed`) — was die Automatik erkannt hat, steht bis dahin gar
 * nicht im Overlay und ließe sich weder verschieben noch entfernen.
 */
function deleteFirstBand(info: EditorSelectionTarget): void {
  if (!z) return
  const old = info.nextFrom
  if (!old) return
  const scale = buildScale(z.track)
  if (!scale) return
  // Hat das Band bereits eine eigene Grenze, wird GENAU die überschrieben —
  // sonst bliebe sie als haarfeines Band davor stehen.
  const start = info.from ?? offsetToIso(z.data.time.start, scale.fromS)
  if (info.kind === 'travelMode') {
    if (!writeTravelModesFixed(old)) return
    const mode = z.edits.travelModes?.find((g) => g.from === old)?.mode
    if (!mode) return
    // `withTravelModeBoundary` ersetzt eine Grenze auf demselben Zeitpunkt — nach dem
    // Festschreiben liegt am Tour-Anfang bereits eine.
    z.edits = withTravelModeBoundary(withoutTravelModeBoundary(z.edits, old), start, mode)
  } else if (info.kind === 'camera') {
    const g = z.edits.camera?.find((x) => x.from === old)
    if (!g) return
    z.edits = withCameraBoundary(withoutCameraBoundary(z.edits, old), start, g.preset, g.scale)
  } else if (info.kind === 'weather') {
    if (!writeWeatherFixed()) return
    const g = z.edits.weather?.find((x) => x.from === old)
    if (!g) return
    z.edits = withWeatherBoundary(withoutWeatherBoundary(z.edits, old), start, g.mode, g.intensity)
  } else return
  // Nach dem Löschen ist NICHTS ausgewählt — wie bei jedem anderen Objekt.
  // Den Fokus auf das nachrückende Band zu setzen sähe aus, als hätte man
  // etwas ausgewählt, und das Band unter dem Zeiger ist ein anderes als das,
  // das man eben noch anfasste.
  z.selection = null
  renderAll()
}

function removeButton(action: () => void): HTMLButtonElement {
  const button = document.createElement('button')
  button.textContent = 'Entfernen'
  button.addEventListener('click', () => {
    action()
    renderAll()
  })
  return button
}

function mediaDisplay(): MediaView[] {
  if (!z) return []
  return effectiveMedia(z.data.media as MediaBase[], z.edits)
}

/** Karte zum Anker fliegen + Marker pulsieren lassen (Liste→Karte-Sync). */
function flyToMedium(m: MediaView): void {
  if (!map || !m.anchor) return
  map.flyTo({ center: m.anchor, zoom: Math.max(map.getZoom(), 15), duration: 700 })
  const el = mediaMarker.get(m.id)
  if (el) {
    el.classList.remove('pulse')
    void el.offsetWidth // Animation neu starten
    el.classList.add('pulse')
  }
}

// — Musik & Effekte (Audio-Assets + Overlay-Einträge) —

/**
 * Länge aller Ton-Dateien der Tour messen, die noch keine hat.
 *
 * `preload='metadata'` holt nur den Kopf der Datei, nicht die Audiodaten. Jede
 * Datei wird höchstens EINMAL angefasst (auch bei Fehlschlag) — sonst zöge ein
 * kaputter Verweis bei jedem Render eine neue Anfrage nach sich.
 */
function measureAudioDurations(): void {
  if (!z) return
  const tourId = z.tourId
  let open = 0
  for (const a of z.edits.audio ?? []) {
    if (audioMeasured.has(a.file)) continue
    audioMeasured.add(a.file)
    open++
    const el = new Audio()
    el.preload = 'metadata'
    const done = (duration: number | null): void => {
      if (duration !== null && Number.isFinite(duration) && duration > 0)
        audioDurations.set(a.file, duration)
      el.removeAttribute('src')
      // Erst wenn ALLE offenen Messungen durch sind, einmal neu zeichnen —
      // je Datei zu rendern hieße bei zehn Klips zehn Neuaufbauten.
      if (--open === 0 && z) renderTimeline()
    }
    el.addEventListener('loadedmetadata', () => done(el.duration), { once: true })
    el.addEventListener('error', () => done(null), { once: true })
    el.src = audioUrl(a, tourId)
  }
}

// — Wellenform —
//
// Sie zeigt die DATEI, nicht den Klip: hinter dem Klip liegt der volle
// Datei-Streifen, um den Einstieg nach links geschoben. Beim Trimmen wandert
// dadurch der AUSSCHNITT — man sieht, was man wegschneidet. Auf Klipbreite
// gestaucht sähe jeder Trim wie ein Tempowechsel aus.
//
// Gezeichnet wird aus ECHTEN Ausschlägen (`decodeAudioData`), nicht aus einem
// Muster: Eine erfundene Wellenform sähe aus wie eine Aussage über den Inhalt
// und wäre keine. Der Preis ist ein Decode je Datei — einmalig, lazy, und das
// Ergebnis ist ein kleines PNG, das als Hintergrundbild kachelt.

/** Fertige Wellenform-Bilder je Datei (data-URL) bzw. `null` = geht nicht. */
const waveformImages = new Map<string, string | null>()

/** Auflösung des Streifens — 900 Balken reichen für jede Zoomstufe der Leiste. */
const WAVE_BAR = 900

/**
 * Wellenform einer Datei besorgen und beim Eintreffen einmal neu zeichnen.
 *
 * Höchstens EIN Versuch je Datei (auch bei Fehlschlag): Ein nicht dekodierbares
 * Format zöge sonst bei jedem Render einen neuen Download nach sich.
 */
function getWave(file: string, url: string): string | null {
  const done = waveformImages.get(file)
  if (done !== undefined) return done
  waveformImages.set(file, null) // Platzhalter: markiert „läuft/erledigt"
  void (async () => {
    try {
      const raw = await (await fetch(url)).arrayBuffer()
      const ctx = new AudioContext()
      const buffer = await ctx.decodeAudioData(raw)
      void ctx.close()
      waveformImages.set(file, drawWave(buffer))
    } catch {
      // Kein Web-Audio, kein Netz, unbekanntes Format: der Klip bleibt schlicht.
      waveformImages.set(file, null)
    }
    if (z) renderTimeline()
  })()
  return null
}

/** Spitzenwerte je Balken zu einem PNG-Streifen (transparent + helle Balken). */
function drawWave(buffer: AudioBuffer): string | null {
  const canvas = document.createElement('canvas')
  canvas.width = WAVE_BAR
  canvas.height = 44
  const g = canvas.getContext('2d')
  if (!g) return null
  const data = buffer.getChannelData(0)
  const perBar = Math.max(1, Math.floor(data.length / WAVE_BAR))
  g.fillStyle = 'rgba(255, 255, 255, 0.5)'
  for (let i = 0; i < WAVE_BAR; i++) {
    let peak = 0
    const from = i * perBar
    // Nicht mitteln, sondern die SPITZE nehmen: gemittelt sieht jede Musik aus
    // wie derselbe flache Balken, und man erkennt keinen Einsatz mehr.
    for (let j = from; j < from + perBar && j < data.length; j++) {
      const value = Math.abs(data[j] as number)
      if (value > peak) peak = value
    }
    const h = Math.max(1, peak * canvas.height)
    g.fillRect(i, (canvas.height - h) / 2, 1, h)
  }
  return canvas.toDataURL('image/png')
}

/**
 * Länge einer Ton-Datei besorgen — aus dem Cache oder frisch gemessen.
 *
 * Dieselbe Technik wie `measureAudioDurations` (nur der Dateikopf), aber wartend:
 * Beim EINSETZEN muss die Länge vorliegen, bevor der Klip entsteht — sonst
 * müsste er nachträglich zucken.
 */
async function getAudioDuration(a: AudioEntry): Promise<number | null> {
  const known = audioDurations.get(a.file)
  if (known !== undefined) return known
  if (!z) return null
  const url = audioUrl(a, z.tourId)
  return new Promise<number | null>((done) => {
    const el = new Audio()
    el.preload = 'metadata'
    const reply = (duration: number | null): void => {
      el.removeAttribute('src')
      if (duration !== null && Number.isFinite(duration) && duration > 0) {
        audioDurations.set(a.file, duration)
        done(duration)
      } else done(null)
    }
    el.addEventListener('loadedmetadata', () => reply(el.duration), { once: true })
    el.addEventListener('error', () => reply(null), { once: true })
    audioMeasured.add(a.file)
    el.src = url
  })
}

/**
 * Einen neuen Ton-Klip einsetzen — mit der Länge seines MATERIALS und ohne
 * Wiederholung.
 *
 * Beides gehört zusammen: „nicht wiederholen" allein ließe einen Musik-Klip
 * entstehen, der bis zum Tour-Ende reicht, aber nur seine Dateilänge klingt —
 * ein stummer Rest hinter der Wellenform, genau das, was Loop-AUS an einem
 * bestehenden Klip behebt. Ein frisch eingesetztes Stück klingt einmal, so lang
 * wie es ist; alles Weitere (länger ziehen, wiederholen) ist eine Entscheidung.
 *
 * Ein EFFEKT braucht dafür kein einziges Feld: Er wiederholt von Haus aus nicht
 * und ist ohnehin so lang wie seine Datei. Geschrieben wird nur, was von der
 * Vorgabe der Rolle abweicht — sonst trüge jedes Overlay Felder ohne Aussage.
 *
 * Ohne messbare Länge (fehlende Datei, unbekanntes Format) bleibt es bei der
 * Vorgabe: `loop: false` ohne bekanntes Ende erzeugte gerade den stummen Rest,
 * den es zu vermeiden gilt.
 */
async function insertAudio(entry: AudioEntry): Promise<void> {
  if (!z) return
  // Gemessen wird VOR dem Einfügen: so entsteht genau EIN Overlay-Stand — also
  // ein Undo-Schritt — und der Klip steht sofort in seiner endgültigen Form da,
  // statt kurz nach dem Erscheinen zu zucken.
  const fileS = entry.type === 'music' ? await getAudioDuration(entry) : null
  if (!z) return
  const full: AudioEntry = fileS
    ? { ...entry, loop: false, durationFilmS: Math.round(fileS * 1000) / 1000 }
    : entry
  z.edits = withAudioEntry(z.edits, full)
  // Auf das Eingesetzte springen — der Inspector zeigte sonst weiter, was vorher
  // ausgewählt war, und man sucht das gerade Hinzugefügte auf der Spur.
  z.selection = { kind: 'audio', index: (z.edits.audio ?? []).length - 1 }
  renderAll()
}

/** Einen Audio-Eintrag vorhören (bricht ein laufendes Vorhören ab). */
function startPreview(a: AudioEntry): void {
  if (!z) return
  stopPreview()
  // Nie zwei Quellen gleichzeitig: auch ein laufendes Bibliotheks-Vorhören endet.
  if (dialogPlaying) {
    stopDialogPreview()
    buildSfxList()
  }
  const audio = new Audio(audioUrl(a, z.tourId))
  // Mit der eingestellten Lautstärke des Eintrags — 0.8 ist der Standard, den
  // auch der Regler anzeigt; der Zug am Regler passt sie live an (beiLive).
  audio.volume = a.volume ?? STUDIO_GAIN_DEFAULT
  audio.addEventListener('ended', () => {
    stopPreview()
    renderInspector()
  })
  void audio
    .play()
    .catch(() => audioStatus('Vorhören blockiert. Einmal in die Seite klicken.', 'fehler'))
  preview = { audio, file: a.file }
}

function stopPreview(): void {
  if (!preview) return
  preview.audio.pause()
  preview.audio.removeAttribute('src')
  preview.audio.load()
  preview = null
}

/** Audio-Meldungen laufen über dieselbe Statuszeile wie alles andere — es gibt
    kein eigenes Audio-Panel mehr, das eine zweite hätte tragen können. */
const audioStatus = status

/**
 * Upload in die BENUTZERWEITE Bibliothek (nicht mehr tour-lokal): die Datei
 * liegt einmal beim Konto und ist danach in jeder Tour einsetzbar. Aus dem
 * Spur-Menü heißt Hochladen weiterhin auch Einsetzen (Musik ab der Marke);
 * im offenen Dialog landet die Datei nur in „Eigene" — dort entscheidet der
 * nächste Klick, ob sie eingesetzt oder ein Stück damit ersetzt wird.
 */
async function libraryUpload(file: File): Promise<void> {
  if (!z) return
  const extension = file.name.toLowerCase().split('.').pop() ?? ''
  if (!AUDIO_EXTENSIONS.includes(extension)) {
    audioStatus(
      `Nicht unterstützt: .${extension} (erlaubt: ${AUDIO_EXTENSIONS.join(', ')})`,
      'fehler',
    )
    return
  }
  // Dateiname säubern + eindeutig machen (Server verbietet Überschreiben)
  const base = (
    file.name
      .replace(/\.[^.]+$/, '')
      .replace(/[^A-Za-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'audio'
  ).slice(0, 40)
  const existing = new Set((library ?? []).map((d) => d.file))
  let name = `${base}.${extension}`
  for (let n = 2; existing.has(name); n++) name = `${base}-${n}.${extension}`
  audioStatus(`${file.name} wird hochgeladen …`)
  try {
    await api.uploadLibraryAudio(name, file)
  } catch (error) {
    audioStatus((error as Error).message, 'fehler')
    return
  }
  library = [...(library ?? []), { file: name, size: file.size, usedBy: [] }]
  const dialog = $('sfx-dialog') as HTMLDialogElement
  if (dialog.open) {
    // Im Dialog hochgeladen: in „Eigene" zeigen — einsetzen ist der nächste Klick.
    sfxFilter = 'own'
    sfxSearch = ''
    ;($('sfx-search') as HTMLInputElement).value = ''
    buildSfxTabs()
    buildSfxList()
    audioStatus(`„${name}" liegt jetzt in deiner Bibliothek.`, 'ok')
    return
  }
  // Aus dem Spur-Menü: direkt als Musik ab der Marke einsetzen (wie bisher).
  const start = z.data.time.start
  const scale = buildScale(z.track)
  const fromOffset = z.cursor ? z.cursor[3] : (scale?.fromS ?? 0)
  const parallel = overlappingMusic(fromOffset, scale?.toS ?? fromOffset)
  void insertAudio({
    file: name,
    type: 'music',
    from: offsetToIso(start, fromOffset),
    source: 'user',
  })
  audioStatus(
    parallel.length
      ? `Hochgeladen und eingesetzt, läuft gleichzeitig mit ${parallel.join(', ')}. Bereiche an den Kanten zurechtziehen, dann Speichern.`
      : 'Hochgeladen und eingesetzt, Art und Bereich im Panel anpassen, dann Speichern.',
    'ok',
  )
  renderAll()
}

// — Bibliothek „Musik & Effekte" (Dialog) —

let dialogAudio: HTMLAudioElement | null = null
/** Zeilen-ID des gerade vorgehörten Eintrags ('bib:…' | 'eigen:…'). */
let dialogPlaying: string | null = null

function stopDialogPreview(): void {
  dialogAudio?.pause()
  dialogAudio = null
  dialogPlaying = null
}

/**
 * Benutzerweite Bibliothek (eigene Uploads, Kategorie „Eigene") — einmal je
 * Editor-Sitzung geladen, nach Upload/Löschen lokal fortgeschrieben und beim
 * Dialog-Öffnen im Hintergrund aufgefrischt: die Verwendungs-Info (welche Tour
 * nutzt die Datei?) kann sich in anderen Touren geändert haben.
 */
let library: api.LibraryFile[] | null = null
let libraryLoading = false

async function loadLibrary(): Promise<void> {
  if (libraryLoading) return
  libraryLoading = true
  try {
    library = await api.listLibrary()
  } catch {
    // Kein Netz o. Ä.: „Eigene" zeigt den Leerzustand — die kuratierten
    // Kategorien funktionieren unabhängig davon.
  } finally {
    libraryLoading = false
  }
  if (($('sfx-dialog') as HTMLDialogElement).open) {
    buildSfxTabs()
    buildSfxList()
  }
}

/**
 * Was ein Klick in der Bibliothek bewirkt: einen NEUEN Eintrag ab der Marke
 * anlegen — oder das STÜCK des fokussierten Eintrags tauschen („Ändern …" im
 * Panel), wobei Platzierung und Lautstärke unangetastet bleiben.
 */
type SfxTarget = { travelMode: 'einsetzen' } | { travelMode: 'ersetzen'; index: number }
let sfxTarget: SfxTarget = { travelMode: 'einsetzen' }

/** Meldungen zum Dialog-Geschehen: solange er offen ist, in seine eigene
 *  Fußzeile — die Editor-Statuszeile läge unsichtbar hinter dem Backdrop. */
function sfxStatus(text: string, kind?: 'ok' | 'fehler'): void {
  const dialog = $('sfx-dialog') as HTMLDialogElement
  if (!dialog.open) {
    audioStatus(text, kind)
    return
  }
  const el = $('sfx-status')
  el.textContent = text
  el.className = 'sfx-status' + (kind ? ` ${kind}` : '')
}

/**
 * Namen bestehender Musik-Bereiche, die [fromS, toS) überlappen. Überlappung
 * ist ERLAUBT (der Player mischt — Musik plus Atmosphäre ist ein gewollter
 * Fall), aber sie soll beim Einsetzen nie stillschweigend entstehen: die
 * Statusmeldung spricht sie aus, die Zeitleiste stapelt die Klips.
 */
function overlappingMusic(fromS: number, toS: number): string[] {
  if (!z) return []
  const start = z.data.time.start
  const endS = buildScale(z.track)?.toS ?? Infinity
  return (z.edits.audio ?? [])
    .filter((a) => {
      if (a.type !== 'music') return false
      const from = isoToOffset(start, a.from)
      const to = a.to !== undefined ? isoToOffset(start, a.to) : endS
      return from < toS && fromS < to
    })
    .map((a) => `„${audioName(a)}"`)
}

/** Stück übernehmen: einsetzen oder ersetzen (je nach sfxZiel).
 *  `type` null = Art des bestehenden Eintrags behalten (eigene Dateien legen
 *  sich nicht fest); beim Neu-Einsetzen wird daraus Musik. */
function sfxApply(
  file: string,
  source: 'library' | 'user',
  type: SfxType | null,
  name: string,
): void {
  if (!z) return
  if (sfxTarget.travelMode === 'ersetzen') {
    const index = sfxTarget.index
    if (!(z.edits.audio ?? [])[index]) return
    z.edits = mitAudioPatch(z.edits, index, type ? { file, source, type } : { file, source })
    z.selection = { kind: 'audio', index }
    closeSfxDialog()
    renderAll()
    audioStatus(`„${name}" übernommen, Platzierung und Lautstärke bleiben.`, 'ok')
    return
  }
  const start = z.data.time.start
  const scale = buildScale(z.track)
  // Ist ein Punkt gewählt, dort einsetzen (v. a. für One-Shots gemeint) — sonst
  // ab Tour-Beginn, wie beim Upload.
  const fromOffset = z.cursor ? z.cursor[3] : (scale?.fromS ?? 0)
  // VOR dem Einfügen prüfen — sonst zählte der neue Eintrag sich selbst.
  const parallel = type !== 'sfx' ? overlappingMusic(fromOffset, scale?.toS ?? fromOffset) : []
  // Der Dialog geht SOFORT zu — die Längenmessung darf ihn nicht offen halten.
  closeSfxDialog()
  void insertAudio({ file, type: type ?? 'music', from: offsetToIso(start, fromOffset), source })
  audioStatus(
    parallel.length
      ? `„${name}" eingesetzt, läuft gleichzeitig mit ${parallel.join(', ')}. Bereiche an den Kanten zurechtziehen, dann Speichern.`
      : `„${name}" eingesetzt, auf der Zeitleiste platzieren, dann Speichern.`,
    'ok',
  )
}

// Filterzustand der Bibliothek (Art-Tab + Suche) — bleibt über das Öffnen
// hinweg. Kein „Alle"-Tab: ohne Suche zeigt der aktive Reiter seine Art,
// eine Suche geht immer über die GANZE Bibliothek (die Reiter treten zurück).
type SfxFilter = SfxEffect['category'] | 'own'
let sfxFilter: SfxFilter = 'music'
let sfxSearch = ''

// Was die Art im Film TUT — steht an der Gruppenüberschrift, nicht an jeder
// Zeile: Musik und Atmosphäre schleifen über eine Spanne, ein Effekt spielt
// einmal an seiner Marke.
const CATEGORY_MODE: Record<SfxFilter, string> = {
  music: 'läuft über einen Bereich',
  ambience: 'läuft über einen Bereich',
  sfx: 'spielt einmal an seiner Marke',
  own: 'einmal hochgeladen, in jeder deiner Touren einsetzbar',
}
const CATEGORY_LABEL: Record<SfxFilter, string> = {
  music: CATEGORY_NAMES.music,
  ambience: CATEGORY_NAMES.ambience,
  sfx: CATEGORY_NAMES.sfx,
  own: 'Eigene',
}

/** Sekunden als m:ss — für die mitlaufende Zeit beim Vorhören. */
function mmss(s: number): string {
  const whole = Math.max(0, Math.floor(s))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

/**
 * Fortschritt der laufenden Vorschau in DIE gerade spielende Zeile schreiben —
 * ohne Neubau: die Liste würde sonst viermal je Sekunde neu entstehen (Flackern,
 * verlorener Hover). Gesucht wird jedes Mal frisch, damit auch nach einem
 * Filterwechsel die richtige Zeile bedient wird.
 */
function drawSfxProgress(): void {
  const row = document.querySelector<HTMLElement>('#sfx-content .sfx-row.playing')
  if (!row || !dialogAudio) return
  const duration = Number.isFinite(dialogAudio.duration) ? dialogAudio.duration : 0
  row.style.setProperty(
    '--progress',
    duration > 0 ? String(dialogAudio.currentTime / duration) : '0',
  )
  const time = row.querySelector<HTMLElement>('.sfx-time')
  if (time)
    time.textContent =
      duration > 0
        ? `${mmss(dialogAudio.currentTime)} / ${mmss(duration)}`
        : mmss(dialogAudio.currentTime)
}

/** Vorhören umschalten (immer nur eines) und die Liste neu zeichnen. */
function sfxPreview(id: string, url: string): void {
  if (dialogPlaying === id) {
    stopDialogPreview()
  } else {
    stopDialogPreview()
    // Läuft hinter dem Dialog noch das Panel-Vorhören, endet es jetzt — zwei
    // Tonquellen übereinander machen das Aussuchen unmöglich.
    if (preview) {
      stopPreview()
      renderInspector()
    }
    dialogAudio = new Audio(url)
    dialogPlaying = id
    dialogAudio.addEventListener('timeupdate', drawSfxProgress)
    dialogAudio.addEventListener('loadedmetadata', drawSfxProgress)
    dialogAudio.addEventListener('ended', () => {
      stopDialogPreview()
      buildSfxList()
    })
    void dialogAudio
      .play()
      .catch(() => sfxStatus('Vorhören blockiert. Einmal in die Seite klicken.', 'fehler'))
  }
  buildSfxList()
}

/** Aktiven Reiter markieren; bei laufender Suche treten alle zurück
 *  (gesucht wird über die ganze Bibliothek, nicht im Reiter). */
function updateSfxTabs(): void {
  const searching = !!sfxSearch.trim()
  $('sfx-tabs').classList.toggle('searching', searching)
  for (const tab of $('sfx-tabs').querySelectorAll<HTMLElement>('.sfx-tab')) {
    tab.setAttribute('aria-selected', String(!searching && tab.dataset['filter'] === sfxFilter))
  }
}

/** Filter-Tabs aufbauen — neu bei jedem Öffnen und nach dem Laden der eigenen
 *  Bibliothek (deren Zähler hängt an der Antwort des Servers). */
function buildSfxTabs(): void {
  const tabs = $('sfx-tabs')
  tabs.innerHTML = ''
  const number = (f: SfxFilter): string =>
    f === 'own'
      ? library
        ? String(library.length)
        : '…'
      : String(SFX_LIBRARY.filter((e) => e.category === f).length)
  for (const f of ['music', 'ambience', 'sfx', 'own'] as const) {
    const tab = document.createElement('button')
    tab.className = 'sfx-tab'
    tab.type = 'button'
    tab.setAttribute('role', 'tab')
    tab.dataset['filter'] = f
    tab.append(document.createTextNode(CATEGORY_LABEL[f]))
    const count = document.createElement('span')
    count.className = 'z'
    count.textContent = number(f)
    tab.appendChild(count)
    tab.addEventListener('click', () => {
      sfxFilter = f
      // Ein Reiter-Klick beendet die Suche — er sagt „zeig mir diese Art".
      if (sfxSearch) {
        sfxSearch = ''
        ;($('sfx-search') as HTMLInputElement).value = ''
      }
      updateSfxTabs()
      buildSfxList()
    })
    tabs.appendChild(tab)
  }
  updateSfxTabs()
}

/** Ist diese Datei das Stück, das der Ersetzen-Modus gerade tauschen würde? */
function isCurrentPiece(file: string, source: 'library' | 'user'): boolean {
  if (sfxTarget.travelMode !== 'ersetzen' || !z) return false
  const entry = (z.edits.audio ?? [])[sfxTarget.index]
  return !!entry && entry.file === file && entry.source === source
}

/** Nutzt die AKTUELLE (evtl. ungespeicherte) Sitzung diese eigene Datei? */
function insertedThisSession(file: string): boolean {
  return (z?.edits.audio ?? []).some((a) => a.source === 'user' && a.file === file)
}

interface SfxRowDef {
  /** eindeutig über beide Quellen: 'bib:…' bzw. 'eigen:…' */
  id: string
  name: string
  desc: string
  url: string
  file: string
  source: 'library' | 'user'
  /** Katalog-Art; null bei eigenen Dateien (die Art bestimmt der Eintrag) */
  type: SfxType | null
  /** rechte Zusatzangabe (Dateigröße eigener Uploads) */
  meta?: string
  /** nur eigene: löschbar — oder der Grund, warum nicht */
  deletion?: { lockedBecause: string | null }
}

/** Eine Zeile der Bibliothek: hören, lesen, übernehmen — eigene auch löschen. */
function buildSfxRow(def: SfxRowDef): HTMLElement {
  const playing = dialogPlaying === def.id
  const current = isCurrentPiece(def.file, def.source)
  const row = document.createElement('div')
  row.className = 'sfx-row' + (playing ? ' playing' : '') + (current ? ' current' : '')
  row.dataset['file'] = def.file

  const previewButton = document.createElement('button')
  previewButton.type = 'button'
  previewButton.className = 'sfx-preview'
  previewButton.innerHTML = playing ? '<span class="stop"></span>' : icon('play')
  previewButton.title = playing ? 'Vorhören stoppen' : `„${def.name}" vorhören`
  previewButton.setAttribute('aria-label', previewButton.title)
  previewButton.addEventListener('click', () => sfxPreview(def.id, def.url))

  const text = document.createElement('div')
  text.className = 'sfx-text'
  const nm = document.createElement('div')
  nm.className = 'sfx-name'
  nm.textContent = def.name
  if (current) {
    const badge = document.createElement('span')
    badge.className = 'sfx-badge'
    badge.textContent = 'Aktuell'
    nm.appendChild(badge)
  }
  const be = document.createElement('div')
  be.className = 'sfx-description'
  be.textContent = def.desc
  text.append(nm, be)

  const right = document.createElement('div')
  right.className = 'sfx-right'
  // Die Zeit steht erst, wenn wirklich etwas läuft — die Dauer einer Datei
  // kennen wir nicht, ohne sie zu laden, und Geratenes gehört nicht ins Studio.
  if (playing) {
    const time = document.createElement('span')
    time.className = 'sfx-time'
    time.textContent = '0:00'
    right.appendChild(time)
  }
  if (def.meta && !playing) {
    const meta = document.createElement('span')
    meta.className = 'sfx-meta'
    meta.textContent = def.meta
    right.appendChild(meta)
  }
  if (!current) {
    const use = document.createElement('button')
    use.type = 'button'
    use.className = 'sfx-insert'
    use.textContent = sfxTarget.travelMode === 'ersetzen' ? 'Übernehmen' : 'Einsetzen'
    use.title =
      sfxTarget.travelMode === 'ersetzen'
        ? `Das Stück durch „${def.name}" ersetzen, die Platzierung bleibt`
        : `„${def.name}" ab der Marke einsetzen`
    use.addEventListener('click', () => sfxApply(def.file, def.source, def.type, def.name))
    right.appendChild(use)
  }
  if (def.deletion) {
    const { lockedBecause } = def.deletion
    const travel = document.createElement('button')
    travel.type = 'button'
    travel.className = 'sfx-delete'
    travel.innerHTML = icon('trash')
    if (lockedBecause) {
      travel.disabled = true
      travel.title = lockedBecause
    } else {
      travel.title = `„${def.name}" endgültig aus der Bibliothek löschen`
      // Zwei-Klick-Schutz: der erste Klick fragt („Löschen?"), erst der zweite
      // löscht wirklich — ein Dialog im Dialog wäre schwerer als die Sache selbst.
      travel.addEventListener('click', () => {
        if (travel.classList.contains('armed')) {
          void libraryDelete(def.file)
          return
        }
        travel.classList.add('armed')
        travel.innerHTML = '<span>Löschen?</span>'
        setTimeout(() => {
          travel.classList.remove('armed')
          travel.innerHTML = icon('trash')
        }, 3000)
      })
    }
    travel.setAttribute('aria-label', travel.title)
    right.appendChild(travel)
  }

  row.append(previewButton, text, right)
  return row
}

async function libraryDelete(file: string): Promise<void> {
  try {
    await api.deleteLibraryAudio(file)
    library = (library ?? []).filter((d) => d.file !== file)
    sfxStatus(`${file} gelöscht.`, 'ok')
  } catch (error) {
    sfxStatus((error as Error).message, 'fehler')
    // Der Server kennt die Wahrheit (z. B. inzwischen in einer Tour verwendet) —
    // die Verwendungs-Info auffrischen, damit die Sperre sichtbar wird.
    void loadLibrary()
  }
  buildSfxTabs()
  buildSfxList()
}

/** Katalog-Zeilen einer Art, optional nach Suchtext gefiltert. */
function catalogRows(category: SfxEffect['category'], q: string): SfxRowDef[] {
  return SFX_LIBRARY.filter(
    (e) =>
      e.category === category && (!q || `${e.name} ${e.description}`.toLowerCase().includes(q)),
  ).map((e) => ({
    id: `bib:${e.file}`,
    name: e.name,
    desc: e.description,
    url: `/audio/sfx/${encodeURIComponent(e.file)}`,
    file: e.file,
    source: 'library',
    type: e.type,
  }))
}

/** Zeilen der eigenen Uploads, optional nach Suchtext gefiltert. */
function ownRows(q: string): SfxRowDef[] {
  return (library ?? [])
    .filter((d) => !q || d.file.toLowerCase().includes(q))
    .map((d) => {
      const inTours = d.usedBy.map((t) => `„${t.title}"`).join(', ')
      const unsaved = insertedThisSession(d.file)
      return {
        id: `eigen:${d.file}`,
        name: d.file.replace(/\.[^.]+$/, ''),
        desc: [
          d.file.split('.').pop()?.toUpperCase() ?? '',
          inTours
            ? `wird verwendet in ${inTours}`
            : unsaved
              ? 'in dieser Tour eingesetzt (ungespeichert)'
              : 'noch in keiner Tour im Einsatz',
        ]
          .filter(Boolean)
          .join(' · '),
        url: `/api/audio-library/${encodeURIComponent(d.file)}`,
        file: d.file,
        source: 'user',
        type: null,
        meta: `${(d.size / 1048576).toFixed(1)} MB`,
        deletion: {
          lockedBecause: inTours
            ? `Wird noch verwendet in ${inTours}, dort erst den Eintrag entfernen`
            : unsaved
              ? 'In dieser Tour eingesetzt, erst den Eintrag entfernen'
              : null,
        },
      }
    })
}

/** Gestrichelte Kopfzeile der „Eigene"-Kategorie: neue Datei hochladen. */
function buildUploadRow(): HTMLElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'sfx-upload'
  button.innerHTML = `${icon('upload')}<span>Audio-Datei hochladen</span><span class="formats">MP3 · M4A · OGG · WAV</span>`
  button.addEventListener('click', () => $('editor-audio-file').click())
  return button
}

/** Liste nach aktivem Reiter zeichnen — bzw. bei Suche über die ganze Bibliothek. */
function buildSfxList(): void {
  const content = $('sfx-content')
  content.innerHTML = ''
  const q = sfxSearch.trim().toLowerCase()
  const categories: SfxFilter[] = q ? ['music', 'ambience', 'sfx', 'own'] : [sfxFilter]
  let somethingShown = false

  for (const category of categories) {
    const rows = category === 'own' ? ownRows(q) : catalogRows(category, q)
    const ownWithoutSearch = category === 'own' && !q
    if (!rows.length && !ownWithoutSearch) continue
    somethingShown = true

    const header = document.createElement('div')
    header.className = 'sfx-group'
    header.append(
      document.createTextNode(category === 'own' ? 'Eigene Uploads' : CATEGORY_NAMES[category]),
    )
    // Was die Art im Film TUT, steckt hinter einem kleinen ⓘ (Hover UND
    // Tastaturfokus) — als Dauertext neben jeder Überschrift war es Rauschen.
    const how = document.createElement('span')
    how.className = 'sfx-usage'
    how.tabIndex = 0
    how.setAttribute('aria-label', CATEGORY_MODE[category])
    how.innerHTML = `${icon('info')}<span class="sfx-usage-bubble" role="tooltip">${CATEGORY_MODE[category]}</span>`
    header.appendChild(how)
    content.appendChild(header)

    // Der Upload gehört zur Kategorie, nicht in eine Ecke: immer die erste
    // Zeile von „Eigene" — auch (gerade) wenn noch nichts hochgeladen ist.
    if (ownWithoutSearch) content.appendChild(buildUploadRow())
    for (const def of rows) content.appendChild(buildSfxRow(def))
    if (ownWithoutSearch && !rows.length) {
      const empty = document.createElement('div')
      empty.className = 'sfx-empty'
      empty.textContent =
        library === null && libraryLoading
          ? 'Bibliothek wird geladen …'
          : 'Noch keine eigenen Dateien. Was du hochlädst, liegt in deinem Konto und lässt sich in jeder Tour einsetzen.'
      content.appendChild(empty)
    }
  }

  if (!somethingShown) {
    const empty = document.createElement('div')
    empty.className = 'sfx-empty'
    empty.textContent = q ? `Nichts gefunden für „${sfxSearch.trim()}".` : 'Keine Einträge.'
    content.appendChild(empty)
  }
  drawSfxProgress()
}

function openSfxDialog(target: SfxTarget = { travelMode: 'einsetzen' }): void {
  sfxTarget = target
  // Verwendungs-Info kann sich (auch in anderen Touren) geändert haben.
  void loadLibrary()
  const sub = $('sfx-sub')
  if (target.travelMode === 'ersetzen' && z) {
    const entry = (z.edits.audio ?? [])[target.index]
    sub.textContent = entry
      ? `Ersetzt „${audioName(entry)}", Platzierung und Lautstärke bleiben.`
      : ''
    // Den Reiter dorthin stellen, wo das aktuelle Stück wohnt.
    if (entry?.source === 'user') sfxFilter = 'own'
    else if (entry?.source === 'library') sfxFilter = sfxEffect(entry.file)?.category ?? sfxFilter
  } else {
    sub.textContent = 'Vorhören, dann ab der Marke einsetzen'
  }
  const status = $('sfx-status')
  status.textContent = ''
  status.className = 'sfx-status'
  buildSfxTabs()
  buildSfxList()
  ;($('sfx-dialog') as HTMLDialogElement).showModal()
}

function closeSfxDialog(): void {
  stopDialogPreview()
  ;($('sfx-dialog') as HTMLDialogElement).close()
}

function removeAudioEntry(index: number): void {
  if (!z) return
  const entry = (z.edits.audio ?? [])[index]
  if (!entry) return
  if (preview?.file === entry.file) stopPreview()
  z.edits = withoutAudioEntry(z.edits, index)
  // Die Datei bleibt BEWUSST auf dem Server: das Overlay ist erst beim
  // Speichern persistiert, und ein evtl. schon gerendertes tour.json
  // referenziert sie ggf. noch. Eigene Uploads bleiben ohnehin in der
  // Bibliothek liegen und sind dort löschbar, sobald keine Tour sie nutzt.
  audioStatus(
    entry.source === 'user'
      ? 'Eintrag entfernt. Die Datei bleibt in deiner Bibliothek.'
      : entry.source === 'library'
        ? 'Eintrag entfernt.'
        : `Eintrag entfernt, ${entry.file} bleibt gespeichert.`,
    'ok',
  )
  renderAll()
}

async function deleteAudioFile(file: string, silent = false): Promise<void> {
  if (!z) return
  try {
    await api.deleteAudio(z.tourId, file)
    z.data.audio = (z.data.audio ?? []).filter((a) => a.file !== file)
    if (!silent) audioStatus(`${file} gelöscht.`, 'ok')
  } catch (error) {
    if (!silent) audioStatus((error as Error).message, 'fehler')
  }
  renderAll()
}

// — Zeitleiste: Bänder, Pins, Medien-Dots, Audio-Spur —

/** Rollen, bei denen ein Zug eine KANTE verschiebt (Cursor „Rand ziehen"). */
const EDGE_ROLES = new Set(['boundary', 'camera', 'weather', 'audio-from', 'audio-to'])
/** Die drei Zustandsbahnen — nur ihre Kanten laufen entkoppelt (s. starteKantenZug). */
const STATE_EDGES = new Set(['boundary', 'camera', 'weather'])
/** Die drei Bahnen mit lückenlosen Zustandsbändern (nicht: Klips und Punkte). */
const STATE_KINDS = new Set<EditorSelectionTarget['kind']>(['travelMode', 'camera', 'weather'])

interface DragState {
  role: string
  /** Bildschirm-x beim Greifen — Bezug für die Zug-Schwelle. */
  startX: number
  /** Overlay-Identität: ISO-`from` bei Pins, Index bei Audio */
  from?: string
  mode?: TravelMode
  preset?: CameraPreset
  weatherMode?: WeatherMode
  momentKind?: CameraMomentKind
  index?: number
  /** Abstand Cursor↔Balkenanfang beim Greifen (Anteil), für ruckfreies Schieben */
  gripOffset?: number
  /** Dasselbe in FILMsekunden — Ton-Klips rechnen seit Etappe 4 darin. */
  gripOffsetFilmS?: number
  /** Steht die gezogene Trimm-Kante am Material? Fürs Etikett am Zeiger. */
  atLimit?: boolean
  /**
   * Beim pointerdown getroffenes Band. Muss HIER gemerkt werden: nach
   * setPointerCapture zeigt e.target im pointerup auf das Capture-Element
   * (#zeitleiste), nicht mehr auf das Band unter dem Finger.
   */
  selection?: EditorSelection | null
  moved: boolean
}

/** data-Attribute eines Bandes → Fokus-Identität. */
function bandToSelection(el: HTMLElement | null): EditorSelection | null {
  const kind = el?.dataset['selected']
  const atS = Number(el?.dataset['bezugs'])
  if (!Number.isFinite(atS)) return null
  if (kind === 'travelMode') return { kind: 'travelMode', atS }
  if (kind === 'camera') return { kind: 'camera', atS }
  if (kind === 'weather') return { kind: 'weather', atS }
  return null
}

let drag: DragState | null = null

/**
 * Anteil 0..1 der Zeitachse an einer Bildschirm-x-Position. Bezug ist das
 * Maßband-Feld: alle Spuren teilen dieselbe Spalte, eine Referenz genügt.
 * Sein Rect ist bereits gescrollt und gezoomt — die Rechnung stimmt in jeder
 * Zoomstufe ohne Zutun.
 */
function laneFraction(clientX: number): number {
  const ref = document.getElementById('scale-field')
  if (!ref) return 0
  const r = ref.getBoundingClientRect()
  if (r.width <= 0) return 0
  return Math.max(0, Math.min(1, (clientX - r.left) / r.width))
}

/**
 * Eine LÄNGE als Anteil der Achse — das Gegenstück zu `timeX` (einer STELLE).
 *
 * Beides muss in `var(--timeline-width)` gerechnet sein, weil Zoomen die Bahnen
 * nicht neu baut, sondern nur diese Variable fortschreibt. Wer hier Pixel
 * einsetzt, friert das Element auf dem Maßstab des letzten Renders ein.
 */
const timeWidth = (fraction: number): string =>
  `calc(${fraction.toFixed(6)} * var(--timeline-width))`

/** x-Position innerhalb von `.lanes` (Namenspalte + Anteil der Zeitachse). */
const timeX = (fraction: number): string =>
  `calc(var(--lane-x) + ${fraction.toFixed(5)} * var(--timeline-width))`

/** Prozent der Zeitachse — für Kinder von `.band-row`/`.photo-lane`. */
const pos = (fraction: number): string => `${(fraction * 100).toFixed(3)}%`

/** Bahn leeren und zurückgeben (das Gerüst steht statisch in studio.html). */
function track(id: string): HTMLElement {
  const el = $(id)
  el.innerHTML = ''
  return el
}

/**
 * Das Band UNTER dem Zeiger — nicht bloß das getroffene Element.
 *
 * Die Kante liegt als 9-px-Griff ÜBER dem Band und ist dessen Geschwister, kein
 * Vorfahr: `closest('[data-selected]')` findet von dort aus nichts, und ein Klick
 * auf die Kante wählte deshalb gar nichts aus (der Cursor sprang auf
 * „Rand ziehen", und nichts geschah). Die Kante ist ein GRIFF, kein eigenes
 * Objekt — wer sie nur antippt, meint das Band darunter.
 */
function bandUnderPointer(e: PointerEvent): EditorSelection | null {
  const direct = (e.target as HTMLElement).closest<HTMLElement>('[data-selected]')
  if (direct) return bandToSelection(direct)
  for (const el of document.elementsFromPoint(e.clientX, e.clientY)) {
    const treffer = (el as HTMLElement).closest?.<HTMLElement>('[data-selected]')
    if (treffer) return bandToSelection(treffer)
  }
  return null
}

// — Filmzeit-Achse: EINE Quelle für alle Leisten-Abbildungen —
//
// Position auf der Leiste ∝ Filmzeit (buildTimelineAxis in timeline.ts). Die Achse
// hängt an Overlay und Tourdaten; das Overlay wird immutabel fortgeschrieben,
// deshalb genügt ein Referenzvergleich als Cache-Schlüssel. Der Cache ist
// nötig: renderPlayhead läuft bei jedem Scrub-Frame und darf nicht jedes Mal
// die ganze Zerlegung rechnen. Während eines Foto-Zugs (Overlay bis zum
// Loslassen unverändert) bleibt er warm; Kanten-Züge schreiben das Overlay je
// Move fort und bauen neu — das tat renderZeitleiste vorher genauso.
/** Ton-Klips: Abstand von oben und Höhe einer Unterzeile (Spiegel des CSS). */
const AUDIO_LANE_TOP_PX = 3
const AUDIO_LANE_PX = 24

let axisMemo: {
  edits: EditOverlay
  tourId: string
  axis: TimelineAxis | null
  play: FilmCurve | null
} | null = null

/**
 * Alle Halte für die Achse — Aufnahmen-Ketten UND Momente.
 *
 * Bewusst eine Funktion mit Auslass-Parameter: Jeder Zug braucht dieselbe Liste
 * ohne das Objekt, das gerade in der Hand liegt (s. `key` in
 * timeline.ts), und drei Kopien dieser Rechnung liefen garantiert auseinander.
 */
function axisStops(media: MediaView[], moments: readonly CameraMoment[]): AxisStop[] {
  if (!z) return []
  const start = z.data.time.start
  // Halt-Breite = Standzeit aller Aufnahmen des Stopps.
  // `indizes` trägt den Weg zurück zum Stopp: die Achse sortiert nach Zeit und
  // lässt Halte ohne Breite weg, ihr Index ist also nicht der der Stopp-Liste.
  const stops: AxisStop[] = buildStops(media, z.track, cumDistances).map((s, i) => {
    // Ein Halt ist die KETTE seiner Aufnahmen, kein Block: nur so lässt sich
    // sagen, welche davon gerade steht. Videos zählen mit ihrer echten Länge
    // (`durationS` aus der Editor-Route), Fotos mit ihrer Standzeit.
    const items = s.items.map((m) => ({
      id: m.id,
      durationS: mediumHoldS(m) + STOP_FADE_OUT_S,
    }))
    return {
      offsetS: s.offsetS,
      breiteS: items.reduce((sum, st) => sum + st.durationS, 0),
      kind: 'aufnahmen',
      indices: [i],
      items,
    }
  })
  // Ein Moment ist grammatikalisch ein HALT: die Kamera bleibt stehen und tut
  // etwas, Filmzeit vergeht. Ohne Achsenbreite fehlten sie in der Leiste
  // vollständig — an der Beispieltour 13,6 unsichtbare Filmsekunden.
  for (const m of moments) {
    stops.push({
      offsetS: isoToOffset(start, m.from),
      breiteS: momentDurationS(m),
      kind: 'moment',
      key: m.from,
    })
  }
  return stops
}

/** Filmzeit eines Moments — ohne eigene Angabe die Vorgabe seiner Art. */
function momentDurationS(m: CameraMoment): number {
  return m.durationS ?? MOMENT_DEFAULT_S[m.kind]
}

function currentAxis(): TimelineAxis | null {
  if (!z) return null
  if (axisMemo && axisMemo.edits === z.edits && axisMemo.tourId === z.tourId) return axisMemo.axis
  const scale = buildScale(z.track)
  if (!scale) return null
  const segments = splitForDisplay(z.data.segments as EditorSegment[], z.edits, z.data.time.start)
  const axis = buildTimelineAxis(segments, axisStops(mediaDisplay(), z.edits.moments ?? []), scale)
  axisMemo = {
    edits: z.edits,
    tourId: z.tourId,
    axis,
    play: buildPlaybackCurve(axis, segments),
  }
  return axis
}

/** Abspiel-Filmkurve zur aktuellen Achse (Trim-Plateaus) — aus demselben Cache. */
function currentPlayCurve(): FilmCurve | null {
  if (!currentAxis()) return null
  return axisMemo?.play ?? null
}

function renderTimeline(): void {
  if (!z) return
  const zone = $('timeline-zone')
  const scale = currentAxis()
  if (!scale) {
    zone.hidden = true
    return
  }
  zone.hidden = false
  const start = z.data.time.start
  const selectionInfo = clearSelectionOn()

  // Die Achsenbreite hängt an den DATEN (Filmdauer × Maßstab): eine geänderte
  // Standzeit oder Fortbewegung verlängert den Film und damit die Leiste.
  writeTimeWidth()
  renderRuler()

  /**
   * Zustandsband mit Beschriftung — Anfang und Ende sind dieselbe Kante.
   * `kind` macht das Band anklickbar: die Bandmitte dient als Fokus-Bezug
   * (überlebt das Verschieben von Grenzen besser als der Bandanfang).
   */
  const band = (
    kind: 'travelMode' | 'camera' | 'weather',
    from: number,
    to: number,
    text: string,
    color?: string,
    /**
     * Beiwert („ 52%", „ ×1.3"): fällt als Erstes weg, wenn das Band eng wird.
     * „Wolkig" allein sagt fast alles — gar nichts zu sagen (der frühere
     * Alles-oder-nichts-Schnitt) ließ Bänder unbeschriftet, obwohl der Name
     * bequem hineingepasst hätte.
     */
    extra = '',
  ): HTMLElement => {
    const d = document.createElement('div')
    d.className = 'band'
    d.style.left = pos(from)
    d.style.width = pos(to - from)
    if (color) d.style.background = color
    d.dataset['selected'] = kind
    d.dataset['bezugs'] = String(fractionToOffset(scale, (from + to) / 2))
    d.title = text + extra
    // Die Beschriftung als EIGENES Feld: `title` tragen manche Bänder als
    // Erklärung („… — automatisch ermittelt"), die nie auf dem Band stehen darf.
    d.dataset['voll'] = text + extra
    if (extra) d.dataset['kurz'] = text
    const t = document.createElement('span')
    t.textContent = text + extra
    d.appendChild(t)
    return d
  }

  /** Ziehbare Bandkante = die Grenze im Overlay (Identität über `from`). */
  const edge = (
    fraction: number,
    role: string,
    data: Record<string, string>,
    title: string,
  ): HTMLElement => {
    const k = document.createElement('div')
    k.className = 'edge'
    k.style.left = pos(fraction)
    k.dataset['role'] = role
    for (const [key, value] of Object.entries(data)) k.dataset[key] = value
    k.title = title
    return k
  }

  /** Ein Band gilt als fokussiert, wenn seine Mitte in der Fokus-Spanne liegt. */
  const isSelection = (kind: string, from: number, to: number): boolean => {
    if (selectionInfo?.kind !== kind) return false
    const center = fractionToOffset(scale, (from + to) / 2)
    return center >= selectionInfo.fromS && center <= selectionInfo.toS
  }

  // — Fortbewegung: Bänder aus der Anzeige-Zerlegung (Segment-Modi + Grenzen) —
  const travelModeLane = track('lane-travel')
  const travelModeSegments = splitForDisplay(z.data.segments as EditorSegment[], z.edits, start)
  for (const b of buildBands(travelModeSegments, scale)) {
    const d = band(
      'travelMode',
      b.from,
      b.to,
      TRAVEL_MODE_NAMES[b.mode],
      TRAVEL_MODE_COLORS[b.mode],
    )
    if (!b.active) d.classList.add('inactive')
    if (isSelection('travelMode', b.from, b.to)) d.classList.add('selected')
    travelModeLane.appendChild(d)
  }
  // Jeder MODUS-Wechsel ist ein Griff — auch der von der Automatik erkannte.
  // Beim ersten Zug schreibt `materializeTravelModes` die Aufteilung fest; bis
  // dahin ist die Kante nur eine Stelle auf der Achse. Kanten mit gleichem
  // Modus links und rechts bekommen keinen Griff: dort ist nichts zu wechseln.
  // Position = erster Punkt des neuen Abschnitts (bei Overlay-Grenzen zwischen
  // Stützpunkten der interpolierte Grenzpunkt). Identität: Overlay-`from` mit
  // Sekunden-Toleranz, sonst frisch aus der Zeit — muss zu `writeTravelModesFixed`
  // / `materializeTravelModes` passen.
  for (const [i, a] of travelModeSegments.entries()) {
    const before = travelModeSegments[i - 1]
    if (!before || before.mode === a.mode) continue
    const fromS = (a.pts[0] as TrackPoint)[3]
    const from =
      (z.edits.travelModes ?? []).find((g) => Math.abs(isoToOffset(start, g.from) - fromS) < 1)
        ?.from ?? offsetToIso(start, fromS)
    travelModeLane.appendChild(
      edge(
        offsetToFraction(scale, fromS),
        'boundary',
        { from: from, mode: a.mode },
        `${TRAVEL_MODE_NAMES[a.mode]} ab ${timeText(from)} Uhr · ziehen zum Verschieben`,
      ),
    )
  }

  // — Kamera: lückenlose Bänder; das Grundband zeigt „Preset des Zuschauers" —
  const cameraLane = track('lane-camera')
  const cameraBands = buildStateBands<CameraPreset | null>(
    (z.edits.camera ?? []).map((g) => ({ from: g.from, value: g.preset })),
    start,
    scale,
    null,
  )
  for (const b of cameraBands) {
    // Feinjustierung (falls ≠ 1) an die Beschriftung hängen: „Nah ×1.3"
    const fineRuler =
      b.from !== null ? z.edits.camera?.find((g) => g.from === b.from)?.scale : undefined
    const scaleTxt =
      fineRuler !== undefined && fineRuler !== 1 ? ` ×${String(+fineRuler.toFixed(2))}` : ''
    // Das Grundband (ohne Grenze) und ein gesetztes „Standard" sind derselbe
    // Zustand und sehen deshalb gleich aus — nur der eine hat eine Kante.
    const isDefault = !b.value || b.value === 'default'
    const d = band(
      'camera',
      b.fromFraction,
      b.toFraction,
      b.value ? PRESET_NAMES[b.value] : CAMERA_DEFAULT,
      b.value ? PRESET_COLORS[b.value] : undefined,
      scaleTxt,
    )
    // „Standard" ist kein Leerzustand, sondern eine Aussage: hier gilt, was der
    // Zuschauer wählt. Deshalb eine ruhige eigene Fläche statt der Riffelung,
    // die beim Wetter das ehrliche „noch gar nichts ermittelt" bezeichnet.
    if (isDefault) d.title = CAMERA_DEFAULT_EXPLAINED
    d.classList.add(isDefault ? 'base' : 'bright')
    if (isSelection('camera', b.fromFraction, b.toFraction)) d.classList.add('selected')
    cameraLane.appendChild(d)
    if (b.from !== null && b.value) {
      cameraLane.appendChild(
        edge(
          b.fromFraction,
          'camera',
          { from: b.from, preset: b.value },
          `Kamera ${PRESET_NAMES[b.value]} ab ${timeText(b.from)} Uhr · ziehen zum Verschieben`,
        ),
      )
    }
  }

  // — Wetter: das TATSÄCHLICHE Wetter der Tour, nicht die Ankündigung, dass es
  //   eins gäbe. Ohne eigene Grenzen sind das die vom Server automatisch
  //   ermittelten (Open-Meteo + Foto-Verfeinerung); der erste Eingriff schreibt
  //   sie fest (schreibeWetterFest). Nur wenn nie gerendert wurde, bleibt das
  //   eine ehrliche Verlegenheit: „Automatisch" —
  const weatherLane = track('lane-weather')
  const weatherBoundaries = displayWeather()
  const hasOwnWeather = (z.edits.weather ?? []).length > 0
  const weatherBands = buildStateBands<WeatherMode | null>(
    weatherBoundaries.map((g) => ({ from: g.from, value: g.mode })),
    start,
    scale,
    weatherBoundaries.length ? 'off' : null,
  )
  for (const b of weatherBands) {
    const intensity =
      b.from !== null ? weatherBoundaries.find((g) => g.from === b.from)?.intensity : undefined
    const intensityTxt =
      b.value && b.value !== 'off' && intensity !== undefined
        ? ` ${Math.round(intensity * 100)}%`
        : ''
    const d = band(
      'weather',
      b.fromFraction,
      b.toFraction,
      b.value ? WEATHER_NAMES[b.value] : 'Automatisch',
      b.value ? WEATHER_COLORS[b.value] : undefined,
      intensityTxt,
    )
    if (!b.value) d.classList.add('leise')
    else d.classList.add('bright')
    if (!hasOwnWeather && b.value) {
      d.title = `${WEATHER_NAMES[b.value]}, automatisch ermittelt (Wetterarchiv, an den Fotos nachgeschärft). Ändern übernimmt die ganze Einteilung.`
    }
    if (isSelection('weather', b.fromFraction, b.toFraction)) d.classList.add('selected')
    weatherLane.appendChild(d)
    if (b.from !== null && b.value) {
      weatherLane.appendChild(
        edge(
          b.fromFraction,
          'weather',
          { from: b.from, weatherMode: b.value },
          `Wetter ${WEATHER_NAMES[b.value]} ab ${timeText(b.from)} Uhr · ziehen zum Verschieben`,
        ),
      )
    }
  }

  // — Musik & Effekte: Klips mit zwei Trimm-Kanten (docs §2E) —
  //
  // Die Bahn hatte oben eine eigene Zeile für Effekt-PINS und die Klips
  // darunter — seit Etappe 4 ist ein Effekt aber derselbe Klip wie Musik. Die
  // leere Zeile blieb stehen und schob alles um 20 px nach unten: die Klips
  // standen sichtbar tiefer als ihr Spurname daneben.
  //
  // Ein Effekt ist hier dieselbe Sorte Klip wie Musik, nur in anderer Farbe.
  // Als Marke ohne Länge verschwieg die Leiste, wie lange er klingt — dabei
  // spielt der Player die Datei ohnehin aus. Erst wenn die Datei noch nicht
  // gemessen ist, bleibt er der Pin, der er war.
  const audioLane = track('lane-music')
  measureAudioDurations()
  const audioClips = resolveAudioClips(z.edits.audio ?? [], start, scale, audioDurations)
  // Überlappende Klips stapeln sich in Unterzeilen — die Bahn wächst mit,
  // damit jeder lesbar und greifbar bleibt (der Player mischt sie).
  audioLane.closest('.lane')?.setAttribute('style', `--music-lanes: ${audioLanes(audioClips)}`)
  const totalFilmS = scale.curve?.totalS ?? 0
  for (const k of audioClips) {
    // Bibliotheks-Einträge tragen ihren KATALOGNAMEN, nicht den Dateinamen:
    // „Aufbruch" sagt, was man hört — „mus-aufbruch.mp3" nur, wo es liegt.
    const entry = (z.edits.audio ?? [])[k.index]
    const display = audioName(entry ?? { file: k.file, type: k.type, from: start })
    const focused = selectionInfo?.kind === 'audio' && selectionInfo.index === k.index
    const pointLike = !(k.filmBis > k.filmVon) || !(totalFilmS > 0)
    if (pointLike) {
      const pin = document.createElement('div')
      pin.className = 'timeline-sfx'
      pin.style.left = pos(filmToFraction(scale, k.filmVon))
      pin.dataset['role'] = 'sfx'
      pin.dataset['index'] = String(k.index)
      // Ohne gemessene Datei kennt die Leiste die Länge nicht — deshalb (noch)
      // ein Punkt statt eines Klips, und das sagt der Tooltip auch.
      pin.title = `${display}, Länge noch unbekannt · ziehen zum Verschieben`
      if (focused) pin.classList.add('selected')
      pin.appendChild(document.createElement('i'))
      audioLane.appendChild(pin)
      continue
    }
    const clip = document.createElement('div')
    clip.className = k.type === 'sfx' ? 'timeline-clip sfx' : 'timeline-clip'
    clip.style.top = `${AUDIO_LANE_TOP_PX + k.lane * AUDIO_LANE_PX}px`
    clip.style.left = pos(filmToFraction(scale, k.filmVon))
    clip.style.width = pos(
      Math.max(0.002, filmToFraction(scale, k.filmBis) - filmToFraction(scale, k.filmVon)),
    )
    clip.dataset['role'] = 'audio-bar'
    clip.dataset['index'] = String(k.index)
    clip.title =
      `${display} · ${formatFilmTime(k.filmBis - k.filmVon)}` +
      (k.startS > 0 ? ` (ab ${formatFilmTime(k.startS)} der Datei)` : '') +
      ' · ziehen zum Verschieben, Kanten zum Trimmen'
    if (focused) clip.classList.add('selected')

    // Wellenform: der DATEI-Streifen hinter dem Klip, um den Einstieg nach
    // links geschoben. Beim Trimmen wandert dadurch der Ausschnitt — man sieht,
    // was man wegschneidet. Auf Klipbreite gestaucht sähe jeder Trim wie ein
    // Tempowechsel aus.
    // In ANTEILEN der Achse, nicht in Pixeln: Zoomen baut die Bahnen nicht
    // neu, sondern schreibt nur `--timeline-width` fort. Feste Pixel blieben auf
    // dem Maßstab des letzten Renders stehen — die Wellenform behielt beim
    // Hineinzoomen ihre Größe und endete weit vor dem Klip.
    const wave = waveformPosition(k, filmTotalS())
    const image = entry ? getWave(k.file, audioUrl(entry, z.tourId)) : null
    if (wave && image) {
      // Eigenes Fenster mit `overflow: hidden`: Der Klip selbst darf nicht
      // clippen, sonst verschwänden die überstehenden Kanten-Griffe und
      // Anfang/Ende wären nicht mehr zu greifen.
      const waveWindow = document.createElement('span')
      waveWindow.className = 'waveform-window'
      const laneEl = document.createElement('span')
      laneEl.className = 'waveform'
      const width = timeWidth(wave.widthFraction)
      laneEl.style.left = timeWidth(wave.offsetFraction)
      laneEl.style.width = timeWidth(wave.widthFraction * wave.repeats)
      laneEl.style.backgroundImage = `url(${image})`
      laneEl.style.backgroundSize = `${width} 100%`
      waveWindow.appendChild(laneEl)
      clip.appendChild(waveWindow)
    }

    const name = document.createElement('span')
    name.className = 'timeline-clip-name'
    name.textContent = display
    clip.appendChild(name)
    if (k.loop) {
      // Loop ist eine EINSTELLUNG im Inspector, auf dem Klip nur ein Zeichen —
      // als Schalter wäre sie eine Ausnahme, die Lautstärke und Dateiwechsel
      // nicht auch bekommen könnten.
      const glyph = document.createElement('span')
      glyph.className = 'timeline-clip-loop'
      glyph.textContent = '⟲'
      glyph.title = 'Wiederholt sich'
      clip.appendChild(glyph)
    }
    for (const side of ['from', 'to'] as const) {
      const grip = document.createElement('div')
      grip.className = `edge ${side}`
      grip.dataset['role'] = `audio-${side}`
      grip.dataset['index'] = String(k.index)
      clip.appendChild(grip)
    }
    audioLane.appendChild(clip)
  }

  // — Szenen: je Aufnahme EIN Klip, ein Halt ist ihre Kette —
  renderScenes(
    scale,
    selectionInfo?.kind === 'medium' ? (selectionInfo.id ?? null) : null,
    selectionInfo?.kind === 'moment' ? (selectionInfo.from ?? null) : null,
  )

  renderPlayhead()
  shortenLabels()
}

// — Szenen-Bahn: der Halt ist eine Kette anfassbarer Klips —
//
// Bis hierher war ein Halt EIN Punkt an der linken Kante seiner Achsenbreite —
// ein Stapel mit Zahl-Plakette. Die Breite war trotzdem belegt: eine tote Zone,
// in der nichts anzufassen war, obwohl dort der halbe Film liegt (52 % der
// Beispieltour sind Standzeit). Jetzt hat jede Aufnahme ihren eigenen Klip mit
// Anfang und Ende; Aufnahmen am selben Ort liegen als Kette hintereinander,
// weil die Kamera dort einmal hält und sie nacheinander zeigt.
//
// Drei Regeln tragen das (docs/architecture/zeitleiste-umbau.md §2A):
//  • RECONCILE an `medium.id` — nicht am Titel (der ist weder eindeutig noch
//    stabil) und erst recht nicht per Neubau: ein Neuaufbau je Zieh-Frame
//    kostete 2,34 ms und — schlimmer — das gezogene Element samt dekodiertem
//    `img`. Fortgeschrieben sind es 0,4 ms.
//  • CONTAINER-QUERIES für die drei Ausbaustufen (nur Bild / + Name / + zweites
//    Bild). Gemessene JS-Klassen schalteten erst beim Loslassen —
//    `shortenLabels` erzwingt ein Layout und läuft im Zug bewusst nicht.
//  • Die Miniatur kommt aus `thumbnailSource` (thumb → src): ohne den Rückfall
//    bliebe jede Tour von vor der Bildaufbereitung ohne Bild.

/** Klip-Elemente je Medien-ID — die Grundlage des Reconcile. */
let clipEls = new Map<string, HTMLElement>()
/** Dasselbe für Momente, geschlüsselt an ihrem `from`. */
let momentEls = new Map<string, HTMLElement>()

function renderScenes(
  axis: TimelineAxis,
  selectionId: string | null,
  selectionMoment: string | null,
): void {
  const laneEl = $('lane-photos')
  const media = new Map(mediaDisplay().map((m) => [m.id, m] as const))
  const total = axis.curve?.totalS ?? 0
  const nextClips = new Map<string, HTMLElement>()
  const nextMoments = new Map<string, HTMLElement>()
  if (total > 0) {
    for (const k of buildSceneClips(axis)) {
      const m = media.get(k.id)
      if (!m) continue
      const el = clipEls.get(k.id) ?? buildClip(m)
      if (el.parentElement !== laneEl) laneEl.appendChild(el)
      writeClip(el, m, k, total, selectionId === m.id)
      nextClips.set(k.id, el)
    }
    // Momente liegen in DERSELBEN Bahn: Ein Moment hält den Film an wie ein
    // Foto — er hat nur kein Bild. Eine eigene Spur dafür unterschiede nach
    // Herkunft statt nach Wirkung (docs §2.0).
    const moments = new Map((z?.edits.moments ?? []).map((m) => [m.from, m] as const))
    for (const stop of axis.stops ?? []) {
      if (stop.kind !== 'moment' || stop.key === undefined) continue
      const m = moments.get(stop.key)
      if (!m) continue
      const el = momentEls.get(m.from) ?? buildMomentClip(m.from)
      if (el.parentElement !== laneEl) laneEl.appendChild(el)
      writeMomentClip(el, m, stop, total, selectionMoment === m.from)
      nextMoments.set(m.from, el)
    }
  }
  // Was es nicht mehr gibt (Aufnahme gelöscht, Ort entfernt), verschwindet.
  const keep = new Set<HTMLElement>([...nextClips.values(), ...nextMoments.values()])
  for (const el of [...laneEl.children]) {
    if (!keep.has(el as HTMLElement)) el.remove()
  }
  clipEls = nextClips
  momentEls = nextMoments
  renderStopZone(axis, selectionId)
}

/**
 * Klip-Gerüst eines Moments — dieselbe Bauart wie eine Aufnahme, nur ohne
 * Miniatur: An ihrer Stelle steht ein Muster in Koralle (docs §2.0). Der
 * rechte Griff zieht seine DAUER — bei einer Aufnahme ist das die Standzeit,
 * hier die Zeit, die die Kamera bei ihrer Bewegung verweilt; dieselbe Frage.
 */
function buildMomentClip(from: string): HTMLElement {
  const clip = document.createElement('button')
  clip.type = 'button'
  clip.className = 'stop-clip moment'
  clip.dataset['role'] = 'moment-clip'
  clip.dataset['from'] = from

  const content = document.createElement('span')
  content.className = 'inhalt'
  const glyph = document.createElement('span')
  glyph.className = 'moment-mark'
  const info = document.createElement('span')
  info.className = 'info'
  info.append(document.createElement('b'), document.createElement('small'))
  content.append(glyph, info)
  clip.appendChild(content)

  const grip = document.createElement('span')
  grip.className = 'grip'
  grip.dataset['role'] = 'moment-duration'
  grip.title = 'Dauer ziehen'
  const bubble = document.createElement('span')
  bubble.className = 'duration-bubble'
  clip.append(grip, bubble)
  // Eigene Zeiger-Handler über Fenster-Listener (wie beim Aufnahme-Klip): ein
  // schneller Zug verlöre den schmalen Griff sonst an das Element darunter.
  clip.addEventListener('pointerdown', (ev) => {
    if (!z || ev.button !== 0 || tool !== 'select') return
    const now = clip.dataset['from'] ?? from
    if ((ev.target as HTMLElement).closest('.grip')) dragMomentDuration(ev, now)
    else dragMoment(ev, now)
  })
  return clip
}

/** Lage, Beschriftung und Zustand eines Moment-Klips fortschreiben. */
function writeMomentClip(
  el: HTMLElement,
  m: CameraMoment,
  stop: StopInterval,
  totalS: number,
  selection: boolean,
): void {
  el.dataset['from'] = m.from
  el.style.left = pos(stop.filmVon / totalS)
  el.style.width = pos((stop.filmBis - stop.filmVon) / totalS)
  el.classList.toggle('selected', selection)
  const durationText = formatSeconds(momentDurationS(m))
  const glyph = el.querySelector('.moment-mark')
  const title = el.querySelector('.info b')
  const bottom = el.querySelector('.info small')
  if (glyph && glyph.textContent !== MOMENT_GLYPHS[m.kind])
    glyph.textContent = MOMENT_GLYPHS[m.kind]
  if (title && title.textContent !== MOMENT_NAMES[m.kind]) title.textContent = MOMENT_NAMES[m.kind]
  if (bottom && bottom.textContent !== durationText) bottom.textContent = durationText
  const bubble = el.querySelector('.duration-bubble')
  if (bubble && bubble.textContent !== durationText) bubble.textContent = durationText
  el.title = `${MOMENT_NAMES[m.kind]} bei ${timeText(m.from)} Uhr · ${durationText} · die rechte Kante zieht die Dauer`
}

/** Klip-Gerüst einer Aufnahme — einmalig; danach nur noch fortgeschrieben. */
function buildClip(m: MediaView): HTMLElement {
  const clip = document.createElement('button')
  clip.type = 'button'
  clip.className = 'stop-clip'
  clip.dataset['role'] = 'clip'
  clip.dataset['id'] = m.id
  // Wortliste wie bei den Kartenpunkten — `withMediaId` findet den Klip beim
  // Abspielen darüber (ein Anführungszeichen in der ID zerlegte einen Selektor).
  clip.dataset['ids'] = m.id

  const content = document.createElement('span')
  content.className = 'inhalt'
  const info = document.createElement('span')
  info.className = 'info'
  info.append(document.createElement('b'), document.createElement('small'))
  content.append(imageField(m, 'start'), info, imageField(m, 'end'))
  clip.appendChild(content)

  if (m.type === 'video') {
    // Ein Video hat keinen STANDZEIT-Griff: der Player läuft bis zum Dateiende,
    // `display.holdS` ist dort wirkungslos (src/tour.js) — ein Griff dafür wäre
    // eine Lüge. Seit Etappe 4 hat es aber zwei SCHNITT-Kanten (docs §2F): Der
    // alte Satz „ein Video trägt seine Länge, sie steht nicht zur Wahl" stimmt
    // für die Standzeit, nicht für den Schnitt. Anschlag ist die Datei; Loop
    // gibt es hier nicht, der wäre bei einem Video Unsinn.
    const play = document.createElement('span')
    play.className = 'v-play'
    play.innerHTML = icon('play')
    clip.appendChild(play)
    for (const side of ['from', 'to'] as const) {
      const edge = document.createElement('span')
      edge.className = `v-trim ${side}`
      edge.dataset['role'] = 'video-trim'
      edge.dataset['side'] = side
      edge.dataset['id'] = m.id
      edge.title = side === 'from' ? 'Anfang des Videos schneiden' : 'Ende des Videos schneiden'
      clip.appendChild(edge)
    }
    const bubble = document.createElement('span')
    bubble.className = 'duration-bubble'
    clip.appendChild(bubble)
  } else {
    const grip = document.createElement('span')
    grip.className = 'grip'
    grip.dataset['role'] = 'hold'
    grip.dataset['id'] = m.id
    grip.title = 'Standzeit ziehen'
    const bubble = document.createElement('span')
    bubble.className = 'duration-bubble'
    clip.append(grip, bubble)
  }
  clip.addEventListener('pointerdown', (ev) => clipPointer(ev, m.id))
  return clip
}

/** Kopf- bzw. Fußminiatur. Ohne Kachel UND ohne Poster bleibt ein Video leer —
 *  ein `img` mit der .mp4 als Quelle zeigte nur das Symbol für „kaputt". */
function imageField(m: MediaView, where: 'start' | 'end'): HTMLElement {
  const field = document.createElement('span')
  field.className = `bild ${where}`
  if (m.type === 'video' && !m.thumb && !m.poster) return field
  const image = document.createElement('img')
  image.src = thumbnailSource(m)
  image.alt = ''
  image.loading = 'lazy'
  field.appendChild(image)
  return field
}

/** Lage, Beschriftung und Zustand eines Klips fortschreiben (kein Neubau). */
function writeClip(
  el: HTMLElement,
  m: MediaView,
  k: SceneClip,
  totalS: number,
  selection: boolean,
): void {
  el.style.left = pos(k.filmVon / totalS)
  el.style.width = pos((k.filmBis - k.filmVon) / totalS)
  // classList statt className: `.dragging` überlebt so den Render mitten im Zug.
  el.classList.toggle('selected', selection)
  el.classList.toggle('video', m.type === 'video')
  const durationS = mediumHoldS(m)
  // Getrimmt sagt der ANTEIL mehr als die nackte Zahl (docs §2F).
  const trimmed = m.type === 'video' ? clampMediaTrim(m.trim, m.durationS ?? 0) : null
  const durationText =
    m.type === 'video'
      ? trimmed
        ? `${formatFilmTime(durationS)} von ${formatFilmTime(m.durationS ?? 0)}`
        : `${formatFilmTime(durationS)} Video`
      : formatSeconds(durationS)
  const name = m.caption || (m.type === 'video' ? 'Video' : 'Foto')
  const title = el.querySelector('.info b')
  const bottom = el.querySelector('.info small')
  if (title && title.textContent !== name) title.textContent = name
  if (bottom && bottom.textContent !== durationText) bottom.textContent = durationText
  const bubble = el.querySelector('.duration-bubble')
  if (bubble && bubble.textContent !== durationText) bubble.textContent = durationText
  const chain = k.count > 1 ? ` · Aufnahme ${k.slot + 1} von ${k.count}` : ''
  el.title =
    `${name}, ${clockTimeShort(m.takenAt)} Uhr · ${durationText}${chain}` +
    (m.type === 'video'
      ? ' · die Kanten schneiden das Video'
      : ' · die rechte Kante zieht die Standzeit')
}

/**
 * Die Halt-Zone führt durch alle Bahnen — aber nur für den AUSGEWÄHLTEN Halt.
 *
 * Über alle Halte gelegt waren es zwölf Linien Dauerunruhe für eine Frage, die
 * man punktuell hat („was liegt zeitlich über diesem Halt?"). Als Teil der
 * Auswahl beantwortet sie dieselbe Frage genau dann, wenn sie gestellt wird —
 * dasselbe Muster wie der leuchtende Streckenabschnitt auf der Karte.
 */
function renderStopZone(axis: TimelineAxis, selectionId: string | null): void {
  document.querySelector('#lanes .stop-zone')?.remove()
  const total = axis.curve?.totalS ?? 0
  if (!selectionId || !(total > 0)) return
  const stop = (axis.stops ?? []).find((h) => h.items?.some((s) => s.id === selectionId))
  if (!stop) return
  const el = document.createElement('div')
  el.className = 'stop-zone'
  el.style.left = timeX(stop.filmVon / total)
  el.style.width = `calc(${((stop.filmBis - stop.filmVon) / total).toFixed(5)} * var(--timeline-width))`
  $('lanes').appendChild(el)
}

/** Die Kante liegt IM Klip — ohne diese Weiche verschöbe man, statt zu ziehen. */
function clipPointer(e: PointerEvent, id: string): void {
  if (!z || e.button !== 0 || tool !== 'select') return
  const trim = (e.target as HTMLElement).closest<HTMLElement>('.v-trim')
  if (trim) dragVideoTrim(e, id, trim.dataset['side'] === 'to' ? 'to' : 'from')
  else if ((e.target as HTMLElement).closest('.grip')) dragHold(e, id)
  else dragClip(e, id)
}

/**
 * Video schneiden (docs §2F) — dieselbe Geste wie beim Ton, andere Größe:
 * gerechnet wird in DATEI-Sekunden, denn der Schnitt gilt der Datei.
 *
 * Der RIPPLE kostet keine Zeile Code: Ein Video liegt in einer Halt-Kette, die
 * keine Lücken kennt. Wird sein Ausschnitt kürzer, wird sein Halt schmaler, die
 * Achse baut sich neu — und alles Folgende rückt vor. Eine Lücke kann gar nicht
 * entstehen.
 *
 * Wie bei der Standzeit wird LIVE geschrieben (man soll den Film schrumpfen
 * sehen) und der Maßstab eingefroren — sonst schrumpfte die Leiste unter der
 * Hand und der Griff bliebe hinter dem Zeiger zurück.
 */
function dragVideoTrim(e: PointerEvent, id: string, side: 'from' | 'to'): void {
  if (!z) return
  const m = mediaDisplay().find((x) => x.id === id)
  const fileS = m?.durationS
  if (!m || m.type !== 'video' || !fileS || !(fileS > 0)) return
  e.preventDefault()
  e.stopPropagation()
  stopsPlay()
  const clip = clipEls.get(id)
  clip?.classList.add('dragging', 'dragging-duration')
  const start = clampMediaTrim(m.trim, fileS) ?? { fromS: 0, toS: fileS }
  const scale = pxPerFilmS > 0 ? pxPerFilmS : 1
  const startX = e.clientX
  let baseX = 0

  const move = (ev: PointerEvent): void => {
    if (!z) return
    if (!baseX) {
      if (Math.abs(ev.clientX - startX) < DRAG_THRESHOLD_PX) return
      baseX = ev.clientX
      autoFit = false
    }
    const delta = (ev.clientX - baseX) / scale
    // Der Anschlag ist an BEIDEN Kanten das Material: vor den Dateianfang und
    // hinter das Dateiende geht nichts, und zwischen den Kanten bleibt ein Rest.
    const trim =
      side === 'from'
        ? {
            fromS: Math.max(0, Math.min(start.fromS + delta, start.toS - VIDEO_TRIM_MIN_S)),
            toS: start.toS,
          }
        : {
            fromS: start.fromS,
            toS: Math.min(fileS, Math.max(start.toS + delta, start.fromS + VIDEO_TRIM_MIN_S)),
          }
    const effective = clampMediaTrim(trim, fileS)
    z.edits = withMediaEdit(z.edits, id, { trim: effective ?? undefined })
    renderAfterDrag()
  }
  const release = (): void => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', release)
    clip?.classList.remove('dragging', 'dragging-duration')
    if (!baseX) return
    suppressClick = true
    renderAll()
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', release)
}

/**
 * Standzeit am rechten Griff (`display.holdS`).
 *
 * Anders als beim Klip-Zug wird hier LIVE ins Overlay geschrieben: man soll den
 * Film wachsen und alles Spätere nachrücken sehen. Ein Undo-Schritt bleibt es
 * trotzdem — `renderAfterDrag` schreibt `lastState` nicht fort, erst das
 * abschließende `renderAll` setzt den Punkt (dasselbe Muster wie die
 * Kanten-Züge der Zustandsbahnen).
 *
 * Der Maßstab wird eingefroren und bleibt es. Eingepasst folgte er sonst der
 * wachsenden Filmdauer: die Leiste schrumpfte unter der Hand, der Griff bliebe
 * hinter dem Zeiger zurück — und beim Loslassen sprang die ganze Leiste noch
 * einmal auf „alles im Fenster". Genau das ist die Skalierung, gegen die der
 * feste Maßstab gebaut ist (docs §2C): sie verschiebt AUCH alles vor der
 * geänderten Stelle, das mit ihr nichts zu tun hat. Der Fit gehört zum Öffnen
 * und zum Zoomen, nicht zu einer Datenänderung; der Weg dorthin zurück steht
 * als „×"-Knopf (⇧Z) da, der jetzt sichtbar aktiv wird. Ein waagerechter
 * Scrollbalken ist dabei kein Fehler, sondern die Folge einer Nutzerhandlung.
 */
function dragHold(e: PointerEvent, id: string): void {
  if (!z) return
  const m = mediaDisplay().find((x) => x.id === id)
  if (!m || m.type === 'video') return
  e.preventDefault()
  e.stopPropagation()
  stopsPlay()
  const clip = clipEls.get(id)
  // Eigene Klasse: `.dragging` allein trägt auch der Klip-Zug, und dort wäre eine
  // Standzeit-Blase über dem verschobenen Bild eine Angabe zur falschen Frage.
  clip?.classList.add('dragging', 'dragging-duration')
  const startDuration = photoHoldS(m.display)
  const scale = pxPerFilmS > 0 ? pxPerFilmS : 1
  const startX = e.clientX
  // Erst ab der Schwelle wird aus dem Drücken ein Zug — und die Rechnung setzt
  // DORT an, nicht am Druckpunkt: sonst spränge die Dauer beim Losfahren um
  // die Schwellenbreite (eingepasst sind 4 px schnell eine ganze Sekunde).
  let baseX = 0

  const move = (ev: PointerEvent): void => {
    if (!z) return
    if (!baseX) {
      if (Math.abs(ev.clientX - startX) < DRAG_THRESHOLD_PX) return
      baseX = ev.clientX
      autoFit = false
    }
    const duration = clampHoldS(startDuration + (ev.clientX - baseX) / scale)
    z.edits = withMediaEdit(z.edits, id, { display: { ...m.display, holdS: duration } })
    renderAfterDrag()
  }
  const release = (): void => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', release)
    clip?.classList.remove('dragging', 'dragging-duration')
    if (!baseX) return // nur gedrückt, nicht gezogen: nichts geändert, nichts zu merken
    suppressClick = true
    renderAll()
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', release)
}

/**
 * Wohin fällt ein gezogenes Objekt? Zeigerweg → Zeit, gerechnet auf einer
 * Zug-Achse OHNE dieses Objekt (sonst tote Zone, s. `key`).
 *
 * Gerechnet wird in FILMSEKUNDEN, nicht in Anteilen: Die Zug-Achse ist um die
 * Breite des ausgelassenen Objekts kürzer, derselbe ANTEIL ist auf ihr also
 * eine andere Zeit — ein 340-px-Zug landete dadurch 11 px neben dem Zeiger.
 * In Filmsekunden stimmt es exakt, denn links des Objekts sind beide Achsen
 * identisch und px sind film-proportional: `filmZug(zielZeit) =
 * filmZug(startZeit) + Zeigerweg`.
 */
function dragTargetTime(
  dragAxis: TimelineAxis,
  startS: number,
  travelFraction: number,
  totalRealS: number,
): number {
  const dragTotal = dragAxis.curve?.totalS ?? 0
  if (!(dragTotal > 0)) return startS
  const startFilm = fractionToFilm(dragAxis, offsetToFraction(dragAxis, startS))
  return fractionToOffset(dragAxis, (startFilm + travelFraction * totalRealS) / dragTotal)
}

/**
 * Die Dauer eines Moments an seiner rechten Kante ziehen — dieselbe Geste wie
 * die Standzeit einer Aufnahme, nur schreibt sie `moments[].dauerS`.
 *
 * Live geschrieben (renderNachZug): Der Klip behält dabei seine Identität —
 * `from` ändert sich nicht —, das Element überlebt den Render, und die Achse
 * hinter ihm soll ja mitwachsen (die Filmdauer wird länger).
 */
function dragMomentDuration(e: PointerEvent, from: string): void {
  if (!z) return
  const m = (z.edits.moments ?? []).find((x) => x.from === from)
  if (!m) return
  e.preventDefault()
  e.stopPropagation()
  stopsPlay()
  const clip = momentEls.get(from)
  clip?.classList.add('dragging', 'dragging-duration')
  const startDuration = momentDurationS(m)
  const scale = pxPerFilmS > 0 ? pxPerFilmS : 1
  const startX = e.clientX
  // Erst ab der Schwelle wird aus dem Drücken ein Zug — und die Rechnung setzt
  // DORT an, sonst spränge die Dauer beim Losfahren um die Schwellenbreite.
  let baseX = 0

  const move = (ev: PointerEvent): void => {
    if (!z) return
    if (!baseX) {
      if (Math.abs(ev.clientX - startX) < DRAG_THRESHOLD_PX) return
      baseX = ev.clientX
      autoFit = false
    }
    z.edits = withCameraMoment(
      z.edits,
      from,
      m.kind,
      clampMomentDuration(startDuration + (ev.clientX - baseX) / scale),
    )
    renderAfterDrag()
  }
  const release = (): void => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', release)
    clip?.classList.remove('dragging', 'dragging-duration')
    if (!baseX) return
    suppressClick = true
    renderAll()
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', release)
}

/**
 * Einen Moment verschieben — sein ORT auf der Reise, nichts weiter: Ein Moment
 * gehört zu keiner Kette, es gibt bei ihm keine „Reihenfolge"-Bedeutung.
 *
 * Wie beim Aufnahme-Klip wird während der Bewegung NICHTS geschrieben (der Klip
 * folgt dem Zeiger als Anzeigegröße, das Overlay einmal beim Loslassen = ein
 * Undo-Schritt) und px → Zeit läuft über eine Achse OHNE DIESEN Moment: auf der
 * echten Achse belegt er selbst Breite, um seine Ruhelage läge also eine tote
 * Zone, in der der Zeiger die Zeit nicht bewegt. Vorher schrieb er live und war
 * ein Punkt ohne Breite — da fiel beides nicht auf.
 */
function dragMoment(e: PointerEvent, from: string): void {
  if (!z) return
  const axis = currentAxis()
  const scale = buildScale(z.track)
  if (!axis?.curve || !scale) return
  const m = (z.edits.moments ?? []).find((x) => x.from === from)
  if (!m) return
  e.preventDefault()
  stopsPlay()
  const zz = z
  const start = zz.data.time.start
  const clip = momentEls.get(from)
  const dragAxis = buildTimelineAxis(
    splitForDisplay(zz.data.segments as EditorSegment[], zz.edits, start),
    axisStops(
      mediaDisplay(),
      (zz.edits.moments ?? []).filter((x) => x.from !== from),
    ),
    scale,
  )
  const total = axis.curve.totalS
  const startS = isoToOffset(start, from)
  const startX = e.clientX
  const startFraction = laneFraction(e.clientX)
  let moved = false
  let targetS: number | null = null

  const move = (ev: PointerEvent): void => {
    if (!moved && Math.abs(ev.clientX - startX) < DRAG_THRESHOLD_PX) return
    if (!moved) {
      moved = true
      clip?.classList.add('dragging')
    }
    const free = dragTargetTime(dragAxis, startS, laneFraction(ev.clientX) - startFraction, total)
    targetS = Math.max(scale.fromS, Math.min(scale.toS, free))
    if (clip) clip.style.transform = `translateX(${(ev.clientX - startX).toFixed(1)}px)`
    showDragLabel(
      ev,
      'location',
      `${MOMENT_NAMES[m.kind]} · km ${kmText(metersToOffset(cumDistances, zz.track, targetS))} · ${clockTimeShort(offsetToIso(start, targetS))} Uhr`,
    )
  }

  const release = (): void => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', release)
    hideDragLabel()
    if (clip) {
      clip.style.transform = ''
      clip.classList.remove('dragging')
    }
    if (!z) return
    if (!moved || targetS === null) {
      // Kein Zug = Klick: auswählen (der Inspector beschreibt den Moment).
      z.selection = { kind: 'moment', from }
      renderAll()
      return
    }
    suppressClick = true
    const newFrom = moveBoundary('moment', from, targetS)
    z.selection = { kind: 'moment', from: newFrom ?? from }
    renderAll()
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', release)
}

/**
 * Einen Klip ziehen — EINE Geste, zwei Bedeutungen (docs §2A):
 *
 *   INNERHALB der eigenen Kette → REIHENFOLGE (`order` im Overlay). Reine
 *     Anordnung, der Ort bleibt; der häufige Fall („die drei Skyline-Bilder
 *     andersherum") und deshalb risikofrei.
 *   DARÜBER HINAUS → ORT auf der Route. Ein echter Eingriff: die Achse ist
 *     film-proportional, 30 px sind schnell mehrere hundert Meter.
 *
 * Was gerade gilt, sagt das Etikett am Zeiger — nicht erst das Ergebnis. Über
 * einem FREMDEN Halt dockt der Klip an (über dessen volle Breite: dort gibt es
 * keine Zwischenposition, die Pixel gehören einer Standzeit und keiner
 * Fahrzeit). Der Modus entscheidet sich an der Kette, in der der Zug BEGANN —
 * sonst kippte die Bedeutung mitten in der Bewegung.
 *
 * Wie beim alten Halt-Zug wird während der Bewegung NICHTS neu gebaut: der Klip
 * folgt dem Zeiger als reine Anzeigegröße, das Overlay wird einmal beim
 * Loslassen geschrieben (= genau ein Undo-Schritt).
 */
function dragClip(e: PointerEvent, id: string): void {
  if (!z) return
  const axis = currentAxis()
  const scale = buildScale(z.track)
  if (!axis?.curve || !scale) return
  const all = mediaDisplay()
  const m = all.find((x) => x.id === id)
  const ownClip = buildSceneClips(axis).find((k) => k.id === id)
  if (!m || !ownClip) return
  e.preventDefault()
  stopsPlay()
  const total = axis.curve.totalS
  const zz = z
  const stops = buildStops(all, zz.track, cumDistances)
  const ownStop = axis.stops?.[ownClip.stopIndex] ?? null
  const clip = clipEls.get(id)
  const fieldEl = document.getElementById('scale-field')
  // Rückrechnung px → Zeit über eine Achse OHNE die Halte DIESER Aufnahme: auf
  // der echten Achse hat der gezogene Klip selbst Breite, um die Ruhelage läge
  // also eine tote Zone von Sprungbreite, in der der Zeiger die Zeit nicht
  // bewegte. Die Kette der Geschwister bleibt drin — sie steht ja weiter da.
  // Die MOMENTE bleiben drin (sie stehen ja weiter da) — sie fehlten hier, und
  // damit rechnete die Zug-Achse um deren Filmzeit daneben.
  const dragAxis = buildTimelineAxis(
    splitForDisplay(zz.data.segments as EditorSegment[], zz.edits, zz.data.time.start),
    axisStops(
      all.filter((x) => x.id !== id),
      zz.edits.moments ?? [],
    ),
    scale,
  )
  const startX = e.clientX
  const startFraction = laneFraction(e.clientX)
  const startS = offsetFrom(m)
  let moved = false
  let target:
    | { kind: 'order'; slot: number }
    | { kind: 'location'; offsetS: number; dock: Stop | null }
    | null = null

  const move = (ev: PointerEvent): void => {
    if (!moved && Math.abs(ev.clientX - startX) < DRAG_THRESHOLD_PX) return
    if (!moved) {
      moved = true
      clip?.classList.add('dragging')
    }
    const fraction = laneFraction(ev.clientX)
    const cursorFilm = fraction * total

    // — Reihenfolge — nur innerhalb der Kette, in der der Zug begann
    if (
      ownStop &&
      ownClip.count > 1 &&
      cursorFilm >= ownStop.filmVon &&
      cursorFilm <= ownStop.filmBis
    ) {
      const chainSlot = slotInChain(ownStop, cursorFilm)
      target = { kind: 'order', slot: chainSlot.slot }
      if (clip) clip.style.transform = `translateX(${(ev.clientX - startX).toFixed(1)}px)`
      showInsertMark(chainSlot.filmS / total)
      showDragLabel(ev, 'order', `Reihenfolge · Platz ${chainSlot.slot + 1} von ${ownClip.count}`)
      return
    }
    hideInsertMark()

    // — Ort — über einem fremden Halt andocken, sonst freie Zeit
    const treffer = stopInnerAt(axis, cursorFilm)
    const foreign = treffer && !treffer.items?.some((s) => s.id === id) ? treffer : null
    const dock = foreign?.items?.[0] ? (stopOf(stops, foreign.items[0].id) ?? null) : null
    const free = dragTargetTime(dragAxis, startS, fraction - startFraction, total)
    const offsetS = dock ? dock.offsetS : Math.max(scale.fromS, Math.min(scale.toS, free))
    target = { kind: 'location', offsetS, dock }
    if (clip) {
      // Angedockt springt der Klip an das Ende der fremden Kette — dorthin, wo
      // er beim Loslassen liegt. Sonst klebt er pixelgenau unterm Zeiger.
      const width = fieldEl?.getBoundingClientRect().width ?? 0
      clip.style.transform =
        foreign && width > 0
          ? `translateX(${(((foreign.filmBis - ownClip.filmVon) / total) * width).toFixed(1)}px)`
          : `translateX(${(ev.clientX - startX).toFixed(1)}px)`
    }
    showDragLabel(
      ev,
      'location',
      dock
        ? `An den Halt „${dock.items[0]?.caption || 'ohne Titel'}" anschließen`
        : `Ort · km ${kmText(metersToOffset(cumDistances, zz.track, offsetS))} · ${clockTimeShort(offsetToIso(zz.data.time.start, offsetS))} Uhr`,
    )
  }

  const release = (): void => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', release)
    hideInsertMark()
    hideDragLabel()
    if (clip) {
      clip.style.transform = ''
      clip.classList.remove('dragging')
    }
    if (!z) return
    if (!moved || !target) {
      // Kein Zug = Klick: auswählen. Erst damit zeigt die Halt-Zone, was
      // zeitlich über diesem Halt liegt.
      z.selection = { kind: 'medium', id }
      flyToMedium(m)
      renderAll()
      return
    }
    suppressClick = true
    z.selection = { kind: 'medium', id }
    if (target.kind === 'order') {
      const chain = (ownStop?.items ?? []).map((s) => s.id)
      const follow = moveToSlot(chain, id, target.slot)
      // Zurück auf den eigenen Platz gelegt heißt: nichts ist geschehen.
      // `assignOrder` schriebe trotzdem ein neues Overlay — und der
      // Referenzvergleich in renderAlles machte daraus einen leeren
      // Undo-Schritt, den man später einmal umsonst rückgängig macht.
      if (follow.join(' ') !== chain.join(' ')) z.edits = assignOrder(z.edits, follow)
      renderAll()
      return
    }
    if (target.dock) {
      // Andocken heißt: DEN Anker des Zielhalts übernehmen. Über die Zeit
      // gerechnet läge die Aufnahme knapp daneben und der Halt zerfiele wieder.
      const anchor = target.dock.items[0]?.anchor
      if (!anchor) return
      const next = withMediaEdit(z.edits, id, { anchor: anchor })
      z.edits = assignOrder(next, [...target.dock.items.map((x) => x.id), id])
      renderAll()
      return
    }
    // Frei abgelegt: nicht ungewollt mit einem Nachbarn clustern (die Achse
    // kann in Metern eng sein, wo sie auf der Leiste weit aussieht). `order`
    // fällt weg — die Aufnahme gehört zu keiner Kette mehr.
    const raw = trackPointAt(target.offsetS)
    if (!raw) return
    const foreignMeters = all
      .filter((x) => x.anchor && !x.removed && x.id !== id)
      .map((x) => metersToOffset(cumDistances, zz.track, offsetFrom(x)))
    const safeMeters = metersWithoutCluster(
      metersToOffset(cumDistances, zz.track, raw[3]),
      foreignMeters,
    )
    const safe = pointAtOffset(zz.track, offsetAtMeters(cumDistances, zz.track, safeMeters))
    if (!safe) return
    z.edits = withMediaEdit(z.edits, id, { anchor: [safe[0], safe[1]], order: undefined })
    renderAll()
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', release)
}

/** Wohin fällt der Klip in seiner Kette? Eine Linie statt eines Neuaufbaus. */
function showInsertMark(fraction: number): void {
  let el = document.querySelector<HTMLElement>('.timeline-insert')
  if (!el) {
    el = document.createElement('div')
    el.className = 'timeline-insert'
    $('lanes').appendChild(el)
  }
  el.style.left = timeX(fraction)
}

function hideInsertMark(): void {
  document.querySelector('.timeline-insert')?.remove()
}

/** Sagt am Zeiger, WAS der Zug gerade bedeutet — nicht erst beim Loslassen. */
function showDragLabel(ev: PointerEvent, kind: 'order' | 'location', text: string): void {
  let el = document.querySelector<HTMLElement>('.drag-label')
  if (!el) {
    el = document.createElement('div')
    el.className = 'drag-label'
    document.body.appendChild(el)
  }
  el.dataset['kind'] = kind
  el.textContent = text
  el.style.left = `${ev.clientX}px`
  el.style.top = `${ev.clientY}px`
}

function hideDragLabel(): void {
  document.querySelector('.drag-label')?.remove()
}

/**
 * Beschriftungen an die Bandbreite anpassen — und dabei SAGEN, dass gekürzt ist.
 *
 * Zwei Stufen: Passt „Wolkig 52%" nicht, bleibt „Wolkig …"; reicht auch das
 * nicht, schneidet CSS mit `text-overflow: ellipsis` ab. Die Auslassungspunkte
 * sind der Punkt der Übung — ein Band, das nur „Wolkig" zeigt, sieht aus, als
 * WÄRE das die Angabe; eines ganz ohne Text (der frühere Alles-oder-nichts-
 * Schnitt) sieht aus, als gäbe es keine. Beide Male sucht man den fehlenden
 * Wert nicht, weil man nicht weiß, dass er existiert.
 *
 * Läuft bei jedem Voll-Render UND nach jeder Maßstabsänderung: Beim Hineinzoomen
 * wird das Band breit, und dann gehört der volle Text wieder hinein. Während
 * eines Zugs läuft die Funktion bewusst NICHT (renderNachZug) — das erzwungene
 * Layout gehört nicht in einen Zieh-Frame.
 */
function shortenLabels(): void {
  for (const b of document.querySelectorAll<HTMLElement>('#timeline-zone .band')) {
    const text = b.querySelector('span')
    if (!text) continue
    const full = b.dataset['voll'] ?? text.textContent ?? ''
    const short = b.dataset['kurz']
    if (text.textContent !== full) text.textContent = full
    // Ein Pixel Toleranz: Sub-Pixel-Breiten runden sonst grundlos zur Kurzform.
    if (text.scrollWidth <= text.clientWidth + 1) continue
    if (short) text.textContent = `${short} …`
  }
}

/**
 * Nachmessen, sobald der Maßstab steht — aber höchstens einmal je Bild.
 * Rad- und Pinch-Zoom feuern pro Frame; ein erzwungenes Layout je Ereignis
 * wäre genau die Arbeit, die aus einer flüssigen Geste eine zähe macht.
 */
let shortenRaf = 0
function shortenLabelsSoon(): void {
  if (shortenRaf) return
  shortenRaf = requestAnimationFrame(() => {
    shortenRaf = 0
    shortenLabels()
  })
}

// — Zoom, Abspielkopf und Läufer —
//
// Die Zeitachse ist so breit wie `--timeline-width` (Pixel, nicht Prozent): nur so
// kann sie über das Fenster hinauswachsen und waagerecht scrollen. Ihre Breite
// ist FILMDAUER × MASSSTAB (`pxPerFilmS`) — die gespeicherte Größe ist der
// Maßstab, nicht ein Faktor auf die Fensterbreite. Eingepasst heißt: der
// Maßstab wird aus der Fensterbreite gerechnet; er folgt ihr, bis jemand zoomt.

/** Größter Maßstab, ausgedrückt als Vielfaches des eingepassten. */
const ZOOM_MAX = 40

/** Breite der Zeitachse im eingepassten Zustand: Fenster minus Namenspalte und Auslauf. */
function baseWidthPx(): number {
  const viewport = document.getElementById('lanes-viewport')
  if (!viewport) return 0
  return Math.max(120, viewport.clientWidth - laneXPx() - 26)
}

function laneXPx(): number {
  const value = getComputedStyle($('editor-view')).getPropertyValue('--lane-x')
  return parseFloat(value) || 168
}

/** Filmdauer der ganzen Achse (s) — 0, solange es keine Kurve gibt. */
function filmTotalS(): number {
  return currentAxis()?.curve?.totalS ?? 0
}

/** Maßstab, bei dem der ganze Film genau ins Fenster passt (px je Filmsekunde). */
function passScale(): number {
  const total = filmTotalS()
  return total > 0 ? baseWidthPx() / total : 0
}

function timeWidthPx(): number {
  const total = filmTotalS()
  // Ohne Kurve (degenerierte Tour) bleibt es bei der Fensterbreite: dort ist die
  // Leiste linear über der Aufnahmezeit, eine Filmsekunde gibt es gar nicht.
  if (!(total > 0) || !(pxPerFilmS > 0)) return baseWidthPx()
  return total * pxPerFilmS
}

/** Aktueller Maßstab als Vielfaches des eingepassten — nur noch für die Anzeige. */
function zoomFactor(): number {
  const pass = passScale()
  return pass > 0 && pxPerFilmS > 0 ? pxPerFilmS / pass : 1
}

/**
 * Maßstab setzen und die Ansicht so scrollen, dass `anchorFraction` an der
 * Fenster-x `targetVx` stehen bleibt — sonst springt der Blick beim Zoomen
 * irgendwohin. Untergrenze ist „alles im Blick": darunter entstünde nur
 * Leerrand, und genau dort gilt wieder `autoFit`.
 */
function setScale(newPxPerS: number, anchorFraction: number, targetVx: number): void {
  const pass = passScale()
  if (pass <= 0) {
    writeTimeWidth()
    return
  }
  pxPerFilmS = Math.max(pass, Math.min(pass * ZOOM_MAX, newPxPerS))
  autoFit = pxPerFilmS <= pass * 1.001
  const width = timeWidthPx()
  lastTimeWidth = width
  $('editor-view').style.setProperty('--timeline-width', `${width}px`)
  renderRuler()
  renderPlayhead()
  const viewport = document.getElementById('lanes-viewport')
  if (viewport) viewport.scrollLeft = scrollAnchor(anchorFraction, width, targetVx, laneXPx())
  showZoom()
  // Breitere Bänder tragen wieder mehr Text — sonst bliebe „Wolkig …" stehen,
  // obwohl nach dem Hineinzoomen längst „Wolkig 52%" hineinpasst.
  shortenLabelsSoon()
}

/**
 * Breite und Zoomanzeige an den aktuellen Stand angleichen — ohne zu scrollen.
 *
 * Nötig, weil die Achsenbreite jetzt von den DATEN abhängt (Filmdauer × Maßstab):
 * wird eine Standzeit oder ein Modus geändert, wächst die Leiste. Im
 * eingepassten Zustand wird der Maßstab dabei neu gerechnet, sonst bleibt er
 * stehen — das ist die ganze Pointe des festen Maßstabs.
 */
let lastTimeWidth = -1
function writeTimeWidth(): void {
  const pass = passScale()
  if (pass > 0 && (autoFit || !(pxPerFilmS > 0))) pxPerFilmS = pass
  const width = timeWidthPx()
  // Letzter-Wert-Vergleich: Die Funktion läuft in JEDEM Zug-Frame (über
  // renderZeitleiste). Ohne ihn schriebe sie pro Frame CSS-Variable, Regler und
  // Knopfbeschriftung neu — Arbeit, die während eines Zugs bewusst unterbleibt.
  if (Math.abs(width - lastTimeWidth) < 0.01) return
  lastTimeWidth = width
  $('editor-view').style.setProperty('--timeline-width', `${width}px`)
  showZoom()
}

function showZoom(): void {
  const factor = zoomFactor()
  const slider = document.getElementById('zoom-slider') as HTMLInputElement | null
  if (slider) slider.value = String(Math.round((Math.log(factor) / Math.log(ZOOM_MAX)) * 100))
  const value = document.getElementById('zoom-value') as HTMLButtonElement | null
  if (value) {
    value.textContent = `${factor.toFixed(1).replace('.', ',')}×`
    value.disabled = autoFit
  }
  const zoomOut = document.getElementById('zoom-out') as HTMLButtonElement | null
  if (zoomOut) zoomOut.disabled = autoFit
  const zoomIn = document.getElementById('zoom-in') as HTMLButtonElement | null
  if (zoomIn) zoomIn.disabled = factor >= ZOOM_MAX - 0.001
}

/**
 * Nach Größenänderungen des Fensters. Eingepasst folgt der Maßstab der neuen
 * Breite; ist er eingefroren, bleibt er — dann wandert nur der Ausschnitt, und
 * die Filmsekunde unter einer Pixelstelle ändert sich nicht.
 */
/** Ganzen Film ins Fenster holen (⇧Z, „×"-Knopf, Start) — der Grundzustand. */
function fit(): void {
  autoFit = true
  setScale(passScale(), 0, laneXPx())
}

function fitTimeWidth(): void {
  if (!z) return
  const viewport = document.getElementById('lanes-viewport')
  const anchor =
    viewport && viewport.clientWidth > 0
      ? (viewport.scrollLeft + laneXPx()) / Math.max(1, timeWidthPx())
      : 0
  if (autoFit) {
    setScale(passScale(), 0, laneXPx())
    return
  }
  setScale(pxPerFilmS, Math.max(0, Math.min(1, anchor)), laneXPx())
}

// — Der Abspielkopf steht in FILMsekunden —
//
// `playheadFilmS_` ist die eine Wahrheit für Scrubben, Klick, Pfeiltasten und
// Abspielen. Die Aufnahmezeit (`z.auswahl`, zugleich Einfügemarke für „ab
// hier"-Aktionen) wird daraus ABGELEITET, nie umgekehrt: In Aufnahmezeit gibt
// es keinen Wert für „mitten im Halt" (zwei Stützstellen auf derselben
// Sekunde), die Rückrechnung fällt dort immer auf die linke Haltkante. Genau
// daran klebte der Kopf — 28 von 39 Frames Stillstand, und mit Pfeiltasten kam
// man an einem 6-s-Halt nie vorbei (docs/architecture/zeitleiste-umbau.md §1).

/** Position des Abspielkopfs in Filmsekunden; null = noch keine. */
let playheadFilmS_: number | null = null

/**
 * Der Abspielkopf ist die Einfügemarke `z.auswahl` — eine Größe, nicht zwei:
 * was man anpeilt, ist auch die Stelle, ab der „ab hier"-Aktionen greifen.
 *
 * Diesen Weg nehmen die Gesten, die einen ORT meinen (Klick auf die Karte, ein
 * Zeitfeld): eine Aufnahmezeit trifft den ANFANG eines Halts, was dort richtig
 * ist. Alles, was eine Stelle auf der LEISTE meint, geht über `setPlayheadFilmS`.
 */
function setPlayhead(tOffsetS: number): void {
  if (!z) return
  const scale = buildScale(z.track)
  if (!scale) return
  const clamped = Math.max(scale.fromS, Math.min(scale.toS, tOffsetS))
  const axis = currentAxis()
  playheadFilmS_ = axis?.curve ? filmToOffset(axis, clamped) : null
  const point = pointAtOffset(z.track, clamped)
  if (point) z.cursor = point
  renderPlayhead()
}

/** Den Kopf auf eine FILMsekunde stellen — der führende Weg. */
function setPlayheadFilmS(filmS: number): void {
  if (!z) return
  const axis = currentAxis()
  if (!axis?.curve) return
  playheadFilmS_ = Math.max(0, Math.min(axis.curve.totalS, filmS))
  deriveSelectionFromPlayhead(axis)
  renderPlayhead()
}

/** Aufnahmezeit (und damit `z.auswahl`) aus der Kopf-Filmsekunde nachziehen. */
function deriveSelectionFromPlayhead(axis: TimelineAxis): void {
  if (!z || playheadFilmS_ === null) return
  const point = pointAtOffset(z.track, fractionToOffset(axis, filmToFraction(axis, playheadFilmS_)))
  if (point) z.cursor = point
}

/** Aktuelle Kopf-Filmsekunde (0, solange keine gesetzt ist). */
function playheadFilmS(): number {
  return playheadFilmS_ ?? 0
}

/**
 * Der Abspielkopf liegt ÜBER der klebenden Namensspalte — sonst steckte an
 * Position 0 seine linke Hälfte darunter. Damit er beim Scrollen nicht auf den
 * Spurnamen kleben bleibt, wird er ausgeblendet, sobald er hinter die Spalte
 * gewandert ist. Am Achsenanfang (nichts gescrollt) darf er überstehen: dort
 * gehört er hin, und die Spalte endet genau an seiner Mitte.
 */
function showPlayheadIfInView(): void {
  const stem = document.getElementById('header-rule')
  const viewport = document.getElementById('lanes-viewport')
  if (!stem || !viewport || stem.hidden) return
  // Gemessen statt gerechnet: `left` steht als calc() aus CSS-Variablen da.
  const x = stem.getBoundingClientRect().left - viewport.getBoundingClientRect().left
  stem.classList.toggle('covered', x < laneXPx() - 7)
}

/**
 * Kopfstrich, Kopf-Uhr und Läufer auf die aktuelle Marke stellen.
 *
 * Gezeichnet wird aus `playheadFilmS_` — nicht aus der Aufnahmezeit. Nur so wandert
 * der Strich durch einen Halt-Sprung: dort steht die Aufnahmezeit still, und
 * der Rundweg Zeit → Anteil fiele die ganze Standzeit auf den Sprunganfang
 * zurück. Uhr, km und Läufer dürfen dagegen auf der Halt-Zeit stehen — die Zeit
 * STEHT dort wirklich.
 */
function renderPlayhead(): void {
  if (!z) return
  const stem = document.getElementById('header-rule')
  const axis = currentAxis()
  if (!stem || !axis) return
  if (playheadFilmS_ === null && z.cursor)
    playheadFilmS_ = axis.curve ? filmToOffset(axis, z.cursor[3]) : 0
  if (playheadFilmS_ === null) {
    stem.hidden = true
    return
  }
  stem.hidden = false
  // Die Achse kann sich geändert haben (Standzeit, Fortbewegung) — die
  // Filmsekunde bleibt, die Aufnahmezeit darunter wird nachgezogen.
  if (axis.curve) playheadFilmS_ = Math.min(playheadFilmS_, axis.curve.totalS)
  deriveSelectionFromPlayhead(axis)
  const fraction = axis.curve
    ? filmToFraction(axis, playheadFilmS_)
    : offsetToFraction(axis, z.cursor?.[3] ?? 0)
  const tOffsetS = z.cursor?.[3] ?? axis.fromS
  stem.style.left = timeX(fraction)
  showPlayheadIfInView()

  // Filmzeit prominent: wo im FILM steht die Marke, und wie lang ist er? Die
  // Spielkurve respektiert Trim — bei getrimmten Alt-Touren weicht die Summe
  // deshalb vom Maßband-Ende ab (das die ganze Achse beschriftet).
  const film = document.getElementById('header-film')
  const filmTotal = document.getElementById('header-film-total')
  const play = currentPlayCurve()
  if (film && play) film.textContent = formatFilmTime(filmAt(play, fraction))
  // Kein „~" mehr vor der Gesamtdauer: Es stand an genau EINER Stelle, während
  // dieselbe Zahl im Maßband, in der Dauer-Vorschau eines Zugs und in jedem
  // Klip ohne Vorbehalt auftritt. Ein Zeichen, das nur hier zweifelt, wirkt
  // wie ein Fehler und nicht wie eine Angabe zur Genauigkeit — die steht im
  // Titel der Gruppe, wo man sie liest, wenn man sie braucht.
  if (filmTotal && play) filmTotal.textContent = formatFilmTime(play.totalS)
  // Der laufende Wert reserviert genau so viel, wie der Gesamtwert braucht:
  // Länger als der Film kann der Kopf nicht stehen. Eine feste Reserve am
  // ganzen Block war für kurze Touren rund 30 px zu groß und sammelte sich
  // vollständig rechts; eine zu kleine ließe die Nachbarn bei 9:59 → 10:00
  // springen. `ch` genügt hier, weil tabular-nums alle Ziffern gleich breit
  // macht und der Doppelpunkt in beiden Werten an derselben Stelle steht.
  if (film && filmTotal) film.style.minWidth = `${filmTotal.textContent.length}ch`
  const clock = document.getElementById('header-clock')
  // Ohne Sekunden: die Anzeige läuft beim Scrubben mit, da zappelt eine
  // Sekundenstelle nur.
  const timeIso = offsetToIso(z.data.time.start, tOffsetS)
  if (clock) clock.textContent = clockTimeShort(timeIso)
  showTimeOfDay(timeIso)
  // Was die Uhr als Symbol andeutet, zeigt die Karte als Licht — dieselbe
  // Kopfposition, zwei Auflösungen derselben Auskunft.
  syncMood(timeIso)
  const km = document.getElementById('header-km')
  if (km) km.textContent = kmText(metersToOffset(cumDistances, z.track, tOffsetS))

  setRunner(tOffsetS)
  syncPhoto()
  // Die Karte folgt dem KOPF, nicht dem Abspieler. Vorher hing `followMap`
  // allein an `setPlayheadFraction`, also am laufenden Film — beim Scrubben,
  // Klicken oder mit den Pfeiltasten blieb die Karte stehen, obwohl der
  // Schalter „Karte folgt der Position" heißt und die Position sich sehr wohl
  // bewegte. Hier steht dieselbe Regel wie beim eingeblendeten Foto: eine
  // FUNKTION der Kopfposition, aufgerufen an der einen Stelle, durch die jede
  // Kopfbewegung läuft.
  followMap()
}

/**
 * Sonne · Dämmerung · Mond an der Uhrzeit des Abspielkopfs.
 *
 * Eine Andeutung, keine Astronomie: Grenzen nach Stunden statt nach echtem
 * Sonnenstand — der hinge an Datum UND Breitengrad, und für ein 14-px-Symbol
 * neben einer Uhrzeit wäre das eine Genauigkeit, die niemand abliest. Was es
 * leistet, ist der schnelle Blick: „diese Aufnahme war nachts".
 */
function showTimeOfDay(iso: string): void {
  const el = document.getElementById('header-clock-icon')
  if (!el) return
  const hour = Number(clockTimeShort(iso).slice(0, 2))
  const [className, symbol] = !Number.isFinite(hour)
    ? ['', '#i-clock']
    : hour >= 8 && hour < 18
      ? ['tag', '#i-sun']
      : hour >= 6 && hour < 21
        ? ['dusk', '#i-dusk']
        : ['night', '#i-moon']
  // classList, NICHT className: Letzteres nimmt `readout-icon` mit weg — und mit ihr
  // Größe und Grundfarbe des Symbols.
  el.classList.remove('tag', 'dusk', 'night')
  if (className) el.classList.add(className)
  const use = el.querySelector('use')
  if (use && use.getAttribute('href') !== symbol) use.setAttribute('href', symbol)
}

// — Stimmung und Wetter auf der Karte (Konzept §10) —

let mood: MapMood | null = null

/**
 * Vorgabe: Tageszeit AN, Wetter AUS.
 *
 * Die offene Frage des Konzepts („anfangs an oder aus?") hat für die beiden
 * Schalter verschiedene Antworten, weil sie verschiedene Dinge tun. Die
 * Tageszeit ist eine FARBKORREKTUR — sie bewegt nichts, kostet nichts und
 * beantwortet beim Öffnen sofort, ob man eine Nachtfahrt vor sich hat; wer sie
 * erst einschalten muss, sieht bis dahin eine Tour, die es so nicht gibt. Das
 * Wetter ist BEWEGUNG über dem Bild: Beim Setzen von Ankern will man die Karte
 * sehen, nicht Regen darüber, und es kostet eine Bildschleife.
 */
const MOOD_DEFAULT = { dayNight: true, weather: false }
const MOOD_KEY = 'maptale.editor.mood'

function readMoodPicker(): { dayNight: boolean; weather: boolean } {
  try {
    const raw = localStorage.getItem(MOOD_KEY)
    if (!raw) return { ...MOOD_DEFAULT }
    const w = JSON.parse(raw) as Partial<typeof MOOD_DEFAULT>
    return {
      dayNight: typeof w.dayNight === 'boolean' ? w.dayNight : MOOD_DEFAULT.dayNight,
      weather: typeof w.weather === 'boolean' ? w.weather : MOOD_DEFAULT.weather,
    }
  } catch {
    // Privater Modus, volles Kontingent, kaputter Eintrag — die Vorgabe trägt.
    return { ...MOOD_DEFAULT }
  }
}

function rememberMoodPicker(): void {
  if (!mood) return
  try {
    localStorage.setItem(
      MOOD_KEY,
      JSON.stringify({ dayNight: mood.dayNightOn, weather: mood.weatherOn }),
    )
  } catch {
    /* nicht schreiben zu können ist kein Grund, die Ansicht nicht zu ändern */
  }
}

function buildMood(k: maplibregl.Map): void {
  const stage = document.querySelector<HTMLElement>('.card-stage')
  if (!stage) return
  // Kein Gate mehr: Das Konzept sah eines vor, weil es mit dem Partikel-Overlay
  // rechnete — eine rAF-Schleife, die man während eines Zugs anhalten muss, um
  // das gemessene 5,5-ms-Ziehbudget zu halten. Die Stimmung läuft stattdessen
  // ganz ohne Schleife: zwei Farbflächen und vier Paint-Werte, gesetzt nur bei
  // echter Änderung. Was nichts kostet, muss man nicht anhalten.
  mood = createMapMood(k, 'sat', stage)
  const picker = readMoodPicker()
  mood.setDayNight(picker.dayNight)
  mood.setWeather(picker.weather)
  showMoodPicker()
}

/**
 * Die Leinwand der Foto-Karte über die Bühne legen.
 *
 * Sie liegt ÜBER dem Schleier (`.card-stage::after`, z-index 2) und unter dem
 * Panel-Beiwerk — dieselbe Schichtung wie im Player, wo der Schleier auf 11 und
 * die Leinwand auf 12 liegt. Er bleibt DOM, weil `backdrop-filter` auf einer
 * Leinwand kein Gegenstück hat (Karten-Konzept §4).
 */
function buildCardLayer(): void {
  const stage = document.querySelector<HTMLElement>('.card-stage')
  if (!stage || cardLayer) return
  // Der Schleier ist das `::after` DIESER Bühne — beschriftet wird deshalb sie
  // selbst (`--scrim-opacity`), ein Pseudo-Element nimmt keine Inline-Stile.
  cardLayer = createCardLayer({
    container: stage,
    stage: 'editor',
    id: 'foto-karte',
    scrim: stage,
  })
}

/** Schalterstellungen und den Knopf-Zustand an die Oberfläche schreiben. */
function showMoodPicker(): void {
  const tag = document.getElementById('mood-day-night') as HTMLInputElement | null
  const wet = document.getElementById('mood-weather') as HTMLInputElement | null
  if (tag) tag.checked = mood?.dayNightOn ?? MOOD_DEFAULT.dayNight
  if (wet) wet.checked = mood?.weatherOn ?? MOOD_DEFAULT.weather
  // Der Knopf trägt die Akzentfarbe, sobald irgendetwas eingeschaltet ist —
  // sonst wäre bei geschlossenem Panel nicht zu sehen, woher eine nächtlich
  // abgedunkelte Karte kommt.
  document
    .getElementById('map-mood')
    ?.classList.toggle('on', !!(mood?.dayNightOn || mood?.weatherOn))
}

function wireMood(): void {
  const button = $('map-mood')
  const panel = $('mood-panel')
  const to = (): void => {
    panel.hidden = true
    button.setAttribute('aria-expanded', 'false')
  }
  button.addEventListener('click', (e) => {
    e.stopPropagation()
    const open = panel.hidden
    panel.hidden = !open
    button.setAttribute('aria-expanded', String(open))
    if (open) showMoodPicker()
  })
  // Klick daneben schließt — aber nicht der Klick IM Panel, sonst ginge es bei
  // jedem Umlegen eines Schalters zu.
  document.addEventListener('click', (e) => {
    if (panel.hidden) return
    if (e.target instanceof Node && (panel.contains(e.target) || button.contains(e.target))) return
    to()
  })
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) to()
  })
  $('mood-day-night').addEventListener('change', (e) => {
    mood?.setDayNight((e.target as HTMLInputElement).checked)
    rememberMoodPicker()
    showMoodPicker()
  })
  $('mood-weather').addEventListener('change', (e) => {
    mood?.setWeather((e.target as HTMLInputElement).checked)
    rememberMoodPicker()
    showMoodPicker()
  })
}

/**
 * Die Stimmung an der Kopfposition nachziehen.
 *
 * Aufgerufen aus `renderPlayhead` — dieselbe Stelle wie das eingeblendete Foto
 * und die Kartenmitte, und aus demselben Grund: Was die Karte zeigt, ist eine
 * FUNKTION der Kopfposition und kein Ereignis. Das Wetter kommt aus
 * `displayWeather()`, also aus den eigenen Grenzen, sonst aus dem Auto-Wetter
 * des Servers — genau das, was die Wetter-Bahn darunter zeichnet.
 */
function syncMood(timeIso: string): void {
  if (!mood || !z?.cursor) return
  // `displayWeather()` ist genau die Liste, die die Wetter-Bahn zeichnet: eigene
  // Grenzen, sonst das Auto-Wetter des Servers. Die Karte zeigt damit dasselbe,
  // was in der Leiste steht — und nicht eine zweite Wahrheit daneben.
  const applies = weatherAtTime(displayWeather(), timeIso)
  mood.set(timeIso, [z.cursor[0], z.cursor[1]], applies)
}

const kmText = (meters: number): string => (meters / 1000).toFixed(1).replace('.', ',')

/** Uhrzeit ohne Sekunden, in der Zone der Tour. */
function clockTimeShort(iso: string): string {
  if (!z) return iso
  try {
    return new Intl.DateTimeFormat('de-DE', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: z.data.time.zone,
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

/**
 * Der Läufer zeigt, WO auf der Strecke die Marke steht — und WOMIT man dort
 * unterwegs ist. Das Piktogramm ist zeichengleich mit dem Fahrer im Player
 * (MODE_ICONS in src/map.ts), damit Editor und Wiedergabe dieselbe Sprache
 * sprechen.
 */
function setRunner(tOffsetS: number): void {
  if (!z || !map) return
  const point = pointAtOffset(z.track, tOffsetS)
  if (!point) return
  if (!runner) {
    const el = document.createElement('div')
    el.className = 'runner'
    el.innerHTML = `<span class="pulse"></span><span class="puck">${icon('m-walk')}</span>`
    runner = new maplibregl.Marker({ element: el, subpixelPositioning: true })
      .setLngLat([point[0], point[1]])
      .addTo(map)
  } else {
    runner.setLngLat([point[0], point[1]])
  }
  const segments = splitForDisplay(z.data.segments as EditorSegment[], z.edits, z.data.time.start)
  const treffer = segments.find((a) => {
    const first = a.pts[0] as TrackPoint
    const last = a.pts[a.pts.length - 1] as TrackPoint
    return tOffsetS >= first[3] && tOffsetS <= last[3]
  })
  const glyph = `#i-m-${treffer?.mode ?? 'walk'}`
  const use = runner.getElement().querySelector('.puck use')
  // Nur bei echtem Wechsel setzen — ein neu gesetztes href lässt das <use> flackern.
  if (use && use.getAttribute('href') !== glyph) use.setAttribute('href', glyph)
}

/** Maßband: Filmminuten, Stufe folgt dem Zoom, damit die Achse lesbar bleibt. */
function renderRuler(): void {
  if (!z) return
  const field = document.getElementById('scale-field')
  const axis = currentAxis()
  if (!field || !axis) return
  field.innerHTML = ''
  const widthPx = timeWidthPx()
  const totalS = axis.curve?.totalS
  if (widthPx <= 0 || !totalS) return
  for (const m of buildFilmRuler(axis, widthPx / totalS)) {
    const d = document.createElement('div')
    d.className = 'scale-mark' + (m.full ? ' voll' : '') + (m.edge ? ` at-${m.edge}` : '')
    d.style.left = pos(m.fraction)
    d.append(m.text, document.createElement('i'))
    field.appendChild(d)
  }
}

/** Während eines Zugs nur die betroffenen Teile neu zeichnen (Karte + Leiste). */
function renderAfterDrag(): void {
  drawTrack()
  renderTimeline()
  renderInspector()
}

/**
 * Eine Zustands-Grenze auf einen neuen Zeitpunkt setzen — von BEIDEN Wegen
 * genutzt: Kante ziehen und Zeitfeld im Inspector. Der zugehörige Wert
 * (Modus/Preset/Wetter/Moment-Art) sowie Feinjustierung, Stärke und Dauer
 * bleiben erhalten; landet die Grenze exakt auf einer anderen, verschluckte die
 * Ersetzen-Semantik der Mutatoren diese — deshalb der Kollisions-Schutz.
 *
 * Gibt den neuen ISO-Anker zurück oder null, wenn nichts geschah.
 */
/**
 * Sorgt dafür, dass `from` als echte Grenze im Overlay steht. Die Kanten der
 * Fortbewegungs-Spur kommen zum Teil aus der Aufzeichnung; wer eine davon
 * anfasst, schreibt damit die ganze erkannte Aufteilung fest — sonst risse die
 * neue Grenze alle folgenden Abschnitte mit sich (siehe `materializeTravelModes`).
 * Das geschieht erst beim tatsächlichen Verschieben, nicht schon beim Anfassen.
 */
function writeTravelModesFixed(from: string): boolean {
  if (!z) return false
  if (z.edits.travelModes?.some((g) => g.from === from)) return true
  const fixed = materializeTravelModes(
    z.edits,
    z.data.segments as EditorSegment[],
    z.data.time.start,
  )
  if (!fixed.travelModes?.some((g) => g.from === from)) return false
  z.edits = fixed
  return true
}

/**
 * Dasselbe fürs Wetter: solange niemand eingegriffen hat, zeigt die Spur das
 * automatisch ermittelte Wetter (`daten.autoWeather`). Sobald daran etwas
 * geändert wird, MUSS die ganze Einteilung ins Overlay — dieses ersetzt das
 * Auto-Wetter serverseitig vollständig, eine einzelne neue Grenze ließe den
 * Rest der Tour sonst schlagartig klar werden.
 *
 * Gibt true zurück, wenn danach eigene Grenzen existieren (auch wenn es nie
 * Auto-Wetter gab — dann beginnt die Einteilung eben bei null).
 */
function writeWeatherFixed(): boolean {
  if (!z) return false
  if ((z.edits.weather ?? []).length) return true
  const auto = autoWeatherBoundaries()
  if (!auto.length) return false
  z.edits = { ...z.edits, weather: auto }
  return true
}

/** Vom Server automatisch ermitteltes Wetter, auf gültige Modi gefiltert. */
function autoWeatherBoundaries(): Array<{ from: string; mode: WeatherMode; intensity?: number }> {
  return (z?.data.autoWeather ?? [])
    .filter((g): g is { from: string; mode: WeatherMode; intensity?: number } =>
      (WEATHER_MODES as readonly string[]).includes(g.mode),
    )
    .map((g) =>
      g.intensity === undefined
        ? { from: g.from, mode: g.mode }
        : { from: g.from, mode: g.mode, intensity: g.intensity },
    )
}

/** Wetter-Grenzen, die GERADE GELTEN — eigene, sonst die automatisch ermittelten. */
function displayWeather(): Array<{ from: string; mode: WeatherMode; intensity?: number }> {
  const ownWeather = z?.edits.weather
  return ownWeather?.length ? ownWeather : autoWeatherBoundaries()
}

/**
 * Overlay-Sicht für die ANZEIGE: wie `z.edits`, aber mit dem geltenden Wetter
 * gefüllt. So sehen Bänder, Kanten und Inspector dasselbe, ohne dass das
 * Festschreiben schon beim bloßen Ansehen passieren müsste.
 */
function editsForDisplay(): EditOverlay {
  if (!z) return EMPTY_OVERLAY
  if ((z.edits.weather ?? []).length) return z.edits
  const auto = autoWeatherBoundaries()
  return auto.length ? { ...z.edits, weather: auto } : z.edits
}

function moveBoundary(
  kind: 'travelMode' | 'camera' | 'weather' | 'moment',
  oldFrom: string,
  newOffsetS: number,
): string | null {
  if (!z) return null
  const scale = buildScale(z.track)
  if (!scale) return null
  // Modus- und Wetterkanten können aus der Automatik stammen — erst
  // festschreiben, dann stehen auch die Nachbarn fest, zwischen die geklemmt wird.
  if (kind === 'travelMode' && !writeTravelModesFixed(oldFrom)) return null
  if (kind === 'weather' && !writeWeatherFixed()) return null
  const neighbors =
    kind === 'travelMode'
      ? (z.edits.travelModes ?? [])
      : kind === 'camera'
        ? (z.edits.camera ?? [])
        : kind === 'weather'
          ? (z.edits.weather ?? [])
          : [] // Momente sind Punktereignisse — ihre Reihenfolge trägt nichts
  // Fortbewegung interpoliert Grenzen auf die Linie — Trackpunkt-Raster würde
  // die Kante wieder in großen Sprüngen einrasten lassen (Berner Oberland).
  // Kamera/Wetter bleiben am Raster: ihre Bänder hängen nicht an Abschnitten.
  const clamped = clampBoundary(
    neighbors,
    oldFrom,
    z.data.time.start,
    Math.max(scale.fromS, Math.min(scale.toS, newOffsetS)),
    kind === 'travelMode' || kind === 'moment' ? undefined : z.track.map((p) => p[3]),
  )
  const newFrom = offsetToIso(z.data.time.start, clamped)
  if (newFrom === oldFrom) return oldFrom
  if (kind === 'travelMode') {
    const old = z.edits.travelModes?.find((g) => g.from === oldFrom)
    if (!old || z.edits.travelModes?.some((g) => g.from === newFrom)) return null
    z.edits = withTravelModeBoundary(withoutTravelModeBoundary(z.edits, oldFrom), newFrom, old.mode)
  } else if (kind === 'camera') {
    const old = z.edits.camera?.find((g) => g.from === oldFrom)
    if (!old || z.edits.camera?.some((g) => g.from === newFrom)) return null
    z.edits = withCameraBoundary(
      withoutCameraBoundary(z.edits, oldFrom),
      newFrom,
      old.preset,
      old.scale,
    )
  } else if (kind === 'weather') {
    const old = z.edits.weather?.find((g) => g.from === oldFrom)
    if (!old || z.edits.weather?.some((g) => g.from === newFrom)) return null
    z.edits = withWeatherBoundary(
      withoutWeatherBoundary(z.edits, oldFrom),
      newFrom,
      old.mode,
      old.intensity,
    )
  } else {
    const old = z.edits.moments?.find((m) => m.from === oldFrom)
    if (!old || z.edits.moments?.some((m) => m.from === newFrom)) return null
    z.edits = withCameraMoment(
      withoutCameraMoment(z.edits, oldFrom),
      newFrom,
      old.kind,
      old.durationS,
    )
    if (z.selection?.kind === 'moment') z.selection = { kind: 'moment', from: newFrom }
  }
  return newFrom
}

/**
 * Mindestweg, bevor aus einem Druck ein ZUG wird.
 *
 * Ohne diese Schwelle galt schon die erste `pointermove`-Meldung als Zug — und
 * die kommt bei einem gewöhnlichen Klick fast immer (eine Maus wackelt um ein
 * Pixel). Der Klick endete dann im „bewegt"-Zweig, der bewusst NICHT auswählt:
 * Bänder ließen sich „manchmal" nicht markieren. Derselbe Wert wie beim
 * Foto-Zug (`ziehStopp`).
 */
const DRAG_THRESHOLD_PX = 4

function timelineDrag(e: PointerEvent): void {
  if (!z || !drag) return
  const scale = currentAxis()
  if (!scale) return
  if (!drag.moved) {
    if (Math.abs(e.clientX - drag.startX) < DRAG_THRESHOLD_PX) return
    drag.moved = true
    // Der Greif-Cursor gilt erst AB HIER: beim bloßen Draufdrücken sah man
    // sonst „Rand ziehen", obwohl man nur etwas auswählen wollte.
    $('timeline-zone').classList.add(EDGE_ROLES.has(drag.role) ? 'dragging' : 'shifting')
  }
  const start = z.data.time.start
  const fraction = laneFraction(e.clientX)
  const iso = (a: number): string => offsetToIso(start, fractionToOffset(scale, a))

  switch (drag.role) {
    // Die drei ZUSTANDS-Kanten laufen entkoppelt: die Kante ist während des
    // Zugs eine reine Anzeigegröße am Zeiger, geschrieben wird erst beim
    // Loslassen (s. kantenZugBewegen).
    case 'boundary':
    case 'camera':
    case 'weather':
      moveEdgeDrag(e)
      return
    // Ton-Klips rechnen seit Etappe 4 in FILMsekunden (docs §2E). Jede Geste
    // schreibt den Anker mit — dadurch wird ein Klip in alter `from`/`to`-Form
    // beim ersten Anfassen festgeschrieben, und nur dieser eine (anders als bei
    // den Modus-Grenzen sind Ton-Klips unabhängige Objekte).
    case 'audio-bar':
    case 'audio-from':
    case 'audio-to':
    case 'sfx': {
      if (drag.index === undefined) break
      const clip = audioClipFrom(drag.index)
      if (!clip) break
      const targetFilmS = fractionToFilm(scale, fraction)
      let patch: AudioClipPatch
      if (drag.role === 'audio-from') {
        const erg = trimLeft(scale, start, clip, targetFilmS)
        patch = erg.patch
        drag.atLimit = erg.atLimit
      } else if (drag.role === 'audio-to') {
        const erg = trimRight(scale, start, clip, targetFilmS)
        patch = erg.patch
        drag.atLimit = erg.atLimit
      } else {
        // Verschieben: der Griffversatz hält den Klip unter dem Zeiger, statt
        // ihn mit seinem Anfang dorthin springen zu lassen.
        patch = moveAudioClip(scale, start, clip, targetFilmS - (drag.gripOffsetFilmS ?? 0))
        drag.atLimit = false
      }
      z.edits = mitAudioPatch(z.edits, drag.index, {
        ...patch,
        // Der Einstieg wird beim Verschieben nicht angefasst; steht er auf 0,
        // gehört das Feld gelöscht statt als Null hinterlassen.
        startS: patch.startS && patch.startS > 0 ? patch.startS : undefined,
      })
      showAudioLabel(clip, patch, drag.atLimit === true)
      break
    }
  }
  renderAfterDrag()
}

// — Der Zug einer ZUSTANDS-Kante: die Kante ist eine Anzeigegröße —
//
// Zwei frühere Anläufe schrieben die Grenze live ins Modell und leiteten die
// Anzeige daraus ab. Beides ging schief, und aus demselben Grund: Die Abbildung
// Zeigerposition → Aufnahmezeit ist nicht überall umkehrbar. In einem Halt
// verbraucht der Film Zeit, die Aufnahme aber nicht — dort stand die Kante über
// 135 px reglos still. Und bei der Fortbewegung hängt die Abbildung von der
// Kante selbst ab (im Tempo je Modus steckt die Filmzeit), sodass der Griff dem
// Zeiger davonlief. Beides verschwindet, sobald die Anzeige während des Zugs
// nicht mehr durch das Modell muss (docs §1, §2D).
//
// Während des Zugs wandern deshalb Kante UND die beiden anliegenden Bänder
// lückenlos mit dem Zeiger; das Overlay bleibt unberührt. Erst beim Loslassen
// wird einmal gerechnet und geschrieben — das ist zugleich genau ein
// Undo-Schritt.

interface EdgeDrag {
  kind: 'travelMode' | 'camera' | 'weather'
  from: string
  /** Fenster zwischen den Nachbargrenzen — in Aufnahmezeit und in Filmsekunden */
  fromS: number
  toS: number
  minFilmS: number
  maxFilmS: number
  /** Filmsekunde → Aufnahmezeit. Bei der Fortbewegung die eigene Zug-Kurve. */
  timeAt: (filmS: number) => number
  /** Vorschau der Filmlänge (nur Fortbewegung) */
  durationAt?: (tOffsetS: number) => number
  totalFilmBefore: number
  moved: boolean
}

let edgeDrag: EdgeDrag | null = null

/** Zeiten der Kanten EINER Zustandsbahn, aufsteigend (ohne die Tour-Ränder). */
function edgeTimes(kind: 'travelMode' | 'camera' | 'weather'): number[] {
  if (!z) return []
  const start = z.data.time.start
  if (kind === 'travelMode') {
    // Die Fortbewegung zeigt AUCH Kanten aus der Aufzeichnung — Nachbar ist,
    // was man sieht, nicht nur was im Overlay steht.
    const segments = splitForDisplay(z.data.segments as EditorSegment[], z.edits, start)
    const zeiten: number[] = []
    for (const [i, a] of segments.entries()) {
      const before = segments[i - 1]
      if (before && before.mode !== a.mode) zeiten.push((a.pts[0] as TrackPoint)[3])
    }
    return zeiten
  }
  const boundaries = kind === 'camera' ? (z.edits.camera ?? []) : displayWeather()
  return boundaries
    .map((g) => isoToOffset(start, g.from))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b)
}

/** Modus links und rechts einer Fortbewegungs-Kante (für Tempo und Vorschau). */
function travelModesAroundEdge(
  tOffsetS: number,
): { before: TravelMode | null; left: TravelMode; right: TravelMode } | null {
  if (!z) return null
  const segments = splitForDisplay(z.data.segments as EditorSegment[], z.edits, z.data.time.start)
  const i = segments.findIndex((a) => Math.abs((a.pts[0] as TrackPoint)[3] - tOffsetS) < 1)
  const right = segments[i]
  const links = segments[i - 1]
  // `davor` ist der Modus VOR dem Zug-Fenster: Beschleunigt der Film an dessen
  // linker Kante, liegt die Rampe IM Fenster und kostet dort Zeit.
  return right && links
    ? { before: segments[i - 2]?.mode ?? null, left: links.mode, right: right.mode }
    : null
}

/** Zug-Start: Fenster und Umrechnung einsammeln — beides steht dann fest. */
function startEdgeDrag(target: HTMLElement, role: string): void {
  edgeDrag = null
  if (!z) return
  const from = target.dataset['from']
  const axis = currentAxis()
  const scale = buildScale(z.track)
  if (!from || !axis?.curve || !scale) return
  const kind = role === 'boundary' ? 'travelMode' : (role as 'camera' | 'weather')
  const ownS = isoToOffset(z.data.time.start, from)
  if (!Number.isFinite(ownS)) return
  // Die eigene Kante über den INDEX finden, nicht über eine Zeit-Toleranz: Der
  // Overlay-Anker ist sekundengenau (`offsetToIso` schneidet die Millisekunden
  // ab), die Wechselzeit im Track ist es nicht. Mit „alles vor mir / alles nach
  // mir" wurde die eigene Kante deshalb zum rechten Nachbarn — das Zug-Fenster
  // war der Abschnitt DAVOR, und die Kante klemmte nach 7 px fest.
  const zeiten = edgeTimes(kind)
  let ownIdx = -1
  let bestFrom = 2 // mehr als zwei Sekunden daneben ist keine Rundung mehr
  zeiten.forEach((t, i) => {
    const from2 = Math.abs(t - ownS)
    if (from2 < bestFrom) {
      bestFrom = from2
      ownIdx = i
    }
  })
  const fromS =
    (ownIdx > 0 ? zeiten[ownIdx - 1] : zeiten.filter((t) => t < ownS).pop()) ?? scale.fromS
  const toS = (ownIdx >= 0 ? zeiten[ownIdx + 1] : zeiten.find((t) => t > ownS)) ?? scale.toS
  // Für Tempo und Meter zählt die Kante, wie sie im Track LIEGT — nicht ihr auf
  // die Sekunde gerundeter Anker.
  const edgeS = ownIdx >= 0 ? (zeiten[ownIdx] as number) : ownS
  const totalS = axis.curve.totalS
  const filmVon = filmToOffset(axis, fromS)

  let timeAt = (filmS: number): number => fractionToOffset(axis, filmToFraction(axis, filmS))
  let maxFilmS = filmToOffset(axis, toS)
  let durationAt: ((t: number) => number) | undefined

  if (kind === 'travelMode') {
    // Die Fortbewegung braucht ihre EIGENE Abbildung: die Grenze ändert die
    // Achse, auf der sie liegt. Analytisch statt per Bisektion — an einem
    // 10 000-Punkte-Track kostete die 12,5 ms je Frame, das hier 0,2 ms EINMAL.
    // Und weil sie EXAKT ist, darf der Zug live ins Modell schreiben: die Kante
    // landet nach jedem Neuaufbau wieder unter dem Zeiger.
    const travelModes = travelModesAroundEdge(edgeS)
    const curve = travelModes
      ? buildBoundaryCurve(z.track, fromS, toS, travelModes, filmVon, axis.stops ?? [])
      : null
    if (!curve || !travelModes) return
    timeAt = (filmS: number): number => recordingTimeAtFilmTime(curve, filmS)
    maxFilmS = curve.totalS
    const metersOld = metersToOffset(cumDistances, z.track, edgeS)
    const zz = z
    durationAt = (t: number): number =>
      filmDurationAtBoundary(
        totalS,
        metersOld,
        metersToOffset(cumDistances, zz.track, t),
        travelModes.left,
        travelModes.right,
      )
  }

  edgeDrag = {
    kind,
    from,
    fromS,
    toS,
    minFilmS: filmVon,
    maxFilmS,
    timeAt,
    ...(durationAt ? { durationAt } : {}),
    totalFilmBefore: totalS,
    moved: false,
  }
}

/**
 * Ein Zieh-Frame: die Grenze wird gesetzt und die Leiste neu aufgebaut.
 *
 * Damit zeigt die Leiste WÄHREND des Zugs schon die Anordnung, die beim
 * Loslassen gilt — Klips, Bänder und Marken rücken mit. Das ist nicht Kosmetik:
 * Zielen und Landen finden dadurch im selben Bild statt. Solange die Leiste die
 * alte Anordnung zeigte, konnte eine Rast-Vorschau nur eines von beidem sein,
 * und beide Fassungen waren falsch (docs §4, Etappe 3).
 *
 * Möglich ist das erst durch die EXAKTE Umrechnung: `timeAt` liefert die Zeit,
 * deren Filmposition in der DARAUS entstehenden Achse wieder `filmS` ist. Die
 * Kante steht nach dem Neuaufbau also weiter unter dem Zeiger. Mit der Achse
 * des Vorframes gerechnet sprang sie um 116 px — das war der Grund, den Zug
 * überhaupt zu entkoppeln.
 *
 * Ein Undo-Schritt bleibt es: `renderAfterDrag` schreibt `lastState` nicht
 * fort, erst das abschließende `renderAll` setzt den Punkt.
 */
function moveEdgeDrag(e: PointerEvent): void {
  const kz = edgeDrag
  if (!kz || !z) return
  const axis = currentAxis()
  if (!axis?.curve) return
  if (!kz.moved) {
    kz.moved = true
    // Maßstab einfrieren: eingepasst skalierte die geänderte Filmdauer die
    // GANZE Leiste, auch alles vor der Kante (§2C).
    autoFit = false
  }
  const raw = fractionToFilm(axis, laneFraction(e.clientX))
  const filmS = clampFilmS(raw, kz.minFilmS, kz.maxFilmS, pxPerFilmS)
  // Gerastet wird an den Halten, wie sie JETZT auf der Leiste stehen — und das
  // ist seit dem Live-Aufbau zugleich die Anordnung beim Loslassen.
  const stops = (axis.stops ?? []).filter((h) => h.offsetS > kz.fromS && h.offsetS <= kz.toS)
  const snap = snapToStop(stops, fractionToOffset(axis, filmToFraction(axis, filmS)), filmS)
  const target = snap.stop ? snap.tOffsetS : kz.timeAt(filmS)

  const newFrom = moveBoundary(kz.kind, kz.from, target)
  if (newFrom) kz.from = newFrom
  renderAfterDrag()

  // Erst nach dem Aufbau: die Kante ist ein frisches Element, und wo sie steht,
  // weiß jetzt die neue Achse.
  const newAxis = currentAxis()
  const edgeS = isoToOffset(z.data.time.start, kz.from)
  const edgeFilmS = newAxis ? filmToOffset(newAxis, edgeS) : filmS
  for (const el of document.querySelectorAll<HTMLElement>('#timeline-zone .edge')) {
    el.classList.toggle('dragging', el.dataset['from'] === kz.from)
  }
  const parts = [
    `${formatFilmTime(edgeFilmS)} · ${clockTimeShort(offsetToIso(z.data.time.start, edgeS))} Uhr`,
  ]
  if (snap.stop) parts.push(snap.behind ? 'rastet hinter den Halt' : 'rastet vor den Halt')
  if (kz.durationAt) {
    const next = kz.durationAt(edgeS)
    if (Math.abs(next - kz.totalFilmBefore) > 0.5) {
      parts.push(`Film ${formatFilmTime(kz.totalFilmBefore)} → ${formatFilmTime(next)}`)
    }
  }
  showTargetLine(edgeFilmS * pxPerFilmS, parts.join(' · '), !!snap.stop)
  // Der Halt, an dem gerastet wird, leuchtet mit — die Erklärung passiert in
  // der Bewegung, nicht in einer Legende.
  for (const el of document.querySelectorAll('.stop-clip.snapping')) el.classList.remove('snapping')
  for (const st of snap.stop?.items ?? []) clipEls.get(st.id)?.classList.add('snapping')
}

/** Loslassen: aufräumen. Geschrieben wurde schon — jetzt fällt der Undo-Punkt. */
function endEdgeDrag(): boolean {
  const kz = edgeDrag
  edgeDrag = null
  hideTargetLine()
  for (const el of document.querySelectorAll('.stop-clip.snapping')) el.classList.remove('snapping')
  for (const el of document.querySelectorAll('#timeline-zone .edge.dragging'))
    el.classList.remove('dragging')
  return !!kz?.moved
}

function showTargetLine(px: number, text: string, snaps: boolean): void {
  let el = document.querySelector<HTMLElement>('.target-line')
  if (!el) {
    el = document.createElement('div')
    el.className = 'target-line'
    el.appendChild(document.createElement('b'))
    $('lanes').appendChild(el)
  }
  el.classList.toggle('snapping', snaps)
  // Sie ist während des ganzen Zugs da: als ORIENTIERUNG durch alle Bahnen
  // („was liegt hier zeitlich übereinander?"). Beim Rasten tritt sie hervor.
  // In Pixeln, nicht als Anteil von `--timeline-width`: die Breite hängt an der
  // Filmdauer, und genau die ändert der Zug.
  el.style.left = `calc(var(--lane-x) + ${px.toFixed(1)}px)`
  const label = el.querySelector('b')
  if (label && label.textContent !== text) label.textContent = text
}

function hideTargetLine(): void {
  document.querySelector('.target-line')?.remove()
}

/** Den Ton-Klip an einem Overlay-Index in seiner AKTUELLEN Filmlage auflösen. */
function audioClipFrom(index: number): AudioClip | null {
  const scale = currentAxis()
  if (!z || !scale) return null
  return (
    resolveAudioClips(z.edits.audio ?? [], z.data.time.start, scale, audioDurations).find(
      (k) => k.index === index,
    ) ?? null
  )
}

/**
 * Etikett am Zeiger während einer Ton-Geste.
 *
 * Am Materialanschlag sagt es das AUSDRÜCKLICH: Eine Kante, die kommentarlos
 * stehen bleibt, liest sich als hakender Griff — man zieht weiter und wundert
 * sich, statt zu verstehen, dass die Datei zu Ende ist.
 */
function showAudioLabel(clip: AudioClip, patch: AudioClipPatch, atLimit: boolean): void {
  const scale = currentAxis()
  if (!scale) return
  const filmVon =
    patch.offsetFilmS + filmToOffset(scale, isoToOffset(z?.data.time.start ?? '', patch.anchor))
  const length = patch.durationFilmS ?? clip.filmBis - clip.filmVon
  const parts = [formatFilmTime(length)]
  if (patch.startS) parts.push(`from ${formatFilmTime(patch.startS)} der Datei`)
  if (atLimit) parts.push('kein Material mehr')
  showTargetLine(filmVon * pxPerFilmS, parts.join(' · '), atLimit)
}

function wireTimeline(): void {
  const zone = $('timeline-zone')
  const viewport = $('lanes-viewport')

  // Der Abspielkopf liegt über der Namensspalte — beim Scrollen muss er
  // verschwinden, sobald er dahinter wandert.
  viewport.addEventListener('scroll', showPlayheadIfInView, { passive: true })

  // — Ziehen an Kanten, Griffen, Pins und Klips —
  zone.addEventListener('pointerdown', (e) => {
    if (!z || tool !== 'select') return
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-role]')
    if (!target) return
    const role = target.dataset['role']!
    // Klips und ihr Standzeit-Griff bringen ihre eigenen Zug-Handler mit
    // (klipZeiger) — sie laufen über Fenster-Listener, damit ein schneller Zug
    // die schmalen Griffe nicht verliert.
    if (role === 'klip' || role === 'standzeit' || role === 'momentklip' || role === 'momentdauer')
      return
    e.preventDefault()
    // Ein beginnender Zug hält das Abspielen an: Züge rendern über
    // renderNachZug (ohne halteAbspielen) — der Abspieler liefe sonst auf
    // einem veralteten Plan weiter.
    stopsPlay()
    zone.setPointerCapture(e.pointerId)
    // KEIN Greif-Cursor beim bloßen Drücken — den setzt erst der echte Zug
    // (zeitleisteZug, from ZUG_SCHWELLE_PX).
    drag = { role, startX: e.clientX, moved: false, selection: bandUnderPointer(e) }
    if (target.dataset['from'] !== undefined) drag.from = target.dataset['from']
    if (target.dataset['mode']) drag.mode = target.dataset['mode'] as TravelMode
    if (target.dataset['preset']) drag.preset = target.dataset['preset'] as CameraPreset
    if (target.dataset['wettermode']) drag.weatherMode = target.dataset['wettermode'] as WeatherMode
    if (target.dataset['kind']) drag.momentKind = target.dataset['kind'] as CameraMomentKind
    if (target.dataset['index'] !== undefined) drag.index = Number(target.dataset['index'])
    if (STATE_EDGES.has(role)) startEdgeDrag(target, role)
    if (role === 'audio-balken') {
      // Versatz zwischen Cursor und Klipanfang merken → ruckfreies Schieben.
      // In FILMsekunden, nicht in Anteilen: Der Klip behält beim Verschieben
      // seine Filmdauer, und in Anteilen gerechnet wäre der Versatz an einer
      // Halt-Flanke ein anderer als daneben.
      const scale = currentAxis()
      const clip = scale ? audioClipFrom(drag.index ?? -1) : null
      if (scale && clip)
        drag.gripOffsetFilmS = fractionToFilm(scale, laneFraction(e.clientX)) - clip.filmVon
    }
  })

  zone.addEventListener('pointermove', (e) => {
    if (drag) timelineDrag(e)
  })

  const dragEnd = (e: PointerEvent): void => {
    const zz = z // Modul-let: Narrowing überlebt Funktionsaufrufe nicht
    if (!zz) return
    if (drag) {
      const was = drag
      drag = null
      zone.classList.remove('dragging', 'shifting')
      if (zone.hasPointerCapture(e.pointerId)) zone.releasePointerCapture(e.pointerId)
      const edgesWritten = endEdgeDrag()
      if (was.moved || edgesWritten) {
        suppressClick = true
        renderAll()
        return
      }
      // Kein Zug = Klick: Abspielkopf setzen UND das getroffene Band
      // fokussieren — ein Klick, beide sinnvollen Wirkungen. Traf er nichts,
      // wird die Auswahl aufgehoben (wie im Schnittprogramm).
      const audioRoles = ['audio-bar', 'audio-from', 'audio-to', 'sfx']
      if (audioRoles.includes(was.role) && was.index !== undefined) {
        zz.selection = { kind: 'audio', index: was.index }
        renderAll()
      } else {
        // Ein Klick in die SPUREN wählt nur aus — den Abspielkopf setzt allein
        // das Maßband (und sein eigener Griff). Vorher sprang er bei jedem
        // Klick auf ein Band oder eine Bandkante mit, während er bei den
        // Ton-Klips stehen blieb: dieselbe Geste, zwei verschiedene Wirkungen.
        // Ein Band anzufassen heißt, es zu meinen, nicht die Stelle darunter.
        zz.selection = was.selection ?? null
        renderAll()
      }
    }
  }
  // Der Klick auf einen Klip gehört seinem eigenen Handler (ziehKlip) — er
  // kennt den Unterschied zwischen Antippen und Ziehen.
  zone.addEventListener('pointerup', dragEnd)
  zone.addEventListener('pointercancel', dragEnd)

  // — Abspielkopf ziehen —
  //
  // Über FENSTER-Listener statt Pointer-Capture: der Kopf ist 13 px breit,
  // eine Capture darauf verlöre bei schnellen Bewegungen die Ereignisse.
  $('header-grip').addEventListener('pointerdown', (e) => {
    if (!z || e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const gesture = scrubGesture()
    document.body.classList.add('scrubbing')
    const scale = currentAxis()
    // Scrubben meint eine Stelle auf der LEISTE, also eine Filmsekunde — in
    // Aufnahmezeit übersetzt bliebe der Kopf an jeder Haltkante kleben.
    const set = (clientX: number): void => {
      if (!scale) return
      setPlayheadFilmS(fractionToFilm(scale, laneFraction(clientX)))
    }
    const edgeScroll = edgeScroller(set)
    const onDrag = (ev: PointerEvent): void => {
      set(ev.clientX)
      edgeScroll.move(ev.clientX)
    }
    const release = (): void => {
      window.removeEventListener('pointermove', onDrag)
      window.removeEventListener('pointerup', release)
      edgeScroll.stop()
      document.body.classList.remove('scrubbing')
      suppressClick = true
      gesture()
    }
    window.addEventListener('pointermove', onDrag)
    window.addEventListener('pointerup', release)
  })

  // Klick/Zug auf dem Maßband scrubbt ebenfalls — die vertraute Geste.
  $('scale-field').addEventListener('pointerdown', (e) => {
    if (!z || e.button !== 0 || tool !== 'select') return
    e.preventDefault()
    const scale = currentAxis()
    if (!scale) return
    const gesture = scrubGesture()
    setPlayheadFilmS(fractionToFilm(scale, laneFraction(e.clientX)))
    document.body.classList.add('scrubbing')
    const set = (clientX: number): void =>
      setPlayheadFilmS(fractionToFilm(scale, laneFraction(clientX)))
    const edgeScroll = edgeScroller(set)
    const onDrag = (ev: PointerEvent): void => {
      set(ev.clientX)
      edgeScroll.move(ev.clientX)
    }
    const release = (): void => {
      window.removeEventListener('pointermove', onDrag)
      window.removeEventListener('pointerup', release)
      edgeScroll.stop()
      document.body.classList.remove('scrubbing')
      renderAll()
      gesture()
    }
    window.addEventListener('pointermove', onDrag)
    window.addEventListener('pointerup', release)
  })

  // — Ereignis anlegen: „+" an jeder Bahn, Ablage im Kopf —
  zone.addEventListener('click', (e) => {
    const plus = (e.target as HTMLElement).closest<HTMLElement>('.lane-plus')
    if (!plus?.dataset['lane']) return
    e.stopPropagation()
    if (plus.getAttribute('aria-expanded') === 'true') closeLaneMenu()
    else openLaneMenu(plus.dataset['lane'], plus)
  })
  $('tray-button').addEventListener('click', (e) => {
    e.stopPropagation()
    if (openMenu?.dataset['tray'] === '1') closeLaneMenu()
    else openTray()
  })
  // Klick daneben oder Esc schließt — ein Menü darf nie hängen bleiben.
  // Der öffnende Knopf zählt nicht als „daneben": sonst schließt pointerdown
  // zuerst, und der anschließende click öffnet sofort wieder (Toggle kaputt).
  document.addEventListener('pointerdown', (e) => {
    if (!openMenu) return
    const target = e.target as Node
    if (openMenu.contains(target)) return
    if ((target as HTMLElement).closest?.('#tray-button, .lane-plus')) return
    closeLaneMenu()
  })
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && openMenu) closeLaneMenu()
  })

  // — Werkzeuge: Hand pannt, Zoom klickt/zieht. Der Abspielkopf bleibt in
  //   jedem Werkzeug greifbar (er ist von diesem Handler ausgenommen). —
  $('timeline-zone')
    .querySelector('.werkzeuge')
    ?.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('.tool')
      if (b?.dataset['tool']) setTool(b.dataset['tool'] as typeof tool)
    })
  viewport.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || tool === 'select') return
    if ((e.target as HTMLElement).closest('.header-grip')) return
    e.preventDefault()
    const fr = viewport.getBoundingClientRect()
    const fractionAt = (clientX: number): number =>
      Math.min(
        Math.max(
          (viewport.scrollLeft + (clientX - fr.left) - laneXPx()) / Math.max(1, timeWidthPx()),
          0,
        ),
        1,
      )
    if (tool === 'hand') {
      viewport.classList.add('grabbing')
      const startX = e.clientX
      const startScroll = viewport.scrollLeft
      const onDrag = (ev: PointerEvent): void => {
        viewport.scrollLeft = startScroll - (ev.clientX - startX)
      }
      const release = (): void => {
        window.removeEventListener('pointermove', onDrag)
        window.removeEventListener('pointerup', release)
        viewport.classList.remove('grabbing')
      }
      window.addEventListener('pointermove', onDrag)
      window.addEventListener('pointerup', release)
      return
    }
    const startX = e.clientX
    const box = $('zoom-box')
    let dragged = false
    const onDrag = (ev: PointerEvent): void => {
      if (!dragged && Math.abs(ev.clientX - startX) < 5) return
      dragged = true
      box.style.display = 'block'
      box.style.left = `${Math.min(startX, ev.clientX)}px`
      box.style.width = `${Math.abs(ev.clientX - startX)}px`
      box.style.top = `${fr.top}px`
      box.style.height = `${fr.height}px`
    }
    const release = (ev: PointerEvent): void => {
      window.removeEventListener('pointermove', onDrag)
      window.removeEventListener('pointerup', release)
      box.style.display = 'none'
      if (dragged) {
        // Auf den aufgezogenen Bereich zoomen — er füllt danach die Breite
        const a = fractionAt(Math.min(startX, ev.clientX))
        const b = fractionAt(Math.max(startX, ev.clientX))
        setScale(passScale() / Math.max(b - a, 0.02), (a + b) / 2, viewport.clientWidth / 2)
      } else {
        setScale(
          pxPerFilmS * (ev.altKey ? 1 / 1.6 : 1.6),
          fractionAt(ev.clientX),
          ev.clientX - fr.left,
        )
      }
    }
    window.addEventListener('pointermove', onDrag)
    window.addEventListener('pointerup', release)
  })

  // — Zoom-Bedienung im Kopf —
  const zoomAnchor = (): { fraction: number; vx: number } => {
    const scale = currentAxis()
    // Um den Abspielkopf zoomen, wenn er sichtbar ist — sonst um die Fenstermitte
    if (z?.cursor && scale) {
      const fraction = offsetToFraction(scale, z.cursor[3])
      const vx = laneXPx() + fraction * timeWidthPx() - viewport.scrollLeft
      if (vx >= 0 && vx <= viewport.clientWidth) return { fraction, vx }
    }
    const center = viewport.clientWidth / 2
    return {
      fraction: (viewport.scrollLeft + center - laneXPx()) / Math.max(1, timeWidthPx()),
      vx: center,
    }
  }
  $('zoom-in').addEventListener('click', () => {
    const a = zoomAnchor()
    setScale(pxPerFilmS * 1.6, a.fraction, a.vx)
  })
  $('zoom-out').addEventListener('click', () => {
    const a = zoomAnchor()
    setScale(pxPerFilmS / 1.6, a.fraction, a.vx)
  })
  $('zoom-value').addEventListener('click', fit)
  $('zoom-slider').addEventListener('input', (e) => {
    const v = Number((e.target as HTMLInputElement).value) / 100
    const a = zoomAnchor()
    setScale(passScale() * Math.pow(ZOOM_MAX, v), a.fraction, a.vx)
  })
  // Pinch/⌘-Rad zoomt um den Cursor (wie im Schnittprogramm)
  viewport.addEventListener(
    'wheel',
    (e) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const fr = viewport.getBoundingClientRect()
      const fraction =
        (viewport.scrollLeft + (e.clientX - fr.left) - laneXPx()) / Math.max(1, timeWidthPx())
      setScale(
        pxPerFilmS * Math.exp(-e.deltaY / 220),
        Math.max(0, Math.min(1, fraction)),
        e.clientX - fr.left,
      )
    },
    { passive: false },
  )
}

/** Werkzeug umschalten — Cursor und Timeline-Verhalten folgen dem Zustand. */
function setTool(w: typeof tool): void {
  tool = w
  document
    .querySelectorAll<HTMLElement>('.tool')
    .forEach((b) => b.classList.toggle('on', b.dataset['tool'] === w))
  const viewport = document.getElementById('lanes-viewport')
  if (viewport) viewport.dataset['tool'] = w
}

/**
 * Flash-Meldung unter der Kopfleiste (DESIGN.md → Flash Messages). EIN Element,
 * eine neue Meldung ersetzt die alte — die Semantik der früheren Statuszeile.
 * 'ok' blendet nach ~4 s aus, 'fehler' nach ~7 s; eine neutrale Meldung
 * („… wird geladen") trägt einen Kreisel und bleibt, bis sie abgelöst oder mit
 * status('') aufgeräumt wird.
 *
 * Das Bleiben ist deshalb ein VERSPRECHEN, kein Nebeneffekt: Wer eine fertige
 * Handlung ohne Klasse meldet, bekommt einen Kreisel, der ewig dreht —
 * „Rückgängig gemacht." stand so dauerhaft unter dem Kopf, weil danach nichts
 * mehr kam, das sie ablöste. Eine abgeschlossene Handlung ist 'ok'.
 */
let flashClock: number | null = null
function status(text: string, className = ''): void {
  const el = $('editor-flash')
  if (flashClock !== null) {
    clearTimeout(flashClock)
    flashClock = null
  }
  const wasVisible = el.classList.contains('zeigt')
  if (!text) {
    el.classList.remove('zeigt', 'pop')
    return
  }
  el.className = `editor-flash zeigt ${className}`
  // Symbol statisch, der TEXT über textContent — Meldungen tragen Dateinamen.
  el.innerHTML =
    className === 'ok'
      ? icon('check')
      : className === 'fehler'
        ? icon('x')
        : className === 'warnung'
          ? icon('warning')
          : '<span class="spinner"></span>'
  const span = document.createElement('span')
  span.textContent = text
  el.appendChild(span)
  if (wasVisible) {
    // Ersetzen pulst kurz — Animation neu anstoßen (Reflow-Trick wie .pulse).
    el.classList.remove('pop')
    void el.offsetWidth
    el.classList.add('pop')
  }
  if (className) {
    flashClock = window.setTimeout(
      () => {
        el.classList.remove('zeigt', 'pop')
        flashClock = null
      },
      // Die Warnung steht so lange wie der geschärfte Knopf: Sie ERKLÄRT ihn.
      // Verschwände sie früher, bliebe ein Knopf mit einer Frage ohne Kontext.
      className === 'fehler' ? 7000 : className === 'warnung' ? 6000 : 4000,
    )
  }
}

// — Abspielen —
//
// Der Abspielkopf läuft, Musik und Klänge erklingen, an jedem Halt blendet die
// Aufnahme auf. Bewusst KEIN zweiter 3D-Player (dafür ist der Knopf „Vorschau"
// da): Hier prüft man den SCHNITT — kommt die Musik zum Strandabschnitt, reißt
// der Halt am Gipfel die Fahrt auseinander. Die Schrittlogik liegt in
// playback.ts, das erst beim ersten Play geladen wird.

let playback: Playback | null = null
/** Karte zentriert beim Abspielen auf den Läufer — Standard an, Toggle neben Play. */
let mapFollows = true
/** Welche Aufnahme gerade auf der Karte liegt — Wechsel baut die Karte neu. */
let shown: string | null = null
/**
 * Gemessenes Seitenverhältnis je Medium (geklemmt, s. `clampAspectRatio`).
 *
 * Der Rahmen der Foto-Karte entsteht bei jedem Auftritt neu; ohne dieses
 * Gedächtnis stünde er bis zum `load` des Bildes auf der Vorgabe 3:2 und
 * sprang beim Scrubben über einen Halt sichtbar in die Form.
 */
const aspectRatios = new Map<string, number>()

/**
 * Die Leinwand der Foto-Karte über der Editor-Bühne — derselbe Maler wie im
 * Player, nur mit dem Bühnen-Satz `editor` und ohne Bedienung: Diese Karte hat
 * keine Knöpfe, sie ist eine Vorschau.
 */
let cardLayer: CardLayer | null = null
/** Was der Maler über die liegende Aufnahme wissen muss (`showPhoto` füllt beides). */
let cardMedium: CardMedium = { kind: 'photo', ar: null }
let cardText: CardText = { title: '', kmText: '', counterText: '' }
/** Hat das liegende Video schon je einen Frame geliefert? (s. `cardSource`) */
let videoHadFrame = false
/** Wanduhr-Marke des letzten begonnenen Suchlaufs (`performance.now()`). */
let lastSeek = -Infinity

/** Schnappschuss für eine Wiedergabe — bei jedem Start neu eingesammelt. */
function getPlaybackPlan(): PlaybackPlan | null {
  if (!z?.cursor) return null
  const axis = currentAxis()
  const play = currentPlayCurve()
  if (!axis || !play) return null
  const start = z.data.time.start

  const entries = z.edits.audio ?? []
  const music: MusicClip[] = []
  const sounds: SoundCue[] = []
  // Dieselben Klips, die die Leiste zeigt — samt Einstieg und Loop. Ein zweiter
  // Weg zur Filmlage liefe hier auseinander, und die Schnittprüfung prüfte
  // einen anderen Film.
  for (const k of resolveAudioClips(entries, start, axis, audioDurations)) {
    const a = entries[k.index]
    // Was beim Rendern herausfällt (ganz außerhalb der Tour), soll auch hier
    // nicht klingen — sonst hörte man etwas, das im Film nicht vorkommt.
    if (!a || audioWouldBeDropped(a, z.edits, start, axis)) continue
    const url = audioUrl(a, z.tourId)
    const volume = a.volume ?? STUDIO_GAIN_DEFAULT
    const from = filmToFraction(axis, k.filmVon)
    // Ein Klip MIT Ausdehnung läuft als Bereich (auch ein Effekt — der Player
    // tut seit Etappe 4 dasselbe); einer ohne bleibt die Überfahr-Marke.
    if (k.filmBis > k.filmVon) {
      music.push({
        from,
        to: filmToFraction(axis, k.filmBis),
        url,
        volume,
        loop: k.loop,
        ...(k.startS > 0 ? { startS: k.startS } : {}),
      })
    } else {
      sounds.push({
        index: k.index,
        fraction: from,
        url,
        volume,
        ...(k.startS > 0 ? { startS: k.startS } : {}),
      })
    }
  }

  return {
    // Aus der Kopf-FILMsekunde, nicht aus der Aufnahmezeit: wer mitten in einem
    // Halt auf Play drückt, soll dort weiterlaufen und nicht an dessen Anfang
    // zurückspringen.
    playhead: filmToFraction(axis, playheadFilmS()),
    curve: play,
    music,
    sounds,
  }
}

/**
 * Marke aus dem Abspieler setzen (Anteil statt Offset) — die Sicht folgt.
 *
 * Derselbe Weg wie Scrubben und Pfeiltasten: der Anteil ist eine Stelle auf der
 * Leiste, also eine Filmsekunde. Früher war das ein Sonderpfad
 * (`renderPlayhead(anteilDirekt)`), weil nur der Abspieler durch Halte lief —
 * jetzt tun es alle vier Wege, und es gibt nur noch die eine Quelle.
 */
function setPlayheadFraction(fraction: number): void {
  if (!z) return
  const scale = currentAxis()
  if (!scale) return
  setPlayheadFilmS(fractionToFilm(scale, fraction))
  followPlayhead(fraction)
  // `followMap()` stand hier einmal eigens — jetzt zieht `renderPlayhead` die
  // Karte für JEDE Kopfbewegung nach, und der Abspieler ist nur eine davon.
}

// — Rand-Scroll: am Fensterrand geht es weiter —
//
// Eingezoomt reicht die Leiste über das Fenster hinaus. Wer den Kopf an den
// Rand zieht, ist dort am Ende der SICHT, nicht am Ende des Films: Der Kopf
// verschwand hinter der Kante und der Rest der Tour war beim Scrubben
// unerreichbar (erst loslassen, scrollen, wieder greifen). Jetzt scrollt die
// Sicht selbst weiter, solange der Zeiger in der Randzone steht.
//
// Zwei Dinge, die man leicht wegoptimiert: Es MUSS je Frame neu angewandt
// werden — der Inhalt wandert unter dem stehenden Zeiger, also meint dieselbe
// Zeigerstelle eine andere Filmsekunde. Und der Lauf endet, sobald `scrollLeft`
// sich nicht mehr ändert (Anfang/Ende erreicht): sonst drehte die rAF-Schleife
// am Anschlag weiter, ohne dass etwas geschieht.

/** Breite der Randzone und Tempo (px je Frame bei voller Auslenkung). */
const EDGE_ZONE_PX = 40
const EDGE_SPEED_MAX_PX = 24

function edgeScroller(apply: (clientX: number) => void): {
  move: (clientX: number) => void
  stop: () => void
} {
  let pointerX = 0
  let raf = 0
  const step = (): void => {
    raf = 0
    const viewport = document.getElementById('lanes-viewport')
    if (!viewport) return
    const r = viewport.getBoundingClientRect()
    // Links beginnt die Zeitachse erst hinter der klebenden Namenspalte.
    const links = r.left + laneXPx()
    let travel = 0
    if (pointerX < links + EDGE_ZONE_PX) travel = pointerX - (links + EDGE_ZONE_PX)
    else if (pointerX > r.right - EDGE_ZONE_PX) travel = pointerX - (r.right - EDGE_ZONE_PX)
    if (travel === 0) return
    const tempo = Math.max(-EDGE_SPEED_MAX_PX, Math.min(EDGE_SPEED_MAX_PX, travel * 0.4))
    const before = viewport.scrollLeft
    viewport.scrollLeft = before + tempo
    if (viewport.scrollLeft === before) return
    apply(pointerX)
    raf = requestAnimationFrame(step)
  }
  return {
    move: (clientX: number): void => {
      pointerX = clientX
      if (!raf) raf = requestAnimationFrame(step)
    },
    stop: (): void => {
      if (raf) cancelAnimationFrame(raf)
      raf = 0
    },
  }
}

/** Läuft der Kopf aus dem Fenster, scrollt die Sicht mit (wie in Final Cut). */
function followPlayhead(fraction: number): void {
  const viewport = document.getElementById('lanes-viewport')
  if (!viewport) return
  const margin = 48
  const x = laneXPx() + fraction * timeWidthPx() - viewport.scrollLeft
  if (x > viewport.clientWidth - margin) viewport.scrollLeft += x - (viewport.clientWidth - margin)
  else if (x < laneXPx() + margin) viewport.scrollLeft -= laneXPx() + margin - x
}

/** Karte weich auf die Marke ziehen — nicht jedes Frame hart setzen.
 *  Hartes `setCenter` pro Abspiel-Tick ließ Track und Marker zittern. */
let followTarget: [number, number] | null = null
/**
 * Die geglättete Kameraposition als EIGENER Zustand — nicht aus der Karte
 * zurückgelesen.
 *
 * `getCenter()` liefert, was `jumpTo` hineingeschrieben hat, durch zwei
 * Projektionen und eine Fließkomma-Rundung. Wer daraus die nächste Position
 * rechnet, führt eine Rückkopplung: Der Rundungsrest jedes Frames geht in den
 * nächsten ein, und weil er auch NEGATIV sein kann, wackelt die Kamera um
 * Bruchteile eines Pixels. Sichtbar wird das erst beim Herauszoomen — dort ist
 * die echte Bewegung pro Frame so klein, dass der Rest sie überstimmt, und
 * genau so wurde es gemeldet („Mikro-Zittern, vielleicht um einen Pixel").
 *
 * Dieselbe Regel wie in scripts/messungen/README.md, Falle 7: **gemessen wird
 * nie das Element, in das man schreibt.** `null` heißt „noch nichts geglättet"
 * — dann gilt einmalig die echte Kartenmitte (Start, Zoom, Nutzer-Schub).
 */
let followIs: [number, number] | null = null
/**
 * Führt die Karte gerade nach — oder ruht sie in der toten Zone?
 *
 * **Die Karte zentriert nicht dauernd, sie holt nur ein.** Das war der
 * eigentliche Befund hinter dem gemeldeten „Mikro-Zittern": Nicht die einzelne
 * Bewegung war unruhig, sondern dass ÜBERHAUPT in jedem Frame bewegt wurde —
 * die ganze Karte samt Kacheln, Track und Markern rastet dabei fortwährend neu
 * auf Pixel ein, und beim Herauszoomen bleibt von der echten Fahrt so wenig
 * übrig, dass nur noch das Einrasten zu sehen ist.
 *
 * Also dasselbe Muster wie in Navigations-Apps: Solange der Punkt in der
 * inneren Zone liegt, bleibt die Karte STEHEN. Verlässt er sie, wird
 * nachgeführt — und zwar bis er wieder mittig steht, nicht bloß bis zur
 * Zonenkante. Diese Hysterese ist Pflicht: Ohne sie löste jede Kante ein
 * Mikro-Nachführen aus und man hätte das Zittern zurück, nur seltener.
 */
let followActive = false
/** Anteil der Fensterbreite/-höhe, in dem die Karte ruht (zentriert). */
const DEAD_ZONE = 0.42
let followRaf = 0
/** Bis wann Follow pausiert (Nutzer zoomt) — sonst bricht `jumpTo` die Zoom-Animation ab. */
let followPauseTo = 0

function followMap(): void {
  if (!map || !z?.cursor || !mapFollows) return
  followTarget = [z.cursor[0], z.cursor[1]]
  if (!followRaf) followRaf = requestAnimationFrame(followMapTick)
}

/** Follow kurz aussetzen, damit Rad/Pinch/±-Knöpfe ungestört zoomen können. */
function pauseCardFollow(ms = 450): void {
  followPauseTo = performance.now() + ms
  // Der eigene Glättungs-Zustand ist nach einem fremden Eingriff überholt —
  // die Karte steht dann irgendwo anders. Beim nächsten Tick wird er einmal
  // aus der Karte neu gesetzt.
  followIs = null
}

function followMapTick(): void {
  followRaf = 0
  if (!map || !mapFollows || !followTarget) return
  // Während Nutzer-Zoom nicht eingreifen — `jumpTo` würde den Zoom sonst nach
  // wenigen Pixeln abwürgen (Around-Cursor-Animation wird abgebrochen).
  if (performance.now() < followPauseTo) {
    followRaf = requestAnimationFrame(followMapTick)
    return
  }
  // Die eigene geglättete Position, nicht die zurückgelesene Kartenmitte
  // (s. `followIs`). Beim ersten Frame und nach jedem Nutzer-Eingriff wird sie
  // einmal aus der Karte gesetzt — danach schreibt nur noch dieser Folger.
  if (!followIs) {
    const c0 = map.getCenter()
    followIs = [c0.lng, c0.lat]
  }
  const from = map.project(followIs)
  const after = map.project(followTarget)
  const dx = after.x - from.x
  const dy = after.y - from.y
  const dist2 = dx * dx + dy * dy

  const playing = (playback?.tempo() ?? 0) !== 0

  /**
   * Die RUHEZONE: Solange der Punkt mittig genug steht, bewegt sich nichts.
   *
   * Das ist die Antwort auf das gemeldete Zittern, und sie liegt nicht in der
   * Feinheit der Bewegung, sondern in ihrer HÄUFIGKEIT. Wer in jedem Frame
   * zentriert, lässt die ganze Karte in jedem Frame neu auf Pixel einrasten —
   * Kacheln, Track, Marker. Beim Herauszoomen bleibt von der echten Fahrt so
   * wenig übrig, dass nur noch dieses Einrasten zu sehen ist. Drei Versuche,
   * die einzelne Bewegung zu glätten, haben deshalb nichts gebracht: Das
   * Problem war, dass überhaupt bewegt wurde.
   *
   * Ausgelöst wird beim Verlassen der Zone, nachgeführt bis zur MITTE — die
   * Hysterese ist Pflicht. Ohne sie klebte der Punkt an der Zonenkante und
   * jedes Frame löste ein Mikro-Nachführen aus: dasselbe Zittern, nur weiter
   * außen.
   */
  const field = map.getContainer()
  const halfWidth = (field.clientWidth * DEAD_ZONE) / 2
  const halfHeight = (field.clientHeight * DEAD_ZONE) / 2
  const outside = Math.abs(dx) > halfWidth || Math.abs(dy) > halfHeight
  if (outside) followActive = true
  // Mittig angekommen (< 2 px): Nachführen beenden und ruhen lassen.
  else if (followActive && dist2 < 4) followActive = false

  if (!followActive) {
    if (playing) {
      // Im Lauf wach bleiben — der Punkt wandert weiter auf die Zonenkante zu.
      followRaf = requestAnimationFrame(followMapTick)
    } else {
      // Steht der Film, gibt es nichts zu erwarten: Kette beenden.
      followTarget = null
    }
    return
  }

  // Je weiter weg, desto beherzter; nah am Ziel weich (kein Überschwingen).
  const alpha = Math.min(0.28, 0.08 + Math.sqrt(dist2) / 500)
  const target = map.unproject([from.x + dx * alpha, from.y + dy * alpha])
  followIs = [target.lng, target.lat]
  map.jumpTo({ center: target })
  followRaf = requestAnimationFrame(followMapTick)
}

function stopsCardFollow(): void {
  followTarget = null
  followIs = null
  followActive = false
  followPauseTo = 0
  if (followRaf) {
    cancelAnimationFrame(followRaf)
    followRaf = 0
  }
  map?.stop()
}

/**
 * Element, dessen `data-ids`-Wortliste diese Medien-ID enthält. Bewusst nicht
 * per `[data-ids~="…"]`-Selektor: die IDs kommen aus einem hochgeladenen
 * Manifest, und ein Anführungszeichen darin würde den Selektor zerlegen.
 */
function withMediaId(selector: string, id: string): Element | null {
  for (const el of document.querySelectorAll<HTMLElement>(selector)) {
    if (el.dataset['ids']?.split(' ').includes(id)) return el
  }
  return null
}

/** Eine Klasse neu auslösen, auch wenn sie schon dran war. */
function blink(el: Element | null, className: string, ms: number): void {
  if (!el) return
  el.classList.remove(className)
  void el.getBoundingClientRect() // Reflow erzwingen, sonst startet die Animation nicht neu
  el.classList.add(className)
  window.setTimeout(() => el.classList.remove(className), ms)
}

/**
 * Die Aufnahme, die der Player an diesem Halt zeigt — als dieselbe Foto-Karte
 * auf Papier. Sie steht genau so lange, wie im Inspector als Standzeit gewählt.
 *
 * „Dieselbe" ist seit „Eine Bühne, ein Maler" wörtlich zu nehmen: Gemalt wird
 * sie von `src/card-painter.ts`, demselben Zeichner, der die Karte des Players
 * und die des Films macht. Hier entsteht nur noch, was der Maler nicht selbst
 * beschaffen kann — die ZEICHENQUELLE (ein `img` oder `video` im Dokument,
 * unsichtbar) und der TEXT.
 */
function showPhoto(id: string): void {
  if (!z) return
  const m = mediaDisplay().find((x) => x.id === id)
  if (!m) return
  shown = id
  blink(withMediaId('.stop-clip', id), 'pulse', 700)
  blink(withMediaId('.media-dot', id), 'pulse', 1400)

  const sources = $('photo-sources')
  // Das GEMESSENE Seitenverhältnis, mit derselben Klemme wie im Player. Gemerkt
  // wird es je Medium, weil `showPhoto` beim Scrubben oft läuft und der Rahmen
  // sonst bei jedem Auftritt kurz auf 3:2 stünde.
  cardMedium = {
    kind: m.type === 'video' ? 'video' : 'photo',
    ar: aspectRatios.get(m.id) ?? null,
    ...(m.display?.kenBurns === false ? { noKenBurns: true } : {}),
  }
  const rememberAspectRatio = (b: number, h: number): void => {
    const ar = clampAspectRatio(b, h)
    if (ar === null) return
    aspectRatios.set(m.id, ar)
    if (shown === m.id) cardMedium = { ...cardMedium, ar }
  }
  /**
   * Die Quelle ist da — noch einmal zeichnen.
   *
   * Der teuerste Unterschied zwischen einer Leinwand und dem DOM, das sie
   * ersetzt: Ein `img` in der Karte erschien von selbst, sobald es geladen war.
   * Eine Leinwand tut das nicht, und im Editor STEHT der Kopf meistens — wer in
   * einen Halt scrubbte, sah die Karte mit leerem Bildfeld und bekam das Foto
   * erst beim nächsten Kopfschritt. Im Player fiel es nie auf, weil dort der
   * Film läuft und jeder Frame ohnehin neu zeichnet.
   */
  const onSourceReady = (): void => {
    if (shown === m.id) syncPhoto()
  }
  if (m.type === 'video') {
    // Neues Element, neue Rechnung: Frame-Merker und Suchlauf-Marke gehören zu
    // DIESER Datei.
    videoHadFrame = false
    lastSeek = -Infinity
    const video = document.createElement('video')
    video.src = m.src
    // Der Ton der Aufnahme gehört zum Schnitt: Ohne ihn prüfte das Abspielen
    // einen Film, den es nicht gibt — die Musik stünde ungedämpft über einer
    // Szene, die im Player ihre eigene Stimme hat. Stumm startet es trotzdem
    // (volume 0): Die Ein-/Ausblendung setzt `syncImage` from dem ersten
    // Kopfschritt, dieselbe Hülle wie im Player (audiotracks.ts).
    video.muted = false
    video.volume = 0
    video.playsInline = true
    video.preload = 'auto'
    // Kein `autoplay`, kein `loop`: Was zu sehen ist, hängt an der Kopfposition
    // (`syncPhoto`) — ein Video, das nach eigener Uhr läuft, zeigte
    // beim Scrubben irgendeinen Frame und beim Stillstand den nächsten.
    // Die Datei ist der ungeschnittene Master; der Trim sind die Nullpunkte
    // des Ausschnitts (der Schnitt selbst entsteht erst in der Pipeline).
    // Das rechte Ende gehört dazu: Ohne es liefe die Wiedergabe über den
    // Schnitt hinaus und in der Ausblendung des Halts gegen das Dateiende.
    const cut = clampMediaTrim(m.trim, m.durationS ?? 0)
    video.dataset['fromS'] = String(cut?.fromS ?? 0)
    const endS = cut?.toS ?? m.durationS
    if (endS) video.dataset['toS'] = String(endS)
    video.addEventListener(
      'loadedmetadata',
      () => rememberAspectRatio(video.videoWidth, video.videoHeight),
      {
        once: true,
      },
    )
    // `loadedmetadata` liefert nur die Maße (readyState 1) — ein Frame steht erst
    // mit `loadeddata`, und nach jedem Seek erst mit `seeked`. Solange der Kopf
    // steht, ist das der einzige Anlass, das neue Einzelbild zu zeichnen.
    video.addEventListener('loadeddata', onSourceReady)
    video.addEventListener('seeked', onSourceReady)
    sources.replaceChildren(video)
  } else {
    const image = document.createElement('img')
    image.src = m.src
    image.alt = ''
    // Aus dem Browser-Cache ist `complete` schon beim Anlegen wahr — dann
    // feuert `load` nicht mehr.
    if (image.complete && image.naturalWidth)
      rememberAspectRatio(image.naturalWidth, image.naturalHeight)
    else
      image.addEventListener(
        'load',
        () => {
          rememberAspectRatio(image.naturalWidth, image.naturalHeight)
          onSourceReady()
        },
        { once: true },
      )
    sources.replaceChildren(image)
  }

  // Der TEXT der Karte: der Titel der Aufnahme, rechts daneben Uhrzeit und
  // Kilometerstand.
  //
  // Ohne Beschriftung bleibt der Titel LEER. Dort stand einmal „Foto" bzw.
  // „Video" — die Gattung als Überschrift, in 40er-Schrift, und damit genau
  // die Auskunft, die man dem Bild ansieht. Die Karte behält trotzdem ihre
  // Form: Die Zeile hat die Höhe des Titelgrades, die Angaben stehen rechts,
  // wo sie auch mit Titel stehen. Sonst spränge beim Blättern durch die Halte
  // ausgerechnet das, was bleibt.
  const meters = m.anchor
    ? metersToOffset(
        cumDistances,
        z.track,
        projectOntoTrack(z.track, m.anchor[0], m.anchor[1]).point[3],
      )
    : null
  cardText = {
    title: m.caption || '',
    // Uhrzeit UND Kilometerstand stehen rechts auf der Titelzeile. Ohne Titel
    // bleiben sie an derselben Stelle stehen. „4,1 km" und nicht „km 4,1" —
    // der Player schreibt die Einheit seit jeher hinter die Zahl.
    kmText: `${clockTimeShort(m.takenAt)} Uhr${meters !== null ? ` · ${kmText(meters)} km` : ''}`,
    counterText: '',
  }
  document.querySelector('.card-stage')?.classList.add('photo-on')
}

/**
 * Die Zeichenquelle dieser Filmsekunde — dieselbe Frage wie im Player
 * (`_kartenQuelle` in ui.ts), nur ohne Video-Standbild: Der Editor liefert den
 * ungeschnittenen Master aus, ein Poster gibt es dazu nicht.
 *
 * `bereit` ist die Zusicherung, die der Maler braucht: `drawImage` auf einem
 * noch suchenden `<video>` zeichnet ohne Fehler das ALTE Bild. Der Maler
 * zeichnet es trotzdem — ein Bild von vorhin ist die bessere Auskunft als das
 * schwarze Bildfeld; die Zusicherung ist für den Video-Export da.
 *
 * Sobald das Video einmal einen Frame geliefert hat, bleibt es die Quelle:
 * `readyState` fällt bei jedem Suchlauf wieder unter `VIDEO_HAT_FRAME` zurück,
 * und ohne diesen Merker wechselte die Karte dort auf ein leeres Bildfeld.
 */
function cardSource(): { source: CardSource | null; ready: boolean } {
  const sources = document.getElementById('photo-sources')
  const video = sources?.querySelector('video')
  if (video) {
    const hasFrame = video.readyState >= VIDEO_HAS_FRAME
    if (hasFrame) videoHadFrame = true
    if (video.videoWidth > 0 && (hasFrame || videoHadFrame)) {
      return {
        source: {
          image: video,
          width: video.videoWidth,
          height: video.videoHeight,
          key: video.src,
        },
        ready: hasFrame && !video.seeking,
      }
    }
    return { source: null, ready: false }
  }
  const image = sources?.querySelector('img')
  if (image && image.complete && image.naturalWidth > 0) {
    return {
      source: {
        image: image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        key: image.src,
      },
      ready: true,
    }
  }
  return { source: null, ready: false }
}

/**
 * Die Foto-Einblendung ist eine FUNKTION der Kopfposition — keine Uhr.
 *
 * Steht der Kopf in einem Klip, liegt dessen Bild auf der Karte; verlässt er
 * ihn, verschwindet es. Damit stimmen Abspielen und Scrubben zwangsläufig
 * überein und die Karte steht exakt so lange wie ihr Klip auf der Leiste
 * (Standzeit UND Ausblendung — `stopAtFilmS` rechnet mit derselben Kette, aus
 * der die Klips entstehen). Vorher stieß der Abspieler die Einblendung als
 * Überfahr-Marke an und ein Timer nahm sie über die reine Standzeit zurück:
 * beim Scrubben kam gar kein Bild, beim Abspielen ging es 0,8 s zu früh.
 *
 * Im Schnelllauf (J/L) bleibt die Karte aus: dort will man die Strecke
 * überfliegen, nicht an jedem Halt ein Bild aufblitzen sehen.
 */
function syncPhoto(): void {
  const axis = currentAxis()
  const tempo = playback?.tempo() ?? 0
  const atStop = axis && Math.abs(tempo) <= 1 ? stopAtFilmS(axis, playheadFilmS()) : null
  const piece = atStop?.item ?? null
  // Solange eine Karte liegt, tritt der Niederschlag zurück — sonst regnet es
  // scharf über einem Foto, das die volle Aufmerksamkeit haben soll. Im Player
  // erledigt das der `.photo-backdrop` mit Schleier und Weichzeichner.
  mood?.setPhoto(!!piece)
  if (!piece) {
    if (shown) hidePhoto()
    return
  }
  if (piece.id !== shown) showPhoto(piece.id)
  syncImage(piece.inS, piece.durationS, tempo)
}

/**
 * Bild und Video stehen an der Stelle, an der der KOPF steht — nicht an der,
 * die eine eigene Uhr seit dem Erscheinen erreicht hat.
 *
 * Der Ken-Burns-Zug lief einmal als gewöhnliche CSS-Animation ab dem Einfügen
 * des `img`: Wer in die Mitte eines Halts scrubbte, sah den Zoom trotzdem bei 0
 * beginnen und weiterlaufen, obwohl der Kopf stand. Der Ausweg waren dauerhaft
 * pausierte Animationen mit negativem Delay — der Behelf für genau das, was ein
 * MALER von Natur aus tut. Seit „Eine Bühne, ein Maler" bekommt er die
 * Filmsekunde als Zahl und zeichnet den Stand dazu; Auftritt, „Entwickeln",
 * Ken-Burns-Zug, Balken und Abgang kommen alle von dort.
 *
 * Was hier bleibt, ist das, was der Maler nicht kann: Der Video-Frame muss
 * GESUCHT werden, und der Ton der Aufnahme hat eine Hülle. Beide Rechnungen
 * teilt der Editor mit dem Player, verschieden ist nur, was ankommt — dort die
 * geschnittene Fassung, hier der ungeschnittene Master mit beiden Kanten.
 */
function syncImage(imS: number, durationS: number, tempo: number): void {
  const { source, ready } = cardSource()
  cardLayer?.paint({
    inS: imS,
    durationS: durationS,
    medium: cardMedium,
    text: cardText,
    source: source,
    ready: ready,
  })

  const video = document.getElementById('photo-sources')?.querySelector('video')
  if (!video) return
  const fromS = Number(video.dataset['fromS'] ?? 0)
  // Das Ende kommt aus dem Schnitt bzw. der Server-Länge — und zusätzlich aus
  // der Datei selbst, sobald sie ihre Dauer kennt: Fehlt `durationS` (Altbestand),
  // ist der Klip die Foto-Standzeit lang und damit meist länger als das Video.
  const fileEndS = video.duration > 0 && Number.isFinite(video.duration) ? video.duration : Infinity
  const endS = Math.min(Number(video.dataset['toS'] ?? 0) || Infinity, fileEndS)
  const { targetS, atEnd } = videoPositionS(fromS, endS, imS)
  const running = tempo === 1 && !atEnd
  // Wann gesucht werden DARF, entscheidet die geteilte Nachführung
  // (`videoSeekDecision` in card-timing.ts) — dieselbe Rechnung wie im Player.
  // Ohne ihre Rückfragen (laufender Suchlauf, Pufferstand, Wanduhr-Ruhe) wurde
  // in jedem Frame neu gesucht und keiner der Suchläufe kam je an.
  const after = videoSeekDecision({
    targetS,
    isS: video.currentTime,
    playing: running,
    paused: video.paused,
    seeking: video.seeking,
    readyState: video.readyState,
    sinceSeekS: (performance.now() - lastSeek) / 1000,
  })
  if (after.seek) setVideoTime(video, targetS)
  if (after.play) {
    void video.play().catch(() => {
      // Unmuted-Autoplay ohne frische Geste wird geblockt (wie im Player,
      // src/ui.ts): stumm erzwingen, damit das Bild überhaupt läuft — sonst
      // stünde am Video-Halt ein Standbild und der Schnitt wäre nicht zu prüfen.
      video.muted = true
      void video.play().catch(() => {})
    })
  }
  if (after.pause) video.pause()

  // Ton-Hülle über den AUSSCHNITT (nicht die Datei): Ein- und Ausblende liegen
  // an den Schnittkanten. Die Rechnung teilt sich der Editor mit dem Player
  // (`trimmedDurationS`) — verschieden ist nur, was ankommt: dort die
  // geschnittene Fassung ohne linke Kante, hier der ungeschnittene Master.
  // Im Schnelllauf/rückwärts steht das Video und schweigt, also Hülle 0.
  const viewportS = trimmedDurationS(video.duration, fromS, endS)
  const shell = running && !video.muted ? videoVolumeEnvelope(imS, viewportS) : 0
  const loud = videoVolume(shell)
  // Nur bei Bedarf setzen — die Funktion läuft in jedem Kopf-Frame, und manche
  // Browser feuern `volumechange` sonst im Kreis.
  if (Math.abs(video.volume - loud) > 0.004) video.volume = loud
  playback?.setDucking(shell)
}

function setVideoTime(video: HTMLVideoElement, second: number): void {
  // Die Marke wird VOR dem Sprung gesetzt: Gemessen wird die Ruhe seit dem
  // Anstoß, nicht seit dem Eintreffen — und ein fehlgeschlagener Sprung zählt
  // mit, sonst versuchte es der nächste Kopfschritt sofort wieder.
  lastSeek = performance.now()
  try {
    video.currentTime = Math.max(0, second)
  } catch {
    /* Seek vor dem Puffern kann fehlschlagen — der nächste Kopfschritt holt es nach */
  }
}

function hidePhoto(): void {
  shown = null
  cardLayer?.clear()
  document.querySelector('.card-stage')?.classList.remove('photo-on')
  const sources = document.getElementById('photo-sources')
  // Ein laufendes Video würde sonst unsichtbar weiterspielen
  sources?.querySelector('video')?.pause()
  sources?.replaceChildren()
  // Und seine Dämpfung mitnehmen: Ohne das bliebe die Musik nach dem letzten
  // Video-Halt für den Rest der Wiedergabe leise.
  playback?.setDucking(0)
}

function showTempo(tempo: number): void {
  // Hier läuft JEDE Tempoänderung durch — Play, Pause, J/K/L und jedes
  // `stopsPlay` einer manuellen Geste. Deshalb hängt die Kartenstimmung
  // hier: Regen und Klang gibt es nur bei Tempo 1, sonst friert das Overlay
  // ein und der Schleier trägt die Auskunft allein.
  mood?.setRunning(tempo)
  const button = document.getElementById('console-play')
  if (!button) return
  button.querySelector('use')?.setAttribute('href', tempo !== 0 ? '#i-pause' : '#i-play')
  button.classList.toggle('playing', tempo !== 0)
  button.setAttribute('aria-label', tempo !== 0 ? 'Pause' : 'Abspielen')
  const chip = document.getElementById('tempo-chip')
  // Beim Schnelllauf Faktor und Richtung zeigen; bei Stopp und 1× nichts.
  if (chip)
    chip.textContent = tempo === 0 || tempo === 1 ? '' : tempo < 0 ? `${-tempo}×◀` : `${tempo}×▶`
  if (tempo === 0) {
    stopsCardFollow()
    // Ausgeblendet wird hier NICHTS: steht der Kopf beim Anhalten in einem
    // Klip, gehört das Bild dorthin — es hängt an seiner Position, nicht an
    // der Wiedergabe. Beim nächsten Kopfschritt entscheidet `syncPhoto`.
    syncPhoto()
  }
}

async function playToggle(): Promise<void> {
  if (!z) return
  if (!playback) {
    const modul = await import('./playback.js')
    playback = modul.createPlayback({
      get: getPlaybackPlan,
      setPlayhead: setPlayheadFraction,
      showTempo,
      pulseSound: (index) =>
        blink(document.querySelector(`.timeline-sfx[data-index="${index}"]`), 'ping', 500),
    })
  }
  playback.toggle()
}

/** Jede manuelle Geste hält an — man scrubbt nicht gegen einen laufenden Kopf. */
function stopsPlay(): void {
  playback?.pause()
}

/**
 * Für SCRUB-Gesten: anhalten und beim Loslassen dort weiterspielen.
 *
 * Der Unterschied zu `stopsPlay` ist die Absicht der Geste. Wer eine
 * Grenze zieht oder einen Klip verschiebt, ändert die Achse, gegen die der
 * Spielplan läuft — da ist Anhalten richtig und Weiterlaufen wäre ein Lauf
 * gegen veraltete Halte. Wer dagegen am Kopf oder am Maßband zieht, ändert nur
 * die STELLE: Er sucht sich einen Punkt und will von dort aus weitersehen. Ihn
 * dafür jedes Mal neu starten zu lassen, ist die Sorte Reibung, die man beim
 * Schneiden hundertmal am Tag hat.
 *
 * Genau so verhält sich der Player: `seek` behält den Wiedergabezustand.
 * Der Schnelllauf wird mitgenommen — wer bei 4× sucht, sucht bei 4× weiter.
 */
function scrubGesture(): () => void {
  const before = playback?.tempo() ?? 0
  stopsPlay()
  return () => {
    if (before === 0) return
    void playToggle().then(() => {
      if (before !== 1) playback?.setTempo(before)
    })
  }
}

// — Speichern / Neu verarbeiten —

/**
 * Beschriftung des Speichern-Knopfs, BEVOR die Löschfrage sie ersetzt hat.
 * Modul-Ebene und nicht lokal, weil Schärfen und Speichern zwei getrennte
 * Klicks sind — der zweite fände im Knopf nur noch die Frage vor.
 */
let saveLabel: string | null = null

/** Knopf entschärfen und beschriften, wie er vor der Frage aussah. */
function disarmSave(button: HTMLButtonElement): void {
  if (!button.dataset['loeschScharf']) return
  delete button.dataset['loeschScharf']
  if (saveLabel !== null) button.innerHTML = saveLabel
  saveLabel = null
}

async function waitForReady(id: string): Promise<void> {
  for (let i = 0; i < 90; i++) {
    const t = await api.tour(id)
    if (t.schema === 'maptale/tour@2' || t.status === 'ready') return
    if (t.status === 'failed')
      throw new Error(`Verarbeitung fehlgeschlagen: ${t.error ?? 'unbekannt'}`)
    await new Promise((done) => setTimeout(done, 900))
  }
  throw new Error('Verarbeitung dauert ungewöhnlich lange. Liste später prüfen.')
}

/**
 * Zweistufiges endgültiges Löschen: erst ansagen, dann wegräumen.
 *
 * Während der Bearbeitung ist „Entfernen" nur ein Overlay-Flag — deshalb
 * funktioniert Undo. Beim Speichern wird daraus ein echtes Löschen: Rohdatei
 * und Fassungen sind danach weg, der Speicher ist frei. Das ist die einzige
 * Stelle im Editor, an der etwas UNWIEDERBRINGLICH verschwindet, also fragt
 * sie einmal nach — in der Sprache des Studios (Knopf schärfen, kein
 * confirm()-Kasten), und mit der Zahl im Knopf statt eines vagen „Sicher?".
 *
 * `true` = der Aufrufer soll abbrechen und den zweiten Klick abwarten.
 */
function asksForDeletion(button: HTMLButtonElement, count: number): boolean {
  if (!count || button.dataset['loeschScharf']) return false
  button.dataset['loeschScharf'] = '1'
  // Die Beschriftung wird HIER gesichert und nirgends sonst gelesen: Beim
  // zweiten Klick steht im Knopf längst die Löschfrage, ein erneutes
  // `innerHTML` schriebe sie als „Originalzustand" fest.
  saveLabel = button.innerHTML
  button.textContent =
    count === 1 ? '1 Aufnahme endgültig löschen?' : `${count} Aufnahmen endgültig löschen?`
  status(
    count === 1
      ? 'Beim Speichern wird die entfernte Aufnahme endgültig gelöscht — Datei und Speicherplatz sind danach weg. Nochmal klicken, um zu speichern.'
      : `Beim Speichern werden ${count} entfernte Aufnahmen endgültig gelöscht — Dateien und Speicherplatz sind danach weg. Nochmal klicken, um zu speichern.`,
    'warnung',
  )
  setTimeout(() => {
    if (button.isConnected) disarmSave(button)
  }, 6000)
  return true
}

async function save(): Promise<void> {
  if (!z) return
  const problem = validateOverlay(z.edits)
  if (problem) {
    status(problem, 'fehler')
    return
  }
  const saveButton = $('editor-save') as HTMLButtonElement
  // Nur was der SERVER kennt, kann er löschen: in dieser Sitzung nachgereichte,
  // aber noch nicht gespeicherte Medien gibt es dort noch gar nicht.
  const known = new Set(z.data.media.map((m) => m.id))
  const toDelete = idsToDelete(z.edits).filter((id) => known.has(id))
  if (asksForDeletion(saveButton, toDelete.length)) return
  // Beim zweiten Klick trägt der Knopf die Löschfrage — die echte Beschriftung
  // liegt seit dem Schärfen im Merker. Nur wer gar nicht gefragt wurde (nichts
  // zu löschen), liest sie hier frisch aus dem DOM.
  const label = saveLabel ?? saveButton.innerHTML
  saveLabel = null
  delete saveButton.dataset['loeschScharf']
  saveButton.disabled = true
  try {
    // 0. Endgültig löschen — VOR dem Overlay, denn der Server räumt dabei seine
    //    eigene Overlay-Fassung mit auf (medien-Eintrag, titelbild) und rendert
    //    neu. Ein danach geschriebenes Overlay mit denselben Einträgen würde
    //    toten Zustand zurückschreiben. Nacheinander, weil jedes Löschen einen
    //    Render anstößt und der nächste Aufruf sonst auf „verarbeitung" träfe.
    if (toDelete.length) {
      for (const [i, id] of toDelete.entries()) {
        status(
          toDelete.length === 1
            ? 'Aufnahme wird endgültig gelöscht …'
            : `Aufnahme ${i + 1} von ${toDelete.length} wird endgültig gelöscht …`,
        )
        await api.deleteMedium(z.tourId, id)
        await waitForReady(z.tourId)
      }
      // Lokal dasselbe tilgen wie der Server — und `saved` mitziehen:
      // Der Server-Stand IST jetzt das gestutzte Overlay, ohne diese Zeile
      // liefe gleich ein Speichern für eine Änderung, die keine mehr ist.
      z.edits = withoutMedia(z.edits, toDelete)
      z.saved = JSON.stringify(withoutMedia(JSON.parse(z.saved) as EditOverlay, toDelete))
    }
    // 1. Overlay (falls geändert) — der Server rendert die Tour neu
    if (JSON.stringify(z.edits) !== z.saved) {
      status('Bearbeitungen werden gespeichert …')
      const response = await api.saveEdits(z.tourId, z.edits)
      if (response.status === 'processing') await waitForReady(z.tourId)
    }
    // 2. Titel/Beschreibung/Finale (falls geändert) — eigener Endpunkt, eigener Re-Render;
    //    bewusst NACH dem Overlay, damit sich die Renderer nie überlappen
    const title = ($('editor-title') as HTMLInputElement).value.trim()
    const description = ($('editor-description') as HTMLTextAreaElement).value.trim()
    const kicker = ($('editor-kicker') as HTMLInputElement).value.trim()
    const finale = ($('editor-finale') as HTMLInputElement).checked
    const finaleTarget = ($('editor-finale-target') as HTMLInputElement).value.trim()
    const fields: {
      title?: string
      description?: string
      kicker?: string
      finale?: boolean
      finaleTarget?: string
    } = {}
    if (title && title !== (z.data.title ?? '')) fields.title = title
    if (description !== (z.data.description ?? '')) fields.description = description
    if (kicker !== (z.data.kicker ?? '')) fields.kicker = kicker
    if (finale !== !!z.data.finale) fields.finale = finale
    if (finaleTarget !== (z.data.finaleTarget ?? '')) fields.finaleTarget = finaleTarget
    if (Object.keys(fields).length) {
      status('Tour-Einstellungen werden gespeichert …')
      await api.patchTour(z.tourId, fields)
      // Nur warten, wenn PATCH wirklich einen Re-Render gestartet hat — auf
      // einer fehler-Tour würde warteAufBereit sonst den ALTEN Pipeline-
      // Fehler als Speicher-Fehler melden (Review-Fund).
      const loaded = await api.tour(z.tourId)
      if (loaded.status === 'processing') await waitForReady(z.tourId)
    }
    await loadData(z.tourId)
    status(
      toDelete.length
        ? toDelete.length === 1
          ? 'Gespeichert. 1 Aufnahme wurde endgültig gelöscht.'
          : `Gespeichert. ${toDelete.length} Aufnahmen wurden endgültig gelöscht.`
        : 'Gespeichert.',
      'ok',
    )
  } catch (error) {
    status((error as Error).message, 'fehler')
  } finally {
    saveButton.disabled = false
    saveButton.innerHTML = label
  }
}

// — Tour-Einstellungen —
//
// Titel, Beschreibung und Endscreen gehören keinem Objekt der Zeitleiste. Sie
// standen deshalb früher im LEERZUSTAND des Inspectors — dort, wo nichts
// ausgewählt ist, las sich das wie eine Einstellung des Nichts. Jetzt liegen
// sie als eigene Ansicht im rechten Panel, erreichbar über den Titel im Kopf
// und über das „…"-Menü.

/** Den (ggf. geänderten) Titel oben in der Leiste zeigen. */
function showTitleInHeader(): void {
  const title = ($('editor-title') as HTMLInputElement).value.trim()
  $('editor-title-button').textContent = title
}

/** Tour-Einstellungen im Inspector öffnen (nicht Modal). */
function openTourSettings(): void {
  if (!z) return
  stopsPlay()
  z.selection = null
  z.tourSettings = true
  renderAll()
  ;($('editor-title') as HTMLInputElement).focus()
}

function syncFinaleTargetField(): void {
  const on = ($('editor-finale') as HTMLInputElement).checked
  ;($('editor-finale-target-field') as HTMLElement).hidden = !on
}

async function reprocess(): Promise<void> {
  if (!z) return
  const button = $('editor-reprocess') as HTMLButtonElement
  button.disabled = true
  try {
    status('Tour wird neu verarbeitet (Benennung/Wetter) …')
    await api.reprocess(z.tourId)
    await waitForReady(z.tourId)
    await loadData(z.tourId)
    status('Neu verarbeitet. Bearbeitungen sind erhalten.', 'ok')
  } catch (error) {
    status((error as Error).message, 'fehler')
  } finally {
    button.disabled = false
  }
}

// — Inspector-Breite ziehen —
//
// Kein Einklappen (Mockup hat einen Tab dafür; hier reicht die Breite). Eng
// begrenzt: schmal genug für die Karte, breit genug für die Felder — bewusst
// schmaler als im Mockup.

const INSP_WIDTH_MIN = 280
const INSP_WIDTH_MAX = 460

function wireInspectorWidth(): void {
  const grip = document.getElementById('inspector-grip')
  const body = document.getElementById('editor-body')
  if (!grip || !body) return
  grip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    e.preventDefault()
    grip.classList.add('dragging')
    body.classList.add('dragging-width')
    const onDrag = (ev: PointerEvent): void => {
      const b = body.getBoundingClientRect()
      const width = Math.min(Math.max(b.right - ev.clientX, INSP_WIDTH_MIN), INSP_WIDTH_MAX)
      document.documentElement.style.setProperty('--inspector-width', `${width}px`)
      fitTimeWidth()
      map?.resize()
    }
    const release = (): void => {
      window.removeEventListener('pointermove', onDrag)
      window.removeEventListener('pointerup', release)
      grip.classList.remove('dragging')
      body.classList.remove('dragging-width')
    }
    window.addEventListener('pointermove', onDrag)
    window.addEventListener('pointerup', release)
  })
}

// — Einmalige Verdrahtung der statischen Editor-Elemente —

function wireOnce(): void {
  if (wired) return
  wired = true
  $('editor-back').addEventListener('click', close)
  $('editor-save').addEventListener('click', () => void save())
  $('editor-film').addEventListener('click', () => {
    if (!z) return
    const photo = z.data.media.find((m) => m.type === 'photo') ?? z.data.media[0]
    // Der Editor kennt die Filmlänge selbst — und zwar die AKTUELLE, samt
    // ungespeicherter Schnitte; `stats.filmS` vom Server ist die des letzten
    // Renders. Die Signatur hat er dagegen nicht (sie entsteht beim Anreichern).
    openExportSheet({
      id: z.tourId,
      title: z.data.title,
      cover: photo?.thumb ?? photo?.poster ?? photo?.src ?? null,
      filmS: currentAxis()?.curve?.totalS ?? null,
      finale: z.data.finale,
    })
  })
  $('editor-title-button').addEventListener('click', openTourSettings)
  // Was die ganze TOUR betrifft, steht im Kopf und nicht in einem „…"-Menü:
  // Zwei Einträge hinter einem Knopf, der nicht sagt, was er verbirgt, sind
  // zwei Klicks für etwas, das man auch zeigen kann.
  $('editor-settings').addEventListener('click', openTourSettings)
  $('editor-reprocess').addEventListener('click', () => void reprocess())
  // Der Kopf zeigt den Titel — er muss dem Feld folgen, sonst steht dort der
  // alte Name, bis die Tour neu geladen wird.
  $('editor-title').addEventListener('input', showTitleInHeader)
  $('editor-description').addEventListener('input', countDescription)
  $('editor-kicker').addEventListener('input', markBasemapPicker)
  // Die Erklärungen der Tour-Einstellungen hängen an ihren Griffen (data-tooltip).
  wireTooltips(document)
  $('editor-finale').addEventListener('change', syncFinaleTargetField)
  $('editor-undo').addEventListener('click', undo)
  $('editor-redo').addEventListener('click', redo)
  wireAddMedia()
  $('map-zoom-in').addEventListener('click', () => {
    pauseCardFollow()
    map?.zoomIn()
  })
  $('map-zoom-out').addEventListener('click', () => {
    pauseCardFollow()
    map?.zoomOut()
  })
  wireMood()
  $('console-play').addEventListener('click', () => void playToggle())
  // Sprung an Anfang und Ende. `setPlayheadFilmS` klemmt selbst auf
  // [0, gesamtS] — deshalb genügt Infinity für „ans Ende".
  $('console-start').addEventListener('click', () => {
    stopsPlay()
    setPlayheadFilmS(0)
  })
  $('console-end').addEventListener('click', () => {
    stopsPlay()
    setPlayheadFilmS(Infinity)
  })
  $('console-follow').addEventListener('click', () => {
    mapFollows = !mapFollows
    const button = $('console-follow')
    button.classList.toggle('on', mapFollows)
    button.setAttribute('aria-pressed', String(mapFollows))
    if (mapFollows) followMap()
    else stopsCardFollow()
  })
  // Anfassen der Karte beendet die Wiedergabe (die Bahnen erledigt renderAlles
  // bzw. der Kopf-Zug selbst).
  $('editor-map').addEventListener('pointerdown', stopsPlay)
  // Eine neue Zeigergeste hebt die Klick-Sperre auf (Capture-Phase, vor allen
  // anderen Handlern) — s. Kommentar bei `suppressClick`.
  document.addEventListener(
    'pointerdown',
    () => {
      suppressClick = false
    },
    true,
  )
  window.addEventListener('resize', () => {
    if (!$('editor-view').hidden) fitTimeWidth()
  })
  wireInspectorWidth()
  // Im Hintergrund drosselt der Browser rAF auf ~1 fps — der Kopf stünde, der
  // Ton liefe weiter. Also anhalten, wenn der Tab verschwindet.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopsPlay()
  })
  document.addEventListener('keydown', (e) => {
    if (!z || $('editor-view').hidden) return
    // Großansicht fängt Esc und Pfeile ab — sonst würde die Tour scrubben
    // oder der Platzieren-Modus enden, während man noch blättert.
    const large = document.querySelector('.lightbox')
    if (large) {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeLarge()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        large.querySelector<HTMLButtonElement>('.links')?.click()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        large.querySelector<HTMLButtonElement>('.right')?.click()
      }
      return
    }
    // In Eingabefeldern gilt das native Undo/Speichern des Browsers
    if ((e.target as HTMLElement).closest('input, textarea, select')) return
    // Steht ein Fenster offen (Bibliothek, Angaben), gehört die Tastatur ihm —
    // sonst spielte die Leertaste die Tour ab, während man Musik aussucht.
    if (document.querySelector('dialog[open]')) return
    const meta = e.metaKey || e.ctrlKey
    if (meta && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      if (e.shiftKey) redo()
      else undo()
    } else if (meta && e.key.toLowerCase() === 's') {
      e.preventDefault()
      void save()
    } else if (meta && (e.key === '+' || e.key === '=' || e.key === '-')) {
      e.preventDefault()
      ;(e.key === '-' ? $('zoom-out') : $('zoom-in')).click()
    } else if (e.shiftKey && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      fit() // ⇧Z = an Fenster anpassen (wie in Final Cut)
    } else if (e.key === 'Escape' && z.place) {
      z.place = null
      renderAll()
    } else if ((e.key === 'Backspace' || e.key === 'Delete') && z.selection) {
      // Löscht dasselbe wie der Knopf im Inspector-Fuß
      e.preventDefault()
      deleteSelection()
    } else if (!meta && !e.altKey && !e.shiftKey) {
      const k = e.key.toLowerCase()
      if (k === 'a' || k === 'h' || k === 'z') {
        e.preventDefault()
        setTool(k === 'a' ? 'select' : k === 'h' ? 'hand' : 'zoom')
      } else if (e.code === 'Space') {
        e.preventDefault()
        void playToggle()
      } else if (k === 'l' || k === 'j' || k === 'k') {
        // Shuttle wie in Final Cut: L vorwärts, J zurück (mehrfach = schneller),
        // K hält an. Der Abspieler existiert erst nach dem ersten Play.
        // Der Deckel liegt bei 8× — dieselbe Stufe wie im Player (E16), damit
        // ein Tempo, das man hier lernt, dort auch existiert.
        e.preventDefault()
        const t = playback?.tempo() ?? 0
        if (k === 'k') stopsPlay()
        else if (!playback) void playToggle()
        else
          playback.setTempo(
            k === 'l' ? (t < 1 ? 1 : Math.min(t * 2, 8)) : t > -1 ? -1 : Math.max(t * 2, -8),
          )
      } else if (e.key === 'Home' || e.key === 'End') {
        // Den ganzen Film überspringen. Es gab dafür bisher nichts — bei
        // starkem Zoom war der Weg an den Anfang ein Zug über die halbe
        // Leiste. `setPlayheadFilmS` klemmt selbst, „ans Ende" ist Infinity.
        e.preventDefault()
        stopsPlay()
        setPlayheadFilmS(e.key === 'Home' ? 0 : Infinity)
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        // Feines Scrubben mit den Pfeiltasten: fünf FILM-Sekunden je Druck
        // (≈ eine Foto-Haltebreite) — eine Minute Aufnahmezeit war auf der
        // Filmzeit-Achse mal ein Pixel, mal die halbe Leiste. Landet der
        // Schritt in einem Halt-Sprung, steht der Kopf auf dem Halt.
        e.preventDefault()
        stopsPlay()
        const axis = currentAxis()
        if (axis?.curve) {
          setPlayheadFilmS(stepFilmS(axis, playheadFilmS(), e.key === 'ArrowRight' ? 5 : -5))
        } else if (z.cursor) {
          setPlayhead(z.cursor[3] + (e.key === 'ArrowRight' ? 60 : -60))
        }
      }
    }
  })
  // ⌥ zeigt beim Zoom-Werkzeug „herauszoomen" an
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Alt' && tool === 'zoom')
      document.getElementById('lanes-viewport')?.classList.add('old')
  })
  window.addEventListener('keyup', (e) => {
    if (e.key === 'Alt') document.getElementById('lanes-viewport')?.classList.remove('old')
  })
  // Ereignisse legt das „+"
  // der jeweiligen Bahn an. Die frühere Knopfleiste in der Sidebar ist weg.
  $('sfx-close').addEventListener('click', closeSfxDialog)
  $('sfx-search').addEventListener('input', (e) => {
    sfxSearch = (e.target as HTMLInputElement).value
    updateSfxTabs()
    buildSfxList()
  })
  $('sfx-dialog').addEventListener('close', () => {
    stopDialogPreview()
    // Auch bei ESC (natives close ohne schliesseSfxDialog): der nächste
    // Aufruf aus dem Spur-Menü darf nicht im Ersetzen-Modus hängen bleiben.
    sfxTarget = { travelMode: 'einsetzen' }
  })
  // Klick aufs Backdrop (Ziel ist dann das dialog-Element selbst) schließt
  $('sfx-dialog').addEventListener('click', (e) => {
    if (e.target === $('sfx-dialog')) closeSfxDialog()
  })
  $('editor-audio-file').addEventListener('change', () => {
    const input = $('editor-audio-file') as HTMLInputElement
    const file = input.files?.[0]
    if (file) void libraryUpload(file)
    input.value = ''
  })
  wireTimeline()
}

// Debug-Handle (Konvention wie window.__j im Player) — auch fürs Browser-E2E:
// Karte und Zustand inspizieren, Track-Koordinaten in Pixel projizieren.
;(window as unknown as Record<string, unknown>)['__studio'] = {
  map: () => map,
  state: () => z,
  /** Abspielkopf: Zeit-Offset (s) — setzen scrubbt wie ein Zug am Kopf. */
  playhead: (tOffsetS?: number) => {
    if (tOffsetS !== undefined) {
      stopsPlay()
      setPlayhead(tOffsetS)
    }
    return z?.cursor?.[3] ?? null
  },
  /** Abspielkopf in FILMsekunden — die führende Größe (fürs Browser-E2E). */
  playheadFilmS: (filmS?: number) => {
    if (filmS !== undefined) {
      stopsPlay()
      setPlayheadFilmS(filmS)
    }
    return playheadFilmS()
  },
  /** Wiedergabe: Tempo (0 = angehalten); mit Argument umschalten/setzen. */
  rate: (tempo?: number) => {
    if (tempo === 1) void playToggle()
    else if (tempo !== undefined) playback?.setTempo(tempo)
    return playback?.tempo() ?? 0
  },
  audio: () => playback?.audioState() ?? null,
  /** Laufendes Panel-Vorhören (Datei, Lautstärke) — fürs Browser-E2E. */
  preview: () =>
    preview
      ? { file: preview.file, volume: preview.audio.volume, paused: preview.audio.paused }
      : null,
  runner: () => runner?.getLngLat() ?? null,
  /** Zoom als Vielfaches des eingepassten Maßstabs (1 = ganze Tour im Fenster). */
  zoom: (next?: number) => {
    if (next !== undefined) setScale(passScale() * next, 0, laneXPx())
    return zoomFactor()
  },
  /** Maßstab in px je Filmsekunde — die gespeicherte Zoomgröße. */
  scale: () => pxPerFilmS,
  /** Die Filmzeit-Achse samt Halt-Intervallen (fürs Browser-E2E). */
  axis: () => currentAxis(),
  tool: (w?: 'select' | 'hand' | 'zoom') => {
    if (w) setTool(w)
    return tool
  },
}
