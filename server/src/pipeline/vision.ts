// Wetter-Verfeinerung per Bildanalyse (M5): das aus Open-Meteo rekonstruierte
// Auto-Wetter (weather.ts) ist Modelldaten — für jüngere Touren aus der
// Forecast-API, für ältere aus dem ERA5-Archiv. Beide kennen lokale Effekte oft
// nicht (ein Gewitter über einer Bergkette, Nebel im Tal). Die Fotos der Tour
// haben den Himmel aber tatsächlich gesehen. M5 klassifiziert sie (Claude Haiku,
// Klassifikation — KEINE Medien-Generierung) und übersteuert das API-Wetter
// LOKAL am Foto-Anker, wenn das Bild sicher MEHR Wetter zeigt.
//
// Aufbau wie der Rest der Pipeline: reine Funktionen (Mapping + Merge) sind ohne
// Netz testbar, der echte Anthropic-Aufruf steckt hinter dem BildKlassifikator-
// Interface (DI, wie WetterQuelle/VideoWerkzeug), Tests nutzen den FesterKlassifikator.

import type { WeatherKeyframe, WeatherMode } from './weather.js'

/**
 * Befund einer Bild-Klassifikation. Die Enums bilden sauber auf WetterModus ab
 * (himmel → clouds/off, niederschlag → rain/snow/storm/fog), damit das Mapping
 * unten total und ohne Sonderfälle ist.
 */
export interface ImageFinding {
  /** Himmelszustand ohne Niederschlag: klar → off, wolkig/bedeckt → clouds */
  sky: 'klar' | 'wolkig' | 'bedeckt'
  /** Sichtbarer Niederschlag bzw. Nebel; „kein" → der Himmel entscheidet */
  precipitation: 'kein' | 'regen' | 'schnee' | 'gewitter' | 'nebel'
  /** Ist das Wetter im Bild überhaupt erkennbar? (nicht bei reinen Innenaufnahmen) */
  skyVisible: boolean
  /** Sicherheit der Einschätzung, 0..1 */
  confidence: number
}

/** Klassifikator hinter Interface (DI) — Tests nutzen FesterKlassifikator. */
export interface ImageClassifier {
  /**
   * `protokoll` meldet, WARUM ein Bild nichts beigetragen hat. Ohne das sind
   * „ein Foto zeigte keinen Himmel" und „der Dienst antwortet gar nicht mehr"
   * von außen dasselbe: eine Tour, die fertig wird und deren Wetter allein aus
   * Open-Meteo kommt (s. Fehlerzweige im OpenRouterKlassifikator).
   */
  classify(
    image: { data: Uint8Array; mediaType: string },
    log?: (message: string) => void,
  ): Promise<ImageFinding>
}

// Schweregrad-Rangfolge (Plan M5): „mehr Wetter" = höherer Rang. off < clouds <
// fog < rain < snow < storm — deckungsgleich mit der Idee, dass ein Foto die API
// nur dann übersteuern darf, wenn es eine dramatischere Wetterlage zeigt.
const SEVERITY: Record<WeatherMode, number> = {
  off: 0,
  clouds: 1,
  fog: 2,
  rain: 3,
  snow: 4,
  storm: 5,
}

// Fenster-Halbbreite in f: ein übersteuerndes Foto gilt lokal um seinen Anker.
const WINDOW_HALF = 0.03
// Kleiner Rand außerhalb des Fensters für die Basis-Restaurationsmarken — hält
// die Umschalt-Mitte des Players (Grenze auf der Marken-Mitte) am Fensterrand.
const EDGE = 0.005
// Ab dieser Konfidenz (und nur bei sichtbarem Himmel) darf ein Foto übersteuern.
const MIN_CONFIDENCE = 0.7

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x))
const round = (x: number, positions: number): number => {
  const p = 10 ** positions
  return Math.round(x * p) / p
}

/**
 * Bild-Befund → Wettermodus + Stärke k (0..1). Niederschlag/Nebel schlagen den
 * Himmelszustand; ohne Niederschlag entscheidet die Bewölkung (bedeckt kräftiger
 * als wolkig, klar = kein Wetter). k-Werte plausibel im Bereich der
 * wmoZuWetter-Stärken (weather.ts).
 */
