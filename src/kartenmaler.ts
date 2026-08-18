// Die Foto-Karte auf eine Leinwand — der Maler.
//
// Er ist DOM-frei: Er kennt keine Elemente, nur Werte. Was er zeichnet, kommt
// aus dem Tour-JSON und aus einer FILMSEKUNDE, nicht aus `textContent`. Das ist
// der Punkt des ganzen Umbaus (docs/concepts/konzept_kartenleinwand.md §3.2):
// Vorher las der Video-Export die Texte aus dem DOM zurück, das der Player
// gerade gefüllt hatte, und malte alles andere ein zweites Mal — mit Ken Burns
// in der Gegenrichtung, ohne „Entwickeln", ohne Blitz, ohne Balken.
//
// Die geteilten ZAHLEN stehen weiter in `einblendung.ts` (§3.5). Hier steht nur
// die Geometrie der Player-Bühne, die es dort nie gab: Kartengröße, Polster,
// Schriftgrade, Textumbruch. Sie war bis Etappe 2 CSS.
//
// Drei Dinge, die man beim Lesen leicht für Nachlässigkeit hält und die
// ausdrücklich so gewollt sind:
//
//   1. `prefers-reduced-motion` ist ein SCHALTER im Aufruf (`buehne.ruhig`) und
//      kein `matchMedia` hier drin (Falle 2). Der Maler läuft auch im Export,
//      und die Einstellung des rendernden Rechners darf die ausgelieferte Datei
//      nicht verändern.
//   2. Das „Entwickeln" ist eine ÜBERBLENDUNG zweier gepufferter Fassungen und
//      kein `ctx.filter` pro Frame (§5A). Die Kurvenmitte weicht dadurch messbar
//      ab — erwartet, mit eigener Toleranz in der Abnahme.
//   3. Der Schleier ist am Bildschirm eine DOM-Schicht UNTER der Leinwand (§4).
//      Der Maler malt ihn nur, wenn `schleier: 'flach'` — das ist die benannte
//      Bühnen-Variante des Films.

import {
  AR_MIN,
  AR_MAX,
  KARTE,
  KARTE_BUEHNE,
  kartenZeiten,
  balkenAnteil,
} from './einblendung.js'

/**
 * Höhe, bei der jede Länge im Maler ihren Nennwert hat (CSS-Pixel).
 *
 * Nicht frei gewählt: Bei 1600 × 900 liegen alle `clamp()` der abgelösten
 * CSS-Fassung auf ihrer Obergrenze — dort, und nur dort, sind die festen Pixel
 * und die vw-Anteile deckungsgleich, ein einziger Faktor schließt also an die
 * bestehende Optik an. Mit 1080 wäre der Bildschirm bei 800 px Höhe am Tag des
 * Umbaus sichtbar anders geworden (Konzept §5, „Skalierungsmodell").
 */
export const BEZUGSHOEHE = 900

/** Grenzen des Maßstabs: unter 0,7 wird nichts mehr lesbar, über 2,6 nur groß. */
export const MASS_MIN = 0.7
export const MASS_MAX = 2.6

/** Der Maßstab dieser Bühne. Jede Länge im Maler läuft durch ihn. */
export function kartenMass(hoehe: number): number {
  return klemme(hoehe / BEZUGSHOEHE, MASS_MIN, MASS_MAX)
}

export type KartenLage = 'breit' | 'schmal' | 'quer'

/**
 * Die Bühnen, die diesen Maler benutzen.
 *
 * `player` ist zugleich die Bühne des FILMS: Der Export malt dieselbe Geometrie,
 * er komponiert sie nur anders (Schleier flach, keine Steuerleiste). `editor`
 * ist die kleine Karte auf dem Leuchttisch der Editor-Bühne.
 */
export type KartenBuehnenName = 'player' | 'editor'

/**
 * Welche Lage gilt — auf der Player-Bühne abgeleitet, nicht übergeben.
 *
 * Dieselben Schwellen, an denen bis Etappe 2 `body.kompakt-quer` (main.ts,
 * `KOMPAKT_HOEHE`) und `@media (max-width: 700px)` hingen. Ein eigener Schalter
 * im Aufruf wäre dort eine zweite Wahrheit über dieselbe Geometrie.
 *
 * Auf der EDITOR-Bühne gilt das nicht (Konzept „Eine Bühne, ein Maler", Falle 5):
 * Eine Editor-Fläche von etwa 700 × 500 ist breiter als hoch und höchstens 560
 * hoch, fiele hier also in `quer` und bekäme das Layout „Bild links, Text rechts"
 * eines liegenden Telefons. Die Lage gehört deshalb zum Bühnen-Satz und wird
 * dort gesetzt — s. `kartenSatz`.
 */
export function kartenLage(breite: number, hoehe: number): KartenLage {
  if (breite > hoehe && hoehe <= 560) return 'quer'
  if (breite <= 700) return 'schmal'
  return 'breit'
}

/** Ein Satz Nennmaße (bei Bezugshöhe, in CSS-Pixeln). */
export interface KartenMassSatz {
  /** Rand der Papierkarte um das Bild. */
  polster: number
  /** Reserve für Beschriftung und Luft — die Leitgröße der Kartenhöhe. */
  chrome: number
  /** Dieselbe Reserve, solange die Steuerleiste STEHT (nur am Bildschirm). */
  chromeBedienung: number
  /** Anteil der Bühnenbreite, den die Karte höchstens einnimmt. */
  breiteAnteil: number
  /** Obergrenze der Bildbreite. */
  breiteMax: number
  /** Polster der Beschriftung: oben, seitlich, unten. */
  textOben: number
  textSeiten: number
  textUnten: number
  /** Lücken zwischen den Beschriftungsteilen. */
  lueckeX: number
  lueckeY: number
  titel: number
  titelMindest: number
  titelZeile: number
  /**
   * Uhrzeit und Kilometerstand. Hieß bis zum Wegfall des Rahmens `pille` — sie
   * standen in einem eigenen Kasten, und der sagte „hier steht eine Marke",
   * wo nur eine Angabe steht.
   */
  angaben: number
  angabenMindest: number
  /** Höhe des Standzeit-Balkens am unteren Bildrand. */
  balken: number
  kartenRadius: number
  /** Seitenlänge des Ton-Knopfes im Video und sein Abstand zur Bildecke. */
  tonSeite: number
  tonRand: number
  /** Wie weit die Karte hochrückt, solange die Bedienung steht. */
  hubBedienung: number
}

/**
 * Die Nennmaße der drei Lagen der PLAYER-Bühne.
 *
 * Die Zahlen der Lage `breit` sind die, die die abgelöste CSS-Fassung bei
 * 1600 × 900 ergab; `schmal` und `quer` stammen aus deren Media-Query bzw. aus
 * `body.kompakt-quer`. Sie stehen hier und nicht in `einblendung.ts`, weil der
 * Editor eine eigene, kleine Karte auf einem Leuchttisch hat (`EDITOR_MASSE`
 * weiter unten): Diese Geometrie ist nicht geteilt und war es nie (§3.7 — was
 * verschieden sein darf, steht als solches da).
 */
