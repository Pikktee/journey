// Die Foto-Karte gibt es nur noch EINMAL — als Maler (`src/card-painter.ts`).
//
// Bis Etappe 2 der Kartenleinwand waren es drei Fassungen: der Player in CSS,
// der Editor in CSS, der Video-Export als Canvas-Nachbau. Der Export ging
// zuerst (er holt die Karte jetzt mit einem `drawImage` von der Leinwand), der
// Editor mit „Eine Bühne, ein Maler" — seine 150 Zeilen `.fe-*`-CSS, fünf
// Keyframes und die `--fe-*`-Choreografie sind weg, er ruft denselben `paintCard`
// mit dem Bühnen-Satz `editor`.
//
// **Damit ändert sich, was dieser Wächter überhaupt sein kann.** Er verglich
// CSS gegen CSS, dann Rechnung gegen CSS; jetzt gibt es keine zweite Seite mehr,
// gegen die zu vergleichen wäre. Was bleibt, ist der Teil, der schon vorher der
// stärkere war — und zwei Sorten Prüfung, die ihren Wert BEHALTEN:
//
//   1. `CARD` gegen die RECHNUNG des Malers. Ein Regex auf CSS prüft, welche
//      Zeichenkette dasteht; `cardPhases` prüft, was herauskommt. Die Tabelle
//      ist damit kein Kommentar, sondern die Quelle: Wer eine Zahl darin ändert,
//      ändert das Bild, und wer sie im Maler umgeht, wird gemeldet.
//   2. Die Totenliste. Eine vergessene Keyframe-Regel wäre kein Fehler, den man
//      sieht — sie liefe auf einem Element, das es nicht mehr gibt, bis jemand
//      es wieder anlegt. Sie deckt seit dieser Etappe BEIDE Bühnen ab.
//
// Und eine dritte, die neu dazukommt: dass die zwei Bühnen-SÄTZE wirklich nur
// Geometrie sind (`KARTEN_MASSE` gegen `EDITOR_METRICS`) — was verschieden
// aussehen darf, ist die Karte auf ihrer Fläche, nicht die Bewegung darin.
//
// Analog zu test/base-css.test.ts (DESIGN.md ↔ base.css).

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  HOLD_FADE_OUT_S,
  HOLD_HIDE,
  CARD,
  CARD_STAGE,
  CARD_EXPORT_DEVIATIONS,
  clipDurationS,
} from '../src/card-timing.js'
import {
  EDITOR_LAYOUT,
  EDITOR_METRICS,
  EDITOR_SCALE_MAX,
  EDITOR_SCALE_MIN,
  CARD_METRICS,
  CURVE,
  SCALE_MIN,
  cardGeometry,
  cardLayout,
  cardPhases,
  cardStageSet,
} from '../src/card-painter.js'

const studioHtml = readFileSync(new URL('../studio.html', import.meta.url), 'utf8')
const exportTs = readFileSync(new URL('../src/film-export.ts', import.meta.url), 'utf8')
const playerCss = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8')
const malerTs = readFileSync(new URL('../src/card-painter.ts', import.meta.url), 'utf8')

/** Den Rumpf einer flachen Regel holen — bis zur ersten schließenden Klammer. */
function regel(source: string, selektor: string): string {
  const start = source.indexOf(selektor + ' {')
  expect(start, `Regel ${selektor} nicht gefunden`).toBeGreaterThan(-1)
  const ende = source.indexOf('}', start)
  return source.slice(start, ende)
}

/** Der Wert einer Eigenschaft einer Regel, mit normierten Leerzeichen. */
function wert(rumpf: string, eigenschaft: string): string {
  const m = new RegExp(`(?<![\\w-])${eigenschaft}:\\s*([^;}]+)`).exec(rumpf)
  expect(m, `${eigenschaft} nicht gefunden in: ${rumpf.trim().slice(0, 120)}`).not.toBeNull()
  return ((m as RegExpExecArray)[1] as string).trim().replace(/\s+/g, ' ')
}

