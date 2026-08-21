// Benutzerverwaltung: Rechte, Konto-CRUD, Einladungen und die Kopplung der
// Registrierung an einen Code — end-to-end über fastify.inject.
//
// Der Testbenutzer aus baueTestApp ist bewusst KEIN Admin: Jede Route wird
// einmal mit ihm angeklopft, damit die Rechteprüfung nicht nur behauptet wird.

import { describe, expect, it } from 'vitest'
import { getTemplate } from '../src/mail-templates.js'
import {
  baueTestApp,
  beispielManifest,
  legeAdminAn,
  oeffneRegistrierung,
  type TestUmgebung,
} from './helfer.js'

const registriere = (u: TestUmgebung, payload: Record<string, unknown>) =>
  u.app.inject({ method: 'POST', url: '/api/auth/register', payload })

/** Einladung erstellen und den Code zurückgeben. */
async function ladeEin(
  u: TestUmgebung,
  cookies: { maptale_session: string },
  koerper: Record<string, unknown> = {},
): Promise<string> {
  const antwort = await u.app.inject({
    method: 'POST',
    url: '/api/admin/invitations',
    cookies,
    payload: koerper,
  })
  expect(antwort.statusCode).toBe(201)
  return (antwort.json() as { invitation: { code: string } }).invitation.code
}

describe('Zugang zur Verwaltung', () => {
  it('antwortet ohne Anmeldung mit 401 und für gewöhnliche Konten mit 403', async () => {
    const u = await baueTestApp()
    expect((await u.app.inject({ method: 'GET', url: '/api/admin/users' })).statusCode).toBe(401)
    const alsNutzer = await u.app.inject({
      method: 'GET',
      url: '/api/admin/users',
      cookies: u.cookies,
    })
    expect(alsNutzer.statusCode).toBe(403)
    expect(alsNutzer.json()).toMatchObject({ error: expect.stringContaining('Administrator') })
  })

  it('verwehrt auch die schreibenden Routen (403)', async () => {
    const u = await baueTestApp()
    const c = u.cookies
    expect(
      (
        await u.app.inject({
          method: 'POST',
          url: '/api/admin/invitations',
          cookies: c,
          payload: {},
        })
      ).statusCode,
    ).toBe(403)
    expect(
      (
        await u.app.inject({
          method: 'PATCH',
          url: '/api/admin/settings',
          cookies: c,
          payload: { invitationRequired: false },
        })
      ).statusCode,
    ).toBe(403)
    expect(
      (await u.app.inject({ method: 'DELETE', url: '/api/admin/users/u_egal', cookies: c }))
        .statusCode,
    ).toBe(403)
  })

  it('meldet die Rolle in /auth/me — daran hängt der Weg zur Verwaltung im Studio', async () => {
    const u = await baueTestApp()
    const admin = await legeAdminAn(u)
    const alsNutzer = await u.app.inject({ method: 'GET', url: '/api/auth/me', cookies: u.cookies })
    expect(alsNutzer.json()).toMatchObject({ user: { role: 'user' } })
    const alsAdmin = await u.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: admin.cookies,
    })
    expect(alsAdmin.json()).toMatchObject({ user: { role: 'admin' } })
  })
})

