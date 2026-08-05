// Video-Aufbereitung (M4): reine Entscheidungslogik + Orchestrierung mit einem
// FakeVideoWerkzeug (kein ffmpeg). Der In-Memory-Speicher-Adapter erfüllt das
// schmale VideoSpeicher-Interface; die Temp-Datei-Choreografie läuft gegen das
// echte tmp-Verzeichnis, ohne dass ein Codec berührt wird.

import { describe, expect, it } from 'vitest'
import {
  bereiteVideosAuf,
  brauchtTranskodierung,
  FakeVideoWerkzeug,
  hatFaststart,
  klemmeSchnitt,
  mussWebKonvertiert,
  posterDateiname,
  posterZeitpunkt,
  webVideoDateiname,
  type VideoInfo,
  type VideoSpeicher,
} from '../src/pipeline/video.js'

/** Ein Atom aus Typ und Nutzlast-Länge (der 8-Byte-Kopf zählt mit). */
function atom(typ: string, nutzlast = 0): Buffer {
  const kopf = Buffer.alloc(8)
  kopf.writeUInt32BE(8 + nutzlast, 0)
  kopf.write(typ, 4, 'latin1')
  return Buffer.concat([kopf, Buffer.alloc(nutzlast)])
}

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
    async loesche(relPfad) {
      dateien.delete(relPfad)
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

describe('hatFaststart', () => {
  it('erkennt den Index vorn (so schreibt ffmpeg mit +faststart)', () => {
    expect(hatFaststart(Buffer.concat([atom('ftyp', 16), atom('moov', 200), atom('mdat', 4000)]))).toBe(true)
  })

  it('erkennt den Index hinten — so schreibt Android jede Aufnahme', () => {
    // Genau die Form, die vom Pixel hochgeladen wird: ftyp, ein leerer
    // free-Platzhalter, die Mediendaten, und der Index erst dahinter.
    expect(hatFaststart(Buffer.concat([atom('ftyp', 16), atom('free', 3184), atom('mdat', 4000)]))).toBe(false)
  })

  it('gibt bei einem 64-Bit-mdat auf, statt in die Nutzlast zu laufen', () => {
    // Länge 1 heißt: die echte Größe steht in den 8 Byte dahinter. Große
    // Aufnahmen (> 4 GB) nutzen das; der Index kann dort nur hinten liegen.
    const grossesMdat = Buffer.alloc(16)
    grossesMdat.writeUInt32BE(1, 0)
    grossesMdat.write('mdat', 4, 'latin1')
    grossesMdat.writeBigUInt64BE(8n * 1024n * 1024n * 1024n, 8)
    expect(hatFaststart(Buffer.concat([atom('ftyp', 16), grossesMdat]))).toBe(false)
  })

  it('sagt bei unlesbarem Kopf „nein" — umschreiben ist der harmlose Ausgang', () => {
    expect(hatFaststart(Buffer.alloc(0))).toBe(false)
    expect(hatFaststart(Buffer.from('kein mp4'))).toBe(false)
    // Längenfeld 0 („bis Dateiende"): danach kommt nichts, worauf zu springen wäre
    const endlos = Buffer.alloc(8)
    endlos.write('mdat', 4, 'latin1')
    expect(hatFaststart(endlos)).toBe(false)
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
  it('erzeugt nur ein Poster, wenn das Video web-tauglich ist UND den Index vorn hat', async () => {
    const sp = memSpeicher()
    sp.dateien.set('media/m1.mp4', Buffer.concat([atom('ftyp', 16), atom('moov', 64), atom('mdat', 512)]))
    const werkzeug = new FakeVideoWerkzeug(info({ dauerS: 8.4 }))

    const meta = await bereiteVideosAuf({
      medien: [{ id: 'm1', originalDatei: 'm1.mp4' }],
      speicher: sp,
      werkzeug,
    })

    expect(werkzeug.aufrufe).toEqual(['probe', 'poster']) // weder Transcode noch Remux
    expect(meta.get('m1')).toEqual({ dauerS: 8.4, videoDatei: 'm1.mp4', posterDatei: 'm1.poster.jpg', quellDauerS: 8.4 })
    expect(sp.dateien.has('media/m1.poster.jpg')).toBe(true)
    expect(sp.dateien.has('media/m1.web.mp4')).toBe(false)
    // Hier IST das Original die Auslieferungsdatei — es darf nicht weg
    expect(sp.dateien.has('media/m1.mp4')).toBe(true)
  })

  it('schreibt eine web-taugliche .mp4 mit hinten liegendem Index um — ohne neu zu codieren', async () => {
    // Der Alltagsfall der App: H.264/AAC in .mp4, aber vom MediaMuxer mit
    // `moov` am Ende geschrieben. Ohne diesen Schritt lud der Player erst die
    // ganze Datei durch, bevor das erste Bild kam.
    const sp = memSpeicher()
    sp.dateien.set('media/m1.mp4', Buffer.concat([atom('ftyp', 16), atom('mdat', 512), atom('moov', 64)]))
    const werkzeug = new FakeVideoWerkzeug(info({ dauerS: 12.7 }))

    const meta = await bereiteVideosAuf({
      medien: [{ id: 'm1', originalDatei: 'm1.mp4' }],
      speicher: sp,
      werkzeug,
    })

    expect(werkzeug.aufrufe).toEqual(['probe', 'poster', 'remux']) // kein Transcode!
    expect(meta.get('m1')?.videoDatei).toBe('m1.web.mp4')
    expect(sp.dateien.get('media/m1.web.mp4')?.toString()).toBe('FAKE-FASTSTART-MP4')
    // Dieselben Bilder und Töne, nur der Index sitzt vorn: das Original wäre
    // eine zweite Kopie derselben Aufnahme, die nie jemand ausliefert
    expect(sp.dateien.has('media/m1.mp4')).toBe(false)
  })

  it('remuxt nicht doppelt: liegt die web.mp4 schon, bleibt es bei der Probe', async () => {
    const sp = memSpeicher()
    sp.dateien.set('media/m1.mp4', Buffer.concat([atom('ftyp', 16), atom('mdat', 512), atom('moov', 64)]))
    sp.dateien.set('media/m1.poster.jpg', Buffer.from('ALT-POSTER'))
    sp.dateien.set('media/m1.web.mp4', Buffer.from('ALT-WEB'))
    const werkzeug = new FakeVideoWerkzeug(info())

    const meta = await bereiteVideosAuf({
      medien: [{ id: 'm1', originalDatei: 'm1.mp4' }],
      speicher: sp,
      werkzeug,
    })

    expect(werkzeug.aufrufe).toEqual(['probe'])
    expect(meta.get('m1')?.videoDatei).toBe('m1.web.mp4')
    expect(sp.dateien.get('media/m1.web.mp4')?.toString()).toBe('ALT-WEB')
    // Bestandsaufräumen: die fertige web.mp4 macht das Original entbehrlich,
    // auch wenn in diesem Durchlauf nichts neu erzeugt wurde
    expect(sp.dateien.has('media/m1.mp4')).toBe(false)
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
    expect(sp.dateien.has('media/m1.mov')).toBe(false) // Original verworfen
  })

  it('nimmt beim Wiedereintritt die web.mp4 als Quelle — das Original ist längst weg', async () => {
    // Der Normalfall bei jedem Re-Render: verworfenes Original, fertige
    // Auslieferungsdatei. Ohne diesen Weg fiele die Aufbereitung auf einen
    // Lesefehler und das Video verlöre Poster und Dauer im tour.json.
    const sp = memSpeicher()
    sp.dateien.set('media/m1.web.mp4', Buffer.from('WEB-MP4'))
    sp.dateien.set('media/m1.poster.jpg', Buffer.from('POSTER'))
    const werkzeug = new FakeVideoWerkzeug(info({ codecVideo: 'h264', dauerS: 9.5 }))

    const meta = await bereiteVideosAuf({
      medien: [{ id: 'm1', originalDatei: 'm1.mov' }],
      speicher: sp,
      werkzeug,
    })

    expect(werkzeug.aufrufe).toEqual(['probe']) // nichts neu erzeugt
    expect(meta.get('m1')).toEqual({ dauerS: 9.5, videoDatei: 'm1.web.mp4', posterDatei: 'm1.poster.jpg', quellDauerS: 9.5 })
  })

  it('erzeugt beim Wiedereintritt ein fehlendes Poster aus der web.mp4', async () => {
    const sp = memSpeicher()
    sp.dateien.set('media/m1.web.mp4', Buffer.from('WEB-MP4'))
    const werkzeug = new FakeVideoWerkzeug(info({ dauerS: 4 }))

    const meta = await bereiteVideosAuf({
      medien: [{ id: 'm1', originalDatei: 'm1.mov' }],
      speicher: sp,
      werkzeug,
    })

    expect(werkzeug.aufrufe).toEqual(['probe', 'poster'])
    expect(sp.dateien.has('media/m1.poster.jpg')).toBe(true)
    expect(meta.get('m1')?.videoDatei).toBe('m1.web.mp4')
  })

  it('meldet ein Video, von dem weder Original noch web.mp4 da ist', async () => {
    const sp = memSpeicher()
    const nachrichten: string[] = []

    const meta = await bereiteVideosAuf({
      medien: [{ id: 'm1', originalDatei: 'm1.mov' }],
      speicher: sp,
      werkzeug: new FakeVideoWerkzeug(info()),
      protokoll: (n) => nachrichten.push(n),
    })

    expect(meta.has('m1')).toBe(false)
    expect(nachrichten[0]).toContain('Videodatei fehlt')
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
    expect(sp.dateien.has('media/m1.mov')).toBe(false) // Original verworfen
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

// — Video-Schnitt (Etappe 4, docs §2F) —

describe('klemmeSchnitt', () => {
  it('hat an BEIDEN Kanten das Material als Anschlag', () => {
    // Trimmen legt frei, was da ist, und erfindet nichts.
    expect(klemmeSchnitt({ vonS: -5, bisS: 100 }, 30)).toBeNull() // = ganze Datei
    expect(klemmeSchnitt({ vonS: 2, bisS: 100 }, 30)).toEqual({ vonS: 2, bisS: 30 })
    expect(klemmeSchnitt({ vonS: 50, bisS: 60 }, 30)).toBeNull() // ganz hinter dem Ende
  })

  it('ohne Ende läuft der Schnitt bis zum Dateiende', () => {
    expect(klemmeSchnitt({ vonS: 4 }, 30)).toEqual({ vonS: 4, bisS: 30 })
  })

  it('nimmt den Vollschnitt als „kein Schnitt" — er erzwänge einen Transcode ohne Wirkung', () => {
    expect(klemmeSchnitt({ vonS: 0, bisS: 30 }, 30)).toBeNull()
    expect(klemmeSchnitt(undefined, 30)).toBeNull()
  })

  it('lehnt eine Spanne ohne Inhalt ab', () => {
    expect(klemmeSchnitt({ vonS: 10, bisS: 10.01 }, 30)).toBeNull()
    expect(klemmeSchnitt({ vonS: 10, bisS: 5 }, 30)).toBeNull()
  })
})

describe('bereiteVideosAuf mit Schnitt', () => {
  const ganzesVideo = (): ReturnType<typeof memSpeicher> => {
    const sp = memSpeicher()
    sp.dateien.set('media/m1.mp4', Buffer.concat([atom('ftyp', 16), atom('moov', 64), atom('mdat', 512)]))
    return sp
  }

  it('schneidet IMMER per Transcode — nie per Stream-Copy', async () => {
    // Ein `-c copy` schneidet nur an Keyframes und träfe den Punkt um Sekunden.
    const sp = ganzesVideo()
    const werkzeug = new FakeVideoWerkzeug(info({ dauerS: 34 }))

    const meta = await bereiteVideosAuf({
      medien: [{ id: 'm1', originalDatei: 'm1.mp4', schnitt: { vonS: 6, bisS: 28 } }],
      speicher: sp,
      werkzeug,
    })

    expect(werkzeug.aufrufe).toContain('schneide:6-28')
    expect(werkzeug.aufrufe).not.toContain('remux')
    expect(meta.get('m1')?.videoDatei).toBe('m1.cut.mp4')
    expect(meta.get('m1')?.dauerS).toBe(22) // die getrimmte Länge …
    expect(meta.get('m1')?.quellDauerS).toBe(34) // … und der Anschlag fürs Studio
  })

  it('lässt das Material stehen — der Schnitt ist ein Edit, kein Verbrauch', async () => {
    const sp = ganzesVideo()
    await bereiteVideosAuf({
      medien: [{ id: 'm1', originalDatei: 'm1.mp4', schnitt: { vonS: 6, bisS: 28 } }],
      speicher: sp,
      werkzeug: new FakeVideoWerkzeug(info({ dauerS: 34 })),
    })
    // Ohne die Quelle wäre „Trim zurücknehmen" ein Datenverlust
    expect(sp.dateien.has('media/m1.mp4')).toBe(true)
    expect(sp.dateien.get('media/m1.cut.mp4')?.toString()).toBe('FAKE-CUT-MP4')
  })

  it('zieht das Poster mit — sonst zeigt es einen Frame, den es nicht mehr gibt', async () => {
    const sp = ganzesVideo()
    sp.dateien.set('media/m1.poster.jpg', Buffer.from('ALTES-POSTER'))
    const werkzeug = new FakeVideoWerkzeug(info({ dauerS: 34 }))

    await bereiteVideosAuf({
      medien: [{ id: 'm1', originalDatei: 'm1.mp4', schnitt: { vonS: 6, bisS: 28 } }],
      speicher: sp,
      werkzeug,
    })

    expect(werkzeug.aufrufe).toContain('poster')
    expect(sp.dateien.get('media/m1.poster.jpg')?.toString()).toBe('FAKE-POSTER-JPEG')
  })

  it('nimmt den Schnitt zurück, wenn er aus dem Overlay verschwindet', async () => {
    const sp = ganzesVideo()
    sp.dateien.set('media/m1.cut.mp4', Buffer.from('ALTER-SCHNITT'))
    const werkzeug = new FakeVideoWerkzeug(info({ dauerS: 34 }))

    const meta = await bereiteVideosAuf({
      medien: [{ id: 'm1', originalDatei: 'm1.mp4' }],
      speicher: sp,
      werkzeug,
    })

    expect(sp.dateien.has('media/m1.cut.mp4')).toBe(false)
    expect(meta.get('m1')?.videoDatei).toBe('m1.mp4')
    expect(meta.get('m1')?.dauerS).toBe(34)
    expect(werkzeug.aufrufe).toContain('poster') // Poster wieder vom ganzen Video
  })

  it('schneidet auch aus der web.mp4, wenn das Original längst verworfen ist', async () => {
    const sp = memSpeicher()
    sp.dateien.set('media/m1.web.mp4', Buffer.from('WEB-MP4'))
    const werkzeug = new FakeVideoWerkzeug(info({ dauerS: 20 }))

    const meta = await bereiteVideosAuf({
      medien: [{ id: 'm1', originalDatei: 'm1.mov', schnitt: { vonS: 3 } }],
      speicher: sp,
      werkzeug,
    })

    expect(meta.get('m1')?.videoDatei).toBe('m1.cut.mp4')
    expect(meta.get('m1')?.dauerS).toBe(17)
    expect(sp.dateien.has('media/m1.web.mp4')).toBe(true) // Master bleibt
  })

  it('ignoriert einen Schnitt, der das ganze Material meint', async () => {
    const sp = ganzesVideo()
    const werkzeug = new FakeVideoWerkzeug(info({ dauerS: 34 }))

    const meta = await bereiteVideosAuf({
      medien: [{ id: 'm1', originalDatei: 'm1.mp4', schnitt: { vonS: 0, bisS: 34 } }],
      speicher: sp,
      werkzeug,
    })

    expect(werkzeug.aufrufe.some((a) => a.startsWith('schneide'))).toBe(false)
    expect(meta.get('m1')?.videoDatei).toBe('m1.mp4')
  })
})
