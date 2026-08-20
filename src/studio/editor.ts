// Studio-Editor (M7 + Kreativbaukasten): Karten-Editor über den Editor-Daten
// des Backends — Medien platzieren/verschieben/löschen, Captions, Modus- und
// Kamera-Grenzen, Musik/SFX mit Streckenbereich,
// Foto-Anzeigeoptionen. Reine Logik liegt in editmodell.ts + zeitleiste.ts;
// hier nur DOM + MapLibre. Wird aus studio.ts lazy importiert, damit MapLibre
// nur bei Bedarf ins Studio-Bundle kommt.

import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { STUDIO_PEGEL_VORGABE, videoLautstaerke, videoTonHuelle } from '../audiotracks.js'
import {
  ausschnittDauerS,
  klemmeSeitenverhaeltnis,
  VIDEO_HAT_FRAME,
  videoNachfuehrung,
} from '../einblendung.js'
import type { KartenMedium, KartenQuelle, KartenText } from '../kartenmaler.js'
import { createKartenSchicht, type KartenSchicht } from '../kartenschicht.js'
import { pfad, tourPfad } from '../routen.js'
import { BESCHREIBUNG_MAX } from '../tourtexte.js'
import { verdrahteTipps } from './tipp.js'
import * as api from './api.js'
import { oeffneExportBlatt, schliesseExportBlatt } from './exportblatt.js'
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
} from './editmodell.js'
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
  holdS,
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
  videoStandS,
  recordingTimeAtFilmTime,
  type TimelineAxis,
  type AxisStop,
  type FilmCurve,
  type EditorSelection,
  type EditorSelectionTarget,
  type StopInterval,
  type SceneClip,
  type TimeScale,
} from './zeitleiste.js'
import {
  KATEGORIE_NAMEN,
  SFX_BIBLIOTHEK,
  sfxEffekt,
  type SfxEffekt,
  type SfxTyp,
} from './sfxbibliothek.js'
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
} from './tonklip.js'
import { erzeugeKartenstimmung, type Kartenstimmung } from './kartenstimmung.js'
import { baueStopps, meterOhneCluster, reiheVergeben, stoppVon, type Stopp } from './stopps.js'
import { beschreibeAufnahme, liesAufnahme, liesExif, type ExifAufnahme } from './exif.js'
import {
  abstandsFunktion,
  befundSaetze,
  einordnungWort,
  fasseZusammen,
  megabyte,
  streifenAnteil,
  type NachreichBefund,
  type NachreichZiel,
  type NeueAufnahme,
} from './nachreichen.js'
import { exifDatumZuMs, isoMitZone, medientyp } from './upload.js'
// Nur Typen — das Modul selbst wird erst beim ersten Play geladen.
import type { Abspieler, KlangMarke, MusikKlip, Spielplan } from './abspielen.js'

/** Anzeigename eines Audio-Eintrags: Katalogname bei Bibliothek, eigener
 *  Upload ohne Datei-Endung, sonst der rohe Dateiname (tour-lokaler Altbestand). */
