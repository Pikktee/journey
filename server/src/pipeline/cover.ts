// Nachtrag der Titelbilder für Touren, die vor Einführung der cover-Spalte
// gerendert wurden. Läuft einmalig beim Start und liest dafür jedes tour.json —
// danach ist die Spalte gefüllt und der Durchlauf findet nichts mehr zu tun.
//
// Bewusst kein Re-Render: das Titelbild steht bereits im fertigen tour.json,
// es muss nur in die Datenbank nachgezogen werden. Ein Re-Render würde
// Bildanalyse und Wetterabfragen für alle Bestandstouren neu anstoßen.

import type { Db } from '../db.js'
import type { Storage } from '../storage.js'
import { bestimmeCover, type TourJson } from './enrich.js'

/** Titelbilder für alle bereiten Touren ohne cover nachtragen. Gibt die Anzahl zurück. */
export async function trageTitelbilderNach(
  db: Db,
  storage: Storage,
  tourJsonPfad: string,
  protokoll?: (nachricht: string) => void,
): Promise<number> {
  const offen = db
    .prepare(`SELECT id FROM tours WHERE status = 'bereit' AND cover IS NULL`)
    .all() as Array<{ id: string }>
  if (offen.length === 0) return 0

  const setzen = db.prepare('UPDATE tours SET cover = ? WHERE id = ?')
  let getan = 0
  for (const { id } of offen) {
    try {
      const tourJson = JSON.parse((await storage.lese(id, tourJsonPfad)).toString('utf8')) as TourJson
      const cover = bestimmeCover(tourJson.media)
      if (cover) {
        setzen.run(cover, id)
        getan++
      }
    } catch (fehler) {
      // Eine Tour ohne lesbares tour.json blockiert den Start nicht — sie
      // bekommt ihr Titelbild beim nächsten regulären Render.
      protokoll?.(`Titelbild-Nachtrag übersprungen für ${id}: ${(fehler as Error).message}`)
    }
  }
  return getan
}
