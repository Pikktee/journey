// Editor-Modell (M7): reine Funktionen über Track + Edit-Overlay. Spiegelt für
// die ANZEIGE die Server-Anwendung (pipeline/edits.ts: Trim → Modus-Grenzen)
// und mutiert das Overlay immutabel — die DOM-/Karten-Verdrahtung liegt in
// editor.ts, damit alles hier unter Vitest testbar bleibt.
//
// Wie serverseitig gilt: Edits referenzieren stabile Anker (Medien-IDs,
// Koordinaten, absolute Zeitstempel), nie den Streckenanteil f.

import { MOMENT_DEFAULT_S as ENGINE_MOMENT_DEFAULT_S } from '../film-axis.js'

/**
 * Fortbewegungs-Modi — deckungsgleich mit MODI in server/src/schema/upload.ts
 * und mit der Player-Engine (MODUS_TEMPO in src/film-axis.ts, MODE_SCALE in
 * src/tour.ts). Reihenfolge
 * wie in der UI: unmotorisiert → motorisiert → öffentlich → Wasser.
 * Ein Drift-Wächter in test/studio-baukasten.test.ts vergleicht die Liste mit
 * der Engine — sie lief schon einmal auseinander (Studio kannte moped/jeep nicht,
 * obwohl Engine, Icons und Motorsound sie längst hatten).
 */
export const TRAVEL_MODES = ['walk', 'bike', 'moped', 'jeep', 'tram', 'ferry'] as const

export type TravelMode = (typeof TRAVEL_MODES)[number]

/**
 * Wetter-Modi — deckungsgleich mit WEATHER_MODES in server/src/pipeline/wetter.ts
 * (und der Wetterwelt des Players in src/wetter.js). Ein Drift-Wächter in
 * test/studio-baukasten.test.ts vergleicht die Liste mit dem Server.
 */
export const WEATHER_MODES = ['off', 'clouds', 'fog', 'rain', 'snow', 'storm'] as const
export type WeatherMode = (typeof WEATHER_MODES)[number]

/** Trackpunkt der Editor-Daten: [lng, lat, ele, tOffsetS] */
export type TrackPoint = [number, number, number, number]

/** Anzeigeoptionen eines Fotos (holdS = Haltedauer in s, kenBurns aus = statisch) */
export interface DisplayEdit {
  holdS?: number
  kenBurns?: boolean
}

export interface MediaEdit {
  caption?: string
  anchor?: [number, number]
  removed?: boolean
  display?: DisplayEdit
  /**
   * Platz INNERHALB des Stopps (0-basiert). Fotos am selben Ort zeigt der Player
   * nacheinander; welches zuerst kommt, ist eine Entscheidung und keine Messung —
   * ohne dieses Feld entschiede die Projektion auf die Route darüber.
   * Spiegel von MediaEdit.order in server/src/schema/edits.ts.
   */
  order?: number
  /**
   * Schnitt eines Videos in DATEI-Sekunden (Etappe 4, docs §2F). Anschlag ist
   * an beiden Kanten das Material; Loop gibt es hier nicht — bei einem Video
   * wäre er Unsinn. Angewandt wird der Schnitt in der Pipeline (video.ts).
   * Spiegel von MediaEdit.trim in server/src/schema/edits.ts.
   */
  trim?: { fromS: number; toS?: number }
}

export interface TravelModeBoundary {
  from: string
  mode: TravelMode
}

/**
 * Wetter-Override ab einem absoluten Zeitpunkt — gilt bis zur nächsten Grenze.
 * Sobald eine Wetter-Grenze existiert, ersetzt das Overlay das Auto-Wetter
 * vollständig (Grund vor der ersten Grenze = klar). Spiegel von WeatherBoundary in
 * server/src/schema/edits.ts.
 */
export interface WeatherBoundary {
  from: string
  mode: WeatherMode
  /** Stärke k (0..1); fehlt = Standardstärke des Players */
  intensity?: number
}

/**
 * Welches Wetter gilt zu einem Zeitpunkt? — die Grenzen als Stufenfunktion.
 *
 * Dieselbe Auskunft, die die Wetter-Bahn als Bänder zeichnet, nur an einem
 * Punkt statt über einer Spanne: Es gilt die letzte Grenze, die nicht in der
 * Zukunft liegt. VOR der ersten gilt nichts (`null`) — nicht etwa „klar":
 * Solange keine Grenze gesetzt ist, hat der Autor sich nicht geäußert, und der
 * Unterschied entscheidet, ob die Karte gar nichts oder ausdrücklich klares
 * Wetter zeigt.
 *
 * Erwartet aufsteigend sortierte Grenzen — so schreibt `withWeatherBoundary` sie,
 * und so liefert der Server sein Auto-Wetter.
 */
