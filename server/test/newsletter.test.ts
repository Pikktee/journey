// Newsletter-Einwilligung (Etappe 4).
//
// Der rote Faden ist auch hier, was NICHT passieren darf: dass ein Kästchen
// vorangekreuzt wirkt; dass eine Einwilligung ohne Datum und Herkunft in der
// Datenbank steht; dass eine Werbemail an eine unbestätigte Adresse ginge; und
// dass jemand für den Widerruf ein Passwort braucht.

import { describe, expect, it } from 'vitest'
import {
  abmeldeToken,
  EINWILLIGUNGSTEXTE,
  einKlickUrl,
  newsletterKopfzeilen,
  pruefeAbmeldeToken,
} from '../src/newsletter.js'
import { baueTestApp, oeffneRegistrierung, type TestUmgebung } from './helfer.js'

const registriere = (u: TestUmgebung, koerper: Record<string, unknown>) =>
  u.app.inject({ method: 'POST', url: '/api/auth/register', payload: { passwort: 'geheim123', ...koerper } })

describe('Einwilligung bei der Registrierung', () => {
  it('trägt ein, wenn das Kästchen gesetzt war — mit Zeitpunkt, Quelle und Textfassung', async () => {
    const u = await baueTestApp()
    oeffneRegistrierung(u)
    await registriere(u, { email: 'neu@example.com', newsletter: true })

    const id = u.app.auth.benutzerIdFuerEmail('neu@example.com') ?? ''
    expect(u.app.newsletter.stand(id)).toBe(true)
    const verlauf = u.app.newsletter.verlauf(id)
    expect(verlauf).toHaveLength(1)
    expect(verlauf[0]?.zustand).toBe('an')
    expect(verlauf[0]?.quelle).toBe('registrierung')
    expect(verlauf[0]?.textfassung).toBe(EINWILLIGUNGSTEXTE.registrierung.fassung)
    expect(Date.parse(verlauf[0]?.zeitpunkt ?? '')).not.toBeNaN()
  })

  it('bleibt aus, wenn das Feld fehlt oder false ist — nicht vorangekreuzt heißt auch: kein Eintrag', async () => {
    const u = await baueTestApp()
    oeffneRegistrierung(u)
    await registriere(u, { email: 'ohne@example.com' })
    await registriere(u, { email: 'nein@example.com', newsletter: false })

    for (const adresse of ['ohne@example.com', 'nein@example.com']) {
      const id = u.app.auth.benutzerIdFuerEmail(adresse) ?? ''
      expect(u.app.newsletter.stand(id)).toBe(false)
      // Kein Eintrag heißt kein Protokoll: Eine Zeile „aus" für jemanden, der
      // nie gefragt wurde, wäre eine erfundene Willenserklärung.
      expect(u.app.newsletter.verlauf(id)).toHaveLength(0)
    }
  })

  it('koppelt nichts: die Registrierung geht mit und ohne Kästchen durch', async () => {
    const u = await baueTestApp()
    oeffneRegistrierung(u)
    const mit = await registriere(u, { email: 'a@example.com', newsletter: true })
    const ohne = await registriere(u, { email: 'b@example.com' })
    expect(mit.statusCode).toBe(201)
    expect(ohne.statusCode).toBe(201)
  })

  it('lässt die Bestätigungsmail werbefrei — kein Newsletter-Wort, keine Abmelde-Kopfzeile', async () => {
    const u = await baueTestApp()
    oeffneRegistrierung(u)
    await registriere(u, { email: 'neu@example.com', newsletter: true })
    const mail = u.mail.nachrichten.at(-1)
    expect(mail?.an).toBe('neu@example.com')
    expect(`${mail?.text} ${mail?.html}`).not.toMatch(/newsletter|abbestell|updates & neues/i)
    expect(mail?.kopfzeilen).toBeUndefined()
  })
})

