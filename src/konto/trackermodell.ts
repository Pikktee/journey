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
  verfuegbar: boolean
  verbunden: boolean
  status: VerknuepfungsStatus | null
  verbundenSeit: string | null
  zuletztSync: string | null
  fehler: string | null
}

export interface ImportStand {
  id: string
  anbieter: string
  externeId: string
  status: ImportStatus
  tourId: string | null
  gemeldetAm: string
  fertigAm: string | null
  fehler: string | null
}

/**
 * Der Satz unter dem Anbieternamen — die eine Zeile, die sagt, woran man ist.
 *
 * Vier Zustände, und jeder braucht eine andere Auskunft. Der teuerste Fehler
 * wäre, `abgelaufen` wie „nicht verbunden" aussehen zu lassen: Dann wartet
 * jemand auf Touren, die nie kommen, und sieht keinen Grund dafür.
 */
export function anbieterSatz(a: AnbieterStand): string {
  if (!a.verfuegbar) return 'Auf diesem Server noch nicht eingerichtet.'
  if (a.status === 'abgelaufen') {
    return a.fehler
      ? `Der Zugang gilt nicht mehr: ${a.fehler} Bitte neu verbinden.`
      : 'Der Zugang gilt nicht mehr — bitte neu verbinden.'
  }
  if (!a.verbunden) return 'Neue Aufzeichnungen landen nach dem Verbinden von selbst in deiner Bibliothek.'
  const seit = a.verbundenSeit ? ` seit ${kurzesDatum(a.verbundenSeit)}` : ''
  return `Verbunden${seit}. Neue Aufzeichnungen kommen von selbst an.`
}

/** Beschriftung des Knopfs rechts — oder null, wenn es nichts zu tun gibt. */
export function anbieterKnopf(a: AnbieterStand): { text: string; art: 'primaer' | 'gefahr' } | null {
  if (!a.verfuegbar) return null
  if (a.status === 'abgelaufen') return { text: 'Neu verbinden', art: 'primaer' }
  return a.verbunden ? { text: 'Trennen', art: 'gefahr' } : { text: 'Verbinden', art: 'primaer' }
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
  if (i.status === 'fertig') return 'Als Tour angelegt'
  if (i.status === 'uebersprungen') return i.fehler ? `Übersprungen — ${entschaerfe(i.fehler)}` : 'Übersprungen'
  if (i.status === 'fehler') return i.fehler ? `Nicht geklappt — ${entschaerfe(i.fehler)}` : 'Nicht geklappt'
  return 'Wird geholt …'
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
  if (wert === 'abgelaufen') return 'Der Verbindungsversuch ist abgelaufen. Bitte noch einmal versuchen.'
  if (wert === 'fehler') return 'Das Verbinden hat nicht geklappt. Bitte noch einmal versuchen.'
  return null
}