describe('Konten verwalten', () => {
  it('listet alle Konten mit Rolle, Bestätigung, Tourenzahl und Speicher', async () => {
    const u = await baueTestApp()
    const admin = await legeAdminAn(u)
    await u.app.inject({
      method: 'POST',
      url: '/api/tours',
      cookies: u.cookies,
      payload: beispielManifest(),
    })

    const antwort = await u.app.inject({
      method: 'GET',
      url: '/api/admin/users',
      cookies: admin.cookies,
    })
    expect(antwort.statusCode).toBe(200)
    const { users } = antwort.json() as {
      users: Array<{
        email: string
        role: string
        tours: number
        storage: number
        verified: boolean
      }>
    }
    const testerin = users.find((b) => b.email === 'test@example.com')
    expect(testerin).toMatchObject({ role: 'user', tours: 1, verified: true })
    expect(testerin?.storage).toBeGreaterThan(0)
    expect(users.find((b) => b.email === 'chefin@example.com')).toMatchObject({
      role: 'admin',
      tours: 0,
    })
  })

  it('legt ein Konto an, das sich sofort anmelden kann', async () => {
    const u = await baueTestApp()
    const admin = await legeAdminAn(u)
    const neu = await u.app.inject({
      method: 'POST',
      url: '/api/admin/users',
      cookies: admin.cookies,
      payload: { email: 'Gast@Example.com', password: 'gastgast1', name: 'Gast' },
    })
    expect(neu.statusCode).toBe(201)
    // Adresse normalisiert, Rolle gewöhnlich, ohne Mail-Umweg bestätigt
    expect(neu.json()).toMatchObject({ user: { email: 'gast@example.com', role: 'user' } })
    const login = await u.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'gast@example.com', password: 'gastgast1' },
    })
    expect(login.statusCode).toBe(200)
    const me = await u.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: {
        maptale_session: login.cookies.find((c) => c.name === 'maptale_session')?.value ?? '',
      },
    })
    expect(me.json()).toMatchObject({ verified: true })
  })

  it('weist doppelte Adressen (409) und Unfug (400) ab', async () => {
    const u = await baueTestApp()
    const admin = await legeAdminAn(u)
    const doppelt = await u.app.inject({
      method: 'POST',
      url: '/api/admin/users',
      cookies: admin.cookies,
      payload: { email: 'test@example.com', password: 'nochmal12', name: 'Doppelt' },
    })
    expect(doppelt.statusCode).toBe(409)
    const kaputt = await u.app.inject({
      method: 'POST',
      url: '/api/admin/users',
      cookies: admin.cookies,
      payload: { email: 'ohne-at', password: 'egalegal1', name: 'Kaputt' },
    })
    expect(kaputt.statusCode).toBe(400)
  })

  it('ändert Name, Adresse, Rolle und Bestätigung', async () => {
    const u = await baueTestApp()
    const admin = await legeAdminAn(u)
    const ziel = u.app.auth.allUsers().find((b) => b.email === 'test@example.com')!
    const antwort = await u.app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${ziel.id}`,
      cookies: admin.cookies,
      payload: { name: 'Neuer Name', email: 'neu@example.com', role: 'admin', verified: false },
    })
    expect(antwort.statusCode).toBe(200)
    expect(antwort.json()).toMatchObject({
      user: {
        name: 'Neuer Name',
        email: 'neu@example.com',
        role: 'admin',
        verified: false,
      },
    })
  })

  it('setzt ein Passwort zurück und wirft dabei die Sitzungen des Kontos ab', async () => {
    const u = await baueTestApp()
    const admin = await legeAdminAn(u)
    const ziel = u.app.auth.allUsers().find((b) => b.email === 'test@example.com')!
    const antwort = await u.app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${ziel.id}`,
      cookies: admin.cookies,
      payload: { password: 'frischgesetzt1' },
    })
    expect(antwort.statusCode).toBe(200)
    // Die alte Sitzung des Ziels gilt nicht mehr …
    const me = await u.app.inject({ method: 'GET', url: '/api/auth/me', cookies: u.cookies })
    expect(me.json()).toMatchObject({ user: null })
    // … das neue Passwort schon, das alte nicht
    expect(
      (
        await u.app.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { email: 'test@example.com', password: 'geheim123' },
        })
      ).statusCode,
    ).toBe(401)
    expect(
      (
        await u.app.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { email: 'test@example.com', password: 'frischgesetzt1' },
        })
      ).statusCode,
    ).toBe(200)
  })

  it('löscht ein Konto samt Touren und Dateien', async () => {
    const u = await baueTestApp()
    const admin = await legeAdminAn(u)
    const tour = await u.app.inject({
      method: 'POST',
      url: '/api/tours',
      cookies: u.cookies,
      payload: beispielManifest(),
    })
    const tourId = (tour.json() as { id: string }).id
    expect(await u.storage.totalSize(tourId)).toBeGreaterThan(0)

    const ziel = u.app.auth.allUsers().find((b) => b.email === 'test@example.com')!
    const antwort = await u.app.inject({
      method: 'DELETE',
      url: `/api/admin/users/${ziel.id}`,
      cookies: admin.cookies,
    })
    expect(antwort.statusCode).toBe(200)
    expect(await u.storage.totalSize(tourId)).toBe(0)
    expect(u.app.auth.userById(ziel.id)).toBeNull()
  })

  it('antwortet für unbekannte IDs mit 404', async () => {
    const u = await baueTestApp()
    const admin = await legeAdminAn(u)
    expect(
      (
        await u.app.inject({
          method: 'PATCH',
          url: '/api/admin/users/u_gibtsnicht',
          cookies: admin.cookies,
          payload: { name: 'X' },
        })
      ).statusCode,
    ).toBe(404)
    expect(
      (
        await u.app.inject({
          method: 'DELETE',
          url: '/api/admin/users/u_gibtsnicht',
          cookies: admin.cookies,
        })
      ).statusCode,
    ).toBe(404)
  })
})

