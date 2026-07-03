// Client-seitige DEM-Bereinigung gegen kaputte Terrarium-Overview-Kacheln.
//
// Die groben Übersichtskacheln (Zoom ≤ 12) der Terrarium-Höhendaten enthalten
// vereinzelt korrupte Ausreißer-Pixel — z. B. ein ~3×3-Fleck mit bis zu 335 m
// (z11) bzw. 801 m (z12) mitten im flachen Stockholmer Schärenwasser, wo die
// echte Höhe ~20 m beträgt. Die feinen z13-Kacheln (native Auflösung) sind an
// derselben Stelle sauber. Beim Nachladen zeigt MapLibre für einen Moment die
// grobe Elternkachel als Terrain — der Fleck ragt dann als riesiger Textur-Spike
// aus dem Wasser und verschwindet erst, wenn die feine Kachel geladen ist.
//
// Wir hängen uns per addProtocol in den Kachelabruf, dekodieren die Höhen und
// ziehen isolierte Tiefland-Spikes auf ihr lokales Niveau. Das wirkt weltweit
// und braucht kein Backend/keinen Key. Echtes Bergrelief bleibt unberührt:
//   • Nur Zoom ≤ 12 wird bearbeitet — die feinen Kacheln laufen unverändert
//     durch (sie sind sauber, und der heiße Flug-Pfad bleibt kostenlos).
//   • Gekappt wird nur, wenn die lokale Umgebung nahe Meereshöhe liegt
//     (Median < LOWLAND). In den Alpen liegt schon das lokale Minimum weit
//     darüber → die Kachel wird gar nicht erst angefasst (verifiziert: 0 Pixel).
//
// Verifiziert offline gegen die echten Kacheln: Stockholm 335 m → 56 m,
// 801 m → 51 m; Oberland/Eiger (elMax ~4000 m) 0 Pixel geändert.

const SIZE = 256
const R = 3 // 7×7-Fenster
const CAND = 35 // m über lokalem Minimum → überhaupt Kandidat (billiger Vorfilter)
const SPIKE = 50 // m über lokalem Median → als Ausreißer kappen
const LOWLAND = 140 // m: nur in flacher/küstennaher Umgebung kappen, nie im Gebirge
const MAX_PASSES = 4 // iterieren, bis auch die Randpixel des Flecks weg sind

const decode = (r, g, b) => r * 256 + g + b / 256 - 32768

// Höhe → Terrarium-RGB zurückschreiben (Alpha unangetastet lassen)
function encode(data, i, e) {
  const T = Math.max(0, Math.min(65535.996, e + 32768))
  const f = Math.floor(T)
  data[i] = Math.floor(T / 256)
  data[i + 1] = f % 256
  data[i + 2] = Math.round((T - f) * 256) % 256
}

// Registriert das demclean://-Protokoll einmalig. DEM-Quelle nutzt dann
// demclean://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png
let registered = false
export function registerDemClean(maplibregl) {
  if (registered) return
  registered = true
  maplibregl.addProtocol('demclean', async (params, abort) => {
    const url = params.url.replace('demclean://', 'https://')
    const res = await fetch(url, { signal: abort.signal })
    if (!res.ok) throw new Error(`DEM ${res.status}`)
    const buf = await res.arrayBuffer()
    const z = zoomOf(url)
    // Feine Kacheln (native Auflösung) sind sauber → unverändert durchreichen.
    if (z == null || z > 12 || typeof OffscreenCanvas === 'undefined') return { data: buf }
    try {
      const cleaned = await cleanTile(buf)
      return { data: cleaned ?? buf }
    } catch {
      return { data: buf } // im Zweifel Originaldaten, nie die Kachel verlieren
    }
  })
}

function zoomOf(url) {
  const m = url.match(/\/terrarium\/(\d+)\//)
  return m ? +m[1] : null
}

async function cleanTile(buf) {
  const bmp = await createImageBitmap(new Blob([buf], { type: 'image/png' }))
  const cv = new OffscreenCanvas(SIZE, SIZE)
  const ctx = cv.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(bmp, 0, 0)
  bmp.close?.()
  const img = ctx.getImageData(0, 0, SIZE, SIZE)
  const d = img.data

  const orig = new Float32Array(SIZE * SIZE)
  for (let p = 0, i = 0; p < orig.length; p++, i += 4) orig[p] = decode(d[i], d[i + 1], d[i + 2])

  // Iterativer Despeckle: jeder Durchlauf liest die Baseline aus dem Stand des
  // Vor-Durchlaufs, sonst schirmen die Fleck-Pixel ihre Nachbarn gegenseitig ab.
  const cur = orig.slice()
  let total = 0
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const snap = cur.slice()
    let changed = 0
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const e = snap[y * SIZE + x]
        const x0 = Math.max(0, x - R), x1 = Math.min(SIZE - 1, x + R)
        const y0 = Math.max(0, y - R), y1 = Math.min(SIZE - 1, y + R)
        let mn = Infinity
        for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
          const v = snap[yy * SIZE + xx]
          if (v < mn) mn = v
        }
        // billiger Vorfilter: kein lokaler Ausreißer oder gar kein Tiefland → weiter
        if (e - mn <= CAND || mn >= LOWLAND) continue
        const win = []
        for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) win.push(snap[yy * SIZE + xx])
        win.sort((a, b) => a - b)
        const med = win[win.length >> 1]
        if (e - med > SPIKE && med < LOWLAND) {
          cur[y * SIZE + x] = med
          changed++
        }
      }
    }
    total += changed
    if (!changed) break
  }

  if (!total) return null // nichts geändert → Originalbytes behalten (exakt, kein Re-Encode)

  for (let p = 0, i = 0; p < cur.length; p++, i += 4) if (cur[p] !== orig[p]) encode(d, i, cur[p])
  ctx.putImageData(img, 0, 0)
  const outBlob = await cv.convertToBlob({ type: 'image/png' })
  return await outBlob.arrayBuffer()
}
