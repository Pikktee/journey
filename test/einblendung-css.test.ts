// Die Foto-Karte gibt es noch ZWEIMAL — als Leinwand im Player
// (`src/kartenmaler.ts`) und als DOM-Vorschau im Editor (`.foto-einblendung` in
// studio.html). Bis Etappe 2 der Kartenleinwand waren es drei: Der Video-Export
// malte sie ein drittes Mal auf seine Komposition. Dieser Nachbau ist weg, der
// Export holt sie mit einem `drawImage` von der Player-Leinwand.
//
// Die getrennte Mechanik von Player und Editor ist Absicht (E8,
// docs/concepts/konzept_gleichlauf_player_editor.md §6A): Der Player streamt
// einen Film voraus, der Editor springt in einer Datei umher — ein gemeinsames
// Bauteil müsste beide Zeitmodelle tragen.
//
// **Aber „andere Mechanik" heißt nicht „andere Zahlen".** Dieser Wächter prüfte
// bis zum 2026-08-17 nur die ZEITEN und sagte ausdrücklich, die Optik dürfe
// verschieden sein. Das stimmte für Schatten, Polsterung und Kartengröße — und
// es ließ acht Werte durch, die niemand je verschieden gemeint hat:
// Ken-Burns-Ende, Entwickeln-Ende, Auftritts- und Ruhewinkel, zwei
// Rückfalldauern, den Ruhewert bei abgeschaltetem Ken Burns, den Kamerablitz
// und den Schleier.
//
// **Was sich mit Etappe 2 geändert hat, ist die Player-SEITE des Vergleichs.**
// Vorher las der Test `src/style.css`; die Optik steht dort nicht mehr. Jetzt
// wird die RECHNUNG des Malers gegen `studio.html` gehalten — und das ist die
// bessere Hälfte des Tauschs: Ein Regex auf CSS prüft, welche Zeichenkette
// dasteht, `kartenPhasen` prüft, was tatsächlich herauskommt. Der Editor bleibt
// die Textseite, denn seine Optik IST CSS.
//
// Analog zu test/basis-css.test.ts (DESIGN.md ↔ basis.css).

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  HOLD_AUSBLEND,
  HOLD_HIDE,
  KARTE,
  KARTE_BUEHNE,
  KARTE_EXPORT_ABWEICHUNGEN,
  klipDauerS,
} from '../src/einblendung.js'
import { KURVE, blitzDeckkraft, kartenPhasen } from '../src/kartenmaler.js'

const studioHtml = readFileSync(new URL('../studio.html', import.meta.url), 'utf8')
const exportTs = readFileSync(new URL('../src/exportfilm.ts', import.meta.url), 'utf8')
const playerCss = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8')
const malerTs = readFileSync(new URL('../src/kartenmaler.ts', import.meta.url), 'utf8')

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
 * Der Reduce-Block, der die Karte betrifft. Nur noch im Editor: Der Player hat
 * keinen mehr, seine Leinwand erbt von einem Reduce-Block nichts (Falle 2).
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
 * Genau darin liegt der Witz dieses Wächters: Die beiden Bühnen schreiben
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

/**
 * Quelltext ohne Kommentare.
 *
 * Nötig für jede „steht nicht mehr da"-Prüfung: Was verschwunden ist, wird
 * gerade IM Kommentar erklärt („`kartenSicht` stand hier und ist mit dem
 * Nachbau gegangen"). Eine Suche über die ganze Datei fände die Erklärung und
 * meldete den Code als lebendig — der Test verbietet dann, das Verschwundene zu
 * benennen, und das ist die falsche Regel.
 */
