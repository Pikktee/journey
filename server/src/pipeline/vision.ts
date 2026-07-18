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

import type { WetterKeyframe, WetterModus } from './weather.js'

/**
 * Befund einer Bild-Klassifikation. Die Enums bilden sauber auf WetterModus ab
 * (himmel → clouds/off, niederschlag → rain/snow/storm/fog), damit das Mapping
 * unten total und ohne Sonderfälle ist.
 */
export interface BildBefund {
  /** Himmelszustand ohne Niederschlag: klar → off, wolkig/bedeckt → clouds */
  himmel: 'klar' | 'wolkig' | 'bedeckt'
  /** Sichtbarer Niederschlag bzw. Nebel; „kein" → der Himmel entscheidet */
  niederschlag: 'kein' | 'regen' | 'schnee' | 'gewitter' | 'nebel'
  /** Ist das Wetter im Bild überhaupt erkennbar? (nicht bei reinen Innenaufnahmen) */
  himmelSichtbar: boolean
  /** Sicherheit der Einschätzung, 0..1 */
  konfidenz: number
}

/** Klassifikator hinter Interface (DI) — Tests nutzen FesterKlassifikator. */
export interface BildKlassifikator {
  klassifiziere(bild: { daten: Uint8Array; medientyp: string }): Promise<BildBefund>
}

// Schweregrad-Rangfolge (Plan M5): „mehr Wetter" = höherer Rang. off < clouds <
// fog < rain < snow < storm — deckungsgleich mit der Idee, dass ein Foto die API
// nur dann übersteuern darf, wenn es eine dramatischere Wetterlage zeigt.
const SCHWERE: Record<WetterModus, number> = { off: 0, clouds: 1, fog: 2, rain: 3, snow: 4, storm: 5 }

// Fenster-Halbbreite in f: ein übersteuerndes Foto gilt lokal um seinen Anker.
const FENSTER_HALB = 0.03
// Kleiner Rand außerhalb des Fensters für die Basis-Restaurationsmarken — hält
// die Umschalt-Mitte des Players (Grenze auf der Marken-Mitte) am Fensterrand.
const RAND = 0.005
// Ab dieser Konfidenz (und nur bei sichtbarem Himmel) darf ein Foto übersteuern.
const MIN_KONFIDENZ = 0.7

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x))
const rund = (x: number, stellen: number): number => {
  const p = 10 ** stellen
  return Math.round(x * p) / p
}

/**
 * Bild-Befund → Wettermodus + Stärke k (0..1). Niederschlag/Nebel schlagen den
 * Himmelszustand; ohne Niederschlag entscheidet die Bewölkung (bedeckt kräftiger
 * als wolkig, klar = kein Wetter). k-Werte plausibel im Bereich der
 * wmoZuWetter-Stärken (weather.ts).
 */
export function bildBefundZuWetter(b: BildBefund): { mode: WetterModus; k: number } {
  switch (b.niederschlag) {
    case 'gewitter':
      return { mode: 'storm', k: 0.8 }
    case 'schnee':
      return { mode: 'snow', k: 0.7 }
    case 'regen':
      return { mode: 'rain', k: 0.6 }
    case 'nebel':
      return { mode: 'fog', k: 0.7 }
    case 'kein':
      if (b.himmel === 'bedeckt') return { mode: 'clouds', k: 0.9 }
      if (b.himmel === 'wolkig') return { mode: 'clouds', k: 0.5 }
      return { mode: 'off', k: 0.7 } // klar
  }
}

/**
 * Aktiver Zustand der Basis-Keyframes an Position f — exakt die Lookup-Logik des
 * Players (weatherAt in src/autoweather.js): die Grenze zwischen zwei Marken
 * liegt auf ihrer Mitte. `basis` muss nach f sortiert sein.
 */
