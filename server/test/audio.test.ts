// Audio-Assets (Baukasten): Upload/Löschen eigener Musik/SFX-Dateien,
// Auslieferung über die bestehende Medien-Route (Content-Type + Range) und
// der HTTP-Durchstich PUT /edits → Re-Render → camera/audio/display im tour.json.

import { describe, expect, it } from 'vitest'
import type { TourJson } from '../src/pipeline/enrich.js'
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

function ladeAudioHoch(u: TestUmgebung, tourId: string, datei = 'a1.mp3', inhalt: string | Buffer = 'fake-mp3-bytes') {
  return u.app.inject({
    method: 'PUT',
    url: `/api/tours/${tourId}/audio/${datei}`,
    cookies: u.cookies,
    headers: { 'content-type': 'application/octet-stream' },
    payload: Buffer.from(inhalt as string),
  })
}

async function fremdeCookies(u: TestUmgebung): Promise<{ luhambo_session: string }> {
  await u.app.auth.legeBenutzerAn('fremd@example.com', 'geheim456', 'Fremd')
  const login = await u.app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'fremd@example.com', passwort: 'geheim456' },
  })
  return { luhambo_session: login.cookies.find((c) => c.name === 'luhambo_session')?.value ?? '' }
}

describe('Audio-Upload (PUT /api/tours/:id/audio/:datei)', () => {
  it('lädt hoch und liefert mit Audio-Content-Type und Range aus', async () => {
    const u = await baueTestApp()
    const id = await legeTourAn(u)
    const put = await ladeAudioHoch(u, id, 'a1.mp3', '0123456789')
    expect(put.statusCode).toBe(200)
    expect(put.json()).toEqual({ datei: 'a1.mp3', bytes: 10 })

    const voll = await u.app.inject({ method: 'GET', url: `/api/media/${id}/a1.mp3` })
    expect(voll.statusCode).toBe(200)
    expect(voll.headers['content-type']).toBe('audio/mpeg')
    expect(voll.headers['accept-ranges']).toBe('bytes')
    expect(voll.body).toBe('0123456789')

    const range = await u.app.inject({
      method: 'GET',
      url: `/api/media/${id}/a1.mp3`,
      headers: { range: 'bytes=2-5' },
    })
    expect(range.statusCode).toBe(206)
    expect(range.headers['content-range']).toBe('bytes 2-5/10')
    expect(range.body).toBe('2345')
  })

  it('kennt die Content-Types aller Audio-Endungen', async () => {
    const u = await baueTestApp()
    const id = await legeTourAn(u)
    const erwartet: Record<string, string> = { m4a: 'audio/mp4', ogg: 'audio/ogg', wav: 'audio/wav' }
    for (const [endung, typ] of Object.entries(erwartet)) {
      expect((await ladeAudioHoch(u, id, `klang.${endung}`)).statusCode).toBe(200)
      const antwort = await u.app.inject({ method: 'GET', url: `/api/media/${id}/klang.${endung}` })
      expect(antwort.headers['content-type']).toBe(typ)
    }
  })

  it('erlaubt Audio auch bei Status „bereit" (der Editor rüstet nach)', async () => {
    const u = await baueTestApp()
    const id = await legeTourAn(u)
    await ladeMediumHoch(u, id)
    await finalisiere(u, id)
    expect((await ladeAudioHoch(u, id)).statusCode).toBe(200)
  })

  it('verweigert Überschreiben (immutable-Cache) mit 409', async () => {
    const u = await baueTestApp()
    const id = await legeTourAn(u)
    expect((await ladeAudioHoch(u, id)).statusCode).toBe(200)
    const nochmal = await ladeAudioHoch(u, id, 'a1.mp3', 'neue-bytes')
    expect(nochmal.statusCode).toBe(409)
    expect((nochmal.json() as { fehler: string }).fehler).toContain('existiert bereits')
  })

  it('verweigert Upload und Löschen während laufender Verarbeitung (409)', async () => {
    const u = await baueTestApp()
    const id = await legeTourAn(u)
    await ladeAudioHoch(u, id, 'alt.mp3')
    u.app.deps.db.prepare(`UPDATE tours SET status = 'verarbeitung' WHERE id = ?`).run(id)
    expect((await ladeAudioHoch(u, id, 'neu.mp3')).statusCode).toBe(409)
    const del = await u.app.inject({ method: 'DELETE', url: `/api/tours/${id}/audio/alt.mp3`, cookies: u.cookies })
    expect(del.statusCode).toBe(409)
  })

  it('behandelt fremde Touren als nicht existent (404, nie 403)', async () => {
    const u = await baueTestApp()
    const id = await legeTourAn(u)
    await ladeAudioHoch(u, id)
    const fremd = await fremdeCookies(u)
    const put = await u.app.inject({
      method: 'PUT',
      url: `/api/tours/${id}/audio/x.mp3`,
      cookies: fremd,
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.from('x'),
    })
    expect(put.statusCode).toBe(404)
    const del = await u.app.inject({ method: 'DELETE', url: `/api/tours/${id}/audio/a1.mp3`, cookies: fremd })
    expect(del.statusCode).toBe(404)
  })

  it('lehnt Uploads über dem Audio-Limit ab (413)', async () => {
    const u = await baueTestApp()
    const id = await legeTourAn(u)
    const antwort = await ladeAudioHoch(u, id, 'gross.mp3', Buffer.alloc(2 * 1024 * 1024)) // TEST_KONFIG-Limit: 1 MiB
    expect(antwort.statusCode).toBe(413)
    // Kein halber Upload liegen geblieben
    expect(await u.storage.info(id, 'media/gross.mp3')).toBeNull()
  })

  it('lehnt unzulässige Dateinamen am Params-Schema ab (400)', async () => {
    const u = await baueTestApp()
    const id = await legeTourAn(u)
    for (const datei of ['boese.exe', 'x.MP3', 'ohne-endung']) {
      expect((await ladeAudioHoch(u, id, datei)).statusCode).toBe(400)
    }
  })
})

