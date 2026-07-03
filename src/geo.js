// Geometrie-Helfer: Haversine, Kurswinkel, Catmull-Rom-Glättung, gleichmäßiges Resampling.
const D2R = Math.PI / 180
const R = 6371000

export function dist(a, b) {
  const dLat = (b[1] - a[1]) * D2R
  const dLng = (b[0] - a[0]) * D2R
  const la1 = a[1] * D2R
  const la2 = b[1] * D2R
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export function bearing(a, b) {
  const la1 = a[1] * D2R
  const la2 = b[1] * D2R
  const dLng = (b[0] - a[0]) * D2R
  const y = Math.sin(dLng) * Math.cos(la2)
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLng)
  return (Math.atan2(y, x) / D2R + 360) % 360
}

// Kürzeste Winkeldifferenz b−a in (−180, 180]
export function angleDelta(a, b) {
  return ((b - a + 540) % 360) - 180
}

// Zielpunkt: von `[lng, lat]` aus `distM` Meter in Richtung `bearingDeg`
export function destination([lng, lat], distM, bearingDeg) {
  const delta = distM / R
  const theta = bearingDeg * D2R
  const phi1 = lat * D2R
  const lambda1 = lng * D2R
  const phi2 = Math.asin(Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(theta))
  const lambda2 =
    lambda1 + Math.atan2(Math.sin(theta) * Math.sin(delta) * Math.cos(phi1), Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2))
  return [lambda2 / D2R, phi2 / D2R]
}

function cr(p0, p1, p2, p3, t) {
  const t2 = t * t
  const t3 = t2 * t
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
}

// Wegpunkte [lng, lat, ele] → geglättete, alle `step` Meter abgetastete Route
// mit kumulierten Distanzen. Catmull-Rom wirkt pro Dimension, daher direkt auf lng/lat/ele.
export function buildRoute(waypoints, step = 14) {
  const pts = [waypoints[0], ...waypoints, waypoints[waypoints.length - 1]]
  const dense = []
  const SEGS = 18
  for (let i = 0; i < pts.length - 3; i++) {
    for (let j = 0; j < SEGS; j++) {
      const t = j / SEGS
      dense.push([
        cr(pts[i][0], pts[i + 1][0], pts[i + 2][0], pts[i + 3][0], t),
        cr(pts[i][1], pts[i + 1][1], pts[i + 2][1], pts[i + 3][1], t),
        cr(pts[i][2], pts[i + 1][2], pts[i + 2][2], pts[i + 3][2], t),
      ])
    }
  }
  dense.push([...waypoints[waypoints.length - 1]])

  const coords = [dense[0]]
  const cum = [0]
  let travelled = 0
  let emitted = 0
  for (let i = 1; i < dense.length; i++) {
    const a = dense[i - 1]
    const b = dense[i]
    const d = dist(a, b)
    if (d === 0) continue
    while (travelled + d >= (emitted + 1) * step) {
      const t = ((emitted + 1) * step - travelled) / d
      coords.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t])
      cum.push((emitted + 1) * step)
      emitted++
    }
    travelled += d
  }
  coords.push(dense[dense.length - 1])
  cum.push(travelled)

  let gain = 0
  for (let i = 1; i < coords.length; i++) {
    const dEle = coords[i][2] - coords[i - 1][2]
    if (dEle > 0) gain += dEle
  }

  return { coords, cum, total: travelled, gain }
}

// Erster Stützpunkt-Index mit cum[i] >= s (binäre Suche)
export function indexAt(route, s) {
  const { cum } = route
  let lo = 0
  let hi = cum.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (cum[mid] < s) lo = mid + 1
    else hi = mid
  }
  return lo
}

// Position [lng, lat, ele] bei Streckenmeter s
export function pointAt(route, s) {
  const { coords, cum, total } = route
  const c = Math.max(0, Math.min(s, total))
  const i = Math.max(1, indexAt(route, c))
  const a = coords[i - 1]
  const b = coords[i]
  const span = cum[i] - cum[i - 1] || 1
  const t = (c - cum[i - 1]) / span
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

export function bearingAt(route, s) {
  const a = pointAt(route, s)
  const b = pointAt(route, Math.min(s + 30, route.total))
  if (dist(a, b) < 1) return bearing(pointAt(route, Math.max(0, s - 30)), a)
  return bearing(a, b)
}

// Streckenmeter des Punktes, der `lnglat` am nächsten liegt
export function nearestS(route, lnglat) {
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < route.coords.length; i++) {
    const d = dist(route.coords[i], lnglat)
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return route.cum[best]
}
