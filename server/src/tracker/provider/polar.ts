// Polar AccessLink v3 — der erste echte Adapter.
//
// Warum Polar zuerst: self-serve Zugang ohne Review, und der Track kommt
// FERTIG als GPX (`GET /v3/exercises/{id}/gpx`) — als einziger Anbieter
// braucht Polar den Normalisierer damit gar nicht.
//
// Zwei Eigenheiten bestimmen diesen Adapter, beide sind in der API nicht zu
// übersehen, aber beim Debuggen unsichtbar:
//
// 1. **Nach dem Token-Tausch muss der Nutzer einmal registriert werden**
//    (`POST /v3/users`). Ohne diesen Schritt liefert die API nichts — kein
//    Fehler, keine leere Liste, schlicht nichts, was nach einem Problem
//    aussieht. Ein zweiter Anlauf antwortet 409 („already registered"), und
//    das ist der Normalfall beim Neuverbinden, also KEIN Fehler.
// 2. **Es gibt keine Historie.** Geliefert wird nur, was nach der
//    Registrierung entsteht. Wer testet, muss also erst verknüpfen und DANN
//    aufzeichnen — andersherum wartet man vergeblich.
//
// Die Zugriffstokens laufen laut Polar nicht ab („will not expire unless
// explicitly revoked"), deshalb kein `refreshTokens` und kein `expiresAt`.
//
// API-Doku: https://www.polar.com/accesslink-api/

import { createHmac } from 'node:crypto'
import type { ProviderCredentials } from '../../config.js'
import { timingSafeEquals } from '../crypto.js'
import {
  NoRouteError,
  InvalidTokensError,
  TooSmallError,
  type ProviderTokens,
  type RawTrack,
  type TrackerEvent,
  type TrackerProvider,
  type WebhookRequest,
} from '../contract.js'

const AUTHORIZE = 'https://flow.polar.com/oauth2/authorization'
const TOKEN = 'https://polarremote.com/v2/oauth2/token'
const API = 'https://www.polaraccesslink.com'

/** Die Netz-Funktion ist injizierbar — Produktion reicht `fetch` herein, Tests Fixtures. */
export type FetchFunction = (url: string, init?: RequestInit) => Promise<Response>

/**
 * Polar schreibt seine JSON-Felder uneinheitlich: Die Nutzer-Ressource nutzt
 * Bindestriche (`polar-user-id`, `member-id`), bei den Übungen finden sich je
 * nach Doku-Fassung `start-time` UND `start_time`. Beide Schreibweisen zu
 * lesen kostet drei Zeilen; sich für eine zu entscheiden hieße, es beim ersten
 * echten Training herauszufinden — und dann ist die Ursache am schwersten zu
 * finden, weil der Fehler wie „Aktivität ohne Route" aussieht.
 */
function field<T = unknown>(obj: Record<string, unknown>, name: string): T | undefined {
  const withDash = obj[name]
  if (withDash !== undefined) return withDash as T
  return obj[name.replace(/-/g, '_')] as T | undefined
}

/**
 * ISO-8601-Dauer („PT2H44M30S") in Sekunden.
 *
 * Nur Stunden/Minuten/Sekunden — Tage und Monate kommen bei einer
 * Trainingsdauer nicht vor, und ein vollständiger Parser wäre Beiwerk.
 */
export function durationToSeconds(duration: string | undefined): number | null {
  if (!duration) return null
  const m = /^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(
    duration.trim(),
  )
  if (!m || (!m[1] && !m[2] && !m[3])) return null
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)
}

/**
 * Polars Startzeit ist LOKALE Zeit ohne Zone („2008-10-13T10:40:02") plus ein
 * separater Versatz in Minuten. Wer das `Z` einfach anhängt, verschiebt jede
 * Tour um ihren Zeitzonen-Versatz — und weil die Pipeline daran Tageszeit,
 * Sonnenstand und Foto-Platzierung hängt, fällt es als „falsches Licht" auf,
 * nicht als Zeitfehler.
 */
