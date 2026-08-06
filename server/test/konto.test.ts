// Kontoeinstellungen (Etappe 3): Passwort, E-Mail-Wechsel, angemeldete Geräte
// und die Speicher-Aufschlüsselung.
//
// Der rote Faden dieser Datei ist, was NICHT passieren darf: dass eine Adresse
// wechselt, bevor sie bestätigt ist; dass ein Passwortwechsel einen aus der
// eigenen Sitzung wirft; dass jemand fremde Geräte abmeldet; und dass eine
// Route nebenbei verrät, wer bei Maptale ein Konto hat.

import { describe, expect, it } from 'vitest'
import { ipPraefix } from '../src/auth/auth.js'
import { artDerDatei } from '../src/quota.js'
import { baueTestApp, type TestUmgebung } from './helfer.js'

const tokenAus = (link: string | null): string => link?.split('#email=')[1] ?? ''

async function zweiteSitzung(u: TestUmgebung, agent: string): Promise<string> {
  const login = await u.app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'test@example.com', passwort: 'geheim123' },
    headers: { 'user-agent': agent, 'x-forwarded-for': '84.119.12.7' },
  })
  return login.cookies.find((c) => c.name === 'maptale_session')?.value ?? ''
}

describe('Passwort ändern', () => {
  it('verlangt das aktuelle Passwort — eine offene Sitzung ist kein Nachweis', async () => {
    const u = await baueTestApp()
    const antwort = await u.app.inject({
      method: 'POST',
      url: '/api/auth/me/passwort',
      cookies: u.cookies,
      payload: { alt: 'falschfalsch', neu: 'neuesgeheimnis' },
    })
    expect(antwort.statusCode).toBe(403)
    // Und es bleibt beim alten Passwort.
    expect(await u.app.auth.login('test@example.com', 'geheim123')).not.toBeNull()
  })

  it('wechselt das Passwort, behält die eigene Sitzung und wirft alle anderen', async () => {
    const u = await baueTestApp()
    const andere = await zweiteSitzung(u, 'Mozilla/5.0 (iPhone) Safari')

    const antwort = await u.app.inject({
      method: 'POST',
      url: '/api/auth/me/passwort',
      cookies: u.cookies,
      payload: { alt: 'geheim123', neu: 'dreizufaelligeworte' },
    })
    expect(antwort.statusCode).toBe(200)
    expect(await u.app.auth.login('test@example.com', 'dreizufaelligeworte')).not.toBeNull()

    // Die eigene Sitzung trägt weiter …
    const eigene = await u.app.inject({ method: 'GET', url: '/api/auth/me', cookies: u.cookies })
    expect((eigene.json() as { benutzer: unknown }).benutzer).not.toBeNull()
    // … die andere nicht mehr, und das App-Token ebenso wenig.
    const fremde = await u.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { maptale_session: andere },
    })
    expect((fremde.json() as { benutzer: unknown }).benutzer).toBeNull()
    expect(u.app.auth.benutzerAusToken(u.apiToken)).toBeNull()
  })
})

