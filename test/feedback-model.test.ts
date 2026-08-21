// Was eine Rückmeldung an technischen Angaben mitnimmt — und was nicht.
import { describe, expect, it } from 'vitest'
import { contextLines, collectContext, cleanPath, canSubmitText } from '../src/feedback-model'

const CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'

describe('Feedback-Kontext', () => {
  it('nimmt vom Pfad nur den Pfad', () => {
    // Query und Fragment tragen in Maptale Einlöse-Token (#email=, #reset=) —
    // eine freiwillige Angabe darf die nicht heimlich mitnehmen.
    expect(cleanPath('https://maptale.io/konto#email=geheim')).toBe('/konto')
    expect(cleanPath('https://maptale.io/tour/t_abc?debug=1')).toBe('/tour/t_abc')
    expect(cleanPath('/app')).toBe('/app')
  })

  it('sammelt genau die Felder, die der Server annimmt', () => {
    const kontext = collectContext({
      href: 'https://maptale.io/galerie?x=1',
      version: '0.60.5',
      userAgent: CHROME_MAC,
      width: 1440,
      height: 900,
      language: 'de-DE',
    })
    expect(kontext).toEqual({
      page: '/galerie',
      version: '0.60.5',
      browser: 'Chrome',
      platform: 'macOS',
      screen: '1440×900',
      language: 'de-DE',
    })
  })

  it('lässt Unbekanntes weg, statt „unbekannt" zu behaupten', () => {
    const kontext = collectContext({
      href: '/app',
      version: '0.60.5',
      userAgent: 'etwas völlig Fremdes',
      width: 0,
      height: 0,
    })
    expect(kontext).toEqual({ page: '/app', version: '0.60.5' })
    expect('browser' in kontext).toBe(false)
  })

  it('zeigt im Aufklapper genau das, was gesendet wird', () => {
    // Die Liste wird aus DEMSELBEN Objekt gebaut, das im Body landet. Ein
    // Häkchen ohne Einblick verlangt Vertrauen für etwas, das man zeigen kann.
    const kontext = collectContext({
      href: '/app',
      version: '0.60.5',
      userAgent: CHROME_MAC,
      width: 800,
      height: 600,
    })
    const zeilen = contextLines(kontext)
    expect(zeilen.map(([name]) => name)).toEqual([
      'Seite',
      'Version',
      'Browser',
      'System',
      'Fenster',
    ])
    expect(zeilen).toHaveLength(Object.keys(kontext).length)
  })

  it('lässt jede ernst gemeinte Meldung durch', () => {
    expect(canSubmitText('Karte schwarz')).toBe(true)
    expect(canSubmitText('   ')).toBe(false)
    expect(canSubmitText('ok')).toBe(false)
  })
})
