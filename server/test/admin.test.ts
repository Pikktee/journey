// Benutzerverwaltung: Rechte, Konto-CRUD, Einladungen und die Kopplung der
// Registrierung an einen Code — end-to-end über fastify.inject.
//
// Der Testbenutzer aus baueTestApp ist bewusst KEIN Admin: Jede Route wird
// einmal mit ihm angeklopft, damit die Rechteprüfung nicht nur behauptet wird.

import { describe, expect, it } from 'vitest'
import { baueTestApp, beispielManifest, legeAdminAn, oeffneRegistrierung, type TestUmgebung } from './helfer.js'

const registriere = (u: TestUmgebung, payload: Record<string, unknown>) =>
  u.app.inject({ method: 'POST', url: '/api/auth/register', payload })

/** Einladung erstellen und den Code zurückgeben. */
async function ladeEin(
  u: TestUmgebung,
  cookies: { maptale_session: string },
  koerper: Record<string, unknown> = {},
): Promise<string> {
  const antwort = await u.app.inject({ method: 'POST', url: '/api/admin/einladungen', cookies, payload: koerper })
  expect(antwort.statusCode).toBe(201)
  return (antwort.json() as { einladung: { code: string } }).einladung.code
}

describe('Zugang zur Verwaltung', () => {
  it('antwortet ohne Anmeldung mit 401 und für gewöhnliche Konten mit 403', async () => {
    const u = await baueTestApp()
    expect((await u.app.inject({ method: 'GET', url: '/api/admin/benutzer' })).statusCode).toBe(401)
    const alsNutzer = await u.app.inject({ method: 'GET', url: '/api/admin/benutzer', cookies: u.cookies })
    expect(alsNutzer.statusCode).toBe(403)
    expect(alsNutzer.json()).toMatchObject({ fehler: expect.stringContaining('Administrator') })
  })

  it('verwehrt auch die schreibenden Routen (403)', async () => {
    const u = await baueTestApp()
    const c = u.cookies
    expect((await u.app.inject({ method: 'POST', url: '/api/admin/einladungen', cookies: c, payload: {} })).statusCode).toBe(403)
    expect(
      (await u.app.inject({ method: 'PATCH', url: '/api/admin/einstellungen', cookies: c, payload: { einladungPflicht: false } }))
        .statusCode,
    ).toBe(403)
    expect((await u.app.inject({ method: 'DELETE', url: '/api/admin/benutzer/u_egal', cookies: c })).statusCode).toBe(403)
  })

  it('meldet die Rolle in /auth/me — daran hängt der Weg zur Verwaltung im Studio', async () => {
    const u = await baueTestApp()
    const admin = await legeAdminAn(u)
    const alsNutzer = await u.app.inject({ method: 'GET', url: '/api/auth/me', cookies: u.cookies })
    expect(alsNutzer.json()).toMatchObject({ benutzer: { rolle: 'nutzer' } })
    const alsAdmin = await u.app.inject({ method: 'GET', url: '/api/auth/me', cookies: admin.cookies })
    expect(alsAdmin.json()).toMatchObject({ benutzer: { rolle: 'admin' } })
  })
})