describe('Der Riegel: unbestätigte Adresse', () => {
  it('nimmt den Wunsch an, hält den Versand aber zurück, bis die Adresse bestätigt ist', async () => {
    const u = await baueTestApp()
    oeffneRegistrierung(u)
    await registriere(u, { email: 'neu@example.com', newsletter: true })
    const id = u.app.auth.benutzerIdFuerEmail('neu@example.com') ?? ''

    expect(u.app.newsletter.stand(id)).toBe(true)
    expect(u.app.newsletter.empfaenger().map((e) => e.id)).not.toContain(id)

    // Der Klick auf den Bestätigungslink IST das Double-Opt-in für den
    // Newsletter gleich mit.
    const token = u.mail.letzterLink()?.split('#verify=')[1] ?? ''
    await u.app.inject({ method: 'POST', url: '/api/auth/verifiziere', payload: { token } })
    expect(u.app.newsletter.empfaenger().map((e) => e.id)).toContain(id)
  })

  it('lässt den Versand ruhen, sobald die Bestätigung wieder fällt (Adresswechsel durch die Verwaltung)', async () => {
    const u = await baueTestApp()
    const id = u.app.auth.benutzerIdFuerEmail('test@example.com') ?? ''
    u.app.newsletter.setze(id, true, 'konto')
    expect(u.app.newsletter.empfaenger().map((e) => e.id)).toContain(id)

    u.app.auth.aendereKonto(id, { email: 'andere@example.com', verifiziert: false })
    expect(u.app.newsletter.empfaenger()).toHaveLength(0)
    // Der Wunsch bleibt bestehen — er ruht nur.
    expect(u.app.newsletter.stand(id)).toBe(true)
  })
})

describe('Der Schalter im Konto', () => {
  it('legt um und protokolliert beide Richtungen', async () => {
    const u = await baueTestApp()
    const an = await u.app.inject({
      method: 'POST',
      url: '/api/auth/me/newsletter',
      cookies: u.cookies,
      payload: { an: true },
    })
    expect(an.statusCode).toBe(200)
    expect((an.json() as { newsletter: boolean }).newsletter).toBe(true)

    const me = await u.app.inject({ method: 'GET', url: '/api/auth/me', cookies: u.cookies })
    expect((me.json() as { newsletter: boolean }).newsletter).toBe(true)

    await u.app.inject({
      method: 'POST',
      url: '/api/auth/me/newsletter',
      cookies: u.cookies,
      payload: { an: false },
    })
    const id = u.app.auth.benutzerIdFuerEmail('test@example.com') ?? ''
    expect(u.app.newsletter.stand(id)).toBe(false)
    // Jüngste zuerst: aus, dann an.
    expect(u.app.newsletter.verlauf(id).map((e) => e.zustand)).toEqual(['aus', 'an'])
    expect(u.app.newsletter.verlauf(id).every((e) => e.quelle === 'konto')).toBe(true)
  })

  it('bleibt Angemeldeten vorbehalten', async () => {
    const u = await baueTestApp()
    const antwort = await u.app.inject({ method: 'POST', url: '/api/auth/me/newsletter', payload: { an: true } })
    expect(antwort.statusCode).toBe(401)
  })
})

