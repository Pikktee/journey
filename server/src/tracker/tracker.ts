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

export type VerknuepfungsStatus = 'active' | 'expired' | 'disconnected'
export type ImportStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped'

interface VerknuepfungsZeile {
  id: string
  user_id: string
  provider: string
  external_user: string | null
  tokens: string
  expires_at: string | null
  status: VerknuepfungsStatus
  connected_at: string
  last_sync_at: string | null
  last_error: string | null
}

export interface Verknuepfung {
  id: string
  userId: string
  provider: TrackerAnbieter
  externalUser: string | null
  status: VerknuepfungsStatus
  connectedAt: string
  lastSyncAt: string | null
  lastError: string | null
}

/** So viel Tour, wie eine Chronik-Zeile braucht — nicht mehr. */
export interface TourKurz {
  title: string | null
  km: number | null
  placedMedia: number | null
  /** `created` · `processing` · `ready` · `failed` — „schon spielbar?" */
  status: string
  visibility: string | null
}

export interface ImportZeile {
  id: string
  userId: string
  provider: TrackerAnbieter
  externalId: string
  status: ImportStatus
  tourId: string | null
  reportedAt: string
  finishedAt: string | null
  seenAt: string | null
  error: string | null
  /** Wie oft angelaufen (≥ 1) — steht in der Liste, damit ein Deckel sichtbar ist. */
  attempts: number
  /** Wartet die Aktivität noch auf einen neuen Anlauf? (s. `beanspruche`) */
  retryable: boolean
}

