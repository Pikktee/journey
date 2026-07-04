// LEICHTER Dächer-Renderer: ein Three.js-Custom-Layer ÜBER MapLibre (CustomLayerInterface),
// der die Gebäude des Korridors EINMAL als statisches Mesh baut — mit prozeduralen Dächern
// (Giebel/Walm aus der orientierten Bounding-Box), FASSADEN-TEXTUR (Fensterreihen), echter
// Dachfarbe aus dem Satellitenbild und EINGEBACKENEM Schräglicht + Boden-AO (pro Fläche/Vertex
// eine Helligkeit → wirkt 3D, ganz ohne Runtime-Licht). MapLibre rendert weiter Boden/Satellit/
// Route; der flache fill-extrusion-Layer wird ausgeblendet. Statische Geometrie, zwei Draws →
// kein Streaming, weckt den Lüfter nicht.
//
// Warum so: MapLibres fill-extrusion kann nur flache, einfarbige Klötze. „Nicht-Lego" heißt drei
// Dinge — (1) Fassaden statt Farbflächen (Textur), (2) Farben, die zur Umgebung passen (Satelliten-
// Dachfarbe), (3) Form + Erdung (Walm/Giebel, Traufe, Boden-AO). Der schwere Weg (Google-3D-
// Fotoscan) trieb den Lüfter hoch; dieser Weg ist bewusst leicht.
//
// Anm.: Ein Foto-Dach-Ansatz (echtes Luftbild als Dachtextur, z18-Atlas) wurde erprobt und wieder
// verworfen — bei langen Routen (~1200 z18-Kacheln) skaliert der Atlas nicht, die Zellen werden zu
// grob und der Gewinn über die gesampelte Dachfarbe ist marginal. Der nächste echte Hebel sind
// bessere DATEN (Overture: echte Dachformen/Höhen), nicht höher aufgelöste Pixel.
//
// Präzision: MapLibre-Mercator-Koordinaten sind ~0,5 groß → in float32 würden Gebäude auf ~1 m
// zittern. Deshalb liegen die Vertices RELATIV zum Korridor-Ursprung (klein, float32-sicher); die
// Ursprungs-Verschiebung steckt in der (in float64 gerechneten) Projektionsmatrix.

import * as THREE from 'three'
import maplibregl from 'maplibre-gl'
import { loadCorridorBuildings, heightOf, createRoofSampler } from './buildingdata.js'

const DEG = Math.PI / 180

// Regionale Bau-Stile: Wandton, Dach-Palette (Fallback, solange Satellit fehlt), Dachneigung,
// Fensterachsen-/Geschossmaß (steuert die Fassadentextur). „Konstruktionen, die zur Region passen."
const STYLES = {
  // Nordisch: gedeckte Putzwände, Terrakotta/Kupfergrün/Schiefer-Dächer, mäßig steil, enge Achsen.
  nordic: {
    wall: [206, 196, 182],
    roofs: [[156, 78, 54], [96, 112, 92], [74, 76, 82], [126, 90, 66], [110, 68, 58]],
    pitch: 0.62, minRoof: 2.2, maxRoof: 8, bay: 4.6, floor: 3.5,
  },
  // Alpin: Holz-/Steinwände, breite flache Holzschindel-Dächer mit viel Überstand, breite Achsen.
  alpine: {
    wall: [188, 170, 150],
    roofs: [[92, 74, 60], [110, 96, 82], [78, 66, 56], [120, 104, 86]],
    pitch: 0.5, minRoof: 2.5, maxRoof: 9, bay: 5.0, floor: 3.4, eave: 0.7,
  },
  default: {
    wall: [198, 190, 178],
    roofs: [[150, 92, 70], [96, 104, 96], [84, 84, 88]],
    pitch: 0.55, minRoof: 2, maxRoof: 7.5, bay: 4.6, floor: 3.5,
  },
}

