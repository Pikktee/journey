// Wetter-Verfeinerung per Bildanalyse (M5): Befund→Wetter-Mapping, die
// Konflikt-Merge-Regel (reine Funktionen, kein Netz) und die OpenRouter-Anbindung
// mit injiziertem fetch (ebenfalls netzlos).

import { describe, expect, it, vi } from 'vitest'
import {
  OpenRouterKlassifikator,
  FesterKlassifikator,
  bildBefundZuWetter,
  verfeinereWetterMitFotos,
  type BildBefund,
} from '../src/pipeline/vision.js'
import type { WetterKeyframe } from '../src/pipeline/weather.js'

const befund = (patch: Partial<BildBefund> = {}): BildBefund => ({
  himmel: 'wolkig',
  niederschlag: 'kein',
  himmelSichtbar: true,
  konfidenz: 0.9,
  ...patch,
})

describe('bildBefundZuWetter', () => {
  it('bildet Niederschlag/Nebel auf ihren Modus ab (schlägt den Himmel)', () => {
    expect(bildBefundZuWetter(befund({ niederschlag: 'gewitter' }))).toEqual({ mode: 'storm', k: 0.8 })
    expect(bildBefundZuWetter(befund({ niederschlag: 'schnee' }))).toEqual({ mode: 'snow', k: 0.7 })
    expect(bildBefundZuWetter(befund({ niederschlag: 'regen' }))).toEqual({ mode: 'rain', k: 0.6 })
    expect(bildBefundZuWetter(befund({ niederschlag: 'nebel' }))).toEqual({ mode: 'fog', k: 0.7 })
    // Niederschlag gewinnt auch gegen einen „klar"-Himmel
    expect(bildBefundZuWetter(befund({ himmel: 'klar', niederschlag: 'regen' })).mode).toBe('rain')
  })

  it('bildet ohne Niederschlag den Himmel ab (bedeckt kräftiger als wolkig, klar = off)', () => {
    expect(bildBefundZuWetter(befund({ himmel: 'bedeckt' }))).toEqual({ mode: 'clouds', k: 0.9 })
    expect(bildBefundZuWetter(befund({ himmel: 'wolkig' }))).toEqual({ mode: 'clouds', k: 0.5 })
    expect(bildBefundZuWetter(befund({ himmel: 'klar' }))).toEqual({ mode: 'off', k: 0.7 })
  })
})

const kf = (f: number, mode: WetterKeyframe['mode'], k = 0.7): WetterKeyframe => ({ f, mode, k, source: 'openmeteo' })

