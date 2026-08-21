// Foto-Aufbereitung: aus dem hochgeladenen Original zwei abgeleitete Fassungen
// — eine Anzeige-Fassung für den Player und eine Kachel-Fassung für Listen und
// Zeitleiste. Danach wird das ORIGINAL VERWORFEN.
//
// Warum überhaupt: Ein Handyfoto ist 3–5 MB bei 3072×4080 px. Angezeigt wird es
// im Foto-Overlay (nie größer als der Bildschirm) und als Kachel von 300 px.
// Gemessen an einer echten Tour mit acht Fotos: 26,5 MB Originale → 3,1 MB
// Fassungen, ohne sichtbaren Unterschied in der Wiedergabe.
//
// Wie bei Poster und Transcode (video.ts) sind die Fassungen abgeleitete
// GESCHWISTER-Dateien mit zwei Punkt-Segmenten im Namen — die kollidieren nie
// mit einem Upload-Medium und dürfen deshalb neben ihm liegen.
//
// I/O-Grenze wie bei den Videos: ffmpeg spricht nur Dateipfade, also liest die
// Orchestrierung über den (abstrakten) Storage in eine Temp-Datei und schreibt
// das Ergebnis zurück. Das eigentliche Skalieren steckt hinter BildWerkzeug,
// Tests injizieren einen Fake.

import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)

/** Längste Kante der Anzeige-Fassung — deckt auch ein Retina-Vollbild ab. */
export const DISPLAY_EDGE = 1920
/** Längste Kante der Kachel-Fassung (Listen zeigen ~300 px, Zeitleiste weniger). */
export const THUMB_EDGE = 480

// ffmpeg-Güte (2–31, kleiner = besser). An echten Fotos gemessen: Anzeige 4 ≈
// 240–650 KB, Kachel 5 ≈ 20–40 KB. Höhere Güte kostet spürbar Platz, ohne dass
// im Overlay etwas dazukäme; niedrigere zeigt bei Ken-Burns-Zoom Artefakte.
const DISPLAY_QUALITY = 4
const THUMB_QUALITY = 5

/** Ablage-Name der Anzeige-Fassung (zwei Punkt-Segmente → nie ein Upload-Name). */
export function displayFilename(mediumId: string): string {
  return `${mediumId}.w${DISPLAY_EDGE}.jpg`
}

/** Ablage-Name der Kachel-Fassung. */
export function thumbFilename(mediumId: string): string {
  return `${mediumId}.t${THUMB_EDGE}.jpg`
}

export interface ImageTool {
  /**
   * Auf die längste Kante `kante` bringen (nie hochskalieren) und dabei die
   * EXIF-Drehung 1–8 in die Pixel einrechnen.
   */
  scale(
    sourcePath: string,
    targetPath: string,
    opt: { edge: number; quality: number; orientation: number },
  ): Promise<void>
}

/**
 * EXIF-Drehung → ffmpeg-Filter. ffmpeg wertet die Drehung eines JPEGs NICHT
 * selbst aus (`-autorotate` gilt nur für Video-Rotationsmetadaten); ohne diese
 * Tabelle läge jedes Hochformat-Foto quer, sobald wir das EXIF nicht mitgeben —
 * und bei der Kachel-Fassung geben wir es bewusst nicht mit.
 */
const ORIENTATION_FILTER: Record<number, string> = {
  2: 'hflip',
  3: 'hflip,vflip',
  4: 'vflip',
  5: 'transpose=0',
  6: 'transpose=1',
  7: 'transpose=3',
  8: 'transpose=2',
}

/** Die echte ffmpeg-Anbindung (nur in Produktion; Tests nutzen den Fake). */
export class FfmpegImageTool implements ImageTool {
  constructor(private readonly ffmpeg = 'ffmpeg') {}

