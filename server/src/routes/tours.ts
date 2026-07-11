// Tour-Routen: Anlegen (Manifest), Finalisieren (startet Anreicherung),
// Metadaten ändern, Liste, Auslieferung des Tour-JSON, Löschen.
// Rohdaten liegen unter original/, das gerenderte Ergebnis als tour.json.

import type { FastifyInstance, FastifyReply } from 'fastify'
import { erfordereBenutzer } from '../app.js'
import { neueTourId } from '../ids.js'
import { reichereAn } from '../pipeline/enrich.js'
import {
  mediumDateiname,
  uploadManifestJsonSchema,
  type UploadManifest,
} from '../schema/upload.js'

export interface TourZeile {
  id: string
  owner_id: string
  no: number
  status: 'angelegt' | 'verarbeitung' | 'bereit' | 'fehler'
  visibility: 'private' | 'unlisted' | 'public'
  client_tour_id: string | null
  title: string | null
  description: string | null
  stats_json: string | null
  fehler: string | null
  created_at: string
  updated_at: string
}

export const MANIFEST_PFAD = 'original/manifest.json'
export const TOURJSON_PFAD = 'tour.json'

export function ladeTour(app: FastifyInstance, id: string): TourZeile | null {
  return (app.deps.db.prepare('SELECT * FROM tours WHERE id = ?').get(id) as TourZeile | undefined) ?? null
}

/** Sichtbarkeitsregel v1: private nur für Owner; unlisted/public für alle mit Link. */
export function darfSehen(tour: TourZeile, benutzerId: string | null): boolean {
  return tour.visibility !== 'private' || tour.owner_id === benutzerId
}

function tourOderFehler(app: FastifyInstance, id: string, benutzerId: string | null, reply: FastifyReply): TourZeile | null {
  const tour = ladeTour(app, id)
  if (!tour || !darfSehen(tour, benutzerId)) {
    reply.code(404).send({ fehler: 'Tour nicht gefunden' })
    return null
  }
  return tour
}

function nurOwner(app: FastifyInstance, id: string, benutzerId: string, reply: FastifyReply): TourZeile | null {
  const tour = ladeTour(app, id)
  if (!tour || tour.owner_id !== benutzerId) {
    // Fremde private Touren sind ununterscheidbar von nicht existierenden
    reply.code(404).send({ fehler: 'Tour nicht gefunden' })
    return null
  }
  return tour
}

