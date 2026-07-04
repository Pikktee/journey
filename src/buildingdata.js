// GEMEINSAME Gebäude-Datenschicht für beide deck-Renderer: den Hybrid-Overlay
// (deckbuildings.js, ?deck=1) und die eigenständige deck-Szene (deckscene.js, ?scene=1).
// Alles, was BEIDE brauchen, liegt hier an EINER Stelle: Korridor-Kacheln laden
// (z14-Vektorkacheln → GeoJSON in echten lng/lat), Containment-Dedup gegen Z-Fighting,
// Satelliten-Dachfarbe pro Gebäude, Höhen- und Farbabbildung. So gibt es eine Quelle
// der Wahrheit statt zweier driftender Kopien.

import { MVTLoader } from '@loaders.gl/mvt'

export const BLD_Z = 14 // OFM-Gebäudedaten enden bei z14 (maxzoom des Tilesets)

// ── Korridor-Kachel-Prewarming ─────────────────────────────────────────────────────────
// Wir KENNEN die Kamerafahrt → wir können die Kacheln, die die Fahrt gleich braucht, schon im
// Menü in den HTTP-Cache holen. Ein simples fetch() der Kachel-URL genügt: wenn deck (TerrainLayer/
// TileLayer) dieselbe URL später anfragt, ist sie ein Cache-Treffer und lädt sofort → kein Poppen.
// Läuft mit begrenzter Parallelität (Ketten), damit die Sicht-Kacheln der aktuellen Ansicht nicht
// verhungern, und mit kleiner Startverzögerung, damit die Erst-Ansicht Vorrang hat.
export function warmTiles(route, template, zoom, { radius = 1, budget = 220, delay = 600, concurrency = 6 } = {}) {
  if (!route?.coords?.length) return
  const want = new Set()
  const step = Math.max(1, Math.round(route.coords.length / 1500))
  for (let i = 0; i < route.coords.length; i += step) {
    const [lng, lat] = route.coords[i]
    const [x, y] = tileXY(lng, lat, zoom)
    const tx = Math.floor(x), ty = Math.floor(y)
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) want.add(`${tx + dx}/${ty + dy}`)
  }
  let keys = [...want]
  if (keys.length > budget) keys = keys.slice(0, budget)
  let idx = 0
  const pump = () => {
    if (idx >= keys.length) return
    const [tx, ty] = keys[idx++].split('/').map(Number)
    const url = template.replace('{z}', zoom).replace('{x}', tx).replace('{y}', ty)
    fetch(url).then((r) => r.blob()).catch(() => {}).finally(pump) // Kette: die nächste erst nach dieser
  }
  setTimeout(() => { for (let i = 0; i < concurrency; i++) pump() }, delay)
}
const OFM_TILEJSON = 'https://tiles.openfreemap.org/planet'
const MAX_H = 250
const MIN_H = 8 // Ersatzhöhe für Gebäude ohne render_height (viele stehen auf 0 → sonst platt)
const MAX_TILES = 400 // Sicherheitsobergrenze für sehr lange Routen (mit Warnung)
const DEDUP_GRID = 2500 // Raster-Auflösung des Dedup-Index (1/Grad; reine Beschleunigung)

