// Auto-Wetter: WMO-Mapping (Zwilling von src/autoweather.js), Glättung,
// Keyframe-Destillat über Raum-Zeit-Samples und die Forecast/Archiv-Weiche.

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FesteWetterQuelle,
  OpenMeteoQuelle,
  berechneWetter,
  glaetteSamples,
  testRaster,
  wetterAusOverlay,
  WETTER_STANDARD_K,
  wmoZuWetter,
  type WetterModus,
} from '../src/pipeline/weather.js'
import { baueZeitreihe } from '../src/pipeline/zeit.js'
import type { UploadSegment } from '../src/schema/upload.js'

describe('wmoZuWetter', () => {
  it('bildet WMO-Codes wie der Client-Fallback ab', () => {
    expect(wmoZuWetter({ code: 95, wolken: 100, regenMm: 4, schneeCm: 0 })).toEqual({ mode: 'storm', k: 1 })
    expect(wmoZuWetter({ code: 71, wolken: 100, regenMm: 0, schneeCm: 1 }).mode).toBe('snow')
    expect(wmoZuWetter({ code: 0, wolken: 0, regenMm: 0, schneeCm: 0.1 }).mode).toBe('snow')
    const regen = wmoZuWetter({ code: 61, wolken: 90, regenMm: 1, schneeCm: 0 })
    expect(regen.mode).toBe('rain')
    expect(regen.k).toBeCloseTo(0.6, 10)
    expect(wmoZuWetter({ code: 45, wolken: 10, regenMm: 0, schneeCm: 0 })).toEqual({ mode: 'fog', k: 0.7 })
    // Bewölkung 62,5 % → k = 0.4 + 0.6·(37,5/75) = 0.7 (Paritäts-Zahl zum Client)
    expect(wmoZuWetter({ code: 3, wolken: 62.5, regenMm: 0, schneeCm: 0 })).toEqual({ mode: 'clouds', k: 0.7 })
    expect(wmoZuWetter({ code: 0, wolken: 10, regenMm: 0, schneeCm: 0 })).toEqual({ mode: 'off', k: 0.7 })
  })

  it('lässt Gewitter über Schnee über Regen gewinnen', () => {
    expect(wmoZuWetter({ code: 96, wolken: 100, regenMm: 2, schneeCm: 1 }).mode).toBe('storm')
    expect(wmoZuWetter({ code: 85, wolken: 100, regenMm: 2, schneeCm: 0 }).mode).toBe('snow')
  })
})

describe('glaetteSamples', () => {
  const s = (mode: WetterModus, k = 0.5) => ({ mode, k })

  it('ersetzt ein Einzel-Sample zwischen einigen Nachbarn', () => {
    const out = glaetteSamples([s('off'), s('storm', 1), s('off')])
    expect(out.map((x) => x.mode)).toEqual(['off', 'off', 'off'])
    expect(out[1]?.k).toBe(0.5)
  })

  it('lässt echte Übergänge und Ränder stehen', () => {
    // Übergang wolkig→regen→klar: das mittlere Sample ist echtes Wetter
    expect(glaetteSamples([s('clouds'), s('rain'), s('off')]).map((x) => x.mode)).toEqual(['clouds', 'rain', 'off'])
    // Aufklaren im letzten Sample (kurz vor Tour-Ende) bleibt erhalten
    expect(glaetteSamples([s('rain'), s('rain'), s('off')]).map((x) => x.mode)).toEqual(['rain', 'rain', 'off'])
  })
})

// — berechneWetter über einem synthetischen 4-h-Marsch (06–10 Uhr UTC) —

const LAT = 46.59
const GRAD_PRO_M = 1 / (111_320 * Math.cos((LAT * Math.PI) / 180))
const START = '2026-07-04T06:00:00Z'

function vierStundenMarsch(): UploadSegment {
  const pts: UploadSegment['pts'] = []
  for (let t = 0; t <= 4 * 3600; t += 60) pts.push([8.0 + t * 1.4 * GRAD_PRO_M, LAT, 500, t])
  return { mode: 'walk', pts }
}