describe('Selbstschutz der Verwaltung', () => {
  it('lässt den letzten Administrator weder herabstufen noch löschen', async () => {
    const u = await baueTestApp()
    const admin = await legeAdminAn(u)
    const runter = await u.app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${admin.id}`,
      cookies: admin.cookies,
      payload: { role: 'user' },
    })
    expect(runter.statusCode).toBe(409)
    const weg = await u.app.inject({
      method: 'DELETE',
      url: `/api/admin/users/${admin.id}`,
      cookies: admin.cookies,
    })
    expect(weg.statusCode).toBe(409)
    expect(u.app.auth.adminCount()).toBe(1)
  })

  it('lässt die eigene Admin-Rolle auch dann nicht ablegen, wenn es weitere Admins gibt', async () => {
    const u = await baueTestApp()
    const admin = await legeAdminAn(u)
    const zweiter = await legeAdminAn(u, 'zweite@example.com')
    const antwort = await u.app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${admin.id}`,
      cookies: admin.cookies,
      payload: { role: 'user' },
    })
    expect(antwort.statusCode).toBe(409)
    // Eine FREMDE Admin-Rolle darf dagegen fallen
    const fremd = await u.app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${zweiter.id}`,
      cookies: admin.cookies,
      payload: { role: 'user' },
    })
    expect(fremd.statusCode).toBe(200)
  })

  it('schützt die in der Konfiguration gesetzten Adressen', async () => {
    // Ohne diesen Riegel wäre die Änderung ohnehin nur bis zum nächsten Start
    // gültig — hebeAdmins holt sie zurück.
    const u = await baueTestApp(undefined, undefined, undefined, {
      adminEmails: ['chefin@example.com'],
    })
    const admin = await legeAdminAn(u)
    const zweiter = await legeAdminAn(u, 'zweite@example.com')
    const runter = await u.app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${admin.id}`,
      cookies: zweiter.cookies,
      payload: { role: 'user' },
    })
    expect(runter.statusCode).toBe(409)
    expect(runter.json()).toMatchObject({ error: expect.stringContaining('Konfiguration') })
    const weg = await u.app.inject({
      method: 'DELETE',
      url: `/api/admin/users/${admin.id}`,
      cookies: zweiter.cookies,
    })
    expect(weg.statusCode).toBe(409)
  })

  it('hebt konfigurierte Adressen beim Start auf die Admin-Rolle', async () => {
    const u = await baueTestApp()
    expect(u.app.auth.promoteAdmins(['test@example.com'])).toBe(1)
    expect(u.app.auth.userById(u.app.auth.allUsers()[0]!.id)?.role).toBe('admin')
    // Zweiter Lauf ändert nichts mehr (idempotent)
    expect(u.app.auth.promoteAdmins(['test@example.com'])).toBe(0)
    expect(u.app.auth.promoteAdmins([])).toBe(0)
  })
})

