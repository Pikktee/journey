// Medien-Routen: Upload einzelner Dateien (PUT, idempotent — WorkManager-
// freundlich), Audio-Assets (Baukasten) und Auslieferung mit HTTP-Range-
// Support (Video-Seeking, Audio-Scrubbing).

import type { FastifyInstance } from 'fastify'
import type { Readable } from 'node:stream'
import { requireUser } from '../app.js'
import { withManifestLock } from '../manifest-lock.js'
import { newMediumId } from '../ids.js'
import { displayFilename, thumbFilename } from '../pipeline/image.js'
import { posterFilename, webVideoFilename } from '../pipeline/video.js'
import { checkQuota } from '../quota.js'
import { AUDIO_FILE_PATTERN, type EditOverlay } from '../schema/edits.js'
import {
  MAX_MEDIA_PER_TOUR,
  mediumFilename,
  addMediaJsonSchema,
  type AddedMedium,
  type UploadManifest,
  type UploadMedium,
} from '../schema/upload.js'
import {
  canView,
  EDITS_PATH,
  loadTour,
  MANIFEST_PATH,
  mediumExists,
  startProcessing,
  TRACK_PATH,
} from './tours.js'

const CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  // Nur bis zum ersten Render: Danach ist das Original verworfen und
  // ausgeliefert wird die JPEG-Ableitung. Ohne Eintrag ginge es als
  // octet-stream raus und der Studio-Editor zeigte eine leere Fläche.
  heic: 'image/heic',
  heif: 'image/heif',
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
  required: ['id', 'file'],
  properties: {
    id: { type: 'string' },
    file: { type: 'string', pattern: AUDIO_FILE_PATTERN },
  },
} as const

