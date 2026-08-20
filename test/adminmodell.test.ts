// Rechnende Teile der Benutzerverwaltung — Formatierung, Suche und vor allem
// die Sperr-Regeln, die entscheiden, welche Knöpfe überhaupt anfassbar sind.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { codeVollstaendig, formatiereEinladungscode } from '../src/einladungscode.js'
import {
  beschreibeEinladung,
  istLokal,
  beschreibeProtokoll,
  filtereProtokoll,
  formatiereZeitpunkt,
  zaehleProtokoll,
  type ProtokollEintrag,
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
  role: 'user',
  verified: true,
  createdAt: '2026-03-04T10:00:00.000Z',
  displayName: null,
  tours: 0,
  storage: 0,
  fixed: false,
  ...teil,
})

const einladung = (teil: Partial<AdminEinladung> = {}): AdminEinladung => ({
  code: 'ABCD-2345',
  note: null,
  createdAt: '2026-03-04T10:00:00.000Z',
  createdBy: 'chefin@example.com',
  expiresAt: null,
  redeemedAt: null,
  redeemedBy: null,
  state: 'open',
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
    expect(formatiereDatum(null)).toBe('–')
    expect(formatiereDatum('kein datum')).toBe('–')
  })
})

describe('filtereBenutzer', () => {
  const liste = [
    konto({ id: 'u_1', email: 'anna@example.com', name: 'Anna Berg' }),
    konto({ id: 'u_2', email: 'bert@example.com', name: 'Bert', displayName: 'Radfahrer' }),
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
      konto({ id: 'u_1', role: 'admin' }),
      konto({ id: 'u_2', email: 'bert@example.com', name: 'Bert', verified: false }),
      konto({ id: 'u_3', email: 'cara@example.com', name: 'Cara' }),
    ]
    expect(filtereBenutzer(gemischt, '', 'admins').map((b) => b.id)).toEqual(['u_1'])
    expect(filtereBenutzer(gemischt, '', 'unconfirmed').map((b) => b.id)).toEqual(['u_2'])
    expect(filtereBenutzer(gemischt, '', 'alle')).toHaveLength(3)
  })

  // Suche und Filter greifen zusammen, nicht nacheinander: Die Zahlen an den
  // Filter-Segmenten zählen innerhalb der laufenden Suche.
  it('verbindet Suche und Filter mit UND', () => {
    const gemischt = [
      konto({ id: 'u_1', email: 'anna@example.com', role: 'admin' }),
      konto({ id: 'u_2', email: 'bert@example.com', name: 'Bert', role: 'admin' }),
    ]
    expect(filtereBenutzer(gemischt, 'anna', 'admins').map((b) => b.id)).toEqual(['u_1'])
    expect(filtereBenutzer(gemischt, 'anna', 'unconfirmed')).toHaveLength(0)
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
    expect(beschreibeEinladung(einladung({ expiresAt: '2026-04-03T10:00:00.000Z' }))).toMatch(
      /^Offen · gültig bis \d{2}\./,
    )
  })

  it('nennt bei eingelösten Codes die Person', () => {
    const text = beschreibeEinladung(
      einladung({
        state: 'redeemed',
        redeemedBy: 'anna@example.com',
        redeemedAt: '2026-03-06T10:00:00.000Z',
      }),
    )
    expect(text).toContain('anna@example.com')
  })

  it('kommt ohne Person aus, wenn das Konto gelöscht wurde', () => {
    const text = beschreibeEinladung(
      einladung({
        state: 'redeemed',
        redeemedBy: null,
        redeemedAt: '2026-03-06T10:00:00.000Z',
      }),
    )
    expect(text).toContain('gelöschten Konto')
  })

  it('nennt bei abgelaufenen Codes das Datum', () => {
    expect(
      beschreibeEinladung(einladung({ state: 'expired', expiresAt: '2026-03-05T10:00:00.000Z' })),
    ).toMatch(/^Abgelaufen am /)
  })
})