function audioName(a: AudioEntry): string {
  if (a.source === 'library') return sfxEffekt(a.file)?.name ?? a.file
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
const MODUS_NAMEN: Record<TravelMode, string> = {
  walk: 'Zu Fuß',
  bike: 'Rad',
  moped: 'Moped',
  jeep: 'Jeep',
  tram: 'Tram',
  ferry: 'Fähre',
}
const MODUS_FARBEN: Record<TravelMode, string> = {
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
const PRESET_NAMEN: Record<CameraPreset, string> = {
  default: 'Standard',
  near: 'Nah',
  mid: 'Mittel',
  far: 'Weit',
}
const KAMERA_STANDARD = PRESET_NAMEN.default
const KAMERA_STANDARD_ERKLAERT =
  'Standard: Es gilt der Abstand, den der Zuschauer im Player einstellt (Nah, Mittel oder Weit).'
/** Anzeigenamen der Wetter-Modi (Reihenfolge = Auswahl-Liste). */
const WETTER_NAMEN: Record<WeatherMode, string> = {
  off: 'Klar',
  clouds: 'Wolkig',
  fog: 'Nebel',
  rain: 'Regen',
  snow: 'Schnee',
  storm: 'Gewitter',
}
/** Wetter-Bänder: gedämpfte, mitteldunkle Füllung (helle Bandschrift bleibt lesbar). */
const WETTER_FARBEN: Record<WeatherMode, string> = {
  off: 'rgba(70, 120, 175, 0.55)',
  clouds: 'rgba(120, 132, 148, 0.62)',
  fog: 'rgba(140, 150, 165, 0.55)',
  rain: 'rgba(52, 110, 200, 0.68)',
  snow: 'rgba(150, 170, 195, 0.62)',
  storm: 'rgba(96, 78, 160, 0.72)',
}
/** Standard-Wetterstärke k (Spiegel von WETTER_STANDARD_K im Server). */
const WETTER_STANDARD_K = 0.7
const MOMENT_NAMEN: Record<CameraMomentKind, string> = {
  orbit: 'Umkreisen',
  ascend: 'Aufstieg',
  linger: 'Innehalten',
}
/** Symbol je Moment-Art auf der Zeitleisten-Marke. */
const MOMENT_ZEICHEN: Record<CameraMomentKind, string> = { orbit: '↻', ascend: '↑', linger: '⏸' }
/** Kamera-Bänder: ein Farbton, Deckkraft = Nähe (nah kräftig, weit zurückhaltend). */
const PRESET_FARBEN: Record<CameraPreset, string> = {
  // Standard ist keine Distanz, also auch nicht im Distanz-Farbton: dieselbe
  // ruhige Fläche wie das Grundband (.band.grund), damit beide dasselbe sagen.
  default: 'rgba(103, 114, 127, 0.22)',
  near: 'rgba(91, 157, 255, 0.72)',
  mid: 'rgba(91, 157, 255, 0.46)',
  far: 'rgba(91, 157, 255, 0.24)',
}
const PLACEMENT_NAMEN: Record<string, string> = {
  gps: 'GPS',
  time: 'Zeit',
  manual: 'manuell',
  unplaced: 'unplatziert',
}
const AUDIO_ENDUNGEN = ['mp3', 'm4a', 'ogg', 'wav']
/** Icon aus dem Sprite in studio.html (nur für vertrauten, statischen Markup-Bau). */
const icon = (name: string): string => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`

/**
 * Fokussiertes Objekt — die gemeinsame Auswahl von Zeitleiste, Karte und
 * Inspector. Bewusst nur die IDENTITÄT: Bänder entstehen aus Overlay + Track
 * und würden als kopierte Spanne veralten, sobald man eine Grenze verschiebt.
 * Die konkrete Spanne löst loeseFokusAuf() bei jedem Render neu auf.
 *
 * Getrennt von `auswahl` (der Einfügemarke für „ab hier"-Aktionen) — wie
 * Abspielkopf und Selektion in einem Schnittprogramm.
 */
interface Zustand {
  tourId: string
  daten: api.EditorPayload
  edits: EditOverlay
  /** JSON-Schnappschuss des gespeicherten Overlays (Dirty-Erkennung) */
  gespeichert: string
  /** Trackpunkte flach über alle Segmente */
  track: TrackPoint[]
  /** Einfügemarke: Punkt AUF der Track-Linie (interpoliert, inkl. tOffset) */
  auswahl: TrackPoint | null
  /** fokussiertes Objekt (Band, Audio-Spur, Medium) — siehe Fokus */
  fokus: EditorSelection | null
  /**
   * Tour-Einstellungen im Inspector (Titel/Beschreibung/Endscreen).
   * Bewusst getrennt vom Leerzustand und von `fokus`: Einstieg über Titel/„…",
   * Auswahl eines Zeitleisten-Objekts schließt die Ansicht wieder.
   */
  tourEinstellungen: boolean
  /** Medien-ID im „auf den Track klicken"-Platzieren-Modus */
  platzieren: string | null
  /** frühere Overlay-Stände (Undo), ältester zuerst */
  past: EditOverlay[]
  /** zurückgenommene Stände (Redo), jüngster zuletzt */
  future: EditOverlay[]
}

let karte: maplibregl.Map | null = null
let z: Zustand | null = null
/**
 * Kartenpunkte der Halte, nach ihrer Zusammensetzung geschlüsselt (Wortliste
 * der Medien-IDs). Ein Halt, der sich nicht geändert hat, BEHÄLT sein Element
 * über den nächsten Render hinweg — Abreißen und Neubauen ließ bei jedem Klick
 * alle Bilder kurz zu leeren Kreisen werden (der Browser zeichnet ein frisches
 * `img` erst nach dem Dekodieren).
 */
let marker = new Map<string, MarkerEintrag>()
let medienMarker = new Map<string, HTMLElement>()
/** Medien-ID → Kartenpunkt ihres Halts (für ruckfreies Ziehen). */
let markerZuId = new Map<string, maplibregl.Marker>()

interface MarkerEintrag {
  mk: maplibregl.Marker
  el: HTMLElement
  /** Aktueller Halt — die Zieh-Handler lesen ihn HIER, nicht aus ihrer Closure. */
  stopp: Stopp
}
let laeufer: maplibregl.Marker | null = null
let vorschau: { audio: HTMLAudioElement; file: string } | null = null
let zurueckCb: (() => void) | null = null
let verdrahtet = false
/** Kumulierte Streckenmeter je Trackpunkt — für die km-Anzeige am Abspielkopf. */
let kumStrecke: number[] = []
/**
 * Maßstab der Zeitachse in PIXELN JE FILMSEKUNDE — die gespeicherte Zoomgröße.
 *
 * Nicht ein Faktor auf die Fensterbreite: die Fortbewegung bestimmt die
 * Filmdauer, ein Faktor-Modell skalierte deshalb bei jeder Modus-Änderung die
 * ganze Leiste — auch alles VOR der geänderten Stelle, das damit nichts zu tun
 * hat. Mit festem Maßstab bleibt links der Änderung jedes Pixel stehen; nur was
 * dahinter liegt, rückt. 0 = noch nicht gemessen.
 */
let pxProFilmS = 0

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
const tonDauern = new Map<string, number>()
/** Läuft/lief bereits eine Messung? Verhindert Messschleifen bei Fehlern. */
const tonGemessen = new Set<string>()

/**
 * Solange wahr, folgt der Maßstab der Fensterbreite („eingepasst") — der
 * Startzustand und die Untergrenze des Zoomens. Erst eine Nutzerhandlung
 * (Hineinzoomen) friert ihn ein, waagerechter Scroll entsteht nie beim Öffnen.
 */
let einpassen = true
/** Aktives Werkzeug der Zeitleiste (Auswahl · Hand · Zoom), wie in Final Cut. */
let werkzeug: 'auswahl' | 'hand' | 'zoom' = 'auswahl'
/**
 * Schluckt den Klick NACH einem Zug, damit das Loslassen nicht zusätzlich
 * auswählt. Aufgehoben wird die Sperre von der nächsten Zeigergeste (s.
 * verdrahteEinmal) — NICHT vom folgenden `click`: `preventDefault()` im
 * pointerdown unterdrückt die Maus-Kompatibilitätsereignisse, der Klick kommt
 * dann gar nicht, und die Sperre fräße den nächsten echten Klick.
 */
let unterdrueckeKlick = false
/**
 * Overlay-Stand beim letzten Voll-Render — Grundlage der Undo-Erfassung.
 *
 * Das Overlay wird ausschließlich immutabel fortgeschrieben (editmodell.ts), ein
 * REFERENZ-Vergleich erkennt also jede Änderung, egal aus welchem der ~30
 * Handler sie kam. Das erspart es, jede Mutation einzeln zu instrumentieren.
 * Während eines Zeitleisten-Zugs läuft nur renderNachZug(), das den Stand nicht
 * fortschreibt — der ganze Zug wird dadurch zu genau einem Undo-Schritt.
 */
let letzterStand: EditOverlay | null = null

// — Einstieg —

export async function oeffneEditor(tourId: string, zurueck: () => void): Promise<void> {
  zurueckCb = zurueck
  verdrahteEinmal()
  gemeldeteAblage = false
  $('editor-view').hidden = false
  status('Editor wird geladen …')
  // Benutzerweite Audio-Bibliothek nebenher holen — der Dialog und die
  // Herkunftszeile im Panel greifen darauf zu, blockieren soll sie nichts.
  void ladeBibliothek()
  try {
    await ladeDaten(tourId)
    status('')
  } catch (fehler) {
    status((fehler as Error).message, 'fehler')
  }
}

async function ladeDaten(tourId: string): Promise<void> {
  const daten = await api.loadEditorPayload(tourId)
  const edits = (daten.edits as EditOverlay | null) ?? EMPTY_OVERLAY
  const einstellungenOffen = z?.tourId === tourId && z.tourEinstellungen
  z = {
    tourId,
    daten,
    edits,
    gespeichert: JSON.stringify(edits),
    track: daten.segments.flatMap((s) => s.pts),
    // Der Abspielkopf steht von Anfang an irgendwo — die Marke ist keine
    // Sonderlage mehr, sondern die immer sichtbare Position auf der Achse.
    auswahl: null,
    fokus: null,
    tourEinstellungen: !!einstellungenOffen,
    platzieren: null,
    past: [],
    future: [],
  }
  letzterStand = edits
  ;($('editor-titel') as HTMLInputElement).value = daten.title ?? ''
  ;($('editor-beschreibung') as HTMLTextAreaElement).value = daten.description ?? ''
  zaehleBeschreibung()
  ;($('editor-dachzeile') as HTMLInputElement).value = daten.kicker ?? ''
  baueEbenenWahl(daten.kickerSuggestions ?? [])
  const finaleAn = !!daten.finale
  ;($('editor-finale') as HTMLInputElement).checked = finaleAn
  ;($('editor-finale-ziel') as HTMLInputElement).value = daten.finaleTarget ?? ''
  ;($('editor-finale-ziel-feld') as HTMLElement).hidden = !finaleAn
  zeigeTitelImKopf()
  ;($('editor-vorschau') as HTMLAnchorElement).href = tourPfad(`srv:${tourId}`)
  ;($('editor-vorschau') as HTMLAnchorElement).style.display =
    daten.status === 'ready' ? '' : 'none'
  ;($('editor-film') as HTMLButtonElement).hidden = daten.status !== 'ready'

  // Streckenmeter einmal je Tour vorrechnen — die km-Anzeige am Abspielkopf
  // fragt sie bei jeder Bewegung ab.
  kumStrecke = cumMeters(z.track)
  const gesamt = document.getElementById('kopf-km-ges')
  if (gesamt) gesamt.textContent = kmText(kumStrecke[kumStrecke.length - 1] ?? 0)

  if (!karte) {
    karte = baueKarte()
    await new Promise<void>((erfuellt) => karte?.once('load', () => erfuellt()))
    baueTrackLayer(karte)
    baueStimmung(karte)
    baueKartenSchicht()
  }
  passeAusschnittAn()
  // Abspielkopf auf den Anfang der Tour stellen — er ist ab jetzt immer
  // sichtbar, nicht mehr eine Sonderlage nach dem ersten Klick.
  const skalaInit = buildScale(z.track)
  if (skalaInit) z.auswahl = pointAtOffset(z.track, skalaInit.fromS)
  kopfFilmS = 0
  renderAlles()
  // Die Achsenbreite ERST danach setzen: `renderZeitleiste` blendet die Leisten-
  // Zone ein, und solange sie `hidden` ist, misst sich ihr Fenster als 0 breit —
  // der Fit hätte auf die Notbreite gerechnet und die Achse gestaucht.
  einpassen = true
  pxProFilmS = 0
  passeEin()
}

function schliesse(): void {
  schliesseExportBlatt()
  $('editor-view').hidden = true
  schliesseGross()
  stoppeVorschau()
  abspieler?.schliesse()
  abspieler = null
  verbergeFoto()
  karte?.remove()
  karte = null
  // Die Stimmung muss AUSDRÜCKLICH zurückgenommen werden. Die Paint-Properties
  // gehen mit `karte.remove()`, aber das Partikel-Overlay hängt an der Bühne
  // und bringt eigene Klang-Loops mit — ohne diesen Aufruf blieben Regenklänge
  // hörbar, nachdem man die Tour längst verlassen hatte (gemeldet). Der
  // Schalter-Zustand lebt in localStorage weiter und wird beim nächsten Aufbau
  // gelesen.
  stimmung?.zerstoere()
  stimmung = null
  // Die Leinwand hängt an der Bühne und bringt zwei Beobachter (Resize) mit —
  // ohne diesen Aufruf blieben sie auf einem Container liegen, den die nächste
  // Tour neu bespielt.
  kartenSchicht?.zerstoere()
  kartenSchicht = null
  z = null
  letzterStand = null
  marker = new Map()
  medienMarker = new Map()
  markerZuId = new Map()
  leereTourCaches()
  laeufer = null
  kumStrecke = []
  pxProFilmS = 0
  einpassen = true
  kopfFilmS = null
  zurueckCb?.()
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
function leereTourCaches(): void {
  klipEls = new Map()
  momentEls = new Map()
  exifCache.clear()
  seitenverhaeltnisse.clear()
  tonDauern.clear()
  wellenBilder.clear()
}

/** Von außen (Studio-URL / Zurück-Taste) — no-op, wenn der Editor schon zu ist. */
export function schliesseEditor(): void {
  if ($('editor-view').hidden) return
  schliesse()
}

// — Karte —

function baueKarte(): maplibregl.Map {
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
  k.on('click', (e) => klickAufKarte(e))
  // Follow und Zoom vertragen sich nicht gleichzeitig: jedes Follow-`jumpTo`
  // bricht die Zoom-Animation ab. Bei Nutzer-Zoom Follow kurz pausieren.
  k.on('wheel', () => pausiereKartenFolge())
  k.on('zoomstart', (e) => {
    if (e.originalEvent) pausiereKartenFolge()
  })
  return k
}

function baueTrackLayer(k: maplibregl.Map): void {
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
function zeichneFokus(): void {
  if (!karte || !z) return
  const source = karte.getSource('fokus') as maplibregl.GeoJSONSource | undefined
  if (!source) return
  const info = loeseFokusAuf()
  const features: GeoJSON.Feature[] = []
  if (info) {
    if (info.toS > info.fromS) {
      // Ränder interpolieren, damit der Abschnitt exakt an der Bandkante endet
      // und nicht am nächsten Stützpunkt (Fähren-Geraden!)
      const punkte: TrackPoint[] = []
      const anfang = pointAtOffset(z.track, info.fromS)
      if (anfang) punkte.push(anfang)
      for (const p of z.track) if (p[3] > info.fromS && p[3] < info.toS) punkte.push(p)
      const end = pointAtOffset(z.track, info.toS)
      if (end) punkte.push(end)
      if (punkte.length >= 2) {
        features.push({
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: punkte.map((p) => [p[0], p[1]]) },
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

function passeAusschnittAn(): void {
  if (!karte || !z || !z.track.length) return
  // Der Container ist Teil eines frisch eingeblendeten Grids — Maß nachziehen,
  // bevor der Ausschnitt gerechnet wird (sonst passt fitBounds auf alte Größe).
  karte.resize()
  const grenzen = new maplibregl.LngLatBounds()
  for (const p of z.track) grenzen.extend([p[0], p[1]])
  // Unten mehr Luft: dort schwebt die Zeitleiste über der Karte. Auf kleinen
  // (Mobil-)Karten das Padding proportional klemmen — übersteigt es den
  // Container, wirft MapLibre und der Editor bliebe in der Weltansicht.
  const wrap = karte.getContainer()
  const skal = Math.min(1, wrap.clientWidth / (70 + 70 + 60), wrap.clientHeight / (70 + 185 + 60))
  const px = (p: number): number => Math.round(p * skal)
  karte.fitBounds(grenzen, {
    padding: { top: px(70), right: px(70), bottom: px(185), left: px(70) },
    duration: 0,
  })
}

function klickAufKarte(e: maplibregl.MapMouseEvent): void {
  if (!karte || !z) return
  const r = 8
  const treffer = karte.queryRenderedFeatures(
    [
      [e.point.x - r, e.point.y - r],
      [e.point.x + r, e.point.y + r],
    ],
    { layers: ['track-aktiv', 'track-inaktiv'] },
  )
  if (!treffer.length) return
  // Lotfußpunkt auf der LINIE — nicht der nächste Stützpunkt: der Track ist
  // vereinfacht, auf Geraden (Fähre) liegen Stützpunkte kilometerweit auseinander.
  const projektion = projectOntoTrack(z.track, e.lngLat.lng, e.lngLat.lat)
  if (z.platzieren) {
    z.edits = withMediaEdit(z.edits, z.platzieren, {
      anchor: [projektion.point[0], projektion.point[1]],
    })
    z.platzieren = null
  } else {
    z.auswahl = projektion.point
  }
  renderAlles()
}

// — Anzeige —

function renderAlles(): void {
  if (!karte || !z) return
  // Jede Bearbeitung und jede Auswahl beendet die Wiedergabe: der Plan des
  // Abspielers ist ein Schnappschuss, er liefe sonst gegen veraltete Halte.
  halteAbspielen()
  // Undo-Punkt setzen, wenn sich das Overlay seit dem letzten Voll-Render
  // geändert hat (s. letzterStand). Undo/Redo selbst ziehen den Stand vorher
  // nach und lösen hier deshalb keinen neuen Eintrag aus.
  recordUndo(z, letzterStand, z.edits)
  letzterStand = z.edits
  renderHistorieKnoepfe()
  zeichneTrack()
  zeichneMarker()
  renderInspektor()
  renderZeitleiste()
  renderAblage()
  $('editor-map').classList.toggle('platzieren', z.platzieren !== null)
  $('editor-medien-hinweis').textContent = z.platzieren
    ? 'Auf den Track klicken, um das Medium dort zu verankern, erneut „Platzieren" drücken bricht ab.'
    : ''
}

// — Undo/Redo: das Overlay ist immutabel, ein Stapel von Ständen genügt —

function rueckgaengig(): void {
  const zz = z // Modul-let: Narrowing überlebt die Aufrufe unten nicht
  if (!zz?.past.length) return
  zz.future.push(zz.edits)
  zz.edits = zz.past.pop() as EditOverlay
  letzterStand = zz.edits // der Rücksprung selbst ist kein neuer Undo-Punkt
  renderAlles()
  status('Rückgängig gemacht.', 'ok')
}

function wiederherstellen(): void {
  const zz = z
  if (!zz?.future.length) return
  zz.past.push(zz.edits)
  zz.edits = zz.future.pop() as EditOverlay
  letzterStand = zz.edits
  renderAlles()
  status('Wiederhergestellt.', 'ok')
}

function renderHistorieKnoepfe(): void {
  if (!z) return
  ;($('editor-undo') as HTMLButtonElement).disabled = !z.past.length
  ;($('editor-redo') as HTMLButtonElement).disabled = !z.future.length
}

function zeichneTrack(): void {
  if (!karte || !z) return
  const abschnitte = splitForDisplay(
    z.daten.segments as EditorSegment[],
    z.edits,
    z.daten.time.start,
  )
  const source = karte.getSource('track') as maplibregl.GeoJSONSource
  source.setData({
    type: 'FeatureCollection',
    features: abschnitte.map((a) => ({
      type: 'Feature',
      properties: { farbe: MODUS_FARBEN[a.mode], aktiv: a.active ? 1 : 0 },
      geometry: { type: 'LineString', coordinates: a.pts.map((p) => [p[0], p[1]]) },
    })),
  })
  zeichneFokus()
}

function zeichneMarker(): void {
  if (!karte || !z) return
  medienMarker = new Map()
  markerZuId = new Map()
  const gesehen = new Set<string>()

  // Ein HALT ist auch auf der Karte EIN Punkt: drei Bilder vom selben Ort lägen
  // sonst als drei fast deckungsgleiche Kreise übereinander und man sähe nur
  // einen. Das Bild selbst zeigt, was dort wartet — auf einem Satellitenbild
  // wäre ein Punkt nur ein weiterer heller Fleck.
  for (const stopp of baueStopps(medienAnzeige(), z.track, kumStrecke)) {
    const kopf = stopp.items[0]
    if (!kopf?.anchor) continue
    const schluessel = stopp.items.map((m) => m.id).join(' ')
    gesehen.add(schluessel)
    const vorhanden = marker.get(schluessel)
    const eintrag = vorhanden ?? baueMarkerEintrag(stopp, schluessel)
    if (!eintrag) continue
    // Bestehenden Punkt fortschreiben statt neu bauen: dieselben Bilder bleiben
    // dekodiert, der Punkt springt nicht.
    eintrag.stopp = stopp
    eintrag.mk.setLngLat(kopf.anchor)
    const fokusId = z.fokus?.kind === 'medium' ? z.fokus.id : null
    eintrag.el.classList.toggle('an', !!fokusId && stopp.items.some((m) => m.id === fokusId))
    eintrag.el.title =
      stopp.items.length > 1
        ? `Halt mit ${stopp.items.length} Aufnahmen · ziehen verankert alle neu`
        : `${kopf.caption || kopf.id} · ${PLACEMENT_NAMEN[kopf.placement] ?? kopf.placement}, ziehen verankert neu`
    marker.set(schluessel, eintrag)
    for (const m of stopp.items) {
      medienMarker.set(m.id, eintrag.el)
      markerZuId.set(m.id, eintrag.mk)
    }
  }

  // Was es nicht mehr gibt (Halt zerfallen, Aufnahme gelöscht), verschwindet
  for (const [schluessel, eintrag] of marker) {
    if (gesehen.has(schluessel)) continue
    eintrag.mk.remove()
    marker.delete(schluessel)
  }

  // Grenz- und Trim-Pins gibt es nicht mehr: WO ein Zustand gilt, beantworten
  // die Bänder der Zeitleiste und der leuchtende Fokus-Abschnitt auf der Karte.
  // Wo der Abspielkopf steht, zeigt der Läufer (setzeLaeufer).
}

/** Kartenpunkt eines Halts aufbauen (einmalig — danach nur noch fortgeschrieben). */
function baueMarkerEintrag(stopp: Stopp, _schluessel: string): MarkerEintrag | null {
  const kopf = stopp.items[0]
  if (!karte || !kopf?.anchor) return null
  const anzahl = stopp.items.length
  const el = document.createElement('div')
  el.className = 'medien-punkt'
  // Wortliste aller Aufnahmen des Halts — beim Abspielen pulst der Punkt,
  // zu dem die gerade eingeblendete Aufnahme gehört.
  el.dataset['ids'] = stopp.items.map((m) => m.id).join(' ')
  const halo = document.createElement('span')
  halo.className = 'halo'
  el.appendChild(halo)
  for (const nr of [2, 1]) {
    if (anzahl > nr) {
      const stapel = document.createElement('span')
      stapel.className = `stapel s${nr}`
      el.appendChild(stapel)
    }
  }
  const kern = document.createElement('span')
  kern.className = 'kern'
  const thumb = kopf.type === 'photo' || kopf.poster ? thumbnailSource(kopf) : undefined
  if (thumb) {
    const bild = document.createElement('img')
    bild.src = thumb
    bild.alt = ''
    kern.appendChild(bild)
  } else {
    kern.innerHTML = icon('film')
  }
  el.appendChild(kern)
  if (anzahl > 1) {
    const plakette = document.createElement('span')
    plakette.className = 'anzahl'
    plakette.textContent = String(anzahl)
    el.appendChild(plakette)
  }

  const mk = new maplibregl.Marker({ element: el, draggable: true, subpixelPositioning: true })
    .setLngLat(kopf.anchor)
    .addTo(karte)
  const eintrag: MarkerEintrag = { mk, el, stopp }
  let gezogen = false
  mk.on('dragstart', () => {
    gezogen = true
  })
  mk.on('dragend', () => {
    if (!z) return
    // Beim Ziehen wandert der GANZE Halt: die Abstände der Mitglieder
    // untereinander bleiben, sonst zerfiele er beim ersten Anfassen. Bezug ist
    // der AKTUELLE Halt (eintrag.stopp) — das Element überlebt Renders.
    const aktuell = eintrag.stopp
    const ankerKopf = aktuell.items[0]?.anchor
    if (!ankerKopf) return
    const ziel = mk.getLngLat()
    // Karte hat kein Snap-Feedback → ungewolltes Cluster vermeiden.
    const eigene = new Set(aktuell.items.map((m) => m.id))
    const fremdeMeter = medienAnzeige()
      .filter((m) => m.anchor && !m.removed && !eigene.has(m.id))
      .map((m) => metersToOffset(kumStrecke, z!.track, offsetVon(m)))
    const roh = projectOntoTrack(z.track, ziel.lng, ziel.lat)
    const sicherMeter = meterOhneCluster(
      metersToOffset(kumStrecke, z.track, roh.point[3]),
      fremdeMeter,
    )
    const sicher = pointAtOffset(z.track, offsetAtMeters(kumStrecke, z.track, sicherMeter))
    if (!sicher) return
    let neu = z.edits
    for (const m of aktuell.items) {
      const dLng = (m.anchor?.[0] ?? ankerKopf[0]) - ankerKopf[0]
      const dLat = (m.anchor?.[1] ?? ankerKopf[1]) - ankerKopf[1]
      const p = projectOntoTrack(z.track, sicher[0] + dLng, sicher[1] + dLat)
      neu = withMediaEdit(neu, m.id, { anchor: [p.point[0], p.point[1]] })
    }
    z.edits = neu
    renderAlles()
  })
  el.addEventListener('click', (ev) => {
    ev.stopPropagation()
    if (gezogen) {
      gezogen = false
      return
    }
    if (!z) return
    // Ist schon ein Mitglied gewählt, bleibt es das — sonst das erste
    const gewaehlt = z.fokus?.kind === 'medium' ? z.fokus.id : null
    const schon = eintrag.stopp.items.find((m) => m.id === gewaehlt)
    z.fokus = { kind: 'medium', id: (schon ?? (eintrag.stopp.items[0] as MediaView)).id }
    renderAlles()
  })
  return eintrag
}

/** Uhrzeit in der Tour-Zone; Datum nur, wenn es vom Tour-Tag abweicht (mtime-Fallen!). */
function zeitText(iso: string): string {
  if (!z) return iso
  try {
    const zone = z.daten.time.zone
    const zeit = new Intl.DateTimeFormat('de-DE', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZone: zone,
    }).format(new Date(iso))
    const tagFmt = new Intl.DateTimeFormat('de-DE', {
      day: '2-digit',
      month: '2-digit',
      timeZone: zone,
    })
    const tag = tagFmt.format(new Date(iso))
    const tourTag = tagFmt.format(new Date(z.daten.time.start))
    return tag === tourTag ? zeit : `${tag}. ${zeit}`
  } catch {
    return iso
  }
}

/**
 * Fokus-Identität → konkretes Objekt mit Zeitspanne, gegen den AKTUELLEN
 * Overlay-Stand aufgelöst (die Logik liegt DOM-frei in zeitleiste.ts). Liefert
 * null, wenn das Objekt weg ist — der Inspector zeigt dann den Leerzustand.
 */
function loeseFokusAuf(): EditorSelectionTarget | null {
  if (!z) return null
  return loeseFokusAufRein(
    z.fokus,
    // Anzeige-Sicht: enthält auch das automatisch ermittelte Wetter, damit ein
    // Wetterband beschrieben werden kann, bevor jemand es festschreibt.
    editsFuerAnzeige(),
    splitForDisplay(z.daten.segments as EditorSegment[], z.edits, z.daten.time.start),
    z.track,
    z.daten.time.start,
    medienAnzeige(),
    // Ton-Spannen über die FILM-Achse: `from`/`to` sind seit Etappe 4 nur noch
    // Fallback, und der Inspector muss dasselbe zeigen wie die Leiste.
    (index) => {
      const klip = tonKlipVon(index)
      const kurve = aktuelleAchse()?.curve
      if (!klip || !kurve) return null
      return {
        fromS: recordingTimeAtFilmTime(kurve, klip.filmVon),
        toS: recordingTimeAtFilmTime(kurve, klip.filmBis),
      }
    },
  )
}

/** Uhrzeit ohne Sekunden — Inspector-Zeiten sollen überfliegbar sein. */
function uhrKurz(iso: string): string {
  if (!z) return iso
  try {
    return new Intl.DateTimeFormat('de-DE', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: z.daten.time.zone,
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

/** Aufnahmezeit-Offset (s) einer Aufnahme (Anker auf die Linie projiziert). */
function offsetVon(m: MediaView): number {
  if (!z || !m.anchor) return 0
  return projectOntoTrack(z.track, m.anchor[0], m.anchor[1]).point[3]
}

/** Trackpunkt bei einem Aufnahmezeit-Offset (s) — Umkehrung von offsetVon. */
function punktBeiOffset(offsetS: number): TrackPoint | null {
  return z ? pointAtOffset(z.track, offsetS) : null
}

// — Ereignis anlegen: Spur-Menüs an der Einfügemarke —
//
// Jede Bahn trägt ein „+". Was dort entsteht, beginnt IMMER an der Marke — das
// ist dieselbe Stelle, die der Abspielkopf zeigt. Früher lag dafür eine
// Knopfleiste in der Sidebar, weit weg von der Bahn, die sie betraf.

let offenesMenue: HTMLElement | null = null

function schliesseSpurMenue(): void {
  offenesMenue?.remove()
  offenesMenue = null
  document
    .querySelectorAll<HTMLElement>(
      '.spur-plus[aria-expanded="true"], #ablage-knopf[aria-expanded="true"]',
    )
    .forEach((b) => {
      b.setAttribute('aria-expanded', 'false')
    })
}

/** Menü über dem Knopf platzieren (fixed am Body — kein overflow schneidet es ab). */
function zeigeSchwebeMenue(inhalt: HTMLElement, knopf: HTMLElement): void {
  schliesseSpurMenue()
  document.body.appendChild(inhalt)
  const r = knopf.getBoundingClientRect()
  const breite = inhalt.offsetWidth
  const hoehe = inhalt.offsetHeight
  inhalt.style.left = `${Math.round(Math.max(8, Math.min(r.left, window.innerWidth - breite - 8)))}px`
  // Nach oben aufklappen, wenn unten kein Platz ist (die Leiste sitzt unten)
  const untenPlatz = window.innerHeight - r.bottom
  inhalt.style.top =
    untenPlatz > hoehe + 12
      ? `${Math.round(r.bottom + 6)}px`
      : `${Math.round(Math.max(8, r.top - hoehe - 6))}px`
  offenesMenue = inhalt
  knopf.setAttribute('aria-expanded', 'true')
}

/** Menü-Eintrag mit optionalem Farbtupfer. */
function menueEintrag(text: string, beiKlick: () => void, farbe?: string): HTMLElement {
  const b = document.createElement('button')
  b.type = 'button'
  if (farbe) {
    const punkt = document.createElement('i')
    punkt.style.background = farbe
    b.appendChild(punkt)
  }
  b.append(text)
  b.addEventListener('click', () => {
    schliesseSpurMenue()
    beiKlick()
  })
  return b
}

/** Zeit-Offset der Einfügemarke (Abspielkopf) — Ausgangspunkt jeder Neuanlage. */
function markeOffset(): number {
  if (!z) return 0
  if (z.auswahl) return z.auswahl[3]
  const scale = buildScale(z.track)
  return scale?.fromS ?? 0
}

function oeffneSpurMenue(spur: string, knopf: HTMLElement): void {
  if (!z) return
  const start = z.daten.time.start
  const abS = markeOffset()
  const from = offsetToIso(start, abS)
  const menue = document.createElement('div')
  menue.className = 'schwebe-menue'
  const kopf = document.createElement('div')
  kopf.className = 'kopfzeile'
  kopf.textContent = `ab ${uhrzeitKurz(from)} Uhr`
  menue.appendChild(kopf)

  if (spur === 'wege') {
    for (const [wert, name] of Object.entries(MODUS_NAMEN)) {
      menue.appendChild(
        menueEintrag(
          name,
          () => {
            if (!z) return
            z.edits = withTravelModeBoundary(z.edits, from, wert as TravelMode)
            z.fokus = { kind: 'modus', atS: abS + 1 }
            renderAlles()
          },
          MODUS_FARBEN[wert as TravelMode],
        ),
      )
    }
  } else if (spur === 'kamera') {
    for (const [wert, name] of Object.entries(PRESET_NAMEN)) {
      menue.appendChild(
        menueEintrag(
          `Kamera ${name}`,
          () => {
            if (!z) return
            z.edits = withCameraBoundary(z.edits, from, wert as CameraPreset)
            z.fokus = { kind: 'kamera', atS: abS + 1 }
            renderAlles()
          },
          PRESET_FARBEN[wert as CameraPreset],
        ),
      )
    }
  } else if (spur === 'wetter') {
    for (const [wert, name] of Object.entries(WETTER_NAMEN)) {
      menue.appendChild(
        menueEintrag(
          name,
          () => {
            if (!z) return
            // Erst die automatisch ermittelte Einteilung festschreiben, sonst
            // machte die neue Grenze den Rest der Tour schlagartig klar.
            schreibeWetterFest()
            z.edits = withWeatherBoundary(z.edits, from, wert as WeatherMode)
            z.fokus = { kind: 'wetter', atS: abS + 1 }
            renderAlles()
          },
          WETTER_FARBEN[wert as WeatherMode],
        ),
      )
    }
  } else if (spur === 'momente') {
    for (const [wert, name] of Object.entries(MOMENT_NAMEN)) {
      menue.appendChild(
        menueEintrag(`${MOMENT_ZEICHEN[wert as CameraMomentKind]}  ${name}`, () => {
          if (!z) return
          z.edits = withCameraMoment(z.edits, from, wert as CameraMomentKind)
          z.fokus = { kind: 'moment', from }
          renderAlles()
        }),
      )
    }
    // Aufnahmen gehören in dieselbe Spur wie die Momente — es ist die Bahn der
    // Szenen. Der Eintrag steht unter dem Trenner, weil er als einziger nicht
    // „ab der Marke" wirkt: Wohin ein Bild fällt, sagt seine eigene Uhrzeit.
    const trenner = document.createElement('div')
    trenner.className = 'trenner'
    menue.appendChild(trenner)
    menue.appendChild(
      menueEintrag('Aufnahmen hinzufügen …', () => {
        if (darfNachreichen()) $('nach-datei').click()
      }),
    )
  } else if (spur === 'music') {
    menue.appendChild(menueEintrag('Aus der Bibliothek …', () => oeffneSfxDialog()))
    menue.appendChild(menueEintrag('Datei hochladen …', () => $('e-audio-datei').click()))
    // Tour-lokal hochgeladene, aber nicht eingesetzte Dateien direkt anbieten
    // (Altbestand — neue Uploads landen in der benutzerweiten Bibliothek)
    const benutzt = new Set((z.edits.audio ?? []).map((a) => a.file))
    const frei = (z.daten.audio ?? []).filter((d) => !benutzt.has(d.file))
    if (frei.length) {
      const trenner = document.createElement('div')
      trenner.className = 'trenner'
      menue.appendChild(trenner)
      for (const d of frei) {
        const zeile = menueEintrag(d.file, () => {
          if (!z) return
          void setzeTonEin({ file: d.file, type: 'music', from })
        })
        const weg = document.createElement('button')
        weg.className = 'weg'
        weg.type = 'button'
        weg.textContent = 'löschen'
        weg.title = `${d.file} vom Server löschen (${(d.size / 1048576).toFixed(1)} MB)`
        weg.addEventListener('click', (e) => {
          e.stopPropagation()
          schliesseSpurMenue()
          void audioDateiLoeschen(d.file)
        })
        zeile.appendChild(weg)
        menue.appendChild(zeile)
      }
    }
  }
  zeigeSchwebeMenue(menue, knopf)
}

// — Ablage: Aufnahmen, die (noch) nicht auf der Strecke liegen —
//
// Unplatzierte (kein GPS, keine passende Zeit) UND gelöschte in einem Fach:
// beides sind Bilder, die es gibt, die aber nicht mitspielen. Von hier zieht man
// sie auf die Zeitleiste — dort, wo sie hingehören.

function ablageMedien(): MediaView[] {
  return medienAnzeige().filter((m) => m.removed || !m.anchor)
}

/** Einmal je geöffneter Tour meldet sich die Ablage von selbst. */
let gemeldeteAblage = false

function renderAblage(): void {
  const knopf = $('ablage-knopf')
  const media = ablageMedien()
  knopf.hidden = media.length === 0
  // Ohne Ort ≠ entfernt: Ersteres ist ein FUND (die Aufnahme fehlt im Film,
  // ohne dass jemand das wollte), Letzteres eine Entscheidung. Nur der Fund
  // meldet sich laut — sonst übersieht man ihn zwischen leeren Bahnen.
  const ohneOrt = media.filter((m) => !m.removed).length
  knopf.classList.toggle('warnt', ohneOrt > 0)
  // In der Namensspalte steht die ZAHL, der Satz im Titel: Die Spalte ist
  // 168 px breit und teilt sie sich mit Symbol, Name und ⊕ — ein Satz
  // schöbe das ⊕ aus der Zeile. Gezählt wird, was die Farbe erklärt: bei
  // einem Fund die Funde, sonst alles im Fach.
  $('ablage-anzahl').textContent = String(ohneOrt || media.length)
  knopf.title = ohneOrt
    ? ohneOrt === 1
      ? '1 Aufnahme ohne Ort — zum Verankern auf die Bahn ziehen'
      : `${ohneOrt} Aufnahmen ohne Ort — zum Verankern auf die Bahn ziehen`
    : media.length === 1
      ? '1 entfernte Aufnahme'
      : `${media.length} entfernte Aufnahmen`
  knopf.setAttribute('aria-label', knopf.title)
  if (ohneOrt > 0 && !gemeldeteAblage) {
    gemeldeteAblage = true
    knopf.classList.add('meldet')
    setTimeout(() => knopf.classList.remove('meldet'), 4200)
  }
  if (offenesMenue?.dataset['ablage'] === '1') oeffneAblage() // offenes Fach mitziehen
}

function oeffneAblage(): void {
  const knopf = $('ablage-knopf')
  const menue = document.createElement('div')
  menue.className = 'schwebe-menue'
  menue.dataset['ablage'] = '1'
  const kopf = document.createElement('div')
  kopf.className = 'kopfzeile'
  kopf.textContent = 'auf die Zeitleiste ziehen'
  menue.appendChild(kopf)
  const raster = document.createElement('div')
  raster.className = 'ablage-raster'
  for (const m of ablageMedien()) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = m.removed ? 'geloescht' : ''
    // Entfernt heißt seit dem endgültigen Löschen: entfernt BIS ZUM SPEICHERN.
    // Bis dahin holt ein Zug auf die Zeitleiste die Aufnahme zurück — danach
    // gibt es sie nicht mehr, und das gehört an die Aufnahme geschrieben.
    b.title = m.removed
      ? `${m.caption || m.id} · entfernt, wird beim Speichern endgültig gelöscht`
      : `${m.caption || m.id} · ohne Ort`
    b.dataset['id'] = m.id
    const bild = document.createElement('img')
    bild.src = thumbnailSource(m)
    bild.alt = ''
    b.appendChild(bild)
    b.addEventListener('pointerdown', (e) => zieheAusAblage(e, m))
    raster.appendChild(b)
  }
  menue.appendChild(raster)
  zeigeSchwebeMenue(menue, knopf)
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
let nachStand: {
  befund: NachreichBefund
  dateien: Map<string, File>
  weggelassen: Set<string>
} | null = null

/**
 * Läuft gerade ein Upload? Solange bleibt der Dialog zu — auch gegen ESC und
 * das „×". Ein weggeklickter Dialog nähme dem Lauf seine einzige Anzeige: Der
 * Fortschritt steht in seiner Fußzeile, ein Fehler ebenso.
 */
let nachLaeuft = false

/**
 * Die Tour, gegen die eingeordnet wird — Zeitspanne UND Strecke.
 *
 * Die Strecke gehört dazu, weil `bestimmePlatzierung` im Server einen
 * GPS-Anker nur bis 500 m an die Route heranlässt; ohne sie verspräche der
 * Dialog „sitzt sofort auf der Strecke" für ein Foto, das der nächste Render
 * in die Ablage legt.
 */
function nachreichZiel(zustand: Zustand): NachreichZiel {
  const abstand = abstandsFunktion(zustand.track)
  return {
    startMs: Date.parse(zustand.daten.time.start),
    endMs: Date.parse(zustand.daten.time.end),
    ...(abstand ? { abstandZurStrecke: abstand } : {}),
  }
}

/**
 * Einzug des Streifens in px — die Punkte sitzen ZWISCHEN den Rändern, sonst
 * schnitte der erste und letzte an der Kante ab (samt seiner Uhrzeit). Steht
 * auch als `--streifen-rand` im CSS; beide Zahlen müssen gleich sein.
 */
const STREIFEN_RAND = 28

/** Anteil 0–1 → `left` innerhalb der eingezogenen Achse. */
function randPosition(anteil: number): string {
  return `calc(${STREIFEN_RAND}px + ${(anteil * 100).toFixed(2)}% - ${(anteil * 2 * STREIFEN_RAND).toFixed(1)}px)`
}

/** EXIF lesen wie beim Anlegen — Aufnahmezeit und Ort stehen in der Datei selbst. */
async function liesNeueAufnahmen(dateien: readonly File[], zone: string): Promise<NeueAufnahme[]> {
  const gelesen: NeueAufnahme[] = []
  for (const file of dateien) {
    const type = medientyp(file.name)
    if (!type) continue
    let zeitMs = file.lastModified
    let zeitGeraten = true
    let ort: [number, number] | null = null
    if (type === 'photo') {
      // Der EXIF-Block steht am DATEIANFANG — 256 KB reichen, und bei dreißig
      // Fotos ist das der Unterschied zwischen „gleich da" und Kaffeepause.
      const exif = liesExif(await file.slice(0, 262144).arrayBuffer())
      if (exif.datum) {
        zeitMs = exifDatumZuMs(exif.datum, zone)
        zeitGeraten = false
      }
      if (exif.gps) ort = exif.gps
    }
    gelesen.push({ file: file.name, type, zeitMs, zeitGeraten, ort, groesse: file.size })
  }
  return gelesen
}

function nachDialog(): HTMLDialogElement {
  return $('nach-dialog') as HTMLDialogElement
}

/**
 * Steht noch etwas Ungespeichertes im Editor?
 *
 * Nachreichen endet mit `reprocess` + `ladeDaten` — und `ladeDaten` baut den
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
function baueEbenenWahl(vorschlaege: readonly string[]): void {
  const kasten = $('editor-dachzeile-ebenen') as HTMLElement | null
  const feld = $('editor-dachzeile') as HTMLInputElement | null
  if (!kasten || !feld) return
  kasten.replaceChildren()
  kasten.hidden = vorschlaege.length === 0
  for (const wert of vorschlaege) {
    const knopf = document.createElement('button')
    knopf.type = 'button'
    knopf.textContent = wert
    knopf.setAttribute('aria-pressed', String(feld.value.trim() === wert))
    knopf.addEventListener('click', () => {
      // Noch einmal auf denselben Vorschlag: die Zeile wieder loswerden. Sonst
      // müsste man das Feld von Hand leeren, um die Zeile abzuschalten.
      feld.value = feld.value.trim() === wert ? '' : wert
      markiereEbenenWahl()
    })
    kasten.append(knopf)
  }
}

/** Welcher Vorschlag steht gerade im Feld? */
function markiereEbenenWahl(): void {
  const kasten = $('editor-dachzeile-ebenen') as HTMLElement | null
  const feld = $('editor-dachzeile') as HTMLInputElement | null
  if (!kasten || !feld) return
  const wert = feld.value.trim()
  for (const knopf of kasten.querySelectorAll('button'))
    knopf.setAttribute('aria-pressed', String(knopf.textContent === wert))
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
function zaehleBeschreibung(): void {
  const feld = $('editor-beschreibung') as HTMLTextAreaElement | null
  const zaehler = $('editor-beschreibung-zaehler') as HTMLElement | null
  if (!feld || !zaehler) return
  const laenge = feld.value.trim().length
  zaehler.textContent = `${laenge} / ${BESCHREIBUNG_MAX}`
  zaehler.classList.toggle('knapp', laenge > BESCHREIBUNG_MAX)
}

function hatUngespeichertes(zustand: Zustand): boolean {
  if (JSON.stringify(zustand.edits) !== zustand.gespeichert) return true
  const titel = ($('editor-titel') as HTMLInputElement).value.trim()
  const beschreibung = ($('editor-beschreibung') as HTMLTextAreaElement).value.trim()
  const dachzeile = ($('editor-dachzeile') as HTMLInputElement).value.trim()
  const finale = ($('editor-finale') as HTMLInputElement).checked
  const finaleZiel = ($('editor-finale-ziel') as HTMLInputElement).value.trim()
  return (
    (!!titel && titel !== (zustand.daten.title ?? '')) ||
    beschreibung !== (zustand.daten.description ?? '') ||
    // Gegen `?? ''` und nicht gegen null: Ein Feld, das noch nie gesetzt wurde,
    // ist leer — erst wenn jemand etwas hineinschreibt, gibt es eine Änderung.
    dachzeile !== (zustand.daten.kicker ?? '') ||
    finale !== !!zustand.daten.finale ||
    finaleZiel !== (zustand.daten.finaleTarget ?? '')
  )
}

/**
 * Darf jetzt nachgereicht werden? Gefragt wird VOR der Dateiauswahl (sonst
 * sucht man erst dreißig Fotos zusammen und hört dann „erst speichern") und
 * noch einmal beim Öffnen des Dialogs — der Dateidialog steht offen, während
 * nebenan weitergearbeitet werden kann.
 */
function darfNachreichen(): boolean {
  if (!z) return false
  if (hatUngespeichertes(z)) {
    status(
      'Erst speichern: Beim Hinzufügen baut der Server die Tour neu, und alles, was noch nicht gespeichert ist, ginge dabei verloren.',
      'warnung',
    )
    return false
  }
  return true
}

async function oeffneNachreichen(dateiListe: FileList | null): Promise<void> {
  if (!z || !dateiListe?.length) return
  const dateien = [...dateiListe]
  const brauchbar = dateien.filter((d) => medientyp(d.name))
  if (!brauchbar.length) {
    status(
      'Keine brauchbare Datei dabei — es gehen Fotos (JPG, PNG, WebP) und Videos (MP4, MOV, WebM).',
      'fehler',
    )
    return
  }
  if (!darfNachreichen()) return
  status('Liest die Aufnahmen …')
  const gelesen = await liesNeueAufnahmen(brauchbar, z.daten.time.zone)
  const befund = fasseZusammen(gelesen, nachreichZiel(z))
  nachStand = {
    befund,
    dateien: new Map(brauchbar.map((d) => [d.name, d])),
    weggelassen: new Set(),
  }
  status('')
  rendereNachreichen()
  nachDialog().showModal()
}

/** Uhrzeit eines ms-Zeitpunkts in der Tour-Zone (der Streifen zeigt die Uhr). */
function uhrzeitAusMs(ms: number): string {
  if (!z || !Number.isFinite(ms)) return '—'
  try {
    return new Intl.DateTimeFormat('de-DE', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: z.daten.time.zone,
    }).format(new Date(ms))
  } catch {
    return '—'
  }
}

function rendereNachreichen(): void {
  if (!z || !nachStand) return
  const { befund, weggelassen } = nachStand
  const dabei = befund.aufnahmen.filter((a) => !weggelassen.has(a.file))
  // Zahl und Megabyte beschreiben DASSELBE: das, was hochgeht. Sonst stünde
  // neben „5 Dateien" die Größe von dreien und niemand sähe, welche gilt.
  const bytes = dabei.reduce((summe, a) => summe + a.groesse, 0)
  const menge =
    dabei.length === befund.aufnahmen.length
      ? `${dabei.length} ${dabei.length === 1 ? 'Datei' : 'Dateien'}`
      : `${dabei.length} von ${befund.aufnahmen.length} Dateien`
  $('nach-unter').textContent = `${z.daten.title ?? 'Ohne Titel'} · ${menge} · ${megabyte(bytes)}`

  // — Streifen: was die Tour hat (unten, grau) und was dazukommt (oben, hell) —
  const streifen = $('nach-streifen')
  streifen.replaceChildren()
  const achse = document.createElement('div')
  achse.className = 'achse'
  streifen.appendChild(achse)
  const spanne = document.createElement('div')
  spanne.className = 'spanne'
  const vonAnteil = streifenAnteil(Date.parse(z.daten.time.start), befund.vonMs, befund.bisMs)
  const bisAnteil = streifenAnteil(Date.parse(z.daten.time.end), befund.vonMs, befund.bisMs)
  spanne.style.left = randPosition(vonAnteil)
  spanne.style.width = `calc(${((bisAnteil - vonAnteil) * 100).toFixed(2)}% - ${(
    (bisAnteil - vonAnteil) *
    2 *
    STREIFEN_RAND
  ).toFixed(1)}px)`
  streifen.appendChild(spanne)

  const setzePunkt = (el: HTMLElement, ms: number): void => {
    el.style.left = randPosition(streifenAnteil(ms, befund.vonMs, befund.bisMs))
  }
  const vorhanden = z.daten.media.filter((m) => Number.isFinite(Date.parse(m.takenAt)))
  for (const m of vorhanden) {
    const p = document.createElement('div')
    p.className = 'nach-pkt alt'
    p.title = `${uhrzeitKurz(m.takenAt)} Uhr · ${m.caption || m.id}`
    setzePunkt(p, Date.parse(m.takenAt))
    p.innerHTML = '<i></i>'
    streifen.appendChild(p)
  }
  for (const a of dabei) {
    const p = document.createElement('div')
    p.className = `nach-pkt neu${a.einordnung === 'ablage' ? ' ablage' : ''}`
    setzePunkt(p, a.zeitMs)
    const punkt = document.createElement('i')
    const uhr = document.createElement('span')
    uhr.className = 'uhr'
    uhr.textContent =
      a.einordnung === 'ablage' && a.zeitGeraten ? 'ohne Zeit' : uhrzeitAusMs(a.zeitMs)
    // Uhrzeit ÜBER dem Punkt (Flex-Spalte im CSS) — darunter läge sie auf der Achse
    p.append(uhr, punkt)
    p.title = `${a.file} · ${einordnungWort(a.einordnung)}`
    streifen.appendChild(p)
  }
  $('nach-alt-anzahl').textContent = String(vorhanden.length)
  $('nach-neu-anzahl').textContent = String(dabei.length)

  // — Die Sätze: je Gruppe einer, nur für Gruppen, die es gibt —
  //
  // Gezählt wird die AUSWAHL (ohne Weggelassene), gemessen aber weiter am
  // ursprünglichen Befund: Der Streifen soll nicht springen, sobald jemand
  // eine Aufnahme weglässt — die Zeitachse ist der Bezug, nicht das Ergebnis.
  const saetze = $('nach-saetze')
  saetze.replaceChildren()
  for (const satz of befundSaetze(fasseZusammen(dabei, nachreichZiel(z)))) {
    const li = document.createElement('li')
    li.textContent = satz
    saetze.appendChild(li)
  }

  // — Zeilen: „Weglassen" NUR, wo es etwas zu entscheiden gibt —
  const zeilen = $('nach-zeilen')
  zeilen.replaceChildren()
  for (const a of befund.aufnahmen) {
    const weg = weggelassen.has(a.file)
    const zeile = document.createElement('div')
    zeile.className = `nach-zeile ${a.einordnung}${weg ? ' weg' : ''}`
    const zeit = document.createElement('span')
    zeit.className = 'zeit'
    zeit.textContent = a.einordnung === 'ablage' && a.zeitGeraten ? '—' : uhrzeitAusMs(a.zeitMs)
    const name = document.createElement('span')
    name.className = 'name'
    name.textContent = a.file
    const wohin = document.createElement('span')
    wohin.className = 'wohin'
    wohin.textContent = weg ? 'weggelassen' : einordnungWort(a.einordnung)
    zeile.append(zeit, name, wohin)
    // Nur die Aufnahme ohne Zeit und Ort stellt eine Frage — und selbst die hat
    // mit der Ablage eine brauchbare Vorgabe, damit man sie ignorieren kann.
    if (a.einordnung === 'ablage') {
      const knopf = document.createElement('button')
      knopf.type = 'button'
      knopf.className = 'weglassen'
      knopf.textContent = weg ? 'Doch mitnehmen' : 'Weglassen'
      knopf.addEventListener('click', () => {
        if (weg) weggelassen.delete(a.file)
        else weggelassen.add(a.file)
        rendereNachreichen()
      })
      zeile.appendChild(knopf)
    }
    zeilen.appendChild(zeile)
  }

  const los = $('nach-los') as HTMLButtonElement
  los.disabled = dabei.length === 0
  los.textContent =
    dabei.length === 1 ? '1 Aufnahme hinzufügen' : `${dabei.length} Aufnahmen hinzufügen`
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
async function nimmNachreichenZurueck(
  tourId: string,
  ids: readonly string[],
  hinweis: HTMLElement,
): Promise<string[]> {
  const bleibt: string[] = []
  for (const [i, id] of ids.entries()) {
    hinweis.textContent = `Wird zurückgenommen … (${i + 1} von ${ids.length})`
    try {
      await api.deleteMedium(tourId, id)
      // Jedes Löschen stößt einen Render an — der nächste Aufruf träfe sonst
      // auf „verarbeitung" (dieselbe Regel wie beim endgültigen Löschen).
      await warteAufBereit(tourId)
    } catch {
      bleibt.push(id)
    }
  }
  return bleibt
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
async function reicheNach(): Promise<void> {
  if (!z || !nachStand || nachLaeuft) return
  const { befund, dateien, weggelassen } = nachStand
  const dabei = befund.aufnahmen.filter((a) => !weggelassen.has(a.file))
  if (!dabei.length) return
  const los = $('nach-los') as HTMLButtonElement
  const abbrechen = $('nach-abbrechen') as HTMLButtonElement
  const schliessen = $('nach-schliessen') as HTMLButtonElement
  const hinweis = $('nach-hinweis')
  nachLaeuft = true
  los.disabled = true
  abbrechen.disabled = true
  schliessen.disabled = true
  const tourId = z.tourId
  const zone = z.daten.time.zone
  // Was der Server in DIESEM Lauf angelegt hat — die Liste für den Rückzug.
  let angemeldeteIds: string[] = []
  try {
    hinweis.className = 'nach-hinweis'
    hinweis.textContent = 'Aufnahmen werden angemeldet …'
    const angemeldet = await api.addMedia(
      tourId,
      dabei.map((a) => ({
        type: a.type,
        file: a.file,
        takenAt: isoMitZone(a.zeitMs, zone),
        ...(a.ort ? { anchor: a.ort } : {}),
      })),
    )
    angemeldeteIds = angemeldet.media.map((m) => m.id)
    for (const [i, eintrag] of angemeldet.media.entries()) {
      const source = dabei[i]
      const file = source ? dateien.get(source.file) : undefined
      if (!file) continue
      hinweis.textContent = `Lädt ${i + 1} von ${angemeldet.media.length} …`
      await api.uploadMedium(tourId, eintrag.id, file)
    }
    hinweis.textContent = 'Die Tour wird neu gebaut …'
    await api.reprocess(tourId)
    await warteAufBereit(tourId)
    // Ab hier steht alles beim Server — es gibt nichts mehr zurückzunehmen.
    angemeldeteIds = []
    nachLaeuft = false
    nachDialog().close()
    nachStand = null
    await ladeDaten(tourId)
    status(
      dabei.length === 1 ? '1 Aufnahme hinzugefügt.' : `${dabei.length} Aufnahmen hinzugefügt.`,
      'ok',
    )
  } catch (fehler) {
    const grund = (fehler as Error).message
    hinweis.className = 'nach-hinweis fehler'
    const bleibt = angemeldeteIds.length
      ? await nimmNachreichenZurueck(tourId, angemeldeteIds, hinweis)
      : []
    if (bleibt.length) {
      // Auch das Aufräumen ist gescheitert: Ein zweiter Versuch legte jetzt
      // Doppelungen an, also bleibt der Knopf zu und der Satz sagt, warum.
      hinweis.textContent = `${grund} — die halb angelegten Aufnahmen ließen sich nicht zurücknehmen. Bitte den Editor neu laden und es noch einmal versuchen.`
      return
    }
    hinweis.textContent = `${grund} — es wurde nichts hinzugefügt. Du kannst es gleich noch einmal versuchen.`
    los.disabled = false
  } finally {
    // `los` wird hier NICHT freigegeben: Nach dem harten Fehler wäre ein
    // zweiter Versuch eine Doppelung. Die beiden Wege, an denen er wieder
    // gehen darf, schalten ihn selbst frei (weicher Fehler oben,
    // rendereNachreichen beim nächsten Öffnen).
    nachLaeuft = false
    abbrechen.disabled = false
    schliessen.disabled = false
  }
}

function verdrahteNachreichen(): void {
  const file = $('nach-datei') as HTMLInputElement
  file.addEventListener('change', () => {
    void oeffneNachreichen(file.files).finally(() => {
      // Zurücksetzen, sonst löst dieselbe Datei beim zweiten Mal kein `change`
      file.value = ''
    })
  })
  $('nach-schliessen').addEventListener('click', () => {
    if (!nachLaeuft) nachDialog().close()
  })
  $('nach-abbrechen').addEventListener('click', () => {
    if (!nachLaeuft) nachDialog().close()
  })
  $('nach-los').addEventListener('click', () => void reicheNach())
  // ESC geht an den Knöpfen vorbei — während des Laufs schließt es den Dialog
  // sonst mitsamt der einzigen Anzeige, die vom Upload berichtet.
  nachDialog().addEventListener('cancel', (e) => {
    if (nachLaeuft) e.preventDefault()
  })
  nachDialog().addEventListener('close', () => {
    nachStand = null
    const hinweis = $('nach-hinweis')
    hinweis.className = 'nach-hinweis'
    hinweis.textContent =
      'Die Tour wird danach neu gebaut — der Film wird länger. Deine Schnitte bleiben.'
  })
}

/**
 * Eine Aufnahme aus der Ablage auf die Zeitleiste ziehen. Über Fenster-Listener
 * (der 54-px-Knopf verlöre bei schnellen Bewegungen die Capture); losgelassen
 * über der Foto-Bahn bekommt sie dort ihren Anker — und ist damit wieder dabei.
 */
function zieheAusAblage(e: PointerEvent, m: MediaView): void {
  if (e.button !== 0 || !z) return
  e.preventDefault()
  const start = { x: e.clientX, y: e.clientY }
  let geist: HTMLElement | null = null
  let marke: HTMLElement | null = null
  let zielOffsetS: number | null = null

  const zieh = (ev: PointerEvent): void => {
    if (!geist && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 5) return
    if (!geist) {
      geist = document.createElement('div')
      geist.className = 'zieh-geist'
      const bild = document.createElement('img')
      bild.src = thumbnailSource(m)
      bild.alt = ''
      geist.appendChild(bild)
      document.body.appendChild(geist)
    }
    geist.style.left = `${ev.clientX}px`
    geist.style.top = `${ev.clientY}px`
    const bahn = document.getElementById('spur-fotos')?.getBoundingClientRect()
    const scale = aktuelleAchse()
    const ueberBahn =
      bahn &&
      scale &&
      ev.clientX >= bahn.left &&
      ev.clientX <= bahn.right &&
      ev.clientY >= bahn.top - 20 &&
      ev.clientY <= bahn.bottom + 20
    if (ueberBahn) {
      zielOffsetS = fractionToOffset(scale, spurAnteil(ev.clientX))
      if (!marke) {
        marke = document.createElement('div')
        marke.className = 'ablege-marke'
        document.getElementById('spuren')?.appendChild(marke)
      }
      marke.style.left = zeitX(offsetToFraction(scale, zielOffsetS))
    } else if (marke) {
      marke.remove()
      marke = null
      zielOffsetS = null
    }
  }
  const los = (): void => {
    window.removeEventListener('pointermove', zieh)
    window.removeEventListener('pointerup', los)
    const abgelegtBei = zielOffsetS // VOR dem Aufräumen sichern
    geist?.remove()
    marke?.remove()
    if (abgelegtBei === null || !z) return
    unterdrueckeKlick = true
    const roh = pointAtOffset(z.track, abgelegtBei)
    if (!roh) return
    // Ablage hat kein Snap — nicht still mit einem Nachbarn clustern.
    const fremdeMeter = medienAnzeige()
      .filter((x) => x.anchor && !x.removed && x.id !== m.id)
      .map((x) => metersToOffset(kumStrecke, z!.track, offsetVon(x)))
    const sicherMeter = meterOhneCluster(metersToOffset(kumStrecke, z.track, roh[3]), fremdeMeter)
    const punkt = pointAtOffset(z.track, offsetAtMeters(kumStrecke, z.track, sicherMeter))
    if (!punkt) return
    // Wieder dabei: Anker setzen und, falls es entfernt war, zurückholen
    z.edits = withMediaEdit(z.edits, m.id, { anchor: [punkt[0], punkt[1]], removed: false })
    z.fokus = { kind: 'medium', id: m.id }
    schliesseSpurMenue()
    renderAlles()
  }
  window.addEventListener('pointermove', zieh)
  window.addEventListener('pointerup', los)
}

// — Inspector-Bausteine —

/** Erklärender Satz unter einem Feld — leise, aber lesbar. */
function hinweis(text: string): HTMLElement {
  const p = document.createElement('p')
  p.className = 'insp-hinweis'
  p.textContent = text
  return p
}

/** Beschriftetes Feld mit einem Bedienelement darin. */
/** Feld mit Beschriftung; `erklaerung` hängt als ⓘ-Tooltip an der Beschriftung,
 *  statt sie mit einem Nachsatz zu verlängern (Muster wie in der Bibliothek). */
function feld(label: string, inhalt: HTMLElement, erklaerung?: string): HTMLElement {
  const d = document.createElement('div')
  d.className = 'feld'
  const l = document.createElement('label')
  l.textContent = label
  if (erklaerung) {
    const wie = document.createElement('span')
    wie.className = 'feld-wie'
    wie.tabIndex = 0
    wie.setAttribute('aria-label', erklaerung)
    wie.innerHTML = icon('info')
    const blase = document.createElement('span')
    blase.className = 'feld-wie-blase'
    blase.setAttribute('role', 'tooltip')
    blase.textContent = erklaerung
    wie.appendChild(blase)
    l.appendChild(wie)
  }
  d.append(l, inhalt)
  return d
}

/** Auswahl aus Wert→Name-Paaren; `leerText` ergänzt eine „noch nichts"-Option. */
function auswahl(
  werte: Array<[string, string]>,
  aktuell: string | undefined,
  leerText?: string,
): HTMLSelectElement {
  const s = document.createElement('select')
  if (leerText !== undefined) {
    const o = document.createElement('option')
    o.value = ''
    o.textContent = leerText
    o.selected = aktuell === undefined
    s.appendChild(o)
  }
  for (const [wert, name] of werte) {
    const o = document.createElement('option')
    o.value = wert
    o.textContent = name
    o.selected = wert === aktuell
    s.appendChild(o)
  }
  return s
}

/** Regler mit Zahlenanzeige daneben (Stärke, Kamera-Feinjustierung). */
function regler(
  attr: { min: number; max: number; step: number; wert: number },
  anzeige: (v: number) => string,
  beiAenderung: (v: number) => void,
  // Feuert bei JEDER Bewegung (input), nicht erst beim Loslassen — für Live-
  // Wirkung ohne Overlay-Patch je Pixel (der bliebe ein einziger Undo-Schritt).
  beiLive?: (v: number) => void,
): HTMLElement {
  const huelle = document.createElement('div')
  huelle.className = 'mit-wert'
  const r = document.createElement('input')
  r.type = 'range'
  r.min = String(attr.min)
  r.max = String(attr.max)
  r.step = String(attr.step)
  r.value = String(attr.wert)
  const w = document.createElement('span')
  w.className = 'wert'
  w.textContent = anzeige(attr.wert)
  r.addEventListener('input', () => {
    const v = Number(r.value)
    w.textContent = anzeige(v)
    beiLive?.(v)
  })
  r.addEventListener('change', () => beiAenderung(Number(r.value)))
  huelle.append(r, w)
  return huelle
}

/**
 * Zeitfeld: tippen, mit ▲▼ steppen ODER darüberziehen (5 px ≈ 1 Minute, wie in
 * Final Cut). Gerechnet wird über die Differenz zur angezeigten Uhrzeit
 * (clockDiffToOffset) — das ist DST-fest und übersteht Mitternacht.
 *
 * `beiAenderung` bekommt den neuen Offset in Sekunden und meldet zurück, welcher
 * Offset tatsächlich gilt (geklemmt) — oder null, wenn nichts geschah.
 */
function baueZeitfeld(
  offsetS: number,
  beiAenderung: (neuOffsetS: number) => number | null,
  beiZugEnde?: () => void,
): HTMLElement {
  const zf = document.createElement('div')
  zf.className = 'zf'
  const eingabe = document.createElement('input')
  eingabe.className = 'zf-in'
  eingabe.type = 'text'
  eingabe.inputMode = 'numeric'
  // Ohne size greift der Browser-Default (~20 Zeichen) als Mindestbreite —
  // zwei Felder nebeneinander passen dann nicht in den Inspector.
  eingabe.size = 5
  eingabe.value = uhrzeitKurz(offsetToIso(z?.daten.time.start ?? '', offsetS))
  let aktuellS = offsetS

  /** Neuen Wert anwenden und das Feld auf den tatsächlich geltenden Stand ziehen. */
  const anwenden = (neuOffsetS: number): void => {
    const gilt = beiAenderung(neuOffsetS)
    if (gilt !== null) aktuellS = gilt
    eingabe.value = uhrzeitKurz(offsetToIso(z?.daten.time.start ?? '', aktuellS))
  }

  eingabe.addEventListener('change', () => {
    const neu = clockDiffToOffset(
      aktuellS,
      uhrzeitKurz(offsetToIso(z?.daten.time.start ?? '', aktuellS)),
      eingabe.value,
    )
    if (neu === null) eingabe.value = uhrzeitKurz(offsetToIso(z?.daten.time.start ?? '', aktuellS))
    else {
      anwenden(neu)
      beiZugEnde?.()
    }
  })
  eingabe.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      eingabe.blur()
      return
    }
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    e.preventDefault()
    anwenden(aktuellS + (e.key === 'ArrowUp' ? 60 : -60))
    beiZugEnde?.()
  })

  const stepper = document.createElement('div')
  stepper.className = 'zf-step'
  for (const [label, richtung] of [
    ['Eine Minute später', 60],
    ['Eine Minute früher', -60],
  ] as const) {
    const b = document.createElement('button')
    b.type = 'button'
    b.setAttribute('aria-label', label)
    b.tabIndex = -1
    b.addEventListener('click', () => {
      anwenden(aktuellS + richtung)
      beiZugEnde?.()
    })
    stepper.appendChild(b)
  }

  // Scrubben über dem Feld: Fenster-Listener (Capture auf dem schmalen Feld
  // verlöre schnelle Bewegungen), 5 px ≈ 1 Minute. Während des Zugs sofort
  // user-select aus — sonst markiert der Browser den Text schon vor dem
  // Scrub-Schwellwert. Erst ab 3 px Fokus weg und Minute mitlaufen lassen.
  zf.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('.zf-step')) return
    const startX = e.clientX
    const startS = aktuellS
    let scrubt = false
    zf.classList.add('zieht')
    const zieh = (ev: PointerEvent): void => {
      if (!scrubt && Math.abs(ev.clientX - startX) < 3) return
      if (!scrubt) {
        scrubt = true
        zf.classList.add('scrub')
        eingabe.blur()
        window.getSelection()?.removeAllRanges()
      }
      ev.preventDefault()
      anwenden(startS + Math.round((ev.clientX - startX) / 5) * 60)
    }
    const los = (): void => {
      window.removeEventListener('pointermove', zieh)
      window.removeEventListener('pointerup', los)
      zf.classList.remove('scrub', 'zieht')
      if (scrubt) {
        unterdrueckeKlick = true
        beiZugEnde?.()
      }
    }
    window.addEventListener('pointermove', zieh)
    window.addEventListener('pointerup', los)
  })

  zf.append(eingabe, stepper)
  return zf
}

/**
 * Neu zeichnen OHNE den Inspector — während ein Zeitfeld gezogen wird, darf er
 * nicht neu entstehen: das gezogene Feld verlöre seinen Cursor, und der ganze
 * Zug soll außerdem EIN Undo-Schritt bleiben (renderAlles setzt je Aufruf einen).
 */
function renderOhneInspektor(): void {
  zeichneTrack()
  renderZeitleiste()
}

/** Feste Grenze (Tourbeginn/-ende): kein Feld, sondern eine Aussage. */
function zeitFest(text: string): HTMLElement {
  const d = document.createElement('div')
  d.className = 'zf ro'
  d.textContent = text
  return d
}

/**
 * Inspector: zeigt das fokussierte Objekt mit seinen Werten und Zeiten und
 * lässt es dort ändern. Beginn UND Ende eines Zustands sind bearbeitbar — sie
 * sind dieselbe Kante wie der Anfang des Nachbarn. Tour-Einstellungen sind
 * eine eigene Ansicht (nicht der Leerzustand).
 */
function renderInspektor(): void {
  if (!z) return
  const inhalt = $('insp-inhalt')
  const fuss = $('insp-fuss')
  const leer = $('insp-leer')
  const tourPanel = $('insp-tour')
  inhalt.innerHTML = ''
  fuss.innerHTML = ''
  const info = loeseFokusAuf()
  // Zeitleisten-Auswahl verdrängt die Tour-Einstellungen
  if (info) z.tourEinstellungen = false
  if (z.tourEinstellungen) {
    leer.hidden = true
    tourPanel.hidden = false
    inhalt.hidden = true
    fuss.hidden = true
    return
  }
  tourPanel.hidden = true
  if (!info) {
    leer.hidden = false
    inhalt.hidden = true
    fuss.hidden = true
    return
  }
  leer.hidden = true
  inhalt.hidden = false
  fuss.hidden = false
  const start = z.daten.time.start
  const atS = (info.fromS + info.toS) / 2

  // — Kopf: nur die Art (Kicker). Kein zweiter Titel wie „Wetter Klar" —
  // die Einstellungen darunter legen das bereits fest.
  const kicker = document.createElement('div')
  kicker.className = 'insp-art'
  kicker.append(ART_NAMEN[info.kind])
  inhalt.append(kicker)

  // — Werte je Art —
  if (info.kind === 'modus' || info.kind === 'kamera') {
    const istModus = info.kind === 'modus'
    const werte = istModus ? Object.entries(MODUS_NAMEN) : Object.entries(PRESET_NAMEN)
    // Das Grundband trägt keinen eigenen Wert — es IST „Standard", also steht
    // das auch in der Liste ausgewählt da. Ein Platzhalter über der Auswahl
    // machte daraus einen vierten, unerreichbaren Zustand.
    const aktuell = istModus
      ? (info.mode as string | undefined)
      : ((info.preset as string | undefined) ?? 'default')
    const wahl = auswahl(werte, aktuell)
    wahl.addEventListener('change', () => {
      if (!z || !wahl.value) return
      // Ohne eigene Grenze (Band aus der Aufzeichnung) wird am Bandanfang eine
      // neue gesetzt — so lässt sich JEDER Abschnitt direkt umstellen.
      const from = info.from ?? offsetToIso(start, info.fromS)
      const preset = wahl.value as CameraPreset
      z.edits = istModus
        ? withTravelModeBoundary(z.edits, from, wahl.value as TravelMode)
        : // Die Feinjustierung gehört zu einem gewählten Abstand: „Standard"
          // reicht sie an die Einstellung des Zuschauers weiter und verböge sie.
          withCameraBoundary(
            z.edits,
            from,
            preset,
            preset === 'default' ? undefined : info.intensity,
          )
      z.fokus = istModus ? { kind: 'modus', atS } : { kind: 'kamera', atS }
      renderAlles()
    })
    // „Art" statt einer Wiederholung des Panel-Titels — der sagt schon, worum es geht.
    inhalt.appendChild(feld(istModus ? 'Art' : 'Kamera-Abstand', wahl))

    if (!istModus && info.preset && info.preset !== 'default') {
      const from = info.from ?? offsetToIso(start, info.fromS)
      const preset = info.preset
      inhalt.appendChild(
        feld(
          'Näher ↔ Weiter',
          regler(
            { min: 50, max: 200, step: 5, wert: Math.round((info.intensity ?? 1) * 100) },
            (v) => `${v} %`,
            (v) => {
              if (!z) return
              z.edits = withCameraBoundary(z.edits, from, preset, v / 100)
              z.fokus = { kind: 'kamera', atS }
              renderAlles()
            },
          ),
        ),
      )
    }
  } else if (info.kind === 'wetter') {
    const wahl = auswahl(
      Object.entries(WETTER_NAMEN),
      info.weatherMode,
      info.weatherMode ? undefined : 'Automatisch',
    )
    wahl.addEventListener('change', () => {
      if (!z || !wahl.value) return
      // Ändern übernimmt die bisher automatische Einteilung ins Overlay: dieses
      // ersetzt das Auto-Wetter serverseitig VOLLSTÄNDIG. Stärke bei „Klar" weg.
      schreibeWetterFest()
      const from = info.from ?? offsetToIso(start, info.fromS)
      const neu = wahl.value as WeatherMode
      z.edits = withWeatherBoundary(z.edits, from, neu, neu === 'off' ? undefined : info.intensity)
      z.fokus = { kind: 'wetter', atS }
      renderAlles()
    })
    inhalt.appendChild(feld('Wetterlage', wahl))
    if (!(z.edits.weather ?? []).length && info.weatherMode) {
      inhalt.appendChild(
        hinweis(
          'Automatisch ermittelt aus dem Wetterarchiv, an den Fotos nachgeschärft. Die erste Änderung übernimmt die ganze Einteilung zur Bearbeitung.',
        ),
      )
    }
    if (info.weatherMode && info.weatherMode !== 'off') {
      const from = info.from ?? offsetToIso(start, info.fromS)
      const mode = info.weatherMode
      inhalt.appendChild(
        feld(
          'Stärke',
          regler(
            {
              min: 0,
              max: 100,
              step: 10,
              wert: Math.round((info.intensity ?? WETTER_STANDARD_K) * 100),
            },
            (v) => `${v} %`,
            (v) => {
              if (!z) return
              z.edits = withWeatherBoundary(z.edits, from, mode, v / 100)
              z.fokus = { kind: 'wetter', atS }
              renderAlles()
            },
          ),
        ),
      )
    }
  } else if (info.kind === 'moment') {
    const abFest = info.from as string
    const wahl = auswahl(Object.entries(MOMENT_NAMEN), info.momentKind)
    wahl.addEventListener('change', () => {
      if (!z) return
      z.edits = withCameraMoment(z.edits, abFest, wahl.value as CameraMomentKind, info.durationS)
      renderAlles()
    })
    inhalt.appendChild(feld('Was die Kamera tut', wahl))
    const dauer = document.createElement('input')
    dauer.type = 'number'
    dauer.min = '1'
    dauer.max = '30'
    dauer.value = info.durationS !== undefined ? String(info.durationS) : ''
    dauer.placeholder = `${MOMENT_DEFAULT_S[info.momentKind as CameraMomentKind]} (Standard)`
    dauer.addEventListener('change', () => {
      if (!z) return
      const v =
        dauer.value.trim() === '' ? undefined : Math.max(1, Math.min(30, Number(dauer.value)))
      z.edits = withCameraMoment(z.edits, abFest, info.momentKind as CameraMomentKind, v)
      renderAlles()
    })
    inhalt.appendChild(feld('Dauer in Sekunden', dauer))
  } else if (info.kind === 'audio') {
    const index = info.index as number
    const eintrag = (z.edits.audio ?? [])[index]
    if (eintrag) inhalt.appendChild(baueAudioFelder(index, eintrag))
  } else {
    const medium = medienAnzeige().find((m) => m.id === info.id)
    if (medium) inhalt.appendChild(baueMediumFelder(medium))
  }

  // — Zeiten: Beginn und Ende, beides bearbeitbar, wo eine Grenze dahintersteht —
  if (info.kind !== 'medium') inhalt.appendChild(baueZeiten(info))

  // — Fuß: Löschen (Backspace tut dasselbe) —
  const { text, gesperrt, grund } = loeschInfo(info)
  const weg = document.createElement('button')
  weg.className = 'insp-loeschen'
  weg.innerHTML = `${icon('muell')}<span>${text}</span>`
  weg.disabled = gesperrt
  if (grund) weg.title = grund
  weg.addEventListener('click', () => loescheFokus())
  fuss.appendChild(weg)
}

/** Kicker-Text je Art. */
const ART_NAMEN: Record<EditorSelectionTarget['kind'], string> = {
  modus: 'Fortbewegung',
  kamera: 'Kamera',
  wetter: 'Wetter',
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
function beginntAmTourAnfang(info: EditorSelectionTarget): boolean {
  const scale = z ? buildScale(z.track) : null
  return !scale || info.fromS <= scale.fromS + 1
}

function baueZeiten(info: EditorSelectionTarget): HTMLElement {
  const paar = document.createElement('div')
  paar.className = 'zeit-paar'
  const punktEreignis = info.toS <= info.fromS

  const beginn =
    info.from && info.kind !== 'audio' && info.kind !== 'medium'
      ? feld(
          punktEreignis ? 'Zeitpunkt' : 'Beginnt um',
          grenzZeitfeld(
            info.kind as GrenzArt,
            info.from,
            info.fromS,
            (neu) => (neu + info.toS) / 2,
          ),
        )
      : feld(
          'Beginnt',
          zeitFest(beginntAmTourAnfang(info) ? 'mit dem Tourbeginn' : 'aus der Aufzeichnung'),
        )

  if (info.kind === 'audio') {
    const index = info.index as number
    paar.append(
      feld(
        'Beginnt um',
        baueZeitfeld(info.fromS, (neu) => audioZeitSetzen(index, 'ab', neu)),
      ),
      feld(
        'Endet um',
        // „Effekt, keine Dauer" stimmt seit Etappe 4 nicht mehr — auch ein Ton
        // der Szene hat eine Länge. Ohne gemessene Datei kennt die Leiste sie
        // nur noch nicht.
        info.toS > info.fromS
          ? baueZeitfeld(info.toS, (neu) => audioZeitSetzen(index, 'bis', neu))
          : zeitFest('Länge noch unbekannt'),
      ),
    )
    return paar
  }

  paar.appendChild(beginn)
  if (!punktEreignis) {
    paar.appendChild(
      info.nextFrom
        ? feld(
            'Endet um',
            grenzZeitfeld(
              info.kind as GrenzArt,
              info.nextFrom,
              info.toS,
              (neu) => (info.fromS + neu) / 2,
            ),
          )
        : feld('Endet', zeitFest('am Tourende')),
    )
  }
  return paar
}

type GrenzArt = 'modus' | 'kamera' | 'wetter' | 'moment'

/**
 * Zeitfeld, das eine Zustands-Grenze verschiebt.
 *
 * Der ISO-Anker wandert bei JEDER Änderung mit (`abAktuell`) — sonst suchte der
 * zweite Zugschritt noch nach der ursprünglichen Grenze, fände sie nicht mehr
 * und der Zug bliebe nach dem ersten Ruck stehen. Während des Zugs wird der
 * Inspector NICHT neu gebaut (das Feld verlöre sich selbst); erst am Zugende
 * macht ein voller Render daraus einen Undo-Schritt.
 */
function grenzZeitfeld(
  kind: GrenzArt,
  from: string,
  offsetS: number,
  bezug: (neuOffsetS: number) => number,
): HTMLElement {
  let abAktuell = from
  return baueZeitfeld(
    offsetS,
    (neu) => {
      if (!z) return null
      const neuAb = verschiebeGrenze(kind, abAktuell, neu)
      if (!neuAb) return null
      abAktuell = neuAb
      if (kind !== 'moment') z.fokus = { kind, atS: bezug(neu) }
      renderOhneInspektor()
      return isoToOffset(z.daten.time.start, neuAb)
    },
    () => renderAlles(),
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
function audioZeitSetzen(index: number, teil: 'ab' | 'bis', neuOffsetS: number): number | null {
  if (!z) return null
  const achse = aktuelleAchse()
  const klip = tonKlipVon(index)
  if (!achse?.curve || !klip) return null
  const start = z.daten.time.start
  const zielFilmS = filmToOffset(achse, neuOffsetS)
  const patch =
    teil === 'ab'
      ? moveAudioClip(achse, start, klip, zielFilmS)
      : trimRight(achse, start, klip, zielFilmS).patch
  z.edits = mitAudioPatch(z.edits, index, {
    ...patch,
    startS: patch.startS && patch.startS > 0 ? patch.startS : undefined,
    // `to` ist die alte Endmarke; die Länge steht jetzt in `durationFilmS`. Zwei
    // Quellen für dasselbe Ende wären eine Einladung zum Auseinanderlaufen.
    to: undefined,
  })
  renderAlles()
  // Was tatsächlich herauskam, zurück in Aufnahmezeit — das Feld soll den
  // geklemmten Wert zeigen, nicht den getippten.
  const neu = tonKlipVon(index)
  const kurve = aktuelleAchse()?.curve
  if (!neu || !kurve) return neuOffsetS
  return Math.round(recordingTimeAtFilmTime(kurve, teil === 'ab' ? neu.filmVon : neu.filmBis))
}

// — Aufnahme-Details (ausklappbar): was in der Datei über die Aufnahme steht —
//
// Die Kameradaten stehen im EXIF-Block der JPEG-Datei, also am DATEIANFANG:
// geholt werden per Range-Request nur die ersten 256 KB, und das auch erst beim
// ersten Aufklappen. Das Panel bleibt dadurch so schnell wie zuvor, und wer die
// Details nie öffnet, lädt nie ein Byte extra.

/** Aufgeklappt? Modulweit, damit ein Render den Bereich nicht wieder zuklappt. */
let infoOffen = false
/** EXIF je Medien-ID; null = geladen, aber ohne Kameradaten (oder Fehler). */
const exifCache = new Map<string, ExifAufnahme | null>()
/** Erste Bytes einer Datei — mehr braucht der EXIF-Block nie. */
const EXIF_BYTES = 262_144

async function ladeAufnahmeDaten(m: MediaView): Promise<ExifAufnahme | null> {
  try {
    const antwort = await fetch(m.src, {
      credentials: 'same-origin',
      headers: { range: `bytes=0-${EXIF_BYTES - 1}` },
    })
    if (!antwort.ok) return null
    const daten = liesAufnahme(await antwort.arrayBuffer())
    return Object.keys(daten).length ? daten : null
  } catch {
    return null // offline o. Ä. — der Bereich zeigt dann nur die bekannten Angaben
  }
}

/** Zeilen-Paar für das Angaben-Raster. */
function infoZeile(beschriftung: string, wert: string): HTMLElement {
  const z = document.createElement('div')
  z.className = 'insp-info-zeile'
  const b = document.createElement('dt')
  b.textContent = beschriftung
  const w = document.createElement('dd')
  w.textContent = wert
  z.append(b, w)
  return z
}

/** Raster füllen: erst die Angaben aus der Aufzeichnung, dann die aus der Datei. */
function fuelleInfoRaster(
  raster: HTMLElement,
  m: MediaView,
  exif: ExifAufnahme | null | undefined,
): void {
  raster.innerHTML = ''
  raster.appendChild(infoZeile('Aufgenommen', `${zeitText(m.takenAt)} Uhr`))
  raster.appendChild(infoZeile('Verortet über', PLACEMENT_NAMEN[m.placement] ?? m.placement))
  if (m.anchor) {
    raster.appendChild(
      infoZeile('Koordinaten', `${m.anchor[1].toFixed(5)}, ${m.anchor[0].toFixed(5)}`),
    )
  }
  for (const [beschriftung, wert] of exif ? beschreibeAufnahme(exif) : []) {
    raster.appendChild(infoZeile(beschriftung, wert))
  }
  const fuss = document.createElement('p')
  fuss.className = 'insp-info-fuss'
  fuss.textContent =
    exif === undefined
      ? 'Kameradaten werden gelesen …'
      : exif === null
        ? m.type === 'video'
          ? 'Die Videodatei trägt keine auslesbaren Kameradaten.'
          : 'Das Foto trägt keine Kameradaten. Viele Dienste entfernen sie beim Export.'
        : 'Aus der Datei gelesen. Die Aufnahmezeit selbst lässt sich nicht ändern. Verschiebe den Ort, um sie umzuhängen.'
  raster.appendChild(fuss)
}

/** Ausklappbarer Info-Bereich einer Aufnahme (nativ über <details>). */
function baueInfoBereich(m: MediaView): HTMLElement {
  const block = document.createElement('details')
  block.className = 'insp-info'
  block.open = infoOffen
  const kopf = document.createElement('summary')
  kopf.innerHTML = `${icon('info')}<span>Aufnahme-Details</span>${icon('pfeil-r')}`
  block.appendChild(kopf)
  const raster = document.createElement('dl')
  raster.className = 'insp-info-raster'
  block.appendChild(raster)

  const gecacht = exifCache.get(m.id)
  fuelleInfoRaster(raster, m, gecacht)

  const holen = (): void => {
    if (exifCache.has(m.id)) return
    fuelleInfoRaster(raster, m, undefined) // „wird gelesen …"
    void ladeAufnahmeDaten(m).then((daten) => {
      exifCache.set(m.id, daten)
      // Nur DIESES Raster nachziehen — ein voller Render risse den Fokus und
      // die Scroll-Position des Panels weg.
      if (raster.isConnected) fuelleInfoRaster(raster, m, daten)
    })
  }
  block.addEventListener('toggle', () => {
    infoOffen = block.open
    if (block.open) holen()
  })
  if (block.open) holen()
  return block
}

/** Herkunfts-/Beschreibungszeile eines Audio-Eintrags für die Stück-Karte. */
function audioHerkunft(a: AudioEntry): string {
  if (a.source === 'library') {
    const eff = sfxEffekt(a.file)
    return eff ? `${KATEGORIE_NAMEN[eff.kategorie]} · ${eff.beschreibung}` : 'Bibliothek'
  }
  if (a.source === 'user') {
    const eintrag = bibliothek?.find((d) => d.file === a.file)
    return eintrag ? `Eigener Upload · ${(eintrag.size / 1048576).toFixed(1)} MB` : 'Eigener Upload'
  }
  return 'In dieser Tour hochgeladen'
}

/** Felder eines Audio-Eintrags — früher nur über das Sidebar-Panel erreichbar. */
function baueAudioFelder(index: number, a: AudioEntry): HTMLElement {
  const huelle = document.createElement('div')
  huelle.style.display = 'contents'

  // — Das Stück selbst: was läuft, woher es kommt — und der Griff zum Tausch.
  // „Ändern …" öffnet die Bibliothek im Ersetzen-Modus: die Platzierung
  // (ab/bis/Lautstärke) bleibt, nur die Datei wird ausgetauscht.
  const stueck = document.createElement('div')
  stueck.className = 'insp-stueck'
  const laeuft = vorschau?.file === a.file
  const hoeren = document.createElement('button')
  hoeren.type = 'button'
  hoeren.className = 'insp-stueck-hoeren'
  hoeren.innerHTML = laeuft ? '<span class="halt"></span>' : icon('play')
  hoeren.title = laeuft ? 'Vorhören stoppen' : 'Vorhören'
  hoeren.setAttribute('aria-label', hoeren.title)
  hoeren.addEventListener('click', () => {
    if (laeuft) stoppeVorschau()
    else starteVorschau(a)
    renderInspektor()
  })
  const text = document.createElement('div')
  text.className = 'insp-stueck-text'
  const nm = document.createElement('div')
  nm.className = 'insp-stueck-name'
  nm.textContent = audioName(a)
  const her = document.createElement('div')
  her.className = 'insp-stueck-her'
  her.textContent = audioHerkunft(a)
  text.append(nm, her)
  const wechseln = document.createElement('button')
  wechseln.type = 'button'
  wechseln.className = 'insp-stueck-wechseln'
  wechseln.textContent = 'Ändern …'
  wechseln.title = 'Anderes Stück aus der Bibliothek wählen, die Platzierung bleibt'
  wechseln.addEventListener('click', () => oeffneSfxDialog({ modus: 'ersetzen', index }))
  stueck.append(hoeren, text, wechseln)
  huelle.appendChild(stueck)

  // — Rolle, nicht Form.
  //
  // Bis Etappe 4 hieß das hier „Art: Musik (über eine Strecke) / Effekt (ein
  // Zeitpunkt)" — eine Aussage über die FORM. Die stimmt nicht mehr: Beide sind
  // Klips mit Länge, beide können wiederholen, beide mischen sich. Was
  // tatsächlich unterschiedlich bleibt, ist die ROLLE im Film, und die zeigt
  // sich an zwei Stellen im Player: Der Zuschauer-Schalter „Musik" nimmt die
  // Filmmusik weg und lässt den Ton des Ortes stehen, und unter dem eigenen Ton
  // eines Videos taucht die Musik ab, die Umgebung nicht.
  const type = auswahl(
    [
      ['music', 'Filmmusik'],
      ['sfx', 'Ton der Szene'],
    ],
    a.type,
  )
  type.addEventListener('change', () => {
    if (!z) return
    const neu = type.value as 'music' | 'sfx'
    const k = tonKlipVon(index)
    const achse = aktuelleAchse()
    // Die Rolle ändert die LÄNGE nicht. Zwei Dinge kippten hier früher still:
    // `to` (nur bei Musik erlaubt) fiel beim Wechsel ersatzlos weg, und die
    // Loop-Vorgabe hängt an der Rolle — ein Klip ohne eigenes `loop` hätte sein
    // Verhalten gewechselt, ohne dass jemand etwas dazu gesagt hat.
    const laenge =
      k && achse
        ? commitAudioClip(achse, z.daten.time.start, {
            ...k,
            hasExplicitLength: k.filmBis > k.filmVon,
          })
        : null
    z.edits = mitAudioPatch(z.edits, index, {
      type: neu,
      ...(laenge ?? {}),
      ...(k ? { loop: loopAfterRoleChange(k, neu) } : {}),
      to: undefined,
    })
    renderAlles()
  })
  huelle.appendChild(
    feld(
      'Rolle',
      type,
      'Filmmusik verstummt mit dem Musik-Schalter des Zuschauers und taucht unter dem Ton eines Videos ab. Der Ton der Szene bleibt beides Mal stehen.',
    ),
  )

  huelle.appendChild(
    feld(
      'Lautstärke',
      regler(
        {
          min: 0,
          max: 100,
          step: 5,
          wert: Math.round((a.volume ?? STUDIO_PEGEL_VORGABE) * 100),
        },
        (v) => `${v} %`,
        (v) => {
          if (!z) return
          z.edits = mitAudioPatch(z.edits, index, { volume: v / 100 })
          renderAlles()
        },
        // Läuft gerade das Vorhören dieses Eintrags, folgt es dem Zug sofort —
        // so stellt man die Lautstärke nach Gehör ein, nicht nach Zahl.
        (v) => {
          if (vorschau?.file === a.file) vorschau.audio.volume = v / 100
        },
      ),
    ),
  )

  // — Wiederholung: eine EINSTELLUNG, kein Griff am Klip (docs §2E).
  //
  // Auf dem Klip wäre sie eine Ausnahme, die Lautstärke, Blende und
  // Dateiwechsel nicht auch bekommen könnten; dort steht nur das ⟲-Zeichen.
  const klip = tonKlipVon(index)
  const wdh = document.createElement('label')
  wdh.className = 'kb'
  const wdhBox = document.createElement('input')
  wdhBox.type = 'checkbox'
  wdhBox.checked = a.loop ?? a.type === 'music'
  wdhBox.addEventListener('change', () => {
    if (!z) return
    const achse = aktuelleAchse()
    // Loop AUS heißt: der rechte Materialanschlag gilt wieder — der Klip kommt
    // ans Dateiende zurück, statt mit einem stummen Rest dazustehen. Stille
    // gehört ZWISCHEN die Klips, nie in einen (docs §2E).
    const zurueck = klip && achse ? setLoop(achse, z.daten.time.start, klip, wdhBox.checked) : null
    // `loop` nur schreiben, wenn es von der Vorgabe der Rolle abweicht — sonst
    // trüge jedes angefasste Overlay ein Feld, das nichts sagt.
    const vorgabe = a.type === 'music'
    z.edits = mitAudioPatch(z.edits, index, {
      ...(zurueck ?? {}),
      loop: wdhBox.checked === vorgabe ? undefined : wdhBox.checked,
    })
    renderAlles()
  })
  wdh.append(wdhBox, document.createTextNode('Wiederholen, wenn die Datei zu Ende ist'))
  huelle.appendChild(wdh)

  // Was von der Datei zu hören ist — die Auskunft zu den beiden Trimm-Kanten.
  if (klip?.fileS) {
    const laenge = klip.filmBis - klip.filmVon
    const getrimmt = klip.startS > 0 || laenge < klip.fileS - 0.05
    const info = document.createElement('p')
    info.className = 'insp-hinweis'
    info.textContent = getrimmt
      ? `${formatFilmTime(laenge)} von ${formatFilmTime(klip.fileS)}` +
        (klip.startS > 0 ? ` · ab ${formatFilmTime(klip.startS)} der Datei` : '')
      : `${formatFilmTime(klip.fileS)}, die ganze Datei`
    huelle.appendChild(info)
  }

  if (
    z &&
    audioWouldBeDropped(a, z.edits, z.daten.time.start, buildScale(z.track) ?? { fromS: 0, toS: 0 })
  ) {
    const warn = document.createElement('p')
    warn.className = 'insp-warnung'
    warn.textContent = 'Liegt außerhalb der Tour und wird beim Rendern verworfen.'
    huelle.appendChild(warn)
  }
  return huelle
}

/** Felder einer Aufnahme — früher nur über die Medien-Liste erreichbar. */
function baueMediumFelder(m: MediaView): HTMLElement {
  const huelle = document.createElement('div')
  huelle.style.display = 'contents'

  // Der Filmstreifen ist entfallen: Was der Film an diesem Halt TUT, steht
  // seit der Klip-Kette auf der Leiste — umschalten heißt dort einen Klip
  // anklicken, umordnen ihn schieben. Eine zweite Miniaturenreihe im Inspector
  // wäre ein zweiter Weg zur selben Sache, nur ohne Zeitbezug.
  const stopp = z ? stoppVon(baueStopps(medienAnzeige(), z.track, kumStrecke), m.id) : undefined

  const bildHuelle = document.createElement('div')
  bildHuelle.className = 'insp-bild-huelle'
  const bild = document.createElement('img')
  bild.className = 'insp-bild'
  bild.src = m.type === 'video' ? (m.poster ?? m.src) : m.src
  bild.alt = ''
  bild.title = m.type === 'video' ? 'Video groß ansehen' : 'Groß ansehen'
  bild.addEventListener('click', () => zeigeGross(m.id))
  bildHuelle.appendChild(bild)
  if (m.type === 'video') {
    const badge = document.createElement('span')
    badge.className = 'insp-bild-badge'
    badge.innerHTML = `${icon('play')}Video`
    bildHuelle.appendChild(badge)
  }
  huelle.appendChild(bildHuelle)

  // Der Nutzertext wird beim Rendern zur ÜBERSCHRIFT des Foto-Stopps — deshalb
  // hier „Titel", nicht „Bildunterschrift". Die Uhrzeit steht seit dem
  // 2026-08-18 NEBEN dem Titel und nicht darunter (src/kartenmaler.ts).
  const titel = document.createElement('input')
  titel.type = 'text'
  titel.value = m.caption
  titel.placeholder = 'ohne Titel'
  titel.addEventListener('change', () => {
    if (!z) return
    z.edits = withMediaEdit(z.edits, m.id, { caption: titel.value.trim() })
    renderAlles()
  })
  huelle.appendChild(
    feld(
      'Titel',
      titel,
      'Erscheint im Film als Überschrift des Foto-Stopps, rechts daneben stehen Uhrzeit und Kilometerstand.',
    ),
  )

  if (m.type === 'photo') {
    const halt = auswahl(
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
    halt.addEventListener('change', () => {
      if (!z) return
      const v = halt.value === '' ? undefined : Number(halt.value)
      const d = { ...m.display }
      if (v === undefined) delete d.holdS
      else d.holdS = v
      z.edits = withMediaEdit(z.edits, m.id, { display: d })
      renderAlles()
    })
    huelle.appendChild(feld('Standzeit', halt))

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
      renderAlles()
    })
    kb.append(box, document.createTextNode('Langsam heranfahren (Ken Burns)'))
    huelle.appendChild(kb)
  }

  const knoepfe = document.createElement('div')
  knoepfe.className = 'insp-knoepfe'
  // „Auf der Karte platzieren" NUR für Aufnahmen ohne Ort: liegt eine erst
  // einmal auf der Strecke, verschiebt man sie direkt — Punkt auf der Karte
  // ziehen (Ort zeigen) oder Miniatur in der Zeitleiste (Zeit zeigen). Ein
  // Knopf, der denselben Zug über einen Modus nachbaut, wäre ein dritter Weg
  // zum selben Anker. Ohne Anker gibt es dagegen keinen Punkt zum Anfassen.
  if (!m.anchor) {
    const platzieren = document.createElement('button')
    platzieren.textContent =
      z?.platzieren === m.id ? 'Platzieren abbrechen' : 'Auf der Karte platzieren'
    if (z?.platzieren === m.id) platzieren.classList.add('aktiv')
    platzieren.addEventListener('click', () => {
      if (!z) return
      z.platzieren = z.platzieren === m.id ? null : m.id
      renderAlles()
    })
    knoepfe.appendChild(platzieren)
  }
  if (m.placement === 'manual') {
    const zurueck = document.createElement('button')
    zurueck.textContent = 'Automatischen Ort zurückholen'
    zurueck.addEventListener('click', () => {
      if (!z) return
      z.edits = withMediaEdit(z.edits, m.id, { anchor: undefined })
      renderAlles()
    })
    knoepfe.appendChild(zurueck)
  }
  if (knoepfe.childElementCount) huelle.appendChild(knoepfe)

  huelle.appendChild(baueInfoBereich(m))

  if (stopp && stopp.items.length > 1) {
    // Was der Halt im fertigen Film wirklich kostet: die Summe seiner
    // Aufnahmen — ein Video mit seiner Laufzeit, ein Foto mit seiner Standzeit.
    const summe = stopp.items.reduce((sum, x) => sum + mediumHoldS(x), 0)
    const zeile = document.createElement('div')
    zeile.className = 'stopp-summe'
    const links = document.createElement('span')
    links.textContent = `Halt insgesamt · ${stopp.items.length} Aufnahmen`
    const rechts = document.createElement('b')
    rechts.textContent = `${Math.round(summe)} s`
    zeile.append(links, rechts)
    huelle.appendChild(zeile)
    const hinweis = document.createElement('p')
    hinweis.className = 'insp-notiz'
    hinweis.textContent =
      'Auf der Zeitleiste liegt jede Aufnahme als eigener Klip: innerhalb des Halts ziehen ordnet sie um, darüber hinaus löst sie heraus und gibt ihr einen eigenen Ort. Die rechte Kante eines Fotos zieht seine Standzeit; der Punkt auf der Karte bewegt den ganzen Halt.'
    huelle.appendChild(hinweis)
  }
  return huelle
}

/**
 * Großansicht einer Aufnahme — wie im Mockup: dunkler Overlay, Blättern durch
 * alle (nicht gelöschten) Aufnahmen der Tour, Esc / Klick auf den Grund schließt.
 */
function zeigeGross(id: string): void {
  schliesseGross()
  if (!z) return
  const liste = grossListe()
  const idx = liste.findIndex((m) => m.id === id)
  const m = idx >= 0 ? liste[idx] : medienAnzeige().find((x) => x.id === id)
  if (!m) return
  const i = idx >= 0 ? idx : 0
  const n = Math.max(liste.length, 1)

  const el = document.createElement('div')
  el.className = 'gross'
  el.setAttribute('role', 'dialog')
  el.setAttribute('aria-modal', 'true')
  el.setAttribute('aria-label', 'Großansicht')

  const zu = document.createElement('button')
  zu.type = 'button'
  zu.className = 'zu'
  zu.setAttribute('aria-label', 'Schließen')
  zu.innerHTML = icon('x')
  zu.addEventListener('click', schliesseGross)

  const links = document.createElement('button')
  links.type = 'button'
  links.className = 'blaettern links'
  links.setAttribute('aria-label', 'Vorige')
  links.innerHTML = icon('pfeil-l')
  links.disabled = i <= 0
  links.addEventListener('click', () => {
    const vor = liste[i - 1]
    if (vor) zeigeGross(vor.id)
  })

  const rechts = document.createElement('button')
  rechts.type = 'button'
  rechts.className = 'blaettern rechts'
  rechts.setAttribute('aria-label', 'Nächste')
  rechts.innerHTML = icon('pfeil-r')
  rechts.disabled = i >= n - 1
  rechts.addEventListener('click', () => {
    const nach = liste[i + 1]
    if (nach) zeigeGross(nach.id)
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
  gt.className = 'gt'
  gt.textContent = m.caption || (m.type === 'video' ? 'Video' : 'Aufnahme')
  if (m.type === 'video') {
    const chip = document.createElement('span')
    chip.className = 'gt-video'
    chip.textContent = 'Video'
    gt.appendChild(chip)
  }
  const gm = document.createElement('div')
  gm.className = 'gm'
  const teile: string[] = [`${uhrzeitKurz(m.takenAt)} Uhr`]
  if (m.anchor) {
    const meter = metersToOffset(kumStrecke, z.track, offsetVon(m))
    teile.push(`km ${kmText(meter)}`)
  } else {
    teile.push('ohne Ort')
  }
  teile.push(`${i + 1} von ${n}`)
  gm.textContent = teile.join(' · ')
  cap.append(gt, gm)
  figure.appendChild(cap)

  el.append(zu, links, rechts, figure)
  el.addEventListener('click', (ev) => {
    if (ev.target === el) schliesseGross()
  })
  document.body.appendChild(el)
  halteAbspielen()
}

/** Aufnahmen in Tour-Reihenfolge (Stopps entlang der Strecke, sonst Aufnahmezeit). */
function grossListe(): MediaView[] {
  if (!z) return []
  const alle = medienAnzeige().filter((m) => !m.removed)
  const stopps = baueStopps(alle, z.track, kumStrecke)
  const gesehen = new Set<string>()
  const liste: MediaView[] = []
  for (const s of stopps) {
    for (const m of s.items) {
      liste.push(m)
      gesehen.add(m.id)
    }
  }
  // Unplatzierte (Ablage) ans Ende, nach Aufnahmezeit
  const rest = alle
    .filter((m) => !gesehen.has(m.id))
    .sort((a, b) => Date.parse(a.takenAt) - Date.parse(b.takenAt))
  return liste.concat(rest)
}

function schliesseGross(): void {
  document.querySelector('.gross')?.remove()
}

/** Was der Löschknopf tut — und wann er gesperrt ist. */
function loeschInfo(info: EditorSelectionTarget): {
  text: string
  gesperrt: boolean
  grund?: string
} {
  if (info.kind === 'medium') {
    const m = medienAnzeige().find((x) => x.id === info.id)
    return { text: m?.type === 'video' ? 'Video entfernen' : 'Foto entfernen', gesperrt: false }
  }
  if (info.kind === 'audio') return { text: 'Aus der Tour nehmen', gesperrt: false }
  if (info.kind === 'moment') return { text: 'Moment entfernen', gesperrt: false }
  // Das ERSTE Band hat keine eigene Grenze (es gilt von Anfang an). Entfernen
  // heißt hier: die Grenze an seinem ENDE rutscht an den Tour-Anfang, das
  // zweite Band nimmt seinen Platz ein. Das geht nur, wenn es ein zweites gibt
  // — sonst wäre die Bahn danach leer, und eine lückenlose Bahn ist die ganze
  // Idee der Zustandsbänder.
  if (beginntAmTourAnfang(info) && !info.nextFrom) {
    return {
      text: 'Abschnitt entfernen',
      gesperrt: true,
      grund:
        'Dieser Zustand deckt die ganze Tour, es gibt keinen zweiten, der seinen Platz einnehmen könnte.',
    }
  }
  return { text: 'Abschnitt entfernen', gesperrt: false }
}

/**
 * Das fokussierte Objekt löschen — Knopf im Fuß oder Backspace/Entf. Bei
 * Zustands-Bändern verschwindet die GRENZE: der vorherige Zustand gilt dann
 * weiter, die Tour bleibt lückenlos gedeckt.
 */
function loescheFokus(): void {
  if (!z) return
  const info = loeseFokusAuf()
  if (!info || loeschInfo(info).gesperrt) return
  // Das vorderste Band geht einen eigenen Weg (s. loescheErstesBand) — und
  // zwar an seiner LAGE erkannt, nicht daran, ob es eine eigene Grenze hat.
  // Nach dem ersten Löschen hat es eine: Sie zu entfernen machte das Band
  // wieder implizit, ohne dass sich sichtbar etwas änderte — man musste
  // zweimal löschen, und der erste Klick sah wie ein Fehlschlag aus.
  if (ZUSTANDS_ARTEN.has(info.kind) && beginntAmTourAnfang(info) && info.nextFrom) {
    loescheErstesBand(info)
    return
  }
  // Beim Modus zählt die Kante, nicht das Band: fällt sie weg, gilt der Modus
  // davor weiter. Für erkannte Kanten muss die Aufteilung erst festgeschrieben
  // sein, sonst gäbe es gar nichts zu entfernen.
  if (info.kind === 'modus' && info.from) {
    if (!schreibeModiFest(info.from)) return
    z.edits = withoutTravelModeBoundary(z.edits, info.from)
  } else if (info.kind === 'kamera' && info.from)
    z.edits = withoutCameraBoundary(z.edits, info.from)
  else if (info.kind === 'wetter' && info.from) {
    // Wie beim Modus: die automatisch ermittelte Einteilung erst festschreiben,
    // sonst löschte man eine Grenze, die im Overlay noch gar nicht steht.
    if (!schreibeWetterFest()) return
    z.edits = withoutWeatherBoundary(z.edits, info.from)
  } else if (info.kind === 'moment' && info.from) z.edits = withoutCameraMoment(z.edits, info.from)
  else if (info.kind === 'audio' && info.index !== undefined)
    z.edits = withoutAudioEntry(z.edits, info.index)
  else if (info.kind === 'medium' && info.id)
    z.edits = withMediaEdit(z.edits, info.id, { removed: true })
  else return
  z.fokus = null
  renderAlles()
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
 * Modus und Wetter müssen vorher festgeschrieben werden (`schreibeModiFest` /
 * `schreibeWetterFest`) — was die Automatik erkannt hat, steht bis dahin gar
 * nicht im Overlay und ließe sich weder verschieben noch entfernen.
 */
function loescheErstesBand(info: EditorSelectionTarget): void {
  if (!z) return
  const alt = info.nextFrom
  if (!alt) return
  const scale = buildScale(z.track)
  if (!scale) return
  // Hat das Band bereits eine eigene Grenze, wird GENAU die überschrieben —
  // sonst bliebe sie als haarfeines Band davor stehen.
  const anfang = info.from ?? offsetToIso(z.daten.time.start, scale.fromS)
  if (info.kind === 'modus') {
    if (!schreibeModiFest(alt)) return
    const mode = z.edits.travelModes?.find((g) => g.from === alt)?.mode
    if (!mode) return
    // `withTravelModeBoundary` ersetzt eine Grenze auf demselben Zeitpunkt — nach dem
    // Festschreiben liegt am Tour-Anfang bereits eine.
    z.edits = withTravelModeBoundary(withoutTravelModeBoundary(z.edits, alt), anfang, mode)
  } else if (info.kind === 'kamera') {
    const g = z.edits.camera?.find((x) => x.from === alt)
    if (!g) return
    z.edits = withCameraBoundary(withoutCameraBoundary(z.edits, alt), anfang, g.preset, g.scale)
  } else if (info.kind === 'wetter') {
    if (!schreibeWetterFest()) return
    const g = z.edits.weather?.find((x) => x.from === alt)
    if (!g) return
    z.edits = withWeatherBoundary(withoutWeatherBoundary(z.edits, alt), anfang, g.mode, g.intensity)
  } else return
  // Nach dem Löschen ist NICHTS ausgewählt — wie bei jedem anderen Objekt.
  // Den Fokus auf das nachrückende Band zu setzen sähe aus, als hätte man
  // etwas ausgewählt, und das Band unter dem Zeiger ist ein anderes als das,
  // das man eben noch anfasste.
  z.fokus = null
  renderAlles()
}

function entfernenKnopf(aktion: () => void): HTMLButtonElement {
  const knopf = document.createElement('button')
  knopf.textContent = 'Entfernen'
  knopf.addEventListener('click', () => {
    aktion()
    renderAlles()
  })
  return knopf
}

function medienAnzeige(): MediaView[] {
  if (!z) return []
  return effectiveMedia(z.daten.media as MediaBase[], z.edits)
}

/** Karte zum Anker fliegen + Marker pulsieren lassen (Liste→Karte-Sync). */
function fliegeZuMedium(m: MediaView): void {
  if (!karte || !m.anchor) return
  karte.flyTo({ center: m.anchor, zoom: Math.max(karte.getZoom(), 15), duration: 700 })
  const el = medienMarker.get(m.id)
  if (el) {
    el.classList.remove('puls')
    void el.offsetWidth // Animation neu starten
    el.classList.add('puls')
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
function messeTonDauern(): void {
  if (!z) return
  const tourId = z.tourId
  let offen = 0
  for (const a of z.edits.audio ?? []) {
    if (tonGemessen.has(a.file)) continue
    tonGemessen.add(a.file)
    offen++
    const el = new Audio()
    el.preload = 'metadata'
    const fertig = (dauer: number | null): void => {
      if (dauer !== null && Number.isFinite(dauer) && dauer > 0) tonDauern.set(a.file, dauer)
      el.removeAttribute('src')
      // Erst wenn ALLE offenen Messungen durch sind, einmal neu zeichnen —
      // je Datei zu rendern hieße bei zehn Klips zehn Neuaufbauten.
      if (--offen === 0 && z) renderZeitleiste()
    }
    el.addEventListener('loadedmetadata', () => fertig(el.duration), { once: true })
    el.addEventListener('error', () => fertig(null), { once: true })
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
const wellenBilder = new Map<string, string | null>()

/** Auflösung des Streifens — 900 Balken reichen für jede Zoomstufe der Leiste. */
const WELLE_BALKEN = 900

/**
 * Wellenform einer Datei besorgen und beim Eintreffen einmal neu zeichnen.
 *
 * Höchstens EIN Versuch je Datei (auch bei Fehlschlag): Ein nicht dekodierbares
 * Format zöge sonst bei jedem Render einen neuen Download nach sich.
 */
function holeWelle(file: string, url: string): string | null {
  const fertig = wellenBilder.get(file)
  if (fertig !== undefined) return fertig
  wellenBilder.set(file, null) // Platzhalter: markiert „läuft/erledigt"
  void (async () => {
    try {
      const roh = await (await fetch(url)).arrayBuffer()
      const ctx = new AudioContext()
      const puffer = await ctx.decodeAudioData(roh)
      void ctx.close()
      wellenBilder.set(file, zeichneWelle(puffer))
    } catch {
      // Kein Web-Audio, kein Netz, unbekanntes Format: der Klip bleibt schlicht.
      wellenBilder.set(file, null)
    }
    if (z) renderZeitleiste()
  })()
  return null
}

/** Spitzenwerte je Balken zu einem PNG-Streifen (transparent + helle Balken). */
function zeichneWelle(puffer: AudioBuffer): string | null {
  const leinwand = document.createElement('canvas')
  leinwand.width = WELLE_BALKEN
  leinwand.height = 44
  const g = leinwand.getContext('2d')
  if (!g) return null
  const daten = puffer.getChannelData(0)
  const proBalken = Math.max(1, Math.floor(daten.length / WELLE_BALKEN))
  g.fillStyle = 'rgba(255, 255, 255, 0.5)'
  for (let i = 0; i < WELLE_BALKEN; i++) {
    let spitze = 0
    const von = i * proBalken
    // Nicht mitteln, sondern die SPITZE nehmen: gemittelt sieht jede Musik aus
    // wie derselbe flache Balken, und man erkennt keinen Einsatz mehr.
    for (let j = von; j < von + proBalken && j < daten.length; j++) {
      const wert = Math.abs(daten[j] as number)
      if (wert > spitze) spitze = wert
    }
    const h = Math.max(1, spitze * leinwand.height)
    g.fillRect(i, (leinwand.height - h) / 2, 1, h)
  }
  return leinwand.toDataURL('image/png')
}

/**
 * Länge einer Ton-Datei besorgen — aus dem Cache oder frisch gemessen.
 *
 * Dieselbe Technik wie `messeTonDauern` (nur der Dateikopf), aber wartend:
 * Beim EINSETZEN muss die Länge vorliegen, bevor der Klip entsteht — sonst
 * müsste er nachträglich zucken.
 */
async function holeTonDauer(a: AudioEntry): Promise<number | null> {
  const bekannt = tonDauern.get(a.file)
  if (bekannt !== undefined) return bekannt
  if (!z) return null
  const url = audioUrl(a, z.tourId)
  return new Promise<number | null>((fertig) => {
    const el = new Audio()
    el.preload = 'metadata'
    const antworte = (dauer: number | null): void => {
      el.removeAttribute('src')
      if (dauer !== null && Number.isFinite(dauer) && dauer > 0) {
        tonDauern.set(a.file, dauer)
        fertig(dauer)
      } else fertig(null)
    }
    el.addEventListener('loadedmetadata', () => antworte(el.duration), { once: true })
    el.addEventListener('error', () => antworte(null), { once: true })
    tonGemessen.add(a.file)
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
async function setzeTonEin(eintrag: AudioEntry): Promise<void> {
  if (!z) return
  // Gemessen wird VOR dem Einfügen: so entsteht genau EIN Overlay-Stand — also
  // ein Undo-Schritt — und der Klip steht sofort in seiner endgültigen Form da,
  // statt kurz nach dem Erscheinen zu zucken.
  const dateiS = eintrag.type === 'music' ? await holeTonDauer(eintrag) : null
  if (!z) return
  const voll: AudioEntry = dateiS
    ? { ...eintrag, loop: false, durationFilmS: Math.round(dateiS * 1000) / 1000 }
    : eintrag
  z.edits = withAudioEntry(z.edits, voll)
  // Auf das Eingesetzte springen — der Inspector zeigte sonst weiter, was vorher
  // ausgewählt war, und man sucht das gerade Hinzugefügte auf der Spur.
  z.fokus = { kind: 'audio', index: (z.edits.audio ?? []).length - 1 }
  renderAlles()
}

/** Einen Audio-Eintrag vorhören (bricht ein laufendes Vorhören ab). */
function starteVorschau(a: AudioEntry): void {
  if (!z) return
  stoppeVorschau()
  // Nie zwei Quellen gleichzeitig: auch ein laufendes Bibliotheks-Vorhören endet.
  if (dialogSpielt) {
    stoppeDialogVorschau()
    baueSfxListe()
  }
  const audio = new Audio(audioUrl(a, z.tourId))
  // Mit der eingestellten Lautstärke des Eintrags — 0.8 ist der Standard, den
  // auch der Regler anzeigt; der Zug am Regler passt sie live an (beiLive).
  audio.volume = a.volume ?? STUDIO_PEGEL_VORGABE
  audio.addEventListener('ended', () => {
    stoppeVorschau()
    renderInspektor()
  })
  void audio
    .play()
    .catch(() => audioStatus('Vorhören blockiert. Einmal in die Seite klicken.', 'fehler'))
  vorschau = { audio, file: a.file }
}

function stoppeVorschau(): void {
  if (!vorschau) return
  vorschau.audio.pause()
  vorschau.audio.removeAttribute('src')
  vorschau.audio.load()
  vorschau = null
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
async function bibliothekHochladen(file: File): Promise<void> {
  if (!z) return
  const endung = file.name.toLowerCase().split('.').pop() ?? ''
  if (!AUDIO_ENDUNGEN.includes(endung)) {
    audioStatus(`Nicht unterstützt: .${endung} (erlaubt: ${AUDIO_ENDUNGEN.join(', ')})`, 'fehler')
    return
  }
  // Dateiname säubern + eindeutig machen (Server verbietet Überschreiben)
  const basis = (
    file.name
      .replace(/\.[^.]+$/, '')
      .replace(/[^A-Za-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'audio'
  ).slice(0, 40)
  const vorhandene = new Set((bibliothek ?? []).map((d) => d.file))
  let name = `${basis}.${endung}`
  for (let n = 2; vorhandene.has(name); n++) name = `${basis}-${n}.${endung}`
  audioStatus(`${file.name} wird hochgeladen …`)
  try {
    await api.uploadLibraryAudio(name, file)
  } catch (fehler) {
    audioStatus((fehler as Error).message, 'fehler')
    return
  }
  bibliothek = [...(bibliothek ?? []), { file: name, size: file.size, usedBy: [] }]
  const dialog = $('sfx-dialog') as HTMLDialogElement
  if (dialog.open) {
    // Im Dialog hochgeladen: in „Eigene" zeigen — einsetzen ist der nächste Klick.
    sfxFilter = 'eigene'
    sfxSuche = ''
    ;($('sfx-suche') as HTMLInputElement).value = ''
    baueSfxTabs()
    baueSfxListe()
    audioStatus(`„${name}" liegt jetzt in deiner Bibliothek.`, 'ok')
    return
  }
  // Aus dem Spur-Menü: direkt als Musik ab der Marke einsetzen (wie bisher).
  const start = z.daten.time.start
  const scale = buildScale(z.track)
  const abOffset = z.auswahl ? z.auswahl[3] : (scale?.fromS ?? 0)
  const parallel = ueberlappteMusik(abOffset, scale?.toS ?? abOffset)
  void setzeTonEin({
    file: name,
    type: 'music',
    from: offsetToIso(start, abOffset),
    source: 'user',
  })
  audioStatus(
    parallel.length
      ? `Hochgeladen und eingesetzt, läuft gleichzeitig mit ${parallel.join(', ')}. Bereiche an den Kanten zurechtziehen, dann Speichern.`
      : 'Hochgeladen und eingesetzt, Art und Bereich im Panel anpassen, dann Speichern.',
    'ok',
  )
  renderAlles()
}

