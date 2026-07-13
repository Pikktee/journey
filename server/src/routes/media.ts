// Medien-Routen: Upload einzelner Dateien (PUT, idempotent — WorkManager-
// freundlich) und Auslieferung mit HTTP-Range-Support (Video-Seeking).

import type { FastifyInstance } from 'fastify'
import type { Readable } from 'node:stream'
import { erfordereBenutzer } from '../app.js'
import { mediumDateiname, type UploadManifest } from '../schema/upload.js'
import { darfSehen, ladeTour, MANIFEST_PFAD, TRACK_PFAD } from './tours.js'

const CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
}

export function registriereMediaRouten(app: FastifyInstance): void {
  const { storage, konfig } = app.deps

  // — Upload: rohes Binär in den Body, Dateiname kommt aus dem Manifest —
  app.put<{ Params: { id: string; mid: string } }>('/api/tours/:id/media/:mid', async (request, reply) => {
    const benutzer = erfordereBenutzer(request, reply)
    if (!benutzer) return
    const tour = ladeTour(app, request.params.id)
    if (!tour || tour.owner_id !== benutzer.id) return reply.code(404).send({ fehler: 'Tour nicht gefunden' })
    // Nach dem Rendern sind Medien unveränderlich (die Auslieferung verspricht
    // `immutable`) — Überschreiben nur solange die Tour nicht bereit ist.
    if (tour.status === 'bereit' || tour.status === 'verarbeitung') {
      return reply.code(409).send({ fehler: `Medien sind im Status „${tour.status}" unveränderlich` })
    }

    const manifest = JSON.parse((await storage.lese(tour.id, MANIFEST_PFAD)).toString()) as UploadManifest
    const medium = manifest.media.find((m) => m.id === request.params.mid)
    if (!medium) return reply.code(404).send({ fehler: `Unbekannte Medien-ID: ${request.params.mid}` })

    const info = await storage.schreibeStream(
      tour.id,
      `media/${mediumDateiname(medium)}`,
      request.body as Readable,
      konfig.maxMediumBytes,
    )
    return reply.code(200).send({ id: medium.id, bytes: info.groesse })
  })

  // — GPX-Track hochladen (M6): das trackFile des Manifests, roher Body —
  app.put<{ Params: { id: string } }>('/api/tours/:id/track', async (request, reply) => {
    const benutzer = erfordereBenutzer(request, reply)
    if (!benutzer) return
    const tour = ladeTour(app, request.params.id)
    if (!tour || tour.owner_id !== benutzer.id) return reply.code(404).send({ fehler: 'Tour nicht gefunden' })
    if (tour.status === 'bereit' || tour.status === 'verarbeitung') {
      return reply.code(409).send({ fehler: `Track ist im Status „${tour.status}" unveränderlich` })
    }
    const info = await storage.schreibeStream(tour.id, TRACK_PFAD, request.body as Readable, konfig.maxMediumBytes)
    return reply.code(200).send({ bytes: info.groesse })
  })

  // — Auslieferung mit Range-Support —
  app.get<{ Params: { tourId: string; datei: string } }>('/api/media/:tourId/:datei', async (request, reply) => {
    const { tourId, datei } = request.params
    // Nur von uns vergebene Dateinamen — keine Pfad-Spiele. Mehrere Punkt-
    // Segmente sind erlaubt (Poster „m1.poster.jpg", Transcode „m1.web.mp4"),
    // aber jedes Segment braucht ein echtes Zeichen → „.." ist ausgeschlossen.
    if (!/^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*\.[a-z0-9]+$/.test(datei)) {
      return reply.code(404).send({ fehler: 'Nicht gefunden' })
    }

    const tour = ladeTour(app, tourId)
    if (!tour || !darfSehen(tour, request.benutzer?.id ?? null)) {
      return reply.code(404).send({ fehler: 'Nicht gefunden' })
    }

    const relPfad = `media/${datei}`
    const info = await storage.info(tourId, relPfad)
    if (!info) return reply.code(404).send({ fehler: 'Nicht gefunden' })

    const endung = datei.split('.').pop() ?? ''
    reply.header('content-type', CONTENT_TYPES[endung] ?? 'application/octet-stream')
    reply.header('x-content-type-options', 'nosniff') // nutzergenerierte Dateien: kein MIME-Sniffing
    reply.header('accept-ranges', 'bytes')
    // Medien sind nach dem Rendern unveränderlich → aggressiv cachen. Aber:
    // `public` NUR für per Link teilbare Touren — private Medien dürfen nie
    // in geteilten Caches (Proxy/CDN) landen.
    reply.header(
      'cache-control',
      tour.visibility === 'private' ? 'private, max-age=3600' : 'public, max-age=31536000, immutable',
    )

    const range = parseRange(request.headers.range, info.groesse)
    if (range === 'ungueltig') {
      return reply.code(416).header('content-range', `bytes */${info.groesse}`).send()
    }
    if (range) {
      reply.code(206)
      reply.header('content-range', `bytes ${range.start}-${range.ende}/${info.groesse}`)
      reply.header('content-length', range.ende - range.start + 1)
      return reply.send(storage.leseStream(tourId, relPfad, range))
    }
    reply.header('content-length', info.groesse)
    return reply.send(storage.leseStream(tourId, relPfad))
  })
}

/**
 * `Range: bytes=a-b` auswerten; nur ein Bereich (mehr braucht kein <video>).
 * RFC 9110: UNVERSTANDENE Range-Syntax (z. B. Multi-Range, fremde Einheit)
 * wird IGNORIERT (→ null, volle 200-Antwort); `ungueltig` (→ 416) ist nur
 * die syntaktisch korrekte, aber unerfüllbare Anfrage.
 */
export function parseRange(
  header: string | undefined,
  groesse: number,
): { start: number; ende: number } | 'ungueltig' | null {
  if (!header) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m) return null // Multi-Range/fremde Einheit: ignorieren, voll antworten
  const [, vonStr = '', bisStr = ''] = m
  if (vonStr === '' && bisStr === '') return null // "bytes=-": keine Bereichsangabe
  // Suffix-Form „-500": die letzten N Bytes
  if (vonStr === '') {
    const n = Math.min(Number(bisStr), groesse)
    return n === 0 ? 'ungueltig' : { start: groesse - n, ende: groesse - 1 }
  }
  const start = Number(vonStr)
  const ende = bisStr === '' ? groesse - 1 : Math.min(Number(bisStr), groesse - 1)
  if (start >= groesse || start > ende) return 'ungueltig'
  return { start, ende }
}
