// Benutzerverwaltung — DOM und Ablaufsteuerung. Was gerechnet wird, liegt in
// admin-model.ts (DOM-frei, getestet); hier steht nur, wie es aussieht und was
// auf einen Klick passiert.
//
// Kein Router: Sperrseite und Verwaltung liegen beide im DOM und werden per
// `hidden` umgeschaltet — dasselbe Muster wie im Studio. Innerhalb der
// Verwaltung gilt es ein zweites Mal: Die vier Bereiche sind Reiter, alle vier
// Panels liegen im DOM, sichtbar ist eins.

import { mountAppHeader, writeAppFooter, type AppFooterLink } from '../app-nav.js'
import { path } from '../routes.js'
import { attachPasswordField } from '../password-field.js'
import * as api from './api.js'
import {
  describeSender,
  describeInvitation,
  describeAuditLogEntry,
  describeTemplate,
  describeWaitlistEntry,
  inviteDisabled,
  invitationLink,
  filterUsers,
  filterInvitations,
  filterAuditLog,
  filterFeedback,
  filterWaitlist,
  formatBytes,
  formatDate,
  formatTimestamp,
  initial,
  contextLine,
  deleteDisabled,
  roleChangeDisabled,
  FEEDBACK_LABELS,
  tabFromHash,
  waitlistOffered,
  countAdmins,
  countInvitations,
  countAuditLogErrors,
  countOpenFeedback,
  countWaitlist,
  TABS,
  type AdminUser,
  type AdminInvitation,
  type AdminFeedback,
  type AdminWaitlistEntry,
  type FeedbackFilter,
  type FeedbackStatus,
  type InvitationFilter,
  type AccountFilter,
  type MailParts,
  type MailTemplate,
  type AuditLogEntry,
  type AuditLogFilter,
  type Role,
  type TabId,
  type WaitlistFilter,
  isLocal,
} from './admin-model.js'

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

const els = {
  locked: $('locked-view'),
  lockedTitle: $('locked-title'),
  lockedText: $('locked-text'),
  lockedExit: $<HTMLAnchorElement>('locked-exit'),
  admin: $('admin-view'),
  tabs: $('tabs'),
  // Konten
  accountsList: $('accounts-list'),
  accountsFilter: $('accounts-filter'),
  accountsSearch: $<HTMLInputElement>('accounts-search'),
  accountNew: $<HTMLButtonElement>('account-new'),
  // Einladungen
  invitationRequiredSwitch: $<HTMLButtonElement>('invitation-required-switch'),
  invitationRequiredText: $('invitation-required-text'),
  registrationClosedWarning: $('registration-closed-warning'),
  invitationsList: $('invitations-list'),
  invitationsFilter: $('invitations-filter'),
  invitationsSearch: $<HTMLInputElement>('invitations-search'),
  invitationNew: $<HTMLButtonElement>('invitation-new'),
  // Warteliste
  waitlistSwitch: $<HTMLButtonElement>('waitlist-switch'),
  waitlistSwitchText: $('waitlist-switch-text'),
  waitlistToInvitationRequired: $<HTMLButtonElement>('waitlist-to-invitation-required'),
  waitlistList: $('waitlist-list'),
  waitlistFilter: $('waitlist-filter'),
  waitlistSearch: $<HTMLInputElement>('waitlist-search'),
  // Rückmeldungen
  feedbackList: $('feedback-list'),
  feedbackFilter: $('feedback-filter'),
  feedbackSearch: $<HTMLInputElement>('feedback-search'),
  // Protokoll
  auditLogSummary: $('audit-log-summary'),
  auditLogList: $('audit-log-list'),
  auditLogFilter: $('audit-log-filter'),
  auditLogSearch: $<HTMLInputElement>('audit-log-search'),
  // Rückfrage
  confirmDialog: $<HTMLDialogElement>('confirm-dialog'),
  confirmForm: $<HTMLFormElement>('confirm-form'),
  confirmTitle: $('confirm-title'),
  confirmText: $('confirm-text'),
  confirmYes: $<HTMLButtonElement>('confirm-yes'),
  confirmNo: $<HTMLButtonElement>('confirm-no'),
  // Konto-Dialog
  accountDialog: $<HTMLDialogElement>('account-dialog'),
  accountForm: $<HTMLFormElement>('account-form'),
  accountDialogTitle: $('account-dialog-title'),
  accountDialogSubline: $('account-dialog-subline'),
  accountDialogName: $<HTMLInputElement>('account-dialog-name'),
  accountDialogEmail: $<HTMLInputElement>('account-dialog-email'),
  accountDialogPassword: $<HTMLInputElement>('account-dialog-password'),
  accountDialogPwExtra: $('account-dialog-pw-extra'),
  accountDialogRole: $<HTMLSelectElement>('account-dialog-role'),
  accountDialogRoleHint: $('account-dialog-role-hint'),
  accountDialogVerified: $<HTMLInputElement>('account-dialog-verified'),
  accountDialogError: $('account-dialog-error'),
  accountDialogSave: $<HTMLButtonElement>('account-dialog-save'),
  accountDialogCancel: $<HTMLButtonElement>('account-dialog-cancel'),
  // Einladungs-Dialog
  invitationDialog: $<HTMLDialogElement>('invitation-dialog'),
  invitationForm: $<HTMLFormElement>('invitation-form'),
  invitationNote: $<HTMLInputElement>('invitation-note'),
  invitationValidity: $<HTMLSelectElement>('invitation-validity'),
  invitationError: $('invitation-error'),
  invitationCancel: $<HTMLButtonElement>('invitation-cancel'),
  // System-Mails
  mailList: $('mail-list'),
  mailSummary: $('mail-summary'),
  mailDialog: $<HTMLDialogElement>('mail-dialog'),
  mailForm: $<HTMLFormElement>('mail-form'),
  mdTitle: $('md-title'),
  mdOccasion: $('md-occasion'),
  mdPlaceholders: $('md-placeholders'),
  mdSubject: $<HTMLInputElement>('md-subject'),
  mdMailTitle: $<HTMLInputElement>('md-mail-title'),
  mdBody: $<HTMLTextAreaElement>('md-body'),
  mdButton: $<HTMLInputElement>('md-button'),
  mdFooter: $<HTMLTextAreaElement>('md-footer'),
  mdPreviewSubject: $('md-preview-subject'),
  mdPreview: $<HTMLIFrameElement>('md-preview'),
  mdIssues: $('md-issues'),
  mdError: $('md-error'),
  mdStatus: $('md-status'),
  mdTest: $<HTMLButtonElement>('md-test'),
  mdReset: $<HTMLButtonElement>('md-reset'),
  mdCancel: $<HTMLButtonElement>('md-cancel'),
  mdSave: $<HTMLButtonElement>('md-save'),
}

interface State {
  selfId: string
  tab: TabId
  /** Solange die vier Anfragen laufen, zeigen die Listen ein Skelett. */
  loading: boolean
  /** Ist das Laden gescheitert, steht der Grund IN der Liste — samt zweitem Versuch. */
  error: string
  users: AdminUser[]
  invitations: AdminInvitation[]
  waitlist: AdminWaitlistEntry[]
  mailTemplates: MailTemplate[]
  invitationRequired: boolean
  waitlistOpen: boolean
  registrationOpen: boolean
  baseUrl: string
  accountsSearch: string
  accountsFilter: AccountFilter
  invitationsSearch: string
  invitationsFilter: InvitationFilter
  waitlistSearch: string
  waitlistFilter: WaitlistFilter
  feedback: AdminFeedback[]
  feedbackSearch: string
  feedbackFilter: FeedbackFilter
  auditLog: AuditLogEntry[]
  /** Meldungen, die eintrafen, während jemand liest — sie warten hinter dem Streifen. */
  auditLogPending: AuditLogEntry[]
  auditLogStartedAt: string | null
  auditLogSearch: string
  auditLogFilter: AuditLogFilter
}

const z: State = {
  selfId: '',
  tab: tabFromHash(location.hash),
  loading: true,
  error: '',
  users: [],
  invitations: [],
  waitlist: [],
  mailTemplates: [],
  invitationRequired: true,
  waitlistOpen: true,
  registrationOpen: true,
  baseUrl: location.origin,
  accountsSearch: '',
  accountsFilter: 'all',
  invitationsSearch: '',
  invitationsFilter: 'all',
  waitlistSearch: '',
  waitlistFilter: 'all',
  feedback: [],
  feedbackSearch: '',
  feedbackFilter: 'all',
  auditLog: [],
  auditLogPending: [],
  auditLogStartedAt: null,
  auditLogSearch: '',
  auditLogFilter: 'all',
}

