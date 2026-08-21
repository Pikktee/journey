// Ein erfundener Anbieter mit festen Antworten — das Spiegelbild eines echten
// Adapters, wie `FixedGeocoder` und `FixedWeatherSource` es für ihre Dienste
// sind.
//
// Er liegt in src/ und nicht in test/, weil er dieselbe Rolle hat wie jene:
// Er beweist, dass der Vertrag ohne Netz erfüllbar ist, und er ist die
// Vorlage, an der sich der erste echte Adapter (Polar) misst.

import { createHmac } from 'node:crypto'
import { timingSafeEquals } from './crypto.js'
import type {
  ProviderTokens,
  RawTrack,
  TrackerEvent,
  TrackerProvider,
  WebhookRequest,
} from './contract.js'

export interface TestProviderOptions {
  /** Tracks je externer Aktivitäts-ID; fehlt eine, wirft `fetchTrack`. */
  tracks?: Record<string, RawTrack>
  /** HMAC-Schlüssel des Webhooks; ohne ihn akzeptiert die Prüfung alles NICHT. */
  webhookSecret?: string
  /** Nutzerkennung, die der Token-Tausch zurückgibt. */
  externalUser?: string
  konfiguriert?: boolean
  /** Ergebnisse für `listNew` (Polling-Pfad). */
  news?: TrackerEvent[]
  /** `listNew` wirft — der Anbieter ist gerade nicht erreichbar. */
  listThrows?: boolean
  /** Erkennt `{"event":"PING"}` als Erreichbarkeits-Test (wie Polar). */
  istPing?: boolean
}

/** Signatur, wie sie ein echter Anbieter über den ROHEN Body bildet. */
export function testSignature(rohBody: string, secret: string): string {
  return createHmac('sha256', secret).update(rohBody).digest('hex')
}

export class TestProvider implements TrackerProvider {
  readonly id = 'polar' as const
  readonly configured: boolean
  /** Mitschrift für die Tests: Wurde beim Trennen wirklich abgemeldet? */
  readonly calls: string[] = []

  constructor(private opt: TestProviderOptions = {}) {
    this.configured = opt.konfiguriert ?? true
  }

  authorizationUrl(zustand: string, redirectUri: string): string {
    return `https://anbieter.test/oauth?state=${encodeURIComponent(zustand)}&redirect_uri=${encodeURIComponent(redirectUri)}`
  }

  async exchangeCode(code: string): Promise<ProviderTokens> {
    this.calls.push(`tausche:${code}`)
    if (code === 'ungueltig') throw new Error('Code abgelehnt')
    return { access: `zugriff-${code}`, externalUser: this.opt.externalUser ?? 'extern-1' }
  }

  async afterLink(tokens: ProviderTokens): Promise<ProviderTokens> {
    // Polars `POST /v3/users`: ohne diesen Schritt liefert die API still nichts
    this.calls.push('registriere')
    return tokens
  }

  async unlink(): Promise<void> {
    this.calls.push('trenne')
  }

  webhook = {
    isPing: (anfrage: WebhookRequest): boolean => {
      if (!this.opt.istPing) return false
      try {
        const data = JSON.parse(anfrage.rawBody || '{}') as Record<string, unknown>
        return (
          data['event'] === 'PING' &&
          data['user_id'] === undefined &&
          data['entity_id'] === undefined
        )
      } catch {
        return false
      }
    },

    verify: (anfrage: WebhookRequest): boolean => {
      const secret = this.opt.webhookSecret
      if (!secret) return false
      const passed = anfrage.headers['polar-webhook-signature'] ?? ''
      return timingSafeEquals(passed, testSignature(anfrage.rawBody, secret))
    },
    parseEvents: (anfrage: WebhookRequest): TrackerEvent[] => {
      const data = JSON.parse(anfrage.rawBody || '{}') as {
        event?: string
        user_id?: string
        entity_id?: string
      }
      if (!data.user_id || !data.entity_id) return []
      return [
        {
          externalUser: String(data.user_id),
          externalId: String(data.entity_id),
          kind: data.event === 'ABMELDUNG' ? 'abmeldung' : 'aktivitaet',
        },
      ]
    },
  }

  async listNew(): Promise<TrackerEvent[]> {
    if (this.opt.listThrows) throw new Error('Anbieter antwortet nicht')
    return this.opt.news ?? []
  }

  /**
   * Einen Track nachreichen — für den Fall, den es in echt dauernd gibt: Die
   * Zustellung kommt, bevor der Anbieter die Datei bereitgestellt hat (oder er
   * ist gerade weg), und die WIEDERHOLTE Zustellung findet sie dann vor.
   */
  setTrack(externalId: string, track: RawTrack): void {
    this.opt.tracks = { ...(this.opt.tracks ?? {}), [externalId]: track }
  }

  async fetchTrack(_tokens: ProviderTokens, externalId: string): Promise<RawTrack> {
    this.calls.push(`fetchTrack:${externalId}`)
    const track = this.opt.tracks?.[externalId]
    if (!track) throw new Error(`Unbekannte Aktivität: ${externalId}`)
    return track
  }
}

/**
 * Ein brauchbarer Beispieltrack: ~2,4 km in 20 Minuten, im Berner Oberland —
 * über den Mindestgrößen des TourAnlegers, damit er nicht übersprungen wird.
 */
export function exampleRawTrack(part: Partial<RawTrack> = {}): RawTrack {
  const startMs = Date.parse('2026-07-04T08:00:00Z')
  const points = Array.from({ length: 25 }, (_, i) => ({
    lat: 46.5934 + i * 0.0009,
    lng: 7.9086 + i * 0.0004,
    ele: 800 + i * 4,
    time: new Date(startMs + i * 50_000).toISOString(),
  }))
  return {
    format: 'points',
    points,
    title: 'Testfahrt',
    sport: 'Ride',
    start: new Date(startMs).toISOString(),
    end: new Date(startMs + 24 * 50_000).toISOString(),
    ...part,
  }
}
