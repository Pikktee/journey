// Tag/Nacht-Regie: Der (Pseudo-)Zeitstempel der Tour steuert über den echten
// Sonnenstand das Szenenlicht, den Himmel, das Grading des Satellitenbilds
// und die Fenster der Gebäude. Alles wird über der Sonnenhöhe geblendet —
// die Uhrzeit selbst spielt keine Rolle, nur wo die Sonne steht.
import { sunPosition } from './sun.js'

// Keyframes über der Sonnenhöhe (Grad): tiefe Nacht → nautische/blaue Dämmerung →
// Sonnenauf-/-untergang → goldene Stunde → Tag. br/sat/con graden das Satellitenbild
// (das bleibt eine Tagesaufnahme — „Nacht“ ist Abdunkelung + Entsättigung + etwas mehr
// Kontrast), sky/hor/fog färben die Atmosphäre, li/lc das Licht. Dichter gestaffelt als
// vorher, damit der Übergang über den Tag als weiche Lichtkurve läuft statt in Sprüngen.
// Nacht ist bewusst tiefblau (nicht schwarz) — die Farbe trägt die Stimmung, der
// Atmosphären-Schleier (atmosphere.js) legt die Lichtfarbe zusätzlich über den Boden.
// Nacht-Helligkeiten nach User-Feedback gesenkt („Landschaft nachts zu hell"):
// die Textur bleibt eine Tagesaufnahme, tiefe Nacht drückt sie jetzt auf ~0.19.
const KEYS = [
  { a: -16, br: 0.19, sat: -0.64, con: 0.07, sky: '#080f1e', hor: '#101a2e', fog: '#0a1020', li: 0.2, lc: '#8ea3d6' },
  { a: -8, br: 0.26, sat: -0.54, con: 0.06, sky: '#122036', hor: '#2b2f4e', fog: '#1a2036', li: 0.25, lc: '#9aa6cc' },
  { a: -4, br: 0.36, sat: -0.36, con: 0.03, sky: '#1c3358', hor: '#5b466e', fog: '#33314a', li: 0.3, lc: '#c4a6cf' },
  { a: 0, br: 0.62, sat: -0.16, con: 0.0, sky: '#3a5680', hor: '#e08a52', fog: '#b5825f', li: 0.36, lc: '#ff9e63' },
  { a: 4, br: 0.82, sat: -0.05, con: -0.02, sky: '#5487bf', hor: '#eec39a', fog: '#dcc0a0', li: 0.42, lc: '#ffd7a8' },
  { a: 10, br: 0.95, sat: -0.01, con: -0.01, sky: '#6fa6d8', hor: '#a8c8e6', fog: '#b8d0ea', li: 0.42, lc: '#ffe6cf' },
  // Tag: Horizont UND Fog liegen sehr nah am Himmelblau — die Farb-Deltas sind bewusst
  // winzig, damit der Schleier kein abgesetzter grauer Balken ist, sondern ein kaum
  // sichtbarer, langer Auslauf ins Blau (silhouettenhaft, das ferne Gelände verschwindet
  // allmählich statt an einer Kante). Zusammen mit dem gesenkten fog-ground-blend zieht
  // sich der Verlauf über ein hohes Band nach unten.
  { a: 24, br: 1, sat: 0, con: 0, sky: '#7ab3e0', hor: '#8dbbe2', fog: '#96c0e3', li: 0.4, lc: '#ffedd6' },
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
    con: lo.con + (hi.con - lo.con) * t,
    li: lo.li + (hi.li - lo.li) * t,
    sky: mixHex(lo.sky, hi.sky, t),
    hor: mixHex(lo.hor, hi.hor, t),
    fog: mixHex(lo.fog, hi.fog, t),
    lc: mixHex(lo.lc, hi.lc, t),
  }
}