export function registerMediaRoutes(app: FastifyInstance): void {
  const { storage, userStorage, config, db } = app.deps

  // Quota-Vorabprüfung anhand von Content-Length (M9): fängt den Regelfall ab,
  // bevor Bytes fließen. Ohne Header greift weiterhin die harte Pro-Datei-Grenze
  // (maxMediumBytes/maxAudioBytes) im Stream-Guard. Setzt einen aufgelösten
  // Owner voraus (Aufrufer hat das geprüft).
  const quotaPreCheck = async (
    request: import('fastify').FastifyRequest,
  ): Promise<string | null> => {
    const length = Number(request.headers['content-length'] ?? 0)
    if (!Number.isFinite(length) || length <= 0 || !request.user) return null
    return checkQuota(db, storage, userStorage, request.user.id, config.maxStoragePerUser, length)
  }

  // — Upload: rohes Binär in den Body, Dateiname kommt aus dem Manifest —
  app.put<{ Params: { id: string; mid: string } }>(
    '/api/tours/:id/media/:mid',
    async (request, reply) => {
      const user = requireUser(request, reply)
      if (!user) return
      const tour = loadTour(app, request.params.id)
      if (!tour || tour.owner_id !== user.id)
        return reply.code(404).send({ error: 'Tour nicht gefunden' })
      if (tour.status === 'processing') {
        return reply.code(409).send({ error: 'Verarbeitung läuft, bitte gleich erneut hochladen' })
      }

      const manifest = JSON.parse(
        (await storage.read(tour.id, MANIFEST_PATH)).toString(),
      ) as UploadManifest
      const medium = manifest.media.find((m) => m.id === request.params.mid)
      if (!medium)
        return reply.code(404).send({ error: `Unbekannte Medien-ID: ${request.params.mid}` })
      // Tombstone: Was endgültig gelöscht wurde, kommt unter seiner ID nie zurück —
      // die Auslieferung hat für diese Namen `immutable` versprochen.
      if (medium.removed) return reply.code(409).send({ error: 'Medium wurde endgültig gelöscht' })
      // Nach dem Rendern sind vorhandene Medien unveränderlich (derselbe
      // `immutable`-Grund). NACHGEREICHTE Einträge haben noch keine Datei — für
      // sie ist das PUT auch bei „bereit" erlaubt, sonst bliebe die additive
      // Route (POST …/media) bei fertigen Touren wirkungslos.
      if (tour.status === 'ready' && (await mediumExists(storage, tour.id, medium))) {
        return reply.code(409).send({ error: 'Medien sind im Status „bereit" unveränderlich' })
      }

      const quotaError = await quotaPreCheck(request)
      if (quotaError) return reply.code(413).send({ error: quotaError })

      const info = await storage.writeStream(
        tour.id,
        `media/${mediumFilename(medium)}`,
        request.body as Readable,
        config.maxMediumBytes,
      )
      return reply.code(200).send({ id: medium.id, bytes: info.size })
    },
  )

  // — Nachreichen: neue Manifest-Einträge, die IDs vergibt der SERVER —
  // Das Manifest ist append-only: bestehende Einträge fasst diese Route nie an,
  // kein Dateiname wird je neu belegt (die `immutable`-Zusage der Auslieferung
  // bleibt wahr). Server-IDs statt Client-IDs, weil beim Nachreichen keine
  // idempotente Wiederholung des Anlegens nötig ist — dafür garantiert die
  // Vergabe hier, dass keine ID kollidiert oder je wiederverwendet wird
  // (Tombstones bleiben im Manifest stehen und zählen mit).
  app.post<{ Params: { id: string }; Body: { media: AddedMedium[] } }>(
    '/api/tours/:id/media',
    { schema: { body: addMediaJsonSchema } },
    async (request, reply) => {
      const user = requireUser(request, reply)
      if (!user) return
      // Nachreichen ist ein Upload: dieselbe Verifikations-Schwelle wie beim Anlegen
      if (!app.auth.isVerified(user.id)) {
        return reply.code(403).send({ error: 'Bitte bestätige zuerst deine E-Mail-Adresse' })
      }
      const tour = loadTour(app, request.params.id)
      if (!tour || tour.owner_id !== user.id)
        return reply.code(404).send({ error: 'Tour nicht gefunden' })
      // 409 NUR während laufender Verarbeitung (der Renderer liest media/ und
      // Manifest gerade) — „angelegt", „bereit" und „fehler" sind erlaubt:
      // Genau der Status „bereit" ist der Zweck der Route (Cloud-Touren,
      // Studio-Nachreichen).
      if (tour.status === 'processing') {
        return reply.code(409).send({ error: 'Verarbeitung läuft, bitte gleich erneut hinzufügen' })
      }

      // Lesen → Ändern → Schreiben gehört unter die Sperre: Zwei gleichzeitige
      // Zustellungen lesen sonst denselben Stand, und der zweite Schreiber
      // wirft den Eintrag des ersten weg (s. manifestsperre.ts).
      return withManifestLock(tour.id, async () => {
        const manifest = JSON.parse(
          (await storage.read(tour.id, MANIFEST_PATH)).toString(),
        ) as UploadManifest
        if (manifest.media.length + request.body.media.length > MAX_MEDIA_PER_TOUR) {
          return reply
            .code(400)
            .send({ error: `Zu viele Medien (max. ${MAX_MEDIA_PER_TOUR} je Tour)` })
        }
        // Dateiendung + Zeitstempel-Semantik prüfen, BEVOR irgendetwas geschrieben
        // wird — halbe Batches soll es nicht geben.
        for (const entry of request.body.media) {
          try {
            mediumFilename({ ...entry, id: 'pruef' })
          } catch (error) {
            return reply.code(400).send({ error: (error as Error).message })
          }
          if (!Number.isFinite(Date.parse(entry.takenAt))) {
            return reply.code(400).send({ error: `Ungültiger Aufnahmezeitpunkt: ${entry.takenAt}` })
          }
        }

        // IDs kollisionsfrei vergeben — gegen ALLE Einträge, auch Tombstones
        const taken = new Set(manifest.media.map((m) => m.id))
        // Der Idempotenz-Riegel des Foto-Nachzugs: Was unter derselben `source`
        // schon im Manifest steht, wird NICHT ein zweites Mal angelegt — die
        // vorhandene Zuordnung geht zurück. Der Client kann seinen Lauf damit
        // gefahrlos wiederholen, auch wenn er beim ersten Mal mittendrin abbrach
        // oder das Rendern danach scheiterte (s. `source` im Schema).
        //
        // Tombstones zählen MIT: Ein endgültig gelöschtes Foto soll nicht beim
        // nächsten Lauf wiederkommen — genau das wäre das Gegenteil von „Löschen
        // ist echt". Die Antwort nennt seine alte ID; das PUT darauf lehnt die
        // Upload-Route mit 409 ab, und der Client hat nichts verloren.
        const bySource = new Map(
          manifest.media.filter((m) => m.source).map((m) => [m.source as string, m]),
        )
        const mapping: UploadMedium[] = []
        const added: UploadMedium[] = []
        for (const entry of request.body.media) {
          const known = entry.source ? bySource.get(entry.source) : undefined
          if (known) {
            mapping.push(known)
            continue
          }
          let id = newMediumId()
          while (taken.has(id)) id = newMediumId()
          taken.add(id)
          const created: UploadMedium = { ...entry, id }
          if (entry.source) bySource.set(entry.source, created)
          added.push(created)
          mapping.push(created)
        }
        if (added.length) {
          manifest.media = [...manifest.media, ...added]
          await storage.write(tour.id, MANIFEST_PATH, JSON.stringify(manifest, null, 2))
        }

        // Zuordnung zurückgeben: `file` ist das PUT-Ziel (media/<file>).
        // Sie hat IMMER so viele Einträge wie die Anfrage und in derselben
        // Reihenfolge — auch für die übersprungenen: Der Client paart sie mit
        // seinen Dateien über den Index, eine kürzere Liste verschöbe alles.
        return reply.code(200).send({
          media: mapping.map((m) => ({ id: m.id, file: mediumFilename(m) })),
          new: added.length,
        })
      })
    },
  )

  // — Endgültig löschen: Rohdatei + alle Ableitungen weg, Speicher frei —
  // Der Manifest-Eintrag bleibt als Tombstone stehen (`removed: true`): Das
  // Manifest ist das Protokoll dessen, was hochgeladen wurde, und nur so wird
  // keine Medien-ID je wiederverwendet. Die `immutable`-Cache-Header stehen dem
  // Löschen nicht entgegen — eine gelöschte Datei wird 404, nie stale.
  app.delete<{ Params: { id: string; mid: string } }>(
    '/api/tours/:id/media/:mid',
    async (request, reply) => {
      const user = requireUser(request, reply)
      if (!user) return
      const tour = loadTour(app, request.params.id)
      if (!tour || tour.owner_id !== user.id)
        return reply.code(404).send({ error: 'Tour nicht gefunden' })
      if (tour.status === 'processing') {
        return reply.code(409).send({ error: 'Verarbeitung läuft, bitte gleich erneut löschen' })
      }

      // Auch hier unter die Sperre: Eine gleichzeitige Zustellung an
      // `POST …/media` überschriebe sonst den frisch gesetzten Tombstone und
      // erweckte einen Eintrag, dessen Dateien gerade gelöscht wurden.
      return withManifestLock(tour.id, async () => {
        const manifest = JSON.parse(
          (await storage.read(tour.id, MANIFEST_PATH)).toString(),
        ) as UploadManifest
        const medium = manifest.media.find((m) => m.id === request.params.mid)
        if (!medium)
          return reply.code(404).send({ error: `Unbekannte Medien-ID: ${request.params.mid}` })
        // Idempotent: zweites Löschen desselben Mediums ist kein Fehler
        if (medium.removed) return { ok: true }

        // Original UND alle abgeleiteten Dateien: Anzeige-/Kachel-Fassung, bei
        // Videos Web-Fassung und Poster. `loesche` toleriert fehlende Dateien —
        // nach dem ersten Render ist das Original ohnehin schon verworfen.
        const files =
          medium.type === 'photo'
            ? [mediumFilename(medium), displayFilename(medium.id), thumbFilename(medium.id)]
            : [
                mediumFilename(medium),
                webVideoFilename(medium.id),
                posterFilename(medium.id),
                thumbFilename(medium.id),
              ]
        for (const file2 of files) {
          await storage.remove(tour.id, `media/${file2}`)
        }

        // Tombstone ins Manifest — NACH dem Löschen der Dateien: Bricht es
        // dazwischen ab, sind die Dateien weg und der Eintrag wirkt wie ein nie
        // hochgeladener (verfuegbareMedien filtert beide gleich).
        manifest.media = manifest.media.map((m) =>
          m.id === medium.id ? { ...m, removed: true } : m,
        )
        await storage.write(tour.id, MANIFEST_PATH, JSON.stringify(manifest, null, 2))

        // Overlay-Hygiene: Edits zu einer Datei, die es nicht mehr gibt, sind toter
        // Zustand — und ein `titelbild` auf das gelöschte Medium ließe bestimmeCover
        // beim nächsten Render ins Leere greifen statt neu zu wählen.
        if (await storage.info(tour.id, EDITS_PATH)) {
          const edits = JSON.parse(
            (await storage.read(tour.id, EDITS_PATH)).toString(),
          ) as EditOverlay
          let changed = false
          if (edits.media?.[medium.id]) {
            delete edits.media[medium.id]
            changed = true
          }
          if (edits.cover === medium.id) {
            delete edits.cover
            changed = true
          }
          if (changed) await storage.write(tour.id, EDITS_PATH, JSON.stringify(edits, null, 2))
        }

        // Gerenderte Tour direkt neu rendern (aus dem Cache, keine externen
        // Aufrufe), damit tour.json und Cover nicht auf verschwundene Dateien
        // zeigen. Schlägt der Claim fehl (paralleler Render), heilt der nächste
        // Render den Stand — bei „angelegt" gibt es noch nichts nachzuziehen.
        startProcessing(app, tour.id)
        return { ok: true }
      })
    },
  )

  // — GPX-Track hochladen (M6): das trackFile des Manifests, roher Body —
  app.put<{ Params: { id: string } }>('/api/tours/:id/track', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) return
    const tour = loadTour(app, request.params.id)
    if (!tour || tour.owner_id !== user.id)
      return reply.code(404).send({ error: 'Tour nicht gefunden' })
    if (tour.status === 'ready' || tour.status === 'processing') {
      return reply.code(409).send({ error: `Track ist im Status „${tour.status}" unveränderlich` })
    }
    const quotaError = await quotaPreCheck(request)
    if (quotaError) return reply.code(413).send({ error: quotaError })
    const info = await storage.writeStream(
      tour.id,
      TRACK_PATH,
      request.body as Readable,
      config.maxMediumBytes,
    )
    return reply.code(200).send({ bytes: info.size })
  })

  // — Audio-Assets (Baukasten): Musik/SFX für das Edit-Overlay hochladen —
  // Anders als Manifest-Medien sind Audios auch bei „bereit"/„fehler"/„angelegt"
  // erlaubt (sie werden im Editor nachgerüstet); nur während einer laufenden
  // Verarbeitung ist die Ablage tabu (der Renderer liest media/ gerade).
  app.put<{ Params: { id: string; file: string } }>(
    '/api/tours/:id/audio/:file',
    { schema: { params: audioParamsSchema } },
    async (request, reply) => {
      const user = requireUser(request, reply)
      if (!user) return
      const tour = loadTour(app, request.params.id)
      if (!tour || tour.owner_id !== user.id)
        return reply.code(404).send({ error: 'Tour nicht gefunden' })
      if (tour.status === 'processing') {
        return reply.code(409).send({ error: 'Verarbeitung läuft, bitte gleich erneut hochladen' })
      }
      const relPath = `media/${request.params.file}`
      // ÜBERSCHREIBEN VERBOTEN: die GET-Auslieferung verspricht
      // public/immutable-Cache-Header — eine neue Version unter altem Namen
      // würde stale ausgeliefert. Neue Version = neuer Name.
      if (await storage.info(tour.id, relPath)) {
        return reply
          .code(409)
          .send({ error: 'Audio-Datei existiert bereits, anderen Namen wählen' })
      }
      const quotaError = await quotaPreCheck(request)
      if (quotaError) return reply.code(413).send({ error: quotaError })
      const info = await storage.writeStream(
        tour.id,
        relPath,
        request.body as Readable,
        config.maxAudioBytes,
      )
      return reply.code(200).send({ file: request.params.file, bytes: info.size })
    },
  )

  // — Audio-Asset löschen — kein Re-Render hier: den löst der Editor über
  // PUT /edits aus (das Overlay referenziert die Datei ja ggf. noch).
  app.delete<{ Params: { id: string; file: string } }>(
    '/api/tours/:id/audio/:file',
    { schema: { params: audioParamsSchema } },
    async (request, reply) => {
      const user = requireUser(request, reply)
      if (!user) return
      const tour = loadTour(app, request.params.id)
      if (!tour || tour.owner_id !== user.id)
        return reply.code(404).send({ error: 'Tour nicht gefunden' })
      if (tour.status === 'processing') {
        return reply.code(409).send({ error: 'Verarbeitung läuft, bitte gleich erneut löschen' })
      }
      // Referenz-Schutz: solange die GESPEICHERTEN Bearbeitungen die Datei noch
      // nutzen, würde das Löschen ein bereits gerendertes tour.json auf eine
      // 404-Quelle zeigen lassen — erst Eintrag entfernen und speichern.
      if (await storage.info(tour.id, EDITS_PATH)) {
        const edits = JSON.parse(
          (await storage.read(tour.id, EDITS_PATH)).toString(),
        ) as EditOverlay
        if (edits.audio?.some((a) => a.file === request.params.file)) {
          return reply.code(409).send({
            error:
              'Datei wird von den gespeicherten Bearbeitungen genutzt, erst Eintrag entfernen und speichern',
          })
        }
      }
      const relPath = `media/${request.params.file}`
      if (!(await storage.info(tour.id, relPath))) {
        return reply.code(404).send({ error: 'Audio-Datei nicht gefunden' })
      }
      await storage.remove(tour.id, relPath)
      return { ok: true }
    },
  )

  // — Auslieferung mit Range-Support —
  app.get<{ Params: { tourId: string; file: string } }>(
    '/api/media/:tourId/:file',
    async (request, reply) => {
      const { tourId, file: file2 } = request.params
      // Nur von uns vergebene Dateinamen — keine Pfad-Spiele. Mehrere Punkt-
      // Segmente sind erlaubt (Poster „m1.poster.jpg", Transcode „m1.web.mp4"),
      // aber jedes Segment braucht ein echtes Zeichen → „.." ist ausgeschlossen.
      if (!/^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*\.[a-z0-9]+$/.test(file2)) {
        return reply.code(404).send({ error: 'Nicht gefunden' })
      }

      const tour = loadTour(app, tourId)
      if (!tour || !canView(tour, request.user?.id ?? null)) {
        return reply.code(404).send({ error: 'Nicht gefunden' })
      }

      const relPath = `media/${file2}`
      const info = await storage.info(tourId, relPath)
      if (!info) return reply.code(404).send({ error: 'Nicht gefunden' })

      const extension = file2.split('.').pop() ?? ''
      reply.header('content-type', CONTENT_TYPES[extension] ?? 'application/octet-stream')
      reply.header('x-content-type-options', 'nosniff') // nutzergenerierte Dateien: kein MIME-Sniffing
      reply.header('accept-ranges', 'bytes')
      // Medien sind nach dem Rendern unveränderlich → aggressiv cachen. Aber:
      // `public` NUR für per Link teilbare Touren — private Medien dürfen nie
      // in geteilten Caches (Proxy/CDN) landen.
      reply.header(
        'cache-control',
        tour.visibility === 'private'
          ? 'private, max-age=3600'
          : 'public, max-age=31536000, immutable',
      )

      const range = parseRange(request.headers.range, info.size)
      if (range === 'invalid') {
        return reply.code(416).header('content-range', `bytes */${info.size}`).send()
      }
      if (range) {
        reply.code(206)
        reply.header('content-range', `bytes ${range.start}-${range.end}/${info.size}`)
        reply.header('content-length', range.end - range.start + 1)
        return reply.send(storage.readStream(tourId, relPath, range))
      }
      reply.header('content-length', info.size)
      return reply.send(storage.readStream(tourId, relPath))
    },
  )
}

/**
 * `Range: bytes=a-b` auswerten; nur ein Bereich (mehr braucht kein <video>).
 * RFC 9110: UNVERSTANDENE Range-Syntax (z. B. Multi-Range, fremde Einheit)
 * wird IGNORIERT (→ null, volle 200-Antwort); `invalid` (→ 416) ist nur
 * die syntaktisch korrekte, aber unerfüllbare Anfrage.
 */
export function parseRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | 'invalid' | null {
  if (!header) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m) return null // Multi-Range/fremde Einheit: ignorieren, voll antworten
  const [, fromStr = '', toStr = ''] = m
  if (fromStr === '' && toStr === '') return null // "bytes=-": keine Bereichsangabe
  // Suffix-Form „-500": die letzten N Bytes
  if (fromStr === '') {
    const n = Math.min(Number(toStr), size)
    return n === 0 ? 'invalid' : { start: size - n, end: size - 1 }
  }
  const start = Number(fromStr)
  const end = toStr === '' ? size - 1 : Math.min(Number(toStr), size - 1)
  if (start >= size || start > end) return 'invalid'
  return { start, end }
}
