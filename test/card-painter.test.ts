// Der Kartenmaler — die rechnenden Teile.
//
// Die OPTIK-Zahlen prüft test/einblendung-css.test.ts gegen `CARD` und
// `studio.html`; hier steht, was es dort nie gab, weil es CSS war: das
// Skalierungsmodell, die Lagen, die Kartengeometrie und das Kürzen von Text.
//
// Warum das eigene Tests braucht und nicht bloß ein Auge: „Deckungsgleich" ist
// nur dann eine prüfbare Aussage, wenn festgeschrieben ist, wie Längen mit dem
// Format wachsen (docs/concepts/konzept_kartenleinwand.md §5). Ein gemeinsamer
// Zeichner allein macht zwei Bühnen nicht deckungsgleich — er macht sie nur
// gleich FALSCH, wenn die Bezugshöhe fehlt.

import { describe, expect, it } from 'vitest'
import { AR_MAX, AR_MIN, HOLD_HIDE, CARD, clipDurationS } from '../src/card-timing.js'
import {
  REFERENCE_HEIGHT_PX,
  CARD_METRICS,
  SCALE_MAX,
  SCALE_MIN,
  bezier,
  wrapText,
  cardGeometry,
  cardLayout,
  cardScale,
  cardPhases,
  truncateText,
  curveFromText,
} from '../src/card-painter.js'

const KLIP_S = clipDurationS(HOLD_HIDE)
/** Der Normalfall: Angaben neben dem Titel. */
const INHALT = { factsOwnLine: false }

const FOTO = { kind: 'photo', ar: 1.5 } as const
/** Eine Messfunktion ohne Canvas: 8 px je Zeichen reicht für die Bruchlogik. */
const mass8 = (s: string) => s.length * 8

describe('Skalierungsmodell', () => {
  it('bei Bezugshöhe hat jede Länge ihren Nennwert', () => {
    // Die Bezugshöhe ist nicht frei gewählt: Bei 1600 × 900 lagen alle `clamp()`
    // der abgelösten CSS-Fassung auf ihrer Obergrenze. Nur dort schließt ein
    // einziger Faktor an die bestehende Optik an.
    expect(REFERENCE_HEIGHT_PX).toBe(900)
    expect(cardScale(REFERENCE_HEIGHT_PX)).toBe(1)
    const g = cardGeometry({ width: 1600, height: 900 }, FOTO, INHALT)
    expect(g.cardRadius).toBe(CARD_METRICS.wide.cardRadius)
    expect(g.text.title.fontPx).toBe(CARD_METRICS.wide.title)
  })

  it('doppelte Höhe heißt doppelte Länge — und das ist der ganze Zweck', () => {
    // Ohne das war die Karte im 4K-Film ein Briefmarkenrahmen mit
    // Fußnotenschrift: Die alten Werte waren feste Pixel, und ein Filmpixel ist
    // kein Bildschirmpixel (Konzept, Falle 6).
    const klein = cardGeometry({ width: 1600, height: 900 }, FOTO, INHALT)
    const gross = cardGeometry({ width: 3200, height: 1800 }, FOTO, INHALT)
    expect(gross.scale).toBe(2)
    expect(gross.text.title.fontPx).toBeCloseTo(klein.text.title.fontPx * 2, 6)
    expect(gross.card.width).toBeCloseTo(klein.card.width * 2, 6)
    expect(gross.card.height).toBeCloseTo(klein.card.height * 2, 6)
  })

  it('der Maßstab ist gedeckelt — nach unten und nach oben', () => {
    expect(cardScale(1)).toBe(SCALE_MIN)
    expect(cardScale(100000)).toBe(SCALE_MAX)
  })

  it('die drei Mindest-Schriftgrößen skalieren NICHT mit', () => {
    // Sie sind die eine benannte Ausnahme des Modells: eine Bildschirm-Regel für
    // das Telefon, nicht Kartengeometrie. Im Film greifen sie nie, weil jedes
    // Ausgabeformat über der Bezugshöhe liegt.
    const winzig = cardGeometry({ width: 360, height: 480 }, FOTO, INHALT)
    const satz = CARD_METRICS[winzig.layout]
    expect(winzig.scale).toBeLessThan(1)
    expect(winzig.text.title.fontPx).toBe(satz.titleMin)
    expect(winzig.text.facts.fontPx).toBe(satz.factsMin)
  })

  it('der Bildradius hat einen Boden — darunter ist er ein Pixelrand', () => {
    const winzig = cardGeometry({ width: 360, height: 480 }, FOTO, INHALT)
    expect(winzig.frameRadius).toBeGreaterThanOrEqual(3)
    // Bei Bezugshöhe steht er auf dem geteilten Wert aus der Tabelle.
    expect(cardGeometry({ width: 1600, height: 900 }, FOTO, INHALT).frameRadius).toBe(
      CARD.frameRadiusPx,
    )
  })
})

