// Video-Aufbereitung (M4): reine Entscheidungslogik + Orchestrierung mit einem
// FakeVideoWerkzeug (kein ffmpeg). Der In-Memory-Speicher-Adapter erfüllt das
// schmale VideoSpeicher-Interface; die Temp-Datei-Choreografie läuft gegen das
// echte tmp-Verzeichnis, ohne dass ein Codec berührt wird.

import { describe, expect, it } from 'vitest'
import {
  bereiteVideosAuf,
  brauchtTranskodierung,
  FakeVideoWerkzeug,
  mussWebKonvertiert,
  posterDateiname,
  posterZeitpunkt,
  webVideoDateiname,
  type VideoInfo,
  type VideoSpeicher,
} from '../src/pipeline/video.js'

const info = (patch: Partial<VideoInfo> = {}): VideoInfo => ({
  codecVideo: 'h264',
  codecAudio: 'aac',
  dauerS: 8,
  breite: 1920,
  hoehe: 1080,
  ...patch,
})

function memSpeicher(): VideoSpeicher & { dateien: Map<string, Buffer> } {
  const dateien = new Map<string, Buffer>()
  return {
    dateien,
    async lese(relPfad) {
      const b = dateien.get(relPfad)
      if (!b) throw Object.assign(new Error('nicht gefunden'), { code: 'ENOENT' })
      return b
    },
    async schreibe(relPfad, inhalt) {
      dateien.set(relPfad, inhalt)
    },
    async info(relPfad) {
      const b = dateien.get(relPfad)
      return b ? { groesse: b.length } : null
    },
  }
}

describe('brauchtTranskodierung', () => {
  it('lässt web-taugliche Kombinationen durch', () => {
    expect(brauchtTranskodierung(info({ codecVideo: 'h264', codecAudio: 'aac' }))).toBe(false)
    expect(brauchtTranskodierung(info({ codecVideo: 'h264', codecAudio: 'mp3' }))).toBe(false)
    expect(brauchtTranskodierung(info({ codecVideo: 'h264', codecAudio: null }))).toBe(false)
  })

  it('erkennt nicht web-taugliche Codecs', () => {
    expect(brauchtTranskodierung(info({ codecVideo: 'hevc' }))).toBe(true) // neue iPhones/Pixel
    expect(brauchtTranskodierung(info({ codecVideo: 'vp9' }))).toBe(true)
    expect(brauchtTranskodierung(info({ codecVideo: 'h264', codecAudio: 'ac3' }))).toBe(true)
  })
})

describe('mussWebKonvertiert', () => {
  it('konvertiert auch web-taugliche Codecs im falschen Container (.mov → .mp4)', () => {
    // h264/aac in .mov ist zwar dekodierbar, wird aber als video/quicktime
    // ausgeliefert (Firefox spielt es nicht) → muss in eine .mp4
    expect(mussWebKonvertiert(info({ codecVideo: 'h264', codecAudio: 'aac' }), 'm1.mov')).toBe(true)
    expect(mussWebKonvertiert(info({ codecVideo: 'h264', codecAudio: 'aac' }), 'm1.MOV')).toBe(true)
  })

  it('lässt eine web-taugliche .mp4 unangetastet', () => {
    expect(mussWebKonvertiert(info({ codecVideo: 'h264', codecAudio: 'aac' }), 'm1.mp4')).toBe(false)
  })

  it('konvertiert nicht web-taugliche Codecs unabhängig vom Container', () => {
    expect(mussWebKonvertiert(info({ codecVideo: 'hevc' }), 'm1.mp4')).toBe(true)
  })
})

describe('abgeleitete Namen + Poster-Zeitpunkt', () => {
  it('vergibt Namen mit zwei Punkt-Segmenten (kollidieren nie mit Upload-Medien)', () => {
    expect(posterDateiname('m2')).toBe('m2.poster.jpg')
    expect(webVideoDateiname('m2')).toBe('m2.web.mp4')
  })

  it('nimmt den ersten Frame — den, mit dem die Wiedergabe beginnt', () => {
    // Der Player zeigt das Poster, bis die Wiedergabe einsetzt, und die beginnt
    // bei null. Jeder spätere Frame ließe das Bild im Moment des Umschaltens
    // sichtbar springen — unabhängig von der Länge des Videos.
    expect(posterZeitpunkt(0)).toBe(0)
    expect(posterZeitpunkt(-5)).toBe(0) // unbekannte Dauer
    expect(posterZeitpunkt(0.4)).toBe(0) // sehr kurzes Video
    expect(posterZeitpunkt(30)).toBe(0)
  })
})

