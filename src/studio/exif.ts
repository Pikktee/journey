// EXIF-Leser fürs Studio (M6): Aufnahmezeit (DateTimeOriginal) + GPS aus einem
// im Browser gewählten JPEG (ArrayBuffer). Erweitert den Player-Leser
// (src/exif.js, nur Datum aus URL) um Sekunden und GPS-Koordinaten. Bewusst
// abhängigkeitsfrei — TIFF-IFDs sind flach genug für ein paar DataView-Zugriffe.

export interface ExifDatum {
  y: number
  mo: number
  d: number
  hh: number
  mm: number
  ss: number
}

export interface ExifDaten {
  datum: ExifDatum | null
  /** [lng, lat] aus GPS-IFD; null, wenn keine Geodaten vorhanden */
  gps: [number, number] | null
}

function parseExifDate(s: string): ExifDatum | null {
  const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(s)
  if (!m) return null
  return { y: +m[1]!, mo: +m[2]!, d: +m[3]!, hh: +m[4]!, mm: +m[5]!, ss: +m[6]! }
}

function findTag(view: DataView, tiff: number, ifdOff: number, tag: number, le: boolean): number | null {
  if (tiff + ifdOff + 2 > view.byteLength) return null
  const n = view.getUint16(tiff + ifdOff, le)
  for (let i = 0; i < n; i++) {
    const e = tiff + ifdOff + 2 + i * 12
    if (e + 12 > view.byteLength) break
    if (view.getUint16(e, le) === tag) return e
  }
  return null
}

function asciiValue(view: DataView, tiff: number, entry: number, le: boolean): string {
  const count = view.getUint32(entry + 4, le)
  const valOff = count > 4 ? tiff + view.getUint32(entry + 8, le) : entry + 8
  let s = ''
  for (let i = 0; i < count - 1 && valOff + i < view.byteLength; i++) {
    s += String.fromCharCode(view.getUint8(valOff + i))
  }
  return s
}

// Ein RATIONAL = zwei uint32 (Zähler/Nenner); GPS-Winkel sind drei davon.
function rational(view: DataView, off: number, le: boolean): number {
  const num = view.getUint32(off, le)
  const den = view.getUint32(off + 4, le)
  return den === 0 ? 0 : num / den
}

function gpsWinkel(view: DataView, tiff: number, entry: number, le: boolean): number | null {
  const count = view.getUint32(entry + 4, le)
  if (count < 3) return null
  const off = tiff + view.getUint32(entry + 8, le) // 3×RATIONAL = 24 B > 4 → immer Offset
  if (off + 24 > view.byteLength) return null
  return rational(view, off, le) + rational(view, off + 8, le) / 60 + rational(view, off + 16, le) / 3600
}

function liesGps(view: DataView, tiff: number, gpsIfd: number, le: boolean): [number, number] | null {
  const latRefE = findTag(view, tiff, gpsIfd, 0x0001, le)
  const latE = findTag(view, tiff, gpsIfd, 0x0002, le)
  const lngRefE = findTag(view, tiff, gpsIfd, 0x0003, le)
  const lngE = findTag(view, tiff, gpsIfd, 0x0004, le)
  if (!latE || !lngE) return null
  let lat = gpsWinkel(view, tiff, latE, le)
  let lng = gpsWinkel(view, tiff, lngE, le)
  if (lat === null || lng === null) return null
  if (latRefE && String.fromCharCode(view.getUint8(latRefE + 8)) === 'S') lat = -lat
  if (lngRefE && String.fromCharCode(view.getUint8(lngRefE + 8)) === 'W') lng = -lng
  return [lng, lat]
}

/** Datum + GPS aus einem JPEG-ArrayBuffer; beide Felder null, wenn nicht vorhanden. */
export function liesExif(buf: ArrayBuffer): ExifDaten {
  // Manipulierte/beschnittene EXIF-Bytes dürfen den Upload nicht abbrechen — ein
  // RangeError aus einem DataView-Zugriff wird hier zu „keine Metadaten".
  try {
    return liesExifIntern(buf)
  } catch {
    return { datum: null, gps: null }
  }
}

function liesExifIntern(buf: ArrayBuffer): ExifDaten {
  const leer: ExifDaten = { datum: null, gps: null }
  const view = new DataView(buf)
  if (view.byteLength < 16 || view.getUint16(0) !== 0xffd8) return leer // kein JPEG

  let off = 2
  // +8: der APP1-Test unten liest getUint32(off+4) (4 B ab off+4)
  while (off + 8 <= view.byteLength) {
    if (view.getUint8(off) !== 0xff) break
    const marker = view.getUint8(off + 1)
    if (marker === 0xda) break // Start of Scan
    const size = view.getUint16(off + 2)
    if (marker === 0xe1 && view.getUint32(off + 4) === 0x45786966 /* 'Exif' */) {
      const tiff = off + 10
      if (tiff + 8 > view.byteLength) return leer
      const le = view.getUint16(tiff) === 0x4949
      const ifd0 = view.getUint32(tiff + 4, le)

      let datum: ExifDatum | null = null
      const exifPtr = findTag(view, tiff, ifd0, 0x8769, le)
      if (exifPtr) {
        const sub = view.getUint32(exifPtr + 8, le)
        const dto = findTag(view, tiff, sub, 0x9003, le)
        if (dto) datum = parseExifDate(asciiValue(view, tiff, dto, le))
      }
      if (!datum) {
        const dt = findTag(view, tiff, ifd0, 0x0132, le)
        if (dt) datum = parseExifDate(asciiValue(view, tiff, dt, le))
      }

      let gps: [number, number] | null = null
      const gpsPtr = findTag(view, tiff, ifd0, 0x8825, le)
      if (gpsPtr) gps = liesGps(view, tiff, view.getUint32(gpsPtr + 8, le), le)

      return { datum, gps }
    }
    off += 2 + size
  }
  return leer
}
