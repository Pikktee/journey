// Der Kartenmaler — die rechnenden Teile.
//
// Die OPTIK-Zahlen prüft test/einblendung-css.test.ts gegen `KARTE` und
// `studio.html`; hier steht, was es dort nie gab, weil es CSS war: das
// Skalierungsmodell, die Lagen, die Kartengeometrie und das Kürzen von Text.
//
// Warum das eigene Tests braucht und nicht bloß ein Auge: „Deckungsgleich" ist
// nur dann eine prüfbare Aussage, wenn festgeschrieben ist, wie Längen mit dem
// Format wachsen (docs/concepts/konzept_kartenleinwand.md §5). Ein gemeinsamer
// Zeichner allein macht zwei Bühnen nicht deckungsgleich — er macht sie nur
// gleich FALSCH, wenn die Bezugshöhe fehlt.

import { describe, expect, it } from 'vitest'
import { AR_MAX, AR_MIN, HOLD_HIDE, KARTE, klipDauerS } from '../src/einblendung.js'
import {
  BEZUGSHOEHE,
  KARTEN_MASSE,
  MASS_MAX,
  MASS_MIN,
  bezier,
  brichText,
  kartenGeometrie,
  kartenLage,
  kartenMass,
  kartenPhasen,
  kuerzeText,
  kurveAusText,
} from '../src/kartenmaler.js'

const KLIP_S = klipDauerS(HOLD_HIDE)
const FOTO = { art: 'foto', ar: 1.5 } as const
/** Eine Messfunktion ohne Canvas: 8 px je Zeichen reicht für die Bruchlogik. */
const mass8 = (s: string) => s.length * 8

describe('Skalierungsmodell', () => {
  it('bei Bezugshöhe hat jede Länge ihren Nennwert', () => {
    // Die Bezugshöhe ist nicht frei gewählt: Bei 1600 × 900 lagen alle `clamp()`
    // der abgelösten CSS-Fassung auf ihrer Obergrenze. Nur dort schließt ein
    // einziger Faktor an die bestehende Optik an.
    expect(BEZUGSHOEHE).toBe(900)
    expect(kartenMass(BEZUGSHOEHE)).toBe(1)
    const g = kartenGeometrie({ breite: 1600, hoehe: 900 }, FOTO)
    expect(g.kartenRadius).toBe(KARTEN_MASSE.breit.kartenRadius)
    expect(g.text.titel.schrift).toBe(KARTEN_MASSE.breit.titel)
  })

  it('doppelte Höhe heißt doppelte Länge — und das ist der ganze Zweck', () => {
    // Ohne das war die Karte im 4K-Film ein Briefmarkenrahmen mit
    // Fußnotenschrift: Die alten Werte waren feste Pixel, und ein Filmpixel ist
    // kein Bildschirmpixel (Konzept, Falle 6).
    const klein = kartenGeometrie({ breite: 1600, hoehe: 900 }, FOTO)
    const gross = kartenGeometrie({ breite: 3200, hoehe: 1800 }, FOTO)
    expect(gross.mass).toBe(2)
    expect(gross.text.titel.schrift).toBeCloseTo(klein.text.titel.schrift * 2, 6)
    expect(gross.karte.breite).toBeCloseTo(klein.karte.breite * 2, 6)
    expect(gross.karte.hoehe).toBeCloseTo(klein.karte.hoehe * 2, 6)
  })

  it('der Maßstab ist gedeckelt — nach unten und nach oben', () => {
    expect(kartenMass(1)).toBe(MASS_MIN)
    expect(kartenMass(100000)).toBe(MASS_MAX)
  })

  it('die drei Mindest-Schriftgrößen skalieren NICHT mit', () => {
    // Sie sind die eine benannte Ausnahme des Modells: eine Bildschirm-Regel für
    // das Telefon, nicht Kartengeometrie. Im Film greifen sie nie, weil jedes
    // Ausgabeformat über der Bezugshöhe liegt.
    const winzig = kartenGeometrie({ breite: 360, hoehe: 480 }, FOTO)
    const satz = KARTEN_MASSE[winzig.lage]
    expect(winzig.mass).toBeLessThan(1)
    expect(winzig.text.titel.schrift).toBe(satz.titelMindest)
    expect(winzig.text.unter.schrift).toBe(satz.unterMindest)
    expect(winzig.text.pillen.schrift).toBe(satz.pilleMindest)
  })

  it('der Bildradius hat einen Boden — darunter ist er ein Pixelrand', () => {
    const winzig = kartenGeometrie({ breite: 360, hoehe: 480 }, FOTO)
    expect(winzig.rahmenRadius).toBeGreaterThanOrEqual(3)
    // Bei Bezugshöhe steht er auf dem geteilten Wert aus der Tabelle.
    expect(kartenGeometrie({ breite: 1600, hoehe: 900 }, FOTO).rahmenRadius).toBe(
      KARTE.rahmenRadiusPx,
    )
  })
})

