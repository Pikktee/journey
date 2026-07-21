// Öffentliches Profil: Anzeigename, Bio, Avatar, Sichtbarkeit.
import { describe, expect, it } from 'vitest'
import { baueTestApp, type TestUmgebung } from './helfer.js'

interface ProfilAntwort {
  anzeigename: string | null
  bio: string | null
  avatarUrl: string | null
  sichtbarkeit: 'private' | 'public'
}

async function patch(u: TestUmgebung, payload: unknown) {
  return u.app.inject({ method: 'PATCH', url: '/api/auth/me/profil', cookies: u.cookies, payload })
}

async function meinProfil(u: TestUmgebung): Promise<ProfilAntwort> {
  const antwort = await u.app.inject({ method: 'GET', url: '/api/auth/me', cookies: u.cookies })
  return (antwort.json() as { profil: ProfilAntwort }).profil
}

async function ladeAvatarHoch(u: TestUmgebung, inhalt = 'fake-jpeg') {
  return u.app.inject({
    method: 'PUT',
    url: '/api/auth/me/avatar',
    cookies: u.cookies,
    headers: { 'content-type': 'image/jpeg' },
    payload: Buffer.from(inhalt),
  })
}

describe('Profil', () => {
  it('ist anfangs leer und privat', async () => {
    const u = await baueTestApp()
    // Der Klarname aus der Registrierung wird NICHT zum Anzeigenamen — wer
    // sich mit echtem Namen anmeldet, veröffentlicht ihn nicht nebenbei.
    expect(await meinProfil(u)).toEqual({
      anzeigename: null,
      bio: null,
      avatarUrl: null,
      sichtbarkeit: 'private',
    })
  })

  it('setzt Anzeigename, Bio und Sichtbarkeit', async () => {
    const u = await baueTestApp()
    const antwort = await patch(u, { anzeigename: 'Reisende', bio: 'Unterwegs im Oberland', sichtbarkeit: 'public' })
    expect(antwort.statusCode).toBe(200)
    expect(await meinProfil(u)).toMatchObject({
      anzeigename: 'Reisende',
      bio: 'Unterwegs im Oberland',
      sichtbarkeit: 'public',
    })
  })

  it('lässt nicht übergebene Felder unangetastet', async () => {
    const u = await baueTestApp()
    await patch(u, { anzeigename: 'Reisende', bio: 'Text' })
    await patch(u, { sichtbarkeit: 'public' })
    expect(await meinProfil(u)).toMatchObject({ anzeigename: 'Reisende', bio: 'Text', sichtbarkeit: 'public' })
  })

  it('leert ein Feld mit leerem Text', async () => {
    // '' heißt „löschen", ein fehlendes Feld heißt „nicht angefasst"
    const u = await baueTestApp()
    await patch(u, { anzeigename: 'Reisende', bio: 'Text' })
    await patch(u, { bio: '   ' })
    const profil = await meinProfil(u)
    expect(profil.bio).toBeNull()
    expect(profil.anzeigename).toBe('Reisende')
  })

  it('weist zu lange Texte und unbekannte Sichtbarkeiten ab', async () => {
    const u = await baueTestApp()
    expect((await patch(u, { anzeigename: 'x'.repeat(81) })).statusCode).toBe(400)
    expect((await patch(u, { bio: 'x'.repeat(501) })).statusCode).toBe(400)
    expect((await patch(u, { sichtbarkeit: 'halboeffentlich' })).statusCode).toBe(400)
  })

  it('ignoriert Felder, die nicht zum Profil gehören', async () => {
    // Fastify entfernt sie beim Validieren (additionalProperties: false), sie
    // erreichen den Handler also gar nicht — die E-Mail bleibt unberührt.
    const u = await baueTestApp()
    expect((await patch(u, { email: 'neu@example.com', bio: 'Text' })).statusCode).toBe(200)
    const me = (await u.app.inject({ method: 'GET', url: '/api/auth/me', cookies: u.cookies })).json() as {
      benutzer: { email: string }
    }
    expect(me.benutzer.email).toBe('test@example.com')
  })

  it('braucht eine Anmeldung', async () => {
    const u = await baueTestApp()
    const antwort = await u.app.inject({ method: 'PATCH', url: '/api/auth/me/profil', payload: { bio: 'x' } })
    expect(antwort.statusCode).toBe(401)
  })
})

