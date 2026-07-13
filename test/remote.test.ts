// Remote-Adapter (src/remote.ts): Server-JSON `luhambo/tour@1` → cfg-Form des
// Players. Der Adapter ist die Naht zwischen Backend und Player — hier bricht
// bei Schema-Drift zuerst etwas, deshalb eigene Tests.

import { describe, expect, it } from 'vitest'
import { adaptiereTour, createTimeAt, RemoteTourFehler, type TourJsonAntwort } from '../src/remote'

function beispielTour(): TourJsonAntwort {
  return {
    schema: 'luhambo/tour@1',
    id: 't_abc123',
    no: 'N°07',
    brandTitle: 'Lauterbrunnen → Grindelwald',
    kicker: 'Aufgezeichnet am 4. Juli 2026',
    titleHtml: 'Lauterbrunnen<br />→ Grindelwald',
    stops: ['Lauterbrunnen', 'Grindelwald'],
    finaleTitle: 'Grindelwald',
    description: null,
    time: { start: '2026-07-04T08:12:31+02:00', end: '2026-07-04T14:03:10+02:00', zone: 'Europe/Zurich' },
    segments: [
      { mode: 'walk', label: 'Zu Fuß', pts: [[7.9086, 46.5934, 800], [7.9105, 46.59, 830]] },
    ],
    media: [
      {
        id: 'm1',
        type: 'photo',
        src: '/api/media/t_abc123/m1.jpg',
        title: 'Foto · 09:01',
        caption: '',
        anchor: [7.9105, 46.59],
        takenAt: '2026-07-04T09:01:12+02:00',
      },
    ],
    stats: { km: 21.4, gainM: 1250 },
  }
}

describe('adaptiereTour', () => {
  it('mappt das Server-JSON auf die cfg-Form (media → photos)', () => {
    const cfg = adaptiereTour(beispielTour())
    expect(cfg.brandTitle).toBe('Lauterbrunnen → Grindelwald')
    expect(cfg.photos).toHaveLength(1)
    expect(cfg.photos[0]?.src).toBe('/api/media/t_abc123/m1.jpg')
    expect(cfg.photos[0]?.anchor).toEqual([7.9105, 46.59])
    expect(cfg.photos[0]?.type).toBe('photo')
    expect(cfg.segments[0]?.mode).toBe('walk')
    // Kein Server-Wetter → Feld bleibt weg (Client-Auto-Wetter greift als Fallback)
    expect(cfg.weather).toBeUndefined()
  })

  it('rechnet Wetter-Keyframes von f auf km um (Player-Format)', () => {
    const tour = beispielTour()
    tour.weather = [
      { f: 0, mode: 'clouds', k: 0.5 },
      { f: 0.5, mode: 'rain', k: 0.8, source: 'photo' },
    ]
    const cfg = adaptiereTour(tour)
    expect(cfg.weather).toEqual([
      { km: 0, mode: 'clouds', k: 0.5 },
      { km: 10.7, mode: 'rain', k: 0.8 },
    ])
  })

  it('reicht Videos mit Poster und Dauer durch (M4)', () => {
    const tour = beispielTour()
    tour.media.push({
      id: 'm2',
      type: 'video',
      src: '/api/media/t_abc123/m2.web.mp4',
      poster: '/api/media/t_abc123/m2.poster.jpg',
      durationS: 23.4,
      title: 'Video · 10:14',
      caption: '',
      anchor: [7.938, 46.5812],
      takenAt: '2026-07-04T10:14:03+02:00',
    })
    const cfg = adaptiereTour(tour)
    expect(cfg.photos).toHaveLength(2)
    const video = cfg.photos.find((p) => p.type === 'video')
    expect(video?.src).toBe('/api/media/t_abc123/m2.web.mp4')
    expect(video?.poster).toBe('/api/media/t_abc123/m2.poster.jpg')
    expect(video?.durationS).toBe(23.4)
    // Fotos ohne poster/durationS bleiben schlank (kein undefined-Feld)
    const foto = cfg.photos.find((p) => p.type === 'photo')
    expect(foto && 'poster' in foto).toBe(false)
  })

  it('überspringt unplatzierte Medien (anchor null, M6)', () => {
    const tour = beispielTour()
    tour.media.push({
      id: 'm2',
      type: 'photo',
      src: '/api/media/t_abc123/m2.jpg',
      title: 'Foto · 11:00',
      caption: '',
      anchor: null,
      placement: 'unplatziert',
      takenAt: '2026-07-04T11:00:00+02:00',
    })
    const cfg = adaptiereTour(tour)
    // nur das platzierte m1 landet im Player; m2 hat keinen Track-Anker
    expect(cfg.photos).toHaveLength(1)
    expect(cfg.photos[0]?.src).toBe('/api/media/t_abc123/m1.jpg')
  })

  it('wirft bei laufender Verarbeitung einen sprechenden Fehler', () => {
    const inArbeit = { id: 't_abc123', status: 'verarbeitung' } as unknown as TourJsonAntwort
    expect(() => adaptiereTour(inArbeit)).toThrow(RemoteTourFehler)
    expect(() => adaptiereTour(inArbeit)).toThrow(/verarbeitet/)
  })

  it('wirft bei fehlgeschlagener Verarbeitung mit Server-Fehlertext', () => {
    const kaputt = { id: 't_abc123', status: 'fehler', fehler: 'ffmpeg explodiert' } as unknown as TourJsonAntwort
    expect(() => adaptiereTour(kaputt)).toThrow(/ffmpeg explodiert/)
  })
})

