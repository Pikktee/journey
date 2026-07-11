// Auto-Wetter der Anreicherungs-Pipeline: rekonstruiert das echte Wetter der
// Aufzeichnung aus Open-Meteo-Stundenwerten (CC-BY 4.0) über Raum-Zeit-Samples
// — volle Stunde × Streckenposition zu dieser Stunde — und destilliert daraus
// geglättete Keyframes [{f, mode, k, source}] im Format der kuratierten
// Wetter-Timelines des Players (cfg.weather hat dort Vorrang vor dem
// Client-Auto-Wetter in src/autoweather.js).
//
// Das WMO-Mapping ist der Zwilling von wmoToWeather in src/autoweather.js —
// Server-Keyframes und Client-Fallback müssen dieselbe Wetterwelt erzählen.

import { positionZurZeit, type Zeitreihe } from './zeit.js'

export type WetterModus = 'off' | 'clouds' | 'fog' | 'rain' | 'snow' | 'storm'

export interface WetterStunde {
  code: number
  /** Bewölkung in % */
  wolken: number
  /** Niederschlag in mm/h */
  regenMm: number
  /** Schneefall in cm/h */
  schneeCm: number
}

/** Stundenraster einer Position: parallele Arrays, Zeiten als ISO-Stunde (UTC). */
export interface StundenRaster {
  zeiten: string[]
  code: number[]
  wolken: number[]
  regen: number[]
  schnee: number[]
}

/** Wetterdaten-Anbieter hinter Interface (DI) — Tests nutzen FesteWetterQuelle. */
export interface WetterQuelle {
  /** Stundenwerte je Position über einen UTC-Datumsbereich (YYYY-MM-DD). */
  stunden(
    punkte: ReadonlyArray<{ lat: number; lng: number }>,
    startTag: string,
    endeTag: string,
  ): Promise<StundenRaster[]>
}

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x))

/**
 * WMO-Wettercode + Stundenwerte → Modus + Stärke k (0..1, stufenlos).
 * Reihenfolge: Gewitter schlägt Schnee schlägt Regen schlägt Nebel schlägt
 * Bewölkung — identisch zu src/autoweather.js.
 */
export function wmoZuWetter(w: WetterStunde): { mode: WetterModus; k: number } {
  if (w.code >= 95) return { mode: 'storm', k: clamp(0.5 + w.regenMm / 8, 0.4, 1) }
  if (w.schneeCm > 0.05 || (w.code >= 71 && w.code <= 77) || w.code === 85 || w.code === 86) {
    return { mode: 'snow', k: clamp(0.4 + w.schneeCm / 2.5, 0.4, 1) }
  }
  if ((w.code >= 51 && w.code <= 67) || (w.code >= 80 && w.code <= 82) || w.regenMm > 0.15) {
    return { mode: 'rain', k: clamp(0.4 + w.regenMm / 5, 0.4, 1) }
  }
  if (w.code === 45 || w.code === 48) return { mode: 'fog', k: 0.7 }
  if (w.wolken >= 25) return { mode: 'clouds', k: clamp(0.4 + 0.6 * ((w.wolken - 25) / 75), 0.4, 1) }
  return { mode: 'off', k: 0.7 }
}

/**
 * Einzel-Samples wegglätten (Median-Filter): ein Modus zählt erst ab
 * 2 Stunden-Samples in Folge — ein einzelnes Sample zwischen zwei EINIGEN
 * Nachbarn ist Flackern und übernimmt deren Modus (Stärke gemittelt).
 * Übergänge ([wolkig, regen, klar]) und die Ränder bleiben unangetastet:
 * gerade das letzte Sample trägt oft ein echtes Aufklaren vorm Tour-Ende.
 */
export function glaetteSamples<T extends { mode: WetterModus; k: number }>(samples: readonly T[]): T[] {
  return samples.map((s, i) => {
    const vorher = samples[i - 1]
    const nachher = samples[i + 1]
    if (vorher && nachher && vorher.mode === nachher.mode && s.mode !== vorher.mode) {
      return { ...s, mode: vorher.mode, k: (vorher.k + nachher.k) / 2 }
    }
    return { ...s }
  })
}

export interface WetterKeyframe {
  f: number
  mode: WetterModus
  k: number
  source: string
}

const rund = (x: number, stellen: number): number => {
  const p = 10 ** stellen
  return Math.round(x * p) / p
}

const isoStunde = (ms: number): string => new Date(ms).toISOString().slice(0, 13)
const isoTag = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

