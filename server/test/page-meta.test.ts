// Die Seiten, die der Server selbst beantwortet: `/@handle` und die Sitemap
// der Profile.
//
// Was hier schiefgehen kann, fällt sonst NIE auf: Ein Profil, das in den Index
// gerät, obwohl niemand das wollte, meldet sich nicht — es steht eines Tages in
// einer Suche. Und ein Meta-Kopf, der den Namen einer Person nennt, deren
// Profil privat ist, sieht im Browser völlig normal aus.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PageSource, buildDescription, buildMeta, setMeta } from '../src/page-meta.js'
import { BANNER_FILES, defaultBanner } from '../src/profile-banners.js'
import { TEST_PROFIL_HTML, baueTestApp, beispielManifest } from './helfer.js'

const wurzel = join(dirname(fileURLToPath(import.meta.url)), '../..')

/** Zweite Person mit gesetztem Handle und öffentlichem Profil. */
async function legeProfilAn(
  u: Awaited<ReturnType<typeof baueTestApp>>,
  opts: { handle: string; name?: string; bio?: string; oeffentlich?: boolean; suche?: boolean },
): Promise<string> {
  const id = (
    await u.app.auth.createUser(`${opts.handle}@example.com`, 'geheim123', opts.name ?? 'Wer')
  ).id
  u.app.auth.setHandle(id, opts.handle)
  u.app.auth.setProfile(id, {
    // Nur übergeben, was gesetzt werden soll: `setzeProfil` deutet einen
    // leeren Wert als „Feld leeren" und verträgt kein null.
    ...(opts.name ? { displayName: opts.name } : {}),
    ...(opts.bio ? { bio: opts.bio } : {}),
    visibility: opts.oeffentlich === false ? 'private' : 'public',
  })
  if (opts.suche) u.app.deps.db.prepare('UPDATE users SET search_indexing = 1 WHERE id = ?').run(id)
  return id
}

describe('Meta-Block', () => {
  it('ersetzt nur, was zwischen den Markern steht', () => {
    const html = setMeta(TEST_PROFIL_HTML, { title: 'Anna · Maptale', robots: 'index' })
    expect(html).toContain('<title>Anna · Maptale</title>')
    expect(html).toContain('content="index"')
    expect(html).not.toContain('Profil · Maptale')
    // Der Rest der Seite muss unangetastet bleiben — dort stehen die gehashten
    // Asset-Verweise, die der Server nicht kennt und nicht kennen soll.
    expect(html).toContain('/assets/profil-abc123.css')
    expect(html).toContain('<body>Profil</body>')
  })

  it('reicht eine Seite ohne Marker unverändert durch', () => {
    // Schlechter Kopf ist besser als weiße Seite.
    const roh = '<html><head><title>Alt</title></head></html>'
    expect(setMeta(roh, { title: 'Neu', robots: 'index' })).toBe(roh)
  })

  it('entschärft, was aus der Datenbank kommt', () => {
    // Ein Anzeigename ist Freitext. Ohne Escaping bräche er aus dem Attribut
    // aus — und der Meta-Kopf steht ganz oben in jeder Antwort.
    const meta = buildMeta({ title: 'Anna " /><script>alert(1)</script>', robots: 'noindex' })
    expect(meta).not.toContain('<script>')
    expect(meta).toContain('&quot;')
  })

  it('kürzt die Beschreibung an der Wortgrenze', () => {
    expect(buildDescription('  mehrzeilig\n  mit   Lücken ')).toBe('mehrzeilig mit Lücken')
    expect(buildDescription(null)).toBeNull()
    expect(buildDescription('   ')).toBeNull()
    const lang = buildDescription('abcde '.repeat(60), 40)
    expect(lang?.length).toBeLessThanOrEqual(41)
    expect(lang?.endsWith('…')).toBe(true)
    expect(lang).not.toContain('  ')
  })
})

