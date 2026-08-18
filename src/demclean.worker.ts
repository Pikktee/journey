// Worker der DEM-Bereinigung: PNG rein, PNG raus, Main-Thread bleibt frei.
//
// Er trägt bewusst NUR das Dekodieren/Kodieren; die Rechnung steht in
// demclean-rechnung.ts, weil sie auch im Rückfall ohne Worker laufen muss.

import { bereinigeHoehen, KACHEL } from './demclean-rechnung.js'

interface Auftrag { id: number; buf: ArrayBuffer }

self.addEventListener('message', async (ev: MessageEvent<Auftrag>) => {
  const { id, buf } = ev.data
  try {
    const bmp = await createImageBitmap(new Blob([buf], { type: 'image/png' }))
    const cv = new OffscreenCanvas(KACHEL, KACHEL)
    const ctx = cv.getContext('2d', { willReadFrequently: true })
    if (!ctx) { self.postMessage({ id, data: null }); return }
    ctx.drawImage(bmp, 0, 0)
    bmp.close?.()
    const img = ctx.getImageData(0, 0, KACHEL, KACHEL)
    if (!bereinigeHoehen(img.data)) { self.postMessage({ id, data: null }); return }
    ctx.putImageData(img, 0, 0)
    const out = await (await cv.convertToBlob({ type: 'image/png' })).arrayBuffer()
    self.postMessage({ id, data: out }, { transfer: [out] })
  } catch {
    self.postMessage({ id, data: null }) // im Zweifel die Originalbytes des Aufrufers
  }
})
