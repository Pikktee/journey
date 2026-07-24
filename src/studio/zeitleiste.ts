// Zeitleiste des Editors (Kreativbaukasten): reine Skalen- und Positions-
// Helfer über der Aufnahme-Zeitachse. Alles hier ist DOM-frei und unter
// Vitest testbar — die Leisten-Verdrahtung (Drag, Hover, Render) liegt in
// editor.ts. Positionen sind Anteile 0..1 der Aufnahmespanne, KEIN f
// (Streckenanteil): die Leiste zeigt die ZEIT der Aufzeichnung, damit
// Trim/Grenzen/Audio exakt an den absoluten Zeit-Ankern des Overlays hängen.

import {
  isoZuOffset,
  projiziereAufTrack,
  type AnzeigeAbschnitt,
  type AudioEintrag,
  type EditOverlay,
  type MediumAnzeige,
  type Modus,
  type TrackPunkt,
} from './editmodell.js'

/** Zeitspanne der Aufzeichnung: Offsets (s) des ersten/letzten Trackpunkts. */
export interface ZeitSkala {
  vonS: number
  bisS: number
}

export function baueSkala(track: readonly TrackPunkt[]): ZeitSkala | null {
  const erster = track[0]
  const letzter = track[track.length - 1]
  if (!erster || !letzter || letzter[3] <= erster[3]) return null
  return { vonS: erster[3], bisS: letzter[3] }
}

/** Zeit-Offset (s) → Anteil 0..1 auf der Leiste (geklemmt). */
export function anteilZuOffset(skala: ZeitSkala, anteil: number): number {
  const a = Math.max(0, Math.min(1, anteil))
  return skala.vonS + a * (skala.bisS - skala.vonS)
}

export function offsetZuAnteil(skala: ZeitSkala, tOffsetS: number): number {
  return Math.max(0, Math.min(1, (tOffsetS - skala.vonS) / (skala.bisS - skala.vonS)))
}

/**
 * Wird ein Audio-Eintrag beim Rendern verworfen, weil er vollständig außerhalb
 * des (getrimmten) Tracks liegt? Spiegelt die Pipeline-Semantik (enrich.ts):
 * SFX außerhalb [Start,Ende] fliegen raus, Musik mit leerer geklemmter Spanne
 * ebenso — der Editor warnt dann, statt still nichts abzuspielen.
 */
export function audioWirdVerworfen(
  a: AudioEintrag,
  edits: EditOverlay,
  startIso: string,
  skala: ZeitSkala,
): boolean {
  const vonS = edits.trim?.start !== undefined ? isoZuOffset(startIso, edits.trim.start) : skala.vonS
  const bisS = edits.trim?.ende !== undefined ? isoZuOffset(startIso, edits.trim.ende) : skala.bisS
  const abS = isoZuOffset(startIso, a.ab)
  if (a.typ === 'sfx') return abS < vonS || abS > bisS
  const endeS = a.bis !== undefined ? isoZuOffset(startIso, a.bis) : bisS
  return Math.min(endeS, bisS) <= Math.max(abS, vonS)
}

// — Bausteine der Leiste (alle Positionen als Anteil 0..1) —

export interface ZeitBand {
  von: number
  bis: number
  mode: Modus
  aktiv: boolean
}

/** Modus-Bänder aus den Anzeige-Abschnitten (gleiche Quelle wie der Karten-Track). */
export function baueBaender(abschnitte: readonly AnzeigeAbschnitt[], skala: ZeitSkala): ZeitBand[] {
  return abschnitte
    .map((a) => {
      const erster = a.pts[0] as TrackPunkt
      const letzter = a.pts[a.pts.length - 1] as TrackPunkt
      return { von: offsetZuAnteil(skala, erster[3]), bis: offsetZuAnteil(skala, letzter[3]), mode: a.mode, aktiv: a.aktiv }
    })
    .filter((b) => b.bis > b.von)
}

export interface MedienDot {
  id: string
  anteil: number
  type: 'photo' | 'video'
  geloescht: boolean
}

