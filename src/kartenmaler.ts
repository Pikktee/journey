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
 * Welche Lage gilt — abgeleitet, nicht übergeben.
 *
 * Dieselben Schwellen, an denen bis Etappe 2 `body.kompakt-quer` (main.ts,
 * `KOMPAKT_HOEHE`) und `@media (max-width: 700px)` hingen. Ein eigener Schalter
 * im Aufruf wäre eine zweite Wahrheit über dieselbe Geometrie.
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
  unter: number
  unterMindest: number
  unterZeile: number
  /** Höchstzahl der Zeilen der Bildunterschrift — darüber wird gekürzt. */
  unterZeilen: number
  pille: number
  pilleMindest: number
  pillePolsterX: number
  pillePolsterY: number
  weiter: number
  weiterPolsterX: number
  weiterPolsterY: number
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
 * Die Nennmaße der drei Lagen.
 *
 * Die Zahlen der Lage `breit` sind die, die die abgelöste CSS-Fassung bei
 * 1600 × 900 ergab; `schmal` und `quer` stammen aus deren Media-Query bzw. aus
 * `body.kompakt-quer`. Sie stehen hier und nicht in `einblendung.ts`, weil der
 * Editor eine eigene, kleine Karte auf einem Leuchttisch hat: Diese Geometrie
 * ist nicht geteilt und war es nie (§3.7 — was verschieden sein darf, steht als
 * solches da).
 */
export const KARTEN_MASSE: Record<KartenLage, KartenMassSatz> = {
  breit: {
    polster: 16,
    chrome: 235,
    chromeBedienung: 335,
    breiteAnteil: 0.92,
    breiteMax: 1500,
    textOben: 13,
    textSeiten: 6,
    textUnten: 15,
    lueckeX: 16,
    lueckeY: 2,
    titel: 32,
    titelMindest: 19,
    titelZeile: 1.2,
    unter: 14,
    unterMindest: 11.5,
    unterZeile: 1.55,
    unterZeilen: 2,
    pille: 11.5,
    pilleMindest: 8.5,
    pillePolsterX: 10,
    pillePolsterY: 4,
    weiter: 13,
    weiterPolsterX: 18,
    weiterPolsterY: 10,
    balken: 4,
    kartenRadius: 12,
    tonSeite: 40,
    tonRand: 10,
    hubBedienung: 48,
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
    unter: 11,
    unterMindest: 10,
    unterZeile: 1.45,
    unterZeilen: 2,
    pille: 8.5,
    pilleMindest: 7.5,
    pillePolsterX: 8,
    pillePolsterY: 3,
    weiter: 10,
    weiterPolsterX: 14,
    weiterPolsterY: 9,
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
    unter: 10.5,
    unterMindest: 9.5,
    unterZeile: 1.45,
    unterZeilen: 3,
    pille: 8.5,
    pilleMindest: 7.5,
    pillePolsterX: 8,
    pillePolsterY: 3,
    weiter: 10,
    weiterPolsterX: 15,
    weiterPolsterY: 9,
    balken: 4,
    kartenRadius: 12,
    tonSeite: 34,
    tonRand: 8,
    hubBedienung: 22,
  },
}

/** Boden des Bildradius: darunter ist es kein Radius mehr, nur ein Pixelrand. */
const RAHMEN_RADIUS_MIN = 3

/** Farben der Karte. Bewusst hier und nicht als Token-Lesung: der Maler ist DOM-frei. */
export const KARTEN_FARBEN = {
  papier: '#f6f1e7',
  titel: '#1c1712',
  unter: 'rgba(28, 23, 18, 0.62)',
  pille: '#8a7a63',
  pilleRand: 'rgba(28, 23, 18, 0.2)',
  /** Bildfeld, solange das Foto noch fehlt — dasselbe Papiergrau wie vorher. */
  bildfeld: '#d8d2c4',
  video: '#000',
  balken: 'rgba(10, 8, 5, 0.3)',
  balkenVon: '#f5a524',
  balkenBis: '#ff6f52',
  blitz: '255, 250, 240',
  schatten: 'rgba(0, 0, 0, 0.55)',
} as const

