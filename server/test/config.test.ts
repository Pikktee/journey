// Konfiguration aus der Umgebung — v. a. die Robustheit gegen LEERE Werte, die
// docker-compose (${VAR:-}) für nicht gesetzte Variablen durchreicht: ohne die
// Helfer würde Number('')===0 die Quota auf null setzen und alle Uploads sperren.

import { describe, expect, it } from 'vitest'
import { configFromEnv } from '../src/config.js'

describe('konfigAusEnv', () => {
  it('nutzt Defaults, wenn Variablen fehlen', () => {
    const k = configFromEnv({})
    expect(k.port).toBe(8787)
    expect(k.maxSpeicherProBenutzer).toBe(2 * 1024 * 1024 * 1024)
    expect(k.basisUrl).toBe('http://localhost:5173')
    expect(k.registrierungOffen).toBe(true)
    // M5: ohne Key ist die Bildanalyse aus; das Modell hat einen Default.
    expect(k.openRouterKey).toBeNull()
    expect(k.visionModell).toBe('google/gemini-2.5-flash-lite')
  })

  it('behandelt LEERE Strings (docker-compose ${VAR:-}) wie „nicht gesetzt"', () => {
    const k = configFromEnv({
      PORT: '',
      MAPTALE_MAX_STORAGE_PER_USER: '',
      MAPTALE_BASE_URL: '',
      MAPTALE_MAIL_FROM: '   ',
      MAPTALE_DATA_DIR: '',
      OPEN_ROUTER_KEY: '   ',
    })
    expect(k.port).toBe(8787)
    expect(k.maxSpeicherProBenutzer).toBe(2 * 1024 * 1024 * 1024) // NICHT 0!
    expect(k.basisUrl).toBe('http://localhost:5173')
    expect(k.mailAbsender).toContain('Maptale')
    expect(k.datenDir).toBe('./daten')
    expect(k.openRouterKey).toBeNull() // leerer/whitespace Key = Feature aus
  })

  it('übernimmt gesetzte Werte', () => {
    const k = configFromEnv({
      MAPTALE_BASE_URL: 'https://maptale.henrikheil.net',
      MAPTALE_MAX_STORAGE_PER_USER: '1048576',
      MAPTALE_REGISTRATION_OPEN: '0',
      RESEND_API_KEY: 're_test',
      OPEN_ROUTER_KEY: 'sk-or-test',
      MAPTALE_VISION_MODEL: 'openai/gpt-4o-mini',
    })
    expect(k.basisUrl).toBe('https://maptale.henrikheil.net')
    expect(k.maxSpeicherProBenutzer).toBe(1048576)
    expect(k.registrierungOffen).toBe(false)
    expect(k.openRouterKey).toBe('sk-or-test')
    expect(k.visionModell).toBe('openai/gpt-4o-mini')
  })
})
