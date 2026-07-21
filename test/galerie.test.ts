// Datenmodell der öffentlichen Seiten (DOM-frei, wie die Studio-Module).
import { describe, expect, it } from 'vitest'
import {
  alsKarte,
  alsKarten,
  entfernung,
  idAusAdresse,
  monat,
  profilKopf,
  type GalerieTour,
} from '../src/galerie/galeriemodell'

const tour = (patch: Partial<GalerieTour> = {}): GalerieTour => ({
  id: 't_abc',
  titel: 'Lauterbrunnen → Grindelwald',
  cover: '/api/media/t_abc/m1.jpg',
  km: 12.42,
  erstelltAm: '2026-07-04T08:00:00.000Z',
  autor: null,
  ...patch,
})

describe('alsKarte', () => {
  it('baut Titel, Unterzeile und den Link in den Player', () => {
    const karte = alsKarte(tour())
    expect(karte.titel).toBe('Lauterbrunnen → Grindelwald')
    expect(karte.unterzeile).toBe('12,4 km · Juli 2026')
    expect(karte.spielLink).toBe('/erlebnis.html?tour=srv:t_abc')
  })

  it('bleibt ohne Titel nicht namenlos', () => {
    expect(alsKarte(tour({ titel: null })).titel).toBe('Namenlose Reise')
    expect(alsKarte(tour({ titel: '   ' })).titel).toBe('Namenlose Reise')
  })

  it('ohne Urheber bleibt die Karte anonym', () => {
    const karte = alsKarte(tour())
    expect(karte.autorName).toBeNull()
    expect(karte.autorLink).toBeNull()
  })

  it('nennt den Urheber, verlinkt ihn aber nur mit öffentlicher Profilseite', () => {
    const ohneSeite = alsKarte(tour({ autor: { anzeigename: 'Reisende', avatarUrl: null } }))
    expect(ohneSeite.autorName).toBe('Reisende')
    expect(ohneSeite.autorLink).toBeNull()

    const mitSeite = alsKarte(tour({ autor: { anzeigename: 'Reisende', avatarUrl: null, id: 'u_1' } }))
    expect(mitSeite.autorLink).toBe('/profil.html?id=u_1')
  })

  it('kodiert Kennungen für die Adresse', () => {
    const karte = alsKarte(tour({ id: 't a/b', autor: { anzeigename: 'X', avatarUrl: null, id: 'u/1' } }))
    expect(karte.spielLink).toBe('/erlebnis.html?tour=srv:t%20a%2Fb')
    expect(karte.autorLink).toBe('/profil.html?id=u%2F1')
  })

  it('kommt ohne Bild und ohne Zahlen aus', () => {
    const karte = alsKarte(tour({ cover: null, km: null, erstelltAm: '' }))
    expect(karte.cover).toBeNull()
    expect(karte.unterzeile).toBe('')
  })

  it('wandelt eine ganze Antwort um', () => {
    expect(alsKarten({ touren: [tour(), tour({ id: 't_2' })], mehr: false })).toHaveLength(2)
  })
})

describe('entfernung', () => {
  it('rundet auf eine Stelle mit deutschem Komma', () => {
    expect(entfernung(12.42)).toBe('12,4 km')
    expect(entfernung(0.5)).toBe('0,5 km')
  })

  it('lässt Unbrauchbares weg', () => {
    // Unter 100 m ist die Angabe keine Information
    expect(entfernung(0.04)).toBe('')
    expect(entfernung(null)).toBe('')
    expect(entfernung(Number.NaN)).toBe('')
  })
})

describe('monat', () => {
  it('nennt Monat und Jahr', () => {
    expect(monat('2026-07-04T08:00:00.000Z')).toBe('Juli 2026')
  })

  it('verkraftet Unsinn', () => {
    expect(monat('kaputt')).toBe('')
    expect(monat(null)).toBe('')
  })
})

describe('idAusAdresse', () => {
  it('liest die Kennung aus dem Suchteil', () => {
    expect(idAusAdresse('?id=u_123')).toBe('u_123')
    expect(idAusAdresse('?a=1&id=u_9')).toBe('u_9')
  })

  it('ohne Angabe null', () => {
    expect(idAusAdresse('')).toBeNull()
    expect(idAusAdresse('?andere=1')).toBeNull()
  })
})

describe('profilKopf', () => {
  it('nimmt Anzeigename und Bio', () => {
    expect(profilKopf({ anzeigename: 'Reisende', bio: 'Unterwegs', avatarUrl: '/a.jpg', touren: [] })).toEqual({
      name: 'Reisende',
      bio: 'Unterwegs',
      bild: '/a.jpg',
    })
  })

  it('bleibt ohne Anzeigenamen unpersönlich, statt etwas zu erfinden', () => {
    const kopf = profilKopf({ anzeigename: null, bio: '  ', avatarUrl: null, touren: [] })
    expect(kopf.name).toBe('Ohne Namen')
    expect(kopf.bio).toBeNull()
  })
})