/** Welches Konto der Dialog gerade bearbeitet; null = ein neues anlegen. */
let editing: AdminUser | null = null

// Auch ein vom Admin gesetztes Passwort wird bewertet — es schützt dasselbe
// Konto wie ein selbst gewähltes. Beim Bearbeiten darf das Feld leer bleiben
// („nicht ändern"), deshalb sperrt der Knopf nur bei tatsächlich schwacher Wahl.
const accountDialogPasswordField = attachPasswordField(els.accountDialogPassword, {
  personal: () => [els.accountDialogName.value, els.accountDialogEmail.value],
  onChange: (assessment) => {
    els.accountDialogSave.disabled =
      els.accountDialogPassword.value.length > 0 && !assessment.acceptable
  },
})

// — Rückmeldung —

const ICON_OK =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>'
const ICON_FAILED =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>'

let flashEl: HTMLElement | null = null
let flashTimer = 0

/**
 * Eine Meldung zur Zeit, mittig unter der Kopfleiste (DESIGN.md).
 *
 * Ein Fehler steht länger als ein Erfolg: Bei „gespeichert" reicht der Blick,
 * bei „ging nicht" will man den Satz lesen.
 */
function flash(text: string, tone: 'ok' | 'failed' = 'ok'): void {
  flashEl?.remove()
  const el = document.createElement('div')
  el.className = `flash ${tone}`
  el.setAttribute('role', 'status')
  el.innerHTML = tone === 'failed' ? ICON_FAILED : ICON_OK
  const label = document.createElement('span')
  label.textContent = text
  el.append(label)
  document.body.appendChild(el)
  flashEl = el
  requestAnimationFrame(() => el.classList.add('showing'))
  clearTimeout(flashTimer)
  flashTimer = window.setTimeout(
    () => {
      el.classList.remove('showing')
      window.setTimeout(() => el.remove(), 240)
    },
    tone === 'failed' ? 7000 : 4200,
  )
}

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : 'Unbekannter Fehler'

/**
 * Rückfrage vor allem, was sich nicht zurücknehmen lässt.
 *
 * `window.confirm` sah aus wie ein Browser-Alarm, nannte oben die Domain und
 * gab dem gefährlichen Knopf dieselbe Gestalt wie dem harmlosen. Hier trägt
 * der Titel die Frage, der Text die Folge — und der bestätigende Knopf ist
 * rot, wenn etwas verloren geht.
 */
interface Confirm {
  title: string
  text: string
  yes?: string
  danger?: boolean
}

/**
 * Die offene Frage. Sie wird von den Knöpfen aufgelöst, NICHT vom
 * `close`-Ereignis des Dialogs: Das kam in der Abnahme nicht an, und ein
 * Versprechen, das an einem Ereignis hängt, das ausbleibt, hängt für immer —
 * der Löschen-Knopf tat dann schlicht nichts. `close`/`cancel` bleiben als
 * Auffangnetz für die Esc-Taste und den Rücken-Knopf.
 */
let confirmResolve: ((yes: boolean) => void) | null = null

function closeConfirm(yes: boolean): void {
  const resolve = confirmResolve
  confirmResolve = null
  if (els.confirmDialog.open) els.confirmDialog.close()
  resolve?.(yes)
}

function askConfirm(o: Confirm): Promise<boolean> {
  // Eine zweite Frage über der ersten kann es nicht geben — käme sie doch,
  // gilt die alte als verneint, statt still liegen zu bleiben.
  confirmResolve?.(false)
  els.confirmTitle.textContent = o.title
  els.confirmText.textContent = o.text
  els.confirmYes.textContent = o.yes ?? 'Bestätigen'
  els.confirmYes.className = o.danger ? 'destructive' : 'primary'
  // Kein Fokus auf den bestätigenden Knopf: `showModal` fokussiert das erste
  // Element im Formular — „Abbrechen". Bei einer Löschung ist das die richtige
  // Vorbelegung für ein gedankenloses Enter.
  els.confirmDialog.showModal()
  return new Promise((resolve) => {
    confirmResolve = resolve
  })
}

els.confirmForm.addEventListener('submit', (e) => {
  e.preventDefault()
  closeConfirm(true)
})
els.confirmNo.addEventListener('click', () => closeConfirm(false))
for (const tone of ['close', 'cancel']) {
  els.confirmDialog.addEventListener(tone, () => closeConfirm(false))
}

// — Laden —

async function load(): Promise<void> {
  z.error = ''
  try {
    const [accounts, invitationsData, waitlist, feedback, mails, auditLog, stats] =
      await Promise.all([
        api.loadUsers(),
        api.loadInvitations(),
        api.loadWaitlist(),
        api.loadFeedback(),
        api.loadMailTemplates(),
        api.loadAuditLog(),
        api.loadStats().catch(() => ({
          realtime: 0,
          today: { pageviews: 0, visitors: 0 },
          last7Days: { pageviews: 0, visitors: 0 },
          total: 0,
          referrer: [],
          pages: [],
        })),
      ])
    z.users = accounts.users
    z.invitations = invitationsData.invitations
    z.invitationRequired = invitationsData.invitationRequired
    z.registrationOpen = invitationsData.registrationOpen
    z.baseUrl = invitationsData.baseUrl || location.origin
    z.waitlist = waitlist.entries
    z.waitlistOpen = waitlist.waitlistOpen
    z.feedback = feedback.feedback
    z.auditLog = auditLog.entries
    z.auditLogPending = []
    z.auditLogStartedAt = auditLog.startedAt
    z.mailTemplates = mails.templates
    renderStats(stats)
  } catch (error) {
    z.error = errorText(error)
    throw error
  } finally {
    z.loading = false
    render()
  }
}

function renderStats(s: api.AdminStats): void {
  const format = (n: number) => n.toLocaleString('de-DE')
  const realtimeEl = $('stat-realtime')
  if (realtimeEl) realtimeEl.textContent = format(s.realtime)
  const todayViews = $('stat-today-views')
  if (todayViews) todayViews.textContent = format(s.today.pageviews)
  const todayVisitors = $('stat-today-visitors')
  if (todayVisitors) todayVisitors.textContent = `${format(s.today.visitors)} Besucher`
  const sevenDayViews = $('stat-7d-views')
  if (sevenDayViews) sevenDayViews.textContent = format(s.last7Days.pageviews)
  const sevenDayVisitors = $('stat-7d-visitors')
  if (sevenDayVisitors) sevenDayVisitors.textContent = `${format(s.last7Days.visitors)} Besucher`
  const totalEl = $('stat-total')
  if (totalEl) totalEl.textContent = format(s.total)

  const referrerList = $('stat-referrer-list')
  if (referrerList) {
    if (!s.referrer.length) {
      referrerList.innerHTML =
        '<div style="color: var(--text-3); font-size: 13px; padding: 6px 0;">Noch keine Daten erfasst.</div>'
    } else {
      referrerList.innerHTML = s.referrer
        .map(
          (r) =>
            `<div class="stat-row"><span class="name">${r.source}</span><span class="count">${format(r.count)}</span></div>`,
        )
        .join('')
    }
  }

  const pagesList = $('stat-pages-list')
  if (pagesList) {
    if (!s.pages.length) {
      pagesList.innerHTML =
        '<div style="color: var(--text-3); font-size: 13px; padding: 6px 0;">Noch keine Daten erfasst.</div>'
    } else {
      pagesList.innerHTML = s.pages
        .map(
          (p) =>
            `<div class="stat-row"><span class="name">${p.path}</span><span class="count">${format(p.count)}</span></div>`,
        )
        .join('')
    }
  }
}

/**
 * Die Links der Fußzeile — auf dem eigenen Rechner mit dem Weg zur Doku.
 *
 * Sie steht in der FUSSZEILE und nicht in der Hauptnavigation: Die Kopfleiste
 * ist die Navigation des Produkts (Meine Touren, Entdecken), und ein
 * Werkzeug-Link, den es auf dem Server gar nicht gibt, hat dort nichts
 * verloren. Die Fußzeile der Verwaltung trägt ohnehin, was den Betreiber
 * angeht.
 *
 * Die Doku selbst liegt unter `/doku` und wird nur vom Dev- und
 * Vorschau-Server ausgeliefert (Plugin `maptale-doku` in vite.config.js);
 * geprüft wird deshalb der Hostname (`istLokal` im Modell).
 */
