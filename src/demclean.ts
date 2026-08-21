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
//
// **Gerechnet wird im WORKER, und das ist keine Kosmetik.** Der
// `addProtocol`-Rückruf läuft im Main-Thread, also in derselben Kette wie die
// Kamera: Eine Kachel kostete dort gemessen bis zu 515 ms, das längste Frame
// einer 30-Sekunden-Fahrt lag bei 704 ms statt 65 ms. Weil es am Eintreffen
// einer Kachel hängt und nicht am Gelände, fiel es unvorhersehbar an und sah
// wie ein zufälliger Aussetzer aus. Der `fetch` bleibt hier (er kennt das
// Abbruch-Signal), nur die Bildarbeit geht hinüber.

import { cleanElevations, TILE } from './dem-clean-math.js'

/** Antwort des Workers: `data === null` heißt „nichts geändert". */
interface WorkerReply {
  id: number
  data: ArrayBuffer | null
}

let nextId = 1
const pending = new Map<number, (data: ArrayBuffer | null) => void>()
let workers: Worker[] | null = null
let roundRobin = 0

/**
 * Zwei Worker, nicht einer und nicht acht: MapLibre lädt Kacheln in Schüben,
 * ein einzelner Arbeiter reichte sie durch und das Terrain käme spät; mehr als
 * zwei nähmen dem Renderer Kerne weg, ohne dass jemand darauf wartet.
 */
function getWorkers(): Worker[] | null {
  if (workers) return workers
  if (typeof Worker === 'undefined') return null
  try {
    workers = [0, 1].map(() => {
      const w = new Worker(new URL('./demclean.worker.js', import.meta.url), { type: 'module' })
      w.addEventListener('message', (ev: MessageEvent<WorkerReply>) => {
        const done = pending.get(ev.data.id)
        if (!done) return
        pending.delete(ev.data.id)
        done(ev.data.data)
      })
      return w
    })
  } catch {
    workers = null // z. B. blockierte Worker-Erzeugung: unten läuft der Rückfall
  }
  return workers
}

// Registriert das demclean://-Protokoll einmalig. DEM-Quelle nutzt dann
// demclean://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png
let registered = false
export function registerDemClean(maplibregl: {
  addProtocol: typeof import('maplibre-gl').addProtocol
}) {
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
      const cleaned = await clean(buf)
      return { data: cleaned ?? buf }
    } catch {
      return { data: buf } // im Zweifel Originaldaten, nie die Kachel verlieren
    }
  })
}

function zoomOf(url: string): number | null {
  const m = url.match(/\/terrarium\/(\d+)\//)
  return m?.[1] ? +m[1] : null
}

/**
 * Schickt eine Kachel zum Worker. Ohne Worker wird im Main-Thread gerechnet:
 * Das ruckelt (deshalb der Umbau), liefert aber ein richtiges Gelände — und
 * ein Spike, der aus dem Wasser ragt, ist der sichtbarere Fehler.
 */
async function clean(buf: ArrayBuffer): Promise<ArrayBuffer | null> {
  const pool = getWorkers()
  if (!pool) return await inMainThread(buf)
  const id = nextId++
  const copy = buf.slice(0) // der Aufrufer behält seine Originalbytes als Rückfall
  const response = new Promise<ArrayBuffer | null>((done) => pending.set(id, done))
  pool[roundRobin++ % pool.length]!.postMessage({ id, buf: copy }, [copy])
  return await response
}

async function inMainThread(buf: ArrayBuffer): Promise<ArrayBuffer | null> {
  const bmp = await createImageBitmap(new Blob([buf], { type: 'image/png' }))
  const cv = new OffscreenCanvas(TILE, TILE)
  const ctx = cv.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(bmp, 0, 0)
  bmp.close?.()
  const img = ctx.getImageData(0, 0, TILE, TILE)
  if (!cleanElevations(img.data)) return null
  ctx.putImageData(img, 0, 0)
  return await (await cv.convertToBlob({ type: 'image/png' })).arrayBuffer()
}
