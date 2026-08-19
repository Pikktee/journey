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
const MAX_PUNKTE = 90

export interface RoutenSignatur {
  /** SVG-`d` im Kasten 0..100 (beide Achsen), y bereits nach unten gedreht */
  d: string
  start: [number, number]
  ende: [number, number]
}

/**
 * Wegpunkte (lng, lat) zur Signatur verdichten. Liefert null, wenn zu wenige
 * Punkte da sind oder die Route auf einen Punkt zusammenfällt — dann zeigt die
 * Kachel eben keine Form, statt einen Strich zu erfinden.
 */
export function baueSignatur(
  punkte: ReadonlyArray<readonly [number, number]>,
): RoutenSignatur | null {
  if (punkte.length < 2) return null

  // Gleichmäßig ausdünnen; Anfang und Ende bleiben immer erhalten (sie tragen
  // die Marken).
  const schritt = Math.max(1, Math.ceil(punkte.length / MAX_PUNKTE))
  const roh: Array<readonly [number, number]> = []
  for (let i = 0; i < punkte.length; i += schritt) roh.push(punkte[i] as readonly [number, number])
  const letzter = punkte[punkte.length - 1] as readonly [number, number]
  if (roh[roh.length - 1] !== letzter) roh.push(letzter)

  const lats = roh.map((p) => p[1])
  const mittlereBreite = (Math.min(...lats) + Math.max(...lats)) / 2
  const kx = Math.cos((mittlereBreite * Math.PI) / 180)
  const xs = roh.map((p) => p[0] * kx)
  const ys = roh.map((p) => p[1])
  const x0 = Math.min(...xs)
  const x1 = Math.max(...xs)
  const y0 = Math.min(...ys)
  const y1 = Math.max(...ys)
  const spanne = Math.max(x1 - x0, y1 - y0)
  if (!(spanne > 0)) return null

  // Seitenverhältnis erhalten: die kürzere Achse wird zentriert, nicht gedehnt.
  const versatzX = (spanne - (x1 - x0)) / 2
  const versatzY = (spanne - (y1 - y0)) / 2
  const abbilden = (i: number): [number, number] => [
    runde(((xs[i] as number) - x0 + versatzX) * (100 / spanne)),
    // SVG zählt y nach unten, die Erde nach oben
    runde(100 - ((ys[i] as number) - y0 + versatzY) * (100 / spanne)),
  ]

  const ecken = roh.map((_, i) => abbilden(i))
  const d = ecken.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join('')
  return {
    d,
    start: ecken[0] as [number, number],
    ende: ecken[ecken.length - 1] as [number, number],
  }
}

/** Eine Nachkommastelle genügt bei 100 Einheiten Kantenlänge — spart Bytes je Kachel. */
function runde(wert: number): number {
  return Math.round(wert * 10) / 10
}
