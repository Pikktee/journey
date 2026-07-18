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

export interface ZeitPin {
  /** Overlay-Anker (ISO) — Identität für Entfernen/Drag */
  ab: string
  anteil: number
  text: string
}

export function bauePins(
  eintraege: ReadonlyArray<{ ab: string; text: string }>,
  startIso: string,
  skala: ZeitSkala,
): ZeitPin[] {
  return eintraege
    .map((e) => ({ ab: e.ab, text: e.text, offset: isoZuOffset(startIso, e.ab) }))
    .filter((e) => Number.isFinite(e.offset))
    .map((e) => ({ ab: e.ab, text: e.text, anteil: offsetZuAnteil(skala, e.offset) }))
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
