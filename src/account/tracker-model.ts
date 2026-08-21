// „Verbundene Dienste" — die rechnenden Teile, DOM-frei und unter Vitest prüfbar.
//
// Die Karte zeigt zwei Dinge, die man leicht verwechselt: den ZUSTAND einer
// Verknüpfung (verbunden, abgelaufen, gar nicht eingerichtet) und den VERLAUF
// der Importe (was kam an, was wurde übersprungen, was ging schief). Das erste
// beantwortet „warum kommt nichts?", das zweite „was ist eigentlich passiert?".

export type LinkStatus = 'active' | 'expired' | 'disconnected'
export type ImportStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped'

export interface ProviderState {
  id: string
  name: string
  /** Zugangsdaten hinterlegt UND Token-Schlüssel gesetzt — sonst geht Verbinden nicht. */
  available: boolean
  connected: boolean
  status: LinkStatus | null
  connectedAt: string | null
  lastSyncAt: string | null
  error: string | null
}

/** Die Tour hinter einem Import — nur, was in eine Zeile gehört. */
export interface TourBrief {
  title: string | null
  km: number | null
  placedMedia: number | null
  status: string
  visibility: string | null
}

export interface ImportEntry {
  id: string
  provider: string
  externalId: string
  status: ImportStatus
  tourId: string | null
  reportedAt: string
  finishedAt: string | null
  error: string | null
  /** Wie oft angelaufen (≥ 1). */
  attempts?: number
  /** Wartet die Aktivität noch auf einen neuen Anlauf? */
  retryable?: boolean
  /** Die angelegte Tour, wenn es eine gibt (und sie noch existiert). */
  tour?: TourBrief | null
}

/**
 * Der Satz unter dem Anbieternamen — die eine Zeile, die sagt, woran man ist.
 *
 * Vier Zustände, und jeder braucht eine andere Auskunft. Der teuerste Fehler
 * wäre, `abgelaufen` wie „nicht verbunden" aussehen zu lassen: Dann wartet
 * jemand auf Touren, die nie kommen, und sieht keinen Grund dafür.
 */
export function providerSentence(a: ProviderState): string {
  if (!a.available) return 'Auf diesem Server noch nicht eingerichtet.'
  if (a.status === 'expired') {
    return a.error
      ? `Der Zugang gilt nicht mehr: ${a.error} Bitte neu verbinden.`
      : 'Der Zugang gilt nicht mehr — bitte neu verbinden.'
  }
  if (!a.connected)
    return 'Neue Aufzeichnungen landen nach dem Verbinden von selbst in deiner Bibliothek.'
  const since = a.connectedAt ? ` seit ${formatShortDate(a.connectedAt)}` : ''
  return `Verbunden${since}. Neue Aufzeichnungen kommen von selbst an.`
}

/**
 * Die dritte Zeile eines verbundenen Dienstes: was zuletzt ankam.
 *
 * Sie ersetzt den früheren Abschnitt „Zuletzt geholt" unter der Karte. Der war
 * eine zweite Überschrift für eine Frage, die man beim Dienst selbst stellt —
 * und trotzdem zu knapp, um sie zu beantworten. Hier steht die eine Zeile, die
 * zählt („kam meine Fahrt an?"); alles Weitere liegt einen Klick entfernt im
 * Verlauf.
 *
 * `null`, solange nichts angekommen ist: Ein „noch nichts" unter einer frisch
 * verbundenen Uhr sagt nichts, was der Satz darüber nicht schon sagt.
 */
export function lastArrivalSentence(imports: readonly ImportEntry[]): string | null {
  const last = imports[0]
  if (!last) return null
  const when = formatDateTime(last.finishedAt ?? last.reportedAt)
  if (last.status === 'done') {
    const title = last.tour?.title?.trim()
    return title ? `Zuletzt: ${title} · ${when}` : `Zuletzt angekommen: ${when}`
  }
  if (last.status === 'skipped') return `Zuletzt übersprungen: ${when}`
  if (last.status === 'failed') return `Zuletzt nicht geklappt: ${when}`
  return `Läuft gerade: ${when}`
}

/** Beschriftung des Knopfs rechts — oder null, wenn es nichts zu tun gibt. */
export function providerButtonLabel(
  a: ProviderState,
): { text: string; tone: 'primary' | 'danger' } | null {
  if (!a.available) return null
  if (a.status === 'expired') return { text: 'Neu verbinden', tone: 'primary' }
  return a.connected ? { text: 'Trennen', tone: 'danger' } : { text: 'Verbinden', tone: 'primary' }
}

/**
 * Was ein Import-Eintrag sagt.
 *
 * `uebersprungen` ist bewusst KEIN Fehler und liest sich auch nicht so: Eine
 * Halleneinheit ohne GPS ist ein normales Ereignis, kein Problem. Stünde sie
 * rot in der Liste, wäre die Liste eines Vielsportlers dauerhaft alarmiert und
 * die eine echte Störung ginge darin unter.
 */
export function importSentence(i: ImportEntry): string {
  if (i.status === 'done') return i.tour ? tourSentence(i.tour) : 'Als Tour angelegt'
  const reason = i.error ? ` — ${soften(i.error)}` : ''
  if (i.status === 'skipped') return `Übersprungen${reason}${retryNote(i)}`
  if (i.status === 'failed') return `Nicht geklappt${reason}${retryNote(i)}`
  return 'Wird geholt …'
}