export function imageFindingToWeather(b: ImageFinding): { mode: WeatherMode; k: number } {
  switch (b.precipitation) {
    case 'gewitter':
      return { mode: 'storm', k: 0.8 }
    case 'schnee':
      return { mode: 'snow', k: 0.7 }
    case 'regen':
      return { mode: 'rain', k: 0.6 }
    case 'nebel':
      return { mode: 'fog', k: 0.7 }
    case 'kein':
      if (b.sky === 'bedeckt') return { mode: 'clouds', k: 0.9 }
      if (b.sky === 'wolkig') return { mode: 'clouds', k: 0.5 }
      return { mode: 'off', k: 0.7 } // klar
  }
}

/**
 * Aktiver Zustand der Basis-Keyframes an Position f — exakt die Lookup-Logik des
 * Players (weatherAt in src/autoweather.ts): die Grenze zwischen zwei Marken
 * liegt auf ihrer Mitte. `basis` muss nach f sortiert sein.
 */
function baseStateAt(base: readonly WeatherKeyframe[], f: number): WeatherKeyframe {
  if (!base.length) return { f, mode: 'off', k: 0.7, source: 'openmeteo' }
  let active = base[0] as WeatherKeyframe
  for (const kf of base) {
    if (f >= (active.f + kf.f) / 2) active = kf
  }
  return active
}

/**
 * Auto-Wetter mit Foto-Befunden verfeinern (reine Funktion, Kern von M5).
 *
 * Konfliktregel: Ein Foto übersteuert die API-Wetterlage NUR, wenn es
 * `himmelSichtbar && konfidenz ≥ 0.7` ist UND an seiner f-Position MEHR Wetter
 * zeigt als die API (höherer Schweregrad). Weil „klar" (off) den kleinsten Rang
 * hat, kann ein Foto einen API-Niederschlag nie wegwischen — ein
 * Wolkenloch-Moment im Bild bleibt folgenlos (die geforderte Ausnahme fällt
 * automatisch aus der Rangregel heraus).
 *
 * Wo ein Foto übersteuert, wird ein lokales Fenster ±0.03 f um den Anker mit
 * `source: 'photo'` eingesetzt (Modus/k aus bildBefundZuWetter); die Basis
 * außerhalb bleibt unangetastet, Marken knapp außerhalb des Fensters halten die
 * Übergänge sauber am Rand. Überlappende Fenster werden verschmolzen (in der
 * Überlappung gewinnt das schwerere Wetter). f wird auf [0,1] geklemmt.
 */
export function refineWeatherWithPhotos(
  base: WeatherKeyframe[],
  photos: Array<{ f: number; finding: ImageFinding }>,
  opts?: { window2?: number; minConfidence?: number },
): WeatherKeyframe[] {
  const h = opts?.window2 ?? WINDOW_HALF
  const minK = opts?.minConfidence ?? MIN_CONFIDENCE
  const sorted = [...base].sort((a, b) => a.f - b.f)

  // 1. Übersteuernde Fotos → Fenster bestimmen.
  interface Window {
    fL: number
    fR: number
    mode: WeatherMode
    k: number
  }
  const window2: Window[] = []
  for (const photo of photos) {
    const b = photo.finding
    if (!b.skyVisible || b.confidence < minK) continue
    const fw = imageFindingToWeather(b)
    const f = clamp01(photo.f)
    if (SEVERITY[fw.mode] <= SEVERITY[baseStateAt(sorted, f).mode]) continue
    window2.push({ fL: clamp01(f - h), fR: clamp01(f + h), mode: fw.mode, k: fw.k })
  }
  if (!window2.length) return sorted.map((kf) => ({ ...kf }))

  // 2. Überlappende Fenster verschmelzen — in der Überlappung gewinnt das
  //    schwerere Wetter (bei Gleichstand die höhere Stärke).
  window2.sort((a, b) => a.fL - b.fL)
  const combined: Window[] = []
  for (const w of window2) {
    const last = combined[combined.length - 1]
    if (last && w.fL <= last.fR) {
      last.fR = Math.max(last.fR, w.fR)
      if (
        SEVERITY[w.mode] > SEVERITY[last.mode] ||
        (SEVERITY[w.mode] === SEVERITY[last.mode] && w.k > last.k)
      ) {
        last.mode = w.mode
        last.k = w.k
      }
    } else {
      combined.push({ ...w })
    }
  }

  const inside = (f: number): boolean => combined.some((w) => f > w.fL && f < w.fR)

  // 3. Lokal splicen: Basis-Marken außerhalb der Fenster übernehmen, drinnen
  //    verwerfen; je Fenster Foto-Marken an den Rändern plus Basis-Restauration
  //    knapp außerhalb (pinnt die Umschalt-Mitte an den Rand).
  const raw: WeatherKeyframe[] = []
  for (const kf of sorted) {
    if (!inside(kf.f)) raw.push({ ...kf })
  }
  for (const w of combined) {
    const zpre = baseStateAt(sorted, w.fL)
    const zpost = baseStateAt(sorted, w.fR)
    if (w.fL > 0) raw.push({ f: w.fL - EDGE, mode: zpre.mode, k: zpre.k, source: zpre.source })
    raw.push({ f: w.fL, mode: w.mode, k: w.k, source: 'photo' })
    raw.push({ f: w.fR, mode: w.mode, k: w.k, source: 'photo' })
    if (w.fR < 1) raw.push({ f: w.fR + EDGE, mode: zpost.mode, k: zpost.k, source: zpost.source })
  }

  // 4. Sortieren, runden (wie berechneWetter), Marken auf gleichem f zusammenfassen.
  raw.sort((a, b) => a.f - b.f)
  const done: WeatherKeyframe[] = []
  for (const kf of raw) {
    const entry: WeatherKeyframe = {
      f: round(kf.f, 4),
      mode: kf.mode,
      k: round(kf.k, 2),
      source: kf.source,
    }
    const before = done[done.length - 1]
    // Gleiche Marke → die spätere (Foto vor Basis-Restauration am selben Rand) gewinnt.
    if (before && before.f === entry.f) done.pop()
    done.push(entry)
  }
  return done
}

