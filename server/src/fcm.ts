// Versand über die FCM HTTP-v1-API mit einem Dienstkonto.
//
// Warum von Hand und nicht per Firebase-Admin-SDK: Das SDK zieht ein knappes
// Dutzend Pakete mit, von denen wir genau zwei Dinge brauchen — einen
// Access-Token aus dem Dienstkonto und einen POST. Beides steht unten in
// hundert Zeilen und hält den Container klein.
//
// Der Weg ist zweistufig und in dieser Reihenfolge fest:
//   1. Aus dem Dienstkonto ein JWT bauen (RS256, signiert mit dem privaten
//      Schlüssel) und bei Google gegen einen Access-Token tauschen.
//   2. Damit `POST /v1/projects/<id>/messages:send` aufrufen — je Gerät einmal.
//
// Doku: https://firebase.google.com/docs/cloud-messaging/auth-server

import { createSign } from 'node:crypto'
import type { PushMessage, PushTransport, Delivery } from './push.js'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging'

/** Die Netz-Funktion ist injizierbar — Produktion reicht `fetch` herein, Tests Fixtures. */
export type FetchFunction = (url: string, init?: RequestInit) => Promise<Response>

/**
 * Wie lange ein geholter Access-Token benutzt wird.
 *
 * Google gibt ihn für eine Stunde aus; wir werfen ihn nach 55 Minuten weg. Die
 * fünf Minuten Sicherheitsabstand sind kein Aberglaube: Zwischen „Token holen"
 * und „Nachricht zustellen" liegt ein Netzweg, und ein Token, der genau
 * dazwischen abläuft, erzeugt einen 401, der wie ein Konfigurationsfehler
 * aussieht.
 */
const TOKEN_TTL_MS = 55 * 60 * 1000

interface ServiceAccount {
  projectId: string
  clientEmail: string
  privateKey: string
}

/**
 * Das Dienstkonto-JSON lesen und auf die drei Felder eindampfen, die zählen.
 *
 * Wirft mit einer Meldung, die beim EINRICHTEN hilft — das ist der einzige
 * Moment, in dem sie jemand liest. „Unexpected token" aus `JSON.parse` sagt
 * nichts darüber, dass eine Base64-Zeile beim Kopieren abgeschnitten wurde.
 */
export function parseServiceAccount(json: string): ServiceAccount {
  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(json) as Record<string, unknown>
  } catch {
    throw new Error(
      'MAPTALE_FCM_SERVICE_ACCOUNT ist kein lesbares JSON (Base64 vollständig kopiert?)',
    )
  }
  const projectId = typeof obj.project_id === 'string' ? obj.project_id : null
  const clientEmail = typeof obj.client_email === 'string' ? obj.client_email : null
  const privateKey = typeof obj.private_key === 'string' ? obj.private_key : null
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('MAPTALE_FCM_SERVICE_ACCOUNT fehlt project_id, client_email oder private_key')
  }
  return { projectId, clientEmail, privateKey }
}

