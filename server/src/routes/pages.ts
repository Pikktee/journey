/**
 * Die Seiten, die der Server selbst ausliefert — heute `/@handle`.
 *
 * Die Mechanik (gebautes HTML holen, Meta-Block ersetzen) steht in
 * [page-meta.ts](../page-meta.ts); hier steht nur, WAS im Kopf einer Profilseite
 * landet. Der Rest der Seite bleibt clientseitig wie zuvor: Diese Route macht
 * aus Maptale keine gerenderte Anwendung, sie beantwortet genau die eine Frage,
 * die eine statische Datei nicht beantworten kann — „wer bist du und darfst du
 * in den Index?".
 *
 * Drei Regeln, die man beim Aufräumen leicht kippt:
 *
 * 1. **Indexiert wird nur, wer BEIDES will**: öffentliches Profil UND den
 *    Schalter „In Suchmaschinen erscheinen". Ein Profil über den Link zu teilen
 *    ist etwas anderes, als unter dem eigenen Namen auffindbar zu sein.
 * 2. **Ein privates oder unbekanntes Profil verrät nichts.** Der Kopf ist dann
 *    generisch („Profil · Maptale"), nicht etwa Name plus `noindex` — der
 *    Meta-Kopf steht im Quelltext für jeden lesbar, und ein `noindex` verbirgt
 *    ihn vor Suchmaschinen, nicht vor Menschen. Sonst wäre diese Route eine
 *    Auskunft darüber, wer hier ein Konto hat.
 * 3. **Die Vorschaukarte gibt es auch ohne Index.** `noindex` heißt „nicht in
 *    die Suche", nicht „keine Karte im Chat" — die Bots der Messenger lesen die
 *    og:-Tags und kümmern sich nicht um `robots`. Genau deshalb ist `/@` auch
 *    nicht in der robots.txt gesperrt: Ein Disallow nähme dem `noindex` die
 *    Lesbarkeit und der Karte das Bild.
 */
import type { FastifyInstance, FastifyReply } from 'fastify'
import { HANDLE_PATTERN } from '../handle.js'
import { bannerUrl } from '../profile-fields.js'
import { type MetaBlock, buildDescription, setMeta } from '../page-meta.js'
import { defaultBanner } from '../profile-banners.js'

/** Der Kopf, den jede Seite bekommt, über die nichts gesagt werden darf. */
const SILENT: MetaBlock = {
  title: 'Profil · Maptale',
  robots: 'noindex',
}

/** Dasselbe für den Player — der Titel, der ohne Tour im Build steht. */
const SILENT_TOUR: MetaBlock = {
  title: 'Maptale · 3D-Reiseflug',
  robots: 'noindex',
}

