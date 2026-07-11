// Auto-Wetter: rekonstruiert das ECHTE Wetter der Reise aus historischen Wetterdaten
// (Open-Meteo Archive API, CC-BY 4.0) an den Foto-Ankern der Tour, stündlich
// aufgefüllt zwischen den Ankern. Der Zeitpunkt je Anker kommt aus den EXIF-Daten
// des Fotos (DateTimeOriginal); Fotos ohne EXIF (gestrippte Bilder) fallen auf die
// Pseudo-Zeit der Tour an dieser Streckenposition zurück. Ergebnis ist eine Timeline
// über s: [{s, mode, k}] — main.js schaltet beim Überfahren der Abschnittsmitten
// weich um (die Blenden liegen in weather/atmosphere).
// Vision-Ableitung aus den Bildern selbst ist bewusst NICHT Teil davon (später).
import { readExifDate } from './exif.js'

const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive'

// WMO-Wettercode + Stundenwerte → Luhambo-Modus + Stärke k (0..1, stufenlos —
// genau dafür ist setIntensity stufenlos gebaut). Reihenfolge: Gewitter schlägt
// Schnee schlägt Regen schlägt Nebel schlägt Bewölkung.
export function wmoToWeather({ code, cloud, precip, snowfall }) {
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x))
  if (code >= 95) return { mode: 'storm', k: clamp(0.5 + precip / 8, 0.4, 1) }
  if (snowfall > 0.05 || (code >= 71 && code <= 77) || code === 85 || code === 86) {
    return { mode: 'snow', k: clamp(0.4 + snowfall / 2.5, 0.4, 1) }
  }
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || precip > 0.15) {
    return { mode: 'rain', k: clamp(0.4 + precip / 5, 0.4, 1) }
  }
  if (code === 45 || code === 48) return { mode: 'fog', k: 0.7 }
  if (cloud >= 25) return { mode: 'clouds', k: clamp(0.4 + 0.6 * ((cloud - 25) / 75), 0.4, 1) }
  return { mode: 'off', k: 0.7 }
}

const pad2 = (n) => String(n).padStart(2, '0')

