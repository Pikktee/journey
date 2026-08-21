// Push-Benachrichtigungen: Geräte, Versand und der Anschluss an den Importlauf.
//
// Kein Netz in der Suite — `SammelPush` ist das Spiegelbild von `FcmPush`, wie
// `FixedGeocoder` es für den Geocoder ist. Was gegen die ECHTE FCM-API läuft
// (JWT-Bau, Fehlercodes), wird gegen eine injizierte Hol-Funktion geprüft.

import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { collectAccount } from '../src/data-export-run.js'
import { FcmPush, isUnregistered, parseServiceAccount } from '../src/fcm.js'
import { ConsolePush, PushService } from '../src/push.js'
import { exampleRawTrack, TestProvider, testSignature } from '../src/tracker/test-provider.js'
import { baueTestApp, SammelPush, type TestUmgebung } from './helfer.js'

const WEBHOOK_GEHEIMNIS = 'geheim-fuer-tests'
const TOKEN = 'fcm-token-abcdefghijklmnop'

/**
 * Ein Dienstkonto, wie Firebase es ausgibt — mit einem ECHTEN, frisch
 * erzeugten RSA-Schlüssel: Der JWT-Test signiert damit wirklich, und ein
 * erfundener PEM-Block ließe genau den Schritt ungeprüft, der beim Einrichten
 * am ehesten schiefgeht.
 *
 * Einmal je Lauf erzeugt (2048 Bit kosten ~100 ms) und geteilt — die Tests
 * prüfen, was mit dem Schlüssel geschieht, nicht seine Erzeugung.
 */