describe('Audio-Löschen (DELETE /api/tours/:id/audio/:datei)', () => {
  it('löscht die Datei; danach 404 bei GET und erneutem DELETE', async () => {
    const u = await baueTestApp()
    const id = await legeTourAn(u)
    await ladeAudioHoch(u, id)
    const del = await u.app.inject({ method: 'DELETE', url: `/api/tours/${id}/audio/a1.mp3`, cookies: u.cookies })
    expect(del.statusCode).toBe(200)
    expect((await u.app.inject({ method: 'GET', url: `/api/media/${id}/a1.mp3` })).statusCode).toBe(404)
    const nochmal = await u.app.inject({ method: 'DELETE', url: `/api/tours/${id}/audio/a1.mp3`, cookies: u.cookies })
    expect(nochmal.statusCode).toBe(404)
  })

  it('verweigert das Löschen einer von den gespeicherten Edits genutzten Datei (409)', async () => {
    const u = await baueTestApp()
    const id = await legeTourAn(u)
    await ladeMediumHoch(u, id)
    await ladeAudioHoch(u, id, 'a1.mp3')
    await finalisiere(u, id)
    // Overlay speichern, das a1.mp3 referenziert
    const put = await u.app.inject({
      method: 'PUT',
      url: `/api/tours/${id}/edits`,
      cookies: u.cookies,
      payload: { schema: 'luhambo/edits@1', audio: [{ datei: 'a1.mp3', typ: 'musik', ab: '2026-07-04T08:12:31+02:00' }] },
    })
    expect(put.statusCode).toBe(202)
    await u.app.verarbeitungen.get(id)
    // DELETE muss abgelehnt werden — sonst zeigte das gerenderte tour.json auf 404
    const del = await u.app.inject({ method: 'DELETE', url: `/api/tours/${id}/audio/a1.mp3`, cookies: u.cookies })
    expect(del.statusCode).toBe(409)
    expect((await u.app.inject({ method: 'GET', url: `/api/media/${id}/a1.mp3` })).statusCode).toBe(200)
  })
})

describe('Editor-Daten mit Audio (Baukasten)', () => {
  it('listet hochgeladene Audio-Dateien mit Größe — Fotos/Videos nicht', async () => {
    const u = await baueTestApp()
    const id = await legeTourAn(u)
    await ladeMediumHoch(u, id) // m1.jpg liegt ebenfalls unter media/
    await ladeAudioHoch(u, id, 'a1.mp3', '0123456789')
    await ladeAudioHoch(u, id, 'wind.wav', 'wav-bytes')
    const antwort = await u.app.inject({ method: 'GET', url: `/api/tours/${id}/editor`, cookies: u.cookies })
    expect(antwort.statusCode).toBe(200)
    const daten = antwort.json() as { audio: Array<{ datei: string; groesse: number }> }
    expect(daten.audio).toEqual([
      { datei: 'a1.mp3', groesse: 10 },
      { datei: 'wind.wav', groesse: 9 },
    ])
  })
})