describe('SeitenQuelle', () => {
  it('holt einmal und liefert danach aus dem Speicher', async () => {
    let abrufe = 0
    const quelle = new PageSource({ webUrl: 'https://web.test/' }, async (url) => {
      abrufe++
      return `<i>${url}</i>`
    })
    expect(await quelle.page('profil.html')).toBe('<i>https://web.test/profil.html</i>')
    await quelle.page('profil.html')
    expect(abrufe).toBe(1)
  })

  it('bündelt gleichzeitige Anfragen zu einem Abruf', async () => {
    // Sonst schickt ein Ansturm nach Cache-Ablauf ebenso viele Anfragen an
    // Nginx zurück, wie gerade Leser da sind.
    let abrufe = 0
    const quelle = new PageSource({ webUrl: 'https://web.test' }, async () => {
      abrufe++
      await new Promise((r) => setTimeout(r, 5))
      return 'x'
    })
    await Promise.all([quelle.page('a.html'), quelle.page('a.html'), quelle.page('a.html')])
    expect(abrufe).toBe(1)
  })

  it('hält die letzte Fassung, wenn der Abruf scheitert', async () => {
    // Ein kurzer Nginx-Aussetzer soll nicht jede Profilseite mitreißen.
    let zaehler = 0
    let uhr = 1000
    const quelle = new PageSource(
      { webUrl: 'https://web.test' },
      async () => {
        if (++zaehler > 1) throw new Error('weg')
        return 'alt'
      },
      () => uhr,
    )
    expect(await quelle.page('a.html')).toBe('alt')
    uhr += 10 * 60 * 1000
    expect(await quelle.page('a.html')).toBe('alt')
  })

  it('meldet den Fehler, solange es nichts Altes gibt', async () => {
    const quelle = new PageSource({ webUrl: 'https://web.test' }, async () => {
      throw new Error('weg')
    })
    await expect(quelle.page('a.html')).rejects.toThrow('weg')
  })
})

