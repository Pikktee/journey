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
// Satellitenbilds (`paramsAt`) und der SCHLEIER aus `weather-sky.ts`; ein
// Partikelsystem kann es nicht, denn es ist Zustand: Jeder Tropfen wird aus
// dem vorigen Bild fortgeschrieben.
//
// Beim ABSPIELEN läuft dagegen ein Film in Echtzeit vorwärts, und dort sind
// Partikel und Klang genau richtig — das Abspielen ist die Schnittprüfung, und
// wer prüft, soll hören und sehen, was der Player später zeigt. Deshalb hängt
// das Overlay an `setRunning` und schweigt sonst. Dieselbe Regel wie beim Video im
// Editor, das ebenfalls nur bei Tempo 1 läuft.
//
// Ein erster Anlauf hängte die Partikel dauerhaft hinein, und alles, was daran
// falsch war, hing an dieser fehlenden Bindung: Es regnete bei stehendem Kopf,
// es klang beim Scrubben, der Ton lief nach dem Verlassen der Tour weiter.
// Geblieben ist aus jener Runde der Befund zu `clouds`/`fog` — die haben in
// wetter.ts kein Profil (ihren Himmel zeichnet im Player die Atmosphäre), für
// sie trägt der Schleier allein.
//
// Nicht übertragbar bleiben `setLight` (braucht Gelände, damit eine
// Lichtrichtung etwas beleuchtet) und `setSky` (braucht einen Horizont).
//
// **Ein Paint je Änderung, keine Schleife** (Konzept §10). Gesetzt wird erst,
// wenn sich ein gerundeter Wert tatsächlich unterscheidet — sonst kostet jedes
// Scrub-Frame vier `setPaintProperty`-Aufrufe für dasselbe Bild.

import { paramsAt, rasterGrading, type RasterGrading } from '../daynight.js'
import { sunPosition } from '../sun.js'
import { createWeather, type WeatherOverlay } from '../weather.js'
import { grading, scrimFor, type SceneWeather, type WeatherGrading } from '../weather-sky.js'
// Bewusst der Studio-Typ und nicht der aus `autoweather.ts`: Was hier ankommt,
// sind die Grenzen aus dem Edit-Overlay bzw. dem Auto-Wetter des Servers, und
// die tragen genau diese Liste (`WEATHER_MODES`, gewacht gegen das Server-Schema).
import type { WeatherMode } from './edit-model.js'
import type { Map as MapLibreMap } from 'maplibre-gl'

/** Neutral: kein Grading. Der Zustand, in den „Tag/Nacht aus" zurückfällt. */
const NEUTRAL: RasterGrading = { brightnessMax: 1, brightnessMin: 0, saturation: 0, contrast: 0 }

export interface WeatherState {
  mode: WeatherMode
  intensity?: number
}

export interface MapMood {
  /**
   * Die Stimmung am Abspielkopf setzen. Aufzurufen, wo auch das Foto und die
   * Kartenposition nachziehen — eine FUNKTION der Kopfposition, kein Ereignis.
   */
  set(timeIso: string, location: [number, number], weather: WeatherState | null): void
  setDayNight(on: boolean): void
  setWeather(on: boolean): void
  /**
   * Läuft der Film gerade — und mit welchem Tempo?
   *
   * Daran hängt, ob es zusätzlich zum Schleier auch REGNET: Partikel und Klang
   * brauchen eine vorwärts laufende Echtzeit, und die gibt es nur beim
   * Abspielen bei Tempo 1. Dieselbe Regel wie beim Video im Editor.
   */
  setRunning(tempo: number): void
  /**
   * Liegt gerade eine Foto-Karte auf der Bühne?
   *
   * Dann tritt der Niederschlag zurück. Im Player übernimmt das der
   * `.photo-backdrop` (Schleier plus Weichzeichner über der ganzen Szene) —
   * hier genügt die Deckkraft, denn die Karte darunter bleibt Arbeitsfläche.
   */
  setPhoto(lies: boolean): void
  /** Beim Schließen der Tour: Bildschleife, Klänge und Canvas zurücknehmen. */
  destroy(): void
  readonly dayNightOn: boolean
  readonly weatherOn: boolean
}

