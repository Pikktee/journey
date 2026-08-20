// Auto-Wetter: WMO-Mapping (Zwilling von src/autoweather.ts), Glättung,
// Keyframe-Destillat über Raum-Zeit-Samples und die Forecast/Archiv-Weiche.

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FixedWeatherSource,
  OpenMeteoSource,
  computeWeather,
  smoothSamples,
  testGrid,
  weatherFromOverlay,
  weatherToBoundaries,
  WEATHER_DEFAULT_K,
  wmoToWeather,
  type WeatherMode,
} from '../src/pipeline/weather.js'
import { buildTimeSeries } from '../src/pipeline/time.js'
import type { UploadSegment } from '../src/schema/upload.js'

describe('wmoZuWetter', () => {
  it('bildet WMO-Codes wie der Client-Fallback ab', () => {
    expect(wmoToWeather({ code: 95, wolken: 100, regenMm: 4, schneeCm: 0 })).toEqual({
      mode: 'storm',
      k: 1,
    })
    expect(wmoToWeather({ code: 71, wolken: 100, regenMm: 0, schneeCm: 1 }).mode).toBe('snow')
    expect(wmoToWeather({ code: 0, wolken: 0, regenMm: 0, schneeCm: 0.1 }).mode).toBe('snow')
    const regen = wmoToWeather({ code: 61, wolken: 90, regenMm: 1, schneeCm: 0 })
    expect(regen.mode).toBe('rain')
    expect(regen.k).toBeCloseTo(0.6, 10)
    expect(wmoToWeather({ code: 45, wolken: 10, regenMm: 0, schneeCm: 0 })).toEqual({
      mode: 'fog',
      k: 0.7,
    })
    // Bewölkung 62,5 % → k = 0.4 + 0.6·(37,5/75) = 0.7 (Paritäts-Zahl zum Client)
    expect(wmoToWeather({ code: 3, wolken: 62.5, regenMm: 0, schneeCm: 0 })).toEqual({
      mode: 'clouds',
      k: 0.7,
    })
    expect(wmoToWeather({ code: 0, wolken: 10, regenMm: 0, schneeCm: 0 })).toEqual({
      mode: 'off',
      k: 0.7,
    })
  })

  it('lässt Gewitter über Schnee über Regen gewinnen', () => {
    expect(wmoToWeather({ code: 96, wolken: 100, regenMm: 2, schneeCm: 1 }).mode).toBe('storm')
    expect(wmoToWeather({ code: 85, wolken: 100, regenMm: 2, schneeCm: 0 }).mode).toBe('snow')
  })
})

