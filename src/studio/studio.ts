// Studio-Schale: Login, Bibliothek und der Weg zu einer neuen Tour.
//
// Die Bibliothek ist die Bühne — Kacheln mit Titelbild und Routen-Signatur; der
// Upload ist eine Kachel darin und ein Fenster, das ZUERST zeigt, was Maptale
// aus den abgelegten Dateien gelesen hat, und erst danach hochlädt.
// Reine Logik liegt in import-validation.ts (Befund), upload.ts (Manifest) und exif.ts
// (Foto-Metadaten); hier nur DOM und Ablaufsteuerung.

import * as api from './api.js'
import { schreibeAppFooter, schreibeAppHeader } from '../app-nav.js'
import { codeVollstaendig, formatiereEinladungscode } from '../einladungscode.js'
import { haengePasswortfeld } from '../passwortfeld.js'
import { ROUTEN, pfad, profilPfad, tourPfad } from '../routen.js'
import {
  leseProfilCache,
  merkeAngemeldet,
  merkeProfilCache,
  vergesseAngemeldet,
} from '../session-hinweis.js'
import { readExif } from './exif.js'
import {
  buildPhotoSegments,
  mediaFromReport,
  projectPreview,
  validate,
  pointAtTime,
  estimateRideS,
  type MediumReport,
  type ImportReport,
} from './import-validation.js'
import { buildUploadManifest, exifDateToMs, isoWithZone, mediaType } from './upload.js'

// Header/Footer synchron vor den Element-Lookups — sonst finden die IDs nichts.
schreibeAppHeader(document.querySelector('#app-view > .nav'), {
  aktiv: 'studio',
  variante: 'studio',
})
schreibeAppFooter(document.getElementById('app-footer'))
// Chip aus dem Cache, sobald das Markup steht (vorher Inline-Skript im HTML).
;(() => {
  try {
    const u = leseProfilCache()
    if (!u) return
    const n = document.getElementById('benutzer-name')
    const pk = document.getElementById('benutzer-initial')
    if (n && u.name) n.textContent = u.name
    if (pk && u.avatarUrl) {
      const i = document.createElement('img')
      i.className = 'punkt'
      i.src = u.avatarUrl
      i.width = 20
      i.height = 20
      pk.replaceWith(i)
    } else if (pk && u.initial) pk.textContent = u.initial
  } catch {
    /* Cache egal */
  }
})()

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T
const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

const els = {
  loginView: $('login-view'),
  appView: $('app-view'),
  logOut: $<HTMLButtonElement>('abmelden'),
  userChip: $<HTMLButtonElement>('benutzer-chip'),
  userName: $('benutzer-name'),
  loginForm: $<HTMLFormElement>('login-form'),
  email: $<HTMLInputElement>('email'),
  passwort: $<HTMLInputElement>('password'),
  loginError: $('login-error'),
  // M9: Registrierung / Passwort-Reset
  authBox: $('auth-box'),
  // Schritt 1 der Registrierung: die Einladung
  codeForm: $<HTMLFormElement>('code-form'),
  regCode: $<HTMLInputElement>('reg-code'),
  codeError: $('code-error'),
  codeNext: $<HTMLButtonElement>('code-continue'),
  // Schritt 2: die eigenen Daten
  registerForm: $<HTMLFormElement>('register-form'),
  regEmail: $<HTMLInputElement>('reg-email'),
  regPasswort: $<HTMLInputElement>('reg-password'),
  regNewsletter: $<HTMLInputElement>('reg-newsletter'),
  regCodeChip: $('reg-code-chip'),
  regCodeValue: $('reg-code-value'),
  regCodeChange: $<HTMLButtonElement>('reg-code-change'),
  regSubmit: $<HTMLButtonElement>('reg-submit'),
  regSubline: $('reg-subline'),
  registerError: $('register-error'),
  // Warteliste: der Weg herein für alle ohne Code
  /** Der Wartelisten-Teaser unter dem Code-Formular (Block, nicht mehr Link). */
  toWaitlist: $<HTMLElement>('to-waitlist'),
  waitlistForm: $<HTMLFormElement>('waitlist-form'),
  wlEmail: $<HTMLInputElement>('waitlist-email'),
  wlNote: $<HTMLTextAreaElement>('waitlist-note'),
  wlError: $('waitlist-error'),
  wlSubmit: $<HTMLButtonElement>('waitlist-submit'),
  waitlistInfo: $('waitlist-info'),
  wlInfoTitle: $('waitlist-info-title'),
  wlInfoText: $('waitlist-info-text'),
  wlInfoError: $('waitlist-info-error'),
  wlInfoAction: $<HTMLButtonElement>('waitlist-info-action'),
  resetRequestForm: $<HTMLFormElement>('reset-request-form'),
  resetEmail: $<HTMLInputElement>('reset-email'),
  resetRequestStatus: $('reset-request-status'),
  resetSetForm: $<HTMLFormElement>('reset-set-form'),
  resetPasswort: $<HTMLInputElement>('reset-password'),
  resetSubmit: $<HTMLButtonElement>('reset-submit'),
  resetSetError: $('reset-set-error'),
  // M9: Konto-Menü + Verifikations-Banner
  accountMenu: $('konto-menue'),
  kmMail: $('km-mail'),
  kmProfile: $<HTMLAnchorElement>('km-profil'),
  kmAdmin: $('km-verwaltung'),
  kmQuotaText: $('km-quota-text'),
  kmBarFill: $('km-balken-fuell'),
  verifyBanner: $('verify-banner'),
  files: $<HTMLInputElement>('files'),
  newTop: $<HTMLButtonElement>('neu-oben'),
  // Bibliothek
  libHeader: $('library-header'),
  library: $('library'),
  search: $<HTMLInputElement>('search'),
  sort: $<HTMLSelectElement>('sort'),
  view: $('view'),
  dropOverlay: $('drop-overlay'),
  // Neue Tour
  newBackdrop: $('new-backdrop'),
  newSub: $('new-subtitle'),
  newBody: $('new-body'),
  newStatus: $('new-status'),
  newTravelModeWrap: $('new-travel-mode-wrap'),
  newTravelMode: $<HTMLSelectElement>('new-travel-mode'),
  newVisibility: $<HTMLSelectElement>('new-visibility'),
  newVisibilityWrap: $('new-visibility-wrap'),
  newWindow: $('new-window'),
  newMore: $<HTMLButtonElement>('new-more'),
  newBuild: $<HTMLButtonElement>('new-build'),
  newClose: $<HTMLButtonElement>('new-close'),
  newProgress: $('new-progress'),
  newProgressText: $('new-progress-text'),
}

/** Statisches Icon aus dem Sprite in studio.html (nur für vertrauten Markup-Bau). */
const icon = (name: string, className?: string): string =>
  `<svg${className ? ` class="${className}"` : ''} aria-hidden="true"><use href="#i-${name}"/></svg>`

// — Ansicht Login/App —

/**
 * Der Pfad folgt der Ansicht.
 *
 * Dieselbe Datei liegt unter drei Adressen (`/anmelden`, `/registrieren`,
 * `/app` — s. [routen.ts](../routen.ts)), weil sie drei Dinge ist: die Tür und
 * der Raum dahinter. Welche gerade gilt, weiß nur der Anmeldezustand, nicht der
 * Server — also schreibt die Seite den Pfad nach. `replaceState`, nicht
 * `pushState`: Anmelden ist kein Ort, an den die Zurück-Taste führen sollte.
 */
const TITLE = {
  app: 'Maptale Studio',
  anmelden: 'Anmelden · Maptale',
  registrieren: 'Konto erstellen · Maptale',
} as const

function setPath(side: 'app' | 'anmelden' | 'registrieren'): void {
  // Der Titel läuft mit, aber VOR dem Abbruch: Beim ersten Laden stimmt der
  // Pfad schon, der Titel („Maptale" aus dem Boot) noch nicht.
  document.title = TITLE[side]
  const target = ROUTEN[side].pfad
  if (location.pathname === target) return
  history.replaceState(history.state, '', target + location.search + location.hash)
}

/** Für Gäste entscheidet das sichtbare Formular, ob die Adresse Tür oder Aufnahme heißt. */
function setGuestPath(): void {
  const onTheWayIn =
    !els.registerForm.hidden ||
    !els.codeForm.hidden ||
    !els.waitlistForm.hidden ||
    !els.waitlistInfo.hidden
  setPath(onTheWayIn ? 'registrieren' : 'anmelden')
}

function show(loggedIn: boolean): void {
  // Ab hier bestimmt JS, welche Ansicht steht — der Boot-Vorgriff darf
  // `hidden` nicht länger übersteuern (s. html.studio-controlled in studio.html).
  document.documentElement.classList.add('studio-controlled')
  els.loginView.hidden = loggedIn
  els.appView.hidden = !loggedIn
  els.userChip.hidden = !loggedIn
  // `neu-oben` bleibt hier IMMER aus: Ob er erscheint, entscheidet nicht die
  // Anmeldung, sondern ob die „Neue Tour"-Kachel gerade zu sehen ist
  // (s. beobachteNeuKachel).
  els.newTop.hidden = true
  if (!loggedIn) {
    els.accountMenu.hidden = true
    els.userChip.setAttribute('aria-expanded', 'false')
  }
  if (loggedIn) setPath('app')
  else setGuestPath()
}

