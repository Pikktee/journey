// Studio-Upload-Logik (M6): reine Funktionen zum Bauen des Upload-Manifests aus
// den im Browser gewählten Dateien. Die eigentlichen fetch-Aufrufe stecken in
// api.ts, die DOM-Verdrahtung in studio.ts — hier nichts Seiteneffektbehaftetes,
// damit es unter Vitest testbar bleibt.

export interface MediumInput {
  id: string
  type: 'photo' | 'video'
  file: string
  takenAt: string
  anchor?: [number, number]
}

export interface UploadManifest {
  schema: 'maptale/upload@2'
  clientTourId: string
  title: string | null
  description: null
  time: { start: string; end: string; zone: string }
  trackFile: 'track.gpx'
  trackMode: string
  media: MediumInput[]
}

/**
 * Früheste/späteste Trackpunkt-Zeit aus GPX-XML (nur <trkpt>, nicht Metadaten).
 * Nicht-backtrackend (siehe parseGpx im Server) und mit inkrementellem min/max
 * statt `Math.min(...zeiten)` — der Spread sprengt bei sehr langen Tracks den
 * Argument-Stack. Braucht ≥ 2 Zeiten mit echter Spanne, sonst null.
 */
export function gpxTimeSpan(xml: string): { startMs: number; endMs: number } | null {
  const tagRe = /<trkpt\b[^>]*>/g
  let min = Infinity
  let max = -Infinity
  let count = 0
  while (tagRe.exec(xml) !== null) {
    // festes Fenster statt unbeschränktem indexOf (das ohne Treffer bei jedem
    // offenen Tag to Dateiende scannt → O(N²), siehe parseGpx im Server)
    const content = xml.slice(tagRe.lastIndex, tagRe.lastIndex + 500)
    const t = /<time>([^<]+)<\/time>/.exec(content)?.[1]
    if (t) {
      const ms = Date.parse(t)
      if (Number.isFinite(ms)) {
        if (ms < min) min = ms
        if (ms > max) max = ms
        count++
      }
    }
  }
  return count >= 2 && max > min ? { startMs: min, endMs: max } : null
}

/** Trackpunkt-Anzahl (für die UI-Rückmeldung „N Punkte"). */
export function gpxPointCount(xml: string): number {
  return (xml.match(/<trkpt\b/g) ?? []).length
}

// Zeitzonen-Offset (ms) einer IANA-Zone zu einem UTC-Zeitpunkt — via Intl, ohne
// Bibliothek. Basis für isoMitZone/exifDatumZuMs (EXIF kennt keine Zone).
function zoneOffsetMs(utcMs: number, zone: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const parts = Object.fromEntries(fmt.formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]))
  const localAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  )
  return localAsUtc - utcMs
}

/** Epoche-ms → ISO 8601 mit dem Offset der Zone (z. B. „…+02:00"). */
export function isoWithZone(ms: number, zone: string): string {
  // Auf ganze Minuten runden: file.lastModified kann Sub-Sekunden-Bruchteile
  // tragen, die sonst in den Offset lecken („+01:59.99335…", M7-Fund) —
  // echte Zonen-Offsets sind immer ganze Minuten.
  const offset = Math.round(zoneOffsetMs(ms, zone) / 60000) * 60000
  const sign = offset >= 0 ? '+' : '-'
  const absMin = Math.abs(offset) / 60000
  const hh = String(Math.floor(absMin / 60)).padStart(2, '0')
  const mm = String(absMin % 60).padStart(2, '0')
  return new Date(ms + offset).toISOString().replace(/\.\d{3}Z$/, `${sign}${hh}:${mm}`)
}

/** Zonenlose EXIF-Zeit (Y/M/D h:m:s) in der Tour-Zone als Epoche-ms deuten. */
export function exifDateToMs(
  d: { y: number; mo: number; d: number; hh: number; mm: number; ss: number },
  zone: string,
): number {
  const naive = Date.UTC(d.y, d.mo - 1, d.d, d.hh, d.mm, d.ss)
  let ms = naive - zoneOffsetMs(naive, zone)
  ms = naive - zoneOffsetMs(ms, zone) // zweite Iteration fängt DST-Kanten ab
  return ms
}

/** Erlaubte Datei-Endungen (Spiegel des Server-Schemas) → Medientyp oder null. */
export function mediaType(fileName: string): 'photo' | 'video' | null {
  const extension = fileName.toLowerCase().split('.').pop() ?? ''
  if (['jpg', 'jpeg', 'png', 'webp'].includes(extension)) return 'photo'
  if (['mp4', 'mov', 'webm'].includes(extension)) return 'video'
  return null
}

/** Upload-Manifest aus den gesammelten Angaben (trackFile-Variante). */
export function buildUploadManifest(opts: {
  clientTourId: string
  title: string | null
  zeitspanne: { startMs: number; endMs: number }
  zone: string
  trackMode: string
  media: MediumInput[]
}): UploadManifest {
  return {
    schema: 'maptale/upload@2',
    clientTourId: opts.clientTourId,
    title: opts.title,
    description: null,
    time: {
      start: isoWithZone(opts.zeitspanne.startMs, opts.zone),
      end: isoWithZone(opts.zeitspanne.endMs, opts.zone),
      zone: opts.zone,
    },
    trackFile: 'track.gpx',
    trackMode: opts.trackMode,
    media: opts.media,
  }
}
