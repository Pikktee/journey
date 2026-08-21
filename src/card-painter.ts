// Die Foto-Karte auf eine Leinwand — der Maler.
//
// Er ist DOM-frei: Er kennt keine Elemente, nur Werte. Was er zeichnet, kommt
// aus dem Tour-JSON und aus einer FILMSEKUNDE, nicht aus `textContent`. Das ist
// der Punkt des ganzen Umbaus (docs/concepts/konzept_kartenleinwand.md §3.2):
// Vorher las der Video-Export die Texte aus dem DOM zurück, das der Player
// gerade gefüllt hatte, und malte alles andere ein zweites Mal — mit Ken Burns
// in der Gegenrichtung, ohne „Entwickeln", ohne Blitz, ohne Balken.
//
// Die geteilten ZAHLEN stehen weiter in `card-timing.ts` (§3.5). Hier steht nur
// die Geometrie der Player-Bühne, die es dort nie gab: Kartengröße, Polster,
// Schriftgrade, Textumbruch. Sie war bis Etappe 2 CSS.
//
// Drei Dinge, die man beim Lesen leicht für Nachlässigkeit hält und die
// ausdrücklich so gewollt sind:
//
//   1. `prefers-reduced-motion` ist ein SCHALTER im Aufruf (`stage.calm`) und
//      kein `matchMedia` hier drin (Falle 2). Der Maler läuft auch im Export,
//      und die Einstellung des rendernden Rechners darf die ausgelieferte Datei
//      nicht verändern.
//   2. Das „Entwickeln" ist eine ÜBERBLENDUNG zweier gepufferter Fassungen und
//      kein `ctx.filter` pro Frame (§5A). Die Kurvenmitte weicht dadurch messbar
//      ab — erwartet, mit eigener Toleranz in der Abnahme.
//   3. Der Schleier ist am Bildschirm eine DOM-Schicht UNTER der Leinwand (§4).
//      Der Maler malt ihn nur, wenn `schleier: 'flat'` — das ist die benannte
//      Bühnen-Variante des Films.

import { AR_MIN, AR_MAX, CARD, CARD_STAGE, cardTimings, barFraction } from './card-timing.js'

/**
 * Höhe, bei der jede Länge im Maler ihren Nennwert hat (CSS-Pixel).
 *
 * Nicht frei gewählt: Bei 1600 × 900 liegen alle `clamp()` der abgelösten
 * CSS-Fassung auf ihrer Obergrenze — dort, und nur dort, sind die festen Pixel
 * und die vw-Anteile deckungsgleich, ein einziger Faktor schließt also an die
 * bestehende Optik an. Mit 1080 wäre der Bildschirm bei 800 px Höhe am Tag des
 * Umbaus sichtbar anders geworden (Konzept §5, „Skalierungsmodell").
 */
export const REFERENCE_HEIGHT_PX = 900

/** Grenzen des Maßstabs: unter 0,7 wird nichts mehr lesbar, über 2,6 nur groß. */
export const SCALE_MIN = 0.7
export const SCALE_MAX = 2.6

/** Der Maßstab dieser Bühne. Jede Länge im Maler läuft durch ihn. */
export function cardScale(height: number): number {
  return clamp(height / REFERENCE_HEIGHT_PX, SCALE_MIN, SCALE_MAX)
}

export type CardLayout = 'wide' | 'narrow' | 'landscape'

/**
 * Die Bühnen, die diesen Maler benutzen.
 *
 * `player` ist zugleich die Bühne des FILMS: Der Export malt dieselbe Geometrie,
 * er komponiert sie nur anders (Schleier flach, keine Steuerleiste). `editor`
 * ist die kleine Karte auf dem Leuchttisch der Editor-Bühne.
 */
export type CardStageName = 'player' | 'editor'

/**
 * Welche Lage gilt — auf der Player-Bühne abgeleitet, nicht übergeben.
 *
 * Dieselben Schwellen, an denen bis Etappe 2 `body.compact-landscape` (main.ts,
 * `KOMPAKT_HOEHE`) und `@media (max-width: 700px)` hingen. Ein eigener Schalter
 * im Aufruf wäre dort eine zweite Wahrheit über dieselbe Geometrie.
 *
 * Auf der EDITOR-Bühne gilt das nicht (Konzept „Eine Bühne, ein Maler", Falle 5):
 * Eine Editor-Fläche von etwa 700 × 500 ist breiter als hoch und höchstens 560
 * hoch, fiele hier also in `quer` und bekäme das Layout „Bild links, Text rechts"
 * eines liegenden Telefons. Die Lage gehört deshalb zum Bühnen-Satz und wird
 * dort gesetzt — s. `cardStageSet`.
 */
export function cardLayout(width: number, height: number): CardLayout {
  if (width > height && height <= 560) return 'landscape'
  if (width <= 700) return 'narrow'
  return 'wide'
}

/** Ein Satz Nennmaße (bei Bezugshöhe, in CSS-Pixeln). */
export interface CardMetrics {
  /** Rand der Papierkarte um das Bild. */
  padding: number
  /** Reserve für Beschriftung und Luft — die Leitgröße der Kartenhöhe. */
  chrome: number
  /** Dieselbe Reserve, solange die Steuerleiste STEHT (nur am Bildschirm). */
  chromeControls: number
  /** Anteil der Bühnenbreite, den die Karte höchstens einnimmt. */
  widthFraction: number
  /** Obergrenze der Bildbreite. */
  widthMax: number
  /** Polster der Beschriftung: oben, seitlich, unten. */
  textTop: number
  textSides: number
  textBottom: number
  /** Lücken zwischen den Beschriftungsteilen. */
  gapX: number
  gapY: number
  title: number
  titleMin: number
  titleLineHeight: number
  /**
   * Uhrzeit und Kilometerstand. Hieß bis zum Wegfall des Rahmens `pille` — sie
   * standen in einem eigenen Kasten, und der sagte „hier steht eine Marke",
   * wo nur eine Angabe steht.
   */
  facts: number
  factsMin: number
  /** Höhe des Standzeit-Balkens am unteren Bildrand. */
  bar: number
  cardRadius: number
  /** Seitenlänge des Ton-Knopfes im Video und sein Abstand zur Bildecke. */
  audioSide: number
  audioMargin: number
  /** Wie weit die Karte hochrückt, solange die Bedienung steht. */
  liftControls: number
}

/**
 * Die Nennmaße der drei Lagen der PLAYER-Bühne.
 *
 * Die Zahlen der Lage `breit` sind die, die die abgelöste CSS-Fassung bei
 * 1600 × 900 ergab; `narrow` und `landscape` stammen aus deren Media-Query bzw. aus
 * `body.compact-landscape`. Sie stehen hier und nicht in `card-timing.ts`, weil der
 * Editor eine eigene, kleine Karte auf einem Leuchttisch hat (`EDITOR_METRICS`
 * weiter unten): Diese Geometrie ist nicht geteilt und war es nie (§3.7 — was
 * verschieden sein darf, steht als solches da).
 */
