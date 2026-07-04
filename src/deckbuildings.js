// HYBRID-Renderer: MapLibre behält Boden/Terrain/Himmel/Route/Fake-Schatten/Tag-Nacht,
// deck.gl rendert NUR die Gebäude — interleaved (teilt MapLibres Tiefenpuffer), mit
// gerichteter Beleuchtung fürs Volumen. Aktiv über Flag ?deck=1 (src/main.js).
//
// ── Leitidee (nach der Fassaden-Sackgasse) ───────────────────────────────────────────
// ERFUNDENES Fassadendetail (prozedurale Fenster/Etagen) machte aus jedem Haus einen
// uniformen Büroturm, erzeugte am Tag unsinnige „Lichter" und flimmerte bei Bewegung.
// Der bessere Weg ist ECHTE Information: pro Gebäude die tatsächliche Dachfarbe aus dem
// Esri-Satellitenbild samplen. Dadurch ist jedes Haus anders UND passt farblich zum
// Untergrund (weniger Fremdkörper). Volumen kommt aus dem Licht, Erdung aus den
// MapLibre-Fake-Schatten (shadows.js). Keine Fenster, keine Hashes → absolute Ruhe.
//
// ── Platzierung aufs Terrain ─────────────────────────────────────────────────────────
// SolidPolygonLayer hat keinen getBase → wir extrudieren von 0 bis (Terrainhöhe +
// Gebäudehöhe) und lassen den Teil UNTER dem Terrain vom interleaved-Tiefentest verdecken.
// So sitzt jedes Haus exakt auf dem (überhöhten) Gelände, ohne Parallaxe, auch alpin.
// queryTerrainElevation liefert erst nach DEM-Load ≠ null → Layer nach Terrain-Load neu bauen.

import { MapboxOverlay } from '@deck.gl/mapbox'
import { MVTLayer } from '@deck.gl/geo-layers'
import { GeoJsonLayer } from '@deck.gl/layers'
import { LightingEffect, AmbientLight, DirectionalLight } from '@deck.gl/core'

const OFM_TILEJSON = 'https://tiles.openfreemap.org/planet'
const MAX_H = 250

// Sonnenstand = Fake-Schatten-Richtung (shadows.js: az 220, el 45), damit deck-Schattierung
// und Bodenschatten in dieselbe Richtung zeigen.
const SUN_AZ = 220
const SUN_EL = 45