describe('Einladungen', () => {
  it('erstellt, listet und widerruft', async () => {
    const u = await baueTestApp()
    const admin = await legeAdminAn(u)
    const code = await ladeEin(u, admin.cookies, { note: 'für Anna' })
    expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/)

    const liste = await u.app.inject({
      method: 'GET',
      url: '/api/admin/invitations',
      cookies: admin.cookies,
    })
    expect(liste.json()).toMatchObject({ invitationRequired: true })
    const { invitations } = liste.json() as {
      invitations: Array<{ code: string; note: string; state: string; createdBy: string }>
    }
    expect(invitations).toHaveLength(1)
    expect(invitations[0]).toMatchObject({
      code,
      note: 'für Anna',
      state: 'open',
      createdBy: 'chefin@example.com',
    })

    expect(
      (
        await u.app.inject({
          method: 'DELETE',
          url: `/api/admin/invitations/${code}`,
          cookies: admin.cookies,
        })
      ).statusCode,
    ).toBe(200)
    expect(
      (
        await u.app.inject({
          method: 'DELETE',
          url: `/api/admin/invitations/${code}`,
          cookies: admin.cookies,
        })
      ).statusCode,
    ).toBe(404)
  })

  it('vergibt ohne Angabe eine Gültigkeit und lässt sie auf Wunsch weg', async () => {
    const u = await baueTestApp()
    const admin = await legeAdminAn(u)
    await ladeEin(u, admin.cookies)
    await ladeEin(u, admin.cookies, { validDays: 0 })
    const liste = await u.app.inject({
      method: 'GET',
      url: '/api/admin/invitations',
      cookies: admin.cookies,
    })
    const { invitations } = liste.json() as { invitations: Array<{ expiresAt: string | null }> }
    expect(invitations.filter((e) => e.expiresAt === null)).toHaveLength(1)
    expect(invitations.filter((e) => e.expiresAt !== null)).toHaveLength(1)
  })
})

