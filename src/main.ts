import 'maplibre-gl/dist/maplibre-gl.css'
import './style.css'
import type { Map as MapLibreMap, Marker } from 'maplibre-gl'
import { TOURS, type AnchorPoint, type TourAudio, type TourTime, type Waypoint } from './tours.js'
import { loadRemoteTour, loadServerTours, createTimeAt, type RemoteTourCfg } from './remote.js'
import { profilePath, tourFromPath, tourPath } from './routes.js'
import { buildRoute, dist, groupStops, nearestS, pointAt, type Route } from './geo.js'
import { clipDurationS, holdS } from './card-timing.js'
import {
  buildFilmAxis,
  filmTimeAtDistance,
  stopAtFilmTime,
  interpolate,
  travelModeMix,
  momentHoldS,
  distanceAtFilmTime,
  type FilmAxis,
  type DistanceStop,
} from './film-axis.js'
import { buildSAtF } from './route-anchors.js'
import { stats, truncateDescription, showRoute } from './tour-texts.js'
import {
  createMap,
  addRouteLayers,
  createRider,
  setRiderIcon,
  addSpotLayers,
  MAP_EXTRA_SOURCES,
} from './map.js'
import { createDayNight } from './daynight.js'
import { sunPosition } from './sun.js'
import { createAtmosphere, type Atmosphere } from './atmosphere.js'
import { createWeather, type WeatherOverlay } from './weather.js'
import { skyAt, WEATHER_SKY, type SceneWeather } from './weather-sky.js'
import { createMusic, type BackgroundMusic } from './music.js'
import { createAudioTracks, CURATED_GAIN, type AudioTracks } from './audiotracks.js'
import { createVehicle, type VehicleSound } from './vehicle.js'
import { buildWeatherTimeline, weatherAt } from './autoweather.js'
import { sampleElevations, smoothValues } from './elevation.js'
import { UI, $, type PlayerMedium } from './ui.js'
import {
  Tour,
  mixScale,
  scaleFor,
  type FilmTrack,
  type CameraMoment,
  type TravelModeBoundary,
  type EngineStop,
} from './tour.js'
import type { FilmClock } from './film-clock.js'
import type { PinStop, PinControl } from './photopins.js'
import { enterFullscreen, exitFullscreen, fullscreenWanted } from './fullscreen.js'
import {
  EXPORT_INTRO_S,
  isEmbedded,
  EXPORT_MESSAGE,
  exportClipDurationS,
  exportPixelRatio,
  exportViewport,
  frameCount,
  parseExportFormat,
  mergeSegments,
  type ExportMessage,
} from './film-export-channel.js'

/**
 * Was der Verdrahter aus einer Tour liest — das SUBSET, in dem sich die
 * mitgelieferte `TourConfig` (src/tours.ts) und die aufgezeichnete
 * `RemoteTourCfg` (src/remote.ts) treffen. Bewusst keine dritte „Wahrheit"
 * fürs Tour-Format: Was hier fehlt, fasst diese Datei nicht an.
 */
interface PlayerPhoto {
  src: string
  title: string
  anchor: AnchorPoint
  /** Aufgezeichnete Touren bringen den Zeitstempel mit (Auto-Wetter spart das EXIF) */
  takenAt?: string
  type?: 'photo' | 'video'
  durationS?: number
  poster?: string
  thumb?: string
  display?: { holdS?: number; kenBurns?: boolean }
}

interface PlayerSegment {
  /** Freie Zeichenkette: Server-Segmente sind nicht auf `Modus` eingeschränkt */
  mode: string
  label?: string
  pts: Waypoint[]
  /**
   * Streckenanteil je Punkt, vom Server auf der ROHEN Geometrie gemessen (E11).
   * Kuratierte TOURS haben ihn NIE — sie sind eine Datei mit Wegpunkten, keine
   * Aufzeichnung; für sie bleibt es dauerhaft beim Rückfall `f × route.total`.
   */
  f?: number[]
}

interface PlayerTour {
  kicker: string
  titleHtml: string
  stops: string[]
  /** Der Satz unter dem Titel (Studio, max. 150 Zeichen) — kuratierte Touren haben keinen */
  description?: string | null
  /** Aufnehmer (nur aufgezeichnete Touren, s. remote.ts) */
  author?: { displayName: string; avatarUrl: string | null; id?: string; handle?: string | null }
  finaleTitle: string
  showFinale?: boolean
  /** Ohne `time` bleibt die Tag/Nacht-Regie (und damit die Atmosphäre) aus */
  time?: TourTime
  segments: PlayerSegment[]
  photos: PlayerPhoto[]
  /** Kuratierte Wetter-Timeline (km entlang der Route) — schlägt das Auto-Wetter */
  weather?: Array<{ km: number; mode: string; k: number }>
  /** Dasselbe aus dem Tour-JSON, aber f-verankert (remote.ts) — geht vor */
  weatherF?: Array<{ f: number; mode: string; k: number }>
  timeline?: Array<{ f: number; t: string }>
  /** `filmS` (E10) geht `f` vor — s. Kamera-Folger unten */
  camera?: Array<{ f: number; preset: string; scale?: number; filmTime?: number }>
  /** `filmS` bleibt hier ungelesen: Ein Moment IST ein Halt (s. unten) */
  moments?: Array<{ f: number; kind: string; durationS?: number; filmTime?: number }>
  audio?: TourAudio[]
  /** Master über `audio`; fehlt = KURATIERTER_PEGEL (s. TourConfig.audioPegel) */
  audioGain?: number
}

/** Ein Foto mit seiner Verankerung an der Route (`s` aus nearestS). */
type AnchoredPhoto = PlayerPhoto & PlayerMedium

/** Wetter-Stützstelle in Streckenmetern — kuratiert (cfg.weather) oder automatisch. */
interface WeatherSample {
  s: number
  mode: string
  k: number
}

/**
 * Debug-Handles am Fenster (`window.__maptale`). Sie sind kein API-Vertrag, sondern
 * der Zugriff auf die laufenden Teile in der Konsole — deshalb ist alles
 * optional, was erst im Laufe des Bootens entsteht.
 */
interface PlayerDebug {
  map?: MapLibreMap
  route?: Route
  tourAudio?: AudioTracks | null
  vehicle?: VehicleSound
  tour?: Tour
  /** Filmuhr der Engine samt Zählern (verworfene Zeit, Pausen, längstes Frame) */
  clock?: FilmClock
  /**
   * Woher die f→s-Übersetzung kommt: `tabelle` (Wegpunkt-`f` aus dem Tour-JSON)
   * oder `rueckfall` (`f × route.total`). Bei kuratierten Touren ist der
   * Rückfall der Normalfall — bei einer aufgezeichneten ein Datenfehler, der
   * sich sonst als „alles wie früher" tarnt.
   */
  anchors?: 'table' | 'fallback'
  /**
   * Die Filmachse dieser Tour (Strecke → Filmzeit). Sie treibt den Player noch
   * nicht an (Etappe 4), der Ton hängt aber schon an ihr — und zum Nachmessen
   * braucht es beides: die Achse und die Auswertung `filmS(s)`.
   */
  filmAxis?: FilmAxis
  filmTime?: (s: number) => number
  rider?: Marker
  weather?: WeatherOverlay
  music?: BackgroundMusic | null
  atmo?: Atmosphere
  pins?: PinControl
  /** 'dem' sobald die echten Höhen greifen, 'fallback' wenn der Fetch scheiterte */
  eleReady?: Promise<string>
  wxTimeline?: WeatherSample[]
}

declare global {
  interface Window {
    __maptale: PlayerDebug
    /** Brücke der Android-App (PlayerScreen.kt, @JavascriptInterface) */
    MaptaleApp?: { exit?: () => void }
  }
}

// Das Objekt entsteht VOR dem ersten Eintrag. Vorher wurde es erst beim
// Karten-Aufbau angelegt — `window.__maptale.anchor = …` lief davor und warf
// `Cannot set properties of undefined`, was das ganze Modul abbrach; und selbst
// ohne den Fehler hätte das spätere `window.__maptale = { … }` alles Frühere wieder
// weggeworfen. Deshalb wird ab hier nur noch ERGÄNZT.
window.__maptale = {}

// — Tour-Auswahl über den Pfad `/tour/<kennung>` — statische Registry oder
// aufgezeichnete Tour vom Backend (Kennungen mit `t_`, remote.ts). Top-Level-
// Await hält bewusst den Boot-Screen, bis die Tour-Daten da sind (Vite/
// Zielbrowser können TLA seit ES2022); scheitert das Laden, fällt der Player
// auf die Standard-Tour zurück.
//
// `?tour=…` bleibt als Alias bedienbar und geht vor nichts: Der Pfad IST die
// Adresse, die Query war nur ihre frühere Schreibweise (alte Installationen
// der Android-App bauen sie noch). Umgeschrieben wird sie weiter unten, sobald
// feststeht, welche Tour tatsächlich läuft.
const params = new URLSearchParams(location.search)
const fromPath = tourFromPath(location.pathname)
const tourParam = fromPath ?? params.get('tour') ?? 'kohphangan'

// — App-Modus (?app=1): der Player läuft in der WebView der Android-App —
// Dort sind Verweise auf die Landing-Seite sinnlos (es gibt keine „Startseite",
// aus der man käme) und die Tour-Auswahl überflüssig — gewählt wird in der
// Tourliste der App bzw. im Studio. body.app blendet beides aus (style.css).
const appMode = params.get('app') === '1'
if (appMode) document.body.classList.add('app')

// Video-Export: Query oder schon gesetztes `body.export`. Klasse und Viewport
// stehen VOR createMap, damit preserveDrawingBuffer und die Zeichenfläche greifen,
// bevor MapLibre misst. Format aus der Query, Vorgabe Quer 720p.
const exportMode = params.get('export') === '1' || document.body.classList.contains('export')
const exportFormat = parseExportFormat(location.search)
if (exportMode) {
  document.body.classList.add('export')
  const vp = exportViewport(exportFormat)
  document.documentElement.style.setProperty('--film-export-w', `${vp.width}px`)
  document.documentElement.style.setProperty('--film-export-h', `${vp.height}px`)
}

