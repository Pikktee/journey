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

export interface DateiInfo {
  groesse: number
}

export interface Storage {
  /** Datei komplett schreiben (kleine Dateien: Manifest, tour.json) */
  schreibe(tourId: string, relPfad: string, inhalt: Buffer | string): Promise<void>
  /** Datei aus einem Stream schreiben (Medien-Uploads); atomar via Temp-Datei */
  schreibeStream(tourId: string, relPfad: string, quelle: Readable, maxBytes: number): Promise<DateiInfo>
  lese(tourId: string, relPfad: string): Promise<Buffer>
  info(tourId: string, relPfad: string): Promise<DateiInfo | null>
  /** Lese-Stream mit optionalem Byte-Bereich (für HTTP-Range/Video-Seeking) */
  leseStream(tourId: string, relPfad: string, bereich?: { start: number; ende: number }): Readable
  /** Einzelne Datei löschen (Audio-Assets, Baukasten); fehlende Datei ist ok */
  loesche(tourId: string, relPfad: string): Promise<void>
  /** Dateien eines Unterordners auflisten (nicht-rekursiv); fehlender Ordner → [] */
  listeDateien(tourId: string, unterordner: string): Promise<Array<{ name: string; groesse: number }>>
  /** Summe aller Bytes einer Tour (rekursiv über alle Unterordner) — für die Quota (M9) */
  gesamtGroesse(tourId: string): Promise<number>
  loescheTour(tourId: string): Promise<void>
}

/** Wird geworfen, wenn ein Upload das Größenlimit überschreitet. */
export class ZuGrossFehler extends Error {
  constructor(maxBytes: number) {
    super(`Datei überschreitet das Limit von ${maxBytes} Bytes`)
    this.name = 'ZuGrossFehler'
  }
}

// Pfade kommen teils aus Client-Daten (Dateinamen) — niemals aus dem
// Tour-Verzeichnis ausbrechen lassen. Die Grenze prüft MIT Pfadtrenner:
// ein bloßes startsWith ließe Geschwister wie „<tourId>-boese" durch.
function sicherePfad(basis: string, tourId: string, relPfad: string): string {
  const voll = normalize(join(basis, tourId, relPfad))
  const wurzel = normalize(join(basis, tourId))
  if (voll !== wurzel && !voll.startsWith(wurzel + sep)) throw new Error(`Unzulässiger Pfad: ${relPfad}`)
  return voll
}

export class FsStorage implements Storage {
  constructor(private readonly basisDir: string) {}

  private pfad(tourId: string, relPfad: string): string {
    return sicherePfad(this.basisDir, tourId, relPfad)
  }

  async schreibe(tourId: string, relPfad: string, inhalt: Buffer | string): Promise<void> {
    const ziel = this.pfad(tourId, relPfad)
    await mkdir(dirname(ziel), { recursive: true })
    // Atomar via Temp + rename: tour.json wird beim Re-Render überschrieben,
    // während der Player es lesen kann — nie halbe Dateien ausliefern.
    const temp = `${ziel}.${randomUUID()}.tmp`
    await writeFile(temp, inhalt)
    await rename(temp, ziel)
  }

  async schreibeStream(tourId: string, relPfad: string, quelle: Readable, maxBytes: number): Promise<DateiInfo> {
    const ziel = this.pfad(tourId, relPfad)
    await mkdir(dirname(ziel), { recursive: true })
    // Erst in Temp-Datei (mit Zufallsnamen: parallele PUTs desselben Mediums
    // dürfen sich nicht dieselbe Temp-Datei teilen), dann umbenennen — ein
    // abgebrochener Upload hinterlässt nie eine halbe Datei unter dem Zielnamen.
    const temp = `${ziel}.${randomUUID()}.hochladend`
    let gross = 0
    try {
      await pipeline(
        quelle,
        async function* (chunks: AsyncIterable<Buffer>) {
          for await (const chunk of chunks) {
            gross += chunk.length
            if (gross > maxBytes) throw new ZuGrossFehler(maxBytes)
            yield chunk
          }
        },
        createWriteStream(temp),
      )
    } catch (fehler) {
      await rm(temp, { force: true })
      throw fehler
    }
    await rename(temp, ziel)
    return { groesse: gross }
  }

  async lese(tourId: string, relPfad: string): Promise<Buffer> {
    return readFile(this.pfad(tourId, relPfad))
  }

  async info(tourId: string, relPfad: string): Promise<DateiInfo | null> {
    try {
      const s = await stat(this.pfad(tourId, relPfad))
      return s.isFile() ? { groesse: s.size } : null
    } catch {
      return null
    }
  }

  leseStream(tourId: string, relPfad: string, bereich?: { start: number; ende: number }): Readable {
    const pfad = this.pfad(tourId, relPfad)
    return bereich ? createReadStream(pfad, { start: bereich.start, end: bereich.ende }) : createReadStream(pfad)
  }

  async loesche(tourId: string, relPfad: string): Promise<void> {
    await rm(this.pfad(tourId, relPfad), { force: true })
  }