describe('Registrierung mit Einladung', () => {
  it('verlangt einen Code, solange die Pflicht steht', async () => {
    const u = await baueTestApp()
    const ohne = await registriere(u, {
      email: 'neu@example.com',
      password: 'geheim12345',
      name: 'Neu',
    })
    expect(ohne.statusCode).toBe(403)
    expect(ohne.json()).toMatchObject({ error: expect.stringContaining('Einladungscode') })
    // Kein halb angelegtes Konto zurücklassen
    expect(u.app.auth.allUsers().some((b) => b.email === 'neu@example.com')).toBe(false)
  })

  it('lässt einen gültigen Code durch und verbraucht ihn dabei', async () => {
    const u = await baueTestApp()
    const admin = await legeAdminAn(u)
    const code = await ladeEin(u, admin.cookies)

    const erste = await registriere(u, {
      email: 'anna@example.com',
      password: 'geheim12345',
      name: 'Anna',
      code,
    })
    expect(erste.statusCode).toBe(201)

    // Die Einladung trägt jetzt, wer sie eingelöst hat
    const liste = await u.app.inject({
      method: 'GET',
      url: '/api/admin/invitations',
      cookies: admin.cookies,
    })
    expect(
      (liste.json() as { invitations: Array<{ state: string; redeemedBy: string }> })
        .invitations[0],
    ).toMatchObject({
      state: 'redeemed',
      redeemedBy: 'anna@example.com',
    })

    // Ein zweites Mal geht derselbe Code nicht
    const zweite = await registriere(u, {
      email: 'bert@example.com',
      password: 'geheim12345',
      name: 'Bert',
      code,
    })
    expect(zweite.statusCode).toBe(403)
    expect(zweite.json()).toMatchObject({ error: expect.stringContaining('eingelöst') })
  })

  it('nimmt den Code auch klein geschrieben und mit Leerzeichen', async () => {
    const u = await baueTestApp()
    const admin = await legeAdminAn(u)
    const code = await ladeEin(u, admin.cookies)
    const antwort = await registriere(u, {
      email: 'anna@example.com',
      password: 'geheim12345',
      name: 'Anna',
      code: ` ${code.toLowerCase()} `,
    })
    expect(antwort.statusCode).toBe(201)
  })

  it('weist unbekannte und abgelaufene Codes mit eigener Begründung ab', async () => {
    const u = await baueTestApp()
    const admin = await legeAdminAn(u)
    const unbekannt = await registriere(u, {
      email: 'a@example.com',
      password: 'geheim12345',
      name: 'A',
      code: 'XXXX-XXXX',
    })
    expect(unbekannt.json()).toMatchObject({ error: expect.stringContaining('gibt es nicht') })

    const code = await ladeEin(u, admin.cookies)
    u.app.deps.db
      .prepare('UPDATE invitations SET expires_at = ? WHERE code = ?')
      .run('2020-01-01T00:00:00.000Z', code)
    const abgelaufen = await registriere(u, {
      email: 'b@example.com',
      password: 'geheim12345',
      name: 'B',
      code,
    })
    expect(abgelaufen.statusCode).toBe(403)
    expect(abgelaufen.json()).toMatchObject({ error: expect.stringContaining('abgelaufen') })
    const liste = await u.app.inject({
      method: 'GET',
      url: '/api/admin/invitations',
      cookies: admin.cookies,
    })
    expect((liste.json() as { invitations: Array<{ state: string }> }).invitations[0]?.state).toBe(
      'expired',
    )
  })

  it('lässt ohne Pflicht jeden herein — und der Schalter überlebt den Aufruf', async () => {
    const u = await baueTestApp()
    const admin = await legeAdminAn(u)
    const aus = await u.app.inject({
      method: 'PATCH',
      url: '/api/admin/settings',
      cookies: admin.cookies,
      payload: { invitationRequired: false },
    })
    expect(aus.json()).toMatchObject({ invitationRequired: false })
    expect(
      (await registriere(u, { email: 'frei@example.com', password: 'geheim12345', name: 'Frei' }))
        .statusCode,
    ).toBe(201)

    const wieder = await u.app.inject({
      method: 'PATCH',
      url: '/api/admin/settings',
      cookies: admin.cookies,
      payload: { invitationRequired: true },
    })
    expect(wieder.json()).toMatchObject({ invitationRequired: true })
  })

  it('bleibt zu, wenn die Umgebung die Registrierung ganz abschaltet — auch mit gültigem Code', async () => {
    const u = await baueTestApp(undefined, undefined, undefined, { registrationOpen: false })
    const admin = await legeAdminAn(u)
    const code = await ladeEin(u, admin.cookies)
    expect(
      (await registriere(u, { email: 'a@example.com', password: 'geheim12345', name: 'A', code }))
        .statusCode,
    ).toBe(403)
  })

  it('prüft einen Code, ohne ihn zu verbrauchen — Schritt 1 der Registrierung', async () => {
    const u = await baueTestApp()
    const admin = await legeAdminAn(u)
    const code = await ladeEin(u, admin.cookies)
    const pruefen = (wert: string) =>
      u.app.inject({ method: 'POST', url: '/api/auth/check-invitation', payload: { code: wert } })

    const gut = await pruefen(code)
    expect(gut.statusCode).toBe(200)
    expect(gut.json()).toMatchObject({ ok: true, required: true })
    // Zweimal prüfen ändert nichts — verbraucht wird erst beim Anlegen
    expect((await pruefen(code)).statusCode).toBe(200)
    const liste = await u.app.inject({
      method: 'GET',
      url: '/api/admin/invitations',
      cookies: admin.cookies,
    })
    expect((liste.json() as { invitations: Array<{ state: string }> }).invitations[0]?.state).toBe(
      'open',
    )
    // … und danach lässt er sich noch einlösen
    expect(
      (await registriere(u, { email: 'a@example.com', password: 'geheim12345', name: 'A', code }))
        .statusCode,
    ).toBe(201)
  })

  it('nennt beim Prüfen denselben Grund wie beim Registrieren', async () => {
    const u = await baueTestApp()
    const admin = await legeAdminAn(u)
    const unbekannt = await u.app.inject({
      method: 'POST',
      url: '/api/auth/check-invitation',
      payload: { code: 'XXXX-XXXX' },
    })
    expect(unbekannt.statusCode).toBe(403)
    expect(unbekannt.json()).toMatchObject({ error: expect.stringContaining('gibt es nicht') })

    const code = await ladeEin(u, admin.cookies)
    await registriere(u, { email: 'a@example.com', password: 'geheim12345', name: 'A', code })
    const verbraucht = await u.app.inject({
      method: 'POST',
      url: '/api/auth/check-invitation',
      payload: { code },
    })
    expect(verbraucht.statusCode).toBe(403)
    expect(verbraucht.json()).toMatchObject({ error: expect.stringContaining('eingelöst') })
  })

  it('winkt ohne Einladungspflicht jeden Code durch, statt auszusperren', async () => {
    const u = await baueTestApp()
    oeffneRegistrierung(u)
    const antwort = await u.app.inject({
      method: 'POST',
      url: '/api/auth/check-invitation',
      payload: { code: 'EGAL-EGAL' },
    })
    expect(antwort.statusCode).toBe(200)
    expect(antwort.json()).toMatchObject({ ok: true, required: false })
  })

  it('prüft gar nicht erst, wenn die Umgebung die Registrierung abschaltet', async () => {
    const u = await baueTestApp(undefined, undefined, undefined, { registrationOpen: false })
    const admin = await legeAdminAn(u)
    const code = await ladeEin(u, admin.cookies)
    const antwort = await u.app.inject({
      method: 'POST',
      url: '/api/auth/check-invitation',
      payload: { code },
    })
    expect(antwort.statusCode).toBe(403)
    expect(antwort.json()).toMatchObject({ error: expect.stringContaining('keine neuen Konten') })
  })

  it('bremst das Durchprobieren von Codes', async () => {
    const u = await baueTestApp()
    let letzte = 0
    // Die Bremse steht bei 12 je Fenster — der 13. Versuch muss abprallen.
    for (let i = 0; i < 14; i++) {
      const antwort = await u.app.inject({
        method: 'POST',
        url: '/api/auth/check-invitation',
        payload: { code: `AAAA-${String(i).padStart(4, '0')}` },
      })
      letzte = antwort.statusCode
    }
    expect(letzte).toBe(429)
  })

  it('meldet den Registrierungsmodus auch ohne Anmeldung — das Formular fragt danach', async () => {
    const u = await baueTestApp()
    const zu = await u.app.inject({ method: 'GET', url: '/api/auth/me' })
    expect(zu.json()).toMatchObject({
      user: null,
      registration: { open: true, invitationRequired: true },
    })
    oeffneRegistrierung(u)
    const offen = await u.app.inject({ method: 'GET', url: '/api/auth/me' })
    expect(offen.json()).toMatchObject({ registration: { invitationRequired: false } })
  })
})

