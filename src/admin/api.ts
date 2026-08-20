// API-Hülle der Benutzerverwaltung — gleiche Bauart wie src/studio/api.ts:
// origin-relativ, Session-Cookie, Fehler als Ausnahme mit der Server-Meldung.

import type {
  AdminBenutzer,
  AdminEinladung,
  AdminRueckmeldung,
  AdminWartender,
  MailBausteine,
  MailVorlage,
  ProtokollEintrag,
  Rolle,
  RueckmeldungStatus,
} from './adminmodell.js'

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    nachricht: string,
  ) {
    super(nachricht)
    this.name = 'ApiError'
  }
}

async function anfrage<T>(path: string, optionen: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, { credentials: 'same-origin', ...optionen })
  const text = await res.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    /* Nicht-JSON (leerer Body o. Ä.) */
  }
  if (!res.ok)
    throw new ApiError(
      res.status,
      (json as { fehler?: string } | null)?.fehler ?? `HTTP ${res.status}`,
    )
  return json as T
}

const jsonKopf = { 'content-type': 'application/json' }

export interface Sitzung {
  benutzer: { id: string; email: string; name: string; role: Rolle } | null
}

export async function me(): Promise<Sitzung> {
  try {
    return await anfrage<Sitzung>('/auth/me')
  } catch {
    return { benutzer: null }
  }
}

export async function benutzer(): Promise<{ benutzer: AdminBenutzer[]; quotaLimit: number }> {
  return anfrage('/admin/benutzer')
}

export interface AdminStatistiken {
  realtime: number
  today: { pageviews: number; visitors: number }
  last7Days: { pageviews: number; visitors: number }
  total: number
  referrer: Array<{ quelle: string; count: number }>
  pages: Array<{ path: string; count: number }>
}

export async function statistiken(): Promise<AdminStatistiken> {
  return anfrage('/admin/statistiken')
}

export interface KontoFelder {
  email?: string
  name?: string
  role?: Rolle
  verified?: boolean
  password?: string
}

export function legeAn(
  felder: KontoFelder & { email: string; name: string; password: string },
): Promise<unknown> {
  return anfrage('/admin/benutzer', {
    method: 'POST',
    headers: jsonKopf,
    body: JSON.stringify(felder),
  })
}

export function aendere(id: string, felder: KontoFelder): Promise<unknown> {
  return anfrage(`/admin/benutzer/${id}`, {
    method: 'PATCH',
    headers: jsonKopf,
    body: JSON.stringify(felder),
  })
}

export function loesche(id: string): Promise<unknown> {
  return anfrage(`/admin/benutzer/${id}`, { method: 'DELETE' })
}

export interface EinladungsStand {
  invitations: AdminEinladung[]
  invitationRequired: boolean
  /** Harter Riegel aus der Umgebung — steht er auf zu, hilft auch kein Code. */
  registrationOpen: boolean
  baseUrl: string
}

export function einladungen(): Promise<EinladungsStand> {
  return anfrage('/admin/einladungen')
}

export function ladeEin(
  notiz: string,
  validDays: number,
): Promise<{ einladung: AdminEinladung }> {
  return anfrage('/admin/einladungen', {
    method: 'POST',
    headers: jsonKopf,
    body: JSON.stringify({ notiz, validDays }),
  })
}

export function widerrufe(code: string): Promise<unknown> {
  return anfrage(`/admin/einladungen/${encodeURIComponent(code)}`, { method: 'DELETE' })
}

export interface Einstellungen {
  invitationRequired: boolean
  waitlistOpen: boolean
}

export function setzeEinstellungen(felder: Partial<Einstellungen>): Promise<Einstellungen> {
  return anfrage('/admin/einstellungen', {
    method: 'PATCH',
    headers: jsonKopf,
    body: JSON.stringify(felder),
  })
}

export interface WartelistenStand {
  entries: AdminWartender[]
  waitlistOpen: boolean
  /** Steht das Formular gerade wirklich vor der Tür? Der Schalter allein sagt das nicht. */
  offered: boolean
}