describe('berechneWetter', () => {
  it('destilliert Keyframes mit Marken vor und nach jedem Wechsel', async () => {
    // Stunden 06+07 klar, 08+09 Regen, 10 klar → Samples [off,off,rain,rain,off]
    const quelle = new FesteWetterQuelle(
      testRaster('2026-07-04T06', [
        { wolken: 5 },
        { wolken: 10 },
        { code: 61, regenMm: 1, wolken: 95 },
        { code: 61, regenMm: 1, wolken: 95 },
        { wolken: 5 },
      ]),
    )
    const keyframes = await berechneWetter({ reihe: baueZeitreihe([vierStundenMarsch()]), startIso: START, quelle })
    expect(keyframes.map((k) => k.mode)).toEqual(['off', 'off', 'rain', 'rain', 'off'])
    // Marken sitzen auf den Sample-Positionen (0, 07:00→0.25, 08:00→0.5, …)
    expect(keyframes.map((k) => k.f)).toEqual([0, 0.25, 0.5, 0.75, 1])
    expect(keyframes[0]?.source).toBe('openmeteo')
    // Sample-Plan: ein Abruf, 5 Orte (Start, 3 volle Stunden, Ende), Tagesgrenzen
    expect(quelle.abfragen).toHaveLength(1)
    expect(quelle.abfragen[0]?.punkte).toHaveLength(5)
    expect(quelle.abfragen[0]?.startTag).toBe('2026-07-04')
    expect(quelle.abfragen[0]?.endeTag).toBe('2026-07-04')
  })

  it('glättet ein Ein-Stunden-Flackern weg', async () => {
    const quelle = new FesteWetterQuelle(
      testRaster('2026-07-04T06', [
        { wolken: 5 },
        { code: 95, regenMm: 4, wolken: 100 }, // einsames Gewitter-Sample
        { wolken: 5 },
        { wolken: 5 },
        { wolken: 5 },
      ]),
    )
    const keyframes = await berechneWetter({ reihe: baueZeitreihe([vierStundenMarsch()]), startIso: START, quelle })
    expect(keyframes).toEqual([{ f: 0, mode: 'off', k: 0.7, source: 'openmeteo' }])
  })

  it('setzt bei deutlicher Stärke-Änderung im selben Modus eine Marke', async () => {
    const quelle = new FesteWetterQuelle(
      testRaster('2026-07-04T06', [
        { code: 61, regenMm: 0.5, wolken: 95 }, // k = 0.5
        { code: 61, regenMm: 0.5, wolken: 95 },
        { code: 63, regenMm: 3, wolken: 100 }, // k = 1.0 → Marke
        { code: 63, regenMm: 3, wolken: 100 },
        { code: 63, regenMm: 3, wolken: 100 },
      ]),
    )
    const keyframes = await berechneWetter({ reihe: baueZeitreihe([vierStundenMarsch()]), startIso: START, quelle })
    expect(keyframes.map((k) => [k.mode, k.k])).toEqual([
      ['rain', 0.5],
      ['rain', 1],
    ])
    expect(keyframes[1]?.f).toBe(0.5)
  })

  it('wirft bei leerer Quelle (enrich lässt weather dann weg)', async () => {
    const quelle = new FesteWetterQuelle({ zeiten: [], code: [], wolken: [], regen: [], schnee: [] })
    await expect(
      berechneWetter({ reihe: baueZeitreihe([vierStundenMarsch()]), startIso: START, quelle }),
    ).rejects.toThrow(/Stundenwerte/)
  })
})