// Deckel für die Stunden-Samples (Mehrtages-Uploads): darüber wird das
// Stundenraster ausgedünnt statt die Abfrage aufgebläht.
const MAX_SAMPLES = 96
// Ab dieser k-Änderung bekommt derselbe Modus einen weiteren Keyframe
// (setIntensity im Player ist stufenlos — Schauer dürfen an- und abschwellen).
const K_SCHWELLE = 0.15

/**
 * Auto-Wetter berechnen: Stunden-Samples entlang der Strecke ziehen, per
 * Quelle mit Werten füllen, glätten und als Keyframes über f destillieren.
 * Wirft bei Quellen-Fehlern — der Aufrufer (enrich) lässt `weather` dann weg
 * und der Player fällt auf sein Client-Auto-Wetter zurück.
 */
export async function berechneWetter(eingabe: {
  reihe: Zeitreihe
  startIso: string
  quelle: WetterQuelle
}): Promise<WetterKeyframe[]> {
  const { reihe, startIso, quelle } = eingabe
  const startMs = Date.parse(startIso)
  const erster = reihe.punkte[0]
  const letzter = reihe.punkte[reihe.punkte.length - 1]
  if (!Number.isFinite(startMs) || !erster || !letzter) return []

  // Sample-Zeitpunkte: Tour-Start, jede volle UTC-Stunde dazwischen, Tour-Ende.
  const vonMs = startMs + erster.tSek * 1000
  const bisMs = startMs + letzter.tSek * 1000
  const stundeMs = 3600_000
  const zeiten: number[] = [vonMs]
  const stunden = Math.floor((bisMs - vonMs) / stundeMs)
  const schritt = Math.max(1, Math.ceil(stunden / MAX_SAMPLES))
  for (let ms = (Math.floor(vonMs / stundeMs) + 1) * stundeMs; ms < bisMs; ms += schritt * stundeMs) {
    zeiten.push(ms)
  }
  if (bisMs > vonMs) zeiten.push(bisMs)

  const orte = zeiten.map((ms) => positionZurZeit(reihe, (ms - startMs) / 1000))
  const raster = await quelle.stunden(orte, isoTag(vonMs), isoTag(bisMs))

  const samples = zeiten.map((ms, i) => {
    const r = raster[i] ?? raster[0]
    if (!r?.zeiten?.length) throw new Error('Wetterquelle: keine Stundenwerte')
    // Sample-Stunde im Raster suchen (abgerundet); außerhalb wird geklemmt
    let hi = r.zeiten.findIndex((z) => z.slice(0, 13) === isoStunde(ms))
    if (hi < 0) hi = ms < Date.parse(`${r.zeiten[0]}Z`) ? 0 : r.zeiten.length - 1
    const wx = wmoZuWetter({
      code: r.code[hi] ?? 0,
      wolken: r.wolken[hi] ?? 0,
      regenMm: r.regen[hi] ?? 0,
      schneeCm: r.schnee[hi] ?? 0,
    })
    return { f: (orte[i] as { f: number }).f, mode: wx.mode, k: wx.k }
  })

  const geglaettet = glaetteSamples(samples)

  // Keyframes: erstes Sample immer; danach das letzte Sample VOR jedem
  // Modus-Wechsel plus das erste danach (der Player legt die Umschalt-Grenze
  // auf die Mitte zwischen zwei Marken — so liegt sie zeitlich richtig) sowie
  // deutliche k-Änderungen innerhalb desselben Modus.
  const behalten = new Array<boolean>(geglaettet.length).fill(false)
  behalten[0] = true
  let letztK = (geglaettet[0] as { k: number }).k
  for (let i = 1; i < geglaettet.length; i++) {
    const s = geglaettet[i] as { mode: WetterModus; k: number }
    const vorher = geglaettet[i - 1] as { mode: WetterModus; k: number }
    if (s.mode !== vorher.mode) {
      behalten[i - 1] = true
      behalten[i] = true
      letztK = s.k
    } else if (Math.abs(s.k - letztK) > K_SCHWELLE) {
      behalten[i] = true
      letztK = s.k
    }
  }

  const keyframes: WetterKeyframe[] = []
  for (let i = 0; i < geglaettet.length; i++) {
    if (!behalten[i]) continue
    const s = geglaettet[i] as { f: number; mode: WetterModus; k: number }
    const eintrag: WetterKeyframe = { f: rund(s.f, 4), mode: s.mode, k: rund(s.k, 2), source: 'openmeteo' }
    const vorher = keyframes[keyframes.length - 1]
    // Gleiche Marke (Pause: mehrere Stunden auf demselben f) → die spätere gewinnt.
    // Gleiche ZUSTÄNDE in Folge bleiben dagegen absichtlich stehen: die Marke vor
    // einem Wechsel platziert die Umschalt-Mitte des Players zeitlich richtig.
    if (vorher && vorher.f === eintrag.f) keyframes.pop()
    keyframes.push(eintrag)
  }
  return keyframes
}