export function startTime(
  startTime: string | undefined,
  offsetMinutes: number | undefined,
): number | null {
  if (!startTime) return null
  const asUtc = Date.parse(/[Zz]|[+-]\d{2}:\d{2}$/.test(startTime) ? startTime : `${startTime}Z`)
  if (!Number.isFinite(asUtc)) return null
  const offset = Number.isFinite(offsetMinutes) ? (offsetMinutes as number) : 0
  return asUtc - offset * 60_000
}

export class PolarProvider implements TrackerProvider {
  readonly id = 'polar' as const
  readonly configured: boolean

  constructor(
    private readonly access: ProviderCredentials,
    private readonly fetchJson: FetchFunction = fetch,
  ) {
    // Ohne Client-ID/-Secret kann der Adapter nicht arbeiten. Das
    // Webhook-Geheimnis fehlt anfangs absichtlich — es entsteht erst beim
    // Registrieren des Webhooks; ohne es werden Zustellungen abgewiesen, aber
    // Verknüpfen und manuelles Abrufen funktionieren.
    this.configured = Boolean(access.clientId && access.clientSecret)
  }

  // — OAuth —

  authorizationUrl(zustand: string, redirectUri: string): string {
    const p = new URLSearchParams({
      response_type: 'code',
      client_id: this.access.clientId ?? '',
      redirect_uri: redirectUri,
      state: zustand,
    })
    return `${AUTHORIZE}?${p.toString()}`
  }

  async exchangeCode(code: string, redirectUri: string): Promise<ProviderTokens> {
    const basic = Buffer.from(`${this.access.clientId}:${this.access.clientSecret}`).toString(
      'base64',
    )
    const response = await this.fetchJson(TOKEN, {
      method: 'POST',
      headers: {
        authorization: `Basic ${basic}`,
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json;charset=UTF-8',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }).toString(),
    })
    if (!response.ok) throw new Error(`Token-Tausch abgelehnt (${response.status})`)
    const json = (await response.json()) as { access_token?: string; x_user_id?: number | string }
    if (!json.access_token || json.x_user_id === undefined)
      throw new Error('Token-Antwort ohne Zugang oder Nutzerkennung')
    return {
      access: json.access_token,
      // Diese Kennung ist der Zuordnungsweg jedes späteren Webhooks: Sie steht
      // dort als `user_id`. „API user-id und polar-user-id sind austauschbar."
      externalUser: String(json.x_user_id),
      // Polar-Tokens laufen nicht ab — ein `laeuftAb` hier würde den Kern
      // grundlos in die Erneuerung schicken, die es bei Polar gar nicht gibt.
      expiresAt: null,
    }
  }

  /**
   * Der Pflichtschritt: den Nutzer bei unserer App registrieren.
   *
   * Als `member-id` geht die POLAR-Nutzerkennung heraus, nicht unsere
   * Benutzer-ID. Polar verlangt nur Eindeutigkeit, und unsere interne Kennung
   * an einen Dritten zu geben wäre eine Datenweitergabe ohne Zweck — die
   * Zuordnung führen wir ohnehin in unserer eigenen Tabelle.
   */
  async afterLink(tokens: ProviderTokens): Promise<ProviderTokens> {
    const response = await this.fetchJson(`${API}/v3/users`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${tokens.access}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({ 'member-id': tokens.externalUser }),
    })
    // 409 = „User already registered": beim Neuverbinden der Normalfall und
    // ausdrücklich KEIN Fehler. Ihn zu werfen machte jedes zweite Verbinden
    // unmöglich.
    if (!response.ok && response.status !== 409) {
      throw new Error(`Registrierung bei Polar fehlgeschlagen (${response.status})`)
    }
    return tokens
  }

  /** Beim Trennen: Autorisierung beim Anbieter aufheben (204 erwartet). */
  async unlink(tokens: ProviderTokens): Promise<void> {
    if (!tokens.externalUser) return
    const response = await this.fetchJson(
      `${API}/v3/users/${encodeURIComponent(tokens.externalUser)}`,
      {
        method: 'DELETE',
        headers: { authorization: `Bearer ${tokens.access}` },
      },
    )
    // 204 ist der Erfolg, 404 heißt „war schon weg" — beides ist erledigt.
    if (!response.ok && response.status !== 404) {
      throw new Error(`Abmelden bei Polar fehlgeschlagen (${response.status})`)
    }
  }

