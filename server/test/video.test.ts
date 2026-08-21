// Video-Aufbereitung (M4): reine Entscheidungslogik + Orchestrierung mit einem
// FakeVideoWerkzeug (kein ffmpeg). Der In-Memory-Speicher-Adapter erfüllt das
// schmale VideoSpeicher-Interface; die Temp-Datei-Choreografie läuft gegen das
// echte tmp-Verzeichnis, ohne dass ein Codec berührt wird.

import { describe, expect, it } from 'vitest'
import {
  prepareVideos,
  needsTranscoding,
  FakeVideoTool,
  hasFaststart,
  clampCut,
  needsWebConversion,
  posterFilename,
  posterTime,
  webVideoFilename,
  type VideoInfo,
  type VideoStorage,
} from '../src/pipeline/video.js'

/** Ein Atom aus Typ und Nutzlast-Länge (der 8-Byte-Kopf zählt mit). */
function atom(typ: string, nutzlast = 0): Buffer {
  const kopf = Buffer.alloc(8)
  kopf.writeUInt32BE(8 + nutzlast, 0)
  kopf.write(typ, 4, 'latin1')
  return Buffer.concat([kopf, Buffer.alloc(nutzlast)])
}

const info = (patch: Partial<VideoInfo> = {}): VideoInfo => ({
  videoCodec: 'h264',
  audioCodec: 'aac',
  durationS: 8,
  width: 1920,
  height: 1080,
  ...patch,
})

function memSpeicher(): VideoStorage & { files: Map<string, Buffer> } {
  const files = new Map<string, Buffer>()
  return {
    files,
    async read(relPath) {
      const b = files.get(relPath)
      if (!b) throw Object.assign(new Error('nicht gefunden'), { code: 'ENOENT' })
      return b
    },
    async write(relPath, content) {
      files.set(relPath, content)
    },
    async info(relPath) {
      const b = files.get(relPath)
      return b ? { size: b.length } : null
    },
    async remove(relPath) {
      files.delete(relPath)
    },
  }
}

describe('brauchtTranskodierung', () => {
  it('lässt web-taugliche Kombinationen durch', () => {
    expect(needsTranscoding(info({ videoCodec: 'h264', audioCodec: 'aac' }))).toBe(false)
    expect(needsTranscoding(info({ videoCodec: 'h264', audioCodec: 'mp3' }))).toBe(false)
    expect(needsTranscoding(info({ videoCodec: 'h264', audioCodec: null }))).toBe(false)
  })

  it('erkennt nicht web-taugliche Codecs', () => {
    expect(needsTranscoding(info({ videoCodec: 'hevc' }))).toBe(true) // neue iPhones/Pixel
    expect(needsTranscoding(info({ videoCodec: 'vp9' }))).toBe(true)
    expect(needsTranscoding(info({ videoCodec: 'h264', audioCodec: 'ac3' }))).toBe(true)
  })
})

describe('mussWebKonvertiert', () => {
  it('konvertiert auch web-taugliche Codecs im falschen Container (.mov → .mp4)', () => {
    // h264/aac in .mov ist zwar dekodierbar, wird aber als video/quicktime
    // ausgeliefert (Firefox spielt es nicht) → muss in eine .mp4
    expect(needsWebConversion(info({ videoCodec: 'h264', audioCodec: 'aac' }), 'm1.mov')).toBe(true)
    expect(needsWebConversion(info({ videoCodec: 'h264', audioCodec: 'aac' }), 'm1.MOV')).toBe(true)
  })

  it('lässt eine web-taugliche .mp4 unangetastet', () => {
    expect(needsWebConversion(info({ videoCodec: 'h264', audioCodec: 'aac' }), 'm1.mp4')).toBe(
      false,
    )
  })

  it('konvertiert nicht web-taugliche Codecs unabhängig vom Container', () => {
    expect(needsWebConversion(info({ videoCodec: 'hevc' }), 'm1.mp4')).toBe(true)
  })
})

