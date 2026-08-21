// Automatische Musik für eine neu aufgezeichnete Tour.
//
// Eine frisch hochgeladene Fahrt kam bisher stumm aus der Pipeline: Musik gab
// es nur, wer sie im Studio selbst einsetzte. Dabei liegt beim Verarbeiten
// alles vor, was die Stimmung einer Reise ausmacht — Uhrzeit, Wetter, Höhen,
// Fortbewegung, Breitengrad.
//
// Diese Auswahl trifft der Server EINMAL, beim ersten Verarbeiten, und schreibt
// sie ins Edit-Overlay. Damit steht sie im Studio auf der Musikspur: sichtbar,
// austauschbar, löschbar — ein Vorschlag, keine Festlegung. Wer sie entfernt,
// bekommt sie nicht wieder (spätere Renderläufe rühren das Overlay nicht an).
//
// Die Regeln sind bewusst wenige und grob: sie sollen erklärbar falsch liegen
// können, nicht raten. Was sich nicht aus den Daten ablesen lässt (Stadt vs.
// Land, Küste), bleibt der Handauswahl in der Bibliothek überlassen.

import type { UploadSegment } from '../schema/upload.js'
import { computeStats } from './geo.js'
import type { WeatherKeyframe } from './weather.js'

/**
 * Die Musikstücke der kuratierten Bibliothek (public/audio/sfx/), soweit die
 * Automatik sie vergibt. Der Katalog selbst — Anzeigenamen, Beschreibungen,
 * alle 28 Einträge — lebt clientseitig in src/studio/sfx-library.ts; der
 * Server kann ihn nicht importieren (eigener tsconfig-rootDir), deshalb hier
 * die Dateinamen ein zweites Mal. Ein Drift-Wächter in
 * test/studio-baukasten.test.ts hält beide Seiten synchron.
 */
export const AUTO_MUSIC = {
  aufbruch: 'mus-aufbruch.mp3',
  fernweh: 'mus-fernweh.mp3',
  kuestenstrasse: 'mus-kuestenstrasse.mp3',
  nachtfahrt: 'mus-nachtfahrt.mp3',
  bergpass: 'mus-bergpass.mp3',
  tropen: 'mus-tropen.mp3',
  goldeneStunde: 'mus-goldene-stunde.mp3',
  regentag: 'mus-regentag.mp3',
} as const

/** Nasse Wetterlagen — dafür gibt es ein eigenes Stück. */
const WET_MODES = new Set(['rain', 'storm', 'snow'])
/** Ab diesem Streckenanteil in Nässe gewinnt „Regentag". */
const WET_FROM = 0.35
/** Nacht: außerhalb dieser lokalen Stunden (6 bis 20 Uhr) ist es dunkel. */
const DAY_FROM = 6
const DAY_TO = 20
/** Abendliche Ankunft — die Stunden, in denen das Licht golden wird. */
const EVENING_FROM = 17.5
const EVENING_TO = 20
/** Bergig: entweder viel geklettert oder wirklich weit oben gewesen. */
const MOUNTAIN_GAIN_M = 600
const MOUNTAIN_ELEVATION_M = 1200
/** Wendekreise — dazwischen liegen die Tropen. */
const TROPICS_LATITUDE = 23.5
/** Ab dieser Länge fühlt sich eine Tour nach Ferne an. */
const FAR_KM = 60

export interface MusicInput {
  segs: readonly UploadSegment[]
  /** Ermitteltes Wetter (Roh, vor der Foto-Verfeinerung); null = keins bekannt. */
  weather?: readonly WeatherKeyframe[] | null
  /** Beginn und Ende der Aufzeichnung (ISO) samt Zeitzone der Tour. */
  startIso: string
  endIso: string
  zone: string
}

/** Lokale Stunde als Kommazahl (14:30 → 14.5); NaN bei unbrauchbarer Eingabe. */
function localHour(iso: string, zone: string): number {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return NaN
  try {
    const parts = new Intl.DateTimeFormat('de-DE', {
      timeZone: zone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date(ms))
    const h = Number(parts.find((t) => t.type === 'hour')?.value)
    const m = Number(parts.find((t) => t.type === 'minute')?.value)
    return Number.isFinite(h) && Number.isFinite(m) ? h + m / 60 : NaN
  } catch {
    return NaN // unbekannte Zeitzone
  }
}

/**
 * Streckenanteil, den die Tour in nassem Wetter verbringt. Ein Keyframe gilt
 * von seinem `f` bis zum nächsten — dieselbe Treppe, die der Player fährt.
 */
export function wetFraction(keyframes: readonly WeatherKeyframe[]): number {
  if (keyframes.length === 0) return 0
  const sorted = [...keyframes].sort((a, b) => a.f - b.f)
  let share = 0
  for (const [i, kf] of sorted.entries()) {
    if (!WET_MODES.has(kf.mode)) continue
    const bis = sorted[i + 1]?.f ?? 1
    share += Math.max(0, Math.min(1, bis) - Math.max(0, kf.f))
  }
  return Math.min(1, share)
}

/** Höchster Punkt der Aufzeichnung in Metern (0, wenn keine Punkte vorliegen). */
function maxElevation(segs: readonly UploadSegment[]): number {
  let high = 0
  for (const seg of segs) for (const p of seg.pts) if (p[2] > high) high = p[2]
  return high
}

/** Breitengrad des ersten Punktes — grob genug, um die Tropen zu erkennen. */
function startLatitude(segs: readonly UploadSegment[]): number | null {
  for (const seg of segs) {
    const p = seg.pts[0]
    if (p) return p[1]
  }
  return null
}

/**
 * Das Musikstück, das am besten zu dieser Aufzeichnung passt — Dateiname aus
 * AUTO_MUSIK. Die Regeln greifen in dieser Reihenfolge; die erste, die zutrifft,
 * gewinnt. „Aufbruch" trägt jede Tour, für die nichts Besonderes gilt.
 */
export function chooseMusic(input: MusicInput): string {
  const { segs, weather, startIso, endIso, zone } = input
  const start2 = localHour(startIso, zone)
  const end = localHour(endIso, zone)

  // 1. Nacht — Dunkelheit prägt eine Fahrt stärker als alles andere.
  const nachts = (h: number): boolean => Number.isFinite(h) && (h < DAY_FROM || h >= DAY_TO)
  if (nachts(start2) && nachts(end)) return AUTO_MUSIC.nachtfahrt

  // 2. Nässe über einem guten Drittel der Strecke.
  if (weather && wetFraction(weather) >= WET_FROM) return AUTO_MUSIC.regentag

  // 3. Berge — Höhenmeter oder schiere Höhe.
  const stats = computeStats(segs)
  if (stats.gainM >= MOUNTAIN_GAIN_M || maxElevation(segs) >= MOUNTAIN_ELEVATION_M)
    return AUTO_MUSIC.bergpass

  // 4. Eine Fähre bedeutet Wasser — dafür ist die Küstenstraße da.
  if (segs.some((s) => s.mode === 'ferry')) return AUTO_MUSIC.kuestenstrasse

  // 5. Zwischen den Wendekreisen.
  const latitude = startLatitude(segs)
  if (latitude !== null && Math.abs(latitude) <= TROPICS_LATITUDE) return AUTO_MUSIC.tropen

  // 6. Ankunft im Abendlicht.
  if (Number.isFinite(end) && end >= EVENING_FROM && end <= EVENING_TO)
    return AUTO_MUSIC.goldeneStunde

  // 7. Weite Strecke.
  if (stats.km >= FAR_KM) return AUTO_MUSIC.fernweh

  return AUTO_MUSIC.aufbruch
}