const DIENSTKONTO = (() => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  return JSON.stringify({
    type: 'service_account',
    project_id: 'maptale-test',
    client_email: 'push@maptale-test.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  })
})()

/** Die Kennung des angemeldeten Testkontos — wie in export.test.ts. */
const benutzerId = (u: TestUmgebung): string =>
  u.app.auth.userFromSession(u.cookies.maptale_session)!.id

/** App mit Push UND einem Tracker-Anbieter — der Weg, den ein Import nimmt. */
async function baueMitPush(): Promise<{
  u: TestUmgebung
  push: SammelPush
  provider: TestProvider
}> {
  const provider = new TestProvider({
    webhookSecret: WEBHOOK_GEHEIMNIS,
    tracks: { a1: exampleRawTrack() },
  })
  const push = new SammelPush()
  const u = await baueTestApp([], null, null, {}, null, null, null, [provider], push)
  return { u, push, provider }
}

/** Konto verknüpfen — über die echten Routen, wie in tracker.test.ts. */
async function verknuepfe(u: TestUmgebung): Promise<void> {
  const start = await u.app.inject({
    method: 'POST',
    url: '/api/tracker/polar/connect',
    cookies: u.cookies,
    payload: {},
  })
  const url = new URL((start.json() as { authorizationUrl: string }).authorizationUrl)
  const zustand = url.searchParams.get('state') ?? ''
  await u.app.inject({
    method: 'GET',
    url: `/api/tracker/polar/callback?code=ok&state=${encodeURIComponent(zustand)}`,
  })
}

/** Eine Webhook-Zustellung samt Warten auf Import UND Pipeline. */
async function melde(u: TestUmgebung, externalId: string): Promise<void> {
  const rohBody = JSON.stringify({ event: 'EXERCISE', user_id: 'extern-1', entity_id: externalId })
  await u.app.inject({
    method: 'POST',
    url: '/api/webhooks/tracker/polar',
    headers: {
      'content-type': 'application/json',
      'polar-webhook-signature': testSignature(rohBody, WEBHOOK_GEHEIMNIS),
    },
    payload: rohBody,
  })
  await Promise.all([...u.app.trackerRuns.values()])
  await Promise.all([...u.app.processing.values()])
}

/** Ein Gerät über die Route anmelden — mit dem App-Token, wie die App es tut. */
async function registriere(u: TestUmgebung, token = TOKEN, apiToken = u.apiToken) {
  return u.app.inject({
    method: 'POST',
    url: '/api/push/devices',
    headers: { authorization: `Bearer ${apiToken}` },
    payload: { token, platform: 'android' },
  })
}

describe('Geräte an- und abmelden', () => {
  it('meldet ein Gerät an und listet es beim Konto', async () => {
    const { u, push } = await baueMitPush()
    const antwort = await registriere(u)
    expect(antwort.statusCode).toBe(200)
    expect(antwort.json()).toMatchObject({ ok: true, push: true })
    expect(u.app.push.devices(benutzerId(u)).map((g) => g.token)).toEqual([TOKEN])
    expect(push.gesendet).toHaveLength(0)
    await u.app.close()
  })

  it('schreibt beim zweiten Anmelden desselben Tokens um, statt zu doppeln', async () => {
    // Der Fall tritt bei JEDER Token-Erneuerung ein — FCM schickt der App
    // ungefragt einen neuen, und sie meldet ihn ungefragt weiter.
    const { u } = await baueMitPush()
    await registriere(u)
    await registriere(u)
    expect(u.app.push.devices(benutzerId(u))).toHaveLength(1)
    await u.app.close()
  })

  it('zieht den Token zum neuen Konto, wenn sich auf dem Gerät jemand anders anmeldet', async () => {
    // Ohne das bekäme der Vorbesitzer des Geräts weiter Meldungen über fremde
    // Touren — der Token benennt eine Installation, kein Konto.
    const { u } = await baueMitPush()
    await registriere(u)
    await u.app.auth.createUser('zweite@example.com', 'geheim123', 'Zweite')
    const login = await u.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'zweite@example.com', password: 'geheim123', tokenLabel: 'Zweitgerät' },
    })
    const zweiterToken = (login.json() as { apiToken: string }).apiToken
    await registriere(u, TOKEN, zweiterToken)
    expect(u.app.push.devices(benutzerId(u))).toHaveLength(0)
    await u.app.close()
  })

  it('nimmt das Gerät mit, wenn der Zugang in „Angemeldete Geräte" abgemeldet wird', async () => {
    // Die App kann das nicht selbst aufräumen — sie ist gerade ausgesperrt
    // worden. Ohne das CASCADE gingen Meldungen an ein abgemeldetes Telefon.
    const { u } = await baueMitPush()
    await registriere(u)
    const devices = await u.app.inject({
      method: 'GET',
      url: '/api/auth/me/devices',
      cookies: u.cookies,
    })
    const appGeraet = (devices.json() as { devices: Array<{ id: string }> }).devices.find((g) =>
      g.id.startsWith('app:'),
    )
    const weg = await u.app.inject({
      method: 'DELETE',
      url: `/api/auth/me/devices/${appGeraet?.id}`,
      cookies: u.cookies,
    })
    expect(weg.statusCode).toBe(200)
    expect(u.app.push.devices(benutzerId(u))).toHaveLength(0)
    await u.app.close()
  })

  it('meldet ein Gerät ab — auch einen längst gelöschten Token ohne Fehler', async () => {
    const { u } = await baueMitPush()
    await registriere(u)
    const weg = await u.app.inject({
      method: 'DELETE',
      url: '/api/push/devices',
      headers: { authorization: `Bearer ${u.apiToken}` },
      payload: { token: TOKEN },
    })
    expect(weg.statusCode).toBe(200)
    expect(u.app.push.devices(benutzerId(u))).toHaveLength(0)
    // Ein zweites Mal ist kein Fehler: Die App hat erreicht, was sie wollte.
    const nochmal = await u.app.inject({
      method: 'DELETE',
      url: '/api/push/devices',
      headers: { authorization: `Bearer ${u.apiToken}` },
      payload: { token: TOKEN },
    })
    expect(nochmal.statusCode).toBe(200)
    await u.app.close()
  })

  it('antwortet ohne Dienstkonto mit `push: false`, statt einen toten Token zu speichern', async () => {
    const u = await baueTestApp()
    const antwort = await registriere(u)
    expect(antwort.statusCode).toBe(200)
    expect(antwort.json()).toMatchObject({ ok: false, push: false })
    expect(u.app.push.devices(benutzerId(u))).toHaveLength(0)
    await u.app.close()
  })

  it('verlangt eine Anmeldung', async () => {
    const { u } = await baueMitPush()
    const antwort = await u.app.inject({
      method: 'POST',
      url: '/api/push/devices',
      payload: { token: TOKEN, platform: 'android' },
    })
    expect(antwort.statusCode).toBe(401)
    await u.app.close()
  })
})

