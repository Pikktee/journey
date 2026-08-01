// API-Hülle der Benutzerverwaltung — gleiche Bauart wie src/studio/api.ts:
// origin-relativ, Session-Cookie, Fehler als Ausnahme mit der Server-Meldung.

import type { AdminBenutzer, AdminEinladung, Rolle } from './adminmodell.js'

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

export function setzeEinladungPflicht(einladungPflicht: boolean): Promise<{ einladungPflicht: boolean }> {
  return anfrage('/admin/einstellungen', { method: 'PATCH', headers: jsonKopf, body: JSON.stringify({ einladungPflicht }) })
}