// — Verfügbare Viewport-Höhe als CSS-Variable —
// Die Foto-Karte bemisst sich daran (--photo-h in style.css). CSS-Einheiten
// taugen dafür nicht: `100dvh` ist in der Android-WebView der App NULL (kein
// dynamischer Viewport ohne Adressleiste) und meldet über CSS.supports trotzdem
// Unterstützung — am Gerät gemessen kollabierte der Foto-Rahmen dadurch auf 0×0.
// window.innerHeight stimmt überall; visualViewport folgt zusätzlich der
// Tastatur/Leisten-Änderung, wo es sie gibt.
// Zugleich die Ausrichtung als Klasse setzen: Die Media Features `orientation`
// und `max-height` sind in der App-WebView UNBRAUCHBAR — bei 375×843 (klar
// hochkant) meldet sie dort `orientation: landscape` UND `max-height: 500px`
// als zutreffend. Das kompakte Querformat-Layout schlug deshalb im Hochformat
// zu (Bild neben Text, Steuerung in einer engen Zeile). innerWidth/innerHeight
// stimmen dagegen — also entscheidet JS, und das CSS hängt an body.compact-landscape.
const COMPACT_HEIGHT = 560 // darüber ist auch quer genug Platz für das Normal-Layout
const setViewportHeight = () => {
  const h = window.visualViewport?.height || window.innerHeight
  if (h > 0) document.documentElement.style.setProperty('--vh-app', `${Math.round(h)}px`)
  const landscape = window.innerWidth > window.innerHeight && window.innerHeight <= COMPACT_HEIGHT
  document.body.classList.toggle('compact-landscape', landscape)
}
setViewportHeight()
window.addEventListener('resize', setViewportHeight)
window.addEventListener('orientationchange', setViewportHeight)
window.visualViewport?.addEventListener('resize', setViewportHeight)
// Der Wechsel ins Vollbild und zurück ändert die Höhe, ohne dass zwingend ein
// `resize` käme (der ResizeObserver unten fängt es zwar auch, aber das hier ist
// das direkte Signal).
document.addEventListener('fullscreenchange', setViewportHeight)
document.addEventListener('webkitfullscreenchange', setViewportHeight)
// Sicherheitsnetz: ein ResizeObserver meldet Größenänderungen auch dort, wo kein
// resize-Event ankommt (WebViews, eingebettete Ansichten) — sonst bliebe nach
// einer Drehung das Layout des vorherigen Formats stehen.
new ResizeObserver(setViewportHeight).observe(document.documentElement)
let remoteCfg: RemoteTourCfg | null = null
let remoteError: string | null = null // Meldung fürs Toast, sobald die UI steht (Fallback lief)
if (tourParam.startsWith('srv:')) {
  remoteCfg = await loadRemoteTour(tourParam.slice('srv:'.length)).catch((err: unknown) => {
    remoteError = err instanceof Error ? err.message : String(err)
    console.error('Remote-Tour nicht ladbar:', remoteError)
    return null
  })
}
// tourId bleibt der Schlüssel für Positions-Merker und Tour-Picker — für
// Server-Touren der volle „srv:…"-Param (eigener Merker pro Aufzeichnung).
// Lookup via Object.hasOwn: ?tour=constructor o. Ä. darf nicht über die
// Prototypkette eine Funktion statt einer Tour liefern.
const tourId = remoteCfg ? tourParam : Object.hasOwn(TOURS, tourParam) ? tourParam : 'kohphangan'
// Der Registry-Zugriff über eine freie Zeichenkette braucht die Tabelle als
// Wörterbuch; `TOURS` selbst bleibt das Literal (die Typen der Touren hängen
// daran). Der zweite Fallback ist unerreichbar — tourId kommt aus genau dieser
// Tabelle —, steht aber, damit der Typ ohne `!` auskommt.
const cfg: PlayerTour =
  remoteCfg ?? (TOURS as Record<string, PlayerTour>)[tourId] ?? TOURS.kohphangan

// Wer über die Alt-Adresse `?tour=…` kam, bekommt die Adresszeile auf die
// heutige Form gezogen — wie die Profilseite mit `?id=…`. Erst HIER, nicht
// gleich beim Lesen: Scheiterte das Laden, stünde sonst eine Adresse in der
// Zeile, die auf eine Tour zeigt, die gar nicht läuft. Der Rest der Query
// (`?app=1`, `?dev=1`, …) bleibt unangetastet, und `replaceState` legt
// keinen Eintrag in die Verlaufsliste — der Weg zurück bleibt, wo er war.
if (!fromPath && params.has('tour')) {
  const rest = new URLSearchParams(location.search)
  rest.delete('tour')
  const query = rest.toString()
  history.replaceState(null, '', tourPath(tourId) + (query ? `?${query}` : '') + location.hash)
}

// Eine Tour beginnt am Anfang — immer. Es gab hier einmal eine Wiederaufnahme
// über ein Einmal-Ticket im sessionStorage; ihr einziger Erzeuger war der
// Ansicht-/Renderer-Umschalter, der die Seite neu lud und am selben Frame
// weiterlaufen sollte. Mit dem Labor ist er entfallen, und damit der Grund:
// Wer eine Tour verlässt und erneut startet, will den Startscreen und nicht
// Kilometer 14 von gestern.

// ?reverse=1: Tour rückwärts abspielen (nur Wegpunkt-/Segment-Reihenfolge umgedreht,
// nichts am Kamera-/Sonnen-Code). Grund: Die Pseudo-Zeit koppelt Sonnenuntergang an den
// Streckenfortschritt — je nach Route zeigt die Fahrtrichtung dann zur oder von der Sonne
// weg. Für Stockholm liegt die untergehende Sonne rückwärts die GANZE Golden Hour voraus
// (vorwärts nur an einer einzigen Stelle). Fotos werden per nearestS neu verankert.
const reverse = params.get('reverse') === '1'
// Die f-Liste muss MITGEDREHT werden: Sie ist parallel zu `pts`, und rückwärts
// läuft sie danach absteigend (baueSBeiF spiegelt die Tabelle dafür selbst).
const segsSrc: PlayerSegment[] = reverse
  ? cfg.segments
      .slice()
      .reverse()
      .map((seg) => ({
        ...seg,
        pts: seg.pts.slice().reverse(),
        ...(seg.f ? { f: seg.f.slice().reverse() } : {}),
      }))
  : cfg.segments

// Segmente zu einer Wegpunktliste verbinden (Nahtpunkte dedupen)
const waypoints: Waypoint[] = []
// Parallel dazu das `f` je Wegpunkt — dieselbe `slice(1)`-Regel, sonst trägt ab
// dem zweiten Segment jeder Wegpunkt das f seines Nachbarn. Fehlt EINEM Segment
// die Liste (oder hat sie eine andere Länge als seine Punkte), gibt es keine
// Tabelle: eine halbe wäre schlimmer als keine.
const waypointF: number[] = []
let fComplete = true
for (const seg of segsSrc) {
  const first = waypoints.length === 0
  waypoints.push(...(first ? seg.pts : seg.pts.slice(1)))
  if (seg.f?.length === seg.pts.length) waypointF.push(...(first ? seg.f : seg.f.slice(1)))
  else fComplete = false
}
const route = buildRoute(waypoints)

// Die eine Übersetzung, durch die JEDER f-Anker dieser Tour geht (§8D). Danach
// rechnet der Player nur noch in Metern — es gibt bewusst keine Tabelle zurück.
const sAtF = buildSAtF(fComplete ? waypointF : null, route.wpS, route.total)
window.__maptale.anchors = sAtF.source
// Für die zwei Verbraucher, die (noch) in Anteilen rechnen: audiotracks.ts
// vergleicht `f0 <= frac < f1` gegen `s / route.total` und ist mit dem Studio
// GETEILT (Etappe 4b stellt beide zugleich auf Filmsekunden um), createTimeAt
// interpoliert seine Stützstellen in f. Beide bekommen deshalb keinen Meter,
// sondern ihre Anker in der Parametrisierung des Players — dieselbe Korrektur,
// nur am Ende wieder durch `total` geteilt.
const fracAtF = (f: number) => sAtF(f) / route.total

// Streckenmeter des Segment-Anfangs; ein Segment ohne Punkte gibt es in gültigen
// Daten nicht (der Fallback vermeidet nur die Ausnahme im Verdrahter).
const segmentStart = (r: Route, seg: PlayerSegment) => {
  const p0 = seg.pts[0]
  return p0 ? nearestS(r, p0) : 0
}

// Modus-Grenzen. Vorwärts: sauber via nearestS je Segment-Startpunkt. Rückwärts:
// die VORWÄRTS-Grenzen an der Streckenmitte spiegeln — nearestS auf reversierte
// Segment-Nähte ist mehrdeutig (Inseln wie Fjäderholmarna liegen nah an der
// Stadtstrecke → die Fähre würde über die halbe Route „auslaufen").
let modes: TravelModeBoundary[]
if (reverse) {
  const fwdWp: Waypoint[] = []
  for (const seg of cfg.segments) fwdWp.push(...(fwdWp.length ? seg.pts.slice(1) : seg.pts))
  const fwdRoute = buildRoute(fwdWp)
  const T = fwdRoute.total
  const fwd = cfg.segments.map((seg) => ({
    s: segmentStart(fwdRoute, seg),
    mode: seg.mode,
    label: seg.label ?? seg.mode,
  }))
  const firstAt = fwd[0]
  if (firstAt) firstAt.s = 0
  const bounds = fwd.map((m) => m.s).concat([T]) // [0, s1, …, T] — Segment-Intervalle
  const scale = route.total / T // reversierte Route ist minimal anders lang
  modes = fwd
    .map((m, i) => ({ s: (T - (bounds[i + 1] ?? T)) * scale, mode: m.mode, label: m.label }))
    .sort((a, b) => a.s - b.s)
} else {
  modes = cfg.segments.map((seg) => ({
    s: segmentStart(route, seg),
    mode: seg.mode,
    label: seg.label ?? seg.mode,
  }))
}
const firstBoundary = modes[0]
if (firstBoundary) firstBoundary.s = 0
const startMode = firstBoundary?.mode ?? 'bike'
const photos: AnchoredPhoto[] = cfg.photos
  .map((p) => ({ ...p, s: nearestS(route, p.anchor) }))
  .sort((a, b) => a.s - b.s)
// Fotos mit nahe beieinanderliegenden Ankern zu einem Stopp gruppieren —
// dort werden sie nacheinander gezeigt (ein Halt, mehrere Bilder)
const stops = groupStops(photos)
// Kamera-Momente (Kreativbaukasten): Punkt-Ereignisse, f → Streckenmeter s.
// Die Engine hält dort an und führt eine Kamerabewegung aus (src/tour.ts).
//
// Als einziges Ereignis bleibt der Moment an `f` verankert, obwohl das Tour-JSON
// seit E10 auch für ihn eine Filmsekunde trägt: Ein Moment IST ein Halt, und die
// Achse wird AUS den Halten gebaut — ihn über sie zu verorten wäre ein Kreis. Ein
// Ort auf der Strecke ist er nicht nur wegen der Kamerabewegung, sondern weil
// genau das seine Filmsekunde überhaupt erst erzeugt. Das Feld im JSON ist die
// Auskunft, WANN er im Film liegt, kein Eingang für den Player.
const moments: CameraMoment[] = (cfg.moments ?? [])
  .map((m) => ({ s: sAtF(m.f), kind: m.kind as CameraMoment['kind'], durationS: m.durationS }))
  .sort((a, b) => a.s - b.s)
// — Die Filmachse: Strecke → Filmzeit (Etappe 3) —
//
// Sie TREIBT den Player noch NICHT an — das ist Etappe 4; bis dahin integriert
// die Engine ihre Position weiter selbst. Gebraucht wird sie schon jetzt für den
// TON: Wer mitten in ein Musikstück springt, soll es dort hören, wo der Film
// steht (`musikVersatzS`, src/audiotracks.ts).
//
// Gerechnet wird über die ROHEN Wegpunktabstände, NICHT über `route.cum`:
// Catmull-Rom und das 14-m-Raster machen die gebaute Route 2,2–3,0 % länger, und
// die Dehnung verteilt sich ungleichmäßig — die Filmdauer wäre allein durch die
// Glättung zu lang (Konzept §8C, Falle 2). Dieselbe Sorte Tabelle wie bei den
// f-Ankern, nur mit den rohen Metern statt `f` auf der einen Seite.
const rawCum: number[] = [0]
for (let i = 1; i < waypoints.length; i++) {
  rawCum.push(
    (rawCum[i - 1] as number) + dist(waypoints[i - 1] as Waypoint, waypoints[i] as Waypoint),
  )
}
const rawTotal = rawCum[rawCum.length - 1] ?? 0
/** Wegstand auf der GEBAUTEN Route → roher Wegstand (die Achse rechnet in diesen). */
const rawAtRoute = (s: number) => interpolate(route.wpS, rawCum, s)

/** Roher Wegstand → Wegstand auf der GEBAUTEN Route (der Rückweg von `rawAtRoute`). */
const routeAtRaw = (raw: number) => interpolate(rawCum, route.wpS, raw)

