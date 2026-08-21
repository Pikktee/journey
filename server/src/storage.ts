// Storage-Abstraktion für alle Tour-Dateien (Manifest, Medien, tour.json).
// Bewusst hinter einem schmalen Interface: die FS-Implementierung läuft auf dem
// VPS, der Speicher-Fake in Tests, und ein späterer Objektspeicher (R2) wird
// ein Drop-in, ohne dass Routen oder Pipeline sich ändern.

import { randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, normalize, sep } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export interface FileStat {
  size: number
}

export interface Storage {
  /** Datei komplett schreiben (kleine Dateien: Manifest, tour.json) */
  write(tourId: string, relPath: string, content: Buffer | string): Promise<void>
  /** Datei aus einem Stream schreiben (Medien-Uploads); atomar via Temp-Datei */
  writeStream(
    tourId: string,
    relPath: string,
    source: Readable,
    maxBytes: number,
  ): Promise<FileStat>
  read(tourId: string, relPath: string): Promise<Buffer>
  info(tourId: string, relPath: string): Promise<FileStat | null>
  /** Lese-Stream mit optionalem Byte-Bereich (für HTTP-Range/Video-Seeking) */
  readStream(tourId: string, relPath: string, range?: { start: number; end: number }): Readable
  /** Einzelne Datei löschen (Audio-Assets, Baukasten); fehlende Datei ist ok */
  remove(tourId: string, relPath: string): Promise<void>
  /** Dateien eines Unterordners auflisten (nicht-rekursiv); fehlender Ordner → [] */
  listFiles(tourId: string, subdir: string): Promise<Array<{ name: string; size: number }>>
  /**
   * ALLE Dateien rekursiv, mit ihrem Pfad relativ zur Tour (`media/m1.w1920.jpg`).
   *
   * Die Grundlage von `totalSize` und der Speicher-Aufschlüsselung im Konto:
   * Wer wissen will, wie viel davon Fotos sind, braucht die Namen — eine zweite
   * Summierfunktion daneben liefe irgendwann anders als diese.
   */
  allFiles(tourId: string): Promise<Array<{ path: string; size: number }>>
  /** Summe aller Bytes einer Tour (rekursiv über alle Unterordner) — für die Quota (M9) */
  totalSize(tourId: string): Promise<number>
  removeTour(tourId: string): Promise<void>
}