describe('zaehleEinladungen', () => {
  it('zählt je Zustand und fängt bei null an', () => {
    expect(zaehleEinladungen([])).toEqual({ open: 0, redeemed: 0, expired: 0 })
    expect(
      zaehleEinladungen([
        einladung(),
        einladung({ state: 'redeemed' }),
        einladung({ state: 'redeemed' }),
      ]),
    ).toEqual({ open: 1, redeemed: 2, expired: 0 })
  })
})

describe('filtereEinladungen', () => {
  const liste = [
    einladung({ code: 'ABCD-2345', note: 'Anna vom Radclub' }),
    einladung({ code: 'WXYZ-9876', state: 'redeemed' }),
    einladung({ code: 'QRST-1111', state: 'expired', note: 'Messe' }),
  ]

  it('filtert nach Zustand', () => {
    expect(filtereEinladungen(liste, '', 'open').map((e) => e.code)).toEqual(['ABCD-2345'])
    expect(filtereEinladungen(liste, '', 'expired').map((e) => e.code)).toEqual(['QRST-1111'])
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
    expect(einladungsLink('https://maptale.example/', 'AB-CD')).toBe(
      'https://maptale.example/registrieren#einladung=AB-CD',
    )
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
    const fest = konto({ role: 'admin', fixed: true })
    expect(rolleGesperrt(fest, 'u_ich', 3)).toContain('Konfiguration')
    expect(loeschenGesperrt(fest, 'u_ich', 3)).toContain('Konfiguration')
  })

  it('lässt die eigene Admin-Rolle nicht ablegen und das eigene Konto nicht löschen', () => {
    const ich = konto({ id: 'u_ich', role: 'admin' })
    expect(rolleGesperrt(ich, 'u_ich', 3)).toContain('eigene')
    expect(loeschenGesperrt(ich, 'u_ich', 3)).toContain('Studio')
  })

  it('hält den letzten Administrator fest', () => {
    const letzter = konto({ id: 'u_andere', role: 'admin' })
    expect(rolleGesperrt(letzter, 'u_ich', 1)).toContain('mindestens einen')
    expect(loeschenGesperrt(letzter, 'u_ich', 1)).toContain('mindestens einen')
    // Mit einem zweiten Admin geht beides
    expect(rolleGesperrt(letzter, 'u_ich', 2)).toBe('')
    expect(loeschenGesperrt(letzter, 'u_ich', 2)).toBe('')
  })

  it('zählt die Administratoren einer Liste', () => {
    expect(zaehleAdmins([konto(), konto({ role: 'admin' }), konto({ role: 'admin' })])).toBe(2)
  })
})

