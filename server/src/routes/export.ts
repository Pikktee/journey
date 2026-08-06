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
import { erfordereBenutzer } from '../app.js'
import { baueBremse } from '../bremse.js'
import { ARCHIV_DATEI, ExportDienst, FRIST_STUNDEN } from '../export.js'
import { baueUndLege } from '../exportlauf.js'

/** „1,4 GB" — für die Mail, nicht für Maschinen. */
export function alsGroesse(bytes: number): string {
  if (bytes < 1024) return `${bytes} Bytes`
  const einheiten = ['KB', 'MB', 'GB', 'TB']
  let wert = bytes / 1024
  let i = 0
  while (wert >= 1024 && i < einheiten.length - 1) {
    wert /= 1024
    i++
  }
  return `${wert.toFixed(wert < 10 ? 1 : 0).replace('.', ',')} ${einheiten[i]}`
}

/** Die Adresse, unter der ein Archiv liegt — eine Stelle für Mail und Route. */
export const exportUrl = (basisUrl: string, token: string): string =>
  `${basisUrl.replace(/\/+$/, '')}/api/export/${token}`

export function registriereExportRouten(app: FastifyInstance): void {
  const { konfig, mail, db, storage } = app.deps

  // Ein Archiv kostet CPU und Platz. Die Bremse ist der Schutz gegen den
  // Fall, den der UNIQUE-Index NICHT abdeckt: schnell hintereinander
  // anfordern, während der vorige Lauf schon fertig ist.
  const exportGebremst = baueBremse(5, 60 * 60_000) // 5 pro Stunde je Konto

  app.post('/api/auth/me/export', async (request, reply) => {
    const benutzer = erfordereBenutzer(request, reply)
    if (!benutzer) return
    if (exportGebremst(benutzer.id)) {
      return reply.code(429).send({ fehler: 'Zu viele Anforderungen. Versuch es später noch einmal.' })
    }

    const { stand, neu } = app.exporte.fordereAn(benutzer.id)
    // Läuft schon einer: Der Wunsch ist erfüllt, es passiert nichts weiter —
    // insbesondere geht keine zweite Mail raus. Die Antwort ist dieselbe,
    // damit die Oberfläche keinen Sonderfall zeichnen muss.
    if (!neu) return { ok: true, export: stand }

    // Erst nach der Antwort. `void` ist Absicht: Niemand wartet, und ein
    // `await` machte aus der Route genau den blockierenden Aufruf, den diese
    // Aufteilung vermeidet.
    void baueUndSchicke(app, stand.id, benutzer.id, benutzer.email, benutzer.name)
    return { ok: true, export: stand }
  })

  /**
   * Das Archiv. Kein `erfordereBenutzer` — der Token IST der Nachweis.
   *
   * Drei Dinge stehen bewusst so: Der Token wird in konstanter Zeit geprüft
   * (`ExportDienst.ausToken`), die Frist kommt aus der Zeile und nicht aus dem
   * Token, und die Antwort trägt `Cache-Control: private, no-store` — ein Proxy,
   * der das Archiv einer Person zwischenspeichert, wäre das Gegenteil des
   * Zwecks.
   */
  app.get<{ Params: { token: string } }>('/api/export/:token', async (request, reply) => {
    const id = ExportDienst.ausToken(request.params.token, konfig.cookieSecret)
    const stand = id ? app.exporte.abrufbar(id) : null
    // Abgelaufen und gefälscht sind dieselbe Antwort: Ein eigener Text für
    // „abgelaufen" verriete, dass es diesen Auftrag gab.
    if (!id || !stand) {
      return reply.code(404).send({ fehler: 'Dieser Link ist abgelaufen oder ungültig.' })
    }
    const info = await app.deps.archive.info(id, ARCHIV_DATEI)
    if (!info) return reply.code(404).send({ fehler: 'Dieser Link ist abgelaufen oder ungültig.' })

    reply.header('content-type', 'application/zip')
    reply.header('content-length', String(info.groesse))
    reply.header('content-disposition', 'attachment; filename="maptale-export.zip"')
    reply.header('cache-control', 'private, no-store')
    return reply.send(app.deps.archive.leseStream(id, ARCHIV_DATEI))
  })

  /**
   * Bauen, eintragen, Mail schicken — der Teil ohne Wartenden.
   *
   * Alles ist gefangen: Ein Fehler beim Bauen wird als solcher eingetragen
   * (sonst bliebe das Konto für immer im Zustand „läuft"), und ein Fehler beim
   * Versand darf den fertigen Auftrag nicht zurücknehmen — das Archiv liegt
   * dann bereit, nur die Mail fehlt, und beim nächsten Anfordern gibt es eine.
   */
  async function baueUndSchicke(
    app: FastifyInstance,
    auftragId: string,
    benutzerId: string,
    email: string,
    name: string,
  ): Promise<void> {
    try {
      const { bytes, dateien } = await baueUndLege(
        { db, storage, archive: app.deps.archive, maxBytes: konfig.maxSpeicherProBenutzer * 2 },
        auftragId,
        benutzerId,
        new Date().toISOString(),
      )
      app.exporte.melde(auftragId, bytes, dateien)
      app.log.info({ auftragId, bytes, dateien }, 'Datenexport gebaut')

      // Der Versand steht in einem EIGENEN try: Ein Mail-Ausfall darf den
      // fertigen Auftrag nicht zurücknehmen. Das Archiv liegt dann bereit, nur
      // der Link fehlt — und beim nächsten Anfordern gibt es einen neuen.
      // Stünde es im äußeren Block, machte eine hakende Mail aus einem
      // gelungenen Export einen gescheiterten.
      try {
        const link = exportUrl(konfig.basisUrl, ExportDienst.token(auftragId, konfig.cookieSecret))
        const { betreff, text, html } = app.mailvorlagen.rendere(
          'export',
          { name, groesse: alsGroesse(bytes), frist: `${FRIST_STUNDEN} Stunden` },
          { basisUrl: konfig.basisUrl, link },
        )
        await mail.sende({ an: email, betreff, text, html })
      } catch (fehler) {
        app.log.error({ fehler, auftragId }, 'Export-Mail konnte nicht versendet werden')
      }
    } catch (fehler) {
      app.log.error({ fehler, auftragId }, 'Datenexport fehlgeschlagen')
      app.exporte.meldeFehler(auftragId, fehler instanceof Error ? fehler.message : String(fehler))
    }
  }
}