describe('Abmelden ohne Anmeldung', () => {
  it('trägt über den signierten Token aus — ohne Sitzung, ohne Passwort', async () => {
    const u = await baueTestApp()
    const id = u.app.auth.benutzerIdFuerEmail('test@example.com') ?? ''
    u.app.newsletter.setze(id, true, 'konto')

    const antwort = await u.app.inject({
      method: 'POST',
      url: '/api/newsletter/abmelden',
      payload: { token: abmeldeToken(id, u.app.deps.konfig.cookieSecret) },
    })
    expect(antwort.statusCode).toBe(200)
    expect(u.app.newsletter.stand(id)).toBe(false)
    expect(u.app.newsletter.verlauf(id)[0]?.quelle).toBe('abmeldelink')
  })

  it('nimmt den Ein-Klick-Widerruf der Mail-Programme entgegen (RFC 8058)', async () => {
    const u = await baueTestApp()
    const id = u.app.auth.benutzerIdFuerEmail('test@example.com') ?? ''
    u.app.newsletter.setze(id, true, 'konto')

    const token = abmeldeToken(id, u.app.deps.konfig.cookieSecret)
    const antwort = await u.app.inject({
      method: 'POST',
      url: `/api/newsletter/ein-klick/${token}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'List-Unsubscribe=One-Click',
    })
    expect(antwort.statusCode).toBe(200)
    expect(u.app.newsletter.stand(id)).toBe(false)
  })

  it('weist einen gefälschten Token ab, statt irgendjemanden auszutragen', async () => {
    const u = await baueTestApp()
    const id = u.app.auth.benutzerIdFuerEmail('test@example.com') ?? ''
    u.app.newsletter.setze(id, true, 'konto')

    const echt = abmeldeToken(id, u.app.deps.konfig.cookieSecret)
    const gefaelscht = `${echt.split('.')[0]}.${'A'.repeat((echt.split('.')[1] ?? '').length)}`
    const antwort = await u.app.inject({
      method: 'POST',
      url: '/api/newsletter/abmelden',
      payload: { token: gefaelscht },
    })
    expect(antwort.statusCode).toBe(400)
    expect(u.app.newsletter.stand(id)).toBe(true)
  })

  it('bleibt freundlich, wenn das Konto längst weg ist — das Ziel ist erreicht', async () => {
    const u = await baueTestApp()
    const weg = await u.app.auth.legeBenutzerAn('weg@example.com', 'geheim123', 'Weg')
    const token = abmeldeToken(weg.id, u.app.deps.konfig.cookieSecret)
    u.app.auth.loescheBenutzer(weg.id)

    const antwort = await u.app.inject({ method: 'POST', url: '/api/newsletter/abmelden', payload: { token } })
    expect(antwort.statusCode).toBe(200)
  })
})

describe('Aufbewahrung', () => {
  it('räumt überholte Protokollzeilen nach drei Jahren weg, behält aber die jüngste', async () => {
    const u = await baueTestApp()
    const id = u.app.auth.benutzerIdFuerEmail('test@example.com') ?? ''
    u.app.newsletter.setze(id, true, 'konto')
    u.app.newsletter.setze(id, false, 'konto')
    // Beide auf „vor vier Jahren" zurückdatieren — die Uhr lässt sich im Test
    // nicht drehen, die Zeilen schon.
    u.app.deps.db
      .prepare(`UPDATE newsletter_einwilligungen SET zeitpunkt = ? WHERE zustand = 'an'`)
      .run('2022-08-06T10:00:00.000Z')
    u.app.deps.db
      .prepare(`UPDATE newsletter_einwilligungen SET zeitpunkt = ? WHERE zustand = 'aus'`)
      .run('2022-08-07T10:00:00.000Z')

    expect(u.app.newsletter.raeumeAuf()).toBe(1)
    const verlauf = u.app.newsletter.verlauf(id)
    // Die jüngste bleibt: Ohne sie stünde in `users` ein Zustand ohne Herkunft.
    expect(verlauf).toHaveLength(1)
    expect(verlauf[0]?.zustand).toBe('aus')
  })

  it('fasst frische Zeilen nicht an', async () => {
    const u = await baueTestApp()
    const id = u.app.auth.benutzerIdFuerEmail('test@example.com') ?? ''
    u.app.newsletter.setze(id, true, 'konto')
    u.app.newsletter.setze(id, false, 'konto')
    expect(u.app.newsletter.raeumeAuf()).toBe(0)
    expect(u.app.newsletter.verlauf(id)).toHaveLength(2)
  })
})

describe('Signierter Token', () => {
  it('geht auf und hin und zurück, aber nicht mit fremdem Geheimnis', () => {
    const token = abmeldeToken('u_1', 'geheim')
    expect(pruefeAbmeldeToken(token, 'geheim')).toBe('u_1')
    expect(pruefeAbmeldeToken(token, 'anderes')).toBeNull()
    expect(pruefeAbmeldeToken('unfug', 'geheim')).toBeNull()
    expect(pruefeAbmeldeToken('', 'geheim')).toBeNull()
    // Kein Punkt, keine Signatur — und keine Ausnahme.
    expect(pruefeAbmeldeToken('dTBf', 'geheim')).toBeNull()
  })
})

describe('List-Unsubscribe', () => {
  it('nennt beide Wege und sagt den Ein-Klick zu', () => {
    const kopfzeilen = newsletterKopfzeilen('https://maptale.io/', 'tok')
    expect(kopfzeilen['List-Unsubscribe']).toContain(`<${einKlickUrl('https://maptale.io', 'tok')}>`)
    expect(kopfzeilen['List-Unsubscribe']).toContain('<https://maptale.io/konto#newsletter-aus=tok>')
    // Ohne diese Zeile ist die URL nur ein Link, den der Client öffnet.
    expect(kopfzeilen['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
  })

  it('reicht die Kopfzeilen bis in den Versand durch', async () => {
    const u = await baueTestApp()
    await u.app.deps.mail.sende({
      an: 'wer@example.com',
      betreff: 'Neues von Maptale',
      text: 'Hallo',
      kopfzeilen: newsletterKopfzeilen('https://maptale.io', 'tok'),
    })
    expect(u.mail.nachrichten.at(-1)?.kopfzeilen?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
  })
})