export interface KartenBuehne {
  /** Bühnenbreite in CSS-Pixeln — NIE in Gerätepixeln (Falle 6). */
  breite: number
  hoehe: number
  /**
   * Steht die Steuerleiste? Dann macht die Karte ihr Platz und rückt hoch.
   *
   * Nur am Bildschirm: Im Film gibt es keine Leiste, der Export setzt das
   * niemals (Konzept §5).
   */
  bedienungSteht?: boolean
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
  unter: string
  /** „12.3 km" — steht immer. */
  kmText: string
  /** „Foto 1/2" — leer, wenn der Halt nur eine Aufnahme hat. */
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
  /** „Weiter ▸": Lage UND Schriftgrad, damit der Knopf mitskaliert. */
  weiter: Rechteck & { schrift: number; radius: number }
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

/** Staffelung der Beschriftung: Titel, Unterschrift, Pille (Sekunden Versatz). */
export const TEXT_VERSATZ_S = { titel: 0.35, unter: 0.45, pille: 0.55 } as const
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
  /** Deckkraft des Kamerablitzes. */
  blitz: number
  /** Füllstand des Standzeit-Balkens. */
  balken: number
  titel: TextAuftritt
  unter: TextAuftritt
  pille: TextAuftritt
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
      blitz: 0,
      balken,
      titel: { deckkraft: 1, hub: 0 },
      unter: { deckkraft: 1, hub: 0 },
      pille: { deckkraft: 1, hub: 0 },
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
    blitz: blitzDeckkraft(imS),
    balken,
    titel: textAuftritt(imS, TEXT_VERSATZ_S.titel, false),
    unter: textAuftritt(imS, TEXT_VERSATZ_S.unter, false),
    pille: textAuftritt(imS, TEXT_VERSATZ_S.pille, false),
  }
}

/**
 * Der Kamerablitz — drei Keyframe-Stufen (0 → Spitze → 0), jede mit `ease-out`.
 *
 * CSS legt die Kurve zwischen JEDES Paar von Stufen, nicht über die ganze
 * Animation. Wer sie einmal über die Gesamtdauer legt, bekommt einen Blitz, der
 * langsamer aufflammt und schneller verschwindet als der im Editor.
 */
