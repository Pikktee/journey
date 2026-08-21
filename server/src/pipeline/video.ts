// Video-Aufbereitung (M4): ffprobe → Codec/Dauer, Poster-Standbild, und bei
// nicht web-tauglichen Codecs (HEVC, VP9 …) Transcode nach H.264/AAC 1080p.
// Das eigentliche ffmpeg/ffprobe steckt hinter dem VideoWerkzeug-Interface
// (Dependency Inversion) — Tests injizieren einen Fake, kein Netz, kein Codec.
//
// I/O-Grenze: ffmpeg spricht nur Dateipfade. Die Orchestrierung liest das
// Video über den (abstrakten) Storage in eine Temp-Datei, ruft das Werkzeug
// mit Temp-Pfaden und schreibt Poster/Transcode zurück in den Storage — so
// bleibt der Storage austauschbar (FS heute, R2 später) und die Rohdatei
// unangetastet (Poster/Transcode sind abgeleitete Geschwister-Dateien).

import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)

export interface VideoInfo {
  videoCodec: string
  /** null, wenn das Video keine Tonspur hat */
  audioCodec: string | null
  durationS: number
  width: number
  height: number
}

export interface VideoTool {
  /** Codec, Dauer und Auflösung auslesen. */
  probe(path: string): Promise<VideoInfo>
  /** Nach H.264/AAC, max. 1080p, faststart transkodieren (Web-Kompatibilität). */
  transcode(sourcePath: string, targetPath: string): Promise<void>
  /** Nur den Container neu schreiben (`-c copy`), damit `moov` vorn liegt. */
  remuxFaststart(sourcePath: string, targetPath: string): Promise<void>
  /**
   * Ausschnitt [fromS, toS) neu codieren.
   *
   * IMMER Transcode, nie `-c copy`: Ein Stream-Copy kann nur an Keyframes
   * schneiden und träfe den gewünschten Punkt um Sekunden — bei einer
   * Handyaufnahme mit 2-s-GOP liegt der Schnitt dann sichtbar daneben. Das
   * kostet Rechenzeit, aber ein Schnitt, der nicht dort sitzt, wo man ihn
   * gesetzt hat, ist kein Schnitt.
   */
  cut(sourcePath: string, targetPath: string, fromS: number, toS?: number): Promise<void>
  /** Einzelbild bei zeitpunktS als JPEG (Poster fürs Foto-Overlay). */
  makePoster(sourcePath: string, targetPath: string, atS: number): Promise<void>
}

// H.264-Video mit AAC/MP3 oder ohne Ton läuft in jedem Browser nativ — alles
// andere (HEVC von neuen iPhones/Pixeln, VP9, AC3 …) muss transkodiert werden.
// Reine Entscheidung über der Probe, ohne I/O direkt testbar.
const WEB_VIDEO_CODEC = 'h264'
const WEB_AUDIO_CODECS = new Set(['aac', 'mp3'])

export function needsTranscoding(info: VideoInfo): boolean {
  if (info.videoCodec !== WEB_VIDEO_CODEC) return true
  if (info.audioCodec !== null && !WEB_AUDIO_CODECS.has(info.audioCodec)) return true
  return false
}

/**
 * Muss das Video in eine web-taugliche .mp4 überführt werden? Zusätzlich zum
 * Codec zählt der Container: eine .mov mit h264/aac wird als `video/quicktime`
 * ausgeliefert, das manche Browser (Firefox) nicht abspielen. Nur eine echte
 * .mp4 bleibt unangetastet.
 */
export function needsWebConversion(info: VideoInfo, originalFile: string): boolean {
  return needsTranscoding(info) || !originalFile.toLowerCase().endsWith('.mp4')
}

/**
 * Liegt der Index (`moov`) VOR den Mediendaten (`mdat`)?
 *
 * Android schreibt Aufnahmen über den MediaMuxer, und der setzt `moov` ans
 * ENDE der Datei — bei einer 26-MB-Aufnahme also 26 MB hinter den Anfang. Wer
 * so eine Datei streamt, bekommt erst gar nichts zu sehen: Der Player liest
 * den Kopf, findet keinen Index, springt ans Dateiende, holt ihn dort und
 * beginnt erst dann zu laden. Über Mobilfunk sind das mehrere Sekunden, in
 * denen die Fläche schwarz bleibt — auf dem Pixel gemessen ~5 s pro Video.
 *
 * Genau dieser Fall fiel bisher durchs Raster: `+faststart` setzt nur der
 * Transcode, und eine H.264/AAC-`.mp4` vom Telefon wird nicht transkodiert.
 *
 * Gelesen wird die Atom-Kette an der Oberfläche (Länge + Typ, je 4 Byte).
 * Abbruch beim ersten `moov` (gut) oder `mdat` (schlecht); reicht der Puffer
 * für keins von beidem, lautet die Antwort „nein" — dann wird umgeschrieben,
 * und das ist der harmlose Ausgang.
 */