/**
 * Die Halte der Achse: Foto-/Video-Ketten und Kamera-Momente. Ein Halt kostet
 * Filmzeit und keine Strecke — genau das drückt die Achse aus.
 *
 * Die Breite einer Aufnahme ist ihr KLIP (Standzeit + Ausblendung), dieselbe Rechnung
 * wie im Editor (`mediumHoldS`); fehlt einem Video die Länge, gilt in BEIDEN
 * Bühnen die Foto-Annahme (Konzept, Falle 4). Die `stuecke` fallen aus
 * DERSELBEN Rechnung ab — die Engine schaltet die Karte danach weiter, statt
 * die Standzeiten ein zweites Mal zu addieren.
 *
 * **Diese Achse wird nie neu gebaut** (Konzept, Falle 5): Seit die Position aus
 * ihr kommt, verschöbe ein Neubau mitten in der Fahrt nicht mehr nur den
 * Balken, sondern `s` — die Kamera setzte sichtbar um. Videolängen, die bei
 * Altbestand erst mit `loadedmetadata` bekannt werden, ändern hier deshalb
 * nichts mehr; es gilt, was das Tour-JSON sagt, und ohne Angabe die
 * Foto-Annahme, die auch das Studio trifft.
 */
const axisStops: Array<DistanceStop & Omit<EngineStop, 'filmVon' | 'filmBis'>> = [
  ...stops.map((stop) => {
    let from = 0
    const pieces = stop.items.map((m) => {
      const stopHoldS = holdS(m)
      const piece = { atS: from, holdS: stopHoldS }
      from += clipDurationS(stopHoldS)
      return piece
    })
    return { meterM: rawAtRoute(stop.s), breiteS: from, stop: stop, moment: null, pieces }
  }),
  ...moments.map((m) => ({
    meterM: rawAtRoute(m.s),
    breiteS: momentHoldS(m),
    stop: null,
    moment: m,
    pieces: [],
  })),
]
const axisBoundaries = modes.map((m) => ({ fromM: rawAtRoute(m.s), mode: m.mode }))
const filmAxis = buildFilmAxis(axisBoundaries, rawTotal, axisStops)
/**
 * Fortbewegung an einem ROHEN Meterstand — aus der ACHSE, nicht aus `modes`.
 * Die Achse zieht einen Tempowechsel dicht an einem Halt auf den Halt; die
 * rohen Grenzen wissen davon nichts.
 */
const modeAtRaw = (m: number): string => {
  let mode = filmAxis.modes[0]?.mode ?? 'bike'
  for (const g of filmAxis.modes) if (g.fromM <= m) mode = g.mode
  return mode
}
/** Filmsekunde an einem Wegstand der gebauten Route. */
const filmTimeAtS = (s: number) => filmTimeAtDistance(filmAxis, rawAtRoute(s))
/**
 * Die Achse, wie die Engine sie liest (E2) — in den Metern der GEBAUTEN Route.
 *
 * Der Umrechnungsschritt gehört hierher und nicht in die Engine: Die Achse
 * rechnet in ROHEN Metern (sonst wäre die Filmdauer allein durch die
 * Catmull-Rom-Glättung 2,2–3,0 % zu lang), die Engine fährt auf der gebauten
 * Route. Nur diese Datei kennt beide Meterstände.
 */
const filmTrack: FilmTrack = {
  totalS: filmAxis.totalS,
  sAtFilmTime: (f) => routeAtRaw(distanceAtFilmTime(filmAxis, f)),
  filmTimeAtS,
  stopAtFilmTime: (f) => stopAtFilmTime(filmAxis, f),
  travelModeAtS: (s) => {
    const m = travelModeMix(filmAxis, rawAtRoute(s), modeAtRaw)
    return m.fraction >= 0.5 ? m.toMode : m.fromMode
  },
  // Die Kameradistanz folgt DERSELBEN Rampe wie das Tempo: `travelModeMix`
  // liefert die zwei Modi und den Anteil dazwischen, `mischeSkala` macht daraus
  // die Distanz. Hier und nicht in der Engine, weil nur diese Datei beide
  // Meterstände kennt (Roh für die Achse, Route für die Kamera).
  scaleAtS: (s) => {
    const m = travelModeMix(filmAxis, rawAtRoute(s), (x) => modeAtRaw(x))
    return m.fromMode === m.toMode
      ? scaleFor(m.fromMode)
      : mixScale(scaleFor(m.fromMode), scaleFor(m.toMode), m.fraction)
  },
}
window.__maptale.filmAxis = filmAxis
window.__maptale.filmTime = filmTimeAtS

// — Tour-eigene Audio-Spuren (Kreativbaukasten, cfg.audio aus remote.ts):
// Musik-Bereiche + SFX-One-Shots, in FILMSEKUNDEN verankert (E10). Statische
// Touren haben kein cfg.audio → null, der restliche Code chaint optional.
// Der Master steht an der TOUR (cfg.audioPegel): aufgezeichnete Touren tragen
// den Studio-Pegel absolut, kuratierte sind gegen die 0.22 ausgemessen.
//
// Die Grenzen laufen EINMAL durch die Übersetzung, danach rechnet
// audiotracks.ts nur noch in Filmzeit. Je Endpunkt gilt: `filmS`/`filmToS` aus
// dem Tour-JSON, wo sie stehen — sonst der Rückfall über die Filmachse. Nur der
// Server kann den ersten Weg gehen: Ein Anker MITTEN in einer Standzeit fällt im
// Streckenanteil auf die Halt-Kante, und aus `f` ist er nicht wieder
// herauszuholen (Konzept §5.1). Kuratierte Touren tragen die Felder nie — für
// sie ist der Rückfall der Normalzustand, nicht ein Übergang.
const audioTracks = cfg.audio?.map((a) => ({
  ...a,
  filmFromS: a.filmS ?? filmTimeAtS(sAtF(a.f0)),
  filmToS: a.filmToS ?? filmTimeAtS(sAtF(a.f1)),
}))
const tourAudio = audioTracks?.length
  ? createAudioTracks(audioTracks, { volume: cfg.audioGain ?? CURATED_GAIN })
  : null
// Bringt die Tour eigene Musik mit, ersetzt sie den Ambient-Loop komplett —
// sonst liefen beide Musiken übereinander (der Musik-Schalter steuert dann tourAudio).
const hasOwnMusic = !!cfg.audio?.some((a) => a.type === 'music')

const start = pointAt(route, 0)

// — Texte aus der Tour-Konfiguration —
const setText = (id: string, text: string) => ($(id).textContent = text)
document.title = 'Maptale · deine Reisen als kinematische 3D-Erlebnisse'
setText('intro-kicker', cfg.kicker)
$('intro-kicker').hidden = !cfg.kicker.trim()
$('intro-title').innerHTML = cfg.titleHtml
setText('finale-title', cfg.finaleTitle)
setText('final-photos', String(photos.length))

// Die Stationszeile nur, wenn sie etwas beiträgt: Bei aufgezeichneten Touren
// kommen Titel UND Stationen aus denselben zwei geocodierten Endpunkten, sie
// wiederholte dort wortgleich den Titel („Runde bei Völklingen" über
// „Völklingen"). src/tour-texts.ts entscheidet, diese Datei zeigt nur.
const routeVisible = showRoute(cfg.stops, cfg.titleHtml)
setText('intro-route', cfg.stops.join('  →  '))
$('intro-route').hidden = !routeVisible

// Die Beschreibung aus dem Studio. Sie war to hierher nie angekommen: Der
// Antwort-Typ trug sie, `baueCfg` ließ sie fallen.
const description = truncateDescription(cfg.description)
if (description) setText('intro-desc', description)
$('intro-desc').hidden = !description

// — Die Kennzahlen des Startscreens —
// Eine Null ist keine Angabe: „0 hm" stand neben „0.1 km" wie ein Defekt.
// Welche Chips es gibt und wie sie heißen, entscheidet src/tour-texts.ts; hier
// werden sie nur gesetzt und ein- oder ausgehängt. Die FILMDAUER kommt aus der
// Achse und ist damit keine Schätzung, sondern die Länge, die der Film hat.
//
// Auf Modulebene und nicht im `load`-Handler der Karte: Der Startscreen steht
// lange, bevor die erste Kachel da ist, und zeigte bis dahin „– km". Nach dem
// Eintreffen der DEM-Höhen ruft `setGain` sie ein zweites Mal (die Höhenmeter
// ändern sich dann noch).
function setStats(elevationGain: number): void {
  const values = stats({
    filmDurationS: filmAxis.totalS,
    km: route.total / 1000,
    elevationGain,
    photos: photos.length,
  })
  const chip = (kind: string) => values.find((w) => w.kind === kind)
  const put = (id: string, textId: string, value: { text: string } | undefined) => {
    if (value) $(textId).textContent = value.text
    $(id).hidden = !value
  }
  put('chip-duration', 'chip-duration-text', chip('dauer'))
  put('chip-distance', 'chip-distance', chip('km'))
  put('chip-gain', 'chip-gain', chip('hm'))
  put('chip-photos', 'chip-photos', chip('fotos'))
}
setStats(route.gain)

// — Die Herkunft: von wem und wann —
// Sie ersetzt das Datum, das früher als Kicker über dem Titel stand: Ein
// Aufnahmedatum ist eine Randnotiz und bekam dort die kräftigste Farbe der
// Seite. Das Datum kommt aus der Aufnahmezeit der Tour, nicht aus einem
// eigenen Feld — es ist dieselbe Angabe.
const author = cfg.author
const recordedOn = (() => {
  if (!cfg.time?.start) return ''
  const ms = Date.parse(cfg.time.start)
  if (!Number.isFinite(ms)) return ''
  try {
    return new Intl.DateTimeFormat('de-DE', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      ...(cfg.time.zone ? { timeZone: cfg.time.zone } : {}),
    }).format(ms)
  } catch {
    // Eine unbekannte Zeitzone darf die Zeile nicht kosten, nur ihre Genauigkeit.
    return new Intl.DateTimeFormat('de-DE', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(ms)
  }
})()
if (author?.displayName) {
  setText('intro-author-name', author.displayName)
  setText('intro-author-date', recordedOn)
  $('intro-author-date').hidden = !recordedOn
  ;($('intro-author').querySelector('.intro-author-dot') as HTMLElement).hidden = !recordedOn
  const avatar = $('intro-avatar')
  if (author.avatarUrl) avatar.style.backgroundImage = `url("${author.avatarUrl}")`
  // Ohne Bild die Initiale, wie überall sonst im Produkt.
  else avatar.textContent = [...author.displayName.trim()][0]?.toUpperCase() ?? ''
  // Verlinkt wird nur, wenn es eine Profilseite gibt UND der Sprung dorthin
  // einen Rückweg hat: In der App-WebView führt die Tourliste zurück, ein
  // Profil im selben Fenster hätte nur ein Schließkreuz.
  const target = author.handle
    ? profilePath(author.handle)
    : author.id
      ? `/profil?id=${author.id}`
      : null
  const link = $('intro-author-link') as HTMLAnchorElement
  if (target && !appMode) link.href = target
  else {
    link.removeAttribute('href')
    link.setAttribute('aria-disabled', 'true')
  }
  $('intro-author').hidden = false
}