describe('glaetteSamples', () => {
  const s = (mode: WeatherMode, k = 0.5) => ({ mode, k })

  it('ersetzt ein Einzel-Sample zwischen einigen Nachbarn', () => {
    const out = smoothSamples([s('off'), s('storm', 1), s('off')])
    expect(out.map((x) => x.mode)).toEqual(['off', 'off', 'off'])
    expect(out[1]?.k).toBe(0.5)
  })

  it('lässt echte Übergänge und Ränder stehen', () => {
    // Übergang wolkig→regen→klar: das mittlere Sample ist echtes Wetter
    expect(smoothSamples([s('clouds'), s('rain'), s('off')]).map((x) => x.mode)).toEqual([
      'clouds',
      'rain',
      'off',
    ])
    // Aufklaren im letzten Sample (kurz vor Tour-Ende) bleibt erhalten
    expect(smoothSamples([s('rain'), s('rain'), s('off')]).map((x) => x.mode)).toEqual([
      'rain',
      'rain',
      'off',
    ])
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
    const quelle = new FixedWeatherSource(
      testGrid('2026-07-04T06', [
        { wolken: 5 },
        { wolken: 10 },
        { code: 61, regenMm: 1, wolken: 95 },
        { code: 61, regenMm: 1, wolken: 95 },
        { wolken: 5 },
      ]),
    )
    const keyframes = await computeWeather({
      reihe: buildTimeSeries([vierStundenMarsch()]),
      startIso: START,
      quelle,
    })
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
    const quelle = new FixedWeatherSource(
      testGrid('2026-07-04T06', [
        { wolken: 5 },
        { code: 95, regenMm: 4, wolken: 100 }, // einsames Gewitter-Sample
        { wolken: 5 },
        { wolken: 5 },
        { wolken: 5 },
      ]),
    )
    const keyframes = await computeWeather({
      reihe: buildTimeSeries([vierStundenMarsch()]),
      startIso: START,
      quelle,
    })
    expect(keyframes).toEqual([{ f: 0, mode: 'off', k: 0.7, source: 'openmeteo' }])
  })

  it('setzt bei deutlicher Stärke-Änderung im selben Modus eine Marke', async () => {
    const quelle = new FixedWeatherSource(
      testGrid('2026-07-04T06', [
        { code: 61, regenMm: 0.5, wolken: 95 }, // k = 0.5
        { code: 61, regenMm: 0.5, wolken: 95 },
        { code: 63, regenMm: 3, wolken: 100 }, // k = 1.0 → Marke
        { code: 63, regenMm: 3, wolken: 100 },
        { code: 63, regenMm: 3, wolken: 100 },
      ]),
    )
    const keyframes = await computeWeather({
      reihe: buildTimeSeries([vierStundenMarsch()]),
      startIso: START,
      quelle,
    })
    expect(keyframes.map((k) => [k.mode, k.k])).toEqual([
      ['rain', 0.5],
      ['rain', 1],
    ])
    expect(keyframes[1]?.f).toBe(0.5)
  })

  it('verteilt die Stunden einer Pause über die Zeitraffer-Rampe', async () => {
    // Vier Stunden Marsch, in der Mitte zwei Stunden Aufenthalt am selben Ort.
    // Alle Pausen-Stunden haben dieselbe KOORDINATE (dafür ist positionZurZeit
    // zuständig), aber verschiedene Stellen im Film — sonst fiele der Regen,
    // der während der Pause kam und ging, auf ein einziges f und verschwände.
    const pts: UploadSegment['pts'] = []
    let strecke = 0
    for (let t = 0; t <= 4 * 3600; t += 60) {
      pts.push([8.0 + strecke * GRAD_PRO_M, LAT, 500, t])
      if (t < 3600 || t >= 3 * 3600) strecke += 1.4 * 60
    }
    const quelle = new FixedWeatherSource(
      testGrid('2026-07-04T06', [
        { wolken: 5 }, // 06 klar (vor der Pause)
        { wolken: 5 }, // 07 klar
        { code: 61, regenMm: 1, wolken: 95 }, // 08 Regen — mitten in der Pause
        { code: 61, regenMm: 1, wolken: 95 }, // 09 Regen
        { wolken: 5 }, // 10 klar (nach der Pause)
      ]),
    )
    const keyframes = await computeWeather({
      reihe: buildTimeSeries([{ mode: 'walk', pts }]),
      startIso: START,
      quelle,
    })

    // Der Regen ist da — mit Anfang UND Ende, nicht auf einen Punkt geschrumpft
    expect(keyframes.map((k) => k.mode)).toEqual(['off', 'off', 'rain', 'rain', 'off'])
    // … und alle Marken liegen auf verschiedenen Stellen der Strecke
    const fs = keyframes.map((k) => k.f)
    expect(new Set(fs).size).toBe(fs.length)
    // Die drei mittleren Marken drängen sich im schmalen Rampenfenster
    expect((fs[3] as number) - (fs[1] as number)).toBeLessThan(0.1)
  })

  it('wirft bei leerer Quelle (enrich lässt weather dann weg)', async () => {
    const quelle = new FixedWeatherSource({
      zeiten: [],
      code: [],
      wolken: [],
      regen: [],
      schnee: [],
    })
    await expect(
      computeWeather({ reihe: buildTimeSeries([vierStundenMarsch()]), startIso: START, quelle }),
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
    const quelle = new OpenMeteoSource(() => new Date('2026-07-08T12:00:00Z'))
    const raster = await quelle.stunden(
      [
        { lat: 46.59, lng: 8.0 },
        { lat: 46.6, lng: 8.1 },
      ],
      '2026-07-04',
      '2026-07-04',
    )
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
    const quelle = new OpenMeteoSource(() => new Date('2026-07-08T12:00:00Z'))
    await quelle.stunden([{ lat: 46.59, lng: 8.0 }], '2026-06-01', '2026-06-01')
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('archive-api.open-meteo.com/v1/archive')
  })

  it('meldet HTTP-Fehler als Exception', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 429 }) as Response),
    )
    const quelle = new OpenMeteoSource(() => new Date('2026-07-08T12:00:00Z'))
    await expect(
      quelle.stunden([{ lat: 46.59, lng: 8.0 }], '2026-06-01', '2026-06-01'),
    ).rejects.toThrow(/429/)
  })
})

