// Verknüpfungen, Tokens und Importe — der anbieterblinde Kern.
//
// Alles, was für JEDEN Anbieter gleich ist, steht hier genau einmal: Tokens
// verschlüsselt ablegen und erneuern, Webhook-Zustellungen einem Konto
// zuordnen, Importe protokollieren. Ein Adapter kennt davon nichts.

import type { Db } from '../db.js'
import { neueTourId } from '../ids.js'
import { entschluessele, verschluessele } from './krypto.js'
import type { ProviderTokens, TrackerAnbieter, TrackerProvider } from './vertrag.js'
import { TokensUngueltigFehler } from './vertrag.js'

export type VerknuepfungsStatus = 'aktiv' | 'abgelaufen' | 'getrennt'
export type ImportStatus = 'wartet' | 'laeuft' | 'fertig' | 'fehler' | 'uebersprungen'

interface VerknuepfungsZeile {
  id: string
  benutzer_id: string
  anbieter: string
  externer_nutzer: string | null
  tokens: string
  laeuft_ab_am: string | null
  status: VerknuepfungsStatus
  verbunden_am: string
  zuletzt_sync_am: string | null
  letzter_fehler: string | null
}

export interface Verknuepfung {
  id: string
  benutzerId: string
  anbieter: TrackerAnbieter
  externerNutzer: string | null
  status: VerknuepfungsStatus
  verbundenAm: string
  zuletztSyncAm: string | null
  letzterFehler: string | null
}

export interface ImportZeile {
  id: string
  benutzerId: string
  anbieter: TrackerAnbieter
  externeId: string
  status: ImportStatus
  tourId: string | null
  gemeldetAm: string
  fertigAm: string | null
  gesehenAm: string | null
  fehler: string | null
  /** Wie oft angelaufen (≥ 1) — steht in der Liste, damit ein Deckel sichtbar ist. */
  versuche: number
  /** Wartet die Aktivität noch auf einen neuen Anlauf? (s. `beanspruche`) */
  wiederholbar: boolean
}

function zuVerknuepfung(z: VerknuepfungsZeile): Verknuepfung {
  return {
    id: z.id,
    benutzerId: z.benutzer_id,
    anbieter: z.anbieter as TrackerAnbieter,
    externerNutzer: z.externer_nutzer,
    status: z.status,
    verbundenAm: z.verbunden_am,
    zuletztSyncAm: z.zuletzt_sync_am,
    letzterFehler: z.letzter_fehler,
  }
}

/** Kurzlebiger `state` einer laufenden Autorisierung (OAuth-CSRF-Schutz). */
interface ZustandsEintrag {
  benutzerId: string
  anbieter: TrackerAnbieter
  ziel: 'web' | 'app'
  redirectUri: string
  laeuftAbMs: number
}

/**
 * Lebensdauer eines `state`. Kurz genug, dass ein abgefangener Wert nichts
 * nützt, lang genug für eine Anmeldung beim Anbieter samt Zwei-Faktor.
 */
const ZUSTAND_GILT_MS = 15 * 60 * 1000

/**
 * Wie oft eine Aktivität höchstens angelaufen wird.
 *
 * Ohne Deckel ginge eine dauerhaft kaputte Aktivität bei JEDER Zustellung
 * erneut durch Download und Pipeline — und Anbieter stellen bei Zweifeln
 * mehrfach zu. Drei ist die Zahl, ab der ein Fehler nicht mehr nach einem
 * Aussetzer aussieht; der Import bleibt danach als `fehler` sichtbar stehen.
 */
export const MAX_VERSUCHE = 3

export class TrackerDienst {
  /**
   * Die offenen `state`-Werte liegen IM SPEICHER, nicht in der Datenbank.
   *
   * Sie leben Minuten und überleben einen Neustart bewusst nicht: Ein Nutzer,
   * dessen Autorisierung über einen Deploy hinweg offen stand, bekommt eine
   * verständliche Fehlermeldung und klickt erneut — dafür eine Tabelle samt
   * Aufräum-Lauf zu führen, wäre mehr Zustand als Nutzen.
   */
  private readonly zustaende = new Map<string, ZustandsEintrag>()