export function weatherAtTime(
  boundaries: readonly WeatherBoundary[],
  iso: string,
): WeatherBoundary | null {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  let current: WeatherBoundary | null = null
  for (const g of boundaries) {
    if (Date.parse(g.from) > t) break
    current = g
  }
  return current
}

/**
 * Kamera-Abstand einer Grenze. `standard` ist ein WERT wie die anderen drei und
 * nicht die Abwesenheit eines Werts: Er sagt „hier gilt, was der Zuschauer im
 * Player eingestellt hat". Ohne ihn war Standard nur der Zustand VOR der ersten
 * Grenze — man kam nicht dorthin zurück, ohne das Band zu löschen, und ein
 * gelöschtes Band nahm die Stelle mit, an der es stand.
 */
export type CameraPreset = 'near' | 'mid' | 'far' | 'default'

/** Kamera-Preset ab einem absoluten Zeitpunkt — gilt bis zur nächsten Grenze. */
export interface CameraBoundary {
  from: string
  preset: CameraPreset
  /**
   * Stufenlose Feinjustierung von Abstand UND Höhe (0.5 = halb so weit weg,
   * 2 = doppelt). Fehlt oder 1 = Preset unverändert. Multipliziert im Player die
   * behind/hover-Werte des Presets (setPreset in src/tour.js).
   */
  scale?: number
}

/**
 * Kamera-Moment: an einem Punkt hält die Fahrt kurz an und die Kamera führt
 * eine dramatische Bewegung aus. Punkt-Ereignis (kein Band) — verankert am
 * absoluten Zeitpunkt wie eine Grenze.
 */
export type CameraMomentKind = 'orbit' | 'ascend' | 'linger'
export interface CameraMoment {
  from: string
  kind: CameraMomentKind
  /** Dauer in s; fehlt = Default der Art (siehe MOMENT_DEFAULT_S). */
  durationS?: number
}

/**
 * Default-Dauern je Moment-Art (s) — KEINE Kopie mehr, sondern dieselbe Tabelle,
 * aus der auch die Engine liest (src/film-axis.ts, seit Paket D). Der Name bleibt
 * hier stehen, er steht im ganzen Editor.
 */
export const MOMENT_DEFAULT_S: Record<CameraMomentKind, number> = ENGINE_MOMENT_DEFAULT_S

/** Platziertes Audio-Asset: Musik mit Bereich [ab,bis], SFX als Einzelschuss. */
export interface AudioEntry {
  file: string
  type: 'music' | 'sfx'
  from: string
  to?: string
  volume?: number
  /**
   * Herkunft der Datei. Fehlt = tour-lokal hochgeladen (→ /api/media/…).
   * 'library' = kuratierter Effekt aus [[sfxbibliothek]] (→ /audio/sfx/…),
   * liegt global und wird nicht mit der Tour hochgeladen.
   * 'user' = eigener Upload in der benutzerweiten Bibliothek — liegt einmal
   * beim Konto und ist in jeder Tour einsetzbar (→ /api/audio-library/…).
   */
  source?: 'library' | 'user'
  /**
   * Verankerung an der REISE statt an einer Filmsekunde (Etappe 4, docs §2E) —
   * der „connected clip". `anchor` ist die Stelle der Reise (Aufnahmezeit),
   * `offsetFilmS` die Feinlage in FILMsekunden (darf in einer Standzeit
   * liegen), `durationFilmS` die Länge im Film. Alle drei haben Vorrang vor
   * `from`/`to`; fehlen sie, gilt die alte Verankerung unverändert weiter.
   * Rechnende Teile in [[tonklip]].
   */
  anchor?: string
  offsetFilmS?: number
  durationFilmS?: number
  /** Einstieg in die DATEI (s) — der linke Trim. Anschlag: der Dateianfang. */
  startS?: number
  /** Wiederholung über das Dateiende hinaus; fehlt = Musik ja, Effekt nein. */
  loop?: boolean
}

export interface EditOverlay {
  schema: 'maptale/edits@2'
  media?: Record<string, MediaEdit>
  travelModes?: TravelModeBoundary[]
  trim?: { start?: string; end?: string }
  camera?: CameraBoundary[]
  moments?: CameraMoment[]
  audio?: AudioEntry[]
  weather?: WeatherBoundary[]
  /**
   * Selbst gewähltes Titelbild (Medien-ID). Der Editor SETZT es (noch) nicht,
   * aber das Overlay läuft durch ihn hindurch — und wer ein Medium endgültig
   * löscht, muss den Verweis mitnehmen, sonst griffe `bestimmeCover` beim
   * nächsten Render ins Leere, statt ein neues Titelbild zu wählen.
   */
  cover?: string
}

export interface EditorSegment {
  mode: TravelMode
  pts: TrackPoint[]
}

