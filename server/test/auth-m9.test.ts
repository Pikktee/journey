// M9 (offener Betrieb): Selbst-Registrierung mit E-Mail-Bestätigung, Passwort-
// Reset, Konto-Löschung und Speicher-Quota — end-to-end über fastify.inject
// gegen Temp-SQLite + Fake-Storage + Fake-Mail.

import { describe, expect, it } from 'vitest'
import { nameFromEmail } from '../src/auth/auth.js'
import { baueTestApp, beispielManifest, oeffneRegistrierung, type TestUmgebung } from './helfer.js'

// Token aus dem letzten Mail-Link ziehen (…#verify=<token> / …#reset=<token>)
function tokenAusMail(u: TestUmgebung): string {
  const link = u.mail.letzterLink() ?? ''
  return link.split('=').pop() ?? ''
}

async function registriere(
  u: TestUmgebung,
  email = 'neu@example.com',
  password = 'geheim12345',
  name = 'Neu',
) {
  // Diese Tests prüfen den OFFENEN Fluss; die Einladungspflicht hat eigene
  // Tests in admin.test.ts.
  oeffneRegistrierung(u)
  return u.app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email, password, name },
  })
}

/** Session-Cookie aus einer inject-Antwort (Register/Login setzen es). */
function sessionAus(antwort: Awaited<ReturnType<TestUmgebung['app']['inject']>>): {
  maptale_session: string
} {
  return { maptale_session: antwort.cookies.find((c) => c.name === 'maptale_session')?.value ?? '' }
}

describe('Registrierung ohne Namensfeld', () => {
  // Das Formular fragt nur E-Mail und Passwort ab. `users.name` ist aber NOT
  // NULL und trägt die Mail-Anrede — fiele die Ableitung aus, stünde dort
  // „Hallo ,", und zwar erst in der verschickten Mail sichtbar.
  it('legt ein Konto ohne `name` an und leitet den Anzeigenamen aus der Adresse ab', async () => {
    const u = await baueTestApp()
    oeffneRegistrierung(u)
    const antwort = await u.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'mira.wolf@example.com', password: 'lampe wolke treppe' },
    })
    expect(antwort.statusCode).toBe(201)
    expect(antwort.json().user).toMatchObject({ name: 'Mira Wolf' })
    expect(u.mail.nachrichten[0]?.text).toContain('Hallo Mira Wolf,')
  })

  it('lässt den Plus-Zusatz weg', async () => {
    const u = await baueTestApp()
    oeffneRegistrierung(u)
    const antwort = await u.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'mira+maptale@example.com', password: 'lampe wolke treppe' },
    })
    expect(antwort.json().user).toMatchObject({ name: 'Mira' })
  })

  it('behält einen mitgeschickten Namen', async () => {
    const u = await baueTestApp()
    oeffneRegistrierung(u)
    const antwort = await u.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'mira.wolf@example.com', password: 'lampe wolke treppe', name: 'Mira W.' },
    })
    expect(antwort.json().user).toMatchObject({ name: 'Mira W.' })
  })
})

describe('nameAusEmail', () => {
  it('macht aus dem lokalen Teil einen lesbaren Namen', () => {
    expect(nameFromEmail('mira.wolf@example.com')).toBe('Mira Wolf')
    expect(nameFromEmail('mira_wolf@example.com')).toBe('Mira Wolf')
    expect(nameFromEmail('mira-wolf@example.com')).toBe('Mira Wolf')
    expect(nameFromEmail('mira@example.com')).toBe('Mira')
    expect(nameFromEmail('mira+maptale@example.com')).toBe('Mira')
  })

  it('erfindet nichts, wo nichts zu holen ist, und bleibt im Spaltenmaß', () => {
    // Solche Adressen kommen an der Prüfung davor gar nicht vorbei — die
    // Funktion darf trotzdem nichts Leeres liefern, die Spalte ist NOT NULL.
    expect(nameFromEmail('...@example.com')).toBe('...')
    expect(nameFromEmail('@example.com')).toBe('@example.com')
    expect(nameFromEmail(`${'a'.repeat(200)}@example.com`).length).toBe(80)
  })
})