  async scale(
    sourcePath: string,
    targetPath: string,
    { edge, quality, orientation }: { edge: number; quality: number; orientation: number },
  ): Promise<void> {
    // Erst drehen, dann in die QUADRATISCHE Box skalieren: so begrenzt eine
    // einzige Angabe die längste Kante, unabhängig von Hoch- oder Querformat.
    const chain = [
      ORIENTATION_FILTER[orientation],
      `scale=w='min(${edge},iw)':h='min(${edge},ih)':force_original_aspect_ratio=decrease`,
    ]
      .filter(Boolean)
      .join(',')
    // HEIC/HEIF braucht einen Zwischenschritt — s. `isTiledImage`.
    const source = isTiledImage(sourcePath) ? await this.mergeTiles(sourcePath) : sourcePath
    try {
      await execFileP(
        this.ffmpeg,
        [
          '-y',
          '-loglevel',
          'error',
          '-i',
          source,
          '-vf',
          chain,
          '-q:v',
          String(quality),
          targetPath,
        ],
        { maxBuffer: 8 * 1024 * 1024 },
      )
    } finally {
      if (source !== sourcePath) await rm(source, { force: true })
    }
  }

  /**
   * Ein HEIF-Bild in eine gewöhnliche Datei auflösen — verlustfrei als PNG.
   *
   * **Warum überhaupt zwei Läufe.** Ein HEIC vom Telefon besteht aus KACHELN
   * (das Beispiel: vier Streams à 512×512 für ein Bild von 1024×1024). ffmpeg
   * setzt sie selbst zusammen, aber nur über einen komplexen Filtergraphen —
   * und der verträgt sich nicht mit unserem `-vf`; der Aufruf endet mit
   * „Simple and complex filtering cannot be used together".
   *
   * Der naheliegende Ausweg ist eine Falle: `-filter_complex "[0:v]scale=…"`
   * läuft anstandslos durch und liefert ein plausibel aussehendes Bild —
   * nämlich KACHEL NULL, also das linke obere Viertel. Gemessen gegen das
   * richtige Bild: SSIM 0,45. Aufgefallen wäre es erst an den Fotos einer
   * fertigen Tour.
   *
   * Ohne Filter macht ffmpeg es dagegen von selbst richtig (SSIM 0,98 nach dem
   * zweiten Lauf; der Rest ist JPEG-Rundung). PNG als Zwischenformat, damit
   * nicht zweimal JPEG-Verluste übereinanderliegen.
   */
  private async mergeTiles(sourcePath: string): Promise<string> {
    const target = `${sourcePath}.stitch.png`
    await execFileP(this.ffmpeg, ['-y', '-loglevel', 'error', '-i', sourcePath, target], {
      maxBuffer: 8 * 1024 * 1024,
    })
    return target
  }
}

/**
 * Bilder, die vor dem Skalieren aufgelöst werden müssen.
 *
 * An der ENDUNG erkannt und nicht am Inhalt: Der Ablagename entsteht aus der
 * geprüften Endung des Uploads (`mediumFilename`), ist also keine Behauptung
 * des Clients, sondern eine Zusage des Servers.
 */
export function isTiledImage(path: string): boolean {
  const extension = path.toLowerCase().split('.').pop()
  return extension === 'heic' || extension === 'heif'
}

/**
 * Test-Fake: schreibt ein Minimal-JPEG (echtes SOI, damit der EXIF-Übertrag
 * greift) und protokolliert die Aufrufe als „kante:drehung".
 */
export class FakeImageTool implements ImageTool {
  public readonly calls: string[] = []

  async scale(
    _sourcePath: string,
    targetPath: string,
    { edge, orientation }: { edge: number; quality: number; orientation: number },
  ): Promise<void> {
    this.calls.push(`${edge}:${orientation}`)
    // FFD8 (SOI) + FFDA (SOS) — genug Gerüst, damit mitExif einsetzen kann
    await writeFile(targetPath, Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02]))
  }
}

// ————————————————————————————————————————————————
//  EXIF: was die Datei über die Aufnahme weiß
// ————————————————————————————————————————————————
//
// ffmpeg wirft beim Skalieren den kompletten EXIF-Block weg. Der Studio-Editor
// liest die Aufnahme-Details (Kamera, Objektiv, Belichtung) aber clientseitig
// aus der AUSGELIEFERTEN Datei — und sobald das Original verworfen ist, ist die
// Anzeige-Fassung die einzige verbliebene Quelle. Also wird der Block von Hand
// übertragen. Nur der Exif-APP1: die XMP-Blöcke daneben (bei einem Testfoto
// 87 KB) trägt niemand, und die Kachel-Fassung bekommt gar keinen.

const SOI = 0xd8
const SOS = 0xda
const APP1 = 0xe1
const EXIF_SIGNATURE = 'Exif\0\0'
const ORIENTATION_TAG = 0x0112

