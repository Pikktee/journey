// Prototyp: Google Photorealistic 3D Tiles als alternativer Renderer.
// CesiumJS wird erst beim Aktivieren vom CDN geladen (hält unser Bundle sauber).
// Die Tour-Engine läuft unverändert auf der — dann unsichtbaren — MapLibre-
// Karte weiter (sie braucht deren Terrain-Abfragen); nur das Bild kommt aus
// Cesium: die Tour-Kamera wird pro Frame gespiegelt. Bewusst schlank gehalten:
// kein Tag/Nacht-Grading, keine Foto-Wegpunkte im Cesium-Bild.
import { bearing, dist } from './geo.js'
import { EXAGGERATION } from './map.js'

const CESIUM_VERSION = '1.130'
const CESIUM_BASE = `https://cdn.jsdelivr.net/npm/cesium@${CESIUM_VERSION}/Build/Cesium/`

let cesiumLoading = null
function loadCesium() {
  if (window.Cesium) return Promise.resolve(window.Cesium)
  cesiumLoading ??= new Promise((resolve, reject) => {
    window.CESIUM_BASE_URL = CESIUM_BASE // Worker/Assets liegen relativ dazu
    const css = document.createElement('link')
    css.rel = 'stylesheet'
    css.href = `${CESIUM_BASE}Widgets/widgets.css`
    document.head.appendChild(css)
    const s = document.createElement('script')
    s.src = `${CESIUM_BASE}Cesium.js`
    s.onload = () => resolve(window.Cesium)
    s.onerror = () => reject(new Error('CesiumJS-CDN nicht erreichbar'))
    document.head.appendChild(s)
  })
  return cesiumLoading
}

// geoidOffset: unsere Höhen sind Meter über Meeresspiegel (Geoid), Cesium
// rechnet über dem WGS84-Ellipsoid — der Versatz ist regional ~20–50 m und
// steht als Näherungswert in der Tour-Konfiguration.
export function createPhotoreal(containerId, route, geoidOffset = 0) {
  const el = document.getElementById(containerId)
  let Cesium = null
  let viewer = null
  let tileset = null
  let riderEntity = null

  async function enable(key) {
    Cesium = await loadCesium()
    if (!viewer) {
      viewer = new Cesium.Viewer(el, {
        baseLayer: false,
        baseLayerPicker: false,
        geocoder: false,
        homeButton: false,
        sceneModePicker: false,
        navigationHelpButton: false,
        animation: false,
        timeline: false,
        fullscreenButton: false,
        infoBox: false,
        selectionIndicator: false,
      })
      viewer.scene.globe.show = false // die Google-Tiles sind Globus + Gelände + Stadt
      // Route und Fahrer auch im photorealistischen Bild verorten
      viewer.entities.add({
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArray(route.coords.flatMap((c) => [c[0], c[1]])),
          width: 4,
          material: Cesium.Color.fromCssColorString('#ff6f52').withAlpha(0.9),
          clampToGround: true,
        },
      })
      riderEntity = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(route.coords[0][0], route.coords[0][1], geoidOffset + 10),
        point: {
          pixelSize: 13,
          color: Cesium.Color.fromCssColorString('#f5a524'),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      })
    }
    if (!tileset) {
      // Der eine abrechenbare Abruf pro Session: root.json; alle Kachel-
      // Requests danach laufen über das darin enthaltene Session-Token.
      tileset = await Cesium.Cesium3DTileset.fromUrl(
        `https://tile.googleapis.com/v1/3dtiles/root.json?key=${encodeURIComponent(key)}`,
        {
          showCreditsOnScreen: true, // Google-Attribution ist Pflicht
          // Volle LOD-Verfeinerung erzwingen. Mit skipLevelOfDetail (der schnelleren
          // Voreinstellung) blendet Cesium beim Kameraschwenk kurz einen groben
          // Vorfahren-Tile durch, während die Kinder laden — genau die riesigen
          // Textur-Spikes, die nach ein paar Sekunden von selbst verschwinden.
          // false lädt jede Stufe vollständig, bevor sie sichtbar wird: kein Spike.
          skipLevelOfDetail: false,
        }
      )
      viewer.scene.primitives.add(tileset)
    }
    el.hidden = false
  }

  function disable() {
    el.hidden = true // Viewer/Tileset behalten — Wiedereinschalten kostet keinen neuen Root-Abruf
  }

  // Tour-Kamera spiegeln: Bodenpunkt + Höhe + Blickpunkt (aus tour.applyCamera).
  // Höhen aus der überhöhten MapLibre-Szene zurückrechnen und aufs Ellipsoid heben.
  function setCamera({ cg, alt, lt, ltAlt }) {
    if (!viewer || el.hidden) return
    const h1 = alt / EXAGGERATION + geoidOffset
    const h2 = ltAlt / EXAGGERATION + geoidOffset
    const ground = Math.max(dist(cg, lt), 1)
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(cg[0], cg[1], h1),
      orientation: {
        heading: (bearing(cg, lt) * Math.PI) / 180,
        pitch: -Math.atan2(h1 - h2, ground),
        roll: 0,
      },
    })
  }

  function setProgress(pos) {
    if (!viewer || el.hidden || !riderEntity) return
    riderEntity.position = Cesium.Cartesian3.fromDegrees(pos[0], pos[1], (pos[2] ?? 0) + geoidOffset + 4)
  }

  return { enable, disable, setCamera, setProgress }
}
