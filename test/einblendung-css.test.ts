// Die Foto-Karte gibt es dreimal — als Bühne im Player (`.photo-card` in
// src/style.css), als Vorschau im Editor (`.foto-einblendung` in studio.html)
// und als Canvas-Nachbau im Video-Export (`zeichneFotoKarte` in
// src/exportfilm.ts). Dass es DREI sind und nicht zwei, war der erste Entwurf
// des Konzepts zu eng gefasst.
//
// Die getrennte Mechanik von Player und Editor ist Absicht (E8, Konzept §6A):
// Der Player streamt einen Film voraus, der Editor springt in einer Datei
// umher — ein gemeinsames DOM-Bauteil müsste beide Zeitmodelle tragen.
//
// **Aber „andere Mechanik" heißt nicht „andere Zahlen".** Dieser Wächter prüfte
// bis zum 2026-08-17 nur die ZEITEN und sagte ausdrücklich, die Optik dürfe
// verschieden sein. Das stimmte für Schatten, Polsterung und Kartengröße — und
// es ließ acht Werte durch, die niemand je verschieden gemeint hat:
// Ken-Burns-Ende, Entwickeln-Ende, Auftritts- und Ruhewinkel, zwei
// Rückfalldauern, den Ruhewert bei abgeschaltetem Ken Burns, den Kamerablitz
// und den Schleier. Zwei davon waren Rückfallwerte, die nur greifen, wenn die
// Custom Property fehlt: Dort sieht man den Unterschied nie als Bruch, sondern
// als leicht anderen Film.
//
// Seither hält er beide Blätter gegen `KARTE` in src/einblendung.ts. Was dort
// nicht steht, darf weiter frei sein; was verschieden sein DARF, steht als
// benannte Bühnen-Variante in `KARTE_BUEHNE` und wird als solche geprüft.
//
// Der Export ist in dieser Etappe der dritte VERGLEICHSPUNKT und bekommt noch
// keinen Maler (Konzept, Etappe 2). Geprüft wird deshalb zweierlei: die zwei
// Zahlen, die er heute schon teilt, und dass seine bekannten Abweichungen
// (`KARTE_EXPORT_ABWEICHUNGEN`) noch genau so dastehen — die Liste muss
// schrumpfen, wenn der Nachbau verschwindet.
//
// Analog zu test/basis-css.test.ts (DESIGN.md ↔ basis.css).

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  HOLD_AUSBLEND,
  KARTE,
  KARTE_BUEHNE,
  KARTE_EXPORT_ABWEICHUNGEN,
} from '../src/einblendung.js'

const playerCss = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8')
const studioHtml = readFileSync(new URL('../studio.html', import.meta.url), 'utf8')
const exportTs = readFileSync(new URL('../src/exportfilm.ts', import.meta.url), 'utf8')

/** Den Rumpf einer flachen Regel holen — bis zur ersten schließenden Klammer. */
function regel(quelle: string, selektor: string): string {
  const start = quelle.indexOf(selektor + ' {')
  expect(start, `Regel ${selektor} nicht gefunden`).toBeGreaterThan(-1)
  const ende = quelle.indexOf('}', start)
  return quelle.slice(start, ende)
}

/**
 * Ein geschachtelter Block (`@keyframes`, `@media`) mit gezählten Klammern.
 *
 * `regel` kann das nicht: Sie endet an der ersten `}`, und die schließt in
 * einem Keyframe nur die erste Stufe.
 */
function block(quelle: string, kopf: string, ab = 0): string {
  const start = quelle.indexOf(kopf, ab)
  expect(start, `Block ${kopf} nicht gefunden`).toBeGreaterThan(-1)
  const auf = quelle.indexOf('{', start)
  let tiefe = 0
  for (let i = auf; i < quelle.length; i++) {
    if (quelle[i] === '{') tiefe++
    else if (quelle[i] === '}' && --tiefe === 0) return quelle.slice(auf + 1, i)
  }
  throw new Error(`Block ${kopf} nicht geschlossen`)
}

/** Eine Stufe eines Keyframes (`from`, `to`, `10%`). */
function stufe(keyframes: string, name: string): string {
  const re = new RegExp(`(?:^|[;{}\\s])${name.replace('%', '%')}\\s*\\{([^}]*)\\}`)
  const m = re.exec(keyframes)
  expect(m, `Stufe ${name} nicht gefunden in: ${keyframes.slice(0, 120)}`).not.toBeNull()
  return (m as RegExpExecArray)[1] as string
}

/**
 * Der Reduce-Block, der die Karte betrifft — beide Dateien haben mehrere.
 * Gesucht wird der, in dem das Kartenbild vorkommt.
 */
