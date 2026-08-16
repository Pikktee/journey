// Kamera-Engine auf Basis der FreeCamera-API: Die Kamera hat eine explizite Position
// über dem Gelände (Bodenpunkt + Flughöhe) und einen Blickpunkt. Beide werden pro
// Skalar exponentiell geglättet — Phasenwechsel (Intro → Fahrt, Foto-Orbit, Finale)
// werden dadurch automatisch zu weichen Kamerafahrten. Eine explizite Flughöhe ist
// nötig, weil zoom-basierte Kameras (jumpTo) in steilem Gelände im Hang stecken bleiben.
//
// **Die Position FOLGT der Filmzeit** (Konzept E2, Etappe 4). Die Engine
// integriert `s` nicht mehr selbst, sondern liest es aus der geteilten Achse:
// `s = streckeBeiFilm(achse, filmS)`, und `filmS` kommt aus der Filmuhr. Was
// dadurch ERSATZLOS entfallen ist, ist der eigentliche Gewinn (E13): die
// Zeiger `nextIdx`/`nextMomentIdx` samt `syncNextIdx`, der Bremsweg-Vorgriff
// (`speed · 0.62`), die Ausrollschwelle `speed < 4` und jede `dir > 0`-Schranke.
// „Im Halt" ist seither ein ZUSTAND DER KURVE — `filmS` liegt in einem
// Halt-Intervall — und kein getriggerter Phasenwechsel. Rückwärts fährt
// dadurch über dieselbe Kurve, Halte inklusive, genau wie der Editor
// (src/studio/abspielen.ts) es seit Monaten tut.
import maplibregl, { type Map as MapLibreKarte } from 'maplibre-gl'
import { klipDauerS } from './einblendung.js'
import { Filmuhr, verbindeSichtbarkeit } from './filmuhr.js'
import { pointAt, bearingAt, dist, bearing, angleDelta, destination, type Route } from './geo.js'
import { EXAGGERATION, type LngLat2D } from './map.js'
import type { Wegpunkt } from './tours.js'
import type { Sonnenstand } from './sun.js'
import type { PlayerStopp, UI } from './ui.js'

/** Kameraabstand hinter dem Fahrer und Flughöhe über Grund, beides in Metern. */
export interface Kameradistanz {
  behind: number
  hover: number
}

// Bewusst weit gespreizt: Nah klebt dicht hinterm Fahrer, Weit ist Panorama —
// die Stufen sollen sich wie drei verschiedene Einstellungsgrößen anfühlen
export const PRESETS = {
  nah: { behind: 280, hover: 160 },
  mittel: { behind: 720, hover: 410 },
  weit: { behind: 1900, hover: 1300 },
} satisfies Record<string, Kameradistanz>

/**
 * Die Namen kommen aus dem DOM (`data-preset`) und aus Tour-Keyframes des
 * Servers — beides freie Zeichenketten. Unbekanntes fällt auf „mittel", genau
 * wie der Bestand es mit `PRESETS[p] ?? PRESETS.mittel` tat.
 */
const distanzFuer = (name: string): Kameradistanz => (PRESETS as Record<string, Kameradistanz | undefined>)[name] ?? PRESETS.mittel

// Standzeit und Ausblendung gehören der Foto-Karte, nicht der Engine — sie
// stehen in einer Datei, die auch das Studio importieren kann (einblendung.ts).
// Vorher standen sie hier und die vierte Fundstelle (ui.ts) war eine rohe 5.2,
// die kein Wächter sah.

/** Ein Kamera-Moment aus dem Kreativbaukasten, verankert an Streckenmeter `s`. */
export interface KameraMoment {
  s: number
  /** `umkreisen` | `aufstieg` | `innehalten` — roh vom Server, unbekanntes hält still */
  art: string
  dauerS?: number | undefined
}

/** Eine Modus-Grenze: ab Streckenmeter `s` gilt `mode`. */
export interface ModusGrenze {
  s: number
  mode: string
  label?: string | undefined
}

/**
 * Ein Halt, wie ihn die Engine sieht: sein Fenster im FILM und was darin liegt.
 *
 * Entweder eine Aufnahme-Kette (`stopp` samt `stuecke`) oder ein Kamera-Moment
 * — nie beides. Die Stücke sind die Aufnahmen des Halts mit ihrer Lage
 * innerhalb des Fensters; sie kommen aus derselben Rechnung, die dem Halt seine
 * Breite in der Achse gibt (src/main.ts), damit die Karte nicht nach einem
 * anderen Maß weiterschaltet als die Achse gebaut ist.
 */
export interface Spielhalt {
  filmVon: number
  filmBis: number
  stopp: PlayerStopp | null
  moment: KameraMoment | null
  /** Je Aufnahme: Filmsekunde ab Haltbeginn und ihre STANDzeit (ohne Ausblendung) */
  stuecke: ReadonlyArray<{ abS: number; standS: number }>
}

/**
 * Die Filmachse dieser Tour, wie die Engine sie braucht — in den Metern der
 * GEBAUTEN Route, nicht in den rohen der Achse. Die Übersetzung macht der
 * Verdrahter (src/main.ts), der beide Meterstände kennt.
 */
export interface Filmspur {
  /** Gesamtdauer des Films in Sekunden */
  gesamtS: number
  /**
   * Kameradistanz an einem Streckenmeter — sie folgt DERSELBEN Rampe wie das
   * Tempo (src/main.ts, aus `modusMischung`).
   *
   * Vorher zog ein eigener Tiefpass sie nach (τ = 2,2 s, also ~6 s bis sie
   * steht), während die Rampe in unter einer Sekunde fertig ist: Dazwischen
   * fuhr man Fährtempo mit einer Fußgänger-Kamera. Über dasselbe Fenster
   * geführt bleibt das Bildschirm-Tempo stetig — die Modi sind längst so
   * abgestimmt, dass Tempo ÷ Kameradistanz überall gleich ist (0,167–0,202/s).
   */
  skalaBeiS: (s: number) => Kameradistanz
  /** Streckenmeter zu einer Filmsekunde — die Richtung, für die es die Achse gibt */
  sBeiFilm: (filmS: number) => number
  /** Filmsekunde an einem Streckenmeter (im Halt: seine Ankunft) */
  filmBeiS: (s: number) => number
  /** Der Halt, in dem diese Filmsekunde steht — `null` heißt Fahrt */
  haltBeiFilm: (filmS: number) => Spielhalt | null
  /**
   * Die Fortbewegung an einem Streckenmeter, wie die ACHSE sie sieht.
   *
   * Nicht dasselbe wie die Modus-Grenzen der Tour: Ein Tempowechsel dicht an
   * einem Halt wandert in der Achse auf den Halt (dort steigt man ein). Fragte
   * der Marker die rohen Grenzen, liefe für die letzten Meter ein Fußgänger mit
   * Fährtempo über die Karte.
   */
  modusBeiS: (s: number) => string
}

/** Kamerapose eines Frames — das Atmosphäre-Overlay hängt sich daran. */
export interface KameraPose {
  cg: LngLat2D
  alt: number
  lt: LngLat2D
  ltAlt: number
}

export interface TourOptionen {
  /** Die Filmachse — ohne sie hat die Engine keine Position (E2) */
  film: Filmspur
  modes?: ModusGrenze[]
  /** true = Endscreen; sonst zurück zum Startscreen */
  showFinale?: boolean
  /** Optional: UI-Aufräumen beim Rücksprung ins Menü (Kino-Modus aus) */
  onToMenu?: (() => void) | null
}

/** Kamerastand als Signatur (Vergleich für den bedingten Resume-Fade) */
interface Kamerastand {
  lng: number
  lat: number
  zoom: number
  bearing: number
  pitch: number
}

/** Die ideale Fahrt-Pose an einem Streckenmeter, ohne etwas zu setzen. */
interface Fahrtpose {
  course: number
  sc: Kameradistanz
  k: number
  cg: LngLat2D
  alt: number
  lt: LngLat2D
  ltAlt: number
}

/** Zeitbasierter Kameraschwenk (Scrub-Sprung im Pause-Modus). */
interface ReposeTween {
  t: number
  dur: number
  from: { cgLng: number; cgLat: number; alt: number; ltLng: number; ltLat: number; ltAlt: number }
  to: { cgLng: number; cgLat: number; alt: number; ltLng: number; ltLat: number; ltAlt: number }
}

type Phase = 'intro' | 'ride' | 'photo' | 'moment' | 'finale'

