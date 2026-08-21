// Benutzerweite Audio-Bibliothek: Upload/Liste/Löschen eigener Musik und
// Effekte (projektübergreifend, quelle 'user'), Lösch-Schutz solange eine
// Tour die Datei verwendet, Owner-Streaming fürs Studio-Vorhören und die
// tour-gebundene Auslieferung, deren Zugriff die Sichtbarkeit der Tour regelt.

import { describe, expect, it } from 'vitest'
import type { TourJson } from '../src/pipeline/enrich.js'
import { baueTestApp, beispielManifest, type TestUmgebung } from './helfer.js'

async function createTour(u: TestUmgebung): Promise<string> {
  const antwort = await u.app.inject({
    method: 'POST',
    url: '/api/tours',
    cookies: u.cookies,
    payload: beispielManifest(),
  })
  expect(antwort.statusCode).toBe(201)
  return (antwort.json() as { id: string }).id
}

async function ladeMediumHoch(u: TestUmgebung, tourId: string): Promise<void> {
  const antwort = await u.app.inject({
    method: 'PUT',
    url: `/api/tours/${tourId}/media/m1`,
    cookies: u.cookies,
    headers: { 'content-type': 'application/octet-stream' },
    payload: Buffer.from('fake-jpeg-bytes'),
  })
  expect(antwort.statusCode).toBe(200)
}

async function finalisiere(u: TestUmgebung, tourId: string): Promise<void> {
  const antwort = await u.app.inject({
    method: 'POST',
    url: `/api/tours/${tourId}/finalize`,
    cookies: u.cookies,
  })
  expect(antwort.statusCode).toBe(202)
  await u.app.processing.get(tourId)
}

function ladeBibliothekHoch(
  u: TestUmgebung,
  datei = 'meine-musik.mp3',
  inhalt: string | Buffer = '0123456789',
) {
  return u.app.inject({
    method: 'PUT',
    url: `/api/audio-library/${datei}`,
    cookies: u.cookies,
    headers: { 'content-type': 'application/octet-stream' },
    payload: Buffer.from(inhalt as string),
  })
}

/** Overlay speichern, das die Bibliotheksdatei als Musik referenziert, und Re-Render abwarten. */
async function setzeEin(u: TestUmgebung, tourId: string, datei = 'meine-musik.mp3'): Promise<void> {
  const put = await u.app.inject({
    method: 'PUT',
    url: `/api/tours/${tourId}/edits`,
    cookies: u.cookies,
    payload: {
      schema: 'maptale/edits@2',
      audio: [{ file: datei, type: 'music', from: '2026-07-04T08:12:31+02:00', source: 'user' }],
    },
  })
  expect(put.statusCode).toBe(202)
  await u.app.processing.get(tourId)
}

async function fremdeCookies(u: TestUmgebung): Promise<{ maptale_session: string }> {
  await u.app.auth.createUser('fremd@example.com', 'geheim456', 'Fremd')
  const login = await u.app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'fremd@example.com', password: 'geheim456' },
  })
  return { maptale_session: login.cookies.find((c) => c.name === 'maptale_session')?.value ?? '' }
}

