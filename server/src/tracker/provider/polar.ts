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
// explicitly revoked"), deshalb kein `erneuereTokens` und kein `laeuftAb`.
//
// API-Doku: https://www.polar.com/accesslink-api/

import { createHmac } from 'node:crypto'
import type { AnbieterZugang } from '../../config.js'
import { gleichSicher } from '../krypto.js'
import {
  OhneRouteFehler,
  TokensUngueltigFehler,
  type ProviderTokens,
  type RohTrack,
  type TrackerEreignis,
  type TrackerProvider,
  type WebhookAnfrage,
} from '../vertrag.js'

const AUTORISIERUNG = 'https://flow.polar.com/oauth2/authorization'
const TOKEN = 'https://polarremote.com/v2/oauth2/token'
const API = 'https://www.polaraccesslink.com'

/** Die Netz-Funktion ist injizierbar — Produktion reicht `fetch` herein, Tests Fixtures. */
export type HolFunktion = (url: string, init?: RequestInit) => Promise<Response>

/**
 * Polar schreibt seine JSON-Felder uneinheitlich: Die Nutzer-Ressource nutzt
 * Bindestriche (`polar-user-id`, `member-id`), bei den Übungen finden sich je
 * nach Doku-Fassung `start-time` UND `start_time`. Beide Schreibweisen zu
 * lesen kostet drei Zeilen; sich für eine zu entscheiden hieße, es beim ersten
 * echten Training herauszufinden — und dann ist die Ursache am schwersten zu
 * finden, weil der Fehler wie „Aktivität ohne Route" aussieht.
 */
function feld<T = unknown>(objekt: Record<string, unknown>, name: string): T | undefined {
  const mitStrich = objekt[name]
  if (mitStrich !== undefined) return mitStrich as T
  return objekt[name.replace(/-/g, '_')] as T | undefined
}

/**
 * ISO-8601-Dauer („PT2H44M30S") in Sekunden.
 *
 * Nur Stunden/Minuten/Sekunden — Tage und Monate kommen bei einer
 * Trainingsdauer nicht vor, und ein vollständiger Parser wäre Beiwerk.
 */
