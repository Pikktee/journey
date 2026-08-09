// Der Vertrag zwischen dem Kern und einem Tracker-Anbieter (Polar, Wahoo,
// Suunto, …). Konzept: docs/concepts/konzept_tracker_integrationen.md, 3.1.
//
// Ein Anbieter implementiert nur, was er kann. Alles Gemeinsame — Tokens
// erneuern, Dedup, Quota, Tour anlegen, Fehler protokollieren — steht genau
// einmal im Kern; sonst wäre jeder neue Anbieter ein Eingriff in Upload,
// Pipeline und Clients statt einer neuen Datei.

export const ANBIETER = ['polar', 'wahoo', 'suunto', 'ridewithgps', 'strava', 'garmin'] as const

export type TrackerAnbieter = (typeof ANBIETER)[number]

/** Anzeigenamen für Oberfläche und Fehlermeldungen (der Kern kennt keine Marke). */
export const ANBIETER_NAMEN: Record<TrackerAnbieter, string> = {
  polar: 'Polar',
  wahoo: 'Wahoo',
  suunto: 'Suunto',
  ridewithgps: 'Ride with GPS',
  strava: 'Strava',
  garmin: 'Garmin',
}

export interface ProviderTokens {
  zugriff: string
  erneuerung?: string | null
  /** ISO; fehlt bei Anbietern mit unbefristeten Tokens (Polar). */
  laeuftAb?: string | null
  /** Anbieter-eigene Nutzerkennung (Polar member-id, Strava athlete-id …). */
  externerNutzer?: string | null
}

/** Was der Webhook meldet: „Nutzer X hat Aktivität Y" — mehr nicht. */
export interface TrackerEreignis {
  externerNutzer: string
  externeId: string
  art: 'aktivitaet' | 'abmeldung'
}

/** Ein Trackpunkt, wie ihn Anbieter ohne Datei liefern (Strava-Streams, RWGPS). */
export interface RohPunkt {
  lat: number
  lng: number
  ele?: number
  /** ISO 8601 */
  zeit: string
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
export interface RohTrack {
  format: 'gpx' | 'fit' | 'tcx' | 'punkte'
  bytes?: Uint8Array
  punkte?: RohPunkt[]
  titel?: string | null
  /** Sportart des Anbieters („Ride", „Run", …) — der Kern übersetzt sie in einen Modus. */
  sportart?: string | null
  /** ISO 8601 */
  start: string
  /** ISO 8601 */
  ende: string
}

/** Was eine Webhook-Zustellung mitbringt (Fastify-unabhängig, damit testbar). */
export interface WebhookAnfrage {
  /** Roher Body — die Signatur wird über die BYTES gebildet, nicht über das geparste JSON. */
  rohBody: string
  kopfzeilen: Record<string, string | undefined>
  /** Query-Parameter (Strava verifiziert seine Abos darüber). */
  query: Record<string, string | undefined>
}

export interface TrackerProvider {
  readonly id: TrackerAnbieter
  /**
   * Ohne konfigurierte Zugangsdaten meldet die Registry den Anbieter als
   * „nicht verfügbar". Teil des VERTRAGS und nicht der Registry-Logik: Nur der
   * Adapter weiß, was er zum Arbeiten braucht (Polar: Client-ID und -Secret;
   * ein Datei-Import: nichts). Ein Anbieter ohne hinterlegte Zugangsdaten darf
   * nicht in der Oberfläche stehen — sonst führt „Verbinden" auf eine
   * Fehlerseite des Anbieters. Dieselbe Linie wie `openRouterKey` in config.ts:
   * fehlt der Schlüssel, ist das Feature aus, nicht kaputt.
   */
  readonly konfiguriert: boolean

  autorisierungsUrl(zustand: string, redirectUri: string): string
  tauscheCode(code: string, redirectUri: string): Promise<ProviderTokens>
  erneuereTokens?(erneuerung: string): Promise<ProviderTokens>

  /** Einmalige Pflichtschritte nach dem Verknüpfen (Polar: `POST /v3/users`). */
  nachVerknuepfung?(tokens: ProviderTokens): Promise<ProviderTokens | void>
  /** Beim Trennen: Abo/Autorisierung beim Anbieter aufheben. */
  trenne?(tokens: ProviderTokens): Promise<void>

  webhook?: {
    /** Signatur/Challenge prüfen. Falsch = 401, kein Import. */
    verifiziere(anfrage: WebhookAnfrage): boolean | Promise<boolean>
    parseEreignisse(anfrage: WebhookAnfrage): TrackerEreignis[]
    /** Manche Anbieter verlangen eine Echo-Antwort (Strava: `hub.challenge`). */
    antwort?(anfrage: WebhookAnfrage): unknown
  }

  /** Ohne Webhook: seit `seit` neue Aktivitäten auflisten (Polling-Fallback). */
  listeNeue?(tokens: ProviderTokens, seit: string | null): Promise<TrackerEreignis[]>

  holeTrack(tokens: ProviderTokens, externeId: string): Promise<RohTrack>
}

/** Ein Anbieter, dessen Tokens abgelaufen sind — der Kern setzt dann `abgelaufen`. */
export class TokensUngueltigFehler extends Error {
  constructor(nachricht = 'Verknüpfung ist abgelaufen, bitte neu verbinden') {
    super(nachricht)
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
export class OhneRouteFehler extends Error {
  constructor(nachricht = 'Aktivität ohne GPS-Route') {
    super(nachricht)
    this.name = 'OhneRouteFehler'
  }
}