describe('hatFaststart', () => {
  it('erkennt den Index vorn (so schreibt ffmpeg mit +faststart)', () => {
    expect(
      hasFaststart(Buffer.concat([atom('ftyp', 16), atom('moov', 200), atom('mdat', 4000)])),
    ).toBe(true)
  })

  it('erkennt den Index hinten — so schreibt Android jede Aufnahme', () => {
    // Genau die Form, die vom Pixel hochgeladen wird: ftyp, ein leerer
    // free-Platzhalter, die Mediendaten, und der Index erst dahinter.
    expect(
      hasFaststart(Buffer.concat([atom('ftyp', 16), atom('free', 3184), atom('mdat', 4000)])),
    ).toBe(false)
  })

  it('gibt bei einem 64-Bit-mdat auf, statt in die Nutzlast zu laufen', () => {
    // Länge 1 heißt: die echte Größe steht in den 8 Byte dahinter. Große
    // Aufnahmen (> 4 GB) nutzen das; der Index kann dort nur hinten liegen.
    const grossesMdat = Buffer.alloc(16)
    grossesMdat.writeUInt32BE(1, 0)
    grossesMdat.write('mdat', 4, 'latin1')
    grossesMdat.writeBigUInt64BE(8n * 1024n * 1024n * 1024n, 8)
    expect(hasFaststart(Buffer.concat([atom('ftyp', 16), grossesMdat]))).toBe(false)
  })

  it('sagt bei unlesbarem Kopf „nein" — umschreiben ist der harmlose Ausgang', () => {
    expect(hasFaststart(Buffer.alloc(0))).toBe(false)
    expect(hasFaststart(Buffer.from('kein mp4'))).toBe(false)
    // Längenfeld 0 („bis Dateiende"): danach kommt nichts, worauf zu springen wäre
    const endlos = Buffer.alloc(8)
    endlos.write('mdat', 4, 'latin1')
    expect(hasFaststart(endlos)).toBe(false)
  })
})

describe('abgeleitete Namen + Poster-Zeitpunkt', () => {
  it('vergibt Namen mit zwei Punkt-Segmenten (kollidieren nie mit Upload-Medien)', () => {
    expect(posterFilename('m2')).toBe('m2.poster.jpg')
    expect(webVideoFilename('m2')).toBe('m2.web.mp4')
  })

  it('nimmt den ersten Frame — den, mit dem die Wiedergabe beginnt', () => {
    // Der Player zeigt das Poster, bis die Wiedergabe einsetzt, und die beginnt
    // bei null. Jeder spätere Frame ließe das Bild im Moment des Umschaltens
    // sichtbar springen — unabhängig von der Länge des Videos.
    expect(posterTime(0)).toBe(0)
    expect(posterTime(-5)).toBe(0) // unbekannte Dauer
    expect(posterTime(0.4)).toBe(0) // sehr kurzes Video
    expect(posterTime(30)).toBe(0)
  })
})

