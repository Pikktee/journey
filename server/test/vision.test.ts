// Wetter-Verfeinerung per Bildanalyse (M5): Befund→Wetter-Mapping, die
// Konflikt-Merge-Regel (reine Funktionen, kein Netz) und die OpenRouter-Anbindung
// mit injiziertem fetch (ebenfalls netzlos).

import { describe, expect, it, vi } from 'vitest'
import {
  OpenRouterClassifier,
  FixedClassifier,
  imageFindingToWeather,
  refineWeatherWithPhotos,
  type ImageFinding,
} from '../src/pipeline/vision.js'
import type { WeatherKeyframe } from '../src/pipeline/weather.js'

const befund = (patch: Partial<ImageFinding> = {}): ImageFinding => ({
  sky: 'wolkig',
  precipitation: 'kein',
  skyVisible: true,
  confidence: 0.9,
  ...patch,
})

describe('bildBefundZuWetter', () => {
  it('bildet Niederschlag/Nebel auf ihren Modus ab (schlägt den Himmel)', () => {
    expect(imageFindingToWeather(befund({ precipitation: 'gewitter' }))).toEqual({
      mode: 'storm',
      k: 0.8,
    })
    expect(imageFindingToWeather(befund({ precipitation: 'schnee' }))).toEqual({
      mode: 'snow',
      k: 0.7,
    })
    expect(imageFindingToWeather(befund({ precipitation: 'regen' }))).toEqual({
      mode: 'rain',
      k: 0.6,
    })
    expect(imageFindingToWeather(befund({ precipitation: 'nebel' }))).toEqual({
      mode: 'fog',
      k: 0.7,
    })
    // Niederschlag gewinnt auch gegen einen „klar"-Himmel
    expect(imageFindingToWeather(befund({ sky: 'klar', precipitation: 'regen' })).mode).toBe('rain')
  })

  it('bildet ohne Niederschlag den Himmel ab (bedeckt kräftiger als wolkig, klar = off)', () => {
    expect(imageFindingToWeather(befund({ sky: 'bedeckt' }))).toEqual({ mode: 'clouds', k: 0.9 })
    expect(imageFindingToWeather(befund({ sky: 'wolkig' }))).toEqual({ mode: 'clouds', k: 0.5 })
    expect(imageFindingToWeather(befund({ sky: 'klar' }))).toEqual({ mode: 'off', k: 0.7 })
  })
})

const kf = (f: number, mode: WeatherKeyframe['mode'], k = 0.7): WeatherKeyframe => ({
  f,
  mode,
  k,
  source: 'openmeteo',
})

