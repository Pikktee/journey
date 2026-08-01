// Rechnende Teile der Benutzerverwaltung — Formatierung, Suche und vor allem
// die Sperr-Regeln, die entscheiden, welche Knöpfe überhaupt anfassbar sind.

import { describe, expect, it } from 'vitest'
import { codeVollstaendig, formatiereEinladungscode } from '../src/einladungscode.js'
import {
  beschreibeEinladung,
  einladungsLink,
  filtereBenutzer,
  formatiereBytes,
  formatiereDatum,
  loeschenGesperrt,
  rolleGesperrt,
  zaehleAdmins,
  zaehleEinladungen,
  type AdminBenutzer,
  type AdminEinladung,
} from '../src/admin/adminmodell.js'

const konto = (teil: Partial<AdminBenutzer> = {}): AdminBenutzer => ({
  id: 'u_1',
  email: 'anna@example.com',
  name: 'Anna',
  rolle: 'nutzer',
  verifiziert: true,
  angelegtAm: '2026-03-04T10:00:00.000Z',
  anzeigename: null,
  touren: 0,
  speicher: 0,
  fest: false,
  ...teil,
})

const einladung = (teil: Partial<AdminEinladung> = {}): AdminEinladung => ({
  code: 'ABCD-2345',
  notiz: null,
  erstelltAm: '2026-03-04T10:00:00.000Z',
  erstelltVon: 'chefin@example.com',
  ablauf: null,
  eingeloestAm: null,
  eingeloestVon: null,
  zustand: 'offen',
  ...teil,
})

describe('formatiereBytes', () => {
  it('rundet grob und wechselt bei Gigabyte die Einheit', () => {
    expect(formatiereBytes(0)).toBe('0 MB')
    expect(formatiereBytes(1024 * 1024)).toBe('1.0 MB')
    expect(formatiereBytes(42 * 1024 * 1024)).toBe('42 MB')
    expect(formatiereBytes(2.5 * 1024 * 1024 * 1024)).toBe('2.5 GB')
  })

  it('nennt Bruchteile eines Megabyte nicht einzeln — in der Tabelle zählt die Größenordnung', () => {
    expect(formatiereBytes(5000)).toBe('0 MB')
  })
})

describe('formatiereDatum', () => {
  it('gibt Tag.Monat.Jahr', () => {
    expect(formatiereDatum('2026-03-04T10:00:00.000Z')).toMatch(/^\d{2}\.\d{2}\.2026$/)
  })

  it('bleibt bei fehlenden oder kaputten Werten ruhig', () => {
    expect(formatiereDatum(null)).toBe('—')
    expect(formatiereDatum('kein datum')).toBe('—')
  })
})

describe('filtereBenutzer', () => {
  const liste = [
    konto({ id: 'u_1', email: 'anna@example.com', name: 'Anna Berg' }),
    konto({ id: 'u_2', email: 'bert@example.com', name: 'Bert', anzeigename: 'Radfahrer' }),
  ]

  it('gibt ohne Suche alles zurück', () => {
    expect(filtereBenutzer(liste, '  ')).toHaveLength(2)
  })

  it('sucht über Adresse, Klarname und Anzeigename', () => {
    expect(filtereBenutzer(liste, 'ANNA').map((b) => b.id)).toEqual(['u_1'])
    expect(filtereBenutzer(liste, 'berg').map((b) => b.id)).toEqual(['u_1'])
    expect(filtereBenutzer(liste, 'radfahr').map((b) => b.id)).toEqual(['u_2'])
    expect(filtereBenutzer(liste, 'example.com')).toHaveLength(2)
  })

  it('liefert eine Kopie, keine Sicht auf die Eingabe', () => {
    const erg = filtereBenutzer(liste, '')
    erg.pop()
    expect(liste).toHaveLength(2)
  })
})

describe('beschreibeEinladung', () => {
  it('sagt bei offenen Codes, wie lange sie noch gelten', () => {
    expect(beschreibeEinladung(einladung())).toBe('Offen · ohne Ablaufdatum')
    expect(beschreibeEinladung(einladung({ ablauf: '2026-04-03T10:00:00.000Z' }))).toMatch(/^Offen · gültig bis \d{2}\./)
  })

  it('nennt bei eingelösten Codes die Person', () => {
    const text = beschreibeEinladung(
      einladung({ zustand: 'eingeloest', eingeloestVon: 'anna@example.com', eingeloestAm: '2026-03-06T10:00:00.000Z' }),
    )
    expect(text).toContain('anna@example.com')
  })

  it('kommt ohne Person aus, wenn das Konto gelöscht wurde', () => {
    const text = beschreibeEinladung(einladung({ zustand: 'eingeloest', eingeloestVon: null, eingeloestAm: '2026-03-06T10:00:00.000Z' }))
    expect(text).toContain('gelöschten Konto')
  })

  it('nennt bei abgelaufenen Codes das Datum', () => {
    expect(beschreibeEinladung(einladung({ zustand: 'abgelaufen', ablauf: '2026-03-05T10:00:00.000Z' }))).toMatch(/^Abgelaufen am /)
  })
})

