// Betriebsprotokoll: die letzten Warnungen und Fehler, im Arbeitsspeicher.
//
// Warum überhaupt: Die API loggt nach stdout, und stdout gehört im Betrieb dem
// Docker-Daemon. Aus dem Container heraus ist das eigene Log nicht lesbar, und
// beim nächsten Deploy ist es ohnehin fort. Genau die Meldungen, die etwas
// erklären („Bildanalyse: HTTP 402", „Anreicherung fehlgeschlagen", „Mail-Versand
// abgelehnt"), sah deshalb nur, wer zufällig gerade per SSH danebenstand.
//
// Bewusst KEINE Datenbank-Tabelle: Ein Protokoll wächst, will Fristen, Indizes
// und eine Aufräumerei — und die Frage, die es beantworten soll, ist fast immer
// „was ist gerade eben schiefgegangen?". Dafür genügen die letzten paar hundert
// Meldungen. Der Preis steht offen im Reiter: Nach einem Neustart ist er leer.
//
// Gespeichert wird ab `warn`. Alles darunter ist Verkehr (jede Anfrage zweimal),
// das wäre nach zwei Minuten Betrieb der einzige Inhalt.

export type AuditLogLevel = 'warning' | 'failed'

export interface AuditLogEntry {
  /** Fortlaufend, überlebt das Herausfallen aus dem Puffer — die Oberfläche
   *  erkennt daran neue Einträge, ohne Zeitstempel vergleichen zu müssen. */
  no: number
  /** ISO-Zeitpunkt (UTC) */
  at: string
  level: AuditLogLevel
  text: string
  /** Zusatz, wenn die Meldung an einer Anfrage oder einem Fehlerobjekt hängt */
  detail?: string
}

/** So viele Meldungen bleiben stehen; ältere fallen hinten heraus. */
const BUFFER_SIZE = 500
/** Kappungsgrenze je Meldung — ein Stacktrace-Text darf den Puffer nicht sprengen. */
const MAX_TEXT = 2000

export class AuditLog {
  private readonly entries: AuditLogEntry[] = []
  private nextNo = 1

  constructor(private readonly size: number = BUFFER_SIZE) {}

  write(severity: AuditLogLevel, text: string, detail?: string): void {
    this.entries.push({
      no: this.nextNo++,
      at: new Date().toISOString(),
      level: severity,
      text: text.slice(0, MAX_TEXT),
      ...(detail ? { detail: detail.slice(0, MAX_TEXT) } : {}),
    })
    // shift() statt slice(): der Puffer ist im Normalbetrieb genau einen Eintrag
    // zu lang, ein neues Array je Meldung wäre Verschwendung.
    while (this.entries.length > this.size) this.entries.shift()
  }

  /** Neueste zuerst — die Frage ist immer „was ist gerade passiert?". */
  list(opt: { severity?: AuditLogLevel; limit?: number } = {}): AuditLogEntry[] {
    const filtered = opt.severity
      ? this.entries.filter((e) => e.level === opt.severity)
      : this.entries
    const reversed = [...filtered].reverse()
    return opt.limit ? reversed.slice(0, opt.limit) : reversed
  }

  count(): { total: number; errorCount: number } {
    return {
      total: this.entries.length,
      errorCount: this.entries.filter((e) => e.level === 'failed').length,
    }
  }
}

/** pino-Level → unsere zwei Stufen; alles unter 40 (info/debug) fällt weg. */
function severityFromLevel(level: unknown): AuditLogLevel | null {
  if (typeof level !== 'number') return null
  if (level >= 50) return 'failed' // error + fatal
  if (level >= 40) return 'warning'
  return null
}

interface PinoRow {
  level?: number
  msg?: string
  err?: { message?: string; type?: string }
  reqId?: string
  req?: { method?: string; url?: string }
  res?: { statusCode?: number }
}

/**
 * pino-Ziel, das die Zeile WEITERREICHT und nebenbei mitschreibt.
 *
 * Der Durchgriff auf stdout ist kein Detail, sondern der Zweck: Das Docker-Log
 * bleibt vollständig (dort steht auch alles unterhalb von `warn`), der Puffer
 * ist nur die Kurzfassung fürs Admin-Fenster. Wer hier den Durchgriff wegnimmt,
 * macht die Ansicht zur einzigen Quelle — und die überlebt keinen Neustart.
 *
 * Kaputte oder fremde Zeilen (etwas anderes als pino-JSON) gehen unverändert
 * durch und landen nicht im Puffer: Ein Logger darf an einem Log nicht scheitern.
 */
export function auditLogTarget(
  log: AuditLog,
  more: (row: string) => void = (z) => process.stdout.write(z),
): { write(row: string): void } {
  return {
    write(row: string): void {
      more(row)
      let payload: PinoRow
      try {
        payload = JSON.parse(row) as PinoRow
      } catch {
        return
      }
      const severity = severityFromLevel(payload.level)
      if (!severity) return
      const text = payload.msg ?? payload.err?.message ?? '(ohne Meldung)'
      // Was die Meldung einordnet: die Anfrage, an der sie hing, und der
      // Fehlertext, falls die Meldung selbst nur die Überschrift ist.
      const parts: string[] = []
      if (payload.req?.method && payload.req.url)
        parts.push(`${payload.req.method} ${payload.req.url}`)
      if (payload.res?.statusCode) parts.push(`HTTP ${payload.res.statusCode}`)
      if (payload.err?.message && payload.err.message !== text) parts.push(payload.err.message)
      log.write(severity, text, parts.join(' · ') || undefined)
    },
  }
}
