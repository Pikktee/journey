// Datenmodell der Kontoeinstellungen (DOM-frei, wie profilmodell.ts).
//
// Die Geräte-Deutung hat einen Grund, hier geprüft zu werden: An „Chrome auf
// macOS" hängt die Entscheidung, ob jemand ein FREMDES Gerät abmeldet. Eine
// Verwechslung ist deshalb kein Schönheitsfehler.
import { describe, expect, it } from 'vitest'
import {
  exportZeile,
  EXPORT_STANDARDZEILE,
  type ExportStand,
  belegtProzent,
  browserAus,
  geraeteName,
  geraeteSymbol,
  geraeteUnterzeile,
  groesse,
  istHandgeraet,
  relativeZeit,
  speicherAbschnitte,
  speicherKnapp,
  systemAus,
  type Geraet,
  type SpeicherStand,
} from '../src/konto/kontomodell'

const CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const EDGE_WIN =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 Edg/126.0'

const geraet = (patch: Partial<Geraet> = {}): Geraet => ({
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
    expect(browserAus(CHROME_MAC)).toBe('Chrome')
    expect(browserAus(SAFARI_IPHONE)).toBe('Safari')
    expect(browserAus(EDGE_WIN)).toBe('Edge')
  })

  it('erkennt das System — iPhone vor „Mac OS X", das es mitträgt', () => {
    expect(systemAus(CHROME_MAC)).toBe('macOS')
    expect(systemAus(SAFARI_IPHONE)).toBe('iPhone')
    expect(systemAus(EDGE_WIN)).toBe('Windows')
    expect(systemAus('Mozilla/5.0 (Linux; Android 14; Pixel 9)')).toBe('Android')
  })

  it('beschriftet Sitzungen und die App', () => {
    expect(geraeteName(geraet())).toBe('Chrome auf macOS')
    expect(geraeteName(geraet({ label: SAFARI_IPHONE }))).toBe('Safari auf iPhone')
    expect(geraeteName(geraet({ kind: 'app', label: 'Pixel 9' }))).toBe('Maptale App · Pixel 9')
  })

  it('rät nicht, wo es nichts zu deuten gibt', () => {
    expect(geraeteName(geraet({ label: null }))).toBe('Unbekanntes Gerät')
    expect(geraeteName(geraet({ label: 'irgendetwas/1.0' }))).toBe('Unbekanntes Gerät')
  })

  it('wählt das Symbol nach Bauart', () => {
    expect(geraeteSymbol(geraet())).toBe('rechner')
    expect(geraeteSymbol(geraet({ label: SAFARI_IPHONE }))).toBe('telefon')
    expect(geraeteSymbol(geraet({ kind: 'app', label: 'Pixel 9' }))).toBe('app')
    expect(istHandgeraet(EDGE_WIN)).toBe(false)
  })

  it('baut die Unterzeile aus dem, was da ist — und lässt Lücken weg', () => {
    const jetzt = new Date('2026-08-06T10:00:00.000Z')
    expect(geraeteUnterzeile(geraet(), jetzt)).toBe('84.119.x.x · zuletzt gerade eben')
    expect(geraeteUnterzeile(geraet({ ipPrefix: null }), jetzt)).toBe('zuletzt gerade eben')
    // Ohne „zuletzt gesehen" zählt die Anmeldung — nie ein Platzhalter-Strich.
    expect(geraeteUnterzeile(geraet({ ipPrefix: null, lastSeenAt: null }), jetzt)).toBe(
      'zuletzt vor 5 Tagen',
    )
  })
})