  // — Webhook —

  webhook = {
    /**
     * Der PING beim Anlegen des Webhooks — die einzige Zustellung, die ohne
     * Signaturprüfung durchgeht, weil sie nicht prüfbar IST: Der
     * Signatur-Schlüssel kommt erst mit der Antwort auf `POST /v3/webhooks`.
     * Polar verlangt darauf 200, sonst wird der Webhook nicht angelegt
     * („WebhookPingFailedException").
     *
     * Die Prüfung ist bewusst eng: NUR `{"event":"PING"}` ohne Nutzer- und
     * Aktivitätskennung. Damit lässt sich über diesen Weg nichts anstoßen —
     * wer unsignierte Pings schickt, bekommt eine 200 und sonst nichts.
     */
    isPing: (request: WebhookRequest): boolean => {
      try {
        const daten = JSON.parse(request.rawBody || '{}') as Record<string, unknown>
        return (
          daten['event'] === 'PING' &&
          daten['user_id'] === undefined &&
          daten['entity_id'] === undefined
        )
      } catch {
        return false
      }
    },

    verify: (request: WebhookRequest): boolean => {
      const secret = this.access.webhookSecret
      // Ohne hinterlegtes Geheimnis wird NICHTS akzeptiert. Die Alternative
      // („noch kein Geheimnis, also durchlassen") wäre ein offener Eingang,
      // der genau so lange offen steht, wie jemand die Einrichtung vergisst.
      if (!secret) return false
      const passed = request.headers['polar-webhook-signature'] ?? ''
      const expected = createHmac('sha256', secret).update(request.rawBody).digest('hex')
      return timingSafeEquals(passed.toLowerCase(), expected)
    },

    parseEvents: (request: WebhookRequest): TrackerEvent[] => {
      let daten: Record<string, unknown>
      try {
        daten = JSON.parse(request.rawBody || '{}') as Record<string, unknown>
      } catch {
        return []
      }
      const kind = String(daten['event'] ?? '')
      const user = daten['user_id']
      const entity = daten['entity_id']
      // Polar schickt auch SLEEP, CONTINUOUS_HEART_RATE und beim Anlegen ein
      // PING. Alles, was keine Übung ist, geht uns nichts an — aber die
      // Antwort bleibt 200, sonst hält Polar die Zustellung für gescheitert
      // und wiederholt sie.
      if (kind !== 'EXERCISE' || user === undefined || entity === undefined) return []
      return [{ externalUser: String(user), externalId: String(entity), kind: 'aktivitaet' }]
    },
  }

  // — Daten holen —

  private async json(path: string, tokens: ProviderTokens): Promise<Record<string, unknown>> {
    const response = await this.fetchJson(`${API}${path}`, {
      headers: { authorization: `Bearer ${tokens.access}`, accept: 'application/json' },
    })
    if (response.status === 401 || response.status === 403) throw new InvalidTokensError()
    if (!response.ok) throw new Error(`Polar antwortete ${response.status} auf ${path}`)
    return (await response.json()) as Record<string, unknown>
  }