export const KARTEN_MASSE: Record<KartenLage, KartenMassSatz> = {
  breit: {
    polster: 16,
    chrome: 235,
    // 380 und nicht die 335 der CSS-Fassung: Auf einem 1080p-Bildschirm blieben
    // damit 31 px zwischen Kartenkante und Steuerleiste — zu wenig, um als Luft
    // zu lesen, und die Bildunterschrift stand knapp über der Leiste. Gemessen
    // am Halt, nicht geschätzt.
    chromeBedienung: 380,
    breiteAnteil: 0.92,
    breiteMax: 1500,
    textOben: 13,
    textSeiten: 6,
    // 18 statt 15: Gemessen stehen über dem Titel 22,4 px, darunter waren es
    // 22,2 — gleich viel, und damit wirkte die Karte nach unten offen. Mit 18
    // sind es 25,2. Dieselbe Rechnung wie im Editor, nur eine Bühne kleiner.
    textUnten: 18,
    lueckeX: 16,
    lueckeY: 2,
    titel: 32,
    titelMindest: 19,
    titelZeile: 1.2,
    angaben: 12.5,
    angabenMindest: 9.5,
    balken: 4,
    kartenRadius: 12,
    tonSeite: 40,
    tonRand: 10,
    // 64 und nicht die 48 der CSS-Fassung: Mit der kleineren Karte
    // (`chromeBedienung` 380) blieben oben 94 und unten 57 px — die Karte saß
    // sichtbar tief. Jetzt liegt sie mittig zwischen dem Weg hinaus und der
    // Steuerleiste. Gemessen auf 1080p.
    hubBedienung: 64,
  },
  schmal: {
    polster: 10,
    chrome: 205,
    chromeBedienung: 335,
    breiteAnteil: 0.89,
    breiteMax: 1500,
    textOben: 10,
    textSeiten: 4,
    textUnten: 12,
    lueckeX: 10,
    lueckeY: 6,
    titel: 19,
    titelMindest: 15,
    titelZeile: 1.25,
    angaben: 10,
    angabenMindest: 8.5,
    balken: 4,
    kartenRadius: 12,
    tonSeite: 34,
    tonRand: 8,
    hubBedienung: 48,
  },
  quer: {
    polster: 9,
    chrome: 64,
    chromeBedienung: 116,
    breiteAnteil: 0.62,
    breiteMax: 1500,
    textOben: 4,
    textSeiten: 6,
    textUnten: 4,
    lueckeX: 12,
    lueckeY: 9,
    titel: 17,
    titelMindest: 14,
    titelZeile: 1.25,
    angaben: 10,
    angabenMindest: 8.5,
    balken: 4,
    kartenRadius: 12,
    tonSeite: 34,
    tonRand: 8,
    hubBedienung: 22,
  },
}

/**
 * Der Satz der EDITOR-Bühne — eine kleine Karte auf einem Leuchttisch.
 *
 * Er ist keine Variante der drei oben, sondern ihr Gegenstück: Die Player-Bühne
 * ist der Bildschirm, die Editor-Bühne ist die Kartenfläche neben der
 * Zeitleiste. Die Zahlen schließen an das abgelöste CSS von `studio.html` an
 * (`.foto-einblendung`, `.fe-frame`, `.fe-cap`) — dort standen sie als feste
 * Pixel und Container-Query-Anteile.
 *
 * Die eine, die man nicht raten darf, ist `chrome`: `hoehe − chrome × mass` ist
 * die Bildhöhe, und weil `mass` im ungeklemmten Bereich `hoehe / 900` IST, ergibt
 * 306 = 0,34 × 900 genau die `66cqh` der CSS-Fassung — bei jeder Bühnenhöhe.
 * Die Beschriftung reserviert EINE Zeile (`unterZeilen`), nicht zwei wie im
 * Player: Dort steht eine Bildunterschrift, hier „15:58 Uhr · km 12,3".
 */
export const EDITOR_MASSE: KartenMassSatz = {
  // 12 und nicht mehr 22: Der breite Rand stammt aus der Zeit, als die Karte
  // gegen einen hellen Schleier stand und ihn brauchte, um sich zu halten.
  // Heute liegt sie auf einem dunklen Bild und trägt sich selbst; die Breite
  // bekommt das Bild. Der FUSS bleibt der eine breite Rand — das ist die Form
  // jedes Passepartouts, und sie liest sich nur als gewollt, solange oben und
  // seitlich gleich schmal sind.
  polster: 12,
  chrome: 306,
  // Der Editor hat keine Steuerleiste, die Platz verlangt — derselbe Wert.
  chromeBedienung: 306,
  breiteAnteil: 0.82,
  breiteMax: 1600,
  textOben: 18,
  textSeiten: 10,
  // Am MALER gemessen (nicht am Entwurf, dort galt eine andere Geometrie und
  // eine 6 sah richtig aus): Über dem Titel stehen 25 px bis zur
  // Versalienoberkante, darunter mit 24 noch 27,5 bis zur Kartenkante. Etwas
  // mehr unten ist richtig — über dem Titel drückt das Bild, unter ihm steht
  // nichts mehr. Mit 6 waren es 13,5 unten gegen 25 oben, und die Karte sah
  // unten abgeschnitten aus.
  textUnten: 24,
  lueckeX: 20,
  lueckeY: 5,
  titel: 40,
  titelMindest: 17,
  titelZeile: 1.15,
  angaben: 19,
  angabenMindest: 11,
  balken: 5,
  kartenRadius: 22,
  // Und keinen Ton-Knopf: Der Ton des Videos läuft, bedient wird er nicht.
  tonSeite: 0,
  tonRand: 0,
  hubBedienung: 0,
}

/**
 * Maßstabsgrenzen der Editor-Bühne.
 *
 * Weiter unten als die des Players (0,7), weil die Bühne selbst kleiner ist: Mit
 * 0,7 wäre bei 480 px Höhe schon geklemmt, das Bild bekäme statt 66 % nur 55 %
 * der Fläche und die Karte säße auf einem Leuchttisch, der ihr nicht passt.
 */
export const EDITOR_MASS_MIN = 0.55
export const EDITOR_MASS_MAX = 1.8

/** Lage der Editor-Bühne — GESETZT und nicht abgeleitet (Falle 5, s. `kartenLage`). */
export const EDITOR_LAGE: KartenLage = 'breit'

/** Was eine Bühne dem Maler an Geometrie vorgibt. */
export interface KartenSatz {
  lage: KartenLage
  satz: KartenMassSatz
  mass: number
  /** Flugweite des Auftritts — die eine benannte Bühnen-Variante. */
  flugHubPx: number
}

/** Maßsatz, Lage und Maßstab dieser Bühne. */
export function kartenSatz(buehne: KartenBuehne): KartenSatz {
  if (buehne.name === 'editor') {
    return {
      lage: EDITOR_LAGE,
      satz: EDITOR_MASSE,
      mass: klemme(buehne.hoehe / BEZUGSHOEHE, EDITOR_MASS_MIN, EDITOR_MASS_MAX),
      flugHubPx: KARTE_BUEHNE.flugHubPx.editor,
    }
  }
  const lage = kartenLage(buehne.breite, buehne.hoehe)
  return {
    lage,
    satz: KARTEN_MASSE[lage],
    mass: kartenMass(buehne.hoehe),
    flugHubPx: KARTE_BUEHNE.flugHubPx.player,
  }
}

/** Boden des Bildradius: darunter ist es kein Radius mehr, nur ein Pixelrand. */
const RAHMEN_RADIUS_MIN = 3

/** Farben der Karte. Bewusst hier und nicht als Token-Lesung: der Maler ist DOM-frei. */
export const KARTEN_FARBEN = {
  papier: '#f6f1e7',
  titel: '#1c1712',
  /**
   * Die Angaben stehen zweistufig: Die ZIFFERN tragen die Auskunft, „Uhr" und
   * „km" sagen nur, wovon die Rede ist.
   */
  angabenZahl: 'rgba(28, 23, 18, 0.82)',
  angabenWort: 'rgba(28, 23, 18, 0.5)',
  /** Bildfeld, solange das Foto noch fehlt — dasselbe Papiergrau wie vorher. */
  bildfeld: '#d8d2c4',
  video: '#000',
  // 0.16 statt 0.3: Der ungespielte Rest lag als grauer Streifen über dem
  // Bildfuß und las sich fast wie ein Fehler des Fotos.
  balken: 'rgba(10, 8, 5, 0.16)',
  balkenVon: '#f5a524',
  balkenBis: '#ff6f52',
  schatten: 'rgba(0, 0, 0, 0.55)',
} as const

