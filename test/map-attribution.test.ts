import { describe, it, expect } from 'vitest'
import { collectSources, htmlToText, sourcesAsText, sourcesForBurnIn } from '../src/map-attribution'

describe('sammleQuellen', () => {
  it('nennt jede Quelle mit Attribution — auch eine unbekannte', () => {
    const quellen = collectSources({
      satellite: { attribution: '© Esri' },
      dem: { attribution: 'AWS Open Data' },
      neueQuelle: { attribution: '© Irgendwer' },
    })
    expect(quellen.map((q) => q.role)).toEqual(['Satellitenbild', 'Gelände & Höhen', 'Kartendaten'])
    expect(quellen[2]?.html).toBe('© Irgendwer')
  })

  it('überspringt Quellen ohne Attribution (Route, Fahrer, GeoJSON)', () => {
    const quellen = collectSources({
      satellite: { attribution: '© Esri' },
      route: {},
      spots: { attribution: '   ' },
    })
    expect(quellen).toHaveLength(1)
  })

  it('führt dieselbe Rechtezeile nur einmal auf', () => {
    const quellen = collectSources(
      { dem: { attribution: '© OpenStreetMap' }, poi: { attribution: '© OpenStreetMap' } },
      [{ role: 'Wetter', html: '© OpenStreetMap' }],
    )
    expect(quellen).toEqual([{ role: 'Gelände & Höhen', html: '© OpenStreetMap' }])
  })

  it('hängt Quellen ohne Kacheln (Wetter) hinten an', () => {
    const quellen = collectSources({ satellite: { attribution: '© Esri' } }, [
      { role: 'Wetter', html: 'Open-Meteo' },
    ])
    expect(quellen.at(-1)).toEqual({ role: 'Wetter', html: 'Open-Meteo' })
  })
})

describe('htmlAlsText / quellenAlsText', () => {
  it('nimmt Tags und Entities aus der Rechtezeile', () => {
    expect(htmlToText('© <a href="https://www.esri.com/">Esri</a>, Maxar')).toBe('© Esri, Maxar')
    expect(htmlToText('A &amp; B&nbsp;&lt;C&gt; &copy;')).toBe('A & B <C> ©')
  })

  it('setzt Rolle und Rechte in eine Einbrand-Zeile', () => {
    expect(
      sourcesAsText([
        { role: 'Satellitenbild', html: '© <a href="#">Esri</a>' },
        { role: 'Routen', html: 'OpenStreetMap' },
      ]),
    ).toBe('Satellitenbild: © Esri · Routen: OpenStreetMap')
  })

  it('lässt die Rollen im Clip-Einbrand weg', () => {
    expect(
      sourcesForBurnIn([
        { role: 'Satellitenbild', html: '© <a href="#">Esri</a>' },
        { role: 'Routen', html: 'OpenStreetMap' },
      ]),
    ).toBe('© Esri · OpenStreetMap')
  })
})
