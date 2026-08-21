// Auto-Wetter der Anreicherungs-Pipeline: rekonstruiert das echte Wetter der
// Aufzeichnung aus Open-Meteo-Stundenwerten (CC-BY 4.0) über Raum-Zeit-Samples
// — volle Stunde × Streckenposition zu dieser Stunde — und destilliert daraus
// geglättete Keyframes [{f, mode, k, source}] im Format der kuratierten
// Wetter-Timelines des Players (cfg.weather hat dort Vorrang vor dem
// Client-Auto-Wetter in src/autoweather.ts).
//
// Das WMO-Mapping ist der Zwilling von wmoToWeather in src/autoweather.ts —
// Server-Keyframes und Client-Fallback müssen dieselbe Wetterwelt erzählen.

import {
  clockTimeAtFraction,
  positionAtTime,
  pseudoTimes,
  timeAtPosition,
  type TimeSeries,
} from './time.js'

/**
 * Die Wetterwelt des Players (src/weather.js) als Liste — Einzelquelle für den
 * Typ, den JSON-Schema-Enum des Wetter-Overlays (schema/edits.ts importiert sie)
 * und die Studio-Auswahl. Ein Drift-Wächter (test/studio-baukasten.test.ts)
 * hält die Client-Kopie in edit-model.ts damit deckungsgleich.
 */
export const WEATHER_MODES = ['off', 'clouds', 'fog', 'rain', 'snow', 'storm'] as const
export type WeatherMode = (typeof WEATHER_MODES)[number]

export interface WeatherHour {
  code: number
  /** Bewölkung in % */
  clouds: number
  /** Niederschlag in mm/h */
  rainMm: number
  /** Schneefall in cm/h */
  snowCm: number
}

/** Stundenraster einer Position: parallele Arrays, Zeiten als ISO-Stunde (UTC). */
export interface HourlyGrid {
  times: string[]
  code: number[]
  clouds: number[]
  rain: number[]
  snow: number[]
}

/** Wetterdaten-Anbieter hinter Interface (DI) — Tests nutzen FesteWetterQuelle. */
export interface WeatherSource {
  /** Stundenwerte je Position über einen UTC-Datumsbereich (YYYY-MM-DD). */
  hours(
    points: ReadonlyArray<{ lat: number; lng: number }>,
    startDay: string,
    endDay: string,
  ): Promise<HourlyGrid[]>
}

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x))

/**
 * WMO-Wettercode + Stundenwerte → Modus + Stärke k (0..1, stufenlos).
 * Reihenfolge: Gewitter schlägt Schnee schlägt Regen schlägt Nebel schlägt
 * Bewölkung — identisch zu src/autoweather.ts.
 */
export function wmoToWeather(w: WeatherHour): { mode: WeatherMode; k: number } {
  if (w.code >= 95) return { mode: 'storm', k: clamp(0.5 + w.rainMm / 8, 0.4, 1) }
  if (w.snowCm > 0.05 || (w.code >= 71 && w.code <= 77) || w.code === 85 || w.code === 86) {
    return { mode: 'snow', k: clamp(0.4 + w.snowCm / 2.5, 0.4, 1) }
  }
  if ((w.code >= 51 && w.code <= 67) || (w.code >= 80 && w.code <= 82) || w.rainMm > 0.15) {
    return { mode: 'rain', k: clamp(0.4 + w.rainMm / 5, 0.4, 1) }
  }
  if (w.code === 45 || w.code === 48) return { mode: 'fog', k: 0.7 }
  if (w.clouds >= 25)
    return { mode: 'clouds', k: clamp(0.4 + 0.6 * ((w.clouds - 25) / 75), 0.4, 1) }
  return { mode: 'off', k: 0.7 }
}

/**
 * Einzel-Samples wegglätten (Median-Filter): ein Modus zählt erst ab
 * 2 Stunden-Samples in Folge — ein einzelnes Sample zwischen zwei EINIGEN
 * Nachbarn ist Flackern und übernimmt deren Modus (Stärke gemittelt).
 * Übergänge ([wolkig, regen, klar]) und die Ränder bleiben unangetastet:
 * gerade das letzte Sample trägt oft ein echtes Aufklaren vorm Tour-Ende.
 */
