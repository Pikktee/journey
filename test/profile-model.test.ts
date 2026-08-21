// Datenmodell der Profilseite (DOM-frei, wie gallery-model.ts).
import { describe, expect, it } from 'vitest'
import {
  avatarInitial,
  memberSince,
  isOwn,
  statChips,
  linkChips,
  profileAddress,
  profileHeading,
  formatNumber,
  type ProfileResponse,
} from '../src/profile/profile-model'
import { defaultBanner, BANNERS } from '../src/profile/profile-banners'

/**
 * U+202F, schmales geschütztes Leerzeichen — als Escape geschrieben, weil es
 * im Quelltext von einem gewöhnlichen Leerzeichen nicht zu unterscheiden ist.
 */
const SCHMAL = '\u202f'

const profil = (patch: Partial<ProfileResponse> = {}): ProfileResponse => ({
  handle: 'henrik',
  displayName: 'Henrik',
  bio: 'Unterwegs meistens auf zwei Rädern.',
  location: 'Frankfurt am Main',
  website: null,
  instagram: null,
  avatarUrl: null,
  bannerUrl: null,
  memberSince: '2026-07-04T08:00:00.000Z',
  stats: { tours: 3, km: 68.2, elevationGain: 1240 },
  tours: [],
  ...patch,
})

describe('profilKopf', () => {
  it('nimmt Name, Handle, Ort und den Beitritt', () => {
    expect(profileHeading(profil())).toEqual({
      name: 'Henrik',
      bio: 'Unterwegs meistens auf zwei Rädern.',
      image: null,
      handle: '@henrik',
      location: 'Frankfurt am Main',
      memberSince: 'Dabei seit Juli 2026',
    })
  })

  it('nimmt ohne Anzeigenamen den Handle — und zeigt ihn dann nicht zweimal', () => {
    const kopf = profileHeading(profil({ displayName: null, bio: '  ', location: '   ' }))
    expect(kopf.name).toBe('@henrik')
    expect(kopf.handle).toBeNull()
    expect(kopf.bio).toBeNull()
    expect(kopf.location).toBeNull()
  })

  it('erfindet auch ohne Handle nichts', () => {
    expect(profileHeading(profil({ displayName: null, handle: null })).name).toBe('Ohne Namen')
  })
})

describe('defaultBanner', () => {
  it('gibt jedem Profil ohne eigene Wahl ein Bild aus der Auswahl', () => {
    for (const handle of ['henrik', 'anna', 'x', '']) {
      expect(BANNERS.map((b) => b.file)).toContain(defaultBanner(handle))
    }
  })

  it('bleibt bei derselben Person dasselbe — sonst sähe jeder Aufruf nach Fehler aus', () => {
    expect(defaultBanner('henrik')).toBe(defaultBanner('henrik'))
    expect(defaultBanner('HENRIK')).toBe(defaultBanner('henrik'))
  })

  it('verteilt über die Auswahl, statt allen dasselbe zu geben', () => {
    const namen = ['henrik', 'anna', 'tom', 'mira', 'lars', 'ida', 'jonas', 'nele']
    expect(new Set(namen.map(defaultBanner)).size).toBeGreaterThan(1)
  })
})

describe('dabeiSeit', () => {
  it('nennt nur Monat und Jahr', () => {
    expect(memberSince('2026-07-04T08:00:00.000Z')).toBe('Dabei seit Juli 2026')
  })

  it('verkraftet Unsinn', () => {
    expect(memberSince('kaputt')).toBe('')
    expect(memberSince(null)).toBe('')
  })
})

describe('kennzahlChips', () => {
  it('baut drei Chips aus den Zahlen des Servers', () => {
    expect(statChips({ tours: 3, km: 68.2, elevationGain: 1240 })).toEqual([
      { kind: 'tours', value: '3', label: 'Touren' },
      { kind: 'km', value: '68', label: 'km unterwegs' },
      { kind: 'elevation', value: `1${SCHMAL}240`, label: 'Höhenmeter' },
    ])
  })

  it('sagt „Tour" bei genau einer', () => {
    expect(statChips({ tours: 1, km: 0, elevationGain: 0 })[0]).toMatchObject({
      value: '1',
      label: 'Tour',
    })
  })

  it('lässt Nullen weg — „0 km unterwegs" ist keine Auskunft', () => {
    expect(statChips({ tours: 0, km: 0, elevationGain: 0 })).toEqual([])
    expect(statChips({ tours: 2, km: 12, elevationGain: 0 })).toHaveLength(2)
  })

  it('ohne Kennzahlen gar nichts', () => {
    expect(statChips(null)).toEqual([])
  })
})

describe('formatNumber', () => {
  it('trennt Tausender mit schmalem Leerraum, nicht mit Punkt', () => {
    // Der Punkt vertritt daneben in „12.4 km" das Komma
    expect(formatNumber(1240)).toBe(`1${SCHMAL}240`)
    expect(formatNumber(999)).toBe('999')
    expect(formatNumber(1234567)).toBe(`1${SCHMAL}234${SCHMAL}567`)
  })
})

describe('linkChips', () => {
  it('zeigt die nackte Form und verlinkt mit Schema', () => {
    // Ohne Schema wäre `henrikheil.net` ein relativer Pfad — der Link führte
    // auf maptale.io/@henrik/henrikheil.net
    const chips = linkChips(profil({ website: 'henrikheil.net', instagram: 'henrik.unterwegs' }))
    expect(chips).toEqual([
      { kind: 'web', text: 'henrikheil.net', href: 'https://henrikheil.net' },
      {
        kind: 'instagram',
        text: '@henrik.unterwegs',
        href: 'https://instagram.com/henrik.unterwegs',
      },
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
    expect(isOwn(profil(), 'henrik')).toBe(true)
    expect(isOwn(profil(), 'HENRIK')).toBe(true)
    expect(isOwn(profil(), 'anna')).toBe(false)
  })

  it('ohne Anmeldung nein — ein „vielleicht" wäre ein toter Knopf', () => {
    expect(isOwn(profil(), null)).toBe(false)
    expect(isOwn(profil({ handle: null }), 'henrik')).toBe(false)
  })
})

describe('profilAdresse', () => {
  it('baut die vorlesbare Adresse', () => {
    expect(profileAddress('henrik', 'https://maptale.io')).toBe('https://maptale.io/@henrik')
    expect(profileAddress('henrik', 'https://maptale.io/')).toBe('https://maptale.io/@henrik')
  })
})

describe('anfangsbuchstabe', () => {
  it('nimmt den Anzeigenamen, nicht den Handle', () => {
    // Ein „h" neben „Reisende" sähe aus wie ein Fehler
    expect(avatarInitial(profil({ displayName: 'Reisende', handle: 'henrik' }))).toBe('R')
  })

  it('fällt auf den Handle und dann auf ein neutrales Zeichen zurück', () => {
    expect(avatarInitial(profil({ displayName: null }))).toBe('H')
    expect(avatarInitial(profil({ displayName: null, handle: null }))).toBe('·')
  })

  it('verkraftet Zeichen jenseits der Grundebene', () => {
    // [...text][0] statt text[0]: Ein Emoji besteht aus zwei UTF-16-Einheiten
    expect(avatarInitial(profil({ displayName: '🚲 Radler' }))).toBe('🚲')
  })
})
