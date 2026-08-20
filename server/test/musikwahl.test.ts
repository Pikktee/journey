// Automatische Musik: die Auswahlregeln als reine Funktion und der Vertrag der
// Pipeline — EINMAL vorschlagen, danach nie wieder hineinreden.

import { describe, expect, it } from 'vitest'
import {
  AUTO_MUSIK,
  nassAnteil,
  waehleMusik,
  type MusikEingabe,
} from '../src/pipeline/musikwahl.js'
import type { UploadSegment } from '../src/schema/upload.js'
import type { WetterKeyframe } from '../src/pipeline/weather.js'
import { baueTestApp, beispielManifest, type TestUmgebung } from './helfer.js'

/** Kurzer Alpen-Track auf Meereshöhe; Höhen und Modus je Test überschrieben. */
function segment(
  mode: UploadSegment['mode'] = 'bike',
  hoehen: number[] = [400, 420, 440],
  lat = 46.6,
): UploadSegment {
  return {
    mode,
    pts: hoehen.map(
      (h, i) => [7.9 + i * 0.004, lat, h, i * 600] as [number, number, number, number],
    ),
  }
}

function eingabe(teil: Partial<MusikEingabe> = {}): MusikEingabe {
  return {
    segmente: [segment()],
    wetter: null,
    startIso: '2026-07-04T09:00:00+02:00',
    endeIso: '2026-07-04T12:00:00+02:00',
    zone: 'Europe/Zurich',
    ...teil,
  }
}

function kf(f: number, mode: WetterKeyframe['mode']): WetterKeyframe {
  return { f, mode, k: 0.7, source: 'test' }
}

describe('nassAnteil', () => {
  it('misst die Spanne bis zum nächsten Keyframe, nicht die Zahl der Marken', () => {
    expect(nassAnteil([kf(0, 'off'), kf(0.5, 'rain')])).toBeCloseTo(0.5)
    expect(nassAnteil([kf(0, 'rain'), kf(0.2, 'off')])).toBeCloseTo(0.2)
  })

  it('zählt Regen, Gewitter und Schnee, nicht Wolken oder Nebel', () => {
    expect(nassAnteil([kf(0, 'storm')])).toBe(1)
    expect(nassAnteil([kf(0, 'snow')])).toBe(1)
    expect(nassAnteil([kf(0, 'clouds')])).toBe(0)
    expect(nassAnteil([kf(0, 'fog')])).toBe(0)
  })

  it('summiert mehrere nasse Abschnitte und verträgt unsortierte Marken', () => {
    expect(
      nassAnteil([kf(0.6, 'rain'), kf(0, 'rain'), kf(0.2, 'off'), kf(0.8, 'off')]),
    ).toBeCloseTo(0.4)
  })

  it('ohne Marken ist nichts nass', () => {
    expect(nassAnteil([])).toBe(0)
  })
})

