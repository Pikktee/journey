// Benutzerweite Audio-Bibliothek: eigene Musik und Effekte, EINMAL hochgeladen
// und in jeder Tour einsetzbar (quelle 'benutzer' im Edit-Overlay). Die Dateien
// liegen im benutzerStorage unter <userId>/audio/ — denselben Ordner räumt die
// Konto-Löschung (auth.ts) bereits komplett ab. Gelöscht werden kann eine Datei
// nur, solange KEINE Tour sie mehr verwendet; ausgeliefert wird sie über die
// Tour, damit deren Sichtbarkeit den Zugriff regelt (eine userId-Route würde
// private Dateien für jeden erratbar machen, der ein öffentliches Profil kennt).

import type { FastifyInstance } from 'fastify'
import type { Readable } from 'node:stream'
import { erfordereBenutzer } from '../app.js'
import { pruefeQuota } from '../quota.js'
import { AUDIO_DATEI_PATTERN, type EditOverlay } from '../schema/edits.js'
import { darfSehen, EDITS_PFAD, ladeTour, TOURJSON_PFAD } from './tours.js'
import { parseRange } from './media.js'

/** Unterordner der Bibliothek im benutzerStorage (neben dem flach liegenden Avatar). */
export const BIBLIOTHEK_ORDNER = 'audio'

const AUDIO_CONTENT_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
}

// Der Dateiname wird Teil des Ablagepfads — nur Basisname + Audio-Endung.
const dateiParamsSchema = {
  type: 'object',
  required: ['datei'],
  properties: { datei: { type: 'string', pattern: AUDIO_DATEI_PATTERN } },
} as const

/** Verweist dieser Overlay-/Tour-JSON-Stand auf die Bibliotheksdatei? */
function referenziert(edits: EditOverlay | null, tourJsonAudio: Array<{ src?: string }> | null, tourId: string, datei: string): boolean {
  if (edits?.audio?.some((a) => a.quelle === 'benutzer' && a.datei === datei)) return true
  // Auch das GERENDERTE tour.json zählt: zwischen „Eintrag entfernt und
  // gespeichert" und dem fertigen Re-Render zeigt der Player sonst auf eine 404.
  const src = `/api/tours/${tourId}/bibliothek-audio/${datei}`
  return tourJsonAudio?.some((a) => a.src === src) ?? false
}

