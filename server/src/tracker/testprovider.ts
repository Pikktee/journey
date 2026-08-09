// Ein erfundener Anbieter mit festen Antworten — das Spiegelbild eines echten
// Adapters, wie `FesterGeocoder` und `FesteWetterQuelle` es für ihre Dienste
// sind.
//
// Er liegt in src/ und nicht in test/, weil er dieselbe Rolle hat wie jene:
// Er beweist, dass der Vertrag ohne Netz erfüllbar ist, und er ist die
// Vorlage, an der sich der erste echte Adapter (Polar) misst.

import { createHmac } from 'node:crypto'
import { gleichSicher } from './krypto.js'
import type {
  ProviderTokens,
  RohTrack,
  TrackerEreignis,
  TrackerProvider,
  WebhookAnfrage,
} from './vertrag.js'

export interface TestProviderOptionen {
  /** Tracks je externer Aktivitäts-ID; fehlt eine, wirft `holeTrack`. */
  tracks?: Record<string, RohTrack>
  /** HMAC-Schlüssel des Webhooks; ohne ihn akzeptiert die Prüfung alles NICHT. */
  webhookGeheimnis?: string
  /** Nutzerkennung, die der Token-Tausch zurückgibt. */
  externerNutzer?: string
  konfiguriert?: boolean
  /** Ergebnisse für `listeNeue` (Polling-Pfad). */
  neue?: TrackerEreignis[]
  /** `listeNeue` wirft — der Anbieter ist gerade nicht erreichbar. */
  listeWirft?: boolean
  /** Erkennt `{"event":"PING"}` als Erreichbarkeits-Test (wie Polar). */
  istPing?: boolean
}

/** Signatur, wie sie ein echter Anbieter über den ROHEN Body bildet. */
export function testSignatur(rohBody: string, geheimnis: string): string {
  return createHmac('sha256', geheimnis).update(rohBody).digest('hex')
}

export class TestProvider implements TrackerProvider {
  readonly id = 'polar' as const
  readonly konfiguriert: boolean
  /** Mitschrift für die Tests: Wurde beim Trennen wirklich abgemeldet? */
  readonly aufrufe: string[] = []

  constructor(private opt: TestProviderOptionen = {}) {
    this.konfiguriert = opt.konfiguriert ?? true
  }

  autorisierungsUrl(zustand: string, redirectUri: string): string {
    return `https://anbieter.test/oauth?state=${encodeURIComponent(zustand)}&redirect_uri=${encodeURIComponent(redirectUri)}`
  }

  async tauscheCode(code: string): Promise<ProviderTokens> {
    this.aufrufe.push(`tausche:${code}`)
    if (code === 'ungueltig') throw new Error('Code abgelehnt')
    return { zugriff: `zugriff-${code}`, externerNutzer: this.opt.externerNutzer ?? 'extern-1' }
  }

  async nachVerknuepfung(tokens: ProviderTokens): Promise<ProviderTokens> {
    // Polars `POST /v3/users`: ohne diesen Schritt liefert die API still nichts
    this.aufrufe.push('registriere')
    return tokens
  }

  async trenne(): Promise<void> {
    this.aufrufe.push('trenne')
  }

  webhook = {
    istPing: (anfrage: WebhookAnfrage): boolean => {
      if (!this.opt.istPing) return false
      try {
        const daten = JSON.parse(anfrage.rohBody || '{}') as Record<string, unknown>
        return daten['event'] === 'PING' && daten['user_id'] === undefined && daten['entity_id'] === undefined
      } catch {
        return false
      }
    },

    verifiziere: (anfrage: WebhookAnfrage): boolean => {
      const geheimnis = this.opt.webhookGeheimnis
      if (!geheimnis) return false
      const mitgeschickt = anfrage.kopfzeilen['polar-webhook-signature'] ?? ''
      return gleichSicher(mitgeschickt, testSignatur(anfrage.rohBody, geheimnis))
    },
    parseEreignisse: (anfrage: WebhookAnfrage): TrackerEreignis[] => {
      const daten = JSON.parse(anfrage.rohBody || '{}') as {
        event?: string
        user_id?: string
        entity_id?: string
      }
      if (!daten.user_id || !daten.entity_id) return []
      return [
        {
          externerNutzer: String(daten.user_id),
          externeId: String(daten.entity_id),
          art: daten.event === 'ABMELDUNG' ? 'abmeldung' : 'aktivitaet',
        },
      ]
    },
  }

  async listeNeue(): Promise<TrackerEreignis[]> {
    if (this.opt.listeWirft) throw new Error('Anbieter antwortet nicht')
    return this.opt.neue ?? []
  }

  /**
   * Einen Track nachreichen — für den Fall, den es in echt dauernd gibt: Die
   * Zustellung kommt, bevor der Anbieter die Datei bereitgestellt hat (oder er
   * ist gerade weg), und die WIEDERHOLTE Zustellung findet sie dann vor.
   */
  setzeTrack(externeId: string, track: RohTrack): void {
    this.opt.tracks = { ...(this.opt.tracks ?? {}), [externeId]: track }
  }

  async holeTrack(_tokens: ProviderTokens, externeId: string): Promise<RohTrack> {
    this.aufrufe.push(`holeTrack:${externeId}`)
    const track = this.opt.tracks?.[externeId]
    if (!track) throw new Error(`Unbekannte Aktivität: ${externeId}`)
    return track
  }
}

/**
 * Ein brauchbarer Beispieltrack: ~2,4 km in 20 Minuten, im Berner Oberland —
 * über den Mindestgrößen des TourAnlegers, damit er nicht übersprungen wird.
 */
export function beispielRohTrack(teil: Partial<RohTrack> = {}): RohTrack {
  const startMs = Date.parse('2026-07-04T08:00:00Z')
  const punkte = Array.from({ length: 25 }, (_, i) => ({
    lat: 46.5934 + i * 0.0009,
    lng: 7.9086 + i * 0.0004,
    ele: 800 + i * 4,
    zeit: new Date(startMs + i * 50_000).toISOString(),
  }))
  return {
    format: 'punkte',
    punkte,
    titel: 'Testfahrt',
    sportart: 'Ride',
    start: new Date(startMs).toISOString(),
    ende: new Date(startMs + 24 * 50_000).toISOString(),
    ...teil,
  }
}
