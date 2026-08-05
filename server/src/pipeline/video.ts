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
  codecVideo: string
  /** null, wenn das Video keine Tonspur hat */
  codecAudio: string | null
  dauerS: number
  breite: number
  hoehe: number
}

export interface VideoWerkzeug {
  /** Codec, Dauer und Auflösung auslesen. */
  probe(pfad: string): Promise<VideoInfo>
  /** Nach H.264/AAC, max. 1080p, faststart transkodieren (Web-Kompatibilität). */
  transkodiere(quellPfad: string, zielPfad: string): Promise<void>
  /** Nur den Container neu schreiben (`-c copy`), damit `moov` vorn liegt. */
  remuxeFaststart(quellPfad: string, zielPfad: string): Promise<void>
  /**
   * Ausschnitt [vonS, bisS) neu codieren.
   *
   * IMMER Transcode, nie `-c copy`: Ein Stream-Copy kann nur an Keyframes
   * schneiden und träfe den gewünschten Punkt um Sekunden — bei einer
   * Handyaufnahme mit 2-s-GOP liegt der Schnitt dann sichtbar daneben. Das
   * kostet Rechenzeit, aber ein Schnitt, der nicht dort sitzt, wo man ihn
   * gesetzt hat, ist kein Schnitt.
   */
  schneide(quellPfad: string, zielPfad: string, vonS: number, bisS?: number): Promise<void>
  /** Einzelbild bei zeitpunktS als JPEG (Poster fürs Foto-Overlay). */
  erzeugePoster(quellPfad: string, zielPfad: string, zeitpunktS: number): Promise<void>
}

// H.264-Video mit AAC/MP3 oder ohne Ton läuft in jedem Browser nativ — alles
// andere (HEVC von neuen iPhones/Pixeln, VP9, AC3 …) muss transkodiert werden.
// Reine Entscheidung über der Probe, ohne I/O direkt testbar.
const WEB_VIDEO_CODEC = 'h264'
const WEB_AUDIO_CODECS = new Set(['aac', 'mp3'])

export function brauchtTranskodierung(info: VideoInfo): boolean {
  if (info.codecVideo !== WEB_VIDEO_CODEC) return true
  if (info.codecAudio !== null && !WEB_AUDIO_CODECS.has(info.codecAudio)) return true
  return false
}

/**
 * Muss das Video in eine web-taugliche .mp4 überführt werden? Zusätzlich zum
 * Codec zählt der Container: eine .mov mit h264/aac wird als `video/quicktime`
 * ausgeliefert, das manche Browser (Firefox) nicht abspielen. Nur eine echte
 * .mp4 bleibt unangetastet.
 */
