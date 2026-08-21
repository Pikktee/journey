// Kartenaufbau: Esri World Imagery (Satellit) über AWS Terrain Tiles (Terrarium-DEM),
// dazu Atmosphäre und die beiden Routen-Layer.
import maplibregl, {
  type ExpressionSpecification,
  type GeoJSONSource,
  type LngLatLike,
  type Map as MapLibreMap,
  type Marker,
} from 'maplibre-gl'
import { indexAt, type Route } from './geo.js'
import { registerDemClean } from './demclean.js'
import { createMapAttribution, type MapSource } from './map-attribution.js'
import type { Modus } from './tours.js'

/**
 * Quellen ohne Kachel im Stil: Routing ist ein abgeleitetes OSM-Werk, Open-Meteo
 * die Lizenzbedingung des Auto-Wetters. Dieselbe Liste hängt am ⓘ-Popup und
 * geht in den Video-Einbrand (Etappe 0).
 */
export const MAP_EXTRA_SOURCES: readonly MapSource[] = [
  {
    role: 'Routen',
    html: 'Routing © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende · ODbL',
  },
  { role: 'Wetter', html: '<a href="https://open-meteo.com/">Open-Meteo</a> · CC BY 4.0' },
]

/** Optionen nur für den Export-Lauf: fester Viewport, Canvas bleibt lesbar. */
export interface MapOptions {
  preserveDrawingBuffer?: boolean
  /** Fehlt: `targetPixelRatio()`. Export setzt 1, sonst zieht 1080p auf 2×. */
  pixelRatio?: number
}

export const EXAGGERATION = 1.35

/** Koordinate ohne Höhe, wie GeoJSON und die Marker sie wollen. */
export type LngLat2D = [number, number]

// DEM-Kacheln durch die Spike-Bereinigung leiten (siehe demclean.ts): kaputte
// Ausreißer-Pixel in den groben Overview-Kacheln werden vor dem Rendern gekappt.
registerDemClean(maplibregl)

// Touch-Geräte: auf MSAA verzichten (bei ≥2× nicht unterscheidbar) und die
// Render-Auflösung härter deckeln (s. targetPixelRatio).
const COARSE = window.matchMedia('(pointer: coarse)').matches

// ————————————————————————————————————————————————————————————————
// MOBILE BILDRATE — was GEMESSEN wurde (Pixel 9, Chrome, Querformat, Koh Pha-ngan
// zwischen km 5 und 9, echte Fahrt mit ~670 m in 5 s). Damit niemand dieselben
// Sackgassen erneut abläuft:
//
//   Ausgangslage ~22–26 fps in der Fahrt, ~60 fps am ruhenden Foto-Stopp.
//   `map.setTerrain(null)` → 48–60 fps. Das Terrain-Rendering IST die Kosten.
//
// Ohne belegbare Wirkung (alle im A/B-Wechsel gemessen, Differenz im Rauschen):
//   · setSourceTileLodParams(9.314, 1.5 bzw. 1.2) — Kachelbudget bei hohem Pitch
//   · setAnisotropicFilterPitch(90) statt Default 20
//   · raster-fade-duration 0 statt 500 auf dem Satelliten-Layer
//   · pixelRatio 1.0 statt 1.5; Overlay-Canvases in halber Auflösung
//   · DEM-maxzoom 11 statt 13 (war sogar LANGSAMER — Overzoom spart keine Meshes)
//   · maxPitch-Deckel 70/60 statt 86
//   · Reisetempo halbiert (120 → 60 m/s): nur +11 % bei doppelter Tourdauer
//
// Wirksam war einzig, die DEM-Abfragen der Horizont-Sonde zu senken
// (s. atmosphere.ts, inkrementeller Fächer).
//
// METHODIK-WARNUNG für künftige Messungen: Einzelmessungen täuschen hier massiv.
// Der erste Lauf nach dem Umschalten ist durch den kalten Kachel-Cache langsamer,
// und das Gerät drosselt über eine Messreihe hinweg thermisch (26 → 20 fps bei
// UNVERÄNDERTER Konfiguration). Nur A/B/A/B-Wechsel mit verworfenem Erstlauf je
// Zustand ist aussagekräftig — und die Messung muss zwischen zwei Foto-Stopps
// liegen, sonst misst man die ruhende Orbit-Kamera (immer ~60 fps).
// ————————————————————————————————————————————————————————————————

