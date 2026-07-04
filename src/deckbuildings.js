// HYBRID-Renderer: MapLibre behält Boden/Terrain/Himmel/Route/Fake-Schatten/Tag-Nacht,
// deck.gl rendert NUR die Gebäude — interleaved (teilt MapLibres Tiefenpuffer), mit
// gerichteter Beleuchtung fürs Volumen. Aktiv über Flag ?deck=1 (src/main.js).
//
// ── Leitidee: STATISCHER Korridor statt Streaming ────────────────────────────────────
// Wir KENNEN die Kamerafahrt, also den Korridor. Deshalb laden wir ALLE Gebäude des
// Korridors EINMAL vorab (z14-Vektorkacheln → GeoJSON), werfen deckungsgleiche Duplikate
// raus und rendern sie als EINE statische GeoJsonLayer. Nichts lädt mehr während der Fahrt
// nach (kein Poppen), keine Duplikate mehr (kein Flimmern), nur einmal tesseliert (flüssig).
// Die Datenschicht (Korridor laden, Dedup, Dachfarbe) liegt gemeinsam in buildingdata.js.
//
// ── Farbe & Platzierung ──────────────────────────────────────────────────────────────
// Farbe = echte Dachfarbe aus dem Esri-Satellitenpixel am Gebäude-Zentroid, EINMAL aufgelöst
// und eingefroren (colorCache). Höhe = (überhöhte) Terrainhöhe am Zentroid + Gebäudehöhe;
// wir extrudieren von 0 bis dorthin und lassen den Teil unter Terrain vom interleaved-
// Tiefentest verdecken → Haus sitzt exakt auf dem Gelände, auch alpin.

import { MapboxOverlay } from '@deck.gl/mapbox'
import { GeoJsonLayer } from '@deck.gl/layers'
import { LightingEffect, AmbientLight, DirectionalLight } from '@deck.gl/core'
import {
  heightOf, sunDir, fallbackColor, toBuildingColor,
  loadCorridorBuildings, createRoofSampler,
} from './buildingdata.js'

// Fern-LOD mit WEICHER Blende: In der Totalen (Menü-Übersicht) bricht die Tiefenpuffer-Präzision
// zusammen → unvermeidbares Flimmern; dort braucht man die Detail-Gebäude ohnehin nicht. Statt
// hart aus/ein zu schalten, faden die Gebäude über einen breiten Zoombereich langsam ein: bei
// FAR_ZOOM unsichtbar (0), bei FAR_ZOOM+FADE_RANGE voll (1), dazwischen linear.
const FAR_ZOOM = 12.5
const FADE_RANGE = 2.5

// Sonnenstand = Fake-Schatten-Richtung (shadows.js: az 220, el 45), damit deck-Schattierung
// und Bodenschatten in dieselbe Richtung zeigen.
const SUN_AZ = 220
const SUN_EL = 45

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
  const fadeAt = (z) => Math.round(Math.max(0, Math.min(1, (z - FAR_ZOOM) / FADE_RANGE)) * 10) / 10
  let farOpacity = fadeAt(map.getZoom()) // Fern-Blende: 0 in der Totalen, 1 nah

  // Eingefrorene Ergebnisse pro Gebäude (Schlüssel = gerundetes Zentroid): Farbe/Höhe GENAU
  // EINMAL aufgelöst und behalten → kein Flimmern, kein wiederholtes Neurechnen.
  const colorCache = new Map()
  const eleCache = new Map()
  const posKey = (ll) => `${Math.round(ll[0] * 1e5)},${Math.round(ll[1] * 1e5)}`

  // Satelliten-Dachfarben-Sampler (gemeinsam mit der Szene). Neu eintreffende Kacheln lösen
  // gedrosseltes Neu-Einfärben aus.
  const roof = createRoofSampler({ onTile: () => { colorVersion++; scheduleRecolor() } })

  // ── Die eine statische Gebäude-Schicht ───────────────────────────────────────────────
  function buildStaticLayer() {
    return new GeoJsonLayer({
      id: 'deck-buildings',
      data: buildingFeatures,
      // Gebäude UNTER die Photospot-Marker → die Zahlenkreise liegen immer oben.
      beforeId: 'start-dot',
      opacity: farOpacity,
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
        const rgb = roof.sampleSync(ll[0], ll[1])
        if (!rgb) return fallbackColor(f) // Kachel fehlt noch → Fallback, NICHT einfrieren
        const col = toBuildingColor(rgb)
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
    // deck EINMAL beim Laden (in der ruhigen Intro-Phase) statt erst beim Zoom-in.
    const show = visible && buildingFeatures
    overlay.setProps({ layers: show ? [buildStaticLayer()] : [] })
    map.triggerRepaint() // Frame anfordern → Geometrie JETZT hochladen, auch im idle-Menü
  }

  // Fern-LOD-Blende: Opazität aus dem Zoom ableiten und weich ein-/ausfaden (0,1-Stufen).
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

  // Vorladen: Satellitenkacheln + Korridor-Gebäude. Ein sauberer Farb-Einlauf, wenn alles da ist.
  roof.prefetch(route, () => refresh())
  loadCorridorBuildings(route).then((feats) => { if (feats) { buildingFeatures = feats; refresh() } })

  return {
    overlay,
    _dbg: () => ({ tiles: roof.size(), colors: colorCache.size, buildings: buildingFeatures?.length ?? 0, colorVersion }),
    setVisible(on) { visible = on; refresh() },
    isVisible() { return visible },
    setLift(v) { lift = v; refresh() },
    setSun(az, el) { sun.direction = sunDir(az, el); overlay.setProps({ effects: [new LightingEffect({ ambient, sun })] }) },
    // Tag/Nacht: nachts moderat dimmen + kühl färben — dunkler als der Boden, aber klar sichtbar.
    setNight(on) {
      ambient = new AmbientLight({ color: on ? [190, 205, 235] : [255, 251, 243], intensity: on ? 0.5 : 0.72 })
      sun = new DirectionalLight({ color: on ? [170, 190, 225] : [255, 247, 231], intensity: on ? 0.58 : 1.05, direction: sun.direction })
      overlay.setProps({ effects: [new LightingEffect({ ambient, sun })] })
    },
    remove() { map.removeControl(overlay) },
  }
}