/** Base64url ohne Polsterung — die Kodierung, die JWT vorschreibt. */
function base64url(data2: string | Buffer): string {
  return Buffer.from(data2)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/**
 * Ein signiertes JWT für den Token-Tausch.
 *
 * `\n` im privaten Schlüssel wird ersetzt, weil er durch Umgebungsvariablen
 * und JSON-Kopieren regelmäßig als zwei Zeichen ankommt statt als Zeilenumbruch
 * — dann scheitert das Signieren mit einer Meldung über PEM-Kopfzeilen, und
 * niemand sucht die Ursache in einem Backslash.
 */
function buildJwt(account: ServiceAccount, nowSec: number): string {
  const header = base64url(JSON.stringify({ alg: 'RS256', kind: 'JWT' }))
  const body2 = base64url(
    JSON.stringify({
      iss: account.clientEmail,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: nowSec,
      exp: nowSec + 3600,
    }),
  )
  const signature = createSign('RSA-SHA256')
    .update(`${header}.${body2}`)
    .sign(account.privateKey.replace(/\\n/g, '\n'))
  return `${header}.${body2}.${base64url(signature)}`
}

/**
 * Ist die Adresse endgültig tot — oder ist es unser Problem?
 *
 * **Nur `UNREGISTERED` bedeutet „Gerät weg".** Das ist keine Feinheit, sondern
 * der Unterschied zwischen einem verwaisten Eintrag und einem Totalausfall:
 * Googles Fehlertabelle führt `INVALID_ARGUMENT` (400), `SENDER_ID_MISMATCH`
 * (403) und `THIRD_PARTY_AUTH_ERROR` (401) allesamt als *sender-side
 * configuration* — als Fehler bei UNS. Wer darauf löscht, räumt bei der ersten
 * kaputten Nutzlast die Geräte ALLER Konten ab. Und es heilt nicht: Die Apps
 * registrieren sich neu, der nächste Versand löscht wieder, und sichtbar ist
 * nur, dass Push „nicht mehr geht".
 *
 * Die Asymmetrie entscheidet: Ein behaltener toter Eintrag kostet einen
 * vergeblichen Aufruf je Meldung. Ein gelöschter lebender kostet das Feature.
 *
 * Gelesen wird der STRUKTURIERTE Code aus dem Antwortkörper
 * (`error.details[].errorCode`), nicht der HTTP-Status: Die v1-API kann
 * `UNREGISTERED` auch mit 400 melden, wenn die Adresse formal nicht mehr
 * geparst werden kann. Der Status 404 bleibt als Rückfall, falls der Körper
 * fehlt oder unlesbar ist.
 */
export function isUnregistered(status: number, payload: string): boolean {
  try {
    const data2 = JSON.parse(payload) as {
      error?: { status?: string; details?: Array<{ errorCode?: string }> }
    }
    if (data2.error?.details?.some((d) => d.errorCode === 'UNREGISTERED')) return true
    // Ein ausdrücklich genannter anderer Code ist eine klare Aussage — dann
    // NICHT löschen, auch wenn der Status zufällig 404 ist.
    if (data2.error?.details?.some((d) => typeof d.errorCode === 'string')) return false
  } catch {
    // Kein oder kaputtes JSON: Es bleibt beim Status.
  }
  return status === 404
}

export class FcmPush implements PushTransport {
  readonly ready = true
  private readonly account: ServiceAccount
  private accessToken2: { token: string; expiresAtMs: number } | null = null

  constructor(
    serviceAccountJson: string,
    private readonly fetchJson: FetchFunction = fetch,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.account = parseServiceAccount(serviceAccountJson)
  }

  /** Access-Token, gecacht bis kurz vor Ablauf. */
  private async accessToken(): Promise<string> {
    const now = this.now()
    if (this.accessToken2 && this.accessToken2.expiresAtMs > now) return this.accessToken2.token
    const response = await this.fetchJson(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: buildJwt(this.account, Math.floor(now / 1000)),
      }).toString(),
    })
    if (!response.ok) {
      throw new Error(`FCM-Anmeldung fehlgeschlagen (${response.status}): ${await response.text()}`)
    }
    const data2 = (await response.json()) as { access_token?: string }
    if (!data2.access_token) throw new Error('FCM-Anmeldung ohne access_token')
    this.accessToken2 = { token: data2.access_token, expiresAtMs: now + TOKEN_TTL_MS }
    return data2.access_token
  }

  /**
   * Eine Nachricht an mehrere Geräte.
   *
   * Je Gerät ein Aufruf — den Sammelversand („multicast") gibt es in der
   * v1-API nicht mehr, und die Zahl der Geräte eines Kontos liegt bei eins bis
   * drei. Nacheinander und nicht nebenläufig: Bei drei Aufrufen spart Parallelität
   * nichts Messbares und kostet die Auskunft, welcher Token abgelehnt wurde.
   *
   * Ein einzelner Fehlschlag beendet den Lauf NICHT — sonst bekäme das zweite
   * Gerät nichts mehr, weil beim ersten die App deinstalliert wurde.
   */
  async send(tokens: readonly string[], message: PushMessage): Promise<Delivery[]> {
    const accessToken2 = await this.accessToken()
    const url = `https://fcm.googleapis.com/v1/projects/${this.account.projectId}/messages:send`
    const results: Delivery[] = []
    for (const token of tokens) {
      const response = await this.fetchJson(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${accessToken2}`, 'content-type': 'application/json' },
        // NUR `data`, keine `notification`: Die App baut die Meldung selbst.
        // Eine `notification` zeigte Android ohne Zutun der App an — und dann
        // stünde der Text auf dem Sperrbildschirm, obwohl die Nachricht
        // absichtlich nichts über die Tour verrät. Sie käme außerdem am
        // Quittieren vorbei (`…/imports/gesehen`), und die Meldung stünde
        // doppelt, sobald der periodische Abruf sie ebenfalls zeigt.
        //
        // `priority: high` ist bei einer Datennachricht Pflicht, wenn sie ein
        // schlafendes Gerät wecken soll — ohne sie liefert Android sie im
        // nächsten Wartungsfenster aus, also womöglich Stunden später.
        body: JSON.stringify({
          message: {
            // `fid` und NICHT `token`: FCM hat den Registrierungs-Token
            // zugunsten der Firebase-Installations-ID abgelöst (SDK 25.1.0,
            // Juni 2026). Die v1-API führt `token` seither ausdrücklich als
            // „Deprecated: Use `fid` instead" — es nimmt in der Übergangszeit
            // ohnehin eine FID entgegen, aber ein neues Feature gegen ein
            // abgekündigtes Feld zu bauen hieße, den Umzug später ein zweites
            // Mal zu bezahlen. Was die App schickt, IST eine FID.
            fid: token,
            data: { type: message.type, tourId: message.tourId, importId: message.importId },
            android: { priority: 'high' },
          },
        }),
      })
      if (response.ok) {
        results.push({ token, unregistered: false })
        continue
      }
      results.push({ token, unregistered: isUnregistered(response.status, await response.text()) })
    }
    return results
  }
}
