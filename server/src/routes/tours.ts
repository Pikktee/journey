// Tour-Routen: Anlegen (Manifest), Finalisieren (startet Anreicherung),
// Metadaten ändern, Liste, Auslieferung des Tour-JSON, Löschen.
// Rohdaten liegen unter original/, das gerenderte Ergebnis als tour.json.

import type { FastifyInstance, FastifyReply } from 'fastify'
import { erfordereBenutzer } from '../app.js'
import { neueTourId } from '../ids.js'
import {
  ANREICHERUNG_SCHEMA_ID,
  berechneRohAnreicherung,
  mapZuRecord,
  recordZuMap,
  trimSignatur,
  type AnreicherungsCache,
} from '../pipeline/anreicherung.js'
import { reichereAn } from '../pipeline/enrich.js'
import { vereinfacheSegment } from '../pipeline/geo.js'
import { baueSegmentAusGpx, parseGpx } from '../pipeline/gpx.js'
import { platziereMedien } from '../pipeline/placement.js'
import { bereiteVideosAuf, type VideoMeta } from '../pipeline/video.js'
import type { BildBefund } from '../pipeline/vision.js'
import {
  EDITS_SCHEMA_ID,
  editsJsonSchema,
  istAudioDatei,
  pruefeEditsSemantik,
  type EditOverlay,
} from '../schema/edits.js'
import {
  mediumDateiname,
  uploadManifestJsonSchema,
  type UploadManifest,
  type UploadSegment,
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
export const TRACK_PFAD = 'original/track.gpx'
export const TOURJSON_PFAD = 'tour.json'
/** Edit-Overlay (M7) — liegt NEBEN original/, die Rohdaten bleiben unantastbar */
export const EDITS_PFAD = 'edits.json'
/** Anreicherungs-Cache: teure extern beschaffte Ergebnisse (Bildanalyse, Wetter,
 *  Geocoding, Video) — beim Finalize/Reprocess erzeugt, von Edit-Saves genutzt */
export const ANREICHERUNG_PFAD = 'anreicherung.json'

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

      // M9: Hochladen erst nach E-Mail-Bestätigung — bremst Wegwerf-Accounts und
      // die daran hängenden Speicher-/Vision-Kosten.
      if (!app.auth.istVerifiziert(benutzer.id)) {
        return reply.code(403).send({ fehler: 'Bitte bestätige zuerst deine E-Mail-Adresse' })
      }

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
    // Bei GPX-Quelle muss die Track-Datei da sein, bevor die Pipeline sie parst
    if (manifest.trackFile && !(await storage.info(tour.id, TRACK_PFAD))) {
      setzeStatus(app, tour.id, tour.status) // Claim zurückgeben
      return reply.code(409).send({ fehler: 'Track (GPX) fehlt', fehlend: ['track.gpx'] })
    }
    const fehlend: string[] = []
    for (const medium of manifest.media) {
      const info = await storage.info(tour.id, `media/${mediumDateiname(medium)}`)
      if (!info) fehlend.push(medium.id)
    }
    if (fehlend.length) {
      setzeStatus(app, tour.id, tour.status) // Claim zurückgeben
      return reply.code(409).send({ fehler: 'Medien fehlen', fehlend })
    }

    // Erst-Render: alle externen Schritte laufen und füllen den Anreicherungs-Cache.
    app.verarbeitungen.set(
      tour.id,
      verarbeite(app, tour.id, { frisch: true }).finally(() => app.verarbeitungen.delete(tour.id)),
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
      // ACHTUNG: gegen undefined prüfen, nicht truthy — description '' ist
      // ein legitimes Leeren und muss genauso neu rendern (Review-Fund M7).
      if (tour.status === 'bereit' && (title !== undefined || description !== undefined)) {
        const claim = db
          .prepare(`UPDATE tours SET status = 'verarbeitung', updated_at = ? WHERE id = ? AND status = 'bereit'`)
          .run(new Date().toISOString(), tour.id)
        if (claim.changes === 1) {
          // Nur Texte nachziehen — Anreicherung aus dem Cache (kein Netz).
          app.verarbeitungen.set(
            tour.id,
            verarbeite(app, tour.id, { frisch: false }).finally(() => app.verarbeitungen.delete(tour.id)),
          )
        }
      }
      return { ok: true }
    },
  )

  // — Edit-Overlay lesen (M7) — Owner-only, wie alles Bearbeitende —
  app.get<{ Params: { id: string } }>('/api/tours/:id/edits', async (request, reply) => {
    const benutzer = erfordereBenutzer(request, reply)
    if (!benutzer) return
    const tour = nurOwner(app, request.params.id, benutzer.id, reply)
    if (!tour) return
    if (!(await storage.info(tour.id, EDITS_PFAD))) return { schema: EDITS_SCHEMA_ID }
    return reply
      .header('content-type', 'application/json; charset=utf-8')
      .send(await storage.lese(tour.id, EDITS_PFAD))
  })

  // — Edit-Overlay speichern (M7): ablegen + gerenderte Tour neu rendern —
  app.put<{ Params: { id: string }; Body: EditOverlay }>(
    '/api/tours/:id/edits',
    { schema: { body: editsJsonSchema } },
    async (request, reply) => {
      const benutzer = erfordereBenutzer(request, reply)
      if (!benutzer) return
      const tour = nurOwner(app, request.params.id, benutzer.id, reply)
      if (!tour) return
      const fehler = pruefeEditsSemantik(request.body)
      if (fehler) return reply.code(400).send({ fehler })
      // Während laufender Verarbeitung nicht speichern: sie hätte das Overlay
      // ggf. schon gelesen — das Ergebnis wäre undefiniert. Restrisiko: startet
      // zwischen dieser Prüfung und dem Schreiben ein anderer Handler (finalize)
      // den Renderer, kann tour.json einen Render hinter edits.json liegen —
      // selbstheilend beim nächsten Render/Reprocess, kein Doppel-Renderer.
      if (tour.status === 'verarbeitung') {
        return reply.code(409).send({ fehler: 'Verarbeitung läuft — bitte gleich erneut speichern' })
      }
      await storage.schreibe(tour.id, EDITS_PFAD, JSON.stringify(request.body, null, 2))
      // Fertige (oder gescheiterte) Tour direkt neu rendern — gleicher
      // Status-Claim wie finalize, nie zwei Renderer parallel.
      if (starteVerarbeitung(app, tour.id)) return reply.code(202).send({ ok: true, status: 'verarbeitung' })
      // angelegt: das Overlay fließt beim Finalize ein
      return { ok: true, status: ladeTour(app, tour.id)?.status ?? tour.status }
    },
  )

  // — Neu verarbeiten (M7): Anreicherung (Benennung/Wetter) neu, Edits bleiben —
  app.post<{ Params: { id: string } }>('/api/tours/:id/reprocess', async (request, reply) => {
    const benutzer = erfordereBenutzer(request, reply)
    if (!benutzer) return
    const tour = nurOwner(app, request.params.id, benutzer.id, reply)
    if (!tour) return
    if (tour.status === 'angelegt') return reply.code(409).send({ fehler: 'Tour ist noch nicht finalisiert' })
    // „Neu verarbeiten" holt die Anreicherung bewusst frisch (verwirft den Cache).
    if (!starteVerarbeitung(app, tour.id, true)) return reply.code(409).send({ fehler: 'Verarbeitung läuft bereits' })
    return reply.code(202).send({ id: tour.id, status: 'verarbeitung' })
  })

  // — Editor-Daten (M7): Original-Track MIT Zeiten + Auto-Platzierung + Overlay —
  // Bewusst getrennt vom Player-JSON: der Editor braucht die Zeit je Trackpunkt
  // (Trim/Modus-Grenzen referenzieren Zeitstempel) und auch gelöschte/
  // unplatzierte Medien; das tour.json zeigt dagegen den ANGEWANDTEN Stand.
  app.get<{ Params: { id: string } }>('/api/tours/:id/editor', async (request, reply) => {
    const benutzer = erfordereBenutzer(request, reply)
    if (!benutzer) return
    const tour = nurOwner(app, request.params.id, benutzer.id, reply)
    if (!tour) return
    const manifest = JSON.parse((await storage.lese(tour.id, MANIFEST_PFAD)).toString()) as UploadManifest
    if (manifest.trackFile && !(await storage.info(tour.id, TRACK_PFAD))) {
      return reply.code(409).send({ fehler: 'Track (GPX) fehlt noch' })
    }
    // Kaputtes GPX als 409 mit Ursache melden — gerade fehler-Touren sollen
    // im Editor sehen, WORAN es liegt, nicht „Interner Fehler" (Review-Fund).
    let segmente: UploadSegment[]
    try {
      segmente = await ladeOriginalSegmente(app, tour.id, manifest)
    } catch (fehler) {
      return reply.code(409).send({ fehler: `Track nicht lesbar: ${(fehler as Error).message}` })
    }
    if (!segmente.some((s) => s.pts.length >= 2)) return reply.code(409).send({ fehler: 'Tour hat keinen Track' })
    const startMs = Date.parse(manifest.time.start)

    // Auto-Platzierung auf dem ORIGINAL-Track (ohne Overlay): die Basis, auf
    // die der Editor seine Overrides live legt. Gelöschte bleiben sichtbar.
    const platziert = platziereMedien(manifest.media, segmente.flatMap((s) => s.pts), startMs)
    const medien: Array<Record<string, unknown>> = []
    for (const { medium, anchor, placement } of platziert) {
      const eintrag: Record<string, unknown> = {
        id: medium.id,
        type: medium.type,
        src: `/api/media/${tour.id}/${mediumDateiname(medium)}`,
        takenAt: medium.takenAt,
        caption: medium.caption ?? '',
        anchor,
        placement,
        // Roher GPS-Anker aus dem Manifest (nur wenn vorhanden): der Editor
        // bietet damit „GPS-Ort verwenden" an, wenn die Auto-Platzierung auf
        // zeit zurückfiel oder ein manueller Anker zurückgenommen werden soll.
        ...(medium.anchor ? { gpsAnker: medium.anchor } : {}),
      }
      if (medium.type === 'video') {
        const poster = `${medium.id}.poster.jpg`
        if (await storage.info(tour.id, `media/${poster}`)) eintrag['poster'] = `/api/media/${tour.id}/${poster}`
      }
      medien.push(eintrag)
    }
    medien.sort((a, b) => (Date.parse(a['takenAt'] as string) || 0) - (Date.parse(b['takenAt'] as string) || 0))

    let edits: EditOverlay = { schema: EDITS_SCHEMA_ID }
    if (await storage.info(tour.id, EDITS_PFAD)) {
      edits = JSON.parse((await storage.lese(tour.id, EDITS_PFAD)).toString()) as EditOverlay
    }

    // Vorhandene Audio-Assets (Baukasten): media/ enthält auch Fotos/Videos/
    // Poster — der Dateinamen-Filter lässt nur echte Audio-Dateien durch.
    const audio = (await storage.listeDateien(tour.id, 'media'))
      .filter((d) => istAudioDatei(d.name))
      .map((d) => ({ datei: d.name, groesse: d.groesse }))

    return {
      id: tour.id,
      status: tour.status,
      title: tour.title,
      description: tour.description,
      time: manifest.time,
      // Original-Segmente, fürs Netz vereinfacht — behält [lng,lat,ele,tOffsetS]
      segmente: segmente.map((s) => ({ mode: s.mode, pts: vereinfacheSegment(s.pts) })),
      medien,
      audio,
      edits,
    }
  })

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