describe('Konten verwalten', () => {
  it('listet alle Konten mit Rolle, Bestätigung, Tourenzahl und Speicher', async () => {
    const u = await baueTestApp()
    const admin = await legeAdminAn(u)
    await u.app.inject({ method: 'POST', url: '/api/tours', cookies: u.cookies, payload: beispielManifest() })

    const antwort = await u.app.inject({ method: 'GET', url: '/api/admin/benutzer', cookies: admin.cookies })
    expect(antwort.statusCode).toBe(200)
    const { benutzer } = antwort.json() as {
      benutzer: Array<{ email: string; rolle: string; touren: number; speicher: number; verifiziert: boolean }>
    }
    const testerin = benutzer.find((b) => b.email === 'test@example.com')
    expect(testerin).toMatchObject({ rolle: 'nutzer', touren: 1, verifiziert: true })
    expect(testerin?.speicher).toBeGreaterThan(0)
    expect(benutzer.find((b) => b.email === 'chefin@example.com')).toMatchObject({ rolle: 'admin', touren: 0 })
  })

  it('legt ein Konto an, das sich sofort anmelden kann', async () => {
    const u = await baueTestApp()
    const admin = await legeAdminAn(u)
    const neu = await u.app.inject({
      method: 'POST',
      url: '/api/admin/benutzer',
      cookies: admin.cookies,
      payload: { email: 'Gast@Example.com', passwort: 'gastgast1', name: 'Gast' },
    })
    expect(neu.statusCode).toBe(201)
    // Adresse normalisiert, Rolle gewöhnlich, ohne Mail-Umweg bestätigt
    expect(neu.json()).toMatchObject({ benutzer: { email: 'gast@example.com', rolle: 'nutzer' } })
    const login = await u.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'gast@example.com', passwort: 'gastgast1' },
    })
    expect(login.statusCode).toBe(200)
    const me = await u.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { maptale_session: login.cookies.find((c) => c.name === 'maptale_session')?.value ?? '' },
    })
    expect(me.json()).toMatchObject({ verifiziert: true })
  })

  it('weist doppelte Adressen (409) und Unfug (400) ab', async () => {
    const u = await baueTestApp()
    const admin = await legeAdminAn(u)
    const doppelt = await u.app.inject({
      method: 'POST',
      url: '/api/admin/benutzer',
      cookies: admin.cookies,
      payload: { email: 'test@example.com', passwort: 'nochmal12', name: 'Doppelt' },
    })
    expect(doppelt.statusCode).toBe(409)
    const kaputt = await u.app.inject({
      method: 'POST',
      url: '/api/admin/benutzer',
      cookies: admin.cookies,
      payload: { email: 'ohne-at', passwort: 'egalegal1', name: 'Kaputt' },
    })
    expect(kaputt.statusCode).toBe(400)
  })

  it('ändert Name, Adresse, Rolle und Bestätigung', async () => {
    const u = await baueTestApp()
    const admin = await legeAdminAn(u)
    const ziel = u.app.auth.alleBenutzer().find((b) => b.email === 'test@example.com')!
    const antwort = await u.app.inject({
      method: 'PATCH',
      url: `/api/admin/benutzer/${ziel.id}`,
      cookies: admin.cookies,
      payload: { name: 'Neuer Name', email: 'neu@example.com', rolle: 'admin', verifiziert: false },
    })
    expect(antwort.statusCode).toBe(200)
    expect(antwort.json()).toMatchObject({
      benutzer: { name: 'Neuer Name', email: 'neu@example.com', rolle: 'admin', verifiziert: false },
    })
  })

  it('setzt ein Passwort zurück und wirft dabei die Sitzungen des Kontos ab', async () => {
    const u = await baueTestApp()
    const admin = await legeAdminAn(u)
    const ziel = u.app.auth.alleBenutzer().find((b) => b.email === 'test@example.com')!
    const antwort = await u.app.inject({
      method: 'PATCH',
      url: `/api/admin/benutzer/${ziel.id}`,
      cookies: admin.cookies,
      payload: { passwort: 'frischgesetzt1' },
    })
    expect(antwort.statusCode).toBe(200)
    // Die alte Sitzung des Ziels gilt nicht mehr …
    const me = await u.app.inject({ method: 'GET', url: '/api/auth/me', cookies: u.cookies })
    expect(me.json()).toMatchObject({ benutzer: null })
    // … das neue Passwort schon, das alte nicht
    expect(
      (await u.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'test@example.com', passwort: 'geheim123' } }))
        .statusCode,
    ).toBe(401)
    expect(
      (await u.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'test@example.com', passwort: 'frischgesetzt1' },
      })).statusCode,
    ).toBe(200)
  })

  it('löscht ein Konto samt Touren und Dateien', async () => {
    const u = await baueTestApp()
    const admin = await legeAdminAn(u)
    const tour = await u.app.inject({ method: 'POST', url: '/api/tours', cookies: u.cookies, payload: beispielManifest() })
    const tourId = (tour.json() as { id: string }).id
    expect(await u.storage.gesamtGroesse(tourId)).toBeGreaterThan(0)

    const ziel = u.app.auth.alleBenutzer().find((b) => b.email === 'test@example.com')!
    const antwort = await u.app.inject({ method: 'DELETE', url: `/api/admin/benutzer/${ziel.id}`, cookies: admin.cookies })
    expect(antwort.statusCode).toBe(200)
    expect(await u.storage.gesamtGroesse(tourId)).toBe(0)
    expect(u.app.auth.benutzerNachId(ziel.id)).toBeNull()
  })

  it('antwortet für unbekannte IDs mit 404', async () => {
    const u = await baueTestApp()
    const admin = await legeAdminAn(u)
    expect(
      (await u.app.inject({ method: 'PATCH', url: '/api/admin/benutzer/u_gibtsnicht', cookies: admin.cookies, payload: { name: 'X' } }))
        .statusCode,
    ).toBe(404)
    expect(
      (await u.app.inject({ method: 'DELETE', url: '/api/admin/benutzer/u_gibtsnicht', cookies: admin.cookies })).statusCode,
    ).toBe(404)
  })
})