function footerLinks(): { links: AppFooterLink[] } {
  const links: AppFooterLink[] = [
    { href: path('imprint'), label: 'Impressum' },
    { href: path('privacy'), label: 'Datenschutz' },
  ]
  if (isLocal(location.hostname)) links.push({ href: '/doku/', label: 'Doku (lokal)' })
  return { links }
}

async function start(): Promise<void> {
  await mountAppHeader(document.getElementById('app-header'), {
    active: 'admin',
    variant: 'admin',
  })
  writeAppFooter(document.getElementById('app-footer'), footerLinks())
  const session = await api.me()
  if (!session.user) {
    els.lockedTitle.textContent = 'Nicht angemeldet'
    els.lockedText.textContent = 'Melde dich an, um die Verwaltung zu öffnen.'
    els.lockedExit.textContent = 'Zur Anmeldung'
    els.locked.hidden = false
    return
  }
  if (session.user.role !== 'admin') {
    els.locked.hidden = false
    return
  }
  z.selfId = session.user.id
  els.admin.hidden = false
  showTab(z.tab)
  render()
  try {
    await load()
  } catch (error) {
    flash(errorText(error), 'failed')
  }
}

// — Reiter —

/**
 * Was am Reiter steht. Die Zahl ist nicht überall dieselbe Sorte: Bei den
 * Konten sind es alle, bei Einladungen und Warteliste nur die, auf die man
 * handeln kann — sonst wäre der Zähler eine Statistik statt eines Hinweises.
 */
function tabCount(id: TabId): { value: number; important: boolean } {
  if (id === 'accounts') return { value: z.users.length, important: false }
  if (id === 'stats') return { value: 0, important: false }
  if (id === 'invitations') return { value: countInvitations(z.invitations).open, important: false }
  if (id === 'waitlist') {
    const wartend = countWaitlist(z.waitlist).pending
    return { value: wartend, important: wartend > 0 }
  }
  // Wie bei der Warteliste zählt nur, worauf man handeln kann: OFFENE
  // Meldungen. Eine erledigte an den Reiter zu schreiben hieße, dauerhaft eine
  // Zahl zu zeigen, die nie kleiner wird.
  if (id === 'feedback') {
    const open = countOpenFeedback(z.feedback).open
    return { value: open, important: open > 0 }
  }
  // Beim Protokoll zählen die FEHLER, nicht alle Meldungen: Eine Warnung ist
  // Betrieb, ein Fehler ist etwas, das jemand ansehen sollte — und nur das
  // gehört als amberne Zahl an einen Reiter.
  if (id === 'audit-log') {
    const error = countAuditLogErrors([...z.auditLog, ...z.auditLogPending]).failed
    return { value: error, important: error > 0 }
  }
  return { value: z.mailTemplates.length, important: false }
}

function renderTabs(): void {
  els.tabs.replaceChildren(
    ...TABS.map((t) => {
      const active = t.id === z.tab
      const button = document.createElement('button')
      button.type = 'button'
      button.id = `tab-${t.id}`
      button.setAttribute('role', 'tab')
      button.setAttribute('aria-selected', String(active))
      button.setAttribute('aria-controls', `panel-${t.id}`)
      // Rollender Tabindex: Aus der Leiste führt EIN Tabstopp heraus, zwischen
      // den Reitern bewegt man sich mit den Pfeiltasten (ARIA-Muster „tabs").
      button.tabIndex = active ? 0 : -1
      const name = document.createElement('span')
      name.textContent = t.name
      button.append(name)
      if (!z.loading) {
        const { value, important } = tabCount(t.id)
        const number = document.createElement('span')
        number.className = important ? 'z important' : 'z'
        number.textContent = String(value)
        button.append(number)
        button.setAttribute('aria-label', `${t.name}, ${value} ${t.counts}`)
        button.title = `${value} ${t.counts}`
      }
      button.addEventListener('click', () => setTab(t.id))
      return button
    }),
  )
}

/** Nur die Sichtbarkeit umlegen — ohne die Adresszeile anzufassen. */
function showTab(id: TabId): void {
  for (const t of TABS) {
    const panel = document.getElementById(`panel-${t.id}`)
    if (panel) panel.hidden = t.id !== id
  }
}

/**
 * Reiter wechseln. Der Anhang wird per `replaceState` nachgeschrieben, nicht
 * per `pushState`: Sonst führte der Zurück-Knopf durch die zuletzt besuchten
 * Reiter, statt die Seite zu verlassen — und die Verwaltung ist eine Station,
 * kein Verlauf.
 */
function setTab(id: TabId, opt: { focus?: boolean } = {}): void {
  z.tab = id
  showTab(id)
  renderTabs()
  const button = document.getElementById(`tab-${id}`)
  // Am Telefon passen nicht alle vier in die Leiste. `block: 'nearest'` hält
  // die Seite dabei senkrecht in Ruhe — sonst spränge sie bei jedem Wechsel.
  button?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  if (opt.focus) button?.focus()
  const hash = `#${id}`
  if (location.hash !== hash) history.replaceState(null, '', hash)
}

els.tabs.addEventListener('keydown', (e) => {
  const now = TABS.findIndex((t) => t.id === z.tab)
  let target = -1
  if (e.key === 'ArrowRight') target = (now + 1) % TABS.length
  else if (e.key === 'ArrowLeft') target = (now - 1 + TABS.length) % TABS.length
  else if (e.key === 'Home') target = 0
  else if (e.key === 'End') target = TABS.length - 1
  else return
  e.preventDefault()
  const tab = TABS[target]
  if (tab) setTab(tab.id, { focus: true })
})

// Von Hand geänderter Anhang (oder ein Sprung aus dem Verlauf).
window.addEventListener('hashchange', () => {
  const id = tabFromHash(location.hash)
  if (id === z.tab) return
  z.tab = id
  showTab(id)
  renderTabs()
})

// — Bausteine der Listen —

interface Chip<T extends string> {
  value: T
  name: string
  number: number
}

/**
 * Filter-Segmente. Die Zahlen zählen INNERHALB der laufenden Suche — dadurch
 * beantwortet die Leiste zwei Fragen auf einmal: wie viele passen, und wie sie
 * sich auf die Zustände verteilen.
 */
function renderFilter<T extends string>(
  el: HTMLElement,
  chips: readonly Chip<T>[],
  active: T,
  choose: (value: T) => void,
): void {
  el.replaceChildren(
    ...chips.map((c) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.setAttribute('aria-pressed', String(c.value === active))
      const name = document.createElement('span')
      name.textContent = c.name
      const number = document.createElement('span')
      number.className = 'z'
      number.textContent = String(c.number)
      button.append(name, number)
      // Aus dem Inhalt gelesen ergäbe der Name „Alle3" — zwei aneinander
      // stoßende Inline-Elemente bekommen keinen Zwischenraum.
      button.setAttribute('aria-label', `${c.name}, ${c.number}`)
      button.addEventListener('click', () => choose(c.value))
      return button
    }),
  )
}

function skeleton(count: number): HTMLElement[] {
  return Array.from({ length: count }, () => {
    const row = document.createElement('div')
    row.className = 'skeleton'
    row.append(document.createElement('span'), document.createElement('span'))
    return row
  })
}

function emptyState(
  title: string,
  text: string,
  action?: { name: string; act: () => void },
): HTMLElement {
  const empty = document.createElement('div')
  empty.className = 'empty'
  const b = document.createElement('b')
  b.textContent = title
  const p = document.createElement('p')
  p.textContent = text
  empty.append(b, p)
  if (action) {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = action.name
    button.addEventListener('click', action.act)
    empty.append(button)
  }
  return empty
}

/**
 * Gemeinsamer Rahmen jeder Liste: Skelett beim Laden, Grund samt zweitem
 * Versuch beim Scheitern, sonst die Zeilen. Ohne das stünde nach einem
 * abgerissenen Netz überall „Noch keine Konten" — eine Behauptung, die keiner
 * geprüft hat.
 */
function fillList(el: HTMLElement, rows: HTMLElement[], empty: () => HTMLElement): void {
  if (z.loading) {
    el.replaceChildren(...skeleton(4))
    return
  }
  if (z.error) {
    el.replaceChildren(
      emptyState('Konnte nicht geladen werden', z.error, {
        name: 'Erneut versuchen',
        act: () => {
          z.loading = true
          render()
          void load().catch((f) => flash(errorText(f), 'failed'))
        },
      }),
    )
    return
  }
  el.replaceChildren(...(rows.length ? rows : [empty()]))
}

