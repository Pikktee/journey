// Push-Benachrichtigungen: welche Geräte es gibt und was an sie geht.
//
// „Deine Tour ist fertig" ist der Moment, in dem die Tracker-Anbindung
// überhaupt sichtbar wird — er gehört nicht in ein Abholintervall. Der
// periodische Abruf der App bleibt trotzdem bestehen: Er fängt Geräte ohne
// Play Services, von der Herstellersoftware verschluckte Nachrichten und die
// Zeit zwischen „Konto verknüpft" und „Push-Token registriert".
//
// **Die Nachricht trägt keine Inhalte, nur einen Anlass.** `{ typ:
// 'import-fertig', tourId }` — den Rest holt die App über die vorhandenen
// Routen. Ein Push mit Titel und Ort der Tour liefe über Googles Server und
// läge auf dem Sperrbildschirm; beides ist unnötig, wenn ein Wecken genügt.
// FCM ist nicht Ende-zu-Ende-verschlüsselt.

import type { Db } from './db.js'
import { neueTourId } from './ids.js'

export type Plattform = 'android' | 'ios'

/** Ein registriertes Gerät — der Token ist die Adresse, alles andere Herkunft. */
export interface PushGeraet {
  id: string
  benutzerId: string
  plattform: Plattform
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
export interface PushNachricht {
  typ: 'import-fertig'
  tourId: string
  importId: string
}

/**
 * Ergebnis eines Versands je Gerät. `abgemeldet` ist die einzige Auskunft, die
 * der Dienst wirklich braucht: Ein Token, den FCM ablehnt, gehört gelöscht —
 * ein Gerätetoken ohne Gerät ist kein Vorfall, sondern eine deinstallierte App.
 */
export interface Zustellung {
  token: string
  abgemeldet: boolean
}

/**
 * Der Versandweg hinter einem schmalen Interface — dieselbe Linie wie
 * `MailVersand`, `Geocoder`, `WetterQuelle`: Die Routen kennen nur das
 * Interface, Produktion reicht `FcmPush` herein, Tests eine Fassung ohne Netz.
 */
export interface PushVersand {
  /** Ohne Dienstkonto ist Push aus — der Dienst fragt das, bevor er Geräte sucht. */
  readonly einsatzbereit: boolean
  sende(tokens: readonly string[], nachricht: PushNachricht): Promise<Zustellung[]>
}

/** Dev-Versand: schreibt ins Log, statt zu senden. Kein Firebase-Projekt nötig. */
export class KonsolePush implements PushVersand {
  readonly einsatzbereit = true
  constructor(private readonly log: (zeile: string) => void = console.log) {}
  async sende(tokens: readonly string[], nachricht: PushNachricht): Promise<Zustellung[]> {
    this.log(`\n🔔 Push (${nachricht.typ}, Tour ${nachricht.tourId}) an ${tokens.length} Gerät(e)`)
    return tokens.map((token) => ({ token, abgemeldet: false }))
  }
}

interface GeraeteZeile {
  id: string
  benutzer_id: string
  plattform: Plattform
  token: string
  angelegt_am: string
  zuletzt_gesehen_am: string
}

function zuGeraet(z: GeraeteZeile): PushGeraet {
  return {
    id: z.id,
    benutzerId: z.benutzer_id,
    plattform: z.plattform,
    token: z.token,
    angelegtAm: z.angelegt_am,
    zuletztGesehenAm: z.zuletzt_gesehen_am,
  }
}

export class PushDienst {
  constructor(
    private readonly db: Db,
    private readonly versand: PushVersand | null,
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
  registriere(benutzerId: string, token: string, plattform: Plattform, appTokenId: string | null): PushGeraet {
    const jetzt = new Date().toISOString()
    this.db
      .prepare(
        `INSERT INTO push_geraete (id, benutzer_id, token_id, plattform, token, angelegt_am, zuletzt_gesehen_am)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(token) DO UPDATE SET
           benutzer_id = excluded.benutzer_id,
           token_id = excluded.token_id,
           plattform = excluded.plattform,
           zuletzt_gesehen_am = excluded.zuletzt_gesehen_am`,
      )
      .run(neueTourId().replace('t_', 'g_'), benutzerId, appTokenId, plattform, token, jetzt, jetzt)
    return zuGeraet(this.db.prepare('SELECT * FROM push_geraete WHERE token = ?').get(token) as GeraeteZeile)
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
    return this.db.prepare('DELETE FROM push_geraete WHERE benutzer_id = ? AND token = ?').run(benutzerId, token)
      .changes > 0
  }

  /** Alle Geräte eines Kontos — für den Versand und für den Datenexport. */
  geraete(benutzerId: string): PushGeraet[] {
    return (
      this.db
        .prepare('SELECT * FROM push_geraete WHERE benutzer_id = ? ORDER BY angelegt_am DESC')
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
   * Abgelehnte Tokens werden gelöscht, nicht protokolliert (s. `Zustellung`).
   */
  async melde(benutzerId: string, nachricht: PushNachricht): Promise<number> {
    if (!this.versand?.einsatzbereit) return 0
    const tokens = this.geraete(benutzerId).map((g) => g.token)
    if (!tokens.length) return 0
    let zustellungen: Zustellung[]
    try {
      zustellungen = await this.versand.sende(tokens, nachricht)
    } catch {
      return 0
    }
    const abgemeldet = zustellungen.filter((z) => z.abgemeldet).map((z) => z.token)
    if (abgemeldet.length) {
      const loesche = this.db.prepare('DELETE FROM push_geraete WHERE token = ?')
      this.db.transaction(() => abgemeldet.forEach((t) => loesche.run(t)))()
    }
    return zustellungen.length - abgemeldet.length
  }
}
