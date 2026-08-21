// Benutzerweite Audio-Bibliothek: eigene Musik und Effekte, EINMAL hochgeladen
// und in jeder Tour einsetzbar (quelle 'benutzer' im Edit-Overlay). Die Dateien
// liegen im benutzerStorage unter <userId>/audio/ — denselben Ordner räumt die
// Konto-Löschung (auth.ts) bereits komplett ab. Gelöscht werden kann eine Datei
// nur, solange KEINE Tour sie mehr verwendet; ausgeliefert wird sie über die
// Tour, damit deren Sichtbarkeit den Zugriff regelt (eine userId-Route würde
// private Dateien für jeden erratbar machen, der ein öffentliches Profil kennt).

import type { FastifyInstance } from 'fastify'
import type { Readable } from 'node:stream'
import { requireUser } from '../app.js'
import { checkQuota } from '../quota.js'
import { AUDIO_FILE_PATTERN, type EditOverlay } from '../schema/edits.js'
import { canView, EDITS_PATH, loadTour, TOUR_JSON_PATH } from './tours.js'
import { parseRange } from './media.js'

/** Unterordner der Bibliothek im benutzerStorage (neben dem flach liegenden Avatar). */
export const LIBRARY_FOLDER = 'audio'

const AUDIO_CONTENT_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
}

// Der Dateiname wird Teil des Ablagepfads — nur Basisname + Audio-Endung.
const fileParamsSchema = {
  type: 'object',
  required: ['file'],
  properties: { file: { type: 'string', pattern: AUDIO_FILE_PATTERN } },
} as const

/** Verweist dieser Overlay-/Tour-JSON-Stand auf die Bibliotheksdatei? */
function referenced(
  edits: EditOverlay | null,
  tourJsonAudio: Array<{ src?: string }> | null,
  tourId: string,
  file2: string,
): boolean {
  if (edits?.audio?.some((a) => a.source === 'user' && a.file === file2)) return true
  // Auch das GERENDERTE tour.json zählt: zwischen „Eintrag entfernt und
  // gespeichert" und dem fertigen Re-Render zeigt der Player sonst auf eine 404.
  const src = `/api/tours/${tourId}/library-audio/${file2}`
  return tourJsonAudio?.some((a) => a.src === src) ?? false
}

