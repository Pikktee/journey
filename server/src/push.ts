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
  benutzerId: string
  platform: Platform
  token: string
  angelegtAm: string
  zuletztGesehenAm: string
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
  abgemeldet: boolean
}

/**
 * Der Versandweg hinter einem schmalen Interface — dieselbe Linie wie
 * `MailTransport`, `Geocoder`, `WeatherSource`: Die Routen kennen nur das
 * Interface, Produktion reicht `FcmPush` herein, Tests eine Fassung ohne Netz.
 */
export interface PushTransport {
  /** Ohne Dienstkonto ist Push aus — der Dienst fragt das, bevor er Geräte sucht. */
  readonly einsatzbereit: boolean
  sende(tokens: readonly string[], nachricht: PushMessage): Promise<Delivery[]>
}

/** Dev-Versand: schreibt ins Log, statt zu senden. Kein Firebase-Projekt nötig. */
export class ConsolePush implements PushTransport {
  readonly einsatzbereit = true
  constructor(private readonly log: (zeile: string) => void = console.log) {}
  async sende(tokens: readonly string[], nachricht: PushMessage): Promise<Delivery[]> {
    this.log(`\n🔔 Push (${nachricht.type}, Tour ${nachricht.tourId}) an ${tokens.length} Gerät(e)`)
    return tokens.map((token) => ({ token, abgemeldet: false }))
  }
}

interface GeraeteZeile {
  id: string
  user_id: string
  platform: Platform
  token: string
  created_at: string
  last_seen_at: string
}

function zuGeraet(z: GeraeteZeile): PushDevice {
  return {
    id: z.id,
    benutzerId: z.user_id,
    platform: z.platform,
    token: z.token,
    angelegtAm: z.created_at,
    zuletztGesehenAm: z.last_seen_at,
  }
}

export class PushService {
  constructor(
    private readonly db: Db,
    private readonly versand: PushTransport | null,
  ) {}

  /** Ohne Versandweg gibt es nichts zu registrieren — die App erfährt das und lässt es. */
  get einsatzbereit(): boolean {
    return this.versand?.einsatzbereit === true
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
  registriere(
    benutzerId: string,
    token: string,
    plattform: Platform,
    appTokenId: string | null,
  ): PushDevice {
    const jetzt = new Date().toISOString()
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
      .run(newTourId().replace('t_', 'g_'), benutzerId, appTokenId, plattform, token, jetzt, jetzt)
    return zuGeraet(
      this.db.prepare('SELECT * FROM push_devices WHERE token = ?').get(token) as GeraeteZeile,
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
  entferne(benutzerId: string, token: string): boolean {
    return (
      this.db
        .prepare('DELETE FROM push_devices WHERE user_id = ? AND token = ?')
        .run(benutzerId, token).changes > 0
    )
  }

  /** Alle Geräte eines Kontos — für den Versand und für den Datenexport. */
  geraete(benutzerId: string): PushDevice[] {
    return (
      this.db
        .prepare('SELECT * FROM push_devices WHERE user_id = ? ORDER BY created_at DESC')
        .all(benutzerId) as GeraeteZeile[]
    ).map(zuGeraet)
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
  async melde(benutzerId: string, nachricht: PushMessage): Promise<number> {
    if (!this.versand?.einsatzbereit) return 0
    const tokens = this.geraete(benutzerId).map((g) => g.token)
    if (!tokens.length) return 0
    let zustellungen: Delivery[]
    try {
      zustellungen = await this.versand.sende(tokens, nachricht)
    } catch {
      return 0
    }
    const abgemeldet = zustellungen.filter((z) => z.abgemeldet).map((z) => z.token)
    if (abgemeldet.length) {
      const loesche = this.db.prepare('DELETE FROM push_devices WHERE token = ?')
      this.db.transaction(() => abgemeldet.forEach((t) => loesche.run(t)))()
    }
    return zustellungen.length - abgemeldet.length
  }
}
