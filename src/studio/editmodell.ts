// Editor-Modell (M7): reine Funktionen über Track + Edit-Overlay. Spiegelt für
// die ANZEIGE die Server-Anwendung (pipeline/edits.ts: Trim → Modus-Grenzen)
// und mutiert das Overlay immutabel — die DOM-/Karten-Verdrahtung liegt in
// editor.ts, damit alles hier unter Vitest testbar bleibt.
//
// Wie serverseitig gilt: Edits referenzieren stabile Anker (Medien-IDs,
// Koordinaten, absolute Zeitstempel), nie den Streckenanteil f.

/**
 * Fortbewegungs-Modi — deckungsgleich mit MODI in server/src/schema/upload.ts
 * und mit der Player-Engine (MODE_SPEED/MODE_SCALE in src/tour.js). Reihenfolge
 * wie in der UI: unmotorisiert → motorisiert → öffentlich → Wasser.
 * Ein Drift-Wächter in test/studio-baukasten.test.ts vergleicht die Liste mit
 * der Engine — sie lief schon einmal auseinander (Studio kannte moped/jeep nicht,
 * obwohl Engine, Icons und Motorsound sie längst hatten).
 */
export const MODI = ['walk', 'bike', 'moped', 'jeep', 'tram', 'ferry'] as const

export type Modus = (typeof MODI)[number]
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
}

export interface ModusGrenze {
  ab: string
  mode: Modus
}

export type KameraPreset = 'nah' | 'mittel' | 'weit'

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
 * Default-Dauern je Moment-Art (s). Muss mit der Engine (src/tour.js) synchron
 * bleiben — ein Drift-Wächter in test/studio-baukasten.test.ts prüft das.
 */
export const MOMENT_DEFAULT_S: Record<MomentArt, number> = { umkreisen: 6, aufstieg: 5, innehalten: 4 }

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
   */
  quelle?: 'bibliothek'
}

export interface EditOverlay {
  schema: 'luhambo/edits@1'
  medien?: Record<string, MediumEdit>
  modi?: ModusGrenze[]
  trim?: { start?: string; ende?: string }
  kamera?: KameraGrenze[]
  momente?: KameraMoment[]
  audio?: AudioEintrag[]
}

export interface EditorSegment {
  mode: Modus
  pts: TrackPunkt[]
}

export const LEERES_OVERLAY: EditOverlay = { schema: 'luhambo/edits@1' }

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
export function projiziereAufTrack(punkte: readonly TrackPunkt[], lng: number, lat: number): TrackProjektion {
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
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, tOffsetS]
    }
  }
  return [...letzter] as TrackPunkt
}

/** Index des Trackpunkts, der [lng,lat] am nächsten liegt (lokale Plattkarte). */
export function naechsterPunktIndex(punkte: readonly TrackPunkt[], lng: number, lat: number): number {
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
  geloescht?: boolean | undefined
  display?: DisplayEdit | undefined
}

export function mitMedienEdit(edits: EditOverlay, id: string, patch: MediumEditPatch): EditOverlay {
  const eintrag: MediumEdit = { ...(edits.medien?.[id] ?? {}) }
  for (const key of ['caption', 'anchor', 'geloescht', 'display'] as const) {
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

export function mitTrim(edits: EditOverlay, teil: 'start' | 'ende', iso: string | null): EditOverlay {
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
export function mitKameraGrenze(edits: EditOverlay, ab: string, preset: KameraPreset, skala?: number): EditOverlay {
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

/** Moment setzen/ersetzen (gleicher `ab` = ersetzen), sortiert. */
export function mitMoment(edits: EditOverlay, ab: string, art: MomentArt, dauerS?: number): EditOverlay {
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

/** Patch-Semantik wie MediumEditPatch: Schlüssel vorhanden + undefined = entfernen. */
export interface AudioPatch {
  typ?: 'musik' | 'sfx'
  ab?: string
  bis?: string | undefined
  lautstaerke?: number | undefined
}

export function mitAudioPatch(edits: EditOverlay, index: number, patch: AudioPatch): EditOverlay {
  const audio = (edits.audio ?? []).map((e, i) => {
    if (i !== index) return e
    const neu: AudioEintrag = { ...e }
    for (const key of ['typ', 'ab', 'bis', 'lautstaerke'] as const) {
      if (!(key in patch)) continue
      const wert = patch[key]
      if (wert === undefined) delete neu[key]
      else (neu as unknown as Record<string, unknown>)[key] = wert
    }
    if (neu.typ === 'sfx') delete neu.bis // Einzelschuss hat kein Ende
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
      if (Date.parse(a.bis) <= Date.parse(a.ab)) return `Audio ${i + 1}: das Ende muss nach dem Beginn liegen`
    }
    if (a.lautstaerke !== undefined && !(Number.isFinite(a.lautstaerke) && a.lautstaerke >= 0 && a.lautstaerke <= 1)) {
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
  const trimVon = edits.trim?.start !== undefined ? isoZuOffset(startIso, edits.trim.start) : -Infinity
  const trimBis = edits.trim?.ende !== undefined ? isoZuOffset(startIso, edits.trim.ende) : Infinity

  const modusZu = (t: number, original: Modus): Modus => {
    let m = original
    for (const g of grenzen) {
      if (g.abS <= t) m = g.mode
      else break
    }
    return m
  }

  const abschnitte: AnzeigeAbschnitt[] = []
  for (const seg of segmente) {
    let aktueller: AnzeigeAbschnitt | null = null
    for (const p of seg.pts) {
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
  }
  // Ein-Punkt-Abschnitte zeichnen keine Linie — raus damit
  return abschnitte.filter((a) => a.pts.length >= 2)
}

// — Anzeige: effektiver Medien-Zustand (Basis + Overlay) —

export interface MediumBasis {
  id: string
  type: 'photo' | 'video'
  src: string
  poster?: string
  takenAt: string
  caption: string
  anchor: [number, number] | null
  placement: string
  /** roher GPS-Anker aus dem Manifest (auch wenn die Auto-Platzierung ihn verwarf) */
  gpsAnker?: [number, number]
}

export interface MediumAnzeige extends MediumBasis {
  geloescht: boolean
  display?: DisplayEdit
}

/** Overlay auf die Auto-Platzierung legen; Gelöschte bleiben (markiert) drin. */
export function effektiveMedien(basis: readonly MediumBasis[], edits: EditOverlay): MediumAnzeige[] {
  return basis.map((m) => {
    const e = edits.medien?.[m.id]
    return {
      ...m,
      caption: e?.caption !== undefined ? e.caption : m.caption,
      anchor: e?.anchor ?? m.anchor,
      placement: e?.anchor ? 'manuell' : m.placement,
      geloescht: e?.geloescht === true,
      ...(e?.display ? { display: e.display } : {}),
    }
  })
}
