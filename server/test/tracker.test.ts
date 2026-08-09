// Der anbieterblinde Tracker-Kern: Ein erfundener Anbieter legt eine echte
// Tour an. Konzept: docs/concepts/konzept_tracker_integrationen.md.
//
// Kein Netz in der Suite — der TestProvider ist das Spiegelbild eines echten
// Adapters, wie FesterGeocoder und FesteWetterQuelle es für ihre Dienste sind.

import { describe, expect, it } from 'vitest'
import { entschluessele, gleichSicher, verschluessele } from '../src/tracker/krypto.js'
import { punkteZuGpx, zuGpx } from '../src/tracker/normalisierer.js'
import { Registry } from '../src/tracker/registry.js'
import { beispielRohTrack, TestProvider, testSignatur } from '../src/tracker/testprovider.js'
import { modusAusSportart } from '../src/tracker/touranleger.js'
import { MAX_VERSUCHE, TrackerDienst } from '../src/tracker/tracker.js'
import { OhneRouteFehler, type RohTrack } from '../src/tracker/vertrag.js'
import { baueTestApp, type TestUmgebung } from './helfer.js'

const WEBHOOK_GEHEIMNIS = 'geheim-fuer-tests'

async function baueMitProvider(
  provider = new TestProvider({ webhookGeheimnis: WEBHOOK_GEHEIMNIS, tracks: { a1: beispielRohTrack() } }),
): Promise<{ u: TestUmgebung; provider: TestProvider }> {
  const u = await baueTestApp([], null, null, {}, null, null, null, [provider])
  return { u, provider }
}

/** Konto verknüpfen — den ganzen OAuth-Weg über die echten Routen. */
async function verknuepfe(u: TestUmgebung, code = 'ok'): Promise<void> {
  const start = await u.app.inject({
    method: 'POST',
    url: '/api/tracker/polar/connect',
    cookies: u.cookies,
    payload: {},
  })
  expect(start.statusCode).toBe(200)
  const url = new URL((start.json() as { autorisierungsUrl: string }).autorisierungsUrl)
  const zustand = url.searchParams.get('state') ?? ''
  const rueckkehr = await u.app.inject({
    method: 'GET',
    url: `/api/tracker/polar/callback?code=${code}&state=${encodeURIComponent(zustand)}`,
  })
  expect(rueckkehr.statusCode).toBe(302)
}

/** Eine Webhook-Zustellung mit gültiger Signatur — und auf den Import warten. */
async function melde(
  u: TestUmgebung,
  nutzlast: Record<string, unknown>,
  geheimnis = WEBHOOK_GEHEIMNIS,
): Promise<number> {
  const rohBody = JSON.stringify(nutzlast)
  const antwort = await u.app.inject({
    method: 'POST',
    url: '/api/webhooks/tracker/polar',
    headers: { 'content-type': 'application/json', 'polar-webhook-signature': testSignatur(rohBody, geheimnis) },
    payload: rohBody,
  })
  await Promise.all([...u.app.trackerLaeufe.values()])
  // Der Import stößt die Pipeline an — auch darauf warten, sonst ist die Tour
  // beim Prüfen noch „verarbeitung".
  await Promise.all([...u.app.verarbeitungen.values()])
  return antwort.statusCode
}

describe('Token-Verschlüsselung', () => {
  it('verschlüsselt und entschlüsselt verlustfrei', () => {
    const gepackt = verschluessele('zugriff-token-123', 'schluessel')
    expect(gepackt).not.toContain('zugriff-token-123')
    expect(gepackt.startsWith('v1.')).toBe(true)
    expect(entschluessele(gepackt, 'schluessel')).toBe('zugriff-token-123')
  })

  it('erzeugt bei gleichem Klartext verschiedene Geheimtexte (eigenes IV)', () => {
    expect(verschluessele('gleich', 's')).not.toBe(verschluessele('gleich', 's'))
  })

  it('erkennt falschen Schlüssel und veränderte Daten', () => {
    const gepackt = verschluessele('geheim', 'richtig')
    expect(() => entschluessele(gepackt, 'falsch')).toThrow()
    // Ein gekipptes Byte im Geheimtext muss auffallen — dafür GCM statt CBC
    const teile = gepackt.split('.')
    const daten = Buffer.from(teile[3] as string, 'base64url')
    daten[0] = (daten[0] ?? 0) ^ 0xff
    expect(() => entschluessele([...teile.slice(0, 3), daten.toString('base64url')].join('.'), 'richtig')).toThrow()
  })

  it('vergleicht Geheimnisse ohne Zeitleck', () => {
    expect(gleichSicher('abc', 'abc')).toBe(true)
    expect(gleichSicher('abc', 'abd')).toBe(false)
    expect(gleichSicher('abc', 'abcd')).toBe(false)
  })
})

