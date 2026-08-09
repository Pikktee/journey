// Mail-Bausteine: Layout (HTML + Text aus einer Quelle), Vorlagen-Katalog samt
// Prüfung und der Dev-Versand.

import { beforeEach, describe, expect, it } from 'vitest'
import { oeffneDb, type Db } from '../src/db.js'
import { KonsoleMail } from '../src/mail.js'
import { findePlatzhalter, rendereMail, setzeWerteEin, type MailBausteine } from '../src/maillayout.js'
import {
  beispielWerte,
  istVorlagenSchluessel,
  MailVorlagenDienst,
  pruefeBausteine,
  VORLAGEN,
  vorlage,
  weichtAb,
} from '../src/mailvorlagen.js'

const BASIS = 'https://maptale.test'
const LINK = 'https://maptale.test/anmelden#verify=abc'

const bausteine = (patch: Partial<MailBausteine> = {}): MailBausteine => ({
  betreff: 'Hallo {{name}}',
  titel: 'Willkommen',
  text: 'Hallo {{name}},\n\nschön, dass du da bist.',
  knopf: 'Los geht’s',
  fuss: 'Der Link gilt 24 Stunden.',
  ...patch,
})

describe('Platzhalter', () => {
  it('setzt bekannte Werte ein und lässt unbekannte stehen', () => {
    expect(setzeWerteEin('Hallo {{name}}, Code {{code}}', { name: 'Mira' })).toBe('Hallo Mira, Code {{code}}')
  })

  it('findet jeden Platzhalter genau einmal', () => {
    expect(findePlatzhalter('{{a}} {{ b }} {{a}}')).toEqual(['a', 'b'])
  })
})

