// Rechnende Teile der Benutzerverwaltung — ohne DOM, damit sie prüfbar sind.
// Die Oberfläche (admin.ts) baut daraus nur noch Elemente.

import { path } from '../routes.js'

export type Role = 'user' | 'admin'
export type InvitationStatus = 'open' | 'redeemed' | 'expired'

// — Bereiche —
//
// Die Verwaltung hatte fünf Karten untereinander auf einer Seite; wer eine
// Einladung erstellen wollte, scrollte an Wartenden und Mail-Vorlagen vorbei.
// Jetzt ist jeder Bereich ein Reiter — und weil die Liste den URL-Anhang, die
// Reiterleiste UND die Zähler speist, steht sie EINMAL hier.

export type TabId =
  'accounts' | 'stats' | 'invitations' | 'waitlist' | 'feedback' | 'mails' | 'audit-log'

export interface Tab {
  id: TabId
  name: string
  /**
   * Was die Zahl am Reiter zählt. Sie ist NICHT überall dasselbe — bei den
   * Konten sind es alle, bei Einladungen und Warteliste nur die, auf die man
   * handeln kann. Der Zähler allein sagt das nicht, deshalb geht dieses Wort
   * ins `aria-label` und in den Tooltip.
   */
  counts: string
}

export const TABS: readonly Tab[] = [
  { id: 'accounts', name: 'Konten', counts: 'Konten' },
  { id: 'invitations', name: 'Einladungen', counts: 'offen' },
  { id: 'waitlist', name: 'Warteliste', counts: 'warten' },
  { id: 'stats', name: 'Statistiken', counts: 'Live' },
  { id: 'feedback', name: 'Rückmeldungen', counts: 'offen' },
  { id: 'audit-log', name: 'Protokoll', counts: 'Fehler' },
  { id: 'mails', name: 'System-Mails', counts: 'Vorlagen' },
]

/** Womit die Seite aufmacht: die Konten sind der Grund, warum es sie gibt. */
export const DEFAULT_TAB: TabId = 'accounts'

/**
 * Welcher Reiter zu `#einladungen` gehört — unbekanntes fällt auf den Standard.
 *
 * Der Anhang ist die einzige Adresse eines Reiters: Ein Neuladen (und jeder
 * Link, den sich jemand ablegt) landet wieder dort, wo er war. Ein eigener
 * Pfad je Bereich wäre die Alternative, hieße aber vier Einträge in
 * `routes.ts` und vier `location`-Blöcke im Vhost für eine Seite, die ohnehin
 * nur Admins sehen.
 */
export function tabFromHash(hash: string): TabId {
  const name = hash.replace(/^#/, '').trim().toLowerCase()
  return TABS.find((t) => t.id === name)?.id ?? DEFAULT_TAB
}

export interface AdminUser {
  id: string
  email: string
  name: string
  role: Role
  verified: boolean
  createdAt: string
  displayName: string | null
  tours: number
  storage: number
  /** In der Konfiguration als Admin gesetzt — Rolle und Konto sind unantastbar. */
  fixed: boolean
}

export interface AdminInvitation {
  code: string
  note: string | null
  createdAt: string
  createdBy: string | null
  expiresAt: string | null
  redeemedAt: string | null
  redeemedBy: string | null
  state: InvitationStatus
}

export type WaitlistStatus = 'unconfirmed' | 'pending' | 'invited'

export interface AdminWaitlistEntry {
  id: string
  email: string
  /** Freiwillige Angabe des Anmelders — das Kriterium fürs gezielte Freischalten. */
  note: string | null
  joinedAt: string
  confirmedAt: string | null
  invitedAt: string | null
  invitedCode: string | null
  state: WaitlistStatus
}

/** Megabyte mit einer Nachkommastelle, Gigabyte ab 1024 MB. */
export function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  if (mb < 0.1) return '0 MB'
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`
  return `${(mb / 1024).toFixed(1)} GB`
}

/** Tag.Monat.Jahr in der Zeitzone des Betrachters — kurz genug für eine Tabellenzelle. */
export function formatDate(iso: string | null): string {
  if (!iso) return '–'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '–'
  const pad2 = (n: number): string => String(n).padStart(2, '0')
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}`
}