/** Kopf einer Zeile: Punkt, fette Zeile mit Plaketten, graue Zeile darunter. */
function mainCell(dot: string | null): {
  root: HTMLElement
  top: HTMLElement
  text: HTMLElement
} {
  const root = document.createElement('div')
  root.className = 'main'
  if (dot !== null) {
    const circle = document.createElement('span')
    circle.className = 'dot-large'
    circle.setAttribute('aria-hidden', 'true')
    circle.textContent = dot
    root.append(circle)
  }
  const text = document.createElement('div')
  text.className = 'main-text'
  const top = document.createElement('div')
  top.className = 'top'
  text.append(top)
  root.append(text)
  return { root, top, text }
}

function badge(tone: string, label: string, hint?: string): HTMLElement {
  const el = document.createElement('span')
  el.className = `badge ${tone}`
  el.textContent = label
  if (hint) el.title = hint
  return el
}

function stat(value: string, label: string): HTMLElement {
  const el = document.createElement('div')
  el.className = 'stat'
  const b = document.createElement('b')
  b.textContent = value
  const span = document.createElement('span')
  span.textContent = label
  el.append(b, span)
  return el
}

/**
 * Ein Griff am rechten Rand. `gesperrt` ist der GRUND, nicht ein Wahrheitswert:
 * Er landet im Tooltip UND im `aria-label`, denn ein `title` allein verdrängt
 * je nach Vorlese-Werkzeug das Wort „Löschen" — und ein gesperrter Knopf ohne
 * Begründung ist eine Sackgasse.
 */
function actionButton(
  label: string,
  act: () => void,
  opt: { danger?: boolean; disabled?: string } = {},
): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = opt.danger ? 'subtle danger' : 'subtle'
  button.textContent = label
  if (opt.disabled) {
    button.disabled = true
    button.title = opt.disabled
    button.setAttribute('aria-label', `${label}, ${opt.disabled}`)
  } else {
    button.addEventListener('click', act)
  }
  return button
}

function actionRow(...buttons: HTMLElement[]): HTMLElement {
  const el = document.createElement('div')
  el.className = 'grips'
  el.append(...buttons)
  return el
}

// — Rendern —

function render(): void {
  renderTabs()
  renderRegistration()
  renderAccounts()
  renderInvitations()
  renderWaitlist()
  renderFeedback()
  renderMailTemplates()
  renderAuditLog()
}

function renderRegistration(): void {
  els.invitationRequiredSwitch.setAttribute('aria-pressed', String(z.invitationRequired))
  els.invitationRequiredText.textContent = z.invitationRequired
    ? 'Neue Konten entstehen nur über einen Einladungscode. Schalte es aus, damit sich jeder selbst anmelden kann.'
    : 'Jeder kann sich selbst anmelden. Die Bestätigungsmail bleibt Pflicht. Schalte es ein, um wieder nur Eingeladene hereinzulassen.'
  els.registrationClosedWarning.hidden = z.registrationOpen

  els.waitlistSwitch.setAttribute('aria-pressed', String(z.waitlistOpen))
  // Der Schalter ist eingeschaltet und trotzdem wirkungslos, solange sich jeder
  // anmelden kann — das gehört dazugesagt, sonst sucht man den Eintrag
  // vergeblich vor der Tür. Und weil die Ursache im anderen Reiter liegt,
  // steht daneben der Weg dorthin.
  const ineffective =
    z.waitlistOpen && !waitlistOffered(z.waitlistOpen, z.invitationRequired, z.registrationOpen)
  els.waitlistSwitchText.textContent = ineffective
    ? 'Angeschaltet, aber ohne Wirkung: Solange sich jeder selbst anmelden kann, braucht niemand eine Warteliste.'
    : z.waitlistOpen
      ? 'Wer keinen Code hat, kann seine Adresse hinterlassen und wird per Mail eingeladen.'
      : 'Ohne Code endet der Weg vor der Tür. Schalte es ein, um Adressen zu sammeln.'
  els.waitlistToInvitationRequired.hidden = !ineffective
}

function renderAccounts(): void {
  const found = filterUsers(z.users, z.accountsSearch)
  // Die Sperr-Regeln zählen über ALLE Konten, nicht über die sichtbaren: Ein
  // Filter darf nicht darüber entscheiden, ob der letzte Admin löschbar wird.
  const admins = countAdmins(z.users)
  renderFilter(
    els.accountsFilter,
    [
      { value: 'all', name: 'Alle', number: found.length },
      {
        value: 'admins',
        name: 'Administratoren',
        number: found.filter((b) => b.role === 'admin').length,
      },
      {
        value: 'unconfirmed',
        name: 'Unbestätigt',
        number: found.filter((b) => !b.verified).length,
      },
    ] satisfies Chip<AccountFilter>[],
    z.accountsFilter,
    (value) => {
      z.accountsFilter = value
      renderAccounts()
    },
  )

  const visible = filterUsers(found, '', z.accountsFilter)
  const rows = visible.map((b) => {
    const row = document.createElement('div')
    row.className = 'row row-account'

    const head = mainCell(initial(b.name || b.email))
    const name = document.createElement('span')
    name.className = 'name'
    name.textContent = b.name || b.email
    head.top.append(name, badge(b.role, b.role === 'admin' ? 'Administrator' : 'Nutzer'))
    if (b.fixed) {
      head.top.append(
        badge('user', 'Fest', 'Steht in der Konfiguration: Rolle und Konto sind unantastbar'),
      )
    }
    if (!b.verified) {
      head.top.append(
        badge('unconfirmed', 'Unbestätigt', 'E-Mail noch nicht bestätigt. Hochladen ist gesperrt'),
      )
    }
    const bottom = document.createElement('div')
    bottom.className = 'bottom'
    bottom.textContent = `${b.email} · seit ${formatDate(b.createdAt)}`
    head.text.append(bottom)

    row.append(
      head.root,
      stat(String(b.tours), b.tours === 1 ? 'Tour' : 'Touren'),
      stat(formatBytes(b.storage), 'belegt'),
      actionRow(
        actionButton('Bearbeiten', () => openAccountDialog(b)),
        actionButton('Löschen', () => void deleteAccount(b), {
          danger: true,
          disabled: deleteDisabled(b, z.selfId, admins),
        }),
      ),
    )
    return row
  })

  fillList(els.accountsList, rows, () =>
    z.users.length
      ? emptyState(
          'Kein Konto passt',
          'Weder Name noch E-Mail treffen die Suche, oder der Filter blendet sie aus.',
          {
            name: 'Suche und Filter zurücksetzen',
            act: () => {
              z.accountsSearch = ''
              z.accountsFilter = 'all'
              els.accountsSearch.value = ''
              renderAccounts()
            },
          },
        )
      : emptyState(
          'Noch keine Konten',
          'Hier stehen alle, die sich angemeldet haben, samt Touren und belegtem Speicher.',
          {
            name: 'Konto anlegen',
            act: () => openAccountDialog(null),
          },
        ),
  )
}

function renderInvitations(): void {
  const found = filterInvitations(z.invitations, z.invitationsSearch)
  const number = countInvitations(found)
  renderFilter(
    els.invitationsFilter,
    [
      { value: 'all', name: 'Alle', number: found.length },
      { value: 'open', name: 'Offen', number: number.open },
      { value: 'redeemed', name: 'Eingelöst', number: number.redeemed },
      { value: 'expired', name: 'Abgelaufen', number: number.expired },
    ] satisfies Chip<InvitationFilter>[],
    z.invitationsFilter,
    (value) => {
      z.invitationsFilter = value
      renderInvitations()
    },
  )

  const visible = filterInvitations(found, '', z.invitationsFilter)
  const rows = visible.map((e) => {
    const row = document.createElement('div')
    row.className = 'row row-invitation'

    const head = mainCell(null)
    const code = document.createElement('span')
    code.className = 'code'
    code.textContent = e.code
    head.top.append(
      code,
      badge(e.state, { open: 'Offen', redeemed: 'Eingelöst', expired: 'Abgelaufen' }[e.state]),
    )
    if (e.note) {
      const note = document.createElement('span')
      note.className = 'note'
      note.textContent = e.note
      note.title = e.note
      head.top.append(note)
    }
    const bottom = document.createElement('div')
    bottom.className = 'bottom'
    bottom.textContent = describeInvitation(e)
    head.text.append(bottom)

    const buttons: HTMLElement[] = []
    if (e.state === 'open') buttons.push(actionButton('Link kopieren', () => void copyLink(e.code)))
    buttons.push(
      actionButton(e.state === 'open' ? 'Widerrufen' : 'Entfernen', () => void revoke(e), {
        danger: true,
      }),
    )

    row.append(head.root, stat(formatDate(e.createdAt), 'erstellt'), actionRow(...buttons))
    return row
  })

  fillList(els.invitationsList, rows, () =>
    z.invitations.length
      ? emptyState(
          'Keine passende Einladung',
          'Kein Code und keine Notiz trifft die Suche, oder der Filter blendet sie aus.',
          {
            name: 'Suche und Filter zurücksetzen',
            act: () => {
              z.invitationsSearch = ''
              z.invitationsFilter = 'all'
              els.invitationsSearch.value = ''
              renderInvitations()
            },
          },
        )
      : emptyState(
          'Noch keine Einladung',
          'Wer eingeladen wird, bekommt einen Code und einen Link dazu, einmal einlösbar.',
          {
            name: 'Einladung erstellen',
            act: () => openInvitationDialog(),
          },
        ),
  )
}