export interface KartenBuehne {
  /** Bühnenbreite in CSS-Pixeln — NIE in Gerätepixeln (Falle 6). */
  breite: number
  hoehe: number
  /**
   * Welche Bühne — Vorgabe `player`. Sie entscheidet über Maßsatz, Lage,
   * Maßstabsgrenzen und Flugweite (`kartenSatz`), über nichts sonst: Alles, was
   * auf beiden Bühnen gleich AUSSEHEN soll, steht in `KARTE`.
   */
  name?: KartenBuehnenName
  /**
   * Wie weit die Steuerleiste STEHT — 0 = zurückgezogen, 1 = ganz da.
   *
   * Ein Anteil und kein Schalter: Die Karte macht der Leiste Platz und rückt
   * hoch, und das soll man ihr ansehen. Als Boolean sprang sie zwischen zwei
   * Größen, sobald sich die Maus bewegte oder die UI sich nach 3,2 s zurückzog —
   * ein Umsprung mitten im stehenden Bild, den nichts erklärt. Wer den Anteil
   * über die Zeit führt (`kartenschicht.ts`), bekommt aus demselben Umstand eine
   * Bewegung, die als gewollt liest.
   *
   * Nur am Bildschirm: Im Film gibt es keine Leiste, der Export setzt das
   * niemals (Konzept §5).
   */
  bedienung?: number
  /**
   * `prefers-reduced-motion` — als Schalter, nicht als Blick nach draußen
   * (Falle 2). Im Export immer `false`.
   */
  ruhig?: boolean
  /**
   * Schleier hinter der Karte. Am Bildschirm `'aus'`: Dort liegt eine
   * DOM-Schicht mit `backdrop-filter` UNTER der Leinwand, und die hat auf einer
   * Leinwand kein Gegenstück (§4). Im Film `'flach'` — die benannte
   * Bühnen-Variante.
   */
  schleier?: 'aus' | 'flach'
}

export interface KartenMedium {
  art: 'foto' | 'video'
  /**
   * Seitenverhältnis des RAHMENS — geklemmt (`klemmeSeitenverhaeltnis`).
   * `null` = noch nicht vermessen, dann gilt 3:2 wie in der CSS-Fassung.
   */
  ar: number | null
  /** Ken-Burns für dieses Medium abgeschaltet (`display.kenBurns === false`). */
  keinKenBurns?: boolean
}

export interface KartenText {
  titel: string
  /** „12.3 km" im Player; im Editor leer (dort trägt die Karte keine Pille). */
  kmText: string
  /** „1/2" — leer, wenn der Halt nur eine Aufnahme hat. */
  zaehlerText: string
}

export interface KartenQuelle {
  bild: CanvasImageSource
  /** Intrinsische Maße — nötig für `cover`, und `CanvasImageSource` nennt sie nicht. */
  breite: number
  hoehe: number
  /**
   * Kennung des Materials. Wechselt sie, werden die Puffer neu gebacken;
   * bliebe sie gleich, zeigte die Karte das vorige Foto entwickelt weiter.
   */
  kennung: string
}

export interface KartenStand {
  /** Stand IM Klip in Sekunden. Vor dem Auftritt negativ. */
  imS: number
  /** Länge des Klips: Standzeit plus Ausblendung (`klipDauerS`). */
  dauerS: number
  medium: KartenMedium
  text: KartenText
  /**
   * Die Zeichenquelle, oder `null`. Der Aufrufer sagt mit `bereit`, dass der
   * FRAME steht — `drawImage` auf einem noch suchenden `<video>` zeichnet ohne
   * Fehler das alte Bild, und im Film ist das ein falsches Einzelbild in der
   * Datei (Konzept §5, „Bild und Video").
   */
  quelle: KartenQuelle | null
  bereit: boolean
}

export interface Rechteck {
  x: number
  y: number
  breite: number
  hoehe: number
}

/**
 * Was der Aufrufer über die gemalte Karte wissen muss.
 *
 * Vor allem die Rechtecke: Die Bedienung bleibt DOM (§3.3), also müssen ihre
 * Flächen MITGEFÜHRT werden. Ein statischer Kasten wäre falsch, sobald die
 * Karte springt, weil die Bedienung erscheint oder verschwindet (Falle 5).
 * Alle Rechtecke gelten in CSS-Pixeln der Bühne und sind schon bewegt (Flug,
 * Abgang) — bis auf die Drehung, die eine DOM-Fläche nicht braucht.
 */
export interface KartenMasse {
  karte: Rechteck
  bild: Rechteck
  /** Ton-Knopf des Videos; `null` bei einem Foto. */
  ton: Rechteck | null
  /** Deckkraft der ganzen Karte — die DOM-Bedienung blendet mit. */
  sicht: number
  /** Der Maßstab dieser Bühne. */
  mass: number
  lage: KartenLage
}

/** Was der Maler gemalt hat. `bereit: false` = der Frame stand nicht. */
export interface KartenErgebnis {
  masse: KartenMasse | null
  bereit: boolean
}

// — Kurven —

/**
 * Eine CSS-`cubic-bezier` als Funktion. Newton auf x, Bisektion als Netz.
 *
 * Der Player brauchte das bis Etappe 2 nicht: Die Kurven standen in CSS, und
 * CSS rechnet sie selbst. Auf einer Leinwand muss der Maler sie kennen — und
 * zwar dieselben, sonst fliegt die Karte im Film anders herein als am
 * Bildschirm.
 */
export function bezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const a = (a1: number, a2: number) => 1 - 3 * a2 + 3 * a1
  const b = (a1: number, a2: number) => 3 * a2 - 6 * a1
  const c = (a1: number) => 3 * a1
  const wert = (t: number, a1: number, a2: number) => ((a(a1, a2) * t + b(a1, a2)) * t + c(a1)) * t
  const steigung = (t: number, a1: number, a2: number) =>
    3 * a(a1, a2) * t * t + 2 * b(a1, a2) * t + c(a1)
  return (x: number): number => {
    if (x <= 0) return 0
    if (x >= 1) return 1
    let t = x
    for (let i = 0; i < 6; i++) {
      const s = steigung(t, x1, x2)
      if (Math.abs(s) < 1e-6) break
      const d = wert(t, x1, x2) - x
      if (Math.abs(d) < 1e-6) break
      t -= d / s
    }
    if (t < 0 || t > 1) {
      let lo = 0
      let hi = 1
      t = x
      for (let i = 0; i < 24; i++) {
        const d = wert(t, x1, x2) - x
        if (Math.abs(d) < 1e-6) break
        if (d > 0) hi = t
        else lo = t
        t = (lo + hi) / 2
      }
    }
    return wert(t, y1, y2)
  }
}

/** `cubic-bezier(a, b, c, d)` aus einem CSS-Text — `KARTE.flugKurve` ist einer. */
export function kurveAusText(css: string): (t: number) => number {
  const m = /cubic-bezier\(\s*([\d.-]+)\s*,\s*([\d.-]+)\s*,\s*([\d.-]+)\s*,\s*([\d.-]+)\s*\)/.exec(css)
  if (!m) return (t) => t
  return bezier(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]))
}

/** Die drei benannten CSS-Kurven, die die abgelöste Fassung benutzte. */
export const KURVE = {
  ease: bezier(0.25, 0.1, 0.25, 1),
  easeOut: bezier(0, 0, 0.58, 1),
  easeIn: bezier(0.42, 0, 1, 1),
  /** Der Flug — aus derselben Zeichenkette, die der Editor in seinem CSS hat. */
  flug: kurveAusText(KARTE.flugKurve),
  /** Die Beschriftung tritt gestaffelt auf. */
  text: bezier(0.22, 1, 0.36, 1),
} as const

/** Staffelung der Beschriftung: erst der Titel, dann die Angaben (Sekunden). */
export const TEXT_VERSATZ_S = { titel: 0.35, angaben: 0.5 } as const
export const TEXT_DAUER_S = 0.6
/** Weg, den ein Beschriftungsteil beim Auftritt zurücklegt (bei Bezugshöhe). */
export const TEXT_HUB_PX = 10