// Adaptive Render-Auflösung als PIXELBUDGET. Profiling (M4 an 4K) zeigt eine harte
// 60→30-fps-Klippe der Füllrate oberhalb von ~5 MP Zeichenfläche (bei schwächeren GPUs
// noch früher) — nicht Netzwerk, Geometrie oder unser Code, sondern schlicht die
// Pixelmenge (Zeichenfläche = CSS-Fläche × pixelRatio²). Statt einer festen pixelRatio
// deckeln wir die Zeichenfläche auf MAX_RENDER_MP: kleine Fenster bleiben pixelgleich
// (Budget greift nie, volle Schärfe), große/4K-Displays regeln nur so weit herunter,
// dass die Fahrt flüssig bleibt. Touch-Geräte zusätzlich hart auf 1,5 (weiche Verläufe/
// Karte am Handy-DPI kaum sichtbar). Eine Quelle der Wahrheit für Karte UND die beiden
// Overlay-Canvases (atmosphere/weather), die sonst dieselbe Klippe reißen würden.
export const MAX_RENDER_MP = 5
export function targetPixelRatio() {
  const dpr = window.devicePixelRatio || 1
  const hardCap = COARSE ? 1.5 : 2
  const area = window.innerWidth * window.innerHeight
  const budget = area > 0 ? Math.sqrt((MAX_RENDER_MP * 1e6) / area) : hardCap
  return Math.max(1, Math.min(dpr, hardCap, budget)) // nie unter 1 (sonst zu weich)
}

// Auflösung der OVERLAY-Canvases (Atmosphäre, Wetter) — bewusst getrennt vom
// Kartenbudget. Beide tragen nur weiche Verläufe, Wolken und Partikel; auf Touch
// deshalb fest auf 1,0 statt 1,5 (am Handy-DPI nicht auszumachen), was ihre
// Zeichenfläche und den Texturspeicher halbiert.
// EHRLICHE EINORDNUNG: Auf dem Pixel 9 gemessen bringt das für die BILDRATE
// nichts — dort limitiert nicht die Füllrate, sondern MapLibres Terrain-Pass
// (s. PROBE_MS in atmosphere.ts). Die Regel bleibt wegen Speicher/Bandbreite und
// weil schwächere Geräte als das Pixel 9 sehr wohl füllratenbegrenzt sein können.
export function overlayPixelRatio() {
  return COARSE ? 1 : targetPixelRatio()
}

/**
 * Auflösung der KARTEN-Leinwand (Foto-Karte, src/card-painter.ts) — die eine
 * Overlay-Schicht, die nicht nur Verläufe trägt, sondern TEXT.
 *
 * Bei Partikeln sieht man den `COARSE`-Rückfall auf 1,0 kaum, bei einer
 * Bildunterschrift sofort. Deshalb gilt hier das Kartenbudget und nicht das
 * Overlay-Budget — und das ist bezahlbar, weil die Schicht ausschließlich im
 * HALT liegt: Dort steht die Kamera still, MapLibre hat weder Kachelarbeit noch
 * Repaint, und der Maler bekommt die 72–90 % der Frame-Zeit geschenkt, die sonst
 * der Karte gehören (docs/concepts/konzept_kartenleinwand.md §5A).
 */
export function mapPixelRatio() {
  return targetPixelRatio()
}

