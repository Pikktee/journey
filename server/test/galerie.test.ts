// Öffentliche Galerie und Profilseite — beide ohne Anmeldung erreichbar,
// beide zeigen ausschließlich ausdrücklich Freigegebenes.
import { describe, expect, it } from 'vitest'
import { baueTestApp, beispielManifest, type TestUmgebung } from './helfer.js'

interface Karte {
  id: string
  titel: string | null
  cover: string | null
  km: number | null
  autor: { anzeigename: string; avatarUrl: string | null; id?: string } | null
}

async function legeTourAn(u: TestUmgebung, clientId = 'client-1'): Promise<string> {
  const manifest = { ...beispielManifest(), clientTourId: clientId }
  const angelegt = await u.app.inject({ method: 'POST', url: '/api/tours', cookies: u.cookies, payload: manifest })
  const id = (angelegt.json() as { id: string }).id
  await u.app.inject({
    method: 'PUT',
    url: `/api/tours/${id}/media/m1`,
    cookies: u.cookies,
    headers: { 'content-type': 'application/octet-stream' },
    payload: Buffer.from('fake-jpeg'),
  })
  await u.app.inject({ method: 'POST', url: `/api/tours/${id}/finalize`, cookies: u.cookies })
  await u.app.verarbeitungen.get(id)
  return id
}

async function veroeffentliche(u: TestUmgebung, tourId: string): Promise<void> {
  await u.app.inject({
    method: 'PATCH',
    url: `/api/tours/${tourId}`,
    cookies: u.cookies,
    payload: { visibility: 'public' },
  })
}

async function galerie(u: TestUmgebung, query = ''): Promise<{ touren: Karte[]; mehr: boolean }> {
  const antwort = await u.app.inject({ method: 'GET', url: `/api/galerie${query}` })
  expect(antwort.statusCode).toBe(200)
  return antwort.json() as { touren: Karte[]; mehr: boolean }
}

function nutzerId(u: TestUmgebung): string {
  return (u.app.deps.db.prepare('SELECT id FROM users LIMIT 1').get() as { id: string }).id
}

describe('Galerie', () => {
  it('zeigt nur öffentliche, fertige Touren', async () => {
    const u = await baueTestApp()
    const oeffentlich = await legeTourAn(u, 'c1')
    await legeTourAn(u, 'c2') // bleibt privat
    await veroeffentliche(u, oeffentlich)

    const { touren } = await galerie(u)
    expect(touren.map((t) => t.id)).toEqual([oeffentlich])
    expect(touren[0]?.cover).toBe(`/api/media/${oeffentlich}/m1.jpg`)
    expect(touren[0]?.km).toBeGreaterThan(9)
  })

  it('braucht keine Anmeldung', async () => {
    const u = await baueTestApp()
    await veroeffentliche(u, await legeTourAn(u))
    // galerie() ruft bewusst ohne Cookie ab — hier gilt das als Prüfung
    expect((await galerie(u)).touren).toHaveLength(1)
  })

  it('nennt den Urheber erst mit gesetztem Anzeigenamen', async () => {
    // Ohne ihn bleibt die Tour anonym — der Klarname aus der Registrierung
    // wird niemals ersatzweise gezeigt.
    const u = await baueTestApp()
    await veroeffentliche(u, await legeTourAn(u))
    expect((await galerie(u)).touren[0]?.autor).toBeNull()

    await u.app.inject({
      method: 'PATCH',
      url: '/api/auth/me/profil',
      cookies: u.cookies,
      payload: { anzeigename: 'Reisende' },
    })
    expect((await galerie(u)).touren[0]?.autor?.anzeigename).toBe('Reisende')
  })

  it('verlinkt die Profilseite nur, wenn es sie gibt', async () => {
    // Wer seine Touren zeigen, sich selbst aber nicht vorstellen will, kann das
    const u = await baueTestApp()
    await veroeffentliche(u, await legeTourAn(u))
    const patch = (payload: Record<string, unknown>) =>
      u.app.inject({ method: 'PATCH', url: '/api/auth/me/profil', cookies: u.cookies, payload })

    await patch({ anzeigename: 'Reisende' })
    expect((await galerie(u)).touren[0]?.autor?.id).toBeUndefined()

    await patch({ sichtbarkeit: 'public' })
    expect((await galerie(u)).touren[0]?.autor?.id).toBe(nutzerId(u))
  })

  it('blättert seitenweise', async () => {
    const u = await baueTestApp()
    for (const nr of [1, 2, 3]) await veroeffentliche(u, await legeTourAn(u, `c${nr}`))

    const erste = await galerie(u, '?limit=2')
    expect(erste.touren).toHaveLength(2)
    expect(erste.mehr).toBe(true)

    const zweite = await galerie(u, '?limit=2&offset=2')
    expect(zweite.touren).toHaveLength(1)
    expect(zweite.mehr).toBe(false)
    // Keine Tour taucht doppelt auf
    expect(new Set([...erste.touren, ...zweite.touren].map((t) => t.id)).size).toBe(3)
  })

  it('verkraftet unsinnige Blätter-Angaben', async () => {
    const u = await baueTestApp()
    await veroeffentliche(u, await legeTourAn(u))
    expect((await galerie(u, '?limit=-5&offset=-3')).touren).toHaveLength(1)
    expect((await galerie(u, '?limit=99999')).touren).toHaveLength(1)
    expect((await galerie(u, '?limit=abc')).touren).toHaveLength(1)
  })
})

describe('Öffentliche Profilseite', () => {
  it('zeigt Profil und öffentliche Touren', async () => {
    const u = await baueTestApp()
    const oeffentlich = await legeTourAn(u, 'c1')
    await legeTourAn(u, 'c2') // privat, gehört nicht auf die Seite
    await veroeffentliche(u, oeffentlich)
    await u.app.inject({
      method: 'PATCH',
      url: '/api/auth/me/profil',
      cookies: u.cookies,
      payload: { anzeigename: 'Reisende', bio: 'Unterwegs', sichtbarkeit: 'public' },
    })

    const antwort = await u.app.inject({ method: 'GET', url: `/api/benutzer/${nutzerId(u)}/profil` })
    expect(antwort.statusCode).toBe(200)
    const profil = antwort.json() as { anzeigename: string; bio: string; touren: Karte[] }
    expect(profil.anzeigename).toBe('Reisende')
    expect(profil.bio).toBe('Unterwegs')
    expect(profil.touren.map((t) => t.id)).toEqual([oeffentlich])
  })

  it('ein nicht freigegebenes Profil sieht aus wie keins', async () => {
    // 404 statt 403 — die Antwort verrät nicht, dass es das Konto gibt
    const u = await baueTestApp()
    const antwort = await u.app.inject({ method: 'GET', url: `/api/benutzer/${nutzerId(u)}/profil` })
    expect(antwort.statusCode).toBe(404)
  })

  it('unbekannte Person: ebenfalls 404', async () => {
    const u = await baueTestApp()
    expect((await u.app.inject({ method: 'GET', url: '/api/benutzer/u_gibtsnicht/profil' })).statusCode).toBe(404)
  })
})
