// Datenmodell der Galerie (DOM-frei, wie die Studio-Module).
//
// Der Profilkopf ist mit Etappe 2 nach test/profile-model.test.ts umgezogen —
// die Profilseite hat seither ihr eigenes Modell.
import { describe, expect, it } from 'vitest'
import {
  toTourCard,
  toTourCards,
  formatDistanceKm,
  idFromUrl,
  formatMonth,
  handleOrIdFromUrl,
  type GalleryTour,
} from '../src/gallery/gallery-model'

const tour = (patch: Partial<GalleryTour> = {}): GalleryTour => ({
  id: 't_abc',
  title: 'Lauterbrunnen → Grindelwald',
  cover: '/api/media/t_abc/m1.jpg',
  km: 12.42,
  createdAt: '2026-07-04T08:00:00.000Z',
  author: null,
  ...patch,
})

describe('alsKarte', () => {
  it('baut Titel, Unterzeile und den Link in den Player', () => {
    const karte = toTourCard(tour())
    expect(karte.title).toBe('Lauterbrunnen → Grindelwald')
    expect(karte.subline).toBe('12,4 km · Juli 2026')
    expect(karte.playLink).toBe('/tour/t_abc')
  })

  it('bleibt ohne Titel nicht namenlos', () => {
    expect(toTourCard(tour({ title: null })).title).toBe('Namenlose Reise')
    expect(toTourCard(tour({ title: '   ' })).title).toBe('Namenlose Reise')
  })

  it('ohne Urheber bleibt die Karte anonym', () => {
    const karte = toTourCard(tour())
    expect(karte.authorName).toBeNull()
    expect(karte.authorLink).toBeNull()
  })

  it('nennt den Urheber, verlinkt ihn aber nur mit öffentlicher Profilseite', () => {
    const ohneSeite = toTourCard(tour({ author: { displayName: 'Reisende', avatarUrl: null } }))
    expect(ohneSeite.authorName).toBe('Reisende')
    expect(ohneSeite.authorLink).toBeNull()

    const mitSeite = toTourCard(
      tour({ author: { displayName: 'Reisende', avatarUrl: null, id: 'u_1' } }),
    )
    expect(mitSeite.authorLink).toBe('/profil?id=u_1')
  })

  it('verlinkt über den Handle, sobald es einen gibt', () => {
    const karte = toTourCard(
      tour({ author: { displayName: 'Reisende', avatarUrl: null, id: 'u_1', handle: 'henrik' } }),
    )
    expect(karte.authorLink).toBe('/@henrik')
  })

  it('kodiert Kennungen für die Adresse', () => {
    const karte = toTourCard(
      tour({ id: 't a/b', author: { displayName: 'X', avatarUrl: null, id: 'u/1' } }),
    )
    expect(karte.playLink).toBe('/tour/t%20a%2Fb')
    expect(karte.authorLink).toBe('/profil?id=u%2F1')
  })

  it('kommt ohne Bild und ohne Zahlen aus', () => {
    const karte = toTourCard(tour({ cover: null, km: null, createdAt: '' }))
    expect(karte.cover).toBeNull()
    expect(karte.subline).toBe('')
  })

  it('wandelt eine ganze Antwort um', () => {
    expect(toTourCards({ tours: [tour(), tour({ id: 't_2' })], hasMore: false })).toHaveLength(2)
  })
})

describe('entfernung', () => {
  it('rundet auf eine Stelle mit deutschem Komma', () => {
    expect(formatDistanceKm(12.42)).toBe('12,4 km')
    expect(formatDistanceKm(0.5)).toBe('0,5 km')
  })

  it('lässt Unbrauchbares weg', () => {
    // Unter 100 m ist die Angabe keine Information
    expect(formatDistanceKm(0.04)).toBe('')
    expect(formatDistanceKm(null)).toBe('')
    expect(formatDistanceKm(Number.NaN)).toBe('')
  })
})

describe('monat', () => {
  it('nennt Monat und Jahr', () => {
    expect(formatMonth('2026-07-04T08:00:00.000Z')).toBe('Juli 2026')
  })

  it('verkraftet Unsinn', () => {
    expect(formatMonth('kaputt')).toBe('')
    expect(formatMonth(null)).toBe('')
  })
})

describe('idAusAdresse', () => {
  it('liest die Kennung aus dem Suchteil', () => {
    expect(idFromUrl('?id=u_123')).toBe('u_123')
    expect(idFromUrl('?a=1&id=u_9')).toBe('u_9')
  })

  it('ohne Angabe null', () => {
    expect(idFromUrl('')).toBeNull()
    expect(idFromUrl('?andere=1')).toBeNull()
  })
})

describe('wenAusAdresse', () => {
  it('nimmt den Handle aus dem Pfad', () => {
    expect(handleOrIdFromUrl('/@henrik', '')).toBe('henrik')
  })

  it('fällt auf die alte ?id=-Form zurück — die Links sind in der Welt', () => {
    expect(handleOrIdFromUrl('/profil', '?id=u_123')).toBe('u_123')
  })

  it('gibt dem Pfad den Vorrang', () => {
    // Ein `?id=` neben einem Handle ist bestenfalls Altlast eines kopierten Links
    expect(handleOrIdFromUrl('/@henrik', '?id=u_999')).toBe('henrik')
  })

  it('ohne beides null', () => {
    expect(handleOrIdFromUrl('/profil', '')).toBeNull()
  })
})