describe('verfeinereWetterMitFotos', () => {
  it('übersteuert, wenn ein sicheres Foto MEHR Wetter zeigt (Fenster ±0.03, source photo)', () => {
    const out = refineWeatherWithPhotos(
      [kf(0, 'off')],
      [{ f: 0.5, finding: befund({ precipitation: 'gewitter' }) }],
    )
    const photo = out.filter((k) => k.source === 'photo')
    expect(photo.map((k) => k.f)).toEqual([0.47, 0.53]) // ±0.03 um den Anker
    expect(photo.every((k) => k.mode === 'storm' && k.k === 0.8)).toBe(true)
    // Basis links/rechts bleibt „off" (openmeteo) erhalten
    expect(out[0]).toEqual({ f: 0, mode: 'off', k: 0.7, source: 'openmeteo' })
    expect(out.at(-1)).toEqual({ f: 0.535, mode: 'off', k: 0.7, source: 'openmeteo' })
  })

  it('lässt die Basis unangetastet, wenn das Foto NICHT mehr Wetter zeigt', () => {
    const basis = [kf(0, 'rain', 0.6)]
    // Wolken sind weniger als Regen → kein Override
    expect(
      refineWeatherWithPhotos(basis, [{ f: 0.5, finding: befund({ sky: 'bedeckt' }) }]),
    ).toEqual(basis)
  })

  it('lässt API-Niederschlag IMMER gegen ein klar-Foto gewinnen', () => {
    const basis = [kf(0, 'rain', 0.6)]
    const out = refineWeatherWithPhotos(basis, [
      { f: 0.5, finding: befund({ sky: 'klar', precipitation: 'kein', confidence: 0.99 }) },
    ])
    expect(out).toEqual(basis) // Wolkenloch-Foto (off) wischt den Regen nicht weg
  })

  it('übersteuert nur bei hoher Konfidenz UND sichtbarem Himmel', () => {
    const basis = [kf(0, 'off')]
    const stark = befund({ precipitation: 'gewitter' })
    expect(
      refineWeatherWithPhotos(basis, [{ f: 0.5, finding: { ...stark, confidence: 0.6 } }]),
    ).toEqual(basis)
    expect(
      refineWeatherWithPhotos(basis, [{ f: 0.5, finding: { ...stark, skyVisible: false } }]),
    ).toEqual(basis)
  })

  it('klemmt das Fenster an den Streckenrändern f∈[0,1]', () => {
    const anfang = refineWeatherWithPhotos(
      [kf(0, 'off')],
      [{ f: 0, finding: befund({ precipitation: 'regen' }) }],
    )
    expect(anfang.every((k) => k.f >= 0)).toBe(true)
    expect(anfang.find((k) => k.f === 0)?.source).toBe('photo') // Foto beginnt am Start
    const ende = refineWeatherWithPhotos(
      [kf(0, 'off')],
      [{ f: 1, finding: befund({ precipitation: 'regen' }) }],
    )
    expect(ende.every((k) => k.f <= 1)).toBe(true)
    expect(ende.at(-1)).toMatchObject({ f: 1, mode: 'rain', source: 'photo' })
  })

  it('verschmilzt überlappende Foto-Fenster (schwereres Wetter gewinnt)', () => {
    const out = refineWeatherWithPhotos(
      [kf(0, 'off')],
      [
        { f: 0.5, finding: befund({ precipitation: 'regen' }) }, // Fenster [0.47, 0.53]
        { f: 0.54, finding: befund({ precipitation: 'gewitter' }) }, // Fenster [0.51, 0.57] — überlappt
      ],
    )
    const photo = out.filter((k) => k.source === 'photo')
    expect(photo.map((k) => k.f)).toEqual([0.47, 0.57]) // EIN verschmolzenes Fenster
    expect(photo.every((k) => k.mode === 'storm')).toBe(true) // das schwerere Wetter
  })

  it('setzt getrennte Fenster für weit auseinanderliegende Fotos', () => {
    const out = refineWeatherWithPhotos(
      [kf(0, 'off')],
      [
        { f: 0.2, finding: befund({ precipitation: 'regen' }) },
        { f: 0.8, finding: befund({ precipitation: 'schnee' }) },
      ],
    )
    const photo = out.filter((k) => k.source === 'photo')
    expect(photo.map((k) => [k.f, k.mode])).toEqual([
      [0.17, 'rain'],
      [0.23, 'rain'],
      [0.77, 'snow'],
      [0.83, 'snow'],
    ])
  })

  it('gibt die Basis unverändert zurück, wenn kein Foto übersteuert', () => {
    const basis = [kf(0, 'clouds', 0.5), kf(0.5, 'rain', 0.6)]
    expect(refineWeatherWithPhotos(basis, [])).toEqual(basis)
  })
})