// Kamera-Momente (Kreativbaukasten): Ein Moment hält den Film an wie eine
// Aufnahme — seine Standzeit gehört deshalb zum Tempo-Modell und steht seit
// Paket D in filmachse.ts, geteilt mit Studio und Server-Spiegel.
const MOMENT_ORBIT_SPEED = 38 // Grad/s beim Umkreisen (6 s ≈ 228°, elegante Dreivierteldrehung)
const MOMENT_ASCEND_LIFT = 2.4 // Faktor, um den die Kamera-Flughöhe beim Aufstieg wächst

// „Himmel-Momente": Zur Golden Hour und nachts kippt die Kamera nach oben, damit
// Horizont + Sonne/Sterne ins Bild kommen und der Fahrer ins untere Drittel rutscht.
// Statt den Blickpunkt um eine feste Fraktion zu heben (zu indirekt — bei hoher
// Kamera bleibt der Horizont trotzdem am oberen Rand), steuern wir den ZIEL-Blick-
// winkel direkt: der Blick-nach-unten-Winkel wird von seinem natürlichen Wert
// Richtung SKY_MIN_DOWN abgeflacht. Das kippt die Kamera geometrieunabhängig bis
// knapp über den Horizont. Tagsüber ist skyLift 0 ⇒ exakt der bisherige Blick.
const SKY_MIN_DOWN = 3 * (Math.PI / 180) // flachster Blick-nach-unten (Pitch ~87°, von maxPitch gedeckelt)
const SKY_LIFT_TAU = 3.5 // Einschwingzeit der Anhebung (weich, kein Ruck)
const _cl = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
const _ss = (a: number, b: number, x: number) => { const t = _cl((x - a) / (b - a)); return t * t * (3 - 2 * t) }

class Smooth {
  v: number
  constructor(v: number) {
    this.v = v
  }
  to(target: number, dt: number, tau: number): void {
    this.v += (target - this.v) * (1 - Math.exp(-dt / tau))
  }
  set(v: number): void {
    this.v = v
  }
}

// Kameradistanz je Fortbewegungsmodus: schnelle Modi fahren deutlich schneller
// UND die Kamera zoomt weiter heraus — die Spreizung macht den Moduswechsel
// körperlich spürbar. Das TEMPO (früher `MODE_SPEED` und `baseSpeed` hier) steht
// seit Paket D in filmachse.ts: dieselbe Tabelle, die die Filmachse rechnet, und
// dieselbe, die das Studio liest.
// hover > behind bei walk: in Städten schaut die Kamera dadurch etwas steiler
// über die Dächer, statt hinter Häuserzeilen zu hängen
const MODE_SCALE = {
  walk: { behind: 0.5, hover: 0.68 },
  moped: { behind: 0.95, hover: 1 }, // wendig wie ein Rad, Kamera dicht dran
  jeep: { behind: 1.25, hover: 1.25 }, // Wagen: sitzt etwas höher/weiter zurück
  tram: { behind: 1.15, hover: 1.2 },
  ferry: { behind: 2.3, hover: 2.2 },
  bike: { behind: 1, hover: 1 },
}

// Die Modus-Schlüssel kommen als freie Zeichenketten herein (Server-Segmente,
// src/remote.ts) — der Fallback des Bestands („?? MODE_SCALE.bike") ist deshalb
// kein Zierrat, sondern der Umgang mit einem unbekannten Modus. Das TEMPO fragt
// die Engine gar nicht mehr: Es steckt in der Achse, die ihr `s` liefert.
export const skalaFuer = (mode: string): Kameradistanz => (MODE_SCALE as Record<string, Kameradistanz | undefined>)[mode] ?? MODE_SCALE.bike

/** Zwei Kameradistanzen mischen — der Übergang an einer Modus-Grenze. */
export const mischeSkala = (a: Kameradistanz, b: Kameradistanz, t: number): Kameradistanz => ({
  behind: a.behind + (b.behind - a.behind) * t,
  hover: a.hover + (b.hover - a.hover) * t,
})

export class Tour {
  map: MapLibreKarte
  route: Route
  stops: PlayerStopp[]
  ui: UI
  film: Filmspur
  modes: ModusGrenze[]
  showFinale: boolean
  onToMenu: (() => void) | null
  /** Atmosphäre-/Flare-Overlay hängt sich hier ein (main.ts) */
  onPose?: (pose: KameraPose) => void

  scaleSm: Smooth
  hoverSm: Smooth
  phase: Phase
  playing: boolean
  scrubbing: boolean
  settled: boolean
  repose: boolean
  reposeTween: ReposeTween | null
  /**
   * Die Filmsekunde — **die eine Größe, die läuft**. Alles andere ist eine
   * Funktion von ihr: Position, Halt, Phase, Foto-Karte.
   */
  filmS: number
  s: number
  /**
   * Streckentempo des letzten Frames (m/s) — eine BEOBACHTUNG, kein Antrieb.
   * Vorher war es die integrierte Zustandsgröße der Engine; heute fällt es aus
   * der Achse ab. Die Messskripte lesen es (scripts/messungen/).
   */
  speed: number
  mult: number
  dir: number
  preset: Kameradistanz
  /** Der Halt, in dem die Filmzeit gerade steht (null = Fahrt) */
  halt: Spielhalt | null = null
  itemIdx: number
  /** Liegt gerade eine Foto-Karte auf der Bühne? */
  photoShown: boolean
  /** Der Halt, dessen Karte gerade läuft (null außerhalb der Foto-Phase) */
  shownStop: PlayerStopp | null = null
  glide: number
  course: number
  tuck: Smooth
  skyLift: Smooth
  skyLiftTarget: number
  sunAlt = 0
  sunAz = 0

  mid: Wegpunkt
  diag: number
  ovR: number
  ovA: number
  orbitA: number
  cg: { lng: Smooth; lat: Smooth }
  alt: Smooth
  lt: { lng: Smooth; lat: Smooth }
  ltAlt: Smooth
  camSnap: Kamerastand | null = null

  /**
   * Die eine Uhr der Engine (src/filmuhr.ts). Sie speist ALLES, was Zeit
   * misst — Fortbewegung, Standzeiten, Kamera-Glättung —, und zwar mit echter,
   * ungedeckelter Frame-Zeit. Ihre Zähler hängen zum Nachsehen an `window.__j`.
   */
  uhr: Filmuhr
  uiClock: number
  private _tick: (now: number) => void