describe('Normalisierer', () => {
  it('macht aus Punkten GPX mit Höhe und Zeit', () => {
    const gpx = punkteZuGpx(
      [
        { lat: 46.5934, lng: 7.9086, ele: 800, zeit: '2026-07-04T08:00:00Z' },
        { lat: 46.59, lng: 7.9105, ele: 830, zeit: '2026-07-04T08:10:00Z' },
      ],
      'Meine Fahrt',
    )
    expect(gpx).toContain('<name>Meine Fahrt</name>')
    expect((gpx.match(/<trkpt/g) ?? []).length).toBe(2)
    expect(gpx).toContain('<ele>800</ele>')
    expect(gpx).toContain('<time>2026-07-04T08:00:00Z</time>')
  })

  it('wirft XML-Sonderzeichen im Titel nicht roh ins Dokument', () => {
    const gpx = punkteZuGpx(
      [
        { lat: 1, lng: 1, zeit: '2026-07-04T08:00:00Z' },
        { lat: 2, lng: 2, zeit: '2026-07-04T08:10:00Z' },
      ],
      'Tour <b>&</b>',
    )
    expect(gpx).toContain('&lt;b&gt;&amp;&lt;/b&gt;')
  })

  it('verwirft unbrauchbare Punkte und meldet „ohne Route", wenn nichts bleibt', () => {
    expect(() =>
      punkteZuGpx([
        { lat: NaN, lng: 7.9, zeit: 'x' },
        { lat: 99, lng: 500, zeit: 'x' },
      ]),
    ).toThrow(OhneRouteFehler)
  })

  it('reicht fertiges GPX durch, statt es neu zu schreiben', () => {
    const original = '<gpx><trk><trkseg><trkpt lat="1" lon="2"><eigenes>x</eigenes></trkpt></trkseg></trk></gpx>'
    const track: RohTrack = {
      format: 'gpx',
      bytes: new TextEncoder().encode(original),
      start: '2026-07-04T08:00:00Z',
      ende: '2026-07-04T09:00:00Z',
    }
    // Unbekannte Angaben (hier `<eigenes>`) bleiben erhalten — Neuschreiben
    // verlöre sie, und die Pipeline liest ohnehin nur, was sie braucht.
    expect(zuGpx(track)).toBe(original)
  })

  it('sagt bei FIT, dass es noch nicht gelesen wird (statt still nichts zu tun)', () => {
    expect(() =>
      zuGpx({ format: 'fit', bytes: new Uint8Array([1, 2]), start: 'a', ende: 'b' }),
    ).toThrow(/Etappe 2/)
  })
})

describe('Sportart → Fortbewegung', () => {
  it('ordnet die geläufigen Arten zu', () => {
    expect(modusAusSportart('Ride')).toBe('bike')
    expect(modusAusSportart('VirtualRun')).toBe('walk')
    expect(modusAusSportart('Kayaking')).toBe('ferry')
  })

  it('lässt Unbekanntes offen, damit die Server-Erkennung arbeiten darf', () => {
    expect(modusAusSportart('Unterwasserhockey')).toBeNull()
    expect(modusAusSportart(null)).toBeNull()
  })
})

describe('Registry', () => {
  it('zeigt alle Anbieter, gibt aber nur konfigurierte heraus', () => {
    const registry = new Registry([new TestProvider({ konfiguriert: false })])
    expect(registry.alle()).toHaveLength(1)
    expect(registry.verfuegbare()).toHaveLength(0)
    // Ein unkonfigurierter Anbieter darf keine Route beantworten — sonst
    // führte „Verbinden" auf eine Fehlerseite des Anbieters.
    expect(registry.hole('polar')).toBeNull()
  })
})

