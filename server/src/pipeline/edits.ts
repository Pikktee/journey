// Edit-Overlay anwenden (M7): reine Funktionen, die Trim, Modus-Grenzen und
// Medien-Overrides über den Rohdaten ausführen. Läuft in der Pipeline NACH dem
// GPX-Parsen (quellenblind) und VOR Platzierung/Timeline/Wetter — alles
// Nachgelagerte rechnet dadurch automatisch auf dem bearbeiteten Track.

import type { EditOverlay } from '../schema/edits.js'
import type { Modus, UploadPunkt, UploadSegment } from '../schema/upload.js'
import type { PlatziertesMedium } from './placement.js'

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
export function wendeTrimAn(
  segmente: readonly UploadSegment[],
  trim: EditOverlay['trim'],
  startMs: number,
): UploadSegment[] {
  const von = offsetS(trim?.start, startMs) ?? -Infinity
  const bis = offsetS(trim?.ende, startMs) ?? Infinity
  if (von === -Infinity && bis === Infinity) return [...segmente]
  return segmente
    .map((seg) => ({ ...seg, pts: seg.pts.filter((p) => p[3] >= von && p[3] <= bis) }))
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
 * (src/studio/editmodell.ts), damit Anzeige und Render nie auseinanderlaufen.
 */
export function wendeModiAn(
  segmente: readonly UploadSegment[],
  modi: EditOverlay['modi'],
  startMs: number,
): UploadSegment[] {
  const grenzen = (modi ?? [])
    .map((g) => ({ abS: offsetS(g.ab, startMs), mode: g.mode }))
    .filter((g): g is { abS: number; mode: Modus } => g.abS !== null)
    .sort((a, b) => a.abS - b.abS)
  if (!grenzen.length) return [...segmente]

  const modusZu = (t: number): Modus | null => {
    let m: Modus | null = null
    for (const g of grenzen) {
      if (g.abS <= t) m = g.mode
      else break
    }
    return m
  }

  const ergebnis: UploadSegment[] = []
  for (const seg of segmente) {
    // In Scheiben gleichen (effektiven) Modus schneiden
    const scheiben: Array<{ mode: Modus; pts: UploadPunkt[] }> = []
    for (const p of seg.pts) {
      const mode = modusZu(p[3]) ?? seg.mode
      const letzte = scheiben[scheiben.length - 1]
      if (letzte && letzte.mode === mode) {
        letzte.pts.push(p)
      } else {
        letzte?.pts.push(p) // Grenzpunkt schließt die alte Scheibe ab …
        scheiben.push({ mode, pts: [p] }) // … und eröffnet die neue
      }
    }
    for (const s of scheiben) {
      // Original-Label nur behalten, wenn der Modus unverändert ist —
      // sonst greift die MODE_LABELS-Beschriftung der Pipeline.
      ergebnis.push({
        mode: s.mode,
        ...(s.mode === seg.mode && seg.label !== undefined ? { label: seg.label } : {}),
        pts: s.pts,
      })
    }
  }
  // 1-Punkt-Scheiben an Segment-Übergabepunkten sind redundant, wenn der
  // Nachbar denselben Modus hat und den Punkt bereits trägt — weg damit.
  return ergebnis.filter((s, i) => {
    if (s.pts.length > 1) return true
    const p = s.pts[0] as UploadPunkt
    const traegt = (nachbar: UploadSegment | undefined): boolean =>
      !!nachbar &&
      nachbar.mode === s.mode &&
      nachbar.pts.some((q) => q[3] === p[3] && q[0] === p[0] && q[1] === p[1])
    return !(traegt(ergebnis[i - 1]) || traegt(ergebnis[i + 1]))
  })
}

/** Trim + Modus-Grenzen in der festen Reihenfolge Trim → Modi anwenden. */
export function wendeEditsAufSegmenteAn(
  segmente: readonly UploadSegment[],
  edits: EditOverlay | null | undefined,
  startMs: number,
): UploadSegment[] {
  if (!edits) return [...segmente]
  return wendeModiAn(wendeTrimAn(segmente, edits.trim, startMs), edits.modi, startMs)
}

/**
 * Medien-Overrides auf die Auto-Platzierung anwenden: gelöschte Medien fliegen
 * raus (Rohdatei bleibt liegen), Caption-Overrides ersetzen den Text, ein
 * manueller Anker übersteuert die Auto-Regel → placement 'manuell'.
 */
export function wendeMedienEditsAn(
  platziert: readonly PlatziertesMedium[],
  edits: EditOverlay | null | undefined,
): PlatziertesMedium[] {
  const medien = edits?.medien
  if (!medien) return [...platziert]
  return platziert
    .filter((p) => !medien[p.medium.id]?.geloescht)
    .map((p) => {
      const e = medien[p.medium.id]
      if (!e) return p
      const medium = e.caption !== undefined ? { ...p.medium, caption: e.caption } : p.medium
      return e.anchor ? { medium, anchor: e.anchor, placement: 'manuell' as const } : { ...p, medium }
    })
}
