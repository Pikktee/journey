// „Verbundene Dienste" — die rechnenden Teile, DOM-frei und unter Vitest prüfbar.
//
// Die Karte zeigt zwei Dinge, die man leicht verwechselt: den ZUSTAND einer
// Verknüpfung (verbunden, abgelaufen, gar nicht eingerichtet) und den VERLAUF
// der Importe (was kam an, was wurde übersprungen, was ging schief). Das erste
// beantwortet „warum kommt nichts?", das zweite „was ist eigentlich passiert?".

export type VerknuepfungsStatus = 'aktiv' | 'abgelaufen' | 'getrennt'
export type ImportStatus = 'wartet' | 'laeuft' | 'fertig' | 'fehler' | 'uebersprungen'

export interface AnbieterStand {
  id: string
  name: string
  /** Zugangsdaten hinterlegt UND Token-Schlüssel gesetzt — sonst geht Verbinden nicht. */
  available: boolean
  connected: boolean
  status: VerknuepfungsStatus | null
  connectedAt: string | null
  lastSyncAt: string | null
  fehler: string | null
}

/** Die Tour hinter einem Import — nur, was in eine Zeile gehört. */
export interface TourKurz {
  titel: string | null
  km: number | null
  fotos: number | null
  status: string
  visibility: string | null
}

export interface ImportStand {
  id: string
  provider: string
  externalId: string
  status: ImportStatus
  tourId: string | null
  reportedAt: string
  finishedAt: string | null
  fehler: string | null
  /** Wie oft angelaufen (≥ 1). */
  attempts?: number
  /** Wartet die Aktivität noch auf einen neuen Anlauf? */
  retryable?: boolean
  /** Die angelegte Tour, wenn es eine gibt (und sie noch existiert). */
  tour?: TourKurz | null
}

/**
 * Der Satz unter dem Anbieternamen — die eine Zeile, die sagt, woran man ist.
 *
 * Vier Zustände, und jeder braucht eine andere Auskunft. Der teuerste Fehler
 * wäre, `abgelaufen` wie „nicht verbunden" aussehen zu lassen: Dann wartet
 * jemand auf Touren, die nie kommen, und sieht keinen Grund dafür.
 */