describe('zaehleEinladungen', () => {
  it('zählt je Zustand und fängt bei null an', () => {
    expect(zaehleEinladungen([])).toEqual({ offen: 0, eingeloest: 0, abgelaufen: 0 })
    expect(
      zaehleEinladungen([einladung(), einladung({ zustand: 'eingeloest' }), einladung({ zustand: 'eingeloest' })]),
    ).toEqual({ offen: 1, eingeloest: 2, abgelaufen: 0 })
  })
})

describe('einladungsLink', () => {
  it('führt ins Registrierungsformular und trägt den Code mit', () => {
    expect(einladungsLink('https://maptale.example', 'ABCD-2345')).toBe(
      'https://maptale.example/studio.html#einladung=ABCD-2345',
    )
  })

  it('verträgt einen Schrägstrich am Ende der Basis-URL', () => {
    expect(einladungsLink('https://maptale.example/', 'AB-CD')).toBe('https://maptale.example/studio.html#einladung=AB-CD')
  })
})

describe('formatiereEinladungscode', () => {
  // Räumt beim TIPPEN auf, statt hinterher zu meckern.
  it('macht Versalien und setzt den Bindestrich von selbst', () => {
    expect(formatiereEinladungscode('abcd')).toBe('ABCD')
    expect(formatiereEinladungscode('abcd2')).toBe('ABCD-2')
    expect(formatiereEinladungscode('abcd2345')).toBe('ABCD-2345')
  })

  it('nimmt einen schon formatierten Code unverändert an', () => {
    expect(formatiereEinladungscode('ABCD-2345')).toBe('ABCD-2345')
  })

  it('wirft weg, was nicht in einen Code gehört, und kappt Überlänge', () => {
    expect(formatiereEinladungscode(' ab cd-23 45 ')).toBe('ABCD-2345')
    expect(formatiereEinladungscode('abcd2345xyz')).toBe('ABCD-2345')
    expect(formatiereEinladungscode('!!!')).toBe('')
  })

  it('erkennt einen vollständigen Code an seiner Form', () => {
    expect(codeVollstaendig('abcd2345')).toBe(true)
    expect(codeVollstaendig('ABCD-2345')).toBe(true)
    expect(codeVollstaendig('ABCD-234')).toBe(false)
    expect(codeVollstaendig('')).toBe(false)
  })
})

describe('Sperr-Regeln', () => {
  // Dieselben Regeln stehen im Server (routes/admin.ts) — hier entscheiden sie,
  // ob ein Knopf überhaupt anfassbar ist.
  it('lässt gewöhnliche Konten in Ruhe', () => {
    expect(rolleGesperrt(konto(), 'u_ich', 2)).toBe('')
    expect(loeschenGesperrt(konto(), 'u_ich', 2)).toBe('')
  })

  it('schützt die konfigurierten Adressen', () => {
    const fest = konto({ rolle: 'admin', fest: true })
    expect(rolleGesperrt(fest, 'u_ich', 3)).toContain('Konfiguration')
    expect(loeschenGesperrt(fest, 'u_ich', 3)).toContain('Konfiguration')
  })

  it('lässt die eigene Admin-Rolle nicht ablegen und das eigene Konto nicht löschen', () => {
    const ich = konto({ id: 'u_ich', rolle: 'admin' })
    expect(rolleGesperrt(ich, 'u_ich', 3)).toContain('eigene')
    expect(loeschenGesperrt(ich, 'u_ich', 3)).toContain('Studio')
  })

  it('hält den letzten Administrator fest', () => {
    const letzter = konto({ id: 'u_andere', rolle: 'admin' })
    expect(rolleGesperrt(letzter, 'u_ich', 1)).toContain('mindestens einen')
    expect(loeschenGesperrt(letzter, 'u_ich', 1)).toContain('mindestens einen')
    // Mit einem zweiten Admin geht beides
    expect(rolleGesperrt(letzter, 'u_ich', 2)).toBe('')
    expect(loeschenGesperrt(letzter, 'u_ich', 2)).toBe('')
  })

  it('zählt die Administratoren einer Liste', () => {
    expect(zaehleAdmins([konto(), konto({ rolle: 'admin' }), konto({ rolle: 'admin' })])).toBe(2)
  })
})