export const EMPTY_OVERLAY: EditOverlay = { schema: 'maptale/edits@2' }

// — Undo: das Overlay ist immutabel, ein Stapel von Ständen genügt —

/** Maximale Undo-Tiefe — Overlays sind klein, aber unbegrenzt wächst unschön. */
export const HISTORY_MAX = 100

export interface UndoStack {
  /** frühere Stände, ältester zuerst */
  past: EditOverlay[]
  /** zurückgenommene Stände (Redo), jüngster zuletzt */
  future: EditOverlay[]
}

/**
 * Undo-Punkt setzen, wenn sich das Overlay seit dem letzten VOLL-Render
 * geändert hat — Referenzvergleich, kein Vergleich der Inhalte: das Overlay
 * wird immutabel fortgeschrieben, also ist eine neue Referenz genau eine
 * Änderung, egal aus welchem Handler sie kam.
 *
 * Daran hängt der Vertrag „ein Zug = ein Undo-Schritt": Ein Zeitleisten-Zug
 * schreibt je Frame ein neues Overlay, ruft dazwischen aber nur
 * `renderAfterDrag()` (das den Stand NICHT fortschreibt). Erst das abschließende
 * `renderAll` kommt hier vorbei und legt den EINEN Stand von vor dem Zug ab.
 */
export function recordUndo(
  stack: UndoStack,
  lastState: EditOverlay | null,
  edits: EditOverlay,
): void {
  if (!lastState || lastState === edits) return
  stack.past.push(lastState)
  if (stack.past.length > HISTORY_MAX) stack.past.shift()
  stack.future.length = 0
}

// — Zeit-Umrechnung —

/** tOffset (s from time.start) → absolute ISO-Zeit (UTC, sekundengenau). */
export function offsetToIso(startIso: string, tOffsetS: number): string {
  return new Date(Date.parse(startIso) + tOffsetS * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/** absolute ISO-Zeit → tOffset (s from time.start); NaN bei Unparsebarem. */
export function isoToOffset(startIso: string, iso: string): number {
  return (Date.parse(iso) - Date.parse(startIso)) / 1000
}

// — Geometrie —

export interface TrackProjection {
  /** interpolierter Punkt AUF der Track-Linie (inkl. tOffset) */
  point: TrackPoint
  /** Index des Anfangspunkts des getroffenen Liniensegments */
  index: number
}

/**
 * Lotfußpunkt von [lng,lat] auf die Track-LINIE (lokale Plattkarte). Anders
 * als nearestPointIndex wird zwischen den Stützpunkten interpoliert — der
 * Editor-Track ist Douglas-Peucker-vereinfacht, auf Geraden (Fähre!) liegen
 * Stützpunkte kilometerweit auseinander; ein Vertex-Snap versetzte Anker dort
 * um ganze Kilometer (Bughunt-Befund).
 */
export function projectOntoTrack(
  points: readonly TrackPoint[],
  lng: number,
  lat: number,
): TrackProjection {
  if (points.length < 2) {
    const p = points[0] ?? [lng, lat, 0, 0]
    return { point: [p[0], p[1], p[2], p[3]], index: 0 }
  }
  const kx = Math.cos(((points[0]?.[1] ?? lat) * Math.PI) / 180)
  const px = lng * kx
  let best: TrackProjection = { point: [...(points[0] as TrackPoint)] as TrackPoint, index: 0 }
  let bestD = Infinity
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i] as TrackPoint
    const b = points[i + 1] as TrackPoint
    const ax = a[0] * kx
    const bx = b[0] * kx
    const dx = bx - ax
    const dy = b[1] - a[1]
    const len2 = dx * dx + dy * dy
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (lat - a[1]) * dy) / len2))
    const qx = ax + dx * t
    const qy = a[1] + dy * t
    const d = (px - qx) * (px - qx) + (lat - qy) * (lat - qy)
    if (d < bestD) {
      bestD = d
      best = {
        point: [
          a[0] + (b[0] - a[0]) * t,
          a[1] + (b[1] - a[1]) * t,
          a[2] + (b[2] - a[2]) * t,
          a[3] + (b[3] - a[3]) * t,
        ],
        index: i,
      }
    }
  }
  return best
}

/** Interpolierte Track-Position zu einem Zeit-Offset (s); geklemmt an die Enden. */
export function pointAtOffset(points: readonly TrackPoint[], tOffsetS: number): TrackPoint | null {
  const first = points[0]
  const last = points[points.length - 1]
  if (!first || !last) return null
  if (tOffsetS <= first[3]) return [...first] as TrackPoint
  if (tOffsetS >= last[3]) return [...last] as TrackPoint
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as TrackPoint
    const b = points[i] as TrackPoint
    if (tOffsetS <= b[3]) {
      const t = b[3] === a[3] ? 0 : (tOffsetS - a[3]) / (b[3] - a[3])
      return [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
        tOffsetS,
      ]
    }
  }
  return [...last] as TrackPoint
}

