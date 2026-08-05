// Studio-Editor (M7 + Kreativbaukasten): Karten-Editor über den Editor-Daten
// des Backends — Medien platzieren/verschieben/löschen, Captions, Modus- und
// Kamera-Grenzen, Musik/SFX mit Streckenbereich,
// Foto-Anzeigeoptionen. Reine Logik liegt in editmodell.ts + zeitleiste.ts;
// hier nur DOM + MapLibre. Wird aus studio.ts lazy importiert, damit MapLibre
// nur bei Bedarf ins Studio-Bundle kommt.

import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { pfad } from '../routen.js'
import * as api from './api.js'
import {
  effektiveMedien,
  isoZuOffset,
  LEERES_OVERLAY,
  materialisiereModi,
  mitAudioEintrag,
  mitAudioPatch,
  mitKameraGrenze,
  mitMedienEdit,
  mitModusGrenze,
  mitMoment,
  mitWetterGrenze,
  MOMENT_DEFAULT_S,
  ohneAudioEintrag,
  ohneKameraGrenze,
  ohneModusGrenze,
  ohneMoment,
  ohneWetterGrenze,
  offsetZuIso,
  projiziereAufTrack,
  pruefeOverlay,
  punktZuOffset,
  WETTER_MODI,
  zerlegeFuerAnzeige,
  type AudioEintrag,
  type EditOverlay,
  type EditorSegment,
  type KameraPreset,
  type MediumAnzeige,
  miniaturQuelle,
  type MediumBasis,
  type Modus,
  type MomentArt,
  type TrackPunkt,
  type WetterModus,
} from './editmodell.js'
import {
  ankerScroll,
  anteilZuFilm,
  anteilZuOffset,
  audioWirdVerworfen,
  aufnahmeHaltS,
  baueAchse,
  baueAudioBalken,
  baueBaender,
  baueFilmMassband,
  baueMedienDots,
  baueSkala,
  baueSpielKurve,
  baueZustandsBaender,
  filmBei,
  filmZuAnteil,
  filmZuOffset,
  formatiereFilmzeit,
  HALT_AUSBLEND_S,
  haltedauerS,
  klemmeGrenze,
  kumMeter,
  loeseFokusAuf as loeseFokusAufRein,
  meterZuOffset,
  musikLanes,
  offsetBeiMeter,
  offsetZuAnteil,
  schrittFilmS,
  uhrDiffZuOffset,
  type Achse,
  type Filmkurve,
  type Fokus,
  type FokusZiel,
  type ZeitSkala,
} from './zeitleiste.js'
import { KATEGORIE_NAMEN, SFX_BIBLIOTHEK, sfxEffekt, type SfxEffekt, type SfxTyp } from './sfxbibliothek.js'
import { baueStopps, dOffsetOhneCluster, meterOhneCluster, reiheVergeben, stoppVon, type Stopp } from './stopps.js'
import { beschreibeAufnahme, liesAufnahme, type ExifAufnahme } from './exif.js'
// Nur Typen — das Modul selbst wird erst beim ersten Play geladen.
import type { Abspieler, KlangMarke, MusikKlip, Spielplan, ZeigeMarke } from './abspielen.js'

/** Anzeigename eines Audio-Eintrags: Katalogname bei Bibliothek, eigener
 *  Upload ohne Datei-Endung, sonst der rohe Dateiname (tour-lokaler Altbestand). */
function audioName(a: AudioEintrag): string {
  if (a.quelle === 'bibliothek') return sfxEffekt(a.datei)?.name ?? a.datei
  if (a.quelle === 'benutzer') return a.datei.replace(/\.[^.]+$/, '')
  return a.datei
}

/** Abspiel-URL eines Audio-Eintrags — Bibliothek statisch, eigener Upload über
 *  die Konto-Route (der Player nutzt später die tour-gebundene), sonst tour-lokal. */
function audioUrl(a: AudioEintrag, tourId: string): string {
  if (a.quelle === 'bibliothek') return `/audio/sfx/${encodeURIComponent(a.datei)}`
  if (a.quelle === 'benutzer') return `/api/audio-bibliothek/${encodeURIComponent(a.datei)}`
  return `/api/media/${tourId}/${encodeURIComponent(a.datei)}`
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

// Reihenfolge bestimmt die Auswahl-Listen (Object.entries): unmotorisiert →
// motorisiert → öffentlich → Wasser.
const MODUS_NAMEN: Record<Modus, string> = {
  walk: 'Zu Fuß',
  bike: 'Rad',
  moped: 'Moped',
  jeep: 'Jeep',
  tram: 'Tram',
  ferry: 'Fähre',
}
const MODUS_FARBEN: Record<Modus, string> = {
  walk: '#3ecf8e',
  bike: '#5b9dff',
  moped: '#ff6f52',
  jeep: '#b98a5a',
  tram: '#f5a524',
  ferry: '#c58bff',
}
const PRESET_NAMEN: Record<KameraPreset, string> = { nah: 'Nah', mittel: 'Mittel', weit: 'Weit' }
/**
 * Kamera-Grundzustand: KEINE Vorgabe. Wer zuschaut, kann den Abstand im Player
 * selbst umstellen (Nah · Mittel · Weit) — solange hier nichts steht, gilt seine
 * Wahl. Eine Kamera-Grenze übersteuert sie ab ihrer Stelle.
 */
const KAMERA_STANDARD = 'Standard'
const KAMERA_STANDARD_ERKLAERT =
  'Standard — keine Vorgabe: Es gilt der Abstand, den der Zuschauer im Player einstellt (Nah, Mittel oder Weit).'
/** Anzeigenamen der Wetter-Modi (Reihenfolge = Auswahl-Liste). */
const WETTER_NAMEN: Record<WetterModus, string> = {
  off: 'Klar',
  clouds: 'Wolkig',
  fog: 'Nebel',
  rain: 'Regen',
  snow: 'Schnee',
  storm: 'Gewitter',
}
/** Wetter-Bänder: gedämpfte, mitteldunkle Füllung (helle Bandschrift bleibt lesbar). */
const WETTER_FARBEN: Record<WetterModus, string> = {
  off: 'rgba(70, 120, 175, 0.55)',
  clouds: 'rgba(120, 132, 148, 0.62)',
  fog: 'rgba(140, 150, 165, 0.55)',
  rain: 'rgba(52, 110, 200, 0.68)',
  snow: 'rgba(150, 170, 195, 0.62)',
  storm: 'rgba(96, 78, 160, 0.72)',
}
/** Standard-Wetterstärke k (Spiegel von WETTER_STANDARD_K im Server). */
const WETTER_STANDARD_K = 0.7
const MOMENT_NAMEN: Record<MomentArt, string> = { umkreisen: 'Umkreisen', aufstieg: 'Aufstieg', innehalten: 'Innehalten' }
/** Symbol je Moment-Art auf der Zeitleisten-Marke. */
const MOMENT_ZEICHEN: Record<MomentArt, string> = { umkreisen: '↻', aufstieg: '↑', innehalten: '⏸' }
/** Kamera-Bänder: ein Farbton, Deckkraft = Nähe (nah kräftig, weit zurückhaltend). */
const PRESET_FARBEN: Record<KameraPreset, string> = {
  nah: 'rgba(91, 157, 255, 0.72)',
  mittel: 'rgba(91, 157, 255, 0.46)',
  weit: 'rgba(91, 157, 255, 0.24)',
}
const PLACEMENT_NAMEN: Record<string, string> = { gps: 'GPS', zeit: 'Zeit', manuell: 'manuell', unplatziert: 'unplatziert' }
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
  daten: api.EditorDaten
  edits: EditOverlay
  /** JSON-Schnappschuss des gespeicherten Overlays (Dirty-Erkennung) */
  gespeichert: string
  /** Trackpunkte flach über alle Segmente */
  track: TrackPunkt[]
  /** Einfügemarke: Punkt AUF der Track-Linie (interpoliert, inkl. tOffset) */
  auswahl: TrackPunkt | null
  /** fokussiertes Objekt (Band, Audio-Spur, Medium) — siehe Fokus */
  fokus: Fokus | null
  /**
   * Tour-Einstellungen im Inspector (Titel/Beschreibung/Endscreen).
   * Bewusst getrennt vom Leerzustand und von `fokus`: Einstieg über Titel/„…",
   * Auswahl eines Zeitleisten-Objekts schließt die Ansicht wieder.
   */
  tourEinstellungen: boolean
  /** Medien-ID im „auf den Track klicken"-Platzieren-Modus */
  platzieren: string | null
  /** frühere Overlay-Stände (Undo), ältester zuerst */
  historie: EditOverlay[]
  /** zurückgenommene Stände (Redo), jüngster zuletzt */
  zukunft: EditOverlay[]
}

/** Maximale Undo-Tiefe — Overlays sind klein, aber unbegrenzt wächst unschön. */
const HISTORIE_MAX = 100

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
let vorschau: { audio: HTMLAudioElement; datei: string } | null = null
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
  const daten = await api.editorDaten(tourId)
  const edits = ((daten.edits as EditOverlay | null) ?? LEERES_OVERLAY)
  const einstellungenOffen = z?.tourId === tourId && z.tourEinstellungen
  z = {
    tourId,
    daten,
    edits,
    gespeichert: JSON.stringify(edits),
    track: daten.segmente.flatMap((s) => s.pts),
    // Der Abspielkopf steht von Anfang an irgendwo — die Marke ist keine
    // Sonderlage mehr, sondern die immer sichtbare Position auf der Achse.
    auswahl: null,
    fokus: null,
    tourEinstellungen: !!einstellungenOffen,
    platzieren: null,
    historie: [],
    zukunft: [],
  }
  letzterStand = edits
  ;($('editor-titel') as HTMLInputElement).value = daten.title ?? ''
  ;($('editor-beschreibung') as HTMLTextAreaElement).value = daten.description ?? ''
  const finaleAn = !!daten.finale
  ;($('editor-finale') as HTMLInputElement).checked = finaleAn
  ;($('editor-finale-ziel') as HTMLInputElement).value = daten.finaleZiel ?? ''
  ;($('editor-finale-ziel-feld') as HTMLElement).hidden = !finaleAn
  zeigeTitelImKopf()
  ;($('editor-vorschau') as HTMLAnchorElement).href = pfad('player', `?tour=srv:${tourId}`)
  ;($('editor-vorschau') as HTMLAnchorElement).style.display = daten.status === 'bereit' ? '' : 'none'

  // Streckenmeter einmal je Tour vorrechnen — die km-Anzeige am Abspielkopf
  // fragt sie bei jeder Bewegung ab.
  kumStrecke = kumMeter(z.track)
  const gesamt = document.getElementById('kopf-km-ges')
  if (gesamt) gesamt.textContent = kmText(kumStrecke[kumStrecke.length - 1] ?? 0)

  if (!karte) {
    karte = baueKarte()
    await new Promise<void>((erfuellt) => karte?.once('load', () => erfuellt()))
    baueTrackLayer(karte)
  }
  passeAusschnittAn()
  // Abspielkopf auf den Anfang der Tour stellen — er ist ab jetzt immer
  // sichtbar, nicht mehr eine Sonderlage nach dem ersten Klick.
  const skalaInit = baueSkala(z.track)
  if (skalaInit) z.auswahl = punktZuOffset(z.track, skalaInit.vonS)
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
  $('editor-view').hidden = true
  schliesseGross()
  stoppeVorschau()
  abspieler?.schliesse()
  abspieler = null
  verbergeFoto()
  karte?.remove()
  karte = null
  z = null
  letzterStand = null
  marker = new Map()
  medienMarker = new Map()
  markerZuId = new Map()
  laeufer = null
  kumStrecke = []
  pxProFilmS = 0
  einpassen = true
  kopfFilmS = null
  zurueckCb?.()
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
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
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
    paint: { 'circle-radius': 8, 'circle-color': '#ffd27a', 'circle-opacity': 0.9, 'circle-stroke-width': 2, 'circle-stroke-color': '#0a0d12' },
  })
}

/** Fokussierten Streckenabschnitt auf der Karte hervorheben. */
function zeichneFokus(): void {
  if (!karte || !z) return
  const quelle = karte.getSource('fokus') as maplibregl.GeoJSONSource | undefined
  if (!quelle) return
  const info = loeseFokusAuf()
  const features: GeoJSON.Feature[] = []
  if (info) {
    if (info.bisS > info.vonS) {
      // Ränder interpolieren, damit der Abschnitt exakt an der Bandkante endet
      // und nicht am nächsten Stützpunkt (Fähren-Geraden!)
      const punkte: TrackPunkt[] = []
      const anfang = punktZuOffset(z.track, info.vonS)
      if (anfang) punkte.push(anfang)
      for (const p of z.track) if (p[3] > info.vonS && p[3] < info.bisS) punkte.push(p)
      const ende = punktZuOffset(z.track, info.bisS)
      if (ende) punkte.push(ende)
      if (punkte.length >= 2) {
        features.push({
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: punkte.map((p) => [p[0], p[1]]) },
        })
      }
    } else {
      const p = punktZuOffset(z.track, info.vonS)
      if (p) features.push({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [p[0], p[1]] } })
    }
  }
  quelle.setData({ type: 'FeatureCollection', features })
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
  karte.fitBounds(grenzen, { padding: { top: px(70), right: px(70), bottom: px(185), left: px(70) }, duration: 0 })
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
  const projektion = projiziereAufTrack(z.track, e.lngLat.lng, e.lngLat.lat)
  if (z.platzieren) {
    z.edits = mitMedienEdit(z.edits, z.platzieren, { anchor: [projektion.punkt[0], projektion.punkt[1]] })
    z.platzieren = null
  } else {
    z.auswahl = projektion.punkt
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
  if (letzterStand && letzterStand !== z.edits) {
    z.historie.push(letzterStand)
    if (z.historie.length > HISTORIE_MAX) z.historie.shift()
    z.zukunft = []
  }
  letzterStand = z.edits
  renderHistorieKnoepfe()
  zeichneTrack()
  zeichneMarker()
  renderInspektor()
  renderZeitleiste()
  renderAblage()
  $('editor-map').classList.toggle('platzieren', z.platzieren !== null)
  $('editor-medien-hinweis').textContent = z.platzieren
    ? 'Auf den Track klicken, um das Medium dort zu verankern — erneut „Platzieren" drücken bricht ab.'
    : ''
}

// — Undo/Redo: das Overlay ist immutabel, ein Stapel von Ständen genügt —

function rueckgaengig(): void {
  const zz = z // Modul-let: Narrowing überlebt die Aufrufe unten nicht
  if (!zz?.historie.length) return
  zz.zukunft.push(zz.edits)
  zz.edits = zz.historie.pop() as EditOverlay
  letzterStand = zz.edits // der Rücksprung selbst ist kein neuer Undo-Punkt
  renderAlles()
  status('Rückgängig gemacht.')
}

function wiederherstellen(): void {
  const zz = z
  if (!zz?.zukunft.length) return
  zz.historie.push(zz.edits)
  zz.edits = zz.zukunft.pop() as EditOverlay
  letzterStand = zz.edits
  renderAlles()
  status('Wiederhergestellt.')
}

function renderHistorieKnoepfe(): void {
  if (!z) return
  ;($('editor-undo') as HTMLButtonElement).disabled = !z.historie.length
  ;($('editor-redo') as HTMLButtonElement).disabled = !z.zukunft.length
}