export function hasFaststart(data: Buffer): boolean {
  let pos = 0
  // 8 Byte Kopf: 4 Länge + 4 Typ. Weniger ist kein Atom mehr.
  while (pos + 8 <= data.length) {
    let boxSize = data.readUInt32BE(pos)
    const boxType = data.toString('latin1', pos + 4, pos + 8)
    if (boxType === 'moov') return true
    if (boxType === 'mdat') return false
    // Länge 1 = 64-Bit-Größe im Feld dahinter (große mdat-Boxen); Länge 0 =
    // „bis Dateiende", danach kommt nichts mehr, worauf zu springen wäre.
    if (boxSize === 1) {
      if (pos + 16 > data.length) return false
      const bigSize = data.readBigUInt64BE(pos + 8)
      if (bigSize > BigInt(Number.MAX_SAFE_INTEGER)) return false
      boxSize = Number(bigSize)
    }
    if (boxSize < 8) return false
    pos += boxSize
  }
  return false
}

/** Ablage-Name des Posters (zwei Punkt-Segmente → nie ein Upload-Medienname). */
export function posterFilename(mediumId: string): string {
  return `${mediumId}.poster.jpg`
}

/** Ablage-Name des transkodierten Videos (nur wenn transkodiert wurde). */
export function webVideoFilename(mediumId: string): string {
  return `${mediumId}.web.mp4`
}

/**
 * Ablage-Name des geschnittenen Videos (nur bei gesetztem `edits.media[].trim`).
 *
 * Eine EIGENE Datei neben dem Master, nicht an seiner Stelle: Der Schnitt ist
 * ein Edit und damit jederzeit widerrufbar oder verschiebbar. Würde in die
 * Auslieferungsdatei hineingeschnitten, wäre der zweite Schnitt ein Schnitt in
 * den ersten — das Overlay rechnet aber in DATEI-Sekunden des Originals, und
 * „Trim zurücknehmen" fände das Weggeschnittene nirgends wieder.
 */
export function cutVideoFilename(mediumId: string): string {
  return `${mediumId}.cut.mp4`
}

/** Video-Schnitt in Dateisekunden, wie er aus dem Edit-Overlay kommt. */
export interface VideoCut {
  fromS: number
  toS?: number
}

/**
 * Schnitt auf das MATERIAL klemmen — der Anschlag an beiden Kanten (docs §2F).
 *
 * Trimmen legt frei, was da ist, und erfindet nichts: `fromS` kann nicht vor den
 * Dateianfang, `toS` nicht hinter das Dateiende. Bleibt danach keine echte
 * Spanne übrig (oder war gar keine gefordert), ist die Antwort `null` = ganze
 * Datei — ein leerer Schnitt darf kein Video von null Sekunden erzeugen.
 */
export function clampCut(cutRange: VideoCut | undefined, durationS: number): VideoCut | null {
  if (!cutRange || !(durationS > 0)) return null
  const fromS = Math.min(Math.max(0, cutRange.fromS), durationS)
  const toS =
    cutRange.toS === undefined ? durationS : Math.min(Math.max(0, cutRange.toS), durationS)
  if (!(toS - fromS > 0.05)) return null
  // Der Vollschnitt ist kein Schnitt: er erzwänge einen Transcode ohne Wirkung.
  if (fromS <= 0 && toS >= durationS) return null
  return { fromS: fromS, toS: toS }
}

/**
 * Poster-Zeitpunkt: der ERSTE Frame.
 *
 * Vorher lag er eine Sekunde später — ein besseres Standbild, aber der Player
 * zeigt das Poster, bis die Wiedergabe einsetzt, und die beginnt bei null. Beim
 * Umschalten sprang das Bild sichtbar. Ein zum Anfang passendes Standbild ist
 * mehr wert als ein schöneres, das nicht zum nächsten Moment passt.
 */
export function posterTime(_durationS: number): number {
  return 0
}

