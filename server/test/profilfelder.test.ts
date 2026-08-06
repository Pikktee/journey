// Profilfelder: Ort, Website, Instagram, Titelbild und die Kennzahlen.
//
// Die Kennzahlen sind der Punkt mit Folgen: Sie zählen NUR öffentliche Touren.
// Eine Zahl, die private Fahrten mitsummiert, verrät sie — „12 Touren" neben
// drei sichtbaren Karten ist eine Auskunft über die anderen neun.
import { describe, expect, it } from 'vitest'
import { istTitelbildVorschlag, nacktesInstagram, nacktesWeb, titelbildUrl } from '../src/profilfelder.js'
import { baueTestApp, type TestUmgebung } from './helfer.js'

async function patch(u: TestUmgebung, payload: Record<string, unknown>) {
  return u.app.inject({ method: 'PATCH', url: '/api/auth/me/profil', cookies: u.cookies, payload })
}

async function meinProfil(u: TestUmgebung): Promise<Record<string, unknown>> {
  const antwort = await u.app.inject({ method: 'GET', url: '/api/auth/me', cookies: u.cookies })
  return (antwort.json() as { profil: Record<string, unknown> }).profil
}

function nutzerId(u: TestUmgebung): string {
  return (u.app.deps.db.prepare('SELECT id FROM users LIMIT 1').get() as { id: string }).id
}

/** Fertige Tour mit gesetzten Kennzahlen — die Pipeline läuft dafür nicht. */
function legeFertigeTourAn(u: TestUmgebung, id: string, km: number, hm: number, sichtbarkeit = 'public'): void {
  u.app.deps.db
    .prepare(
      `INSERT INTO tours (id, owner_id, no, status, visibility, stats_json, created_at, updated_at)
       VALUES (?, ?, 1, 'bereit', ?, ?, '2026-01-01', '2026-01-01')`,
    )
    .run(id, nutzerId(u), sichtbarkeit, JSON.stringify({ km, gainM: hm }))
}

describe('nacktesWeb', () => {
  it('streift Schema, www und den Schrägstrich am Ende ab', () => {
    expect(nacktesWeb('https://henrikheil.net/')).toBe('henrikheil.net')
    expect(nacktesWeb('http://www.henrikheil.net')).toBe('henrikheil.net')
    expect(nacktesWeb('  henrikheil.net  ')).toBe('henrikheil.net')
  })

  it('behält einen Pfad — wer auf eine Unterseite zeigt, meint sie', () => {
    expect(nacktesWeb('https://henrikheil.net/reisen')).toBe('henrikheil.net/reisen')
  })

  it('verwirft, was keine Adresse ist, statt es zu raten', () => {
    // Ein halb geratener Link führt ins Leere, und das merkt erst der Leser
    expect(nacktesWeb('kein link')).toBeNull()
    expect(nacktesWeb('henrikheil')).toBeNull()
    expect(nacktesWeb('')).toBeNull()
  })
})

describe('nacktesInstagram', () => {
  it('nimmt @, nackt und die ganze Profil-Adresse', () => {
    expect(nacktesInstagram('@henrik.unterwegs')).toBe('henrik.unterwegs')
    expect(nacktesInstagram('henrik.unterwegs')).toBe('henrik.unterwegs')
    expect(nacktesInstagram('https://www.instagram.com/henrik.unterwegs/')).toBe('henrik.unterwegs')
  })

  it('lehnt ab, was kein Instagram-Name sein kann', () => {
    expect(nacktesInstagram('henrik unterwegs')).toBeNull()
    expect(nacktesInstagram('x'.repeat(31))).toBeNull()
    expect(nacktesInstagram('')).toBeNull()
  })
})

describe('titelbildUrl', () => {
  it('unterscheidet Vorschlag und eigenes Bild am Schrägstrich', () => {
    expect(titelbildUrl('u_1', 'serpentinen.jpg')).toBe('/titelbilder/serpentinen.jpg')
    expect(titelbildUrl('u_1', 'titelbild/123.jpg')).toBe('/api/benutzer/u_1/titelbild?v=titelbild%2F123.jpg')
    expect(titelbildUrl('u_1', null)).toBeNull()
  })

  it('lässt keinen Pfad als Vorschlag durch', () => {
    // Der Wert landet in einer URL — ein `../` darin wäre ein Ausbruch
    expect(istTitelbildVorschlag('serpentinen.jpg')).toBe(true)
    expect(istTitelbildVorschlag('../../etc/passwd')).toBe(false)
    expect(istTitelbildVorschlag('unter/ordner.jpg')).toBe(false)
    expect(istTitelbildVorschlag('script.js')).toBe(false)
  })
})

