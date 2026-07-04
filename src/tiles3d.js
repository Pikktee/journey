// Google Photorealistic 3D Tiles in einer EIGENEN Three.js-Szene — via 3DTilesRendererJS
// (NASA-AMMOS), OHNE Cesium. Liefert „schöne 3D-Gebäude, die den echten dort stehenden
// nahekommen": die Google-Tiles SIND der Fotoscan der Stadt. Schlank in Three.js gerendert,
// voll kontrollierbar (Kamera, Route, Foto-Wegpunkte, Fahrer, Tag/Nacht), statt im schweren Cesium.
//
// MapLibre läuft unsichtbar darunter weiter (Tour-Engine braucht dessen Terrain-Abfragen); die
// Tour-Kamera wird pro Frame in die Three.js-Kamera gespiegelt (extCamera → setCamera).
// Aktiv als „Google 3D"-Modus der Ansicht (Query ?tiles3d=1). Braucht den Google-Map-Tiles-Key.
//
// ── Wichtige Eigenheiten ──────────────────────────────────────────────────────────────────
// • Route/Marker/Fahrer werden mit depthTest:false gezeichnet — sie liegen sonst UNTER den
//   Google-Tiles (deren fotogrammetrische Oberfläche ≠ unser DEM; ein DEM-basierter z-Wert
//   versinkt). depthTest:false = immer sichtbar (wie Cesiums clampToGround / die MapLibre-Marker).
// • Route-Linien-Vertices um ihren Schwerpunkt LOKALISIERT (float32-Jitter bei ~6,3e6-ECEF-Koords).
// • TilesFadePlugin blendet neu geladene Tiles weich ein statt hartem Pop-in (weniger „klobig").
//
// Bekannte Grenze: Google-3D deckt nur ~2.500 Städte ab (Stockholm ja, alpines Oberland nein).

import * as THREE from 'three'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { TilesRenderer, WGS84_ELLIPSOID } from '3d-tiles-renderer'
import { GoogleCloudAuthPlugin, GLTFExtensionsPlugin, TilesFadePlugin } from '3d-tiles-renderer/plugins'
import { EXAGGERATION } from './map.js'
import { pointAt } from './geo.js'

const DEG = Math.PI / 180
const DRACO_CDN = 'https://www.gstatic.com/draco/versioned/decoders/1.5.7/'
const BASIS_CDN = 'https://cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/libs/basis/'
const AMBER = 0xf5a524

const _v = new THREE.Vector3()
const _v2 = new THREE.Vector3()
const toColor = (c) => new THREE.Color().set(c)

// Numerierter Foto-Wegpunkt als Canvas-Textur (creme Kreis, dunkle Kontur, Zahl) → Sprite.
function spotTexture(label) {
  const S = 72
  const cvs = document.createElement('canvas')
  cvs.width = cvs.height = S
  const ctx = cvs.getContext('2d')
  ctx.beginPath()
  ctx.arc(S / 2, S / 2, S / 2 - 7, 0, 2 * Math.PI)
  ctx.fillStyle = label ? '#f6f1e7' : '#ffffff'
  ctx.fill()
  ctx.lineWidth = 6
  ctx.strokeStyle = 'rgba(23,17,6,0.6)'
  ctx.stroke()
  if (label) {
    ctx.fillStyle = '#1c1712'
    ctx.font = 'bold 38px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, S / 2, S / 2 + 2)
  }
  const tex = new THREE.CanvasTexture(cvs)
  tex.anisotropy = 4
  return tex
}