function zuVerknuepfung(z: VerknuepfungsZeile): Verknuepfung {
  return {
    id: z.id,
    userId: z.user_id,
    provider: z.provider as TrackerAnbieter,
    externalUser: z.external_user,
    status: z.status,
    connectedAt: z.connected_at,
    lastSyncAt: z.last_sync_at,
    lastError: z.last_error,
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
  merkeZustand(
    benutzerId: string,
    anbieter: TrackerAnbieter,
    ziel: 'web' | 'app',
    redirectUri: string,
  ): string {
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
   * `connected_at` bleibt beim UPDATE ABSICHTLICH stehen: Die Funktion legt
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
        `INSERT INTO tracker_links
           (id, user_id, provider, external_user, tokens, expires_at, status, connected_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', ?)
         ON CONFLICT(user_id, provider) DO UPDATE SET
           external_user = excluded.external_user,
           tokens = excluded.tokens,
           expires_at = excluded.expires_at,
           status = 'active',
           last_error = NULL`,
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
      .prepare('SELECT * FROM tracker_links WHERE user_id = ? AND provider = ?')
      .get(benutzerId, anbieter) as VerknuepfungsZeile | undefined
    return z ? zuVerknuepfung(z) : null
  }

  verknuepfungen(benutzerId: string): Verknuepfung[] {
    const zeilen = this.db
      .prepare('SELECT * FROM tracker_links WHERE user_id = ? ORDER BY provider')
      .all(benutzerId) as VerknuepfungsZeile[]
    return zeilen.map(zuVerknuepfung)
  }

  /**
   * Der Zuordnungsweg vom Webhook zum Konto: Der Anbieter schickt SEINE
   * Nutzerkennung, nicht unsere.
   */
  ausExternerKennung(anbieter: TrackerAnbieter, externerNutzer: string): Verknuepfung | null {
    const z = this.db
      .prepare('SELECT * FROM tracker_links WHERE provider = ? AND external_user = ?')
      .get(anbieter, externerNutzer) as VerknuepfungsZeile | undefined
    return z ? zuVerknuepfung(z) : null
  }

  /** Tokens einer Verknüpfung im Klartext — nur für den Adapter, nie nach außen. */
  tokens(verknuepfungId: string): ProviderTokens {
    if (!this.schluessel) throw new Error('Tracker-Schlüssel fehlt')
    const z = this.db
      .prepare('SELECT tokens, status FROM tracker_links WHERE id = ?')
      .get(verknuepfungId) as { tokens: string; status: VerknuepfungsStatus } | undefined
    if (!z) throw new TokensUngueltigFehler('Verknüpfung nicht gefunden')
    if (z.status !== 'active') throw new TokensUngueltigFehler()
    try {
      return JSON.parse(entschluessele(z.tokens, this.schluessel)) as ProviderTokens
    } catch {
      // Falscher Schlüssel (rotiert) oder beschädigte Zeile: Das ist keine
      // Serverstörung, sondern eine tote Verknüpfung — sichtbar machen.
      this.setzeStatus(
        verknuepfungId,
        'expired',
        'Zugang ließ sich nicht lesen, bitte neu verbinden',
      )
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
  async gueltigeTokens(
    verknuepfung: Verknuepfung,
    provider: TrackerProvider,
  ): Promise<ProviderTokens> {
    const tokens = this.tokens(verknuepfung.id)
    const laeuftAbMs = tokens.laeuftAb ? Date.parse(tokens.laeuftAb) : NaN
    // 60 s Vorlauf: Ein Token, das während des Aufrufs abläuft, ist so
    // unbrauchbar wie ein abgelaufenes.
    const faellig = Number.isFinite(laeuftAbMs) && laeuftAbMs - 60_000 <= this.jetzt().getTime()
    if (!faellig) return tokens
    if (!provider.erneuereTokens || !tokens.erneuerung) {
      this.setzeStatus(verknuepfung.id, 'expired', 'Zugang abgelaufen, bitte neu verbinden')
      throw new TokensUngueltigFehler()
    }
    try {
      const neu = await provider.erneuereTokens(tokens.erneuerung)
      // Die Anbieter-Nutzerkennung kommt beim Erneuern oft nicht mit — sie
      // aus Versehen auf null zu setzen, kappte den Zuordnungsweg des
      // Webhooks und die Verknüpfung wäre still taub.
      const zusammen: ProviderTokens = {
        ...neu,
        externerNutzer: neu.externerNutzer ?? tokens.externerNutzer ?? null,
      }
      this.verknuepfe(verknuepfung.userId, verknuepfung.provider, zusammen)
      return zusammen
    } catch (fehler) {
      this.setzeStatus(verknuepfung.id, 'expired', (fehler as Error).message)
      throw new TokensUngueltigFehler()
    }
  }

  setzeStatus(verknuepfungId: string, status: VerknuepfungsStatus, fehler?: string | null): void {
    this.db
      .prepare('UPDATE tracker_links SET status = ?, last_error = ? WHERE id = ?')
      .run(status, fehler ?? null, verknuepfungId)
  }

  merkeSync(verknuepfungId: string): void {
    this.db
      .prepare(
        'UPDATE tracker_links SET last_sync_at = ?, last_error = NULL WHERE id = ?',
      )
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
        .prepare('DELETE FROM tracker_imports WHERE user_id = ? AND provider = ?')
        .run(benutzerId, anbieter)
      this.db
        .prepare('DELETE FROM tracker_links WHERE user_id = ? AND provider = ?')
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
  beanspruche(
    benutzerId: string,
    anbieter: TrackerAnbieter,
    externeId: string,
  ): ImportZeile | null {
    const id = neueTourId().replace('t_', 'i_')
    const jetztIso = this.jetzt().toISOString()
    const ergebnis = this.db
      .prepare(
        `INSERT INTO tracker_imports (id, user_id, provider, external_id, status, reported_at, retryable, attempts)
         VALUES (?, ?, ?, ?, 'running', ?, 0, 1)
         ON CONFLICT(user_id, provider, external_id) DO UPDATE SET
           status = 'running',
           attempts = tracker_imports.attempts + 1,
           retryable = 0,
           error = NULL,
           finished_at = NULL,
           -- Auch wieder ungesehen: Der Ausgang des neuen Anlaufs ist eine
           -- NEUE Nachricht. Bliebe die Quittung des gescheiterten stehen,
           -- erschiene die geglückte Tour nie in der Benachrichtigung.
           seen_at = NULL
         WHERE tracker_imports.retryable = 1 AND tracker_imports.attempts < ?`,
      )
      .run(id, benutzerId, anbieter, externeId, jetztIso, MAX_VERSUCHE)
    if (ergebnis.changes === 0) return null
    // Beim erneuten Anlauf gilt die VORHANDENE Zeile — `reported_at` bleibt der
    // Zeitpunkt der ersten Meldung, sonst wanderte die Aktivität in der Liste
    // bei jedem Versuch nach oben.
    return this.importZeileNach(benutzerId, anbieter, externeId)
  }

  private importZeileNach(
    benutzerId: string,
    anbieter: TrackerAnbieter,
    externeId: string,
  ): ImportZeile | null {
    const z = this.db
      .prepare(
        'SELECT id FROM tracker_imports WHERE user_id = ? AND provider = ? AND external_id = ?',
      )
      .get(benutzerId, anbieter, externeId) as { id: string } | undefined
    return z ? this.importZeile(z.id) : null
  }

  importZeile(id: string): ImportZeile | null {
    const z = this.db.prepare('SELECT * FROM tracker_imports WHERE id = ?').get(id) as
      Record<string, string | number | null> | undefined
    if (!z) return null
    return {
      id: z['id'] as string,
      userId: z['user_id'] as string,
      provider: z['provider'] as TrackerAnbieter,
      externalId: z['external_id'] as string,
      status: z['status'] as ImportStatus,
      tourId: (z['tour_id'] as string | null) ?? null,
      reportedAt: z['reported_at'] as string,
      finishedAt: (z['finished_at'] as string | null) ?? null,
      seenAt: (z['seen_at'] as string | null) ?? null,
      error: (z['error'] as string | null) ?? null,
      attempts: Number(z['attempts'] ?? 1),
      retryable: Number(z['retryable'] ?? 0) === 1,
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
        'UPDATE tracker_imports SET status = ?, tour_id = ?, finished_at = ?, error = ?, retryable = ? WHERE id = ?',
      )
      .run(
        status,
        tourId ?? null,
        this.jetzt().toISOString(),
        fehler ?? null,
        wiederholbar ? 1 : 0,
        id,
      )
  }

  importe(benutzerId: string, grenze = 30): ImportZeile[] {
    const zeilen = this.db
      .prepare(
        'SELECT id FROM tracker_imports WHERE user_id = ? ORDER BY reported_at DESC LIMIT ?',
      )
      .all(benutzerId, grenze) as Array<{ id: string }>
    return zeilen.map((z) => this.importZeile(z.id)).filter((z): z is ImportZeile => z !== null)
  }

  /**
   * Die Chronik fürs Konto: dieselben Zeilen, aber mit der TOUR daran.
   *
   * Ohne sie stand dort „Als Tour angelegt" und ein Datum — wahr, aber ohne
   * Wert: Welche Fahrt das war, ließ sich nur raten. Titel, Länge und
   * Aufnahmezahl liegen längst in `tours` (die Bibliothek zeigt daraus ihre
   * Kacheln), es kostet einen JOIN statt einer Datei je Zeile.
   *
   * LEFT JOIN, weil die meisten Zeilen KEINE Tour haben (übersprungen,
   * gescheitert, noch am Laufen) und eine gelöschte Tour die Chronik nicht
   * verschwinden lassen darf: Was passiert ist, ist passiert.
   *
   * Die Statistik wird HIER aufgelöst und nicht in der Oberfläche: `stats_json`
   * ist ein internes Format, und die Chronik braucht daraus zwei Zahlen.
   */
  chronik(benutzerId: string, grenze = 200): Array<ImportZeile & { tour: TourKurz | null }> {
    const zeilen = this.db
      .prepare(
        `SELECT i.id, t.title AS titel, t.stats_json, t.status AS tour_status, t.visibility
         FROM tracker_imports i
         LEFT JOIN tours t ON t.id = i.tour_id
         WHERE i.user_id = ? ORDER BY i.reported_at DESC LIMIT ?`,
      )
      .all(benutzerId, grenze) as Array<{
      id: string
      titel: string | null
      stats_json: string | null
      tour_status: string | null
      visibility: string | null
    }>
    type ChronikZeile = ImportZeile & { tour: TourKurz | null }
    return zeilen.flatMap<ChronikZeile>((z) => {
      const zeile = this.importZeile(z.id)
      if (!zeile) return []
      if (!z.tour_status) return [{ ...zeile, tour: null }]
      const stats = z.stats_json
        ? (JSON.parse(z.stats_json) as { km?: number; placedMedia?: number })
        : null
      return [
        {
          ...zeile,
          tour: {
            title: z.titel,
            km: typeof stats?.km === 'number' ? stats.km : null,
            placedMedia: typeof stats?.placedMedia === 'number' ? stats.placedMedia : null,
            status: z.tour_status,
            visibility: z.visibility,
          },
        },
      ]
    })
  }

  /**
   * Was der Client noch nicht gesehen hat — die Grundlage der Benachrichtigung.
   *
   * `seen_at` steht auf dem SERVER und nicht als Flag im Client: Zwei Geräte
   * am selben Konto sollen dieselbe Tour nicht doppelt melden.
   */
  offeneImporte(benutzerId: string): ImportZeile[] {
    const zeilen = this.db
      .prepare(
        `SELECT id FROM tracker_imports
         WHERE user_id = ? AND seen_at IS NULL AND status IN ('done', 'failed')
         ORDER BY reported_at`,
      )
      .all(benutzerId) as Array<{ id: string }>
    return zeilen.map((z) => this.importZeile(z.id)).filter((z): z is ImportZeile => z !== null)
  }

  markiereGesehen(benutzerId: string, ids: readonly string[]): void {
    if (!ids.length) return
    const jetztIso = this.jetzt().toISOString()
    const setze = this.db.prepare(
      'UPDATE tracker_imports SET seen_at = ? WHERE id = ? AND user_id = ? AND seen_at IS NULL',
    )
    this.db.transaction(() => {
      for (const id of ids) setze.run(jetztIso, id, benutzerId)
    })()
  }
}