export function createMap(
  container: HTMLElement | string,
  center: LngLatLike,
  optionen: MapOptions = {},
): MapLibreMap {
  const festesPixelRatio = optionen.pixelRatio != null
  const map = new maplibregl.Map({
    container,
    center,
    zoom: 11,
    pitch: 48,
    bearing: -35,
    // Kein globales minZoom: Intro/Finale-Orbit geht bewusst tiefer (tour.ts ovR/ovA).
    // Freies Rauszoomen in der Fahrt-Pause deckelt updateMapLock auf 9 — sonst
    // zeichnet MapLibre bei Tour-Pitch ein Terrain-Mesh, das die FPS killt.
    // 86 statt 72: die „Himmel-Momente" der Tour (tour.ts skyLift) kippen die Kamera
    // zur Golden Hour/Nacht über den Horizont hinaus, damit ein echter Himmelsanteil
    // MIT Sonne/Sternen ins Bild kommt — dafür braucht die FreeCamera-Ableitung
    // Pitch-Spielraum, sonst klemmt die Rahmung und der Horizont klebt am oberen Rand.
    maxPitch: 86,
    // KEIN Antialiasing, und das ist eine gemessene Entscheidung. Hier stand bis
    // 2026-08-11 `antialias: !COARSE` — wirkungslos, seit MapLibre 5 die
    // WebGL-Kontext-Attribute nach `canvasContextAttributes` verschoben hat (ein
    // unbekanntes Top-Level-Feld wird stumm ignoriert; gefunden hat es der
    // Typecheck beim TS-Umbau). Die naheliegende Reparatur wurde gegengeprüft und
    // VERWORFEN: Mit `canvasContextAttributes: { antialias: true }` (nachgewiesen
    // aktiv, SAMPLES = 4) blieb dasselbe Bild bei identischer Kamerapose — im
    // saubersten Vergleich 3 von 255 maximaler Abweichung. Der Grund ist die
    // Bildkomposition selbst: Satellitenraster auf Terrain-Mesh, zwei
    // 2D-Overlays, DOM-UI — Geometriekanten gibt es kaum, und die einzige
    // relevante (Silhouette gegen den Himmel) weicht drawHaze in atmosphere.ts
    // ohnehin auf. Messung, Grenzen und die verworfene Einstellungs-Idee:
    // docs/archive/antialias-verworfen.md.
    // Render-Auflösung als Pixelbudget deckeln (s. targetPixelRatio) — hält den M4 an
    // 4K und schwächere GPUs unter der 60→30-fps-Füllraten-Klippe, ohne kleine Fenster
    // anzutasten. pixelRatio skaliert MapLibres GESAMTE Pipeline (Raster-Decode, Terrain-
    // Mesh, readPixels-Tiefenpuffer, Fill), die im Profil ~72–90 % der Frame-Zeit trägt.
    pixelRatio: optionen.pixelRatio ?? targetPixelRatio(),
    // Nur im Export: sonst ist drawImage(mapCanvas) leer (Konzept Video-Export §6).
    ...(optionen.preserveDrawingBuffer
      ? { canvasContextAttributes: { preserveDrawingBuffer: true } }
      : {}),
    // Mehr Zoomstufen im Tile-Cache halten: bei schnellen Zooms (Preset-Wechsel,
    // Foto-Sprünge) sind Eltern-/Kind-Tiles dann oft noch da statt neu zu laden
    maxTileCacheZoomLevels: 7,
    // Eigenes Attributions-Control (map-attribution.ts): ⓘ-Knopf mit Popup statt
    // MapLibres grauem Kleingedruckt-Balken. Der Inhalt kommt aus den
    // `attribution`-Feldern der Quellen unten — die bleiben die Quelle der Wahrheit.
    attributionControl: false,
    style: {
      version: 8,
      // Schriftglyphen für Symbol-Layer (nummerierte Foto-Wegpunkte)
      glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
      sources: {
        satellite: {
          type: 'raster',
          tiles: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          ],
          tileSize: 256,
          maxzoom: 18,
          attribution: '© <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics',
        },
        dem: {
          type: 'raster-dem',
          // Über demclean:// geleitet — die groben Overview-Kacheln werden von
          // korrupten Ausreißer-Pixeln bereinigt (siehe demclean.ts).
          tiles: ['demclean://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png'],
          encoding: 'terrarium',
          tileSize: 256,
          // maxzoom bleibt 13: eine Senkung auf 11 wurde auf dem Pixel 9 gemessen
          // und war LANGSAMER (Overzoom spart keine Meshes, kostet aber Skalierung).
          maxzoom: 13,
          // Ohne „Terrain:"-Präfix — die Rolle steht im Popup schon in der Zeile
          attribution:
            'Mapzen / <a href="https://registry.opendata.aws/terrain-tiles/">AWS Open Data</a>',
        },
      },
      layers: [
        {
          id: 'satellite',
          type: 'raster',
          source: 'satellite',
          // längere Überblendung beim Tile-Wechsel: weniger sichtbares Aufpoppen
          paint: { 'raster-fade-duration': 500 },
        },
      ],
      terrain: { source: 'dem', exaggeration: EXAGGERATION },
      // Start-Himmel (bis die Tag/Nacht-Regie übernimmt) — reiner Blauverlauf
      // OHNE Dunst: fog = horizon (kein abgesetzter Schleier), Fog an den Horizont
      // gepinnt (fog-ground-blend 1) und keine Atmosphäre (atmosphere-blend 0).
      // Das Gelände trifft den Himmel sauber, kein grauer Schleierbalken mehr.
      sky: {
        'sky-color': '#77b0df',
        'horizon-color': '#aacdeb',
        'fog-color': '#aacdeb',
        'sky-horizon-blend': 0.9,
        'horizon-fog-blend': 0,
        'fog-ground-blend': 1,
        'atmosphere-blend': 0,
      },
    },
  })
  // Die Tour steuert die Center-Höhe selbst — nicht ans Terrain klemmen,
  // sonst springt die Kamera, solange DEM-Tiles noch laden.
  map.setCenterClampedToGround(false)
  // MapLibres eigene Tastensteuerung abschalten: Pfeiltasten steuern den Player
  // (Einzelbild vor/zurück), nicht das Verschieben/Zoomen der Karte.
  map.keyboard.disable()
  // Pflicht-Attribution (Esri/OSM/Mapzen/Open-Meteo) hinter dem ⓘ-Knopf unten
  // rechts — siehe map-attribution.ts. Open-Meteo (Auto-Wetter, autoweather.ts) hat
  // keine Kachelquelle im Stil und wird hier ergänzt; die Nennung ist
  // Lizenzbedingung (CC BY 4.0) und muss auch in spätere Video-Exporte.
  // OpenStreetMap steht hier als FESTER Eintrag und nicht mehr als Kachelquelle:
  // Die Routen der Touren sind mit OSRM/BRouter aus OSM-Daten geroutet, also ein
  // abgeleitetes Werk — die ODbL verlangt die Nennung unabhängig davon, ob gerade
  // OSM-Kacheln geladen werden. Seit die Gebäude-Ebene (OpenFreeMap) entfallen ist,
  // gäbe es sonst gar keine OSM-Nennung mehr.
  createMapAttribution(map, MAP_EXTRA_SOURCES)
  // Pixelbudget beim Fenster-Resize neu einregeln: Aufziehen von klein → 4K-Vollbild
  // würde sonst die Zeichenfläche über die Füllraten-Klippe treiben (pixelRatio bleibt
  // bei MapLibre über Resizes konstant). Gedrosselt + Schwellwert, damit das Ziehen am
  // Fensterrand keinen Dauer-Realloc des Framebuffers auslöst.
  // Export sperrt die Ratio auf 1: ein Resize darf 720p nicht auf 2× ziehen.
  if (!festesPixelRatio) {
    let prTimer: ReturnType<typeof setTimeout> | undefined
    window.addEventListener('resize', () => {
      clearTimeout(prTimer)
      prTimer = setTimeout(() => {
        const pr = targetPixelRatio()
        if (Math.abs(map.getPixelRatio() - pr) > 0.05) map.setPixelRatio(pr)
      }, 250)
    })
  }
  return map
}