/** Ergebnis der Aufbereitung eines Videos — fließt in enrich.ts ins tour.json. */
export interface VideoMeta {
  /** Länge der AUSGELIEFERTEN Datei (bei gesetztem Schnitt die getrimmte) */
  durationS: number
  /** Auszuliefernde Videodatei (geschnitten, sonst transkodiert, sonst Original) */
  videoFile: string
  /** Poster-JPEG */
  posterFile: string
  /**
   * Länge der QUELLE in Sekunden — das Material, gegen das der Editor seine
   * Trimm-Kanten anschlägt. Ohne Schnitt gleich `dauerS`; fehlt das Feld
   * (Cache-Eintrag von vor Etappe 4), gilt `dauerS` als Quelle.
   */
  sourceDurationS?: number
}

/** Schmaler Storage-Ausschnitt, den die Aufbereitung braucht (Storage erfüllt ihn). */
export interface VideoStorage {
  read(relPath: string): Promise<Buffer>
  write(relPath: string, content: Buffer): Promise<void>
  info(relPath: string): Promise<{ size: number } | null>
  remove(relPath: string): Promise<void>
}

/** Die echte ffmpeg/ffprobe-Anbindung (nur in Produktion; Tests nutzen den Fake). */
export class FfmpegVideoTool implements VideoTool {
  constructor(
    private readonly ffmpeg = 'ffmpeg',
    private readonly ffprobe = 'ffprobe',
  ) {}

  async probe(path: string): Promise<VideoInfo> {
    const { stdout } = await execFileP(
      this.ffprobe,
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path],
      { maxBuffer: 8 * 1024 * 1024 },
    )
    const data = JSON.parse(stdout) as {
      streams?: Array<{
        codec_type?: string
        codec_name?: string
        width?: number
        height?: number
        duration?: string
      }>
      format?: { duration?: string }
    }
    const v = data.streams?.find((s) => s.codec_type === 'video')
    const a = data.streams?.find((s) => s.codec_type === 'audio')
    if (!v) throw new Error('Keine Videospur gefunden')
    return {
      videoCodec: v.codec_name ?? '',
      audioCodec: a?.codec_name ?? null,
      durationS: Number(data.format?.duration ?? v.duration ?? 0) || 0,
      width: Number(v.width ?? 0),
      height: Number(v.height ?? 0),
    }
  }

  async transcode(sourcePath: string, targetPath: string): Promise<void> {
    await execFileP(
      this.ffmpeg,
      [
        '-y',
        '-i',
        sourcePath,
        // In die 1080p-Box verkleinern (nie hochskalieren: min(iw)/min(ih)),
        // Seitenverhältnis wahren, dann auf gerade Kantenlängen trimmen (libx264
        // verweigert ungerade Dimensionen, u. a. bei Hochformat-Handyvideos).
        '-vf',
        "scale='min(1920,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2",
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '23',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-movflags',
        '+faststart', // Moov-Atom nach vorn → Seeking ohne Voll-Download
        targetPath,
      ],
      { maxBuffer: 8 * 1024 * 1024 },
    )
  }

  async remuxFaststart(sourcePath: string, targetPath: string): Promise<void> {
    // `-c copy`: Bild und Ton werden NICHT neu codiert, nur der Container wird
    // neu geschrieben. Das dauert Sekundenbruchteile statt Minuten und kostet
    // keine Qualität — es verschiebt allein den Index nach vorn.
    await execFileP(
      this.ffmpeg,
      ['-y', '-i', sourcePath, '-c', 'copy', '-movflags', '+faststart', targetPath],
      { maxBuffer: 8 * 1024 * 1024 },
    )
  }

  async cut(sourcePath: string, targetPath: string, fromS: number, toS?: number): Promise<void> {
    // `-ss` steht HINTER `-i`: davor sucht ffmpeg zum nächsten Keyframe und
    // schneidet dort — genau der Fehler, den dieser Weg vermeiden soll. Dahinter
    // wird bis zum exakten Zeitpunkt decodiert und ab da geschrieben. Langsamer,
    // aber bildgenau.
    await execFileP(
      this.ffmpeg,
      [
        '-y',
        '-i',
        sourcePath,
        '-ss',
        String(fromS),
        ...(toS !== undefined ? ['-to', String(toS)] : []),
        '-vf',
        "scale='min(1920,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2",
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '23',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-movflags',
        '+faststart',
        targetPath,
      ],
      { maxBuffer: 8 * 1024 * 1024 },
    )
  }

  async makePoster(sourcePath: string, targetPath: string, atS: number): Promise<void> {
    await execFileP(
      this.ffmpeg,
      ['-y', '-ss', String(atS), '-i', sourcePath, '-frames:v', '1', '-q:v', '3', targetPath],
      { maxBuffer: 8 * 1024 * 1024 },
    )
  }
}