describe('E-Mail-Adresse wechseln', () => {
  it('schickt den Link an die NEUE Adresse und lässt die alte bis zum Klick gelten', async () => {
    const u = await baueTestApp()
    const antwort = await u.app.inject({
      method: 'POST',
      url: '/api/auth/me/email',
      cookies: u.cookies,
      payload: { email: 'neu@example.com', passwort: 'geheim123' },
    })
    expect(antwort.statusCode).toBe(200)
    expect(u.mail.nachrichten.at(-1)?.an).toBe('neu@example.com')

    // Vor dem Klick: noch nichts geändert.
    expect(await u.app.auth.login('test@example.com', 'geheim123')).not.toBeNull()
    expect(u.app.auth.benutzerIdFuerEmail('neu@example.com')).toBeNull()

    const einloesen = await u.app.inject({
      method: 'POST',
      url: '/api/auth/email-bestaetigen',
      payload: { token: tokenAus(u.mail.letzterLink()) },
    })
    expect(einloesen.statusCode).toBe(200)
    expect(await u.app.auth.login('neu@example.com', 'geheim123')).not.toBeNull()
    expect(await u.app.auth.login('test@example.com', 'geheim123')).toBeNull()
    // Der Klick im neuen Postfach IST die Bestätigung — kein zweiter Lauf.
    const id = u.app.auth.benutzerIdFuerEmail('neu@example.com')
    expect(u.app.auth.istVerifiziert(id ?? '')).toBe(true)
  })

  it('ist einmal einlösbar', async () => {
    const u = await baueTestApp()
    await u.app.inject({
      method: 'POST',
      url: '/api/auth/me/email',
      cookies: u.cookies,
      payload: { email: 'neu@example.com', passwort: 'geheim123' },
    })
    const token = tokenAus(u.mail.letzterLink())
    await u.app.inject({ method: 'POST', url: '/api/auth/email-bestaetigen', payload: { token } })
    const nochmal = await u.app.inject({ method: 'POST', url: '/api/auth/email-bestaetigen', payload: { token } })
    expect(nochmal.statusCode).toBe(400)
  })

  it('verrät nicht, ob die Adresse schon vergeben ist — antwortet gleich, schickt aber nichts', async () => {
    const u = await baueTestApp()
    await u.app.auth.legeBenutzerAn('besetzt@example.com', 'geheim123', 'Andere')
    const vorher = u.mail.nachrichten.length
    const antwort = await u.app.inject({
      method: 'POST',
      url: '/api/auth/me/email',
      cookies: u.cookies,
      payload: { email: 'besetzt@example.com', passwort: 'geheim123' },
    })
    expect(antwort.statusCode).toBe(200)
    expect(u.mail.nachrichten.length).toBe(vorher)
  })

  it('verlangt das Passwort', async () => {
    const u = await baueTestApp()
    const antwort = await u.app.inject({
      method: 'POST',
      url: '/api/auth/me/email',
      cookies: u.cookies,
      payload: { email: 'neu@example.com', passwort: 'falschfalsch' },
    })
    expect(antwort.statusCode).toBe(403)
  })

  it('meldet, wenn die Adresse zwischen Absenden und Klick an jemand anderen ging', async () => {
    const u = await baueTestApp()
    await u.app.inject({
      method: 'POST',
      url: '/api/auth/me/email',
      cookies: u.cookies,
      payload: { email: 'neu@example.com', passwort: 'geheim123' },
    })
    await u.app.auth.legeBenutzerAn('neu@example.com', 'geheim123', 'Schneller')
    const einloesen = await u.app.inject({
      method: 'POST',
      url: '/api/auth/email-bestaetigen',
      payload: { token: tokenAus(u.mail.letzterLink()) },
    })
    expect(einloesen.statusCode).toBe(409)
  })
})

describe('Angemeldete Geräte', () => {
  it('listet Sitzungen und App-Token, markiert die eigene und kürzt die IP', async () => {
    const u = await baueTestApp()
    await zweiteSitzung(u, 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/605')

    const antwort = await u.app.inject({ method: 'GET', url: '/api/auth/me/geraete', cookies: u.cookies })
    const { geraete } = antwort.json() as {
      geraete: Array<{ id: string; art: string; kennung: string | null; ipPraefix: string | null; dieses: boolean }>
    }
    expect(geraete.filter((g) => g.art === 'sitzung')).toHaveLength(2)
    expect(geraete.filter((g) => g.art === 'app')).toHaveLength(1)
    expect(geraete.find((g) => g.art === 'app')?.kennung).toBe('Testgerät')
    expect(geraete.filter((g) => g.dieses)).toHaveLength(1)
    const iphone = geraete.find((g) => g.kennung?.includes('iPhone'))
    expect(iphone?.ipPraefix).toBe('84.119.x.x')
  })

  it('meldet ein einzelnes Gerät ab', async () => {
    const u = await baueTestApp()
    const andere = await zweiteSitzung(u, 'Firefox')
    const antwort = await u.app.inject({
      method: 'DELETE',
      url: `/api/auth/me/geraete/sitzung:${andere}`,
      cookies: u.cookies,
    })
    expect(antwort.statusCode).toBe(200)
    const nachher = await u.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { maptale_session: andere },
    })
    expect((nachher.json() as { benutzer: unknown }).benutzer).toBeNull()
  })

  it('lässt niemanden fremde Geräte abmelden', async () => {
    const u = await baueTestApp()
    const fremd = await u.app.auth.legeBenutzerAn('fremd@example.com', 'geheim123', 'Fremde')
    const fremdeSitzung = u.app.auth.erzeugeSession(fremd.id)
    const antwort = await u.app.inject({
      method: 'DELETE',
      url: `/api/auth/me/geraete/sitzung:${fremdeSitzung.id}`,
      cookies: u.cookies,
    })
    expect(antwort.statusCode).toBe(404)
    expect(u.app.auth.benutzerAusSession(fremdeSitzung.id)).not.toBeNull()
  })
})

