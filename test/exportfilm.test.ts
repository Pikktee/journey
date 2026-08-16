import { describe, expect, it } from 'vitest'
import {
  brichAttribution,
  dateiname,
  eigeneTourId,
  filmSBeiFrame,
  frameAnzahl,
  istEigeneBereiteTour,
  istExportAnfrage,
  attributionSicht,
  kartenSicht,
  klemmeExportSkala,
  EXPORT_ATTRIBUTION_S,
  EXPORT_DAUER_S,
  EXPORT_FPS,
  EXPORT_REITER_PX,
  EXPORT_SKALA_MIN,
  spurSegmente,
} from '../src/exportfilm'

describe('istExportAnfrage', () => {
  it('erkennt die Query und die Body-Klasse', () => {
    expect(istExportAnfrage('?export=1', false)).toBe(true)
    expect(istExportAnfrage('app=1&export=1', false)).toBe(true)
    expect(istExportAnfrage('', true)).toBe(true)
    expect(istExportAnfrage('?app=1', false)).toBe(false)
    expect(istExportAnfrage('?export=0', false)).toBe(false)
  })
})

describe('eigene Tour', () => {
  it('nimmt nur Server-Kennungen mit t_', () => {
    expect(eigeneTourId('t_abc123')).toBe('t_abc123')
    expect(eigeneTourId('srv:t_abc123')).toBe('t_abc123')
    expect(eigeneTourId('kohphangan')).toBeNull()
    expect(eigeneTourId('srv:kohphangan')).toBeNull()
  })

  it('lässt nur fertige eigene Touren durch', () => {
    const liste = [{ id: 't_mine' }, { id: 't_andere' }]
    expect(istEigeneBereiteTour('srv:t_mine', liste)).toBe(true)
    expect(istEigeneBereiteTour('t_fremd', liste)).toBe(false)
    expect(istEigeneBereiteTour('kohphangan', liste)).toBe(false)
  })
})

describe('Dateiname', () => {
  it('baut den v1-Slug quer-720', () => {
    expect(dateiname('Koh Pha-ngan')).toBe('maptale-koh-pha-ngan-quer-720.mp4')
    expect(dateiname('Straße am See')).toBe('maptale-strasse-am-see-quer-720.mp4')
    expect(dateiname('   ')).toBe('maptale-tour-quer-720.mp4')
  })
})

describe('Frames', () => {
  it('zählt 10 s bei 30 fps als 300 Frames', () => {
    expect(frameAnzahl(EXPORT_DAUER_S, EXPORT_FPS)).toBe(300)
    expect(frameAnzahl(4, EXPORT_FPS)).toBe(120)
  })

  it('setzt die Filmsekunde auf i / fps, geklemmt auf die Dauer', () => {
    expect(filmSBeiFrame(0, 30, 200)).toBe(0)
    expect(filmSBeiFrame(30, 30, 200)).toBe(1)
    expect(filmSBeiFrame(299, 30, 200)).toBeCloseTo(299 / 30)
    expect(filmSBeiFrame(400, 30, 5)).toBe(5)
  })
})

describe('kartenSicht', () => {
  it('blendet auf und am Ende wieder aus', () => {
    expect(kartenSicht(0, 5, 0.8)).toBe(0)
    expect(kartenSicht(0.25, 5, 0.8)).toBeCloseTo(0.5)
    expect(kartenSicht(2, 3, 0.8)).toBe(1)
    expect(kartenSicht(6, -0.4, 0.8)).toBeCloseTo(0.5)
    expect(kartenSicht(7, -0.8, 0.8)).toBe(0)
  })
})

describe('Export-Kamera und Einbrand', () => {
  it('hebt Walk auf mindestens Rad-Distanz', () => {
    expect(klemmeExportSkala({ behind: 0.5, hover: 0.68 })).toEqual({
      behind: EXPORT_SKALA_MIN,
      hover: EXPORT_SKALA_MIN,
    })
    expect(klemmeExportSkala({ behind: 1.25, hover: 1.25 }).behind).toBe(1.25)
  })

  it('hält den Marker in der Nähe des Player-Pucks', () => {
    expect(EXPORT_REITER_PX).toBeGreaterThanOrEqual(36)
    expect(EXPORT_REITER_PX).toBeLessThanOrEqual(48)
  })

  it('bricht die Rechtezeile an den Quellen, nicht mitten im Namen', () => {
    const mass = (s: string) => s.length * 10
    const zeilen = brichAttribution(
      '© Esri, Maxar · Mapzen / AWS Open Data · OpenStreetMap · Open-Meteo',
      280,
      mass,
    )
    expect(zeilen.length).toBeGreaterThan(1)
    expect(zeilen.some((z) => z.includes('Esri'))).toBe(true)
    expect(zeilen.join(' · ')).not.toMatch(/Esri,$/)
  })

  it('zeigt die Quellen nur in den letzten Sekunden', () => {
    expect(EXPORT_ATTRIBUTION_S).toBe(2)
    expect(attributionSicht(0, 10)).toBe(0)
    expect(attributionSicht(7.9, 10)).toBe(0)
    expect(attributionSicht(8, 10)).toBe(0)
    expect(attributionSicht(8.2, 10)).toBeCloseTo(0.5)
    expect(attributionSicht(9, 10)).toBe(1)
    expect(attributionSicht(10, 10)).toBe(1)
  })

  it('bricht projizierte Spur-Punkte hinter der Kamera ab', () => {
    const ketten = spurSegmente(
      [
        { x: 10, y: 10 },
        { x: 20, y: 20 },
        { x: 1e6, y: 10 },
        { x: 30, y: 30 },
        { x: 40, y: 40 },
      ],
      500,
    )
    expect(ketten).toHaveLength(2)
    expect(ketten[0]).toEqual([
      { x: 10, y: 10 },
      { x: 20, y: 20 },
    ])
    expect(ketten[1]).toHaveLength(2)
  })
})
