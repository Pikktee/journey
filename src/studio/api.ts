// Studio-API-Client (M6): dünne fetch-Hülle um das Backend. Origin-relativ mit
// Session-Cookie (der Studio-Login setzt luhambo_session, httpOnly) — kein CORS,
// kein Token im JS. Alle Aufrufe werfen ApiFehler mit der Server-Meldung.

import type { UploadManifest } from './upload.js'

export class ApiFehler extends Error {
  constructor(
    public readonly status: number,
    nachricht: string,
  ) {
    super(nachricht)
    this.name = 'ApiFehler'
  }
}

export interface TourListe {
  id: string
  no: string
  status: string
  visibility: string
  title: string | null
  stats: { km: number; gainM: number } | null
  fehler: string | null
  createdAt: string
}

export interface Benutzer {
  id: string
  email: string
  /** Anzeigename (der Server leitet ihn beim Anlegen aus der E-Mail ab) */
  name?: string
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
  if (!res.ok) {
    const fehler = (json as { fehler?: string } | null)?.fehler ?? `HTTP ${res.status}`
    throw new ApiFehler(res.status, fehler)
  }
  return json as T
}

const jsonKopf = { 'content-type': 'application/json' }

export function login(email: string, passwort: string): Promise<{ benutzer: Benutzer }> {
  return anfrage('/auth/login', { method: 'POST', headers: jsonKopf, body: JSON.stringify({ email, passwort }) })
}

export async function me(): Promise<Benutzer | null> {
  try {
    return (await anfrage<{ benutzer: Benutzer }>('/auth/me')).benutzer
  } catch {
    return null
  }
}

export function logout(): Promise<unknown> {
  return anfrage('/auth/logout', { method: 'POST' })
}

export async function listeTouren(): Promise<TourListe[]> {
  return (await anfrage<{ tours: TourListe[] }>('/tours')).tours
}

export function legeTourAn(manifest: UploadManifest): Promise<{ id: string; wiederverwendet?: boolean }> {
  return anfrage('/tours', { method: 'POST', headers: jsonKopf, body: JSON.stringify(manifest) })
}

export function ladeTrack(id: string, gpx: string): Promise<unknown> {
  return anfrage(`/tours/${id}/track`, { method: 'PUT', headers: { 'content-type': 'application/gpx+xml' }, body: gpx })
}

export function ladeMedium(id: string, mid: string, datei: Blob): Promise<unknown> {
  return anfrage(`/tours/${id}/media/${mid}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/octet-stream' },
    body: datei,
  })
}

export function finalisiere(id: string): Promise<unknown> {
  return anfrage(`/tours/${id}/finalize`, { method: 'POST' })
}

export function tour(id: string): Promise<{ status?: string; fehler?: string | null; schema?: string; media?: Array<{ placement?: string }> }> {
  return anfrage(`/tours/${id}`)
}

export function loescheTour(id: string): Promise<unknown> {
  return anfrage(`/tours/${id}`, { method: 'DELETE' })
}

// — Editor (M7) —

export interface EditorMedium {
  id: string
  type: 'photo' | 'video'
  src: string
  poster?: string
  takenAt: string
  caption: string
  anchor: [number, number] | null
  placement: string
}

export interface EditorDaten {
  id: string
  status: string
  title: string | null
  description: string | null
  time: { start: string; end: string; zone: string }
  segmente: Array<{ mode: string; pts: Array<[number, number, number, number]> }>
  medien: EditorMedium[]
  edits: unknown
}

export function editorDaten(id: string): Promise<EditorDaten> {
  return anfrage(`/tours/${id}/editor`)
}

export function speichereEdits(id: string, edits: unknown): Promise<{ ok: boolean; status: string }> {
  return anfrage(`/tours/${id}/edits`, { method: 'PUT', headers: jsonKopf, body: JSON.stringify(edits) })
}

export function patchTour(id: string, felder: { title?: string; description?: string }): Promise<unknown> {
  return anfrage(`/tours/${id}`, { method: 'PATCH', headers: jsonKopf, body: JSON.stringify(felder) })
}

export function reprocess(id: string): Promise<unknown> {
  return anfrage(`/tours/${id}/reprocess`, { method: 'POST' })
}