// geoidOffset wie früher: unsere Höhen sind Meter über Meeresspiegel, das Ellipsoid rechnet über
// WGS84 — regionaler Versatz ~20–50 m aus der Tour-Konfiguration.
export function createTiles3D(route, geoidOffset = 0, fovDeg = 45, stops = []) {
  const canvas = document.createElement('canvas')
  canvas.id = 'tiles3d'
  Object.assign(canvas.style, {
    position: 'fixed', inset: '0', width: '100%', height: '100%', zIndex: '1',
    pointerEvents: 'none', display: 'none',
  })
  document.body.appendChild(canvas)

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setClearColor(toColor('#8fb8de'), 1)

  const scene = new THREE.Scene()
  const ambient = new THREE.AmbientLight(0xffffff, 2.2)
  const sun = new THREE.DirectionalLight(0xfff2e0, 1.4)
  sun.position.set(0.4, 1, 0.6)
  scene.add(ambient, sun)

  const camera = new THREE.PerspectiveCamera(fovDeg, window.innerWidth / window.innerHeight, 1, 200000)

  let tiles = null
  let active = false
  let rafId = null
  const _target = new THREE.Vector3()

  function resize() {
    const w = window.innerWidth, h = window.innerHeight
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    routeFuture?.material.resolution.set(w, h)
    routePast?.material.resolution.set(w, h)
  }

  // Marker in konstanter Bildschirmgröße halten (feste Weltgröße wäre aus der Nähe riesig / fern winzig).
  function screenScale(obj, px) {
    const d = camera.position.distanceTo(obj.getWorldPosition(_v))
    const s = Math.max(0.0001, d) * px
    obj.scale.setScalar(s)
  }

  function frame() {
    if (!active) return
    rafId = requestAnimationFrame(frame)
    if (tiles) {
      camera.updateMatrixWorld()
      tiles.setResolutionFromRenderer(camera, renderer)
      tiles.update()
    }
    if (riderMesh) screenScale(riderMesh, 0.010)
    for (const sp of spotSprites) screenScale(sp, 0.026)
    renderer.render(scene, camera)
  }

  // ── Route + Foto-Wegpunkte + Fahrer ─────────────────────────────────────────────────────
  const routeCenter = new THREE.Vector3()
  let ecefPts = null
  let routeFuture = null, routePast = null, riderMesh = null
  const spotSprites = []

  function ecefLocal(lng, lat, h, out) {
    WGS84_ELLIPSOID.getCartographicToPosition(lat * DEG, lng * DEG, h, out)
    return out.sub(routeCenter)
  }
  function ecefWorld(lng, lat, h, out) {
    return WGS84_ELLIPSOID.getCartographicToPosition(lat * DEG, lng * DEG, h, out)
  }

  function buildOverlays() {
    const cmid = route.coords[Math.floor(route.coords.length / 2)]
    ecefWorld(cmid[0], cmid[1], (cmid[2] ?? 0) + geoidOffset, routeCenter)
    ecefPts = route.coords.map((c) => ecefLocal(c[0], c[1], (c[2] ?? 0) + geoidOffset + 3, new THREE.Vector3()))
    const flat = ecefPts.flatMap((p) => [p.x, p.y, p.z])
    const w = window.innerWidth, h = window.innerHeight

    // Gepunktete Gesamtstrecken-Vorschau (immer obenauf, kein Versinken)
    routeFuture = new Line2(new LineGeometry().setPositions(flat), new LineMaterial({
      color: 0xffffff, linewidth: 1.8, transparent: true, opacity: 0.6,
      dashed: true, dashSize: 8, gapSize: 12, resolution: new THREE.Vector2(w, h),
      depthTest: false, depthWrite: false,
    }))
    routeFuture.computeLineDistances()
    routeFuture.position.copy(routeCenter)
    routeFuture.renderOrder = 2
    scene.add(routeFuture)

    // Gefahrener Teil (voll, amber), wächst über setProgress
    routePast = new Line2(new LineGeometry().setPositions(flat.slice(0, 6)), new LineMaterial({
      color: AMBER, linewidth: 4.5, resolution: new THREE.Vector2(w, h),
      depthTest: false, depthWrite: false,
    }))
    routePast.position.copy(routeCenter)
    routePast.renderOrder = 3
    scene.add(routePast)

    // Foto-Wegpunkte als Sprites (Startpunkt + numerierte Stopps) — immer sichtbar, screen-space
    const addSpot = (lng, lat, ele, label) => {
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: spotTexture(label), depthTest: false, depthWrite: false, transparent: true }))
      ecefWorld(lng, lat, (ele ?? 0) + geoidOffset + 6, spr.position)
      spr.renderOrder = 6
      scene.add(spr)
      spotSprites.push(spr)
    }
    const s0 = pointAt(route, 0)
    addSpot(s0[0], s0[1], s0[2], '') // Startpunkt (ohne Zahl)
    stops.forEach((st, i) => { const p = pointAt(route, st.s); addSpot(p[0], p[1], p[2], String(i + 1)) })

    // Fahrer
    riderMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshBasicMaterial({ color: 0xff6f52, depthTest: false }))
    riderMesh.renderOrder = 7
    ecefWorld(s0[0], s0[1], (s0[2] ?? 0) + geoidOffset + 4, riderMesh.position)
    scene.add(riderMesh)
  }

  function enable(key) {
    if (!tiles) {
      const draco = new DRACOLoader().setDecoderPath(DRACO_CDN)
      const ktx2 = new KTX2Loader().setTranscoderPath(BASIS_CDN).detectSupport(renderer)
      tiles = new TilesRenderer()
      tiles.registerPlugin(new GoogleCloudAuthPlugin({ apiToken: key, autoRefreshToken: true }))
      tiles.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader: draco, ktxLoader: ktx2 }))
      tiles.registerPlugin(new TilesFadePlugin({ fadeDuration: 320 })) // weiches Einblenden statt Pop-in
      tiles.setCamera(camera)
      scene.add(tiles.group)
      buildOverlays()
    }
    canvas.style.display = ''
    active = true
    resize()
    window.addEventListener('resize', resize)
    frame()
  }

  function disable() {
    active = false
    if (rafId) cancelAnimationFrame(rafId)
    canvas.style.display = 'none'
    window.removeEventListener('resize', resize)
  }

  function setCamera({ cg, alt, lt, ltAlt }) {
    if (!active || !tiles) return
    const h1 = alt / EXAGGERATION + geoidOffset
    const h2 = ltAlt / EXAGGERATION + geoidOffset
    ecefWorld(cg[0], cg[1], h1, camera.position)
    ecefWorld(lt[0], lt[1], h2, _target)
    WGS84_ELLIPSOID.getPositionToNormal(camera.position, camera.up)
    camera.lookAt(_target)
    camera.updateMatrixWorld()
  }

  let lastProgT = 0
  function setProgress(s, pos) {
    if (!active || !riderMesh || !ecefPts) return
    if (pos) { ecefWorld(pos[0], pos[1], (pos[2] ?? 0) + geoidOffset + 4, riderMesh.position) }
    const now = performance.now()
    if (now - lastProgT < 120) return
    lastProgT = now
    const total = route.total || 1
    const k = Math.max(1, Math.min(ecefPts.length - 1, Math.floor((s / total) * (ecefPts.length - 1))))
    const flat = []
    for (let i = 0; i <= k; i++) { const p = ecefPts[i]; flat.push(p.x, p.y, p.z) }
    if (pos) { ecefLocal(pos[0], pos[1], (pos[2] ?? 0) + geoidOffset + 3, _v2); flat.push(_v2.x, _v2.y, _v2.z) }
    if (flat.length >= 6) routePast.geometry.setPositions(flat)
  }

  function applyDayNight(p) {
    renderer.setClearColor(toColor(p.sky), 1)
    ambient.intensity = 0.9 + 1.5 * p.br
    sun.intensity = 0.3 + 1.3 * p.br
    sun.color = toColor(p.lc)
  }
  function setNight(on) {
    renderer.setClearColor(toColor(on ? '#0a1424' : '#8fb8de'), 1)
    ambient.intensity = on ? 0.9 : 2.2
    sun.intensity = on ? 0.3 : 1.4
  }

  return {
    enable, disable, setCamera, setProgress, applyDayNight, setNight,
    _dbg: () => ({ tiles: tiles?.group?.children?.length ?? 0, spots: spotSprites.length }),
  }
}