// Stützstellen der Tour: Foto-Anker (dort gibt es einen echten Zeitpunkt) plus
// Start/Ende der Route (Wetter vor dem ersten/nach dem letzten Foto).
async function buildAnchors({ photos, route, time, pointAt }) {
  const t0 = Date.parse(time.start)
  const t1 = Date.parse(time.end)
  const pseudo = (s) => new Date(t0 + (s / route.total) * (t1 - t0))
  // Datum → Kalender-Komponenten der TOUR-Zone auflösen — Open-Meteo wird mit
  // timezone=<Tour-Zone> befragt, dann passen die Stunden-Indizes
  const inZone = (d) => {
    const parts = new Intl.DateTimeFormat('sv-SE', {
      timeZone: time.zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(d).reduce((o, x) => ((o[x.type] = x.value), o), {})
    return { y: +parts.year, mo: +parts.month, d: +parts.day, hh: +parts.hour, mm: +parts.minute }
  }
  const anchors = []
  for (const p of photos) {
    // Aufgezeichnete Touren (remote.ts) liefern takenAt direkt mit — dann ist
    // kein EXIF-Fetch nötig (schneller, und App-Fotos sind teils EXIF-gestrippt)
    let dt = null
    let echt = false
    if (p.takenAt && Number.isFinite(Date.parse(p.takenAt))) {
      dt = inZone(new Date(Date.parse(p.takenAt)))
      echt = true
    } else {
      const exif = await readExifDate(p.src) // null bei fehlendem EXIF (Stock-Fotos)
      if (exif) {
        dt = exif
        echt = true
      } else {
        dt = inZone(pseudo(p.s))
      }
    }
    anchors.push({ s: p.s, lnglat: p.anchor, dt, exif: echt })
  }
  // Routen-Enden mit Pseudo-Zeit ergänzen (gleiche Auflösung wie oben)
  for (const s of [0, route.total]) {
    const pos = pointAt(route, s)
    anchors.push({ s, lnglat: [pos[0], pos[1]], dt: inZone(pseudo(s)), exif: false })
  }
  anchors.sort((a, b) => a.s - b.s)
  return anchors
}

// Eine Archive-Abfrage je Kalendertag, alle Stützstellen des Tages als
// Multi-Location-Parameter gebündelt (die API liefert dann ein Array).
export async function buildWeatherTimeline({ photos, route, time, pointAt }) {
  const anchors = await buildAnchors({ photos, route, time, pointAt })
  const byDay = new Map()
  for (const a of anchors) {
    const day = `${a.dt.y}-${pad2(a.dt.mo)}-${pad2(a.dt.d)}`
    if (!byDay.has(day)) byDay.set(day, [])
    byDay.get(day).push(a)
  }
  for (const [day, list] of byDay) {
    const params = new URLSearchParams({
      latitude: list.map((a) => a.lnglat[1].toFixed(4)).join(','),
      longitude: list.map((a) => a.lnglat[0].toFixed(4)).join(','),
      start_date: day,
      end_date: day,
      hourly: 'weather_code,cloud_cover,precipitation,snowfall',
      timezone: time.zone,
    })
    const res = await fetch(`${ARCHIVE_URL}?${params}`)
    if (!res.ok) throw new Error(`Open-Meteo ${res.status}`)
    const data = await res.json()
    const sets = Array.isArray(data) ? data : [data]
    list.forEach((a, i) => {
      const hourly = sets[i]?.hourly ?? sets[0]?.hourly
      if (!hourly?.weather_code) throw new Error('Open-Meteo: keine Stundenwerte')
      a.hourly = hourly // fürs stündliche Auffüllen zwischen den Ankern (unten)
      a.wx = wxAtHour(hourly, a.dt.hh)
    })
  }
  // Timeline = Anker + STÜNDLICHE Zwischenstützstellen. Nur mit Foto-Ankern war
  // die zeitliche Auflösung so grob wie der Foto-Abstand: die Segmentgrenzen
  // liegen auf den Anker-MITTEN, ein Nachmittags-Schauer „schmierte" damit bis in
  // die Golden Hour, obwohl es laut Stundenwerten längst aufgeklart war. Zwischen
  // benachbarten Ankern wird s linear über die Zeit interpoliert und für jede
  // volle Stunde ein Eintrag aus den Stundenwerten des zeitlich näheren Ankers
  // erzeugt (die Orte liegen nah beieinander — die Stunde ist der Hebel).
  const entries = []
  const minutes = (dt) => dt.hh * 60 + dt.mm
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i]
    entries.push({ s: a.s, mode: a.wx.mode, k: a.wx.k, exif: a.exif })
    const b = anchors[i + 1]
    if (!b || b.s <= a.s) continue
    const sameDay = a.dt.y === b.dt.y && a.dt.mo === b.dt.mo && a.dt.d === b.dt.d
    if (!sameDay) continue // Mehrtages-Paar (selten): nur die Anker selbst
    const mA = minutes(a.dt)
    const mB = minutes(b.dt)
    if (mB - mA < 61) continue // keine volle Stunde dazwischen
    for (let hm = (Math.floor(mA / 60) + 1) * 60; hm < mB; hm += 60) {
      if (hm <= mA) continue
      const f = (hm - mA) / (mB - mA)
      const src = f < 0.5 ? a : b
      const wx = wxAtHour(src.hourly, hm / 60)
      entries.push({ s: a.s + f * (b.s - a.s), mode: wx.mode, k: wx.k, exif: false })
    }
  }
  return entries
}

// Stundenwerte → Modus/Stärke an einer vollen Stunde (Index geklemmt)
function wxAtHour(hourly, hh) {
  const hi = Math.min(hh, hourly.weather_code.length - 1)
  return wmoToWeather({
    code: hourly.weather_code[hi] ?? 0,
    cloud: hourly.cloud_cover?.[hi] ?? 0,
    precip: hourly.precipitation?.[hi] ?? 0,
    snowfall: hourly.snowfall?.[hi] ?? 0,
  })
}

// Timeline-Lookup: Abschnittsgrenzen liegen auf den Mitten zwischen den Stützstellen
export function weatherAt(timeline, s) {
  if (!timeline?.length) return null
  let best = timeline[0]
  for (const e of timeline) {
    if (s >= (best.s + e.s) / 2) best = e
  }
  return best
}
