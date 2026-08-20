// Der Polar-Adapter gegen gespeicherte Antworten — kein Netz in der Suite.
//
// Die Nutzlasten sind den Formen der API-Doku nachgebaut
// (https://www.polar.com/accesslink-api/): Token-Antwort mit `x_user_id`,
// Übung mit `has-route`/`start-time`/`duration`, Webhook-Ereignis mit
// `event`/`user_id`/`entity_id`.

import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { durationToSeconds, PolarProvider, startTime } from '../src/tracker/provider/polar.js'
import {
  NoRouteError,
  InvalidTokensError,
  type ProviderTokens,
  type TrackerProvider,
} from '../src/tracker/contract.js'

const ZUGANG = { clientId: 'klient-1', clientSecret: 'geheim-1', webhookGeheimnis: 'wh-geheim' }
const TOKENS: ProviderTokens = { zugriff: 'zugriff-abc', externerNutzer: '4711', laeuftAb: null }

const BEISPIEL_GPX = `<?xml version="1.0"?>
<gpx version="1.1"><trk><trkseg>
  <trkpt lat="46.5934" lon="7.9086"><ele>800</ele><time>2026-07-04T08:00:00Z</time></trkpt>
  <trkpt lat="46.5900" lon="7.9105"><ele>830</ele><time>2026-07-04T08:10:00Z</time></trkpt>
</trkseg></trk></gpx>`

/** Eine Übung, wie `GET /v3/exercises/{id}` sie liefert. */
function uebung(teil: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'aQlC83',
    'upload-time': '2026-07-04T09:05:00.000Z',
    'polar-user': 'https://www.polaraccesslink.com/v3/users/4711',
    device: 'Polar Vantage V3',
    'start-time': '2026-07-04T10:40:02',
    'start-time-utc-offset': 120,
    duration: 'PT1H2M3S',
    calories: 530,
    distance: 24500,
    sport: 'CYCLING',
    'detailed-sport-info': 'ROAD_BIKING',
    'has-route': true,
    ...teil,
  }
}

/**
 * Ein Netz-Fake: Antworten je URL-Muster, dazu eine Mitschrift der Aufrufe.
 * Dasselbe Muster wie `FixedGeocoder` — Produktion reicht `fetch` herein.
 */
function baueHol(antworten: Array<[RegExp, { status?: number; json?: unknown; text?: string }]>): {
  hol: (url: string, init?: RequestInit) => Promise<Response>
  aufrufe: Array<{ url: string; init?: RequestInit }>
} {
  const aufrufe: Array<{ url: string; init?: RequestInit }> = []
  const hol = async (url: string, init?: RequestInit): Promise<Response> => {
    aufrufe.push({ url, ...(init ? { init } : {}) })
    for (const [muster, antwort] of antworten) {
      if (!muster.test(url)) continue
      const status = antwort.status ?? 200
      const koerper =
        antwort.text ?? (antwort.json !== undefined ? JSON.stringify(antwort.json) : '')
      return new Response(status === 204 ? null : koerper, { status })
    }
    return new Response('', { status: 404 })
  }
  return { hol, aufrufe }
}

describe('Hilfsrechnungen', () => {
  it('liest ISO-8601-Dauern', () => {
    expect(durationToSeconds('PT1H2M3S')).toBe(3723)
    expect(durationToSeconds('PT44M')).toBe(2640)
    expect(durationToSeconds('PT30S')).toBe(30)
    expect(durationToSeconds('PT1H2M3.5S')).toBe(3723.5)
  })

  it('meldet Unbrauchbares als null, statt 0 zu behaupten', () => {
    // 0 wäre eine Aussage („dauerte keine Sekunde"), null ist die Wahrheit
    expect(durationToSeconds(undefined)).toBeNull()
    expect(durationToSeconds('PT')).toBeNull()
    expect(durationToSeconds('zwei Stunden')).toBeNull()
  })

  it('rechnet Polars lokale Startzeit samt Versatz in den echten Zeitpunkt', () => {
    // 10:40:02 lokal bei +120 min ist 08:40:02 UTC. Wer einfach „Z" anhängt,
    // verschiebt jede Tour um ihren Zonen-Versatz — und die Pipeline hängt
    // Tageszeit und Sonnenstand daran.
    expect(startTime('2026-07-04T10:40:02', 120)).toBe(Date.parse('2026-07-04T08:40:02Z'))
    expect(startTime('2026-07-04T10:40:02', -300)).toBe(Date.parse('2026-07-04T15:40:02Z'))
  })

  it('lässt eine Zeit mit eigener Zonenangabe unangetastet', () => {
    expect(startTime('2026-07-04T08:40:02Z', 0)).toBe(Date.parse('2026-07-04T08:40:02Z'))
  })

  it('meldet fehlende oder kaputte Startzeit als null', () => {
    expect(startTime(undefined, 0)).toBeNull()
    expect(startTime('gestern', 0)).toBeNull()
  })
})

