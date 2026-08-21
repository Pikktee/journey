// Der Vertrag zwischen dem Kern und einem Tracker-Anbieter (Polar, Wahoo,
// Suunto, …). Konzept: docs/concepts/konzept_tracker_integrationen.md, 3.1.
//
// Ein Anbieter implementiert nur, was er kann. Alles Gemeinsame — Tokens
// erneuern, Dedup, Quota, Tour anlegen, Fehler protokollieren — steht genau
// einmal im Kern; sonst wäre jeder neue Anbieter ein Eingriff in Upload,
// Pipeline und Clients statt einer neuen Datei.

export const PROVIDERS = ['polar', 'wahoo', 'suunto', 'ridewithgps', 'strava', 'garmin'] as const

export type TrackerProviderId = (typeof PROVIDERS)[number]

/** Anzeigenamen für Oberfläche und Fehlermeldungen (der Kern kennt keine Marke). */
export const PROVIDER_NAMES: Record<TrackerProviderId, string> = {
  polar: 'Polar',
  wahoo: 'Wahoo',
  suunto: 'Suunto',
  ridewithgps: 'Ride with GPS',
  strava: 'Strava',
  garmin: 'Garmin',
}

export interface ProviderTokens {
  access: string
  refresh?: string | null
  /** ISO; fehlt bei Anbietern mit unbefristeten Tokens (Polar). */
  expiresAt?: string | null
  /** Anbieter-eigene Nutzerkennung (Polar member-id, Strava athlete-id …). */
  externalUser?: string | null
}

/** Was der Webhook meldet: „Nutzer X hat Aktivität Y" — mehr nicht. */
export interface TrackerEvent {
  externalUser: string
  externalId: string
  kind: 'aktivitaet' | 'abmeldung'
}

/** Ein Trackpunkt, wie ihn Anbieter ohne Datei liefern (Strava-Streams, RWGPS). */
export interface RawPoint {
  lat: number
  lng: number
  ele?: number
  /** ISO 8601 */
  time: string
}

/**
 * Anbieterneutraler Rohtrack: Bytes plus das Nötigste zum Anlegen der Tour.
 *
 * `punkte` ist ein eigenes Format und keine Bequemlichkeit: Strava und Ride
 * with GPS liefern keine Datei, sondern JSON-Reihen. Wer sie im Adapter schon
 * zu GPX-XML serialisiert, schreibt in jedem solchen Adapter denselben
 * Serialisierer — und die Tests prüfen dann String-Vergleiche statt
 * Koordinaten. Der Normalisierer ist die eine Stelle, die GPX schreibt.
 */
export interface RawTrack {
  format: 'gpx' | 'fit' | 'tcx' | 'points'
  bytes?: Uint8Array
  points?: RawPoint[]
  title?: string | null
  /** Sportart des Anbieters („Ride", „Run", …) — der Kern übersetzt sie in einen Modus. */
  sport?: string | null
  /** ISO 8601 */
  start: string
  /** ISO 8601 */
  end: string
}

/** Was eine Webhook-Zustellung mitbringt (Fastify-unabhängig, damit testbar). */
export interface WebhookRequest {
  /** Roher Body — die Signatur wird über die BYTES gebildet, nicht über das geparste JSON. */
  rawBody: string
  headers: Record<string, string | undefined>
  /** Query-Parameter (Strava verifiziert seine Abos darüber). */
  query: Record<string, string | undefined>
}

export interface TrackerProvider {
  readonly id: TrackerProviderId
  /**
   * Ohne konfigurierte Zugangsdaten meldet die Registry den Anbieter als
   * „nicht verfügbar". Teil des VERTRAGS und nicht der Registry-Logik: Nur der
   * Adapter weiß, was er zum Arbeiten braucht (Polar: Client-ID und -Secret;
   * ein Datei-Import: nichts). Ein Anbieter ohne hinterlegte Zugangsdaten darf
   * nicht in der Oberfläche stehen — sonst führt „Verbinden" auf eine
   * Fehlerseite des Anbieters. Dieselbe Linie wie `openRouterKey` in config.ts:
   * fehlt der Schlüssel, ist das Feature aus, nicht kaputt.
   */
  readonly configured: boolean

  authorizationUrl(state: string, redirectUri: string): string
  exchangeCode(code: string, redirectUri: string): Promise<ProviderTokens>
  refreshTokens?(refresh: string): Promise<ProviderTokens>

