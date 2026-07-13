// GPX als Track-Quelle (M6): Ein hochgeladenes `trackFile` (GPX) wird
// serverseitig zu einem Upload-Segment geparst — eine Implementierung für
// Web-Studio, App-Import und CLI (statt drei divergierende Parser). Bewusst
// ohne XML-Abhängigkeit: <trkpt>-Blöcke sind flach, ein Regex genügt und ist
// robust gegen Namespaces/Attribut-Reihenfolge.

import type { Modus, UploadPunkt, UploadSegment } from '../schema/upload.js'
import { distanzM } from './geo.js'

export interface GpxPunkt {
  lng: number
  lat: number
  ele: number
  /** Epoche ms des Trackpunkts; null, wenn das GPX keine <time> trägt */
  timeMs: number | null
}

// Deckel gegen entartete Uploads (Schema erlaubt bis 200 000 Punkte je Segment).
const MAX_TRACKPUNKTE = 200_000

/**
 * Trackpunkte aus GPX-XML lesen (lng/lat/ele/time). Nicht-backtrackend: nur der
 * öffnende <trkpt …>-Tag wird gematcht (durch `>` begrenzt), der Inhalt bis zum
 * nächsten </trkpt> per indexOf gegriffen. Eine lazy `([\s\S]*?)</trkpt>`-Gruppe
 * ist bei fehlenden Schluss-Tags QUADRATISCH und blockiert den Event-Loop
 * (Review-Fund: 3,7 MB → 64 s) — parseGpx läuft synchron in verarbeite().
 */
export function parseGpx(xml: string): GpxPunkt[] {
  const punkte: GpxPunkt[] = []
  const tagRe = /<trkpt\b([^>]*)>/g
  let m: RegExpExecArray | null
  while ((m = tagRe.exec(xml)) && punkte.length < MAX_TRACKPUNKTE) {
    const attrs = m[1] ?? ''
    const lat = /lat="([^"]+)"/.exec(attrs)?.[1]
    const lon = /lon="([^"]+)"/.exec(attrs)?.[1]
    if (lat === undefined || lon === undefined) continue
    // Inhalt in einem FESTEN Fenster suchen: ein unbeschränktes indexOf ohne
    // Treffer scannt sonst bei jedem offenen Tag bis Dateiende → wieder O(N²)!
    // <ele>/<time> stehen am Anfang des Trackpunkts, 500 Zeichen genügen.
    const inhalt = xml.slice(tagRe.lastIndex, tagRe.lastIndex + 500)
    const ele = /<ele>([^<]+)<\/ele>/.exec(inhalt)?.[1]
    const time = /<time>([^<]+)<\/time>/.exec(inhalt)?.[1]
    const zeitMs = time ? Date.parse(time) : NaN
    const eleNum = ele ? Number(ele) : 0
    punkte.push({
      lng: Number(lon),
      lat: Number(lat),
      ele: Number.isFinite(eleNum) ? eleNum : 0, // kaputtes <ele> nicht als NaN in die Statistik
      timeMs: Number.isFinite(zeitMs) ? zeitMs : null,
    })
  }
  return punkte.filter((p) => Number.isFinite(p.lng) && Number.isFinite(p.lat))
}

// Fortbewegungsmittel grob aus dem Durchschnittstempo raten (im Editor änderbar).
// Bewusst konservativ: nur Gehen vs. Rad — Tram/Fähre kann der Nutzer setzen,
// eine Tempo-Heuristik würde sie kaum zuverlässig treffen.
const WALK_MAX_KMH = 7

export function modusAusTempo(streckeM: number, dauerS: number): Modus {
  if (dauerS <= 0) return 'bike'
  const kmh = streckeM / 1000 / (dauerS / 3600)
  return kmh < WALK_MAX_KMH ? 'walk' : 'bike'
}

export interface GpxSegmentErgebnis {
  segment: UploadSegment
  /** true, wenn echte Zeitstempel im GPX standen (sonst distanzbasierte Pseudo-Zeit) */
  hatZeit: boolean
}

/**
 * GPX-Trackpunkte → ein Upload-Segment mit Zeit-Offsets relativ zu startMs.
 * Mit echten <time>-Stempeln sind die Offsets die wahren Sekunden (→ Auto-Wetter,
 * Tag/Nacht). Fehlen sie (manche Exporte strippen die Zeit), werden die Offsets
 * distanzproportional über die Spanne start→end verteilt — die Fahrt läuft dann
 * gleichmäßig, Auto-Wetter/Tag-Nacht bleiben Pseudo-Zeit (Plan-Risiko 9).
 */
export function baueSegmentAusGpx(
  punkte: GpxPunkt[],
  opts: { startMs: number; endMs: number; modus?: Modus },
): GpxSegmentErgebnis {
  if (punkte.length < 2) throw new Error(`GPX enthält zu wenige Trackpunkte (${punkte.length})`)

  const hatZeit = punkte.every((p) => p.timeMs !== null)

  // Gesamtdistanz vorab (für Modus-Heuristik und die distanzbasierte Verteilung)
  const kumDist: number[] = [0]
  for (let i = 1; i < punkte.length; i++) {
    const a = punkte[i - 1]!
    const b = punkte[i]!
    kumDist.push(kumDist[i - 1]! + distanzM([a.lng, a.lat], [b.lng, b.lat]))
  }
  const gesamtM = kumDist[kumDist.length - 1]!
  const spanneS = Math.max(0, (opts.endMs - opts.startMs) / 1000)

  const pts: UploadPunkt[] = punkte.map((p, i) => {
    let tOffsetS: number
    if (hatZeit) {
      tOffsetS = Math.round((p.timeMs! - opts.startMs) / 1000)
    } else {
      // gleichmäßig nach Distanz über die Zeitspanne verteilen
      tOffsetS = Math.round(gesamtM > 0 ? (kumDist[i]! / gesamtM) * spanneS : (i / (punkte.length - 1)) * spanneS)
    }
    return [Number(p.lng.toFixed(6)), Number(p.lat.toFixed(6)), Number(p.ele.toFixed(1)), tOffsetS]
  })

  const modus = opts.modus ?? modusAusTempo(gesamtM, hatZeit ? (opts.endMs - opts.startMs) / 1000 : 0)
  return { segment: { mode: modus, pts }, hatZeit }
}