describe('Lage — abgeleitet, nicht übergeben', () => {
  it('kennt die drei Fälle an denselben Schwellen wie vorher das CSS', () => {
    expect(kartenLage(1600, 900)).toBe('breit')
    // `body.kompakt-quer` in main.ts: breiter als hoch UND höchstens 560 px hoch.
    expect(kartenLage(900, 500)).toBe('quer')
    expect(kartenLage(900, 600)).toBe('breit')
    // `@media (max-width: 700px)`.
    expect(kartenLage(390, 844)).toBe('schmal')
    // Quer schlägt schmal: Ein liegendes Telefon ist beides, und dort ist die
    // Bühne flach — der Text muss NEBEN das Bild.
    expect(kartenLage(700, 390)).toBe('quer')
  })

  it('quer stellt den Text neben das Bild, breit darunter', () => {
    const quer = kartenGeometrie({ breite: 900, hoehe: 480 }, FOTO)
    expect(quer.lage).toBe('quer')
    expect(quer.text.titel.x).toBeGreaterThan(quer.bild.x + quer.bild.breite)
    const breit = kartenGeometrie({ breite: 1600, hoehe: 900 }, FOTO)
    expect(breit.text.titel.y).toBeGreaterThan(breit.bild.y + breit.bild.hoehe)
  })
})

