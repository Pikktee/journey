// Integrationstests über die HTTP-Schnittstelle (fastify.inject): kompletter
// Lebenszyklus Upload → Finalize → Auslieferung, plus Auth-, Sichtbarkeits-
// und Range-Verhalten.

import { describe, expect, it } from 'vitest'
import type { TourJson } from '../src/pipeline/enrich.js'
import { FakeVideoWerkzeug } from '../src/pipeline/video.js'
import { FesteWetterQuelle, testRaster } from '../src/pipeline/weather.js'
import type { UploadManifest } from '../src/schema/upload.js'
import { baueTestApp, beispielManifest, type TestUmgebung } from './helfer.js'

async function legeTourAn(u: TestUmgebung, manifest = beispielManifest()): Promise<string> {
  const antwort = await u.app.inject({ method: 'POST', url: '/api/tours', cookies: u.cookies, payload: manifest })
  expect(antwort.statusCode).toBe(201)
  return (antwort.json() as { id: string }).id
}

async function ladeMediumHoch(u: TestUmgebung, tourId: string, mid = 'm1', inhalt = 'fake-jpeg-bytes'): Promise<void> {
  const antwort = await u.app.inject({
    method: 'PUT',
    url: `/api/tours/${tourId}/media/${mid}`,
    cookies: u.cookies,
    headers: { 'content-type': 'application/octet-stream' },
    payload: Buffer.from(inhalt),
  })
  expect(antwort.statusCode).toBe(200)
}

async function finalisiere(u: TestUmgebung, tourId: string): Promise<void> {
  const antwort = await u.app.inject({ method: 'POST', url: `/api/tours/${tourId}/finalize`, cookies: u.cookies })
  expect(antwort.statusCode).toBe(202)
  await u.app.verarbeitungen.get(tourId)
}

async function ladeTrackHoch(u: TestUmgebung, tourId: string, gpx: string): Promise<void> {
  const antwort = await u.app.inject({
    method: 'PUT',
    url: `/api/tours/${tourId}/track`,
    cookies: u.cookies,
    headers: { 'content-type': 'application/gpx+xml' },
    payload: gpx,
  })
  expect(antwort.statusCode).toBe(200)
}

const BEISPIEL_GPX = `<gpx xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>
  <trkpt lat="46.5934" lon="7.9086"><ele>800</ele><time>2026-07-04T08:00:00Z</time></trkpt>
  <trkpt lat="46.5900" lon="7.9105"><ele>830</ele><time>2026-07-04T08:10:00Z</time></trkpt>
  <trkpt lat="46.5872" lon="7.9142"><ele>905</ele><time>2026-07-04T08:30:00Z</time></trkpt>
</trkseg></trk></gpx>`

function gpxManifest(): UploadManifest {
  return {
    schema: 'luhambo/upload@1',
    clientTourId: 'gpx-e2e-1',
    title: null,
    time: { start: '2026-07-04T08:00:00Z', end: '2026-07-04T08:30:00Z', zone: 'UTC' },
    trackFile: 'track.gpx',
    trackMode: 'bike',
    media: [],
  }
}

