// Editor-Modell (M7): reine Funktionen über Track + Edit-Overlay. Spiegelt für
// die ANZEIGE die Server-Anwendung (pipeline/edits.ts: Trim → Modus-Grenzen)
// und mutiert das Overlay immutabel — die DOM-/Karten-Verdrahtung liegt in
// editor.ts, damit alles hier unter Vitest testbar bleibt.
//
// Wie serverseitig gilt: Edits referenzieren stabile Anker (Medien-IDs,
// Koordinaten, absolute Zeitstempel), nie den Streckenanteil f.

export type Modus = 'walk' | 'bike' | 'tram' | 'ferry'
/** Trackpunkt der Editor-Daten: [lng, lat, ele, tOffsetS] */
export type TrackPunkt = [number, number, number, number]

export interface MediumEdit {
  caption?: string
  anchor?: [number, number]
  geloescht?: boolean
}

export interface ModusGrenze {
  ab: string
  mode: Modus
}

export interface EditOverlay {
  schema: 'luhambo/edits@1'
  medien?: Record<string, MediumEdit>
  modi?: ModusGrenze[]
  trim?: { start?: string; ende?: string }
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

/** Patch-Semantik: Schlüssel vorhanden + undefined/false = Override entfernen. */
export interface MediumEditPatch {
  caption?: string | undefined
  anchor?: [number, number] | undefined
  geloescht?: boolean | undefined
}

export function mitMedienEdit(edits: EditOverlay, id: string, patch: MediumEditPatch): EditOverlay {
  const eintrag: MediumEdit = { ...(edits.medien?.[id] ?? {}) }
  for (const key of ['caption', 'anchor', 'geloescht'] as const) {
    if (!(key in patch)) continue
    const wert = patch[key]
    if (wert === undefined || wert === false) delete eintrag[key]
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

/** Semantik-Prüfung vor dem Speichern (Spiegel der Server-Prüfung). */
export function pruefeOverlay(edits: EditOverlay): string | null {
  const { start, ende } = edits.trim ?? {}
  if (start !== undefined && ende !== undefined && Date.parse(start) >= Date.parse(ende)) {
    return 'Trim-Start muss vor dem Trim-Ende liegen'
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
}

export interface MediumAnzeige extends MediumBasis {
  geloescht: boolean
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
    }
  })
}