// ── Satellitenfarbe pro Gebäude ──────────────────────────────────────────────────────
// Wiederverwendung der bewährten Sampling-Logik aus buildings.js: Esri-Kachel laden,
// cachen, Dachpixel am Zentroid mitteln. TARGET_LUMA + partielle Luminanz-Angleichung
// dämpfen das koplanare Z-Fighting der überlappenden OSM-Polygone (Helligkeits-Flimmern
// fällt stark auf, Farbton-Flimmern kaum) — behalten aber genug Wert-Vielfalt, damit die
// Häuser sich unterscheiden. SAT dämpft penetrant-bunte Dächer.
const D2R = Math.PI / 180
const SAT_Z = 17 // niedriger als 18 → wenige, große Kacheln decken die Sicht → Cache reicht
const TSIZE = 256
const TARGET_LUMA = 150 // Ziel-Helligkeit der Basisfarbe (Licht moduliert darüber)
const LUMA_KEEP = 0.45 // wie viel echte Helligkeits-Abweichung erhalten bleibt (0 = flach, 1 = roh)
const SAT = 0.72 // Farbsättigung 0..1 (0 = grau, 1 = volle Dachfarbe)
const SAT_URL = (x, y) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${SAT_Z}/${y}/${x}`

function tileXY(lng, lat) {
  const n = 2 ** SAT_Z
  const x = ((lng + 180) / 360) * n
  const y = ((1 - Math.log(Math.tan(lat * D2R) + 1 / Math.cos(lat * D2R)) / Math.PI) / 2) * n
  return [x, y]
}

// Zentroid (bbox-Mitte) des äußeren Rings einer GeoJSON-Fläche, lng/lat
function centroid(f) {
  const g = f.geometry
  if (!g) return null
  const ring = g.type === 'Polygon' ? g.coordinates[0] : g.type === 'MultiPolygon' ? g.coordinates[0]?.[0] : null
  if (!ring || ring.length < 3) return null
  let a = 1e9, b = 1e9, c = -1e9, d = -1e9
  for (const p of ring) { if (p[0] < a) a = p[0]; if (p[1] < b) b = p[1]; if (p[0] > c) c = p[0]; if (p[1] > d) d = p[1] }
  return [(a + c) / 2, (b + d) / 2]
}

function sunDir(azimuthDeg, elevationDeg) {
  const az = (azimuthDeg * Math.PI) / 180
  const el = (elevationDeg * Math.PI) / 180
  return [-(Math.sin(az) * Math.cos(el)), -(Math.cos(az) * Math.cos(el)), -Math.sin(el)]
}

// Gedeckte Fallback-Palette, solange die Satellitenkachel noch nicht geladen ist (oder offline).
const FALLBACK = [
  [176, 168, 156], [168, 162, 152], [182, 174, 160], [162, 158, 152], [178, 168, 150], [158, 154, 149],
]
function fallbackColor(f) {
  const p = f.properties || {}
  const key = Math.abs(Math.round((p.render_height ?? 8) * 7 + (p['@id'] ? Number(String(p['@id']).slice(-4)) || 0 : 0)))
  return FALLBACK[key % FALLBACK.length]
}

// Stabiler Hash aus der Position (0..1) → flimmerfreie Variation je Gebäude (nicht pro Frame!).
function posHash(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return s - Math.floor(s)
}

// Rohe Dachfarbe [r,g,b] → Baukörperfarbe: Sättigung dämpfen, Luminanz teilweise angleichen
// (Z-Fight dämpfen, Wert-Vielfalt behalten) + stabile Helligkeits-Variation je Gebäude, damit
// nicht „alle gleich" wirken (auch wo die Satelliten-Dächer selbst uniform sind).
const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)))
function toBuildingColor([r, g, b], jitter = 0) {
  const luma = 0.299 * r + 0.587 * g + 0.114 * b
  let cr = luma + (r - luma) * SAT, cg = luma + (g - luma) * SAT, cb = luma + (b - luma) * SAT
  const targ = TARGET_LUMA + (luma - TARGET_LUMA) * LUMA_KEEP
  const k = (targ / Math.max(1, luma)) * (1 + jitter * 0.26) // ±13 % Helligkeit je Gebäude
  return [clamp(cr * k), clamp(cg * k), clamp(cb * k)]
}

export function installDeckBuildings(map, { enabled = true } = {}) {
  if (!enabled) return null

  // Beleuchtung: gerichtete Sonne (Volumen) + kräftiges Ambient, damit Schattenseiten nicht
  // absaufen. Sonnenrichtung = Fake-Schatten-Richtung (shadows.js).
  const ambient = new AmbientLight({ color: [255, 251, 243], intensity: 0.72 })
  const sun = new DirectionalLight({ color: [255, 247, 231], intensity: 1.05, direction: sunDir(SUN_AZ, SUN_EL) })
  const lighting = new LightingEffect({ ambient, sun })

  let lift = 33 // Terrain-Fallback (m), bis das DEM da ist
  let colorVersion = 0 // hochgezählt, wenn neue Satellitenkacheln eintreffen → getFillColor neu
  let terrainVersion = 0 // hochgezählt, wenn das DEM bereit ist → getElevation neu
  let visible = true // Gebäude-Overlay ein/aus (UI-Umschalter)

  // Satellitenkachel-Cache: key → ImageData | 'pending' | null(fehlgeschlagen)
  const tiles = new Map()
  function loadTile(tx, ty) {
    const key = `${tx}/${ty}`
    if (tiles.has(key)) return
    tiles.set(key, 'pending')
    fetch(SAT_URL(tx, ty))
      .then((res) => (res.ok ? res.blob() : Promise.reject()))
      .then((blob) => createImageBitmap(blob))
      .then((bmp) => {
        const cv = document.createElement('canvas')
        cv.width = cv.height = TSIZE
        const ctx = cv.getContext('2d', { willReadFrequently: true })
        ctx.drawImage(bmp, 0, 0)
        tiles.set(key, ctx.getImageData(0, 0, TSIZE, TSIZE).data)
        if (tiles.size > 220) tiles.delete(tiles.keys().next().value)
        colorVersion++
        scheduleRecolor()
      })
      .catch(() => tiles.set(key, null))
  }
  // Synchron: Farbe aus bereits geladener Kachel, sonst null (und Kachel-Load anstoßen).
  function sampleSync(lng, lat) {
    const [x, y] = tileXY(lng, lat)
    const tx = Math.floor(x), ty = Math.floor(y)
    const data = tiles.get(`${tx}/${ty}`)
    if (data == null || data === 'pending') { if (!tiles.has(`${tx}/${ty}`)) loadTile(tx, ty); return null }
    const cx = Math.min(TSIZE - 1, Math.floor((x % 1) * TSIZE))
    const cy = Math.min(TSIZE - 1, Math.floor((y % 1) * TSIZE))
    let r = 0, g = 0, b = 0, n = 0
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const px = Math.min(TSIZE - 1, Math.max(0, cx + dx)), py = Math.min(TSIZE - 1, Math.max(0, cy + dy))
      const i = (py * TSIZE + px) * 4
      r += data[i]; g += data[i + 1]; b += data[i + 2]; n++
    }
    return [r / n, g / n, b / n]
  }

  const _dbg = { calls: 0, sampled: 0, lastLngLat: null, lastRgb: null, tilesWithBbox: 0 }

  function buildLayer() {
    // Aktuelle Versionen in die Closure einfangen. WICHTIG: renderSubLayers muss je Rebuild
    // eine NEUE Funktions-Referenz sein, sonst erkennt die MVTLayer keine Änderung und ruft
    // renderSubLayers gar nicht erneut auf → geladene Satellitenfarben kämen nie an.
    const cv = colorVersion, tv = terrainVersion
    // Ein GeoJsonLayer je MVT-Kachel. deck reprojiziert die Accessor-Geometrie NICHT — sie
    // kommt tile-lokal ([0..1]). Über die geografische Tile-BBox rechnen wir sie hier selbst
    // in lng/lat um (linear; über eine kleine Kachel vernachlässigbar). Erst DAS liefert
    // korrekte Terrainhöhe (Platzierung) UND den richtigen Satellitenpixel.
    const subLayer = (props) => {
      const bb = props.tile && props.tile.bbox
      const geo = !!bb && bb.west != null
      const toLngLat = (c) =>
        geo ? [bb.west + c[0] * (bb.east - bb.west), bb.north + c[1] * (bb.south - bb.north)] : null

      return new GeoJsonLayer(props, {
        extruded: true,
        stroked: false,
        filled: true,
        material: { ambient: 0.4, diffuse: 0.7, shininess: 8, specularColor: [22, 22, 26] },
        // Basis auf die (überhöhte) Terrainhöhe am Zentroid heben (interleaved verdeckt den
        // Teil unter Terrain) → Haus sitzt exakt auf dem Gelände, auch alpin.
        getElevation: (f) => {
          const h = Math.min(f.properties.render_height ?? 8, MAX_H)
          const c = centroid(f); const ll = c && toLngLat(c)
          const t = ll ? map.queryTerrainElevation(ll) : null
          return (t == null ? lift : t) + h
        },
        // Echte Dachfarbe aus dem Esri-Satellitenpixel am Zentroid.
        getFillColor: (f) => {
          const c = centroid(f); const ll = c && toLngLat(c)
          _dbg.calls++
          const rgb = ll ? sampleSync(ll[0], ll[1]) : null
          if (ll) { _dbg.lastLngLat = ll }
          if (rgb) { _dbg.sampled++; _dbg.lastRgb = rgb }
          const jitter = ll ? posHash(ll[0], ll[1]) - 0.5 : 0 // stabil je Gebäude → flimmerfrei
          return rgb ? toBuildingColor(rgb, jitter) : fallbackColor(f)
        },
        updateTriggers: { getFillColor: cv, getElevation: tv }, // Gate: nur neu rechnen bei Versionswechsel
        parameters: { depthTest: true },
      })
    }

    return new MVTLayer({
      id: 'deck-buildings',
      data: OFM_TILEJSON,
      binary: false, // Accessoren bekommen GeoJSON (tile-lokale Koordinaten, s. subLayer)
      loadOptions: { mvt: { layers: ['building'] } },
      renderSubLayers: subLayer,
      updateTriggers: { renderSubLayers: [cv, tv] }, // frische renderSubLayers je Versionswechsel
    })
  }

  const overlay = new MapboxOverlay({ interleaved: true, effects: [lighting], layers: [buildLayer()] })
  map.addControl(overlay)

  const refresh = () => overlay.setProps({ layers: visible ? [buildLayer()] : [] })

  // Neu-Einfärben gedrosselt (sourcedata/Satellitenkacheln feuern oft).
  let recolorScheduled = false
  function scheduleRecolor() {
    if (recolorScheduled) return
    recolorScheduled = true
    setTimeout(() => { recolorScheduled = false; refresh() }, 180)
  }

  // Sobald das DEM da ist, getElevation neu triggern (früh geladene Kacheln bekommen echte
  // Terrainhöhe statt des Fallback-Lifts).
  function whenTerrainReady() {
    const t = map.queryTerrainElevation(map.getCenter())
    if (t != null) { terrainVersion++; refresh(); return }
    map.once('idle', whenTerrainReady)
  }
  whenTerrainReady()

  return {
    overlay,
    _dbg: () => ({ ..._dbg, tiles: tiles.size, colorVersion }),
    // Gebäude-Overlay ein/aus (leert bzw. füllt die deck-Layerliste).
    setVisible(on) { visible = on; refresh() },
    isVisible() { return visible },
    // Terrain-Fallback-Lift (m) — nur relevant, falls DEM nicht lädt.
    setLift(v) { lift = v; refresh() },
    // Sonnenstand live setzen (sollte den Fake-Schatten folgen).
    setSun(az, el) { sun.direction = sunDir(az, el); overlay.setProps({ effects: [new LightingEffect({ ambient, sun })] }) },
    remove() { map.removeControl(overlay) },
  }
}