  constructor(map: MapLibreKarte, route: Route, stops: PlayerStopp[], ui: UI, opts: TourOptionen) {
    this.map = map
    this.route = route
    this.stops = stops // [{ s, items: [Foto, …] }] aufsteigend nach s
    this.ui = ui
    this.film = opts.film
    this.modes = opts.modes ?? [{ s: 0, mode: 'bike', label: 'Rad' }]
    // Endscreen nur wenn ausdrücklich an (Studio) bzw. bei kuratierten Demo-Touren.
    // Sonst zurück zum Startscreen — die meisten Touren haben kein konkretes Ziel.
    this.showFinale = opts.showFinale === true
    this.onToMenu = opts.onToMenu ?? null
    const sc0 = skalaFuer(this.modes[0]!.mode)
    this.scaleSm = new Smooth(sc0.behind)
    this.hoverSm = new Smooth(sc0.hover)

    this.phase = 'intro'
    this.playing = false
    this.scrubbing = false
    // Steht die Kamera in der Pause bereits auf der idealen Fahrt-Pose? Nur dann
    // schneidet die Einzelbild-Taste hart; sonst schwingt sie erst weich ein
    // (verhindert den Sprung beim ersten Cursortasten-Druck).
    this.settled = false
    // Explizit angeforderte Kamera-Umposition im Pause-Modus (Einzelbild-Taste,
    // Kameradistanz-Wechsel). Nur wenn gesetzt, darf sich die Kamera in Pause
    // bewegen — ein einfacher Pause-Klick friert dagegen exakt ein (kein Nachziehen).
    this.repose = false
    // Aktiver zeitbasierter Kameraschwenk (Scrub-Sprung im Pause-Modus) oder null.
    this.reposeTween = null
    this.filmS = 0
    this.s = 0
    this.speed = 0
    this.mult = 1
    this.dir = 1 // Wiedergaberichtung: +1 vorwärts, −1 rückwärts (JKL-Shuttle)
    this.preset = PRESETS.mittel
    this.itemIdx = 0 // Foto innerhalb des aktuellen Halts
    this.photoShown = false
    this.glide = 1 // Tau-Multiplikator, >1 direkt nach Phasenwechseln (epischere Schwenks)
    this.course = bearingAt(route, 0) // stark geglättete Fahrtrichtung für die Kameraposition
    this.tuck = new Smooth(1) // 1 = voller Abstand; <1 = näher am Fahrer (Hindernis im Rücken)
    this.skyLift = new Smooth(0) // 0 = Blick nach unten (Tag); →1 = Kamera kippt zum Horizont
    this.skyLiftTarget = 0 // von setSun aus dem Sonnenstand gespeist

    // Übersichts-Orbit für Intro und Finale (bei großen Touren gedeckelt)
    const mid = pointAt(route, route.total * 0.5)
    const b = this.boundsOf(route)
    this.mid = mid
    this.diag = dist([b[0][0], b[0][1]], [b[1][0], b[1][1]])
    this.ovR = Math.min(this.diag * 1.15, 17000)
    this.ovA = Math.min(this.diag * 0.95, 14000)
    this.orbitA = 205 // Blick von Süden

    const ovGround = destination([mid[0], mid[1]], this.ovR, this.orbitA)
    this.cg = { lng: new Smooth(ovGround[0]), lat: new Smooth(ovGround[1]) }
    this.alt = new Smooth(mid[2] * EXAGGERATION + this.ovA)
    this.lt = { lng: new Smooth(mid[0]), lat: new Smooth(mid[1]) }
    this.ltAlt = new Smooth(mid[2] * EXAGGERATION)

    this.applyCamera()
    this.updateMapLock() // Intro-Orbit: Karte gesperrt, kein Greifhand-Cursor
    this.uhr = new Filmuhr()
    // Was NICHT an der Filmuhr hängt, muss beim Anhalten ausdrücklich mit: Ein
    // laufendes Video zählt an der Wanduhr des Browsers weiter, auch wenn kein
    // Frame mehr kommt — und käme aus dem Hintergrund an einer anderen Stelle
    // zurück als der Halt, der es zeigt. Der Wiedergabe-Zustand bleibt dabei
    // unangetastet (kein „Angehalten"-Abzeichen): Wer den Tab wechselt, hat
    // nichts pausiert. Die Ton-Spuren gehen den anderen Weg — ihre Gates fragen
    // `uhr.laeuft` (src/main.ts).
    // Anhalten muss aus dem EREIGNIS kommen: Die Karten-Sync hängt an
    // `requestAnimationFrame`, und genau das läuft im Hintergrund nicht mehr.
    // Zurück holt sie das Video von selbst — der nächste Kopfschritt reicht.
    this.uhr.beiWechsel = (laeuft) => {
      if (!laeuft) this.ui.haltVideoAn()
    }
    verbindeSichtbarkeit(this.uhr)
    this.uiClock = 0
    this._tick = this.tick.bind(this)
    requestAnimationFrame(this._tick)
  }

