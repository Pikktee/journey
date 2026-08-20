// Foto-Aufbereitung: EXIF-Handhabung als reine Funktionen plus die
// Orchestrierung gegen ein FakeBildWerkzeug (kein ffmpeg). Die JPEGs baut der
// Test selbst — ein echtes Foto bräuchte es nur, um dieselben Bytes zu haben.

import { describe, expect, it } from 'vitest'
import {
  displayFilename,
  preparePhotos,
  FakeImageTool,
  readExifBlock,
  readOrientation,
  withExif,
  withoutOrientation,
  thumbFilename,
  type ImageStorage,
} from '../src/pipeline/image.js'

/**
 * Minimal-JPEG mit Exif-APP1: SOI · APP1(TIFF mit Orientierungs-Tag) · SOS.
 * `grossEndig` schaltet die Byte-Reihenfolge um (Canon schreibt „II", Nikon „MM").
 */
function exifJpeg(orientierung: number, grossEndig = false): Buffer {
  // 8 Kopf + 2 Anzahl + 12 Eintrag + 4 Offset auf IFD1
  const tiff = Buffer.alloc(26)
  tiff.write(grossEndig ? 'MM' : 'II', 0, 'latin1')
  const schreib16 = (o: number, w: number): void => {
    if (grossEndig) tiff.writeUInt16BE(w, o)
    else tiff.writeUInt16LE(w, o)
  }
  const schreib32 = (o: number, w: number): void => {
    if (grossEndig) tiff.writeUInt32BE(w, o)
    else tiff.writeUInt32LE(w, o)
  }
  schreib16(2, 0x2a)
  schreib32(4, 8) // IFD0 beginnt direkt hinter dem Kopf
  schreib16(8, 1) // ein Eintrag
  schreib16(10, 0x0112) // Orientation
  schreib16(12, 3) // Typ SHORT
  schreib32(14, 1) // Anzahl
  schreib16(18, orientierung) // Wert steht im Feld selbst
  schreib32(22, 0) // kein IFD1 (kein eingebettetes Vorschaubild)

  const nutzlast = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff])
  const kopf = Buffer.alloc(4)
  kopf.writeUInt16BE(0xffe1, 0)
  kopf.writeUInt16BE(2 + nutzlast.length, 2)
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    kopf,
    nutzlast,
    Buffer.from([0xff, 0xda, 0x00, 0x02]),
  ])
}

/** JPEG ohne jedes Metadaten-Segment. */
const nacktesJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02])

function memSpeicher(): ImageStorage & { dateien: Map<string, Buffer> } {
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

describe('abgeleitete Namen', () => {
  it('vergibt zwei Punkt-Segmente — die kollidieren nie mit einem Upload-Medium', () => {
    expect(displayFilename('m2')).toBe('m2.w1920.jpg')
    expect(thumbFilename('m2')).toBe('m2.t480.jpg')
  })
})

describe('liesExifBlock', () => {
  it('findet den Exif-APP1 samt Marker und Länge', () => {
    const block = readExifBlock(exifJpeg(1))
    expect(block).not.toBeNull()
    expect(block?.readUInt16BE(0)).toBe(0xffe1)
    expect(block?.toString('latin1', 4, 10)).toBe('Exif\0\0')
  })

  it('gibt null zurück, wo nichts zu holen ist', () => {
    expect(readExifBlock(nacktesJpeg)).toBeNull()
    expect(readExifBlock(Buffer.from('kein JPEG'))).toBeNull()
    expect(readExifBlock(Buffer.alloc(0))).toBeNull()
  })

  it('läuft nicht über eine abgeschnittene Datei hinaus', () => {
    // Längenangabe zeigt hinter das Dateiende — die Kette bricht ab, statt zu werfen
    const kaputt = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 0x45, 0x78])
    expect(readExifBlock(kaputt)).toBeNull()
  })
})