describe('Registrierung + E-Mail-Bestätigung (M9)', () => {
  it('registriert unbestätigt, verschickt Bestätigungsmail und loggt direkt ein', async () => {
    const u = await baueTestApp()
    const antwort = await registriere(u)
    expect(antwort.statusCode).toBe(201)
    expect(antwort.json()).toMatchObject({ verified: false })
    expect(u.mail.nachrichten).toHaveLength(1)
    expect(u.mail.nachrichten[0]?.to2).toBe('neu@example.com')
    expect(u.mail.letzterLink()).toContain('#verify=')
    // me zeigt eingeloggt, aber unbestätigt
    const cookies = sessionAus(antwort)
    const me = await u.app.inject({ method: 'GET', url: '/api/auth/me', cookies })
    expect(me.json()).toMatchObject({ verified: false })
  })

  it('schickt den Bestätigungslink auf die WEBSEITE, nicht auf die API', async () => {
    // Was in einer Mail steht, öffnet jemand womöglich Tage später auf einem
    // anderen Gerät — eine Adresse, die dort ins Leere führt, merkt niemand
    // beim Entwickeln. Live sind Web und API dieselbe Adresse, lokal nicht,
    // und die Tests sahen bisher nur den Hash hinter dem Link. Die
    // Test-Umgebung hält beide Adressen deshalb verschieden.
    const u = await baueTestApp()
    await registriere(u)
    expect(u.mail.letzterLink()).toMatch(/^https:\/\/maptale\.test\/anmelden#verify=/)
    // Auch die Fußzeile jeder Mail (Impressum, Datenschutz, Logo) hängt daran.
    const html = u.mail.nachrichten.at(-1)?.html ?? ''
    expect(html).toContain('https://maptale.test/impressum')
    expect(html).not.toContain('http://localhost:5173')
  })

  it('sperrt das Hochladen bis zur Bestätigung, danach klappt es', async () => {
    const u = await baueTestApp()
    const reg = await registriere(u)
    const cookies = sessionAus(reg)
    // Vor der Bestätigung: Tour anlegen wird abgewiesen
    const vorher = await u.app.inject({
      method: 'POST',
      url: '/api/tours',
      cookies,
      payload: beispielManifest(),
    })
    expect(vorher.statusCode).toBe(403)
    // Bestätigen …
    const verify = await u.app.inject({
      method: 'POST',
      url: '/api/auth/verify',
      payload: { token: tokenAusMail(u) },
    })
    expect(verify.statusCode).toBe(200)
    // … danach geht es (frische clientTourId, damit keine Idempotenz greift)
    const nachher = await u.app.inject({
      method: 'POST',
      url: '/api/tours',
      cookies,
      payload: { ...beispielManifest(), clientTourId: 'nach-verify' },
    })
    expect(nachher.statusCode).toBe(201)
  })

  it('lehnt doppelte E-Mail (409) und ungültige Adresse (400) ab', async () => {
    const u = await baueTestApp()
    await registriere(u)
    expect((await registriere(u)).statusCode).toBe(409)
    expect((await registriere(u, 'kaputt')).statusCode).toBe(400)
  })

  it('weist ein ungültiges/abgelaufenes Bestätigungs-Token ab (400)', async () => {
    const u = await baueTestApp()
    const antwort = await u.app.inject({
      method: 'POST',
      url: '/api/auth/verify',
      payload: { token: 'quatsch' },
    })
    expect(antwort.statusCode).toBe(400)
  })

  it('respektiert geschlossene Registrierung (403)', async () => {
    const u = await baueTestApp(undefined, undefined, undefined, { registrationOpen: false })
    expect((await registriere(u)).statusCode).toBe(403)
  })

  it('lehnt zu kurze Passwörter am Schema ab (400)', async () => {
    const u = await baueTestApp()
    expect((await registriere(u, 'neu@example.com', 'kurz')).statusCode).toBe(400)
  })
})

describe('Passwort-Reset (M9)', () => {
  it('setzt das Passwort per Token neu; altes gilt nicht mehr', async () => {
    const u = await baueTestApp()
    // Reset für den vorhandenen Testbenutzer anfordern
    const anf = await u.app.inject({
      method: 'POST',
      url: '/api/auth/password-reset-request',
      payload: { email: 'test@example.com' },
    })
    expect(anf.statusCode).toBe(200)
    expect(u.mail.letzterLink()).toContain('#reset=')
    const reset = await u.app.inject({
      method: 'POST',
      url: '/api/auth/password-reset',
      payload: { token: tokenAusMail(u), password: 'ganzneu12345' },
    })
    expect(reset.statusCode).toBe(200)
    // Altes Passwort abgelehnt, neues akzeptiert
    const alt = await u.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'test@example.com', password: 'geheim123' },
    })
    expect(alt.statusCode).toBe(401)
    const neu = await u.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'test@example.com', password: 'ganzneu12345' },
    })
    expect(neu.statusCode).toBe(200)
  })

  it('antwortet für unbekannte Adressen mit 200 ohne Mail (keine Existenz-Auskunft)', async () => {
    const u = await baueTestApp()
    const anf = await u.app.inject({
      method: 'POST',
      url: '/api/auth/password-reset-request',
      payload: { email: 'gibtsnicht@example.com' },
    })
    expect(anf.statusCode).toBe(200)
    expect(u.mail.nachrichten).toHaveLength(0)
  })

  it('verbraucht das Reset-Token (zweite Einlösung scheitert)', async () => {
    const u = await baueTestApp()
    await u.app.inject({
      method: 'POST',
      url: '/api/auth/password-reset-request',
      payload: { email: 'test@example.com' },
    })
    const token = tokenAusMail(u)
    expect(
      (
        await u.app.inject({
          method: 'POST',
          url: '/api/auth/password-reset',
          payload: { token, password: 'ersteinmal12' },
        })
      ).statusCode,
    ).toBe(200)
    expect(
      (
        await u.app.inject({
          method: 'POST',
          url: '/api/auth/password-reset',
          payload: { token, password: 'nochmal12345' },
        })
      ).statusCode,
    ).toBe(400)
  })
})