/** Wird geworfen, wenn ein Upload das Größenlimit überschreitet. */
export class TooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Datei überschreitet das Limit von ${maxBytes} Bytes`)
    this.name = 'TooLargeError'
  }
}

// Pfade kommen teils aus Client-Daten (Dateinamen) — niemals aus dem
// Tour-Verzeichnis ausbrechen lassen. Die Grenze prüft MIT Pfadtrenner:
// ein bloßes startsWith ließe Geschwister wie „<tourId>-boese" durch.
function safePath(base: string, tourId: string, relPath: string): string {
  const full = normalize(join(base, tourId, relPath))
  const root = normalize(join(base, tourId))
  if (full !== root && !full.startsWith(root + sep))
    throw new Error(`Unzulässiger Pfad: ${relPath}`)
  return full
}

export class FsStorage implements Storage {
  constructor(private readonly baseDir: string) {}

  private path(tourId: string, relPath: string): string {
    return safePath(this.baseDir, tourId, relPath)
  }

  async write(tourId: string, relPath: string, content: Buffer | string): Promise<void> {
    const target = this.path(tourId, relPath)
    await mkdir(dirname(target), { recursive: true })
    // Atomar via Temp + rename: tour.json wird beim Re-Render überschrieben,
    // während der Player es lesen kann — nie halbe Dateien ausliefern.
    const temp = `${target}.${randomUUID()}.tmp`
    await writeFile(temp, content)
    await rename(temp, target)
  }

  async writeStream(
    tourId: string,
    relPath: string,
    source: Readable,
    maxBytes: number,
  ): Promise<FileStat> {
    const target = this.path(tourId, relPath)
    await mkdir(dirname(target), { recursive: true })
    // Erst in Temp-Datei (mit Zufallsnamen: parallele PUTs desselben Mediums
    // dürfen sich nicht dieselbe Temp-Datei teilen), dann umbenennen — ein
    // abgebrochener Upload hinterlässt nie eine halbe Datei unter dem Zielnamen.
    const temp = `${target}.${randomUUID()}.hochladend`
    let bytes = 0
    try {
      await pipeline(
        source,
        async function* (chunks: AsyncIterable<Buffer>) {
          for await (const chunk of chunks) {
            bytes += chunk.length
            if (bytes > maxBytes) throw new TooLargeError(maxBytes)
            yield chunk
          }
        },
        createWriteStream(temp),
      )
    } catch (error) {
      await rm(temp, { force: true })
      throw error
    }
    await rename(temp, target)
    return { size: bytes }
  }

  async read(tourId: string, relPath: string): Promise<Buffer> {
    return readFile(this.path(tourId, relPath))
  }

  async info(tourId: string, relPath: string): Promise<FileStat | null> {
    try {
      const s = await stat(this.path(tourId, relPath))
      return s.isFile() ? { size: s.size } : null
    } catch {
      return null
    }
  }

  readStream(tourId: string, relPath: string, range?: { start: number; end: number }): Readable {
    const path = this.path(tourId, relPath)
    return range
      ? createReadStream(path, { start: range.start, end: range.end })
      : createReadStream(path)
  }

  async remove(tourId: string, relPath: string): Promise<void> {
    await rm(this.path(tourId, relPath), { force: true })
  }

  async listFiles(tourId: string, subdir: string): Promise<Array<{ name: string; size: number }>> {
    const dir = this.path(tourId, subdir)
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return [] // fehlender Ordner = keine Dateien (Tour ohne Medien/Audio)
    }
    const files: Array<{ name: string; size: number }> = []
    for (const entry of entries) {
      if (!entry.isFile()) continue // nicht-rekursiv: Unterordner ignorieren
      const s = await stat(join(dir, entry.name))
      files.push({ name: entry.name, size: s.size })
    }
    // Deterministische Reihenfolge (readdir garantiert keine) — Fs und Mem
    // verhalten sich gleich, Tests und Editor-Listen bleiben stabil.
    return files.sort((a, b) => a.name.localeCompare(b.name))
  }

  async allFiles(tourId: string): Promise<Array<{ path: string; size: number }>> {
    const root = safePath(this.baseDir, tourId, '.')
    const files: Array<{ path: string; size: number }> = []
    const walk = async (dir: string, prefix: string): Promise<void> => {
      let entries
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch {
        return // Tour ohne Verzeichnis (noch nichts hochgeladen)
      }
      for (const entry of entries) {
        const path = join(dir, entry.name)
        // Relativ und immer mit `/`: Die Aufrufer lesen den Pfad (Ordner,
        // Endung), und ein Backslash unter Windows wäre eine stille Ausnahme.
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name
        if (entry.isDirectory()) await walk(path, rel)
        else if (entry.isFile()) files.push({ path: rel, size: (await stat(path)).size })
      }
    }
    await walk(root, '')
    return files
  }

  async totalSize(tourId: string): Promise<number> {
    return (await this.allFiles(tourId)).reduce((sum, d) => sum + d.size, 0)
  }

  async removeTour(tourId: string): Promise<void> {
    await rm(safePath(this.baseDir, tourId, '.'), { recursive: true, force: true })
  }
}

/** In-Memory-Storage für Tests: gleiche Semantik, kein Dateisystem. */
export class MemStorage implements Storage {
  private files = new Map<string, Buffer>()

  private key(tourId: string, relPath: string): string {
    return `${tourId}/${normalize(relPath)}`
  }

  async write(tourId: string, relPath: string, content: Buffer | string): Promise<void> {
    this.files.set(this.key(tourId, relPath), Buffer.from(content))
  }

  async writeStream(
    tourId: string,
    relPath: string,
    source: Readable,
    maxBytes: number,
  ): Promise<FileStat> {
    const parts: Buffer[] = []
    let bytes = 0
    for await (const chunk of source) {
      const buf = Buffer.from(chunk)
      bytes += buf.length
      if (bytes > maxBytes) throw new TooLargeError(maxBytes)
      parts.push(buf)
    }
    this.files.set(this.key(tourId, relPath), Buffer.concat(parts))
    return { size: bytes }
  }

  async read(tourId: string, relPath: string): Promise<Buffer> {
    const content = this.files.get(this.key(tourId, relPath))
    if (!content) throw Object.assign(new Error('nicht gefunden'), { code: 'ENOENT' })
    return content
  }

  async info(tourId: string, relPath: string): Promise<FileStat | null> {
    const content = this.files.get(this.key(tourId, relPath))
    return content ? { size: content.length } : null
  }

  readStream(tourId: string, relPath: string, range?: { start: number; end: number }): Readable {
    const content = this.files.get(this.key(tourId, relPath))
    if (!content) throw Object.assign(new Error('nicht gefunden'), { code: 'ENOENT' })
    const slice = range ? content.subarray(range.start, range.end + 1) : content
    return Readable.from([slice])
  }

  async remove(tourId: string, relPath: string): Promise<void> {
    this.files.delete(this.key(tourId, relPath))
  }

  async listFiles(tourId: string, subdir: string): Promise<Array<{ name: string; size: number }>> {
    const prefix = `${this.key(tourId, subdir)}/`
    const files: Array<{ name: string; size: number }> = []
    for (const [key, content] of this.files) {
      if (!key.startsWith(prefix)) continue
      const name = key.slice(prefix.length)
      if (name.includes('/')) continue // nicht-rekursiv (gleiche Semantik wie FsStorage)
      files.push({ name, size: content.length })
    }
    return files.sort((a, b) => a.name.localeCompare(b.name))
  }

  async allFiles(tourId: string): Promise<Array<{ path: string; size: number }>> {
    const prefix = `${tourId}/`
    const files: Array<{ path: string; size: number }> = []
    for (const [key, content] of this.files) {
      if (key.startsWith(prefix))
        files.push({ path: key.slice(prefix.length), size: content.length })
    }
    return files.sort((a, b) => a.path.localeCompare(b.path))
  }

  async totalSize(tourId: string): Promise<number> {
    return (await this.allFiles(tourId)).reduce((sum, d) => sum + d.size, 0)
  }

  async removeTour(tourId: string): Promise<void> {
    for (const key of this.files.keys()) {
      if (key.startsWith(`${tourId}/`)) this.files.delete(key)
    }
  }
}
