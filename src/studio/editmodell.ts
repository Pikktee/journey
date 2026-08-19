// Editor-Modell (M7): reine Funktionen über Track + Edit-Overlay. Spiegelt für
// die ANZEIGE die Server-Anwendung (pipeline/edits.ts: Trim → Modus-Grenzen)
// und mutiert das Overlay immutabel — die DOM-/Karten-Verdrahtung liegt in
// editor.ts, damit alles hier unter Vitest testbar bleibt.
//
// Wie serverseitig gilt: Edits referenzieren stabile Anker (Medien-IDs,
// Koordinaten, absolute Zeitstempel), nie den Streckenanteil f.

import { MOMENT_DEFAULT_S as ENGINE_MOMENT_DEFAULT_S } from '../filmachse.js'

/**
 * Fortbewegungs-Modi — deckungsgleich mit MODI in server/src/schema/upload.ts
 * und mit der Player-Engine (MODUS_TEMPO in src/filmachse.ts, MODE_SCALE in
 * src/tour.ts). Reihenfolge
 * wie in der UI: unmotorisiert → motorisiert → öffentlich → Wasser.
 * Ein Drift-Wächter in test/studio-baukasten.test.ts vergleicht die Liste mit
 * der Engine — sie lief schon einmal auseinander (Studio kannte moped/jeep nicht,
 * obwohl Engine, Icons und Motorsound sie längst hatten).
 */
export const MODI = ['walk', 'bike', 'moped', 'jeep', 'tram', 'ferry'] as const

export type Modus = (typeof MODI)[number]

/**
 * Wetter-Modi — deckungsgleich mit WETTER_MODI in server/src/pipeline/weather.ts
 * (und der Wetterwelt des Players in src/weather.js). Ein Drift-Wächter in
 * test/studio-baukasten.test.ts vergleicht die Liste mit dem Server.
 */
export const WETTER_MODI = ['off', 'clouds', 'fog', 'rain', 'snow', 'storm'] as const
export type WetterModus = (typeof WETTER_MODI)[number]

/** Trackpunkt der Editor-Daten: [lng, lat, ele, tOffsetS] */
export type TrackPunkt = [number, number, number, number]

/** Anzeigeoptionen eines Fotos (holdS = Haltedauer in s, kenBurns aus = statisch) */
export interface DisplayEdit {
  holdS?: number
  kenBurns?: boolean
}

export interface MediumEdit {
  caption?: string
  anchor?: [number, number]
  geloescht?: boolean
  display?: DisplayEdit
  /**
   * Platz INNERHALB des Stopps (0-basiert). Fotos am selben Ort zeigt der Player
   * nacheinander; welches zuerst kommt, ist eine Entscheidung und keine Messung —
   * ohne dieses Feld entschiede die Projektion auf die Route darüber.
   * Spiegel von MediumEdit.reihe in server/src/schema/edits.ts.
   */
  reihe?: number
  /**
   * Schnitt eines Videos in DATEI-Sekunden (Etappe 4, docs §2F). Anschlag ist
   * an beiden Kanten das Material; Loop gibt es hier nicht — bei einem Video
   * wäre er Unsinn. Angewandt wird der Schnitt in der Pipeline (video.ts).
   * Spiegel von MediumEdit.trim in server/src/schema/edits.ts.
   */
  trim?: { vonS: number; bisS?: number }
}

export interface ModusGrenze {
  ab: string
  mode: Modus
}

/**
 * Wetter-Override ab einem absoluten Zeitpunkt — gilt bis zur nächsten Grenze.
 * Sobald eine Wetter-Grenze existiert, ersetzt das Overlay das Auto-Wetter
 * vollständig (Grund vor der ersten Grenze = klar). Spiegel von WetterGrenze in
 * server/src/schema/edits.ts.
 */