export const CARD_METRICS: Record<CardLayout, CardMetrics> = {
  wide: {
    padding: 16,
    chrome: 235,
    // 380 und nicht die 335 der CSS-Fassung: Auf einem 1080p-Bildschirm blieben
    // damit 31 px zwischen Kartenkante und Steuerleiste — zu wenig, um als Luft
    // zu lesen, und die Bildunterschrift stand knapp über der Leiste. Gemessen
    // am Halt, nicht geschätzt.
    chromeControls: 380,
    widthFraction: 0.92,
    widthMax: 1500,
    textTop: 13,
    textSides: 6,
    // 18 statt 15: Gemessen stehen über dem Titel 22,4 px, darunter waren es
    // 22,2 — gleich viel, und damit wirkte die Karte nach unten offen. Mit 18
    // sind es 25,2. Dieselbe Rechnung wie im Editor, nur eine Bühne kleiner.
    textBottom: 18,
    gapX: 16,
    gapY: 2,
    title: 32,
    titleMin: 19,
    titleLineHeight: 1.2,
    facts: 12.5,
    factsMin: 9.5,
    bar: 4,
    cardRadius: 12,
    audioSide: 40,
    audioMargin: 10,
    // 64 und nicht die 48 der CSS-Fassung: Mit der kleineren Karte
    // (`chromeBedienung` 380) blieben oben 94 und unten 57 px — die Karte saß
    // sichtbar tief. Jetzt liegt sie mittig zwischen dem Weg hinaus und der
    // Steuerleiste. Gemessen auf 1080p.
    liftControls: 64,
  },
  narrow: {
    padding: 10,
    chrome: 205,
    chromeControls: 335,
    widthFraction: 0.89,
    widthMax: 1500,
    textTop: 10,
    textSides: 4,
    textBottom: 12,
    gapX: 10,
    gapY: 6,
    title: 19,
    titleMin: 15,
    titleLineHeight: 1.25,
    facts: 10,
    factsMin: 8.5,
    bar: 4,
    cardRadius: 12,
    audioSide: 34,
    audioMargin: 8,
    liftControls: 48,
  },
  landscape: {
    padding: 9,
    chrome: 110,
    chromeControls: 162,
    widthFraction: 0.62,
    widthMax: 1500,
    textTop: 8,
    textSides: 6,
    textBottom: 10,
    gapX: 12,
    gapY: 9,
    title: 27,
    titleMin: 17,
    titleLineHeight: 1.25,
    facts: 14,
    factsMin: 9,
    bar: 4,
    cardRadius: 12,
    audioSide: 34,
    audioMargin: 8,
    liftControls: 22,
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
export const EDITOR_METRICS: CardMetrics = {
  // 12 und nicht mehr 22: Der breite Rand stammt aus der Zeit, als die Karte
  // gegen einen hellen Schleier stand und ihn brauchte, um sich zu halten.
  // Heute liegt sie auf einem dunklen Bild und trägt sich selbst; die Breite
  // bekommt das Bild. Der FUSS bleibt der eine breite Rand — das ist die Form
  // jedes Passepartouts, und sie liest sich nur als gewollt, solange oben und
  // seitlich gleich schmal sind.
  padding: 12,
  chrome: 306,
  // Der Editor hat keine Steuerleiste, die Platz verlangt — derselbe Wert.
  chromeControls: 306,
  widthFraction: 0.82,
  widthMax: 1600,
  textTop: 18,
  textSides: 10,
  // Am MALER gemessen (nicht am Entwurf, dort galt eine andere Geometrie und
  // eine 6 sah richtig aus): Über dem Titel stehen 25 px bis zur
  // Versalienoberkante, darunter mit 24 noch 27,5 bis zur Kartenkante. Etwas
  // mehr unten ist richtig — über dem Titel drückt das Bild, unter ihm steht
  // nichts mehr. Mit 6 waren es 13,5 unten gegen 25 oben, und die Karte sah
  // unten abgeschnitten aus.
  textBottom: 24,
  gapX: 20,
  gapY: 5,
  title: 40,
  titleMin: 17,
  titleLineHeight: 1.15,
  facts: 19,
  factsMin: 11,
  bar: 5,
  cardRadius: 22,
  // Und keinen Ton-Knopf: Der Ton des Videos läuft, bedient wird er nicht.
  audioSide: 0,
  audioMargin: 0,
  liftControls: 0,
}

/**
 * Maßstabsgrenzen der Editor-Bühne.
 *
 * Weiter unten als die des Players (0,7), weil die Bühne selbst kleiner ist: Mit
 * 0,7 wäre bei 480 px Höhe schon geklemmt, das Bild bekäme statt 66 % nur 55 %
 * der Fläche und die Karte säße auf einem Leuchttisch, der ihr nicht passt.
 */
export const EDITOR_SCALE_MIN = 0.55
export const EDITOR_SCALE_MAX = 1.8

/** Lage der Editor-Bühne — GESETZT und nicht abgeleitet (Falle 5, s. `cardLayout`). */
export const EDITOR_LAYOUT: CardLayout = 'wide'

/** Was eine Bühne dem Maler an Geometrie vorgibt. */
export interface CardStageSet {
  layout: CardLayout
  metrics: CardMetrics
  scale: number
  /** Flugweite des Auftritts — die eine benannte Bühnen-Variante. */
  flightLiftPx: number
}

/** Maßsatz, Lage und Maßstab dieser Bühne. */
export function cardStageSet(stage: CardStage): CardStageSet {
  if (stage.name === 'editor') {
    return {
      layout: EDITOR_LAYOUT,
      metrics: EDITOR_METRICS,
      scale: clamp(stage.height / REFERENCE_HEIGHT_PX, EDITOR_SCALE_MIN, EDITOR_SCALE_MAX),
      flightLiftPx: CARD_STAGE.flightLiftPx.editor,
    }
  }
  const layout = cardLayout(stage.width, stage.height)
  return {
    layout,
    metrics: CARD_METRICS[layout],
    scale: cardScale(stage.height),
    flightLiftPx: CARD_STAGE.flightLiftPx.player,
  }
}

/** Boden des Bildradius: darunter ist es kein Radius mehr, nur ein Pixelrand. */
const FRAME_RADIUS_MIN = 3

/** Farben der Karte. Bewusst hier und nicht als Token-Lesung: der Maler ist DOM-frei. */
export const CARD_COLORS = {
  paper: '#f6f1e7',
  title: '#1c1712',
  /**
   * Die Angaben stehen zweistufig: Die ZIFFERN tragen die Auskunft, „Uhr" und
   * „km" sagen nur, wovon die Rede ist.
   */
  factsDigits: 'rgba(28, 23, 18, 0.82)',
  factsWord: 'rgba(28, 23, 18, 0.5)',
  /** Bildfeld, solange das Foto noch fehlt — dasselbe Papiergrau wie vorher. */
  imageArea: '#d8d2c4',
  video: '#000',
  // 0.16 statt 0.3: Der ungespielte Rest lag als grauer Streifen über dem
  // Bildfuß und las sich fast wie ein Fehler des Fotos.
  bar: 'rgba(10, 8, 5, 0.16)',
  barFrom: '#f5a524',
  barTo: '#ff6f52',
  shadow: 'rgba(0, 0, 0, 0.55)',
} as const

export interface CardStage {
  /** Bühnenbreite in CSS-Pixeln — NIE in Gerätepixeln (Falle 6). */
  width: number
  height: number
  /**
   * Welche Bühne — Vorgabe `player`. Sie entscheidet über Maßsatz, Lage,
   * Maßstabsgrenzen und Flugweite (`cardStageSet`), über nichts sonst: Alles, was
   * auf beiden Bühnen gleich AUSSEHEN soll, steht in `CARD`.
   */
  name?: CardStageName
  /**
   * Wie weit die Steuerleiste STEHT — 0 = zurückgezogen, 1 = ganz da.
   *
   * Ein Anteil und kein Schalter: Die Karte macht der Leiste Platz und rückt
   * hoch, und das soll man ihr ansehen. Als Boolean sprang sie zwischen zwei
   * Größen, sobald sich die Maus bewegte oder die UI sich nach 3,2 s zurückzog —
   * ein Umsprung mitten im stehenden Bild, den nichts erklärt. Wer den Anteil
   * über die Zeit führt (`card-layer.ts`), bekommt aus demselben Umstand eine
   * Bewegung, die als gewollt liest.
   *
   * Nur am Bildschirm: Im Film gibt es keine Leiste, der Export setzt das
   * niemals (Konzept §5).
   */
  controls?: number
  /**
   * `prefers-reduced-motion` — als Schalter, nicht als Blick nach draußen
   * (Falle 2). Im Export immer `false`.
   */
  calm?: boolean
  /**
   * Schleier hinter der Karte. Am Bildschirm `'aus'`: Dort liegt eine
   * DOM-Schicht mit `backdrop-filter` UNTER der Leinwand, und die hat auf einer
   * Leinwand kein Gegenstück (§4). Im Film `'flat'` — die benannte
   * Bühnen-Variante.
   */
  scrim?: 'off' | 'flat'
}

export interface CardMedium {
  kind: 'photo' | 'video'
  /**
   * Seitenverhältnis des RAHMENS — geklemmt (`clampAspectRatio`).
   * `null` = noch nicht vermessen, dann gilt 3:2 wie in der CSS-Fassung.
   */
  ar: number | null
  /** Ken-Burns für dieses Medium abgeschaltet (`display.kenBurns === false`). */
  noKenBurns?: boolean
}

export interface CardText {
  title: string
  /** „12.3 km" im Player; im Editor leer (dort trägt die Karte keine Pille). */
  kmText: string
  /** „1/2" — leer, wenn der Halt nur eine Aufnahme hat. */
  counterText: string
}

export interface CardSource {
  image: CanvasImageSource
  /** Intrinsische Maße — nötig für `cover`, und `CanvasImageSource` nennt sie nicht. */
  width: number
  height: number
  /**
   * Kennung des Materials. Wechselt sie, werden die Puffer neu gebacken;
   * bliebe sie gleich, zeigte die Karte das vorige Foto entwickelt weiter.
   */
  key: string
}

export interface CardFrame {
  /** Stand IM Klip in Sekunden. Vor dem Auftritt negativ. */
  inS: number
  /** Länge des Klips: Standzeit plus Ausblendung (`clipDurationS`). */
  durationS: number
  medium: CardMedium
  text: CardText
  /**
   * Die Zeichenquelle, oder `null`. Der Aufrufer sagt mit `ready`, dass der
   * FRAME steht — `drawImage` auf einem noch suchenden `<video>` zeichnet ohne
   * Fehler das alte Bild, und im Film ist das ein falsches Einzelbild in der
   * Datei (Konzept §5, „Bild und Video").
   */
  source: CardSource | null
  ready: boolean
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
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
export interface CardRects {
  card: Rect
  image: Rect
  /** Ton-Knopf des Videos; `null` bei einem Foto. */
  audio: Rect | null
  /** Deckkraft der ganzen Karte — die DOM-Bedienung blendet mit. */
  opacity: number
  /** Der Maßstab dieser Bühne. */
  scale: number
  layout: CardLayout
}

/** Was der Maler gemalt hat. `ready: false` = der Frame stand nicht. */
export interface CardPaintResult {
  rects: CardRects | null
  ready: boolean
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
  const value = (t: number, a1: number, a2: number) => ((a(a1, a2) * t + b(a1, a2)) * t + c(a1)) * t
  const slope = (t: number, a1: number, a2: number) =>
    3 * a(a1, a2) * t * t + 2 * b(a1, a2) * t + c(a1)
  return (x: number): number => {
    if (x <= 0) return 0
    if (x >= 1) return 1
    let t = x
    for (let i = 0; i < 6; i++) {
      const s = slope(t, x1, x2)
      if (Math.abs(s) < 1e-6) break
      const d = value(t, x1, x2) - x
      if (Math.abs(d) < 1e-6) break
      t -= d / s
    }
    if (t < 0 || t > 1) {
      let lo = 0
      let hi = 1
      t = x
      for (let i = 0; i < 24; i++) {
        const d = value(t, x1, x2) - x
        if (Math.abs(d) < 1e-6) break
        if (d > 0) hi = t
        else lo = t
        t = (lo + hi) / 2
      }
    }
    return value(t, y1, y2)
  }
}

/** `cubic-bezier(a, b, c, d)` aus einem CSS-Text — `CARD.flugKurve` ist einer. */
export function curveFromText(css: string): (t: number) => number {
  const m = /cubic-bezier\(\s*([\d.-]+)\s*,\s*([\d.-]+)\s*,\s*([\d.-]+)\s*,\s*([\d.-]+)\s*\)/.exec(
    css,
  )
  if (!m) return (t) => t
  return bezier(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]))
}

/** Die drei benannten CSS-Kurven, die die abgelöste Fassung benutzte. */
export const CURVE = {
  ease: bezier(0.25, 0.1, 0.25, 1),
  easeOut: bezier(0, 0, 0.58, 1),
  easeIn: bezier(0.42, 0, 1, 1),
  /** Der Flug — aus derselben Zeichenkette, die der Editor in seinem CSS hat. */
  flight: curveFromText(CARD.flightCurve),
  /** Die Beschriftung tritt gestaffelt auf. */
  text: bezier(0.22, 1, 0.36, 1),
} as const

/** Staffelung der Beschriftung: erst der Titel, dann die Angaben (Sekunden). */
export const TEXT_OFFSET_S = { title: 0.35, facts: 0.5 } as const
export const TEXT_DURATION_S = 0.6
/** Weg, den ein Beschriftungsteil beim Auftritt zurücklegt (bei Bezugshöhe). */
export const TEXT_LIFT_PX = 10

/** Auftritt eines Beschriftungsteils. */
export interface TextEntrance {
  alpha: number
  /** Restweg nach oben, in Nennpixeln (0 = angekommen). */
  lift: number
}

/**
 * Der ganze sichtbare Zustand der Karte zu einer Filmsekunde.
 *
 * DOM-frei und ohne Leinwand — genau deshalb ist er prüfbar, und genau darauf
 * liegt der Wächter (test/einblendung-css.test.ts) seit Etappe 2: Er vergleicht
 * nicht mehr CSS gegen CSS, sondern diese Rechnung gegen `studio.html`.
 */
export interface CardPhases {
  /** Deckkraft der Karte insgesamt: Blende herein, Abgang heraus. */
  opacity: number
  /** Flug 0..1 — 1 = in Ruhe. */
  flight: number
  /** Abgang 0..1 — 0 = steht noch aus. */
  exit: number
  /** Ken-Burns-Skala des Bildes im Rahmen. */
  kbScale: number
  /** „Entwickeln" 0..1 — 0 = frisch aus der Kamera, 1 = fertig. */
  develop: number
  /** Füllstand des Standzeit-Balkens. */
  bar: number
  title: TextEntrance
  facts: TextEntrance
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

function clamp01(v: number): number {
  return clamp(v, 0, 1)
}

function mix(from: number, to: number, t: number): number {
  return from + (to - from) * t
}

function textEntrance(inS: number, offsetS: number, calm: boolean): TextEntrance {
  if (calm) return { alpha: 1, lift: 0 }
  const t = CURVE.text(clamp01((inS - offsetS) / TEXT_DURATION_S))
  return { alpha: t, lift: (1 - t) * TEXT_LIFT_PX }
}

/**
 * Aus Filmsekunde und Klip-Länge alles Sichtbare.
 *
 * Bei `calm` (reduzierte Bewegung) bleibt genau eine Bewegung übrig: eine
 * kurze Deckkraft-Blende. Die abgelöste CSS-Fassung machte es ebenso — sie
 * setzte `animation: none` und ließ `transition: opacity 0.2s` stehen. Ein
 * harter Schnitt wäre hier falsch: Im Film wäre er ein Bildsprung.
 */
export function cardPhases(
  inS: number,
  durationS: number,
  opt: { noKenBurns?: boolean; calm?: boolean } = {},
): CardPhases {
  const z = cardTimings(inS, durationS)
  const bar = barFraction(inS, durationS)
  const calm = opt.calm === true
  const restScale = CARD.restScale

  if (calm) {
    const CALM_FADE_S = 0.2
    const fadeIn = clamp01(inS / CALM_FADE_S)
    const fadeOut = z.exitTimeS < 0 ? clamp01(-z.exitTimeS / Math.max(0.01, z.exitDurationS)) : 0
    return {
      opacity: fadeIn * (1 - fadeOut),
      flight: 1,
      exit: 0,
      kbScale: restScale,
      develop: 1,
      bar,
      title: { alpha: 1, lift: 0 },
      facts: { alpha: 1, lift: 0 },
    }
  }

  const fade = CURVE.ease(clamp01((inS - CARD.fadeOffsetS) / CARD.fadeDurationS))
  const flight = CURVE.flight(clamp01(inS / CARD.flightDurationS))
  const exit =
    z.exitTimeS < 0 ? CURVE.easeIn(clamp01(-z.exitTimeS / Math.max(0.01, z.exitDurationS))) : 0
  const develop = CURVE.easeOut(clamp01(inS / CARD.developDurationS))
  const kbFraction = CURVE.easeOut(clamp01(inS / Math.max(0.1, z.kenBurnsDurationS)))
  const kbScale = opt.noKenBurns ? restScale : mix(CARD.kenBurnsFrom, CARD.kenBurnsTo, kbFraction)

  return {
    opacity: fade * (1 - exit),
    flight,
    exit,
    kbScale,
    develop,
    bar,
    title: textEntrance(inS, TEXT_OFFSET_S.title, false),
    facts: textEntrance(inS, TEXT_OFFSET_S.facts, false),
  }
}

// — Geometrie —

export interface CardGeometry {
  scale: number
  layout: CardLayout
  metrics: CardMetrics
  /** Karte in Ruhelage (ohne Flug/Abgang), zentriert auf der Bühne. */
  card: Rect
  image: Rect
  /** Die Beschriftung, in Karten-Koordinaten (relativ zu `card`). */
  text: {
    title: { x: number; y: number; width: number; fontPx: number }
    /**
     * Uhrzeit und Kilometerstand. `x` ist die RECHTE Kante: Die Zeile steht
     * rechts, auch wenn links kein Titel dasteht. Wanderte sie bei einer
     * unbeschrifteten Aufnahme nach links, bewegte sich beim Blättern
     * ausgerechnet das Einzige, was in der Karte bleibt.
     */
    facts: { x: number; y: number; height: number; fontPx: number }
  }
  frameRadius: number
  cardRadius: number
  barHeight: number
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
export interface CardContent {
  /** Stehen Uhrzeit und km unter dem Titel statt neben ihm? */
  factsOwnLine: boolean
}

/** Nennmaß × Maßstab, aber nie unter einem Mindestwert (die Lesbarkeits-Böden). */
function sizePx(nominal: number, scale: number, min: number): number {
  return Math.max(min, nominal * scale)
}

/**
 * Die Kartengeometrie dieser Bühne — ohne jede Bewegung.
 *
 * Leitgröße ist die HÖHE: Von ihr geht die Chrome-Reserve ab, der Rest ist das
 * Bild, die Breite folgt aus dem Seitenverhältnis. Umgekehrt (Breite fest, Höhe
 * folgt) ragte die Karte auf quer gehaltenen Telefonen oben UND unten aus dem
 * Bild — der Grund, aus dem die CSS-Fassung es schon so rechnete.
 */
export function cardGeometry(
  stage: CardStage,
  medium: CardMedium,
  content: CardContent,
): CardGeometry {
  const { width, height } = stage
  const { scale, layout, metrics } = cardStageSet(stage)
  const px = (nominal: number) => nominal * scale

  const ar = clamp(medium.ar ?? 1.5, AR_MIN, AR_MAX)
  // Die Reserve wächst STETIG mit der Leiste, sie schaltet nicht um: Zwischen
  // beiden Werten liegt jeder Zwischenstand, und den fährt die Schicht ab.
  const ctl = clamp(stage.controls ?? 0, 0, 1)
  const titleFont = sizePx(metrics.title, scale, metrics.titleMin)
  const factsFont = sizePx(metrics.facts, scale, metrics.factsMin)
  const titleH = titleFont * metrics.titleLineHeight
  // Die Zeile der Angaben ist so hoch wie die des Titels (s. unten).
  const factsH = titleH

  // Der zweizeilige Fuß (Titel und Angaben passen nicht nebeneinander) macht
  // die Karte um eine Zeile höher — die Reserve muss das WISSEN, sonst wächst
  // die Karte über sie hinaus. Quer bleiben sonst 2 px Luft zum Bühnenrand.
  const chrome =
    px(mix(metrics.chrome, metrics.chromeControls, ctl)) +
    (content.factsOwnLine ? factsH + px(metrics.gapY) : 0)
  const maxW = Math.min(px(metrics.widthMax), width * metrics.widthFraction)
  const imageH = Math.max(1, Math.min(height - chrome, maxW / ar))
  const imageW = Math.max(1, imageH * ar)

  const padding = px(metrics.padding)
  const textTop = px(metrics.textTop)
  const textSides = px(metrics.textSides)
  const textBottom = px(metrics.textBottom)
  const gapX = px(metrics.gapX)
  const gapY = px(metrics.gapY)

  let cardW: number
  let cardH: number
  let imageX: number
  let imageY: number
  const text: CardGeometry['text'] = {
    title: { x: 0, y: 0, width: 0, fontPx: titleFont },
    facts: { x: 0, y: 0, height: factsH, fontPx: factsFont },
  }

  // Titel links, Angaben rechts — auf DERSELBEN Zeile, solange beide
  // nebeneinander passen. ALLE DREI Lagen teilen sich diesen Weg (Probe): quer
  // stand hier bis eben ein eigener Zweig mit Textspalte NEBEN dem Bild.
  cardW = imageW + padding * 2
  imageX = padding
  imageY = padding
  const innerX = padding + textSides
  const innerW = imageW - textSides * 2
  let y = padding + imageH + textTop
  text.title = { x: innerX, y, width: innerW, fontPx: titleFont }
  if (content.factsOwnLine) {
    y += titleH + gapY
    text.facts = { x: innerX + innerW, y, height: factsH, fontPx: factsFont }
    y += factsH
  } else {
    text.facts = { x: innerX + innerW, y, height: factsH, fontPx: factsFont }
    y += titleH
  }
  cardH = y + textBottom

  const x = (width - cardW) / 2
  const yMid = (height - cardH) / 2 - px(metrics.liftControls) * ctl

  // Bis hier ist alles KARTEN-relativ gerechnet, weil die Beschriftung sich an
  // Bild und Kartenrand ausrichtet. Nach außen gilt EIN Bezugssystem: die Bühne.
  // Zwei gemischte Systeme waren der erste Fehler dieses Malers — die
  // Textblöcke landeten in der Lage `quer` um die halbe Kartenbreite versetzt.
  text.title = { ...text.title, x: text.title.x + x, y: text.title.y + yMid }
  text.facts = { ...text.facts, x: text.facts.x + x, y: text.facts.y + yMid }

  return {
    scale,
    layout,
    metrics,
    card: { x, y: yMid, width: cardW, height: cardH },
    image: { x: x + imageX, y: yMid + imageY, width: imageW, height: imageH },
    text,
    frameRadius: Math.max(FRAME_RADIUS_MIN, px(CARD.frameRadiusPx)),
    cardRadius: px(metrics.cardRadius),
    barHeight: px(metrics.bar),
  }
}

// — Puffer —
//
// „Canvas ist nicht von selbst schneller" (Falle 9). Drei Dinge dürfen pro Frame
// NICHT passieren: Text messen und setzen, `ctx.filter` auswerten, `shadowBlur`
// auf die große Karte legen. Alle drei landen deshalb einmal in einem Puffer und
// werden danach geblittet.

interface Buffer {
  canvas: HTMLCanvasElement
  /** Maße in CSS-Pixeln (die Leinwand selbst ist `dichte`-fach so groß). */
  width: number
  height: number
}

const BUFFER_MAX = 20
const buffers = new Map<string, Buffer>()

function take(
  key: string,
  width: number,
  height: number,
  density: number,
  paint: (ctx: CanvasRenderingContext2D, b: number, h: number) => void,
): Buffer | null {
  const found = buffers.get(key)
  if (found) {
    // Neu einsortieren: der zuletzt gebrauchte fällt nicht als Erster heraus.
    buffers.delete(key)
    buffers.set(key, found)
    return found
  }
  const b = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(b * density))
  canvas.height = Math.max(1, Math.round(h * density))
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.scale(canvas.width / b, canvas.height / h)
  paint(ctx, b, h)
  const fresh: Buffer = { canvas, width: b, height: h }
  buffers.set(key, fresh)
  while (buffers.size > BUFFER_MAX) {
    const first = buffers.keys().next().value
    if (first === undefined) break
    buffers.delete(first)
  }
  return fresh
}

/** Alle Puffer wegwerfen — beim Verlassen der Tour und bei einem Formatwechsel. */
export function clearCardBuffers(): void {
  buffers.clear()
}

/** Wird `ctx.filter` überhaupt ausgewertet? Ohne ihn bleibt das Bild ungefiltert. */
let filterWorks: boolean | null = null
function canFilter(): boolean {
  if (filterWorks !== null) return filterWorks
  const c = document.createElement('canvas')
  const x = c.getContext('2d')
  filterWorks = false
  if (x) {
    try {
      x.filter = 'brightness(1.2)'
      filterWorks = x.filter !== 'none' && x.filter !== ''
    } catch {
      filterWorks = false
    }
  }
  return filterWorks
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
function imageBuffer(
  source: CardSource,
  frameW: number,
  frameH: number,
  density: number,
  filter: string | null,
  fit: 'cover' | 'contain',
): Buffer | null {
  const zoom = CARD.kenBurnsFrom
  const b = frameW * zoom
  const h = frameH * zoom
  const key = `bild|${source.key}|${Math.round(b)}x${Math.round(h)}|${density.toFixed(2)}|${filter ?? 'roh'}|${fit}`
  return take(key, b, h, density, (ctx, bb, hh) => {
    const arSource = source.width > 0 && source.height > 0 ? source.width / source.height : bb / hh
    const arFrame = bb / hh
    const covers = fit === 'cover' ? arSource > arFrame : arSource < arFrame
    let zb = bb
    let zh = hh
    if (covers) {
      zh = hh
      zb = hh * arSource
    } else {
      zb = bb
      zh = bb / arSource
    }
    if (fit === 'contain') {
      ctx.fillStyle = CARD_COLORS.video
      ctx.fillRect(0, 0, bb, hh)
    }
    if (filter && canFilter()) ctx.filter = filter
    try {
      ctx.drawImage(source.image, (bb - zb) / 2, (hh - zh) / 2, zb, zh)
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
function shadowBuffer(width: number, height: number, radius: number, scale: number): Buffer | null {
  const margin = Math.ceil(200 * scale)
  const b = width + margin * 2
  const h = height + margin * 2
  const key = `schatten|${Math.round(width)}x${Math.round(height)}|${radius.toFixed(1)}|${scale.toFixed(2)}`
  return take(key, b, h, 1, (ctx) => {
    const draw = (blur: number, lift: number, color: string) => {
      ctx.save()
      ctx.shadowColor = color
      ctx.shadowBlur = blur * scale
      ctx.shadowOffsetY = lift * scale
      ctx.fillStyle = '#000'
      ctx.beginPath()
      ctx.roundRect(margin, margin, width, height, radius)
      ctx.fill()
      ctx.restore()
    }
    draw(140, 50, 'rgba(0, 0, 0, 0.7)')
    draw(36, 12, 'rgba(0, 0, 0, 0.5)')
    // Die Karte selbst wird pro Frame scharf darüber gemalt — im Puffer steht
    // nur der Schatten, also wird die Fläche darunter wieder freigeräumt.
    ctx.save()
    ctx.globalCompositeOperation = 'destination-out'
    ctx.beginPath()
    ctx.roundRect(margin, margin, width, height, radius)
    ctx.fill()
    ctx.restore()
  })
}

// — Text —

function fontOf(size: number, weight: number): string {
  return `${weight} ${size.toFixed(2)}px Outfit, system-ui, sans-serif`
}

/**
 * Auf eine Breite kürzen. Canvas kennt kein `text-overflow: ellipsis` — das
 * fehlte bis Etappe 2 im Repo ganz (§4).
 */
export function truncateText(text: string, maxPx: number, scale: (s: string) => number): string {
  if (!text || scale(text) <= maxPx) return text
  let s = text
  while (s.length > 1 && scale(`${s}…`) > maxPx) s = s.slice(0, -1)
  return `${s.trimEnd()}…`
}

/**
 * An Wortgrenzen umbrechen, auf höchstens `zeilen` Zeilen, die letzte gekürzt.
 *
 * `wrapAttribution` in film-export.ts bricht an den Quellen-Trennern und ist
 * dasselbe Muster für einen anderen Text; hier zählt zusätzlich die
 * Höchstzahl der Zeilen, weil die Kartenhöhe darauf gerechnet ist.
 */
export function wrapText(
  text: string,
  maxPx: number,
  maxLines: number,
  scale: (s: string) => number,
): string[] {
  if (!text) return []
  const words = text.split(/\s+/).filter(Boolean)
  const all: string[] = []
  let line = ''
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (line && scale(candidate) > maxPx) {
      all.push(line)
      line = word
    } else {
      line = candidate
    }
  }
  if (line) all.push(line)
  if (all.length <= maxLines) return all
  // Was nicht mehr passt, wandert in die letzte erlaubte Zeile und wird dort
  // gekürzt — abgeschnitten ohne Zeichen wäre eine stillschweigende Lüge.
  const rest = all.slice(maxLines - 1).join(' ')
  return [...all.slice(0, maxLines - 1), truncateText(rest, maxPx, scale)]
}

interface TextBufferRequest {
  key: string
  width: number
  height: number
  paint: (ctx: CanvasRenderingContext2D) => void
}

function paintTextBuffer(
  ctx: CanvasRenderingContext2D,
  density: number,
  request: TextBufferRequest,
  x: number,
  y: number,
  alpha: number,
): void {
  if (alpha <= 0.004) return
  const p = take(request.key, request.width, request.height, density, (c) => request.paint(c))
  if (!p) return
  const prev = ctx.globalAlpha
  ctx.globalAlpha = prev * alpha
  ctx.drawImage(p.canvas, x, y, p.width, p.height)
  ctx.globalAlpha = prev
}

// — Der Maler —

/**
 * Die Karte auf einen 2D-Kontext, aus Filmsekunde und Halt.
 *
 * Der Kontext trägt seine Auflösung als Transformation (der Aufrufer setzt sie);
 * der Maler rechnet ausschließlich in CSS-Pixeln (Falle 6). Die Dichte liest er
 * nur für die Auflösung der PUFFER aus der Matrix — nie für Geometrie.
 */
export function paintCard(
  ctx: CanvasRenderingContext2D,
  stage: CardStage,
  frame: CardFrame,
): CardPaintResult {
  const phases = cardPhases(frame.inS, frame.durationS, {
    ...(frame.medium.noKenBurns === true ? { noKenBurns: true } : {}),
    ...(stage.calm === true ? { calm: true } : {}),
  })
  const density = clamp(Math.abs(ctx.getTransform().a) || 1, 1, 3)
  // Der INHALT entscheidet über die Höhe: keine Bildunterschrift, keine Zeile
  // dafür. Und Titel und Angaben teilen sich eine Zeile, solange sie
  // nebeneinander passen — das kann erst entschieden werden, wenn beide
  // gemessen sind, also einmal vermessen, prüfen, im Bedarfsfall neu vermessen.
  // Die Geometrie ist reine Rechnung, ein zweiter Durchgang kostet nichts.
  let g = cardGeometry(stage, frame.medium, { factsOwnLine: false })
  const ownLine = factsDoNotFit(ctx, g, frame.text)
  if (ownLine) g = cardGeometry(stage, frame.medium, { factsOwnLine: true })

  // Hier lag der Kamerablitz — ein Radialverlauf über der Szene und unter der
  // Karte, die teuerste einzelne Operation eines Kartenbildes (2,0 gegen 1,1 ms
  // im Median). Er ist zurückgebaut: Auf seiner Spitze steht die Karte bei 7 %
  // Deckkraft und das „Entwickeln" bei `brightness(1.45)` — das Foto war dort
  // schon ein heller Schleier, der Blitz legte eine zweite weiße Schicht auf
  // eine, die längst da war. Die Begründung in voller Länge steht bei `CARD`
  // (card-timing.ts); den Halt markiert seither der Schleier allein.

  if (phases.opacity <= 0.004) return { rects: null, ready: true }

  // Der flache Schleier ist die benannte Bühnen-Variante des Films (§4). Am
  // Bildschirm malt ihn niemand hier: Dort liegt eine DOM-Schicht mit
  // `backdrop-filter` unter der Leinwand, und die kann eine Leinwand nicht.
  if (stage.scrim === 'flat') {
    ctx.save()
    ctx.globalAlpha = phases.opacity
    ctx.fillStyle = CARD.scrimColor
    ctx.fillRect(0, 0, stage.width, stage.height)
    ctx.restore()
  }

  // Flug und Abgang: um die Kartenmitte, damit die Drehung nicht am Eck hängt.
  const liftFlight = mix(cardStageSet(stage).flightLiftPx * g.scale, 0, phases.flight)
  const scaleFlight = mix(CARD.flightScale, 1, phases.flight)
  const rotFlight = mix(CARD.flightRotationDeg, CARD.restRotationDeg, phases.flight)
  // `rotateX` unter `perspective` hat auf einer Leinwand kein Gegenstück; die
  // Kippung wird als Stauchung angenähert. Sie liegt ganz in den ersten 0,95 s,
  // also im Toleranzfenster der Abnahme (Konzept, Etappe 2).
  const tilt = mix(CARD.flightTiltDeg, 0, phases.flight)
  const squash = Math.cos((tilt * Math.PI) / 180)

  const liftExit = CARD.exitLiftPx * g.scale * phases.exit
  const scaleExit = mix(1, CARD.exitScale, phases.exit)
  const rotExit = mix(CARD.restRotationDeg, CARD.exitRotationDeg, phases.exit)

  const scaleNow = scaleFlight * scaleExit
  const rot = phases.exit > 0 ? rotExit : rotFlight
  const offsetY = liftFlight + liftExit
  const mx = g.card.x + g.card.width / 2
  const my = g.card.y + g.card.height / 2

  ctx.save()
  ctx.globalAlpha = phases.opacity
  ctx.translate(mx, my + offsetY)
  ctx.rotate((rot * Math.PI) / 180)
  ctx.scale(scaleNow, scaleNow * squash)
  ctx.translate(-g.card.width / 2, -g.card.height / 2)

  // Papier mit Schatten. Der Schatten kommt aus dem Puffer, das Papier wird
  // scharf gemalt — ein gemeinsamer Puffer machte die Kartenkante weich.
  const shadow = shadowBuffer(g.card.width, g.card.height, g.cardRadius, g.scale)
  if (shadow) {
    const margin = (shadow.width - g.card.width) / 2
    ctx.drawImage(shadow.canvas, -margin, -margin, shadow.width, shadow.height)
  }
  ctx.fillStyle = CARD_COLORS.paper
  ctx.beginPath()
  ctx.roundRect(0, 0, g.card.width, g.card.height, g.cardRadius)
  ctx.fill()

  // Bildfeld
  const bx = g.image.x - g.card.x
  const by = g.image.y - g.card.y
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(bx, by, g.image.width, g.image.height, g.frameRadius)
  ctx.clip()
  ctx.fillStyle = frame.medium.kind === 'video' ? CARD_COLORS.video : CARD_COLORS.imageArea
  ctx.fillRect(bx, by, g.image.width, g.image.height)

  let ready = true
  if (frame.source) {
    if (frame.medium.kind === 'video') {
      // Video: `contain`, schwarzer Rahmen, kein Ken Burns und kein
      // „Entwickeln" — wie in der abgelösten CSS-Fassung. Und ohne Puffer: Der
      // Frame wechselt, ein Puffer wäre pro Bild ein neuer.
      //
      // Gezeichnet wird AUCH ohne die Zusicherung: Ein suchendes oder gerade
      // nachpufferndes `<video>` liefert bei `drawImage` das ALTE Bild, und das
      // ist auf der Bühne die bessere Auskunft als das schwarze Bildfeld. Auf
      // dem Telefon war genau das der sichtbare Teil des Suchsturms — zwischen
      // den Bildern blitzte Schwarz auf. `bereit: false` geht trotzdem heraus:
      // Der Video-Export wartet darauf, statt ein altes Bild einzubacken.
      paintVideo(ctx, frame.source, bx, by, g.image.width, g.image.height)
      ready = frame.ready
    } else if (frame.ready) {
      ready = paintPhoto(ctx, frame.source, phases, bx, by, g.image, density)
    } else {
      ready = false
    }
  }

  // Standzeit-Balken am unteren Bildrand
  const barY = by + g.image.height - g.barHeight
  ctx.fillStyle = CARD_COLORS.bar
  ctx.fillRect(bx, barY, g.image.width, g.barHeight)
  if (phases.bar > 0) {
    const gradient = ctx.createLinearGradient(bx, 0, bx + g.image.width, 0)
    gradient.addColorStop(0, CARD_COLORS.barFrom)
    gradient.addColorStop(1, CARD_COLORS.barTo)
    ctx.fillStyle = gradient
    ctx.fillRect(bx, barY, g.image.width * phases.bar, g.barHeight)
  }
  ctx.restore()

  paintCaption(ctx, g, frame.text, phases, density, ownLine)
  ctx.restore()

  // Die Rechtecke der DOM-Bedienung — bewegt, aber ohne Drehung: Eine
  // unsichtbare Klickfläche braucht sie nicht, und eine gedrehte Fläche wäre
  // schwerer zu treffen als die Karte, die man sieht.
  const scaled = (r: Rect): Rect => ({
    x: mx + (r.x - mx) * scaleNow,
    y: my + offsetY + (r.y - my) * scaleNow * squash,
    width: r.width * scaleNow,
    height: r.height * scaleNow * squash,
  })
  const audioRaw: Rect | null =
    frame.medium.kind === 'video' && g.metrics.audioSide > 0
      ? {
          x: g.image.x + g.image.width - (g.metrics.audioSide + g.metrics.audioMargin) * g.scale,
          y: g.image.y + g.metrics.audioMargin * g.scale,
          width: g.metrics.audioSide * g.scale,
          height: g.metrics.audioSide * g.scale,
        }
      : null

  return {
    ready,
    rects: {
      card: scaled(g.card),
      image: scaled(g.image),
      audio: audioRaw ? scaled(audioRaw) : null,
      opacity: phases.opacity,
      scale: g.scale,
      layout: g.layout,
    },
  }
}

function paintVideo(
  ctx: CanvasRenderingContext2D,
  source: CardSource,
  x: number,
  y: number,
  b: number,
  h: number,
): void {
  const ar = source.width > 0 && source.height > 0 ? source.width / source.height : b / h
  let zb = b
  let zh = b / ar
  if (zh > h) {
    zh = h
    zb = h * ar
  }
  try {
    ctx.drawImage(source.image, x + (b - zb) / 2, y + (h - zh) / 2, zb, zh)
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
function paintPhoto(
  ctx: CanvasRenderingContext2D,
  source: CardSource,
  phases: CardPhases,
  x: number,
  y: number,
  image: Rect,
  density: number,
): boolean {
  const from = imageBuffer(
    source,
    image.width,
    image.height,
    density,
    filterText(CARD.developFrom),
    'cover',
  )
  const to = imageBuffer(
    source,
    image.width,
    image.height,
    density,
    filterText(CARD.developTo),
    'cover',
  )
  if (!from || !to) return false
  // Der Puffer steht auf Ken-Burns-Anfangsgröße; gezeichnet wird der Stand.
  const scaleNow = phases.kbScale / CARD.kenBurnsFrom
  const zb = from.width * scaleNow
  const zh = from.height * scaleNow
  const zx = x + (image.width - zb) / 2
  const zy = y + (image.height - zh) / 2
  const t = phases.develop
  if (t < 1) ctx.drawImage(from.canvas, zx, zy, zb, zh)
  if (t > 0) {
    const prev = ctx.globalAlpha
    ctx.globalAlpha = prev * (t < 1 ? t : 1)
    ctx.drawImage(to.canvas, zx, zy, zb, zh)
    ctx.globalAlpha = prev
  }
  return true
}

/** Breite der Angaben-Zeile, zweistufig gesetzt und deshalb stückweise gemessen. */
function factsWidth(ctx: CanvasRenderingContext2D, fontSize: number, facts: string): number {
  ctx.save()
  let width = 0
  for (const t of splitFacts(facts)) {
    ctx.font = fontOf(fontSize, t.digits ? 500 : 400)
    width += ctx.measureText(t.part).width
  }
  ctx.restore()
  return width
}

function factsDoNotFit(ctx: CanvasRenderingContext2D, g: CardGeometry, text: CardText): boolean {
  const facts = factsText(text)
  if (!facts || !text.title) return false
  const width = factsWidth(ctx, g.text.facts.fontPx, facts)
  ctx.save()
  ctx.font = fontOf(g.text.title.fontPx, 600)
  const titleW = ctx.measureText(text.title).width
  ctx.restore()
  // Der geforderte Zwischenraum ist DOPPELT so groß wie der gesetzte: Passen
  // beide nur mit einer Lücke nebeneinander, stehen sie zwar nebeneinander,
  // lesen sich aber als ein Block. An der Hochkant-Karte (323 px breit)
  // ergaben sich rechnerisch 285 verfügbare gegen 284 gebrauchte Pixel — sie
  // berührten sich fast, und genau dieser Fall soll zwei Zeilen bekommen.
  return titleW + g.metrics.gapX * g.scale * 2 + width > g.text.title.width
}

/**
 * Uhrzeit und Kilometerstand als EIN Text: „14:54 Uhr · 4,1 km".
 *
 * Zwei Felder und eine Zeile, weil beide dasselbe beantworten (wo in der Tour
 * ist das hier) und je Bühne verschieden belegt sind: Der Player schickt die
 * Zählung und den Kilometerstand, der Editor Uhrzeit und Kilometerstand.
 */
export function factsText(text: CardText): string {
  return [text.counterText, text.kmText].filter(Boolean).join(' · ')
}

/**
 * Zerlegt die Angaben in Ziffern und Wörter.
 *
 * Zweistufig gesetzt trägt die Zeile ihre Auskunft besser: „14:54" und „4,1"
 * sind die Antwort, „Uhr" und „km" sagen nur, wovon die Rede ist. Die Trennung
 * hier und nicht in der Datenstruktur, weil sie eine SATZ-Entscheidung ist —
 * die Aufrufer sollen weiter fertige Zeichenketten schicken.
 */
export function splitFacts(text: string): { part: string; digits: boolean }[] {
  const parts: { part: string; digits: boolean }[] = []
  for (const m of text.matchAll(/[0-9][0-9.,:]*|[^0-9]+/g)) {
    const part = m[0]
    if (part) parts.push({ part, digits: /^[0-9]/.test(part) })
  }
  return parts
}

function paintCaption(
  ctx: CanvasRenderingContext2D,
  g: CardGeometry,
  text: CardText,
  phases: CardPhases,
  density: number,
  ownLine: boolean,
): void {
  const kx = g.card.x
  const ky = g.card.y

  // Angaben — rechtsbündig, ohne Rahmen. Der Kasten drumherum ist gefallen:
  // Ein Rand und eine Fläche sagen „hier steht eine Marke", und das ist eine
  // Uhrzeit nicht.
  const facts = factsText(text)
  let factsW = 0
  if (facts) {
    const parts = splitFacts(facts)
    factsW = factsWidth(ctx, g.text.facts.fontPx, facts)
    const height = g.text.facts.height
    paintTextBuffer(
      ctx,
      density,
      {
        key: `angaben|${facts}|${g.text.facts.fontPx.toFixed(1)}|${factsW.toFixed(0)}`,
        width: factsW + 2,
        height,
        paint: (c) => {
          c.textBaseline = 'middle'
          let x = 0
          for (const t of parts) {
            c.font = fontOf(g.text.facts.fontPx, t.digits ? 500 : 400)
            c.fillStyle = t.digits ? CARD_COLORS.factsDigits : CARD_COLORS.factsWord
            c.fillText(t.part, x, height / 2)
            x += c.measureText(t.part).width
          }
        },
      },
      // `x` der Geometrie ist die RECHTE Kante der Zeile — in JEDER Lage. Der
      // Sonderfall stand hier, solange quer eine Textspalte hatte; blieb er
      // stehen, lief die Zeile auf dem Telefon rechts aus der Karte heraus.
      g.text.facts.x - factsW - kx,
      g.text.facts.y - ky + phases.facts.lift * g.scale,
      phases.facts.alpha,
    )
  }

  // Titel — eine Zeile, gekürzt. Ein zweizeiliger Titel verschöbe das Bild:
  // Die Kartenhöhe ist auf eine Titelzeile gerechnet.
  if (text.title) {
    // Auf der gemeinsamen Zeile bleibt dem Titel, was die Angaben übrig
    // lassen. Steht er allein (eigene Zeile oder Spalte), die volle Breite.
    const maxW =
      !ownLine && factsW > 0 && g.layout !== 'landscape'
        ? g.text.title.width - factsW - g.metrics.gapX * g.scale
        : g.text.title.width
    ctx.save()
    ctx.font = fontOf(g.text.title.fontPx, 600)
    const clipped = truncateText(text.title, Math.max(20, maxW), (s) => ctx.measureText(s).width)
    const width = Math.max(1, ctx.measureText(clipped).width)
    ctx.restore()
    const lineH = g.text.facts.height
    paintTextBuffer(
      ctx,
      density,
      {
        key: `titel|${clipped}|${g.text.title.fontPx.toFixed(1)}`,
        width: width + 2,
        height: lineH,
        paint: (c) => {
          c.fillStyle = CARD_COLORS.title
          c.font = fontOf(g.text.title.fontPx, 600)
          c.textBaseline = 'middle'
          c.fillText(clipped, 0, lineH / 2)
        },
      },
      g.text.title.x - kx,
      g.text.title.y - ky + phases.title.lift * g.scale,
      phases.title.alpha,
    )
  }
}