  constructor(
    private readonly db: Db,
    /** Schlüssel für die Token-Verschlüsselung; null = alle OAuth-Anbieter aus. */
    private readonly schluessel: string | null,
    private readonly jetzt: () => Date = () => new Date(),
  ) {}

  get einsatzbereit(): boolean {
    return this.schluessel !== null
  }

  // — Autorisierung —

  /**
   * Einen `state` ausgeben. PFLICHT vor jeder Autorisierung: Ohne ihn ließe
   * sich einem Angemeldeten ein FREMDES Anbieter-Konto unterschieben (der
   * klassische OAuth-CSRF), und ab da liefen fremde Touren in sein Konto.
   */
  merkeZustand(benutzerId: string, anbieter: TrackerAnbieter, ziel: 'web' | 'app', redirectUri: string): string {
    this.raeumeZustaendeAuf()
    const zustand = neueTourId().replace('t_', 'z_')
    this.zustaende.set(zustand, {
      benutzerId,
      anbieter,
      ziel,
      redirectUri,
      laeuftAbMs: this.jetzt().getTime() + ZUSTAND_GILT_MS,
    })
    return zustand
  }

  /** Einen `state` einlösen — EINMALIG: Der Eintrag wird dabei verbraucht. */
  loeseZustandEin(zustand: string): ZustandsEintrag | null {
    this.raeumeZustaendeAuf()
    const eintrag = this.zustaende.get(zustand)
    if (!eintrag) return null
    this.zustaende.delete(zustand)
    return eintrag.laeuftAbMs > this.jetzt().getTime() ? eintrag : null
  }

  private raeumeZustaendeAuf(): void {
    const jetztMs = this.jetzt().getTime()
    for (const [k, v] of this.zustaende) {
      if (v.laeuftAbMs <= jetztMs) this.zustaende.delete(k)
    }
  }

  // — Verknüpfungen —

  /**
   * Verknüpfung anlegen oder erneuern.
   *
   * `INSERT … ON CONFLICT` statt „erst schauen, dann schreiben": Wer zweimal
   * hintereinander verbindet, soll die vorhandene Zeile aktualisieren und
   * keine zweite anlegen — und zwischen SELECT und INSERT läge sonst wieder
   * ein Fenster.
   *
   * `verbunden_am` bleibt beim UPDATE ABSICHTLICH stehen: Die Funktion legt
   * nicht nur beim Verbinden an, sondern auch bei jeder Token-Erneuerung
   * (`gueltigeTokens`) — mitgeschrieben stünde auf der Kontoseite dauerhaft
   * „verbunden seit vor ein paar Minuten", weil OAuth-Tokens stündlich
   * erneuert werden. Beim echten Neuverbinden nach dem Trennen gibt es keine
   * Zeile mehr, dort setzt der INSERT-Zweig das Datum frisch.
   */
  verknuepfe(benutzerId: string, anbieter: TrackerAnbieter, tokens: ProviderTokens): Verknuepfung {
    if (!this.schluessel) throw new Error('Tracker-Schlüssel fehlt')
    const jetztIso = this.jetzt().toISOString()
    const gepackt = verschluessele(JSON.stringify(tokens), this.schluessel)
    this.db
      .prepare(
        `INSERT INTO tracker_verknuepfungen
           (id, benutzer_id, anbieter, externer_nutzer, tokens, laeuft_ab_am, status, verbunden_am)
         VALUES (?, ?, ?, ?, ?, ?, 'aktiv', ?)
         ON CONFLICT(benutzer_id, anbieter) DO UPDATE SET
           externer_nutzer = excluded.externer_nutzer,
           tokens = excluded.tokens,
           laeuft_ab_am = excluded.laeuft_ab_am,
           status = 'aktiv',
           letzter_fehler = NULL`,
      )
      .run(
        neueTourId().replace('t_', 'v_'),
        benutzerId,
        anbieter,
        tokens.externerNutzer ?? null,
        gepackt,
        tokens.laeuftAb ?? null,
        jetztIso,
      )
    const zeile = this.verknuepfung(benutzerId, anbieter)
    if (!zeile) throw new Error('Verknüpfung ließ sich nicht anlegen')
    return zeile
  }