// — Der Weg zurück führt DORTHIN, WO MAN HERKAM —
// Wer aus dem Studio, dem Entdecken-Bereich oder einem Profil kommt, will dorthin
// zurück und nicht auf die Landing. Die Herkunft steht im Referrer; `history.back()`
// statt einer Navigation, damit Scrollposition und Zustand der Liste erhalten
// bleiben. Ohne Referrer (direkt geöffneter Link) bleibt es bei der Startseite.
// Die Wörter sind die der Navigation, nicht die der Pfade: /galerie heißt für
// Besucher überall „Entdecken".
const ORIGINS: Record<string, string> = {
  '/app': 'Studio',
  '/galerie': 'Entdecken',
  '/profil': 'Profil',
}
if (!appMode) {
  // Wer den Player verlässt, verlässt auch das Vollbild — sonst stünde die
  // Galerie ohne Adressleiste da. Die Browser räumen das bei einer Navigation
  // zwar selbst ab; hier steht es, weil es zur Geste gehört und nicht zur
  // Hoffnung. Der Listener hängt unabhängig davon, ob es einen Referrer gibt.
  document.querySelector('.exit-pill')?.addEventListener('click', () => exitFullscreen())
  let origin: URL | null = null
  try {
    const r = new URL(document.referrer)
    // Nur echte Zwischenseiten übernehmen; die Landing „/" ist selbst die
    // Startseite und bleibt beim Default-Knopf.
    if (r.origin === location.origin && r.pathname !== location.pathname && r.pathname !== '/')
      origin = r
  } catch {}
  if (origin) {
    const word = ORIGINS[origin.pathname] ?? 'Zurück'
    const exitPill = document.querySelector<HTMLAnchorElement>('.exit-pill')
    if (exitPill) {
      exitPill.href = origin.href
      exitPill.setAttribute('aria-label', `Zurück zu: ${word}`)
      const wordEl = exitPill.querySelector('.exit-pill-word')
      if (wordEl) wordEl.textContent = word
      exitPill.addEventListener('click', (e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || history.length < 2) return
        e.preventDefault()
        history.back()
      })
    }
  }
}

const map = createMap(
  'map',
  [start[0], start[1]],
  // 1,5× auf 720p = 1080p-Framebuffer, unter dem 5-MP-Deckel. 1080p bleibt 1×
  // (Konzept §8.7: kein zusätzlicher 2×-Hochzug).
  exportMode ? { preserveDrawingBuffer: true, pixelRatio: exportPixelRatio(exportFormat) } : {},
)
Object.assign(window.__maptale, { map, route, tourAudio })

// Boot-Screen sanft ausblenden, sobald die Karte da ist. 'idle' gibt das
// schönste Timing (Kacheln gerendert); 'load' und ein absoluter Timeout sind
// Fallbacks, damit der Screen nie hängen bleibt (z.B. gedrosselter Hintergrund-Tab).
const boot = document.getElementById('boot')
if (boot) {
  let dismissed = false
  const dismissBoot = () => {
    if (dismissed) return
    dismissed = true
    boot.classList.add('gone')
    window.setTimeout(() => boot.remove(), 800)
  }
  map.once('idle', dismissBoot)
  map.once('load', dismissBoot)
  window.setTimeout(dismissBoot, 4000)
}

map.on('error', (e) => console.error('map error:', e.error?.message ?? e))

