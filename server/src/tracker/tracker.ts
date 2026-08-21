// Verknüpfungen, Tokens und Importe — der anbieterblinde Kern.
//
// Alles, was für JEDEN Anbieter gleich ist, steht hier genau einmal: Tokens
// verschlüsselt ablegen und erneuern, Webhook-Zustellungen einem Konto
// zuordnen, Importe protokollieren. Ein Adapter kennt davon nichts.

import type { Db } from '../db.js'
import { newTourId } from '../ids.js'
import { decrypt, encrypt } from './crypto.js'
import type { ProviderTokens, TrackerProviderId, TrackerProvider } from './contract.js'
import { InvalidTokensError } from './contract.js'

export type TrackerLinkStatus = 'active' | 'expired' | 'disconnected'
export type ImportStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped'

interface LinkRow {
  id: string
  user_id: string
  provider: string
  external_user: string | null
  tokens: string
  expires_at: string | null
  status: TrackerLinkStatus
  connected_at: string
  last_sync_at: string | null
  last_error: string | null
}

export interface TrackerLink {
  id: string
  userId: string
  provider: TrackerProviderId
  externalUser: string | null
  status: TrackerLinkStatus
  connectedAt: string
  lastSyncAt: string | null
  lastError: string | null
}

/** So viel Tour, wie eine Chronik-Zeile braucht — nicht mehr. */
export interface TourSummary {
  title: string | null
  km: number | null
  placedMedia: number | null
  /** `created` · `processing` · `ready` · `failed` — „schon spielbar?" */
  status: string
  visibility: string | null
}

export interface ImportRow {
  id: string
  userId: string
  provider: TrackerProviderId
  externalId: string
  status: ImportStatus
  tourId: string | null
  reportedAt: string
  finishedAt: string | null
  seenAt: string | null
  error: string | null
  /** Wie oft angelaufen (≥ 1) — steht in der Liste, damit ein Deckel sichtbar ist. */
  attempts: number
  /** Wartet die Aktivität noch auf einen neuen Anlauf? (s. `claim`) */
  retryable: boolean
}

function toLink(z: LinkRow): TrackerLink {
  return {
    id: z.id,
    userId: z.user_id,
    provider: z.provider as TrackerProviderId,
    externalUser: z.external_user,
    status: z.status,
    connectedAt: z.connected_at,
    lastSyncAt: z.last_sync_at,
    lastError: z.last_error,
  }
}

/** Kurzlebiger `state` einer laufenden Autorisierung (OAuth-CSRF-Schutz). */
interface StateEntry {
  userId: string
  provider: TrackerProviderId
  target: 'web' | 'app'
  redirectUri: string
  expiresAtMs: number
}

/**
 * Lebensdauer eines `state`. Kurz genug, dass ein abgefangener Wert nichts
 * nützt, lang genug für eine Anmeldung beim Anbieter samt Zwei-Faktor.
 */
const STATE_TTL_MS = 15 * 60 * 1000

/**
 * Wie oft eine Aktivität höchstens angelaufen wird.
 *
 * Ohne Deckel ginge eine dauerhaft kaputte Aktivität bei JEDER Zustellung
 * erneut durch Download und Pipeline — und Anbieter stellen bei Zweifeln
 * mehrfach zu. Drei ist die Zahl, ab der ein Fehler nicht mehr nach einem
 * Aussetzer aussieht; der Import bleibt danach als `fehler` sichtbar stehen.
 */
export const MAX_ATTEMPTS = 3

export class TrackerService {
  /**
   * Die offenen `state`-Werte liegen IM SPEICHER, nicht in der Datenbank.
   *
   * Sie leben Minuten und überleben einen Neustart bewusst nicht: Ein Nutzer,
   * dessen Autorisierung über einen Deploy hinweg offen stand, bekommt eine
   * verständliche Fehlermeldung und klickt erneut — dafür eine Tabelle samt
   * Aufräum-Lauf zu führen, wäre mehr Zustand als Nutzen.
   */
  private readonly states = new Map<string, StateEntry>()

