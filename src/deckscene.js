// REINE deck-Pipeline (Renderer-Plan Stufe 1+2, docs/renderer-plan.md): eine EIGENSTÄNDIGE
// deck.gl-Szene, die ALLES selbst rendert — Terrain, Satellit, Gebäude, geerdete Schatten,
// Route, Foto-Wegpunkte, Himmel, Tag/Nacht. MapLibre läuft unsichtbar weiter und dient nur
// noch als Rechen-Engine: es liefert pro Frame die fertige Kamera-Pose (aus tour.applyCamera →
// jumpTo) und die Terrainhöhen (queryTerrainElevation). Wir spiegeln die Pose 1:1 in deck.gls
// MapView → deckungsgleiche Sicht. Aktiv über ?scene=1 (src/main.js).
//
// Warum das der große Schritt ist: MapLibres fill-extrusion besitzt die 3D-Szene nicht — kein
// echter Tiefen-/Licht-/Materialzugriff, deshalb „Spielzeugklötze", Doppelschatten und Häuser,
// die neben der Textur sitzen. Hier liegen Boden UND Gebäude in EINEM Renderer mit EINEM
// Tiefenpuffer und EINER Lichtquelle → Schatten der Häuser fallen auf denselben Terrain-Boden
// (geerdet, kein Doppelschatten), und alles sitzt konsistent auf dem Gelände.
//
// Bekannte Grenze dieser Stufe: TerrainLayer koppelt die Textur-Auflösung an die Terrain-
// Kachelzoomstufe — der Satellitenboden ist im Nahbereich gröber als MapLibres hochauflösender
// Drape. Eigene Textur-Drapierung ist ein eigenes Arbeitspaket (Stufe 3).
//
// ── Performance-Struktur ────────────────────────────────────────────────────────────────
// Pro Frame läuft NUR setCamera (viewState spiegeln). Die statischen Layer (Terrain, Gebäude,
// Wegpunkte, Streckenvorschau) werden EINMAL gebaut und als Referenz gecacht → deck difft sie
// weg (keine Neu-Tessellierung). Nur die Trace-Linie wird beim Fortschritt neu gebaut, die
// Wegpunkte nur, wenn ein Stopp „erledigt" kippt. Das Licht wird nur bei spürbarer Tag/Nacht-
// Änderung neu erzeugt (nicht 3×/s), sonst würde die Schatten-Framebuffer-Neuanlage ruckeln.

import { Deck, MapView, LightingEffect, AmbientLight, DirectionalLight } from '@deck.gl/core'
import { TerrainLayer, TileLayer } from '@deck.gl/geo-layers'
import { GeoJsonLayer, PathLayer, ScatterplotLayer, TextLayer, BitmapLayer } from '@deck.gl/layers'
import { PathStyleExtension, _TerrainExtension as TerrainExtension } from '@deck.gl/extensions'
import { EXAGGERATION } from './map.js'
import { pointAt } from './geo.js'
import {
  heightOf, fallbackColor, toBuildingColor, sunDir,
  loadCorridorBuildings, createRoofSampler, warmTiles,
} from './buildingdata.js'

const TERRARIUM = 'https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png'
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'

const LINE_LIFT = 1.5 // Route-Linie nur knapp über dem Terrain (m) → hugt den Boden, kein Schweben
const SPOT_LIFT = 3 // Foto-Wegpunkt-Marker etwas höher als die Linie
const SUN_AZ = 220 // Standard-Sonnenrichtung (= Fake-Schatten), bis Tag/Nacht sie live setzt
const SUN_EL = 45

// Farben (an den MapLibre-Pfad angeglichen): Bernstein/Koralle für die Strecke, Creme/Amber
// für die Wegpunkt-Zustände.
const AMBER = [245, 165, 36]
const CORAL = [255, 111, 82]
const CREAM = [246, 241, 231]
const INK = [23, 17, 6]

// Terrarium-Dekodierung MIT eingebackener Überhöhung, damit das deck-Terrain exakt so hoch
// steht wie MapLibres überhöhtes Gelände (sonst driften Kamera-Pose und Boden).
// Terrarium: h = r*256 + g + b/256 − 32768. Alles × EXAGGERATION.
const elevationDecoder = {
  rScaler: 256 * EXAGGERATION,
  gScaler: 1 * EXAGGERATION,
  bScaler: EXAGGERATION / 256,
  offset: -32768 * EXAGGERATION,
}

