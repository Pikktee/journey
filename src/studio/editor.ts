// Studio-Editor (M7 + Kreativbaukasten): Karten-Editor über den Editor-Daten
// des Backends — Medien platzieren/verschieben/löschen, Captions, Modus- und
// Kamera-Grenzen, Trim (per Zeitleisten-Griff), Musik/SFX mit Streckenbereich,
// Foto-Anzeigeoptionen. Reine Logik liegt in editmodell.ts + zeitleiste.ts;
// hier nur DOM + MapLibre. Wird aus studio.ts lazy importiert, damit MapLibre
// nur bei Bedarf ins Studio-Bundle kommt.

import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import * as api from './api.js'
import {
  effektiveMedien,
  isoZuOffset,
  LEERES_OVERLAY,
  mitAudioEintrag,
  mitAudioPatch,
  mitKameraGrenze,
  mitMedienEdit,
  mitModusGrenze,
  mitMoment,
  mitTrim,
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
  zerlegeFuerAnzeige,
  type AudioEintrag,
  type EditOverlay,
  type EditorSegment,
  type KameraPreset,
  type MediumAnzeige,
  type MediumBasis,
  type Modus,
  type MomentArt,
  type TrackPunkt,
  type WetterModus,
} from './editmodell.js'
import {
  ankerScroll,
  anteilZuOffset,
  audioWirdVerworfen,
  baueAudioBalken,
  baueBaender,
  baueMassband,
  baueMedienDots,
  baueSkala,
  baueTrimGriffe,
  baueZustandsBaender,
  formatiereDauer,
  haltedauerS,
  kumMeter,
  meterZuOffset,
  offsetZuAnteil,
  schaetzeAnimationsdauer,
  type ZeitSkala,
} from './zeitleiste.js'
import { SFX_BIBLIOTHEK, sfxEffekt, type SfxEffekt } from './sfxbibliothek.js'

/** Anzeigename eines Audio-Eintrags: Katalogname bei Bibliothek, sonst Dateiname. */
function audioName(a: AudioEintrag): string {
  return (a.quelle === 'bibliothek' ? sfxEffekt(a.datei)?.name : undefined) ?? a.datei
}

/** Abspiel-URL eines Audio-Eintrags — Bibliothek statisch, sonst tour-lokal. */
function audioUrl(a: AudioEintrag, tourId: string): string {
  return a.quelle === 'bibliothek'
    ? `/audio/sfx/${encodeURIComponent(a.datei)}`
    : `/api/media/${tourId}/${encodeURIComponent(a.datei)}`
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
type Fokus =
  | { art: 'modus'; bezugS: number }
  | { art: 'kamera'; bezugS: number }
  | { art: 'wetter'; bezugS: number }
  | { art: 'moment'; ab: string }
  | { art: 'audio'; index: number }
  | { art: 'medium'; id: string }

/** Aufgelöster Fokus: was im Inspector steht und auf der Karte leuchtet. */
interface FokusInfo {
  art: Fokus['art']
  titel: string
  vonS: number
  bisS: number
  /** Overlay-Grenze, die dieses Band eröffnet — null = aus der Aufzeichnung, nicht entfernbar */
  ab: string | null
  mode?: Modus
  preset?: KameraPreset
  wetterMode?: WetterModus
  /** Wetter-Stärke k dieses Bands (nur bei eigener Grenze mit gesetzter staerke) */
  staerke?: number
  momentArt?: MomentArt
  dauerS?: number
  index?: number
  id?: string
}

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
let marker: maplibregl.Marker[] = []
let medienMarker = new Map<string, HTMLElement>()
let laeufer: maplibregl.Marker | null = null
let vorschau: { audio: HTMLAudioElement; datei: string } | null = null
let zurueckCb: (() => void) | null = null
let verdrahtet = false
/** Kumulierte Streckenmeter je Trackpunkt — für die km-Anzeige am Abspielkopf. */
let kumStrecke: number[] = []
/** Zoomfaktor der Zeitachse; 1 = ganze Tour im Fenster („angepasst"). */
let zoom = 1
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
  $('editor-view').hidden = false
  status('Editor wird geladen …')
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
    platzieren: null,
    historie: [],
    zukunft: [],
  }
  letzterStand = edits
  ;($('editor-titel') as HTMLInputElement).value = daten.title ?? ''
  ;($('editor-beschreibung') as HTMLTextAreaElement).value = daten.description ?? ''
  ;($('editor-vorschau') as HTMLAnchorElement).href = `/erlebnis.html?tour=srv:${tourId}`
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
  // Abspielkopf auf den Start der Wiedergabe (Trim-Anfang) stellen — er ist ab
  // jetzt immer sichtbar, nicht mehr eine Sonderlage nach dem ersten Klick.
  const skalaInit = baueSkala(z.track)
  if (skalaInit) {
    const trim = baueTrimGriffe(z.edits, z.daten.time.start, skalaInit)
    z.auswahl = punktZuOffset(z.track, anteilZuOffset(skalaInit, trim.start))
  }
  renderAlles()
  // Die Achsenbreite ERST danach setzen: `renderZeitleiste` blendet die Leisten-
  // Zone ein, und solange sie `hidden` ist, misst sich ihr Fenster als 0 breit —
  // der Zoom-Fit hätte auf die Notbreite gerechnet und die Achse gestaucht.
  zoom = 1
  wendeZoomAn(1, 0, spurXpx())
}

function schliesse(): void {
  $('editor-view').hidden = true
  stoppeVorschau()
  karte?.remove()
  karte = null
  z = null
  letzterStand = null
  marker = []
  medienMarker = new Map()
  laeufer = null
  kumStrecke = []
  zoom = 1
  zurueckCb?.()
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
  })
  k.addControl(new maplibregl.NavigationControl({ showCompass: false }))
  k.on('click', (e) => klickAufKarte(e))
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
  // Punktförmiger Fokus (Foto, Einzel-Sound) hat keine Ausdehnung
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
  renderAuswahl()
  renderTrim()
  renderInspektor()
  renderAudio()
  renderMedien()
  renderZeitleiste()
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
  for (const m of marker) m.remove()
  marker = []
  medienMarker = new Map()

  // Medien (nur verankerte, nicht gelöschte) — per Drag auf den Track schieben
  for (const m of medienAnzeige()) {
    if (!m.anchor || m.geloescht) continue
    const el = document.createElement('div')
    el.className = 'm-marker'
    const thumb = m.type === 'photo' ? m.src : m.poster
    if (thumb) el.style.backgroundImage = `url("${thumb}")`
    else el.innerHTML = icon('film')
    el.title = `${m.id} · ${PLACEMENT_NAMEN[m.placement] ?? m.placement}`
    const mk = new maplibregl.Marker({ element: el, draggable: true }).setLngLat(m.anchor).addTo(karte)
    let gezogen = false
    mk.on('dragstart', () => {
      gezogen = true
    })
    mk.on('dragend', () => {
      if (!z) return
      const ziel = mk.getLngLat()
      const projektion = projiziereAufTrack(z.track, ziel.lng, ziel.lat)
      z.edits = mitMedienEdit(z.edits, m.id, { anchor: [projektion.punkt[0], projektion.punkt[1]] })
      renderAlles()
    })
    // Klick auf den Marker → zugehörige Zeile in der Liste aufblitzen lassen
    el.addEventListener('click', (ev) => {
      ev.stopPropagation()
      if (gezogen) {
        gezogen = false
        return
      }
      if (!z) return
      z.fokus = { art: 'medium', id: m.id }
      renderAlles()
      blitzeZeile(m.id)
    })
    medienMarker.set(m.id, el)
    marker.push(mk)
  }

  // Modus-Grenzen + Trim-Kanten als beschriftete Pins am jeweiligen Trackpunkt
  const pin = (klasse: string, text: string, iso: string): void => {
    if (!karte || !z) return
    const punkt = punktZurZeit(iso)
    if (!punkt) return
    const el = document.createElement('div')
    el.className = klasse
    el.textContent = text
    marker.push(new maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, -6] }).setLngLat([punkt[0], punkt[1]]).addTo(karte))
  }
  for (const g of z.edits.modi ?? []) pin('g-marker', `${MODUS_NAMEN[g.mode]} ▸`, g.ab)
  if (z.edits.trim?.start !== undefined) pin('t-marker', '⟦ Start', z.edits.trim.start)
  if (z.edits.trim?.ende !== undefined) pin('t-marker', 'Ende ⟧', z.edits.trim.ende)

  // Auswahl-Punkt zuletzt (oben)
  if (z.auswahl) {
    const el = document.createElement('div')
    el.className = 'sel-marker'
    marker.push(new maplibregl.Marker({ element: el }).setLngLat([z.auswahl[0], z.auswahl[1]]).addTo(karte))
  }
}

