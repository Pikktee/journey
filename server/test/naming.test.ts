import { describe, expect, it } from 'vitest'
import { benenneTour, FesterGeocoder, titleZuHtml } from '../src/pipeline/naming.js'

const basis = {
  startPunkt: [7.9086, 46.5934] as [number, number],
  zielPunkt: [8.0341, 46.6244] as [number, number],
  zeitStart: '2026-07-04T08:12:31+02:00',
  zone: 'Europe/Zurich',
}

describe('benenneTour', () => {
  it('baut „Start → Ziel" aus den Geocoder-Orten', async () => {
    const b = await benenneTour({ ...basis, nutzerTitel: null, geocoder: new FesterGeocoder(['Lauterbrunnen', 'Grindelwald']) })
    expect(b.title).toBe('Lauterbrunnen → Grindelwald')
    expect(b.stops).toEqual(['Lauterbrunnen', 'Grindelwald'])
    expect(b.finaleTitle).toBe('Grindelwald')
    expect(b.kicker).toBe('Aufgezeichnet am 4. Juli 2026')
    expect(b.titleHtml).toBe('Lauterbrunnen<br />→ Grindelwald')
  })

  it('erkennt Rundtouren (Start = Ziel)', async () => {
    const b = await benenneTour({ ...basis, nutzerTitel: null, geocoder: new FesterGeocoder(['Wengen', 'Wengen']) })
    expect(b.title).toBe('Runde bei Wengen')
    expect(b.stops).toEqual(['Wengen'])
  })

  it('nutzt den Nutzer-Titel unverändert, geocodiert aber die Stops', async () => {
    const b = await benenneTour({ ...basis, nutzerTitel: '  Alpenglühen  ', geocoder: new FesterGeocoder(['Lauterbrunnen', 'Grindelwald']) })
    expect(b.title).toBe('Alpenglühen')
    expect(b.stops).toEqual(['Lauterbrunnen', 'Grindelwald'])
  })

  it('fällt ohne Geocoder-Treffer aufs Datum zurück', async () => {
    const b = await benenneTour({ ...basis, nutzerTitel: null, geocoder: new FesterGeocoder([null, null]) })
    expect(b.title).toBe('Tour vom 4. Juli 2026')
    expect(b.stops).toEqual(['Tour vom 4. Juli 2026'])
    expect(b.finaleTitle).toBe('Tour vom 4. Juli 2026')
  })
})

describe('titleZuHtml', () => {
  it('bricht am Pfeil um', () => {
    expect(titleZuHtml('Lauterbrunnen → Grindelwald')).toBe('Lauterbrunnen<br />→ Grindelwald')
  })

  it('bricht sonst an der ausgewogensten Wortgrenze um', () => {
    expect(titleZuHtml('Runde bei Wengen')).toBe('Runde bei<br />Wengen')
  })

  it('lässt Ein-Wort-Titel unverändert', () => {
    expect(titleZuHtml('Alpenglühen')).toBe('Alpenglühen')
  })

  it('escaped HTML in Ortsnamen', () => {
    expect(titleZuHtml('<b>Böse</b> Tour')).not.toContain('<b>')
    expect(titleZuHtml('<b>Böse</b> Tour')).toContain('&lt;b&gt;')
  })
})