export interface WetterGrenze {
  ab: string
  mode: WetterModus
  /** Stärke k (0..1); fehlt = Standardstärke des Players */
  staerke?: number
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
 * Erwartet aufsteigend sortierte Grenzen — so schreibt `mitWetterGrenze` sie,
 * und so liefert der Server sein Auto-Wetter.
 */
export function wetterBeiZeit(grenzen: readonly WetterGrenze[], iso: string): WetterGrenze | null {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  let gilt: WetterGrenze | null = null
  for (const g of grenzen) {
    if (Date.parse(g.ab) > t) break
    gilt = g
  }
  return gilt
}

/**
 * Kamera-Abstand einer Grenze. `standard` ist ein WERT wie die anderen drei und
 * nicht die Abwesenheit eines Werts: Er sagt „hier gilt, was der Zuschauer im
 * Player eingestellt hat". Ohne ihn war Standard nur der Zustand VOR der ersten
 * Grenze — man kam nicht dorthin zurück, ohne das Band zu löschen, und ein
 * gelöschtes Band nahm die Stelle mit, an der es stand.
 */
export type KameraPreset = 'nah' | 'mittel' | 'weit' | 'standard'

/** Kamera-Preset ab einem absoluten Zeitpunkt — gilt bis zur nächsten Grenze. */
export interface KameraGrenze {
  ab: string
  preset: KameraPreset
  /**
   * Stufenlose Feinjustierung von Abstand UND Höhe (0.5 = halb so weit weg,
   * 2 = doppelt). Fehlt oder 1 = Preset unverändert. Multipliziert im Player die
   * behind/hover-Werte des Presets (setPreset in src/tour.js).
   */
  skala?: number
}

/**
 * Kamera-Moment: an einem Punkt hält die Fahrt kurz an und die Kamera führt
 * eine dramatische Bewegung aus. Punkt-Ereignis (kein Band) — verankert am
 * absoluten Zeitpunkt wie eine Grenze.
 */
export type MomentArt = 'umkreisen' | 'aufstieg' | 'innehalten'
export interface KameraMoment {
  ab: string
  art: MomentArt
  /** Dauer in s; fehlt = Default der Art (siehe MOMENT_DEFAULT_S). */
  dauerS?: number
}

/**
 * Default-Dauern je Moment-Art (s) — KEINE Kopie mehr, sondern dieselbe Tabelle,
 * aus der auch die Engine liest (src/filmachse.ts, seit Paket D). Der Name bleibt
 * hier stehen, er steht im ganzen Editor.
 */
export const MOMENT_DEFAULT_S: Record<MomentArt, number> = ENGINE_MOMENT_DEFAULT_S

/** Platziertes Audio-Asset: Musik mit Bereich [ab,bis], SFX als Einzelschuss. */
export interface AudioEintrag {
  datei: string
  typ: 'musik' | 'sfx'
  ab: string
  bis?: string
  lautstaerke?: number
  /**
   * Herkunft der Datei. Fehlt = tour-lokal hochgeladen (→ /api/media/…).
   * 'bibliothek' = kuratierter Effekt aus [[sfxbibliothek]] (→ /audio/sfx/…),
   * liegt global und wird nicht mit der Tour hochgeladen.
   * 'benutzer' = eigener Upload in der benutzerweiten Bibliothek — liegt einmal
   * beim Konto und ist in jeder Tour einsetzbar (→ /api/audio-bibliothek/…).
   */
  quelle?: 'bibliothek' | 'benutzer'
  /**
   * Verankerung an der REISE statt an einer Filmsekunde (Etappe 4, docs §2E) —
   * der „connected clip". `anker` ist die Stelle der Reise (Aufnahmezeit),
   * `versatzFilmS` die Feinlage in FILMsekunden (darf in einer Standzeit
   * liegen), `dauerFilmS` die Länge im Film. Alle drei haben Vorrang vor
   * `ab`/`bis`; fehlen sie, gilt die alte Verankerung unverändert weiter.
   * Rechnende Teile in [[tonklip]].
   */
  anker?: string
  versatzFilmS?: number
  dauerFilmS?: number
  /** Einstieg in die DATEI (s) — der linke Trim. Anschlag: der Dateianfang. */
  einstiegS?: number
  /** Wiederholung über das Dateiende hinaus; fehlt = Musik ja, Effekt nein. */
  loop?: boolean
}

export interface EditOverlay {
  schema: 'maptale/edits@1'
  medien?: Record<string, MediumEdit>
  modi?: ModusGrenze[]
  trim?: { start?: string; ende?: string }
  kamera?: KameraGrenze[]
  momente?: KameraMoment[]
  audio?: AudioEintrag[]
  wetter?: WetterGrenze[]
  /**
   * Selbst gewähltes Titelbild (Medien-ID). Der Editor SETZT es (noch) nicht,
   * aber das Overlay läuft durch ihn hindurch — und wer ein Medium endgültig
   * löscht, muss den Verweis mitnehmen, sonst griffe `bestimmeCover` beim
   * nächsten Render ins Leere, statt ein neues Titelbild zu wählen.
   */
  titelbild?: string
}

export interface EditorSegment {
  mode: Modus
  pts: TrackPunkt[]
}

export const LEERES_OVERLAY: EditOverlay = { schema: 'maptale/edits@1' }

// — Undo: das Overlay ist immutabel, ein Stapel von Ständen genügt —

/** Maximale Undo-Tiefe — Overlays sind klein, aber unbegrenzt wächst unschön. */
export const HISTORIE_MAX = 100

export interface UndoStapel {
  /** frühere Stände, ältester zuerst */
  historie: EditOverlay[]
  /** zurückgenommene Stände (Redo), jüngster zuletzt */
  zukunft: EditOverlay[]
}

/**
 * Undo-Punkt setzen, wenn sich das Overlay seit dem letzten VOLL-Render
 * geändert hat — Referenzvergleich, kein Vergleich der Inhalte: das Overlay
 * wird immutabel fortgeschrieben, also ist eine neue Referenz genau eine
 * Änderung, egal aus welchem Handler sie kam.
 *
 * Daran hängt der Vertrag „ein Zug = ein Undo-Schritt": Ein Zeitleisten-Zug
 * schreibt je Frame ein neues Overlay, ruft dazwischen aber nur
 * `renderNachZug()` (das den Stand NICHT fortschreibt). Erst das abschließende
 * `renderAlles` kommt hier vorbei und legt den EINEN Stand von vor dem Zug ab.
 */
export function erfasseUndo(
  stapel: UndoStapel,
  letzterStand: EditOverlay | null,
  edits: EditOverlay,
): void {
  if (!letzterStand || letzterStand === edits) return
  stapel.historie.push(letzterStand)
  if (stapel.historie.length > HISTORIE_MAX) stapel.historie.shift()
  stapel.zukunft.length = 0
}

// — Zeit-Umrechnung —

/** tOffset (s ab time.start) → absolute ISO-Zeit (UTC, sekundengenau). */
export function offsetZuIso(startIso: string, tOffsetS: number): string {
  return new Date(Date.parse(startIso) + tOffsetS * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/** absolute ISO-Zeit → tOffset (s ab time.start); NaN bei Unparsebarem. */
export function isoZuOffset(startIso: string, iso: string): number {
  return (Date.parse(iso) - Date.parse(startIso)) / 1000
}

// — Geometrie —

export interface TrackProjektion {
  /** interpolierter Punkt AUF der Track-Linie (inkl. tOffset) */
  punkt: TrackPunkt
  /** Index des Anfangspunkts des getroffenen Liniensegments */
  index: number
}

/**
 * Lotfußpunkt von [lng,lat] auf die Track-LINIE (lokale Plattkarte). Anders
 * als naechsterPunktIndex wird zwischen den Stützpunkten interpoliert — der
 * Editor-Track ist Douglas-Peucker-vereinfacht, auf Geraden (Fähre!) liegen
 * Stützpunkte kilometerweit auseinander; ein Vertex-Snap versetzte Anker dort
 * um ganze Kilometer (Bughunt-Befund).
 */
export function projiziereAufTrack(
  punkte: readonly TrackPunkt[],
  lng: number,
  lat: number,
): TrackProjektion {
  if (punkte.length < 2) {
    const p = punkte[0] ?? [lng, lat, 0, 0]
    return { punkt: [p[0], p[1], p[2], p[3]], index: 0 }
  }
  const kx = Math.cos(((punkte[0]?.[1] ?? lat) * Math.PI) / 180)
  const px = lng * kx
  let best: TrackProjektion = { punkt: [...(punkte[0] as TrackPunkt)] as TrackPunkt, index: 0 }
  let bestD = Infinity
  for (let i = 0; i < punkte.length - 1; i++) {
    const a = punkte[i] as TrackPunkt
    const b = punkte[i + 1] as TrackPunkt
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
        punkt: [
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
export function punktZuOffset(punkte: readonly TrackPunkt[], tOffsetS: number): TrackPunkt | null {
  const erster = punkte[0]
  const letzter = punkte[punkte.length - 1]
  if (!erster || !letzter) return null
  if (tOffsetS <= erster[3]) return [...erster] as TrackPunkt
  if (tOffsetS >= letzter[3]) return [...letzter] as TrackPunkt
  for (let i = 1; i < punkte.length; i++) {
    const a = punkte[i - 1] as TrackPunkt
    const b = punkte[i] as TrackPunkt
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
  return [...letzter] as TrackPunkt
}

/** Index des Trackpunkts, der [lng,lat] am nächsten liegt (lokale Plattkarte). */
export function naechsterPunktIndex(
  punkte: readonly TrackPunkt[],
  lng: number,
  lat: number,
): number {
  const kx = Math.cos(((punkte[0]?.[1] ?? lat) * Math.PI) / 180)
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < punkte.length; i++) {
    const p = punkte[i] as TrackPunkt
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
export interface MediumEditPatch {
  caption?: string | undefined
  anchor?: [number, number] | undefined
  trim?: { vonS: number; bisS?: number } | undefined
  geloescht?: boolean | undefined
  display?: DisplayEdit | undefined
  reihe?: number | undefined
}

export function mitMedienEdit(edits: EditOverlay, id: string, patch: MediumEditPatch): EditOverlay {
  const eintrag: MediumEdit = { ...(edits.medien?.[id] ?? {}) }
  for (const key of ['caption', 'anchor', 'geloescht', 'display', 'reihe', 'trim'] as const) {
    if (!(key in patch)) continue
    const wert = patch[key]
    const leeresDisplay = key === 'display' && wert !== undefined && !Object.keys(wert).length
    if (wert === undefined || wert === false || leeresDisplay) delete eintrag[key]
    else (eintrag as Record<string, unknown>)[key] = wert
  }
  const medien = { ...(edits.medien ?? {}) }
  if (Object.keys(eintrag).length) medien[id] = eintrag
  else delete medien[id]
  const naechste: EditOverlay = { ...edits }
  if (Object.keys(medien).length) naechste.medien = medien
  else delete naechste.medien
  return naechste
}

/**
 * Die Medien, die beim Speichern ENDGÜLTIG gelöscht werden: alles, was in
 * dieser Sitzung als `geloescht` markiert wurde.
 *
 * Das Overlay-Flag ist seit dem endgültigen Löschen nur noch der
 * ZWISCHENZUSTAND bis zum Speichern — es hält Undo/Redo am Leben, während die
 * Datei noch liegt. Erst das Speichern räumt wirklich weg.
 */
export function endgueltigZuLoeschen(edits: EditOverlay): string[] {
  return Object.entries(edits.medien ?? {})
    .filter(([, e]) => e?.geloescht === true)
    .map(([id]) => id)
}

/**
 * Overlay-Spuren gelöschter Medien tilgen — Gegenstück zu dem, was der Server
 * beim endgültigen Löschen an SEINER Fassung tut (routes/media.ts).
 *
 * Ein Edit auf eine Datei, die es nicht mehr gibt, ist toter Zustand; ein
 * `titelbild`, das auf sie zeigt, ließe `bestimmeCover` beim nächsten Render
 * ins Leere greifen, statt ein neues Titelbild zu wählen.
 */
export function ohneMedien(edits: EditOverlay, ids: readonly string[]): EditOverlay {
  const weg = new Set(ids)
  const naechste: EditOverlay = { ...edits }
  const medien = Object.fromEntries(
    Object.entries(edits.medien ?? {}).filter(([id]) => !weg.has(id)),
  )
  if (Object.keys(medien).length) naechste.medien = medien
  else delete naechste.medien
  if (naechste.titelbild && weg.has(naechste.titelbild)) delete naechste.titelbild
  return naechste
}

/** Grenze setzen/ersetzen (gleicher `ab`-Zeitpunkt = ersetzen), sortiert. */
export function mitModusGrenze(edits: EditOverlay, ab: string, mode: Modus): EditOverlay {
  const modi = (edits.modi ?? []).filter((g) => g.ab !== ab)
  modi.push({ ab, mode })
  modi.sort((a, b) => Date.parse(a.ab) - Date.parse(b.ab))
  return { ...edits, modi }
}

export function ohneModusGrenze(edits: EditOverlay, ab: string): EditOverlay {
  const modi = (edits.modi ?? []).filter((g) => g.ab !== ab)
  const naechste: EditOverlay = { ...edits }
  if (modi.length) naechste.modi = modi
  else delete naechste.modi
  return naechste
}

/**
 * Die aktuell SICHTBARE Aufteilung als echte Grenzen ins Overlay schreiben.
 *
 * Die Fortbewegungs-Bänder kommen zum großen Teil nicht aus dem Overlay,
 * sondern aus der Aufzeichnung (Segmente + die Gehabschnitts-Automatik des
 * Servers). Solche Kanten ließen sich nicht anfassen: `edits.modi` ist eine
 * Stufenfunktion, die AB ihrem Punkt alles Folgende übersteuert — eine einzelne
 * neue Grenze mitten in der erkannten Aufteilung würde die späteren Abschnitte
 * mitreißen. Erst wenn die ganze Aufteilung als Grenzen dasteht, verschiebt ein
 * Zug genau eine Kante und sonst nichts.
 *
 * Bewusst verlustfrei und idempotent: erzeugt wird eine Grenze je Modus-Wechsel
 * (die erste am Tour-Anfang), also genau die Stufenfunktion, die man ohnehin
 * schon sieht. Zweimal angewandt kommt dasselbe heraus.
 */
export function materialisiereModi(
  edits: EditOverlay,
  segmente: readonly EditorSegment[],
  startIso: string,
): EditOverlay {
  const startMs = Date.parse(startIso)
  const grenzen = (edits.modi ?? [])
    .map((g) => ({ abS: (Date.parse(g.ab) - startMs) / 1000, mode: g.mode }))
    .filter((g) => Number.isFinite(g.abS))
    .sort((a, b) => a.abS - b.abS)
  const modusZu = (t: number, original: Modus): Modus => {
    let m = original
    for (const g of grenzen) {
      if (g.abS <= t) m = g.mode
      else break
    }
    return m
  }

  const modi: ModusGrenze[] = []
  let letzter: Modus | null = null
  for (const seg of segmente) {
    for (const p of seg.pts) {
      const mode = modusZu(p[3], seg.mode)
      if (mode === letzter) continue
      modi.push({ ab: offsetZuIso(startIso, p[3]), mode })
      letzter = mode
    }
  }
  return modi.length ? { ...edits, modi } : edits
}

export function mitTrim(
  edits: EditOverlay,
  teil: 'start' | 'ende',
  iso: string | null,
): EditOverlay {
  const trim = { ...(edits.trim ?? {}) }
  if (iso === null) delete trim[teil]
  else trim[teil] = iso
  const naechste: EditOverlay = { ...edits }
  if (Object.keys(trim).length) naechste.trim = trim
  else delete naechste.trim
  return naechste
}

/** Grenze setzen/ersetzen (gleicher `ab`-Zeitpunkt = ersetzen), sortiert.
 *  skala 1/undefined wird weggelassen — hält das gespeicherte JSON minimal. */
export function mitKameraGrenze(
  edits: EditOverlay,
  ab: string,
  preset: KameraPreset,
  skala?: number,
): EditOverlay {
  const kamera = (edits.kamera ?? []).filter((g) => g.ab !== ab)
  kamera.push(skala !== undefined && skala !== 1 ? { ab, preset, skala } : { ab, preset })
  kamera.sort((a, b) => Date.parse(a.ab) - Date.parse(b.ab))
  return { ...edits, kamera }
}

export function ohneKameraGrenze(edits: EditOverlay, ab: string): EditOverlay {
  const kamera = (edits.kamera ?? []).filter((g) => g.ab !== ab)
  const naechste: EditOverlay = { ...edits }
  if (kamera.length) naechste.kamera = kamera
  else delete naechste.kamera
  return naechste
}

/** Wetter-Grenze setzen/ersetzen (gleicher `ab` = ersetzen), sortiert.
 *  staerke undefined wird weggelassen — hält das gespeicherte JSON minimal. */
export function mitWetterGrenze(
  edits: EditOverlay,
  ab: string,
  mode: WetterModus,
  staerke?: number,
): EditOverlay {
  const wetter = (edits.wetter ?? []).filter((g) => g.ab !== ab)
  wetter.push(staerke !== undefined ? { ab, mode, staerke } : { ab, mode })
  wetter.sort((a, b) => Date.parse(a.ab) - Date.parse(b.ab))
  return { ...edits, wetter }
}

export function ohneWetterGrenze(edits: EditOverlay, ab: string): EditOverlay {
  const wetter = (edits.wetter ?? []).filter((g) => g.ab !== ab)
  const naechste: EditOverlay = { ...edits }
  if (wetter.length) naechste.wetter = wetter
  else delete naechste.wetter
  return naechste
}

/** Moment setzen/ersetzen (gleicher `ab` = ersetzen), sortiert. */
export function mitMoment(
  edits: EditOverlay,
  ab: string,
  art: MomentArt,
  dauerS?: number,
): EditOverlay {
  const momente = (edits.momente ?? []).filter((m) => m.ab !== ab)
  momente.push(dauerS !== undefined ? { ab, art, dauerS } : { ab, art })
  momente.sort((a, b) => Date.parse(a.ab) - Date.parse(b.ab))
  return { ...edits, momente }
}

export function ohneMoment(edits: EditOverlay, ab: string): EditOverlay {
  const momente = (edits.momente ?? []).filter((m) => m.ab !== ab)
  const naechste: EditOverlay = { ...edits }
  if (momente.length) naechste.momente = momente
  else delete naechste.momente
  return naechste
}

// — Audio-Einträge (Identität = Index im Overlay-Array, Reihenfolge stabil) —

export function mitAudioEintrag(edits: EditOverlay, eintrag: AudioEintrag): EditOverlay {
  return { ...edits, audio: [...(edits.audio ?? []), eintrag] }
}

/** Patch-Semantik wie MediumEditPatch: Schlüssel vorhanden + undefined = entfernen.
 *  `datei`+`quelle` zusammen ersetzen das STÜCK eines Eintrags, ohne seine
 *  Platzierung (ab/bis/Lautstärke) anzufassen — `quelle: undefined` heißt dabei
 *  ausdrücklich „tour-lokal" (Schlüssel wird entfernt). */
export interface AudioPatch {
  typ?: 'musik' | 'sfx'
  ab?: string
  bis?: string | undefined
  lautstaerke?: number | undefined
  datei?: string
  quelle?: 'bibliothek' | 'benutzer' | undefined
  anker?: string | undefined
  versatzFilmS?: number | undefined
  dauerFilmS?: number | undefined
  einstiegS?: number | undefined
  loop?: boolean | undefined
}

/**
 * Felder, die `mitAudioPatch` durchreicht. `undefined` im Patch LÖSCHT das Feld
 * — so nimmt ein Trim auf Null-Einstieg den `einstiegS` wieder heraus, statt
 * eine 0 zu hinterlassen, die niemand mehr los wird.
 */
const AUDIO_FELDER = [
  'typ',
  'ab',
  'bis',
  'lautstaerke',
  'datei',
  'quelle',
  'anker',
  'versatzFilmS',
  'dauerFilmS',
  'einstiegS',
  'loop',
] as const

export function mitAudioPatch(edits: EditOverlay, index: number, patch: AudioPatch): EditOverlay {
  const audio = (edits.audio ?? []).map((e, i) => {
    if (i !== index) return e
    const neu: AudioEintrag = { ...e }
    for (const key of AUDIO_FELDER) {
      if (!(key in patch)) continue
      const wert = patch[key]
      if (wert === undefined) delete neu[key]
      else (neu as unknown as Record<string, unknown>)[key] = wert
    }
    // `bis` ist die ALTE Endmarke in Aufnahmezeit — ein Effekt hatte nie eine.
    // Seine Länge (falls getrimmt) steht seit Etappe 4 in `dauerFilmS`.
    if (neu.typ === 'sfx') delete neu.bis
    return neu
  })
  return { ...edits, audio }
}

export function ohneAudioEintrag(edits: EditOverlay, index: number): EditOverlay {
  const audio = (edits.audio ?? []).filter((_, i) => i !== index)
  const naechste: EditOverlay = { ...edits }
  if (audio.length) naechste.audio = audio
  else delete naechste.audio
  return naechste
}

/** Semantik-Prüfung vor dem Speichern (Spiegel der Server-Prüfung). */
export function pruefeOverlay(edits: EditOverlay): string | null {
  const { start, ende } = edits.trim ?? {}
  if (start !== undefined && ende !== undefined && Date.parse(start) >= Date.parse(ende)) {
    return 'Trim-Start muss vor dem Trim-Ende liegen'
  }
  // Mengen-Limits des Server-Schemas gespiegelt — sonst käme beim Speichern
  // nur ein generisches „Ungültige Anfrage" zurück
  if ((edits.modi ?? []).length > 200) return 'Zu viele Modus-Grenzen (maximal 200)'
  if ((edits.kamera ?? []).length > 100) return 'Zu viele Kamera-Grenzen (maximal 100)'
  if ((edits.momente ?? []).length > 100) return 'Zu viele Kamera-Momente (maximal 100)'
  if ((edits.audio ?? []).length > 50) return 'Zu viele Audio-Einträge (maximal 50)'
  if ((edits.wetter ?? []).length > 200) return 'Zu viele Wetter-Grenzen (maximal 200)'
  for (const g of edits.wetter ?? []) {
    if (!Number.isFinite(Date.parse(g.ab))) return `Unparsebare Wetter-Grenze: ${g.ab}`
    if (
      g.staerke !== undefined &&
      !(Number.isFinite(g.staerke) && g.staerke >= 0 && g.staerke <= 1)
    ) {
      return `Wetter-Stärke muss zwischen 0 und 1 liegen`
    }
  }
  for (const g of edits.kamera ?? []) {
    if (!Number.isFinite(Date.parse(g.ab))) return `Unparsebare Kamera-Grenze: ${g.ab}`
    if (g.skala !== undefined && !(Number.isFinite(g.skala) && g.skala >= 0.5 && g.skala <= 2)) {
      return `Kamera-Feinjustierung muss zwischen 0.5 und 2 liegen`
    }
  }
  for (const m of edits.momente ?? []) {
    if (!Number.isFinite(Date.parse(m.ab))) return `Unparsebarer Kamera-Moment: ${m.ab}`
    if (m.dauerS !== undefined && !(Number.isFinite(m.dauerS) && m.dauerS >= 1 && m.dauerS <= 30)) {
      return `Moment-Dauer muss zwischen 1 und 30 Sekunden liegen`
    }
  }
  for (const [i, a] of (edits.audio ?? []).entries()) {
    if (!Number.isFinite(Date.parse(a.ab))) return `Audio ${i + 1}: unparsebarer Beginn`
    if (a.bis !== undefined) {
      if (a.typ !== 'musik') return `Audio ${i + 1}: ein Ende gibt es nur für Musik`
      if (!Number.isFinite(Date.parse(a.bis))) return `Audio ${i + 1}: unparsebares Ende`
      if (Date.parse(a.bis) <= Date.parse(a.ab))
        return `Audio ${i + 1}: das Ende muss nach dem Beginn liegen`
    }
    if (
      a.lautstaerke !== undefined &&
      !(Number.isFinite(a.lautstaerke) && a.lautstaerke >= 0 && a.lautstaerke <= 1)
    ) {
      return `Audio ${i + 1}: Lautstärke muss zwischen 0 und 1 liegen`
    }
  }
  for (const [id, m] of Object.entries(edits.medien ?? {})) {
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

export interface AnzeigeAbschnitt {
  mode: Modus
  /** false = liegt außerhalb der Trim-Spanne (wird grau gezeichnet) */
  aktiv: boolean
  pts: TrackPunkt[]
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
export function zerlegeFuerAnzeige(
  segmente: readonly EditorSegment[],
  edits: EditOverlay,
  startIso: string,
): AnzeigeAbschnitt[] {
  const startMs = Date.parse(startIso)
  const grenzen = (edits.modi ?? [])
    .map((g) => ({ abS: (Date.parse(g.ab) - startMs) / 1000, mode: g.mode }))
    .filter((g) => Number.isFinite(g.abS))
    .sort((a, b) => a.abS - b.abS)
  const trimVon =
    edits.trim?.start !== undefined ? isoZuOffset(startIso, edits.trim.start) : -Infinity
  const trimBis = edits.trim?.ende !== undefined ? isoZuOffset(startIso, edits.trim.ende) : Infinity

  const modusZu = (t: number, original: Modus): Modus => {
    let m = original
    for (const g of grenzen) {
      if (g.abS <= t) m = g.mode
      else break
    }
    return m
  }

  /** Zustandswechsel streng zwischen zwei Stützpunkt-Zeiten (Endpunkte zählen dort selbst). */
  const spaltenZwischen = (vonS: number, bisS: number): number[] => {
    if (!(bisS > vonS)) return []
    const zeiten: number[] = []
    for (const g of grenzen) {
      if (g.abS > vonS && g.abS < bisS) zeiten.push(g.abS)
    }
    if (Number.isFinite(trimVon) && trimVon > vonS && trimVon < bisS) zeiten.push(trimVon)
    if (Number.isFinite(trimBis) && trimBis > vonS && trimBis < bisS) zeiten.push(trimBis)
    zeiten.sort((a, b) => a - b)
    return zeiten.filter((t, i) => i === 0 || t !== zeiten[i - 1])
  }

  const punktBei = (a: TrackPunkt, b: TrackPunkt, t: number): TrackPunkt => {
    const span = b[3] - a[3]
    const f = span === 0 ? 0 : (t - a[3]) / span
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, t]
  }

  const abschnitte: AnzeigeAbschnitt[] = []
  for (const seg of segmente) {
    let aktueller: AnzeigeAbschnitt | null = null
    const nimm = (p: TrackPunkt): void => {
      const mode = modusZu(p[3], seg.mode)
      const aktiv = p[3] >= trimVon && p[3] <= trimBis
      if (!aktueller || aktueller.mode !== mode || aktueller.aktiv !== aktiv) {
        // Der Verbinder zum Wechselpunkt gehört der ALTEN Gruppe (Grenzen
        // wirken AB ihrem Punkt) — außer beim Austritt in den Trim: dort
        // wird er grau, also Teil der neuen (inaktiven) Gruppe.
        if (aktueller && aktueller.aktiv && !aktiv) {
          const letzter = aktueller.pts[aktueller.pts.length - 1] as TrackPunkt
          aktueller = { mode, aktiv, pts: [letzter, p] }
        } else {
          aktueller?.pts.push(p)
          aktueller = { mode, aktiv, pts: [p] }
        }
        abschnitte.push(aktueller)
      } else {
        aktueller.pts.push(p)
      }
    }
    for (let i = 0; i < seg.pts.length; i++) {
      const p = seg.pts[i] as TrackPunkt
      if (i > 0) {
        const prev = seg.pts[i - 1] as TrackPunkt
        for (const t of spaltenZwischen(prev[3], p[3])) nimm(punktBei(prev, p, t))
      }
      nimm(p)
    }
  }
  // Ein-Punkt-Abschnitte zeichnen keine Linie — raus damit
  const roh = abschnitte.filter((a) => a.pts.length >= 2)
  // Segmente der Tempo-Automatik werden einzeln durchlaufen. Verschiebt man eine
  // Overlay-Grenze ÜBER eine alte Segmentnaht, liegen zwei Abschnitte desselben
  // Modus nebeneinander — auf der Leiste zwei Bänder mit Radius-Naht dazwischen,
  // ohne Kante (gleicher Modus) und nicht anfassbar. Für Karte und Leiste
  // zusammenführen.
  const gemerged: AnzeigeAbschnitt[] = []
  for (const a of roh) {
    const prev = gemerged[gemerged.length - 1]
    if (prev && prev.mode === a.mode && prev.aktiv === a.aktiv) {
      const erst = a.pts[0] as TrackPunkt
      const last = prev.pts[prev.pts.length - 1] as TrackPunkt
      prev.pts.push(...(erst[3] === last[3] ? a.pts.slice(1) : a.pts))
    } else {
      gemerged.push({ mode: a.mode, aktiv: a.aktiv, pts: a.pts.slice() })
    }
  }
  return gemerged
}

// — Anzeige: effektiver Medien-Zustand (Basis + Overlay) —

export interface MediumBasis {
  id: string
  type: 'photo' | 'video'
  src: string
  poster?: string
  /** Kachel-Fassung für Miniaturen; fehlt bei unaufbereitetem Altbestand */
  thumb?: string
  /**
   * Echte Länge eines Videos in Sekunden (nur type=video). Fehlt bei
   * unverarbeitetem Altbestand — dann rechnet die Zeitleiste mit der
   * Foto-Standzeit weiter, was für ein langes Video sichtbar zu wenig ist.
   */
  dauerS?: number
  takenAt: string
  caption: string
  anchor: [number, number] | null
  placement: string
  /** roher GPS-Anker aus dem Manifest (auch wenn die Auto-Platzierung ihn verwarf) */
  gpsAnker?: [number, number]
}

/**
 * Bildquelle für eine MINIATUR (Zeitleiste, Ablage, Streifen, Zieh-Geist).
 *
 * Ohne diese Wahl zieht jede Miniatur das Foto in Anzeigegröße — bei zwanzig
 * Aufnahmen lädt der Editor dann beim Öffnen ein Vielfaches dessen, was er
 * zeigt. Fehlt die Kachel-Fassung (Tour von vor der Aufbereitung), bleibt es
 * beim bisherigen Bild: lieber groß als gar nicht.
 */
export function miniaturQuelle(m: Pick<MediumBasis, 'type' | 'src' | 'poster' | 'thumb'>): string {
  return m.thumb ?? (m.type === 'video' ? (m.poster ?? m.src) : m.src)
}

export interface MediumAnzeige extends MediumBasis {
  geloescht: boolean
  display?: DisplayEdit
  /** Platz im Stopp, falls gesetzt (s. MediumEdit.reihe) */
  reihe?: number
  /** Video-Schnitt aus dem Overlay (s. MediumEdit.trim) */
  trim?: { vonS: number; bisS?: number }
}

/** Overlay auf die Auto-Platzierung legen; Gelöschte bleiben (markiert) drin. */
export function effektiveMedien(
  basis: readonly MediumBasis[],
  edits: EditOverlay,
): MediumAnzeige[] {
  return basis.map((m) => {
    const e = edits.medien?.[m.id]
    return {
      ...m,
      caption: e?.caption !== undefined ? e.caption : m.caption,
      anchor: e?.anchor ?? m.anchor,
      placement: e?.anchor ? 'manuell' : m.placement,
      geloescht: e?.geloescht === true,
      ...(e?.display ? { display: e.display } : {}),
      ...(e?.reihe !== undefined ? { reihe: e.reihe } : {}),
      ...(e?.trim ? { trim: e.trim } : {}),
    }
  })
}