/** MIME-Typ eines Foto-Ablagenamens für die Bildanalyse (M5); Default JPEG. */
function bildMedientyp(datei: string): string {
  const endung = datei.toLowerCase().split('.').pop()
  if (endung === 'png') return 'image/png'
  if (endung === 'webp') return 'image/webp'
  return 'image/jpeg'
}

/**
 * Verarbeitung atomar beanspruchen (nur aus bereit/fehler heraus) und starten.
 * false = eine andere Verarbeitung läuft bereits oder die Tour ist angelegt.
 */
function starteVerarbeitung(app: FastifyInstance, tourId: string, frisch = false): boolean {
  const claim = app.deps.db
    .prepare(`UPDATE tours SET status = 'verarbeitung', updated_at = ? WHERE id = ? AND status IN ('bereit', 'fehler')`)
    .run(new Date().toISOString(), tourId)
  if (claim.changes === 0) return false
  app.verarbeitungen.set(
    tourId,
    verarbeite(app, tourId, { frisch }).finally(() => app.verarbeitungen.delete(tourId)),
  )
  return true
}

/** Original-Segmente des Manifests — bei GPX-Quelle (M6) serverseitig geparst. */
async function ladeOriginalSegmente(
  app: FastifyInstance,
  tourId: string,
  manifest: UploadManifest,
): Promise<UploadSegment[]> {
  if (!manifest.trackFile) return manifest.segments ?? []
  const gpxText = (await app.deps.storage.lese(tourId, TRACK_PFAD)).toString()
  const { segment } = baueSegmentAusGpx(parseGpx(gpxText), {
    startMs: Date.parse(manifest.time.start),
    endMs: Date.parse(manifest.time.end),
    ...(manifest.trackMode ? { modus: manifest.trackMode } : {}),
  })
  return [segment]
}

