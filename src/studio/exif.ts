// EXIF-Leser fürs Studio (M6): Aufnahmezeit (DateTimeOriginal) + GPS aus einem
// im Browser gewählten JPEG (ArrayBuffer). Erweitert den Player-Leser
// (src/exif.ts, nur Datum aus URL) um Sekunden und GPS-Koordinaten. Bewusst
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

/**
 * Aufnahmedaten der Kamera — was der Editor im Info-Bereich einer Aufnahme
 * zeigt. Jedes Feld fehlt einzeln (undefined), wenn das Foto es nicht trägt:
 * Handys schreiben fast alles, gestrippte/generierte Bilder nichts.
 */
export interface ExifAufnahme {
  /** Hersteller + Modell zusammengezogen („Apple iPhone 15 Pro") */
  kamera?: string
  objektiv?: string
  /** Belichtungszeit in Sekunden (0.004 = 1/250 s) */
  belichtungS?: number
  /** Blendenzahl (2.8 = f/2,8) */
  blende?: number
  iso?: number
  /** Brennweite in mm */
  brennweiteMm?: number
  /** Belichtungskorrektur in EV (kann negativ sein) */
  korrekturEv?: number
  breite?: number
  hoehe?: number
  /** Meter über dem Meeresspiegel aus dem GPS-IFD (negativ = darunter) */
  hoeheM?: number
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

/** Wert eines RATIONAL-Tags (Typ 5) bzw. SRATIONAL (Typ 10, vorzeichenbehaftet). */
function rationalTag(view: DataView, tiff: number, entry: number, le: boolean): number | undefined {
  const typ = view.getUint16(entry + 2, le)
  const off = tiff + view.getUint32(entry + 8, le) // 8 B > 4 → immer ausgelagert
  if (off + 8 > view.byteLength) return undefined
  if (typ === 10) {
    const num = view.getInt32(off, le)
    const den = view.getInt32(off + 4, le)
    return den === 0 ? undefined : num / den
  }
  if (typ !== 5) return undefined
  const den = view.getUint32(off + 4, le)
  return den === 0 ? undefined : view.getUint32(off, le) / den
}

/** Wert eines SHORT/LONG-Tags (Typ 3/4) — steht bei count=1 direkt im Eintrag. */
function zahlTag(view: DataView, entry: number, le: boolean): number | undefined {
  const typ = view.getUint16(entry + 2, le)
  if (typ === 3) return view.getUint16(entry + 8, le)
  if (typ === 4) return view.getUint32(entry + 8, le)
  return undefined
}

/** Nicht-leerer, getrimmter ASCII-Wert oder undefined (Padding/Leerstrings raus). */
function textTag(view: DataView, tiff: number, entry: number, le: boolean): string | undefined {
  const s = asciiValue(view, tiff, entry, le).replace(/\0+$/, '').trim()
  return s || undefined
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

/**
 * Kamera-Aufnahmedaten aus einem JPEG-ArrayBuffer (Editor-Infobereich). Wie
 * liesExif fehlertolerant: kaputte Bytes ergeben ein leeres Objekt, nie eine
 * Ausnahme. Es genügt der DATEIANFANG — EXIF steht vor den Bilddaten, der
 * Aufrufer holt daher nur die ersten Kilobytes per Range-Request.
 */
export function liesAufnahme(buf: ArrayBuffer): ExifAufnahme {
  try {
    return liesAufnahmeIntern(buf)
  } catch {
    return {}
  }
}

/** Zahl mit deutschem Komma, ohne unnötige Nullen („2,8" statt „2.80"). */
function komma(n: number, stellen = 1): string {
  return n.toFixed(stellen).replace(/[.,]?0+$/, '').replace('.', ',')
}

/**
 * Aufnahmedaten zu Anzeige-Zeilen aufbereiten (Beschriftung → Wert). Nur was
 * das Foto wirklich trägt; leere Liste = keine Kameradaten. Rein und getestet —
 * der Editor rendert die Paare bloß noch.
 */
export function beschreibeAufnahme(a: ExifAufnahme): Array<[string, string]> {
  const zeilen: Array<[string, string]> = []
  if (a.kamera) zeilen.push(['Kamera', a.kamera])
  if (a.objektiv) zeilen.push(['Objektiv', a.objektiv])

  // Belichtung als eine Zeile, wie sie auf jedem Kameradisplay steht.
  const teile: string[] = []
  if (a.belichtungS !== undefined && a.belichtungS > 0) {
    teile.push(a.belichtungS < 1 ? `1/${Math.round(1 / a.belichtungS)} s` : `${komma(a.belichtungS)} s`)
  }
  if (a.blende !== undefined) teile.push(`f/${komma(a.blende)}`)
  if (a.iso !== undefined) teile.push(`ISO ${a.iso}`)
  if (a.brennweiteMm !== undefined) teile.push(`${komma(a.brennweiteMm, 0)} mm`)
  if (a.korrekturEv) teile.push(`${a.korrekturEv > 0 ? '+' : '−'}${komma(Math.abs(a.korrekturEv))} EV`)
  if (teile.length) zeilen.push(['Belichtung', teile.join(' · ')])

  if (a.breite && a.hoehe) {
    const mp = (a.breite * a.hoehe) / 1_000_000
    zeilen.push(['Auflösung', `${a.breite} × ${a.hoehe}${mp >= 0.5 ? ` · ${komma(mp)} MP` : ''}`])
  }
  if (a.hoeheM !== undefined) zeilen.push(['Höhe', `${Math.round(a.hoeheM)} m`])
  return zeilen
}

/** TIFF-Kopf eines JPEG finden: Offset des TIFF-Headers + Endianness. */
function findeTiff(view: DataView): { tiff: number; le: boolean } | null {
  if (view.byteLength < 16 || view.getUint16(0) !== 0xffd8) return null // kein JPEG
  let off = 2
  while (off + 8 <= view.byteLength) {
    if (view.getUint8(off) !== 0xff) break
    const marker = view.getUint8(off + 1)
    if (marker === 0xda) break // Start of Scan
    const size = view.getUint16(off + 2)
    if (marker === 0xe1 && view.getUint32(off + 4) === 0x45786966 /* 'Exif' */) {
      const tiff = off + 10
      if (tiff + 8 > view.byteLength) return null
      return { tiff, le: view.getUint16(tiff) === 0x4949 }
    }
    off += 2 + size
  }
  return null
}

function liesAufnahmeIntern(buf: ArrayBuffer): ExifAufnahme {
  const view = new DataView(buf)
  const kopf = findeTiff(view)
  if (!kopf) return {}
  const { tiff, le } = kopf
  const ifd0 = view.getUint32(tiff + 4, le)
  const a: ExifAufnahme = {}

  // Kamera: Hersteller + Modell, ohne den Hersteller doppelt zu nennen
  // („Apple" + „iPhone 15 Pro", aber „Canon" + „Canon EOS R6" → einmal Canon).
  const makeE = findTag(view, tiff, ifd0, 0x010f, le)
  const modelE = findTag(view, tiff, ifd0, 0x0110, le)
  const make = makeE ? textTag(view, tiff, makeE, le) : undefined
  const model = modelE ? textTag(view, tiff, modelE, le) : undefined
  if (make && model) a.kamera = model.toLowerCase().startsWith(make.toLowerCase()) ? model : `${make} ${model}`
  else {
    const einzeln = model ?? make
    if (einzeln !== undefined) a.kamera = einzeln
  }

  const exifPtr = findTag(view, tiff, ifd0, 0x8769, le)
  if (exifPtr) {
    const sub = view.getUint32(exifPtr + 8, le)
    const setzeText = (tag: number, feld: 'objektiv'): void => {
      const e = findTag(view, tiff, sub, tag, le)
      const wert = e ? textTag(view, tiff, e, le) : undefined
      if (wert !== undefined) a[feld] = wert
    }
    const setzeRational = (tag: number, feld: 'belichtungS' | 'blende' | 'brennweiteMm' | 'korrekturEv'): void => {
      const e = findTag(view, tiff, sub, tag, le)
      const wert = e ? rationalTag(view, tiff, e, le) : undefined
      if (wert !== undefined) a[feld] = wert
    }
    const setzeZahl = (tag: number, feld: 'iso' | 'breite' | 'hoehe'): void => {
      const e = findTag(view, tiff, sub, tag, le)
      const wert = e ? zahlTag(view, e, le) : undefined
      if (wert !== undefined) a[feld] = wert
    }
    setzeText(0xa434, 'objektiv')
    setzeRational(0x829a, 'belichtungS')
    setzeRational(0x829d, 'blende')
    setzeRational(0x920a, 'brennweiteMm')
    setzeRational(0x9204, 'korrekturEv')
    setzeZahl(0x8827, 'iso')
    setzeZahl(0xa002, 'breite')
    setzeZahl(0xa003, 'hoehe')
  }
  // Fallback-Maße aus IFD0, wenn die Exif-Pixelmaße fehlen (ältere Kameras)
  if (a.breite === undefined) {
    const e = findTag(view, tiff, ifd0, 0x0100, le)
    const wert = e ? zahlTag(view, e, le) : undefined
    if (wert !== undefined) a.breite = wert
  }
  if (a.hoehe === undefined) {
    const e = findTag(view, tiff, ifd0, 0x0101, le)
    const wert = e ? zahlTag(view, e, le) : undefined
    if (wert !== undefined) a.hoehe = wert
  }

  const gpsPtr = findTag(view, tiff, ifd0, 0x8825, le)
  if (gpsPtr) {
    const gpsIfd = view.getUint32(gpsPtr + 8, le)
    const altE = findTag(view, tiff, gpsIfd, 0x0006, le)
    const alt = altE ? rationalTag(view, tiff, altE, le) : undefined
    if (alt !== undefined) {
      // GPSAltitudeRef: 1 = unter dem Meeresspiegel
      const refE = findTag(view, tiff, gpsIfd, 0x0005, le)
      a.hoeheM = refE && view.getUint8(refE + 8) === 1 ? -alt : alt
    }
  }
  return a
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