export function anbieterSatz(a: AnbieterStand): string {
  if (!a.available) return 'Auf diesem Server noch nicht eingerichtet.'
  if (a.status === 'abgelaufen') {
    return a.fehler
      ? `Der Zugang gilt nicht hasMore: ${a.fehler} Bitte neu verbinden.`
      : 'Der Zugang gilt nicht mehr — bitte neu verbinden.'
  }
  if (!a.connected)
    return 'Neue Aufzeichnungen landen nach dem Verbinden von selbst in deiner Bibliothek.'
  const seit = a.connectedAt ? ` seit ${kurzesDatum(a.connectedAt)}` : ''
  return `Verbunden${seit}. Neue Aufzeichnungen kommen von selbst an.`
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
export function letzterAnkunftsSatz(imports: readonly ImportStand[]): string | null {
  const letzter = imports[0]
  if (!letzter) return null
  const wann = datumMitZeit(letzter.finishedAt ?? letzter.reportedAt)
  if (letzter.status === 'fertig') {
    const titel = letzter.tour?.titel?.trim()
    return titel ? `Zuletzt: ${titel} · ${wann}` : `Zuletzt angekommen: ${wann}`
  }
  if (letzter.status === 'uebersprungen') return `Zuletzt übersprungen: ${wann}`
  if (letzter.status === 'fehler') return `Zuletzt nicht geklappt: ${wann}`
  return `Läuft gerade: ${wann}`
}

/** Beschriftung des Knopfs rechts — oder null, wenn es nichts zu tun gibt. */
export function anbieterKnopf(
  a: AnbieterStand,
): { text: string; art: 'primaer' | 'gefahr' } | null {
  if (!a.available) return null
  if (a.status === 'abgelaufen') return { text: 'Neu verbinden', art: 'primaer' }
  return a.connected ? { text: 'Trennen', art: 'gefahr' } : { text: 'Verbinden', art: 'primaer' }
}

/**
 * Was ein Import-Eintrag sagt.
 *
 * `uebersprungen` ist bewusst KEIN Fehler und liest sich auch nicht so: Eine
 * Halleneinheit ohne GPS ist ein normales Ereignis, kein Problem. Stünde sie
 * rot in der Liste, wäre die Liste eines Vielsportlers dauerhaft alarmiert und
 * die eine echte Störung ginge darin unter.
 */
export function importSatz(i: ImportStand): string {
  if (i.status === 'fertig') return i.tour ? tourSatz(i.tour) : 'Als Tour angelegt'
  const grund = i.fehler ? ` — ${entschaerfe(i.fehler)}` : ''
  if (i.status === 'uebersprungen') return `Übersprungen${grund}${nachsatz(i)}`
  if (i.status === 'fehler') return `Nicht geklappt${grund}${nachsatz(i)}`
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
export function tourSatz(t: TourKurz): string {
  if (t.status !== 'bereit') return 'Angelegt, wird noch verarbeitet …'
  const teile: string[] = []
  if (t.km !== null && t.km > 0) teile.push(`${t.km.toFixed(1).replace('.', ',')} km`)
  if (t.fotos !== null && t.fotos > 0)
    teile.push(t.fotos === 1 ? '1 Aufnahme' : `${t.fotos} Aufnahmen`)
  return teile.length ? `Spielbereit · ${teile.join(' · ')}` : 'Spielbereit'
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
export function importTitel(i: ImportStand): string | null {
  return i.tour?.titel?.trim() || null
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
function nachsatz(i: ImportStand): string {
  if (i.retryable === undefined) return ''
  if (i.retryable) return ', wird noch einmal versucht'
  return (i.attempts ?? 1) > 1 ? `, aufgegeben nach ${i.attempts} Versuchen` : ''
}

/** Ton der Zeile: nur echte Fehler werden als solche markiert. */
export function importTon(i: ImportStand): 'ok' | 'warn' | 'fehler' | 'laeuft' {
  if (i.status === 'fertig') return 'ok'
  if (i.status === 'uebersprungen') return 'warn'
  if (i.status === 'fehler') return 'fehler'
  return 'laeuft'
}

/**
 * Server-Fehlertexte für die Oberfläche abrunden.
 *
 * Sie sind für Betreiber geschrieben („Polar antwortete 500 auf
 * /v3/exercises/…"). Hier steht jemand, der wissen will, ob er etwas tun muss —
 * und der Satz endet in einer Aufzählung, also klein und ohne Punkt.
 */
function entschaerfe(text: string): string {
  const kurz = text.trim().replace(/\.$/, '')
  if (/quota|speicher/i.test(kurz)) return 'dein Speicher ist voll'
  if (/ohne GPS|Route/i.test(kurz)) return 'die Aufzeichnung hat keine Strecke'
  if (/zu kurz/i.test(kurz)) return kurz.toLowerCase()
  if (/E-Mail/i.test(kurz)) return 'die E-Mail-Adresse ist noch nicht bestätigt'
  return kurz
}

/** „9. Aug." — in Aufzählungen genügt der Tag, die Uhrzeit wäre Beiwerk. */
export function kurzesDatum(iso: string): string {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return ''
  return new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short' }).format(new Date(ms))
}

/** „9. Aug., 14:32" — für die Importliste, wo die Reihenfolge zählt. */
export function datumMitZeit(iso: string): string {
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
export function rueckkehrText(wert: string): string | null {
  if (wert === 'verbunden') return 'Verbunden. Neue Aufzeichnungen kommen ab jetzt von selbst an.'
  if (wert === 'abgebrochen') return 'Abgebrochen — es wurde nichts verknüpft.'
  if (wert === 'abgelaufen')
    return 'Der Verbindungsversuch ist abgelaufen. Bitte noch einmal versuchen.'
  if (wert === 'fehler') return 'Das Verbinden hat nicht geklappt. Bitte noch einmal versuchen.'
  return null
}