export function blitzDeckkraft(imS: number): number {
  const t = imS / KARTE.blitzDauerS
  if (t <= 0 || t >= 1) return 0
  const spitzeBei = KARTE.blitzSpitzeBei
  if (t < spitzeBei) return KARTE.blitzSpitze * KURVE.easeOut(t / spitzeBei)
  return KARTE.blitzSpitze * (1 - KURVE.easeOut((t - spitzeBei) / (1 - spitzeBei)))
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
    unter: { x: number; y: number; breite: number; schrift: number; zeile: number }
    pillen: { x: number; y: number; hoehe: number; schrift: number; rechtsAusgerichtet: true }
    weiter: Rechteck & { schrift: number; radius: number }
  }
  rahmenRadius: number
  kartenRadius: number
  balkenHoehe: number
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
export function kartenGeometrie(buehne: KartenBuehne, medium: KartenMedium): KartenGeometrie {
  const { breite, hoehe } = buehne
  const mass = kartenMass(hoehe)
  const lage = kartenLage(breite, hoehe)
  const satz = KARTEN_MASSE[lage]
  const px = (nenn: number) => nenn * mass

  const ar = klemme(medium.ar ?? 1.5, AR_MIN, AR_MAX)
  const chrome = px(buehne.bedienungSteht ? satz.chromeBedienung : satz.chrome)
  const maxB = Math.min(px(satz.breiteMax), breite * satz.breiteAnteil)
  const bildH = Math.max(1, Math.min(hoehe - chrome, maxB / ar))
  const bildB = Math.max(1, bildH * ar)

  const titelSchrift = grad(satz.titel, mass, satz.titelMindest)
  const unterSchrift = grad(satz.unter, mass, satz.unterMindest)
  const pilleSchrift = grad(satz.pille, mass, satz.pilleMindest)
  const weiterSchrift = grad(satz.weiter, mass, satz.pilleMindest)
  const pilleH = pilleSchrift * 1.35 + px(satz.pillePolsterY) * 2
  const weiterH = weiterSchrift * 1.25 + px(satz.weiterPolsterY) * 2
  const titelH = titelSchrift * satz.titelZeile
  const unterZeile = unterSchrift * satz.unterZeile

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
    unter: { x: 0, y: 0, breite: 0, schrift: unterSchrift, zeile: unterZeile },
    pillen: { x: 0, y: 0, hoehe: pilleH, schrift: pilleSchrift, rechtsAusgerichtet: true },
    weiter: { x: 0, y: 0, breite: 0, hoehe: weiterH, schrift: weiterSchrift, radius: weiterH / 2 },
  }

  if (lage === 'quer') {
    // Bild links, Text als eigene Spalte rechts.
    //
    // Der Textblock reserviert `unterZeilen` Zeilen für die Bildunterschrift und
    // nicht zwei: Die Spalte ist schmal, drei Zeilen sind dort der Normalfall,
    // und mit zwei reservierten lief die Kilometer-Pille in die dritte Zeile
    // hinein (am 844 × 390-Bild gemessen).
    const spalteB = Math.min(breite * 0.34, px(280))
    const unterH = unterZeile * satz.unterZeilen
    const blockH = titelH + lueckeY + unterH + lueckeY + pilleH + lueckeY + weiterH
    karteB = polster * 2 + bildB + lueckeX + spalteB
    karteH = polster * 2 + Math.max(bildH, blockH)
    bildX = polster
    bildY = (karteH - bildH) / 2
    const sx = polster + bildB + lueckeX
    const innen = spalteB - textSeiten
    let y = (karteH - blockH) / 2
    text.titel = { x: sx, y, breite: innen, schrift: titelSchrift }
    y += titelH + lueckeY
    text.unter = { x: sx, y, breite: innen, schrift: unterSchrift, zeile: unterZeile }
    y += unterH + lueckeY
    text.pillen = { x: sx, y, hoehe: pilleH, schrift: pilleSchrift, rechtsAusgerichtet: true }
    y += pilleH + lueckeY
    text.weiter = { x: sx, y, breite: 0, hoehe: weiterH, schrift: weiterSchrift, radius: weiterH / 2 }
  } else {
    karteB = bildB + polster * 2
    bildX = polster
    bildY = polster
    const innenX = polster + textSeiten
    const innenB = bildB - textSeiten * 2
    const zeileH = Math.max(titelH, pilleH, weiterH)
    let y = polster + bildH + textOben
    if (lage === 'schmal') {
      // Titel auf eigener Zeile, darunter Pillen links und „Weiter" rechts.
      text.titel = { x: innenX, y, breite: innenB, schrift: titelSchrift }
      y += titelH + lueckeY
      const zeile2 = Math.max(pilleH, weiterH)
      text.pillen = {
        x: innenX,
        y: y + (zeile2 - pilleH) / 2,
        hoehe: pilleH,
        schrift: pilleSchrift,
        rechtsAusgerichtet: true,
      }
      text.weiter = {
        x: innenX + innenB,
        y: y + (zeile2 - weiterH) / 2,
        breite: 0,
        hoehe: weiterH,
        schrift: weiterSchrift,
        radius: weiterH / 2,
      }
      y += zeile2 + lueckeY
    } else {
      text.titel = { x: innenX, y: y + (zeileH - titelH) / 2, breite: innenB, schrift: titelSchrift }
      text.pillen = {
        x: innenX + innenB,
        y: y + (zeileH - pilleH) / 2,
        hoehe: pilleH,
        schrift: pilleSchrift,
        rechtsAusgerichtet: true,
      }
      text.weiter = {
        x: innenX + innenB,
        y: y + (zeileH - weiterH) / 2,
        breite: 0,
        hoehe: weiterH,
        schrift: weiterSchrift,
        radius: weiterH / 2,
      }
      y += zeileH + lueckeY
    }
    text.unter = { x: innenX, y, breite: innenB, schrift: unterSchrift, zeile: unterZeile }
    karteH = y + unterZeile * satz.unterZeilen + textUnten
  }

  const x = (breite - karteB) / 2
  const yMitte =
    (hoehe - karteH) / 2 - (buehne.bedienungSteht ? px(satz.hubBedienung) : 0)

  // Bis hier ist alles KARTEN-relativ gerechnet, weil die Beschriftung sich an
  // Bild und Kartenrand ausrichtet. Nach außen gilt EIN Bezugssystem: die Bühne.
  // Zwei gemischte Systeme waren der erste Fehler dieses Malers — die
  // Textblöcke landeten in der Lage `quer` um die halbe Kartenbreite versetzt.
  text.titel = { ...text.titel, x: text.titel.x + x, y: text.titel.y + yMitte }
  text.unter = { ...text.unter, x: text.unter.x + x, y: text.unter.y + yMitte }
  text.pillen = { ...text.pillen, x: text.pillen.x + x, y: text.pillen.y + yMitte }
  text.weiter = { ...text.weiter, x: text.weiter.x + x, y: text.weiter.y + yMitte }

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
  const g = kartenGeometrie(buehne, stand.medium)
  const dichte = klemme(Math.abs(ctx.getTransform().a) || 1, 1, 3)

  // Der Blitz liegt über der Szene und UNTER der Karte, wie sein DOM-Vorgänger.
  if (phasen.blitz > 0.004) {
    const cx = buehne.breite * KARTE.blitzMitteX
    const cy = buehne.hoehe * KARTE.blitzMitteY
    const r = Math.max(buehne.breite, buehne.hoehe) * 0.78
    const verlauf = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
    verlauf.addColorStop(0, `rgba(${KARTEN_FARBEN.blitz}, ${KARTE.blitzInnen})`)
    verlauf.addColorStop(0.42 / 0.78, `rgba(${KARTEN_FARBEN.blitz}, ${KARTE.blitzAussen})`)
    verlauf.addColorStop(1, `rgba(${KARTEN_FARBEN.blitz}, 0)`)
    ctx.save()
    ctx.globalAlpha = phasen.blitz
    ctx.fillStyle = verlauf
    ctx.fillRect(0, 0, buehne.breite, buehne.hoehe)
    ctx.restore()
  }

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
  const hubFlug = mische(KARTE_BUEHNE.flugHubPx.player * g.mass, 0, phasen.flug)
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

  malBeschriftung(ctx, g, stand.text, phasen, dichte)
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
  const weiterB = weiterBreite(ctx, g)
  const weiterRoh: Rechteck = {
    // In `breit`/`schmal` nennt die Geometrie die RECHTE Kante (der Knopf steht
    // rechts außen), quer die linke.
    x: g.text.weiter.x - (g.lage === 'quer' ? 0 : weiterB),
    y: g.text.weiter.y,
    breite: weiterB,
    hoehe: g.text.weiter.hoehe,
  }
  const tonRoh: Rechteck | null =
    stand.medium.art === 'video'
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
      weiter: {
        ...skaliere(weiterRoh),
        schrift: g.text.weiter.schrift * skala,
        radius: g.text.weiter.radius * skala,
      },
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

