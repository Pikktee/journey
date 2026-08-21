// Die reine Rechnung der DEM-Bereinigung: Höhen dekodieren, isolierte
// Tiefland-Spikes auf ihr lokales Niveau ziehen, zurückschreiben.
//
// Sie steht in einer eigenen Datei, weil sie an ZWEI Orten laufen muss: im
// Worker (Normalfall) und im Main-Thread als Rückfall, wenn kein Worker
// zustande kommt. Warum überhaupt ein Worker: Der `addProtocol`-Rückruf läuft
// im Main-Thread, und diese Schleife kostete dort gemessen bis zu 515 ms für
// eine einzelne Kachel. Das war der größte Einzelposten der Mikroruckler auf
// einem M4 (30 s Fahrt: 1007 ms Skriptzeit in 14 Aufrufen, längstes Frame
// 704 ms; ohne die Bereinigung blieb das längste Frame bei 65 ms). Es fiel
// nach Netz-Zufall an, nicht nach Geländekomplexität, und sah deshalb beliebig
// aus.
//
// Der Grund für die Bereinigung selbst steht in demclean.ts.

const SIZE = 256
const R = 3 // 7×7-Fenster
const CAND = 35 // m über lokalem Minimum → überhaupt Kandidat (billiger Vorfilter)
const SPIKE = 50 // m über lokalem Median → als Ausreißer kappen
const LOWLAND = 140 // m: nur in flacher/küstennaher Umgebung kappen, nie im Gebirge
const MAX_PASSES = 4 // iterieren, bis auch die Randpixel des Flecks weg sind

const decode = (r: number, g: number, b: number) => r * 256 + g + b / 256 - 32768

// Höhe → Terrarium-RGB zurückschreiben (Alpha unangetastet lassen)
function encode(data: Uint8ClampedArray, i: number, e: number) {
  const T = Math.max(0, Math.min(65535.996, e + 32768))
  const f = Math.floor(T)
  data[i] = Math.floor(T / 256)
  data[i + 1] = f % 256
  data[i + 2] = Math.round((T - f) * 256) % 256
}

/**
 * Minimum über das 7×7-Fenster, separabel gerechnet: erst je Zeile, dann je
 * Spalte über das Zwischenergebnis. Das Minimum ist assoziativ, das Ergebnis
 * ist also punktgleich mit dem 49er-Fenster, kostet aber 14 statt 49
 * Vergleiche je Pixel. Der Vorfilter darunter verwirft die allermeisten Pixel,
 * bevor der teure Median-Zweig überhaupt anläuft, weshalb genau dieses Minimum
 * der heiße Pfad war.
 */
function minWindow(src: Float32Array, aux: Float32Array, dst: Float32Array) {
  for (let y = 0; y < SIZE; y++) {
    const z = y * SIZE
    for (let x = 0; x < SIZE; x++) {
      const x0 = x - R < 0 ? 0 : x - R
      const x1 = x + R > SIZE - 1 ? SIZE - 1 : x + R
      let m = Infinity
      for (let xx = x0; xx <= x1; xx++) {
        const v = src[z + xx]!
        if (v < m) m = v
      }
      aux[z + x] = m
    }
  }
  for (let y = 0; y < SIZE; y++) {
    const y0 = y - R < 0 ? 0 : y - R
    const y1 = y + R > SIZE - 1 ? SIZE - 1 : y + R
    for (let x = 0; x < SIZE; x++) {
      let m = Infinity
      for (let yy = y0; yy <= y1; yy++) {
        const v = aux[yy * SIZE + x]!
        if (v < m) m = v
      }
      dst[y * SIZE + x] = m
    }
  }
}

/**
 * Bereinigt die Pixel EINER Kachel. Gibt `false` zurück, wenn nichts geändert
 * wurde: Dann behält der Aufrufer die Originalbytes, statt neu zu kodieren.
 */
export function cleanElevations(d: Uint8ClampedArray): boolean {
  // Alle Puffer sind exakt SIZE×SIZE groß und jede Schleife unten läuft über
  // geklemmte Indizes; die `!` stehen deshalb für „nachweislich im Bereich".
  const orig = new Float32Array(SIZE * SIZE)
  for (let p = 0, i = 0; p < orig.length; p++, i += 4) orig[p] = decode(d[i]!, d[i + 1]!, d[i + 2]!)

  const cur = orig.slice()
  const aux = new Float32Array(SIZE * SIZE)
  const mins = new Float32Array(SIZE * SIZE)
  let total = 0
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    // Iterativer Despeckle: jeder Durchlauf liest die Baseline aus dem Stand
    // des Vor-Durchlaufs, sonst schirmen die Fleck-Pixel ihre Nachbarn
    // gegenseitig ab.
    const snap = cur.slice()
    minWindow(snap, aux, mins)
    let changed = 0
    for (let y = 0; y < SIZE; y++) {
      const y0 = y - R < 0 ? 0 : y - R
      const y1 = y + R > SIZE - 1 ? SIZE - 1 : y + R
      for (let x = 0; x < SIZE; x++) {
        const e = snap[y * SIZE + x]!
        const mn = mins[y * SIZE + x]!
        // billiger Vorfilter: kein lokaler Ausreißer oder gar kein Tiefland → weiter
        if (e - mn <= CAND || mn >= LOWLAND) continue
        const x0 = x - R < 0 ? 0 : x - R
        const x1 = x + R > SIZE - 1 ? SIZE - 1 : x + R
        const win: number[] = []
        for (let yy = y0; yy <= y1; yy++)
          for (let xx = x0; xx <= x1; xx++) win.push(snap[yy * SIZE + xx]!)
        win.sort((a, b) => a - b)
        const med = win[win.length >> 1]!
        if (e - med > SPIKE && med < LOWLAND) {
          cur[y * SIZE + x] = med
          changed++
        }
      }
    }
    total += changed
    if (!changed) break
  }

  if (!total) return false // nichts geändert → Originalbytes behalten (exakt, kein Re-Encode)
  for (let p = 0, i = 0; p < cur.length; p++, i += 4) if (cur[p] !== orig[p]) encode(d, i, cur[p]!)
  return true
}

/** Kachelgröße in Pixeln; der Worker und der Rückfall brauchen sie beide. */
export const TILE = SIZE