/**
 * Quelltext ohne Kommentare.
 *
 * Nötig für jede „steht nicht mehr da"-Prüfung: Was verschwunden ist, wird
 * gerade IM Kommentar erklärt („der Blitz kommt jetzt aus dem Maler"). Eine
 * Suche über die ganze Datei fände die Erklärung und meldete den Code als
 * lebendig — der Test verbietet dann, das Verschwundene zu benennen, und das ist
 * die falsche Regel.
 */
function ohneKommentare(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** Ein Klip von Vorgabelänge — die Bezugsgröße für alles hier. */
const KLIP_S = clipDurationS(HOLD_HIDE)
const bei = (imS: number, opt?: { noKenBurns?: boolean; calm?: boolean }) =>
  cardPhases(imS, KLIP_S, opt ?? {})

describe('Foto-titel: der Maler führt die Zeiten der Tabelle', () => {
  it('die Blende setzt `fadeOffsetS` später ein und dauert `fadeDurationS`', () => {
    expect(bei(CARD.fadeOffsetS).opacity).toBeCloseTo(0, 5)
    expect(bei(CARD.fadeOffsetS + CARD.fadeDurationS).opacity).toBeCloseTo(1, 5)
    // Vor dem Versatz ist noch nichts zu sehen — sonst blitzte die Karte auf,
    // bevor sie zu fliegen beginnt.
    expect(bei(CARD.fadeOffsetS / 2).opacity).toBe(0)
  })

  it('der Flug dauert `flightDurationS` und läuft auf `flightCurve`', () => {
    expect(bei(0).flight).toBe(0)
    expect(bei(CARD.flightDurationS).flight).toBe(1)
    // Die Kurve ist nicht nachgebaut, sondern aus der Zeichenkette der Tabelle
    // gelesen — bis zu dieser Etappe stand dieselbe im CSS des Editors.
    const halb = bei(CARD.flightDurationS / 2).flight
    expect(halb).toBeCloseTo(CURVE.flight(0.5), 6)
    // Sie überschwingt (y2 = 1.16) — genau das macht den Anflug lebendig.
    expect(Math.max(...[0.5, 0.6, 0.7, 0.8].map((t) => CURVE.flight(t)))).toBeGreaterThan(1)
  })

  it('der Abgang liegt in den letzten `HOLD_AUSBLEND` des Klips', () => {
    // Läuft das weg, blendet die Karte über eine andere Dauer als die, für die
    // der Klip Zeit vorsieht — sie hinge am Ende des Halts noch halb im Bild.
    expect(bei(KLIP_S - HOLD_FADE_OUT_S).exit).toBe(0)
    expect(bei(KLIP_S - HOLD_FADE_OUT_S).opacity).toBeCloseTo(1, 5)
    expect(bei(KLIP_S).exit).toBe(1)
    expect(bei(KLIP_S).opacity).toBeCloseTo(0, 5)
  })

  it('das „Entwickeln" dauert `developDurationS`', () => {
    expect(bei(0).develop).toBe(0)
    expect(bei(CARD.developDurationS).develop).toBe(1)
  })

  it('Ken Burns läuft über die ganze KLIP-Länge und zoomt HERAUS', () => {
    // Die Richtung ist die Bildsprache der Foto-Stopps; der Export zoomte
    // einmal in die Gegenrichtung. Und der Weg geht über den ganzen Klip, nicht
    // über feste 6 s: An einem 20-s-Halt wäre der Zug nach einem Viertel fertig.
    expect(CARD.kenBurnsTo).toBeLessThan(CARD.kenBurnsFrom)
    expect(bei(0).kbScale).toBeCloseTo(CARD.kenBurnsFrom, 6)
    expect(bei(KLIP_S).kbScale).toBeCloseTo(CARD.kenBurnsTo, 6)
    expect(bei(KLIP_S / 2).kbScale).toBeLessThan(CARD.kenBurnsFrom)
    expect(bei(KLIP_S / 2).kbScale).toBeGreaterThan(CARD.kenBurnsTo)
    // Und die Rückfalldauer, die es dafür einmal brauchte, IST die Klip-Länge.
    expect(CARD.kenBurnsFallbackDurationS).toBe(KLIP_S)
  })

  it('die stehende Karte liegt auf dem ENDE des Zugs', () => {
    // Zwei Fälle, in denen das Bild ohne Drift steht — abgeschalteter Ken Burns
    // und reduzierte Bewegung. Vor der Vereinheitlichung waren es drei
    // verschiedene Zahlen: `none` (= 1.0) im Player, 1.04 im Editor, 1.02 in
    // beiden Reduce-Blöcken. Ein Bild, das ohne Ken Burns anders im Rahmen sitzt
    // als mit ihm, ist kein „ruhiges Foto", sondern ein anderer Ausschnitt.
    expect(CARD.restScale).toBe(CARD.kenBurnsTo)
    for (const imS of [0, KLIP_S / 2, KLIP_S]) {
      expect(bei(imS, { noKenBurns: true }).kbScale).toBe(CARD.restScale)
      expect(bei(imS, { calm: true }).kbScale).toBe(CARD.restScale)
    }
  })

  it('und er nimmt JEDE Zahl AUS der Tabelle, keine eigene', () => {
    // Die Tabelle ist nur so viel wert, wie der Maler sie liest. Ein Wert, den
    // er daneben noch einmal hinschreibt, wäre die nächste Fassung, die
    // auseinanderläuft — und zwar unbemerkt, weil es keine zweite Bühne mehr
    // gibt, an der es auffiele.
    //
    // Die Liste kommt deshalb aus `Object.keys(CARD)` und ist NICHT von Hand
    // gepflegt: Eine handgeschriebene lief bereits auseinander (19 Namen für 23
    // Einträge), und was durch sie fiel, war genau das, was neu dazukam. Wer
    // einen Wert hier ausnimmt, muss ihn benennen und begründen — die Ausnahme
    // ist dann eine Entscheidung und kein Vergessen.
    const AUSNAHMEN: Record<string, string> = {
      // Der Schleier ist DOM geblieben (Konzept §4). Seine drei Filterwerte
      // liest keine Leinwand, sondern das CSS beider Bühnen — geprüft wird das
      // im Schleier-Test darunter, Text gegen Text.
      scrimBlurPx: 'DOM-Schleier, im Schleier-Test geprüft',
      scrimSaturate: 'DOM-Schleier, im Schleier-Test geprüft',
      scrimBrightness: 'DOM-Schleier, im Schleier-Test geprüft',
      // Der Rückfallwert der Ken-Burns-Dauer greift, wenn niemand eine Dauer
      // nennt. Er wird in `card-timing.ts` selbst gelesen und gegen die
      // Klip-Länge geprüft (s. „Ken Burns läuft über die ganze KLIP-Länge").
      kenBurnsFallbackDurationS: 'in card-timing.ts gelesen, gegen clipDurationS geprüft',
    }
    const code = ohneKommentare(malerTs)
    const fehlen = Object.keys(CARD).filter(
      (name) => !AUSNAHMEN[name] && !code.includes(`CARD.${name}`),
    )
    expect(fehlen, `Maler rechnet ohne diese Werte der Tabelle: ${fehlen.join(', ')}`).toEqual([])
    // Und keine Ausnahme, die es gar nicht mehr gibt: Sie deckte sonst still
    // einen Namen, den niemand mehr schreibt.
    expect(Object.keys(AUSNAHMEN).filter((n) => !(n in CARD))).toEqual([])

    // Das „Entwickeln" ist eine Überblendung zweier gepufferter Fassungen und
    // kein `ctx.filter` pro Frame (Konzept §5A) — die Filterketten dürfen
    // deshalb nur aus der Tabelle kommen.
    expect(malerTs).toContain('filterText(CARD.developFrom)')
    expect(malerTs).toContain('filterText(CARD.developTo)')
  })

  it('der Schleier ist auf beiden Bildschirm-Bühnen derselbe', () => {
    // Er bleibt eine DOM-Schicht mit `backdrop-filter` (Konzept §4) — auf einer
    // Leinwand hat der kein Gegenstück, deshalb ist er der EINE Teil der Karte,
    // der weiterhin zweimal als CSS dasteht und bewacht werden muss.
    const filter = `blur(${CARD.scrimBlurPx}px) saturate(${CARD.scrimSaturate}) brightness(${CARD.scrimBrightness})`
    expect(wert(regel(playerCss, '.photo-backdrop'), 'background')).toBe(CARD.scrimColor)
    expect(wert(regel(playerCss, 'body.cinema .photo-backdrop'), 'backdrop-filter')).toBe(filter)
    expect(wert(regel(studioHtml, '.card-stage::after'), 'background')).toBe(CARD.scrimColor)
    expect(wert(regel(studioHtml, '.card-stage.photo-on::after'), 'backdrop-filter')).toBe(filter)
    // Im FILM ist er eine flache Füllung — die benannte Bühnen-Variante. Sie
    // nimmt dieselbe Farbe; abweichen darf nur der Blur, den es dort nicht gibt.
    expect(malerTs).toContain("stage.scrim === 'flat'")
    expect(malerTs).toContain('ctx.fillStyle = CARD.scrimColor')
  })

  it('und seine Deckkraft hängt an der FILMZEIT, nicht an einer Transition', () => {
    // Das ist, was den Kamerablitz ersetzt: Der Halt wird dadurch markiert, dass
    // die Umgebung zurücktritt. Als 0,8-s-Transition an einer Klasse blieb der
    // Schleier beim Scrubben hinter der Karte zurück und kam rückwärts gar nicht
    // mit — die letzte Stelle im Film, an der noch eine Wanduhr lief.
    for (const [datei, rumpf] of [
      ['style.css', regel(playerCss, '.photo-backdrop')],
      ['studio.html', regel(studioHtml, '.card-stage::after')],
    ] as const) {
      expect(wert(rumpf, 'opacity'), datei).toBe('var(--scrim-opacity, 0)')
      expect(rumpf, `${datei}: Transition auf dem Schleier`).not.toMatch(/transition:/)
    }
    // Die Klasse schaltet nur noch den FILTER — und darf die Deckkraft nicht
    // mehr anfassen, sonst schlüge sie die Filmzeit.
    expect(regel(playerCss, 'body.cinema .photo-backdrop')).not.toMatch(/opacity:/)
    expect(regel(studioHtml, '.card-stage.photo-on::after')).not.toMatch(/opacity:/)
    // Geschrieben wird sie an EINER Stelle, und zwar aus der Deckkraft der Karte.
    const schicht = readFileSync(new URL('../src/card-layer.ts', import.meta.url), 'utf8')
    expect(schicht).toContain("setProperty('--scrim-opacity'")
    expect(schicht).toContain('placeScrim(result.rects?.opacity ?? 0)')
  })
})

describe('Der Kamerablitz ist zurückgebaut', () => {
  // Etappe 2 von „Eine Bühne, ein Maler". Nicht wegen der Kosten (obwohl er die
  // teuerste einzelne Operation eines Kartenbildes war: 2,0 gegen 1,1 ms im
  // Median), sondern weil auf seiner Spitze das Foto durch das „Entwickeln"
  // ohnehin schon ein heller Schleier ist — zwei Gesten für dieselbe Sache im
  // selben Moment.

  it('keine Spur mehr in der Tabelle, im Maler und auf beiden Bühnen', () => {
    for (const spur of [
      'blitzDauerS',
      'blitzSpitzeBei',
      'blitzSpitze',
      'blitzMitte',
      'blitzInnen',
      'blitzAussen',
      'blitzHalt',
      'blitzDeckkraft',
    ]) {
      expect(Object.keys(CARD), `KARTE trägt ${spur} noch`).not.toContain(spur)
      expect(ohneKommentare(malerTs), `Maler kennt ${spur} noch`).not.toContain(spur)
    }
    // Der Radialverlauf war das Einzige im Maler, was `createRadialGradient`
    // brauchte — bleibt einer stehen, ist der Rückbau unvollständig.
    expect(ohneKommentare(malerTs)).not.toContain('createRadialGradient')
    expect(ohneKommentare(playerCss)).not.toContain('photo-flash')
    expect(ohneKommentare(studioHtml)).not.toContain('foto-flash')
  })

  it('und die Karte trägt keine Blitz-Phase mehr', () => {
    expect(Object.keys(bei(0.1))).not.toContain('blitz')
  })
})

describe('Foto-titel: die zwei Bühnen-Sätze sind nur GEOMETRIE', () => {
  // Das ist die Regel, die den Umbau trägt: Was auf beiden Bühnen gleich
  // aussehen soll, kommt aus `CARD`; was verschieden sein darf, steht als
  // benannter Bühnen-Satz da — mit seinem Grund. Ohne diese Trennung wäre der
  // zweite Satz bloß eine zweite Fassung mit anderem Namen.

  it('der Editor SETZT seine Lage, statt sie abzuleiten', () => {
    // Eine Editor-Fläche von etwa 700 × 500 ist breiter als hoch und höchstens
    // 560 hoch — abgeleitet fiele sie damit in `quer` und bekäme das Layout
    // „Bild links, Text rechts" eines liegenden Telefons.
    expect(cardLayout(700, 500)).toBe('landscape')
    expect(EDITOR_LAYOUT).not.toBe('landscape')
    expect(cardStageSet({ width: 700, height: 500, name: 'editor' }).layout).toBe(EDITOR_LAYOUT)
    // Die Player-Bühne bleibt bei der Ableitung: Dort IST die Bühne das Fenster.
    expect(cardStageSet({ width: 700, height: 500 }).layout).toBe('landscape')
    expect(cardStageSet({ width: 1600, height: 900 }).metrics).toBe(CARD_METRICS.wide)
    expect(cardStageSet({ width: 1600, height: 900, name: 'editor' }).metrics).toBe(EDITOR_METRICS)
  })

  it('die Editor-Karte hat keinen Ton-Knopf', () => {
    // Sie ist eine Vorschau, keine Bedienung: Der Ton des Videos läuft, bedient
    // wird er nicht. Die 0 im Satz ist die Ansage dafür.
    //
    // „Weiter ▸" stand hier als zweiter Fall — den Knopf gibt es seit dem
    // 2026-08-18 auf KEINER Bühne mehr, auch nicht im Player.
    expect(EDITOR_METRICS.audioSide).toBe(0)
    expect(CARD_METRICS.wide.audioSide).toBeGreaterThan(0)
  })

  it('die Flugweite kommt aus der einen Tabelle und nicht aus dem Maler', () => {
    // Sie ist die benannte Variante: Der Player zeigt die Karte fast
    // bildschirmfüllend, im Editor wären dieselben 70 px mehr als eine halbe
    // Kartenhöhe. Steht sie irgendwann gleich, ist nicht der Test kaputt,
    // sondern die Begründung hinfällig.
    expect(CARD_STAGE.flightLiftPx.player).not.toBe(CARD_STAGE.flightLiftPx.editor)
    expect(cardStageSet({ width: 1600, height: 900 }).flightLiftPx).toBe(
      CARD_STAGE.flightLiftPx.player,
    )
    expect(cardStageSet({ width: 1100, height: 480, name: 'editor' }).flightLiftPx).toBe(
      CARD_STAGE.flightLiftPx.editor,
    )
    expect(malerTs).toContain('CARD_STAGE.flightLiftPx.editor')
  })

  it('der Editor-Maßstab reicht tiefer als der des Players', () => {
    // Seine Bühne ist die Kartenfläche neben der Zeitleiste, nicht das Fenster.
    // Mit dem Player-Boden 0,7 wäre bei 480 px Höhe schon geklemmt: Das Bild
    // bekäme statt 66 % nur 55 % der Fläche.
    expect(EDITOR_SCALE_MIN).toBeLessThan(SCALE_MIN)
    expect(EDITOR_SCALE_MAX).toBeGreaterThan(EDITOR_SCALE_MIN)
    // Bei 540 px ist der Editor noch ungeklemmt (und damit maßstabstreu), der
    // Player läge dort längst auf seinem Boden.
    expect(cardStageSet({ width: 1100, height: 540, name: 'editor' }).scale).toBeCloseTo(
      540 / 900,
      6,
    )
    expect(cardStageSet({ width: 1100, height: 540 }).scale).toBe(SCALE_MIN)
  })

  it('das Bild nimmt auf der Editor-Bühne rund zwei Drittel der Höhe ein', () => {
    // Die `66cqh` der abgelösten CSS-Fassung, in `chrome` übersetzt: Weil `mass`
    // im ungeklemmten Bereich `hoehe / 900` IST, ergibt 306 = 0,34 × 900 genau
    // diesen Anteil — bei JEDER Bühnenhöhe, nicht nur bei einer.
    for (const hoehe of [520, 700, 900]) {
      const g = cardGeometry(
        { width: 1200, height: hoehe, name: 'editor' },
        { kind: 'photo', ar: 1.5 },
        { factsOwnLine: false },
      )
      expect(g.image.height / hoehe).toBeCloseTo(0.66, 2)
      // Und die Karte bleibt auf der Bühne — sie ist kleiner als ihre Fläche.
      expect(g.card.height).toBeLessThan(hoehe)
      expect(g.card.width).toBeLessThan(1200)
      expect(g.card.x).toBeGreaterThan(0)
    }
  })
})

describe('Die Karte steht nirgends mehr als CSS', () => {
  // Eine vergessene Keyframe-Regel wäre kein Fehler, den man sieht — sie liefe
  // auf einem Element, das es nicht mehr gibt, bis jemand es wieder anlegt.
  const playerTot = [
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
  // Die Editor-Hälfte, seit „Eine Bühne, ein Maler": fünf Keyframes, die
  // `--fe-*`-Choreografie, der Bildrahmen samt Balken und der Kamerablitz.
  const editorTot = [
    '@keyframes feEinBlende',
    '@keyframes feEinFlug',
    '@keyframes feAbgang',
    '@keyframes feEntwickeln',
    '@keyframes feKenburns',
    '@keyframes fotoBlitz',
    '.foto-card-timing',
    '.foto-flash',
    '.fe-frame',
    '.fe-hold',
    '.fe-cap',
    '--fe-zeit',
    '--fe-kb-dauer',
    '--fe-aus-zeit',
    '--fe-aus-dauer',
    '--fe-ar',
  ]

  for (const spur of playerTot) {
    it(`${spur} steht nicht mehr in style.css`, () => {
      expect(ohneKommentare(playerCss)).not.toContain(spur)
    })
  }

  for (const spur of editorTot) {
    it(`${spur} steht nicht mehr in studio.html`, () => {
      expect(ohneKommentare(studioHtml)).not.toContain(spur)
    })
  }

  it('der PLAYER trägt seinen Text weiter im Dokument', () => {
    // Eine Leinwand hat keinen Text. Ohne diese Kopie verlöre der Player den
    // Titel und die Angaben — und niemandem fiele es auf, weil das Bild gleich
    // aussieht (Karten-Konzept, Falle 1). Dort ist sie Pflicht, weil die Karte
    // in diesem Moment der GANZE Inhalt der Seite ist: Es gibt nichts daneben.
    //
    // Im EDITOR gibt es sie bewusst nicht, und das ist eine Entscheidung und
    // kein Vergessen: Seine Karte ist die Vorschau eines Werkzeugs, und jede
    // Angabe darauf steht dauerhaft als Text daneben — der Titel im Klip der
    // Szenen-Bahn, Uhrzeit und Kilometer im Pult. Eine versteckte Kopie wäre
    // dort dieselbe Auskunft ein zweites Mal, in einer Oberfläche, die schon
    // dicht ist. Wer das umdreht, ändert eine Zusage in
    // docs/concepts/eine-buehne-ein-maler.md §4a.
    const player = readFileSync(new URL('../erlebnis.html', import.meta.url), 'utf8')
    const figcaption = /<figcaption[^>]*class="sr-only"[\s\S]*?<\/figcaption>/.exec(player)
    expect(figcaption, 'die sr-only-Kopie der Foto-Karte fehlt').not.toBeNull()
    // `photo-sub` stand hier bis zum 2026-08-18: die Bildunterschrift. Sie ist
    // entfallen, weil ein Halt 5,2 s steht und die kuratierten Texte im Median
    // 84 Zeichen hatten — wer sie las, sah das Bild nicht.
    for (const id of ['photo-title', 'photo-chip']) {
      expect((figcaption as RegExpExecArray)[0], `${id} nicht in der Kopie`).toContain(id)
    }
    expect(regel(playerCss, '.sr-only')).toContain('clip-path')
  })

  it('und der Maler liest die Einstellung „Bewegung reduzieren" nicht selbst', () => {
    // Er bekommt sie als Schalter (Falle 2). Läse er sie selbst, hätte die
    // Einstellung des rendernden Rechners Einfluss auf die ausgelieferte Datei —
    // und das ist keine Optik-Frage, sondern eine über den Inhalt.
    const code = ohneKommentare(malerTs)
    expect(code).not.toContain('matchMedia')
    expect(code).not.toContain('prefers-reduced-motion')
  })

  it('bei reduzierter Bewegung bleibt genau eine Bewegung übrig', () => {
    // Eine kurze Deckkraft-Blende, wie es beide CSS-Fassungen taten. Ein harter
    // Schnitt wäre hier falsch: Im Film wäre er ein Bildsprung.
    expect(bei(0, { calm: true }).opacity).toBe(0)
    expect(bei(1, { calm: true }).opacity).toBe(1)
    expect(bei(1, { calm: true }).flight).toBe(1)
    expect(bei(KLIP_S, { calm: true }).opacity).toBeCloseTo(0, 5)
  })
})

describe('Video-Export: der Nachbau ist weg', () => {
  it('die Liste bekannter Abweichungen ist leer', () => {
    // Ihr Zweck war, dass sie SCHRUMPFT (Etappe 1). Sie ist bei null angekommen:
    // Der Export malt die Karte nicht mehr, er holt sie.
    expect(CARD_EXPORT_DEVIATIONS).toHaveLength(0)
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
    for (const id of ['atmosphere', 'weather', 'card']) {
      expect(exportTs).toContain(`drawOverlay(ctx, '${id}'`)
    }
  })

  it('und wartet auf den Frame, statt das alte Bild zu encodieren', () => {
    // `drawImage` auf einem noch suchenden `<video>` zeichnet ohne Fehler das
    // ALTE Bild. Am Bildschirm fällt das nicht auf, in der Datei ist es ein
    // falsches Einzelbild (Konzept §5).
    expect(exportTs).toContain('run.cardReady')
  })

  it('jede künftige Abweichung nennt Spur und Sollzustand', () => {
    for (const a of CARD_EXPORT_DEVIATIONS) {
      expect(a.what.length, 'leere Begründung').toBeGreaterThan(20)
      expect(a.should.length, 'kein Sollzustand').toBeGreaterThan(5)
      expect(exportTs, `nicht mehr im Export: ${a.what}`).toContain(a.trace)
    }
  })
})
