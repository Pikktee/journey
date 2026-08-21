// Remote-Adapter (src/remote.ts): Server-JSON `maptale/tour@2` → cfg-Form des
// Players. Der Adapter ist die Naht zwischen Backend und Player — hier bricht
// bei Schema-Drift zuerst etwas, deshalb eigene Tests.

import { describe, expect, it } from 'vitest'
import { STUDIO_GAIN_DEFAULT } from '../src/audiotracks.js'
import { adaptTour, createTimeAt, RemoteTourError, type TourJsonAntwort } from '../src/remote'

function beispielTour(): TourJsonAntwort {
  return {
    schema: 'maptale/tour@2',
    id: 't_abc123',
    no: 'N°07',
    brandTitle: 'Lauterbrunnen → Grindelwald',
    kicker: 'Aufgezeichnet am 4. Juli 2026',
    titleHtml: 'Lauterbrunnen<br />→ Grindelwald',
    stops: ['Lauterbrunnen', 'Grindelwald'],
    finaleTitle: 'Grindelwald',
    description: null,
    time: {
      start: '2026-07-04T08:12:31+02:00',
      end: '2026-07-04T14:03:10+02:00',
      zone: 'Europe/Zurich',
    },
    segments: [
      {
        mode: 'walk',
        label: 'Zu Fuß',
        pts: [
          [7.9086, 46.5934, 800],
          [7.9105, 46.59, 830],
        ],
      },
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
    const cfg = adaptTour(beispielTour())
    expect(cfg.brandTitle).toBe('Lauterbrunnen → Grindelwald')
    expect(cfg.showFinale).toBe(false)
    expect(cfg.photos).toHaveLength(1)
    expect(cfg.photos[0]?.src).toBe('/api/media/t_abc123/m1.jpg')
    expect(cfg.photos[0]?.anchor).toEqual([7.9105, 46.59])
    expect(cfg.photos[0]?.type).toBe('photo')
    expect(cfg.segments[0]?.mode).toBe('walk')
    // Kein Server-Wetter → Feld bleibt weg (Client-Auto-Wetter greift als Fallback)
    expect(cfg.weatherF).toBeUndefined()
  })

  it('reicht showFinale nur bei true durch', () => {
    const aus = adaptTour(beispielTour())
    expect(aus.showFinale).toBe(false)
    const an = beispielTour()
    an.showFinale = true
    expect(adaptTour(an).showFinale).toBe(true)
  })

  // Bis E11 rechnete der Adapter hier `km = f · Gesamt-km`, und main.ts machte
  // daraus wieder Meter — zusammen war das der Rückfall `f × total`. Die
  // Übersetzung liegt jetzt an EINER Stelle (src/route-anchors.ts), also geht
  // das f roh durch.
  it('reicht Wetter-Keyframes roh durch (f-verankert)', () => {
    const tour = beispielTour()
    tour.weather = [
      { f: 0, mode: 'clouds', k: 0.5 },
      { f: 0.5, mode: 'rain', k: 0.8, source: 'photo' },
    ]
    const cfg = adaptTour(tour)
    expect(cfg.weatherF).toEqual([
      { f: 0, mode: 'clouds', k: 0.5 },
      { f: 0.5, mode: 'rain', k: 0.8 },
    ])
  })

  it('wirft kaputte Wetter-f weg', () => {
    const tour = beispielTour()
    tour.weather = [
      { f: Number.NaN, mode: 'rain', k: 1 },
      { f: 0.5, mode: 'clouds', k: 0.5 },
    ]
    expect(adaptTour(tour).weatherF).toEqual([{ f: 0.5, mode: 'clouds', k: 0.5 }])
  })

  it('reicht das f je Wegpunkt durch (E11)', () => {
    const tour = beispielTour()
    tour.segments[0]!.f = [0, 0.4]
    expect(adaptTour(tour).segments[0]?.f).toEqual([0, 0.4])
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
    const cfg = adaptTour(tour)
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
      placement: 'unplaced',
      takenAt: '2026-07-04T11:00:00+02:00',
    })
    const cfg = adaptTour(tour)
    // nur das platzierte m1 landet im Player; m2 hat keinen Track-Anker
    expect(cfg.photos).toHaveLength(1)
    expect(cfg.photos[0]?.src).toBe('/api/media/t_abc123/m1.jpg')
  })

  it('reicht Anzeige-Optionen der Medien durch (display, Kreativbaukasten)', () => {
    const tour = beispielTour()
    tour.media[0]!.display = { holdS: 8, kenBurns: false }
    const cfg = adaptTour(tour)
    expect(cfg.photos[0]?.display).toEqual({ holdS: 8, kenBurns: false })
  })

  it('lässt Fotos ohne display schlank (kein undefined-Feld)', () => {
    const cfg = adaptTour(beispielTour())
    const foto = cfg.photos[0]
    expect(foto && 'display' in foto).toBe(false)
  })

  it('reicht Kamera-Keyframes und Audio-Spuren roh durch (f-basiert)', () => {
    const tour = beispielTour()
    tour.camera = [
      { f: 0.2, preset: 'near' },
      { f: 0.7, preset: 'far' },
    ]
    tour.audio = [
      { type: 'music', src: '/api/media/t_abc123/a1.mp3', f0: 0.1, f1: 0.9, gain: 0.8 },
      { type: 'sfx', src: '/api/media/t_abc123/knall.mp3', f0: 0.5, f1: 0.5 },
    ]
    const cfg = adaptTour(tour)
    expect(cfg.camera).toEqual(tour.camera)
    // Audio geht roh durch — mit EINER Ergänzung: fehlendes `gain` wird auf die
    // Studio-Vorgabe gesetzt. Bestandstouren wurden ohne das Feld gerendert und
    // klängen im Player sonst mit 1.0, also lauter als im Schnitt.
    expect(cfg.audio).toEqual([
      { type: 'music', src: '/api/media/t_abc123/a1.mp3', f0: 0.1, f1: 0.9, gain: 0.8 },
      {
        type: 'sfx',
        src: '/api/media/t_abc123/knall.mp3',
        f0: 0.5,
        f1: 0.5,
        gain: STUDIO_GAIN_DEFAULT,
      },
    ])
    // Und der Master steht dann auf 1: `gain` ist bei aufgezeichneten Touren
    // absolut (die 0.22 der kuratierten Touren wären ein zweiter Faktor darüber).
    expect(cfg.audioPegel).toBe(1)
  })

  it('filtert Kamera-/Audio-Einträge mit kaputten f-Werten (Number.isFinite)', () => {
    const tour = beispielTour()
    tour.camera = [
      { f: Number.NaN, preset: 'far' },
      { f: 0.4, preset: 'mid' },
    ]
    tour.audio = [{ type: 'music', src: '/api/media/t_abc123/a1.mp3', f0: 0, f1: Number.NaN }]
    const cfg = adaptTour(tour)
    expect(cfg.camera).toEqual([{ f: 0.4, preset: 'mid' }])
    // ALLE Audio-Einträge kaputt → Feld bleibt ganz weg („nur bei Länge setzen")
    expect(cfg.audio).toBeUndefined()
  })

  it('filtert Audio-Spuren mit nicht-endlichem gain (liefe sonst bis in el.volume)', () => {
    const tour = beispielTour()
    tour.audio = [
      { type: 'music', src: '/api/media/t_abc123/kaputt.mp3', f0: 0.1, f1: 0.9, gain: Number.NaN },
      { type: 'music', src: '/api/media/t_abc123/ok.mp3', f0: 0.2, f1: 0.8, gain: 0.5 },
      { type: 'sfx', src: '/api/media/t_abc123/ohne-gain.mp3', f0: 0.5, f1: 0.5 },
    ]
    const cfg = adaptTour(tour)
    expect(cfg.audio).toEqual([
      { type: 'music', src: '/api/media/t_abc123/ok.mp3', f0: 0.2, f1: 0.8, gain: 0.5 },
      {
        type: 'sfx',
        src: '/api/media/t_abc123/ohne-gain.mp3',
        f0: 0.5,
        f1: 0.5,
        gain: STUDIO_GAIN_DEFAULT,
      },
    ])
  })

  it('lässt camera/audio weg, wenn der Server sie nicht liefert', () => {
    const cfg = adaptTour(beispielTour())
    expect(cfg.camera).toBeUndefined()
    expect(cfg.audio).toBeUndefined()
  })

  it('wirft bei laufender Verarbeitung einen sprechenden Fehler', () => {
    const inArbeit = { id: 't_abc123', status: 'processing' } as unknown as TourJsonAntwort
    expect(() => adaptTour(inArbeit)).toThrow(RemoteTourError)
    expect(() => adaptTour(inArbeit)).toThrow(/verarbeitet/)
  })

  it('wirft bei fehlgeschlagener Verarbeitung mit Server-Fehlertext', () => {
    const kaputt = {
      id: 't_abc123',
      status: 'fehler',
      error: 'ffmpeg explodiert',
    } as unknown as TourJsonAntwort
    expect(() => adaptTour(kaputt)).toThrow(/ffmpeg explodiert/)
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