export function mussWebKonvertiert(info: VideoInfo, originalDatei: string): boolean {
  return brauchtTranskodierung(info) || !originalDatei.toLowerCase().endsWith('.mp4')
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
export function hatFaststart(daten: Buffer): boolean {
  let pos = 0
  // 8 Byte Kopf: 4 Länge + 4 Typ. Weniger ist kein Atom mehr.
  while (pos + 8 <= daten.length) {
    let groesse = daten.readUInt32BE(pos)
    const typ = daten.toString('latin1', pos + 4, pos + 8)
    if (typ === 'moov') return true
    if (typ === 'mdat') return false
    // Länge 1 = 64-Bit-Größe im Feld dahinter (große mdat-Boxen); Länge 0 =
    // „bis Dateiende", danach kommt nichts mehr, worauf zu springen wäre.
    if (groesse === 1) {
      if (pos + 16 > daten.length) return false
      const gross = daten.readBigUInt64BE(pos + 8)
      if (gross > BigInt(Number.MAX_SAFE_INTEGER)) return false
      groesse = Number(gross)
    }
    if (groesse < 8) return false
    pos += groesse
  }
  return false
}

/** Ablage-Name des Posters (zwei Punkt-Segmente → nie ein Upload-Medienname). */
export function posterDateiname(mediumId: string): string {
  return `${mediumId}.poster.jpg`
}

/** Ablage-Name des transkodierten Videos (nur wenn transkodiert wurde). */
export function webVideoDateiname(mediumId: string): string {
  return `${mediumId}.web.mp4`
}

/**
 * Ablage-Name des geschnittenen Videos (nur bei gesetztem `edits.medien[].trim`).
 *
 * Eine EIGENE Datei neben dem Master, nicht an seiner Stelle: Der Schnitt ist
 * ein Edit und damit jederzeit widerrufbar oder verschiebbar. Würde in die
 * Auslieferungsdatei hineingeschnitten, wäre der zweite Schnitt ein Schnitt in
 * den ersten — das Overlay rechnet aber in DATEI-Sekunden des Originals, und
 * „Trim zurücknehmen" fände das Weggeschnittene nirgends wieder.
 */
export function schnittVideoDateiname(mediumId: string): string {
  return `${mediumId}.cut.mp4`
}

/** Video-Schnitt in Dateisekunden, wie er aus dem Edit-Overlay kommt. */
export interface VideoSchnitt {
  vonS: number
  bisS?: number
}

/**
 * Schnitt auf das MATERIAL klemmen — der Anschlag an beiden Kanten (docs §2F).
 *
 * Trimmen legt frei, was da ist, und erfindet nichts: `vonS` kann nicht vor den
 * Dateianfang, `bisS` nicht hinter das Dateiende. Bleibt danach keine echte
 * Spanne übrig (oder war gar keine gefordert), ist die Antwort `null` = ganze
 * Datei — ein leerer Schnitt darf kein Video von null Sekunden erzeugen.
 */
export function klemmeSchnitt(schnitt: VideoSchnitt | undefined, dauerS: number): VideoSchnitt | null {
  if (!schnitt || !(dauerS > 0)) return null
  const vonS = Math.min(Math.max(0, schnitt.vonS), dauerS)
  const bisS = schnitt.bisS === undefined ? dauerS : Math.min(Math.max(0, schnitt.bisS), dauerS)
  if (!(bisS - vonS > 0.05)) return null
  // Der Vollschnitt ist kein Schnitt: er erzwänge einen Transcode ohne Wirkung.
  if (vonS <= 0 && bisS >= dauerS) return null
  return { vonS, bisS }
}

/**
 * Poster-Zeitpunkt: der ERSTE Frame.
 *
 * Vorher lag er eine Sekunde später — ein besseres Standbild, aber der Player
 * zeigt das Poster, bis die Wiedergabe einsetzt, und die beginnt bei null. Beim
 * Umschalten sprang das Bild sichtbar. Ein zum Anfang passendes Standbild ist
 * mehr wert als ein schöneres, das nicht zum nächsten Moment passt.
 */
export function posterZeitpunkt(_dauerS: number): number {
  return 0
}

/** Ergebnis der Aufbereitung eines Videos — fließt in enrich.ts ins tour.json. */
export interface VideoMeta {
  /** Länge der AUSGELIEFERTEN Datei (bei gesetztem Schnitt die getrimmte) */
  dauerS: number
  /** Auszuliefernde Videodatei (geschnitten, sonst transkodiert, sonst Original) */
  videoDatei: string
  /** Poster-JPEG */
  posterDatei: string
  /**
   * Länge der QUELLE in Sekunden — das Material, gegen das der Editor seine
   * Trimm-Kanten anschlägt. Ohne Schnitt gleich `dauerS`; fehlt das Feld
   * (Cache-Eintrag von vor Etappe 4), gilt `dauerS` als Quelle.
   */
  quellDauerS?: number
}

/** Schmaler Storage-Ausschnitt, den die Aufbereitung braucht (Storage erfüllt ihn). */
export interface VideoSpeicher {
  lese(relPfad: string): Promise<Buffer>
  schreibe(relPfad: string, inhalt: Buffer): Promise<void>
  info(relPfad: string): Promise<{ groesse: number } | null>
  loesche(relPfad: string): Promise<void>
}

/** Die echte ffmpeg/ffprobe-Anbindung (nur in Produktion; Tests nutzen den Fake). */
export class FfmpegWerkzeug implements VideoWerkzeug {
  constructor(
    private readonly ffmpeg = 'ffmpeg',
    private readonly ffprobe = 'ffprobe',
  ) {}

  async probe(pfad: string): Promise<VideoInfo> {
    const { stdout } = await execFileP(
      this.ffprobe,
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', pfad],
      { maxBuffer: 8 * 1024 * 1024 },
    )
    const daten = JSON.parse(stdout) as {
      streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number; duration?: string }>
      format?: { duration?: string }
    }
    const v = daten.streams?.find((s) => s.codec_type === 'video')
    const a = daten.streams?.find((s) => s.codec_type === 'audio')
    if (!v) throw new Error('Keine Videospur gefunden')
    return {
      codecVideo: v.codec_name ?? '',
      codecAudio: a?.codec_name ?? null,
      dauerS: Number(daten.format?.duration ?? v.duration ?? 0) || 0,
      breite: Number(v.width ?? 0),
      hoehe: Number(v.height ?? 0),
    }
  }

  async transkodiere(quellPfad: string, zielPfad: string): Promise<void> {
    await execFileP(
      this.ffmpeg,
      [
        '-y',
        '-i', quellPfad,
        // In die 1080p-Box verkleinern (nie hochskalieren: min(iw)/min(ih)),
        // Seitenverhältnis wahren, dann auf gerade Kantenlängen trimmen (libx264
        // verweigert ungerade Dimensionen, u. a. bei Hochformat-Handyvideos).
        '-vf', "scale='min(1920,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2",
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
        '-c:a', 'aac', '-b:a', '128k',
        '-movflags', '+faststart', // Moov-Atom nach vorn → Seeking ohne Voll-Download
        zielPfad,
      ],
      { maxBuffer: 8 * 1024 * 1024 },
    )
  }

  async remuxeFaststart(quellPfad: string, zielPfad: string): Promise<void> {
    // `-c copy`: Bild und Ton werden NICHT neu codiert, nur der Container wird
    // neu geschrieben. Das dauert Sekundenbruchteile statt Minuten und kostet
    // keine Qualität — es verschiebt allein den Index nach vorn.
    await execFileP(
      this.ffmpeg,
      ['-y', '-i', quellPfad, '-c', 'copy', '-movflags', '+faststart', zielPfad],
      { maxBuffer: 8 * 1024 * 1024 },
    )
  }

  async schneide(quellPfad: string, zielPfad: string, vonS: number, bisS?: number): Promise<void> {
    // `-ss` steht HINTER `-i`: davor sucht ffmpeg zum nächsten Keyframe und
    // schneidet dort — genau der Fehler, den dieser Weg vermeiden soll. Dahinter
    // wird bis zum exakten Zeitpunkt decodiert und ab da geschrieben. Langsamer,
    // aber bildgenau.
    await execFileP(
      this.ffmpeg,
      [
        '-y',
        '-i', quellPfad,
        '-ss', String(vonS),
        ...(bisS !== undefined ? ['-to', String(bisS)] : []),
        '-vf', "scale='min(1920,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2",
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
        '-c:a', 'aac', '-b:a', '128k',
        '-movflags', '+faststart',
        zielPfad,
      ],
      { maxBuffer: 8 * 1024 * 1024 },
    )
  }

  async erzeugePoster(quellPfad: string, zielPfad: string, zeitpunktS: number): Promise<void> {
    await execFileP(
      this.ffmpeg,
      ['-y', '-ss', String(zeitpunktS), '-i', quellPfad, '-frames:v', '1', '-q:v', '3', zielPfad],
      { maxBuffer: 8 * 1024 * 1024 },
    )
  }
}