describe('Meldung nach einem Import', () => {
  it('schickt genau eine Nachricht mit Tour- und Import-Kennung', async () => {
    const { u, push } = await baueMitPush()
    await registriere(u)
    await verknuepfe(u)
    await melde(u, 'a1')
    expect(push.gesendet).toHaveLength(1)
    expect(push.gesendet[0]?.tokens).toEqual([TOKEN])
    expect(push.gesendet[0]?.nachricht.type).toBe('import-finished')
    expect(push.gesendet[0]?.nachricht.tourId).toMatch(/^t_/)
    expect(push.gesendet[0]?.nachricht.importId).toMatch(/^i_/)
    await u.app.close()
  })

  it('meldet NICHTS bei einer Aktivität ohne Route', async () => {
    // Eine Halleneinheit ist kein Ereignis für den Sperrbildschirm; sie steht
    // als `uebersprungen` in der Liste im Konto.
    const { u, push } = await baueMitPush()
    await registriere(u)
    await verknuepfe(u)
    await melde(u, 'unbekannt')
    expect(push.gesendet).toHaveLength(0)
    await u.app.close()
  })

  it('lässt einen gelungenen Import stehen, wenn der Versand ausfällt', async () => {
    // Der Preis eines Fehlers hier wäre hoch: Der Import stünde als „fehler"
    // in der Liste, obwohl die Tour spielbar im Konto liegt.
    const { u, push } = await baueMitPush()
    await registriere(u)
    await verknuepfe(u)
    push.faelltAus = true
    await melde(u, 'a1')
    const imports = await u.app.inject({
      method: 'GET',
      url: '/api/tracker/imports',
      cookies: u.cookies,
    })
    expect((imports.json() as { imports: Array<{ status: string }> }).imports[0]?.status).toBe(
      'done',
    )
    await u.app.close()
  })

  it('löscht ein Gerät, das FCM als abgemeldet zurückweist', async () => {
    const { u, push } = await baueMitPush()
    await registriere(u)
    push.unregisteredTokens.add(TOKEN)
    await verknuepfe(u)
    await melde(u, 'a1')
    expect(u.app.push.devices(benutzerId(u))).toHaveLength(0)
    await u.app.close()
  })

  it('meldet nichts, solange kein Gerät angemeldet ist', async () => {
    const { u, push } = await baueMitPush()
    await verknuepfe(u)
    await melde(u, 'a1')
    expect(push.gesendet).toHaveLength(0)
    await u.app.close()
  })
})

describe('Datenexport', () => {
  it('nennt die Push-Geräte in konto.json', async () => {
    // Sie sind das eine Datum, das an Google geht — ohne sie wäre die Auskunft
    // genau dort unvollständig, wo sie am wenigsten selbstverständlich ist.
    const { u } = await baueMitPush()
    await registriere(u)
    const konto = collectAccount(u.app.deps.db, benutzerId(u))!
    expect(konto.pushGeraete).toEqual([
      expect.objectContaining({ plattform: 'android', token: TOKEN }),
    ])
    // Die Zeile darüber gilt weiter: Zugangsmittel gehören nicht ins Archiv.
    expect(JSON.stringify(konto)).not.toContain('pw_hash')
    await u.app.close()
  })
})