/** Erster Buchstabe für den Punkt vor dem Namen — wie der Konto-Chip der Topbar. */
export function initial(name: string): string {
  return (name.trim().charAt(0) || '?').toUpperCase()
}

const contains = (field: string, query: string): boolean => field.toLowerCase().includes(query)

export type AccountFilter = 'all' | 'admins' | 'unconfirmed'

/**
 * Suche über alles, was jemanden identifiziert: Adresse, Klarname und
 * öffentlicher Anzeigename. Wer nach „anna" sucht, meint die Person — nicht
 * eine bestimmte Spalte.
 *
 * Der Filter beantwortet die zwei Fragen, die man an eine Kontenliste hat:
 * Wer darf verwalten, und wer hängt noch an seiner Bestätigung (und kann
 * deshalb nicht hochladen).
 */
export function filterUsers(
  list: readonly AdminUser[],
  query: string,
  filter: AccountFilter = 'all',
): AdminUser[] {
  const s = query.trim().toLowerCase()
  return list.filter((b) => {
    if (filter === 'admins' && b.role !== 'admin') return false
    if (filter === 'unconfirmed' && b.verified) return false
    if (!s) return true
    return [b.email, b.name, b.displayName ?? ''].some((field) => contains(field, s))
  })
}

export type InvitationFilter = 'all' | InvitationStatus

/**
 * Suche über Code und Notiz.
 *
 * Der Code wird ohne Trennzeichen verglichen: Wer ihn aus einer Mail kopiert
 * oder aus dem Gedächtnis tippt, schreibt „abcd2345" — an einem Bindestrich
 * darf die Suche nicht scheitern.
 */
export function filterInvitations(
  list: readonly AdminInvitation[],
  query: string,
  filter: InvitationFilter = 'all',
): AdminInvitation[] {
  const s = query.trim().toLowerCase()
  const blank = s.replace(/[^a-z0-9]/g, '')
  return list.filter((e) => {
    if (filter !== 'all' && e.state !== filter) return false
    if (!s) return true
    if (
      blank &&
      e.code
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .includes(blank)
    )
      return true
    return contains(e.note ?? '', s)
  })
}

export type WaitlistFilter = 'all' | WaitlistStatus

/** Suche über Adresse und die freiwillige Angabe — das Kriterium fürs Freischalten. */
export function filterWaitlist(
  list: readonly AdminWaitlistEntry[],
  query: string,
  filter: WaitlistFilter = 'all',
): AdminWaitlistEntry[] {
  const s = query.trim().toLowerCase()
  return list.filter((e) => {
    if (filter !== 'all' && e.state !== filter) return false
    if (!s) return true
    return [e.email, e.note ?? ''].some((field) => contains(field, s))
  })
}

/** Wie viele Einladungen in welchem Zustand — für die Zeile über der Liste. */
export function countInvitations(
  list: readonly AdminInvitation[],
): Record<InvitationStatus, number> {
  const counter: Record<InvitationStatus, number> = { open: 0, redeemed: 0, expired: 0 }
  for (const e of list) counter[e.state]++
  return counter
}

/**
 * Der Satz unter dem Code — er beantwortet die einzige Frage, die man an eine
 * Einladung hat: Kann die noch jemand benutzen, und wenn nein, wer war es?
 */
export function describeInvitation(e: AdminInvitation): string {
  if (e.state === 'redeemed') {
    const who = e.redeemedBy ?? 'einem gelöschten Konto'
    return `Eingelöst von ${who} am ${formatDate(e.redeemedAt)}`
  }
  if (e.state === 'expired') return `Abgelaufen am ${formatDate(e.expiresAt)}`
  return e.expiresAt ? `Offen · gültig bis ${formatDate(e.expiresAt)}` : 'Offen · ohne Ablaufdatum'
}