export function registerPageRoutes(app: FastifyInstance): void {
  const db = app.deps.db
  const base = app.deps.config.baseUrl.replace(/\/+$/, '')
  const absolute = (path: string | null): string | null =>
    path ? (path.startsWith('http') ? path : base + path) : null

  /**
   * `/@henrik` — die Profilseite mit ihrem eigenen Kopf.
   *
   * Der Handle wird gegen `HANDLE_PATTERN` geprüft, bevor irgendetwas anderes
   * passiert: Unter `/@` darf nur landen, was auch ein Handle sein könnte.
   */
  app.get<{ Params: { handle: string } }>('/@:handle', async (request, reply) => {
    const raw = request.params.handle
    const html = await app.pages.page('profil.html').catch((error) => {
      app.log.error(error, 'profil.html nicht abrufbar')
      return null
    })
    // Ohne die gebaute Seite kann der Server hier nichts liefern, was ein
    // Browser gebrauchen könnte — Nginx hat sie, also dorthin zurück.
    if (html === null) return reply.code(502).send('Seite gerade nicht verfügbar')

    reply.type('text/html; charset=utf-8')
    // Wie beim statischen Weg: Der Kopf hängt an Daten, die sich ändern können,
    // also darf ihn niemand über einen Deploy hinweg behalten.
    reply.header('cache-control', 'no-cache')

    const handle = decodeURIComponent(raw)
    const userId = HANDLE_PATTERN.test(handle) ? app.auth.userIdForHandle(handle) : null
    const profile2 = userId ? app.auth.profile(userId) : null
    // Unbekannt: 404 mit der Seite, die clientseitig „nicht gefunden" zeigt.
    // Kein Soft-404 (Status 200 auf eine Seite ohne Inhalt) — das belügt
    // Browser wie Suchmaschinen.
    if (!userId || !profile2) return reply.code(404).send(setMeta(html, SILENT))
    if (profile2.visibility !== 'public') return reply.send(setMeta(html, SILENT))

    const name = profile2.displayName?.trim() || profile2.handle || handle
    const row = db.prepare('SELECT search_indexing FROM users WHERE id = ?').get(userId) as
      { search_indexing: number } | undefined
    const image =
      bannerUrl(userId, profile2.banner) ?? `/titelbilder/${defaultBanner(profile2.handle)}`

    return reply.send(
      setMeta(html, {
        title: `${name} · Maptale`,
        robots: row?.search_indexing ? 'index' : 'noindex',
        // Die Bio, wenn es eine gibt — sonst ein Satz, der wenigstens sagt,
        // was einen erwartet. Eine leere Beschreibung wäre die dritte Variante
        // und die einzige, die dem Leser nichts gibt.
        description:
          buildDescription(profile2.bio) ??
          `Die Reisen von ${name} auf Maptale, als 3D-Kamerafahrt über die echte Strecke.`,
        url: `${base}/@${profile2.handle ?? handle}`,
        image: absolute(image),
        imageAlt: `Titelbild von ${name}`,
        // `profile` und nicht `website`: Es geht um eine Person, und einige
        // Dienste stellen die Karte dann anders dar.
        ogType: 'profile',
      }),
    )
  })

  /**
   * `/tour/t_9fK4mHx2QbVnRs` — der Player mit dem Kopf DIESER Tour.
   *
   * Derselbe Schritt wie beim Profil, mit einer eigenen Sichtbarkeitsregel:
   *
   * - `public` → `index`. Eine Tour öffentlich zu stellen heißt, sie in die
   *   Galerie zu hängen; sie dort zu finden, aber nicht über eine Suche, wäre
   *   eine Unterscheidung ohne Unterschied. (Beim PROFIL ist das anders — dort
   *   hängt ein Name an der Adresse, deshalb der eigene Schalter.)
   * - `unlisted` → `noindex`, aber MIT Vorschaukarte. Genau dafür gibt es die
   *   Stufe: „jeder mit dem Link, sonst niemand". Ein ungelisteter Link, der
   *   über die Karte in den Index rutschte, wäre der Bruch, den sie verhindern
   *   soll.
   * - `private` → verschwiegener Kopf. Für den Besitzer mit 200 (er soll seine
   *   Tour ansehen können), für alle anderen mit 404 — dieselbe Linie wie in
   *   der API, wo private Touren von nicht existierenden ununterscheidbar sind.
   *
   * Die mitgelieferten Touren (`/tour/kohphangan`) kennt der Server nicht; sie
   * bekommen den Kopf, der im gebauten `erlebnis.html` steht. Sie hier
   * nachzubilden hieße, `src/tours.ts` ein zweites Mal zu führen — für drei
   * Demo-Fahrten, die von der Landing verlinkt sind und deren Inhalt dort
   * steht.
   */
  app.get<{ Params: { id: string } }>('/tour/:id', async (request, reply) => {
    const html = await app.pages.page('erlebnis.html').catch((error) => {
      app.log.error(error, 'erlebnis.html nicht abrufbar')
      return null
    })
    if (html === null) return reply.code(502).send('Seite gerade nicht verfügbar')
    reply.type('text/html; charset=utf-8')
    reply.header('cache-control', 'no-cache')

    const id = decodeURIComponent(request.params.id)
    // Nur Server-Kennungen; alles andere ist eine mitgelieferte Tour und
    // behält den Kopf aus dem Build (der ein `noindex` trägt).
    if (!/^t_[A-Za-z0-9_-]+$/.test(id)) return reply.send(html)

    const tour = db
      .prepare(
        `SELECT t.id, t.title, t.description, t.visibility, t.status, t.cover, t.owner_id, t.stats_json
         FROM tours t WHERE t.id = ?`,
      )
      .get(id) as
      | {
          id: string
          title: string | null
          description: string | null
          visibility: string
          status: string
          cover: string | null
          owner_id: string
          stats_json: string | null
        }
      | undefined

    const isOwner = !!request.user && tour?.owner_id === request.user.id
    if (!tour || (tour.visibility === 'private' && !isOwner)) {
      return reply.code(404).send(setMeta(html, SILENT_TOUR))
    }
    if (tour.visibility === 'private') return reply.send(setMeta(html, SILENT_TOUR))

    const titleText = tour.title?.trim() || 'Eine Reise'
    const km = ((): number | null => {
      const value = tour.stats_json ? (JSON.parse(tour.stats_json) as { km?: number }).km : null
      return typeof value === 'number' && value >= 0.1 ? value : null
    })()
    return reply.send(
      setMeta(html, {
        title: `${titleText} · Maptale`,
        // Nur `public` in den Index — `unlisted` behält die Karte und bleibt
        // aus der Suche. Ein `ready`-Status gehört dazu: Eine Tour in der
        // Verarbeitung hat noch keinen Inhalt, den man indexieren könnte.
        robots: tour.visibility === 'public' && tour.status === 'ready' ? 'index' : 'noindex',
        description:
          buildDescription(tour.description) ??
          `${titleText}${km === null ? '' : ` · ${km.toFixed(1).replace('.', ',')} km`}, als 3D-Kamerafahrt über die echte Strecke.`,
        url: `${base}/tour/${tour.id}`,
        // Die Anzeigefassung (w1920), nicht die Kachel: Die Karte im Chat wird
        // breit dargestellt, ein 480er Vorschaubild sähe dort matschig aus.
        image: absolute(tour.cover) ?? `${base}/og/maptale.jpg`,
        imageAlt: `Titelbild der Tour ${titleText}`,
      }),
    )
  })

  /**
   * Die Sitemap der Profile — getrennt von der statischen `sitemap.xml`.
   *
   * Zwei Dateien statt einer, weil sie verschiedener Herkunft sind: Die eine
   * liegt im Build und ändert sich mit ihm, die andere entsteht aus der
   * Datenbank und ändert sich, sobald jemand einen Schalter umlegt. Die
   * robots.txt nennt beide — mehrere `Sitemap:`-Zeilen sind vorgesehen und
   * billiger als eine Index-Datei, die nur zwei Einträge hätte.
   *
   * Gelistet wird genau, was auch `index` bekommt. Liefe das auseinander,
   * stünde in der Sitemap eine Einladung, der die Seite selbst widerspricht.
   */
  app.get('/sitemap-profile.xml', async (_request, reply) => {
    const rows = db
      .prepare(
        `SELECT handle FROM users
         WHERE search_indexing = 1 AND profile_visibility = 'public' AND handle IS NOT NULL
         ORDER BY handle`,
      )
      .all() as Array<{ handle: string }>
    return sendSitemap(
      reply,
      rows.map((z) => `${base}/@${z.handle}`),
    )
  })

  /**
   * Die Sitemap der Touren — dieselbe Regel wie im Kopf: nur `public`.
   *
   * Eigene Datei neben der Profil-Sitemap, weil beide getrennt zu sehen sind,
   * was sich lohnt, sobald man in der Search Console nachschaut, welche Gruppe
   * tatsächlich aufgenommen wurde.
   */
  app.get('/sitemap-touren.xml', async (_request, reply) => {
    const rows = db
      .prepare(
        `SELECT id FROM tours WHERE visibility = 'public' AND status = 'ready' ORDER BY created_at DESC`,
      )
      .all() as Array<{ id: string }>
    return sendSitemap(
      reply,
      rows.map((z) => `${base}/tour/${z.id}`),
    )
  })
}

/** Eine Sitemap aus fertigen Adressen — beide Routen schreiben dasselbe XML. */
function sendSitemap(reply: FastifyReply, urls: string[]): FastifyReply {
  reply.type('application/xml; charset=utf-8')
  // Eine Stunde: Die Liste ändert sich, wenn jemand einen Schalter umlegt oder
  // eine Tour veröffentlicht — beides eilt nicht, aber täglich wäre zu träge.
  reply.header('cache-control', 'public, max-age=3600')
  return reply.send(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
      .map((a) => `  <url><loc>${a}</loc></url>`)
      .join('\n')}\n</urlset>\n`,
  )
}