describe('Warteliste', () => {
  const wartender = (teil: Partial<AdminWartender> = {}): AdminWartender => ({
    id: 'w_1',
    email: 'anna@example.com',
    note: null,
    joinedAt: '2026-03-04T10:00:00.000Z',
    confirmedAt: null,
    invitedAt: null,
    invitedCode: null,
    state: 'unconfirmed',
    ...teil,
  })

  it('zählt jeden Zustand einzeln', () => {
    const zahl = zaehleWarteliste([
      wartender(),
      wartender({ state: 'pending' }),
      wartender({ state: 'pending' }),
      wartender({ state: 'invited' }),
    ])
    expect(zahl).toEqual({ unconfirmed: 1, pending: 2, invited: 1 })
  })

  it('sagt zu jedem Eintrag, wo er gerade steht', () => {
    expect(beschreibeWartenden(wartender())).toContain('Bestätigung steht aus')
    expect(
      beschreibeWartenden(wartender({ state: 'pending', confirmedAt: '2026-03-05T08:00:00.000Z' })),
    ).toBe('Bestätigt am 05.03.2026 · wartet')
    expect(
      beschreibeWartenden(
        wartender({
          state: 'invited',
          invitedAt: '2026-03-06T08:00:00.000Z',
          invitedCode: 'ABCD-2345',
        }),
      ),
    ).toBe('Eingeladen am 06.03.2026 mit Code ABCD-2345')
  })

  // Die wichtigste Sperre des ganzen Features: Eine Mail an eine unbestätigte
  // Adresse wäre genau die ungefragte Nachricht, gegen die das Double-Opt-in
  // gebaut ist. Der Server lehnt sie ab — der Knopf soll sie nicht anbieten.
  it('bietet das Einladen nur bestätigten Adressen an', () => {
    expect(einladenGesperrt(wartender())).toContain('nicht bestätigt')
    expect(einladenGesperrt(wartender({ state: 'invited' }))).toContain('Schon eingeladen')
    expect(einladenGesperrt(wartender({ state: 'pending' }))).toBe('')
  })

  it('filtert nach Zustand und sucht in Adresse und Notiz', () => {
    const liste = [
      wartender({ id: 'w_1', state: 'pending', note: 'Radtour durch Island' }),
      wartender({ id: 'w_2', email: 'bert@example.com' }),
      wartender({ id: 'w_3', email: 'cara@example.com', state: 'invited' }),
    ]
    expect(filtereWarteliste(liste, '', 'pending').map((e) => e.id)).toEqual(['w_1'])
    expect(filtereWarteliste(liste, 'bert').map((e) => e.id)).toEqual(['w_2'])
    expect(filtereWarteliste(liste, 'island').map((e) => e.id)).toEqual(['w_1'])
    expect(filtereWarteliste(liste, 'island', 'invited')).toHaveLength(0)
  })

  // Spiegel von `wartelisteAngeboten` in server/src/auth/waitlist.ts — die
  // Wahrheitstabelle steht doppelt (der Server kann hier nicht importiert
  // werden, eigener rootDir). Hier hängt nur ein Satz daran: „angeschaltet,
  // aber ohne Wirkung".
  it('bietet die Warteliste nur an, wenn die Tür nicht ohnehin offen steht', () => {
    // Schalter aus: nie.
    expect(wartelisteAngeboten(false, true, true)).toBe(false)
    expect(wartelisteAngeboten(false, false, false)).toBe(false)
    // Schalter an + Einladungspflicht: ja.
    expect(wartelisteAngeboten(true, true, true)).toBe(true)
    // Schalter an, keine Pflicht, Registrierung open: wirkungslos — man kann
    // sich ja anmelden.
    expect(wartelisteAngeboten(true, false, true)).toBe(false)
    // Registrierung per Umgebung zu: dann ist die Warteliste der einzige Weg.
    expect(wartelisteAngeboten(true, false, false)).toBe(true)
  })
})

describe('System-Mails', () => {
  const vorlage = (teil: Partial<MailVorlage> = {}): MailVorlage => ({
    key: 'verification',
    name: 'E-Mail bestätigen',
    occasion: 'Geht nach der Registrierung raus.',
    placeholders: [{ name: 'link', description: 'Bestätigungslink', example: 'https://…' }],
    hasLink: true,
    defaultContent: {
      subject: 'Bestätige',
      titel: 'Willkommen',
      text: 'Hallo',
      button: 'Los',
      footer: '24 Stunden',
    },
    blocks: {
      subject: 'Bestätige',
      titel: 'Willkommen',
      text: 'Hallo',
      button: 'Los',
      footer: '24 Stunden',
    },
    customized: false,
    updatedAt: null,
    updatedBy: null,
    ...teil,
  })

  // Eine unangetastete Vorlage soll erzählen, WANN sie rausgeht — das ist die
  // Frage vor dem Bearbeiten. Bei einer angepassten zählt, wer sie angefasst hat.
  it('erzählt bei unangetasteten Vorlagen vom Anlass', () => {
    expect(beschreibeVorlage(vorlage())).toBe('Geht nach der Registrierung raus.')
  })

  it('nennt bei angepassten Vorlagen Zeitpunkt und Person', () => {
    expect(
      beschreibeVorlage(
        vorlage({
          customized: true,
          updatedAt: '2026-03-05T08:00:00.000Z',
          updatedBy: 'chefin@example.com',
        }),
      ),
    ).toBe('Angepasst am 05.03.2026 von chefin@example.com')
  })

  it('kommt ohne bekannte Person aus — das Konto kann gelöscht sein', () => {
    expect(
      beschreibeVorlage(vorlage({ customized: true, updatedAt: '2026-03-05T08:00:00.000Z' })),
    ).toBe('Angepasst am 05.03.2026')
  })
})