map.on('load', () => {
  const syncTrace = addRouteLayers(map, route)
  const rider = createRider(map, [start[0], start[1]], startMode)

  const ui = new UI(stops, route, filmTrack)
  // Die Uhrzeit auf der Foto-Karte gilt in der Zone der TOUR, nicht in der des
  // Betrachters (s. `UI.zeitzone`).
  ui.timeZone = cfg.time?.zone ?? null
  {
    const from = Date.parse(cfg.time?.start ?? '')
    const to = Date.parse(cfg.time?.end ?? '')
    ui.timeWindow = Number.isFinite(from) && Number.isFinite(to) ? [from, to] : null
  }
  /** Zählerstand der verworfenen Frames beim letzten Nachziehen (s. updateTrace). */
  let seenDropped = 0
  let camFollower: ((filmTime: number) => void) | null = null // Kamera-Keyframe-Folger (nur bei cfg.camera, s. unten)
  ui.updateTrace = (s, pos) => {
    syncTrace(s, [pos[0], pos[1]])
    rider.setLngLat([pos[0], pos[1]])
    // Tour-Audio und Kamera-Keyframes folgen der FILMSEKUNDE pro Frame (E10):
    // Musik-Bereiche + SFX-Kanten, Preset-Wechsel. istPlayback nur bei echter
    // Wiedergabe — Scrub-/Seek-Sprünge feuern keine SFX.
    //
    // `tour.filmS` und nicht `filmBeiS(s)`: Im Halt steht `s` still, der
    // Rückweg über die Achse lieferte dort die ganze Standzeit lang die
    // ANKUNFT (lower_bound). Genau die Sekunden, um die es hier geht, wären
    // damit unerreichbar — die Ankunft ist der Wert, den `f` schon hat.
    tourAudio?.setFilmS(tour.filmS, tour.playing && !tour.scrubbing)
    camFollower?.(tour.filmS)
    // Hat die Filmuhr Zeit VERWORFEN, lief der Ton auf der Wanduhr weiter und
    // der Film nicht — dann ist die Datei um genau diese Sekunden zu weit.
    // Der Notdeckel (1,0 s) greift bei gedrosseltem `rAF` ohne
    // `visibilitychange`: verdecktes Fenster, Kachel-Nachladen nach einem
    // Sprung, ein langsames Gerät unter Last. Gemessen in der Entwicklungs-Pane:
    // 29,4 s in zwei Frames — danach steht dieselbe Stelle der Tour an einer
    // ganz anderen Stelle des Stücks. Genau dann neu ausrichten; im Normalfall
    // zählt der Vergleich zweier Zahlen und sonst nichts.
    if (tour.clock.droppedFrames !== seenDropped) {
      seenDropped = tour.clock.droppedFrames
      afterJump()
    }
  }

  /**
   * Nach jedem SPRUNG den Ton auf die Filmsekunde nachziehen, an der der Film
   * jetzt steht (§6C, Etappe 3).
   *
   * Der Bereichs-EINTRITT allein genügt nicht: Wer innerhalb eines Musikstücks
   * scrubbt, tritt nicht neu ein — die Datei liefe einfach weiter und stünde bis
   * zum Bereichsende woanders als der Film. Nicht pro Frame, sondern am ENDE der
   * Geste: Während des Scrubs klingt die Musik (das Gate zählt Scrubben als
   * Wiedergabe), und ein Seek je Frame wäre ein Stottern statt einer Position.
   */
  const afterJump = () => tourAudio?.richteAus(tour.filmS)

  // Fahrzeug-Motorloop (dezent): folgt dem aktiven Segment-Modus, läuft nur während
  // der eigentlichen Fahrt (Gate unten). Moduswechsel blendet den Motor weich über.
  const vehicle = createVehicle('/audio')
  vehicle.setMode(startMode)
  window.__maptale.vehicle = vehicle
  ui.onModeChange = (mode) => {
    setRiderIcon(rider, mode)
    vehicle.setMode(mode)
  }

  const km = `${(route.total / 1000).toFixed(1)} km`
  const setGain = (hm: number) => {
    // Das Finale zeigt die Höhenmeter auch dann, wenn es keine gab — dort ist es
    // eine Bilanz der gefahrenen Tour und keine Ankündigung.
    $('final-gain').textContent = `${Math.round(hm)} hm`
    setStats(hm)
  }
  $('final-km').textContent = km
  setGain(route.gain)

  // Echte DEM-Höhen nachladen: korrigiert Höhenprofil, Telemetrie und
  // Höhenmeter — die Wegpunkt-Höhen sind nur der Startwert.
  const modeAtS = (s: number): TravelModeBoundary | undefined => {
    let cur = modes[0]
    for (const m of modes) if (m.s <= s + 1) cur = m
    return cur
  }
  window.__maptale.eleReady = sampleElevations(route.coords)
    .then((eles) => {
      const sm = smoothValues(eles, 9)
      route.coords.forEach((c, i) => (c[2] = sm[i] ?? c[2]))
      // Fähr-Abschnitte auf Meereshöhe klemmen: das DEM rauscht über der
      // Ostsee um einige Meter und würde Phantom-Höhenmeter aufsummieren
      route.coords.forEach((c, i) => {
        if (modeAtS(route.cum[i] ?? 0)?.mode === 'ferry') c[2] = 0
      })
      let gain = 0
      const cs = route.coords
      for (let i = 1; i < cs.length; i++) {
        const ahead = cs[i - 1]
        const now = cs[i]
        if (ahead && now && now[2] > ahead[2]) gain += now[2] - ahead[2]
      }
      route.gain = gain
      setGain(gain)
      ui.rebuildProfile()
      return 'dem'
    })
    .catch(() => 'fallback') // Offline o. Ä.: Profil bleibt bei Wegpunkt-Höhen

  map.dragPan.disable()
  map.scrollZoom.disable()
  map.doubleClickZoom.disable()
  map.touchZoomRotate.disable()
  map.touchPitch.disable()

  const tour = new Tour(map, route, stops, ui, {
    film: filmTrack,
    modes,
    showFinale: cfg.showFinale === true,
  })
  // `clock` ist die Filmuhr der Engine: Ihre Zähler (verworfene Sekunden,
  // Pausen, längstes Frame) sind der Blick darauf, was auf einem langsamen
  // Gerät tatsächlich passiert — sichtbar in der Konsole statt still.
  // `cardState` ist der Abnahme-Griff der Foto-Leinwand: Was auf ihr steht,
  // liegt sonst nirgends im DOM (s. scripts/messungen/kartenleinwand.mjs).
  Object.assign(window.__maptale, {
    tour,
    rider,
    clock: tour.clock,
    cardState: () => ui.cardFrame(),
  })
  // Export: Intro-Orbit stehen lassen. stelleExportFrame(ride) würde Anfang und
  // Ende abschneiden. Der Encoder snappt das erste Intro-Frame selbst.

  // — Kamera-Folger (Kreativbaukasten, cfg.camera): vom Autor gesetzte Preset-
  // Keyframes, beim Laden EINMAL in Filmsekunden übersetzt (E10) — aus `filmS`,
  // wo der Server es mitschreibt, sonst über die Filmachse aus `f`. Es gilt der
  // letzte Keyframe mit filmS <= tour.filmS (Punktfunktion wie die Modi); vor
  // dem ersten Keyframe bleibt der Player-Default. In Filmzeit und nicht in
  // Metern, weil ein Keyframe MITTEN in einem Halt sonst erst an dessen Kante
  // griffe — dort steht die Strecke, während der Film läuft.
  // Feuert NUR bei Preset-Änderung — setPreset klemmt glide, nie pro Frame rufen.
  // Ein manueller Klick auf einen Preset-Button schaltet den Folger dauerhaft aus
  // (bis Reload): der Nutzer hat das letzte Wort über die Kameradistanz.
  let camManual = false
  if (cfg.camera?.length) {
    const keyframes = cfg.camera
      .map((k) => ({
        filmTime: k.filmTime ?? filmTimeAtS(sAtF(k.f)),
        preset: k.preset,
        ...(k.scale !== undefined ? { scale: k.scale } : {}),
      }))
      .sort((a, b) => a.filmTime - b.filmTime)
    // Vor dem ersten Keyframe gilt der Player-Default — der ist beim Boot der
    // aktive Button (statisch „mittel"). Auch nach Rückwärts-Scrub/Restart.
    const defaultPreset =
      document.querySelector<HTMLElement>('.preset-btn.active')?.dataset.preset ?? 'mid'
    let camActive: string | null = null // zuletzt angewendete Preset+Skala-Kennung (gegen Dauer-Reapply)
    camFollower = (filmTime) => {
      if (exportMode || camManual) return
      // Lineare Suche reicht (≤100 Einträge) und übersteht Rückwärts/Sprünge
      let k: { filmTime: number; preset: string; scale?: number } | null = null
      for (const kf of keyframes) if (kf.filmTime <= filmTime) k = kf
      // `default` ist ein echter Keyframe-Wert und bedeutet dasselbe wie „vor
      // dem ersten Keyframe": zurück auf die Einstellung des Zuschauers. Ohne
      // diese Zeile fiele er in setPreset auf „mid" (PRESETS['default']
      // gibt es nicht) und überschriebe genau die Wahl, die er meint.
      const preset = k
        ? k.preset === 'default'
          ? defaultPreset
          : k.preset
        : camActive === null
          ? null
          : defaultPreset
      // Eine Feinjustierung gehört zu einem gewählten Abstand — auf „default"
      // angewandt verböge sie die Einstellung des Zuschauers.
      const scale = k && k.preset !== 'default' ? (k.scale ?? 1) : 1
      if (preset === null) return
      // Kennung aus Preset+Skala: eine reine Feinjustierung (gleiches Preset,
      // andere Skala) muss ebenfalls neu angewendet werden.
      const slug = `${preset}:${scale}`
      if (slug === camActive) return
      camActive = slug
      tour.setPreset(preset, scale)
      // Button-Zustand nachziehen (gleiches Muster wie der Klick-Handler unten)
      document.querySelector('.preset-btn.active')?.classList.remove('active')
      document.querySelector(`.preset-btn[data-preset="${preset}"]`)?.classList.add('active')
    }
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeWeather()
      $('options-modal').hidden = true
    }
  })

  // — Wetter-Dropdown (Regen/Gewitter) — live umschaltbar, unabhängig von Tag/Nacht. Das Overlay läuft in eigener Schleife, friert aber über das Gate
  // ein, sobald die Szene pausiert (stehende Kamera = stehender Regen). Kein Reload
  // wie bei der Ansicht-Radiogruppe: setMode wirkt sofort. Wahl + Stärke werden gemerkt.
  const weather = createWeather(document.body)
  // Animiert die Szene? Fahrt läuft, Nutzer scrubbt, oder eine Orbit-Phase dreht
  // (Intro/Finale drehen unabhängig von playing) — nur dann läuft auch das Wetter.
  //
  // `tour.uhr.laeuft` steht in JEDEM Gate dieser Seite, und das ist der Kern von
  // „eine Uhr": Die Ton-Schleifen haben eigene Timer (audiotracks.ts, music.ts),
  // sie laufen bewusst unabhängig von der Render-Schleife — und liefen deshalb
  // im Hintergrund-Tab weiter, während die Filmuhr stand. Nach einer Minute war
  // die Musik eine Minute voraus, dauerhaft (der Befund aus §4.1). Steht die
  // Uhr, steht der Ton; die Position hält er (audiotracks.ts: Pause INNERHALB
  // eines Bereichs setzt nicht zurück), also läuft er nach der Rückkehr genau
  // dort weiter, wo das Bild steht.
  // Und `tour.playing` steht daneben — OHNE `|| tour.scrubbing`. Das Scrubben ist
  // keine Wiedergabe, sondern ein Blättern: Wer angehalten hat und dann über die
  // Leiste zieht, hörte sonst Regen und Musik wieder anlaufen, obwohl der Film
  // steht (gemessen: `rain.mp3` und die Tour-Musik kamen beim Ziehen zurück und
  // verstummten beim Loslassen). Beim Ziehen WÄHREND der Wiedergabe ändert sich
  // nichts: Dort ist `playing` ohnehin wahr.
  const sceneAnimating = () =>
    tour.clock.running && (tour.playing || tour.phase === 'intro' || tour.phase === 'finale')
  weather.setGate(sceneAnimating)
  window.__maptale.weather = weather

  // Motorloop nur während der eigentlichen Fahrt: nicht im Foto-Stopp, Intro/Finale,
  // beim Scrubben oder in Pause (dort geht der Motor weich aus wie an einer Ampel).
  vehicle.setGate(
    () => tour.clock.running && tour.playing && !tour.scrubbing && tour.phase === 'ride',
  )
  const WEATHER_KEY = 'maptale:weather'
  const WEATHER_INT_KEY = 'maptale:weather-int'
  // Wetter-Stärke: drei UI-Stufen auf einer stufenlosen Skala (die API nimmt jedes
  // 0..1 — ein späteres Echtwetter kann feiner dosieren). Default Mittel.
  const WEATHER_INT: Record<string, number> = { light: 0.4, medium: 0.7, strong: 1 }
  let weatherInt = 'mid'
  const levelStrength = () => WEATHER_INT[weatherInt] ?? 0.7
  // Himmel je Wetter-Modus: Wolkendeckung als SPANNE über die Stärke — die
  // Atmosphäre formt daraus die Wolken selbst (locker → aufgerissen →
  // geschlossen). „Wolkig" spannt den ganzen Bogen: Leicht = einzelne Wolken
  // (Sonne frei), Mittel = aufgerissener Himmel, Stark = geschlossene Decke.
  //
  // Die Tabelle steht seit §10 in [weather-sky.ts](weather-sky.ts) und ist
  // mit dem Editor GETEILT: Dort wird aus denselben drei Zahlen ein flacher
  // Schleier über der Karte, hier gehen sie an Atmosphäre und Grading. Was
  // sich nicht teilen ließ, sind die Partikel — die sind Zustand, und der
  // Editor braucht eine Funktion (Konzept §10).
  const skyFor = (m: string, k: number) => skyAt(m as SceneWeather, k)
  let atmoWeather: (() => void) | null = null // () => atmo.setWeather(skyFor(...)), gesetzt sobald atmo existiert
  let groundSnow: (() => void) | null = null // () => dayNight.setSnow(...), gesetzt sobald die Tag/Nacht-Regie existiert
  const weatherBtn = $('btn-weather')
  const weatherMenu = $('weather-menu')
  const closeWeather = () => {
    weatherMenu.hidden = true
    weatherBtn.setAttribute('aria-expanded', 'false')
  }
  const openWeather = () => {
    weatherMenu.hidden = false
    weatherBtn.setAttribute('aria-expanded', 'true')
  }
  const syncWeatherUI = (m: string) => {
    weatherBtn.classList.toggle('active', m !== 'off') // aktiver Zustand am Button ablesbar
    weatherMenu.querySelectorAll<HTMLElement>('[data-weather]').forEach((el) => {
      const on = el.dataset.weather === m
      el.classList.toggle('on', on)
      el.setAttribute('aria-checked', String(on))
    })
    weatherMenu.querySelectorAll<HTMLElement>('[data-wlevel]').forEach((el) => {
      const on = el.dataset.wlevel === weatherInt
      el.classList.toggle('on', on)
      el.setAttribute('aria-checked', String(on))
    })
  }
  // — Auto-Wetter: echtes historisches Wetter (Open-Meteo + EXIF, autoweather.ts) —
  // Default-Modus; jede manuelle Wahl im Menü überschreibt ihn (und wird gemerkt).
  // Die Timeline lädt asynchron; bis dahin (und bei Fetch-Fehlern) bleibt es bei
  // „Kein Wetter". k ist im Auto-Modus stufenlos (dafür ist setIntensity gebaut).
  let weatherK = levelStrength() // wirksame Stärke (UI-Stufe bzw. Auto-Wert)
  let weatherAuto = false
  let wxTimeline: WeatherSample[] | null = null // sobald geladen
  let wxSegment: WeatherSample | null = null // zuletzt angewandter Timeline-Eintrag (gegen Dauer-Reapply)

  const applyWx = (m: string, k: number) => {
    weatherK = k
    weather.setIntensity(k)
    weather.setMode(m)
    atmoWeather?.()
    groundSnow?.()
  }
  const applyAutoNow = () => {
    const e = weatherAt(wxTimeline, tour.s)
    if (!e) {
      applyWx('off', levelStrength())
      return
    }
    if (wxSegment === e) return
    wxSegment = e
    applyWx(e.mode, e.k)
  }
  const applyWeather = (m: string, persist = true) => {
    weatherAuto = m === 'auto'
    if (weatherAuto) {
      wxSegment = null
      applyAutoNow()
    } else {
      applyWx(m, levelStrength())
    }
    syncWeatherUI(weatherAuto ? 'auto' : weather.mode)
    if (persist) {
      try {
        localStorage.setItem(WEATHER_KEY, weatherAuto ? 'auto' : weather.mode)
        localStorage.setItem(WEATHER_INT_KEY, weatherInt)
      } catch {
        /* Storage evtl. gesperrt */
      }
    }
  }
  // Beim Fahren die Abschnittsmitten überwachen (die Übergänge blenden weich in
  // wetter.ts/atmosphere.ts) — 0,8 s reichen, Wetter ändert sich gemächlich.
  // Zugleich den Wetter-Ton beim Finale („Ziel erreicht") ausblenden (nur der
  // Sound; die Regen-Partikel laufen im Orbit weiter) — kommt beim Neustart zurück.
  setInterval(() => {
    if (weatherAuto && wxTimeline) applyAutoNow()
    // Wetter-SFX folgt dem Audio-Master (Optionen) UND blendet beim Finale aus
    weather.setSoundEnabled(audioOn && tour.phase !== 'finale')
  }, 800)
  weatherMenu.querySelectorAll<HTMLElement>('[data-weather]').forEach((el) => {
    el.addEventListener('click', () => {
      applyWeather(el.dataset.weather ?? 'off')
      closeWeather()
    })
  })
  // Stärke-Umschalter (Leicht/Mittel/Stark): wirkt live auf den laufenden Modus,
  // Menü bleibt offen (man will die Wirkung direkt vergleichen)
  weatherMenu.querySelectorAll<HTMLElement>('[data-wlevel]').forEach((el) => {
    el.addEventListener('click', () => {
      const level = el.dataset.wlevel
      weatherInt = level && WEATHER_INT[level] ? level : 'mid'
      // Im Auto-Modus bleibt Auto aktiv (die Stärke kommt dort aus den Wetterdaten,
      // die Stufe greift erst wieder bei manueller Wahl)
      applyWeather(weatherAuto ? 'auto' : weather.mode)
    })
  })
  weatherBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    weatherMenu.hidden ? openWeather() : closeWeather()
  })
  document.addEventListener('click', (e) => {
    const target = e.target
    if (
      !weatherMenu.hidden &&
      target instanceof Node &&
      !weatherMenu.contains(target) &&
      target !== weatherBtn
    )
      closeWeather()
  })
  // Gemerkte Wetter-Wahl + Stärke wiederherstellen. OHNE gemerkte Wahl ist
  // AUTO der Default (echtes Wetter der Reise); „off" bleibt eine bewusste Wahl.
  try {
    const savedI = localStorage.getItem(WEATHER_INT_KEY)
    if (savedI && WEATHER_INT[savedI]) weatherInt = savedI
    const savedW = localStorage.getItem(WEATHER_KEY)
    if (savedW == null || savedW === 'auto') applyWeather('auto', false)
    else if (savedW in WEATHER_SKY && savedW !== 'off') applyWeather(savedW, false)
    else syncWeatherUI('off')
  } catch {
    syncWeatherUI('off')
  }

  // Foto-Wegpunkte + Startpunkt als GL-Layer auf der Karte
  const spotPoints: PinStop[] = stops.map((st) => {
    const pos = pointAt(route, st.s)
    // Für den Pin-Kopf (?pins3d=foto) reicht die Kachel-Fassung: Die Scheibe
    // ist gut hundert Pixel groß, das Foto in Anzeigegröße wäre reine Last.
    const head = st.items[0]
    return { lnglat: [pos[0], pos[1]], s: st.s, ele: pos[2], src: head?.thumb ?? head?.src }
  })
  const syncSpots = addSpotLayers(map, spotPoints, [start[0], start[1]], (s) => {
    tour.jumpToPhoto(s) // Wegpunkt-Klick öffnet das Foto direkt
    afterJump()
  })

  // Foto-Stopps stehen als 3D-PINS über dem Gelände (photopins.ts) — das ist der
  // Normalfall; die flachen Kreise klebten im Bergland am Hang und verschwanden hinter
  // jedem Grat. `?pins3d=0` schaltet auf sie zurück (A/B-Vergleich), `?pins3d=foto`
  // zeigt das Bild im Kopf statt der Nummer.
  // Der Startpunkt-Dot bleibt in beiden Fällen flach — er ist kein Halt.
  const pinsParam = params.get('pins3d')
  if (pinsParam === '0') {
    ui.registerSpots(syncSpots)
  } else {
    for (const l of ['spots-circle', 'spots-num']) map.setLayoutProperty(l, 'visibility', 'none')
    // Der Sync-Callback steht sofort, der Renderer kommt lazy nach (Three.js gehört
    // nicht ins Basis-Bundle) — bis dahin läuft er ins Leere.
    let pins: PinControl | null = null
    ui.registerSpots((s) => pins?.sync(s))
    import('./photopins.js').then(({ installPhotoPins }) => {
      pins = installPhotoPins(map, spotPoints, {
        onSelect: (s) => {
          tour.jumpToPhoto(s)
          afterJump()
        },
        variant: pinsParam === 'foto' ? 'foto' : 'nummer',
      })
      window.__maptale.pins = pins
      pins.sync(tour.s ?? 0)
    })
  }
  ui.syncDots(0)

  // — Steuerung —
  // Der Start-Knopf ist zugleich die Nutzergeste fürs Vollbild: Im mobilen
  // Browser nimmt das die Adressleiste weg, die im Querformat am meisten kostet.
  // Kann der Browser es nicht (altes iOS), passiert nichts weiter — die Tour
  // startet in jedem Fall. In der App-WebView ist ohnehin schon Vollbild, und am
  // Schreibtisch ist es unerwünscht (s. `fullscreenWanted`).
  $('btn-start').addEventListener('click', () => {
    tour.begin()
    if (!appMode && fullscreenWanted()) enterFullscreen()
  })
  $('btn-play').addEventListener('click', () => tour.setPlaying(!tour.playing))
  $('btn-replay').addEventListener('click', () => tour.restart())
  // Vom „Ziel erreicht“-Screen zurück ins Hauptmenü (wie der Dock-Menü-Knopf)
  $('btn-finale-menu').addEventListener('click', () => tour.toMenu())

  // — Hintergrundmusik (unaufdringlich, nahtlos geloopt) — läuft während der
  // Track-Animation (Fahrt/Foto), pausiert im Menü; per Dock-Knopf abschaltbar.
  // Beim Finale („Ziel erreicht") aus dem Gate → die Musik blendet über die
  // eingebaute ~2,5-s-Blende aus (kommt beim „Noch einmal erleben" wieder).
  // Bringt die Tour EIGENE Musik mit (cfg.audio), entfällt der Ambient-Loop —
  // der Musik-Schalter in den Optionen steuert dann die Tour-Musik (tourAudio).
  /**
   * Ton klingt NUR bei Tempo 1 vorwärts (E16).
   *
   * Der Editor hält diese Regel seit jeher („im Schnelllauf oder rückwärts
   * klänge sie wie ein durchgedrehter Kassettenrekorder", src/studio/playback.ts),
   * der Player nicht — und weil `shuttle` keinen Ausgleich auslöste, driftete
   * die Musik im Schnelllauf davon: Bei 8× vergehen acht Filmsekunden je
   * Wanduhrsekunde, die Datei kennt nur die eine. Mit dieser Regel braucht sie
   * keinen Ausgleich mehr — sie klingt dort nicht.
   */
  const speedOne = () => tour.mult === 1 && tour.dir > 0

  const music = hasOwnMusic ? null : createMusic('/audio/ambient.mp3')
  music?.setGate(
    () => tour.clock.running && speedOne() && tour.phase !== 'intro' && tour.phase !== 'finale',
  )
  window.__maptale.music = music

  // Tour-Audio-Gate: Musik läuft während Fahrt und Halt. Pause stoppt sie
  // sofort und hält die Abspielposition (audiotracks.ts); Bereichsgrenzen und
  // Menü/Finale blenden weich aus. Bewusst anders als music.ts — die eigene
  // Musik gehört zur SZENE, nicht zur App.
  // Ein `|| tour.phase === 'photo'` stand hier einmal und war genau der Fall,
  // in dem die Pause NICHT griff: Im Foto-/Video-Halt bleibt `playing` sonst
  // die einzige Auskunft darüber, ob der Film läuft — mit der Oder-Klausel lief
  // die Musik unter der angehaltenen Einblendung weiter und stand danach an
  // einer anderen Stelle als der Schnitt im Studio.
  //
  // Ein `|| tour.scrubbing` stand daneben und war dieselbe Sorte Ausnahme: Wer
  // angehalten hatte und dann über die Leiste zog, hörte die Musik wieder
  // anlaufen und beim Loslassen verstummen. Scrubben ist Blättern, keine
  // Wiedergabe — und beim Ziehen während der Wiedergabe trägt `playing`.
  tourAudio?.setGate(
    () =>
      tour.clock.running &&
      speedOne() &&
      tour.phase !== 'intro' &&
      tour.phase !== 'finale' &&
      tour.playing,
  )

  // Video mit Ton → laufende Musikspur crossfaden (Ambient und Tour-Musik).
  // Pegel 0..1 aus der Video-Hülle; Stärke am Plateau: VIDEO_DUCK in audiotracks.ts.
  ui.onVideoAudio = (envelope) => {
    music?.setDucking(envelope)
    tourAudio?.setDucking(envelope)
  }

  // — Optionen (Endnutzer): Ton (Master) · Musik · Wetter-Effekte —
  // Switches im Optionen-Dialog, Zustände in localStorage. „Ton" ist der Master über
  // ALLE Klänge (Motor, Musik, Wetter-SFX); „Musik" schaltet nur den Ambient-Loop;
  // „Wetter-Effekte" schaltet global zwischen Auto-Wetter (echt) und Aus.
  const MUSIC_KEY = 'maptale:music'
  const AUDIO_KEY = 'maptale:audio'
  let musicOn = true
  let audioOn = true
  try {
    musicOn = localStorage.getItem(MUSIC_KEY) !== 'off'
  } catch {
    /* Storage evtl. gesperrt */
  }
  try {
    audioOn = localStorage.getItem(AUDIO_KEY) !== 'off'
  } catch {
    /* Storage evtl. gesperrt */
  }
  // Im Export ist NICHTS hörbar: Der Ton der Datei wird offline aus `filmS`
  // gemischt (film-export.ts). Was hier klänge, wäre der Live-Graph — er liefe
  // auf der Wanduhr, während das Bild in Filmzeit entsteht, gehörte also zu
  // keiner Stelle des Films. Der Master deckt Motor, Musik und die Tour-Spuren
  // ab; der Wetter-Ton hängt am 800-ms-Tick darunter.
  if (exportMode) audioOn = false
  // Master wirkt auf Motor + Musik sofort; der Wetter-Ton hängt zusätzlich am 800-ms-Tick.
  // Tour-Audio: der Musik-Schalter steuert die Musik-Spuren, SFX hängen nur am Master.
  const applyAudio = () => {
    vehicle.setEnabled(audioOn)
    music?.setEnabled(audioOn && musicOn)
    tourAudio?.setMusikEnabled(audioOn && musicOn)
    tourAudio?.setSfxEnabled(audioOn)
  }
  applyAudio()

  const optAudio = $('opt-audio')
  const optMusic = $('opt-music')
  const optWeather = $('opt-weather')
  const setSwitch = (el: HTMLElement, on: boolean) => el.setAttribute('aria-checked', String(on))
  setSwitch(optAudio, audioOn)
  setSwitch(optMusic, musicOn)
  optAudio.addEventListener('click', () => {
    audioOn = !audioOn
    setSwitch(optAudio, audioOn)
    applyAudio()
    try {
      localStorage.setItem(AUDIO_KEY, audioOn ? 'on' : 'off')
    } catch {
      /* Storage evtl. gesperrt */
    }
  })
  optMusic.addEventListener('click', () => {
    musicOn = !musicOn
    setSwitch(optMusic, musicOn)
    applyAudio()
    try {
      localStorage.setItem(MUSIC_KEY, musicOn ? 'on' : 'off')
    } catch {
      /* Storage evtl. gesperrt */
    }
  })
  // Wetter-Effekte: an = Auto-Wetter (echt), aus = kein Wetter. Steuert dieselbe
  // Wetter-Logik wie das Dev-Menü (das Dev-Menü kann darüber hinaus feiner dosieren).
  const syncWeatherSwitch = () => setSwitch(optWeather, weather.mode !== 'off')
  syncWeatherSwitch()
  optWeather.addEventListener('click', () => {
    applyWeather(weather.mode === 'off' ? 'auto' : 'off')
    syncWeatherSwitch()
  })

  // Optionen-Dialog öffnen/schließen (Wetter-Switch beim Öffnen aktualisieren, falls
  // im Dev-Menü verstellt). Klick auf den abgedunkelten Hintergrund schließt.
  const optModal = $('options-modal')
  const openOptions = () => {
    syncWeatherSwitch()
    optModal.hidden = false
  }
  const closeOptions = () => {
    optModal.hidden = true
  }
  $('btn-options').addEventListener('click', openOptions)
  $('opt-close').addEventListener('click', closeOptions)
  optModal.addEventListener('click', (e) => {
    if (e.target === optModal) closeOptions()
  })

  // — Entwicklermodus — blendet Dev-Regler (Wetter-Palette, Kameradistanz) ein.
  // Aktivierung: ?dev=1 ODER Tippfolge „dev". Merker in localStorage, damit ein
  // Reload den Modus behält.
  const DEV_KEY = 'maptale:dev'
  let devOn = params.get('dev') === '1'
  try {
    devOn = devOn || localStorage.getItem(DEV_KEY) === '1'
  } catch {
    /* Storage evtl. gesperrt */
  }
  const setDev = (on: boolean) => {
    devOn = on
    document.body.classList.toggle('dev', on)
    try {
      localStorage.setItem(DEV_KEY, on ? '1' : '0')
    } catch {
      /* Storage evtl. gesperrt */
    }
  }
  setDev(devOn)
  let devSeq = ''
  window.addEventListener('keydown', (e) => {
    if (isTextField(e.target)) return
    devSeq = (devSeq + e.key).slice(-3).toLowerCase()
    if (devSeq === 'dev') {
      setDev(!devOn)
      toast(devOn ? 'Entwicklermodus an' : 'Entwicklermodus aus')
    }
  })

  const speedBtn = $('btn-speed')
  // Tempo-Label aus dem Tour-Zustand: Faktor + Richtung (−4× = 4× rückwärts).
  // Wird pro Stats-Tick aufgerufen, bleibt also auch nach JKL-Shuttle aktuell.
  let lastSpeed = 1
  ui.onSpeed = (mult, dir) => {
    const txt = `${dir < 0 ? '−' : ''}${mult}×`
    if (speedBtn.textContent !== txt) speedBtn.textContent = txt
    // Zurück auf Tempo 1: Der Ton hat den Schnelllauf STUMM verbracht (E16) und
    // steht deshalb dort, wo er beim Umschalten war — dieselbe Lage wie nach
    // einem Sprung. `onSpeed` läuft im 10-Hz-Takt der Telemetrie, ausgerichtet
    // wird nur an der Kante.
    const speed = dir * mult
    if (speed !== lastSpeed) {
      lastSpeed = speed
      if (speed === 1) afterJump()
    }
  }
  speedBtn.addEventListener('click', () => {
    tour.dir = 1 // Button ist ein Vorwärts-Tempo-Umschalter
    ui.onSpeed?.(tour.cycleSpeed(), tour.dir)
  })

  for (const btn of document.querySelectorAll<HTMLElement>('.preset-btn')) {
    btn.addEventListener('click', () => {
      camManual = true // manueller Eingriff: Kamera-Folger dauerhaft aus (to Reload)
      document.querySelector('.preset-btn.active')?.classList.remove('active')
      btn.classList.add('active')
      tour.setPreset(btn.dataset.preset ?? 'mid')
    })
  }

  // Tag/Nacht: Streckenanteil ↦ Pseudo-Uhrzeit ↦ Sonnenstand ↦ Szenenstimmung.
  // Aufgezeichnete Touren (M2) bringen timeline-Stützstellen mit — die Pseudo-
  // Uhr folgt dann dem echten Tempo (Pausen serverseitig komprimiert) statt
  // linear über die Strecke zu laufen; statische Touren bleiben linear.
  const time = cfg.time
  if (time) {
    const t0 = Date.parse(time.start)
    const t1 = Date.parse(time.end)
    // Auch die Pseudo-Zeit hängt an f: Ihre Stützstellen laufen durch dieselbe
    // Übersetzung, damit die Sonne dort steht, wo die Aufnahme sie gesehen hat.
    // `createTimeAt` bekommt sie in der Parametrisierung des Players, weil es
    // gegen `tour.s / route.total` befragt wird.
    const timeAt = createTimeAt(
      cfg.timeline?.map((e) => ({ f: fracAtF(e.f), t: e.t })),
      t0,
      t1,
    )
    const fmt = new Intl.DateTimeFormat('de-DE', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: time.zone,
    })
    const teleTime = $('tele-time')
    $('tele-time-wrap').hidden = false

    // Atmosphäre-Overlay (Horizont-Dunst, Sterne, Sonne + Lens-Flare): folgt der
    // Tour-Kamera pro Frame (tour.onPose).
    const atmo = createAtmosphere(document.body)
    atmo.setFov(map.transform?.fov ?? 36.87)
    // Echte (geclampte) Render-Kamera fürs Overlay — die Tour-Pose kennt MapLibres
    // maxPitch-Clamp nicht; ohne das säße die Sonne unter der gerenderten Horizontkante.
    atmo.setCamera(() => ({ pitch: map.getPitch(), bearing: map.getBearing() }))
    // DEM-Sonde: verdeckt nahes Gelände die Horizontlinie (Talkessel/Bergwand),
    // blendet die Atmosphäre ihre horizont-verankerten Ebenen (Dunst-Band, Glut) aus
    atmo.setTerrain((lng, lat) => map.queryTerrainElevation([lng, lat]))
    // Sonnenstand PRO FRAME exakt aus der Pseudo-Zeit (die Astronomie ist billig):
    // kein Drossel-Lag, keine Glättung im Overlay — Scrubben/Springen landet damit
    // IMMER auf exakt demselben Sonnenstand (Himmelsrichtung/Geografie/Jahreszeit echt
    // via sunPosition). Die Tag/Nacht-Regie drosselt nur noch die teuren Map-Paints.
    tour.onPose = (pose) => {
      const frac = Math.max(0, Math.min(1, tour.s / route.total))
      const date = new Date(timeAt(frac))
      const pos = pointAt(route, frac * route.total)
      const sun = sunPosition(date, pos[1], pos[0])
      atmo.setSun(sun)
      tour.setSun(sun) // Kamera-Himmel-Momente (skyLift/Yaw) folgen ohne Drossel-Lag
      atmo.render(pose)
    }
    window.__maptale.atmo = atmo
    // Wetter-Himmel jetzt an die Atmosphäre koppeln + den ggf. wiederhergestellten
    // Modus nachziehen (der Restore lief, bevor die Atmosphäre existierte).
    // Gleiches Pause-Gate wie das Partikel-Overlay: Wolken-Drift steht in der Pause.
    atmoWeather = () => atmo.setWeather(skyFor(weather.mode, weatherK))
    atmoWeather()
    atmo.setGate(sceneAnimating)

    const dayNight = createDayNight(
      map,
      // Pins und Atmosphäre der Tag/Nacht-Regie folgen lassen.
      // (atmo.setSun/tour.setSun laufen NICHT mehr hier — die Drossel machte den
      // Sonnenstand beim Scrubben pfadabhängig; beide werden pro Frame in onPose gesetzt.)
      (p) => {
        window.__maptale.pins?.applyDayNight(p) // 3D-Pins (?pins3d=1) nachts zurücknehmen
        atmo.setSky(p.hor, p.sky, p.fog) // Dunst an Horizont/Himmel/Fog der Tageszeit koppeln
      },
    )
    // Schneedecke aufs Satellitenbild koppeln (Stärke → Deckungsgrad); den ggf.
    // wiederhergestellten Schnee-Modus nachziehen (Restore lief vor der Regie)
    groundSnow = () =>
      dayNight.setSnow(
        weather.mode === 'snow' ? 0.3 + 0.7 * Math.max(0, (weatherK - 0.4) / 0.6) : 0,
      )
    groundSnow()
    // Auto-Wetter-Timeline laden (asynchron; braucht die Pseudo-Zeit dieser Tour).
    // Bei Fetch-Fehlern (offline, API weg) bleibt Auto still bei „Kein Wetter".
    // Kuratierte Wetter-Timeline der Tour (cfg.weather, km entlang der Route) hat
    // Vorrang vor dem Auto-Wetter — nötig, weil das ERA5-Archiv für manche Orte nie
    // ein Gewitter codiert (z.B. Koh Pha-ngan). Sonst echtes historisches Wetter.
    const curated: WeatherSample[] | null = cfg.weatherF
      ? cfg.weatherF.map((w) => ({ s: sAtF(w.f), mode: w.mode, k: w.k }))
      : cfg.weather
        ? cfg.weather.map((w) => ({ s: w.km * 1000, mode: w.mode, k: w.k }))
        : null
    const wxSource: Promise<WeatherSample[]> = curated
      ? Promise.resolve(curated.slice().sort((a, b) => a.s - b.s))
      : buildWeatherTimeline({ photos, route, time: time, pointAt })
    wxSource
      .then((tl) => {
        wxTimeline = tl
        window.__maptale.wxTimeline = tl
        if (weatherAuto) {
          wxSegment = null
          applyAutoNow()
        }
      })
      .catch((err: unknown) =>
        console.info('Auto-Wetter nicht verfügbar:', err instanceof Error ? err.message : err),
      )
    ui.onTick = (frac) => {
      const date = new Date(timeAt(frac))
      const pos = pointAt(route, frac * route.total)
      dayNight(date, [pos[0], pos[1]])
      teleTime.textContent = fmt.format(date)
    }
    ui.onTick(0) // Startstimmung sofort, nicht erst beim ersten Stats-Tick
  }

  // Dock-Höhe als CSS-Variable: mobil rückt die (Pflicht-)Attribution darüber
  const dockEl = $('dock')
  new ResizeObserver(() => {
    document.documentElement.style.setProperty('--dock-h', `${dockEl.offsetHeight}px`)
  }).observe(dockEl)

  // Timeline: Ziehen scrubbt wie im Video-Editor, Tippen springt. Auch die
  // Foto-Dots laufen über diesen Weg — Chromes Touch-Zielkorrektur legt den
  // Finger gern auf einen Dot, ein separater Dot-Handler würde Scrubs schlucken.
  // Tap ohne Bewegung auf einem Dot = Sprung kurz vor dessen Foto-Stopp.
  const progress = $('progress')
  /** Filmanteil unter dem Zeiger — die Leiste ist seit Etappe 5 die Zeitachse. */
  const filmFractionAt = (e: PointerEvent) => {
    const rect = progress.getBoundingClientRect()
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  }
  let scrubMoved = false
  let scrubDot: number | null = null
  let scrubDownX = 0
  progress.addEventListener('pointerdown', (e) => {
    scrubMoved = false
    const target = e.target
    scrubDot =
      target instanceof HTMLElement && target.classList.contains('photo-dot')
        ? Number(target.dataset.s)
        : null
    scrubDownX = e.clientX
    progress.setPointerCapture(e.pointerId)
    document.body.classList.add('scrubbing') // Scrub-Cursor, auch über den Dots
    tour.beginScrub(filmFractionAt(e))
  })
  progress.addEventListener('pointermove', (e) => {
    if (!tour.scrubbing) return
    if (!scrubMoved && Math.abs(e.clientX - scrubDownX) < 4) return // Tipp-Zittern ist kein Scrub
    scrubMoved = true
    tour.scrub(filmFractionAt(e))
  })
  progress.addEventListener('pointerup', (e) => {
    document.body.classList.remove('scrubbing')
    if (!tour.scrubbing) return
    if (!scrubMoved && scrubDot != null)
      tour.jumpToPhoto(scrubDot) // Dot-Tap: Foto sofort
    else tour.endScrub(filmFractionAt(e))
    afterJump()
  })
  progress.addEventListener('pointercancel', () => {
    document.body.classList.remove('scrubbing')
    // abgebrochene Gesten liefern keine brauchbaren Koordinaten mehr
    if (tour.scrubbing) {
      tour.endScrub(tour.filmS / filmTrack.totalS)
      afterJump()
    }
  })

  for (const dot of document.querySelectorAll<HTMLElement>('.photo-dot')) {
    dot.addEventListener('click', (e) => {
      e.stopPropagation()
      // Pointer-Gesten laufen über das Scrubbing oben — hier nur noch die
      // Tastatur-Aktivierung (Enter/Leertaste erzeugt click mit detail 0)
      if (e.detail === 0) {
        tour.jumpToPhoto(Number(dot.dataset.s))
        afterJump()
      }
    })
  }

  // Klick aufs Foto hält die Anzeige an und löst sie wieder. Ein „Weiter ▸"
  // daneben gab es bis zum 2026-08-18: Er sprang zur nächsten Aufnahme des
  // Halts und stammte aus der Zeit, als ein Halt auf der Fortschrittsleiste
  // keine Breite hatte — man kam gar nicht in ihn hinein. Seit die Leiste in
  // Filmzeit läuft, zieht man einfach durch. Was mit ihm entfallen ist: der
  // gezielte Sprung zur EINZELNEN Aufnahme eines Halts; den bekommt die Leiste
  // (docs/concepts/konzept_player_leiste_ui.md, „Was danach noch offen ist").
  $('photo-card').addEventListener('click', () => tour.togglePhotoHold())
  // Video-Stopp durchgelaufen: weiter wie nach einem abgelaufenen Foto-HOLD (M4)
  ui.onMediaEnded = () => tour.onMediaEnded()

  // Kino-Modus: Marke, Halt-Chip, Steuerleiste und Mauszeiger aus dem Bild (CSS: body.ui-clean)
  const setClean = (on: boolean) => document.body.classList.toggle('ui-clean', on)
  // Menü-Rücksprung (Dock, Finale-Button, Tourende ohne Endscreen) räumt den
  // Kino-Modus auf — ein Hook am Tour-Objekt, weil setClean erst hier entsteht.
  // Der Ton geht an beiden Schlüssen weich aus statt abrupt: Der Kopf steht am
  // Tour-Ende oft mitten in einem Musik-Bereich, und dort ist ein zugehendes Gate
  // sonst dasselbe wie die Pause-Taste — sofortiger Stopp mit gehaltener Position.
  const audioFadeOut = () => {
    tourAudio?.verklinge()
    music?.verklinge()
  }
  tour.onToMenu = () => {
    setClean(false)
    audioFadeOut()
  }
  tour.onFinale = audioFadeOut

  // — Auto-Rückzug der Bedienelemente (jede Zeigerart) —
  // Wie in einem Videoplayer: während der FAHRT zieht sich die UI nach kurzer Ruhe
  // zurück und ist bei der nächsten Regung — Mausbewegung, Tipp, Tastendruck —
  // sofort wieder da. Deshalb braucht es keinen Knopf zum Ein-/Ausblenden: er war
  // ein Griff für etwas, das ohne Zutun passiert (und selbst ein Element im Bild).
  const IDLE_MS = 3200
  // `:hover` nur dort befragen, wo es einen echten Zeiger gibt: auf Touch bleibt die
  // Pseudoklasse nach einem Tipp am getippten Element HÄNGEN — die Steuerleiste zöge
  // sich nach dem ersten Tipp auf Play dann nie mehr zurück.
  const hasPointer = window.matchMedia('(hover: hover)').matches
  let idleTimer = 0
  const scheduleIdle = () => {
    window.clearTimeout(idleTimer)
    idleTimer = window.setTimeout(() => {
      // Bei Pause, Intro und Finale gehören die Bedienelemente auf den Schirm —
      // dann später erneut prüfen statt den Rückzug zu vergessen. Ebenso,
      // solange die Maus auf der Steuerleiste liegt: was man gerade anvisiert
      // (Timeline, Tempo, Optionen), darf nicht unter dem Zeiger wegblenden.
      // Ebenso, solange das Kartendaten-Popup offen steht (body.attribution-open,
      // map-attribution.ts): der Text blendete sonst weg, während man ihn liest.
      //
      // **Der HALT zählt seit E17 dazu.** Vorher stand hier `phase === 'ride'`,
      // die Leiste blieb also für die ganze Standzeit oben — unter der alten
      // Schichtung unsichtbar (die Karte lag darüber), seit sie oben liegt der
      // Normalfall: Sie deckte die Bildunterschrift samt „Weiter" zu. Das ist
      // dieselbe Lehre wie bei E13 — ein Halt ist ein Zustand der Kurve, kein
      // anderer Betriebsmodus: Was zählt, ist, ob der FILM läuft.
      const idle =
        tour.playing && (tour.phase === 'ride' || tour.phase === 'photo' || tour.phase === 'moment')
      const captured =
        (hasPointer && dockEl.matches(':hover')) ||
        document.body.classList.contains('attribution-open')
      if (idle && !captured) setClean(true)
      else scheduleIdle()
    }, IDLE_MS)
  }
  const wakeUi = () => {
    if (document.body.classList.contains('ui-clean')) setClean(false)
    scheduleIdle()
  }
  // Nur ECHTE Zeigerbewegung weckt: Browser schicken pointermove auch ohne
  // Handbewegung, wenn sich der Inhalt unter dem stehenden Zeiger ändert — und das
  // tut er hier pro Frame. Ohne den Koordinaten-Vergleich käme die UI nie zur Ruhe.
  // Die 6-px-Schwelle schluckt zusätzlich das Zittern auf dem Trackpad.
  let zx = -1
  let zy = -1
  document.addEventListener(
    'pointermove',
    (e) => {
      if (Math.abs(e.clientX - zx) + Math.abs(e.clientY - zy) < 6) return
      zx = e.clientX
      zy = e.clientY
      wakeUi()
    },
    { passive: true },
  )
  document.addEventListener('pointerdown', wakeUi, { passive: true })
  document.addEventListener('keydown', wakeUi, { passive: true })
  scheduleIdle()

  // Kein Menü-Knopf mehr in der Steuerleiste: der Weg hinaus steht dauerhaft oben
  // links und führt dorthin, wo man herkam. Zum Startscreen DIESER Tour führt
  // weiterhin das Finale („Zum Hauptmenü") — tour.toMenu() bleibt.

  // Player verlassen (nur im App-Modus sichtbar): die Android-App stellt dafür
  // eine Brücke bereit (PlayerScreen.kt, @JavascriptInterface). Fehlt sie — etwa
  // weil jemand ?app=1 im normalen Browser aufruft —, bleibt der History-Rückweg.
  $('btn-app-back').addEventListener('click', () => {
    if (window.MaptaleApp?.exit) window.MaptaleApp.exit()
    else history.back()
  })

  // — Kurzmeldung unten („Toast") — für Dinge, die der Nutzer wissen muss, ohne
  // dass sie den Ablauf anhalten (z. B. eine nicht ladbare Server-Tour).
  const toastEl = $('toast')
  let toastT = 0
  const toast = (msg: string) => {
    toastEl.textContent = msg
    toastEl.hidden = false
    window.clearTimeout(toastT)
    toastT = window.setTimeout(() => (toastEl.hidden = true), 5200)
  }

  // Konnte eine Server-Tour nicht geladen werden (gelöscht, noch in
  // Verarbeitung, Server weg), läuft die Standard-Tour — das dem Nutzer
  // sichtbar sagen, nicht nur der Konsole.
  if (remoteError) toast(remoteError)

  // — Bildraten-Protokoll (?app=1 oder ?fps=1) —
  // Android-WebView: zeigt die HTML-Seite direkt an, leitet console.log/info/
  // console-Ausgaben aber ins Logcat (Tag „MaptalePlayer"). So lässt sich die
  // Framerate auch auf dem Gerät ohne Remote-Debugging prüfen:
  //   adb logcat -s MaptalePlayer | grep fps
  if (appMode || params.get('fps') === '1') {
    let images = 0
    let viewport = performance.now()
    const count = () => {
      images++
      const now = performance.now()
      if (now - viewport >= 3000) {
        const fps = (images * 1000) / (now - viewport)
        console.info(
          `[maptale] fps ${fps.toFixed(1)} · ${innerWidth}×${innerHeight} @${devicePixelRatio} · Phase ${tour.phase}`,
        )
        images = 0
        viewport = now
      }
      requestAnimationFrame(count)
    }
    requestAnimationFrame(count)
  }

  // Tastatursteuerung des Players (wie in Videoschnitt-Software)
  window.addEventListener('keydown', (e) => {
    if (exportMode) return
    // In Textfeldern (z. B. Google-Key-Dialog) nichts abfangen
    if (isTextField(e.target)) return
    if (tour.phase === 'intro') return // vor dem Start hat der Player keine Tasten

    switch (e.code) {
      case 'Space': // Start/Stopp
        e.preventDefault()
        tour.setPlaying(!tour.playing)
        break
      // Kein 'KeyH' mehr: die UI blendet selbst aus, und JEDER Tastendruck weckt
      // sie (weckeUi hängt am keydown) — ein Umschalter hätte sich sofort selbst
      // widerrufen.
      case 'ArrowRight': // ein Bild vor (Shift: 12 Bilder)
        e.preventDefault()
        tour.nudge(e.shiftKey ? 12 : 1)
        afterJump()
        break
      case 'ArrowLeft': // ein Bild zurück
        e.preventDefault()
        tour.nudge(e.shiftKey ? -12 : -1)
        afterJump()
        break
      case 'KeyL': // JKL: vorwärts (nochmal = schneller)
        e.preventDefault()
        tour.shuttle(1)
        break
      case 'KeyJ': // JKL: rückwärts (nochmal = schneller)
        e.preventDefault()
        tour.shuttle(-1)
        break
      case 'KeyK': // JKL: anhalten
        e.preventDefault()
        tour.mult = 1
        tour.dir = 1
        tour.setPlaying(false)
        break
    }
  })

  // Video-Export: ganze Tour, Intro/Fahrt/Finale, Ton aus filmS.
  if (exportMode) {
    void (async () => {
      const {
        buildExportStatus,
        runFilmExport,
        isOwnReadyTour,
        engineLoopSource,
        ENGINE_GAIN,
        weatherLoopSource,
        audioClipsFromTracks,
      } = await import('./film-export.js')
      // Im Rahmen (Studio-Blatt) gibt es kein Stand-Schild: Der Balken steht
      // eine Ebene höher, und zwei Fortschrittsanzeigen übereinander wären
      // eine zu viel.
      const inFrame = isEmbedded(location.search) && window.parent !== window
      const status = inFrame ? undefined : buildExportStatus()
      const report = inFrame
        ? (m: ExportMessage, handover?: Transferable[]): void => {
            window.parent.postMessage(m, location.origin, handover ?? [])
          }
        : undefined
      const list = await loadServerTours()
      if (!remoteCfg || !isOwnReadyTour(tourParam, list)) {
        const set = 'Export nur für eigene, fertige Touren.'
        if (status) status.textContent = set
        report?.({ type: EXPORT_MESSAGE, status: 'fehler', text: set })
        return
      }
      applyWeather('auto', false)
      const to = Date.now() + 8000
      while (!wxTimeline && Date.now() < to) await new Promise((r) => window.setTimeout(r, 200))

      const rideS = tour.film.totalS
      const introS = EXPORT_INTRO_S
      const clipS = exportClipDurationS(rideS, tour.showFinale)
      // Dieselbe Bildrate wie der Encoder: Die Ton-Abschnitte werden über
      // dieselben Bilder verdichtet, mit denen das Bild entsteht.
      const n = frameCount(clipS, exportFormat.fps)
      const dt = 1 / exportFormat.fps
      const master = cfg.audioGain ?? CURATED_GAIN
      const fromTracks = audioClipsFromTracks(audioTracks ?? [], introS, rideS, master)
      if (!hasOwnMusic) {
        fromTracks.clips.push({
          src: '/audio/ambient.mp3',
          fromClipS: introS,
          toClipS: introS + rideS,
          fileFromS: 0,
          loop: true,
          gain: 0.16,
        })
      }
      const engineAbs = mergeSegments(n, dt, (i) => {
        const t = i * dt
        if (t < introS || t >= introS + rideS) return null
        const filmTime = Math.min(rideS, t - introS)
        if (tour.film.stopAtFilmTime(filmTime)) return null
        const s = tour.film.sAtFilmTime(filmTime)
        const src = engineLoopSource(tour.film.travelModeAtS(s))
        return src ? { src, gain: ENGINE_GAIN } : null
      })
      const weatherAbs = mergeSegments(n, dt, (i) => {
        const t = i * dt
        if (t >= introS + rideS) return null
        const filmTime = t < introS ? 0 : Math.min(rideS, t - introS)
        const s = tour.film.sAtFilmTime(filmTime)
        const e = weatherAt(wxTimeline, s)
        if (!e) return null
        return weatherLoopSource(e.mode, e.k)
      })
      const clips = [
        ...fromTracks.clips,
        // Motor und Wetter kommen als Abschnitte aus der Achse; die Nähte
        // blenden, wie sie es im Player tun (vehicle.ts ~0,7 s, wetter.ts
        // koppelt an die Intensität). Hart geschnitten knackt jede Kante.
        ...engineAbs.map((a) => ({
          src: a.src,
          fromClipS: a.fromClipS,
          toClipS: a.toClipS,
          fileFromS: 0,
          loop: true,
          gain: a.gain,
          fadeS: 0.35,
        })),
        ...weatherAbs.map((a) => ({
          src: a.src,
          fromClipS: a.fromClipS,
          toClipS: a.toClipS,
          fileFromS: 0,
          loop: true,
          gain: a.gain,
          fadeS: 0.6,
        })),
      ]

      await runFilmExport({
        map,
        tour,
        title: remoteCfg.brandTitle || cfg.kicker,
        format: exportFormat,
        ...(status ? { status: status } : {}),
        ...(report ? { report: report } : {}),
        extraSources: MAP_EXTRA_SOURCES,
        tab: rider,
        ...(window.__maptale.eleReady ? { elevationReady: window.__maptale.eleReady } : {}),
        audio: { clips: clips, oneShots: fromTracks.oneShots },
        prepareOverlays: () => {
          // Die Gates fragen sonst `tour.uhr.laeuft`/`playing` — im Export läuft
          // die Wanduhr nicht, gemeint ist aber „der Film läuft".
          weather.setGate(() => true)
          window.__maptale.atmo?.setGate(() => true)
          // Und beide auf FILMzeit: sonst bekämen Partikel, Böen, Wolkendrift
          // und die Wetter-Blende pro Filmbild die 0,3–2 s Wandzeit, die das
          // Warten auf die Kacheln gekostet hat (Konzept §8, „Zeit").
          weather.externerTakt(true)
          weather.setSoundEnabled(false) // der Mix kommt offline aus filmS
          window.__maptale.atmo?.setzeTakt(1 / exportFormat.fps)
          window.dispatchEvent(new Event('resize'))
        },
        stepOverlays: (dt) => weather.schritt(dt),
        afterCamera: () => {
          if (wxTimeline) applyAutoNow()
        },
        cardReady: () => ui.cardReady(),
      })
    })()
  }
})

/** Tastendrücke in Eingabefeldern gehören dem Feld, nicht dem Player. */
function isTextField(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
  )
}
