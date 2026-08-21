// Drift-Wächter: Der Satz, dem jemand zustimmt, muss überall derselbe sein.
//
// Die Historie (`newsletter_einwilligungen.textfassung`) protokolliert ein
// LABEL, nicht den Wortlaut — das ist nur dann ein Nachweis, wenn zum Label
// genau ein Text gehört und dieser Text auch der ist, der in der Oberfläche
// stand. Zwei Stellen können auseinanderlaufen: das Kästchen der Registrierung
// (`studio.html`) und die Zeile in den Kontoeinstellungen (`konto.html`).
//
// Gelesen wird als TEXT und nicht importiert: Der Server hat einen eigenen
// `rootDir`, der Browser-Code kommt an `server/src/newsletter.ts` nicht heran —
// dieselbe Lage wie bei den Web-Pfaden und der SFX-Bibliothek.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const lies = (datei: string): string =>
  readFileSync(new URL(`../${datei}`, import.meta.url), 'utf8')

/**
 * Die Sätze aus `CONSENT_TEXTS` — aus der Quelle gelesen statt
 * nachgeschrieben. Ein zweites Mal hingeschrieben wäre dieser Wächter genau die
 * Kopie, die er verhindern soll.
 */
function einwilligungstexte(): Record<string, { fassung: string; text: string }> {
  const quelle = lies('server/src/newsletter.ts')
  const block = /export const CONSENT_TEXTS = \{([\s\S]*?)\n\} as const/.exec(quelle)?.[1]
  expect(block, 'CONSENT_TEXTS in server/src/newsletter.ts nicht gefunden').toBeTruthy()
  const texte: Record<string, { fassung: string; text: string }> = {}
  for (const eintrag of (block as string).matchAll(
    /(\w+): \{\s*version: '([^']+)',\s*text:([\s\S]*?),\s*\},/g,
  )) {
    const [, name, fassung, rohText] = eintrag
    // Der Text steht als verkettete Zeichenkette („… ' + '…"); die
    // Verkettung interessiert hier nicht, nur ihr Ergebnis.
    const text = [...(rohText ?? '').matchAll(/'([^']*)'/g)].map((t) => t[1]).join('')
    texte[name as string] = { fassung: fassung as string, text }
  }
  return texte
}

/** Sichtbarer Text einer HTML-Datei, auf einer Zeile — für den Vergleich mit einem Satz. */
const sichtbar = (html: string): string =>
  html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')

describe('Newsletter-Einwilligung', () => {
  /**
   * Der SCHLÜSSEL ist Code und ging mit Welle 1 auf Englisch; das LABEL ist
   * Beweismaterial nach Art. 7 DSGVO und bleibt, wie es verschickt wurde
   * (§1 des Englisch-Konzepts). Deshalb hier eine Zuordnung statt eines
   * Musters aus dem Namen.
   */
  const LABEL_PRAEFIX = { signup: 'registrierung', account: 'konto' } as const

  const texte = einwilligungstexte()

  it('kennt beide Fassungen mit Label und Wortlaut', () => {
    expect(Object.keys(texte).sort()).toEqual(['account', 'signup'])
    for (const [name, eintrag] of Object.entries(texte)) {
      expect(eintrag.text.length, `${name} ohne Wortlaut`).toBeGreaterThan(30)
      // Das Label trägt sein Datum: Wer den Text ändert, ohne es zu heben,
      // behauptete eine Zustimmung zu einem Satz, den niemand gelesen hat.
      // Die laufende Nummer dahinter ist der zweite Wortlaut AM SELBEN TAG —
      // ohne sie müsste man auf den nächsten Tag warten oder das Datum fälschen.
      expect(eintrag.fassung).toMatch(
        new RegExp(
          `^${LABEL_PRAEFIX[name as keyof typeof LABEL_PRAEFIX]}-\\d{4}-\\d{2}-\\d{2}(-\\d+)?$`,
        ),
      )
    }
  })

  it('steht wortgleich im Kästchen der Registrierung', () => {
    expect(sichtbar(lies('studio.html'))).toContain(texte.signup?.text)
  })

  it('steht wortgleich in den Kontoeinstellungen', () => {
    expect(sichtbar(lies('konto.html'))).toContain(texte.account?.text)
  })

  it('ist in der Registrierung nicht vorangekreuzt', () => {
    const kaestchen = /<input id="reg-newsletter"[^>]*>/.exec(lies('studio.html'))?.[0] ?? ''
    expect(kaestchen, 'Kästchen der Registrierung nicht gefunden').toContain('type="checkbox"')
    // Ein vorbelegtes Kästchen ist seit dem Planet49-Urteil (EuGH C-673/17)
    // keine wirksame Einwilligung.
    expect(kaestchen).not.toMatch(/\bchecked\b/)
  })

  it('wird in der Datenschutzerklärung beschrieben — Zweck, Rechtsgrundlage, Widerruf', () => {
    const text = sichtbar(lies('datenschutz.html'))
    expect(text).toMatch(/newsletter/i)
    expect(text).toMatch(/Art\. 6 Abs\. 1 (lit\. a|Buchst\. a)/)
    expect(text).toMatch(/widerruf/i)
  })
})