describe('Audio-Bibliothek: Upload + Liste (PUT/GET /api/audio-library)', () => {
  it('lädt hoch, listet mit Größe und leerer Verwendung, streamt für den Eigentümer mit Range', async () => {
    const u = await baueTestApp()
    const put = await ladeBibliothekHoch(u)
    expect(put.statusCode).toBe(200)
    expect(put.json()).toEqual({ file: 'meine-musik.mp3', bytes: 10 })

    const liste = await u.app.inject({
      method: 'GET',
      url: '/api/audio-library',
      cookies: u.cookies,
    })
    expect(liste.statusCode).toBe(200)
    expect(liste.json()).toEqual({
      files: [{ file: 'meine-musik.mp3', size: 10, usedBy: [] }],
    })

    const voll = await u.app.inject({
      method: 'GET',
      url: '/api/audio-library/meine-musik.mp3',
      cookies: u.cookies,
    })
    expect(voll.statusCode).toBe(200)
    expect(voll.headers['content-type']).toBe('audio/mpeg')
    expect(voll.body).toBe('0123456789')

    const range = await u.app.inject({
      method: 'GET',
      url: '/api/audio-library/meine-musik.mp3',
      cookies: u.cookies,
      headers: { range: 'bytes=2-5' },
    })
    expect(range.statusCode).toBe(206)
    expect(range.headers['content-range']).toBe('bytes 2-5/10')
    expect(range.body).toBe('2345')
  })

  it('verweigert Überschreiben (409) und unzulässige Dateinamen (400)', async () => {
    const u = await baueTestApp()
    expect((await ladeBibliothekHoch(u)).statusCode).toBe(200)
    expect((await ladeBibliothekHoch(u, 'meine-musik.mp3', 'neu')).statusCode).toBe(409)
    for (const datei of ['boese.exe', 'x.MP3', 'ohne-endung']) {
      expect((await ladeBibliothekHoch(u, datei)).statusCode).toBe(400)
    }
  })

  it('verlangt Anmeldung (401) und trennt Benutzer voneinander', async () => {
    const u = await baueTestApp()
    await ladeBibliothekHoch(u)
    expect((await u.app.inject({ method: 'GET', url: '/api/audio-library' })).statusCode).toBe(401)
    const fremd = await fremdeCookies(u)
    const liste = await u.app.inject({
      method: 'GET',
      url: '/api/audio-library',
      cookies: fremd,
    })
    expect((liste.json() as { files: unknown[] }).files).toEqual([])
    const datei = await u.app.inject({
      method: 'GET',
      url: '/api/audio-library/meine-musik.mp3',
      cookies: fremd,
    })
    expect(datei.statusCode).toBe(404)
  })

  it('zählt die Bibliothek zur Speicher-Quota', async () => {
    const u = await baueTestApp()
    await ladeBibliothekHoch(u, 'quota-test.mp3', Buffer.alloc(2048))
    const me = await u.app.inject({ method: 'GET', url: '/api/auth/me', cookies: u.cookies })
    const quota = (me.json() as { quota: { used: number } }).quota
    expect(quota.used).toBeGreaterThanOrEqual(2048)
  })
})

describe('Audio-Bibliothek: Verwendung + Lösch-Schutz', () => {
  it('rendert quelle "benutzer" mit tour-gebundener URL und meldet die Verwendung in der Liste', async () => {
    const u = await baueTestApp()
    await ladeBibliothekHoch(u)
    const id = await createTour(u)
    await ladeMediumHoch(u, id)
    await finalisiere(u, id)
    await setzeEin(u, id)

    const tourJson = JSON.parse((await u.storage.read(id, 'tour.json')).toString()) as TourJson
    expect(tourJson.audio).toBeDefined()
    expect(tourJson.audio?.[0]?.src).toBe(`/api/tours/${id}/library-audio/meine-musik.mp3`)

    const liste = await u.app.inject({
      method: 'GET',
      url: '/api/audio-library',
      cookies: u.cookies,
    })
    const eintrag = (liste.json() as { files: Array<{ usedBy: Array<{ id: string }> }> }).files[0]
    expect(eintrag?.usedBy.map((t) => t.id)).toEqual([id])
  })

  it('überspringt Verweise auf gelöschte/fehlende Bibliotheksdateien beim Rendern', async () => {
    const u = await baueTestApp()
    const id = await createTour(u)
    await ladeMediumHoch(u, id)
    await finalisiere(u, id)
    // Overlay verweist auf eine Datei, die (noch) nicht existiert
    await setzeEin(u, id, 'gibts-nicht.mp3')
    const tourJson = JSON.parse((await u.storage.read(id, 'tour.json')).toString()) as TourJson
    expect(tourJson.audio).toBeUndefined()
  })

  it('verweigert das Löschen einer verwendeten Datei (409, mit Tour-Titel) — nach dem Entfernen klappt es', async () => {
    const u = await baueTestApp()
    await ladeBibliothekHoch(u)
    const id = await createTour(u)
    await ladeMediumHoch(u, id)
    await finalisiere(u, id)
    await setzeEin(u, id)

    const del = await u.app.inject({
      method: 'DELETE',
      url: '/api/audio-library/meine-musik.mp3',
      cookies: u.cookies,
    })
    expect(del.statusCode).toBe(409)
    expect((del.json() as { error: string }).error).toContain('verwendet')

    // Eintrag aus dem Overlay nehmen → Re-Render entfernt auch die tour.json-Referenz
    const leer = await u.app.inject({
      method: 'PUT',
      url: `/api/tours/${id}/edits`,
      cookies: u.cookies,
      payload: { schema: 'maptale/edits@2' },
    })
    expect(leer.statusCode).toBe(202)
    await u.app.processing.get(id)

    const del2 = await u.app.inject({
      method: 'DELETE',
      url: '/api/audio-library/meine-musik.mp3',
      cookies: u.cookies,
    })
    expect(del2.statusCode).toBe(200)
    const me = await u.app.inject({ method: 'GET', url: '/api/auth/me', cookies: u.cookies })
    const userId = (me.json() as { user: { id: string } }).user.id
    expect(await u.userStorage.info(userId, 'audio/meine-musik.mp3')).toBeNull()
  })

  it('löscht Unbenutztes sofort; Unbekanntes ist 404', async () => {
    const u = await baueTestApp()
    await ladeBibliothekHoch(u, 'unbenutzt.mp3')
    expect(
      (
        await u.app.inject({
          method: 'DELETE',
          url: '/api/audio-library/unbenutzt.mp3',
          cookies: u.cookies,
        })
      ).statusCode,
    ).toBe(200)
    expect(
      (
        await u.app.inject({
          method: 'DELETE',
          url: '/api/audio-library/unbenutzt.mp3',
          cookies: u.cookies,
        })
      ).statusCode,
    ).toBe(404)
  })
})

