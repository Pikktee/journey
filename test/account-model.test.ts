// Datenmodell der Kontoeinstellungen (DOM-frei, wie profile-model.ts).
//
// Die Geräte-Deutung hat einen Grund, hier geprüft zu werden: An „Chrome auf
// macOS" hängt die Entscheidung, ob jemand ein FREMDES Gerät abmeldet. Eine
// Verwechslung ist deshalb kein Schönheitsfehler.
import { describe, expect, it } from 'vitest'
import {
  dataExportLine,
  DATA_EXPORT_DEFAULT_LINE,
  type DataExportStatus,
  usedPercent,
  parseBrowser,
  deviceName,
  deviceIcon,
  deviceSubline,
  formatBytes,
  isMobile,
  relativeTime,
  storageBarSegments,
  storageLow,
  parseOs,
  type Device,
  type StorageStatus,
} from '../src/account/account-model'

const CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const EDGE_WIN =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 Edg/126.0'

const geraet = (patch: Partial<Device> = {}): Device => ({
  id: 'sitzung:s_1',
  kind: 'session',
  label: CHROME_MAC,
  ipPrefix: '84.119.x.x',
  signedInAt: '2026-08-01T10:00:00.000Z',
  lastSeenAt: '2026-08-06T09:58:00.000Z',
  ...patch,
})

describe('Geräte deuten', () => {
  it('unterscheidet Browser, die alle „Safari" im Namen tragen', () => {
    // Jeder Chrome nennt sich auch Safari, jeder Edge auch Chrome — die
    // Reihenfolge der Prüfungen ist das Ganze.
    expect(parseBrowser(CHROME_MAC)).toBe('Chrome')
    expect(parseBrowser(SAFARI_IPHONE)).toBe('Safari')
    expect(parseBrowser(EDGE_WIN)).toBe('Edge')
  })

  it('erkennt das System — iPhone vor „Mac OS X", das es mitträgt', () => {
    expect(parseOs(CHROME_MAC)).toBe('macOS')
    expect(parseOs(SAFARI_IPHONE)).toBe('iPhone')
    expect(parseOs(EDGE_WIN)).toBe('Windows')
    expect(parseOs('Mozilla/5.0 (Linux; Android 14; Pixel 9)')).toBe('Android')
  })

  it('beschriftet Sitzungen und die App', () => {
    expect(deviceName(geraet())).toBe('Chrome auf macOS')
    expect(deviceName(geraet({ label: SAFARI_IPHONE }))).toBe('Safari auf iPhone')
    expect(deviceName(geraet({ kind: 'app', label: 'Pixel 9' }))).toBe('Maptale App · Pixel 9')
  })

  it('rät nicht, wo es nichts zu deuten gibt', () => {
    expect(deviceName(geraet({ label: null }))).toBe('Unbekanntes Gerät')
    expect(deviceName(geraet({ label: 'irgendetwas/1.0' }))).toBe('Unbekanntes Gerät')
  })

  it('wählt das Symbol nach Bauart', () => {
    expect(deviceIcon(geraet())).toBe('desktop')
    expect(deviceIcon(geraet({ label: SAFARI_IPHONE }))).toBe('phone')
    expect(deviceIcon(geraet({ kind: 'app', label: 'Pixel 9' }))).toBe('app')
    expect(isMobile(EDGE_WIN)).toBe(false)
  })

  it('baut die Unterzeile aus dem, was da ist — und lässt Lücken weg', () => {
    const jetzt = new Date('2026-08-06T10:00:00.000Z')
    expect(deviceSubline(geraet(), jetzt)).toBe('84.119.x.x · zuletzt gerade eben')
    expect(deviceSubline(geraet({ ipPrefix: null }), jetzt)).toBe('zuletzt gerade eben')
    // Ohne „zuletzt gesehen" zählt die Anmeldung — nie ein Platzhalter-Strich.
    expect(deviceSubline(geraet({ ipPrefix: null, lastSeenAt: null }), jetzt)).toBe(
      'zuletzt vor 5 Tagen',
    )
  })
})

describe('relativeZeit', () => {
  const jetzt = new Date('2026-08-06T12:00:00.000Z')

  it('bleibt relativ, solange es eine Erinnerung ist', () => {
    expect(relativeTime('2026-08-06T11:58:00.000Z', jetzt)).toBe('gerade eben')
    expect(relativeTime('2026-08-06T11:20:00.000Z', jetzt)).toBe('vor 40 Minuten')
    expect(relativeTime('2026-08-06T09:00:00.000Z', jetzt)).toBe('vor 3 Stunden')
    expect(relativeTime('2026-08-05T11:00:00.000Z', jetzt)).toBe('gestern')
    expect(relativeTime('2026-08-03T12:00:00.000Z', jetzt)).toBe('vor 3 Tagen')
  })

  it('nennt ab einer Woche ein Datum — „vor 43 Tagen" muss man nachrechnen', () => {
    expect(relativeTime('2026-07-12T12:00:00.000Z', jetzt)).toBe('am 12. Juli 2026')
  })

  it('macht aus einer vorlaufenden Uhr kein „in -3 Minuten"', () => {
    expect(relativeTime('2026-08-06T12:03:00.000Z', jetzt)).toBe('gerade eben')
  })

  it('schweigt bei fehlender oder kaputter Angabe', () => {
    expect(relativeTime(null, jetzt)).toBe('')
    expect(relativeTime('kein Datum', jetzt)).toBe('')
  })
})