describe('OpenMeteoQuelle', () => {
  afterEach(() => vi.unstubAllGlobals())

  const antwort = (n: number) => {
    const hourly = {
      time: ['2026-07-04T06:00'],
      weather_code: [0],
      cloud_cover: [10],
      precipitation: [0],
      snowfall: [0],
    }
    const json = n === 1 ? { hourly } : Array.from({ length: n }, () => ({ hourly }))
    return { ok: true, json: async () => json } as Response
  }

  it('fragt junge Touren über die Forecast-API ab (Archiv läuft nach)', async () => {
    const fetchMock = vi.fn(async (_url: string) => antwort(2))
    vi.stubGlobal('fetch', fetchMock)
    const quelle = new OpenMeteoQuelle(() => new Date('2026-07-08T12:00:00Z'))
    const raster = await quelle.stunden([{ lat: 46.59, lng: 8.0 }, { lat: 46.6, lng: 8.1 }], '2026-07-04', '2026-07-04')
    expect(raster).toHaveLength(2)
    const url = String(fetchMock.mock.calls[0]?.[0])
    expect(url).toContain('api.open-meteo.com/v1/forecast')
    expect(url).toContain('latitude=46.5900%2C46.6000')
    expect(url).toContain('start_date=2026-07-04')
    expect(url).toContain('timezone=UTC')
  })

  it('fragt alte Touren über die Archiv-API ab', async () => {
    const fetchMock = vi.fn(async (_url: string) => antwort(1))
    vi.stubGlobal('fetch', fetchMock)
    const quelle = new OpenMeteoQuelle(() => new Date('2026-07-08T12:00:00Z'))
    await quelle.stunden([{ lat: 46.59, lng: 8.0 }], '2026-06-01', '2026-06-01')
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('archive-api.open-meteo.com/v1/archive')
  })

  it('meldet HTTP-Fehler als Exception', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 429 }) as Response))
    const quelle = new OpenMeteoQuelle(() => new Date('2026-07-08T12:00:00Z'))
    await expect(quelle.stunden([{ lat: 46.59, lng: 8.0 }], '2026-06-01', '2026-06-01')).rejects.toThrow(/429/)
  })
})

describe('wetterAusOverlay (Studio-Wetter)', () => {
  // Gerade Strecke, Zeit linear zur Distanz → tOffset/1000 = f (bequeme Marken).
  const reihe = baueZeitreihe([
    { mode: 'walk', pts: [[7.9, 46.5, 0, 0], [7.91, 46.51, 0, 1000]] },
  ] as UploadSegment[])
  const START = Date.parse('2026-01-01T00:00:00Z')
  const ab = (s: number): string => new Date(START + s * 1000).toISOString()

  it('eine Grenze schaltet EXAKT an ihrem f (Marken-Paar auf demselben f)', () => {
    const kf = wetterAusOverlay([{ ab: ab(500), mode: 'rain' }], reihe, START)
    expect(kf).toEqual([
      { f: 0, mode: 'off', k: WETTER_STANDARD_K, source: 'studio' },
      { f: 0.5, mode: 'off', k: WETTER_STANDARD_K, source: 'studio' },
      { f: 0.5, mode: 'rain', k: WETTER_STANDARD_K, source: 'studio' },
      { f: 1, mode: 'rain', k: WETTER_STANDARD_K, source: 'studio' },
    ])
  })

  it('übernimmt die Stärke der Grenze; der Grund bleibt klar mit Standardstärke', () => {
    const kf = wetterAusOverlay([{ ab: ab(500), mode: 'rain', staerke: 0.5 }], reihe, START)
    expect(kf.filter((k) => k.mode === 'rain').every((k) => k.k === 0.5)).toBe(true)
    expect(kf.filter((k) => k.mode === 'off').every((k) => k.k === WETTER_STANDARD_K)).toBe(true)
  })

  it('eine Grenze am/vor dem Track-Anfang ersetzt den klaren Grund', () => {
    const kf = wetterAusOverlay([{ ab: ab(-100), mode: 'snow' }], reihe, START)
    expect(kf).toEqual([
      { f: 0, mode: 'snow', k: WETTER_STANDARD_K, source: 'studio' },
      { f: 1, mode: 'snow', k: WETTER_STANDARD_K, source: 'studio' },
    ])
  })

  it('mehrere Grenzen ergeben lückenlose Bänder mit exakten Umschaltungen', () => {
    const kf = wetterAusOverlay(
      [{ ab: ab(300), mode: 'rain' }, { ab: ab(700), mode: 'snow' }],
      reihe,
      START,
    )
    expect(kf.map((k) => [k.f, k.mode])).toEqual([
      [0, 'off'],
      [0.3, 'off'],
      [0.3, 'rain'],
      [0.7, 'rain'],
      [0.7, 'snow'],
      [1, 'snow'],
    ])
  })
})