/** Boot-Overlay ausblenden, sobald Login oder App sichtbar sind. */
function hideBoot(): void {
  const boot = document.getElementById('studio-boot')
  if (!boot) return
  boot.classList.add('gone')
  boot.setAttribute('aria-busy', 'false')
  setTimeout(() => boot.remove(), 500)
}

/**
 * Konto-Chip wie auf Entdecken/Landing: Anzeigename und Avatar aus dem
 * Profil, Klarname nur als Fallback. Sonst stünde „Henrik Heil" statt
 * „Henrik", und das Profilbild fehlte ganz.
 */
function showUser(session: api.Session): void {
  const user = session.user
  const display = session.profile?.displayName?.trim() || user?.name || user?.email || ''
  els.userName.textContent = display
  els.kmMail.textContent = user?.email ?? ''

  const avatar = session.profile?.avatarUrl
  const initial = (display.trim().charAt(0) || '?').toUpperCase()
  merkeProfilCache({ name: display, initial, avatarUrl: avatar })

  const point = els.userChip.querySelector('.punkt')
  if (!point) return
  if (avatar) {
    if (point instanceof HTMLImageElement) {
      point.src = avatar
    } else {
      const img = document.createElement('img')
      img.className = 'punkt'
      img.src = avatar
      img.alt = ''
      img.width = 20
      img.height = 20
      point.replaceWith(img)
    }
  } else {
    const initial = (display.trim().charAt(0) || '?').toUpperCase()
    if (point instanceof HTMLImageElement) {
      const span = document.createElement('span')
      span.className = 'punkt'
      span.id = 'benutzer-initial'
      span.textContent = initial
      point.replaceWith(span)
    } else {
      point.textContent = initial
    }
  }
}

// — Auth-Modus umschalten (Anmelden / Einladung / Registrieren / Reset / Warteliste) —
type AuthMode =
  'login' | 'code' | 'register' | 'reset-request' | 'reset-set' | 'waitlist' | 'waitlist-info'
// HTMLElement, nicht HTMLFormElement: Die Wartelisten-Meldung ist kein
// Formular, sondern ein Satz mit höchstens einem Griff.
const authForms: Record<AuthMode, HTMLElement> = {
  login: els.loginForm,
  code: els.codeForm,
  register: els.registerForm,
  'reset-request': els.resetRequestForm,
  'reset-set': els.resetSetForm,
  waitlist: els.waitlistForm,
  'waitlist-info': els.waitlistInfo,
}

function showAuthMode(mode: AuthMode): void {
  for (const [name, form] of Object.entries(authForms)) form.hidden = name !== mode
  setGuestPath()
}

/**
 * Nach einem Wechsel steht die Schreibmarke im ersten Feld.
 *
 * Nur nach einem KLICK, nicht beim Laden der Seite: Ein Autofokus beim
 * Seitenaufbau schiebt auf kleinen Geräten die Bühne aus dem Bild und öffnet
 * ungefragt die Tastatur.
 */
function focusFirstField(): void {
  const visibleForm = Object.values(authForms).find((form) => !form.hidden)
  visibleForm?.querySelector<HTMLElement>('input:not([type="hidden"]), textarea')?.focus()
}

/**
 * Der Weg zur Registrierung — er beginnt bei der Einladung, wenn eine
 * gebraucht wird und noch keine bestätigt ist.
 *
 * Alle Wege dorthin laufen hier durch (Knopf im Login, `#registrieren` von der
 * Landing), damit die Reihenfolge an EINER Stelle steht: Wer keinen gültigen
 * Code hat, soll das erfahren, bevor er ein Formular ausfüllt.
 */
function startRegister(): void {
  showAuthMode(invitationRequired && !confirmedCode ? 'code' : 'register')
}

// Modus-Wechsel-Links (data-auth-mode) in allen Auth-Formularen
els.authBox.querySelectorAll<HTMLButtonElement>('[data-auth-mode]').forEach((btn) => {
  btn.addEventListener('click', () => {
    els.loginError.textContent = ''
    els.registerError.textContent = ''
    els.codeError.textContent = ''
    els.wlError.textContent = ''
    const target = btn.dataset.authMode as AuthMode
    if (target === 'register') startRegister()
    else showAuthMode(target)
    focusFirstField()
  })
})

/** Verifikations-Stand: Banner + Upload-Sperre + Quota-Balken aktualisieren. */
let uploadLocked = false

function showSession(session: api.Session): void {
  const unconfirmed = session.user !== null && session.verified === false
  els.verifyBanner.hidden = !unconfirmed
  els.kmAdmin.hidden = session.user?.role !== 'admin'
  // „Mein Profil" zeigt auf die Adresse der Person, nicht auf /profil — dort
  // stünde ohne Handle nichts. Ohne Handle bleibt der Eintrag weg.
  const handle = session.profile?.handle
  els.kmProfile.hidden = !handle
  if (handle) els.kmProfile.href = profilPfad(handle)
  uploadLocked = unconfirmed
  els.newBuild.title = unconfirmed ? 'Erst E-Mail bestätigen' : ''
  if (session.quota) {
    const mb = (b: number): string => (b / (1024 * 1024)).toFixed(0)
    const fraction = session.quota.limit > 0 ? session.quota.used / session.quota.limit : 0
    els.kmQuotaText.textContent = `${mb(session.quota.used)} / ${mb(session.quota.limit)} MB`
    els.kmBarFill.style.width = `${Math.min(100, fraction * 100).toFixed(0)}%`
    els.kmBarFill.classList.toggle('voll', fraction > 0.9)
  }
}

/** Verlangt diese Instanz eine Einladung? (Aus /auth/me, auch ohne Anmeldung.) */
let invitationRequired = false
/** Der in Schritt 1 vom Server bestätigte Code — leer, solange keiner steht. */
let confirmedCode = ''

/**
 * Den bestätigten Code merken und in Schritt 2 als Beleg zeigen.
 *
 * Der Chip ist kein Schmuck: Ohne ihn wüsste in Schritt 2 niemand, ob die
 * Einladung angekommen ist — und ob ein Tippfehler noch zu korrigieren wäre.
 */
function setConfirmedCode(code: string): void {
  confirmedCode = code
  els.regCodeChip.hidden = !code
  els.regCodeValue.textContent = code
}

function showRegisterMode(session: api.Session): void {
  invitationRequired = session.registration?.invitationRequired ?? false
  // Der Weg zur Warteliste steht nur da, wo der Server ihn anbietet — sonst
  // führte ein Link auf ein Formular, dessen Route mit 403 antwortet.
  els.toWaitlist.hidden = !session.registration?.waitlist
  // Steht die Tür wieder offen, ist ein bestätigter Code gegenstandslos —
  // sonst hinge der Chip über einem Formular, das gar nichts mehr fragt.
  if (!invitationRequired) setConfirmedCode('')
  els.regSubline.textContent = invitationRequired
    ? 'Noch deine Adresse und ein Passwort, dann bist du drin.'
    : 'Kostenlos. Du bekommst gleich eine Bestätigungsmail.'
  // `#registrieren` von der Landing fällt vor dieser Antwort an und kannte die
  // Pflicht noch nicht — hier steht der Einstieg gerade, falls nötig.
  if (!els.registerForm.hidden && invitationRequired && !confirmedCode) showAuthMode('code')
}

async function loadSession(): Promise<api.Session> {
  const session = await api.me()
  showUser(session)
  show(!!session.user)
  showRegisterMode(session)
  if (session.user) {
    merkeAngemeldet()
    showSession(session)
    // Deep-Link: /studio.html?edit=<tourId> — Editor ZUERST, Liste danach.
    // Sonst rendert die Bibliothek unter dem Boot und blitzt beim Ausblenden
    // kurz auf; außerdem spart der Editor-Chunk den Listen-Roundtrip.
    const editId = editIdFromUrl()
    if (editId) {
      await openEditorFor(editId, { history: true })
      void loadList()
    } else {
      await loadList()
    }
  } else {
    // Hinweis war gesetzt, Sitzung aber weg (abgelaufen) → zurück zum Login.
    vergesseAngemeldet()
    document.documentElement.classList.remove('studio-signed-in')
  }
  return session
}

async function checkLogin(): Promise<void> {
  // Zuerst Mail-Links aus der URL abarbeiten (#verify=… / #reset=…)
  try {
    // Ein Wartelisten-Link gilt AUCH für Angemeldete: Er beantwortet eine Frage
    // der Adresse, nicht des Kontos. Ohne diesen Abbruch schöbe `loadSession`
    // die Bibliothek darüber, und der Austragen-Link liefe für jeden mit
    // offener Sitzung ins Leere.
    if (await handleAuthHash()) return
    await loadSession()
  } finally {
    // Auch bei Netzwerkfehlern den Boot weg — sonst hängt man ewig.
    hideBoot()
  }
}

/**
 * E-Mail-Bestätigung / Reset-Link aus dem URL-Fragment behandeln — dazu der
 * Direkteinstieg in die Registrierung: ohne ihn landete „Registrieren" im
 * Login-Formular, also dort, wo direkt daneben schon „Anmelden" hinführt. Und
 * `#einladung=CODE`, der Link aus der Verwaltung: Er trägt den Code gleich
 * ein, damit niemand ihn abtippt.
 *
 * Der Einstieg kommt heute als PFAD (`/registrieren`); das alte
 * `#registrieren` bleibt gültig, weil es in Lesezeichen und in verschickten
 * Links steht.
 */
