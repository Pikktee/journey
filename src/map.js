// Kartenaufbau: Esri World Imagery (Satellit) über AWS Terrain Tiles (Terrarium-DEM),
// dazu Atmosphäre und die beiden Routen-Layer.
import maplibregl from 'maplibre-gl'
import { indexAt } from './geo.js'
import { registerDemClean } from './demclean.js'

export const EXAGGERATION = 1.35

// DEM-Kacheln durch die Spike-Bereinigung leiten (siehe demclean.js): kaputte
// Ausreißer-Pixel in den groben Overview-Kacheln werden vor dem Rendern gekappt.
registerDemClean(maplibregl)

// Touch-Geräte: auf MSAA verzichten (bei ≥2× nicht unterscheidbar) und die
// Render-Auflösung härter deckeln (s. targetPixelRatio).
const COARSE = window.matchMedia('(pointer: coarse)').matches

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

// Gebäude — ein EINZELNER, solider fill-extrusion-Layer (kein Fenster-Pattern,
// kein separater Dachdeckel).
//
// DIAGNOSE des hartnäckigen Flimmerns (an echten OpenFreeMap-Kacheln gemessen,
// Gamla Stan z14/9014/4817): 69 Gebäude, davon ~10 mit ÜBERLAPPENDEN Polygonen
// (Gebäude-Umriss + building:parts) auf UNTERSCHIEDLICHEN Höhen → koplanares
// Z-Fighting an den geteilten Wandflächen. Und: `hide_3d` ist in diesen Kacheln
// bei KEINEM Feature gesetzt — die eigentlich zu verdeckenden Umrisse werden also
// mitgerendert. Das ist DATENSEITIG kaputt und clientseitig nicht sauber
// auflösbar (fill-extrusion hat keinen Depth-Bias, die Umrisse sind per Property
// nicht von den Teilen unterscheidbar).
//
// FIX, der wirklich greift: den Streit UNSICHTBAR machen statt die Geometrie zu
// reparieren. Das Auge nimmt HELLIGKEITS-Flimmern viel stärker wahr als Farbton-
// Flimmern. Beide Paletten haben deshalb bei voller Farbtonvielfalt eine EXAKT
// KONSTANTE Luminanz (Tag alle Luma≈142, Nacht alle ≈46, rechnerisch erzeugt) und
// niedrige Sättigung. Zwei überlappende Häuser tragen dann zwar verschiedene
// Farbtöne, aber gleiche Helligkeit → der Frame-zu-Frame-Wechsel des Z-Fights ist
// nur noch ein kaum sichtbarer Farbschimmer statt eines harten Hell/Dunkel-Kippens.
// (Gilt auch durch Licht/Verlauf: die streitenden Flächen sind gleich orientierte
// Wände → gleiche Schattierung → die Luma-Gleichheit bleibt erhalten.)
// Nebenbei löst dasselbe „zu dominant“ (gedeckt, gleichmäßig) und „alle gleich“
// (14 Farbtöne).
const BLD_DAY = [
  '#9d8d6c', '#a08a71', '#a48777', '#a8857c', '#969264', '#829b6a', '#9b8f69',
  '#a38975', '#a9837e', '#8e9664', '#7796a5', '#7d92a8', '#9f8c70', '#999066',
]
const BLD_NIGHT = [
  '#272e3d', '#282e3e', '#25303b', '#362d23', '#26303c', '#243238', '#2a2c42',
  '#382b24', '#243039', '#292d41', '#272e3c', '#2b2b44', '#392a25', '#272e3e',
]

// Tile-Feature-ID = OSM-ID × 10 + Typziffer — erst ÷10, sonst streut das
// Modulo nicht (die letzte Ziffer ist fast immer 0 oder 2)
const BID = ['floor', ['/', ['coalesce', ['id'], 0], 10]]

// Farbwahl pro Gebäude: bekannte OSM-colour-Namen grob auf einen Paletten-Index
// abbilden (gelbe Häuser bleiben gelblich, rote rötlich …), alles andere per
// ID-Hash. Beides ist ID/colour-stabil, sodass ein Haus über Tile-Grenzen und
// Frames hinweg IMMER seine Farbe behält — Voraussetzung, damit Duplikate sicher
// denselben Ton bekommen. Ergebnis ist ein number→Farbe-`match` (color-sicher).
function buildingColor(palette) {
  const idx = [
    'match', ['coalesce', ['get', 'colour'], ''],
    ['yellow', 'lightyellow', 'gold', '#fcf0cc', '#fcf1d4', '#f4e3c0'], 0,
    ['orange', 'salmon', 'lightsalmon', 'coral', 'peachpuff', 'sandybrown'], 1,
    ['red', 'firebrick', 'darkred', '#8b0000', 'indianred', 'maroon'], 3,
    ['beige', 'ivory', 'cream', 'papayawhip', '#f7f5ec', '#f6f1e2'], 6,
    ['brown', 'sienna', 'saddlebrown', 'chocolate'], 7,
    ['gray', 'grey', 'lightgrey', 'lightgray', 'silver', '#dadbdb'], 9,
    ['white', 'snow', '#ffffff', '#fefdfc', '#faf9fa'], 13,
    ['%', BID, palette.length], // Fallback: stabiler Hash
  ]
  const expr = ['match', idx]
  palette.forEach((c, i) => { if (i < palette.length - 1) expr.push(i, c) })
  expr.push(palette[palette.length - 1]) // match braucht einen Fallback-Zweig
  return expr
}

