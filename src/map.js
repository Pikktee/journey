// Kartenaufbau: Esri World Imagery (Satellit) über AWS Terrain Tiles (Terrarium-DEM),
// dazu Atmosphäre und die beiden Routen-Layer.
import maplibregl from 'maplibre-gl'
import { indexAt } from './geo.js'
import { registerDemClean } from './demclean.js'

export const EXAGGERATION = 1.35

// DEM-Kacheln durch die Spike-Bereinigung leiten (siehe demclean.js): kaputte
// Ausreißer-Pixel in den groben Overview-Kacheln werden vor dem Rendern gekappt.
registerDemClean(maplibregl)

// Touch-Geräte: pixelRatio auf 2 kappen und auf MSAA verzichten — bei ≥2×
// nicht unterscheidbar, halbiert aber die GPU-Last auf 3×-Displays fast.
const COARSE = window.matchMedia('(pointer: coarse)').matches

// Gebäude: fill-extrusion kann keine UV-gemappten Fototexturen tragen — was
// es kann, sind gekachelte Patterns auf den Wandflächen. Die Wände bekommen
// deshalb prozedurale Putz-und-Fenster-Kacheln (Canvas, zur Laufzeit erzeugt)
// in Stockholmer Fassadentönen. Den Ton bestimmt die echte OSM-Fassadenfarbe
// (colour ist hier gut gepflegt), sonst ein stabiler Hash über die OSM-ID.
// Obendrauf sitzt ein hellerer, sonnengebleichter Dachdeckel als zweite,
// dünne Extrusion — der fängt zugleich ab, dass das Fenster-Pattern sonst
// auch auf den Dachflächen läge.
// Gedeckt und breiter gestreut — die Häuser sollen in der dunkel gegradeten
// Satellitenszene sitzen, nicht darüber leuchten. Dächer nahe an den echten
// Stockholmer Dachfarben (dunkler Ziegel, Grau-Braun) statt heller Deckel.
const FACADE_WALLS = ['#ab834e', '#a2957a', '#8a4234', '#9d6c50', '#87837a', '#997a55', '#966e59']
// Dächer in warmem Ziegel-/Terrakottaton nah an den Fassaden. Grund: in der dicht
// gemappten Altstadt überlappen sich OSM-Gebäude/-parts, ihre Wände (rot) und
// fremde Dachdeckel (früher braungrau) liegen dann in derselben Ebene und streiten
// per Z-Fighting → das gemeldete Rot↔Braun-Flimmern. Nah beieinander liegende Töne
// lassen den Kipp-Kontrast praktisch verschwinden (und Ziegelrot ist realistischer).
const ROOFS = ['#6f4636', '#7a4e3c', '#653f30', '#814d39', '#714634']
const ROOFS_NIGHT = ['#2e3138', '#2a2d34', '#32353c', '#2c2e36', '#34363e']

// Tile-Feature-ID = OSM-ID × 10 + Typziffer — erst ÷10, sonst streut das
// Modulo nicht (die letzte Ziffer ist fast immer 0 oder 2)
const BID = ['floor', ['/', ['coalesce', ['id'], 0], 10]]
const perBuilding = (colors) => {
  const expr = ['match', ['%', BID, colors.length]]
  colors.slice(0, -1).forEach((c, i) => expr.push(i, c))
  expr.push(colors[colors.length - 1]) // match braucht einen Fallback-Zweig
  return expr
}

// Fassadenton: gängige OSM-Farbnamen grob auf die Kachel-Töne abbilden
// (Gelb → Ocker, Weiß → Creme, Rot → Falunrot, …), alles andere per Hash
const TONE_IDX = [
  'match',
  ['coalesce', ['get', 'colour'], ''],
  ['yellow', 'lightyellow', 'gold', '#fcf0cc', '#fcf1d4', '#f4e3c0', '#f0d1a2', '#eed8b0'], 0,
  ['white', 'ivory', 'beige', 'papayawhip', '#fefdfc', '#faf9fa', '#f7f5ec', '#f6f1e2', '#f8edd8'], 1,
  ['red', 'firebrick', 'darkred', '#8b0000', 'indianred', 'brown', 'sienna', 'maroon', '#994a41'], 2,
  ['orange', 'salmon', 'lightsalmon', 'coral', 'peachpuff', 'sandybrown', '#d77358', '#df7964'], 3,
  ['gray', 'grey', 'lightgrey', 'lightgray', 'silver', '#dadbdb', '#b8b8b8'], 4,
  ['%', BID, FACADE_WALLS.length],
]
const patternFor = (prefix) => ['concat', prefix, ['to-string', TONE_IDX]]
// Ab mittlerer Distanz die fensterlose Kachel: das feine Fensterraster wird
// ohne Mipmaps beim Verkleinern zu hochfrequentem Textur-Flimmern — die
// fensterlosen Varianten nehmen die Frequenz raus, und beim Zoomstufen-
// Wechsel ist der Unterschied aus der Entfernung nicht mehr auflösbar.
// Schwelle bewusst hoch (15.4): das Fensterraster erscheint erst, wenn die
// Kamera wirklich nah dran ist (Gassen von Gamla Stan) — auf mittlere Distanz
// (Tram-/Fährvorbeifahrt) bleibt die ruhige flat-Kachel, die nicht flimmert.
const FACADE_PATTERN = ['step', ['zoom'], patternFor('facade-flat-'), 15.4, patternFor('facade-')]
const FACADE_PATTERN_NIGHT = ['step', ['zoom'], patternFor('facade-night-flat-'), 15.4, patternFor('facade-night-')]

