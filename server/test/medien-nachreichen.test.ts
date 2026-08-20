// Additive Medien-Route + endgültiges Löschen
// (docs/concepts/konzept_medien_nachreichen_und_loeschen.md):
// Nachreichen bei „bereit" (Server-IDs, append-only), Tombstone-Semantik,
// physisches Löschen samt Ableitungen, Cover-Fallback, Overlay-Hygiene.

import { describe, expect, it } from 'vitest'
import { FakeBildWerkzeug } from '../src/pipeline/bild.js'
import { FakeVideoWerkzeug } from '../src/pipeline/video.js'
import type { TourJson } from '../src/pipeline/enrich.js'
import type { UploadManifest } from '../src/schema/upload.js'
import { MANIFEST_PFAD } from '../src/routes/tours.js'
import { baueTestApp, beispielManifest, type TestUmgebung } from './helfer.js'

// — Helfer wie in api.test.ts, plus ein Manifest mit zwei verankerten Fotos —

async function legeTourAn(u: TestUmgebung, manifest = beispielManifest()): Promise<string> {
  const antwort = await u.app.inject({
    method: 'POST',
    url: '/api/tours',
    cookies: u.cookies,
    payload: manifest,
  })
  expect(antwort.statusCode).toBe(201)
  return (antwort.json() as { id: string }).id
}

async function ladeMediumHoch(
  u: TestUmgebung,
  tourId: string,
  mid: string,
  inhalt = 'fake-jpeg-bytes',
): Promise<void> {
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
  const antwort = await u.app.inject({
    method: 'POST',
    url: `/api/tours/${tourId}/finalize`,
    cookies: u.cookies,
  })
  expect(antwort.statusCode).toBe(202)
  await u.app.verarbeitungen.get(tourId)
}

/** Zwei verankerte Fotos — m1 wäre das automatische Titelbild. */
function manifestMitZweiFotos(): UploadManifest {
  const manifest = beispielManifest()
  manifest.media.push({
    id: 'm2',
    type: 'photo',
    file: 'IMG_0013.JPG',
    takenAt: '2026-07-04T11:30:00+02:00',
    anchor: [7.9184, 46.5891],
    caption: null,
  })
  return manifest
}

async function nachreichen(
  u: TestUmgebung,
  tourId: string,
  media: Array<Record<string, unknown>>,
): Promise<{ statusCode: number; media: Array<{ id: string; file: string }>; new: number }> {
  const antwort = await u.app.inject({
    method: 'POST',
    url: `/api/tours/${tourId}/media`,
    cookies: u.cookies,
    payload: { media },
  })
  const koerper =
    antwort.statusCode === 200
      ? (antwort.json() as { media: Array<{ id: string; file: string }>; new?: number })
      : { media: [], new: 0 }
  return { statusCode: antwort.statusCode, media: koerper.media, new: koerper.new ?? 0 }
}

/** Das rohe Manifest der Tour — die Quelle, gegen die der Dedup läuft. */
async function manifestVon(u: TestUmgebung, tourId: string): Promise<UploadManifest> {
  return JSON.parse(
    (await u.app.deps.storage.lese(tourId, MANIFEST_PFAD)).toString(),
  ) as UploadManifest
}

/**
 * Das Lesen des Manifests künstlich verlangsamen — so wie sich eine Datei- oder
 * Netz-Ablage verhält.
 *
 * **Der Inhalt wird SOFORT geholt und erst danach gewartet.** Andersherum
 * (warten, dann lesen) sieht der zweite Aufrufer bereits das Ergebnis des
 * ersten, und der Wettlauf tritt nie ein — der Test wäre grün, ohne etwas zu
 * prüfen. Genau so ist er beim Schreiben erst einmal danebengegangen.
 */
function verzoegereManifestLesen(u: TestUmgebung, ms = 20): void {
  const echtesLesen = u.storage.lese.bind(u.storage)
  u.storage.lese = async (tourId: string, pfad: string) => {
    if (pfad !== MANIFEST_PFAD) return echtesLesen(tourId, pfad)
    const daten = await echtesLesen(tourId, pfad)
    await new Promise((r) => setTimeout(r, ms))
    return daten
  }
}

