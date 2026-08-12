// Der Stand-Chip hinter der Wortmarke: ein Wort, eine Quelle, überall gleich.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { STAND_PUNKTE, STAND_WORT, standChipHtml } from '../src/entwicklungsstand'
import { pfad } from '../src/routen'
import { appHeaderHtml } from '../src/app-nav'

const wurzel = join(dirname(fileURLToPath(import.meta.url)), '..')
const lies = (datei: string): string => readFileSync(join(wurzel, datei), 'utf8')

describe('Entwicklungsstand', () => {
  it('trägt das Wort aus einer Quelle in den Chip', () => {
    const chip = standChipHtml()
    expect(chip).toContain(`>${STAND_WORT}<`)
    // Anklickbar und als solches angekündigt: Das Kärtchen IST die Erklärung
    // des Wortes — ein reines <span> hätte niemanden dorthin geführt.
    expect(chip).toContain('aria-haspopup="dialog"')
    // Kleines Wort, keine Pille: Der Stand wird genannt, nicht beworben.
    expect(chip).toContain('class="stand-hinweis"')
    expect(chip).toMatch(/^<button type="button"/)
  })

  it('steht auch in der Landing, die ihre eigene Kopfleiste hat', () => {
    // Die vier Produkt-Seiten und die Verwaltung deckt der Vergleich gegen
    // appHeaderHtml in app-nav.test.ts ab. index.html kommt dort nicht vor —
    // sie baut ihre Nav selbst und wäre die eine Seite, auf der das
    // Kennzeichen still fehlen könnte.
    const landing = lies('index.html')
    expect(landing).toContain('class="stand-hinweis"')
    expect(landing).toContain(`>${STAND_WORT}</button>`)
    expect(landing).toContain('class="marken-gruppe"')
  })

  it('gestaltet Hinweis und Knopf STATISCH, nicht per JavaScript', () => {
    // Per JS eingehängtes CSS kommt nach dem Markup: Der Hinweis blitzte
    // dadurch bei jedem Laden ungestaltet neben der Wortmarke auf.
    const blatt = lies('src/grundelemente.css')
    expect(blatt).toContain('.stand-hinweis')
    expect(blatt).toContain('.feedback-knopf')
    expect(blatt).toContain('.marken-gruppe')
    // Die Landing lädt dieses Blatt nicht — sie führt dieselben Regeln selbst.
    const landing = lies('index.html')
    for (const regel of ['.stand-hinweis', '.feedback-knopf', '.marken-gruppe']) {
      expect(landing, regel).toContain(`${regel} {`)
    }
    // Im Modul darf nur noch die Optik des Kärtchens stehen, das erst auf
    // Klick entsteht.
    const modul = lies('src/entwicklungsstand.ts')
    expect(modul).not.toContain('.stand-hinweis {')
  })

  it('trennt Erklären vom Melden', () => {
    // Zwei Dinge, zwei Griffe: Der Hinweis erklärt einen Zustand, der Knopf ist
    // eine Handlung. Im Hinweis versteckt fände das Formular nur, wer erst auf
    // ein Wort klickt, das er zu kennen glaubt.
    const kopf = appHeaderHtml({ aktiv: 'galerie' })
    expect(kopf).toContain('class="stand-hinweis"')
    expect(kopf).toContain('class="feedback-knopf"')
    // Der Knopf steht NEBEN .nav-right, nicht darin: montiereNavRechts schreibt
    // dessen Inhalt neu, sobald /auth/me antwortet.
    expect(kopf.indexOf('feedback-knopf')).toBeLessThan(kopf.indexOf('nav-right'))
  })

  it('lässt den Player bewusst aus', () => {
    // Oben links steht dort genau EIN Element: der Weg hinaus (CLAUDE.md).
    // Ein Chip bräuchte eine Wortmarke, die der Player nicht mehr hat.
    expect(lies('erlebnis.html')).not.toContain('stand-hinweis')
  })

  it('sagt Risiko, Daten und Weg zurück in drei knappen Punkten', () => {
    const text = STAND_PUNKTE.map((p) => `${p.titel} ${p.text}`).join(' ')
    expect(text).toMatch(/Fehler/)
    expect(text).toMatch(/Originale/)
    // Der Gedankenstrich war im Kärtchen ausdrücklich unerwünscht; er schleicht
    // sich beim Umformulieren am ehesten wieder ein.
    expect(text).not.toContain('—')
    // Die Überschrift trägt die Aussage, der Satz die Begründung — beides kurz,
    // sonst wird das Kärtchen wieder zum Fließtext, den niemand liest.
    for (const punkt of STAND_PUNKTE) {
      expect(punkt.titel.length, punkt.titel).toBeLessThan(20)
      expect(punkt.text.length, punkt.text).toBeLessThan(60)
      // Jeder Punkt trägt ein Symbol, und zwar als Pfad ohne Füllung: Die
      // Karte färbt sie über `currentColor`.
      expect(punkt.symbol, punkt.titel).toMatch(/^<(path|rect|circle)/)
      expect(punkt.symbol).not.toContain('fill="')
    }
  })

  it('führt zum Formular statt zu einer Mail-Adresse', () => {
    // Die Rückmeldung soll auswertbar im Eingang landen, nicht im Postfach.
    const modul = lies('src/entwicklungsstand.ts')
    expect(modul).not.toContain('mailto:')
    // Melden ist eine eigene Handlung mit eigenem Knopf, nicht im Hinweis
    // versteckt — deshalb kennt der Hinweis das Formular gar nicht mehr.
    expect(modul).not.toContain('feedbackformular')
    expect(lies('src/feedbackknopf.ts')).toContain('feedbackformular')
    // Und dieselbe Maske steht unter einer eigenen Adresse: Die App öffnet sie
    // im WebView, und ein Link zum Weitergeben braucht einen Ort.
    expect(pfad('feedback')).toBe('/feedback')
    expect(lies('feedback.html')).toContain('montiereFeedbackFormular')
  })
})