// — Bibliothek „Musik & Effekte" (Dialog) —

let dialogAudio: HTMLAudioElement | null = null
/** Zeilen-ID des gerade vorgehörten Eintrags ('bib:…' | 'eigen:…'). */
let dialogSpielt: string | null = null

function stoppeDialogVorschau(): void {
  dialogAudio?.pause()
  dialogAudio = null
  dialogSpielt = null
}

/**
 * Benutzerweite Bibliothek (eigene Uploads, Kategorie „Eigene") — einmal je
 * Editor-Sitzung geladen, nach Upload/Löschen lokal fortgeschrieben und beim
 * Dialog-Öffnen im Hintergrund aufgefrischt: die Verwendungs-Info (welche Tour
 * nutzt die Datei?) kann sich in anderen Touren geändert haben.
 */
let bibliothek: api.LibraryFile[] | null = null
let bibliothekLaedt = false

async function ladeBibliothek(): Promise<void> {
  if (bibliothekLaedt) return
  bibliothekLaedt = true
  try {
    bibliothek = await api.listLibrary()
  } catch {
    // Kein Netz o. Ä.: „Eigene" zeigt den Leerzustand — die kuratierten
    // Kategorien funktionieren unabhängig davon.
  } finally {
    bibliothekLaedt = false
  }
  if (($('sfx-dialog') as HTMLDialogElement).open) {
    baueSfxTabs()
    baueSfxListe()
  }
}

