// EXIF-Leser für Node (CLI-Importer): Aufnahmezeitpunkt + GPS-Koordinate aus
// einem JPEG-Buffer. Gleiche Minimal-Philosophie wie src/exif.js (das Browser-
// Pendant liest nur das Datum per fetch) — hier zusätzlich das GPS-IFD, weil
// der Importer Fotos möglichst mit echtem Anker hochladen will.

// EXIF-Zeitstring „YYYY:MM:DD HH:MM:SS" → Komponenten (EXIF kennt keine Zone;
// die Interpretation übernimmt der Aufrufer in der Tour-Zeitzone)
function parseExifDatum(s) {
  const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(s)
  if (!m) return null
  const [, y, mo, d, hh, mm, ss] = m
  return { y: +y, mo: +mo, d: +d, hh: +hh, mm: +mm, ss: +ss }
}

function findeTag(view, tiff, ifdOff, tag, le) {
  if (tiff + ifdOff + 2 > view.byteLength) return null
  const n = view.getUint16(tiff + ifdOff, le)
  for (let i = 0; i < n; i++) {
    const e = tiff + ifdOff + 2 + i * 12
    if (e + 12 > view.byteLength) return null
    if (view.getUint16(e, le) === tag) return e
  }
  return null
}

function asciiWert(view, tiff, entry, le) {
  const count = view.getUint32(entry + 4, le)
  const valOff = count > 4 ? tiff + view.getUint32(entry + 8, le) : entry + 8
  let s = ''
  for (let i = 0; i < count - 1 && valOff + i < view.byteLength; i++) {
    s += String.fromCharCode(view.getUint8(valOff + i))
  }
  return s
}

// RATIONAL×3 (Grad/Minuten/Sekunden) → Dezimalgrad
function gpsWert(view, tiff, entry, le) {
  const valOff = tiff + view.getUint32(entry + 8, le)
  const teile = []
  for (let i = 0; i < 3; i++) {
    const zaehler = view.getUint32(valOff + i * 8, le)
    const nenner = view.getUint32(valOff + i * 8 + 4, le)
    teile.push(nenner ? zaehler / nenner : 0)
  }
  return teile[0] + teile[1] / 60 + teile[2] / 3600
}

/**
 * @param {Buffer} buffer JPEG-Inhalt (Dateianfang genügt)
 * @returns {{ datum: {y,mo,d,hh,mm,ss} | null, gps: [number, number] | null }}
 */
export function liesExif(buffer) {
  // Korrupte/beschnittene EXIF-Blöcke (Offsets zeigen ins Leere) dürfen den
  // Import nie crashen — dann gibt es eben keine Metadaten für dieses Foto.
  try {
    return liesExifUnsicher(buffer)
  } catch {
    return { datum: null, gps: null }
  }
}

function liesExifUnsicher(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  const leer = { datum: null, gps: null }
  if (view.byteLength < 16 || view.getUint16(0) !== 0xffd8) return leer

  let off = 2
  while (off + 4 < view.byteLength) {
    if (view.getUint8(off) !== 0xff) break
    const marker = view.getUint8(off + 1)
    if (marker === 0xda) break
    const size = view.getUint16(off + 2)
    if (marker === 0xe1 && view.getUint32(off + 4) === 0x45786966 /* 'Exif' */) {
      const tiff = off + 10
      if (tiff + 8 > view.byteLength) return leer
      const le = view.getUint16(tiff) === 0x4949
      const ifd0 = view.getUint32(tiff + 4, le)

      let datum = null
      const exifPtr = findeTag(view, tiff, ifd0, 0x8769, le)
      if (exifPtr) {
        const sub = view.getUint32(exifPtr + 8, le)
        const dto = findeTag(view, tiff, sub, 0x9003, le)
        if (dto) datum = parseExifDatum(asciiWert(view, tiff, dto, le))
      }
      if (!datum) {
        const dt = findeTag(view, tiff, ifd0, 0x0132, le)
        if (dt) datum = parseExifDatum(asciiWert(view, tiff, dt, le))
      }

      let gps = null
      const gpsPtr = findeTag(view, tiff, ifd0, 0x8825, le)
      if (gpsPtr) {
        const sub = view.getUint32(gpsPtr + 8, le)
        const latRef = findeTag(view, tiff, sub, 0x0001, le)
        const lat = findeTag(view, tiff, sub, 0x0002, le)
        const lngRef = findeTag(view, tiff, sub, 0x0003, le)
        const lng = findeTag(view, tiff, sub, 0x0004, le)
        if (lat && lng) {
          let latDez = gpsWert(view, tiff, lat, le)
          let lngDez = gpsWert(view, tiff, lng, le)
          if (latRef && asciiWert(view, tiff, latRef, le) === 'S') latDez = -latDez
          if (lngRef && asciiWert(view, tiff, lngRef, le) === 'W') lngDez = -lngDez
          if (Number.isFinite(latDez) && Number.isFinite(lngDez) && (latDez !== 0 || lngDez !== 0)) {
            gps = [lngDez, latDez]
          }
        }
      }
      return { datum, gps }
    }
    off += 2 + size
  }
  return leer
}