describe('createTimeAt', () => {
  const T0 = Date.parse('2026-07-04T06:00:00Z')
  const T1 = Date.parse('2026-07-04T10:00:00Z')

  it('fällt ohne Timeline auf die lineare Pseudo-Zeit zurück', () => {
    const timeAt = createTimeAt(undefined, T0, T1)
    expect(timeAt(0)).toBe(T0)
    expect(timeAt(0.5)).toBe(T0 + 2 * 3600_000)
    expect(timeAt(1)).toBe(T1)
    // außerhalb geklemmt (Scrub-Überschwinger)
    expect(timeAt(-0.2)).toBe(T0)
    expect(timeAt(1.3)).toBe(T1)
  })

  it('interpoliert stückweise linear zwischen den Stützstellen', () => {
    // erste Streckenhälfte in 1 h, zweite in 3 h (z. B. Anstieg)
    const timeAt = createTimeAt(
      [
        { f: 0, t: '2026-07-04T06:00:00Z' },
        { f: 0.5, t: '2026-07-04T07:00:00Z' },
        { f: 1, t: '2026-07-04T10:00:00Z' },
      ],
      T0,
      T1,
    )
    expect(timeAt(0.25)).toBe(T0 + 30 * 60_000)
    expect(timeAt(0.5)).toBe(T0 + 3600_000)
    expect(timeAt(0.75)).toBe(T0 + (1 + 1.5) * 3600_000)
    expect(timeAt(1)).toBe(T1)
  })

  it('übersteht senkrechte Sprünge (komprimierte Pause auf gleichem f)', () => {
    const timeAt = createTimeAt(
      [
        { f: 0, t: '2026-07-04T06:00:00Z' },
        { f: 0.5, t: '2026-07-04T07:00:00Z' },
        { f: 0.5, t: '2026-07-04T07:02:00Z' },
        { f: 1, t: '2026-07-04T08:02:00Z' },
      ],
      T0,
      T1,
    )
    expect(timeAt(0.49)).toBeLessThanOrEqual(Date.parse('2026-07-04T07:00:00Z'))
    expect(timeAt(0.51)).toBeGreaterThanOrEqual(Date.parse('2026-07-04T07:02:00Z'))
    expect(timeAt(1)).toBe(Date.parse('2026-07-04T08:02:00Z'))
  })

  it('ignoriert kaputte Stützstellen und sortiert unsortierte', () => {
    // eine unparsebare Stützstelle → fliegt raus, Rest trägt
    const timeAt = createTimeAt(
      [
        { f: 1, t: '2026-07-04T10:00:00Z' },
        { f: 0.5, t: 'kaputt' },
        { f: 0, t: '2026-07-04T06:00:00Z' },
      ],
      T0,
      T1,
    )
    expect(timeAt(0.5)).toBe(T0 + 2 * 3600_000)
    // nur eine brauchbare Stützstelle → linearer Rückfall
    const linear = createTimeAt([{ f: 0, t: '2026-07-04T06:00:00Z' }], T0, T1)
    expect(linear(0.5)).toBe(T0 + 2 * 3600_000)
  })
})