/**
 * Wiedergabe-Position der Medien auf der Zeitachse: der Anker wird auf die
 * Track-Linie projiziert, sein Zeit-Offset bestimmt den Dot. Unplatzierte
 * (anchor null) erscheinen nicht — der Editor zählt sie separat.
 */
export function baueMedienDots(
  medien: readonly MediumAnzeige[],
  track: readonly TrackPunkt[],
  skala: ZeitSkala,
): MedienDot[] {
  const dots: MedienDot[] = []
  for (const m of medien) {
    if (!m.anchor || m.geloescht) continue
    const projektion = projiziereAufTrack(track, m.anchor[0], m.anchor[1])
    dots.push({ id: m.id, anteil: offsetZuAnteil(skala, projektion.punkt[3]), type: m.type, geloescht: m.geloescht })
  }
  return dots.sort((a, b) => a.anteil - b.anteil)
}

/** Abschnitt gleichen Zustands — mit Anfang UND Ende. */
export interface ZustandsBand<T> {
  von: number
  bis: number
  wert: T
  /**
   * ISO-Anker der Grenze, die dieses Band eröffnet — null beim Grundband vor
   * der ersten Grenze. Identität für Ziehen/Entfernen (wie bei den Pins zuvor).
   */
  ab: string | null
}

/**
 * Grenzen („gilt ab T") in lückenlose Bänder übersetzen: jedes Band reicht bis
 * zur nächsten Grenze, das letzte bis ans Ende der Leiste.
 *
 * Der Punkt der Übung: Eine Grenze zeigt nur, wo ein Zustand ANFÄNGT — wo er
 * aufhört, musste man sich bisher aus der nächsten Grenze zusammenreimen. Als
 * Band ist beides dieselbe Kante.
 */
export function baueZustandsBaender<T>(
  grenzen: ReadonlyArray<{ ab: string; wert: T }>,
  startIso: string,
  skala: ZeitSkala,
  grund: T,
): Array<ZustandsBand<T>> {
  const sortiert = grenzen
    .map((g) => ({ ab: g.ab, wert: g.wert, anteil: offsetZuAnteil(skala, isoZuOffset(startIso, g.ab)) }))
    .filter((g) => Number.isFinite(g.anteil))
    .sort((a, b) => a.anteil - b.anteil)

  const baender: Array<ZustandsBand<T>> = []
  let von = 0
  let wert = grund
  let ab: string | null = null
  for (const g of sortiert) {
    baender.push({ von, bis: g.anteil, wert, ab })
    von = g.anteil
    wert = g.wert
    ab = g.ab
  }
  baender.push({ von, bis: 1, wert, ab })
  // Null-breite Bänder (Grenze bei 0, zwei Grenzen auf demselben Punkt) fallen weg
  return baender.filter((b) => b.bis > b.von)
}

/** Default-Haltedauer eines Fotos — entspricht „Auto (5 s)" im Editor. */
export const HALTEDAUER_DEFAULT_S = 5

export interface AudioBalken {
  /** Index im Overlay-Array (Identität für Patch/Entfernen) */
  index: number
  typ: 'musik' | 'sfx'
  von: number
  /** bei sfx gleich `von` */
  bis: number
  datei: string
}

export function baueAudioBalken(audio: readonly AudioEintrag[], startIso: string, skala: ZeitSkala): AudioBalken[] {
  const balken: AudioBalken[] = []
  audio.forEach((a, index) => {
    const von = isoZuOffset(startIso, a.ab)
    if (!Number.isFinite(von)) return
    const vonAnteil = offsetZuAnteil(skala, von)
    let bisAnteil = vonAnteil
    if (a.typ === 'musik') {
      const bis = a.bis !== undefined ? isoZuOffset(startIso, a.bis) : skala.bisS
      bisAnteil = Number.isFinite(bis) ? offsetZuAnteil(skala, bis) : 1
    }
    balken.push({ index, typ: a.typ, von: vonAnteil, bis: bisAnteil, datei: a.datei })
  })
  return balken
}

