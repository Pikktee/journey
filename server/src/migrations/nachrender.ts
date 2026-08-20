// Nachrendern nach der Start-Migration (§4.3 des Englisch-Konzepts).
//
// `tour.json` wird NICHT umgeschrieben. Sie ist ein Erzeugnis: aus Manifest,
// Overlay und Cache fällt sie jedes Mal neu heraus, und ein umgeschriebenes
// Erzeugnis wäre eine zweite Wahrheit neben der Pipeline, die es erzeugt.
// Deshalb rendert der Server jede Tour einmal neu, deren Datei noch die alte
// Kennung trägt.
//
// **Seriell und nicht nebenläufig.** Ein Render zieht ffmpeg und je nach Tour
// Geocoding und Bildanalyse; fünfzehn davon gleichzeitig legen die Instanz
// lahm, während sie schon Anfragen beantwortet. Der Status steht dabei je Tour
// auf `processing` — wer währenddessen im Studio steht, sieht „wird
// verarbeitet" statt einer halben Tour.
import type { FastifyInstance } from 'fastify'
import { processTour, TOUR_JSON_PATH } from '../routes/tours.js'
import { TOUR_SCHEMA_ID } from '../pipeline/enrich.js'

/** Touren mit veralteter `tour.json` neu rendern. Gibt zurück, wie viele liefen. */
export async function rendereVeralteteNach(app: FastifyInstance): Promise<number> {
  const { db, storage } = app.deps
  const ids = db
    .prepare(`SELECT id FROM tours WHERE status = 'ready' ORDER BY created_at`)
    .all() as { id: string }[]
  let gerendert = 0
  for (const { id } of ids) {
    let kennung: unknown
    try {
      kennung = (
        JSON.parse((await storage.lese(id, TOUR_JSON_PATH)).toString()) as { schema?: unknown }
      ).schema
    } catch {
      // Keine oder kaputte tour.json — dann gibt es nichts nachzuziehen; das
      // Rendern besorgt der nächste Lauf der Pipeline.
      continue
    }
    if (kennung === TOUR_SCHEMA_ID) continue
    db.prepare(`UPDATE tours SET status = 'processing' WHERE id = ?`).run(id)
    await processTour(app, id, { frisch: false })
    gerendert += 1
    app.log.info(`Tour ${id} auf ${TOUR_SCHEMA_ID} nachgerendert`)
  }
  return gerendert
}