describe('Kartengeometrie', () => {
  it('Leitgröße ist die HÖHE, die Breite folgt aus dem Seitenverhältnis', () => {
    // Umgekehrt (Breite fest, Höhe folgt) ragte die Karte auf quer gehaltenen
    // Telefonen oben UND unten aus dem Bild — der Grund, aus dem die abgelöste
    // CSS-Fassung es schon so rechnete.
    const hoch = kartenGeometrie({ breite: 1600, hoehe: 900 }, { art: 'foto', ar: 0.7 })
    const quer = kartenGeometrie({ breite: 1600, hoehe: 900 }, { art: 'foto', ar: 1.8 })
    expect(hoch.bild.breite / hoch.bild.hoehe).toBeCloseTo(0.7, 4)
    expect(quer.bild.breite / quer.bild.hoehe).toBeCloseTo(1.8, 4)
    expect(hoch.bild.breite).toBeLessThan(quer.bild.breite)
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
        const g = kartenGeometrie({ breite: b, hoehe: h }, { art: 'foto', ar })
        expect(g.karte.breite, `${b}×${h} ar ${ar}`).toBeLessThanOrEqual(b)
        expect(g.karte.hoehe, `${b}×${h} ar ${ar}`).toBeLessThanOrEqual(h)
        expect(g.karte.x).toBeGreaterThanOrEqual(0)
        expect(g.karte.y).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('klemmt das Seitenverhältnis und nimmt 3:2, wo noch nichts vermessen ist', () => {
    // Das ROHE Verhältnis war eine der sieben Export-Abweichungen: Ein
    // 3:1-Panorama wäre breiter als das Fenster, ein 9:19-Handyfoto höher.
    const panorama = kartenGeometrie({ breite: 1600, hoehe: 900 }, { art: 'foto', ar: 4 })
    expect(panorama.bild.breite / panorama.bild.hoehe).toBeCloseTo(AR_MAX, 4)
    const unbekannt = kartenGeometrie({ breite: 1600, hoehe: 900 }, { art: 'foto', ar: null })
    expect(unbekannt.bild.breite / unbekannt.bild.hoehe).toBeCloseTo(1.5, 4)
  })

  it('macht der stehenden Bedienung Platz und rückt hoch', () => {
    // Das gilt NUR am Bildschirm: Im Film gibt es keine Steuerleiste, der
    // Export setzt den Anteil nie (Konzept §5).
    const frei = kartenGeometrie({ breite: 1600, hoehe: 900 }, FOTO)
    const belegt = kartenGeometrie({ breite: 1600, hoehe: 900, bedienung: 1 }, FOTO)
    expect(belegt.bild.hoehe).toBeLessThan(frei.bild.hoehe)
    // Kleiner allein reicht nicht: Zentriert bliebe die Karte in der Leiste
    // hängen (gemessen 48 px Überlappung, als es noch CSS war).
    const mitte = (g: typeof frei) => g.karte.y + g.karte.hoehe / 2
    expect(mitte(belegt)).toBeLessThan(mitte(frei))
  })

  it('und der Weg dorthin ist STETIG — es gibt jeden Zwischenstand', () => {
    // Als Schalter sprang die Karte zwischen zwei Größen, sobald sich die Maus
    // bewegte oder die UI sich nach 3,2 s zurückzog: ein Umsprung mitten im
    // stehenden Bild, den nichts erklärt. Der Anteil macht daraus eine Bewegung,
    // und dafür muss die Geometrie über ihm MONOTON sein — mit einer Kante
    // darin wäre die gefahrene Größe ein Ruckeln statt eines Zugs.
    const bei = (bedienung: number) =>
      kartenGeometrie({ breite: 1600, hoehe: 900, bedienung }, FOTO)
    const stufen = [0, 0.25, 0.5, 0.75, 1].map(bei)
    for (let i = 1; i < stufen.length; i++) {
      expect(stufen[i]!.bild.hoehe).toBeLessThan(stufen[i - 1]!.bild.hoehe)
      expect(stufen[i]!.karte.y + stufen[i]!.karte.hoehe / 2).toBeLessThan(
        stufen[i - 1]!.karte.y + stufen[i - 1]!.karte.hoehe / 2,
      )
    }
    // Die halbe Strecke liegt in der Mitte — eine lineare Mischung, keine Kurve
    // im Maler: Die Kurve gehört der Schicht, die den Anteil fährt.
    expect(stufen[2]!.bild.hoehe).toBeCloseTo(
      (stufen[0]!.bild.hoehe + stufen[4]!.bild.hoehe) / 2,
      6,
    )
    // Ohne Angabe gilt „keine Bedienung" — der Film bekommt sie nie.
    expect(bei(0).karte.hoehe).toBe(kartenGeometrie({ breite: 1600, hoehe: 900 }, FOTO).karte.hoehe)
  })

  it('Bild und Beschriftung liegen INNERHALB der Karte', () => {
    const g = kartenGeometrie({ breite: 1600, hoehe: 900 }, FOTO)
    expect(g.bild.x).toBeGreaterThanOrEqual(g.karte.x)
    expect(g.bild.y).toBeGreaterThanOrEqual(g.karte.y)
    expect(g.bild.x + g.bild.breite).toBeLessThanOrEqual(g.karte.x + g.karte.breite + 0.01)
    const unterEnde =
      g.text.unter.y + g.text.unter.zeile * KARTEN_MASSE.breit.unterZeilen
    expect(unterEnde).toBeLessThanOrEqual(g.karte.y + g.karte.hoehe + 0.01)
  })
})

describe('Phasen', () => {
  it('vor dem Klip ist nichts zu sehen, danach nichts mehr', () => {
    expect(kartenPhasen(-1, KLIP_S).sicht).toBe(0)
    expect(kartenPhasen(KLIP_S + 1, KLIP_S).sicht).toBe(0)
  })

  it('der Balken läuft über den ganzen Klip', () => {
    expect(kartenPhasen(0, KLIP_S).balken).toBe(0)
    expect(kartenPhasen(KLIP_S / 2, KLIP_S).balken).toBeCloseTo(0.5, 6)
    expect(kartenPhasen(KLIP_S, KLIP_S).balken).toBe(1)
  })

  it('die Beschriftung tritt gestaffelt auf: Titel, Unterschrift, Pille', () => {
    // Die Staffelung steckt im Versatz, nicht in einer Verzögerung — als
    // Transition fing sie beim Klassenwechsel an, ein Scrub mitten in einen Halt
    // hätte sie noch einmal einfliegen lassen.
    const p = kartenPhasen(0.5, KLIP_S)
    expect(p.titel.deckkraft).toBeGreaterThan(p.unter.deckkraft)
    expect(p.unter.deckkraft).toBeGreaterThan(p.pille.deckkraft)
    // Und sie kommt von unten herauf, nicht aus dem Nichts.
    expect(p.titel.hub).toBeGreaterThan(0)
    const fertig = kartenPhasen(2, KLIP_S)
    for (const t of [fertig.titel, fertig.unter, fertig.pille]) {
      expect(t.deckkraft).toBe(1)
      expect(t.hub).toBe(0)
    }
  })

  it('bei reduzierter Bewegung bleibt genau eine Bewegung übrig', () => {
    // Ken Burns aus, Flug aus, Beschriftung sofort da — aber KEIN harter
    // Schnitt: Im Film wäre der ein Bildsprung. Und der Schalter kommt von
    // außen; läse der Maler die Einstellung selbst, hätte der rendernde
    // Rechner Einfluss auf die Datei (Konzept, Falle 2).
    const p = kartenPhasen(0.1, KLIP_S, { ruhig: true })
    expect(p.flug).toBe(1)
    expect(p.entwickeln).toBe(1)
    expect(p.kbSkala).toBe(KARTE.ruheSkala)
    expect(p.titel.deckkraft).toBe(1)
    expect(p.sicht).toBeGreaterThan(0)
    expect(p.sicht).toBeLessThan(1)
    expect(kartenPhasen(KLIP_S, KLIP_S, { ruhig: true }).sicht).toBeCloseTo(0, 5)
  })

  it('ein kürzerer Klip drückt Ken Burns zusammen, nicht ab', () => {
    // Die Drift-Dauer IST die Klip-Länge. Eine feste Dauer daneben war die
    // 1-Sekunden-Abweichung aus §6C des Gleichlauf-Konzepts.
    const kurz = 2
    expect(kartenPhasen(kurz, kurz).kbSkala).toBeCloseTo(KARTE.kenBurnsBis, 6)
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
    // Sie steht als Zeichenkette in `KARTE.flugKurve` — dieselbe, die im CSS des
    // Editors landet. Nachgebaute Zahlen wären die nächste Zeile aus §2.2.
    const f = kurveAusText(KARTE.flugKurve)
    const soll = bezier(0.19, 1.16, 0.32, 1)
    for (const t of [0.1, 0.3, 0.5, 0.7, 0.9]) expect(f(t)).toBeCloseTo(soll(t), 9)
  })

  it('unlesbarer Text ergibt eine gerade Linie und keinen Absturz', () => {
    expect(kurveAusText('ease-in-out')(0.4)).toBe(0.4)
  })
})

describe('Text kürzen und umbrechen', () => {
  it('kürzt mit Auslassungszeichen — Canvas kennt kein ellipsis', () => {
    expect(kuerzeText('Kurz', 400, mass8)).toBe('Kurz')
    const lang = kuerzeText('Sonnenaufgang über dem Bergkamm', 80, mass8)
    expect(lang.endsWith('…')).toBe(true)
    expect(mass8(lang)).toBeLessThanOrEqual(80)
  })

  it('bricht an Wortgrenzen und hält die Zeilenzahl ein', () => {
    // Die Kartenhöhe ist auf eine feste Zahl Zeilen gerechnet: Eine Zeile mehr
    // schöbe das Bild.
    const zeilen = brichText('eins zwei drei vier fünf sechs sieben acht', 80, 2, mass8)
    expect(zeilen).toHaveLength(2)
    for (const z of zeilen) expect(mass8(z)).toBeLessThanOrEqual(80)
    expect(zeilen[1]?.endsWith('…')).toBe(true)
  })

  it('was passt, bleibt unangetastet', () => {
    expect(brichText('eins zwei', 400, 2, mass8)).toEqual(['eins zwei'])
    expect(brichText('', 400, 2, mass8)).toEqual([])
  })
})