/** Index des Trackpunkts, der [lng,lat] am nächsten liegt (lokale Plattkarte). */
export function nearestPointIndex(points: readonly TrackPoint[], lng: number, lat: number): number {
  const kx = Math.cos(((points[0]?.[1] ?? lat) * Math.PI) / 180)
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < points.length; i++) {
    const p = points[i] as TrackPoint
    const dx = (p[0] - lng) * kx
    const dy = p[1] - lat
    const d = dx * dx + dy * dy
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

// — Overlay immutabel fortschreiben (leere Strukturen werden weggeräumt,
//    damit das gespeicherte JSON minimal bleibt) —

/** Patch-Semantik: Schlüssel vorhanden + undefined/false/leer = Override entfernen. */
export interface MediaEditPatch {
  caption?: string | undefined
  anchor?: [number, number] | undefined
  trim?: { fromS: number; toS?: number } | undefined
  removed?: boolean | undefined
  display?: DisplayEdit | undefined
  order?: number | undefined
}

export function withMediaEdit(edits: EditOverlay, id: string, patch: MediaEditPatch): EditOverlay {
  const entry: MediaEdit = { ...(edits.media?.[id] ?? {}) }
  for (const key of ['caption', 'anchor', 'removed', 'display', 'order', 'trim'] as const) {
    if (!(key in patch)) continue
    const value = patch[key]
    const emptyDisplay = key === 'display' && value !== undefined && !Object.keys(value).length
    if (value === undefined || value === false || emptyDisplay) delete entry[key]
    else (entry as Record<string, unknown>)[key] = value
  }
  const media = { ...(edits.media ?? {}) }
  if (Object.keys(entry).length) media[id] = entry
  else delete media[id]
  const next: EditOverlay = { ...edits }
  if (Object.keys(media).length) next.media = media
  else delete next.media
  return next
}

/**
 * Die Medien, die beim Speichern ENDGÜLTIG gelöscht werden: alles, was in
 * dieser Sitzung als `removed` markiert wurde.
 *
 * Das Overlay-Flag ist seit dem endgültigen Löschen nur noch der
 * ZWISCHENZUSTAND bis zum Speichern — es hält Undo/Redo am Leben, während die
 * Datei noch liegt. Erst das Speichern räumt wirklich weg.
 */
export function idsToDelete(edits: EditOverlay): string[] {
  return Object.entries(edits.media ?? {})
    .filter(([, e]) => e?.removed === true)
    .map(([id]) => id)
}

/**
 * Overlay-Spuren gelöschter Medien tilgen — Gegenstück zu dem, was der Server
 * beim endgültigen Löschen an SEINER Fassung tut (routes/medien.ts).
 *
 * Ein Edit auf eine Datei, die es nicht mehr gibt, ist toter Zustand; ein
 * `cover`, das auf sie zeigt, ließe `bestimmeCover` beim nächsten Render
 * ins Leere greifen, statt ein neues Titelbild zu wählen.
 */
export function withoutMedia(edits: EditOverlay, ids: readonly string[]): EditOverlay {
  const drop = new Set(ids)
  const next: EditOverlay = { ...edits }
  const media = Object.fromEntries(
    Object.entries(edits.media ?? {}).filter(([id]) => !drop.has(id)),
  )
  if (Object.keys(media).length) next.media = media
  else delete next.media
  if (next.cover && drop.has(next.cover)) delete next.cover
  return next
}

/** Grenze setzen/ersetzen (gleicher `from`-Zeitpunkt = ersetzen), sortiert. */
export function withTravelModeBoundary(
  edits: EditOverlay,
  from: string,
  mode: TravelMode,
): EditOverlay {
  const travelModes = (edits.travelModes ?? []).filter((g) => g.from !== from)
  travelModes.push({ from, mode })
  travelModes.sort((a, b) => Date.parse(a.from) - Date.parse(b.from))
  return { ...edits, travelModes }
}

export function withoutTravelModeBoundary(edits: EditOverlay, from: string): EditOverlay {
  const travelModes = (edits.travelModes ?? []).filter((g) => g.from !== from)
  const next: EditOverlay = { ...edits }
  if (travelModes.length) next.travelModes = travelModes
  else delete next.travelModes
  return next
}

/**
 * Die aktuell SICHTBARE Aufteilung als echte Grenzen ins Overlay schreiben.
 *
 * Die Fortbewegungs-Bänder kommen zum großen Teil nicht aus dem Overlay,
 * sondern aus der Aufzeichnung (Segmente + die Gehabschnitts-Automatik des
 * Servers). Solche Kanten ließen sich nicht anfassen: `edits.travelModes` ist eine
 * Stufenfunktion, die AB ihrem Punkt alles Folgende übersteuert — eine einzelne
 * neue Grenze mitten in der erkannten Aufteilung würde die späteren Abschnitte
 * mitreißen. Erst wenn die ganze Aufteilung als Grenzen dasteht, verschiebt ein
 * Zug genau eine Kante und sonst nichts.
 *
 * Bewusst verlustfrei und idempotent: erzeugt wird eine Grenze je Modus-Wechsel
 * (die erste am Tour-Anfang), also genau die Stufenfunktion, die man ohnehin
 * schon sieht. Zweimal angewandt kommt dasselbe heraus.
 */
export function materializeTravelModes(
  edits: EditOverlay,
  segments: readonly EditorSegment[],
  startIso: string,
): EditOverlay {
  const startMs = Date.parse(startIso)
  const boundaries = (edits.travelModes ?? [])
    .map((g) => ({ fromS: (Date.parse(g.from) - startMs) / 1000, mode: g.mode }))
    .filter((g) => Number.isFinite(g.fromS))
    .sort((a, b) => a.fromS - b.fromS)
  const modeAt = (t: number, original: TravelMode): TravelMode => {
    let m = original
    for (const g of boundaries) {
      if (g.fromS <= t) m = g.mode
      else break
    }
    return m
  }

  const travelModes: TravelModeBoundary[] = []
  let last: TravelMode | null = null
  for (const seg of segments) {
    for (const p of seg.pts) {
      const mode = modeAt(p[3], seg.mode)
      if (mode === last) continue
      travelModes.push({ from: offsetToIso(startIso, p[3]), mode })
      last = mode
    }
  }
  return travelModes.length ? { ...edits, travelModes } : edits
}

export function withTourTrim(
  edits: EditOverlay,
  part: 'start' | 'end',
  iso: string | null,
): EditOverlay {
  const trim = { ...(edits.trim ?? {}) }
  if (iso === null) delete trim[part]
  else trim[part] = iso
  const next: EditOverlay = { ...edits }
  if (Object.keys(trim).length) next.trim = trim
  else delete next.trim
  return next
}

/** Grenze setzen/ersetzen (gleicher `from`-Zeitpunkt = ersetzen), sortiert.
 *  skala 1/undefined wird weggelassen — hält das gespeicherte JSON minimal. */
export function withCameraBoundary(
  edits: EditOverlay,
  from: string,
  preset: CameraPreset,
  scale?: number,
): EditOverlay {
  const camera = (edits.camera ?? []).filter((g) => g.from !== from)
  camera.push(scale !== undefined && scale !== 1 ? { from, preset, scale } : { from, preset })
  camera.sort((a, b) => Date.parse(a.from) - Date.parse(b.from))
  return { ...edits, camera }
}

export function withoutCameraBoundary(edits: EditOverlay, from: string): EditOverlay {
  const camera = (edits.camera ?? []).filter((g) => g.from !== from)
  const next: EditOverlay = { ...edits }
  if (camera.length) next.camera = camera
  else delete next.camera
  return next
}

/** Wetter-Grenze setzen/ersetzen (gleicher `from` = ersetzen), sortiert.
 *  staerke undefined wird weggelassen — hält das gespeicherte JSON minimal. */
export function withWeatherBoundary(
  edits: EditOverlay,
  from: string,
  mode: WeatherMode,
  intensity?: number,
): EditOverlay {
  const weather = (edits.weather ?? []).filter((g) => g.from !== from)
  weather.push(intensity !== undefined ? { from, mode, intensity } : { from, mode })
  weather.sort((a, b) => Date.parse(a.from) - Date.parse(b.from))
  return { ...edits, weather }
}

export function withoutWeatherBoundary(edits: EditOverlay, from: string): EditOverlay {
  const weather = (edits.weather ?? []).filter((g) => g.from !== from)
  const next: EditOverlay = { ...edits }
  if (weather.length) next.weather = weather
  else delete next.weather
  return next
}

/** Moment setzen/ersetzen (gleicher `from` = ersetzen), sortiert. */
export function withCameraMoment(
  edits: EditOverlay,
  from: string,
  kind: CameraMomentKind,
  durationS?: number,
): EditOverlay {
  const moments = (edits.moments ?? []).filter((m) => m.from !== from)
  moments.push(durationS !== undefined ? { from, kind, durationS } : { from, kind })
  moments.sort((a, b) => Date.parse(a.from) - Date.parse(b.from))
  return { ...edits, moments }
}

export function withoutCameraMoment(edits: EditOverlay, from: string): EditOverlay {
  const moments = (edits.moments ?? []).filter((m) => m.from !== from)
  const next: EditOverlay = { ...edits }
  if (moments.length) next.moments = moments
  else delete next.moments
  return next
}

// — Audio-Einträge (Identität = Index im Overlay-Array, Reihenfolge stabil) —

export function withAudioEntry(edits: EditOverlay, entry: AudioEntry): EditOverlay {
  return { ...edits, audio: [...(edits.audio ?? []), entry] }
}

/** Patch-Semantik wie MediaEditPatch: Schlüssel vorhanden + undefined = entfernen.
 *  `file`+`source` zusammen ersetzen das STÜCK eines Eintrags, ohne seine
 *  Platzierung (ab/bis/Lautstärke) anzufassen — `source: undefined` heißt dabei
 *  ausdrücklich „tour-lokal" (Schlüssel wird entfernt). */
export interface AudioPatch {
  type?: 'music' | 'sfx'
  from?: string
  to?: string | undefined
  volume?: number | undefined
  file?: string
  source?: 'library' | 'user' | undefined
  anchor?: string | undefined
  offsetFilmS?: number | undefined
  durationFilmS?: number | undefined
  startS?: number | undefined
  loop?: boolean | undefined
}

/**
 * Felder, die `mitAudioPatch` durchreicht. `undefined` im Patch LÖSCHT das Feld
 * — so nimmt ein Trim auf Null-Einstieg den `startS` wieder heraus, statt
 * eine 0 zu hinterlassen, die niemand mehr los wird.
 */
const AUDIO_FIELDS = [
  'type',
  'from',
  'to',
  'volume',
  'file',
  'source',
  'anchor',
  'offsetFilmS',
  'durationFilmS',
  'startS',
  'loop',
] as const

export function mitAudioPatch(edits: EditOverlay, index: number, patch: AudioPatch): EditOverlay {
  const audio = (edits.audio ?? []).map((e, i) => {
    if (i !== index) return e
    const next: AudioEntry = { ...e }
    for (const key of AUDIO_FIELDS) {
      if (!(key in patch)) continue
      const value = patch[key]
      if (value === undefined) delete next[key]
      else (next as unknown as Record<string, unknown>)[key] = value
    }
    // `to` ist die ALTE Endmarke in Aufnahmezeit — ein Effekt hatte nie eine.
    // Seine Länge (falls getrimmt) steht seit Etappe 4 in `durationFilmS`.
    if (next.type === 'sfx') delete next.to
    return next
  })
  return { ...edits, audio }
}

export function withoutAudioEntry(edits: EditOverlay, index: number): EditOverlay {
  const audio = (edits.audio ?? []).filter((_, i) => i !== index)
  const next: EditOverlay = { ...edits }
  if (audio.length) next.audio = audio
  else delete next.audio
  return next
}

/** Semantik-Prüfung vor dem Speichern (Spiegel der Server-Prüfung). */
export function validateOverlay(edits: EditOverlay): string | null {
  const { start, end } = edits.trim ?? {}
  if (start !== undefined && end !== undefined && Date.parse(start) >= Date.parse(end)) {
    return 'Trim-Start muss vor dem Trim-Ende liegen'
  }
  // Mengen-Limits des Server-Schemas gespiegelt — sonst käme beim Speichern
  // nur ein generisches „Ungültige Anfrage" zurück
  if ((edits.travelModes ?? []).length > 200) return 'Zu viele Modus-Grenzen (maximal 200)'
  if ((edits.camera ?? []).length > 100) return 'Zu viele Kamera-Grenzen (maximal 100)'
  if ((edits.moments ?? []).length > 100) return 'Zu viele Kamera-Momente (maximal 100)'
  if ((edits.audio ?? []).length > 50) return 'Zu viele Audio-Einträge (maximal 50)'
  if ((edits.weather ?? []).length > 200) return 'Zu viele Wetter-Grenzen (maximal 200)'
  for (const g of edits.weather ?? []) {
    if (!Number.isFinite(Date.parse(g.from))) return `Unparsebare Wetter-Grenze: ${g.from}`
    if (
      g.intensity !== undefined &&
      !(Number.isFinite(g.intensity) && g.intensity >= 0 && g.intensity <= 1)
    ) {
      return `Wetter-Stärke muss zwischen 0 und 1 liegen`
    }
  }
  for (const g of edits.camera ?? []) {
    if (!Number.isFinite(Date.parse(g.from))) return `Unparsebare Kamera-Grenze: ${g.from}`
    if (g.scale !== undefined && !(Number.isFinite(g.scale) && g.scale >= 0.5 && g.scale <= 2)) {
      return `Kamera-Feinjustierung muss zwischen 0.5 und 2 liegen`
    }
  }
  for (const m of edits.moments ?? []) {
    if (!Number.isFinite(Date.parse(m.from))) return `Unparsebarer Kamera-Moment: ${m.from}`
    if (
      m.durationS !== undefined &&
      !(Number.isFinite(m.durationS) && m.durationS >= 1 && m.durationS <= 30)
    ) {
      return `Moment-Dauer muss zwischen 1 und 30 Sekunden liegen`
    }
  }
  for (const [i, a] of (edits.audio ?? []).entries()) {
    if (!Number.isFinite(Date.parse(a.from))) return `Audio ${i + 1}: unparsebarer Beginn`
    if (a.to !== undefined) {
      if (a.type !== 'music') return `Audio ${i + 1}: ein Ende gibt es nur für Musik`
      if (!Number.isFinite(Date.parse(a.to))) return `Audio ${i + 1}: unparsebares Ende`
      if (Date.parse(a.to) <= Date.parse(a.from))
        return `Audio ${i + 1}: das Ende muss nach dem Beginn liegen`
    }
    if (a.volume !== undefined && !(Number.isFinite(a.volume) && a.volume >= 0 && a.volume <= 1)) {
      return `Audio ${i + 1}: Lautstärke muss zwischen 0 und 1 liegen`
    }
  }
  for (const [id, m] of Object.entries(edits.media ?? {})) {
    const holdS = m.display?.holdS
    if (holdS !== undefined && !(Number.isFinite(holdS) && holdS >= 2 && holdS <= 60)) {
      return `Haltedauer für ${id} muss zwischen 2 und 60 Sekunden liegen`
    }
    if (m.caption !== undefined && m.caption.length > 1000) {
      return `Beschreibung für ${id} ist zu lang (maximal 1000 Zeichen)`
    }
  }
  return null
}

// — Anzeige: Track in Abschnitte gleichen Zustands zerlegen —

export interface DisplaySegment {
  mode: TravelMode
  /** false = liegt außerhalb der Trim-Spanne (wird grau gezeichnet) */
  active: boolean
  pts: TrackPoint[]
}

/**
 * Für die Karten-Anzeige: Punkte nach effektivem Modus (Grenzen) und
 * Trim-Zustand gruppieren. Anders als serverseitig teilen benachbarte
 * Abschnitte ihren Randpunkt — die Linie bleibt optisch verbunden.
 *
 * Grenzen zwischen zwei Stützpunkten werden AUF die Linie interpoliert —
 * sonst sprang Kante und farbiger Track nur von Punkt zu Punkt (auf dünnen
 * Alpen-Tracks in großen Schritten; auf Hin-/Rückwegen wirkte der
 * plötzliche Farbwechsel wie eine verdoppelte Spur neben der Gegenrichtung).
 */
export function splitForDisplay(
  segments: readonly EditorSegment[],
  edits: EditOverlay,
  startIso: string,
): DisplaySegment[] {
  const startMs = Date.parse(startIso)
  const boundaries = (edits.travelModes ?? [])
    .map((g) => ({ fromS: (Date.parse(g.from) - startMs) / 1000, mode: g.mode }))
    .filter((g) => Number.isFinite(g.fromS))
    .sort((a, b) => a.fromS - b.fromS)
  const trimFromS =
    edits.trim?.start !== undefined ? isoToOffset(startIso, edits.trim.start) : -Infinity
  const trimToS = edits.trim?.end !== undefined ? isoToOffset(startIso, edits.trim.end) : Infinity

  const modeAt = (t: number, original: TravelMode): TravelMode => {
    let m = original
    for (const g of boundaries) {
      if (g.fromS <= t) m = g.mode
      else break
    }
    return m
  }

  /** Zustandswechsel streng zwischen zwei Stützpunkt-Zeiten (Endpunkte zählen dort selbst). */
  const splitsBetween = (fromS: number, toS: number): number[] => {
    if (!(toS > fromS)) return []
    const times: number[] = []
    for (const g of boundaries) {
      if (g.fromS > fromS && g.fromS < toS) times.push(g.fromS)
    }
    if (Number.isFinite(trimFromS) && trimFromS > fromS && trimFromS < toS) times.push(trimFromS)
    if (Number.isFinite(trimToS) && trimToS > fromS && trimToS < toS) times.push(trimToS)
    times.sort((a, b) => a - b)
    return times.filter((t, i) => i === 0 || t !== times[i - 1])
  }

  const pointAt = (a: TrackPoint, b: TrackPoint, t: number): TrackPoint => {
    const span = b[3] - a[3]
    const f = span === 0 ? 0 : (t - a[3]) / span
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, t]
  }

  const displaySegments: DisplaySegment[] = []
  for (const seg of segments) {
    let current: DisplaySegment | null = null
    const take = (p: TrackPoint): void => {
      const mode = modeAt(p[3], seg.mode)
      const active = p[3] >= trimFromS && p[3] <= trimToS
      if (!current || current.mode !== mode || current.active !== active) {
        // Der Verbinder zum Wechselpunkt gehört der ALTEN Gruppe (Grenzen
        // wirken AB ihrem Punkt) — außer beim Austritt in den Trim: dort
        // wird er grau, also Teil der neuen (inaktiven) Gruppe.
        if (current && current.active && !active) {
          const last = current.pts[current.pts.length - 1] as TrackPoint
          current = { mode, active, pts: [last, p] }
        } else {
          current?.pts.push(p)
          current = { mode, active, pts: [p] }
        }
        displaySegments.push(current)
      } else {
        current.pts.push(p)
      }
    }
    for (let i = 0; i < seg.pts.length; i++) {
      const p = seg.pts[i] as TrackPoint
      if (i > 0) {
        const prev = seg.pts[i - 1] as TrackPoint
        for (const t of splitsBetween(prev[3], p[3])) take(pointAt(prev, p, t))
      }
      take(p)
    }
  }
  // Ein-Punkt-Abschnitte zeichnen keine Linie — raus damit
  const raw = displaySegments.filter((a) => a.pts.length >= 2)
  // Segmente der Tempo-Automatik werden einzeln durchlaufen. Verschiebt man eine
  // Overlay-Grenze ÜBER eine alte Segmentnaht, liegen zwei Abschnitte desselben
  // Modus nebeneinander — auf der Leiste zwei Bänder mit Radius-Naht dazwischen,
  // ohne Kante (gleicher Modus) und nicht anfassbar. Für Karte und Leiste
  // zusammenführen.
  const merged: DisplaySegment[] = []
  for (const a of raw) {
    const prev = merged[merged.length - 1]
    if (prev && prev.mode === a.mode && prev.active === a.active) {
      const first = a.pts[0] as TrackPoint
      const last = prev.pts[prev.pts.length - 1] as TrackPoint
      prev.pts.push(...(first[3] === last[3] ? a.pts.slice(1) : a.pts))
    } else {
      merged.push({ mode: a.mode, active: a.active, pts: a.pts.slice() })
    }
  }
  return merged
}