/**
 * Was ein Klick in der Bibliothek bewirkt: einen NEUEN Eintrag ab der Marke
 * anlegen — oder das STÜCK des fokussierten Eintrags tauschen („Ändern …" im
 * Panel), wobei Platzierung und Lautstärke unangetastet bleiben.
 */
type SfxZiel = { modus: 'einsetzen' } | { modus: 'ersetzen'; index: number }
let sfxZiel: SfxZiel = { modus: 'einsetzen' }

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
 * Namen bestehender Musik-Bereiche, die [vonS, bisS) überlappen. Überlappung
 * ist ERLAUBT (der Player mischt — Musik plus Atmosphäre ist ein gewollter
 * Fall), aber sie soll beim Einsetzen nie stillschweigend entstehen: die
 * Statusmeldung spricht sie aus, die Zeitleiste stapelt die Klips.
 */
function ueberlappteMusik(fromS: number, toS: number): string[] {
  if (!z) return []
  const start = z.daten.time.start
  const endeS = buildScale(z.track)?.toS ?? Infinity
  return (z.edits.audio ?? [])
    .filter((a) => {
      if (a.type !== 'music') return false
      const von = isoToOffset(start, a.from)
      const to = a.to !== undefined ? isoToOffset(start, a.to) : endeS
      return von < toS && fromS < to
    })
    .map((a) => `„${audioName(a)}"`)
}

/** Stück übernehmen: einsetzen oder ersetzen (je nach sfxZiel).
 *  `type` null = Art des bestehenden Eintrags behalten (eigene Dateien legen
 *  sich nicht fest); beim Neu-Einsetzen wird daraus Musik. */
