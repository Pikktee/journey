// Die Warteliste: Double-Opt-in, Austragen und das gezielte Freischalten.
//
// Drei Verträge, die man beim Umbauen leicht verliert:
//   1. Die öffentlichen Routen antworten IMMER gleich — sonst wird die Route zur
//      Auskunft darüber, wer sich bei Maptale angemeldet hat.
//   2. Eine Mail geht nur an bestätigte Adressen. Genau dagegen ist das
//      Double-Opt-in gebaut.
//   3. Scheitert der Versand, bleibt kein Code zurück, den niemand bekommen hat.

import { describe, expect, it } from 'vitest'
import type { MailNachricht } from '../src/mail.js'
import { baueTestApp, legeAdminAn, type TestUmgebung } from './helfer.js'
import { wartelisteAngeboten } from '../src/auth/warteliste.js'

/** Trägt eine Adresse ein und zieht den Bestätigungs-Token aus der Mail. */
async function trageEin(u: TestUmgebung, email: string, notiz?: string): Promise<string> {
  const antwort = await u.app.inject({
    method: 'POST',
    url: '/api/auth/warteliste',
    payload: notiz ? { email, notiz } : { email },
  })
  expect(antwort.statusCode).toBe(200)
  const link = u.mail.letzterLink() ?? ''
  const token = link.match(/#warteliste=(.+)$/)?.[1]
  expect(token, `kein Bestätigungslink in: ${link}`).toBeTruthy()
  return token as string
}

async function bestaetige(u: TestUmgebung, token: string): Promise<number> {
  const antwort = await u.app.inject({
    method: 'POST',
    url: '/api/auth/warteliste/bestaetigen',
    payload: { token },
  })
  return antwort.statusCode
}

describe('Warteliste — eintragen und bestätigen', () => {
  it('schickt eine Bestätigungsmail und zählt den Eintrag erst nach dem Klick', async () => {
    const u = await baueTestApp()
    const token = await trageEin(u, 'anna@example.com', 'Radtouren in den Alpen')

    expect(u.mail.nachrichten.at(-1)?.an).toBe('anna@example.com')
    expect(u.app.warteliste.alle()[0]?.zustand).toBe('unbestaetigt')

    expect(await bestaetige(u, token)).toBe(200)
    const eintrag = u.app.warteliste.alle()[0]
    expect(eintrag?.zustand).toBe('wartend')
    expect(eintrag?.notiz).toBe('Radtouren in den Alpen')
  })

  it('nimmt denselben Klick zweimal hin (Mail-Scanner öffnen Links vorab)', async () => {
    const u = await baueTestApp()
    const token = await trageEin(u, 'anna@example.com')
    expect(await bestaetige(u, token)).toBe(200)
    expect(await bestaetige(u, token)).toBe(200)
  })

  it('antwortet gleich und schickt NICHTS, wenn die Adresse schon ein Konto hat', async () => {
    const u = await baueTestApp()
    const vorher = u.mail.nachrichten.length
    const antwort = await u.app.inject({
      method: 'POST',
      url: '/api/auth/warteliste',
      payload: { email: 'test@example.com' }, // der Testbenutzer aus baueTestApp
    })
    expect(antwort.statusCode).toBe(200)
    expect(antwort.json()).toEqual({ ok: true })
    expect(u.mail.nachrichten.length).toBe(vorher)
    expect(u.app.warteliste.alle()).toHaveLength(0)
  })

  it('schickt einem bereits Bestätigten keine zweite Mail, antwortet aber gleich', async () => {
    const u = await baueTestApp()
    const token = await trageEin(u, 'anna@example.com')
    await bestaetige(u, token)
    const vorher = u.mail.nachrichten.length

    const antwort = await u.app.inject({
      method: 'POST',
      url: '/api/auth/warteliste',
      payload: { email: 'anna@example.com' },
    })
    expect(antwort.statusCode).toBe(200)
    expect(u.mail.nachrichten.length).toBe(vorher)
    expect(u.app.warteliste.alle()).toHaveLength(1)
  })

  it('erneuert den Token bei einem zweiten Anlauf und behält die erste Notiz', async () => {
    const u = await baueTestApp()
    const alt = await trageEin(u, 'anna@example.com', 'Radtouren')
    const neu = await trageEin(u, 'anna@example.com')
    expect(neu).not.toBe(alt)
    expect(await bestaetige(u, alt)).toBe(400)
    expect(await bestaetige(u, neu)).toBe(200)
    expect(u.app.warteliste.alle()[0]?.notiz).toBe('Radtouren')
  })

  it('weist einen unbekannten Token ab', async () => {
    const u = await baueTestApp()
    expect(await bestaetige(u, 'lhb_gibtsnicht')).toBe(400)
  })

  it('bleibt zu, solange die Warteliste nicht angeboten wird', async () => {
    const u = await baueTestApp()
    u.app.warteliste.setzeOffen(false)
    const antwort = await u.app.inject({
      method: 'POST',
      url: '/api/auth/warteliste',
      payload: { email: 'anna@example.com' },
    })
    expect(antwort.statusCode).toBe(403)
  })

  it('steht nicht vor der Tür, wenn sich ohnehin jeder anmelden kann', async () => {
    const u = await baueTestApp()
    u.app.einladungen.setzePflicht(false)
    const antwort = await u.app.inject({
      method: 'POST',
      url: '/api/auth/warteliste',
      payload: { email: 'anna@example.com' },
    })
    expect(antwort.statusCode).toBe(403)
    const me = await u.app.inject({ method: 'GET', url: '/api/auth/me' })
    expect(me.json().registrierung.warteliste).toBe(false)
  })

  it('meldet das Angebot in /auth/me — auch ohne Anmeldung', async () => {
    const u = await baueTestApp()
    const me = await u.app.inject({ method: 'GET', url: '/api/auth/me' })
    expect(me.json().registrierung).toMatchObject({ einladungPflicht: true, warteliste: true })
  })
})

describe('wartelisteAngeboten', () => {
  it('gilt nur, wo die Tür nicht ohnehin offen steht', () => {
    // Schalter aus → nie
    expect(wartelisteAngeboten(false, true, true)).toBe(false)
    // Einladung Pflicht → ja
    expect(wartelisteAngeboten(true, true, true)).toBe(true)
    // Registrierung ganz zu → erst recht ja
    expect(wartelisteAngeboten(true, false, false)).toBe(true)
    // Offene Registrierung ohne Codepflicht → überflüssig
    expect(wartelisteAngeboten(true, false, true)).toBe(false)
  })
})

describe('Warteliste — austragen', () => {
  it('löscht den Eintrag über den Token aus der Mail', async () => {
    const u = await baueTestApp()
    const token = await trageEin(u, 'anna@example.com')
    await bestaetige(u, token)

    const antwort = await u.app.inject({
      method: 'POST',
      url: '/api/auth/warteliste/austragen',
      payload: { token },
    })
    expect(antwort.statusCode).toBe(200)
    expect(u.app.warteliste.alle()).toHaveLength(0)
  })

  // Die Adresse steht als Notiz an der Einladung. Bleibt die stehen, ist
  // „gelöscht" eine Lüge — außer sie wurde schon eingelöst, dann gibt es ein
  // Konto und die Einladung ist dessen Herkunftsnachweis.
  it('nimmt die noch offene Einladung mit, die auf diese Adresse wartet', async () => {
    const u = await baueTestApp()
    const admin = await legeAdminAn(u)
    const token = await trageEin(u, 'anna@example.com')
    await bestaetige(u, token)
    const id = u.app.warteliste.alle()[0]?.id as string
    await u.app.inject({
      method: 'POST',
      url: `/api/admin/warteliste/${id}/einladen`,
      cookies: admin.cookies,
      payload: {},
    })
    // NICHT letzterLink(): Der Text trägt zuerst den Einladungs-, dann den
    // Austragen-Link — die Hilfsfunktion greift den ersten.
    const austragToken = (u.mail.nachrichten.at(-1)?.text ?? '').match(
      /#warteliste-austragen=(\S+)/,
    )?.[1] as string

    await u.app.inject({
      method: 'POST',
      url: '/api/auth/warteliste/austragen',
      payload: { token: austragToken },
    })
    expect(u.app.warteliste.alle()).toHaveLength(0)
    expect(u.app.einladungen.alle()).toHaveLength(0)
  })

  it('lässt eine bereits eingelöste Einladung stehen', async () => {
    const u = await baueTestApp()
    const admin = await legeAdminAn(u)
    const token = await trageEin(u, 'anna@example.com')
    await bestaetige(u, token)
    const id = u.app.warteliste.alle()[0]?.id as string
    const einladen = await u.app.inject({
      method: 'POST',
      url: `/api/admin/warteliste/${id}/einladen`,
      cookies: admin.cookies,
      payload: {},
    })
    // NICHT letzterLink(): Der Text trägt zuerst den Einladungs-, dann den
    // Austragen-Link — die Hilfsfunktion greift den ersten.
    const austragToken = (u.mail.nachrichten.at(-1)?.text ?? '').match(
      /#warteliste-austragen=(\S+)/,
    )?.[1] as string
    await u.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: 'anna@example.com',
        passwort: 'lampe wolke treppe',
        code: einladen.json().einladung.code,
      },
    })

    await u.app.inject({
      method: 'POST',
      url: '/api/auth/warteliste/austragen',
      payload: { token: austragToken },
    })
    expect(u.app.warteliste.alle()).toHaveLength(0)
    expect(u.app.einladungen.alle()).toHaveLength(1)
  })

  it('sagt auch bei einem toten Token „ok" — das Ziel ist erreicht', async () => {
    const u = await baueTestApp()
    const antwort = await u.app.inject({
      method: 'POST',
      url: '/api/auth/warteliste/austragen',
      payload: { token: 'lhb_langeweg' },
    })
    expect(antwort.statusCode).toBe(200)
  })
})