export function registriereTourRouten(app: FastifyInstance): void {
  const { db, storage } = app.deps

  // — Anlegen: Manifest validieren + ablegen —
  app.post<{ Body: UploadManifest }>(
    '/api/tours',
    { schema: { body: uploadManifestJsonSchema } },
    async (request, reply) => {
      const benutzer = erfordereBenutzer(request, reply)
      if (!benutzer) return

      // Idempotenz: dieselbe App-Tour erneut angelegt → vorhandene ID zurück
      const clientId = request.body.clientTourId ?? null
      if (clientId) {
        const vorhanden = db
          .prepare('SELECT id FROM tours WHERE owner_id = ? AND client_tour_id = ?')
          .get(benutzer.id, clientId) as { id: string } | undefined
        if (vorhanden) return reply.code(200).send({ id: vorhanden.id, wiederverwendet: true })
      }

      // Medien-IDs müssen tour-eindeutig sein, Dateiendungen zulässig
      const ids = new Set<string>()
      for (const medium of request.body.media) {
        if (ids.has(medium.id)) return reply.code(400).send({ fehler: `Doppelte Medien-ID: ${medium.id}` })
        ids.add(medium.id)
        try {
          mediumDateiname(medium)
        } catch (fehler) {
          return reply.code(400).send({ fehler: (fehler as Error).message })
        }
      }

      // Zeit-Semantik prüfen (das JSON-Schema prüft nur die Form): parsebar,
      // start < end, gültige IANA-Zone — eine kaputte Zone würde sonst erst im
      // Player die Intl-Formatter werfen lassen.
      const { start, end, zone } = request.body.time
      if (!Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end)) || Date.parse(start) >= Date.parse(end)) {
        return reply.code(400).send({ fehler: 'Ungültige Zeitspanne (start/end)' })
      }
      try {
        new Intl.DateTimeFormat('de-DE', { timeZone: zone })
      } catch {
        return reply.code(400).send({ fehler: `Unbekannte Zeitzone: ${zone}` })
      }

      const id = neueTourId()
      const jetzt = new Date().toISOString()
      await storage.schreibe(id, MANIFEST_PFAD, JSON.stringify(request.body, null, 2))
      try {
        // Nummer PRO BENUTZER und im selben synchronen Statement vergeben —
        // better-sqlite3 ist synchron, damit ist die Vergabe race-frei.
        db.prepare(
          `INSERT INTO tours (id, owner_id, no, status, client_tour_id, title, description, created_at, updated_at)
           VALUES (?, ?, (SELECT COALESCE(MAX(no), 0) + 1 FROM tours WHERE owner_id = ?), 'angelegt', ?, ?, ?, ?, ?)`,
        ).run(id, benutzer.id, benutzer.id, clientId, request.body.title ?? null, request.body.description ?? null, jetzt, jetzt)
      } catch (fehler) {
        // Paralleler Doppel-POST mit gleicher clientTourId: der UNIQUE-Index
        // fängt ihn — idempotent die bereits angelegte Tour zurückgeben.
        if (clientId && String((fehler as Error).message).includes('UNIQUE')) {
          await storage.loescheTour(id)
          const vorhanden = db
            .prepare('SELECT id FROM tours WHERE owner_id = ? AND client_tour_id = ?')
            .get(benutzer.id, clientId) as { id: string } | undefined
          if (vorhanden) return reply.code(200).send({ id: vorhanden.id, wiederverwendet: true })
        }
        throw fehler
      }

      return reply.code(201).send({ id })
    },
  )

  // — Finalisieren: Vollständigkeit prüfen, Anreicherung asynchron starten —
  app.post<{ Params: { id: string } }>('/api/tours/:id/finalize', async (request, reply) => {
    const benutzer = erfordereBenutzer(request, reply)
    if (!benutzer) return
    const tour = nurOwner(app, request.params.id, benutzer.id, reply)
    if (!tour) return

    // Verarbeitung ATOMAR beanspruchen (synchrones UPDATE mit Status-Guard),
    // BEVOR irgendein await läuft — zwei parallele finalize-Requests würden
    // die Pipeline sonst doppelt starten.
    const claim = db
      .prepare(`UPDATE tours SET status = 'verarbeitung', updated_at = ? WHERE id = ? AND status != 'verarbeitung'`)
      .run(new Date().toISOString(), tour.id)
    if (claim.changes === 0) return reply.code(409).send({ fehler: 'Verarbeitung läuft bereits' })

    const manifest = JSON.parse((await storage.lese(tour.id, MANIFEST_PFAD)).toString()) as UploadManifest
    const fehlend: string[] = []
    for (const medium of manifest.media) {
      const info = await storage.info(tour.id, `media/${mediumDateiname(medium)}`)
      if (!info) fehlend.push(medium.id)
    }
    if (fehlend.length) {
      setzeStatus(app, tour.id, tour.status) // Claim zurückgeben
      return reply.code(409).send({ fehler: 'Medien fehlen', fehlend })
    }

    app.verarbeitungen.set(
      tour.id,
      verarbeite(app, tour.id).finally(() => app.verarbeitungen.delete(tour.id)),
    )
    return reply.code(202).send({ id: tour.id, status: 'verarbeitung' })
  })

  // — Metadaten ändern (Titel/Beschreibung/Sichtbarkeit) —
  app.patch<{ Params: { id: string }; Body: { title?: string; description?: string; visibility?: TourZeile['visibility'] } }>(
    '/api/tours/:id',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 200 },
            description: { type: 'string', maxLength: 5000 },
            visibility: { enum: ['private', 'unlisted', 'public'] },
          },
        },
      },
    },
    async (request, reply) => {
      const benutzer = erfordereBenutzer(request, reply)
      if (!benutzer) return
      const tour = nurOwner(app, request.params.id, benutzer.id, reply)
      if (!tour) return

      const { title, description, visibility } = request.body
      db.prepare(
        `UPDATE tours SET title = COALESCE(?, title), description = COALESCE(?, description),
         visibility = COALESCE(?, visibility), updated_at = ? WHERE id = ?`,
      ).run(title ?? null, description ?? null, visibility ?? null, new Date().toISOString(), tour.id)

      // Bereits gerenderte Tour: Texte im tour.json nachziehen — asynchron und
      // über denselben Status-Claim wie finalize (nie zwei Renderer parallel,
      // Antwort hängt nicht an Nominatim). Läuft gerade eine Verarbeitung,
      // ist nichts zu tun: sie liest die eben aktualisierte DB-Zeile.
      if (tour.status === 'bereit' && (title || description)) {
        const claim = db
          .prepare(`UPDATE tours SET status = 'verarbeitung', updated_at = ? WHERE id = ? AND status = 'bereit'`)
          .run(new Date().toISOString(), tour.id)
        if (claim.changes === 1) {
          app.verarbeitungen.set(
            tour.id,
            verarbeite(app, tour.id).finally(() => app.verarbeitungen.delete(tour.id)),
          )
        }
      }
      return { ok: true }
    },
  )

  // — Eigene Touren auflisten —
  // Ganz ohne Anmeldedaten: leere Liste statt 401 — der Player fragt hier bei
  // JEDEM Seitenaufruf für den Tour-Picker an, und Browser loggen jede
  // 401-Antwort als Konsole-Fehler. UNGÜLTIGE Anmeldedaten bleiben 401
  // (die App braucht das Signal, um den Login anzustoßen).
  app.get('/api/tours', async (request, reply) => {
    if (!request.benutzer && !request.headers.authorization && !request.cookies['luhambo_session']) {
      return { tours: [] }
    }
    const benutzer = erfordereBenutzer(request, reply)
    if (!benutzer) return
    const zeilen = db
      .prepare(
        `SELECT id, no, status, visibility, title, stats_json, fehler, created_at
         FROM tours WHERE owner_id = ? ORDER BY created_at DESC`,
      )
      .all(benutzer.id) as Array<Pick<TourZeile, 'id' | 'no' | 'status' | 'visibility' | 'title' | 'stats_json' | 'fehler' | 'created_at'>>
    return {
      tours: zeilen.map((z) => ({
        id: z.id,
        no: `N°${String(z.no).padStart(2, '0')}`,
        status: z.status,
        visibility: z.visibility,
        title: z.title,
        stats: z.stats_json ? (JSON.parse(z.stats_json) as unknown) : null,
        fehler: z.fehler,
        createdAt: z.created_at,
      })),
    }
  })

  // — Tour-JSON ausliefern —
  app.get<{ Params: { id: string } }>('/api/tours/:id', async (request, reply) => {
    const tour = tourOderFehler(app, request.params.id, request.benutzer?.id ?? null, reply)
    if (!tour) return
    if (tour.status !== 'bereit') {
      // Interne Fehlertexte (Pipeline-Exceptions) nur dem Owner zeigen —
      // jeder mit Link sieht nur den Status.
      const istOwner = request.benutzer?.id === tour.owner_id
      return reply.code(200).send({ id: tour.id, status: tour.status, ...(istOwner ? { fehler: tour.fehler } : {}) })
    }
    const tourJson = await storage.lese(tour.id, TOURJSON_PFAD)
    return reply.header('content-type', 'application/json; charset=utf-8').send(tourJson)
  })

  // — Löschen —
  app.delete<{ Params: { id: string } }>('/api/tours/:id', async (request, reply) => {
    const benutzer = erfordereBenutzer(request, reply)
    if (!benutzer) return
    const tour = nurOwner(app, request.params.id, benutzer.id, reply)
    if (!tour) return
    await storage.loescheTour(tour.id)
    db.prepare('DELETE FROM tours WHERE id = ?').run(tour.id)
    return { ok: true }
  })
}