function zeichneTrack(): void {
  if (!karte || !z) return
  const abschnitte = zerlegeFuerAnzeige(z.daten.segmente as EditorSegment[], z.edits, z.daten.time.start)
  const quelle = karte.getSource('track') as maplibregl.GeoJSONSource
  quelle.setData({
    type: 'FeatureCollection',
    features: abschnitte.map((a) => ({
      type: 'Feature',
      properties: { farbe: MODUS_FARBEN[a.mode], aktiv: a.aktiv ? 1 : 0 },
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
    const fokusId = z.fokus?.art === 'medium' ? z.fokus.id : null
    eintrag.el.classList.toggle('an', !!fokusId && stopp.items.some((m) => m.id === fokusId))
    eintrag.el.title =
      stopp.items.length > 1
        ? `Halt mit ${stopp.items.length} Aufnahmen — ziehen verankert alle neu`
        : `${kopf.caption || kopf.id} · ${PLACEMENT_NAMEN[kopf.placement] ?? kopf.placement} — ziehen verankert neu`
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
  const thumb = kopf.type === 'photo' || kopf.poster ? miniaturQuelle(kopf) : undefined
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
      .filter((m) => m.anchor && !m.geloescht && !eigene.has(m.id))
      .map((m) => meterZuOffset(kumStrecke, z!.track, offsetVon(m)))
    const roh = projiziereAufTrack(z.track, ziel.lng, ziel.lat)
    const sicherMeter = meterOhneCluster(
      meterZuOffset(kumStrecke, z.track, roh.punkt[3]),
      fremdeMeter,
    )
    const sicher = punktZuOffset(z.track, offsetBeiMeter(kumStrecke, z.track, sicherMeter))
    if (!sicher) return
    let neu = z.edits
    for (const m of aktuell.items) {
      const dLng = (m.anchor?.[0] ?? ankerKopf[0]) - ankerKopf[0]
      const dLat = (m.anchor?.[1] ?? ankerKopf[1]) - ankerKopf[1]
      const p = projiziereAufTrack(z.track, sicher[0] + dLng, sicher[1] + dLat)
      neu = mitMedienEdit(neu, m.id, { anchor: [p.punkt[0], p.punkt[1]] })
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
    const gewaehlt = z.fokus?.art === 'medium' ? z.fokus.id : null
    const schon = eintrag.stopp.items.find((m) => m.id === gewaehlt)
    z.fokus = { art: 'medium', id: (schon ?? (eintrag.stopp.items[0] as MediumAnzeige)).id }
    renderAlles()
  })
  return eintrag
}

/** Uhrzeit in der Tour-Zone; Datum nur, wenn es vom Tour-Tag abweicht (mtime-Fallen!). */
function zeitText(iso: string): string {
  if (!z) return iso
  try {
    const zone = z.daten.time.zone
    const zeit = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: zone }).format(new Date(iso))
    const tagFmt = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', timeZone: zone })
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
function loeseFokusAuf(): FokusZiel | null {
  if (!z) return null
  return loeseFokusAufRein(
    z.fokus,
    // Anzeige-Sicht: enthält auch das automatisch ermittelte Wetter, damit ein
    // Wetterband beschrieben werden kann, bevor jemand es festschreibt.
    editsFuerAnzeige(),
    zerlegeFuerAnzeige(z.daten.segmente as EditorSegment[], z.edits, z.daten.time.start),
    z.track,
    z.daten.time.start,
    medienAnzeige(),
  )
}

/** Uhrzeit ohne Sekunden — Inspector-Zeiten sollen überfliegbar sein. */
function uhrKurz(iso: string): string {
  if (!z) return iso
  try {
    return new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: z.daten.time.zone }).format(
      new Date(iso),
    )
  } catch {
    return iso
  }
}

/**
 * Einen ganzen Stopp über die Zeitleiste ziehen.
 *
 * Gezogen wird der HALT, nicht das einzelne Bild: Aufnahmen am selben Ort
 * wandern gemeinsam. Kommt der Stopp einer fremden Aufnahme nahe, rastet er auf
 * ihr ein — „an derselben Stelle" trifft man sonst nie auf den Pixel. Eine
 * einzelne Aufnahme löst man über den Filmstreifen im Inspector heraus.
 *
 * Fenster-Listener statt Pointer-Capture (die 40-px-Miniatur verlöre schnelle
 * Züge).
 *
 * WÄHREND DES ZUGS WIRD NICHTS NEU GEBAUT — nur die Miniatur und der
 * Kartenpunkt WERDEN BEWEGT. Ein Neuaufbau der Leiste pro pointermove
 * (~46 DOM-Änderungen, dazu ein erzwungenes Layout in kuerzeBeschriftungen und
 * frische `img`-Elemente) ließ das Bild unter dem Finger zucken und die Karte
 * stehen bleiben. Geschrieben wird das Overlay erst beim Loslassen — das ist
 * zugleich genau ein Undo-Schritt.
 */
// Beim Einrasten auf einen fremden Halt: Nähe in PIXELN, nicht in Metern —
// die Zeitachse ist ungleichförmig in Metern, ein Meter-Fenster wäre mal breit,
// mal unsichtbar schmal. Eng gehalten, sonst rastet es schon ein, wenn die
// Miniaturen sich kaum berühren.
const STOPP_SNAP_PX = 4

/** Ziel-Miniatur während eines Schnapp-Zugs: leuchten + Badge mit Zielanzahl. */
function setzeSnapZiel(ziel: HTMLElement | null, neuAnzahl: number, vorher: HTMLElement | null): HTMLElement | null {
  if (vorher && vorher !== ziel) raeumeSnapZiel(vorher)
  if (!ziel) return null
  ziel.classList.add('ziel')
  let badge = ziel.querySelector<HTMLElement>('.anzahl')
  if (!badge) {
    badge = document.createElement('span')
    badge.className = 'anzahl'
    badge.dataset['vorschau'] = '1'
    ziel.appendChild(badge)
  } else if (badge.dataset['alt'] === undefined) {
    badge.dataset['alt'] = badge.textContent ?? ''
  }
  badge.textContent = String(neuAnzahl)
  return ziel
}

function raeumeSnapZiel(ziel: HTMLElement | null): void {
  if (!ziel) return
  ziel.classList.remove('ziel')
  const badge = ziel.querySelector<HTMLElement>('.anzahl')
  if (!badge) return
  if (badge.dataset['vorschau'] === '1') {
    badge.remove()
    return
  }
  if (badge.dataset['alt'] !== undefined) {
    badge.textContent = badge.dataset['alt']
    delete badge.dataset['alt']
  }
}

function ziehStopp(e: PointerEvent, stopp: Stopp): void {
  if (!z || e.button !== 0 || werkzeug !== 'auswahl') return
  e.preventDefault()
  halteAbspielen()
  const achse = aktuelleAchse()
  const skala = baueSkala(z.track)
  if (!achse || !skala) return
  const feldEl = document.getElementById('skala-feld')
  const startX = e.clientX
  // Jede Aufnahme mit ihrem AUFNAHMEZEIT-Offset — Anker bleiben Zeit, nur die
  // ANZEIGE ist film-proportional. Der ganze Stapel wird um DENSELBEN
  // Zeit-Versatz verschoben; die innere Ordnung des Stopps bleibt erhalten.
  const gruppe = stopp.items.map((m) => ({ id: m.id, offset0: offsetVon(m) }))
  const eigene = new Set(gruppe.map((g) => g.id))
  const stoppBreiteS = (s: Stopp): number =>
    s.items.reduce((summe, m) => summe + aufnahmeHaltS(m) + HALT_AUSBLEND_S, 0)
  // Einrasten auf fremde HALTE (Mitte), nicht auf jede einzelne Aufnahme —
  // sonst würde ein Mehrfach-Stopp ein breites Schnapp-Fenster aufspannen.
  const fremdeStopps = baueStopps(medienAnzeige(), z.track, kumStrecke).filter(
    (s) => !s.items.some((m) => eigene.has(m.id)),
  )
  const fremde = fremdeStopps.map((s) => {
    const kopfId = s.items[0]?.id
    return {
      anteil: offsetZuAnteil(achse, s.offsetS),
      offsetS: s.offsetS,
      anzahl: s.items.length,
      el: kopfId
        ? document.querySelector<HTMLElement>(`.f-mini[data-ids~="${CSS.escape(kopfId)}"]`)
        : null,
    }
  })
  // Für die px→Zeit-Rückrechnung eine ZIEH-Achse ohne die eigenen Halte: auf
  // der Filmzeit-Achse hat der gezogene Stopp selbst Breite (sein Sprung) —
  // auf der echten Achse gerechnet, läge um die Ruhelage eine tote Zone von
  // Sprungbreite, in der der Cursor die Zeit nicht bewegte.
  const zieh = baueAchse(
    zerlegeFuerAnzeige(z.daten.segmente as EditorSegment[], z.edits, z.daten.time.start),
    fremdeStopps.map((s) => ({ offsetS: s.offsetS, breiteS: stoppBreiteS(s) })),
    skala,
  )
  // Ruhelage der Miniatur ist die OPTISCHE Referenz (echte Achse) — so springt
  // beim Aufsetzen nichts; die Zeitrechnung referenziert die Zieh-Achse.
  const startAnteil = offsetZuAnteil(achse, stopp.offsetS)
  const startAnteilZieh = offsetZuAnteil(zieh, stopp.offsetS)
  const mini = (e.currentTarget as HTMLElement).closest<HTMLElement>('.f-mini')
  const kartenPunkt = markerZuId.get(stopp.items[0]?.id ?? '')
  const kopfOffset0 = gruppe[0]?.offset0 ?? 0
  let gezogen = false
  let letztesDOffset = 0
  let zielMini: HTMLElement | null = null
  let geschnappt = false

  const bewege = (ev: PointerEvent): void => {
    if (!z) return
    if (!gezogen && Math.abs(ev.clientX - startX) < ZUG_SCHWELLE_PX) return
    gezogen = true
    mini?.classList.add('zieht')
    const feld = feldEl?.getBoundingClientRect()
    if (!feld || feld.width <= 0) return
    // Anteil des Cursors, 1:1 in Pixeln — die Miniatur klebt unterm Finger.
    let anteil = Math.max(0, Math.min(1, startAnteil + (ev.clientX - startX) / feld.width))
    let schnappt: (typeof fremde)[number] | null = null
    let bestAb = Infinity
    for (const f of fremde) {
      const ab = Math.abs(anteil - f.anteil) * feld.width
      if (ab < bestAb && ab <= STOPP_SNAP_PX) {
        bestAb = ab
        schnappt = f
      }
    }
    if (schnappt) anteil = schnappt.anteil
    geschnappt = !!schnappt
    // Eingerastet zählt der fremde Halt SELBST — px-genau statt über Achsen
    // gerechnet; frei übersetzt die Zieh-Achse den px-Weg in Zeit.
    letztesDOffset = schnappt
      ? schnappt.offsetS - stopp.offsetS
      : anteilZuOffset(zieh, startAnteilZieh + (anteil - startAnteil)) - stopp.offsetS
    if (mini) mini.style.left = pos(anteil)
    const kopf = punktBeiOffset(kopfOffset0 + letztesDOffset)
    if (kopf) kartenPunkt?.setLngLat([kopf[0], kopf[1]])
    mini?.classList.toggle('schnappt', !!schnappt)
    // Zielstopp leuchtet; Badge zeigt die Anzahl NACH dem Ablegen.
    zielMini = setzeSnapZiel(
      schnappt?.el ?? null,
      schnappt ? schnappt.anzahl + gruppe.length : 0,
      zielMini,
    )
  }
  const los = (): void => {
    window.removeEventListener('pointermove', bewege)
    window.removeEventListener('pointerup', los)
    mini?.classList.remove('schnappt', 'zieht')
    raeumeSnapZiel(zielMini)
    zielMini = null
    if (!gezogen || !z) return
    // Ohne sichtbares Einrasten darf kein Cluster entstehen: der Drop kann in
    // Streckenmetern nah genug sein, obwohl die Miniaturen auf der Achse weit
    // auseinander wirken. Dann schieben wir knapp außerhalb von NAHE_M.
    let dOffset = letztesDOffset
    if (!geschnappt) {
      const zz = z
      const fremdeMeter = medienAnzeige()
        .filter((m) => m.anchor && !m.geloescht && !eigene.has(m.id))
        .map((m) => meterZuOffset(kumStrecke, zz.track, offsetVon(m)))
      dOffset = dOffsetOhneCluster(
        gruppe.map((g) => g.offset0),
        dOffset,
        fremdeMeter,
        kumStrecke,
        zz.track,
      )
    }
    let neu = z.edits
    for (const g of gruppe) {
      const punkt = punktBeiOffset(g.offset0 + dOffset)
      if (punkt) neu = mitMedienEdit(neu, g.id, { anchor: [punkt[0], punkt[1]] })
    }
    z.edits = neu
    unterdrueckeKlick = true
    renderAlles()
  }
  window.addEventListener('pointermove', bewege)
  window.addEventListener('pointerup', los)
}

/** Aufnahmezeit-Offset (s) einer Aufnahme (Anker auf die Linie projiziert). */
function offsetVon(m: MediumAnzeige): number {
  if (!z || !m.anchor) return 0
  return projiziereAufTrack(z.track, m.anchor[0], m.anchor[1]).punkt[3]
}

/** Trackpunkt bei einem Aufnahmezeit-Offset (s) — Umkehrung von offsetVon. */
function punktBeiOffset(offsetS: number): TrackPunkt | null {
  return z ? punktZuOffset(z.track, offsetS) : null
}

/**
 * Filmstreifen eines Stopps: zwischen seinen Aufnahmen umschalten und sie
 * umordnen. Alle Einstellungen bleiben PRO AUFNAHME — der Streifen wählt nur
 * aus, welche gerade im Inspector liegt.
 */
function baueStreifen(stopp: Stopp, aktuellId: string): HTMLElement {
  const streifen = document.createElement('div')
  streifen.className = 'streifen'
  stopp.items.forEach((m, i) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.dataset['id'] = m.id
    b.setAttribute('aria-current', String(m.id === aktuellId))
    b.title = m.caption || m.id
    const bild = document.createElement('img')
    bild.src = miniaturQuelle(m)
    bild.alt = ''
    const nr = document.createElement('span')
    nr.className = 'st-nr'
    nr.textContent = String(i + 1)
    b.append(bild, nr)
    b.addEventListener('pointerdown', (e) => ordneStreifen(e, streifen, stopp, m.id))
    b.addEventListener('click', () => {
      if (unterdrueckeKlick || !z) return
      z.fokus = { art: 'medium', id: m.id }
      renderAlles()
    })
    streifen.appendChild(b)
  })
  return streifen
}

/**
 * Im Streifen ziehen ordnet die Aufnahmen des Halts um.
 *
 * Die DOM-Folge bleibt während des Zugs UNANGETASTET: das gezogene Bild folgt
 * dem Finger, die überholten Nachbarn weichen um genau eine Position aus. Würde
 * man live umsortieren, sprängen die Rechtecke unter dem Zeiger weg.
 */
function ordneStreifen(e: PointerEvent, streifen: HTMLElement, stopp: Stopp, id: string): void {
  if (e.button !== 0 || stopp.items.length < 2) return
  e.preventDefault()
  const kinder = [...streifen.children] as HTMLElement[]
  const knopf = kinder.find((k) => k.dataset['id'] === id)
  if (!knopf) return
  const vonIdx = kinder.indexOf(knopf)
  const ersteBox = (kinder[0] as HTMLElement).getBoundingClientRect()
  const zweiteBox = kinder[1]?.getBoundingClientRect()
  const schritt = zweiteBox ? zweiteBox.left - ersteBox.left : ersteBox.width + 6
  const startX = e.clientX
  const startY = e.clientY
  let nachIdx = vonIdx
  let gezogen = false

  // Aus dem Streifen HERAUS gezogen verlässt die Aufnahme den Halt und bekommt
  // einen eigenen Ort — der Weg, einen Stapel wieder aufzulösen. Zwei Ziele
  // nehmen sie auf: die Karte (Ort zeigen) und die Foto-Spur der Zeitleiste
  // (Zeitpunkt zeigen). Beide enden im selben Anker.
  let geist: HTMLElement | null = null
  let aufKarte: { lng: number; lat: number } | null = null
  let aufZeit: number | null = null
  let marke: HTMLElement | null = null
  const kartenRect = (): DOMRect | undefined => document.getElementById('editor-map')?.getBoundingClientRect()

  /** Bild an den Zeiger hängen und den Streifen in Ruhe lassen. */
  const zeigeGeist = (ev: PointerEvent): void => {
    for (const kk of kinder) kk.style.transform = ''
    knopf.classList.remove('zieht')
    nachIdx = vonIdx
    if (!geist) {
      geist = document.createElement('div')
      geist.className = 'zieh-geist'
      const bild = document.createElement('img')
      bild.src = (knopf.querySelector('img') as HTMLImageElement | null)?.src ?? ''
      bild.alt = ''
      geist.appendChild(bild)
      document.body.appendChild(geist)
    }
    geist.style.left = `${ev.clientX}px`
    geist.style.top = `${ev.clientY}px`
  }
  const raeumeGeist = (): void => {
    geist?.remove()
    geist = null
    marke?.remove()
    marke = null
    aufKarte = null
    aufZeit = null
  }

  const zieh = (ev: PointerEvent): void => {
    if (!gezogen && Math.abs(ev.clientX - startX) < 5 && Math.abs(ev.clientY - startY) < 5) return
    gezogen = true
    // Zuerst die Zeitleiste: sie liegt näher am Streifen als die Karte.
    const bahn = document.getElementById('spur-fotos')?.getBoundingClientRect()
    const skala = aktuelleAchse()
    const ueberBahn =
      !!bahn && !!skala && ev.clientX >= bahn.left && ev.clientX <= bahn.right && ev.clientY >= bahn.top - 20 && ev.clientY <= bahn.bottom + 20
    if (ueberBahn && skala) {
      zeigeGeist(ev)
      aufKarte = null
      aufZeit = anteilZuOffset(skala, spurAnteil(ev.clientX))
      if (!marke) {
        marke = document.createElement('div')
        marke.className = 'ablege-marke'
        document.getElementById('spuren')?.appendChild(marke)
      }
      marke.style.left = zeitX(offsetZuAnteil(skala, aufZeit))
      return
    }
    const k = kartenRect()
    const ueberKarte = !!k && ev.clientX >= k.left && ev.clientX <= k.right && ev.clientY >= k.top && ev.clientY <= k.bottom
    if (ueberKarte && karte) {
      zeigeGeist(ev)
      marke?.remove()
      marke = null
      aufZeit = null
      const p = karte.unproject([ev.clientX - (k as DOMRect).left, ev.clientY - (k as DOMRect).top])
      aufKarte = { lng: p.lng, lat: p.lat }
      return
    }
    if (geist) raeumeGeist()
    const dx = ev.clientX - startX
    knopf.classList.add('zieht')
    knopf.style.transform = `translateX(${dx}px) scale(1.06)`
    nachIdx = Math.min(Math.max(Math.round((vonIdx * schritt + dx) / schritt), 0), kinder.length - 1)
    for (const [i, k2] of kinder.entries()) {
      if (k2 === knopf) continue
      const v = i > vonIdx && i <= nachIdx ? -schritt : i >= nachIdx && i < vonIdx ? schritt : 0
      k2.style.transform = v ? `translateX(${v}px)` : ''
    }
  }
  const los = (): void => {
    window.removeEventListener('pointermove', zieh)
    window.removeEventListener('pointerup', los)
    // VOR dem Aufräumen sichern
    const imOrt = aufKarte
    const zurZeit = aufZeit
    geist?.remove()
    marke?.remove()
    for (const k of kinder) {
      k.style.transform = ''
      k.classList.remove('zieht')
    }
    if (!gezogen || !z) return
    // `reihe` fällt weg: die Aufnahme gehört zu keinem Stapel mehr, in dem eine
    // Reihenfolge gälte. Ohne Snap-UI: nicht ungewollt mit einem Nachbarn clustern.
    const loeseHeraus = (lng: number, lat: number): void => {
      if (!z) return
      unterdrueckeKlick = true
      const roh = projiziereAufTrack(z.track, lng, lat)
      const fremdeMeter = medienAnzeige()
        .filter((m) => m.anchor && !m.geloescht && m.id !== id)
        .map((m) => meterZuOffset(kumStrecke, z!.track, offsetVon(m)))
      const sicherMeter = meterOhneCluster(meterZuOffset(kumStrecke, z.track, roh.punkt[3]), fremdeMeter)
      const sicher = punktZuOffset(z.track, offsetBeiMeter(kumStrecke, z.track, sicherMeter))
      if (!sicher) return
      z.edits = mitMedienEdit(z.edits, id, { anchor: [sicher[0], sicher[1]], reihe: undefined })
      z.fokus = { art: 'medium', id }
      renderAlles()
    }
    if (zurZeit !== null) {
      const p = punktBeiOffset(zurZeit)
      if (p) loeseHeraus(p[0], p[1])
      return
    }
    if (imOrt) {
      const p = projiziereAufTrack(z.track, imOrt.lng, imOrt.lat)
      loeseHeraus(p.punkt[0], p.punkt[1])
      return
    }
    if (nachIdx === vonIdx) return
    unterdrueckeKlick = true
    const folge = kinder.map((k) => k.dataset['id'] as string)
    folge.splice(nachIdx, 0, folge.splice(vonIdx, 1)[0] as string)
    z.edits = reiheVergeben(z.edits, folge)
    renderAlles()
  }
  window.addEventListener('pointermove', zieh)
  window.addEventListener('pointerup', los)
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
    .querySelectorAll<HTMLElement>('.spur-plus[aria-expanded="true"], #ablage-knopf[aria-expanded="true"], #editor-mehr[aria-expanded="true"]')
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
  inhalt.style.top = untenPlatz > hoehe + 12 ? `${Math.round(r.bottom + 6)}px` : `${Math.round(Math.max(8, r.top - hoehe - 6))}px`
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
  const skala = baueSkala(z.track)
  return skala?.vonS ?? 0
}

function oeffneSpurMenue(spur: string, knopf: HTMLElement): void {
  if (!z) return
  const start = z.daten.time.start
  const abS = markeOffset()
  const ab = offsetZuIso(start, abS)
  const menue = document.createElement('div')
  menue.className = 'schwebe-menue'
  const kopf = document.createElement('div')
  kopf.className = 'kopfzeile'
  kopf.textContent = `ab ${uhrzeitKurz(ab)} Uhr`
  menue.appendChild(kopf)

  if (spur === 'wege') {
    for (const [wert, name] of Object.entries(MODUS_NAMEN)) {
      menue.appendChild(
        menueEintrag(name, () => {
          if (!z) return
          z.edits = mitModusGrenze(z.edits, ab, wert as Modus)
          z.fokus = { art: 'modus', bezugS: abS + 1 }
          renderAlles()
        }, MODUS_FARBEN[wert as Modus]),
      )
    }
  } else if (spur === 'kamera') {
    for (const [wert, name] of Object.entries(PRESET_NAMEN)) {
      menue.appendChild(
        menueEintrag(`Kamera ${name}`, () => {
          if (!z) return
          z.edits = mitKameraGrenze(z.edits, ab, wert as KameraPreset)
          z.fokus = { art: 'kamera', bezugS: abS + 1 }
          renderAlles()
        }, PRESET_FARBEN[wert as KameraPreset]),
      )
    }
  } else if (spur === 'wetter') {
    for (const [wert, name] of Object.entries(WETTER_NAMEN)) {
      menue.appendChild(
        menueEintrag(name, () => {
          if (!z) return
          // Erst die automatisch ermittelte Einteilung festschreiben, sonst
          // machte die neue Grenze den Rest der Tour schlagartig klar.
          schreibeWetterFest()
          z.edits = mitWetterGrenze(z.edits, ab, wert as WetterModus)
          z.fokus = { art: 'wetter', bezugS: abS + 1 }
          renderAlles()
        }, WETTER_FARBEN[wert as WetterModus]),
      )
    }
  } else if (spur === 'momente') {
    for (const [wert, name] of Object.entries(MOMENT_NAMEN)) {
      menue.appendChild(
        menueEintrag(`${MOMENT_ZEICHEN[wert as MomentArt]}  ${name}`, () => {
          if (!z) return
          z.edits = mitMoment(z.edits, ab, wert as MomentArt)
          z.fokus = { art: 'moment', ab }
          renderAlles()
        }),
      )
    }
  } else if (spur === 'musik') {
    menue.appendChild(menueEintrag('Aus der Bibliothek …', () => oeffneSfxDialog()))
    menue.appendChild(menueEintrag('Datei hochladen …', () => $('e-audio-datei').click()))
    // Tour-lokal hochgeladene, aber nicht eingesetzte Dateien direkt anbieten
    // (Altbestand — neue Uploads landen in der benutzerweiten Bibliothek)
    const benutzt = new Set((z.edits.audio ?? []).map((a) => a.datei))
    const frei = (z.daten.audio ?? []).filter((d) => !benutzt.has(d.datei))
    if (frei.length) {
      const trenner = document.createElement('div')
      trenner.className = 'trenner'
      menue.appendChild(trenner)
      for (const d of frei) {
        const zeile = menueEintrag(d.datei, () => {
          if (!z) return
          z.edits = mitAudioEintrag(z.edits, { datei: d.datei, typ: 'musik', ab })
          z.fokus = { art: 'audio', index: (z.edits.audio ?? []).length - 1 }
          renderAlles()
        })
        const weg = document.createElement('button')
        weg.className = 'weg'
        weg.type = 'button'
        weg.textContent = 'löschen'
        weg.title = `${d.datei} vom Server löschen (${(d.groesse / 1048576).toFixed(1)} MB)`
        weg.addEventListener('click', (e) => {
          e.stopPropagation()
          schliesseSpurMenue()
          void audioDateiLoeschen(d.datei)
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

function ablageMedien(): MediumAnzeige[] {
  return medienAnzeige().filter((m) => m.geloescht || !m.anchor)
}

/** Einmal je geöffneter Tour meldet sich die Ablage von selbst. */
let gemeldeteAblage = false

function renderAblage(): void {
  const knopf = $('ablage-knopf')
  const medien = ablageMedien()
  knopf.hidden = medien.length === 0
  // Ohne Ort ≠ entfernt: Ersteres ist ein FUND (die Aufnahme fehlt im Film,
  // ohne dass jemand das wollte), Letzteres eine Entscheidung. Nur der Fund
  // meldet sich laut — sonst übersieht man ihn zwischen leeren Bahnen.
  const ohneOrt = medien.filter((m) => !m.geloescht).length
  knopf.classList.toggle('warnt', ohneOrt > 0)
  $('ablage-anzahl').textContent = ohneOrt
    ? ohneOrt === 1
      ? '1 Aufnahme ohne Ort'
      : `${ohneOrt} Aufnahmen ohne Ort`
    : medien.length === 1
      ? '1 entfernte Aufnahme'
      : `${medien.length} entfernte Aufnahmen`
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
    b.className = m.geloescht ? 'geloescht' : ''
    b.title = m.geloescht ? `${m.caption || m.id} — entfernt` : `${m.caption || m.id} — ohne Ort`
    b.dataset['id'] = m.id
    const bild = document.createElement('img')
    bild.src = miniaturQuelle(m)
    bild.alt = ''
    b.appendChild(bild)
    b.addEventListener('pointerdown', (e) => zieheAusAblage(e, m))
    raster.appendChild(b)
  }
  menue.appendChild(raster)
  zeigeSchwebeMenue(menue, knopf)
}

/**
 * Eine Aufnahme aus der Ablage auf die Zeitleiste ziehen. Über Fenster-Listener
 * (der 54-px-Knopf verlöre bei schnellen Bewegungen die Capture); losgelassen
 * über der Foto-Bahn bekommt sie dort ihren Anker — und ist damit wieder dabei.
 */
function zieheAusAblage(e: PointerEvent, m: MediumAnzeige): void {
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
      bild.src = miniaturQuelle(m)
      bild.alt = ''
      geist.appendChild(bild)
      document.body.appendChild(geist)
    }
    geist.style.left = `${ev.clientX}px`
    geist.style.top = `${ev.clientY}px`
    const bahn = document.getElementById('spur-fotos')?.getBoundingClientRect()
    const skala = aktuelleAchse()
    const ueberBahn =
      bahn && skala && ev.clientX >= bahn.left && ev.clientX <= bahn.right && ev.clientY >= bahn.top - 20 && ev.clientY <= bahn.bottom + 20
    if (ueberBahn) {
      zielOffsetS = anteilZuOffset(skala, spurAnteil(ev.clientX))
      if (!marke) {
        marke = document.createElement('div')
        marke.className = 'ablege-marke'
        document.getElementById('spuren')?.appendChild(marke)
      }
      marke.style.left = zeitX(offsetZuAnteil(skala, zielOffsetS))
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
    const roh = punktZuOffset(z.track, abgelegtBei)
    if (!roh) return
    // Ablage hat kein Snap — nicht still mit einem Nachbarn clustern.
    const fremdeMeter = medienAnzeige()
      .filter((x) => x.anchor && !x.geloescht && x.id !== m.id)
      .map((x) => meterZuOffset(kumStrecke, z!.track, offsetVon(x)))
    const sicherMeter = meterOhneCluster(meterZuOffset(kumStrecke, z.track, roh[3]), fremdeMeter)
    const punkt = punktZuOffset(z.track, offsetBeiMeter(kumStrecke, z.track, sicherMeter))
    if (!punkt) return
    // Wieder dabei: Anker setzen und, falls es entfernt war, zurückholen
    z.edits = mitMedienEdit(z.edits, m.id, { anchor: [punkt[0], punkt[1]], geloescht: false })
    z.fokus = { art: 'medium', id: m.id }
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
function auswahl(werte: Array<[string, string]>, aktuell: string | undefined, leerText?: string): HTMLSelectElement {
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
 * (uhrDiffZuOffset) — das ist DST-fest und übersteht Mitternacht.
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
  eingabe.value = uhrzeitKurz(offsetZuIso(z?.daten.time.start ?? '', offsetS))
  let aktuellS = offsetS

  /** Neuen Wert anwenden und das Feld auf den tatsächlich geltenden Stand ziehen. */
  const anwenden = (neuOffsetS: number): void => {
    const gilt = beiAenderung(neuOffsetS)
    if (gilt !== null) aktuellS = gilt
    eingabe.value = uhrzeitKurz(offsetZuIso(z?.daten.time.start ?? '', aktuellS))
  }

  eingabe.addEventListener('change', () => {
    const neu = uhrDiffZuOffset(aktuellS, uhrzeitKurz(offsetZuIso(z?.daten.time.start ?? '', aktuellS)), eingabe.value)
    if (neu === null) eingabe.value = uhrzeitKurz(offsetZuIso(z?.daten.time.start ?? '', aktuellS))
    else { anwenden(neu); beiZugEnde?.() }
  })
  eingabe.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { eingabe.blur(); return }
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    e.preventDefault()
    anwenden(aktuellS + (e.key === 'ArrowUp' ? 60 : -60))
    beiZugEnde?.()
  })

  const stepper = document.createElement('div')
  stepper.className = 'zf-step'
  for (const [label, richtung] of [['Eine Minute später', 60], ['Eine Minute früher', -60]] as const) {
    const b = document.createElement('button')
    b.type = 'button'
    b.setAttribute('aria-label', label)
    b.tabIndex = -1
    b.addEventListener('click', () => { anwenden(aktuellS + richtung); beiZugEnde?.() })
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
  const bezugS = (info.vonS + info.bisS) / 2

  // — Kopf: nur die Art (Kicker). Kein zweiter Titel wie „Wetter Klar" —
  // die Einstellungen darunter legen das bereits fest.
  const kicker = document.createElement('div')
  kicker.className = 'insp-art'
  kicker.append(ART_NAMEN[info.art])
  inhalt.append(kicker)

  // — Werte je Art —
  if (info.art === 'modus' || info.art === 'kamera') {
    const istModus = info.art === 'modus'
    const werte = istModus ? Object.entries(MODUS_NAMEN) : Object.entries(PRESET_NAMEN)
    const aktuell = istModus ? (info.mode as string | undefined) : (info.preset as string | undefined)
    const wahl = auswahl(werte, aktuell, aktuell === undefined ? `${KAMERA_STANDARD} — Zuschauer entscheidet` : undefined)
    wahl.addEventListener('change', () => {
      if (!z || !wahl.value) return
      // Ohne eigene Grenze (Band aus der Aufzeichnung) wird am Bandanfang eine
      // neue gesetzt — so lässt sich JEDER Abschnitt direkt umstellen.
      const ab = info.ab ?? offsetZuIso(start, info.vonS)
      z.edits = istModus
        ? mitModusGrenze(z.edits, ab, wahl.value as Modus)
        : mitKameraGrenze(z.edits, ab, wahl.value as KameraPreset, info.staerke)
      z.fokus = istModus ? { art: 'modus', bezugS } : { art: 'kamera', bezugS }
      renderAlles()
    })
    // „Art" statt einer Wiederholung des Panel-Titels — der sagt schon, worum es geht.
    inhalt.appendChild(feld(istModus ? 'Art' : 'Kamera-Abstand', wahl))

    if (!istModus && info.preset) {
      const ab = info.ab ?? offsetZuIso(start, info.vonS)
      const preset = info.preset
      inhalt.appendChild(
        feld(
          'Näher ↔ Weiter',
          regler({ min: 50, max: 200, step: 5, wert: Math.round((info.staerke ?? 1) * 100) }, (v) => `${v} %`, (v) => {
            if (!z) return
            z.edits = mitKameraGrenze(z.edits, ab, preset, v / 100)
            z.fokus = { art: 'kamera', bezugS }
            renderAlles()
          }),
        ),
      )
    }
  } else if (info.art === 'wetter') {
    const wahl = auswahl(Object.entries(WETTER_NAMEN), info.wetterMode, info.wetterMode ? undefined : 'Automatisch')
    wahl.addEventListener('change', () => {
      if (!z || !wahl.value) return
      // Ändern übernimmt die bisher automatische Einteilung ins Overlay: dieses
      // ersetzt das Auto-Wetter serverseitig VOLLSTÄNDIG. Stärke bei „Klar" weg.
      schreibeWetterFest()
      const ab = info.ab ?? offsetZuIso(start, info.vonS)
      const neu = wahl.value as WetterModus
      z.edits = mitWetterGrenze(z.edits, ab, neu, neu === 'off' ? undefined : info.staerke)
      z.fokus = { art: 'wetter', bezugS }
      renderAlles()
    })
    inhalt.appendChild(feld('Wetterlage', wahl))
    if (!(z.edits.wetter ?? []).length && info.wetterMode) {
      inhalt.appendChild(
        hinweis('Automatisch ermittelt aus dem Wetterarchiv, an den Fotos nachgeschärft. Die erste Änderung übernimmt die ganze Einteilung zur Bearbeitung.'),
      )
    }
    if (info.wetterMode && info.wetterMode !== 'off') {
      const ab = info.ab ?? offsetZuIso(start, info.vonS)
      const mode = info.wetterMode
      inhalt.appendChild(
        feld(
          'Stärke',
          regler(
            { min: 0, max: 100, step: 10, wert: Math.round((info.staerke ?? WETTER_STANDARD_K) * 100) },
            (v) => `${v} %`,
            (v) => {
              if (!z) return
              z.edits = mitWetterGrenze(z.edits, ab, mode, v / 100)
              z.fokus = { art: 'wetter', bezugS }
              renderAlles()
            },
          ),
        ),
      )
    }
  } else if (info.art === 'moment') {
    const abFest = info.ab as string
    const wahl = auswahl(Object.entries(MOMENT_NAMEN), info.momentArt)
    wahl.addEventListener('change', () => {
      if (!z) return
      z.edits = mitMoment(z.edits, abFest, wahl.value as MomentArt, info.dauerS)
      renderAlles()
    })
    inhalt.appendChild(feld('Was die Kamera tut', wahl))
    const dauer = document.createElement('input')
    dauer.type = 'number'
    dauer.min = '1'
    dauer.max = '30'
    dauer.value = info.dauerS !== undefined ? String(info.dauerS) : ''
    dauer.placeholder = `${MOMENT_DEFAULT_S[info.momentArt as MomentArt]} (Standard)`
    dauer.addEventListener('change', () => {
      if (!z) return
      const v = dauer.value.trim() === '' ? undefined : Math.max(1, Math.min(30, Number(dauer.value)))
      z.edits = mitMoment(z.edits, abFest, info.momentArt as MomentArt, v)
      renderAlles()
    })
    inhalt.appendChild(feld('Dauer in Sekunden', dauer))
  } else if (info.art === 'audio') {
    const index = info.index as number
    const eintrag = (z.edits.audio ?? [])[index]
    if (eintrag) inhalt.appendChild(baueAudioFelder(index, eintrag))
  } else {
    const medium = medienAnzeige().find((m) => m.id === info.id)
    if (medium) inhalt.appendChild(baueMediumFelder(medium))
  }

  // — Zeiten: Beginn und Ende, beides bearbeitbar, wo eine Grenze dahintersteht —
  if (info.art !== 'medium') inhalt.appendChild(baueZeiten(info))

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
const ART_NAMEN: Record<FokusZiel['art'], string> = {
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
function baueZeiten(info: FokusZiel): HTMLElement {
  const paar = document.createElement('div')
  paar.className = 'zeit-paar'
  const punktEreignis = info.bisS <= info.vonS

  const beginn =
    info.ab && info.art !== 'audio' && info.art !== 'medium'
      ? feld(punktEreignis ? 'Zeitpunkt' : 'Beginnt um', grenzZeitfeld(info.art as GrenzArt, info.ab, info.vonS, (neu) => (neu + info.bisS) / 2))
      : feld('Beginnt', zeitFest(info.art === 'modus' ? 'aus der Aufzeichnung' : 'mit dem Tourbeginn'))

  if (info.art === 'audio') {
    const index = info.index as number
    paar.append(
      feld('Beginnt um', baueZeitfeld(info.vonS, (neu) => audioZeitSetzen(index, 'ab', neu))),
      feld(
        'Endet um',
        (z?.edits.audio ?? [])[index]?.typ === 'sfx'
          ? zeitFest('Effekt, keine Dauer')
          : baueZeitfeld(info.bisS, (neu) => audioZeitSetzen(index, 'bis', neu)),
      ),
    )
    return paar
  }

  paar.appendChild(beginn)
  if (!punktEreignis) {
    paar.appendChild(
      info.naechsteAb
        ? feld('Endet um', grenzZeitfeld(info.art as GrenzArt, info.naechsteAb, info.bisS, (neu) => (info.vonS + neu) / 2))
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
function grenzZeitfeld(art: GrenzArt, ab: string, offsetS: number, bezug: (neuOffsetS: number) => number): HTMLElement {
  let abAktuell = ab
  return baueZeitfeld(
    offsetS,
    (neu) => {
      if (!z) return null
      const neuAb = verschiebeGrenze(art, abAktuell, neu)
      if (!neuAb) return null
      abAktuell = neuAb
      if (art !== 'moment') z.fokus = { art, bezugS: bezug(neu) }
      renderOhneInspektor()
      return isoZuOffset(z.daten.time.start, neuAb)
    },
    () => renderAlles(),
  )
}

/** Audio-Anfang/-Ende setzen (geklemmt gegen die eigene Spanne). */
function audioZeitSetzen(index: number, teil: 'ab' | 'bis', neuOffsetS: number): number | null {
  if (!z) return null
  const skala = baueSkala(z.track)
  const a = (z.edits.audio ?? [])[index]
  if (!skala || !a) return null
  const start = z.daten.time.start
  const vonS = isoZuOffset(start, a.ab)
  const bisS = a.bis !== undefined ? isoZuOffset(start, a.bis) : skala.bisS
  const geklemmt =
    teil === 'ab'
      ? Math.max(skala.vonS, Math.min(neuOffsetS, bisS - 5))
      : Math.max(vonS + 5, Math.min(neuOffsetS, skala.bisS))
  if (teil === 'ab') {
    const patch: { ab: string; bis?: string } = { ab: offsetZuIso(start, geklemmt) }
    // Musik behält ihre Länge beim Verschieben des Anfangs
    if (a.typ === 'musik' && a.bis !== undefined) patch.bis = offsetZuIso(start, geklemmt + (bisS - vonS))
    z.edits = mitAudioPatch(z.edits, index, patch)
  } else {
    z.edits = mitAudioPatch(z.edits, index, { bis: geklemmt >= skala.bisS - 1 ? undefined : offsetZuIso(start, geklemmt) })
  }
  renderAlles()
  return geklemmt
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

async function ladeAufnahmeDaten(m: MediumAnzeige): Promise<ExifAufnahme | null> {
  try {
    const antwort = await fetch(m.src, { credentials: 'same-origin', headers: { range: `bytes=0-${EXIF_BYTES - 1}` } })
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
function fuelleInfoRaster(raster: HTMLElement, m: MediumAnzeige, exif: ExifAufnahme | null | undefined): void {
  raster.innerHTML = ''
  raster.appendChild(infoZeile('Aufgenommen', `${zeitText(m.takenAt)} Uhr`))
  raster.appendChild(infoZeile('Verortet über', PLACEMENT_NAMEN[m.placement] ?? m.placement))
  if (m.anchor) {
    raster.appendChild(infoZeile('Koordinaten', `${m.anchor[1].toFixed(5)}, ${m.anchor[0].toFixed(5)}`))
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
          : 'Das Foto trägt keine Kameradaten — viele Dienste entfernen sie beim Export.'
        : 'Aus der Datei gelesen. Die Aufnahmezeit selbst lässt sich nicht ändern — verschiebe den Ort, um sie umzuhängen.'
  raster.appendChild(fuss)
}

/** Ausklappbarer Info-Bereich einer Aufnahme (nativ über <details>). */
function baueInfoBereich(m: MediumAnzeige): HTMLElement {
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
function audioHerkunft(a: AudioEintrag): string {
  if (a.quelle === 'bibliothek') {
    const eff = sfxEffekt(a.datei)
    return eff ? `${KATEGORIE_NAMEN[eff.kategorie]} · ${eff.beschreibung}` : 'Bibliothek'
  }
  if (a.quelle === 'benutzer') {
    const eintrag = bibliothek?.find((d) => d.datei === a.datei)
    return eintrag ? `Eigener Upload · ${(eintrag.groesse / 1048576).toFixed(1)} MB` : 'Eigener Upload'
  }
  return 'In dieser Tour hochgeladen'
}

/** Felder eines Audio-Eintrags — früher nur über das Sidebar-Panel erreichbar. */
function baueAudioFelder(index: number, a: AudioEintrag): HTMLElement {
  const huelle = document.createElement('div')
  huelle.style.display = 'contents'

  // — Das Stück selbst: was läuft, woher es kommt — und der Griff zum Tausch.
  // „Ändern …" öffnet die Bibliothek im Ersetzen-Modus: die Platzierung
  // (ab/bis/Lautstärke) bleibt, nur die Datei wird ausgetauscht.
  const stueck = document.createElement('div')
  stueck.className = 'insp-stueck'
  const laeuft = vorschau?.datei === a.datei
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
  wechseln.title = 'Anderes Stück aus der Bibliothek wählen — die Platzierung bleibt'
  wechseln.addEventListener('click', () => oeffneSfxDialog({ modus: 'ersetzen', index }))
  stueck.append(hoeren, text, wechseln)
  huelle.appendChild(stueck)

  const typ = auswahl([['musik', 'Musik (über eine Strecke)'], ['sfx', 'Effekt (ein Zeitpunkt)']], a.typ)
  typ.addEventListener('change', () => {
    if (!z) return
    const neu = typ.value as 'musik' | 'sfx'
    // Wechsel zu „Effekt" wirft das Ende weg — ein Zeitpunkt hat keine Dauer
    z.edits = mitAudioPatch(z.edits, index, neu === 'sfx' ? { typ: neu, bis: undefined } : { typ: neu })
    renderAlles()
  })
  huelle.appendChild(feld('Art', typ))

  huelle.appendChild(
    feld(
      'Lautstärke',
      regler(
        { min: 0, max: 100, step: 5, wert: Math.round((a.lautstaerke ?? 0.8) * 100) },
        (v) => `${v} %`,
        (v) => {
          if (!z) return
          z.edits = mitAudioPatch(z.edits, index, { lautstaerke: v / 100 })
          renderAlles()
        },
        // Läuft gerade das Vorhören dieses Eintrags, folgt es dem Zug sofort —
        // so stellt man die Lautstärke nach Gehör ein, nicht nach Zahl.
        (v) => {
          if (vorschau?.datei === a.datei) vorschau.audio.volume = v / 100
        },
      ),
    ),
  )

  if (z && audioWirdVerworfen(a, z.edits, z.daten.time.start, baueSkala(z.track) ?? { vonS: 0, bisS: 0 })) {
    const warn = document.createElement('p')
    warn.className = 'insp-warnung'
    warn.textContent = 'Liegt außerhalb der Tour und wird beim Rendern verworfen.'
    huelle.appendChild(warn)
  }
  return huelle
}

/** Felder einer Aufnahme — früher nur über die Medien-Liste erreichbar. */
function baueMediumFelder(m: MediumAnzeige): HTMLElement {
  const huelle = document.createElement('div')
  huelle.style.display = 'contents'

  // Gehört die Aufnahme zu einem Halt mit mehreren Bildern? Dann oben ein
  // Filmstreifen zum Umschalten und Umordnen — die Felder darunter gehören
  // weiterhin dem EINEN gewählten Bild (auch die Standzeit).
  const stopp = z ? stoppVon(baueStopps(medienAnzeige(), z.track, kumStrecke), m.id) : undefined
  if (stopp && stopp.items.length > 1) huelle.appendChild(baueStreifen(stopp, m.id))

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

  // Der Nutzertext wird beim Rendern zur ÜBERSCHRIFT des Foto-Stopps, die
  // Uhrzeit rutscht darunter — deshalb hier „Titel", nicht „Bildunterschrift".
  const titel = document.createElement('input')
  titel.type = 'text'
  titel.value = m.caption
  titel.placeholder = 'ohne Titel'
  titel.addEventListener('change', () => {
    if (!z) return
    z.edits = mitMedienEdit(z.edits, m.id, { caption: titel.value.trim() })
    renderAlles()
  })
  huelle.appendChild(
    feld('Titel', titel, 'Erscheint im Film als Überschrift des Foto-Stopps; die Uhrzeit rutscht darunter.'),
  )

  if (m.type === 'photo') {
    const halt = auswahl(
      [['', 'Automatisch (5 s)'], ['3', '3 Sekunden'], ['5', '5 Sekunden'], ['8', '8 Sekunden'], ['12', '12 Sekunden'], ['20', '20 Sekunden']],
      m.display?.holdS !== undefined ? String(m.display.holdS) : '',
    )
    halt.addEventListener('change', () => {
      if (!z) return
      const v = halt.value === '' ? undefined : Number(halt.value)
      const d = { ...m.display }
      if (v === undefined) delete d.holdS
      else d.holdS = v
      z.edits = mitMedienEdit(z.edits, m.id, { display: d })
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
      z.edits = mitMedienEdit(z.edits, m.id, { display: d })
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
    platzieren.textContent = z?.platzieren === m.id ? 'Platzieren abbrechen' : 'Auf der Karte platzieren'
    if (z?.platzieren === m.id) platzieren.classList.add('aktiv')
    platzieren.addEventListener('click', () => {
      if (!z) return
      z.platzieren = z.platzieren === m.id ? null : m.id
      renderAlles()
    })
    knoepfe.appendChild(platzieren)
  }
  if (m.placement === 'manuell') {
    const zurueck = document.createElement('button')
    zurueck.textContent = 'Automatischen Ort zurückholen'
    zurueck.addEventListener('click', () => {
      if (!z) return
      z.edits = mitMedienEdit(z.edits, m.id, { anchor: undefined })
      renderAlles()
    })
    knoepfe.appendChild(zurueck)
  }
  if (knoepfe.childElementCount) huelle.appendChild(knoepfe)

  huelle.appendChild(baueInfoBereich(m))

  if (stopp && stopp.items.length > 1) {
    // Was der Halt im fertigen Film wirklich kostet: die Summe seiner
    // Aufnahmen — ein Video mit seiner Laufzeit, ein Foto mit seiner Standzeit.
    const summe = stopp.items.reduce((sum, x) => sum + aufnahmeHaltS(x), 0)
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
      'Im Streifen ziehen ordnet die Aufnahmen um. Ein Zug in der Zeitleiste oder auf der Karte bewegt den ganzen Halt — eine einzelne Aufnahme löst du heraus, indem du sie aus dem Streifen auf die Karte ziehst.'
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
    const meter = meterZuOffset(kumStrecke, z.track, offsetVon(m))
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
function grossListe(): MediumAnzeige[] {
  if (!z) return []
  const alle = medienAnzeige().filter((m) => !m.geloescht)
  const stopps = baueStopps(alle, z.track, kumStrecke)
  const gesehen = new Set<string>()
  const liste: MediumAnzeige[] = []
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
function loeschInfo(info: FokusZiel): { text: string; gesperrt: boolean; grund?: string } {
  if (info.art === 'medium') {
    const m = medienAnzeige().find((x) => x.id === info.id)
    return { text: m?.type === 'video' ? 'Video entfernen' : 'Foto entfernen', gesperrt: false }
  }
  if (info.art === 'audio') return { text: 'Aus der Tour nehmen', gesperrt: false }
  if (info.art === 'moment') return { text: 'Moment entfernen', gesperrt: false }
  if (info.ab === null) {
    return {
      text: 'Abschnitt entfernen',
      gesperrt: true,
      grund: 'Der erste Zustand deckt die Tour von Anfang an — er lässt sich nur ändern.',
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
  // Beim Modus zählt die Kante, nicht das Band: fällt sie weg, gilt der Modus
  // davor weiter. Für erkannte Kanten muss die Aufteilung erst festgeschrieben
  // sein, sonst gäbe es gar nichts zu entfernen.
  if (info.art === 'modus' && info.ab) {
    if (!schreibeModiFest(info.ab)) return
    z.edits = ohneModusGrenze(z.edits, info.ab)
  }
  else if (info.art === 'kamera' && info.ab) z.edits = ohneKameraGrenze(z.edits, info.ab)
  else if (info.art === 'wetter' && info.ab) {
    // Wie beim Modus: die automatisch ermittelte Einteilung erst festschreiben,
    // sonst löschte man eine Grenze, die im Overlay noch gar nicht steht.
    if (!schreibeWetterFest()) return
    z.edits = ohneWetterGrenze(z.edits, info.ab)
  }
  else if (info.art === 'moment' && info.ab) z.edits = ohneMoment(z.edits, info.ab)
  else if (info.art === 'audio' && info.index !== undefined) z.edits = ohneAudioEintrag(z.edits, info.index)
  else if (info.art === 'medium' && info.id) z.edits = mitMedienEdit(z.edits, info.id, { geloescht: true })
  else return
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

function medienAnzeige(): MediumAnzeige[] {
  if (!z) return []
  return effektiveMedien(z.daten.medien as MediumBasis[], z.edits)
}

/** Karte zum Anker fliegen + Marker pulsieren lassen (Liste→Karte-Sync). */
function fliegeZuMedium(m: MediumAnzeige): void {
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

/** Einen Audio-Eintrag vorhören (bricht ein laufendes Vorhören ab). */
function starteVorschau(a: AudioEintrag): void {
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
  audio.volume = a.lautstaerke ?? 0.8
  audio.addEventListener('ended', () => {
    stoppeVorschau()
    renderInspektor()
  })
  void audio.play().catch(() => audioStatus('Vorhören blockiert — einmal in die Seite klicken.', 'fehler'))
  vorschau = { audio, datei: a.datei }
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
async function bibliothekHochladen(datei: File): Promise<void> {
  if (!z) return
  const endung = datei.name.toLowerCase().split('.').pop() ?? ''
  if (!AUDIO_ENDUNGEN.includes(endung)) {
    audioStatus(`Nicht unterstützt: .${endung} (erlaubt: ${AUDIO_ENDUNGEN.join(', ')})`, 'fehler')
    return
  }
  // Dateiname säubern + eindeutig machen (Server verbietet Überschreiben)
  const basis = (datei.name.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'audio').slice(0, 40)
  const vorhandene = new Set((bibliothek ?? []).map((d) => d.datei))
  let name = `${basis}.${endung}`
  for (let n = 2; vorhandene.has(name); n++) name = `${basis}-${n}.${endung}`
  audioStatus(`${datei.name} wird hochgeladen …`)
  try {
    await api.ladeBibliotheksAudio(name, datei)
  } catch (fehler) {
    audioStatus((fehler as Error).message, 'fehler')
    return
  }
  bibliothek = [...(bibliothek ?? []), { datei: name, groesse: datei.size, verwendetVon: [] }]
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
  const skala = baueSkala(z.track)
  const abOffset = z.auswahl ? z.auswahl[3] : (skala?.vonS ?? 0)
  const parallel = ueberlappteMusik(abOffset, skala?.bisS ?? abOffset)
  z.edits = mitAudioEintrag(z.edits, { datei: name, typ: 'musik', ab: offsetZuIso(start, abOffset), quelle: 'benutzer' })
  z.fokus = { art: 'audio', index: (z.edits.audio ?? []).length - 1 }
  audioStatus(
    parallel.length
      ? `Hochgeladen und eingesetzt — läuft gleichzeitig mit ${parallel.join(', ')}. Bereiche an den Kanten zurechtziehen, dann Speichern.`
      : 'Hochgeladen und eingesetzt — Art und Bereich im Panel anpassen, dann Speichern.',
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
let bibliothek: api.BibliotheksDatei[] | null = null
let bibliothekLaedt = false

async function ladeBibliothek(): Promise<void> {
  if (bibliothekLaedt) return
  bibliothekLaedt = true
  try {
    bibliothek = await api.listeBibliothek()
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
function sfxStatus(text: string, art?: 'ok' | 'fehler'): void {
  const dialog = $('sfx-dialog') as HTMLDialogElement
  if (!dialog.open) {
    audioStatus(text, art)
    return
  }
  const el = $('sfx-status')
  el.textContent = text
  el.className = 'sfx-status' + (art ? ` ${art}` : '')
}

/**
 * Namen bestehender Musik-Bereiche, die [vonS, bisS) überlappen. Überlappung
 * ist ERLAUBT (der Player mischt — Musik plus Atmosphäre ist ein gewollter
 * Fall), aber sie soll beim Einsetzen nie stillschweigend entstehen: die
 * Statusmeldung spricht sie aus, die Zeitleiste stapelt die Klips.
 */
function ueberlappteMusik(vonS: number, bisS: number): string[] {
  if (!z) return []
  const start = z.daten.time.start
  const endeS = baueSkala(z.track)?.bisS ?? Infinity
  return (z.edits.audio ?? [])
    .filter((a) => {
      if (a.typ !== 'musik') return false
      const von = isoZuOffset(start, a.ab)
      const bis = a.bis !== undefined ? isoZuOffset(start, a.bis) : endeS
      return von < bisS && vonS < bis
    })
    .map((a) => `„${audioName(a)}"`)
}

/** Stück übernehmen: einsetzen oder ersetzen (je nach sfxZiel).
 *  `typ` null = Art des bestehenden Eintrags behalten (eigene Dateien legen
 *  sich nicht fest); beim Neu-Einsetzen wird daraus Musik. */
function sfxUebernehmen(datei: string, quelle: 'bibliothek' | 'benutzer', typ: SfxTyp | null, name: string): void {
  if (!z) return
  if (sfxZiel.modus === 'ersetzen') {
    const index = sfxZiel.index
    if (!(z.edits.audio ?? [])[index]) return
    z.edits = mitAudioPatch(z.edits, index, typ ? { datei, quelle, typ } : { datei, quelle })
    z.fokus = { art: 'audio', index }
    schliesseSfxDialog()
    renderAlles()
    audioStatus(`„${name}" übernommen — Platzierung und Lautstärke bleiben.`, 'ok')
    return
  }
  const start = z.daten.time.start
  const skala = baueSkala(z.track)
  // Ist ein Punkt gewählt, dort einsetzen (v. a. für One-Shots gemeint) — sonst
  // ab Tour-Beginn, wie beim Upload.
  const abOffset = z.auswahl ? z.auswahl[3] : (skala?.vonS ?? 0)
  // VOR dem Einfügen prüfen — sonst zählte der neue Eintrag sich selbst.
  const parallel = typ !== 'sfx' ? ueberlappteMusik(abOffset, skala?.bisS ?? abOffset) : []
  z.edits = mitAudioEintrag(z.edits, { datei, typ: typ ?? 'musik', ab: offsetZuIso(start, abOffset), quelle })
  // Auf das Eingesetzte springen — der Inspector zeigt sonst weiter, was vorher
  // ausgewählt war, und man sucht das gerade Hinzugefügte auf der Spur.
  z.fokus = { art: 'audio', index: (z.edits.audio ?? []).length - 1 }
  schliesseSfxDialog()
  renderAlles()
  audioStatus(
    parallel.length
      ? `„${name}" eingesetzt — läuft gleichzeitig mit ${parallel.join(', ')}. Bereiche an den Kanten zurechtziehen, dann Speichern.`
      : `„${name}" eingesetzt — auf der Zeitleiste platzieren, dann Speichern.`,
    'ok',
  )
}

// Filterzustand der Bibliothek (Art-Tab + Suche) — bleibt über das Öffnen
// hinweg. Kein „Alle"-Tab: ohne Suche zeigt der aktive Reiter seine Art,
// eine Suche geht immer über die GANZE Bibliothek (die Reiter treten zurück).
type SfxFilter = SfxEffekt['kategorie'] | 'eigene'
let sfxFilter: SfxFilter = 'musik'
let sfxSuche = ''

// Was die Art im Film TUT — steht an der Gruppenüberschrift, nicht an jeder
// Zeile: Musik und Atmosphäre schleifen über eine Spanne, ein Effekt spielt
// einmal an seiner Marke.
const KAT_MODUS: Record<SfxFilter, string> = {
  musik: 'läuft über einen Bereich',
  umgebung: 'läuft über einen Bereich',
  effekt: 'spielt einmal an seiner Marke',
  eigene: 'einmal hochgeladen, in jeder deiner Touren einsetzbar',
}
const KAT_LABEL: Record<SfxFilter, string> = {
  musik: KATEGORIE_NAMEN.musik,
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
  zeile.style.setProperty('--fortschritt', dauer > 0 ? String(dialogAudio.currentTime / dauer) : '0')
  const zeit = zeile.querySelector<HTMLElement>('.sfx-zeit')
  if (zeit) zeit.textContent = dauer > 0 ? `${mmss(dialogAudio.currentTime)} / ${mmss(dauer)}` : mmss(dialogAudio.currentTime)
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
    void dialogAudio.play().catch(() => sfxStatus('Vorhören blockiert — einmal in die Seite klicken.', 'fehler'))
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
  for (const f of ['musik', 'umgebung', 'effekt', 'eigene'] as const) {
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
function istAktuellesStueck(datei: string, quelle: 'bibliothek' | 'benutzer'): boolean {
  if (sfxZiel.modus !== 'ersetzen' || !z) return false
  const eintrag = (z.edits.audio ?? [])[sfxZiel.index]
  return !!eintrag && eintrag.datei === datei && eintrag.quelle === quelle
}

/** Nutzt die AKTUELLE (evtl. ungespeicherte) Sitzung diese eigene Datei? */
function inSitzungEingesetzt(datei: string): boolean {
  return (z?.edits.audio ?? []).some((a) => a.quelle === 'benutzer' && a.datei === datei)
}

interface SfxZeileDef {
  /** eindeutig über beide Quellen: 'bib:…' bzw. 'eigen:…' */
  id: string
  name: string
  besch: string
  url: string
  datei: string
  quelle: 'bibliothek' | 'benutzer'
  /** Katalog-Art; null bei eigenen Dateien (die Art bestimmt der Eintrag) */
  typ: SfxTyp | null
  /** rechte Zusatzangabe (Dateigröße eigener Uploads) */
  meta?: string
  /** nur eigene: löschbar — oder der Grund, warum nicht */
  loeschen?: { gesperrtWeil: string | null }
}

/** Eine Zeile der Bibliothek: hören, lesen, übernehmen — eigene auch löschen. */
function baueSfxZeile(def: SfxZeileDef): HTMLElement {
  const spielt = dialogSpielt === def.id
  const aktuell = istAktuellesStueck(def.datei, def.quelle)
  const zeile = document.createElement('div')
  zeile.className = 'sfx-zeile' + (spielt ? ' spielt' : '') + (aktuell ? ' aktuell' : '')
  zeile.dataset['datei'] = def.datei

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
        ? `Das Stück durch „${def.name}" ersetzen — die Platzierung bleibt`
        : `„${def.name}" ab der Marke einsetzen`
    nutzen.addEventListener('click', () => sfxUebernehmen(def.datei, def.quelle, def.typ, def.name))
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
          void bibliothekLoeschen(def.datei)
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

async function bibliothekLoeschen(datei: string): Promise<void> {
  try {
    await api.loescheBibliotheksAudio(datei)
    bibliothek = (bibliothek ?? []).filter((d) => d.datei !== datei)
    sfxStatus(`${datei} gelöscht.`, 'ok')
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
    id: `bib:${e.datei}`,
    name: e.name,
    besch: e.beschreibung,
    url: `/audio/sfx/${encodeURIComponent(e.datei)}`,
    datei: e.datei,
    quelle: 'bibliothek',
    typ: e.typ,
  }))
}

/** Zeilen der eigenen Uploads, optional nach Suchtext gefiltert. */
function eigeneZeilen(q: string): SfxZeileDef[] {
  return (bibliothek ?? [])
    .filter((d) => !q || d.datei.toLowerCase().includes(q))
    .map((d) => {
      const inTouren = d.verwendetVon.map((t) => `„${t.titel}"`).join(', ')
      const ungespeichert = inSitzungEingesetzt(d.datei)
      return {
        id: `eigen:${d.datei}`,
        name: d.datei.replace(/\.[^.]+$/, ''),
        besch: [
          d.datei.split('.').pop()?.toUpperCase() ?? '',
          inTouren ? `wird verwendet in ${inTouren}` : ungespeichert ? 'in dieser Tour eingesetzt (ungespeichert)' : 'noch in keiner Tour im Einsatz',
        ]
          .filter(Boolean)
          .join(' · '),
        url: `/api/audio-bibliothek/${encodeURIComponent(d.datei)}`,
        datei: d.datei,
        quelle: 'benutzer',
        typ: null,
        meta: `${(d.groesse / 1048576).toFixed(1)} MB`,
        loeschen: {
          gesperrtWeil: inTouren
            ? `Wird noch verwendet in ${inTouren} — dort erst den Eintrag entfernen`
            : ungespeichert
              ? 'In dieser Tour eingesetzt — erst den Eintrag entfernen'
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
  const kategorien: SfxFilter[] = q ? ['musik', 'umgebung', 'effekt', 'eigene'] : [sfxFilter]
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
    unter.textContent = eintrag ? `Ersetzt „${audioName(eintrag)}" — Platzierung und Lautstärke bleiben.` : ''
    // Den Reiter dorthin stellen, wo das aktuelle Stück wohnt.
    if (eintrag?.quelle === 'benutzer') sfxFilter = 'eigene'
    else if (eintrag?.quelle === 'bibliothek') sfxFilter = sfxEffekt(eintrag.datei)?.kategorie ?? sfxFilter
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
  if (vorschau?.datei === eintrag.datei) stoppeVorschau()
  z.edits = ohneAudioEintrag(z.edits, index)
  // Die Datei bleibt BEWUSST auf dem Server: das Overlay ist erst beim
  // Speichern persistiert, und ein evtl. schon gerendertes tour.json
  // referenziert sie ggf. noch. Eigene Uploads bleiben ohnehin in der
  // Bibliothek liegen und sind dort löschbar, sobald keine Tour sie nutzt.
  audioStatus(
    eintrag.quelle === 'benutzer'
      ? 'Eintrag entfernt — die Datei bleibt in deiner Bibliothek.'
      : eintrag.quelle === 'bibliothek'
        ? 'Eintrag entfernt.'
        : `Eintrag entfernt — ${eintrag.datei} bleibt gespeichert.`,
    'ok',
  )
  renderAlles()
}

async function audioDateiLoeschen(datei: string, still = false): Promise<void> {
  if (!z) return
  try {
    await api.loescheAudio(z.tourId, datei)
    z.daten.audio = (z.daten.audio ?? []).filter((a) => a.datei !== datei)
    if (!still) audioStatus(`${datei} gelöscht.`, 'ok')
  } catch (fehler) {
    if (!still) audioStatus((fehler as Error).message, 'fehler')
  }
  renderAlles()
}

// — Zeitleiste: Bänder, Pins, Medien-Dots, Audio-Spur —

/** Rollen, bei denen ein Zug eine KANTE verschiebt (Cursor „Rand ziehen"). */
const KANTEN_ROLLEN = new Set(['grenze', 'kamera', 'wetter', 'audio-von', 'audio-bis'])

interface ZugZustand {
  rolle: string
  /** Bildschirm-x beim Greifen — Bezug für die Zug-Schwelle. */
  startX: number
  /** Overlay-Identität: ISO-`ab` bei Pins, Index bei Audio */
  ab?: string
  mode?: Modus
  preset?: KameraPreset
  wetterMode?: WetterModus
  momentArt?: MomentArt
  index?: number
  /** Abstand Cursor↔Balkenanfang beim Greifen (Anteil), für ruckfreies Schieben */
  griffVersatz?: number
  /**
   * Beim pointerdown getroffenes Band. Muss HIER gemerkt werden: nach
   * setPointerCapture zeigt e.target im pointerup auf das Capture-Element
   * (#zeitleiste), nicht mehr auf das Band unter dem Finger.
   */
  fokus?: Fokus | null
  bewegt: boolean
}

/** data-Attribute eines Bandes → Fokus-Identität. */
function bandZuFokus(el: HTMLElement | null): Fokus | null {
  const art = el?.dataset['fokus']
  const bezugS = Number(el?.dataset['bezugs'])
  if (!Number.isFinite(bezugS)) return null
  if (art === 'modus') return { art: 'modus', bezugS }
  if (art === 'kamera') return { art: 'kamera', bezugS }
  if (art === 'wetter') return { art: 'wetter', bezugS }
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

/** x-Position innerhalb von `.spuren` (Namenspalte + Anteil der Zeitachse). */
const zeitX = (anteil: number): string => `calc(var(--spur-x) + ${anteil.toFixed(5)} * var(--zeit-breite))`

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
function bandUnterZeiger(e: PointerEvent): Fokus | null {
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
// Position auf der Leiste ∝ Filmzeit (baueAchse in zeitleiste.ts). Die Achse
// hängt an Overlay und Tourdaten; das Overlay wird immutabel fortgeschrieben,
// deshalb genügt ein Referenzvergleich als Cache-Schlüssel. Der Cache ist
// nötig: renderPlayhead läuft bei jedem Scrub-Frame und darf nicht jedes Mal
// die ganze Zerlegung rechnen. Während eines Foto-Zugs (Overlay bis zum
// Loslassen unverändert) bleibt er warm; Kanten-Züge schreiben das Overlay je
// Move fort und bauen neu — das tat renderZeitleiste vorher genauso.
let achseMemo: {
  edits: EditOverlay
  tourId: string
  achse: Achse | null
  spiel: Filmkurve | null
} | null = null

function aktuelleAchse(): Achse | null {
  if (!z) return null
  if (achseMemo && achseMemo.edits === z.edits && achseMemo.tourId === z.tourId) return achseMemo.achse
  const skala = baueSkala(z.track)
  if (!skala) return null
  const abschnitte = zerlegeFuerAnzeige(z.daten.segmente as EditorSegment[], z.edits, z.daten.time.start)
  // Halt-Breite = Standzeit aller Aufnahmen des Stopps.
  // `indizes` trägt den Weg zurück zum Stopp: die Achse sortiert nach Zeit und
  // lässt Halte ohne Breite weg, ihr Index ist also nicht der der Stopp-Liste.
  const stopps = baueStopps(medienAnzeige(), z.track, kumStrecke)
  const halte = stopps.map((s, i) => {
    // Ein Halt ist die KETTE seiner Aufnahmen, kein Block: nur so lässt sich
    // sagen, welche davon gerade steht. Videos zählen mit ihrer echten Länge
    // (`dauerS` aus der Editor-Route), Fotos mit ihrer Standzeit.
    const stuecke = s.items.map((m) => ({ id: m.id, dauerS: aufnahmeHaltS(m) + HALT_AUSBLEND_S }))
    return {
      offsetS: s.offsetS,
      breiteS: stuecke.reduce((summe, st) => summe + st.dauerS, 0),
      art: 'aufnahmen',
      indizes: [i],
      stuecke,
    }
  })
  // Ein Moment ist grammatikalisch ein HALT: die Kamera bleibt stehen und tut
  // etwas, Filmzeit vergeht. Ohne Achsenbreite fehlten sie in der Leiste
  // vollständig — an der Beispieltour 13,6 unsichtbare Filmsekunden.
  const momente = (z.edits.momente ?? []).map((m, i) => ({
    offsetS: isoZuOffset(z!.daten.time.start, m.ab),
    breiteS: m.dauerS ?? MOMENT_DEFAULT_S[m.art],
    art: 'moment',
    indizes: [i],
  }))
  const achse = baueAchse(abschnitte, [...halte, ...momente], skala)
  achseMemo = { edits: z.edits, tourId: z.tourId, achse, spiel: baueSpielKurve(achse, abschnitte) }
  return achse
}

/** Abspiel-Filmkurve zur aktuellen Achse (Trim-Plateaus) — aus demselben Cache. */
function aktuelleSpielKurve(): Filmkurve | null {
  if (!aktuelleAchse()) return null
  return achseMemo?.spiel ?? null
}

function renderZeitleiste(): void {
  if (!z) return
  const zone = $('zeitleiste-zone')
  const skala = aktuelleAchse()
  if (!skala) {
    zone.hidden = true
    return
  }
  zone.hidden = false
  const start = z.daten.time.start
  const anteilVon = (iso: string): number => offsetZuAnteil(skala, isoZuOffset(start, iso))
  const fokusInfo = loeseFokusAuf()

  // Die Achsenbreite hängt an den DATEN (Filmdauer × Maßstab): eine geänderte
  // Standzeit oder Fortbewegung verlängert den Film und damit die Leiste.
  schreibeZeitBreite()
  renderSkala()

  /**
   * Zustandsband mit Beschriftung — Anfang und Ende sind dieselbe Kante.
   * `art` macht das Band anklickbar: die Bandmitte dient als Fokus-Bezug
   * (überlebt das Verschieben von Grenzen besser als der Bandanfang).
   */
  const band = (
    art: 'modus' | 'kamera' | 'wetter',
    von: number,
    bis: number,
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
    d.style.width = pos(bis - von)
    if (farbe) d.style.background = farbe
    d.dataset['fokus'] = art
    d.dataset['bezugs'] = String(anteilZuOffset(skala, (von + bis) / 2))
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

  /** Ziehbare Bandkante = die Grenze im Overlay (Identität über `ab`). */
  const kante = (anteil: number, rolle: string, daten: Record<string, string>, titel: string): HTMLElement => {
    const k = document.createElement('div')
    k.className = 'kante'
    k.style.left = pos(anteil)
    k.dataset['rolle'] = rolle
    for (const [schluessel, wert] of Object.entries(daten)) k.dataset[schluessel] = wert
    k.title = titel
    return k
  }

  /** Ein Band gilt als fokussiert, wenn seine Mitte in der Fokus-Spanne liegt. */
  const istFokus = (art: string, von: number, bis: number): boolean => {
    if (fokusInfo?.art !== art) return false
    const mitte = anteilZuOffset(skala, (von + bis) / 2)
    return mitte >= fokusInfo.vonS && mitte <= fokusInfo.bisS
  }

  // — Fortbewegung: Bänder aus der Anzeige-Zerlegung (Segment-Modi + Grenzen) —
  const modusBahn = spur('spur-wege')
  const modusAbschnitte = zerlegeFuerAnzeige(z.daten.segmente as EditorSegment[], z.edits, start)
  for (const b of baueBaender(modusAbschnitte, skala)) {
    const d = band('modus', b.von, b.bis, MODUS_NAMEN[b.mode], MODUS_FARBEN[b.mode])
    if (!b.aktiv) d.classList.add('inaktiv')
    if (istFokus('modus', b.von, b.bis)) d.classList.add('fokus')
    modusBahn.appendChild(d)
  }
  // Jeder MODUS-Wechsel ist ein Griff — auch der von der Automatik erkannte.
  // Beim ersten Zug schreibt `materialisiereModi` die Aufteilung fest; bis
  // dahin ist die Kante nur eine Stelle auf der Achse. Kanten mit gleichem
  // Modus links und rechts bekommen keinen Griff: dort ist nichts zu wechseln.
  // Position = erster Punkt des neuen Abschnitts (bei Overlay-Grenzen zwischen
  // Stützpunkten der interpolierte Grenzpunkt). Identität: Overlay-`ab` mit
  // Sekunden-Toleranz, sonst frisch aus der Zeit — muss zu `schreibeModiFest`
  // / `materialisiereModi` passen.
  for (const [i, a] of modusAbschnitte.entries()) {
    const vorher = modusAbschnitte[i - 1]
    if (!vorher || vorher.mode === a.mode) continue
    const vonS = (a.pts[0] as TrackPunkt)[3]
    const ab =
      (z.edits.modi ?? []).find((g) => Math.abs(isoZuOffset(start, g.ab) - vonS) < 1)?.ab
      ?? offsetZuIso(start, vonS)
    modusBahn.appendChild(
      kante(
        offsetZuAnteil(skala, vonS),
        'grenze',
        { ab, mode: a.mode },
        `${MODUS_NAMEN[a.mode]} ab ${zeitText(ab)} Uhr — ziehen zum Verschieben`,
      ),
    )
  }

  // — Kamera: lückenlose Bänder; das Grundband zeigt „Preset des Zuschauers" —
  const kameraBahn = spur('spur-kamera')
  const kameraBaender = baueZustandsBaender<KameraPreset | null>(
    (z.edits.kamera ?? []).map((g) => ({ ab: g.ab, wert: g.preset })),
    start,
    skala,
    null,
  )
  for (const b of kameraBaender) {
    // Feinjustierung (falls ≠ 1) an die Beschriftung hängen: „Nah ×1.3"
    const feinSkala = b.ab !== null ? z.edits.kamera?.find((g) => g.ab === b.ab)?.skala : undefined
    const skalaTxt = feinSkala !== undefined && feinSkala !== 1 ? ` ×${String(+feinSkala.toFixed(2))}` : ''
    const d = band(
      'kamera',
      b.von,
      b.bis,
      b.wert ? PRESET_NAMEN[b.wert] : KAMERA_STANDARD,
      b.wert ? PRESET_FARBEN[b.wert] : undefined,
      skalaTxt,
    )
    if (!b.wert) d.title = KAMERA_STANDARD_ERKLAERT
    if (!b.wert) d.classList.add('leise')
    else d.classList.add('hell')
    if (istFokus('kamera', b.von, b.bis)) d.classList.add('fokus')
    kameraBahn.appendChild(d)
    if (b.ab !== null && b.wert) {
      kameraBahn.appendChild(
        kante(
          b.von,
          'kamera',
          { ab: b.ab, preset: b.wert },
          `Kamera ${PRESET_NAMEN[b.wert]} ab ${zeitText(b.ab)} Uhr — ziehen zum Verschieben`,
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
  const eigenes = (z.edits.wetter ?? []).length > 0
  const wetterBaender = baueZustandsBaender<WetterModus | null>(
    wetterGrenzen.map((g) => ({ ab: g.ab, wert: g.mode })),
    start,
    skala,
    wetterGrenzen.length ? 'off' : null,
  )
  for (const b of wetterBaender) {
    const staerke = b.ab !== null ? wetterGrenzen.find((g) => g.ab === b.ab)?.staerke : undefined
    const staerkeTxt = b.wert && b.wert !== 'off' && staerke !== undefined ? ` ${Math.round(staerke * 100)}%` : ''
    const d = band(
      'wetter',
      b.von,
      b.bis,
      b.wert ? WETTER_NAMEN[b.wert] : 'Automatisch',
      b.wert ? WETTER_FARBEN[b.wert] : undefined,
      staerkeTxt,
    )
    if (!b.wert) d.classList.add('leise')
    else d.classList.add('hell')
    if (!eigenes && b.wert) {
      d.title = `${WETTER_NAMEN[b.wert]} — automatisch ermittelt (Wetterarchiv, an den Fotos nachgeschärft). Ändern übernimmt die ganze Einteilung.`
    }
    if (istFokus('wetter', b.von, b.bis)) d.classList.add('fokus')
    wetterBahn.appendChild(d)
    if (b.ab !== null && b.wert) {
      wetterBahn.appendChild(
        kante(
          b.von,
          'wetter',
          { ab: b.ab, wettermode: b.wert },
          `Wetter ${WETTER_NAMEN[b.wert]} ab ${zeitText(b.ab)} Uhr — ziehen zum Verschieben`,
        ),
      )
    }
  }

  // — Kamera-Momente: Punkt-Marken (ziehbar), je Art ein Symbol —
  const momentBahn = spur('spur-momente')
  for (const m of z.edits.momente ?? []) {
    const a = anteilVon(m.ab)
    if (!Number.isFinite(a)) continue
    const marke = document.createElement('div')
    marke.className = 'zl-moment'
    marke.style.left = pos(a)
    marke.textContent = MOMENT_ZEICHEN[m.art]
    marke.dataset['rolle'] = 'moment'
    marke.dataset['ab'] = m.ab
    marke.dataset['art'] = m.art
    marke.title = `${MOMENT_NAMEN[m.art]} bei ${zeitText(m.ab)} Uhr — ziehen zum Verschieben`
    if (fokusInfo?.art === 'moment' && fokusInfo.ab === m.ab) marke.classList.add('fokus')
    momentBahn.appendChild(marke)
  }

  // — Musik & Effekte: Klips (Dauer) unten, Effekt-Pins (Zeitpunkt) oben —
  const audioBahn = spur('spur-musik')
  const audioBalken = baueAudioBalken(z.edits.audio ?? [], start, skala)
  // Überlappende Klips stapeln sich in Unterzeilen (b.lane) — die Bahn wächst
  // mit, damit jeder Klip lesbar und greifbar bleibt (der Player mischt sie).
  audioBahn.closest('.spur')?.setAttribute('style', `--musik-lanes: ${musikLanes(audioBalken)}`)
  for (const b of audioBalken) {
    // Bibliotheks-Einträge tragen ihren KATALOGNAMEN, nicht den Dateinamen:
    // „Aufbruch" sagt, was man hört — „mus-aufbruch.mp3" nur, wo es liegt.
    const anzeige = audioName((z.edits.audio ?? [])[b.index] ?? { datei: b.datei, typ: b.typ, ab: start })
    if (b.typ === 'musik') {
      const klip = document.createElement('div')
      klip.className = 'zl-klip'
      klip.style.top = `${20 + b.lane * 24}px`
      klip.style.left = pos(b.von)
      klip.style.width = pos(Math.max(0.004, b.bis - b.von))
      klip.dataset['rolle'] = 'audio-balken'
      klip.dataset['index'] = String(b.index)
      klip.title = `${anzeige} — ziehen zum Verschieben, Kanten für Anfang und Ende`
      if (fokusInfo?.art === 'audio' && fokusInfo.index === b.index) klip.classList.add('fokus')
      const name = document.createElement('span')
      name.textContent = anzeige
      klip.appendChild(name)
      for (const seite of ['von', 'bis'] as const) {
        const griff = document.createElement('div')
        griff.className = `kante ${seite}`
        griff.dataset['rolle'] = `audio-${seite}`
        griff.dataset['index'] = String(b.index)
        klip.appendChild(griff)
      }
      audioBahn.appendChild(klip)
    } else {
      const pin = document.createElement('div')
      pin.className = 'zl-sfx'
      pin.style.left = pos(b.von)
      pin.dataset['rolle'] = 'sfx'
      pin.dataset['index'] = String(b.index)
      pin.title = `${anzeige} (Effekt) — ziehen zum Verschieben`
      if (fokusInfo?.art === 'audio' && fokusInfo.index === b.index) pin.classList.add('fokus')
      pin.appendChild(document.createElement('i'))
      audioBahn.appendChild(pin)
    }
  }

  // — Fotos/Videos: ein Stapel je STOPP —
  //
  // Aufnahmen am selben Ort zeigt der Player als EINEN Halt nacheinander. Als
  // einzelne Miniaturen nebeneinander sähe man zwölf Halte und bekäme acht.
  const medien = medienAnzeige()
  const alleStopps = baueStopps(medien, z.track, kumStrecke)
  const fotoBahn = spur('spur-fotos')
  for (const stopp of alleStopps) {
    const kopf = stopp.items[0]
    if (!kopf) continue
    const anzahl = stopp.items.length
    const mini = document.createElement('button')
    mini.type = 'button'
    mini.className = 'f-mini'
    mini.style.left = pos(offsetZuAnteil(skala, stopp.offsetS))
    mini.dataset['rolle'] = 'dot'
    mini.dataset['id'] = kopf.id
    mini.dataset['ids'] = stopp.items.map((m) => m.id).join(' ')
    const halt = stopp.items.reduce((sum, m) => sum + aufnahmeHaltS(m), 0)
    mini.title =
      anzahl > 1
        ? `Stopp mit ${anzahl} Aufnahmen — ${Math.round(halt)} s Halt`
        : `${kopf.caption || kopf.id} — ${uhrzeitKurz(kopf.takenAt)} Uhr, ${Math.round(aufnahmeHaltS(kopf))} s Halt`
    // Angedeutete Karten HINTER dem Kopfbild, nach rechts/oben versetzt: die
    // vordere Karte bleibt damit genau auf der Zeit des Halts.
    for (const nr of [2, 1]) {
      if (anzahl > nr) {
        const karte = document.createElement('span')
        karte.className = `stapel s${nr}`
        mini.appendChild(karte)
      }
    }
    const bild = document.createElement('img')
    bild.src = miniaturQuelle(kopf)
    bild.alt = ''
    bild.loading = 'lazy'
    mini.appendChild(bild)
    if (kopf.type === 'video') {
      const badge = document.createElement('span')
      badge.className = 'v-badge'
      badge.innerHTML = icon('play')
      mini.appendChild(badge)
    }
    if (anzahl > 1) {
      const plakette = document.createElement('span')
      plakette.className = 'anzahl'
      plakette.textContent = String(anzahl)
      mini.appendChild(plakette)
    }
    // Die Auswahl trifft den ganzen Stapel: jedes Mitglied hebt ihn hervor.
    if (fokusInfo?.art === 'medium' && stopp.items.some((m) => m.id === fokusInfo.id)) mini.classList.add('fokus')
    mini.addEventListener('pointerdown', (ev) => ziehStopp(ev, stopp))
    fotoBahn.appendChild(mini)
  }

  renderPlayhead()
  kuerzeBeschriftungen()
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
  return aktuelleAchse()?.kurve?.gesamtS ?? 0
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
  if (fenster) fenster.scrollLeft = ankerScroll(ankerAnteil, breite, zielVx, spurXpx())
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
  const anker = fenster && fenster.clientWidth > 0 ? (fenster.scrollLeft + spurXpx()) / Math.max(1, zeitBreitePx()) : 0
  if (einpassen) {
    setzeMassstab(passMassstab(), 0, spurXpx())
    return
  }
  setzeMassstab(pxProFilmS, Math.max(0, Math.min(1, anker)), spurXpx())
}

// — Der Abspielkopf steht in FILMsekunden —
//
// `kopfFilmS` ist die eine Wahrheit für Scrubben, Klick, Pfeiltasten und
// Abspielen. Die Aufnahmezeit (`z.auswahl`, zugleich Einfügemarke für „ab
// hier"-Aktionen) wird daraus ABGELEITET, nie umgekehrt: In Aufnahmezeit gibt
// es keinen Wert für „mitten im Halt" (zwei Stützstellen auf derselben
// Sekunde), die Rückrechnung fällt dort immer auf die linke Haltkante. Genau
// daran klebte der Kopf — 28 von 39 Frames Stillstand, und mit Pfeiltasten kam
// man an einem 6-s-Halt nie vorbei (docs/concepts/zeitleiste-umbau.md §1).

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
  const skala = baueSkala(z.track)
  if (!skala) return
  const geklemmt = Math.max(skala.vonS, Math.min(skala.bisS, tOffsetS))
  const achse = aktuelleAchse()
  kopfFilmS = achse?.kurve ? filmZuOffset(achse, geklemmt) : null
  const punkt = punktZuOffset(z.track, geklemmt)
  if (punkt) z.auswahl = punkt
  renderPlayhead()
}

/** Den Kopf auf eine FILMsekunde stellen — der führende Weg. */
function setzeKopfFilm(filmS: number): void {
  if (!z) return
  const achse = aktuelleAchse()
  if (!achse?.kurve) return
  kopfFilmS = Math.max(0, Math.min(achse.kurve.gesamtS, filmS))
  leiteMarkeAusKopfAb(achse)
  renderPlayhead()
}

/** Aufnahmezeit (und damit `z.auswahl`) aus der Kopf-Filmsekunde nachziehen. */
function leiteMarkeAusKopfAb(achse: Achse): void {
  if (!z || kopfFilmS === null) return
  const punkt = punktZuOffset(z.track, anteilZuOffset(achse, filmZuAnteil(achse, kopfFilmS)))
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
  if (kopfFilmS === null && z.auswahl) kopfFilmS = achse.kurve ? filmZuOffset(achse, z.auswahl[3]) : 0
  if (kopfFilmS === null) {
    strich.hidden = true
    return
  }
  strich.hidden = false
  // Die Achse kann sich geändert haben (Standzeit, Fortbewegung) — die
  // Filmsekunde bleibt, die Aufnahmezeit darunter wird nachgezogen.
  if (achse.kurve) kopfFilmS = Math.min(kopfFilmS, achse.kurve.gesamtS)
  leiteMarkeAusKopfAb(achse)
  const anteil = achse.kurve ? filmZuAnteil(achse, kopfFilmS) : offsetZuAnteil(achse, z.auswahl?.[3] ?? 0)
  const tOffsetS = z.auswahl?.[3] ?? achse.vonS
  strich.style.left = zeitX(anteil)
  zeigeKopfWennImBlick()

  // Filmzeit prominent: wo im FILM steht die Marke, und wie lang ist er? Die
  // Spielkurve respektiert Trim — bei getrimmten Alt-Touren weicht die Summe
  // deshalb vom Maßband-Ende ab (das die ganze Achse beschriftet).
  const film = document.getElementById('kopf-film')
  const spiel = aktuelleSpielKurve()
  if (film && spiel) {
    film.textContent = `${formatiereFilmzeit(filmBei(spiel, anteil))} / ~${formatiereFilmzeit(spiel.gesamtS)}`
  }
  const uhr = document.getElementById('kopf-uhr')
  // Ohne Sekunden: die Anzeige läuft beim Scrubben mit, da zappelt eine
  // Sekundenstelle nur.
  if (uhr) uhr.textContent = uhrzeitKurz(offsetZuIso(z.daten.time.start, tOffsetS))
  const km = document.getElementById('kopf-km')
  if (km) km.textContent = kmText(meterZuOffset(kumStrecke, z.track, tOffsetS))

  setzeLaeufer(tOffsetS)
}

const kmText = (meter: number): string => (meter / 1000).toFixed(1).replace('.', ',')

/** Uhrzeit ohne Sekunden, in der Zone der Tour. */
function uhrzeitKurz(iso: string): string {
  if (!z) return iso
  try {
    return new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: z.daten.time.zone }).format(new Date(iso))
  } catch {
    return iso
  }
}

/**
 * Der Läufer zeigt, WO auf der Strecke die Marke steht — und WOMIT man dort
 * unterwegs ist. Das Piktogramm ist zeichengleich mit dem Fahrer im Player
 * (MODE_ICONS in src/map.js), damit Editor und Wiedergabe dieselbe Sprache
 * sprechen.
 */
function setzeLaeufer(tOffsetS: number): void {
  if (!z || !karte) return
  const punkt = punktZuOffset(z.track, tOffsetS)
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
  const abschnitte = zerlegeFuerAnzeige(z.daten.segmente as EditorSegment[], z.edits, z.daten.time.start)
  const treffer = abschnitte.find((a) => {
    const erster = a.pts[0] as TrackPunkt
    const letzter = a.pts[a.pts.length - 1] as TrackPunkt
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
  const gesamtS = achse.kurve?.gesamtS
  if (breitePx <= 0 || !gesamtS) return
  for (const m of baueFilmMassband(achse, breitePx / gesamtS)) {
    const d = document.createElement('div')
    d.className = 'skala-marke' + (m.voll ? ' voll' : '') + (m.rand ? ` am-${m.rand}` : '')
    d.style.left = pos(m.anteil)
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
 * Sorgt dafür, dass `ab` als echte Grenze im Overlay steht. Die Kanten der
 * Fortbewegungs-Spur kommen zum Teil aus der Aufzeichnung; wer eine davon
 * anfasst, schreibt damit die ganze erkannte Aufteilung fest — sonst risse die
 * neue Grenze alle folgenden Abschnitte mit sich (siehe `materialisiereModi`).
 * Das geschieht erst beim tatsächlichen Verschieben, nicht schon beim Anfassen.
 */
function schreibeModiFest(ab: string): boolean {
  if (!z) return false
  if (z.edits.modi?.some((g) => g.ab === ab)) return true
  const fest = materialisiereModi(z.edits, z.daten.segmente as EditorSegment[], z.daten.time.start)
  if (!fest.modi?.some((g) => g.ab === ab)) return false
  z.edits = fest
  return true
}

/**
 * Dasselbe fürs Wetter: solange niemand eingegriffen hat, zeigt die Spur das
 * automatisch ermittelte Wetter (`daten.autoWetter`). Sobald daran etwas
 * geändert wird, MUSS die ganze Einteilung ins Overlay — dieses ersetzt das
 * Auto-Wetter serverseitig vollständig, eine einzelne neue Grenze ließe den
 * Rest der Tour sonst schlagartig klar werden.
 *
 * Gibt true zurück, wenn danach eigene Grenzen existieren (auch wenn es nie
 * Auto-Wetter gab — dann beginnt die Einteilung eben bei null).
 */
function schreibeWetterFest(): boolean {
  if (!z) return false
  if ((z.edits.wetter ?? []).length) return true
  const auto = autoWetterGrenzen()
  if (!auto.length) return false
  z.edits = { ...z.edits, wetter: auto }
  return true
}

/** Vom Server automatisch ermitteltes Wetter, auf gültige Modi gefiltert. */
function autoWetterGrenzen(): Array<{ ab: string; mode: WetterModus; staerke?: number }> {
  return (z?.daten.autoWetter ?? [])
    .filter((g): g is { ab: string; mode: WetterModus; staerke?: number } =>
      (WETTER_MODI as readonly string[]).includes(g.mode),
    )
    .map((g) => (g.staerke === undefined ? { ab: g.ab, mode: g.mode } : { ab: g.ab, mode: g.mode, staerke: g.staerke }))
}

/** Wetter-Grenzen, die GERADE GELTEN — eigene, sonst die automatisch ermittelten. */
function anzeigeWetter(): Array<{ ab: string; mode: WetterModus; staerke?: number }> {
  const eigene = z?.edits.wetter
  return eigene?.length ? eigene : autoWetterGrenzen()
}

/**
 * Overlay-Sicht für die ANZEIGE: wie `z.edits`, aber mit dem geltenden Wetter
 * gefüllt. So sehen Bänder, Kanten und Inspector dasselbe, ohne dass das
 * Festschreiben schon beim bloßen Ansehen passieren müsste.
 */
function editsFuerAnzeige(): EditOverlay {
  if (!z) return LEERES_OVERLAY
  if ((z.edits.wetter ?? []).length) return z.edits
  const auto = autoWetterGrenzen()
  return auto.length ? { ...z.edits, wetter: auto } : z.edits
}

function verschiebeGrenze(art: 'modus' | 'kamera' | 'wetter' | 'moment', altAb: string, neuOffsetS: number): string | null {
  if (!z) return null
  const skala = baueSkala(z.track)
  if (!skala) return null
  // Modus- und Wetterkanten können aus der Automatik stammen — erst
  // festschreiben, dann stehen auch die Nachbarn fest, zwischen die geklemmt wird.
  if (art === 'modus' && !schreibeModiFest(altAb)) return null
  if (art === 'wetter' && !schreibeWetterFest()) return null
  const nachbarn =
    art === 'modus'
      ? (z.edits.modi ?? [])
      : art === 'kamera'
        ? (z.edits.kamera ?? [])
        : art === 'wetter'
          ? (z.edits.wetter ?? [])
          : [] // Momente sind Punktereignisse — ihre Reihenfolge trägt nichts
  // Fortbewegung interpoliert Grenzen auf die Linie — Trackpunkt-Raster würde
  // die Kante wieder in großen Sprüngen einrasten lassen (Berner Oberland).
  // Kamera/Wetter bleiben am Raster: ihre Bänder hängen nicht an Abschnitten.
  const geklemmt = klemmeGrenze(
    nachbarn,
    altAb,
    z.daten.time.start,
    Math.max(skala.vonS, Math.min(skala.bisS, neuOffsetS)),
    art === 'modus' || art === 'moment' ? undefined : z.track.map((p) => p[3]),
  )
  const neuAb = offsetZuIso(z.daten.time.start, geklemmt)
  if (neuAb === altAb) return altAb
  if (art === 'modus') {
    const alt = z.edits.modi?.find((g) => g.ab === altAb)
    if (!alt || z.edits.modi?.some((g) => g.ab === neuAb)) return null
    z.edits = mitModusGrenze(ohneModusGrenze(z.edits, altAb), neuAb, alt.mode)
  } else if (art === 'kamera') {
    const alt = z.edits.kamera?.find((g) => g.ab === altAb)
    if (!alt || z.edits.kamera?.some((g) => g.ab === neuAb)) return null
    z.edits = mitKameraGrenze(ohneKameraGrenze(z.edits, altAb), neuAb, alt.preset, alt.skala)
  } else if (art === 'wetter') {
    const alt = z.edits.wetter?.find((g) => g.ab === altAb)
    if (!alt || z.edits.wetter?.some((g) => g.ab === neuAb)) return null
    z.edits = mitWetterGrenze(ohneWetterGrenze(z.edits, altAb), neuAb, alt.mode, alt.staerke)
  } else {
    const alt = z.edits.momente?.find((m) => m.ab === altAb)
    if (!alt || z.edits.momente?.some((m) => m.ab === neuAb)) return null
    z.edits = mitMoment(ohneMoment(z.edits, altAb), neuAb, alt.art, alt.dauerS)
    if (z.fokus?.art === 'moment') z.fokus = { art: 'moment', ab: neuAb }
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
  const skala = aktuelleAchse()
  if (!skala) return
  if (!zug.bewegt) {
    if (Math.abs(e.clientX - zug.startX) < ZUG_SCHWELLE_PX) return
    zug.bewegt = true
    // Der Greif-Cursor gilt erst AB HIER: beim bloßen Draufdrücken sah man
    // sonst „Rand ziehen", obwohl man nur etwas auswählen wollte.
    $('zeitleiste-zone').classList.add(KANTEN_ROLLEN.has(zug.rolle) ? 'zieht' : 'schiebt')
  }
  const start = z.daten.time.start
  const anteil = spurAnteil(e.clientX)
  const iso = (a: number): string => offsetZuIso(start, anteilZuOffset(skala, a))

  switch (zug.rolle) {
    // Grenzen aller Art laufen über dieselbe Funktion wie die Zeitfelder im
    // Inspector — eine Stelle, an der Kollision und Werterhalt geregelt sind.
    case 'grenze':
    case 'kamera':
    case 'wetter':
    case 'moment': {
      if (zug.ab === undefined) break
      const art = zug.rolle === 'grenze' ? 'modus' : (zug.rolle as 'kamera' | 'wetter' | 'moment')
      const neuAb = verschiebeGrenze(art, zug.ab, anteilZuOffset(skala, anteil))
      if (neuAb) zug.ab = neuAb
      break
    }
    case 'audio-balken': {
      if (zug.index === undefined) break
      const a = (z.edits.audio ?? [])[zug.index]
      if (!a) break
      const von = offsetZuAnteil(skala, isoZuOffset(start, a.ab))
      const laenge = a.bis !== undefined ? offsetZuAnteil(skala, isoZuOffset(start, a.bis)) - von : null
      const neuVon = Math.max(0, Math.min(anteil - (zug.griffVersatz ?? 0), laenge !== null ? 1 - laenge : 1))
      const patch: { ab: string; bis?: string } = { ab: iso(neuVon) }
      // Anteilslänge konstant halten heißt auf der Filmzeit-Achse: die
      // FILMDAUER des Klips bleibt beim Verschieben gleich — genau richtig.
      if (laenge !== null) patch.bis = iso(neuVon + laenge)
      z.edits = mitAudioPatch(z.edits, zug.index, patch)
      break
    }
    case 'audio-von': {
      if (zug.index === undefined) break
      const a = (z.edits.audio ?? [])[zug.index]
      if (!a) break
      const bisA = a.bis !== undefined ? isoZuOffset(start, a.bis) : skala.bisS
      // In ZEIT klemmen, nicht in Anteilen: innerhalb eines Halt-Sprungs
      // kollabieren 0,005 Anteil auf 0 Sekunden — der Klip würde zeitlos und
      // beim Rendern verworfen. Mindestens 1 s Abstand bleibt.
      const neuS = Math.min(anteilZuOffset(skala, anteil), bisA - 1)
      z.edits = mitAudioPatch(z.edits, zug.index, { ab: offsetZuIso(start, neuS) })
      break
    }
    case 'audio-bis': {
      if (zug.index === undefined) break
      const a = (z.edits.audio ?? [])[zug.index]
      if (!a) break
      const vonS = isoZuOffset(start, a.ab)
      const neuS = Math.max(anteilZuOffset(skala, anteil), vonS + 1)
      z.edits = mitAudioPatch(z.edits, zug.index, {
        bis: anteil >= 0.998 ? undefined : offsetZuIso(start, neuS),
      })
      break
    }
    case 'sfx': {
      if (zug.index === undefined) break
      z.edits = mitAudioPatch(z.edits, zug.index, { ab: iso(anteil) })
      break
    }
  }
  renderNachZug()
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
    if (rolle === 'dot') return // Klick, kein Zug
    e.preventDefault()
    // Ein beginnender Zug hält das Abspielen an: Züge rendern über
    // renderNachZug (ohne halteAbspielen) — der Abspieler liefe sonst auf
    // einem veralteten Plan weiter.
    halteAbspielen()
    zone.setPointerCapture(e.pointerId)
    // KEIN Greif-Cursor beim bloßen Drücken — den setzt erst der echte Zug
    // (zeitleisteZug, ab ZUG_SCHWELLE_PX).
    zug = { rolle, startX: e.clientX, bewegt: false, fokus: bandUnterZeiger(e) }
    if (ziel.dataset['ab'] !== undefined) zug.ab = ziel.dataset['ab']
    if (ziel.dataset['mode']) zug.mode = ziel.dataset['mode'] as Modus
    if (ziel.dataset['preset']) zug.preset = ziel.dataset['preset'] as KameraPreset
    if (ziel.dataset['wettermode']) zug.wetterMode = ziel.dataset['wettermode'] as WetterModus
    if (ziel.dataset['art']) zug.momentArt = ziel.dataset['art'] as MomentArt
    if (ziel.dataset['index'] !== undefined) zug.index = Number(ziel.dataset['index'])
    if (rolle === 'audio-balken') {
      // Versatz zwischen Cursor und Klipanfang merken → ruckfreies Schieben
      const skala = aktuelleAchse()
      const a = (z.edits.audio ?? [])[zug.index ?? -1]
      if (skala && a) {
        zug.griffVersatz = spurAnteil(e.clientX) - offsetZuAnteil(skala, isoZuOffset(z.daten.time.start, a.ab))
      }
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
      if (war.bewegt) {
        unterdrueckeKlick = true
        renderAlles()
        return
      }
      // Kein Zug = Klick: Abspielkopf setzen UND das getroffene Band
      // fokussieren — ein Klick, beide sinnvollen Wirkungen. Traf er nichts,
      // wird die Auswahl aufgehoben (wie im Schnittprogramm).
      const audioRollen = ['audio-balken', 'audio-von', 'audio-bis', 'sfx']
      if (war.rolle === 'moment' && war.ab !== undefined) {
        zz.fokus = { art: 'moment', ab: war.ab }
        renderAlles()
      } else if (audioRollen.includes(war.rolle) && war.index !== undefined) {
        zz.fokus = { art: 'audio', index: war.index }
        renderAlles()
      } else {
        // Spur, Maßband UND Bandkante: alle drei meinen beim bloßen Antippen
        // die Stelle und das Band darunter.
        const skala = aktuelleAchse()
        if (skala) {
          setzeKopfFilm(anteilZuFilm(skala, spurAnteil(e.clientX)))
          zz.fokus = war.fokus ?? null
          renderAlles()
        }
      }
    }
  }
  zone.addEventListener('pointerup', (e) => {
    // Miniatur-Klick: Karte + Liste synchronisieren
    const dot = (e.target as HTMLElement).closest<HTMLElement>('[data-rolle="dot"]')
    if (dot && z && werkzeug === 'auswahl' && !unterdrueckeKlick) {
      const medium = medienAnzeige().find((m) => m.id === dot.dataset['id'])
      if (medium) {
        z.fokus = { art: 'medium', id: medium.id }
        fliegeZuMedium(medium)
        renderAlles()
      }
    }
    zugEnde(e)
  })
  zone.addEventListener('pointercancel', zugEnde)

  // — Abspielkopf ziehen —
  //
  // Über FENSTER-Listener statt Pointer-Capture: der Kopf ist 13 px breit,
  // eine Capture darauf verlöre bei schnellen Bewegungen die Ereignisse.
  $('kopf-griff').addEventListener('pointerdown', (e) => {
    if (!z || e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    halteAbspielen()
    document.body.classList.add('scrubbt')
    const skala = aktuelleAchse()
    // Scrubben meint eine Stelle auf der LEISTE, also eine Filmsekunde — in
    // Aufnahmezeit übersetzt bliebe der Kopf an jeder Haltkante kleben.
    const zieh = (ev: PointerEvent): void => {
      if (!skala) return
      setzeKopfFilm(anteilZuFilm(skala, spurAnteil(ev.clientX)))
    }
    const los = (): void => {
      window.removeEventListener('pointermove', zieh)
      window.removeEventListener('pointerup', los)
      document.body.classList.remove('scrubbt')
      unterdrueckeKlick = true
    }
    window.addEventListener('pointermove', zieh)
    window.addEventListener('pointerup', los)
  })

  // Klick/Zug auf dem Maßband scrubbt ebenfalls — die vertraute Geste.
  $('skala-feld').addEventListener('pointerdown', (e) => {
    if (!z || e.button !== 0 || werkzeug !== 'auswahl') return
    e.preventDefault()
    const skala = aktuelleAchse()
    if (!skala) return
    halteAbspielen()
    setzeKopfFilm(anteilZuFilm(skala, spurAnteil(e.clientX)))
    document.body.classList.add('scrubbt')
    const zieh = (ev: PointerEvent): void => setzeKopfFilm(anteilZuFilm(skala, spurAnteil(ev.clientX)))
    const los = (): void => {
      window.removeEventListener('pointermove', zieh)
      window.removeEventListener('pointerup', los)
      document.body.classList.remove('scrubbt')
      renderAlles()
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
    if ((ziel as HTMLElement).closest?.('#editor-mehr, #ablage-knopf, .spur-plus')) return
    schliesseSpurMenue()
  })
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && offenesMenue) schliesseSpurMenue()
  })

  // — Werkzeuge: Hand pannt, Zoom klickt/zieht. Der Abspielkopf bleibt in
  //   jedem Werkzeug greifbar (er ist von diesem Handler ausgenommen). —
  $('zeitleiste-zone').querySelector('.werkzeuge')?.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('.wkz')
    if (b?.dataset['wkz']) setzeWerkzeug(b.dataset['wkz'] as typeof werkzeug)
  })
  fenster.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || werkzeug === 'auswahl') return
    if ((e.target as HTMLElement).closest('.kopf-griff')) return
    e.preventDefault()
    const fr = fenster.getBoundingClientRect()
    const anteilBei = (clientX: number): number =>
      Math.min(Math.max((fenster.scrollLeft + (clientX - fr.left) - spurXpx()) / Math.max(1, zeitBreitePx()), 0), 1)
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
        setzeMassstab(pxProFilmS * (ev.altKey ? 1 / 1.6 : 1.6), anteilBei(ev.clientX), ev.clientX - fr.left)
      }
    }
    window.addEventListener('pointermove', zieh)
    window.addEventListener('pointerup', los)
  })

  // — Zoom-Bedienung im Kopf —
  const zoomAnker = (): { anteil: number; vx: number } => {
    const skala = aktuelleAchse()
    // Um den Abspielkopf zoomen, wenn er sichtbar ist — sonst um die Fenstermitte
    if (z?.auswahl && skala) {
      const anteil = offsetZuAnteil(skala, z.auswahl[3])
      const vx = spurXpx() + anteil * zeitBreitePx() - fenster.scrollLeft
      if (vx >= 0 && vx <= fenster.clientWidth) return { anteil, vx }
    }
    const mitte = fenster.clientWidth / 2
    return { anteil: (fenster.scrollLeft + mitte - spurXpx()) / Math.max(1, zeitBreitePx()), vx: mitte }
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
      const anteil = (fenster.scrollLeft + (e.clientX - fr.left) - spurXpx()) / Math.max(1, zeitBreitePx())
      setzeMassstab(pxProFilmS * Math.exp(-e.deltaY / 220), Math.max(0, Math.min(1, anteil)), e.clientX - fr.left)
    },
    { passive: false },
  )
}

/** Werkzeug umschalten — Cursor und Timeline-Verhalten folgen dem Zustand. */
function setzeWerkzeug(w: typeof werkzeug): void {
  werkzeug = w
  document.querySelectorAll<HTMLElement>('.wkz').forEach((b) => b.classList.toggle('an', b.dataset['wkz'] === w))
  const fenster = document.getElementById('spuren-fenster')
  if (fenster) fenster.dataset['wkz'] = w
}

/**
 * Flash-Meldung unter der Kopfleiste (DESIGN.md → Flash Messages). EIN Element,
 * eine neue Meldung ersetzt die alte — die Semantik der früheren Statuszeile.
 * 'ok' blendet nach ~4 s aus, 'fehler' nach ~7 s; eine neutrale Meldung
 * („… wird geladen") trägt einen Kreisel und bleibt, bis sie abgelöst oder mit
 * status('') aufgeräumt wird.
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
  el.innerHTML = klasse === 'ok' ? icon('haken') : klasse === 'fehler' ? icon('x') : '<span class="kreisel"></span>'
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
    flashUhr = window.setTimeout(() => {
      el.classList.remove('zeigt', 'pop')
      flashUhr = null
    }, klasse === 'fehler' ? 7000 : 4000)
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
/** Timer, der die Foto-Einblendung wieder ausblendet. */
let einblendUhr: number | null = null

/**
 * Überfahr-Marken der Aufnahmen: je Foto eine, im Halt-Sprung der Achse an
 * dem Punkt, an dem seine Standzeit im Film beginnt — Foto i startet nach den
 * Standzeiten seiner Vorgänger im selben Stopp.
 *
 * EINE Quelle mit der Achse (beide über `aufnahmeHaltS` + HALT_AUSBLEND_S) —
 * rechneten Achse und Wiedergabe getrennt, zeigte die Leiste andere Halte als
 * das Abspielen macht. Ein Video steht dabei so lange, wie es läuft.
 */
function zeigenDerTour(achse: Achse): ZeigeMarke[] {
  if (!z) return []
  const gesamtS = achse.kurve?.gesamtS
  const marken: ZeigeMarke[] = []
  for (const s of baueStopps(medienAnzeige(), z.track, kumStrecke)) {
    let filmS = filmZuOffset(achse, s.offsetS)
    for (const m of s.items) {
      marken.push({
        // Ohne Kurve (degenerierte Tour) fallen die Marken eines Stopps auf
        // denselben Anteil — die letzte gewinnt. Randfall ohne Fahrstrecke.
        anteil: gesamtS ? filmS / gesamtS : offsetZuAnteil(achse, s.offsetS),
        id: m.id,
        dauerS: aufnahmeHaltS(m),
      })
      filmS += aufnahmeHaltS(m) + HALT_AUSBLEND_S
    }
  }
  return marken.sort((a, b) => a.anteil - b.anteil)
}

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
  for (const b of baueAudioBalken(eintraege, start, achse)) {
    const a = eintraege[b.index]
    // Was beim Rendern herausfällt (ganz außerhalb der Tour), soll auch hier
    // nicht klingen — sonst hörte man etwas, das im Film nicht vorkommt.
    if (!a || audioWirdVerworfen(a, z.edits, start, achse)) continue
    const url = audioUrl(a, z.tourId)
    const lautstaerke = a.lautstaerke ?? 0.8
    if (b.typ === 'musik') musik.push({ von: b.von, bis: b.bis, url, lautstaerke })
    else klaenge.push({ index: b.index, anteil: b.von, url, lautstaerke })
  }

  return {
    // Aus der Kopf-FILMsekunde, nicht aus der Aufnahmezeit: wer mitten in einem
    // Halt auf Play drückt, soll dort weiterlaufen und nicht an dessen Anfang
    // zurückspringen.
    marke: filmZuAnteil(achse, kopfFilm()),
    kurve: spiel,
    zeigen: zeigenDerTour(achse),
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
  const skala = aktuelleAchse()
  if (!skala) return
  setzeKopfFilm(anteilZuFilm(skala, anteil))
  folgeKopf(anteil)
  folgeKarte()
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
  const c = karte.getCenter()
  const von = karte.project(c)
  const nach = karte.project(folgeZiel)
  const dx = nach.x - von.x
  const dy = nach.y - von.y
  const dist2 = dx * dx + dy * dy
  // Unter ~2 px stehen bleiben — sonst rauscht die Kamera am Zielpunkt.
  if (dist2 < 4) {
    folgeZiel = null
    return
  }
  // Je weiter weg, desto beherzter; nah am Ziel weich (kein Überschwingen).
  const alpha = Math.min(0.28, 0.08 + Math.sqrt(dist2) / 500)
  const ziel = karte.unproject([von.x + dx * alpha, von.y + dy * alpha])
  karte.jumpTo({ center: ziel })
  folgeRaf = requestAnimationFrame(folgeKarteTick)
}

function halteKartenFolge(): void {
  folgeZiel = null
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
 */
function zeigeFoto(id: string, dauerS: number): void {
  if (!z) return
  const m = medienAnzeige().find((x) => x.id === id)
  if (!m) return
  blinke(mitMedienId('.f-mini', id), 'puls', 700)
  blinke(mitMedienId('.medien-punkt', id), 'puls', 1400)

  const karteEl = $('foto-einblendung')
  const rahmen = document.createElement('div')
  rahmen.className = 'fe-frame'
  if (m.type === 'video') {
    const video = document.createElement('video')
    video.src = m.src
    video.muted = true
    video.loop = true
    video.autoplay = true
    video.playsInline = true
    rahmen.appendChild(video)
  } else {
    const bild = document.createElement('img')
    bild.src = m.src
    bild.alt = ''
    rahmen.appendChild(bild)
  }
  // Fortschrittsbalken wie im Player (`photo-hold`) — wie lange die Karte noch steht.
  const hold = document.createElement('div')
  hold.className = 'fe-hold'
  hold.setAttribute('aria-hidden', 'true')
  const holdFill = document.createElement('div')
  holdFill.className = 'fe-hold-fill'
  holdFill.style.animationDuration = `${Math.max(0.2, dauerS)}s`
  hold.appendChild(holdFill)
  rahmen.appendChild(hold)

  const fuss = document.createElement('div')
  fuss.className = 'fe-cap'
  const titel = document.createElement('div')
  titel.className = 'fe-titel'
  // Ohne eigenen Text steht dort, was auch der Player ohne Beschriftung zeigt:
  // die Maschinenangabe. Mit Text wird DER zur Überschrift (s. enrich.ts).
  titel.textContent = m.caption || (m.type === 'video' ? 'Video' : 'Foto')
  const chip = document.createElement('div')
  chip.className = 'fe-chip'
  chip.textContent = m.type === 'video' ? 'Video' : 'Foto'
  const unten = document.createElement('div')
  unten.className = 'fe-sub'
  const meter = m.anchor
    ? meterZuOffset(kumStrecke, z.track, projiziereAufTrack(z.track, m.anchor[0], m.anchor[1]).punkt[3])
    : null
  unten.textContent = `${uhrzeitKurz(m.takenAt)} Uhr${meter !== null ? ` · km ${kmText(meter)}` : ''}`
  fuss.append(titel, chip, unten)

  karteEl.replaceChildren(rahmen, fuss)
  karteEl.classList.toggle('ruhig', m.display?.kenBurns === false)
  karteEl.classList.add('an')
  document.querySelector('.karten-buehne')?.classList.add('foto-an')
  blinke($('foto-flash'), 'blitz', 750)

  if (einblendUhr) window.clearTimeout(einblendUhr)
  einblendUhr = window.setTimeout(() => verbergeFoto(), dauerS * 1000)
}

function verbergeFoto(): void {
  if (einblendUhr) window.clearTimeout(einblendUhr)
  einblendUhr = null
  const karteEl = document.getElementById('foto-einblendung')
  karteEl?.classList.remove('an')
  document.querySelector('.karten-buehne')?.classList.remove('foto-an')
  // Ein laufendes Video würde sonst unsichtbar weiterspielen
  karteEl?.querySelector('video')?.pause()
}

function zeigeTempo(tempo: number): void {
  const knopf = document.getElementById('tp-play')
  if (!knopf) return
  knopf.querySelector('use')?.setAttribute('href', tempo !== 0 ? '#i-pause' : '#i-play')
  knopf.classList.toggle('spielt', tempo !== 0)
  knopf.setAttribute('aria-label', tempo !== 0 ? 'Pause' : 'Abspielen')
  const chip = document.getElementById('tempo-chip')
  // Beim Schnelllauf Faktor und Richtung zeigen; bei Stopp und 1× nichts.
  if (chip) chip.textContent = tempo === 0 || tempo === 1 ? '' : tempo < 0 ? `${-tempo}×◀` : `${tempo}×▶`
  if (tempo === 0) {
    halteKartenFolge()
    verbergeFoto()
  }
}

async function spielUmschalten(): Promise<void> {
  if (!z) return
  if (!abspieler) {
    const modul = await import('./abspielen.js')
    abspieler = modul.erzeugeAbspieler({
      hole: holeSpielplan,
      setzeMarke: setzeMarkeAnteil,
      zeigeFoto,
      zeigeTempo,
      pulsKlang: (index) => blinke(document.querySelector(`.zl-sfx[data-index="${index}"]`), 'pling', 500),
    })
  }
  abspieler.umschalten()
}

/** Jede manuelle Geste hält an — man scrubbt nicht gegen einen laufenden Kopf. */
function halteAbspielen(): void {
  abspieler?.halteAn()
}

// — Speichern / Neu verarbeiten —

async function warteAufBereit(id: string): Promise<void> {
  for (let i = 0; i < 90; i++) {
    const t = await api.tour(id)
    if (t.schema === 'maptale/tour@1' || t.status === 'bereit') return
    if (t.status === 'fehler') throw new Error(`Verarbeitung fehlgeschlagen: ${t.fehler ?? 'unbekannt'}`)
    await new Promise((weiter) => setTimeout(weiter, 900))
  }
  throw new Error('Verarbeitung dauert ungewöhnlich lange — Liste später prüfen.')
}

async function speichern(): Promise<void> {
  if (!z) return
  const problem = pruefeOverlay(z.edits)
  if (problem) {
    status(problem, 'fehler')
    return
  }
  const speichernKnopf = $('editor-speichern') as HTMLButtonElement
  speichernKnopf.disabled = true
  try {
    // 1. Overlay (falls geändert) — der Server rendert die Tour neu
    if (JSON.stringify(z.edits) !== z.gespeichert) {
      status('Bearbeitungen werden gespeichert …')
      const antwort = await api.speichereEdits(z.tourId, z.edits)
      if (antwort.status === 'verarbeitung') await warteAufBereit(z.tourId)
    }
    // 2. Titel/Beschreibung/Finale (falls geändert) — eigener Endpunkt, eigener Re-Render;
    //    bewusst NACH dem Overlay, damit sich die Renderer nie überlappen
    const titel = ($('editor-titel') as HTMLInputElement).value.trim()
    const beschreibung = ($('editor-beschreibung') as HTMLTextAreaElement).value.trim()
    const finale = ($('editor-finale') as HTMLInputElement).checked
    const finaleZiel = ($('editor-finale-ziel') as HTMLInputElement).value.trim()
    const felder: {
      title?: string
      description?: string
      finale?: boolean
      finaleZiel?: string
    } = {}
    if (titel && titel !== (z.daten.title ?? '')) felder.title = titel
    if (beschreibung !== (z.daten.description ?? '')) felder.description = beschreibung
    if (finale !== !!z.daten.finale) felder.finale = finale
    if (finaleZiel !== (z.daten.finaleZiel ?? '')) felder.finaleZiel = finaleZiel
    if (Object.keys(felder).length) {
      status('Tour-Einstellungen werden gespeichert …')
      await api.patchTour(z.tourId, felder)
      // Nur warten, wenn PATCH wirklich einen Re-Render gestartet hat — auf
      // einer fehler-Tour würde warteAufBereit sonst den ALTEN Pipeline-
      // Fehler als Speicher-Fehler melden (Review-Fund).
      const stand = await api.tour(z.tourId)
      if (stand.status === 'verarbeitung') await warteAufBereit(z.tourId)
    }
    await ladeDaten(z.tourId)
    status('Gespeichert.', 'ok')
  } catch (fehler) {
    status((fehler as Error).message, 'fehler')
  } finally {
    speichernKnopf.disabled = false
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
  const knopf = $('editor-mehr') as HTMLButtonElement
  knopf.disabled = true
  try {
    status('Tour wird neu verarbeitet (Benennung/Wetter) …')
    await api.reprocess(z.tourId)
    await warteAufBereit(z.tourId)
    await ladeDaten(z.tourId)
    status('Neu verarbeitet — Bearbeitungen sind erhalten.', 'ok')
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
  $('editor-titel-knopf').addEventListener('click', oeffneTourEinstellungen)
  // „…" — was die ganze Tour betrifft, nicht das gerade Ausgewählte.
  $('editor-mehr').addEventListener('click', (e) => {
    e.stopPropagation()
    const knopf = $('editor-mehr')
    // Erneuter Klick schließt — nicht erst zu und sofort wieder auf.
    if (offenesMenue?.dataset['tour'] === '1') {
      schliesseSpurMenue()
      return
    }
    const menue = document.createElement('div')
    menue.className = 'schwebe-menue'
    menue.dataset['tour'] = '1'
    menue.append(
      menueEintrag('Tour-Einstellungen', oeffneTourEinstellungen),
      menueEintrag('Neu verarbeiten', () => void neuVerarbeiten()),
    )
    zeigeSchwebeMenue(menue, knopf)
  })
  // Der Kopf zeigt den Titel — er muss dem Feld folgen, sonst steht dort der
  // alte Name, bis die Tour neu geladen wird.
  $('editor-titel').addEventListener('input', zeigeTitelImKopf)
  $('editor-finale').addEventListener('change', syncFinaleZielFeld)
  $('editor-undo').addEventListener('click', rueckgaengig)
  $('editor-redo').addEventListener('click', wiederherstellen)
  $('karte-plus').addEventListener('click', () => {
    pausiereKartenFolge()
    karte?.zoomIn()
  })
  $('karte-minus').addEventListener('click', () => {
    pausiereKartenFolge()
    karte?.zoomOut()
  })
  $('tp-play').addEventListener('click', () => void spielUmschalten())
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
  document.addEventListener('pointerdown', () => { unterdrueckeKlick = false }, true)
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
        e.preventDefault()
        const t = abspieler?.tempo() ?? 0
        if (k === 'k') halteAbspielen()
        else if (!abspieler) void spielUmschalten()
        else abspieler.setzeTempo(k === 'l' ? (t < 1 ? 1 : Math.min(t * 2, 4)) : t > -1 ? -1 : Math.max(t * 2, -4))
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        // Feines Scrubben mit den Pfeiltasten: fünf FILM-Sekunden je Druck
        // (≈ eine Foto-Haltebreite) — eine Minute Aufnahmezeit war auf der
        // Filmzeit-Achse mal ein Pixel, mal die halbe Leiste. Landet der
        // Schritt in einem Halt-Sprung, steht der Kopf auf dem Halt.
        e.preventDefault()
        halteAbspielen()
        const achse = aktuelleAchse()
        if (achse?.kurve) {
          setzeKopfFilm(schrittFilmS(achse, kopfFilm(), e.key === 'ArrowRight' ? 5 : -5))
        } else if (z.auswahl) {
          setzeMarke(z.auswahl[3] + (e.key === 'ArrowRight' ? 60 : -60))
        }
      }
    }
  })
  // ⌥ zeigt beim Zoom-Werkzeug „herauszoomen" an
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Alt' && werkzeug === 'zoom') document.getElementById('spuren-fenster')?.classList.add('alt')
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
    const datei = eingabe.files?.[0]
    if (datei) void bibliothekHochladen(datei)
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
    vorschau ? { datei: vorschau.datei, volume: vorschau.audio.volume, pausiert: vorschau.audio.paused } : null,
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
