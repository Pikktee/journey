// EXIF-Leser (src/studio/exif.ts): Robustheit gegen kaputte/manipulierte JPEGs.
// Der echte Datum-/GPS-Pfad wird im Browser-E2E mit realen Fotos abgedeckt.
import { describe, expect, it } from 'vitest'
import { liesExif } from '../src/studio/exif'

describe('liesExif Robustheit', () => {
  it('liefert leer statt zu werfen bei Nicht-JPEG/kaputten Bytes', () => {
    expect(liesExif(new ArrayBuffer(0))).toEqual({ datum: null, gps: null })
    expect(liesExif(new Uint8Array([1, 2, 3, 4]).buffer)).toEqual({ datum: null, gps: null })
  })

  it('wirft nicht bei einem APP1-Marker in den letzten Bytes (Review-RangeError)', () => {
    // JPEG-SOI + FF E1 (APP1) ganz am Ende, ohne gültigen Body
    const b = new Uint8Array(16)
    b[0] = 0xff
    b[1] = 0xd8
    b[11] = 0xff
    b[12] = 0xe1
    expect(() => liesExif(b.buffer)).not.toThrow()
    expect(liesExif(b.buffer)).toEqual({ datum: null, gps: null })
  })
})