describe('OpenRouterKlassifikator', () => {
  const bild = { data: new Uint8Array([1, 2, 3]), mediaType: 'image/jpeg' }

  it('ruft die OpenRouter-Chat-API mit dem Vision-Modell + base64-Bild und parst strenges JSON', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content:
                'Ergebnis: {"himmel":"bedeckt","niederschlag":"regen","himmelSichtbar":true,"konfidenz":0.82}',
            },
          },
        ],
      }),
    }))
    const k = new OpenRouterClassifier('sk-test', fetchMock as unknown as typeof fetch)
    const b = await k.classify(bild)
    expect(b).toEqual({
      sky: 'bedeckt',
      precipitation: 'regen',
      skyVisible: true,
      confidence: 0.82,
    })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer sk-test')
    const body = JSON.parse(init.body as string) as {
      model: string
      messages: Array<{ content: Array<{ type: string; image_url?: { url: string } }> }>
    }
    expect(body.model).toBe('google/gemini-2.5-flash-lite')
    const bildBlock = body.messages[0]?.content.find((c) => c.type === 'image_url')
    expect(bildBlock?.image_url?.url).toBe(
      `data:image/jpeg;base64,${Buffer.from([1, 2, 3]).toString('base64')}`,
    )
  })

  it('nutzt das übergebene Modell-Override', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{}' } }] }),
    }))
    const k = new OpenRouterClassifier(
      'sk',
      fetchMock as unknown as typeof fetch,
      'openai/gpt-4o-mini',
    )
    await k.classify(bild)
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect((JSON.parse(init.body as string) as { model: string }).model).toBe('openai/gpt-4o-mini')
  })

  it('liefert einen neutralen Befund (konfidenz 0) bei HTTP-Fehler', async () => {
    const k = new OpenRouterClassifier('sk', (async () => ({
      ok: false,
      status: 500,
    })) as unknown as typeof fetch)
    expect((await k.classify(bild)).confidence).toBe(0)
  })

  it('liefert einen neutralen Befund, wenn die Antwort kein verwertbares JSON enthält', async () => {
    const k = new OpenRouterClassifier('sk', (async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'keine Ahnung, tut mir leid' } }] }),
    })) as unknown as typeof fetch)
    expect((await k.classify(bild)).confidence).toBe(0)
  })

  it('fängt Netz-Ausnahmen ab (neutraler Befund statt Absturz)', async () => {
    const k = new OpenRouterClassifier('sk', (async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch)
    expect((await k.classify(bild)).skyVisible).toBe(false)
  })

  it('weist unbekannte Enum-Werte als neutral zurück', async () => {
    const k = new OpenRouterClassifier('sk', (async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content:
                '{"himmel":"sonnig","niederschlag":"kein","himmelSichtbar":true,"konfidenz":0.9}',
            },
          },
        ],
      }),
    })) as unknown as typeof fetch)
    expect((await k.classify(bild)).confidence).toBe(0)
  })

  // Der neutrale Befund ist die richtige Reaktion, aber er sieht von außen aus
  // wie „das Foto zeigte eben kein Wetter". Ohne Meldung liefe eine Instanz mit
  // leerem Guthaben oder falsch gesetztem Modell dauerhaft ohne Verfeinerung —
  // und niemand wüsste warum. Deshalb sagt JEDER Fehlerzweig Bescheid.
  it('meldet, warum ein Bild nichts beigetragen hat', async () => {
    const meldungen: string[] = []
    const melde = (n: string): void => void meldungen.push(n)

    const guthaben = new OpenRouterClassifier('sk', (async () => ({
      ok: false,
      status: 402,
    })) as unknown as typeof fetch)
    await guthaben.classify(bild, melde)
    expect(meldungen[0]).toMatch(/HTTP 402.*Guthaben/)

    const limit = new OpenRouterClassifier('sk', (async () => ({
      ok: false,
      status: 429,
    })) as unknown as typeof fetch)
    await limit.classify(bild, melde)
    expect(meldungen[1]).toMatch(/Rate-Limit/)

    // Reasoning-Modelle verbrauchen max_tokens mit Denk-Tokens und antworten leer
    const leer = new OpenRouterClassifier(
      'sk',
      (async () => ({
        ok: true,
        json: async () => ({ choices: [{ message: { content: '' } }] }),
      })) as unknown as typeof fetch,
      'openai/gpt-5-nano',
    )
    await leer.classify(bild, melde)
    expect(meldungen[2]).toMatch(/gpt-5-nano.*Antwort war leer/)

    const prosa = new OpenRouterClassifier('sk', (async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Das Bild zeigt einen Wasserfall.' } }],
      }),
    })) as unknown as typeof fetch)
    await prosa.classify(bild, melde)
    expect(meldungen[3]).toMatch(/Antwort begann mit .Das Bild zeigt/)

    const netz = new OpenRouterClassifier('sk', (async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch)
    await netz.classify(bild, melde)
    expect(meldungen[4]).toMatch(/fehlgeschlagen: offline/)
  })

  it('schweigt, wenn der Befund verwertbar ist', async () => {
    const meldungen: string[] = []
    const k = new OpenRouterClassifier('sk', (async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content:
                '{"himmel":"klar","niederschlag":"kein","himmelSichtbar":true,"konfidenz":0.9}',
            },
          },
        ],
      }),
    })) as unknown as typeof fetch)
    await k.classify(bild, (n) => void meldungen.push(n))
    expect(meldungen).toEqual([])
  })
})

describe('FesterKlassifikator', () => {
  it('liefert einen festen Befund und zeichnet die Aufrufe auf', async () => {
    const k = new FixedClassifier(befund({ precipitation: 'schnee' }))
    const b = await k.classify({ data: new Uint8Array([9, 9]), mediaType: 'image/png' })
    expect(b.precipitation).toBe('schnee')
    expect(k.calls).toEqual([{ mediaType: 'image/png', bytes: 2 }])
  })

  it('gibt Befunde einer Liste der Reihe nach zurück (letzter wiederholt)', async () => {
    const k = new FixedClassifier([
      befund({ precipitation: 'regen' }),
      befund({ precipitation: 'gewitter' }),
    ])
    const eins = await k.classify({ data: new Uint8Array(), mediaType: 'image/jpeg' })
    const zwei = await k.classify({ data: new Uint8Array(), mediaType: 'image/jpeg' })
    const drei = await k.classify({ data: new Uint8Array(), mediaType: 'image/jpeg' })
    expect([eins.precipitation, zwei.precipitation, drei.precipitation]).toEqual([
      'regen',
      'gewitter',
      'gewitter',
    ])
  })
})
