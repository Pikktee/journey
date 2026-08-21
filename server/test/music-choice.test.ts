// Automatische Musik: die Auswahlregeln als reine Funktion und der Vertrag der
// Pipeline — EINMAL vorschlagen, danach nie wieder hineinreden.

import { describe, expect, it } from 'vitest'
import {
  AUTO_MUSIC,
  wetFraction,
  chooseMusic,
  type MusicInput,
} from '../src/pipeline/music-choice.js'
import type { UploadSegment } from '../src/schema/upload.js'
import type { WeatherKeyframe } from '../src/pipeline/weather.js'
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

function eingabe(teil: Partial<MusicInput> = {}): MusicInput {
  return {
    segs: [segment()],
    weather: null,
    startIso: '2026-07-04T09:00:00+02:00',
    endIso: '2026-07-04T12:00:00+02:00',
    zone: 'Europe/Zurich',
    ...teil,
  }
}

function kf(f: number, mode: WeatherKeyframe['mode']): WeatherKeyframe {
  return { f, mode, k: 0.7, source: 'test' }
}

describe('nassAnteil', () => {
  it('misst die Spanne bis zum nächsten Keyframe, nicht die Zahl der Marken', () => {
    expect(wetFraction([kf(0, 'off'), kf(0.5, 'rain')])).toBeCloseTo(0.5)
    expect(wetFraction([kf(0, 'rain'), kf(0.2, 'off')])).toBeCloseTo(0.2)
  })

  it('zählt Regen, Gewitter und Schnee, nicht Wolken oder Nebel', () => {
    expect(wetFraction([kf(0, 'storm')])).toBe(1)
    expect(wetFraction([kf(0, 'snow')])).toBe(1)
    expect(wetFraction([kf(0, 'clouds')])).toBe(0)
    expect(wetFraction([kf(0, 'fog')])).toBe(0)
  })

  it('summiert mehrere nasse Abschnitte und verträgt unsortierte Marken', () => {
    expect(
      wetFraction([kf(0.6, 'rain'), kf(0, 'rain'), kf(0.2, 'off'), kf(0.8, 'off')]),
    ).toBeCloseTo(0.4)
  })

  it('ohne Marken ist nichts nass', () => {
    expect(wetFraction([])).toBe(0)
  })
})