export function smoothSamples<T extends { mode: WeatherMode; k: number }>(
  samples: readonly T[],
): T[] {
  return samples.map((s, i) => {
    const before = samples[i - 1]
    const after = samples[i + 1]
    if (before && after && before.mode === after.mode && s.mode !== before.mode) {
      return { ...s, mode: before.mode, k: (before.k + after.k) / 2 }
    }
    return { ...s }
  })
}

export interface WeatherKeyframe {
  f: number
  mode: WeatherMode
  k: number
  source: string
}

const round = (x: number, positions: number): number => {
  const p = 10 ** positions
  return Math.round(x * p) / p
}

const isoHour = (ms: number): string => new Date(ms).toISOString().slice(0, 13)
const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

// Deckel für die Stunden-Samples (Mehrtages-Uploads): darüber wird das
// Stundenraster ausgedünnt statt die Abfrage aufgebläht.
const MAX_SAMPLES = 96
// Ab dieser k-Änderung bekommt derselbe Modus einen weiteren Keyframe
// (setIntensity im Player ist stufenlos — Schauer dürfen an- und abschwellen).
const K_THRESHOLD = 0.15

/**
 * Auto-Wetter berechnen: Stunden-Samples entlang der Strecke ziehen, per
 * Quelle mit Werten füllen, glätten und als Keyframes über f destillieren.
 * Wirft bei Quellen-Fehlern — der Aufrufer (enrich) lässt `weather` dann weg
 * und der Player fällt auf sein Client-Auto-Wetter zurück.
 */
export async function computeWeather(input: {
  series: TimeSeries
  startIso: string
  source: WeatherSource
}): Promise<WeatherKeyframe[]> {
  const { series, startIso, source } = input
  const startMs = Date.parse(startIso)
  const first = series.points[0]
  const last = series.points[series.points.length - 1]
  if (!Number.isFinite(startMs) || !first || !last) return []

  // Sample-Zeitpunkte: Tour-Start, jede volle UTC-Stunde dazwischen, Tour-Ende.
  const fromMs = startMs + first.tSec * 1000
  const toMs = startMs + last.tSec * 1000
  const hourMs = 3600_000
  const times: number[] = [fromMs]
  const hours = Math.floor((toMs - fromMs) / hourMs)
  const step = Math.max(1, Math.ceil(hours / MAX_SAMPLES))
  for (let ms = (Math.floor(fromMs / hourMs) + 1) * hourMs; ms < toMs; ms += step * hourMs) {
    times.push(ms)
  }
  if (toMs > fromMs) times.push(toMs)

  // Der ORT eines Samples folgt der echten Zeit („wo war die Tour um 21 Uhr?"),
  // seine Stelle im Film aber der PSEUDO-Uhr: In einer Pause liegen alle
  // Stunden am selben Ort, verteilen sich im Film jedoch über die
  // Zeitraffer-Rampe. Ohne diese Trennung fielen sie auf ein einziges f und nur
  // die letzte überlebte die Dedup unten — ein Regen, der während der Pause kam
  // und ging, verschwand spurlos.
  const places = times.map((ms) => positionAtTime(series, (ms - startMs) / 1000))
  const pseudo = pseudoTimes(series)
  const shares = times.map((ms) => clockTimeAtFraction(series, pseudo, (ms - startMs) / 1000))
  const grid = await source.hours(places, isoDay(fromMs), isoDay(toMs))

  const samples = times.map((ms, i) => {
    const r = grid[i] ?? grid[0]
    if (!r?.times?.length) throw new Error('Wetterquelle: keine Stundenwerte')
    // Sample-Stunde im Raster suchen (abgerundet); außerhalb wird geklemmt
    let hi = r.times.findIndex((z) => z.slice(0, 13) === isoHour(ms))
    if (hi < 0) hi = ms < Date.parse(`${r.times[0]}Z`) ? 0 : r.times.length - 1
    const wx = wmoToWeather({
      code: r.code[hi] ?? 0,
      clouds: r.clouds[hi] ?? 0,
      rainMm: r.rain[hi] ?? 0,
      snowCm: r.snow[hi] ?? 0,
    })
    return { f: shares[i] as number, mode: wx.mode, k: wx.k }
  })

  const smoothed = smoothSamples(samples)

  // Keyframes: erstes Sample immer; danach das letzte Sample VOR jedem
  // Modus-Wechsel plus das erste danach (der Player legt die Umschalt-Grenze
  // auf die Mitte zwischen zwei Marken — so liegt sie zeitlich richtig) sowie
  // deutliche k-Änderungen innerhalb desselben Modus.
  const keep = new Array<boolean>(smoothed.length).fill(false)
  keep[0] = true
  let lastK = (smoothed[0] as { k: number }).k
  for (let i = 1; i < smoothed.length; i++) {
    const s = smoothed[i] as { mode: WeatherMode; k: number }
    const before = smoothed[i - 1] as { mode: WeatherMode; k: number }
    if (s.mode !== before.mode) {
      keep[i - 1] = true
      keep[i] = true
      lastK = s.k
    } else if (Math.abs(s.k - lastK) > K_THRESHOLD) {
      keep[i] = true
      lastK = s.k
    }
  }

  const keyframes: WeatherKeyframe[] = []
  for (let i = 0; i < smoothed.length; i++) {
    if (!keep[i]) continue
    const s = smoothed[i] as { f: number; mode: WeatherMode; k: number }
    const entry: WeatherKeyframe = {
      f: round(s.f, 4),
      mode: s.mode,
      k: round(s.k, 2),
      source: 'openmeteo',
    }
    const before = keyframes[keyframes.length - 1]
    // Gleiche Marke (Pause: mehrere Stunden auf demselben f) → die spätere gewinnt.
    // Gleiche ZUSTÄNDE in Folge bleiben dagegen absichtlich stehen: die Marke vor
    // einem Wechsel platziert die Umschalt-Mitte des Players zeitlich richtig.
    if (before && before.f === entry.f) keyframes.pop()
    keyframes.push(entry)
  }
  return keyframes
}