/**
 * @param map  die Editor-Karte
 * @param layer  Raster-Layer, der gegradet wird (im Editor `sat`, im Player hieße er `satellite`)
 * @param stage Element, in das der Schleier gehängt wird (die Kartenbühne)
 */
export function createMapMood(map: MapLibreMap, layer: string, stage: HTMLElement): MapMood {
  let dayNight = false
  let weatherOn = false
  // Zuletzt GESETZTE Werte — der Vergleich hält die Paint-Aufrufe draußen.
  let set: RasterGrading | null = null
  let lastScrim = ''
  // Letzter bekannter Stand, damit ein Schalter sofort greift statt erst beim
  // nächsten Kopfschritt: Wer „Wetter an" drückt und nichts sieht, drückt noch
  // einmal.
  let state: { timeIso: string; location: [number, number]; weather: WeatherState | null } | null =
    null

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
  let partikel: WeatherOverlay | null = null
  let running = false
  const getParticles = (): WeatherOverlay => {
    if (!partikel) {
      partikel = createWeather(stage)
      // Das Overlay fragt selbst, ob es zeichnen darf — so bringt es seine
      // eigene Blende ins Standbild mit, statt hart zu stoppen.
      partikel.setGate(() => running)
      partikel.setSoundEnabled(running)
    }
    return partikel
  }

  let scrimEl: HTMLElement | null = null
  const getScrim = (): HTMLElement => {
    if (!scrimEl) {
      scrimEl = document.createElement('div')
      scrimEl.className = 'map-scrim'
      scrimEl.setAttribute('aria-hidden', 'true')
      stage.appendChild(scrimEl)
    }
    return scrimEl
  }

  const grade = (g: RasterGrading): void => {
    if (
      set &&
      set.brightnessMax === g.brightnessMax &&
      set.brightnessMin === g.brightnessMin &&
      set.saturation === g.saturation &&
      set.contrast === g.contrast
    ) {
      return
    }
    // Der Layer fehlt, solange der Stil lädt — dann ist auch nichts zu graden.
    if (!map.getLayer(layer)) return
    map.setPaintProperty(layer, 'raster-brightness-max', g.brightnessMax)
    map.setPaintProperty(layer, 'raster-brightness-min', g.brightnessMin)
    map.setPaintProperty(layer, 'raster-saturation', g.saturation)
    map.setPaintProperty(layer, 'raster-contrast', g.contrast)
    set = g
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
  const weatherImage = (w: WeatherState | null): { snow: number; image: WeatherGrading } => {
    const travelMode: SceneWeather = (weatherOn && w ? w.mode : 'off') as SceneWeather
    const s = scrimFor(travelMode, w?.intensity ?? 0.7)
    // Zwei Farbflächen übereinander plus, bei Nebel, ein weicher Verlauf von
    // den Rändern her — dieselbe Reihenfolge wie im Player (`wash` über `dark`).
    const fog =
      s.fogColor > 0
        ? `, radial-gradient(120% 100% at 50% 50%, rgba(226,232,240,${(0.1 * s.fogColor).toFixed(3)}) 0%, rgba(226,232,240,${(0.42 * s.fogColor).toFixed(3)}) 100%)`
        : ''
    const image =
      travelMode === 'off'
        ? ''
        : `linear-gradient(${s.wash}, ${s.wash}), linear-gradient(${s.shadow}, ${s.shadow})${fog}`
    if (image !== lastScrim) {
      // Erst bauen, wenn wirklich etwas zu zeigen ist — wer das Wetter nie
      // einschaltet, bekommt auch kein Element in den DOM.
      if (image || scrimEl) {
        const el = getScrim()
        el.style.backgroundImage = image
        el.hidden = !image
      }
      lastScrim = image
    }
    // Die Partikel bekommen dieselbe Lage. Gebaut wird das Overlay erst, wenn
    // tatsächlich abgespielt wird: Wer nur schneidet, bekommt weder Canvas noch
    // Klang-Loops. `clouds`/`fog` haben dort ohnehin keine Tropfen — für sie
    // bleibt es beim Schleier, und das ist richtig so.
    if (partikel || (running && travelMode !== 'off')) {
      const o = getParticles()
      if (o.mode !== travelMode) o.setMode(travelMode)
      if (travelMode !== 'off') o.setIntensity(w?.intensity ?? 0.7)
    }
    return { snow: s.snow, image: grading(travelMode, w?.intensity ?? 0.7) }
  }

  /** Wetter auf ein fertiges Grading legen — Licht mal Faktor, Farbe minus Abzug. */
  const withWeather = (g: RasterGrading, b: WeatherGrading): RasterGrading => ({
    brightnessMax: +Math.max(0, Math.min(1, g.brightnessMax * b.brightness)).toFixed(3),
    brightnessMin: g.brightnessMin,
    // Die Sättigung ist bei MapLibre auf [-1, 1] geklemmt; ohne die Klemme
    // fiele eine schon nächtlich entsättigte Karte unter -1 und der Wert würde
    // still verworfen.
    saturation: +Math.max(-1, Math.min(1, g.saturation + b.saturation)).toFixed(3),
    contrast: g.contrast,
  })

  const apply = (): void => {
    if (!state) return
    const { snow, image } = weatherImage(state.weather)
    if (dayNight) {
      // Der Sonnenstand hängt an Datum UND Ort — deshalb beides. Die
      // Stunden-Heuristik des Uhr-Symbols reicht hier nicht: Sie kennt weder
      // die Jahreszeit noch den Breitengrad, und auf der Karte sähe man den
      // Unterschied sofort (Mitternachtssonne gegen Polarnacht).
      const sun = sunPosition(new Date(state.timeIso), state.location[1], state.location[0])
      grade(withWeather(rasterGrading(paramsAt(sun.altitude), snow), image))
    } else {
      // Ohne Tageszeit-Regie trotzdem Schneedecke und Wetter-Grading: Beide
      // gehören zum WETTER, nicht zum Licht. Volles Tageslicht als Grundlage —
      // genau das, was „Tageszeit aus" bedeutet.
      const DAY = { br: 1, sat: 0, con: 0, li: 0.4, sky: '', hor: '', fog: '', lc: '' }
      grade(withWeather(rasterGrading(DAY, snow), image))
    }
  }

  return {
    set(timeIso, location, w) {
      state = { timeIso, location, weather: w }
      apply()
    },
    setDayNight(on) {
      if (on === dayNight) return
      dayNight = on
      apply()
    },
    setWeather(on) {
      if (on === weatherOn) return
      weatherOn = on
      // Ausschalten heißt auch: keine Tropfen mehr. `apply` setzt das
      // Overlay über `weatherImage` auf 'off', der Rest klingt von selbst aus.
      apply()
    },
    setRunning(tempo) {
      const next = tempo === 1
      if (next === running) return
      running = next
      partikel?.setSoundEnabled(next)
      // Die Klasse steuert die Sichtbarkeit (CSS blendet über 900 ms), das Gate
      // im Overlay hält danach das Zeichnen an. Beides zusammen: Der Übergang
      // ist weich UND die Schleife läuft nicht weiter, während man schneidet.
      stage.classList.toggle('weather-running', next)
      // Das Gate liest `running` selbst; ein Aufruf von `apply` baut das
      // Overlay nach, falls gerade zum ersten Mal abgespielt wird.
      apply()
    },
    setPhoto(lies) {
      stage.classList.toggle('photo-visible', lies)
    },
    destroy() {
      partikel?.zerstoere()
      partikel = null
      scrimEl?.remove()
      scrimEl = null
      stage.classList.remove('weather-running', 'photo-visible')
    },
    get dayNightOn() {
      return dayNight
    },
    get weatherOn() {
      return weatherOn
    },
  }
}