  verknuepfung(benutzerId: string, anbieter: TrackerAnbieter): Verknuepfung | null {
    const z = this.db
      .prepare('SELECT * FROM tracker_verknuepfungen WHERE benutzer_id = ? AND anbieter = ?')
      .get(benutzerId, anbieter) as VerknuepfungsZeile | undefined
    return z ? zuVerknuepfung(z) : null
  }

  verknuepfungen(benutzerId: string): Verknuepfung[] {
    const zeilen = this.db
      .prepare('SELECT * FROM tracker_verknuepfungen WHERE benutzer_id = ? ORDER BY anbieter')
      .all(benutzerId) as VerknuepfungsZeile[]
    return zeilen.map(zuVerknuepfung)
  }

  /**
   * Der Zuordnungsweg vom Webhook zum Konto: Der Anbieter schickt SEINE
   * Nutzerkennung, nicht unsere.
   */
  ausExternerKennung(anbieter: TrackerAnbieter, externerNutzer: string): Verknuepfung | null {
    const z = this.db
      .prepare('SELECT * FROM tracker_verknuepfungen WHERE anbieter = ? AND externer_nutzer = ?')
      .get(anbieter, externerNutzer) as VerknuepfungsZeile | undefined
    return z ? zuVerknuepfung(z) : null
  }

  /** Tokens einer Verknüpfung im Klartext — nur für den Adapter, nie nach außen. */
  tokens(verknuepfungId: string): ProviderTokens {
    if (!this.schluessel) throw new Error('Tracker-Schlüssel fehlt')
    const z = this.db
      .prepare('SELECT tokens, status FROM tracker_verknuepfungen WHERE id = ?')
      .get(verknuepfungId) as { tokens: string; status: VerknuepfungsStatus } | undefined
    if (!z) throw new TokensUngueltigFehler('Verknüpfung nicht gefunden')
    if (z.status !== 'aktiv') throw new TokensUngueltigFehler()
    try {
      return JSON.parse(entschluessele(z.tokens, this.schluessel)) as ProviderTokens
    } catch {
      // Falscher Schlüssel (rotiert) oder beschädigte Zeile: Das ist keine
      // Serverstörung, sondern eine tote Verknüpfung — sichtbar machen.
      this.setzeStatus(verknuepfungId, 'abgelaufen', 'Zugang ließ sich nicht lesen, bitte neu verbinden')
      throw new TokensUngueltigFehler()
    }
  }

  /**
   * Gültige Tokens holen und dabei erneuern, wenn sie ablaufen.
   *
   * Die Erneuerung liegt IM KERN und nicht im Adapter: Wahoo gibt
   * Refresh-Tokens einmalig aus — wer den neuen nach dem Erneuern nicht
   * speichert, hat die Verknüpfung verloren. Eine falsche Stelle, ein
   * zerstörter Zustand; deshalb genau eine.
   */
  async gueltigeTokens(verknuepfung: Verknuepfung, provider: TrackerProvider): Promise<ProviderTokens> {
    const tokens = this.tokens(verknuepfung.id)
    const laeuftAbMs = tokens.laeuftAb ? Date.parse(tokens.laeuftAb) : NaN
    // 60 s Vorlauf: Ein Token, das während des Aufrufs abläuft, ist so
    // unbrauchbar wie ein abgelaufenes.
    const faellig = Number.isFinite(laeuftAbMs) && laeuftAbMs - 60_000 <= this.jetzt().getTime()
    if (!faellig) return tokens
    if (!provider.erneuereTokens || !tokens.erneuerung) {
      this.setzeStatus(verknuepfung.id, 'abgelaufen', 'Zugang abgelaufen, bitte neu verbinden')
      throw new TokensUngueltigFehler()
    }
    try {
      const neu = await provider.erneuereTokens(tokens.erneuerung)
      // Die Anbieter-Nutzerkennung kommt beim Erneuern oft nicht mit — sie
      // aus Versehen auf null zu setzen, kappte den Zuordnungsweg des
      // Webhooks und die Verknüpfung wäre still taub.
      const zusammen: ProviderTokens = { ...neu, externerNutzer: neu.externerNutzer ?? tokens.externerNutzer ?? null }
      this.verknuepfe(verknuepfung.benutzerId, verknuepfung.anbieter, zusammen)
      return zusammen
    } catch (fehler) {
      this.setzeStatus(verknuepfung.id, 'abgelaufen', (fehler as Error).message)
      throw new TokensUngueltigFehler()
    }
  }