describe('Lage — abgeleitet, nicht übergeben', () => {
  it('kennt die drei Fälle an denselben Schwellen wie vorher das CSS', () => {
    expect(cardLayout(1600, 900)).toBe('wide')
    // `body.compact-landscape` in main.ts: breiter als hoch UND höchstens 560 px hoch.
    expect(cardLayout(900, 500)).toBe('landscape')
    expect(cardLayout(900, 600)).toBe('wide')
    // `@media (max-width: 700px)`.
    expect(cardLayout(390, 844)).toBe('narrow')
    // Quer schlägt schmal: Ein liegendes Telefon ist beides, und dort ist die
    // Bühne flach — der Text muss NEBEN das Bild.
    expect(cardLayout(700, 390)).toBe('landscape')
  })

  it('quer beschriftet UNTER dem Bild — wie breit und schmal', () => {
    // Bis zum Umbau stand der Text quer in einer Spalte NEBEN dem Bild. Das
    // war die einzige Lage mit eigener Bauform, und beide Fehler der Karte
    // (Zeile lief aus der Karte, leere Papierfläche) hingen daran.
    for (const [b, h] of [
      [916, 412],
      [1600, 900],
      [390, 844],
    ] as const) {
      const g = cardGeometry({ width: b, height: h }, FOTO, INHALT)
      expect(g.text.title.y).toBeGreaterThan(g.image.y + g.image.height)
      expect(g.text.title.x).toBeLessThan(g.image.x + g.image.width)
    }
  })

  it('die Angaben-x ist in JEDER Lage die RECHTE Kante der Zeile', () => {
    // Der Maler zieht die gemessene Textbreite davon ab. Stand hier ein
    // Sonderfall, lief die Zeile auf dem Telefon aus der Karte heraus.
    for (const [b, h] of [
      [916, 412],
      [1600, 900],
      [390, 844],
    ] as const) {
      const g = cardGeometry({ width: b, height: h }, FOTO, INHALT)
      expect(g.text.facts.x).toBeGreaterThan(g.text.title.x)
      expect(g.text.facts.x).toBeLessThanOrEqual(g.card.x + g.card.width)
    }
  })

  it('der zweizeilige Fuß kostet BILDHÖHE, nicht die Luft zum Rand', () => {
    // Passen Titel und Angaben nicht nebeneinander, wird die Karte um eine
    // Zeile höher. Wüsste die Chrome-Reserve das nicht, klebte die Karte am
    // Bühnenrand: quer blieben bei einer Hochkant-Aufnahme 2 px.
    const buehne = { width: 916, height: 412 }
    const hoch = { kind: 'photo', ar: 0.667 } as const
    const eins = cardGeometry(buehne, hoch, { factsOwnLine: false })
    const zwei = cardGeometry(buehne, hoch, { factsOwnLine: true })
    expect(zwei.image.height).toBeLessThan(eins.image.height)
    expect(zwei.card.height).toBeCloseTo(eins.card.height, 4)
    expect(zwei.card.y).toBeGreaterThan(8)
  })
})