export function warteliste(): Promise<WartelistenStand> {
  return anfrage('/admin/warteliste')
}

/** Erzeugt einen Code und schickt ihn — schlägt der Versand fehl, wirft der Aufruf. */
export function ladeWartendenEin(
  id: string,
): Promise<{ eintrag: AdminWartender; einladung: AdminEinladung }> {
  return anfrage(`/admin/warteliste/${encodeURIComponent(id)}/einladen`, {
    method: 'POST',
    headers: jsonKopf,
    body: '{}',
  })
}

export function loescheWartenden(id: string): Promise<unknown> {
  return anfrage(`/admin/warteliste/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

// — Rückmeldungen —

export interface RueckmeldungsStand {
  rueckmeldungen: AdminRueckmeldung[]
  counts: Record<RueckmeldungStatus | 'gesamt', number>
}

export function rueckmeldungen(): Promise<RueckmeldungsStand> {
  return anfrage('/admin/rueckmeldungen')
}

export function aendereRueckmeldung(
  id: string,
  felder: { status?: RueckmeldungStatus; notiz?: string | null },
): Promise<{ rueckmeldung: AdminRueckmeldung }> {
  return anfrage(`/admin/rueckmeldungen/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: jsonKopf,
    body: JSON.stringify(felder),
  })
}

export function loescheRueckmeldung(id: string): Promise<unknown> {
  return anfrage(`/admin/rueckmeldungen/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

// — System-Mails —

export interface VorlagenStand {
  templates: MailVorlage[]
  baseUrl: string
}

export function mailvorlagen(): Promise<VorlagenStand> {
  return anfrage('/admin/mailvorlagen')
}

export function speichereVorlage(
  key: string,
  blocks: MailBausteine,
): Promise<{ templates: MailVorlage[] }> {
  return anfrage(`/admin/mailvorlagen/${encodeURIComponent(key)}`, {
    method: 'PATCH',
    headers: jsonKopf,
    body: JSON.stringify(blocks),
  })
}

export function setzeVorlageZurueck(key: string): Promise<{ templates: MailVorlage[] }> {
  return anfrage(`/admin/mailvorlagen/${encodeURIComponent(key)}`, { method: 'DELETE' })
}

export interface VorschauAntwort {
  subject: string
  html: string
  text: string
  /** Was den Versand verhindern würde — dieselbe Prüfung wie beim Speichern. */
  issues: string[]
}

/** Rendert die noch nicht gespeicherte Fassung — das Layout kommt vom Server. */
export function vorschau(key: string, blocks: MailBausteine): Promise<VorschauAntwort> {
  return anfrage(`/admin/mailvorlagen/${encodeURIComponent(key)}/vorschau`, {
    method: 'POST',
    headers: jsonKopf,
    body: JSON.stringify(blocks),
  })
}

/** Testmail an die eigene Adresse; ohne Bausteine geht die gespeicherte Fassung raus. */
export function testeVorlage(
  key: string,
  blocks?: MailBausteine,
): Promise<{ an: string }> {
  return anfrage(`/admin/mailvorlagen/${encodeURIComponent(key)}/test`, {
    method: 'POST',
    headers: jsonKopf,
    body: JSON.stringify(blocks ? { blocks } : {}),
  })
}

export interface ProtokollAntwort {
  entries: ProtokollEintrag[]
  total: number
  fehler: number
  /** Start der API — der Puffer reicht nie weiter zurück. */
  startedAt: string
}

/**
 * Die letzten Warnungen und Fehler. Mit `seit` (höchste bekannte Nummer) kommt
 * nur das Neue — die offene Ansicht fragt regelmäßig nach und soll dabei nicht
 * jedes Mal den ganzen Puffer über die Leitung ziehen.
 */
export function protokoll(seit?: number): Promise<ProtokollAntwort> {
  return anfrage(`/admin/protokoll${seit ? `?seit=${seit}` : ''}`)
}