function viewStateOf(map) {
  const c = map.getCenter()
  return { longitude: c.lng, latitude: c.lat, zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() }
}

export function installDeckScene(map, { route = null, stops = [], shadows = false } = {}) {
  // Eigene Leinwand über der (gleich unsichtbaren) MapLibre-Karte. pointer-events: none —
  // die Kamera wird extern gesteuert (kein deck-Controller). Die CSS-Hintergrundfarbe des
  // Canvas ist der HIMMEL: deck lässt oberhalb des Horizonts transparent, dort scheint dieser
  // Verlauf durch — von Tag/Nacht gefärbt, ohne eine eigene Skybox-Geometrie.
  const canvas = document.createElement('canvas')
  canvas.id = 'deck-scene'
  Object.assign(canvas.style, {
    position: 'fixed', inset: '0', width: '100%', height: '100%', zIndex: '1',
    pointerEvents: 'none', display: 'none',
  })
  document.body.appendChild(canvas)
  const setSky = (sky, hor) => { canvas.style.background = `linear-gradient(to bottom, ${sky} 0%, ${sky} 42%, ${hor} 100%)` }
  setSky('#7ab3e0', '#8dbbe2') // Tag-Standard, bis Tag/Nacht übernimmt

  // ── Beleuchtung ───────────────────────────────────────────────────────────────────────
  // Gerichtete Sonne (Volumen der Gebäude über Flächen-Normalen) + kräftiges Ambient (hält den
  // flach beleuchteten Satellitenboden hell). SCHATTEN sind optional (?shadows=1): der Schatten-
  // Pass rendert die Szene pro Frame ein zweites Mal in eine Schattenkarte — der größte Kosten-
  // faktor. Standardmäßig AUS zugunsten flüssiger Performance (und weil geerdete Schatten sonst
  // auch die schwebende Routen-Linie mit-beschatten, was komisch aussah). Ohne Schatten bleibt
  // das Gebäude-Volumen erhalten (Richtungslicht schattiert die Wände weiterhin).
  const withShadow = (props) => (shadows ? { ...props, _shadow: true } : props)
  let ambient = new AmbientLight({ color: [255, 251, 243], intensity: 1.0 })
  let dir = new DirectionalLight(withShadow({ color: [255, 247, 231], intensity: 0.55, direction: sunDir(SUN_AZ, SUN_EL) }))
  const makeLighting = () => {
    const eff = new LightingEffect({ ambientLight: ambient, dirLight: dir })
    if (shadows) eff.shadowColor = [0, 0, 0, 0.26] // weiche, nicht zu harte Schatten
    return eff
  }
  let lighting = makeLighting()
  let lastBr = 1, lastAz = SUN_AZ // Licht nur bei spürbarer Änderung neu bauen

  // ── Gebäude-Datenschicht (gemeinsam mit dem Hybrid) ─────────────────────────────────────
  const roof = createRoofSampler({ onTile: () => { colorVersion++; scheduleBuildings() } })
  const colorCache = new Map()
  const eleCache = new Map()
  const posKey = (ll) => `${Math.round(ll[0] * 1e5)},${Math.round(ll[1] * 1e5)}`
  let buildingFeatures = null
  let colorVersion = 0
  let groundReady = false

  // Szenenhöhe (überhöhtes Terrain) an einem Punkt; Fallback: Höhenprofil × Überhöhung.
  const groundAt = (ll, fallbackEle = 0) => {
    const t = map.queryTerrainElevation(ll)
    return t == null ? fallbackEle * EXAGGERATION : t
  }

  // Vorberechnet, sobald das Terrain abfragbar ist.
  let linePts = null // Route als [lng,lat,z]-Kette
  let spotBase = null // Foto-Wegpunkte {position,label,s,kind}
  function computeGround() {
    if (!route || !route.coords?.length) return
    linePts = route.coords.map((c) => [c[0], c[1], groundAt(c, c[2]) + LINE_LIFT])
    const s0 = pointAt(route, 0)
    spotBase = [{ position: [s0[0], s0[1], groundAt(s0, s0[2]) + SPOT_LIFT], label: '', s: 0, kind: 'start' }]
    stops.forEach((st, i) => {
      const p = pointAt(route, st.s)
      spotBase.push({ position: [p[0], p[1], groundAt(p, p[2]) + SPOT_LIFT], label: String(i + 1), s: st.s, kind: 'stop' })
    })
    groundReady = true
    routeFullInst = routeFull()
    rebuildSpots()
  }

  // ── Layer-Fabriken ──────────────────────────────────────────────────────────────────────
  // TEXTUR-DRAPIERUNG (löst die grobe Bodentextur): Das Höhen-MESH und das Satellitenbild werden
  // ENTKOPPELT — wie in MapLibre. Das TerrainLayer liefert nur noch das (ruhig grobe) Mesh und
  // ist per `operation:'terrain+draw'` das Drape-ZIEL; die scharfe Textur kommt aus einem
  // separaten hochauflösenden Satelliten-TileLayer (bis z18), dessen Kacheln mit `TerrainExtension`
  // als Textur über das Mesh drapiert werden. So ist der Boden im Nahbereich scharf, obwohl das
  // Mesh grob bleibt. `texture` am Terrain ist nur die grobe Basis, bis der Drape geladen ist.
  const terrainLayer = () =>
    new TerrainLayer({
      id: 'terrain',
      minZoom: 0,
      maxZoom: 14, // Mesh darf grob sein (Drape liefert die Schärfe) → leichter
      tileSize: 256,
      meshMaxError: 8,
      maxCacheSize: 600, // Terrain-Kacheln lange vorhalten → Zurück-Scrubben lädt Mesh nicht neu
      elevationDecoder,
      elevationData: TERRARIUM,
      // Grobe Basistextur (z14) als FALLBACK: liegt sofort unter dem Drape, damit der Boden beim
      // Anflug nie ein blaues Loch zeigt, sondern grob-aber-vorhanden ist und dann nachschärft.
      // (Der Drape deckt sie, wo er geladen ist.) Nur EINE zusätzliche grobe Kachel-Ebene — der
      // eigentliche Perf-Gewinn kommt aus dem Korridor-Prewarm, nicht aus dem Weglassen dieser Basis.
      texture: ESRI,
      color: [128, 126, 116], // Notfarbe, falls selbst die Basis noch fehlt
      operation: 'terrain+draw', // Drape-Ziel: andere Layer mit TerrainExtension legen sich darüber
      // Überwiegend Ambient (Satellit ist eine Aufnahme mit eingebranntem Licht), etwas Diffus →
      // Terrain nimmt Licht an (empfängt Schatten, dezenter Relief-Hillshade).
      material: { ambient: 0.95, diffuse: 0.14, shininess: 1, specularColor: [0, 0, 0] },
    })

  // Hochauflösender Satelliten-Drape: TileLayer bis z18, jede Kachel ein BitmapLayer, das per
  // TerrainExtension (Drape-Modus) über das Terrain-Mesh gelegt wird → scharfer Boden im Nahbereich.
  const satDrapeExt = [new TerrainExtension()]
  const satDrape = () =>
    new TileLayer({
      id: 'sat-drape',
      data: ESRI,
      minZoom: 0,
      maxZoom: 17, // ~1,2 m/Pixel im Nahbereich — deutlich schärfer als das z14-Mesh, ¼ der z18-Kacheln
      tileSize: 256,
      maxRequests: 10,
      // Sofort die beste bereits geladene (gröbere) Kachel zeigen und im Hintergrund nachschärfen →
      // kein leeres Loch beim Anflug, sondern ein sanftes Schärfer-Werden.
      refinementStrategy: 'best-available',
      maxCacheSize: 900, // viele Kacheln vorhalten → Zurück-Scrubben lädt den Boden nicht neu
      renderSubLayers: (props) => {
        const { west, south, east, north } = props.tile.bbox
        return new BitmapLayer(props, {
          data: null,
          image: props.data,
          bounds: [west, south, east, north],
          extensions: satDrapeExt, // → wird auf das Terrain-Mesh drapiert
        })
      },
    })

  const buildingLayer = () =>
    new GeoJsonLayer({
      id: 'scene-buildings',
      data: buildingFeatures,
      extruded: true,
      stroked: false,
      filled: true,
      material: { ambient: 0.4, diffuse: 0.7, shininess: 8, specularColor: [22, 22, 26] },
      getElevation: (f) => {
        const h = heightOf(f)
        const ll = f.__c
        if (!ll) return h
        const k = posKey(ll)
        let base = eleCache.get(k)
        if (base == null) {
          const t = map.queryTerrainElevation(ll)
          base = t == null ? 0 : t
          if (t != null) eleCache.set(k, base)
        }
        return base + h
      },
      getFillColor: (f) => {
        const ll = f.__c
        if (!ll) return fallbackColor(f)
        const k = posKey(ll)
        const cached = colorCache.get(k)
        if (cached) return cached
        const rgb = roof.sampleSync(ll[0], ll[1])
        if (!rgb) return fallbackColor(f)
        const col = toBuildingColor(rgb)
        colorCache.set(k, col)
        return col
      },
      updateTriggers: { getFillColor: colorVersion },
      parameters: { depthTest: true },
    })

  // Streckenvorschau: gepunktete helle Linie der GESAMTstrecke (wie MapLibres route-full) →
  // man sieht immer, wohin die Reise noch geht.
  const routeFull = () =>
    new PathLayer({
      id: 'route-full',
      data: [linePts],
      getPath: (d) => d,
      getColor: [255, 255, 255, 150],
      getWidth: 2,
      widthUnits: 'pixels',
      widthMinPixels: 1.5,
      getDashArray: [2, 4],
      dashJustified: true,
      extensions: [new PathStyleExtension({ dash: true })],
      parameters: { depthTest: true, depthMask: false },
    })

  // Gefahrener Teil: weicher Bernstein-Schein + kräftige Linie, die EXAKT bis zum Fahrer reicht
  // (tipPos als letzter Stützpunkt) + Koralle-Punkt an der Spitze = klare „hier bin ich"-Marke.
  let pastIdx = 0
  let tipPos = null // exakte Fahrerposition [lng,lat,z]
  const pastPath = () => {
    const pts = linePts.slice(0, Math.max(1, pastIdx + 1))
    if (tipPos) pts.push(tipPos)
    return pts.length >= 2 ? pts : [pts[0], pts[0]]
  }
  const routeGlow = () =>
    new PathLayer({
      id: 'route-glow',
      data: [pastPath()],
      getPath: (d) => d,
      getColor: [...AMBER, 110],
      getWidth: 11,
      widthUnits: 'pixels',
      capRounded: true,
      jointRounded: true,
      updateTriggers: { data: pastIdx },
      parameters: { depthTest: true, depthMask: false },
    })
  const routePast = () =>
    new PathLayer({
      id: 'route-past',
      data: [pastPath()],
      getPath: (d) => d,
      getColor: [...AMBER, 255],
      getWidth: 4.6,
      widthUnits: 'pixels',
      widthMinPixels: 2.5,
      capRounded: true,
      jointRounded: true,
      updateTriggers: { data: pastIdx },
      parameters: { depthTest: true, depthMask: false },
    })
  const routeTip = () =>
    new ScatterplotLayer({
      id: 'route-tip',
      data: tipPos ? [tipPos] : [],
      billboard: true,
      getPosition: (d) => d,
      getRadius: 5,
      radiusUnits: 'pixels',
      getFillColor: [...CORAL, 255],
      stroked: true,
      getLineColor: [255, 255, 255, 220],
      lineWidthUnits: 'pixels',
      getLineWidth: 1.5,
      updateTriggers: { getPosition: pastIdx },
      parameters: { depthTest: false },
    })

  // Foto-Wegpunkte: gefüllter Kreis + Nummer, immer zur Kamera gedreht (billboard), Zustands-
  // farben wie im MapLibre-Pfad (erledigt = amber, nächster = amber umrandet, sonst creme).
  let doneCount = -1 // zuletzt gerenderter Erledigt-Stand (rebuild nur bei Änderung)
  let curS = 0
  function spotState(sp) {
    if (sp.kind === 'start') return { fill: [255, 255, 255], line: [...INK, 140], lw: 3, r: 6 }
    const done = sp.s <= curS + 1
    const next = !done && spotBase.filter((x) => x.kind === 'stop' && x.s > curS + 1)[0]?.s === sp.s
    return {
      fill: done ? AMBER : CREAM,
      line: next ? AMBER : done ? [255, 255, 255, 190] : [...INK, 110],
      lw: next ? 3 : 1.5,
      r: 12,
    }
  }
  const spotCircles = () =>
    new ScatterplotLayer({
      id: 'spot-circles',
      data: spotBase,
      billboard: true,
      getPosition: (d) => d.position,
      getRadius: (d) => spotState(d).r,
      radiusUnits: 'pixels',
      getFillColor: (d) => spotState(d).fill,
      stroked: true,
      getLineColor: (d) => spotState(d).line,
      lineWidthUnits: 'pixels',
      getLineWidth: (d) => spotState(d).lw,
      updateTriggers: { getFillColor: doneCount, getLineColor: doneCount, getLineWidth: doneCount },
      parameters: { depthTest: false }, // Marker nie von Gebäuden verdeckt (wie die MapLibre-Zahlenkreise)
    })
  const spotLabels = () =>
    new TextLayer({
      id: 'spot-labels',
      data: spotBase.filter((d) => d.label),
      billboard: true,
      getPosition: (d) => d.position,
      getText: (d) => d.label,
      getSize: 13,
      sizeUnits: 'pixels',
      getColor: [...INK, 255],
      fontWeight: 700,
      getTextAnchor: 'middle',
      getAlignmentBaseline: 'center',
      parameters: { depthTest: false },
    })

  // ── Gecachte Layer-Instanzen (Perf: nur Nötiges neu bauen) ──────────────────────────────
  const terrainInst = terrainLayer()
  const satInst = satDrape()
  let buildingsInst = null
  let routeFullInst = null
  let routeGlowInst = null, routePastInst = null, routeTipInst = null
  let spotCircInst = null, spotLabInst = null

  function collectLayers() {
    const arr = [terrainInst, satInst]
    if (buildingsInst) arr.push(buildingsInst)
    if (routeFullInst) arr.push(routeFullInst)
    if (routeGlowInst) arr.push(routeGlowInst, routePastInst, routeTipInst)
    if (spotCircInst) arr.push(spotCircInst, spotLabInst)
    return arr
  }
  const push = () => { if (active) deck.setProps({ layers: collectLayers() }) }

  function rebuildBuildings() { buildingsInst = buildingLayer(); push() }
  function rebuildRoute() {
    if (!linePts) return
    routeGlowInst = routeGlow(); routePastInst = routePast(); routeTipInst = routeTip(); push()
  }
  function rebuildSpots() {
    if (!spotBase) return
    doneCount = spotBase.filter((sp) => sp.kind === 'stop' && sp.s <= curS + 1).length
    spotCircInst = spotCircles(); spotLabInst = spotLabels(); push()
  }

  // ── Deck-Instanz ────────────────────────────────────────────────────────────────────────
  const deck = new Deck({
    canvas,
    views: new MapView({ repeat: false, maxPitch: 85 }),
    controller: false,
    initialViewState: viewStateOf(map),
    effects: [lighting],
    layers: [],
  })

  let active = false

  // Nachzügler-Satellitenkacheln nur die Gebäude neu einfärben (gedrosselt).
  let buildingsScheduled = false
  function scheduleBuildings() {
    if (buildingsScheduled) return
    buildingsScheduled = true
    setTimeout(() => { buildingsScheduled = false; if (buildingFeatures) rebuildBuildings() }, 300)
  }

  function whenTerrainReady() {
    if (map.queryTerrainElevation(map.getCenter()) != null) computeGround()
    else map.once('idle', whenTerrainReady)
  }

  roof.prefetch(route, () => { if (buildingFeatures) rebuildBuildings() })
  loadCorridorBuildings(route).then((feats) => { if (feats) { buildingFeatures = feats; rebuildBuildings() } })

  // ── Korridor-Prewarm (Perf): Kacheln der Kamerafahrt schon im Menü in den HTTP-Cache holen,
  // damit sie während der Fahrt sofort da sind (kein Nachladen/Poppen). Terrarium z14 = das Höhen-
  // Mesh; Esri z14 = die grobe Boden-BASIS (Terrain-Fallback + garantiert kein blaues Loch). Die
  // feineren Stufen schärfen via best-available darüber nach: Esri z16 wärmt der Dachfarben-Sampler
  // bereits mit, z17 der Look-ahead-Prewarm während der Fahrt.
  warmTiles(route, TERRARIUM, 14, { radius: 1, budget: 120, delay: 500 })
  warmTiles(route, ESRI, 14, { radius: 1, budget: 120, delay: 900 })

  // Look-ahead-Prewarm: die scharfen Nahkacheln (z17) ein Stück VOR dem Fahrer schon in den
  // Cache holen, damit sie da sind, wenn die Kamera hinkommt — der Menü-Prewarm deckt nur die
  // mittelscharfe Basis (z14/z15), nicht die feinste Stufe entlang der ganzen langen Route.
  // Distanz-gedrosselt (alle ~180 m), damit es die laufende Sicht nicht überlädt.
  let lastWarmS = -1e9
  function lookAheadWarm(s) {
    if (Math.abs(s - lastWarmS) < 180) return
    lastWarmS = s
    const ahead = pointAt(route, Math.min(route.total, s + 350))
    warmTiles({ coords: [ahead] }, ESRI, 17, { radius: 2, budget: 30, delay: 0, concurrency: 4 })
  }

  // setProgress: gefahrenen Trace-Anteil + Fahrer-Spitze setzen (gedrosselt).
  let lastProgT = 0
  function setProgress(s, pos) {
    curS = s
    lookAheadWarm(s)
    if (!linePts) return
    const total = route.total || 1
    const idx = Math.min(linePts.length - 1, Math.max(0, Math.floor((s / total) * (linePts.length - 1))))
    if (pos) tipPos = [pos[0], pos[1], groundAt(pos, pos[2]) + LINE_LIFT]
    const now = performance.now()
    if (idx === pastIdx && now - lastProgT < 90) { return } // Spitze folgt ~11×/s
    lastProgT = now
    pastIdx = idx
    rebuildRoute()
    // Wegpunkt-Zustände nur neu bauen, wenn ein Stopp gekippt ist (selten, nicht pro Frame).
    const nowDone = spotBase ? spotBase.filter((sp) => sp.kind === 'stop' && sp.s <= s + 1).length : 0
    if (nowDone !== doneCount) rebuildSpots()
  }

  return {
    setCamera() { if (active) deck.setProps({ viewState: viewStateOf(map) }) },
    setProgress,
    enable() {
      active = true
      canvas.style.display = ''
      map.getCanvas().style.visibility = 'hidden' // MapLibre-Bild aus, Engine + DOM-Marker laufen weiter
      whenTerrainReady()
      deck.setProps({ viewState: viewStateOf(map), layers: collectLayers(), effects: [lighting] })
    },
    disable() {
      active = false
      canvas.style.display = 'none'
      map.getCanvas().style.visibility = ''
    },
    // Tag/Nacht: Sonnenrichtung, Lichtstärke/-farbe und Himmel aus den daynight-Parametern +
    // Sonnenstand setzen. Der Himmel (CSS) folgt jedem Update; das Licht (teure Schatten-
    // Framebuffer) wird nur bei spürbarer Änderung neu erzeugt.
    applyDayNight(p, sun) {
      setSky(p.sky, p.hor)
      const az = sun.azimuth
      if (Math.abs(p.br - lastBr) < 0.04 && Math.abs(az - lastAz) < 3) return
      lastBr = p.br; lastAz = az
      const el = Math.max(3, Math.min(85, sun.altitude))
      const lc = hexRgb(p.lc)
      ambient = new AmbientLight({ color: lc, intensity: 0.35 + 0.75 * p.br })
      dir = new DirectionalLight(withShadow({ color: lc, intensity: 0.15 + 0.7 * p.br, direction: sunDir(az, el) }))
      lighting = makeLighting()
      if (active) deck.setProps({ effects: [lighting] })
    },
    setNight(on) {
      ambient = new AmbientLight({ color: on ? [190, 205, 235] : [255, 251, 243], intensity: on ? 0.42 : 1.0 })
      dir = new DirectionalLight(withShadow({ color: on ? [170, 190, 225] : [255, 247, 231], intensity: on ? 0.12 : 0.55, direction: dir.direction }))
      lighting = makeLighting()
      setSky(on ? '#0a1424' : '#7ab3e0', on ? '#141f33' : '#8dbbe2')
      if (active) deck.setProps({ effects: [lighting] })
    },
    remove() {
      deck.finalize()
      canvas.remove()
      map.getCanvas().style.visibility = ''
    },
    deck,
  }
}

// '#rrggbb' → [r,g,b] oder 'rgb(r,g,b)' → [r,g,b] (daynight liefert beide Formen)
function hexRgb(c) {
  if (c[0] === '#') return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]
  const m = c.match(/\d+/g)
  return m ? [+m[0], +m[1], +m[2]] : [255, 247, 231]
}
