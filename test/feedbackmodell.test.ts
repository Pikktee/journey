// Was eine Rückmeldung an technischen Angaben mitnimmt — und was nicht.
import { describe, expect, it } from 'vitest'
import { kontextZeilen, sammleKontext, sauberePfadangabe, textTaugt } from '../src/feedbackmodell'

const CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'

describe('Feedback-Kontext', () => {
  it('nimmt vom Pfad nur den Pfad', () => {
    // Query und Fragment tragen in Maptale Einlöse-Token (#email=, #reset=) —
    // eine freiwillige Angabe darf die nicht heimlich mitnehmen.
    expect(sauberePfadangabe('https://maptale.io/konto#email=geheim')).toBe('/konto')
    expect(sauberePfadangabe('https://maptale.io/tour/t_abc?debug=1')).toBe('/tour/t_abc')
    expect(sauberePfadangabe('/app')).toBe('/app')
  })

  it('sammelt genau die Felder, die der Server annimmt', () => {
    const kontext = sammleKontext({
      href: 'https://maptale.io/galerie?x=1',
      version: '0.60.5',
      userAgent: CHROME_MAC,
      breite: 1440,
      hoehe: 900,
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
    const kontext = sammleKontext({
      href: '/app',
      version: '0.60.5',
      userAgent: 'etwas völlig Fremdes',
      breite: 0,
      hoehe: 0,
    })
    expect(kontext).toEqual({ page: '/app', version: '0.60.5' })
    expect('browser' in kontext).toBe(false)
  })

  it('zeigt im Aufklapper genau das, was gesendet wird', () => {
    // Die Liste wird aus DEMSELBEN Objekt gebaut, das im Body landet. Ein
    // Häkchen ohne Einblick verlangt Vertrauen für etwas, das man zeigen kann.
    const kontext = sammleKontext({
      href: '/app',
      version: '0.60.5',
      userAgent: CHROME_MAC,
      breite: 800,
      hoehe: 600,
    })
    const zeilen = kontextZeilen(kontext)
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
    expect(textTaugt('Karte schwarz')).toBe(true)
    expect(textTaugt('   ')).toBe(false)
    expect(textTaugt('ok')).toBe(false)
  })
})
