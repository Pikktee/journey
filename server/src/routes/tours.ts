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
  videoSchnittSignatur,
  type AnreicherungsCache,
} from '../pipeline/anreicherung.js'
import {
  anzeigeDateiname,
  bereiteFotosAuf,
  thumbDateiname,
  type FotoEingabe,
  type FotoMeta,
} from '../pipeline/bild.js'
import { bestimmeCover, reichereAn } from '../pipeline/enrich.js'
import { vereinfacheSegment } from '../pipeline/geo.js'
import { baueSegmentAusGpx, parseGpx } from '../pipeline/gpx.js'
import { hebeSchienenAbschnitte, umgebungsBox } from '../pipeline/schienen.js'
import { istAufzeichnung, trenneGehabschnitteInSegmenten } from '../pipeline/tempo.js'
import { waehleMusik } from '../pipeline/musikwahl.js'
import { platziereMedien } from '../pipeline/placement.js'
import { bereiteVideosAuf, webVideoDateiname, type VideoMeta } from '../pipeline/video.js'
import type { BildBefund } from '../pipeline/vision.js'
import { wendeTrimAn } from '../pipeline/edits.js'
import { baueZeitreihe, kollabierePausen } from '../pipeline/zeit.js'
import { wetterZuGrenzen, type WetterKeyframe } from '../pipeline/weather.js'
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
  type UploadMedium,
  type UploadSegment,
} from '../schema/upload.js'
import type { Storage } from '../storage.js'