describe('liesOrientierung', () => {
  it('liest den Wert in beiden Byte-Reihenfolgen', () => {
    expect(readOrientation(readExifBlock(exifJpeg(6)))).toBe(6)
    expect(readOrientation(readExifBlock(exifJpeg(8, true)))).toBe(8)
  })

  it('nimmt 1 an, wo nichts steht oder Unsinn steht', () => {
    expect(readOrientation(null)).toBe(1)
    expect(readOrientation(readExifBlock(exifJpeg(0)))).toBe(1)
    expect(readOrientation(readExifBlock(exifJpeg(99)))).toBe(1)
  })
})

describe('ohneOrientierung', () => {
  it('setzt die Drehung auf 1 — sonst drehte der Browser ein zweites Mal', () => {
    const block = readExifBlock(exifJpeg(6))!
    const normal = withoutOrientation(block)
    expect(readOrientation(normal)).toBe(1)
    expect(readOrientation(block)).toBe(6) // Original unangetastet (Kopie!)
    expect(normal.length).toBe(block.length)
  })

  it('lässt einen Block ohne Orientierungs-Tag, wie er ist', () => {
    const ohneTag = Buffer.concat([
      Buffer.from([0xff, 0xe1, 0x00, 0x0a]),
      Buffer.from('Exif\0\0', 'latin1'),
      Buffer.from([0x49, 0x49]),
    ])
    expect(withoutOrientation(ohneTag)).toEqual(ohneTag)
  })
})

describe('mitExif', () => {
  it('setzt den Block direkt hinter SOI ein', () => {
    const block = readExifBlock(exifJpeg(3))!
    const fertig = withExif(nacktesJpeg, block)
    expect(fertig.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]))
    expect(readOrientation(readExifBlock(fertig))).toBe(3)
  })

  it('lässt etwas, das kein JPEG ist, unverändert', () => {
    const fremd = Buffer.from('kein JPEG')
    expect(withExif(fremd, readExifBlock(exifJpeg(1))!)).toEqual(fremd)
  })
})