export function registerAudioLibraryRoutes(app: FastifyInstance): void {
  const { storage, userStorage, config, db } = app.deps

  interface TourState {
    id: string
    title: string
    edits: EditOverlay | null
    tourAudio: Array<{ src?: string }> | null
  }

  /** Overlay + gerendertes Audio ALLER Touren des Benutzers einmal einlesen —
   *  die Liste prüft danach jede Datei gegen denselben Stand. */
  const loadTourStates = async (userId: string): Promise<TourState[]> => {
    const tours = db
      .prepare('SELECT id, no, title FROM tours WHERE owner_id = ? ORDER BY created_at DESC')
      .all(userId) as Array<{ id: string; no: number; title: string | null }>
    return Promise.all(
      tours.map(async (tour) => {
        let edits: EditOverlay | null = null
        if (await storage.info(tour.id, EDITS_PATH)) {
          edits = JSON.parse((await storage.read(tour.id, EDITS_PATH)).toString()) as EditOverlay
        }
        let tourAudio: Array<{ src?: string }> | null = null
        if (await storage.info(tour.id, TOUR_JSON_PATH)) {
          tourAudio =
            (
              JSON.parse((await storage.read(tour.id, TOUR_JSON_PATH)).toString()) as {
                audio?: Array<{ src?: string }>
              }
            ).audio ?? null
        }
        return {
          id: tour.id,
          title: tour.title ?? `N°${String(tour.no).padStart(2, '0')}`,
          edits,
          tourAudio,
        }
      }),
    )
  }

  const usersOf = (states: TourState[], file2: string): Array<{ id: string; title: string }> =>
    states
      .filter((s) => referenced(s.edits, s.tourAudio, s.id, file2))
      .map(({ id, title }) => ({ id, title }))

  // — Liste: alle Dateien der Bibliothek + wo sie im Einsatz sind (die
  // Oberfläche graut den Löschen-Knopf verwendeter Dateien damit aus) —
  app.get('/api/audio-library', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) return
    const files = await userStorage.listFiles(user.id, LIBRARY_FOLDER)
    const states = files.length ? await loadTourStates(user.id) : []
    return {
      files: files.map((d) => ({
        file: d.name,
        size: d.size,
        usedBy: usersOf(states, d.name),
      })),
    }
  })

  // — Upload. Wie bei Tour-Audio gilt: ÜBERSCHREIBEN VERBOTEN — die
  // Auslieferung verspricht bei teilbaren Touren immutable-Cache-Header,
  // eine neue Version unter altem Namen würde stale ausgeliefert. —
  app.put<{ Params: { file: string } }>(
    '/api/audio-library/:file',
    { schema: { params: fileParamsSchema } },
    async (request, reply) => {
      const user = requireUser(request, reply)
      if (!user) return
      const relPath = `${LIBRARY_FOLDER}/${request.params.file}`
      if (await userStorage.info(user.id, relPath)) {
        return reply
          .code(409)
          .send({ error: 'Audio-Datei existiert bereits, anderen Namen wählen' })
      }
      const length = Number(request.headers['content-length'] ?? 0)
      if (Number.isFinite(length) && length > 0) {
        const quotaError = await checkQuota(
          db,
          storage,
          userStorage,
          user.id,
          config.maxStoragePerUser,
          length,
        )
        if (quotaError) return reply.code(413).send({ error: quotaError })
      }
      const info = await userStorage.writeStream(
        user.id,
        relPath,
        request.body as Readable,
        config.maxAudioBytes,
      )
      return reply.code(200).send({ file: request.params.file, bytes: info.size })
    },
  )

  // — Vorhören im Studio: die EIGENE Datei streamen (mit Range fürs
  // Scrubbing). Der Player nutzt stattdessen die tour-gebundene Route unten —
  // hier ist der Eigentümer selbst der einzige berechtigte Hörer, auch für
  // Dateien, die noch in keiner (gespeicherten) Tour stecken. —
  app.get<{ Params: { file: string } }>(
    '/api/audio-library/:file',
    { schema: { params: fileParamsSchema } },
    async (request, reply) => {
      const user = requireUser(request, reply)
      if (!user) return
      const relPath = `${LIBRARY_FOLDER}/${request.params.file}`
      const info = await userStorage.info(user.id, relPath)
      if (!info) return reply.code(404).send({ error: 'Audio-Datei nicht gefunden' })
      const extension = request.params.file.split('.').pop() ?? ''
      reply.header('content-type', AUDIO_CONTENT_TYPES[extension] ?? 'application/octet-stream')
      reply.header('x-content-type-options', 'nosniff')
      reply.header('accept-ranges', 'bytes')
      reply.header('cache-control', 'private, max-age=3600')
      const range = parseRange(request.headers.range, info.size)
      if (range === 'invalid') {
        return reply.code(416).header('content-range', `bytes */${info.size}`).send()
      }
      if (range) {
        reply.code(206)
        reply.header('content-range', `bytes ${range.start}-${range.end}/${info.size}`)
        reply.header('content-length', range.end - range.start + 1)
        return reply.send(userStorage.readStream(user.id, relPath, range))
      }
      reply.header('content-length', info.size)
      return reply.send(userStorage.readStream(user.id, relPath))
    },
  )

  // — Löschen: nur, wenn KEINE Tour die Datei mehr verwendet —
  app.delete<{ Params: { file: string } }>(
    '/api/audio-library/:file',
    { schema: { params: fileParamsSchema } },
    async (request, reply) => {
      const user = requireUser(request, reply)
      if (!user) return
      const relPath = `${LIBRARY_FOLDER}/${request.params.file}`
      if (!(await userStorage.info(user.id, relPath))) {
        return reply.code(404).send({ error: 'Audio-Datei nicht gefunden' })
      }
      const users = usersOf(await loadTourStates(user.id), request.params.file)
      if (users.length) {
        const titleOf = users.map((t) => `„${t.title}"`).join(', ')
        return reply.code(409).send({
          error: `Datei wird noch verwendet in ${titleOf}, dort erst den Eintrag entfernen`,
        })
      }
      await userStorage.remove(user.id, relPath)
      return { ok: true }
    },
  )

  // — Auslieferung im Tour-Kontext (der Player lädt diese URL aus tour.json).
  // Sichtbarkeit = die der Tour; zusätzlich muss die Tour die Datei WIRKLICH
  // referenzieren — sonst wäre die Route ein Orakel, mit dem jeder Betrachter
  // die restliche Bibliothek des Eigentümers abklopfen könnte. —
  app.get<{ Params: { id: string; file: string } }>(
    '/api/tours/:id/library-audio/:file',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id', 'file'],
          properties: {
            id: { type: 'string' },
            file: { type: 'string', pattern: AUDIO_FILE_PATTERN },
          },
        },
      },
    },
    async (request, reply) => {
      const tour = loadTour(app, request.params.id)
      if (!tour || !canView(tour, request.user?.id ?? null)) {
        return reply.code(404).send({ error: 'Nicht gefunden' })
      }
      const { file: file2 } = request.params
      let edits: EditOverlay | null = null
      if (await storage.info(tour.id, EDITS_PATH)) {
        edits = JSON.parse((await storage.read(tour.id, EDITS_PATH)).toString()) as EditOverlay
      }
      let tourAudio: Array<{ src?: string }> | null = null
      if (await storage.info(tour.id, TOUR_JSON_PATH)) {
        tourAudio =
          (
            JSON.parse((await storage.read(tour.id, TOUR_JSON_PATH)).toString()) as {
              audio?: Array<{ src?: string }>
            }
          ).audio ?? null
      }
      if (!referenced(edits, tourAudio, tour.id, file2)) {
        return reply.code(404).send({ error: 'Nicht gefunden' })
      }
      const relPath = `${LIBRARY_FOLDER}/${file2}`
      const info = await userStorage.info(tour.owner_id, relPath)
      if (!info) return reply.code(404).send({ error: 'Nicht gefunden' })

      const extension = file2.split('.').pop() ?? ''
      reply.header('content-type', AUDIO_CONTENT_TYPES[extension] ?? 'application/octet-stream')
      reply.header('x-content-type-options', 'nosniff')
      reply.header('accept-ranges', 'bytes')
      // Wie /api/media: `public` nur für per Link teilbare Touren — private
      // Dateien dürfen nie in geteilten Caches (Proxy/CDN) landen.
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
        return reply.send(userStorage.readStream(tour.owner_id, relPath, range))
      }
      reply.header('content-length', info.size)
      return reply.send(userStorage.readStream(tour.owner_id, relPath))
    },
  )
}
