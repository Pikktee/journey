// Atmosphäre-Overlay: Horizont-Dunst (Luftperspektive), Sternenhimmel und Sonne
// mit Lens-Flare — alles auf EINEM Screen-Space-Canvas über allen Rendering-
// Pfaden (MapLibre/deck/Google-3D). MapLibre kann das nicht: verifiziert gegen die
// Quelle — es gibt kein setFog (kein Tiefen-Dunst aufs Terrain), und der Flat-Map-
// Himmel ist ein reiner Farbverlauf ohne Sonne/Sterne. Also projizieren wir Gestirn,
// Sterne und Dunst selbst aus der echten Kamerapose (tour.onPose) und dem echten
// Sonnenstand (daynight.js → setSky). Die Kamera-Basis (fwd/right/up) ist für alle
// drei Ebenen dieselbe — dadurch sind Sterne welt-verankert (bewegen sich korrekt
// mit dem Blick) und die Sonne sitzt exakt an ihrem echten Azimut/Höhe.
const DEG = Math.PI / 180

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = (v) => {
  const l = Math.hypot(v[0], v[1], v[2])
  return l < 1e-9 ? null : [v[0] / l, v[1] / l, v[2] / l]
}
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x)
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x)
const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}
// Sonnenrichtung als ENU-Einheitsvektor (Ost, Nord, Oben)
const sunDirENU = (altDeg, azDeg) => {
  const a = altDeg * DEG, z = azDeg * DEG
  return [Math.sin(z) * Math.cos(a), Math.cos(z) * Math.cos(a), Math.sin(a)]
}

// lng/lat/alt-Differenz in lokale ENU-Meter (flache Näherung, auf km-Skala exakt genug)
const enuOffset = (from, to) => {
  const mPerLng = 111320 * Math.cos(from[1] * DEG)
  return [(to[0] - from[0]) * mPerLng, (to[1] - from[1]) * 110540, to[2] - from[2]]
}

const hex = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]

// Abtast-Distanzen der DEM-Sonde: log-verteilt 0,5–48 km (nahe Felssporne bilden
// die Silhouette oft schon unter 1 km); ein Verfeinerungspass um das Maximum
// (probeRay) fängt schmale Grate zwischen den Stützstellen
const PROBE_DISTS = Array.from({ length: 20 }, (_, i) => Math.round(500 * Math.pow(96, i / 19)))

// Warmton der Sonnenscheibe: am/unter dem Horizont tief orangerot (Extinktion in der
// dicken Atmosphäre), zur Mittagshöhe blasser/weißer.
const sunColor = (alt) => {
  const t = clamp01((alt + 2) / 14) // 0 bei ≤−2°, 1 bei ≥+12°
  return `${255},${Math.round(92 + 128 * t)},${Math.round(38 + 182 * t)}`
}

// Feste Sternenverteilung auf der oberen Himmelshalbkugel (einmalig, deterministisch
// genug). Gleichverteilt auf der Halbkugel (z = sin(Höhe) linear ⇒ flächengleich),
// Helligkeit quadratisch gewichtet ⇒ wenige helle, viele schwache Sterne.
function makeStars(n) {
  const stars = []
  for (let i = 0; i < n; i++) {
    const z = 0.02 + 0.98 * Math.random() // Höhe über Horizont (nie exakt am Rand)
    const r = Math.sqrt(1 - z * z)
    const az = Math.random() * Math.PI * 2
    const mag = Math.pow(Math.random(), 2.6) // 0..1, meist klein (viele schwache, wenige helle)
    stars.push({
      dir: [r * Math.sin(az), r * Math.cos(az), z],
      mag,
      ph: Math.random() * Math.PI * 2, // Funkel-Phase
      tw: 0.6 + Math.random() * 1.8, // eigene Funkel-Frequenz
      warm: Math.random() < 0.1, // ein paar leicht warme Sterne
    })
  }
  return stars
}

// Deterministischer PRNG für die Wolken-Kacheln (kein Math.random → gleiche Wolken
// bei jedem Laden, nur die Drift bewegt sie)
const mulberry32 = (seed) => () => {
  seed |= 0
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

// Kachelbares fraktales Wertrauschen (4 Oktaven) als Float-Feld — daraus werden
// mehrere Schwellwert-Kacheln gebacken (gleiche Wolkenlage, andere Verdichtung).
const CLOUD_S = 384
function makeCloudNoise(seed) {
  const S = CLOUD_S
  const rnd = mulberry32(seed)
  const octN = [6, 12, 24, 48]
  const grids = octN.map((n) => {
    const g = new Float32Array(n * n)
    for (let i = 0; i < g.length; i++) g[i] = rnd()
    return g
  })
  const field = new Float32Array(S * S)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let v = 0
      let amp = 0.5
      for (let o = 0; o < 4; o++) {
        const n = octN[o]
        const g = grids[o]
        const fx = (x / S) * n
        const fy = (y / S) * n
        const x0 = Math.floor(fx)
        const y0 = Math.floor(fy)
        const tx = fx - x0
        const ty = fy - y0
        const sx = tx * tx * (3 - 2 * tx)
        const sy = ty * ty * (3 - 2 * ty)
        const x1 = (x0 + 1) % n
        const y1 = (y0 + 1) % n
        const v00 = g[y0 * n + x0], v10 = g[y0 * n + x1], v01 = g[y1 * n + x0], v11 = g[y1 * n + x1]
        v += ((v00 + (v10 - v00) * sx) * (1 - sy) + (v01 + (v11 - v01) * sx) * sy) * amp
        amp *= 0.5
      }
      field[y * S + x] = v / 0.9375 // Amplitudensumme → 0..1
    }
  }
  return field
}

// Weicher Schwellwert formt die Wolken: hohe Basis → einzelne Ballen mit viel
// Lücke dazwischen, niedrige Basis → fast geschlossene Decke. Die drei Stufen
// (locker/aufgerissen/geschlossen) sind die FORM-Seite der Wolkendeckung —
// drawClouds blendet zwischen ihnen, statt dieselben Wolken nur transparenter
// zu machen (halbtransparente „Geisterwolken" sahen nie nach wenig Wolken aus).
const CLOUD_TIERS = [[0.6, 0.84], [0.44, 0.72], [0.15, 0.52]]
function cloudTileFrom(field, lo, hi) {
  const S = CLOUD_S
  const cv = document.createElement('canvas')
  cv.width = S
  cv.height = S
  const c = cv.getContext('2d')
  const img = c.createImageData(S, S)
  for (let i = 0; i < S * S; i++) {
    const a = smoothstep(lo, hi, field[i])
    img.data[i * 4] = 255
    img.data[i * 4 + 1] = 255
    img.data[i * 4 + 2] = 255
    img.data[i * 4 + 3] = Math.round(a * 255)
  }
  c.putImageData(img, 0, 0)
  return cv
}

