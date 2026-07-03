// Echte Höhendaten: Terrarium-DEM-Tiles (AWS Open Data) direkt samplen —
// dieselben Daten, aus denen MapLibre das sichtbare 3D-Terrain baut.
// Höhenprofil, Telemetrie und Karte sind damit garantiert konsistent.
const D2R = Math.PI / 180
const Z = 13
const SIZE = 256

function tileCoords(lng, lat) {
  const n = 2 ** Z
  const x = ((lng + 180) / 360) * n
  const latR = lat * D2R
  const y = ((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n
  return [x, y]
}

async function loadTile(tx, ty) {
  const res = await fetch(`https://elevation-tiles-prod.s3.amazonaws.com/terrarium/${Z}/${tx}/${ty}.png`)
  if (!res.ok) throw new Error(`Tile ${tx}/${ty}: ${res.status}`)
  const img = await createImageBitmap(await res.blob())
  const cv = document.createElement('canvas')
  cv.width = cv.height = SIZE
  const ctx = cv.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(img, 0, 0)
  return ctx.getImageData(0, 0, SIZE, SIZE).data
}

// Höhe in Metern für jede Koordinate; wenige Tile-Fetches, Rest ist Pixel-Lookup
export async function sampleElevations(coords) {
  const tiles = new Map()
  for (const c of coords) {
    const [x, y] = tileCoords(c[0], c[1])
    tiles.set(`${Math.floor(x)}/${Math.floor(y)}`, null)
  }
  await Promise.all(
    [...tiles.keys()].map(async (key) => {
      const [tx, ty] = key.split('/').map(Number)
      tiles.set(key, await loadTile(tx, ty))
    })
  )
  return coords.map((c) => {
    const [x, y] = tileCoords(c[0], c[1])
    const data = tiles.get(`${Math.floor(x)}/${Math.floor(y)}`)
    const px = Math.min(SIZE - 1, Math.floor((x % 1) * SIZE))
    const py = Math.min(SIZE - 1, Math.floor((y % 1) * SIZE))
    const i = (py * SIZE + px) * 4
    return data[i] * 256 + data[i + 1] + data[i + 2] / 256 - 32768
  })
}

// Gleitender Mittelwert gegen DEM-Rauschen (sonst zappelt das Profil
// und die Höhenmeter-Summe wird künstlich aufgebläht)
export function smoothValues(values, win = 9) {
  const half = Math.floor(win / 2)
  return values.map((_, i) => {
    let sum = 0
    let n = 0
    for (let j = Math.max(0, i - half); j <= Math.min(values.length - 1, i + half); j++) {
      sum += values[j]
      n++
    }
    return sum / n
  })
}
