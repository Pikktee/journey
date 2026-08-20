// Die Wetter-Regel, die Player und Editor teilen: aus Lage und Stärke werden
// Deckung, Schwere und Nebel — im Player für Atmosphäre und Grading, im Editor
// für den flachen Schleier über der Karte.

import { describe, expect, it } from 'vitest'
import {
  bildwirkung,
  himmelBei,
  schleierFuer,
  WETTER_HIMMEL,
  type SzenenWetter,
} from '../src/wetterhimmel.js'
// Die Studio-Liste und nicht die des Servers: Sie ist von hier importierbar
// (server/ hat einen eigenen `rootDir`) und ihrerseits gegen das Server-Schema
// gewacht — test/studio-baukasten.test.ts vergleicht beide.
import { WETTER_MODI } from '../src/studio/editmodell.js'

const TRAVEL_MODES: SzenenWetter[] = ['off', 'clouds', 'fog', 'rain', 'snow', 'storm']

describe('himmelBei', () => {
  it('kennt jede Lage, die das Overlay setzen kann', () => {
    // Die Liste ist die des Servers — läuft sie auseinander, zeigt der Editor
    // für eine gültige Grenze gar nichts, und niemand meldet es.
    for (const m of WETTER_MODI) expect(WETTER_HIMMEL[m as SzenenWetter]).toBeDefined()
  })

  it('spannt die Deckung über die Stärke', () => {
    const leicht = himmelBei('clouds', 0.4)
    const stark = himmelBei('clouds', 1)
    expect(leicht.cover).toBeCloseTo(0.28, 3) // einzelne Wolken, Sonne frei
    expect(stark.cover).toBeCloseTo(0.98, 3) // geschlossene Decke
  })

  // Auch leichter Regen fällt nicht aus heiterem Himmel — die
  // Niederschlags-Lagen starten deutlich über „wolkig".
  it('lässt Niederschlag schon bei geringer Stärke bedeckt sein', () => {
    expect(himmelBei('rain', 0.4).cover).toBeGreaterThan(himmelBei('clouds', 0.4).cover)
    expect(himmelBei('storm', 0.4).cover).toBeGreaterThan(himmelBei('rain', 0.4).cover)
  })

  // Unterhalb der UI-Stufen (künftiges stufenloses Echtwetter) bleibt die
  // Deckung am unteren Ende der Spanne, statt unter sie zu fallen.
  it('klemmt unter der kleinsten Stufe statt zu unterschreiten', () => {
    expect(himmelBei('rain', 0).cover).toBeCloseTo(WETTER_HIMMEL.rain.c0, 3)
    expect(himmelBei('rain', -1).cover).toBeCloseTo(WETTER_HIMMEL.rain.c0, 3)
  })

  it('gibt bei `off` überall null', () => {
    expect(himmelBei('off', 1)).toEqual({ cover: 0, dark: 0, fog: 0 })
  })
})

describe('schleierFuer', () => {
  it('zeigt bei `off` nichts', () => {
    expect(schleierFuer('off', 1)).toEqual({ wasch: '', schatten: '', nebel: 0, schnee: 0 })
  })

  // Der Punkt der ganzen Umstellung: `clouds` und `fog` haben im
  // Partikel-Overlay KEIN Profil — dort blieb die Karte leer. Hier haben sie
  // eine Farbe wie jede andere Lage.
  it('stellt JEDE Lage dar, auch die ohne Partikel', () => {
    for (const m of TRAVEL_MODES.filter((x) => x !== 'off')) {
      const s = schleierFuer(m, 0.7)
      expect(s.wasch, `${m} ohne Farbschleier`).not.toBe('')
      expect(s.schatten, `${m} ohne Abdunklung`).not.toBe('')
    }
  })

  it('wird mit der Stärke dichter', () => {
    const a = alpha(schleierFuer('rain', 0.4).wasch)
    const b = alpha(schleierFuer('rain', 1).wasch)
    expect(b).toBeGreaterThan(a)
  })

  // Der Schleier färbt die Karte, er deckt sie nicht zu — man arbeitet
  // darunter. Gemessen wird das an der sichtbaren HELLIGKEIT und nicht an der
  // Summe der Deckkräfte: Zwei helle Flächen (Nebel) machen das Bild heller,
  // nicht unlesbarer, und ein Alpha-Grenzwert verbietet ausgerechnet die Lage,
  // die dicht sein SOLL.
  it.each(['clouds', 'fog', 'rain', 'snow', 'storm'] as SzenenWetter[])(
    'löscht die Karte auch bei voller Stärke nicht aus (%s)',
    (m) => {
      // Grenzen am RECHENwert des Testfelds; das echte Kartenmittel liegt
      // heller. Es geht um „noch zu bearbeiten", nicht um einen Sollwert.
      const g = ueberGrau(m)[1] as number
      expect(g, `${m} zu dunkel`).toBeGreaterThan(55)
      expect(g, `${m} zu milchig`).toBeLessThan(200)
    },
  )

  // Nur Schnee legt sich auf den BODEN — dieselbe Kopplung wie im Player
  // (`dayNight.setSnow`), damit eine Winterfahrt eine weiße Landschaft zeigt
  // und nicht bloß einen grauen Schleier darüber.
  it('gibt nur bei Schnee eine Schneedecke', () => {
    expect(schleierFuer('snow', 1).schnee).toBeGreaterThan(0)
    for (const m of TRAVEL_MODES.filter((x) => x !== 'snow')) {
      expect(schleierFuer(m, 1).schnee, `${m} sollte keinen Bodenschnee haben`).toBe(0)
    }
  })

  it('nennt Nebel nur, wo Nebel ist', () => {
    expect(schleierFuer('fog', 1).nebel).toBeGreaterThan(0.5)
    expect(schleierFuer('clouds', 1).nebel).toBe(0)
  })
})

