// Der Alpha-Eingang: Melden ohne Konto, sichten nur als Admin.
//
// Vier Verträge, die man beim Umbauen leicht verliert:
//   1. Melden geht OHNE Anmeldung — die Meldung „ich komme nicht rein" kann
//      niemand angemeldet abschicken.
//   2. Der technische Kontext ist eine feste Feldliste. Was der Client sonst
//      mitschickt, landet NICHT in der Tabelle.
//   3. Die Verwaltung liegt hinter der Admin-Rolle, auch für Angemeldete.
//   4. Fristen räumen auf; erledigte Meldungen früher als offene.

import { describe, expect, it } from 'vitest'
import { baueTestApp, legeAdminAn, type TestUmgebung } from './helfer.js'
import { FRIST_ERLEDIGT_TAGE, FRIST_OFFEN_TAGE } from '../src/rueckmeldungen.js'
import { saubereKontext } from '../src/routes/rueckmeldungen.js'

async function melde(u: TestUmgebung, payload: Record<string, unknown>) {
  return u.app.inject({ method: 'POST', url: '/api/rueckmeldung', payload })
}

describe('Rückmeldungen', () => {
  it('nimmt eine Meldung ohne Anmeldung an', async () => {
    const u = await baueTestApp()
    const antwort = await melde(u, { text: 'Der Upload bricht bei großen Videos ab.' })
    expect(antwort.statusCode).toBe(200)

    const liste = u.app.rueckmeldungen.liste()
    expect(liste).toHaveLength(1)
    expect(liste[0]?.text).toBe('Der Upload bricht bei großen Videos ab.')
    expect(liste[0]?.status).toBe('offen')
    expect(liste[0]?.benutzerId).toBeNull()
    // Ohne Angaben bleibt das Feld NULL — das ist etwas anderes als ein leeres Objekt.
    expect(liste[0]?.kontext).toBeNull()
  })

  it('hängt die Konto-Kennung an, wenn jemand angemeldet meldet', async () => {
    const u = await baueTestApp()
    const admin = await legeAdminAn(u)
    const antwort = await u.app.inject({
      method: 'POST',
      url: '/api/rueckmeldung',
      cookies: admin.cookies,
      payload: { text: 'Die Zeitleiste springt beim Ziehen.' },
    })
    expect(antwort.statusCode).toBe(200)
    const eine = u.app.rueckmeldungen.liste()[0]
    expect(eine?.benutzerId).toBe(admin.id)
    // Der Name kommt aus dem JOIN, damit die Liste nicht nur Kennungen zeigt.
    expect(eine?.benutzerName).toBe('Chefin')
  })

  it('nimmt nur die bekannten Kontext-Felder', async () => {
    const u = await baueTestApp()
    await melde(u, {
      text: 'Karte bleibt schwarz.',
      kontext: {
        seite: '/tour/t_abc',
        version: '0.60.5',
        browser: 'Chrome 141 auf macOS',
        // Nichts davon darf ankommen: Der Client entscheidet OB, der Server WAS.
        cookie: 'maptale_session=geheim',
        passwort: 'hunter2',
        standort: '50.11,8.68',
      },
    })
    const kontext = u.app.rueckmeldungen.liste()[0]?.kontext
    expect(kontext).toEqual({
      seite: '/tour/t_abc',
      version: '0.60.5',
      browser: 'Chrome 141 auf macOS',
    })
  })

  it('verwirft eine unbrauchbare Adresse, ohne die Meldung abzulehnen', async () => {
    const u = await baueTestApp()
    const antwort = await melde(u, { text: 'Bitte Dark Mode.', email: 'keine-adresse' })
    expect(antwort.statusCode).toBe(200)
    expect(u.app.rueckmeldungen.liste()[0]?.email).toBeNull()

    await melde(u, { text: 'Noch etwas.', email: 'mira@example.com' })
    expect(u.app.rueckmeldungen.liste()[0]?.email).toBe('mira@example.com')
  })

  it('bremst einen Schwall aus derselben Quelle', async () => {
    const u = await baueTestApp()
    let letzte = 200
    for (let i = 0; i < 12; i++) {
      letzte = (await melde(u, { text: `Meldung ${i}` })).statusCode
    }
    expect(letzte).toBe(429)
  })

  it('zeigt und ändert den Eingang nur für Admins', async () => {
    const u = await baueTestApp()
    await melde(u, { text: 'Etwas stimmt nicht.' })

    const ohne = await u.app.inject({ method: 'GET', url: '/api/admin/rueckmeldungen' })
    expect(ohne.statusCode).toBe(401)

    const admin = await legeAdminAn(u)
    const mit = await u.app.inject({
      method: 'GET',
      url: '/api/admin/rueckmeldungen',
      cookies: admin.cookies,
    })
    expect(mit.statusCode).toBe(200)
    const { rueckmeldungen, zaehlung } = mit.json()
    expect(rueckmeldungen).toHaveLength(1)
    expect(zaehlung).toMatchObject({ offen: 1, gesamt: 1 })

    const id = rueckmeldungen[0].id
    const geaendert = await u.app.inject({
      method: 'PATCH',
      url: `/api/admin/rueckmeldungen/${id}`,
      cookies: admin.cookies,
      payload: { status: 'erledigt', notiz: 'War ein Bedienfehler.' },
    })
    expect(geaendert.statusCode).toBe(200)
    expect(geaendert.json().rueckmeldung).toMatchObject({
      status: 'erledigt',
      notiz: 'War ein Bedienfehler.',
    })
  })

  it('filtert nach Status und zählt je Status', async () => {
    const u = await baueTestApp()
    const admin = await legeAdminAn(u)
    const a = u.app.rueckmeldungen.nimmAn({ text: 'A' })
    u.app.rueckmeldungen.nimmAn({ text: 'B' })
    u.app.rueckmeldungen.aktualisiere(a.id, { status: 'in_arbeit' })

    const antwort = await u.app.inject({
      method: 'GET',
      url: '/api/admin/rueckmeldungen?status=offen',
      cookies: admin.cookies,
    })
    expect(antwort.json().rueckmeldungen).toHaveLength(1)
    expect(antwort.json().rueckmeldungen[0].text).toBe('B')
    expect(antwort.json().zaehlung).toMatchObject({ offen: 1, in_arbeit: 1, gesamt: 2 })
  })

  it('behält die Meldung, wenn das Konto gelöscht wird', async () => {
    const u = await baueTestApp()
    const admin = await legeAdminAn(u, 'weg@example.com')
    u.app.rueckmeldungen.nimmAn({ text: 'Bleibt erhalten.', benutzerId: admin.id })
    u.app.deps.db.prepare('DELETE FROM users WHERE id = ?').run(admin.id)

    const eine = u.app.rueckmeldungen.liste()[0]
    expect(eine?.text).toBe('Bleibt erhalten.')
    // Der BEZUG fällt weg, der Sachverhalt bleibt.
    expect(eine?.benutzerId).toBeNull()
  })

  it('räumt erledigte Meldungen früher weg als offene', async () => {
    const u = await baueTestApp()
    const alt = (tage: number): string => new Date(Date.now() - tage * 86_400_000).toISOString()
    const erledigt = u.app.rueckmeldungen.nimmAn({ text: 'alt und erledigt' })
    const offen = u.app.rueckmeldungen.nimmAn({ text: 'alt und offen' })
    u.app.rueckmeldungen.aktualisiere(erledigt.id, { status: 'erledigt' })
    const setzeDatum = u.app.deps.db.prepare(
      'UPDATE rueckmeldungen SET angelegt_am = ? WHERE id = ?',
    )
    setzeDatum.run(alt(FRIST_ERLEDIGT_TAGE + 1), erledigt.id)
    setzeDatum.run(alt(FRIST_ERLEDIGT_TAGE + 1), offen.id)

    expect(u.app.rueckmeldungen.raeumeAuf()).toBe(1)
    expect(u.app.rueckmeldungen.liste().map((r) => r.text)).toEqual(['alt und offen'])

    setzeDatum.run(alt(FRIST_OFFEN_TAGE + 1), offen.id)
    expect(u.app.rueckmeldungen.raeumeAuf()).toBe(1)
    expect(u.app.rueckmeldungen.liste()).toHaveLength(0)
  })

  it('gibt bei kaputtem Kontext-JSON die Meldung trotzdem her', () => {
    // Eine unlesbare Angabe ist dasselbe wie keine — der Text muss lesbar bleiben.
    expect(saubereKontext('kein objekt')).toBeNull()
    expect(saubereKontext(['auch', 'nicht'])).toBeNull()
    expect(saubereKontext({ seite: '   ' })).toBeNull()
  })
})