/**
 * Test-Fake: liefert eine feste Probe und schreibt Platzhalter-Bytes an die
 * Zielpfade (die Orchestrierung liest sie gleich wieder zurück in den Storage).
 * Protokolliert die Aufrufe, damit Tests „wurde transkodiert?" prüfen können.
 */
export class FakeVideoTool implements VideoTool {
  public readonly calls: string[] = []
  constructor(private readonly info: VideoInfo) {}

  async probe(): Promise<VideoInfo> {
    this.calls.push('probe')
    return this.info
  }

  async transcode(_sourcePath: string, targetPath: string): Promise<void> {
    this.calls.push('transkodiere')
    await writeFile(targetPath, Buffer.from('FAKE-WEB-MP4'))
  }

  async remuxFaststart(_sourcePath: string, targetPath: string): Promise<void> {
    this.calls.push('remux')
    await writeFile(targetPath, Buffer.from('FAKE-FASTSTART-MP4'))
  }

  async cut(_sourcePath: string, targetPath: string, fromS: number, toS?: number): Promise<void> {
    this.calls.push(`schneide:${fromS}-${toS ?? ''}`)
    await writeFile(targetPath, Buffer.from('FAKE-CUT-MP4'))
  }

  async makePoster(_sourcePath: string, targetPath: string): Promise<void> {
    this.calls.push('poster')
    await writeFile(targetPath, Buffer.from('FAKE-POSTER-JPEG'))
  }
}

/**
 * Ein einzelnes Video aufbereiten: Poster immer, Transcode nur bei Bedarf.
 *
 * Entsteht dabei eine eigene Auslieferungsdatei (`m1.web.mp4`), wird das
 * ORIGINAL VERWORFEN — sonst läge dieselbe Aufnahme zweimal auf der Platte,
 * und die zweite Fassung liest nie jemand: Ausgeliefert wird immer die
 * web.mp4, und ein erneuter Transcode aus dem Original würde nur dasselbe
 * Ergebnis noch einmal erzeugen. Deshalb ist ein Wiedereintritt OHNE Original
 * der Normalfall, kein Fehler: Liegt nur noch die web.mp4, ist sie die Quelle
 * für Probe und Poster.
 */