describe('bereiteVideosAuf', () => {
  it('erzeugt nur ein Poster, wenn das Video schon web-tauglich ist', async () => {
    const sp = memSpeicher()
    sp.dateien.set('media/m1.mp4', Buffer.from('ORIGINAL'))
    const werkzeug = new FakeVideoWerkzeug(info({ dauerS: 8.4 }))

    const meta = await bereiteVideosAuf({
      medien: [{ id: 'm1', originalDatei: 'm1.mp4' }],
      speicher: sp,
      werkzeug,
    })

    expect(werkzeug.aufrufe).toEqual(['probe', 'poster']) // kein Transcode
    expect(meta.get('m1')).toEqual({ dauerS: 8.4, videoDatei: 'm1.mp4', posterDatei: 'm1.poster.jpg' })
    expect(sp.dateien.has('media/m1.poster.jpg')).toBe(true)
    expect(sp.dateien.has('media/m1.web.mp4')).toBe(false)
  })

  it('transkodiert HEVC und liefert danach die web.mp4 aus', async () => {
    const sp = memSpeicher()
    sp.dateien.set('media/m1.mov', Buffer.from('HEVC-ORIGINAL'))
    const werkzeug = new FakeVideoWerkzeug(info({ codecVideo: 'hevc', dauerS: 12 }))

    const meta = await bereiteVideosAuf({
      medien: [{ id: 'm1', originalDatei: 'm1.mov' }],
      speicher: sp,
      werkzeug,
    })

    expect(werkzeug.aufrufe).toEqual(['probe', 'poster', 'transkodiere'])
    expect(meta.get('m1')?.videoDatei).toBe('m1.web.mp4')
    expect(sp.dateien.has('media/m1.web.mp4')).toBe(true)
  })

  it('konvertiert h264 im .mov-Container in eine web.mp4 (nur wegen des Containers)', async () => {
    const sp = memSpeicher()
    sp.dateien.set('media/m1.mov', Buffer.from('H264-IN-MOV'))
    const werkzeug = new FakeVideoWerkzeug(info({ codecVideo: 'h264', codecAudio: 'aac' }))

    const meta = await bereiteVideosAuf({
      medien: [{ id: 'm1', originalDatei: 'm1.mov' }],
      speicher: sp,
      werkzeug,
    })

    expect(werkzeug.aufrufe).toContain('transkodiere')
    expect(meta.get('m1')?.videoDatei).toBe('m1.web.mp4')
  })

  it('ist idempotent: liegen Poster + Transcode schon, läuft nur die Probe', async () => {
    const sp = memSpeicher()
    sp.dateien.set('media/m1.mov', Buffer.from('HEVC-ORIGINAL'))
    sp.dateien.set('media/m1.poster.jpg', Buffer.from('ALT-POSTER'))
    sp.dateien.set('media/m1.web.mp4', Buffer.from('ALT-WEB'))
    const werkzeug = new FakeVideoWerkzeug(info({ codecVideo: 'hevc' }))

    const meta = await bereiteVideosAuf({
      medien: [{ id: 'm1', originalDatei: 'm1.mov' }],
      speicher: sp,
      werkzeug,
    })

    expect(werkzeug.aufrufe).toEqual(['probe']) // nichts neu erzeugt
    expect(meta.get('m1')?.videoDatei).toBe('m1.web.mp4') // Pfad trotzdem korrekt abgeleitet
    expect(sp.dateien.get('media/m1.poster.jpg')?.toString()).toBe('ALT-POSTER') // nicht überschrieben
  })

  it('überspringt ein kaputtes Video, ohne die Tour scheitern zu lassen', async () => {
    const sp = memSpeicher()
    sp.dateien.set('media/m1.mp4', Buffer.from('KAPUTT'))
    const werkzeug: FakeVideoWerkzeug = new FakeVideoWerkzeug(info())
    // probe wirft (z. B. keine Videospur)
    werkzeug.probe = async () => {
      throw new Error('Keine Videospur gefunden')
    }
    const nachrichten: string[] = []

    const meta = await bereiteVideosAuf({
      medien: [{ id: 'm1', originalDatei: 'm1.mp4' }],
      speicher: sp,
      werkzeug,
      protokoll: (n) => nachrichten.push(n),
    })

    expect(meta.has('m1')).toBe(false)
    expect(nachrichten[0]).toContain('Keine Videospur')
  })
})