describe('verfeinereWetterMitFotos', () => {
  it('übersteuert, wenn ein sicheres Foto MEHR Wetter zeigt (Fenster ±0.03, source photo)', () => {
    const out = verfeinereWetterMitFotos([kf(0, 'off')], [{ f: 0.5, befund: befund({ niederschlag: 'gewitter' }) }])
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
    expect(verfeinereWetterMitFotos(basis, [{ f: 0.5, befund: befund({ himmel: 'bedeckt' }) }])).toEqual(basis)
  })

  it('lässt API-Niederschlag IMMER gegen ein klar-Foto gewinnen', () => {
    const basis = [kf(0, 'rain', 0.6)]
    const out = verfeinereWetterMitFotos(basis, [
      { f: 0.5, befund: befund({ himmel: 'klar', niederschlag: 'kein', konfidenz: 0.99 }) },
    ])
    expect(out).toEqual(basis) // Wolkenloch-Foto (off) wischt den Regen nicht weg
  })

  it('übersteuert nur bei hoher Konfidenz UND sichtbarem Himmel', () => {
    const basis = [kf(0, 'off')]
    const stark = befund({ niederschlag: 'gewitter' })
    expect(verfeinereWetterMitFotos(basis, [{ f: 0.5, befund: { ...stark, konfidenz: 0.6 } }])).toEqual(basis)
    expect(verfeinereWetterMitFotos(basis, [{ f: 0.5, befund: { ...stark, himmelSichtbar: false } }])).toEqual(basis)
  })

  it('klemmt das Fenster an den Streckenrändern f∈[0,1]', () => {
    const anfang = verfeinereWetterMitFotos([kf(0, 'off')], [{ f: 0, befund: befund({ niederschlag: 'regen' }) }])
    expect(anfang.every((k) => k.f >= 0)).toBe(true)
    expect(anfang.find((k) => k.f === 0)?.source).toBe('photo') // Foto beginnt am Start
    const ende = verfeinereWetterMitFotos([kf(0, 'off')], [{ f: 1, befund: befund({ niederschlag: 'regen' }) }])
    expect(ende.every((k) => k.f <= 1)).toBe(true)
    expect(ende.at(-1)).toMatchObject({ f: 1, mode: 'rain', source: 'photo' })
  })

  it('verschmilzt überlappende Foto-Fenster (schwereres Wetter gewinnt)', () => {
    const out = verfeinereWetterMitFotos(
      [kf(0, 'off')],
      [
        { f: 0.5, befund: befund({ niederschlag: 'regen' }) }, // Fenster [0.47, 0.53]
        { f: 0.54, befund: befund({ niederschlag: 'gewitter' }) }, // Fenster [0.51, 0.57] — überlappt
      ],
    )
    const photo = out.filter((k) => k.source === 'photo')
    expect(photo.map((k) => k.f)).toEqual([0.47, 0.57]) // EIN verschmolzenes Fenster
    expect(photo.every((k) => k.mode === 'storm')).toBe(true) // das schwerere Wetter
  })

  it('setzt getrennte Fenster für weit auseinanderliegende Fotos', () => {
    const out = verfeinereWetterMitFotos(
      [kf(0, 'off')],
      [
        { f: 0.2, befund: befund({ niederschlag: 'regen' }) },
        { f: 0.8, befund: befund({ niederschlag: 'schnee' }) },
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
    expect(verfeinereWetterMitFotos(basis, [])).toEqual(basis)
  })
})

describe('OpenRouterKlassifikator', () => {
  const bild = { daten: new Uint8Array([1, 2, 3]), medientyp: 'image/jpeg' }

  it('ruft die OpenRouter-Chat-API mit dem Vision-Modell + base64-Bild und parst strenges JSON', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Ergebnis: {"himmel":"bedeckt","niederschlag":"regen","himmelSichtbar":true,"konfidenz":0.82}' } }],
      }),
    }))
    const k = new OpenRouterKlassifikator('sk-test', fetchMock as unknown as typeof fetch)
    const b = await k.klassifiziere(bild)
    expect(b).toEqual({ himmel: 'bedeckt', niederschlag: 'regen', himmelSichtbar: true, konfidenz: 0.82 })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer sk-test')
    const body = JSON.parse(init.body as string) as {
      model: string
      messages: Array<{ content: Array<{ type: string; image_url?: { url: string } }> }>
    }
    expect(body.model).toBe('google/gemini-2.5-flash-lite')
    const bildBlock = body.messages[0]?.content.find((c) => c.type === 'image_url')
    expect(bildBlock?.image_url?.url).toBe(`data:image/jpeg;base64,${Buffer.from([1, 2, 3]).toString('base64')}`)
  })

  it('nutzt das übergebene Modell-Override', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{}' } }] }) }))
    const k = new OpenRouterKlassifikator('sk', fetchMock as unknown as typeof fetch, 'openai/gpt-4o-mini')
    await k.klassifiziere(bild)
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect((JSON.parse(init.body as string) as { model: string }).model).toBe('openai/gpt-4o-mini')
  })

  it('liefert einen neutralen Befund (konfidenz 0) bei HTTP-Fehler', async () => {
    const k = new OpenRouterKlassifikator('sk', (async () => ({ ok: false, status: 500 })) as unknown as typeof fetch)
    expect((await k.klassifiziere(bild)).konfidenz).toBe(0)
  })

  it('liefert einen neutralen Befund, wenn die Antwort kein verwertbares JSON enthält', async () => {
    const k = new OpenRouterKlassifikator('sk', (async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'keine Ahnung, tut mir leid' } }] }),
    })) as unknown as typeof fetch)
    expect((await k.klassifiziere(bild)).konfidenz).toBe(0)
  })

  it('fängt Netz-Ausnahmen ab (neutraler Befund statt Absturz)', async () => {
    const k = new OpenRouterKlassifikator('sk', (async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch)
    expect((await k.klassifiziere(bild)).himmelSichtbar).toBe(false)
  })

  it('weist unbekannte Enum-Werte als neutral zurück', async () => {
    const k = new OpenRouterKlassifikator('sk', (async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"himmel":"sonnig","niederschlag":"kein","himmelSichtbar":true,"konfidenz":0.9}' } }] }),
    })) as unknown as typeof fetch)
    expect((await k.klassifiziere(bild)).konfidenz).toBe(0)
  })
})

describe('FesterKlassifikator', () => {
  it('liefert einen festen Befund und zeichnet die Aufrufe auf', async () => {
    const k = new FesterKlassifikator(befund({ niederschlag: 'schnee' }))
    const b = await k.klassifiziere({ daten: new Uint8Array([9, 9]), medientyp: 'image/png' })
    expect(b.niederschlag).toBe('schnee')
    expect(k.aufrufe).toEqual([{ medientyp: 'image/png', bytes: 2 }])
  })

  it('gibt Befunde einer Liste der Reihe nach zurück (letzter wiederholt)', async () => {
    const k = new FesterKlassifikator([befund({ niederschlag: 'regen' }), befund({ niederschlag: 'gewitter' })])
    const eins = await k.klassifiziere({ daten: new Uint8Array(), medientyp: 'image/jpeg' })
    const zwei = await k.klassifiziere({ daten: new Uint8Array(), medientyp: 'image/jpeg' })
    const drei = await k.klassifiziere({ daten: new Uint8Array(), medientyp: 'image/jpeg' })
    expect([eins.niederschlag, zwei.niederschlag, drei.niederschlag]).toEqual(['regen', 'gewitter', 'gewitter'])
  })
})