async function prepareVideo(
  mediumId: string,
  originalFile: string,
  storage: VideoStorage,
  tool: VideoTool,
  cutRange?: VideoCut,
): Promise<VideoMeta> {
  const posterName = posterFilename(mediumId)
  const webName = webVideoFilename(mediumId)
  const cutName = cutVideoFilename(mediumId)
  const originalPresent = !!(await storage.info(`media/${originalFile}`))
  if (!originalPresent && !(await storage.info(`media/${webName}`))) {
    throw new Error(`Videodatei fehlt: ${originalFile}`)
  }
  const sourceFile = originalPresent ? originalFile : webName
  const extension = sourceFile.split('.').pop() ?? 'mp4'

  const workDir = await mkdtemp(join(tmpdir(), 'maptale-video-'))
  const sourceTemp = join(workDir, `quelle.${extension}`)
  try {
    const raw = await storage.read(`media/${sourceFile}`)
    await writeFile(sourceTemp, raw)
    const info = await tool.probe(sourceTemp)

    // Poster nur erzeugen, wenn es noch nicht liegt (Re-Render nach PATCH soll
    // nicht jedes Mal ffmpeg anwerfen — Poster/Transcode sind deterministisch).
    if (!(await storage.info(`media/${posterName}`))) {
      const posterTemp = join(workDir, 'poster.jpg')
      await tool.makePoster(sourceTemp, posterTemp, posterTime(info.durationS))
      await storage.write(`media/${posterName}`, await readFile(posterTemp))
    }

    // Zwei Gründe, eine eigene Auslieferungsdatei zu erzeugen — und beide
    // enden in derselben `m1.web.mp4`:
    //   1. Der Inhalt ist nicht web-tauglich (HEVC, .mov …) → neu codieren.
    //   2. Er ist tauglich, aber der Index liegt hinten → nur umschreiben.
    // Fall 2 ist der Alltagsfall der App: Ein Pixel liefert H.264/AAC in .mp4
    // und wurde deshalb unangetastet durchgereicht — samt `moov` am Ende, das
    // jede Wiedergabe um Sekunden verzögerte (s. hasFaststart).
    let videoFile = sourceFile
    if (originalPresent && needsWebConversion(info, originalFile)) {
      videoFile = webName
      if (!(await storage.info(`media/${webName}`))) {
        const webTemp = join(workDir, 'web.mp4')
        await tool.transcode(sourceTemp, webTemp)
        await storage.write(`media/${webName}`, await readFile(webTemp))
      }
    } else if (originalPresent && !hasFaststart(raw)) {
      videoFile = webName
      if (!(await storage.info(`media/${webName}`))) {
        const webTemp = join(workDir, 'web.mp4')
        await tool.remuxFaststart(sourceTemp, webTemp)
        await storage.write(`media/${webName}`, await readFile(webTemp))
      }
    }

    // Erst hier, mit der fertigen web.mp4 im Storage: das Original ist ab jetzt
    // totes Gewicht. Die Reihenfolge ist die ganze Sicherung — vor dem
    // erfolgreichen Schreiben zu löschen, hieße bei einem Abbruch beides zu
    // verlieren.
    //
    // Gemessen wird gegen den MASTER, nicht gegen die ausgelieferte Datei: Ein
    // Schnitt (unten) erzeugt eine weitere Fassung, aber er darf das Material
    // nicht verbrauchen — sonst wäre „Trim zurücknehmen" ein Datenverlust.
    if (videoFile !== originalFile && originalPresent) {
      await storage.remove(`media/${originalFile}`)
    }
    const masterFile = videoFile

    // Video-Schnitt (Etappe 4): eine eigene Auslieferungsdatei aus dem Master.
    // Geklemmt wird auf das Material — Trimmen legt frei, was da ist. Ohne
    // wirksamen Schnitt bleibt alles, wie es war (kein Transcode, keine Datei).
    const effectiveCut = clampCut(cutRange, info.durationS)
    if (effectiveCut) {
      const cutTemp = join(workDir, 'schnitt.mp4')
      await tool.cut(sourceTemp, cutTemp, effectiveCut.fromS, effectiveCut.toS)
      await storage.write(`media/${cutName}`, await readFile(cutTemp))
      // Das Poster zeigt den ersten Frame der AUSGELIEFERTEN Fassung — sonst
      // stünde dort ein Bild, das im Film gar nicht mehr vorkommt.
      const posterTemp = join(workDir, 'poster-schnitt.jpg')
      await tool.makePoster(cutTemp, posterTemp, posterTime(0))
      await storage.write(`media/${posterName}`, await readFile(posterTemp))
      return {
        durationS: (effectiveCut.toS ?? info.durationS) - effectiveCut.fromS,
        videoFile: cutName,
        posterFile: posterName,
        sourceDurationS: info.durationS,
      }
    }
    // Kein (wirksamer) Schnitt mehr: eine frühere Schnittfassung ist jetzt
    // totes Gewicht — der Master liegt ja noch. Das Poster zeigt dann noch den
    // ersten Frame des ALTEN Ausschnitts und muss mit zurück.
    if (await storage.info(`media/${cutName}`)) {
      await storage.remove(`media/${cutName}`)
      const posterTemp = join(workDir, 'poster-ganz.jpg')
      await tool.makePoster(sourceTemp, posterTemp, posterTime(info.durationS))
      await storage.write(`media/${posterName}`, await readFile(posterTemp))
    }

    return {
      durationS: info.durationS,
      videoFile: masterFile,
      posterFile: posterName,
      sourceDurationS: info.durationS,
    }
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
}

/**
 * Alle Videos einer Tour aufbereiten. Fehlertolerant je Video: ein kaputtes
 * Video lässt die Tour nicht scheitern (protokoll-Hinweis, Eintrag fehlt in der
 * Map → enrich.ts liefert dann das Original ohne Poster aus).
 */
export async function prepareVideos(input: {
  media: Array<{ id: string; originalFile: string; cutRange?: VideoCut }>
  storage: VideoStorage
  tool: VideoTool
  log?: (message: string) => void
}): Promise<Map<string, VideoMeta>> {
  const { media, storage, tool, log } = input
  const meta = new Map<string, VideoMeta>()
  for (const m of media) {
    try {
      meta.set(m.id, await prepareVideo(m.id, m.originalFile, storage, tool, m.cutRange))
    } catch (error) {
      log?.(`Video-Aufbereitung fehlgeschlagen (${m.id}): ${(error as Error).message}`)
    }
  }
  return meta
}
