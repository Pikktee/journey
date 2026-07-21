// Integrationstests über die HTTP-Schnittstelle (fastify.inject): kompletter
// Lebenszyklus Upload → Finalize → Auslieferung, plus Auth-, Sichtbarkeits-
// und Range-Verhalten.

import { describe, expect, it } from 'vitest'
import type { TourJson } from '../src/pipeline/enrich.js'
import { FakeVideoWerkzeug } from '../src/pipeline/video.js'
import { FesterKlassifikator } from '../src/pipeline/vision.js'
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

  it('beendet Sessions beim Logout (me() antwortet danach mit benutzer null)', async () => {
    const u = await baueTestApp()
    await u.app.inject({ method: 'POST', url: '/api/auth/logout', cookies: u.cookies })
    const antwort = await u.app.inject({ method: 'GET', url: '/api/auth/me', cookies: u.cookies })
    expect(antwort.statusCode).toBe(200)
    expect((antwort.json() as { benutzer: unknown }).benutzer).toBeNull()
    // Schreibzugriffe bleiben nach dem Logout gesperrt
    const schreiben = await u.app.inject({ method: 'POST', url: '/api/tours', cookies: u.cookies, payload: beispielManifest() })
    expect(schreiben.statusCode).toBe(401)
  })

  it('me() ohne Anmeldung: 200 mit benutzer null statt 401 (kein Konsole-Rauschen)', async () => {
    const u = await baueTestApp()
    const antwort = await u.app.inject({ method: 'GET', url: '/api/auth/me' })
    expect(antwort.statusCode).toBe(200)
    expect((antwort.json() as { benutzer: unknown }).benutzer).toBeNull()
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

  it('verfeinert das Auto-Wetter per Bildanalyse, wenn ein Klassifikator konfiguriert ist (M5)', async () => {
    const wetter = new FesteWetterQuelle(
      testRaster('2026-07-04T06', Array.from({ length: 7 }, () => ({ wolken: 80 }))), // bewölkt
    )
    const klass = new FesterKlassifikator({ himmel: 'bedeckt', niederschlag: 'gewitter', himmelSichtbar: true, konfidenz: 0.9 })
    const u = await baueTestApp(['Lauterbrunnen', 'Grindelwald'], wetter, null, {}, klass)
    const id = await legeTourAn(u)
    await ladeMediumHoch(u, id) // m1 (Foto)
    await finalisiere(u, id)

    const tour = (await u.app.inject({ method: 'GET', url: `/api/tours/${id}` })).json() as TourJson
    expect(tour.weather?.some((w) => w.source === 'photo' && w.mode === 'storm')).toBe(true)
    expect(klass.aufrufe).toHaveLength(1) // genau das eine Foto klassifiziert
    expect(klass.aufrufe[0]?.medientyp).toBe('image/jpeg')
  })

  it('lässt das Wetter ohne konfigurierten Klassifikator unberührt (M5 No-Op)', async () => {
    const wetter = new FesteWetterQuelle(
      testRaster('2026-07-04T06', Array.from({ length: 7 }, () => ({ wolken: 80 }))),
    )
    const u = await baueTestApp(['Lauterbrunnen', 'Grindelwald'], wetter) // kein Klassifikator
    const id = await legeTourAn(u)
    await ladeMediumHoch(u, id)
    await finalisiere(u, id)

    const tour = (await u.app.inject({ method: 'GET', url: `/api/tours/${id}` })).json() as TourJson
    expect(tour.weather).toEqual([{ f: 0, mode: 'clouds', k: 0.84, source: 'openmeteo' }])
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

describe('Titelbild', () => {
  it('die Liste liefert nach dem Rendern ein Titelbild', async () => {
    const u = await baueTestApp()
    const id = await legeTourAn(u)
    await ladeMediumHoch(u, id)

    // Vor dem Rendern gibt es noch keins
    const vorher = await u.app.inject({ method: 'GET', url: '/api/tours', cookies: u.cookies })
    expect((vorher.json() as { tours: Array<{ cover: string | null }> }).tours[0]?.cover).toBeNull()

    await finalisiere(u, id)
    const nachher = await u.app.inject({ method: 'GET', url: '/api/tours', cookies: u.cookies })
    expect((nachher.json() as { tours: Array<{ cover: string | null }> }).tours[0]?.cover).toBe(
      `/api/media/${id}/m1.jpg`,
    )
  })

  it('titelbild im Overlay bestimmt das Bild der Liste', async () => {
    const u = await baueTestApp()
    const manifest = beispielManifest()
    manifest.media.push({
      id: 'm2',
      type: 'photo',
      file: 'IMG_0013.JPG',
      takenAt: '2026-07-04T09:30:00+02:00',
      anchor: [7.9142, 46.5872],
      caption: null,
    })
    const id = await legeTourAn(u, manifest)
    await ladeMediumHoch(u, id, 'm1')
    await ladeMediumHoch(u, id, 'm2')
    await finalisiere(u, id)

    const put = await u.app.inject({
      method: 'PUT',
      url: `/api/tours/${id}/edits`,
      cookies: u.cookies,
      payload: { schema: 'luhambo/edits@1', titelbild: 'm2' },
    })
    expect(put.statusCode).toBe(202)
    await u.app.verarbeitungen.get(id)

    const liste = await u.app.inject({ method: 'GET', url: '/api/tours', cookies: u.cookies })
    expect((liste.json() as { tours: Array<{ cover: string | null }> }).tours[0]?.cover).toBe(`/api/media/${id}/m2.jpg`)
  })
})

describe('Session aus API-Token (App-Player)', () => {
  it('tauscht das Token gegen eine Sitzung, die private Touren sehen darf', async () => {
    const u = await baueTestApp()
    const id = await legeTourAn(u)
    await ladeMediumHoch(u, id)
    await finalisiere(u, id)
    await u.app.inject({
      method: 'PATCH',
      url: `/api/tours/${id}`,
      cookies: u.cookies,
      payload: { visibility: 'private' },
    })
    // Ohne Sitzung ist die Tour für den WebView unsichtbar
    expect((await u.app.inject({ method: 'GET', url: `/api/tours/${id}` })).statusCode).toBe(404)

    const tausch = await u.app.inject({
      method: 'POST',
      url: '/api/auth/session-aus-token',
      headers: { authorization: `Bearer ${u.apiToken}` },
    })
    expect(tausch.statusCode).toBe(200)
    const { sessionId } = tausch.json() as { sessionId: string; ablauf: string }

    const mitSitzung = await u.app.inject({
      method: 'GET',
      url: `/api/tours/${id}`,
      cookies: { luhambo_session: sessionId },
    })
    expect(mitSitzung.statusCode).toBe(200)
  })

  it('ohne Anmeldung gibt es keine Sitzung', async () => {
    const u = await baueTestApp()
    expect((await u.app.inject({ method: 'POST', url: '/api/auth/session-aus-token' })).statusCode).toBe(401)
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

describe('Edit-Overlay + Editor (M7)', () => {
  async function fremdeCookies(u: TestUmgebung): Promise<{ luhambo_session: string }> {
    await u.app.auth.legeBenutzerAn('fremd@example.com', 'geheim456', 'Fremd')
    const login = await u.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'fremd@example.com', passwort: 'geheim456' },
    })
    return { luhambo_session: login.cookies.find((c) => c.name === 'luhambo_session')?.value ?? '' }
  }

  it('liefert ein leeres Overlay, solange keins gespeichert ist', async () => {
    const u = await baueTestApp()
    const id = await legeTourAn(u)
    const antwort = await u.app.inject({ method: 'GET', url: `/api/tours/${id}/edits`, cookies: u.cookies })
    expect(antwort.statusCode).toBe(200)
    expect(antwort.json()).toEqual({ schema: 'luhambo/edits@1' })
  })

  it('PUT speichert, rendert neu — Caption, Modus-Grenze, Trim und manueller Anker erreichen das Tour-JSON', async () => {
    const u = await baueTestApp()
    const id = await legeTourAn(u)
    await ladeMediumHoch(u, id)
    await finalisiere(u, id)
    const vorher = (await u.app.inject({ method: 'GET', url: `/api/tours/${id}` })).json() as TourJson

    const put = await u.app.inject({
      method: 'PUT',
      url: `/api/tours/${id}/edits`,
      cookies: u.cookies,
      payload: {
        schema: 'luhambo/edits@1',
        medien: { m1: { caption: 'Handgeschrieben', anchor: [7.9184, 46.5891] } },
        // tOffset 1400 (Segmentwechsel walk→bike) — ab hier Fähre
        modi: [{ ab: '2026-07-04T08:35:51+02:00', mode: 'ferry' }],
        // tOffset 620: erster Walk-Punkt fällt weg
        trim: { start: '2026-07-04T08:22:51+02:00' },
      },
    })
    expect(put.statusCode).toBe(202)
    await u.app.verarbeitungen.get(id)

    const tour = (await u.app.inject({ method: 'GET', url: `/api/tours/${id}` })).json() as TourJson
    expect(tour.status).toBe('bereit')
    expect(tour.media[0]?.title).toBe('Handgeschrieben')
    expect(tour.media[0]?.placement).toBe('manuell')
    expect(tour.media[0]?.anchor).toEqual([7.9184, 46.5891])
    expect(tour.segments.map((s) => s.mode)).toEqual(['walk', 'ferry'])
    expect(tour.stats.km).toBeLessThan(vorher.stats.km)

    // Overlay ist wieder abrufbar (Editor lädt den gespeicherten Stand)
    const edits = (await u.app.inject({ method: 'GET', url: `/api/tours/${id}/edits`, cookies: u.cookies })).json() as {
      medien: Record<string, { caption?: string }>
    }
    expect(edits.medien['m1']?.caption).toBe('Handgeschrieben')
  })

  it('Reprocess rendert neu, ohne Edits zu verlieren (Plan-Kriterium)', async () => {
    const u = await baueTestApp()
    const id = await legeTourAn(u)
    await ladeMediumHoch(u, id)
    await finalisiere(u, id)
    await u.app.inject({
      method: 'PUT',
      url: `/api/tours/${id}/edits`,
      cookies: u.cookies,
      payload: { schema: 'luhambo/edits@1', medien: { m1: { caption: 'Bleibt' } } },
    })
    await u.app.verarbeitungen.get(id)

    const antwort = await u.app.inject({ method: 'POST', url: `/api/tours/${id}/reprocess`, cookies: u.cookies })
    expect(antwort.statusCode).toBe(202)
    await u.app.verarbeitungen.get(id)

    const tour = (await u.app.inject({ method: 'GET', url: `/api/tours/${id}` })).json() as TourJson
    expect(tour.status).toBe('bereit')
    expect(tour.media[0]?.title).toBe('Bleibt')
  })

  it('weist kaputte Overlays ab (Form + Semantik)', async () => {
    const u = await baueTestApp()
    const id = await legeTourAn(u)
    // Hinweis: UNBEKANNTE Felder strippt Fastifys Ajv (removeAdditional) —
    // den 400 gibt es für falsch getypte bekannte Felder.
    const form = await u.app.inject({
      method: 'PUT',
      url: `/api/tours/${id}/edits`,
      cookies: u.cookies,
      payload: { schema: 'luhambo/edits@1', modi: 'quatsch' },
    })
    expect(form.statusCode).toBe(400)
    const semantik = await u.app.inject({
      method: 'PUT',
      url: `/api/tours/${id}/edits`,
      cookies: u.cookies,
      payload: {
        schema: 'luhambo/edits@1',
        trim: { start: '2026-07-04T10:00:00Z', ende: '2026-07-04T09:00:00Z' },
      },
    })
    expect(semantik.statusCode).toBe(400)
    expect(semantik.json()).toMatchObject({ fehler: expect.stringContaining('Trim-Start') })
  })

  it('Bibliotheks-Audio übersteht den PUT und landet als /audio/sfx-URL', async () => {
    // Absicherung gegen die Ajv-Strip-Falle: fehlte `quelle` im Schema, würde
    // Fastifys removeAdditional es still entfernen → der Effekt gälte als
    // tour-lokal, würde gegen media/ geprüft und als fehlend verworfen.
    const u = await baueTestApp()
    const id = await legeTourAn(u)
    await ladeMediumHoch(u, id)
    await finalisiere(u, id)
    const put = await u.app.inject({
      method: 'PUT',
      url: `/api/tours/${id}/edits`,
      cookies: u.cookies,
      payload: {
        schema: 'luhambo/edits@1',
        audio: [{ datei: 'amb-hafen.mp3', typ: 'musik', ab: '2026-07-04T08:20:00Z', quelle: 'bibliothek' }],
      },
    })
    expect(put.statusCode).toBe(202)
    await u.app.verarbeitungen.get(id)
    const tour = (await u.app.inject({ method: 'GET', url: `/api/tours/${id}` })).json() as TourJson
    expect(tour.audio?.[0]?.src).toBe('/audio/sfx/amb-hafen.mp3')

    // Ungültige Quelle wird abgelehnt (enum)
    const boese = await u.app.inject({
      method: 'PUT',
      url: `/api/tours/${id}/edits`,
      cookies: u.cookies,
      payload: {
        schema: 'luhambo/edits@1',
        audio: [{ datei: 'amb-hafen.mp3', typ: 'musik', ab: '2026-07-04T08:20:00Z', quelle: 'boese' }],
      },
    })
    expect(boese.statusCode).toBe(400)
  })

  it('Reprocess braucht eine finalisierte Tour', async () => {
    const u = await baueTestApp()
    const id = await legeTourAn(u)
    const antwort = await u.app.inject({ method: 'POST', url: `/api/tours/${id}/reprocess`, cookies: u.cookies })
    expect(antwort.statusCode).toBe(409)
  })

  it('Editor-Daten: Original-Track mit Zeiten, Auto-Platzierung, Overlay', async () => {
    const u = await baueTestApp()
    const id = await legeTourAn(u)
    await ladeMediumHoch(u, id)
    await finalisiere(u, id)

    const antwort = await u.app.inject({ method: 'GET', url: `/api/tours/${id}/editor`, cookies: u.cookies })
    expect(antwort.statusCode).toBe(200)
    const daten = antwort.json() as {
      segmente: Array<{ mode: string; pts: number[][] }>
      medien: Array<{ id: string; placement: string; src: string; gpsAnker?: [number, number] }>
      audio: unknown[]
      edits: { schema: string }
      time: { start: string }
    }
    expect(daten.segmente.map((s) => s.mode)).toEqual(['walk', 'bike'])
    // Trackpunkte behalten den Zeit-Offset (4. Koordinate) — Trim/Grenzen brauchen ihn
    expect(daten.segmente[0]?.pts[0]).toHaveLength(4)
    expect(daten.medien[0]).toMatchObject({ id: 'm1', placement: 'gps', src: `/api/media/${id}/m1.jpg` })
    // Roher Manifest-Anker als gpsAnker (Baukasten: „GPS-Ort verwenden")
    expect(daten.medien[0]?.gpsAnker).toEqual([7.9105, 46.59])
    // Ohne hochgeladene Audio-Dateien ist die Liste leer (Fotos zählen nicht)
    expect(daten.audio).toEqual([])
    expect(daten.edits.schema).toBe('luhambo/edits@1')
  })

  it('Editor-Daten lassen gpsAnker weg, wenn das Manifest keinen Anker trägt', async () => {
    const u = await baueTestApp()
    const manifest = beispielManifest()
    manifest.media.push({ id: 'm2', type: 'photo', file: 'x.jpg', takenAt: '2026-07-04T10:00:00+02:00' })
    const id = await legeTourAn(u, manifest)
    const antwort = await u.app.inject({ method: 'GET', url: `/api/tours/${id}/editor`, cookies: u.cookies })
    const daten = antwort.json() as { medien: Array<{ id: string }> }
    const m2 = daten.medien.find((m) => m.id === 'm2')
    expect(m2).toBeDefined()
    expect(m2 && 'gpsAnker' in m2).toBe(false)
  })

  it('Editor-Daten funktionieren auch für GPX-Quellen', async () => {
    const u = await baueTestApp()
    const id = await legeTourAn(u, gpxManifest())
    await ladeTrackHoch(u, id, BEISPIEL_GPX)
    const antwort = await u.app.inject({ method: 'GET', url: `/api/tours/${id}/editor`, cookies: u.cookies })
    expect(antwort.statusCode).toBe(200)
    const daten = antwort.json() as { segmente: Array<{ mode: string; pts: number[][] }> }
    expect(daten.segmente).toHaveLength(1)
    expect(daten.segmente[0]?.mode).toBe('bike')
    expect(daten.segmente[0]?.pts).toHaveLength(3)
  })

  it('Beschreibung leeren erreicht das Tour-JSON (Review-Fund)', async () => {
    const u = await baueTestApp()
    const id = await legeTourAn(u)
    await ladeMediumHoch(u, id)
    await finalisiere(u, id)
    await u.app.inject({ method: 'PATCH', url: `/api/tours/${id}`, cookies: u.cookies, payload: { description: 'Erst was' } })
    await u.app.verarbeitungen.get(id)
    await u.app.inject({ method: 'PATCH', url: `/api/tours/${id}`, cookies: u.cookies, payload: { description: '' } })
    await u.app.verarbeitungen.get(id)
    const tour = (await u.app.inject({ method: 'GET', url: `/api/tours/${id}` })).json() as TourJson
    expect(tour.description).toBe('')
  })

  it('Editor-Daten melden kaputtes GPX als 409 mit Ursache statt 500 (Review-Fund)', async () => {
    const u = await baueTestApp()
    const id = await legeTourAn(u, gpxManifest())
    await ladeTrackHoch(u, id, '<gpx><trkpt lat="1" lon="2"><time>2026-07-04T08:00:00Z</time></trkpt></gpx>')
    const antwort = await u.app.inject({ method: 'GET', url: `/api/tours/${id}/editor`, cookies: u.cookies })
    expect(antwort.statusCode).toBe(409)
    expect(antwort.json()).toMatchObject({ fehler: expect.stringContaining('Track nicht lesbar') })
  })

  it('weist Zeitstempel mit Anhängsel ab — Pattern voll verankert (Review-Fund)', async () => {
    const u = await baueTestApp()
    const boese = beispielManifest()
    boese.media[0]!.takenAt = '2026-07-04T09:01:12+02:00<img src=x onerror=alert(1)>'
    expect((await u.app.inject({ method: 'POST', url: '/api/tours', cookies: u.cookies, payload: boese })).statusCode).toBe(400)
    const id = await legeTourAn(u)
    const edits = await u.app.inject({
      method: 'PUT',
      url: `/api/tours/${id}/edits`,
      cookies: u.cookies,
      payload: { schema: 'luhambo/edits@1', modi: [{ ab: '2026-07-04T09:00:00Z<b>x</b>', mode: 'walk' }] },
    })
    expect(edits.statusCode).toBe(400)
  })

  it('fremde Benutzer sehen weder Edits noch Editor-Daten (404)', async () => {
    const u = await baueTestApp()
    const id = await legeTourAn(u)
    const fremd = await fremdeCookies(u)
    expect((await u.app.inject({ method: 'GET', url: `/api/tours/${id}/edits`, cookies: fremd })).statusCode).toBe(404)
    expect((await u.app.inject({ method: 'GET', url: `/api/tours/${id}/editor`, cookies: fremd })).statusCode).toBe(404)
    expect(
      (
        await u.app.inject({
          method: 'PUT',
          url: `/api/tours/${id}/edits`,
          cookies: fremd,
          payload: { schema: 'luhambo/edits@1' },
        })
      ).statusCode,
    ).toBe(404)
    expect((await u.app.inject({ method: 'POST', url: `/api/tours/${id}/reprocess`, cookies: fremd })).statusCode).toBe(404)
  })
})
