// Studio-API-Client (M6): dünne fetch-Hülle um das Backend. Origin-relativ mit
// Session-Cookie (der Studio-Login setzt maptale_session, httpOnly) — kein CORS,
// kein Token im JS. Alle Aufrufe werfen ApiFehler mit der Server-Meldung.

import type { UploadManifest } from './upload.js'

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    nachricht: string,
  ) {
    super(nachricht)
    this.name = 'ApiError'
  }
}

export interface TourListItem {
  id: string
  no: string
  status: string
  visibility: string
  title: string | null
  /** `placedMedia` und `trackSignature` entstehen beim Anreichern — ältere Touren
   *  haben sie erst nach dem nächsten Rendern, die Kachel muss ohne sie auskommen. */
  stats: {
    km: number
    gainM: number
    placedMedia?: number
    trackSignature?: { d: string; start: [number, number]; end: [number, number] }
    /** Länge des FILMS in Sekunden (nicht der Aufzeichnung), s. TourStats. */
    filmS?: number
    /** Endscreen „Ziel erreicht" — zählt zur Länge des exportierten Films. */
    finale?: boolean
  } | null
  cover: string | null
  /** Kachel-Fassung des Titelbilds; fehlt bei Touren ohne aufbereitete Fassungen */
  coverThumb?: string | null
  error: string | null
  createdAt: string
}

export interface User {
  id: string
  email: string
  /** Klarname aus der Registrierung — privat, nicht für die öffentliche UI. */
  name?: string
  /** 'admin' schaltet den Weg zur Benutzerverwaltung frei (admin.html). */
  role?: 'user' | 'admin'
}

/** Öffentliches Profil — getrennt vom Konto (s. server/auth). */
export interface Profile {
  /** Die Adresse der Person: `/@henrik` (s. src/handle.ts). */
  handle?: string | null
  displayName: string | null
  bio?: string | null
  avatarUrl: string | null
  visibility?: string
}

export interface Quota {
  used: number
  limit: number
  free: number
}

/** Antwort von GET /auth/me — angemeldet um Verifikation + Quota angereichert. */
export interface Session {
  user: User | null
  profile?: Profile | null
  verified?: boolean
  quota?: Quota
  /**
   * Wie neue Konten entstehen — kommt AUCH ohne Anmeldung, denn genau das
   * braucht das Registrierungsformular (fragt es nach einem Code?).
   */
  registration?: {
    open: boolean
    invitationRequired: boolean
    /** Steht die Warteliste vor der Tür? (Schalter UND Lage — s. Server.) */
    waitlist?: boolean
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, { credentials: 'same-origin', ...options })
  const text = await res.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    /* Nicht-JSON (leerer Body o. Ä.) */
  }
  if (!res.ok) {
    const error = (json as { error?: string } | null)?.error ?? `HTTP ${res.status}`
    throw new ApiError(res.status, error)
  }
  return json as T
}

const jsonHeaders = { 'content-type': 'application/json' }

export function login(email: string, password: string): Promise<{ user: User }> {
  return request('/auth/login', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ email, password: password }),
  })
}

/** Voller Sitzungs-Zustand (benutzer=null wenn nicht angemeldet). Wirft nie. */
export async function me(): Promise<Session> {
  try {
    return await request<Session>('/auth/me')
  } catch {
    return { user: null }
  }
}

export function logout(): Promise<unknown> {
  return request('/auth/logout', { method: 'POST' })
}

// — Selbst-Registrierung & Passwort-Reset (M9) —

/** `code` ist die Einladung — Pflicht, solange die Instanz auf „nur mit Code" steht. */
export function register(
  email: string,
  password: string,
  code?: string,
  wahl: { newsletter?: boolean } = {},
): Promise<{ user: User; verified: boolean }> {
  // Kein `name`: Das Formular fragt nur E-Mail und Passwort ab, den
  // Anzeigenamen leitet der Server aus der Adresse ab (nameAusEmail).
  //
  // `newsletter` geht nur mit, wenn der Haken steht: Ein `false` im Körper
  // wäre eine Aussage über eine Frage, die niemand beantwortet hat — der
  // Server protokolliert deshalb auch nichts, wo das Feld fehlt.
  return request('/auth/register', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({
      email,
      password: password,
      ...(code ? { code } : {}),
      ...(wahl.newsletter ? { newsletter: true } : {}),
    }),
  })
}