describe('wetterAusOverlay (Studio-Wetter)', () => {
  // Gerade Strecke, Zeit linear zur Distanz → tOffset/1000 = f (bequeme Marken).
  const reihe = buildTimeSeries([
    {
      mode: 'walk',
      pts: [
        [7.9, 46.5, 0, 0],
        [7.91, 46.51, 0, 1000],
      ],
    },
  ] as UploadSegment[])
  const START = Date.parse('2026-01-01T00:00:00Z')
  const ab = (s: number): string => new Date(START + s * 1000).toISOString()

  it('eine Grenze schaltet EXAKT an ihrem f (Marken-Paar auf demselben f)', () => {
    const kf = weatherFromOverlay([{ from: ab(500), mode: 'rain' }], reihe, START)
    expect(kf).toEqual([
      { f: 0, mode: 'off', k: WEATHER_DEFAULT_K, source: 'studio' },
      { f: 0.5, mode: 'off', k: WEATHER_DEFAULT_K, source: 'studio' },
      { f: 0.5, mode: 'rain', k: WEATHER_DEFAULT_K, source: 'studio' },
      { f: 1, mode: 'rain', k: WEATHER_DEFAULT_K, source: 'studio' },
    ])
  })

  it('übernimmt die Stärke der Grenze; der Grund bleibt klar mit Standardstärke', () => {
    const kf = weatherFromOverlay([{ from: ab(500), mode: 'rain', intensity: 0.5 }], reihe, START)
    expect(kf.filter((k) => k.mode === 'rain').every((k) => k.k === 0.5)).toBe(true)
    expect(kf.filter((k) => k.mode === 'off').every((k) => k.k === WEATHER_DEFAULT_K)).toBe(true)
  })

  it('eine Grenze am/vor dem Track-Anfang ersetzt den klaren Grund', () => {
    const kf = weatherFromOverlay([{ from: ab(-100), mode: 'snow' }], reihe, START)
    expect(kf).toEqual([
      { f: 0, mode: 'snow', k: WEATHER_DEFAULT_K, source: 'studio' },
      { f: 1, mode: 'snow', k: WEATHER_DEFAULT_K, source: 'studio' },
    ])
  })

  it('mehrere Grenzen ergeben lückenlose Bänder mit exakten Umschaltungen', () => {
    const kf = weatherFromOverlay(
      [
        { from: ab(300), mode: 'rain' },
        { from: ab(700), mode: 'snow' },
      ],
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

describe('wetterZuGrenzen (Auto-Wetter fürs Studio)', () => {
  // Gerade Strecke, Zeit linear zur Distanz → f · 1000 s = tOffset.
  const reihe = buildTimeSeries([
    {
      mode: 'walk',
      pts: [
        [7.9, 46.5, 0, 0],
        [7.91, 46.51, 0, 1000],
      ],
    },
  ] as UploadSegment[])
  const START = Date.parse('2026-01-01T00:00:00Z')
  const bei = (s: number): string => new Date(START + s * 1000).toISOString()

  it('setzt die Grenze auf die MITTE zwischen zwei Marken — wo der Player schaltet', () => {
    const grenzen = weatherToBoundaries(
      [
        { f: 0, mode: 'off', k: 0.7, source: 'openmeteo' },
        { f: 0.4, mode: 'rain', k: 0.6, source: 'openmeteo' },
      ],
      reihe,
      START,
    )
    expect(grenzen).toEqual([
      { from: bei(0), mode: 'off', intensity: 0.7 },
      { from: bei(200), mode: 'rain', intensity: 0.6 },
    ])
  })

  it('fasst gleiche Zustände in Folge zu EINEM Band zusammen', () => {
    const grenzen = weatherToBoundaries(
      [
        { f: 0, mode: 'clouds', k: 0.5, source: 'openmeteo' },
        { f: 0.3, mode: 'clouds', k: 0.5, source: 'openmeteo' },
        { f: 0.6, mode: 'clouds', k: 0.5, source: 'openmeteo' },
      ],
      reihe,
      START,
    )
    expect(grenzen).toEqual([{ from: bei(0), mode: 'clouds', intensity: 0.5 }])
  })

  it('eine reine Stärke-Änderung ist auch eine Grenze', () => {
    const grenzen = weatherToBoundaries(
      [
        { f: 0, mode: 'rain', k: 0.4, source: 'openmeteo' },
        { f: 0.5, mode: 'rain', k: 0.9, source: 'openmeteo' },
      ],
      reihe,
      START,
    )
    expect(grenzen.map((g) => g.intensity)).toEqual([0.4, 0.9])
  })

  it('ist die Umkehrung von wetterAusOverlay (Rundlauf)', () => {
    // Was der Editor zeigt, muss beim Speichern dieselbe Tour ergeben.
    const original = [
      { from: bei(0), mode: 'clouds' as WeatherMode, intensity: 0.6 },
      { from: bei(400), mode: 'rain' as WeatherMode, intensity: 0.8 },
      { from: bei(700), mode: 'off' as WeatherMode, intensity: 0.7 },
    ]
    const zurueck = weatherToBoundaries(weatherFromOverlay(original, reihe, START), reihe, START)
    expect(zurueck).toEqual(original)
  })

  it('bleibt bei leeren Keyframes leer', () => {
    expect(weatherToBoundaries([], reihe, START)).toEqual([])
  })
})