// setNight: Fassaden-Pattern + Dachfarben umschalten (map.js), überblendet.
// onParams(p, sun): optionaler Hook, der dieselben interpolierten Keyframe-Werte + den
// Sonnenstand herausreicht — die reine deck-Szene (deckscene.js) hängt sich dort an, damit
// ihr Himmel/Licht exakt derselben Regie folgt wie MapLibres Boden.
export function createDayNight(map, setNight, onParams) {
  let lastAlt = Infinity
  let lastApply = 0
  let night = false
  let snowAmt = 0 // 0..1 — „schneebedeckte Landschaft" als Grading des Satellitenbilds
  const fn = (date, lnglat) => {
    const sun = sunPosition(date, lnglat[1], lnglat[0])
    // Die virtuelle Uhr läuft schnell (~3°/s Sonnenbewegung) — 2–4 Updates/s
    // reichen, die 300-ms-Paint-Transitionen glätten die Stufen
    const now = performance.now()
    if (Math.abs(sun.altitude - lastAlt) < 0.15 && now - lastApply < 1200) return
    lastAlt = sun.altitude
    lastApply = now
    const p = paramsAt(sun.altitude)
    onParams?.(p, sun)
    // Schnee-Grading: raster-brightness-min hebt die DUNKLEN Pixel an (Wälder,
    // Wiesen, Fels werden weißlich — liest sich als geschlossene Schneedecke),
    // dazu kräftig entsättigen. Tagsabhängig skaliert: nachts reflektiert Schnee
    // zwar (leicht heller als schneefrei), aber kein Weiß-Glühen.
    const dayNorm = Math.min(Math.max((p.br - 0.19) / (1 - 0.19), 0), 1)
    const bmin = snowAmt * (0.08 + 0.34 * dayNorm)
    map.setPaintProperty('satellite', 'raster-brightness-max', +p.br.toFixed(3))
    map.setPaintProperty('satellite', 'raster-brightness-min', +bmin.toFixed(3))
    map.setPaintProperty('satellite', 'raster-saturation', +Math.max(-1, p.sat - 0.5 * snowAmt).toFixed(3))
    map.setPaintProperty('satellite', 'raster-contrast', +(p.con - 0.06 * snowAmt).toFixed(3))
    map.setLight({
      anchor: 'map',
      // Licht nie unter den Horizont lassen: nachts bleibt ein flaches,
      // kühles Restlicht (Mond-Ersatz) aus der letzten Sonnenrichtung
      position: [1.3, sun.azimuth, 90 - Math.min(Math.max(sun.altitude, 2), 82)],
      color: p.lc,
      intensity: +p.li.toFixed(3),
    })
    // Luftperspektive: MapLibres Terrain-Shader fogt das GELÄNDE nach echter Distanz
    // (fog-ground-blend = Startpunkt der Fog-Tiefe, quadratische Kurve Richtung
    // fog-color→horizon-color; aktiv ab Pitch 60 — genau die Himmel-Posen). Früher
    // stand das auf 1 (aus), weil der Default-Fog als grauer Schleier störte — mit
    // den tageszeitlichen fog-Farben der Keyframes wird daraus echter Fern-Dunst:
    // die hintere Gelände-Hälfte dunstet Richtung Horizontfarbe ein. atmosphere-blend
    // bleibt 0 (der frühere Grau-Balken kam von dort).
    map.setSky({
      'sky-color': p.sky,
      'horizon-color': p.hor,
      'fog-color': p.fog,
      'sky-horizon-blend': 0.9,
      'horizon-fog-blend': 0.7,
      // ACHTUNG, verifiziert wirkungslos in UNSEREN Kameraposen (roter Test-Fog:
      // bitidentische Pixel): MapLibres Fog-Matrix legt die Near-Plane auf
      // cameraToSeaLevelDistance — bei Pitch ~86 und hoher Kamera beginnt die
      // Fog-Tiefe erst JENSEITS des gerenderten Horizonts. Die sichtbare
      // Luftperspektive kommt komplett aus atmosphere.js (drawHaze + #farblur);
      // der Wert hier bleibt nur für flachere Default-Kamera-Posen gesetzt.
      'fog-ground-blend': 0.45,
      'atmosphere-blend': 0,
    })
    // Fenster an/aus mit Hysterese, damit es in der Dämmerung nicht flackert
    const wantNight = night ? sun.altitude < -2 : sun.altitude < -4
    if (wantNight !== night) {
      night = wantNight
      setNight(night)
    }
  }
  // Wetter-Kopplung (main.js applyWeather): Schneedecke aufs Satellitenbild.
  // Weiche Überblendung über die Paint-Transition; Drossel zurücksetzen, damit
  // der Wechsel sofort greift statt erst beim nächsten Sonnenstands-Schritt.
  fn.setSnow = (amt) => {
    if (amt === snowAmt) return
    snowAmt = amt
    map.setPaintProperty('satellite', 'raster-brightness-min-transition', { duration: 2500 })
    lastAlt = Infinity
  }
  return fn
}