// — Anzeige: effektiver Medien-Zustand (Basis + Overlay) —

export interface MediaBase {
  id: string
  type: 'photo' | 'video'
  src: string
  poster?: string
  /** Kachel-Fassung für Miniaturen; fehlt bei unaufbereitetem Altbestand */
  thumb?: string
  /**
   * Echte Länge eines Videos in Sekunden (nur typ=video). Fehlt bei
   * unverarbeitetem Altbestand — dann rechnet die Zeitleiste mit der
   * Foto-Standzeit weiter, was für ein langes Video sichtbar zu wenig ist.
   */
  durationS?: number
  takenAt: string
  caption: string
  anchor: [number, number] | null
  placement: string
  /** roher GPS-Anker aus dem Manifest (auch wenn die Auto-Platzierung ihn verwarf) */
  gpsAnchor?: [number, number]
}

/**
 * Bildquelle für eine MINIATUR (Zeitleiste, Ablage, Streifen, Zieh-Geist).
 *
 * Ohne diese Wahl zieht jede Miniatur das Foto in Anzeigegröße — bei zwanzig
 * Aufnahmen lädt der Editor dann beim Öffnen ein Vielfaches dessen, was er
 * zeigt. Fehlt die Kachel-Fassung (Tour von vor der Aufbereitung), bleibt es
 * beim bisherigen Bild: lieber groß als gar nicht.
 */
export function thumbnailSource(m: Pick<MediaBase, 'type' | 'src' | 'poster' | 'thumb'>): string {
  return m.thumb ?? (m.type === 'video' ? (m.poster ?? m.src) : m.src)
}

export interface MediaView extends MediaBase {
  removed: boolean
  display?: DisplayEdit
  /** Platz im Stopp, falls gesetzt (s. MediumEdit.order) */
  order?: number
  /** Video-Schnitt aus dem Overlay (s. MediumEdit.trim) */
  trim?: { fromS: number; toS?: number }
}

/** Overlay auf die Auto-Platzierung legen; Gelöschte bleiben (markiert) drin. */
export function effectiveMedia(base: readonly MediaBase[], edits: EditOverlay): MediaView[] {
  return base.map((m) => {
    const e = edits.media?.[m.id]
    return {
      ...m,
      caption: e?.caption !== undefined ? e.caption : m.caption,
      anchor: e?.anchor ?? m.anchor,
      placement: e?.anchor ? 'manual' : m.placement,
      removed: e?.removed === true,
      ...(e?.display ? { display: e.display } : {}),
      ...(e?.order !== undefined ? { order: e.order } : {}),
      ...(e?.trim ? { trim: e.trim } : {}),
    }
  })
}