describe('prepareVideos', () => {
  it('erzeugt nur ein Poster, wenn das Video web-tauglich ist UND den Index vorn hat', async () => {
    const sp = memSpeicher()
    sp.files.set(
      'media/m1.mp4',
      Buffer.concat([atom('ftyp', 16), atom('moov', 64), atom('mdat', 512)]),
    )
    const tool = new FakeVideoTool(info({ durationS: 8.4 }))

    const meta = await prepareVideos({
      media: [{ id: 'm1', originalFile: 'm1.mp4' }],
      storage: sp,
      tool,
    })

    expect(tool.calls).toEqual(['probe', 'poster']) // weder Transcode noch Remux
    expect(meta.get('m1')).toEqual({
      durationS: 8.4,
      videoFile: 'm1.mp4',
      posterFile: 'm1.poster.jpg',
      sourceDurationS: 8.4,
    })
    expect(sp.files.has('media/m1.poster.jpg')).toBe(true)
    expect(sp.files.has('media/m1.web.mp4')).toBe(false)
    // Hier IST das Original die Auslieferungsdatei — es darf nicht weg
    expect(sp.files.has('media/m1.mp4')).toBe(true)
  })

  it('schreibt eine web-taugliche .mp4 mit hinten liegendem Index um — ohne neu zu codieren', async () => {
    // Der Alltagsfall der App: H.264/AAC in .mp4, aber vom MediaMuxer mit
    // `moov` am Ende geschrieben. Ohne diesen Schritt lud der Player erst die
    // ganze Datei durch, bevor das erste Bild kam.
    const sp = memSpeicher()
    sp.files.set(
      'media/m1.mp4',
      Buffer.concat([atom('ftyp', 16), atom('mdat', 512), atom('moov', 64)]),
    )
    const tool = new FakeVideoTool(info({ durationS: 12.7 }))

    const meta = await prepareVideos({
      media: [{ id: 'm1', originalFile: 'm1.mp4' }],
      storage: sp,
      tool,
    })

    expect(tool.calls).toEqual(['probe', 'poster', 'remux']) // kein Transcode!
    expect(meta.get('m1')?.videoFile).toBe('m1.web.mp4')
    expect(sp.files.get('media/m1.web.mp4')?.toString()).toBe('FAKE-FASTSTART-MP4')
    // Dieselben Bilder und Töne, nur der Index sitzt vorn: das Original wäre
    // eine zweite Kopie derselben Aufnahme, die nie jemand ausliefert
    expect(sp.files.has('media/m1.mp4')).toBe(false)
  })

  it('remuxt nicht doppelt: liegt die web.mp4 schon, bleibt es bei der Probe', async () => {
    const sp = memSpeicher()
    sp.files.set(
      'media/m1.mp4',
      Buffer.concat([atom('ftyp', 16), atom('mdat', 512), atom('moov', 64)]),
    )
    sp.files.set('media/m1.poster.jpg', Buffer.from('ALT-POSTER'))
    sp.files.set('media/m1.web.mp4', Buffer.from('ALT-WEB'))
    const tool = new FakeVideoTool(info())

    const meta = await prepareVideos({
      media: [{ id: 'm1', originalFile: 'm1.mp4' }],
      storage: sp,
      tool,
    })

    expect(tool.calls).toEqual(['probe'])
    expect(meta.get('m1')?.videoFile).toBe('m1.web.mp4')
    expect(sp.files.get('media/m1.web.mp4')?.toString()).toBe('ALT-WEB')
    // Bestandsaufräumen: die fertige web.mp4 macht das Original entbehrlich,
    // auch wenn in diesem Durchlauf nichts neu erzeugt wurde
    expect(sp.files.has('media/m1.mp4')).toBe(false)
  })

  it('transkodiert HEVC und liefert danach die web.mp4 aus', async () => {
    const sp = memSpeicher()
    sp.files.set('media/m1.mov', Buffer.from('HEVC-ORIGINAL'))
    const tool = new FakeVideoTool(info({ videoCodec: 'hevc', durationS: 12 }))

    const meta = await prepareVideos({
      media: [{ id: 'm1', originalFile: 'm1.mov' }],
      storage: sp,
      tool,
    })

    expect(tool.calls).toEqual(['probe', 'poster', 'transkodiere'])
    expect(meta.get('m1')?.videoFile).toBe('m1.web.mp4')
    expect(sp.files.has('media/m1.web.mp4')).toBe(true)
    expect(sp.files.has('media/m1.mov')).toBe(false) // Original verworfen
  })

  it('nimmt beim Wiedereintritt die web.mp4 als Quelle — das Original ist längst weg', async () => {
    // Der Normalfall bei jedem Re-Render: verworfenes Original, fertige
    // Auslieferungsdatei. Ohne diesen Weg fiele die Aufbereitung auf einen
    // Lesefehler und das Video verlöre Poster und Dauer im tour.json.
    const sp = memSpeicher()
    sp.files.set('media/m1.web.mp4', Buffer.from('WEB-MP4'))
    sp.files.set('media/m1.poster.jpg', Buffer.from('POSTER'))
    const tool = new FakeVideoTool(info({ videoCodec: 'h264', durationS: 9.5 }))

    const meta = await prepareVideos({
      media: [{ id: 'm1', originalFile: 'm1.mov' }],
      storage: sp,
      tool,
    })

    expect(tool.calls).toEqual(['probe']) // nichts neu erzeugt
    expect(meta.get('m1')).toEqual({
      durationS: 9.5,
      videoFile: 'm1.web.mp4',
      posterFile: 'm1.poster.jpg',
      sourceDurationS: 9.5,
    })
  })

  it('erzeugt beim Wiedereintritt ein fehlendes Poster aus der web.mp4', async () => {
    const sp = memSpeicher()
    sp.files.set('media/m1.web.mp4', Buffer.from('WEB-MP4'))
    const tool = new FakeVideoTool(info({ durationS: 4 }))

    const meta = await prepareVideos({
      media: [{ id: 'm1', originalFile: 'm1.mov' }],
      storage: sp,
      tool,
    })

    expect(tool.calls).toEqual(['probe', 'poster'])
    expect(sp.files.has('media/m1.poster.jpg')).toBe(true)
    expect(meta.get('m1')?.videoFile).toBe('m1.web.mp4')
  })

  it('meldet ein Video, von dem weder Original noch web.mp4 da ist', async () => {
    const sp = memSpeicher()
    const nachrichten: string[] = []

    const meta = await prepareVideos({
      media: [{ id: 'm1', originalFile: 'm1.mov' }],
      storage: sp,
      tool: new FakeVideoTool(info()),
      log: (n) => nachrichten.push(n),
    })

    expect(meta.has('m1')).toBe(false)
    expect(nachrichten[0]).toContain('Videodatei fehlt')
  })

  it('konvertiert h264 im .mov-Container in eine web.mp4 (nur wegen des Containers)', async () => {
    const sp = memSpeicher()
    sp.files.set('media/m1.mov', Buffer.from('H264-IN-MOV'))
    const tool = new FakeVideoTool(info({ videoCodec: 'h264', audioCodec: 'aac' }))

    const meta = await prepareVideos({
      media: [{ id: 'm1', originalFile: 'm1.mov' }],
      storage: sp,
      tool,
    })

    expect(tool.calls).toContain('transkodiere')
    expect(meta.get('m1')?.videoFile).toBe('m1.web.mp4')
  })

  it('ist idempotent: liegen Poster + Transcode schon, läuft nur die Probe', async () => {
    const sp = memSpeicher()
    sp.files.set('media/m1.mov', Buffer.from('HEVC-ORIGINAL'))
    sp.files.set('media/m1.poster.jpg', Buffer.from('ALT-POSTER'))
    sp.files.set('media/m1.web.mp4', Buffer.from('ALT-WEB'))
    const tool = new FakeVideoTool(info({ videoCodec: 'hevc' }))

    const meta = await prepareVideos({
      media: [{ id: 'm1', originalFile: 'm1.mov' }],
      storage: sp,
      tool,
    })

    expect(tool.calls).toEqual(['probe']) // nichts neu erzeugt
    expect(meta.get('m1')?.videoFile).toBe('m1.web.mp4') // Pfad trotzdem korrekt abgeleitet
    expect(sp.files.get('media/m1.poster.jpg')?.toString()).toBe('ALT-POSTER') // nicht überschrieben
    expect(sp.files.has('media/m1.mov')).toBe(false) // Original verworfen
  })

  it('überspringt ein kaputtes Video, ohne die Tour scheitern zu lassen', async () => {
    const sp = memSpeicher()
    sp.files.set('media/m1.mp4', Buffer.from('KAPUTT'))
    const tool: FakeVideoTool = new FakeVideoTool(info())
    // probe wirft (z. B. keine Videospur)
    tool.probe = async () => {
      throw new Error('Keine Videospur gefunden')
    }
    const nachrichten: string[] = []

    const meta = await prepareVideos({
      media: [{ id: 'm1', originalFile: 'm1.mp4' }],
      storage: sp,
      tool,
      log: (n) => nachrichten.push(n),
    })

    expect(meta.has('m1')).toBe(false)
    expect(nachrichten[0]).toContain('Keine Videospur')
  })
})