// Die Fortschrittslinie ist zweigeteilt: der „festgeschriebene“ Teil wächst
// nur alle COMMIT_STRIDE Stützpunkte (~110 m), die kurze Spitze bis zum Fahrer
// wird pro Frame ersetzt. Vorher wurde die komplette (bis zu ~1800 Punkte
// lange) Linie 60× pro Sekunde neu tesselliert — für Glow und Linie doppelt.
const COMMIT_STRIDE = 8

/** Zeichnet die Route ein und liefert den Pro-Frame-Updater für die Spitze. */
export function addRouteLayers(map: MapLibreMap, route: Route): (s: number, pos: LngLat2D) => void {
  const coords2d: LngLat2D[] = route.coords.map((c) => [c[0], c[1]])
  const line = (coordinates: LngLat2D[]): GeoJSON.Feature => ({
    type: 'Feature',
    properties: null,
    geometry: { type: 'LineString', coordinates },
  })
  const start = coords2d[0]!

  map.addSource('route-full', { type: 'geojson', data: line(coords2d) })
  map.addSource('route-progress', {
    type: 'geojson',
    lineMetrics: true,
    data: line([start, start]),
  })
  map.addSource('route-tip', { type: 'geojson', data: line([start, start]) })

  // Gepunktete Vorschau der Gesamtstrecke
  map.addLayer({
    id: 'route-full',
    type: 'line',
    source: 'route-full',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': 'rgba(255,255,255,0.55)',
      'line-width': 2.4,
      'line-dasharray': [0.1, 2.2],
    },
  })
  // Weicher Schein unter der Fortschrittslinie
  const glowPaint = {
    'line-color': '#f5a524',
    'line-width': 11,
    'line-blur': 7,
    'line-opacity': 0.45,
  }
  map.addLayer({
    id: 'route-glow',
    type: 'line',
    source: 'route-progress',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: glowPaint,
  })
  map.addLayer({
    id: 'route-glow-tip',
    type: 'line',
    source: 'route-tip',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: glowPaint,
  })
  // Zurückgelegte Strecke, Bernstein → Koralle; die Spitze trägt konstant die
  // Gradienten-Endfarbe (der Übergang liegt immer weit hinter dem Fahrer)
  map.addLayer({
    id: 'route-progress',
    type: 'line',
    source: 'route-progress',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-width': 4.6,
      'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, '#f5a524', 1, '#ff6f52'],
    },
  })
  map.addLayer({
    id: 'route-tip',
    type: 'line',
    source: 'route-tip',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-width': 4.6, 'line-color': '#ff6f52' },
  })

  let committed = -1
  let letztesS = NaN
  let lastPos: LngLat2D | null = null
  return (s: number, pos: LngLat2D) => {
    // **Steht der Fahrer, wird die Spur nicht angefasst.** `setData` ist kein
    // stiller Schreibvorgang: Es stößt einen Style-Update an, der einen
    // `triggerRepaint` nach sich zieht — und MapLibre zeichnet daraufhin das
    // ganze Bild neu, Terrain-Pass inklusive. Weil diese Funktion in JEDEM
    // Frame läuft, hielt sie die Karte auch dort am Rendern, wo sich nichts
    // bewegt: im Foto- und Video-Halt (die Kamera steht dort komplett still,
    // s. tour.ts) und in der Pause. Gemessen waren das 380 der 434 Repaints in
    // vier Sekunden — auf dem Telefon genau die Leistung, die dem Video fehlt.
    if (s === letztesS && lastPos && pos[0] === lastPos[0] && pos[1] === lastPos[1]) return
    letztesS = s
    lastPos = [pos[0], pos[1]]
    const base = Math.max(1, indexAt(route, Math.min(s, route.total))) - 1 // letzter Stützpunkt vor s
    const commit = base - (base % COMMIT_STRIDE)
    if (commit !== committed) {
      committed = commit
      const cs = coords2d.slice(0, commit + 1)
      if (cs.length < 2) cs.push(cs[0] ?? start)
      map.getSource<GeoJSONSource>('route-progress')?.setData(line(cs))
    }
    const tip = coords2d.slice(commit, base + 1)
    tip.push([pos[0], pos[1]])
    map.getSource<GeoJSONSource>('route-tip')?.setData(line(tip))
  }
}