/**
 * Schritt 1 der Registrierung: Ist dieser Einladungscode gültig?
 *
 * Verbraucht ihn NICHT — das passiert erst beim Anlegen des Kontos. Wirft mit
 * der Begründung des Servers (unknown / used / expired).
 */
export function checkInvitation(code: string): Promise<{ ok: boolean; required: boolean }> {
  return request('/auth/check-invitation', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ code }),
  })
}

// — Warteliste —
//
// Alle drei Aufrufe antworten absichtlich karg: Die Route sagt weder, ob eine
// Adresse schon eingetragen ist, noch ob es zu ihr ein Konto gibt. Die
// Oberfläche zeigt darum immer denselben Satz.

export function joinWaitlist(email: string, notiz?: string): Promise<{ ok: boolean }> {
  return request('/auth/waitlist', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(notiz ? { email, note: notiz } : { email }),
  })
}

/** Der Klick aus der Bestätigungsmail; gibt die eingetragene Adresse zurück. */
export function confirmWaitlist(token: string): Promise<{ ok: boolean; email: string }> {
  return request('/auth/waitlist/confirm', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ token }),
  })
}

export function leaveWaitlist(token: string): Promise<{ ok: boolean }> {
  return request('/auth/waitlist/leave', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ token }),
  })
}

export function verifyEmail(token: string): Promise<{ ok: boolean }> {
  return request('/auth/verify', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ token }),
  })
}

export function requestPasswordReset(email: string): Promise<{ ok: boolean }> {
  return request('/auth/password-reset-request', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ email }),
  })
}

export function resetPassword(token: string, password: string): Promise<{ ok: boolean }> {
  return request('/auth/password-reset', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ token, password: password }),
  })
}

export function deleteAccount(): Promise<unknown> {
  return request('/auth/me', { method: 'DELETE' })
}

export async function listTours(): Promise<TourListItem[]> {
  return (await request<{ tours: TourListItem[] }>('/tours')).tours
}

export function createTour(manifest: UploadManifest): Promise<{ id: string; reused?: boolean }> {
  return request('/tours', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(manifest) })
}

export function uploadTrack(id: string, gpx: string): Promise<unknown> {
  return request(`/tours/${id}/track`, {
    method: 'PUT',
    headers: { 'content-type': 'application/gpx+xml' },
    body: gpx,
  })
}

