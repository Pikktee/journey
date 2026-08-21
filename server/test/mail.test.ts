// Mail-Bausteine: Layout (HTML + Text aus einer Quelle), Vorlagen-Katalog samt
// Prüfung und der Dev-Versand.

import { beforeEach, describe, expect, it } from 'vitest'
import { openDb, type Db } from '../src/db.js'
import { ConsoleMail } from '../src/mail.js'
import {
  findPlaceholders,
  renderMail,
  fillPlaceholders,
  type MailParts,
} from '../src/mail-layout.js'
import {
  exampleValues,
  isTemplateKey,
  MailTemplateService,
  validateParts,
  TEMPLATES,
  getTemplate,
  differs,
} from '../src/mail-templates.js'

const BASIS = 'https://maptale.test'
const LINK = 'https://maptale.test/anmelden#verify=abc'

const bausteine = (patch: Partial<MailParts> = {}): MailParts => ({
  subject: 'Hallo {{name}}',
  title: 'Willkommen',
  text: 'Hallo {{name}},\n\nschön, dass du da bist.',
  button: 'Los geht’s',
  footer: 'Der Link gilt 24 Stunden.',
  ...patch,
})

describe('Platzhalter', () => {
  it('setzt bekannte Werte ein und lässt unbekannte stehen', () => {
    expect(fillPlaceholders('Hallo {{name}}, Code {{code}}', { name: 'Mira' })).toBe(
      'Hallo Mira, Code {{code}}',
    )
  })

  it('findet jeden Platzhalter genau einmal', () => {
    expect(findPlaceholders('{{a}} {{ b }} {{a}}')).toEqual(['a', 'b'])
  })
})