  /**
   * Alles auflisten, was Polar gerade vorhält — der Rückfall, wenn eine
   * Zustellung verloren ging.
   *
   * **`seit` wird bewusst NICHT angewandt, und das war einmal ein Fehler.**
   * Der Cursor (`zuletztSyncAm`) läuft in Wanduhrzeit und rückt auch dann vor,
   * wenn ein Abruf nichts fand; die einzige Zeit, die eine Übung mitbringt, ist
   * ihre STARTZEIT. Zwischen beiden liegt bei Polar regelmäßig eine große
   * Lücke: Eine Übung erscheint erst, wenn die Uhr synchronisiert — und dazu
   * muss am Handgelenk die Ergebnisansicht weggeklickt sein, was Stunden
   * dauern kann. Wer in dieser Lücke „Jetzt abrufen" drückt, schiebt den
   * Cursor hinter die Startzeit seiner eigenen Tour, und danach filtert genau
   * dieser Vergleich sie für immer weg. Der Rückfallweg konnte damit das
   * einzige nicht, wofür es ihn gibt: eine verlorene Zustellung nachholen.
   *
   * Nichts zu filtern ist ungefährlich, weil die Grenze ohnehin woanders
   * liegt: `claim` im Kern lehnt jede Aktivität ab, die schon eine
   * Import-Zeile hat — VOR jedem Netzaufruf. Was Polar hier doppelt meldet,
   * kostet einen Datenbank-Zugriff und sonst nichts. Und die Liste ist kurz:
   * Polar hält nur ein begrenztes Fenster vor und kennt keine Historie vor der
   * Registrierung.
   */
  async listNew(tokens: ProviderTokens, _since: string | null): Promise<TrackerEvent[]> {
    const raw = await this.json('/v3/exercises', tokens)
    // Je nach Fassung antwortet Polar mit einer Liste oder mit einem Objekt,
    // das sie unter `exercises` trägt.
    const list = Array.isArray(raw)
      ? raw
      : ((field<unknown[]>(raw, 'exercises') ?? []) as unknown[])
    const events: TrackerEvent[] = []
    for (const entry of list) {
      if (!entry || typeof entry !== 'object') continue
      const exercise = entry as Record<string, unknown>
      const id = field<string | number>(exercise, 'id')
      if (id === undefined) continue
      events.push({
        externalUser: String(tokens.externalUser ?? ''),
        externalId: String(id),
        kind: 'aktivitaet',
      })
    }
    return events
  }

  async fetchTrack(tokens: ProviderTokens, externalId: string): Promise<RawTrack> {
    const exercise = await this.json(`/v3/exercises/${encodeURIComponent(externalId)}`, tokens)

    // `has-route` sagt VOR dem Download, ob es überhaupt eine Route gibt —
    // eine Krafteinheit hat keine, und sie deshalb erst herunterzuladen und am
    // leeren GPX scheitern zu lassen wäre ein Aufruf für nichts.
    if (field<boolean>(exercise, 'has-route') === false) throw new NoRouteError()

    const startMs = startTime(
      field<string>(exercise, 'start-time'),
      Number(field(exercise, 'start-time-utc-offset') ?? 0),
    )
    const durationS = durationToSeconds(field<string>(exercise, 'duration'))
    if (startMs === null || durationS === null)
      throw new Error('Aktivität ohne brauchbare Start- oder Dauerangabe')
    // Dauer null heißt: gestartet und sofort gestoppt. Das ist eine Aussage
    // über die Aktivität und keine Störung — als Fehler geführt liefe sie
    // dreimal durch den Wiederhol-Weg, obwohl sich daran nie etwas ändert.
    if (durationS <= 0) throw new TooSmallError('Aufzeichnung ohne Dauer')

    const response = await this.fetchJson(
      `${API}/v3/exercises/${encodeURIComponent(externalId)}/gpx`,
      {
        headers: { authorization: `Bearer ${tokens.access}`, accept: 'application/gpx+xml' },
      },
    )
    if (response.status === 401 || response.status === 403) throw new InvalidTokensError()
    // 404 auf die GPX-Datei heißt in der Praxis dasselbe wie `has-route: false`
    // — die Doku sagt zu diesem Fall nichts, also fangen wir beide Wege ab.
    if (response.status === 404) throw new NoRouteError()
    if (!response.ok) throw new Error(`GPX-Abruf fehlgeschlagen (${response.status})`)
    const gpx = new Uint8Array(await response.arrayBuffer())

    // Die genauere Sportangabe zuerst: „WATERSPORTS_WATERSKI" trägt mehr als
    // „OTHER", und die Zuordnung im Kern arbeitet auf Textmustern.
    const sport =
      field<string>(exercise, 'detailed-sport-info') ?? field<string>(exercise, 'sport') ?? null

    return {
      format: 'gpx',
      bytes: gpx,
      title: null, // Polar benennt Übungen nicht — den Titel findet die Pipeline
      sport,
      start: new Date(startMs).toISOString(),
      end: new Date(startMs + durationS * 1000).toISOString(),
    }
  }
}