function reduceBlock(quelle: string, marker: string): string {
  const kopf = '@media (prefers-reduced-motion: reduce)'
  for (let ab = 0; ; ) {
    const i = quelle.indexOf(kopf, ab)
    expect(i, `Reduce-Block mit ${marker} nicht gefunden`).toBeGreaterThan(-1)
    const rumpf = block(quelle, kopf, i)
    if (rumpf.includes(marker)) return rumpf
    ab = i + kopf.length
  }
}

/** Ein Funktionsteil eines `transform` — `scale(1.12)` → `1.12`. */
function teil(text: string, fn: string): string {
  const m = new RegExp(`(?<![\\w-])${fn}\\(([^)]*)\\)`).exec(text)
  expect(m, `${fn}() nicht gefunden in: ${text.trim()}`).not.toBeNull()
  return ((m as RegExpExecArray)[1] as string).trim()
}

/** Der Wert einer Eigenschaft einer Regel, mit normierten Leerzeichen. */
function wert(rumpf: string, eigenschaft: string): string {
  const m = new RegExp(`(?<![\\w-])${eigenschaft}:\\s*([^;}]+)`).exec(rumpf)
  expect(m, `${eigenschaft} nicht gefunden in: ${rumpf.trim().slice(0, 120)}`).not.toBeNull()
  return ((m as RegExpExecArray)[1] as string).trim().replace(/\s+/g, ' ')
}