// Höhe hart auf 250 m deckeln: einzelne OSM-Gebäude tragen fehlerhafte Höhen
// (Tippfehler, falsche Einheit), und beim Tile-Nachladen kann eine noch grob
// tesselierte Geometrie kurz nach oben schießen. Ohne Deckel steht dann ein
// riesiger Spike im Bild, der verschwindet, sobald das saubere Tile da ist.
// 250 m liegt weit über allem entlang der Touren (höchstes Haus ~100 m).
const BLD_H = ['min', ['coalesce', ['get', 'render_height'], 8], 250]

// Weiches Einblenden über eine schmale Zoomstufe — sonst poppen alle Häuser eines
// Tiles schlagartig auf (das „ruckartige Einblenden"). Der Fade ist NICHT die Quelle
// der gemeldeten Stippel-Artefakte: die sind Z-Fighting überlappender OSM-Polygone
// und werden dadurch unsichtbar, dass alle Gebäudefarben auf konstante Luminanz
// normalisiert sind (siehe buildings.js / BLD_DAY) — das Flimmern kippt dann nur noch
// im Farbton, kaum wahrnehmbar, statt in der Helligkeit.
const APPEAR = ['interpolate', ['linear'], ['zoom'], 13.9, 0, 14.25, 1]

// Fundament 2 m unter Grund setzen: auf dem überhöhten, grob aufgelösten DEM
// (maxzoom 13) sitzt die Hangkante sonst mal knapp über, mal knapp unter der
// drapierten Satellitenfläche — der Wandfuß flimmert dann gegen den Boden. Ein
// paar Meter versenkt verschwindet die Naht unter dem Gelände (unsichtbar).
const BLD_BASE = ['-', ['coalesce', ['get', 'render_min_height'], 0], 2]

// Tag-Farbe: die aus dem Satellitenbild gesampelte Dachfarbe (feature-state {color},
// gesetzt von buildings.js — luminanz-normalisiert, daher flimmer-sicher), solange
// noch nicht gesampelt die Fallback-Palette (ebenfalls konstante Luminanz).
const DAY_COLOR = ['coalesce', ['feature-state', 'color'], buildingColor(BLD_DAY)]

// Tag/Nacht-Umschalter für die Gebäude: nur die Farbe (transitionsfähig, blendet
// über fill-extrusion-color-transition weich). Nachts die dunkle Palette statt der
// Satellitenfarbe (das Satellitenbild ist eine Tagaufnahme).
export function setBuildingsNight(map, on) {
  map.setPaintProperty('buildings-3d', 'fill-extrusion-color', on ? buildingColor(BLD_NIGHT) : DAY_COLOR)
}

