// Datenmodell der Kontoeinstellungen — DOM-frei und ohne Netzwerk-Aufruf,
// damit die Regeln prüfbar bleiben: was auf einem Gerät steht, wie breit ein
// Balkenabschnitt ist, wann aus einem Zeitstempel „gerade eben" wird. Die Seite
// ist nur die Hülle darum (dieselbe Aufteilung wie profile-model.ts).

/** Ein angemeldetes Gerät, wie es `GET /api/auth/me/devices` ausliefert. */
export interface Device {
  id: string
  kind: 'session' | 'app'
  /** Roher User-Agent (Sitzung) bzw. das Label der App-Anmeldung. */
  label: string | null
  ipPrefix: string | null
  signedInAt: string
  lastSeenAt: string | null
  /** Die Sitzung, aus der gefragt wurde — sie trägt keinen Abmelden-Knopf. */
  current?: boolean
}

export interface StorageBreakdown {
  photos: number
  videos: number
  audio: number
  recordings: number
  other: number
}

export interface StorageStatus {
  used: number
  limit: number
  free: number
  breakdown: StorageBreakdown
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
export function parseBrowser(userAgent: string): string | null {
  const ua = userAgent
  if (/\bEdg[eA]?\//.test(ua)) return 'Edge'
  if (/\bOPR\/|\bOpera\b/.test(ua)) return 'Opera'
  if (/\bFirefox\//.test(ua)) return 'Firefox'
  if (/\bChrome\//.test(ua)) return 'Chrome'
  if (/\bSafari\//.test(ua)) return 'Safari'
  return null
}

/** Das System darunter — „macOS", „Android", „Windows". */
export function parseOs(userAgent: string): string | null {
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
export function isMobile(userAgent: string): boolean {
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
export function deviceName(device: Device): string {
  if (device.kind === 'app') return `Maptale App${device.label ? ` · ${device.label}` : ''}`
  const ua = device.label ?? ''
  const browser = parseBrowser(ua)
  const os = parseOs(ua)
  if (browser && os) return `${browser} auf ${os}`
  return browser ?? os ?? 'Unbekanntes Gerät'
}

/** Rechner, Telefon oder App — nur das Zeichen links in der Zeile. */
export function deviceIcon(device: Device): 'app' | 'phone' | 'desktop' {
  if (device.kind === 'app') return 'app'
  return isMobile(device.label ?? '') ? 'phone' : 'desktop'
}

/**
 * Die Unterzeile: grober Ort und wann zuletzt.
 *
 * Was fehlt, steht nicht als Platzhalter da — ein „—" zwischen zwei Punkten
 * sieht nach kaputter Anzeige aus. Ohne jede Angabe bleibt die Zeile leer.
 */
export function deviceSubline(device: Device, now: Date = new Date()): string {
  const parts: string[] = []
  if (device.ipPrefix) parts.push(device.ipPrefix)
  const moment = device.lastSeenAt ?? device.signedInAt
  const when = relativeTime(moment, now)
  if (when) parts.push(`zuletzt ${when}`)
  return parts.join(' · ')
}

/**
 * „gerade eben", „vor 2 Tagen", „am 12. Juli 2026".
 *
 * Relativ, solange es eine Erinnerung ist, und ab einer Woche ein Datum: „vor
 * 43 Tagen" muss man nachrechnen, „am 12. Juli" nicht. Zukünftige Zeitstempel
 * (Uhr des Servers gegen Uhr des Browsers) werden zu „gerade eben" statt zu
 * „in -3 Minuten".
 */
export function relativeTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const minutes = Math.round((now.getTime() - date.getTime()) / 60_000)
  if (minutes < 5) return 'gerade eben'
  if (minutes < 60) return `vor ${minutes} Minuten`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return hours === 1 ? 'vor einer Stunde' : `vor ${hours} Stunden`
  const days = Math.round(hours / 24)
  if (days === 1) return 'gestern'
  if (days < 7) return `vor ${days} Tagen`
  return `am ${new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long', year: 'numeric' }).format(date)}`
}

// ————— Speicher —————

/** Ein Abschnitt des Balkens und seine Zeile in der Legende. */
export interface StorageBarSegment {
  kind: keyof StorageBreakdown
  label: string
  bytes: number
  /** Anteil am LIMIT, nicht am Belegten — der Balken zeigt den freien Rest mit. */
  percent: number
}

const SEGMENT_LABELS: Record<keyof StorageBreakdown, string> = {
  photos: 'Fotos',
  videos: 'Videos',
  audio: 'Eigene Klänge',
  recordings: 'Aufzeichnungen',
  other: 'Sonstiges',
}

/**
 * Die Abschnitte des Speicherbalkens.
 *
 * Leere Arten fallen heraus: „Videos 0 MB" unter einem Konto ohne Videos ist
 * eine Auskunft über nichts. Gemessen wird am LIMIT und nicht an der Summe —
 * ein Balken, der bei 12 % Belegung voll aussieht, ist eine Falschmeldung.
 */
export function storageBarSegments(status: StorageStatus): StorageBarSegment[] {
  const limit = status.limit > 0 ? status.limit : 1
  return (Object.keys(SEGMENT_LABELS) as Array<keyof StorageBreakdown>)
    .map((kind) => ({
      kind,
      label: SEGMENT_LABELS[kind],
      bytes: status.breakdown?.[kind] ?? 0,
      percent: ((status.breakdown?.[kind] ?? 0) / limit) * 100,
    }))
    .filter((a) => a.bytes > 0)
}

/** Belegt in Prozent — gedeckelt, damit ein übervolles Konto den Balken nicht sprengt. */
export function usedPercent(status: StorageStatus): number {
  if (!(status.limit > 0)) return 0
  return Math.min(100, (status.used / status.limit) * 100)
}

/**
 * Ab wann gewarnt wird.
 *
 * 90 % ist der Punkt, an dem die nächste Aufnahme wirklich nicht mehr passt —
 * früher zu warnen hieße, jemanden zum Aufräumen zu drängen, der noch Platz
 * für zwei Touren hat.
 */
export function storageLow(status: StorageStatus): boolean {
  return usedPercent(status) >= 90
}

/**
 * Bytes als Größe, wie sie neben einem Balken steht.
 *
 * MB bis 1 GB, darüber GB mit einer Nachkommastelle: „1 902 MB" liest sich
 * niemand als „fast zwei Gigabyte". Tausender mit schmalem geschütztem
 * Leerzeichen (U+202F) wie in `profilmodell.zahl` — ein Punkt vertritt in
 * „12.4 km" daneben das Komma.
 */
export function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  if (mb >= 1024) return `${(mb / 1024).toFixed(1).replace('.', ',')} GB`
  const rounded = mb >= 10 || mb === 0 ? Math.round(mb) : Number(mb.toFixed(1))
  const text = Number.isInteger(rounded) ? String(rounded) : String(rounded).replace('.', ',')
  return `${text.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} MB`
}

// ————— Datenexport —————

/** Der Auftrag, wie ihn `/auth/me` mitliefert. */
export interface DataExportStatus {
  id: string
  status: 'running' | 'done' | 'failed'
  requestedAt: string
  finishedAt: string | null
  expiresAt: string | null
  bytes: number | null
  files: number | null
}

/**
 * Was unter „Alle Daten exportieren" steht, solange es nichts zu berichten gibt.
 *
 * Steht hier und nicht im Markup, weil `dataExportLine` ihn ERSETZT, sobald ein
 * Auftrag existiert: Zwei Zeilen untereinander („so geht's" und „so steht's")
 * sagten dasselbe zweimal, und die zweite war die einzige mit Neuigkeitswert.
 */
export const DATA_EXPORT_DEFAULT_LINE = 'Alles als ZIP. Den Link bekommst du per Mail.'

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
export function dataExportLine(
  status: DataExportStatus | null | undefined,
  now: Date = new Date(),
): string {
  if (!status) return DATA_EXPORT_DEFAULT_LINE
  if (status.status === 'running')
    return 'Dein Archiv wird gerade gebaut. Die Mail kommt, sobald es fertig ist.'
  if (status.status === 'failed')
    return 'Der letzte Versuch ist fehlgeschlagen. Fordere das Archiv noch einmal an.'
  const expires = status.expiresAt ? new Date(status.expiresAt) : null
  if (!expires || expires <= now) return 'Dein letztes Archiv ist abgelaufen und wurde gelöscht.'
  const hours = Math.max(1, Math.round((expires.getTime() - now.getTime()) / 3_600_000))
  const howLong = hours === 1 ? 'noch eine Stunde' : `noch ${hours} Stunden`
  const howBig = status.bytes === null ? '' : ` (${formatBytes(status.bytes)})`
  return `Dein Archiv${howBig} liegt bereit, der Link aus der Mail gilt ${howLong}.`
}
