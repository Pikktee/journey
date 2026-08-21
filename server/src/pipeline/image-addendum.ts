// Nachtrag der Bild-Fassungen für Touren, die vor deren Einführung gerendert
// wurden. Läuft einmalig beim Start; danach findet der Durchlauf nichts mehr.
//
// Bewusst KEIN Re-Render: Die Anreicherung würde Bildanalyse, Geocoding und
// Wetterabfragen für alle Bestandstouren neu anstoßen (dieselbe Überlegung wie
// beim Titelbild-Nachtrag nebenan). Stattdessen entstehen die Fassungen, und im
// fertigen tour.json werden nur die Medien-Pfade umgeschrieben.
//
// Die REIHENFOLGE trägt die Sicherheit: Erst liegen die Fassungen, dann zeigt
// das tour.json auf sie, und erst danach verwirft preparePhotos das Original.
// Bricht der Durchlauf mittendrin ab, ist der Zustand jederzeit spielbar — beim
// nächsten Start macht er dort weiter, wo er aufgehört hat.

import { preparePhotos, type ImageStorage, type ImageTool } from './image.js'
import { chooseCover, type TourJson } from './enrich.js'
import type { Db } from '../db.js'
import type { Storage } from '../storage.js'

export interface BackfillResult {
  tours: number
  /** Eingesparte Bytes (Originale minus erzeugte Fassungen) */
  saved: number
}

/**
 * Fassungen für fertige Touren erzeugen, deren Medien noch Originale sind.
 *
 * Erkannt werden sie am fehlenden `cover_thumb` — die Spalte füllt der Renderer
 * seit der Umstellung bei jeder Tour, sie ist damit die verlässlichere Marke als
 * ein Blick in den Storage.
 *
 * Ohne Stapelgrenze: Der Aufrufer startet den Durchlauf NACH `listen`, er
 * blockiert also nichts. Ein Limit hieße nur, dass der Rest bis zum nächsten
 * Neustart auf der Platte liegen bleibt.
 */
export async function backfillImageVariants(
  db: Db,
  storage: Storage,
  tourJsonPath: string,
  tool: ImageTool,
  log?: (message: string) => void,
): Promise<BackfillResult> {
  const offen = db
    .prepare(`SELECT id, cover FROM tours WHERE status = 'ready' AND cover_thumb IS NULL`)
    .all() as Array<{ id: string; cover: string | null }>
  if (offen.length === 0) return { tours: 0, saved: 0 }

  const writes = db.prepare('UPDATE tours SET cover = ?, cover_thumb = ? WHERE id = ?')
  let tours = 0
  let saved = 0
  for (const { id, cover } of offen) {
    try {
      saved += await backfillOneTour(storage, tourJsonPath, tool, id, cover, writes, log)
      tours++
    } catch (error) {
      // Eine Tour, die sich nicht aufbereiten lässt, blockiert den Start nicht.
      // Ihr cover_thumb bleibt leer — der nächste Durchlauf versucht es erneut.
      log?.(`Bild-Nachtrag übersprungen für ${id}: ${(error as Error).message}`)
    }
  }
  return { tours, saved }
}

async function backfillOneTour(
  storage: Storage,
  tourJsonPath: string,
  tool: ImageTool,
  id: string,
  altesCover: string | null,
  writes: { run: (...values: unknown[]) => unknown },
  log?: (message: string) => void,
): Promise<number> {
  const tourJson = JSON.parse((await storage.read(id, tourJsonPath)).toString('utf8')) as TourJson
  const vorher = await storage.totalSize(id)
  const imageStorage: ImageStorage = {
    read: (relPath) => storage.read(id, relPath),
    write: (relPath, content) => storage.write(id, relPath, content),
    info: (relPath) => storage.info(id, relPath),
    remove: (relPath) => storage.remove(id, relPath),
  }

  // Welches Medium das Titelbild ist, steht schon fest — im `cover` der
  // Datenbank. Es hier neu zu wählen, überginge eine im Studio getroffene
  // Entscheidung (`edits.titelbild`), die dem Nachtrag gar nicht vorliegt.
  const titelMedium = altesCover
    ? tourJson.media.find((m) => m.src === altesCover || m.poster === altesCover)
    : undefined

  // Die Medien-Pfade im tour.json sind URLs (/api/media/<tour>/<datei>) — die
  // Aufbereitung arbeitet auf Dateinamen.
  const fileFrom = (url: string | undefined): string | null => url?.split('/').pop() ?? null
  const photoMeta = await preparePhotos({
    media: tourJson.media.flatMap((m) => {
      const source = fileFrom(m.type === 'photo' ? m.src : m.poster)
      if (!source) return []
      return [{ id: m.id, sourceFile: source, display: m.type === 'photo' }]
    }),
    storage: imageStorage,
    tool,
    ...(log ? { log } : {}),
  })

  const media = tourJson.media.map((m) => {
    const variants = photoMeta.get(m.id)
    if (!variants) return m
    return {
      ...m,
      ...(variants.displayFile ? { src: `/api/media/${id}/${variants.displayFile}` } : {}),
      thumb: `/api/media/${id}/${variants.thumbFile}`,
    }
  })
  await storage.write(id, tourJsonPath, JSON.stringify({ ...tourJson, media }, null, 2))

  // Das Titelbild zeigt sonst weiter auf ein Original, das es nicht mehr gibt.
  const neuesTitelMedium = titelMedium ? media.find((m) => m.id === titelMedium.id) : undefined
  const titelbild = neuesTitelMedium
    ? {
        cover:
          (neuesTitelMedium.type === 'photo' ? neuesTitelMedium.src : neuesTitelMedium.poster) ??
          null,
        thumb: neuesTitelMedium.thumb ?? null,
      }
    : chooseCover(media)
  writes.run(titelbild?.cover ?? null, titelbild?.thumb ?? null, id)
  return Math.max(0, vorher - (await storage.totalSize(id)))
}