describe('Auth', () => {
  it('weist Schreibzugriffe ohne Anmeldung ab', async () => {
    const u = await baueTestApp()
    const antwort = await u.app.inject({ method: 'POST', url: '/api/tours', payload: beispielManifest() })
    expect(antwort.statusCode).toBe(401)
  })

  it('lehnt falsche Zugangsdaten ab, ohne zu verraten warum', async () => {
    const u = await baueTestApp()
    const antwort = await u.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'test@example.com', passwort: 'falsch' },
    })
    expect(antwort.statusCode).toBe(401)
    expect(antwort.body).not.toContain('existiert')
  })

  it('authentifiziert per API-Token (App-Weg)', async () => {
    const u = await baueTestApp()
    const antwort = await u.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${u.apiToken}` },
    })
    expect(antwort.statusCode).toBe(200)
    expect((antwort.json() as { benutzer: { email: string } }).benutzer.email).toBe('test@example.com')
  })

  it('beendet Sessions beim Logout', async () => {
    const u = await baueTestApp()
    await u.app.inject({ method: 'POST', url: '/api/auth/logout', cookies: u.cookies })
    const antwort = await u.app.inject({ method: 'GET', url: '/api/auth/me', cookies: u.cookies })
    expect(antwort.statusCode).toBe(401)
  })
})

describe('Tour-Lebenszyklus', () => {
  it('durchläuft Anlegen → Upload → Finalize → Auslieferung', async () => {
    const u = await baueTestApp()
    const id = await legeTourAn(u)
    await ladeMediumHoch(u, id)
    await finalisiere(u, id)

    const antwort = await u.app.inject({ method: 'GET', url: `/api/tours/${id}` })
    expect(antwort.statusCode).toBe(200)
    const tour = antwort.json() as TourJson
    expect(tour.schema).toBe('luhambo/tour@1')
    expect(tour.brandTitle).toBe('Lauterbrunnen → Grindelwald')
    expect(tour.media[0]?.src).toBe(`/api/media/${id}/m1.jpg`)
  })

  it('reichert timeline und Auto-Wetter an (M2)', async () => {
    const wetter = new FesteWetterQuelle(
      testRaster('2026-07-04T06', Array.from({ length: 7 }, () => ({ code: 61, regenMm: 1, wolken: 95 }))),
    )
    const u = await baueTestApp(['Lauterbrunnen', 'Grindelwald'], wetter)
    const id = await legeTourAn(u)
    await ladeMediumHoch(u, id)
    await finalisiere(u, id)

    const tour = (await u.app.inject({ method: 'GET', url: `/api/tours/${id}` })).json() as TourJson
    expect(tour.timeline?.[0]).toEqual({ f: 0, t: '2026-07-04T06:12:31Z' })
    expect(tour.timeline?.length).toBeGreaterThanOrEqual(2)
    expect(tour.weather).toEqual([{ f: 0, mode: 'rain', k: 0.6, source: 'openmeteo' }])
  })

  it('bereitet Videos auf: Poster + Transcode landen im tour.json und werden ausgeliefert (M4)', async () => {
    const werkzeug = new FakeVideoWerkzeug({
      codecVideo: 'hevc', // neues iPhone/Pixel → muss transkodiert werden
      codecAudio: 'aac',
      dauerS: 9.2,
      breite: 3840,
      hoehe: 2160,
    })
    const u = await baueTestApp(['Lauterbrunnen', 'Grindelwald'], null, werkzeug)
    const manifest = beispielManifest()
    manifest.media.push({
      id: 'm2',
      type: 'video',
      file: 'VID_0007.mov',
      takenAt: '2026-07-04T10:15:00+02:00',
      anchor: [7.9142, 46.5872],
      caption: null,
    })
    const id = await legeTourAn(u, manifest)
    await ladeMediumHoch(u, id, 'm1')
    await ladeMediumHoch(u, id, 'm2', 'fake-hevc-bytes') // Original .mov
    await finalisiere(u, id)

    const tour = (await u.app.inject({ method: 'GET', url: `/api/tours/${id}` })).json() as TourJson
    const v = tour.media.find((m) => m.id === 'm2')
    expect(v?.type).toBe('video')
    expect(v?.src).toBe(`/api/media/${id}/m2.web.mp4`) // transkodiert, nicht das Original
    expect(v?.poster).toBe(`/api/media/${id}/m2.poster.jpg`)
    expect(v?.durationS).toBe(9.2)
    expect(werkzeug.aufrufe).toEqual(['probe', 'poster', 'transkodiere'])

    // Poster ausgeliefert (der erweiterte Dateiname-Regex lässt zwei Punkte durch)
    const poster = await u.app.inject({ method: 'GET', url: `/api/media/${id}/m2.poster.jpg` })
    expect(poster.statusCode).toBe(200)
    expect(poster.headers['content-type']).toBe('image/jpeg')

    // Transkodiertes Video mit Range-Support (Video-Seeking)
    const range = await u.app.inject({
      method: 'GET',
      url: `/api/media/${id}/m2.web.mp4`,
      headers: { range: 'bytes=0-3' },
    })
    expect(range.statusCode).toBe(206)
    expect(range.headers['content-type']).toBe('video/mp4')
  })

  it('nimmt ein GPX als trackFile an, parst es serverseitig und rendert die Tour (M6)', async () => {
    const u = await baueTestApp()
    const anlegen = await u.app.inject({ method: 'POST', url: '/api/tours', cookies: u.cookies, payload: gpxManifest() })
    expect(anlegen.statusCode).toBe(201)
    const id = (anlegen.json() as { id: string }).id
    await ladeTrackHoch(u, id, BEISPIEL_GPX)
    await finalisiere(u, id)

    const tour = (await u.app.inject({ method: 'GET', url: `/api/tours/${id}` })).json() as TourJson
    expect(tour.segments).toHaveLength(1)
    expect(tour.segments[0]?.mode).toBe('bike') // trackMode durchgereicht
    expect(tour.stats.km).toBeGreaterThan(0)
    expect(tour.timeline?.length).toBeGreaterThanOrEqual(2) // echte GPX-Zeiten → Timeline
  })

  it('verweigert Finalize, wenn das trackFile fehlt (M6)', async () => {
    const u = await baueTestApp()
    const id = (await u.app.inject({ method: 'POST', url: '/api/tours', cookies: u.cookies, payload: gpxManifest() })).json() as { id: string }
    const antwort = await u.app.inject({ method: 'POST', url: `/api/tours/${id.id}/finalize`, cookies: u.cookies })
    expect(antwort.statusCode).toBe(409)
    expect((antwort.json() as { fehlend: string[] }).fehlend).toEqual(['track.gpx'])
  })

  it('weist ein Manifest mit BEIDEN Track-Quellen ab (segments + trackFile)', async () => {
    const u = await baueTestApp()
    const kaputt = { ...gpxManifest(), segments: beispielManifest().segments }
    const antwort = await u.app.inject({ method: 'POST', url: '/api/tours', cookies: u.cookies, payload: kaputt })
    expect(antwort.statusCode).toBe(400)
  })

  it('weist ein Manifest OHNE Track-Quelle ab (weder segments noch trackFile)', async () => {
    const u = await baueTestApp()
    const { time, media } = beispielManifest()
    const ohne = { schema: 'luhambo/upload@1', clientTourId: 'ohne-track', title: null, time, media }
    const antwort = await u.app.inject({ method: 'POST', url: '/api/tours', cookies: u.cookies, payload: ohne })
    expect(antwort.statusCode).toBe(400)
  })

  it('verweigert Finalize bei fehlenden Medien', async () => {
    const u = await baueTestApp()
    const id = await legeTourAn(u)
    const antwort = await u.app.inject({ method: 'POST', url: `/api/tours/${id}/finalize`, cookies: u.cookies })
    expect(antwort.statusCode).toBe(409)
    expect((antwort.json() as { fehlend: string[] }).fehlend).toEqual(['m1'])
  })

  it('legt Touren mit gleicher clientTourId nur einmal an', async () => {
    const u = await baueTestApp()
    const id = await legeTourAn(u)
    const nochmal = await u.app.inject({ method: 'POST', url: '/api/tours', cookies: u.cookies, payload: beispielManifest() })
    expect(nochmal.statusCode).toBe(200)
    expect((nochmal.json() as { id: string; wiederverwendet: boolean }).id).toBe(id)
  })

  it('validiert das Manifest strikt', async () => {
    const u = await baueTestApp()
    const kaputt = { ...beispielManifest(), schema: 'luhambo/upload@99' }
    const antwort = await u.app.inject({ method: 'POST', url: '/api/tours', cookies: u.cookies, payload: kaputt })
    expect(antwort.statusCode).toBe(400)
  })

  it('weist Medien mit unzulässiger Endung schon beim Anlegen ab', async () => {
    const u = await baueTestApp()
    const manifest = beispielManifest()
    manifest.media[0]!.file = 'boese.exe'
    const antwort = await u.app.inject({ method: 'POST', url: '/api/tours', cookies: u.cookies, payload: manifest })
    expect(antwort.statusCode).toBe(400)
  })

  it('aktualisiert Titel per PATCH und rendert das Tour-JSON neu', async () => {
    const u = await baueTestApp()
    const id = await legeTourAn(u)
    await ladeMediumHoch(u, id)
    await finalisiere(u, id)

    const patch = await u.app.inject({
      method: 'PATCH',
      url: `/api/tours/${id}`,
      cookies: u.cookies,
      payload: { title: 'Alpenglühen am Morgen' },
    })
    expect(patch.statusCode).toBe(200)
    const tour = (await u.app.inject({ method: 'GET', url: `/api/tours/${id}` })).json() as TourJson
    expect(tour.brandTitle).toBe('Alpenglühen am Morgen')
  })

  it('listet nur eigene Touren', async () => {
    const u = await baueTestApp()
    await legeTourAn(u)
    const liste = await u.app.inject({ method: 'GET', url: '/api/tours', cookies: u.cookies })
    expect((liste.json() as { tours: unknown[] }).tours).toHaveLength(1)
  })

  it('liefert anonym eine leere Liste (kein 401-Konsole-Rauschen im Player)', async () => {
    const u = await baueTestApp()
    await legeTourAn(u)
    const anonym = await u.app.inject({ method: 'GET', url: '/api/tours' })
    expect(anonym.statusCode).toBe(200)
    expect((anonym.json() as { tours: unknown[] }).tours).toHaveLength(0)
  })

  it('weist die Liste bei UNGÜLTIGEM Token weiterhin mit 401 ab', async () => {
    const u = await baueTestApp()
    const antwort = await u.app.inject({
      method: 'GET',
      url: '/api/tours',
      headers: { authorization: 'Bearer lhb_kaputtes-token' },
    })
    expect(antwort.statusCode).toBe(401)
  })

  it('löscht Tour samt Dateien', async () => {
    const u = await baueTestApp()
    const id = await legeTourAn(u)
    await ladeMediumHoch(u, id)
    const del = await u.app.inject({ method: 'DELETE', url: `/api/tours/${id}`, cookies: u.cookies })
    expect(del.statusCode).toBe(200)
    const weg = await u.app.inject({ method: 'GET', url: `/api/tours/${id}` })
    expect(weg.statusCode).toBe(404)
    expect(await u.storage.info(id, 'media/m1.jpg')).toBeNull()
  })
})

describe('Sichtbarkeit', () => {
  it('unlisted: jeder mit Link sieht Tour und Medien', async () => {
    const u = await baueTestApp()
    const id = await legeTourAn(u)
    await ladeMediumHoch(u, id)
    await finalisiere(u, id)
    expect((await u.app.inject({ method: 'GET', url: `/api/tours/${id}` })).statusCode).toBe(200)
    expect((await u.app.inject({ method: 'GET', url: `/api/media/${id}/m1.jpg` })).statusCode).toBe(200)
  })

  it('private: nur der Owner sieht Tour und Medien (anonym = 404)', async () => {
    const u = await baueTestApp()
    const id = await legeTourAn(u)
    await ladeMediumHoch(u, id)
    await finalisiere(u, id)
    await u.app.inject({ method: 'PATCH', url: `/api/tours/${id}`, cookies: u.cookies, payload: { visibility: 'private' } })

    expect((await u.app.inject({ method: 'GET', url: `/api/tours/${id}` })).statusCode).toBe(404)
    expect((await u.app.inject({ method: 'GET', url: `/api/media/${id}/m1.jpg` })).statusCode).toBe(404)
    expect((await u.app.inject({ method: 'GET', url: `/api/tours/${id}`, cookies: u.cookies })).statusCode).toBe(200)
  })

  it('fremde Benutzer können fremde Touren nicht ändern oder löschen', async () => {
    const u = await baueTestApp()
    const id = await legeTourAn(u)
    await u.app.auth.legeBenutzerAn('andere@example.com', 'geheim456', 'Andere')
    const login = await u.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'andere@example.com', passwort: 'geheim456' },
    })
    const fremdeCookies = { luhambo_session: login.cookies.find((c) => c.name === 'luhambo_session')?.value ?? '' }

    expect(
      (await u.app.inject({ method: 'PATCH', url: `/api/tours/${id}`, cookies: fremdeCookies, payload: { title: 'Gekapert' } }))
        .statusCode,
    ).toBe(404)
    expect((await u.app.inject({ method: 'DELETE', url: `/api/tours/${id}`, cookies: fremdeCookies })).statusCode).toBe(404)
  })
})

describe('Review-Fixes (Races, Header, Limits)', () => {
  it('startet die Verarbeitung bei parallelem finalize nur einmal', async () => {
    const u = await baueTestApp()
    const id = await legeTourAn(u)
    await ladeMediumHoch(u, id)
    const [a, b] = await Promise.all([
      u.app.inject({ method: 'POST', url: `/api/tours/${id}/finalize`, cookies: u.cookies }),
      u.app.inject({ method: 'POST', url: `/api/tours/${id}/finalize`, cookies: u.cookies }),
    ])
    expect([a.statusCode, b.statusCode].sort()).toEqual([202, 409])
    await u.app.verarbeitungen.get(id)
  })

  it('vergibt Tour-Nummern PRO Benutzer (kein Cross-Tenant-Leck)', async () => {
    const u = await baueTestApp(['A', 'B', 'A', 'B'])
    await legeTourAn(u)
    await u.app.auth.legeBenutzerAn('zweite@example.com', 'geheim456', 'Zweite')
    const login = await u.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'zweite@example.com', passwort: 'geheim456' },
    })
    const cookies2 = { luhambo_session: login.cookies.find((c) => c.name === 'luhambo_session')?.value ?? '' }
    const manifest = beispielManifest()
    delete manifest.clientTourId
    const antwort = await u.app.inject({ method: 'POST', url: '/api/tours', cookies: cookies2, payload: manifest })
    const id2 = (antwort.json() as { id: string }).id
    const liste = await u.app.inject({ method: 'GET', url: '/api/tours', cookies: cookies2 })
    const eintrag = (liste.json() as { tours: Array<{ id: string; no: string }> }).tours.find((t) => t.id === id2)
    expect(eintrag?.no).toBe('N°01') // beginnt bei 1, sieht die fremde Tour nicht
  })

  it('verweigert Medien-PUT nach dem Rendern (immutable)', async () => {
    const u = await baueTestApp()
    const id = await legeTourAn(u)
    await ladeMediumHoch(u, id)
    await finalisiere(u, id)
    const antwort = await u.app.inject({
      method: 'PUT',
      url: `/api/tours/${id}/media/m1`,
      cookies: u.cookies,
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.from('neu'),
    })
    expect(antwort.statusCode).toBe(409)
  })

  it('zeigt Pipeline-Fehlertexte nur dem Owner', async () => {
    const u = await baueTestApp()
    const id = await legeTourAn(u)
    u.app.deps.db
      .prepare(`UPDATE tours SET status = 'fehler', fehler = 'interner Stacktrace' WHERE id = ?`)
      .run(id)
    const anonym = (await u.app.inject({ method: 'GET', url: `/api/tours/${id}` })).json() as { fehler?: string }
    expect(anonym.fehler).toBeUndefined()
    const owner = (await u.app.inject({ method: 'GET', url: `/api/tours/${id}`, cookies: u.cookies })).json() as { fehler?: string }
    expect(owner.fehler).toBe('interner Stacktrace')
  })

  it('cached private Medien nie public', async () => {
    const u = await baueTestApp()
    const id = await legeTourAn(u)
    await ladeMediumHoch(u, id)
    await finalisiere(u, id)
    await u.app.inject({ method: 'PATCH', url: `/api/tours/${id}`, cookies: u.cookies, payload: { visibility: 'private' } })
    const antwort = await u.app.inject({ method: 'GET', url: `/api/media/${id}/m1.jpg`, cookies: u.cookies })
    expect(antwort.headers['cache-control']).toContain('private')
    expect(antwort.headers['cache-control']).not.toContain('public')
  })

  it('bremst Login-Fluten mit 429', async () => {
    const u = await baueTestApp()
    let letzter = 0
    for (let i = 0; i < 12; i++) {
      const antwort = await u.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: `flut-${Math.random()}@example.com`, passwort: 'falsch' },
        remoteAddress: '203.0.113.7',
      })
      letzter = antwort.statusCode
    }
    expect(letzter).toBe(429)
  })
})

describe('Medien-Auslieferung', () => {
  it('bedient Range-Requests mit 206 und korrektem Ausschnitt', async () => {
    const u = await baueTestApp()
    const id = await legeTourAn(u)
    await ladeMediumHoch(u, id, 'm1', '0123456789')
    await finalisiere(u, id)

    const antwort = await u.app.inject({
      method: 'GET',
      url: `/api/media/${id}/m1.jpg`,
      headers: { range: 'bytes=2-5' },
    })
    expect(antwort.statusCode).toBe(206)
    expect(antwort.headers['content-range']).toBe(`bytes 2-5/10`)
    expect(antwort.body).toBe('2345')
  })

  it('weist unerfüllbare Ranges mit 416 ab', async () => {
    const u = await baueTestApp()
    const id = await legeTourAn(u)
    await ladeMediumHoch(u, id, 'm1', '0123456789')
    const antwort = await u.app.inject({
      method: 'GET',
      url: `/api/media/${id}/m1.jpg`,
      headers: { range: 'bytes=99-' },
    })
    expect(antwort.statusCode).toBe(416)
  })

  it('ignoriert unverstandene Range-Syntax (Multi-Range) und antwortet voll (RFC 9110)', async () => {
    const u = await baueTestApp()
    const id = await legeTourAn(u)
    await ladeMediumHoch(u, id, 'm1', '0123456789')
    const antwort = await u.app.inject({
      method: 'GET',
      url: `/api/media/${id}/m1.jpg`,
      headers: { range: 'bytes=0-2,5-7' },
    })
    expect(antwort.statusCode).toBe(200)
    expect(antwort.body).toBe('0123456789')
  })

  it('lehnt Uploads über dem Größenlimit ab (413)', async () => {
    const u = await baueTestApp()
    const id = await legeTourAn(u)
    const antwort = await u.app.inject({
      method: 'PUT',
      url: `/api/tours/${id}/media/m1`,
      cookies: u.cookies,
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.alloc(2 * 1024 * 1024), // TEST_KONFIG-Limit: 1 MiB
    })
    expect(antwort.statusCode).toBe(413)
  })
})