describe('System-Mails verwalten', () => {
  const defaultContent = () => getTemplate('verification').defaultContent

  it('verwehrt gewöhnlichen Konten jeden Zugriff (403)', async () => {
    const u = await baueTestApp()
    const c = u.cookies
    expect(
      (await u.app.inject({ method: 'GET', url: '/api/admin/mail-templates', cookies: c }))
        .statusCode,
    ).toBe(403)
    expect(
      (
        await u.app.inject({
          method: 'PATCH',
          url: '/api/admin/mail-templates/reset',
          cookies: c,
          payload: defaultContent(),
        })
      ).statusCode,
    ).toBe(403)
    expect(
      (
        await u.app.inject({
          method: 'POST',
          url: '/api/admin/mail-templates/reset/test',
          cookies: c,
          payload: {},
        })
      ).statusCode,
    ).toBe(403)
    expect(
      (await u.app.inject({ method: 'DELETE', url: '/api/admin/mail-templates/reset', cookies: c }))
        .statusCode,
    ).toBe(403)
  })

  it('listet alle Vorlagen mit Standardtext, Platzhaltern und Anpassungsstand', async () => {
    const u = await baueTestApp()
    const admin = await legeAdminAn(u)
    const antwort = await u.app.inject({
      method: 'GET',
      url: '/api/admin/mail-templates',
      cookies: admin.cookies,
    })
    expect(antwort.statusCode).toBe(200)
    const { templates } = antwort.json() as { templates: Array<Record<string, unknown>> }
    expect(templates).toHaveLength(6)
    expect(templates[0]).toMatchObject({ key: 'verification', customized: false })
    expect(templates[0]?.placeholders).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'link' })]),
    )
  })

  it('speichert einen angepassten Text und verschickt ihn danach', async () => {
    const u = await baueTestApp()
    oeffneRegistrierung(u)
    const admin = await legeAdminAn(u)
    const antwort = await u.app.inject({
      method: 'PATCH',
      url: '/api/admin/mail-templates/verification',
      cookies: admin.cookies,
      payload: { ...defaultContent(), title: 'Servus {{name}}', button: 'Jetzt bestätigen' },
    })
    expect(antwort.statusCode).toBe(200)

    await u.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'neu@example.com', password: 'geheim12345', name: 'Mira' },
    })
    const mail = u.mail.nachrichten.at(-1)
    expect(mail?.text).toContain('Servus Mira')
    expect(mail?.html).toContain('Jetzt bestätigen')
    // Beide Fassungen gehen raus — der Text-Teil bleibt Pflicht.
    expect(mail?.text).toContain('#verify=')
  })

  it('lehnt eine Fassung ab, die den Empfänger nirgendwohin führt', async () => {
    const u = await baueTestApp()
    const admin = await legeAdminAn(u)
    const antwort = await u.app.inject({
      method: 'PATCH',
      url: '/api/admin/mail-templates/verification',
      cookies: admin.cookies,
      payload: { ...defaultContent(), button: '' },
    })
    expect(antwort.statusCode).toBe(400)
    expect(antwort.json()).toMatchObject({ error: expect.stringContaining('{{link}}') })
    // Nichts gespeichert: Die Vorlage hängt weiter am Code.
    expect(u.app.mailTemplates.blocks2('verification')).toEqual(defaultContent())
  })

  it('kennt keine erfundenen Vorlagen', async () => {
    const u = await baueTestApp()
    const admin = await legeAdminAn(u)
    expect(
      (
        await u.app.inject({
          method: 'PATCH',
          url: '/api/admin/mail-templates/rechnung',
          cookies: admin.cookies,
          payload: defaultContent(),
        })
      ).statusCode,
    ).toBe(404)
    expect(
      (
        await u.app.inject({
          method: 'DELETE',
          url: '/api/admin/mail-templates/rechnung',
          cookies: admin.cookies,
        })
      ).statusCode,
    ).toBe(404)
    expect(
      (
        await u.app.inject({
          method: 'POST',
          url: '/api/admin/mail-templates/rechnung/preview',
          cookies: admin.cookies,
          payload: defaultContent(),
        })
      ).statusCode,
    ).toBe(404)
  })

  it('setzt auf den Auslieferungstext zurück', async () => {
    const u = await baueTestApp()
    const admin = await legeAdminAn(u)
    await u.app.inject({
      method: 'PATCH',
      url: '/api/admin/mail-templates/reset',
      cookies: admin.cookies,
      payload: { ...getTemplate('reset').defaultContent, title: 'Anders' },
    })
    const antwort = await u.app.inject({
      method: 'DELETE',
      url: '/api/admin/mail-templates/reset',
      cookies: admin.cookies,
    })
    expect(antwort.statusCode).toBe(200)
    const { templates } = antwort.json() as {
      templates: Array<{ key: string; customized: boolean }>
    }
    expect(templates.find((v) => v.key === 'reset')?.customized).toBe(false)
  })

  it('rendert die Vorschau mit Beispielwerten, ohne etwas zu speichern', async () => {
    const u = await baueTestApp()
    const admin = await legeAdminAn(u)
    const antwort = await u.app.inject({
      method: 'POST',
      url: '/api/admin/mail-templates/waitlist-invitation/preview',
      cookies: admin.cookies,
      payload: getTemplate('waitlist-invitation').defaultContent,
    })
    expect(antwort.statusCode).toBe(200)
    const erg = antwort.json() as { html: string; subject: string; issues: string[] }
    expect(erg.html).toContain('MAPT-4F7K')
    expect(erg.html).not.toContain('{{')
    expect(erg.issues).toEqual([])
    expect(u.app.mailTemplates.all().every((v) => !v.customized)).toBe(true)
  })

  it('meldet in der Vorschau dieselben Probleme, an denen das Speichern scheitert', async () => {
    const u = await baueTestApp()
    const admin = await legeAdminAn(u)
    const antwort = await u.app.inject({
      method: 'POST',
      url: '/api/admin/mail-templates/reset/preview',
      cookies: admin.cookies,
      payload: { ...getTemplate('reset').defaultContent, subject: '' },
    })
    expect(antwort.statusCode).toBe(200)
    expect((antwort.json() as { issues: string[] }).issues.join(' ')).toContain('Betreff')
  })

  it('schickt die Testmail an die eigene Adresse — und an keine andere', async () => {
    const u = await baueTestApp()
    const admin = await legeAdminAn(u)
    const vorher = u.mail.nachrichten.length
    const antwort = await u.app.inject({
      method: 'POST',
      url: '/api/admin/mail-templates/verification/test',
      cookies: admin.cookies,
      payload: { blocks: { ...defaultContent(), title: 'Probe' } },
    })
    expect(antwort.statusCode).toBe(200)
    expect(antwort.json()).toMatchObject({ ok: true, to: 'chefin@example.com' })
    expect(u.mail.nachrichten.length).toBe(vorher + 1)
    const mail = u.mail.nachrichten.at(-1)
    expect(mail?.to2).toBe('chefin@example.com')
    // Als Test erkennbar, damit niemand sie für die echte Mail hält.
    expect(mail?.subject.startsWith('[Test] ')).toBe(true)
    expect(mail?.html).toContain('Probe')
  })

  it('nimmt für die Testmail ohne mitgeschickte Fassung den gespeicherten Stand', async () => {
    const u = await baueTestApp()
    const admin = await legeAdminAn(u)
    await u.app.inject({
      method: 'PATCH',
      url: '/api/admin/mail-templates/reset',
      cookies: admin.cookies,
      payload: { ...getTemplate('reset').defaultContent, title: 'Gespeichert' },
    })
    await u.app.inject({
      method: 'POST',
      url: '/api/admin/mail-templates/reset/test',
      cookies: admin.cookies,
      payload: {},
    })
    expect(u.mail.nachrichten.at(-1)?.html).toContain('Gespeichert')
  })

  it('meldet einen gescheiterten Versand, statt Erfolg zu behaupten', async () => {
    const u = await baueTestApp()
    const admin = await legeAdminAn(u)
    u.mail.send = async () => {
      throw new Error('SMTP tot')
    }
    const antwort = await u.app.inject({
      method: 'POST',
      url: '/api/admin/mail-templates/reset/test',
      cookies: admin.cookies,
      payload: {},
    })
    expect(antwort.statusCode).toBe(502)
  })
})