describe('Verknüpfen (OAuth)', () => {
  it('listet Anbieter samt Verfügbarkeit', async () => {
    const { u } = await baueMitProvider()
    const antwort = await u.app.inject({ method: 'GET', url: '/api/tracker/providers', cookies: u.cookies })
    expect(antwort.statusCode).toBe(200)
    const anbieter = (antwort.json() as { anbieter: Array<Record<string, unknown>> }).anbieter
    expect(anbieter[0]).toMatchObject({ id: 'polar', name: 'Polar', verfuegbar: true, verbunden: false })
  })

  it('verknüpft über den ganzen Weg und ruft die Pflichtschritte des Anbieters', async () => {
    const { u, provider } = await baueMitProvider()
    await verknuepfe(u)
    // Polars `POST /v3/users` — ohne diesen Schritt liefert die API still nichts
    expect(provider.aufrufe).toContain('registriere')
    const antwort = await u.app.inject({ method: 'GET', url: '/api/tracker/providers', cookies: u.cookies })
    expect((antwort.json() as { anbieter: Array<{ verbunden: boolean }> }).anbieter[0]?.verbunden).toBe(true)
  })

  it('legt die Tokens NICHT im Klartext ab', async () => {
    const { u } = await baueMitProvider()
    await verknuepfe(u, 'geheimer-code')
    const zeile = u.app.deps.db.prepare('SELECT tokens FROM tracker_verknuepfungen').get() as { tokens: string }
    expect(zeile.tokens).not.toContain('zugriff-geheimer-code')
    expect(zeile.tokens.startsWith('v1.')).toBe(true)
  })

  it('hält „verbunden seit" fest, wenn nur die Tokens erneuert werden', async () => {
    // `verknuepfe` legt nicht nur beim Verbinden an, sondern schreibt auch
    // jede Token-Erneuerung — mitgeschriebenes Datum stünde auf der
    // Kontoseite dauerhaft auf „vor ein paar Minuten".
    const { u } = await baueMitProvider()
    await verknuepfe(u)
    const { id: uid } = u.app.deps.db.prepare('SELECT id FROM users LIMIT 1').get() as { id: string }
    const vorher = u.app.tracker.verknuepfung(uid, 'polar')?.verbundenAm
    u.app.tracker.verknuepfe(uid, 'polar', { zugriff: 'frisch', externerNutzer: 'extern-1' })
    expect(u.app.tracker.verknuepfung(uid, 'polar')?.verbundenAm).toBe(vorher)

    // Nach dem Trennen ist es eine NEUE Verbindung — dort zählt das neue
    // Datum. Mit eigener Uhr geprüft, sonst fällt beides in dieselbe
    // Millisekunde und der Test bewiese nichts.
    const spaeter = new Date(Date.parse(vorher ?? '') + 86_400_000)
    const dienst = new TrackerDienst(u.app.deps.db, 'test-schluessel', () => spaeter)
    dienst.trenne(uid, 'polar')
    dienst.verknuepfe(uid, 'polar', { zugriff: 'neu', externerNutzer: 'extern-1' })
    expect(dienst.verknuepfung(uid, 'polar')?.verbundenAm).toBe(spaeter.toISOString())
  })

  it('verlangt einen gültigen state — der CSRF-Riegel der Verknüpfung', async () => {
    const { u } = await baueMitProvider()
    const antwort = await u.app.inject({ method: 'GET', url: '/api/tracker/polar/callback?code=ok&state=erfunden' })
    expect(antwort.headers.location).toContain('tracker=abgelaufen')
    expect(u.app.deps.db.prepare('SELECT COUNT(*) AS n FROM tracker_verknuepfungen').get()).toEqual({ n: 0 })
  })

  it('verbraucht den state EINMALIG', async () => {
    const { u } = await baueMitProvider()
    const start = await u.app.inject({ method: 'POST', url: '/api/tracker/polar/connect', cookies: u.cookies, payload: {} })
    const zustand = new URL((start.json() as { autorisierungsUrl: string }).autorisierungsUrl).searchParams.get('state') ?? ''
    const erste = await u.app.inject({ method: 'GET', url: `/api/tracker/polar/callback?code=ok&state=${zustand}` })
    expect(erste.headers.location).toContain('tracker=verbunden')
    const zweite = await u.app.inject({ method: 'GET', url: `/api/tracker/polar/callback?code=ok&state=${zustand}` })
    expect(zweite.headers.location).toContain('tracker=abgelaufen')
  })

  it('behandelt den Abbruch beim Anbieter als Entscheidung, nicht als Fehler', async () => {
    const { u } = await baueMitProvider()
    const antwort = await u.app.inject({ method: 'GET', url: '/api/tracker/polar/callback?error=access_denied' })
    expect(antwort.headers.location).toContain('tracker=abgebrochen')
  })

  it('trennt beim Anbieter mit und behält die Touren', async () => {
    const { u, provider } = await baueMitProvider()
    await verknuepfe(u)
    await melde(u, { event: 'EXERCISE', user_id: 'extern-1', entity_id: 'a1' })
    const vorher = u.app.deps.db.prepare('SELECT COUNT(*) AS n FROM tours').get() as { n: number }
    expect(vorher.n).toBe(1)

    const antwort = await u.app.inject({ method: 'DELETE', url: '/api/tracker/polar', cookies: u.cookies })
    expect(antwort.statusCode).toBe(200)
    expect(provider.aufrufe).toContain('trenne')
    expect(u.app.deps.db.prepare('SELECT COUNT(*) AS n FROM tracker_verknuepfungen').get()).toEqual({ n: 0 })
    // Die Touren gehören dem Nutzer, nicht der Verknüpfung
    expect(u.app.deps.db.prepare('SELECT COUNT(*) AS n FROM tours').get()).toEqual({ n: 1 })
  })
})

