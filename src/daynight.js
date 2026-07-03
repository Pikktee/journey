// Tag/Nacht-Regie: Der (Pseudo-)Zeitstempel der Tour steuert über den echten
// Sonnenstand das Szenenlicht, den Himmel, das Grading des Satellitenbilds
// und die Fenster der Gebäude. Alles wird über der Sonnenhöhe geblendet —
// die Uhrzeit selbst spielt keine Rolle, nur wo die Sonne steht.
import { sunPosition } from './sun.js'

// Keyframes über der Sonnenhöhe (Grad): Nacht → Dämmerung → Goldene Stunde → Tag.
// br/sat graden das Satellitenbild (das bleibt eine Tagesaufnahme — „Nacht“ ist
// Abdunkelung + Entsättigung), sky/hor/fog färben die Atmosphäre, li/lc das Licht.
const KEYS = [
  { a: -14, br: 0.2, sat: -0.55, sky: '#0a1424', hor: '#141f33', fog: '#0c1220', li: 0.22, lc: '#93a7d4' },
  { a: -6, br: 0.34, sat: -0.42, sky: '#15254a', hor: '#4a3a5e', fog: '#252838', li: 0.28, lc: '#b3a3c9' },
  { a: 0, br: 0.6, sat: -0.18, sky: '#39557f', hor: '#e08a5a', fog: '#b98a72', li: 0.36, lc: '#ffb27a' },
  { a: 7, br: 0.86, sat: -0.04, sky: '#5f92c8', hor: '#e6c6a4', fog: '#dcc6ac', li: 0.42, lc: '#ffdfb3' },
  // Tag: Horizont UND Fog liegen jetzt nah am Himmelblau — kein abgesetzter grauer
  // Dunstbalken mehr. Der Himmel ist dann ein durchgehend weicher Blauverlauf, und
  // der Übergang zum Gelände ist ein natürlicher Horizont (Blau→Land) statt einer
  // sichtbaren Schleier-Kante. Genau darin lag der harte Übergang.
  { a: 16, br: 1, sat: 0, sky: '#7ab3e0', hor: '#9fc2e0', fog: '#a9cae2', li: 0.4, lc: '#ffedd6' },
]

const hex = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]
const mixHex = (a, b, t) => {
  const [ar, ag, ab] = hex(a)
  const [br_, bg, bb] = hex(b)
  const ch = (x, y) => Math.round(x + (y - x) * t)
  return `rgb(${ch(ar, br_)},${ch(ag, bg)},${ch(ab, bb)})`
}

function paramsAt(alt) {
  if (alt <= KEYS[0].a) return KEYS[0]
  if (alt >= KEYS[KEYS.length - 1].a) return KEYS[KEYS.length - 1]
  let i = 0
  while (KEYS[i + 1].a < alt) i++
  const lo = KEYS[i]
  const hi = KEYS[i + 1]
  const t = (alt - lo.a) / (hi.a - lo.a)
  return {
    br: lo.br + (hi.br - lo.br) * t,
    sat: lo.sat + (hi.sat - lo.sat) * t,
    li: lo.li + (hi.li - lo.li) * t,
    sky: mixHex(lo.sky, hi.sky, t),
    hor: mixHex(lo.hor, hi.hor, t),
    fog: mixHex(lo.fog, hi.fog, t),
    lc: mixHex(lo.lc, hi.lc, t),
  }
}

// setNight: Fassaden-Pattern + Dachfarben umschalten (map.js), überblendet
export function createDayNight(map, setNight) {
  let lastAlt = Infinity
  let lastApply = 0
  let night = false
  // Atmosphäre generell dezent — und im Flug-Zoombereich (13–16) fast flach, damit
  // der Dunst nicht „auf einen Schlag“ auftaucht, wenn die Kamera aufs offene Wasser
  // rauszieht (Zoomwechsel) oder sich der Horizont öffnet.
  const atmosphere = ['interpolate', ['linear'], ['zoom'], 8, 0.28, 12, 0.1, 14, 0.06, 16, 0.05]
  return (date, lnglat) => {
    const sun = sunPosition(date, lnglat[1], lnglat[0])
    // Die virtuelle Uhr läuft schnell (~3°/s Sonnenbewegung) — 2–4 Updates/s
    // reichen, die 300-ms-Paint-Transitionen glätten die Stufen
    const now = performance.now()
    if (Math.abs(sun.altitude - lastAlt) < 0.15 && now - lastApply < 1200) return
    lastAlt = sun.altitude
    lastApply = now
    const p = paramsAt(sun.altitude)
    map.setPaintProperty('satellite', 'raster-brightness-max', +p.br.toFixed(3))
    map.setPaintProperty('satellite', 'raster-saturation', +p.sat.toFixed(3))
    map.setLight({
      anchor: 'map',
      // Licht nie unter den Horizont lassen: nachts bleibt ein flaches,
      // kühles Restlicht (Mond-Ersatz) aus der letzten Sonnenrichtung
      position: [1.3, sun.azimuth, 90 - Math.min(Math.max(sun.altitude, 2), 82)],
      color: p.lc,
      intensity: +p.li.toFixed(3),
    })
    map.setSky({
      'sky-color': p.sky,
      'horizon-color': p.hor,
      'fog-color': p.fog,
      // Weiche, breite Blendzonen für einen fließenden Verlauf. fog-ground-blend
      // moderat (nicht hoch — hoch presst den Dunst zu einem schmalen Band an den
      // Horizont; wir wollen ihn gerade weich auslaufen lassen).
      'sky-horizon-blend': 0.7,
      'horizon-fog-blend': 0.7,
      'fog-ground-blend': 0.5,
      'atmosphere-blend': atmosphere,
    })
    // Fenster an/aus mit Hysterese, damit es in der Dämmerung nicht flackert
    const wantNight = night ? sun.altitude < -2 : sun.altitude < -4
    if (wantNight !== night) {
      night = wantNight
      setNight(night)
    }
  }
}