// Höhe hart auf 250 m deckeln: einzelne OSM-Gebäude tragen fehlerhafte Höhen
// (Tippfehler, falsche Einheit), und beim Tile-Nachladen kann eine noch grob
// tesselierte Geometrie kurz nach oben schießen. Ohne Deckel steht dann ein
// riesiger Textur-Spike im Bild, der verschwindet, sobald das saubere Tile da
// ist. 250 m liegt weit über allem entlang der Touren (höchstes Haus ~100 m).
const BLD_H = ['min', ['coalesce', ['get', 'render_height'], 8], 250]
const ROOF_BASE = ['max', ['-', BLD_H, 2], 1] // Wandoberkante = Dachunterkante (kein Z-Fighting)

// Gebäudedaten gibt es erst ab Zoom ~14 — ohne Fade tauchen an dieser Schwelle
// alle Häuser eines Tiles schlagartig auf. Über eine schmale Zoomstufe von 0 auf
// volle Deckkraft hochblenden. WICHTIG: das Blendband bewusst kurz halten —
// halbtransparente fill-extrusion schreibt keine Tiefe, benachbarte/über Tile-
// Grenzen geteilte Häuser flackern dann gegeneinander (Z-Fighting). Deshalb ist
// die Deckkraft schon ab 14.25 wieder 1; die kurze Transparenz liegt dort, wo die
// Häuser noch klein und fern sind, das Pop-in bleibt trotzdem weich.
const APPEAR = ['interpolate', ['linear'], ['zoom'], 13.9, 0, 14.25, 1]

// Fundament 2 m unter Grund setzen: auf dem überhöhten, grob aufgelösten DEM
// (maxzoom 13) sitzt die Hangkante sonst mal knapp über, mal knapp unter der
// drapierten Satellitenfläche — der Wandfuß flimmert dann gegen den Boden. Ein
// paar Meter versenkt verschwindet die Naht unter dem Gelände (unsichtbar).
const BLD_BASE = ['-', ['coalesce', ['get', 'render_min_height'], 0], 2]

