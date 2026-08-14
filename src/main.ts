import 'maplibre-gl/dist/maplibre-gl.css'
import './style.css'
import type { Map as MapLibreKarte, Marker } from 'maplibre-gl'
import { TOURS, type Ankerpunkt, type TourAudio, type TourZeit, type Wegpunkt } from './tours.js'
import { loadRemoteTour, createTimeAt, type RemoteTourCfg } from './remote.js'
import { tourAusPfad, tourPfad } from './routen.js'
import { buildRoute, dist, gruppiereStopps, nearestS, pointAt, type Route } from './geo.js'
import { klipDauerS, standzeitS } from './einblendung.js'
import {
  baueFilmachse,
  filmBeiStrecke,
  haltBeiFilm,
  interpoliere,
  modusMischung,
  momentHaltS,
  streckeBeiFilm,
  type Filmachse,
  type Streckenhalt,
} from './filmachse.js'
import { baueSBeiF } from './streckenanker.js'
import { createMap, addRouteLayers, createRider, setRiderIcon, addSpotLayers } from './map.js'
import { createDayNight } from './daynight.js'
import { sunPosition } from './sun.js'
import { createAtmosphere, type Atmosphaere } from './atmosphere.js'
import { createWeather, type Wetteroverlay } from './weather.js'
import { createMusic, type Hintergrundmusik } from './music.js'
import { createAudioTracks, KURATIERTER_PEGEL, type AudioSpuren } from './audiotracks.js'
import { createVehicle, type Fahrzeugton } from './vehicle.js'
import { buildWeatherTimeline, weatherAt } from './autoweather.js'
import { sampleElevations, smoothValues } from './elevation.js'
import { UI, $, type PlayerMedium } from './ui.js'
import { Tour, mischeSkala, skalaFuer, type Filmspur, type KameraMoment, type ModusGrenze, type Spielhalt } from './tour.js'
import type { Filmuhr } from './filmuhr.js'
import type { PinStopp, PinSteuerung } from './photopins.js'

/**
 * Was der Verdrahter aus einer Tour liest — das SUBSET, in dem sich die
 * mitgelieferte `TourConfig` (src/tours.ts) und die aufgezeichnete
 * `RemoteTourCfg` (src/remote.ts) treffen. Bewusst keine dritte „Wahrheit"
 * fürs Tour-Format: Was hier fehlt, fasst diese Datei nicht an.
 */
interface SpielerFoto {
  src: string
  title: string
  caption: string
  anchor: Ankerpunkt
  /** Aufgezeichnete Touren bringen den Zeitstempel mit (Auto-Wetter spart das EXIF) */
  takenAt?: string
  type?: 'photo' | 'video'
  durationS?: number
  poster?: string
  thumb?: string
  display?: { holdS?: number; kenBurns?: boolean }
}

interface SpielerSegment {
  /** Freie Zeichenkette: Server-Segmente sind nicht auf `Modus` eingeschränkt */
  mode: string
  label?: string
  pts: Wegpunkt[]
  /**
   * Streckenanteil je Punkt, vom Server auf der ROHEN Geometrie gemessen (E11).
   * Kuratierte TOURS haben ihn NIE — sie sind eine Datei mit Wegpunkten, keine
   * Aufzeichnung; für sie bleibt es dauerhaft beim Rückfall `f × route.total`.
   */
  f?: number[]
}

interface SpielerTour {
  kicker: string
  titleHtml: string
  stops: string[]
  finaleTitle: string
  showFinale?: boolean
  /** Ohne `time` bleibt die Tag/Nacht-Regie (und damit die Atmosphäre) aus */
  time?: TourZeit
  segments: SpielerSegment[]
  photos: SpielerFoto[]
  /** Kuratierte Wetter-Timeline (km entlang der Route) — schlägt das Auto-Wetter */
  weather?: Array<{ km: number; mode: string; k: number }>
  /** Dasselbe aus dem Tour-JSON, aber f-verankert (remote.ts) — geht vor */
  weatherF?: Array<{ f: number; mode: string; k: number }>
  timeline?: Array<{ f: number; t: string }>
  /** `filmS` (E10) geht `f` vor — s. Kamera-Folger unten */
  camera?: Array<{ f: number; preset: string; skala?: number; filmS?: number }>
  /** `filmS` bleibt hier ungelesen: Ein Moment IST ein Halt (s. unten) */
  moments?: Array<{ f: number; art: string; dauerS?: number; filmS?: number }>
  audio?: TourAudio[]
  /** Master über `audio`; fehlt = KURATIERTER_PEGEL (s. TourConfig.audioPegel) */
  audioPegel?: number
}

/** Ein Foto mit seiner Verankerung an der Route (`s` aus nearestS). */
type VerankertesFoto = SpielerFoto & PlayerMedium

/** Wetter-Stützstelle in Streckenmetern — kuratiert (cfg.weather) oder automatisch. */
interface WetterStuetze {
  s: number
  mode: string
  k: number
}

/**
 * Debug-Handles am Fenster (`window.__j`). Sie sind kein API-Vertrag, sondern
 * der Zugriff auf die laufenden Teile in der Konsole — deshalb ist alles
 * optional, was erst im Laufe des Bootens entsteht.
 */
interface PlayerDebug {
  map?: MapLibreKarte
  route?: Route
  tourAudio?: AudioSpuren | null
  vehicle?: Fahrzeugton
  tour?: Tour
  /** Filmuhr der Engine samt Zählern (verworfene Zeit, Pausen, längstes Frame) */
  uhr?: Filmuhr
  /**
   * Woher die f→s-Übersetzung kommt: `tabelle` (Wegpunkt-`f` aus dem Tour-JSON)
   * oder `rueckfall` (`f × route.total`). Bei kuratierten Touren ist der
   * Rückfall der Normalfall — bei einer aufgezeichneten ein Datenfehler, der
   * sich sonst als „alles wie früher" tarnt.
   */
  anker?: 'tabelle' | 'rueckfall'
  /**
   * Die Filmachse dieser Tour (Strecke → Filmzeit). Sie treibt den Player noch
   * nicht an (Etappe 4), der Ton hängt aber schon an ihr — und zum Nachmessen
   * braucht es beides: die Achse und die Auswertung `filmS(s)`.
   */
  filmachse?: Filmachse
  filmS?: (s: number) => number
  rider?: Marker
  weather?: Wetteroverlay
  music?: Hintergrundmusik | null
  atmo?: Atmosphaere
  pins?: PinSteuerung
  /** 'dem' sobald die echten Höhen greifen, 'fallback' wenn der Fetch scheiterte */
  eleReady?: Promise<string>
  wxTimeline?: WetterStuetze[]
}

declare global {
  interface Window {
    __j: PlayerDebug
    /** Brücke der Android-App (PlayerScreen.kt, @JavascriptInterface) */
    MaptaleApp?: { verlassen?: () => void }
  }
}

// Das Objekt entsteht VOR dem ersten Eintrag. Vorher wurde es erst beim
// Karten-Aufbau angelegt — `window.__j.anker = …` lief davor und warf
// `Cannot set properties of undefined`, was das ganze Modul abbrach; und selbst
// ohne den Fehler hätte das spätere `window.__j = { … }` alles Frühere wieder
// weggeworfen. Deshalb wird ab hier nur noch ERGÄNZT.
window.__j = {}

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
const ausPfad = tourAusPfad(location.pathname)
const tourParam = ausPfad ?? params.get('tour') ?? 'kohphangan'

