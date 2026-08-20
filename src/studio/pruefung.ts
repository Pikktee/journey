// Was Maptale aus den abgelegten Dateien gelesen hat (Befund) — trackfreie Grundlage des
// Prüf-Screens („Neue Tour"). DOM-frei und unter Vitest getestet; die Anzeige
// liegt in studio.ts.
//
// Die Haltung dahinter: vor dem Hochladen zeigen, was ankam. Eine Aufnahme
// ohne Ortsangabe, eine, die Stunden neben der Aufzeichnung liegt, ein Track
// ohne Zeitstempel — das sind Dinge, die man VORHER wissen will, nicht
// hinterher an einer Tour, die anders aussieht als erwartet.

import { gpxZeitspanne, medientyp, type MediumEingabe } from './upload.js'

/** Ein Trackpunkt aus dem GPX: [lng, lat, Zeit in ms]. */
export type GpxPoint = [number, number, number]

/**
 * Trackpunkte aus GPX-XML. Wie `gpxZeitspanne` bewusst mit festem Fenster statt
 * unbeschränktem Suchen — bei einer 40 000-Punkte-Aufzeichnung ist der
 * Unterschied zwischen O(N) und O(N²) der zwischen sofort und Sekunden.
 */
export function gpxPoints(xml: string): GpxPoint[] {
  const points: GpxPoint[] = []
  const tagRe = /<trkpt\b([^>]*)>/g
  let hit: RegExpExecArray | null
  while ((hit = tagRe.exec(xml)) !== null) {
    const attr = hit[1] ?? ''
    const lat = Number(/\blat="([^"]+)"/.exec(attr)?.[1])
    const lng = Number(/\blon="([^"]+)"/.exec(attr)?.[1])
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
    const content = xml.slice(tagRe.lastIndex, tagRe.lastIndex + 500)
    const ms = Date.parse(/<time>([^<]+)<\/time>/.exec(content)?.[1] ?? '')
    points.push([lng, lat, Number.isFinite(ms) ? ms : NaN])
  }
  return points
}

/** Haversine in Metern — reicht für die Kilometerangabe der Vorschau. */
export function distanceM(a: readonly number[], b: readonly number[]): number {
  const RAD = Math.PI / 180
  const dLat = ((b[1] as number) - (a[1] as number)) * RAD
  const dLng = ((b[0] as number) - (a[0] as number)) * RAD
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a[1] as number) * RAD) * Math.cos((b[1] as number) * RAD) * Math.sin(dLng / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.sqrt(h))
}

/**
 * Wegpunkte in einen 0..100-Kasten legen — dieselbe Rechnung wie die Signatur
 * der Bibliothek (server/src/pipeline/signatur.ts), hier aber MIT den
 * Bildpunkten je Eingabepunkt: die Vorschau setzt Foto-Marken auf die Strecke,
 * dafür braucht sie mehr als den Pfad.
 */
export function projectPreview(points: ReadonlyArray<readonly [number, number]>): {
  d: string
  image: Array<[number, number]>
} | null {
  if (points.length < 2) return null
  const lats = points.map((p) => p[1])
  const kx = Math.cos((((Math.min(...lats) + Math.max(...lats)) / 2) * Math.PI) / 180)
  const xs = points.map((p) => p[0] * kx)
  const x0 = Math.min(...xs)
  const y0 = Math.min(...lats)
  const span = Math.max(Math.max(...xs) - x0, Math.max(...lats) - y0)
  if (!(span > 0)) return null
  const offsetX = (span - (Math.max(...xs) - x0)) / 2
  const offsetY = (span - (Math.max(...lats) - y0)) / 2
  const image = points.map((_, i): [number, number] => [
    Math.round(((xs[i] as number) - x0 + offsetX) * (100 / span) * 10) / 10,
    Math.round((100 - ((lats[i] as number) - y0 + offsetY) * (100 / span)) * 10) / 10,
  ])
  return { d: image.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join(''), image }
}

/** Index des Trackpunkts, der einer Zeit am nächsten liegt (Track ist zeitsortiert). */
export function pointAtTime(points: readonly GpxPoint[], ms: number): number {
  let best = -1
  let bestDelta = Infinity
  for (const [i, p] of points.entries()) {
    const delta = Math.abs(p[2] - ms)
    if (delta < bestDelta) {
      bestDelta = delta
      best = i
    }
  }
  return best
}