describe('Profilfelder über die API', () => {
  it('speichert Ort, Website und Instagram in nackter Form', async () => {
    const u = await baueTestApp()
    await patch(u, { ort: 'Frankfurt am Main', website: 'https://henrikheil.net/', instagram: '@henrik.unterwegs' })
    expect(await meinProfil(u)).toMatchObject({
      ort: 'Frankfurt am Main',
      website: 'henrikheil.net',
      instagram: 'henrik.unterwegs',
    })
  })

  it('macht aus einer unbrauchbaren Adresse ein leeres Feld, keinen Fehler', async () => {
    // Ein 400 mitten im Speichern des ganzen Profils hielte auch alles andere
    // auf; ein leeres Feld sieht man dagegen sofort.
    const u = await baueTestApp()
    expect((await patch(u, { website: 'kein link' })).statusCode).toBe(200)
    expect(await meinProfil(u)).toMatchObject({ website: null })
  })

  it('nimmt ein mitgeliefertes Titelbild an und weist alles andere ab', async () => {
    const u = await baueTestApp()
    expect((await patch(u, { titelbild: 'serpentinen.jpg' })).statusCode).toBe(200)
    expect(await meinProfil(u)).toMatchObject({ titelbildUrl: '/titelbilder/serpentinen.jpg' })
    expect((await patch(u, { titelbild: '../geheim.jpg' })).statusCode).toBe(400)
    // '' entfernt es wieder
    expect((await patch(u, { titelbild: '' })).statusCode).toBe(200)
    expect(await meinProfil(u)).toMatchObject({ titelbild: null, titelbildUrl: null })
  })
})

describe('Eigenes Titelbild', () => {
  async function ladeHoch(u: TestUmgebung, inhalt = 'fake-jpeg') {
    return u.app.inject({
      method: 'PUT',
      url: '/api/auth/me/titelbild',
      cookies: u.cookies,
      headers: { 'content-type': 'image/jpeg' },
      payload: Buffer.from(inhalt),
    })
  }

  it('wird hochgeladen und ist ohne Anmeldung abrufbar', async () => {
    const u = await baueTestApp()
    const hoch = await ladeHoch(u)
    expect(hoch.statusCode).toBe(200)
    const url = (hoch.json() as { titelbildUrl: string }).titelbildUrl
    const abruf = await u.app.inject({ method: 'GET', url })
    expect(abruf.statusCode).toBe(200)
    expect(abruf.headers['cache-control']).toContain('immutable')
    expect(abruf.rawPayload.toString()).toBe('fake-jpeg')
  })

  it('räumt das vorherige Bild weg', async () => {
    const u = await baueTestApp()
    await ladeHoch(u, 'alt')
    await new Promise((r) => setTimeout(r, 2))
    await ladeHoch(u, 'neu')
    expect(await u.benutzerStorage.listeDateien(nutzerId(u), 'titelbild')).toHaveLength(1)
  })

  it('räumt es auch weg, wenn danach ein Vorschlag gewählt wird', async () => {
    // Sonst bliebe die Datei unerreichbar auf der Platte liegen
    const u = await baueTestApp()
    await ladeHoch(u)
    await patch(u, { titelbild: 'kueste.jpg' })
    expect(await u.benutzerStorage.listeDateien(nutzerId(u), 'titelbild')).toHaveLength(0)
  })

  it('liefert einen Vorschlag NICHT über die API aus', async () => {
    // Der liegt als statische Datei im Build und geht nie durch den Server
    const u = await baueTestApp()
    await patch(u, { titelbild: 'kueste.jpg' })
    const abruf = await u.app.inject({ method: 'GET', url: `/api/benutzer/${nutzerId(u)}/titelbild` })
    expect(abruf.statusCode).toBe(404)
  })

  it('lässt sich entfernen', async () => {
    const u = await baueTestApp()
    await ladeHoch(u)
    expect((await u.app.inject({ method: 'DELETE', url: '/api/auth/me/titelbild', cookies: u.cookies })).statusCode).toBe(200)
    expect(await meinProfil(u)).toMatchObject({ titelbildUrl: null })
  })
})