describe('GET /@handle', () => {
  it('setzt Titel, Beschreibung und Bild eines öffentlichen Profils', async () => {
    const u = await baueTestApp()
    await legeProfilAn(u, { handle: 'anna', name: 'Anna Reisend', bio: 'Unterwegs mit dem Rad.' })
    const a = await u.app.inject({ method: 'GET', url: '/@anna' })
    expect(a.statusCode).toBe(200)
    expect(a.headers['content-type']).toContain('text/html')
    expect(a.body).toContain('<title>Anna Reisend · Maptale</title>')
    expect(a.body).toContain('content="Unterwegs mit dem Rad."')
    expect(a.body).toContain('<link rel="canonical" href="http://localhost:5173/@anna" />')
    expect(a.body).toContain('property="og:type" content="profile"')
    expect(a.body).toContain('name="twitter:card"')
    // Absolut, nicht relativ: Kein Dienst löst `/titelbilder/…` auf.
    expect(a.body).toMatch(/og:image" content="http:\/\/localhost:5173\/titelbilder\//)
  })

  it('lässt ein öffentliches Profil nur mit Schalter in den Index', async () => {
    // Die Kernregel dieser Etappe: Über den Link erreichbar zu sein ist etwas
    // anderes, als unter dem eigenen Namen auffindbar zu sein.
    const u = await baueTestApp()
    await legeProfilAn(u, { handle: 'ohne' })
    await legeProfilAn(u, { handle: 'mit', suche: true })
    expect((await u.app.inject({ method: 'GET', url: '/@ohne' })).body).toContain(
      'content="noindex"',
    )
    expect((await u.app.inject({ method: 'GET', url: '/@mit' })).body).toContain('content="index"')
  })

  it('indexiert ein privates Profil auch mit Schalter nicht — und verrät nichts', async () => {
    const u = await baueTestApp()
    await legeProfilAn(u, {
      handle: 'still',
      name: 'Geheime Person',
      oeffentlich: false,
      suche: true,
    })
    const a = await u.app.inject({ method: 'GET', url: '/@still' })
    expect(a.statusCode).toBe(200)
    expect(a.body).toContain('content="noindex"')
    // Der Meta-Kopf ist für jeden im Quelltext lesbar; ein `noindex` verbirgt
    // ihn vor Suchmaschinen, nicht vor Menschen.
    expect(a.body).not.toContain('Geheime Person')
    expect(a.body).toContain('<title>Profil · Maptale</title>')
  })

  it('antwortet auf einen unbekannten Handle mit 404 statt Soft-404', async () => {
    const u = await baueTestApp()
    const a = await u.app.inject({ method: 'GET', url: '/@niemand' })
    expect(a.statusCode).toBe(404)
    expect(a.body).toContain('content="noindex"')
  })

  it('fällt auf einen Satz zurück, wenn es keine Bio gibt', async () => {
    const u = await baueTestApp()
    await legeProfilAn(u, { handle: 'karg', name: 'Karg' })
    expect((await u.app.inject({ method: 'GET', url: '/@karg' })).body).toContain(
      'Die Reisen von Karg',
    )
  })

  it('weist einen Handle ab, der keiner sein kann', async () => {
    // Unter /@ darf nur landen, was die Handle-Regeln erlauben — sonst wäre
    // die Route ein Eingang für alles, was jemand hinter das @ schreibt.
    const u = await baueTestApp()
    const a = await u.app.inject({ method: 'GET', url: '/@' + encodeURIComponent('../../etc') })
    expect(a.statusCode).toBe(404)
  })
})

describe('GET /tour/<kennung>', () => {
  /** Tour anlegen und in einen Zustand bringen, den die Seite beschreiben kann. */
  async function createTour(
    u: Awaited<ReturnType<typeof baueTestApp>>,
    opts: { sicht?: 'private' | 'unlisted' | 'public'; title?: string; text?: string } = {},
  ): Promise<string> {
    const a = await u.app.inject({
      method: 'POST',
      url: '/api/tours',
      cookies: u.cookies,
      // Eigene clientTourId je Tour: Der Server dedupliziert darüber, sonst
      // wäre die zweite Tour dieselbe wie die erste.
      payload: {
        ...beispielManifest(),
        clientTourId: `ct-${opts.title ?? 'a'}-${opts.sicht ?? 'p'}`,
      },
    })
    const id = (a.json() as { id: string }).id
    u.app.deps.db
      .prepare(
        `UPDATE tours SET visibility = ?, status = 'ready', title = ?, description = ?, cover = ? WHERE id = ?`,
      )
      .run(
        opts.sicht ?? 'public',
        opts.title ?? 'Runde bei Lauterbrunnen',
        opts.text ?? null,
        `/api/media/${id}/m1.w1920.jpg`,
        id,
      )
    return id
  }

  it('setzt Titel, Beschreibung und Titelbild einer öffentlichen Tour', async () => {
    const u = await baueTestApp()
    const id = await createTour(u, { title: 'Über den Pass', text: 'Sechs Stunden bergauf.' })
    const a = await u.app.inject({ method: 'GET', url: `/tour/${id}` })
    expect(a.statusCode).toBe(200)
    expect(a.body).toContain('<title>Über den Pass · Maptale</title>')
    expect(a.body).toContain('content="Sechs Stunden bergauf."')
    expect(a.body).toContain('content="index"')
    expect(a.body).toContain(`og:url" content="http://localhost:5173/tour/${id}"`)
    // Die Anzeigefassung, nicht die 480er Kachel — die Karte wird breit gezeigt.
    expect(a.body).toContain(
      `og:image" content="http://localhost:5173/api/media/${id}/m1.w1920.jpg"`,
    )
  })

  it('hält eine ungelistete Tour aus dem Index, gibt ihr aber eine Karte', async () => {
    // Der Kern der Stufe: „jeder mit dem Link, sonst niemand". Ein Suchtreffer
    // bräche das, eine Vorschaukarte im Chat ist genau ihr Zweck.
    const u = await baueTestApp()
    const id = await createTour(u, { sicht: 'unlisted', title: 'Nur für Freunde' })
    const a = await u.app.inject({ method: 'GET', url: `/tour/${id}` })
    expect(a.body).toContain('content="noindex"')
    expect(a.body).toContain('<title>Nur für Freunde · Maptale</title>')
    expect(a.body).toContain('name="twitter:card"')
  })

  it('verrät eine private Tour nicht — außer ihrem Besitzer', async () => {
    const u = await baueTestApp()
    const id = await createTour(u, { sicht: 'private', title: 'Geheime Runde' })
    const fremd = await u.app.inject({ method: 'GET', url: `/tour/${id}` })
    expect(fremd.statusCode).toBe(404)
    expect(fremd.body).not.toContain('Geheime Runde')
    // Der Besitzer bekommt die Seite (er soll seine Tour ansehen können) —
    // aber auch er braucht im Kopf keinen Titel, den niemand sehen darf.
    const eigen = await u.app.inject({ method: 'GET', url: `/tour/${id}`, cookies: u.cookies })
    expect(eigen.statusCode).toBe(200)
    expect(eigen.body).toContain('content="noindex"')
    expect(eigen.body).not.toContain('Geheime Runde')
  })

  it('reicht die mitgelieferten Touren unverändert durch', async () => {
    // `/tour/kohphangan` steht in src/tours.ts, nicht in der Datenbank. Die
    // Liste hier ein zweites Mal zu führen, wäre die nächste Kopie.
    const u = await baueTestApp()
    const a = await u.app.inject({ method: 'GET', url: '/tour/kohphangan' })
    expect(a.statusCode).toBe(200)
    expect(a.body).toContain('content="noindex"')
  })

  it('antwortet auf eine unbekannte Kennung mit 404', async () => {
    const u = await baueTestApp()
    expect((await u.app.inject({ method: 'GET', url: '/tour/t_gibtsnicht' })).statusCode).toBe(404)
  })

  it('lässt eine Tour in Verarbeitung nicht in den Index', async () => {
    // Sie hat noch keinen Inhalt, den man indexieren könnte.
    const u = await baueTestApp()
    const id = await createTour(u)
    u.app.deps.db.prepare(`UPDATE tours SET status = 'processing' WHERE id = ?`).run(id)
    expect((await u.app.inject({ method: 'GET', url: `/tour/${id}` })).body).toContain(
      'content="noindex"',
    )
  })
})

describe('GET /sitemap-touren.xml', () => {
  it('listet nur öffentliche, fertige Touren', async () => {
    const u = await baueTestApp()
    const anlegen = async (sicht: string, status: string): Promise<string> => {
      const a = await u.app.inject({
        method: 'POST',
        url: '/api/tours',
        cookies: u.cookies,
        payload: { ...beispielManifest(), clientTourId: `ct-${sicht}-${status}` },
      })
      const id = (a.json() as { id: string }).id
      u.app.deps.db
        .prepare('UPDATE tours SET visibility = ?, status = ? WHERE id = ?')
        .run(sicht, status, id)
      return id
    }
    const oeffentlich = await anlegen('public', 'ready')
    const ungelistet = await anlegen('unlisted', 'ready')
    const roh = await anlegen('public', 'processing')
    const a = await u.app.inject({ method: 'GET', url: '/sitemap-touren.xml' })
    expect(a.body).toContain(`<loc>http://localhost:5173/tour/${oeffentlich}</loc>`)
    expect(a.body).not.toContain(ungelistet)
    expect(a.body).not.toContain(roh)
  })
})

describe('GET /sitemap-profile.xml', () => {
  it('listet genau die Profile, die auch index bekommen', async () => {
    const u = await baueTestApp()
    await legeProfilAn(u, { handle: 'drin', suche: true })
    await legeProfilAn(u, { handle: 'ohneschalter' })
    await legeProfilAn(u, { handle: 'privat', oeffentlich: false, suche: true })
    const a = await u.app.inject({ method: 'GET', url: '/sitemap-profile.xml' })
    expect(a.statusCode).toBe(200)
    expect(a.headers['content-type']).toContain('xml')
    expect(a.body).toContain('<loc>http://localhost:5173/@drin</loc>')
    expect(a.body).not.toContain('ohneschalter')
    expect(a.body).not.toContain('@privat')
  })
})

describe('Schalter „In Suchmaschinen erscheinen"', () => {
  it('ist neu angelegt aus', async () => {
    const u = await baueTestApp()
    const me = await u.app.inject({ method: 'GET', url: '/api/auth/me', cookies: u.cookies })
    expect((me.json() as { profile: { searchIndexing: boolean } }).profile.searchIndexing).toBe(
      false,
    )
  })

  it('lässt sich setzen und wirkt sofort auf die Seite', async () => {
    const u = await baueTestApp()
    u.app.auth.setHandle(u.app.auth.userFromSession(u.cookies.maptale_session)!.id, 'testerin')
    u.app.auth.setProfile(u.app.auth.userFromSession(u.cookies.maptale_session)!.id, {
      visibility: 'public',
    })
    const setzen = await u.app.inject({
      method: 'POST',
      url: '/api/auth/me/search-indexing',
      cookies: u.cookies,
      payload: { enabled: true },
    })
    expect(setzen.statusCode).toBe(200)
    expect((setzen.json() as { effectPaused: boolean }).effectPaused).toBe(false)
    expect((await u.app.inject({ method: 'GET', url: '/@testerin' })).body).toContain(
      'content="index"',
    )
  })

  it('nimmt den Wunsch auch bei privatem Profil an, sagt aber dass er ruht', async () => {
    const u = await baueTestApp()
    const a = await u.app.inject({
      method: 'POST',
      url: '/api/auth/me/search-indexing',
      cookies: u.cookies,
      payload: { enabled: true },
    })
    expect(a.statusCode).toBe(200)
    expect((a.json() as { effectPaused: boolean }).effectPaused).toBe(true)
  })

  it('bleibt ohne Anmeldung verschlossen', async () => {
    const u = await baueTestApp()
    expect(
      (
        await u.app.inject({
          method: 'POST',
          url: '/api/auth/me/search-indexing',
          payload: { enabled: true },
        })
      ).statusCode,
    ).toBe(401)
  })
})

describe('Titelbilder', () => {
  it('hält die Server-Kopie deckungsgleich mit der Web-Fassung', () => {
    // Läuft sie auseinander, zeigt die Vorschaukarte im Chat ein anderes Bild
    // als das Banner auf der Seite — dieselbe Sorte stiller Fehler wie bei
    // handle.ts, deshalb dieselbe Sorte Wächter.
    const quelle = readFileSync(join(wurzel, 'src/profile/profile-banners.ts'), 'utf8')
    const dateien = [...quelle.matchAll(/file: '([^']+)'/g)].map((t) => t[1])
    expect(dateien).toEqual([...BANNER_FILES])
    // Und derselbe Streuwert: Ein anderer verteilte dieselben Handles anders.
    for (const handle of ['anna', 'henrik', 'a', '', 'zzz-lange-adresse']) {
      const web = quelle.includes('sum * 31')
      expect(web).toBe(true)
      expect(BANNER_FILES).toContain(defaultBanner(handle))
    }
  })
})
