// Stimmung und Wetter auf der Editor-Karte (Konzept §10, E7).
//
// Der Editor SAGT beides längst — eine Wetter-Bahn mit Modus und Stärke, ein
// Tageszeit-Symbol neben der Uhr —, er ZEIGT es nur nicht. Diese Datei schließt
// die Lücke, und zwar mit dem Teil der Player-Regie, der auch auf einer
// Draufsicht trägt.
//
// **Der Editor hat ZWEI Betriebsarten, und sie verlangen Verschiedenes.**
//
// Beim Stehen und beim Scrubben muss jedes Bild eine FUNKTION der Kopfposition
// sein — vorwärts, rückwärts und nach einem Sprung. Das können das GRADING des
// Satellitenbilds (`paramsAt`) und der SCHLEIER aus `wetterhimmel.ts`; ein
// Partikelsystem kann es nicht, denn es ist Zustand: Jeder Tropfen wird aus
// dem vorigen Bild fortgeschrieben.
//
// Beim ABSPIELEN läuft dagegen ein Film in Echtzeit vorwärts, und dort sind
// Partikel und Klang genau richtig — das Abspielen ist die Schnittprüfung, und
// wer prüft, soll hören und sehen, was der Player später zeigt. Deshalb hängt
// das Overlay an `setLauf` und schweigt sonst. Dieselbe Regel wie beim Video im
// Editor, das ebenfalls nur bei Tempo 1 läuft.
//
// Ein erster Anlauf hängte die Partikel dauerhaft hinein, und alles, was daran
// falsch war, hing an dieser fehlenden Bindung: Es regnete bei stehendem Kopf,
// es klang beim Scrubben, der Ton lief nach dem Verlassen der Tour weiter.
// Geblieben ist aus jener Runde der Befund zu `clouds`/`fog` — die haben in
// weather.ts kein Profil (ihren Himmel zeichnet im Player die Atmosphäre), für
// sie trägt der Schleier allein.
//
// Nicht übertragbar bleiben `setLight` (braucht Gelände, damit eine
// Lichtrichtung etwas beleuchtet) und `setSky` (braucht einen Horizont).
//
// **Ein Paint je Änderung, keine Schleife** (Konzept §10). Gesetzt wird erst,
// wenn sich ein gerundeter Wert tatsächlich unterscheidet — sonst kostet jedes
// Scrub-Frame vier `setPaintProperty`-Aufrufe für dasselbe Bild.

import { paramsAt, rastergrading, type Rastergrading } from '../daynight.js'
import { sunPosition } from '../sun.js'
import { createWeather, type Wetteroverlay } from '../weather.js'
import { bildwirkung, schleierFuer, type SzenenWetter, type Wettergrading } from '../wetterhimmel.js'
// Bewusst der Studio-Typ und nicht der aus `autoweather.ts`: Was hier ankommt,
// sind die Grenzen aus dem Edit-Overlay bzw. dem Auto-Wetter des Servers, und
// die tragen genau diese Liste (`WETTER_MODI`, gewacht gegen das Server-Schema).
import type { WetterModus } from './editmodell.js'
import type { Map as MapLibreMap } from 'maplibre-gl'

/** Neutral: kein Grading. Der Zustand, in den „Tag/Nacht aus" zurückfällt. */
const NEUTRAL: Rastergrading = { brightnessMax: 1, brightnessMin: 0, saturation: 0, contrast: 0 }

export interface Wetterstand {
  mode: WetterModus
  staerke?: number
}

export interface Kartenstimmung {
  /**
   * Die Stimmung am Abspielkopf setzen. Aufzurufen, wo auch das Foto und die
   * Kartenposition nachziehen — eine FUNKTION der Kopfposition, kein Ereignis.
   */
  setze(zeitIso: string, ort: [number, number], wetter: Wetterstand | null): void
  setTagNacht(an: boolean): void
  setWetter(an: boolean): void
  /**
   * Läuft der Film gerade — und mit welchem Tempo?
   *
   * Daran hängt, ob es zusätzlich zum Schleier auch REGNET: Partikel und Klang
   * brauchen eine vorwärts laufende Echtzeit, und die gibt es nur beim
   * Abspielen bei Tempo 1. Dieselbe Regel wie beim Video im Editor.
   */
  setLauf(tempo: number): void
  /** Beim Schließen der Tour: Bildschleife, Klänge und Canvas zurücknehmen. */
  zerstoere(): void
  readonly tagNachtAn: boolean
  readonly wetterAn: boolean
}

/**
 * @param karte  die Editor-Karte
 * @param layer  Raster-Layer, der gegradet wird (im Editor `sat`, im Player hieße er `satellite`)
 * @param buehne Element, in das der Schleier gehängt wird (die Kartenbühne)
 */