describe('Selbstschutz der Verwaltung', () => {
  it('lässt den letzten Administrator weder herabstufen noch löschen', async () => {
    const u = await baueTestApp()
    const admin = await legeAdminAn(u)
    const runter = await u.app.inject({
      method: 'PATCH',
      url: `/api/admin/benutzer/${admin.id}`,
      cookies: admin.cookies,
      payload: { rolle: 'nutzer' },
    })
    expect(runter.statusCode).toBe(409)
    const weg = await u.app.inject({ method: 'DELETE', url: `/api/admin/benutzer/${admin.id}`, cookies: admin.cookies })
    expect(weg.statusCode).toBe(409)
    expect(u.app.auth.anzahlAdmins()).toBe(1)
  })

  it('lässt die eigene Admin-Rolle auch dann nicht ablegen, wenn es weitere Admins gibt', async () => {
    const u = await baueTestApp()
    const admin = await legeAdminAn(u)
    const zweiter = await legeAdminAn(u, 'zweite@example.com')
    const antwort = await u.app.inject({
      method: 'PATCH',
      url: `/api/admin/benutzer/${admin.id}`,
      cookies: admin.cookies,
      payload: { rolle: 'nutzer' },
    })
    expect(antwort.statusCode).toBe(409)
    // Eine FREMDE Admin-Rolle darf dagegen fallen
    const fremd = await u.app.inject({
      method: 'PATCH',
      url: `/api/admin/benutzer/${zweiter.id}`,
      cookies: admin.cookies,
      payload: { rolle: 'nutzer' },
    })
    expect(fremd.statusCode).toBe(200)
  })

  it('schützt die in der Konfiguration gesetzten Adressen', async () => {
    // Ohne diesen Riegel wäre die Änderung ohnehin nur bis zum nächsten Start
    // gültig — hebeAdmins holt sie zurück.
    const u = await baueTestApp(undefined, undefined, undefined, { adminEmails: ['chefin@example.com'] })
    const admin = await legeAdminAn(u)
    const zweiter = await legeAdminAn(u, 'zweite@example.com')
    const runter = await u.app.inject({
      method: 'PATCH',
      url: `/api/admin/benutzer/${admin.id}`,
      cookies: zweiter.cookies,
      payload: { rolle: 'nutzer' },
    })
    expect(runter.statusCode).toBe(409)
    expect(runter.json()).toMatchObject({ fehler: expect.stringContaining('Konfiguration') })
    const weg = await u.app.inject({ method: 'DELETE', url: `/api/admin/benutzer/${admin.id}`, cookies: zweiter.cookies })
    expect(weg.statusCode).toBe(409)
  })

  it('hebt konfigurierte Adressen beim Start auf die Admin-Rolle', async () => {
    const u = await baueTestApp()
    expect(u.app.auth.hebeAdmins(['test@example.com'])).toBe(1)
    expect(u.app.auth.benutzerNachId(u.app.auth.alleBenutzer()[0]!.id)?.rolle).toBe('admin')
    // Zweiter Lauf ändert nichts mehr (idempotent)
    expect(u.app.auth.hebeAdmins(['test@example.com'])).toBe(0)
    expect(u.app.auth.hebeAdmins([])).toBe(0)
  })
})

