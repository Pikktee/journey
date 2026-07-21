// Anreicherungs-Cache: beweist, dass die TEUREN externen Schritte (Reverse-
// Geocoding, Auto-Wetter, Bildanalyse) beim Finalize einmal laufen und danach aus
// anreicherung.json bedient werden — ein Edit-Speichern wendet nur das Overlay
// lokal an. Gemessen über die Aufruf-Mitschnitte der Fakes (Drift-sicher gegen
// versehentliche Reaktivierung der Netz-Aufrufe im Render-Pfad).

import { describe, expect, it } from 'vitest'
import type { TourJson } from '../src/pipeline/enrich.js'
import { FesterGeocoder } from '../src/pipeline/naming.js'
import { FesterKlassifikator } from '../src/pipeline/vision.js'
import { FesteWetterQuelle, testRaster } from '../src/pipeline/weather.js'
import { baueTestApp, beispielManifest, type TestUmgebung } from './helfer.js'

async function legeTourAn(u: TestUmgebung): Promise<string> {
  const antwort = await u.app.inject({ method: 'POST', url: '/api/tours', cookies: u.cookies, payload: beispielManifest() })
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
  const antwort = await u.app.inject({ method: 'POST', url: `/api/tours/${tourId}/finalize`, cookies: u.cookies })
  expect(antwort.statusCode).toBe(202)
  await u.app.verarbeitungen.get(tourId)
}

async function speichereEdits(u: TestUmgebung, tourId: string, overlay: unknown): Promise<void> {
  const antwort = await u.app.inject({
    method: 'PUT',
    url: `/api/tours/${tourId}/edits`,
    cookies: u.cookies,
    headers: { 'content-type': 'application/json' },
    payload: overlay as Record<string, unknown>,
  })
  expect(antwort.statusCode).toBe(202) // fertige Tour → Re-Render startet
  await u.app.verarbeitungen.get(tourId)
}

const tourJson = async (u: TestUmgebung, id: string): Promise<TourJson> =>
  JSON.parse((await u.storage.lese(id, 'tour.json')).toString()) as TourJson

/** Zähl-Momentaufnahme der drei externen Quellen. */
function stand(u: TestUmgebung, wetter: FesteWetterQuelle, klass: FesterKlassifikator) {
  return {
    geo: (u.app.deps.geocoder as FesterGeocoder).aufrufe,
    wetter: wetter.abfragen.length,
    klass: klass.aufrufe.length,
  }
}

/** App mit Zähl-Spies, eine fertig finalisierte Tour (Cache liegt vor). */
async function baueUndFinalisiere() {
  const wetter = new FesteWetterQuelle(testRaster('2026-07-04T06', Array.from({ length: 7 }, () => ({ wolken: 80 }))))
  const klass = new FesterKlassifikator({ himmel: 'bedeckt', niederschlag: 'kein', himmelSichtbar: true, konfidenz: 0.9 })
  // Genug Ortsnamen für Finalize + späteres Neu-Geocoding (Trim/Reprocess).
  const u = await baueTestApp(
    ['Lauterbrunnen', 'Grindelwald', 'Wengen', 'Interlaken', 'Mürren', 'Zweilütschinen'],
    wetter,
    null,
    {},
    klass,
  )
  const id = await legeTourAn(u)
  await ladeMediumHoch(u, id)
  await finalisiere(u, id)
  return { u, wetter, klass, id }
}

describe('Anreicherungs-Cache', () => {
  it('Finalize füllt den Cache genau einmal', async () => {
    const { u, wetter, klass, id } = await baueUndFinalisiere()
    // Finalize (frisch): jede externe Quelle genau einmal (Geocoder: Start + Ziel)
    expect(stand(u, wetter, klass)).toEqual({ geo: 2, wetter: 1, klass: 1 })
    // Cache-Artefakt liegt neben tour.json und hält die Roh-Ergebnisse
    const cache = JSON.parse((await u.storage.lese(id, 'anreicherung.json')).toString())
    expect(cache.schema).toBe('luhambo/anreicherung@1')
    expect(cache.trimSignatur).toBe('null') // kein Trim
    expect(cache.befunde.m1).toBeTruthy()
    expect(cache.orte).toEqual({ startOrt: 'Lauterbrunnen', zielOrt: 'Grindelwald' })
  })

  it('Edit ohne Trim (Caption) macht KEINE externen Aufrufe — rendert aber neu', async () => {
    const { u, wetter, klass, id } = await baueUndFinalisiere()
    const vor = stand(u, wetter, klass)

    await speichereEdits(u, id, { schema: 'luhambo/edits@1', medien: { m1: { caption: 'Schön hier' } } })

    // Der teure Teil bleibt komplett aus (Cache trägt alles)
    expect(stand(u, wetter, klass)).toEqual(vor)
    // ... und der Edit ist trotzdem im gerenderten tour.json angekommen —
    // als ÜBERSCHRIFT, die Uhrzeit rutscht in die Unterzeile
    expect((await tourJson(u, id)).media[0]?.title).toBe('Schön hier')
  })

  it('Wetter-Edit ersetzt das Auto-Wetter OHNE externe Aufrufe (reine Render-Änderung)', async () => {
    const { u, wetter, klass, id } = await baueUndFinalisiere()
    const vor = stand(u, wetter, klass)

    // Wetter-Grenze am Tour-Start → ganze Tour „storm". Rein render-seitig: der
    // Cache (Geocoding/Auto-Wetter/Bildanalyse) trägt weiter, nichts wird neu geholt.
    const start = new Date(Date.parse('2026-07-04T08:12:31+02:00')).toISOString()
    await speichereEdits(u, id, { schema: 'luhambo/edits@1', wetter: [{ ab: start, mode: 'storm' }] })

    expect(stand(u, wetter, klass)).toEqual(vor)
    const weather = (await tourJson(u, id)).weather ?? []
    expect(weather.length).toBeGreaterThan(0)
    expect(weather.every((w) => w.source === 'studio' && w.mode === 'storm')).toBe(true)
  })

  it('Trim holt Ortsnamen + Wetter neu, aber NICHT die Bildanalyse', async () => {
    const { u, wetter, klass, id } = await baueUndFinalisiere()
    const vor = stand(u, wetter, klass)

    // Trim verschiebt den Startpunkt → Ortsnamen + Wetter (trim-abhängig) neu
    await speichereEdits(u, id, { schema: 'luhambo/edits@1', trim: { start: '2026-07-04T08:13:00+02:00' } })

    const nach = stand(u, wetter, klass)
    expect(nach.geo - vor.geo).toBe(2) // Start + Ziel neu geocodiert
    expect(nach.wetter - vor.wetter).toBe(1) // Auto-Wetter neu
    expect(nach.klass - vor.klass).toBe(0) // Bildanalyse bleibt gecacht — der teure Teil
  })

  it('„Neu verarbeiten" (reprocess) holt alles frisch — auch die Bildanalyse', async () => {
    const { u, wetter, klass, id } = await baueUndFinalisiere()
    const vor = stand(u, wetter, klass)

    const antwort = await u.app.inject({ method: 'POST', url: `/api/tours/${id}/reprocess`, cookies: u.cookies })
    expect(antwort.statusCode).toBe(202)
    await u.app.verarbeitungen.get(id)

    const nach = stand(u, wetter, klass)
    expect(nach.geo - vor.geo).toBe(2)
    expect(nach.wetter - vor.wetter).toBe(1)
    expect(nach.klass - vor.klass).toBe(1) // frisch klassifiziert
  })
})