export function uploadMedium(id: string, mid: string, file: Blob): Promise<unknown> {
  return request(`/tours/${id}/media/${mid}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/octet-stream' },
    body: file,
  })
}

export function finalize(id: string): Promise<unknown> {
  return request(`/tours/${id}/finalize`, { method: 'POST' })
}

/** Ein nachzureichendes Medium — die ID vergibt der SERVER (s. reicheMedienNach). */
export interface AddMediaInput {
  type: 'photo' | 'video'
  file: string
  takenAt: string
  anchor?: [number, number]
  durationS?: number
}

/**
 * Medien zu einer bestehenden Tour anmelden (additiv, Manifest wächst).
 *
 * Antwort ist die Zuordnung Eintrag → ID + Ablage-Dateiname, in der Reihenfolge
 * der Anfrage; danach lädt der Aufrufer je Datei mit `ladeMedium` hoch. Die IDs
 * kommen vom Server, weil beim Nachreichen — anders als beim Anlegen — keine
 * idempotente Wiederholung nötig ist und so keine ID kollidieren kann.
 */
export function addMedia(
  id: string,
  media: AddMediaInput[],
): Promise<{ media: Array<{ id: string; file: string }> }> {
  return request(`/tours/${id}/media`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ media: media }),
  })
}

/**
 * Ein Medium ENDGÜLTIG löschen: Rohdatei und alle abgeleiteten Fassungen sind
 * danach weg, der Speicher ist frei. Der Server rendert anschließend neu (aus
 * dem Cache) — der Aufrufer wartet also auf „bereit", bevor er weiterschreibt.
 */
export function deleteMedium(id: string, mid: string): Promise<{ ok: boolean }> {
  return request(`/tours/${id}/media/${mid}`, { method: 'DELETE' })
}

export function tour(id: string): Promise<{
  status?: string
  error?: string | null
  schema?: string
  media?: Array<{ placement?: string }>
}> {
  return request(`/tours/${id}`)
}

export function deleteTour(id: string): Promise<unknown> {
  return request(`/tours/${id}`, { method: 'DELETE' })
}

// — Editor (M7) —

export interface EditorMedium {
  id: string
  type: 'photo' | 'video'
  src: string
  poster?: string
  /** Kachel-Fassung für Miniaturen; fehlt bei unaufbereitetem Altbestand */
  thumb?: string
  takenAt: string
  caption: string
  anchor: [number, number] | null
  placement: string
  /** roher Manifest-GPS-Anker (auch wenn die Auto-Platzierung ihn verwarf) */
  gpsAnchor?: [number, number]
}

export interface EditorPayload {
  id: string
  status: string
  title: string | null
  description: string | null
  /**
   * Die Dachzeile über dem Titel. `null` = nie gesetzt (der Render nimmt seine
   * Vorbelegung), `''` = ausdrücklich keine Zeile.
   */
  kicker: string | null
  /**
   * Vorschläge dafür: die Adress-Ebenen des Startpunkts, fein → grob
   * („Völklingen", „Regionalverband Saarbrücken", „Saarland", „Deutschland").
   * Leer bei Touren, die vor dieser Änderung gerendert wurden.
   */
  kickerSuggestions?: string[]
  /** Endscreen „Ziel erreicht" (Default false) */
  finale: boolean
  /** Zielname für den Endscreen; null/leer = Ortsname am Ende */
  finaleTarget: string | null
  time: { start: string; end: string; zone: string }
  segments: Array<{ mode: string; pts: Array<[number, number, number, number]> }>
  media: EditorMedium[]
  /** hochgeladene Audio-Assets (Dateien unter medien/ mit Audio-Endung) */
  audio: Array<{ file: string; size: number }>
  /**
   * Das automatisch ermittelte Wetter als Grenzen — dieselbe Form wie
   * `edits.weather`. Die Wetterspur zeigt es, solange niemand eingegriffen hat;
   * der erste Eingriff schreibt es ins Overlay fest. Leer bei Touren, die noch
   * nie gerendert wurden (oder deren Wetter schon aus dem Studio stammt).
   */
  autoWeather?: Array<{ from: string; mode: string; intensity?: number }>
  edits: unknown
}

export function loadEditorPayload(id: string): Promise<EditorPayload> {
  return request(`/tours/${id}/editor`)
}

export function saveEdits(id: string, edits: unknown): Promise<{ ok: boolean; status: string }> {
  return request(`/tours/${id}/edits`, {
    method: 'PUT',
    headers: jsonHeaders,
    body: JSON.stringify(edits),
  })
}

export function patchTour(
  id: string,
  felder: {
    title?: string
    description?: string
    kicker?: string
    finale?: boolean
    finaleTarget?: string
    visibility?: 'private' | 'unlisted' | 'public'
  },
): Promise<unknown> {
  return request(`/tours/${id}`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify(felder),
  })
}

export function reprocess(id: string): Promise<unknown> {
  return request(`/tours/${id}/reprocess`, { method: 'POST' })
}

// — Audio-Assets (Kreativbaukasten) —

export function uploadAudio(
  id: string,
  file: string,
  daten: Blob,
): Promise<{ file: string; bytes: number }> {
  return request(`/tours/${id}/audio/${encodeURIComponent(file)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/octet-stream' },
    body: daten,
  })
}

export function deleteAudio(id: string, file: string): Promise<unknown> {
  return request(`/tours/${id}/audio/${encodeURIComponent(file)}`, { method: 'DELETE' })
}

// — Benutzerweite Audio-Bibliothek: eigene Uploads, in jeder Tour einsetzbar —

export interface LibraryFile {
  file: string
  size: number
  /** Touren, die die Datei (noch) verwenden — solange nicht leer, ist Löschen gesperrt. */
  usedBy: Array<{ id: string; title: string }>
}

export async function listLibrary(): Promise<LibraryFile[]> {
  return (await request<{ files: LibraryFile[] }>('/audio-library')).files
}

export function uploadLibraryAudio(
  file: string,
  daten: Blob,
): Promise<{ file: string; bytes: number }> {
  return request(`/audio-library/${encodeURIComponent(file)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/octet-stream' },
    body: daten,
  })
}

export function deleteLibraryAudio(file: string): Promise<unknown> {
  return request(`/audio-library/${encodeURIComponent(file)}`, { method: 'DELETE' })
}