describe('FCM-Versand (ohne Netz)', () => {
  it('liest ein Dienstkonto und meckert verständlich, wenn es fehlt', () => {
    expect(() => parseServiceAccount('kein json')).toThrow(/lesbares JSON/)
    expect(() => parseServiceAccount('{"project_id":"x"}')).toThrow(/client_email/)
    expect(parseServiceAccount(DIENSTKONTO).projectId).toBe('maptale-test')
  })

  it('holt einen Access-Token, sendet je Gerät einmal und cacht die Anmeldung', async () => {
    const aufrufe: string[] = []
    const hol = async (url: string): Promise<Response> => {
      aufrufe.push(url)
      if (url.includes('oauth2')) {
        return new Response(JSON.stringify({ access_token: 'zugriff-1' }), { status: 200 })
      }
      return new Response('{}', { status: 200 })
    }
    const versand = new FcmPush(DIENSTKONTO, hol)
    await versand.send(['a', 'b'], { type: 'import-finished', tourId: 't_1', importId: 'i_1' })
    await versand.send(['a'], { type: 'import-finished', tourId: 't_2', importId: 'i_2' })
    // Ein Anmelde-Aufruf für alles, danach je Gerät ein Sende-Aufruf.
    expect(aufrufe.filter((u) => u.includes('oauth2'))).toHaveLength(1)
    expect(aufrufe.filter((u) => u.includes('messages:send'))).toHaveLength(3)
    expect(aufrufe.at(-1)).toContain('/v1/projects/maptale-test/messages:send')
  })

  it('schickt eine reine Datennachricht mit hoher Priorität', async () => {
    // Eine `notification` zeigte Android selbst an: Der Text stünde auf dem
    // Sperrbildschirm, obwohl die Nachricht nichts über die Tour verraten soll.
    let gesendet: Record<string, unknown> = {}
    const hol = async (url: string, init?: RequestInit): Promise<Response> => {
      if (url.includes('oauth2'))
        return new Response(JSON.stringify({ access_token: 'z' }), { status: 200 })
      gesendet = JSON.parse(String(init?.body)) as Record<string, unknown>
      return new Response('{}', { status: 200 })
    }
    await new FcmPush(DIENSTKONTO, hol).send(['a'], {
      type: 'import-finished',
      tourId: 't_1',
      importId: 'i_1',
    })
    const nachricht = gesendet.message as Record<string, unknown>
    // `fid` und nicht `token`: FCM hat den Registrierungs-Token abgelöst,
    // die v1-API führt `token` als deprecated.
    expect(nachricht.fid).toBe('a')
    expect(nachricht.token).toBeUndefined()
    expect(nachricht.notification).toBeUndefined()
    expect(nachricht.data).toEqual({ type: 'import-finished', tourId: 't_1', importId: 'i_1' })
    expect(nachricht.android).toEqual({ priority: 'high' })
  })

  it('meldet NUR UNREGISTERED als abgemeldet — kein anderer Fehler', async () => {
    // Der teuerste Fehler dieser Datei wäre, auf 400 zu löschen: Googles
    // Tabelle führt INVALID_ARGUMENT (400), SENDER_ID_MISMATCH (403) und
    // THIRD_PARTY_AUTH_ERROR (401) als Fehler bei UNS. Wer darauf löscht,
    // räumt bei EINER kaputten Nutzlast die Geräte aller Konten ab — und weil
    // die Apps sich neu registrieren, wiederholt sich das bei jedem Versand.
    const fcmFehler = (code: string) =>
      JSON.stringify({ error: { details: [{ '@type': 'type…FcmError', errorCode: code }] } })
    const antworten: Record<string, [number, string]> = {
      weg: [404, fcmFehler('UNREGISTERED')],
      nutzlast: [400, fcmFehler('INVALID_ARGUMENT')],
      fremderSender: [403, fcmFehler('SENDER_ID_MISMATCH')],
      apns: [401, fcmFehler('THIRD_PARTY_AUTH_ERROR')],
      stumm: [503, fcmFehler('UNAVAILABLE')],
      gut: [200, '{}'],
    }
    const hol = async (url: string, init?: RequestInit): Promise<Response> => {
      if (url.includes('oauth2'))
        return new Response(JSON.stringify({ access_token: 'z' }), { status: 200 })
      const token = (JSON.parse(String(init?.body)) as { message: { fid: string } }).message.fid
      const [status, koerper] = antworten[token] ?? [200, '{}']
      return new Response(koerper, { status })
    }
    const ergebnis = await new FcmPush(DIENSTKONTO, hol).send(
      ['weg', 'nutzlast', 'fremderSender', 'apns', 'stumm', 'gut'],
      { type: 'import-finished', tourId: 't_1', importId: 'i_1' },
    )
    expect(ergebnis.map((z) => z.unregistered)).toEqual([true, false, false, false, false, false])
  })

  it('liest den Fehlercode aus dem Körper, nicht den HTTP-Status', () => {
    // Die v1-API kann UNREGISTERED auch mit 400 melden; umgekehrt ist ein 404
    // mit ausdrücklich anderem Code kein Grund zu löschen.
    const mit = (code: string) => JSON.stringify({ error: { details: [{ errorCode: code }] } })
    expect(isUnregistered(400, mit('UNREGISTERED'))).toBe(true)
    expect(isUnregistered(404, mit('INVALID_ARGUMENT'))).toBe(false)
    // Ohne lesbaren Körper bleibt es beim Status — mehr weiß man dann nicht.
    expect(isUnregistered(404, 'kein json')).toBe(true)
    expect(isUnregistered(400, '')).toBe(false)
    expect(isUnregistered(503, mit('UNAVAILABLE'))).toBe(false)
  })

  it('erneuert den Access-Token nach Ablauf', async () => {
    let jetzt = 1_000_000
    const anmeldungen: string[] = []
    const hol = async (url: string): Promise<Response> => {
      if (url.includes('oauth2')) {
        anmeldungen.push(`t${anmeldungen.length}`)
        return new Response(JSON.stringify({ access_token: `zugriff-${anmeldungen.length}` }), {
          status: 200,
        })
      }
      return new Response('{}', { status: 200 })
    }
    const versand = new FcmPush(DIENSTKONTO, hol, () => jetzt)
    const nachricht = { type: 'import-finished' as const, tourId: 't_1', importId: 'i_1' }
    await versand.send(['a'], nachricht)
    jetzt += 50 * 60_000
    await versand.send(['a'], nachricht)
    expect(anmeldungen).toHaveLength(1)
    jetzt += 10 * 60_000
    await versand.send(['a'], nachricht)
    expect(anmeldungen).toHaveLength(2)
  })

  it('wirft mit lesbarem Grund, wenn die Anmeldung scheitert', async () => {
    const hol = async (): Promise<Response> => new Response('invalid_grant', { status: 400 })
    await expect(
      new FcmPush(DIENSTKONTO, hol).send(['a'], {
        type: 'import-finished',
        tourId: 't',
        importId: 'i',
      }),
    ).rejects.toThrow(/FCM-Anmeldung fehlgeschlagen \(400\)/)
  })
})

describe('Dienst ohne Versandweg', () => {
  it('ist nicht einsatzbereit und meldet nichts', async () => {
    const u = await baueTestApp()
    const dienst = new PushService(u.app.deps.db, null)
    expect(dienst.ready).toBe(false)
    expect(
      await dienst.notify(benutzerId(u), {
        type: 'import-finished',
        tourId: 't_1',
        importId: 'i_1',
      }),
    ).toBe(0)
    await u.app.close()
  })

  it('der Konsolen-Versand schreibt ins Log und meldet niemanden ab', async () => {
    const zeilen: string[] = []
    const ergebnis = await new ConsolePush((z) => zeilen.push(z)).send(['a', 'b'], {
      type: 'import-finished',
      tourId: 't_1',
      importId: 'i_1',
    })
    expect(zeilen[0]).toContain('2 Gerät(e)')
    expect(ergebnis.every((z) => !z.unregistered)).toBe(true)
  })
})
