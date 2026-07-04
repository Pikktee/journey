// HYBRID-Renderer: MapLibre behält Boden/Terrain/Himmel/Route/Fake-Schatten/Tag-Nacht,
// deck.gl rendert NUR die Gebäude — interleaved (teilt MapLibres Tiefenpuffer), mit
// gerichteter Beleuchtung fürs Volumen. Aktiv über Flag ?deck=1 (src/main.js).
//
// ── Leitidee: STATISCHER Korridor statt Streaming ────────────────────────────────────
// Frühere Versuche mit viewport-getriebenem MVTLayer hatten zwei unlösbare Probleme:
//   1. Gebäude „poppten" beim Reinzoomen rein, weil Kacheln erst nach Sichtfeld nachluden.
//   2. Überlappende/deckungsgleiche OSM-Polygone (Umriss + parts, hide_3d fehlt in
//      OpenFreeMap) flimmerten durch koplanares Z-Fighting.
// Beide Wurzeln verschwinden mit derselben Maßnahme: Wir KENNEN die Kamerafahrt, also den
// Korridor. Deshalb laden wir ALLE Gebäude des Korridors EINMAL vorab (z14-Vektorkacheln →
// GeoJSON in echten lng/lat), werfen deckungsgleiche Duplikate raus (eine Fläche je ~2-m-
// Zelle, die höchste gewinnt → keine koplanaren Konkurrenten mehr) und rendern sie als EINE
// statische GeoJsonLayer. Nichts lädt mehr während der Fahrt nach (kein Poppen), keine
// Duplikate mehr (kein Flimmern), nur einmal tesseliert (flüssig).
//
// ── Farbe & Platzierung ──────────────────────────────────────────────────────────────
// Farbe = echte Dachfarbe aus dem Esri-Satellitenpixel am Gebäude-Zentroid, EINMAL aufgelöst
// und eingefroren (colorCache). Höhe = (überhöhte) Terrainhöhe am Zentroid + Gebäudehöhe;
// wir extrudieren von 0 bis dorthin und lassen den Teil unter Terrain vom interleaved-
// Tiefentest verdecken → Haus sitzt exakt auf dem Gelände, auch alpin.

import { MapboxOverlay } from '@deck.gl/mapbox'
import { GeoJsonLayer } from '@deck.gl/layers'
import { LightingEffect, AmbientLight, DirectionalLight } from '@deck.gl/core'
import { MVTLoader } from '@loaders.gl/mvt'

const OFM_TILEJSON = 'https://tiles.openfreemap.org/planet'
const BLD_Z = 14 // OFM-Gebäudedaten enden bei z14 (maxzoom des Tilesets)
const MAX_H = 250
const MIN_H = 8 // Ersatzhöhe für Gebäude ohne render_height (viele stehen auf 0 → sonst platt)
// Fern-LOD mit WEICHER Blende: In der Totalen (Menü-Übersicht) bricht die Tiefenpuffer-Präzision
// zusammen → unvermeidbares Flimmern; dort braucht man die Detail-Gebäude ohnehin nicht. Statt
// hart aus/ein zu schalten, faden die Gebäude über einen breiten Zoombereich langsam ein: bei
// FAR_ZOOM unsichtbar (0), bei FAR_ZOOM+FADE_RANGE voll (1), dazwischen linear. Beim Reinzoomen
// zur Tour tauchen sie so ganz sanft auf; beim Rauszoomen zur Totale gleiten sie wieder weg.
// Werte kalibriert: Totale (Menü) liegt bei Zoom 11, die Tour fährt je nach Modus bei ~13
// (Fähre, weit) bis ~16 (Gehen, nah). Also unsichtbar bis knapp über der Totale (11,5), voll
// bei 14 — so bleibt die Totale flimmerfrei UND die Tour-Gebäude sind nie durchscheinend.
const FAR_ZOOM = 12.5 // ab hier auftauchen — bewusst näher, damit weniger von der flimmernden
// Distanz-Zone im Zoom-in sichtbar ist (Kompromiss: Fade beginnt später, dafür ruhiger)
const FADE_RANGE = 2.5 // bis Zoom 15 voll sichtbar — vor dem dichten Stadt-Tourzoom
// Raster-Auflösung des Dedup-Index (1/Grad; ~22-44 m Zellen): begrenzt die Nachbarschafts-
// Suche beim Containment-Test, ohne das Ergebnis zu verändern (reine Beschleunigung).
const DEDUP_GRID = 2500
const MAX_TILES = 400 // Sicherheitsobergrenze für sehr lange Routen (mit Warnung)