/**
 * Was aus der Aktivität geworden ist — die Zeile unter dem Titel.
 *
 * **Der frühere Satz war „Als Tour angelegt" und sonst nichts.** Wahr, und
 * trotzdem die einzige Statuszeile ohne Inhalt: Die Fehlerfälle nannten
 * wenigstens ihren Grund. Wer wissen wollte, WELCHE Fahrt da angekommen ist,
 * musste in die Bibliothek wechseln und über die Uhrzeit raten.
 *
 * Länge und Aufnahmen stehen dort, wo sie etwas unterscheiden — zwei Runden
 * desselben Tages trennt „4,2 km" sofort. Fehlt die Statistik (die Tour rendert
 * noch), bleibt der schlichte Satz: lieber nichts sagen als „0,0 km".
 */
export function tourSentence(t: TourBrief): string {
  if (t.status !== 'ready') return 'Angelegt, wird noch verarbeitet …'
  const parts: string[] = []
  if (t.km !== null && t.km > 0) parts.push(`${t.km.toFixed(1).replace('.', ',')} km`)
  if (t.placedMedia !== null && t.placedMedia > 0)
    parts.push(t.placedMedia === 1 ? '1 Aufnahme' : `${t.placedMedia} Aufnahmen`)
  return parts.length ? `Spielbereit · ${parts.join(' · ')}` : 'Spielbereit'
}

/**
 * Die Überschrift einer Chronik-Zeile — oder `null`.
 *
 * Es gibt sie nur, wo eine Tour daraus wurde: Dann ist ihr Titel das, wonach
 * man sucht. Sonst `null`, und die Zeile rückt ihren Satz nach oben. Der
 * naheliegende Rückfall — der Anbietername — stand über einem Dialog, der
 * bereits „Verlauf · Polar" heißt, und die Anbieter-Kennung der Aktivität
 * (`aQlC83`) benennt sie zwar eindeutig, aber für niemanden, der hier steht.
 */
export function importTitle(i: ImportEntry): string | null {
  return i.tour?.title?.trim() || null
}

/**
 * Ob es noch einen Anlauf gibt — die Auskunft, die über „muss ich etwas tun?"
 * entscheidet.
 *
 * Der Server unterscheidet das seit dem Wiederhol-Weg (`wiederholbar`): Ein
 * Netzaussetzer kommt wieder dran, eine Aufzeichnung ohne Strecke nie. Beides
 * gleich zu beschriften hieße, den einen warten zu lassen und den anderen
 * hoffen. Fehlt das Feld (ältere Antwort), bleibt es beim schlichten Satz —
 * lieber nichts sagen als das Falsche.
 */
function retryNote(i: ImportEntry): string {
  if (i.retryable === undefined) return ''
  if (i.retryable) return ', wird noch einmal versucht'
  return (i.attempts ?? 1) > 1 ? `, aufgegeben nach ${i.attempts} Versuchen` : ''
}

/** Ton der Zeile: nur echte Fehler werden als solche markiert. */
export function importTone(i: ImportEntry): 'ok' | 'warn' | 'failed' | 'running' {
  if (i.status === 'done') return 'ok'
  if (i.status === 'skipped') return 'warn'
  if (i.status === 'failed') return 'failed'
  return 'running'
}

/**
 * Server-Fehlertexte für die Oberfläche abrunden.
 *
 * Sie sind für Betreiber geschrieben („Polar antwortete 500 auf
 * /v3/exercises/…"). Hier steht jemand, der wissen will, ob er etwas tun muss —
 * und der Satz endet in einer Aufzählung, also klein und ohne Punkt.
 */
function soften(text: string): string {
  const short = text.trim().replace(/\.$/, '')
  if (/quota|speicher/i.test(short)) return 'dein Speicher ist voll'
  if (/ohne GPS|Route/i.test(short)) return 'die Aufzeichnung hat keine Strecke'
  if (/zu kurz/i.test(short)) return short.toLowerCase()
  if (/E-Mail/i.test(short)) return 'die E-Mail-Adresse ist noch nicht bestätigt'
  return short
}

/** „9. Aug." — in Aufzählungen genügt der Tag, die Uhrzeit wäre Beiwerk. */
export function formatShortDate(iso: string): string {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return ''
  return new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short' }).format(new Date(ms))
}

/** „9. Aug., 14:32" — für die Importliste, wo die Reihenfolge zählt. */
export function formatDateTime(iso: string): string {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return ''
  return new Intl.DateTimeFormat('de-DE', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ms))
}

/**
 * Die Rückmeldung nach der Rückkehr vom Anbieter (`/konto#tracker=…`).
 *
 * Ein Abbruch ist eine ENTSCHEIDUNG und keine Störung — er darf sich nicht wie
 * ein Fehler anhören, sonst sucht jemand nach einem Problem, das er selbst
 * ausgelöst hat.
 */
export function returnText(value: string): string | null {
  if (value === 'verbunden') return 'Verbunden. Neue Aufzeichnungen kommen ab jetzt von selbst an.'
  if (value === 'abgebrochen') return 'Abgebrochen — es wurde nichts verknüpft.'
  if (value === 'abgelaufen')
    return 'Der Verbindungsversuch ist abgelaufen. Bitte noch einmal versuchen.'
  if (value === 'fehler') return 'Das Verbinden hat nicht geklappt. Bitte noch einmal versuchen.'
  return null
}