async function handleAuthHash(): Promise<boolean> {
  const hash = location.hash.slice(1)
  const verify = hash.match(/(?:^|&)verify=([^&]+)/)?.[1]
  const reset = hash.match(/(?:^|&)reset=([^&]+)/)?.[1]
  const invitation = hash.match(/(?:^|&)einladung=([^&]+)/)?.[1]
  const wlConfirm = hash.match(/(?:^|&)warteliste=([^&]+)/)?.[1]
  const wlLeave = hash.match(/(?:^|&)warteliste-austragen=([^&]+)/)?.[1]
  // Der bloße Einstieg — er darf keinen Token-Hash überholen: Der Link aus der
  // Verwaltung heißt seit den sauberen URLs `/registrieren#einladung=CODE` und
  // erfüllt die Pfad-Bedingung selbst.
  const directToRegister =
    !verify &&
    !reset &&
    !invitation &&
    !wlConfirm &&
    !wlLeave &&
    (hash === 'registrieren' || location.pathname === ROUTEN.registrieren.pfad)
  if (directToRegister) {
    history.replaceState(null, '', location.pathname + location.search)
    showAuthMode('register')
    return false
  }
  if (invitation) {
    history.replaceState(null, '', location.pathname + location.search)
    const code = formatiereEinladungscode(decodeURIComponent(invitation))
    els.regCode.value = code
    // Den Code gleich prüfen: Wer einem Einladungslink folgt, hat Schritt 1
    // bereits hinter sich — außer der Code taugt nicht, dann landet er dort und
    // sieht, warum.
    try {
      await api.checkInvitation(code)
      setConfirmedCode(code)
      showAuthMode('register')
      els.regEmail.focus()
    } catch (error) {
      els.codeError.textContent = (error as Error).message
      showAuthMode('code')
    }
    return false
  }
  // Der Klick aus der Wartelisten-Mail. Er ist die Einwilligung — deshalb löst
  // ihn erst diese Seite ein und nicht schon der Link selbst (ein GET, den
  // jeder Scanner mitnimmt, wäre keine Handlung des Menschen).
  if (wlConfirm) {
    history.replaceState(null, '', location.pathname + location.search)
    const token = decodeURIComponent(wlConfirm)
    try {
      const { email } = await api.confirmWaitlist(token)
      showWaitlistInfo(
        'Du stehst auf der Liste',
        `${email} ist vorgemerkt. Sobald ein Platz frei wird, kommt dein Einladungscode per E-Mail.`,
        { word: 'Wieder austragen', run: () => leaveWaitlist(token) },
      )
    } catch (error) {
      showWaitlistInfo('Dieser Link geht nicht mehr', (error as Error).message)
    }
    return true
  }
  if (wlLeave) {
    history.replaceState(null, '', location.pathname + location.search)
    const token = decodeURIComponent(wlLeave)
    showWaitlistInfo(
      'Aus der Warteliste austragen?',
      'Wir löschen deine Adresse sofort und schicken dir keine Einladung mehr.',
      { word: 'Ja, austragen', run: () => leaveWaitlist(token) },
    )
    return true
  }
  if (verify) {
    history.replaceState(null, '', location.pathname + location.search)
    try {
      await api.verifyEmail(decodeURIComponent(verify))
      hintToast('E-Mail bestätigt. Du kannst jetzt hochladen.') // danach eingeloggt → App-View sichtbar
    } catch (error) {
      // Fehlschlag heißt: nicht eingeloggt → App-View bleibt verborgen. Die
      // Meldung gehört daher ins (sichtbare) Login-Fehlerfeld.
      els.loginError.textContent = (error as Error).message
    }
  } else if (reset) {
    history.replaceState(null, '', location.pathname + location.search)
    resetToken = decodeURIComponent(reset)
    showAuthMode('reset-set')
  }
  return false
}

let resetToken: string | null = null

// — Passwortfelder: Stärke anzeigen und schwache Wahl abfangen —
//
// Der Absende-Knopf sperrt erst, wenn tatsächlich etwas Schwaches im Feld
// steht: Ein von Anfang an grauer Knopf sähe aus, als wäre das Formular kaputt,
// und beim leeren Feld greift ohnehin `required`.
const bindSubmit =
  (field: HTMLInputElement, button: HTMLButtonElement) => (report: { reicht: boolean }) => {
    button.disabled = field.value.length > 0 && !report.reicht
  }

const regPasswordField = haengePasswortfeld(els.regPasswort, {
  // Name und Adresse stehen im selben Formular und ändern sich noch, während
  // das Passwort schon getippt ist — deshalb als Funktion, nicht als Wert.
  persoenlich: () => [els.regEmail.value],
  beiAenderung: bindSubmit(els.regPasswort, els.regSubmit),
})

// Beim Anmelden nur der Sichtbarkeits-Schalter: Ein bestehendes Passwort zu
// bewerten hilft niemandem, aber ein Tippfehler im verdeckten Feld ist der
// häufigste Grund, warum eine Anmeldung scheitert.
haengePasswortfeld(els.passwort, { bewertung: false })

haengePasswortfeld(els.resetPasswort, {
  // Beim Reset kennen wir nur die Adresse aus dem Anmeldefeld — besser als nichts.
  persoenlich: () => [els.email.value],
  beiAenderung: bindSubmit(els.resetPasswort, els.resetSubmit),
})

els.loginForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  els.loginError.textContent = ''
  try {
    await api.login(els.email.value.trim(), els.passwort.value)
    els.passwort.value = ''
    await loadSession()
  } catch (error) {
    els.loginError.textContent = (error as Error).message
  }
})

// — Schritt 1: die Einladung —

// Unter dem Finger aufräumen: Versalien, Bindestrich von selbst, Unerlaubtes
// fällt weg. Die Schreibmarke ans Ende zu setzen genügt, weil nur vorwärts
// getippt wird — beim Einfügen ist das Ende ohnehin die richtige Stelle.
els.regCode.addEventListener('input', () => {
  els.regCode.value = formatiereEinladungscode(els.regCode.value)
  els.codeError.textContent = ''
})

els.codeForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  els.codeError.textContent = ''
  const code = formatiereEinladungscode(els.regCode.value)
  if (!codeVollstaendig(code)) {
    els.codeError.textContent = 'Ein Code hat acht Zeichen. Bitte gib ihn vollständig ein.'
    return
  }
  els.codeNext.disabled = true
  els.codeNext.textContent = 'Wird geprüft …'
  try {
    await api.checkInvitation(code)
    setConfirmedCode(code)
    showAuthMode('register')
    els.regEmail.focus()
  } catch (error) {
    els.codeError.textContent = (error as Error).message
    els.regCode.select()
  } finally {
    els.codeNext.disabled = false
    els.codeNext.textContent = 'Weiter'
  }
})

els.regCodeChange.addEventListener('click', () => {
  els.registerError.textContent = ''
  showAuthMode('code')
  els.regCode.select()
})

// — Schritt 2: die eigenen Daten —

els.registerForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  els.registerError.textContent = ''
  els.regSubmit.disabled = true
  try {
    // Der Haken geht als ausdrückliches `true` mit — und nur dann. Er ist kein
    // Bestandteil der Anmeldung: Fehlt er, entsteht das Konto unverändert.
    await api.register(
      els.regEmail.value.trim(),
      els.regPasswort.value,
      confirmedCode || undefined,
      {
        newsletter: els.regNewsletter.checked,
      },
    )
    regPasswordField.leere()
    await loadSession() // direkt eingeloggt; Banner „bitte bestätigen" erscheint
  } catch (error) {
    els.registerError.textContent = (error as Error).message
    // Ein zwischenzeitlich verbrauchter Code führt zurück in Schritt 1 — dort
    // steht das Feld, in dem sich das beheben lässt.
    if (invitationRequired && /Einladungscode/i.test((error as Error).message)) {
      setConfirmedCode('')
      els.codeError.textContent = (error as Error).message
      showAuthMode('code')
    }
  } finally {
    els.regSubmit.disabled = false
  }
})

// — Warteliste —
//
// Drei Wege enden in derselben Ansicht: eingetragen, bestätigt, ausgetragen.
// Sie trägt einen Satz und höchstens einen Griff — mehr hat die Warteliste
// nicht zu sagen, und ein Formular, das nach dem Absenden stehen bleibt, sähe
// aus, als wäre nichts passiert.

/** Was der Knopf der Info-Ansicht gerade tut; null = kein Knopf. */
let wlAction: (() => void | Promise<void>) | null = null

function showWaitlistInfo(
  title: string,
  text: string,
  action?: { word: string; run: () => void | Promise<void> },
): void {
  els.wlInfoTitle.textContent = title
  els.wlInfoText.textContent = text
  els.wlInfoError.textContent = ''
  els.wlInfoAction.hidden = !action
  els.wlInfoAction.textContent = action?.word ?? ''
  wlAction = action?.run ?? null
  // Die Bühne gehört jetzt dieser Meldung — auch bei bestehender Sitzung. Der
  // Boot-Vorgriff (Cookie `maptale_dabei`) hat die Bibliothek sonst schon
  // eingeblendet, bevor der Link überhaupt gelesen wurde, und der Austragen-Weg
  // endete für jeden Angemeldeten in seiner Tourliste.
  show(false)
  document.documentElement.classList.remove('studio-signed-in')
  showAuthMode('waitlist-info')
}

els.wlInfoAction.addEventListener('click', () => void wlAction?.())