  boundsOf(route: Route): [LngLat2D, LngLat2D] {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const c of route.coords) {
      minX = Math.min(minX, c[0]); maxX = Math.max(maxX, c[0])
      minY = Math.min(minY, c[1]); maxY = Math.max(maxY, c[1])
    }
    return [[minX, minY], [maxX, maxY]]
  }

  // Szenenhöhe (überhöhtes Terrain) an einem Punkt; Fallback: Höhenprofil der Route
  groundAlt(lnglat: LngLat2D, fallbackEle: number): number {
    const e = this.map.queryTerrainElevation(lnglat)
    return e ?? fallbackEle * EXAGGERATION
  }

  // Sonnenstand (Grad) → Ziel-Anhebung der Kamera + gemerkter Sonnen-Azimut fürs
  // Yaw. Golden Hour (Sonne tief) hebt voll an, tiefe Nacht moderat (damit Sterne
  // sichtbar sind, ohne den ganzen Nachtteil in Dauerschräglage zu zwingen), heller
  // Tag gar nicht. Wird von der Tag/Nacht-Regie (main.ts) gespeist; die Smooths in
  // update() ziehen weich nach.
  setSun(sun: Sonnenstand): void {
    this.sunAlt = sun.altitude
    this.sunAz = sun.azimuth
    const gh = _ss(14, 1, sun.altitude) // 0 bei 14°, 1 bei ≤1° (Sonne nähert sich Horizont)
    const night = _ss(-6, -12, sun.altitude) // 0 bei −6°, 1 bei ≤−12° (tiefe Nacht)
    // Moderate Anhebung: etwas Himmel/Horizont ins Bild, aber der Fahrer/Wegpunkt
    // bleibt klar über der Navigationsleiste sichtbar. FRÜHER hob Nacht auf 0.9 —
    // dabei rutschte der Marker unter das Dock und war nicht mehr zu sehen.
    this.skyLiftTarget = Math.max(0.5 * gh * (1 - night), 0.28 * night)
  }

  // Kamera-Standrichtung: immer in Fahrtrichtung hinter dem Fahrer. FRÜHER drehte sie
  // sich zur Golden Hour bis ±140° zur Sonne ein — das riss die Kamera aber vom
  // Wegpunkt weg (zu weit, nicht mehr auf der Marke ausgerichtet). Bewusst KEIN
  // Sonnen-Eindrehen mehr: liegt der Untergang ohnehin voraus, ist er im Bild; steht
  // die Sonne seitlich/im Rücken, wird nicht extra dorthin geschwenkt.
  yawedBackDir(course: number): number {
    return (course + 180) % 360
  }

  // Blickpunkt-Höhe für eine Fahrt-Pose inkl. Himmel-Anhebung. Der natürliche Blick-
  // nach-unten-Winkel (Kamera→Fahrer) wird per skyLift Richtung SKY_MIN_DOWN abge-
  // flacht — das kippt die Kamera geometrieunabhängig zum Horizont. Rückgabe: Ziel-
  // ltAlt für den Blickpunkt (bei skyLift 0 exakt die Fahrer-Bodenhöhe).
  liftedLtAlt(cgPos: LngLat2D, riderLngLat: LngLat2D, riderGround: number, camAlt: number): number {
    const D = Math.max(dist(cgPos, riderLngLat), 50) // horizontaler Kamera-Fahrer-Abstand (m)
    const thNat = Math.atan2(camAlt - riderGround, D) // natürlicher Blick-nach-unten (rad)
    const th = Math.min(thNat, thNat * (1 - this.skyLift.v) + SKY_MIN_DOWN * this.skyLift.v)
    return camAlt - D * Math.tan(th)
  }

  begin(): void {
    this.phase = 'ride'
    this.playing = true
    this.settled = false
    this.glide = 2.4 // langer, epischer Anflug hinter den Startpunkt
    this.ui.hideIntro()
    this.updateMapLock() // Fahrt läuft ⇒ Karte gesperrt, kein Greifhand-Cursor
  }

  setPlaying(on: boolean): void {
    if (on === this.playing) return
    this.playing = on
    this.ui.setPlaying(on)
    this.repose = false // weder Play noch Pause ziehen automatisch nach
    this.reposeTween = null // laufenden Scrub-Schwenk abbrechen
    if (on) {
      this.settled = false // Bewegung ⇒ Kamera muss sich neu einschwingen
      // Nur blenden, wenn der Nutzer die Karte in der Pause tatsächlich verschoben
      // hat — dann ist das Fortsetzen ein harter Rücksprung. Beim bloßen Weiter-
      // Drücken (Space, ohne die Karte anzufassen) läuft das Bild nahtlos weiter.
      const moved = this._camMoved()
      this.updateMapLock() // Karte sperren (Kamera folgt wieder der Tour)
      if (moved) this.ui.blink(() => {})
    } else {
      // Pause: Kamera exakt an der aktuellen Pose einfrieren — KEIN Nachziehen auf
      // eine „ideale" Pose (das wirkte als störender Nachschwenk nach dem Stopp).
      this.updateMapLock() // Karte freigeben (Pannen/Zoomen) + camSnap merken
    }
  }

  // Karten-Interaktion an den Zustand koppeln: NUR in der Fahrt-Pause darf frei
  // gepannt/gezoomt werden. In jeder von der Tour geführten Phase (Intro, laufende
  // Fahrt, Foto, Finale) wird die Karte gesperrt — sonst kämpfen Nutzer-Geste und
  // Kamerafahrt gegeneinander. `cam-locked` unterdrückt zusätzlich den Greifhand-
  // Cursor, den MapLibre sonst über die interactive-Klasse dauerhaft zeigt.
  //
  // Free-Look deckelt minZoom: Weit-Rauszoomen bei Tour-Pitch (~50–86°) lässt
  // MapLibre ein riesiges Terrain-Mesh zeichnen (gemessen: Terrain IST die Kosten,
  // s. map.ts). Global ginge das nicht — Intro/Finale brauchen niedrigere Zooms
  // (Orbit bis ~17 km).
  updateMapLock(): void {
    const free = !this.playing && !this.scrubbing && this.phase === 'ride'
    const act = free ? 'enable' : 'disable'
    this.map.dragPan[act]()
    this.map.scrollZoom[act]()
    this.map.touchZoomRotate[act]()
    this.map.touchPitch[act]()
    this.map.setMinZoom(free ? 9 : 0)
    document.body.classList.toggle('cam-locked', !free)
    if (free) this.camSnap = this._camNow() // Referenzpose, um späteres Pannen zu erkennen
  }

  // Kamerastand als Signatur (Vergleich für den bedingten Resume-Fade)
  _camNow(): Kamerastand {
    const c = this.map.getCenter()
    return { lng: c.lng, lat: c.lat, zoom: this.map.getZoom(), bearing: this.map.getBearing(), pitch: this.map.getPitch() }
  }

  _camMoved(): boolean {
    const s = this.camSnap
    if (!s) return false
    const c = this.map.getCenter()
    return (
      Math.abs(c.lng - s.lng) > 1e-6 ||
      Math.abs(c.lat - s.lat) > 1e-6 ||
      Math.abs(this.map.getZoom() - s.zoom) > 1e-3 ||
      Math.abs(this.map.getBearing() - s.bearing) > 0.05 ||
      Math.abs(this.map.getPitch() - s.pitch) > 0.05
    )
  }

  setPreset(p: string, skala = 1): void {
    const base = distanzFuer(p)
    // Stufenlose Feinjustierung (Kreativbaukasten): skaliert Abstand UND Höhe
    // gemeinsam — näher/weiter über die drei Presets hinaus. 1 = unverändert.
    this.preset = skala === 1 ? base : { behind: base.behind * skala, hover: base.hover * skala }
    // Zügig ausfahren: der Wechsel soll sich wie ein Schnitt anfühlen, nicht
    // wie eine Kamerafahrt (Tile-Nachladen fangen Fade + größerer Cache ab)
    this.glide = Math.min(this.glide, 0.6)
    // Auch im Pause-Modus soll der Distanz-Wechsel sichtbar sein: einmalige
    // Umposition anfordern (repose), die Kamera zieht dann weich auf die neue
    // Kameradistanz und rastet danach wieder ein.
    if (!this.playing && !this.scrubbing && this.phase === 'ride') {
      this.repose = true
      this.reposeTween = null // velocity-basiertes Ease auf die neue Distanz (kein Sprung-Schwenk)
      this.settled = false
    }
  }

  /**
   * Filmsekunde setzen — und mit ihr Position und Halt (E2).
   *
   * Die EINE Stelle, an der `filmS` geschrieben wird: Sprünge, Scrubben,
   * Einzelbild und der laufende Film gehen alle hier durch. Sonst gäbe es
   * wieder Zustände, in denen `s` und `filmS` verschiedene Dinge behaupten.
   */
  setzeFilm(filmS: number): void {
    this.filmS = Math.max(0, Math.min(this.film.gesamtS, filmS))
    this.s = this.film.sBeiFilm(this.filmS)
    // Auch beim Scrubben: „Im Halt" ist ein ZUSTAND der Kurve und kein
    // ausgelöstes Ereignis (E13). Bis E15 war der Halt hier beim Scrubben
    // ausdrücklich null — die Karte hätte sonst geflackert, weil sie an einer
    // eigenen Uhr hing. Jetzt hängt sie an dieser Filmsekunde, und wer durch
    // einen Halt zieht, soll sehen, was dort steht.
    this.halt = this.film.haltBeiFilm(this.filmS)
  }

  /**
   * Zu einem FILManteil springen (0..1 der Filmdauer).
   *
   * Seit Etappe 5 zeichnet die Fortschrittsleiste den Filmanteil, also nimmt
   * dieser Weg ihn auch entgegen. Vorher kam ein Streckenanteil an und wurde
   * über die Achse übersetzt — im Halt fiel jede Eingabe damit auf dessen
   * ANKUNFT zusammen, denn ein Halt hatte auf der Strecke keine Breite. Jetzt
   * hat er sie in der Zeit, und man kann mitten hinein.
   */
  seek(filmFrac: number): void {
    if (this.phase === 'intro') this.ui.hideIntro()
    if (this.phase === 'finale') this.ui.hideFinale()
    this.phase = 'ride'
    // Kein `raeumeKarte()`: `setzeFilm` synchronisiert die Karte noch in diesem
    // Aufruf, und sie ist seit E15 eine Funktion der Filmzeit. Weggenommen
    // blitzte sie bei jedem Sprung weg und baute sich mit vollem Auftritt neu
    // auf — auch wenn man im selben Halt landet.
    this.setzeFilm(Math.max(0, Math.min(1, filmFrac)) * this.film.gesamtS)
    const s = this.s
    this.speed = 0
    this.dir = 1
    this.glide = 1.6
    this.course = bearingAt(this.route, s) // nach Teleport nicht minutenlang nachdrehen
    this.tuck.set(1)
    this.ui.syncDots(s)
    this.emitStats() // Kopf/Telemetrie sofort auf die Zielposition
    // Wiedergabezustand vom Scrubben beibehalten:
    if (this.playing) {
      // Läuft weiter: Kamera zieht von der aktuellen (Scrub-)Pose weich an die
      // neue Stelle. camSnap auf die aktuelle Pose, damit kein Resume-Fade entsteht.
      this.camSnap = this._camNow()
    } else {
      // Pausiert bleiben, aber weich: statt eines harten Schnitts ein kurzer,
      // zügiger Schwenk (~0,7 s, sanft auslaufend) von der aktuellen (Scrub-)Pose
      // auf die ideale Zielpose, dann einfrieren. Bei echtem Ziehen ist der Rest-
      // Weg klein (die Kamera folgte live), bei einem weiten Sprung wird es ein
      // schneller, weich auslaufender Schwenk — nie ruckartig, nie Nachkriechen.
      this.ui.updateTrace(this.s, pointAt(this.route, this.s)) // Fahrer-Marker sofort an die Zielposition
      this._beginReposeTween(0.7)
      this.camSnap = this._camNow()
    }
  }

  // — Timeline-Scrubbing (Ziehen wie im Video-Editor) —
  // Während des Ziehens folgt die Kamera straff der Position, aber es wird
  // nichts ausgelöst: keine Halte, kein Finale, kein Fortschritt von selbst.
  beginScrub(filmFrac: number): void {
    if (this.phase === 'finale') this.ui.hideFinale()
    this.scrubbing = true
    this.phase = 'ride'
    // Die Karte bleibt liegen: Zieht man durch einen Halt, soll sie mit dem
    // Stand DIESER Filmsekunde dastehen (E15). Vorher räumte diese Zeile sie
    // weg — man scrubbte blind an jedem Foto vorbei.
    this.settled = false
    this.speed = 0
    this.scrub(filmFrac)
  }

  scrub(filmFrac: number): void {
    this.setzeFilm(Math.max(0, Math.min(1, filmFrac)) * this.film.gesamtS)
    this.glide = Math.min(this.glide, 0.5) // Kamera zieht straff nach statt zu schweben
    this.emitStats() // Kopf und Telemetrie sofort, nicht erst beim 10-Hz-Takt
  }

  endScrub(filmFrac: number): void {
    this.scrubbing = false
    this.seek(filmFrac) // setzt Kurs, nächsten Stopp und Wiedergabe wie ein Sprung
  }

  /**
   * „Weiter“: zur nächsten Aufnahme des Halts springen, sonst hinter den Halt.
   *
   * Das ist jetzt ein Sprung in der FILMZEIT und keine Zustandsänderung mehr —
   * die Karte folgt daraus von selbst. Holt die Tour auch aus einer Foto-Pause
   * zurück.
   */
  photoNext(): void {
    const halt = this.halt
    if (this.phase !== 'photo' || !halt?.stopp || !this.photoShown) return
    const naechstes = halt.stuecke[this.itemIdx + 1]
    this.setzeFilm(naechstes ? halt.filmVon + naechstes.abS : halt.filmBis)
    this.ui.syncDots(this.s)
    if (!this.playing) this.setPlaying(true)
    else this.emitStats()
  }

  /**
   * Ein Video ist durchgelaufen (ui.onMediaEnded) — der NOTAUSGANG, mehr nicht.
   *
   * Bis Etappe 4 endete der Halt hier: `ended` schaltete weiter. Weicht die
   * echte Dateilänge um Zehntel von `dauerS` ab, verschob sich dadurch alles
   * Folgende, und zwar kumulativ — Studio und Player kamen an verschiedenen
   * Stellen heraus. Jetzt endet der Halt an der ACHSE, und die kennt die Länge
   * aus dem Tour-JSON. Bleibt die Datei kürzer, steht ihr letztes Bild; ist sie
   * länger, wird sie beschnitten. Beides ist besser als eine Achse, der man
   * nicht trauen kann.
   */
  onMediaEnded(): void {}

  /**
   * Der Faktor auf die Filmzeit, wie ihn die Anzeige braucht: 1 = normale
   * Fahrt, 0 = die Filmzeit steht, negativ = rückwärts.
   *
   * Beim Scrubben führt der Zeigefinger, also steht die Filmzeit für alles,
   * was eine eigene Uhr hat (das Video) — die Karte selbst folgt trotzdem, weil
   * ihr Stand aus `filmS` kommt und nicht aus einer Uhr.
   */
  private get anzeigeTempo(): number {
    if (this.scrubbing || !this.playing || !this.uhr.laeuft) return 0
    return this.dir * this.mult
  }

  /**
   * Die Foto-Karte ist eine FUNKTION der Filmzeit (E15) — keine Uhr.
   *
   * Steht `filmS` im Klip einer Aufnahme, liegt deren Karte auf der Bühne, und
   * zwar mit dem Auftritt, dem „Entwickeln", dem Ken-Burns-Stand und dem
   * Video-Frame GENAU DIESER Filmsekunde. Damit erscheint sie auch rückwärts
   * (und animiert rückwärts), sie steht unter dem „Angehalten"-Abzeichen still,
   * und wer mitten in einen Halt scrubbt, sieht endlich etwas — vorher räumte
   * `beginScrub` sie weg.
   *
   * Die Klips eines Halts liegen lückenlos hintereinander (`abS` aus derselben
   * Rechnung, aus der die Achse den Halt gebaut hat); ein Klip ist Standzeit
   * PLUS Ausblendung. Es gibt deshalb keinen Sonderfall „letzte Ausblendung"
   * mehr: Jede Aufnahme nimmt ihre eigene mit.
   *
   * Ab 2× Schnelllauf bleibt die Karte aus — dort will man die Strecke
   * überfliegen, nicht an jedem Halt ein Bild aufblitzen sehen (E16, dieselbe
   * Regel wie im Editor).
   */
  private synchronisiereKarte(halt: Spielhalt | null): void {
    const items = halt?.stopp?.items
    const tempo = this.anzeigeTempo
    if (!halt || !items?.length || Math.abs(tempo) > 1) return this.raeumeKarte()
    const imHalt = this.filmS - halt.filmVon
    let idx = 0
    for (let i = items.length - 1; i >= 0; i--) {
      if (imHalt >= (halt.stuecke[i]?.abS ?? 0)) {
        idx = i
        break
      }
    }
    const stueck = halt.stuecke[idx]
    if (!stueck) return this.raeumeKarte()
    if (this.shownStop !== halt.stopp || this.itemIdx !== idx || !this.photoShown) {
      this.shownStop = halt.stopp
      this.itemIdx = idx
      this.photoShown = true
      this.ui.zeigeKarte(items[idx]!, idx, items.length)
    }
    this.ui.synchronisiereKarte(imHalt - stueck.abS, klipDauerS(stueck.standS), tempo)
  }

  /** Die Karte wegnehmen — außerhalb jedes Halts und beim Verlassen der Tour. */
  private raeumeKarte(): void {
    if (this.photoShown) this.ui.verbergeKarte()
    this.photoShown = false
    this.shownStop = null
  }

  // Klick aufs Foto: Anzeige anhalten bzw. weiterlaufen lassen
  togglePhotoHold(): void {
    if (this.phase === 'photo' && this.photoShown) this.setPlaying(!this.playing)
  }

  // Zurück ins Hauptmenü: Intro-Overlay + Übersichts-Orbit, Tour-UI einziehen.
  // Kein harter Schnitt — die Kamera zieht majestätisch zur Übersicht auf.
  toMenu(): void {
    this.raeumeKarte()
    this.ui.hideFinale()
    this.phase = 'intro'
    this.playing = false
    this.scrubbing = false
    this.speed = 0
    this.setzeFilm(0)
    this.glide = 2.2 // toMenu räumt die Karte schon oben weg
    // Orbit dort weiterdrehen, wo die Kamera gerade steht (kein Sprung)
    this.orbitA = bearing([this.mid[0], this.mid[1]], [this.cg.lng.v, this.cg.lat.v])
    this.ui.syncDots(0)
    this.onToMenu?.()
    this.ui.showMenu()
    this.updateMapLock() // Intro-Orbit: Karte gesperrt wie beim ersten Laden
  }

  // Halt direkt öffnen (Klick auf Timeline-Dot oder Karten-Wegpunkt):
  // Kamera hart hinter den Punkt setzen — der Schnitt liegt unter der Blende —
  // und die Karte sofort zeigen statt erst 600 m anzufahren. Die Filmzeit
  // springt dabei auf die ANKUNFT des Halts; alles Weitere folgt daraus.
  jumpToPhoto(s: number): void {
    const idx = this.stops.findIndex((st) => Math.abs(st.s - s) < 1)
    // Kein bekannter Halt: 600 m davor einsteigen. `seek` nimmt seit Etappe 5
    // einen FILManteil — der Ort muss also erst durch die Achse.
    if (idx === -1) return this.seek(this.film.filmBeiS(Math.max(0, s - 600)) / this.film.gesamtS)
    const st = this.stops[idx]!
    this.raeumeKarte()
    if (this.phase === 'finale') this.ui.hideFinale()
    this.scrubbing = false
    this.ui.blink(() => {
      const p = pointAt(this.route, st.s)
      const b = bearingAt(this.route, st.s)
      const sc = this.film.skalaBeiS(st.s)
      this.scaleSm.set(sc.behind)
      this.hoverSm.set(sc.hover)
      this.tuck.set(1)
      const ground = this.groundAlt([p[0], p[1]], p[2])
      const cg = destination([p[0], p[1]], this.preset.behind * sc.behind, (b + 180) % 360)
      this.cg.lng.set(cg[0])
      this.cg.lat.set(cg[1])
      this.alt.set(Math.max(ground + this.preset.hover * sc.hover, this.groundAlt(cg, p[2]) + 110))
      this.lt.lng.set(p[0])
      this.lt.lat.set(p[1])
      this.ltAlt.set(ground)
      this.course = b
      this.speed = 0
      this.dir = 1
      this.setzeFilm(this.film.filmBeiS(st.s))
      this.phase = 'photo'
      this.ui.syncDots(st.s)
      this.ui.updateTrace(st.s, p)
      if (!this.playing) this.setPlaying(true)
      this.applyCamera()
      // Die Karte legt der nächste Kopfschritt hin — sie ist eine Funktion der
      // Filmzeit, und die steht jetzt auf der Ankunft des Halts.
      this.synchronisiereKarte(this.halt)
    })
  }

  restart(): void {
    this.raeumeKarte()
    this.ui.hideFinale()
    this.ui.blink(() => {
      this.speed = 0
      this.dir = 1
      this.setzeFilm(0)
      this.phase = 'ride'
      this.glide = 1
      this.course = bearingAt(this.route, 0)
      this.ui.syncDots(0)
      // Kamera hart hinter den Start setzen (Schnitt liegt unter der Blende)
      const start = pointAt(this.route, 0)
      const b0 = bearingAt(this.route, 0)
      const cg = destination([start[0], start[1]], this.preset.behind, (b0 + 180) % 360)
      this.cg.lng.set(cg[0]); this.cg.lat.set(cg[1])
      this.alt.set(this.groundAlt([start[0], start[1]], start[2]) + this.preset.hover)
      this.lt.lng.set(start[0]); this.lt.lat.set(start[1])
      this.ltAlt.set(this.groundAlt([start[0], start[1]], start[2]))
      if (!this.playing) this.setPlaying(true)
      this.applyCamera()
    })
  }

  // Tempo-Knopf: 1× → 2× → 4× → 8× → 1×. Der Schnelllauf geht seit E16 in
  // BEIDEN Bühnen bis 8×, und der Ton klingt dort nicht mehr mit (main.ts) —
  // im Schnelllauf klänge er wie ein durchgedrehter Kassettenrekorder, und
  // genau das machte den fehlenden Ausgleich beim `shuttle` gegenstandslos.
  cycleSpeed(): number {
    this.mult = this.mult >= 8 ? 1 : this.mult * 2
    return this.mult
  }

  // — Tastatursteuerung wie im Video-Editor —

  // Einzelbild vor/zurück (Cursortasten). Ein „Bild“ = 1/24 FILMsekunde — seit
  // E2 eine Zeit und keine Strecke mehr, und damit an einer Rampe oder im Halt
  // dasselbe Bild wie im Editor. Bleibt angehalten, snappt die Kamera hart auf
  // die neue Position (kein Nachschweben) und aktualisiert den Kamerastand →
  // kein Resume-Fade.
  nudge(frames: number): void {
    if (this.phase === 'intro') return
    if (this.phase === 'finale') this.ui.hideFinale()
    // Kam die Kamera gerade aus der Fahrt (noch nicht eingeschwungen), läge sie
    // auf einer nachlaufenden Pose — ein harter Snap auf die ideale Pose wäre
    // dann genau der sichtbare Sprung. In dem Fall NICHT snappen, sondern die
    // Einschwing-Schleife (tick) die Kamera weich nachziehen lassen; ab dem
    // nächsten Bild sitzt sie auf ideal und die Taste schneidet knackig.
    const wasSettled = this.settled && this.phase === 'ride'
    this.phase = 'ride'
    this.raeumeKarte()
    this.dir = 1
    this.speed = 0
    this.setPlaying(false)
    this.setzeFilm(this.filmS + frames / 24)
    if (wasSettled) {
      this._snapRideCamera() // eingeschwungen ⇒ harter Einzelbild-Schnitt, kein Sprung
      this.settled = true
      this.camSnap = this._camNow() // Kamera steht auf der Tour-Pose ⇒ Fortsetzen ohne Blende
    } else {
      this.settled = false // tick schwingt die Kamera jetzt weich auf die neue Pose ein
      this.repose = true // Umposition erlauben (sonst bliebe die Pause eingefroren)
      this.reposeTween = null // velocity-basiertes Ease (kein Sprung-Schwenk)
      this.glide = Math.min(this.glide, 0.45) // zügig, damit es nur kurz „nachzieht“
    }
    this.ui.updateTrace(this.s, pointAt(this.route, this.s))
    this.ui.syncDots(this.s)
    this.emitStats()
  }

  // Ideale Fahrt-Pose (Kameraposition + Blickpunkt) für Streckenmeter s berechnen,
  // OHNE etwas zu setzen. Spiegelt bewusst die Rahmung des else-Zweigs in update().
  // Geteilt vom harten Snap und vom weichen Scrub-Schwenk.
  _ridePose(
    s: number,
    course = bearingAt(this.route, s),
    opt?: { sc?: Kameradistanz; k?: number; gelaendeDeckel?: boolean },
  ): Fahrtpose {
    const { route, preset } = this
    const rider = pointAt(route, s)
    const backDir = this.yawedBackDir(course) // Golden Hour: zur Sonne eindrehen (Pause/Scrub konsistent)
    const riderG = this.groundAlt([rider[0], rider[1]], rider[2])
    const sc = opt?.sc ?? this.film.skalaBeiS(s)
    const behind = preset.behind * sc.behind
    const hover = preset.hover * sc.hover
    let k = opt?.k ?? 1
    if (opt?.k == null) {
      while (k > 0.4) {
        const cand = destination([rider[0], rider[1]], behind * k, backDir)
        if (this.groundAlt(cand, rider[2]) + 110 <= riderG + hover * k) break
        k -= 0.12
      }
    }
    const cgPos = destination([rider[0], rider[1]], behind * k, backDir)
    const alt = opt?.gelaendeDeckel === false
      ? riderG + hover * k
      : Math.max(riderG + hover * k, this.groundAlt(cgPos, rider[2]) + 110)
    return {
      course, sc, k,
      cg: cgPos,
      alt,
      lt: [rider[0], rider[1]],
      ltAlt: this.liftedLtAlt(cgPos, [rider[0], rider[1]], riderG, alt), // Himmel-Moment auch bei Pause/Scrub
    }
  }

  // Fahrt-Kamera für this.s ohne Smooth-Rest setzen (harter Snap), nur mit .set().
  // `course` mitgeben: den geglätteten Kurs halten (Export). Fehlt er, gilt der
  // Rohkurs der Stelle, wie Seek und Einzelbild ihn wollen.
  _snapRideCamera(course?: number): void {
    const kurs = course ?? bearingAt(this.route, this.s)
    const p = this._ridePose(this.s, kurs)
    this.course = kurs
    this.scaleSm.set(p.sc.behind)
    this.hoverSm.set(p.sc.hover)
    this.tuck.set(p.k)
    this.cg.lng.set(p.cg[0])
    this.cg.lat.set(p.cg[1])
    this.alt.set(p.alt)
    this.lt.lng.set(p.lt[0])
    this.lt.lat.set(p.lt[1])
    this.ltAlt.set(p.ltAlt)
    this.glide = 1
    this.applyCamera()
  }

  /**
   * Eine Filmsekunde für den Encoder.
   *
   * `hart` nur zum Einschwingen (Intro-Orbit → Startpose). Danach folgt die
   * Kamera derselben Smooth-Pipeline wie die Fahrt, mit längeren taus: DEM-
   * Kacheln und GPS-Ecken dürfen das Bild nicht zum Wackeln bringen. Tuck und
   * Geländedeckel bleiben aus. Ein Hang im Rücken zog sonst in einem Frame an.
   */
  stelleExportFrame(filmS: number, skalaMin = 0.9, hart = false): void {
    if (this.phase === 'intro') this.ui.hideIntro()
    if (this.phase === 'finale') this.ui.hideFinale()
    this.phase = 'ride'
    this.playing = false
    this.scrubbing = false
    this.repose = false
    this.reposeTween = null
    const dt = Math.abs(filmS - this.filmS)
    this.setzeFilm(filmS)
    const sc = this.film.skalaBeiS(this.s)
    const geklemmt = {
      behind: Math.max(sc.behind, skalaMin),
      hover: Math.max(sc.hover, skalaMin),
    }
    if (hart) {
      this.course = bearingAt(this.route, this.s)
    } else if (dt > 1e-4) {
      this.course += angleDelta(this.course, bearingAt(this.route, this.s)) * (1 - Math.exp(-dt / 3.6))
    }
    this.tuck.set(1)
    const p = this._ridePose(this.s, this.course, { sc: geklemmt, k: 1, gelaendeDeckel: false })
    this.scaleSm.set(p.sc.behind)
    this.hoverSm.set(p.sc.hover)
    this.glide = 1
    if (hart) {
      this.cg.lng.set(p.cg[0])
      this.cg.lat.set(p.cg[1])
      this.alt.set(p.alt)
      this.lt.lng.set(p.lt[0])
      this.lt.lat.set(p.lt[1])
      this.ltAlt.set(p.ltAlt)
    } else if (dt > 1e-4) {
      const d = dt
      this.cg.lng.to(p.cg[0], d, 3.2)
      this.cg.lat.to(p.cg[1], d, 3.2)
      this.alt.to(p.alt, d, 4.2)
      this.lt.lng.to(p.lt[0], d, 0.8)
      this.lt.lat.to(p.lt[1], d, 0.8)
      this.ltAlt.to(p.ltAlt, d, 1.1)
    }
    this.applyCamera()
    this.settled = true
    this.camSnap = this._camNow()
    this.synchronisiereKarte(this.halt)
    this.ui.updateTrace(this.s, pointAt(this.route, this.s))
    this.ui.syncDots(this.s)
    this.emitStats()
  }

  // Kurzer, zeitbasierter Kameraschwenk auf die ideale Fahrt-Pose der aktuellen
  // Position (Scrub-Sprung im Pause-Modus): weich, sanft auslaufend, und — anders
  // als exponentielles Nachziehen — nach `dur` garantiert sauber am Ziel. Ersetzt
  // den harten, ruckartigen Schnitt. Kurs/Distanz-Skalierung werden sofort auf den
  // Zielwert gesetzt (sie bestimmen die feste Ziel-Pose), nur cg/alt/Blickpunkt
  // werden über die Zeit interpoliert.
  _beginReposeTween(dur: number): void {
    const to = this._ridePose(this.s)
    this.course = to.course
    this.scaleSm.set(to.sc.behind)
    this.hoverSm.set(to.sc.hover)
    this.tuck.set(to.k)
    this.reposeTween = {
      t: 0,
      dur,
      from: { cgLng: this.cg.lng.v, cgLat: this.cg.lat.v, alt: this.alt.v, ltLng: this.lt.lng.v, ltLat: this.lt.lat.v, ltAlt: this.ltAlt.v },
      to: { cgLng: to.cg[0], cgLat: to.cg[1], alt: to.alt, ltLng: to.lt[0], ltLat: to.lt[1], ltAlt: to.ltAlt },
    }
    this.repose = true
    this.settled = false
  }

  // JKL-Shuttle: L (dir +1) / J (dir −1). Erneut in dieselbe Richtung = schneller;
  // Richtungswechsel startet wieder bei 1×. K hält an (in main.ts verdrahtet).
  shuttle(dir: number): void {
    if (this.phase === 'intro') return
    if (this.phase === 'finale') this.ui.hideFinale()
    this.phase = 'ride'
    // Auch hier kein `raeumeKarte()` (s. `seek`): Ein Richtungswechsel MITTEN
    // in einem Halt ließ die Karte sonst kurz verschwinden und mit vollem
    // Auftritt zurückkommen, obwohl sich an der Filmzeit nichts geändert hat.
    // Ab 2× nimmt `synchronisiereKarte` sie ohnehin weg (E16).
    if (this.playing && this.dir === dir) {
      this.mult = this.mult >= 8 ? 8 : this.mult * 2
    } else {
      this.dir = dir
      this.mult = 1
    }
    if (!this.playing) this.setPlaying(true)
  }

  // — pro Frame —

  tick(now: number): void {
    // Echte Frame-Zeit, ungedeckelt (src/filmuhr.ts). Ein langsames Gerät lässt
    // das Bild springen statt nachlaufen — und die Kamera rechnet auf DEMSELBEN
    // `dt`: ein eigener Deckel für sie ließe sie dauerhaft hinterherhängen.
    const dt = this.uhr.frame(now)

    if (this.phase === 'intro') {
      // Ruhiger, langsamer Orbit: das Intro ist Bühne, nicht Bewegungsschau — die
      // langsame Drift liegt hinter dem abgedunkelten/verwischten Titel-Scrim (style.css)
      this.orbitA += 0.7 * dt
      this.updateOrbitCamera(dt, this.mid, this.ovR, this.ovA)
    } else if (this.playing || this.scrubbing) {
      this.update(dt) // beim Scrubben muss die Kamera auch in Pause folgen
    } else if (this.phase === 'ride' && this.repose && !this.settled) {
      // Pausiert, aber eine Umposition wurde explizit angefordert. Ohne repose
      // bleibt die Pause bewegungslos eingefroren.
      if (this.reposeTween) {
        // Scrub-Sprung: zeitbasierter Schwenk fester Dauer, sanft auslaufend
        // (easeOut) — nie ruckartig, nie sekundenlanges Nachkriechen. camSnap
        // mitführen, damit die Drag-Erkennung diese Systembewegung nicht für ein
        // Nutzer-Verschieben hält.
        const tw = this.reposeTween
        tw.t += dt
        const f = Math.min(tw.t / tw.dur, 1)
        const e = 1 - Math.pow(1 - f, 3) // easeOutCubic: schnell los, weich aus
        const L = (a: number, b: number) => a + (b - a) * e
        this.cg.lng.set(L(tw.from.cgLng, tw.to.cgLng))
        this.cg.lat.set(L(tw.from.cgLat, tw.to.cgLat))
        this.alt.set(L(tw.from.alt, tw.to.alt))
        this.lt.lng.set(L(tw.from.ltLng, tw.to.ltLng))
        this.lt.lat.set(L(tw.from.ltLat, tw.to.ltLat))
        this.ltAlt.set(L(tw.from.ltAlt, tw.to.ltAlt))
        this.applyCamera()
        this.camSnap = this._camNow()
        if (f >= 1) { this.settled = true; this.repose = false; this.reposeTween = null }
      } else {
        // Kameradistanz-Wechsel / Einzelbild: Kamera weich auf die neue Pose
        // ziehen, Einrasten GESCHWINDIGKEITSbasiert (kommt die Bewegung pro Bild
        // zum Stillstand). camSnap mitführen (s.o.).
        const prev = this._camNow()
        this.update(dt)
        const cur = this._camNow()
        this.camSnap = cur
        const stopped =
          Math.abs(cur.lng - prev.lng) < 1e-7 &&
          Math.abs(cur.lat - prev.lat) < 1e-7 &&
          Math.abs(cur.zoom - prev.zoom) < 5e-4 &&
          Math.abs(cur.bearing - prev.bearing) < 0.02 &&
          Math.abs(cur.pitch - prev.pitch) < 0.02
        if (stopped) { this.settled = true; this.repose = false }
      }
    }

    this.uiClock += dt
    if (this.uiClock > 0.1) {
      this.uiClock = 0
      this.emitStats()
    }
    requestAnimationFrame(this._tick)
  }

  /**
   * Aktueller Fortbewegungsmodus bei Streckenmeter s — aus der ACHSE, nicht aus
   * den rohen Grenzen (s. `Filmspur.modusBeiS`). Das Label kommt weiter aus den
   * Grenzen, es ist reine Beschriftung.
   */
  modeAt(s: number): ModusGrenze {
    const mode = this.film.modusBeiS(s)
    for (const m of this.modes) if (m.mode === mode) return m
    return { s: 0, mode }
  }

  update(dt: number): void {
    const { route, preset } = this
    this.glide += (1 - this.glide) * (1 - Math.exp(-dt / 2.2))
    this.skyLift.to(this.skyLiftTarget, dt, SKY_LIFT_TAU) // Himmel-Anhebung weich nachziehen

    // — Die Filmzeit läuft, die Position folgt (E2) —
    //
    // Kein Integrator mehr, keine Trigger: `mult` ist ein Faktor auf die
    // Filmzeit, `dir` ihr Vorzeichen, und ALLES Weitere — Position, Halt,
    // Phase, Foto-Karte — ist eine Funktion von `filmS`. Rückwärts läuft
    // dieselbe Kurve rückwärts, Halte und Rampen inklusive (E13).
    const vorher = this.filmS
    const sVorher = this.s
    if (!this.scrubbing && this.playing) {
      this.setzeFilm(this.filmS + this.dir * this.mult * dt)
      if (this.dir < 0 && this.filmS <= 0) { this.dir = 1; this.setPlaying(false) } // am Anfang angekommen
    }
    // Beobachtetes Streckentempo (m/s) — Messwert, kein Antrieb.
    if (dt > 0) this.speed = Math.abs(this.s - sVorher) / dt
    const halt = this.halt
    const warPhase = this.phase

    if (halt?.moment) {
      // Kamera-Moment: Die Fahrt STEHT (das sagt die Kurve), die Kamera führt
      // eine Bewegung aus. Ein Ausroll-Warten gibt es nicht mehr — die Rampe
      // vor dem Halt hat die Fahrt bereits sauber zum Stehen gebracht.
      this.phase = 'moment'
      this.raeumeKarte()
      const m = halt.moment
      const p = pointAt(route, this.s)
      const imHalt = this.filmS - halt.filmVon
      if (warPhase !== 'moment') {
        // Orbit-Azimut nahtlos aus der aktuellen Kameralage übernehmen
        this.orbitA = bearing([p[0], p[1]], [this.cg.lng.v, this.cg.lat.v])
        this.glide = 2.2 // weicher Eingang in die Kamerabewegung
      }
      if (m.art === 'umkreisen') {
        // Über die FILMzeit gedreht, nicht über die Frame-Zeit: rückwärts dreht
        // der Orbit dadurch zurück, statt weiterzulaufen.
        this.orbitA += MOMENT_ORBIT_SPEED * (this.filmS - vorher)
        this.updateOrbitCamera(dt, p, this.preset.behind * this.scaleSm.v, this.preset.hover * this.hoverSm.v)
      } else if (m.art === 'aufstieg') {
        // Kamera-Bodenpunkt halten, Flughöhe + Blick über die Dauer anheben
        const t = Math.min(1, imHalt / Math.max(0.001, halt.filmBis - halt.filmVon))
        const ease = t * t * (3 - 2 * t)
        const riderG = this.groundAlt([p[0], p[1]], p[2])
        const zielAlt = riderG + this.preset.hover * this.hoverSm.v * (1 + (MOMENT_ASCEND_LIFT - 1) * ease)
        this.smoothTowards(dt, [this.cg.lng.v, this.cg.lat.v], zielAlt, p)
      } // innehalten: kein Kamera-Update → Pose bleibt exakt eingefroren
      this.applyCamera()
      this.ui.updateTrace(this.s, p)
      return
    }

    if (halt?.stopp) {
      // Aufnahme-Halt: Route UND Kamera stehen komplett still — kein Orbit,
      // kein Nachschwingen. Der Einfrier-Moment liegt unter dem Kamerablitz.
      // Dass die Standzeit unter dem „Angehalten"-Abzeichen NICHT weiterläuft,
      // fällt jetzt von selbst an: Steht die Filmuhr, steht der Halt.
      this.phase = 'photo'
      this.synchronisiereKarte(halt)
      this.ui.updateTrace(this.s, pointAt(route, this.s))
      return
    }

    if (warPhase === 'photo' || warPhase === 'moment') {
      // Halt verlassen — in beide Richtungen derselbe Weg zurück in die Fahrt.
      this.raeumeKarte()
      this.phase = 'ride'
      this.glide = 1.5
    } else if (this.phase !== 'finale') {
      this.phase = 'ride'
    }

    if (this.filmS >= this.film.gesamtS && this.dir > 0 && !this.scrubbing && this.playing) {
      // Ohne Endscreen: wieder der Startscreen — kein „Ziel erreicht" ohne Ziel.
      if (!this.showFinale) {
        this.toMenu()
      } else if (this.phase !== 'finale') {
        this.phase = 'finale'
        this.glide = 2.2
        this.orbitA = bearing([this.mid[0], this.mid[1]], [this.cg.lng.v, this.cg.lat.v])
        this.ui.showFinale()
      }
      if (this.phase === 'finale') {
        this.orbitA += 3 * dt
        this.updateOrbitCamera(dt, this.mid, this.ovR * 0.78, this.ovA * 0.65)
      }
    } else {
      // Fahrt: Der Blickpunkt IST der Fahrer — er bleibt dadurch immer exakt in
      // der Bildmitte. Die Kamera hängt in festem Luftlinien-Abstand hinter einer
      // stark geglätteten Fahrtrichtung — Spitzkehren werden so zu einem einzigen
      // ruhigen Schwenk statt hektischer Kamerasprünge entlang der Route.
      const rider = pointAt(route, this.s)
      this.course += angleDelta(this.course, bearingAt(route, this.s)) * (1 - Math.exp(-dt / (2.8 * this.glide)))
      const backDir = this.yawedBackDir(this.course) // Golden Hour: zur Sonne eindrehen
      const riderG = this.groundAlt([rider[0], rider[1]], rider[2])
      // Kameradistanz an den Fortbewegungsmodus anpassen (zu Fuß nah, Fähre weit).
      // Sie wird GESETZT, nicht gefiltert: Der Übergang steckt schon in der
      // Achse (dieselbe Rampe wie das Tempo), ein zweiter Tiefpass darüber
      // hinkte ihm nach und machte aus dem Wechsel einen Tempo-Ausreißer.
      const sc = this.film.skalaBeiS(this.s)
      this.scaleSm.set(sc.behind)
      this.hoverSm.set(sc.hover)
      const behind = preset.behind * this.scaleSm.v
      const hover = preset.hover * this.hoverSm.v
      // Steht eine Felswand hinter dem Fahrer, die Kamera nicht darüber heben
      // (das kippt die Sicht in die Draufsicht), sondern proportional näher an
      // den Fahrer heranziehen — Abstand:Höhe bleibt gleich, der Pitch konstant.
      let k = 1
      while (k > 0.4) {
        const cand = destination([rider[0], rider[1]], behind * k, backDir)
        if (this.groundAlt(cand, rider[2]) + 110 <= riderG + hover * k) break
        k -= 0.12
      }
      this.tuck.to(k, dt, 1.4 * this.glide)
      const kk = this.tuck.v
      const cgPos = destination([rider[0], rider[1]], behind * kk, backDir)
      const cg: Wegpunkt = [cgPos[0], cgPos[1], rider[2]]
      const alt = Math.max(riderG + hover * kk, this.groundAlt(cgPos, rider[2]) + 110)
      // Himmel-Moment: Blickwinkel abflachen → Kamera kippt zum Horizont
      this.smoothTowards(dt, cg, alt, rider, this.liftedLtAlt(cgPos, [rider[0], rider[1]], riderG, alt))
      if (!this.playing && !this.scrubbing) {
        // Pausiert: sobald die Kamera praktisch auf der idealen Fahrt-Pose sitzt,
        // gilt sie als eingeschwungen — ab dann schneidet die Einzelbild-Taste hart.
        const near =
          Math.abs(this.cg.lng.v - cg[0]) < 2e-6 &&
          Math.abs(this.cg.lat.v - cg[1]) < 2e-6 &&
          Math.abs(this.alt.v - alt) < 0.5 &&
          Math.abs(angleDelta(this.course, bearingAt(route, this.s))) < 0.15
        if (near) { this.settled = true; this.repose = false; this.reposeTween = null }
      }
    }

    this.applyCamera()
    this.ui.updateTrace(this.s, pointAt(route, this.s))
  }

  updateOrbitCamera(dt: number, point: Wegpunkt, radius: number, height: number): void {
    const cg = destination([point[0], point[1]], radius, this.orbitA)
    const ground = this.groundAlt([point[0], point[1]], point[2])
    this.smoothTowards(dt, cg, ground + height, point)
    if (this.phase === 'intro') this.applyCamera()
  }

  smoothTowards(dt: number, cgTarget: LngLat2D | Wegpunkt, altTarget: number, lookTarget: Wegpunkt, ltAltTarget?: number): void {
    // Kameraposition träge (ruhige Fahrt), Blickpunkt straff (Fahrer zentriert)
    const g = this.glide
    this.cg.lng.to(cgTarget[0], dt, 2.2 * g)
    this.cg.lat.to(cgTarget[1], dt, 2.2 * g)
    this.alt.to(altTarget, dt, 2.6 * g)
    this.lt.lng.to(lookTarget[0], dt, 0.55 * g)
    this.lt.lat.to(lookTarget[1], dt, 0.55 * g)
    // ltAltTarget explizit (Himmel-Momente heben den Blickpunkt an); sonst Boden
    const ltA = ltAltTarget != null ? ltAltTarget : this.groundAlt([lookTarget[0], lookTarget[1]], lookTarget[2])
    this.ltAlt.to(ltA, dt, 0.8 * g)
  }

  applyCamera(): void {
    // Kamera bei (cg, alt) blickt auf (lt, ltAlt); MapLibre leitet daraus
    // center/zoom/pitch/bearing ab und hält die Kamera über dem Terrain.
    const opts = this.map.calculateCameraOptionsFromTo(
      new maplibregl.LngLat(this.cg.lng.v, this.cg.lat.v),
      this.alt.v,
      new maplibregl.LngLat(this.lt.lng.v, this.lt.lat.v),
      this.ltAlt.v
    )
    this.map.jumpTo(opts)
    const pose: KameraPose = {
      cg: [this.cg.lng.v, this.cg.lat.v],
      alt: this.alt.v,
      lt: [this.lt.lng.v, this.lt.lat.v],
      ltAlt: this.ltAlt.v,
    }
    // Atmosphäre-/Flare-Overlay hängt sich hier ein und bekommt dieselbe Pose
    this.onPose?.(pose)
  }

  emitStats(): void {
    const p = pointAt(this.route, this.s)
    const inTour = this.phase === 'ride' || this.phase === 'photo' || this.phase === 'moment'
    // Der nächste Halt ist eine FRAGE AN DIE POSITION, kein mitgeführter Zeiger:
    // `nextIdx` musste nach jedem Sprung und jedem Richtungswechsel von Hand
    // nachgezogen werden (`syncNextIdx`) — und war genau dort falsch, wo man es
    // vergaß.
    const next = inTour ? (this.stops.find((st) => st.s > this.s + 1) ?? null) : null
    const mo = this.modeAt(this.s)
    this.ui.stats({
      km: this.s / 1000,
      ele: p[2],
      frac: this.s / this.route.total,
      // Der Anteil, den die LEISTE zeichnet — aus `this.filmS` und nie aus `s`
      // zurückgerechnet: Im Halt steht `s`, der Rückweg über die Achse lieferte
      // dort die ganze Standzeit lang die Ankunft, und der Kopf stünde still.
      filmFrac: this.film.gesamtS > 0 ? this.filmS / this.film.gesamtS : 0,
      modeKey: mo.mode,
      next: next ? { title: next.items[0]!.title, km: (next.s - this.s) / 1000 } : null,
    })
    // Tempo-Anzeige (Button) mit Faktor + Richtung aktuell halten — auch nach
    // JKL-Shuttle oder automatischem Stopp am Streckenanfang
    this.ui.onSpeed?.(this.mult, this.dir)
  }
}