/** Standard-Stärke k eines Wetter-Overrides ohne eigene `intensity` (mittlere Intensität). */
export const WEATHER_DEFAULT_K = 0.7

/**
 * Nutzer-Wetter aus dem Studio-Overlay (`edits.weather`) in Player-Keyframes
 * übersetzen. Anders als das Auto-Wetter ist das eine bewusst gesetzte
 * Stufenfunktion: Grenzen „gilt ab T" (absolute Zeit, stabile Anker wie
 * modi/kamera) werden über die Zeitreihe des (getrimmten) Tracks auf den
 * Streckenanteil f abgebildet; der Grund vor der ersten Grenze ist klar (`off`).
 * Ist Overlay-Wetter gesetzt, ERSETZT es das Auto-Wetter vollständig — enrich.ts
 * überspringt dann auch die Foto-Verfeinerung (der Nutzer korrigiert bewusst).
 *
 * Keyframe-Trick: Jedes Band bekommt eine Marke an Anfang UND Ende (gleicher
 * Modus). Die geteilte Kante zweier Bänder liegt damit doppelt auf demselben f
 * (alter + neuer Modus). `weatherAt` im Player schaltet auf der MITTE zwischen
 * zwei Marken um — bei gleichem f liegt die Umschaltgrenze so EXAKT auf der
 * Nutzer-Grenze (statt auf halber Bandbreite).
 */