describe('Konfiguration', () => {
  it('ist ohne Client-Zugangsdaten nicht verfügbar', () => {
    const ohne = new PolarProvider({ clientId: null, clientSecret: null, webhookGeheimnis: null })
    expect(ohne.konfiguriert).toBe(false)
  })

  it('ist auch ohne Webhook-Geheimnis einsatzbereit (es entsteht später)', () => {
    const provider = new PolarProvider({ clientId: 'a', clientSecret: 'b', webhookGeheimnis: null })
    expect(provider.konfiguriert).toBe(true)
  })
})

describe('OAuth', () => {
  it('baut die Autorisierungs-URL mit state und redirect_uri', () => {
    const provider = new PolarProvider(ZUGANG)
    const url = new URL(
      provider.autorisierungsUrl('z-123', 'https://maptale.io/api/tracker/polar/callback'),
    )
    expect(url.origin + url.pathname).toBe('https://flow.polar.com/oauth2/authorization')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('client_id')).toBe('klient-1')
    expect(url.searchParams.get('state')).toBe('z-123')
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://maptale.io/api/tracker/polar/callback',
    )
  })

  it('tauscht den Code mit Basic-Auth und formkodiertem Körper', async () => {
    const { hol, aufrufe } = baueHol([
      [
        /polarremote\.com/,
        { json: { access_token: 'tok-1', token_type: 'bearer', x_user_id: 4711 } },
      ],
    ])
    const provider = new PolarProvider(ZUGANG, hol)
    const tokens = await provider.tauscheCode('code-xyz', 'https://maptale.io/cb')

    const kopf = (aufrufe[0]?.init?.headers ?? {}) as Record<string, string>
    expect(kopf['authorization']).toBe(
      `Basic ${Buffer.from('klient-1:geheim-1').toString('base64')}`,
    )
    expect(kopf['content-type']).toBe('application/x-www-form-urlencoded')
    const koerper = new URLSearchParams(String(aufrufe[0]?.init?.body))
    expect(koerper.get('grant_type')).toBe('authorization_code')
    expect(koerper.get('code')).toBe('code-xyz')
    expect(koerper.get('redirect_uri')).toBe('https://maptale.io/cb')

    // x_user_id wird zur externen Kennung — sie ist der Zuordnungsweg des Webhooks
    expect(tokens).toMatchObject({ zugriff: 'tok-1', externerNutzer: '4711' })
    // Polar-Tokens laufen nicht ab: kein Ablaufdatum, keine Erneuerung.
    // Über den Vertrags-Typ geprüft — dort ist `erneuereTokens` optional, und
    // genau dieses Weglassen ist die Aussage.
    expect(tokens.laeuftAb).toBeNull()
    expect((provider as TrackerProvider).erneuereTokens).toBeUndefined()
  })

  it('meldet eine abgelehnte oder unvollständige Token-Antwort als Fehler', async () => {
    const abgelehnt = new PolarProvider(ZUGANG, baueHol([[/polarremote/, { status: 400 }]]).hol)
    await expect(abgelehnt.tauscheCode('x', 'y')).rejects.toThrow(/400/)
    const ohneKennung = new PolarProvider(
      ZUGANG,
      baueHol([[/polarremote/, { json: { access_token: 'a' } }]]).hol,
    )
    await expect(ohneKennung.tauscheCode('x', 'y')).rejects.toThrow(/Nutzerkennung/)
  })
})

