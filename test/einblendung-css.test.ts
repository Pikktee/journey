// Die Foto-Karte gibt es zweimal im DOM — als Bühne im Player
// (`.photo-card` in src/style.css) und als Vorschau im Editor
// (`.foto-einblendung` in studio.html). Das ist Absicht (E8, Konzept §6A): Die
// beiden teilen die Optik, aber nicht ihr Zeitmodell — der Player streamt einen
// Film voraus, der Editor springt in einer Datei umher. Ein gemeinsames
// DOM-Bauteil müsste beide tragen.
//
// **Was sie aber teilen MÜSSEN, sind die Zeiten.** Beide ziehen ihren
// Fortschritt aus einem negativen Delay auf dauerhaft pausierte Animationen,
// und beide rechnen ihn über dieselben Funktionen aus src/einblendung.ts
// (`kartenZeiten`, `klipDauerS`). Steht in einem der beiden Blätter eine andere
// Dauer, rechnet die gemeinsame Funktion für die eine Seite falsch — und zwar
// lautlos: Es sieht nur ein bisschen anders aus.
//
// Deshalb prüft dieser Wächter die ZEITEN und ausdrücklich nicht die Optik.
// Schatten, Rotation und Polsterung dürfen und sollen verschieden sein: Die
// Bühne liegt formatfüllend über der Karte, die Vorschau klebt an einem
// Wegpunkt. Ein Wächter, der auch die verlangte, meldete jede
// Gestaltungsentscheidung als Bruch — und wäre nach der dritten Meldung aus.
//
// Analog zu test/basis-css.test.ts (DESIGN.md ↔ basis.css).

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { HOLD_AUSBLEND } from '../src/einblendung.js'

const playerCss = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8')
const studioHtml = readFileSync(new URL('../studio.html', import.meta.url), 'utf8')

/** Den Rumpf einer Regel holen — bis zur ersten schließenden Klammer. */
function regel(quelle: string, selektor: string): string {
  const start = quelle.indexOf(selektor + ' {')
  expect(start, `Regel ${selektor} nicht gefunden`).toBeGreaterThan(-1)
  const ende = quelle.indexOf('}', start)
  return quelle.slice(start, ende)
}

/**
 * Eine Zeitangabe in Millisekunden — `0.5s` und `500ms` sind dieselbe Zahl.
 *
 * Genau darin liegt der Witz dieses Wächters: Die beiden Blätter schreiben
 * dieselben Werte in verschiedenen Einheiten. Ein Textvergleich fände hier
 * neun Unterschiede und keinen einzigen echten.
 */
function ms(wert: string): number {
  const m = /^(-?[\d.]+)(ms|s)$/.exec(wert.trim())
  expect(m, `keine Zeitangabe: ${wert}`).not.toBeNull()
  const zahl = Number((m as RegExpExecArray)[1])
  return (m as RegExpExecArray)[2] === 's' ? zahl * 1000 : zahl
}

/** Alle Zeitangaben einer Regel in Reihenfolge, in Millisekunden. */
function zeiten(rumpf: string): number[] {
  return [...rumpf.matchAll(/(?<![\w-])(-?[\d.]+m?s)(?![\w-])/g)].map((m) => ms(m[1] as string))
}

describe('Foto-Karte: Player und Editor teilen die Zeiten', () => {
  const spieler = regel(playerCss, '.photo-card.in')
  const editor = regel(studioHtml, '.foto-einblendung.an')

  it('beide Karten stehen dauerhaft auf `paused`', () => {
    // Das ist die Technik selbst: Ohne `paused` liefe die Animation nach
    // Wanduhr los und das negative Delay wäre wirkungslos — die Karte spränge
    // beim Scrubben sofort auf ihren Zielzustand (so war es vor E15).
    expect(spieler).toMatch(/animation-play-state:\s*paused/)
    expect(editor).toMatch(/animation-play-state:\s*paused/)
  })

  it('beide ziehen ihren Fortschritt aus einem negativen Delay', () => {
    expect(spieler).toMatch(/animation-delay:.*var\(--karte-zeit/)
    expect(editor).toMatch(/animation-delay:.*var\(--fe-zeit/)
  })

  it('führen dieselben drei Animationen in derselben Reihenfolge', () => {
    // Der Abgang steht ZULETZT und gewinnt dadurch, solange er läuft. Eine
    // andere Reihenfolge kehrte das um: Der Auftritt läge über dem Abgang.
    expect(spieler.match(/karte(Blende|Flug|Abgang)/g)).toEqual(['karteBlende', 'karteFlug', 'karteAbgang'])
    expect(editor.match(/fe(EinBlende|EinFlug|Abgang)/g)).toEqual(['feEinBlende', 'feEinFlug', 'feAbgang'])
  })

  it('nennen dieselben Dauern — in beliebiger Einheit', () => {
    // Blende, Flug, Ausblend-Rückfall, Blenden-Versatz.
    expect(zeiten(spieler)).toEqual(zeiten(editor))
  })

  it('der Abgang beider Karten ist HOLD_AUSBLEND lang', () => {
    // Der Rückfallwert im CSS ist ein Spiegel der Konstante, aus der
    // `kartenZeiten` die Ausblendung rechnet. Läuft er weg, blendet die Karte
    // über eine andere Dauer als die, für die der Klip Zeit vorsieht — sie
    // hinge am Ende des Halts noch halb im Bild.
    const erwartet = HOLD_AUSBLEND * 1000
    expect(zeiten(regel(playerCss, '.photo-card.in'))).toContain(erwartet)
    expect(zeiten(regel(studioHtml, '.foto-einblendung.an'))).toContain(erwartet)
  })
})
