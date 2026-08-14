// Stimmung und Wetter auf der Editor-Karte (Konzept §10, E7).
//
// Der Editor SAGT beides längst — eine Wetter-Bahn mit Modus und Stärke, ein
// Tageszeit-Symbol neben der Uhr —, er ZEIGT es nur nicht. Diese Datei schließt
// die Lücke, und zwar mit dem Teil der Player-Regie, der auch auf einer
// Draufsicht trägt.
//
// **Alles hier ist eine FUNKTION der Kopfposition.** Das ist die eigentliche
// Anforderung, und sie entscheidet, was übertragbar ist: Der Editor springt in
// einer Datei umher, also muss jedes Bild aus der Filmzeit allein folgen —
// vorwärts, rückwärts und nach einem Sprung. Übertragbar sind damit das GRADING
// des Satellitenbilds (`paramsAt`) und der SCHLEIER aus `wetterhimmel.ts`.
//
// **Nicht übertragbar ist das Partikel-Overlay** (weather.ts), und ein erster
// Anlauf damit hat genau das gezeigt: Es regnete bei stehendem Abspielkopf
// weiter, es klang beim Scrubben, der Ton lief nach dem Verlassen des Editors
// weiter — und Wolken und Nebel fehlten ganz, weil sie dort kein Profil haben
// (ihren Himmel zeichnet im Player die Atmosphäre, die es hier nicht gibt).
// Ein Partikelsystem ist Zustand: Jeder Tropfen wird aus dem vorigen Bild
// fortgeschrieben. Das lässt sich nicht anfahren, nur abspielen.
//
// Ebenfalls nicht übertragbar: `setLight` (braucht Gelände, damit eine
// Lichtrichtung etwas beleuchtet) und `setSky` (braucht einen Horizont).
//
// **Ein Paint je Änderung, keine Schleife** (Konzept §10). Gesetzt wird erst,
// wenn sich ein gerundeter Wert tatsächlich unterscheidet — sonst kostet jedes
// Scrub-Frame vier `setPaintProperty`-Aufrufe für dasselbe Bild.

import { paramsAt, rastergrading, type Rastergrading } from '../daynight.js'
import { sunPosition } from '../sun.js'
import { schleierFuer, type SzenenWetter } from '../wetterhimmel.js'
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

  /** Der Wetter-Anteil des Bildes: Schleier über der Karte, Schnee im Grading. */
  const wetterBild = (w: Wetterstand | null): { schnee: number } => {
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
    return { schnee: s.schnee }
  }

  const anwenden = (): void => {
    if (!stand) return
    const { schnee } = wetterBild(stand.wetter)
    if (tagNacht) {
      // Der Sonnenstand hängt an Datum UND Ort — deshalb beides. Die
      // Stunden-Heuristik des Uhr-Symbols reicht hier nicht: Sie kennt weder
      // die Jahreszeit noch den Breitengrad, und auf der Karte sähe man den
      // Unterschied sofort (Mitternachtssonne gegen Polarnacht).
      const sonne = sunPosition(new Date(stand.zeitIso), stand.ort[1], stand.ort[0])
      gradiere(rastergrading(paramsAt(sonne.altitude), schnee))
    } else if (schnee > 0) {
      // Ohne Tageszeit-Regie trotzdem die Schneedecke: Sie gehört zum WETTER,
      // nicht zum Licht. Volles Tageslicht als Grundlage — genau das, was
      // „Tageszeit aus" bedeutet.
      gradiere(rastergrading({ br: 1, sat: 0, con: 0, li: 0.4, sky: '', hor: '', fog: '', lc: '' }, schnee))
    } else {
      gradiere(NEUTRAL)
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
      anwenden()
    },
    get tagNachtAn() {
      return tagNacht
    },
    get wetterAn() {
      return wetterAn
    },
  }
}