// — Echte OpenRouter-Anbindung (nur Produktion; Tests injizieren fetch/Fake) —
// OpenRouter spricht die OpenAI-kompatible Chat-Completions-API und bündelt viele
// Vision-Modelle hinter EINEM Key — ein Modellwechsel ist dann eine Env-Variable,
// keine Code-Änderung.

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
/** Vision-Modell mit gutem Preis/Leistung (überschreibbar via LUHAMBO_VISION_MODELL). */
export const VISION_MODEL_DEFAULT = 'google/gemini-2.5-flash-lite'

const PROMPT = [
  'Analysiere das Foto und beschreibe ausschließlich die WETTERLAGE am Himmel.',
  'Antworte NUR mit einem JSON-Objekt, ohne Erklärung, exakt in dieser Form:',
  '{"himmel":"klar|wolkig|bedeckt","niederschlag":"kein|regen|schnee|gewitter|nebel","himmelSichtbar":true,"konfidenz":0.0}',
  '- himmel: klar (kaum Wolken), wolkig (aufgelockert), bedeckt (geschlossene Wolkendecke)',
  '- niederschlag: sichtbarer Niederschlag bzw. Nebel; sonst "kein"',
  '- himmelSichtbar: true, wenn der Himmel bzw. das Wetter im Bild erkennbar ist (false bei reinen Innen-/Detailaufnahmen)',
  '- konfidenz: 0.0–1.0, wie sicher die Einschätzung ist',
].join('\n')

/** Neutraler Befund: konfidenz 0 → übersteuert nie (Fallback bei Parse-/Netzfehler). */
const NEUTRAL: ImageFinding = {
  sky: 'wolkig',
  precipitation: 'kein',
  skyVisible: false,
  confidence: 0,
}

const SKY_MODES = new Set<ImageFinding['sky']>(['klar', 'wolkig', 'bedeckt'])
const PRECIPITATION_MODES = new Set<ImageFinding['precipitation']>([
  'kein',
  'regen',
  'schnee',
  'gewitter',
  'nebel',
])

/**
 * JSON aus einem (evtl. mit Prosa/Code-Zaun umrahmten) Text robust herausziehen.
 * `null` heißt „nicht verwertbar" — der Aufrufer macht daraus NEUTRAL und sagt
 * es im Protokoll; ohne diese Unterscheidung wäre eine Modell-Antwort, die gar
 * kein JSON enthält, nicht von einem ehrlichen „kein Wetter erkennbar" zu
 * trennen.
 */