  async listeDateien(tourId: string, unterordner: string): Promise<Array<{ name: string; groesse: number }>> {
    const ordner = this.pfad(tourId, unterordner)
    let eintraege
    try {
      eintraege = await readdir(ordner, { withFileTypes: true })
    } catch {
      return [] // fehlender Ordner = keine Dateien (Tour ohne Medien/Audio)
    }
    const dateien: Array<{ name: string; groesse: number }> = []
    for (const eintrag of eintraege) {
      if (!eintrag.isFile()) continue // nicht-rekursiv: Unterordner ignorieren
      const s = await stat(join(ordner, eintrag.name))
      dateien.push({ name: eintrag.name, groesse: s.size })
    }
    // Deterministische Reihenfolge (readdir garantiert keine) — Fs und Mem
    // verhalten sich gleich, Tests und Editor-Listen bleiben stabil.
    return dateien.sort((a, b) => a.name.localeCompare(b.name))
  }

  async gesamtGroesse(tourId: string): Promise<number> {
    const wurzel = sicherePfad(this.basisDir, tourId, '.')
    let summe = 0
    const gehe = async (ordner: string): Promise<void> => {
      let eintraege
      try {
        eintraege = await readdir(ordner, { withFileTypes: true })
      } catch {
        return // Tour ohne Verzeichnis (noch nichts hochgeladen)
      }
      for (const eintrag of eintraege) {
        const pfad = join(ordner, eintrag.name)
        if (eintrag.isDirectory()) await gehe(pfad)
        else if (eintrag.isFile()) summe += (await stat(pfad)).size
      }
    }
    await gehe(wurzel)
    return summe
  }

  async loescheTour(tourId: string): Promise<void> {
    await rm(sicherePfad(this.basisDir, tourId, '.'), { recursive: true, force: true })
  }
}

/** In-Memory-Storage für Tests: gleiche Semantik, kein Dateisystem. */
export class MemStorage implements Storage {
  private dateien = new Map<string, Buffer>()

  private key(tourId: string, relPfad: string): string {
    return `${tourId}/${normalize(relPfad)}`
  }

  async schreibe(tourId: string, relPfad: string, inhalt: Buffer | string): Promise<void> {
    this.dateien.set(this.key(tourId, relPfad), Buffer.from(inhalt))
  }

  async schreibeStream(tourId: string, relPfad: string, quelle: Readable, maxBytes: number): Promise<DateiInfo> {
    const teile: Buffer[] = []
    let gross = 0
    for await (const chunk of quelle) {
      const buf = Buffer.from(chunk)
      gross += buf.length
      if (gross > maxBytes) throw new ZuGrossFehler(maxBytes)
      teile.push(buf)
    }
    this.dateien.set(this.key(tourId, relPfad), Buffer.concat(teile))
    return { groesse: gross }
  }

  async lese(tourId: string, relPfad: string): Promise<Buffer> {
    const inhalt = this.dateien.get(this.key(tourId, relPfad))
    if (!inhalt) throw Object.assign(new Error('nicht gefunden'), { code: 'ENOENT' })
    return inhalt
  }

  async info(tourId: string, relPfad: string): Promise<DateiInfo | null> {
    const inhalt = this.dateien.get(this.key(tourId, relPfad))
    return inhalt ? { groesse: inhalt.length } : null
  }

  leseStream(tourId: string, relPfad: string, bereich?: { start: number; ende: number }): Readable {
    const inhalt = this.dateien.get(this.key(tourId, relPfad))
    if (!inhalt) throw Object.assign(new Error('nicht gefunden'), { code: 'ENOENT' })
    const ausschnitt = bereich ? inhalt.subarray(bereich.start, bereich.ende + 1) : inhalt
    return Readable.from([ausschnitt])
  }

  async loesche(tourId: string, relPfad: string): Promise<void> {
    this.dateien.delete(this.key(tourId, relPfad))
  }

  async listeDateien(tourId: string, unterordner: string): Promise<Array<{ name: string; groesse: number }>> {
    const praefix = `${this.key(tourId, unterordner)}/`
    const dateien: Array<{ name: string; groesse: number }> = []
    for (const [key, inhalt] of this.dateien) {
      if (!key.startsWith(praefix)) continue
      const name = key.slice(praefix.length)
      if (name.includes('/')) continue // nicht-rekursiv (gleiche Semantik wie FsStorage)
      dateien.push({ name, groesse: inhalt.length })
    }
    return dateien.sort((a, b) => a.name.localeCompare(b.name))
  }

  async gesamtGroesse(tourId: string): Promise<number> {
    let summe = 0
    for (const [key, inhalt] of this.dateien) {
      if (key.startsWith(`${tourId}/`)) summe += inhalt.length
    }
    return summe
  }

  async loescheTour(tourId: string): Promise<void> {
    for (const key of this.dateien.keys()) {
      if (key.startsWith(`${tourId}/`)) this.dateien.delete(key)
    }
  }
}
