// Routen-Signatur: die FORM einer Tour als winziger SVG-Pfad.
//
// In der Bibliothek trägt jede Kachel ein Titelbild — aber Fotos sehen einander
// ähnlich, Routen nicht. Die Signatur ist das, woran man eine Reise wiedererkennt,
// bevor man den Titel gelesen hat. Sie entsteht EINMAL beim Anreichern und liegt
// dann in den Tour-Statistiken; die Bibliothek zeichnet nur noch nach.
//
// Bewusst nicht geografisch korrekt: nur Seitenverhältnis-treu in einen
// 0..100-Kasten gelegt (mit Breitengrad-Korrektur, sonst wären Nord-Süd-Touren
// in Äquatornähe gestaucht). Wer Kilometer wissen will, liest die Zahl daneben.

/** Größte Punktzahl der Signatur — darüber wird gleichmäßig ausgedünnt. */
const MAX_POINTS = 90

export interface TrackSignature {
  /** SVG-`d` im Kasten 0..100 (beide Achsen), y bereits nach unten gedreht */
  d: string
  start: [number, number]
  end: [number, number]
}

/**
 * Wegpunkte (lng, lat) zur Signatur verdichten. Liefert null, wenn zu wenige
 * Punkte da sind oder die Route auf einen Punkt zusammenfällt — dann zeigt die
 * Kachel eben keine Form, statt einen Strich zu erfinden.
 */
export function buildSignature(
  points: ReadonlyArray<readonly [number, number]>,
): TrackSignature | null {
  if (points.length < 2) return null

  // Gleichmäßig ausdünnen; Anfang und Ende bleiben immer erhalten (sie tragen
  // die Marken).
  const step = Math.max(1, Math.ceil(points.length / MAX_POINTS))
  const raw: Array<readonly [number, number]> = []
  for (let i = 0; i < points.length; i += step) raw.push(points[i] as readonly [number, number])
  const last = points[points.length - 1] as readonly [number, number]
  if (raw[raw.length - 1] !== last) raw.push(last)

  const lats = raw.map((p) => p[1])
  const midLatitude = (Math.min(...lats) + Math.max(...lats)) / 2
  const kx = Math.cos((midLatitude * Math.PI) / 180)
  const xs = raw.map((p) => p[0] * kx)
  const ys = raw.map((p) => p[1])
  const x0 = Math.min(...xs)
  const x1 = Math.max(...xs)
  const y0 = Math.min(...ys)
  const y1 = Math.max(...ys)
  const span = Math.max(x1 - x0, y1 - y0)
  if (!(span > 0)) return null

  // Seitenverhältnis erhalten: die kürzere Achse wird zentriert, nicht gedehnt.
  const offsetX = (span - (x1 - x0)) / 2
  const offsetY = (span - (y1 - y0)) / 2
  const mapPoint = (i: number): [number, number] => [
    round(((xs[i] as number) - x0 + offsetX) * (100 / span)),
    // SVG zählt y nach unten, die Erde nach oben
    round(100 - ((ys[i] as number) - y0 + offsetY) * (100 / span)),
  ]

  const corners = raw.map((_, i) => mapPoint(i))
  const d = corners.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join('')
  return {
    d,
    start: corners[0] as [number, number],
    end: corners[corners.length - 1] as [number, number],
  }
}

/** Eine Nachkommastelle genügt bei 100 Einheiten Kantenlänge — spart Bytes je Kachel. */
function round(value: number): number {
  return Math.round(value * 10) / 10
}
