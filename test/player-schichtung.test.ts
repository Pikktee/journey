// Die Bedienung liegt ÜBER dem Bild (E17).
//
// Das ist keine Kosmetik, sondern die Ordnung, die jeder Videoplayer hat: Das
// Bild ist der Inhalt, die Steuerung liegt darauf. Vorher war es umgekehrt
// (`.photo-layer` 25 gegen `.dock` 20) — und das trug nur, solange `beginScrub`
// die Karte wegräumte. Seit sie beim Scrubben liegen bleibt (E15), muss die
// Leiste erreichbar sein, WÄHREND sie liegt.
//
// Ein Wächter und kein Kommentar, weil die Zahlen weit auseinander stehen: Wer
// die Foto-Schicht anfasst, sieht die Steuerleiste 500 Zeilen später nicht.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8')

/** `z-index` der ERSTEN Regel eines Selektors (spätere sind Varianten). */
function zIndex(selektor: string): number {
  const regel = new RegExp(`^${selektor.replace(/[.]/g, '\\.')}\\s*\\{([^}]*)\\}`, 'm')
  const treffer = regel.exec(css)
  expect(treffer, `${selektor} steht nicht als eigene Regel in style.css`).not.toBeNull()
  const z = /z-index:\s*(-?\d+)/.exec(treffer![1]!)
  expect(z, `${selektor} hat keinen z-index`).not.toBeNull()
  return Number(z![1])
}

describe('Schichtung der Player-Bühne', () => {
  it('legt Steuerleiste und Weg zurück über Foto-Karte und Finale', () => {
    const bild = Math.max(zIndex('.karten-leinwand'), zIndex('.finale'))
    // Die Steuerleiste — der Griff, den man beim Scrubben braucht.
    expect(zIndex('.dock')).toBeGreaterThan(bild)
    // Oben links steht genau EIN Element: der Weg hinaus.
    expect(zIndex('.zurueck')).toBeGreaterThan(bild)
    // Die Pflicht-Attribution ist Bedienung, kein Bild.
    expect(zIndex('.karten-info')).toBeGreaterThan(bild)
  })

  it('hält den Startscreen über allem, was zur Fahrt gehört', () => {
    expect(zIndex('.intro')).toBeGreaterThan(zIndex('.dock'))
  })

  // Seit Etappe 2 der Kartenleinwand sind es DREI Schichten, wo eine war, und
  // ihre Reihenfolge ist der ganze Umbau: Schleier (DOM, weil `backdrop-filter`
  // auf einer Leinwand kein Gegenstück hat), darüber das Bild (Leinwand),
  // darüber die Bedienung (DOM, weil Knöpfe im Film nichts zu suchen haben).
  // Vertauscht man die oberen zwei, ist die Karte über ihren eigenen Knöpfen.
  it('stapelt Schleier, Bild und Bedienung in dieser Reihenfolge', () => {
    expect(zIndex('.photo-backdrop')).toBeLessThan(zIndex('.karten-leinwand'))
    expect(zIndex('.karten-leinwand')).toBeLessThan(zIndex('.photo-layer'))
    // Und die Bedienung der Karte bleibt unter der Steuerleiste: Wer scrubbt,
    // greift die Leiste, auch wenn die Karte liegt (E17).
    expect(zIndex('.photo-layer')).toBeLessThan(zIndex('.dock'))
  })

  // Der Auto-Rückzug (body.ui-clean) räumt drei Elemente aus dem Bild. Alle drei
  // tragen `.reveal` aus dem Startscreen, und deren Animation läuft mit
  // `forwards` — ein Animations-Endwert schlägt in der Kaskade jede normale
  // Deklaration. Ohne `!important` blieb der Weg zurück als einziges Element
  // stehen, während sich alles andere zurückzog: monatelang unbemerkt, weil die
  // Regel dasteht und richtig aussieht.
  it('blendet ALLE drei Elemente des Rückzugs wirklich aus', () => {
    for (const sel of ['.zurueck', '.next-stop', '.dock']) {
      const regel = new RegExp(`body\\.ui-clean ${sel.replace('.', '\\.')}\\s*\\{([^}]*)\\}`, 'm')
      const treffer = regel.exec(css)
      expect(treffer, `body.ui-clean ${sel} fehlt in style.css`).not.toBeNull()
      expect(
        treffer![1],
        `body.ui-clean ${sel} braucht !important gegen die .reveal-Animation`,
      ).toMatch(/opacity:\s*0\s*!important/)
    }
  })

  // Der Stand der Karte hängt an der FILMZEIT und nicht an einer Wanduhr (E15).
  // Bis Etappe 2 stellte das CSS das mit dauerhaft pausierten Animationen und
  // einem negativen Delay nach; hier stand deshalb ein Wächter auf
  // `animation-play-state: paused`. Der Maler braucht den Kniff nicht — er
  // bekommt die Filmsekunde als Zahl. Geprüft wird das jetzt an der Rechnung
  // selbst (test/kartenmaler.test.ts, test/einblendung-css.test.ts), nicht mehr
  // an einer Zeichenkette im Blatt.
})
