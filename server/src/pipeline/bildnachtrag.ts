// Nachtrag der Bild-Fassungen für Touren, die vor deren Einführung gerendert
// wurden. Läuft einmalig beim Start; danach findet der Durchlauf nichts mehr.
//
// Bewusst KEIN Re-Render: Die Anreicherung würde Bildanalyse, Geocoding und
// Wetterabfragen für alle Bestandstouren neu anstoßen (dieselbe Überlegung wie
// beim Titelbild-Nachtrag nebenan). Stattdessen entstehen die Fassungen, und im
// fertigen tour.json werden nur die Medien-Pfade umgeschrieben.
//
// Die REIHENFOLGE trägt die Sicherheit: Erst liegen die Fassungen, dann zeigt
// das tour.json auf sie, und erst danach verwirft bereiteFotosAuf das Original.
// Bricht der Durchlauf mittendrin ab, ist der Zustand jederzeit spielbar — beim
// nächsten Start macht er dort weiter, wo er aufgehört hat.

import { bereiteFotosAuf, type BildSpeicher, type BildWerkzeug } from './bild.js'
import { bestimmeCover, type TourJson } from './enrich.js'
import type { Db } from '../db.js'
import type { Storage } from '../storage.js'

export interface NachtragErgebnis {
  touren: number
  /** Eingesparte Bytes (Originale minus erzeugte Fassungen) */
  gespart: number
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
export async function trageBildfassungenNach(
  db: Db,
  storage: Storage,
  tourJsonPfad: string,
  werkzeug: BildWerkzeug,
  protokoll?: (nachricht: string) => void,
): Promise<NachtragErgebnis> {
  const offen = db
    .prepare(`SELECT id, cover FROM tours WHERE status = 'ready' AND cover_thumb IS NULL`)
    .all() as Array<{ id: string; cover: string | null }>
  if (offen.length === 0) return { touren: 0, gespart: 0 }

  const setzen = db.prepare('UPDATE tours SET cover = ?, cover_thumb = ? WHERE id = ?')
  let touren = 0
  let gespart = 0
  for (const { id, cover } of offen) {
    try {
      gespart += await trageEineTourNach(
        storage,
        tourJsonPfad,
        werkzeug,
        id,
        cover,
        setzen,
        protokoll,
      )
      touren++
    } catch (fehler) {
      // Eine Tour, die sich nicht aufbereiten lässt, blockiert den Start nicht.
      // Ihr cover_thumb bleibt leer — der nächste Durchlauf versucht es erneut.
      protokoll?.(`Bild-Nachtrag übersprungen für ${id}: ${(fehler as Error).message}`)
    }
  }
  return { touren, gespart }
}

async function trageEineTourNach(
  storage: Storage,
  tourJsonPfad: string,
  werkzeug: BildWerkzeug,
  id: string,
  altesCover: string | null,
  setzen: { run: (...werte: unknown[]) => unknown },
  protokoll?: (nachricht: string) => void,
): Promise<number> {
  const tourJson = JSON.parse((await storage.lese(id, tourJsonPfad)).toString('utf8')) as TourJson
  const vorher = await storage.gesamtGroesse(id)
  const speicher: BildSpeicher = {
    lese: (relPfad) => storage.lese(id, relPfad),
    schreibe: (relPfad, inhalt) => storage.schreibe(id, relPfad, inhalt),
    info: (relPfad) => storage.info(id, relPfad),
    loesche: (relPfad) => storage.loesche(id, relPfad),
  }

  // Welches Medium das Titelbild ist, steht schon fest — im `cover` der
  // Datenbank. Es hier neu zu wählen, überginge eine im Studio getroffene
  // Entscheidung (`edits.titelbild`), die dem Nachtrag gar nicht vorliegt.
  const titelMedium = altesCover
    ? tourJson.media.find((m) => m.src === altesCover || m.poster === altesCover)
    : undefined

  // Die Medien-Pfade im tour.json sind URLs (/api/media/<tour>/<datei>) — die
  // Aufbereitung arbeitet auf Dateinamen.
  const dateiAus = (url: string | undefined): string | null => url?.split('/').pop() ?? null
  const fotoMeta = await bereiteFotosAuf({
    medien: tourJson.media.flatMap((m) => {
      const quelle = dateiAus(m.type === 'photo' ? m.src : m.poster)
      if (!quelle) return []
      return [{ id: m.id, quellDatei: quelle, anzeige: m.type === 'photo' }]
    }),
    speicher,
    werkzeug,
    ...(protokoll ? { protokoll } : {}),
  })

  const medien = tourJson.media.map((m) => {
    const fassungen = fotoMeta.get(m.id)
    if (!fassungen) return m
    return {
      ...m,
      ...(fassungen.anzeigeDatei ? { src: `/api/media/${id}/${fassungen.anzeigeDatei}` } : {}),
      thumb: `/api/media/${id}/${fassungen.thumbDatei}`,
    }
  })
  await storage.schreibe(id, tourJsonPfad, JSON.stringify({ ...tourJson, media: medien }, null, 2))

  // Das Titelbild zeigt sonst weiter auf ein Original, das es nicht mehr gibt.
  const neuesTitelMedium = titelMedium ? medien.find((m) => m.id === titelMedium.id) : undefined
  const titelbild = neuesTitelMedium
    ? {
        cover:
          (neuesTitelMedium.type === 'photo' ? neuesTitelMedium.src : neuesTitelMedium.poster) ??
          null,
        thumb: neuesTitelMedium.thumb ?? null,
      }
    : bestimmeCover(medien)
  setzen.run(titelbild?.cover ?? null, titelbild?.thumb ?? null, id)
  return Math.max(0, vorher - (await storage.gesamtGroesse(id)))
}