function parseFinding(text: string): ImageFinding | null {
  const from = text.indexOf('{')
  const to = text.lastIndexOf('}')
  if (from < 0 || to <= from) return null
  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(text.slice(from, to + 1)) as Record<string, unknown>
  } catch {
    return null
  }
  const sky = obj['himmel'] as ImageFinding['sky']
  const precipitation = obj['niederschlag'] as ImageFinding['precipitation']
  if (!SKY_MODES.has(sky) || !PRECIPITATION_MODES.has(precipitation)) return null
  const confidence = typeof obj['konfidenz'] === 'number' ? clamp01(obj['konfidenz']) : 0
  return { sky, precipitation, skyVisible: obj['himmelSichtbar'] === true, confidence }
}

/** Uint8Array → base64 (ohne Zwischen-String je Byte). */
function toBase64(data: Uint8Array): string {
  return Buffer.from(data).toString('base64')
}

type FetchFn = typeof fetch

/**
 * Klassifiziert Fotos per Vision-Sprachmodell über OpenRouter (OpenAI-kompatible
 * Chat-Completions). Der Konstruktor nimmt den API-Key, optional ein `fetch`
 * (injizierbar für Tests) und ein Modell-Override. Fehler (Netz, HTTP, kaputte
 * Antwort) enden im neutralen Befund (konfidenz 0) statt in einer Exception —
 * ein einzelnes Bild darf die Anreicherung nie scheitern lassen.
 */
export class OpenRouterClassifier implements ImageClassifier {
  constructor(
    private readonly apiKey: string,
    private readonly fetchFn: FetchFn = fetch,
    private readonly model2: string = VISION_MODEL_DEFAULT,
  ) {}

  async classify(
    image: { data: Uint8Array; mediaType: string },
    log?: (message: string) => void,
  ): Promise<ImageFinding> {
    try {
      const response = await this.fetchFn(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
          // Optionale OpenRouter-Attribution — taucht in der Nutzungsübersicht auf.
          'http-referer': 'https://maptale.io',
          'x-title': 'Maptale',
        },
        body: JSON.stringify({
          model: this.model2,
          max_tokens: 200,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: PROMPT },
                {
                  type: 'image_url',
                  image_url: { url: `data:${image.mediaType};base64,${toBase64(image.data)}` },
                },
              ],
            },
          ],
        }),
      })
      // Die drei Fehlerzweige enden alle im neutralen Befund — richtig so, ein
      // einzelnes Bild darf die Anreicherung nie kippen. Aber sie MELDEN sich:
      // 402 (Guthaben leer) und 429 (Rate-Limit) treffen sonst jede Tour
      // gleichzeitig und lautlos, und ein per Env umgestelltes Modell, das kein
      // JSON liefert (Reasoning-Modelle verbrauchen max_tokens mit Denk-Tokens),
      // kostet Geld, ohne je etwas zu bewirken.
      if (!response.ok) {
        const reason =
          response.status === 402
            ? ' (Guthaben aufgebraucht?)'
            : response.status === 429
              ? ' (Rate-Limit)'
              : ''
        log?.(
          `Bildanalyse: ${this.model2} antwortete mit HTTP ${response.status}${reason}, Foto ohne Wirkung`,
        )
        return NEUTRAL
      }
      const json = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>
      }
      const text = json.choices?.[0]?.message?.content ?? ''
      const finding = parseFinding(text)
      if (!finding) {
        log?.(
          `Bildanalyse: ${this.model2} lieferte keinen verwertbaren Befund, ` +
            (text ? `Antwort begann mit „${text.slice(0, 80)}"` : 'die Antwort war leer'),
        )
        return NEUTRAL
      }
      return finding
    } catch (error) {
      log?.(`Bildanalyse: Aufruf an ${this.model2} fehlgeschlagen: ${(error as Error).message}`)
      return NEUTRAL
    }
  }
}

/**
 * Test-Fake: liefert einen festen Befund (oder je Aufruf einen aus der Liste,
 * letzter wiederholt) und zeichnet die Aufrufe auf — analog FesteWetterQuelle.
 */
export class FixedClassifier implements ImageClassifier {
  /** Mitschnitt der Aufrufe: Medientyp + Bytelänge des übergebenen Bildes. */
  public calls: Array<{ mediaType: string; bytes: number }> = []
  private i = 0

  constructor(private readonly finding: ImageFinding | ImageFinding[]) {}

  async classify(image: { data: Uint8Array; mediaType: string }): Promise<ImageFinding> {
    this.calls.push({ mediaType: image.mediaType, bytes: image.data.length })
    if (Array.isArray(this.finding)) {
      return this.finding[Math.min(this.i++, this.finding.length - 1)] ?? NEUTRAL
    }
    return this.finding
  }
}
