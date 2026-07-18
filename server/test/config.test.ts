// Konfiguration aus der Umgebung — v. a. die Robustheit gegen LEERE Werte, die
// docker-compose (${VAR:-}) für nicht gesetzte Variablen durchreicht: ohne die
// Helfer würde Number('')===0 die Quota auf null setzen und alle Uploads sperren.

import { describe, expect, it } from 'vitest'
import { konfigAusEnv } from '../src/config.js'

describe('konfigAusEnv', () => {
  it('nutzt Defaults, wenn Variablen fehlen', () => {
    const k = konfigAusEnv({})
    expect(k.port).toBe(8787)
    expect(k.maxSpeicherProBenutzer).toBe(2 * 1024 * 1024 * 1024)
    expect(k.basisUrl).toBe('http://localhost:5173')
    expect(k.registrierungOffen).toBe(true)
  })

  it('behandelt LEERE Strings (docker-compose ${VAR:-}) wie „nicht gesetzt"', () => {
    const k = konfigAusEnv({
      PORT: '',
      LUHAMBO_MAX_SPEICHER_PRO_BENUTZER: '',
      LUHAMBO_BASIS_URL: '',
      LUHAMBO_MAIL_ABSENDER: '   ',
      LUHAMBO_DATEN_DIR: '',
    })
    expect(k.port).toBe(8787)
    expect(k.maxSpeicherProBenutzer).toBe(2 * 1024 * 1024 * 1024) // NICHT 0!
    expect(k.basisUrl).toBe('http://localhost:5173')
    expect(k.mailAbsender).toContain('Luhambo')
    expect(k.datenDir).toBe('./daten')
  })

  it('übernimmt gesetzte Werte', () => {
    const k = konfigAusEnv({
      LUHAMBO_BASIS_URL: 'https://luhambo.app',
      LUHAMBO_MAX_SPEICHER_PRO_BENUTZER: '1048576',
      LUHAMBO_REGISTRIERUNG_OFFEN: '0',
      RESEND_API_KEY: 're_test',
    })
    expect(k.basisUrl).toBe('https://luhambo.app')
    expect(k.maxSpeicherProBenutzer).toBe(1048576)
    expect(k.registrierungOffen).toBe(false)
  })
})
