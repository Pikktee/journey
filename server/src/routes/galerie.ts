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

/** Wie viele Touren eine Seite der Galerie zeigt. */
const SEITE_STANDARD = 24
const SEITE_MAX = 60

interface GalerieZeile {
  id: string
  title: string | null
  cover: string | null
  stats_json: string | null
  created_at: string
  autor_id: string
  anzeigename: string | null
  avatar: string | null
  profil_sichtbarkeit: string
}

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
        // Der Link auf die Profilseite entsteht nur, wenn es sie gibt
        ...(profilOeffentlich ? { id: z.autor_id } : {}),
      }
    : null
  return {
    id: z.id,
    titel: z.title,
    cover: z.cover,
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
        `SELECT t.id, t.title, t.cover, t.stats_json, t.created_at,
                u.id AS autor_id, u.anzeigename, u.avatar, u.profil_sichtbarkeit
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
  app.get<{ Params: { id: string } }>('/api/benutzer/:id/profil', async (request, reply) => {
    const person = db
      .prepare('SELECT id, anzeigename, bio, avatar, profil_sichtbarkeit FROM users WHERE id = ?')
      .get(request.params.id) as
      | { id: string; anzeigename: string | null; bio: string | null; avatar: string | null; profil_sichtbarkeit: string }
      | undefined
    // 404 statt 403: ein nicht freigegebenes Profil verrät nicht, dass es
    // existiert (dieselbe Linie wie bei privaten Touren).
    if (!person || person.profil_sichtbarkeit !== 'public') {
      return reply.code(404).send({ fehler: 'Profil nicht gefunden' })
    }

    const zeilen = db
      .prepare(
        `SELECT t.id, t.title, t.cover, t.stats_json, t.created_at,
                u.id AS autor_id, u.anzeigename, u.avatar, u.profil_sichtbarkeit
         FROM tours t JOIN users u ON u.id = t.owner_id
         WHERE t.owner_id = ? AND t.visibility = 'public' AND t.status = 'bereit'
         ORDER BY t.created_at DESC`,
      )
      .all(person.id) as GalerieZeile[]

    return {
      anzeigename: person.anzeigename,
      bio: person.bio,
      avatarUrl: person.avatar
        ? `/api/benutzer/${person.id}/avatar?v=${encodeURIComponent(person.avatar)}`
        : null,
      touren: zeilen.map(alsKarte),
    }
  })
}