/**
 * Wie viele warten, wie viele hängen noch an ihrer Bestätigung.
 *
 * `wartend` steht vorn, weil es die einzige Zahl ist, auf die jemand handeln
 * kann: Nur bestätigte Adressen dürfen eine Einladung bekommen.
 */
export function countWaitlist(list: readonly AdminWaitlistEntry[]): Record<WaitlistStatus, number> {
  const counter: Record<WaitlistStatus, number> = { unconfirmed: 0, pending: 0, invited: 0 }
  for (const e of list) counter[e.state]++
  return counter
}

/**
 * Steht das Wartelisten-Formular gerade wirklich vor der Tür?
 *
 * Spiegel von `wartelisteAngeboten` in server/src/auth/warteliste.ts — dritte
 * Regel dieser Art, die doppelt steht (wie `rolleGesperrt`). Der Server MUSS
 * sie durchsetzen; hier hängt an ihr nur ein Satz. Die Antwort per API zu
 * holen ginge auch, aber die Schalter ändern sich im Sekundentakt, während die
 * Liste stehen bleibt: Ohne eigene Rechnung stünde nach jedem Umlegen ein
 * überholter Hinweis da.
 */
export const waitlistOffered = (
  isOpen: boolean,
  invitationRequired: boolean,
  registrationOpen: boolean,
): boolean => isOpen && (invitationRequired || !registrationOpen)

/** Der Satz unter der Adresse — wo im Ablauf dieser Eintrag gerade steht. */
export function describeWaitlistEntry(e: AdminWaitlistEntry): string {
  if (e.state === 'invited') {
    const code = e.invitedCode ? ` mit Code ${e.invitedCode}` : ''
    return `Eingeladen am ${formatDate(e.invitedAt)}${code}`
  }
  if (e.state === 'pending') return `Bestätigt am ${formatDate(e.confirmedAt)} · wartet`
  return `Eingetragen am ${formatDate(e.joinedAt)} · Bestätigung steht aus`
}

/**
 * Warum sich jemand nicht einladen lässt — leer heißt: Knopf anbieten.
 *
 * Wie bei den Rollen stehen die Regeln doppelt (hier und in
 * server/src/routes/warteliste.ts). Die wichtigste ist die erste: Eine Mail an
 * eine unbestätigte Adresse wäre genau die ungefragte Nachricht, gegen die das
 * Double-Opt-in gebaut ist.
 */
export function inviteDisabled(e: AdminWaitlistEntry): string {
  if (e.state === 'unconfirmed') return 'Diese Adresse ist noch nicht bestätigt'
  if (e.state === 'invited') return 'Schon eingeladen, der Code steht in der Liste darunter'
  return ''
}

/**
 * Der Link, den man verschickt — er führt direkt ins Registrierungsformular mit
 * eingetragenem Code. Ohne ihn müsste der Eingeladene den Code abtippen und
 * vorher raten, wo.
 */