export function createMap(container, center) {
  const map = new maplibregl.Map({
    container,
    center,
    zoom: 11,
    pitch: 48,
    bearing: -35,
    // 86 statt 72: die „Himmel-Momente" der Tour (tour.js skyLift) kippen die Kamera
    // zur Golden Hour/Nacht über den Horizont hinaus, damit ein echter Himmelsanteil
    // MIT Sonne/Sternen ins Bild kommt — dafür braucht die FreeCamera-Ableitung
    // Pitch-Spielraum, sonst klemmt die Rahmung und der Horizont klebt am oberen Rand.
    maxPitch: 86,
    antialias: !COARSE,
    // Render-Auflösung als Pixelbudget deckeln (s. targetPixelRatio) — hält den M4 an
    // 4K und schwächere GPUs unter der 60→30-fps-Füllraten-Klippe, ohne kleine Fenster
    // anzutasten. pixelRatio skaliert MapLibres GESAMTE Pipeline (Raster-Decode, Terrain-
    // Mesh, readPixels-Tiefenpuffer, Fill), die im Profil ~72–90 % der Frame-Zeit trägt.
    pixelRatio: targetPixelRatio(),
    // Mehr Zoomstufen im Tile-Cache halten: bei schnellen Zooms (Preset-Wechsel,
    // Foto-Sprünge) sind Eltern-/Kind-Tiles dann oft noch da statt neu zu laden
    maxTileCacheZoomLevels: 7,
    // Open-Meteo: Quelle des Auto-Wetters (autoweather.js), CC-BY 4.0 — Attribution
    // ist Lizenzbedingung, daher fest im Control (auch in spätere Video-Exporte einbrennen)
    attributionControl: { compact: true, customAttribution: 'Wetter: <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>' },
    style: {
      version: 8,
      // Schriftglyphen für Symbol-Layer (nummerierte Foto-Wegpunkte)
      glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
      sources: {
        satellite: {
          type: 'raster',
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
          tileSize: 256,
          maxzoom: 18,
          attribution: '© Esri, Maxar, Earthstar Geographics',
        },
        dem: {
          type: 'raster-dem',
          // Über demclean:// geleitet — die groben Overview-Kacheln werden von
          // korrupten Ausreißer-Pixeln bereinigt (siehe demclean.js).
          tiles: ['demclean://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png'],
          encoding: 'terrarium',
          tileSize: 256,
          maxzoom: 13,
          attribution: 'Terrain: Mapzen / AWS Open Data',
        },
        // OpenFreeMap-Vektortiles (OpenMapTiles-Schema) — liefern OSM-Gebäude
        // mit Höhen, damit Städte nicht flach wirken
        buildings: {
          type: 'vector',
          url: 'https://tiles.openfreemap.org/planet',
          attribution: '© OpenStreetMap',
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
        {
          // EIN einziger Baukörper-Layer (siehe Kommentar oben bei BLD_DAY) —
          // solide Farbe je OSM-ID, vertikaler Verlauf für Volumen, kein Pattern,
          // kein separater Dachdeckel. Das ist der Kern der Flimmer-Behebung.
          id: 'buildings-3d',
          type: 'fill-extrusion',
          source: 'buildings',
          'source-layer': 'building',
          minzoom: 13,
          filter: ['!=', ['get', 'hide_3d'], true],
          paint: {
            'fill-extrusion-color': DAY_COLOR,
            'fill-extrusion-color-transition': { duration: 1500 }, // Tag/Nacht weich blenden
            'fill-extrusion-height': BLD_H,
            'fill-extrusion-base': BLD_BASE,
            'fill-extrusion-opacity': APPEAR,
            // Basis dunkler → die Baukörper wirken geerdet und treten hinter das
            // Satellitenbild zurück, statt flach darüber zu leuchten.
            'fill-extrusion-vertical-gradient': true,
          },
        },
      ],
      // Fixes, warmes Sonnenlicht aus Südwest (map-verankert): Wände werden je
      // nach Ausrichtung unterschiedlich hell — Volumen statt Einheitsgrau
      light: { anchor: 'map', position: [1.3, 220, 40], color: '#ffedd6', intensity: 0.4 },
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
  // Pflicht-Attribution (Esri/OSM/Mapzen) hinter dem ⓘ-Knopf: MapLibre startet
  // compact ausgeklappt und klappt erst bei Klick ein — Zustand selbst setzen
  // (gleiche Klassen-/Attribut-Kombination wie der eingebaute Toggle-Klick).
  // Erst nach 'load': beim Init ist die Attribution noch leer, die compact-
  // Klassen kommen erst, wenn die Quellen ihre Attributionstexte liefern.
  const collapseAttrib = () => {
    const attrib = map.getContainer().querySelector('.maplibregl-ctrl-attrib')
    if (attrib?.classList.contains('maplibregl-compact-show')) {
      attrib.setAttribute('open', '')
      attrib.classList.remove('maplibregl-compact-show')
    }
  }
  map.once('load', collapseAttrib)
  map.once('idle', collapseAttrib) // falls eine Quelle erst nach 'load' meldet
  // Pixelbudget beim Fenster-Resize neu einregeln: Aufziehen von klein → 4K-Vollbild
  // würde sonst die Zeichenfläche über die Füllraten-Klippe treiben (pixelRatio bleibt
  // bei MapLibre über Resizes konstant). Gedrosselt + Schwellwert, damit das Ziehen am
  // Fensterrand keinen Dauer-Realloc des Framebuffers auslöst.
  let prTimer = null
  window.addEventListener('resize', () => {
    clearTimeout(prTimer)
    prTimer = setTimeout(() => {
      const pr = targetPixelRatio()
      if (Math.abs(map.getPixelRatio() - pr) > 0.05) map.setPixelRatio(pr)
    }, 250)
  })
  return map
}

// Die Fortschrittslinie ist zweigeteilt: der „festgeschriebene“ Teil wächst
// nur alle COMMIT_STRIDE Stützpunkte (~110 m), die kurze Spitze bis zum Fahrer
// wird pro Frame ersetzt. Vorher wurde die komplette (bis zu ~1800 Punkte
// lange) Linie 60× pro Sekunde neu tesselliert — für Glow und Linie doppelt.
const COMMIT_STRIDE = 8

export function addRouteLayers(map, route) {
  const coords2d = route.coords.map((c) => [c[0], c[1]])
  const line = (coordinates) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates } })

  map.addSource('route-full', { type: 'geojson', data: line(coords2d) })
  map.addSource('route-progress', { type: 'geojson', lineMetrics: true, data: line([coords2d[0], coords2d[0]]) })
  map.addSource('route-tip', { type: 'geojson', data: line([coords2d[0], coords2d[0]]) })

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
  const glowPaint = { 'line-color': '#f5a524', 'line-width': 11, 'line-blur': 7, 'line-opacity': 0.45 }
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
  return (s, pos) => {
    const base = Math.max(1, indexAt(route, Math.min(s, route.total))) - 1 // letzter Stützpunkt vor s
    const commit = base - (base % COMMIT_STRIDE)
    if (commit !== committed) {
      committed = commit
      const cs = coords2d.slice(0, commit + 1)
      if (cs.length < 2) cs.push(cs[0])
      map.getSource('route-progress').setData(line(cs))
    }
    const tip = coords2d.slice(commit, base + 1)
    tip.push([pos[0], pos[1]])
    map.getSource('route-tip').setData(line(tip))
  }
}

// Nummerierte Foto-Wegpunkte als GL-Layer (Circle + Symbol): im Gegensatz zu
// DOM-Markern laufen sie der Kamera nicht einen Frame hinterher und sitzen
// dadurch pixelfest auf der Karte. Klick springt zur Szene.
export function addSpotLayers(map, spots, startLngLat, onSelect) {
  map.addSource('start-dot', {
    type: 'geojson',
    data: { type: 'Feature', geometry: { type: 'Point', coordinates: startLngLat } },
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
      features: spots.map((sp, i) => ({
        type: 'Feature',
        id: i,
        properties: { label: String(i + 1), s: sp.s },
        geometry: { type: 'Point', coordinates: sp.lnglat },
      })),
    },
  })
  const done = ['boolean', ['feature-state', 'done'], false]
  const next = ['boolean', ['feature-state', 'next'], false]
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
      const f = e.features?.[0]
      if (f) onSelect(f.properties.s)
    })
  }
  map.on('mouseenter', 'spots-circle', () => (map.getCanvas().style.cursor = 'pointer'))
  map.on('mouseleave', 'spots-circle', () => (map.getCanvas().style.cursor = ''))

  // Fortschritts-Zustand der Wegpunkte (erledigt / als Nächstes dran). „Besucht" erst
  // bei ERREICHEN (kleiner 20-m-Vorlauf, damit es mit dem Einblenden der Foto-Karte
  // zusammenfällt) — NICHT mehr 200 m davor.
  return (s) => {
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
export const MODE_ICONS = {
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

export function createRider(map, lnglat, mode = 'bike') {
  const el = document.createElement('div')
  el.className = 'rider'
  el.innerHTML = `
    <div class="rider-pulse"></div>
    <div class="rider-puck">${MODE_ICONS[mode] ?? MODE_ICONS.bike}</div>`
  // subpixelPositioning: sonst rundet MapLibre auf ganze Pixel → Marker zittert
  // opacityWhenCovered '1': MapLibre dimmt Terrain-Marker per Default auf 0.2, sobald sein
  //   Tiefentest sie „hinter dem Gelände" wähnt. Der bodennahe Fahrer-Marker fällt bei
  //   unserer tief-schrägen Verfolgungskamera (Pitch bis 86°) fast durchgehend in diesen
  //   Test → halbtransparent. Als Navi-Element soll er IMMER voll sichtbar bleiben.
  return new maplibregl.Marker({ element: el, pitchAlignment: 'viewport', rotationAlignment: 'viewport', subpixelPositioning: true, opacityWhenCovered: '1' })
    .setLngLat(lnglat)
    .addTo(map)
}

export function setRiderIcon(rider, mode) {
  const puck = rider.getElement().querySelector('.rider-puck')
  puck.innerHTML = MODE_ICONS[mode] ?? MODE_ICONS.bike
  puck.classList.remove('pop')
  void puck.offsetWidth
  puck.classList.add('pop') // kleiner Wechsel-Impuls
}