// Sonnenstand = Fake-Schatten-Richtung (shadows.js: az 220, el 45), damit deck-Schattierung
// und Bodenschatten in dieselbe Richtung zeigen.
const SUN_AZ = 220
const SUN_EL = 45

// ── Satellitenfarbe pro Gebäude ──────────────────────────────────────────────────────
const D2R = Math.PI / 180
const SAT_Z = 16 // grob genug (~1,2 m/Pixel), aber 4× weniger Kacheln als Z17 → wenige Lade-
// Ereignisse, geringer Speicher, ganze Route-Vorladung passt in den Cache
const TSIZE = 256
const TARGET_LUMA = 150 // Ziel-Helligkeit der Basisfarbe (Licht moduliert darüber)
// KONSTANTE LUMINANZ (0) = der bewährte Anti-Z-Fight-Fix: alle Gebäude auf gleiche Basis-
// Helligkeit, nur Farbton/Sättigung variieren. Zwei koplanar konkurrierende Flächen haben dann
// dieselbe Helligkeit → das Fighting kippt nur im Farbton (kaum sichtbar) statt in der auffälligen
// Helligkeit. Das Volumen kommt ohnehin aus der Beleuchtung (Flächen-Normalen), nicht aus der Basis.
const LUMA_KEEP = 0 // 0 = konstante Luminanz (flimmerfrei), 1 = rohe Helligkeit (flimmert)
const SAT = 0.72 // Farbsättigung 0..1 (0 = grau, 1 = volle Dachfarbe)
const SAT_URL = (x, y) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${SAT_Z}/${y}/${x}`

// lng/lat → fraktionale Kachelkoordinate auf Zoomstufe z (Web-Mercator)
function tileXY(lng, lat, z) {
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
function heightOf(f) {
  const rh = f.properties?.render_height
  return Math.min(rh > 0 ? rh : MIN_H, MAX_H)
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
  const key = Math.abs(Math.round((p.render_height ?? 8) * 7 + (p.id ? Number(String(p.id).slice(-4)) || 0 : 0)))
  return FALLBACK[key % FALLBACK.length]
}

// Rohe Dachfarbe [r,g,b] → Baukörperfarbe: Sättigung dämpfen, Luminanz teilweise angleichen
// + stabile Helligkeits-Variation je Gebäude, damit nicht „alle gleich" wirken.
const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)))
function toBuildingColor([r, g, b], jitter = 0) {
  const luma = 0.299 * r + 0.587 * g + 0.114 * b
  let cr = luma + (r - luma) * SAT, cg = luma + (g - luma) * SAT, cb = luma + (b - luma) * SAT
  const targ = TARGET_LUMA + (luma - TARGET_LUMA) * LUMA_KEEP
  const k = (targ / Math.max(1, luma)) * (1 + jitter * 0.26) // ±13 % Helligkeit je Gebäude
  return [clamp(cr * k), clamp(cg * k), clamp(cb * k)]
}

export function installDeckBuildings(map, { enabled = true, route = null } = {}) {
  if (!enabled) return null

  // Beleuchtung: gerichtete Sonne (Volumen) + kräftiges Ambient. Richtung = Fake-Schatten.
  let ambient = new AmbientLight({ color: [255, 251, 243], intensity: 0.72 })
  let sun = new DirectionalLight({ color: [255, 247, 231], intensity: 1.05, direction: sunDir(SUN_AZ, SUN_EL) })
  const lighting = new LightingEffect({ ambient, sun })

  let lift = 33 // Terrain-Fallback (m), bis das DEM da ist
  let colorVersion = 0 // hochgezählt, wenn neue Satellitenkacheln eintreffen → getFillColor neu
  let terrainVersion = 0 // hochgezählt, wenn das DEM bereit ist → getElevation neu
  let visible = true // Gebäude-Overlay ein/aus (UI-Umschalter)
  let buildingFeatures = null // die vorab geladenen, deduplizierten Gebäude (null = lädt noch)
  const fadeAt = (z) => Math.round(Math.max(0, Math.min(1, (z - FAR_ZOOM) / FADE_RANGE)) * 10) / 10 // Zoom → Opazität (0,1-Stufen)
  let farOpacity = fadeAt(map.getZoom()) // Fern-Blende: 0 in der Totalen, 1 nah

  // Eingefrorene Ergebnisse pro Gebäude (Schlüssel = gerundetes Zentroid): Farbe/Höhe werden
  // GENAU EINMAL aufgelöst und behalten → kein Flimmern, kein wiederholtes Neurechnen.
  const colorCache = new Map() // posKey → [r,g,b] (final, inkl. Jitter) — nur ECHTE Samples
  const eleCache = new Map() // posKey → Basishöhe (m) — geleert bei DEM-Bump
  const posKey = (ll) => `${Math.round(ll[0] * 1e5)},${Math.round(ll[1] * 1e5)}`

  // ── Satellitenkachel-Cache: key → ImageData | 'pending' | null(fehlgeschlagen) ────────
  const tiles = new Map()
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
        colorVersion++
        // Während der Vorladung NICHT je Kachel neu einfärben (das erzeugt Farb-Wellen);
        // stattdessen EINMAL, wenn der ganze Korridor da ist.
        if (isPrefetch) prefetchTick()
        else scheduleRecolor()
      })
      .catch(() => { tiles.set(key, null); if (isPrefetch) prefetchTick() })
  }
  // Synchron: Farbe aus bereits geladener Kachel, sonst null (und Kachel-Load anstoßen).
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

  // ── Die eine statische Gebäude-Schicht ───────────────────────────────────────────────
  // data ist immer dieselbe Referenz (buildingFeatures) → beim Neu-Einfärben tesseliert deck
  // NICHT neu, sondern aktualisiert nur den Farb-Buffer (getFillColor). __c = vorab
  // berechnetes Zentroid (lng/lat), damit die Accessoren nicht pro Feature neu rechnen.
  function buildStaticLayer() {
    return new GeoJsonLayer({
      id: 'deck-buildings',
      data: buildingFeatures,
      // Gebäude UNTER die Photospot-Marker einfügen → die Zahlenkreise liegen immer oben, statt
      // von hohen Häusern überdeckt zu werden (start-dot ist der unterste Marker-Layer).
      beforeId: 'start-dot',
      opacity: farOpacity, // Fern-Blende: fadet beim Reinzoomen sanft ein (s. updateFarLOD)
      extruded: true,
      stroked: false,
      filled: true,
      material: { ambient: 0.4, diffuse: 0.7, shininess: 8, specularColor: [22, 22, 26] },
      getElevation: (f) => {
        const h = heightOf(f)
        const ll = f.__c
        if (!ll) return lift + h
        const k = posKey(ll)
        let base = eleCache.get(k)
        if (base == null) {
          const t = map.queryTerrainElevation(ll)
          base = t == null ? lift : t
          if (t != null) eleCache.set(k, base) // nur echte DEM-Höhe einfrieren
        }
        return base + h
      },
      getFillColor: (f) => {
        const ll = f.__c
        if (!ll) return fallbackColor(f)
        const k = posKey(ll)
        const cached = colorCache.get(k)
        if (cached) return cached
        const rgb = sampleSync(ll[0], ll[1])
        if (!rgb) return fallbackColor(f) // Kachel fehlt noch → Fallback, NICHT einfrieren
        const col = toBuildingColor(rgb) // ohne Helligkeits-Jitter → konstante Luminanz bleibt erhalten
        colorCache.set(k, col)
        return col
      },
      updateTriggers: { getFillColor: colorVersion, getElevation: terrainVersion },
      parameters: { depthTest: true },
    })
  }

  const overlay = new MapboxOverlay({ interleaved: true, effects: [lighting], layers: [] })
  map.addControl(overlay)

  const refresh = () => {
    // Schicht vorhalten, sobald die Gebäude geladen sind — AUCH bei Opazität 0. So tesseliert
    // deck EINMAL beim Laden (in der ruhigen Intro-Phase) statt erst beim Zoom-in, wenn der Fade
    // einsetzt (das war das Ruckeln). Die Fern-Blende läuft dann rein über die Opazität.
    const show = visible && buildingFeatures
    overlay.setProps({ layers: show ? [buildStaticLayer()] : [] })
    // Aktiv einen Frame anfordern → deck verarbeitet + lädt die Geometrie JETZT hoch, auch wenn
    // die Karte im Menü sonst idle wäre. So passiert die teure Tessellierung/GPU-Upload sicher
    // schon im Menü, nicht erst beim ersten Frame des Zoom-ins.
    map.triggerRepaint()
  }

  // Fern-LOD-Blende: Opazität aus dem Zoom ableiten und weich ein-/ausfaden. In 0,1-Stufen
  // gerastert → höchstens ~10 Schicht-Updates über den ganzen Fade (statt pro Frame) → kein
  // CPU-Stottern durch ständiges Neuaufsetzen der Compositelayer.
  function updateFarLOD() {
    const o = fadeAt(map.getZoom())
    if (o === farOpacity) return
    farOpacity = o
    refresh()
  }
  map.on('move', updateFarLOD)

  // Neu-Einfärben gedrosselt (Nachzügler-Kacheln außerhalb des Korridors feuern selten).
  let recolorScheduled = false
  function scheduleRecolor() {
    if (recolorScheduled) return
    recolorScheduled = true
    setTimeout(() => { recolorScheduled = false; refresh() }, 450)
  }

  // Sobald das DEM da ist, getElevation neu triggern (Fallback-Lift → echte Terrainhöhe).
  function whenTerrainReady() {
    const t = map.queryTerrainElevation(map.getCenter())
    if (t != null) { eleCache.clear(); terrainVersion++; refresh(); return }
    map.once('idle', whenTerrainReady)
  }
  whenTerrainReady()

  // ── Route-Vorladung: Satellitenkacheln des Korridors ─────────────────────────────────
  // Zählt herunter und färbt GENAU EINMAL neu ein, sobald der ganze Korridor da ist → ein
  // sauberer Farb-Einlauf statt vieler Wellen.
  let prefetchRemaining = 0
  function prefetchTick() {
    if (prefetchRemaining <= 0) return
    if (--prefetchRemaining === 0) refresh()
  }
  function prefetchSatellite() {
    if (!route || !route.coords || !route.coords.length) return
    const want = new Set()
    const step = Math.max(1, Math.round(route.coords.length / 1500))
    for (let i = 0; i < route.coords.length; i += step) {
      const [lng, lat] = route.coords[i]
      const [x, y] = tileXY(lng, lat, SAT_Z)
      const tx = Math.floor(x), ty = Math.floor(y)
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) want.add(`${tx + dx}/${ty + dy}`)
    }
    prefetchRemaining = want.size
    // Sicherheitsnetz: hängt eine Kachel, färben wir spätestens nach 3,5 s trotzdem einmal ein.
    setTimeout(() => { if (prefetchRemaining > 0) { prefetchRemaining = 0; refresh() } }, 3500)
    for (const key of want) { const [tx, ty] = key.split('/').map(Number); loadTile(tx, ty, true) }
  }

  // ── Korridor-Gebäude EINMAL laden (z14-Vektorkacheln → GeoJSON → dedupliziert) ────────
  async function loadCorridorBuildings(retry = false) {
    if (!route || !route.coords || !route.coords.length) return
    // Kachel-URL-Vorlage zur Laufzeit holen (Pfad enthält einen Versions-Hash → nicht hardcoden).
    let tpl = null
    try { tpl = (await fetch(OFM_TILEJSON).then((r) => r.json())).tiles?.[0] } catch { /* offline */ }
    if (!tpl) { if (!retry) setTimeout(() => loadCorridorBuildings(true), 1500); return }

    // z14-Kacheln des Korridors sammeln (± eine Nachbarkachel, damit auch Häuser seitlich der
    // Route erfasst sind).
    const want = new Set()
    const step = Math.max(1, Math.round(route.coords.length / 2000))
    for (let i = 0; i < route.coords.length; i += step) {
      const [lng, lat] = route.coords[i]
      const [fx, fy] = tileXY(lng, lat, BLD_Z)
      const tx = Math.floor(fx), ty = Math.floor(fy)
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) want.add(`${tx + dx}/${ty + dy}`)
    }
    let keys = [...want]
    if (keys.length > MAX_TILES) {
      console.warn(`[deckbuildings] Korridor hat ${keys.length} z14-Kacheln, gekappt auf ${MAX_TILES}.`)
      keys = keys.slice(0, MAX_TILES)
    }

    // alle Kacheln laden + zu GeoJSON parsen (nur Gebäude-Layer), zusammenführen
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

    if (!all.length) { if (!retry) setTimeout(() => loadCorridorBuildings(true), 1500); return }
    buildingFeatures = dedupe(all)
    refresh()
  }

  // Containment-Dedup: Überlappende OSM-Polygone (Umriss + versetzte Teilflächen) kreuzen sich
  // in den Wänden → Z-Fighting. Wir gehen von der größten Fläche zur kleinsten und werfen jede
  // Fläche raus, deren Zentroid INNERHALB einer bereits behaltenen, größeren Fläche liegt (der
  // klassische Part-im-Umriss-Fall). Ein Grid-Index über die bbox der behaltenen Flächen hält
  // den Punkt-in-Polygon-Test lokal (Tempo, gleiches Ergebnis). Zentroid wird als __c gecacht.
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
    const grid = new Map() // Zelle → behaltene Items, deren bbox die Zelle berührt
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

  prefetchSatellite()
  loadCorridorBuildings()

  return {
    overlay,
    _dbg: () => ({ tiles: tiles.size, colors: colorCache.size, buildings: buildingFeatures?.length ?? 0, colorVersion }),
    // Gebäude-Overlay ein/aus (leert bzw. füllt die deck-Layerliste).
    setVisible(on) { visible = on; refresh() },
    isVisible() { return visible },
    // Terrain-Fallback-Lift (m) — nur relevant, falls DEM nicht lädt.
    setLift(v) { lift = v; refresh() },
    // Sonnenstand live setzen (sollte den Fake-Schatten folgen).
    setSun(az, el) { sun.direction = sunDir(az, el); overlay.setProps({ effects: [new LightingEffect({ ambient, sun })] }) },
    // Tag/Nacht: nachts moderat dimmen + kühl färben — dunkler als der Boden, aber klar sichtbar
    // (frühere aggressive Werte machten die Häuser fast schwarz → „auf einen Schlag weg"). Frische
    // Licht-Objekte statt Mutation, Sonnenrichtung bleibt erhalten.
    setNight(on) {
      ambient = new AmbientLight({ color: on ? [190, 205, 235] : [255, 251, 243], intensity: on ? 0.5 : 0.72 })
      sun = new DirectionalLight({ color: on ? [170, 190, 225] : [255, 247, 231], intensity: on ? 0.58 : 1.05, direction: sun.direction })
      overlay.setProps({ effects: [new LightingEffect({ ambient, sun })] })
    },
    remove() { map.removeControl(overlay) },
  }
}
