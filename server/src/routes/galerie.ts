// Öffentliche Schaufenster: die Galerie aller freigegebenen Touren und die
// Profilseite einer Person.
//
// Beide Routen laufen ohne Anmeldung — sie zeigen ausschließlich, was jemand
// ausdrücklich auf `public` gestellt hat. Zwei Stufen entscheiden getrennt
// voneinander: Eine öffentliche TOUR erscheint in der Galerie, aber ihr Urheber
// bekommt nur dann einen Namen und einen Link, wenn er auch sein PROFIL
// freigegeben hat. Wer seine Touren zeigen, sich selbst aber nicht nennen will,
// kann das.

import type { FastifyInstance } from 'fastify'
import { titelbildUrl } from '../profilfelder.js'

/** Wie viele Touren eine Seite der Galerie zeigt. */
const SEITE_STANDARD = 24
const SEITE_MAX = 60

interface GalerieZeile {
  id: string
  title: string | null
  cover: string | null
  cover_thumb: string | null
  stats_json: string | null
  created_at: string
  autor_id: string
  autor_handle: string | null
  anzeigename: string | null
  avatar: string | null
  profil_sichtbarkeit: string
}

/**
 * Die Spalten, die eine Galerie-Karte braucht — einmal geschrieben, weil
 * Galerie und Profil dieselbe Karte ausliefern und ein fehlendes Feld auf einer
 * der beiden Seiten erst in der Anzeige auffiele.
 */
const KARTEN_SPALTEN = `t.id, t.title, t.cover, t.cover_thumb, t.stats_json, t.created_at,
        u.id AS autor_id, u.handle AS autor_handle, u.anzeigename, u.avatar, u.profil_sichtbarkeit`

/** Karte, wie sie die Galerie ausliefert. */
function alsKarte(z: GalerieZeile) {
  const stats = z.stats_json ? (JSON.parse(z.stats_json) as { km?: number }) : null
  // Autor nur mit gesetztem Anzeigenamen — ohne ihn bleibt die Tour anonym,
  // statt ersatzweise den Klarnamen oder die E-Mail zu zeigen.
  const profilOeffentlich = z.profil_sichtbarkeit === 'public'
  const autor = z.anzeigename
    ? {
        anzeigename: z.anzeigename,
        avatarUrl: z.avatar ? `/api/benutzer/${z.autor_id}/avatar?v=${encodeURIComponent(z.avatar)}` : null,
        // Der Link auf die Profilseite entsteht nur, wenn es sie gibt. Die ID
        // bleibt neben dem Handle stehen: Sie ist der Rückfall für Konten, die
        // aus der Zeit vor den Handles stammen.
        ...(profilOeffentlich ? { id: z.autor_id, handle: z.autor_handle } : {}),
      }
    : null
  return {
    id: z.id,
    titel: z.title,
    cover: z.cover,
    // Kachel-Fassung; fehlt sie (Altbestand), fällt die Anzeige auf `cover` zurück
    coverThumb: z.cover_thumb,
    km: stats?.km ?? null,
    erstelltAm: z.created_at,
    autor,
  }
}

export function registriereGalerieRouten(app: FastifyInstance): void {
  const { db } = app.deps

  // — Galerie: alle öffentlichen, fertig gerenderten Touren —
  app.get<{ Querystring: { limit?: string; offset?: string } }>('/api/galerie', async (request) => {
    const limit = Math.min(Math.max(Number(request.query.limit) || SEITE_STANDARD, 1), SEITE_MAX)
    const offset = Math.max(Number(request.query.offset) || 0, 0)
    // Eine Zeile mehr holen, als ausgeliefert wird: daran hängt „mehr“, ohne
    // dafür ein zweites COUNT über die ganze Tabelle zu rechnen.
    const zeilen = db
      .prepare(
        `SELECT ${KARTEN_SPALTEN}
         FROM tours t JOIN users u ON u.id = t.owner_id
         WHERE t.visibility = 'public' AND t.status = 'bereit'
         ORDER BY t.created_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(limit + 1, offset) as GalerieZeile[]

    return {
      touren: zeilen.slice(0, limit).map(alsKarte),
      mehr: zeilen.length > limit,
    }
  })

  // — Öffentliche Profilseite —
  //
  // Der Parameter ist ein HANDLE (`/@henrik`) oder eine Benutzer-ID (die alte Form
  // `?id=…`, die in Mails und Chats steht und deshalb nie abgeschaltet wird).
  // Geraten wird dabei nicht: IDs tragen den Präfix `u_`, den handle.ts für
  // Handles sperrt. Ein aufgegebener Handle löst 90 Tage lang weiter auf
  // (`benutzerIdFuerHandle`) — sonst bräche jeder geteilte Link in dem Moment,
  // in dem jemand seine Adresse ändert.
  //
  // Der Parameter heißt `:id` wie in der Avatar-Route daneben: Fastify legt
  // Pfade mit gleichem Aufbau in denselben Baum, und zwei Namen an derselben
  // Stelle wären eine Stolperstelle ohne Gewinn.
  app.get<{ Params: { id: string } }>('/api/benutzer/:id/profil', async (request, reply) => {
    const wen = request.params.id
    const userId = wen.startsWith('u_') ? wen : app.auth.benutzerIdFuerHandle(wen)
    const person = userId
      ? (db.prepare('SELECT id, created_at FROM users WHERE id = ?').get(userId) as
          | { id: string; created_at: string }
          | undefined)
      : undefined
    const profil = person ? app.auth.profil(person.id) : null
    // Der Besitzer sieht sein eigenes Profil auch, solange es privat ist —
    // sonst führte der Weg zum Sichtbarkeits-Schalter durch eine 404-Seite.
    // Für alle anderen gilt 404 statt 403: Ein nicht freigegebenes Profil
    // verrät nicht einmal, dass es existiert (dieselbe Linie wie bei privaten
    // Touren).
    const istBesitzer = !!person && request.benutzer?.id === person.id
    if (!person || !profil || (profil.sichtbarkeit !== 'public' && !istBesitzer)) {
      return reply.code(404).send({ fehler: 'Profil nicht gefunden' })
    }

    const zeilen = db
      .prepare(
        `SELECT ${KARTEN_SPALTEN}
         FROM tours t JOIN users u ON u.id = t.owner_id
         WHERE t.owner_id = ? AND t.visibility = 'public' AND t.status = 'bereit'
         ORDER BY t.created_at DESC`,
      )
      .all(person.id) as GalerieZeile[]

    return {
      handle: profil.handle,
      anzeigename: profil.anzeigename,
      bio: profil.bio,
      ort: profil.ort,
      website: profil.website,
      instagram: profil.instagram,
      avatarUrl: profil.avatar
        ? `/api/benutzer/${person.id}/avatar?v=${encodeURIComponent(profil.avatar)}`
        : null,
      titelbildUrl: titelbildUrl(person.id, profil.titelbild),
      /** Monatsgenau — auf den Tag genau wäre es eine Angabe über die Person, die niemand braucht. */
      dabeiSeit: person.created_at,
      kennzahlen: app.auth.kennzahlen(person.id),
      /**
       * Nur für den Besitzer und nur, wenn sein Profil privat steht: Die Seite
       * zeigt dann statt des Teilen-Knopfes, dass hier gerade niemand sonst
       * hineinsieht.
       */
      nurFuerDich: profil.sichtbarkeit !== 'public',
      touren: zeilen.map(alsKarte),
    }
  })
}