  constructor(
    private readonly db: Db,
    /** Schlüssel für die Token-Verschlüsselung; null = alle OAuth-Anbieter aus. */
    private readonly key: string | null,
    private readonly now: () => Date = () => new Date(),
  ) {}

  get einsatzbereit(): boolean {
    return this.key !== null
  }

  // — Autorisierung —

  /**
   * Einen `state` ausgeben. PFLICHT vor jeder Autorisierung: Ohne ihn ließe
   * sich einem Angemeldeten ein FREMDES Anbieter-Konto unterschieben (der
   * klassische OAuth-CSRF), und ab da liefen fremde Touren in sein Konto.
   */
  rememberState(
    userId: string,
    provider: TrackerProviderId,
    target: 'web' | 'app',
    redirectUri: string,
  ): string {
    this.purgeStates()
    const state = newTourId().replace('t_', 'z_')
    this.states.set(state, {
      userId,
      provider,
      target,
      redirectUri,
      expiresAtMs: this.now().getTime() + STATE_TTL_MS,
    })
    return state
  }

  /** Einen `state` einlösen — EINMALIG: Der Eintrag wird dabei verbraucht. */
  redeemState(state: string): StateEntry | null {
    this.purgeStates()
    const entry = this.states.get(state)
    if (!entry) return null
    this.states.delete(state)
    return entry.expiresAtMs > this.now().getTime() ? entry : null
  }