// ── Satellitenfarbe pro Gebäude ──────────────────────────────────────────────────────
const D2R = Math.PI / 180
const SAT_Z = 16 // grob genug (~1,2 m/Pixel), aber 4× weniger Kacheln als Z17
const TSIZE = 256
const TARGET_LUMA = 150 // Ziel-Helligkeit der Basisfarbe (Licht moduliert darüber)
// KONSTANTE LUMINANZ (0) = der bewährte Anti-Z-Fight-Fix: alle Gebäude gleiche Basis-
// helligkeit, nur Farbton/Sättigung variieren → koplanares Fighting kippt nur im (kaum
// sichtbaren) Farbton statt in der auffälligen Helligkeit.
const LUMA_KEEP = 0
const SAT = 0.72 // Farbsättigung 0..1 (0 = grau, 1 = volle Dachfarbe)
const SAT_URL = (x, y) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${SAT_Z}/${y}/${x}`

// lng/lat → fraktionale Kachelkoordinate auf Zoomstufe z (Web-Mercator)
export function tileXY(lng, lat, z) {
  const n = 2 ** z
  const x = ((lng + 180) / 360) * n
  const y = ((1 - Math.log(Math.tan(lat * D2R) + 1 / Math.cos(lat * D2R)) / Math.PI) / 2) * n
  return [x, y]
}

// Äußerer Ring einer GeoJSON-Fläche (Features sind bereits geografisch, lng/lat).
function outerRing(f) {
  const g = f.geometry
  if (!g) return null
  return g.type === 'Polygon' ? g.coordinates[0] : g.type === 'MultiPolygon' ? g.coordinates[0]?.[0] : null
}

// Punkt-in-Polygon (Ray-Casting) auf dem äußeren Ring — Basis des Containment-Dedup.
function pointInRing(pt, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1]
    if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi)) inside = !inside
  }
  return inside
}

// effektive Gebäudehöhe (render_height, aber 0/fehlend → MIN_H, gedeckelt auf MAX_H)
export function heightOf(f) {
  const rh = f.properties?.render_height
  return Math.min(rh > 0 ? rh : MIN_H, MAX_H)
}

// Sonnenrichtung als 3D-Einheitsvektor (für DirectionalLight.direction)
export function sunDir(azimuthDeg, elevationDeg) {
  const az = (azimuthDeg * Math.PI) / 180
  const el = (elevationDeg * Math.PI) / 180
  return [-(Math.sin(az) * Math.cos(el)), -(Math.cos(az) * Math.cos(el)), -Math.sin(el)]
}

// Gedeckte Fallback-Palette, solange die Satellitenkachel noch nicht geladen ist (oder offline).
const FALLBACK = [
  [176, 168, 156], [168, 162, 152], [182, 174, 160], [162, 158, 152], [178, 168, 150], [158, 154, 149],
]
export function fallbackColor(f) {
  const p = f.properties || {}
  const key = Math.abs(Math.round((p.render_height ?? 8) * 7 + (p.id ? Number(String(p.id).slice(-4)) || 0 : 0)))
  return FALLBACK[key % FALLBACK.length]
}

// Rohe Dachfarbe [r,g,b] → Baukörperfarbe: Sättigung dämpfen, Luminanz konstant angleichen.
const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)))
export function toBuildingColor([r, g, b]) {
  const luma = 0.299 * r + 0.587 * g + 0.114 * b
  const cr = luma + (r - luma) * SAT, cg = luma + (g - luma) * SAT, cb = luma + (b - luma) * SAT
  const targ = TARGET_LUMA + (luma - TARGET_LUMA) * LUMA_KEEP
  const k = targ / Math.max(1, luma)
  return [clamp(cr * k), clamp(cg * k), clamp(cb * k)]
}

// ── Containment-Dedup ──────────────────────────────────────────────────────────────────
// Überlappende OSM-Polygone (Umriss + versetzte Teilflächen) kreuzen sich in den Wänden →
// Z-Fighting. Wir gehen von der größten Fläche zur kleinsten und werfen jede Fläche raus,
// deren Zentroid INNERHALB einer bereits behaltenen, größeren Fläche liegt. Ein Grid-Index
// über die bbox der behaltenen Flächen hält den Punkt-in-Polygon-Test lokal. __c = Zentroid.
function dedupe(features) {
  const items = []
  for (const f of features) {
    const ring = outerRing(f)
    if (!ring || ring.length < 4) continue
    let a = 1e9, b = 1e9, c = -1e9, d = -1e9
    for (const p of ring) { if (p[0] < a) a = p[0]; if (p[1] < b) b = p[1]; if (p[0] > c) c = p[0]; if (p[1] > d) d = p[1] }
    f.__c = [(a + c) / 2, (b + d) / 2]
    items.push({ f, ring, area: (c - a) * (d - b), bbox: [a, b, c, d] })
  }
  items.sort((p, q) => q.area - p.area) // größte zuerst → Umrisse gewinnen, kleine parts fallen weg
  const grid = new Map()
  const cellKey = (gx, gy) => gx + ',' + gy
  const kept = []
  for (const it of items) {
    const [cx, cy] = it.f.__c
    const bucket = grid.get(cellKey(Math.floor(cx * DEDUP_GRID), Math.floor(cy * DEDUP_GRID)))
    let covered = false
    if (bucket) for (const k of bucket) { if (k.area > it.area && pointInRing(it.f.__c, k.ring)) { covered = true; break } }
    if (covered) continue
    kept.push(it.f)
    const [a, b, c, d] = it.bbox
    for (let gx = Math.floor(a * DEDUP_GRID); gx <= Math.floor(c * DEDUP_GRID); gx++)
      for (let gy = Math.floor(b * DEDUP_GRID); gy <= Math.floor(d * DEDUP_GRID); gy++) {
        const key = cellKey(gx, gy)
        let arr = grid.get(key); if (!arr) { arr = []; grid.set(key, arr) }
        arr.push(it)
      }
  }
  return kept
}

// ── Korridor-Gebäude EINMAL laden (z14-Vektorkacheln → GeoJSON → dedupliziert) ──────────
// Wir KENNEN die Kamerafahrt, also den Korridor. Alle Gebäude entlang der Route werden einmal
// vorab geladen → kein Nachladen/Poppen zur Fahrt. Retry bei transienten Fehlern (offline).
// Liefert deduplizierte Features mit vorberechnetem Zentroid (__c) oder null (endgültig leer).
export async function loadCorridorBuildings(route, { maxTiles = MAX_TILES } = {}) {
  if (!route || !route.coords || !route.coords.length) return null
  const attempt = async () => {
    let tpl = null
    try { tpl = (await fetch(OFM_TILEJSON).then((r) => r.json())).tiles?.[0] } catch { /* offline */ }
    if (!tpl) return null

    // z14-Kacheln des Korridors sammeln (± eine Nachbarkachel für Häuser seitlich der Route).
    const want = new Set()
    const step = Math.max(1, Math.round(route.coords.length / 2000))
    for (let i = 0; i < route.coords.length; i += step) {
      const [lng, lat] = route.coords[i]
      const [fx, fy] = tileXY(lng, lat, BLD_Z)
      const tx = Math.floor(fx), ty = Math.floor(fy)
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) want.add(`${tx + dx}/${ty + dy}`)
    }
    let keys = [...want]
    if (keys.length > maxTiles) {
      console.warn(`[buildingdata] Korridor hat ${keys.length} z14-Kacheln, gekappt auf ${maxTiles}.`)
      keys = keys.slice(0, maxTiles)
    }

    const all = []
    await Promise.all(keys.map(async (key) => {
      const [x, y] = key.split('/').map(Number)
      const url = tpl.replace('{z}', BLD_Z).replace('{x}', x).replace('{y}', y)
      try {
        const buf = await fetch(url).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject()))
        if (!buf.byteLength) return
        const feats = MVTLoader.parseSync(buf, {
          mvt: { shape: 'geojson', coordinates: 'wgs84', tileIndex: { x, y, z: BLD_Z }, layers: ['building'] },
        })
        for (const f of feats) if (f && f.geometry) all.push(f)
      } catch { /* einzelne Kachel überspringen */ }
    }))
    return all.length ? dedupe(all) : null
  }
  let res = await attempt()
  if (!res) { await new Promise((r) => setTimeout(r, 1500)); res = await attempt() } // ein Retry
  return res
}

// ── Satelliten-Dachfarben-Sampler ──────────────────────────────────────────────────────
// Lädt Esri-Satellitenkacheln (z16) und liefert synchron die gemittelte Farbe am Punkt.
// Kachel-Cache: key → ImageData | 'pending' | null(fehlgeschlagen). onTile(cb) meldet neu
// eingetroffene (Nicht-Prefetch-)Kacheln → Auslöser fürs Neu-Einfärben.
export function createRoofSampler({ onTile } = {}) {
  const tiles = new Map()
  let prefetchRemaining = 0
  let prefetchDone = null

  function loadTile(tx, ty, isPrefetch = false) {
    const key = `${tx}/${ty}`
    if (tiles.has(key)) { if (isPrefetch) prefetchTick(); return }
    tiles.set(key, 'pending')
    fetch(SAT_URL(tx, ty))
      .then((res) => (res.ok ? res.blob() : Promise.reject()))
      .then((blob) => createImageBitmap(blob))
      .then((bmp) => {
        const cvs = document.createElement('canvas')
        cvs.width = cvs.height = TSIZE
        const ctx = cvs.getContext('2d', { willReadFrequently: true })
        ctx.drawImage(bmp, 0, 0)
        tiles.set(key, ctx.getImageData(0, 0, TSIZE, TSIZE).data)
        if (tiles.size > 400) tiles.delete(tiles.keys().next().value)
        if (isPrefetch) prefetchTick()
        else onTile?.()
      })
      .catch(() => { tiles.set(key, null); if (isPrefetch) prefetchTick() })
  }

  function prefetchTick() {
    if (prefetchRemaining <= 0) return
    if (--prefetchRemaining === 0) prefetchDone?.()
  }

  // Synchron: Farbe aus bereits geladener Kachel (3×3-Mittel), sonst null (+ Kachel-Load anstoßen).
  function sampleSync(lng, lat) {
    const [x, y] = tileXY(lng, lat, SAT_Z)
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

  // Alle Satellitenkacheln des Korridors vorab laden; onDone feuert EINMAL, wenn alle da sind.
  function prefetch(route, onDone) {
    if (!route || !route.coords || !route.coords.length) { onDone?.(); return }
    const want = new Set()
    const step = Math.max(1, Math.round(route.coords.length / 1500))
    for (let i = 0; i < route.coords.length; i += step) {
      const [lng, lat] = route.coords[i]
      const [x, y] = tileXY(lng, lat, SAT_Z)
      const tx = Math.floor(x), ty = Math.floor(y)
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) want.add(`${tx + dx}/${ty + dy}`)
    }
    prefetchRemaining = want.size
    prefetchDone = onDone
    setTimeout(() => { if (prefetchRemaining > 0) { prefetchRemaining = 0; onDone?.() } }, 3500) // Sicherheitsnetz
    for (const key of want) { const [tx, ty] = key.split('/').map(Number); loadTile(tx, ty, true) }
  }

  // Nach dem einmaligen Mesh-Bau werden die ImageData-Kacheln (~100 MB) nicht mehr gebraucht →
  // freigeben, sonst drückt der Speicher während der Fahrt auf die GC (Ruckeln).
  return { sampleSync, prefetch, size: () => tiles.size, dispose: () => tiles.clear() }
}