// Eine Fassaden-Kachel: Putz mit Körnung, zwei Etagen mit Geschossband,
// 3×2 Fenster. Nahtlos kachelbar. Der Kontrast ist bewusst niedrig gehalten
// (Rahmen/Glas nur angedeutet, zum Schluss ein Putz-Schleier) — harte Kanten
// flimmern beim Verkleinern. flat-Varianten für die Distanz: Tag ohne
// Fenster, Nacht nur weiche Lichtpunkte statt scharfer Rechtecke.
function facadeImage(wall, night = false, flat = false) {
  const S = 128
  const cv = document.createElement('canvas')
  cv.width = S
  cv.height = S
  const ctx = cv.getContext('2d')
  ctx.fillStyle = wall
  ctx.fillRect(0, 0, S, S)
  if (night) {
    ctx.fillStyle = 'rgba(9,12,22,0.78)' // Fassade in der Nacht fast schlucken
    ctx.fillRect(0, 0, S, S)
  }
  for (let i = 0; i < (night ? 90 : 260); i++) {
    ctx.fillStyle = i % 2 ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.045)'
    ctx.fillRect(Math.random() * S, Math.random() * S, 1.6, 1.6)
  }
  const cell = S / 3
  const w = 20
  const h = 30
  if (!flat) {
    ctx.fillStyle = night ? 'rgba(0,0,0,0.22)' : 'rgba(56,42,28,0.12)' // Geschossbänder
    ctx.fillRect(0, 62, S, 2)
    ctx.fillRect(0, 126, S, 2)
  }
  for (let r = 0; r < 2 && (!flat || night); r++) {
    for (let c = 0; c < 3; c++) {
      const x = Math.round(c * cell + (cell - w) / 2)
      const y = r * 64 + 16
      if (night) {
        if (Math.random() < 0.55) {
          // erleuchtetes Fenster; in der flat-Variante nur der weiche Schein —
          // scharfe helle Rechtecke wären in der Ferne wieder Flimmer-Quellen
          ctx.shadowColor = 'rgba(255,190,110,0.9)'
          ctx.shadowBlur = flat ? 11 : 7
          ctx.fillStyle = flat ? 'rgba(255,205,130,0.75)' : '#ffd08a'
          ctx.fillRect(x + (flat ? 4 : 0), y + (flat ? 8 : 0), flat ? w - 8 : w, flat ? h - 16 : h)
          ctx.shadowBlur = 0
          if (!flat) {
            ctx.fillStyle = 'rgba(255,240,205,0.9)'
            ctx.fillRect(x + 3, y + 3, w - 6, h / 2 - 3)
          }
        } else if (!flat) {
          ctx.fillStyle = 'rgba(190,185,170,0.14)' // Rahmen, kaum sichtbar
          ctx.fillRect(x - 2, y - 2, w + 4, h + 4)
          ctx.fillStyle = '#10141d' // dunkles Fenster
          ctx.fillRect(x, y, w, h)
        }
        continue
      }
      // Kontraste bewusst niedrig: ohne Mipmaps kippt eine verkleinerte Kachel
      // sonst pro Frame zwischen heller Wand und dunklem Fenster (Rot↔Braun-
      // Flimmern). Rahmen dezent, Glas halbtransparent — so bleibt das Fenster
      // eine abgedunkelte Tönung der Wand statt eines fremden Grautons, der
      // Kipp-Ausschlag beim Aliasing wird klein.
      ctx.fillStyle = 'rgba(242,236,222,0.32)' // Rahmen, gedämpft
      ctx.fillRect(x - 2, y - 2, w + 4, h + 4)
      ctx.fillStyle = 'rgba(46,49,58,0.5)' // Glas: dunkle Tönung, Wand scheint durch
      ctx.fillRect(x, y, w, h)
      ctx.fillStyle = 'rgba(195,208,220,0.14)' // Lichtkante im Glas
      ctx.fillRect(x + 2, y + 2, w / 2 - 2, h - 4)
      ctx.fillStyle = 'rgba(0,0,0,0.08)' // Schattenlinie unterm Fenstersims
      ctx.fillRect(x - 2, y + h + 2, w + 4, 1.5)
    }
  }
  if (!night) {
    // Putz-Schleier über allem: nimmt den Fenstern die harte Kante (Anti-Flimmern).
    // Kräftiger als zuvor, damit die verkleinerte Kachel weniger zwischen Wand-
    // und Fensterton kippt.
    ctx.globalAlpha = 0.26
    ctx.fillStyle = wall
    ctx.fillRect(0, 0, S, S)
    ctx.globalAlpha = 1
  }
  return ctx.getImageData(0, 0, S, S)
}

// Tag/Nacht-Umschalter für die Gebäude: Fenster-Pattern und Dachfarben —
// beide Eigenschaften sind transitionsfähig und blenden weich über
export function setBuildingsNight(map, on) {
  map.setPaintProperty('buildings-3d', 'fill-extrusion-pattern', on ? FACADE_PATTERN_NIGHT : FACADE_PATTERN)
  map.setPaintProperty('buildings-roof', 'fill-extrusion-color', on ? perBuilding(ROOFS_NIGHT) : perBuilding(ROOFS))
}