export interface MediumReport {
  file: string
  type: 'photo' | 'video'
  /** Aufnahmezeit in ms — aus EXIF, sonst der Dateizeit (dann `zeitGeraten`) */
  takenAtMs: number
  takenAtGuessed: boolean
  location: [number, number] | null
}

export type MessageType = 'ohne-ort' | 'ohne-zeit' | 'ausserhalb' | 'keine-orte' | 'ohne-track'

export interface Message {
  kind: MessageType
  /** Ton der Meldung: `hinweis` erklärt nur, `warnung` verlangt eine Entscheidung */
  tone: 'hinweis' | 'warnung'
  text: string
  /** Dateien, um die es geht — der Knopf „Weglassen" greift genau auf sie zu */
  files: string[]
}

export interface ImportReport {
  track: {
    points: GpxPoint[]
    startMs: number
    endMs: number
    km: number
  } | null
  media: MediumReport[]
  /** Zeitachse des Filmstreifens: Aufzeichnung UND Aufnahmen, damit Ausreißer sichtbar sind */
  fromMs: number
  toMs: number
  messages: Message[]
  /** Kann daraus eine Tour werden? */
  ready: boolean
  /** Wie die Strecke zustande kommt — die Tour aus Fotos hat keine aufgezeichnete */
  source: 'aufzeichnung' | 'fotos' | 'keine'
}

/** Aufnahmen, die weiter als das hinter/vor der Aufzeichnung liegen, werden gemeldet. */
const TOLERANCE_MS = 20 * 60 * 1000

export function validate(gpx: string | null, media: readonly MediumReport[]): ImportReport {
  const span = gpx ? gpxZeitspanne(gpx) : null
  const points = gpx ? gpxPoints(gpx) : []
  let km = 0
  for (let i = 1; i < points.length; i++)
    km += distanceM(points[i - 1] as GpxPoint, points[i] as GpxPoint)

  const track = span
    ? { points, startMs: span.startMs, endMs: span.endMs, km: Math.round(km / 100) / 10 }
    : null

  const times = media.map((a) => a.takenAtMs).filter((t) => Number.isFinite(t))
  const fromMs = Math.min(track?.startMs ?? Infinity, ...(times.length ? times : [Infinity]))
  const toMs = Math.max(track?.endMs ?? -Infinity, ...(times.length ? times : [-Infinity]))

  const messages: Message[] = []
  const withoutLocation = media.filter((a) => !a.location)
  const withoutTime = media.filter((a) => a.takenAtGuessed)
  const withLocation = media.filter((a) => a.location)

  if (track) {
    // Ohne Ortsangabe ist kein Fehler, solange es eine Aufzeichnung gibt: die
    // Uhrzeit sagt, wo jemand war. Deshalb Hinweis, nicht Warnung.
    if (withoutLocation.length) {
      messages.push({
        kind: 'ohne-ort',
        tone: 'hinweis',
        text:
          withoutLocation.length === 1
            ? 'Eine Aufnahme ohne Ortsangabe, eingeordnet nach ihrer Uhrzeit.'
            : `${withoutLocation.length} Aufnahmen ohne Ortsangabe, eingeordnet nach ihrer Uhrzeit.`,
        files: withoutLocation.map((a) => a.file),
      })
    }
    const outside = media.filter(
      (a) =>
        Number.isFinite(a.takenAtMs) &&
        (a.takenAtMs < track.startMs - TOLERANCE_MS || a.takenAtMs > track.endMs + TOLERANCE_MS),
    )
    if (outside.length) {
      const delta = Math.max(
        ...outside.map((a) => Math.max(track.startMs - a.takenAtMs, a.takenAtMs - track.endMs)),
      )
      messages.push({
        kind: 'ausserhalb',
        tone: 'warnung',
        text:
          outside.length === 1
            ? `Eine Aufnahme liegt ${formatDistance(delta)} außerhalb der Aufzeichnung.`
            : `${outside.length} Aufnahmen liegen bis zu ${formatDistance(delta)} außerhalb der Aufzeichnung.`,
        files: outside.map((a) => a.file),
      })
    }
  } else if (withLocation.length >= 2) {
    // Kein Track, aber verortete Fotos: die Orte SIND die Strecke.
    messages.push({
      kind: 'ohne-track',
      tone: 'hinweis',
      text: 'Keine Aufzeichnung dabei, die Kamera fliegt von Foto zu Foto, in der Reihenfolge der Uhrzeiten.',
      files: [],
    })
    if (withoutLocation.length) {
      messages.push({
        kind: 'ohne-ort',
        tone: 'warnung',
        text:
          withoutLocation.length === 1
            ? 'Eine Aufnahme hat keine Ortsangabe, sie bekommt im Editor von Hand einen Platz.'
            : `${withoutLocation.length} Aufnahmen haben keine Ortsangabe, sie bekommen im Editor von Hand einen Platz.`,
        files: withoutLocation.map((a) => a.file),
      })
    }
  } else if (media.length) {
    messages.push({
      kind: 'keine-orte',
      tone: 'warnung',
      text: 'Ohne Aufzeichnung braucht es mindestens zwei Fotos mit Ortsangabe, sonst gibt es keine Strecke, über die die Kamera fliegen könnte.',
      files: [],
    })
  }

  if (withoutTime.length) {
    messages.push({
      kind: 'ohne-zeit',
      tone: 'hinweis',
      text:
        withoutTime.length === 1
          ? 'Eine Aufnahme hat keinen Zeitstempel, es gilt das Datum der Datei.'
          : `${withoutTime.length} Aufnahmen haben keinen Zeitstempel, es gilt das Datum der Datei.`,
      files: withoutTime.map((a) => a.file),
    })
  }

  const source: ImportReport['source'] = track
    ? 'aufzeichnung'
    : withLocation.length >= 2
      ? 'fotos'
      : 'keine'
  return {
    track,
    media: [...media].sort((a, b) => a.takenAtMs - b.takenAtMs),
    fromMs: Number.isFinite(fromMs) ? fromMs : 0,
    toMs: Number.isFinite(toMs) ? toMs : 0,
    messages,
    ready: source !== 'keine',
    source,
  }
}

