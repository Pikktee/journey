// Datenmodell der Kontoeinstellungen — DOM-frei und ohne Netzwerk-Aufruf,
// damit die Regeln prüfbar bleiben: was auf einem Gerät steht, wie breit ein
// Balkenabschnitt ist, wann aus einem Zeitstempel „gerade eben" wird. Die Seite
// ist nur die Hülle darum (dieselbe Aufteilung wie profilmodell.ts).

/** Ein angemeldetes Gerät, wie es `GET /api/auth/me/geraete` ausliefert. */
export interface Geraet {
  id: string
  art: 'sitzung' | 'app'
  /** Roher User-Agent (Sitzung) bzw. das Label der App-Anmeldung. */
  kennung: string | null
  ipPraefix: string | null
  angemeldetAm: string
  zuletztGesehen: string | null
  /** Die Sitzung, aus der gefragt wurde — sie trägt keinen Abmelden-Knopf. */
  dieses?: boolean
}

export interface SpeicherAufteilung {
  fotos: number
  videos: number
  klaenge: number
  aufzeichnungen: number
  sonstiges: number
}

export interface SpeicherStand {
  benutzt: number
  limit: number
  frei: number
  aufteilung: SpeicherAufteilung
}

// ————— Geräte —————

/**
 * Der User-Agent, gedeutet: „Chrome auf macOS".
 *
 * Bewusst grob und bewusst hier statt im Server: Die Zeichenkette ist das
 * einzige, was der Browser über sich sagt, sie ändert sich mit jeder
 * Browser-Generation, und eine bessere Deutung darf keine Migration kosten.
 * Erkannt wird nur, was zum WIEDERERKENNEN nötig ist — die Frage lautet „war
 * das mein Rechner?", nicht „welche Version?".
 *
 * Die Reihenfolge der Prüfungen ist nicht beliebig: Jeder Chrome trägt „Safari"
 * im Namen, jeder Edge trägt „Chrome". Wer die Liste umsortiert, macht aus
 * allen Browsern Safari.
 */