export function dauerZuSekunden(dauer: string | undefined): number | null {
  if (!dauer) return null
  const m = /^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(dauer.trim())
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
export function startZeitpunkt(startTime: string | undefined, versatzMinuten: number | undefined): number | null {
  if (!startTime) return null
  const alsUtc = Date.parse(/[Zz]|[+-]\d{2}:\d{2}$/.test(startTime) ? startTime : `${startTime}Z`)
  if (!Number.isFinite(alsUtc)) return null
  const versatz = Number.isFinite(versatzMinuten) ? (versatzMinuten as number) : 0
  return alsUtc - versatz * 60_000
}

export class PolarProvider implements TrackerProvider {
  readonly id = 'polar' as const
  readonly konfiguriert: boolean

  constructor(
    private readonly zugang: AnbieterZugang,
    private readonly hol: HolFunktion = fetch,
  ) {
    // Ohne Client-ID/-Secret kann der Adapter nicht arbeiten. Das
    // Webhook-Geheimnis fehlt anfangs absichtlich — es entsteht erst beim
    // Registrieren des Webhooks; ohne es werden Zustellungen abgewiesen, aber
    // Verknüpfen und manuelles Abrufen funktionieren.
    this.konfiguriert = Boolean(zugang.clientId && zugang.clientSecret)
  }

  // — OAuth —

  autorisierungsUrl(zustand: string, redirectUri: string): string {
    const p = new URLSearchParams({
      response_type: 'code',
      client_id: this.zugang.clientId ?? '',
      redirect_uri: redirectUri,
      state: zustand,
    })
    return `${AUTORISIERUNG}?${p.toString()}`
  }

  async tauscheCode(code: string, redirectUri: string): Promise<ProviderTokens> {
    const basic = Buffer.from(`${this.zugang.clientId}:${this.zugang.clientSecret}`).toString('base64')
    const antwort = await this.hol(TOKEN, {
      method: 'POST',
      headers: {
        authorization: `Basic ${basic}`,
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json;charset=UTF-8',
      },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }).toString(),
    })
    if (!antwort.ok) throw new Error(`Token-Tausch abgelehnt (${antwort.status})`)
    const json = (await antwort.json()) as { access_token?: string; x_user_id?: number | string }
    if (!json.access_token || json.x_user_id === undefined) throw new Error('Token-Antwort ohne Zugang oder Nutzerkennung')
    return {
      zugriff: json.access_token,
      // Diese Kennung ist der Zuordnungsweg jedes späteren Webhooks: Sie steht
      // dort als `user_id`. „API user-id und polar-user-id sind austauschbar."
      externerNutzer: String(json.x_user_id),
      // Polar-Tokens laufen nicht ab — ein `laeuftAb` hier würde den Kern
      // grundlos in die Erneuerung schicken, die es bei Polar gar nicht gibt.
      laeuftAb: null,
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
  async nachVerknuepfung(tokens: ProviderTokens): Promise<ProviderTokens> {
    const antwort = await this.hol(`${API}/v3/users`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${tokens.zugriff}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({ 'member-id': tokens.externerNutzer }),
    })
    // 409 = „User already registered": beim Neuverbinden der Normalfall und
    // ausdrücklich KEIN Fehler. Ihn zu werfen machte jedes zweite Verbinden
    // unmöglich.
    if (!antwort.ok && antwort.status !== 409) {
      throw new Error(`Registrierung bei Polar fehlgeschlagen (${antwort.status})`)
    }
    return tokens
  }

  /** Beim Trennen: Autorisierung beim Anbieter aufheben (204 erwartet). */
  async trenne(tokens: ProviderTokens): Promise<void> {
    if (!tokens.externerNutzer) return
    const antwort = await this.hol(`${API}/v3/users/${encodeURIComponent(tokens.externerNutzer)}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${tokens.zugriff}` },
    })
    // 204 ist der Erfolg, 404 heißt „war schon weg" — beides ist erledigt.
    if (!antwort.ok && antwort.status !== 404) {
      throw new Error(`Abmelden bei Polar fehlgeschlagen (${antwort.status})`)
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
    istPing: (anfrage: WebhookAnfrage): boolean => {
      try {
        const daten = JSON.parse(anfrage.rohBody || '{}') as Record<string, unknown>
        return daten['event'] === 'PING' && daten['user_id'] === undefined && daten['entity_id'] === undefined
      } catch {
        return false
      }
    },

    verifiziere: (anfrage: WebhookAnfrage): boolean => {
      const geheimnis = this.zugang.webhookGeheimnis
      // Ohne hinterlegtes Geheimnis wird NICHTS akzeptiert. Die Alternative
      // („noch kein Geheimnis, also durchlassen") wäre ein offener Eingang,
      // der genau so lange offen steht, wie jemand die Einrichtung vergisst.
      if (!geheimnis) return false
      const mitgeschickt = anfrage.kopfzeilen['polar-webhook-signature'] ?? ''
      const erwartet = createHmac('sha256', geheimnis).update(anfrage.rohBody).digest('hex')
      return gleichSicher(mitgeschickt.toLowerCase(), erwartet)
    },

    parseEreignisse: (anfrage: WebhookAnfrage): TrackerEreignis[] => {
      let daten: Record<string, unknown>
      try {
        daten = JSON.parse(anfrage.rohBody || '{}') as Record<string, unknown>
      } catch {
        return []
      }
      const art = String(daten['event'] ?? '')
      const nutzer = daten['user_id']
      const entitaet = daten['entity_id']
      // Polar schickt auch SLEEP, CONTINUOUS_HEART_RATE und beim Anlegen ein
      // PING. Alles, was keine Übung ist, geht uns nichts an — aber die
      // Antwort bleibt 200, sonst hält Polar die Zustellung für gescheitert
      // und wiederholt sie.
      if (art !== 'EXERCISE' || nutzer === undefined || entitaet === undefined) return []
      return [{ externerNutzer: String(nutzer), externeId: String(entitaet), art: 'aktivitaet' }]
    },
  }

  // — Daten holen —

  private async json(pfad: string, tokens: ProviderTokens): Promise<Record<string, unknown>> {
    const antwort = await this.hol(`${API}${pfad}`, {
      headers: { authorization: `Bearer ${tokens.zugriff}`, accept: 'application/json' },
    })
    if (antwort.status === 401 || antwort.status === 403) throw new TokensUngueltigFehler()
    if (!antwort.ok) throw new Error(`Polar antwortete ${antwort.status} auf ${pfad}`)
    return (await antwort.json()) as Record<string, unknown>
  }

  /**
   * Aktivitäten seit `seit` auflisten — der Rückfall, wenn eine Zustellung
   * verloren ging.
   *
   * Polar hält hier nur ein begrenztes Fenster vor; das ist der Preis dafür,
   * dass es überhaupt einen Weg zurück gibt. Für den Normalfall bleibt der
   * Webhook zuständig.
   */
  async listeNeue(tokens: ProviderTokens, seit: string | null): Promise<TrackerEreignis[]> {
    const roh = await this.json('/v3/exercises', tokens)
    // Je nach Fassung antwortet Polar mit einer Liste oder mit einem Objekt,
    // das sie unter `exercises` trägt.
    const liste = Array.isArray(roh) ? roh : ((feld<unknown[]>(roh, 'exercises') ?? []) as unknown[])
    const seitMs = seit ? Date.parse(seit) : NaN
    const ereignisse: TrackerEreignis[] = []
    for (const eintrag of liste) {
      if (!eintrag || typeof eintrag !== 'object') continue
      const uebung = eintrag as Record<string, unknown>
      const id = feld<string | number>(uebung, 'id')
      if (id === undefined) continue
      if (Number.isFinite(seitMs)) {
        const start = startZeitpunkt(
          feld<string>(uebung, 'start-time'),
          Number(feld(uebung, 'start-time-utc-offset') ?? 0),
        )
        if (start !== null && start <= seitMs) continue
      }
      ereignisse.push({
        externerNutzer: String(tokens.externerNutzer ?? ''),
        externeId: String(id),
        art: 'aktivitaet',
      })
    }
    return ereignisse
  }

  async holeTrack(tokens: ProviderTokens, externeId: string): Promise<RohTrack> {
    const uebung = await this.json(`/v3/exercises/${encodeURIComponent(externeId)}`, tokens)

    // `has-route` sagt VOR dem Download, ob es überhaupt eine Route gibt —
    // eine Krafteinheit hat keine, und sie deshalb erst herunterzuladen und am
    // leeren GPX scheitern zu lassen wäre ein Aufruf für nichts.
    if (feld<boolean>(uebung, 'has-route') === false) throw new OhneRouteFehler()

    const startMs = startZeitpunkt(
      feld<string>(uebung, 'start-time'),
      Number(feld(uebung, 'start-time-utc-offset') ?? 0),
    )
    const dauerS = dauerZuSekunden(feld<string>(uebung, 'duration'))
    if (startMs === null || dauerS === null) throw new Error('Aktivität ohne brauchbare Start- oder Dauerangabe')

    const antwort = await this.hol(`${API}/v3/exercises/${encodeURIComponent(externeId)}/gpx`, {
      headers: { authorization: `Bearer ${tokens.zugriff}`, accept: 'application/gpx+xml' },
    })
    if (antwort.status === 401 || antwort.status === 403) throw new TokensUngueltigFehler()
    // 404 auf die GPX-Datei heißt in der Praxis dasselbe wie `has-route: false`
    // — die Doku sagt zu diesem Fall nichts, also fangen wir beide Wege ab.
    if (antwort.status === 404) throw new OhneRouteFehler()
    if (!antwort.ok) throw new Error(`GPX-Abruf fehlgeschlagen (${antwort.status})`)
    const gpx = new Uint8Array(await antwort.arrayBuffer())

    // Die genauere Sportangabe zuerst: „WATERSPORTS_WATERSKI" trägt mehr als
    // „OTHER", und die Zuordnung im Kern arbeitet auf Textmustern.
    const sportart =
      feld<string>(uebung, 'detailed-sport-info') ?? feld<string>(uebung, 'sport') ?? null

    return {
      format: 'gpx',
      bytes: gpx,
      titel: null, // Polar benennt Übungen nicht — den Titel findet die Pipeline
      sportart,
      start: new Date(startMs).toISOString(),
      ende: new Date(startMs + dauerS * 1000).toISOString(),
    }
  }
}