describe('waehleMusik', () => {
  it('trägt eine unauffällige Tour mit „Aufbruch"', () => {
    expect(waehleMusik(eingabe())).toBe(AUTO_MUSIK.aufbruch)
  })

  it('Nacht schlägt alles — auch Regen und Berge', () => {
    const nachts = eingabe({
      startIso: '2026-07-04T22:00:00+02:00',
      endeIso: '2026-07-05T01:30:00+02:00',
      wetter: [kf(0, 'rain')],
      segmente: [segment('bike', [400, 1400, 2400])],
    })
    expect(waehleMusik(nachts)).toBe(AUTO_MUSIK.nachtfahrt)
  })

  it('eine Tour, die im Hellen beginnt und in die Nacht läuft, ist keine Nachtfahrt', () => {
    const abends = eingabe({
      startIso: '2026-07-04T16:00:00+02:00',
      endeIso: '2026-07-04T22:30:00+02:00',
    })
    expect(waehleMusik(abends)).not.toBe(AUTO_MUSIK.nachtfahrt)
  })

  it('nasses Drittel gibt „Regentag"', () => {
    expect(waehleMusik(eingabe({ wetter: [kf(0, 'rain'), kf(0.4, 'off')] }))).toBe(
      AUTO_MUSIK.regentag,
    )
  })

  it('ein kurzer Schauer reicht nicht', () => {
    expect(waehleMusik(eingabe({ wetter: [kf(0, 'off'), kf(0.8, 'rain'), kf(0.9, 'off')] }))).toBe(
      AUTO_MUSIK.aufbruch,
    )
  })

  it('Höhenmeter geben „Bergpass"', () => {
    // Stetiger Anstieg über viele Punkte: berechneStats glättet über ±5 Punkte,
    // ein Dreipunkt-Zickzack würde dabei zu einer Ebene verrechnet.
    // Bleibt unter der Höhenschwelle (1200 m), damit wirklich der Gewinn zählt.
    const hoehen = Array.from({ length: 30 }, (_, i) => 300 + i * 25) // 300 → 1025 m
    expect(waehleMusik(eingabe({ segmente: [segment('bike', hoehen)] }))).toBe(AUTO_MUSIK.bergpass)
  })

  it('auch ohne Anstieg zählt die schiere Höhe', () => {
    expect(waehleMusik(eingabe({ segmente: [segment('bike', [2000, 2010, 2020])] }))).toBe(
      AUTO_MUSIK.bergpass,
    )
  })

  it('eine Fähre bedeutet Wasser', () => {
    expect(waehleMusik(eingabe({ segmente: [segment('bike'), segment('ferry')] }))).toBe(
      AUTO_MUSIK.kuestenstrasse,
    )
  })

  it('zwischen den Wendekreisen läuft „Tropen"', () => {
    expect(waehleMusik(eingabe({ segmente: [segment('moped', [10, 20, 30], 9.7)] }))).toBe(
      AUTO_MUSIK.tropen,
    )
  })

  it('knapp außerhalb der Wendekreise nicht mehr', () => {
    expect(waehleMusik(eingabe({ segmente: [segment('moped', [10, 20, 30], 24.2)] }))).not.toBe(
      AUTO_MUSIK.tropen,
    )
  })

  it('Ankunft im Abendlicht gibt „Goldene Stunde"', () => {
    const abend = eingabe({
      startIso: '2026-07-04T15:00:00+02:00',
      endeIso: '2026-07-04T18:40:00+02:00',
    })
    expect(waehleMusik(abend)).toBe(AUTO_MUSIK.goldeneStunde)
  })

  it('die Zeitzone der Tour entscheidet, nicht die des Servers', () => {
    // Dieselbe absolute Zeit: in Bangkok ist es tiefe Nacht, in Zürich Abend.
    const utc = { startIso: '2026-07-04T16:30:00Z', endeIso: '2026-07-04T18:00:00Z' }
    expect(waehleMusik(eingabe({ ...utc, zone: 'Asia/Bangkok' }))).toBe(AUTO_MUSIK.nachtfahrt)
    expect(waehleMusik(eingabe({ ...utc, zone: 'Europe/Zurich' }))).toBe(AUTO_MUSIK.goldeneStunde)
  })

  it('eine weite Strecke gibt „Fernweh"', () => {
    // ~70 km auf einem Breitengrad weit weg von den Tropen, flach, tagsüber.
    const weit: UploadSegment = {
      mode: 'jeep',
      pts: [
        [7.9, 46.6, 400, 0],
        [8.4, 46.6, 410, 3600],
        [8.82, 46.6, 405, 7200],
      ],
    }
    expect(waehleMusik(eingabe({ segmente: [weit] }))).toBe(AUTO_MUSIK.fernweh)
  })

  it('unbrauchbare Zeitangaben werfen nicht, sondern fallen auf den Standard zurück', () => {
    expect(waehleMusik(eingabe({ startIso: 'kaputt', endeIso: 'auch kaputt' }))).toBe(
      AUTO_MUSIK.aufbruch,
    )
    expect(waehleMusik(eingabe({ zone: 'Nirgendwo/Unbekannt' }))).toBe(AUTO_MUSIK.aufbruch)
  })

  it('ohne Segmente bleibt es beim Standard, statt zu stolpern', () => {
    expect(waehleMusik(eingabe({ segmente: [] }))).toBe(AUTO_MUSIK.aufbruch)
  })

  it('vergibt nur Dateien aus der kuratierten Bibliothek', () => {
    const alle = new Set(Object.values(AUTO_MUSIK))
    for (const e of [
      eingabe(),
      eingabe({ wetter: [kf(0, 'rain')] }),
      eingabe({ segmente: [segment('ferry')] }),
      eingabe({ startIso: '2026-07-04T23:00:00+02:00', endeIso: '2026-07-05T02:00:00+02:00' }),
    ]) {
      expect(alle.has(waehleMusik(e) as (typeof AUTO_MUSIK)[keyof typeof AUTO_MUSIK])).toBe(true)
    }
  })
})