function renderWaitlist(): void {
  const found = filterWaitlist(z.waitlist, z.waitlistSearch)
  const number = countWaitlist(found)
  renderFilter(
    els.waitlistFilter,
    [
      { value: 'all', name: 'Alle', number: found.length },
      { value: 'pending', name: 'Wartet', number: number.pending },
      { value: 'unconfirmed', name: 'Unbestätigt', number: number.unconfirmed },
      { value: 'invited', name: 'Eingeladen', number: number.invited },
    ] satisfies Chip<WaitlistFilter>[],
    z.waitlistFilter,
    (value) => {
      z.waitlistFilter = value
      renderWaitlist()
    },
  )

  const visible = filterWaitlist(found, '', z.waitlistFilter)
  const rows = visible.map((e) => {
    const row = document.createElement('div')
    row.className = 'row row-waitlist'

    const head = mainCell(initial(e.email))
    const address = document.createElement('span')
    address.className = 'name'
    address.textContent = e.email
    head.top.append(
      address,
      badge(
        { unconfirmed: 'unconfirmed', pending: 'open', invited: 'redeemed' }[e.state],
        { unconfirmed: 'Unbestätigt', pending: 'Wartet', invited: 'Eingeladen' }[e.state],
      ),
    )
    const bottom = document.createElement('div')
    bottom.className = 'bottom'
    bottom.textContent = describeWaitlistEntry(e)
    head.text.append(bottom)
    // Was jemand freiwillig geschrieben hat, ist das Kriterium fürs
    // Freischalten — eigene Zeile, nicht hinter zwei Daten gequetscht.
    if (e.note) {
      const quote = document.createElement('div')
      quote.className = 'quote'
      quote.textContent = `„${e.note}"`
      quote.title = e.note
      head.text.append(quote)
    }

    // Der Knopf bezieht sich auf sich selbst (er sperrt sich für die Dauer des
    // Versands) — die Pfeilfunktion läuft erst beim Klick, da steht er längst.
    const invite: HTMLButtonElement = actionButton(
      'Einladen',
      () => void inviteFromWaitlist(e, invite),
      { disabled: inviteDisabled(e) },
    )

    row.append(
      head.root,
      stat(formatDate(e.joinedAt), 'eingetragen'),
      actionRow(
        invite,
        actionButton('Entfernen', () => void removeWaitlistEntry(e), { danger: true }),
      ),
    )
    return row
  })

  fillList(els.waitlistList, rows, () =>
    z.waitlist.length
      ? emptyState(
          'Kein passender Eintrag',
          'Weder Adresse noch Notiz trifft die Suche, oder der Filter blendet sie aus.',
          {
            name: 'Suche und Filter zurücksetzen',
            act: () => {
              z.waitlistSearch = ''
              z.waitlistFilter = 'all'
              els.waitlistSearch.value = ''
              renderWaitlist()
            },
          },
        )
      : emptyState(
          'Noch niemand trägt sich ein',
          'Wer keinen Code hat, hinterlässt hier seine Adresse. Nach der Bestätigung per Mail steht sie in dieser Liste.',
        ),
  )
}

/**
 * Die vier System-Mails.
 *
 * Als Karten, nicht als Liste: Es sind vier feste Stücke, und sie wachsen
 * nicht. Was in der Karte steht, ist genau das, was von außen ankommt — Name
 * und Betreff. Der Rest (Anlass, letzte Änderung) ist die Unterzeile: Eine
 * Vorlage, die niemand angefasst hat, erzählt lieber, wann sie rausgeht.
 */
function renderMailTemplates(): void {
  if (z.loading || z.error) {
    els.mailSummary.textContent = z.error || 'Wird geladen …'
    els.mailList.replaceChildren()
    return
  }
  const customized = z.mailTemplates.filter((v) => v.customized).length
  els.mailSummary.textContent = customized
    ? `${z.mailTemplates.length} Vorlagen · ${customized} angepasst. Bearbeitbar sind die Worte; Layout und Logo stehen fest.`
    : `${z.mailTemplates.length} Vorlagen im Auslieferungszustand. Bearbeitbar sind die Worte; Layout und Logo stehen fest.`

  els.mailList.replaceChildren(
    ...z.mailTemplates.map((v) => {
      const card = document.createElement('div')
      card.className = 'mail-card'

      const top = document.createElement('div')
      top.className = 'top'
      const name = document.createElement('span')
      name.className = 'name'
      name.textContent = v.name
      top.append(
        name,
        badge(v.customized ? 'customized' : 'standard', v.customized ? 'Angepasst' : 'Standard'),
      )

      const subject = document.createElement('div')
      subject.className = 'subject'
      subject.textContent = v.blocks.subject
      subject.title = v.blocks.subject

      const bottom = document.createElement('div')
      bottom.className = 'bottom'
      bottom.textContent = describeTemplate(v)

      const test = actionButton('Testmail', () => void sendTestMailFor(v.key, undefined, test))
      card.append(
        top,
        subject,
        bottom,
        actionRow(
          actionButton('Bearbeiten', () => openMailDialog(v)),
          test,
        ),
      )
      return card
    }),
  )
}

// — Protokoll —
//
// Was die API zuletzt gemeldet hat. Der Puffer liegt dort im Arbeitsspeicher,
// diese Ansicht ist also immer „seit dem letzten Neustart" — der Satz darüber
// sagt das, damit Leere nicht als „alles gut" gelesen wird.

/**
 * Der Eingang der Alpha. Eine Zeile trägt vier Dinge, und jedes davon fehlte
 * schmerzlich: den TEXT (ungekürzt, das ist die Meldung), WER es war (angemeldet
 * oder Adresse oder anonym — daran hängt, ob eine Rückfrage geht), WORAUF es
 * passierte (der technische Kontext, sofern mitgeschickt) und die NOTIZ.
 *
 * Der Status ist ein Auswahlfeld und kein Knopf: Drei Zustände über zwei Knöpfe
 * zu verteilen hieße raten, welcher der nächste ist — „erledigt" folgt oft
 * direkt auf „offen", ohne Zwischenschritt.
 */