function sfxUebernehmen(
  file: string,
  source: 'library' | 'user',
  type: SfxTyp | null,
  name: string,
): void {
  if (!z) return
  if (sfxZiel.modus === 'ersetzen') {
    const index = sfxZiel.index
    if (!(z.edits.audio ?? [])[index]) return
    z.edits = mitAudioPatch(z.edits, index, type ? { file, source, type } : { file, source })
    z.fokus = { kind: 'audio', index }
    schliesseSfxDialog()
    renderAlles()
    audioStatus(`„${name}" übernommen, Platzierung und Lautstärke bleiben.`, 'ok')
    return
  }
  const start = z.daten.time.start
  const scale = buildScale(z.track)
  // Ist ein Punkt gewählt, dort einsetzen (v. a. für One-Shots gemeint) — sonst
  // ab Tour-Beginn, wie beim Upload.
  const abOffset = z.auswahl ? z.auswahl[3] : (scale?.fromS ?? 0)
  // VOR dem Einfügen prüfen — sonst zählte der neue Eintrag sich selbst.
  const parallel = type !== 'sfx' ? ueberlappteMusik(abOffset, scale?.toS ?? abOffset) : []
  // Der Dialog geht SOFORT zu — die Längenmessung darf ihn nicht offen halten.
  schliesseSfxDialog()
  void setzeTonEin({ file, type: type ?? 'music', from: offsetToIso(start, abOffset), source })
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
type SfxFilter = SfxEffekt['kategorie'] | 'eigene'
let sfxFilter: SfxFilter = 'music'
let sfxSuche = ''

// Was die Art im Film TUT — steht an der Gruppenüberschrift, nicht an jeder
// Zeile: Musik und Atmosphäre schleifen über eine Spanne, ein Effekt spielt
// einmal an seiner Marke.
const KAT_MODUS: Record<SfxFilter, string> = {
  music: 'läuft über einen Bereich',
  umgebung: 'läuft über einen Bereich',
  effekt: 'spielt einmal an seiner Marke',
  eigene: 'einmal hochgeladen, in jeder deiner Touren einsetzbar',
}
const KAT_LABEL: Record<SfxFilter, string> = {
  music: KATEGORIE_NAMEN.music,
  umgebung: KATEGORIE_NAMEN.umgebung,
  effekt: KATEGORIE_NAMEN.effekt,
  eigene: 'Eigene',
}

/** Sekunden als m:ss — für die mitlaufende Zeit beim Vorhören. */
function mmss(s: number): string {
  const ganz = Math.max(0, Math.floor(s))
  return `${Math.floor(ganz / 60)}:${String(ganz % 60).padStart(2, '0')}`
}

/**
 * Fortschritt der laufenden Vorschau in DIE gerade spielende Zeile schreiben —
 * ohne Neubau: die Liste würde sonst viermal je Sekunde neu entstehen (Flackern,
 * verlorener Hover). Gesucht wird jedes Mal frisch, damit auch nach einem
 * Filterwechsel die richtige Zeile bedient wird.
 */
function zeichneSfxFortschritt(): void {
  const zeile = document.querySelector<HTMLElement>('#sfx-inhalt .sfx-zeile.spielt')
  if (!zeile || !dialogAudio) return
  const dauer = Number.isFinite(dialogAudio.duration) ? dialogAudio.duration : 0
  zeile.style.setProperty(
    '--fortschritt',
    dauer > 0 ? String(dialogAudio.currentTime / dauer) : '0',
  )
  const zeit = zeile.querySelector<HTMLElement>('.sfx-zeit')
  if (zeit)
    zeit.textContent =
      dauer > 0
        ? `${mmss(dialogAudio.currentTime)} / ${mmss(dauer)}`
        : mmss(dialogAudio.currentTime)
}

/** Vorhören umschalten (immer nur eines) und die Liste neu zeichnen. */
function sfxVorhoeren(id: string, url: string): void {
  if (dialogSpielt === id) {
    stoppeDialogVorschau()
  } else {
    stoppeDialogVorschau()
    // Läuft hinter dem Dialog noch das Panel-Vorhören, endet es jetzt — zwei
    // Tonquellen übereinander machen das Aussuchen unmöglich.
    if (vorschau) {
      stoppeVorschau()
      renderInspektor()
    }
    dialogAudio = new Audio(url)
    dialogSpielt = id
    dialogAudio.addEventListener('timeupdate', zeichneSfxFortschritt)
    dialogAudio.addEventListener('loadedmetadata', zeichneSfxFortschritt)
    dialogAudio.addEventListener('ended', () => {
      stoppeDialogVorschau()
      baueSfxListe()
    })
    void dialogAudio
      .play()
      .catch(() => sfxStatus('Vorhören blockiert. Einmal in die Seite klicken.', 'fehler'))
  }
  baueSfxListe()
}

/** Aktiven Reiter markieren; bei laufender Suche treten alle zurück
 *  (gesucht wird über die ganze Bibliothek, nicht im Reiter). */
function aktualisiereSfxTabs(): void {
  const sucht = !!sfxSuche.trim()
  $('sfx-tabs').classList.toggle('sucht', sucht)
  for (const tab of $('sfx-tabs').querySelectorAll<HTMLElement>('.sfx-tab')) {
    tab.setAttribute('aria-selected', String(!sucht && tab.dataset['filter'] === sfxFilter))
  }
}

/** Filter-Tabs aufbauen — neu bei jedem Öffnen und nach dem Laden der eigenen
 *  Bibliothek (deren Zähler hängt an der Antwort des Servers). */
function baueSfxTabs(): void {
  const tabs = $('sfx-tabs')
  tabs.innerHTML = ''
  const zahl = (f: SfxFilter): string =>
    f === 'eigene'
      ? bibliothek
        ? String(bibliothek.length)
        : '…'
      : String(SFX_BIBLIOTHEK.filter((e) => e.kategorie === f).length)
  for (const f of ['music', 'umgebung', 'effekt', 'eigene'] as const) {
    const tab = document.createElement('button')
    tab.className = 'sfx-tab'
    tab.type = 'button'
    tab.setAttribute('role', 'tab')
    tab.dataset['filter'] = f
    tab.append(document.createTextNode(KAT_LABEL[f]))
    const anzahl = document.createElement('span')
    anzahl.className = 'z'
    anzahl.textContent = zahl(f)
    tab.appendChild(anzahl)
    tab.addEventListener('click', () => {
      sfxFilter = f
      // Ein Reiter-Klick beendet die Suche — er sagt „zeig mir diese Art".
      if (sfxSuche) {
        sfxSuche = ''
        ;($('sfx-suche') as HTMLInputElement).value = ''
      }
      aktualisiereSfxTabs()
      baueSfxListe()
    })
    tabs.appendChild(tab)
  }
  aktualisiereSfxTabs()
}

/** Ist diese Datei das Stück, das der Ersetzen-Modus gerade tauschen würde? */
function istAktuellesStueck(file: string, source: 'library' | 'user'): boolean {
  if (sfxZiel.modus !== 'ersetzen' || !z) return false
  const eintrag = (z.edits.audio ?? [])[sfxZiel.index]
  return !!eintrag && eintrag.file === file && eintrag.source === source
}

/** Nutzt die AKTUELLE (evtl. ungespeicherte) Sitzung diese eigene Datei? */
function inSitzungEingesetzt(file: string): boolean {
  return (z?.edits.audio ?? []).some((a) => a.source === 'user' && a.file === file)
}

interface SfxZeileDef {
  /** eindeutig über beide Quellen: 'bib:…' bzw. 'eigen:…' */
  id: string
  name: string
  besch: string
  url: string
  file: string
  source: 'library' | 'user'
  /** Katalog-Art; null bei eigenen Dateien (die Art bestimmt der Eintrag) */
  type: SfxTyp | null
  /** rechte Zusatzangabe (Dateigröße eigener Uploads) */
  meta?: string
  /** nur eigene: löschbar — oder der Grund, warum nicht */
  loeschen?: { gesperrtWeil: string | null }
}

/** Eine Zeile der Bibliothek: hören, lesen, übernehmen — eigene auch löschen. */
function baueSfxZeile(def: SfxZeileDef): HTMLElement {
  const spielt = dialogSpielt === def.id
  const aktuell = istAktuellesStueck(def.file, def.source)
  const zeile = document.createElement('div')
  zeile.className = 'sfx-zeile' + (spielt ? ' spielt' : '') + (aktuell ? ' aktuell' : '')
  zeile.dataset['datei'] = def.file

  const hoeren = document.createElement('button')
  hoeren.type = 'button'
  hoeren.className = 'sfx-hoeren'
  hoeren.innerHTML = spielt ? '<span class="halt"></span>' : icon('play')
  hoeren.title = spielt ? 'Vorhören stoppen' : `„${def.name}" vorhören`
  hoeren.setAttribute('aria-label', hoeren.title)
  hoeren.addEventListener('click', () => sfxVorhoeren(def.id, def.url))

  const text = document.createElement('div')
  text.className = 'sfx-text'
  const nm = document.createElement('div')
  nm.className = 'sfx-name'
  nm.textContent = def.name
  if (aktuell) {
    const badge = document.createElement('span')
    badge.className = 'sfx-badge'
    badge.textContent = 'Aktuell'
    nm.appendChild(badge)
  }
  const be = document.createElement('div')
  be.className = 'sfx-besch'
  be.textContent = def.besch
  text.append(nm, be)

  const rechts = document.createElement('div')
  rechts.className = 'sfx-rechts'
  // Die Zeit steht erst, wenn wirklich etwas läuft — die Dauer einer Datei
  // kennen wir nicht, ohne sie zu laden, und Geratenes gehört nicht ins Studio.
  if (spielt) {
    const zeit = document.createElement('span')
    zeit.className = 'sfx-zeit'
    zeit.textContent = '0:00'
    rechts.appendChild(zeit)
  }
  if (def.meta && !spielt) {
    const meta = document.createElement('span')
    meta.className = 'sfx-meta'
    meta.textContent = def.meta
    rechts.appendChild(meta)
  }
  if (!aktuell) {
    const nutzen = document.createElement('button')
    nutzen.type = 'button'
    nutzen.className = 'sfx-einsetzen'
    nutzen.textContent = sfxZiel.modus === 'ersetzen' ? 'Übernehmen' : 'Einsetzen'
    nutzen.title =
      sfxZiel.modus === 'ersetzen'
        ? `Das Stück durch „${def.name}" ersetzen, die Platzierung bleibt`
        : `„${def.name}" ab der Marke einsetzen`
    nutzen.addEventListener('click', () => sfxUebernehmen(def.file, def.source, def.type, def.name))
    rechts.appendChild(nutzen)
  }
  if (def.loeschen) {
    const { gesperrtWeil } = def.loeschen
    const weg = document.createElement('button')
    weg.type = 'button'
    weg.className = 'sfx-loeschen'
    weg.innerHTML = icon('muell')
    if (gesperrtWeil) {
      weg.disabled = true
      weg.title = gesperrtWeil
    } else {
      weg.title = `„${def.name}" endgültig aus der Bibliothek löschen`
      // Zwei-Klick-Schutz: der erste Klick fragt („Löschen?"), erst der zweite
      // löscht wirklich — ein Dialog im Dialog wäre schwerer als die Sache selbst.
      weg.addEventListener('click', () => {
        if (weg.classList.contains('sicher')) {
          void bibliothekLoeschen(def.file)
          return
        }
        weg.classList.add('sicher')
        weg.innerHTML = '<span>Löschen?</span>'
        setTimeout(() => {
          weg.classList.remove('sicher')
          weg.innerHTML = icon('muell')
        }, 3000)
      })
    }
    weg.setAttribute('aria-label', weg.title)
    rechts.appendChild(weg)
  }

  zeile.append(hoeren, text, rechts)
  return zeile
}

async function bibliothekLoeschen(file: string): Promise<void> {
  try {
    await api.deleteLibraryAudio(file)
    bibliothek = (bibliothek ?? []).filter((d) => d.file !== file)
    sfxStatus(`${file} gelöscht.`, 'ok')
  } catch (fehler) {
    sfxStatus((fehler as Error).message, 'fehler')
    // Der Server kennt die Wahrheit (z. B. inzwischen in einer Tour verwendet) —
    // die Verwendungs-Info auffrischen, damit die Sperre sichtbar wird.
    void ladeBibliothek()
  }
  baueSfxTabs()
  baueSfxListe()
}

/** Katalog-Zeilen einer Art, optional nach Suchtext gefiltert. */
function katalogZeilen(kat: SfxEffekt['kategorie'], q: string): SfxZeileDef[] {
  return SFX_BIBLIOTHEK.filter(
    (e) => e.kategorie === kat && (!q || `${e.name} ${e.beschreibung}`.toLowerCase().includes(q)),
  ).map((e) => ({
    id: `bib:${e.file}`,
    name: e.name,
    besch: e.beschreibung,
    url: `/audio/sfx/${encodeURIComponent(e.file)}`,
    file: e.file,
    source: 'library',
    type: e.type,
  }))
}

/** Zeilen der eigenen Uploads, optional nach Suchtext gefiltert. */
function eigeneZeilen(q: string): SfxZeileDef[] {
  return (bibliothek ?? [])
    .filter((d) => !q || d.file.toLowerCase().includes(q))
    .map((d) => {
      const inTouren = d.usedBy.map((t) => `„${t.title}"`).join(', ')
      const ungespeichert = inSitzungEingesetzt(d.file)
      return {
        id: `eigen:${d.file}`,
        name: d.file.replace(/\.[^.]+$/, ''),
        besch: [
          d.file.split('.').pop()?.toUpperCase() ?? '',
          inTouren
            ? `wird verwendet in ${inTouren}`
            : ungespeichert
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
        loeschen: {
          gesperrtWeil: inTouren
            ? `Wird noch verwendet in ${inTouren}, dort erst den Eintrag entfernen`
            : ungespeichert
              ? 'In dieser Tour eingesetzt, erst den Eintrag entfernen'
              : null,
        },
      }
    })
}

/** Gestrichelte Kopfzeile der „Eigene"-Kategorie: neue Datei hochladen. */
function baueUploadZeile(): HTMLElement {
  const knopf = document.createElement('button')
  knopf.type = 'button'
  knopf.className = 'sfx-upload'
  knopf.innerHTML = `${icon('upload')}<span>Audio-Datei hochladen</span><span class="formate">MP3 · M4A · OGG · WAV</span>`
  knopf.addEventListener('click', () => $('e-audio-datei').click())
  return knopf
}

/** Liste nach aktivem Reiter zeichnen — bzw. bei Suche über die ganze Bibliothek. */
function baueSfxListe(): void {
  const inhalt = $('sfx-inhalt')
  inhalt.innerHTML = ''
  const q = sfxSuche.trim().toLowerCase()
  const kategorien: SfxFilter[] = q ? ['music', 'umgebung', 'effekt', 'eigene'] : [sfxFilter]
  let etwasGezeigt = false

  for (const kat of kategorien) {
    const zeilen = kat === 'eigene' ? eigeneZeilen(q) : katalogZeilen(kat, q)
    const eigeneOhneSuche = kat === 'eigene' && !q
    if (!zeilen.length && !eigeneOhneSuche) continue
    etwasGezeigt = true

    const kopf = document.createElement('div')
    kopf.className = 'sfx-gruppe'
    kopf.append(document.createTextNode(kat === 'eigene' ? 'Eigene Uploads' : KATEGORIE_NAMEN[kat]))
    // Was die Art im Film TUT, steckt hinter einem kleinen ⓘ (Hover UND
    // Tastaturfokus) — als Dauertext neben jeder Überschrift war es Rauschen.
    const wie = document.createElement('span')
    wie.className = 'sfx-wie'
    wie.tabIndex = 0
    wie.setAttribute('aria-label', KAT_MODUS[kat])
    wie.innerHTML = `${icon('info')}<span class="sfx-wie-blase" role="tooltip">${KAT_MODUS[kat]}</span>`
    kopf.appendChild(wie)
    inhalt.appendChild(kopf)

    // Der Upload gehört zur Kategorie, nicht in eine Ecke: immer die erste
    // Zeile von „Eigene" — auch (gerade) wenn noch nichts hochgeladen ist.
    if (eigeneOhneSuche) inhalt.appendChild(baueUploadZeile())
    for (const def of zeilen) inhalt.appendChild(baueSfxZeile(def))
    if (eigeneOhneSuche && !zeilen.length) {
      const leer = document.createElement('div')
      leer.className = 'sfx-leer'
      leer.textContent =
        bibliothek === null && bibliothekLaedt
          ? 'Bibliothek wird geladen …'
          : 'Noch keine eigenen Dateien. Was du hochlädst, liegt in deinem Konto und lässt sich in jeder Tour einsetzen.'
      inhalt.appendChild(leer)
    }
  }

  if (!etwasGezeigt) {
    const leer = document.createElement('div')
    leer.className = 'sfx-leer'
    leer.textContent = q ? `Nichts gefunden für „${sfxSuche.trim()}".` : 'Keine Einträge.'
    inhalt.appendChild(leer)
  }
  zeichneSfxFortschritt()
}

function oeffneSfxDialog(ziel: SfxZiel = { modus: 'einsetzen' }): void {
  sfxZiel = ziel
  // Verwendungs-Info kann sich (auch in anderen Touren) geändert haben.
  void ladeBibliothek()
  const unter = $('sfx-unter')
  if (ziel.modus === 'ersetzen' && z) {
    const eintrag = (z.edits.audio ?? [])[ziel.index]
    unter.textContent = eintrag
      ? `Ersetzt „${audioName(eintrag)}", Platzierung und Lautstärke bleiben.`
      : ''
    // Den Reiter dorthin stellen, wo das aktuelle Stück wohnt.
    if (eintrag?.source === 'user') sfxFilter = 'eigene'
    else if (eintrag?.source === 'library')
      sfxFilter = sfxEffekt(eintrag.file)?.kategorie ?? sfxFilter
  } else {
    unter.textContent = 'Vorhören, dann ab der Marke einsetzen'
  }
  const status = $('sfx-status')
  status.textContent = ''
  status.className = 'sfx-status'
  baueSfxTabs()
  baueSfxListe()
  ;($('sfx-dialog') as HTMLDialogElement).showModal()
}

function schliesseSfxDialog(): void {
  stoppeDialogVorschau()
  ;($('sfx-dialog') as HTMLDialogElement).close()
}

function audioEintragEntfernen(index: number): void {
  if (!z) return
  const eintrag = (z.edits.audio ?? [])[index]
  if (!eintrag) return
  if (vorschau?.file === eintrag.file) stoppeVorschau()
  z.edits = withoutAudioEntry(z.edits, index)
  // Die Datei bleibt BEWUSST auf dem Server: das Overlay ist erst beim
  // Speichern persistiert, und ein evtl. schon gerendertes tour.json
  // referenziert sie ggf. noch. Eigene Uploads bleiben ohnehin in der
  // Bibliothek liegen und sind dort löschbar, sobald keine Tour sie nutzt.
  audioStatus(
    eintrag.source === 'user'
      ? 'Eintrag entfernt. Die Datei bleibt in deiner Bibliothek.'
      : eintrag.source === 'library'
        ? 'Eintrag entfernt.'
        : `Eintrag entfernt, ${eintrag.file} bleibt gespeichert.`,
    'ok',
  )
  renderAlles()
}

async function audioDateiLoeschen(file: string, still = false): Promise<void> {
  if (!z) return
  try {
    await api.deleteAudio(z.tourId, file)
    z.daten.audio = (z.daten.audio ?? []).filter((a) => a.file !== file)
    if (!still) audioStatus(`${file} gelöscht.`, 'ok')
  } catch (fehler) {
    if (!still) audioStatus((fehler as Error).message, 'fehler')
  }
  renderAlles()
}

// — Zeitleiste: Bänder, Pins, Medien-Dots, Audio-Spur —

/** Rollen, bei denen ein Zug eine KANTE verschiebt (Cursor „Rand ziehen"). */
const KANTEN_ROLLEN = new Set(['grenze', 'kamera', 'wetter', 'audio-von', 'audio-bis'])
/** Die drei Zustandsbahnen — nur ihre Kanten laufen entkoppelt (s. starteKantenZug). */
const ZUSTANDS_KANTEN = new Set(['grenze', 'kamera', 'wetter'])
/** Die drei Bahnen mit lückenlosen Zustandsbändern (nicht: Klips und Punkte). */
const ZUSTANDS_ARTEN = new Set<EditorSelectionTarget['kind']>(['modus', 'kamera', 'wetter'])

interface ZugZustand {
  rolle: string
  /** Bildschirm-x beim Greifen — Bezug für die Zug-Schwelle. */
  startX: number
  /** Overlay-Identität: ISO-`from` bei Pins, Index bei Audio */
  from?: string
  mode?: TravelMode
  preset?: CameraPreset
  wetterMode?: WeatherMode
  momentArt?: CameraMomentKind
  index?: number
  /** Abstand Cursor↔Balkenanfang beim Greifen (Anteil), für ruckfreies Schieben */
  griffVersatz?: number
  /** Dasselbe in FILMsekunden — Ton-Klips rechnen seit Etappe 4 darin. */
  griffVersatzFilmS?: number
  /** Steht die gezogene Trimm-Kante am Material? Fürs Etikett am Zeiger. */
  amAnschlag?: boolean
  /**
   * Beim pointerdown getroffenes Band. Muss HIER gemerkt werden: nach
   * setPointerCapture zeigt e.target im pointerup auf das Capture-Element
   * (#zeitleiste), nicht mehr auf das Band unter dem Finger.
   */
  fokus?: EditorSelection | null
  bewegt: boolean
}

/** data-Attribute eines Bandes → Fokus-Identität. */
function bandZuFokus(el: HTMLElement | null): EditorSelection | null {
  const kind = el?.dataset['fokus']
  const atS = Number(el?.dataset['bezugs'])
  if (!Number.isFinite(atS)) return null
  if (kind === 'modus') return { kind: 'modus', atS }
  if (kind === 'kamera') return { kind: 'kamera', atS }
  if (kind === 'wetter') return { kind: 'wetter', atS }
  return null
}

let zug: ZugZustand | null = null

/**
 * Anteil 0..1 der Zeitachse an einer Bildschirm-x-Position. Bezug ist das
 * Maßband-Feld: alle Spuren teilen dieselbe Spalte, eine Referenz genügt.
 * Sein Rect ist bereits gescrollt und gezoomt — die Rechnung stimmt in jeder
 * Zoomstufe ohne Zutun.
 */
function spurAnteil(clientX: number): number {
  const bezug = document.getElementById('skala-feld')
  if (!bezug) return 0
  const r = bezug.getBoundingClientRect()
  if (r.width <= 0) return 0
  return Math.max(0, Math.min(1, (clientX - r.left) / r.width))
}

/**
 * Eine LÄNGE als Anteil der Achse — das Gegenstück zu `zeitX` (einer STELLE).
 *
 * Beides muss in `var(--zeit-breite)` gerechnet sein, weil Zoomen die Bahnen
 * nicht neu baut, sondern nur diese Variable fortschreibt. Wer hier Pixel
 * einsetzt, friert das Element auf dem Maßstab des letzten Renders ein.
 */
const zeitBreite = (anteil: number): string => `calc(${anteil.toFixed(6)} * var(--zeit-breite))`

/** x-Position innerhalb von `.spuren` (Namenspalte + Anteil der Zeitachse). */
const zeitX = (anteil: number): string =>
  `calc(var(--spur-x) + ${anteil.toFixed(5)} * var(--zeit-breite))`

/** Prozent der Zeitachse — für Kinder von `.band-reihe`/`.foto-spur`. */
const pos = (anteil: number): string => `${(anteil * 100).toFixed(3)}%`

/** Bahn leeren und zurückgeben (das Gerüst steht statisch in studio.html). */
function spur(id: string): HTMLElement {
  const el = $(id)
  el.innerHTML = ''
  return el
}

/**
 * Das Band UNTER dem Zeiger — nicht bloß das getroffene Element.
 *
 * Die Kante liegt als 9-px-Griff ÜBER dem Band und ist dessen Geschwister, kein
 * Vorfahr: `closest('[data-fokus]')` findet von dort aus nichts, und ein Klick
 * auf die Kante wählte deshalb gar nichts aus (der Cursor sprang auf
 * „Rand ziehen", und nichts geschah). Die Kante ist ein GRIFF, kein eigenes
 * Objekt — wer sie nur antippt, meint das Band darunter.
 */
function bandUnterZeiger(e: PointerEvent): EditorSelection | null {
  const direkt = (e.target as HTMLElement).closest<HTMLElement>('[data-fokus]')
  if (direkt) return bandZuFokus(direkt)
  for (const el of document.elementsFromPoint(e.clientX, e.clientY)) {
    const treffer = (el as HTMLElement).closest?.<HTMLElement>('[data-fokus]')
    if (treffer) return bandZuFokus(treffer)
  }
  return null
}

// — Filmzeit-Achse: EINE Quelle für alle Leisten-Abbildungen —
//
// Position auf der Leiste ∝ Filmzeit (buildTimelineAxis in zeitleiste.ts). Die Achse
// hängt an Overlay und Tourdaten; das Overlay wird immutabel fortgeschrieben,
// deshalb genügt ein Referenzvergleich als Cache-Schlüssel. Der Cache ist
// nötig: renderPlayhead läuft bei jedem Scrub-Frame und darf nicht jedes Mal
// die ganze Zerlegung rechnen. Während eines Foto-Zugs (Overlay bis zum
// Loslassen unverändert) bleibt er warm; Kanten-Züge schreiben das Overlay je
// Move fort und bauen neu — das tat renderZeitleiste vorher genauso.
/** Ton-Klips: Abstand von oben und Höhe einer Unterzeile (Spiegel des CSS). */
const TON_LANE_TOP_PX = 3
const TON_LANE_PX = 24

let achseMemo: {
  edits: EditOverlay
  tourId: string
  achse: TimelineAxis | null
  spiel: FilmCurve | null
} | null = null

/**
 * Alle Halte für die Achse — Aufnahmen-Ketten UND Momente.
 *
 * Bewusst eine Funktion mit Auslass-Parameter: Jeder Zug braucht dieselbe Liste
 * ohne das Objekt, das gerade in der Hand liegt (s. `schluessel` in
 * zeitleiste.ts), und drei Kopien dieser Rechnung liefen garantiert auseinander.
 */
function achsenHalte(media: MediaView[], moments: readonly CameraMoment[]): AxisStop[] {
  if (!z) return []
  const start = z.daten.time.start
  // Halt-Breite = Standzeit aller Aufnahmen des Stopps.
  // `indizes` trägt den Weg zurück zum Stopp: die Achse sortiert nach Zeit und
  // lässt Halte ohne Breite weg, ihr Index ist also nicht der der Stopp-Liste.
  const halte: AxisStop[] = baueStopps(media, z.track, kumStrecke).map((s, i) => {
    // Ein Halt ist die KETTE seiner Aufnahmen, kein Block: nur so lässt sich
    // sagen, welche davon gerade steht. Videos zählen mit ihrer echten Länge
    // (`durationS` aus der Editor-Route), Fotos mit ihrer Standzeit.
    const items = s.items.map((m) => ({
      id: m.id,
      durationS: mediumHoldS(m) + STOP_FADE_OUT_S,
    }))
    return {
      offsetS: s.offsetS,
      breiteS: items.reduce((summe, st) => summe + st.durationS, 0),
      kind: 'aufnahmen',
      indices: [i],
      items,
    }
  })
  // Ein Moment ist grammatikalisch ein HALT: die Kamera bleibt stehen und tut
  // etwas, Filmzeit vergeht. Ohne Achsenbreite fehlten sie in der Leiste
  // vollständig — an der Beispieltour 13,6 unsichtbare Filmsekunden.
  for (const m of moments) {
    halte.push({
      offsetS: isoToOffset(start, m.from),
      breiteS: momentDauerS(m),
      kind: 'moment',
      key: m.from,
    })
  }
  return halte
}

/** Filmzeit eines Moments — ohne eigene Angabe die Vorgabe seiner Art. */
function momentDauerS(m: CameraMoment): number {
  return m.durationS ?? MOMENT_DEFAULT_S[m.kind]
}

function aktuelleAchse(): TimelineAxis | null {
  if (!z) return null
  if (achseMemo && achseMemo.edits === z.edits && achseMemo.tourId === z.tourId)
    return achseMemo.achse
  const scale = buildScale(z.track)
  if (!scale) return null
  const abschnitte = splitForDisplay(
    z.daten.segments as EditorSegment[],
    z.edits,
    z.daten.time.start,
  )
  const achse = buildTimelineAxis(
    abschnitte,
    achsenHalte(medienAnzeige(), z.edits.moments ?? []),
    scale,
  )
  achseMemo = {
    edits: z.edits,
    tourId: z.tourId,
    achse,
    spiel: buildPlaybackCurve(achse, abschnitte),
  }
  return achse
}

/** Abspiel-Filmkurve zur aktuellen Achse (Trim-Plateaus) — aus demselben Cache. */
function aktuelleSpielKurve(): FilmCurve | null {
  if (!aktuelleAchse()) return null
  return achseMemo?.spiel ?? null
}

function renderZeitleiste(): void {
  if (!z) return
  const zone = $('zeitleiste-zone')
  const scale = aktuelleAchse()
  if (!scale) {
    zone.hidden = true
    return
  }
  zone.hidden = false
  const start = z.daten.time.start
  const fokusInfo = loeseFokusAuf()

  // Die Achsenbreite hängt an den DATEN (Filmdauer × Maßstab): eine geänderte
  // Standzeit oder Fortbewegung verlängert den Film und damit die Leiste.
  schreibeZeitBreite()
  renderSkala()

  /**
   * Zustandsband mit Beschriftung — Anfang und Ende sind dieselbe Kante.
   * `kind` macht das Band anklickbar: die Bandmitte dient als Fokus-Bezug
   * (überlebt das Verschieben von Grenzen besser als der Bandanfang).
   */
  const band = (
    kind: 'modus' | 'kamera' | 'wetter',
    von: number,
    to: number,
    text: string,
    farbe?: string,
    /**
     * Beiwert („ 52%", „ ×1.3"): fällt als Erstes weg, wenn das Band eng wird.
     * „Wolkig" allein sagt fast alles — gar nichts zu sagen (der frühere
     * Alles-oder-nichts-Schnitt) ließ Bänder unbeschriftet, obwohl der Name
     * bequem hineingepasst hätte.
     */
    zusatz = '',
  ): HTMLElement => {
    const d = document.createElement('div')
    d.className = 'band'
    d.style.left = pos(von)
    d.style.width = pos(to - von)
    if (farbe) d.style.background = farbe
    d.dataset['fokus'] = kind
    d.dataset['bezugs'] = String(fractionToOffset(scale, (von + to) / 2))
    d.title = text + zusatz
    // Die Beschriftung als EIGENES Feld: `title` tragen manche Bänder als
    // Erklärung („… — automatisch ermittelt"), die nie auf dem Band stehen darf.
    d.dataset['voll'] = text + zusatz
    if (zusatz) d.dataset['kurz'] = text
    const t = document.createElement('span')
    t.textContent = text + zusatz
    d.appendChild(t)
    return d
  }

  /** Ziehbare Bandkante = die Grenze im Overlay (Identität über `from`). */
  const kante = (
    anteil: number,
    rolle: string,
    daten: Record<string, string>,
    titel: string,
  ): HTMLElement => {
    const k = document.createElement('div')
    k.className = 'kante'
    k.style.left = pos(anteil)
    k.dataset['rolle'] = rolle
    for (const [schluessel, wert] of Object.entries(daten)) k.dataset[schluessel] = wert
    k.title = titel
    return k
  }

  /** Ein Band gilt als fokussiert, wenn seine Mitte in der Fokus-Spanne liegt. */
  const istFokus = (kind: string, von: number, to: number): boolean => {
    if (fokusInfo?.kind !== kind) return false
    const mitte = fractionToOffset(scale, (von + to) / 2)
    return mitte >= fokusInfo.fromS && mitte <= fokusInfo.toS
  }

  // — Fortbewegung: Bänder aus der Anzeige-Zerlegung (Segment-Modi + Grenzen) —
  const modusBahn = spur('spur-wege')
  const modusAbschnitte = splitForDisplay(z.daten.segments as EditorSegment[], z.edits, start)
  for (const b of buildBands(modusAbschnitte, scale)) {
    const d = band('modus', b.from, b.to, MODUS_NAMEN[b.mode], MODUS_FARBEN[b.mode])
    if (!b.active) d.classList.add('inaktiv')
    if (istFokus('modus', b.from, b.to)) d.classList.add('fokus')
    modusBahn.appendChild(d)
  }
  // Jeder MODUS-Wechsel ist ein Griff — auch der von der Automatik erkannte.
  // Beim ersten Zug schreibt `materializeTravelModes` die Aufteilung fest; bis
  // dahin ist die Kante nur eine Stelle auf der Achse. Kanten mit gleichem
  // Modus links und rechts bekommen keinen Griff: dort ist nichts zu wechseln.
  // Position = erster Punkt des neuen Abschnitts (bei Overlay-Grenzen zwischen
  // Stützpunkten der interpolierte Grenzpunkt). Identität: Overlay-`from` mit
  // Sekunden-Toleranz, sonst frisch aus der Zeit — muss zu `schreibeModiFest`
  // / `materializeTravelModes` passen.
  for (const [i, a] of modusAbschnitte.entries()) {
    const vorher = modusAbschnitte[i - 1]
    if (!vorher || vorher.mode === a.mode) continue
    const fromS = (a.pts[0] as TrackPoint)[3]
    const from =
      (z.edits.travelModes ?? []).find((g) => Math.abs(isoToOffset(start, g.from) - fromS) < 1)
        ?.from ?? offsetToIso(start, fromS)
    modusBahn.appendChild(
      kante(
        offsetToFraction(scale, fromS),
        'grenze',
        { ab: from, mode: a.mode },
        `${MODUS_NAMEN[a.mode]} ab ${zeitText(from)} Uhr · ziehen zum Verschieben`,
      ),
    )
  }

  // — Kamera: lückenlose Bänder; das Grundband zeigt „Preset des Zuschauers" —
  const kameraBahn = spur('spur-kamera')
  const kameraBaender = buildStateBands<CameraPreset | null>(
    (z.edits.camera ?? []).map((g) => ({ from: g.from, value: g.preset })),
    start,
    scale,
    null,
  )
  for (const b of kameraBaender) {
    // Feinjustierung (falls ≠ 1) an die Beschriftung hängen: „Nah ×1.3"
    const feinSkala =
      b.from !== null ? z.edits.camera?.find((g) => g.from === b.from)?.scale : undefined
    const skalaTxt =
      feinSkala !== undefined && feinSkala !== 1 ? ` ×${String(+feinSkala.toFixed(2))}` : ''
    // Das Grundband (ohne Grenze) und ein gesetztes „Standard" sind derselbe
    // Zustand und sehen deshalb gleich aus — nur der eine hat eine Kante.
    const istStandard = !b.value || b.value === 'default'
    const d = band(
      'kamera',
      b.fromFraction,
      b.toFraction,
      b.value ? PRESET_NAMEN[b.value] : KAMERA_STANDARD,
      b.value ? PRESET_FARBEN[b.value] : undefined,
      skalaTxt,
    )
    // „Standard" ist kein Leerzustand, sondern eine Aussage: hier gilt, was der
    // Zuschauer wählt. Deshalb eine ruhige eigene Fläche statt der Riffelung,
    // die beim Wetter das ehrliche „noch gar nichts ermittelt" bezeichnet.
    if (istStandard) d.title = KAMERA_STANDARD_ERKLAERT
    d.classList.add(istStandard ? 'grund' : 'hell')
    if (istFokus('kamera', b.fromFraction, b.toFraction)) d.classList.add('fokus')
    kameraBahn.appendChild(d)
    if (b.from !== null && b.value) {
      kameraBahn.appendChild(
        kante(
          b.fromFraction,
          'kamera',
          { ab: b.from, preset: b.value },
          `Kamera ${PRESET_NAMEN[b.value]} ab ${zeitText(b.from)} Uhr · ziehen zum Verschieben`,
        ),
      )
    }
  }

  // — Wetter: das TATSÄCHLICHE Wetter der Tour, nicht die Ankündigung, dass es
  //   eins gäbe. Ohne eigene Grenzen sind das die vom Server automatisch
  //   ermittelten (Open-Meteo + Foto-Verfeinerung); der erste Eingriff schreibt
  //   sie fest (schreibeWetterFest). Nur wenn nie gerendert wurde, bleibt das
  //   eine ehrliche Verlegenheit: „Automatisch" —
  const wetterBahn = spur('spur-wetter')
  const wetterGrenzen = anzeigeWetter()
  const eigenes = (z.edits.weather ?? []).length > 0
  const wetterBaender = buildStateBands<WeatherMode | null>(
    wetterGrenzen.map((g) => ({ from: g.from, value: g.mode })),
    start,
    scale,
    wetterGrenzen.length ? 'off' : null,
  )
  for (const b of wetterBaender) {
    const intensity =
      b.from !== null ? wetterGrenzen.find((g) => g.from === b.from)?.intensity : undefined
    const staerkeTxt =
      b.value && b.value !== 'off' && intensity !== undefined
        ? ` ${Math.round(intensity * 100)}%`
        : ''
    const d = band(
      'wetter',
      b.fromFraction,
      b.toFraction,
      b.value ? WETTER_NAMEN[b.value] : 'Automatisch',
      b.value ? WETTER_FARBEN[b.value] : undefined,
      staerkeTxt,
    )
    if (!b.value) d.classList.add('leise')
    else d.classList.add('hell')
    if (!eigenes && b.value) {
      d.title = `${WETTER_NAMEN[b.value]}, automatisch ermittelt (Wetterarchiv, an den Fotos nachgeschärft). Ändern übernimmt die ganze Einteilung.`
    }
    if (istFokus('wetter', b.fromFraction, b.toFraction)) d.classList.add('fokus')
    wetterBahn.appendChild(d)
    if (b.from !== null && b.value) {
      wetterBahn.appendChild(
        kante(
          b.fromFraction,
          'wetter',
          { ab: b.from, wettermode: b.value },
          `Wetter ${WETTER_NAMEN[b.value]} ab ${zeitText(b.from)} Uhr · ziehen zum Verschieben`,
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
  const audioBahn = spur('spur-musik')
  messeTonDauern()
  const tonKlips = resolveAudioClips(z.edits.audio ?? [], start, scale, tonDauern)
  // Überlappende Klips stapeln sich in Unterzeilen — die Bahn wächst mit,
  // damit jeder lesbar und greifbar bleibt (der Player mischt sie).
  audioBahn.closest('.spur')?.setAttribute('style', `--musik-lanes: ${audioLanes(tonKlips)}`)
  const gesamtFilmS = scale.curve?.totalS ?? 0
  for (const k of tonKlips) {
    // Bibliotheks-Einträge tragen ihren KATALOGNAMEN, nicht den Dateinamen:
    // „Aufbruch" sagt, was man hört — „mus-aufbruch.mp3" nur, wo es liegt.
    const eintrag = (z.edits.audio ?? [])[k.index]
    const anzeige = audioName(eintrag ?? { file: k.file, type: k.type, from: start })
    const fokussiert = fokusInfo?.kind === 'audio' && fokusInfo.index === k.index
    const punktfoermig = !(k.filmBis > k.filmVon) || !(gesamtFilmS > 0)
    if (punktfoermig) {
      const pin = document.createElement('div')
      pin.className = 'zl-sfx'
      pin.style.left = pos(filmToFraction(scale, k.filmVon))
      pin.dataset['rolle'] = 'sfx'
      pin.dataset['index'] = String(k.index)
      // Ohne gemessene Datei kennt die Leiste die Länge nicht — deshalb (noch)
      // ein Punkt statt eines Klips, und das sagt der Tooltip auch.
      pin.title = `${anzeige}, Länge noch unbekannt · ziehen zum Verschieben`
      if (fokussiert) pin.classList.add('fokus')
      pin.appendChild(document.createElement('i'))
      audioBahn.appendChild(pin)
      continue
    }
    const klip = document.createElement('div')
    klip.className = k.type === 'sfx' ? 'zl-klip effekt' : 'zl-klip'
    klip.style.top = `${TON_LANE_TOP_PX + k.lane * TON_LANE_PX}px`
    klip.style.left = pos(filmToFraction(scale, k.filmVon))
    klip.style.width = pos(
      Math.max(0.002, filmToFraction(scale, k.filmBis) - filmToFraction(scale, k.filmVon)),
    )
    klip.dataset['rolle'] = 'audio-balken'
    klip.dataset['index'] = String(k.index)
    klip.title =
      `${anzeige} · ${formatFilmTime(k.filmBis - k.filmVon)}` +
      (k.startS > 0 ? ` (ab ${formatFilmTime(k.startS)} der Datei)` : '') +
      ' · ziehen zum Verschieben, Kanten zum Trimmen'
    if (fokussiert) klip.classList.add('fokus')

    // Wellenform: der DATEI-Streifen hinter dem Klip, um den Einstieg nach
    // links geschoben. Beim Trimmen wandert dadurch der Ausschnitt — man sieht,
    // was man wegschneidet. Auf Klipbreite gestaucht sähe jeder Trim wie ein
    // Tempowechsel aus.
    // In ANTEILEN der Achse, nicht in Pixeln: Zoomen baut die Bahnen nicht
    // neu, sondern schreibt nur `--zeit-breite` fort. Feste Pixel blieben auf
    // dem Maßstab des letzten Renders stehen — die Wellenform behielt beim
    // Hineinzoomen ihre Größe und endete weit vor dem Klip.
    const welle = waveformPosition(k, filmGesamtS())
    const bild = eintrag ? holeWelle(k.file, audioUrl(eintrag, z.tourId)) : null
    if (welle && bild) {
      // Eigenes Fenster mit `overflow: hidden`: Der Klip selbst darf nicht
      // clippen, sonst verschwänden die überstehenden Kanten-Griffe und
      // Anfang/Ende wären nicht mehr zu greifen.
      const fenster = document.createElement('span')
      fenster.className = 'welle-fenster'
      const spurEl = document.createElement('span')
      spurEl.className = 'welle'
      const breite = zeitBreite(welle.widthFraction)
      spurEl.style.left = zeitBreite(welle.offsetFraction)
      spurEl.style.width = zeitBreite(welle.widthFraction * welle.repeats)
      spurEl.style.backgroundImage = `url(${bild})`
      spurEl.style.backgroundSize = `${breite} 100%`
      fenster.appendChild(spurEl)
      klip.appendChild(fenster)
    }

    const name = document.createElement('span')
    name.className = 'zl-klip-name'
    name.textContent = anzeige
    klip.appendChild(name)
    if (k.loop) {
      // Loop ist eine EINSTELLUNG im Inspector, auf dem Klip nur ein Zeichen —
      // als Schalter wäre sie eine Ausnahme, die Lautstärke und Dateiwechsel
      // nicht auch bekommen könnten.
      const zeichen = document.createElement('span')
      zeichen.className = 'zl-klip-loop'
      zeichen.textContent = '⟲'
      zeichen.title = 'Wiederholt sich'
      klip.appendChild(zeichen)
    }
    for (const seite of ['von', 'bis'] as const) {
      const griff = document.createElement('div')
      griff.className = `kante ${seite}`
      griff.dataset['rolle'] = `audio-${seite}`
      griff.dataset['index'] = String(k.index)
      klip.appendChild(griff)
    }
    audioBahn.appendChild(klip)
  }

  // — Szenen: je Aufnahme EIN Klip, ein Halt ist ihre Kette —
  renderSzenen(
    scale,
    fokusInfo?.kind === 'medium' ? (fokusInfo.id ?? null) : null,
    fokusInfo?.kind === 'moment' ? (fokusInfo.from ?? null) : null,
  )

  renderPlayhead()
  kuerzeBeschriftungen()
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
//    `kuerzeBeschriftungen` erzwingt ein Layout und läuft im Zug bewusst nicht.
//  • Die Miniatur kommt aus `thumbnailSource` (thumb → src): ohne den Rückfall
//    bliebe jede Tour von vor der Bildaufbereitung ohne Bild.

/** Klip-Elemente je Medien-ID — die Grundlage des Reconcile. */
let klipEls = new Map<string, HTMLElement>()
/** Dasselbe für Momente, geschlüsselt an ihrem `from`. */
let momentEls = new Map<string, HTMLElement>()

function renderSzenen(
  achse: TimelineAxis,
  fokusId: string | null,
  fokusMoment: string | null,
): void {
  const bahn = $('spur-fotos')
  const media = new Map(medienAnzeige().map((m) => [m.id, m] as const))
  const gesamt = achse.curve?.totalS ?? 0
  const naechste = new Map<string, HTMLElement>()
  const naechsteMomente = new Map<string, HTMLElement>()
  if (gesamt > 0) {
    for (const k of buildSceneClips(achse)) {
      const m = media.get(k.id)
      if (!m) continue
      const el = klipEls.get(k.id) ?? baueKlip(m)
      if (el.parentElement !== bahn) bahn.appendChild(el)
      schreibeKlip(el, m, k, gesamt, fokusId === m.id)
      naechste.set(k.id, el)
    }
    // Momente liegen in DERSELBEN Bahn: Ein Moment hält den Film an wie ein
    // Foto — er hat nur kein Bild. Eine eigene Spur dafür unterschiede nach
    // Herkunft statt nach Wirkung (docs §2.0).
    const moments = new Map((z?.edits.moments ?? []).map((m) => [m.from, m] as const))
    for (const halt of achse.stops ?? []) {
      if (halt.kind !== 'moment' || halt.key === undefined) continue
      const m = moments.get(halt.key)
      if (!m) continue
      const el = momentEls.get(m.from) ?? baueMomentKlip(m.from)
      if (el.parentElement !== bahn) bahn.appendChild(el)
      schreibeMomentKlip(el, m, halt, gesamt, fokusMoment === m.from)
      naechsteMomente.set(m.from, el)
    }
  }
  // Was es nicht mehr gibt (Aufnahme gelöscht, Ort entfernt), verschwindet.
  const behalten = new Set<HTMLElement>([...naechste.values(), ...naechsteMomente.values()])
  for (const el of [...bahn.children]) {
    if (!behalten.has(el as HTMLElement)) el.remove()
  }
  klipEls = naechste
  momentEls = naechsteMomente
  renderHaltZone(achse, fokusId)
}

/**
 * Klip-Gerüst eines Moments — dieselbe Bauart wie eine Aufnahme, nur ohne
 * Miniatur: An ihrer Stelle steht ein Muster in Koralle (docs §2.0). Der
 * rechte Griff zieht seine DAUER — bei einer Aufnahme ist das die Standzeit,
 * hier die Zeit, die die Kamera bei ihrer Bewegung verweilt; dieselbe Frage.
 */
function baueMomentKlip(from: string): HTMLElement {
  const klip = document.createElement('button')
  klip.type = 'button'
  klip.className = 'halt-klip moment'
  klip.dataset['rolle'] = 'momentklip'
  klip.dataset['ab'] = from

  const inhalt = document.createElement('span')
  inhalt.className = 'inhalt'
  const zeichen = document.createElement('span')
  zeichen.className = 'm-zeichen'
  const info = document.createElement('span')
  info.className = 'info'
  info.append(document.createElement('b'), document.createElement('small'))
  inhalt.append(zeichen, info)
  klip.appendChild(inhalt)

  const griff = document.createElement('span')
  griff.className = 'griff'
  griff.dataset['rolle'] = 'momentdauer'
  griff.title = 'Dauer ziehen'
  const blase = document.createElement('span')
  blase.className = 'dauer-blase'
  klip.append(griff, blase)
  // Eigene Zeiger-Handler über Fenster-Listener (wie beim Aufnahme-Klip): ein
  // schneller Zug verlöre den schmalen Griff sonst an das Element darunter.
  klip.addEventListener('pointerdown', (ev) => {
    if (!z || ev.button !== 0 || werkzeug !== 'auswahl') return
    const jetzt = klip.dataset['ab'] ?? from
    if ((ev.target as HTMLElement).closest('.griff')) ziehMomentDauer(ev, jetzt)
    else ziehMoment(ev, jetzt)
  })
  return klip
}

/** Lage, Beschriftung und Zustand eines Moment-Klips fortschreiben. */
function schreibeMomentKlip(
  el: HTMLElement,
  m: CameraMoment,
  halt: StopInterval,
  gesamtS: number,
  fokus: boolean,
): void {
  el.dataset['ab'] = m.from
  el.style.left = pos(halt.filmVon / gesamtS)
  el.style.width = pos((halt.filmBis - halt.filmVon) / gesamtS)
  el.classList.toggle('fokus', fokus)
  const dauerText = formatSeconds(momentDauerS(m))
  const zeichen = el.querySelector('.m-zeichen')
  const titel = el.querySelector('.info b')
  const unten = el.querySelector('.info small')
  if (zeichen && zeichen.textContent !== MOMENT_ZEICHEN[m.kind])
    zeichen.textContent = MOMENT_ZEICHEN[m.kind]
  if (titel && titel.textContent !== MOMENT_NAMEN[m.kind]) titel.textContent = MOMENT_NAMEN[m.kind]
  if (unten && unten.textContent !== dauerText) unten.textContent = dauerText
  const blase = el.querySelector('.dauer-blase')
  if (blase && blase.textContent !== dauerText) blase.textContent = dauerText
  el.title = `${MOMENT_NAMEN[m.kind]} bei ${zeitText(m.from)} Uhr · ${dauerText} · die rechte Kante zieht die Dauer`
}

/** Klip-Gerüst einer Aufnahme — einmalig; danach nur noch fortgeschrieben. */
function baueKlip(m: MediaView): HTMLElement {
  const klip = document.createElement('button')
  klip.type = 'button'
  klip.className = 'halt-klip'
  klip.dataset['rolle'] = 'klip'
  klip.dataset['id'] = m.id
  // Wortliste wie bei den Kartenpunkten — `mitMedienId` findet den Klip beim
  // Abspielen darüber (ein Anführungszeichen in der ID zerlegte einen Selektor).
  klip.dataset['ids'] = m.id

  const inhalt = document.createElement('span')
  inhalt.className = 'inhalt'
  const info = document.createElement('span')
  info.className = 'info'
  info.append(document.createElement('b'), document.createElement('small'))
  inhalt.append(bildFeld(m, 'anfang'), info, bildFeld(m, 'ende'))
  klip.appendChild(inhalt)

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
    klip.appendChild(play)
    for (const seite of ['von', 'bis'] as const) {
      const kante = document.createElement('span')
      kante.className = `v-trim ${seite}`
      kante.dataset['rolle'] = 'videotrim'
      kante.dataset['seite'] = seite
      kante.dataset['id'] = m.id
      kante.title = seite === 'von' ? 'Anfang des Videos schneiden' : 'Ende des Videos schneiden'
      klip.appendChild(kante)
    }
    const blase = document.createElement('span')
    blase.className = 'dauer-blase'
    klip.appendChild(blase)
  } else {
    const griff = document.createElement('span')
    griff.className = 'griff'
    griff.dataset['rolle'] = 'standzeit'
    griff.dataset['id'] = m.id
    griff.title = 'Standzeit ziehen'
    const blase = document.createElement('span')
    blase.className = 'dauer-blase'
    klip.append(griff, blase)
  }
  klip.addEventListener('pointerdown', (ev) => klipZeiger(ev, m.id))
  return klip
}

/** Kopf- bzw. Fußminiatur. Ohne Kachel UND ohne Poster bleibt ein Video leer —
 *  ein `img` mit der .mp4 als Quelle zeigte nur das Symbol für „kaputt". */
function bildFeld(m: MediaView, wo: 'anfang' | 'ende'): HTMLElement {
  const feld = document.createElement('span')
  feld.className = `bild ${wo}`
  if (m.type === 'video' && !m.thumb && !m.poster) return feld
  const bild = document.createElement('img')
  bild.src = thumbnailSource(m)
  bild.alt = ''
  bild.loading = 'lazy'
  feld.appendChild(bild)
  return feld
}

/** Lage, Beschriftung und Zustand eines Klips fortschreiben (kein Neubau). */
function schreibeKlip(
  el: HTMLElement,
  m: MediaView,
  k: SceneClip,
  gesamtS: number,
  fokus: boolean,
): void {
  el.style.left = pos(k.filmVon / gesamtS)
  el.style.width = pos((k.filmBis - k.filmVon) / gesamtS)
  // classList statt className: `.zieht` überlebt so den Render mitten im Zug.
  el.classList.toggle('fokus', fokus)
  el.classList.toggle('video', m.type === 'video')
  const durationS = mediumHoldS(m)
  // Getrimmt sagt der ANTEIL mehr als die nackte Zahl (docs §2F).
  const geschnitten = m.type === 'video' ? clampMediaTrim(m.trim, m.durationS ?? 0) : null
  const dauerText =
    m.type === 'video'
      ? geschnitten
        ? `${formatFilmTime(durationS)} von ${formatFilmTime(m.durationS ?? 0)}`
        : `${formatFilmTime(durationS)} Video`
      : formatSeconds(durationS)
  const name = m.caption || (m.type === 'video' ? 'Video' : 'Foto')
  const titel = el.querySelector('.info b')
  const unten = el.querySelector('.info small')
  if (titel && titel.textContent !== name) titel.textContent = name
  if (unten && unten.textContent !== dauerText) unten.textContent = dauerText
  const blase = el.querySelector('.dauer-blase')
  if (blase && blase.textContent !== dauerText) blase.textContent = dauerText
  const kette = k.count > 1 ? ` · Aufnahme ${k.slot + 1} von ${k.count}` : ''
  el.title =
    `${name}, ${uhrzeitKurz(m.takenAt)} Uhr · ${dauerText}${kette}` +
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
function renderHaltZone(achse: TimelineAxis, fokusId: string | null): void {
  document.querySelector('#spuren .halt-zone')?.remove()
  const gesamt = achse.curve?.totalS ?? 0
  if (!fokusId || !(gesamt > 0)) return
  const halt = (achse.stops ?? []).find((h) => h.items?.some((s) => s.id === fokusId))
  if (!halt) return
  const el = document.createElement('div')
  el.className = 'halt-zone'
  el.style.left = zeitX(halt.filmVon / gesamt)
  el.style.width = `calc(${((halt.filmBis - halt.filmVon) / gesamt).toFixed(5)} * var(--zeit-breite))`
  $('spuren').appendChild(el)
}

/** Die Kante liegt IM Klip — ohne diese Weiche verschöbe man, statt zu ziehen. */
function klipZeiger(e: PointerEvent, id: string): void {
  if (!z || e.button !== 0 || werkzeug !== 'auswahl') return
  const trim = (e.target as HTMLElement).closest<HTMLElement>('.v-trim')
  if (trim) ziehVideoTrim(e, id, trim.dataset['seite'] === 'bis' ? 'bis' : 'von')
  else if ((e.target as HTMLElement).closest('.griff')) ziehStandzeit(e, id)
  else ziehKlip(e, id)
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
function ziehVideoTrim(e: PointerEvent, id: string, seite: 'von' | 'bis'): void {
  if (!z) return
  const m = medienAnzeige().find((x) => x.id === id)
  const dateiS = m?.durationS
  if (!m || m.type !== 'video' || !dateiS || !(dateiS > 0)) return
  e.preventDefault()
  e.stopPropagation()
  halteAbspielen()
  const klip = klipEls.get(id)
  klip?.classList.add('zieht', 'zieht-dauer')
  const start = clampMediaTrim(m.trim, dateiS) ?? { fromS: 0, toS: dateiS }
  const massstab = pxProFilmS > 0 ? pxProFilmS : 1
  const startX = e.clientX
  let basisX = 0

  const bewege = (ev: PointerEvent): void => {
    if (!z) return
    if (!basisX) {
      if (Math.abs(ev.clientX - startX) < ZUG_SCHWELLE_PX) return
      basisX = ev.clientX
      einpassen = false
    }
    const delta = (ev.clientX - basisX) / massstab
    // Der Anschlag ist an BEIDEN Kanten das Material: vor den Dateianfang und
    // hinter das Dateiende geht nichts, und zwischen den Kanten bleibt ein Rest.
    const trim =
      seite === 'von'
        ? {
            fromS: Math.max(0, Math.min(start.fromS + delta, start.toS - VIDEO_TRIM_MIN_S)),
            toS: start.toS,
          }
        : {
            fromS: start.fromS,
            toS: Math.min(dateiS, Math.max(start.toS + delta, start.fromS + VIDEO_TRIM_MIN_S)),
          }
    const wirksam = clampMediaTrim(trim, dateiS)
    z.edits = withMediaEdit(z.edits, id, { trim: wirksam ?? undefined })
    renderNachZug()
  }
  const los = (): void => {
    window.removeEventListener('pointermove', bewege)
    window.removeEventListener('pointerup', los)
    klip?.classList.remove('zieht', 'zieht-dauer')
    if (!basisX) return
    unterdrueckeKlick = true
    renderAlles()
  }
  window.addEventListener('pointermove', bewege)
  window.addEventListener('pointerup', los)
}

/**
 * Standzeit am rechten Griff (`display.holdS`).
 *
 * Anders als beim Klip-Zug wird hier LIVE ins Overlay geschrieben: man soll den
 * Film wachsen und alles Spätere nachrücken sehen. Ein Undo-Schritt bleibt es
 * trotzdem — `renderNachZug` schreibt `letzterStand` nicht fort, erst das
 * abschließende `renderAlles` setzt den Punkt (dasselbe Muster wie die
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
function ziehStandzeit(e: PointerEvent, id: string): void {
  if (!z) return
  const m = medienAnzeige().find((x) => x.id === id)
  if (!m || m.type === 'video') return
  e.preventDefault()
  e.stopPropagation()
  halteAbspielen()
  const klip = klipEls.get(id)
  // Eigene Klasse: `.zieht` allein trägt auch der Klip-Zug, und dort wäre eine
  // Standzeit-Blase über dem verschobenen Bild eine Angabe zur falschen Frage.
  klip?.classList.add('zieht', 'zieht-dauer')
  const startDauer = holdS(m.display)
  const massstab = pxProFilmS > 0 ? pxProFilmS : 1
  const startX = e.clientX
  // Erst ab der Schwelle wird aus dem Drücken ein Zug — und die Rechnung setzt
  // DORT an, nicht am Druckpunkt: sonst spränge die Dauer beim Losfahren um
  // die Schwellenbreite (eingepasst sind 4 px schnell eine ganze Sekunde).
  let basisX = 0

  const bewege = (ev: PointerEvent): void => {
    if (!z) return
    if (!basisX) {
      if (Math.abs(ev.clientX - startX) < ZUG_SCHWELLE_PX) return
      basisX = ev.clientX
      einpassen = false
    }
    const dauer = clampHoldS(startDauer + (ev.clientX - basisX) / massstab)
    z.edits = withMediaEdit(z.edits, id, { display: { ...m.display, holdS: dauer } })
    renderNachZug()
  }
  const los = (): void => {
    window.removeEventListener('pointermove', bewege)
    window.removeEventListener('pointerup', los)
    klip?.classList.remove('zieht', 'zieht-dauer')
    if (!basisX) return // nur gedrückt, nicht gezogen: nichts geändert, nichts zu merken
    unterdrueckeKlick = true
    renderAlles()
  }
  window.addEventListener('pointermove', bewege)
  window.addEventListener('pointerup', los)
}

/**
 * Wohin fällt ein gezogenes Objekt? Zeigerweg → Zeit, gerechnet auf einer
 * Zug-Achse OHNE dieses Objekt (sonst tote Zone, s. `schluessel`).
 *
 * Gerechnet wird in FILMSEKUNDEN, nicht in Anteilen: Die Zug-Achse ist um die
 * Breite des ausgelassenen Objekts kürzer, derselbe ANTEIL ist auf ihr also
 * eine andere Zeit — ein 340-px-Zug landete dadurch 11 px neben dem Zeiger.
 * In Filmsekunden stimmt es exakt, denn links des Objekts sind beide Achsen
 * identisch und px sind film-proportional: `filmZug(zielZeit) =
 * filmZug(startZeit) + Zeigerweg`.
 */
function zugZielZeit(
  ziehAchse: TimelineAxis,
  startS: number,
  anteilWeg: number,
  gesamtEchtS: number,
): number {
  const zugGesamt = ziehAchse.curve?.totalS ?? 0
  if (!(zugGesamt > 0)) return startS
  const startFilm = fractionToFilm(ziehAchse, offsetToFraction(ziehAchse, startS))
  return fractionToOffset(ziehAchse, (startFilm + anteilWeg * gesamtEchtS) / zugGesamt)
}

/**
 * Die Dauer eines Moments an seiner rechten Kante ziehen — dieselbe Geste wie
 * die Standzeit einer Aufnahme, nur schreibt sie `moments[].dauerS`.
 *
 * Live geschrieben (renderNachZug): Der Klip behält dabei seine Identität —
 * `from` ändert sich nicht —, das Element überlebt den Render, und die Achse
 * hinter ihm soll ja mitwachsen (die Filmdauer wird länger).
 */
function ziehMomentDauer(e: PointerEvent, from: string): void {
  if (!z) return
  const m = (z.edits.moments ?? []).find((x) => x.from === from)
  if (!m) return
  e.preventDefault()
  e.stopPropagation()
  halteAbspielen()
  const klip = momentEls.get(from)
  klip?.classList.add('zieht', 'zieht-dauer')
  const startDauer = momentDauerS(m)
  const massstab = pxProFilmS > 0 ? pxProFilmS : 1
  const startX = e.clientX
  // Erst ab der Schwelle wird aus dem Drücken ein Zug — und die Rechnung setzt
  // DORT an, sonst spränge die Dauer beim Losfahren um die Schwellenbreite.
  let basisX = 0

  const bewege = (ev: PointerEvent): void => {
    if (!z) return
    if (!basisX) {
      if (Math.abs(ev.clientX - startX) < ZUG_SCHWELLE_PX) return
      basisX = ev.clientX
      einpassen = false
    }
    z.edits = withCameraMoment(
      z.edits,
      from,
      m.kind,
      clampMomentDuration(startDauer + (ev.clientX - basisX) / massstab),
    )
    renderNachZug()
  }
  const los = (): void => {
    window.removeEventListener('pointermove', bewege)
    window.removeEventListener('pointerup', los)
    klip?.classList.remove('zieht', 'zieht-dauer')
    if (!basisX) return
    unterdrueckeKlick = true
    renderAlles()
  }
  window.addEventListener('pointermove', bewege)
  window.addEventListener('pointerup', los)
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
function ziehMoment(e: PointerEvent, from: string): void {
  if (!z) return
  const achse = aktuelleAchse()
  const scale = buildScale(z.track)
  if (!achse?.curve || !scale) return
  const m = (z.edits.moments ?? []).find((x) => x.from === from)
  if (!m) return
  e.preventDefault()
  halteAbspielen()
  const zz = z
  const start = zz.daten.time.start
  const klip = momentEls.get(from)
  const ziehAchse = buildTimelineAxis(
    splitForDisplay(zz.daten.segments as EditorSegment[], zz.edits, start),
    achsenHalte(
      medienAnzeige(),
      (zz.edits.moments ?? []).filter((x) => x.from !== from),
    ),
    scale,
  )
  const gesamt = achse.curve.totalS
  const startS = isoToOffset(start, from)
  const startX = e.clientX
  const startAnteil = spurAnteil(e.clientX)
  let bewegt = false
  let zielS: number | null = null

  const bewege = (ev: PointerEvent): void => {
    if (!bewegt && Math.abs(ev.clientX - startX) < ZUG_SCHWELLE_PX) return
    if (!bewegt) {
      bewegt = true
      klip?.classList.add('zieht')
    }
    const frei = zugZielZeit(ziehAchse, startS, spurAnteil(ev.clientX) - startAnteil, gesamt)
    zielS = Math.max(scale.fromS, Math.min(scale.toS, frei))
    if (klip) klip.style.transform = `translateX(${(ev.clientX - startX).toFixed(1)}px)`
    zeigeZugEtikett(
      ev,
      'ort',
      `${MOMENT_NAMEN[m.kind]} · km ${kmText(metersToOffset(kumStrecke, zz.track, zielS))} · ${uhrzeitKurz(offsetToIso(start, zielS))} Uhr`,
    )
  }

  const los = (): void => {
    window.removeEventListener('pointermove', bewege)
    window.removeEventListener('pointerup', los)
    verbergeZugEtikett()
    if (klip) {
      klip.style.transform = ''
      klip.classList.remove('zieht')
    }
    if (!z) return
    if (!bewegt || zielS === null) {
      // Kein Zug = Klick: auswählen (der Inspector beschreibt den Moment).
      z.fokus = { kind: 'moment', from }
      renderAlles()
      return
    }
    unterdrueckeKlick = true
    const neuAb = verschiebeGrenze('moment', from, zielS)
    z.fokus = { kind: 'moment', from: neuAb ?? from }
    renderAlles()
  }
  window.addEventListener('pointermove', bewege)
  window.addEventListener('pointerup', los)
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
function ziehKlip(e: PointerEvent, id: string): void {
  if (!z) return
  const achse = aktuelleAchse()
  const scale = buildScale(z.track)
  if (!achse?.curve || !scale) return
  const alle = medienAnzeige()
  const m = alle.find((x) => x.id === id)
  const eigenKlip = buildSceneClips(achse).find((k) => k.id === id)
  if (!m || !eigenKlip) return
  e.preventDefault()
  halteAbspielen()
  const gesamt = achse.curve.totalS
  const zz = z
  const stopps = baueStopps(alle, zz.track, kumStrecke)
  const eigenerHalt = achse.stops?.[eigenKlip.stopIndex] ?? null
  const klip = klipEls.get(id)
  const feldEl = document.getElementById('skala-feld')
  // Rückrechnung px → Zeit über eine Achse OHNE die Halte DIESER Aufnahme: auf
  // der echten Achse hat der gezogene Klip selbst Breite, um die Ruhelage läge
  // also eine tote Zone von Sprungbreite, in der der Zeiger die Zeit nicht
  // bewegte. Die Kette der Geschwister bleibt drin — sie steht ja weiter da.
  // Die MOMENTE bleiben drin (sie stehen ja weiter da) — sie fehlten hier, und
  // damit rechnete die Zug-Achse um deren Filmzeit daneben.
  const ziehAchse = buildTimelineAxis(
    splitForDisplay(zz.daten.segments as EditorSegment[], zz.edits, zz.daten.time.start),
    achsenHalte(
      alle.filter((x) => x.id !== id),
      zz.edits.moments ?? [],
    ),
    scale,
  )
  const startX = e.clientX
  const startAnteil = spurAnteil(e.clientX)
  const startS = offsetVon(m)
  let bewegt = false
  let ziel:
    | { kind: 'reihe'; platz: number }
    | { kind: 'ort'; offsetS: number; andocken: Stopp | null }
    | null = null

  const bewege = (ev: PointerEvent): void => {
    if (!bewegt && Math.abs(ev.clientX - startX) < ZUG_SCHWELLE_PX) return
    if (!bewegt) {
      bewegt = true
      klip?.classList.add('zieht')
    }
    const anteil = spurAnteil(ev.clientX)
    const cursorFilm = anteil * gesamt

    // — Reihenfolge — nur innerhalb der Kette, in der der Zug begann
    if (
      eigenerHalt &&
      eigenKlip.count > 1 &&
      cursorFilm >= eigenerHalt.filmVon &&
      cursorFilm <= eigenerHalt.filmBis
    ) {
      const platz = slotInChain(eigenerHalt, cursorFilm)
      ziel = { kind: 'reihe', platz: platz.slot }
      if (klip) klip.style.transform = `translateX(${(ev.clientX - startX).toFixed(1)}px)`
      zeigeEinfuegemarke(platz.filmS / gesamt)
      zeigeZugEtikett(ev, 'reihe', `Reihenfolge · Platz ${platz.slot + 1} von ${eigenKlip.count}`)
      return
    }
    verbergeEinfuegemarke()

    // — Ort — über einem fremden Halt andocken, sonst freie Zeit
    const treffer = stopInnerAt(achse, cursorFilm)
    const fremd = treffer && !treffer.items?.some((s) => s.id === id) ? treffer : null
    const andocken = fremd?.items?.[0] ? (stoppVon(stopps, fremd.items[0].id) ?? null) : null
    const frei = zugZielZeit(ziehAchse, startS, anteil - startAnteil, gesamt)
    const offsetS = andocken ? andocken.offsetS : Math.max(scale.fromS, Math.min(scale.toS, frei))
    ziel = { kind: 'ort', offsetS, andocken }
    if (klip) {
      // Angedockt springt der Klip an das Ende der fremden Kette — dorthin, wo
      // er beim Loslassen liegt. Sonst klebt er pixelgenau unterm Zeiger.
      const breite = feldEl?.getBoundingClientRect().width ?? 0
      klip.style.transform =
        fremd && breite > 0
          ? `translateX(${(((fremd.filmBis - eigenKlip.filmVon) / gesamt) * breite).toFixed(1)}px)`
          : `translateX(${(ev.clientX - startX).toFixed(1)}px)`
    }
    zeigeZugEtikett(
      ev,
      'ort',
      andocken
        ? `An den Halt „${andocken.items[0]?.caption || 'ohne Titel'}" anschließen`
        : `Ort · km ${kmText(metersToOffset(kumStrecke, zz.track, offsetS))} · ${uhrzeitKurz(offsetToIso(zz.daten.time.start, offsetS))} Uhr`,
    )
  }

  const los = (): void => {
    window.removeEventListener('pointermove', bewege)
    window.removeEventListener('pointerup', los)
    verbergeEinfuegemarke()
    verbergeZugEtikett()
    if (klip) {
      klip.style.transform = ''
      klip.classList.remove('zieht')
    }
    if (!z) return
    if (!bewegt || !ziel) {
      // Kein Zug = Klick: auswählen. Erst damit zeigt die Halt-Zone, was
      // zeitlich über diesem Halt liegt.
      z.fokus = { kind: 'medium', id }
      fliegeZuMedium(m)
      renderAlles()
      return
    }
    unterdrueckeKlick = true
    z.fokus = { kind: 'medium', id }
    if (ziel.kind === 'reihe') {
      const kette = (eigenerHalt?.items ?? []).map((s) => s.id)
      const folge = moveToSlot(kette, id, ziel.platz)
      // Zurück auf den eigenen Platz gelegt heißt: nichts ist geschehen.
      // `reiheVergeben` schriebe trotzdem ein neues Overlay — und der
      // Referenzvergleich in renderAlles machte daraus einen leeren
      // Undo-Schritt, den man später einmal umsonst rückgängig macht.
      if (folge.join(' ') !== kette.join(' ')) z.edits = reiheVergeben(z.edits, folge)
      renderAlles()
      return
    }
    if (ziel.andocken) {
      // Andocken heißt: DEN Anker des Zielhalts übernehmen. Über die Zeit
      // gerechnet läge die Aufnahme knapp daneben und der Halt zerfiele wieder.
      const anchor = ziel.andocken.items[0]?.anchor
      if (!anchor) return
      const neu = withMediaEdit(z.edits, id, { anchor: anchor })
      z.edits = reiheVergeben(neu, [...ziel.andocken.items.map((x) => x.id), id])
      renderAlles()
      return
    }
    // Frei abgelegt: nicht ungewollt mit einem Nachbarn clustern (die Achse
    // kann in Metern eng sein, wo sie auf der Leiste weit aussieht). `order`
    // fällt weg — die Aufnahme gehört zu keiner Kette mehr.
    const roh = punktBeiOffset(ziel.offsetS)
    if (!roh) return
    const fremdeMeter = alle
      .filter((x) => x.anchor && !x.removed && x.id !== id)
      .map((x) => metersToOffset(kumStrecke, zz.track, offsetVon(x)))
    const sicherMeter = meterOhneCluster(metersToOffset(kumStrecke, zz.track, roh[3]), fremdeMeter)
    const sicher = pointAtOffset(zz.track, offsetAtMeters(kumStrecke, zz.track, sicherMeter))
    if (!sicher) return
    z.edits = withMediaEdit(z.edits, id, { anchor: [sicher[0], sicher[1]], order: undefined })
    renderAlles()
  }
  window.addEventListener('pointermove', bewege)
  window.addEventListener('pointerup', los)
}

/** Wohin fällt der Klip in seiner Kette? Eine Linie statt eines Neuaufbaus. */
function zeigeEinfuegemarke(anteil: number): void {
  let el = document.querySelector<HTMLElement>('.zl-einfuege')
  if (!el) {
    el = document.createElement('div')
    el.className = 'zl-einfuege'
    $('spuren').appendChild(el)
  }
  el.style.left = zeitX(anteil)
}

function verbergeEinfuegemarke(): void {
  document.querySelector('.zl-einfuege')?.remove()
}

/** Sagt am Zeiger, WAS der Zug gerade bedeutet — nicht erst beim Loslassen. */
function zeigeZugEtikett(ev: PointerEvent, kind: 'reihe' | 'ort', text: string): void {
  let el = document.querySelector<HTMLElement>('.zug-etikett')
  if (!el) {
    el = document.createElement('div')
    el.className = 'zug-etikett'
    document.body.appendChild(el)
  }
  el.dataset['art'] = kind
  el.textContent = text
  el.style.left = `${ev.clientX}px`
  el.style.top = `${ev.clientY}px`
}

function verbergeZugEtikett(): void {
  document.querySelector('.zug-etikett')?.remove()
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
function kuerzeBeschriftungen(): void {
  for (const b of document.querySelectorAll<HTMLElement>('#zeitleiste-zone .band')) {
    const text = b.querySelector('span')
    if (!text) continue
    const voll = b.dataset['voll'] ?? text.textContent ?? ''
    const kurz = b.dataset['kurz']
    if (text.textContent !== voll) text.textContent = voll
    // Ein Pixel Toleranz: Sub-Pixel-Breiten runden sonst grundlos zur Kurzform.
    if (text.scrollWidth <= text.clientWidth + 1) continue
    if (kurz) text.textContent = `${kurz} …`
  }
}

/**
 * Nachmessen, sobald der Maßstab steht — aber höchstens einmal je Bild.
 * Rad- und Pinch-Zoom feuern pro Frame; ein erzwungenes Layout je Ereignis
 * wäre genau die Arbeit, die aus einer flüssigen Geste eine zähe macht.
 */
let kuerzenRaf = 0
function kuerzeBeschriftungenBald(): void {
  if (kuerzenRaf) return
  kuerzenRaf = requestAnimationFrame(() => {
    kuerzenRaf = 0
    kuerzeBeschriftungen()
  })
}

// — Zoom, Abspielkopf und Läufer —
//
// Die Zeitachse ist so breit wie `--zeit-breite` (Pixel, nicht Prozent): nur so
// kann sie über das Fenster hinauswachsen und waagerecht scrollen. Ihre Breite
// ist FILMDAUER × MASSSTAB (`pxProFilmS`) — die gespeicherte Größe ist der
// Maßstab, nicht ein Faktor auf die Fensterbreite. Eingepasst heißt: der
// Maßstab wird aus der Fensterbreite gerechnet; er folgt ihr, bis jemand zoomt.

/** Größter Maßstab, ausgedrückt als Vielfaches des eingepassten. */
const ZOOM_MAX = 40

/** Breite der Zeitachse im eingepassten Zustand: Fenster minus Namenspalte und Auslauf. */
function basisBreitePx(): number {
  const fenster = document.getElementById('spuren-fenster')
  if (!fenster) return 0
  return Math.max(120, fenster.clientWidth - spurXpx() - 26)
}

function spurXpx(): number {
  const wert = getComputedStyle($('editor-view')).getPropertyValue('--spur-x')
  return parseFloat(wert) || 168
}

/** Filmdauer der ganzen Achse (s) — 0, solange es keine Kurve gibt. */
function filmGesamtS(): number {
  return aktuelleAchse()?.curve?.totalS ?? 0
}

/** Maßstab, bei dem der ganze Film genau ins Fenster passt (px je Filmsekunde). */
function passMassstab(): number {
  const gesamt = filmGesamtS()
  return gesamt > 0 ? basisBreitePx() / gesamt : 0
}

function zeitBreitePx(): number {
  const gesamt = filmGesamtS()
  // Ohne Kurve (degenerierte Tour) bleibt es bei der Fensterbreite: dort ist die
  // Leiste linear über der Aufnahmezeit, eine Filmsekunde gibt es gar nicht.
  if (!(gesamt > 0) || !(pxProFilmS > 0)) return basisBreitePx()
  return gesamt * pxProFilmS
}

/** Aktueller Maßstab als Vielfaches des eingepassten — nur noch für die Anzeige. */
function zoomFaktor(): number {
  const pass = passMassstab()
  return pass > 0 && pxProFilmS > 0 ? pxProFilmS / pass : 1
}

/**
 * Maßstab setzen und die Ansicht so scrollen, dass `ankerAnteil` an der
 * Fenster-x `zielVx` stehen bleibt — sonst springt der Blick beim Zoomen
 * irgendwohin. Untergrenze ist „alles im Blick": darunter entstünde nur
 * Leerrand, und genau dort gilt wieder `einpassen`.
 */
function setzeMassstab(neuPxProS: number, ankerAnteil: number, zielVx: number): void {
  const pass = passMassstab()
  if (pass <= 0) {
    schreibeZeitBreite()
    return
  }
  pxProFilmS = Math.max(pass, Math.min(pass * ZOOM_MAX, neuPxProS))
  einpassen = pxProFilmS <= pass * 1.001
  const breite = zeitBreitePx()
  letzteZeitBreite = breite
  $('editor-view').style.setProperty('--zeit-breite', `${breite}px`)
  renderSkala()
  renderPlayhead()
  const fenster = document.getElementById('spuren-fenster')
  if (fenster) fenster.scrollLeft = scrollAnchor(ankerAnteil, breite, zielVx, spurXpx())
  zoomAnzeigen()
  // Breitere Bänder tragen wieder mehr Text — sonst bliebe „Wolkig …" stehen,
  // obwohl nach dem Hineinzoomen längst „Wolkig 52%" hineinpasst.
  kuerzeBeschriftungenBald()
}

/**
 * Breite und Zoomanzeige an den aktuellen Stand angleichen — ohne zu scrollen.
 *
 * Nötig, weil die Achsenbreite jetzt von den DATEN abhängt (Filmdauer × Maßstab):
 * wird eine Standzeit oder ein Modus geändert, wächst die Leiste. Im
 * eingepassten Zustand wird der Maßstab dabei neu gerechnet, sonst bleibt er
 * stehen — das ist die ganze Pointe des festen Maßstabs.
 */
let letzteZeitBreite = -1
function schreibeZeitBreite(): void {
  const pass = passMassstab()
  if (pass > 0 && (einpassen || !(pxProFilmS > 0))) pxProFilmS = pass
  const breite = zeitBreitePx()
  // Letzter-Wert-Vergleich: Die Funktion läuft in JEDEM Zug-Frame (über
  // renderZeitleiste). Ohne ihn schriebe sie pro Frame CSS-Variable, Regler und
  // Knopfbeschriftung neu — Arbeit, die während eines Zugs bewusst unterbleibt.
  if (Math.abs(breite - letzteZeitBreite) < 0.01) return
  letzteZeitBreite = breite
  $('editor-view').style.setProperty('--zeit-breite', `${breite}px`)
  zoomAnzeigen()
}

function zoomAnzeigen(): void {
  const faktor = zoomFaktor()
  const regler = document.getElementById('zoom-regler') as HTMLInputElement | null
  if (regler) regler.value = String(Math.round((Math.log(faktor) / Math.log(ZOOM_MAX)) * 100))
  const wert = document.getElementById('zoom-wert') as HTMLButtonElement | null
  if (wert) {
    wert.textContent = `${faktor.toFixed(1).replace('.', ',')}×`
    wert.disabled = einpassen
  }
  const raus = document.getElementById('zoom-raus') as HTMLButtonElement | null
  if (raus) raus.disabled = einpassen
  const rein = document.getElementById('zoom-rein') as HTMLButtonElement | null
  if (rein) rein.disabled = faktor >= ZOOM_MAX - 0.001
}

/**
 * Nach Größenänderungen des Fensters. Eingepasst folgt der Maßstab der neuen
 * Breite; ist er eingefroren, bleibt er — dann wandert nur der Ausschnitt, und
 * die Filmsekunde unter einer Pixelstelle ändert sich nicht.
 */
/** Ganzen Film ins Fenster holen (⇧Z, „×"-Knopf, Start) — der Grundzustand. */
function passeEin(): void {
  einpassen = true
  setzeMassstab(passMassstab(), 0, spurXpx())
}

function passeZeitBreiteAn(): void {
  if (!z) return
  const fenster = document.getElementById('spuren-fenster')
  const anchor =
    fenster && fenster.clientWidth > 0
      ? (fenster.scrollLeft + spurXpx()) / Math.max(1, zeitBreitePx())
      : 0
  if (einpassen) {
    setzeMassstab(passMassstab(), 0, spurXpx())
    return
  }
  setzeMassstab(pxProFilmS, Math.max(0, Math.min(1, anchor)), spurXpx())
}

// — Der Abspielkopf steht in FILMsekunden —
//
// `kopfFilmS` ist die eine Wahrheit für Scrubben, Klick, Pfeiltasten und
// Abspielen. Die Aufnahmezeit (`z.auswahl`, zugleich Einfügemarke für „ab
// hier"-Aktionen) wird daraus ABGELEITET, nie umgekehrt: In Aufnahmezeit gibt
// es keinen Wert für „mitten im Halt" (zwei Stützstellen auf derselben
// Sekunde), die Rückrechnung fällt dort immer auf die linke Haltkante. Genau
// daran klebte der Kopf — 28 von 39 Frames Stillstand, und mit Pfeiltasten kam
// man an einem 6-s-Halt nie vorbei (docs/architecture/zeitleiste-umbau.md §1).

/** Position des Abspielkopfs in Filmsekunden; null = noch keine. */
let kopfFilmS: number | null = null

/**
 * Der Abspielkopf ist die Einfügemarke `z.auswahl` — eine Größe, nicht zwei:
 * was man anpeilt, ist auch die Stelle, ab der „ab hier"-Aktionen greifen.
 *
 * Diesen Weg nehmen die Gesten, die einen ORT meinen (Klick auf die Karte, ein
 * Zeitfeld): eine Aufnahmezeit trifft den ANFANG eines Halts, was dort richtig
 * ist. Alles, was eine Stelle auf der LEISTE meint, geht über `setzeKopfFilm`.
 */
function setzeMarke(tOffsetS: number): void {
  if (!z) return
  const scale = buildScale(z.track)
  if (!scale) return
  const geklemmt = Math.max(scale.fromS, Math.min(scale.toS, tOffsetS))
  const achse = aktuelleAchse()
  kopfFilmS = achse?.curve ? filmToOffset(achse, geklemmt) : null
  const punkt = pointAtOffset(z.track, geklemmt)
  if (punkt) z.auswahl = punkt
  renderPlayhead()
}

/** Den Kopf auf eine FILMsekunde stellen — der führende Weg. */
function setzeKopfFilm(filmS: number): void {
  if (!z) return
  const achse = aktuelleAchse()
  if (!achse?.curve) return
  kopfFilmS = Math.max(0, Math.min(achse.curve.totalS, filmS))
  leiteMarkeAusKopfAb(achse)
  renderPlayhead()
}

/** Aufnahmezeit (und damit `z.auswahl`) aus der Kopf-Filmsekunde nachziehen. */
function leiteMarkeAusKopfAb(achse: TimelineAxis): void {
  if (!z || kopfFilmS === null) return
  const punkt = pointAtOffset(z.track, fractionToOffset(achse, filmToFraction(achse, kopfFilmS)))
  if (punkt) z.auswahl = punkt
}

/** Aktuelle Kopf-Filmsekunde (0, solange keine gesetzt ist). */
function kopfFilm(): number {
  return kopfFilmS ?? 0
}

/**
 * Der Abspielkopf liegt ÜBER der klebenden Namensspalte — sonst steckte an
 * Position 0 seine linke Hälfte darunter. Damit er beim Scrollen nicht auf den
 * Spurnamen kleben bleibt, wird er ausgeblendet, sobald er hinter die Spalte
 * gewandert ist. Am Achsenanfang (nichts gescrollt) darf er überstehen: dort
 * gehört er hin, und die Spalte endet genau an seiner Mitte.
 */
function zeigeKopfWennImBlick(): void {
  const strich = document.getElementById('kopfstrich')
  const fenster = document.getElementById('spuren-fenster')
  if (!strich || !fenster || strich.hidden) return
  // Gemessen statt gerechnet: `left` steht als calc() aus CSS-Variablen da.
  const x = strich.getBoundingClientRect().left - fenster.getBoundingClientRect().left
  strich.classList.toggle('verdeckt', x < spurXpx() - 7)
}

/**
 * Kopfstrich, Kopf-Uhr und Läufer auf die aktuelle Marke stellen.
 *
 * Gezeichnet wird aus `kopfFilmS` — nicht aus der Aufnahmezeit. Nur so wandert
 * der Strich durch einen Halt-Sprung: dort steht die Aufnahmezeit still, und
 * der Rundweg Zeit → Anteil fiele die ganze Standzeit auf den Sprunganfang
 * zurück. Uhr, km und Läufer dürfen dagegen auf der Halt-Zeit stehen — die Zeit
 * STEHT dort wirklich.
 */
function renderPlayhead(): void {
  if (!z) return
  const strich = document.getElementById('kopfstrich')
  const achse = aktuelleAchse()
  if (!strich || !achse) return
  if (kopfFilmS === null && z.auswahl)
    kopfFilmS = achse.curve ? filmToOffset(achse, z.auswahl[3]) : 0
  if (kopfFilmS === null) {
    strich.hidden = true
    return
  }
  strich.hidden = false
  // Die Achse kann sich geändert haben (Standzeit, Fortbewegung) — die
  // Filmsekunde bleibt, die Aufnahmezeit darunter wird nachgezogen.
  if (achse.curve) kopfFilmS = Math.min(kopfFilmS, achse.curve.totalS)
  leiteMarkeAusKopfAb(achse)
  const anteil = achse.curve
    ? filmToFraction(achse, kopfFilmS)
    : offsetToFraction(achse, z.auswahl?.[3] ?? 0)
  const tOffsetS = z.auswahl?.[3] ?? achse.fromS
  strich.style.left = zeitX(anteil)
  zeigeKopfWennImBlick()

  // Filmzeit prominent: wo im FILM steht die Marke, und wie lang ist er? Die
  // Spielkurve respektiert Trim — bei getrimmten Alt-Touren weicht die Summe
  // deshalb vom Maßband-Ende ab (das die ganze Achse beschriftet).
  const film = document.getElementById('kopf-film')
  const filmGes = document.getElementById('kopf-film-ges')
  const spiel = aktuelleSpielKurve()
  if (film && spiel) film.textContent = formatFilmTime(filmAt(spiel, anteil))
  // Kein „~" mehr vor der Gesamtdauer: Es stand an genau EINER Stelle, während
  // dieselbe Zahl im Maßband, in der Dauer-Vorschau eines Zugs und in jedem
  // Klip ohne Vorbehalt auftritt. Ein Zeichen, das nur hier zweifelt, wirkt
  // wie ein Fehler und nicht wie eine Angabe zur Genauigkeit — die steht im
  // Titel der Gruppe, wo man sie liest, wenn man sie braucht.
  if (filmGes && spiel) filmGes.textContent = formatFilmTime(spiel.totalS)
  // Der laufende Wert reserviert genau so viel, wie der Gesamtwert braucht:
  // Länger als der Film kann der Kopf nicht stehen. Eine feste Reserve am
  // ganzen Block war für kurze Touren rund 30 px zu groß und sammelte sich
  // vollständig rechts; eine zu kleine ließe die Nachbarn bei 9:59 → 10:00
  // springen. `ch` genügt hier, weil tabular-nums alle Ziffern gleich breit
  // macht und der Doppelpunkt in beiden Werten an derselben Stelle steht.
  if (film && filmGes) film.style.minWidth = `${filmGes.textContent.length}ch`
  const uhr = document.getElementById('kopf-uhr')
  // Ohne Sekunden: die Anzeige läuft beim Scrubben mit, da zappelt eine
  // Sekundenstelle nur.
  const zeitIso = offsetToIso(z.daten.time.start, tOffsetS)
  if (uhr) uhr.textContent = uhrzeitKurz(zeitIso)
  zeigeTageszeit(zeitIso)
  // Was die Uhr als Symbol andeutet, zeigt die Karte als Licht — dieselbe
  // Kopfposition, zwei Auflösungen derselben Auskunft.
  synchronisiereStimmung(zeitIso)
  const km = document.getElementById('kopf-km')
  if (km) km.textContent = kmText(metersToOffset(kumStrecke, z.track, tOffsetS))

  setzeLaeufer(tOffsetS)
  synchronisiereFoto()
  // Die Karte folgt dem KOPF, nicht dem Abspieler. Vorher hing `folgeKarte`
  // allein an `setzeMarkeAnteil`, also am laufenden Film — beim Scrubben,
  // Klicken oder mit den Pfeiltasten blieb die Karte stehen, obwohl der
  // Schalter „Karte folgt der Position" heißt und die Position sich sehr wohl
  // bewegte. Hier steht dieselbe Regel wie beim eingeblendeten Foto: eine
  // FUNKTION der Kopfposition, aufgerufen an der einen Stelle, durch die jede
  // Kopfbewegung läuft.
  folgeKarte()
}

/**
 * Sonne · Dämmerung · Mond an der Uhrzeit des Abspielkopfs.
 *
 * Eine Andeutung, keine Astronomie: Grenzen nach Stunden statt nach echtem
 * Sonnenstand — der hinge an Datum UND Breitengrad, und für ein 14-px-Symbol
 * neben einer Uhrzeit wäre das eine Genauigkeit, die niemand abliest. Was es
 * leistet, ist der schnelle Blick: „diese Aufnahme war nachts".
 */
function zeigeTageszeit(iso: string): void {
  const el = document.getElementById('kopf-uhr-icon')
  if (!el) return
  const stunde = Number(uhrzeitKurz(iso).slice(0, 2))
  const [klasse, symbol] = !Number.isFinite(stunde)
    ? ['', '#i-uhr']
    : stunde >= 8 && stunde < 18
      ? ['tag', '#i-sonne']
      : stunde >= 6 && stunde < 21
        ? ['daemmerung', '#i-daemmerung']
        : ['nacht', '#i-mond']
  // classList, NICHT className: Letzteres nimmt `ku-icon` mit weg — und mit ihr
  // Größe und Grundfarbe des Symbols.
  el.classList.remove('tag', 'daemmerung', 'nacht')
  if (klasse) el.classList.add(klasse)
  const use = el.querySelector('use')
  if (use && use.getAttribute('href') !== symbol) use.setAttribute('href', symbol)
}

// — Stimmung und Wetter auf der Karte (Konzept §10) —

let stimmung: Kartenstimmung | null = null

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
const STIMMUNG_VORGABE = { tagNacht: true, weather: false }
const STIMMUNG_SCHLUESSEL = 'maptale.editor.stimmung'

function liesStimmungWahl(): { tagNacht: boolean; weather: boolean } {
  try {
    const roh = localStorage.getItem(STIMMUNG_SCHLUESSEL)
    if (!roh) return { ...STIMMUNG_VORGABE }
    const w = JSON.parse(roh) as Partial<typeof STIMMUNG_VORGABE>
    return {
      tagNacht: typeof w.tagNacht === 'boolean' ? w.tagNacht : STIMMUNG_VORGABE.tagNacht,
      weather: typeof w.weather === 'boolean' ? w.weather : STIMMUNG_VORGABE.weather,
    }
  } catch {
    // Privater Modus, volles Kontingent, kaputter Eintrag — die Vorgabe trägt.
    return { ...STIMMUNG_VORGABE }
  }
}

function merkeStimmungWahl(): void {
  if (!stimmung) return
  try {
    localStorage.setItem(
      STIMMUNG_SCHLUESSEL,
      JSON.stringify({ tagNacht: stimmung.tagNachtAn, weather: stimmung.wetterAn }),
    )
  } catch {
    /* nicht schreiben zu können ist kein Grund, die Ansicht nicht zu ändern */
  }
}

function baueStimmung(k: maplibregl.Map): void {
  const buehne = document.querySelector<HTMLElement>('.karten-buehne')
  if (!buehne) return
  // Kein Gate mehr: Das Konzept sah eines vor, weil es mit dem Partikel-Overlay
  // rechnete — eine rAF-Schleife, die man während eines Zugs anhalten muss, um
  // das gemessene 5,5-ms-Ziehbudget zu halten. Die Stimmung läuft stattdessen
  // ganz ohne Schleife: zwei Farbflächen und vier Paint-Werte, gesetzt nur bei
  // echter Änderung. Was nichts kostet, muss man nicht anhalten.
  stimmung = erzeugeKartenstimmung(k, 'sat', buehne)
  const wahl = liesStimmungWahl()
  stimmung.setTagNacht(wahl.tagNacht)
  stimmung.setWetter(wahl.weather)
  zeigeStimmungWahl()
}

/**
 * Die Leinwand der Foto-Karte über die Bühne legen.
 *
 * Sie liegt ÜBER dem Schleier (`.karten-buehne::after`, z-index 2) und unter dem
 * Panel-Beiwerk — dieselbe Schichtung wie im Player, wo der Schleier auf 11 und
 * die Leinwand auf 12 liegt. Er bleibt DOM, weil `backdrop-filter` auf einer
 * Leinwand kein Gegenstück hat (Karten-Konzept §4).
 */
function baueKartenSchicht(): void {
  const buehne = document.querySelector<HTMLElement>('.karten-buehne')
  if (!buehne || kartenSchicht) return
  // Der Schleier ist das `::after` DIESER Bühne — beschriftet wird deshalb sie
  // selbst (`--schleier-sicht`), ein Pseudo-Element nimmt keine Inline-Stile.
  kartenSchicht = createKartenSchicht({
    container: buehne,
    buehne: 'editor',
    id: 'foto-karte',
    schleier: buehne,
  })
}

/** Schalterstellungen und den Knopf-Zustand an die Oberfläche schreiben. */
function zeigeStimmungWahl(): void {
  const tag = document.getElementById('stimmung-tagnacht') as HTMLInputElement | null
  const wet = document.getElementById('stimmung-wetter') as HTMLInputElement | null
  if (tag) tag.checked = stimmung?.tagNachtAn ?? STIMMUNG_VORGABE.tagNacht
  if (wet) wet.checked = stimmung?.wetterAn ?? STIMMUNG_VORGABE.weather
  // Der Knopf trägt die Akzentfarbe, sobald irgendetwas eingeschaltet ist —
  // sonst wäre bei geschlossenem Panel nicht zu sehen, woher eine nächtlich
  // abgedunkelte Karte kommt.
  document
    .getElementById('karte-stimmung')
    ?.classList.toggle('an', !!(stimmung?.tagNachtAn || stimmung?.wetterAn))
}

function verdrahteStimmung(): void {
  const knopf = $('karte-stimmung')
  const panel = $('stimmung-panel')
  const zu = (): void => {
    panel.hidden = true
    knopf.setAttribute('aria-expanded', 'false')
  }
  knopf.addEventListener('click', (e) => {
    e.stopPropagation()
    const offen = panel.hidden
    panel.hidden = !offen
    knopf.setAttribute('aria-expanded', String(offen))
    if (offen) zeigeStimmungWahl()
  })
  // Klick daneben schließt — aber nicht der Klick IM Panel, sonst ginge es bei
  // jedem Umlegen eines Schalters zu.
  document.addEventListener('click', (e) => {
    if (panel.hidden) return
    if (e.target instanceof Node && (panel.contains(e.target) || knopf.contains(e.target))) return
    zu()
  })
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) zu()
  })
  $('stimmung-tagnacht').addEventListener('change', (e) => {
    stimmung?.setTagNacht((e.target as HTMLInputElement).checked)
    merkeStimmungWahl()
    zeigeStimmungWahl()
  })
  $('stimmung-wetter').addEventListener('change', (e) => {
    stimmung?.setWetter((e.target as HTMLInputElement).checked)
    merkeStimmungWahl()
    zeigeStimmungWahl()
  })
}

/**
 * Die Stimmung an der Kopfposition nachziehen.
 *
 * Aufgerufen aus `renderPlayhead` — dieselbe Stelle wie das eingeblendete Foto
 * und die Kartenmitte, und aus demselben Grund: Was die Karte zeigt, ist eine
 * FUNKTION der Kopfposition und kein Ereignis. Das Wetter kommt aus
 * `anzeigeWetter()`, also aus den eigenen Grenzen, sonst aus dem Auto-Wetter
 * des Servers — genau das, was die Wetter-Bahn darunter zeichnet.
 */
function synchronisiereStimmung(zeitIso: string): void {
  if (!stimmung || !z?.auswahl) return
  // `anzeigeWetter()` ist genau die Liste, die die Wetter-Bahn zeichnet: eigene
  // Grenzen, sonst das Auto-Wetter des Servers. Die Karte zeigt damit dasselbe,
  // was in der Leiste steht — und nicht eine zweite Wahrheit daneben.
  const gilt = weatherAtTime(anzeigeWetter(), zeitIso)
  stimmung.setze(zeitIso, [z.auswahl[0], z.auswahl[1]], gilt)
}

const kmText = (meter: number): string => (meter / 1000).toFixed(1).replace('.', ',')

/** Uhrzeit ohne Sekunden, in der Zone der Tour. */
function uhrzeitKurz(iso: string): string {
  if (!z) return iso
  try {
    return new Intl.DateTimeFormat('de-DE', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: z.daten.time.zone,
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
function setzeLaeufer(tOffsetS: number): void {
  if (!z || !karte) return
  const punkt = pointAtOffset(z.track, tOffsetS)
  if (!punkt) return
  if (!laeufer) {
    const el = document.createElement('div')
    el.className = 'laeufer'
    el.innerHTML = `<span class="puls"></span><span class="puck">${icon('m-walk')}</span>`
    laeufer = new maplibregl.Marker({ element: el, subpixelPositioning: true })
      .setLngLat([punkt[0], punkt[1]])
      .addTo(karte)
  } else {
    laeufer.setLngLat([punkt[0], punkt[1]])
  }
  const abschnitte = splitForDisplay(
    z.daten.segments as EditorSegment[],
    z.edits,
    z.daten.time.start,
  )
  const treffer = abschnitte.find((a) => {
    const erster = a.pts[0] as TrackPoint
    const letzter = a.pts[a.pts.length - 1] as TrackPoint
    return tOffsetS >= erster[3] && tOffsetS <= letzter[3]
  })
  const zeichen = `#i-m-${treffer?.mode ?? 'walk'}`
  const use = laeufer.getElement().querySelector('.puck use')
  // Nur bei echtem Wechsel setzen — ein neu gesetztes href lässt das <use> flackern.
  if (use && use.getAttribute('href') !== zeichen) use.setAttribute('href', zeichen)
}

/** Maßband: Filmminuten, Stufe folgt dem Zoom, damit die Achse lesbar bleibt. */
function renderSkala(): void {
  if (!z) return
  const feld = document.getElementById('skala-feld')
  const achse = aktuelleAchse()
  if (!feld || !achse) return
  feld.innerHTML = ''
  const breitePx = zeitBreitePx()
  const gesamtS = achse.curve?.totalS
  if (breitePx <= 0 || !gesamtS) return
  for (const m of buildFilmRuler(achse, breitePx / gesamtS)) {
    const d = document.createElement('div')
    d.className = 'skala-marke' + (m.full ? ' voll' : '') + (m.edge ? ` am-${m.edge}` : '')
    d.style.left = pos(m.fraction)
    d.append(m.text, document.createElement('i'))
    feld.appendChild(d)
  }
}

/** Während eines Zugs nur die betroffenen Teile neu zeichnen (Karte + Leiste). */
function renderNachZug(): void {
  zeichneTrack()
  renderZeitleiste()
  renderInspektor()
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
function schreibeModiFest(from: string): boolean {
  if (!z) return false
  if (z.edits.travelModes?.some((g) => g.from === from)) return true
  const fest = materializeTravelModes(
    z.edits,
    z.daten.segments as EditorSegment[],
    z.daten.time.start,
  )
  if (!fest.travelModes?.some((g) => g.from === from)) return false
  z.edits = fest
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
function schreibeWetterFest(): boolean {
  if (!z) return false
  if ((z.edits.weather ?? []).length) return true
  const auto = autoWetterGrenzen()
  if (!auto.length) return false
  z.edits = { ...z.edits, weather: auto }
  return true
}

/** Vom Server automatisch ermitteltes Wetter, auf gültige Modi gefiltert. */
function autoWetterGrenzen(): Array<{ from: string; mode: WeatherMode; intensity?: number }> {
  return (z?.daten.autoWeather ?? [])
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
function anzeigeWetter(): Array<{ from: string; mode: WeatherMode; intensity?: number }> {
  const eigene = z?.edits.weather
  return eigene?.length ? eigene : autoWetterGrenzen()
}

/**
 * Overlay-Sicht für die ANZEIGE: wie `z.edits`, aber mit dem geltenden Wetter
 * gefüllt. So sehen Bänder, Kanten und Inspector dasselbe, ohne dass das
 * Festschreiben schon beim bloßen Ansehen passieren müsste.
 */
function editsFuerAnzeige(): EditOverlay {
  if (!z) return EMPTY_OVERLAY
  if ((z.edits.weather ?? []).length) return z.edits
  const auto = autoWetterGrenzen()
  return auto.length ? { ...z.edits, weather: auto } : z.edits
}

function verschiebeGrenze(
  kind: 'modus' | 'kamera' | 'wetter' | 'moment',
  altAb: string,
  neuOffsetS: number,
): string | null {
  if (!z) return null
  const scale = buildScale(z.track)
  if (!scale) return null
  // Modus- und Wetterkanten können aus der Automatik stammen — erst
  // festschreiben, dann stehen auch die Nachbarn fest, zwischen die geklemmt wird.
  if (kind === 'modus' && !schreibeModiFest(altAb)) return null
  if (kind === 'wetter' && !schreibeWetterFest()) return null
  const nachbarn =
    kind === 'modus'
      ? (z.edits.travelModes ?? [])
      : kind === 'kamera'
        ? (z.edits.camera ?? [])
        : kind === 'wetter'
          ? (z.edits.weather ?? [])
          : [] // Momente sind Punktereignisse — ihre Reihenfolge trägt nichts
  // Fortbewegung interpoliert Grenzen auf die Linie — Trackpunkt-Raster würde
  // die Kante wieder in großen Sprüngen einrasten lassen (Berner Oberland).
  // Kamera/Wetter bleiben am Raster: ihre Bänder hängen nicht an Abschnitten.
  const geklemmt = clampBoundary(
    nachbarn,
    altAb,
    z.daten.time.start,
    Math.max(scale.fromS, Math.min(scale.toS, neuOffsetS)),
    kind === 'modus' || kind === 'moment' ? undefined : z.track.map((p) => p[3]),
  )
  const neuAb = offsetToIso(z.daten.time.start, geklemmt)
  if (neuAb === altAb) return altAb
  if (kind === 'modus') {
    const alt = z.edits.travelModes?.find((g) => g.from === altAb)
    if (!alt || z.edits.travelModes?.some((g) => g.from === neuAb)) return null
    z.edits = withTravelModeBoundary(withoutTravelModeBoundary(z.edits, altAb), neuAb, alt.mode)
  } else if (kind === 'kamera') {
    const alt = z.edits.camera?.find((g) => g.from === altAb)
    if (!alt || z.edits.camera?.some((g) => g.from === neuAb)) return null
    z.edits = withCameraBoundary(
      withoutCameraBoundary(z.edits, altAb),
      neuAb,
      alt.preset,
      alt.scale,
    )
  } else if (kind === 'wetter') {
    const alt = z.edits.weather?.find((g) => g.from === altAb)
    if (!alt || z.edits.weather?.some((g) => g.from === neuAb)) return null
    z.edits = withWeatherBoundary(
      withoutWeatherBoundary(z.edits, altAb),
      neuAb,
      alt.mode,
      alt.intensity,
    )
  } else {
    const alt = z.edits.moments?.find((m) => m.from === altAb)
    if (!alt || z.edits.moments?.some((m) => m.from === neuAb)) return null
    z.edits = withCameraMoment(withoutCameraMoment(z.edits, altAb), neuAb, alt.kind, alt.durationS)
    if (z.fokus?.kind === 'moment') z.fokus = { kind: 'moment', from: neuAb }
  }
  return neuAb
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
const ZUG_SCHWELLE_PX = 4

function zeitleisteZug(e: PointerEvent): void {
  if (!z || !zug) return
  const scale = aktuelleAchse()
  if (!scale) return
  if (!zug.bewegt) {
    if (Math.abs(e.clientX - zug.startX) < ZUG_SCHWELLE_PX) return
    zug.bewegt = true
    // Der Greif-Cursor gilt erst AB HIER: beim bloßen Draufdrücken sah man
    // sonst „Rand ziehen", obwohl man nur etwas auswählen wollte.
    $('zeitleiste-zone').classList.add(KANTEN_ROLLEN.has(zug.rolle) ? 'zieht' : 'schiebt')
  }
  const start = z.daten.time.start
  const anteil = spurAnteil(e.clientX)
  const iso = (a: number): string => offsetToIso(start, fractionToOffset(scale, a))

  switch (zug.rolle) {
    // Die drei ZUSTANDS-Kanten laufen entkoppelt: die Kante ist während des
    // Zugs eine reine Anzeigegröße am Zeiger, geschrieben wird erst beim
    // Loslassen (s. kantenZugBewegen).
    case 'grenze':
    case 'kamera':
    case 'wetter':
      kantenZugBewegen(e)
      return
    // Ton-Klips rechnen seit Etappe 4 in FILMsekunden (docs §2E). Jede Geste
    // schreibt den Anker mit — dadurch wird ein Klip in alter `from`/`to`-Form
    // beim ersten Anfassen festgeschrieben, und nur dieser eine (anders als bei
    // den Modus-Grenzen sind Ton-Klips unabhängige Objekte).
    case 'audio-balken':
    case 'audio-von':
    case 'audio-bis':
    case 'sfx': {
      if (zug.index === undefined) break
      const klip = tonKlipVon(zug.index)
      if (!klip) break
      const zielFilmS = fractionToFilm(scale, anteil)
      let patch: AudioClipPatch
      if (zug.rolle === 'audio-von') {
        const erg = trimLeft(scale, start, klip, zielFilmS)
        patch = erg.patch
        zug.amAnschlag = erg.atLimit
      } else if (zug.rolle === 'audio-bis') {
        const erg = trimRight(scale, start, klip, zielFilmS)
        patch = erg.patch
        zug.amAnschlag = erg.atLimit
      } else {
        // Verschieben: der Griffversatz hält den Klip unter dem Zeiger, statt
        // ihn mit seinem Anfang dorthin springen zu lassen.
        patch = moveAudioClip(scale, start, klip, zielFilmS - (zug.griffVersatzFilmS ?? 0))
        zug.amAnschlag = false
      }
      z.edits = mitAudioPatch(z.edits, zug.index, {
        ...patch,
        // Der Einstieg wird beim Verschieben nicht angefasst; steht er auf 0,
        // gehört das Feld gelöscht statt als Null hinterlassen.
        startS: patch.startS && patch.startS > 0 ? patch.startS : undefined,
      })
      zeigeTonEtikett(klip, patch, zug.amAnschlag === true)
      break
    }
  }
  renderNachZug()
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

interface KantenZug {
  kind: 'modus' | 'kamera' | 'wetter'
  from: string
  /** Fenster zwischen den Nachbargrenzen — in Aufnahmezeit und in Filmsekunden */
  fromS: number
  toS: number
  minFilmS: number
  maxFilmS: number
  /** Filmsekunde → Aufnahmezeit. Bei der Fortbewegung die eigene Zug-Kurve. */
  zeitBei: (filmS: number) => number
  /** Vorschau der Filmlänge (nur Fortbewegung) */
  dauerBei?: (tOffsetS: number) => number
  gesamtFilmVorher: number
  bewegt: boolean
}

let kantenZug: KantenZug | null = null

/** Zeiten der Kanten EINER Zustandsbahn, aufsteigend (ohne die Tour-Ränder). */
function kantenZeiten(kind: 'modus' | 'kamera' | 'wetter'): number[] {
  if (!z) return []
  const start = z.daten.time.start
  if (kind === 'modus') {
    // Die Fortbewegung zeigt AUCH Kanten aus der Aufzeichnung — Nachbar ist,
    // was man sieht, nicht nur was im Overlay steht.
    const abschnitte = splitForDisplay(z.daten.segments as EditorSegment[], z.edits, start)
    const zeiten: number[] = []
    for (const [i, a] of abschnitte.entries()) {
      const vorher = abschnitte[i - 1]
      if (vorher && vorher.mode !== a.mode) zeiten.push((a.pts[0] as TrackPoint)[3])
    }
    return zeiten
  }
  const grenzen = kind === 'kamera' ? (z.edits.camera ?? []) : anzeigeWetter()
  return grenzen
    .map((g) => isoToOffset(start, g.from))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b)
}

/** Modus links und rechts einer Fortbewegungs-Kante (für Tempo und Vorschau). */
function modiUmKante(
  tOffsetS: number,
): { before: TravelMode | null; left: TravelMode; right: TravelMode } | null {
  if (!z) return null
  const abschnitte = splitForDisplay(
    z.daten.segments as EditorSegment[],
    z.edits,
    z.daten.time.start,
  )
  const i = abschnitte.findIndex((a) => Math.abs((a.pts[0] as TrackPoint)[3] - tOffsetS) < 1)
  const rechts = abschnitte[i]
  const links = abschnitte[i - 1]
  // `davor` ist der Modus VOR dem Zug-Fenster: Beschleunigt der Film an dessen
  // linker Kante, liegt die Rampe IM Fenster und kostet dort Zeit.
  return rechts && links
    ? { before: abschnitte[i - 2]?.mode ?? null, left: links.mode, right: rechts.mode }
    : null
}

/** Zug-Start: Fenster und Umrechnung einsammeln — beides steht dann fest. */
function starteKantenZug(ziel: HTMLElement, rolle: string): void {
  kantenZug = null
  if (!z) return
  const from = ziel.dataset['ab']
  const achse = aktuelleAchse()
  const scale = buildScale(z.track)
  if (!from || !achse?.curve || !scale) return
  const kind = rolle === 'grenze' ? 'modus' : (rolle as 'kamera' | 'wetter')
  const eigenS = isoToOffset(z.daten.time.start, from)
  if (!Number.isFinite(eigenS)) return
  // Die eigene Kante über den INDEX finden, nicht über eine Zeit-Toleranz: Der
  // Overlay-Anker ist sekundengenau (`offsetToIso` schneidet die Millisekunden
  // ab), die Wechselzeit im Track ist es nicht. Mit „alles vor mir / alles nach
  // mir" wurde die eigene Kante deshalb zum rechten Nachbarn — das Zug-Fenster
  // war der Abschnitt DAVOR, und die Kante klemmte nach 7 px fest.
  const zeiten = kantenZeiten(kind)
  let eigenIdx = -1
  let bestAb = 2 // mehr als zwei Sekunden daneben ist keine Rundung mehr
  zeiten.forEach((t, i) => {
    const ab2 = Math.abs(t - eigenS)
    if (ab2 < bestAb) {
      bestAb = ab2
      eigenIdx = i
    }
  })
  const fromS =
    (eigenIdx > 0 ? zeiten[eigenIdx - 1] : zeiten.filter((t) => t < eigenS).pop()) ?? scale.fromS
  const toS = (eigenIdx >= 0 ? zeiten[eigenIdx + 1] : zeiten.find((t) => t > eigenS)) ?? scale.toS
  // Für Tempo und Meter zählt die Kante, wie sie im Track LIEGT — nicht ihr auf
  // die Sekunde gerundeter Anker.
  const kanteS = eigenIdx >= 0 ? (zeiten[eigenIdx] as number) : eigenS
  const gesamtS = achse.curve.totalS
  const filmVon = filmToOffset(achse, fromS)

  let zeitBei = (filmS: number): number => fractionToOffset(achse, filmToFraction(achse, filmS))
  let maxFilmS = filmToOffset(achse, toS)
  let dauerBei: ((t: number) => number) | undefined

  if (kind === 'modus') {
    // Die Fortbewegung braucht ihre EIGENE Abbildung: die Grenze ändert die
    // Achse, auf der sie liegt. Analytisch statt per Bisektion — an einem
    // 10 000-Punkte-Track kostete die 12,5 ms je Frame, das hier 0,2 ms EINMAL.
    // Und weil sie EXAKT ist, darf der Zug live ins Modell schreiben: die Kante
    // landet nach jedem Neuaufbau wieder unter dem Zeiger.
    const travelModes = modiUmKante(kanteS)
    const kurve = travelModes
      ? buildBoundaryCurve(z.track, fromS, toS, travelModes, filmVon, achse.stops ?? [])
      : null
    if (!kurve || !travelModes) return
    zeitBei = (filmS: number): number => recordingTimeAtFilmTime(kurve, filmS)
    maxFilmS = kurve.totalS
    const meterAlt = metersToOffset(kumStrecke, z.track, kanteS)
    const zz = z
    dauerBei = (t: number): number =>
      filmDurationAtBoundary(
        gesamtS,
        meterAlt,
        metersToOffset(kumStrecke, zz.track, t),
        travelModes.left,
        travelModes.right,
      )
  }

  kantenZug = {
    kind,
    from,
    fromS,
    toS,
    minFilmS: filmVon,
    maxFilmS,
    zeitBei,
    ...(dauerBei ? { dauerBei } : {}),
    gesamtFilmVorher: gesamtS,
    bewegt: false,
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
 * Möglich ist das erst durch die EXAKTE Umrechnung: `zeitBei` liefert die Zeit,
 * deren Filmposition in der DARAUS entstehenden Achse wieder `filmS` ist. Die
 * Kante steht nach dem Neuaufbau also weiter unter dem Zeiger. Mit der Achse
 * des Vorframes gerechnet sprang sie um 116 px — das war der Grund, den Zug
 * überhaupt zu entkoppeln.
 *
 * Ein Undo-Schritt bleibt es: `renderNachZug` schreibt `letzterStand` nicht
 * fort, erst das abschließende `renderAlles` setzt den Punkt.
 */
function kantenZugBewegen(e: PointerEvent): void {
  const kz = kantenZug
  if (!kz || !z) return
  const achse = aktuelleAchse()
  if (!achse?.curve) return
  if (!kz.bewegt) {
    kz.bewegt = true
    // Maßstab einfrieren: eingepasst skalierte die geänderte Filmdauer die
    // GANZE Leiste, auch alles vor der Kante (§2C).
    einpassen = false
  }
  const roh = fractionToFilm(achse, spurAnteil(e.clientX))
  const filmS = clampFilmS(roh, kz.minFilmS, kz.maxFilmS, pxProFilmS)
  // Gerastet wird an den Halten, wie sie JETZT auf der Leiste stehen — und das
  // ist seit dem Live-Aufbau zugleich die Anordnung beim Loslassen.
  const halte = (achse.stops ?? []).filter((h) => h.offsetS > kz.fromS && h.offsetS <= kz.toS)
  const rast = snapToStop(halte, fractionToOffset(achse, filmToFraction(achse, filmS)), filmS)
  const ziel = rast.stop ? rast.tOffsetS : kz.zeitBei(filmS)

  const neuAb = verschiebeGrenze(kz.kind, kz.from, ziel)
  if (neuAb) kz.from = neuAb
  renderNachZug()

  // Erst nach dem Aufbau: die Kante ist ein frisches Element, und wo sie steht,
  // weiß jetzt die neue Achse.
  const neuAchse = aktuelleAchse()
  const kanteS = isoToOffset(z.daten.time.start, kz.from)
  const kanteFilmS = neuAchse ? filmToOffset(neuAchse, kanteS) : filmS
  for (const el of document.querySelectorAll<HTMLElement>('#zeitleiste-zone .kante')) {
    el.classList.toggle('zieht', el.dataset['ab'] === kz.from)
  }
  const teile = [
    `${formatFilmTime(kanteFilmS)} · ${uhrzeitKurz(offsetToIso(z.daten.time.start, kanteS))} Uhr`,
  ]
  if (rast.stop) teile.push(rast.behind ? 'rastet hinter den Halt' : 'rastet vor den Halt')
  if (kz.dauerBei) {
    const neu = kz.dauerBei(kanteS)
    if (Math.abs(neu - kz.gesamtFilmVorher) > 0.5) {
      teile.push(`Film ${formatFilmTime(kz.gesamtFilmVorher)} → ${formatFilmTime(neu)}`)
    }
  }
  zeigeZielLinie(kanteFilmS * pxProFilmS, teile.join(' · '), !!rast.stop)
  // Der Halt, an dem gerastet wird, leuchtet mit — die Erklärung passiert in
  // der Bewegung, nicht in einer Legende.
  for (const el of document.querySelectorAll('.halt-klip.rastet')) el.classList.remove('rastet')
  for (const st of rast.stop?.items ?? []) klipEls.get(st.id)?.classList.add('rastet')
}

/** Loslassen: aufräumen. Geschrieben wurde schon — jetzt fällt der Undo-Punkt. */
function beendeKantenZug(): boolean {
  const kz = kantenZug
  kantenZug = null
  verbergeZielLinie()
  for (const el of document.querySelectorAll('.halt-klip.rastet')) el.classList.remove('rastet')
  for (const el of document.querySelectorAll('#zeitleiste-zone .kante.zieht'))
    el.classList.remove('zieht')
  return !!kz?.bewegt
}

function zeigeZielLinie(px: number, text: string, rastet: boolean): void {
  let el = document.querySelector<HTMLElement>('.ziel-linie')
  if (!el) {
    el = document.createElement('div')
    el.className = 'ziel-linie'
    el.appendChild(document.createElement('b'))
    $('spuren').appendChild(el)
  }
  el.classList.toggle('rastet', rastet)
  // Sie ist während des ganzen Zugs da: als ORIENTIERUNG durch alle Bahnen
  // („was liegt hier zeitlich übereinander?"). Beim Rasten tritt sie hervor.
  // In Pixeln, nicht als Anteil von `--zeit-breite`: die Breite hängt an der
  // Filmdauer, und genau die ändert der Zug.
  el.style.left = `calc(var(--spur-x) + ${px.toFixed(1)}px)`
  const etikett = el.querySelector('b')
  if (etikett && etikett.textContent !== text) etikett.textContent = text
}

function verbergeZielLinie(): void {
  document.querySelector('.ziel-linie')?.remove()
}

/** Den Ton-Klip an einem Overlay-Index in seiner AKTUELLEN Filmlage auflösen. */
function tonKlipVon(index: number): AudioClip | null {
  const scale = aktuelleAchse()
  if (!z || !scale) return null
  return (
    resolveAudioClips(z.edits.audio ?? [], z.daten.time.start, scale, tonDauern).find(
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
function zeigeTonEtikett(klip: AudioClip, patch: AudioClipPatch, amAnschlag: boolean): void {
  const scale = aktuelleAchse()
  if (!scale) return
  const filmVon =
    patch.offsetFilmS + filmToOffset(scale, isoToOffset(z?.daten.time.start ?? '', patch.anchor))
  const laenge = patch.durationFilmS ?? klip.filmBis - klip.filmVon
  const teile = [formatFilmTime(laenge)]
  if (patch.startS) teile.push(`from ${formatFilmTime(patch.startS)} der Datei`)
  if (amAnschlag) teile.push('kein Material mehr')
  zeigeZielLinie(filmVon * pxProFilmS, teile.join(' · '), amAnschlag)
}

function verdrahteZeitleiste(): void {
  const zone = $('zeitleiste-zone')
  const fenster = $('spuren-fenster')

  // Der Abspielkopf liegt über der Namensspalte — beim Scrollen muss er
  // verschwinden, sobald er dahinter wandert.
  fenster.addEventListener('scroll', zeigeKopfWennImBlick, { passive: true })

  // — Ziehen an Kanten, Griffen, Pins und Klips —
  zone.addEventListener('pointerdown', (e) => {
    if (!z || werkzeug !== 'auswahl') return
    const ziel = (e.target as HTMLElement).closest<HTMLElement>('[data-rolle]')
    if (!ziel) return
    const rolle = ziel.dataset['rolle']!
    // Klips und ihr Standzeit-Griff bringen ihre eigenen Zug-Handler mit
    // (klipZeiger) — sie laufen über Fenster-Listener, damit ein schneller Zug
    // die schmalen Griffe nicht verliert.
    if (
      rolle === 'klip' ||
      rolle === 'standzeit' ||
      rolle === 'momentklip' ||
      rolle === 'momentdauer'
    )
      return
    e.preventDefault()
    // Ein beginnender Zug hält das Abspielen an: Züge rendern über
    // renderNachZug (ohne halteAbspielen) — der Abspieler liefe sonst auf
    // einem veralteten Plan weiter.
    halteAbspielen()
    zone.setPointerCapture(e.pointerId)
    // KEIN Greif-Cursor beim bloßen Drücken — den setzt erst der echte Zug
    // (zeitleisteZug, from ZUG_SCHWELLE_PX).
    zug = { rolle, startX: e.clientX, bewegt: false, fokus: bandUnterZeiger(e) }
    if (ziel.dataset['ab'] !== undefined) zug.from = ziel.dataset['ab']
    if (ziel.dataset['mode']) zug.mode = ziel.dataset['mode'] as TravelMode
    if (ziel.dataset['preset']) zug.preset = ziel.dataset['preset'] as CameraPreset
    if (ziel.dataset['wettermode']) zug.wetterMode = ziel.dataset['wettermode'] as WeatherMode
    if (ziel.dataset['art']) zug.momentArt = ziel.dataset['art'] as CameraMomentKind
    if (ziel.dataset['index'] !== undefined) zug.index = Number(ziel.dataset['index'])
    if (ZUSTANDS_KANTEN.has(rolle)) starteKantenZug(ziel, rolle)
    if (rolle === 'audio-balken') {
      // Versatz zwischen Cursor und Klipanfang merken → ruckfreies Schieben.
      // In FILMsekunden, nicht in Anteilen: Der Klip behält beim Verschieben
      // seine Filmdauer, und in Anteilen gerechnet wäre der Versatz an einer
      // Halt-Flanke ein anderer als daneben.
      const scale = aktuelleAchse()
      const klip = scale ? tonKlipVon(zug.index ?? -1) : null
      if (scale && klip)
        zug.griffVersatzFilmS = fractionToFilm(scale, spurAnteil(e.clientX)) - klip.filmVon
    }
  })

  zone.addEventListener('pointermove', (e) => {
    if (zug) zeitleisteZug(e)
  })

  const zugEnde = (e: PointerEvent): void => {
    const zz = z // Modul-let: Narrowing überlebt Funktionsaufrufe nicht
    if (!zz) return
    if (zug) {
      const war = zug
      zug = null
      zone.classList.remove('zieht', 'schiebt')
      if (zone.hasPointerCapture(e.pointerId)) zone.releasePointerCapture(e.pointerId)
      const kantenGeschrieben = beendeKantenZug()
      if (war.bewegt || kantenGeschrieben) {
        unterdrueckeKlick = true
        renderAlles()
        return
      }
      // Kein Zug = Klick: Abspielkopf setzen UND das getroffene Band
      // fokussieren — ein Klick, beide sinnvollen Wirkungen. Traf er nichts,
      // wird die Auswahl aufgehoben (wie im Schnittprogramm).
      const audioRollen = ['audio-balken', 'audio-von', 'audio-bis', 'sfx']
      if (audioRollen.includes(war.rolle) && war.index !== undefined) {
        zz.fokus = { kind: 'audio', index: war.index }
        renderAlles()
      } else {
        // Ein Klick in die SPUREN wählt nur aus — den Abspielkopf setzt allein
        // das Maßband (und sein eigener Griff). Vorher sprang er bei jedem
        // Klick auf ein Band oder eine Bandkante mit, während er bei den
        // Ton-Klips stehen blieb: dieselbe Geste, zwei verschiedene Wirkungen.
        // Ein Band anzufassen heißt, es zu meinen, nicht die Stelle darunter.
        zz.fokus = war.fokus ?? null
        renderAlles()
      }
    }
  }
  // Der Klick auf einen Klip gehört seinem eigenen Handler (ziehKlip) — er
  // kennt den Unterschied zwischen Antippen und Ziehen.
  zone.addEventListener('pointerup', zugEnde)
  zone.addEventListener('pointercancel', zugEnde)

  // — Abspielkopf ziehen —
  //
  // Über FENSTER-Listener statt Pointer-Capture: der Kopf ist 13 px breit,
  // eine Capture darauf verlöre bei schnellen Bewegungen die Ereignisse.
  $('kopf-griff').addEventListener('pointerdown', (e) => {
    if (!z || e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const weiter = scrubGeste()
    document.body.classList.add('scrubbt')
    const scale = aktuelleAchse()
    // Scrubben meint eine Stelle auf der LEISTE, also eine Filmsekunde — in
    // Aufnahmezeit übersetzt bliebe der Kopf an jeder Haltkante kleben.
    const setze = (clientX: number): void => {
      if (!scale) return
      setzeKopfFilm(fractionToFilm(scale, spurAnteil(clientX)))
    }
    const rand = randScroller(setze)
    const zieh = (ev: PointerEvent): void => {
      setze(ev.clientX)
      rand.bewege(ev.clientX)
    }
    const los = (): void => {
      window.removeEventListener('pointermove', zieh)
      window.removeEventListener('pointerup', los)
      rand.stop()
      document.body.classList.remove('scrubbt')
      unterdrueckeKlick = true
      weiter()
    }
    window.addEventListener('pointermove', zieh)
    window.addEventListener('pointerup', los)
  })

  // Klick/Zug auf dem Maßband scrubbt ebenfalls — die vertraute Geste.
  $('skala-feld').addEventListener('pointerdown', (e) => {
    if (!z || e.button !== 0 || werkzeug !== 'auswahl') return
    e.preventDefault()
    const scale = aktuelleAchse()
    if (!scale) return
    const weiter = scrubGeste()
    setzeKopfFilm(fractionToFilm(scale, spurAnteil(e.clientX)))
    document.body.classList.add('scrubbt')
    const setze = (clientX: number): void =>
      setzeKopfFilm(fractionToFilm(scale, spurAnteil(clientX)))
    const rand = randScroller(setze)
    const zieh = (ev: PointerEvent): void => {
      setze(ev.clientX)
      rand.bewege(ev.clientX)
    }
    const los = (): void => {
      window.removeEventListener('pointermove', zieh)
      window.removeEventListener('pointerup', los)
      rand.stop()
      document.body.classList.remove('scrubbt')
      renderAlles()
      weiter()
    }
    window.addEventListener('pointermove', zieh)
    window.addEventListener('pointerup', los)
  })

  // — Ereignis anlegen: „+" an jeder Bahn, Ablage im Kopf —
  zone.addEventListener('click', (e) => {
    const plus = (e.target as HTMLElement).closest<HTMLElement>('.spur-plus')
    if (!plus?.dataset['spur']) return
    e.stopPropagation()
    if (plus.getAttribute('aria-expanded') === 'true') schliesseSpurMenue()
    else oeffneSpurMenue(plus.dataset['spur'], plus)
  })
  $('ablage-knopf').addEventListener('click', (e) => {
    e.stopPropagation()
    if (offenesMenue?.dataset['ablage'] === '1') schliesseSpurMenue()
    else oeffneAblage()
  })
  // Klick daneben oder Esc schließt — ein Menü darf nie hängen bleiben.
  // Der öffnende Knopf zählt nicht als „daneben": sonst schließt pointerdown
  // zuerst, und der anschließende click öffnet sofort wieder (Toggle kaputt).
  document.addEventListener('pointerdown', (e) => {
    if (!offenesMenue) return
    const ziel = e.target as Node
    if (offenesMenue.contains(ziel)) return
    if ((ziel as HTMLElement).closest?.('#ablage-knopf, .spur-plus')) return
    schliesseSpurMenue()
  })
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && offenesMenue) schliesseSpurMenue()
  })

  // — Werkzeuge: Hand pannt, Zoom klickt/zieht. Der Abspielkopf bleibt in
  //   jedem Werkzeug greifbar (er ist von diesem Handler ausgenommen). —
  $('zeitleiste-zone')
    .querySelector('.werkzeuge')
    ?.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('.wkz')
      if (b?.dataset['wkz']) setzeWerkzeug(b.dataset['wkz'] as typeof werkzeug)
    })
  fenster.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || werkzeug === 'auswahl') return
    if ((e.target as HTMLElement).closest('.kopf-griff')) return
    e.preventDefault()
    const fr = fenster.getBoundingClientRect()
    const anteilBei = (clientX: number): number =>
      Math.min(
        Math.max(
          (fenster.scrollLeft + (clientX - fr.left) - spurXpx()) / Math.max(1, zeitBreitePx()),
          0,
        ),
        1,
      )
    if (werkzeug === 'hand') {
      fenster.classList.add('greift')
      const startX = e.clientX
      const startScroll = fenster.scrollLeft
      const zieh = (ev: PointerEvent): void => {
        fenster.scrollLeft = startScroll - (ev.clientX - startX)
      }
      const los = (): void => {
        window.removeEventListener('pointermove', zieh)
        window.removeEventListener('pointerup', los)
        fenster.classList.remove('greift')
      }
      window.addEventListener('pointermove', zieh)
      window.addEventListener('pointerup', los)
      return
    }
    const startX = e.clientX
    const box = $('zoom-box')
    let gezogen = false
    const zieh = (ev: PointerEvent): void => {
      if (!gezogen && Math.abs(ev.clientX - startX) < 5) return
      gezogen = true
      box.style.display = 'block'
      box.style.left = `${Math.min(startX, ev.clientX)}px`
      box.style.width = `${Math.abs(ev.clientX - startX)}px`
      box.style.top = `${fr.top}px`
      box.style.height = `${fr.height}px`
    }
    const los = (ev: PointerEvent): void => {
      window.removeEventListener('pointermove', zieh)
      window.removeEventListener('pointerup', los)
      box.style.display = 'none'
      if (gezogen) {
        // Auf den aufgezogenen Bereich zoomen — er füllt danach die Breite
        const a = anteilBei(Math.min(startX, ev.clientX))
        const b = anteilBei(Math.max(startX, ev.clientX))
        setzeMassstab(passMassstab() / Math.max(b - a, 0.02), (a + b) / 2, fenster.clientWidth / 2)
      } else {
        setzeMassstab(
          pxProFilmS * (ev.altKey ? 1 / 1.6 : 1.6),
          anteilBei(ev.clientX),
          ev.clientX - fr.left,
        )
      }
    }
    window.addEventListener('pointermove', zieh)
    window.addEventListener('pointerup', los)
  })

  // — Zoom-Bedienung im Kopf —
  const zoomAnker = (): { anteil: number; vx: number } => {
    const scale = aktuelleAchse()
    // Um den Abspielkopf zoomen, wenn er sichtbar ist — sonst um die Fenstermitte
    if (z?.auswahl && scale) {
      const anteil = offsetToFraction(scale, z.auswahl[3])
      const vx = spurXpx() + anteil * zeitBreitePx() - fenster.scrollLeft
      if (vx >= 0 && vx <= fenster.clientWidth) return { anteil, vx }
    }
    const mitte = fenster.clientWidth / 2
    return {
      anteil: (fenster.scrollLeft + mitte - spurXpx()) / Math.max(1, zeitBreitePx()),
      vx: mitte,
    }
  }
  $('zoom-rein').addEventListener('click', () => {
    const a = zoomAnker()
    setzeMassstab(pxProFilmS * 1.6, a.anteil, a.vx)
  })
  $('zoom-raus').addEventListener('click', () => {
    const a = zoomAnker()
    setzeMassstab(pxProFilmS / 1.6, a.anteil, a.vx)
  })
  $('zoom-wert').addEventListener('click', passeEin)
  $('zoom-regler').addEventListener('input', (e) => {
    const v = Number((e.target as HTMLInputElement).value) / 100
    const a = zoomAnker()
    setzeMassstab(passMassstab() * Math.pow(ZOOM_MAX, v), a.anteil, a.vx)
  })
  // Pinch/⌘-Rad zoomt um den Cursor (wie im Schnittprogramm)
  fenster.addEventListener(
    'wheel',
    (e) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const fr = fenster.getBoundingClientRect()
      const anteil =
        (fenster.scrollLeft + (e.clientX - fr.left) - spurXpx()) / Math.max(1, zeitBreitePx())
      setzeMassstab(
        pxProFilmS * Math.exp(-e.deltaY / 220),
        Math.max(0, Math.min(1, anteil)),
        e.clientX - fr.left,
      )
    },
    { passive: false },
  )
}

/** Werkzeug umschalten — Cursor und Timeline-Verhalten folgen dem Zustand. */
function setzeWerkzeug(w: typeof werkzeug): void {
  werkzeug = w
  document
    .querySelectorAll<HTMLElement>('.wkz')
    .forEach((b) => b.classList.toggle('an', b.dataset['wkz'] === w))
  const fenster = document.getElementById('spuren-fenster')
  if (fenster) fenster.dataset['wkz'] = w
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
let flashUhr: number | null = null
function status(text: string, klasse = ''): void {
  const el = $('editor-flash')
  if (flashUhr !== null) {
    clearTimeout(flashUhr)
    flashUhr = null
  }
  const warSichtbar = el.classList.contains('zeigt')
  if (!text) {
    el.classList.remove('zeigt', 'pop')
    return
  }
  el.className = `editor-flash zeigt ${klasse}`
  // Symbol statisch, der TEXT über textContent — Meldungen tragen Dateinamen.
  el.innerHTML =
    klasse === 'ok'
      ? icon('haken')
      : klasse === 'fehler'
        ? icon('x')
        : klasse === 'warnung'
          ? icon('warnung')
          : '<span class="kreisel"></span>'
  const span = document.createElement('span')
  span.textContent = text
  el.appendChild(span)
  if (warSichtbar) {
    // Ersetzen pulst kurz — Animation neu anstoßen (Reflow-Trick wie .puls).
    el.classList.remove('pop')
    void el.offsetWidth
    el.classList.add('pop')
  }
  if (klasse) {
    flashUhr = window.setTimeout(
      () => {
        el.classList.remove('zeigt', 'pop')
        flashUhr = null
      },
      // Die Warnung steht so lange wie der geschärfte Knopf: Sie ERKLÄRT ihn.
      // Verschwände sie früher, bliebe ein Knopf mit einer Frage ohne Kontext.
      klasse === 'fehler' ? 7000 : klasse === 'warnung' ? 6000 : 4000,
    )
  }
}

// — Abspielen —
//
// Der Abspielkopf läuft, Musik und Klänge erklingen, an jedem Halt blendet die
// Aufnahme auf. Bewusst KEIN zweiter 3D-Player (dafür ist der Knopf „Vorschau"
// da): Hier prüft man den SCHNITT — kommt die Musik zum Strandabschnitt, reißt
// der Halt am Gipfel die Fahrt auseinander. Die Schrittlogik liegt in
// abspielen.ts, das erst beim ersten Play geladen wird.

let abspieler: Abspieler | null = null
/** Karte zentriert beim Abspielen auf den Läufer — Standard an, Toggle neben Play. */
let karteFolgt = true
/** Welche Aufnahme gerade auf der Karte liegt — Wechsel baut die Karte neu. */
let eingeblendet: string | null = null
/**
 * Gemessenes Seitenverhältnis je Medium (geklemmt, s. `klemmeSeitenverhaeltnis`).
 *
 * Der Rahmen der Foto-Karte entsteht bei jedem Auftritt neu; ohne dieses
 * Gedächtnis stünde er bis zum `load` des Bildes auf der Vorgabe 3:2 und
 * sprang beim Scrubben über einen Halt sichtbar in die Form.
 */
const seitenverhaeltnisse = new Map<string, number>()

/**
 * Die Leinwand der Foto-Karte über der Editor-Bühne — derselbe Maler wie im
 * Player, nur mit dem Bühnen-Satz `editor` und ohne Bedienung: Diese Karte hat
 * keine Knöpfe, sie ist eine Vorschau.
 */
let kartenSchicht: KartenSchicht | null = null
/** Was der Maler über die liegende Aufnahme wissen muss (`zeigeFoto` füllt beides). */
let kartenMedium: KartenMedium = { art: 'foto', ar: null }
let kartenText: KartenText = { titel: '', kmText: '', zaehlerText: '' }
/** Hat das liegende Video schon je einen Frame geliefert? (s. `kartenQuelle`) */
let videoHatteFrame = false
/** Wanduhr-Marke des letzten begonnenen Suchlaufs (`performance.now()`). */
let letzterSuchlauf = -Infinity

/** Schnappschuss für eine Wiedergabe — bei jedem Start neu eingesammelt. */
function holeSpielplan(): Spielplan | null {
  if (!z?.auswahl) return null
  const achse = aktuelleAchse()
  const spiel = aktuelleSpielKurve()
  if (!achse || !spiel) return null
  const start = z.daten.time.start

  const eintraege = z.edits.audio ?? []
  const musik: MusikKlip[] = []
  const klaenge: KlangMarke[] = []
  // Dieselben Klips, die die Leiste zeigt — samt Einstieg und Loop. Ein zweiter
  // Weg zur Filmlage liefe hier auseinander, und die Schnittprüfung prüfte
  // einen anderen Film.
  for (const k of resolveAudioClips(eintraege, start, achse, tonDauern)) {
    const a = eintraege[k.index]
    // Was beim Rendern herausfällt (ganz außerhalb der Tour), soll auch hier
    // nicht klingen — sonst hörte man etwas, das im Film nicht vorkommt.
    if (!a || audioWouldBeDropped(a, z.edits, start, achse)) continue
    const url = audioUrl(a, z.tourId)
    const volume = a.volume ?? STUDIO_PEGEL_VORGABE
    const von = filmToFraction(achse, k.filmVon)
    // Ein Klip MIT Ausdehnung läuft als Bereich (auch ein Effekt — der Player
    // tut seit Etappe 4 dasselbe); einer ohne bleibt die Überfahr-Marke.
    if (k.filmBis > k.filmVon) {
      musik.push({
        von,
        to: filmToFraction(achse, k.filmBis),
        url,
        volume,
        loop: k.loop,
        ...(k.startS > 0 ? { startS: k.startS } : {}),
      })
    } else {
      klaenge.push({
        index: k.index,
        anteil: von,
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
    marke: filmToFraction(achse, kopfFilm()),
    kurve: spiel,
    musik,
    klaenge,
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
function setzeMarkeAnteil(anteil: number): void {
  if (!z) return
  const scale = aktuelleAchse()
  if (!scale) return
  setzeKopfFilm(fractionToFilm(scale, anteil))
  folgeKopf(anteil)
  // `folgeKarte()` stand hier einmal eigens — jetzt zieht `renderPlayhead` die
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
const RAND_ZONE_PX = 40
const RAND_TEMPO_MAX_PX = 24

function randScroller(anwenden: (clientX: number) => void): {
  bewege: (clientX: number) => void
  stop: () => void
} {
  let zeigerX = 0
  let raf = 0
  const schritt = (): void => {
    raf = 0
    const fenster = document.getElementById('spuren-fenster')
    if (!fenster) return
    const r = fenster.getBoundingClientRect()
    // Links beginnt die Zeitachse erst hinter der klebenden Namenspalte.
    const links = r.left + spurXpx()
    let weg = 0
    if (zeigerX < links + RAND_ZONE_PX) weg = zeigerX - (links + RAND_ZONE_PX)
    else if (zeigerX > r.right - RAND_ZONE_PX) weg = zeigerX - (r.right - RAND_ZONE_PX)
    if (weg === 0) return
    const tempo = Math.max(-RAND_TEMPO_MAX_PX, Math.min(RAND_TEMPO_MAX_PX, weg * 0.4))
    const vorher = fenster.scrollLeft
    fenster.scrollLeft = vorher + tempo
    if (fenster.scrollLeft === vorher) return
    anwenden(zeigerX)
    raf = requestAnimationFrame(schritt)
  }
  return {
    bewege: (clientX: number): void => {
      zeigerX = clientX
      if (!raf) raf = requestAnimationFrame(schritt)
    },
    stop: (): void => {
      if (raf) cancelAnimationFrame(raf)
      raf = 0
    },
  }
}

/** Läuft der Kopf aus dem Fenster, scrollt die Sicht mit (wie in Final Cut). */
function folgeKopf(anteil: number): void {
  const fenster = document.getElementById('spuren-fenster')
  if (!fenster) return
  const rand = 48
  const x = spurXpx() + anteil * zeitBreitePx() - fenster.scrollLeft
  if (x > fenster.clientWidth - rand) fenster.scrollLeft += x - (fenster.clientWidth - rand)
  else if (x < spurXpx() + rand) fenster.scrollLeft -= spurXpx() + rand - x
}

/** Karte weich auf die Marke ziehen — nicht jedes Frame hart setzen.
 *  Hartes `setCenter` pro Abspiel-Tick ließ Track und Marker zittern. */
let folgeZiel: [number, number] | null = null
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
let folgeIst: [number, number] | null = null
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
let folgeAktiv = false
/** Anteil der Fensterbreite/-höhe, in dem die Karte ruht (zentriert). */
const RUHEZONE = 0.42
let folgeRaf = 0
/** Bis wann Follow pausiert (Nutzer zoomt) — sonst bricht `jumpTo` die Zoom-Animation ab. */
let folgePauseBis = 0

function folgeKarte(): void {
  if (!karte || !z?.auswahl || !karteFolgt) return
  folgeZiel = [z.auswahl[0], z.auswahl[1]]
  if (!folgeRaf) folgeRaf = requestAnimationFrame(folgeKarteTick)
}

/** Follow kurz aussetzen, damit Rad/Pinch/±-Knöpfe ungestört zoomen können. */
function pausiereKartenFolge(ms = 450): void {
  folgePauseBis = performance.now() + ms
  // Der eigene Glättungs-Zustand ist nach einem fremden Eingriff überholt —
  // die Karte steht dann irgendwo anders. Beim nächsten Tick wird er einmal
  // aus der Karte neu gesetzt.
  folgeIst = null
}

function folgeKarteTick(): void {
  folgeRaf = 0
  if (!karte || !karteFolgt || !folgeZiel) return
  // Während Nutzer-Zoom nicht eingreifen — `jumpTo` würde den Zoom sonst nach
  // wenigen Pixeln abwürgen (Around-Cursor-Animation wird abgebrochen).
  if (performance.now() < folgePauseBis) {
    folgeRaf = requestAnimationFrame(folgeKarteTick)
    return
  }
  // Die eigene geglättete Position, nicht die zurückgelesene Kartenmitte
  // (s. `folgeIst`). Beim ersten Frame und nach jedem Nutzer-Eingriff wird sie
  // einmal aus der Karte gesetzt — danach schreibt nur noch dieser Folger.
  if (!folgeIst) {
    const c0 = karte.getCenter()
    folgeIst = [c0.lng, c0.lat]
  }
  const von = karte.project(folgeIst)
  const nach = karte.project(folgeZiel)
  const dx = nach.x - von.x
  const dy = nach.y - von.y
  const dist2 = dx * dx + dy * dy

  const spielt = (abspieler?.tempo() ?? 0) !== 0

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
  const feld = karte.getContainer()
  const halbeBreite = (feld.clientWidth * RUHEZONE) / 2
  const halbeHoehe = (feld.clientHeight * RUHEZONE) / 2
  const ausserhalb = Math.abs(dx) > halbeBreite || Math.abs(dy) > halbeHoehe
  if (ausserhalb) folgeAktiv = true
  // Mittig angekommen (< 2 px): Nachführen beenden und ruhen lassen.
  else if (folgeAktiv && dist2 < 4) folgeAktiv = false

  if (!folgeAktiv) {
    if (spielt) {
      // Im Lauf wach bleiben — der Punkt wandert weiter auf die Zonenkante zu.
      folgeRaf = requestAnimationFrame(folgeKarteTick)
    } else {
      // Steht der Film, gibt es nichts zu erwarten: Kette beenden.
      folgeZiel = null
    }
    return
  }

  // Je weiter weg, desto beherzter; nah am Ziel weich (kein Überschwingen).
  const alpha = Math.min(0.28, 0.08 + Math.sqrt(dist2) / 500)
  const ziel = karte.unproject([von.x + dx * alpha, von.y + dy * alpha])
  folgeIst = [ziel.lng, ziel.lat]
  karte.jumpTo({ center: ziel })
  folgeRaf = requestAnimationFrame(folgeKarteTick)
}

function halteKartenFolge(): void {
  folgeZiel = null
  folgeIst = null
  folgeAktiv = false
  folgePauseBis = 0
  if (folgeRaf) {
    cancelAnimationFrame(folgeRaf)
    folgeRaf = 0
  }
  karte?.stop()
}

/**
 * Element, dessen `data-ids`-Wortliste diese Medien-ID enthält. Bewusst nicht
 * per `[data-ids~="…"]`-Selektor: die IDs kommen aus einem hochgeladenen
 * Manifest, und ein Anführungszeichen darin würde den Selektor zerlegen.
 */
function mitMedienId(auswahl: string, id: string): Element | null {
  for (const el of document.querySelectorAll<HTMLElement>(auswahl)) {
    if (el.dataset['ids']?.split(' ').includes(id)) return el
  }
  return null
}

/** Eine Klasse neu auslösen, auch wenn sie schon dran war. */
function blinke(el: Element | null, klasse: string, ms: number): void {
  if (!el) return
  el.classList.remove(klasse)
  void el.getBoundingClientRect() // Reflow erzwingen, sonst startet die Animation nicht neu
  el.classList.add(klasse)
  window.setTimeout(() => el.classList.remove(klasse), ms)
}

/**
 * Die Aufnahme, die der Player an diesem Halt zeigt — als dieselbe Foto-Karte
 * auf Papier. Sie steht genau so lange, wie im Inspector als Standzeit gewählt.
 *
 * „Dieselbe" ist seit „Eine Bühne, ein Maler" wörtlich zu nehmen: Gemalt wird
 * sie von `src/kartenmaler.ts`, demselben Zeichner, der die Karte des Players
 * und die des Films macht. Hier entsteht nur noch, was der Maler nicht selbst
 * beschaffen kann — die ZEICHENQUELLE (ein `img` oder `video` im Dokument,
 * unsichtbar) und der TEXT.
 */
function zeigeFoto(id: string): void {
  if (!z) return
  const m = medienAnzeige().find((x) => x.id === id)
  if (!m) return
  eingeblendet = id
  blinke(mitMedienId('.halt-klip', id), 'puls', 700)
  blinke(mitMedienId('.media-punkt', id), 'puls', 1400)

  const quellen = $('foto-quellen')
  // Das GEMESSENE Seitenverhältnis, mit derselben Klemme wie im Player. Gemerkt
  // wird es je Medium, weil `zeigeFoto` beim Scrubben oft läuft und der Rahmen
  // sonst bei jedem Auftritt kurz auf 3:2 stünde.
  kartenMedium = {
    art: m.type === 'video' ? 'video' : 'foto',
    ar: seitenverhaeltnisse.get(m.id) ?? null,
    ...(m.display?.kenBurns === false ? { keinKenBurns: true } : {}),
  }
  const merkeSeitenverhaeltnis = (b: number, h: number): void => {
    const ar = klemmeSeitenverhaeltnis(b, h)
    if (ar === null) return
    seitenverhaeltnisse.set(m.id, ar)
    if (eingeblendet === m.id) kartenMedium = { ...kartenMedium, ar }
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
  const quelleDa = (): void => {
    if (eingeblendet === m.id) synchronisiereFoto()
  }
  if (m.type === 'video') {
    // Neues Element, neue Rechnung: Frame-Merker und Suchlauf-Marke gehören zu
    // DIESER Datei.
    videoHatteFrame = false
    letzterSuchlauf = -Infinity
    const video = document.createElement('video')
    video.src = m.src
    // Der Ton der Aufnahme gehört zum Schnitt: Ohne ihn prüfte das Abspielen
    // einen Film, den es nicht gibt — die Musik stünde ungedämpft über einer
    // Szene, die im Player ihre eigene Stimme hat. Stumm startet es trotzdem
    // (volume 0): Die Ein-/Ausblendung setzt `synchronisiereBild` from dem ersten
    // Kopfschritt, dieselbe Hülle wie im Player (audiotracks.ts).
    video.muted = false
    video.volume = 0
    video.playsInline = true
    video.preload = 'auto'
    // Kein `autoplay`, kein `loop`: Was zu sehen ist, hängt an der Kopfposition
    // (`synchronisiereFoto`) — ein Video, das nach eigener Uhr läuft, zeigte
    // beim Scrubben irgendeinen Frame und beim Stillstand den nächsten.
    // Die Datei ist der ungeschnittene Master; der Trim sind die Nullpunkte
    // des Ausschnitts (der Schnitt selbst entsteht erst in der Pipeline).
    // Das rechte Ende gehört dazu: Ohne es liefe die Wiedergabe über den
    // Schnitt hinaus und in der Ausblendung des Halts gegen das Dateiende.
    const schnitt = clampMediaTrim(m.trim, m.durationS ?? 0)
    video.dataset['vonS'] = String(schnitt?.fromS ?? 0)
    const endeS = schnitt?.toS ?? m.durationS
    if (endeS) video.dataset['bisS'] = String(endeS)
    video.addEventListener(
      'loadedmetadata',
      () => merkeSeitenverhaeltnis(video.videoWidth, video.videoHeight),
      {
        once: true,
      },
    )
    // `loadedmetadata` liefert nur die Maße (readyState 1) — ein Frame steht erst
    // mit `loadeddata`, und nach jedem Seek erst mit `seeked`. Solange der Kopf
    // steht, ist das der einzige Anlass, das neue Einzelbild zu zeichnen.
    video.addEventListener('loadeddata', quelleDa)
    video.addEventListener('seeked', quelleDa)
    quellen.replaceChildren(video)
  } else {
    const bild = document.createElement('img')
    bild.src = m.src
    bild.alt = ''
    // Aus dem Browser-Cache ist `complete` schon beim Anlegen wahr — dann
    // feuert `load` nicht mehr.
    if (bild.complete && bild.naturalWidth)
      merkeSeitenverhaeltnis(bild.naturalWidth, bild.naturalHeight)
    else
      bild.addEventListener(
        'load',
        () => {
          merkeSeitenverhaeltnis(bild.naturalWidth, bild.naturalHeight)
          quelleDa()
        },
        { once: true },
      )
    quellen.replaceChildren(bild)
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
  const meter = m.anchor
    ? metersToOffset(
        kumStrecke,
        z.track,
        projectOntoTrack(z.track, m.anchor[0], m.anchor[1]).point[3],
      )
    : null
  kartenText = {
    titel: m.caption || '',
    // Uhrzeit UND Kilometerstand stehen rechts auf der Titelzeile. Ohne Titel
    // bleiben sie an derselben Stelle stehen. „4,1 km" und nicht „km 4,1" —
    // der Player schreibt die Einheit seit jeher hinter die Zahl.
    kmText: `${uhrzeitKurz(m.takenAt)} Uhr${meter !== null ? ` · ${kmText(meter)} km` : ''}`,
    zaehlerText: '',
  }
  document.querySelector('.karten-buehne')?.classList.add('foto-an')
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
function kartenQuelle(): { source: KartenQuelle | null; bereit: boolean } {
  const quellen = document.getElementById('foto-quellen')
  const video = quellen?.querySelector('video')
  if (video) {
    const hatFrame = video.readyState >= VIDEO_HAT_FRAME
    if (hatFrame) videoHatteFrame = true
    if (video.videoWidth > 0 && (hatFrame || videoHatteFrame)) {
      return {
        source: {
          bild: video,
          breite: video.videoWidth,
          hoehe: video.videoHeight,
          kennung: video.src,
        },
        bereit: hatFrame && !video.seeking,
      }
    }
    return { source: null, bereit: false }
  }
  const bild = quellen?.querySelector('img')
  if (bild && bild.complete && bild.naturalWidth > 0) {
    return {
      source: { bild, breite: bild.naturalWidth, hoehe: bild.naturalHeight, kennung: bild.src },
      bereit: true,
    }
  }
  return { source: null, bereit: false }
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
function synchronisiereFoto(): void {
  const achse = aktuelleAchse()
  const tempo = abspieler?.tempo() ?? 0
  const stand = achse && Math.abs(tempo) <= 1 ? stopAtFilmS(achse, kopfFilm()) : null
  const stueck = stand?.item ?? null
  // Solange eine Karte liegt, tritt der Niederschlag zurück — sonst regnet es
  // scharf über einem Foto, das die volle Aufmerksamkeit haben soll. Im Player
  // erledigt das der `.photo-backdrop` mit Schleier und Weichzeichner.
  stimmung?.setFoto(!!stueck)
  if (!stueck) {
    if (eingeblendet) verbergeFoto()
    return
  }
  if (stueck.id !== eingeblendet) zeigeFoto(stueck.id)
  synchronisiereBild(stueck.inS, stueck.durationS, tempo)
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
function synchronisiereBild(imS: number, durationS: number, tempo: number): void {
  const { source, bereit } = kartenQuelle()
  kartenSchicht?.male({
    imS,
    dauerS: durationS,
    medium: kartenMedium,
    text: kartenText,
    quelle: source,
    bereit,
  })

  const video = document.getElementById('foto-quellen')?.querySelector('video')
  if (!video) return
  const fromS = Number(video.dataset['vonS'] ?? 0)
  // Das Ende kommt aus dem Schnitt bzw. der Server-Länge — und zusätzlich aus
  // der Datei selbst, sobald sie ihre Dauer kennt: Fehlt `durationS` (Altbestand),
  // ist der Klip die Foto-Standzeit lang und damit meist länger als das Video.
  const dateiEndeS =
    video.duration > 0 && Number.isFinite(video.duration) ? video.duration : Infinity
  const endeS = Math.min(Number(video.dataset['bisS'] ?? 0) || Infinity, dateiEndeS)
  const { zielS, ausgelaufen } = videoStandS(fromS, endeS, imS)
  const laeuft = tempo === 1 && !ausgelaufen
  // Wann gesucht werden DARF, entscheidet die geteilte Nachführung
  // (`videoNachfuehrung` in einblendung.ts) — dieselbe Rechnung wie im Player.
  // Ohne ihre Rückfragen (laufender Suchlauf, Pufferstand, Wanduhr-Ruhe) wurde
  // in jedem Frame neu gesucht und keiner der Suchläufe kam je an.
  const nach = videoNachfuehrung({
    zielS,
    istS: video.currentTime,
    laeuft,
    paused: video.paused,
    seeking: video.seeking,
    readyState: video.readyState,
    seitSuchlaufS: (performance.now() - letzterSuchlauf) / 1000,
  })
  if (nach.suchen) setzeVideoZeit(video, zielS)
  if (nach.starten) {
    void video.play().catch(() => {
      // Unmuted-Autoplay ohne frische Geste wird geblockt (wie im Player,
      // src/ui.ts): stumm erzwingen, damit das Bild überhaupt läuft — sonst
      // stünde am Video-Halt ein Standbild und der Schnitt wäre nicht zu prüfen.
      video.muted = true
      void video.play().catch(() => {})
    })
  }
  if (nach.anhalten) video.pause()

  // Ton-Hülle über den AUSSCHNITT (nicht die Datei): Ein- und Ausblende liegen
  // an den Schnittkanten. Die Rechnung teilt sich der Editor mit dem Player
  // (`ausschnittDauerS`) — verschieden ist nur, was ankommt: dort die
  // geschnittene Fassung ohne linke Kante, hier der ungeschnittene Master.
  // Im Schnelllauf/rückwärts steht das Video und schweigt, also Hülle 0.
  const ausschnittS = ausschnittDauerS(video.duration, fromS, endeS)
  const huelle = laeuft && !video.muted ? videoTonHuelle(imS, ausschnittS) : 0
  const laut = videoLautstaerke(huelle)
  // Nur bei Bedarf setzen — die Funktion läuft in jedem Kopf-Frame, und manche
  // Browser feuern `volumechange` sonst im Kreis.
  if (Math.abs(video.volume - laut) > 0.004) video.volume = laut
  abspieler?.setzeDucking(huelle)
}

function setzeVideoZeit(video: HTMLVideoElement, sekunde: number): void {
  // Die Marke wird VOR dem Sprung gesetzt: Gemessen wird die Ruhe seit dem
  // Anstoß, nicht seit dem Eintreffen — und ein fehlgeschlagener Sprung zählt
  // mit, sonst versuchte es der nächste Kopfschritt sofort wieder.
  letzterSuchlauf = performance.now()
  try {
    video.currentTime = Math.max(0, sekunde)
  } catch {
    /* Seek vor dem Puffern kann fehlschlagen — der nächste Kopfschritt holt es nach */
  }
}

function verbergeFoto(): void {
  eingeblendet = null
  kartenSchicht?.raeume()
  document.querySelector('.karten-buehne')?.classList.remove('foto-an')
  const quellen = document.getElementById('foto-quellen')
  // Ein laufendes Video würde sonst unsichtbar weiterspielen
  quellen?.querySelector('video')?.pause()
  quellen?.replaceChildren()
  // Und seine Dämpfung mitnehmen: Ohne das bliebe die Musik nach dem letzten
  // Video-Halt für den Rest der Wiedergabe leise.
  abspieler?.setzeDucking(0)
}

function zeigeTempo(tempo: number): void {
  // Hier läuft JEDE Tempoänderung durch — Play, Pause, J/K/L und jedes
  // `halteAbspielen` einer manuellen Geste. Deshalb hängt die Kartenstimmung
  // hier: Regen und Klang gibt es nur bei Tempo 1, sonst friert das Overlay
  // ein und der Schleier trägt die Auskunft allein.
  stimmung?.setLauf(tempo)
  const knopf = document.getElementById('tp-play')
  if (!knopf) return
  knopf.querySelector('use')?.setAttribute('href', tempo !== 0 ? '#i-pause' : '#i-play')
  knopf.classList.toggle('spielt', tempo !== 0)
  knopf.setAttribute('aria-label', tempo !== 0 ? 'Pause' : 'Abspielen')
  const chip = document.getElementById('tempo-chip')
  // Beim Schnelllauf Faktor und Richtung zeigen; bei Stopp und 1× nichts.
  if (chip)
    chip.textContent = tempo === 0 || tempo === 1 ? '' : tempo < 0 ? `${-tempo}×◀` : `${tempo}×▶`
  if (tempo === 0) {
    halteKartenFolge()
    // Ausgeblendet wird hier NICHTS: steht der Kopf beim Anhalten in einem
    // Klip, gehört das Bild dorthin — es hängt an seiner Position, nicht an
    // der Wiedergabe. Beim nächsten Kopfschritt entscheidet `synchronisiereFoto`.
    synchronisiereFoto()
  }
}

async function spielUmschalten(): Promise<void> {
  if (!z) return
  if (!abspieler) {
    const modul = await import('./abspielen.js')
    abspieler = modul.erzeugeAbspieler({
      hole: holeSpielplan,
      setzeMarke: setzeMarkeAnteil,
      zeigeTempo,
      pulsKlang: (index) =>
        blinke(document.querySelector(`.zl-sfx[data-index="${index}"]`), 'pling', 500),
    })
  }
  abspieler.umschalten()
}

/** Jede manuelle Geste hält an — man scrubbt nicht gegen einen laufenden Kopf. */
function halteAbspielen(): void {
  abspieler?.halteAn()
}

/**
 * Für SCRUB-Gesten: anhalten und beim Loslassen dort weiterspielen.
 *
 * Der Unterschied zu `halteAbspielen` ist die Absicht der Geste. Wer eine
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
function scrubGeste(): () => void {
  const vorher = abspieler?.tempo() ?? 0
  halteAbspielen()
  return () => {
    if (vorher === 0) return
    void spielUmschalten().then(() => {
      if (vorher !== 1) abspieler?.setzeTempo(vorher)
    })
  }
}

// — Speichern / Neu verarbeiten —

/**
 * Beschriftung des Speichern-Knopfs, BEVOR die Löschfrage sie ersetzt hat.
 * Modul-Ebene und nicht lokal, weil Schärfen und Speichern zwei getrennte
 * Klicks sind — der zweite fände im Knopf nur noch die Frage vor.
 */
let speichernBeschriftung: string | null = null

/** Knopf entschärfen und beschriften, wie er vor der Frage aussah. */
function entschaerfeSpeichern(knopf: HTMLButtonElement): void {
  if (!knopf.dataset['loeschScharf']) return
  delete knopf.dataset['loeschScharf']
  if (speichernBeschriftung !== null) knopf.innerHTML = speichernBeschriftung
  speichernBeschriftung = null
}

async function warteAufBereit(id: string): Promise<void> {
  for (let i = 0; i < 90; i++) {
    const t = await api.tour(id)
    if (t.schema === 'maptale/tour@2' || t.status === 'ready') return
    if (t.status === 'failed')
      throw new Error(`Verarbeitung fehlgeschlagen: ${t.error ?? 'unbekannt'}`)
    await new Promise((weiter) => setTimeout(weiter, 900))
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
function fragtNachLoeschung(knopf: HTMLButtonElement, anzahl: number): boolean {
  if (!anzahl || knopf.dataset['loeschScharf']) return false
  knopf.dataset['loeschScharf'] = '1'
  // Die Beschriftung wird HIER gesichert und nirgends sonst gelesen: Beim
  // zweiten Klick steht im Knopf längst die Löschfrage, ein erneutes
  // `innerHTML` schriebe sie als „Originalzustand" fest.
  speichernBeschriftung = knopf.innerHTML
  knopf.textContent =
    anzahl === 1 ? '1 Aufnahme endgültig löschen?' : `${anzahl} Aufnahmen endgültig löschen?`
  status(
    anzahl === 1
      ? 'Beim Speichern wird die entfernte Aufnahme endgültig gelöscht — Datei und Speicherplatz sind danach weg. Nochmal klicken, um zu speichern.'
      : `Beim Speichern werden ${anzahl} entfernte Aufnahmen endgültig gelöscht — Dateien und Speicherplatz sind danach weg. Nochmal klicken, um zu speichern.`,
    'warnung',
  )
  setTimeout(() => {
    if (knopf.isConnected) entschaerfeSpeichern(knopf)
  }, 6000)
  return true
}

async function speichern(): Promise<void> {
  if (!z) return
  const problem = validateOverlay(z.edits)
  if (problem) {
    status(problem, 'fehler')
    return
  }
  const speichernKnopf = $('editor-speichern') as HTMLButtonElement
  // Nur was der SERVER kennt, kann er löschen: in dieser Sitzung nachgereichte,
  // aber noch nicht gespeicherte Medien gibt es dort noch gar nicht.
  const bekannt = new Set(z.daten.media.map((m) => m.id))
  const zuLoeschen = idsToDelete(z.edits).filter((id) => bekannt.has(id))
  if (fragtNachLoeschung(speichernKnopf, zuLoeschen.length)) return
  // Beim zweiten Klick trägt der Knopf die Löschfrage — die echte Beschriftung
  // liegt seit dem Schärfen im Merker. Nur wer gar nicht gefragt wurde (nichts
  // zu löschen), liest sie hier frisch aus dem DOM.
  const beschriftung = speichernBeschriftung ?? speichernKnopf.innerHTML
  speichernBeschriftung = null
  delete speichernKnopf.dataset['loeschScharf']
  speichernKnopf.disabled = true
  try {
    // 0. Endgültig löschen — VOR dem Overlay, denn der Server räumt dabei seine
    //    eigene Overlay-Fassung mit auf (medien-Eintrag, titelbild) und rendert
    //    neu. Ein danach geschriebenes Overlay mit denselben Einträgen würde
    //    toten Zustand zurückschreiben. Nacheinander, weil jedes Löschen einen
    //    Render anstößt und der nächste Aufruf sonst auf „verarbeitung" träfe.
    if (zuLoeschen.length) {
      for (const [i, id] of zuLoeschen.entries()) {
        status(
          zuLoeschen.length === 1
            ? 'Aufnahme wird endgültig gelöscht …'
            : `Aufnahme ${i + 1} von ${zuLoeschen.length} wird endgültig gelöscht …`,
        )
        await api.deleteMedium(z.tourId, id)
        await warteAufBereit(z.tourId)
      }
      // Lokal dasselbe tilgen wie der Server — und `gespeichert` mitziehen:
      // Der Server-Stand IST jetzt das gestutzte Overlay, ohne diese Zeile
      // liefe gleich ein Speichern für eine Änderung, die keine mehr ist.
      z.edits = withoutMedia(z.edits, zuLoeschen)
      z.gespeichert = JSON.stringify(
        withoutMedia(JSON.parse(z.gespeichert) as EditOverlay, zuLoeschen),
      )
    }
    // 1. Overlay (falls geändert) — der Server rendert die Tour neu
    if (JSON.stringify(z.edits) !== z.gespeichert) {
      status('Bearbeitungen werden gespeichert …')
      const antwort = await api.saveEdits(z.tourId, z.edits)
      if (antwort.status === 'processing') await warteAufBereit(z.tourId)
    }
    // 2. Titel/Beschreibung/Finale (falls geändert) — eigener Endpunkt, eigener Re-Render;
    //    bewusst NACH dem Overlay, damit sich die Renderer nie überlappen
    const titel = ($('editor-titel') as HTMLInputElement).value.trim()
    const beschreibung = ($('editor-beschreibung') as HTMLTextAreaElement).value.trim()
    const dachzeile = ($('editor-dachzeile') as HTMLInputElement).value.trim()
    const finale = ($('editor-finale') as HTMLInputElement).checked
    const finaleZiel = ($('editor-finale-ziel') as HTMLInputElement).value.trim()
    const felder: {
      title?: string
      description?: string
      dachzeile?: string
      finale?: boolean
      finaleZiel?: string
    } = {}
    if (titel && titel !== (z.daten.title ?? '')) felder.title = titel
    if (beschreibung !== (z.daten.description ?? '')) felder.description = beschreibung
    if (dachzeile !== (z.daten.kicker ?? '')) felder.dachzeile = dachzeile
    if (finale !== !!z.daten.finale) felder.finale = finale
    if (finaleZiel !== (z.daten.finaleTarget ?? '')) felder.finaleZiel = finaleZiel
    if (Object.keys(felder).length) {
      status('Tour-Einstellungen werden gespeichert …')
      await api.patchTour(z.tourId, felder)
      // Nur warten, wenn PATCH wirklich einen Re-Render gestartet hat — auf
      // einer fehler-Tour würde warteAufBereit sonst den ALTEN Pipeline-
      // Fehler als Speicher-Fehler melden (Review-Fund).
      const stand = await api.tour(z.tourId)
      if (stand.status === 'processing') await warteAufBereit(z.tourId)
    }
    await ladeDaten(z.tourId)
    status(
      zuLoeschen.length
        ? zuLoeschen.length === 1
          ? 'Gespeichert. 1 Aufnahme wurde endgültig gelöscht.'
          : `Gespeichert. ${zuLoeschen.length} Aufnahmen wurden endgültig gelöscht.`
        : 'Gespeichert.',
      'ok',
    )
  } catch (fehler) {
    status((fehler as Error).message, 'fehler')
  } finally {
    speichernKnopf.disabled = false
    speichernKnopf.innerHTML = beschriftung
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
function zeigeTitelImKopf(): void {
  const titel = ($('editor-titel') as HTMLInputElement).value.trim()
  $('editor-titel-knopf').textContent = titel
}

/** Tour-Einstellungen im Inspector öffnen (nicht Modal). */
function oeffneTourEinstellungen(): void {
  if (!z) return
  halteAbspielen()
  z.fokus = null
  z.tourEinstellungen = true
  renderAlles()
  ;($('editor-titel') as HTMLInputElement).focus()
}

function syncFinaleZielFeld(): void {
  const an = ($('editor-finale') as HTMLInputElement).checked
  ;($('editor-finale-ziel-feld') as HTMLElement).hidden = !an
}

async function neuVerarbeiten(): Promise<void> {
  if (!z) return
  const knopf = $('editor-neu-verarbeiten') as HTMLButtonElement
  knopf.disabled = true
  try {
    status('Tour wird neu verarbeitet (Benennung/Wetter) …')
    await api.reprocess(z.tourId)
    await warteAufBereit(z.tourId)
    await ladeDaten(z.tourId)
    status('Neu verarbeitet. Bearbeitungen sind erhalten.', 'ok')
  } catch (fehler) {
    status((fehler as Error).message, 'fehler')
  } finally {
    knopf.disabled = false
  }
}

// — Inspector-Breite ziehen —
//
// Kein Einklappen (Mockup hat einen Tab dafür; hier reicht die Breite). Eng
// begrenzt: schmal genug für die Karte, breit genug für die Felder — bewusst
// schmaler als im Mockup.

const INSP_BREITE_MIN = 280
const INSP_BREITE_MAX = 460

function verdrahteInspektorBreite(): void {
  const griff = document.getElementById('insp-griff')
  const rumpf = document.getElementById('editor-rumpf')
  if (!griff || !rumpf) return
  griff.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    e.preventDefault()
    griff.classList.add('zieht')
    rumpf.classList.add('zieht-breite')
    const zieh = (ev: PointerEvent): void => {
      const b = rumpf.getBoundingClientRect()
      const breite = Math.min(Math.max(b.right - ev.clientX, INSP_BREITE_MIN), INSP_BREITE_MAX)
      document.documentElement.style.setProperty('--inspector-breite', `${breite}px`)
      passeZeitBreiteAn()
      karte?.resize()
    }
    const los = (): void => {
      window.removeEventListener('pointermove', zieh)
      window.removeEventListener('pointerup', los)
      griff.classList.remove('zieht')
      rumpf.classList.remove('zieht-breite')
    }
    window.addEventListener('pointermove', zieh)
    window.addEventListener('pointerup', los)
  })
}

// — Einmalige Verdrahtung der statischen Editor-Elemente —

function verdrahteEinmal(): void {
  if (verdrahtet) return
  verdrahtet = true
  $('editor-zurueck').addEventListener('click', schliesse)
  $('editor-speichern').addEventListener('click', () => void speichern())
  $('editor-film').addEventListener('click', () => {
    if (!z) return
    const foto = z.daten.media.find((m) => m.type === 'photo') ?? z.daten.media[0]
    // Der Editor kennt die Filmlänge selbst — und zwar die AKTUELLE, samt
    // ungespeicherter Schnitte; `stats.filmS` vom Server ist die des letzten
    // Renders. Die Signatur hat er dagegen nicht (sie entsteht beim Anreichern).
    oeffneExportBlatt({
      id: z.tourId,
      title: z.daten.title,
      cover: foto?.thumb ?? foto?.poster ?? foto?.src ?? null,
      filmS: aktuelleAchse()?.curve?.totalS ?? null,
      finale: z.daten.finale,
    })
  })
  $('editor-titel-knopf').addEventListener('click', oeffneTourEinstellungen)
  // Was die ganze TOUR betrifft, steht im Kopf und nicht in einem „…"-Menü:
  // Zwei Einträge hinter einem Knopf, der nicht sagt, was er verbirgt, sind
  // zwei Klicks für etwas, das man auch zeigen kann.
  $('editor-einstellungen').addEventListener('click', oeffneTourEinstellungen)
  $('editor-neu-verarbeiten').addEventListener('click', () => void neuVerarbeiten())
  // Der Kopf zeigt den Titel — er muss dem Feld folgen, sonst steht dort der
  // alte Name, bis die Tour neu geladen wird.
  $('editor-titel').addEventListener('input', zeigeTitelImKopf)
  $('editor-beschreibung').addEventListener('input', zaehleBeschreibung)
  $('editor-dachzeile').addEventListener('input', markiereEbenenWahl)
  // Die Erklärungen der Tour-Einstellungen hängen an ihren Griffen (data-tipp).
  verdrahteTipps(document)
  $('editor-finale').addEventListener('change', syncFinaleZielFeld)
  $('editor-undo').addEventListener('click', rueckgaengig)
  $('editor-redo').addEventListener('click', wiederherstellen)
  verdrahteNachreichen()
  $('karte-plus').addEventListener('click', () => {
    pausiereKartenFolge()
    karte?.zoomIn()
  })
  $('karte-minus').addEventListener('click', () => {
    pausiereKartenFolge()
    karte?.zoomOut()
  })
  verdrahteStimmung()
  $('tp-play').addEventListener('click', () => void spielUmschalten())
  // Sprung an Anfang und Ende. `setzeKopfFilm` klemmt selbst auf
  // [0, gesamtS] — deshalb genügt Infinity für „ans Ende".
  $('tp-anfang').addEventListener('click', () => {
    halteAbspielen()
    setzeKopfFilm(0)
  })
  $('tp-ende').addEventListener('click', () => {
    halteAbspielen()
    setzeKopfFilm(Infinity)
  })
  $('tp-folge').addEventListener('click', () => {
    karteFolgt = !karteFolgt
    const knopf = $('tp-folge')
    knopf.classList.toggle('an', karteFolgt)
    knopf.setAttribute('aria-pressed', String(karteFolgt))
    if (karteFolgt) folgeKarte()
    else halteKartenFolge()
  })
  // Anfassen der Karte beendet die Wiedergabe (die Bahnen erledigt renderAlles
  // bzw. der Kopf-Zug selbst).
  $('editor-map').addEventListener('pointerdown', halteAbspielen)
  // Eine neue Zeigergeste hebt die Klick-Sperre auf (Capture-Phase, vor allen
  // anderen Handlern) — s. Kommentar bei `unterdrueckeKlick`.
  document.addEventListener(
    'pointerdown',
    () => {
      unterdrueckeKlick = false
    },
    true,
  )
  window.addEventListener('resize', () => {
    if (!$('editor-view').hidden) passeZeitBreiteAn()
  })
  verdrahteInspektorBreite()
  // Im Hintergrund drosselt der Browser rAF auf ~1 fps — der Kopf stünde, der
  // Ton liefe weiter. Also anhalten, wenn der Tab verschwindet.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) halteAbspielen()
  })
  document.addEventListener('keydown', (e) => {
    if (!z || $('editor-view').hidden) return
    // Großansicht fängt Esc und Pfeile ab — sonst würde die Tour scrubben
    // oder der Platzieren-Modus enden, während man noch blättert.
    const gross = document.querySelector('.gross')
    if (gross) {
      if (e.key === 'Escape') {
        e.preventDefault()
        schliesseGross()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        gross.querySelector<HTMLButtonElement>('.links')?.click()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        gross.querySelector<HTMLButtonElement>('.rechts')?.click()
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
      if (e.shiftKey) wiederherstellen()
      else rueckgaengig()
    } else if (meta && e.key.toLowerCase() === 's') {
      e.preventDefault()
      void speichern()
    } else if (meta && (e.key === '+' || e.key === '=' || e.key === '-')) {
      e.preventDefault()
      ;(e.key === '-' ? $('zoom-raus') : $('zoom-rein')).click()
    } else if (e.shiftKey && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      passeEin() // ⇧Z = an Fenster anpassen (wie in Final Cut)
    } else if (e.key === 'Escape' && z.platzieren) {
      z.platzieren = null
      renderAlles()
    } else if ((e.key === 'Backspace' || e.key === 'Delete') && z.fokus) {
      // Löscht dasselbe wie der Knopf im Inspector-Fuß
      e.preventDefault()
      loescheFokus()
    } else if (!meta && !e.altKey && !e.shiftKey) {
      const k = e.key.toLowerCase()
      if (k === 'a' || k === 'h' || k === 'z') {
        e.preventDefault()
        setzeWerkzeug(k === 'a' ? 'auswahl' : k === 'h' ? 'hand' : 'zoom')
      } else if (e.code === 'Space') {
        e.preventDefault()
        void spielUmschalten()
      } else if (k === 'l' || k === 'j' || k === 'k') {
        // Shuttle wie in Final Cut: L vorwärts, J zurück (mehrfach = schneller),
        // K hält an. Der Abspieler existiert erst nach dem ersten Play.
        // Der Deckel liegt bei 8× — dieselbe Stufe wie im Player (E16), damit
        // ein Tempo, das man hier lernt, dort auch existiert.
        e.preventDefault()
        const t = abspieler?.tempo() ?? 0
        if (k === 'k') halteAbspielen()
        else if (!abspieler) void spielUmschalten()
        else
          abspieler.setzeTempo(
            k === 'l' ? (t < 1 ? 1 : Math.min(t * 2, 8)) : t > -1 ? -1 : Math.max(t * 2, -8),
          )
      } else if (e.key === 'Home' || e.key === 'End') {
        // Den ganzen Film überspringen. Es gab dafür bisher nichts — bei
        // starkem Zoom war der Weg an den Anfang ein Zug über die halbe
        // Leiste. `setzeKopfFilm` klemmt selbst, „ans Ende" ist Infinity.
        e.preventDefault()
        halteAbspielen()
        setzeKopfFilm(e.key === 'Home' ? 0 : Infinity)
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        // Feines Scrubben mit den Pfeiltasten: fünf FILM-Sekunden je Druck
        // (≈ eine Foto-Haltebreite) — eine Minute Aufnahmezeit war auf der
        // Filmzeit-Achse mal ein Pixel, mal die halbe Leiste. Landet der
        // Schritt in einem Halt-Sprung, steht der Kopf auf dem Halt.
        e.preventDefault()
        halteAbspielen()
        const achse = aktuelleAchse()
        if (achse?.curve) {
          setzeKopfFilm(stepFilmS(achse, kopfFilm(), e.key === 'ArrowRight' ? 5 : -5))
        } else if (z.auswahl) {
          setzeMarke(z.auswahl[3] + (e.key === 'ArrowRight' ? 60 : -60))
        }
      }
    }
  })
  // ⌥ zeigt beim Zoom-Werkzeug „herauszoomen" an
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Alt' && werkzeug === 'zoom')
      document.getElementById('spuren-fenster')?.classList.add('alt')
  })
  window.addEventListener('keyup', (e) => {
    if (e.key === 'Alt') document.getElementById('spuren-fenster')?.classList.remove('alt')
  })
  // Ereignisse legt das „+"
  // der jeweiligen Bahn an. Die frühere Knopfleiste in der Sidebar ist weg.
  $('sfx-schliessen').addEventListener('click', schliesseSfxDialog)
  $('sfx-suche').addEventListener('input', (e) => {
    sfxSuche = (e.target as HTMLInputElement).value
    aktualisiereSfxTabs()
    baueSfxListe()
  })
  $('sfx-dialog').addEventListener('close', () => {
    stoppeDialogVorschau()
    // Auch bei ESC (natives close ohne schliesseSfxDialog): der nächste
    // Aufruf aus dem Spur-Menü darf nicht im Ersetzen-Modus hängen bleiben.
    sfxZiel = { modus: 'einsetzen' }
  })
  // Klick aufs Backdrop (Ziel ist dann das dialog-Element selbst) schließt
  $('sfx-dialog').addEventListener('click', (e) => {
    if (e.target === $('sfx-dialog')) schliesseSfxDialog()
  })
  $('e-audio-datei').addEventListener('change', () => {
    const eingabe = $('e-audio-datei') as HTMLInputElement
    const file = eingabe.files?.[0]
    if (file) void bibliothekHochladen(file)
    eingabe.value = ''
  })
  verdrahteZeitleiste()
}

// Debug-Handle (Konvention wie window.__j im Player) — auch fürs Browser-E2E:
// Karte und Zustand inspizieren, Track-Koordinaten in Pixel projizieren.
;(window as unknown as Record<string, unknown>)['__studio'] = {
  karte: () => karte,
  zustand: () => z,
  /** Abspielkopf: Zeit-Offset (s) — setzen scrubbt wie ein Zug am Kopf. */
  marke: (tOffsetS?: number) => {
    if (tOffsetS !== undefined) {
      halteAbspielen()
      setzeMarke(tOffsetS)
    }
    return z?.auswahl?.[3] ?? null
  },
  /** Abspielkopf in FILMsekunden — die führende Größe (fürs Browser-E2E). */
  kopfFilm: (filmS?: number) => {
    if (filmS !== undefined) {
      halteAbspielen()
      setzeKopfFilm(filmS)
    }
    return kopfFilm()
  },
  /** Wiedergabe: Tempo (0 = angehalten); mit Argument umschalten/setzen. */
  spielt: (tempo?: number) => {
    if (tempo === 1) void spielUmschalten()
    else if (tempo !== undefined) abspieler?.setzeTempo(tempo)
    return abspieler?.tempo() ?? 0
  },
  ton: () => abspieler?.tonStand() ?? null,
  /** Laufendes Panel-Vorhören (Datei, Lautstärke) — fürs Browser-E2E. */
  vorschau: () =>
    vorschau
      ? { file: vorschau.file, volume: vorschau.audio.volume, pausiert: vorschau.audio.paused }
      : null,
  laeufer: () => laeufer?.getLngLat() ?? null,
  /** Zoom als Vielfaches des eingepassten Maßstabs (1 = ganze Tour im Fenster). */
  zoom: (neu?: number) => {
    if (neu !== undefined) setzeMassstab(passMassstab() * neu, 0, spurXpx())
    return zoomFaktor()
  },
  /** Maßstab in px je Filmsekunde — die gespeicherte Zoomgröße. */
  massstab: () => pxProFilmS,
  /** Die Filmzeit-Achse samt Halt-Intervallen (fürs Browser-E2E). */
  achse: () => aktuelleAchse(),
  werkzeug: (w?: 'auswahl' | 'hand' | 'zoom') => {
    if (w) setzeWerkzeug(w)
    return werkzeug
  },
}