  setzeStatus(verknuepfungId: string, status: VerknuepfungsStatus, fehler?: string | null): void {
    this.db
      .prepare('UPDATE tracker_verknuepfungen SET status = ?, letzter_fehler = ? WHERE id = ?')
      .run(status, fehler ?? null, verknuepfungId)
  }

  merkeSync(verknuepfungId: string): void {
    this.db
      .prepare('UPDATE tracker_verknuepfungen SET zuletzt_sync_am = ?, letzter_fehler = NULL WHERE id = ?')
      .run(this.jetzt().toISOString(), verknuepfungId)
  }

  /**
   * Trennen heißt trennen: Die Tokens verschwinden aus der Datenbank.
   *
   * Bereits importierte Touren BLEIBEN — sie gehören dem Nutzer, nicht der
   * Verknüpfung. Das ist eine Aussage, die auch in der Oberfläche steht.
   */
  trenne(benutzerId: string, anbieter: TrackerAnbieter): void {
    // Auch das Abruf-Protokoll geht — es beschreibt die VERBINDUNG, nicht die
    // Touren. Das ist die Zusage aus datenschutz.html Abschnitt 10 („bis zum
    // Trennen"); bliebe es liegen, stünde dort eine Frist, die die Datenbank
    // nicht einhält. Die Touren selbst bleiben unangetastet: Sie gehören dem
    // Nutzer, nicht der Verknüpfung.
    this.db.transaction(() => {
      this.db
        .prepare('DELETE FROM tracker_importe WHERE benutzer_id = ? AND anbieter = ?')
        .run(benutzerId, anbieter)
      this.db
        .prepare('DELETE FROM tracker_verknuepfungen WHERE benutzer_id = ? AND anbieter = ?')
        .run(benutzerId, anbieter)
    })()
  }

  // — Importe —

  /**
   * Einen Import beanspruchen.
   *
   * Gibt `null` zurück, wenn diese Aktivität für dieses Konto schon erledigt
   * ist — der UNIQUE-Index entscheidet das, nicht eine Abfrage davor: Webhooks
   * werden bei Zustellzweifeln wiederholt, und zwei parallele Zustellungen
   * sehen zwischen „gibt's schon?" und dem INSERT dasselbe.
   *
   * „Erledigt" ist dabei NICHT dasselbe wie „schon einmal versucht": Ein Lauf,
   * der an etwas Vorübergehendem gescheitert ist (`wiederholbar`), wird von
   * der nächsten Zustellung wieder beansprucht — sonst wäre der eine
   * Netzaussetzer das endgültige Ende dieser Aktivität, und die Wiederholung
   * des Anbieters liefe wirkungslos in den Index. Der Zähler deckelt das: Was
   * dauerhaft kaputt ist, geht nicht bei jeder Zustellung erneut durch die
   * Pipeline.
   */
  beanspruche(benutzerId: string, anbieter: TrackerAnbieter, externeId: string): ImportZeile | null {
    const id = neueTourId().replace('t_', 'i_')
    const jetztIso = this.jetzt().toISOString()
    const ergebnis = this.db
      .prepare(
        `INSERT INTO tracker_importe (id, benutzer_id, anbieter, externe_id, status, gemeldet_am, wiederholbar, versuche)
         VALUES (?, ?, ?, ?, 'laeuft', ?, 0, 1)
         ON CONFLICT(benutzer_id, anbieter, externe_id) DO UPDATE SET
           status = 'laeuft',
           versuche = tracker_importe.versuche + 1,
           wiederholbar = 0,
           fehler = NULL,
           fertig_am = NULL,
           -- Auch wieder ungesehen: Der Ausgang des neuen Anlaufs ist eine
           -- NEUE Nachricht. Bliebe die Quittung des gescheiterten stehen,
           -- erschiene die geglückte Tour nie in der Benachrichtigung.
           gesehen_am = NULL
         WHERE tracker_importe.wiederholbar = 1 AND tracker_importe.versuche < ?`,
      )
      .run(id, benutzerId, anbieter, externeId, jetztIso, MAX_VERSUCHE)
    if (ergebnis.changes === 0) return null
    // Beim erneuten Anlauf gilt die VORHANDENE Zeile — `gemeldet_am` bleibt der
    // Zeitpunkt der ersten Meldung, sonst wanderte die Aktivität in der Liste
    // bei jedem Versuch nach oben.
    return this.importZeileNach(benutzerId, anbieter, externeId)
  }

