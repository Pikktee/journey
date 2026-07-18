// Medien-Routen: Upload einzelner Dateien (PUT, idempotent — WorkManager-
// freundlich), Audio-Assets (Baukasten) und Auslieferung mit HTTP-Range-
// Support (Video-Seeking, Audio-Scrubbing).

import type { FastifyInstance } from 'fastify'
import type { Readable } from 'node:stream'
import { erfordereBenutzer } from '../app.js'
import { pruefeQuota } from '../quota.js'
import { AUDIO_DATEI_PATTERN, type EditOverlay } from '../schema/edits.js'
import { mediumDateiname, type UploadManifest } from '../schema/upload.js'
import { darfSehen, EDITS_PFAD, ladeTour, MANIFEST_PFAD, TRACK_PFAD } from './tours.js'

const CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
}

// Params-Schema der Audio-Routen: der Dateiname ist Client-Eingabe und wird
// Teil des Ablagepfads — nur die enge Basisname+Endung-Form kommt durch.
const audioParamsSchema = {
  type: 'object',
  required: ['id', 'datei'],
  properties: {
    id: { type: 'string' },
    datei: { type: 'string', pattern: AUDIO_DATEI_PATTERN },
  },
} as const

export function registriereMediaRouten(app: FastifyInstance): void {
  const { storage, konfig, db } = app.deps

  // Quota-Vorabprüfung anhand von Content-Length (M9): fängt den Regelfall ab,
  // bevor Bytes fließen. Ohne Header greift weiterhin die harte Pro-Datei-Grenze
  // (maxMediumBytes/maxAudioBytes) im Stream-Guard. Setzt einen aufgelösten
  // Owner voraus (Aufrufer hat das geprüft).
  const quotaVorabPruefung = async (request: import('fastify').FastifyRequest): Promise<string | null> => {
    const laenge = Number(request.headers['content-length'] ?? 0)
    if (!Number.isFinite(laenge) || laenge <= 0 || !request.benutzer) return null
    return pruefeQuota(db, storage, request.benutzer.id, konfig.maxSpeicherProBenutzer, laenge)
  }

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

    const quotaFehler = await quotaVorabPruefung(request)
    if (quotaFehler) return reply.code(413).send({ fehler: quotaFehler })

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
    const quotaFehler = await quotaVorabPruefung(request)
    if (quotaFehler) return reply.code(413).send({ fehler: quotaFehler })
    const info = await storage.schreibeStream(tour.id, TRACK_PFAD, request.body as Readable, konfig.maxMediumBytes)
    return reply.code(200).send({ bytes: info.groesse })
  })

  // — Audio-Assets (Baukasten): Musik/SFX für das Edit-Overlay hochladen —
  // Anders als Manifest-Medien sind Audios auch bei „bereit"/„fehler"/„angelegt"
  // erlaubt (sie werden im Editor nachgerüstet); nur während einer laufenden
  // Verarbeitung ist die Ablage tabu (der Renderer liest media/ gerade).
  app.put<{ Params: { id: string; datei: string } }>(
    '/api/tours/:id/audio/:datei',
    { schema: { params: audioParamsSchema } },
    async (request, reply) => {
      const benutzer = erfordereBenutzer(request, reply)
      if (!benutzer) return
      const tour = ladeTour(app, request.params.id)
      if (!tour || tour.owner_id !== benutzer.id) return reply.code(404).send({ fehler: 'Tour nicht gefunden' })
      if (tour.status === 'verarbeitung') {
        return reply.code(409).send({ fehler: 'Verarbeitung läuft — bitte gleich erneut hochladen' })
      }
      const relPfad = `media/${request.params.datei}`
      // ÜBERSCHREIBEN VERBOTEN: die GET-Auslieferung verspricht
      // public/immutable-Cache-Header — eine neue Version unter altem Namen
      // würde stale ausgeliefert. Neue Version = neuer Name.
      if (await storage.info(tour.id, relPfad)) {
        return reply.code(409).send({ fehler: 'Audio-Datei existiert bereits — anderen Namen wählen' })
      }
      const quotaFehler = await quotaVorabPruefung(request)
      if (quotaFehler) return reply.code(413).send({ fehler: quotaFehler })
      const info = await storage.schreibeStream(tour.id, relPfad, request.body as Readable, konfig.maxAudioBytes)
      return reply.code(200).send({ datei: request.params.datei, bytes: info.groesse })
    },
  )

  // — Audio-Asset löschen — kein Re-Render hier: den löst der Editor über
  // PUT /edits aus (das Overlay referenziert die Datei ja ggf. noch).
  app.delete<{ Params: { id: string; datei: string } }>(
    '/api/tours/:id/audio/:datei',
    { schema: { params: audioParamsSchema } },
    async (request, reply) => {
      const benutzer = erfordereBenutzer(request, reply)
      if (!benutzer) return
      const tour = ladeTour(app, request.params.id)
      if (!tour || tour.owner_id !== benutzer.id) return reply.code(404).send({ fehler: 'Tour nicht gefunden' })
      if (tour.status === 'verarbeitung') {
        return reply.code(409).send({ fehler: 'Verarbeitung läuft — bitte gleich erneut löschen' })
      }
      // Referenz-Schutz: solange die GESPEICHERTEN Bearbeitungen die Datei noch
      // nutzen, würde das Löschen ein bereits gerendertes tour.json auf eine
      // 404-Quelle zeigen lassen — erst Eintrag entfernen und speichern.
      if (await storage.info(tour.id, EDITS_PFAD)) {
        const edits = JSON.parse((await storage.lese(tour.id, EDITS_PFAD)).toString()) as EditOverlay
        if (edits.audio?.some((a) => a.datei === request.params.datei)) {
          return reply
            .code(409)
            .send({ fehler: 'Datei wird von den gespeicherten Bearbeitungen genutzt — erst Eintrag entfernen und speichern' })
        }
      }
      const relPfad = `media/${request.params.datei}`
      if (!(await storage.info(tour.id, relPfad))) {
        return reply.code(404).send({ fehler: 'Audio-Datei nicht gefunden' })
      }
      await storage.loesche(tour.id, relPfad)
      return { ok: true }
    },
  )

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
