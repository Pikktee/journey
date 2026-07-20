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

/**
 * Maßstab der Haltedauer-Breite: Anteil der Leistenbreite je Sekunde.
 *
 * BEWUSST unabhängig von der Zeitachse: Die Haltedauer ist Wiedergabezeit, die
 * Leiste zeigt Aufnahmezeit — eine echte Projektion gäbe es nur über die
 * Pausen-Kompression der Pipeline (zeit.ts), die hier nicht vorliegt. Die
 * Breite ist eine Größenkodierung („12 s ist viermal so breit wie 3 s"),
 * keine Zeitspanne auf der Achse; die Marke ist deshalb als Pille gezeichnet.
 */
const BREITE_JE_SEKUNDE = 0.0035

export interface MedienMarke extends MedienDot {
  /** Haltedauer in s (0 bei Video: die Länge liegt im Editor-Modell nicht vor) */
  haltedauerS: number
  /** Breite als Anteil der Leiste — Größenkodierung, s. BREITE_JE_SEKUNDE */
  breite: number
}

/** Medien-Dots plus sichtbarer Haltedauer. */
export function baueMedienMarken(
  medien: readonly MediumAnzeige[],
  track: readonly TrackPunkt[],
  skala: ZeitSkala,
): MedienMarke[] {
  const nachId = new Map(medien.map((m) => [m.id, m]))
  return baueMedienDots(medien, track, skala).map((d) => {
    const m = nachId.get(d.id)
    const haltedauerS = m?.type === 'photo' ? (m.display?.holdS ?? HALTEDAUER_DEFAULT_S) : 0
    return { ...d, haltedauerS, breite: haltedauerS * BREITE_JE_SEKUNDE }
  })
}

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

/** Beschriftungs-Ticks: volle Stunden (oder Viertelstunden bei kurzen Touren). */
export function baueTicks(startIso: string, skala: ZeitSkala, zone: string): Array<{ anteil: number; text: string }> {
  const startMs = Date.parse(startIso)
  const vonMs = startMs + skala.vonS * 1000
  const bisMs = startMs + skala.bisS * 1000
  const spanneMin = (bisMs - vonMs) / 60000
  const rasterMin = spanneMin > 150 ? 60 : spanneMin > 40 ? 15 : 5
  const ticks: Array<{ anteil: number; text: string }> = []
  let fmt: Intl.DateTimeFormat
  try {
    fmt = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: zone })
  } catch {
    fmt = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' })
  }
  const erster = Math.ceil(vonMs / (rasterMin * 60000)) * rasterMin * 60000
  for (let ms = erster; ms <= bisMs; ms += rasterMin * 60000) {
    ticks.push({ anteil: offsetZuAnteil(skala, (ms - startMs) / 1000), text: fmt.format(new Date(ms)) })
  }
  return ticks
}