describe('Webhook → Tour', () => {
  it('legt aus einer Zustellung eine spielbare Tour an', async () => {
    const { u } = await baueMitProvider()
    await verknuepfe(u)
    expect(await melde(u, { event: 'EXERCISE', user_id: 'extern-1', entity_id: 'a1' })).toBe(200)

    const tour = u.app.deps.db.prepare('SELECT * FROM tours').get() as {
      id: string
      status: string
      visibility: string
      client_tour_id: string
    }
    expect(tour.status).toBe('bereit')
    // Vorgabe wie beim Upload: geteilt wird bewusst, nicht als Nebenwirkung
    expect(tour.visibility).toBe('private')
    // Der Dedup-Riegel steckt in der vorhandenen Idempotenz-Spalte
    expect(tour.client_tour_id).toBe('polar:a1')

    const json = await u.app.inject({ method: 'GET', url: `/api/tours/${tour.id}`, cookies: u.cookies })
    expect((json.json() as { schema: string }).schema).toBe('maptale/tour@1')

    const importe = await u.app.inject({ method: 'GET', url: '/api/tracker/imports', cookies: u.cookies })
    expect((importe.json() as { importe: Array<{ status: string; tourId: string }> }).importe[0]).toMatchObject({
      status: 'fertig',
      tourId: tour.id,
    })
  })

  it('legt bei wiederholter Zustellung KEINE zweite Tour an', async () => {
    const { u } = await baueMitProvider()
    await verknuepfe(u)
    const nutzlast = { event: 'EXERCISE', user_id: 'extern-1', entity_id: 'a1' }
    await melde(u, nutzlast)
    await melde(u, nutzlast)
    expect(u.app.deps.db.prepare('SELECT COUNT(*) AS n FROM tours').get()).toEqual({ n: 1 })
    expect(u.app.deps.db.prepare('SELECT COUNT(*) AS n FROM tracker_importe').get()).toEqual({ n: 1 })
  })

  it('weist eine falsche Signatur mit 401 ab, ohne irgendetwas anzulegen', async () => {
    const { u } = await baueMitProvider()
    await verknuepfe(u)
    expect(await melde(u, { event: 'EXERCISE', user_id: 'extern-1', entity_id: 'a1' }, 'falsches-geheimnis')).toBe(401)
    expect(u.app.deps.db.prepare('SELECT COUNT(*) AS n FROM tracker_importe').get()).toEqual({ n: 0 })
    expect(u.app.deps.db.prepare('SELECT COUNT(*) AS n FROM tours').get()).toEqual({ n: 0 })
  })

  it('verwirft Zustellungen für unbekannte Konten still', async () => {
    const { u } = await baueMitProvider()
    await verknuepfe(u)
    // Antwort wie im Erfolgsfall: Eine Fehlermeldung wäre eine Auskunft
    // darüber, welche Anbieter-Konten bei uns liegen.
    expect(await melde(u, { event: 'EXERCISE', user_id: 'wer-anders', entity_id: 'a1' })).toBe(200)
    expect(u.app.deps.db.prepare('SELECT COUNT(*) AS n FROM tracker_importe').get()).toEqual({ n: 0 })
  })

  it('setzt die Verknüpfung auf abgelaufen, wenn der Anbieter abmeldet', async () => {
    const { u } = await baueMitProvider()
    await verknuepfe(u)
    await melde(u, { event: 'ABMELDUNG', user_id: 'extern-1', entity_id: 'x' })
    const zeile = u.app.deps.db.prepare('SELECT status, letzter_fehler FROM tracker_verknuepfungen').get() as {
      status: string
      letzter_fehler: string
    }
    // Eine stumm tote Verknüpfung ist die schlimmere Variante: Der Nutzer
    // wartet sonst auf Touren, die nie kommen.
    expect(zeile.status).toBe('abgelaufen')
    expect(zeile.letzter_fehler).toContain('widerrufen')
  })

  it('überspringt eine Aktivität ohne GPS-Route, statt sie als Fehler zu führen', async () => {
    const provider = new TestProvider({
      webhookGeheimnis: WEBHOOK_GEHEIMNIS,
      tracks: { leer: beispielRohTrack({ punkte: [] }) },
    })
    const { u } = await baueMitProvider(provider)
    await verknuepfe(u)
    await melde(u, { event: 'EXERCISE', user_id: 'extern-1', entity_id: 'leer' })
    const zeile = u.app.deps.db.prepare('SELECT status FROM tracker_importe').get() as { status: string }
    expect(zeile.status).toBe('uebersprungen')
    expect(u.app.deps.db.prepare('SELECT COUNT(*) AS n FROM tours').get()).toEqual({ n: 0 })
  })

  it('überspringt eine zu kurze Aktivität (kein Müll im Konto)', async () => {
    const kurz = beispielRohTrack({
      punkte: [
        { lat: 46.5934, lng: 7.9086, ele: 800, zeit: '2026-07-04T08:00:00Z' },
        { lat: 46.5935, lng: 7.9087, ele: 800, zeit: '2026-07-04T08:01:00Z' },
      ],
      start: '2026-07-04T08:00:00Z',
      ende: '2026-07-04T08:01:00Z',
    })
    const { u } = await baueMitProvider(
      new TestProvider({ webhookGeheimnis: WEBHOOK_GEHEIMNIS, tracks: { winzig: kurz } }),
    )
    await verknuepfe(u)
    await melde(u, { event: 'EXERCISE', user_id: 'extern-1', entity_id: 'winzig' })
    const zeile = u.app.deps.db.prepare('SELECT status, fehler FROM tracker_importe').get() as {
      status: string
      fehler: string
    }
    expect(zeile.status).toBe('uebersprungen')
    expect(zeile.fehler).toContain('Zu kurz')
  })

  it('führt einen unbekannten Anbieter-Fehler als Fehler, mit lesbarem Grund', async () => {
    const { u } = await baueMitProvider()
    await verknuepfe(u)
    await melde(u, { event: 'EXERCISE', user_id: 'extern-1', entity_id: 'gibts-nicht' })
    const zeile = u.app.deps.db.prepare('SELECT status, fehler FROM tracker_importe').get() as {
      status: string
      fehler: string
    }
    expect(zeile.status).toBe('fehler')
    expect(zeile.fehler).toContain('Unbekannte Aktivität')
  })

  it('importiert nicht für ein Konto ohne bestätigte E-Mail', async () => {
    const { u } = await baueMitProvider()
    await verknuepfe(u)
    u.app.deps.db.prepare('UPDATE users SET email_verified = 0').run()
    await melde(u, { event: 'EXERCISE', user_id: 'extern-1', entity_id: 'a1' })
    const zeile = u.app.deps.db.prepare('SELECT status, fehler FROM tracker_importe').get() as {
      status: string
      fehler: string
    }
    expect(zeile.status).toBe('fehler')
    expect(zeile.fehler).toContain('E-Mail')
    expect(u.app.deps.db.prepare('SELECT COUNT(*) AS n FROM tours').get()).toEqual({ n: 0 })
  })

  it('überspringt den Import, wenn der Speicher voll ist', async () => {
    const provider = new TestProvider({ webhookGeheimnis: WEBHOOK_GEHEIMNIS, tracks: { a1: beispielRohTrack() } })
    const u = await baueTestApp([], null, null, { maxSpeicherProBenutzer: 1 }, null, null, null, [provider])
    await verknuepfe(u)
    await melde(u, { event: 'EXERCISE', user_id: 'extern-1', entity_id: 'a1' })
    const zeile = u.app.deps.db.prepare('SELECT status, fehler FROM tracker_importe').get() as {
      status: string
      fehler: string
    }
    // Kein stilles Verwerfen: sichtbarer Hinweis im Konto
    expect(zeile.status).toBe('uebersprungen')
    expect(zeile.fehler).toContain('Speicher')
    expect(u.app.deps.db.prepare('SELECT COUNT(*) AS n FROM tours').get()).toEqual({ n: 0 })
  })
})