describe('Einladungen', () => {
  it('erstellt, listet und widerruft', async () => {
    const u = await baueTestApp()
    const admin = await legeAdminAn(u)
    const code = await ladeEin(u, admin.cookies, { notiz: 'für Anna' })
    expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/)

    const liste = await u.app.inject({ method: 'GET', url: '/api/admin/einladungen', cookies: admin.cookies })
    expect(liste.json()).toMatchObject({ einladungPflicht: true })
    const { einladungen } = liste.json() as { einladungen: Array<{ code: string; notiz: string; zustand: string; erstelltVon: string }> }
    expect(einladungen).toHaveLength(1)
    expect(einladungen[0]).toMatchObject({ code, notiz: 'für Anna', zustand: 'offen', erstelltVon: 'chefin@example.com' })

    expect((await u.app.inject({ method: 'DELETE', url: `/api/admin/einladungen/${code}`, cookies: admin.cookies })).statusCode).toBe(200)
    expect((await u.app.inject({ method: 'DELETE', url: `/api/admin/einladungen/${code}`, cookies: admin.cookies })).statusCode).toBe(404)
  })

  it('vergibt ohne Angabe eine Gültigkeit und lässt sie auf Wunsch weg', async () => {
    const u = await baueTestApp()
    const admin = await legeAdminAn(u)
    await ladeEin(u, admin.cookies)
    await ladeEin(u, admin.cookies, { gueltigTage: 0 })
    const liste = await u.app.inject({ method: 'GET', url: '/api/admin/einladungen', cookies: admin.cookies })
    const { einladungen } = liste.json() as { einladungen: Array<{ ablauf: string | null }> }
    expect(einladungen.filter((e) => e.ablauf === null)).toHaveLength(1)
    expect(einladungen.filter((e) => e.ablauf !== null)).toHaveLength(1)
  })
})