  private importZeileNach(benutzerId: string, anbieter: TrackerAnbieter, externeId: string): ImportZeile | null {
    const z = this.db
      .prepare('SELECT id FROM tracker_importe WHERE benutzer_id = ? AND anbieter = ? AND externe_id = ?')
      .get(benutzerId, anbieter, externeId) as { id: string } | undefined
    return z ? this.importZeile(z.id) : null
  }

  importZeile(id: string): ImportZeile | null {
    const z = this.db.prepare('SELECT * FROM tracker_importe WHERE id = ?').get(id) as
      | Record<string, string | number | null>
      | undefined
    if (!z) return null
    return {
      id: z['id'] as string,
      benutzerId: z['benutzer_id'] as string,
      anbieter: z['anbieter'] as TrackerAnbieter,
      externeId: z['externe_id'] as string,
      status: z['status'] as ImportStatus,
      tourId: (z['tour_id'] as string | null) ?? null,
      gemeldetAm: z['gemeldet_am'] as string,
      fertigAm: (z['fertig_am'] as string | null) ?? null,
      gesehenAm: (z['gesehen_am'] as string | null) ?? null,
      fehler: (z['fehler'] as string | null) ?? null,
      versuche: Number(z['versuche'] ?? 1),
      wiederholbar: Number(z['wiederholbar'] ?? 0) === 1,
    }
  }

  /**
   * Einen Import abschließen.
   *
   * `wiederholbar` sagt, ob ein neuer Anlauf überhaupt Sinn hätte, und ist
   * eine Aussage über den GRUND, nicht über den Status: „ohne GPS" und „zu
   * kurz" bleiben wahr, egal wie oft man es versucht; „Speicher voll", ein
   * Anbieter-Ausfall oder ein Netzfehler sind Momentaufnahmen.
   */
  schliesseImportAb(
    id: string,
    status: ImportStatus,
    tourId?: string | null,
    fehler?: string | null,
    wiederholbar = false,
  ): void {
    this.db
      .prepare(
        'UPDATE tracker_importe SET status = ?, tour_id = ?, fertig_am = ?, fehler = ?, wiederholbar = ? WHERE id = ?',
      )
      .run(status, tourId ?? null, this.jetzt().toISOString(), fehler ?? null, wiederholbar ? 1 : 0, id)
  }

  importe(benutzerId: string, grenze = 30): ImportZeile[] {
    const zeilen = this.db
      .prepare('SELECT id FROM tracker_importe WHERE benutzer_id = ? ORDER BY gemeldet_am DESC LIMIT ?')
      .all(benutzerId, grenze) as Array<{ id: string }>
    return zeilen.map((z) => this.importZeile(z.id)).filter((z): z is ImportZeile => z !== null)
  }

  /**
   * Was der Client noch nicht gesehen hat — die Grundlage der Benachrichtigung.
   *
   * `gesehen_am` steht auf dem SERVER und nicht als Flag im Client: Zwei Geräte
   * am selben Konto sollen dieselbe Tour nicht doppelt melden.
   */
  offeneImporte(benutzerId: string): ImportZeile[] {
    const zeilen = this.db
      .prepare(
        `SELECT id FROM tracker_importe
         WHERE benutzer_id = ? AND gesehen_am IS NULL AND status IN ('fertig', 'fehler')
         ORDER BY gemeldet_am`,
      )
      .all(benutzerId) as Array<{ id: string }>
    return zeilen.map((z) => this.importZeile(z.id)).filter((z): z is ImportZeile => z !== null)
  }

  markiereGesehen(benutzerId: string, ids: readonly string[]): void {
    if (!ids.length) return
    const jetztIso = this.jetzt().toISOString()
    const setze = this.db.prepare(
      'UPDATE tracker_importe SET gesehen_am = ? WHERE id = ? AND benutzer_id = ? AND gesehen_am IS NULL',
    )
    this.db.transaction(() => {
      for (const id of ids) setze.run(jetztIso, id, benutzerId)
    })()
  }
}