export function registriereBibliotheksRouten(app: FastifyInstance): void {
  const { storage, benutzerStorage, konfig, db } = app.deps

  interface TourStand {
    id: string
    titel: string
    edits: EditOverlay | null
    tourAudio: Array<{ src?: string }> | null
  }

  /** Overlay + gerendertes Audio ALLER Touren des Benutzers einmal einlesen —
   *  die Liste prüft danach jede Datei gegen denselben Stand. */
  const ladeTourStaende = async (userId: string): Promise<TourStand[]> => {
    const touren = db
      .prepare('SELECT id, no, title FROM tours WHERE owner_id = ? ORDER BY created_at DESC')
      .all(userId) as Array<{ id: string; no: number; title: string | null }>
    return Promise.all(
      touren.map(async (tour) => {
        let edits: EditOverlay | null = null
        if (await storage.info(tour.id, EDITS_PFAD)) {
          edits = JSON.parse((await storage.lese(tour.id, EDITS_PFAD)).toString()) as EditOverlay
        }
        let tourAudio: Array<{ src?: string }> | null = null
        if (await storage.info(tour.id, TOURJSON_PFAD)) {
          tourAudio =
            (JSON.parse((await storage.lese(tour.id, TOURJSON_PFAD)).toString()) as { audio?: Array<{ src?: string }> })
              .audio ?? null
        }
        return { id: tour.id, titel: tour.title ?? `N°${String(tour.no).padStart(2, '0')}`, edits, tourAudio }
      }),
    )
  }

  const nutzerVon = (staende: TourStand[], datei: string): Array<{ id: string; titel: string }> =>
    staende.filter((s) => referenziert(s.edits, s.tourAudio, s.id, datei)).map(({ id, titel }) => ({ id, titel }))

  // — Liste: alle Dateien der Bibliothek + wo sie im Einsatz sind (die
  // Oberfläche graut den Löschen-Knopf verwendeter Dateien damit aus) —
  app.get('/api/audio-bibliothek', async (request, reply) => {
    const benutzer = erfordereBenutzer(request, reply)
    if (!benutzer) return
    const dateien = await benutzerStorage.listeDateien(benutzer.id, BIBLIOTHEK_ORDNER)
    const staende = dateien.length ? await ladeTourStaende(benutzer.id) : []
    return {
      dateien: dateien.map((d) => ({
        datei: d.name,
        groesse: d.groesse,
        verwendetVon: nutzerVon(staende, d.name),
      })),
    }
  })

  // — Upload. Wie bei Tour-Audio gilt: ÜBERSCHREIBEN VERBOTEN — die
  // Auslieferung verspricht bei teilbaren Touren immutable-Cache-Header,
  // eine neue Version unter altem Namen würde stale ausgeliefert. —
  app.put<{ Params: { datei: string } }>(
    '/api/audio-bibliothek/:datei',
    { schema: { params: dateiParamsSchema } },
    async (request, reply) => {
      const benutzer = erfordereBenutzer(request, reply)
      if (!benutzer) return
      const relPfad = `${BIBLIOTHEK_ORDNER}/${request.params.datei}`
      if (await benutzerStorage.info(benutzer.id, relPfad)) {
        return reply.code(409).send({ fehler: 'Audio-Datei existiert bereits, anderen Namen wählen' })
      }
      const laenge = Number(request.headers['content-length'] ?? 0)
      if (Number.isFinite(laenge) && laenge > 0) {
        const quotaFehler = await pruefeQuota(db, storage, benutzerStorage, benutzer.id, konfig.maxSpeicherProBenutzer, laenge)
        if (quotaFehler) return reply.code(413).send({ fehler: quotaFehler })
      }
      const info = await benutzerStorage.schreibeStream(benutzer.id, relPfad, request.body as Readable, konfig.maxAudioBytes)
      return reply.code(200).send({ datei: request.params.datei, bytes: info.groesse })
    },
  )

  // — Vorhören im Studio: die EIGENE Datei streamen (mit Range fürs
  // Scrubbing). Der Player nutzt stattdessen die tour-gebundene Route unten —
  // hier ist der Eigentümer selbst der einzige berechtigte Hörer, auch für
  // Dateien, die noch in keiner (gespeicherten) Tour stecken. —
  app.get<{ Params: { datei: string } }>(
    '/api/audio-bibliothek/:datei',
    { schema: { params: dateiParamsSchema } },
    async (request, reply) => {
      const benutzer = erfordereBenutzer(request, reply)
      if (!benutzer) return
      const relPfad = `${BIBLIOTHEK_ORDNER}/${request.params.datei}`
      const info = await benutzerStorage.info(benutzer.id, relPfad)
      if (!info) return reply.code(404).send({ fehler: 'Audio-Datei nicht gefunden' })
      const endung = request.params.datei.split('.').pop() ?? ''
      reply.header('content-type', AUDIO_CONTENT_TYPES[endung] ?? 'application/octet-stream')
      reply.header('x-content-type-options', 'nosniff')
      reply.header('accept-ranges', 'bytes')
      reply.header('cache-control', 'private, max-age=3600')
      const range = parseRange(request.headers.range, info.groesse)
      if (range === 'ungueltig') {
        return reply.code(416).header('content-range', `bytes */${info.groesse}`).send()
      }
      if (range) {
        reply.code(206)
        reply.header('content-range', `bytes ${range.start}-${range.ende}/${info.groesse}`)
        reply.header('content-length', range.ende - range.start + 1)
        return reply.send(benutzerStorage.leseStream(benutzer.id, relPfad, range))
      }
      reply.header('content-length', info.groesse)
      return reply.send(benutzerStorage.leseStream(benutzer.id, relPfad))
    },
  )

  // — Löschen: nur, wenn KEINE Tour die Datei mehr verwendet —
  app.delete<{ Params: { datei: string } }>(
    '/api/audio-bibliothek/:datei',
    { schema: { params: dateiParamsSchema } },
    async (request, reply) => {
      const benutzer = erfordereBenutzer(request, reply)
      if (!benutzer) return
      const relPfad = `${BIBLIOTHEK_ORDNER}/${request.params.datei}`
      if (!(await benutzerStorage.info(benutzer.id, relPfad))) {
        return reply.code(404).send({ fehler: 'Audio-Datei nicht gefunden' })
      }
      const nutzer = nutzerVon(await ladeTourStaende(benutzer.id), request.params.datei)
      if (nutzer.length) {
        const titel = nutzer.map((t) => `„${t.titel}"`).join(', ')
        return reply.code(409).send({ fehler: `Datei wird noch verwendet in ${titel}, dort erst den Eintrag entfernen` })
      }
      await benutzerStorage.loesche(benutzer.id, relPfad)
      return { ok: true }
    },
  )

  // — Auslieferung im Tour-Kontext (der Player lädt diese URL aus tour.json).
  // Sichtbarkeit = die der Tour; zusätzlich muss die Tour die Datei WIRKLICH
  // referenzieren — sonst wäre die Route ein Orakel, mit dem jeder Betrachter
  // die restliche Bibliothek des Eigentümers abklopfen könnte. —
  app.get<{ Params: { id: string; datei: string } }>(
    '/api/tours/:id/bibliothek-audio/:datei',
    { schema: { params: { type: 'object', required: ['id', 'datei'], properties: { id: { type: 'string' }, datei: { type: 'string', pattern: AUDIO_DATEI_PATTERN } } } } },
    async (request, reply) => {
      const tour = ladeTour(app, request.params.id)
      if (!tour || !darfSehen(tour, request.benutzer?.id ?? null)) {
        return reply.code(404).send({ fehler: 'Nicht gefunden' })
      }
      const { datei } = request.params
      let edits: EditOverlay | null = null
      if (await storage.info(tour.id, EDITS_PFAD)) {
        edits = JSON.parse((await storage.lese(tour.id, EDITS_PFAD)).toString()) as EditOverlay
      }
      let tourAudio: Array<{ src?: string }> | null = null
      if (await storage.info(tour.id, TOURJSON_PFAD)) {
        tourAudio =
          (JSON.parse((await storage.lese(tour.id, TOURJSON_PFAD)).toString()) as { audio?: Array<{ src?: string }> })
            .audio ?? null
      }
      if (!referenziert(edits, tourAudio, tour.id, datei)) {
        return reply.code(404).send({ fehler: 'Nicht gefunden' })
      }
      const relPfad = `${BIBLIOTHEK_ORDNER}/${datei}`
      const info = await benutzerStorage.info(tour.owner_id, relPfad)
      if (!info) return reply.code(404).send({ fehler: 'Nicht gefunden' })

      const endung = datei.split('.').pop() ?? ''
      reply.header('content-type', AUDIO_CONTENT_TYPES[endung] ?? 'application/octet-stream')
      reply.header('x-content-type-options', 'nosniff')
      reply.header('accept-ranges', 'bytes')
      // Wie /api/media: `public` nur für per Link teilbare Touren — private
      // Dateien dürfen nie in geteilten Caches (Proxy/CDN) landen.
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
        return reply.send(benutzerStorage.leseStream(tour.owner_id, relPfad, range))
      }
      reply.header('content-length', info.groesse)
      return reply.send(benutzerStorage.leseStream(tour.owner_id, relPfad))
    },
  )
}
