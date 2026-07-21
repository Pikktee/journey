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

/** Ablage-Name des Posters (zwei Punkt-Segmente → nie ein Upload-Medienname). */
export function posterDateiname(mediumId: string): string {
  return `${mediumId}.poster.jpg`
}

/** Ablage-Name des transkodierten Videos (nur wenn transkodiert wurde). */
export function webVideoDateiname(mediumId: string): string {
  return `${mediumId}.web.mp4`
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
  dauerS: number
  /** Auszuliefernde Videodatei (transkodiert, sonst Original) */
  videoDatei: string
  /** Poster-JPEG */
  posterDatei: string
}

/** Schmaler Storage-Ausschnitt, den die Aufbereitung braucht (Storage erfüllt ihn). */
export interface VideoSpeicher {
  lese(relPfad: string): Promise<Buffer>
  schreibe(relPfad: string, inhalt: Buffer): Promise<void>
  info(relPfad: string): Promise<{ groesse: number } | null>
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

  async erzeugePoster(_quellPfad: string, zielPfad: string): Promise<void> {
    this.aufrufe.push('poster')
    await writeFile(zielPfad, Buffer.from('FAKE-POSTER-JPEG'))
  }
}

/** Ein einzelnes Video aufbereiten: Poster immer, Transcode nur bei Bedarf. */
async function bereiteEinVideoAuf(
  mediumId: string,
  originalDatei: string,
  speicher: VideoSpeicher,
  werkzeug: VideoWerkzeug,
): Promise<VideoMeta> {
  const posterName = posterDateiname(mediumId)
  const webName = webVideoDateiname(mediumId)
  const endung = originalDatei.split('.').pop() ?? 'mp4'

  const arbeitsdir = await mkdtemp(join(tmpdir(), 'luhambo-video-'))
  const quellTemp = join(arbeitsdir, `quelle.${endung}`)
  try {
    await writeFile(quellTemp, await speicher.lese(`media/${originalDatei}`))
    const info = await werkzeug.probe(quellTemp)

    // Poster nur erzeugen, wenn es noch nicht liegt (Re-Render nach PATCH soll
    // nicht jedes Mal ffmpeg anwerfen — Poster/Transcode sind deterministisch).
    if (!(await speicher.info(`media/${posterName}`))) {
      const posterTemp = join(arbeitsdir, 'poster.jpg')
      await werkzeug.erzeugePoster(quellTemp, posterTemp, posterZeitpunkt(info.dauerS))
      await speicher.schreibe(`media/${posterName}`, await readFile(posterTemp))
    }

    let videoDatei = originalDatei
    if (mussWebKonvertiert(info, originalDatei)) {
      videoDatei = webName
      if (!(await speicher.info(`media/${webName}`))) {
        const webTemp = join(arbeitsdir, 'web.mp4')
        await werkzeug.transkodiere(quellTemp, webTemp)
        await speicher.schreibe(`media/${webName}`, await readFile(webTemp))
      }
    }

    return { dauerS: info.dauerS, videoDatei, posterDatei: posterName }
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
  medien: Array<{ id: string; originalDatei: string }>
  speicher: VideoSpeicher
  werkzeug: VideoWerkzeug
  protokoll?: (nachricht: string) => void
}): Promise<Map<string, VideoMeta>> {
  const { medien, speicher, werkzeug, protokoll } = eingabe
  const meta = new Map<string, VideoMeta>()
  for (const m of medien) {
    try {
      meta.set(m.id, await bereiteEinVideoAuf(m.id, m.originalDatei, speicher, werkzeug))
    } catch (fehler) {
      protokoll?.(`Video-Aufbereitung fehlgeschlagen (${m.id}): ${(fehler as Error).message}`)
    }
  }
  return meta
}