/**
 * Austragen — der Weg hinaus ohne Konto.
 *
 * Er läuft nie auf einen bloßen Link-Aufruf hin, sondern immer über einen
 * Knopf: Mail-Programme und Virenscanner öffnen Links vorab, und eine Löschung
 * durch einen Scanner wäre eine, die niemand wollte.
 */
async function leaveWaitlist(token: string): Promise<void> {
  els.wlInfoError.textContent = ''
  els.wlInfoAction.disabled = true
  try {
    await api.leaveWaitlist(token)
    showWaitlistInfo(
      'Ausgetragen',
      'Deine Adresse ist gelöscht. Du bekommst keine Post mehr von uns.',
    )
  } catch (error) {
    els.wlInfoError.textContent = (error as Error).message
  } finally {
    els.wlInfoAction.disabled = false
  }
}

els.waitlistForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  els.wlError.textContent = ''
  els.wlSubmit.disabled = true
  const address = els.wlEmail.value.trim()
  try {
    await api.joinWaitlist(address, els.wlNote.value.trim() || undefined)
    els.wlEmail.value = ''
    els.wlNote.value = ''
    // Bewusst dieselbe Antwort für jede Lage (neu, schon eingetragen, schon
    // Konto) — die Route verrät nicht, wer auf der Liste steht, und die
    // Oberfläche soll es auch nicht.
    showWaitlistInfo(
      'Schau in dein Postfach',
      `Wenn alles passt, ist eine E-Mail an ${address} unterwegs. Erst dein Klick darin macht den Eintrag gültig. Ohne ihn löschen wir die Adresse wieder.`,
    )
  } catch (error) {
    els.wlError.textContent = (error as Error).message
  } finally {
    els.wlSubmit.disabled = false
  }
})

els.resetRequestForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  await api.requestPasswordReset(els.resetEmail.value.trim())
  // Bewusst neutrale Rückmeldung (keine Existenz-Auskunft)
  els.resetRequestStatus.textContent =
    'Wenn es ein Konto mit dieser Adresse gibt, ist die E-Mail unterwegs.'
  els.resetRequestStatus.className = 'hinweis ok'
})

els.resetSetForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  els.resetSetError.textContent = ''
  if (!resetToken) return
  try {
    await api.resetPassword(resetToken, els.resetPasswort.value)
    resetToken = null
    await loadSession()
  } catch (error) {
    els.resetSetError.textContent = (error as Error).message
  }
})

els.logOut.addEventListener('click', async () => {
  els.accountMenu.hidden = true
  els.userChip.setAttribute('aria-expanded', 'false')
  if (editorTourId) {
    const { closeEditor } = await import('./editor.js')
    closeEditor()
  }
  await api.logout()
  vergesseAngemeldet()
  document.documentElement.classList.remove('studio-signed-in')
  show(false)
  showAuthMode('login')
})

// — Konto-Menü (Quota + Konto löschen) —
els.userChip.addEventListener('click', () => {
  const on = els.accountMenu.hidden
  els.accountMenu.hidden = !on
  els.userChip.setAttribute('aria-expanded', String(on))
})
document.addEventListener('click', (e) => {
  if (!els.accountMenu.hidden && !(e.target as HTMLElement).closest('.konto-wrap')) {
    els.accountMenu.hidden = true
    els.userChip.setAttribute('aria-expanded', 'false')
  }
})

/** Kurze Rückmeldung im Fenster „Neue Tour" — der einzige Ort mit Statuszeile. */
function hintToast(text: string, error = false): void {
  setNewStatus(text, error ? 'fehler' : '')
  if (error) els.newBackdrop.hidden = false
}

// — Bibliothek: die Touren sind die Seite —
//
// Kacheln statt Zeilen, weil eine Reise ein Bild hat. Die Form der Route liegt
// als Signatur über dem Titelbild — Fotos sehen einander ähnlich, Routen nicht.

let touren: api.TourListItem[] = []
let view: 'raster' | 'liste' = localStorage.getItem('maptale.view') === 'liste' ? 'liste' : 'raster'
let sort: 'neu' | 'alt' | 'km' | 'az' = 'neu'
let searchText = ''
/** Läuft, solange eine Tour noch entsteht — die Kachel soll nicht ewig schimmern. */
let followUp: number | null = null

const VISIBILITY_NAMES: Record<string, string> = {
  private: 'Privat',
  unlisted: 'Per Link',
  public: 'Öffentlich',
}
const VISIBILITY_ICONS: Record<string, string> = {
  private: 'schloss',
  unlisted: 'schloss-offen',
  public: 'welt',
}

function date(iso: string): string {
  const d = new Date(iso)
  return Number.isFinite(d.getTime())
    ? d.toLocaleDateString('de-DE', { day: 'numeric', month: 'long' })
    : ''
}

/** Zeile unter dem Titel: Strecke · Aufnahmen · Datum — nur, was es gibt. */
function metaRow(t: api.TourListItem): string {
  const parts: string[] = []
  if (t.stats?.km) parts.push(`${String(t.stats.km).replace('.', ',')} km`)
  if (t.stats?.placedMedia)
    parts.push(t.stats.placedMedia === 1 ? '1 Aufnahme' : `${t.stats.placedMedia} Aufnahmen`)
  parts.push(date(t.createdAt))
  return parts.filter(Boolean).join(' · ')
}

function visibleTours(): api.TourListItem[] {
  const search = searchText.trim().toLowerCase()
  const filtered = search
    ? touren.filter(
        (t) =>
          (t.title ?? '').toLowerCase().includes(search) || t.no.toLowerCase().includes(search),
      )
    : [...touren]
  const afterDate = (a: api.TourListItem, b: api.TourListItem): number =>
    Date.parse(b.createdAt) - Date.parse(a.createdAt)
  if (sort === 'alt') return filtered.sort((a, b) => -afterDate(a, b))
  if (sort === 'km') return filtered.sort((a, b) => (b.stats?.km ?? 0) - (a.stats?.km ?? 0))
  if (sort === 'az')
    return filtered.sort((a, b) => (a.title ?? '').localeCompare(b.title ?? '', 'de'))
  return filtered.sort(afterDate)
}

async function loadList(): Promise<void> {
  if (!touren.length) {
    els.library.innerHTML =
      '<div class="skelett"><div></div><div></div><div></div><div></div></div>'
  }
  try {
    touren = await api.listTours()
  } catch {
    els.library.innerHTML =
      '<div class="empty-stage"><h2>Touren konnten nicht geladen werden</h2><p>Der Server hat nicht geantwortet. Kurz warten und die Seite neu laden.</p></div>'
    return
  }
  renderLibrary()
  // Entsteht gerade eine Tour, kommt die Liste von selbst wieder — sonst bliebe
  // die schimmernde Kachel stehen, bis jemand neu lädt.
  const busy = touren.some((t) => t.status !== 'ready' && t.status !== 'failed')
  if (followUp !== null) clearTimeout(followUp)
  followUp = busy ? window.setTimeout(() => void loadList(), 3000) : null
}

function renderLibrary(): void {
  closeVisibilityMenu()
  const list = visibleTours()
  els.libHeader.hidden = touren.length === 0
  els.library.innerHTML = ''

  if (!touren.length) {
    const empty = document.createElement('div')
    empty.className = 'empty-stage'
    empty.innerHTML = `
      <svg class="route" viewBox="0 0 1200 320" preserveAspectRatio="none" aria-hidden="true"><path d="M-20 250C160 232 190 96 380 84s250 128 420 62 280-168 440-176"/></svg>
      <h2>Hier entsteht deine erste Tour</h2>
      <p>Eine Aufzeichnung, ein paar Fotos, Maptale benennt die Orte, holt das Wetter des Tages und baut daraus eine Kamerafahrt.</p>
      <button class="knopf-primaer" id="empty-choose">${icon('upload')}Dateien wählen</button>`
    els.library.appendChild(empty)
    empty.querySelector('#empty-choose')?.addEventListener('click', () => openNew())
    return
  }

  // Suche ohne Treffer: das sagen, statt eine Seite mit nur der Upload-Kachel
  // zu zeigen — die sieht aus wie „du hast keine Touren".
  if (!list.length) {
    const none = document.createElement('div')
    none.className = 'empty-stage'
    none.innerHTML = `<h2>Keine Tour passt dazu</h2><p>„${escape(searchText.trim())}" kommt in keinem Titel vor.</p>`
    els.library.appendChild(none)
    return
  }

  if (view === 'liste') {
    const host = document.createElement('div')
    host.className = 'liste'
    for (const t of list) host.appendChild(buildRow(t))
    els.library.appendChild(host)
    return
  }

  const raster = document.createElement('div')
  raster.className = 'grid'
  const next = document.createElement('button')
  next.className = 'new-thumbnail'
  next.id = 'neu-kachel'
  next.innerHTML = `${icon('upload')}<span class="h">Neue Tour</span><span class="n">Aufzeichnung und Fotos hierher ziehen, den Rest macht Maptale</span>`
  next.addEventListener('click', () => openNew())
  raster.appendChild(next)
  for (const t of list) raster.appendChild(buildMap(t))
  els.library.appendChild(raster)
  observeNewTile(next)
}

/** Der eine Beobachter — wird bei jedem Neuaufbau der Liste umgehängt. */
let newTileObserver: IntersectionObserver | null = null