describe('Registrierung (der Pflichtschritt)', () => {
  it('meldet den Nutzer mit member-id an', async () => {
    const { hol, aufrufe } = baueHol([[/\/v3\/users$/, { json: { 'polar-user-id': 4711 } }]])
    const provider = new PolarProvider(ZUGANG, hol)
    await provider.nachVerknuepfung(TOKENS)
    expect(aufrufe[0]?.url).toBe('https://www.polaraccesslink.com/v3/users')
    expect(aufrufe[0]?.init?.method).toBe('POST')
    // Die POLAR-Kennung geht heraus, nicht unsere Benutzer-ID: Polar verlangt
    // nur Eindeutigkeit, und unsere Kennung wäre eine Weitergabe ohne Zweck.
    expect(JSON.parse(String(aufrufe[0]?.init?.body))).toEqual({ 'member-id': '4711' })
  })

  it('nimmt 409 „schon registriert" als Erfolg — sonst scheiterte jedes Neuverbinden', async () => {
    const provider = new PolarProvider(ZUGANG, baueHol([[/\/v3\/users$/, { status: 409 }]]).hol)
    await expect(provider.nachVerknuepfung(TOKENS)).resolves.toMatchObject({
      zugriff: 'zugriff-abc',
    })
  })

  it('meldet echte Fehler weiter', async () => {
    const provider = new PolarProvider(ZUGANG, baueHol([[/\/v3\/users$/, { status: 500 }]]).hol)
    await expect(provider.nachVerknuepfung(TOKENS)).rejects.toThrow(/500/)
  })
})