// Eingebackenes Schräglicht (lokales ENU: x=Ost, y=Nord, z=oben). Von NW, mittelhoch.
const LIGHT = (() => {
  const az = 215 * DEG, el = 45 * DEG
  const x = Math.sin(az) * Math.cos(el), y = Math.cos(az) * Math.cos(el), z = Math.sin(el)
  const l = Math.hypot(x, y, z)
  return [x / l, y / l, z / l]
})()
// Weiches Schräglicht: hoher Grundanteil, wenig Richtungskontrast → die Häuser wirken nicht wie
// hart beleuchtete CGI-Klötze auf dem Foto, sondern flach/fotografisch, fügen sich ins Satellitenbild.
const AMBIENT = 0.62
const DIFFUSE = 0.44
const AO_BASE = 0.8   // Boden-Kontaktverdunklung (Wandfuß, dezent) → erdet, ohne zu klotzen
const AO_TOP = 1.0
const EAVE_DEFAULT = 0.3 // Dachüberstand in Metern (Traufe) — klein halten, sonst klaffen Lücken

const clamp255 = (v) => Math.max(0, Math.min(255, v)) / 255

// 4×4-Matrixmultiplikation (spaltenweise, wie WebGL/MapLibre) in float64 — wichtig für Präzision.
// Schreibt in den übergebenen Puffer o (allokationsfrei, da pro Frame aufgerufen).
function mat4mul(a, b, o) {
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]
  }
  return o
}

function outerRing(f) {
  const g = f.geometry
  if (!g) return null
  return g.type === 'Polygon' ? g.coordinates[0] : g.type === 'MultiPolygon' ? g.coordinates[0]?.[0] : null
}

// Orientierte Bounding-Box eines Rings (lokale Meter) via PCA — für die Dachform (Firstachse).
function obb(ptsM) {
  const n = ptsM.length
  let mx = 0, my = 0
  for (const p of ptsM) { mx += p[0]; my += p[1] }
  mx /= n; my /= n
  let sxx = 0, sxy = 0, syy = 0
  for (const p of ptsM) { const dx = p[0] - mx, dy = p[1] - my; sxx += dx * dx; sxy += dx * dy; syy += dy * dy }
  // Haupt-Eigenvektor der 2×2-Kovarianz
  const tr = sxx + syy, det = sxx * syy - sxy * sxy
  const l1 = tr / 2 + Math.sqrt(Math.max(0, tr * tr / 4 - det))
  let ux, uy
  if (Math.abs(sxy) > 1e-9) { ux = l1 - syy; uy = sxy } else { ux = sxx >= syy ? 1 : 0; uy = sxx >= syy ? 0 : 1 }
  const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul
  const vx = -uy, vy = ux
  let hu = 0, hv = 0
  for (const p of ptsM) {
    const dx = p[0] - mx, dy = p[1] - my
    hu = Math.max(hu, Math.abs(dx * ux + dy * uy))
    hv = Math.max(hv, Math.abs(dx * vx + dy * vy))
  }
  return { cx: mx, cy: my, ux, uy, vx, vy, hu, hv }
}