/** Trim-Griffe als Anteile (Default 0/1, wenn kein Trim gesetzt). */
export function baueTrimGriffe(edits: EditOverlay, startIso: string, skala: ZeitSkala): { start: number; ende: number } {
  const start = edits.trim?.start !== undefined ? offsetZuAnteil(skala, isoZuOffset(startIso, edits.trim.start)) : 0
  const ende = edits.trim?.ende !== undefined ? offsetZuAnteil(skala, isoZuOffset(startIso, edits.trim.ende)) : 1
  return { start, ende }
}

// — Wiedergabedauer schätzen —
//
// Die Zeitleiste zeigt AUFNAHMEZEIT; wie lang die fertige Animation läuft, ist
// eine andere Größe (die Engine fährt die Strecke mit eigenem Tempo ab und hält
// an jedem Foto an). Beides auf einer Achse zu zeigen wäre verwirrend — deshalb
// nur diese eine Zahl.
//
// Die drei Konstanten spiegeln src/tour.js. Ein Drift-Wächter in
// test/studio-baukasten.test.ts vergleicht sie mit der Engine.

/** `baseSpeed` in src/tour.js: Streckenfortschritt bei 1× in m/s. */
const BASIS_TEMPO_MS = 120
/** Spiegel von MODE_SPEED (src/tour.js). */
const TEMPO: Record<Modus, number> = { walk: 0.4, bike: 1, moped: 1.15, jeep: 1.45, tram: 1.25, ferry: 2.5 }
/** `HOLD_HIDE` (5,2 s Anzeige) + `HOLD_AUSBLEND` (0,8 s) in src/tour.js. */
const HALT_ENGINE_S = 5.2
const HALT_AUSBLEND_S = 0.8

/** Meter zwischen zwei Trackpunkten (lokale Plattkarte — auf Segmentlänge genau genug). */
function meterZwischen(a: TrackPunkt, b: TrackPunkt): number {
  const kx = 111_320 * Math.cos((a[1] * Math.PI) / 180)
  const dx = (b[0] - a[0]) * kx
  const dy = (b[1] - a[1]) * 110_540
  return Math.sqrt(dx * dx + dy * dy)
}

/**
 * Grobe Laufzeit der fertigen Animation in Sekunden: Fahrzeit je Abschnitt
 * (Länge ÷ modusabhängiges Tempo) plus die Haltezeit an jedem Foto.
 *
 * BEWUSST eine Näherung: Die Engine glättet und resampled die Route beim Laden
 * (buildRoute), beschleunigt weich an und hat ein Intro, das läuft, bis der
 * Zuschauer startet. Für die Frage „grob zwei Minuten oder eher zehn?" reicht
 * das; deshalb wird der Wert auch mit „~" angezeigt.
 */
export function schaetzeAnimationsdauer(
  abschnitte: ReadonlyArray<{ mode: Modus; aktiv: boolean; pts: readonly TrackPunkt[] }>,
  haltedauernS: readonly number[],
): number {
  let sekunden = 0
  for (const a of abschnitte) {
    if (!a.aktiv) continue // weggetrimmt: läuft nicht mit
    let meter = 0
    for (let i = 1; i < a.pts.length; i++) {
      meter += meterZwischen(a.pts[i - 1] as TrackPunkt, a.pts[i] as TrackPunkt)
    }
    sekunden += meter / (BASIS_TEMPO_MS * (TEMPO[a.mode] ?? 1))
  }
  for (const halt of haltedauernS) sekunden += halt + HALT_AUSBLEND_S
  return sekunden
}

/** Haltedauer eines Fotos, wie die Engine sie anwendet (display.holdS oder Default). */
export function haltedauerS(display?: { holdS?: number }): number {
  return display?.holdS ?? HALT_ENGINE_S
}

/**
 * Dauer in Sekunden → kurze Anzeige („2:05 Std", „14 Min", „38 Sek").
 * Für den Inspector: Zu einem Band gehört nicht nur „ab wann", sondern auch,
 * wie lange es gilt.
 */
