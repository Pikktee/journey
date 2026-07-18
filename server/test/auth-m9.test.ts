// M9 (offener Betrieb): Selbst-Registrierung mit E-Mail-Bestätigung, Passwort-
// Reset, Konto-Löschung und Speicher-Quota — end-to-end über fastify.inject
// gegen Temp-SQLite + Fake-Storage + Fake-Mail.

import { describe, expect, it } from 'vitest'
import { baueTestApp, beispielManifest, type TestUmgebung } from './helfer.js'

// Token aus dem letzten Mail-Link ziehen (…#verify=<token> / …#reset=<token>)
function tokenAusMail(u: TestUmgebung): string {
  const link = u.mail.letzterLink() ?? ''
  return link.split('=').pop() ?? ''
}

async function registriere(u: TestUmgebung, email = 'neu@example.com', passwort = 'geheim12345', name = 'Neu') {
  return u.app.inject({ method: 'POST', url: '/api/auth/register', payload: { email, passwort, name } })
}

/** Session-Cookie aus einer inject-Antwort (Register/Login setzen es). */
function sessionAus(antwort: Awaited<ReturnType<TestUmgebung['app']['inject']>>): { luhambo_session: string } {
  return { luhambo_session: antwort.cookies.find((c) => c.name === 'luhambo_session')?.value ?? '' }
}

describe('Registrierung + E-Mail-Bestätigung (M9)', () => {
  it('registriert unbestätigt, verschickt Bestätigungsmail und loggt direkt ein', async () => {
    const u = await baueTestApp()
    const antwort = await registriere(u)
    expect(antwort.statusCode).toBe(201)
    expect(antwort.json()).toMatchObject({ verifiziert: false })
    expect(u.mail.nachrichten).toHaveLength(1)
    expect(u.mail.nachrichten[0]?.an).toBe('neu@example.com')
    expect(u.mail.letzterLink()).toContain('#verify=')
    // me zeigt eingeloggt, aber unbestätigt
    const cookies = sessionAus(antwort)
    const me = await u.app.inject({ method: 'GET', url: '/api/auth/me', cookies })
    expect(me.json()).toMatchObject({ verifiziert: false })
  })

  it('sperrt das Hochladen bis zur Bestätigung, danach klappt es', async () => {
    const u = await baueTestApp()
    const reg = await registriere(u)
    const cookies = sessionAus(reg)
    // Vor der Bestätigung: Tour anlegen wird abgewiesen
    const vorher = await u.app.inject({ method: 'POST', url: '/api/tours', cookies, payload: beispielManifest() })
    expect(vorher.statusCode).toBe(403)
    // Bestätigen …
    const verify = await u.app.inject({ method: 'POST', url: '/api/auth/verifiziere', payload: { token: tokenAusMail(u) } })
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
    const antwort = await u.app.inject({ method: 'POST', url: '/api/auth/verifiziere', payload: { token: 'quatsch' } })
    expect(antwort.statusCode).toBe(400)
  })

  it('respektiert geschlossene Registrierung (403)', async () => {
    const u = await baueTestApp(undefined, undefined, undefined, { registrierungOffen: false })
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
      url: '/api/auth/passwort-reset-anfordern',
      payload: { email: 'test@example.com' },
    })
    expect(anf.statusCode).toBe(200)
    expect(u.mail.letzterLink()).toContain('#reset=')
    const reset = await u.app.inject({
      method: 'POST',
      url: '/api/auth/passwort-reset',
      payload: { token: tokenAusMail(u), passwort: 'ganzneu12345' },
    })
    expect(reset.statusCode).toBe(200)
    // Altes Passwort abgelehnt, neues akzeptiert
    const alt = await u.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'test@example.com', passwort: 'geheim123' } })
    expect(alt.statusCode).toBe(401)
    const neu = await u.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'test@example.com', passwort: 'ganzneu12345' } })
    expect(neu.statusCode).toBe(200)
  })

  it('antwortet für unbekannte Adressen mit 200 ohne Mail (keine Existenz-Auskunft)', async () => {
    const u = await baueTestApp()
    const anf = await u.app.inject({
      method: 'POST',
      url: '/api/auth/passwort-reset-anfordern',
      payload: { email: 'gibtsnicht@example.com' },
    })
    expect(anf.statusCode).toBe(200)
    expect(u.mail.nachrichten).toHaveLength(0)
  })

  it('verbraucht das Reset-Token (zweite Einlösung scheitert)', async () => {
    const u = await baueTestApp()
    await u.app.inject({ method: 'POST', url: '/api/auth/passwort-reset-anfordern', payload: { email: 'test@example.com' } })
    const token = tokenAusMail(u)
    expect((await u.app.inject({ method: 'POST', url: '/api/auth/passwort-reset', payload: { token, passwort: 'ersteinmal12' } })).statusCode).toBe(200)
    expect((await u.app.inject({ method: 'POST', url: '/api/auth/passwort-reset', payload: { token, passwort: 'nochmal12345' } })).statusCode).toBe(400)
  })
})

describe('Konto-Löschung (M9, DSGVO)', () => {
  it('löscht Benutzer, Touren (DB) und Storage-Dateien; Login danach unmöglich', async () => {
    const u = await baueTestApp()
    // Eine Tour mit Datei anlegen
    const tour = await u.app.inject({ method: 'POST', url: '/api/tours', cookies: u.cookies, payload: beispielManifest() })
    const id = (tour.json() as { id: string }).id
    expect(await u.storage.gesamtGroesse(id)).toBeGreaterThan(0)

    const del = await u.app.inject({ method: 'DELETE', url: '/api/auth/me', cookies: u.cookies })
    expect(del.statusCode).toBe(200)
    expect(await u.storage.gesamtGroesse(id)).toBe(0)
    const login = await u.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'test@example.com', passwort: 'geheim123' } })
    expect(login.statusCode).toBe(401)
  })

  it('verlangt Anmeldung (401 ohne Cookie)', async () => {
    const u = await baueTestApp()
    expect((await u.app.inject({ method: 'DELETE', url: '/api/auth/me' })).statusCode).toBe(401)
  })
})

describe('Speicher-Quota (M9)', () => {
  it('meldet Nutzung/Limit über GET /me', async () => {
    const u = await baueTestApp(undefined, undefined, undefined, { maxSpeicherProBenutzer: 10 * 1024 * 1024 })
    const me = await u.app.inject({ method: 'GET', url: '/api/auth/me', cookies: u.cookies })
    expect(me.json()).toMatchObject({ quota: { limit: 10 * 1024 * 1024, benutzt: expect.any(Number), frei: expect.any(Number) } })
  })

  it('lehnt einen Upload ab, der die Quota sprengt (413)', async () => {
    // Winziges Limit: schon das Manifest-freie Medium überschreitet es
    const u = await baueTestApp(undefined, undefined, undefined, { maxSpeicherProBenutzer: 100 })
    const tour = await u.app.inject({ method: 'POST', url: '/api/tours', cookies: u.cookies, payload: beispielManifest() })
    const id = (tour.json() as { id: string }).id
    const put = await u.app.inject({
      method: 'PUT',
      url: `/api/tours/${id}/media/m1`,
      cookies: u.cookies,
      headers: { 'content-type': 'application/octet-stream', 'content-length': '5000' },
      payload: Buffer.alloc(5000, 1),
    })
    expect(put.statusCode).toBe(413)
    expect(put.json()).toMatchObject({ fehler: expect.stringContaining('Speicherplatz') })
  })
})