describe('Mail-Layout', () => {
  it('rendert Betreff, Text und HTML aus denselben Bausteinen', () => {
    const mail = renderMail(bausteine(), { name: 'Mira' }, { webUrl: BASIS, link: LINK })
    expect(mail.subject).toBe('Hallo Mira')
    expect(mail.text).toContain('Hallo Mira,')
    expect(mail.html).toContain('Hallo Mira,')
    // Der Titel steht in beiden Fassungen — im HTML als Überschrift.
    expect(mail.text.startsWith('Willkommen')).toBe(true)
    expect(mail.html).toContain('<h1')
  })

  it('legt den Knopf-Link in die Text-Fassung, auf eine eigene Zeile', () => {
    const mail = renderMail(bausteine(), { name: 'Mira' }, { webUrl: BASIS, link: LINK })
    // Auf eigener Zeile, damit ein selbst verlinkendes Mail-Programm nicht am
    // nächsten Satzzeichen abschneidet.
    expect(mail.text).toContain(`Los geht’s:\n${LINK}`)
    expect(mail.html).toContain(`href="${LINK}"`)
  })

  it('nennt den Link als erste Adresse im Text — daran hängt jeder Bestätigungsfluss', () => {
    const mail = renderMail(bausteine(), { name: 'Mira' }, { webUrl: BASIS, link: LINK })
    expect(mail.text.match(/https?:\/\/\S+/)?.[0]).toBe(LINK)
  })

  it('zeichnet keinen Knopf, wenn die Beschriftung leer ist', () => {
    const mail = renderMail(
      bausteine({ button: '', text: 'Hier entlang:\n\n{{link}}' }),
      { name: 'Mira', link: LINK },
      { webUrl: BASIS, link: LINK },
    )
    expect(mail.html).not.toContain('border-radius:999px')
    // Über den Platzhalter kommt er trotzdem an — als anklickbare Adresse.
    expect(mail.html).toContain(`<a href="${LINK}"`)
  })

  it('macht aus einem Absatz, der nur der Code ist, eine hervorgehobene Box', () => {
    const mail = renderMail(
      bausteine({ text: 'Dein Code:\n\n{{code}}\n\nBis gleich.' }),
      { code: 'MAPT-4F7K' },
      { webUrl: BASIS, link: LINK },
    )
    expect(mail.html).toContain('letter-spacing:0.12em')
    expect(mail.html).toContain('MAPT-4F7K')
    expect(mail.text).toContain('MAPT-4F7K')
  })

  it('escapt eingesetzte Werte — ein Name ist kein Markup', () => {
    const mail = renderMail(
      bausteine(),
      { name: '<script>böse</script>' },
      { webUrl: BASIS, link: LINK },
    )
    expect(mail.html).not.toContain('<script>böse')
    expect(mail.html).toContain('&lt;script&gt;')
  })

  it('trägt Logo, Wortmarke als Alt-Text und die Pflichtlinks der Fußzeile', () => {
    const mail = renderMail(bausteine(), { name: 'Mira' }, { webUrl: `${BASIS}/`, link: LINK })
    expect(mail.html).toContain(`${BASIS}/branding/mail-logo.png`)
    expect(mail.html).toContain('alt="Maptale"')
    expect(mail.html).toContain(`${BASIS}/impressum`)
    expect(mail.html).toContain(`${BASIS}/datenschutz`)
    // Der Schrägstrich am Ende der Basis-URL darf sich nicht verdoppeln.
    expect(mail.html).not.toContain(`${BASIS}//`)
  })

  it('trennt Absätze an Leerzeilen und behält einfache Umbrüche', () => {
    const mail = renderMail(
      bausteine({ text: 'Eins\nzwei\n\nDrei' }),
      {},
      { webUrl: BASIS, link: LINK },
    )
    expect(mail.html).toContain('Eins<br />zwei')
    expect((mail.html.match(/<p style="margin:0 0 16px/g) ?? []).length).toBe(2)
  })
})

describe('Vorlagen-Katalog', () => {
  it('kennt sechs System-Mails, jede mit Standardtext und Platzhaltern', () => {
    expect(TEMPLATES.map((v) => v.key)).toEqual([
      'verification',
      'reset',
      'email-change',
      'waitlist',
      'waitlist-invitation',
      'export',
    ])
    for (const v of TEMPLATES) {
      expect(v.defaultContent.subject, v.key).toBeTruthy()
      expect(v.defaultContent.title, v.key).toBeTruthy()
      expect(v.placeholders.length, v.key).toBeGreaterThan(0)
    }
  })

  it('hält jeden Standardtext für versandfähig', () => {
    for (const v of TEMPLATES) expect(validateParts(v, v.defaultContent), v.key).toEqual([])
  })

  it('erkennt fremde Schlüssel', () => {
    expect(isTemplateKey('reset')).toBe(true)
    expect(isTemplateKey('rechnung')).toBe(false)
    expect(() => getTemplate('rechnung' as 'reset')).toThrow()
  })

  it('rendert jeden Standard mit seinen Beispielwerten ohne offenen Platzhalter', () => {
    for (const v of TEMPLATES) {
      const werte = exampleValues(v)
      const mail = renderMail(v.defaultContent, werte, {
        webUrl: BASIS,
        link: werte.link ?? BASIS,
      })
      expect(mail.text, v.key).not.toMatch(/\{\{/)
      expect(mail.html, v.key).not.toMatch(/\{\{/)
    }
  })
})

describe('Vorlagen prüfen', () => {
  const eintrag = getTemplate('verification')

  it('lehnt leere Pflichtfelder ab', () => {
    const probleme = validateParts(eintrag, bausteine({ subject: ' ', title: '', text: '' }))
    expect(probleme).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Betreff'),
        expect.stringContaining('Überschrift'),
        expect.stringContaining('Text'),
      ]),
    )
  })

  it('meldet einen Platzhalter, den es in dieser Mail nicht gibt', () => {
    const probleme = validateParts(eintrag, {
      ...eintrag.defaultContent,
      text: 'Hallo {{name}}, {{rechnung}}',
    })
    expect(probleme.join(' ')).toContain('{{rechnung}}')
  })

  it('verlangt den Link im Text, sobald der Knopf leer ist', () => {
    const ohneKnopf = { ...eintrag.defaultContent, button: '' }
    expect(validateParts(eintrag, ohneKnopf).join(' ')).toContain('{{link}}')
    expect(
      validateParts(eintrag, { ...ohneKnopf, text: 'Hallo {{name}}, hier entlang: {{link}}' }),
    ).toEqual([])
  })

  it('meldet jede andere fehlende Angabe', () => {
    expect(
      validateParts(eintrag, { ...eintrag.defaultContent, text: 'Ganz ohne Anrede.' }),
    ).toContain('{{name}} fehlt, diese Angabe geht sonst verloren.')
  })
})

describe('MailVorlagenDienst', () => {
  let db: Db
  let dienst: MailTemplateService

  beforeEach(() => {
    db = openDb(':memory:')
    dienst = new MailTemplateService(db)
  })

  it('liefert ohne Anpassung den Text aus dem Code', () => {
    expect(dienst.blocks2('reset')).toEqual(getTemplate('reset').defaultContent)
    expect(dienst.all().every((v) => !v.customized)).toBe(true)
  })

  it('speichert eine Anpassung und meldet sie in der Liste', () => {
    dienst.set('reset', { ...getTemplate('reset').defaultContent, title: 'Neues Kennwort' }, null)
    expect(dienst.blocks2('reset').title).toBe('Neues Kennwort')
    const stand = dienst.all().find((v) => v.key === 'reset')
    expect(stand?.customized).toBe(true)
    expect(stand?.updatedAt).toBeTruthy()
    // Der Standard bleibt daneben sichtbar — sonst wüsste niemand, wovon die
    // Fassung abweicht.
    expect(stand?.defaultContent).toEqual(getTemplate('reset').defaultContent)
  })

  it('behandelt das Speichern des unveränderten Standards als Zurücksetzen', () => {
    dienst.set('reset', { ...getTemplate('reset').defaultContent, title: 'Anders' }, null)
    dienst.set('reset', getTemplate('reset').defaultContent, null)
    expect(dienst.all().find((v) => v.key === 'reset')?.customized).toBe(false)
  })

  it('setzt zurück und hängt die Vorlage wieder an den Code', () => {
    dienst.set(
      'verification',
      { ...getTemplate('verification').defaultContent, subject: 'Anders' },
      null,
    )
    expect(dienst.reset('verification')).toBe(true)
    expect(dienst.blocks2('verification')).toEqual(getTemplate('verification').defaultContent)
    expect(dienst.reset('verification')).toBe(false)
  })

  it('rendert über den Dienst mit der angepassten Fassung', () => {
    dienst.set(
      'verification',
      { ...getTemplate('verification').defaultContent, title: 'Servus' },
      null,
    )
    const mail = dienst.render('verification', { name: 'Mira' }, { webUrl: BASIS, link: LINK })
    expect(mail.html).toContain('Servus')
    expect(mail.text.startsWith('Servus')).toBe(true)
  })

  it('vergleicht Fassungen ohne Randleerraum', () => {
    const a = getTemplate('reset').defaultContent
    expect(differs(a, { ...a, title: `  ${a.title}  ` })).toBe(false)
    expect(differs(a, { ...a, title: 'anders' })).toBe(true)
  })
})

describe('KonsoleMail', () => {
  it('schreibt Empfänger, Betreff und Text ins Log statt zu versenden', async () => {
    const zeilen: string[] = []
    const mail = new ConsoleMail((z) => zeilen.push(z))
    await mail.send({ to2: 'a@b.de', subject: 'Hallo', text: 'Zeile 1\nZeile 2' })
    const ausgabe = zeilen.join('\n')
    expect(ausgabe).toContain('a@b.de')
    expect(ausgabe).toContain('Hallo')
    expect(ausgabe).toContain('Zeile 2')
  })
})