describe('Importliste und Benachrichtigung', () => {
  it('meldet Offenes erst als gesehen, wenn der Client es bestätigt', async () => {
    const { u } = await baueMitProvider()
    await verknuepfe(u)
    await melde(u, { event: 'EXERCISE', user_id: 'extern-1', entity_id: 'a1' })

    const erste = await u.app.inject({ method: 'GET', url: '/api/tracker/imports/pending', cookies: u.cookies })
    expect((erste.json() as { importe: unknown[] }).importe).toHaveLength(1)
    // Ohne Bestätigung bleibt es offen — ein Hintergrundlauf, der nur liest,
    // darf die Meldung nicht verbrauchen.
    const zweite = await u.app.inject({ method: 'GET', url: '/api/tracker/imports/pending', cookies: u.cookies })
    expect((zweite.json() as { importe: unknown[] }).importe).toHaveLength(1)

    const dritte = await u.app.inject({
      method: 'GET',
      url: '/api/tracker/imports/pending?gesehen=1',
      cookies: u.cookies,
    })
    expect((dritte.json() as { importe: unknown[] }).importe).toHaveLength(1)
    const vierte = await u.app.inject({ method: 'GET', url: '/api/tracker/imports/pending', cookies: u.cookies })
    expect((vierte.json() as { importe: unknown[] }).importe).toHaveLength(0)
  })

  it('zieht über den Polling-Weg nach, wenn ein Anbieter nicht pusht', async () => {
    const provider = new TestProvider({
      webhookGeheimnis: WEBHOOK_GEHEIMNIS,
      tracks: { p1: beispielRohTrack() },
      neue: [{ externerNutzer: 'extern-1', externeId: 'p1', art: 'aktivitaet' }],
    })
    const { u } = await baueMitProvider(provider)
    await verknuepfe(u)
    const antwort = await u.app.inject({ method: 'POST', url: '/api/tracker/polar/sync', cookies: u.cookies })
    expect(antwort.statusCode).toBe(200)
    await Promise.all([...u.app.verarbeitungen.values()])
    expect(antwort.json()).toMatchObject({ gefunden: 1, neu: 1 })
    expect(u.app.deps.db.prepare('SELECT COUNT(*) AS n FROM tours').get()).toEqual({ n: 1 })
  })
})

