// Studio-Upload-Logik (M6): reine Funktionen zum Bauen des Upload-Manifests aus
// den im Browser gewählten Dateien. Die eigentlichen fetch-Aufrufe stecken in
// api.ts, die DOM-Verdrahtung in studio.ts — hier nichts Seiteneffektbehaftetes,
// damit es unter Vitest testbar bleibt.

export interface MediumEingabe {
  id: string
  type: 'photo' | 'video'
  file: string
  takenAt: string
  anchor?: [number, number]
}

export interface UploadManifest {
  schema: 'luhambo/upload@1'
  clientTourId: string
  title: string | null
  description: null
  time: { start: string; end: string; zone: string }
  trackFile: 'track.gpx'
  trackMode: string
  media: MediumEingabe[]
}

/**
 * Früheste/späteste Trackpunkt-Zeit aus GPX-XML (nur <trkpt>, nicht Metadaten).
 * Nicht-backtrackend (siehe parseGpx im Server) und mit inkrementellem min/max
 * statt `Math.min(...zeiten)` — der Spread sprengt bei sehr langen Tracks den
 * Argument-Stack. Braucht ≥ 2 Zeiten mit echter Spanne, sonst null.
 */
export function gpxZeitspanne(xml: string): { startMs: number; endMs: number } | null {
  const tagRe = /<trkpt\b[^>]*>/g
  let min = Infinity
  let max = -Infinity
  let anzahl = 0
  while (tagRe.exec(xml) !== null) {
    // festes Fenster statt unbeschränktem indexOf (das ohne Treffer bei jedem
    // offenen Tag bis Dateiende scannt → O(N²), siehe parseGpx im Server)
    const inhalt = xml.slice(tagRe.lastIndex, tagRe.lastIndex + 500)
    const t = /<time>([^<]+)<\/time>/.exec(inhalt)?.[1]
    if (t) {
      const ms = Date.parse(t)
      if (Number.isFinite(ms)) {
        if (ms < min) min = ms
        if (ms > max) max = ms
        anzahl++
      }
    }
  }
  return anzahl >= 2 && max > min ? { startMs: min, endMs: max } : null
}

/** Trackpunkt-Anzahl (für die UI-Rückmeldung „N Punkte"). */
export function gpxPunktAnzahl(xml: string): number {
  return (xml.match(/<trkpt\b/g) ?? []).length
}

// Zeitzonen-Offset (ms) einer IANA-Zone zu einem UTC-Zeitpunkt — via Intl, ohne
// Bibliothek. Basis für isoMitZone/exifDatumZuMs (EXIF kennt keine Zone).
function zonenOffsetMs(utcMs: number, zone: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  })
  const teile = Object.fromEntries(fmt.formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]))
  const lokalAlsUtc = Date.UTC(
    Number(teile.year), Number(teile.month) - 1, Number(teile.day),
    Number(teile.hour) % 24, Number(teile.minute), Number(teile.second),
  )
  return lokalAlsUtc - utcMs
}

/** Epoche-ms → ISO 8601 mit dem Offset der Zone (z. B. „…+02:00"). */
export function isoMitZone(ms: number, zone: string): string {
  // Auf ganze Minuten runden: file.lastModified kann Sub-Sekunden-Bruchteile
  // tragen, die sonst in den Offset lecken („+01:59.99335…", M7-Fund) —
  // echte Zonen-Offsets sind immer ganze Minuten.
  const offset = Math.round(zonenOffsetMs(ms, zone) / 60000) * 60000
  const vorzeichen = offset >= 0 ? '+' : '-'
  const absMin = Math.abs(offset) / 60000
  const hh = String(Math.floor(absMin / 60)).padStart(2, '0')
  const mm = String(absMin % 60).padStart(2, '0')
  return new Date(ms + offset).toISOString().replace(/\.\d{3}Z$/, `${vorzeichen}${hh}:${mm}`)
}

/** Zonenlose EXIF-Zeit (Y/M/D h:m:s) in der Tour-Zone als Epoche-ms deuten. */
export function exifDatumZuMs(d: { y: number; mo: number; d: number; hh: number; mm: number; ss: number }, zone: string): number {
  const naiv = Date.UTC(d.y, d.mo - 1, d.d, d.hh, d.mm, d.ss)
  let ms = naiv - zonenOffsetMs(naiv, zone)
  ms = naiv - zonenOffsetMs(ms, zone) // zweite Iteration fängt DST-Kanten ab
  return ms
}

/** Erlaubte Datei-Endungen (Spiegel des Server-Schemas) → Medientyp oder null. */
export function medientyp(dateiname: string): 'photo' | 'video' | null {
  const endung = dateiname.toLowerCase().split('.').pop() ?? ''
  if (['jpg', 'jpeg', 'png', 'webp'].includes(endung)) return 'photo'
  if (['mp4', 'mov', 'webm'].includes(endung)) return 'video'
  return null
}

/** Upload-Manifest aus den gesammelten Angaben (trackFile-Variante). */
export function baueUploadManifest(opts: {
  clientTourId: string
  title: string | null
  zeitspanne: { startMs: number; endMs: number }
  zone: string
  trackMode: string
  medien: MediumEingabe[]
}): UploadManifest {
  return {
    schema: 'luhambo/upload@1',
    clientTourId: opts.clientTourId,
    title: opts.title,
    description: null,
    time: {
      start: isoMitZone(opts.zeitspanne.startMs, opts.zone),
      end: isoMitZone(opts.zeitspanne.endMs, opts.zone),
      zone: opts.zone,
    },
    trackFile: 'track.gpx',
    trackMode: opts.trackMode,
    media: opts.medien,
  }
}