function renderFeedback(): void {
  const found = filterFeedback(z.feedback, z.feedbackSearch)
  const number = countOpenFeedback(found)
  renderFilter(
    els.feedbackFilter,
    [
      { value: 'all', name: 'Alle', number: found.length },
      { value: 'open', name: FEEDBACK_LABELS.open, number: number.open },
      { value: 'in_progress', name: FEEDBACK_LABELS.in_progress, number: number.in_progress },
      { value: 'done', name: FEEDBACK_LABELS.done, number: number.done },
    ] satisfies Chip<FeedbackFilter>[],
    z.feedbackFilter,
    (value) => {
      z.feedbackFilter = value
      renderFeedback()
    },
  )

  const visible = filterFeedback(found, '', z.feedbackFilter)
  const rows = visible.map((r) => {
    const row = document.createElement('div')
    row.className = 'row row-feedback'

    const head = mainCell(initial(r.userName ?? r.email ?? '?'))
    const sender = document.createElement('span')
    sender.className = 'name'
    sender.textContent = describeSender(r)
    head.top.append(
      sender,
      badge(
        { open: 'open', in_progress: 'unconfirmed', done: 'redeemed' }[r.status],
        FEEDBACK_LABELS[r.status],
      ),
    )
    if (r.source === 'app') head.top.append(badge('unconfirmed', 'App'))

    // Der Text steht ungekürzt: Er IST die Meldung. Eine Zeile mit „…" zwänge
    // dazu, jede einzelne aufzuklappen, um zu wissen, worum es überhaupt geht.
    const text = document.createElement('div')
    text.className = 'quote'
    text.textContent = r.text
    head.text.append(text)

    const bottom = document.createElement('div')
    bottom.className = 'bottom'
    bottom.textContent = `${formatDate(r.createdAt)} · ${contextLine(r)}`
    bottom.title = contextLine(r)
    head.text.append(bottom)

    if (r.note) {
      const note = document.createElement('div')
      note.className = 'bottom'
      note.textContent = `Notiz: ${r.note}`
      head.text.append(note)
    }

    const choice = document.createElement('select')
    choice.className = 'subtle status-picker'
    choice.setAttribute('aria-label', `Status von ${describeSender(r)}`)
    for (const [value, label] of Object.entries(FEEDBACK_LABELS)) {
      const option = document.createElement('option')
      option.value = value
      option.textContent = label
      option.selected = value === r.status
      choice.append(option)
    }
    choice.addEventListener('change', () => {
      void setFeedbackStatus(r, choice.value as FeedbackStatus, choice)
    })

    row.append(
      head.root,
      actionRow(
        choice,
        actionButton('Notiz', () => void noteFeedback(r)),
        actionButton('Löschen', () => void deleteFeedbackEntry(r), { danger: true }),
      ),
    )
    return row
  })

  fillList(els.feedbackList, rows, () =>
    z.feedback.length
      ? emptyState(
          'Keine passende Rückmeldung',
          'Weder Text noch Absender trifft die Suche, oder der Filter blendet sie aus.',
          {
            name: 'Suche und Filter zurücksetzen',
            act: () => {
              z.feedbackSearch = ''
              z.feedbackFilter = 'all'
              els.feedbackSearch.value = ''
              renderFeedback()
            },
          },
        )
      : emptyState(
          'Noch nichts gemeldet',
          'Hier landet, was Besucher über den Alpha-Hinweis oder /feedback schreiben.',
        ),
  )
}

async function setFeedbackStatus(
  r: AdminFeedback,
  status: FeedbackStatus,
  choice: HTMLSelectElement,
): Promise<void> {
  choice.disabled = true
  try {
    const { feedbackItem } = await api.updateFeedback(r.id, { status })
    Object.assign(r, feedbackItem)
    flash(`Auf „${FEEDBACK_LABELS[status]}" gesetzt.`)
  } catch (error) {
    // Zurück auf den alten Wert: Ein Auswahlfeld, das den nicht gespeicherten
    // Zustand zeigt, behauptet eine Änderung, die es nicht gibt.
    choice.value = r.status
    flash(errorText(error), 'failed')
  } finally {
    choice.disabled = false
    renderTabs()
    renderFeedback()
  }
}

async function noteFeedback(r: AdminFeedback): Promise<void> {
  // Ein `prompt` und kein eigener Dialog: Es ist ein Feld, und die Notiz ist
  // eine Gedächtnisstütze für den Betreiber, kein Formular.
  const note = window.prompt('Interne Notiz zu dieser Rückmeldung', r.note ?? '')
  if (note === null) return
  try {
    const { feedbackItem } = await api.updateFeedback(r.id, { note: note.trim() || null })
    Object.assign(r, feedbackItem)
    flash('Notiz gespeichert.')
  } catch (error) {
    flash(errorText(error), 'failed')
  }
  renderFeedback()
}

async function deleteFeedbackEntry(r: AdminFeedback): Promise<void> {
  const yes = await askConfirm({
    title: 'Rückmeldung löschen?',
    text: 'Der Text und alles daran ist danach weg. Erledigte verschwinden ohnehin nach einem halben Jahr von selbst.',
    yes: 'Löschen',
    danger: true,
  })
  if (!yes) return
  try {
    await api.deleteFeedback(r.id)
    z.feedback = z.feedback.filter((x) => x.id !== r.id)
    flash('Rückmeldung gelöscht.')
  } catch (error) {
    flash(errorText(error), 'failed')
  }
  renderTabs()
  renderFeedback()
}

function renderAuditLog(): void {
  const found = filterAuditLog(z.auditLog, z.auditLogSearch)
  const number = countAuditLogErrors(found)
  renderFilter(
    els.auditLogFilter,
    [
      { value: 'all', name: 'Alle', number: found.length },
      { value: 'failed', name: 'Fehler', number: number.failed },
      { value: 'warning', name: 'Warnungen', number: number.warning },
    ] satisfies Chip<AuditLogFilter>[],
    z.auditLogFilter,
    (value) => {
      z.auditLogFilter = value
      renderAuditLog()
    },
  )

  // Der Satz beschreibt den PUFFER, nicht die Liste — also zählt er auch, was
  // noch hinter dem Streifen wartet. Sonst widerspräche er dem Reiter (der aus
  // demselben Grund alles zählt), und zwei Zahlen für dieselbe Sache, die
  // nebeneinander stehen und nicht übereinstimmen, liest man als Fehler.
  const totalEl = [...z.auditLogPending, ...z.auditLog]
  els.auditLogSummary.textContent = z.loading
    ? 'Wird geladen …'
    : describeAuditLogEntry(
        totalEl.length,
        countAuditLogErrors(totalEl).failed,
        z.auditLogStartedAt,
      )

  const visible = filterAuditLog(found, '', z.auditLogFilter)
  const filtered = !!z.auditLogSearch.trim() || z.auditLogFilter !== 'all'
  fillList(
    els.auditLogList,
    visible.map((e) => {
      const row = document.createElement('div')
      row.className = 'row row-audit-log'

      const time = document.createElement('div')
      time.className = 'time'
      time.textContent = formatTimestamp(e.time)
      time.title = new Date(e.time).toLocaleString('de-DE')

      const message = document.createElement('div')
      message.className = 'message'
      const text = document.createElement('div')
      text.className = 'text'
      text.textContent = e.text
      message.append(text)
      if (e.detail) {
        const detail = document.createElement('div')
        detail.className = 'detail'
        detail.textContent = e.detail
        message.append(detail)
      }

      row.append(time, badge(e.level, e.level === 'failed' ? 'Fehler' : 'Warnung'), message)
      return row
    }),
    () =>
      filtered
        ? emptyState('Keine passende Meldung', 'Andere Suche oder anderer Filter.', {
            name: 'Filter zurücksetzen',
            act: () => {
              z.auditLogSearch = ''
              z.auditLogFilter = 'all'
              els.auditLogSearch.value = ''
              renderAuditLog()
            },
          })
        : emptyState(
            'Nichts vorgefallen',
            'Seit dem Start der API gab es weder Warnung noch Fehler.',
          ),
  )

  // Was WÄHREND des Lesens eintraf, rutscht nicht von selbst in die Liste —
  // es wartet hinter einem Streifen, bis jemand ihn antippt.
  if (z.auditLogPending.length) {
    const count = z.auditLogPending.length
    const stripe = document.createElement('button')
    stripe.type = 'button'
    stripe.className = 'audit-log-new'
    stripe.textContent = `${count} neue ${count === 1 ? 'Meldung' : 'Meldungen'} anzeigen`
    stripe.addEventListener('click', () => {
      z.auditLog = [...z.auditLogPending, ...z.auditLog]
      z.auditLogPending = []
      renderAuditLog()
    })
    els.auditLogList.prepend(stripe)
  }
}

/**
 * Nachfragen, solange der Reiter offen und der Tab im Vordergrund ist. `seit`
 * holt nur das Neue.
 *
 * Der Neustart-Fall ist der Grund für den `gestartet`-Vergleich: Nach einem
 * Deploy beginnen die Nummern wieder bei 1, und `seit=412` fände nie wieder
 * etwas — die Ansicht bliebe für immer still und sähe dabei gesund aus.
 */
async function pollAuditLog(): Promise<void> {
  if (z.tab !== 'audit-log' || document.hidden || z.loading || z.error) return
  const peak = Math.max(0, ...z.auditLog.map((e) => e.no), ...z.auditLogPending.map((e) => e.no))
  try {
    const response = await api.loadAuditLog(peak)
    if (response.startedAt !== z.auditLogStartedAt) {
      const fresh = await api.loadAuditLog()
      z.auditLog = fresh.entries
      z.auditLogPending = []
      z.auditLogStartedAt = fresh.startedAt
    } else if (response.entries.length) {
      z.auditLogPending = [...response.entries, ...z.auditLogPending]
    } else {
      return
    }
    renderAuditLog()
    renderTabs()
  } catch {
    // Still: Ein Protokoll, das sich über sich selbst beschwert, ist Lärm.
    // Beim nächsten Reiterwechsel lädt `lade()` ohnehin neu.
  }
}