// Nummerierte Foto-Wegpunkte als GL-Layer (Circle + Symbol): im Gegensatz zu
// DOM-Markern laufen sie der Kamera nicht einen Frame hinterher und sitzen
// dadurch pixelfest auf der Karte. Klick springt zur Szene.
export interface MediaWaypoint {
  /** Streckenmeter des Halts */
  s: number
  lnglat: LngLat2D
}

/** Zeichnet Start- und Foto-Punkte ein und liefert den Fortschritts-Updater. */
export function addSpotLayers(
  map: MapLibreMap,
  spots: MediaWaypoint[],
  startLngLat: LngLat2D,
  onSelect: (s: number) => void,
): (s: number) => void {
  map.addSource('start-dot', {
    type: 'geojson',
    data: {
      type: 'Feature',
      properties: null,
      geometry: { type: 'Point', coordinates: startLngLat },
    },
  })
  map.addLayer({
    id: 'start-dot',
    type: 'circle',
    source: 'start-dot',
    paint: {
      'circle-radius': 6,
      'circle-color': '#ffffff',
      'circle-stroke-color': 'rgba(23, 17, 6, 0.55)',
      'circle-stroke-width': 3,
      'circle-pitch-alignment': 'viewport',
      'circle-pitch-scale': 'viewport',
    },
  })

  map.addSource('spots', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: spots.map((sp, i): GeoJSON.Feature => ({
        type: 'Feature',
        id: i,
        properties: { label: String(i + 1), s: sp.s },
        geometry: { type: 'Point', coordinates: sp.lnglat },
      })),
    },
  })
  // Style-Ausdrücke sind für MapLibre verschachtelte `unknown`-Arrays; `as const`
  // hielte sie readonly und damit unbrauchbar für die Paint-Properties.
  const done: ExpressionSpecification = ['boolean', ['feature-state', 'done'], false]
  const next: ExpressionSpecification = ['boolean', ['feature-state', 'next'], false]
  map.addLayer({
    id: 'spots-circle',
    type: 'circle',
    source: 'spots',
    // Einheitliche Sprache mit der Timeline, alle Punkte GLEICH GROSS:
    //   kommend  = creme GEFÜLLT, dünner neutraler Ring   (steht aus)
    //   nächster = creme gefüllt + Amber-RING             (Ziel, Ring als Vorschau)
    //   besucht  = amber GEFÜLLT + weißer Ring            (erreicht — Ring „füllt sich")
    // Der weiße Ring trennt „besucht" sauber von der amberfarbenen Fahrtlinie.
    paint: {
      'circle-radius': 11,
      'circle-color': ['case', done, '#f5a524', '#f6f1e7'],
      'circle-stroke-color': ['case', done, '#ffffff', next, '#f5a524', 'rgba(23,17,6,0.4)'],
      'circle-stroke-width': ['case', done, 2, next, 2.5, 1.3],
      'circle-pitch-alignment': 'viewport',
      'circle-pitch-scale': 'viewport',
    },
  })
  map.addLayer({
    id: 'spots-num',
    type: 'symbol',
    source: 'spots',
    layout: {
      'text-field': ['get', 'label'],
      'text-font': ['Noto Sans Bold'],
      'text-size': 12,
      'text-allow-overlap': true,
      'text-ignore-placement': true,
      'text-pitch-alignment': 'viewport',
      'text-rotation-alignment': 'viewport',
    },
    paint: { 'text-color': '#1c1712' },
  })

  for (const layerId of ['spots-circle', 'spots-num']) {
    map.on('click', layerId, (e) => {
      // `properties.s` ist oben selbst geschrieben worden — GeoJSON-Properties
      // sind für MapLibre trotzdem nur ein loses Objekt.
      const s = e.features?.[0]?.properties['s']
      if (typeof s === 'number') onSelect(s)
    })
  }
  map.on('mouseenter', 'spots-circle', () => (map.getCanvas().style.cursor = 'pointer'))
  map.on('mouseleave', 'spots-circle', () => (map.getCanvas().style.cursor = ''))

  // Fortschritts-Zustand der Wegpunkte (erledigt / als Nächstes dran). „Besucht" erst
  // bei ERREICHEN (kleiner 20-m-Vorlauf, damit es mit dem Einblenden der Foto-Karte
  // zusammenfällt) — NICHT mehr 200 m davor.
  return (s: number) => {
    let nextFound = false
    spots.forEach((sp, i) => {
      const isDone = sp.s <= s + 20
      const isNext = !isDone && !nextFound && (nextFound = true)
      map.setFeatureState({ source: 'spots', id: i }, { done: isDone, next: isNext })
    })
  }
}