/**
 * Test-Fake: liefert eine feste Probe und schreibt Platzhalter-Bytes an die
 * Zielpfade (die Orchestrierung liest sie gleich wieder zurück in den Storage).
 * Protokolliert die Aufrufe, damit Tests „wurde transkodiert?" prüfen können.
 */
export class FakeVideoWerkzeug implements VideoWerkzeug {
  public readonly aufrufe: string[] = []
  constructor(private readonly info: VideoInfo) {}

  async probe(): Promise<VideoInfo> {
    this.aufrufe.push('probe')
    return this.info
  }

  async transkodiere(_quellPfad: string, zielPfad: string): Promise<void> {
    this.aufrufe.push('transkodiere')
    await writeFile(zielPfad, Buffer.from('FAKE-WEB-MP4'))
  }

  async remuxeFaststart(_quellPfad: string, zielPfad: string): Promise<void> {
    this.aufrufe.push('remux')
    await writeFile(zielPfad, Buffer.from('FAKE-FASTSTART-MP4'))
  }

  async schneide(_quellPfad: string, zielPfad: string, vonS: number, bisS?: number): Promise<void> {
    this.aufrufe.push(`schneide:${vonS}-${bisS ?? ''}`)
    await writeFile(zielPfad, Buffer.from('FAKE-CUT-MP4'))
  }