describe('waehleMusik', () => {
  it('trägt eine unauffällige Tour mit „Aufbruch"', () => {
    expect(chooseMusic(eingabe())).toBe(AUTO_MUSIC.aufbruch)
  })

  it('Nacht schlägt alles — auch Regen und Berge', () => {
    const nachts = eingabe({
      startIso: '2026-07-04T22:00:00+02:00',
      endIso: '2026-07-05T01:30:00+02:00',
      weather: [kf(0, 'rain')],
      segs: [segment('bike', [400, 1400, 2400])],
    })
    expect(chooseMusic(nachts)).toBe(AUTO_MUSIC.nachtfahrt)
  })

  it('eine Tour, die im Hellen beginnt und in die Nacht läuft, ist keine Nachtfahrt', () => {
    const abends = eingabe({
      startIso: '2026-07-04T16:00:00+02:00',
      endIso: '2026-07-04T22:30:00+02:00',
    })
    expect(chooseMusic(abends)).not.toBe(AUTO_MUSIC.nachtfahrt)
  })

  it('nasses Drittel gibt „Regentag"', () => {
    expect(chooseMusic(eingabe({ weather: [kf(0, 'rain'), kf(0.4, 'off')] }))).toBe(
      AUTO_MUSIC.regentag,
    )
  })

  it('ein kurzer Schauer reicht nicht', () => {
    expect(chooseMusic(eingabe({ weather: [kf(0, 'off'), kf(0.8, 'rain'), kf(0.9, 'off')] }))).toBe(
      AUTO_MUSIC.aufbruch,
    )
  })

  it('Höhenmeter geben „Bergpass"', () => {
    // Stetiger Anstieg über viele Punkte: berechneStats glättet über ±5 Punkte,
    // ein Dreipunkt-Zickzack würde dabei zu einer Ebene verrechnet.
    // Bleibt unter der Höhenschwelle (1200 m), damit wirklich der Gewinn zählt.
    const hoehen = Array.from({ length: 30 }, (_, i) => 300 + i * 25) // 300 → 1025 m
    expect(chooseMusic(eingabe({ segs: [segment('bike', hoehen)] }))).toBe(AUTO_MUSIC.bergpass)
  })

  it('auch ohne Anstieg zählt die schiere Höhe', () => {
    expect(chooseMusic(eingabe({ segs: [segment('bike', [2000, 2010, 2020])] }))).toBe(
      AUTO_MUSIC.bergpass,
    )
  })

  it('eine Fähre bedeutet Wasser', () => {
    expect(chooseMusic(eingabe({ segs: [segment('bike'), segment('ferry')] }))).toBe(
      AUTO_MUSIC.kuestenstrasse,
    )
  })

  it('zwischen den Wendekreisen läuft „Tropen"', () => {
    expect(chooseMusic(eingabe({ segs: [segment('moped', [10, 20, 30], 9.7)] }))).toBe(
      AUTO_MUSIC.tropen,
    )
  })

  it('knapp außerhalb der Wendekreise nicht mehr', () => {
    expect(chooseMusic(eingabe({ segs: [segment('moped', [10, 20, 30], 24.2)] }))).not.toBe(
      AUTO_MUSIC.tropen,
    )
  })

  it('Ankunft im Abendlicht gibt „Goldene Stunde"', () => {
    const abend = eingabe({
      startIso: '2026-07-04T15:00:00+02:00',
      endIso: '2026-07-04T18:40:00+02:00',
    })
    expect(chooseMusic(abend)).toBe(AUTO_MUSIC.goldeneStunde)
  })

  it('die Zeitzone der Tour entscheidet, nicht die des Servers', () => {
    // Dieselbe absolute Zeit: in Bangkok ist es tiefe Nacht, in Zürich Abend.
    const utc = { startIso: '2026-07-04T16:30:00Z', endIso: '2026-07-04T18:00:00Z' }
    expect(chooseMusic(eingabe({ ...utc, zone: 'Asia/Bangkok' }))).toBe(AUTO_MUSIC.nachtfahrt)
    expect(chooseMusic(eingabe({ ...utc, zone: 'Europe/Zurich' }))).toBe(AUTO_MUSIC.goldeneStunde)
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
    expect(chooseMusic(eingabe({ segs: [weit] }))).toBe(AUTO_MUSIC.fernweh)
  })

  it('unbrauchbare Zeitangaben werfen nicht, sondern fallen auf den Standard zurück', () => {
    expect(chooseMusic(eingabe({ startIso: 'kaputt', endIso: 'auch kaputt' }))).toBe(
      AUTO_MUSIC.aufbruch,
    )
    expect(chooseMusic(eingabe({ zone: 'Nirgendwo/Unbekannt' }))).toBe(AUTO_MUSIC.aufbruch)
  })

  it('ohne Segmente bleibt es beim Standard, statt zu stolpern', () => {
    expect(chooseMusic(eingabe({ segs: [] }))).toBe(AUTO_MUSIC.aufbruch)
  })

  it('vergibt nur Dateien aus der kuratierten Bibliothek', () => {
    const alle = new Set(Object.values(AUTO_MUSIC))
    for (const e of [
      eingabe(),
      eingabe({ weather: [kf(0, 'rain')] }),
      eingabe({ segs: [segment('ferry')] }),
      eingabe({ startIso: '2026-07-04T23:00:00+02:00', endIso: '2026-07-05T02:00:00+02:00' }),
    ]) {
      expect(alle.has(chooseMusic(e) as (typeof AUTO_MUSIC)[keyof typeof AUTO_MUSIC])).toBe(true)
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
  await u.app.processing.get(id)
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
      expect(Object.values(AUTO_MUSIC)).toContain(edits.audio?.[0]?.file)

      // Und die Tour klingt wirklich: /audio/sfx-Spur über die ganze Strecke.
      const tour = JSON.parse((await u.storage.read(id, 'tour.json')).toString()) as {
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
      await u.app.processing.get(id)

      const neu = await u.app.inject({
        method: 'POST',
        url: `/api/tours/${id}/reprocess`,
        cookies: u.cookies,
      })
      expect(neu.statusCode).toBe(202)
      await u.app.processing.get(id)

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
      await u.app.processing.get(id)

      const edits = await leseEdits(u, id)
      expect(edits.audio).toHaveLength(1)
      expect(edits.audio?.[0]?.file).toBe('mus-tropen.mp3')
    } finally {
      await u.app.close()
    }
  })
})