/** Die Filterkette der Tabelle als CSS-Text. */
function filterText(f: { brightness: number; contrast: number; saturate: number }): string {
  return `brightness(${f.brightness}) contrast(${f.contrast}) saturate(${f.saturate})`
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

  it('und diese Dauern stehen so in der Tabelle', () => {
    // Der Vergleich oben allein hielte auch zwei gleich falsche Blätter für
    // in Ordnung — die Zeiten sind geteilt, weil `kartenZeiten` für BEIDE
    // rechnet, und die Rechnung kennt nur die Zahlen aus einblendung.ts.
    // Ohne die `0s` aus `var(--karte-zeit, 0s)`: Die sind kein Versatz,
    // sondern der Rückfall für den einen Frame, bevor `synchronisiereKarte`
    // zum ersten Mal geschrieben hat.
    expect(zeiten(spieler).filter((z) => z !== 0)).toEqual([
      KARTE.blendeDauerS * 1000,
      KARTE.flugDauerS * 1000,
      HOLD_AUSBLEND * 1000,
      KARTE.blendeVersatzS * 1000,
    ])
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

  it('beide fliegen auf derselben Kurve herein', () => {
    expect(spieler).toContain(KARTE.flugKurve)
    expect(editor).toContain(KARTE.flugKurve)
  })
})

describe('Foto-Karte: Player und Editor teilen die WERTE', () => {
  it('Ken Burns läuft auf beiden Bühnen von derselben Größe HERAUS', () => {
    // Die Richtung ist die Bildsprache der Foto-Stopps; das Ende stand im
    // Player auf 1.01, im Editor auf 1.02. Gemeint ist 1.02 — der
    // Reduced-Motion-Block BEIDER Bühnen legt die stehende Karte seit jeher
    // auf genau diese Größe (s. u.).
    const kb = block(playerCss, '@keyframes kenburns')
    const feKb = block(studioHtml, '@keyframes feKenburns')
    for (const k of [kb, feKb]) {
      expect(teil(stufe(k, 'from'), 'scale')).toBe(String(KARTE.kenBurnsVon))
      expect(teil(stufe(k, 'to'), 'scale')).toBe(String(KARTE.kenBurnsBis))
    }
    expect(KARTE.kenBurnsBis).toBeLessThan(KARTE.kenBurnsVon)
  })

  it('die stehende Karte liegt überall auf dem ENDE des Zugs', () => {
    // Vier Stellen, an denen das Bild ohne Drift steht — und vor dem Umbau
    // drei verschiedene Zahlen: `none` (= 1.0) im Player, 1.04 im Editor,
    // 1.02 in beiden Reduce-Blöcken. Ein Bild, das ohne Ken Burns anders im
    // Rahmen sitzt als mit ihm, ist kein „ruhiges Foto", sondern ein anderer
    // Ausschnitt.
    const ruhe = `scale(${KARTE.ruheSkala})`
    expect(regel(playerCss, '.photo-card.in .photo-frame.kein-kb img:not(.video-standbild)')).toContain(ruhe)
    expect(regel(studioHtml, '.foto-einblendung.an.ruhig .fe-frame img')).toContain(ruhe)
    expect(reduceBlock(playerCss, '.photo-card')).toContain(ruhe)
    expect(reduceBlock(studioHtml, '.foto-einblendung')).toContain(ruhe)
    expect(KARTE.ruheSkala).toBe(KARTE.kenBurnsBis)
  })

  it('die Rückfalldauer des Zugs ist auf beiden Bühnen die Klip-Länge', () => {
    // Rückfallwerte greifen nur, wenn die Custom Property fehlt — 7s gegen 6s
    // sah man deshalb nie als Bruch, sondern als leicht anderen Film.
    const s = `${KARTE.kbDauerRueckfallS}s`
    expect(regel(playerCss, '.photo-card.in .photo-frame img:not(.video-standbild)')).toContain(`var(--kb-dauer, ${s})`)
    expect(regel(studioHtml, '.foto-einblendung.an .fe-frame img')).toContain(`var(--fe-kb-dauer, ${s})`)
  })

  it('das „Entwickeln" beginnt und endet auf beiden Bühnen gleich', () => {
    // Das Ende ist nicht neutral: Der Player behält einen minimalen
    // Druck-Look, der Editor stand auf `filter: none` und zeigte dasselbe
    // Foto dauerhaft eine Spur flacher.
    const dev = block(playerCss, '@keyframes develop')
    const feDev = block(studioHtml, '@keyframes feEntwickeln')
    for (const k of [dev, feDev]) {
      expect(wert(stufe(k, 'from'), 'filter')).toBe(filterText(KARTE.entwickelnVon))
      expect(wert(stufe(k, 'to'), 'filter')).toBe(filterText(KARTE.entwickelnBis))
    }
    // Im Player ist das Ende zugleich der Grundzustand des Bildes — läuft das
    // auseinander, springt das Foto in dem Bild, in dem die Animation endet.
    expect(wert(regel(playerCss, '.photo-frame img:not(.video-standbild)'), 'filter')).toBe(
      filterText(KARTE.entwickelnBis),
    )
  })

  it('Auftritt und Ruhelage haben dieselben Winkel — nur die Flugweite nicht', () => {
    const flug = block(playerCss, '@keyframes karteFlug')
    const feFlug = block(studioHtml, '@keyframes feEinFlug')
    for (const [k, hub] of [
      [flug, KARTE_BUEHNE.flugHubPx.player],
      [feFlug, KARTE_BUEHNE.flugHubPx.editor],
    ] as const) {
      const von = stufe(k, 'from')
      expect(teil(von, 'scale')).toBe(String(KARTE.flugSkala))
      expect(teil(von, 'rotate')).toBe(`${KARTE.flugDrehungGrad}deg`)
      expect(teil(von, 'rotateX')).toBe(`${KARTE.flugKippungGrad}deg`)
      expect(teil(von, 'translateY')).toBe(`${hub}px`)
      expect(teil(stufe(k, 'to'), 'rotate')).toBe(`${KARTE.ruheDrehungGrad}deg`)
    }
    // Die Flugweite ist die eine benannte Variante — steht sie irgendwann
    // gleich, ist nicht der Test kaputt, sondern die Begründung hinfällig.
    expect(KARTE_BUEHNE.flugHubPx.player).not.toBe(KARTE_BUEHNE.flugHubPx.editor)
  })

  it('der Ruhezustand der Karte steht auch außerhalb der Keyframes richtig', () => {
    // Beide Bühnen setzen den Auftrittszustand zusätzlich als Grundwert der
    // Karte — sonst stünde sie einen Frame lang woanders, bevor die pausierte
    // Animation greift.
    const p = wert(regel(playerCss, '.photo-card'), 'transform')
    expect(teil(p, 'translateY')).toBe(`${KARTE_BUEHNE.flugHubPx.player}px`)
    expect(teil(p, 'rotate')).toBe(`${KARTE.flugDrehungGrad}deg`)
    const e = wert(regel(studioHtml, '.foto-einblendung'), 'transform')
    expect(teil(e, 'translateY')).toBe(`${KARTE_BUEHNE.flugHubPx.editor}px`)
    expect(teil(e, 'rotate')).toBe(`${KARTE.flugDrehungGrad}deg`)
  })

  it('der Abgang nimmt auf beiden Bühnen denselben Weg', () => {
    for (const k of [
      block(playerCss, '@keyframes karteAbgang'),
      block(studioHtml, '@keyframes feAbgang'),
    ]) {
      const bis = stufe(k, 'to')
      expect(teil(bis, 'translateY')).toBe(`${KARTE.abgangHubPx}px`)
      expect(teil(bis, 'scale')).toBe(String(KARTE.abgangSkala))
      expect(teil(bis, 'rotate')).toBe(`${KARTE.abgangDrehungGrad}deg`)
      expect(teil(stufe(k, 'from'), 'rotate')).toBe(`${KARTE.ruheDrehungGrad}deg`)
    }
  })

  it('der Kamerablitz ist auf beiden Bühnen derselbe', () => {
    expect(zeiten(regel(playerCss, '.photo-flash.on'))).toContain(KARTE.blitzDauerS * 1000)
    expect(zeiten(regel(studioHtml, '.foto-flash.blitz'))).toContain(KARTE.blitzDauerS * 1000)

    const spitze = `${KARTE.blitzSpitzeBei * 100}%`
    for (const k of [block(playerCss, '@keyframes flash'), block(studioHtml, '@keyframes fotoBlitz')]) {
      expect(wert(stufe(k, spitze), 'opacity')).toBe(String(KARTE.blitzSpitze))
      expect(wert(stufe(k, '0%'), 'opacity')).toBe('0')
      expect(wert(stufe(k, '100%'), 'opacity')).toBe('0')
    }

    // Mitte und die beiden Deckkräfte des Verlaufs — der Editor lag um ein
    // Prozent und um 0,05 daneben, also genau in der Größenordnung, in der
    // man einen Unterschied für Absicht hält.
    const mitte = `circle at ${KARTE.blitzMitteX * 100}% ${KARTE.blitzMitteY * 100}%`
    for (const [q, sel] of [
      [playerCss, '.photo-flash'],
      [studioHtml, '.foto-flash'],
    ] as const) {
      const g = wert(regel(q, sel), 'background')
      expect(g).toContain(mitte)
      expect(g).toContain(`, ${KARTE.blitzInnen}) 0%`)
      expect(g).toContain(`, ${KARTE.blitzAussen}) 42%`)
    }
  })

  it('der Schleier hinter der Karte ist auf beiden Bühnen derselbe', () => {
    // Er bleibt eine DOM-Schicht mit `backdrop-filter` (Konzept §4) — auf
    // einer Leinwand hat der kein Gegenstück. Der Editor stand auf mehr
    // Schwarz und weniger Blur: genau die Richtung, die im Player einmal
    // ausdrücklich zurückgenommen wurde.
    const filter = `blur(${KARTE.schleierBlurPx}px) saturate(${KARTE.schleierSaturate}) brightness(${KARTE.schleierBrightness})`
    expect(wert(regel(playerCss, '.photo-backdrop'), 'background')).toBe(KARTE.schleierFarbe)
    expect(wert(regel(playerCss, '.photo-layer.show .photo-backdrop'), 'backdrop-filter')).toBe(filter)
    expect(wert(regel(studioHtml, '.karten-buehne::after'), 'background')).toBe(KARTE.schleierFarbe)
    expect(wert(regel(studioHtml, '.karten-buehne.foto-an::after'), 'backdrop-filter')).toBe(filter)
  })

  it('der Bildrahmen hat auf beiden Bühnen denselben Radius', () => {
    expect(wert(regel(playerCss, '.photo-frame'), 'border-radius')).toBe(`${KARTE.rahmenRadiusPx}px`)
    expect(wert(regel(studioHtml, '.fe-frame'), 'border-radius')).toBe(`${KARTE.rahmenRadiusPx}px`)
  })
})

describe('Video-Export: der dritte Vergleichspunkt', () => {
  // Der Export malt die Karte von Hand auf seine Komposition. Dieser Nachbau
  // verschwindet mit Etappe 2 des Konzepts; ihn jetzt Zahl für Zahl
  // nachzuziehen hieße, Code zu pflegen, der gelöscht wird.

  it('teilt die Zeiten, die er heute schon rechnet', () => {
    // Deckkraft-Auftritt und Ausblend-Rückfall stehen als nackte Zahlen in
    // `kartenSicht` bzw. `zeichneFotoKarte`. Sie stimmen — und genau deshalb
    // gehören sie bewacht: Sie sind das Einzige, was der Export heute mit der
    // Tabelle gemeinsam hat.
    expect(exportTs).toContain(`imS / ${KARTE.blendeDauerS}`)
    expect(exportTs).toContain(`'--karte-aus-dauer') || ${HOLD_AUSBLEND}`)
  })

  it('die bekannten Abweichungen stehen noch genau so da', () => {
    // Der Sinn dieser Prüfung ist, dass die Liste SCHRUMPFT: Wer eine
    // Abweichung behebt oder den Nachbau entfernt, muss die Zeile in
    // `KARTE_EXPORT_ABWEICHUNGEN` streichen. Ohne das beschriebe die Liste
    // nach Etappe 2 Code, den es nicht mehr gibt — und niemand merkte es.
    for (const a of KARTE_EXPORT_ABWEICHUNGEN) {
      expect(exportTs, `nicht mehr im Export: ${a.was}`).toContain(a.spur)
    }
  })

  it('und jede Abweichung sagt, wie es stattdessen sein soll', () => {
    for (const a of KARTE_EXPORT_ABWEICHUNGEN) {
      expect(a.was.length, 'leere Begründung').toBeGreaterThan(20)
      expect(a.soll.length, 'kein Sollzustand').toBeGreaterThan(5)
    }
  })
})