export function formatiereDauer(sekunden: number): string {
  const s = Math.max(0, Math.round(sekunden))
  if (s < 60) return `${s} Sek`
  const min = Math.round(s / 60)
  if (min < 60) return `${min} Min`
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')} Std`
}

// — Maßband —
//
// Beim Hineinzoomen wird Platz frei, also darf die Skala feiner werden. Die
// Stufe ist die FEINSTE, bei der zwei Beschriftungen noch `MARKE_MIN_PX`
// auseinanderliegen; reicht selbst die gröbste nicht (sehr lange Tour, ganz
// herausgezoomt), wird sie genommen und die Beschriftungen rücken zusammen.

/** Stufen in Minuten, aufsteigend — von der Minute bis zum Tag. */
const STUFEN_MIN = [1, 2, 5, 10, 15, 30, 60, 120, 240, 360, 720, 1440] as const
/** Mindestabstand zweier Beschriftungen in px (eine „HH:MM" ist ~34 px breit). */
const MARKE_MIN_PX = 58
/** Halbe Beschriftungsbreite — darunter würde die Marke am Rand angeschnitten. */
const MARKE_HALB_PX = 20

/** Feinste Stufe (Minuten), die bei diesem Maßstab noch lesbar bleibt. */
export function waehleStufe(pxProMin: number): number {
  for (const s of STUFEN_MIN) {
    if (s * pxProMin >= MARKE_MIN_PX) return s
  }
  return STUFEN_MIN[STUFEN_MIN.length - 1] as number
}

function zeitFormat(zone: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: zone })
  } catch {
    return new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' })
  }
}

/**
 * Versatz der Zone zu UTC in Minuten, zum Zeitpunkt `ms`. Über formatToParts,
 * weil `Date` selbst nur die Zone des Browsers kennt — die Tour kann in einer
 * anderen liegen (Koh Pha-ngan: +07).
 */
function zonenVersatzMin(ms: number, zone: string): number {
  let teile: Intl.DateTimeFormatPart[]
  try {
    teile = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(ms))
  } catch {
    return -new Date(ms).getTimezoneOffset()
  }
  const w = (typ: string) => Number(teile.find((t) => t.type === typ)?.value ?? '0')
  // Stunde 24 kommt bei hour12:false für Mitternacht vor — Date.UTC verkraftet das.
  const alsUtc = Date.UTC(w('year'), w('month') - 1, w('day'), w('hour'), w('minute'), w('second'))
  return Math.round((alsUtc - ms) / 60000)
}

/**
 * Wanduhrzeit (als wäre sie UTC) → echter Zeitpunkt. Zwei Durchgänge, weil der
 * Versatz selbst vom Zeitpunkt abhängt: die erste Schätzung kann bei einer
 * Sommerzeit-Umstellung eine Stunde danebenliegen.
 */
function lokalZuAbsolut(lokalMs: number, zone: string): number {
  const ersterVersuch = lokalMs - zonenVersatzMin(lokalMs, zone) * 60000
  return lokalMs - zonenVersatzMin(ersterVersuch, zone) * 60000
}

export interface Massbandmarke {
  anteil: number
  text: string
  /** volle Stunde — kräftigerer Teilstrich als die Zwischenstufen */
  voll: boolean
  /** am Rand angeschnitten? Dann links- statt mittenbündig ausrichten. */
  rand: 'anfang' | 'ende' | null
}

/**
 * Beschriftete Marken der Zeitachse. Das Raster liegt auf der LOKALEN Uhrzeit
 * der Tour (also „15:00", nicht „15:07 = Tourbeginn + 2 h") — sonst liest sich
 * die Achse wie eine Stoppuhr statt wie eine Uhr.
 */