export function createMap(container, center) {
  const map = new maplibregl.Map({
    container,
    center,
    zoom: 11,
    pitch: 48,
    bearing: -35,
    maxPitch: 72,
    antialias: !COARSE,
    pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    // Mehr Zoomstufen im Tile-Cache halten: bei schnellen Zooms (Preset-Wechsel,
    // Foto-Sprünge) sind Eltern-/Kind-Tiles dann oft noch da statt neu zu laden
    maxTileCacheZoomLevels: 7,
    attributionControl: { compact: true },
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
          id: 'buildings-3d',
          type: 'fill-extrusion',
          source: 'buildings',
          'source-layer': 'building',
          minzoom: 13,
          filter: ['!=', ['get', 'hide_3d'], true],
          paint: {
            'fill-extrusion-pattern': FACADE_PATTERN,
            'fill-extrusion-pattern-transition': { duration: 1500 }, // Tag/Nacht weich blenden
            'fill-extrusion-height': ROOF_BASE,
            'fill-extrusion-base': BLD_BASE,
            // Beim Erscheinen weich einblenden (sonst schimmert bei Resttransparenz
            // das Wand-Pattern durch den Dachdeckel — bei APPEAR unkritisch, weil
            // nur ganz kurz und in der Ferne); ab Zoom 14.6 wieder voll deckend
            'fill-extrusion-opacity': APPEAR,
          },
        },
        {
          id: 'buildings-roof',
          type: 'fill-extrusion',
          source: 'buildings',
          'source-layer': 'building',
          minzoom: 13,
          filter: ['!=', ['get', 'hide_3d'], true],
          paint: {
            'fill-extrusion-color': perBuilding(ROOFS),
            'fill-extrusion-color-transition': { duration: 1500 }, // Tag/Nacht weich blenden
            'fill-extrusion-height': ['max', BLD_H, 1.5],
            'fill-extrusion-base': ROOF_BASE,
            'fill-extrusion-opacity': APPEAR, // synchron mit den Wänden einblenden
          },
        },
      ],
      // Fixes, warmes Sonnenlicht aus Südwest (map-verankert): Wände werden je
      // nach Ausrichtung unterschiedlich hell — Volumen statt Einheitsgrau
      light: { anchor: 'map', position: [1.3, 220, 40], color: '#ffedd6', intensity: 0.4 },
      terrain: { source: 'dem', exaggeration: EXAGGERATION },
      // Start-Himmel (bis die Tag/Nacht-Regie übernimmt) — Horizont/Fog nah am
      // Himmelblau, kein grauer Dunstbalken; weiche Blendzonen für einen
      // natürlichen, kantenlosen Horizont.
      sky: {
        'sky-color': '#7ab3e0',
        'horizon-color': '#9fc2e0',
        'fog-color': '#a9cae2',
        'sky-horizon-blend': 0.7,
        'horizon-fog-blend': 0.7,
        'fog-ground-blend': 0.5,
        'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 8, 0.28, 12, 0.1, 14, 0.06, 16, 0.05],
      },
    },
  })
  // Die Tour steuert die Center-Höhe selbst — nicht ans Terrain klemmen,
  // sonst springt die Kamera, solange DEM-Tiles noch laden.
  map.setCenterClampedToGround(false)
  // MapLibres eigene Tastensteuerung abschalten: Pfeiltasten steuern den Player
  // (Einzelbild vor/zurück), nicht das Verschieben/Zoomen der Karte.
  map.keyboard.disable()
  // Fassaden-Kacheln lazy erzeugen, wenn der Stil sie anfordert — robuster
  // als addImage vor dem Style-Parsing und kostet nur Gebäude-Tiles etwas
  map.on('styleimagemissing', (e) => {
    const m = e.id.match(/^facade-(night-)?(flat-)?(\d+)$/)
    if (m) map.addImage(e.id, facadeImage(FACADE_WALLS[+m[3] % FACADE_WALLS.length], !!m[1], !!m[2]), { pixelRatio: 2 })
  })
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
    paint: {
      'circle-radius': 12,
      'circle-color': ['case', done, '#f5a524', '#f6f1e7'],
      'circle-stroke-color': ['case', next, '#f5a524', done, 'rgba(255,255,255,0.75)', 'rgba(23,17,6,0.4)'],
      'circle-stroke-width': ['case', next, 3, 1.5],
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
      'text-size': 12.5,
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

  // Fortschritts-Zustand der Wegpunkte (erledigt / als Nächstes dran)
  return (s) => {
    let nextFound = false
    spots.forEach((sp, i) => {
      const isDone = sp.s <= s + 200
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
}

export function createRider(map, lnglat, mode = 'bike') {
  const el = document.createElement('div')
  el.className = 'rider'
  el.innerHTML = `
    <div class="rider-pulse"></div>
    <div class="rider-puck">${MODE_ICONS[mode] ?? MODE_ICONS.bike}</div>`
  // subpixelPositioning: sonst rundet MapLibre auf ganze Pixel → Marker zittert
  return new maplibregl.Marker({ element: el, pitchAlignment: 'viewport', rotationAlignment: 'viewport', subpixelPositioning: true })
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