  /** Einmalige Pflichtschritte nach dem Verknüpfen (Polar: `POST /v3/users`). */
  afterLink?(tokens: ProviderTokens): Promise<ProviderTokens | void>
  /** Beim Trennen: Abo/Autorisierung beim Anbieter aufheben. */
  unlink?(tokens: ProviderTokens): Promise<void>

  webhook?: {
    /** Signatur/Challenge prüfen. Falsch = 401, kein Import. */
    verify(request: WebhookRequest): boolean | Promise<boolean>
    /**
     * Ist die Zustellung ein reiner Erreichbarkeits-Test?
     *
     * Polar schickt beim ANLEGEN des Webhooks einen PING und erwartet 200 —
     * und der ist grundsätzlich nicht zu verifizieren: Der Signatur-Schlüssel
     * entsteht erst als Antwort auf genau diesen Aufruf. Ohne diesen Weg
     * scheiterte jede Webhook-Registrierung an der eigenen Signaturprüfung.
     *
     * Die Umsetzung muss ENG sein: true nur für eine Nutzlast, die
     * nachweislich nichts auslöst. Der Aufrufer beantwortet sie mit 200 und
     * tut nichts — wer unsignierte Pings schickt, erreicht damit nichts außer
     * einer 200.
     */
    isPing?(request: WebhookRequest): boolean
    parseEvents(request: WebhookRequest): TrackerEvent[]
    /** Manche Anbieter verlangen eine Echo-Antwort (Strava: `hub.challenge`). */
    response?(request: WebhookRequest): unknown
  }

  /**
   * Ohne Webhook: neue Aktivitäten auflisten (Polling-Fallback).
   *
   * **`seit` ist ein Hinweis, keine Filtervorschrift — und die STARTZEIT einer
   * Aktivität ist der falsche Gegenwert dazu.** Der Cursor läuft in
   * Wanduhrzeit und rückt auch dann vor, wenn ein Abruf nichts fand; eine
   * Aktivität erscheint beim Anbieter aber oft lange nach ihrem Start (die Uhr
   * synchronisiert später, der Anbieter rechnet nach). Wer beides vergleicht,
   * verliert genau die Aktivitäten dauerhaft, die in dieser Lücke lagen — und
   * das ist der einzige Fall, für den es den Polling-Weg gibt. Genau so
   * geschehen, s. `PolarProvider.listNew`.
   *
   * Wer `seit` an eine Anbieter-API weiterreicht, prüfe also, WORAUF sie
   * filtert (Erscheinungszeit ist richtig, Startzeit nicht) — im Zweifel
   * großzügig überlappen lassen: Doppeltes fängt `claim` im Kern ab,
   * bevor auch nur ein Byte geholt wird.
   */
  listNew?(tokens: ProviderTokens, since: string | null): Promise<TrackerEvent[]>

  fetchTrack(tokens: ProviderTokens, externalId: string): Promise<RawTrack>
}

/** Ein Anbieter, dessen Tokens abgelaufen sind — der Kern setzt dann `abgelaufen`. */
export class InvalidTokensError extends Error {
  constructor(message = 'Verknüpfung ist abgelaufen, bitte neu verbinden') {
    super(message)
    this.name = 'TokensUngueltigFehler'
  }
}

/**
 * Die Aktivität trägt keine GPS-Route (Hallentraining, Krafteinheit).
 *
 * Kein Fehler, sondern der Status `uebersprungen`: Anbieter melden solche
 * Einheiten genauso, und als Fehler geführt stünde die Liste eines
 * Vielsportlers dauerhaft voll.
 */
export class NoRouteError extends Error {
  constructor(message = 'Aktivität ohne GPS-Route') {
    super(message)
    this.name = 'OhneRouteFehler'
  }
}

/**
 * Die Aktivität ist zu klein für eine Tour — dieselbe Sorte wie
 * `NoRouteError`: eine Aussage über die Aktivität, nicht über den Moment
 * (also `uebersprungen` und kein neuer Anlauf).
 *
 * Steht hier im VERTRAG und nicht beim TourAnleger, obwohl der sie am
 * häufigsten wirft: Ein Adapter, der schon an der Anbieter-Antwort sieht, dass
 * nichts zu holen ist (Polar: Dauer null), muss sie werfen können, ohne den
 * TourAnleger zu importieren — sonst hinge an jedem Adapter die halbe Pipeline.
 */
export class TooSmallError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ZuKleinFehler'
  }
}