/** Der Exif-APP1-Block eines JPEGs (inkl. Marker und Länge), sonst null. */
export function readExifBlock(jpeg: Buffer): Buffer | null {
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== SOI) return null
  let pos = 2
  // Segmentkette ablaufen bis zu den Bilddaten (SOS); alles davor hat einen
  // 2-Byte-Längenkopf. Jede Grenze wird geprüft — die Datei kommt vom Nutzer.
  while (pos + 4 <= jpeg.length && jpeg[pos] === 0xff) {
    const marker = jpeg[pos + 1]
    if (marker === SOS) break
    const length = jpeg.readUInt16BE(pos + 2)
    if (length < 2 || pos + 2 + length > jpeg.length) break
    if (marker === APP1 && jpeg.toString('latin1', pos + 4, pos + 10) === EXIF_SIGNATURE) {
      return jpeg.subarray(pos, pos + 2 + length)
    }
    pos += 2 + length
  }
  return null
}

/** Position des Orientierungs-Werts im Block (samt Byte-Reihenfolge), sonst null. */
function findOrientation(block: Buffer): { offset: number; bigEndian: boolean } | null {
  // Der TIFF-Kopf beginnt hinter Marker (2) + Länge (2) + „Exif\0\0" (6)
  const tiff = 10
  if (block.length < tiff + 8) return null
  const byteOrder = block.toString('latin1', tiff, tiff + 2)
  const bigEndian = byteOrder === 'MM'
  if (!bigEndian && byteOrder !== 'II') return null
  const read16 = (o: number): number => (bigEndian ? block.readUInt16BE(o) : block.readUInt16LE(o))
  const read32 = (o: number): number => (bigEndian ? block.readUInt32BE(o) : block.readUInt32LE(o))
  if (read16(tiff + 2) !== 0x2a) return null
  const ifd0 = tiff + read32(tiff + 4)
  if (ifd0 + 2 > block.length) return null
  const count = read16(ifd0)
  for (let i = 0; i < count; i++) {
    const entry = ifd0 + 2 + i * 12
    if (entry + 12 > block.length) break
    // Tag (2) · Typ (2) · Anzahl (4) · Wert (4) — ein SHORT steht im Feld selbst
    if (read16(entry) === ORIENTATION_TAG) return { offset: entry + 8, bigEndian }
  }
  return null
}

/** EXIF-Drehung 1–8; ohne Block oder Tag gilt 1 (schon richtig herum). */
export function readOrientation(block: Buffer | null): number {
  if (!block) return 1
  const field = findOrientation(block)
  if (!field) return 1
  const value = field.bigEndian
    ? block.readUInt16BE(field.offset)
    : block.readUInt16LE(field.offset)
  return value >= 1 && value <= 8 ? value : 1
}

/**
 * Kopie des Blocks mit Drehung „1".
 *
 * Unverzichtbar, weil die Drehung beim Skalieren bereits in die PIXEL gewandert
 * ist: Bliebe die alte Angabe stehen, drehte der Browser ein zweites Mal und
 * jedes Hochformat-Foto läge quer.
 */
export function withoutOrientation(block: Buffer): Buffer {
  const copy = Buffer.from(block)
  const field = findOrientation(copy)
  if (!field) return copy
  if (field.bigEndian) copy.writeUInt16BE(1, field.offset)
  else copy.writeUInt16LE(1, field.offset)
  return copy
}

/** Block direkt hinter SOI einsetzen (dort erwartet ihn jeder Leser). */
export function withExif(jpeg: Buffer, block: Buffer): Buffer {
  if (jpeg.length < 2 || jpeg[0] !== 0xff || jpeg[1] !== SOI) return jpeg
  return Buffer.concat([jpeg.subarray(0, 2), block, jpeg.subarray(2)])
}

// ————————————————————————————————————————————————
//  Orchestrierung
// ————————————————————————————————————————————————

export interface PhotoInput {
  id: string
  /** Datei, aus der die Fassungen entstehen: Foto-Original bzw. Video-Poster */
  sourceFile: string
  /**
   * Braucht das Medium eine eigene Anzeige-Fassung?
   *
   * Fotos ja — sie TRITT AN DIE STELLE des Originals, das danach verworfen
   * wird. Video-Poster nein: das Poster ist bereits eine abgeleitete Datei in
   * Anzeigegröße und bleibt das Standbild; es braucht nur eine Kachel.
   */
  display: boolean
}