describe('Mail-Layout', () => {
  it('rendert Betreff, Text und HTML aus denselben Bausteinen', () => {
    const mail = rendereMail(bausteine(), { name: 'Mira' }, { basisUrl: BASIS, link: LINK })
    expect(mail.betreff).toBe('Hallo Mira')
    expect(mail.text).toContain('Hallo Mira,')
    expect(mail.html).toContain('Hallo Mira,')
    // Der Titel steht in beiden Fassungen — im HTML als Überschrift.
    expect(mail.text.startsWith('Willkommen')).toBe(true)
    expect(mail.html).toContain('<h1')
  })

  it('legt den Knopf-Link in die Text-Fassung, auf eine eigene Zeile', () => {
    const mail = rendereMail(bausteine(), { name: 'Mira' }, { basisUrl: BASIS, link: LINK })
    // Auf eigener Zeile, damit ein selbst verlinkendes Mail-Programm nicht am
    // nächsten Satzzeichen abschneidet.
    expect(mail.text).toContain(`Los geht’s:\n${LINK}`)
    expect(mail.html).toContain(`href="${LINK}"`)
  })

  it('nennt den Link als erste Adresse im Text — daran hängt jeder Bestätigungsfluss', () => {
    const mail = rendereMail(bausteine(), { name: 'Mira' }, { basisUrl: BASIS, link: LINK })
    expect(mail.text.match(/https?:\/\/\S+/)?.[0]).toBe(LINK)
  })

  it('zeichnet keinen Knopf, wenn die Beschriftung leer ist', () => {
    const mail = rendereMail(
      bausteine({ knopf: '', text: 'Hier entlang:\n\n{{link}}' }),
      { name: 'Mira', link: LINK },
      { basisUrl: BASIS, link: LINK },
    )
    expect(mail.html).not.toContain('border-radius:999px')
    // Über den Platzhalter kommt er trotzdem an — als anklickbare Adresse.
    expect(mail.html).toContain(`<a href="${LINK}"`)
  })

  it('macht aus einem Absatz, der nur der Code ist, eine hervorgehobene Box', () => {
    const mail = rendereMail(
      bausteine({ text: 'Dein Code:\n\n{{code}}\n\nBis gleich.' }),
      { code: 'MAPT-4F7K' },
      { basisUrl: BASIS, link: LINK },
    )
    expect(mail.html).toContain('letter-spacing:0.12em')
    expect(mail.html).toContain('MAPT-4F7K')
    expect(mail.text).toContain('MAPT-4F7K')
  })

  it('escapt eingesetzte Werte — ein Name ist kein Markup', () => {
    const mail = rendereMail(bausteine(), { name: '<script>böse</script>' }, { basisUrl: BASIS, link: LINK })
    expect(mail.html).not.toContain('<script>böse')
    expect(mail.html).toContain('&lt;script&gt;')
  })

  it('trägt Logo, Wortmarke als Alt-Text und die Pflichtlinks der Fußzeile', () => {
    const mail = rendereMail(bausteine(), { name: 'Mira' }, { basisUrl: `${BASIS}/`, link: LINK })
    expect(mail.html).toContain(`${BASIS}/branding/mail-logo.png`)
    expect(mail.html).toContain('alt="Maptale"')
    expect(mail.html).toContain(`${BASIS}/impressum`)
    expect(mail.html).toContain(`${BASIS}/datenschutz`)
    // Der Schrägstrich am Ende der Basis-URL darf sich nicht verdoppeln.
    expect(mail.html).not.toContain(`${BASIS}//`)
  })

  it('trennt Absätze an Leerzeilen und behält einfache Umbrüche', () => {
    const mail = rendereMail(bausteine({ text: 'Eins\nzwei\n\nDrei' }), {}, { basisUrl: BASIS, link: LINK })
    expect(mail.html).toContain('Eins<br />zwei')
    expect((mail.html.match(/<p style="margin:0 0 16px/g) ?? []).length).toBe(2)
  })
})

describe('Vorlagen-Katalog', () => {
  it('kennt sechs System-Mails, jede mit Standardtext und Platzhaltern', () => {
    expect(VORLAGEN.map((v) => v.schluessel)).toEqual([
      'verifikation',
      'reset',
      'email-wechsel',
      'warteliste',
      'warteliste-einladung',
      'export',
    ])
    for (const v of VORLAGEN) {
      expect(v.standard.betreff, v.schluessel).toBeTruthy()
      expect(v.standard.titel, v.schluessel).toBeTruthy()
      expect(v.platzhalter.length, v.schluessel).toBeGreaterThan(0)
    }
  })

  it('hält jeden Standardtext für versandfähig', () => {
    for (const v of VORLAGEN) expect(pruefeBausteine(v, v.standard), v.schluessel).toEqual([])
  })

  it('erkennt fremde Schlüssel', () => {
    expect(istVorlagenSchluessel('reset')).toBe(true)
    expect(istVorlagenSchluessel('rechnung')).toBe(false)
    expect(() => vorlage('rechnung' as 'reset')).toThrow()
  })

  it('rendert jeden Standard mit seinen Beispielwerten ohne offenen Platzhalter', () => {
    for (const v of VORLAGEN) {
      const werte = beispielWerte(v)
      const mail = rendereMail(v.standard, werte, { basisUrl: BASIS, link: werte.link ?? BASIS })
      expect(mail.text, v.schluessel).not.toMatch(/\{\{/)
      expect(mail.html, v.schluessel).not.toMatch(/\{\{/)
    }
  })
})

describe('Vorlagen prüfen', () => {
  const eintrag = vorlage('verifikation')

  it('lehnt leere Pflichtfelder ab', () => {
    const probleme = pruefeBausteine(eintrag, bausteine({ betreff: ' ', titel: '', text: '' }))
    expect(probleme).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Betreff'),
        expect.stringContaining('Überschrift'),
        expect.stringContaining('Text'),
      ]),
    )
  })

  it('meldet einen Platzhalter, den es in dieser Mail nicht gibt', () => {
    const probleme = pruefeBausteine(eintrag, { ...eintrag.standard, text: 'Hallo {{name}}, {{rechnung}}' })
    expect(probleme.join(' ')).toContain('{{rechnung}}')
  })

  it('verlangt den Link im Text, sobald der Knopf leer ist', () => {
    const ohneKnopf = { ...eintrag.standard, knopf: '' }
    expect(pruefeBausteine(eintrag, ohneKnopf).join(' ')).toContain('{{link}}')
    expect(pruefeBausteine(eintrag, { ...ohneKnopf, text: 'Hallo {{name}}, hier entlang: {{link}}' })).toEqual([])
  })

  it('meldet jede andere fehlende Angabe', () => {
    expect(pruefeBausteine(eintrag, { ...eintrag.standard, text: 'Ganz ohne Anrede.' })).toContain(
      '{{name}} fehlt, diese Angabe geht sonst verloren.',
    )
  })
})

describe('MailVorlagenDienst', () => {
  let db: Db
  let dienst: MailVorlagenDienst

  beforeEach(() => {
    db = oeffneDb(':memory:')
    dienst = new MailVorlagenDienst(db)
  })

  it('liefert ohne Anpassung den Text aus dem Code', () => {
    expect(dienst.bausteine('reset')).toEqual(vorlage('reset').standard)
    expect(dienst.alle().every((v) => !v.angepasst)).toBe(true)
  })

  it('speichert eine Anpassung und meldet sie in der Liste', () => {
    dienst.setze('reset', { ...vorlage('reset').standard, titel: 'Neues Kennwort' }, null)
    expect(dienst.bausteine('reset').titel).toBe('Neues Kennwort')
    const stand = dienst.alle().find((v) => v.schluessel === 'reset')
    expect(stand?.angepasst).toBe(true)
    expect(stand?.geaendertAm).toBeTruthy()
    // Der Standard bleibt daneben sichtbar — sonst wüsste niemand, wovon die
    // Fassung abweicht.
    expect(stand?.standard).toEqual(vorlage('reset').standard)
  })

  it('behandelt das Speichern des unveränderten Standards als Zurücksetzen', () => {
    dienst.setze('reset', { ...vorlage('reset').standard, titel: 'Anders' }, null)
    dienst.setze('reset', vorlage('reset').standard, null)
    expect(dienst.alle().find((v) => v.schluessel === 'reset')?.angepasst).toBe(false)
  })

  it('setzt zurück und hängt die Vorlage wieder an den Code', () => {
    dienst.setze('verifikation', { ...vorlage('verifikation').standard, betreff: 'Anders' }, null)
    expect(dienst.setzeZurueck('verifikation')).toBe(true)
    expect(dienst.bausteine('verifikation')).toEqual(vorlage('verifikation').standard)
    expect(dienst.setzeZurueck('verifikation')).toBe(false)
  })

  it('rendert über den Dienst mit der angepassten Fassung', () => {
    dienst.setze('verifikation', { ...vorlage('verifikation').standard, titel: 'Servus' }, null)
    const mail = dienst.rendere('verifikation', { name: 'Mira' }, { basisUrl: BASIS, link: LINK })
    expect(mail.html).toContain('Servus')
    expect(mail.text.startsWith('Servus')).toBe(true)
  })

  it('vergleicht Fassungen ohne Randleerraum', () => {
    const a = vorlage('reset').standard
    expect(weichtAb(a, { ...a, titel: `  ${a.titel}  ` })).toBe(false)
    expect(weichtAb(a, { ...a, titel: 'anders' })).toBe(true)
  })
})

describe('KonsoleMail', () => {
  it('schreibt Empfänger, Betreff und Text ins Log statt zu versenden', async () => {
    const zeilen: string[] = []
    const mail = new KonsoleMail((z) => zeilen.push(z))
    await mail.sende({ an: 'a@b.de', betreff: 'Hallo', text: 'Zeile 1\nZeile 2' })
    const ausgabe = zeilen.join('\n')
    expect(ausgabe).toContain('a@b.de')
    expect(ausgabe).toContain('Hallo')
    expect(ausgabe).toContain('Zeile 2')
  })
})
