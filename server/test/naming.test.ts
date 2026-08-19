import { describe, expect, it } from 'vitest'
import {
  baueBenennung,
  benenneTour,
  ebenenAusAdresse,
  FesterGeocoder,
  titleZuHtml,
} from '../src/pipeline/naming.js'

const basis = {
  startPunkt: [7.9086, 46.5934] as [number, number],
  zielPunkt: [8.0341, 46.6244] as [number, number],
  zeitStart: '2026-07-04T08:12:31+02:00',
  zone: 'Europe/Zurich',
}

describe('benenneTour', () => {
  it('baut „Start → Ziel" aus den Geocoder-Orten', async () => {
    const b = await benenneTour({
      ...basis,
      nutzerTitel: null,
      geocoder: new FesterGeocoder(['Lauterbrunnen', 'Grindelwald']),
    })
    expect(b.title).toBe('Lauterbrunnen → Grindelwald')
    expect(b.stops).toEqual(['Lauterbrunnen', 'Grindelwald'])
    expect(b.finaleTitle).toBe('Grindelwald')
    // Von A nach B stehen beide Orte schon im Titel und in den Stationen — eine
    // Dachzeile mit dem Startort wäre die dritte Nennung derselben Gegend.
    expect(b.kicker).toBe('')
    expect(b.titleHtml).toBe('Lauterbrunnen<br />→ Grindelwald')
  })

  it('erkennt Rundtouren (Start = Ziel)', async () => {
    const b = await benenneTour({
      ...basis,
      nutzerTitel: null,
      geocoder: new FesterGeocoder(['Wengen', 'Wengen']),
    })
    expect(b.title).toBe('Runde bei Wengen')
    expect(b.stops).toEqual(['Wengen'])
    // Nur hier gibt es eine Vorbelegung für die Dachzeile: Der Titel nennt den
    // Ort, die Zeile darüber ordnet ihn ein.
    expect(b.kicker).toBe('Wengen')
  })

  describe('Die Dachzeile', () => {
    // Sie war bis dahin ein erzeugter Satz („Aufgezeichnet am …") in der
    // kräftigsten Farbe der Seite. Jetzt gehört sie dem Autor — und die drei
    // Zustände müssen unterscheidbar bleiben, sonst kann man eine einmal
    // gesetzte Zeile nie wieder loswerden.
    const orte = { startOrt: 'Wengen', zielOrt: 'Wengen' }
    const zeit = { zeitStart: basis.zeitStart, zone: basis.zone }

    it('nimmt die Vorbelegung, solange nie etwas gesetzt wurde', () => {
      expect(baueBenennung({ ...orte, ...zeit, nutzerTitel: null, dachzeile: null }).kicker).toBe(
        'Wengen',
      )
      expect(baueBenennung({ ...orte, ...zeit, nutzerTitel: null }).kicker).toBe('Wengen')
    })

    it('lässt die Zeile beim leeren String ausdrücklich weg', () => {
      expect(baueBenennung({ ...orte, ...zeit, nutzerTitel: null, dachzeile: '' }).kicker).toBe('')
      expect(baueBenennung({ ...orte, ...zeit, nutzerTitel: null, dachzeile: '   ' }).kicker).toBe(
        '',
      )
    })

    it('nimmt jeden anderen Text, wie er ist', () => {
      expect(
        baueBenennung({ ...orte, ...zeit, nutzerTitel: null, dachzeile: ' Völklinger Hütte ' })
          .kicker,
      ).toBe('Völklinger Hütte')
    })
  })

  it('nutzt den Nutzer-Titel unverändert, geocodiert aber die Stops', async () => {
    const b = await benenneTour({
      ...basis,
      nutzerTitel: '  Alpenglühen  ',
      geocoder: new FesterGeocoder(['Lauterbrunnen', 'Grindelwald']),
    })
    expect(b.title).toBe('Alpenglühen')
    expect(b.stops).toEqual(['Lauterbrunnen', 'Grindelwald'])
  })

  it('fällt ohne Geocoder-Treffer aufs Datum zurück', async () => {
    const b = await benenneTour({
      ...basis,
      nutzerTitel: null,
      geocoder: new FesterGeocoder([null, null]),
    })
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

describe('ebenenAusAdresse', () => {
  // Die Vorschläge für die Dachzeile. Vorher behielt die Benennung genau einen
  // Treffer einer festen Kette und warf den Rest weg — welche Ebene richtig
  // ist, hängt aber daran, wie eine Gegend in OSM erfasst ist.
  it('ordnet von fein nach grob', () => {
    expect(
      ebenenAusAdresse({
        city: 'Völklingen',
        county: 'Regionalverband Saarbrücken',
        state: 'Saarland',
        country: 'Deutschland',
      }),
    ).toEqual(['Völklingen', 'Regionalverband Saarbrücken', 'Saarland', 'Deutschland'])
  })

  it('lässt Dubletten weg — Stadtstaaten nennen sich zweimal', () => {
    expect(ebenenAusAdresse({ city: 'Hamburg', state: 'Hamburg', country: 'Deutschland' })).toEqual(
      ['Hamburg', 'Deutschland'],
    )
  })

  it('nimmt keine Anschrift auf', () => {
    expect(
      ebenenAusAdresse({ road: 'Rathausstraße', house_number: '2', city: 'Völklingen' }),
    ).toEqual(['Völklingen'])
  })

  it('bleibt leer, wenn die Antwort nichts Brauchbares trägt', () => {
    expect(ebenenAusAdresse({})).toEqual([])
    expect(ebenenAusAdresse({ city: '  ' })).toEqual([])
  })
})
