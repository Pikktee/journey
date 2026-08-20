// Die Bild-Fassungen im Zusammenspiel: von der hochgeladenen Datei über das
// gerenderte tour.json bis in Tourliste und Editor-Ansicht. Dazu der Nachtrag,
// der Bestandstouren nachträglich umstellt.

import { describe, expect, it } from 'vitest'
import { FakeBildWerkzeug } from '../src/pipeline/bild.js'
import { trageBildfassungenNach } from '../src/pipeline/bildnachtrag.js'
import type { TourJson } from '../src/pipeline/enrich.js'
import { TOURJSON_PFAD } from '../src/routes/tours.js'
import { baueTestApp, beispielManifest, type TestUmgebung } from './helfer.js'

/** Ein Minimal-JPEG — genug, damit die Aufbereitung es als Bild behandelt. */
const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02])

async function legeFertigeTourAn(u: TestUmgebung): Promise<string> {
  const angelegt = await u.app.inject({
    method: 'POST',
    url: '/api/tours',
    cookies: u.cookies,
    payload: beispielManifest(),
  })
  const id = (angelegt.json() as { id: string }).id
  await u.app.inject({
    method: 'PUT',
    url: `/api/tours/${id}/media/m1`,
    cookies: u.cookies,
    headers: { 'content-type': 'application/octet-stream' },
    payload: jpegBytes,
  })
  await u.app.inject({ method: 'POST', url: `/api/tours/${id}/finalize`, cookies: u.cookies })
  await u.app.verarbeitungen.get(id)
  return id
}

const mitWerkzeug = (): Promise<TestUmgebung> =>
  baueTestApp(undefined, null, null, {}, null, null, new FakeBildWerkzeug())

async function tourJson(u: TestUmgebung, id: string): Promise<TourJson> {
  const antwort = await u.app.inject({ method: 'GET', url: `/api/tours/${id}`, cookies: u.cookies })
  return antwort.json() as TourJson
}

describe('Fassungen beim Rendern', () => {
  it('liefert die Anzeige-Fassung aus und verwirft das Original', async () => {
    const u = await mitWerkzeug()
    const id = await legeFertigeTourAn(u)

    const tour = await tourJson(u, id)
    expect(tour.media[0]?.src).toBe(`/api/media/${id}/m1.w1920.jpg`)
    expect(tour.media[0]?.thumb).toBe(`/api/media/${id}/m1.t480.jpg`)
    expect(await u.storage.info(id, 'media/m1.jpg')).toBeNull()
  })

  it('macht die ausgelieferten Fassungen auch wirklich abrufbar', async () => {
    // Der Pfad im tour.json nützt nichts, wenn die Auslieferungsroute den
    // Namen mit zwei Punkt-Segmenten abweist.
    const u = await mitWerkzeug()
    const id = await legeFertigeTourAn(u)

    for (const datei of ['m1.w1920.jpg', 'm1.t480.jpg']) {
      const antwort = await u.app.inject({
        method: 'GET',
        url: `/api/media/${id}/${datei}`,
        cookies: u.cookies,
      })
      expect(antwort.statusCode, datei).toBe(200)
      expect(antwort.headers['content-type']).toBe('image/jpeg')
    }
  })

  it('setzt Titelbild und Kachel in der Tourliste', async () => {
    const u = await mitWerkzeug()
    const id = await legeFertigeTourAn(u)

    const liste = (
      await u.app.inject({ method: 'GET', url: '/api/tours', cookies: u.cookies })
    ).json() as { tours: Array<{ id: string; cover: string; coverThumb: string }> }
    const eintrag = liste.tours.find((t) => t.id === id)
    expect(eintrag?.cover).toBe(`/api/media/${id}/m1.w1920.jpg`)
    expect(eintrag?.coverThumb).toBe(`/api/media/${id}/m1.t480.jpg`)
  })

  it('zeigt dem Editor die Fassungen statt des verworfenen Originals', async () => {
    const u = await mitWerkzeug()
    const id = await legeFertigeTourAn(u)

    const editor = (
      await u.app.inject({ method: 'GET', url: `/api/tours/${id}/editor`, cookies: u.cookies })
    ).json() as { media: Array<{ id: string; src: string; thumb?: string }> }
    expect(editor.media[0]?.src).toBe(`/api/media/${id}/m1.w1920.jpg`)
    expect(editor.media[0]?.thumb).toBe(`/api/media/${id}/m1.t480.jpg`)
  })

  it('lässt ein wiederholtes finalize durch, obwohl das Original fort ist', async () => {
    // Der App-Upload ruft finalize bei jedem Retry erneut. Prüfte der
    // Vollständigkeits-Check nur das Original, käme ab jetzt immer „Medien
    // fehlen" — die Tour bliebe für die App dauerhaft unfertig.
    const u = await mitWerkzeug()
    const id = await legeFertigeTourAn(u)

    const nochmal = await u.app.inject({
      method: 'POST',
      url: `/api/tours/${id}/finalize`,
      cookies: u.cookies,
    })
    await u.app.verarbeitungen.get(id)
    expect(nochmal.statusCode).toBe(202)
  })

  it('rechnet beim Edit-Speichern nichts neu, hält die Fassungen aber', async () => {
    const u = await mitWerkzeug()
    const id = await legeFertigeTourAn(u)

    const antwort = await u.app.inject({
      method: 'PUT',
      url: `/api/tours/${id}/edits`,
      cookies: u.cookies,
      payload: { schema: 'maptale/edits@2', media: { m1: { caption: 'Am Wasserfall' } } },
    })
    expect(antwort.statusCode).toBe(202)
    await u.app.verarbeitungen.get(id)

    const tour = await tourJson(u, id)
    expect(tour.media[0]?.src).toBe(`/api/media/${id}/m1.w1920.jpg`)
    expect(tour.media[0]?.title).toBe('Am Wasserfall')
  })

  it('bleibt ohne Bildwerkzeug beim Original', async () => {
    // Kein ffmpeg (oder abgeschaltet): Die Tour muss trotzdem spielbar bleiben.
    const u = await baueTestApp()
    const id = await legeFertigeTourAn(u)

    const tour = await tourJson(u, id)
    expect(tour.media[0]?.src).toBe(`/api/media/${id}/m1.jpg`)
    expect(tour.media[0]?.thumb).toBeUndefined()
    expect(await u.storage.info(id, 'media/m1.jpg')).not.toBeNull()
  })
})