/** Breite des „Weiter"-Knopfes — die DOM-Fläche folgt ihr. */
function weiterBreite(ctx: CanvasRenderingContext2D, g: KartenGeometrie): number {
  ctx.save()
  ctx.font = schrift(g.text.weiter.schrift, 600)
  const b = ctx.measureText(WEITER_TEXT).width
  ctx.restore()
  return b + g.satz.weiterPolsterX * g.mass * 2
}

/** Steht im Knopf und wird nur GEMESSEN — gezeichnet wird er im DOM (§3.3). */
export const WEITER_TEXT = 'Weiter ▸'

function malBeschriftung(
  ctx: CanvasRenderingContext2D,
  g: KartenGeometrie,
  text: KartenText,
  phasen: KartenPhasen,
  dichte: number,
): void {
  const kx = g.karte.x
  const ky = g.karte.y
  const weiterB = g.lage === 'quer' ? 0 : weiterBreite(ctx, g)
  const pillen = [text.zaehlerText, text.kmText].filter(Boolean)

  // Pillen — rechts ausgerichtet, in der Reihenfolge Zähler, Kilometer.
  ctx.save()
  ctx.font = schrift(g.text.pillen.schrift, 500)
  const pillenMasse = pillen.map((t) => ({
    text: t,
    breite: ctx.measureText(t).width + g.satz.pillePolsterX * g.mass * 2,
  }))
  ctx.restore()
  const pillenLuecke = 8 * g.mass
  const pillenGesamt =
    pillenMasse.reduce((s, p) => s + p.breite, 0) + Math.max(0, pillenMasse.length - 1) * pillenLuecke
  // In `breit` sitzt die Pillenreihe LINKS von „Weiter" am rechten Rand; quer
  // und schmal stehen beide links, dort ist `pillen.x` schon die linke Kante.
  let px =
    g.lage === 'breit'
      ? g.text.pillen.x - kx - weiterB - g.satz.lueckeX * g.mass - pillenGesamt
      : g.text.pillen.x - kx
  for (const p of pillenMasse) {
    malTextPuffer(
      ctx,
      dichte,
      {
        schluessel: `pille|${p.text}|${g.text.pillen.schrift.toFixed(1)}|${p.breite.toFixed(0)}x${g.text.pillen.hoehe.toFixed(0)}|${g.mass.toFixed(2)}`,
        breite: p.breite,
        hoehe: g.text.pillen.hoehe,
        malen: (c) => {
          c.strokeStyle = KARTEN_FARBEN.pilleRand
          c.lineWidth = Math.max(1, g.mass)
          c.beginPath()
          c.roundRect(
            c.lineWidth / 2,
            c.lineWidth / 2,
            p.breite - c.lineWidth,
            g.text.pillen.hoehe - c.lineWidth,
            g.text.pillen.hoehe / 2,
          )
          c.stroke()
          c.fillStyle = KARTEN_FARBEN.pille
          c.font = schrift(g.text.pillen.schrift, 500)
          c.textBaseline = 'middle'
          c.fillText(p.text, g.satz.pillePolsterX * g.mass, g.text.pillen.hoehe / 2)
        },
      },
      px,
      g.text.pillen.y - ky + phasen.pille.hub * g.mass,
      phasen.pille.deckkraft,
    )
    px += p.breite + pillenLuecke
  }

  // Titel — eine Zeile, gekürzt. Ein zweizeiliger Titel verschöbe das Bild:
  // Die Kartenhöhe ist auf eine Titelzeile gerechnet.
  if (text.titel) {
    const maxB =
      g.lage === 'breit'
        ? g.text.titel.breite - pillenGesamt - weiterB - g.satz.lueckeX * g.mass * 2
        : g.text.titel.breite
    ctx.save()
    ctx.font = schrift(g.text.titel.schrift, 600)
    const gekuerzt = kuerzeText(text.titel, Math.max(20, maxB), (s) => ctx.measureText(s).width)
    const breite = Math.max(1, ctx.measureText(gekuerzt).width)
    ctx.restore()
    const zeileH = g.text.titel.schrift * g.satz.titelZeile
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

  // Bildunterschrift — umgebrochen, höchstens `unterZeilen` Zeilen.
  if (text.unter) {
    ctx.save()
    ctx.font = schrift(g.text.unter.schrift, 500)
    const zeilen = brichText(
      text.unter,
      g.text.unter.breite,
      g.satz.unterZeilen,
      (s) => ctx.measureText(s).width,
    )
    ctx.restore()
    if (zeilen.length) {
      const h = zeilen.length * g.text.unter.zeile
      malTextPuffer(
        ctx,
        dichte,
        {
          schluessel: `unter|${zeilen.join(' ')}|${g.text.unter.schrift.toFixed(1)}|${g.text.unter.breite.toFixed(0)}`,
          breite: g.text.unter.breite + 2,
          hoehe: h,
          malen: (c) => {
            c.fillStyle = KARTEN_FARBEN.unter
            c.font = schrift(g.text.unter.schrift, 500)
            c.textBaseline = 'middle'
            zeilen.forEach((z, i) =>
              c.fillText(z, 0, g.text.unter.zeile * (i + 0.5)),
            )
          },
        },
        g.text.unter.x - kx,
        g.text.unter.y - ky + phasen.unter.hub * g.mass,
        phasen.unter.deckkraft,
      )
    }
  }
}