/**
 * Der Knopf „Neue Tour" in der Kopfleiste erscheint erst, wenn die Kachel
 * weggescrollt ist.
 *
 * Beides gleichzeitig war eine Dopplung, und der Knopf war dabei der farbigste
 * Punkt der Leiste: Die Kachel sagt dasselbe, erklärt sich selbst und ist das
 * Ziel fürs Hineinziehen von Dateien. Ersatzlos streichen ließ er sich aber
 * auch nicht — bei einer langen Liste ist die Kachel oben aus dem Bild, und die
 * Leiste klebt. Also zeigt ihn genau der Fall, für den es ihn braucht.
 */
function observeNewTile(tile: HTMLElement): void {
  newTileObserver?.disconnect()
  if (!('IntersectionObserver' in window)) {
    // Ohne Beobachter lieber sichtbar als unerreichbar.
    els.newTop.hidden = false
    return
  }
  newTileObserver = new IntersectionObserver(
    ([entry]) => {
      els.newTop.hidden = !!entry?.isIntersecting
    },
    // Die Kopfleiste liegt über der Seite: Was unter ihr steckt, ist für den
    // Betrachter weg, auch wenn es technisch noch im Sichtfeld ist.
    { rootMargin: '-64px 0px 0px 0px' },
  )
  newTileObserver.observe(tile)
}

/** Die Form der Tour über dem Titelbild — nur, wenn der Server sie mitliefert. */
function trackSignet(t: api.TourListItem): string {
  const s = t.stats?.trackSignature
  if (!s) return ''
  return `<svg class="track" viewBox="-6 -6 112 112" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    <path class="line" d="${escape(s.d)}"/>
    <circle class="start" cx="${s.start[0]}" cy="${s.start[1]}" r="3.2"/>
    <circle class="end" cx="${s.end[0]}" cy="${s.end[1]}" r="3.2"/></svg>`
}

function buildMap(t: api.TourListItem): HTMLElement {
  const el = document.createElement('article')
  const busy = t.status !== 'ready' && t.status !== 'failed'
  el.className = `karte${busy ? ' arbeitet' : ''}${t.status === 'failed' ? ' defekt' : ''}`
  el.dataset['tour'] = t.id
  // Kachel-Fassung, wo es sie gibt: die Bibliothek zog bisher je Kachel das
  // volle Titelfoto (mehrere MB) für ein Bild von wenigen hundert Pixeln.
  const cover = t.coverThumb ?? t.cover
  const image = cover
    ? `<div class="bild"><img src="${escape(cover)}" alt="" loading="lazy" />${trackSignet(t)}</div>`
    : `<div class="bild without">${icon('route')}${trackSignet(t)}</div>`

  // Auf der Übersicht nur das Zeichen; was schiefging, steht in der geöffneten Tour.
  const grips = busy
    ? ''
    : `<div class="griffe">
        ${
          t.status === 'failed'
            ? '<span class="error-dot" title="Etwas ist schiefgelaufen, zum Öffnen klicken" aria-label="Fehler">!</span>'
            : `<button class="sicht${t.visibility === 'public' ? ' oeffentlich' : ''}" data-visibility aria-haspopup="true" aria-expanded="false" aria-label="Sichtbarkeit: ${VISIBILITY_NAMES[t.visibility] ?? t.visibility}">${icon(VISIBILITY_ICONS[t.visibility] ?? 'schloss')}<span>${VISIBILITY_NAMES[t.visibility] ?? t.visibility}</span></button>`
        }
        ${t.status === 'ready' ? `<button class="pencil-button" data-film="${t.id}" aria-label="Als Video">${icon('film')}<span>Video</span></button>` : ''}
        <button class="pencil-button" data-edit="${t.id}" aria-label="Bearbeiten">${icon('stift')}<span>Bearbeiten</span></button>
      </div>`

  el.innerHTML = `${image}${grips}
    <div class="footer">
      <div class="t">${escape(t.title ?? '(ohne Titel)')}</div>
      <div class="m">${busy ? 'entsteht gerade …' : escape(metaRow(t))}</div>
    </div>
    ${busy ? '<div class="run"><span></span></div>' : '<div class="schleier"></div>'}
    ${busy || t.status === 'failed' ? '' : `<button class="play" aria-label="Abspielen">${icon('play')}</button>`}`

  if (!busy) {
    // Die GANZE Kachel spielt ab — die Taste in der Mitte ist die Ansage dafür,
    // nicht das einzige Ziel. Nur die Griffe oben rechts machen etwas anderes.
    el.addEventListener('click', (e) => {
      const target = e.target as HTMLElement
      if (
        target.closest('[data-visibility]') ||
        target.closest('[data-edit]') ||
        target.closest('[data-film]')
      )
        return
      if (t.status === 'failed') void openEditorFor(t.id)
      else playTour(t.id)
    })
    el.querySelector('[data-visibility]')?.addEventListener('click', (e) => {
      e.stopPropagation()
      openVisibilityMenu(el, t)
    })
    el.querySelector('[data-edit]')?.addEventListener('click', (e) => {
      e.stopPropagation()
      void openEditorFor(t.id)
    })
    el.querySelector('[data-film]')?.addEventListener('click', (e) => {
      e.stopPropagation()
      void openFilmFor(t)
    })
  }
  return el
}

function buildRow(t: api.TourListItem): HTMLElement {
  const el = document.createElement('div')
  el.className = 'zeile'
  const busy = t.status !== 'ready' && t.status !== 'failed'
  el.innerHTML = `
    <div class="mini">${(t.coverThumb ?? t.cover) ? `<img src="${escape((t.coverThumb ?? t.cover) as string)}" alt="" loading="lazy" />` : icon('route')}</div>
    <div class="txt">
      <div class="t">${escape(t.title ?? '(ohne Titel)')}</div>
      <div class="m">${busy ? 'entsteht gerade …' : escape(metaRow(t))}</div>
    </div>
    <div class="right">
      ${
        busy
          ? '<span class="visibility-pill">entsteht</span>'
          : `<span class="sichtpille${t.visibility === 'public' ? ' oeffentlich' : ''}">${VISIBILITY_NAMES[t.visibility] ?? t.visibility}</span>
             ${t.status === 'ready' ? `<button class="action" data-play>${icon('play')}Abspielen</button><button class="action" data-film aria-label="Als Video">${icon('film')}Video</button>` : ''}
             <button class="action" data-edit aria-label="Bearbeiten">${icon('stift')}</button>
             <button class="action gefahr" data-delete aria-label="Tour löschen" title="Tour löschen">${icon('muell')}</button>`
      }
    </div>`
  el.querySelector('[data-play]')?.addEventListener('click', () => playTour(t.id))
  el.querySelector('[data-film]')?.addEventListener('click', () => void openFilmFor(t))
  el.querySelector('[data-edit]')?.addEventListener('click', () => void openEditorFor(t.id))
  el.querySelector<HTMLButtonElement>('[data-delete]')?.addEventListener('click', (e) => {
    void deleteTwoStep(e.currentTarget as HTMLButtonElement, t.id)
  })
  return el
}

/** Erster Klick schärft, zweiter löscht — statt eines confirm()-Dialogs. */
async function deleteTwoStep(button: HTMLButtonElement, id: string): Promise<void> {
  if (!button.dataset['scharf']) {
    button.dataset['scharf'] = '1'
    button.innerHTML = `${icon('muell')}Wirklich löschen?`
    setTimeout(() => {
      if (!button.isConnected || !button.dataset['scharf']) return
      delete button.dataset['scharf']
      button.innerHTML = icon('muell')
    }, 3500)
    return
  }
  button.disabled = true
  await api.deleteTour(id)
  await loadList()
}

/**
 * Abspielen im SELBEN Tab. Ein zweites Fenster wäre ein zweiter Ort, an dem
 * dieselbe Bibliothek offen steht; der Player führt oben links von selbst
 * dorthin zurück, wo man herkam (Referrer + history.back(), src/main.js).
 */
function playTour(id: string): void {
  location.href = tourPfad(`srv:${id}`)
}

async function openFilmFor(t: api.TourListItem): Promise<void> {
  const { openExportSheet } = await import('./export-sheet.js')
  openExportSheet({
    id: t.id,
    title: t.title,
    cover: t.coverThumb ?? t.cover,
    track: t.stats?.trackSignature ?? null,
    filmS: t.stats?.filmS ?? null,
    finale: t.stats?.finale ?? null,
  })
}

/** Tour-ID aus `?edit=` — Editor-Deep-Link. */
function editIdFromUrl(): string | null {
  const id = new URLSearchParams(location.search).get('edit')
  return id && id.length > 0 ? id : null
}

/** Studio-URL mit oder ohne Editor-Parameter (Hash für Auth-Links bleibt). */
function studioUrl(editId: string | null): string {
  const u = new URL(location.href)
  if (editId) u.searchParams.set('edit', editId)
  else u.searchParams.delete('edit')
  return u.pathname + u.search + u.hash
}

/** Welche Tour gerade im Editor liegt — null = Bibliothek. */
let editorTourId: string | null = null

/**
 * Editor öffnen. `geschichte: true` = URL schon gesetzt (Reload/Zurück-Taste),
 * sonst pushState, damit Zurück aus dem Editor wieder in die Bibliothek führt.
 */