export function weatherFromOverlay(
  boundaries: ReadonlyArray<{ from: string; mode: WeatherMode; intensity?: number }>,
  series: TimeSeries,
  startMs: number,
): WeatherKeyframe[] {
  const marks = boundaries
    .map((g) => ({
      f: positionAtTime(series, (Date.parse(g.from) - startMs) / 1000).f,
      mode: g.mode,
      k: g.intensity ?? WEATHER_DEFAULT_K,
    }))
    .filter((m) => Number.isFinite(m.f))
    .sort((a, b) => a.f - b.f)

  // Bänder: Grund = klar bis zur ersten Grenze; jede Grenze eröffnet ein Band
  // bis zur nächsten, das letzte reicht bis f=1. Eine Grenze am/vor dem
  // Track-Anfang (f ≤ 0, etwa vor den Trim geklemmt) ersetzt den Grund direkt.
  const bands: Array<{ from: number; to: number; mode: WeatherMode; k: number }> = []
  let from = 0
  let cur: { mode: WeatherMode; k: number } = { mode: 'off', k: WEATHER_DEFAULT_K }
  for (const m of marks) {
    if (m.f <= from) {
      cur = { mode: m.mode, k: m.k }
      continue
    }
    bands.push({ from, to: m.f, ...cur })
    from = m.f
    cur = { mode: m.mode, k: m.k }
  }
  bands.push({ from, to: 1, ...cur })

  const raw: WeatherKeyframe[] = []
  for (const b of bands) {
    raw.push({ f: round(b.from, 4), mode: b.mode, k: round(b.k, 2), source: 'studio' })
    raw.push({ f: round(b.to, 4), mode: b.mode, k: round(b.k, 2), source: 'studio' })
  }
  // Aufeinanderfolgende identische Keyframes (gleiches f, gleicher Zustand) weg —
  // sie tragen nichts bei und blähen das Tour-JSON nur auf.
  const keyframes: WeatherKeyframe[] = []
  for (const kf of raw) {
    const v = keyframes[keyframes.length - 1]
    if (v && v.f === kf.f && v.mode === kf.mode && v.k === kf.k) continue
    keyframes.push(kf)
  }
  return keyframes
}

/**
 * Umkehrung von `weatherFromOverlay`: Player-Keyframes → Wetter-Grenzen in
 * absoluter Zeit, wie sie im Edit-Overlay stehen.
 *
 * WOZU. Das Auto-Wetter war im Studio bislang unsichtbar — die Wetterspur zeigte
 * ein einziges Band „Automatisch", und die erste eigene Grenze warf die ganze
 * automatische Einteilung weg (Overlay ERSETZT das Auto-Wetter vollständig).
 * Mit dieser Umkehrung zeigt der Editor, was tatsächlich gilt, und kann es beim
 * ersten Eingriff festschreiben — wie `materializeTravelModes` bei der Fortbewegung.
 *
 * Die Bandgrenze liegt dort, wo auch der Player umschaltet: auf der MITTE
 * zwischen zwei Marken (`weatherAt` in src/autoweather.ts). Aufeinanderfolgende
 * Marken mit gleichem Zustand sind dieselbe Aussage und werden zusammengefasst.
 */
export function weatherToBoundaries(
  keyframes: readonly WeatherKeyframe[],
  series: TimeSeries,
  startMs: number,
): Array<{ from: string; mode: WeatherMode; intensity: number }> {
  const sorted = [...keyframes].sort((a, b) => a.f - b.f)
  const first = sorted[0]
  if (!first) return []
  const boundaries: Array<{ from: string; mode: WeatherMode; intensity: number }> = []
  const timeAt = (f: number): string =>
    new Date(startMs + timeAtPosition(series, f) * 1000).toISOString()

  let last: { mode: WeatherMode; k: number } = { mode: first.mode, k: first.k }
  boundaries.push({ from: timeAt(first.f), mode: first.mode, intensity: first.k })
  for (let i = 1; i < sorted.length; i++) {
    const kf = sorted[i] as WeatherKeyframe
    if (kf.mode === last.mode && kf.k === last.k) continue
    const before = sorted[i - 1] as WeatherKeyframe
    boundaries.push({ from: timeAt((before.f + kf.f) / 2), mode: kf.mode, intensity: kf.k })
    last = { mode: kf.mode, k: kf.k }
  }
  // Zwei Grenzen auf derselben Sekunde (Marken-Paare der Overlay-Erzeugung, oder
  // eine Pause im Track): die spätere gewinnt — sie ist die gültige Aussage.
  const filtered: typeof boundaries = []
  for (const g of boundaries) {
    if (filtered[filtered.length - 1]?.from === g.from) filtered.pop()
    filtered.push(g)
  }
  return filtered
}

