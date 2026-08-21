// FsStorage gegen ein echtes Temp-Verzeichnis: gleiche Verhaltensgarantien
// wie der MemStorage-Fake (Limit, Range, Pfad-Härtung, Löschen).

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FsStorage, MemStorage, TooLargeError, type Storage } from '../src/storage.js'

let dir: string
let storage: FsStorage

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'maptale-storage-'))
  storage = new FsStorage(dir)
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const alsStream = (inhalt: string): Readable => Readable.from([Buffer.from(inhalt)])

describe('FsStorage', () => {
  it('schreibt und liest Dateien', async () => {
    await storage.write('t_1', 'original/manifest.json', '{"a":1}')
    expect((await storage.read('t_1', 'original/manifest.json')).toString()).toBe('{"a":1}')
    expect(await storage.info('t_1', 'original/manifest.json')).toEqual({ size: 7 })
  })

  it('meldet fehlende Dateien als null', async () => {
    expect(await storage.info('t_1', 'gibtsnicht.jpg')).toBeNull()
  })

  it('schreibt Streams atomar und meldet die Größe', async () => {
    const info = await storage.writeStream('t_1', 'media/m1.jpg', alsStream('0123456789'), 100)
    expect(info.size).toBe(10)
    expect((await storage.read('t_1', 'media/m1.jpg')).toString()).toBe('0123456789')
  })

  it('bricht über dem Limit ab und hinterlässt keine halbe Datei', async () => {
    await expect(
      storage.writeStream('t_1', 'media/m1.jpg', alsStream('0123456789'), 5),
    ).rejects.toBeInstanceOf(TooLargeError)
    expect(await storage.info('t_1', 'media/m1.jpg')).toBeNull()
  })

  it('liest Byte-Bereiche (Range)', async () => {
    await storage.write('t_1', 'media/m1.jpg', '0123456789')
    const teile: Buffer[] = []
    for await (const chunk of storage.readStream('t_1', 'media/m1.jpg', { start: 2, end: 5 })) {
      teile.push(Buffer.from(chunk))
    }
    expect(Buffer.concat(teile).toString()).toBe('2345')
  })

  it('verweigert Pfad-Ausbrüche', async () => {
    await expect(storage.write('t_1', '../../etc/passwd', 'x')).rejects.toThrow(/Unzulässiger Pfad/)
  })

  it('verweigert Ausbrüche in Geschwisterordner mit gleichem Präfix', async () => {
    // "t_1-boese" beginnt mit "t_1" — ohne Separator-Grenze käme das durch
    await expect(storage.write('t_1', '../t_1-boese/datei.txt', 'x')).rejects.toThrow(
      /Unzulässiger Pfad/,
    )
  })

  it('löscht ganze Touren', async () => {
    await storage.write('t_1', 'tour.json', '{}')
    await storage.write('t_2', 'tour.json', '{}')
    await storage.removeTour('t_1')
    expect(await storage.info('t_1', 'tour.json')).toBeNull()
    expect(await storage.info('t_2', 'tour.json')).toEqual({ size: 2 })
  })

  it('verweigert Pfad-Ausbrüche auch beim Einzel-Löschen', async () => {
    await expect(storage.remove('t_1', '../t_2/tour.json')).rejects.toThrow(/Unzulässiger Pfad/)
  })
})

// Gemeinsame Verhaltensgarantien beider Implementierungen — der MemStorage-
// Fake muss sich in Tests exakt wie das echte Dateisystem verhalten.
describe.each<{ name: string; baue: () => Storage }>([
  { name: 'FsStorage', baue: () => storage },
  { name: 'MemStorage', baue: () => new MemStorage() },
])('$name: loesche + listeDateien (Baukasten)', ({ baue }) => {
  it('löscht einzelne Dateien; fehlende Dateien sind kein Fehler', async () => {
    const s = baue()
    await s.write('t_1', 'media/a1.mp3', 'mp3-bytes')
    await s.remove('t_1', 'media/a1.mp3')
    expect(await s.info('t_1', 'media/a1.mp3')).toBeNull()
    await expect(s.remove('t_1', 'media/gibtsnicht.mp3')).resolves.toBeUndefined()
  })

  it('listet Dateien eines Unterordners nicht-rekursiv, sortiert, mit Größe', async () => {
    const s = baue()
    await s.write('t_1', 'media/b.wav', '123456')
    await s.write('t_1', 'media/a1.mp3', '0123456789')
    await s.write('t_1', 'media/unter/tief.mp3', 'x') // Unterordner: ignoriert
    await s.write('t_1', 'tour.json', '{}') // anderer Ordner: ignoriert
    await s.write('t_2', 'media/fremd.mp3', 'x') // fremde Tour: ignoriert
    expect(await s.listFiles('t_1', 'media')).toEqual([
      { name: 'a1.mp3', size: 10 },
      { name: 'b.wav', size: 6 },
    ])
  })

  it('liefert für fehlende Ordner eine leere Liste', async () => {
    const s = baue()
    expect(await s.listFiles('t_1', 'media')).toEqual([])
  })

  it('gesamtGroesse summiert rekursiv über alle Unterordner (Quota, M9)', async () => {
    const s = baue()
    expect(await s.totalSize('t_1')).toBe(0) // Tour ohne Dateien
    await s.write('t_1', 'manifest.json', '12345') // 5
    await s.write('t_1', 'media/a1.mp3', '0123456789') // 10
    await s.write('t_1', 'original/track.gpx', 'xyz') // 3
    await s.write('t_2', 'media/fremd.mp3', 'x') // fremde Tour zählt nicht
    expect(await s.totalSize('t_1')).toBe(18)
  })
})
