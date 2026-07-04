// Geerdete Gebäudeschatten OHNE zweiten Renderer. Der deck.gl-Spike (deckbuildings.js)
// hat gezeigt: echte Schatten fielen nur auf deck.gl-Geometrie, nicht auf MapLibres
// Satellitenboden — der eigentliche Effekt (Schatten auf Straße/Wasser) bräuchte einen
// Renderer-Wechsel. Hier der billige Weg, der den Boden mitnimmt: Wir BERECHNEN pro
// Gebäude sein Wurf-Schatten-Polygon und legen es als dunkle Bodenfläche unter die
// Häuser. Weil es eine flache fill-Fläche ist, drapiert MapLibre sie aufs Terrain —
// funktioniert also auch im Bergland (wo deck.gl versank).
//
// KURZ HALTEN (maxLen): Das Satellitenbild trägt bereits eingebrannte Schatten (Luft-
// aufnahme zu einem festen Sonnenstand). Ein langer synthetischer Wurfschatten legt
// einen zweiten, oft anders gerichteten darüber → unruhig. Deshalb per Default ein
// kurzer, erdender Kontakt-Saum am Gebäudefuß statt eines langen Wurfs.
//
// Geometrie: Ein Schlagschatten ist der Grundriss, in Gegen-Sonnen-Richtung um
// d = Höhe / tan(Sonnenhöhe) verschoben (gedeckelt auf maxLen). Für einen konvexen
// Grundriss ist die überstrichene Fläche exakt die konvexe Hülle aus Grundriss ∪
// verschobener Kopie. Der Teil UNTER dem Haus ist vom Baukörper verdeckt — sichtbar
// ist nur der über den Grundriss hinausragende Saum.
//
// PERFORMANCE: NICHT über die ganze Fahrt akkumulieren (das wuchs unbegrenzt und ließ
// jedes setData die komplette Sammlung neu tessellieren → zunehmendes Ruckeln). Statt-
// dessen pro Lauf nur die aktuell sichtbaren Features (querySourceFeatures ist auf den
// Viewport begrenzt) und nur dann neu setzen, wenn sich der Gebäudesatz geändert hat.

const D2R = Math.PI / 180

// Konvexe Hülle (Andrew's monotone chain), Punkte [lng,lat] → Ring [lng,lat]
function hull(pts) {
  if (pts.length < 3) return pts
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower = []
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop()
    lower.push(q)
  }
  const upper = []
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop()
    upper.push(q)
  }
  lower.pop()
  upper.pop()
  return lower.concat(upper)
}

function outerRing(f) {
  const g = f.geometry
  if (!g) return null
  const r = g.type === 'Polygon' ? g.coordinates[0] : g.type === 'MultiPolygon' ? g.coordinates[0]?.[0] : null
  return r && r.length >= 3 ? r : null
}

export function installBuildingShadows(
  map,
  { azimuth = 220, elevation = 45, opacity = 0.28, maxLen = 16, source = 'buildings', sourceLayer = 'building' } = {}
) {
  // Sonne steht im Azimut `azimuth` (Grad, 0=N/90=O) → Schatten fällt in die
  // Gegenrichtung. Länge pro Höhenmeter = 1/tan(Sonnenhöhe), hart auf maxLen gedeckelt.
  let shadowAz = (azimuth + 180) * D2R
  let lenPerM = 1 / Math.tan(elevation * D2R)
  let cap = maxLen

  map.addSource('building-shadows', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  map.addLayer(
    {
      id: 'building-shadows',
      type: 'fill',
      source: 'building-shadows',
      paint: { 'fill-color': '#0d1526', 'fill-opacity': opacity }, // kühles Dunkelblau, kein hartes Schwarz
    },
    map.getLayer('buildings-3d') ? 'buildings-3d' : undefined // unter die Baukörper, über den Satelliten
  )

  function shadowFor(f) {
    const ring = outerRing(f)
    if (!ring) return null
    const h = Math.min(f.properties.render_height ?? 8, 250)
    const len = Math.min(h * lenPerM, cap) // Meter, gedeckelt
    const lat = ring[0][1]
    const de = (Math.sin(shadowAz) * len) / (111320 * Math.cos(lat * D2R)) // Längengrad-Versatz
    const dn = (Math.cos(shadowAz) * len) / 111320 // Breitengrad-Versatz
    const pts = []
    for (const p of ring) {
      pts.push([p[0], p[1]])
      pts.push([p[0] + de, p[1] + dn])
    }
    return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [hull(pts)] } }
  }

  // Nur den aktuell sichtbaren Gebäudesatz zeichnen; neu setzen nur bei Änderung.
  let prevIds = new Set()
  function rebuild(force = false) {
    let src
    try {
      src = map.querySourceFeatures(source, { sourceLayer })
    } catch {
      return
    }
    const byId = new Map()
    for (const f of src) if (f.id != null) byId.set(f.id, f)
    if (!force) {
      let same = byId.size === prevIds.size
      if (same) for (const id of byId.keys()) if (!prevIds.has(id)) { same = false; break }
      if (same) return
    }
    prevIds = new Set(byId.keys())
    const features = []
    for (const f of byId.values()) {
      const s = shadowFor(f)
      if (s) features.push(s)
    }
    map.getSource('building-shadows')?.setData({ type: 'FeatureCollection', features })
  }

  // sourcedata feuert oft → auf ~160 ms drosseln (wie buildings.js)
  let scheduled = false
  const schedule = () => {
    if (scheduled) return
    scheduled = true
    setTimeout(() => {
      scheduled = false
      rebuild()
    }, 160)
  }
  map.on('sourcedata', (e) => {
    if (e.sourceId === source && e.isSourceLoaded) schedule()
  })
  schedule()

  return {
    // Live-Regler (Konsole: __j.shadows.*)
    setSun(az, el) {
      shadowAz = (az + 180) * D2R
      lenPerM = 1 / Math.tan(el * D2R)
      rebuild(true)
    },
    setMaxLen(m) {
      cap = m
      rebuild(true)
    },
    setOpacity(o) {
      map.setPaintProperty('building-shadows', 'fill-opacity', o)
    },
    setVisible(on) {
      map.setLayoutProperty('building-shadows', 'visibility', on ? 'visible' : 'none')
    },
  }
}