describe('Registrierung mit Einladung', () => {
  it('verlangt einen Code, solange die Pflicht steht', async () => {
    const u = await baueTestApp()
    const ohne = await registriere(u, { email: 'neu@example.com', passwort: 'geheim12345', name: 'Neu' })
    expect(ohne.statusCode).toBe(403)
    expect(ohne.json()).toMatchObject({ fehler: expect.stringContaining('Einladungscode') })
    // Kein halb angelegtes Konto zurücklassen
    expect(u.app.auth.alleBenutzer().some((b) => b.email === 'neu@example.com')).toBe(false)
  })

  it('lässt einen gültigen Code durch und verbraucht ihn dabei', async () => {
    const u = await baueTestApp()
    const admin = await legeAdminAn(u)
    const code = await ladeEin(u, admin.cookies)

    const erste = await registriere(u, { email: 'anna@example.com', passwort: 'geheim12345', name: 'Anna', code })
    expect(erste.statusCode).toBe(201)

    // Die Einladung trägt jetzt, wer sie eingelöst hat
    const liste = await u.app.inject({ method: 'GET', url: '/api/admin/einladungen', cookies: admin.cookies })
    expect((liste.json() as { einladungen: Array<{ zustand: string; eingeloestVon: string }> }).einladungen[0]).toMatchObject({
      zustand: 'eingeloest',
      eingeloestVon: 'anna@example.com',
    })

    // Ein zweites Mal geht derselbe Code nicht
    const zweite = await registriere(u, { email: 'bert@example.com', passwort: 'geheim12345', name: 'Bert', code })
    expect(zweite.statusCode).toBe(403)
    expect(zweite.json()).toMatchObject({ fehler: expect.stringContaining('eingelöst') })
  })

  it('nimmt den Code auch klein geschrieben und mit Leerzeichen', async () => {
    const u = await baueTestApp()
    const admin = await legeAdminAn(u)
    const code = await ladeEin(u, admin.cookies)
    const antwort = await registriere(u, {
      email: 'anna@example.com',
      passwort: 'geheim12345',
      name: 'Anna',
      code: ` ${code.toLowerCase()} `,
    })
    expect(antwort.statusCode).toBe(201)
  })

  it('weist unbekannte und abgelaufene Codes mit eigener Begründung ab', async () => {
    const u = await baueTestApp()
    const admin = await legeAdminAn(u)
    const unbekannt = await registriere(u, { email: 'a@example.com', passwort: 'geheim12345', name: 'A', code: 'XXXX-XXXX' })
    expect(unbekannt.json()).toMatchObject({ fehler: expect.stringContaining('gibt es nicht') })

    const code = await ladeEin(u, admin.cookies)
    u.app.deps.db.prepare('UPDATE einladungen SET ablauf = ? WHERE code = ?').run('2020-01-01T00:00:00.000Z', code)
    const abgelaufen = await registriere(u, { email: 'b@example.com', passwort: 'geheim12345', name: 'B', code })
    expect(abgelaufen.statusCode).toBe(403)
    expect(abgelaufen.json()).toMatchObject({ fehler: expect.stringContaining('abgelaufen') })
    const liste = await u.app.inject({ method: 'GET', url: '/api/admin/einladungen', cookies: admin.cookies })
    expect((liste.json() as { einladungen: Array<{ zustand: string }> }).einladungen[0]?.zustand).toBe('abgelaufen')
  })

  it('lässt ohne Pflicht jeden herein — und der Schalter überlebt den Aufruf', async () => {
    const u = await baueTestApp()
    const admin = await legeAdminAn(u)
    const aus = await u.app.inject({
      method: 'PATCH',
      url: '/api/admin/einstellungen',
      cookies: admin.cookies,
      payload: { einladungPflicht: false },
    })
    expect(aus.json()).toMatchObject({ einladungPflicht: false })
    expect((await registriere(u, { email: 'frei@example.com', passwort: 'geheim12345', name: 'Frei' })).statusCode).toBe(201)

    const wieder = await u.app.inject({
      method: 'PATCH',
      url: '/api/admin/einstellungen',
      cookies: admin.cookies,
      payload: { einladungPflicht: true },
    })
    expect(wieder.json()).toMatchObject({ einladungPflicht: true })
  })

  it('bleibt zu, wenn die Umgebung die Registrierung ganz abschaltet — auch mit gültigem Code', async () => {
    const u = await baueTestApp(undefined, undefined, undefined, { registrierungOffen: false })
    const admin = await legeAdminAn(u)
    const code = await ladeEin(u, admin.cookies)
    expect((await registriere(u, { email: 'a@example.com', passwort: 'geheim12345', name: 'A', code })).statusCode).toBe(403)
  })

  it('prüft einen Code, ohne ihn zu verbrauchen — Schritt 1 der Registrierung', async () => {
    const u = await baueTestApp()
    const admin = await legeAdminAn(u)
    const code = await ladeEin(u, admin.cookies)
    const pruefen = (wert: string) =>
      u.app.inject({ method: 'POST', url: '/api/auth/einladung-pruefen', payload: { code: wert } })

    const gut = await pruefen(code)
    expect(gut.statusCode).toBe(200)
    expect(gut.json()).toMatchObject({ ok: true, pflicht: true })
    // Zweimal prüfen ändert nichts — verbraucht wird erst beim Anlegen
    expect((await pruefen(code)).statusCode).toBe(200)
    const liste = await u.app.inject({ method: 'GET', url: '/api/admin/einladungen', cookies: admin.cookies })
    expect((liste.json() as { einladungen: Array<{ zustand: string }> }).einladungen[0]?.zustand).toBe('offen')
    // … und danach lässt er sich noch einlösen
    expect((await registriere(u, { email: 'a@example.com', passwort: 'geheim12345', name: 'A', code })).statusCode).toBe(201)
  })

  it('nennt beim Prüfen denselben Grund wie beim Registrieren', async () => {
    const u = await baueTestApp()
    const admin = await legeAdminAn(u)
    const unbekannt = await u.app.inject({
      method: 'POST',
      url: '/api/auth/einladung-pruefen',
      payload: { code: 'XXXX-XXXX' },
    })
    expect(unbekannt.statusCode).toBe(403)
    expect(unbekannt.json()).toMatchObject({ fehler: expect.stringContaining('gibt es nicht') })

    const code = await ladeEin(u, admin.cookies)
    await registriere(u, { email: 'a@example.com', passwort: 'geheim12345', name: 'A', code })
    const verbraucht = await u.app.inject({ method: 'POST', url: '/api/auth/einladung-pruefen', payload: { code } })
    expect(verbraucht.statusCode).toBe(403)
    expect(verbraucht.json()).toMatchObject({ fehler: expect.stringContaining('eingelöst') })
  })

  it('winkt ohne Einladungspflicht jeden Code durch, statt auszusperren', async () => {
    const u = await baueTestApp()
    oeffneRegistrierung(u)
    const antwort = await u.app.inject({
      method: 'POST',
      url: '/api/auth/einladung-pruefen',
      payload: { code: 'EGAL-EGAL' },
    })
    expect(antwort.statusCode).toBe(200)
    expect(antwort.json()).toMatchObject({ ok: true, pflicht: false })
  })

  it('prüft gar nicht erst, wenn die Umgebung die Registrierung abschaltet', async () => {
    const u = await baueTestApp(undefined, undefined, undefined, { registrierungOffen: false })
    const admin = await legeAdminAn(u)
    const code = await ladeEin(u, admin.cookies)
    const antwort = await u.app.inject({ method: 'POST', url: '/api/auth/einladung-pruefen', payload: { code } })
    expect(antwort.statusCode).toBe(403)
    expect(antwort.json()).toMatchObject({ fehler: expect.stringContaining('keine neuen Konten') })
  })

  it('bremst das Durchprobieren von Codes', async () => {
    const u = await baueTestApp()
    let letzte = 0
    // Die Bremse steht bei 12 je Fenster — der 13. Versuch muss abprallen.
    for (let i = 0; i < 14; i++) {
      const antwort = await u.app.inject({
        method: 'POST',
        url: '/api/auth/einladung-pruefen',
        payload: { code: `AAAA-${String(i).padStart(4, '0')}` },
      })
      letzte = antwort.statusCode
    }
    expect(letzte).toBe(429)
  })

  it('meldet den Registrierungsmodus auch ohne Anmeldung — das Formular fragt danach', async () => {
    const u = await baueTestApp()
    const zu = await u.app.inject({ method: 'GET', url: '/api/auth/me' })
    expect(zu.json()).toMatchObject({ benutzer: null, registrierung: { offen: true, einladungPflicht: true } })
    oeffneRegistrierung(u)
    const offen = await u.app.inject({ method: 'GET', url: '/api/auth/me' })
    expect(offen.json()).toMatchObject({ registrierung: { einladungPflicht: false } })
  })
})