describe('Konto-Löschung (M9, DSGVO)', () => {
  it('löscht Benutzer, Touren (DB) und Storage-Dateien; Login danach unmöglich', async () => {
    const u = await baueTestApp()
    // Eine Tour mit Datei anlegen
    const tour = await u.app.inject({
      method: 'POST',
      url: '/api/tours',
      cookies: u.cookies,
      payload: beispielManifest(),
    })
    const id = (tour.json() as { id: string }).id
    expect(await u.storage.totalSize(id)).toBeGreaterThan(0)

    const del = await u.app.inject({ method: 'DELETE', url: '/api/auth/me', cookies: u.cookies })
    expect(del.statusCode).toBe(200)
    expect(await u.storage.totalSize(id)).toBe(0)
    const login = await u.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'test@example.com', password: 'geheim123' },
    })
    expect(login.statusCode).toBe(401)
  })

  it('verlangt Anmeldung (401 ohne Cookie)', async () => {
    const u = await baueTestApp()
    expect((await u.app.inject({ method: 'DELETE', url: '/api/auth/me' })).statusCode).toBe(401)
  })
})

describe('Speicher-Quota (M9)', () => {
  it('meldet Nutzung/Limit über GET /me', async () => {
    const u = await baueTestApp(undefined, undefined, undefined, {
      maxStoragePerUser: 10 * 1024 * 1024,
    })
    const me = await u.app.inject({ method: 'GET', url: '/api/auth/me', cookies: u.cookies })
    expect(me.json()).toMatchObject({
      quota: { limit: 10 * 1024 * 1024, used: expect.any(Number), free: expect.any(Number) },
    })
  })

  it('lehnt einen Upload ab, der die Quota sprengt (413)', async () => {
    // Winziges Limit: schon das Manifest-freie Medium überschreitet es
    const u = await baueTestApp(undefined, undefined, undefined, { maxStoragePerUser: 100 })
    const tour = await u.app.inject({
      method: 'POST',
      url: '/api/tours',
      cookies: u.cookies,
      payload: beispielManifest(),
    })
    const id = (tour.json() as { id: string }).id
    const put = await u.app.inject({
      method: 'PUT',
      url: `/api/tours/${id}/media/m1`,
      cookies: u.cookies,
      headers: { 'content-type': 'application/octet-stream', 'content-length': '5000' },
      payload: Buffer.alloc(5000, 1),
    })
    expect(put.statusCode).toBe(413)
    expect(put.json()).toMatchObject({ error: expect.stringContaining('Speicherplatz') })
  })
})