describe('Trennen', () => {
  it('hebt die Autorisierung beim Anbieter auf', async () => {
    const { hol, aufrufe } = baueHol([[/\/v3\/users\/4711$/, { status: 204 }]])
    await new PolarProvider(ZUGANG, hol).trenne(TOKENS)
    expect(aufrufe[0]?.url).toBe('https://www.polaraccesslink.com/v3/users/4711')
    expect(aufrufe[0]?.init?.method).toBe('DELETE')
  })

  it('nimmt 404 hin — war schon weg ist auch erledigt', async () => {
    const provider = new PolarProvider(ZUGANG, baueHol([[/\/v3\/users\//, { status: 404 }]]).hol)
    await expect(provider.trenne(TOKENS)).resolves.toBeUndefined()
  })
})

describe('Webhook', () => {
  const nutzlast = JSON.stringify({
    event: 'EXERCISE',
    user_id: 4711,
    entity_id: 'aQlC83',
    timestamp: '2026-07-04T09:05:00.000Z',
    url: 'https://www.polaraccesslink.com/v3/exercises/aQlC83',
  })
  const signiere = (koerper: string, geheimnis = 'wh-geheim'): string =>
    createHmac('sha256', geheimnis).update(koerper).digest('hex')

  it('nimmt eine korrekt signierte Zustellung an', () => {
    const provider = new PolarProvider(ZUGANG)
    expect(
      provider.webhook.verifiziere({
        rohBody: nutzlast,
        kopfzeilen: { 'polar-webhook-signature': signiere(nutzlast) },
        query: {},
      }),
    ).toBe(true)
  })

  it('weist falsche Signatur, fremdes Geheimnis und veränderten Körper ab', () => {
    const provider = new PolarProvider(ZUGANG)
    const pruefe = (rohBody: string, sig: string): boolean =>
      provider.webhook.verifiziere({
        rohBody,
        kopfzeilen: { 'polar-webhook-signature': sig },
        query: {},
      })
    expect(pruefe(nutzlast, 'abc')).toBe(false)
    expect(pruefe(nutzlast, signiere(nutzlast, 'anderes-geheimnis'))).toBe(false)
    // Signatur über den ROHEN Körper: ein verändertes Byte muss auffallen
    expect(pruefe(nutzlast.replace('aQlC83', 'aQlC84'), signiere(nutzlast))).toBe(false)
  })

  it('lehnt ohne hinterlegtes Geheimnis ALLES ab', () => {
    // Die Alternative wäre ein Eingang, der so lange offen steht, wie jemand
    // die Einrichtung vergisst.
    const ohne = new PolarProvider({ ...ZUGANG, webhookGeheimnis: null })
    expect(
      ohne.webhook.verifiziere({
        rohBody: nutzlast,
        kopfzeilen: { 'polar-webhook-signature': signiere(nutzlast) },
        query: {},
      }),
    ).toBe(false)
  })

  it('erkennt den PING — die einzige Zustellung ohne prüfbare Signatur', () => {
    const provider = new PolarProvider(ZUGANG)
    const ping = JSON.stringify({ timestamp: '2026-08-10T00:00:00Z', event: 'PING' })
    expect(provider.webhook.istPing({ rohBody: ping, kopfzeilen: {}, query: {} })).toBe(true)
  })

  it('lässt über den PING-Weg nichts durch, was Arbeit auslöst', () => {
    const provider = new PolarProvider(ZUGANG)
    const istPing = (nutzlast: unknown): boolean =>
      provider.webhook.istPing({ rohBody: JSON.stringify(nutzlast), kopfzeilen: {}, query: {} })
    // Ein „PING" mit Kennungen wäre der Versuch, an der Signatur vorbei einen
    // Import anzustoßen — er zählt nicht als Ping und fällt in die Prüfung.
    expect(istPing({ event: 'PING', user_id: 4711, entity_id: 'aQlC83' })).toBe(false)
    expect(istPing({ event: 'EXERCISE', user_id: 4711, entity_id: 'aQlC83' })).toBe(false)
    expect(istPing({ event: 'PING', entity_id: 'x' })).toBe(false)
  })

  it('liest ein EXERCISE-Ereignis', () => {
    const provider = new PolarProvider(ZUGANG)
    expect(
      provider.webhook.parseEreignisse({ rohBody: nutzlast, kopfzeilen: {}, query: {} }),
    ).toEqual([{ externerNutzer: '4711', externeId: 'aQlC83', art: 'aktivitaet' }])
  })

  it('übergeht PING, SLEEP und kaputtes JSON, ohne zu werfen', () => {
    const provider = new PolarProvider(ZUGANG)
    const leer = (rohBody: string): unknown[] =>
      provider.webhook.parseEreignisse({ rohBody, kopfzeilen: {}, query: {} })
    // Nicht-Übungen gehen uns nichts an — die Antwort bleibt trotzdem 200,
    // sonst hält Polar die Zustellung für gescheitert und wiederholt sie.
    expect(leer(JSON.stringify({ event: 'PING' }))).toEqual([])
    expect(leer(JSON.stringify({ event: 'SLEEP', user_id: 1, entity_id: 'x' }))).toEqual([])
    expect(leer('kein json')).toEqual([])
  })
})

describe('Track holen', () => {
  const holeMit = (
    uebungsDaten: Record<string, unknown>,
    gpxAntwort: { status?: number; text?: string } = { text: BEISPIEL_GPX },
  ) =>
    baueHol([
      [/\/v3\/exercises\/[^/]+\/gpx$/, gpxAntwort],
      [/\/v3\/exercises\/[^/]+$/, { json: uebungsDaten }],
    ])

  it('holt Übung und GPX und baut daraus den Rohtrack', async () => {
    const { hol, aufrufe } = holeMit(uebung())
    const track = await new PolarProvider(ZUGANG, hol).holeTrack(TOKENS, 'aQlC83')

    expect(track.format).toBe('gpx')
    expect(new TextDecoder().decode(track.bytes)).toContain('<trkpt')
    // Startzeit lokal + Versatz, Ende = Start + Dauer (PT1H2M3S)
    expect(track.start).toBe('2026-07-04T08:40:02.000Z')
    expect(track.ende).toBe('2026-07-04T09:42:05.000Z')
    // Die genauere Angabe gewinnt: ROAD_BIKING trägt mehr als CYCLING
    expect(track.sportart).toBe('ROAD_BIKING')
    // GPX wird mit dem passenden Accept-Kopf geholt
    const gpxAufruf = aufrufe.find((a) => a.url.endsWith('/gpx'))
    expect((gpxAufruf?.init?.headers as Record<string, string>)['accept']).toBe(
      'application/gpx+xml',
    )
  })

  it('liest auch die Unterstrich-Schreibweise der Felder', async () => {
    // Polar schreibt seine Felder uneinheitlich; beide Formen zu lesen kostet
    // drei Zeilen, die falsche zu wählen kostet das erste echte Training.
    const { hol } = holeMit({
      id: 'x1',
      start_time: '2026-07-04T10:40:02',
      start_time_utc_offset: 120,
      duration: 'PT30M',
      has_route: true,
      detailed_sport_info: 'RUNNING',
    })
    const track = await new PolarProvider(ZUGANG, hol).holeTrack(TOKENS, 'x1')
    expect(track.start).toBe('2026-07-04T08:40:02.000Z')
    expect(track.sportart).toBe('RUNNING')
  })

  it('meldet eine Aktivität ohne Route, BEVOR es die Datei holt', async () => {
    const { hol, aufrufe } = holeMit(uebung({ 'has-route': false }))
    await expect(new PolarProvider(ZUGANG, hol).holeTrack(TOKENS, 'aQlC83')).rejects.toThrow(
      NoRouteError,
    )
    // Eine Krafteinheit hat keine Route — sie trotzdem herunterzuladen wäre
    // ein Aufruf für nichts.
    expect(aufrufe.some((a) => a.url.endsWith('/gpx'))).toBe(false)
  })

  it('nimmt auch ein 404 auf die GPX-Datei als „ohne Route"', async () => {
    // Die Doku sagt zu diesem Fall nichts, also fangen wir beide Wege ab.
    const { hol } = holeMit(uebung(), { status: 404 })
    await expect(new PolarProvider(ZUGANG, hol).holeTrack(TOKENS, 'aQlC83')).rejects.toThrow(
      NoRouteError,
    )
  })

  it('meldet abgelaufene Tokens als solche, damit der Kern die Verknüpfung stilllegt', async () => {
    const { hol } = baueHol([[/\/v3\/exercises/, { status: 401 }]])
    await expect(new PolarProvider(ZUGANG, hol).holeTrack(TOKENS, 'aQlC83')).rejects.toThrow(
      InvalidTokensError,
    )
  })

  it('verweigert eine Übung ohne brauchbare Zeitangaben', async () => {
    const { hol } = holeMit(uebung({ duration: 'PT' }))
    await expect(new PolarProvider(ZUGANG, hol).holeTrack(TOKENS, 'aQlC83')).rejects.toThrow(
      /Start- oder Dauerangabe/,
    )
  })
})

describe('Nachziehen (Rückfall, wenn eine Zustellung verloren ging)', () => {
  // Die Umkehrung eines früheren Verhaltens: Gefiltert wurde nach der
  // STARTZEIT der Übung, verglichen mit dem Cursor des letzten Abrufs. Bei
  // Polar liegen zwischen beidem Stunden — eine Übung erscheint erst, wenn die
  // Uhr synchronisiert, und dazu muss die Ergebnisansicht weggeklickt sein.
  // Wer in dieser Lücke abrief, verlor seine Tour dauerhaft.
  it('listet auch, was VOR dem letzten Abruf begann — es erscheint später', async () => {
    const liste = [
      uebung({ id: 'alt', 'start-time': '2026-07-01T10:00:00', 'start-time-utc-offset': 0 }),
      uebung({ id: 'neu', 'start-time': '2026-07-05T10:00:00', 'start-time-utc-offset': 0 }),
    ]
    const { hol } = baueHol([[/\/v3\/exercises$/, { json: liste }]])
    const provider = new PolarProvider(ZUGANG, hol)
    const ereignisse = await provider.listeNeue(TOKENS, '2026-07-04T00:00:00Z')
    expect(ereignisse.map((e) => e.externeId)).toEqual(['alt', 'neu'])
    expect(ereignisse[0]?.externerNutzer).toBe('4711')
  })

  it('nimmt ohne Zeitpunkt alles und kommt mit der Objekt-Form zurecht', async () => {
    const { hol } = baueHol([
      [/\/v3\/exercises$/, { json: { exercises: [uebung({ id: 'a' }), uebung({ id: 'b' })] } }],
    ])
    const ereignisse = await new PolarProvider(ZUGANG, hol).listeNeue(TOKENS, null)
    expect(ereignisse.map((e) => e.externeId)).toEqual(['a', 'b'])
  })
})