/** Interpolierte Track-Position zu einem absoluten Zeitpunkt (Grenz-/Trim-Pins). */
function punktZurZeit(iso: string): TrackPunkt | null {
  if (!z) return null
  const offset = isoZuOffset(z.daten.time.start, iso)
  if (!Number.isFinite(offset)) return null
  return punktZuOffset(z.track, offset)
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
 * Overlay-Stand aufgelöst. Liefert null, wenn das Objekt weg ist (Grenze
 * entfernt, Audio gelöscht) — der Inspector zeigt dann wieder den Leerzustand.
 */
function loeseFokusAuf(): FokusInfo | null {
  if (!z?.fokus) return null
  const skala = baueSkala(z.track)
  if (!skala) return null
  const start = z.daten.time.start
  const f = z.fokus

  if (f.art === 'modus') {
    // Aus den Anzeige-Abschnitten (haben echte Trackpunkte, also echte Zeiten)
    const treffer = zerlegeFuerAnzeige(z.daten.segmente as EditorSegment[], z.edits, start).find((a) => {
      const von = (a.pts[0] as TrackPunkt)[3]
      const bis = (a.pts[a.pts.length - 1] as TrackPunkt)[3]
      return f.bezugS >= von && f.bezugS <= bis
    })
    if (!treffer) return null
    const vonS = (treffer.pts[0] as TrackPunkt)[3]
    const bisS = (treffer.pts[treffer.pts.length - 1] as TrackPunkt)[3]
    // Verantwortliche Overlay-Grenze: die letzte, die zu Bandbeginn schon gilt
    // und denselben Modus setzt. Fehlt sie, stammt das Band aus der
    // Aufzeichnung und lässt sich nicht entfernen — nur überschreiben.
    let ab: string | null = null
    for (const g of z.edits.modi ?? []) {
      const gS = isoZuOffset(start, g.ab)
      if (!Number.isFinite(gS) || gS > vonS + 1) break
      if (g.mode === treffer.mode) ab = g.ab
    }
    return { art: 'modus', titel: MODUS_NAMEN[treffer.mode], vonS, bisS, ab, mode: treffer.mode }
  }

  if (f.art === 'kamera') {
    const baender = baueZustandsBaender<KameraPreset | null>(
      (z.edits.kamera ?? []).map((g) => ({ ab: g.ab, wert: g.preset })),
      start,
      skala,
      null,
    )
    const treffer = baender.find(
      (b) => f.bezugS >= anteilZuOffset(skala, b.von) && f.bezugS <= anteilZuOffset(skala, b.bis),
    )
    if (!treffer) return null
    const basis = {
      art: 'kamera' as const,
      titel: treffer.wert ? `Kamera ${PRESET_NAMEN[treffer.wert]}` : 'Preset des Zuschauers',
      vonS: anteilZuOffset(skala, treffer.von),
      bisS: anteilZuOffset(skala, treffer.bis),
      ab: treffer.ab,
    }
    return treffer.wert ? { ...basis, preset: treffer.wert } : basis
  }

  if (f.art === 'wetter') {
    // Grund: klar (`off`), sobald IRGENDeine Wetter-Grenze existiert (dann
    // ersetzt das Overlay das Auto-Wetter komplett); sonst „automatisch".
    const hatOverride = (z.edits.wetter ?? []).length > 0
    const baender = baueZustandsBaender<WetterModus | null>(
      (z.edits.wetter ?? []).map((g) => ({ ab: g.ab, wert: g.mode })),
      start,
      skala,
      hatOverride ? 'off' : null,
    )
    const treffer = baender.find(
      (b) => f.bezugS >= anteilZuOffset(skala, b.von) && f.bezugS <= anteilZuOffset(skala, b.bis),
    )
    if (!treffer) return null
    const staerke = treffer.ab !== null ? z.edits.wetter?.find((g) => g.ab === treffer.ab)?.staerke : undefined
    return {
      art: 'wetter',
      titel: treffer.wert ? `Wetter ${WETTER_NAMEN[treffer.wert]}` : 'Automatisches Wetter',
      vonS: anteilZuOffset(skala, treffer.von),
      bisS: anteilZuOffset(skala, treffer.bis),
      ab: treffer.ab,
      ...(treffer.wert ? { wetterMode: treffer.wert } : {}),
      ...(staerke !== undefined ? { staerke } : {}),
    }
  }

  if (f.art === 'moment') {
    const m = (z.edits.momente ?? []).find((x) => x.ab === f.ab)
    if (!m) return null
    const s = isoZuOffset(start, m.ab)
    return {
      art: 'moment',
      titel: MOMENT_NAMEN[m.art],
      vonS: s,
      bisS: s,
      ab: m.ab,
      momentArt: m.art,
      ...(m.dauerS !== undefined ? { dauerS: m.dauerS } : {}),
    }
  }

  if (f.art === 'audio') {
    const a = (z.edits.audio ?? [])[f.index]
    if (!a) return null
    const vonS = isoZuOffset(start, a.ab)
    const bisS = a.typ === 'sfx' ? vonS : a.bis !== undefined ? isoZuOffset(start, a.bis) : skala.bisS
    return { art: 'audio', titel: a.datei, vonS, bisS, ab: a.ab, index: f.index }
  }

  const m = medienAnzeige().find((x) => x.id === f.id)
  if (!m?.anchor) return null
  const p = projiziereAufTrack(z.track, m.anchor[0], m.anchor[1])
  return { art: 'medium', titel: m.caption || m.id, vonS: p.punkt[3], bisS: p.punkt[3], ab: null, id: m.id }
}

function renderAuswahl(): void {
  if (!z) return
  const aktivierbar = z.auswahl !== null
  for (const id of ['e-trim-start', 'e-trim-ende', 'e-grenze', 'e-kamera', 'e-moment', 'e-wetter']) {
    ;($(id) as HTMLButtonElement).disabled = !aktivierbar
  }
  const info = $('editor-punkt-info')
  if (!z.auswahl) {
    info.textContent = 'Auf den Track oder die Zeitleiste klicken, um einen Punkt zu wählen.'
    return
  }
  info.textContent = `Punkt bei ${zeitText(offsetZuIso(z.daten.time.start, z.auswahl[3]))} Uhr`
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
 * Inspector: zeigt das fokussierte Objekt mit Spanne UND Dauer und lässt es
 * dort ändern. Ersetzt die früheren Listen „Trim/Fortbewegungs-Grenzen/
 * Kamera-Verläufe", die jede Grenze ein zweites Mal aufzählten — ohne zu
 * sagen, wann sie endet.
 */
function renderInspektor(): void {
  if (!z) return
  const el = $('editor-inspektor')
  el.innerHTML = ''
  const info = loeseFokusAuf()
  if (!info) {
    const leer = document.createElement('div')
    leer.className = 'leer'
    leer.textContent = 'Nichts gewählt — auf ein Band, eine Marke oder die Karte klicken.'
    el.appendChild(leer)
    return
  }
  const start = z.daten.time.start

  const kopf = document.createElement('div')
  kopf.className = 'insp-kopf'
  if (info.mode) {
    const farbe = document.createElement('span')
    farbe.className = 'farbe'
    farbe.style.background = MODUS_FARBEN[info.mode]
    kopf.appendChild(farbe)
  }
  const titel = document.createElement('strong')
  titel.textContent = info.titel
  kopf.appendChild(titel)
  el.appendChild(kopf)

  // Die eigentliche Antwort auf „wann startet das, wo endet es"
  const zeit = document.createElement('div')
  zeit.className = 'insp-zeit'
  zeit.textContent =
    info.bisS > info.vonS
      ? `${uhrKurz(offsetZuIso(start, info.vonS))} – ${uhrKurz(offsetZuIso(start, info.bisS))} Uhr · ${formatiereDauer(info.bisS - info.vonS)}`
      : `${uhrKurz(offsetZuIso(start, info.vonS))} Uhr`
  el.appendChild(zeit)

  const aktionen = document.createElement('div')
  aktionen.className = 'insp-aktionen'

  if (info.art === 'moment') {
    const abFest = info.ab as string
    // Art wählen (ersetzt den Moment am selben ab, Dauer bleibt erhalten)
    const wahl = document.createElement('select')
    wahl.setAttribute('aria-label', 'Art des Kamera-Moments')
    for (const [wert, name] of Object.entries(MOMENT_NAMEN)) {
      const opt = document.createElement('option')
      opt.value = wert
      opt.textContent = name
      if (wert === info.momentArt) opt.selected = true
      wahl.appendChild(opt)
    }
    wahl.addEventListener('change', () => {
      if (!z) return
      z.edits = mitMoment(z.edits, abFest, wahl.value as MomentArt, info.dauerS)
      renderAlles()
    })
    aktionen.appendChild(wahl)
    // Dauer in Sekunden (leer = Default der Art)
    const dauer = document.createElement('input')
    dauer.type = 'number'
    dauer.min = '1'
    dauer.max = '30'
    dauer.className = 'insp-dauer'
    dauer.value = info.dauerS !== undefined ? String(info.dauerS) : ''
    dauer.placeholder = `${MOMENT_DEFAULT_S[info.momentArt as MomentArt]}s`
    dauer.title = 'Dauer in Sekunden (leer = Standard)'
    dauer.addEventListener('change', () => {
      if (!z) return
      const v = dauer.value.trim() === '' ? undefined : Math.max(1, Math.min(30, Number(dauer.value)))
      z.edits = mitMoment(z.edits, abFest, info.momentArt as MomentArt, v)
      renderAlles()
    })
    aktionen.appendChild(dauer)
    const weg = document.createElement('button')
    weg.textContent = 'Entfernen'
    weg.addEventListener('click', () => {
      if (!z) return
      z.edits = ohneMoment(z.edits, abFest)
      z.fokus = null
      renderAlles()
    })
    aktionen.appendChild(weg)
  } else if (info.art === 'wetter') {
    const start = z.daten.time.start
    const staerkeAlt = info.ab !== null ? z.edits.wetter?.find((g) => g.ab === info.ab)?.staerke : info.staerke
    const wahl = document.createElement('select')
    wahl.setAttribute('aria-label', 'Wetter dieses Abschnitts')
    for (const [wert, name] of Object.entries(WETTER_NAMEN)) {
      const opt = document.createElement('option')
      opt.value = wert
      opt.textContent = name
      if (wert === info.wetterMode) opt.selected = true
      wahl.appendChild(opt)
    }
    wahl.addEventListener('change', () => {
      if (!z || !wahl.value) return
      // Ohne eigene Grenze (Grundband „Automatisch") wird am Bandanfang eine neue
      // gesetzt — der erste gesetzte Modus schaltet das Overlay scharf und ersetzt
      // damit das Auto-Wetter. Stärke bei „Klar" verwerfen (dort ohne Wirkung).
      const ab = info.ab ?? offsetZuIso(start, info.vonS)
      const neuMode = wahl.value as WetterModus
      z.edits = mitWetterGrenze(z.edits, ab, neuMode, neuMode === 'off' ? undefined : staerkeAlt)
      z.fokus = { art: 'wetter', bezugS: (info.vonS + info.bisS) / 2 }
      renderAlles()
    })
    aktionen.appendChild(wahl)

    // Stärke-Regler (nicht bei „Klar" — dort gibt es keine Intensität)
    if (info.wetterMode && info.wetterMode !== 'off') {
      const ab = info.ab ?? offsetZuIso(start, info.vonS)
      const mode = info.wetterMode
      const regler = document.createElement('input')
      regler.type = 'range'
      regler.min = '0'
      regler.max = '100'
      regler.step = '10'
      regler.className = 'insp-skala'
      regler.value = String(Math.round((staerkeAlt ?? WETTER_STANDARD_K) * 100))
      regler.title = 'Wetter-Stärke (leicht ↔ stark)'
      regler.setAttribute('aria-label', 'Wetter-Stärke')
      regler.addEventListener('change', () => {
        if (!z) return
        z.edits = mitWetterGrenze(z.edits, ab, mode, Number(regler.value) / 100)
        z.fokus = { art: 'wetter', bezugS: (info.vonS + info.bisS) / 2 }
        renderAlles()
      })
      aktionen.appendChild(regler)
    }

    if (info.ab !== null) {
      const weg = document.createElement('button')
      weg.textContent = 'Entfernen'
      weg.title = 'Diese Wetter-Grenze aufheben — der vorherige Zustand gilt dann weiter'
      const abFest = info.ab
      weg.addEventListener('click', () => {
        if (!z) return
        z.edits = ohneWetterGrenze(z.edits, abFest)
        z.fokus = null
        renderAlles()
      })
      aktionen.appendChild(weg)
    }
    el.appendChild(aktionen)
    // Hinweis: Overlay-Wetter ersetzt das automatische Wetter komplett
    const hinweis = document.createElement('div')
    hinweis.className = 'insp-hinweis'
    hinweis.textContent =
      (z.edits.wetter ?? []).length > 0
        ? 'Eigenes Wetter ersetzt das automatische Wetter der ganzen Tour.'
        : 'Ein Modus wählen ersetzt das automatische Wetter durch eigene Grenzen.'
    el.appendChild(hinweis)
    return
  } else if (info.art === 'modus' || info.art === 'kamera') {
    const werte: Array<[string, string]> =
      info.art === 'modus' ? Object.entries(MODUS_NAMEN) : Object.entries(PRESET_NAMEN)
    const aktuell = info.art === 'modus' ? (info.mode as string) : (info.preset as string | undefined)
    const wahl = document.createElement('select')
    wahl.setAttribute('aria-label', info.art === 'modus' ? 'Fortbewegung dieses Abschnitts' : 'Kamera dieses Abschnitts')
    if (aktuell === undefined) {
      const leer = document.createElement('option')
      leer.textContent = 'Preset des Zuschauers'
      leer.value = ''
      wahl.appendChild(leer)
    }
    for (const [wert, name] of werte) {
      const opt = document.createElement('option')
      opt.value = wert
      opt.textContent = name
      if (wert === aktuell) opt.selected = true
      wahl.appendChild(opt)
    }
    // Aktuelle Feinjustierung dieses Kamera-Bands (falls eigene Grenze)
    const kamSkala = info.art === 'kamera' && info.ab !== null
      ? z.edits.kamera?.find((g) => g.ab === info.ab)?.skala
      : undefined
    wahl.addEventListener('change', () => {
      if (!z || !wahl.value) return
      // Ohne eigene Grenze (Band aus der Aufzeichnung) wird am Bandanfang eine
      // neue gesetzt — so lässt sich JEDER Abschnitt direkt umstellen.
      const ab = info.ab ?? offsetZuIso(z.daten.time.start, info.vonS)
      z.edits =
        info.art === 'modus'
          ? mitModusGrenze(z.edits, ab, wahl.value as Modus)
          : mitKameraGrenze(z.edits, ab, wahl.value as KameraPreset, kamSkala) // Skala erhalten
      // Bandmitte als Bezug: bleibt im Band, auch wenn die neue Grenze exakt
      // auf dem alten Anfang liegt
      const bezugS = (info.vonS + info.bisS) / 2
      z.fokus = info.art === 'modus' ? { art: 'modus', bezugS } : { art: 'kamera', bezugS }
      renderAlles()
    })
    aktionen.appendChild(wahl)

    // Näher/Weiter-Regler: stufenlose Feinjustierung eines Kamera-Bands mit Preset
    if (info.art === 'kamera' && info.preset) {
      const ab = info.ab ?? offsetZuIso(z.daten.time.start, info.vonS)
      const preset = info.preset
      const regler = document.createElement('input')
      regler.type = 'range'
      regler.min = '50'
      regler.max = '200'
      regler.step = '5'
      regler.className = 'insp-skala'
      regler.value = String(Math.round((kamSkala ?? 1) * 100))
      regler.title = 'Näher ↔ Weiter (Feinjustierung über das Preset hinaus)'
      regler.setAttribute('aria-label', 'Kamera näher oder weiter')
      regler.addEventListener('change', () => {
        if (!z) return
        const s = Number(regler.value) / 100
        z.edits = mitKameraGrenze(z.edits, ab, preset, s)
        z.fokus = { art: 'kamera', bezugS: (info.vonS + info.bisS) / 2 }
        renderAlles()
      })
      aktionen.appendChild(regler)
    }

    if (info.ab !== null) {
      const weg = document.createElement('button')
      weg.textContent = 'Entfernen'
      weg.title = 'Diese Grenze aufheben — der vorherige Zustand gilt dann weiter'
      const abFest = info.ab
      weg.addEventListener('click', () => {
        if (!z) return
        z.edits = info.art === 'modus' ? ohneModusGrenze(z.edits, abFest) : ohneKameraGrenze(z.edits, abFest)
        z.fokus = null
        renderAlles()
      })
      aktionen.appendChild(weg)
    }
  } else {
    // Audio/Medien werden weiterhin in ihren Panels bearbeitet — von hier aus
    // wird nur dorthin gesprungen.
    const hin = document.createElement('button')
    hin.textContent = 'Im Panel bearbeiten'
    hin.addEventListener('click', () => {
      if (info.art === 'medium') {
        blitzeZeile(info.id as string) // scrollt selbst
        return
      }
      const zeile = document.querySelector<HTMLElement>(`#editor-audio .audio-zeile[data-index="${info.index}"]`)
      zeile?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      zeile?.classList.remove('blitz')
      void zeile?.offsetWidth
      zeile?.classList.add('blitz')
    })
    aktionen.appendChild(hin)
  }
  el.appendChild(aktionen)
}

/** Trim-Status kompakt unter der Einfügemarke (früher eine eigene Gruppe). */
function renderTrim(): void {
  if (!z) return
  const trimEl = $('editor-trim')
  trimEl.innerHTML = ''
  const { start, ende } = z.edits.trim ?? {}
  if (start === undefined && ende === undefined) return
  for (const [teil, iso] of [['start', start], ['ende', ende]] as Array<['start' | 'ende', string | undefined]>) {
    if (iso === undefined) continue
    const zeile = document.createElement('div')
    zeile.className = 'grenz-zeile'
    const text = document.createElement('span')
    text.textContent = `${teil === 'start' ? 'Start ab' : 'Ende bei'} ${zeitText(iso)} Uhr`
    zeile.appendChild(text)
    zeile.appendChild(entfernenKnopf(() => z && (z.edits = mitTrim(z.edits, teil, null))))
    trimEl.appendChild(zeile)
  }
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

/** Medien-Zeile in der Sidebar aufblitzen lassen (Karte→Liste-Sync). */
function blitzeZeile(id: string): void {
  const zeile = document.querySelector<HTMLElement>(`.medien-zeile[data-id="${id}"]`)
  if (!zeile) return
  zeile.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  zeile.classList.remove('blitz')
  void zeile.offsetWidth
  zeile.classList.add('blitz')
}

function renderMedien(): void {
  if (!z) return
  const container = $('editor-medien')
  container.innerHTML = ''
  const liste = medienAnzeige()
  if (!liste.length) {
    container.innerHTML = '<div class="leer">Keine Medien.</div>'
    return
  }
  for (const m of liste) {
    const zeile = document.createElement('div')
    zeile.className = `medien-zeile${m.geloescht ? ' geloescht' : ''}`
    zeile.dataset['id'] = m.id

    const thumb = document.createElement(m.type === 'photo' || m.poster ? 'img' : 'div') as HTMLImageElement
    thumb.className = 'thumb'
    if (m.type === 'photo') thumb.src = m.src
    else if (m.poster) thumb.src = m.poster
    else thumb.innerHTML = icon('film')
    thumb.style.cursor = m.anchor ? 'pointer' : ''
    thumb.title = m.anchor ? 'Auf der Karte zeigen' : ''
    thumb.addEventListener('click', () => fliegeZuMedium(m))
    zeile.appendChild(thumb)

    const info = document.createElement('div')
    info.className = 'm-info'
    // Kein innerHTML: zeitText() fällt bei kaputtem takenAt auf den ROHEN
    // Manifest-String zurück — Nutzerdaten gehören nur in Textknoten.
    const kopf = document.createElement('div')
    kopf.className = 'm-kopf'
    const zeit = document.createElement('span')
    zeit.className = 'm-zeit'
    zeit.textContent = `${zeitText(m.takenAt)} Uhr`
    zeit.title = zeit.textContent
    kopf.appendChild(zeit)
    const badgeEl = document.createElement('span')
    badgeEl.className = `badge ${m.geloescht ? 'geloescht' : m.placement}`
    badgeEl.textContent = m.geloescht ? 'gelöscht' : (PLACEMENT_NAMEN[m.placement] ?? m.placement)
    if (m.placement === 'zeit' && m.gpsAnker) {
      badgeEl.title = 'GPS-Ort lag zu weit ab vom Track — über die Aufnahmezeit platziert.'
    }
    kopf.appendChild(badgeEl)
    info.appendChild(kopf)
    const caption = document.createElement('input')
    caption.type = 'text'
    // „Titel", nicht „Bildunterschrift": der Text steht im Player als
    // Überschrift des Foto-Stopps, die Uhrzeit rutscht darunter.
    caption.placeholder = 'Titel'
    caption.value = m.caption
    caption.addEventListener('change', () => {
      if (!z) return
      const basis = z.daten.medien.find((b) => b.id === m.id)
      // Gleicht der Text wieder dem Original, fliegt der Override raus
      z.edits = mitMedienEdit(z.edits, m.id, {
        caption: caption.value === (basis?.caption ?? '') ? undefined : caption.value,
      })
    })
    info.appendChild(caption)

    // Anzeigeoptionen (nur Fotos: Videos halten so lange wie das Video läuft)
    if (m.type === 'photo' && !m.geloescht) {
      const optionen = document.createElement('div')
      optionen.className = 'm-optionen'
      const hold = document.createElement('select')
      hold.title = 'Haltedauer des Foto-Stopps'
      for (const [wert, text] of [['', 'Auto (5 s)'], ['3', '3 s'], ['5', '5 s'], ['8', '8 s'], ['12', '12 s'], ['20', '20 s']]) {
        const opt = document.createElement('option')
        opt.value = wert as string
        opt.textContent = text as string
        hold.appendChild(opt)
      }
      hold.value = m.display?.holdS !== undefined ? String(m.display.holdS) : ''
      hold.addEventListener('change', () => {
        if (!z) return
        const display = { ...(z.edits.medien?.[m.id]?.display ?? {}) }
        if (hold.value === '') delete display.holdS
        else display.holdS = Number(hold.value)
        z.edits = mitMedienEdit(z.edits, m.id, { display })
      })
      optionen.appendChild(hold)
      const kb = document.createElement('label')
      kb.className = 'kb'
      const kbBox = document.createElement('input')
      kbBox.type = 'checkbox'
      kbBox.checked = m.display?.kenBurns !== false
      kbBox.addEventListener('change', () => {
        if (!z) return
        const display = { ...(z.edits.medien?.[m.id]?.display ?? {}) }
        if (kbBox.checked) delete display.kenBurns
        else display.kenBurns = false
        z.edits = mitMedienEdit(z.edits, m.id, { display })
      })
      kb.append(kbBox, 'Ken-Burns')
      kb.title = 'Langsamer Bild-Drift während des Stopps'
      optionen.appendChild(kb)
      info.appendChild(optionen)
    }
    zeile.appendChild(info)

    const aktionen = document.createElement('div')
    aktionen.className = 'm-aktionen'
    const platzieren = document.createElement('button')
    platzieren.className = z.platzieren === m.id ? 'aktiv' : ''
    platzieren.textContent = z.platzieren === m.id ? 'Abbrechen' : 'Platzieren'
    platzieren.addEventListener('click', () => {
      if (!z) return
      z.platzieren = z.platzieren === m.id ? null : m.id
      renderAlles()
    })
    aktionen.appendChild(platzieren)
    if (m.gpsAnker && m.placement === 'zeit') {
      const gps = document.createElement('button')
      gps.className = 'm-gps-knopf'
      gps.textContent = 'GPS-Ort'
      gps.title = 'Den echten Aufnahmeort als Anker verwenden (Abstecher abseits des Tracks)'
      gps.addEventListener('click', () => {
        if (!z || !m.gpsAnker) return
        z.edits = mitMedienEdit(z.edits, m.id, { anchor: m.gpsAnker })
        renderAlles()
      })
      aktionen.appendChild(gps)
    }
    if (z.edits.medien?.[m.id]?.anchor) {
      const auto = document.createElement('button')
      auto.textContent = 'Auto-Anker'
      auto.title = 'Manuellen Anker verwerfen, Auto-Platzierung gilt wieder'
      auto.addEventListener('click', () => {
        if (!z) return
        z.edits = mitMedienEdit(z.edits, m.id, { anchor: undefined })
        renderAlles()
      })
      aktionen.appendChild(auto)
    }
    const loeschen = document.createElement('button')
    loeschen.textContent = m.geloescht ? 'Wiederherstellen' : 'Löschen'
    loeschen.addEventListener('click', () => {
      if (!z) return
      z.edits = mitMedienEdit(z.edits, m.id, { geloescht: !m.geloescht })
      renderAlles()
    })
    aktionen.appendChild(loeschen)
    zeile.appendChild(aktionen)

    container.appendChild(zeile)
  }
}

// — Musik & Sound (Audio-Assets + Overlay-Einträge) —

function stoppeVorschau(): void {
  if (!vorschau) return
  vorschau.audio.pause()
  vorschau.audio.removeAttribute('src')
  vorschau.audio.load()
  vorschau = null
}

function audioStatus(text: string, klasse = ''): void {
  const el = $('editor-audio-status')
  el.className = `hinweis ${klasse}`
  el.textContent = text
}

async function audioHochladen(datei: File): Promise<void> {
  if (!z) return
  const endung = datei.name.toLowerCase().split('.').pop() ?? ''
  if (!AUDIO_ENDUNGEN.includes(endung)) {
    audioStatus(`Nicht unterstützt: .${endung} (erlaubt: ${AUDIO_ENDUNGEN.join(', ')})`, 'fehler')
    return
  }
  // Dateiname säubern + eindeutig machen (Server verbietet Überschreiben)
  const basis = (datei.name.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'audio').slice(0, 40)
  const vorhandene = new Set((z.daten.audio ?? []).map((a) => a.datei))
  let name = `${basis}.${endung}`
  for (let n = 2; vorhandene.has(name); n++) name = `${basis}-${n}.${endung}`
  audioStatus(`${datei.name} wird hochgeladen …`)
  try {
    await api.ladeAudio(z.tourId, name, datei)
  } catch (fehler) {
    audioStatus((fehler as Error).message, 'fehler')
    return
  }
  z.daten.audio = [...(z.daten.audio ?? []), { datei: name, groesse: datei.size }]
  // Standard-Eintrag: Musik ab Tour-Beginn (bzw. Trim-Start) bis zum Ende
  const start = z.daten.time.start
  const skala = baueSkala(z.track)
  const abOffset = z.edits.trim?.start !== undefined ? isoZuOffset(start, z.edits.trim.start) : (skala?.vonS ?? 0)
  z.edits = mitAudioEintrag(z.edits, { datei: name, typ: 'musik', ab: offsetZuIso(start, abOffset) })
  audioStatus('Hochgeladen — Typ und Bereich unten anpassen, dann Speichern.', 'ok')
  renderAlles()
}

function renderAudio(): void {
  const zz = z // Modul-let: Narrowing überlebt die Closures unten nicht
  if (!zz) return
  const container = $('editor-audio')
  container.innerHTML = ''
  const eintraege = zz.edits.audio ?? []
  const dateien = zz.daten.audio ?? []
  if (!eintraege.length && !dateien.length) {
    container.innerHTML = '<div class="leer">Eigene Musik oder Soundeffekte für diese Tour hochladen (MP3, M4A, OGG, WAV).</div>'
    return
  }
  const start = zz.daten.time.start
  const trimSkala = baueSkala(zz.track)

  eintraege.forEach((a, index) => {
    const zeile = document.createElement('div')
    zeile.className = 'audio-zeile'
    zeile.dataset['index'] = String(index) // Sprungziel aus dem Inspector
    // Liegt der Eintrag komplett im weggetrimmten Bereich, verwirft ihn die
    // Pipeline still — hier sichtbar machen, statt den Nutzer rätseln zu lassen
    const verworfen = trimSkala !== null && audioWirdVerworfen(a, zz.edits, start, trimSkala)

    const kopf = document.createElement('div')
    kopf.className = 'a-kopf'
    kopf.innerHTML = icon(a.typ === 'musik' ? 'note' : 'blitz')
    const name = document.createElement('span')
    name.className = 'a-name'
    name.textContent = audioName(a)
    name.title = a.datei
    kopf.appendChild(name)
    if (a.quelle === 'bibliothek') {
      const badge = document.createElement('span')
      badge.className = 'a-quelle'
      badge.textContent = 'Bibliothek'
      kopf.appendChild(badge)
    }
    const typ = document.createElement('select')
    for (const [wert, text] of [['musik', 'Musik'], ['sfx', 'Sound']]) {
      const opt = document.createElement('option')
      opt.value = wert as string
      opt.textContent = text as string
      typ.appendChild(opt)
    }
    typ.value = a.typ
    typ.addEventListener('change', () => {
      if (!z) return
      z.edits = mitAudioPatch(z.edits, index, { typ: typ.value as 'musik' | 'sfx' })
      renderAlles()
    })
    kopf.appendChild(typ)
    const weg = document.createElement('button')
    weg.className = 'chip-x'
    weg.textContent = '×'
    weg.title = 'Eintrag entfernen'
    weg.setAttribute('aria-label', `${a.datei} entfernen`)
    weg.addEventListener('click', () => void audioEintragEntfernen(index))
    kopf.appendChild(weg)
    zeile.appendChild(kopf)

    if (verworfen) {
      const warnung = document.createElement('div')
      warnung.className = 'a-warnung'
      warnung.textContent =
        a.typ === 'sfx'
          ? 'Liegt im weggetrimmten Bereich — wird nicht abgespielt.'
          : 'Bereich liegt außerhalb des getrimmten Tracks — wird nicht abgespielt.'
      zeile.appendChild(warnung)
    }

    const zeiten = document.createElement('div')
    zeiten.className = 'a-zeiten'
    const abText = document.createElement('span')
    abText.textContent = `ab ${zeitText(a.ab)}`
    zeiten.appendChild(abText)
    const abKnopf = document.createElement('button')
    abKnopf.textContent = '→ Punkt'
    abKnopf.title = 'Beginn auf den gewählten Punkt setzen'
    abKnopf.disabled = !zz.auswahl
    abKnopf.addEventListener('click', () => {
      if (!z || !z.auswahl) return
      z.edits = mitAudioPatch(z.edits, index, { ab: offsetZuIso(start, z.auswahl[3]) })
      renderAlles()
    })
    zeiten.appendChild(abKnopf)
    if (a.typ === 'musik') {
      const bisText = document.createElement('span')
      bisText.textContent = a.bis !== undefined ? `bis ${zeitText(a.bis)}` : 'bis Ende'
      zeiten.appendChild(bisText)
      const bisKnopf = document.createElement('button')
      bisKnopf.textContent = '→ Punkt'
      bisKnopf.title = 'Ende auf den gewählten Punkt setzen'
      bisKnopf.disabled = !zz.auswahl
      bisKnopf.addEventListener('click', () => {
        if (!z || !z.auswahl) return
        z.edits = mitAudioPatch(z.edits, index, { bis: offsetZuIso(start, z.auswahl[3]) })
        renderAlles()
      })
      zeiten.appendChild(bisKnopf)
      if (a.bis !== undefined) {
        const bisWeg = document.createElement('button')
        bisWeg.textContent = '× Ende'
        bisWeg.title = 'Wieder bis zum Tour-Ende spielen'
        bisWeg.addEventListener('click', () => {
          if (!z) return
          z.edits = mitAudioPatch(z.edits, index, { bis: undefined })
          renderAlles()
        })
        zeiten.appendChild(bisWeg)
      }
    }
    zeile.appendChild(zeiten)

    const fuss = document.createElement('div')
    fuss.className = 'a-fuss'
    const hoeren = document.createElement('button')
    const spielt = vorschau?.datei === a.datei
    hoeren.innerHTML = spielt ? '■' : icon('play')
    hoeren.title = spielt ? 'Vorhören stoppen' : 'Vorhören'
    hoeren.addEventListener('click', () => {
      if (!z) return
      if (vorschau?.datei === a.datei) {
        stoppeVorschau()
      } else {
        stoppeVorschau()
        const audio = new Audio(audioUrl(a, z.tourId))
        audio.volume = a.lautstaerke ?? 1
        audio.addEventListener('ended', () => {
          stoppeVorschau()
          renderAudio()
        })
        void audio.play().catch(() => audioStatus('Vorhören blockiert — einmal in die Seite klicken.', 'fehler'))
        vorschau = { audio, datei: a.datei }
      }
      renderAudio()
    })
    fuss.appendChild(hoeren)
    const regler = document.createElement('input')
    regler.type = 'range'
    regler.min = '0'
    regler.max = '100'
    regler.value = String(Math.round((a.lautstaerke ?? 1) * 100))
    regler.title = 'Lautstärke'
    const lautText = document.createElement('span')
    lautText.className = 'laut'
    lautText.textContent = `${regler.value} %`
    regler.addEventListener('input', () => {
      lautText.textContent = `${regler.value} %`
      if (vorschau?.datei === a.datei) vorschau.audio.volume = Number(regler.value) / 100
    })
    regler.addEventListener('change', () => {
      if (!z) return
      const wert = Number(regler.value) / 100
      z.edits = mitAudioPatch(z.edits, index, { lautstaerke: wert === 1 ? undefined : wert })
      renderZeitleiste()
    })
    fuss.appendChild(regler)
    fuss.appendChild(lautText)
    zeile.appendChild(fuss)

    container.appendChild(zeile)
  })

  // Hochgeladene Dateien ohne Eintrag (nach „Eintrag entfernen" — Löschen ist
  // hier ein bewusster zweiter Schritt; referenzierte Dateien lehnt der Server ab)
  const benutzt = new Set(eintraege.map((a) => a.datei))
  for (const d of dateien.filter((d) => !benutzt.has(d.datei))) {
    const zeile = document.createElement('div')
    zeile.className = 'audio-zeile'
    const kopf = document.createElement('div')
    kopf.className = 'a-kopf'
    kopf.innerHTML = icon('note')
    const name = document.createElement('span')
    name.className = 'a-name'
    name.textContent = d.datei
    name.title = `${d.datei} · ${(d.groesse / 1048576).toFixed(1)} MB — nicht eingesetzt`
    name.style.opacity = '0.6'
    kopf.appendChild(name)
    const nutzen = document.createElement('button')
    nutzen.textContent = 'Einsetzen'
    nutzen.addEventListener('click', () => {
      if (!z) return
      const skala = baueSkala(z.track)
      z.edits = mitAudioEintrag(z.edits, { datei: d.datei, typ: 'musik', ab: offsetZuIso(z.daten.time.start, skala?.vonS ?? 0) })
      renderAlles()
    })
    kopf.appendChild(nutzen)
    const weg = document.createElement('button')
    weg.className = 'chip-x'
    weg.textContent = '×'
    weg.title = 'Datei vom Server löschen'
    weg.addEventListener('click', () => void audioDateiLoeschen(d.datei))
    kopf.appendChild(weg)
    zeile.appendChild(kopf)
    container.appendChild(zeile)
  }
}

// — Soundeffekt-Bibliothek (Dialog) —

let dialogAudio: HTMLAudioElement | null = null
let dialogSpielt: string | null = null // Datei des gerade vorgehörten Effekts

function stoppeDialogVorschau(): void {
  dialogAudio?.pause()
  dialogAudio = null
  dialogSpielt = null
}

/** Effekt aus der Bibliothek in die Tour übernehmen (ab gewähltem Punkt bzw. Beginn). */
function sfxEinsetzen(eff: SfxEffekt): void {
  if (!z) return
  const start = z.daten.time.start
  const skala = baueSkala(z.track)
  // Ist ein Punkt gewählt, dort einsetzen (v. a. für One-Shots gemeint) — sonst
  // ab Trim-/Tour-Beginn, wie beim Upload.
  const abOffset = z.auswahl
    ? z.auswahl[3]
    : z.edits.trim?.start !== undefined
      ? isoZuOffset(start, z.edits.trim.start)
      : (skala?.vonS ?? 0)
  z.edits = mitAudioEintrag(z.edits, { datei: eff.datei, typ: eff.typ, ab: offsetZuIso(start, abOffset), quelle: 'bibliothek' })
  schliesseSfxDialog()
  renderAlles()
  audioStatus(`„${eff.name}" eingesetzt — auf der Zeitleiste platzieren, dann Speichern.`, 'ok')
}

function baueSfxDialog(): void {
  const inhalt = $('sfx-inhalt')
  inhalt.innerHTML = ''
  for (const [kat, titel] of [
    ['umgebung', 'Umgebung — Loops über einen Bereich'],
    ['effekt', 'Effekte — einmalig an einem Punkt'],
  ] as const) {
    const gruppe = document.createElement('div')
    gruppe.className = 'sfx-gruppe'
    gruppe.textContent = titel
    inhalt.appendChild(gruppe)
    for (const eff of SFX_BIBLIOTHEK.filter((e) => e.kategorie === kat)) {
      const zeile = document.createElement('div')
      zeile.className = 'sfx-eintrag'
      const spielt = dialogSpielt === eff.datei
      const hoeren = document.createElement('button')
      hoeren.className = 'sfx-hoeren'
      hoeren.innerHTML = spielt ? '■' : icon('play')
      hoeren.title = spielt ? 'Stoppen' : 'Vorhören'
      hoeren.addEventListener('click', () => {
        if (dialogSpielt === eff.datei) {
          stoppeDialogVorschau()
        } else {
          stoppeDialogVorschau()
          dialogAudio = new Audio(`/audio/sfx/${encodeURIComponent(eff.datei)}`)
          dialogSpielt = eff.datei
          dialogAudio.addEventListener('ended', () => {
            stoppeDialogVorschau()
            baueSfxDialog()
          })
          void dialogAudio.play().catch(() => audioStatus('Vorhören blockiert — einmal in die Seite klicken.', 'fehler'))
        }
        baueSfxDialog()
      })
      zeile.appendChild(hoeren)
      const text = document.createElement('div')
      text.className = 'sfx-text'
      const nm = document.createElement('div')
      nm.className = 'sfx-name'
      nm.textContent = eff.name
      const be = document.createElement('div')
      be.className = 'sfx-besch'
      be.textContent = eff.beschreibung
      text.append(nm, be)
      zeile.appendChild(text)
      const nutzen = document.createElement('button')
      nutzen.textContent = 'Einsetzen'
      nutzen.addEventListener('click', () => sfxEinsetzen(eff))
      zeile.appendChild(nutzen)
      inhalt.appendChild(zeile)
    }
  }
}

function oeffneSfxDialog(): void {
  baueSfxDialog()
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
  // referenziert sie ggf. noch. Sie erscheint unten als „nicht eingesetzt"
  // und ist dort explizit löschbar (der Server schützt referenzierte Dateien).
  audioStatus(`Eintrag entfernt — ${eintrag.datei} bleibt gespeichert.`, 'ok')
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

// — Zeitleiste: Bänder, Trim-Griffe, Pins, Medien-Dots, Audio-Spur —

interface ZugZustand {
  rolle: string
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

/** data-Attribute eines Bandes → Fokus-Identität. */
function bandZuFokusEl(el: HTMLElement | null): Fokus | null {
  return bandZuFokus(el)
}

function renderZeitleiste(): void {
  if (!z) return
  const zone = $('zeitleiste-zone')
  const skala = baueSkala(z.track)
  if (!skala) {
    zone.hidden = true
    return
  }
  zone.hidden = false
  const start = z.daten.time.start
  const anteilVon = (iso: string): number => offsetZuAnteil(skala, isoZuOffset(start, iso))
  const fokusInfo = loeseFokusAuf()

  renderSkala()

  /**
   * Zustandsband mit Beschriftung — Anfang und Ende sind dieselbe Kante.
   * `art` macht das Band anklickbar: die Bandmitte dient als Fokus-Bezug
   * (überlebt das Verschieben von Grenzen besser als der Bandanfang).
   */
  const band = (art: 'modus' | 'kamera' | 'wetter', von: number, bis: number, text: string, farbe?: string): HTMLElement => {
    const d = document.createElement('div')
    d.className = 'band'
    d.style.left = pos(von)
    d.style.width = pos(bis - von)
    if (farbe) d.style.background = farbe
    d.dataset['fokus'] = art
    d.dataset['bezugs'] = String(anteilZuOffset(skala, (von + bis) / 2))
    const t = document.createElement('span')
    t.textContent = text
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

  // — Fortbewegung: Bänder aus der Anzeige-Zerlegung (Segment-Modi + Grenzen +
  //   Trim-Graufärbung); ziehbar sind nur die ECHTEN Overlay-Grenzen —
  const modusBahn = spur('spur-wege')
  for (const b of baueBaender(zerlegeFuerAnzeige(z.daten.segmente as EditorSegment[], z.edits, start), skala)) {
    const d = band('modus', b.von, b.bis, MODUS_NAMEN[b.mode], MODUS_FARBEN[b.mode])
    if (!b.aktiv) d.classList.add('inaktiv')
    if (istFokus('modus', b.von, b.bis)) d.classList.add('fokus')
    modusBahn.appendChild(d)
  }
  for (const g of z.edits.modi ?? []) {
    const a = anteilVon(g.ab)
    if (!Number.isFinite(a)) continue
    modusBahn.appendChild(
      kante(a, 'grenze', { ab: g.ab, mode: g.mode }, `${MODUS_NAMEN[g.mode]} ab ${zeitText(g.ab)} Uhr — ziehen zum Verschieben`),
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
      (b.wert ? PRESET_NAMEN[b.wert] : 'Preset des Zuschauers') + skalaTxt,
      b.wert ? PRESET_FARBEN[b.wert] : undefined,
    )
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

  // — Wetter: wie Kamera; Grund je nach Overlay „Automatisch" (kein Override →
  //   Auto-Wetter) oder „Klar" (Overlay ersetzt das Auto-Wetter vollständig) —
  const wetterBahn = spur('spur-wetter')
  const hatWetter = (z.edits.wetter ?? []).length > 0
  const wetterBaender = baueZustandsBaender<WetterModus | null>(
    (z.edits.wetter ?? []).map((g) => ({ ab: g.ab, wert: g.mode })),
    start,
    skala,
    hatWetter ? 'off' : null,
  )
  for (const b of wetterBaender) {
    const staerke = b.ab !== null ? z.edits.wetter?.find((g) => g.ab === b.ab)?.staerke : undefined
    const staerkeTxt = b.wert && b.wert !== 'off' && staerke !== undefined ? ` ${Math.round(staerke * 100)}%` : ''
    const d = band(
      'wetter',
      b.von,
      b.bis,
      (b.wert ? WETTER_NAMEN[b.wert] : 'Automatisch') + staerkeTxt,
      b.wert ? WETTER_FARBEN[b.wert] : undefined,
    )
    if (!b.wert) d.classList.add('leise')
    else d.classList.add('hell')
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

  // — Musik & Sound: Klips (Dauer) unten, Klang-Pins (Zeitpunkt) oben —
  const audioBahn = spur('spur-musik')
  for (const b of baueAudioBalken(z.edits.audio ?? [], start, skala)) {
    if (b.typ === 'musik') {
      const klip = document.createElement('div')
      klip.className = 'zl-klip'
      klip.style.left = pos(b.von)
      klip.style.width = pos(Math.max(0.004, b.bis - b.von))
      klip.dataset['rolle'] = 'audio-balken'
      klip.dataset['index'] = String(b.index)
      klip.title = `${b.datei} — ziehen zum Verschieben, Kanten für Anfang und Ende`
      if (fokusInfo?.art === 'audio' && fokusInfo.index === b.index) klip.classList.add('fokus')
      const name = document.createElement('span')
      name.textContent = b.datei
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
      pin.title = `${b.datei} (Einzel-Sound) — ziehen zum Verschieben`
      if (fokusInfo?.art === 'audio' && fokusInfo.index === b.index) pin.classList.add('fokus')
      pin.appendChild(document.createElement('i'))
      audioBahn.appendChild(pin)
    }
  }

  // — Fotos/Videos: Miniaturen an ihrer Aufnahmezeit —
  const medien = medienAnzeige()
  const nachId = new Map(medien.map((m) => [m.id, m]))
  const fotoBahn = spur('spur-fotos')
  for (const d of baueMedienDots(medien, z.track, skala)) {
    const m = nachId.get(d.id)
    const mini = document.createElement('button')
    mini.type = 'button'
    mini.className = 'f-mini'
    mini.style.left = pos(d.anteil)
    mini.dataset['rolle'] = 'dot'
    mini.dataset['id'] = d.id
    const halt = m?.type === 'photo' ? haltedauerS(m.display) : 0
    mini.title = halt ? `${d.id} — ${zeitText(m?.takenAt ?? '')} Uhr, ${halt} s Haltedauer` : d.id
    const bild = document.createElement('img')
    bild.src = (d.type === 'video' ? (m?.poster ?? '') : (m?.src ?? '')) || (m?.src ?? '')
    bild.alt = ''
    bild.loading = 'lazy'
    mini.appendChild(bild)
    if (d.type === 'video') {
      const badge = document.createElement('span')
      badge.className = 'v-badge'
      badge.innerHTML = icon('play')
      mini.appendChild(badge)
    }
    if (fokusInfo?.art === 'medium' && fokusInfo.id === d.id) mini.classList.add('fokus')
    fotoBahn.appendChild(mini)
  }

  renderTrimGriffe(skala)
  renderPlayhead()

  // — Geschätzte Laufzeit der fertigen Animation (eine Zahl, keine zweite Achse) —
  const abschnitte = zerlegeFuerAnzeige(z.daten.segmente as EditorSegment[], z.edits, start)
  const halte = medien.filter((m) => m.type === 'photo' && !m.geloescht && m.anchor).map((m) => haltedauerS(m.display))
  $('zl-dauer').textContent = `~ ${formatiereDauer(schaetzeAnimationsdauer(abschnitte, halte))} Laufzeit`
}

// — Zoom, Abspielkopf und Läufer —
//
// Die Zeitachse ist so breit wie `--zeit-breite` (Pixel, nicht Prozent): nur so
// kann sie über das Fenster hinauswachsen und waagerecht scrollen. Bei Zoom 1
// füllt sie das Fenster genau — das ist der Standard „an Fenster angepasst".

const ZOOM_MAX = 40

/** Breite der Zeitachse bei Zoom 1: Fensterbreite minus Namenspalte und Auslauf. */
function basisBreitePx(): number {
  const fenster = document.getElementById('spuren-fenster')
  if (!fenster) return 0
  return Math.max(120, fenster.clientWidth - spurXpx() - 26)
}

function spurXpx(): number {
  const wert = getComputedStyle($('editor-view')).getPropertyValue('--spur-x')
  return parseFloat(wert) || 168
}

function zeitBreitePx(): number {
  return basisBreitePx() * zoom
}

/**
 * Zoom setzen und die Ansicht so scrollen, dass `ankerAnteil` an der Fenster-x
 * `zielVx` stehen bleibt — sonst springt der Blick beim Zoomen irgendwohin.
 */
function wendeZoomAn(neu: number, ankerAnteil: number, zielVx: number): void {
  zoom = Math.max(1, Math.min(ZOOM_MAX, neu))
  const breite = zeitBreitePx()
  $('editor-view').style.setProperty('--zeit-breite', `${breite}px`)
  renderSkala()
  renderPlayhead()
  const fenster = document.getElementById('spuren-fenster')
  if (fenster) fenster.scrollLeft = ankerScroll(ankerAnteil, breite, zielVx, spurXpx())
  zoomAnzeigen()
}

function zoomAnzeigen(): void {
  const regler = document.getElementById('zoom-regler') as HTMLInputElement | null
  if (regler) regler.value = String(Math.round((Math.log(zoom) / Math.log(ZOOM_MAX)) * 100))
  const wert = document.getElementById('zoom-wert') as HTMLButtonElement | null
  if (wert) {
    wert.textContent = `${zoom.toFixed(1).replace('.', ',')}×`
    wert.disabled = zoom <= 1.001
  }
  const raus = document.getElementById('zoom-raus') as HTMLButtonElement | null
  if (raus) raus.disabled = zoom <= 1.001
  const rein = document.getElementById('zoom-rein') as HTMLButtonElement | null
  if (rein) rein.disabled = zoom >= ZOOM_MAX - 0.001
}

/** Nach Größenänderungen die Achse an die neue Fensterbreite anpassen. */
function passeZeitBreiteAn(): void {
  if (!z) return
  const fenster = document.getElementById('spuren-fenster')
  const anker = fenster && fenster.clientWidth > 0 ? (fenster.scrollLeft + spurXpx()) / Math.max(1, zeitBreitePx()) : 0
  wendeZoomAn(zoom, Math.max(0, Math.min(1, anker)), spurXpx())
}

/**
 * Der Abspielkopf ist die Einfügemarke `z.auswahl` — eine Größe, nicht zwei:
 * was man anpeilt, ist auch die Stelle, ab der „ab hier"-Aktionen greifen.
 */
function setzeMarke(tOffsetS: number): void {
  if (!z) return
  const skala = baueSkala(z.track)
  if (!skala) return
  const geklemmt = Math.max(skala.vonS, Math.min(skala.bisS, tOffsetS))
  const punkt = punktZuOffset(z.track, geklemmt)
  if (punkt) z.auswahl = punkt
  renderPlayhead()
  renderAuswahl()
}

/** Kopfstrich, Kopf-Uhr und Läufer auf die aktuelle Marke stellen. */
function renderPlayhead(): void {
  if (!z) return
  const strich = document.getElementById('kopfstrich')
  const skala = baueSkala(z.track)
  if (!strich || !skala) return
  if (!z.auswahl) {
    strich.hidden = true
    return
  }
  strich.hidden = false
  const tOffsetS = z.auswahl[3]
  strich.style.left = zeitX(offsetZuAnteil(skala, tOffsetS))

  const uhr = document.getElementById('kopf-uhr')
  // Ohne Sekunden: die Anzeige läuft beim Scrubben mit, da zappelt eine
  // Sekundenstelle nur — und die Achse ist ohnehin minutengenau beschriftet.
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
    laeufer = new maplibregl.Marker({ element: el }).setLngLat([punkt[0], punkt[1]]).addTo(karte)
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

/** Maßband: Stufe folgt dem Zoom, damit die Achse immer lesbar bleibt. */
function renderSkala(): void {
  if (!z) return
  const feld = document.getElementById('skala-feld')
  const skala = baueSkala(z.track)
  if (!feld || !skala) return
  feld.innerHTML = ''
  const breitePx = zeitBreitePx()
  const spanneMin = (skala.bisS - skala.vonS) / 60
  if (breitePx <= 0 || spanneMin <= 0) return
  for (const m of baueMassband(z.daten.time.start, skala, z.daten.time.zone, breitePx / spanneMin)) {
    const d = document.createElement('div')
    d.className = 'skala-marke' + (m.voll ? ' voll' : '') + (m.rand ? ` am-${m.rand}` : '')
    d.style.left = pos(m.anteil)
    d.append(m.text, document.createElement('i'))
    feld.appendChild(d)
  }
}

/** Trim: abgedunkelte Ränder + die beiden Griffe, über allen Bahnen. */
function renderTrimGriffe(skala: ZeitSkala): void {
  if (!z) return
  const wirt = $('zl-trim')
  wirt.innerHTML = ''
  const trim = baueTrimGriffe(z.edits, z.daten.time.start, skala)
  for (const [seite, von, bis] of [
    ['links', 0, trim.start],
    ['rechts', trim.ende, 1],
  ] as const) {
    if (bis - von <= 0.0005) continue
    const schatten = document.createElement('div')
    schatten.className = `zl-schatten ${seite}`
    schatten.style.left = zeitX(von)
    schatten.style.width = `calc(${(bis - von).toFixed(5)} * var(--zeit-breite))`
    wirt.appendChild(schatten)
  }
  for (const [rolle, anteil, titel] of [
    ['trim-start', trim.start, 'Start der Wiedergabe (ganz nach links = kein Trim)'],
    ['trim-ende', trim.ende, 'Ende der Wiedergabe (ganz nach rechts = kein Trim)'],
  ] as const) {
    const griff = document.createElement('div')
    griff.className = 'zl-griff'
    griff.style.left = zeitX(anteil)
    griff.dataset['rolle'] = rolle
    griff.title = titel
    wirt.appendChild(griff)
  }
}

/** Während eines Zugs nur die betroffenen Teile neu zeichnen (Karte + Leiste). */
function renderNachZug(): void {
  zeichneTrack()
  renderZeitleiste()
  renderTrim()
  renderInspektor()
}

function zeitleisteZug(e: PointerEvent): void {
  if (!z || !zug) return
  const skala = baueSkala(z.track)
  if (!skala) return
  const start = z.daten.time.start
  const anteil = spurAnteil(e.clientX)
  const iso = (a: number): string => offsetZuIso(start, anteilZuOffset(skala, a))
  zug.bewegt = true

  switch (zug.rolle) {
    case 'trim-start': {
      const ende = baueTrimGriffe(z.edits, start, skala).ende
      const a = Math.min(anteil, ende - 0.005)
      z.edits = mitTrim(z.edits, 'start', a <= 0.002 ? null : iso(a))
      break
    }
    case 'trim-ende': {
      const startA = baueTrimGriffe(z.edits, start, skala).start
      const a = Math.max(anteil, startA + 0.005)
      z.edits = mitTrim(z.edits, 'ende', a >= 0.998 ? null : iso(a))
      break
    }
    case 'grenze': {
      if (zug.ab === undefined || !zug.mode) break
      const neuAb = iso(anteil)
      // Kollisions-Schutz: exakt auf einer ANDEREN Grenze würde die
      // Ersetzen-Semantik von mitModusGrenze diese verschlucken → Zug auslassen
      if (neuAb !== zug.ab && z.edits.modi?.some((g) => g.ab === neuAb)) break
      z.edits = mitModusGrenze(ohneModusGrenze(z.edits, zug.ab), neuAb, zug.mode)
      zug.ab = neuAb
      break
    }
    case 'kamera': {
      if (zug.ab === undefined || !zug.preset) break
      const altAb = zug.ab
      const neuAb = iso(anteil)
      if (neuAb !== altAb && z.edits.kamera?.some((g) => g.ab === neuAb)) break
      const altSkala = z.edits.kamera?.find((g) => g.ab === altAb)?.skala
      z.edits = mitKameraGrenze(ohneKameraGrenze(z.edits, altAb), neuAb, zug.preset, altSkala)
      zug.ab = neuAb
      break
    }
    case 'wetter': {
      if (zug.ab === undefined || !zug.wetterMode) break
      const altAb = zug.ab
      const neuAb = iso(anteil)
      if (neuAb !== altAb && z.edits.wetter?.some((g) => g.ab === neuAb)) break
      const altStaerke = z.edits.wetter?.find((g) => g.ab === altAb)?.staerke
      z.edits = mitWetterGrenze(ohneWetterGrenze(z.edits, altAb), neuAb, zug.wetterMode, altStaerke)
      zug.ab = neuAb
      break
    }
    case 'moment': {
      if (zug.ab === undefined || !zug.momentArt) break
      const altAb = zug.ab
      const neuAb = iso(anteil)
      if (neuAb !== altAb && z.edits.momente?.some((m) => m.ab === neuAb)) break
      const alt = z.edits.momente?.find((m) => m.ab === altAb)
      z.edits = mitMoment(ohneMoment(z.edits, altAb), neuAb, zug.momentArt, alt?.dauerS)
      zug.ab = neuAb
      if (z.fokus?.art === 'moment') z.fokus = { art: 'moment', ab: neuAb } // Fokus mitziehen
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
      if (laenge !== null) patch.bis = iso(neuVon + laenge)
      z.edits = mitAudioPatch(z.edits, zug.index, patch)
      break
    }
    case 'audio-von': {
      if (zug.index === undefined) break
      const a = (z.edits.audio ?? [])[zug.index]
      if (!a) break
      const bisA = a.bis !== undefined ? offsetZuAnteil(skala, isoZuOffset(start, a.bis)) : 1
      z.edits = mitAudioPatch(z.edits, zug.index, { ab: iso(Math.min(anteil, bisA - 0.005)) })
      break
    }
    case 'audio-bis': {
      if (zug.index === undefined) break
      const a = (z.edits.audio ?? [])[zug.index]
      if (!a) break
      const vonA = offsetZuAnteil(skala, isoZuOffset(start, a.ab))
      const b = Math.max(anteil, vonA + 0.005)
      z.edits = mitAudioPatch(z.edits, zug.index, { bis: b >= 0.998 ? undefined : iso(b) })
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

  // — Ziehen an Kanten, Griffen, Pins und Klips —
  zone.addEventListener('pointerdown', (e) => {
    if (!z || werkzeug !== 'auswahl') return
    const ziel = (e.target as HTMLElement).closest<HTMLElement>('[data-rolle]')
    if (!ziel) return
    const rolle = ziel.dataset['rolle']!
    if (rolle === 'dot') return // Klick, kein Zug
    e.preventDefault()
    zone.setPointerCapture(e.pointerId)
    zone.classList.add('zieht')
    zug = { rolle, bewegt: false, fokus: bandZuFokus((e.target as HTMLElement).closest<HTMLElement>('[data-fokus]')) }
    if (ziel.dataset['ab'] !== undefined) zug.ab = ziel.dataset['ab']
    if (ziel.dataset['mode']) zug.mode = ziel.dataset['mode'] as Modus
    if (ziel.dataset['preset']) zug.preset = ziel.dataset['preset'] as KameraPreset
    if (ziel.dataset['wettermode']) zug.wetterMode = ziel.dataset['wettermode'] as WetterModus
    if (ziel.dataset['art']) zug.momentArt = ziel.dataset['art'] as MomentArt
    if (ziel.dataset['index'] !== undefined) zug.index = Number(ziel.dataset['index'])
    if (rolle === 'audio-balken') {
      // Versatz zwischen Cursor und Klipanfang merken → ruckfreies Schieben
      const skala = baueSkala(z.track)
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
      zone.classList.remove('zieht')
      if (zone.hasPointerCapture(e.pointerId)) zone.releasePointerCapture(e.pointerId)
      if (war.bewegt) {
        unterdrueckeKlick = true
        renderAlles()
        return
      }
      // Kein Zug = Klick: Abspielkopf setzen UND das getroffene Band
      // fokussieren — ein Klick, beide sinnvollen Wirkungen. Traf er nichts,
      // wird die Auswahl aufgehoben (wie im Schnittprogramm).
      if (war.rolle === 'spur' || war.rolle === 'skala' || war.rolle === 'trim-start' || war.rolle === 'trim-ende') {
        const skala = baueSkala(zz.track)
        if (skala) {
          zz.auswahl = punktZuOffset(zz.track, anteilZuOffset(skala, spurAnteil(e.clientX)))
          zz.fokus = war.fokus ?? null
          renderAlles()
        }
      } else if (war.rolle === 'moment' && war.ab !== undefined) {
        zz.fokus = { art: 'moment', ab: war.ab }
        renderAlles()
      } else if ((war.rolle === 'audio-balken' || war.rolle === 'sfx') && war.index !== undefined) {
        zz.fokus = { art: 'audio', index: war.index }
        renderAlles()
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
        renderAlles() // baut die Medienliste neu — erst danach blitzen lassen
        blitzeZeile(medium.id)
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
    document.body.classList.add('scrubbt')
    const skala = baueSkala(z.track)
    const zieh = (ev: PointerEvent): void => {
      if (!skala) return
      setzeMarke(anteilZuOffset(skala, spurAnteil(ev.clientX)))
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
    const skala = baueSkala(z.track)
    if (!skala) return
    setzeMarke(anteilZuOffset(skala, spurAnteil(e.clientX)))
    document.body.classList.add('scrubbt')
    const zieh = (ev: PointerEvent): void => setzeMarke(anteilZuOffset(skala, spurAnteil(ev.clientX)))
    const los = (): void => {
      window.removeEventListener('pointermove', zieh)
      window.removeEventListener('pointerup', los)
      document.body.classList.remove('scrubbt')
      renderAlles()
    }
    window.addEventListener('pointermove', zieh)
    window.addEventListener('pointerup', los)
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
        wendeZoomAn(1 / Math.max(b - a, 0.02), (a + b) / 2, fenster.clientWidth / 2)
      } else {
        wendeZoomAn(zoom * (ev.altKey ? 1 / 1.6 : 1.6), anteilBei(ev.clientX), ev.clientX - fr.left)
      }
    }
    window.addEventListener('pointermove', zieh)
    window.addEventListener('pointerup', los)
  })

  // — Zoom-Bedienung im Kopf —
  const zoomAnker = (): { anteil: number; vx: number } => {
    const skala = z ? baueSkala(z.track) : null
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
    wendeZoomAn(zoom * 1.6, a.anteil, a.vx)
  })
  $('zoom-raus').addEventListener('click', () => {
    const a = zoomAnker()
    wendeZoomAn(zoom / 1.6, a.anteil, a.vx)
  })
  $('zoom-wert').addEventListener('click', () => wendeZoomAn(1, 0, spurXpx()))
  $('zoom-regler').addEventListener('input', (e) => {
    const v = Number((e.target as HTMLInputElement).value) / 100
    const a = zoomAnker()
    wendeZoomAn(Math.pow(ZOOM_MAX, v), a.anteil, a.vx)
  })
  // Pinch/⌘-Rad zoomt um den Cursor (wie im Schnittprogramm)
  fenster.addEventListener(
    'wheel',
    (e) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const fr = fenster.getBoundingClientRect()
      const anteil = (fenster.scrollLeft + (e.clientX - fr.left) - spurXpx()) / Math.max(1, zeitBreitePx())
      wendeZoomAn(zoom * Math.exp(-e.deltaY / 220), Math.max(0, Math.min(1, anteil)), e.clientX - fr.left)
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

function status(text: string, klasse = ''): void {
  const el = $('editor-status')
  el.className = `hinweis ${klasse}`
  el.textContent = text
}

// — Speichern / Neu verarbeiten —

async function warteAufBereit(id: string): Promise<void> {
  for (let i = 0; i < 90; i++) {
    const t = await api.tour(id)
    if (t.schema === 'luhambo/tour@1' || t.status === 'bereit') return
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
    // 2. Titel/Beschreibung (falls geändert) — eigener Endpunkt, eigener Re-Render;
    //    bewusst NACH dem Overlay, damit sich die Renderer nie überlappen
    const titel = ($('editor-titel') as HTMLInputElement).value.trim()
    const beschreibung = ($('editor-beschreibung') as HTMLTextAreaElement).value.trim()
    const felder: { title?: string; description?: string } = {}
    if (titel && titel !== (z.daten.title ?? '')) felder.title = titel
    if (beschreibung !== (z.daten.description ?? '')) felder.description = beschreibung
    if (Object.keys(felder).length) {
      status('Titel/Beschreibung werden gespeichert …')
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

async function neuVerarbeiten(): Promise<void> {
  if (!z) return
  const knopf = $('editor-reprocess') as HTMLButtonElement
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

// — Einmalige Verdrahtung der statischen Editor-Elemente —

function verdrahteEinmal(): void {
  if (verdrahtet) return
  verdrahtet = true
  $('editor-zurueck').addEventListener('click', schliesse)
  $('editor-speichern').addEventListener('click', () => void speichern())
  $('editor-reprocess').addEventListener('click', () => void neuVerarbeiten())
  $('editor-undo').addEventListener('click', rueckgaengig)
  $('editor-redo').addEventListener('click', wiederherstellen)
  // Eine neue Zeigergeste hebt die Klick-Sperre auf (Capture-Phase, vor allen
  // anderen Handlern) — s. Kommentar bei `unterdrueckeKlick`.
  document.addEventListener('pointerdown', () => { unterdrueckeKlick = false }, true)
  window.addEventListener('resize', () => {
    if (!$('editor-view').hidden) passeZeitBreiteAn()
  })
  document.addEventListener('keydown', (e) => {
    if (!z || $('editor-view').hidden) return
    // In Eingabefeldern gilt das native Undo/Speichern des Browsers
    if ((e.target as HTMLElement).closest('input, textarea, select')) return
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
      wendeZoomAn(1, 0, spurXpx()) // ⇧Z = an Fenster anpassen (wie in Final Cut)
    } else if (e.key === 'Escape' && z.platzieren) {
      z.platzieren = null
      renderAlles()
    } else if (!meta && !e.altKey && !e.shiftKey) {
      const k = e.key.toLowerCase()
      if (k === 'a' || k === 'h' || k === 'z') {
        e.preventDefault()
        setzeWerkzeug(k === 'a' ? 'auswahl' : k === 'h' ? 'hand' : 'zoom')
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        // Feines Scrubben mit den Pfeiltasten: eine Minute je Tastendruck
        e.preventDefault()
        if (z.auswahl) setzeMarke(z.auswahl[3] + (e.key === 'ArrowRight' ? 60 : -60))
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
  $('e-trim-start').addEventListener('click', () => trimSetzen('start'))
  $('e-trim-ende').addEventListener('click', () => trimSetzen('ende'))
  $('e-grenze').addEventListener('click', () => {
    if (!z || !z.auswahl) return
    const mode = ($('e-grenze-mode') as HTMLSelectElement).value as Modus
    z.edits = mitModusGrenze(z.edits, offsetZuIso(z.daten.time.start, z.auswahl[3]), mode)
    renderAlles()
  })
  $('e-kamera').addEventListener('click', () => {
    if (!z || !z.auswahl) return
    const preset = ($('e-kamera-preset') as HTMLSelectElement).value as KameraPreset
    z.edits = mitKameraGrenze(z.edits, offsetZuIso(z.daten.time.start, z.auswahl[3]), preset)
    renderAlles()
  })
  $('e-moment').addEventListener('click', () => {
    if (!z || !z.auswahl) return
    const art = ($('e-moment-art') as HTMLSelectElement).value as MomentArt
    const ab = offsetZuIso(z.daten.time.start, z.auswahl[3])
    z.edits = mitMoment(z.edits, ab, art)
    z.fokus = { art: 'moment', ab } // gleich fokussieren → Inspector zeigt ihn
    renderAlles()
  })
  $('e-wetter').addEventListener('click', () => {
    if (!z || !z.auswahl) return
    const mode = ($('e-wetter-mode') as HTMLSelectElement).value as WetterModus
    z.edits = mitWetterGrenze(z.edits, offsetZuIso(z.daten.time.start, z.auswahl[3]), mode)
    z.fokus = { art: 'wetter', bezugS: z.auswahl[3] } // gleich fokussieren → Inspector zeigt ihn
    renderAlles()
  })
  $('e-audio-hinzu').addEventListener('click', () => $('e-audio-datei').click())
  $('e-audio-bibliothek').addEventListener('click', oeffneSfxDialog)
  $('sfx-schliessen').addEventListener('click', schliesseSfxDialog)
  $('sfx-dialog').addEventListener('close', stoppeDialogVorschau)
  // Klick aufs Backdrop (Ziel ist dann das dialog-Element selbst) schließt
  $('sfx-dialog').addEventListener('click', (e) => {
    if (e.target === $('sfx-dialog')) schliesseSfxDialog()
  })
  $('e-audio-datei').addEventListener('change', () => {
    const eingabe = $('e-audio-datei') as HTMLInputElement
    const datei = eingabe.files?.[0]
    if (datei) void audioHochladen(datei)
    eingabe.value = ''
  })
  verdrahteZeitleiste()
}

function trimSetzen(teil: 'start' | 'ende'): void {
  if (!z || !z.auswahl) return
  z.edits = mitTrim(z.edits, teil, offsetZuIso(z.daten.time.start, z.auswahl[3]))
  renderAlles()
}

// Debug-Handle (Konvention wie window.__j im Player) — auch fürs Browser-E2E:
// Karte und Zustand inspizieren, Track-Koordinaten in Pixel projizieren.
;(window as unknown as Record<string, unknown>)['__studio'] = {
  karte: () => karte,
  zustand: () => z,
  /** Abspielkopf: Zeit-Offset (s) — setzen scrubbt wie ein Zug am Kopf. */
  marke: (tOffsetS?: number) => {
    if (tOffsetS !== undefined) setzeMarke(tOffsetS)
    return z?.auswahl?.[3] ?? null
  },
  laeufer: () => laeufer?.getLngLat() ?? null,
  zoom: (neu?: number) => {
    if (neu !== undefined) wendeZoomAn(neu, 0, spurXpx())
    return zoom
  },
  werkzeug: (w?: 'auswahl' | 'hand' | 'zoom') => {
    if (w) setzeWerkzeug(w)
    return werkzeug
  },
}
