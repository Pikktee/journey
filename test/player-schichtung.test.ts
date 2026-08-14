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
    const bild = Math.max(zIndex('.photo-layer'), zIndex('.finale'))
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

  // Der Auftritt der Karte hängt an der FILMZEIT, nicht an der Wanduhr: Die
  // Animationen stehen dauerhaft auf `paused`, ihr Fortschritt kommt aus dem
  // negativen Delay `--karte-zeit` (E15). Eine `transition` an derselben Stelle
  // wäre der Rückfall — sie startet beim Klassenwechsel und läuft für sich.
  it('fährt Auftritt, Ken Burns und Beschriftung als pausierte Animationen', () => {
    for (const selektor of ['.photo-card.in {', '.photo-card.in .photo-frame img:not(.video-standbild) {']) {
      const block = css.slice(css.indexOf(selektor))
      const regel = block.slice(0, block.indexOf('}'))
      expect(regel, `${selektor} muss pausiert laufen`).toContain('animation-play-state: paused')
      expect(regel, `${selektor} braucht den Stand aus --karte-zeit`).toContain('--karte-zeit')
    }
  })
})