// Piktogramme je Fortbewegungsmodus (24×24, Strichstil)
const SVG_OPEN =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'
export const MODE_ICONS: Record<Modus, string> = {
  bike: `${SVG_OPEN}
    <circle cx="5.5" cy="17.5" r="3.4"/><circle cx="18.5" cy="17.5" r="3.4"/>
    <path d="M5.5 17.5 9.3 10.6h6l3.2 6.9"/><path d="M9.3 10.6 12.4 17.5h6.1"/>
    <path d="M15.3 10.6 13.8 7.4h2.6"/><path d="M7.9 8.2h2.8"/></svg>`,
  walk: `${SVG_OPEN}
    <circle cx="13.2" cy="4.6" r="2"/>
    <path d="M12.9 7.6 12 12.6l-2.8 6.9"/><path d="M12 12.6l3.2 2.2 1 5"/>
    <path d="M12.6 9.4 9.6 11.7l-.8 3"/><path d="M13.4 9.8l2.6 2 2.6.6"/></svg>`,
  tram: `${SVG_OPEN}
    <rect x="6.5" y="4.5" width="11" height="12.5" rx="2.2"/>
    <path d="M6.5 11.5h11"/><path d="M10.2 4.5 12 2.2l1.8 2.3"/>
    <path d="M9.7 14.6h.01M14.3 14.6h.01"/>
    <path d="M8.8 17.5 7.3 21M15.2 17.5 16.7 21"/></svg>`,
  ferry: `${SVG_OPEN}
    <path d="M4.5 14.5h15l-2.2 4.1a2 2 0 0 1-1.8 1.1H8.5a2 2 0 0 1-1.8-1.1z"/>
    <path d="M7.5 14.5V10.2h9v4.3"/><path d="M10 10.2V7.4h4v2.8"/><path d="M12 7.4V4.8"/></svg>`,
  // Roller: zwei Räder, durchgestiegener Rahmen, Lenker mit Beinschild
  moped: `${SVG_OPEN}
    <circle cx="5.8" cy="17.3" r="2.9"/><circle cx="18.2" cy="17.3" r="2.9"/>
    <path d="M5.8 17.3h5.6l2.5-4.7h2"/><path d="M13.4 8.4h2.2l2.6 8.9"/>
    <path d="M8.4 12.9c1.3-1.3 3.2-1.5 5-1.3"/></svg>`,
  // Jeep/4×4: kantiger, hochgesetzter Aufbau mit Windschutzscheibe, zwei Räder
  jeep: `${SVG_OPEN}
    <circle cx="7.6" cy="16.8" r="2.3"/><circle cx="16.4" cy="16.8" r="2.3"/>
    <path d="M3.3 16.8H5.3M9.9 16.8h4.2M18.7 16.8h2"/>
    <path d="M3.5 16.4v-3.1a1.1 1.1 0 0 1 1.1-1.1h2.2l1.9-2.5h6.3l1.6 2.5h1.6a1.1 1.1 0 0 1 1.1 1.1v3.1"/>
    <path d="M8.5 11.7h5.4"/></svg>`,
}