// — App-Modus (?app=1): der Player läuft in der WebView der Android-App —
// Dort sind Verweise auf die Landing-Seite sinnlos (es gibt keine „Startseite",
// aus der man käme) und die Tour-Auswahl überflüssig — gewählt wird in der
// Tourliste der App bzw. im Studio. body.app blendet beides aus (style.css).
const appModus = params.get('app') === '1'
if (appModus) document.body.classList.add('app')

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
// stimmen dagegen — also entscheidet JS, und das CSS hängt an body.kompakt-quer.
const KOMPAKT_HOEHE = 560 // darüber ist auch quer genug Platz für das Normal-Layout
const setzeViewportHoehe = () => {
  const h = window.visualViewport?.height || window.innerHeight
  if (h > 0) document.documentElement.style.setProperty('--vh-app', `${Math.round(h)}px`)
  const quer = window.innerWidth > window.innerHeight && window.innerHeight <= KOMPAKT_HOEHE
  document.body.classList.toggle('kompakt-quer', quer)
}
setzeViewportHoehe()
window.addEventListener('resize', setzeViewportHoehe)
window.addEventListener('orientationchange', setzeViewportHoehe)
window.visualViewport?.addEventListener('resize', setzeViewportHoehe)
// Sicherheitsnetz: ein ResizeObserver meldet Größenänderungen auch dort, wo kein
// resize-Event ankommt (WebViews, eingebettete Ansichten) — sonst bliebe nach
// einer Drehung das Layout des vorherigen Formats stehen.
new ResizeObserver(setzeViewportHoehe).observe(document.documentElement)
let remoteCfg: RemoteTourCfg | null = null
let remoteFehler: string | null = null // Meldung fürs Toast, sobald die UI steht (Fallback lief)
if (tourParam.startsWith('srv:')) {
  remoteCfg = await loadRemoteTour(tourParam.slice('srv:'.length)).catch((err: unknown) => {
    remoteFehler = err instanceof Error ? err.message : String(err)
    console.error('Remote-Tour nicht ladbar:', remoteFehler)
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
const cfg: SpielerTour = remoteCfg ?? (TOURS as Record<string, SpielerTour>)[tourId] ?? TOURS.kohphangan

// Wer über die Alt-Adresse `?tour=…` kam, bekommt die Adresszeile auf die
// heutige Form gezogen — wie die Profilseite mit `?id=…`. Erst HIER, nicht
// gleich beim Lesen: Scheiterte das Laden, stünde sonst eine Adresse in der
// Zeile, die auf eine Tour zeigt, die gar nicht läuft. Der Rest der Query
// (`?app=1`, `?dev=1`, …) bleibt unangetastet, und `replaceState` legt
// keinen Eintrag in die Verlaufsliste — der Weg zurück bleibt, wo er war.
if (!ausPfad && params.has('tour')) {
  const rest = new URLSearchParams(location.search)
  rest.delete('tour')
  const query = rest.toString()
  history.replaceState(null, '', tourPfad(tourId) + (query ? `?${query}` : '') + location.hash)
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
const segsSrc: SpielerSegment[] = reverse
  ? cfg.segments
      .slice()
      .reverse()
      .map((seg) => ({ ...seg, pts: seg.pts.slice().reverse(), ...(seg.f ? { f: seg.f.slice().reverse() } : {}) }))
  : cfg.segments

// Segmente zu einer Wegpunktliste verbinden (Nahtpunkte dedupen)
const waypoints: Wegpunkt[] = []
// Parallel dazu das `f` je Wegpunkt — dieselbe `slice(1)`-Regel, sonst trägt ab
// dem zweiten Segment jeder Wegpunkt das f seines Nachbarn. Fehlt EINEM Segment
// die Liste (oder hat sie eine andere Länge als seine Punkte), gibt es keine
// Tabelle: eine halbe wäre schlimmer als keine.
const wegpunktF: number[] = []
let fVollstaendig = true
for (const seg of segsSrc) {
  const erster = waypoints.length === 0
  waypoints.push(...(erster ? seg.pts : seg.pts.slice(1)))
  if (seg.f?.length === seg.pts.length) wegpunktF.push(...(erster ? seg.f : seg.f.slice(1)))
  else fVollstaendig = false
}
const route = buildRoute(waypoints)

// Die eine Übersetzung, durch die JEDER f-Anker dieser Tour geht (§8D). Danach
// rechnet der Player nur noch in Metern — es gibt bewusst keine Tabelle zurück.
const sBeiF = baueSBeiF(fVollstaendig ? wegpunktF : null, route.wpS, route.total)
window.__j.anker = sBeiF.quelle
// Für die zwei Verbraucher, die (noch) in Anteilen rechnen: audiotracks.ts
// vergleicht `f0 <= frac < f1` gegen `s / route.total` und ist mit dem Studio
// GETEILT (Etappe 4b stellt beide zugleich auf Filmsekunden um), createTimeAt
// interpoliert seine Stützstellen in f. Beide bekommen deshalb keinen Meter,
// sondern ihre Anker in der Parametrisierung des Players — dieselbe Korrektur,
// nur am Ende wieder durch `total` geteilt.
const fracBeiF = (f: number) => sBeiF(f) / route.total

// Streckenmeter des Segment-Anfangs; ein Segment ohne Punkte gibt es in gültigen
// Daten nicht (der Fallback vermeidet nur die Ausnahme im Verdrahter).
const segmentStart = (r: Route, seg: SpielerSegment) => {
  const p0 = seg.pts[0]
  return p0 ? nearestS(r, p0) : 0
}

// Modus-Grenzen. Vorwärts: sauber via nearestS je Segment-Startpunkt. Rückwärts:
// die VORWÄRTS-Grenzen an der Streckenmitte spiegeln — nearestS auf reversierte
// Segment-Nähte ist mehrdeutig (Inseln wie Fjäderholmarna liegen nah an der
// Stadtstrecke → die Fähre würde über die halbe Route „auslaufen").
let modes: ModusGrenze[]
if (reverse) {
  const fwdWp: Wegpunkt[] = []
  for (const seg of cfg.segments) fwdWp.push(...(fwdWp.length ? seg.pts.slice(1) : seg.pts))
  const fwdRoute = buildRoute(fwdWp)
  const T = fwdRoute.total
  const fwd = cfg.segments.map((seg) => ({ s: segmentStart(fwdRoute, seg), mode: seg.mode, label: seg.label ?? seg.mode }))
  const erst = fwd[0]
  if (erst) erst.s = 0
  const bounds = fwd.map((m) => m.s).concat([T]) // [0, s1, …, T] — Segment-Intervalle
  const scale = route.total / T // reversierte Route ist minimal anders lang
  modes = fwd
    .map((m, i) => ({ s: (T - (bounds[i + 1] ?? T)) * scale, mode: m.mode, label: m.label }))
    .sort((a, b) => a.s - b.s)
} else {
  modes = cfg.segments.map((seg) => ({ s: segmentStart(route, seg), mode: seg.mode, label: seg.label ?? seg.mode }))
}
const ersteGrenze = modes[0]
if (ersteGrenze) ersteGrenze.s = 0
const startModus = ersteGrenze?.mode ?? 'bike'
const photos: VerankertesFoto[] = cfg.photos
  .map((p) => ({ ...p, s: nearestS(route, p.anchor) }))
  .sort((a, b) => a.s - b.s)
// Fotos mit nahe beieinanderliegenden Ankern zu einem Stopp gruppieren —
// dort werden sie nacheinander gezeigt (ein Halt, mehrere Bilder)
const stops = gruppiereStopps(photos)
// Kamera-Momente (Kreativbaukasten): Punkt-Ereignisse, f → Streckenmeter s.
// Die Engine hält dort an und führt eine Kamerabewegung aus (src/tour.ts).
//
// Als einziges Ereignis bleibt der Moment an `f` verankert, obwohl das Tour-JSON
// seit E10 auch für ihn eine Filmsekunde trägt: Ein Moment IST ein Halt, und die
// Achse wird AUS den Halten gebaut — ihn über sie zu verorten wäre ein Kreis. Ein
// Ort auf der Strecke ist er nicht nur wegen der Kamerabewegung, sondern weil
// genau das seine Filmsekunde überhaupt erst erzeugt. Das Feld im JSON ist die
// Auskunft, WANN er im Film liegt, kein Eingang für den Player.
const moments: KameraMoment[] = (cfg.moments ?? [])
  .map((m) => ({ s: sBeiF(m.f), art: m.art, dauerS: m.dauerS }))
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
const rohKum: number[] = [0]
for (let i = 1; i < waypoints.length; i++) {
  rohKum.push((rohKum[i - 1] as number) + dist(waypoints[i - 1] as Wegpunkt, waypoints[i] as Wegpunkt))
}
const rohGesamt = rohKum[rohKum.length - 1] ?? 0
/** Wegstand auf der GEBAUTEN Route → roher Wegstand (die Achse rechnet in diesen). */
const rohBeiS = (s: number) => interpoliere(route.wpS, rohKum, s)

/** Roher Wegstand → Wegstand auf der GEBAUTEN Route (der Rückweg von `rohBeiS`). */
const sBeiRoh = (roh: number) => interpoliere(rohKum, route.wpS, roh)

/**
 * Die Halte der Achse: Foto-/Video-Ketten und Kamera-Momente. Ein Halt kostet
 * Filmzeit und keine Strecke — genau das drückt die Achse aus.
 *
 * Die Breite einer Aufnahme ist ihr KLIP (Standzeit + Ausblendung), dieselbe Rechnung
 * wie im Editor (`aufnahmeHaltS`); fehlt einem Video die Länge, gilt in BEIDEN
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
const achsenHalte: Array<Streckenhalt & Omit<Spielhalt, 'filmVon' | 'filmBis'>> = [
  ...stops.map((halt) => {
    let ab = 0
    const stuecke = halt.items.map((m) => {
      const standS = standzeitS({ ...m, ...(m.durationS !== undefined ? { dauerS: m.durationS } : {}) })
      const stueck = { abS: ab, standS }
      ab += klipDauerS(standS)
      return stueck
    })
    return { meterM: rohBeiS(halt.s), breiteS: ab, stopp: halt, moment: null, stuecke }
  }),
  ...moments.map((m) => ({
    meterM: rohBeiS(m.s),
    breiteS: momentHaltS(m),
    stopp: null,
    moment: m,
    stuecke: [],
  })),
]
const achsenGrenzen = modes.map((m) => ({ abM: rohBeiS(m.s), mode: m.mode }))
const filmachse = baueFilmachse(achsenGrenzen, rohGesamt, achsenHalte)
/**
 * Fortbewegung an einem ROHEN Meterstand — aus der ACHSE, nicht aus `modes`.
 * Die Achse zieht einen Tempowechsel dicht an einem Halt auf den Halt; die
 * rohen Grenzen wissen davon nichts.
 */
const modusBeiRoh = (m: number): string => {
  let mode = filmachse.modi[0]?.mode ?? 'bike'
  for (const g of filmachse.modi) if (g.abM <= m) mode = g.mode
  return mode
}
/** Filmsekunde an einem Wegstand der gebauten Route. */
const filmBeiS = (s: number) => filmBeiStrecke(filmachse, rohBeiS(s))
/**
 * Die Achse, wie die Engine sie liest (E2) — in den Metern der GEBAUTEN Route.
 *
 * Der Umrechnungsschritt gehört hierher und nicht in die Engine: Die Achse
 * rechnet in ROHEN Metern (sonst wäre die Filmdauer allein durch die
 * Catmull-Rom-Glättung 2,2–3,0 % zu lang), die Engine fährt auf der gebauten
 * Route. Nur diese Datei kennt beide Meterstände.
 */
const filmspur: Filmspur = {
  gesamtS: filmachse.gesamtS,
  sBeiFilm: (f) => sBeiRoh(streckeBeiFilm(filmachse, f)),
  filmBeiS,
  haltBeiFilm: (f) => haltBeiFilm(filmachse, f),
  modusBeiS: (s) => {
    const m = modusMischung(filmachse, rohBeiS(s), modusBeiRoh)
    return m.anteil >= 0.5 ? m.nachMode : m.vonMode
  },
  // Die Kameradistanz folgt DERSELBEN Rampe wie das Tempo: `modusMischung`
  // liefert die zwei Modi und den Anteil dazwischen, `mischeSkala` macht daraus
  // die Distanz. Hier und nicht in der Engine, weil nur diese Datei beide
  // Meterstände kennt (Roh für die Achse, Route für die Kamera).
  skalaBeiS: (s) => {
    const m = modusMischung(filmachse, rohBeiS(s), (x) => modusBeiRoh(x))
    return m.vonMode === m.nachMode
      ? skalaFuer(m.vonMode)
      : mischeSkala(skalaFuer(m.vonMode), skalaFuer(m.nachMode), m.anteil)
  },
}
window.__j.filmachse = filmachse
window.__j.filmS = filmBeiS

// — Tour-eigene Audio-Spuren (Kreativbaukasten, cfg.audio aus remote.ts):
// Musik-Bereiche + SFX-One-Shots, in FILMSEKUNDEN verankert (E10). Statische
// Touren haben kein cfg.audio → null, der restliche Code chaint optional.
// Der Master steht an der TOUR (cfg.audioPegel): aufgezeichnete Touren tragen
// den Studio-Pegel absolut, kuratierte sind gegen die 0.22 ausgemessen.
//
// Die Grenzen laufen EINMAL durch die Übersetzung, danach rechnet
// audiotracks.ts nur noch in Filmzeit. Je Endpunkt gilt: `filmS`/`filmBisS` aus
// dem Tour-JSON, wo sie stehen — sonst der Rückfall über die Filmachse. Nur der
// Server kann den ersten Weg gehen: Ein Anker MITTEN in einer Standzeit fällt im
// Streckenanteil auf die Halt-Kante, und aus `f` ist er nicht wieder
// herauszuholen (Konzept §5.1). Kuratierte Touren tragen die Felder nie — für
// sie ist der Rückfall der Normalzustand, nicht ein Übergang.
const audioSpuren = cfg.audio?.map((a) => ({
  ...a,
  filmVonS: a.filmS ?? filmBeiS(sBeiF(a.f0)),
  filmBisS: a.filmBisS ?? filmBeiS(sBeiF(a.f1)),
}))
const tourAudio = audioSpuren?.length
  ? createAudioTracks(audioSpuren, { volume: cfg.audioPegel ?? KURATIERTER_PEGEL })
  : null
// Bringt die Tour eigene Musik mit, ersetzt sie den Ambient-Loop komplett —
// sonst liefen beide Musiken übereinander (der Musik-Schalter steuert dann tourAudio).
const hatEigeneMusik = !!cfg.audio?.some((a) => a.type === 'music')

const start = pointAt(route, 0)

// — Texte aus der Tour-Konfiguration —
const setText = (id: string, text: string) => ($(id).textContent = text)
document.title = 'Maptale · deine Reisen als kinematische 3D-Erlebnisse'
setText('intro-kicker', cfg.kicker)
$('intro-title').innerHTML = cfg.titleHtml
setText('intro-route', cfg.stops.join('  →  '))
setText('finale-title', cfg.finaleTitle)
setText('chip-photos', `${photos.length} Fotos`)
setText('final-photos', String(photos.length))

// — Der Weg zurück führt DORTHIN, WO MAN HERKAM —
// Wer aus dem Studio, dem Entdecken-Bereich oder einem Profil kommt, will dorthin
// zurück und nicht auf die Landing. Die Herkunft steht im Referrer; `history.back()`
// statt einer Navigation, damit Scrollposition und Zustand der Liste erhalten
// bleiben. Ohne Referrer (direkt geöffneter Link) bleibt es bei der Startseite.
// Die Wörter sind die der Navigation, nicht die der Pfade: /galerie heißt für
// Besucher überall „Entdecken".
const HERKUNFT: Record<string, string> = { '/app': 'Studio', '/galerie': 'Entdecken', '/profil': 'Profil' }
if (!appModus) {
  let her: URL | null = null
  try {
    const r = new URL(document.referrer)
    // Nur echte Zwischenseiten übernehmen; die Landing „/" ist selbst die
    // Startseite und bleibt beim Default-Knopf.
    if (r.origin === location.origin && r.pathname !== location.pathname && r.pathname !== '/') her = r
  } catch {}
  if (her) {
    const wort = HERKUNFT[her.pathname] ?? 'Zurück'
    const zurueck = document.querySelector<HTMLAnchorElement>('.zurueck')
    if (zurueck) {
      zurueck.href = her.href
      zurueck.setAttribute('aria-label', `Zurück zu: ${wort}`)
      const wortEl = zurueck.querySelector('.zurueck-wort')
      if (wortEl) wortEl.textContent = wort
      zurueck.addEventListener('click', (e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || history.length < 2) return
        e.preventDefault()
        history.back()
      })
    }
  }
}

const map = createMap('map', [start[0], start[1]])
Object.assign(window.__j, { map, route, tourAudio })

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
  const rider = createRider(map, [start[0], start[1]], startModus)

  const ui = new UI(stops, route, filmspur)
  /** Zählerstand der verworfenen Frames beim letzten Nachziehen (s. updateTrace). */
  let gesehenVerworfen = 0
  let kamFolger: ((filmS: number) => void) | null = null // Kamera-Keyframe-Folger (nur bei cfg.camera, s. unten)
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
    kamFolger?.(tour.filmS)
    // Hat die Filmuhr Zeit VERWORFEN, lief der Ton auf der Wanduhr weiter und
    // der Film nicht — dann ist die Datei um genau diese Sekunden zu weit.
    // Der Notdeckel (1,0 s) greift bei gedrosseltem `rAF` ohne
    // `visibilitychange`: verdecktes Fenster, Kachel-Nachladen nach einem
    // Sprung, ein langsames Gerät unter Last. Gemessen in der Entwicklungs-Pane:
    // 29,4 s in zwei Frames — danach steht dieselbe Stelle der Tour an einer
    // ganz anderen Stelle des Stücks. Genau dann neu ausrichten; im Normalfall
    // zählt der Vergleich zweier Zahlen und sonst nichts.
    if (tour.uhr.verworfenFrames !== gesehenVerworfen) {
      gesehenVerworfen = tour.uhr.verworfenFrames
      nachSprung()
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
  const nachSprung = () => tourAudio?.richteAus(tour.filmS)

  // Fahrzeug-Motorloop (dezent): folgt dem aktiven Segment-Modus, läuft nur während
  // der eigentlichen Fahrt (Gate unten). Moduswechsel blendet den Motor weich über.
  const vehicle = createVehicle('/audio')
  vehicle.setMode(startModus)
  window.__j.vehicle = vehicle
  ui.onModeChange = (mode) => { setRiderIcon(rider, mode); vehicle.setMode(mode) }

  const km = `${(route.total / 1000).toFixed(1)} km`
  const setGain = (hm: number) => {
    $('chip-gain').textContent = `${Math.round(hm)} hm`
    $('final-gain').textContent = `${Math.round(hm)} hm`
  }
  $('chip-distance').textContent = km
  $('final-km').textContent = km
  setGain(route.gain)

  // Echte DEM-Höhen nachladen: korrigiert Höhenprofil, Telemetrie und
  // Höhenmeter — die Wegpunkt-Höhen sind nur der Startwert.
  const modeAtS = (s: number): ModusGrenze | undefined => {
    let cur = modes[0]
    for (const m of modes) if (m.s <= s + 1) cur = m
    return cur
  }
  window.__j.eleReady = sampleElevations(route.coords)
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
        const vor = cs[i - 1]
        const jetzt = cs[i]
        if (vor && jetzt && jetzt[2] > vor[2]) gain += jetzt[2] - vor[2]
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
    film: filmspur,
    modes,
    showFinale: cfg.showFinale === true,
  })
  // `uhr` ist die Filmuhr der Engine: Ihre Zähler (verworfene Sekunden,
  // Pausen, längstes Frame) sind der Blick darauf, was auf einem langsamen
  // Gerät tatsächlich passiert — sichtbar in der Konsole statt still.
  Object.assign(window.__j, { tour, rider, uhr: tour.uhr })

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
  let kamManuell = false
  if (cfg.camera?.length) {
    const keyframes = cfg.camera
      .map((k) => ({
        filmS: k.filmS ?? filmBeiS(sBeiF(k.f)),
        preset: k.preset,
        ...(k.skala !== undefined ? { skala: k.skala } : {}),
      }))
      .sort((a, b) => a.filmS - b.filmS)
    // Vor dem ersten Keyframe gilt der Player-Default — der ist beim Boot der
    // aktive Button (statisch „mittel"). Auch nach Rückwärts-Scrub/Restart.
    const defaultPreset = document.querySelector<HTMLElement>('.preset-btn.active')?.dataset.preset ?? 'mittel'
    let kamAktiv: string | null = null // zuletzt angewendete Preset+Skala-Kennung (gegen Dauer-Reapply)
    kamFolger = (filmS) => {
      if (kamManuell) return
      // Lineare Suche reicht (≤100 Einträge) und übersteht Rückwärts/Sprünge
      let k: { filmS: number; preset: string; skala?: number } | null = null
      for (const kf of keyframes) if (kf.filmS <= filmS) k = kf
      // `standard` ist ein echter Keyframe-Wert und bedeutet dasselbe wie „vor
      // dem ersten Keyframe": zurück auf die Einstellung des Zuschauers. Ohne
      // diese Zeile fiele er in setPreset auf „mittel" (PRESETS['standard']
      // gibt es nicht) und überschriebe genau die Wahl, die er meint.
      const preset = k ? (k.preset === 'standard' ? defaultPreset : k.preset) : kamAktiv === null ? null : defaultPreset
      // Eine Feinjustierung gehört zu einem gewählten Abstand — auf „standard"
      // angewandt verböge sie die Einstellung des Zuschauers.
      const skala = k && k.preset !== 'standard' ? (k.skala ?? 1) : 1
      if (preset === null) return
      // Kennung aus Preset+Skala: eine reine Feinjustierung (gleiches Preset,
      // andere Skala) muss ebenfalls neu angewendet werden.
      const kennung = `${preset}:${skala}`
      if (kennung === kamAktiv) return
      kamAktiv = kennung
      tour.setPreset(preset, skala)
      // Button-Zustand nachziehen (gleiches Muster wie der Klick-Handler unten)
      document.querySelector('.preset-btn.active')?.classList.remove('active')
      document.querySelector(`.preset-btn[data-preset="${preset}"]`)?.classList.add('active')
    }
  }

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeWeather(); $('options-modal').hidden = true } })

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
  const sceneAnimating = () =>
    tour.uhr.laeuft && (tour.playing || tour.scrubbing || tour.phase === 'intro' || tour.phase === 'finale')
  weather.setGate(sceneAnimating)
  window.__j.weather = weather

  // Motorloop nur während der eigentlichen Fahrt: nicht im Foto-Stopp, Intro/Finale,
  // beim Scrubben oder in Pause (dort geht der Motor weich aus wie an einer Ampel).
  vehicle.setGate(() => tour.uhr.laeuft && tour.playing && !tour.scrubbing && tour.phase === 'ride')
  const WEATHER_KEY = 'maptale:weather'
  const WEATHER_INT_KEY = 'maptale:weather-int'
  // Wetter-Stärke: drei UI-Stufen auf einer stufenlosen Skala (die API nimmt jedes
  // 0..1 — ein späteres Echtwetter kann feiner dosieren). Default Mittel.
  const WEATHER_INT: Record<string, number> = { leicht: 0.4, mittel: 0.7, stark: 1 }
  let weatherInt = 'mittel'
  const stufenStaerke = () => WEATHER_INT[weatherInt] ?? 0.7
  // Himmel je Wetter-Modus: Wolkendeckung als SPANNE [c0..c1] über die Stärke —
  // die Atmosphäre formt daraus die Wolken selbst (locker → aufgerissen →
  // geschlossen). „Wolkig" spannt den ganzen Bogen: Leicht = einzelne Wolken
  // (Sonne frei), Mittel = aufgerissener Himmel, Stark = geschlossene Decke ohne
  // sichtbare Sonne. Niederschlags-Modi starten dagegen schon bedeckt (auch
  // leichter Regen fällt nicht aus heiterem Himmel). Die Atmosphäre existiert erst
  // nach dem Tag/Nacht-Block (cfg.time) → später via atmoWeather-Hook gekoppelt.
  const WEATHER_SKY: Record<string, { c0: number; c1: number; dark: number; fog: number }> = {
    off: { c0: 0, c1: 0, dark: 0, fog: 0 },
    clouds: { c0: 0.28, c1: 0.98, dark: 0.34, fog: 0 },
    fog: { c0: 0.22, c1: 0.45, dark: 0.2, fog: 1 },
    rain: { c0: 0.72, c1: 1, dark: 0.55, fog: 0.16 },
    snow: { c0: 0.62, c1: 0.96, dark: 0.3, fog: 0.4 },
    storm: { c0: 0.88, c1: 1, dark: 0.8, fog: 0.12 },
  }
  const skyFor = (m: string, k: number) => {
    const b = WEATHER_SKY[m] ?? WEATHER_SKY.off!
    // k läuft im UI 0.4..1 (Leicht..Stark); darunter (künftiges Echtwetter,
    // stufenlos) bleibt die Deckung am unteren Ende der Spanne
    const t = Math.max(0, Math.min(1, (k - 0.4) / 0.6))
    return { cover: b.c0 + (b.c1 - b.c0) * t, dark: b.dark * (0.4 + 0.6 * k), fog: b.fog * (0.35 + 0.65 * k) }
  }
  let atmoWeather: (() => void) | null = null // () => atmo.setWeather(skyFor(...)), gesetzt sobald atmo existiert
  let groundSnow: (() => void) | null = null // () => dayNight.setSnow(...), gesetzt sobald die Tag/Nacht-Regie existiert
  const weatherBtn = $('btn-weather')
  const weatherMenu = $('weather-menu')
  const closeWeather = () => { weatherMenu.hidden = true; weatherBtn.setAttribute('aria-expanded', 'false') }
  const openWeather = () => { weatherMenu.hidden = false; weatherBtn.setAttribute('aria-expanded', 'true') }
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
  let weatherK = stufenStaerke() // wirksame Stärke (UI-Stufe bzw. Auto-Wert)
  let weatherAuto = false
  let wxTimeline: WetterStuetze[] | null = null // sobald geladen
  let wxSegment: WetterStuetze | null = null // zuletzt angewandter Timeline-Eintrag (gegen Dauer-Reapply)

  const applyWx = (m: string, k: number) => {
    weatherK = k
    weather.setIntensity(k)
    weather.setMode(m)
    atmoWeather?.()
    groundSnow?.()
  }
  const applyAutoNow = () => {
    const e = weatherAt(wxTimeline, tour.s)
    if (!e) { applyWx('off', stufenStaerke()); return }
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
      applyWx(m, stufenStaerke())
    }
    syncWeatherUI(weatherAuto ? 'auto' : weather.mode)
    if (persist) {
      try {
        localStorage.setItem(WEATHER_KEY, weatherAuto ? 'auto' : weather.mode)
        localStorage.setItem(WEATHER_INT_KEY, weatherInt)
      } catch { /* Storage evtl. gesperrt */ }
    }
  }
  // Beim Fahren die Abschnittsmitten überwachen (die Übergänge blenden weich in
  // weather.ts/atmosphere.ts) — 0,8 s reichen, Wetter ändert sich gemächlich.
  // Zugleich den Wetter-Ton beim Finale („Ziel erreicht") ausblenden (nur der
  // Sound; die Regen-Partikel laufen im Orbit weiter) — kommt beim Neustart zurück.
  setInterval(() => {
    if (weatherAuto && wxTimeline) applyAutoNow()
    // Wetter-SFX folgt dem Audio-Master (Optionen) UND blendet beim Finale aus
    weather.setSoundEnabled(audioOn && tour.phase !== 'finale')
  }, 800)
  weatherMenu.querySelectorAll<HTMLElement>('[data-weather]').forEach((el) => {
    el.addEventListener('click', () => { applyWeather(el.dataset.weather ?? 'off'); closeWeather() })
  })
  // Stärke-Umschalter (Leicht/Mittel/Stark): wirkt live auf den laufenden Modus,
  // Menü bleibt offen (man will die Wirkung direkt vergleichen)
  weatherMenu.querySelectorAll<HTMLElement>('[data-wlevel]').forEach((el) => {
    el.addEventListener('click', () => {
      const stufe = el.dataset.wlevel
      weatherInt = stufe && WEATHER_INT[stufe] ? stufe : 'mittel'
      // Im Auto-Modus bleibt Auto aktiv (die Stärke kommt dort aus den Wetterdaten,
      // die Stufe greift erst wieder bei manueller Wahl)
      applyWeather(weatherAuto ? 'auto' : weather.mode)
    })
  })
  weatherBtn.addEventListener('click', (e) => { e.stopPropagation(); weatherMenu.hidden ? openWeather() : closeWeather() })
  document.addEventListener('click', (e) => {
    const ziel = e.target
    if (!weatherMenu.hidden && ziel instanceof Node && !weatherMenu.contains(ziel) && ziel !== weatherBtn) closeWeather()
  })
  // Gemerkte Wetter-Wahl + Stärke wiederherstellen. OHNE gemerkte Wahl ist
  // AUTO der Default (echtes Wetter der Reise); „off" bleibt eine bewusste Wahl.
  try {
    const savedI = localStorage.getItem(WEATHER_INT_KEY)
    if (savedI && WEATHER_INT[savedI]) weatherInt = savedI
    const savedW = localStorage.getItem(WEATHER_KEY)
    if (savedW == null || savedW === 'auto') applyWeather('auto', false)
    else if (WEATHER_SKY[savedW] && savedW !== 'off') applyWeather(savedW, false)
    else syncWeatherUI('off')
  } catch { syncWeatherUI('off') }

  // Foto-Wegpunkte + Startpunkt als GL-Layer auf der Karte
  const spotPunkte: PinStopp[] = stops.map((st) => {
    const pos = pointAt(route, st.s)
    // Für den Pin-Kopf (?pins3d=foto) reicht die Kachel-Fassung: Die Scheibe
    // ist gut hundert Pixel groß, das Foto in Anzeigegröße wäre reine Last.
    const kopf = st.items[0]
    return { lnglat: [pos[0], pos[1]], s: st.s, ele: pos[2], src: kopf?.thumb ?? kopf?.src }
  })
  const syncSpots = addSpotLayers(
    map,
    spotPunkte,
    [start[0], start[1]],
    (s) => {
      tour.jumpToPhoto(s) // Wegpunkt-Klick öffnet das Foto direkt
      nachSprung()
    },
  )

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
    let pins: PinSteuerung | null = null
    ui.registerSpots((s) => pins?.sync(s))
    import('./photopins.js').then(({ installPhotoPins }) => {
      pins = installPhotoPins(map, spotPunkte, {
        onSelect: (s) => {
          tour.jumpToPhoto(s)
          nachSprung()
        },
        variante: pinsParam === 'foto' ? 'foto' : 'nummer',
      })
      window.__j.pins = pins
      pins.sync(tour.s ?? 0)
    })
  }
  ui.syncDots(0)

  // — Steuerung —
  $('btn-start').addEventListener('click', () => tour.begin())
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
   * klänge sie wie ein durchgedrehter Kassettenrekorder", src/studio/abspielen.ts),
   * der Player nicht — und weil `shuttle` keinen Ausgleich auslöste, driftete
   * die Musik im Schnelllauf davon: Bei 8× vergehen acht Filmsekunden je
   * Wanduhrsekunde, die Datei kennt nur die eine. Mit dieser Regel braucht sie
   * keinen Ausgleich mehr — sie klingt dort nicht.
   */
  const tempoEins = () => tour.mult === 1 && tour.dir > 0

  const music = hatEigeneMusik ? null : createMusic('/audio/ambient.mp3')
  music?.setGate(() => tour.uhr.laeuft && tempoEins() && tour.phase !== 'intro' && tour.phase !== 'finale')
  window.__j.music = music

  // Tour-Audio-Gate: Musik läuft während Fahrt/Foto/Scrub. Pause stoppt sie
  // sofort und hält die Abspielposition (audiotracks.ts); Bereichsgrenzen und
  // Menü/Finale blenden weich aus. Bewusst anders als music.ts — die eigene
  // Musik gehört zur SZENE, nicht zur App.
  // Ein `|| tour.phase === 'photo'` stand hier einmal und war genau der Fall,
  // in dem die Pause NICHT griff: Im Foto-/Video-Halt bleibt `playing` sonst
  // die einzige Auskunft darüber, ob der Film läuft — mit der Oder-Klausel lief
  // die Musik unter der angehaltenen Einblendung weiter und stand danach an
  // einer anderen Stelle als der Schnitt im Studio.
  tourAudio?.setGate(
    () =>
      tour.uhr.laeuft &&
      tempoEins() &&
      tour.phase !== 'intro' &&
      tour.phase !== 'finale' &&
      (tour.playing || tour.scrubbing),
  )

  // Video mit Ton → laufende Musikspur crossfaden (Ambient und Tour-Musik).
  // Pegel 0..1 aus der Video-Hülle; Stärke am Plateau: VIDEO_DUCK in audiotracks.ts.
  ui.onVideoTon = (huelle) => {
    music?.setDucking(huelle)
    tourAudio?.setDucking(huelle)
  }

  // — Optionen (Endnutzer): Ton (Master) · Musik · Wetter-Effekte —
  // Switches im Optionen-Dialog, Zustände in localStorage. „Ton" ist der Master über
  // ALLE Klänge (Motor, Musik, Wetter-SFX); „Musik" schaltet nur den Ambient-Loop;
  // „Wetter-Effekte" schaltet global zwischen Auto-Wetter (echt) und Aus.
  const MUSIC_KEY = 'maptale:music'
  const AUDIO_KEY = 'maptale:audio'
  let musicOn = true
  let audioOn = true
  try { musicOn = localStorage.getItem(MUSIC_KEY) !== 'off' } catch { /* Storage evtl. gesperrt */ }
  try { audioOn = localStorage.getItem(AUDIO_KEY) !== 'off' } catch { /* Storage evtl. gesperrt */ }
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
    try { localStorage.setItem(AUDIO_KEY, audioOn ? 'on' : 'off') } catch { /* Storage evtl. gesperrt */ }
  })
  optMusic.addEventListener('click', () => {
    musicOn = !musicOn
    setSwitch(optMusic, musicOn)
    applyAudio()
    try { localStorage.setItem(MUSIC_KEY, musicOn ? 'on' : 'off') } catch { /* Storage evtl. gesperrt */ }
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
  const openOptions = () => { syncWeatherSwitch(); optModal.hidden = false }
  const closeOptions = () => { optModal.hidden = true }
  $('btn-options').addEventListener('click', openOptions)
  $('opt-close').addEventListener('click', closeOptions)
  optModal.addEventListener('click', (e) => { if (e.target === optModal) closeOptions() })

  // — Entwicklermodus — blendet Dev-Regler (Wetter-Palette, Kameradistanz) ein.
  // Aktivierung: ?dev=1 ODER Tippfolge „dev". Merker in localStorage, damit ein
  // Reload den Modus behält.
  const DEV_KEY = 'maptale:dev'
  let devOn = params.get('dev') === '1'
  try { devOn = devOn || localStorage.getItem(DEV_KEY) === '1' } catch { /* Storage evtl. gesperrt */ }
  const setDev = (on: boolean) => {
    devOn = on
    document.body.classList.toggle('dev', on)
    try { localStorage.setItem(DEV_KEY, on ? '1' : '0') } catch { /* Storage evtl. gesperrt */ }
  }
  setDev(devOn)
  let devSeq = ''
  window.addEventListener('keydown', (e) => {
    if (istTextfeld(e.target)) return
    devSeq = (devSeq + e.key).slice(-3).toLowerCase()
    if (devSeq === 'dev') { setDev(!devOn); toast(devOn ? 'Entwicklermodus an' : 'Entwicklermodus aus') }
  })

  const speedBtn = $('btn-speed')
  // Tempo-Label aus dem Tour-Zustand: Faktor + Richtung (−4× = 4× rückwärts).
  // Wird pro Stats-Tick aufgerufen, bleibt also auch nach JKL-Shuttle aktuell.
  let letztesTempo = 1
  ui.onSpeed = (mult, dir) => {
    const txt = `${dir < 0 ? '−' : ''}${mult}×`
    if (speedBtn.textContent !== txt) speedBtn.textContent = txt
    // Zurück auf Tempo 1: Der Ton hat den Schnelllauf STUMM verbracht (E16) und
    // steht deshalb dort, wo er beim Umschalten war — dieselbe Lage wie nach
    // einem Sprung. `onSpeed` läuft im 10-Hz-Takt der Telemetrie, ausgerichtet
    // wird nur an der Kante.
    const tempo = dir * mult
    if (tempo !== letztesTempo) {
      letztesTempo = tempo
      if (tempo === 1) nachSprung()
    }
  }
  speedBtn.addEventListener('click', () => {
    tour.dir = 1 // Button ist ein Vorwärts-Tempo-Umschalter
    ui.onSpeed?.(tour.cycleSpeed(), tour.dir)
  })

  for (const btn of document.querySelectorAll<HTMLElement>('.preset-btn')) {
    btn.addEventListener('click', () => {
      kamManuell = true // manueller Eingriff: Kamera-Folger dauerhaft aus (bis Reload)
      document.querySelector('.preset-btn.active')?.classList.remove('active')
      btn.classList.add('active')
      tour.setPreset(btn.dataset.preset ?? 'mittel')
    })
  }

  // Tag/Nacht: Streckenanteil ↦ Pseudo-Uhrzeit ↦ Sonnenstand ↦ Szenenstimmung.
  // Aufgezeichnete Touren (M2) bringen timeline-Stützstellen mit — die Pseudo-
  // Uhr folgt dann dem echten Tempo (Pausen serverseitig komprimiert) statt
  // linear über die Strecke zu laufen; statische Touren bleiben linear.
  const zeit = cfg.time
  if (zeit) {
    const t0 = Date.parse(zeit.start)
    const t1 = Date.parse(zeit.end)
    // Auch die Pseudo-Zeit hängt an f: Ihre Stützstellen laufen durch dieselbe
    // Übersetzung, damit die Sonne dort steht, wo die Aufnahme sie gesehen hat.
    // `createTimeAt` bekommt sie in der Parametrisierung des Players, weil es
    // gegen `tour.s / route.total` befragt wird.
    const timeAt = createTimeAt(
      cfg.timeline?.map((e) => ({ f: fracBeiF(e.f), t: e.t })),
      t0,
      t1,
    )
    const fmt = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: zeit.zone })
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
    window.__j.atmo = atmo
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
        window.__j.pins?.applyDayNight(p) // 3D-Pins (?pins3d=1) nachts zurücknehmen
        atmo.setSky(p.hor, p.sky, p.fog) // Dunst an Horizont/Himmel/Fog der Tageszeit koppeln
      },
    )
    // Schneedecke aufs Satellitenbild koppeln (Stärke → Deckungsgrad); den ggf.
    // wiederhergestellten Schnee-Modus nachziehen (Restore lief vor der Regie)
    groundSnow = () => dayNight.setSnow(
      weather.mode === 'snow' ? 0.3 + 0.7 * Math.max(0, (weatherK - 0.4) / 0.6) : 0,
    )
    groundSnow()
    // Auto-Wetter-Timeline laden (asynchron; braucht die Pseudo-Zeit dieser Tour).
    // Bei Fetch-Fehlern (offline, API weg) bleibt Auto still bei „Kein Wetter".
    // Kuratierte Wetter-Timeline der Tour (cfg.weather, km entlang der Route) hat
    // Vorrang vor dem Auto-Wetter — nötig, weil das ERA5-Archiv für manche Orte nie
    // ein Gewitter codiert (z.B. Koh Pha-ngan). Sonst echtes historisches Wetter.
    const kuratiert: WetterStuetze[] | null = cfg.weatherF
      ? cfg.weatherF.map((w) => ({ s: sBeiF(w.f), mode: w.mode, k: w.k }))
      : cfg.weather
        ? cfg.weather.map((w) => ({ s: w.km * 1000, mode: w.mode, k: w.k }))
        : null
    const wxSource: Promise<WetterStuetze[]> = kuratiert
      ? Promise.resolve(kuratiert.slice().sort((a, b) => a.s - b.s))
      : buildWeatherTimeline({ photos, route, time: zeit, pointAt })
    wxSource
      .then((tl) => {
        wxTimeline = tl
        window.__j.wxTimeline = tl
        if (weatherAuto) { wxSegment = null; applyAutoNow() }
      })
      .catch((err: unknown) => console.info('Auto-Wetter nicht verfügbar:', err instanceof Error ? err.message : err))
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
  const filmAnteilAt = (e: PointerEvent) => {
    const rect = progress.getBoundingClientRect()
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  }
  let scrubMoved = false
  let scrubDot: number | null = null
  let scrubDownX = 0
  progress.addEventListener('pointerdown', (e) => {
    scrubMoved = false
    const ziel = e.target
    scrubDot = ziel instanceof HTMLElement && ziel.classList.contains('photo-dot') ? Number(ziel.dataset.s) : null
    scrubDownX = e.clientX
    progress.setPointerCapture(e.pointerId)
    document.body.classList.add('scrubbing') // Scrub-Cursor, auch über den Dots
    tour.beginScrub(filmAnteilAt(e))
  })
  progress.addEventListener('pointermove', (e) => {
    if (!tour.scrubbing) return
    if (!scrubMoved && Math.abs(e.clientX - scrubDownX) < 4) return // Tipp-Zittern ist kein Scrub
    scrubMoved = true
    tour.scrub(filmAnteilAt(e))
  })
  progress.addEventListener('pointerup', (e) => {
    document.body.classList.remove('scrubbing')
    if (!tour.scrubbing) return
    if (!scrubMoved && scrubDot != null) tour.jumpToPhoto(scrubDot) // Dot-Tap: Foto sofort
    else tour.endScrub(filmAnteilAt(e))
    nachSprung()
  })
  progress.addEventListener('pointercancel', () => {
    document.body.classList.remove('scrubbing')
    // abgebrochene Gesten liefern keine brauchbaren Koordinaten mehr
    if (tour.scrubbing) {
      tour.endScrub(tour.filmS / filmspur.gesamtS)
      nachSprung()
    }
  })

  for (const dot of document.querySelectorAll<HTMLElement>('.photo-dot')) {
    dot.addEventListener('click', (e) => {
      e.stopPropagation()
      // Pointer-Gesten laufen über das Scrubbing oben — hier nur noch die
      // Tastatur-Aktivierung (Enter/Leertaste erzeugt click mit detail 0)
      if (e.detail === 0) {
        tour.jumpToPhoto(Number(dot.dataset.s))
        nachSprung()
      }
    })
  }

  // Klick aufs Foto hält die Anzeige an (und löst sie wieder); „Weiter“
  // springt zum nächsten Foto des Stopps bzw. setzt die Fahrt fort
  $('photo-card').addEventListener('click', () => tour.togglePhotoHold())
  $('photo-next').addEventListener('click', (e) => {
    e.stopPropagation()
    tour.photoNext()
  })
  // Video-Stopp durchgelaufen: weiter wie nach einem abgelaufenen Foto-HOLD (M4)
  ui.onMediaEnded = () => tour.onMediaEnded()

  // Kino-Modus: Marke, Halt-Chip, Steuerleiste und Mauszeiger aus dem Bild (CSS: body.ui-clean)
  const setClean = (on: boolean) => document.body.classList.toggle('ui-clean', on)
  // Menü-Rücksprung (Dock, Finale-Button, Tourende ohne Endscreen) räumt den
  // Kino-Modus auf — ein Hook am Tour-Objekt, weil setClean erst hier entsteht.
  tour.onToMenu = () => setClean(false)

  // — Auto-Rückzug der Bedienelemente (jede Zeigerart) —
  // Wie in einem Videoplayer: während der FAHRT zieht sich die UI nach kurzer Ruhe
  // zurück und ist bei der nächsten Regung — Mausbewegung, Tipp, Tastendruck —
  // sofort wieder da. Deshalb braucht es keinen Knopf zum Ein-/Ausblenden: er war
  // ein Griff für etwas, das ohne Zutun passiert (und selbst ein Element im Bild).
  const RUHE_MS = 3200
  // `:hover` nur dort befragen, wo es einen echten Zeiger gibt: auf Touch bleibt die
  // Pseudoklasse nach einem Tipp am getippten Element HÄNGEN — die Steuerleiste zöge
  // sich nach dem ersten Tipp auf Play dann nie mehr zurück.
  const hatZeiger = window.matchMedia('(hover: hover)').matches
  let ruheTimer = 0
  const planeRueckzug = () => {
    window.clearTimeout(ruheTimer)
    ruheTimer = window.setTimeout(() => {
      // Bei Pause, Intro und Finale gehören die Bedienelemente auf den Schirm —
      // dann später erneut prüfen statt den Rückzug zu vergessen. Ebenso,
      // solange die Maus auf der Steuerleiste liegt: was man gerade anvisiert
      // (Timeline, Tempo, Optionen), darf nicht unter dem Zeiger wegblenden.
      // Ebenso, solange das Kartendaten-Popup offen steht (body.info-offen,
      // karteninfo.ts): der Text blendete sonst weg, während man ihn liest.
      //
      // **Der HALT zählt seit E17 dazu.** Vorher stand hier `phase === 'ride'`,
      // die Leiste blieb also für die ganze Standzeit oben — unter der alten
      // Schichtung unsichtbar (die Karte lag darüber), seit sie oben liegt der
      // Normalfall: Sie deckte die Bildunterschrift samt „Weiter" zu. Das ist
      // dieselbe Lehre wie bei E13 — ein Halt ist ein Zustand der Kurve, kein
      // anderer Betriebsmodus: Was zählt, ist, ob der FILM läuft.
      const ruht = tour.playing && (tour.phase === 'ride' || tour.phase === 'photo' || tour.phase === 'moment')
      const festgehalten =
        (hatZeiger && dockEl.matches(':hover')) || document.body.classList.contains('info-offen')
      if (ruht && !festgehalten) setClean(true)
      else planeRueckzug()
    }, RUHE_MS)
  }
  const weckeUi = () => {
    if (document.body.classList.contains('ui-clean')) setClean(false)
    planeRueckzug()
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
      weckeUi()
    },
    { passive: true },
  )
  document.addEventListener('pointerdown', weckeUi, { passive: true })
  document.addEventListener('keydown', weckeUi, { passive: true })
  planeRueckzug()

  // Kein Menü-Knopf mehr in der Steuerleiste: der Weg hinaus steht dauerhaft oben
  // links und führt dorthin, wo man herkam. Zum Startscreen DIESER Tour führt
  // weiterhin das Finale („Zum Hauptmenü") — tour.toMenu() bleibt.

  // Player verlassen (nur im App-Modus sichtbar): die Android-App stellt dafür
  // eine Brücke bereit (PlayerScreen.kt, @JavascriptInterface). Fehlt sie — etwa
  // weil jemand ?app=1 im normalen Browser aufruft —, bleibt der History-Rückweg.
  $('btn-app-zurueck').addEventListener('click', () => {
    if (window.MaptaleApp?.verlassen) window.MaptaleApp.verlassen()
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
  if (remoteFehler) toast(remoteFehler)

  // — Bildraten-Protokoll (?app=1 oder ?fps=1) —
  // Android-WebView: zeigt die HTML-Seite direkt an, leitet console.log/info/
  // console-Ausgaben aber ins Logcat (Tag „MaptalePlayer"). So lässt sich die
  // Framerate auch auf dem Gerät ohne Remote-Debugging prüfen:
  //   adb logcat -s MaptalePlayer | grep fps
  if (appModus || params.get('fps') === '1') {
    let bilder = 0
    let fenster = performance.now()
    const zaehle = () => {
      bilder++
      const jetzt = performance.now()
      if (jetzt - fenster >= 3000) {
        const fps = (bilder * 1000) / (jetzt - fenster)
        console.info(
          `[maptale] fps ${fps.toFixed(1)} · ${innerWidth}×${innerHeight} @${devicePixelRatio} · Phase ${tour.phase}`,
        )
        bilder = 0
        fenster = jetzt
      }
      requestAnimationFrame(zaehle)
    }
    requestAnimationFrame(zaehle)
  }

  // Tastatursteuerung des Players (wie in Videoschnitt-Software)
  window.addEventListener('keydown', (e) => {
    // In Textfeldern (z. B. Google-Key-Dialog) nichts abfangen
    if (istTextfeld(e.target)) return
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
        nachSprung()
        break
      case 'ArrowLeft': // ein Bild zurück
        e.preventDefault()
        tour.nudge(e.shiftKey ? -12 : -1)
        nachSprung()
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
})

/** Tastendrücke in Eingabefeldern gehören dem Feld, nicht dem Player. */
function istTextfeld(ziel: EventTarget | null): boolean {
  return ziel instanceof HTMLElement && (ziel.tagName === 'INPUT' || ziel.tagName === 'TEXTAREA')
}
