// Mail-Bausteine (M9): Betreff/Text der System-Mails und der Dev-Versand.

import { describe, expect, it } from 'vitest'
import { baueResetMail, baueVerifikationsMail, KonsoleMail } from '../src/mail.js'

describe('Mail-Texte', () => {
  it('Bestätigungsmail enthält Namen und Link', () => {
    const { betreff, text } = baueVerifikationsMail('Mira', 'https://luhambo.app/studio.html#verify=abc')
    expect(betreff).toMatch(/bestätige/i)
    expect(text).toContain('Mira')
    expect(text).toContain('https://luhambo.app/studio.html#verify=abc')
  })

  it('Reset-Mail enthält Link und Gültigkeitshinweis', () => {
    const { betreff, text } = baueResetMail('du', 'https://luhambo.app/studio.html#reset=xyz')
    expect(betreff).toMatch(/Passwort/i)
    expect(text).toContain('#reset=xyz')
    expect(text).toMatch(/1 Stunde/)
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