/** „1 h 41 min" / „18 min" — die Größenordnung zählt, nicht die Sekunde. */
export function formatDistance(ms: number): string {
  const minutes = Math.round(Math.abs(ms) / 60000)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} h ${rest} min` : `${hours} h`
}

/**
 * Wegpunkte für eine Tour OHNE Aufzeichnung: die verorteten Fotos in zeitlicher
 * Reihenfolge. Höhe 0 — der Player holt sie ohnehin aus dem Geländemodell und
 * überschreibt sie ([src/elevation.ts]).
 */
export function buildPhotoSegments(
  media: readonly MediumReport[],
  mode: string,
): Array<{ mode: string; pts: Array<[number, number, number, number]> }> {
  const located = media
    .filter((a): a is MediumReport & { location: [number, number] } => !!a.location)
    .sort((a, b) => a.takenAtMs - b.takenAtMs)
  if (located.length < 2) return []
  const t0 = located[0]!.takenAtMs
  return [
    {
      mode: mode,
      pts: located.map((a): [number, number, number, number] => [
        a.location[0],
        a.location[1],
        0,
        (a.takenAtMs - t0) / 1000,
      ]),
    },
  ]
}

/**
 * Grobe Laufzeit der fertigen Kamerafahrt — dieselbe Größenordnung wie die
 * Schätzung im Editor: rund 25 s je Kilometer plus 4 s Halt je Aufnahme.
 * Bewusst als „≈" beschriftet; genau wird es erst mit den Kamera-Einstellungen.
 */
export function estimateRideS(km: number, media: number): number {
  return Math.round(km * 25 + media * 4)
}

/** Aus einem Befund die Medien-Einträge fürs Manifest (Reihenfolge = Zeit). */
export function mediaFromReport(
  report: ImportReport,
  isoWithZone: (ms: number) => string,
): MediumEingabe[] {
  return report.media.map((a, i) => {
    const entry: MediumEingabe = {
      id: `m${i + 1}`,
      type: a.type,
      file: a.file,
      takenAt: isoWithZone(a.takenAtMs),
    }
    if (a.location) entry.anchor = a.location
    return entry
  })
}

/** Wird die Datei überhaupt angenommen? (GPX oder bekannter Medientyp) */
export function isUsable(fileName: string): boolean {
  return fileName.toLowerCase().endsWith('.gpx') || medientyp(fileName) !== null
}