describe('Speicher', () => {
  it('ordnet jede Datei ihrer Art zu — und der Rest-Eimer bleibt leer, wo er es soll', () => {
    expect(artDerDatei('media/m1.w1920.jpg')).toBe('fotos')
    expect(artDerDatei('media/m2.web.mp4')).toBe('videos')
    expect(artDerDatei('media/m2.poster.jpg')).toBe('fotos')
    expect(artDerDatei('media/mus-nachtfahrt.mp3')).toBe('klaenge')
    expect(artDerDatei('original/manifest.json')).toBe('aufzeichnungen')
    expect(artDerDatei('original/track.gpx')).toBe('aufzeichnungen')
    expect(artDerDatei('tour.json')).toBe('aufzeichnungen')
    expect(artDerDatei('media/unbekannt.xyz')).toBe('sonstiges')
  })

  it('schlüsselt auf, und die Teile ergeben die Summe', async () => {
    const u = await baueTestApp()
    const benutzer = u.app.auth.benutzerIdFuerEmail('test@example.com') ?? ''
    // Eine Tour von Hand: die Aufteilung liest den Storage, nicht die Pipeline.
    u.app.deps.db
      .prepare(
        `INSERT INTO tours (id, owner_id, no, status, visibility, created_at, updated_at)
         VALUES ('t_konto', ?, 1, 'bereit', 'private', '2026-08-06', '2026-08-06')`,
      )
      .run(benutzer)
    await u.storage.schreibe('t_konto', 'media/m1.w1920.jpg', Buffer.alloc(1000))
    await u.storage.schreibe('t_konto', 'media/m2.web.mp4', Buffer.alloc(2000))
    await u.storage.schreibe('t_konto', 'media/ton.mp3', Buffer.alloc(300))
    await u.storage.schreibe('t_konto', 'original/manifest.json', Buffer.alloc(70))
    await u.benutzerStorage.schreibe(benutzer, 'audio/eigenes.mp3', Buffer.alloc(500))

    const antwort = await u.app.inject({ method: 'GET', url: '/api/auth/me/speicher', cookies: u.cookies })
    const stand = antwort.json() as {
      benutzt: number
      limit: number
      aufteilung: Record<string, number>
    }
    expect(stand.aufteilung).toEqual({
      fotos: 1000,
      videos: 2000,
      klaenge: 800,
      aufzeichnungen: 70,
      sonstiges: 0,
    })
    const summe = Object.values(stand.aufteilung).reduce((a, b) => a + b, 0)
    expect(summe).toBe(stand.benutzt)
    expect(stand.limit).toBeGreaterThan(0)
  })
})

describe('ipPraefix', () => {
  it('behält zwei Gruppen — genug zum Wiedererkennen, zu wenig für einen Ort', () => {
    expect(ipPraefix('84.119.12.7')).toBe('84.119.x.x')
    expect(ipPraefix('::ffff:84.119.12.7')).toBe('84.119.x.x')
    expect(ipPraefix('2001:db8:85a3::8a2e')).toBe('2001:db8:x')
    expect(ipPraefix(null)).toBeNull()
    expect(ipPraefix('unfug')).toBeNull()
  })
})