describe('Ein Fehlschlag ist kein Grabstein', () => {
  /** Die Import-Zeile roh aus der Datenbank (samt der Spalten hinter der API). */
  function importZeile(u: TestUmgebung): { status: string; versuche: number; wiederholbar: number; fehler: string | null } {
    return u.app.deps.db.prepare('SELECT status, versuche, wiederholbar, fehler FROM tracker_importe').get() as {
      status: string
      versuche: number
      wiederholbar: number
      fehler: string | null
    }
  }

  it('nimmt die Aktivität beim nächsten Anlauf wieder an, wenn der Grund vorüber ist', async () => {
    // Der Fall, für den Anbieter überhaupt wiederholt zustellen (Wahoo bis
    // 72 h): Beim ersten Mal war die Datei noch nicht da.
    const provider = new TestProvider({ webhookGeheimnis: WEBHOOK_GEHEIMNIS, tracks: {} })
    const { u } = await baueMitProvider(provider)
    await verknuepfe(u)
    await melde(u, { event: 'EXERCISE', user_id: 'extern-1', entity_id: 'a1' })
    expect(importZeile(u)).toMatchObject({ status: 'fehler', versuche: 1, wiederholbar: 1 })
    expect(u.app.deps.db.prepare('SELECT COUNT(*) AS n FROM tours').get()).toEqual({ n: 0 })

    // Die Fehlermeldung wird abgeholt — der Nutzer hat sie gesehen
    await u.app.inject({ method: 'GET', url: '/api/tracker/imports/pending?gesehen=1', cookies: u.cookies })

    provider.setzeTrack('a1', beispielRohTrack())
    await melde(u, { event: 'EXERCISE', user_id: 'extern-1', entity_id: 'a1' })
    expect(importZeile(u)).toMatchObject({ status: 'fertig', versuche: 2 })
    // Genau EINE Tour — der zweite Anlauf ist ein Nachholen, kein Duplikat
    expect(u.app.deps.db.prepare('SELECT COUNT(*) AS n FROM tours').get()).toEqual({ n: 1 })
    expect(u.app.deps.db.prepare('SELECT COUNT(*) AS n FROM tracker_importe').get()).toEqual({ n: 1 })
    // Der Ausgang des neuen Anlaufs ist eine NEUE Nachricht: Die geglückte
    // Tour muss gemeldet werden, obwohl der Fehlschlag davor quittiert war.
    const offen = await u.app.inject({ method: 'GET', url: '/api/tracker/imports/pending', cookies: u.cookies })
    expect((offen.json() as { importe: Array<{ status: string }> }).importe).toMatchObject([{ status: 'fertig' }])
  })

  it('hört nach dem Deckel auf und schreibt es an die Zeile', async () => {
    const provider = new TestProvider({ webhookGeheimnis: WEBHOOK_GEHEIMNIS, tracks: {} })
    const { u } = await baueMitProvider(provider)
    await verknuepfe(u)
    for (let i = 0; i < MAX_VERSUCHE + 2; i++) {
      await melde(u, { event: 'EXERCISE', user_id: 'extern-1', entity_id: 'a1' })
    }
    const zeile = importZeile(u)
    expect(zeile.versuche).toBe(MAX_VERSUCHE)
    expect(zeile.wiederholbar).toBe(0)
    // Kein stiller Deckel: Warum nicht mehr weiterprobiert wird, steht da
    expect(zeile.fehler).toContain(`nach ${MAX_VERSUCHE} Versuchen`)
  })

  it('probiert eine Aktivität OHNE Route nie wieder — die bleibt ohne Route', async () => {
    const provider = new TestProvider({
      webhookGeheimnis: WEBHOOK_GEHEIMNIS,
      tracks: { leer: { format: 'punkte', punkte: [], start: '2026-07-04T08:00:00Z', ende: '2026-07-04T09:00:00Z' } },
    })
    const { u } = await baueMitProvider(provider)
    await verknuepfe(u)
    await melde(u, { event: 'EXERCISE', user_id: 'extern-1', entity_id: 'leer' })
    await melde(u, { event: 'EXERCISE', user_id: 'extern-1', entity_id: 'leer' })
    expect(importZeile(u)).toMatchObject({ status: 'uebersprungen', versuche: 1, wiederholbar: 0 })
  })

  it('nimmt einen vollen Speicher dagegen wieder auf — der geht vorbei', async () => {
    const provider = new TestProvider({ webhookGeheimnis: WEBHOOK_GEHEIMNIS, tracks: { a1: beispielRohTrack() } })
    const u = await baueTestApp([], null, null, { maxSpeicherProBenutzer: 1 }, null, null, null, [provider])
    await verknuepfe(u)
    await melde(u, { event: 'EXERCISE', user_id: 'extern-1', entity_id: 'a1' })
    expect(importZeile(u)).toMatchObject({ status: 'uebersprungen', wiederholbar: 1 })
  })

  it('rückt den Sync-Zeitpunkt NICHT vor, solange etwas offen ist', async () => {
    // Der Zeitpunkt ist beim Polling der Cursor: vorgerückt, listet der
    // Anbieter die gescheiterte Aktivität nie wieder auf.
    const provider = new TestProvider({ webhookGeheimnis: WEBHOOK_GEHEIMNIS, tracks: {} })
    const { u } = await baueMitProvider(provider)
    await verknuepfe(u)
    await melde(u, { event: 'EXERCISE', user_id: 'extern-1', entity_id: 'a1' })
    const offen = u.app.deps.db.prepare('SELECT zuletzt_sync_am FROM tracker_verknuepfungen').get()
    expect(offen).toEqual({ zuletzt_sync_am: null })

    provider.setzeTrack('a1', beispielRohTrack())
    await melde(u, { event: 'EXERCISE', user_id: 'extern-1', entity_id: 'a1' })
    const fertig = u.app.deps.db.prepare('SELECT zuletzt_sync_am FROM tracker_verknuepfungen').get() as {
      zuletzt_sync_am: string | null
    }
    expect(fertig.zuletzt_sync_am).not.toBeNull()
  })
})

