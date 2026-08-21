// Edit-Overlay anwenden (M7): reine Funktionen, die Trim, Modus-Grenzen und
// Medien-Overrides über den Rohdaten ausführen. Läuft in der Pipeline NACH dem
// GPX-Parsen (quellenblind) und VOR Platzierung/Timeline/Wetter — alles
// Nachgelagerte rechnet dadurch automatisch auf dem bearbeiteten Track.

import type { EditOverlay } from '../schema/edits.js'
import type { TravelMode, UploadPoint, UploadSegment } from '../schema/upload.js'
import type { PlacedMedium } from './placement.js'

/** ISO-Zeitstempel → Sekunden-Offset ab time.start; null bei Unparsebarem. */
function offsetS(iso: string | undefined, startMs: number): number | null {
  if (iso === undefined) return null
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? (ms - startMs) / 1000 : null
}

/**
 * Trim: nur Punkte innerhalb [start, ende] behalten (absolute Zeitstempel des
 * Overlays, umgerechnet auf tOffsets). Segmente mit < 2 Restpunkten entfallen.
 * Medien-Anker bleiben unberührt — sie hängen an Koordinaten/Zeiten, nie an f.
 */
export function applyTourTrim(
  segs: readonly UploadSegment[],
  trim: EditOverlay['trim'],
  startMs: number,
): UploadSegment[] {
  const from = offsetS(trim?.start, startMs) ?? -Infinity
  const to = offsetS(trim?.end, startMs) ?? Infinity
  if (from === -Infinity && to === Infinity) return [...segs]
  return segs
    .map((seg) => ({ ...seg, pts: seg.pts.filter((p) => p[3] >= from && p[3] <= to) }))
    .filter((seg) => seg.pts.length >= 2)
}

/**
 * Modus-Grenzen: ab `ab` gilt der neue Modus bis zur nächsten Grenze. Segmente
 * werden an den Grenzen zerschnitten; vor der ersten Grenze bleibt der
 * Original-Modus. Der Grenzpunkt liegt in BEIDEN Scheiben — Folgesegmente
 * teilen ihren Übergabepunkt (Konvention der Aufnahme-Segmente; main.js
 * verkettet mit `slice(1)` über das Duplikat, sonst verlöre die Route pro
 * Grenze einen Punkt). Der effektive Modus ist eine reine Punkt-Funktion
 * `modusZu(t)` — exakt dieselbe Regel wie in der Editor-Anzeige
 * (src/studio/edit-model.ts), damit Anzeige und Render nie auseinanderlaufen.
 */
export function applyTravelModes(
  segs: readonly UploadSegment[],
  modes: EditOverlay['travelModes'],
  startMs: number,
): UploadSegment[] {
  const boundaries = (modes ?? [])
    .map((g) => ({ abS: offsetS(g.from, startMs), mode: g.mode }))
    .filter((g): g is { abS: number; mode: TravelMode } => g.abS !== null)
    .sort((a, b) => a.abS - b.abS)
  if (!boundaries.length) return [...segs]

  const modeAt = (t: number): TravelMode | null => {
    let m: TravelMode | null = null
    for (const g of boundaries) {
      if (g.abS <= t) m = g.mode
      else break
    }
    return m
  }

  const result: UploadSegment[] = []
  for (const seg of segs) {
    // In Scheiben gleichen (effektiven) Modus schneiden
    const slices: Array<{ mode: TravelMode; pts: UploadPoint[] }> = []
    for (const p of seg.pts) {
      const mode = modeAt(p[3]) ?? seg.mode
      const last = slices[slices.length - 1]
      if (last && last.mode === mode) {
        last.pts.push(p)
      } else {
        last?.pts.push(p) // Grenzpunkt schließt die alte Scheibe ab …
        slices.push({ mode, pts: [p] }) // … und eröffnet die neue
      }
    }
    for (const s of slices) {
      // Original-Label nur behalten, wenn der Modus unverändert ist —
      // sonst greift die MODE_LABELS-Beschriftung der Pipeline.
      result.push({
        mode: s.mode,
        ...(s.mode === seg.mode && seg.label !== undefined ? { label: seg.label } : {}),
        pts: s.pts,
      })
    }
  }
  // 1-Punkt-Scheiben an Segment-Übergabepunkten sind redundant, wenn der
  // Nachbar denselben Modus hat und den Punkt bereits trägt — weg damit.
  return result.filter((s, i) => {
    if (s.pts.length > 1) return true
    const p = s.pts[0] as UploadPoint
    const carries = (neighbour: UploadSegment | undefined): boolean =>
      !!neighbour &&
      neighbour.mode === s.mode &&
      neighbour.pts.some((q) => q[3] === p[3] && q[0] === p[0] && q[1] === p[1])
    return !(carries(result[i - 1]) || carries(result[i + 1]))
  })
}

/** Trim + Modus-Grenzen in der festen Reihenfolge Trim → Modi anwenden. */
export function applyEditsToSegments(
  segs: readonly UploadSegment[],
  edits: EditOverlay | null | undefined,
  startMs: number,
): UploadSegment[] {
  if (!edits) return [...segs]
  return applyTravelModes(applyTourTrim(segs, edits.trim, startMs), edits.travelModes, startMs)
}

/**
 * Medien-Overrides auf die Auto-Platzierung anwenden: gelöschte Medien fliegen
 * raus (Rohdatei bleibt liegen), Caption-Overrides ersetzen den Text, ein
 * manueller Anker übersteuert die Auto-Regel → placement 'manuell'.
 */
export function applyMediaEdits(
  placed: readonly PlacedMedium[],
  edits: EditOverlay | null | undefined,
): PlacedMedium[] {
  const media = edits?.media
  if (!media) return [...placed]
  return placed
    .filter((p) => !media[p.medium.id]?.removed)
    .map((p) => {
      const e = media[p.medium.id]
      if (!e) return p
      const medium = e.caption !== undefined ? { ...p.medium, caption: e.caption } : p.medium
      return e.anchor
        ? { medium, anchor: e.anchor, placement: 'manual' as const }
        : { ...p, medium }
    })
}
