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

export class ApiFehler extends Error {
  constructor(
    public readonly status: number,
    nachricht: string,
  ) {
    super(nachricht)
    this.name = 'ApiFehler'
  }
}

async function anfrage<T>(pfad: string, optionen: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${pfad}`, { credentials: 'same-origin', ...optionen })
  const text = await res.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    /* Nicht-JSON (leerer Body o. Ä.) */
  }
  if (!res.ok) throw new ApiFehler(res.status, (json as { fehler?: string } | null)?.fehler ?? `HTTP ${res.status}`)
  return json as T
}

const jsonKopf = { 'content-type': 'application/json' }

export interface Sitzung {
  benutzer: { id: string; email: string; name: string; rolle: Rolle } | null
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
  echtzeit: number
  heute: { aufrufe: number; besucher: number }
  letzte7Tage: { aufrufe: number; besucher: number }
  gesamt: number
  referrer: Array<{ quelle: string; anzahl: number }>
  seiten: Array<{ pfad: string; anzahl: number }>
}

export async function statistiken(): Promise<AdminStatistiken> {
  return anfrage('/admin/statistiken')
}

export interface KontoFelder {
  email?: string
  name?: string
  rolle?: Rolle
  verifiziert?: boolean
  passwort?: string
}

export function legeAn(felder: KontoFelder & { email: string; name: string; passwort: string }): Promise<unknown> {
  return anfrage('/admin/benutzer', { method: 'POST', headers: jsonKopf, body: JSON.stringify(felder) })
}

export function aendere(id: string, felder: KontoFelder): Promise<unknown> {
  return anfrage(`/admin/benutzer/${id}`, { method: 'PATCH', headers: jsonKopf, body: JSON.stringify(felder) })
}

export function loesche(id: string): Promise<unknown> {
  return anfrage(`/admin/benutzer/${id}`, { method: 'DELETE' })
}

export interface EinladungsStand {
  einladungen: AdminEinladung[]
  einladungPflicht: boolean
  /** Harter Riegel aus der Umgebung — steht er auf zu, hilft auch kein Code. */
  registrierungOffen: boolean
  basisUrl: string
}

export function einladungen(): Promise<EinladungsStand> {
  return anfrage('/admin/einladungen')
}

export function ladeEin(notiz: string, gueltigTage: number): Promise<{ einladung: AdminEinladung }> {
  return anfrage('/admin/einladungen', { method: 'POST', headers: jsonKopf, body: JSON.stringify({ notiz, gueltigTage }) })
}

export function widerrufe(code: string): Promise<unknown> {
  return anfrage(`/admin/einladungen/${encodeURIComponent(code)}`, { method: 'DELETE' })
}

export interface Einstellungen {
  einladungPflicht: boolean
  wartelisteOffen: boolean
}

export function setzeEinstellungen(felder: Partial<Einstellungen>): Promise<Einstellungen> {
  return anfrage('/admin/einstellungen', { method: 'PATCH', headers: jsonKopf, body: JSON.stringify(felder) })
}

export interface WartelistenStand {
  eintraege: AdminWartender[]
  wartelisteOffen: boolean
  /** Steht das Formular gerade wirklich vor der Tür? Der Schalter allein sagt das nicht. */
  angeboten: boolean
}

export function warteliste(): Promise<WartelistenStand> {
  return anfrage('/admin/warteliste')
}

/** Erzeugt einen Code und schickt ihn — schlägt der Versand fehl, wirft der Aufruf. */
export function ladeWartendenEin(id: string): Promise<{ eintrag: AdminWartender; einladung: AdminEinladung }> {
  return anfrage(`/admin/warteliste/${encodeURIComponent(id)}/einladen`, { method: 'POST', headers: jsonKopf, body: '{}' })
}

export function loescheWartenden(id: string): Promise<unknown> {
  return anfrage(`/admin/warteliste/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

// — Rückmeldungen —

export interface RueckmeldungsStand {
  rueckmeldungen: AdminRueckmeldung[]
  zaehlung: Record<RueckmeldungStatus | 'gesamt', number>
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
  vorlagen: MailVorlage[]
  basisUrl: string
}

export function mailvorlagen(): Promise<VorlagenStand> {
  return anfrage('/admin/mailvorlagen')
}

export function speichereVorlage(schluessel: string, bausteine: MailBausteine): Promise<{ vorlagen: MailVorlage[] }> {
  return anfrage(`/admin/mailvorlagen/${encodeURIComponent(schluessel)}`, {
    method: 'PATCH',
    headers: jsonKopf,
    body: JSON.stringify(bausteine),
  })
}

export function setzeVorlageZurueck(schluessel: string): Promise<{ vorlagen: MailVorlage[] }> {
  return anfrage(`/admin/mailvorlagen/${encodeURIComponent(schluessel)}`, { method: 'DELETE' })
}

export interface VorschauAntwort {
  betreff: string
  html: string
  text: string
  /** Was den Versand verhindern würde — dieselbe Prüfung wie beim Speichern. */
  probleme: string[]
}

/** Rendert die noch nicht gespeicherte Fassung — das Layout kommt vom Server. */
export function vorschau(schluessel: string, bausteine: MailBausteine): Promise<VorschauAntwort> {
  return anfrage(`/admin/mailvorlagen/${encodeURIComponent(schluessel)}/vorschau`, {
    method: 'POST',
    headers: jsonKopf,
    body: JSON.stringify(bausteine),
  })
}

/** Testmail an die eigene Adresse; ohne Bausteine geht die gespeicherte Fassung raus. */
export function testeVorlage(schluessel: string, bausteine?: MailBausteine): Promise<{ an: string }> {
  return anfrage(`/admin/mailvorlagen/${encodeURIComponent(schluessel)}/test`, {
    method: 'POST',
    headers: jsonKopf,
    body: JSON.stringify(bausteine ? { bausteine } : {}),
  })
}

export interface ProtokollAntwort {
  eintraege: ProtokollEintrag[]
  gesamt: number
  fehler: number
  /** Start der API — der Puffer reicht nie weiter zurück. */
  gestartet: string
}

/**
 * Die letzten Warnungen und Fehler. Mit `seit` (höchste bekannte Nummer) kommt
 * nur das Neue — die offene Ansicht fragt regelmäßig nach und soll dabei nicht
 * jedes Mal den ganzen Puffer über die Leitung ziehen.
 */
export function protokoll(seit?: number): Promise<ProtokollAntwort> {
  return anfrage(`/admin/protokoll${seit ? `?seit=${seit}` : ''}`)
}
