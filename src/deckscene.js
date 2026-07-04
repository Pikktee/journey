// STUFE 0 des Renderer-Plans (docs/renderer-plan.md): eine EIGENSTÄNDIGE deck.gl-Szene,
// die Terrain + Satellit selbst rendert — nicht als Overlay über MapLibre (das ist am
// ersten Spike gescheitert), sondern als eigener Renderer mit eigenem Canvas. MapLibre
// läuft unsichtbar weiter und dient nur noch als Rechen-Engine: Es liefert pro Frame die
// Kamera-Pose (center/zoom/pitch/bearing aus tour.applyCamera → jumpTo). Wir spiegeln die
// exakt in deck.gls MapView — dieselben Mercator-Kameraparameter → deckungsgleiche Sicht.
//
// Ziel dieser Stufe: BEWEISEN, dass eine eigene deck-Terrain-Szene deckungsgleich zur
// bisherigen MapLibre-Ansicht sitzt und flüssig läuft. Noch KEINE Gebäude, keine Schatten,
// keine Route/Wegpunkte — das sind Stufe 1/2.
//
// Bekannte Stufe-0-Grenze: TerrainLayer koppelt die Textur-Auflösung an die Terrain-Kachel-
// zoomstufe (anders als MapLibre, das hochauflösenden Satelliten über grobes Terrain drapt).
// Der Boden ist im Nahbereich daher gröber als bei MapLibre. Sauber lösen wir das in Stufe 1
// (eigene Textur-Drapierung), hier zählt nur die Deckungsgleichheit der Kamera/Geometrie.

import { Deck, MapView } from '@deck.gl/core'
import { TerrainLayer } from '@deck.gl/geo-layers'
import { EXAGGERATION } from './map.js'

const TERRARIUM = 'https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png'
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'

// Terrarium-Dekodierung MIT eingebackener Überhöhung, damit das deck-Terrain exakt so
// hoch steht wie MapLibres überhöhtes Gelände (sonst driften Kamera-Pose und Boden).
// Terrarium: h = r*256 + g + b/256 − 32768. Alles × EXAGGERATION.
const elevationDecoder = {
  rScaler: 256 * EXAGGERATION,
  gScaler: 1 * EXAGGERATION,
  bScaler: EXAGGERATION / 256,
  offset: -32768 * EXAGGERATION,
}

function viewStateOf(map) {
  const c = map.getCenter()
  return {
    longitude: c.lng,
    latitude: c.lat,
    zoom: map.getZoom(),
    pitch: map.getPitch(),
    bearing: map.getBearing(),
  }
}

export function installDeckScene(map) {
  // Eigene Leinwand über der (gleich unsichtbaren) MapLibre-Karte, wie #g3d (z-index 1).
  // pointer-events: none — die Kamera wird extern gesteuert, kein deck-Controller.
  const canvas = document.createElement('canvas')
  canvas.id = 'deck-scene'
  Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', zIndex: '1', pointerEvents: 'none' })
  document.body.appendChild(canvas)

  const terrain = new TerrainLayer({
    id: 'terrain',
    minZoom: 0,
    maxZoom: 14, // Terrarium existiert darüber hinaus kaum; koppelt auch die Textur-Schärfe
    tileSize: 256,
    elevationDecoder,
    elevationData: TERRARIUM,
    texture: ESRI,
    // Unbeleuchtet: der Satellit ist eine Aufnahme mit eingebranntem Licht — zusätzliche
    // Schattierung würde ihn (wie bei den Fake-Schatten) doppelt beleuchten. Beleuchtete
    // Gebäude + Schatten kommen erst in Stufe 1, auf DIESES Terrain-Mesh geworfen.
    material: false,
  })

  const deck = new Deck({
    canvas,
    // maxPitch an MapLibre angleichen (dort 72) — sonst klemmt deck die Pose bei 60 ab
    // und die Sicht driftet in steilen Kameralagen.
    views: new MapView({ repeat: false, maxPitch: 85 }),
    controller: false, // Pose kommt extern über setCamera()
    initialViewState: viewStateOf(map),
    layers: [terrain],
  })

  let active = false

  return {
    // Von tour.extCamera pro Frame gerufen. Wir ignorieren die {cg,alt,lt,ltAlt}-Nutzlast
    // und lesen die fertig gerechnete Pose direkt aus MapLibre — garantiert identisch.
    setCamera() {
      if (active) deck.setProps({ viewState: viewStateOf(map) })
    },
    enable() {
      active = true
      canvas.style.display = ''
      document.getElementById('map').style.visibility = 'hidden' // MapLibre-Bild aus, Engine läuft weiter
      deck.setProps({ viewState: viewStateOf(map) })
    },
    disable() {
      active = false
      canvas.style.display = 'none'
      document.getElementById('map').style.visibility = ''
    },
    deck,
  }
}