async function openEditorFor(id: string, opts: { history?: boolean } = {}): Promise<void> {
  if (editorTourId === id) return
  // Anderer Editor offen → zuerst zu, sonst blieben Karte/State der alten Tour
  if (editorTourId) {
    const { closeEditor } = await import('./editor.js')
    closeEditor()
  }
  if (!opts.history) history.pushState({ studio: 'edit', id }, '', studioUrl(id))
  else history.replaceState({ studio: 'edit', id }, '', studioUrl(id))

  els.appView.hidden = true
  editorTourId = id
  const { openEditor } = await import('./editor.js')
  await openEditor(id, () => {
    editorTourId = null
    els.appView.hidden = false
    // Schließen per Knopf (nicht per Zurück): URL bereinigen, ohne Extra-Eintrag.
    if (editIdFromUrl()) history.replaceState({ studio: 'liste' }, '', studioUrl(null))
    void loadList()
  })
}

// Browser-Zurück/Vor: URL ist die Quelle — Editor und Bibliothek folgen.
window.addEventListener('popstate', () => {
  const id = editIdFromUrl()
  if (id) {
    if (editorTourId !== id) void openEditorFor(id, { history: true })
    return
  }
  if (editorTourId) {
    void import('./editor.js').then(({ closeEditor }) => closeEditor())
  }
})

// — Sichtbarkeit: Anzeige UND Umschalter an derselben Stelle —

let openVisibilityMenuEl: HTMLElement | null = null

function closeVisibilityMenu(): void {
  openVisibilityMenuEl?.remove()
  openVisibilityMenuEl = null
  document.querySelectorAll('.karte.menue-offen').forEach((k) => k.classList.remove('menue-offen'))
  document
    .querySelectorAll('[data-visibility][aria-expanded="true"]')
    .forEach((k) => k.setAttribute('aria-expanded', 'false'))
}

function openVisibilityMenu(map: HTMLElement, t: api.TourListItem): void {
  const alreadyOpen = map.classList.contains('menue-offen')
  closeVisibilityMenu()
  if (alreadyOpen) return
  const menu = document.createElement('div')
  menu.className = 'visibility-menu'
  const level = (value: string, title: string, explanation: string): string => `
    <button data-value="${value}" role="menuitemradio" aria-checked="${String(t.visibility === value)}">
      ${icon(VISIBILITY_ICONS[value] ?? 'schloss')}<span>${title}<em>${explanation}</em></span>${icon('haken', 'haken')}
    </button>`
  menu.innerHTML = `
    <div class="header-row">Wer darf mitfahren?</div>
    ${level('private', 'Privat', 'Nur du siehst diese Reise.')}
    ${level('unlisted', 'Per Link', 'Wer den Link hat, kann zusehen.')}
    ${level('public', 'Öffentlich', 'Steht in deinem Profil und der Galerie.')}
    ${t.visibility === 'private' ? '' : `<hr /><button data-link>${icon('link')}<span>Link kopieren</span></button>`}`
  menu.querySelectorAll<HTMLButtonElement>('[data-value]').forEach((b) => {
    b.addEventListener('click', async (e) => {
      e.stopPropagation()
      const value = b.dataset['value'] as 'private' | 'unlisted' | 'public'
      closeVisibilityMenu()
      await api.patchTour(t.id, { visibility: value })
      const entry = touren.find((x) => x.id === t.id)
      if (entry) entry.visibility = value
      renderLibrary()
    })
  })
  menu.querySelector('[data-link]')?.addEventListener('click', async (e) => {
    e.stopPropagation()
    closeVisibilityMenu()
    await navigator.clipboard?.writeText(`${location.origin}${tourPfad(`srv:${t.id}`)}`)
  })
  menu.addEventListener('click', (e) => e.stopPropagation())
  map.appendChild(menu)
  map.classList.add('menue-offen')
  map.querySelector('[data-visibility]')?.setAttribute('aria-expanded', 'true')
  openVisibilityMenuEl = menu
}

document.addEventListener('click', () => closeVisibilityMenu())

// — Kopfzeile: Suche, Sortierung, Ansicht —

els.search.addEventListener('input', () => {
  searchText = els.search.value
  renderLibrary()
})
els.sort.addEventListener('change', () => {
  sort = els.sort.value as typeof sort
  renderLibrary()
})
els.view.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) => {
  b.addEventListener('click', () => {
    view = b.dataset['view'] as 'raster' | 'liste'
    localStorage.setItem('maptale.view', view)
    els.view.querySelectorAll('[data-view]').forEach((x) => {
      x.setAttribute('aria-pressed', String((x as HTMLElement).dataset['view'] === view))
    })
    renderLibrary()
  })
  if (b.dataset['view'] === view) b.setAttribute('aria-pressed', 'true')
  else b.setAttribute('aria-pressed', 'false')
})
// „/" springt in die Suche — wie überall, wo man viel sucht
document.addEventListener('keydown', (e) => {
  if (
    e.key === '/' &&
    !els.appView.hidden &&
    !(e.target as HTMLElement).closest('input, textarea, select')
  ) {
    e.preventDefault()
    els.search.focus()
  }
})

function escape(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!,
  )
}

// ————————————————— Neue Tour —————————————————
//
// Erst zeigen, was ankam, dann hochladen. Eine Aufnahme ohne Ortsangabe, eine,
// die Stunden neben der Aufzeichnung liegt — das will man VORHER wissen, nicht
// hinterher an einer Tour, die anders aussieht als erwartet.

let gpxFile: File | null = null
let gpxText: string | null = null
let mediaFiles: File[] = []
let reports: MediumReport[] = []
let report: ImportReport | null = null
let runningUpload = false
const previewUrls = new Map<string, string>()

// Kein Dateiauswahl-Dialog von selbst: das Fenster erklärt erst, was hier
// hineingehört (und dass Ziehen genügt). Zwei Dialoge übereinander verdecken
// diese Ansage, und wer nur schauen wollte, muss erst einen davon wegklicken.
function openNew(): void {
  els.newBackdrop.hidden = false
  renderNew()
}

function closeNew(): void {
  if (runningUpload) return
  els.newBackdrop.hidden = true
  clearSelection()
}

function clearSelection(): void {
  gpxFile = null
  gpxText = null
  mediaFiles = []
  reports = []
  report = null
  for (const url of previewUrls.values()) URL.revokeObjectURL(url)
  previewUrls.clear()
  setNewStatus('')
}

function previewUrl(file: File): string {
  const key = `${file.name}:${file.size}:${file.lastModified}`
  let url = previewUrls.get(key)
  if (!url) {
    url = URL.createObjectURL(file)
    previewUrls.set(key, url)
  }
  return url
}

async function acceptFiles(list: FileList | File[]): Promise<void> {
  const files = [...list]
  // Der Zustand VOR dem Annehmen entscheidet über die Inszenierung: nur beim
  // ersten Ablegen gibt es das Lesen und das Wachsen des Fensters.
  const wasEmpty = !reports.length && !gpxFile
  if (wasEmpty) {
    els.newBackdrop.hidden = false
    setWindowSize(true)
    const candidates = files.filter((d) => mediaType(d.name)).length
    if (candidates) showReading(0, candidates)
  }
  let ignored = 0
  const newMedia: File[] = []
  for (const file of files) {
    if (file.name.toLowerCase().endsWith('.gpx')) {
      gpxFile = file
      gpxText = await file.text()
    } else if (mediaType(file.name)) {
      const duplicate = mediaFiles.some(
        (m) => m.name === file.name && m.size === file.size && m.lastModified === file.lastModified,
      )
      if (!duplicate) {
        mediaFiles.push(file)
        newMedia.push(file)
      }
    } else {
      ignored++
    }
  }
  els.newBackdrop.hidden = false
  setNewStatus(
    ignored
      ? `${ignored} Datei${ignored > 1 ? 'en' : ''} ignoriert (kein GPX, Foto oder Video).`
      : '',
  )
  // EXIF nur für die NEUEN lesen — bei 50 Fotos ist das der Unterschied
  // zwischen „gleich da" und einer Kaffeepause je Nachschlag.
  let read = 0
  for (const file of newMedia) {
    const type = mediaType(file.name)
    if (!type) continue
    let takenAtMs = file.lastModified
    let takenAtGuessed = true
    let location: [number, number] | null = null
    if (type === 'photo') {
      const exif = readExif(await file.arrayBuffer())
      if (exif.date) {
        takenAtMs = exifDateToMs(exif.date, ZONE)
        takenAtGuessed = false
      }
      if (exif.gps) location = exif.gps
    }
    reports.push({ file: file.name, type, takenAtMs, takenAtGuessed, location })
    if (wasEmpty) showReading(++read, newMedia.length)
  }
  renderNew()
}

/**
 * Zwischenzustand beim ersten Ablegen: der Ring füllt sich, während die
 * EXIF-Blöcke gelesen werden. Wird FORTGESCHRIEBEN statt neu gebaut — sonst
 * fing die Ring-Animation bei jeder Datei von vorn an.
 */
function showReading(read: number, total: number): void {
  const U = 2 * Math.PI * 34 // Umfang des Rings (r = 34 im 78er-Viewport)
  let el = els.newBody.querySelector<HTMLElement>('.new-reading')
  if (!el) {
    els.newBody.classList.remove('growing')
    els.newBody.innerHTML = `
      <div class="new-reading" role="status" aria-live="polite">
        <div class="ring">
          <svg viewBox="0 0 78 78" aria-hidden="true">
            <circle class="ring-track" cx="39" cy="39" r="34" />
            <circle class="voll" cx="39" cy="39" r="34"
              stroke-dasharray="${U.toFixed(1)}" stroke-dashoffset="${U.toFixed(1)}" />
          </svg>
          <span class="zahl"></span>
        </div>
        <h3>Liest die Aufnahmen</h3>
        <p>Aufnahmezeit und Ort stehen in den Dateien selbst, Maptale liest sie und ordnet alles ein.</p>
      </div>`
    el = els.newBody.querySelector<HTMLElement>('.new-reading')
  }
  if (!el) return
  const fraction = total ? read / total : 0
  el.querySelector<SVGCircleElement>('.voll')?.setAttribute(
    'stroke-dashoffset',
    (U * (1 - fraction)).toFixed(1),
  )
  const number = el.querySelector<HTMLElement>('.zahl')
  if (number) number.textContent = `${read}/${total}`
}

