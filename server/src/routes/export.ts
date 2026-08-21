/**
 * Datenexport: anfordern, bauen lassen, herunterladen.
 *
 * Drei Routen für einen Vorgang, der Minuten dauern kann — die Aufteilung ist
 * genau die Antwort darauf:
 *
 * - `POST /api/auth/me/export` legt den Auftrag an und **antwortet sofort**.
 *   Der Bau läuft danach, ohne dass jemand auf ihn wartet: Ein Archiv über
 *   zwei Gigabyte hielte sonst eine Verbindung minutenlang offen, und jeder
 *   Proxy dazwischen bräche sie vorher ab.
 * - Der Stand steht in `/api/auth/me` (die Antwort, auf die das Konto ohnehin
 *   wartet) — keine eigene Route, die die Seite pollen müsste.
 * - `GET /api/export/:token` liefert die Datei, **ohne Anmeldung**. Der Link
 *   kommt per Mail und wird oft auf einem anderen Gerät geöffnet; ein
 *   Anmeldezwang machte aus dem Weg zu den eigenen Daten eine Hürde. Das
 *   Postfach ist der Nachweis — dieselbe Linie wie beim Passwort-Reset, dessen
 *   Link sogar das ganze Konto öffnet.
 */
import type { FastifyInstance } from 'fastify'
import { requireUser } from '../app.js'
import { buildRateLimit } from '../rate-limit.js'
import { ARCHIVE_FILE, DataExportService, EXPIRY_HOURS } from '../data-export.js'
import { buildAndStore } from '../data-export-run.js'

/** „1,4 GB" — für die Mail, nicht für Maschinen. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Bytes`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  return `${value.toFixed(value < 10 ? 1 : 0).replace('.', ',')} ${units[i]}`
}

/** Die Adresse, unter der ein Archiv liegt — eine Stelle für Mail und Route. */
export const exportUrl = (baseUrl: string, token: string): string =>
  `${baseUrl.replace(/\/+$/, '')}/api/export/${token}`

export function registerDataExportRoutes(app: FastifyInstance): void {
  const { config, mail, db, storage } = app.deps

  // Ein Archiv kostet CPU und Platz. Die Bremse ist der Schutz gegen den
  // Fall, den der UNIQUE-Index NICHT abdeckt: schnell hintereinander
  // anfordern, während der vorige Lauf schon fertig ist.
  const exportLimited = buildRateLimit(5, 60 * 60_000) // 5 pro Stunde je Konto

  app.post('/api/auth/me/export', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) return
    if (exportLimited(user.id)) {
      return reply
        .code(429)
        .send({ error: 'Zu viele Anforderungen. Versuch es später noch einmal.' })
    }

    const { state2, fresh } = app.dataExport.request(user.id)
    // Läuft schon einer: Der Wunsch ist erfüllt, es passiert nichts weiter —
    // insbesondere geht keine zweite Mail raus. Die Antwort ist dieselbe,
    // damit die Oberfläche keinen Sonderfall zeichnen muss.
    if (!fresh) return { ok: true, dataExport: state2 }

    // Erst nach der Antwort. `void` ist Absicht: Niemand wartet, und ein
    // `await` machte aus der Route genau den blockierenden Aufruf, den diese
    // Aufteilung vermeidet.
    void buildAndSend(app, state2.id, user.id, user.email, user.name)
    return { ok: true, dataExport: state2 }
  })

  /**
   * Das Archiv. Kein `requireUser` — der Token IST der Nachweis.
   *
   * Drei Dinge stehen bewusst so: Der Token wird in konstanter Zeit geprüft
   * (`DataExportService.ausToken`), die Frist kommt aus der Zeile und nicht aus dem
   * Token, und die Antwort trägt `Cache-Control: private, no-store` — ein Proxy,
   * der das Archiv einer Person zwischenspeichert, wäre das Gegenteil des
   * Zwecks.
   */
  app.get<{ Params: { token: string } }>('/api/export/:token', async (request, reply) => {
    const id = DataExportService.byToken(request.params.token, config.cookieSecret)
    const state2 = id ? app.dataExport.downloadable(id) : null
    // Abgelaufen und gefälscht sind dieselbe Antwort: Ein eigener Text für
    // „abgelaufen" verriete, dass es diesen Auftrag gab.
    if (!id || !state2) {
      return reply.code(404).send({ error: 'Dieser Link ist abgelaufen oder ungültig.' })
    }
    const info = await app.deps.archive.info(id, ARCHIVE_FILE)
    if (!info) return reply.code(404).send({ error: 'Dieser Link ist abgelaufen oder ungültig.' })

    reply.header('content-type', 'application/zip')
    reply.header('content-length', String(info.size))
    reply.header('content-disposition', 'attachment; filename="maptale-export.zip"')
    reply.header('cache-control', 'private, no-store')
    return reply.send(app.deps.archive.readStream(id, ARCHIVE_FILE))
  })

  /**
   * Bauen, eintragen, Mail schicken — der Teil ohne Wartenden.
   *
   * Alles ist gefangen: Ein Fehler beim Bauen wird als solcher eingetragen
   * (sonst bliebe das Konto für immer im Zustand „läuft"), und ein Fehler beim
   * Versand darf den fertigen Auftrag nicht zurücknehmen — das Archiv liegt
   * dann bereit, nur die Mail fehlt, und beim nächsten Anfordern gibt es eine.
   */
  async function buildAndSend(
    app: FastifyInstance,
    jobId: string,
    userId: string,
    email: string,
    name: string,
  ): Promise<void> {
    try {
      const { bytes, files } = await buildAndStore(
        { db, storage, archive: app.deps.archive, maxBytes: config.maxStoragePerUser * 2 },
        jobId,
        userId,
        new Date().toISOString(),
      )
      app.dataExport.finish(jobId, bytes, files)
      app.log.info({ jobId, bytes, files }, 'Datenexport gebaut')

      // Der Versand steht in einem EIGENEN try: Ein Mail-Ausfall darf den
      // fertigen Auftrag nicht zurücknehmen. Das Archiv liegt dann bereit, nur
      // der Link fehlt — und beim nächsten Anfordern gibt es einen neuen.
      // Stünde es im äußeren Block, machte eine hakende Mail aus einem
      // gelungenen Export einen gescheiterten.
      try {
        const link = exportUrl(config.baseUrl, DataExportService.token(jobId, config.cookieSecret))
        const { subject, text, html } = app.mailTemplates.render(
          'export',
          { name, size: formatSize(bytes), deadline: `${EXPIRY_HOURS} Stunden` },
          { baseUrl: config.baseUrl, link },
        )
        await mail.send({ to2: email, subject, text, html })
      } catch (error) {
        app.log.error({ error, jobId }, 'Export-Mail konnte nicht versendet werden')
      }
    } catch (error) {
      app.log.error({ error, jobId }, 'Datenexport fehlgeschlagen')
      app.dataExport.reportError(jobId, error instanceof Error ? error.message : String(error))
    }
  }
}
