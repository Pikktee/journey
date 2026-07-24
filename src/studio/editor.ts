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
  loeseFokusAuf as loeseFokusAufRein,
  meterZuOffset,
  offsetZuAnteil,
  schaetzeAnimationsdauer,
  uhrDiffZuOffset,
  type Fokus,
  type FokusZiel,
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
    // Die Quellenangabe steht als eigenes (i) unten rechts — die Pflichtnennung
    // bleibt, braucht aber keine Dauerzeile über der Karte.
    attributionControl: false,
  })
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
  for (const m of marker) m.remove()
  marker = []
  medienMarker = new Map()

  // Ein Medium zeigt sich als das, was es IST: das Bild selbst, rund
  // beschnitten. Auf einem Satellitenbild ist ein Punkt nur ein weiterer heller
  // Fleck; die Miniatur sagt sofort, was dort wartet. Ziehen verankert es neu.
  for (const m of medienAnzeige()) {
    if (!m.anchor || m.geloescht) continue
    const el = document.createElement('div')
    el.className = 'medien-punkt'
    if (z.fokus?.art === 'medium' && z.fokus.id === m.id) el.classList.add('an')
    const halo = document.createElement('span')
    halo.className = 'halo'
    const kern = document.createElement('span')
    kern.className = 'kern'
    const thumb = m.type === 'photo' ? m.src : m.poster
    if (thumb) {
      const bild = document.createElement('img')
      bild.src = thumb
      bild.alt = ''
      kern.appendChild(bild)
    } else {
      kern.innerHTML = icon('film')
    }
    el.append(halo, kern)
    el.title = `${m.caption || m.id} · ${PLACEMENT_NAMEN[m.placement] ?? m.placement} — ziehen verankert neu`
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
    el.addEventListener('click', (ev) => {
      ev.stopPropagation()
      if (gezogen) {
        gezogen = false
        return
      }
      if (!z) return
      z.fokus = { art: 'medium', id: m.id }
      renderAlles()
    })
    medienMarker.set(m.id, el)
    marker.push(mk)
  }

  // Grenz- und Trim-Pins gibt es nicht mehr: WO ein Zustand gilt, beantworten
  // die Bänder der Zeitleiste und der leuchtende Fokus-Abschnitt auf der Karte.
  // Wo der Abspielkopf steht, zeigt der Läufer (setzeLaeufer).
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