// — Open-Meteo-Anbindung —

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'
const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive'
// Das ERA5-Archiv läuft der Gegenwart ~5 Tage hinterher — jüngere Touren
// beantwortet die Forecast-API (deren Vergangenheit sind Modelldaten, gut genug;
// M5 verfeinert per Bildanalyse).
const ARCHIVE_LAG_DAYS = 6
// Open-Meteo bündelt mehrere Positionen pro Abfrage; konservativ gedeckelt.
const MAX_PLACES_PER_QUERY = 50

interface OpenMeteoResponse {
  hourly?: {
    time?: string[]
    weather_code?: number[]
    cloud_cover?: number[]
    precipitation?: number[]
    snowfall?: number[]
  }
}

export class OpenMeteoSource implements WeatherSource {
  // `jetzt` injizierbar: die Forecast/Archiv-Weiche ist sonst nicht testbar
  constructor(private readonly now: () => Date = () => new Date()) {}

  async hours(
    points: ReadonlyArray<{ lat: number; lng: number }>,
    startDay: string,
    endDay: string,
  ): Promise<HourlyGrid[]> {
    const ageDays = (this.now().getTime() - Date.parse(`${endDay}T00:00:00Z`)) / 86_400_000
    const baseUrl = ageDays < ARCHIVE_LAG_DAYS ? FORECAST_URL : ARCHIVE_URL

    const results: HourlyGrid[] = []
    for (let from = 0; from < points.length; from += MAX_PLACES_PER_QUERY) {
      const group = points.slice(from, from + MAX_PLACES_PER_QUERY)
      const params = new URLSearchParams({
        latitude: group.map((p) => p.lat.toFixed(4)).join(','),
        longitude: group.map((p) => p.lng.toFixed(4)).join(','),
        start_date: startDay,
        end_date: endDay,
        hourly: 'weather_code,cloud_cover,precipitation,snowfall',
        timezone: 'UTC',
      })
      const response = await fetch(`${baseUrl}?${params}`)
      if (!response.ok) throw new Error(`Open-Meteo ${response.status}`)
      const json = (await response.json()) as OpenMeteoResponse | OpenMeteoResponse[]
      const sets = Array.isArray(json) ? json : [json]
      for (let i = 0; i < group.length; i++) {
        const hourly = (sets[i] ?? sets[0])?.hourly
        if (!hourly?.time?.length || !hourly.weather_code)
          throw new Error('Open-Meteo: keine Stundenwerte')
        results.push({
          times: hourly.time,
          code: hourly.weather_code,
          clouds: hourly.cloud_cover ?? [],
          rain: hourly.precipitation ?? [],
          snow: hourly.snowfall ?? [],
        })
      }
    }
    return results
  }
}

/** Test-Fake: liefert allen Positionen dasselbe vorgegebene Stundenraster. */
export class FixedWeatherSource implements WeatherSource {
  /** Mitschnitt der Abfragen — Tests prüfen damit den Sample-Plan. */
  public queries: Array<{
    points: Array<{ lat: number; lng: number }>
    startDay: string
    endDay: string
  }> = []

  constructor(private readonly grid: HourlyGrid) {}

  async hours(
    points: ReadonlyArray<{ lat: number; lng: number }>,
    startDay: string,
    endDay: string,
  ): Promise<HourlyGrid[]> {
    this.queries.push({ points: points.map((p) => ({ ...p })), startDay, endDay })
    return points.map(() => this.grid)
  }
}

/** Bequemer Raster-Bau für Tests: Stunden ab `startIsoStunde` (UTC). */
export function testGrid(startIsoHour: string, hours: Array<Partial<WeatherHour>>): HourlyGrid {
  const startMs = Date.parse(`${startIsoHour}:00:00Z`)
  return {
    times: hours.map((_, i) => new Date(startMs + i * 3600_000).toISOString().slice(0, 16)),
    code: hours.map((s) => s.code ?? 0),
    clouds: hours.map((s) => s.clouds ?? 0),
    rain: hours.map((s) => s.rainMm ?? 0),
    snow: hours.map((s) => s.snowCm ?? 0),
  }
}