export interface PhotoMeta {
  /** Anzeige-Fassung; null beim Video-Poster (dort bleibt das Poster) */
  displayFile: string | null
  thumbFile: string
}

/** Schmaler Storage-Ausschnitt, den die Aufbereitung braucht (Storage erfüllt ihn). */
export interface ImageStorage {
  read(relPath: string): Promise<Buffer>
  write(relPath: string, content: Buffer): Promise<void>
  info(relPath: string): Promise<{ size: number } | null>
  remove(relPath: string): Promise<void>
}

async function preparePhoto(
  m: PhotoInput,
  storage: ImageStorage,
  tool: ImageTool,
): Promise<PhotoMeta> {
  const displayName = displayFilename(m.id)
  const thumbName = thumbFilename(m.id)
  const meta: PhotoMeta = { displayFile: m.display ? displayName : null, thumbFile: thumbName }

  const displayMissing = m.display && !(await storage.info(`media/${displayName}`))
  const thumbMissing = !(await storage.info(`media/${thumbName}`))
  // Idempotenz wie bei Poster/Transcode: liegt alles, wird die Quelle nicht
  // einmal gelesen. Das trägt den Regelfall — jedes Edit-Speichern rendert neu.
  if (!displayMissing && !thumbMissing) return meta

  // Quelle ist das Original; ist es schon verworfen, tritt die Anzeige-Fassung
  // an seine Stelle (so entsteht eine fehlende Kachel auch nachträglich noch).
  const originalPresent = !!(await storage.info(`media/${m.sourceFile}`))
  const source = originalPresent ? m.sourceFile : !displayMissing && m.display ? displayName : null
  if (!source) throw new Error(`Bilddatei fehlt: ${m.sourceFile}`)

  const raw = await storage.read(`media/${source}`)
  const exif = readExifBlock(raw)
  const orientation = readOrientation(exif)
  const extension = source.split('.').pop() ?? 'jpg'

  const workDir = await mkdtemp(join(tmpdir(), 'maptale-bild-'))
  try {
    const sourceTemp = join(workDir, `quelle.${extension}`)
    await writeFile(sourceTemp, raw)

    if (displayMissing) {
      const target = join(workDir, 'anzeige.jpg')
      await tool.scale(sourceTemp, target, {
        edge: DISPLAY_EDGE,
        quality: DISPLAY_QUALITY,
        orientation,
      })
      const rotated = await readFile(target)
      await storage.write(
        `media/${displayName}`,
        exif ? withExif(rotated, withoutOrientation(exif)) : rotated,
      )
    }
    if (thumbMissing) {
      const target = join(workDir, 'thumb.jpg')
      await tool.scale(sourceTemp, target, {
        edge: THUMB_EDGE,
        quality: THUMB_QUALITY,
        orientation,
      })
      // Ohne EXIF: der Block eines Testfotos war 42 KB — mehr als die Kachel
      // selbst. Gelesen wird er ohnehin nur an der Anzeige-Fassung.
      await storage.write(`media/${thumbName}`, await readFile(target))
    }
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }

  // Erst jetzt, mit beiden Fassungen im Storage: das Original ist ersetzt.
  // Vorher zu löschen hieße, bei einem Abbruch alles zu verlieren.
  if (m.display && originalPresent && m.sourceFile !== displayName) {
    await storage.remove(`media/${m.sourceFile}`)
  }
  return meta
}

/**
 * Alle Fotos einer Tour aufbereiten. Fehlertolerant je Bild: ein unlesbares
 * Foto lässt die Tour nicht scheitern (Hinweis ins Protokoll, Eintrag fehlt in
 * der Map → enrich.ts liefert dann weiter das Original aus).
 */
export async function preparePhotos(input: {
  media: PhotoInput[]
  storage: ImageStorage
  tool: ImageTool
  log?: (message: string) => void
}): Promise<Map<string, PhotoMeta>> {
  const { media, storage, tool, log } = input
  const meta = new Map<string, PhotoMeta>()
  for (const m of media) {
    try {
      meta.set(m.id, await preparePhoto(m, storage, tool))
    } catch (error) {
      log?.(`Foto-Aufbereitung fehlgeschlagen (${m.id}): ${(error as Error).message}`)
    }
  }
  return meta
}