function setzeStatus(app: FastifyInstance, id: string, status: TourZeile['status'], fehler?: string): void {
  app.deps.db
    .prepare('UPDATE tours SET status = ?, fehler = ?, updated_at = ? WHERE id = ?')
    .run(status, fehler ?? null, new Date().toISOString(), id)
}

/** Anreicherung ausführen und Ergebnis persistieren (läuft asynchron nach finalize). */
async function verarbeite(app: FastifyInstance, tourId: string): Promise<void> {
  const { db, storage, geocoder, wetter } = app.deps
  try {
    const tour = ladeTour(app, tourId)
    if (!tour) return
    const manifest = JSON.parse((await storage.lese(tourId, MANIFEST_PFAD)).toString()) as UploadManifest
    const tourJson = await reichereAn({
      tourId,
      nummer: tour.no,
      manifest,
      titelOverride: tour.title,
      beschreibungOverride: tour.description,
      geocoder,
      wetter,
      protokoll: (nachricht) => app.log.warn(nachricht),
    })
    await storage.schreibe(tourId, TOURJSON_PFAD, JSON.stringify(tourJson, null, 2))
    // title nur setzen, wenn noch keiner existiert (Auto-Benennung persistieren) —
    // ein während der Verarbeitung per PATCH gesetzter Nutzer-Titel darf nicht
    // rückwirkend überschrieben werden (Lost Update).
    db.prepare(
      'UPDATE tours SET status = ?, title = COALESCE(title, ?), stats_json = ?, fehler = NULL, updated_at = ? WHERE id = ?',
    ).run('bereit', tourJson.brandTitle, JSON.stringify(tourJson.stats), new Date().toISOString(), tourId)
  } catch (fehler) {
    app.log.error(fehler, `Anreicherung fehlgeschlagen: ${tourId}`)
    setzeStatus(app, tourId, 'fehler', (fehler as Error).message)
  }
}
