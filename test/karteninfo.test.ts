import { describe, it, expect } from 'vitest'
import { sammleQuellen, htmlAlsText, quellenAlsText, quellenAlsEinbrand } from '../src/karteninfo'

describe('sammleQuellen', () => {
  it('nennt jede Quelle mit Attribution — auch eine unbekannte', () => {
    const quellen = sammleQuellen({
      satellite: { attribution: '© Esri' },
      dem: { attribution: 'AWS Open Data' },
      neueQuelle: { attribution: '© Irgendwer' },
    })
    expect(quellen.map((q) => q.rolle)).toEqual([
      'Satellitenbild',
      'Gelände & Höhen',
      'Kartendaten',
    ])
    expect(quellen[2]?.html).toBe('© Irgendwer')
  })

  it('überspringt Quellen ohne Attribution (Route, Fahrer, GeoJSON)', () => {
    const quellen = sammleQuellen({
      satellite: { attribution: '© Esri' },
      route: {},
      spots: { attribution: '   ' },
    })
    expect(quellen).toHaveLength(1)
  })

  it('führt dieselbe Rechtezeile nur einmal auf', () => {
    const quellen = sammleQuellen(
      { dem: { attribution: '© OpenStreetMap' }, poi: { attribution: '© OpenStreetMap' } },
      [{ rolle: 'Wetter', html: '© OpenStreetMap' }],
    )
    expect(quellen).toEqual([{ rolle: 'Gelände & Höhen', html: '© OpenStreetMap' }])
  })

  it('hängt Quellen ohne Kacheln (Wetter) hinten an', () => {
    const quellen = sammleQuellen({ satellite: { attribution: '© Esri' } }, [
      { rolle: 'Wetter', html: 'Open-Meteo' },
    ])
    expect(quellen.at(-1)).toEqual({ rolle: 'Wetter', html: 'Open-Meteo' })
  })
})

describe('htmlAlsText / quellenAlsText', () => {
  it('nimmt Tags und Entities aus der Rechtezeile', () => {
    expect(htmlAlsText('© <a href="https://www.esri.com/">Esri</a>, Maxar')).toBe('© Esri, Maxar')
    expect(htmlAlsText('A &amp; B&nbsp;&lt;C&gt; &copy;')).toBe('A & B <C> ©')
  })

  it('setzt Rolle und Rechte in eine Einbrand-Zeile', () => {
    expect(
      quellenAlsText([
        { rolle: 'Satellitenbild', html: '© <a href="#">Esri</a>' },
        { rolle: 'Routen', html: 'OpenStreetMap' },
      ]),
    ).toBe('Satellitenbild: © Esri · Routen: OpenStreetMap')
  })

  it('lässt die Rollen im Clip-Einbrand weg', () => {
    expect(
      quellenAlsEinbrand([
        { rolle: 'Satellitenbild', html: '© <a href="#">Esri</a>' },
        { rolle: 'Routen', html: 'OpenStreetMap' },
      ]),
    ).toBe('© Esri · OpenStreetMap')
  })
})