  async erzeugePoster(_quellPfad: string, zielPfad: string): Promise<void> {
    this.aufrufe.push('poster')
    await writeFile(zielPfad, Buffer.from('FAKE-POSTER-JPEG'))
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
async function bereiteEinVideoAuf(
  mediumId: string,
  originalDatei: string,
  speicher: VideoSpeicher,
  werkzeug: VideoWerkzeug,
  schnitt?: VideoSchnitt,
): Promise<VideoMeta> {
  const posterName = posterDateiname(mediumId)
  const webName = webVideoDateiname(mediumId)
  const schnittName = schnittVideoDateiname(mediumId)
  const originalDa = !!(await speicher.info(`media/${originalDatei}`))
  if (!originalDa && !(await speicher.info(`media/${webName}`))) {
    throw new Error(`Videodatei fehlt: ${originalDatei}`)
  }
  const quellDatei = originalDa ? originalDatei : webName
  const endung = quellDatei.split('.').pop() ?? 'mp4'

  const arbeitsdir = await mkdtemp(join(tmpdir(), 'maptale-video-'))
  const quellTemp = join(arbeitsdir, `quelle.${endung}`)
  try {
    const rohdaten = await speicher.lese(`media/${quellDatei}`)
    await writeFile(quellTemp, rohdaten)
    const info = await werkzeug.probe(quellTemp)

    // Poster nur erzeugen, wenn es noch nicht liegt (Re-Render nach PATCH soll
    // nicht jedes Mal ffmpeg anwerfen — Poster/Transcode sind deterministisch).
    if (!(await speicher.info(`media/${posterName}`))) {
      const posterTemp = join(arbeitsdir, 'poster.jpg')
      await werkzeug.erzeugePoster(quellTemp, posterTemp, posterZeitpunkt(info.dauerS))
      await speicher.schreibe(`media/${posterName}`, await readFile(posterTemp))
    }

    // Zwei Gründe, eine eigene Auslieferungsdatei zu erzeugen — und beide
    // enden in derselben `m1.web.mp4`:
    //   1. Der Inhalt ist nicht web-tauglich (HEVC, .mov …) → neu codieren.
    //   2. Er ist tauglich, aber der Index liegt hinten → nur umschreiben.
    // Fall 2 ist der Alltagsfall der App: Ein Pixel liefert H.264/AAC in .mp4
    // und wurde deshalb unangetastet durchgereicht — samt `moov` am Ende, das
    // jede Wiedergabe um Sekunden verzögerte (s. hatFaststart).
    let videoDatei = quellDatei
    if (originalDa && mussWebKonvertiert(info, originalDatei)) {
      videoDatei = webName
      if (!(await speicher.info(`media/${webName}`))) {
        const webTemp = join(arbeitsdir, 'web.mp4')
        await werkzeug.transkodiere(quellTemp, webTemp)
        await speicher.schreibe(`media/${webName}`, await readFile(webTemp))
      }
    } else if (originalDa && !hatFaststart(rohdaten)) {
      videoDatei = webName
      if (!(await speicher.info(`media/${webName}`))) {
        const webTemp = join(arbeitsdir, 'web.mp4')
        await werkzeug.remuxeFaststart(quellTemp, webTemp)
        await speicher.schreibe(`media/${webName}`, await readFile(webTemp))
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
    if (videoDatei !== originalDatei && originalDa) {
      await speicher.loesche(`media/${originalDatei}`)
    }
    const masterDatei = videoDatei

    // Video-Schnitt (Etappe 4): eine eigene Auslieferungsdatei aus dem Master.
    // Geklemmt wird auf das Material — Trimmen legt frei, was da ist. Ohne
    // wirksamen Schnitt bleibt alles, wie es war (kein Transcode, keine Datei).
    const wirksam = klemmeSchnitt(schnitt, info.dauerS)
    if (wirksam) {
      const schnittTemp = join(arbeitsdir, 'schnitt.mp4')
      await werkzeug.schneide(quellTemp, schnittTemp, wirksam.vonS, wirksam.bisS)
      await speicher.schreibe(`media/${schnittName}`, await readFile(schnittTemp))
      // Das Poster zeigt den ersten Frame der AUSGELIEFERTEN Fassung — sonst
      // stünde dort ein Bild, das im Film gar nicht mehr vorkommt.
      const posterTemp = join(arbeitsdir, 'poster-schnitt.jpg')
      await werkzeug.erzeugePoster(schnittTemp, posterTemp, posterZeitpunkt(0))
      await speicher.schreibe(`media/${posterName}`, await readFile(posterTemp))
      return {
        dauerS: (wirksam.bisS ?? info.dauerS) - wirksam.vonS,
        videoDatei: schnittName,
        posterDatei: posterName,
        quellDauerS: info.dauerS,
      }
    }
    // Kein (wirksamer) Schnitt mehr: eine frühere Schnittfassung ist jetzt
    // totes Gewicht — der Master liegt ja noch. Das Poster zeigt dann noch den
    // ersten Frame des ALTEN Ausschnitts und muss mit zurück.
    if (await speicher.info(`media/${schnittName}`)) {
      await speicher.loesche(`media/${schnittName}`)
      const posterTemp = join(arbeitsdir, 'poster-ganz.jpg')
      await werkzeug.erzeugePoster(quellTemp, posterTemp, posterZeitpunkt(info.dauerS))
      await speicher.schreibe(`media/${posterName}`, await readFile(posterTemp))
    }

    return { dauerS: info.dauerS, videoDatei: masterDatei, posterDatei: posterName, quellDauerS: info.dauerS }
  } finally {
    await rm(arbeitsdir, { recursive: true, force: true })
  }
}

/**
 * Alle Videos einer Tour aufbereiten. Fehlertolerant je Video: ein kaputtes
 * Video lässt die Tour nicht scheitern (protokoll-Hinweis, Eintrag fehlt in der
 * Map → enrich.ts liefert dann das Original ohne Poster aus).
 */
export async function bereiteVideosAuf(eingabe: {
  medien: Array<{ id: string; originalDatei: string; schnitt?: VideoSchnitt }>
  speicher: VideoSpeicher
  werkzeug: VideoWerkzeug
  protokoll?: (nachricht: string) => void
}): Promise<Map<string, VideoMeta>> {
  const { medien, speicher, werkzeug, protokoll } = eingabe
  const meta = new Map<string, VideoMeta>()
  for (const m of medien) {
    try {
      meta.set(m.id, await bereiteEinVideoAuf(m.id, m.originalDatei, speicher, werkzeug, m.schnitt))
    } catch (fehler) {
      protokoll?.(`Video-Aufbereitung fehlgeschlagen (${m.id}): ${(fehler as Error).message}`)
    }
  }
  return meta
}
