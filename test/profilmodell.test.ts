// Datenmodell der Profilseite (DOM-frei, wie galeriemodell.ts).
import { describe, expect, it } from 'vitest'
import {
  anfangsbuchstabe,
  dabeiSeit,
  istEigenes,
  kennzahlChips,
  linkChips,
  profilAdresse,
  profilKopf,
  zahl,
  type ProfilAntwort,
} from '../src/profil/profilmodell'

/**
 * U+202F, schmales geschütztes Leerzeichen — als Escape geschrieben, weil es
 * im Quelltext von einem gewöhnlichen Leerzeichen nicht zu unterscheiden ist.
 */
const SCHMAL = '\u202f'

const profil = (patch: Partial<ProfilAntwort> = {}): ProfilAntwort => ({
  handle: 'henrik',
  anzeigename: 'Henrik',
  bio: 'Unterwegs meistens auf zwei Rädern.',
  ort: 'Frankfurt am Main',
  website: null,
  instagram: null,
  avatarUrl: null,
  titelbildUrl: null,
  dabeiSeit: '2026-07-04T08:00:00.000Z',
  kennzahlen: { touren: 3, km: 68.2, hm: 1240 },
  touren: [],
  ...patch,
})

describe('profilKopf', () => {
  it('nimmt Name, Handle, Ort und den Beitritt', () => {
    expect(profilKopf(profil())).toEqual({
      name: 'Henrik',
      bio: 'Unterwegs meistens auf zwei Rädern.',
      bild: null,
      handle: '@henrik',
      ort: 'Frankfurt am Main',
      dabeiSeit: 'Dabei seit Juli 2026',
    })
  })

  it('bleibt ohne Anzeigenamen unpersönlich, statt etwas zu erfinden', () => {
    const kopf = profilKopf(profil({ anzeigename: null, bio: '  ', ort: '   ' }))
    expect(kopf.name).toBe('Ohne Namen')
    expect(kopf.bio).toBeNull()
    expect(kopf.ort).toBeNull()
  })
})

describe('dabeiSeit', () => {
  it('nennt nur Monat und Jahr', () => {
    expect(dabeiSeit('2026-07-04T08:00:00.000Z')).toBe('Dabei seit Juli 2026')
  })

  it('verkraftet Unsinn', () => {
    expect(dabeiSeit('kaputt')).toBe('')
    expect(dabeiSeit(null)).toBe('')
  })
})

describe('kennzahlChips', () => {
  it('baut drei Chips aus den Zahlen des Servers', () => {
    expect(kennzahlChips({ touren: 3, km: 68.2, hm: 1240 })).toEqual([
      { art: 'touren', zahl: '3', wort: 'Touren' },
      { art: 'km', zahl: '68', wort: 'km unterwegs' },
      { art: 'hm', zahl: `1${SCHMAL}240`, wort: 'hm bergauf' },
    ])
  })

  it('sagt „Tour" bei genau einer', () => {
    expect(kennzahlChips({ touren: 1, km: 0, hm: 0 })[0]).toMatchObject({ zahl: '1', wort: 'Tour' })
  })

  it('lässt Nullen weg — „0 km unterwegs" ist keine Auskunft', () => {
    expect(kennzahlChips({ touren: 0, km: 0, hm: 0 })).toEqual([])
    expect(kennzahlChips({ touren: 2, km: 12, hm: 0 })).toHaveLength(2)
  })

  it('ohne Kennzahlen gar nichts', () => {
    expect(kennzahlChips(null)).toEqual([])
  })
})

describe('zahl', () => {
  it('trennt Tausender mit schmalem Leerraum, nicht mit Punkt', () => {
    // Der Punkt vertritt daneben in „12.4 km" das Komma
    expect(zahl(1240)).toBe(`1${SCHMAL}240`)
    expect(zahl(999)).toBe('999')
    expect(zahl(1234567)).toBe(`1${SCHMAL}234${SCHMAL}567`)
  })
})

describe('linkChips', () => {
  it('zeigt die nackte Form und verlinkt mit Schema', () => {
    // Ohne Schema wäre `henrikheil.net` ein relativer Pfad — der Link führte
    // auf maptale.io/@henrik/henrikheil.net
    const chips = linkChips(profil({ website: 'henrikheil.net', instagram: 'henrik.unterwegs' }))
    expect(chips).toEqual([
      { art: 'web', text: 'henrikheil.net', href: 'https://henrikheil.net' },
      { art: 'instagram', text: '@henrik.unterwegs', href: 'https://instagram.com/henrik.unterwegs' },
    ])
  })

  it('verkraftet ein mitgespeichertes @', () => {
    expect(linkChips(profil({ instagram: '@henrik' }))[0]).toMatchObject({ text: '@henrik' })
  })

  it('ohne Links bleibt die Zeile leer', () => {
    expect(linkChips(profil())).toEqual([])
  })
})

describe('istEigenes', () => {
  it('vergleicht Handles, nicht die Adresszeile', () => {
    // Die Seite kann über ?id=… oder einen aufgegebenen Handle erreicht sein
    expect(istEigenes(profil(), 'henrik')).toBe(true)
    expect(istEigenes(profil(), 'HENRIK')).toBe(true)
    expect(istEigenes(profil(), 'anna')).toBe(false)
  })

  it('ohne Anmeldung nein — ein „vielleicht" wäre ein toter Knopf', () => {
    expect(istEigenes(profil(), null)).toBe(false)
    expect(istEigenes(profil({ handle: null }), 'henrik')).toBe(false)
  })
})

describe('profilAdresse', () => {
  it('baut die vorlesbare Adresse', () => {
    expect(profilAdresse('henrik', 'https://maptale.io')).toBe('https://maptale.io/@henrik')
    expect(profilAdresse('henrik', 'https://maptale.io/')).toBe('https://maptale.io/@henrik')
  })
})

describe('anfangsbuchstabe', () => {
  it('nimmt den Anzeigenamen, nicht den Handle', () => {
    // Ein „h" neben „Reisende" sähe aus wie ein Fehler
    expect(anfangsbuchstabe(profil({ anzeigename: 'Reisende', handle: 'henrik' }))).toBe('R')
  })

  it('fällt auf den Handle und dann auf ein neutrales Zeichen zurück', () => {
    expect(anfangsbuchstabe(profil({ anzeigename: null }))).toBe('H')
    expect(anfangsbuchstabe(profil({ anzeigename: null, handle: null }))).toBe('·')
  })

  it('verkraftet Zeichen jenseits der Grundebene', () => {
    // [...text][0] statt text[0]: Ein Emoji besteht aus zwei UTF-16-Einheiten
    expect(anfangsbuchstabe(profil({ anzeigename: '🚲 Radler' }))).toBe('🚲')
  })
})