describe('Kennzahlen', () => {
  it('summiert nur öffentliche, fertige Touren', async () => {
    const u = await baueTestApp()
    legeFertigeTourAn(u, 't_oeff1', 12.4, 300)
    legeFertigeTourAn(u, 't_oeff2', 6.6, 140)
    legeFertigeTourAn(u, 't_privat', 999, 9999, 'private')
    legeFertigeTourAn(u, 't_link', 888, 8888, 'unlisted')
    expect(u.app.auth.kennzahlen(nutzerId(u))).toEqual({ touren: 2, km: 19, hm: 440 })
  })

  it('zählt eine Tour ohne Statistik mit, aber mit null Kilometern', async () => {
    const u = await baueTestApp()
    u.app.deps.db
      .prepare(
        `INSERT INTO tours (id, owner_id, no, status, visibility, created_at, updated_at)
         VALUES ('t_ohne', ?, 1, 'bereit', 'public', '2026-01-01', '2026-01-01')`,
      )
      .run(nutzerId(u))
    expect(u.app.auth.kennzahlen(nutzerId(u))).toEqual({ touren: 1, km: 0, hm: 0 })
  })

  it('steht ohne Touren auf null', async () => {
    const u = await baueTestApp()
    expect(u.app.auth.kennzahlen(nutzerId(u))).toEqual({ touren: 0, km: 0, hm: 0 })
  })

  it('erscheint in der öffentlichen Profilantwort', async () => {
    const u = await baueTestApp()
    await patch(u, { anzeigename: 'Reisende', sichtbarkeit: 'public' })
    legeFertigeTourAn(u, 't_1', 10, 100)
    legeFertigeTourAn(u, 't_2', 5, 50, 'private')
    const antwort = await u.app.inject({ method: 'GET', url: '/api/benutzer/test/profil' })
    expect((antwort.json() as { kennzahlen: unknown }).kennzahlen).toEqual({ touren: 1, km: 10, hm: 100 })
  })
})

describe('Eigenes Profil, solange es privat ist', () => {
  it('bleibt für den Besitzer erreichbar — sonst führte der Weg zum Schalter durch eine 404', async () => {
    const u = await baueTestApp()
    await patch(u, { anzeigename: 'Reisende' })
    const antwort = await u.app.inject({ method: 'GET', url: '/api/benutzer/test/profil', cookies: u.cookies })
    expect(antwort.statusCode).toBe(200)
    expect((antwort.json() as { nurFuerDich: boolean }).nurFuerDich).toBe(true)
  })

  it('bleibt für alle anderen ein 404', async () => {
    const u = await baueTestApp()
    await patch(u, { anzeigename: 'Reisende' })
    expect((await u.app.inject({ method: 'GET', url: '/api/benutzer/test/profil' })).statusCode).toBe(404)
  })

  it('meldet beim öffentlichen Profil nurFuerDich falsch', async () => {
    const u = await baueTestApp()
    await patch(u, { anzeigename: 'Reisende', sichtbarkeit: 'public' })
    const antwort = await u.app.inject({ method: 'GET', url: '/api/benutzer/test/profil', cookies: u.cookies })
    expect((antwort.json() as { nurFuerDich: boolean }).nurFuerDich).toBe(false)
  })
})

describe('Profilantwort', () => {
  it('nennt Ort, Links, Titelbild und den Beitritt', async () => {
    const u = await baueTestApp()
    await patch(u, {
      anzeigename: 'Reisende',
      sichtbarkeit: 'public',
      ort: 'Frankfurt am Main',
      website: 'henrikheil.net',
      instagram: 'henrik.unterwegs',
      titelbild: 'wueste.jpg',
    })
    const daten = (await u.app.inject({ method: 'GET', url: '/api/benutzer/test/profil' })).json() as Record<string, unknown>
    expect(daten).toMatchObject({
      handle: 'test',
      anzeigename: 'Reisende',
      ort: 'Frankfurt am Main',
      website: 'henrikheil.net',
      instagram: 'henrik.unterwegs',
      titelbildUrl: '/titelbilder/wueste.jpg',
    })
    expect(typeof daten.dabeiSeit).toBe('string')
  })
})
