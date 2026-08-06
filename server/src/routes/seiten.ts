/**
 * Die Seiten, die der Server selbst ausliefert — heute `/@handle`.
 *
 * Die Mechanik (gebautes HTML holen, Meta-Block ersetzen) steht in
 * [seiten.ts](../seiten.ts); hier steht nur, WAS im Kopf einer Profilseite
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
import type { FastifyInstance } from 'fastify'
import { HANDLE_REGELN } from '../handle.js'
import { titelbildUrl } from '../profilfelder.js'
import { type Metablock, alsBeschreibung, setzeMeta } from '../seiten.js'
import { standardTitelbild } from '../titelbilder.js'

/** Der Kopf, den jede Seite bekommt, über die nichts gesagt werden darf. */
const VERSCHWIEGEN: Metablock = {
  titel: 'Profil · Maptale',
  robots: 'noindex',
}

export function registriereSeitenRouten(app: FastifyInstance): void {
  const db = app.deps.db
  const basis = app.deps.konfig.basisUrl.replace(/\/+$/, '')
  const absolut = (pfad: string | null): string | null =>
    pfad ? (pfad.startsWith('http') ? pfad : basis + pfad) : null

  /**
   * `/@henrik` — die Profilseite mit ihrem eigenen Kopf.
   *
   * Der Handle wird gegen `HANDLE_REGELN` geprüft, bevor irgendetwas anderes
   * passiert: Unter `/@` darf nur landen, was auch ein Handle sein könnte.
   */
  app.get<{ Params: { handle: string } }>('/@:handle', async (request, reply) => {
    const roh = request.params.handle
    const html = await app.seiten.seite('profil.html').catch((fehler) => {
      app.log.error({ fehler }, 'profil.html nicht abrufbar')
      return null
    })
    // Ohne die gebaute Seite kann der Server hier nichts liefern, was ein
    // Browser gebrauchen könnte — Nginx hat sie, also dorthin zurück.
    if (html === null) return reply.code(502).send('Seite gerade nicht verfügbar')

    reply.type('text/html; charset=utf-8')
    // Wie beim statischen Weg: Der Kopf hängt an Daten, die sich ändern können,
    // also darf ihn niemand über einen Deploy hinweg behalten.
    reply.header('cache-control', 'no-cache')

    const handle = decodeURIComponent(roh)
    const userId = HANDLE_REGELN.test(handle) ? app.auth.benutzerIdFuerHandle(handle) : null
    const profil = userId ? app.auth.profil(userId) : null
    // Unbekannt: 404 mit der Seite, die clientseitig „nicht gefunden" zeigt.
    // Kein Soft-404 (Status 200 auf eine Seite ohne Inhalt) — das belügt
    // Browser wie Suchmaschinen.
    if (!userId || !profil) return reply.code(404).send(setzeMeta(html, VERSCHWIEGEN))
    if (profil.sichtbarkeit !== 'public') return reply.send(setzeMeta(html, VERSCHWIEGEN))

    const name = profil.anzeigename?.trim() || profil.handle || handle
    const zeile = db.prepare('SELECT suchmaschinen FROM users WHERE id = ?').get(userId) as
      | { suchmaschinen: number }
      | undefined
    const bild =
      titelbildUrl(userId, profil.titelbild) ?? `/titelbilder/${standardTitelbild(profil.handle)}`

    return reply.send(
      setzeMeta(html, {
        titel: `${name} · Maptale`,
        robots: zeile?.suchmaschinen ? 'index' : 'noindex',
        // Die Bio, wenn es eine gibt — sonst ein Satz, der wenigstens sagt,
        // was einen erwartet. Eine leere Beschreibung wäre die dritte Variante
        // und die einzige, die dem Leser nichts gibt.
        beschreibung:
          alsBeschreibung(profil.bio) ??
          `Die Reisen von ${name} auf Maptale — als 3D-Kamerafahrt über die echte Strecke.`,
        url: `${basis}/@${profil.handle ?? handle}`,
        bild: absolut(bild),
        bildAlt: `Titelbild von ${name}`,
        // `profile` und nicht `website`: Es geht um eine Person, und einige
        // Dienste stellen die Karte dann anders dar.
        ogTyp: 'profile',
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
    const zeilen = db
      .prepare(
        `SELECT handle FROM users
         WHERE suchmaschinen = 1 AND profil_sichtbarkeit = 'public' AND handle IS NOT NULL
         ORDER BY handle`,
      )
      .all() as Array<{ handle: string }>
    reply.type('application/xml; charset=utf-8')
    reply.header('cache-control', 'public, max-age=3600')
    return reply.send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${zeilen
        .map((z) => `  <url><loc>${basis}/@${z.handle}</loc></url>`)
        .join('\n')}\n</urlset>\n`,
    )
  })
}
