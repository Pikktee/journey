// EXIF-Minimalleser: holt den Aufnahmezeitpunkt (DateTimeOriginal, Tag 0x9003;
// Fallback DateTime 0x0132) aus einem JPEG. Bewusst winzig — kein GPS, keine
// Kamera-Daten. Liest per Range-Request nur den Dateianfang (EXIF sitzt in APP1
// direkt hinter SOI); Server ohne Range-Support liefern 200 → wir nehmen den
// Anfang des vollen Bodys.
const EXIF_SCAN_BYTES = 128 * 1024

// EXIF-Zeitstring „YYYY:MM:DD HH:MM:SS" → Komponenten (KEIN Date-Objekt: EXIF
// kennt keine Zeitzone; die Interpretation übernimmt der Aufrufer in der Tour-Zone)
function parseExifDate(s) {
  const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(s)
  if (!m) return null
  const [, y, mo, d, hh, mm] = m
  return { y: +y, mo: +mo, d: +d, hh: +hh, mm: +mm }
}

// TIFF-IFD durchsuchen: liefert den Wert-Offset eines Tags (oder null)
function findTag(view, tiff, ifdOff, tag, le) {
  const n = view.getUint16(tiff + ifdOff, le)
  for (let i = 0; i < n; i++) {
    const e = tiff + ifdOff + 2 + i * 12
    if (view.getUint16(e, le) === tag) return e
  }
  return null
}

function asciiValue(view, tiff, entry, le) {
  const count = view.getUint32(entry + 4, le)
  const valOff = count > 4 ? tiff + view.getUint32(entry + 8, le) : entry + 8
  let s = ''
  for (let i = 0; i < count - 1 && valOff + i < view.byteLength; i++) {
    s += String.fromCharCode(view.getUint8(valOff + i))
  }
  return s
}

export async function readExifDate(url) {
  let buf
  try {
    const res = await fetch(url, { headers: { Range: `bytes=0-${EXIF_SCAN_BYTES - 1}` } })
    if (!res.ok) return null
    buf = await res.arrayBuffer()
  } catch {
    return null
  }
  const view = new DataView(buf.slice(0, EXIF_SCAN_BYTES))
  if (view.byteLength < 16 || view.getUint16(0) !== 0xffd8) return null // kein JPEG
  // JPEG-Segmente ablaufen, bis APP1/"Exif" gefunden ist (oder Bilddaten beginnen)
  let off = 2
  while (off + 4 < view.byteLength) {
    if (view.getUint8(off) !== 0xff) break
    const marker = view.getUint8(off + 1)
    if (marker === 0xda) break // Start of Scan — kein EXIF mehr zu erwarten
    const size = view.getUint16(off + 2)
    if (marker === 0xe1 && view.getUint32(off + 4) === 0x45786966 /* 'Exif' */) {
      const tiff = off + 10 // hinter "Exif\0\0"
      if (tiff + 8 > view.byteLength) return null
      const le = view.getUint16(tiff) === 0x4949 // 'II' = little endian
      const ifd0 = view.getUint32(tiff + 4, le)
      // DateTimeOriginal steckt im Exif-Sub-IFD (Pointer-Tag 0x8769 in IFD0)
      const exifPtr = findTag(view, tiff, ifd0, 0x8769, le)
      if (exifPtr) {
        const sub = view.getUint32(exifPtr + 8, le)
        const dto = findTag(view, tiff, sub, 0x9003, le)
        if (dto) {
          const d = parseExifDate(asciiValue(view, tiff, dto, le))
          if (d) return d
        }
      }
      const dt = findTag(view, tiff, ifd0, 0x0132, le) // Fallback: Datei-Zeitstempel
      if (dt) return parseExifDate(asciiValue(view, tiff, dt, le))
      return null
    }
    off += 2 + size
  }
  return null
}
