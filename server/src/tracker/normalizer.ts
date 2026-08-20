// Rohtrack eines Anbieters → kanonisches GPX.
//
// Die EINE Stelle, die GPX schreibt. Jeder Adapter liefert, was er von Haus aus
// hat (Polar: fertiges GPX, Strava/RWGPS: JSON-Reihen, Wahoo/Suunto: FIT), und
// erst hier wird daraus das Format, das `parseGpx` und die Pipeline erwarten.
// Ohne diese Trennung schriebe jeder Adapter denselben Serialisierer, und seine
// Tests prüften String-Vergleiche statt Koordinaten.

import { NoRouteError, type RawPoint, type RawTrack } from './contract.js'

/**
 * Obergrenze wie im GPX-Parser der Pipeline (`MAX_TRACKPUNKTE`): Ein Anbieter,
 * der eine Millionen-Punkte-Reihe schickt, soll den Prozess nicht mit dem
 * Bauen eines XML-Strings blockieren.
 */
export const MAX_POINTS = 200_000

/** XML-Sonderzeichen im Titel — er kommt vom Anbieter und landet in `<name>`. */
function escape(text: string): string {
  return text.replace(
    /[<>&'"]/g,
    (c) => `&${{ '<': 'lt', '>': 'gt', '&': 'amp', "'": 'apos', '"': 'quot' }[c]};`,
  )
}

/** Zahl mit sinnvoller Genauigkeit: 7 Nachkommastellen sind ~1 cm. */
function koord(n: number): string {
  return n.toFixed(7).replace(/\.?0+$/, '')
}

/**
 * Punkte → GPX. Punkte ohne brauchbare Koordinate fallen raus (Anbieter liefern
 * in Pausen gern `null`-Einträge in den Streams); bleibt nichts übrig, ist das
 * eine Aktivität OHNE Route und kein Fehler — s. `NoRouteError`.
 */
export function pointsToGpx(punkte: readonly RawPoint[], titel?: string | null): string {
  const gute = punkte
    .filter(
      (p) =>
        Number.isFinite(p.lat) &&
        Number.isFinite(p.lng) &&
        Math.abs(p.lat) <= 90 &&
        Math.abs(p.lng) <= 180,
    )
    .slice(0, MAX_POINTS)
  if (gute.length < 2) throw new NoRouteError()
  const zeilen = gute.map((p) => {
    const teile = [`<trkpt lat="${koord(p.lat)}" lon="${koord(p.lng)}">`]
    if (Number.isFinite(p.ele)) teile.push(`<ele>${koord(p.ele as number)}</ele>`)
    // Die Zeit ist für die Pipeline kein Beiwerk: An ihr hängen Tempo,
    // Pausen-Kollaps und die Platzierung der Fotos. Unparsbares lieber
    // weglassen als eine erfundene Zeit zu schreiben.
    if (p.zeit && Number.isFinite(Date.parse(p.zeit))) teile.push(`<time>${escape(p.zeit)}</time>`)
    teile.push('</trkpt>')
    return `      ${teile.join('')}`
  })
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Maptale" xmlns="http://www.topografix.com/GPX/1/1">',
    '  <trk>',
    ...(titel ? [`    <name>${escape(titel)}</name>`] : []),
    '    <trkseg>',
    ...zeilen,
    '    </trkseg>',
    '  </trk>',
    '</gpx>',
  ].join('\n')
}

/**
 * Ein Rohtrack in GPX-Text.
 *
 * GPX wird DURCHGEREICHT, nicht umgeschrieben: Polar liefert es fertig, und
 * jedes Neuschreiben verlöre Angaben, die wir nicht kennen (Erweiterungen,
 * Herzfrequenz, Genauigkeit) — die Pipeline liest ohnehin nur, was sie braucht.
 * FIT und TCX kommen mit Etappe 2 dazu; bis dahin sagt die Fehlermeldung, was
 * fehlt, statt still nichts zu tun.
 */
export function toGpx(track: RawTrack): string {
  if (track.format === 'gpx') {
    const text = new TextDecoder().decode(track.bytes ?? new Uint8Array())
    if (!text.includes('<trkpt')) throw new NoRouteError()
    return text
  }
  if (track.format === 'punkte') return pointsToGpx(track.punkte ?? [], track.titel)
  throw new Error(`Format ${track.format} wird noch nicht gelesen (Etappe 2)`)
}
