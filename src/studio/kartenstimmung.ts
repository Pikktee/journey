// Stimmung und Wetter auf der Editor-Karte (Konzept §10, E7).
//
// Der Editor SAGT beides längst — eine Wetter-Bahn mit Modus und Stärke, ein
// Tageszeit-Symbol neben der Uhr —, er ZEIGT es nur nicht. Diese Datei schließt
// die Lücke, und zwar mit dem Teil der Player-Regie, der auch auf einer
// Draufsicht trägt.
//
// **Was übertragbar ist, ist das GRADING** (`raster-brightness-*`,
// `raster-saturation`, `raster-contrast` aus `paramsAt`) und das
// Partikel-Overlay. Was NICHT trägt, ist `setLight` (braucht Gelände, damit
// eine Lichtrichtung überhaupt etwas beleuchtet) und `setSky` (braucht einen
// Horizont, den eine Draufsicht nicht hat). Beides bleibt deshalb im Player.
//
// **Ein Paint je Änderung, keine Schleife.** Der Player ruft seine Regie pro
// Frame auf, weil dort die Pseudo-Uhr läuft; hier ändert sich die Stimmung nur,
// wenn der Kopf sich bewegt. Gesetzt wird erst, wenn sich ein gerundeter Wert
// tatsächlich unterscheidet — sonst kostet jedes Scrub-Frame vier
// `setPaintProperty`-Aufrufe für dasselbe Bild.

import { paramsAt, rastergrading, type Rastergrading } from '../daynight.js'
import { sunPosition } from '../sun.js'
import { createWeather, type Wetteroverlay } from '../weather.js'
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
  /** Wie im Player: false friert das Overlay ein (mit Blende ins Standbild). */
  setGate(fn: () => boolean): void
  readonly tagNachtAn: boolean
  readonly wetterAn: boolean
}

/**
 * @param karte  die Editor-Karte
 * @param layer  Raster-Layer, der gegradet wird (im Editor `sat`, im Player hieße er `satellite`)
 * @param buehne Element, in das der Wetter-Canvas gehängt wird (die Kartenbühne)
 */
export function erzeugeKartenstimmung(karte: MapLibreMap, layer: string, buehne: HTMLElement): Kartenstimmung {
  let tagNacht = false
  let wetterAn = false
  let wetter: Wetteroverlay | null = null
  let gate: (() => boolean) | null = null
  // Zuletzt GESETZTE Werte — der Vergleich hält die Paint-Aufrufe draußen.
  let gesetzt: Rastergrading | null = null
  let letzterModus: WetterModus | null = null
  let letzteStaerke = -1
  // Letzter bekannter Stand, damit ein Schalter sofort greift statt erst beim
  // nächsten Kopfschritt: Wer „Wetter an" drückt und nichts sieht, drückt noch
  // einmal.
  let stand: { zeitIso: string; ort: [number, number]; wetter: Wetterstand | null } | null = null

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
   * Das Overlay entsteht beim ERSTEN Einschalten und bleibt danach liegen.
   *
   * Nicht beim Start: Es hängt einen Canvas in den DOM, lädt Klang-Loops und
   * startet eine rAF-Schleife — für einen Schalter, der in der Vorgabe aus ist,
   * wäre das alles umsonst. Nicht wieder abgeräumt: Wer einmal geschaut hat,
   * schaltet meist wieder ein, und ein zweiter Aufbau kostete die Loops erneut.
   */
  const hole = (): Wetteroverlay => {
    if (!wetter) {
      wetter = createWeather(buehne)
      if (gate) wetter.setGate(gate)
    }
    return wetter
  }

  const zeigeWetter = (w: Wetterstand | null): void => {
    const modus: WetterModus = wetterAn && w ? w.mode : 'off'
    // Kein Overlay und nichts zu zeigen: gar nicht erst bauen.
    if (!wetter && modus === 'off') return
    const o = hole()
    if (modus !== letzterModus) {
      o.setMode(modus)
      letzterModus = modus
    }
    const staerke = w?.staerke ?? 0.7
    if (modus !== 'off' && staerke !== letzteStaerke) {
      o.setIntensity(staerke)
      letzteStaerke = staerke
    }
  }

  const anwenden = (): void => {
    if (!stand) return
    if (tagNacht) {
      // Der Sonnenstand hängt an Datum UND Ort — deshalb beides. Die
      // Stunden-Heuristik des Uhr-Symbols reicht hier nicht: Sie kennt weder
      // die Jahreszeit noch den Breitengrad, und auf der Karte sähe man den
      // Unterschied sofort (Mitternachtssonne gegen Polarnacht).
      const sonne = sunPosition(new Date(stand.zeitIso), stand.ort[1], stand.ort[0])
      gradiere(rastergrading(paramsAt(sonne.altitude)))
    } else {
      gradiere(NEUTRAL)
    }
    zeigeWetter(stand.wetter)
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
    setGate(fn) {
      gate = fn
      wetter?.setGate(fn)
    },
    get tagNachtAn() {
      return tagNacht
    },
    get wetterAn() {
      return wetterAn
    },
  }
}