/** Deckkraft aus einer `rgba(…)`-Zeichenkette. */
function alpha(farbe: string): number {
  const m = /rgba\([^)]*,\s*([\d.]+)\s*\)/.exec(farbe)
  expect(m, `keine rgba-Farbe: ${farbe}`).not.toBeNull()
  return Number((m as RegExpExecArray)[1])
}

describe('die Lagen sind voneinander zu unterscheiden', () => {
  // Der Test, der diese Datei überhaupt nötig gemacht hat. Eine erste Fassung
  // skalierte alle Lagen aus derselben Formel (`cover`/`dark`) — und weil beide
  // bei fast jeder Lage gegen dasselbe Maximum laufen, sahen sie bei voller
  // Stärke gleich aus: gemessen alle fünf zwischen rgb(94) und rgb(126),
  // Wolken und Nebel trennten 9 von 765 möglichen Stufen. Am Bildschirm war
  // das „fast kein Unterschied", und genau so wurde es gemeldet.
  const PAARE: Array<[SzenenWetter, SzenenWetter]> = []
  const LAGEN: SzenenWetter[] = ['clouds', 'fog', 'rain', 'snow', 'storm']
  for (let i = 0; i < LAGEN.length; i++)
    for (let j = i + 1; j < LAGEN.length; j++) PAARE.push([LAGEN[i]!, LAGEN[j]!])

  // Die Zahl hier ist ein REGRESSIONSSCHUTZ, kein Abnahmekriterium: Sie rechnet
  // auf einem einzelnen Farbwert, das echte Bild ist eine Landschaft aus
  // Tausenden. Abgenommen wird am Screenshot (scripts/messungen — mittlere
  // Helligkeit je Lage), und dort lagen die fünf Lagen zuletzt bei 85 · 169 ·
  // 79 · 179 · 62 gegen 94 ohne Wetter. Was dieser Test verhindern soll, ist
  // der Rückfall in den gemeldeten Zustand „fast kein Unterschied" — damals
  // trennten Wolken und Nebel 9 von 765 Stufen.
  it.each(PAARE)('%s und %s sehen verschieden aus', (a, b) => {
    expect(abstand(ueberGrau(a), ueberGrau(b))).toBeGreaterThanOrEqual(30)
  })

  // Die Reihenfolge ist die Aussage: Nebel verschluckt (am hellsten), Schnee
  // hellt auf, Wolken dämpfen, Regen kühlt ab, Gewitter verdunkelt.
  it('ordnet sich von hell nach dunkel wie die Lagen selbst', () => {
    const hell = (m: SzenenWetter) => ueberGrau(m)[1] as number
    expect(hell('fog')).toBeGreaterThan(hell('snow'))
    expect(hell('snow')).toBeGreaterThan(hell('clouds'))
    expect(hell('clouds')).toBeGreaterThan(hell('rain'))
    expect(hell('rain')).toBeGreaterThan(hell('storm'))
  })
})

/** Der Schleier einer Lage über einem mittleren Grau — was man am Ende sieht. */
function ueberGrau(m: SzenenWetter, k = 1): number[] {
  // Ein typisches Satellitengrün, KEIN Grau: Auf einem grauen Feld ist eine
  // Entsättigung wirkungslos, und die trägt bei mehreren Lagen den größten
  // Teil des Unterschieds. Ein Test auf grauem Grund hätte sie übersehen.
  const LAND = [96, 112, 78]
  const b = bildwirkung(m, k)
  // 1. Grading: Helligkeit als Faktor, Sättigung als Zug zur Luminanz.
  const hell = LAND.map((x) => Math.max(0, Math.min(255, x * b.helligkeit)))
  const lum =
    0.2126 * (hell[0] as number) + 0.7152 * (hell[1] as number) + 0.0722 * (hell[2] as number)
  const grau = Math.min(1, Math.abs(b.saettigung))
  const gegradet = hell.map((x) => x + (lum - x) * grau)
  // 2. Schleier darüber, in derselben Reihenfolge wie im CSS.
  const s = schleierFuer(m, k)
  const zahl = (f: string) =>
    (/rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/.exec(f) ?? []).slice(1).map(Number)
  const legen = (unten: number[], oben: number[]): number[] => {
    const al = oben[3] ?? 0
    return unten.map((x, i) => Math.round(x + ((oben[i] ?? 0) - x) * al))
  }
  return legen(legen(gegradet, zahl(s.wasch)), zahl(s.schatten))
}

const abstand = (a: number[], b: number[]): number =>
  a.reduce((s, x, i) => s + Math.abs(x - (b[i] ?? 0)), 0)