export function createAtmosphere(container) {
  // Fern-Unschärfe: schmaler backdrop-filter-Streifen unter der Horizontlinie
  // (progressiv maskiert). Nimmt der Ferne die Schärfe wie echte Distanz-Unschärfe
  // und kaschiert damit v. a. die Esri-LOD-Kante (ferne Kacheln = andere Auflösung/
  // Aufnahme, messbar hellere Zone mit harter Grenze — MapLibres Terrain-Fog ist
  // in unseren Posen nachweislich wirkungslos: die Fog-Matrix legt ihre Near-Plane
  // auf cameraToSeaLevelDistance, bei Pitch ~86 beginnt Fog jenseits des Horizonts).
  // Liegt UNTER dem Atmosphäre-Canvas (z-index, style.css) und blurt nur die Karte.
  const blurEl = document.createElement('div')
  blurEl.id = 'farblur'
  blurEl.setAttribute('aria-hidden', 'true')
  container.appendChild(blurEl)
  const canvas = document.createElement('canvas')
  canvas.id = 'atmosphere'
  canvas.setAttribute('aria-hidden', 'true')
  container.appendChild(canvas)
  const ctx = canvas.getContext('2d')

  let sun = null // { altitude, azimuth } in Grad
  let sky = { hor: [170, 205, 235], skyc: [119, 176, 223], fogc: [150, 192, 227] } // Horizont-/Himmel-/Fog-Farbe (RGB), von daynight
  let fovDeg = 36.87
  let w = 0, h = 0, aspect = 1
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const stars = makeStars(3000)
  let twinkle = 0
  let lastT = performance.now() // für echtes dt (tour.onPose liefert keins)
  let getCam = null // () => ({ pitch, bearing }) — die ECHTE (geclampte) Render-Kamera aus MapLibre
  // Wetter-Himmel: cover = Wolkendeckung, dark = Wolken-Schwere, fog = Nebel.
  // wx ist das Ziel (vom Umschalter), wxCur zieht weich nach → Umschalten blendet.
  let wx = { cover: 0, dark: 0, fog: 0 }
  const wxCur = { cover: 0, dark: 0, fog: 0 }
  let cloudTiers = null // 2 Rauschlagen × 3 Formstufen (lazy)
  let cloudCv = null, cloudCtx = null // Offscreen für Formung + Einfärbung
  let cloudT = 0 // Drift-Zeit (nicht an die Tour-Zeit gekoppelt — Wolken ziehen einfach)
  let sunOcc = 0, sunOccTgt = 0 // Wolken-Alpha AN der Sonnenposition (0..1) — steuert das Direktlicht
  let animGate = null // () => true solange die Szene animiert; false ⇒ Wolken-Drift friert ein (Pause)
  let lastPose = null, lastRenderAt = 0 // fürs Idle-Nachrendern in der Pause
  let camAlt = 0 // Kamerahöhe über NN — bestimmt, wie weit der Blick unter den Horizont reicht
  let terrainQ = null // (lng, lat) => Szenenhöhe (überhöht, wie pose.alt) | null — von main.js
  let horVis = 1, horVisTgt = 1, lastProbe = 0 // 0..1: ist die flache Horizontlinie wirklich sichtbar? (Mittel des Fächers)
  // Sichtbarkeits-FÄCHER über das Sichtfeld: je ein Sonden-Strahl pro Azimut-Offset.
  // Drei Strahlen ±10° reichten nicht — im Gebirge stand seitlich Fels über der
  // Linie, während die Bildmitte frei war, und das (vollbreite) Band lag quer auf
  // der Wand. Jetzt wird das Band horizontal mit dem Fächer maskiert.
  // ±31° deckt das horizontale Sichtfeld bis in die Ecken ab (hFov/2 ≈ 30,6°) —
  // mit ±24° blieb in den Bildecken Fels unmaskiert
  const FAN_OFF = [-31, -20, -10, 0, 10, 20, 31]
  const horFan = FAN_OFF.map(() => 1)
  let horFanTgt = FAN_OFF.map(() => 1)
  let hazeCv = null, hazeCtx = null // Offscreen für die horizontale Maskierung (lazy)
  let occRise = 0, occRiseTgt = 0 // Silhouetten-Überstand (ndc) am SONNEN-Azimut — dort versinkt die Scheibe

  const resize = () => {
    w = window.innerWidth
    h = window.innerHeight
    aspect = w / h
    canvas.width = w * dpr
    canvas.height = h * dpr
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    cloudCv = null // Wolken-Offscreen an die neue Größe anpassen (lazy)
    hazeCv = null // dito Dunst-Offscreen
  }
  resize()
  window.addEventListener('resize', resize)

  const clear = () => ctx.clearRect(0, 0, w, h)

  // Kamera-Orthonormalbasis — bevorzugt aus der ECHTEN Render-Kamera (getPitch/
  // getBearing). Wichtig: MapLibre CLAMPT den Pitch auf maxPitch; die Tour-Pose
  // (Blick cg→lt) weiß davon nichts. Wird die Basis aus der Pose gebaut, sitzt bei
  // gekapptem Pitch ALLES (Sonne + Verdeckungslinie) um die Clamp-Differenz zu tief
  // gegenüber der gerenderten Szene — die Sonne „versinkt in der Textur unterhalb
  // des Horizonts". Fallback ohne Kamera-Zugriff: Pose-Richtung wie bisher.
  function basisFrom(pose) {
    const cam = getCam?.()
    let fwd
    if (cam) {
      const be = cam.bearing * DEG, pi = cam.pitch * DEG
      fwd = [Math.sin(be) * Math.sin(pi), Math.cos(be) * Math.sin(pi), -Math.cos(pi)]
    } else {
      fwd = norm(enuOffset([pose.cg[0], pose.cg[1], pose.alt], [pose.lt[0], pose.lt[1], pose.ltAlt]))
    }
    if (!fwd) return null
    let right = norm(cross(fwd, [0, 0, 1]))
    if (!right) right = norm(cross(fwd, [1, 0, 0]))
    if (!right) return null
    const up = cross(right, fwd)
    const tanY = Math.tan((fovDeg * DEG) / 2)
    // Astronomischer Horizont = horizontale Blickrichtung (fwd ohne Vertikalanteil)
    const fh = norm([fwd[0], fwd[1], 0]) || fwd
    const zh = dot(fh, fwd)
    const horizonNdcY = zh > 0.02 ? (dot(fh, up) / zh) / tanY : -2
    // GERENDERTE Boden-Himmel-Linie: MapLibre zieht seinen Mercator-Horizont mit
    // Faktor 0.85 UNTER den wahren Fluchtpunkt (getMercatorHorizon, mercator_utils.ts)
    // — dort endet die Karte wirklich (per Pixel-Scan verifiziert, ±3 px). An DIESER
    // Linie muss die Sonne versinken, nicht am astronomischen Horizont. Fallback ohne
    // Kamera-Zugriff: astronomisch minus Kimmtiefe (√(2·h/R), Näherung fürs echte Rund).
    let horizonRenderNdcY
    if (cam) {
      const t90 = Math.tan((90 - cam.pitch) * DEG) * 0.85
      const tCap = Math.tan((89.25 - cam.pitch) * DEG)
      horizonRenderNdcY = Math.min(t90, tCap) / tanY
    } else {
      const dip = (pose.alt || 0) > 1 ? Math.sqrt((2 * pose.alt) / 6371000) : 0
      horizonRenderNdcY = horizonNdcY - dip / tanY
    }
    return { fwd, right, up, tanY, horizonNdcY, horizonRenderNdcY }
  }

  // Weltrichtung → Bildschirm. Gibt null zurück, wenn hinter der Kamera.
  function project(dir, b) {
    const z = dot(dir, b.fwd)
    if (z <= 0.02) return null
    const ndcX = (dot(dir, b.right) / z) / (b.tanY * aspect)
    const ndcY = (dot(dir, b.up) / z) / b.tanY
    return { ndcX, ndcY, sx: (ndcX * 0.5 + 0.5) * w, sy: (0.5 - ndcY * 0.5) * h }
  }

  // — Horizont-Sichtbarkeit (steiles Gelände) —
  // Dunst-Band, Saum und Sonnen-Glut hängen an der FLACHEN Mercator-Horizontlinie.
  // In Tälern/an Bergwänden liegt die gerenderte Gelände-Silhouette aber weit ÜBER
  // dieser Linie — die Ebenen malten dann mitten auf den Fels, wo gar kein Horizont
  // ist (Berner Oberland). Wir tasten das DEM entlang des Blick-Bearings ab
  // (queryTerrainElevation ist ein billiger Lookup in geladene Kacheln) und blenden
  // aus, wenn NAHES Gelände die Linie verdeckt. Ferne Ketten (>~35 km) SIND der
  // Horizont → Band bleibt; die Luftperspektive auf dem Gelände selbst kommt dort
  // von MapLibres Terrain-Fog (daynight.js), der echte Distanzen kennt.
  // Ein DEM-Strahl: höchster abgetasteter Silhouetten-Punkt entlang eines Azimuts,
  // als ndcY + Distanz (null, wenn nichts abtastbar). Genutzt für den Blick-Bearing
  // (Dunst-Band) UND den Sonnen-Azimut (Scheiben-Verdeckung).
  function probeRay(pose, b, be) {
    if (!terrainQ || !pose.cg) return null
    const la0 = pose.cg[1] * DEG
    const ln0 = pose.cg[0] * DEG
    const sample = (d) => {
      const ang = d / 6371000
      const sinLa2 = Math.sin(la0) * Math.cos(ang) + Math.cos(la0) * Math.sin(ang) * Math.cos(be)
      const la2 = Math.asin(sinLa2)
      const ln2 = ln0 + Math.atan2(Math.sin(be) * Math.sin(ang) * Math.cos(la0), Math.cos(ang) - Math.sin(la0) * sinLa2)
      const ele = terrainQ(ln2 / DEG, la2 / DEG)
      if (ele == null || !Number.isFinite(ele)) return null // Kachel nicht geladen/Wasser-Fallback
      const dir = norm([Math.sin(be) * d, Math.cos(be) * d, ele - (pose.alt || 0)])
      const z = dir ? dot(dir, b.fwd) : 0
      if (z <= 0.02) return null
      return { ndcY: (dot(dir, b.up) / z) / b.tanY, dist: d }
    }
    // DICHTES log-Raster statt Oktav-Schritten: mit [1.5,3,6,12,24,48] km fiel die
    // Grat-SILHOUETTE zwischen die Stützstellen (Oberland: 6 km = Grindelwald-
    // Talboden, 12 km = Flanke schon HINTER dem Kamm — der Skyline-Punkt wurde
    // nie getroffen, horVis blieb ~1 und das Dunst-Band lag quer auf der Felswand).
    // Der Silhouetten-Winkel ist ein MAX über den Strahl — Unterabtastung kann ihn
    // nur UNTERSCHÄTZEN. queryTerrainElevation ist ein billiger Raster-Lookup,
    // (20+4) Stützstellen × 8 Strahlen alle 120 ms sind vernachlässigbar.
    let best = null
    for (const d of PROBE_DISTS) {
      const s = sample(d)
      if (s && (!best || s.ndcY > best.ndcY)) best = s
    }
    // Verfeinerung um das Maximum: schmale Grate/Sporne liegen oft ZWISCHEN zwei
    // log-Stützstellen — vier Zwischenpunkte um den bisherigen Bestwert heben den
    // echten Skyline-Punkt (Faktor ~1,27 Rasterschritt → ±6/12 % Feinschritte)
    if (best) {
      for (const f of [0.88, 0.94, 1.06, 1.13]) {
        const s = sample(best.dist * f)
        if (s && s.ndcY > best.ndcY) best = s
      }
    }
    return best
  }

  // Fluchtpunkt-Floor für beide Sonden: MapLibres gerenderte Horizontlinie liegt
  // BEWUSST unter dem Fluchtpunkt (Faktor 0.85, getMercatorHorizon) — flaches
  // Fern-Gelände projiziert also IMMER etwas über sie, ganz ohne Berge (auf der
  // Flat-Map konvergiert der Boden erst am Fluchtpunkt). Ein Überstand zählt darum
  // erst OBERHALB von max(Mercator-Linie, Fluchtpunkt) als echte Silhouette; ohne
  // den Floor hob die Sonde die Sonnen-Verdeckungslinie im flachen Stockholm um
  // 0.04–0.2 ndc an und die Scheibe „versank" weit über dem Wasser.
  const silhouetteFloor = (b) => Math.max(b.horizonRenderNdcY, b.horizonNdcY)

  function probeFan(pose, b) {
    const cam = getCam?.()
    if (!cam) return FAN_OFF.map(() => 1)
    // Ein Strahl je Fächer-Offset; die weiche Glättung (0,55 s) + die horizontale
    // Interpolation in drawHaze machen Kamera-Schwenks graduell statt sprunghaft.
    return FAN_OFF.map((off) => {
      const rp = probeRay(pose, b, (cam.bearing + off) * DEG)
      if (!rp) return 1
      // Silhouetten-Überstand über dem Fluchtpunkt-Floor: flaches Gelände kann den
      // Floor NICHT überschreiten (es konvergiert genau dort — Totband 0.012 nur
      // gegen DEM-Rauschen), und bei Pitch ~86 sind schon 1–2° Überstand ~30–40 px
      // sichtbare Felswand über der Linie. Die Rampe muss also STEIL sein: mit der
      // alten flachen (0.03–0.18) blieb ein klar überragender Grat halb wirksam.
      const rise = smoothstep(0.012, 0.05, rp.ndcY - silhouetteFloor(b))
      const near = 1 - smoothstep(12000, 35000, rp.dist) // nur NAHE Verdecker unterdrücken
      return 1 - rise * near
    })
  }

  // — Ebene 1: Horizont-Dunst (Luftperspektive) —
  // Physikalisch motiviert statt lineares Band: Der Sichtstrahl zu einem Bodenpunkt
  // dy Pixel unter der Horizontlinie trifft den Boden in d ≈ camAlt·pxPerRad/dy
  // Metern (hyperbolisch — knapp unter der Linie liegen zig Kilometer, weiter unten
  // nur noch wenige). Dunstdichte = 1 − e^(−d/L) mit Sichtweite L. Direkt an der
  // Kante ist der Dunst damit fast opak (verdeckt die harte Mercator-/DEM-Kante und
  // die zackigen Kachelränder), zum Vordergrund fällt er natürlich ab. Über der
  // Linie ein schmaler heller Saum — der echte Himmel ist am Horizont am hellsten —
  // sodass Boden- und Himmelsseite in derselben Farbe/Dichte zusammenlaufen.
  function drawHaze(b) {
    const hy = (0.5 - b.horizonRenderNdcY * 0.5) * h
    // KEIN binärer Sichtbarkeits-Cut: der frühere `if (hy < -0.5h) return` lag exakt
    // im Pitch-Bereich des Intros (~52,6°) — die ganze Ebene schaltete beim Kippen
    // der Kamera in EINEM Frame an/aus („blendet hart ein"). Stattdessen blendet die
    // Gesamtdichte weich über die Linienposition (Linie weit überm Bild → kein Dunst).
    const edgeFade = smoothstep(-0.62, -0.28, hy / h) * (1 - smoothstep(1.15, 1.45, hy / h))
    const dayFactor = sun ? smoothstep(-10, 4, sun.altitude) : 1 // nachts kaum Dunst
    // Sichtbarkeits-Fächer (horFan): verdeckt nahes Gelände die Linie (Talkessel/
    // Bergflanke), gibt es DORT keinen Horizont — Band + Saum werden horizontal
    // maskiert, statt mitten auf den Fels zu malen (Bildmitte frei, Seiten Fels
    // war mit einem einzigen globalen Faktor nicht abbildbar).
    // Grunddichte bewusst moderat: die Mercator-Kante versteckt bei hohen Pitches
    // MapLibres eigener Terrain-Fog (daynight), das Overlay legt nur noch die
    // Luftperspektive darüber — ein fast opaker „Vorhang" war als Schicht ablesbar.
    const fanMin = Math.min(...horFan)
    const fanMax = Math.max(...horFan)
    const A0 = 0.72 * dayFactor * edgeFade // Dichte OHNE Fächer (der kommt als Maske)
    const A = A0 * fanMax // Spitzenwert — fürs frühe Aussteigen und die Saum-Stops
    // Fern-Unschärfe-Streifen mitführen (Maske folgt der Linie, läuft lang aus).
    // Konservativ ans Fächer-MINIMUM gekoppelt: sobald irgendwo Fels über der
    // Linie steht, wäre der Schärfe-Streifen auf der Wand ablesbar.
    const blurVis = clamp01((A0 / 0.72) * fanMin)
    if (blurVis < 0.03) {
      blurEl.style.visibility = 'hidden'
    } else {
      const y1 = Math.round(hy - h * 0.02)
      const y2 = Math.round(hy + h * 0.025)
      const y3 = Math.round(hy + (h - hy) * 0.2)
      const y4 = Math.round(hy + (h - hy) * 0.6)
      const mask = `linear-gradient(to bottom, transparent ${y1}px, rgba(0,0,0,${blurVis.toFixed(2)}) ${y2}px, rgba(0,0,0,${(blurVis * 0.75).toFixed(2)}) ${y3}px, transparent ${y4}px)`
      if (blurEl.dataset.mask !== mask) {
        blurEl.dataset.mask = mask
        blurEl.style.webkitMaskImage = mask
        blurEl.style.maskImage = mask
      }
      blurEl.style.visibility = ''
    }
    if (A < 0.02) return
    // Bodenseite in der FOG-Farbe der Tag/Nacht-Regie: das Gelände darunter ist von
    // MapLibres Terrain-Fog bereits GENAU dorthin eingefärbt — im gleichen Ton fällt
    // der Übergang zusammen. Mit der Horizontfarbe (zur Golden Hour deutlich anders:
    // Orange über Braun) war die Bandkante als Schicht sichtbar.
    const [r, g, bl] = sky.fogc
    const [hr, hg, hbl] = sky.hor
    const pxPerRad = (h / 2) / b.tanY
    // Sichtweite: klarer Tag ~42 km; Bewölkung drückt sie, Nebel-Anteil stark
    const L = 42000 * (1 - 0.45 * wxCur.cover) * (1 - 0.75 * wxCur.fog)
    // Dunst ist ein GRENZSCHICHT-Phänomen (unterste ~750 m Luft): aus großer Höhe
    // (Intro-Anflug, mehrere km) schaut man fast senkrecht DURCH die dünne Schicht,
    // der Strahl sammelt kaum Trübung. Ungekappt machte camAlt·pxPerRad beim
    // Hineinzoomen den GANZEN Bildschirm diesig (kD wuchs mit der Flughöhe).
    // Der Faktor 4.5 VERBREITERT den sichtbaren Verlauf gegenüber der reinen
    // Extinktions-Hyperbel: Mehrfachstreuung und eine ungleichmäßige Dunstschicht
    // ziehen den Übergang real weit auseinander — der pure physikalische Abfall
    // (~40–60 px von dicht auf klar) las sich als Bandkante („diesig → normal
    // zu schmal", User-Feedback). Die Dichte muss zudem die Esri-LOD-Grenze
    // (~12 km: ferne, niedriger aufgelöste Kacheln sind messbar heller) mit
    // ~50 % Schleier schlucken — MapLibres Terrain-Fog hilft dabei NICHT
    // (verifiziert wirkungslos in unseren Posen, s. drawHaze-Blur unten).
    const kD = (clamp(camAlt, 40, 750) * pxPerRad * 4.5) / L // d(dy) = kD/dy, in „Sichtweiten"
    // Ziel-Kontext: im Flachland (Fächer uniform) direkt aufs Haupt-Canvas; sonst
    // in den Offscreen, der anschließend mit einem HORIZONTALEN Alpha-Verlauf aus
    // dem Fächer maskiert wird (destination-in) — das Band verschwindet dort, wo
    // Fels über der Linie steht, und bleibt, wo wirklich Horizont ist. Ein Verlauf
    // statt Streifen: Canvas interpoliert die Stützstellen weich, keine Säume.
    const uniform = fanMax - fanMin < 0.03
    let tc = ctx
    let fUni = fanMin
    if (!uniform) {
      if (!hazeCv) {
        hazeCv = document.createElement('canvas')
        hazeCv.width = w
        hazeCv.height = h
        hazeCtx = hazeCv.getContext('2d')
      }
      hazeCtx.globalCompositeOperation = 'source-over'
      hazeCtx.clearRect(0, 0, w, h)
      tc = hazeCtx
      fUni = 1
    }
    const Af = A0 * fUni
    // Bodenseite: e-Kurve über Gradient-Stops abtasten (Canvas interpoliert linear).
    // WICHTIG: Der Verlauf läuft KONTINUIERLICH bis zur Bildunterkante. Ein fester
    // Band-Endpunkt (früher hy + 0.6·h) hinterließ dort einen sichtbaren horizontalen
    // Cut. Stops zur Kante hin verdichtet (t^1.6); dy-Boden 5 px flacht die Spitze
    // direkt an der Linie ab (die steilste Zone der Hyperbel war als Band ablesbar).
    const down = Math.max(h - hy, h * 0.25)
    const y0 = Math.max(hy, 0)
    if (h > y0) {
      const grad = tc.createLinearGradient(0, hy, 0, hy + down)
      const N = 16
      // Schmelzzone: DIREKT an der Linie muss der Boden fast opak in den Himmel
      // übergehen (Sichtstrahl → ∞, Extinktion → 1). Die breite Hyperbel deckelt
      // bei A≈0.72 — über dunklem Wasser blieb dadurch eine ~Δ30-Stufe Himmel→
      // Boden GENAU an der Kante stehen (User: „kleiner Übergang im oberen
      // Drittel"). Ein schmaler Zusatz-Schleier (~5 % Bildhöhe) schließt die
      // letzte Lücke; komponiert wie zwei Schichten (kein max()-Knick).
      const meltH = h * 0.05
      const aMelt = 0.95 * dayFactor * edgeFade * fUni
      for (let i = 0; i <= N; i++) {
        const t = Math.pow(i / N, 1.6)
        const dy = Math.max(t * down, 5)
        const broad = Af * (1 - Math.exp(-kD / dy))
        const melt = aMelt * (1 - smoothstep(0, meltH, t * down))
        const a = 1 - (1 - broad) * (1 - melt)
        grad.addColorStop(t, `rgba(${r},${g},${bl},${a.toFixed(3)})`)
      }
      tc.fillStyle = grad
      tc.fillRect(0, y0, w, h - y0)
    }
    // Himmelsseite: schmaler Saum, der zur Linie hin auf die Boden-Dichte ansteigt.
    // Farbe läuft dabei Horizont→Fog, damit er an der Linie EXAKT im Boden-Ton
    // ankommt (kein Streifen) und nach oben im Himmels-Ton verschwindet.
    const up = h * 0.045
    const s0 = Math.max(hy - up, 0)
    if (hy > 0 && hy > s0) {
      const mix = (t) => `${Math.round(hr + (r - hr) * t)},${Math.round(hg + (g - hg) * t)},${Math.round(hbl + (bl - hbl) * t)}`
      const g2 = tc.createLinearGradient(0, hy - up, 0, hy)
      g2.addColorStop(0, `rgba(${mix(0)},0)`)
      g2.addColorStop(0.55, `rgba(${mix(0.35)},${(0.1 * Af).toFixed(3)})`)
      g2.addColorStop(0.85, `rgba(${mix(0.7)},${(0.32 * Af).toFixed(3)})`)
      g2.addColorStop(1, `rgba(${mix(1)},${Af.toFixed(3)})`)
      tc.fillStyle = g2
      tc.fillRect(0, s0, w, Math.min(hy, h) - s0)
    }
    // Naht-Deckung: MapLibre zieht am flachen Horizont eine dünne DUNKLE Linie (Terrain-
    // Horizont-Artefakt — verifiziert unabhängig von sky/atmosphere-/horizon-fog-/
    // sky-horizon-blend, bleibt auch ohne das ganze Overlay stehen). Der breite Dunst
    // deckt darüber nur ~0,74 (Tag-/edgeFade-gedämpft) — über der schwarzen Naht bleibt
    // ein Rest sichtbar. Ein schmaler, GENAU an der Linie voll deckender Streifen (oben
    // Horizont-, unten Fog-Farbe = der natürliche Verlauf) schließt sie unsichtbar. Liegt
    // mit im Offscreen ⇒ der Fächer maskiert ihn dort weg, wo Fels über der Linie steht
    // (dann gibt es gar keine Naht). Nur wenn die Linie wirklich im Bild ist.
    if (hy > -6 && hy < h + 6) {
      const seam = Math.max(3, Math.round(h * 0.006))
      const gS = tc.createLinearGradient(0, hy - seam, 0, hy + seam)
      gS.addColorStop(0, `rgba(${hr},${hg},${hbl},0)`)
      gS.addColorStop(0.5, `rgba(${Math.round((hr + r) / 2)},${Math.round((hg + g) / 2)},${Math.round((hbl + bl) / 2)},${(edgeFade * fUni).toFixed(3)})`)
      gS.addColorStop(1, `rgba(${r},${g},${bl},0)`)
      tc.fillStyle = gS
      tc.fillRect(0, Math.round(hy - seam), w, 2 * seam)
    }
    if (!uniform) {
      // Horizontale Fächer-Maske: Stützstellen an den Sonden-Azimuten, auf
      // Bildschirm-x projiziert (tan(offset) im Kamera-Maßstab); Ränder clampen
      hazeCtx.globalCompositeOperation = 'destination-in'
      const gm = hazeCtx.createLinearGradient(0, 0, w, 0)
      gm.addColorStop(0, `rgba(0,0,0,${horFan[0].toFixed(3)})`)
      for (let i = 0; i < FAN_OFF.length; i++) {
        const ndcX = Math.tan(FAN_OFF[i] * DEG) / (b.tanY * aspect)
        const fx = clamp01(ndcX * 0.5 + 0.5)
        gm.addColorStop(fx, `rgba(0,0,0,${horFan[i].toFixed(3)})`)
      }
      gm.addColorStop(1, `rgba(0,0,0,${horFan[FAN_OFF.length - 1].toFixed(3)})`)
      hazeCtx.fillStyle = gm
      hazeCtx.fillRect(0, 0, w, h)
      ctx.drawImage(hazeCv, 0, 0)
    }
  }

  // — Ebene 2: Sterne —
  // Welt-verankert (Projektion aus derselben Basis) ⇒ bewegen sich korrekt mit dem
  // Blick, kleben nicht am Screen. Erscheinen erst in tiefer Dämmerung.
  function drawStars(b) {
    // Dichte Bewölkung/Nebel verdecken die Sterne; einzelne lockere Wolken kaum
    const nightFactor = (sun ? smoothstep(-6, -14, sun.altitude) : 0) *
      (1 - smoothstep(0.25, 0.85, wxCur.cover) * 0.97) * (1 - wxCur.fog * 0.95)
    if (nightFactor < 0.02) return
    ctx.save()
    for (const st of stars) {
      const p = project(st.dir, b)
      if (!p) continue
      if (p.ndcX < -1.05 || p.ndcX > 1.05 || p.ndcY < -1.05 || p.ndcY > 1.05) continue
      // dicht am Horizont ausblenden (dort ist Dunst, Sterne kaum sichtbar) — schmales Band
      const horizFade = smoothstep(b.horizonRenderNdcY + 0.01, b.horizonRenderNdcY + 0.09, p.ndcY)
      if (horizFade <= 0) continue
      // Funkeln: jeder Stern eigene Frequenz/Phase (Grundhelligkeit bleibt sichtbar)
      const tw = 0.5 + 0.5 * Math.sin(twinkle * st.tw + st.ph)
      const a = nightFactor * horizFade * (0.4 + 0.6 * st.mag) * (0.5 + 0.5 * tw)
      if (a < 0.02) continue
      const r = 0.55 + 1.05 * st.mag // klein und rund (keine kastigen Quadrate)
      ctx.globalAlpha = Math.min(1, a)
      ctx.fillStyle = st.warm ? '#fff2e0' : st.mag > 0.72 ? '#eef2ff' : '#dbe3f0'
      ctx.beginPath(); ctx.arc(p.sx, p.sy, r, 0, Math.PI * 2); ctx.fill()
      if (st.mag > 0.9) {
        // nur die ganz wenigen hellsten: sehr zarter, kleiner Schein
        ctx.globalAlpha = Math.min(1, a) * 0.28
        ctx.beginPath(); ctx.arc(p.sx, p.sy, r * 2.6, 0, Math.PI * 2); ctx.fill()
      }
    }
    ctx.restore()
  }

  // — Ebene 0: Tonwert-/Farbstimmung —
  // Dünner, ganzflächiger Farbschleier aus Himmel- (oben) und Horizontfarbe (unten),
  // der sich über die GANZE Szene (auch das Satellitenbild) legt — zur Golden/Blauen
  // Stunde warm, nachts tiefblau. Erst dadurch wird der Tageszeit-Wechsel auf dem sonst
  // nur über Helligkeit/Sättigung gegradeten Boden als echte Lichtfarbe sichtbar.
  // Tagsüber praktisch 0 (kein Filterlook).
  function drawGrade(b) {
    if (!sun) return
    const alt = sun.altitude
    const warm = smoothstep(12, -1, alt) * (1 - smoothstep(-3, -12, alt)) // Golden/Blaue Stunde
    const night = smoothstep(-3, -13, alt)
    const a = 0.15 * warm + 0.2 * night
    if (a < 0.012) return
    const [hr, hg, hbl] = sky.hor
    const [sr, sg, sbl] = sky.skyc
    const hStop = clamp(0.5 - b.horizonRenderNdcY * 0.5, 0.02, 0.98) // Horizont als Verlaufsstop
    const grad = ctx.createLinearGradient(0, 0, 0, h)
    grad.addColorStop(0, `rgba(${sr},${sg},${sbl},${a})`)
    grad.addColorStop(hStop, `rgba(${hr},${hg},${hbl},${a})`)
    grad.addColorStop(1, `rgba(${hr},${hg},${hbl},${a * 0.65})`)
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, w, h)
  }

  // — Ebene 3: Sonne + Glut —
  // Fotorealistisch statt „Sticker" (kompletter Umbau nach User-Feedback):
  // 1) Die Scheibe hat ihre ECHTE Winkelgröße (~0,5° Durchmesser, leicht vergrößert
  //    durch Überstrahlung). Das frühere Riesen-Oval (bis 3,5°) war der Hauptgrund
  //    für den künstlichen Look — Präsenz entsteht jetzt über die Glare-Profile.
  // 2) Überstrahlung als PSF: enge Aureole (exponentieller Abfall) + weiter Schleier
  //    (flacher Auslauf), beide über VIELE Gradient-Stops abgetastet — die alten
  //    3-Stop-Halos zeichneten sichtbare Ringe um die Sonne.
  // 3) Vertikal am GERENDERTEN Horizont verankert: alt 0° ⇒ Unterrand küsst die
  //    Boden-Himmel-Kante der Karte. Astronomisch projiziert schwebte die Scheibe
  //    beim Untergang sichtbar ÜBER der Kante (MapLibres Horizont liegt unterm
  //    Fluchtpunkt) — „geht in der Luft unter". Horizontal bleibt der echte Azimut.
  // 4) KEIN An/Aus: alle Größen stetige Funktionen von Höhe/Bildposition; Gradienten
  //    zeichnen auch mit Mittelpunkt außerhalb des Canvas und gleiten herein.
  // 5) Beugungs-Spikes GESTRICHEN (offene Blende hat keine — sie schrien „Computer-
  //    grafik"), Blendenreflexe nur noch als leise Andeutung.
  const MAX_EDGE = 2.6
  // Radialer Verlauf aus einer Profilfunktion (N Stops, letzter exakt 0 — kein Ring)
  function glareGradient(x, y, r, rgb, aPeak, profile) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    const N = 10
    for (let i = 0; i <= N; i++) {
      const t = i / N
      const av = i === N ? 0 : aPeak * profile(t)
      g.addColorStop(t, `rgba(${rgb},${av.toFixed(4)})`)
    }
    return g
  }
  function drawSun(b) {
    if (!sun || sun.altitude < -10) return
    const alt = sun.altitude
    const p = project(sunDirENU(alt, sun.azimuth), b)
    if (!p) return // hinter der Kamera
    // Vertikal am gerenderten Horizont verankern (Kopfkommentar Punkt 3): Höhe über
    // der Kante = tan(Sonnenhöhe) im selben Maßstab wie die Kamera-Projektion
    const ndcY = b.horizonRenderNdcY + Math.tan(alt * DEG) / b.tanY
    const sx = p.sx
    const sy = (0.5 - ndcY * 0.5) * h
    const edge = Math.max(Math.abs(p.ndcX), Math.abs(ndcY))
    if (edge > MAX_EDGE) return

    const col = sunColor(alt)
    const D = Math.min(w, h)
    const pxPerRad = (h / 2) / b.tanY
    const lowSun = 1 - clamp01((alt - 1) / 18) // 1 am/unter Horizont → 0 hoch oben
    const nearSet = smoothstep(6, 0.5, alt) // erst kurz vor dem Untergang (Säule, Streak, Abflachung)
    const outFade = 1 - smoothstep(1.9, MAX_EDGE, edge) // weit außerhalb des Bildes sanft ausblenden

    // Verdeckungslinie = die GERENDERTE Boden-Himmel-Kante (aus basisFrom), PLUS der
    // Gelände-Silhouetten-Überstand am Sonnen-Azimut (occRise, DEM-Sonde): im Gebirge
    // versinkt die Scheibe hinter dem Grat, nicht an der flachen Mercator-Linie —
    // Glut-Band und Säule rücken mit auf die Silhouette (Grat-Glühen).
    const horizonNdcY = b.horizonRenderNdcY + occRise
    const hy = (0.5 - horizonNdcY * 0.5) * h
    const clipTop = clamp(hy, 0, h)

    // Echte Winkelgröße: Sonnenradius 0,27°, plus Überstrahlungs-Zuschlag (die
    // ausgebrannte Scheibe einer Kamera wirkt etwas größer, zum Horizont mehr)
    const discR = pxPerRad * (0.0085 + 0.0055 * lowSun)
    const discNdc = discR / (h * 0.5)
    // Sichtbarkeit beim Versinken hängt an der Scheibengröße: weg ist sie erst,
    // wenn der Oberrand unter der sichtbaren Kante liegt
    const rel = ndcY - horizonNdcY
    const discVis = smoothstep(-(discNdc + 0.015), -discNdc * 0.2, rel)
    // Bewölkung/Nebel dämpfen das direkte Sonnenlicht (Scheibe stärker als Glut).
    // `direct` = wie viel UNGESTREUTES Licht durchkommt — gesteuert von sunOcc, dem
    // ECHTEN Wolken-Alpha an der Sonnenposition (in drawClouds abgetastet): zieht
    // eine Lücke vorbei, bricht die Sonne durch; hängt ein Ballen davor, bleibt nur
    // ein diffuser heller Fleck in der Decke (unten separat gezeichnet). Pauschal
    // über die Deckung gerechnet war beides falsch — „wolkig" hat meist freie Sonne.
    const wxDim = (1 - 0.6 * sunOcc) * (1 - wxCur.fog * 0.85)
    const direct = (1 - smoothstep(0.12, 0.7, sunOcc)) * (1 - smoothstep(0.15, 0.7, wxCur.fog))
    const glow = smoothstep(5, -0.5, alt) * (1 - smoothstep(-3, -11, alt)) *
      (1 - 0.9 * smoothstep(0.35, 0.9, sunOcc)) * (1 - wxCur.fog * 0.7) // Glut/Afterglow ums Untergehen (sitzt auf der Silhouette)
    // Auf der Bergflanke UNTER dem Grat gibt es kein Wasser: Reflexion dort ausblenden
    const reflVis = 1 - smoothstep(0.015, 0.08, occRise)
    const a = discVis * outFade * wxDim // Leitwert: wie präsent ist die Scheibe gerade

    ctx.save()
    ctx.globalCompositeOperation = 'lighter'

    // Horizont-Glut: breites, flaches, warmes Band am Sonnen-Azimut auf der
    // sichtbaren Kante — baut sich erst NAHE am Untergang auf und trägt danach den
    // Afterglow. Weiches Profil (keine Ring-Stufen).
    if (glow > 0.01) {
      const gx = clamp(sx, -w * 0.3, w * 1.3)
      const gr = D * (0.95 + 0.55 * glow)
      ctx.save()
      ctx.translate(gx, hy); ctx.scale(1, 0.3); ctx.translate(-gx, -hy) // vertikal stauchen → Band
      ctx.fillStyle = glareGradient(gx, hy, gr, col, 0.34 * glow * outFade, (t) => Math.exp(-4 * t))
      ctx.beginPath(); ctx.arc(gx, hy, gr, 0, Math.PI * 2); ctx.fill()
      ctx.restore()
    }

    // Lichtsäule + Reflexion: schmale, hohe Ellipsen-Blobs — das Abstrahlen läuft
    // bis AN die Kante und als Glitzern auf dem Wasser darunter weiter.
    if (hy > -h * 0.2 && hy < h * 1.3) {
      const gx = clamp(sx, -w * 0.25, w * 1.25)
      const colW = discR * (3.2 + 2.4 * nearSet)
      const blob = (cy, rx, ry, aa) => {
        if (aa < 0.01 || ry < 1) return
        ctx.save()
        ctx.translate(gx, cy)
        ctx.scale(rx / ry, 1)
        ctx.fillStyle = glareGradient(0, 0, ry, col, aa, (t) => Math.exp(-3.4 * t))
        ctx.beginPath(); ctx.arc(0, 0, ry, 0, Math.PI * 2); ctx.fill()
        ctx.restore()
      }
      if (nearSet > 0.02 && hy > sy + discR * 0.5)
        blob((sy + hy) / 2, colW, Math.max((hy - sy) * 0.62, discR), 0.1 * nearSet * a) // Säule Scheibe→Silhouette
      blob(hy, colW * 1.6, h * 0.045, 0.12 * glow * outFade) // Aufsetzpunkt (Grat-/Horizontlinie)
      blob(hy + h * 0.07, colW, h * 0.085, 0.09 * glow * outFade * reflVis) // Wasser-Reflexion (nicht auf Fels)
    }

    if (a > 0.01) {
      // 1) PSF-Überstrahlung, bewusst UNGECLIPPT (Streulicht kennt keine Horizont-
      //    linie): enge Aureole (direktes Licht — hinter Wolken fast weg) + weiter,
      //    sehr flacher Schleier (gestreutes Licht, kommt teilweise durch die Decke).
      const aurR = discR * (7 + 5 * lowSun)
      const aurA = a * (0.2 + 0.32 * lowSun) * (0.2 + 0.8 * direct)
      ctx.fillStyle = glareGradient(sx, sy, aurR, col, aurA, (t) => Math.exp(-5 * Math.pow(t, 1.15)))
      ctx.beginPath(); ctx.arc(sx, sy, aurR, 0, Math.PI * 2); ctx.fill()

      const veilR = D * (0.24 + 0.22 * lowSun)
      const veilA = a * 0.08 * (0.4 + 0.6 * direct)
      ctx.fillStyle = glareGradient(sx, sy, veilR, col, veilA, (t) => Math.exp(-3 * Math.pow(t, 0.85)) * (1 - t))
      ctx.beginPath(); ctx.arc(sx, sy, veilR, 0, Math.PI * 2); ctx.fill()

      // 2) Scheibe: das EINZIGE an der sichtbaren Kante geclippte Element (sie
      //    versinkt wirklich, ihr Licht nicht). Winzig-weiche Kante (~12 % des
      //    Radius), ausgebrannter Kern, zum Untergang warm und leicht oval
      //    (Refraktion staucht die Scheibe vertikal).
      ctx.save()
      ctx.beginPath(); ctx.rect(0, 0, w, clipTop); ctx.clip()
      const dA = a * direct
      if (dA > 0.01) {
        const core = `255,${Math.round(255 - 35 * nearSet)},${Math.round(252 - 74 * nearSet)}`
        ctx.save()
        ctx.translate(sx, sy); ctx.scale(1, 1 - 0.18 * nearSet); ctx.translate(-sx, -sy)
        const disc = ctx.createRadialGradient(sx, sy, 0, sx, sy, discR)
        disc.addColorStop(0, `rgba(${core},${dA})`)
        disc.addColorStop(0.72, `rgba(${core},${dA})`)
        disc.addColorStop(0.88, `rgba(${col},${0.88 * dA})`)
        disc.addColorStop(1, `rgba(${col},0)`)
        ctx.fillStyle = disc
        ctx.beginPath(); ctx.arc(sx, sy, discR, 0, Math.PI * 2); ctx.fill()
        ctx.restore()
      }

      // Diffuser Lichtfleck HINTER der Wolkendecke: die Decke leuchtet dort durch,
      // wo die Sonne steht — breit, konturlos, kaum gefärbt (Streuung frisst die
      // Röte). Bei GANZ geschlossener Decke (cover→1) verschwindet auch er.
      const diffuse = (1 - direct) * discVis * outFade * (1 - wxCur.dark * 0.6) *
        smoothstep(-4, 1, alt) * (1 - smoothstep(0.9, 1, wxCur.cover))
      if (diffuse > 0.02) {
        const dr = discR * (9 + 7 * (1 - direct))
        ctx.fillStyle = glareGradient(sx, sy, dr, '255,250,240', 0.18 * diffuse, (t) => Math.exp(-2.6 * t))
        ctx.beginPath(); ctx.arc(sx, sy, dr, 0, Math.PI * 2); ctx.fill()
      }
      ctx.restore() // Clip-Ende

      // 3) Flacher, warmer Streak durchs Gegenlicht — sehr subtil, ungeclippt
      const streakA = 0.055 * nearSet * a * direct
      if (streakA > 0.01) {
        const sw = D * (0.45 + 0.35 * nearSet)
        ctx.save()
        ctx.translate(sx, sy); ctx.scale(1, 0.035)
        ctx.fillStyle = glareGradient(0, 0, sw, col, streakA, (t) => Math.exp(-3 * t))
        ctx.beginPath(); ctx.arc(0, 0, sw, 0, Math.PI * 2); ctx.fill()
        ctx.restore()
      }

      // 4) Blendenreflexe: nur noch eine leise Andeutung (drei schwache Ghosts auf
      //    der Achse Sonne→Bildmitte) — kräftige bunte Reflexe schrien „Filter".
      const ghostFade = (1 - smoothstep(0.75, 1.02, edge)) * a * direct * 0.5
      if (ghostFade > 0.02) {
        const dx = w / 2 - sx, dy = h / 2 - sy
        const ghosts = [
          { t: 0.45, r: 0.016, ga: 0.055, tint: '255,222,185' },
          { t: 0.95, r: 0.034, ga: 0.04, tint: '195,215,250' },
          { t: 1.4, r: 0.05, ga: 0.045, tint: '255,208,170', ring: true },
        ]
        for (const gh of ghosts) {
          const gx = sx + dx * gh.t, gy = sy + dy * gh.t
          const gr = D * gh.r
          const ga = gh.ga * ghostFade
          const grad = gh.ring
            ? ctx.createRadialGradient(gx, gy, gr * 0.62, gx, gy, gr)
            : ctx.createRadialGradient(gx, gy, 0, gx, gy, gr)
          if (gh.ring) {
            grad.addColorStop(0, `rgba(${gh.tint},0)`)
            grad.addColorStop(0.5, `rgba(${gh.tint},${ga})`)
            grad.addColorStop(1, `rgba(${gh.tint},0)`)
          } else {
            grad.addColorStop(0, `rgba(${gh.tint},${ga})`)
            grad.addColorStop(0.7, `rgba(${gh.tint},${ga * 0.5})`)
            grad.addColorStop(1, `rgba(${gh.tint},0)`)
          }
          ctx.fillStyle = grad
          ctx.beginPath(); ctx.arc(gx, gy, gr, 0, Math.PI * 2); ctx.fill()
        }
      }
    }
    ctx.restore()
  }

  // — Ebene 4: Wolkenschicht —
  // Zwei driftende Ebenen aus kachelbarem Rauschen im Himmelsband (über der
  // gerenderten Horizontlinie). Horizontal am Kamera-Bearing verankert (Schwenks
  // bewegen die Wolken korrekt), VERTIKAL WINKEL-verankert wie Sonne/Sterne: das
  // Band hat eine feste Pixel-Höhe (≈35° über dem Horizont) und klebt an der
  // Horizontlinie. Früher wurde es auf die sichtbare Himmelshöhe (skyH) gestaucht —
  // beim Kamerakippen streckte sich dieselbe Textur sichtbar mit („die Wolken
  // ziehen sich nach oben auf", User-Feedback). Jetzt bewegt es sich starr mit
  // dem Horizont; kippt die Kamera, kommt einfach MEHR Band ins Bild.
  // Farbe folgt der Tag/Nacht-Regie; zur Golden Hour glühen die Wolken um die Sonne
  // warm an (source-atop-Pass). Deckung/Schwere kommen vom Wetter-Umschalter.
  function drawClouds(b, dt) {
    cloudT += dt
    const cover = wxCur.cover
    if (cover < 0.02) { sunOccTgt = 0; return }
    const hy = (0.5 - b.horizonRenderNdcY * 0.5) * h
    const hyV = Math.min(hy, h) // sichtbare Band-Unterkante
    if (hyV < 14) { sunOccTgt = cover * 0.9; return } // Kamera schaut nach unten — kein Himmel im Bild, Deckung als Näherung
    if (!cloudTiers) {
      // 2 Rauschlagen × 3 Formstufen: das teure Rauschfeld wird je Lage nur EINMAL
      // gerechnet, die Stufen sind billige Schwellwert-Bakes daraus
      cloudTiers = [0x9e3779b9, 0x1234567].map((seed) => {
        const f = makeCloudNoise(seed)
        return CLOUD_TIERS.map(([lo, hi]) => cloudTileFrom(f, lo, hi))
      })
    }
    if (!cloudCv) {
      cloudCv = document.createElement('canvas')
      cloudCv.width = w
      cloudCv.height = h
      // Die Sonnen-Abtastung (unten) liest jedes Frame ein paar Pixel zurück
      cloudCtx = cloudCv.getContext('2d', { willReadFrequently: true })
    }
    const cc = cloudCtx
    // Feste Winkelhöhe: tan(35°)·pxPerRad — unabhängig von der Himmelshöhe im Bild
    const pxPerRad = (h / 2) / b.tanY
    const bandH = Math.ceil(pxPerRad * Math.tan(35 * DEG))
    const bandTop = Math.round(hy) - bandH
    const fy0 = Math.max(bandTop, 0) // sichtbarer Band-Ausschnitt für die Füll-Pässe
    const fH = Math.min(hyV + 2, h) - fy0
    if (fH <= 0) { sunOccTgt = cover * 0.9; return }
    cc.clearRect(0, 0, w, h)
    // Bearing-Anker: Grad → Pixel über das horizontale Sichtfeld
    const cam = getCam?.()
    const bearing = cam ? cam.bearing : 0
    const fovX = (2 * Math.atan(b.tanY * aspect)) / DEG
    const pxDeg = w / fovX
    cc.globalCompositeOperation = 'source-over'
    // Formstufen-Blend: die Deckung wählt die WOLKENFORM (locker → aufgerissen →
    // geschlossen), die Gesamt-Alpha unten bleibt früh voll da — wenige Wolken sind
    // wenige SATTE Ballen, nicht ein transparenter Schleier überall. Anker an den
    // UI-Stufen: ~0.25 locker pur, ~0.6 aufgerissen pur, ≥0.95 geschlossen pur.
    const tierA = cover < 0.6 ? 0 : 1
    const u = cover < 0.6 ? smoothstep(0.25, 0.6, cover) : smoothstep(0.6, 0.95, cover)
    const layers = [
      { sc: 1.15, sp: 3.5, al: 0.85, ti: 0 }, // hohe, weiche Decke — zieht langsam
      { sc: 0.72, sp: 8, al: 0.7, ti: 1 }, // nähere Ballen — ziehen schneller
    ]
    for (const L of layers) {
      const tiles = cloudTiers[L.ti]
      const tw = Math.max(260, w * L.sc)
      let xo = (-(bearing * pxDeg) - cloudT * L.sp) % tw
      if (xo > 0) xo -= tw
      for (let x = xo; x < w; x += tw) {
        if (u < 0.995) {
          cc.globalAlpha = L.al * (1 - u)
          cc.drawImage(tiles[tierA], x, bandTop, tw, bandH)
        }
        if (u > 0.005) {
          cc.globalAlpha = L.al * u
          cc.drawImage(tiles[tierA + 1], x, bandTop, tw, bandH)
        }
      }
    }
    cc.globalAlpha = 1
    // Vertikale Formung IM BAND (winkelfest, kippt mit der Kamera mit): zum
    // Horizont ausdünnend — bei geschlossener Decke bleibt sie bis an den
    // Horizont dicht (bedeckter Himmel hat keine freie Horizontlücke), erst dann
    // übernimmt der Haze. Zur Band-OBERKANTE (≈35°, nur in steilen Intro-Posen
    // im Bild) läuft das Alpha auf 0 aus — sonst stünde dort eine sichtbare
    // Abschlusskante der Wolkentextur.
    const closed = smoothstep(0.55, 0.95, cover)
    cc.globalCompositeOperation = 'destination-in'
    const m = cc.createLinearGradient(0, bandTop, 0, hy)
    m.addColorStop(0, 'rgba(0,0,0,0)')
    m.addColorStop(0.15, 'rgba(0,0,0,0.85)')
    m.addColorStop(0.35, 'rgba(0,0,0,1)')
    m.addColorStop(0.87, 'rgba(0,0,0,0.92)')
    m.addColorStop(0.96, `rgba(0,0,0,${(0.3 + 0.62 * closed).toFixed(3)})`)
    m.addColorStop(1, `rgba(0,0,0,${(0.88 * closed).toFixed(3)})`)
    cc.fillStyle = m
    cc.fillRect(0, fy0, w, fH)
    // Einfärbung: Tag hellgrau, Golden Hour warm (Horizontfarbe), Nacht dunkles Blaugrau;
    // „dark" (Regen/Gewitter) senkt die Luminanz zusätzlich.
    const alt = sun ? sun.altitude : 20
    const dayF = smoothstep(-9, 5, alt)
    const warm = smoothstep(10, -1, alt) * (1 - smoothstep(-3, -10, alt))
    const dk = wxCur.dark
    const lum = (0.3 + 0.7 * dayF) * (1 - 0.52 * dk)
    const [hr, hg, hb] = sky.hor
    const mixc = (base, tint, t) => Math.round(base * (1 - t) + tint * t)
    const cr = mixc(236 * lum, hr, warm * 0.45)
    const cg = mixc(238 * lum, hg, warm * 0.45)
    const cb = mixc(243 * lum, hb, warm * 0.45)
    cc.globalCompositeOperation = 'source-in'
    cc.fillStyle = `rgb(${cr},${cg},${cb})`
    cc.fillRect(0, fy0, w, fH)
    // Sonne in der Decke: Wolken leuchten um die Sonnenposition auf (nur auf
    // vorhandene Wolkenpixel). Tagsüber neutral-hell (die Decke ist dort dünner/
    // durchleuchtet), zur Golden Hour zusätzlich warm gefärbt.
    if (sun && alt > -4) {
      const ps = project(sunDirENU(sun.altitude, sun.azimuth), b)
      if (ps) {
        const D = Math.min(w, h)
        cc.globalCompositeOperation = 'source-atop'
        // Bei GESCHLOSSENER Decke leuchtet um die Sonne kaum noch etwas auf —
        // dicke Bewölkung streut das Licht gleichmäßig (User: „ganz bedeckt =
        // gar keine Sonne"), nur dünne/aufgerissene Decken glühen lokal.
        const thick = smoothstep(0.8, 1, cover)
        const bright = 0.34 * dayF * (1 - dk * 0.75) * (1 - 0.75 * thick)
        if (bright > 0.02) {
          const gN = cc.createRadialGradient(ps.sx, ps.sy, 0, ps.sx, ps.sy, D * 0.5)
          gN.addColorStop(0, `rgba(255,252,246,${bright.toFixed(3)})`)
          gN.addColorStop(0.4, `rgba(255,252,246,${(0.35 * bright).toFixed(3)})`)
          gN.addColorStop(1, 'rgba(255,252,246,0)')
          cc.fillStyle = gN
          cc.fillRect(0, fy0, w, fH)
        }
        if (warm > 0.03) {
          const col = sunColor(alt)
          const wA = warm * (1 - dk * 0.4) * (1 - 0.7 * thick)
          const g = cc.createRadialGradient(ps.sx, ps.sy, 0, ps.sx, ps.sy, D * 0.85)
          g.addColorStop(0, `rgba(${col},${0.5 * wA})`)
          g.addColorStop(0.5, `rgba(${col},${0.18 * wA})`)
          g.addColorStop(1, `rgba(${col},0)`)
          cc.fillStyle = g
          cc.fillRect(0, fy0, w, fH)
        }
      }
    }
    // Gesamt-Alpha: blendet nur das EINSETZEN weich (die Dichte-Optik kommt aus den
    // Formstufen oben — min(1, cover) machte wenige Wolken zu Geisterschleiern)
    const compA = Math.min(1, smoothstep(0.02, 0.26, cover))
    // Direktlicht-Abtastung: Wolken-Alpha an der Sonnenposition (5×5-Mittel).
    // drawSun (nächstes Frame, VOR den Wolken gezeichnet) koppelt Scheibe/Halo/
    // Flare daran — die Sonne bricht durch Lücken und verschwindet hinter Ballen.
    if (sun) {
      const ps = project(sunDirENU(sun.altitude, sun.azimuth), b)
      if (ps && ps.sx > 2 && ps.sx < w - 3 && ps.sy > 2 && ps.sy < Math.min(hyV + 30, h - 3)) {
        const px = cc.getImageData(Math.round(ps.sx) - 2, Math.round(ps.sy) - 2, 5, 5).data
        let s = 0
        for (let i = 3; i < px.length; i += 4) s += px[i]
        sunOccTgt = (s / (px.length / 4) / 255) * compA
      } else {
        sunOccTgt = cover * 0.9 * compA // Sonne außerhalb des Bandes: Deckung als Näherung
      }
    }
    ctx.save()
    ctx.globalAlpha = compA
    ctx.drawImage(cloudCv, 0, 0)
    ctx.restore()
  }

  // — Ebene 4b: Overcast-Dimmung —
  // Bedeckter Himmel dimmt auch den BODEN (das Satellitenbild bleibt sonst sonnig-
  // hell unter grauer Decke — v. a. im Modus „Wolkig", der kein Partikel-Canvas hat).
  // Kühles Grau, Stärke folgt der Wolken-Schwere; die Partikel-Modi legen in
  // weather.js nur noch einen abgeschwächten Rest-Wash darüber.
  function drawOvercast() {
    // Schwere (dark) UND geschlossene Decke (cover) dimmen: ein bedeckter Himmel
    // nimmt dem Boden das direkte Sonnenlicht, auch ohne Regenwolken-Schwere
    const a = 0.16 * wxCur.dark + 0.1 * smoothstep(0.6, 1, wxCur.cover)
    if (a < 0.02) return
    ctx.fillStyle = `rgba(38,44,54,${a.toFixed(3)})`
    ctx.fillRect(0, 0, w, h)
  }

  // — Ebene 5: Nebel —
  // Milchiger Schleier über der ganzen Szene, am dichtesten an der Horizontlinie
  // (dort frisst er die Ferne), nach oben und unten dünner. Farbe folgt der Tageszeit.
  function drawFog(b) {
    const f = wxCur.fog
    if (f < 0.02) return
    const hy = clamp((0.5 - b.horizonRenderNdcY * 0.5) * h, -h * 0.5, h * 1.5)
    const alt = sun ? sun.altitude : 20
    const dayF = 0.32 + 0.68 * smoothstep(-9, 5, alt)
    const [hr, hg, hb] = sky.hor
    const r = Math.round((225 * 0.72 + hr * 0.28) * dayF)
    const g = Math.round((228 * 0.72 + hg * 0.28) * dayF)
    const bl = Math.round((233 * 0.72 + hb * 0.28) * dayF)
    const grad = ctx.createLinearGradient(0, 0, 0, h)
    const hStop = clamp(hy / h, 0.03, 0.97)
    grad.addColorStop(0, `rgba(${r},${g},${bl},${0.22 * f})`)
    grad.addColorStop(hStop, `rgba(${r},${g},${bl},${0.8 * f})`)
    grad.addColorStop(1, `rgba(${r},${g},${bl},${0.5 * f})`)
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, w, h)
  }

  const api = {
    setSun: (s) => { sun = s },
    // Debug-Einblick (window.__j-Konvention): innere Zustände + aktuelle Projektion
    _dbg: () => {
      const b = lastPose ? basisFrom(lastPose) : null
      const p = b && sun ? project(sunDirENU(sun.altitude, sun.azimuth), b) : null
      return {
        sun, camAlt, horVis, horVisTgt, occRise, occRiseTgt, sunOcc, sunOccTgt,
        horFan: horFan.map((v) => +v.toFixed(2)),
        wxCur: { ...wxCur },
        horizonRenderNdcY: b?.horizonRenderNdcY, sunNdcY: p?.ndcY, sunEdge: p ? Math.max(Math.abs(p.ndcX), Math.abs(p.ndcY)) : null,
      }
    },
    setFov: (deg) => { fovDeg = deg },
    // Wetter-Himmel vom Umschalter: { cover, dark, fog } je 0..1 — wirkt weich (wxCur)
    setWeather: (o) => { wx = { cover: o?.cover ?? 0, dark: o?.dark ?? 0, fog: o?.fog ?? 0 } },
    // Pause-Gate (geteilt mit weather.js): friert die Wolken-Drift ein
    setGate: (fn) => { animGate = fn },
    // DEM-Sonde für die Horizont-Sichtbarkeit: (lng, lat) => Szenenhöhe (überhöht) | null
    setTerrain: (fn) => { terrainQ = fn },
    // Zugriff auf die echte Render-Kamera (MapLibre getPitch/getBearing) — Pflicht für
    // eine korrekte Basis, weil MapLibre den Pitch clampt (s. basisFrom).
    setCamera: (fn) => { getCam = fn },
    // Himmelfarben aus der Tag/Nacht-Regie (daynight paramsAt): Horizont-/Himmel-
    // farbe treiben Saum/Grade, die FOG-Farbe die Boden-Seite des Dunsts (muss zum
    // Terrain-Fog passen, sonst ist die Bandkante als Schicht sichtbar). Erwartet
    // 'rgb(r,g,b)' oder '#rrggbb'; fogColor optional (Fallback: Horizontfarbe).
    setSky: (horColor, skyColor, fogColor) => {
      const parse = (c) => {
        if (!c) return null
        if (c[0] === '#') return hex(c)
        const m = c.match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/)
        return m ? [+m[1], +m[2], +m[3]] : null
      }
      const hor = parse(horColor) || sky.hor
      sky = { hor, skyc: parse(skyColor) || sky.skyc, fogc: parse(fogColor) || hor }
    },
    // pose = { cg:[lng,lat], alt, lt:[lng,lat], ltAlt } — wie tour.js applyCamera liefert.
    // dt wird intern gemessen (tour.onPose liefert keins) → korrekte Glättung/Funkeln.
    render(pose) {
      if (!(w > 0 && h > 0)) return // vor dem ersten Layout / im Hintergrund-Tab: nichts zu zeichnen
      lastPose = pose
      lastRenderAt = performance.now()
      camAlt = pose.alt || 0
      const b = basisFrom(pose)
      if (!b) return clear()
      const now = performance.now()
      let dt = (now - lastT) / 1000
      lastT = now
      // Großzügige Obergrenze: der Idle-Tick darf gedrosselt laufen (0,2–1 s sind
      // legitime Frame-Abstände in Pause/Hintergrund); die exponentielle Glättung
      // bleibt bei großem dt stabil. Nur echte Ausreißer (Tab-Rückkehr) kappen.
      if (!(dt > 0) || dt > 1.5) dt = 0.016
      twinkle += dt * 2.5
      // Wetter-Himmel weich ans Ziel blenden (Umschalten ohne harten Schnitt)
      const kw = 1 - Math.exp(-dt / 1.2)
      wxCur.cover += (wx.cover - wxCur.cover) * kw
      wxCur.dark += (wx.dark - wxCur.dark) * kw
      wxCur.fog += (wx.fog - wxCur.fog) * kw
      // Horizont-Sichtbarkeit (gedrosselt — 2×6 DEM-Lookups) weich nachziehen:
      // einmal am Blick-Bearing (Dunst-Band), einmal am Sonnen-Azimut (die Scheibe
      // versinkt an der GELÄNDE-Silhouette, nicht an der flachen Mercator-Linie)
      if (now - lastProbe > 120) {
        lastProbe = now
        horFanTgt = probeFan(pose, b)
        horVisTgt = horFanTgt.reduce((s, v) => s + v, 0) / horFanTgt.length
        occRiseTgt = 0
        if (sun && sun.altitude > -10) {
          const rp = probeRay(pose, b, sun.azimuth * DEG)
          if (rp) occRiseTgt = Math.max(0, rp.ndcY - silhouetteFloor(b))
        }
      }
      horVis += (horVisTgt - horVis) * (1 - Math.exp(-dt / 0.55))
      for (let i = 0; i < horFan.length; i++) horFan[i] += (horFanTgt[i] - horFan[i]) * (1 - Math.exp(-dt / 0.55))
      occRise += (occRiseTgt - occRise) * (1 - Math.exp(-dt / 0.35))
      // Direktlicht weich nachziehen: Wolken ziehen gemächlich — das Aufbrechen/
      // Verschwinden der Sonne hinter einem Ballen ist ein weiches Ereignis
      sunOcc += (sunOccTgt - sunOcc) * (1 - Math.exp(-dt / 0.5))
      clear()
      drawGrade(b)
      drawOvercast()
      drawHaze(b)
      drawStars(b)
      drawSun(b)
      // In der Pause steht die Wolken-Drift (dt 0) — die Wetter-Blende oben läuft
      // weiter, damit ein Umschalten im Pause-Modus trotzdem sichtbar einblendet.
      drawClouds(b, (animGate ? !!animGate() : true) ? dt : 0) // Wolken VOR der Sonne (sie verdecken die Scheibe)
      drawFog(b) // Nebel liegt vor allem
    },
  }

  // Idle-Nachrendern: tour.onPose feuert nur, wenn sich die Kamera bewegt — in der
  // PAUSE fror das Overlay ein (Wetterwechsel blendete nicht, Wolken standen still,
  // Sterne funkelten nicht). Ruht onPose, rendert dieser Tick mit der letzten Pose
  // weiter (~14 fps reichen für Drift/Blenden und kosten fast nichts). Bewusst
  // setInterval statt rAF: rAF wird ohne Paint-Arbeit (Pause, headless) auf 1 fps
  // gedrosselt; der lastRenderAt-Guard verhindert Doppel-Rendern bei Wiedergabe.
  setInterval(() => {
    if (!lastPose) return
    if (performance.now() - lastRenderAt < 70) return
    api.render(lastPose)
  }, 70)

  return api
}
