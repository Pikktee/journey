import { describe, it, expect } from 'vitest'
import { sammleQuellen } from '../src/karteninfo'

describe('sammleQuellen', () => {
  it('nennt jede Quelle mit Attribution — auch eine unbekannte', () => {
    const quellen = sammleQuellen({
      satellite: { attribution: '© Esri' },
      dem: { attribution: 'AWS Open Data' },
      neueQuelle: { attribution: '© Irgendwer' },
    })
    expect(quellen.map((q) => q.rolle)).toEqual(['Satellitenbild', 'Gelände & Höhen', 'Kartendaten'])
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
      { buildings: { attribution: '© OpenStreetMap' }, poi: { attribution: '© OpenStreetMap' } },
      [{ rolle: 'Wetter', html: '© OpenStreetMap' }],
    )
    expect(quellen).toEqual([{ rolle: 'Gebäude & Wege', html: '© OpenStreetMap' }])
  })

  it('hängt Quellen ohne Kacheln (Wetter) hinten an', () => {
    const quellen = sammleQuellen({ satellite: { attribution: '© Esri' } }, [
      { rolle: 'Wetter', html: 'Open-Meteo' },
    ])
    expect(quellen.at(-1)).toEqual({ rolle: 'Wetter', html: 'Open-Meteo' })
  })
})