/**
 * Die Statuszeile im Leerzustand: dort gibt es keine Fußzeile, die sie tragen
 * könnte — „3 Dateien ignoriert" wäre sonst unsichtbar.
 */
function showEmptyHint(): void {
  const el = document.getElementById('new-empty-hint')
  if (!el) return
  const text = els.newStatus.textContent ?? ''
  el.textContent = text
  el.hidden = !text
  el.classList.toggle('fehler', els.newStatus.classList.contains('fehler'))
}

function removeMedia(files: readonly string[]): void {
  const zoomOut = new Set(files)
  mediaFiles = mediaFiles.filter((d) => !zoomOut.has(d.name))
  reports = reports.filter((b) => !zoomOut.has(b.file))
  renderNew()
}

function setNewStatus(text: string, className = ''): void {
  els.newStatus.className = `status ${className}`
  els.newStatus.textContent = text
  showEmptyHint() // no-op, solange der Leerzustand nicht auf dem Schirm ist
}

const clock = (ms: number): string =>
  new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })

function durationText(ms: number): string {
  const minutes = Math.round(ms / 60000)
  const h = Math.floor(minutes / 60)
  return h ? `${h} h ${minutes % 60} min` : `${minutes} min`
}

function renderNew(): void {
  report = validate(gpxText, reports)
  const count = reports.length
  els.newSub.textContent = count
    ? `${count} Aufnahme${count > 1 ? 'n' : ''}${gpxFile ? ` · ${gpxFile.name}` : ''}`
    : ''
  els.newBuild.disabled = !report.ready || runningUpload
  els.newTravelModeWrap.hidden = !report.ready
  // Der Fuß bleibt leer, solange nichts abgelegt ist: „Aufnahmen hinzufügen"
  // heißt NACHLEGEN (der Leerzustand sagt dasselbe größer und besser mit
  // „Dateien wählen"), und die Sichtbarkeit entscheidet über eine Tour, die es
  // noch nicht gibt. Beides kommt mit den ersten Dateien.
  const emptyState = !reports.length && !gpxFile
  els.newMore.hidden = emptyState
  els.newVisibilityWrap.hidden = emptyState
  els.newBody.innerHTML = ''

  if (emptyState) {
    setWindowSize(true)
    const empty = document.createElement('div')
    empty.className = 'new-empty'
    // Vier leere Plätze über einem Tag-Nacht-Verlauf: die Form der Sache,
    // bevor es sie gibt.
    empty.innerHTML = `
      <div class="ghost-timeline"><i></i><i></i><i></i><i></i><div class="axis"></div></div>
      <h3>Hier beginnt deine <em>nächste Tour</em></h3>
      <p>Aufzeichnung und Fotos hierher ziehen, Maptale liest die Zeitstempel und ordnet alles selbst ein.</p>
      <button class="knopf-primaer" id="new-choose">${icon('upload')}Dateien wählen</button>
      <p class="postscript">Auch ohne Aufzeichnung: Bei reinen Fotos fliegt die Kamera von Ort zu Ort.</p>
      <p class="hinweis" id="new-empty-hint" hidden></p>`
    els.newBody.appendChild(empty)
    // Die ganze Fläche ist der Griff — „Dateien wählen" ist die Ansage dafür,
    // nicht das einzige Ziel. Der Knopf trägt die Semantik (Tastatur, Vorlese-
    // programme), deshalb bekommt die Fläche KEIN role="button": ein Knopf im
    // Knopf wäre für Hilfsmittel zwei Griffe für einen Weg. Der Klick auf den
    // Knopf steigt hierher auf — ein Aufruf, kein zweiter.
    empty.addEventListener('click', () => els.files.click())
    showEmptyHint()
    return
  }

  // Erst der Inhalt, dann das Wachsen: die Klasse `wachst` lässt den Befund
  // EINMAL mit dem Fenster aufsteigen (siehe setzeFenstergroesse).
  const raster = document.createElement('div')
  raster.className = 'new-grid'
  raster.appendChild(buildPreview(report))
  raster.appendChild(buildData(report))
  els.newBody.appendChild(raster)
  if (report.media.length) els.newBody.appendChild(buildTimeBand(report))
  setWindowSize(false)
}

/**
 * Größe des Fensters an den Zustand binden — klein für die Einladung, groß für
 * die Arbeitsfläche. Beim Wechsel ins Große steigt der Inhalt einmal mit auf;
 * bei jedem weiteren Neuzeichnen (Weglassen, Anker ändern) bleibt er ruhig.
 */
function setWindowSize(small: boolean): void {
  const was = els.newWindow.classList.contains('small')
  els.newWindow.classList.toggle('small', small)
  els.newBody.classList.toggle('growing', was && !small)
}

/** Die Strecke als Form — eine Karte wäre gelogen, die Kartendaten holt erst der Player. */
function buildPreview(b: ImportReport): HTMLElement {
  const el = document.createElement('div')
  el.className = 'preview'
  const points: Array<readonly [number, number]> =
    b.track?.points.map((p) => [p[0], p[1]] as const) ??
    b.media.filter((a) => a.location).map((a) => a.location as [number, number])
  const proj = projectPreview(points)
  if (!proj) {
    el.innerHTML = `<div class="source">noch keine Strecke</div>`
    return el
  }
  // Foto-Marken: mit Aufzeichnung am zeitlich nächsten Trackpunkt, ohne
  // Aufzeichnung sind die Fotos selbst die Punkte.
  const marks = b.media
    .map((a, i) => {
      const index = b.track
        ? pointAtTime(b.track.points, a.takenAtMs)
        : b.media.filter((x) => x.location).findIndex((x) => x === a)
      const p = proj.image[index]
      if (!p) return ''
      const withoutLocation = !a.location && !b.track
      return `<circle class="marke${withoutLocation ? ' ohne-ort' : ''}" cx="${p[0]}" cy="${p[1]}" r="2.1"><title>Aufnahme ${i + 1}</title></circle>`
    })
    .join('')
  const start = proj.image[0] as [number, number]
  const end = proj.image[proj.image.length - 1] as [number, number]
  el.innerHTML = `<svg viewBox="-6 -6 112 112" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <path class="linie${b.track ? '' : ' geraten'}" d="${escape(proj.d)}"/>
      ${marks}
      <circle class="start" cx="${start[0]}" cy="${start[1]}" r="2.6"/>
      <circle class="ending" cx="${end[0]}" cy="${end[1]}" r="2.6"/>
    </svg>
    <div class="source">${b.track ? 'Aufgezeichnete Strecke' : 'Aus den Foto-Orten'}</div>`
  return el
}

function buildData(b: ImportReport): HTMLElement {
  const el = document.createElement('div')
  el.className = 'new-details'
  // Die Zahlen beschreiben die REISE, nicht die Zeitachse: die reicht bei einem
  // Ausreißer über Tage, die Tour selbst dauerte drei Stunden.
  const fromMs = b.track?.startMs ?? b.fromMs
  const toMs = b.track?.endMs ?? b.toMs
  const spanMs = toMs - fromMs
  const km = b.track?.km ?? 0
  const number = (symbol: string, kicker: string, value: string): string =>
    `<div class="z"><div class="k">${icon(symbol)}${kicker}</div><div class="w">${escape(value)}</div></div>`
  const tag = new Date(fromMs).toLocaleDateString('de-DE', { day: 'numeric', month: 'long' })
  el.innerHTML = `
    <h3 class="estimated">${b.track ? 'Die Orte benennt Maptale beim Bauen' : 'Eine Tour aus deinen Fotos'}</h3>
    <div class="numbers">
      ${number('route', 'Strecke', km ? `${String(km).replace('.', ',')} km` : '–')}
      ${number('uhr', 'Unterwegs', spanMs > 0 ? durationText(spanMs) : '–')}
      ${number('kalender', b.track ? 'Aufgezeichnet' : 'Aufgenommen', spanMs > 0 ? `${tag} · ${clock(fromMs)}–${clock(toMs)}` : '–')}
      ${number('kamera', 'Kamerafahrt', b.ready ? `≈ ${durationText(estimateRideS(km, b.media.length) * 1000)}` : '–')}
    </div>`
  const messages = document.createElement('div')
  messages.className = 'messages'
  for (const m of b.messages) {
    const row = document.createElement('div')
    row.className = `meldung ${m.tone}`
    row.innerHTML = `<span class="mark">${m.tone === 'warnung' ? '!' : '?'}</span><span>${escape(m.text)}</span>`
    // Nur wo es etwas zu entscheiden gibt, steht ein Knopf — und er benennt,
    // was er tut, statt „OK" zu sagen.
    if (m.tone === 'warnung' && m.files.length) {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = m.files.length === 1 ? 'Weglassen' : 'Alle weglassen'
      button.addEventListener('click', () => removeMedia(m.files))
      row.appendChild(button)
    }
    messages.appendChild(row)
  }
  if (b.messages.length) el.appendChild(messages)
  return el
}