describe('Warteliste — freischalten', () => {
  it('erzeugt einen Code, verschickt ihn und merkt den Eintrag als eingeladen', async () => {
    const u = await baueTestApp()
    const admin = await legeAdminAn(u)
    const token = await trageEin(u, 'anna@example.com')
    await bestaetige(u, token)
    const id = u.app.warteliste.alle()[0]?.id as string

    const antwort = await u.app.inject({
      method: 'POST',
      url: `/api/admin/warteliste/${id}/einladen`,
      cookies: admin.cookies,
      payload: {},
    })
    expect(antwort.statusCode).toBe(200)
    const { einladung } = antwort.json()

    // Die Mail trägt Code UND einen Weg hinaus
    const mail = u.mail.nachrichten.at(-1) as MailNachricht
    expect(mail.an).toBe('anna@example.com')
    expect(mail.text).toContain(einladung.code)
    expect(mail.text).toContain('#warteliste-austragen=')

    // Der Eintrag zeigt den Faden zur Einladung, die Einladung die Adresse
    expect(u.app.warteliste.alle()[0]).toMatchObject({
      zustand: 'eingeladen',
      eingeladenCode: einladung.code,
    })
    expect(u.app.einladungen.alle()[0]?.notiz).toBe('anna@example.com')

    // Der Code aus der Mail trägt tatsächlich durch die Registrierung
    const registrierung = await u.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'anna@example.com', passwort: 'lampe wolke treppe', code: einladung.code },
    })
    expect(registrierung.statusCode).toBe(201)
  })

  it('lädt niemanden ein, der nicht bestätigt hat', async () => {
    const u = await baueTestApp()
    const admin = await legeAdminAn(u)
    await trageEin(u, 'anna@example.com')
    const id = u.app.warteliste.alle()[0]?.id as string
    const vorher = u.mail.nachrichten.length

    const antwort = await u.app.inject({
      method: 'POST',
      url: `/api/admin/warteliste/${id}/einladen`,
      cookies: admin.cookies,
      payload: {},
    })
    expect(antwort.statusCode).toBe(409)
    expect(u.mail.nachrichten.length).toBe(vorher)
    expect(u.app.einladungen.alle()).toHaveLength(0)
  })

  it('lädt niemanden zweimal ein', async () => {
    const u = await baueTestApp()
    const admin = await legeAdminAn(u)
    const token = await trageEin(u, 'anna@example.com')
    await bestaetige(u, token)
    const id = u.app.warteliste.alle()[0]?.id as string
    // Kein `ReturnType<typeof inject>`: `inject` ist überladen und liefert ohne
    // Callback die thenable `Chain` — der Rückgabetyp der Signatur passt nicht
    // auf das Promise, das hier tatsächlich herauskommt.
    const einladen = async (): Promise<number> => {
      const antwort = await u.app.inject({
        method: 'POST',
        url: `/api/admin/warteliste/${id}/einladen`,
        cookies: admin.cookies,
        payload: {},
      })
      return antwort.statusCode
    }

    expect(await einladen()).toBe(200)
    expect(await einladen()).toBe(409)
    expect(u.app.einladungen.alle()).toHaveLength(1)
  })

  it('nimmt den Code zurück, wenn die Mail nicht rausgeht', async () => {
    const u = await baueTestApp()
    const admin = await legeAdminAn(u)
    const token = await trageEin(u, 'anna@example.com')
    await bestaetige(u, token)
    const id = u.app.warteliste.alle()[0]?.id as string
    // Die Methode DER INSTANZ ersetzen, nicht app.deps.mail: Die Routen halten
    // den Versand seit dem Registrieren in ihrer Closure.
    u.mail.sende = async (n) => {
      throw new Error(`SMTP tot (${n.betreff})`)
    }

    const antwort = await u.app.inject({
      method: 'POST',
      url: `/api/admin/warteliste/${id}/einladen`,
      cookies: admin.cookies,
      payload: {},
    })
    expect(antwort.statusCode).toBe(502)
    expect(u.app.einladungen.alle()).toHaveLength(0)
    expect(u.app.warteliste.alle()[0]?.zustand).toBe('wartend')
  })

  it('hält Nicht-Admins von der Liste fern', async () => {
    const u = await baueTestApp()
    const antwort = await u.app.inject({
      method: 'GET',
      url: '/api/admin/warteliste',
      cookies: u.cookies,
    })
    expect(antwort.statusCode).toBe(403)
  })

  it('entfernt einen Eintrag auf Zuruf', async () => {
    const u = await baueTestApp()
    const admin = await legeAdminAn(u)
    await trageEin(u, 'anna@example.com')
    const id = u.app.warteliste.alle()[0]?.id as string

    const antwort = await u.app.inject({
      method: 'DELETE',
      url: `/api/admin/warteliste/${id}`,
      cookies: admin.cookies,
    })
    expect(antwort.statusCode).toBe(200)
    expect(u.app.warteliste.alle()).toHaveLength(0)
  })

  it('legt beide Schalter über dieselbe Route um', async () => {
    const u = await baueTestApp()
    const admin = await legeAdminAn(u)
    const antwort = await u.app.inject({
      method: 'PATCH',
      url: '/api/admin/einstellungen',
      cookies: admin.cookies,
      payload: { wartelisteOffen: false },
    })
    expect(antwort.json()).toEqual({ einladungPflicht: true, wartelisteOffen: false })
    expect(u.app.warteliste.offen()).toBe(false)
  })
})