export interface TourZeile {
  id: string
  owner_id: string
  no: number
  status: 'created' | 'processing' | 'ready' | 'failed'
  visibility: 'private' | 'unlisted' | 'public'
  client_tour_id: string | null
  title: string | null
  description: string | null
  /**
   * Die Dachzeile über dem Titel. NULL = nie gesetzt (die Benennung nimmt ihre
   * Vorbelegung), '' = ausdrücklich keine Zeile.
   */
  kicker: string | null
  /** 0/1: Endscreen „Ziel erreicht" zeigen (Default 0) */
  finale: number
  /** Zielname für den Endscreen; null/leer = geocodierter Ortsname am Ende */
  finale_target: string | null
  stats_json: string | null
  /** Titelbild-Pfad (wie media[].src); beim Rendern gesetzt, NULL vor dem ersten Render */
  cover: string | null
  /** Kachel-Fassung des Titelbilds; NULL ohne aufbereitete Fassungen */
  cover_thumb: string | null
  error: string | null
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

/**
 * Gleichzeitige Bildanalyse-Aufrufe.
 *
 * Der Aufruf ist reine Wartezeit auf einen fremden Dienst (~1,5–2,6 s je Foto).
 * Die Zahl ist gemessen, nicht geraten — 30 Fotos, ganze Verarbeitung: 66 s bei
 * 1, 25 s bei 5, **11 s bei 10**. Darüber kippt es (20 Testaufrufe bei 15
 * gleichzeitig waren langsamer als bei 10, die Einzel-Latenz stieg von 1,2 auf
 * 2,2 s) — der Anbieter drosselt dann, und mehr offene Verbindungen bringen
 * nichts mehr. Deshalb hier ein Deckel und kein `Promise.all` über alles: eine
 * Tour mit 60 Fotos soll den Prozess nicht mit 60 Verbindungen zustellen.
 *
 * Vorsicht beim Erhöhen: Ein abgelehnter Aufruf (429) endet im Klassifikator
 * als neutraler Befund — die Tour wird dann still ohne Foto-Verfeinerung fertig.
 */
const BILDANALYSE_PARALLEL = 10

export function ladeTour(app: FastifyInstance, id: string): TourZeile | null {
  return (
    (app.deps.db.prepare('SELECT * FROM tours WHERE id = ?').get(id) as TourZeile | undefined) ??
    null
  )
}

/**
 * Dateien, an denen ein Medium als „vorhanden" gilt: das Original ODER eine
 * daraus abgeleitete Fassung — nach dem ersten Render ist das Original
 * verworfen (bild.ts/video.ts), die Fassung ist dann die einzige Datei.
 */
export function mediumDateiKandidaten(medium: UploadMedium): string[] {
  return medium.type === 'photo'
    ? [mediumDateiname(medium), anzeigeDateiname(medium.id)]
    : [mediumDateiname(medium), webVideoDateiname(medium.id)]
}

export async function mediumVorhanden(
  storage: Storage,
  tourId: string,
  medium: UploadMedium,
): Promise<boolean> {
  for (const datei of mediumDateiKandidaten(medium)) {
    if (await storage.info(tourId, `media/${datei}`)) return true
  }
  return false
}

/**
 * Die Medien, mit denen Pipeline und Editor rechnen: ohne Tombstones
 * (endgültig gelöscht) und ohne Einträge, deren Datei nie ankam (nachgereicht
 * angekündigt, aber kein PUT). Beides sind legitime Manifest-Zustände, seit
 * das Manifest append-only wächst — ein Eintrag ohne Datei darf einen Render
 * nie scheitern lassen und nie eine 404-Quelle ins tour.json schreiben.
 */
export async function verfuegbareMedien(
  storage: Storage,
  tourId: string,
  medien: readonly UploadMedium[],
): Promise<UploadMedium[]> {
  const verfuegbar: UploadMedium[] = []
  for (const medium of medien) {
    if (medium.entfernt) continue
    if (await mediumVorhanden(storage, tourId, medium)) verfuegbar.push(medium)
  }
  return verfuegbar
}

/** Sichtbarkeitsregel v1: private nur für Owner; unlisted/public für alle mit Link. */
export function darfSehen(tour: TourZeile, benutzerId: string | null): boolean {
  return tour.visibility !== 'private' || tour.owner_id === benutzerId
}

function tourOderFehler(
  app: FastifyInstance,
  id: string,
  benutzerId: string | null,
  reply: FastifyReply,
): TourZeile | null {
  const tour = ladeTour(app, id)
  if (!tour || !darfSehen(tour, benutzerId)) {
    reply.code(404).send({ error: 'Tour nicht gefunden' })
    return null
  }
  return tour
}

function nurOwner(
  app: FastifyInstance,
  id: string,
  benutzerId: string,
  reply: FastifyReply,
): TourZeile | null {
  const tour = ladeTour(app, id)
  if (!tour || tour.owner_id !== benutzerId) {
    // Fremde private Touren sind ununterscheidbar von nicht existierenden
    reply.code(404).send({ error: 'Tour nicht gefunden' })
    return null
  }
  return tour
}

/**
 * Eine Tour aus einem Manifest anlegen — die eine Stelle, egal ob das Manifest
 * aus App, Studio oder von einem Cloud-Import kommt.
 *
 * Als Funktion und nicht nur als Route, weil der TourAnleger der
 * Tracker-Integration genau dies tun muss: Ein zweiter, eigener Anlege-Pfad
 * für „Cloud-Touren" wäre der Anfang von zwei Sorten Tour — und die Regeln
 * darin (Verifikation, Idempotenz über `client_tour_id`, Medien-IDs,
 * Zeit-Semantik, `private` als Vorgabe) müssten dann doppelt gepflegt werden.
 */
export async function legeTourAn(
  app: FastifyInstance,
  benutzerId: string,
  manifest: UploadManifest,
): Promise<
  | { ok: true; id: string; reused: boolean }
  | { ok: false; code: 400 | 403; error: string }
> {
  const { db, storage } = app.deps

  // M9: Hochladen erst nach E-Mail-Bestätigung — bremst Wegwerf-Accounts und
  // die daran hängenden Speicher-/Vision-Kosten. Gilt für den Cloud-Import
  // genauso: Er IST ein Upload, nur ohne Handgriff.
  if (!app.auth.istVerifiziert(benutzerId)) {
    return { ok: false, code: 403, error: 'Bitte bestätige zuerst deine E-Mail-Adresse' }
  }

  // Idempotenz: dieselbe App-Tour erneut angelegt → vorhandene ID zurück.
  // Eine Cloud-Tour setzt hier `polar:1234567` ein und bekommt damit die
  // vorhandene Dedup-Sperre gegen wiederholte Webhook-Zustellungen geschenkt.
  const clientId = manifest.clientTourId ?? null
  if (clientId) {
    const vorhanden = db
      .prepare('SELECT id FROM tours WHERE owner_id = ? AND client_tour_id = ?')
      .get(benutzerId, clientId) as { id: string } | undefined
    if (vorhanden) return { ok: true, id: vorhanden.id, reused: true }
  }

  // Medien-IDs müssen tour-eindeutig sein, Dateiendungen zulässig
  const ids = new Set<string>()
  for (const medium of manifest.media) {
    if (ids.has(medium.id))
      return { ok: false, code: 400, error: `Doppelte Medien-ID: ${medium.id}` }
    ids.add(medium.id)
    try {
      mediumDateiname(medium)
    } catch (fehler) {
      return { ok: false, code: 400, error: (fehler as Error).message }
    }
  }

  // Zeit-Semantik prüfen (das JSON-Schema prüft nur die Form): parsebar,
  // start < end, gültige IANA-Zone — eine kaputte Zone würde sonst erst im
  // Player die Intl-Formatter werfen lassen.
  const { start, end, zone } = manifest.time
  if (
    !Number.isFinite(Date.parse(start)) ||
    !Number.isFinite(Date.parse(end)) ||
    Date.parse(start) >= Date.parse(end)
  ) {
    return { ok: false, code: 400, error: 'Ungültige Zeitspanne (start/end)' }
  }
  try {
    new Intl.DateTimeFormat('de-DE', { timeZone: zone })
  } catch {
    return { ok: false, code: 400, error: `Unbekannte Zeitzone: ${zone}` }
  }

  const id = neueTourId()
  const jetzt = new Date().toISOString()
  await storage.schreibe(id, MANIFEST_PFAD, JSON.stringify(manifest, null, 2))
  try {
    // Nummer PRO BENUTZER und im selben synchronen Statement vergeben —
    // better-sqlite3 ist synchron, damit ist die Vergabe race-frei.
    // visibility ausdrücklich auf 'private': Eine frisch hochgeladene Tour
    // gehört erst einmal niemandem außer ihrem Urheber — geteilt wird
    // bewusst, nicht als Nebenwirkung des Hochladens. Der Tabellen-Default
    // bleibt 'unlisted', damit bestehende Touren (und die Links, die
    // jemand verschickt hat) unangetastet bleiben.
    db.prepare(
      `INSERT INTO tours (id, owner_id, no, status, visibility, client_tour_id, title, description, created_at, updated_at)
       VALUES (?, ?, (SELECT COALESCE(MAX(no), 0) + 1 FROM tours WHERE owner_id = ?), 'created', 'private', ?, ?, ?, ?, ?)`,
    ).run(
      id,
      benutzerId,
      benutzerId,
      clientId,
      manifest.title ?? null,
      manifest.description ?? null,
      jetzt,
      jetzt,
    )
  } catch (fehler) {
    // Paralleler Doppel-POST mit gleicher clientTourId: der UNIQUE-Index
    // fängt ihn — idempotent die bereits angelegte Tour zurückgeben.
    if (clientId && String((fehler as Error).message).includes('UNIQUE')) {
      await storage.loescheTour(id)
      const vorhanden = db
        .prepare('SELECT id FROM tours WHERE owner_id = ? AND client_tour_id = ?')
        .get(benutzerId, clientId) as { id: string } | undefined
      if (vorhanden) return { ok: true, id: vorhanden.id, reused: true }
    }
    throw fehler
  }

  return { ok: true, id, reused: false }
}

/**
 * Vollständigkeit prüfen und die Anreicherung anstoßen — der Kern von
 * `POST /api/tours/:id/finalize`, ebenfalls für den TourAnleger geteilt.
 *
 * Der Status-Claim läuft ATOMAR und VOR jedem await: Zwei parallele Aufrufe
 * würden die Pipeline sonst doppelt starten.
 */
export async function finalisiereTour(
  app: FastifyInstance,
  tour: TourZeile,
): Promise<{ ok: true } | { ok: false; code: 409; error: string; missing?: string[] }> {
  const { db, storage } = app.deps
  const claim = db
    .prepare(
      `UPDATE tours SET status = 'processing', updated_at = ? WHERE id = ? AND status != 'processing'`,
    )
    .run(new Date().toISOString(), tour.id)
  if (claim.changes === 0) return { ok: false, code: 409, error: 'Verarbeitung läuft bereits' }

  const manifest = JSON.parse(
    (await storage.lese(tour.id, MANIFEST_PFAD)).toString(),
  ) as UploadManifest
  // Bei GPX-Quelle muss die Track-Datei da sein, bevor die Pipeline sie parst
  if (manifest.trackFile && !(await storage.info(tour.id, TRACK_PFAD))) {
    setzeStatus(app, tour.id, tour.status) // Claim zurückgeben
    return { ok: false, code: 409, error: 'Track (GPX) fehlt', missing: ['track.gpx'] }
  }
  // Ein Medium gilt als da, wenn das Original ODER eine daraus abgeleitete
  // Fassung liegt (mediumVorhanden): Nach dem ersten Render ist das Original
  // verworfen, und ein wiederholtes finalize (der App-Upload versucht es bei
  // jedem Retry) darf deshalb nicht „Medien fehlen" melden. Tombstones werden
  // übersprungen — ein endgültig gelöschtes Medium KANN nicht mehr ankommen,
  // als „fehlend" gemeldet blockierte es das Finalisieren für immer.
  const fehlend: string[] = []
  for (const medium of manifest.media) {
    if (medium.entfernt) continue
    if (!(await mediumVorhanden(storage, tour.id, medium))) fehlend.push(medium.id)
  }
  if (fehlend.length) {
    setzeStatus(app, tour.id, tour.status) // Claim zurückgeben
    return { ok: false, code: 409, error: 'Medien fehlen', missing: fehlend }
  }

  // Erst-Render: alle externen Schritte laufen und füllen den Anreicherungs-Cache.
  // `erstmals` unterscheidet die allererste Verarbeitung von einem späteren
  // reprocess (das ebenfalls frisch rendert) — nur beim ersten Mal schlägt die
  // Pipeline ein Musikstück vor. `tour` hält noch den Status VOR dem Claim.
  app.verarbeitungen.set(
    tour.id,
    processTour(app, tour.id, { frisch: true, erstmals: tour.status === 'created' }).finally(() =>
      app.verarbeitungen.delete(tour.id),
    ),
  )
  return { ok: true }
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
      const ergebnis = await legeTourAn(app, benutzer.id, request.body)
      if (!ergebnis.ok) return reply.code(ergebnis.code).send({ error: ergebnis.error })
      return ergebnis.reused
        ? reply.code(200).send({ id: ergebnis.id, reused: true })
        : reply.code(201).send({ id: ergebnis.id })
    },
  )

  // — Finalisieren: Vollständigkeit prüfen, Anreicherung asynchron starten —
  app.post<{ Params: { id: string } }>('/api/tours/:id/finalize', async (request, reply) => {
    const benutzer = erfordereBenutzer(request, reply)
    if (!benutzer) return
    const tour = nurOwner(app, request.params.id, benutzer.id, reply)
    if (!tour) return
    const ergebnis = await finalisiereTour(app, tour)
    if (!ergebnis.ok) {
      return reply.code(ergebnis.code).send({
        error: ergebnis.error,
        ...(ergebnis.missing ? { missing: ergebnis.missing } : {}),
      })
    }
    return reply.code(202).send({ id: tour.id, status: 'processing' })
  })

  // — Metadaten ändern (Titel/Beschreibung/Finale/Sichtbarkeit) —
  app.patch<{
    Params: { id: string }
    Body: {
      title?: string
      description?: string
      kicker?: string
      finale?: boolean
      finaleTarget?: string
      visibility?: TourZeile['visibility']
    }
  }>(
    '/api/tours/:id',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 200 },
            description: { type: 'string', maxLength: 5000 },
            // Die Dachzeile darf LEER sein: Das ist die Art, sie loszuwerden.
            // Ohne den leeren String bliebe eine einmal gesetzte Zeile für
            // immer stehen, so wie es dem Titel bis heute geht.
            kicker: { type: 'string', maxLength: 80 },
            finale: { type: 'boolean' },
            finaleTarget: { type: 'string', maxLength: 200 },
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

      const { title, description, kicker, finale, finaleTarget, visibility } = request.body
      // finale: undefined → NULL → COALESCE behält den alten Wert; false → 0, true → 1.
      const finaleWert = finale === undefined ? null : finale ? 1 : 0
      db.prepare(
        `UPDATE tours SET title = COALESCE(?, title), description = COALESCE(?, description),
         kicker = COALESCE(?, kicker),
         finale = COALESCE(?, finale), finale_target = COALESCE(?, finale_target),
         visibility = COALESCE(?, visibility), updated_at = ? WHERE id = ?`,
      ).run(
        title ?? null,
        description ?? null,
        kicker ?? null,
        finaleWert,
        finaleTarget ?? null,
        visibility ?? null,
        new Date().toISOString(),
        tour.id,
      )

      // Bereits gerenderte Tour: Texte im tour.json nachziehen — asynchron und
      // über denselben Status-Claim wie finalize (nie zwei Renderer parallel,
      // Antwort hängt nicht an Nominatim). Läuft gerade eine Verarbeitung,
      // ist nichts zu tun: sie liest die eben aktualisierte DB-Zeile.
      // ACHTUNG: gegen undefined prüfen, nicht truthy — description '' / finale false
      // sind legitime Werte und müssen genauso neu rendern (Review-Fund M7).
      const textGeaendert =
        title !== undefined ||
        description !== undefined ||
        kicker !== undefined ||
        finale !== undefined ||
        finaleTarget !== undefined
      if (tour.status === 'ready' && textGeaendert) {
        const claim = db
          .prepare(
            `UPDATE tours SET status = 'processing', updated_at = ? WHERE id = ? AND status = 'ready'`,
          )
          .run(new Date().toISOString(), tour.id)
        if (claim.changes === 1) {
          // Nur Texte nachziehen — Anreicherung aus dem Cache (kein Netz).
          app.verarbeitungen.set(
            tour.id,
            processTour(app, tour.id, { frisch: false }).finally(() =>
              app.verarbeitungen.delete(tour.id),
            ),
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
      if (fehler) return reply.code(400).send({ error: fehler })
      // Während laufender Verarbeitung nicht speichern: sie hätte das Overlay
      // ggf. schon gelesen — das Ergebnis wäre undefiniert. Restrisiko: startet
      // zwischen dieser Prüfung und dem Schreiben ein anderer Handler (finalize)
      // den Renderer, kann tour.json einen Render hinter edits.json liegen —
      // selbstheilend beim nächsten Render/Reprocess, kein Doppel-Renderer.
      if (tour.status === 'processing') {
        return reply.code(409).send({ error: 'Verarbeitung läuft, bitte gleich erneut speichern' })
      }
      await storage.schreibe(tour.id, EDITS_PFAD, JSON.stringify(request.body, null, 2))
      // Fertige (oder gescheiterte) Tour direkt neu rendern — gleicher
      // Status-Claim wie finalize, nie zwei Renderer parallel.
      if (starteVerarbeitung(app, tour.id))
        return reply.code(202).send({ ok: true, status: 'processing' })
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
    if (tour.status === 'created')
      return reply.code(409).send({ error: 'Tour ist noch nicht finalisiert' })
    // „Neu verarbeiten" holt die Anreicherung bewusst frisch (verwirft den Cache).
    if (!starteVerarbeitung(app, tour.id, true))
      return reply.code(409).send({ error: 'Verarbeitung läuft bereits' })
    return reply.code(202).send({ id: tour.id, status: 'processing' })
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
    const manifest = JSON.parse(
      (await storage.lese(tour.id, MANIFEST_PFAD)).toString(),
    ) as UploadManifest
    if (manifest.trackFile && !(await storage.info(tour.id, TRACK_PFAD))) {
      return reply.code(409).send({ error: 'Track (GPX) fehlt noch' })
    }
    // Kaputtes GPX als 409 mit Ursache melden — gerade fehler-Touren sollen
    // im Editor sehen, WORAN es liegt, nicht „Interner Fehler" (Review-Fund).
    let segmente: UploadSegment[]
    try {
      segmente = await ladeOriginalSegmente(app, tour.id, manifest)
    } catch (fehler) {
      return reply.code(409).send({ error: `Track nicht lesbar: ${(fehler as Error).message}` })
    }
    if (!segmente.some((s) => s.pts.length >= 2))
      return reply.code(409).send({ error: 'Tour hat keinen Track' })
    const startMs = Date.parse(manifest.time.start)

    // Auto-Platzierung auf dem ORIGINAL-Track (ohne Overlay): die Basis, auf
    // die der Editor seine Overrides live legt. Overlay-Gelöschte (edits)
    // bleiben sichtbar; Tombstones verschwinden (zu ihnen kommt nie mehr eine
    // Datei).
    //
    // Einträge OHNE Datei hängen am Status: Bei „angelegt" läuft ihr Upload
    // gerade erst, sie GEHÖREN in die Ansicht. Bei einer fertigen Tour ist ein
    // solcher Eintrag dagegen ein Überbleibsel — ein Nachreichen, dessen
    // Upload abgebrochen ist. Ihn zu zeigen hieße, eine Aufnahme in die
    // Zeitleiste zu setzen, die es nicht gibt (Bild 404, nichts dahinter);
    // das Manifest behält ihn trotzdem, das Protokoll bleibt vollständig.
    const sichtbareMedien =
      tour.status === 'ready'
        ? await verfuegbareMedien(storage, tour.id, manifest.media)
        : manifest.media.filter((m) => !m.entfernt)
    const platziert = platziereMedien(
      sichtbareMedien,
      segmente.flatMap((s) => s.pts),
      startMs,
    )
    const videoDauern = await ermittleVideoDauern(app, tour.id, manifest)
    const medien: Array<Record<string, unknown>> = []
    for (const { medium, anchor, placement } of platziert) {
      // Die Anzeige-Fassung ist nach dem ersten Render die einzige noch
      // vorhandene Datei; nur bei unverarbeitetem Altbestand liegt das Original.
      const anzeige = anzeigeDateiname(medium.id)
      const bildDatei =
        medium.type === 'photo' && (await storage.info(tour.id, `media/${anzeige}`))
          ? anzeige
          : mediumDateiname(medium)
      const eintrag: Record<string, unknown> = {
        id: medium.id,
        type: medium.type,
        src: `/api/media/${tour.id}/${bildDatei}`,
        takenAt: medium.takenAt,
        caption: medium.caption ?? '',
        anchor,
        placement,
        // Roher GPS-Anker aus dem Manifest (nur wenn vorhanden): der Editor
        // bietet damit „GPS-Ort verwenden" an, wenn die Auto-Platzierung auf
        // zeit zurückfiel oder ein manueller Anker zurückgenommen werden soll.
        ...(medium.anchor ? { gpsAnchor: medium.anchor } : {}),
      }
      if (medium.type === 'video') {
        const poster = `${medium.id}.poster.jpg`
        if (await storage.info(tour.id, `media/${poster}`))
          eintrag['poster'] = `/api/media/${tour.id}/${poster}`
        // Die echte Länge: ohne sie rechnet die Zeitleiste ein 34-s-Video wie
        // ein Foto mit 5,2 s und zeigt ~34 px statt ~200 px Achsenbreite.
        const dauerS = videoDauern.get(medium.id)
        if (dauerS !== undefined) eintrag['durationS'] = dauerS
      }
      // Kachel für Zeitleiste und Inspector — die Miniatur zog bisher das volle
      // Foto (mehrere MB je Aufnahme, bei jedem Öffnen des Editors)
      const thumb = thumbDateiname(medium.id)
      if (await storage.info(tour.id, `media/${thumb}`))
        eintrag['thumb'] = `/api/media/${tour.id}/${thumb}`
      medien.push(eintrag)
    }
    medien.sort(
      (a, b) =>
        (Date.parse(a['takenAt'] as string) || 0) - (Date.parse(b['takenAt'] as string) || 0),
    )

    let edits: EditOverlay = { schema: EDITS_SCHEMA_ID }
    if (await storage.info(tour.id, EDITS_PFAD)) {
      edits = JSON.parse((await storage.lese(tour.id, EDITS_PFAD)).toString()) as EditOverlay
    }

    // Vorhandene Audio-Assets (Baukasten): media/ enthält auch Fotos/Videos/
    // Poster — der Dateinamen-Filter lässt nur echte Audio-Dateien durch.
    const audio = (await storage.listeDateien(tour.id, 'media'))
      .filter((d) => istAudioDatei(d.name))
      .map((d) => ({ file: d.name, size: d.groesse }))

    // Die Vorschläge für die Dachzeile: die Adress-Ebenen des Startpunkts, wie
    // sie beim Geocoding ohnehin anfielen. Aus dem Cache und nie frisch geholt —
    // eine Netzabfrage beim Öffnen des Editors wäre ein Aufruf pro Klick.
    let kickerSuggestions: string[] = []
    if (await storage.info(tour.id, ANREICHERUNG_PFAD)) {
      try {
        const cache = JSON.parse(
          (await storage.lese(tour.id, ANREICHERUNG_PFAD)).toString(),
        ) as AnreicherungsCache
        kickerSuggestions = cache.orte?.startEbenen ?? []
      } catch {
        // Ein kaputter Cache kostet die Vorschläge, nicht den Editor.
      }
    }

    return {
      id: tour.id,
      status: tour.status,
      title: tour.title,
      description: tour.description,
      kicker: tour.kicker,
      kickerSuggestions,
      finale: !!tour.finale,
      finaleTarget: tour.finale_target,
      time: manifest.time,
      // Original-Segmente, fürs Netz vereinfacht — behält [lng,lat,ele,tOffsetS]
      segments: segmente.map((s) => ({ mode: s.mode, pts: vereinfacheSegment(s.pts) })),
      media: medien,
      audio,
      autoWeather: await ermittleAutoWetter(app, tour.id, segmente, edits, startMs),
      edits,
    }
  })

  // — Eigene Touren auflisten —
  // Ganz ohne Anmeldedaten: leere Liste statt 401 — der Player fragt hier bei
  // JEDEM Seitenaufruf für den Tour-Picker an, und Browser loggen jede
  // 401-Antwort als Konsole-Fehler. UNGÜLTIGE Anmeldedaten bleiben 401
  // (die App braucht das Signal, um den Login anzustoßen).
  app.get('/api/tours', async (request, reply) => {
    if (
      !request.benutzer &&
      !request.headers.authorization &&
      !request.cookies['maptale_session']
    ) {
      return { tours: [] }
    }
    const benutzer = erfordereBenutzer(request, reply)
    if (!benutzer) return
    const zeilen = db
      .prepare(
        `SELECT id, no, status, visibility, title, stats_json, cover, cover_thumb, error, created_at
         FROM tours WHERE owner_id = ? ORDER BY created_at DESC`,
      )
      .all(benutzer.id) as Array<
      Pick<
        TourZeile,
        | 'id'
        | 'no'
        | 'status'
        | 'visibility'
        | 'title'
        | 'stats_json'
        | 'cover'
        | 'cover_thumb'
        | 'error'
        | 'created_at'
      >
    >
    return {
      tours: zeilen.map((z) => ({
        id: z.id,
        no: `N°${String(z.no).padStart(2, '0')}`,
        status: z.status,
        visibility: z.visibility,
        title: z.title,
        stats: z.stats_json ? (JSON.parse(z.stats_json) as unknown) : null,
        cover: z.cover,
        // Kachel-Fassung; fehlt sie (Altbestand), fällt die Anzeige auf `cover` zurück
        coverThumb: z.cover_thumb,
        error: z.error,
        createdAt: z.created_at,
      })),
    }
  })

  // — Tour-JSON ausliefern —
  app.get<{ Params: { id: string } }>('/api/tours/:id', async (request, reply) => {
    const tour = tourOderFehler(app, request.params.id, request.benutzer?.id ?? null, reply)
    if (!tour) return
    if (tour.status !== 'ready') {
      // Interne Fehlertexte (Pipeline-Exceptions) nur dem Owner zeigen —
      // jeder mit Link sieht nur den Status.
      const istOwner = request.benutzer?.id === tour.owner_id
      return reply
        .code(200)
        .send({ id: tour.id, status: tour.status, ...(istOwner ? { error: tour.error } : {}) })
    }
    // Der Autor kommt NICHT aus der Datei, sondern frisch aus der Datenbank:
    // Eingebacken wäre er beim nächsten Namens- oder Handle-Wechsel veraltet,
    // und ein Re-Render aller Touren dafür wäre absurd. Dieselbe Linie wie die
    // Galerie-Karte (server/src/routes/galerie.ts): Ohne gesetzten Anzeigenamen
    // bleibt die Tour anonym, statt ersatzweise Klarname oder Mailadresse zu
    // zeigen, und der Link auf das Profil entsteht nur, wenn es dieses Profil
    // öffentlich gibt.
    const tourJson = JSON.parse((await storage.lese(tour.id, TOURJSON_PFAD)).toString()) as Record<
      string,
      unknown
    >
    // Bestandstouren tragen im gerenderten JSON noch den erzeugten Alt-Kicker
    // („Aufgezeichnet am 14. Mai 2026"). Er stünde jetzt DOPPELT auf der Seite:
    // einmal über dem Titel und einmal in der Herkunftszeile neben dem Namen.
    // Ein Re-Render aller Touren nur dafür wäre unverhältnismäßig, also fällt
    // er hier weg — solange niemand eine eigene Dachzeile gesetzt hat. Beim
    // nächsten Render der Tour entsteht der Wert regulär in `baueBenennung`.
    if (tour.kicker === null && /^Aufgezeichnet am /.test(String(tourJson.kicker ?? '')))
      tourJson.kicker = ''

    const besitzer = app.deps.db
      .prepare(
        'SELECT id, handle, display_name, avatar, profile_visibility FROM users WHERE id = ?',
      )
      .get(tour.owner_id) as
      | {
          id: string
          handle: string | null
          display_name: string | null
          avatar: string | null
          profile_visibility: string
        }
      | undefined
    if (besitzer?.display_name) {
      const oeffentlich = besitzer.profile_visibility === 'public'
      tourJson.author = {
        displayName: besitzer.display_name,
        avatarUrl: besitzer.avatar
          ? `/api/users/${besitzer.id}/avatar?v=${encodeURIComponent(besitzer.avatar)}`
          : null,
        ...(oeffentlich ? { id: besitzer.id, handle: besitzer.handle } : {}),
      }
    }
    return reply.send(tourJson)
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

function setzeStatus(
  app: FastifyInstance,
  id: string,
  status: TourZeile['status'],
  fehler?: string,
): void {
  app.deps.db
    .prepare('UPDATE tours SET status = ?, error = ?, updated_at = ? WHERE id = ?')
    .run(status, fehler ?? null, new Date().toISOString(), id)
}

/** MIME-Typ eines Foto-Ablagenamens für die Bildanalyse (M5); Default JPEG. */
function bildMedientyp(datei: string): string {
  const endung = datei.toLowerCase().split('.').pop()
  if (endung === 'png') return 'image/png'
  if (endung === 'webp') return 'image/webp'
  // Nur der Rückfall: Normalerweise analysiert die Kachel-Fassung (JPEG). Ein
  // Modell, das HEIC nicht liest, meldet es sauber — besser als ein falsch
  // deklarierter Typ.
  if (endung === 'heic' || endung === 'heif') return 'image/heic'
  return 'image/jpeg'
}

/**
 * Verarbeitung atomar beanspruchen (nur aus ready/failed heraus) und starten.
 * false = eine andere Verarbeitung läuft bereits oder die Tour ist angelegt.
 * Exportiert für die Medien-Routen: endgültiges Löschen rendert direkt neu,
 * damit das tour.json nicht auf verschwundene Dateien zeigt.
 */
export function starteVerarbeitung(app: FastifyInstance, tourId: string, frisch = false): boolean {
  const claim = app.deps.db
    .prepare(
      `UPDATE tours SET status = 'processing', updated_at = ? WHERE id = ? AND status IN ('ready', 'failed')`,
    )
    .run(new Date().toISOString(), tourId)
  if (claim.changes === 0) return false
  app.verarbeitungen.set(
    tourId,
    processTour(app, tourId, { frisch }).finally(() => app.verarbeitungen.delete(tourId)),
  )
  return true
}

/** Original-Segmente des Manifests — bei GPX-Quelle (M6) serverseitig geparst. */
/**
 * Die Segmente der Aufzeichnung, wie sie ohne Bearbeitung aussehen.
 *
 * Hier laufen auch Pausen-Kollaps und Gehabschnitts-Erkennung: Beide gehören
 * zur ROHEN Tour, nicht zum Overlay — deshalb stehen sie an dieser einen
 * Stelle, die sich Editor und Render teilen. Liefe das nur beim Rendern,
 * zeigte der Editor eine andere Strecke und Aufteilung als das fertige Video.
 * Modus-Grenzen aus dem Overlay werden später darübergelegt und behalten
 * Vorrang (wendeModiAn). Der Kollaps läuft VOR der Gehabschnitts-Erkennung:
 * danach ist das Momentantempo in der Pause exakt 0, und eine Pause kann
 * nicht mehr von einer Segmentteilung zerschnitten werden.
 */
async function ladeOriginalSegmente(
  app: FastifyInstance,
  tourId: string,
  manifest: UploadManifest,
): Promise<UploadSegment[]> {
  // Eingebettete Segmente OHNE GPX sind ZWEIERLEI, und der Unterschied
  // entscheidet über die Tempo-Automatik:
  //
  //   • Gesetzte Wegpunkte (Tour aus Foto-Orten). Zwischen zwei Fotos liegt
  //     eine Luftlinie — was die Automatik daraus rechnet, ist Zufall.
  //   • Eine echte Aufzeichnung. Die App schickt ihren Track NICHT als GPX,
  //     sondern als eingebettete Segmente (upload/Manifest.kt `baueSegmente`);
  //     `trackFile` gibt es nur beim GPX-Import.
  //
  // Weil hier lange nur der erste Fall bedacht war, lief bei App-Aufnahmen
  // überhaupt keine Erkennung: Eine Straßenbahnfahrt mit Fußwegen blieb ein
  // einziges „zu Fuß" über die ganze Tour. `istAufzeichnung` trennt die Fälle
  // an der Form der Daten (dichtes Zeitraster), denn ein Manifest-Feld dafür
  // gibt es nicht — und Bestandstouren hätten es ohnehin nicht.
  //
  // Der Pausen-Kollaps läuft in beiden Fällen: „≥ 15 min im 150-m-Radius" ist
  // auch bei gesetzten Wegpunkten ein Aufenthalt.
  if (!manifest.trackFile) {
    const segmente = kollabierePausen(manifest.segments ?? [])
    return istAufzeichnung(segmente) ? trenneGehabschnitteInSegmenten(segmente) : segmente
  }
  const gpxText = (await app.deps.storage.lese(tourId, TRACK_PFAD)).toString()
  const { segment } = baueSegmentAusGpx(parseGpx(gpxText), {
    startMs: Date.parse(manifest.time.start),
    endMs: Date.parse(manifest.time.end),
    ...(manifest.trackMode ? { modus: manifest.trackMode } : {}),
  })
  return trenneGehabschnitteInSegmenten(kollabierePausen([segment]))
}

/**
 * Das AUTOMATISCH ermittelte Wetter der Tour als Zeitgrenzen — dieselbe Form,
 * die auch `edits.wetter` benutzt.
 *
 * Der Editor zeigt damit auf der Wetterspur, was tatsächlich gilt, statt eines
 * einzigen Bandes „Automatisch"; beim ersten Eingriff schreibt er es fest (das
 * Overlay ersetzt das Auto-Wetter ja vollständig, sonst ginge alles Übrige
 * verloren). Rein lesend — keine externen Aufrufe, kein Cache-Verfall.
 *
 * Quelle ist bevorzugt das gerenderte tour.json: dort steckt das Wetter
 * einschließlich Foto-Verfeinerung (M5), also genau das, was der Player zeigt.
 * Stammt es aus dem Studio (der Nutzer hat bereits eingegriffen), tritt der
 * Anreicherungs-Cache an seine Stelle, der immer das Rohergebnis der Automatik
 * hält. Fehlt beides (noch nie gerendert), bleibt die Liste leer.
 */
/**
 * Echte Länge je Video (s) für den Editor.
 *
 * Drei Quellen, in dieser Reihenfolge: das Manifest (die App misst beim
 * Aufnehmen), der Anreicherungs-Cache (`videoMeta`, von ffprobe) und das
 * gerenderte tour.json. Fehlt alles — unverarbeiteter Altbestand —, bleibt das
 * Feld weg und die Zeitleiste rechnet weiter mit ihrer Foto-Annahme.
 * Rein lesend: kein ffprobe, kein Re-Render, keine externen Aufrufe.
 *
 * Gemeint ist die Länge des MATERIALS, nicht die des Ausschnitts: Daran schlagen
 * die Trimm-Kanten im Editor an. Deshalb gilt aus dem Cache `quellDauerS` vor
 * `dauerS`, und das (getrimmte) tour.json kommt zuletzt.
 */
async function ermittleVideoDauern(
  app: FastifyInstance,
  tourId: string,
  manifest: UploadManifest,
): Promise<Map<string, number>> {
  const { storage } = app.deps
  const dauern = new Map<string, number>()
  const setze = (id: string, wert: unknown): void => {
    if (typeof wert === 'number' && Number.isFinite(wert) && wert > 0 && !dauern.has(id))
      dauern.set(id, wert)
  }
  for (const m of manifest.media) {
    if (m.type === 'video') setze(m.id, m.durationS)
  }
  try {
    if (await storage.info(tourId, ANREICHERUNG_PFAD)) {
      const cache = JSON.parse(
        (await storage.lese(tourId, ANREICHERUNG_PFAD)).toString(),
      ) as AnreicherungsCache
      for (const [id, meta] of Object.entries(cache.videoMeta ?? {}))
        setze(id, meta?.quellDauerS ?? meta?.dauerS)
    }
    if (await storage.info(tourId, TOURJSON_PFAD)) {
      const tourJson = JSON.parse((await storage.lese(tourId, TOURJSON_PFAD)).toString()) as {
        media?: Array<{ id: string; durationS?: number }>
      }
      for (const m of tourJson.media ?? []) setze(m.id, m.durationS)
    }
  } catch {
    // Kaputtes/altes Artefakt darf den Editor nicht am Öffnen hindern
  }
  return dauern
}

async function ermittleAutoWetter(
  app: FastifyInstance,
  tourId: string,
  segmente: readonly UploadSegment[],
  edits: EditOverlay,
  startMs: number,
): Promise<Array<{ ab: string; mode: string; staerke: number }>> {
  const { storage } = app.deps
  try {
    let keyframes: WetterKeyframe[] = []
    if (await storage.info(tourId, TOURJSON_PFAD)) {
      const tourJson = JSON.parse((await storage.lese(tourId, TOURJSON_PFAD)).toString()) as {
        weather?: WetterKeyframe[]
      }
      const kf = tourJson.weather ?? []
      if (kf.length && !kf.some((k) => k.source === 'studio')) keyframes = kf
    }
    if (!keyframes.length && (await storage.info(tourId, ANREICHERUNG_PFAD))) {
      const cache = JSON.parse(
        (await storage.lese(tourId, ANREICHERUNG_PFAD)).toString(),
      ) as AnreicherungsCache
      keyframes = cache.wetterRoh ?? []
    }
    if (!keyframes.length) return []
    // Bezug ist der GETRIMMTE Track — auf ihm rechnet die Pipeline ihre f-Werte.
    const reihe = baueZeitreihe(wendeTrimAn(segmente, edits.trim, startMs))
    if (reihe.punkte.length < 2) return []
    return wetterZuGrenzen(keyframes, reihe, startMs)
  } catch {
    // Kaputtes/altes tour.json darf den Editor nicht am Öffnen hindern
    return []
  }
}

/**
 * Anreicherung ausführen und Ergebnis persistieren (läuft asynchron nach
 * finalize/edits/patch/reprocess). `frisch` (finalize/reprocess) erzwingt die
 * teuren externen Schritte (Bildanalyse, Reverse-Geocoding, Wetter, Video) und
 * erneuert den Anreicherungs-Cache; ohne `frisch` (edits/patch) werden sie —
 * soweit gültig — aus dem Cache übernommen, sodass nur das Overlay lokal
 * angewandt wird (Sekundenbruchteil statt zig Sekunden).
 */
export async function processTour(
  app: FastifyInstance,
  tourId: string,
  opts: { frisch?: boolean; erstmals?: boolean } = {},
): Promise<void> {
  const { frisch = false, erstmals = false } = opts
  const {
    db,
    storage,
    benutzerStorage,
    geocoder,
    wetter,
    videoWerkzeug,
    bildWerkzeug,
    bildKlassifikator,
    schienen,
  } = app.deps
  const protokoll = (nachricht: string): void => app.log.warn(nachricht)
  try {
    const tour = ladeTour(app, tourId)
    if (!tour) return
    let manifest = JSON.parse(
      (await storage.lese(tourId, MANIFEST_PFAD)).toString(),
    ) as UploadManifest

    // Hat der Nutzer die Fortbewegung selbst angegeben?
    //
    // Zwei Wege, das zu verneinen: Die App sagt es ausdrücklich
    // (`modiAutomatisch`, seit sie die Bewegung selbst erkennt), oder es steht
    // durchgehend „walk" — was in der App zugleich „zu Fuß" und „Automatisch"
    // bedeutet und deshalb als Vorgabe gilt, nicht als Angabe.
    const modusGeraten =
      !manifest.trackMode &&
      (manifest.modiAutomatisch === true ||
        (manifest.segments ?? []).every((s) => s.mode === 'walk'))

    // GPX-Quelle (M6): das hochgeladene trackFile serverseitig zu einem Segment
    // parsen und ins Manifest einsetzen — ab hier ist die Pipeline quellenblind.
    // Medien auf die VERFÜGBAREN filtern (keine Tombstones, keine angekündigten
    // ohne Datei): die eine Stelle, ab der Platzierung, Fassungen, Bildanalyse,
    // Render und Cover-Wahl gelöschte Medien nicht mehr sehen.
    manifest = {
      ...manifest,
      segments: await ladeOriginalSegmente(app, tourId, manifest),
      media: await verfuegbareMedien(storage, tourId, manifest.media),
    }

    // Edit-Overlay (M7): Trim, Modus-Grenzen und Medien-Overrides fließen als
    // eigene Pipeline-Eingabe ein — die Rohdaten unter original/ bleiben unberührt.
    let edits: EditOverlay | null = null
    if (await storage.info(tourId, EDITS_PFAD)) {
      edits = JSON.parse((await storage.lese(tourId, EDITS_PFAD)).toString()) as EditOverlay
    }

    // Straßenbahn erkennen: Am Tempo sind Moped, Jeep und Tram nicht zu
    // unterscheiden — an der Trasse schon. Läuft nur bei `frisch` (also
    // finalize/„Neu verarbeiten"), nur wenn die Fortbewegung überhaupt geraten
    // wurde, und nur solange niemand im Studio eine Modus-Kante gezogen hat:
    // Eine Nutzer-Entscheidung wird nicht überstimmt. Das Ergebnis geht als
    // Grenzen ins OVERLAY — dort ist es sichtbar und korrigierbar, statt als
    // unerklärlicher Automatik-Effekt im fertigen Tour-JSON zu stecken (dasselbe
    // Muster wie die Musikwahl unten).
    if (frisch && modusGeraten && schienen && !edits?.modi?.length) {
      const segmente = manifest.segments ?? []
      const box = istAufzeichnung(segmente) ? umgebungsBox(segmente) : null
      if (box) {
        try {
          const gehoben = hebeSchienenAbschnitte(segmente, await schienen.gleise(box))
          if (gehoben.some((s, i) => s.mode !== segmente[i]?.mode)) {
            const startMs = Date.parse(manifest.time.start)
            const mitModi: EditOverlay = {
              ...(edits ?? { schema: EDITS_SCHEMA_ID }),
              modi: gehoben.map((s) => ({
                ab: new Date(startMs + (s.pts[0]?.[3] ?? 0) * 1000).toISOString(),
                mode: s.mode,
              })),
            }
            await storage.schreibe(tourId, EDITS_PFAD, JSON.stringify(mitModi, null, 2))
            edits = mitModi
          }
        } catch (fehler) {
          // OSM ist eine Anreicherung, kein Muss — fällt sie aus, bleibt es bei
          // der Tempo-Automatik (Rad statt Bahn).
          protokoll(`Schienen-Abgleich übersprungen: ${(fehler as Error).message}`)
        }
      }
    }

    // Anreicherungs-Cache: die teuren extern beschafften Ergebnisse. `frisch`
    // ignoriert ihn und erneuert alles; sonst wird — soweit gültig — daraus
    // übernommen. Beschädigter/alter Cache (Schema-Mismatch) zählt wie keiner →
    // dann wird unten alles frisch berechnet (selbstheilend, kein Migrationslauf).
    const sig = trimSignatur(edits)
    let cache: AnreicherungsCache | null = null
    if (!frisch && (await storage.info(tourId, ANREICHERUNG_PFAD))) {
      try {
        const geladen = JSON.parse(
          (await storage.lese(tourId, ANREICHERUNG_PFAD)).toString(),
        ) as AnreicherungsCache
        if (geladen?.schema === ANREICHERUNG_SCHEMA_ID) cache = geladen
      } catch {
        cache = null
      }
    }

    // (1) Video-Meta + Bildbefunde hängen NUR an den Rohfotos/-videos → aus dem
    //     Cache übernehmen; nur ohne Cache neu berechnen. Das erspart dem
    //     Edit-Speichern ffprobe/Transcode UND die teure, sequenzielle
    //     Foto-Bildanalyse (1 Vision-Call je Foto) — der Löwenanteil der Zeit.
    const medienSpeicher = {
      lese: (relPfad: string) => storage.lese(tourId, relPfad),
      schreibe: (relPfad: string, inhalt: Buffer) => storage.schreibe(tourId, relPfad, inhalt),
      info: (relPfad: string) => storage.info(tourId, relPfad),
      loesche: (relPfad: string) => storage.loesche(tourId, relPfad),
    }

    // Der Video-Schnitt (Etappe 4) ist der EINE Edit, der die ausgelieferte
    // Datei verändert — er muss die gecachte Video-Aufbereitung verwerfen,
    // sonst bliebe er bis zum nächsten „Neu verarbeiten" folgenlos.
    const schnittSig = videoSchnittSignatur(edits)
    let videoMeta: Map<string, VideoMeta>
    if (cache && (cache.videoSchnittSignatur ?? '[]') === schnittSig) {
      videoMeta = recordZuMap(cache.videoMeta)
    } else {
      videoMeta = new Map<string, VideoMeta>()
      const videoMedien = manifest.media.filter((m) => m.type === 'video')
      if (videoWerkzeug && videoMedien.length) {
        videoMeta = await bereiteVideosAuf({
          medien: videoMedien.map((m) => {
            const schnitt = edits?.medien?.[m.id]?.trim
            return { id: m.id, originalDatei: mediumDateiname(m), ...(schnitt ? { schnitt } : {}) }
          }),
          speicher: medienSpeicher,
          werkzeug: videoWerkzeug,
          protokoll,
        })
      }
    }

    // Bild-Fassungen (bild.ts) — anders als die Blöcke darüber IMMER, auch mit
    // gültigem Cache: Sie sind keine berechneten Metadaten, sondern DATEIEN, und
    // welche liegen, weiß nur der Storage. Teuer ist das nicht — liegen beide
    // Fassungen, bleibt es bei zwei stat-Aufrufen je Medium.
    const fotoMeta = bildWerkzeug
      ? await bereiteFotosAuf({
          medien: manifest.media.flatMap((m): FotoEingabe[] => {
            if (m.type === 'photo')
              return [{ id: m.id, quellDatei: mediumDateiname(m), anzeige: true }]
            // Videos: Kachel aus dem Standbild — das Poster selbst bleibt
            const poster = videoMeta.get(m.id)?.posterDatei
            return poster ? [{ id: m.id, quellDatei: poster, anzeige: false }] : []
          }),
          speicher: medienSpeicher,
          werkzeug: bildWerkzeug,
          protokoll,
        })
      : new Map<string, FotoMeta>()

    // Bildanalyse (M5): nur mit konfiguriertem Klassifikator (OpenRouter-Key).
    // Ein einzelnes scheiterndes Bild darf die Anreicherung nie kippen. Welche
    // Fotos tatsächlich verwertet werden (platziert), entscheidet reichereAn.
    //
    // Gelesen wird die KACHEL-Fassung (480 px), nicht die Anzeige-Fassung. Die
    // Frage lautet „welches Wetter zeigt der Himmel", und die beantwortet das
    // Modell auf der Kachel genauso — an fünf Fotos mit bekanntem Wetter
    // gegengeprüft, gleiche Befunde. Es spart aber ein Viertel der Kosten und
    // ein Fünftel der Zeit, weil das Bild als base64 IM Request steckt: 55 KB
    // statt 940 KB je Aufruf. Fällt die Kachel aus (Aufbereitung gescheitert),
    // bleibt der Weg über Anzeige-Fassung bzw. Original.
    //
    // Und der eigentliche Hebel: NEBENLÄUFIG (s. BILDANALYSE_PARALLEL).
    // Sequenziell war dieser Block über 90 % der Verarbeitungszeit — 30 Fotos
    // brauchten 66 s, davon 62 s hier; alles andere zusammen (ffmpeg,
    // Geocoding, Wetter, Track, Render) 4 s. Jetzt sind es 11 s.
    //
    // Die Ergebnisse werden anschließend in MANIFEST-Reihenfolge einsortiert:
    // Der Cache (anreicherung.json) soll nicht je nach Antwortzeiten anders
    // herum stehen, sonst ist jeder Re-Render ein Diff ohne Unterschied.
    let bildBefunde: Map<string, BildBefund>
    if (cache) {
      bildBefunde = recordZuMap(cache.befunde)
    } else {
      bildBefunde = new Map<string, BildBefund>()
      if (bildKlassifikator) {
        const fotos = manifest.media.filter((x) => x.type === 'photo')
        const ergebnisse = new Array<BildBefund | null>(fotos.length).fill(null)
        let naechstes = 0
        const arbeiter = async (): Promise<void> => {
          // Kein Zuteilungs-Race: zwischen Lesen und Erhöhen von `naechstes`
          // liegt kein await, und JS führt bis dahin ununterbrochen aus.
          for (let i = naechstes++; i < fotos.length; i = naechstes++) {
            const m = fotos[i] as UploadManifest['media'][number]
            try {
              const meta = fotoMeta.get(m.id)
              const datei = meta?.thumbDatei ?? meta?.anzeigeDatei ?? mediumDateiname(m)
              if (!(await storage.info(tourId, `media/${datei}`))) continue
              ergebnisse[i] = await bildKlassifikator.klassifiziere(
                {
                  daten: await storage.lese(tourId, `media/${datei}`),
                  medientyp: bildMedientyp(datei),
                },
                (nachricht) => protokoll(`${nachricht} (${m.id})`),
              )
            } catch (fehler) {
              app.log.warn(`Bildanalyse fehlgeschlagen (${m.id}): ${(fehler as Error).message}`)
            }
          }
        }
        await Promise.all(
          Array.from({ length: Math.min(BILDANALYSE_PARALLEL, fotos.length) }, () => arbeiter()),
        )
        for (const [i, befund] of ergebnisse.entries()) {
          if (befund) bildBefunde.set((fotos[i] as UploadManifest['media'][number]).id, befund)
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
      ;({ orte, wetterRoh } = await berechneRohAnreicherung({
        manifest,
        edits,
        geocoder,
        wetter,
        protokoll,
      }))
    }

    // Erste Verarbeitung: ein passendes Musikstück vorschlagen und ins Overlay
    // schreiben — dort ist es im Studio sichtbar und austauschbar. Nur beim
    // ersten Mal: wer es später entfernt, soll es nicht beim nächsten Render
    // zurückbekommen. Ein bereits gesetztes `audio` bleibt unangetastet.
    if (erstmals && !edits?.audio?.length) {
      const datei = waehleMusik({
        segmente: manifest.segments ?? [],
        wetter: wetterRoh,
        startIso: manifest.time.start,
        endeIso: manifest.time.end,
        zone: manifest.time.zone,
      })
      const mitMusik: EditOverlay = {
        ...(edits ?? { schema: EDITS_SCHEMA_ID }),
        audio: [{ datei, typ: 'musik', ab: manifest.time.start, quelle: 'bibliothek' }],
      }
      await storage.schreibe(tourId, EDITS_PFAD, JSON.stringify(mitMusik, null, 2))
      edits = mitMusik
    }

    // Vorhandene Audio-Dateien an die Pipeline reichen (Baukasten) —
    // edits.audio-Einträge ohne Datei überspringt sie dort mit Warnung.
    const audioDateien = (await storage.listeDateien(tourId, 'media'))
      .map((d) => d.name)
      .filter(istAudioDatei)
    // Dazu die benutzerweite Bibliothek des Eigentümers (quelle 'benutzer').
    const benutzerAudioDateien = (await benutzerStorage.listeDateien(tour.owner_id, 'audio')).map(
      (d) => d.name,
    )

    // Render ist jetzt rein lokal: alle externen Ergebnisse liegen als Eingabe vor.
    const tourJson = await reichereAn({
      tourId,
      nummer: tour.no,
      manifest,
      titelOverride: tour.title,
      beschreibungOverride: tour.description,
      dachzeileOverride: tour.kicker,
      showFinale: !!tour.finale,
      finaleZielOverride: tour.finale_target,
      ...(edits ? { edits } : {}),
      audioDateien,
      benutzerAudioDateien,
      orte,
      wetterRoh,
      ...(videoMeta.size ? { videoMeta } : {}),
      ...(fotoMeta.size ? { fotoMeta } : {}),
      ...(bildBefunde.size ? { bildBefunde } : {}),
      protokoll,
    })
    await storage.schreibe(tourId, TOURJSON_PFAD, JSON.stringify(tourJson, null, 2))

    // Anreicherungs-Cache zurückschreiben — das nächste Edit-Speichern nutzt ihn.
    const neuerCache: AnreicherungsCache = {
      schema: ANREICHERUNG_SCHEMA_ID,
      befunde: mapZuRecord(bildBefunde),
      videoMeta: mapZuRecord(videoMeta),
      videoSchnittSignatur: schnittSig,
      trimSignatur: sig,
      orte,
      wetterRoh,
    }
    await storage.schreibe(tourId, ANREICHERUNG_PFAD, JSON.stringify(neuerCache, null, 2))
    // title nur setzen, wenn noch keiner existiert (Auto-Benennung persistieren) —
    // ein während der Verarbeitung per PATCH gesetzter Nutzer-Titel darf nicht
    // rückwirkend überschrieben werden (Lost Update).
    const titelbild = bestimmeCover(tourJson.media, edits?.titelbild)
    db.prepare(
      `UPDATE tours SET status = ?, title = COALESCE(title, ?), stats_json = ?, cover = ?, cover_thumb = ?,
       error = NULL, updated_at = ? WHERE id = ?`,
    ).run(
      'ready',
      tourJson.brandTitle,
      JSON.stringify(tourJson.stats),
      titelbild?.cover ?? null,
      titelbild?.thumb ?? null,
      new Date().toISOString(),
      tourId,
    )
  } catch (fehler) {
    app.log.error(fehler, `Anreicherung fehlgeschlagen: ${tourId}`)
    setzeStatus(app, tourId, 'failed', (fehler as Error).message)
  }
}