describe('Betriebsprotokoll', () => {
  it('liegt hinter der Admin-Schranke', async () => {
    const u = await baueTestApp()
    const ohne = await u.app.inject({ method: 'GET', url: '/api/admin/audit-log' })
    expect(ohne.statusCode).toBe(401)
    const alsNutzer = await u.app.inject({
      method: 'GET',
      url: '/api/admin/audit-log',
      cookies: u.cookies,
    })
    expect(alsNutzer.statusCode).toBe(403)
  })

  it('gibt die Meldungen neueste-zuerst aus, mit Zähler und Startzeit', async () => {
    const u = await baueTestApp()
    const admin = await legeAdminAn(u)
    u.app.auditLog.write('warning', 'Bildanalyse: HTTP 429 (Rate-Limit)')
    u.app.auditLog.write('failed', 'Anreicherung fehlgeschlagen', 'Track nicht lesbar')

    const antwort = await u.app.inject({
      method: 'GET',
      url: '/api/admin/audit-log',
      cookies: admin.cookies,
    })
    expect(antwort.statusCode).toBe(200)
    const koerper = antwort.json() as {
      entries: Array<{ no: number; level: string; text: string; detail?: string }>
      total: number
      error: number
      startedAt: string
    }
    expect(koerper.entries.map((e) => e.level)).toEqual(['failed', 'warning'])
    expect(koerper.entries[0]?.detail).toBe('Track nicht lesbar')
    expect(koerper).toMatchObject({ total: 2, errorCount: 1 })
    expect(Number.isFinite(Date.parse(koerper.startedAt))).toBe(true)
  })

  it('filtert nach Stufe und liefert mit `seit` nur das Neue', async () => {
    // Die offene Ansicht fragt im Sekundentakt nach — ohne `seit` wäre jede
    // Antwort eine Wiederholung der ganzen Liste.
    const u = await baueTestApp()
    const admin = await legeAdminAn(u)
    u.app.auditLog.write('warning', 'alt')
    u.app.auditLog.write('failed', 'schlimm')
    u.app.auditLog.write('warning', 'neu')

    const nurFehler = await u.app.inject({
      method: 'GET',
      url: '/api/admin/audit-log?level=failed',
      cookies: admin.cookies,
    })
    expect((nurFehler.json() as { entries: unknown[] }).entries).toHaveLength(1)

    const seit = await u.app.inject({
      method: 'GET',
      url: '/api/admin/audit-log?since=2',
      cookies: admin.cookies,
    })
    expect(
      (seit.json() as { entries: Array<{ text: string }> }).entries.map((e) => e.text),
    ).toEqual(['neu'])
  })
})
