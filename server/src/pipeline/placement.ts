// Medien-Platzierung (M6): jedem Foto/Video einen Anker auf dem Track geben.
// Auto-Regel (Plan): GPS-Anker näher als 500 m am Track → so verankern; sonst
// über die Aufnahmezeit auf den Trackpunkt zu diesem Zeitpunkt; sonst
// „unplaced" (wird nicht abgespielt, im Editor manuell setzbar, M7).
// Reine Geometrie über den Rohdaten → direkt unit-testbar.

import type { UploadMedium, UploadPoint } from '../schema/upload.js'
import { distanceM } from './geo.js'

export type Placement = 'gps' | 'time' | 'manual' | 'unplaced'

export interface PlacedMedium {
  medium: UploadMedium
  /** Anker [lng,lat] auf dem Track; null = unplatziert */
  anchor: [number, number] | null
  placement: Placement
}

// Ab dieser Entfernung gilt ein GPS-Anker als „nicht am Track" (Abstecher, oder
// das Foto stammt gar nicht von unterwegs) → Zeit-Mapping übernimmt.
const MAX_DISTANCE_M = 500

/** Kleinster Abstand eines Punkts zu irgendeinem Trackpunkt. */
function distanceToTrack(anchor: readonly number[], track: readonly UploadPoint[]): number {
  let best = Infinity
  for (const p of track) {
    const d = distanceM(anchor, [p[0], p[1]])
    if (d < best) best = d
  }
  return best
}

/** Trackpunkt (interpoliert) zum Zeit-Offset; null, wenn außerhalb der Tour-Zeit. */
function anchorAtTime(track: readonly UploadPoint[], offsetS: number): [number, number] | null {
  const first = track[0]!
  const last = track[track.length - 1]!
  if (offsetS < first[3] || offsetS > last[3]) return null
  for (let i = 1; i < track.length; i++) {
    const a = track[i - 1]!
    const b = track[i]!
    if (offsetS <= b[3]) {
      const t = b[3] === a[3] ? 0 : (offsetS - a[3]) / (b[3] - a[3])
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
    }
  }
  return [last[0], last[1]]
}

function determinePlacement(
  medium: UploadMedium,
  track: readonly UploadPoint[],
  byTime: readonly UploadPoint[],
  startMs: number,
): PlacedMedium {
  // 1. GPS-Anker nah genug am Track → direkt verankern (Reihenfolge egal)
  if (medium.anchor && distanceToTrack(medium.anchor, track) <= MAX_DISTANCE_M) {
    return { medium, anchor: medium.anchor, placement: 'gps' }
  }
  // 2. Über die Aufnahmezeit auf den Track abbilden (braucht sortierte Zeit)
  const takenMs = Date.parse(medium.takenAt)
  if (Number.isFinite(takenMs)) {
    const anchor2 = anchorAtTime(byTime, (takenMs - startMs) / 1000)
    if (anchor2) return { medium, anchor: anchor2, placement: 'time' }
  }
  // 3. Weder Ort noch verwertbare Zeit → unplatziert
  return { medium, anchor: null, placement: 'unplaced' }
}

/**
 * Alle Medien einer Tour verorten. `track` sind die Trackpunkte über ALLE
 * Segmente (flach, in Fahrreihenfolge), `startMs` = time.start.
 */
export function placeMedia(
  media: readonly UploadMedium[],
  track: readonly UploadPoint[],
  startMs: number,
): PlacedMedium[] {
  if (track.length < 2) {
    return media.map((medium) => ({ medium, anchor: null, placement: 'unplaced' as const }))
  }
  // ankerZurZeit setzt aufsteigende tOffsets voraus. Der Track bleibt in
  // Fahrreihenfolge (wichtig für die Route), kann bei springenden GPS-Zeiten
  // aber unsortiert sein → für die Zeit-Suche eine nach Offset sortierte Kopie.
  const byTime = [...track].sort((a, b) => a[3] - b[3])
  return media.map((medium) => determinePlacement(medium, track, byTime, startMs))
}
