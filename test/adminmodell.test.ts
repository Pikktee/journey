// Rechnende Teile der Benutzerverwaltung — Formatierung, Suche und vor allem
// die Sperr-Regeln, die entscheiden, welche Knöpfe überhaupt anfassbar sind.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { codeVollstaendig, formatiereEinladungscode } from '../src/einladungscode.js'
import {
  beschreibeEinladung,
  beschreibeVorlage,
  beschreibeWartenden,
  einladenGesperrt,
  einladungsLink,
  filtereBenutzer,
  filtereEinladungen,
  filtereWarteliste,
  formatiereBytes,
  formatiereDatum,
  initiale,
  loeschenGesperrt,
  rolleGesperrt,
  tabAusHash,
  wartelisteAngeboten,
  zaehleAdmins,
  zaehleEinladungen,
  zaehleWarteliste,
  TABS,
  TAB_STANDARD,
  type AdminBenutzer,
  type AdminEinladung,
  type AdminWartender,
  type MailVorlage,
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

// Die Reiterleiste hat drei Abnehmer, die nicht voneinander wissen: die
// Leiste selbst, der URL-Anhang und die vier Abschnitte in admin.html. Wer
// einen Bereich ergänzt und das Panel vergisst, sieht einen Reiter, der auf
// nichts zeigt — und merkt es erst beim Klicken.
describe('Reiter', () => {
  const wurzel = join(dirname(fileURLToPath(import.meta.url)), '..')
  const html = readFileSync(join(wurzel, 'admin.html'), 'utf8')

  it('trägt eindeutige Namen und beginnt beim Standard', () => {
    const ids = TABS.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain(TAB_STANDARD)
  })

  it('hat zu jedem Reiter einen Abschnitt in admin.html', () => {
    for (const t of TABS) {
      expect(html, t.id).toContain(`id="panel-${t.id}"`)
      expect(html, t.id).toContain(`aria-labelledby="reiter-${t.id}"`)
    }
  })

  it('liest den Bereich aus dem Anhang — auch ohne Raute und in Versalien', () => {
    expect(tabAusHash('#einladungen')).toBe('einladungen')
    expect(tabAusHash('warteliste')).toBe('warteliste')
    expect(tabAusHash('#MAILS')).toBe('mails')
  })

  it('fällt bei unbekanntem Anhang auf den Standard zurück', () => {
    expect(tabAusHash('')).toBe(TAB_STANDARD)
    expect(tabAusHash('#einladung=ABCD-2345')).toBe(TAB_STANDARD)
  })
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

  it('filtert nach Rolle und offener Bestätigung', () => {
    const gemischt = [
      konto({ id: 'u_1', rolle: 'admin' }),
      konto({ id: 'u_2', email: 'bert@example.com', name: 'Bert', verifiziert: false }),
      konto({ id: 'u_3', email: 'cara@example.com', name: 'Cara' }),
    ]
    expect(filtereBenutzer(gemischt, '', 'admins').map((b) => b.id)).toEqual(['u_1'])
    expect(filtereBenutzer(gemischt, '', 'unbestaetigt').map((b) => b.id)).toEqual(['u_2'])
    expect(filtereBenutzer(gemischt, '', 'alle')).toHaveLength(3)
  })

  // Suche und Filter greifen zusammen, nicht nacheinander: Die Zahlen an den
  // Filter-Segmenten zählen innerhalb der laufenden Suche.
  it('verbindet Suche und Filter mit UND', () => {
    const gemischt = [
      konto({ id: 'u_1', email: 'anna@example.com', rolle: 'admin' }),
      konto({ id: 'u_2', email: 'bert@example.com', name: 'Bert', rolle: 'admin' }),
    ]
    expect(filtereBenutzer(gemischt, 'anna', 'admins').map((b) => b.id)).toEqual(['u_1'])
    expect(filtereBenutzer(gemischt, 'anna', 'unbestaetigt')).toHaveLength(0)
  })
})

describe('initiale', () => {
  it('nimmt den ersten Buchstaben — auch aus einer Adresse', () => {
    expect(initiale('Anna Berg')).toBe('A')
    expect(initiale('bert@example.com')).toBe('B')
  })

  it('fällt bei leerem Namen nicht auf einen leeren Kreis zurück', () => {
    expect(initiale('   ')).toBe('?')
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

describe('filtereEinladungen', () => {
  const liste = [
    einladung({ code: 'ABCD-2345', notiz: 'Anna vom Radclub' }),
    einladung({ code: 'WXYZ-9876', zustand: 'eingeloest' }),
    einladung({ code: 'QRST-1111', zustand: 'abgelaufen', notiz: 'Messe' }),
  ]

  it('filtert nach Zustand', () => {
    expect(filtereEinladungen(liste, '', 'offen').map((e) => e.code)).toEqual(['ABCD-2345'])
    expect(filtereEinladungen(liste, '', 'abgelaufen').map((e) => e.code)).toEqual(['QRST-1111'])
    expect(filtereEinladungen(liste, '', 'alle')).toHaveLength(3)
  })

  it('sucht in der Notiz', () => {
    expect(filtereEinladungen(liste, 'radclub').map((e) => e.code)).toEqual(['ABCD-2345'])
  })

  // Wer den Code aus einer Mail kopiert oder aus dem Kopf tippt, schreibt ihn
  // ohne Bindestrich. Daran darf die Suche nicht scheitern.
  it('findet den Code auch ohne Trennzeichen', () => {
    expect(filtereEinladungen(liste, 'abcd2345').map((e) => e.code)).toEqual(['ABCD-2345'])
    expect(filtereEinladungen(liste, 'ABCD-23').map((e) => e.code)).toEqual(['ABCD-2345'])
  })

  it('lässt eine Einladung ohne Notiz nicht auf jede Suche antworten', () => {
    expect(filtereEinladungen(liste, 'messe').map((e) => e.code)).toEqual(['QRST-1111'])
  })
})

describe('einladungsLink', () => {
  it('führt ins Registrierungsformular und trägt den Code mit', () => {
    expect(einladungsLink('https://maptale.example', 'ABCD-2345')).toBe(
      'https://maptale.example/registrieren#einladung=ABCD-2345',
    )
  })

  it('verträgt einen Schrägstrich am Ende der Basis-URL', () => {
    expect(einladungsLink('https://maptale.example/', 'AB-CD')).toBe('https://maptale.example/registrieren#einladung=AB-CD')
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

describe('Warteliste', () => {
  const wartender = (teil: Partial<AdminWartender> = {}): AdminWartender => ({
    id: 'w_1',
    email: 'anna@example.com',
    notiz: null,
    eingetragenAm: '2026-03-04T10:00:00.000Z',
    bestaetigtAm: null,
    eingeladenAm: null,
    eingeladenCode: null,
    zustand: 'unbestaetigt',
    ...teil,
  })

  it('zählt jeden Zustand einzeln', () => {
    const zahl = zaehleWarteliste([
      wartender(),
      wartender({ zustand: 'wartend' }),
      wartender({ zustand: 'wartend' }),
      wartender({ zustand: 'eingeladen' }),
    ])
    expect(zahl).toEqual({ unbestaetigt: 1, wartend: 2, eingeladen: 1 })
  })

  it('sagt zu jedem Eintrag, wo er gerade steht', () => {
    expect(beschreibeWartenden(wartender())).toContain('Bestätigung steht aus')
    expect(beschreibeWartenden(wartender({ zustand: 'wartend', bestaetigtAm: '2026-03-05T08:00:00.000Z' }))).toBe(
      'Bestätigt am 05.03.2026 · wartet',
    )
    expect(
      beschreibeWartenden(
        wartender({ zustand: 'eingeladen', eingeladenAm: '2026-03-06T08:00:00.000Z', eingeladenCode: 'ABCD-2345' }),
      ),
    ).toBe('Eingeladen am 06.03.2026 mit Code ABCD-2345')
  })

  // Die wichtigste Sperre des ganzen Features: Eine Mail an eine unbestätigte
  // Adresse wäre genau die ungefragte Nachricht, gegen die das Double-Opt-in
  // gebaut ist. Der Server lehnt sie ab — der Knopf soll sie nicht anbieten.
  it('bietet das Einladen nur bestätigten Adressen an', () => {
    expect(einladenGesperrt(wartender())).toContain('nicht bestätigt')
    expect(einladenGesperrt(wartender({ zustand: 'eingeladen' }))).toContain('Schon eingeladen')
    expect(einladenGesperrt(wartender({ zustand: 'wartend' }))).toBe('')
  })

  it('filtert nach Zustand und sucht in Adresse und Notiz', () => {
    const liste = [
      wartender({ id: 'w_1', zustand: 'wartend', notiz: 'Radtour durch Island' }),
      wartender({ id: 'w_2', email: 'bert@example.com' }),
      wartender({ id: 'w_3', email: 'cara@example.com', zustand: 'eingeladen' }),
    ]
    expect(filtereWarteliste(liste, '', 'wartend').map((e) => e.id)).toEqual(['w_1'])
    expect(filtereWarteliste(liste, 'bert').map((e) => e.id)).toEqual(['w_2'])
    expect(filtereWarteliste(liste, 'island').map((e) => e.id)).toEqual(['w_1'])
    expect(filtereWarteliste(liste, 'island', 'eingeladen')).toHaveLength(0)
  })

  // Spiegel von `wartelisteAngeboten` in server/src/auth/warteliste.ts — die
  // Wahrheitstabelle steht doppelt (der Server kann hier nicht importiert
  // werden, eigener rootDir). Hier hängt nur ein Satz daran: „angeschaltet,
  // aber ohne Wirkung".
  it('bietet die Warteliste nur an, wenn die Tür nicht ohnehin offen steht', () => {
    // Schalter aus: nie.
    expect(wartelisteAngeboten(false, true, true)).toBe(false)
    expect(wartelisteAngeboten(false, false, false)).toBe(false)
    // Schalter an + Einladungspflicht: ja.
    expect(wartelisteAngeboten(true, true, true)).toBe(true)
    // Schalter an, keine Pflicht, Registrierung offen: wirkungslos — man kann
    // sich ja anmelden.
    expect(wartelisteAngeboten(true, false, true)).toBe(false)
    // Registrierung per Umgebung zu: dann ist die Warteliste der einzige Weg.
    expect(wartelisteAngeboten(true, false, false)).toBe(true)
  })
})

describe('System-Mails', () => {
  const vorlage = (teil: Partial<MailVorlage> = {}): MailVorlage => ({
    schluessel: 'verifikation',
    name: 'E-Mail bestätigen',
    anlass: 'Geht nach der Registrierung raus.',
    platzhalter: [{ name: 'link', beschreibung: 'Bestätigungslink', beispiel: 'https://…' }],
    hatLink: true,
    standard: { betreff: 'Bestätige', titel: 'Willkommen', text: 'Hallo', knopf: 'Los', fuss: '24 Stunden' },
    bausteine: { betreff: 'Bestätige', titel: 'Willkommen', text: 'Hallo', knopf: 'Los', fuss: '24 Stunden' },
    angepasst: false,
    geaendertAm: null,
    geaendertVon: null,
    ...teil,
  })

  // Eine unangetastete Vorlage soll erzählen, WANN sie rausgeht — das ist die
  // Frage vor dem Bearbeiten. Bei einer angepassten zählt, wer sie angefasst hat.
  it('erzählt bei unangetasteten Vorlagen vom Anlass', () => {
    expect(beschreibeVorlage(vorlage())).toBe('Geht nach der Registrierung raus.')
  })

  it('nennt bei angepassten Vorlagen Zeitpunkt und Person', () => {
    expect(
      beschreibeVorlage(vorlage({ angepasst: true, geaendertAm: '2026-03-05T08:00:00.000Z', geaendertVon: 'chefin@example.com' })),
    ).toBe('Angepasst am 05.03.2026 von chefin@example.com')
  })

  it('kommt ohne bekannte Person aus — das Konto kann gelöscht sein', () => {
    expect(beschreibeVorlage(vorlage({ angepasst: true, geaendertAm: '2026-03-05T08:00:00.000Z' }))).toBe(
      'Angepasst am 05.03.2026',
    )
  })
})
