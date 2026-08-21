// Push-Benachrichtigungen: welche Geräte es gibt und was an sie geht.
//
// „Deine Tour ist fertig" ist der Moment, in dem die Tracker-Anbindung
// überhaupt sichtbar wird — er gehört nicht in ein Abholintervall. Der
// periodische Abruf der App bleibt trotzdem bestehen: Er fängt Geräte ohne
// Play Services, von der Herstellersoftware verschluckte Nachrichten und die
// Zeit zwischen „Konto verknüpft" und „Push-Token registriert".
//
// **Die Nachricht trägt keine Inhalte, nur einen Anlass.** `{ type:
// 'import-finished', tourId }` — den Rest holt die App über die vorhandenen
// Routen. Ein Push mit Titel und Ort der Tour liefe über Googles Server und
// läge auf dem Sperrbildschirm; beides ist unnötig, wenn ein Wecken genügt.
// FCM ist nicht Ende-zu-Ende-verschlüsselt.

import type { Db } from './db.js'
import { newTourId } from './ids.js'

export type Platform = 'android' | 'ios'

/** Ein registriertes Gerät — der Token ist die Adresse, alles andere Herkunft. */
export interface PushDevice {
  id: string
  userId: string
  platform: Platform
  token: string
  createdAt: string
  lastSeenAt: string
}

/**
 * Was verschickt wird: ein Anlass plus die Kennungen, mit denen die App
 * nachfragen kann. Bewusst nur Strings — FCM-Datennachrichten kennen nichts
 * anderes, und ein Feld, das unterwegs zu `"undefined"` wird, ist schlimmer
 * als ein fehlendes.
 */
export interface PushMessage {
  type: 'import-finished'
  tourId: string
  importId: string
}

/**
 * Ergebnis eines Versands je Gerät. `abgemeldet` ist die einzige Auskunft, die
 * der Dienst wirklich braucht: Ein Token, den FCM ablehnt, gehört gelöscht —
 * ein Gerätetoken ohne Gerät ist kein Vorfall, sondern eine deinstallierte App.
 */
export interface Delivery {
  token: string
  unregistered: boolean
}

/**
 * Der Versandweg hinter einem schmalen Interface — dieselbe Linie wie
 * `MailTransport`, `Geocoder`, `WeatherSource`: Die Routen kennen nur das
 * Interface, Produktion reicht `FcmPush` herein, Tests eine Fassung ohne Netz.
 */
export interface PushTransport {
  /** Ohne Dienstkonto ist Push aus — der Dienst fragt das, bevor er Geräte sucht. */
  readonly ready: boolean
  send(tokens: readonly string[], message: PushMessage): Promise<Delivery[]>
}

/** Dev-Versand: schreibt ins Log, statt zu senden. Kein Firebase-Projekt nötig. */
export class ConsolePush implements PushTransport {
  readonly ready = true
  constructor(private readonly log: (row: string) => void = console.log) {}
  async send(tokens: readonly string[], message: PushMessage): Promise<Delivery[]> {
    this.log(`\n🔔 Push (${message.type}, Tour ${message.tourId}) an ${tokens.length} Gerät(e)`)
    return tokens.map((token) => ({ token, unregistered: false }))
  }
}

interface DeviceRow {
  id: string
  user_id: string
  platform: Platform
  token: string
  created_at: string
  last_seen_at: string
}

function toDevice(z: DeviceRow): PushDevice {
  return {
    id: z.id,
    userId: z.user_id,
    platform: z.platform,
    token: z.token,
    createdAt: z.created_at,
    lastSeenAt: z.last_seen_at,
  }
}

export class PushService {
  constructor(
    private readonly db: Db,
    private readonly transport: PushTransport | null,
  ) {}

  /** Ohne Versandweg gibt es nichts zu registrieren — die App erfährt das und lässt es. */
  get ready(): boolean {
    return this.transport?.ready === true
  }

  /**
   * Ein Gerät anmelden — oder seine Zeile umschreiben.
   *
   * UPSERT und nicht INSERT: Der Token benennt eine Installation. Er wandert
   * mit dem Gerät, nicht mit dem Konto — meldet sich dort ein anderes Konto an,
   * MUSS die Zeile mitwandern, sonst bekäme der Vorbesitzer weiter Meldungen
   * über fremde Touren. FCM vergibt denselben Token außerdem nach einer
   * Neuinstallation erneut, und beim Erneuern („token refresh") schickt die App
   * ihn ungefragt noch einmal: Beides ist hier ein UPDATE, kein Fehlerfall.
   */
  register(
    userId: string,
    token: string,
    platform2: Platform,
    appTokenId: string | null,
  ): PushDevice {
    const now = new Date().toISOString()
    this.db
      .prepare(
        `INSERT INTO push_devices (id, user_id, token_id, platform, token, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(token) DO UPDATE SET
           user_id = excluded.user_id,
           token_id = excluded.token_id,
           platform = excluded.platform,
           last_seen_at = excluded.last_seen_at`,
      )
      .run(newTourId().replace('t_', 'g_'), userId, appTokenId, platform2, token, now, now)
    return toDevice(
      this.db.prepare('SELECT * FROM push_devices WHERE token = ?').get(token) as DeviceRow,
    )
  }

  /**
   * Ein Gerät abmelden.
   *
   * Über den TOKEN und nicht über die ID: Die App kennt ihren Token, eine
   * Zeilen-ID hat sie nie gesehen. Die Benutzer-ID steht in der Bedingung und
   * nicht in einer Prüfung davor — sonst läge zwischen „gehört mir?" und dem
   * DELETE eine Lücke.
   */
  remove(userId: string, token: string): boolean {
    return (
      this.db.prepare('DELETE FROM push_devices WHERE user_id = ? AND token = ?').run(userId, token)
        .changes > 0
    )
  }

  /** Alle Geräte eines Kontos — für den Versand und für den Datenexport. */
  devices(userId: string): PushDevice[] {
    return (
      this.db
        .prepare('SELECT * FROM push_devices WHERE user_id = ? ORDER BY created_at DESC')
        .all(userId) as DeviceRow[]
    ).map(toDevice)
  }

  /**
   * Eine Meldung an alle Geräte eines Kontos.
   *
   * Wirft NICHT: Ein Push ist die Zugabe zu einer Arbeit, die längst getan ist
   * — die Tour liegt fertig im Konto, ob Google sie meldet oder nicht. Ein
   * Fehler hier darf den Importlauf nicht kippen, und der periodische Abruf der
   * App holt die Meldung ohnehin nach.
   *
   * Abgelehnte Tokens werden gelöscht, nicht protokolliert (s. `Delivery`).
   */
  async notify(userId: string, message: PushMessage): Promise<number> {
    if (!this.transport?.ready) return 0
    const tokens = this.devices(userId).map((g) => g.token)
    if (!tokens.length) return 0
    let deliveries: Delivery[]
    try {
      deliveries = await this.transport.send(tokens, message)
    } catch {
      return 0
    }
    const unregistered = deliveries.filter((z) => z.unregistered).map((z) => z.token)
    if (unregistered.length) {
      const del = this.db.prepare('DELETE FROM push_devices WHERE token = ?')
      this.db.transaction(() => unregistered.forEach((t) => del.run(t)))()
    }
    return deliveries.length - unregistered.length
  }
}