/** Anzeigename des fokussierten Objekts — Darstellung, deshalb hier und nicht im Modell. */
function fokusTitel(ziel: FokusZiel): string {
  if (ziel.art === 'modus') return ziel.mode ? MODUS_NAMEN[ziel.mode] : 'Fortbewegung'
  if (ziel.art === 'kamera') return ziel.preset ? `Kamera ${PRESET_NAMEN[ziel.preset]}` : 'Preset des Zuschauers'
  if (ziel.art === 'wetter') return ziel.wetterMode ? `Wetter ${WETTER_NAMEN[ziel.wetterMode]}` : 'Automatisches Wetter'
  if (ziel.art === 'moment') return ziel.momentArt ? MOMENT_NAMEN[ziel.momentArt] : 'Moment'
  if (ziel.art === 'audio') {
    const a = ziel.index !== undefined ? (z?.edits.audio ?? [])[ziel.index] : undefined
    return a ? audioName(a) : 'Klang'
  }
  return medienAnzeige().find((m) => m.id === ziel.id)?.caption || (ziel.id ?? '')
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
    z.edits,
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

// — Ereignis anlegen: Spur-Menüs an der Einfügemarke —
//
// Jede Bahn trägt ein „+". Was dort entsteht, beginnt IMMER an der Marke — das
// ist dieselbe Stelle, die der Abspielkopf zeigt. Früher lag dafür eine
// Knopfleiste in der Sidebar, weit weg von der Bahn, die sie betraf.

let offenesMenue: HTMLElement | null = null

function schliesseSpurMenue(): void {
  offenesMenue?.remove()
  offenesMenue = null
  document.querySelectorAll<HTMLElement>('.spur-plus[aria-expanded="true"]').forEach((b) => {
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
    menue.appendChild(menueEintrag('Datei hochladen …', () => $('e-audio-datei').click()))
    menue.appendChild(menueEintrag('Aus der Klang-Bibliothek …', oeffneSfxDialog))
    // Schon hochgeladene, aber nicht eingesetzte Dateien direkt anbieten
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

function renderAblage(): void {
  const knopf = $('ablage-knopf')
  const medien = ablageMedien()
  knopf.hidden = medien.length === 0
  $('ablage-anzahl').textContent = medien.length === 1 ? '1 Aufnahme wartet' : `${medien.length} Aufnahmen warten`
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
    bild.src = m.type === 'video' ? (m.poster ?? m.src) : m.src
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
      bild.src = m.type === 'video' ? (m.poster ?? m.src) : m.src
      bild.alt = ''
      geist.appendChild(bild)
      document.body.appendChild(geist)
    }
    geist.style.left = `${ev.clientX}px`
    geist.style.top = `${ev.clientY}px`
    const bahn = document.getElementById('spur-fotos')?.getBoundingClientRect()
    const skala = z ? baueSkala(z.track) : null
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
    const punkt = punktZuOffset(z.track, abgelegtBei)
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

/** Beschriftetes Feld mit einem Bedienelement darin. */
function feld(label: string, inhalt: HTMLElement): HTMLElement {
  const d = document.createElement('div')
  d.className = 'feld'
  const l = document.createElement('label')
  l.textContent = label
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
  r.addEventListener('input', () => { w.textContent = anzeige(Number(r.value)) })
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
  for (const [zeichen, richtung] of [['▲', 60], ['▼', -60]] as const) {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = zeichen
    b.tabIndex = -1
    b.addEventListener('click', () => { anwenden(aktuellS + richtung); beiZugEnde?.() })
    stepper.appendChild(b)
  }

  // Scrubben über dem Feld: Fenster-Listener (Capture auf dem schmalen Feld
  // verlöre schnelle Bewegungen), 5 px ≈ 1 Minute.
  zf.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('.zf-step')) return
    const startX = e.clientX
    const startS = aktuellS
    let scrubt = false
    const zieh = (ev: PointerEvent): void => {
      if (!scrubt && Math.abs(ev.clientX - startX) < 3) return
      scrubt = true
      zf.classList.add('scrub')
      ev.preventDefault()
      anwenden(startS + Math.round((ev.clientX - startX) / 5) * 60)
    }
    const los = (): void => {
      window.removeEventListener('pointermove', zieh)
      window.removeEventListener('pointerup', los)
      zf.classList.remove('scrub')
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
 * sind dieselbe Kante wie der Anfang des Nachbarn.
 */
function renderInspektor(): void {
  if (!z) return
  const inhalt = $('insp-inhalt')
  const fuss = $('insp-fuss')
  const leer = $('insp-leer')
  inhalt.innerHTML = ''
  fuss.innerHTML = ''
  const info = loeseFokusAuf()
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

  // — Kopf: Art (Kicker) und Name —
  const kicker = document.createElement('div')
  kicker.className = 'insp-art'
  if (info.mode) {
    const farbe = document.createElement('span')
    farbe.className = 'farbe'
    farbe.style.background = MODUS_FARBEN[info.mode]
    kicker.appendChild(farbe)
  }
  kicker.append(ART_NAMEN[info.art])
  const titel = document.createElement('h2')
  titel.className = 'insp-titel'
  titel.textContent = fokusTitel(info)
  inhalt.append(kicker, titel)

  // — Werte je Art —
  if (info.art === 'modus' || info.art === 'kamera') {
    const istModus = info.art === 'modus'
    const werte = istModus ? Object.entries(MODUS_NAMEN) : Object.entries(PRESET_NAMEN)
    const aktuell = istModus ? (info.mode as string | undefined) : (info.preset as string | undefined)
    const wahl = auswahl(werte, aktuell, aktuell === undefined ? 'Preset des Zuschauers' : undefined)
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
    inhalt.appendChild(feld(istModus ? 'Fortbewegung' : 'Kamera-Abstand', wahl))

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
      // Der erste gesetzte Modus schaltet das Overlay scharf und ersetzt damit
      // das Auto-Wetter der ganzen Tour. Stärke bei „Klar" verwerfen.
      const ab = info.ab ?? offsetZuIso(start, info.vonS)
      const neu = wahl.value as WetterModus
      z.edits = mitWetterGrenze(z.edits, ab, neu, neu === 'off' ? undefined : info.staerke)
      z.fokus = { art: 'wetter', bezugS }
      renderAlles()
    })
    inhalt.appendChild(feld('Wetter', wahl))
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
  audio: 'Musik & Sound',
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
          ? zeitFest('Klang, keine Dauer')
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

/** Felder eines Audio-Eintrags — früher nur über das Sidebar-Panel erreichbar. */
function baueAudioFelder(index: number, a: AudioEintrag): HTMLElement {
  const huelle = document.createElement('div')
  huelle.style.display = 'contents'

  const typ = auswahl([['musik', 'Musik (über eine Strecke)'], ['sfx', 'Klang (ein Zeitpunkt)']], a.typ)
  typ.addEventListener('change', () => {
    if (!z) return
    const neu = typ.value as 'musik' | 'sfx'
    // Wechsel zu „Klang" wirft das Ende weg — ein Zeitpunkt hat keine Dauer
    z.edits = mitAudioPatch(z.edits, index, neu === 'sfx' ? { typ: neu, bis: undefined } : { typ: neu })
    renderAlles()
  })
  huelle.appendChild(feld('Art', typ))

  huelle.appendChild(
    feld(
      'Lautstärke',
      regler({ min: 0, max: 100, step: 5, wert: Math.round((a.lautstaerke ?? 0.8) * 100) }, (v) => `${v} %`, (v) => {
        if (!z) return
        z.edits = mitAudioPatch(z.edits, index, { lautstaerke: v / 100 })
        renderAlles()
      }),
    ),
  )

  const knoepfe = document.createElement('div')
  knoepfe.className = 'insp-knoepfe'
  const hoeren = document.createElement('button')
  const laeuft = vorschau?.datei === a.datei
  hoeren.innerHTML = `${icon(laeuft ? 'stop' : 'play')}<span>${laeuft ? 'Stopp' : 'Vorhören'}</span>`
  hoeren.addEventListener('click', () => {
    if (laeuft) stoppeVorschau()
    else starteVorschau(a)
    renderInspektor()
  })
  knoepfe.appendChild(hoeren)
  huelle.appendChild(knoepfe)

  if (z && audioWirdVerworfen(a, z.edits, z.daten.time.start, baueSkala(z.track) ?? { vonS: 0, bisS: 0 })) {
    const warn = document.createElement('p')
    warn.className = 'insp-warnung'
    warn.textContent = 'Liegt außerhalb der getrimmten Tour und wird beim Rendern verworfen.'
    huelle.appendChild(warn)
  }
  return huelle
}

/** Felder einer Aufnahme — früher nur über die Medien-Liste erreichbar. */
function baueMediumFelder(m: MediumAnzeige): HTMLElement {
  const huelle = document.createElement('div')
  huelle.style.display = 'contents'

  const bild = document.createElement('img')
  bild.className = 'insp-bild'
  bild.src = m.type === 'video' ? (m.poster ?? m.src) : m.src
  bild.alt = ''
  huelle.appendChild(bild)

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
  huelle.appendChild(feld('Titel — erscheint als Überschrift', titel))

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
  const platzieren = document.createElement('button')
  platzieren.textContent = z?.platzieren === m.id ? 'Platzieren abbrechen' : 'Auf der Karte platzieren'
  if (z?.platzieren === m.id) platzieren.classList.add('aktiv')
  platzieren.addEventListener('click', () => {
    if (!z) return
    z.platzieren = z.platzieren === m.id ? null : m.id
    renderAlles()
  })
  knoepfe.appendChild(platzieren)
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
  huelle.appendChild(knoepfe)

  const notiz = document.createElement('p')
  notiz.className = 'insp-notiz'
  notiz.textContent = `Aufgenommen ${zeitText(m.takenAt)} Uhr · verortet über ${PLACEMENT_NAMEN[m.placement] ?? m.placement}. Die Aufnahmezeit selbst lässt sich nicht ändern — verschiebe den Ort, um sie umzuhängen.`
  huelle.appendChild(notiz)
  return huelle
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
      grund:
        info.art === 'modus'
          ? 'Dieser Abschnitt stammt aus der Aufzeichnung — er lässt sich überschreiben, aber nicht entfernen.'
          : 'Der erste Zustand deckt die Tour von Anfang an — er lässt sich nur ändern.',
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
  if (info.art === 'modus' && info.ab) z.edits = ohneModusGrenze(z.edits, info.ab)
  else if (info.art === 'kamera' && info.ab) z.edits = ohneKameraGrenze(z.edits, info.ab)
  else if (info.art === 'wetter' && info.ab) z.edits = ohneWetterGrenze(z.edits, info.ab)
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

// — Musik & Sound (Audio-Assets + Overlay-Einträge) —

/** Einen Audio-Eintrag vorhören (bricht ein laufendes Vorhören ab). */
function starteVorschau(a: AudioEintrag): void {
  if (!z) return
  stoppeVorschau()
  const audio = new Audio(audioUrl(a, z.tourId))
  audio.volume = a.lautstaerke ?? 1
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
function verschiebeGrenze(art: 'modus' | 'kamera' | 'wetter' | 'moment', altAb: string, neuOffsetS: number): string | null {
  if (!z) return null
  const skala = baueSkala(z.track)
  if (!skala) return null
  const geklemmt = Math.max(skala.vonS, Math.min(skala.bisS, neuOffsetS))
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
  // Klick daneben oder Esc schließt — ein Menü darf nie hängen bleiben
  document.addEventListener('pointerdown', (e) => {
    if (offenesMenue && !offenesMenue.contains(e.target as Node)) schliesseSpurMenue()
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
  $('karte-plus').addEventListener('click', () => karte?.zoomIn())
  $('karte-minus').addEventListener('click', () => karte?.zoomOut())
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
    } else if ((e.key === 'Backspace' || e.key === 'Delete') && z.fokus) {
      // Löscht dasselbe wie der Knopf im Inspector-Fuß
      e.preventDefault()
      loescheFokus()
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
  // Trim setzt man an den Griffen der Zeitleiste; Ereignisse legt das „+"
  // der jeweiligen Bahn an. Die frühere Knopfleiste in der Sidebar ist weg.
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