describe('Warteliste — Fristen', () => {
  it('löscht Unbestätigtes nach zwei Wochen, Wartende erst nach einem Jahr', async () => {
    const u = await baueTestApp()
    await trageEin(u, 'alt@example.com')
    await trageEin(u, 'frisch@example.com')
    const wartend = await trageEin(u, 'geduldig@example.com')
    await bestaetige(u, wartend)

    // Den alten Eintrag künstlich altern lassen (20 Tage)
    const zwanzigTage = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString()
    u.app.deps.db
      .prepare('UPDATE warteliste SET eingetragen_am = ? WHERE email = ?')
      .run(zwanzigTage, 'alt@example.com')

    expect(u.app.warteliste.raeumeAuf()).toBe(1)
    expect(u.app.warteliste.alle().map((e) => e.email)).toEqual([
      'frisch@example.com',
      'geduldig@example.com',
    ])
  })

  it('löscht Eingeladene, sobald ihr Code lange durch ist', async () => {
    const u = await baueTestApp()
    const token = await trageEin(u, 'anna@example.com')
    await bestaetige(u, token)
    const id = u.app.warteliste.alle()[0]?.id as string
    u.app.warteliste.markiereEingeladen(id, 'ABCD-2345')

    const langeHer = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString()
    u.app.deps.db.prepare('UPDATE warteliste SET eingeladen_am = ? WHERE id = ?').run(langeHer, id)

    expect(u.app.warteliste.raeumeAuf()).toBe(1)
    expect(u.app.warteliste.alle()).toHaveLength(0)
  })
})