/**
 * Piktogramm zu einem Modus — der Schlüssel kommt roh aus der Tour, ein
 * unbekannter Wert fällt (wie eh und je) auf das Rad zurück.
 */
const modeIcon = (mode: string): string => MODE_ICONS[mode as Modus] ?? MODE_ICONS.bike

export function createRider(map: MapLibreMap, lnglat: LngLatLike, mode = 'bike'): Marker {
  const el = document.createElement('div')
  el.className = 'rider'
  el.innerHTML = `
    <div class="rider-pulse"></div>
    <div class="rider-puck">${modeIcon(mode)}</div>`
  // subpixelPositioning: sonst rundet MapLibre auf ganze Pixel → Marker zittert
  // opacityWhenCovered '1': MapLibre dimmt Terrain-Marker per Default auf 0.2, sobald sein
  //   Tiefentest sie „hinter dem Gelände" wähnt. Der bodennahe Fahrer-Marker fällt bei
  //   unserer tief-schrägen Verfolgungskamera (Pitch bis 86°) fast durchgehend in diesen
  //   Test → halbtransparent. Als Navi-Element soll er IMMER voll sichtbar bleiben.
  return new maplibregl.Marker({
    element: el,
    pitchAlignment: 'viewport',
    rotationAlignment: 'viewport',
    subpixelPositioning: true,
    opacityWhenCovered: '1',
  })
    .setLngLat(lnglat)
    .addTo(map)
}

export function setRiderIcon(rider: Marker, mode: string): void {
  const puck = rider.getElement().querySelector<HTMLElement>('.rider-puck')
  if (!puck) return
  puck.innerHTML = modeIcon(mode)
  puck.classList.remove('pop')
  void puck.offsetWidth
  puck.classList.add('pop') // kleiner Wechsel-Impuls
}