export function invitationLink(baseUrl: string, code: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path('register', `#einladung=${encodeURIComponent(code)}`)}`
}

/**
 * Warum eine Rolle oder ein Konto festliegt — leer heißt: darf geändert werden.
 *
 * Die Regeln stehen doppelt (hier und in server/src/routes/admin.ts). Das ist
 * Absicht: Der Server MUSS sie durchsetzen, die Oberfläche SOLL den Knopf gar
 * nicht erst anbieten. Ein Formular, das erst nach dem Absenden „geht nicht"
 * sagt, ist die schlechtere Hälfte davon.
 */
export function roleChangeDisabled(target: AdminUser, selfId: string, adminCount: number): string {
  if (target.role !== 'admin') return ''
  if (target.fixed) return 'In der Konfiguration als Admin gesetzt'
  if (target.id === selfId) return 'Die eigene Admin-Rolle lässt sich nicht ablegen'
  if (adminCount <= 1) return 'Es muss mindestens einen Administrator geben'
  return ''
}

export function deleteDisabled(target: AdminUser, selfId: string, adminCount: number): string {
  if (target.id === selfId) return 'Das eigene Konto löschst du im Studio unter „Konto"'
  if (target.fixed) return 'In der Konfiguration als Admin gesetzt'
  if (target.role === 'admin' && adminCount <= 1)
    return 'Es muss mindestens einen Administrator geben'
  return ''
}

/** Wie viele Konten die Admin-Rolle tragen. */
export const countAdmins = (list: readonly AdminUser[]): number =>
  list.filter((b) => b.role === 'admin').length

// — System-Mails —

/** Die bearbeitbaren Teile einer Mail; Layout und HTML kommen vom Server. */
export interface MailParts {
  subject: string
  title: string
  text: string
  button: string
  footer: string
}

export interface MailPlaceholder {
  name: string
  description: string
  example: string
}

export interface MailTemplate {
  key: string
  name: string
  occasion: string
  placeholders: MailPlaceholder[]
  hasLink: boolean
  defaultContent: MailParts
  /** Was tatsächlich verschickt wird: die Anpassung, sonst der Standard. */
  blocks: MailParts
  customized: boolean
  updatedAt: string | null
  updatedBy: string | null
}

/**
 * Der Satz unter dem Namen — steht die Vorlage im Code oder ist sie angefasst?
 *
 * Eine unveränderte Vorlage erzählt lieber, WANN sie rausgeht: Das ist die
 * Frage, die man vor dem Bearbeiten hat. Bei einer angepassten ist die
 * dringendere, wer sie zuletzt angefasst hat.
 */
export function describeTemplate(v: MailTemplate): string {
  if (!v.customized) return v.occasion
  const who = v.updatedBy ? ` von ${v.updatedBy}` : ''
  return `Angepasst am ${formatDate(v.updatedAt)}${who}`
}

// — Betriebsprotokoll —
//
// Die letzten Warnungen und Fehler der API. Sie liegen dort in einem Ringpuffer
// im Arbeitsspeicher (server/src/protokoll.ts) — was diese Ansicht zeigt, ist
// also immer „seit dem letzten Neustart", und genau das sagt sie auch.

export type AuditLogLevel = 'warning' | 'failed'

export interface AuditLogEntry {
  no: number
  time: string
  level: AuditLogLevel
  text: string
  detail?: string
}

export type AuditLogFilter = 'all' | AuditLogLevel

/** Suche über Meldung UND Detail — die Tour-ID steht oft nur im Detail. */
export function filterAuditLog(
  list: readonly AuditLogEntry[],
  query: string,
  filter: AuditLogFilter = 'all',
): AuditLogEntry[] {
  const s = query.trim().toLowerCase()
  return list.filter((e) => {
    if (filter !== 'all' && e.level !== filter) return false
    if (!s) return true
    return [e.text, e.detail ?? ''].some((field) => contains(field, s))
  })
}

export function countAuditLogErrors(list: readonly AuditLogEntry[]): Record<AuditLogLevel, number> {
  const counter: Record<AuditLogLevel, number> = { warning: 0, failed: 0 }
  for (const e of list) counter[e.level]++
  return counter
}

/**
 * Uhrzeit mit Sekunde — bei einem Protokoll ist die Reihenfolge innerhalb einer
 * Minute die eigentliche Information („kam der Fehler VOR oder NACH dem Retry?").
 * Das Datum steht nur dabei, wenn die Meldung nicht von heute ist: Bei einem
 * Puffer, der meist Minuten alt ist, wäre es sonst in jeder Zeile Ballast.
 */
export function formatTimestamp(iso: string, now: Date = new Date()): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '–'
  const pad2 = (n: number): string => String(n).padStart(2, '0')
  const clock = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
  const sameDay =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear()
  return sameDay ? clock : `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}. ${clock}`
}

/**
 * Was über der Liste steht. Ein leerer Puffer ist die GUTE Nachricht — er darf
 * nicht wie ein Fehler aussehen („keine Daten"), sondern sagt, seit wann nichts
 * vorgefallen ist.
 */
export function describeAuditLogEntry(
  count: number,
  errors: number,
  startedAt: string | null,
): string {
  const since = startedAt
    ? ` seit dem Start der API am ${formatDate(startedAt)} um ${formatTimestamp(startedAt, new Date(startedAt))}`
    : ''
  if (count === 0) return `Nichts vorgefallen${since}.`
  const parts = [`${count} ${count === 1 ? 'Meldung' : 'Meldungen'}`]
  if (errors > 0) parts.push(`davon ${errors} ${errors === 1 ? 'Fehler' : 'Fehler'}`)
  return `${parts.join(', ')}${since}.`
}

/** Der Eingang der Alpha: was Besucher gemeldet haben. */
export type FeedbackStatus = 'open' | 'in_progress' | 'done'

export interface AdminFeedback {
  id: string
  userId: string | null
  userName: string | null
  email: string | null
  text: string
  context: Record<string, string | number | boolean | null> | null
  source: 'web' | 'app'
  status: FeedbackStatus
  note: string | null
  createdAt: string
  updatedAt: string | null
}

export type FeedbackFilter = 'all' | FeedbackStatus

/** Wortlaut der Zustände — an einer Stelle, sonst heißt derselbe Status zweimal anders. */
export const FEEDBACK_LABELS: Record<FeedbackStatus, string> = {
  open: 'Offen',
  in_progress: 'In Arbeit',
  done: 'Erledigt',
}

export function countOpenFeedback(list: readonly AdminFeedback[]): Record<FeedbackStatus, number> {
  const z: Record<FeedbackStatus, number> = { open: 0, in_progress: 0, done: 0 }
  for (const r of list) z[r.status]++
  return z
}

/**
 * Suche über Text, Notiz, Absender-Adresse und Name — also über alles, woran
 * man sich an eine Meldung erinnert. Der technische Kontext bleibt draußen:
 * Eine Suche nach „Chrome" fände sonst jede zweite Zeile.
 */
export function filterFeedback(
  list: readonly AdminFeedback[],
  query: string,
  filter: FeedbackFilter = 'all',
): AdminFeedback[] {
  const s = query.trim().toLowerCase()
  return list.filter((r) => {
    if (filter !== 'all' && r.status !== filter) return false
    if (!s) return true
    return [r.text, r.note, r.email, r.userName]
      .filter(Boolean)
      .some((field) => String(field).toLowerCase().includes(s))
  })
}

/**
 * Wer hat gemeldet? „Angemeldet als Mira" ist etwas anderes als eine
 * hinterlassene Adresse — und beides etwas anderes als anonym. Wer das
 * zusammenzieht, verliert genau die Auskunft, ob eine Rückfrage möglich ist.
 */
export function describeSender(r: AdminFeedback): string {
  if (r.userName) return r.email ? `${r.userName} · ${r.email}` : r.userName
  if (r.email) return r.email
  return 'Ohne Absender'
}

/** Der technische Kontext als eine Zeile. Leer, wenn er abgewählt war. */
export function contextLine(r: AdminFeedback): string {
  if (!r.context) return 'Ohne technische Angaben'
  return Object.entries(r.context)
    .map(([k, v]) => `${k}: ${v}`)
    .join(' · ')
}

/**
 * Läuft diese Seite auf dem eigenen Rechner?
 *
 * Der Prüfstein ist nicht „enthält localhost": `localhost.angreifer.example`
 * täte das auch. Es zählt der ganze Name oder ein Punkt davor — devhub
 * bedient jedes Projekt unter `<name>.localhost`.
 */
export function isLocal(host: string): boolean {
  return (
    host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost')
  )
}