export function browserAus(userAgent: string): string | null {
  const ua = userAgent
  if (/\bEdg[eA]?\//.test(ua)) return 'Edge'
  if (/\bOPR\/|\bOpera\b/.test(ua)) return 'Opera'
  if (/\bFirefox\//.test(ua)) return 'Firefox'
  if (/\bChrome\//.test(ua)) return 'Chrome'
  if (/\bSafari\//.test(ua)) return 'Safari'
  return null
}

/** Das System darunter — „macOS", „Android", „Windows". */
export function systemAus(userAgent: string): string | null {
  const ua = userAgent
  // iPad und iPhone zuerst: Beide tragen „Mac OS X" im User-Agent.
  if (/\biPhone\b/.test(ua)) return 'iPhone'
  if (/\biPad\b/.test(ua)) return 'iPad'
  if (/\bAndroid\b/.test(ua)) return 'Android'
  if (/\bWindows\b/.test(ua)) return 'Windows'
  if (/\bMac OS X\b|\bMacintosh\b/.test(ua)) return 'macOS'
  if (/\bCrOS\b/.test(ua)) return 'ChromeOS'
  if (/\bLinux\b/.test(ua)) return 'Linux'
  return null
}

/** Ist das ein Telefon oder Tablet? Entscheidet nur das Symbol in der Zeile. */
export function istHandgeraet(userAgent: string): boolean {
  return /\biPhone\b|\biPad\b|\bAndroid\b|\bMobile\b/.test(userAgent)
}

/**
 * Die Beschriftung eines Geräts.
 *
 * Ohne verwertbaren User-Agent bleibt es bei „Unbekanntes Gerät" — geraten wird
 * nicht: Eine falsche Zuordnung („Chrome auf macOS", wo es keiner war) wäre
 * schlimmer als das Eingeständnis, denn an dieser Zeile hängt die Entscheidung,
 * ob jemand ein fremdes Gerät abmeldet.
 */
export function geraeteName(geraet: Geraet): string {
  if (geraet.art === 'app') return `Maptale App${geraet.kennung ? ` · ${geraet.kennung}` : ''}`
  const ua = geraet.kennung ?? ''
  const browser = browserAus(ua)
  const system = systemAus(ua)
  if (browser && system) return `${browser} auf ${system}`
  return browser ?? system ?? 'Unbekanntes Gerät'
}

/** Rechner, Telefon oder App — nur das Zeichen links in der Zeile. */
export function geraeteSymbol(geraet: Geraet): 'app' | 'telefon' | 'rechner' {
  if (geraet.art === 'app') return 'app'
  return istHandgeraet(geraet.kennung ?? '') ? 'telefon' : 'rechner'
}

/**
 * Die Unterzeile: grober Ort und wann zuletzt.
 *
 * Was fehlt, steht nicht als Platzhalter da — ein „—" zwischen zwei Punkten
 * sieht nach kaputter Anzeige aus. Ohne jede Angabe bleibt die Zeile leer.
 */
export function geraeteUnterzeile(geraet: Geraet, jetzt: Date = new Date()): string {
  const teile: string[] = []
  if (geraet.ipPraefix) teile.push(geraet.ipPraefix)
  const zeitpunkt = geraet.zuletztGesehen ?? geraet.angemeldetAm
  const wann = relativeZeit(zeitpunkt, jetzt)
  if (wann) teile.push(`zuletzt ${wann}`)
  return teile.join(' · ')
}

/**
 * „gerade eben", „vor 2 Tagen", „am 12. Juli 2026".
 *
 * Relativ, solange es eine Erinnerung ist, und ab einer Woche ein Datum: „vor
 * 43 Tagen" muss man nachrechnen, „am 12. Juli" nicht. Zukünftige Zeitstempel
 * (Uhr des Servers gegen Uhr des Browsers) werden zu „gerade eben" statt zu
 * „in -3 Minuten".
 */
export function relativeZeit(iso: string | null | undefined, jetzt: Date = new Date()): string {
  if (!iso) return ''
  const datum = new Date(iso)
  if (Number.isNaN(datum.getTime())) return ''
  const minuten = Math.round((jetzt.getTime() - datum.getTime()) / 60_000)
  if (minuten < 5) return 'gerade eben'
  if (minuten < 60) return `vor ${minuten} Minuten`
  const stunden = Math.round(minuten / 60)
  if (stunden < 24) return stunden === 1 ? 'vor einer Stunde' : `vor ${stunden} Stunden`
  const tage = Math.round(stunden / 24)
  if (tage === 1) return 'gestern'
  if (tage < 7) return `vor ${tage} Tagen`
  return `am ${new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long', year: 'numeric' }).format(datum)}`
}

// ————— Speicher —————

/** Ein Abschnitt des Balkens und seine Zeile in der Legende. */
export interface SpeicherAbschnitt {
  art: keyof SpeicherAufteilung
  wort: string
  bytes: number
  /** Anteil am LIMIT, nicht am Belegten — der Balken zeigt den freien Rest mit. */
  prozent: number
}

const WORTE: Record<keyof SpeicherAufteilung, string> = {
  fotos: 'Fotos',
  videos: 'Videos',
  klaenge: 'Eigene Klänge',
  aufzeichnungen: 'Aufzeichnungen',
  sonstiges: 'Sonstiges',
}

/**
 * Die Abschnitte des Speicherbalkens.
 *
 * Leere Arten fallen heraus: „Videos 0 MB" unter einem Konto ohne Videos ist
 * eine Auskunft über nichts. Gemessen wird am LIMIT und nicht an der Summe —
 * ein Balken, der bei 12 % Belegung voll aussieht, ist eine Falschmeldung.
 */
export function speicherAbschnitte(stand: SpeicherStand): SpeicherAbschnitt[] {
  const limit = stand.limit > 0 ? stand.limit : 1
  return (Object.keys(WORTE) as Array<keyof SpeicherAufteilung>)
    .map((art) => ({
      art,
      wort: WORTE[art],
      bytes: stand.aufteilung?.[art] ?? 0,
      prozent: ((stand.aufteilung?.[art] ?? 0) / limit) * 100,
    }))
    .filter((a) => a.bytes > 0)
}

/** Belegt in Prozent — gedeckelt, damit ein übervolles Konto den Balken nicht sprengt. */
export function belegtProzent(stand: SpeicherStand): number {
  if (!(stand.limit > 0)) return 0
  return Math.min(100, (stand.benutzt / stand.limit) * 100)
}

/**
 * Ab wann gewarnt wird.
 *
 * 90 % ist der Punkt, an dem die nächste Aufnahme wirklich nicht mehr passt —
 * früher zu warnen hieße, jemanden zum Aufräumen zu drängen, der noch Platz
 * für zwei Touren hat.
 */
export function speicherKnapp(stand: SpeicherStand): boolean {
  return belegtProzent(stand) >= 90
}

/**
 * Bytes als Größe, wie sie neben einem Balken steht.
 *
 * MB bis 1 GB, darüber GB mit einer Nachkommastelle: „1 902 MB" liest sich
 * niemand als „fast zwei Gigabyte". Tausender mit schmalem geschütztem
 * Leerzeichen (U+202F) wie in `profilmodell.zahl` — ein Punkt vertritt in
 * „12.4 km" daneben das Komma.
 */
export function groesse(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  if (mb >= 1024) return `${(mb / 1024).toFixed(1).replace('.', ',')} GB`
  const gerundet = mb >= 10 || mb === 0 ? Math.round(mb) : Number(mb.toFixed(1))
  const text = Number.isInteger(gerundet) ? String(gerundet) : String(gerundet).replace('.', ',')
  return `${text.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} MB`
}

// ————— Datenexport —————

/** Der Auftrag, wie ihn `/auth/me` mitliefert. */
export interface ExportStand {
  id: string
  status: 'laeuft' | 'fertig' | 'fehler'
  angefordertAm: string
  fertigAm: string | null
  laeuftAbAm: string | null
  bytes: number | null
  dateien: number | null
}

/**
 * Was unter „Alle Daten exportieren" steht, solange es nichts zu berichten gibt.
 *
 * Steht hier und nicht im Markup, weil `exportZeile` ihn ERSETZT, sobald ein
 * Auftrag existiert: Zwei Zeilen untereinander („so geht's" und „so steht's")
 * sagten dasselbe zweimal, und die zweite war die einzige mit Neuigkeitswert.
 */
export const EXPORT_STANDARDZEILE = 'Alles als ZIP. Den Link bekommst du per Mail.'

/**
 * Der Satz unter „Alle Daten exportieren": was gerade Sache ist.
 *
 * Ohne Auftrag steht dort die Standardzeile. Ein fertiges Archiv nennt seine
 * Größe und die verbleibende Frist, denn beides entscheidet, ob man den Link
 * aus der Mail noch braucht oder neu anfordert.
 *
 * Ein abgelaufener Auftrag zählt als „nichts mehr da": Die Zeile behauptet
 * dann nicht, es liege noch ein Archiv bereit, das der Server längst gelöscht
 * hat.
 */
export function exportZeile(
  stand: ExportStand | null | undefined,
  jetzt: Date = new Date(),
): string {
  if (!stand) return EXPORT_STANDARDZEILE
  if (stand.status === 'laeuft')
    return 'Dein Archiv wird gerade gebaut. Die Mail kommt, sobald es fertig ist.'
  if (stand.status === 'fehler')
    return 'Der letzte Versuch ist fehlgeschlagen. Fordere das Archiv noch einmal an.'
  const ablauf = stand.laeuftAbAm ? new Date(stand.laeuftAbAm) : null
  if (!ablauf || ablauf <= jetzt) return 'Dein letztes Archiv ist abgelaufen und wurde gelöscht.'
  const stunden = Math.max(1, Math.round((ablauf.getTime() - jetzt.getTime()) / 3_600_000))
  const wieLange = stunden === 1 ? 'noch eine Stunde' : `noch ${stunden} Stunden`
  const wieGross = stand.bytes === null ? '' : ` (${groesse(stand.bytes)})`
  return `Dein Archiv${wieGross} liegt bereit, der Link aus der Mail gilt ${wieLange}.`
}