describe('Kartengeometrie', () => {
  it('Leitgröße ist die HÖHE, die Breite folgt aus dem Seitenverhältnis', () => {
    // Umgekehrt (Breite fest, Höhe folgt) ragte die Karte auf quer gehaltenen
    // Telefonen oben UND unten aus dem Bild — der Grund, aus dem die abgelöste
    // CSS-Fassung es schon so rechnete.
    const hoch = cardGeometry({ width: 1600, height: 900 }, { kind: 'photo', ar: 0.7 }, INHALT)
    const quer = cardGeometry({ width: 1600, height: 900 }, { kind: 'photo', ar: 1.8 }, INHALT)
    expect(hoch.image.width / hoch.image.height).toBeCloseTo(0.7, 4)
    expect(quer.image.width / quer.image.height).toBeCloseTo(1.8, 4)
    expect(hoch.image.width).toBeLessThan(quer.image.width)
  })

  it('die Karte bleibt IMMER im Bild — auch bei extremen Formaten', () => {
    for (const [b, h] of [
      [1600, 900],
      [1920, 1080],
      [3840, 2160],
      [1080, 1920],
      [390, 844],
      [900, 420],
      [720, 720],
    ] as const) {
      for (const ar of [AR_MIN, 1, 1.5, AR_MAX]) {
        const g = cardGeometry({ width: b, height: h }, { kind: 'photo', ar }, INHALT)
        expect(g.card.width, `${b}×${h} ar ${ar}`).toBeLessThanOrEqual(b)
        expect(g.card.height, `${b}×${h} ar ${ar}`).toBeLessThanOrEqual(h)
        expect(g.card.x).toBeGreaterThanOrEqual(0)
        expect(g.card.y).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('klemmt das Seitenverhältnis und nimmt 3:2, wo noch nichts vermessen ist', () => {
    // Das ROHE Verhältnis war eine der sieben Export-Abweichungen: Ein
    // 3:1-Panorama wäre breiter als das Fenster, ein 9:19-Handyfoto höher.
    const panorama = cardGeometry({ width: 1600, height: 900 }, { kind: 'photo', ar: 4 }, INHALT)
    expect(panorama.image.width / panorama.image.height).toBeCloseTo(AR_MAX, 4)
    const unbekannt = cardGeometry(
      { width: 1600, height: 900 },
      { kind: 'photo', ar: null },
      INHALT,
    )
    expect(unbekannt.image.width / unbekannt.image.height).toBeCloseTo(1.5, 4)
  })

  it('macht der stehenden Bedienung Platz und rückt hoch', () => {
    // Das gilt NUR am Bildschirm: Im Film gibt es keine Steuerleiste, der
    // Export setzt den Anteil nie (Konzept §5).
    const frei = cardGeometry({ width: 1600, height: 900 }, FOTO, INHALT)
    const belegt = cardGeometry({ width: 1600, height: 900, controls: 1 }, FOTO, INHALT)
    expect(belegt.image.height).toBeLessThan(frei.image.height)
    // Kleiner allein reicht nicht: Zentriert bliebe die Karte in der Leiste
    // hängen (gemessen 48 px Überlappung, als es noch CSS war).
    const mitte = (g: typeof frei) => g.card.y + g.card.height / 2
    expect(mitte(belegt)).toBeLessThan(mitte(frei))
  })

  it('und der Weg dorthin ist STETIG — es gibt jeden Zwischenstand', () => {
    // Als Schalter sprang die Karte zwischen zwei Größen, sobald sich die Maus
    // bewegte oder die UI sich nach 3,2 s zurückzog: ein Umsprung mitten im
    // stehenden Bild, den nichts erklärt. Der Anteil macht daraus eine Bewegung,
    // und dafür muss die Geometrie über ihm MONOTON sein — mit einer Kante
    // darin wäre die gefahrene Größe ein Ruckeln statt eines Zugs.
    const bei = (bedienung: number) =>
      cardGeometry({ width: 1600, height: 900, controls: bedienung }, FOTO, INHALT)
    const stufen = [0, 0.25, 0.5, 0.75, 1].map(bei)
    for (let i = 1; i < stufen.length; i++) {
      expect(stufen[i]!.image.height).toBeLessThan(stufen[i - 1]!.image.height)
      expect(stufen[i]!.card.y + stufen[i]!.card.height / 2).toBeLessThan(
        stufen[i - 1]!.card.y + stufen[i - 1]!.card.height / 2,
      )
    }
    // Die halbe Strecke liegt in der Mitte — eine lineare Mischung, keine Kurve
    // im Maler: Die Kurve gehört der Schicht, die den Anteil fährt.
    expect(stufen[2]!.image.height).toBeCloseTo(
      (stufen[0]!.image.height + stufen[4]!.image.height) / 2,
      6,
    )
    // Ohne Angabe gilt „keine Bedienung" — der Film bekommt sie nie.
    expect(bei(0).card.height).toBe(
      cardGeometry({ width: 1600, height: 900 }, FOTO, INHALT).card.height,
    )
  })

  it('Bild und Beschriftung liegen INNERHALB der Karte', () => {
    const g = cardGeometry({ width: 1600, height: 900 }, FOTO, INHALT)
    expect(g.image.x).toBeGreaterThanOrEqual(g.card.x)
    expect(g.image.y).toBeGreaterThanOrEqual(g.card.y)
    expect(g.image.x + g.image.width).toBeLessThanOrEqual(g.card.x + g.card.width + 0.01)
    // Die Beschriftung endet innerhalb der titel: Die Angabenzeile ist die
    // unterste, seit die Bildunterschrift entfallen ist.
    expect(g.text.facts.y + g.text.facts.height).toBeLessThanOrEqual(
      g.card.y + g.card.height + 0.01,
    )
  })
})

describe('Phasen', () => {
  it('vor dem Klip ist nichts zu sehen, danach nichts mehr', () => {
    expect(cardPhases(-1, KLIP_S).opacity).toBe(0)
    expect(cardPhases(KLIP_S + 1, KLIP_S).opacity).toBe(0)
  })

  it('der Balken läuft über den ganzen Klip', () => {
    expect(cardPhases(0, KLIP_S).bar).toBe(0)
    expect(cardPhases(KLIP_S / 2, KLIP_S).bar).toBeCloseTo(0.5, 6)
    expect(cardPhases(KLIP_S, KLIP_S).bar).toBe(1)
  })

  it('die Beschriftung tritt gestaffelt auf: erst der Titel, dann die Angaben', () => {
    // Die Staffelung steckt im Versatz, nicht in einer Verzögerung — als
    // Transition fing sie beim Klassenwechsel an, ein Scrub mitten in einen Halt
    // hätte sie noch einmal einfliegen lassen.
    const p = cardPhases(0.5, KLIP_S)
    expect(p.title.alpha).toBeGreaterThan(p.facts.alpha)
    // Und sie kommt von unten herauf, nicht aus dem Nichts.
    expect(p.title.lift).toBeGreaterThan(0)
    const fertig = cardPhases(2, KLIP_S)
    for (const t of [fertig.title, fertig.facts]) {
      expect(t.alpha).toBe(1)
      expect(t.lift).toBe(0)
    }
  })

  it('bei reduzierter Bewegung bleibt genau eine Bewegung übrig', () => {
    // Ken Burns aus, Flug aus, Beschriftung sofort da — aber KEIN harter
    // Schnitt: Im Film wäre der ein Bildsprung. Und der Schalter kommt von
    // außen; läse der Maler die Einstellung selbst, hätte der rendernde
    // Rechner Einfluss auf die Datei (Konzept, Falle 2).
    const p = cardPhases(0.1, KLIP_S, { calm: true })
    expect(p.flight).toBe(1)
    expect(p.develop).toBe(1)
    expect(p.kbScale).toBe(CARD.restScale)
    expect(p.title.alpha).toBe(1)
    expect(p.opacity).toBeGreaterThan(0)
    expect(p.opacity).toBeLessThan(1)
    expect(cardPhases(KLIP_S, KLIP_S, { calm: true }).opacity).toBeCloseTo(0, 5)
  })

  it('ein kürzerer Klip drückt Ken Burns zusammen, nicht ab', () => {
    // Die Drift-Dauer IST die Klip-Länge. Eine feste Dauer daneben war die
    // 1-Sekunden-Abweichung aus §6C des Gleichlauf-Konzepts.
    const kurz = 2
    expect(cardPhases(kurz, kurz).kbScale).toBeCloseTo(CARD.kenBurnsTo, 6)
  })
})

describe('Kurven', () => {
  it('eine cubic-bezier trifft ihre Endpunkte und läuft monoton in x', () => {
    const f = bezier(0.25, 0.1, 0.25, 1)
    expect(f(0)).toBe(0)
    expect(f(1)).toBe(1)
    let vor = 0
    for (let t = 0.05; t <= 1; t += 0.05) {
      const v = f(t)
      expect(v).toBeGreaterThanOrEqual(vor - 1e-9)
      vor = v
    }
  })

  it('liest die Flugkurve aus dem Text der Tabelle statt sie nachzubauen', () => {
    // Sie steht als Zeichenkette in `CARD.flugKurve` — dieselbe, die im CSS des
    // Editors landet. Nachgebaute Zahlen wären die nächste Zeile aus §2.2.
    const f = curveFromText(CARD.flightCurve)
    const soll = bezier(0.19, 1.16, 0.32, 1)
    for (const t of [0.1, 0.3, 0.5, 0.7, 0.9]) expect(f(t)).toBeCloseTo(soll(t), 9)
  })

  it('unlesbarer Text ergibt eine gerade Linie und keinen Absturz', () => {
    expect(curveFromText('ease-in-out')(0.4)).toBe(0.4)
  })
})

describe('Text kürzen und umbrechen', () => {
  it('kürzt mit Auslassungszeichen — Canvas kennt kein ellipsis', () => {
    expect(truncateText('Kurz', 400, mass8)).toBe('Kurz')
    const lang = truncateText('Sonnenaufgang über dem Bergkamm', 80, mass8)
    expect(lang.endsWith('…')).toBe(true)
    expect(mass8(lang)).toBeLessThanOrEqual(80)
  })

  it('bricht an Wortgrenzen und hält die Zeilenzahl ein', () => {
    // Die Kartenhöhe ist auf eine feste Zahl Zeilen gerechnet: Eine Zeile mehr
    // schöbe das Bild.
    const zeilen = wrapText('eins zwei drei vier fünf sechs sieben acht', 80, 2, mass8)
    expect(zeilen).toHaveLength(2)
    for (const z of zeilen) expect(mass8(z)).toBeLessThanOrEqual(80)
    expect(zeilen[1]?.endsWith('…')).toBe(true)
  })

  it('was passt, bleibt unangetastet', () => {
    expect(wrapText('eins zwei', 400, 2, mass8)).toEqual(['eins zwei'])
    expect(wrapText('', 400, 2, mass8)).toEqual([])
  })
})