// Prozedurale Fassaden-Textur (Fensterachse als kachelbarer Block). Wand = weiß (lässt die
// Vertex-Wandfarbe durch), Fenster = dunkle vertiefte Glasfläche mit Kreuzsprosse + Sims.
// Ein Block = eine Achse × ein Geschoss; die UVs skalieren realweltlich (siehe pushWall).
function makeFacadeTexture() {
  const S = 128
  const c = document.createElement('canvas'); c.width = c.height = S
  const g = c.getContext('2d')
  g.fillStyle = '#f2ede3'; g.fillRect(0, 0, S, S) // Wandfläche (leicht getönt, nicht rein weiß)
  // KLEINES, gestanztes Fenster mit viel Wand ringsum → Wohnhaus statt Glas-Büro. Achsabstand
  // (BAY/FLR im Stil) sorgt zusätzlich für Luft zwischen den Fenstern.
  const wx = S * 0.36, wy = S * 0.24, ww = S * 0.28, wh = S * 0.44
  g.fillStyle = '#5b626b'; g.fillRect(wx, wy, ww, wh)         // Glas (gedämpft)
  g.fillStyle = '#6d757e'; g.fillRect(wx, wy, ww, wh * 0.4)   // oberer Scheibenanteil (Reflex)
  g.fillStyle = '#ded7c9'                                     // Kreuzsprosse + Sims (dezent)
  g.fillRect(wx + ww / 2 - 0.5, wy, 1, wh)
  g.fillRect(wx, wy + wh / 2 - 0.5, ww, 1)
  g.fillRect(wx - 1, wy + wh, ww + 2, 1.5)                    // Fensterbank
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.anisotropy = 4
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

// Dach-Oberflächentextur: feine, gedämpfte Körnung + dezente horizontale Nähte. Multipliziert die
// Dachfarbe leicht (0,84..1,0) → die großen Flachdächer wirken wie eine reale Deckung statt wie
// glatte Plastikplatten. Bewusst subtil, damit es sich weiter ins Foto einfügt.
function makeRoofTexture() {
  const S = 64
  const c = document.createElement('canvas'); c.width = c.height = S
  const g = c.getContext('2d')
  const img = g.createImageData(S, S)
  let seed = 1234567
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
  for (let i = 0; i < S * S; i++) {
    const n = 214 + Math.floor(rnd() * 42) // 214..255 → dezente Helligkeitsstreuung
    img.data[i * 4] = n; img.data[i * 4 + 1] = n; img.data[i * 4 + 2] = n; img.data[i * 4 + 3] = 255
  }
  g.putImageData(img, 0, 0)
  g.strokeStyle = 'rgba(90,90,90,0.13)'; g.lineWidth = 1 // schwache Nähte/Reihen
  for (let k = 8; k < S; k += 12) { g.beginPath(); g.moveTo(0, k + 0.5); g.lineTo(S, k + 0.5); g.stroke() }
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.anisotropy = 4
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}
const ROOF_UV = 2.2 // Meter pro Dachtextur-Kachel

// Dachfarbe aus rohem Satellitenpixel: NAH am echten Ton bleiben (nur leicht entsättigt, viel
// Helligkeitsvariation behalten) → die Dächer verschmelzen mit der fotografierten Umgebung statt
// als eigene Palette zu dominieren. Schiefer bleibt dunkel, Terrakotta terrakotta.
function roofFromSat([r, g, b]) {
  const luma = 0.299 * r + 0.587 * g + 0.114 * b
  const SAT = 0.88, KEEP = 0.72, TARGET = 132
  const cr = luma + (r - luma) * SAT, cg = luma + (g - luma) * SAT, cb = luma + (b - luma) * SAT
  const targ = TARGET + (luma - TARGET) * KEEP
  const k = targ / Math.max(1, luma)
  return [cr * k, cg * k, cb * k]
}

// Wandton aus demselben Satellitenpixel ableiten und mit dem Regional-Stil mischen: stark
// entsättigt + aufgehellt (Wände sind heller als Dächer). So relatert jede Fassade zu IHRER
// Umgebung (Altstadt warm, Hafen kühl) statt überall gleicher Putz → fügt sich harmonisch ein.
function wallFromSat([r, g, b], base) {
  const luma = 0.299 * r + 0.587 * g + 0.114 * b
  const SAT = 0.2 // stark entsättigen: das Satellitenpixel ist das DACH, die Wand soll nur einen
  const cr = luma + (r - luma) * SAT, cg = luma + (g - luma) * SAT, cb = luma + (b - luma) * SAT
  const targ = 200 // Hauch der Umgebung tragen, sonst neutraler heller Putz (sonst wirken die
  const k = targ / Math.max(1, luma) // Wände dachfarben → monolithisch/dominant)
  const sr = cr * k, sg = cg * k, sb = cb * k
  const MIX = 0.3 // Anteil Satellit vs. Stilfarbe (dezent)
  return [base[0] + (sr - base[0]) * MIX, base[1] + (sg - base[1]) * MIX, base[2] + (sb - base[2]) * MIX]
}

export function installBuildings3D(map, { route, style = 'nordic' } = {}) {
  const S = STYLES[style] || STYLES.default
  const BAY = S.bay, FLR = S.floor, EAVE = S.eave ?? EAVE_DEFAULT
  let sampler = createRoofSampler()
  let mesh = null
  let wallMat = null, roofMat = null
  let visible = true
  let renderer = null
  const camera = new THREE.Camera()
  const scene = new THREE.Scene()
  const facadeTex = makeFacadeTexture()
  const roofTex = makeRoofTexture()
  // Tag/Nacht-Tönung: material.color multipliziert mit Vertexfarbe+Textur → alle Gebäude dimmen
  // gemeinsam mit dem Boden (der Satellit wird über raster-brightness abgedunkelt). Startwert Tag.
  const tint = new THREE.Color(1, 1, 1)
  const applyTint = () => { if (wallMat) { wallMat.color.copy(tint); roofMat.color.copy(tint) } }

  // Referenz-Mercator-Ursprung (Korridor-Mitte) + Meter→Mercator-Faktor.
  const mid = route.coords[Math.floor(route.coords.length / 2)]
  const mc0 = maplibregl.MercatorCoordinate.fromLngLat([mid[0], mid[1]], 0)
  const mpu = mc0.meterInMercatorCoordinateUnits()
  const lat0 = mid[1], lng0 = mid[0]
  const mPerLat = 111320
  const mPerLng = 111320 * Math.cos(lat0 * DEG)
  // lng/lat → lokale Meter (Ost/Nord) um den Ursprung
  const toLocalM = (lng, lat) => [(lng - lng0) * mPerLng, (lat - lat0) * mPerLat]

  // Getrennte Vertex-Ströme: Wände (texturiert, mit UV) und Dächer (Vertexfarbe + Körnung). Ein
  // Geometry mit zwei Gruppen/Materialien → zwei Draws, aber Fassade UND Dächer korrekt.
  const wPos = [], wCol = [], wUv = []
  const rPos = [], rCol = [], rUv = []
  const toMerc = (p) => [p[0] * mpu, -p[1] * mpu, p[2] * mpu] // lokale Meter → Mercator-relativ (y-Flip)

  // Wand p→q (base→eave) mit realweltlich skalierter Fenster-UV, Flächenschräglicht. Wird vertikal
  // in ein dunkleres Erdgeschoss-Sockelband und den helleren Oberbau geteilt → erdet das Gebäude,
  // bricht die glatte Fassade, gibt Straßenebene Tiefe. UV-v läuft durchgehend (Fenster fluchten).
  function pushWall(p, q, base, eave, col, shade) {
    const w = Math.hypot(q[0] - p[0], q[1] - p[1]) || 0.01
    const un = w / BAY
    const H = Math.max(0.01, eave - base)
    const s = shade
    const cAt = (m) => [clamp255(col[0] * s * m), clamp255(col[1] * s * m), clamp255(col[2] * s * m)]
    // vertikaler Streifen z0→z1 mit Farb-Multiplikatoren m0 (unten) … m1 (oben)
    const strip = (z0, z1, m0, m1) => {
      const c0 = cAt(m0), c1 = cAt(m1)
      const vv0 = (z0 - base) / FLR, vv1 = (z1 - base) / FLR
      const a = toMerc([p[0], p[1], z0]), b = toMerc([q[0], q[1], z0])
      const c = toMerc([q[0], q[1], z1]), d = toMerc([p[0], p[1], z1])
      const push = (v, u, vv, cc) => { wPos.push(v[0], v[1], v[2]); wUv.push(u, vv); wCol.push(cc[0], cc[1], cc[2]) }
      push(a, 0, vv0, c0); push(b, un, vv0, c0); push(c, un, vv1, c1)
      push(a, 0, vv0, c0); push(c, un, vv1, c1); push(d, 0, vv1, c1)
    }
    const GH = Math.min(H * 0.5, 3.7) // Sockelhöhe (ein Geschoss)
    if (H > GH + 2) { strip(base, base + GH, 0.6, 0.82); strip(base + GH, eave, 0.82, AO_TOP) }
    else strip(base, eave, AO_BASE, AO_TOP)
  }

  // Dach-Dreieck (lokale Meter) → Mercator-relativ + eingebackene Flächenhelligkeit + UV aus der
  // Welt-XY-Projektion (Dachtextur kachelt maßstäblich über alle Dächer).
  function pushRoof(a, b, c, col) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2]
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl
    const shade = Math.min(1, AMBIENT + DIFFUSE * Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]))
    const r = clamp255(col[0] * shade), g = clamp255(col[1] * shade), bl = clamp255(col[2] * shade)
    for (const p of [a, b, c]) {
      const v = toMerc(p); rPos.push(v[0], v[1], v[2]); rCol.push(r, g, bl)
      rUv.push(p[0] / ROOF_UV, p[1] / ROOF_UV)
    }
  }
  const roofQuad = (a, b, c, d, col) => { pushRoof(a, b, c, col); pushRoof(a, c, d, col) }

  function buildMesh(features) {
    wPos.length = wCol.length = wUv.length = 0
    rPos.length = rCol.length = rUv.length = 0
    let idx = 0
    for (const f of features) {
      const ring = outerRing(f)
      if (!ring || ring.length < 4) continue
      const ll = f.__c || ring[0]
      const base = (() => { const t = map.queryTerrainElevation(ll); return t == null ? 0 : t })()
      const bh = heightOf(f)
      const eave = base + bh
      const ptsM = ring.map((p) => toLocalM(p[0], p[1]))
      const cM = toLocalM(ll[0], ll[1])

      // Farben aus dem echten Satellitenpixel ableiten (Dach + Wand) → fügt sich in die Umgebung.
      const raw = sampler ? sampler.sampleSync(ll[0], ll[1]) : null
      const j = ((Math.abs((cM[0] * 3.1 + cM[1] * 7.7) | 0) % 15) - 7) // dezente Streuung gegen Einheitsfarbe
      const wallBase = raw ? wallFromSat(raw, S.wall) : S.wall
      const wall = [wallBase[0] + j, wallBase[1] + j * 0.8, wallBase[2] + j * 0.6]

      // Wände: jede Kante als Quad base→Traufe, mit außenzeigender Normale fürs Schräglicht.
      for (let i = 0; i < ptsM.length - 1; i++) {
        const p = ptsM[i], q = ptsM[i + 1]
        let nx = (q[1] - p[1]), ny = -(q[0] - p[0])
        const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl
        const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2
        if (nx * (cM[0] - mx) + ny * (cM[1] - my) > 0) { nx = -nx; ny = -ny } // nach außen drehen
        const shade = Math.min(1, AMBIENT + DIFFUSE * Math.max(0, nx * LIGHT[0] + ny * LIGHT[1]))
        pushWall(p, q, base, eave, wall, shade)
      }

      // Dachfarbe: echtes Satellitenpixel (passt zur Umgebung), sonst Palette.
      const o = obb(ptsM)
      const roofCol = raw ? roofFromSat(raw) : S.roofs[Math.abs((base * 7 + ptsM.length * 13 + (idx++)) | 0) % S.roofs.length]

      // Footprint-Fläche (Shoelace) + Rechteckigkeit ggü. der OBB. Verwinkelte Grundrisse (L-Form,
      // schräg) füllen die OBB schlecht → ein OBB-Spitzdach hinge über Lücken (man sähe den Boden
      // durch). Solche UND große Gebäude bekommen ein Flachdach auf dem ECHTEN Footprint (bündig).
      let area2 = 0
      for (let i = 0; i < ptsM.length - 1; i++) area2 += ptsM[i][0] * ptsM[i + 1][1] - ptsM[i + 1][0] * ptsM[i][1]
      const rectRatio = (Math.abs(area2) / 2) / Math.max(1, 4 * o.hu * o.hv)

      if (o.hv > 10 || o.hu > 26 || rectRatio < 0.8) {
        // Flachdach: Fächer-Triangulation des echten Footprints auf Traufhöhe, Wicklung → Normale oben.
        const ccw = area2 > 0
        for (let i = 0; i < ptsM.length - 1; i++) {
          const p = ptsM[i], q = ptsM[i + 1]
          const a = [o.cx, o.cy, eave], b = [p[0], p[1], eave], c = [q[0], q[1], eave]
          ccw ? pushRoof(a, b, c, roofCol) : pushRoof(a, c, b, roofCol)
        }
      } else {
        // Rechteckiges kleines/mittleres Haus → Spitzdach auf der OBB (deckt den Footprint bündig).
        // Quadratisch → Walm (First eingezogen), länglich → Giebel (First bis zur Kante).
        const rh = Math.min(S.maxRoof, Math.max(S.minRoof, S.pitch * o.hv))
        const ridge = eave + rh
        const hipped = o.hu < o.hv * 1.6                 // fast quadratisch → Walmdach
        const ridgeU = hipped ? Math.max(0, o.hu - o.hv) : o.hu
        const eu = o.hu + EAVE, ev = o.hv + EAVE         // überstehende Traufkante
        const P = (su, sv, z) => [o.cx + o.ux * eu * su + o.vx * ev * sv, o.cy + o.uy * eu * su + o.vy * ev * sv, z]
        const A = P(1, 1, eave), B = P(-1, 1, eave), C = P(-1, -1, eave), D = P(1, -1, eave)
        const R1 = [o.cx + o.ux * ridgeU, o.cy + o.uy * ridgeU, ridge]
        const R2 = [o.cx - o.ux * ridgeU, o.cy - o.uy * ridgeU, ridge]
        roofQuad(A, B, R2, R1, roofCol)   // Schräge +v
        roofQuad(C, D, R1, R2, roofCol)   // Schräge −v
        pushRoof(D, A, R1, roofCol)       // Ende +u (Giebeldreieck bzw. Walmschräge)
        pushRoof(B, C, R2, roofCol)       // Ende −u
      }
    }

    const wN = wPos.length / 3, rN = rPos.length / 3
    const pos = new Float32Array(wPos.length + rPos.length)
    pos.set(wPos, 0); pos.set(rPos, wPos.length)
    const col = new Float32Array(wCol.length + rCol.length)
    col.set(wCol, 0); col.set(rCol, wCol.length)
    const uv = new Float32Array((wN + rN) * 2)
    uv.set(wUv, 0); uv.set(rUv, wUv.length) // Wand- (Fenster) + Dach-UVs (Körnung)

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    geo.addGroup(0, wN, 0)   // Wände → wallMat (Fenster)
    geo.addGroup(wN, rN, 1)  // Dächer → roofMat (Körnung)
    if (mesh) { mesh.geometry.dispose(); mesh.geometry = geo }
    else {
      wallMat = new THREE.MeshBasicMaterial({ map: facadeTex, vertexColors: true })
      roofMat = new THREE.MeshBasicMaterial({ map: roofTex, vertexColors: true })
      mesh = new THREE.Mesh(geo, [wallMat, roofMat])
      mesh.frustumCulled = false
      scene.add(mesh)
    }
    applyTint() // aktuelle Tageszeit-Tönung auf die frischen Materialien ziehen
    map.triggerRepaint()
  }

  // Ursprungs-Translation ist konstant → einmal bauen; Scratch-Puffer für die Matrixmultiplikation
  // wiederverwenden, damit render() pro Frame NICHTS allokiert (kein GC-Ruckeln bei der Fahrt).
  const originMat = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, mc0.x, mc0.y, mc0.z, 1]
  const mainBuf = new Array(16)
  const mvpBuf = new Array(16)
  const layer = {
    id: 'buildings3d-three',
    type: 'custom',
    renderingMode: '3d',
    onAdd(m, gl) {
      renderer = new THREE.WebGLRenderer({ canvas: m.getCanvas(), context: gl, antialias: true })
      renderer.autoClear = false
    },
    render(gl, opts) {
      if (!mesh || !renderer || !visible) return
      const main = opts?.defaultProjectionData?.mainMatrix || opts // v5: mainMatrix; Fallback: alte Signatur
      for (let i = 0; i < 16; i++) mainBuf[i] = main[i]
      mat4mul(mainBuf, originMat, mvpBuf)
      camera.projectionMatrix.fromArray(mvpBuf)
      renderer.resetState()
      renderer.render(scene, camera)
    },
  }

  map.addLayer(layer)
  // Gebäude UND Satelliten-Dachfarben laden, dann EINMAL bauen. sampleSync liefert bereits geladene
  // Kacheln synchron; fehlt eine, greift die Palette. Prefetch feuert nach allen Kacheln (oder 3,5 s).
  Promise.all([
    loadCorridorBuildings(route),
    new Promise((res) => sampler.prefetch(route, res)),
  ]).then(([feats]) => {
    if (feats) buildMesh(feats)
    sampler.dispose(); sampler = null // ~100 MB Kachel-ImageData freigeben (Mesh ist statisch)
  })

  return {
    _dbg: () => ({ tris: (wPos.length + rPos.length) / 9 }),
    // Der Regie folgen: Gebäude gemeinsam mit dem Boden über der Tageszeit tönen/dimmen. p aus
    // daynight.js (p.br 0.2..1 Helligkeit, p.lc Lichtfarbe) → dunkelt nachts korrekt ab (Bugfix:
    // vorher blieben Dächer/Wände hell). Leicht kühl bei Nacht, neutral bei Tag.
    applyDayNight(p) {
      // WICHTIG: material.color multipliziert im LINEAREN Farbraum (Three-Color-Management), der
      // Satellit wird per raster-brightness im DISPLAY-Raum gedimmt. Ein linearer Faktor 0,2 zeigt
      // sich als ~0,48 Display → die Gebäude blieben nachts viel zu hell („bleiben weiß"). Deshalb
      // b (Display-Helligkeit) via b² grob nach linear ziehen → dimmt so stark wie der Boden.
      const b = Math.max(0.13, p.br)
      const lin = b * b
      const cool = 1 - Math.min(1, Math.max(0, (b - 0.2) / 0.8)) // 1 nachts .. 0 tags
      tint.setRGB(lin * (1 - 0.12 * cool), lin * (1 - 0.04 * cool), lin * (1 + 0.12 * cool))
      applyTint(); map.triggerRepaint()
    },
    setNight(on) { // Schwellen-Callback als Sofort-Fallback (falls applyDayNight noch nicht lief)
      if (on) tint.setRGB(0.05, 0.055, 0.075); else tint.setRGB(1, 1, 1)
      applyTint(); map.triggerRepaint()
    },
    setVisible(on) { visible = on; map.triggerRepaint() }, // „Gebäude ausblenden" muss auch DIESE treffen
    isVisible: () => visible,
    remove() { if (map.getLayer('buildings3d-three')) map.removeLayer('buildings3d-three'); mesh?.geometry.dispose(); facadeTex.dispose(); roofTex.dispose() },
  }
}