window.setInterval(() => void pollAuditLog(), 5000)
// Wer den Tab wieder nach vorn holt, will den aktuellen Stand sehen und nicht
// bis zum nächsten Intervall warten.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) void pollAuditLog()
})

// — Aktionen —

async function copyLink(code: string): Promise<void> {
  const link = invitationLink(z.baseUrl, code)
  try {
    await navigator.clipboard.writeText(link)
    flash('Einladungslink kopiert')
  } catch {
    // Ohne Zwischenablage-Recht (unsicherer Kontext, alter Browser) bleibt der
    // Link wenigstens sichtbar und markierbar.
    window.prompt('Diesen Link weitergeben:', link)
  }
}

async function revoke(e: AdminInvitation): Promise<void> {
  const open = e.state === 'open'
  const yes = await askConfirm({
    title: open ? `Einladung ${e.code} widerrufen?` : `Einladung ${e.code} entfernen?`,
    text: open
      ? 'Wer sie noch nicht eingelöst hat, kommt damit nicht mehr herein.'
      : 'Sie verschwindet aus der Liste und damit auch der Nachweis, wer über sie hereingekommen ist.',
    yes: open ? 'Widerrufen' : 'Entfernen',
    danger: true,
  })
  if (!yes) return
  try {
    await api.revokeInvitation(e.code)
    await load()
    flash('Einladung entfernt')
  } catch (error) {
    flash(errorText(error), 'failed')
  }
}

/**
 * Einladen: Code erzeugen und verschicken — ein Klick, der eine Mail auslöst.
 *
 * Deshalb die Rückfrage mit der Adresse darin: Die Liste ist nach Datum
 * sortiert und rückt bei jedem Neuladen nach, ein Fehlgriff wäre eine Nachricht
 * an die falsche Person. Der Knopf sperrt währenddessen — der Server erzeugt
 * sonst zwei Codes für dieselbe Zeile.
 */
async function inviteFromWaitlist(e: AdminWaitlistEntry, button: HTMLButtonElement): Promise<void> {
  const yes = await askConfirm({
    title: `Einladung an ${e.email} schicken?`,
    text: 'Der Code geht sofort per Mail raus.',
    yes: 'Einladung schicken',
  })
  if (!yes) return
  button.disabled = true
  try {
    const { invitation } = await api.inviteWaitlistEntry(e.id)
    await load()
    flash(`Einladung ${invitation.code} an ${e.email} verschickt`)
  } catch (error) {
    flash(errorText(error), 'failed')
    button.disabled = false
  }
}

async function removeWaitlistEntry(e: AdminWaitlistEntry): Promise<void> {
  const yes = await askConfirm({
    title: `${e.email} von der Warteliste entfernen?`,
    text: 'Die Adresse wird gelöscht. Eine noch offene Einladung an sie wird dabei widerrufen.',
    yes: 'Entfernen',
    danger: true,
  })
  if (!yes) return
  try {
    await api.deleteWaitlistEntry(e.id)
    await load()
    flash('Von der Warteliste entfernt')
  } catch (error) {
    flash(errorText(error), 'failed')
  }
}

async function deleteAccount(b: AdminUser): Promise<void> {
  const what =
    b.tours > 0
      ? `Damit gehen ${b.tours} ${b.tours === 1 ? 'Tour' : 'Touren'} samt Fotos verloren.`
      : 'Das Konto hat noch keine Touren.'
  const yes = await askConfirm({
    title: `Konto „${b.name || b.email}" endgültig löschen?`,
    text: `${what} Das lässt sich nicht rückgängig machen.`,
    yes: 'Endgültig löschen',
    danger: true,
  })
  if (!yes) return
  try {
    await api.deleteUser(b.id)
    await load()
    flash('Konto gelöscht')
  } catch (error) {
    flash(errorText(error), 'failed')
  }
}

els.invitationRequiredSwitch.addEventListener('click', async () => {
  const isNew = !z.invitationRequired
  els.invitationRequiredSwitch.disabled = true
  try {
    const response = await api.setSettings({ invitationRequired: isNew })
    z.invitationRequired = response.invitationRequired
    z.waitlistOpen = response.waitlistOpen
    renderRegistration()
    flash(isNew ? 'Registrierung nur noch mit Einladung' : 'Registrierung steht allen offen')
  } catch (error) {
    flash(errorText(error), 'failed')
  } finally {
    els.invitationRequiredSwitch.disabled = false
  }
})

els.waitlistSwitch.addEventListener('click', async () => {
  const isNew = !z.waitlistOpen
  els.waitlistSwitch.disabled = true
  try {
    const response = await api.setSettings({ waitlistOpen: isNew })
    z.invitationRequired = response.invitationRequired
    z.waitlistOpen = response.waitlistOpen
    renderRegistration()
    flash(
      isNew
        ? 'Die Warteliste steht wieder vor der Tür'
        : 'Die Warteliste wird nicht mehr angeboten',
    )
  } catch (error) {
    flash(errorText(error), 'failed')
  } finally {
    els.waitlistSwitch.disabled = false
  }
})

els.waitlistToInvitationRequired.addEventListener('click', () =>
  setTab('invitations', { focus: true }),
)

els.accountsSearch.addEventListener('input', () => {
  z.accountsSearch = els.accountsSearch.value
  renderAccounts()
})
els.invitationsSearch.addEventListener('input', () => {
  z.invitationsSearch = els.invitationsSearch.value
  renderInvitations()
})
els.waitlistSearch.addEventListener('input', () => {
  z.waitlistSearch = els.waitlistSearch.value
  renderWaitlist()
})
els.feedbackSearch.addEventListener('input', () => {
  z.feedbackSearch = els.feedbackSearch.value
  renderFeedback()
})
els.auditLogSearch.addEventListener('input', () => {
  z.auditLogSearch = els.auditLogSearch.value
  renderAuditLog()
})

// — Konto-Dialog —

function openAccountDialog(b: AdminUser | null): void {
  editing = b
  els.accountDialogError.textContent = ''
  els.accountDialogTitle.textContent = b ? 'Konto bearbeiten' : 'Konto anlegen'
  els.accountDialogSubline.textContent = b
    ? 'Änderungen greifen sofort.'
    : 'Das Konto ist sofort nutzbar, ohne Bestätigungsmail.'
  els.accountDialogName.value = b?.name ?? ''
  els.accountDialogEmail.value = b?.email ?? ''
  // Über `leere()`, nicht über `value = ''`: sonst bliebe die Stärkeanzeige des
  // vorigen Aufrufs stehen und der Speichern-Knopf womöglich gesperrt.
  accountDialogPasswordField.clear()
  els.accountDialogPassword.required = !b
  els.accountDialogPwExtra.textContent = b
    ? 'leer lassen, um es nicht zu ändern'
    : 'mindestens 8 Zeichen'
  els.accountDialogRole.value = b?.role ?? 'user'
  els.accountDialogVerified.checked = b ? b.verified : true
  els.accountDialogSave.textContent = b ? 'Speichern' : 'Anlegen'

  // Eine Rolle, die der Server ohnehin ablehnen würde, gar nicht erst anbieten.
  const disabled = b ? roleChangeDisabled(b, z.selfId, countAdmins(z.users)) : ''
  els.accountDialogRole.disabled = !!disabled
  els.accountDialogRoleHint.textContent = disabled
  els.accountDialog.showModal()
  els.accountDialogName.focus()
}

els.accountNew.addEventListener('click', () => openAccountDialog(null))
els.accountDialogCancel.addEventListener('click', () => els.accountDialog.close())
els.invitationCancel.addEventListener('click', () => els.invitationDialog.close())