// — Open-Meteo-Anbindung —

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'
const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive'
// Das ERA5-Archiv läuft der Gegenwart ~5 Tage hinterher — jüngere Touren
// beantwortet die Forecast-API (deren Vergangenheit sind Modelldaten, gut genug;
// M5 verfeinert per Bildanalyse).
const ARCHIV_VERZUG_TAGE = 6
// Open-Meteo bündelt mehrere Positionen pro Abfrage; konservativ gedeckelt.
const MAX_ORTE_JE_ABFRAGE = 50

interface OpenMeteoAntwort {
  hourly?: {
    time?: string[]
    weather_code?: number[]
    cloud_cover?: number[]
    precipitation?: number[]
    snowfall?: number[]
  }
}

export class OpenMeteoQuelle implements WetterQuelle {
  // `jetzt` injizierbar: die Forecast/Archiv-Weiche ist sonst nicht testbar
  constructor(private readonly jetzt: () => Date = () => new Date()) {}

  async stunden(
    punkte: ReadonlyArray<{ lat: number; lng: number }>,
    startTag: string,
    endeTag: string,
  ): Promise<StundenRaster[]> {
    const alterTage = (this.jetzt().getTime() - Date.parse(`${endeTag}T00:00:00Z`)) / 86_400_000
    const basisUrl = alterTage < ARCHIV_VERZUG_TAGE ? FORECAST_URL : ARCHIVE_URL

    const ergebnisse: StundenRaster[] = []
    for (let von = 0; von < punkte.length; von += MAX_ORTE_JE_ABFRAGE) {
      const gruppe = punkte.slice(von, von + MAX_ORTE_JE_ABFRAGE)
      const params = new URLSearchParams({
        latitude: gruppe.map((p) => p.lat.toFixed(4)).join(','),
        longitude: gruppe.map((p) => p.lng.toFixed(4)).join(','),
        start_date: startTag,
        end_date: endeTag,
        hourly: 'weather_code,cloud_cover,precipitation,snowfall',
        timezone: 'UTC',
      })
      const antwort = await fetch(`${basisUrl}?${params}`)
      if (!antwort.ok) throw new Error(`Open-Meteo ${antwort.status}`)
      const json = (await antwort.json()) as OpenMeteoAntwort | OpenMeteoAntwort[]
      const saetze = Array.isArray(json) ? json : [json]
      for (let i = 0; i < gruppe.length; i++) {
        const hourly = (saetze[i] ?? saetze[0])?.hourly
        if (!hourly?.time?.length || !hourly.weather_code) throw new Error('Open-Meteo: keine Stundenwerte')
        ergebnisse.push({
          zeiten: hourly.time,
          code: hourly.weather_code,
          wolken: hourly.cloud_cover ?? [],
          regen: hourly.precipitation ?? [],
          schnee: hourly.snowfall ?? [],
        })
      }
    }
    return ergebnisse
  }
}

/** Test-Fake: liefert allen Positionen dasselbe vorgegebene Stundenraster. */
export class FesteWetterQuelle implements WetterQuelle {
  /** Mitschnitt der Abfragen — Tests prüfen damit den Sample-Plan. */
  public abfragen: Array<{ punkte: Array<{ lat: number; lng: number }>; startTag: string; endeTag: string }> = []

  constructor(private readonly raster: StundenRaster) {}

  async stunden(
    punkte: ReadonlyArray<{ lat: number; lng: number }>,
    startTag: string,
    endeTag: string,
  ): Promise<StundenRaster[]> {
    this.abfragen.push({ punkte: punkte.map((p) => ({ ...p })), startTag, endeTag })
    return punkte.map(() => this.raster)
  }
}

/** Bequemer Raster-Bau für Tests: Stunden ab `startIsoStunde` (UTC). */
export function testRaster(
  startIsoStunde: string,
  stunden: Array<Partial<WetterStunde>>,
): StundenRaster {
  const startMs = Date.parse(`${startIsoStunde}:00:00Z`)
  return {
    zeiten: stunden.map((_, i) => new Date(startMs + i * 3600_000).toISOString().slice(0, 16)),
    code: stunden.map((s) => s.code ?? 0),
    wolken: stunden.map((s) => s.wolken ?? 0),
    regen: stunden.map((s) => s.regenMm ?? 0),
    schnee: stunden.map((s) => s.schneeCm ?? 0),
  }
}