describe('Nachziehen von Hand', () => {
  it('bremst und antwortet 429 statt Anbieter und Pipeline zu fluten', async () => {
    const { u } = await baueMitProvider(
      new TestProvider({ webhookGeheimnis: WEBHOOK_GEHEIMNIS, tracks: {}, neue: [] }),
    )
    await verknuepfe(u)
    const kodes: number[] = []
    for (let i = 0; i < 8; i++) {
      kodes.push((await u.app.inject({ method: 'POST', url: '/api/tracker/polar/sync', cookies: u.cookies })).statusCode)
    }
    expect(kodes.filter((k) => k === 200).length).toBe(6)
    expect(kodes.at(-1)).toBe(429)
  })

  it('meldet einen abgelaufenen Zugang als 409 mit dem, was zu tun ist', async () => {
    const { u } = await baueMitProvider()
    await verknuepfe(u)
    const { id: uid } = u.app.deps.db.prepare('SELECT id FROM users LIMIT 1').get() as { id: string }
    // Abgelaufen und ohne Erneuerungs-Token: `gueltigeTokens` wirft
    u.app.tracker.verknuepfe(uid, 'polar', {
      zugriff: 'alt',
      laeuftAb: new Date(Date.now() - 60_000).toISOString(),
      externerNutzer: 'extern-1',
    })
    const antwort = await u.app.inject({ method: 'POST', url: '/api/tracker/polar/sync', cookies: u.cookies })
    expect(antwort.statusCode).toBe(409)
    expect((antwort.json() as { fehler: string }).fehler).toContain('neu verbinden')
  })

  it('meldet einen stummen Anbieter als 502, nicht als eigenen Fehler', async () => {
    const { u } = await baueMitProvider(
      new TestProvider({ webhookGeheimnis: WEBHOOK_GEHEIMNIS, tracks: {}, listeWirft: true }),
    )
    await verknuepfe(u)
    const antwort = await u.app.inject({ method: 'POST', url: '/api/tracker/polar/sync', cookies: u.cookies })
    expect(antwort.statusCode).toBe(502)
    expect((antwort.json() as { fehler: string }).fehler).not.toContain('Interner')
  })

  it('wartet nur auf die ersten Aktivitäten und schiebt den Rest in den Hintergrund', async () => {
    const viele = Array.from({ length: 5 }, (_, i) => `p${i}`)
    const provider = new TestProvider({
      webhookGeheimnis: WEBHOOK_GEHEIMNIS,
      tracks: Object.fromEntries(viele.map((id) => [id, beispielRohTrack()])),
      neue: viele.map((id) => ({ externerNutzer: 'extern-1', externeId: id, art: 'aktivitaet' as const })),
    })
    const { u } = await baueMitProvider(provider)
    await verknuepfe(u)
    const antwort = await u.app.inject({ method: 'POST', url: '/api/tracker/polar/sync', cookies: u.cookies })
    expect(antwort.json()).toMatchObject({ gefunden: 5, neu: 3, imHintergrund: 2 })
    await Promise.all([...u.app.trackerLaeufe.values()])
    await Promise.all([...u.app.verarbeitungen.values()])
    // Auch die nachlaufenden landen im Konto
    expect(u.app.deps.db.prepare('SELECT COUNT(*) AS n FROM tours').get()).toEqual({ n: 5 })
  })
})