els.accountForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  els.accountDialogError.textContent = ''
  const name = els.accountDialogName.value.trim()
  const email = els.accountDialogEmail.value.trim()
  const password = els.accountDialogPassword.value
  const role = els.accountDialogRole.value as Role
  const verified = els.accountDialogVerified.checked
  els.accountDialogSave.disabled = true
  try {
    if (editing) {
      const fields: api.AccountFields = { name, email, verified: verified }
      // Die Rolle nur mitschicken, wenn sie überhaupt wählbar war — sonst
      // hinge an einem gesperrten Feld eine stille Änderung.
      if (!els.accountDialogRole.disabled) fields.role = role
      if (password) fields.password = password
      await api.updateUser(editing.id, fields)
    } else {
      await api.createUser({ name, email, password: password, role: role, verified: verified })
    }
    els.accountDialog.close()
    await load()
    flash(editing ? 'Konto gespeichert' : 'Konto angelegt')
  } catch (error) {
    els.accountDialogError.textContent = errorText(error)
  } finally {
    els.accountDialogSave.disabled = false
  }
})

// — Einladungs-Dialog —

function openInvitationDialog(): void {
  els.invitationError.textContent = ''
  els.invitationNote.value = ''
  els.invitationDialog.showModal()
  els.invitationNote.focus()
}

els.invitationNew.addEventListener('click', openInvitationDialog)

els.invitationForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  els.invitationError.textContent = ''
  try {
    const { invitation } = await api.createInvitation(
      els.invitationNote.value.trim(),
      Number(els.invitationValidity.value),
    )
    els.invitationDialog.close()
    await load()
    // Direkt in die Zwischenablage: Der Code ist genau dann nützlich, wenn er
    // beim Empfänger ankommt — ein Extra-Klick dazwischen ist nur Wartezeit.
    await copyLink(invitation.code)
  } catch (error) {
    els.invitationError.textContent = errorText(error)
  }
})

// — Mail-Dialog —
//
// Zwei Dinge halten ihn zusammen: Die Vorschau kommt vom SERVER (dasselbe
// Layout, das später verschickt wird — ein zweiter Renderer im Browser wäre
// genau die Kopie, die auseinanderläuft), und sie wird gebremst nachgezogen,
// nicht bei jedem Tastendruck.

let mailTemplate: MailTemplate | null = null
let previewTimer = 0
/** Zuletzt angefasstes Textfeld — dorthin fügen die Platzhalter-Chips ein. */
let lastField: HTMLInputElement | HTMLTextAreaElement = els.mdBody

const mailFields = [els.mdSubject, els.mdMailTitle, els.mdBody, els.mdButton, els.mdFooter]

const partsFromFields = (): MailParts => ({
  subject: els.mdSubject.value,
  title: els.mdMailTitle.value,
  text: els.mdBody.value,
  button: els.mdButton.value,
  footer: els.mdFooter.value,
})

function setMailStatus(text: string, tone: 'ok' | 'failed' = 'ok'): void {
  els.mdStatus.textContent = text
  els.mdStatus.classList.toggle('failed', tone === 'failed')
}

function openMailDialog(v: MailTemplate): void {
  mailTemplate = v
  els.mdError.textContent = ''
  setMailStatus('')
  els.mdTitle.textContent = v.name
  els.mdOccasion.textContent = v.occasion
  els.mdSubject.value = v.blocks.subject
  els.mdMailTitle.value = v.blocks.title
  els.mdBody.value = v.blocks.text
  els.mdButton.value = v.blocks.button
  els.mdFooter.value = v.blocks.footer
  els.mdReset.hidden = !v.customized
  lastField = els.mdBody

  // Die Chips tragen die Erklärung im `title`: Was `{{code}}` einsetzt, sieht
  // man am Namen nicht — und eine Legende darunter läse niemand.
  els.mdPlaceholders.replaceChildren(
    ...v.placeholders.map((p) => {
      const chip = document.createElement('button')
      chip.type = 'button'
      chip.textContent = `{{${p.name}}}`
      chip.title = p.description
      chip.setAttribute('aria-label', `${p.name} einfügen, ${p.description}`)
      chip.addEventListener('click', () => insertAtCursor(`{{${p.name}}}`))
      return chip
    }),
  )

  els.mailDialog.showModal()
  els.mdSubject.focus()
  void fetchPreview()
}

/** Platzhalter an der Einfügemarke des zuletzt benutzten Feldes einsetzen. */
function insertAtCursor(text: string): void {
  const field = lastField
  const start = field.selectionStart ?? field.value.length
  const end = field.selectionEnd ?? field.value.length
  field.value = field.value.slice(0, start) + text + field.value.slice(end)
  field.focus()
  field.setSelectionRange(start + text.length, start + text.length)
  schedulePreview()
}

function schedulePreview(): void {
  clearTimeout(previewTimer)
  previewTimer = window.setTimeout(() => void fetchPreview(), 400)
}

async function fetchPreview(): Promise<void> {
  if (!mailTemplate) return
  const key = mailTemplate.key
  try {
    const response = await api.loadPreview(key, partsFromFields())
    // Zwischenzeitlich einen anderen Dialog geöffnet? Dann ist diese Antwort alt.
    if (mailTemplate?.key !== key) return
    els.mdPreviewSubject.textContent = response.subject || '–'
    els.mdPreview.srcdoc = response.html
    els.mdIssues.textContent = response.issues.join(' ')
    els.mdIssues.hidden = response.issues.length === 0
    els.mdSave.disabled = response.issues.length > 0
  } catch (error) {
    els.mdError.textContent = errorText(error)
  }
}

for (const field of mailFields) {
  field.addEventListener('input', () => {
    setMailStatus('')
    schedulePreview()
  })
  field.addEventListener('focus', () => {
    lastField = field
  })
}

/**
 * Zumachen und aufräumen in einem Zug. Nicht nur am `close`-Ereignis hängend:
 * Das kam in der Abnahme nicht an — sonst bliebe die Vorlage gesetzt und eine
 * unterwegs befindliche Vorschau schriebe in einen geschlossenen Dialog.
 */
function closeMailDialog(): void {
  mailTemplate = null
  clearTimeout(previewTimer)
  if (els.mailDialog.open) els.mailDialog.close()
}

els.mdCancel.addEventListener('click', closeMailDialog)
els.mailDialog.addEventListener('close', closeMailDialog)

els.mailForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  if (!mailTemplate) return
  els.mdError.textContent = ''
  els.mdSave.disabled = true
  try {
    await api.saveTemplate(mailTemplate.key, partsFromFields())
    closeMailDialog()
    await load()
    flash('Mail-Text gespeichert')
  } catch (error) {
    els.mdError.textContent = errorText(error)
  } finally {
    els.mdSave.disabled = false
  }
})

els.mdReset.addEventListener('click', async () => {
  if (!mailTemplate) return
  const v = mailTemplate
  // Die Rückfrage nennt den Grund: Nach dem Zurücksetzen hängt die Vorlage
  // wieder am Code — spätere Textverbesserungen kommen dann von allein mit.
  const yes = await askConfirm({
    title: `„${v.name}" auf den Auslieferungstext zurücksetzen?`,
    text: 'Deine Fassung geht dabei verloren. Dafür kommen spätere Textverbesserungen wieder von allein mit.',
    yes: 'Zurücksetzen',
    danger: true,
  })
  if (!yes) return
  try {
    await api.resetTemplate(v.key)
    closeMailDialog()
    await load()
    flash('Auf den Standardtext zurückgesetzt')
  } catch (error) {
    els.mdError.textContent = errorText(error)
  }
})

els.mdTest.addEventListener('click', () => {
  if (!mailTemplate) return
  // Aus dem offenen Dialog geht die Fassung raus, die gerade in den Feldern
  // steht — sonst prüfte die Testmail den alten Stand.
  void sendTestMailFor(mailTemplate.key, partsFromFields(), els.mdTest)
})

/**
 * Testmail an die eigene Adresse.
 *
 * Wo die Antwort erscheint, hängt daran, ob ein Dialog offen steht: Ein
 * modaler Dialog liegt im Top-Layer über allem, ein Toast dahinter läge unter
 * dessen Backdrop. Aus dem Dialog heraus meldet deshalb seine Fußzeile.
 */
async function sendTestMailFor(
  key: string,
  blocks: MailParts | undefined,
  button: HTMLButtonElement,
): Promise<void> {
  const inDialog = els.mailDialog.open
  button.disabled = true
  if (inDialog) setMailStatus('Wird verschickt …')
  try {
    const { to } = await api.sendTestMail(key, blocks)
    if (inDialog) setMailStatus(`Testmail an ${to} verschickt`)
    else flash(`Testmail an ${to} verschickt`)
  } catch (error) {
    if (inDialog) setMailStatus(errorText(error), 'failed')
    else flash(errorText(error), 'failed')
  } finally {
    button.disabled = false
  }
}

void start()