  private purgeStates(): void {
    const nowMs = this.now().getTime()
    for (const [k, v] of this.states) {
      if (v.expiresAtMs <= nowMs) this.states.delete(k)
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
   * (`validTokens`) — mitgeschrieben stünde auf der Kontoseite dauerhaft
   * „verbunden seit vor ein paar Minuten", weil OAuth-Tokens stündlich
   * erneuert werden. Beim echten Neuverbinden nach dem Trennen gibt es keine
   * Zeile mehr, dort setzt der INSERT-Zweig das Datum frisch.
   */
  link(userId: string, provider: TrackerProviderId, tokens: ProviderTokens): TrackerLink {
    if (!this.key) throw new Error('Tracker-Schlüssel fehlt')
    const nowIso = this.now().toISOString()
    const packed = encrypt(JSON.stringify(tokens), this.key)
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
        newTourId().replace('t_', 'v_'),
        userId,
        provider,
        tokens.externalUser ?? null,
        packed,
        tokens.expiresAt ?? null,
        nowIso,
      )
    const row = this.linkOf(userId, provider)
    if (!row) throw new Error('Verknüpfung ließ sich nicht anlegen')
    return row
  }

  linkOf(userId: string, provider: TrackerProviderId): TrackerLink | null {
    const z = this.db
      .prepare('SELECT * FROM tracker_links WHERE user_id = ? AND provider = ?')
      .get(userId, provider) as LinkRow | undefined
    return z ? toLink(z) : null
  }

  links(userId: string): TrackerLink[] {
    const rows = this.db
      .prepare('SELECT * FROM tracker_links WHERE user_id = ? ORDER BY provider')
      .all(userId) as LinkRow[]
    return rows.map(toLink)
  }

  /**
   * Der Zuordnungsweg vom Webhook zum Konto: Der Anbieter schickt SEINE
   * Nutzerkennung, nicht unsere.
   */
  byExternalId(provider: TrackerProviderId, externalUser: string): TrackerLink | null {
    const z = this.db
      .prepare('SELECT * FROM tracker_links WHERE provider = ? AND external_user = ?')
      .get(provider, externalUser) as LinkRow | undefined
    return z ? toLink(z) : null
  }

  /** Tokens einer Verknüpfung im Klartext — nur für den Adapter, nie nach außen. */
  tokens(linkId: string): ProviderTokens {
    if (!this.key) throw new Error('Tracker-Schlüssel fehlt')
    const z = this.db
      .prepare('SELECT tokens, status FROM tracker_links WHERE id = ?')
      .get(linkId) as { tokens: string; status: TrackerLinkStatus } | undefined
    if (!z) throw new InvalidTokensError('Verknüpfung nicht gefunden')
    if (z.status !== 'active') throw new InvalidTokensError()
    try {
      return JSON.parse(decrypt(z.tokens, this.key)) as ProviderTokens
    } catch {
      // Falscher Schlüssel (rotiert) oder beschädigte Zeile: Das ist keine
      // Serverstörung, sondern eine tote Verknüpfung — sichtbar machen.
      this.setStatus(linkId, 'expired', 'Zugang ließ sich nicht lesen, bitte neu verbinden')
      throw new InvalidTokensError()
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
  async validTokens(linkOf: TrackerLink, provider: TrackerProvider): Promise<ProviderTokens> {
    const tokens = this.tokens(linkOf.id)
    const expiresAtMs = tokens.expiresAt ? Date.parse(tokens.expiresAt) : NaN
    // 60 s Vorlauf: Ein Token, das während des Aufrufs abläuft, ist so
    // unbrauchbar wie ein abgelaufenes.
    const due = Number.isFinite(expiresAtMs) && expiresAtMs - 60_000 <= this.now().getTime()
    if (!due) return tokens
    if (!provider.refreshTokens || !tokens.refresh) {
      this.setStatus(linkOf.id, 'expired', 'Zugang abgelaufen, bitte neu verbinden')
      throw new InvalidTokensError()
    }
    try {
      const fresh = await provider.refreshTokens(tokens.refresh)
      // Die Anbieter-Nutzerkennung kommt beim Erneuern oft nicht mit — sie
      // aus Versehen auf null zu setzen, kappte den Zuordnungsweg des
      // Webhooks und die Verknüpfung wäre still taub.
      const combined: ProviderTokens = {
        ...fresh,
        externalUser: fresh.externalUser ?? tokens.externalUser ?? null,
      }
      this.link(linkOf.userId, linkOf.provider, combined)
      return combined
    } catch (error) {
      this.setStatus(linkOf.id, 'expired', (error as Error).message)
      throw new InvalidTokensError()
    }
  }

  setStatus(linkId: string, status: TrackerLinkStatus, error?: string | null): void {
    this.db
      .prepare('UPDATE tracker_links SET status = ?, last_error = ? WHERE id = ?')
      .run(status, error ?? null, linkId)
  }

  noteSync(linkId: string): void {
    this.db
      .prepare('UPDATE tracker_links SET last_sync_at = ?, last_error = NULL WHERE id = ?')
      .run(this.now().toISOString(), linkId)
  }

  /**
   * Trennen heißt trennen: Die Tokens verschwinden aus der Datenbank.
   *
   * Bereits importierte Touren BLEIBEN — sie gehören dem Nutzer, nicht der
   * Verknüpfung. Das ist eine Aussage, die auch in der Oberfläche steht.
   */
  unlink(userId: string, provider: TrackerProviderId): void {
    // Auch das Abruf-Protokoll geht — es beschreibt die VERBINDUNG, nicht die
    // Touren. Das ist die Zusage aus datenschutz.html Abschnitt 10 („bis zum
    // Trennen"); bliebe es liegen, stünde dort eine Frist, die die Datenbank
    // nicht einhält. Die Touren selbst bleiben unangetastet: Sie gehören dem
    // Nutzer, nicht der Verknüpfung.
    this.db.transaction(() => {
      this.db
        .prepare('DELETE FROM tracker_imports WHERE user_id = ? AND provider = ?')
        .run(userId, provider)
      this.db
        .prepare('DELETE FROM tracker_links WHERE user_id = ? AND provider = ?')
        .run(userId, provider)
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
  claim(userId: string, provider: TrackerProviderId, externalId: string): ImportRow | null {
    const id = newTourId().replace('t_', 'i_')
    const nowIso = this.now().toISOString()
    const result = this.db
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
      .run(id, userId, provider, externalId, nowIso, MAX_ATTEMPTS)
    if (result.changes === 0) return null
    // Beim erneuten Anlauf gilt die VORHANDENE Zeile — `reported_at` bleibt der
    // Zeitpunkt der ersten Meldung, sonst wanderte die Aktivität in der Liste
    // bei jedem Versuch nach oben.
    return this.importRowTo(userId, provider, externalId)
  }

  private importRowTo(
    userId: string,
    provider: TrackerProviderId,
    externalId: string,
  ): ImportRow | null {
    const z = this.db
      .prepare(
        'SELECT id FROM tracker_imports WHERE user_id = ? AND provider = ? AND external_id = ?',
      )
      .get(userId, provider, externalId) as { id: string } | undefined
    return z ? this.importRow(z.id) : null
  }

  importRow(id: string): ImportRow | null {
    const z = this.db.prepare('SELECT * FROM tracker_imports WHERE id = ?').get(id) as
      Record<string, string | number | null> | undefined
    if (!z) return null
    return {
      id: z['id'] as string,
      userId: z['user_id'] as string,
      provider: z['provider'] as TrackerProviderId,
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
  finishImport(
    id: string,
    status: ImportStatus,
    tourId?: string | null,
    error?: string | null,
    retryable = false,
  ): void {
    this.db
      .prepare(
        'UPDATE tracker_imports SET status = ?, tour_id = ?, finished_at = ?, error = ?, retryable = ? WHERE id = ?',
      )
      .run(status, tourId ?? null, this.now().toISOString(), error ?? null, retryable ? 1 : 0, id)
  }

  imports(userId: string, cutoff = 30): ImportRow[] {
    const rows = this.db
      .prepare('SELECT id FROM tracker_imports WHERE user_id = ? ORDER BY reported_at DESC LIMIT ?')
      .all(userId, cutoff) as Array<{ id: string }>
    return rows.map((z) => this.importRow(z.id)).filter((z): z is ImportRow => z !== null)
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
  history(userId: string, cutoff = 200): Array<ImportRow & { tour: TourSummary | null }> {
    const rows = this.db
      .prepare(
        `SELECT i.id, t.title AS titel, t.stats_json, t.status AS tour_status, t.visibility
         FROM tracker_imports i
         LEFT JOIN tours t ON t.id = i.tour_id
         WHERE i.user_id = ? ORDER BY i.reported_at DESC LIMIT ?`,
      )
      .all(userId, cutoff) as Array<{
      id: string
      titleOf: string | null
      stats_json: string | null
      tour_status: string | null
      visibility: string | null
    }>
    type HistoryRow = ImportRow & { tour: TourSummary | null }
    return rows.flatMap<HistoryRow>((z) => {
      const row = this.importRow(z.id)
      if (!row) return []
      if (!z.tour_status) return [{ ...row, tour: null }]
      const stats = z.stats_json
        ? (JSON.parse(z.stats_json) as { km?: number; placedMedia?: number })
        : null
      return [
        {
          ...row,
          tour: {
            title: z.titleOf,
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
  pendingImports(userId: string): ImportRow[] {
    const rows = this.db
      .prepare(
        `SELECT id FROM tracker_imports
         WHERE user_id = ? AND seen_at IS NULL AND status IN ('done', 'failed')
         ORDER BY reported_at`,
      )
      .all(userId) as Array<{ id: string }>
    return rows.map((z) => this.importRow(z.id)).filter((z): z is ImportRow => z !== null)
  }

  markSeen(userId: string, ids: readonly string[]): void {
    if (!ids.length) return
    const nowIso = this.now().toISOString()
    const set = this.db.prepare(
      'UPDATE tracker_imports SET seen_at = ? WHERE id = ? AND user_id = ? AND seen_at IS NULL',
    )
    this.db.transaction(() => {
      for (const id of ids) set.run(nowIso, id, userId)
    })()
  }
}