/**
 * Anreicherung ausführen und Ergebnis persistieren (läuft asynchron nach
 * finalize/edits/patch/reprocess). `frisch` (finalize/reprocess) erzwingt die
 * teuren externen Schritte (Bildanalyse, Reverse-Geocoding, Wetter, Video) und
 * erneuert den Anreicherungs-Cache; ohne `frisch` (edits/patch) werden sie —
 * soweit gültig — aus dem Cache übernommen, sodass nur das Overlay lokal
 * angewandt wird (Sekundenbruchteil statt zig Sekunden).
 */
async function verarbeite(app: FastifyInstance, tourId: string, opts: { frisch?: boolean } = {}): Promise<void> {
  const { frisch = false } = opts
  const { db, storage, geocoder, wetter, videoWerkzeug, bildKlassifikator } = app.deps
  const protokoll = (nachricht: string): void => app.log.warn(nachricht)
  try {
    const tour = ladeTour(app, tourId)
    if (!tour) return
    let manifest = JSON.parse((await storage.lese(tourId, MANIFEST_PFAD)).toString()) as UploadManifest

    // GPX-Quelle (M6): das hochgeladene trackFile serverseitig zu einem Segment
    // parsen und ins Manifest einsetzen — ab hier ist die Pipeline quellenblind.
    manifest = { ...manifest, segments: await ladeOriginalSegmente(app, tourId, manifest) }

    // Edit-Overlay (M7): Trim, Modus-Grenzen und Medien-Overrides fließen als
    // eigene Pipeline-Eingabe ein — die Rohdaten unter original/ bleiben unberührt.
    let edits: EditOverlay | null = null
    if (await storage.info(tourId, EDITS_PFAD)) {
      edits = JSON.parse((await storage.lese(tourId, EDITS_PFAD)).toString()) as EditOverlay
    }

    // Anreicherungs-Cache: die teuren extern beschafften Ergebnisse. `frisch`
    // ignoriert ihn und erneuert alles; sonst wird — soweit gültig — daraus
    // übernommen. Beschädigter/alter Cache (Schema-Mismatch) zählt wie keiner →
    // dann wird unten alles frisch berechnet (selbstheilend, kein Migrationslauf).
    const sig = trimSignatur(edits)
    let cache: AnreicherungsCache | null = null
    if (!frisch && (await storage.info(tourId, ANREICHERUNG_PFAD))) {
      try {
        const geladen = JSON.parse((await storage.lese(tourId, ANREICHERUNG_PFAD)).toString()) as AnreicherungsCache
        if (geladen?.schema === ANREICHERUNG_SCHEMA_ID) cache = geladen
      } catch {
        cache = null
      }
    }

    // (1) Video-Meta + Bildbefunde hängen NUR an den Rohfotos/-videos → aus dem
    //     Cache übernehmen; nur ohne Cache neu berechnen. Das erspart dem
    //     Edit-Speichern ffprobe/Transcode UND die teure, sequenzielle
    //     Foto-Bildanalyse (1 Vision-Call je Foto) — der Löwenanteil der Zeit.
    let videoMeta: Map<string, VideoMeta>
    let bildBefunde: Map<string, BildBefund>
    if (cache) {
      videoMeta = recordZuMap(cache.videoMeta)
      bildBefunde = recordZuMap(cache.befunde)
    } else {
      videoMeta = new Map<string, VideoMeta>()
      const videoMedien = manifest.media.filter((m) => m.type === 'video')
      if (videoWerkzeug && videoMedien.length) {
        videoMeta = await bereiteVideosAuf({
          medien: videoMedien.map((m) => ({ id: m.id, originalDatei: mediumDateiname(m) })),
          speicher: {
            lese: (relPfad) => storage.lese(tourId, relPfad),
            schreibe: (relPfad, inhalt) => storage.schreibe(tourId, relPfad, inhalt),
            info: (relPfad) => storage.info(tourId, relPfad),
          },
          werkzeug: videoWerkzeug,
          protokoll,
        })
      }
      // Bildanalyse (M5): nur mit konfiguriertem Klassifikator (OpenRouter-Key).
      // Ein einzelnes scheiterndes Bild darf die Anreicherung nie kippen. Welche
      // Fotos tatsächlich verwertet werden (platziert), entscheidet reichereAn.
      bildBefunde = new Map<string, BildBefund>()
      if (bildKlassifikator) {
        for (const m of manifest.media.filter((x) => x.type === 'photo')) {
          try {
            const datei = mediumDateiname(m)
            if (!(await storage.info(tourId, `media/${datei}`))) continue
            const daten = await storage.lese(tourId, `media/${datei}`)
            bildBefunde.set(m.id, await bildKlassifikator.klassifiziere({ daten, medientyp: bildMedientyp(datei) }))
          } catch (fehler) {
            app.log.warn(`Bildanalyse fehlgeschlagen (${m.id}): ${(fehler as Error).message}`)
          }
        }
      }
    }

    // (2) Ortsnamen + Roh-Wetter hängen am (getrimmten) Track → aus dem Cache nur
    //     bei passender Trim-Signatur; sonst neu holen. Das sind die einzigen
    //     externen Aufrufe, die ein Edit (nämlich ein Trim) noch auslösen kann.
    let orte: AnreicherungsCache['orte']
    let wetterRoh: AnreicherungsCache['wetterRoh']
    if (cache && cache.trimSignatur === sig) {
      orte = cache.orte
      wetterRoh = cache.wetterRoh
    } else {
      ;({ orte, wetterRoh } = await berechneRohAnreicherung({ manifest, edits, geocoder, wetter, protokoll }))
    }

    // Vorhandene Audio-Dateien an die Pipeline reichen (Baukasten) —
    // edits.audio-Einträge ohne Datei überspringt sie dort mit Warnung.
    const audioDateien = (await storage.listeDateien(tourId, 'media')).map((d) => d.name).filter(istAudioDatei)

    // Render ist jetzt rein lokal: alle externen Ergebnisse liegen als Eingabe vor.
    const tourJson = await reichereAn({
      tourId,
      nummer: tour.no,
      manifest,
      titelOverride: tour.title,
      beschreibungOverride: tour.description,
      ...(edits ? { edits } : {}),
      audioDateien,
      orte,
      wetterRoh,
      ...(videoMeta.size ? { videoMeta } : {}),
      ...(bildBefunde.size ? { bildBefunde } : {}),
      protokoll,
    })
    await storage.schreibe(tourId, TOURJSON_PFAD, JSON.stringify(tourJson, null, 2))

    // Anreicherungs-Cache zurückschreiben — das nächste Edit-Speichern nutzt ihn.
    const neuerCache: AnreicherungsCache = {
      schema: ANREICHERUNG_SCHEMA_ID,
      befunde: mapZuRecord(bildBefunde),
      videoMeta: mapZuRecord(videoMeta),
      trimSignatur: sig,
      orte,
      wetterRoh,
    }
    await storage.schreibe(tourId, ANREICHERUNG_PFAD, JSON.stringify(neuerCache, null, 2))
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