describe('Speicher', () => {
  const mb = (n: number): number => n * 1024 * 1024
  const stand = (patch: Partial<StorageStatus> = {}): StorageStatus => ({
    used: mb(248),
    limit: mb(2048),
    free: mb(1800),
    breakdown: {
      photos: mb(152),
      videos: mb(63),
      audio: mb(21),
      recordings: mb(12),
      other: 0,
    },
    ...patch,
  })

  it('misst am Limit, nicht an der Summe — sonst sähe ein leeres Konto voll aus', () => {
    const abschnitte = storageBarSegments(stand())
    expect(abschnitte.map((a) => a.kind)).toEqual(['photos', 'videos', 'audio', 'recordings'])
    expect(abschnitte[0]?.percent).toBeCloseTo((152 / 2048) * 100, 4)
    expect(Math.round(usedPercent(stand()))).toBe(12)
  })

  it('lässt leere Arten weg', () => {
    const leer = stand({
      breakdown: { photos: mb(10), videos: 0, audio: 0, recordings: 0, other: 0 },
    })
    expect(storageBarSegments(leer).map((a) => a.kind)).toEqual(['photos'])
  })

  it('warnt erst, wenn wirklich nichts mehr passt', () => {
    expect(storageLow(stand())).toBe(false)
    expect(storageLow(stand({ used: mb(1902) }))).toBe(true)
  })

  it('sprengt den Balken nicht, wenn das Limit überschritten ist', () => {
    expect(usedPercent(stand({ used: mb(3000) }))).toBe(100)
    expect(usedPercent(stand({ limit: 0 }))).toBe(0)
  })

  it('schreibt Größen so, wie man sie liest', () => {
    expect(formatBytes(mb(152))).toBe('152 MB')
    expect(formatBytes(mb(1023))).toBe('1 023 MB')
    // Ab einem Gigabyte in GB: „1 902 MB" liest niemand als „fast zwei Gigabyte".
    expect(formatBytes(mb(1902))).toBe('1,9 GB')
    expect(formatBytes(mb(2048))).toBe('2,0 GB')
    expect(formatBytes(mb(0.4))).toBe('0,4 MB')
    expect(formatBytes(0)).toBe('0 MB')
  })
})

describe('exportZeile', () => {
  const jetzt = new Date('2026-08-06T12:00:00Z')
  const stand = (p: Partial<DataExportStatus> = {}): DataExportStatus => ({
    id: 'x_1',
    status: 'done',
    requestedAt: '2026-08-06T10:00:00Z',
    finishedAt: '2026-08-06T10:05:00Z',
    expiresAt: '2026-08-08T10:05:00Z',
    bytes: 1024 * 1024 * 640,
    files: 42,
    ...p,
  })

  it('zeigt die Standardzeile, wenn nie exportiert wurde', () => {
    // Kein „noch nichts" hinstellen: Dann steht dort, was der Knopf tut.
    expect(dataExportLine(null)).toBe(DATA_EXPORT_DEFAULT_LINE)
    expect(dataExportLine(undefined)).toBe(DATA_EXPORT_DEFAULT_LINE)
  })

  it('nennt Größe und verbleibende Frist', () => {
    expect(dataExportLine(stand(), jetzt)).toBe(
      'Dein Archiv (640 MB) liegt bereit, der Link aus der Mail gilt noch 46 Stunden.',
    )
    expect(dataExportLine(stand({ expiresAt: '2026-08-06T12:40:00Z' }), jetzt)).toContain(
      'noch eine Stunde',
    )
  })

  it('behauptet nichts über ein Archiv, das es nicht mehr gibt', () => {
    // Abgelaufen heißt gelöscht — die Zeile darf nicht sagen, es liege bereit.
    expect(dataExportLine(stand({ expiresAt: '2026-08-06T09:00:00Z' }), jetzt)).toContain(
      'abgelaufen',
    )
    expect(dataExportLine(stand({ expiresAt: null }), jetzt)).toContain('abgelaufen')
  })

  it('unterscheidet läuft und fehlgeschlagen', () => {
    expect(dataExportLine(stand({ status: 'running' }), jetzt)).toContain('wird gerade gebaut')
    expect(dataExportLine(stand({ status: 'failed' }), jetzt)).toContain('fehlgeschlagen')
  })
})
