// Medien-Platzierung (M6): jedem Foto/Video einen Anker auf dem Track geben.
// Auto-Regel (Plan): GPS-Anker näher als 500 m am Track → so verankern; sonst
// über die Aufnahmezeit auf den Trackpunkt zu diesem Zeitpunkt; sonst
// „unplatziert" (wird nicht abgespielt, im Editor manuell setzbar, M7).
// Reine Geometrie über den Rohdaten → direkt unit-testbar.

import type { UploadMedium, UploadPunkt } from '../schema/upload.js'
import { distanzM } from './geo.js'

export type Platzierung = 'gps' | 'zeit' | 'manuell' | 'unplatziert'

export interface PlatziertesMedium {
  medium: UploadMedium
  /** Anker [lng,lat] auf dem Track; null = unplatziert */
  anchor: [number, number] | null
  placement: Platzierung
}

// Ab dieser Entfernung gilt ein GPS-Anker als „nicht am Track" (Abstecher, oder
// das Foto stammt gar nicht von unterwegs) → Zeit-Mapping übernimmt.
const MAX_ABSTAND_M = 500

/** Kleinster Abstand eines Punkts zu irgendeinem Trackpunkt. */
function abstandZumTrack(anchor: readonly number[], track: readonly UploadPunkt[]): number {
  let best = Infinity
  for (const p of track) {
    const d = distanzM(anchor, [p[0], p[1]])
    if (d < best) best = d
  }
  return best
}

/** Trackpunkt (interpoliert) zum Zeit-Offset; null, wenn außerhalb der Tour-Zeit. */
function ankerZurZeit(track: readonly UploadPunkt[], offsetS: number): [number, number] | null {
  const erster = track[0]!
  const letzter = track[track.length - 1]!
  if (offsetS < erster[3] || offsetS > letzter[3]) return null
  for (let i = 1; i < track.length; i++) {
    const a = track[i - 1]!
    const b = track[i]!
    if (offsetS <= b[3]) {
      const t = b[3] === a[3] ? 0 : (offsetS - a[3]) / (b[3] - a[3])
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
    }
  }
  return [letzter[0], letzter[1]]
}

function bestimmePlatzierung(
  medium: UploadMedium,
  track: readonly UploadPunkt[],
  nachZeit: readonly UploadPunkt[],
  startMs: number,
): PlatziertesMedium {
  // 1. GPS-Anker nah genug am Track → direkt verankern (Reihenfolge egal)
  if (medium.anchor && abstandZumTrack(medium.anchor, track) <= MAX_ABSTAND_M) {
    return { medium, anchor: medium.anchor, placement: 'gps' }
  }
  // 2. Über die Aufnahmezeit auf den Track abbilden (braucht sortierte Zeit)
  const takenMs = Date.parse(medium.takenAt)
  if (Number.isFinite(takenMs)) {
    const anker = ankerZurZeit(nachZeit, (takenMs - startMs) / 1000)
    if (anker) return { medium, anchor: anker, placement: 'zeit' }
  }
  // 3. Weder Ort noch verwertbare Zeit → unplatziert
  return { medium, anchor: null, placement: 'unplatziert' }
}

/**
 * Alle Medien einer Tour verorten. `track` sind die Trackpunkte über ALLE
 * Segmente (flach, in Fahrreihenfolge), `startMs` = time.start.
 */
export function platziereMedien(
  medien: readonly UploadMedium[],
  track: readonly UploadPunkt[],
  startMs: number,
): PlatziertesMedium[] {
  if (track.length < 2) {
    return medien.map((medium) => ({ medium, anchor: null, placement: 'unplatziert' as const }))
  }
  // ankerZurZeit setzt aufsteigende tOffsets voraus. Der Track bleibt in
  // Fahrreihenfolge (wichtig für die Route), kann bei springenden GPS-Zeiten
  // aber unsortiert sein → für die Zeit-Suche eine nach Offset sortierte Kopie.
  const nachZeit = [...track].sort((a, b) => a[3] - b[3])
  return medien.map((medium) => bestimmePlatzierung(medium, track, nachZeit, startMs))
}