/** Auftritt eines Beschriftungsteils. */
export interface TextAuftritt {
  deckkraft: number
  /** Restweg nach oben, in Nennpixeln (0 = angekommen). */
  hub: number
}

/**
 * Der ganze sichtbare Zustand der Karte zu einer Filmsekunde.
 *
 * DOM-frei und ohne Leinwand — genau deshalb ist er prüfbar, und genau darauf
 * liegt der Wächter (test/einblendung-css.test.ts) seit Etappe 2: Er vergleicht
 * nicht mehr CSS gegen CSS, sondern diese Rechnung gegen `studio.html`.
 */
export interface KartenPhasen {
  /** Deckkraft der Karte insgesamt: Blende herein, Abgang heraus. */
  sicht: number
  /** Flug 0..1 — 1 = in Ruhe. */
  flug: number
  /** Abgang 0..1 — 0 = steht noch aus. */
  abgang: number
  /** Ken-Burns-Skala des Bildes im Rahmen. */
  kbSkala: number
  /** „Entwickeln" 0..1 — 0 = frisch aus der Kamera, 1 = fertig. */
  entwickeln: number
  /** Füllstand des Standzeit-Balkens. */
  balken: number
  titel: TextAuftritt
  angaben: TextAuftritt
}

function klemme(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

function klemme01(v: number): number {
  return klemme(v, 0, 1)
}

function mische(von: number, bis: number, t: number): number {
  return von + (bis - von) * t
}

function textAuftritt(imS: number, versatzS: number, ruhig: boolean): TextAuftritt {
  if (ruhig) return { deckkraft: 1, hub: 0 }
  const t = KURVE.text(klemme01((imS - versatzS) / TEXT_DAUER_S))
  return { deckkraft: t, hub: (1 - t) * TEXT_HUB_PX }
}

/**
 * Aus Filmsekunde und Klip-Länge alles Sichtbare.
 *
 * Bei `ruhig` (reduzierte Bewegung) bleibt genau eine Bewegung übrig: eine
 * kurze Deckkraft-Blende. Die abgelöste CSS-Fassung machte es ebenso — sie
 * setzte `animation: none` und ließ `transition: opacity 0.2s` stehen. Ein
 * harter Schnitt wäre hier falsch: Im Film wäre er ein Bildsprung.
 */
export function kartenPhasen(
  imS: number,
  dauerS: number,
  opt: { keinKenBurns?: boolean; ruhig?: boolean } = {},
): KartenPhasen {
  const z = kartenZeiten(imS, dauerS)
  const balken = balkenAnteil(imS, dauerS)
  const ruhig = opt.ruhig === true
  const stehendeSkala = KARTE.ruheSkala

  if (ruhig) {
    const RUHIG_BLENDE_S = 0.2
    const auf = klemme01(imS / RUHIG_BLENDE_S)
    const ab = z.ausZeitS < 0 ? klemme01(-z.ausZeitS / Math.max(0.01, z.ausDauerS)) : 0
    return {
      sicht: auf * (1 - ab),
      flug: 1,
      abgang: 0,
      kbSkala: stehendeSkala,
      entwickeln: 1,
      balken,
      titel: { deckkraft: 1, hub: 0 },
      angaben: { deckkraft: 1, hub: 0 },
    }
  }

  const blende = KURVE.ease(klemme01((imS - KARTE.blendeVersatzS) / KARTE.blendeDauerS))
  const flug = KURVE.flug(klemme01(imS / KARTE.flugDauerS))
  const abgang =
    z.ausZeitS < 0 ? KURVE.easeIn(klemme01(-z.ausZeitS / Math.max(0.01, z.ausDauerS))) : 0
  const entwickeln = KURVE.easeOut(klemme01(imS / KARTE.entwickelnDauerS))
  const kbAnteil = KURVE.easeOut(klemme01(imS / Math.max(0.1, z.kbDauerS)))
  const kbSkala = opt.keinKenBurns
    ? stehendeSkala
    : mische(KARTE.kenBurnsVon, KARTE.kenBurnsBis, kbAnteil)

  return {
    sicht: blende * (1 - abgang),
    flug,
    abgang,
    kbSkala,
    entwickeln,
    balken,
    titel: textAuftritt(imS, TEXT_VERSATZ_S.titel, false),
    angaben: textAuftritt(imS, TEXT_VERSATZ_S.angaben, false),
  }
}

// — Geometrie —

export interface KartenGeometrie {
  mass: number
  lage: KartenLage
  satz: KartenMassSatz
  /** Karte in Ruhelage (ohne Flug/Abgang), zentriert auf der Bühne. */
  karte: Rechteck
  bild: Rechteck
  /** Die Beschriftung, in Karten-Koordinaten (relativ zu `karte`). */
  text: {
    titel: { x: number; y: number; breite: number; schrift: number }
    /**
     * Uhrzeit und Kilometerstand. `x` ist die RECHTE Kante: Die Zeile steht
     * rechts, auch wenn links kein Titel dasteht. Wanderte sie bei einer
     * unbeschrifteten Aufnahme nach links, bewegte sich beim Blättern
     * ausgerechnet das Einzige, was in der Karte bleibt.
     */
    angaben: { x: number; y: number; hoehe: number; schrift: number }
  }
  rahmenRadius: number
  kartenRadius: number
  balkenHoehe: number
}

/**
 * Was der Maler über den INHALT wissen muss, bevor er die Karte vermisst.
 *
 * Die Geometrie hing bis hierher nur an Bühne und Medium. Das reichte, solange
 * jede Karte dieselben Textzeilen hatte. Seit die Beschriftung wegfallen kann
 * (kein Titel, keine Bildunterschrift) und die Angaben je nach Platz auf der
 * Titelzeile stehen oder darunter, entscheidet der Inhalt über die Höhe.
 *
 * Nicht enthalten ist der Titel selbst: Ob einer dasteht, ändert die Höhe
 * NICHT — die Zeile behält den Titelgrad, sonst wäre die unbeschriftete Karte
 * flacher als die beschriftete und die Form spränge beim Blättern.
 */
export interface KartenInhalt {
  /** Stehen Uhrzeit und km unter dem Titel statt neben ihm? */
  angabenEigeneZeile: boolean
}

/** Nennmaß × Maßstab, aber nie unter einem Mindestwert (die Lesbarkeits-Böden). */
function grad(nenn: number, mass: number, mindest: number): number {
  return Math.max(mindest, nenn * mass)
}

/**
 * Die Kartengeometrie dieser Bühne — ohne jede Bewegung.
 *
 * Leitgröße ist die HÖHE: Von ihr geht die Chrome-Reserve ab, der Rest ist das
 * Bild, die Breite folgt aus dem Seitenverhältnis. Umgekehrt (Breite fest, Höhe
 * folgt) ragte die Karte auf quer gehaltenen Telefonen oben UND unten aus dem
 * Bild — der Grund, aus dem die CSS-Fassung es schon so rechnete.
 */
export function kartenGeometrie(
  buehne: KartenBuehne,
  medium: KartenMedium,
  inhalt: KartenInhalt,
): KartenGeometrie {
  const { breite, hoehe } = buehne
  const { mass, lage, satz } = kartenSatz(buehne)
  const px = (nenn: number) => nenn * mass

  const ar = klemme(medium.ar ?? 1.5, AR_MIN, AR_MAX)
  // Die Reserve wächst STETIG mit der Leiste, sie schaltet nicht um: Zwischen
  // beiden Werten liegt jeder Zwischenstand, und den fährt die Schicht ab.
  const bed = klemme(buehne.bedienung ?? 0, 0, 1)
  const chrome = px(mische(satz.chrome, satz.chromeBedienung, bed))
  const maxB = Math.min(px(satz.breiteMax), breite * satz.breiteAnteil)
  const bildH = Math.max(1, Math.min(hoehe - chrome, maxB / ar))
  const bildB = Math.max(1, bildH * ar)

  const titelSchrift = grad(satz.titel, mass, satz.titelMindest)
  const angabenSchrift = grad(satz.angaben, mass, satz.angabenMindest)
  const titelH = titelSchrift * satz.titelZeile
  // Die Zeile der Angaben ist so hoch wie die des Titels, auch wenn keiner
  // dasteht. Sonst wäre die unbeschriftete Karte um die Differenz flacher.
  const angabenH = titelH

  const polster = px(satz.polster)
  const textOben = px(satz.textOben)
  const textSeiten = px(satz.textSeiten)
  const textUnten = px(satz.textUnten)
  const lueckeX = px(satz.lueckeX)
  const lueckeY = px(satz.lueckeY)

  let karteB: number
  let karteH: number
  let bildX: number
  let bildY: number
  const text: KartenGeometrie['text'] = {
    titel: { x: 0, y: 0, breite: 0, schrift: titelSchrift },
    angaben: { x: 0, y: 0, hoehe: angabenH, schrift: angabenSchrift },
  }

  if (lage === 'quer') {
    // Bild links, Text als eigene Spalte rechts.
    //
    // Der Textblock reserviert `unterZeilen` Zeilen für die Bildunterschrift,
    // aber nur so viele, wie wirklich gebraucht werden: Fällt die Unterschrift
    // weg, entstünde hier sonst eine Lücke MITTEN in der Spalte, weil sie
    // senkrecht zentriert sitzt.
    const spalteB = Math.min(breite * 0.34, px(280))
    const blockH = titelH + lueckeY + angabenH
    karteB = polster * 2 + bildB + lueckeX + spalteB
    karteH = polster * 2 + Math.max(bildH, blockH)
    bildX = polster
    bildY = (karteH - bildH) / 2
    const sx = polster + bildB + lueckeX
    const innen = spalteB - textSeiten
    let y = (karteH - blockH) / 2
    text.titel = { x: sx, y, breite: innen, schrift: titelSchrift }
    y += titelH + lueckeY
    text.angaben = { x: sx + innen, y, hoehe: angabenH, schrift: angabenSchrift }
  } else {
    // Titel links, Angaben rechts — auf DERSELBEN Zeile, solange beide
    // nebeneinander passen. Die Lagen `breit` und `schmal` unterscheiden sich
    // dabei nicht mehr: Sie taten es nur wegen „Weiter ▸", der die untere
    // Zeile für sich brauchte.
    karteB = bildB + polster * 2
    bildX = polster
    bildY = polster
    const innenX = polster + textSeiten
    const innenB = bildB - textSeiten * 2
    let y = polster + bildH + textOben
    text.titel = { x: innenX, y, breite: innenB, schrift: titelSchrift }
    if (inhalt.angabenEigeneZeile) {
      y += titelH + lueckeY
      text.angaben = { x: innenX + innenB, y, hoehe: angabenH, schrift: angabenSchrift }
      y += angabenH
    } else {
      text.angaben = { x: innenX + innenB, y, hoehe: angabenH, schrift: angabenSchrift }
      y += titelH
    }
    karteH = y + textUnten
  }

  const x = (breite - karteB) / 2
  const yMitte = (hoehe - karteH) / 2 - px(satz.hubBedienung) * bed

  // Bis hier ist alles KARTEN-relativ gerechnet, weil die Beschriftung sich an
  // Bild und Kartenrand ausrichtet. Nach außen gilt EIN Bezugssystem: die Bühne.
  // Zwei gemischte Systeme waren der erste Fehler dieses Malers — die
  // Textblöcke landeten in der Lage `quer` um die halbe Kartenbreite versetzt.
  text.titel = { ...text.titel, x: text.titel.x + x, y: text.titel.y + yMitte }
  text.angaben = { ...text.angaben, x: text.angaben.x + x, y: text.angaben.y + yMitte }

  return {
    mass,
    lage,
    satz,
    karte: { x, y: yMitte, breite: karteB, hoehe: karteH },
    bild: { x: x + bildX, y: yMitte + bildY, breite: bildB, hoehe: bildH },
    text,
    rahmenRadius: Math.max(RAHMEN_RADIUS_MIN, px(KARTE.rahmenRadiusPx)),
    kartenRadius: px(satz.kartenRadius),
    balkenHoehe: px(satz.balken),
  }
}

// — Puffer —
//
// „Canvas ist nicht von selbst schneller" (Falle 9). Drei Dinge dürfen pro Frame
// NICHT passieren: Text messen und setzen, `ctx.filter` auswerten, `shadowBlur`
// auf die große Karte legen. Alle drei landen deshalb einmal in einem Puffer und
// werden danach geblittet.

interface Puffer {
  leinwand: HTMLCanvasElement
  /** Maße in CSS-Pixeln (die Leinwand selbst ist `dichte`-fach so groß). */
  breite: number
  hoehe: number
}

const PUFFER_MAX = 20
const puffer = new Map<string, Puffer>()

function hole(
  schluessel: string,
  breite: number,
  hoehe: number,
  dichte: number,
  malen: (ctx: CanvasRenderingContext2D, b: number, h: number) => void,
): Puffer | null {
  const da = puffer.get(schluessel)
  if (da) {
    // Neu einsortieren: der zuletzt gebrauchte fällt nicht als Erster heraus.
    puffer.delete(schluessel)
    puffer.set(schluessel, da)
    return da
  }
  const b = Math.max(1, Math.round(breite))
  const h = Math.max(1, Math.round(hoehe))
  const leinwand = document.createElement('canvas')
  leinwand.width = Math.max(1, Math.round(b * dichte))
  leinwand.height = Math.max(1, Math.round(h * dichte))
  const ctx = leinwand.getContext('2d')
  if (!ctx) return null
  ctx.scale(leinwand.width / b, leinwand.height / h)
  malen(ctx, b, h)
  const neu: Puffer = { leinwand, breite: b, hoehe: h }
  puffer.set(schluessel, neu)
  while (puffer.size > PUFFER_MAX) {
    const erster = puffer.keys().next().value
    if (erster === undefined) break
    puffer.delete(erster)
  }
  return neu
}

/** Alle Puffer wegwerfen — beim Verlassen der Tour und bei einem Formatwechsel. */
export function raeumeKartenPuffer(): void {
  puffer.clear()
}

/** Wird `ctx.filter` überhaupt ausgewertet? Ohne ihn bleibt das Bild ungefiltert. */
let filterKann: boolean | null = null
function kannFilter(): boolean {
  if (filterKann !== null) return filterKann
  const c = document.createElement('canvas')
  const x = c.getContext('2d')
  filterKann = false
  if (x) {
    try {
      x.filter = 'brightness(1.2)'
      filterKann = x.filter !== 'none' && x.filter !== ''
    } catch {
      filterKann = false
    }
  }
  return filterKann
}

function filterText(f: { brightness: number; contrast: number; saturate: number }): string {
  return `brightness(${f.brightness}) contrast(${f.contrast}) saturate(${f.saturate})`
}

/**
 * Das Bild in EINER Fassung, `cover` in den Rahmen gerechnet und auf
 * Ken-Burns-Anfangsgröße gepuffert.
 *
 * Gepuffert wird genau deshalb, was §5A als ersten Ausweg nennt: Zwei Fassungen
 * (frisch und entwickelt) und eine Überblendung dazwischen — statt `ctx.filter`
 * pro Frame, der je nach Browser nicht beschleunigt ist und im Repo bis heute
 * nirgends vorkam.
 */
function bildPuffer(
  quelle: KartenQuelle,
  rahmenB: number,
  rahmenH: number,
  dichte: number,
  filter: string | null,
  passend: 'cover' | 'contain',
): Puffer | null {
  const zoom = KARTE.kenBurnsVon
  const b = rahmenB * zoom
  const h = rahmenH * zoom
  const schluessel = `bild|${quelle.kennung}|${Math.round(b)}x${Math.round(h)}|${dichte.toFixed(2)}|${filter ?? 'roh'}|${passend}`
  return hole(schluessel, b, h, dichte, (ctx, bb, hh) => {
    const arQuelle = quelle.breite > 0 && quelle.hoehe > 0 ? quelle.breite / quelle.hoehe : bb / hh
    const arRahmen = bb / hh
    const deckt = passend === 'cover' ? arQuelle > arRahmen : arQuelle < arRahmen
    let zb = bb
    let zh = hh
    if (deckt) {
      zh = hh
      zb = hh * arQuelle
    } else {
      zb = bb
      zh = bb / arQuelle
    }
    if (passend === 'contain') {
      ctx.fillStyle = KARTEN_FARBEN.video
      ctx.fillRect(0, 0, bb, hh)
    }
    if (filter && kannFilter()) ctx.filter = filter
    try {
      ctx.drawImage(quelle.bild, (bb - zb) / 2, (hh - zh) / 2, zb, zh)
    } catch {
      /* Quelle noch nicht dekodiert — der nächste Frame holt es nach */
    }
    ctx.filter = 'none'
  })
}

/**
 * Der Schatten der Karte, einmal gebacken.
 *
 * Bewusst in EIGENER Auflösung (1×) und nicht in der der Bühne: Ein Verlauf über
 * 140 px hat keine feine Struktur, ein 4K-Puffer dafür kostete nur Speicher.
 * Pro Frame wäre es zwei `shadowBlur`-Rasterisierungen einer bühnengroßen Form —
 * genau der Unterschied zwischen „Canvas ist schneller als DOM" und dem
 * Gegenteil (§5A).
 */
function schattenPuffer(breite: number, hoehe: number, radius: number, mass: number): Puffer | null {
  const rand = Math.ceil(200 * mass)
  const b = breite + rand * 2
  const h = hoehe + rand * 2
  const schluessel = `schatten|${Math.round(breite)}x${Math.round(hoehe)}|${radius.toFixed(1)}|${mass.toFixed(2)}`
  return hole(schluessel, b, h, 1, (ctx) => {
    const zeichne = (blur: number, hub: number, farbe: string) => {
      ctx.save()
      ctx.shadowColor = farbe
      ctx.shadowBlur = blur * mass
      ctx.shadowOffsetY = hub * mass
      ctx.fillStyle = '#000'
      ctx.beginPath()
      ctx.roundRect(rand, rand, breite, hoehe, radius)
      ctx.fill()
      ctx.restore()
    }
    zeichne(140, 50, 'rgba(0, 0, 0, 0.7)')
    zeichne(36, 12, 'rgba(0, 0, 0, 0.5)')
    // Die Karte selbst wird pro Frame scharf darüber gemalt — im Puffer steht
    // nur der Schatten, also wird die Fläche darunter wieder freigeräumt.
    ctx.save()
    ctx.globalCompositeOperation = 'destination-out'
    ctx.beginPath()
    ctx.roundRect(rand, rand, breite, hoehe, radius)
    ctx.fill()
    ctx.restore()
  })
}

// — Text —

function schrift(groesse: number, gewicht: number): string {
  return `${gewicht} ${groesse.toFixed(2)}px Outfit, system-ui, sans-serif`
}

/**
 * Auf eine Breite kürzen. Canvas kennt kein `text-overflow: ellipsis` — das
 * fehlte bis Etappe 2 im Repo ganz (§4).
 */
export function kuerzeText(text: string, maxPx: number, mass: (s: string) => number): string {
  if (!text || mass(text) <= maxPx) return text
  let s = text
  while (s.length > 1 && mass(`${s}…`) > maxPx) s = s.slice(0, -1)
  return `${s.trimEnd()}…`
}

/**
 * An Wortgrenzen umbrechen, auf höchstens `zeilen` Zeilen, die letzte gekürzt.
 *
 * `brichAttribution` in exportfilm.ts bricht an den Quellen-Trennern und ist
 * dasselbe Muster für einen anderen Text; hier zählt zusätzlich die
 * Höchstzahl der Zeilen, weil die Kartenhöhe darauf gerechnet ist.
 */
export function brichText(
  text: string,
  maxPx: number,
  zeilen: number,
  mass: (s: string) => number,
): string[] {
  if (!text) return []
  const worte = text.split(/\s+/).filter(Boolean)
  const alle: string[] = []
  let zeile = ''
  for (const wort of worte) {
    const kandidat = zeile ? `${zeile} ${wort}` : wort
    if (zeile && mass(kandidat) > maxPx) {
      alle.push(zeile)
      zeile = wort
    } else {
      zeile = kandidat
    }
  }
  if (zeile) alle.push(zeile)
  if (alle.length <= zeilen) return alle
  // Was nicht mehr passt, wandert in die letzte erlaubte Zeile und wird dort
  // gekürzt — abgeschnitten ohne Zeichen wäre eine stillschweigende Lüge.
  const rest = alle.slice(zeilen - 1).join(' ')
  return [...alle.slice(0, zeilen - 1), kuerzeText(rest, maxPx, mass)]
}

interface TextPufferWunsch {
  schluessel: string
  breite: number
  hoehe: number
  malen: (ctx: CanvasRenderingContext2D) => void
}

function malTextPuffer(
  ctx: CanvasRenderingContext2D,
  dichte: number,
  wunsch: TextPufferWunsch,
  x: number,
  y: number,
  deckkraft: number,
): void {
  if (deckkraft <= 0.004) return
  const p = hole(wunsch.schluessel, wunsch.breite, wunsch.hoehe, dichte, (c) => wunsch.malen(c))
  if (!p) return
  const alt = ctx.globalAlpha
  ctx.globalAlpha = alt * deckkraft
  ctx.drawImage(p.leinwand, x, y, p.breite, p.hoehe)
  ctx.globalAlpha = alt
}

// — Der Maler —

/**
 * Die Karte auf einen 2D-Kontext, aus Filmsekunde und Halt.
 *
 * Der Kontext trägt seine Auflösung als Transformation (der Aufrufer setzt sie);
 * der Maler rechnet ausschließlich in CSS-Pixeln (Falle 6). Die Dichte liest er
 * nur für die Auflösung der PUFFER aus der Matrix — nie für Geometrie.
 */
export function maleKarte(
  ctx: CanvasRenderingContext2D,
  buehne: KartenBuehne,
  stand: KartenStand,
): KartenErgebnis {
  const phasen = kartenPhasen(stand.imS, stand.dauerS, {
    ...(stand.medium.keinKenBurns === true ? { keinKenBurns: true } : {}),
    ...(buehne.ruhig === true ? { ruhig: true } : {}),
  })
  const dichte = klemme(Math.abs(ctx.getTransform().a) || 1, 1, 3)
  // Der INHALT entscheidet über die Höhe: keine Bildunterschrift, keine Zeile
  // dafür. Und Titel und Angaben teilen sich eine Zeile, solange sie
  // nebeneinander passen — das kann erst entschieden werden, wenn beide
  // gemessen sind, also einmal vermessen, prüfen, im Bedarfsfall neu vermessen.
  // Die Geometrie ist reine Rechnung, ein zweiter Durchgang kostet nichts.
  let g = kartenGeometrie(buehne, stand.medium, { angabenEigeneZeile: false })
  const eigeneZeile = angabenPasstNicht(ctx, g, stand.text)
  if (eigeneZeile) g = kartenGeometrie(buehne, stand.medium, { angabenEigeneZeile: true })

  // Hier lag der Kamerablitz — ein Radialverlauf über der Szene und unter der
  // Karte, die teuerste einzelne Operation eines Kartenbildes (2,0 gegen 1,1 ms
  // im Median). Er ist zurückgebaut: Auf seiner Spitze steht die Karte bei 7 %
  // Deckkraft und das „Entwickeln" bei `brightness(1.45)` — das Foto war dort
  // schon ein heller Schleier, der Blitz legte eine zweite weiße Schicht auf
  // eine, die längst da war. Die Begründung in voller Länge steht bei `KARTE`
  // (einblendung.ts); den Halt markiert seither der Schleier allein.

  if (phasen.sicht <= 0.004) return { masse: null, bereit: true }

  // Der flache Schleier ist die benannte Bühnen-Variante des Films (§4). Am
  // Bildschirm malt ihn niemand hier: Dort liegt eine DOM-Schicht mit
  // `backdrop-filter` unter der Leinwand, und die kann eine Leinwand nicht.
  if (buehne.schleier === 'flach') {
    ctx.save()
    ctx.globalAlpha = phasen.sicht
    ctx.fillStyle = KARTE.schleierFarbe
    ctx.fillRect(0, 0, buehne.breite, buehne.hoehe)
    ctx.restore()
  }

  // Flug und Abgang: um die Kartenmitte, damit die Drehung nicht am Eck hängt.
  const hubFlug = mische(kartenSatz(buehne).flugHubPx * g.mass, 0, phasen.flug)
  const skalaFlug = mische(KARTE.flugSkala, 1, phasen.flug)
  const drehFlug = mische(KARTE.flugDrehungGrad, KARTE.ruheDrehungGrad, phasen.flug)
  // `rotateX` unter `perspective` hat auf einer Leinwand kein Gegenstück; die
  // Kippung wird als Stauchung angenähert. Sie liegt ganz in den ersten 0,95 s,
  // also im Toleranzfenster der Abnahme (Konzept, Etappe 2).
  const kippung = mische(KARTE.flugKippungGrad, 0, phasen.flug)
  const stauchung = Math.cos((kippung * Math.PI) / 180)

  const hubAb = KARTE.abgangHubPx * g.mass * phasen.abgang
  const skalaAb = mische(1, KARTE.abgangSkala, phasen.abgang)
  const drehAb = mische(KARTE.ruheDrehungGrad, KARTE.abgangDrehungGrad, phasen.abgang)

  const skala = skalaFlug * skalaAb
  const dreh = phasen.abgang > 0 ? drehAb : drehFlug
  const versatzY = hubFlug + hubAb
  const mx = g.karte.x + g.karte.breite / 2
  const my = g.karte.y + g.karte.hoehe / 2

  ctx.save()
  ctx.globalAlpha = phasen.sicht
  ctx.translate(mx, my + versatzY)
  ctx.rotate((dreh * Math.PI) / 180)
  ctx.scale(skala, skala * stauchung)
  ctx.translate(-g.karte.breite / 2, -g.karte.hoehe / 2)

  // Papier mit Schatten. Der Schatten kommt aus dem Puffer, das Papier wird
  // scharf gemalt — ein gemeinsamer Puffer machte die Kartenkante weich.
  const sch = schattenPuffer(g.karte.breite, g.karte.hoehe, g.kartenRadius, g.mass)
  if (sch) {
    const rand = (sch.breite - g.karte.breite) / 2
    ctx.drawImage(sch.leinwand, -rand, -rand, sch.breite, sch.hoehe)
  }
  ctx.fillStyle = KARTEN_FARBEN.papier
  ctx.beginPath()
  ctx.roundRect(0, 0, g.karte.breite, g.karte.hoehe, g.kartenRadius)
  ctx.fill()

  // Bildfeld
  const bx = g.bild.x - g.karte.x
  const by = g.bild.y - g.karte.y
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(bx, by, g.bild.breite, g.bild.hoehe, g.rahmenRadius)
  ctx.clip()
  ctx.fillStyle = stand.medium.art === 'video' ? KARTEN_FARBEN.video : KARTEN_FARBEN.bildfeld
  ctx.fillRect(bx, by, g.bild.breite, g.bild.hoehe)

  let bereit = true
  if (stand.quelle && stand.bereit) {
    if (stand.medium.art === 'video') {
      // Video: `contain`, schwarzer Rahmen, kein Ken Burns und kein
      // „Entwickeln" — wie in der abgelösten CSS-Fassung. Und ohne Puffer: Der
      // Frame wechselt, ein Puffer wäre pro Bild ein neuer.
      malVideo(ctx, stand.quelle, bx, by, g.bild.breite, g.bild.hoehe)
    } else {
      bereit = malFoto(ctx, stand.quelle, phasen, bx, by, g.bild, dichte)
    }
  } else if (stand.quelle) {
    bereit = false
  }

  // Standzeit-Balken am unteren Bildrand
  const balkenY = by + g.bild.hoehe - g.balkenHoehe
  ctx.fillStyle = KARTEN_FARBEN.balken
  ctx.fillRect(bx, balkenY, g.bild.breite, g.balkenHoehe)
  if (phasen.balken > 0) {
    const verlauf = ctx.createLinearGradient(bx, 0, bx + g.bild.breite, 0)
    verlauf.addColorStop(0, KARTEN_FARBEN.balkenVon)
    verlauf.addColorStop(1, KARTEN_FARBEN.balkenBis)
    ctx.fillStyle = verlauf
    ctx.fillRect(bx, balkenY, g.bild.breite * phasen.balken, g.balkenHoehe)
  }
  ctx.restore()

  malBeschriftung(ctx, g, stand.text, phasen, dichte, eigeneZeile)
  ctx.restore()

  // Die Rechtecke der DOM-Bedienung — bewegt, aber ohne Drehung: Eine
  // unsichtbare Klickfläche braucht sie nicht, und eine gedrehte Fläche wäre
  // schwerer zu treffen als die Karte, die man sieht.
  const skaliere = (r: Rechteck): Rechteck => ({
    x: mx + (r.x - mx) * skala,
    y: my + versatzY + (r.y - my) * skala * stauchung,
    breite: r.breite * skala,
    hoehe: r.hoehe * skala * stauchung,
  })
  const tonRoh: Rechteck | null =
    stand.medium.art === 'video' && g.satz.tonSeite > 0
      ? {
          x: g.bild.x + g.bild.breite - (g.satz.tonSeite + g.satz.tonRand) * g.mass,
          y: g.bild.y + g.satz.tonRand * g.mass,
          breite: g.satz.tonSeite * g.mass,
          hoehe: g.satz.tonSeite * g.mass,
        }
      : null

  return {
    bereit,
    masse: {
      karte: skaliere(g.karte),
      bild: skaliere(g.bild),
      ton: tonRoh ? skaliere(tonRoh) : null,
      sicht: phasen.sicht,
      mass: g.mass,
      lage: g.lage,
    },
  }
}

function malVideo(
  ctx: CanvasRenderingContext2D,
  quelle: KartenQuelle,
  x: number,
  y: number,
  b: number,
  h: number,
): void {
  const ar = quelle.breite > 0 && quelle.hoehe > 0 ? quelle.breite / quelle.hoehe : b / h
  let zb = b
  let zh = b / ar
  if (zh > h) {
    zh = h
    zb = h * ar
  }
  try {
    ctx.drawImage(quelle.bild, x + (b - zb) / 2, y + (h - zh) / 2, zb, zh)
  } catch {
    /* Frame noch nicht dekodiert */
  }
}

/**
 * Das Foto mit Ken Burns und „Entwickeln".
 *
 * Zwei Puffer, eine Überblendung: `entwickelnVon` liegt unten, `entwickelnBis`
 * darüber mit der Deckkraft des Fortschritts. Das ist eine NÄHERUNG — die drei
 * Filterwerte laufen gleichzeitig und multiplizieren sich, und `brightness(1.45)`
 * schneidet Lichter ab; das Mischen zweier beschnittener Bilder ist nicht
 * dasselbe wie das Beschneiden des gemischten (§5A). Sichtbar ist das
 * voraussichtlich nicht, nachweisbar schon.
 */
function malFoto(
  ctx: CanvasRenderingContext2D,
  quelle: KartenQuelle,
  phasen: KartenPhasen,
  x: number,
  y: number,
  bild: Rechteck,
  dichte: number,
): boolean {
  const von = bildPuffer(quelle, bild.breite, bild.hoehe, dichte, filterText(KARTE.entwickelnVon), 'cover')
  const bis = bildPuffer(quelle, bild.breite, bild.hoehe, dichte, filterText(KARTE.entwickelnBis), 'cover')
  if (!von || !bis) return false
  // Der Puffer steht auf Ken-Burns-Anfangsgröße; gezeichnet wird der Stand.
  const skala = phasen.kbSkala / KARTE.kenBurnsVon
  const zb = von.breite * skala
  const zh = von.hoehe * skala
  const zx = x + (bild.breite - zb) / 2
  const zy = y + (bild.hoehe - zh) / 2
  const t = phasen.entwickeln
  if (t < 1) ctx.drawImage(von.leinwand, zx, zy, zb, zh)
  if (t > 0) {
    const alt = ctx.globalAlpha
    ctx.globalAlpha = alt * (t < 1 ? t : 1)
    ctx.drawImage(bis.leinwand, zx, zy, zb, zh)
    ctx.globalAlpha = alt
  }
  return true
}

/**
 * Passen Titel und Angaben nebeneinander?
 *
 * Wenn nicht, bekommt jede ihre eigene Zeile. Die Karte ist so breit wie ihr
 * Bild, und bei einer Hochkant-Aufnahme sind das keine 200 px: Dort blieben
 * dem Titel gemessene 64 px bei 158 gebrauchten, er wäre also zu „Ha…" gekürzt
 * gewesen, obwohl darunter eine ganze Zeile frei war.
 *
 * In der Lage `quer` gibt es die Frage nicht — dort stehen beide ohnehin
 * untereinander in der Spalte.
 */
function angabenPasstNicht(
  ctx: CanvasRenderingContext2D,
  g: KartenGeometrie,
  text: KartenText,
): boolean {
  if (g.lage === 'quer') return false
  const angaben = angabenText(text)
  if (!angaben || !text.titel) return false
  ctx.save()
  let breite = 0
  for (const t of teileAngaben(angaben)) {
    ctx.font = schrift(g.text.angaben.schrift, t.zahl ? 500 : 400)
    breite += ctx.measureText(t.stueck).width
  }
  ctx.font = schrift(g.text.titel.schrift, 600)
  const titelB = ctx.measureText(text.titel).width
  ctx.restore()
  // Der geforderte Zwischenraum ist DOPPELT so groß wie der gesetzte: Passen
  // beide nur mit einer Lücke nebeneinander, stehen sie zwar nebeneinander,
  // lesen sich aber als ein Block. An der Hochkant-Karte (323 px breit)
  // ergaben sich rechnerisch 285 verfügbare gegen 284 gebrauchte Pixel — sie
  // berührten sich fast, und genau dieser Fall soll zwei Zeilen bekommen.
  return titelB + g.satz.lueckeX * g.mass * 2 + breite > g.text.titel.breite
}

/**
 * Uhrzeit und Kilometerstand als EIN Text: „14:54 Uhr · 4,1 km".
 *
 * Zwei Felder und eine Zeile, weil beide dasselbe beantworten (wo in der Tour
 * ist das hier) und je Bühne verschieden belegt sind: Der Player schickt die
 * Zählung und den Kilometerstand, der Editor Uhrzeit und Kilometerstand.
 */
export function angabenText(text: KartenText): string {
  return [text.zaehlerText, text.kmText].filter(Boolean).join(' · ')
}

/**
 * Zerlegt die Angaben in Ziffern und Wörter.
 *
 * Zweistufig gesetzt trägt die Zeile ihre Auskunft besser: „14:54" und „4,1"
 * sind die Antwort, „Uhr" und „km" sagen nur, wovon die Rede ist. Die Trennung
 * hier und nicht in der Datenstruktur, weil sie eine SATZ-Entscheidung ist —
 * die Aufrufer sollen weiter fertige Zeichenketten schicken.
 */
export function teileAngaben(text: string): { stueck: string; zahl: boolean }[] {
  const teile: { stueck: string; zahl: boolean }[] = []
  for (const m of text.matchAll(/[0-9][0-9.,:]*|[^0-9]+/g)) {
    const stueck = m[0]
    if (stueck) teile.push({ stueck, zahl: /^[0-9]/.test(stueck) })
  }
  return teile
}

function malBeschriftung(
  ctx: CanvasRenderingContext2D,
  g: KartenGeometrie,
  text: KartenText,
  phasen: KartenPhasen,
  dichte: number,
  eigeneZeile: boolean,
): void {
  const kx = g.karte.x
  const ky = g.karte.y

  // Angaben — rechtsbündig, ohne Rahmen. Der Kasten drumherum ist gefallen:
  // Ein Rand und eine Fläche sagen „hier steht eine Marke", und das ist eine
  // Uhrzeit nicht.
  const angaben = angabenText(text)
  let angabenB = 0
  if (angaben) {
    const teile = teileAngaben(angaben)
    ctx.save()
    angabenB = teile.reduce((sum, t) => {
      ctx.font = schrift(g.text.angaben.schrift, t.zahl ? 500 : 400)
      return sum + ctx.measureText(t.stueck).width
    }, 0)
    ctx.restore()
    const hoehe = g.text.angaben.hoehe
    malTextPuffer(
      ctx,
      dichte,
      {
        schluessel: `angaben|${angaben}|${g.text.angaben.schrift.toFixed(1)}|${angabenB.toFixed(0)}`,
        breite: angabenB + 2,
        hoehe,
        malen: (c) => {
          c.textBaseline = 'middle'
          let x = 0
          for (const t of teile) {
            c.font = schrift(g.text.angaben.schrift, t.zahl ? 500 : 400)
            c.fillStyle = t.zahl ? KARTEN_FARBEN.angabenZahl : KARTEN_FARBEN.angabenWort
            c.fillText(t.stueck, x, hoehe / 2)
            x += c.measureText(t.stueck).width
          }
        },
      },
      // `x` der Geometrie ist die RECHTE Kante (quer: die linke der Spalte).
      (g.lage === 'quer' ? g.text.angaben.x : g.text.angaben.x - angabenB) - kx,
      g.text.angaben.y - ky + phasen.angaben.hub * g.mass,
      phasen.angaben.deckkraft,
    )
  }

  // Titel — eine Zeile, gekürzt. Ein zweizeiliger Titel verschöbe das Bild:
  // Die Kartenhöhe ist auf eine Titelzeile gerechnet.
  if (text.titel) {
    // Auf der gemeinsamen Zeile bleibt dem Titel, was die Angaben übrig
    // lassen. Steht er allein (eigene Zeile oder Spalte), die volle Breite.
    const maxB =
      !eigeneZeile && angabenB > 0 && g.lage !== 'quer'
        ? g.text.titel.breite - angabenB - g.satz.lueckeX * g.mass
        : g.text.titel.breite
    ctx.save()
    ctx.font = schrift(g.text.titel.schrift, 600)
    const gekuerzt = kuerzeText(text.titel, Math.max(20, maxB), (s) => ctx.measureText(s).width)
    const breite = Math.max(1, ctx.measureText(gekuerzt).width)
    ctx.restore()
    const zeileH = g.text.angaben.hoehe
    malTextPuffer(
      ctx,
      dichte,
      {
        schluessel: `titel|${gekuerzt}|${g.text.titel.schrift.toFixed(1)}`,
        breite: breite + 2,
        hoehe: zeileH,
        malen: (c) => {
          c.fillStyle = KARTEN_FARBEN.titel
          c.font = schrift(g.text.titel.schrift, 600)
          c.textBaseline = 'middle'
          c.fillText(gekuerzt, 0, zeileH / 2)
        },
      },
      g.text.titel.x - kx,
      g.text.titel.y - ky + phasen.titel.hub * g.mass,
      phasen.titel.deckkraft,
    )
  }
}
