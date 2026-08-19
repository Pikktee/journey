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

export type ProtokollStufe = 'warnung' | 'fehler'

export interface ProtokollEintrag {
  /** Fortlaufend, überlebt das Herausfallen aus dem Puffer — die Oberfläche
   *  erkennt daran neue Einträge, ohne Zeitstempel vergleichen zu müssen. */
  nr: number
  /** ISO-Zeitpunkt (UTC) */
  zeit: string
  stufe: ProtokollStufe
  text: string
  /** Zusatz, wenn die Meldung an einer Anfrage oder einem Fehlerobjekt hängt */
  detail?: string
}

/** So viele Meldungen bleiben stehen; ältere fallen hinten heraus. */
const PUFFER_GROESSE = 500
/** Kappungsgrenze je Meldung — ein Stacktrace-Text darf den Puffer nicht sprengen. */
const MAX_TEXT = 2000

export class Protokoll {
  private readonly eintraege: ProtokollEintrag[] = []
  private naechsteNr = 1

  constructor(private readonly groesse: number = PUFFER_GROESSE) {}

  schreibe(stufe: ProtokollStufe, text: string, detail?: string): void {
    this.eintraege.push({
      nr: this.naechsteNr++,
      zeit: new Date().toISOString(),
      stufe,
      text: text.slice(0, MAX_TEXT),
      ...(detail ? { detail: detail.slice(0, MAX_TEXT) } : {}),
    })
    // shift() statt slice(): der Puffer ist im Normalbetrieb genau einen Eintrag
    // zu lang, ein neues Array je Meldung wäre Verschwendung.
    while (this.eintraege.length > this.groesse) this.eintraege.shift()
  }

  /** Neueste zuerst — die Frage ist immer „was ist gerade passiert?". */
  liste(opt: { stufe?: ProtokollStufe; limit?: number } = {}): ProtokollEintrag[] {
    const gefiltert = opt.stufe
      ? this.eintraege.filter((e) => e.stufe === opt.stufe)
      : this.eintraege
    const umgekehrt = [...gefiltert].reverse()
    return opt.limit ? umgekehrt.slice(0, opt.limit) : umgekehrt
  }

  zaehle(): { gesamt: number; fehler: number } {
    return {
      gesamt: this.eintraege.length,
      fehler: this.eintraege.filter((e) => e.stufe === 'fehler').length,
    }
  }
}

/** pino-Level → unsere zwei Stufen; alles unter 40 (info/debug) fällt weg. */
function stufeAusLevel(level: unknown): ProtokollStufe | null {
  if (typeof level !== 'number') return null
  if (level >= 50) return 'fehler' // error + fatal
  if (level >= 40) return 'warnung'
  return null
}

interface PinoZeile {
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
export function protokollZiel(
  protokoll: Protokoll,
  weiter: (zeile: string) => void = (z) => process.stdout.write(z),
): { write(zeile: string): void } {
  return {
    write(zeile: string): void {
      weiter(zeile)
      let daten: PinoZeile
      try {
        daten = JSON.parse(zeile) as PinoZeile
      } catch {
        return
      }
      const stufe = stufeAusLevel(daten.level)
      if (!stufe) return
      const text = daten.msg ?? daten.err?.message ?? '(ohne Meldung)'
      // Was die Meldung einordnet: die Anfrage, an der sie hing, und der
      // Fehlertext, falls die Meldung selbst nur die Überschrift ist.
      const teile: string[] = []
      if (daten.req?.method && daten.req.url) teile.push(`${daten.req.method} ${daten.req.url}`)
      if (daten.res?.statusCode) teile.push(`HTTP ${daten.res.statusCode}`)
      if (daten.err?.message && daten.err.message !== text) teile.push(daten.err.message)
      protokoll.schreibe(stufe, text, teile.join(' · ') || undefined)
    },
  }
}