// — Video-Schnitt (Etappe 4, docs §2F) —

describe('klemmeSchnitt', () => {
  it('hat an BEIDEN Kanten das Material als Anschlag', () => {
    // Trimmen legt frei, was da ist, und erfindet nichts.
    expect(clampCut({ fromS: -5, toS: 100 }, 30)).toBeNull() // = ganze Datei
    expect(clampCut({ fromS: 2, toS: 100 }, 30)).toEqual({ fromS: 2, toS: 30 })
    expect(clampCut({ fromS: 50, toS: 60 }, 30)).toBeNull() // ganz hinter dem Ende
  })

  it('ohne Ende läuft der Schnitt bis zum Dateiende', () => {
    expect(clampCut({ fromS: 4 }, 30)).toEqual({ fromS: 4, toS: 30 })
  })

  it('nimmt den Vollschnitt als „kein Schnitt" — er erzwänge einen Transcode ohne Wirkung', () => {
    expect(clampCut({ fromS: 0, toS: 30 }, 30)).toBeNull()
    expect(clampCut(undefined, 30)).toBeNull()
  })

  it('lehnt eine Spanne ohne Inhalt ab', () => {
    expect(clampCut({ fromS: 10, toS: 10.01 }, 30)).toBeNull()
    expect(clampCut({ fromS: 10, toS: 5 }, 30)).toBeNull()
  })
})