describe('bereiteFotosAuf', () => {
  it('erzeugt beide Fassungen und verwirft das Original', async () => {
    const sp = memSpeicher()
    sp.dateien.set('media/m1.jpg', exifJpeg(1))
    const werkzeug = new FakeImageTool()

    const meta = await preparePhotos({
      medien: [{ id: 'm1', quellDatei: 'm1.jpg', anzeige: true }],
      speicher: sp,
      werkzeug,
    })

    expect(werkzeug.aufrufe).toEqual(['1920:1', '480:1'])
    expect(meta.get('m1')).toEqual({ anzeigeDatei: 'm1.w1920.jpg', thumbDatei: 'm1.t480.jpg' })
    expect(sp.dateien.has('media/m1.w1920.jpg')).toBe(true)
    expect(sp.dateien.has('media/m1.t480.jpg')).toBe(true)
    expect(sp.dateien.has('media/m1.jpg')).toBe(false) // verworfen
  })

  it('rechnet die Drehung in die Pixel und meldet sie im EXIF als erledigt', async () => {
    // Beides zusammen ist die Bedingung: Wer nur das eine täte, zeigte jedes
    // Hochformat-Foto quer — oder zweimal gedreht.
    const sp = memSpeicher()
    sp.dateien.set('media/m1.jpg', exifJpeg(6))
    const werkzeug = new FakeImageTool()

    await preparePhotos({
      medien: [{ id: 'm1', quellDatei: 'm1.jpg', anzeige: true }],
      speicher: sp,
      werkzeug,
    })

    expect(werkzeug.aufrufe).toEqual(['1920:6', '480:6']) // ffmpeg dreht
    const anzeige = sp.dateien.get('media/m1.w1920.jpg')!
    expect(readOrientation(readExifBlock(anzeige))).toBe(1) // Angabe zurückgesetzt
  })

  it('gibt der Anzeige-Fassung das EXIF mit, der Kachel nicht', async () => {
    // Der Editor liest die Aufnahme-Details aus der ausgelieferten Datei; nach
    // dem Verwerfen des Originals ist die Anzeige-Fassung die letzte Quelle.
    const sp = memSpeicher()
    sp.dateien.set('media/m1.jpg', exifJpeg(1))

    await preparePhotos({
      medien: [{ id: 'm1', quellDatei: 'm1.jpg', anzeige: true }],
      speicher: sp,
      werkzeug: new FakeImageTool(),
    })

    expect(readExifBlock(sp.dateien.get('media/m1.w1920.jpg')!)).not.toBeNull()
    expect(readExifBlock(sp.dateien.get('media/m1.t480.jpg')!)).toBeNull()
  })

  it('kommt ohne EXIF aus (gestrippte Datei)', async () => {
    const sp = memSpeicher()
    sp.dateien.set('media/m1.jpg', nacktesJpeg)

    const meta = await preparePhotos({
      medien: [{ id: 'm1', quellDatei: 'm1.jpg', anzeige: true }],
      speicher: sp,
      werkzeug: new FakeImageTool(),
    })

    expect(meta.get('m1')?.anzeigeDatei).toBe('m1.w1920.jpg')
    expect(sp.dateien.has('media/m1.jpg')).toBe(false)
  })

  it('ist idempotent: liegen beide Fassungen, wird nichts gerechnet', async () => {
    const sp = memSpeicher()
    sp.dateien.set('media/m1.w1920.jpg', Buffer.from('ALT-ANZEIGE'))
    sp.dateien.set('media/m1.t480.jpg', Buffer.from('ALT-THUMB'))
    const werkzeug = new FakeImageTool()

    const meta = await preparePhotos({
      medien: [{ id: 'm1', quellDatei: 'm1.jpg', anzeige: true }],
      speicher: sp,
      werkzeug,
    })

    expect(werkzeug.aufrufe).toEqual([])
    expect(meta.get('m1')?.anzeigeDatei).toBe('m1.w1920.jpg')
    expect(sp.dateien.get('media/m1.w1920.jpg')?.toString()).toBe('ALT-ANZEIGE')
  })

  it('holt eine fehlende Kachel aus der Anzeige-Fassung nach — das Original ist längst weg', async () => {
    const sp = memSpeicher()
    sp.dateien.set('media/m1.w1920.jpg', exifJpeg(1))
    const werkzeug = new FakeImageTool()

    await preparePhotos({
      medien: [{ id: 'm1', quellDatei: 'm1.jpg', anzeige: true }],
      speicher: sp,
      werkzeug,
    })

    expect(werkzeug.aufrufe).toEqual(['480:1']) // nur die Kachel
    expect(sp.dateien.has('media/m1.t480.jpg')).toBe(true)
  })

  it('gibt dem Video-Poster nur eine Kachel und lässt das Poster stehen', async () => {
    // Das Poster IST schon die abgeleitete Anzeigegröße und bleibt das
    // Standbild im Player — eine zweite Fassung daneben wäre nur Ballast.
    const sp = memSpeicher()
    sp.dateien.set('media/m2.poster.jpg', nacktesJpeg)
    const werkzeug = new FakeImageTool()

    const meta = await preparePhotos({
      medien: [{ id: 'm2', quellDatei: 'm2.poster.jpg', anzeige: false }],
      speicher: sp,
      werkzeug,
    })

    expect(werkzeug.aufrufe).toEqual(['480:1'])
    expect(meta.get('m2')).toEqual({ anzeigeDatei: null, thumbDatei: 'm2.t480.jpg' })
    expect(sp.dateien.has('media/m2.poster.jpg')).toBe(true) // bleibt
  })

  it('überspringt ein unlesbares Bild, ohne die Tour scheitern zu lassen', async () => {
    const sp = memSpeicher()
    const nachrichten: string[] = []

    const meta = await preparePhotos({
      medien: [{ id: 'm1', quellDatei: 'm1.jpg', anzeige: true }],
      speicher: sp,
      werkzeug: new FakeImageTool(),
      protokoll: (n) => nachrichten.push(n),
    })

    expect(meta.has('m1')).toBe(false)
    expect(nachrichten[0]).toContain('Bilddatei fehlt')
  })
})