function basisZustandBei(basis: readonly WetterKeyframe[], f: number): WetterKeyframe {
  if (!basis.length) return { f, mode: 'off', k: 0.7, source: 'openmeteo' }
  let aktiv = basis[0] as WetterKeyframe
  for (const kf of basis) {
    if (f >= (aktiv.f + kf.f) / 2) aktiv = kf
  }
  return aktiv
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
export function verfeinereWetterMitFotos(
  basis: WetterKeyframe[],
  fotos: Array<{ f: number; befund: BildBefund }>,
  opts?: { fenster?: number; minKonfidenz?: number },
): WetterKeyframe[] {
  const h = opts?.fenster ?? FENSTER_HALB
  const minK = opts?.minKonfidenz ?? MIN_KONFIDENZ
  const sortiert = [...basis].sort((a, b) => a.f - b.f)

  // 1. Übersteuernde Fotos → Fenster bestimmen.
  interface Fenster {
    fL: number
    fR: number
    mode: WetterModus
    k: number
  }
  const fenster: Fenster[] = []
  for (const foto of fotos) {
    const b = foto.befund
    if (!b.himmelSichtbar || b.konfidenz < minK) continue
    const fw = bildBefundZuWetter(b)
    const f = clamp01(foto.f)
    if (SCHWERE[fw.mode] <= SCHWERE[basisZustandBei(sortiert, f).mode]) continue
    fenster.push({ fL: clamp01(f - h), fR: clamp01(f + h), mode: fw.mode, k: fw.k })
  }
  if (!fenster.length) return sortiert.map((kf) => ({ ...kf }))

  // 2. Überlappende Fenster verschmelzen — in der Überlappung gewinnt das
  //    schwerere Wetter (bei Gleichstand die höhere Stärke).
  fenster.sort((a, b) => a.fL - b.fL)
  const zusammen: Fenster[] = []
  for (const w of fenster) {
    const letzter = zusammen[zusammen.length - 1]
    if (letzter && w.fL <= letzter.fR) {
      letzter.fR = Math.max(letzter.fR, w.fR)
      if (SCHWERE[w.mode] > SCHWERE[letzter.mode] || (SCHWERE[w.mode] === SCHWERE[letzter.mode] && w.k > letzter.k)) {
        letzter.mode = w.mode
        letzter.k = w.k
      }
    } else {
      zusammen.push({ ...w })
    }
  }

  const innerhalb = (f: number): boolean => zusammen.some((w) => f > w.fL && f < w.fR)

  // 3. Lokal splicen: Basis-Marken außerhalb der Fenster übernehmen, drinnen
  //    verwerfen; je Fenster Foto-Marken an den Rändern plus Basis-Restauration
  //    knapp außerhalb (pinnt die Umschalt-Mitte an den Rand).
  const roh: WetterKeyframe[] = []
  for (const kf of sortiert) {
    if (!innerhalb(kf.f)) roh.push({ ...kf })
  }
  for (const w of zusammen) {
    const zpre = basisZustandBei(sortiert, w.fL)
    const zpost = basisZustandBei(sortiert, w.fR)
    if (w.fL > 0) roh.push({ f: w.fL - RAND, mode: zpre.mode, k: zpre.k, source: zpre.source })
    roh.push({ f: w.fL, mode: w.mode, k: w.k, source: 'photo' })
    roh.push({ f: w.fR, mode: w.mode, k: w.k, source: 'photo' })
    if (w.fR < 1) roh.push({ f: w.fR + RAND, mode: zpost.mode, k: zpost.k, source: zpost.source })
  }

  // 4. Sortieren, runden (wie berechneWetter), Marken auf gleichem f zusammenfassen.
  roh.sort((a, b) => a.f - b.f)
  const fertig: WetterKeyframe[] = []
  for (const kf of roh) {
    const eintrag: WetterKeyframe = { f: rund(kf.f, 4), mode: kf.mode, k: rund(kf.k, 2), source: kf.source }
    const vorher = fertig[fertig.length - 1]
    // Gleiche Marke → die spätere (Foto vor Basis-Restauration am selben Rand) gewinnt.
    if (vorher && vorher.f === eintrag.f) fertig.pop()
    fertig.push(eintrag)
  }
  return fertig
}

// — Echte Anthropic-Anbindung (nur Produktion; Tests injizieren fetch/Fake) —

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
/** Modell exakt festgelegt (Plan M5): Claude Haiku 4.5. */
export const HAIKU_MODELL = 'claude-haiku-4-5-20251001'

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
const NEUTRAL: BildBefund = { himmel: 'wolkig', niederschlag: 'kein', himmelSichtbar: false, konfidenz: 0 }

const HIMMEL = new Set<BildBefund['himmel']>(['klar', 'wolkig', 'bedeckt'])
const NIEDERSCHLAG = new Set<BildBefund['niederschlag']>(['kein', 'regen', 'schnee', 'gewitter', 'nebel'])

/** JSON aus einem (evtl. mit Prosa/Code-Zaun umrahmten) Text robust herausziehen. */
function parseBefund(text: string): BildBefund {
  const von = text.indexOf('{')
  const bis = text.lastIndexOf('}')
  if (von < 0 || bis <= von) return NEUTRAL
  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(text.slice(von, bis + 1)) as Record<string, unknown>
  } catch {
    return NEUTRAL
  }
  const himmel = obj['himmel'] as BildBefund['himmel']
  const niederschlag = obj['niederschlag'] as BildBefund['niederschlag']
  if (!HIMMEL.has(himmel) || !NIEDERSCHLAG.has(niederschlag)) return NEUTRAL
  const konfidenz = typeof obj['konfidenz'] === 'number' ? clamp01(obj['konfidenz']) : 0
  return { himmel, niederschlag, himmelSichtbar: obj['himmelSichtbar'] === true, konfidenz }
}