describe('Avatar', () => {
  it('wird hochgeladen und ist ohne Anmeldung abrufbar', async () => {
    // Er erscheint neben öffentlichen Touren — dort muss ihn jeder laden können
    const u = await baueTestApp()
    const hoch = await ladeAvatarHoch(u)
    expect(hoch.statusCode).toBe(200)
    const url = (hoch.json() as { avatarUrl: string }).avatarUrl

    const abruf = await u.app.inject({ method: 'GET', url })
    expect(abruf.statusCode).toBe(200)
    expect(abruf.headers['content-type']).toBe('image/jpeg')
    expect(abruf.headers['cache-control']).toContain('immutable')
    expect(abruf.rawPayload.toString()).toBe('fake-jpeg')
  })

  it('bekommt bei jedem Upload eine neue Adresse', async () => {
    // Sonst zeigte der Browser nach einem Bildwechsel ein Jahr lang das alte
    const u = await baueTestApp()
    const erste = (await ladeAvatarHoch(u, 'alt')).json() as { avatarUrl: string }
    await new Promise((r) => setTimeout(r, 2))
    const zweite = (await ladeAvatarHoch(u, 'neu')).json() as { avatarUrl: string }
    expect(zweite.avatarUrl).not.toBe(erste.avatarUrl)
  })

  it('räumt das vorherige Bild weg', async () => {
    const u = await baueTestApp()
    await ladeAvatarHoch(u, 'alt')
    const vorher = await u.benutzerStorage.listeDateien(nutzerId(u), 'avatar')
    await new Promise((r) => setTimeout(r, 2))
    await ladeAvatarHoch(u, 'neu')
    const nachher = await u.benutzerStorage.listeDateien(nutzerId(u), 'avatar')
    expect(nachher).toHaveLength(1)
    expect(nachher[0]?.name).not.toBe(vorher[0]?.name)
  })

  it('lässt sich entfernen', async () => {
    const u = await baueTestApp()
    const url = ((await ladeAvatarHoch(u)).json() as { avatarUrl: string }).avatarUrl
    expect((await u.app.inject({ method: 'DELETE', url: '/api/auth/me/avatar', cookies: u.cookies })).statusCode).toBe(200)
    expect((await u.app.inject({ method: 'GET', url })).statusCode).toBe(404)
    expect((await meinProfil(u)).avatarUrl).toBeNull()
  })

  it('ohne Bild antwortet der Abruf mit 404', async () => {
    const u = await baueTestApp()
    const antwort = await u.app.inject({ method: 'GET', url: `/api/benutzer/${nutzerId(u)}/avatar` })
    expect(antwort.statusCode).toBe(404)
  })

  it('wird beim Löschen des Kontos mit entfernt', async () => {
    // Sonst bliebe das Bild als Waise auf der Platte liegen — der Cascade der
    // Datenbank kennt keine Dateien.
    const u = await baueTestApp()
    await ladeAvatarHoch(u)
    const id = nutzerId(u)
    expect(await u.benutzerStorage.listeDateien(id, 'avatar')).toHaveLength(1)

    expect((await u.app.inject({ method: 'DELETE', url: '/api/auth/me', cookies: u.cookies })).statusCode).toBe(200)
    expect(await u.benutzerStorage.listeDateien(id, 'avatar')).toHaveLength(0)
  })
})

function nutzerId(u: TestUmgebung): string {
  return (u.app.deps.db.prepare('SELECT id FROM users LIMIT 1').get() as { id: string }).id
}