describe('trageBildfassungenNach', () => {
  it('stellt eine Bestandstour um: Fassungen, Pfade, Titelbild', async () => {
    // Zustand vor der Umstellung: gerendert ohne Bildwerkzeug, Original liegt
    const u = await baueTestApp()
    const id = await legeFertigeTourAn(u)
    expect(await u.storage.info(id, 'media/m1.jpg')).not.toBeNull()

    const ergebnis = await trageBildfassungenNach(
      u.app.deps.db,
      u.storage,
      TOURJSON_PFAD,
      new FakeBildWerkzeug(),
    )

    expect(ergebnis.touren).toBe(1)
    const tour = await tourJson(u, id)
    expect(tour.media[0]?.src).toBe(`/api/media/${id}/m1.w1920.jpg`)
    expect(tour.media[0]?.thumb).toBe(`/api/media/${id}/m1.t480.jpg`)
    expect(await u.storage.info(id, 'media/m1.jpg')).toBeNull()

    const zeile = u.app.deps.db
      .prepare('SELECT cover, cover_thumb FROM tours WHERE id = ?')
      .get(id) as {
      cover: string
      cover_thumb: string
    }
    expect(zeile.cover).toBe(`/api/media/${id}/m1.w1920.jpg`)
    expect(zeile.cover_thumb).toBe(`/api/media/${id}/m1.t480.jpg`)
  })

  it('läuft ein zweites Mal ins Leere', async () => {
    const u = await mitWerkzeug()
    await legeFertigeTourAn(u)
    // Beim Rendern schon geschehen — es gibt nichts nachzutragen
    expect(
      (
        await trageBildfassungenNach(
          u.app.deps.db,
          u.storage,
          TOURJSON_PFAD,
          new FakeBildWerkzeug(),
        )
      ).touren,
    ).toBe(0)
  })

  it('behält die Titelbild-Wahl des Nutzers bei', async () => {
    // Ein Nachtrag, der das Titelbild neu WÄHLT statt es umzuschreiben, würde
    // eine im Studio getroffene Entscheidung stillschweigend verwerfen.
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
    const id = (
      await u.app.inject({
        method: 'POST',
        url: '/api/tours',
        cookies: u.cookies,
        payload: manifest,
      })
    ).json() as { id: string }
    for (const mid of ['m1', 'm2']) {
      await u.app.inject({
        method: 'PUT',
        url: `/api/tours/${id.id}/media/${mid}`,
        cookies: u.cookies,
        headers: { 'content-type': 'application/octet-stream' },
        payload: jpegBytes,
      })
    }
    await u.app.inject({
      method: 'PUT',
      url: `/api/tours/${id.id}/edits`,
      cookies: u.cookies,
      payload: { schema: 'maptale/edits@2', cover: 'm2' },
    })
    await u.app.inject({ method: 'POST', url: `/api/tours/${id.id}/finalize`, cookies: u.cookies })
    await u.app.verarbeitungen.get(id.id)

    await trageBildfassungenNach(u.app.deps.db, u.storage, TOURJSON_PFAD, new FakeBildWerkzeug())

    const zeile = u.app.deps.db.prepare('SELECT cover FROM tours WHERE id = ?').get(id.id) as {
      cover: string
    }
    expect(zeile.cover).toBe(`/api/media/${id.id}/m2.w1920.jpg`)
  })

  it('eine kaputte Tour hält den Start nicht auf', async () => {
    const u = await baueTestApp()
    const id = await legeFertigeTourAn(u)
    await u.storage.loesche(id, TOURJSON_PFAD)

    const gemeldet: string[] = []
    const ergebnis = await trageBildfassungenNach(
      u.app.deps.db,
      u.storage,
      TOURJSON_PFAD,
      new FakeBildWerkzeug(),
      (n) => gemeldet.push(n),
    )
    expect(ergebnis.touren).toBe(0)
    expect(gemeldet).toHaveLength(1)
  })
})