export function baueMassband(
  startIso: string,
  skala: ZeitSkala,
  zone: string,
  pxProMin: number,
): Massbandmarke[] {
  const startMs = Date.parse(startIso)
  if (!Number.isFinite(startMs)) return []
  const vonMs = startMs + skala.vonS * 1000
  const bisMs = startMs + skala.bisS * 1000
  const spanneMin = (bisMs - vonMs) / 60000
  if (!(spanneMin > 0)) return []

  const stufeMin = waehleStufe(pxProMin)
  const rasterMs = stufeMin * 60000
  const breitePx = spanneMin * pxProMin
  const fmt = zeitFormat(zone)

  const versatz = zonenVersatzMin(vonMs, zone) * 60000
  let lokal = Math.ceil((vonMs + versatz) / rasterMs) * rasterMs

  const marken: Massbandmarke[] = []
  // In der Sommerzeit-LÜCKE gibt es Wanduhrzeiten, die nie stattfinden (02:30
  // am Umstellungstag). Die Rückrechnung liefert dann denselben Zeitpunkt wie
  // eine spätere Marke — ohne diese Sperre stünde die Stunde doppelt und die
  // Achse liefe rückwärts.
  let letztesMs = -Infinity
  // Deckel gegen Endlosschleifen bei absurden Eingaben (pxProMin ~ 0).
  for (let i = 0; i < 5000; i++) {
    const ms = lokalZuAbsolut(lokal, zone)
    if (ms > bisMs) break
    if (ms >= vonMs && ms > letztesMs) {
      letztesMs = ms
      const anteil = offsetZuAnteil(skala, (ms - startMs) / 1000)
      const x = anteil * breitePx
      marken.push({
        anteil,
        text: fmt.format(new Date(ms)),
        voll: lokal % 3_600_000 === 0,
        rand: x < MARKE_HALB_PX ? 'anfang' : x > breitePx - MARKE_HALB_PX ? 'ende' : null,
      })
    }
    lokal += rasterMs
  }
  return marken
}

// — Streckenmeter —
//
// Die Leiste zeigt Zeit, die Kopf-Uhr daneben aber „19,2 km / 41,8 km": wo auf
// der STRECKE steht der Abspielkopf? Dafür einmal die kumulierten Meter je
// Trackpunkt aufbauen und zwischen den Punkten linear interpolieren.

/** Kumulierte Streckenmeter je Trackpunkt (Index-gleich zu `track`). */
export function kumMeter(track: readonly TrackPunkt[]): number[] {
  const kum: number[] = new Array(track.length)
  kum[0] = 0
  for (let i = 1; i < track.length; i++) {
    kum[i] = (kum[i - 1] as number) + meterZwischen(track[i - 1] as TrackPunkt, track[i] as TrackPunkt)
  }
  return kum
}

/** Zurückgelegte Meter zum Zeit-Offset (s), zwischen den Punkten interpoliert. */
export function meterZuOffset(kum: readonly number[], track: readonly TrackPunkt[], tOffsetS: number): number {
  if (track.length === 0) return 0
  const erster = track[0] as TrackPunkt
  const letzter = track[track.length - 1] as TrackPunkt
  if (tOffsetS <= erster[3]) return 0
  if (tOffsetS >= letzter[3]) return (kum[kum.length - 1] as number) ?? 0
  let i = 1
  while (i < track.length - 1 && (track[i] as TrackPunkt)[3] < tOffsetS) i++
  const a = track[i - 1] as TrackPunkt
  const b = track[i] as TrackPunkt
  const spanne = b[3] - a[3]
  const f = spanne > 0 ? (tOffsetS - a[3]) / spanne : 0
  return (kum[i - 1] as number) + f * ((kum[i] as number) - (kum[i - 1] as number))
}

/**
 * Nach dem Zoomen die Ansicht so scrollen, dass der Anker (Anteil 0..1) wieder
 * an derselben Stelle im Fenster steht — sonst springt der Blick beim Zoomen
 * irgendwohin. `spurXpx` ist die feste Breite der Namensspalte links.
 */
export function ankerScroll(ankerAnteil: number, zeitBreitePx: number, zielVx: number, spurXpx: number): number {
  return Math.max(0, spurXpx + ankerAnteil * zeitBreitePx - zielVx)
}