async function tourJson(u: TestUmgebung, tourId: string): Promise<TourJson> {
  const antwort = await u.app.inject({
    method: 'GET',
    url: `/api/tours/${tourId}`,
    cookies: u.cookies,
  })
  expect(antwort.statusCode).toBe(200)
  return antwort.json() as TourJson
}

describe('Nachreichen (POST /api/tours/:id/media)', () => {
  it('nimmt bei „bereit" neue Medien an: Server-ID, PUT erlaubt, Reprocess rendert sie', async () => {
    const u = await baueTestApp()
    const id = await legeTourAn(u)
    await ladeMediumHoch(u, id, 'm1')
    await finalisiere(u, id)

    const { statusCode, media } = await nachreichen(u, id, [
      { type: 'photo', file: 'IMG_9000.jpeg', takenAt: '2026-07-04T10:30:00+02:00' },
    ])
    expect(statusCode).toBe(200)
    const neu = media[0]
    expect(neu?.id).toMatch(/^n_/)
    expect(neu?.id).not.toBe('m1')
    // .jpeg wird zur Ablage-Endung .jpg normalisiert
    expect(neu?.file).toBe(`${neu?.id}.jpg`)

    // Das PUT der NEUEN Datei ist trotz „bereit" erlaubt …
    await ladeMediumHoch(u, id, neu?.id ?? '')
    // … das Überschreiben eines VORHANDENEN Mediums bleibt verboten
    const ueberschreiben = await u.app.inject({
      method: 'PUT',
      url: `/api/tours/${id}/media/m1`,
      cookies: u.cookies,
      payload: Buffer.from('neu'),
    })
    expect(ueberschreiben.statusCode).toBe(409)

    // Reprocess nimmt das nachgereichte Medium in die Wiedergabe auf
    const reprocess = await u.app.inject({
      method: 'POST',
      url: `/api/tours/${id}/reprocess`,
      cookies: u.cookies,
    })
    expect(reprocess.statusCode).toBe(202)
    await u.app.verarbeitungen.get(id)
    const json = await tourJson(u, id)
    expect(json.media.map((m) => m.id)).toContain(neu?.id)
  })

  it('legt dieselbe `quelle` nur EINMAL an — auch wenn der Client den Lauf wiederholt', async () => {
    // Der Riegel gegen doppelte Fotos beim Nachzug: Die App sieht das
    // gerenderte tour.json, und das kennt nachgereichte Bilder erst nach dem
    // Rendern. Scheitert das (409, Netz weg), wiederholt sie den Lauf — und
    // ohne diesen Riegel stünde danach jedes Bild zweimal in der Tour.
    const u = await baueTestApp()
    const id = await legeTourAn(u)
    await ladeMediumHoch(u, id, 'm1')
    await finalisiere(u, id)

    const eintrag = {
      type: 'photo' as const,
      file: 'IMG_1.jpg',
      takenAt: '2026-07-04T10:30:00+02:00',
      source: 'galerie:4711',
    }
    const erst = await nachreichen(u, id, [eintrag])
    const zweit = await nachreichen(u, id, [eintrag])

    expect(erst.statusCode).toBe(200)
    expect(zweit.statusCode).toBe(200)
    // Dieselbe Zuordnung zurück — der Client lädt gefahrlos noch einmal hoch.
    expect(zweit.media[0]?.id).toBe(erst.media[0]?.id)
    expect(erst.new).toBe(1)
    expect(zweit.new).toBe(0)
    const manifest = await manifestVon(u, id)
    expect(manifest.media.filter((m) => m.source === 'galerie:4711')).toHaveLength(1)
  })

  it('behält die Reihenfolge, wenn nur ein Teil des Batches neu ist', async () => {
    // Der Client paart Antwort und Dateien über den INDEX. Eine kürzere Liste
    // verschöbe die Zuordnung — und er lüde Bild B unter der ID von A hoch.
    const u = await baueTestApp()
    const id = await legeTourAn(u)
    await ladeMediumHoch(u, id, 'm1')
    await finalisiere(u, id)

    const a = {
      type: 'photo' as const,
      file: 'a.jpg',
      takenAt: '2026-07-04T10:30:00+02:00',
      source: 'galerie:1',
    }
    const b = {
      type: 'photo' as const,
      file: 'b.jpg',
      takenAt: '2026-07-04T10:31:00+02:00',
      source: 'galerie:2',
    }
    const erst = await nachreichen(u, id, [a])
    const zweit = await nachreichen(u, id, [a, b])
    expect(zweit.media).toHaveLength(2)
    expect(zweit.media[0]?.id).toBe(erst.media[0]?.id)
    expect(zweit.media[1]?.id).not.toBe(erst.media[0]?.id)
  })

  it('ohne `quelle` bleibt jeder Eintrag neu — das Studio wählt bewusst aus', async () => {
    const u = await baueTestApp()
    const id = await legeTourAn(u)
    await ladeMediumHoch(u, id, 'm1')
    await finalisiere(u, id)
    const eintrag = { type: 'photo' as const, file: 'a.jpg', takenAt: '2026-07-04T10:30:00+02:00' }
    const erst = await nachreichen(u, id, [eintrag])
    const zweit = await nachreichen(u, id, [eintrag])
    expect(zweit.media[0]?.id).not.toBe(erst.media[0]?.id)
  })

  it('verliert bei zwei gleichzeitigen Zustellungen keinen Eintrag', async () => {
    // Lesen → Ändern → Schreiben ohne Serialisierung: Beide lesen denselben
    // Stand, der zweite schreibt den ersten weg. Der Client hätte für den
    // verlorenen Eintrag trotzdem eine ID bekommen und lüde die Bytes hoch —
    // die Datei zählt dann gegen die Quota und gehört zu keiner Tour.
    //
    // Die Verzögerung ist der ganze Test: Mit einer Ablage, die ohne Wartezeit
    // antwortet, überleben auch zwei ungeschützte Läufe. Erst ein realistisches
    // Lesen (Datei, Netz) reißt das Fenster auf.
    const u = await baueTestApp()
    const id = await legeTourAn(u)
    await ladeMediumHoch(u, id, 'm1')
    await finalisiere(u, id)

    verzoegereManifestLesen(u)

    const [a, b] = await Promise.all([
      nachreichen(u, id, [
        { type: 'photo', file: 'a.jpg', takenAt: '2026-07-04T10:30:00+02:00', source: 'galerie:A' },
      ]),
      nachreichen(u, id, [
        { type: 'photo', file: 'b.jpg', takenAt: '2026-07-04T10:31:00+02:00', source: 'galerie:B' },
      ]),
    ])
    expect(a.statusCode).toBe(200)
    expect(b.statusCode).toBe(200)

    // Beide Zusagen müssen im Manifest stehen — jede vergebene ID ist ein
    // Versprechen, dass die Datei dorthin gehört.
    const quellen = (await manifestVon(u, id)).media.map((m) => m.source).filter(Boolean)
    expect(quellen).toContain('galerie:A')
    expect(quellen).toContain('galerie:B')
    const ids = (await manifestVon(u, id)).media.map((m) => m.id)
    expect(ids).toContain(a.media[0]?.id)
    expect(ids).toContain(b.media[0]?.id)
  })

  it('lässt einen Tombstone nicht von einer gleichzeitigen Zustellung überschreiben', async () => {
    // Die teuerste Paarung: DELETE gegen POST. Ohne Sperre erweckt die
    // Zustellung einen Eintrag, dessen Dateien der Server gerade gelöscht hat.
    const u = await baueTestApp()
    const id = await legeTourAn(u, manifestMitZweiFotos())
    await ladeMediumHoch(u, id, 'm1')
    await ladeMediumHoch(u, id, 'm2')
    await finalisiere(u, id)

    verzoegereManifestLesen(u)

    await Promise.all([
      u.app.inject({ method: 'DELETE', url: `/api/tours/${id}/media/m1`, cookies: u.cookies }),
      nachreichen(u, id, [
        {
          type: 'photo',
          file: 'neu.jpg',
          takenAt: '2026-07-04T10:32:00+02:00',
          source: 'galerie:N',
        },
      ]),
    ])
    await u.app.verarbeitungen.get(id)

    const manifest = await manifestVon(u, id)
    expect(manifest.media.find((m) => m.id === 'm1')?.removed).toBe(true)
    expect(manifest.media.map((m) => m.source)).toContain('galerie:N')
  })

  it('weist während laufender Verarbeitung mit 409 ab', async () => {
    const u = await baueTestApp()
    const id = await legeTourAn(u)
    u.app.deps.db.prepare(`UPDATE tours SET status = 'processing' WHERE id = ?`).run(id)
    const { statusCode } = await nachreichen(u, id, [
      { type: 'photo', file: 'a.jpg', takenAt: '2026-07-04T10:30:00+02:00' },
    ])
    expect(statusCode).toBe(409)
  })

  it('lehnt einen Batch ganz ab, wenn ein Eintrag ungültig ist (keine halben Batches)', async () => {
    const u = await baueTestApp()
    const id = await legeTourAn(u)
    const { statusCode } = await nachreichen(u, id, [
      { type: 'photo', file: 'ok.jpg', takenAt: '2026-07-04T10:30:00+02:00' },
      { type: 'photo', file: 'kaputt.gif', takenAt: '2026-07-04T10:31:00+02:00' },
    ])
    expect(statusCode).toBe(400)
    // Auch der gültige Eintrag wurde NICHT geschrieben
    const manifest = JSON.parse(
      (await u.storage.lese(id, 'original/manifest.json')).toString(),
    ) as UploadManifest
    expect(manifest.media).toHaveLength(1)
  })

  it('vergibt eindeutige IDs, die mit keiner Manifest-ID kollidieren', async () => {
    const u = await baueTestApp()
    const id = await legeTourAn(u)
    const { media } = await nachreichen(u, id, [
      { type: 'photo', file: 'a.jpg', takenAt: '2026-07-04T10:30:00+02:00' },
      { type: 'photo', file: 'b.jpg', takenAt: '2026-07-04T10:31:00+02:00' },
    ])
    const ids = media.map((m) => m.id)
    expect(new Set(ids).size).toBe(2)
    expect(ids).not.toContain('m1')
  })
})

