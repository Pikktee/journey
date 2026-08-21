// API-Hülle der Benutzerverwaltung — gleiche Bauart wie src/studio/api.ts:
// origin-relativ, Session-Cookie, Fehler als Ausnahme mit der Server-Meldung.

import type {
  AdminUser,
  AdminInvitation,
  AdminFeedback,
  AdminWaitlistEntry,
  MailParts,
  MailTemplate,
  AuditLogEntry,
  Role,
  FeedbackStatus,
} from './admin-model.js'

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
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
  if (!res.ok)
    throw new ApiError(
      res.status,
      (json as { error?: string } | null)?.error ?? `HTTP ${res.status}`,
    )
  return json as T
}

const JSON_HEADERS = { 'content-type': 'application/json' }

export interface Session {
  user: { id: string; email: string; name: string; role: Role } | null
}

export async function me(): Promise<Session> {
  try {
    return await request<Session>('/auth/me')
  } catch {
    return { user: null }
  }
}

export async function loadUsers(): Promise<{ users: AdminUser[]; quotaLimit: number }> {
  return request('/admin/users')
}

export interface AdminStats {
  realtime: number
  today: { pageviews: number; visitors: number }
  last7Days: { pageviews: number; visitors: number }
  total: number
  referrer: Array<{ source: string; count: number }>
  pages: Array<{ path: string; count: number }>
}

export async function loadStats(): Promise<AdminStats> {
  return request('/admin/stats')
}

export interface AccountFields {
  email?: string
  name?: string
  role?: Role
  verified?: boolean
  password?: string
}

export function createUser(
  fields: AccountFields & { email: string; name: string; password: string },
): Promise<unknown> {
  return request('/admin/users', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(fields),
  })
}

export function updateUser(id: string, fields: AccountFields): Promise<unknown> {
  return request(`/admin/users/${id}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify(fields),
  })
}

export function deleteUser(id: string): Promise<unknown> {
  return request(`/admin/users/${id}`, { method: 'DELETE' })
}

export interface InvitationsResponse {
  invitations: AdminInvitation[]
  invitationRequired: boolean
  /** Harter Riegel aus der Umgebung — steht er auf zu, hilft auch kein Code. */
  registrationOpen: boolean
  baseUrl: string
}

export function loadInvitations(): Promise<InvitationsResponse> {
  return request('/admin/invitations')
}

export function createInvitation(
  note: string,
  validDays: number,
): Promise<{ invitation: AdminInvitation }> {
  return request('/admin/invitations', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ note, validDays }),
  })
}

export function revokeInvitation(code: string): Promise<unknown> {
  return request(`/admin/invitations/${encodeURIComponent(code)}`, { method: 'DELETE' })
}

export interface Settings {
  invitationRequired: boolean
  waitlistOpen: boolean
}

export function setSettings(fields: Partial<Settings>): Promise<Settings> {
  return request('/admin/settings', {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify(fields),
  })
}

export interface WaitlistResponse {
  entries: AdminWaitlistEntry[]
  waitlistOpen: boolean
  /** Steht das Formular gerade wirklich vor der Tür? Der Schalter allein sagt das nicht. */
  offered: boolean
}

export function loadWaitlist(): Promise<WaitlistResponse> {
  return request('/admin/waitlist')
}

/** Erzeugt einen Code und schickt ihn — schlägt der Versand fehl, wirft der Aufruf. */
export function inviteWaitlistEntry(
  id: string,
): Promise<{ entry: AdminWaitlistEntry; invitation: AdminInvitation }> {
  return request(`/admin/waitlist/${encodeURIComponent(id)}/invite`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: '{}',
  })
}

export function deleteWaitlistEntry(id: string): Promise<unknown> {
  return request(`/admin/waitlist/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

// — Rückmeldungen —

export interface FeedbackResponse {
  feedback: AdminFeedback[]
  counts: Record<FeedbackStatus | 'gesamt', number>
}

export function loadFeedback(): Promise<FeedbackResponse> {
  return request('/admin/feedback')
}

export function updateFeedback(
  id: string,
  fields: { status?: FeedbackStatus; note?: string | null },
): Promise<{ feedbackItem: AdminFeedback }> {
  return request(`/admin/feedback/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify(fields),
  })
}

export function deleteFeedback(id: string): Promise<unknown> {
  return request(`/admin/feedback/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

// — System-Mails —

export interface TemplatesResponse {
  templates: MailTemplate[]
  baseUrl: string
}

export function loadMailTemplates(): Promise<TemplatesResponse> {
  return request('/admin/mail-templates')
}

export function saveTemplate(
  key: string,
  blocks: MailParts,
): Promise<{ templates: MailTemplate[] }> {
  return request(`/admin/mail-templates/${encodeURIComponent(key)}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify(blocks),
  })
}

export function resetTemplate(key: string): Promise<{ templates: MailTemplate[] }> {
  return request(`/admin/mail-templates/${encodeURIComponent(key)}`, { method: 'DELETE' })
}

export interface PreviewResponse {
  subject: string
  html: string
  text: string
  /** Was den Versand verhindern würde — dieselbe Prüfung wie beim Speichern. */
  issues: string[]
}

/** Rendert die noch nicht gespeicherte Fassung — das Layout kommt vom Server. */
export function loadPreview(key: string, blocks: MailParts): Promise<PreviewResponse> {
  return request(`/admin/mail-templates/${encodeURIComponent(key)}/preview`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(blocks),
  })
}

/** Testmail an die eigene Adresse; ohne Bausteine geht die gespeicherte Fassung raus. */
export function sendTestMail(key: string, blocks?: MailParts): Promise<{ to: string }> {
  return request(`/admin/mail-templates/${encodeURIComponent(key)}/test`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(blocks ? { blocks } : {}),
  })
}

export interface AuditLogResponse {
  entries: AuditLogEntry[]
  total: number
  errorCount: number
  /** Start der API — der Puffer reicht nie weiter zurück. */
  startedAt: string
}

/**
 * Die letzten Warnungen und Fehler. Mit `seit` (höchste bekannte Nummer) kommt
 * nur das Neue — die offene Ansicht fragt regelmäßig nach und soll dabei nicht
 * jedes Mal den ganzen Puffer über die Leitung ziehen.
 */
export function loadAuditLog(since?: number): Promise<AuditLogResponse> {
  return request(`/admin/audit-log${since ? `?since=${since}` : ''}`)
}