describe('relativeZeit', () => {
  const jetzt = new Date('2026-08-06T12:00:00.000Z')

  it('bleibt relativ, solange es eine Erinnerung ist', () => {
    expect(relativeZeit('2026-08-06T11:58:00.000Z', jetzt)).toBe('gerade eben')
    expect(relativeZeit('2026-08-06T11:20:00.000Z', jetzt)).toBe('vor 40 Minuten')
    expect(relativeZeit('2026-08-06T09:00:00.000Z', jetzt)).toBe('vor 3 Stunden')
    expect(relativeZeit('2026-08-05T11:00:00.000Z', jetzt)).toBe('gestern')
    expect(relativeZeit('2026-08-03T12:00:00.000Z', jetzt)).toBe('vor 3 Tagen')
  })

  it('nennt ab einer Woche ein Datum — „vor 43 Tagen" muss man nachrechnen', () => {
    expect(relativeZeit('2026-07-12T12:00:00.000Z', jetzt)).toBe('am 12. Juli 2026')
  })

  it('macht aus einer vorlaufenden Uhr kein „in -3 Minuten"', () => {
    expect(relativeZeit('2026-08-06T12:03:00.000Z', jetzt)).toBe('gerade eben')
  })

  it('schweigt bei fehlender oder kaputter Angabe', () => {
    expect(relativeZeit(null, jetzt)).toBe('')
    expect(relativeZeit('kein Datum', jetzt)).toBe('')
  })
})

describe('Speicher', () => {
  const mb = (n: number): number => n * 1024 * 1024
  const stand = (patch: Partial<SpeicherStand> = {}): SpeicherStand => ({
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
    const abschnitte = speicherAbschnitte(stand())
    expect(abschnitte.map((a) => a.art)).toEqual(['photos', 'videos', 'audio', 'recordings'])
    expect(abschnitte[0]?.prozent).toBeCloseTo((152 / 2048) * 100, 4)
    expect(Math.round(belegtProzent(stand()))).toBe(12)
  })

  it('lässt leere Arten weg', () => {
    const leer = stand({
      breakdown: { photos: mb(10), videos: 0, audio: 0, recordings: 0, other: 0 },
    })
    expect(speicherAbschnitte(leer).map((a) => a.art)).toEqual(['photos'])
  })

  it('warnt erst, wenn wirklich nichts mehr passt', () => {
    expect(speicherKnapp(stand())).toBe(false)
    expect(speicherKnapp(stand({ used: mb(1902) }))).toBe(true)
  })

  it('sprengt den Balken nicht, wenn das Limit überschritten ist', () => {
    expect(belegtProzent(stand({ used: mb(3000) }))).toBe(100)
    expect(belegtProzent(stand({ limit: 0 }))).toBe(0)
  })

  it('schreibt Größen so, wie man sie liest', () => {
    expect(groesse(mb(152))).toBe('152 MB')
    expect(groesse(mb(1023))).toBe('1 023 MB')
    // Ab einem Gigabyte in GB: „1 902 MB" liest niemand als „fast zwei Gigabyte".
    expect(groesse(mb(1902))).toBe('1,9 GB')
    expect(groesse(mb(2048))).toBe('2,0 GB')
    expect(groesse(mb(0.4))).toBe('0,4 MB')
    expect(groesse(0)).toBe('0 MB')
  })
})

describe('exportZeile', () => {
  const jetzt = new Date('2026-08-06T12:00:00Z')
  const stand = (p: Partial<ExportStand> = {}): ExportStand => ({
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
    expect(exportZeile(null)).toBe(EXPORT_STANDARDZEILE)
    expect(exportZeile(undefined)).toBe(EXPORT_STANDARDZEILE)
  })

  it('nennt Größe und verbleibende Frist', () => {
    expect(exportZeile(stand(), jetzt)).toBe(
      'Dein Archiv (640 MB) liegt bereit, der Link aus der Mail gilt noch 46 Stunden.',
    )
    expect(exportZeile(stand({ expiresAt: '2026-08-06T12:40:00Z' }), jetzt)).toContain(
      'noch eine Stunde',
    )
  })

  it('behauptet nichts über ein Archiv, das es nicht mehr gibt', () => {
    // Abgelaufen heißt gelöscht — die Zeile darf nicht sagen, es liege bereit.
    expect(exportZeile(stand({ expiresAt: '2026-08-06T09:00:00Z' }), jetzt)).toContain('abgelaufen')
    expect(exportZeile(stand({ expiresAt: null }), jetzt)).toContain('abgelaufen')
  })

  it('unterscheidet läuft und fehlgeschlagen', () => {
    expect(exportZeile(stand({ status: 'running' }), jetzt)).toContain('wird gerade gebaut')
    expect(exportZeile(stand({ status: 'failed' }), jetzt)).toContain('fehlgeschlagen')
  })
})