/** Uint8Array → base64 (ohne Zwischen-String je Byte). */
function zuBase64(daten: Uint8Array): string {
  return Buffer.from(daten).toString('base64')
}

type FetchFn = typeof fetch

/**
 * Klassifiziert Fotos per Claude Haiku über die Anthropic Messages API. Der
 * Konstruktor nimmt den API-Key, optional ein `fetch` (injizierbar für Tests)
 * und ein Modell-Override. Fehler (Netz, HTTP, kaputte Antwort) enden im
 * neutralen Befund (konfidenz 0) statt in einer Exception — ein einzelnes Bild
 * darf die Anreicherung nie scheitern lassen.
 */
export class AnthropicKlassifikator implements BildKlassifikator {
  constructor(
    private readonly apiKey: string,
    private readonly fetchFn: FetchFn = fetch,
    private readonly modell: string = HAIKU_MODELL,
  ) {}

  async klassifiziere(bild: { daten: Uint8Array; medientyp: string }): Promise<BildBefund> {
    try {
      const antwort = await this.fetchFn(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: this.modell,
          max_tokens: 200,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: { type: 'base64', media_type: bild.medientyp, data: zuBase64(bild.daten) },
                },
                { type: 'text', text: PROMPT },
              ],
            },
          ],
        }),
      })
      if (!antwort.ok) return NEUTRAL
      const json = (await antwort.json()) as { content?: Array<{ type?: string; text?: string }> }
      const text = json.content?.find((c) => c.type === 'text')?.text ?? ''
      return parseBefund(text)
    } catch {
      return NEUTRAL
    }
  }
}

/**
 * Test-Fake: liefert einen festen Befund (oder je Aufruf einen aus der Liste,
 * letzter wiederholt) und zeichnet die Aufrufe auf — analog FesteWetterQuelle.
 */
export class FesterKlassifikator implements BildKlassifikator {
  /** Mitschnitt der Aufrufe: Medientyp + Bytelänge des übergebenen Bildes. */
  public aufrufe: Array<{ medientyp: string; bytes: number }> = []
  private i = 0

  constructor(private readonly befund: BildBefund | BildBefund[]) {}

  async klassifiziere(bild: { daten: Uint8Array; medientyp: string }): Promise<BildBefund> {
    this.aufrufe.push({ medientyp: bild.medientyp, bytes: bild.daten.length })
    if (Array.isArray(this.befund)) {
      return this.befund[Math.min(this.i++, this.befund.length - 1)] ?? NEUTRAL
    }
    return this.befund
  }
}