export function erzeugeKartenstimmung(karte: MapLibreMap, layer: string, buehne: HTMLElement): Kartenstimmung {
  let tagNacht = false
  let wetterAn = false
  // Zuletzt GESETZTE Werte — der Vergleich hält die Paint-Aufrufe draußen.
  let gesetzt: Rastergrading | null = null
  let letzterSchleier = ''
  // Letzter bekannter Stand, damit ein Schalter sofort greift statt erst beim
  // nächsten Kopfschritt: Wer „Wetter an" drückt und nichts sieht, drückt noch
  // einmal.
  let stand: { zeitIso: string; ort: [number, number]; wetter: Wetterstand | null } | null = null

  /**
   * Der Schleier ist ein DIV, kein Canvas.
   *
   * Was zu zeichnen ist, sind zwei Flächen und ein Verlauf — dafür ist CSS das
   * kleinere Werkzeug: kein Kontext, keine Auflösung, keine Größenrechnung (und
   * damit auch keine Rückkopplung zwischen geschriebener und gemessener Größe,
   * die den Tab schon einmal angehalten hat). Er entsteht beim ersten
   * Einschalten und bleibt danach liegen.
   */
  /**
   * Das Partikel-Overlay — nur beim ABSPIELEN, und nur bei Tempo 1.
   *
   * Der erste Anlauf hängte es dauerhaft in den Editor, und das war falsch: Es
   * regnete bei stehendem Kopf, klang beim Scrubben und lief nach dem Verlassen
   * der Tour weiter. Der Fehler war aber nicht das Overlay, sondern die fehlende
   * BINDUNG. Ein Partikelsystem braucht eine vorwärts laufende Echtzeit — genau
   * die, die das Abspielen herstellt. Steht der Kopf, wird gescrubbt oder läuft
   * der Schnelllauf, friert es ein und verstummt; der Schleier trägt dann allein
   * die Auskunft, was für Wetter dort ist. Dieselbe Regel wie beim Video im
   * Editor, das ebenfalls nur bei Tempo 1 läuft und sonst schweigt.
   */
  let partikel: Wetteroverlay | null = null
  let laeuft = false
  const holePartikel = (): Wetteroverlay => {
    if (!partikel) {
      partikel = createWeather(buehne)
      // Das Overlay fragt selbst, ob es zeichnen darf — so bringt es seine
      // eigene Blende ins Standbild mit, statt hart zu stoppen.
      partikel.setGate(() => laeuft)
      partikel.setSoundEnabled(laeuft)
    }
    return partikel
  }

  let schleierEl: HTMLElement | null = null
  const holeSchleier = (): HTMLElement => {
    if (!schleierEl) {
      schleierEl = document.createElement('div')
      schleierEl.className = 'karten-schleier'
      schleierEl.setAttribute('aria-hidden', 'true')
      buehne.appendChild(schleierEl)
    }
    return schleierEl
  }

  const gradiere = (g: Rastergrading): void => {
    if (
      gesetzt &&
      gesetzt.brightnessMax === g.brightnessMax &&
      gesetzt.brightnessMin === g.brightnessMin &&
      gesetzt.saturation === g.saturation &&
      gesetzt.contrast === g.contrast
    ) {
      return
    }
    // Der Layer fehlt, solange der Stil lädt — dann ist auch nichts zu graden.
    if (!karte.getLayer(layer)) return
    karte.setPaintProperty(layer, 'raster-brightness-max', g.brightnessMax)
    karte.setPaintProperty(layer, 'raster-brightness-min', g.brightnessMin)
    karte.setPaintProperty(layer, 'raster-saturation', g.saturation)
    karte.setPaintProperty(layer, 'raster-contrast', g.contrast)
    gesetzt = g
  }

  /**
   * Der Wetter-Anteil des Bildes.
   *
   * Drei Wege, und alle drei sind nötig: der SCHLEIER über der Karte (Farbton),
   * das GRADING des Bildes (Helligkeit und Sättigung — „bedeckt" heißt weniger
   * Licht und weniger Farbe, und das kann eine Fläche darüber nicht) und die
   * SCHNEEDECKE. Mit dem Schleier allein lagen Wolken und Regen auf der echten
   * Karte bei 102 bzw. 97 mittlerer Helligkeit gegen 94 ohne Wetter — also
   * heller statt dunkler, weil ein helles Grau über einer dunklen Landschaft
   * aufhellt.
   */
  const wetterBild = (w: Wetterstand | null): { schnee: number; bild: Wettergrading } => {
    const modus: SzenenWetter = (wetterAn && w ? w.mode : 'off') as SzenenWetter
    const s = schleierFuer(modus, w?.staerke ?? 0.7)
    // Zwei Farbflächen übereinander plus, bei Nebel, ein weicher Verlauf von
    // den Rändern her — dieselbe Reihenfolge wie im Player (`wash` über `dark`).
    const nebel =
      s.nebel > 0
        ? `, radial-gradient(120% 100% at 50% 50%, rgba(226,232,240,${(0.1 * s.nebel).toFixed(3)}) 0%, rgba(226,232,240,${(0.42 * s.nebel).toFixed(3)}) 100%)`
        : ''
    const bild = modus === 'off' ? '' : `linear-gradient(${s.wasch}, ${s.wasch}), linear-gradient(${s.schatten}, ${s.schatten})${nebel}`
    if (bild !== letzterSchleier) {
      // Erst bauen, wenn wirklich etwas zu zeigen ist — wer das Wetter nie
      // einschaltet, bekommt auch kein Element in den DOM.
      if (bild || schleierEl) {
        const el = holeSchleier()
        el.style.backgroundImage = bild
        el.hidden = !bild
      }
      letzterSchleier = bild
    }
    // Die Partikel bekommen dieselbe Lage. Gebaut wird das Overlay erst, wenn
    // tatsächlich abgespielt wird: Wer nur schneidet, bekommt weder Canvas noch
    // Klang-Loops. `clouds`/`fog` haben dort ohnehin keine Tropfen — für sie
    // bleibt es beim Schleier, und das ist richtig so.
    if (partikel || (laeuft && modus !== 'off')) {
      const o = holePartikel()
      if (o.mode !== modus) o.setMode(modus)
      if (modus !== 'off') o.setIntensity(w?.staerke ?? 0.7)
    }
    return { schnee: s.schnee, bild: bildwirkung(modus, w?.staerke ?? 0.7) }
  }

  /** Wetter auf ein fertiges Grading legen — Licht mal Faktor, Farbe minus Abzug. */
  const mitWetter = (g: Rastergrading, b: Wettergrading): Rastergrading => ({
    brightnessMax: +Math.max(0, Math.min(1, g.brightnessMax * b.helligkeit)).toFixed(3),
    brightnessMin: g.brightnessMin,
    // Die Sättigung ist bei MapLibre auf [-1, 1] geklemmt; ohne die Klemme
    // fiele eine schon nächtlich entsättigte Karte unter -1 und der Wert würde
    // still verworfen.
    saturation: +Math.max(-1, Math.min(1, g.saturation + b.saettigung)).toFixed(3),
    contrast: g.contrast,
  })

  const anwenden = (): void => {
    if (!stand) return
    const { schnee, bild } = wetterBild(stand.wetter)
    if (tagNacht) {
      // Der Sonnenstand hängt an Datum UND Ort — deshalb beides. Die
      // Stunden-Heuristik des Uhr-Symbols reicht hier nicht: Sie kennt weder
      // die Jahreszeit noch den Breitengrad, und auf der Karte sähe man den
      // Unterschied sofort (Mitternachtssonne gegen Polarnacht).
      const sonne = sunPosition(new Date(stand.zeitIso), stand.ort[1], stand.ort[0])
      gradiere(mitWetter(rastergrading(paramsAt(sonne.altitude), schnee), bild))
    } else {
      // Ohne Tageszeit-Regie trotzdem Schneedecke und Wetter-Grading: Beide
      // gehören zum WETTER, nicht zum Licht. Volles Tageslicht als Grundlage —
      // genau das, was „Tageszeit aus" bedeutet.
      const TAG = { br: 1, sat: 0, con: 0, li: 0.4, sky: '', hor: '', fog: '', lc: '' }
      gradiere(mitWetter(rastergrading(TAG, schnee), bild))
    }
  }

  return {
    setze(zeitIso, ort, w) {
      stand = { zeitIso, ort, wetter: w }
      anwenden()
    },
    setTagNacht(an) {
      if (an === tagNacht) return
      tagNacht = an
      anwenden()
    },
    setWetter(an) {
      if (an === wetterAn) return
      wetterAn = an
      // Ausschalten heißt auch: keine Tropfen mehr. `anwenden` setzt das
      // Overlay über `wetterBild` auf 'off', der Rest klingt von selbst aus.
      anwenden()
    },
    setLauf(tempo) {
      const neu = tempo === 1
      if (neu === laeuft) return
      laeuft = neu
      partikel?.setSoundEnabled(neu)
      // Das Gate liest `laeuft` selbst; ein Aufruf von `anwenden` baut das
      // Overlay nach, falls gerade zum ersten Mal abgespielt wird.
      anwenden()
    },
    zerstoere() {
      partikel?.zerstoere()
      partikel = null
      schleierEl?.remove()
      schleierEl = null
    },
    get tagNachtAn() {
      return tagNacht
    },
    get wetterAn() {
      return wetterAn
    },
  }
}