describe('Endgültig löschen (DELETE /api/tours/:id/media/:mid)', () => {
  it('löscht Rohdatei + Fassungen, setzt den Tombstone und rendert neu (Cover-Fallback)', async () => {
    // Mit Bild-Werkzeug: der Render erzeugt Fassungen und verwirft Originale
    const u = await baueTestApp([], null, null, {}, null, null, new FakeBildWerkzeug())
    const id = await legeTourAn(u, manifestMitZweiFotos())
    await ladeMediumHoch(u, id, 'm1')
    await ladeMediumHoch(u, id, 'm2')
    await finalisiere(u, id)

    // m1 ist das automatische Titelbild (erstes verankertes Foto)
    const vorher = await tourJson(u, id)
    expect(vorher.media.map((m) => m.id)).toEqual(expect.arrayContaining(['m1', 'm2']))
    const grosseVorher = await u.storage.gesamtGroesse(id)

    const antwort = await u.app.inject({
      method: 'DELETE',
      url: `/api/tours/${id}/media/m1`,
      cookies: u.cookies,
    })
    expect(antwort.statusCode).toBe(200)
    await u.app.verarbeitungen.get(id)

    // Alle m1-Dateien sind weg (Original war schon verworfen, Fassungen jetzt auch)
    for (const datei of ['m1.jpg', 'm1.w1920.jpg', 'm1.t480.jpg']) {
      expect(await u.storage.info(id, `media/${datei}`)).toBeNull()
    }
    // Speicher ist tatsächlich frei
    expect(await u.storage.gesamtGroesse(id)).toBeLessThan(grosseVorher)
    // Tombstone im Manifest, Eintrag bleibt stehen
    const manifest = JSON.parse(
      (await u.storage.lese(id, 'original/manifest.json')).toString(),
    ) as UploadManifest
    expect(manifest.media.find((m) => m.id === 'm1')?.removed).toBe(true)
    // tour.json referenziert m1 nicht mehr; das Cover fällt auf m2 zurück
    const nachher = await tourJson(u, id)
    expect(nachher.media.map((m) => m.id)).not.toContain('m1')
    const zeile = u.app.deps.db.prepare('SELECT cover FROM tours WHERE id = ?').get(id) as {
      cover: string | null
    }
    expect(zeile.cover).toContain('m2')
  })

  it('ist idempotent und sperrt das PUT auf den Tombstone', async () => {
    const u = await baueTestApp()
    const id = await legeTourAn(u)
    await ladeMediumHoch(u, id, 'm1')
    await finalisiere(u, id)

    const erste = await u.app.inject({
      method: 'DELETE',
      url: `/api/tours/${id}/media/m1`,
      cookies: u.cookies,
    })
    expect(erste.statusCode).toBe(200)
    await u.app.verarbeitungen.get(id)
    const zweite = await u.app.inject({
      method: 'DELETE',
      url: `/api/tours/${id}/media/m1`,
      cookies: u.cookies,
    })
    expect(zweite.statusCode).toBe(200)

    const put = await u.app.inject({
      method: 'PUT',
      url: `/api/tours/${id}/media/m1`,
      cookies: u.cookies,
      payload: Buffer.from('wiederbelebung'),
    })
    expect(put.statusCode).toBe(409)
    // Unbekannte ID bleibt davon unterschieden: 404
    const unbekannt = await u.app.inject({
      method: 'DELETE',
      url: `/api/tours/${id}/media/m99`,
      cookies: u.cookies,
    })
    expect(unbekannt.statusCode).toBe(404)
  })

  it('löscht bei Videos auch Web-Fassung, Poster und Kachel', async () => {
    const werkzeug = new FakeVideoWerkzeug({
      codecVideo: 'h264',
      codecAudio: 'aac',
      durationS: 12,
      breite: 1920,
      hoehe: 1080,
    })
    const u = await baueTestApp([], null, werkzeug, {}, null, null, new FakeBildWerkzeug())
    const manifest = beispielManifest()
    manifest.media.push({
      id: 'v1',
      type: 'video',
      file: 'VID_0001.mp4',
      takenAt: '2026-07-04T10:15:00+02:00',
      anchor: [7.9142, 46.5872],
      caption: null,
    })
    const id = await legeTourAn(u, manifest)
    await ladeMediumHoch(u, id, 'm1')
    await ladeMediumHoch(u, id, 'v1', 'fake-video-bytes')
    await finalisiere(u, id)

    const antwort = await u.app.inject({
      method: 'DELETE',
      url: `/api/tours/${id}/media/v1`,
      cookies: u.cookies,
    })
    expect(antwort.statusCode).toBe(200)
    await u.app.verarbeitungen.get(id)
    for (const datei of ['v1.mp4', 'v1.web.mp4', 'v1.poster.jpg', 'v1.t480.jpg']) {
      expect(await u.storage.info(id, `media/${datei}`)).toBeNull()
    }
  })

  it('räumt Overlay-Einträge des Mediums mit auf (media + titelbild)', async () => {
    const u = await baueTestApp()
    const id = await legeTourAn(u, manifestMitZweiFotos())
    await ladeMediumHoch(u, id, 'm1')
    await ladeMediumHoch(u, id, 'm2')
    await finalisiere(u, id)

    const edits = {
      schema: 'maptale/edits@2',
      cover: 'm1',
      media: { m1: { caption: 'Gipfelkreuz' }, m2: { caption: 'Abfahrt' } },
    }
    const speichern = await u.app.inject({
      method: 'PUT',
      url: `/api/tours/${id}/edits`,
      cookies: u.cookies,
      payload: edits,
    })
    expect(speichern.statusCode).toBe(202)
    await u.app.verarbeitungen.get(id)

    const antwort = await u.app.inject({
      method: 'DELETE',
      url: `/api/tours/${id}/media/m1`,
      cookies: u.cookies,
    })
    expect(antwort.statusCode).toBe(200)
    await u.app.verarbeitungen.get(id)

    const gespeichert = JSON.parse((await u.storage.lese(id, 'edits.json')).toString()) as {
      cover?: string
      media?: Record<string, unknown>
    }
    expect(gespeichert.cover).toBeUndefined()
    expect(gespeichert.media?.['m1']).toBeUndefined()
    expect(gespeichert.media?.['m2']).toBeDefined()
  })

  it('Tombstone blockiert das Finalisieren nicht (Löschen vor dem Finalize)', async () => {
    const u = await baueTestApp()
    const id = await legeTourAn(u, manifestMitZweiFotos())
    await ladeMediumHoch(u, id, 'm2')
    // m1 wurde nie hochgeladen und wird bei „angelegt" gelöscht
    const antwort = await u.app.inject({
      method: 'DELETE',
      url: `/api/tours/${id}/media/m1`,
      cookies: u.cookies,
    })
    expect(antwort.statusCode).toBe(200)
    // finalize meldet KEIN „Medien fehlen" für den Tombstone
    await finalisiere(u, id)
    const json = await tourJson(u, id)
    expect(json.media.map((m) => m.id)).toEqual(['m2'])
  })

  it('blendet den Tombstone aus den Editor-Daten aus', async () => {
    const u = await baueTestApp()
    const id = await legeTourAn(u, manifestMitZweiFotos())
    await ladeMediumHoch(u, id, 'm1')
    await ladeMediumHoch(u, id, 'm2')
    await finalisiere(u, id)
    await u.app.inject({ method: 'DELETE', url: `/api/tours/${id}/media/m1`, cookies: u.cookies })
    await u.app.verarbeitungen.get(id)

    const editor = (
      await u.app.inject({ method: 'GET', url: `/api/tours/${id}/editor`, cookies: u.cookies })
    ).json() as {
      media: Array<{ id: string }>
    }
    expect(editor.media.map((m) => m.id)).toEqual(['m2'])
  })

  it('nachgereicht, aber nie hochgeladen: der Render überspringt den Eintrag', async () => {
    const u = await baueTestApp()
    const id = await legeTourAn(u)
    await ladeMediumHoch(u, id, 'm1')
    await finalisiere(u, id)

    const { media } = await nachreichen(u, id, [
      { type: 'photo', file: 'nie-hochgeladen.jpg', takenAt: '2026-07-04T10:30:00+02:00' },
    ])
    // Kein PUT — direkt neu verarbeiten
    const reprocess = await u.app.inject({
      method: 'POST',
      url: `/api/tours/${id}/reprocess`,
      cookies: u.cookies,
    })
    expect(reprocess.statusCode).toBe(202)
    await u.app.verarbeitungen.get(id)

    const json = await tourJson(u, id)
    expect(json.media.map((m) => m.id)).not.toContain(media[0]?.id)
    // Die Tour ist trotzdem sauber fertig geworden
    expect(u.app.deps.db.prepare('SELECT status FROM tours WHERE id = ?').get(id)).toEqual({
      status: 'ready',
    })
  })

  it('zeigt einen Nachzügler ohne Datei bei „bereit" auch im Editor nicht', async () => {
    // Ein abgebrochenes Nachreichen hinterlässt einen Eintrag ohne Datei. Bei
    // einer fertigen Tour ist das ein Überbleibsel — als Klip gezeigt wäre es
    // eine Aufnahme, die es nicht gibt (Bild 404). Bei „angelegt" bleibt er
    // sichtbar: dort läuft der Upload gerade erst.
    const u = await baueTestApp()
    const id = await legeTourAn(u)
    await ladeMediumHoch(u, id, 'm1')
    await finalisiere(u, id)

    const { media } = await nachreichen(u, id, [
      { type: 'photo', file: 'abgebrochen.jpg', takenAt: '2026-07-04T10:30:00+02:00' },
    ])
    const editor = (
      await u.app.inject({ method: 'GET', url: `/api/tours/${id}/editor`, cookies: u.cookies })
    ).json() as {
      media: Array<{ id: string }>
    }
    expect(editor.media.map((m) => m.id)).toEqual(['m1'])
    // Das Manifest behält ihn trotzdem — es ist das Protokoll des Hochgeladenen
    const manifest = JSON.parse((await u.app.deps.storage.lese(id, MANIFEST_PFAD)).toString()) as {
      media: Array<{ id: string }>
    }
    expect(manifest.media.map((m) => m.id)).toContain(media[0]?.id)
  })
})
