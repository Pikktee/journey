// Satelliten-Dachfarbe: Das Satellitenbild zeigt die echten Dächer von oben. Sobald
// eine Gebäude-Kachel lädt, sampeln wir für jedes Gebäude die Farbe am Zentroid aus
// der Esri-Kachel und setzen sie per feature-state {color} — die Baukörper tragen
// dann echte Luftbild-Töne statt einer erfundenen Palette und verschmelzen mit dem
// Untergrund. Bei Nacht ungenutzt (Tagaufnahme → dunkle Palette). Fällt das Sampling
// aus (offline/CORS), bleibt es bei der Fallback-Palette.
//
// WICHTIG — Luminanz-Normalisierung: In den OpenFreeMap-Kacheln überlappen sich
// ~15 % der OSM-Polygone (Umriss + building:parts, hide_3d fehlt) und flimmern durch
// koplanares Z-Fighting. Geometrisch ist das clientseitig nicht sauber lösbar
// (fill-extrusion hat keinen Depth-Bias; das Nullhöhen-Ausblenden macht ein Polygon
// nur flach statt unsichtbar). Der verlässliche Weg ist, das Flimmern UNSICHTBAR zu
// machen: Das Auge nimmt Helligkeits-Flimmern stark wahr, Farbton-Flimmern kaum.
// Deshalb ziehen wir jede gesampelte Farbe auf eine KONSTANTE Luminanz (Farbton/
// Sättigung vom echten Dach, Helligkeit fix) — dann kippt der Z-Fight nur im Farbton
// und ist praktisch nicht sichtbar. Echte Helligkeits-Vielfalt/Schatten kommt erst
// mit dem geplanten deck.gl-Renderer (der die Geometrie sauber deduplizieren kann).
//
// ENTSÄTTIGUNG (SAT): Manche echten Dächer sind sehr farbstark und wirken auf den
// Baukörpern penetrant. Wir mischen die (luminanz-normalisierte) Farbe zur neutralen
// Graustufe gleicher Helligkeit hin — das dämpft die Ausreißer, hält aber einen Rest
// echter Farbe. Weil das Ziel-Grau dieselbe Luminanz hat, bleibt die Flimmer-Deckung
// erhalten. Zur Laufzeit justierbar über den Rückgabewert (__j.buildings.setSaturation).

const D2R = Math.PI / 180
const SAT_Z = 18 // hoher Zoom = ein Dach deckt viele Pixel, stabile Farbe
const TSIZE = 256
const TARGET_LUMA = 142 // konstante Ziel-Helligkeit (wie die Fallback-Palette BLD_DAY)
const SAT_URL = (x, y) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${SAT_Z}/${y}/${x}`

function tileXY(lng, lat) {
  const n = 2 ** SAT_Z
  const x = ((lng + 180) / 360) * n
  const y = ((1 - Math.log(Math.tan(lat * D2R) + 1 / Math.cos(lat * D2R)) / Math.PI) / 2) * n
  return [x, y]
}

// Zentroid (bbox-Mitte) des äußeren Rings, lng/lat — querySourceFeatures liefert
// GeoJSON in lng/lat (im MapLibre-Quellcode verifiziert).
function centroid(f) {
  const g = f.geometry
  if (!g) return null
  const ring = g.type === 'Polygon' ? g.coordinates[0] : g.type === 'MultiPolygon' ? g.coordinates[0]?.[0] : null
  if (!ring || ring.length < 3) return null
  let a = 1e9, b = 1e9, c = -1e9, d = -1e9
  for (const p of ring) { if (p[0] < a) a = p[0]; if (p[1] < b) b = p[1]; if (p[0] > c) c = p[0]; if (p[1] > d) d = p[1] }
  return [(a + c) / 2, (b + d) / 2]
}

export function installBuildingEnhancer(map, { source = 'buildings', sourceLayer = 'building', enabled = true, saturation = 0.5 } = {}) {
  if (!enabled) return null
  let sat = saturation
  const decided = new Set()
  const samples = new Map() // id → [r,g,b] roh (gemittelt), damit sat live neu anwendbar ist

  // Satellitenkacheln cachen (Speicher gedeckelt) und Pixel samplen
  const tileCache = new Map()
  function fetchTile(tx, ty) {
    const key = `${tx}/${ty}`
    if (!tileCache.has(key)) {
      const p = (async () => {
        const res = await fetch(SAT_URL(tx, ty))
        if (!res.ok) return null
        const bmp = await createImageBitmap(await res.blob())
        const cv = document.createElement('canvas')
        cv.width = cv.height = TSIZE
        const ctx = cv.getContext('2d', { willReadFrequently: true })
        ctx.drawImage(bmp, 0, 0)
        return ctx.getImageData(0, 0, TSIZE, TSIZE).data
      })().catch(() => null)
      tileCache.set(key, p)
      if (tileCache.size > 72) tileCache.delete(tileCache.keys().next().value) // je ~256 KB
    }
    return tileCache.get(key)
  }

  // Rohe Dachfarbe (3×3-Mittel) am Punkt — ohne Normalisierung
  async function sampleAt(lng, lat) {
    const [x, y] = tileXY(lng, lat)
    const data = await fetchTile(Math.floor(x), Math.floor(y))
    if (!data) return null
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

  // Roh-RGB → Hex: erst auf konstante Luminanz (Helligkeit fix → flimmer-sicher),
  // dann zur Graustufe gleicher Helligkeit hin entsättigen (dämpft penetrante Dächer).
  const clampHex = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  function hexFrom([r, g, b]) {
    const luma = 0.299 * r + 0.587 * g + 0.114 * b
    const k = TARGET_LUMA / Math.max(1, luma)
    const ch = (v) => {
      const scaled = v * k // auf Ziel-Luminanz
      return clampHex(TARGET_LUMA + (scaled - TARGET_LUMA) * sat) // zur Graustufe hin mischen
    }
    return `#${ch(r)}${ch(g)}${ch(b)}`
  }

  function processNew() {
    let feats
    try { feats = map.querySourceFeatures(source, { sourceLayer }) } catch { return }
    for (const f of feats) {
      const id = f.id
      if (id == null || decided.has(id)) continue
      decided.add(id)
      const c = centroid(f)
      if (!c) continue
      sampleAt(c[0], c[1]).then((rgb) => {
        if (!rgb) return
        samples.set(id, rgb)
        map.setFeatureState({ source, sourceLayer, id }, { color: hexFrom(rgb) })
      })
    }
  }

  // Gedrosselt: sourcedata feuert oft; ein Lauf alle ~160 ms reicht
  let scheduled = false
  const schedule = () => {
    if (scheduled) return
    scheduled = true
    setTimeout(() => { scheduled = false; processNew() }, 160)
  }
  map.on('sourcedata', (e) => { if (e.sourceId === source && e.isSourceLoaded) schedule() })
  schedule()

  return {
    // Farbstärke live justieren (Konsole: __j.buildings.setSaturation(0.35)).
    // 0 = neutrales Grau, 1 = volle gesampelte Farbe.
    setSaturation(s) {
      sat = s
      for (const [id, rgb] of samples) map.setFeatureState({ source, sourceLayer, id }, { color: hexFrom(rgb) })
    },
  }
}