/** Jede Aufnahme an ihrer Uhrzeit — das Zeitband zeigt Lücken und Ausreißer. */
function buildTimeBand(b: ImportReport): HTMLElement {
  const el = document.createElement('div')
  el.className = 'time-band'
  const span = Math.max(1, b.toMs - b.fromMs)
  const fraction = (ms: number): number => ((ms - b.fromMs) / span) * 100
  const header = document.createElement('div')
  header.className = 'kopf'
  header.textContent = `${b.media.length} Aufnahme${b.media.length > 1 ? 'n' : ''} an ihrer Uhrzeit`
  el.appendChild(header)

  const inner = document.createElement('div')
  inner.className = 'inner'
  el.appendChild(inner)
  const marks = document.createElement('div')
  marks.className = 'marks'
  // Zu dicht beieinander liegende Aufnahmen zu einer Marke bündeln — sonst
  // überdecken sich bei 50 Fotos die Bilder gegenseitig.
  const groups: Array<{ fraction: number; items: MediumReport[] }> = []
  for (const a of b.media) {
    const x = fraction(a.takenAtMs)
    const last = groups[groups.length - 1]
    if (last && x - last.fraction < 3.6) last.items.push(a)
    else groups.push({ fraction: x, items: [a] })
  }
  for (const g of groups) {
    const first = g.items[0] as MediumReport
    const file = mediaFiles.find((d) => d.name === first.file)
    const stem = document.createElement('div')
    stem.className = 'stem'
    stem.style.left = `${g.fraction.toFixed(2)}%`
    marks.appendChild(stem)
    const image = document.createElement('div')
    image.className = 'bild'
    image.style.left = `${g.fraction.toFixed(2)}%`
    image.style.bottom = '18px'
    if (!first.location) image.classList.add('no-location')
    if (
      b.track &&
      (first.takenAtMs < b.track.startMs - 20 * 60000 ||
        first.takenAtMs > b.track.endMs + 20 * 60000)
    ) {
      image.classList.add('outside')
    }
    if (first.type === 'photo' && file) image.style.backgroundImage = `url("${previewUrl(file)}")`
    else image.innerHTML = `<span class="film">${icon('film')}</span>`
    if (g.items.length > 1) {
      const number = document.createElement('span')
      number.className = 'zahl'
      number.textContent = String(g.items.length)
      image.appendChild(number)
    }
    image.title = g.items.map((i) => `${i.file} · ${clock(i.takenAtMs)}`).join('\n')
    marks.appendChild(image)
  }
  inner.appendChild(marks)

  const axis = document.createElement('div')
  axis.className = 'axis'
  if (b.track) {
    // Zeit ohne Aufzeichnung gestreift: dort lief nichts mit.
    const gap = document.createElement('div')
    gap.className = 'gap'
    gap.style.left = '0'
    gap.style.right = '0'
    axis.appendChild(gap)
    const spanEl = document.createElement('div')
    spanEl.className = 'span'
    spanEl.style.left = `${fraction(b.track.startMs).toFixed(2)}%`
    spanEl.style.width = `${(fraction(b.track.endMs) - fraction(b.track.startMs)).toFixed(2)}%`
    axis.appendChild(spanEl)
  } else {
    const spanEl = document.createElement('div')
    spanEl.className = 'span'
    spanEl.style.left = '0'
    spanEl.style.right = '0'
    axis.appendChild(spanEl)
  }
  inner.appendChild(axis)

  const hours = document.createElement('div')
  hours.className = 'hours'
  const stepH = Math.max(1, Math.ceil(span / 3600000 / 5))
  const first = new Date(b.fromMs)
  first.setMinutes(0, 0, 0)
  for (let t = first.getTime(); t <= b.toMs; t += stepH * 3600000) {
    if (t < b.fromMs) continue
    const mark = document.createElement('span')
    mark.style.left = `${fraction(t).toFixed(2)}%`
    mark.textContent = clock(t)
    hours.appendChild(mark)
  }
  inner.appendChild(hours)
  return el
}

// — Dateien annehmen: Fenster-Knopf, Kachel, Dateidialog, ganze Seite als Ablage —

els.files.addEventListener('change', () => {
  if (els.files.files?.length) void acceptFiles(els.files.files)
  els.files.value = ''
})
els.newMore.addEventListener('click', () => els.files.click())
els.newTop.addEventListener('click', () => openNew())
els.newClose.addEventListener('click', () => closeNew())
els.newBackdrop.addEventListener('click', (e) => {
  if (e.target === els.newBackdrop) closeNew()
})
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !els.newBackdrop.hidden) closeNew()
})

let dropDepth = 0
document.addEventListener('dragenter', (e) => {
  if (els.appView.hidden || !e.dataTransfer?.types.includes('Files')) return
  dropDepth++
  els.dropOverlay.hidden = false
})
document.addEventListener('dragover', (e) => {
  if (!els.dropOverlay.hidden) e.preventDefault()
})
document.addEventListener('dragleave', () => {
  dropDepth = Math.max(0, dropDepth - 1)
  if (!dropDepth) els.dropOverlay.hidden = true
})
document.addEventListener('drop', (e) => {
  if (els.appView.hidden) return
  e.preventDefault()
  dropDepth = 0
  els.dropOverlay.hidden = true
  if (e.dataTransfer?.files.length) void acceptFiles(e.dataTransfer.files)
})

// — Bauen: Manifest → PUTs → Finalize —

async function waitForReady(id: string): Promise<'ready' | 'failed' | 'processing'> {
  for (let i = 0; i < 60; i++) {
    const t = await api.tour(id)
    if (t.schema === 'maptale/tour@2' || t.status === 'ready') return 'ready'
    if (t.status === 'failed') return 'failed'
    await new Promise((r) => setTimeout(r, 1000))
  }
  return 'processing'
}

els.newBuild.addEventListener('click', async () => {
  if (!report?.ready || runningUpload) return
  if (uploadLocked) {
    setNewStatus('Bitte zuerst die E-Mail-Adresse bestätigen.', 'fehler')
    return
  }
  runningUpload = true
  els.newBuild.disabled = true
  const travelMode = els.newTravelMode.value
  const visibility = els.newVisibility.value as 'private' | 'unlisted' | 'public'
  const mediaUpload = mediaFiles.filter((d) => reports.some((b) => b.file === d.name))

  try {
    const media = mediaFromReport(report, (ms) => isoWithZone(ms, ZONE))
    const clientTourId = `studio:${(gpxFile?.name ?? report.media[0]?.file ?? 'tour').slice(0, 60)}:${report.fromMs}`
    const manifest = buildUploadManifest({
      clientTourId,
      title: null,
      zeitspanne: { startMs: report.fromMs, endMs: report.toMs },
      zone: ZONE,
      trackMode: travelMode,
      media,
    })
    // Ohne Aufzeichnung sind die Foto-Orte die Strecke: das Manifest trägt dann
    // `segments` statt `trackFile` (beides erlaubt das Schema, genau eines).
    if (!report.track) {
      const segments = buildPhotoSegments(report.media, travelMode)
      if (!segments.length) throw new Error('Zu wenige verortete Fotos für eine Strecke.')
      delete (manifest as { trackFile?: string }).trackFile
      ;(manifest as unknown as { segments: unknown }).segments = segments
    }

    showProgress(0, mediaUpload.length + 2)
    const { id, reused } = await api.createTour(manifest)
    if (reused) {
      const existing = await api.tour(id)
      if (existing.schema === 'maptale/tour@2' || existing.status === 'ready') {
        setNewStatus('Diese Tour gibt es bereits.', 'fehler')
        return
      }
    }

    let done = 0
    if (gpxText) {
      await api.uploadTrack(id, gpxText)
      showProgress(++done, mediaUpload.length + 2)
    }
    for (const entry of media) {
      const file = mediaUpload.find((d) => d.name === entry.file)
      if (!file) continue
      await api.uploadMedium(id, entry.id, file)
      showProgress(++done, mediaUpload.length + 2)
    }
    if (visibility !== 'private') await api.patchTour(id, { visibility: visibility })

    setNewStatus('Verarbeitung läuft …')
    await api.finalize(id)
    // Das Fenster darf jetzt zu: die Kachel in der Bibliothek zeigt weiter an,
    // dass die Tour entsteht — dafür muss niemand hier warten.
    runningUpload = false
    els.newBackdrop.hidden = true
    els.newProgress.hidden = true
    clearSelection()
    await loadList()
    const status = await waitForReady(id)
    if (status === 'failed') {
      const t = await api.tour(id)
      hintToast(`Verarbeitung fehlgeschlagen: ${t.error ?? 'unbekannt'}`, true)
    }
    await loadList()
    showSession(await api.me()) // Quota nachziehen
  } catch (error) {
    setNewStatus((error as Error).message, 'fehler')
  } finally {
    runningUpload = false
    els.newProgress.hidden = true
    els.newBuild.disabled = !report?.ready
  }
})

function showProgress(done: number, total: number): void {
  els.newProgress.hidden = false
  els.newProgressText.innerHTML = `<b>${done}</b> von ${total} übertragen`
}

// — Start —
// Editor-Chunk parallel zu Auth vorladen, wenn der Deep-Link ihn sowieso braucht.
if (editIdFromUrl()) void import('./editor.js')
void checkLogin()