// — Vertrag der Pipeline —

async function tourBisBereit(u: TestUmgebung): Promise<string> {
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
    payload: Buffer.from('fake-jpeg-bytes'),
  })
  const fin = await u.app.inject({
    method: 'POST',
    url: `/api/tours/${id}/finalize`,
    cookies: u.cookies,
  })
  expect(fin.statusCode).toBe(202)
  await u.app.verarbeitungen.get(id)
  return id
}

async function leseEdits(
  u: TestUmgebung,
  id: string,
): Promise<{ audio?: Array<{ file: string; type: string; quelle?: string }> }> {
  const antwort = await u.app.inject({
    method: 'GET',
    url: `/api/tours/${id}/edits`,
    cookies: u.cookies,
  })
  return antwort.json() as { audio?: Array<{ file: string; type: string; quelle?: string }> }
}

describe('Musik beim ersten Verarbeiten', () => {
  it('legt einen Bibliotheks-Titel ins Overlay und rendert ihn mit', async () => {
    const u = await baueTestApp()
    try {
      const id = await tourBisBereit(u)
      const edits = await leseEdits(u, id)
      expect(edits.audio).toHaveLength(1)
      expect(edits.audio?.[0]).toMatchObject({ type: 'music', source: 'library' })
      expect(Object.values(AUTO_MUSIK)).toContain(edits.audio?.[0]?.file)

      // Und die Tour klingt wirklich: /audio/sfx-Spur über die ganze Strecke.
      const tour = JSON.parse((await u.storage.lese(id, 'tour.json')).toString()) as {
        audio?: Array<{ type: string; src: string; f0: number; f1: number }>
      }
      expect(tour.audio).toHaveLength(1)
      expect(tour.audio?.[0]?.type).toBe('music')
      expect(tour.audio?.[0]?.src).toMatch(/^\/audio\/sfx\/mus-/)
      expect(tour.audio?.[0]?.f0).toBe(0)
      expect(tour.audio?.[0]?.f1).toBe(1)
    } finally {
      await u.app.close()
    }
  })

  it('kommt nach dem Entfernen nicht zurück — auch nicht bei „Neu verarbeiten"', async () => {
    const u = await baueTestApp()
    try {
      const id = await tourBisBereit(u)
      // Der Nutzer nimmt die Musik wieder heraus.
      const weg = await u.app.inject({
        method: 'PUT',
        url: `/api/tours/${id}/edits`,
        cookies: u.cookies,
        payload: { schema: 'maptale/edits@2', audio: [] },
      })
      expect(weg.statusCode).toBe(202)
      await u.app.verarbeitungen.get(id)

      const neu = await u.app.inject({
        method: 'POST',
        url: `/api/tours/${id}/reprocess`,
        cookies: u.cookies,
      })
      expect(neu.statusCode).toBe(202)
      await u.app.verarbeitungen.get(id)

      expect((await leseEdits(u, id)).audio).toEqual([])
    } finally {
      await u.app.close()
    }
  })

  it('rührt eine selbst gesetzte Spur nicht an', async () => {
    const u = await baueTestApp()
    try {
      // Overlay VOR dem Finalisieren setzen: die Automatik darf es nicht ersetzen.
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
        payload: Buffer.from('fake-jpeg-bytes'),
      })
      await u.app.inject({
        method: 'PUT',
        url: `/api/tours/${id}/edits`,
        cookies: u.cookies,
        payload: {
          schema: 'maptale/edits@2',
          audio: [
            {
              file: 'mus-tropen.mp3',
              type: 'music',
              from: '2026-07-04T08:12:31+02:00',
              source: 'library',
            },
          ],
        },
      })
      const fin = await u.app.inject({
        method: 'POST',
        url: `/api/tours/${id}/finalize`,
        cookies: u.cookies,
      })
      expect(fin.statusCode).toBe(202)
      await u.app.verarbeitungen.get(id)

      const edits = await leseEdits(u, id)
      expect(edits.audio).toHaveLength(1)
      expect(edits.audio?.[0]?.file).toBe('mus-tropen.mp3')
    } finally {
      await u.app.close()
    }
  })
})