describe('Audio-Bibliothek: tour-gebundene Auslieferung (GET /api/tours/:id/library-audio/:datei)', () => {
  it('folgt der Sichtbarkeit der Tour: privat nur für den Eigentümer, public ohne Anmeldung', async () => {
    const u = await baueTestApp()
    await ladeBibliothekHoch(u)
    const id = await createTour(u)
    await ladeMediumHoch(u, id)
    await finalisiere(u, id)
    await setzeEin(u, id)
    const url = `/api/tours/${id}/library-audio/meine-musik.mp3`

    // privat (Default): anonym 404, Eigentümer 200 mit privatem Cache
    expect((await u.app.inject({ method: 'GET', url })).statusCode).toBe(404)
    const eigen = await u.app.inject({ method: 'GET', url, cookies: u.cookies })
    expect(eigen.statusCode).toBe(200)
    expect(eigen.headers['cache-control']).toContain('private')
    expect(eigen.body).toBe('0123456789')

    // public: anonym 200 mit immutable-Cache und Range-Support
    await u.app.inject({
      method: 'PATCH',
      url: `/api/tours/${id}`,
      cookies: u.cookies,
      payload: { visibility: 'public' },
    })
    const anonym = await u.app.inject({ method: 'GET', url, headers: { range: 'bytes=0-3' } })
    expect(anonym.statusCode).toBe(206)
    expect(anonym.body).toBe('0123')
    const voll = await u.app.inject({ method: 'GET', url })
    expect(voll.headers['cache-control']).toContain('immutable')
  })

  it('liefert nur referenzierte Dateien aus — kein Orakel über die restliche Bibliothek', async () => {
    const u = await baueTestApp()
    await ladeBibliothekHoch(u)
    await ladeBibliothekHoch(u, 'geheim.mp3', 'streng-privat')
    const id = await createTour(u)
    await ladeMediumHoch(u, id)
    await finalisiere(u, id)
    await setzeEin(u, id) // referenziert nur meine-musik.mp3
    await u.app.inject({
      method: 'PATCH',
      url: `/api/tours/${id}`,
      cookies: u.cookies,
      payload: { visibility: 'public' },
    })

    expect(
      (
        await u.app.inject({
          method: 'GET',
          url: `/api/tours/${id}/library-audio/meine-musik.mp3`,
        })
      ).statusCode,
    ).toBe(200)
    expect(
      (await u.app.inject({ method: 'GET', url: `/api/tours/${id}/library-audio/geheim.mp3` }))
        .statusCode,
    ).toBe(404)
  })
})