describe('Protokoll', () => {
  const e = (patch: Partial<ProtokollEintrag> = {}): ProtokollEintrag => ({
    no: 1,
    zeit: '2026-08-04T12:30:05.000Z',
    level: 'warning',
    text: 'Bildanalyse: HTTP 429 (Rate-Limit)',
    ...patch,
  })

  it('sucht auch im Detail — die Tour-ID steht oft nur dort', () => {
    const liste = [
      e(),
      e({
        no: 2,
        text: 'Anreicherung fehlgeschlagen',
        detail: 'Tour t_abc123 · Track nicht lesbar',
      }),
    ]
    expect(filtereProtokoll(liste, 't_abc123').map((x) => x.no)).toEqual([2])
  })

  it('filtert nach Stufe', () => {
    const liste = [e(), e({ no: 2, level: 'failed' })]
    expect(filtereProtokoll(liste, '', 'failed').map((x) => x.no)).toEqual([2])
    expect(zaehleProtokoll(liste)).toEqual({ warning: 1, failed: 1 })
  })

  it('zeigt bei Meldungen von heute nur die Uhrzeit, sonst auch den Tag', () => {
    // Innerhalb einer Minute entscheidet die Sekunde über die Reihenfolge —
    // deshalb steht sie in der Zeile, das Datum aber nur, wenn es abweicht.
    const zeit = new Date('2026-08-04T12:30:05')
    expect(formatiereZeitpunkt(zeit.toISOString(), new Date('2026-08-04T18:00:00'))).toBe(
      '12:30:05',
    )
    expect(formatiereZeitpunkt(zeit.toISOString(), new Date('2026-08-05T09:00:00'))).toBe(
      '04.08. 12:30:05',
    )
  })

  // Ein leerer Puffer ist die gute Nachricht. Er darf nicht wie ein Ausfall
  // klingen („keine Daten"), sondern sagt, seit wann nichts vorgefallen ist.
  it('macht aus Leere eine Aussage statt eines Mangels', () => {
    expect(beschreibeProtokoll(0, 0, '2026-08-04T09:15:00')).toMatch(
      /^Nichts vorgefallen seit dem Start der API am 04\.08\.2026 um 09:15:00\.$/,
    )
  })

  it('nennt die Fehler gesondert, wenn es welche gibt', () => {
    expect(beschreibeProtokoll(12, 3, null)).toBe('12 Meldungen, davon 3 Fehler.')
    expect(beschreibeProtokoll(1, 0, null)).toBe('1 Meldung.')
  })
})

describe('istLokal', () => {
  it('erkennt den eigenen Rechner', () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]', 'maptale.localhost'])
      expect(istLokal(host), host).toBe(true)
  })

  it('lässt sich von einem Namen mit „localhost" darin nicht täuschen', () => {
    // Der Doku-Link hängt daran (src/admin/admin.ts): Er soll auf dem Server
    // nicht erscheinen, und „enthält localhost" wäre dafür zu wenig.
    for (const host of ['maptale.io', 'www.maptale.io', 'localhost.angreifer.example'])
      expect(istLokal(host), host).toBe(false)
  })
})