function ohneKommentare(quelle: string): string {
  return quelle.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** Ein Klip von Vorgabelänge — die Bezugsgröße für alles hier. */
const KLIP_S = klipDauerS(HOLD_HIDE)
const bei = (imS: number, opt?: { keinKenBurns?: boolean; ruhig?: boolean }) =>
  kartenPhasen(imS, KLIP_S, opt ?? {})

describe('Foto-Karte: der Editor führt die Zeiten der Tabelle', () => {
  const editor = regel(studioHtml, '.foto-einblendung.an')

  it('die Karte steht dauerhaft auf `paused`', () => {
    // Das ist die Technik selbst: Ohne `paused` liefe die Animation nach
    // Wanduhr los und das negative Delay wäre wirkungslos — die Karte spränge
    // beim Scrubben sofort auf ihren Zielzustand (so war es vor E15). Der
    // Player braucht den Kniff nicht mehr: Sein Maler bekommt die Filmsekunde
    // als Zahl und zeichnet den Stand dazu. Das war der eigentliche Gewinn.
    expect(editor).toMatch(/animation-play-state:\s*paused/)
    expect(editor).toMatch(/animation-delay:.*var\(--fe-zeit/)
  })

  it('führt dieselben drei Animationen in derselben Reihenfolge', () => {
    // Der Abgang steht ZULETZT und gewinnt dadurch, solange er läuft. Eine
    // andere Reihenfolge kehrte das um: Der Auftritt läge über dem Abgang.
    expect(editor.match(/fe(EinBlende|EinFlug|Abgang)/g)).toEqual([
      'feEinBlende',
      'feEinFlug',
      'feAbgang',
    ])
  })

  it('nennt die Dauern der Tabelle', () => {
    // Blende, Flug, Ausblend-Rückfall, Blenden-Versatz. Ohne die `0s` aus
    // `var(--fe-zeit, 0s)`: Die sind kein Versatz, sondern der Rückfall für den
    // einen Frame, bevor zum ersten Mal geschrieben wurde.
    expect(zeiten(editor).filter((z) => z !== 0)).toEqual([
      KARTE.blendeDauerS * 1000,
      KARTE.flugDauerS * 1000,
      HOLD_AUSBLEND * 1000,
      KARTE.blendeVersatzS * 1000,
    ])
  })

  it('fliegt auf der Kurve der Tabelle herein', () => {
    expect(editor).toContain(KARTE.flugKurve)
  })
})

describe('Foto-Karte: der Maler führt dieselben Zeiten', () => {
  // Was oben ein Regex auf CSS ist, ist hier eine Rechnung — und das ist die
  // stärkere Prüfung: Sie fragt nicht, welche Zahl dasteht, sondern was
  // herauskommt.

  it('die Blende setzt `blendeVersatzS` später ein und dauert `blendeDauerS`', () => {
    expect(bei(KARTE.blendeVersatzS).sicht).toBeCloseTo(0, 5)
    expect(bei(KARTE.blendeVersatzS + KARTE.blendeDauerS).sicht).toBeCloseTo(1, 5)
    // Vor dem Versatz ist noch nichts zu sehen — sonst blitzte die Karte auf,
    // bevor sie zu fliegen beginnt.
    expect(bei(KARTE.blendeVersatzS / 2).sicht).toBe(0)
  })

  it('der Flug dauert `flugDauerS` und läuft auf `flugKurve`', () => {
    expect(bei(0).flug).toBe(0)
    expect(bei(KARTE.flugDauerS).flug).toBe(1)
    // Die Kurve ist nicht nachgebaut, sondern aus derselben Zeichenkette
    // gelesen, die im CSS des Editors steht.
    const halb = bei(KARTE.flugDauerS / 2).flug
    expect(halb).toBeCloseTo(KURVE.flug(0.5), 6)
    // Sie überschwingt (y2 = 1.16) — genau das macht den Anflug lebendig.
    expect(Math.max(...[0.5, 0.6, 0.7, 0.8].map((t) => KURVE.flug(t)))).toBeGreaterThan(1)
  })

  it('der Abgang liegt in den letzten `HOLD_AUSBLEND` des Klips', () => {
    // Der Rückfallwert im CSS des Editors ist ein Spiegel dieser Konstante.
    // Läuft er weg, blendet die Karte über eine andere Dauer als die, für die
    // der Klip Zeit vorsieht — sie hinge am Ende des Halts noch halb im Bild.
    expect(bei(KLIP_S - HOLD_AUSBLEND).abgang).toBe(0)
    expect(bei(KLIP_S - HOLD_AUSBLEND).sicht).toBeCloseTo(1, 5)
    expect(bei(KLIP_S).abgang).toBe(1)
    expect(bei(KLIP_S).sicht).toBeCloseTo(0, 5)
  })

  it('das „Entwickeln" dauert `entwickelnDauerS`', () => {
    expect(bei(0).entwickeln).toBe(0)
    expect(bei(KARTE.entwickelnDauerS).entwickeln).toBe(1)
  })
})

describe('Foto-Karte: Maler und Editor teilen die WERTE', () => {
  it('Ken Burns läuft auf beiden Bühnen von derselben Größe HERAUS', () => {
    // Die Richtung ist die Bildsprache der Foto-Stopps; das Ende stand im
    // Player auf 1.01, im Editor auf 1.02. Gemeint ist 1.02 — der
    // Reduced-Motion-Block legt die stehende Karte seit jeher auf genau diese
    // Größe (s. u.).
    const feKb = block(studioHtml, '@keyframes feKenburns')
    expect(teil(stufe(feKb, 'from'), 'scale')).toBe(String(KARTE.kenBurnsVon))
    expect(teil(stufe(feKb, 'to'), 'scale')).toBe(String(KARTE.kenBurnsBis))
    expect(KARTE.kenBurnsBis).toBeLessThan(KARTE.kenBurnsVon)
    // Und der Maler fährt denselben Weg — über die ganze KLIP-Länge, nicht über
    // feste 6 s wie einst der Export.
    expect(bei(0).kbSkala).toBeCloseTo(KARTE.kenBurnsVon, 6)
    expect(bei(KLIP_S).kbSkala).toBeCloseTo(KARTE.kenBurnsBis, 6)
    expect(bei(KLIP_S / 2).kbSkala).toBeLessThan(KARTE.kenBurnsVon)
    expect(bei(KLIP_S / 2).kbSkala).toBeGreaterThan(KARTE.kenBurnsBis)
  })

  it('die stehende Karte liegt überall auf dem ENDE des Zugs', () => {
    // Vier Stellen, an denen das Bild ohne Drift steht — und vor dem Umbau
    // drei verschiedene Zahlen: `none` (= 1.0) im Player, 1.04 im Editor,
    // 1.02 in beiden Reduce-Blöcken. Ein Bild, das ohne Ken Burns anders im
    // Rahmen sitzt als mit ihm, ist kein „ruhiges Foto", sondern ein anderer
    // Ausschnitt.
    const ruhe = `scale(${KARTE.ruheSkala})`
    expect(regel(studioHtml, '.foto-einblendung.an.ruhig .fe-frame img')).toContain(ruhe)
    expect(reduceBlock(studioHtml, '.foto-einblendung')).toContain(ruhe)
    expect(KARTE.ruheSkala).toBe(KARTE.kenBurnsBis)
    // Im Maler sind es dieselben zwei Fälle — abgeschalteter Ken Burns und
    // reduzierte Bewegung — und beide landen auf derselben Zahl.
    for (const imS of [0, KLIP_S / 2, KLIP_S]) {
      expect(bei(imS, { keinKenBurns: true }).kbSkala).toBe(KARTE.ruheSkala)
      expect(bei(imS, { ruhig: true }).kbSkala).toBe(KARTE.ruheSkala)
    }
  })

  it('die Rückfalldauer des Zugs ist die Klip-Länge', () => {
    // Rückfallwerte greifen nur, wenn die Custom Property fehlt — 7s gegen 6s
    // sah man deshalb nie als Bruch, sondern als leicht anderen Film.
    expect(KARTE.kbDauerRueckfallS).toBe(KLIP_S)
    expect(regel(studioHtml, '.foto-einblendung.an .fe-frame img')).toContain(
      `var(--fe-kb-dauer, ${KARTE.kbDauerRueckfallS}s)`,
    )
  })

  it('das „Entwickeln" beginnt und endet auf beiden Bühnen gleich', () => {
    // Das Ende ist nicht neutral: Die Karte behält einen minimalen Druck-Look,
    // der Editor stand auf `filter: none` und zeigte dasselbe Foto dauerhaft
    // eine Spur flacher.
    const feDev = block(studioHtml, '@keyframes feEntwickeln')
    expect(wert(stufe(feDev, 'from'), 'filter')).toBe(filterText(KARTE.entwickelnVon))
    expect(wert(stufe(feDev, 'to'), 'filter')).toBe(filterText(KARTE.entwickelnBis))
    // Der Maler puffert genau diese beiden Fassungen und blendet zwischen ihnen
    // über — ein `ctx.filter` pro Frame wäre je nach Browser nicht beschleunigt
    // (Konzept §5A). Er darf sie deshalb nur AUS der Tabelle nehmen.
    expect(malerTs).toContain('filterText(KARTE.entwickelnVon)')
    expect(malerTs).toContain('filterText(KARTE.entwickelnBis)')
  })

  it('Auftritt und Ruhelage haben dieselben Winkel — nur die Flugweite nicht', () => {
    const feFlug = block(studioHtml, '@keyframes feEinFlug')
    const von = stufe(feFlug, 'from')
    expect(teil(von, 'scale')).toBe(String(KARTE.flugSkala))
    expect(teil(von, 'rotate')).toBe(`${KARTE.flugDrehungGrad}deg`)
    expect(teil(von, 'rotateX')).toBe(`${KARTE.flugKippungGrad}deg`)
    expect(teil(von, 'translateY')).toBe(`${KARTE_BUEHNE.flugHubPx.editor}px`)
    expect(teil(stufe(feFlug, 'to'), 'rotate')).toBe(`${KARTE.ruheDrehungGrad}deg`)
    // Die Flugweite ist die eine benannte Variante — steht sie irgendwann
    // gleich, ist nicht der Test kaputt, sondern die Begründung hinfällig.
    expect(KARTE_BUEHNE.flugHubPx.player).not.toBe(KARTE_BUEHNE.flugHubPx.editor)
    // Der Maler nimmt seine Weite aus derselben Tabelle und keine eigene Zahl.
    expect(malerTs).toContain('KARTE_BUEHNE.flugHubPx.player')
  })

  it('der Ruhezustand steht im Editor auch außerhalb der Keyframes richtig', () => {
    // Der Editor setzt den Auftrittszustand zusätzlich als Grundwert der Karte —
    // sonst stünde sie einen Frame lang woanders, bevor die pausierte Animation
    // greift. Der Maler kennt keinen „Grundwert": Er zeichnet nur, wenn er eine
    // Filmsekunde hat, und dann den Stand dazu.
    const e = wert(regel(studioHtml, '.foto-einblendung'), 'transform')
    expect(teil(e, 'translateY')).toBe(`${KARTE_BUEHNE.flugHubPx.editor}px`)
    expect(teil(e, 'rotate')).toBe(`${KARTE.flugDrehungGrad}deg`)
  })

  it('der Abgang nimmt auf beiden Bühnen denselben Weg', () => {
    const k = block(studioHtml, '@keyframes feAbgang')
    const bis = stufe(k, 'to')
    expect(teil(bis, 'translateY')).toBe(`${KARTE.abgangHubPx}px`)
    expect(teil(bis, 'scale')).toBe(String(KARTE.abgangSkala))
    expect(teil(bis, 'rotate')).toBe(`${KARTE.abgangDrehungGrad}deg`)
    expect(teil(stufe(k, 'from'), 'rotate')).toBe(`${KARTE.ruheDrehungGrad}deg`)
    for (const name of ['abgangHubPx', 'abgangSkala', 'abgangDrehungGrad']) {
      expect(malerTs, `Maler rechnet ohne KARTE.${name}`).toContain(`KARTE.${name}`)
    }
  })

  it('der Kamerablitz ist auf beiden Bühnen derselbe', () => {
    expect(zeiten(regel(studioHtml, '.foto-flash.blitz'))).toContain(KARTE.blitzDauerS * 1000)
    const spitze = `${KARTE.blitzSpitzeBei * 100}%`
    const k = block(studioHtml, '@keyframes fotoBlitz')
    expect(wert(stufe(k, spitze), 'opacity')).toBe(String(KARTE.blitzSpitze))
    expect(wert(stufe(k, '0%'), 'opacity')).toBe('0')
    expect(wert(stufe(k, '100%'), 'opacity')).toBe('0')

    // Mitte und die beiden Deckkräfte des Verlaufs — der Editor lag um ein
    // Prozent und um 0,05 daneben, also genau in der Größenordnung, in der
    // man einen Unterschied für Absicht hält.
    const g = wert(regel(studioHtml, '.foto-flash'), 'background')
    expect(g).toContain(`circle at ${KARTE.blitzMitteX * 100}% ${KARTE.blitzMitteY * 100}%`)
    expect(g).toContain(`, ${KARTE.blitzInnen}) 0%`)
    expect(g).toContain(`, ${KARTE.blitzAussen}) 42%`)

    // Und der Maler blitzt dieselben drei Stufen. Die Kurve liegt zwischen
    // JEDEM Paar von Stufen und nicht über die ganze Dauer — sonst flammt der
    // Blitz langsamer auf und verschwindet schneller als im Editor.
    expect(blitzDeckkraft(0)).toBe(0)
    expect(blitzDeckkraft(KARTE.blitzDauerS)).toBe(0)
    expect(blitzDeckkraft(KARTE.blitzDauerS * KARTE.blitzSpitzeBei)).toBeCloseTo(
      KARTE.blitzSpitze,
      6,
    )
  })

  it('der Schleier ist auf beiden Bildschirm-Bühnen derselbe', () => {
    // Er bleibt eine DOM-Schicht mit `backdrop-filter` (Konzept §4) — auf einer
    // Leinwand hat der kein Gegenstück, deshalb steht er im Player weiter im
    // CSS und nicht im Maler. Der Editor stand auf mehr Schwarz und weniger
    // Blur: genau die Richtung, die im Player einmal zurückgenommen wurde.
    const filter = `blur(${KARTE.schleierBlurPx}px) saturate(${KARTE.schleierSaturate}) brightness(${KARTE.schleierBrightness})`
    expect(wert(regel(playerCss, '.photo-backdrop'), 'background')).toBe(KARTE.schleierFarbe)
    expect(wert(regel(playerCss, 'body.cinema .photo-backdrop'), 'backdrop-filter')).toBe(filter)
    expect(wert(regel(studioHtml, '.karten-buehne::after'), 'background')).toBe(KARTE.schleierFarbe)
    expect(wert(regel(studioHtml, '.karten-buehne.foto-an::after'), 'backdrop-filter')).toBe(filter)
    // Im FILM ist er eine flache Füllung — die benannte Bühnen-Variante. Sie
    // nimmt dieselbe Farbe; abweichen darf nur der Blur, den es dort nicht gibt.
    expect(malerTs).toContain("buehne.schleier === 'flach'")
    expect(malerTs).toContain('ctx.fillStyle = KARTE.schleierFarbe')
  })

  it('der Bildrahmen hat auf beiden Bühnen denselben Radius', () => {
    expect(wert(regel(studioHtml, '.fe-frame'), 'border-radius')).toBe(`${KARTE.rahmenRadiusPx}px`)
    expect(malerTs).toContain('KARTE.rahmenRadiusPx')
  })
})

describe('Der Player malt die Karte NICHT mehr in CSS', () => {
  // Das ist die andere Hälfte des Wächters: Er prüft nicht nur, dass der Maler
  // die Tabelle führt, sondern dass daneben keine zweite Fassung
  // wiederaufersteht. Eine vergessene Keyframe-Regel wäre kein Fehler, den man
  // sieht — sie liefe auf einem Element, das es nicht mehr gibt, bis jemand es
  // wieder anlegt.
  const totgesagt = [
    '@keyframes karteFlug',
    '@keyframes karteBlende',
    '@keyframes karteAbgang',
    '@keyframes kenburns',
    '@keyframes develop',
    '@keyframes bildunterschrift',
    '@keyframes flash',
    '.photo-frame',
    '.photo-caption',
    '--photo-chrome',
    '--photo-ar',
  ]

  for (const spur of totgesagt) {
    it(`${spur} steht nicht mehr in style.css`, () => {
      expect(ohneKommentare(playerCss)).not.toContain(spur)
    })
  }

  it('und der Player liest die Einstellung „Bewegung reduzieren" nicht im Maler', () => {
    // Der Maler bekommt sie als Schalter (Falle 2). Läse er sie selbst, hätte
    // die Einstellung des rendernden Rechners Einfluss auf die ausgelieferte
    // Datei — und das ist keine Optik-Frage, sondern eine über den Inhalt.
    const code = ohneKommentare(malerTs)
    expect(code).not.toContain('matchMedia')
    expect(code).not.toContain('prefers-reduced-motion')
  })
})

describe('Video-Export: der Nachbau ist weg', () => {
  it('die Liste bekannter Abweichungen ist leer', () => {
    // Ihr Zweck war, dass sie SCHRUMPFT (Etappe 1). Sie ist bei null angekommen:
    // Der Export malt die Karte nicht mehr, er holt sie.
    expect(KARTE_EXPORT_ABWEICHUNGEN).toHaveLength(0)
  })

  it('trägt keine eigene Karten-Optik mehr', () => {
    for (const spur of [
      'zeichneFotoKarte',
      'kartenSicht',
      // Die drei teuersten Abweichungen der Etappe-1-Liste, an ihrem Code
      // festgemacht: Ken Burns in der Gegenrichtung, das rohe
      // Seitenverhältnis und die Texte aus dem DOM.
      '0.06 * Math.min',
      'naturalHeight || 2',
      ".photo-title')?.textContent",
    ]) {
      expect(ohneKommentare(exportTs), `noch im Export: ${spur}`).not.toContain(spur)
    }
  })

  it('holt sie mit demselben `drawImage` wie Wetter und Atmosphäre', () => {
    for (const id of ['atmosphere', 'weather', 'karte']) {
      expect(exportTs).toContain(`zeichneOverlay(ctx, '${id}'`)
    }
  })

  it('und wartet auf den Frame, statt das alte Bild zu encodieren', () => {
    // `drawImage` auf einem noch suchenden `<video>` zeichnet ohne Fehler das
    // ALTE Bild. Am Bildschirm fällt das nicht auf, in der Datei ist es ein
    // falsches Einzelbild (Konzept §5).
    expect(exportTs).toContain('lauf.kartenBereit')
  })

  it('jede künftige Abweichung nennt Spur und Sollzustand', () => {
    for (const a of KARTE_EXPORT_ABWEICHUNGEN) {
      expect(a.was.length, 'leere Begründung').toBeGreaterThan(20)
      expect(a.soll.length, 'kein Sollzustand').toBeGreaterThan(5)
      expect(exportTs, `nicht mehr im Export: ${a.was}`).toContain(a.spur)
    }
  })
})