describe('prepareVideos mit Schnitt', () => {
  const ganzesVideo = (): ReturnType<typeof memSpeicher> => {
    const sp = memSpeicher()
    sp.files.set(
      'media/m1.mp4',
      Buffer.concat([atom('ftyp', 16), atom('moov', 64), atom('mdat', 512)]),
    )
    return sp
  }

  it('schneidet IMMER per Transcode — nie per Stream-Copy', async () => {
    // Ein `-c copy` schneidet nur an Keyframes und träfe den Punkt um Sekunden.
    const sp = ganzesVideo()
    const tool = new FakeVideoTool(info({ durationS: 34 }))

    const meta = await prepareVideos({
      media: [{ id: 'm1', originalFile: 'm1.mp4', cutRange: { fromS: 6, toS: 28 } }],
      storage: sp,
      tool,
    })

    expect(tool.calls).toContain('schneide:6-28')
    expect(tool.calls).not.toContain('remux')
    expect(meta.get('m1')?.videoFile).toBe('m1.cut.mp4')
    expect(meta.get('m1')?.durationS).toBe(22) // die getrimmte Länge …
    expect(meta.get('m1')?.sourceDurationS).toBe(34) // … und der Anschlag fürs Studio
  })

  it('lässt das Material stehen — der Schnitt ist ein Edit, kein Verbrauch', async () => {
    const sp = ganzesVideo()
    await prepareVideos({
      media: [{ id: 'm1', originalFile: 'm1.mp4', cutRange: { fromS: 6, toS: 28 } }],
      storage: sp,
      tool: new FakeVideoTool(info({ durationS: 34 })),
    })
    // Ohne die Quelle wäre „Trim zurücknehmen" ein Datenverlust
    expect(sp.files.has('media/m1.mp4')).toBe(true)
    expect(sp.files.get('media/m1.cut.mp4')?.toString()).toBe('FAKE-CUT-MP4')
  })

  it('zieht das Poster mit — sonst zeigt es einen Frame, den es nicht mehr gibt', async () => {
    const sp = ganzesVideo()
    sp.files.set('media/m1.poster.jpg', Buffer.from('ALTES-POSTER'))
    const tool = new FakeVideoTool(info({ durationS: 34 }))

    await prepareVideos({
      media: [{ id: 'm1', originalFile: 'm1.mp4', cutRange: { fromS: 6, toS: 28 } }],
      storage: sp,
      tool,
    })

    expect(tool.calls).toContain('poster')
    expect(sp.files.get('media/m1.poster.jpg')?.toString()).toBe('FAKE-POSTER-JPEG')
  })

  it('nimmt den Schnitt zurück, wenn er aus dem Overlay verschwindet', async () => {
    const sp = ganzesVideo()
    sp.files.set('media/m1.cut.mp4', Buffer.from('ALTER-SCHNITT'))
    const tool = new FakeVideoTool(info({ durationS: 34 }))

    const meta = await prepareVideos({
      media: [{ id: 'm1', originalFile: 'm1.mp4' }],
      storage: sp,
      tool,
    })

    expect(sp.files.has('media/m1.cut.mp4')).toBe(false)
    expect(meta.get('m1')?.videoFile).toBe('m1.mp4')
    expect(meta.get('m1')?.durationS).toBe(34)
    expect(tool.calls).toContain('poster') // Poster wieder vom ganzen Video
  })

  it('schneidet auch aus der web.mp4, wenn das Original längst verworfen ist', async () => {
    const sp = memSpeicher()
    sp.files.set('media/m1.web.mp4', Buffer.from('WEB-MP4'))
    const tool = new FakeVideoTool(info({ durationS: 20 }))

    const meta = await prepareVideos({
      media: [{ id: 'm1', originalFile: 'm1.mov', cutRange: { fromS: 3 } }],
      storage: sp,
      tool,
    })

    expect(meta.get('m1')?.videoFile).toBe('m1.cut.mp4')
    expect(meta.get('m1')?.durationS).toBe(17)
    expect(sp.files.has('media/m1.web.mp4')).toBe(true) // Master bleibt
  })

  it('ignoriert einen Schnitt, der das ganze Material meint', async () => {
    const sp = ganzesVideo()
    const tool = new FakeVideoTool(info({ durationS: 34 }))

    const meta = await prepareVideos({
      media: [{ id: 'm1', originalFile: 'm1.mp4', cutRange: { fromS: 0, toS: 34 } }],
      storage: sp,
      tool,
    })

    expect(tool.calls.some((a) => a.startsWith('schneide'))).toBe(false)
    expect(meta.get('m1')?.videoFile).toBe('m1.mp4')
  })
})