describe('Pipeline-Durchstich: PUT /edits rendert camera/audio/display (Baukasten)', () => {
  it('kamera/audio/display aus dem Overlay erreichen das Tour-JSON', async () => {
    const u = await baueTestApp()
    const id = await legeTourAn(u)
    await ladeMediumHoch(u, id)
    await ladeAudioHoch(u, id, 'a1.mp3')
    await finalisiere(u, id)

    const put = await u.app.inject({
      method: 'PUT',
      url: `/api/tours/${id}/edits`,
      cookies: u.cookies,
      payload: {
        schema: 'luhambo/edits@1',
        medien: { m1: { display: { holdS: 8, kenBurns: false } } },
        // Tour-Zeit: 08:12:31–14:03:10 +02:00
        kamera: [{ ab: '2026-07-04T09:00:00+02:00', preset: 'weit' }],
        audio: [
          { datei: 'a1.mp3', typ: 'musik', ab: '2026-07-04T08:12:31+02:00', lautstaerke: 0.8 },
          { datei: 'a1.mp3', typ: 'sfx', ab: '2026-07-04T09:00:00+02:00' },
        ],
      },
    })
    expect(put.statusCode).toBe(202)
    await u.app.verarbeitungen.get(id)

    const tour = (await u.app.inject({ method: 'GET', url: `/api/tours/${id}` })).json() as TourJson
    expect(tour.status).toBe('bereit')
    expect(tour.media[0]?.display).toEqual({ holdS: 8, kenBurns: false })
    expect(tour.camera).toHaveLength(1)
    expect(tour.camera?.[0]?.preset).toBe('weit')
    expect(tour.camera?.[0]?.f).toBeGreaterThan(0)
    expect(tour.camera?.[0]?.f).toBeLessThan(1)
    expect(tour.audio).toHaveLength(2)
    const musik = tour.audio?.find((a) => a.type === 'music')
    expect(musik).toMatchObject({ src: `/api/media/${id}/a1.mp3`, f0: 0, f1: 1, gain: 0.8 })
    const sfx = tour.audio?.find((a) => a.type === 'sfx')
    expect(sfx?.f0).toBe(sfx?.f1)
    expect(sfx && 'gain' in sfx).toBe(false)
    // Sortiert nach f0
    expect(tour.audio?.[0]?.f0).toBeLessThanOrEqual(tour.audio?.[1]?.f0 ?? 0)
  })

  it('überspringt Verweise auf fehlende Audio-Dateien statt zu scheitern', async () => {
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
        audio: [{ datei: 'fehlt.mp3', typ: 'musik', ab: '2026-07-04T08:12:31+02:00' }],
      },
    })
    expect(put.statusCode).toBe(202)
    await u.app.verarbeitungen.get(id)
    const tour = (await u.app.inject({ method: 'GET', url: `/api/tours/${id}` })).json() as TourJson
    expect(tour.status).toBe('bereit')
    expect(tour.audio).toBeUndefined()
  })

  it('weist kaputte Formen am Schema ab (400) — falsch getypte bekannte Felder', async () => {
    const u = await baueTestApp()
    const id = await legeTourAn(u)
    const faelle = [
      { schema: 'luhambo/edits@1', kamera: 'quatsch' },
      { schema: 'luhambo/edits@1', kamera: [{ ab: '2026-07-04T09:00:00Z', preset: 'ultra' }] },
      { schema: 'luhambo/edits@1', audio: [{ datei: 'boese.exe', typ: 'musik', ab: '2026-07-04T09:00:00Z' }] },
      // Achtung: '1' würde Fastifys coerceTypes still zu 1 wandeln — der
      // Ablehnungs-Test braucht einen NICHT koerzierbaren Wert
      { schema: 'luhambo/edits@1', audio: [{ datei: 'a1.mp3', typ: 'musik', ab: '2026-07-04T09:00:00Z', lautstaerke: 'laut' }] },
      { schema: 'luhambo/edits@1', audio: [{ datei: 'a1.mp3', typ: 'musik', ab: '2026-07-04T09:00:00Z', lautstaerke: 2 }] },
      { schema: 'luhambo/edits@1', medien: { m1: { display: { holdS: 1 } } } },
      { schema: 'luhambo/edits@1', medien: { m1: { display: { holdS: 90 } } } },
      { schema: 'luhambo/edits@1', medien: { m1: { display: { kenBurns: 'nein' } } } },
    ]
    for (const payload of faelle) {
      const antwort = await u.app.inject({ method: 'PUT', url: `/api/tours/${id}/edits`, cookies: u.cookies, payload })
      expect(antwort.statusCode, JSON.stringify(payload)).toBe(400)
    }
  })

  it('weist kaputte Semantik ab (400 mit Ursache)', async () => {
    const u = await baueTestApp()
    const id = await legeTourAn(u)
    const faelle: Array<{ payload: Record<string, unknown>; fehler: RegExp }> = [
      {
        payload: { schema: 'luhambo/edits@1', kamera: [{ ab: '2026-13-99T99:99:99Z', preset: 'nah' }] },
        fehler: /Kamera-Grenze/,
      },
      {
        payload: {
          schema: 'luhambo/edits@1',
          audio: [{ datei: 'a1.mp3', typ: 'musik', ab: '2026-07-04T10:00:00Z', bis: '2026-07-04T09:00:00Z' }],
        },
        fehler: /Audio-Ende/,
      },
      {
        payload: {
          schema: 'luhambo/edits@1',
          audio: [{ datei: 'a1.mp3', typ: 'sfx', ab: '2026-07-04T09:00:00Z', bis: '2026-07-04T10:00:00Z' }],
        },
        fehler: /nur bei Musik/,
      },
      {
        payload: { schema: 'luhambo/edits@1', audio: [{ datei: 'a1.mp3', typ: 'sfx', ab: '2026-13-99T99:99:99Z' }] },
        fehler: /Audio-Start/,
      },
    ]
    for (const { payload, fehler } of faelle) {
      const antwort = await u.app.inject({ method: 'PUT', url: `/api/tours/${id}/edits`, cookies: u.cookies, payload })
      expect(antwort.statusCode).toBe(400)
      expect((antwort.json() as { fehler: string }).fehler).toMatch(fehler)
    }
  })
})
