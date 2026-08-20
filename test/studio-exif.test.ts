// EXIF-Leser (src/studio/exif.ts): Robustheit gegen kaputte/manipulierte JPEGs
// und das Auslesen der Aufnahmedaten an einem echten Beispielbild.
//
// `fixtures/exif-beispiel.jpg` ist ein 64×48-Pixel-JPEG mit vollem EXIF-Satz,
// erzeugt mit Pillow + piexif (Apple iPhone 15 Pro, 1/250 s, f/2.8, ISO 400,
// 24 mm, −0,3 EV, 4032×3024 als Pixelmaße, GPS Berner Oberland auf 1834 m).
// `fixtures/exif-canon.jpg` trägt Make „Canon" + Model „Canon EOS R6" — der
// Fall, in dem der Hersteller schon im Modellnamen steckt.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { describeCapture, readCapture, readExif } from '../src/studio/exif'

function bild(name: string): ArrayBuffer {
  const b = readFileSync(new URL(`./fixtures/${name}`, import.meta.url))
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
}
const beispielBild = (): ArrayBuffer => bild('exif-beispiel.jpg')

describe('liesExif Robustheit', () => {
  it('liefert leer statt zu werfen bei Nicht-JPEG/kaputten Bytes', () => {
    expect(readExif(new ArrayBuffer(0))).toEqual({ date: null, gps: null })
    expect(readExif(new Uint8Array([1, 2, 3, 4]).buffer)).toEqual({ date: null, gps: null })
  })

  it('wirft nicht bei einem APP1-Marker in den letzten Bytes (Review-RangeError)', () => {
    // JPEG-SOI + FF E1 (APP1) ganz am Ende, ohne gültigen Body
    const b = new Uint8Array(16)
    b[0] = 0xff
    b[1] = 0xd8
    b[11] = 0xff
    b[12] = 0xe1
    expect(() => readExif(b.buffer)).not.toThrow()
    expect(readExif(b.buffer)).toEqual({ date: null, gps: null })
  })

  it('liest Datum und GPS aus einem echten JPEG', () => {
    const { date, gps } = readExif(beispielBild())
    expect(date).toEqual({ y: 2026, mo: 7, d: 4, hh: 9, mm: 1, ss: 12 })
    // 46°35'36" N, 7°54'30" E
    expect(gps?.[0]).toBeCloseTo(7.9083, 3)
    expect(gps?.[1]).toBeCloseTo(46.5933, 3)
  })
})

describe('liesAufnahme (Kameradaten fürs Panel)', () => {
  it('liest Kamera, Objektiv, Belichtung, Maße und Höhe', () => {
    const a = readCapture(beispielBild())
    expect(a.camera).toBe('Apple iPhone 15 Pro')
    expect(a.lens).toBe('iPhone 15 Pro back camera 6.86mm f/1.78')
    expect(a.exposureS).toBeCloseTo(1 / 250, 6)
    expect(a.aperture).toBeCloseTo(2.8, 6)
    expect(a.iso).toBe(400)
    expect(a.focalLengthMm).toBe(24)
    expect(a.exposureBiasEv).toBeCloseTo(-0.3, 6) // SRATIONAL: negativ muss durchkommen
    expect(a.width).toBe(4032)
    expect(a.height).toBe(3024)
    expect(a.elevationM).toBe(1834)
  })

  it('nennt den Hersteller nicht doppelt, wenn er im Modell steckt', () => {
    // Make „Canon" + Model „Canon EOS R6" → einmal Canon
    expect(readCapture(bild('exif-canon.jpg')).camera).toBe('Canon EOS R6')
  })

  it('liefert leer statt zu werfen ohne EXIF/bei Müll', () => {
    expect(readCapture(new ArrayBuffer(0))).toEqual({})
    expect(readCapture(new Uint8Array([1, 2, 3, 4]).buffer)).toEqual({})
  })
})

describe('beschreibeAufnahme', () => {
  it('fasst die Belichtung wie ein Kameradisplay zusammen', () => {
    const zeilen = describeCapture(readCapture(beispielBild()))
    const map = Object.fromEntries(zeilen)
    expect(map['Kamera']).toBe('Apple iPhone 15 Pro')
    expect(map['Belichtung']).toBe('1/250 s · f/2,8 · ISO 400 · 24 mm · −0,3 EV')
    expect(map['Auflösung']).toBe('4032 × 3024 · 12,2 MP')
    expect(map['Höhe']).toBe('1834 m')
  })

  it('zeigt lange Belichtungen in Sekunden und lässt Fehlendes weg', () => {
    expect(describeCapture({ exposureS: 1.3, aperture: 1.8 })).toEqual([
      ['Belichtung', '1,3 s · f/1,8'],
    ])
    // Nichts bekannt = keine Zeilen (der Bereich sagt das dann in Worten)
    expect(describeCapture({})).toEqual([])
    // Korrektur 0 ist keine Angabe wert, Maße unter 0,5 MP tragen kein „MP"
    expect(describeCapture({ exposureBiasEv: 0, width: 640, height: 480 })).toEqual([
      ['Auflösung', '640 × 480'],
    ])
  })
})