describe('Ohne Anbieter und ohne Anmeldung', () => {
  it('antwortet mit einer leeren Liste statt zu fehlen', async () => {
    const u = await baueTestApp()
    const antwort = await u.app.inject({ method: 'GET', url: '/api/tracker/providers', cookies: u.cookies })
    expect(antwort.statusCode).toBe(200)
    expect(antwort.json()).toEqual({ anbieter: [] })
  })

  it('verlangt für die Nutzer-Routen eine Anmeldung', async () => {
    const { u } = await baueMitProvider()
    expect((await u.app.inject({ method: 'GET', url: '/api/tracker/providers' })).statusCode).toBe(401)
    expect((await u.app.inject({ method: 'POST', url: '/api/tracker/polar/connect', payload: {} })).statusCode).toBe(401)
  })

  it('beantwortet den Erreichbarkeits-Test des Anbieters mit 200, ganz ohne Signatur', async () => {
    // Polar schickt ihn beim ANLEGEN des Webhooks — der Signatur-Schlüssel
    // entsteht erst als Antwort darauf. Ohne diesen Weg scheiterte jede
    // Registrierung an der eigenen Prüfung („Ping failed, response was 401").
    const provider = new TestProvider({ webhookGeheimnis: WEBHOOK_GEHEIMNIS, istPing: true })
    const { u } = await baueMitProvider(provider)
    const antwort = await u.app.inject({
      method: 'POST',
      url: '/api/webhooks/tracker/polar',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ event: 'PING' }),
    })
    expect(antwort.statusCode).toBe(200)
    // Und er löst nichts aus: kein Import, keine Tour
    expect(u.app.deps.db.prepare('SELECT COUNT(*) AS n FROM tracker_importe').get()).toEqual({ n: 0 })
  })

  it('beantwortet den Webhook eines unbekannten Anbieters mit 404', async () => {
    const { u } = await baueMitProvider()
    const antwort = await u.app.inject({
      method: 'POST',
      url: '/api/webhooks/tracker/erfunden',
      headers: { 'content-type': 'application/json' },
      payload: '{}',
    })
    expect(antwort.statusCode).toBe(404)
  })
})
