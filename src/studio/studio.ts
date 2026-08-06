// Studio-Schale: Login, Bibliothek und der Weg zu einer neuen Tour.
//
// Die Bibliothek ist die Bühne — Kacheln mit Titelbild und Routen-Signatur; der
// Upload ist eine Kachel darin und ein Fenster, das ZUERST zeigt, was Maptale
// aus den abgelegten Dateien gelesen hat, und erst danach hochlädt.
// Reine Logik liegt in pruefung.ts (Befund), upload.ts (Manifest) und exif.ts
// (Foto-Metadaten); hier nur DOM und Ablaufsteuerung.

import * as api from './api.js'
import { fuelleTopNav } from '../app-nav.js'
import { codeVollstaendig, formatiereEinladungscode } from '../einladungscode.js'
import { haengePasswortfeld } from '../passwortfeld.js'
import { ROUTEN, pfad, profilPfad } from '../routen.js'
import { merkeAngemeldet, vergesseAngemeldet } from '../session-hinweis.js'
import { liesExif } from './exif.js'
import {
  baueFotoSegmente,
  medienAusBefund,
  projiziereVorschau,
  pruefe,
  punktZuZeit,
  schaetzeFahrtS,
  type AufnahmeBefund,
  type Pruefbefund,
} from './pruefung.js'
import { baueUploadManifest, exifDatumZuMs, isoMitZone, medientyp } from './upload.js'

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T
const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

const els = {
  loginView: $('login-view'),
  appView: $('app-view'),
  abmelden: $<HTMLButtonElement>('abmelden'),
  benutzerChip: $<HTMLButtonElement>('benutzer-chip'),
  benutzerName: $('benutzer-name'),
  loginForm: $<HTMLFormElement>('login-form'),
  email: $<HTMLInputElement>('email'),
  passwort: $<HTMLInputElement>('passwort'),
  loginFehler: $('login-fehler'),
  // M9: Registrierung / Passwort-Reset
  authBox: $('auth-box'),
  // Schritt 1 der Registrierung: die Einladung
  codeForm: $<HTMLFormElement>('code-form'),
  regCode: $<HTMLInputElement>('reg-code'),
  codeFehler: $('code-fehler'),
  codeWeiter: $<HTMLButtonElement>('code-weiter'),
  // Schritt 2: die eigenen Daten
  registerForm: $<HTMLFormElement>('register-form'),
  regEmail: $<HTMLInputElement>('reg-email'),
  regPasswort: $<HTMLInputElement>('reg-passwort'),
  regNewsletter: $<HTMLInputElement>('reg-newsletter'),
  regCodeChip: $('reg-code-chip'),
  regCodeWert: $('reg-code-wert'),
  regCodeAendern: $<HTMLButtonElement>('reg-code-aendern'),
  regAbsenden: $<HTMLButtonElement>('reg-absenden'),
  regUnterzeile: $('reg-unterzeile'),
  registerFehler: $('register-fehler'),
  // Warteliste: der Weg herein für alle ohne Code
  zurWarteliste: $<HTMLButtonElement>('zur-warteliste'),
  wartelisteForm: $<HTMLFormElement>('warteliste-form'),
  wlEmail: $<HTMLInputElement>('wl-email'),
  wlNotiz: $<HTMLTextAreaElement>('wl-notiz'),
  wlFehler: $('wl-fehler'),
  wlAbsenden: $<HTMLButtonElement>('wl-absenden'),
  wartelisteInfo: $('warteliste-info'),
  wlInfoTitel: $('wl-info-titel'),
  wlInfoText: $('wl-info-text'),
  wlInfoFehler: $('wl-info-fehler'),
  wlInfoAktion: $<HTMLButtonElement>('wl-info-aktion'),
  resetAnfordernForm: $<HTMLFormElement>('reset-anfordern-form'),
  resetEmail: $<HTMLInputElement>('reset-email'),
  resetAnfordernStatus: $('reset-anfordern-status'),
  resetSetzenForm: $<HTMLFormElement>('reset-setzen-form'),
  resetPasswort: $<HTMLInputElement>('reset-passwort'),
  resetAbsenden: $<HTMLButtonElement>('reset-absenden'),
  resetSetzenFehler: $('reset-setzen-fehler'),
  // M9: Konto-Menü + Verifikations-Banner
  kontoMenue: $('konto-menue'),
  kmMail: $('km-mail'),
  kmProfil: $<HTMLAnchorElement>('km-profil'),
  kmVerwaltung: $('km-verwaltung'),
  kmQuotaText: $('km-quota-text'),
  kmBalkenFuell: $('km-balken-fuell'),
  verifyBanner: $('verify-banner'),
  dateien: $<HTMLInputElement>('dateien'),
  neuOben: $<HTMLButtonElement>('neu-oben'),
  // Bibliothek
  bibKopf: $('bib-kopf'),
  bibliothek: $('bibliothek'),
  suche: $<HTMLInputElement>('suche'),
  sortierung: $<HTMLSelectElement>('sortierung'),
  ansicht: $('ansicht'),
  dropOverlay: $('drop-overlay'),
  // Neue Tour
  neuHinter: $('neu-hinter'),
  neuUnter: $('neu-unter'),
  neuRumpf: $('neu-rumpf'),
  neuStatus: $('neu-status'),
  neuModusWrap: $('neu-modus-wrap'),
  neuModus: $<HTMLSelectElement>('neu-modus'),
  neuSicht: $<HTMLSelectElement>('neu-sicht'),
  neuSichtWrap: $('neu-sicht-wrap'),
  neuFenster: $('neu-fenster'),
  neuMehr: $<HTMLButtonElement>('neu-mehr'),
  neuBauen: $<HTMLButtonElement>('neu-bauen'),
  neuSchliessen: $<HTMLButtonElement>('neu-schliessen'),
  neuFortschritt: $('neu-fortschritt'),
  neuFortschrittText: $('neu-fortschritt-text'),
}

/** Statisches Icon aus dem Sprite in studio.html (nur für vertrauten Markup-Bau). */
const icon = (name: string, klasse?: string): string =>
  `<svg${klasse ? ` class="${klasse}"` : ''} aria-hidden="true"><use href="#i-${name}"/></svg>`

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
const TITEL = {
  app: 'Maptale Studio',
  anmelden: 'Anmelden · Maptale',
  registrieren: 'Konto erstellen · Maptale',
} as const

function setzePfad(seite: 'app' | 'anmelden' | 'registrieren'): void {
  // Der Titel läuft mit, aber VOR dem Abbruch: Beim ersten Laden stimmt der
  // Pfad schon, der Titel („Maptale" aus dem Boot) noch nicht.
  document.title = TITEL[seite]
  const ziel = ROUTEN[seite].pfad
  if (location.pathname === ziel) return
  history.replaceState(history.state, '', ziel + location.search + location.hash)
}

/** Für Gäste entscheidet das sichtbare Formular, ob die Adresse Tür oder Aufnahme heißt. */
function setzeGastPfad(): void {
  const aufDemWegHinein =
    !els.registerForm.hidden || !els.codeForm.hidden || !els.wartelisteForm.hidden || !els.wartelisteInfo.hidden
  setzePfad(aufDemWegHinein ? 'registrieren' : 'anmelden')
}

function zeige(angemeldet: boolean): void {
  els.loginView.hidden = angemeldet
  els.appView.hidden = !angemeldet
  els.benutzerChip.hidden = !angemeldet
  els.neuOben.hidden = !angemeldet
  if (!angemeldet) {
    els.kontoMenue.hidden = true
    els.benutzerChip.setAttribute('aria-expanded', 'false')
  }
  if (angemeldet) setzePfad('app')
  else setzeGastPfad()
}

/** Boot-Overlay ausblenden, sobald Login oder App sichtbar sind. */
function versteckeBoot(): void {
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
function zeigeBenutzer(sitzung: api.Sitzung): void {
  const benutzer = sitzung.benutzer
  const anzeige =
    sitzung.profil?.anzeigename?.trim() || benutzer?.name || benutzer?.email || ''
  els.benutzerName.textContent = anzeige
  els.kmMail.textContent = benutzer?.email ?? ''

  const avatar = sitzung.profil?.avatarUrl
  const punkt = els.benutzerChip.querySelector('.punkt')
  if (!punkt) return
  if (avatar) {
    if (punkt instanceof HTMLImageElement) {
      punkt.src = avatar
    } else {
      const img = document.createElement('img')
      img.className = 'punkt'
      img.src = avatar
      img.alt = ''
      img.width = 20
      img.height = 20
      punkt.replaceWith(img)
    }
  } else {
    const initial = (anzeige.trim().charAt(0) || '?').toUpperCase()
    if (punkt instanceof HTMLImageElement) {
      const span = document.createElement('span')
      span.className = 'punkt'
      span.id = 'benutzer-initial'
      span.textContent = initial
      punkt.replaceWith(span)
    } else {
      punkt.textContent = initial
    }
  }
}

// — Auth-Modus umschalten (Anmelden / Einladung / Registrieren / Reset / Warteliste) —
type AuthModus =
  | 'login'
  | 'code'
  | 'register'
  | 'reset-anfordern'
  | 'reset-setzen'
  | 'warteliste'
  | 'warteliste-info'
// HTMLElement, nicht HTMLFormElement: Die Wartelisten-Meldung ist kein
// Formular, sondern ein Satz mit höchstens einem Griff.
const authFormen: Record<AuthModus, HTMLElement> = {
  login: els.loginForm,
  code: els.codeForm,
  register: els.registerForm,
  'reset-anfordern': els.resetAnfordernForm,
  'reset-setzen': els.resetSetzenForm,
  warteliste: els.wartelisteForm,
  'warteliste-info': els.wartelisteInfo,
}

function zeigeAuthModus(modus: AuthModus): void {
  for (const [name, form] of Object.entries(authFormen)) form.hidden = name !== modus
  setzeGastPfad()
}

/**
 * Nach einem Wechsel steht die Schreibmarke im ersten Feld.
 *
 * Nur nach einem KLICK, nicht beim Laden der Seite: Ein Autofokus beim
 * Seitenaufbau schiebt auf kleinen Geräten die Bühne aus dem Bild und öffnet
 * ungefragt die Tastatur.
 */
function fokussiereErstesFeld(): void {
  const sichtbar = Object.values(authFormen).find((form) => !form.hidden)
  sichtbar?.querySelector<HTMLElement>('input:not([type="hidden"]), textarea')?.focus()
}

/**
 * Der Weg zur Registrierung — er beginnt bei der Einladung, wenn eine
 * gebraucht wird und noch keine bestätigt ist.
 *
 * Alle Wege dorthin laufen hier durch (Knopf im Login, `#registrieren` von der
 * Landing), damit die Reihenfolge an EINER Stelle steht: Wer keinen gültigen
 * Code hat, soll das erfahren, bevor er ein Formular ausfüllt.
 */
function starteRegistrierung(): void {
  zeigeAuthModus(einladungPflicht && !bestaetigterCode ? 'code' : 'register')
}

// Modus-Wechsel-Links (data-modus) in allen Auth-Formularen
els.authBox.querySelectorAll<HTMLButtonElement>('[data-modus]').forEach((btn) => {
  btn.addEventListener('click', () => {
    els.loginFehler.textContent = ''
    els.registerFehler.textContent = ''
    els.codeFehler.textContent = ''
    els.wlFehler.textContent = ''
    const ziel = btn.dataset.modus as AuthModus
    if (ziel === 'register') starteRegistrierung()
    else zeigeAuthModus(ziel)
    fokussiereErstesFeld()
  })
})

/** Verifikations-Stand: Banner + Upload-Sperre + Quota-Balken aktualisieren. */
let uploadGesperrt = false

function zeigeSitzung(sitzung: api.Sitzung): void {
  const unbestaetigt = sitzung.benutzer !== null && sitzung.verifiziert === false
  els.verifyBanner.hidden = !unbestaetigt
  els.kmVerwaltung.hidden = sitzung.benutzer?.rolle !== 'admin'
  // „Mein Profil" zeigt auf die Adresse der Person, nicht auf /profil — dort
  // stünde ohne Handle nichts. Ohne Handle bleibt der Eintrag weg.
  const handle = sitzung.profil?.handle
  els.kmProfil.hidden = !handle
  if (handle) els.kmProfil.href = profilPfad(handle)
  uploadGesperrt = unbestaetigt
  els.neuBauen.title = unbestaetigt ? 'Erst E-Mail bestätigen' : ''
  if (sitzung.quota) {
    const mb = (b: number): string => (b / (1024 * 1024)).toFixed(0)
    const anteil = sitzung.quota.limit > 0 ? sitzung.quota.benutzt / sitzung.quota.limit : 0
    els.kmQuotaText.textContent = `${mb(sitzung.quota.benutzt)} / ${mb(sitzung.quota.limit)} MB`
    els.kmBalkenFuell.style.width = `${Math.min(100, anteil * 100).toFixed(0)}%`
    els.kmBalkenFuell.classList.toggle('voll', anteil > 0.9)
  }
}

/** Verlangt diese Instanz eine Einladung? (Aus /auth/me, auch ohne Anmeldung.) */
let einladungPflicht = false
/** Der in Schritt 1 vom Server bestätigte Code — leer, solange keiner steht. */
let bestaetigterCode = ''

/**
 * Den bestätigten Code merken und in Schritt 2 als Beleg zeigen.
 *
 * Der Chip ist kein Schmuck: Ohne ihn wüsste in Schritt 2 niemand, ob die
 * Einladung angekommen ist — und ob ein Tippfehler noch zu korrigieren wäre.
 */
function setzeBestaetigtenCode(code: string): void {
  bestaetigterCode = code
  els.regCodeChip.hidden = !code
  els.regCodeWert.textContent = code
}

function zeigeRegistrierungsmodus(sitzung: api.Sitzung): void {
  einladungPflicht = sitzung.registrierung?.einladungPflicht ?? false
  // Der Weg zur Warteliste steht nur da, wo der Server ihn anbietet — sonst
  // führte ein Link auf ein Formular, dessen Route mit 403 antwortet.
  els.zurWarteliste.hidden = !sitzung.registrierung?.warteliste
  // Steht die Tür wieder offen, ist ein bestätigter Code gegenstandslos —
  // sonst hinge der Chip über einem Formular, das gar nichts mehr fragt.
  if (!einladungPflicht) setzeBestaetigtenCode('')
  els.regUnterzeile.textContent = einladungPflicht
    ? 'Noch deine Adresse und ein Passwort, dann bist du drin.'
    : 'Kostenlos. Du bekommst gleich eine Bestätigungsmail.'
  // `#registrieren` von der Landing fällt vor dieser Antwort an und kannte die
  // Pflicht noch nicht — hier steht der Einstieg gerade, falls nötig.
  if (!els.registerForm.hidden && einladungPflicht && !bestaetigterCode) zeigeAuthModus('code')
}

async function ladeSitzung(): Promise<api.Sitzung> {
  const sitzung = await api.me()
  zeigeBenutzer(sitzung)
  zeige(!!sitzung.benutzer)
  zeigeRegistrierungsmodus(sitzung)
  if (sitzung.benutzer) {
    merkeAngemeldet()
    zeigeSitzung(sitzung)
    // Deep-Link: /studio.html?edit=<tourId> — Editor ZUERST, Liste danach.
    // Sonst rendert die Bibliothek unter dem Boot und blitzt beim Ausblenden
    // kurz auf; außerdem spart der Editor-Chunk den Listen-Roundtrip.
    const editId = editIdAusUrl()
    if (editId) {
      await oeffneEditorFuer(editId, { geschichte: true })
      void ladeListe()
    } else {
      await ladeListe()
    }
  } else {
    // Hinweis war gesetzt, Sitzung aber weg (abgelaufen) → zurück zum Login.
    vergesseAngemeldet()
    document.documentElement.classList.remove('studio-dabei')
  }
  return sitzung
}

async function pruefeAnmeldung(): Promise<void> {
  // Zuerst Mail-Links aus der URL abarbeiten (#verify=… / #reset=…)
  try {
    // Ein Wartelisten-Link gilt AUCH für Angemeldete: Er beantwortet eine Frage
    // der Adresse, nicht des Kontos. Ohne diesen Abbruch schöbe `ladeSitzung`
    // die Bibliothek darüber, und der Austragen-Link liefe für jeden mit
    // offener Sitzung ins Leere.
    if (await behandleAuthHash()) return
    await ladeSitzung()
  } finally {
    // Auch bei Netzwerkfehlern den Boot weg — sonst hängt man ewig.
    versteckeBoot()
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
async function behandleAuthHash(): Promise<boolean> {
  const hash = location.hash.slice(1)
  const verify = hash.match(/(?:^|&)verify=([^&]+)/)?.[1]
  const reset = hash.match(/(?:^|&)reset=([^&]+)/)?.[1]
  const einladung = hash.match(/(?:^|&)einladung=([^&]+)/)?.[1]
  const wlBestaetigen = hash.match(/(?:^|&)warteliste=([^&]+)/)?.[1]
  const wlAustragen = hash.match(/(?:^|&)warteliste-austragen=([^&]+)/)?.[1]
  // Der bloße Einstieg — er darf keinen Token-Hash überholen: Der Link aus der
  // Verwaltung heißt seit den sauberen URLs `/registrieren#einladung=CODE` und
  // erfüllt die Pfad-Bedingung selbst.
  const direktZurRegistrierung =
    !verify &&
    !reset &&
    !einladung &&
    !wlBestaetigen &&
    !wlAustragen &&
    (hash === 'registrieren' || location.pathname === ROUTEN.registrieren.pfad)
  if (direktZurRegistrierung) {
    history.replaceState(null, '', location.pathname + location.search)
    zeigeAuthModus('register')
    return false
  }
  if (einladung) {
    history.replaceState(null, '', location.pathname + location.search)
    const code = formatiereEinladungscode(decodeURIComponent(einladung))
    els.regCode.value = code
    // Den Code gleich prüfen: Wer einem Einladungslink folgt, hat Schritt 1
    // bereits hinter sich — außer der Code taugt nicht, dann landet er dort und
    // sieht, warum.
    try {
      await api.pruefeEinladung(code)
      setzeBestaetigtenCode(code)
      zeigeAuthModus('register')
      els.regEmail.focus()
    } catch (fehler) {
      els.codeFehler.textContent = (fehler as Error).message
      zeigeAuthModus('code')
    }
    return false
  }
  // Der Klick aus der Wartelisten-Mail. Er ist die Einwilligung — deshalb löst
  // ihn erst diese Seite ein und nicht schon der Link selbst (ein GET, den
  // jeder Scanner mitnimmt, wäre keine Handlung des Menschen).
  if (wlBestaetigen) {
    history.replaceState(null, '', location.pathname + location.search)
    const token = decodeURIComponent(wlBestaetigen)
    try {
      const { email } = await api.bestaetigeWarteliste(token)
      zeigeWartelistenInfo(
        'Du stehst auf der Liste',
        `${email} ist vorgemerkt. Sobald ein Platz frei wird, kommt dein Einladungscode per E-Mail.`,
        { wort: 'Wieder austragen', tun: () => trageAusWarteliste(token) },
      )
    } catch (fehler) {
      zeigeWartelistenInfo('Dieser Link geht nicht mehr', (fehler as Error).message)
    }
    return true
  }
  if (wlAustragen) {
    history.replaceState(null, '', location.pathname + location.search)
    const token = decodeURIComponent(wlAustragen)
    zeigeWartelistenInfo(
      'Aus der Warteliste austragen?',
      'Wir löschen deine Adresse sofort und schicken dir keine Einladung mehr.',
      { wort: 'Ja, austragen', tun: () => trageAusWarteliste(token) },
    )
    return true
  }
  if (verify) {
    history.replaceState(null, '', location.pathname + location.search)
    try {
      await api.verifiziereEmail(decodeURIComponent(verify))
      hinweisToast('E-Mail bestätigt. Du kannst jetzt hochladen.') // danach eingeloggt → App-View sichtbar
    } catch (fehler) {
      // Fehlschlag heißt: nicht eingeloggt → App-View bleibt verborgen. Die
      // Meldung gehört daher ins (sichtbare) Login-Fehlerfeld.
      els.loginFehler.textContent = (fehler as Error).message
    }
  } else if (reset) {
    history.replaceState(null, '', location.pathname + location.search)
    resetToken = decodeURIComponent(reset)
    zeigeAuthModus('reset-setzen')
  }
  return false
}

let resetToken: string | null = null

// — Passwortfelder: Stärke anzeigen und schwache Wahl abfangen —
//
// Der Absende-Knopf sperrt erst, wenn tatsächlich etwas Schwaches im Feld
// steht: Ein von Anfang an grauer Knopf sähe aus, als wäre das Formular kaputt,
// und beim leeren Feld greift ohnehin `required`.
const bindeAbsenden = (feld: HTMLInputElement, knopf: HTMLButtonElement) => (befund: { reicht: boolean }) => {
  knopf.disabled = feld.value.length > 0 && !befund.reicht
}

const regPasswortfeld = haengePasswortfeld(els.regPasswort, {
  // Name und Adresse stehen im selben Formular und ändern sich noch, während
  // das Passwort schon getippt ist — deshalb als Funktion, nicht als Wert.
  persoenlich: () => [els.regEmail.value],
  beiAenderung: bindeAbsenden(els.regPasswort, els.regAbsenden),
})

// Beim Anmelden nur der Sichtbarkeits-Schalter: Ein bestehendes Passwort zu
// bewerten hilft niemandem, aber ein Tippfehler im verdeckten Feld ist der
// häufigste Grund, warum eine Anmeldung scheitert.
haengePasswortfeld(els.passwort, { bewertung: false })

haengePasswortfeld(els.resetPasswort, {
  // Beim Reset kennen wir nur die Adresse aus dem Anmeldefeld — besser als nichts.
  persoenlich: () => [els.email.value],
  beiAenderung: bindeAbsenden(els.resetPasswort, els.resetAbsenden),
})

els.loginForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  els.loginFehler.textContent = ''
  try {
    await api.login(els.email.value.trim(), els.passwort.value)
    els.passwort.value = ''
    await ladeSitzung()
  } catch (fehler) {
    els.loginFehler.textContent = (fehler as Error).message
  }
})

// — Schritt 1: die Einladung —

// Unter dem Finger aufräumen: Versalien, Bindestrich von selbst, Unerlaubtes
// fällt weg. Die Schreibmarke ans Ende zu setzen genügt, weil nur vorwärts
// getippt wird — beim Einfügen ist das Ende ohnehin die richtige Stelle.
els.regCode.addEventListener('input', () => {
  els.regCode.value = formatiereEinladungscode(els.regCode.value)
  els.codeFehler.textContent = ''
})

els.codeForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  els.codeFehler.textContent = ''
  const code = formatiereEinladungscode(els.regCode.value)
  if (!codeVollstaendig(code)) {
    els.codeFehler.textContent = 'Ein Code hat acht Zeichen. Bitte gib ihn vollständig ein.'
    return
  }
  els.codeWeiter.disabled = true
  els.codeWeiter.textContent = 'Wird geprüft …'
  try {
    await api.pruefeEinladung(code)
    setzeBestaetigtenCode(code)
    zeigeAuthModus('register')
    els.regEmail.focus()
  } catch (fehler) {
    els.codeFehler.textContent = (fehler as Error).message
    els.regCode.select()
  } finally {
    els.codeWeiter.disabled = false
    els.codeWeiter.textContent = 'Weiter'
  }
})

els.regCodeAendern.addEventListener('click', () => {
  els.registerFehler.textContent = ''
  zeigeAuthModus('code')
  els.regCode.select()
})

// — Schritt 2: die eigenen Daten —

els.registerForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  els.registerFehler.textContent = ''
  els.regAbsenden.disabled = true
  try {
    // Der Haken geht als ausdrückliches `true` mit — und nur dann. Er ist kein
    // Bestandteil der Anmeldung: Fehlt er, entsteht das Konto unverändert.
    await api.registriere(els.regEmail.value.trim(), els.regPasswort.value, bestaetigterCode || undefined, {
      newsletter: els.regNewsletter.checked,
    })
    regPasswortfeld.leere()
    await ladeSitzung() // direkt eingeloggt; Banner „bitte bestätigen" erscheint
  } catch (fehler) {
    els.registerFehler.textContent = (fehler as Error).message
    // Ein zwischenzeitlich verbrauchter Code führt zurück in Schritt 1 — dort
    // steht das Feld, in dem sich das beheben lässt.
    if (einladungPflicht && /Einladungscode/i.test((fehler as Error).message)) {
      setzeBestaetigtenCode('')
      els.codeFehler.textContent = (fehler as Error).message
      zeigeAuthModus('code')
    }
  } finally {
    els.regAbsenden.disabled = false
  }
})

// — Warteliste —
//
// Drei Wege enden in derselben Ansicht: eingetragen, bestätigt, ausgetragen.
// Sie trägt einen Satz und höchstens einen Griff — mehr hat die Warteliste
// nicht zu sagen, und ein Formular, das nach dem Absenden stehen bleibt, sähe
// aus, als wäre nichts passiert.

/** Was der Knopf der Info-Ansicht gerade tut; null = kein Knopf. */
let wlAktion: (() => void | Promise<void>) | null = null

function zeigeWartelistenInfo(
  titel: string,
  text: string,
  aktion?: { wort: string; tun: () => void | Promise<void> },
): void {
  els.wlInfoTitel.textContent = titel
  els.wlInfoText.textContent = text
  els.wlInfoFehler.textContent = ''
  els.wlInfoAktion.hidden = !aktion
  els.wlInfoAktion.textContent = aktion?.wort ?? ''
  wlAktion = aktion?.tun ?? null
  // Die Bühne gehört jetzt dieser Meldung — auch bei bestehender Sitzung. Der
  // Boot-Vorgriff (Cookie `maptale_dabei`) hat die Bibliothek sonst schon
  // eingeblendet, bevor der Link überhaupt gelesen wurde, und der Austragen-Weg
  // endete für jeden Angemeldeten in seiner Tourliste.
  zeige(false)
  document.documentElement.classList.remove('studio-dabei')
  zeigeAuthModus('warteliste-info')
}

els.wlInfoAktion.addEventListener('click', () => void wlAktion?.())

/**
 * Austragen — der Weg hinaus ohne Konto.
 *
 * Er läuft nie auf einen bloßen Link-Aufruf hin, sondern immer über einen
 * Knopf: Mail-Programme und Virenscanner öffnen Links vorab, und eine Löschung
 * durch einen Scanner wäre eine, die niemand wollte.
 */
async function trageAusWarteliste(token: string): Promise<void> {
  els.wlInfoFehler.textContent = ''
  els.wlInfoAktion.disabled = true
  try {
    await api.trageAusWarteliste(token)
    zeigeWartelistenInfo('Ausgetragen', 'Deine Adresse ist gelöscht. Du bekommst keine Post mehr von uns.')
  } catch (fehler) {
    els.wlInfoFehler.textContent = (fehler as Error).message
  } finally {
    els.wlInfoAktion.disabled = false
  }
}

els.wartelisteForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  els.wlFehler.textContent = ''
  els.wlAbsenden.disabled = true
  const adresse = els.wlEmail.value.trim()
  try {
    await api.trageInWarteliste(adresse, els.wlNotiz.value.trim() || undefined)
    els.wlEmail.value = ''
    els.wlNotiz.value = ''
    // Bewusst dieselbe Antwort für jede Lage (neu, schon eingetragen, schon
    // Konto) — die Route verrät nicht, wer auf der Liste steht, und die
    // Oberfläche soll es auch nicht.
    zeigeWartelistenInfo(
      'Schau in dein Postfach',
      `Wenn alles passt, ist eine E-Mail an ${adresse} unterwegs. Erst dein Klick darin macht den Eintrag gültig. Ohne ihn löschen wir die Adresse wieder.`,
    )
  } catch (fehler) {
    els.wlFehler.textContent = (fehler as Error).message
  } finally {
    els.wlAbsenden.disabled = false
  }
})

els.resetAnfordernForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  await api.passwortResetAnfordern(els.resetEmail.value.trim())
  // Bewusst neutrale Rückmeldung (keine Existenz-Auskunft)
  els.resetAnfordernStatus.textContent = 'Wenn es ein Konto mit dieser Adresse gibt, ist die E-Mail unterwegs.'
  els.resetAnfordernStatus.className = 'hinweis ok'
})

els.resetSetzenForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  els.resetSetzenFehler.textContent = ''
  if (!resetToken) return
  try {
    await api.passwortReset(resetToken, els.resetPasswort.value)
    resetToken = null
    await ladeSitzung()
  } catch (fehler) {
    els.resetSetzenFehler.textContent = (fehler as Error).message
  }
})

els.abmelden.addEventListener('click', async () => {
  els.kontoMenue.hidden = true
  els.benutzerChip.setAttribute('aria-expanded', 'false')
  if (editorTourId) {
    const { schliesseEditor } = await import('./editor.js')
    schliesseEditor()
  }
  await api.logout()
  vergesseAngemeldet()
  document.documentElement.classList.remove('studio-dabei')
  zeige(false)
  zeigeAuthModus('login')
})

// — Konto-Menü (Quota + Konto löschen) —
els.benutzerChip.addEventListener('click', () => {
  const auf = els.kontoMenue.hidden
  els.kontoMenue.hidden = !auf
  els.benutzerChip.setAttribute('aria-expanded', String(auf))
})
document.addEventListener('click', (e) => {
  if (!els.kontoMenue.hidden && !(e.target as HTMLElement).closest('.konto-wrap')) {
    els.kontoMenue.hidden = true
    els.benutzerChip.setAttribute('aria-expanded', 'false')
  }
})

/** Kurze Rückmeldung im Fenster „Neue Tour" — der einzige Ort mit Statuszeile. */
function hinweisToast(text: string, fehler = false): void {
  setzeNeuStatus(text, fehler ? 'fehler' : '')
  if (fehler) els.neuHinter.hidden = false
}

// — Bibliothek: die Touren sind die Seite —
//
// Kacheln statt Zeilen, weil eine Reise ein Bild hat. Die Form der Route liegt
// als Signatur über dem Titelbild — Fotos sehen einander ähnlich, Routen nicht.

let touren: api.TourListe[] = []
let ansicht: 'raster' | 'liste' = localStorage.getItem('maptale.ansicht') === 'liste' ? 'liste' : 'raster'
let sortierung: 'neu' | 'alt' | 'km' | 'az' = 'neu'
let suchtext = ''
/** Läuft, solange eine Tour noch entsteht — die Kachel soll nicht ewig schimmern. */
let nachfassen: number | null = null

const SICHT_NAMEN: Record<string, string> = { private: 'Privat', unlisted: 'Per Link', public: 'Öffentlich' }
const SICHT_ICONS: Record<string, string> = { private: 'schloss', unlisted: 'schloss-offen', public: 'welt' }

function datum(iso: string): string {
  const d = new Date(iso)
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('de-DE', { day: 'numeric', month: 'long' }) : ''
}

/** Zeile unter dem Titel: Strecke · Aufnahmen · Datum — nur, was es gibt. */
function metaZeile(t: api.TourListe): string {
  const teile: string[] = []
  if (t.stats?.km) teile.push(`${String(t.stats.km).replace('.', ',')} km`)
  if (t.stats?.fotos) teile.push(t.stats.fotos === 1 ? '1 Aufnahme' : `${t.stats.fotos} Aufnahmen`)
  teile.push(datum(t.createdAt))
  return teile.filter(Boolean).join(' · ')
}

function sichtbare(): api.TourListe[] {
  const suche = suchtext.trim().toLowerCase()
  const gefiltert = suche
    ? touren.filter((t) => (t.title ?? '').toLowerCase().includes(suche) || t.no.toLowerCase().includes(suche))
    : [...touren]
  const nachDatum = (a: api.TourListe, b: api.TourListe): number => Date.parse(b.createdAt) - Date.parse(a.createdAt)
  if (sortierung === 'alt') return gefiltert.sort((a, b) => -nachDatum(a, b))
  if (sortierung === 'km') return gefiltert.sort((a, b) => (b.stats?.km ?? 0) - (a.stats?.km ?? 0))
  if (sortierung === 'az')
    return gefiltert.sort((a, b) => (a.title ?? '').localeCompare(b.title ?? '', 'de'))
  return gefiltert.sort(nachDatum)
}

async function ladeListe(): Promise<void> {
  if (!touren.length) {
    els.bibliothek.innerHTML = '<div class="skelett"><div></div><div></div><div></div><div></div></div>'
  }
  try {
    touren = await api.listeTouren()
  } catch {
    els.bibliothek.innerHTML =
      '<div class="leer-buehne"><h2>Touren konnten nicht geladen werden</h2><p>Der Server hat nicht geantwortet — kurz warten und die Seite neu laden.</p></div>'
    return
  }
  renderBibliothek()
  // Entsteht gerade eine Tour, kommt die Liste von selbst wieder — sonst bliebe
  // die schimmernde Kachel stehen, bis jemand neu lädt.
  const arbeitet = touren.some((t) => t.status !== 'bereit' && t.status !== 'fehler')
  if (nachfassen !== null) clearTimeout(nachfassen)
  nachfassen = arbeitet ? window.setTimeout(() => void ladeListe(), 3000) : null
}

function renderBibliothek(): void {
  schliesseSichtMenue()
  const liste = sichtbare()
  els.bibKopf.hidden = touren.length === 0
  els.bibliothek.innerHTML = ''

  if (!touren.length) {
    const leer = document.createElement('div')
    leer.className = 'leer-buehne'
    leer.innerHTML = `
      <svg class="route" viewBox="0 0 1200 320" preserveAspectRatio="none" aria-hidden="true"><path d="M-20 250C160 232 190 96 380 84s250 128 420 62 280-168 440-176"/></svg>
      <h2>Hier entsteht deine erste Tour</h2>
      <p>Eine Aufzeichnung, ein paar Fotos — Maptale benennt die Orte, holt das Wetter des Tages und baut daraus eine Kamerafahrt.</p>
      <button class="knopf-primaer" id="leer-waehlen">${icon('upload')}Dateien wählen</button>`
    els.bibliothek.appendChild(leer)
    leer.querySelector('#leer-waehlen')?.addEventListener('click', () => oeffneNeu())
    return
  }

  // Suche ohne Treffer: das sagen, statt eine Seite mit nur der Upload-Kachel
  // zu zeigen — die sieht aus wie „du hast keine Touren".
  if (!liste.length) {
    const nichts = document.createElement('div')
    nichts.className = 'leer-buehne'
    nichts.innerHTML = `<h2>Keine Tour passt dazu</h2><p>„${escape(suchtext.trim())}" kommt in keinem Titel vor.</p>`
    els.bibliothek.appendChild(nichts)
    return
  }

  if (ansicht === 'liste') {
    const wirt = document.createElement('div')
    wirt.className = 'liste'
    for (const t of liste) wirt.appendChild(baueZeile(t))
    els.bibliothek.appendChild(wirt)
    return
  }

  const raster = document.createElement('div')
  raster.className = 'raster'
  const neu = document.createElement('button')
  neu.className = 'neu-kachel'
  neu.id = 'neu-kachel'
  neu.innerHTML = `${icon('upload')}<span class="h">Neue Tour</span><span class="n">Aufzeichnung und Fotos hierher ziehen — den Rest macht Maptale</span>`
  neu.addEventListener('click', () => oeffneNeu())
  raster.appendChild(neu)
  for (const t of liste) raster.appendChild(baueKarte(t))
  els.bibliothek.appendChild(raster)
}

/** Die Form der Tour über dem Titelbild — nur, wenn der Server sie mitliefert. */
function spurSignet(t: api.TourListe): string {
  const s = t.stats?.spur
  if (!s) return ''
  return `<svg class="spur" viewBox="-6 -6 112 112" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    <path class="linie" d="${escape(s.d)}"/>
    <circle class="start" cx="${s.start[0]}" cy="${s.start[1]}" r="3.2"/>
    <circle class="ende" cx="${s.ende[0]}" cy="${s.ende[1]}" r="3.2"/></svg>`
}

function baueKarte(t: api.TourListe): HTMLElement {
  const el = document.createElement('article')
  const arbeitet = t.status !== 'bereit' && t.status !== 'fehler'
  el.className = `karte${arbeitet ? ' arbeitet' : ''}${t.status === 'fehler' ? ' defekt' : ''}`
  el.dataset['tour'] = t.id
  // Kachel-Fassung, wo es sie gibt: die Bibliothek zog bisher je Kachel das
  // volle Titelfoto (mehrere MB) für ein Bild von wenigen hundert Pixeln.
  const titelbild = t.coverThumb ?? t.cover
  const bild = titelbild
    ? `<div class="bild"><img src="${escape(titelbild)}" alt="" loading="lazy" />${spurSignet(t)}</div>`
    : `<div class="bild ohne">${icon('route')}${spurSignet(t)}</div>`

  // Auf der Übersicht nur das Zeichen; was schiefging, steht in der geöffneten Tour.
  const griffe = arbeitet
    ? ''
    : `<div class="griffe">
        ${
          t.status === 'fehler'
            ? '<span class="fehler-punkt" title="Etwas ist schiefgelaufen — zum Öffnen klicken" aria-label="Fehler">!</span>'
            : `<button class="sicht${t.visibility === 'public' ? ' oeffentlich' : ''}" data-sicht aria-haspopup="true" aria-expanded="false" aria-label="Sichtbarkeit: ${SICHT_NAMEN[t.visibility] ?? t.visibility}">${icon(SICHT_ICONS[t.visibility] ?? 'schloss')}<span>${SICHT_NAMEN[t.visibility] ?? t.visibility}</span></button>`
        }
        <button class="stift-knopf" data-bearbeiten="${t.id}" aria-label="Bearbeiten">${icon('stift')}<span>Bearbeiten</span></button>
      </div>`

  el.innerHTML = `${bild}${griffe}
    <div class="fuss">
      <div class="t">${escape(t.title ?? '(ohne Titel)')}</div>
      <div class="m">${arbeitet ? 'entsteht gerade …' : escape(metaZeile(t))}</div>
    </div>
    ${arbeitet ? '<div class="lauf"><span></span></div>' : '<div class="schleier"></div>'}
    ${arbeitet || t.status === 'fehler' ? '' : `<button class="play" aria-label="Abspielen">${icon('play')}</button>`}`

  if (!arbeitet) {
    // Die GANZE Kachel spielt ab — die Taste in der Mitte ist die Ansage dafür,
    // nicht das einzige Ziel. Nur die Griffe oben rechts machen etwas anderes.
    el.addEventListener('click', (e) => {
      const ziel = e.target as HTMLElement
      if (ziel.closest('[data-sicht]') || ziel.closest('[data-bearbeiten]')) return
      if (t.status === 'fehler') void oeffneEditorFuer(t.id)
      else spielAb(t.id)
    })
    el.querySelector('[data-sicht]')?.addEventListener('click', (e) => {
      e.stopPropagation()
      oeffneSichtMenue(el, t)
    })
    el.querySelector('[data-bearbeiten]')?.addEventListener('click', (e) => {
      e.stopPropagation()
      void oeffneEditorFuer(t.id)
    })
  }
  return el
}

function baueZeile(t: api.TourListe): HTMLElement {
  const el = document.createElement('div')
  el.className = 'zeile'
  const arbeitet = t.status !== 'bereit' && t.status !== 'fehler'
  el.innerHTML = `
    <div class="mini">${t.coverThumb ?? t.cover ? `<img src="${escape((t.coverThumb ?? t.cover) as string)}" alt="" loading="lazy" />` : icon('route')}</div>
    <div class="txt">
      <div class="t">${escape(t.title ?? '(ohne Titel)')}</div>
      <div class="m">${arbeitet ? 'entsteht gerade …' : escape(metaZeile(t))}</div>
    </div>
    <div class="rechts">
      ${
        arbeitet
          ? '<span class="sichtpille">entsteht</span>'
          : `<span class="sichtpille${t.visibility === 'public' ? ' oeffentlich' : ''}">${SICHT_NAMEN[t.visibility] ?? t.visibility}</span>
             ${t.status === 'bereit' ? `<button class="akt" data-spielen>${icon('play')}Abspielen</button>` : ''}
             <button class="akt" data-bearbeiten aria-label="Bearbeiten">${icon('stift')}</button>
             <button class="akt gefahr" data-loeschen aria-label="Tour löschen" title="Tour löschen">${icon('muell')}</button>`
      }
    </div>`
  el.querySelector('[data-spielen]')?.addEventListener('click', () => spielAb(t.id))
  el.querySelector('[data-bearbeiten]')?.addEventListener('click', () => void oeffneEditorFuer(t.id))
  el.querySelector<HTMLButtonElement>('[data-loeschen]')?.addEventListener('click', (e) => {
    void loescheZweistufig(e.currentTarget as HTMLButtonElement, t.id)
  })
  return el
}

/** Erster Klick schärft, zweiter löscht — statt eines confirm()-Dialogs. */
async function loescheZweistufig(knopf: HTMLButtonElement, id: string): Promise<void> {
  if (!knopf.dataset['scharf']) {
    knopf.dataset['scharf'] = '1'
    knopf.innerHTML = `${icon('muell')}Wirklich löschen?`
    setTimeout(() => {
      if (!knopf.isConnected || !knopf.dataset['scharf']) return
      delete knopf.dataset['scharf']
      knopf.innerHTML = icon('muell')
    }, 3500)
    return
  }
  knopf.disabled = true
  await api.loescheTour(id)
  await ladeListe()
}

/**
 * Abspielen im SELBEN Tab. Ein zweites Fenster wäre ein zweiter Ort, an dem
 * dieselbe Bibliothek offen steht; der Player führt oben links von selbst
 * dorthin zurück, wo man herkam (Referrer + history.back(), src/main.js).
 */
function spielAb(id: string): void {
  location.href = pfad('player', `?tour=srv:${id}`)
}

/** Tour-ID aus `?edit=` — Editor-Deep-Link. */
function editIdAusUrl(): string | null {
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
async function oeffneEditorFuer(id: string, opts: { geschichte?: boolean } = {}): Promise<void> {
  if (editorTourId === id) return
  // Anderer Editor offen → zuerst zu, sonst blieben Karte/State der alten Tour
  if (editorTourId) {
    const { schliesseEditor } = await import('./editor.js')
    schliesseEditor()
  }
  if (!opts.geschichte) history.pushState({ studio: 'edit', id }, '', studioUrl(id))
  else history.replaceState({ studio: 'edit', id }, '', studioUrl(id))

  els.appView.hidden = true
  editorTourId = id
  const { oeffneEditor } = await import('./editor.js')
  await oeffneEditor(id, () => {
    editorTourId = null
    els.appView.hidden = false
    // Schließen per Knopf (nicht per Zurück): URL bereinigen, ohne Extra-Eintrag.
    if (editIdAusUrl()) history.replaceState({ studio: 'liste' }, '', studioUrl(null))
    void ladeListe()
  })
}

// Browser-Zurück/Vor: URL ist die Quelle — Editor und Bibliothek folgen.
window.addEventListener('popstate', () => {
  const id = editIdAusUrl()
  if (id) {
    if (editorTourId !== id) void oeffneEditorFuer(id, { geschichte: true })
    return
  }
  if (editorTourId) {
    void import('./editor.js').then(({ schliesseEditor }) => schliesseEditor())
  }
})

// — Sichtbarkeit: Anzeige UND Umschalter an derselben Stelle —

let offenesSichtMenue: HTMLElement | null = null

function schliesseSichtMenue(): void {
  offenesSichtMenue?.remove()
  offenesSichtMenue = null
  document.querySelectorAll('.karte.menue-offen').forEach((k) => k.classList.remove('menue-offen'))
  document.querySelectorAll('[data-sicht][aria-expanded="true"]').forEach((k) => k.setAttribute('aria-expanded', 'false'))
}

function oeffneSichtMenue(karte: HTMLElement, t: api.TourListe): void {
  const schonOffen = karte.classList.contains('menue-offen')
  schliesseSichtMenue()
  if (schonOffen) return
  const menue = document.createElement('div')
  menue.className = 'sicht-menue'
  const stufe = (wert: string, titel: string, erklaerung: string): string => `
    <button data-wert="${wert}" role="menuitemradio" aria-checked="${String(t.visibility === wert)}">
      ${icon(SICHT_ICONS[wert] ?? 'schloss')}<span>${titel}<em>${erklaerung}</em></span>${icon('haken', 'haken')}
    </button>`
  menue.innerHTML = `
    <div class="kopfzeile">Wer darf mitfahren?</div>
    ${stufe('private', 'Privat', 'Nur du siehst diese Reise.')}
    ${stufe('unlisted', 'Per Link', 'Wer den Link hat, kann zusehen.')}
    ${stufe('public', 'Öffentlich', 'Steht in deinem Profil und der Galerie.')}
    ${t.visibility === 'private' ? '' : `<hr /><button data-link>${icon('link')}<span>Link kopieren</span></button>`}`
  menue.querySelectorAll<HTMLButtonElement>('[data-wert]').forEach((b) => {
    b.addEventListener('click', async (e) => {
      e.stopPropagation()
      const wert = b.dataset['wert'] as 'private' | 'unlisted' | 'public'
      schliesseSichtMenue()
      await api.patchTour(t.id, { visibility: wert })
      const eintrag = touren.find((x) => x.id === t.id)
      if (eintrag) eintrag.visibility = wert
      renderBibliothek()
    })
  })
  menue.querySelector('[data-link]')?.addEventListener('click', async (e) => {
    e.stopPropagation()
    schliesseSichtMenue()
    await navigator.clipboard?.writeText(`${location.origin}${pfad('player', `?tour=srv:${t.id}`)}`)
  })
  menue.addEventListener('click', (e) => e.stopPropagation())
  karte.appendChild(menue)
  karte.classList.add('menue-offen')
  karte.querySelector('[data-sicht]')?.setAttribute('aria-expanded', 'true')
  offenesSichtMenue = menue
}

document.addEventListener('click', () => schliesseSichtMenue())

// — Kopfzeile: Suche, Sortierung, Ansicht —

els.suche.addEventListener('input', () => {
  suchtext = els.suche.value
  renderBibliothek()
})
els.sortierung.addEventListener('change', () => {
  sortierung = els.sortierung.value as typeof sortierung
  renderBibliothek()
})
els.ansicht.querySelectorAll<HTMLButtonElement>('[data-ansicht]').forEach((b) => {
  b.addEventListener('click', () => {
    ansicht = b.dataset['ansicht'] as 'raster' | 'liste'
    localStorage.setItem('maptale.ansicht', ansicht)
    els.ansicht.querySelectorAll('[data-ansicht]').forEach((x) => {
      x.setAttribute('aria-pressed', String((x as HTMLElement).dataset['ansicht'] === ansicht))
    })
    renderBibliothek()
  })
  if (b.dataset['ansicht'] === ansicht) b.setAttribute('aria-pressed', 'true')
  else b.setAttribute('aria-pressed', 'false')
})
// „/" springt in die Suche — wie überall, wo man viel sucht
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !els.appView.hidden && !(e.target as HTMLElement).closest('input, textarea, select')) {
    e.preventDefault()
    els.suche.focus()
  }
})

function escape(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
}

// ————————————————— Neue Tour —————————————————
//
// Erst zeigen, was ankam, dann hochladen. Eine Aufnahme ohne Ortsangabe, eine,
// die Stunden neben der Aufzeichnung liegt — das will man VORHER wissen, nicht
// hinterher an einer Tour, die anders aussieht als erwartet.

let gpxDatei: File | null = null
let gpxText: string | null = null
let medienDateien: File[] = []
let befunde: AufnahmeBefund[] = []
let befund: Pruefbefund | null = null
let laeuftUpload = false
const vorschauUrls = new Map<string, string>()

// Kein Dateiauswahl-Dialog von selbst: das Fenster erklärt erst, was hier
// hineingehört (und dass Ziehen genügt). Zwei Dialoge übereinander verdecken
// diese Ansage, und wer nur schauen wollte, muss erst einen davon wegklicken.
function oeffneNeu(): void {
  els.neuHinter.hidden = false
  renderNeu()
}

function schliesseNeu(): void {
  if (laeuftUpload) return
  els.neuHinter.hidden = true
  leereAuswahl()
}

function leereAuswahl(): void {
  gpxDatei = null
  gpxText = null
  medienDateien = []
  befunde = []
  befund = null
  for (const url of vorschauUrls.values()) URL.revokeObjectURL(url)
  vorschauUrls.clear()
  setzeNeuStatus('')
}

function vorschauUrl(datei: File): string {
  const schluessel = `${datei.name}:${datei.size}:${datei.lastModified}`
  let url = vorschauUrls.get(schluessel)
  if (!url) {
    url = URL.createObjectURL(datei)
    vorschauUrls.set(schluessel, url)
  }
  return url
}

async function nimmDateienAn(liste: FileList | File[]): Promise<void> {
  const dateien = [...liste]
  // Der Zustand VOR dem Annehmen entscheidet über die Inszenierung: nur beim
  // ersten Ablegen gibt es das Lesen und das Wachsen des Fensters.
  const warLeer = !befunde.length && !gpxDatei
  if (warLeer) {
    els.neuHinter.hidden = false
    setzeFenstergroesse(true)
    const kandidaten = dateien.filter((d) => medientyp(d.name)).length
    if (kandidaten) zeigeLesen(0, kandidaten)
  }
  let ignoriert = 0
  const neueMedien: File[] = []
  for (const datei of dateien) {
    if (datei.name.toLowerCase().endsWith('.gpx')) {
      gpxDatei = datei
      gpxText = await datei.text()
    } else if (medientyp(datei.name)) {
      const doppelt = medienDateien.some(
        (m) => m.name === datei.name && m.size === datei.size && m.lastModified === datei.lastModified,
      )
      if (!doppelt) {
        medienDateien.push(datei)
        neueMedien.push(datei)
      }
    } else {
      ignoriert++
    }
  }
  els.neuHinter.hidden = false
  setzeNeuStatus(ignoriert ? `${ignoriert} Datei${ignoriert > 1 ? 'en' : ''} ignoriert (kein GPX, Foto oder Video).` : '')
  // EXIF nur für die NEUEN lesen — bei 50 Fotos ist das der Unterschied
  // zwischen „gleich da" und einer Kaffeepause je Nachschlag.
  let gelesen = 0
  for (const datei of neueMedien) {
    const typ = medientyp(datei.name)
    if (!typ) continue
    let zeitMs = datei.lastModified
    let zeitGeraten = true
    let ort: [number, number] | null = null
    if (typ === 'photo') {
      const exif = liesExif(await datei.arrayBuffer())
      if (exif.datum) {
        zeitMs = exifDatumZuMs(exif.datum, ZONE)
        zeitGeraten = false
      }
      if (exif.gps) ort = exif.gps
    }
    befunde.push({ datei: datei.name, typ, zeitMs, zeitGeraten, ort })
    if (warLeer) zeigeLesen(++gelesen, neueMedien.length)
  }
  renderNeu()
}

/**
 * Zwischenzustand beim ersten Ablegen: der Ring füllt sich, während die
 * EXIF-Blöcke gelesen werden. Wird FORTGESCHRIEBEN statt neu gebaut — sonst
 * fing die Ring-Animation bei jeder Datei von vorn an.
 */
function zeigeLesen(gelesen: number, gesamt: number): void {
  const U = 2 * Math.PI * 34 // Umfang des Rings (r = 34 im 78er-Viewport)
  let el = els.neuRumpf.querySelector<HTMLElement>('.neu-lesen')
  if (!el) {
    els.neuRumpf.classList.remove('wachst')
    els.neuRumpf.innerHTML = `
      <div class="neu-lesen" role="status" aria-live="polite">
        <div class="ring">
          <svg viewBox="0 0 78 78" aria-hidden="true">
            <circle class="bahn" cx="39" cy="39" r="34" />
            <circle class="voll" cx="39" cy="39" r="34"
              stroke-dasharray="${U.toFixed(1)}" stroke-dashoffset="${U.toFixed(1)}" />
          </svg>
          <span class="zahl"></span>
        </div>
        <h3>Liest die Aufnahmen</h3>
        <p>Aufnahmezeit und Ort stehen in den Dateien selbst — Maptale liest sie und ordnet alles ein.</p>
      </div>`
    el = els.neuRumpf.querySelector<HTMLElement>('.neu-lesen')
  }
  if (!el) return
  const anteil = gesamt ? gelesen / gesamt : 0
  el.querySelector<SVGCircleElement>('.voll')?.setAttribute('stroke-dashoffset', (U * (1 - anteil)).toFixed(1))
  const zahl = el.querySelector<HTMLElement>('.zahl')
  if (zahl) zahl.textContent = `${gelesen}/${gesamt}`
}

/**
 * Die Statuszeile im Leerzustand: dort gibt es keine Fußzeile, die sie tragen
 * könnte — „3 Dateien ignoriert" wäre sonst unsichtbar.
 */
function zeigeLeerHinweis(): void {
  const el = document.getElementById('neu-leer-hinweis')
  if (!el) return
  const text = els.neuStatus.textContent ?? ''
  el.textContent = text
  el.hidden = !text
  el.classList.toggle('fehler', els.neuStatus.classList.contains('fehler'))
}

function entferneAufnahmen(dateien: readonly string[]): void {
  const raus = new Set(dateien)
  medienDateien = medienDateien.filter((d) => !raus.has(d.name))
  befunde = befunde.filter((b) => !raus.has(b.datei))
  renderNeu()
}

function setzeNeuStatus(text: string, klasse = ''): void {
  els.neuStatus.className = `status ${klasse}`
  els.neuStatus.textContent = text
  zeigeLeerHinweis() // no-op, solange der Leerzustand nicht auf dem Schirm ist
}

const uhr = (ms: number): string =>
  new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })

function dauerText(ms: number): string {
  const minuten = Math.round(ms / 60000)
  const h = Math.floor(minuten / 60)
  return h ? `${h} h ${minuten % 60} min` : `${minuten} min`
}

function renderNeu(): void {
  befund = pruefe(gpxText, befunde)
  const anzahl = befunde.length
  els.neuUnter.textContent = anzahl
    ? `${anzahl} Aufnahme${anzahl > 1 ? 'n' : ''}${gpxDatei ? ` · ${gpxDatei.name}` : ''}`
    : ''
  els.neuBauen.disabled = !befund.bereit || laeuftUpload
  els.neuModusWrap.hidden = !befund.bereit
  // Der Fuß bleibt leer, solange nichts abgelegt ist: „Aufnahmen hinzufügen"
  // heißt NACHLEGEN (der Leerzustand sagt dasselbe größer und besser mit
  // „Dateien wählen"), und die Sichtbarkeit entscheidet über eine Tour, die es
  // noch nicht gibt. Beides kommt mit den ersten Dateien.
  const leerzustand = !befunde.length && !gpxDatei
  els.neuMehr.hidden = leerzustand
  els.neuSichtWrap.hidden = leerzustand
  els.neuRumpf.innerHTML = ''

  if (leerzustand) {
    setzeFenstergroesse(true)
    const leer = document.createElement('div')
    leer.className = 'neu-leer'
    // Vier leere Plätze über einem Tag-Nacht-Verlauf: die Form der Sache,
    // bevor es sie gibt.
    leer.innerHTML = `
      <div class="ahnung"><i></i><i></i><i></i><i></i><div class="achse"></div></div>
      <h3>Hier beginnt deine <em>nächste Tour</em></h3>
      <p>Aufzeichnung und Fotos hierher ziehen — Maptale liest die Zeitstempel und ordnet alles selbst ein.</p>
      <button class="knopf-primaer" id="neu-waehlen">${icon('upload')}Dateien wählen</button>
      <p class="nachsatz">Auch ohne Aufzeichnung: Bei reinen Fotos fliegt die Kamera von Ort zu Ort.</p>
      <p class="hinweis" id="neu-leer-hinweis" hidden></p>`
    els.neuRumpf.appendChild(leer)
    // Die ganze Fläche ist der Griff — „Dateien wählen" ist die Ansage dafür,
    // nicht das einzige Ziel. Der Knopf trägt die Semantik (Tastatur, Vorlese-
    // programme), deshalb bekommt die Fläche KEIN role="button": ein Knopf im
    // Knopf wäre für Hilfsmittel zwei Griffe für einen Weg. Der Klick auf den
    // Knopf steigt hierher auf — ein Aufruf, kein zweiter.
    leer.addEventListener('click', () => els.dateien.click())
    zeigeLeerHinweis()
    return
  }

  // Erst der Inhalt, dann das Wachsen: die Klasse `wachst` lässt den Befund
  // EINMAL mit dem Fenster aufsteigen (siehe setzeFenstergroesse).
  const raster = document.createElement('div')
  raster.className = 'neu-raster'
  raster.appendChild(baueVorschau(befund))
  raster.appendChild(baueDaten(befund))
  els.neuRumpf.appendChild(raster)
  if (befund.aufnahmen.length) els.neuRumpf.appendChild(baueZeitband(befund))
  setzeFenstergroesse(false)
}

/**
 * Größe des Fensters an den Zustand binden — klein für die Einladung, groß für
 * die Arbeitsfläche. Beim Wechsel ins Große steigt der Inhalt einmal mit auf;
 * bei jedem weiteren Neuzeichnen (Weglassen, Anker ändern) bleibt er ruhig.
 */
function setzeFenstergroesse(klein: boolean): void {
  const war = els.neuFenster.classList.contains('klein')
  els.neuFenster.classList.toggle('klein', klein)
  els.neuRumpf.classList.toggle('wachst', war && !klein)
}

/** Die Strecke als Form — eine Karte wäre gelogen, die Kartendaten holt erst der Player. */
function baueVorschau(b: Pruefbefund): HTMLElement {
  const el = document.createElement('div')
  el.className = 'vorschau'
  const punkte: Array<readonly [number, number]> =
    b.track?.punkte.map((p) => [p[0], p[1]] as const) ??
    b.aufnahmen.filter((a) => a.ort).map((a) => a.ort as [number, number])
  const proj = projiziereVorschau(punkte)
  if (!proj) {
    el.innerHTML = `<div class="quelle">noch keine Strecke</div>`
    return el
  }
  // Foto-Marken: mit Aufzeichnung am zeitlich nächsten Trackpunkt, ohne
  // Aufzeichnung sind die Fotos selbst die Punkte.
  const marken = b.aufnahmen
    .map((a, i) => {
      const index = b.track
        ? punktZuZeit(b.track.punkte, a.zeitMs)
        : b.aufnahmen.filter((x) => x.ort).findIndex((x) => x === a)
      const p = proj.bild[index]
      if (!p) return ''
      const ohneOrt = !a.ort && !b.track
      return `<circle class="marke${ohneOrt ? ' ohne-ort' : ''}" cx="${p[0]}" cy="${p[1]}" r="2.1"><title>Aufnahme ${i + 1}</title></circle>`
    })
    .join('')
  const anfang = proj.bild[0] as [number, number]
  const schluss = proj.bild[proj.bild.length - 1] as [number, number]
  el.innerHTML = `<svg viewBox="-6 -6 112 112" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <path class="linie${b.track ? '' : ' geraten'}" d="${escape(proj.d)}"/>
      ${marken}
      <circle class="anfang" cx="${anfang[0]}" cy="${anfang[1]}" r="2.6"/>
      <circle class="schluss" cx="${schluss[0]}" cy="${schluss[1]}" r="2.6"/>
    </svg>
    <div class="quelle">${b.track ? 'Aufgezeichnete Strecke' : 'Aus den Foto-Orten'}</div>`
  return el
}

function baueDaten(b: Pruefbefund): HTMLElement {
  const el = document.createElement('div')
  el.className = 'neu-daten'
  // Die Zahlen beschreiben die REISE, nicht die Zeitachse: die reicht bei einem
  // Ausreißer über Tage, die Tour selbst dauerte drei Stunden.
  const vonMs = b.track?.startMs ?? b.vonMs
  const bisMs = b.track?.endMs ?? b.bisMs
  const spanneMs = bisMs - vonMs
  const km = b.track?.km ?? 0
  const zahl = (symbol: string, kicker: string, wert: string): string =>
    `<div class="z"><div class="k">${icon(symbol)}${kicker}</div><div class="w">${escape(wert)}</div></div>`
  const tag = new Date(vonMs).toLocaleDateString('de-DE', { day: 'numeric', month: 'long' })
  el.innerHTML = `
    <h3 class="geschaetzt">${b.track ? 'Die Orte benennt Maptale beim Bauen' : 'Eine Tour aus deinen Fotos'}</h3>
    <div class="zahlen">
      ${zahl('route', 'Strecke', km ? `${String(km).replace('.', ',')} km` : '—')}
      ${zahl('uhr', 'Unterwegs', spanneMs > 0 ? dauerText(spanneMs) : '—')}
      ${zahl('kalender', b.track ? 'Aufgezeichnet' : 'Aufgenommen', spanneMs > 0 ? `${tag} · ${uhr(vonMs)}–${uhr(bisMs)}` : '—')}
      ${zahl('kamera', 'Kamerafahrt', b.bereit ? `≈ ${dauerText(schaetzeFahrtS(km, b.aufnahmen.length) * 1000)}` : '—')}
    </div>`
  const meldungen = document.createElement('div')
  meldungen.className = 'meldungen'
  for (const m of b.meldungen) {
    const zeile = document.createElement('div')
    zeile.className = `meldung ${m.ton}`
    zeile.innerHTML = `<span class="zeichen">${m.ton === 'warnung' ? '!' : '?'}</span><span>${escape(m.text)}</span>`
    // Nur wo es etwas zu entscheiden gibt, steht ein Knopf — und er benennt,
    // was er tut, statt „OK" zu sagen.
    if (m.ton === 'warnung' && m.dateien.length) {
      const knopf = document.createElement('button')
      knopf.type = 'button'
      knopf.textContent = m.dateien.length === 1 ? 'Weglassen' : 'Alle weglassen'
      knopf.addEventListener('click', () => entferneAufnahmen(m.dateien))
      zeile.appendChild(knopf)
    }
    meldungen.appendChild(zeile)
  }
  if (b.meldungen.length) el.appendChild(meldungen)
  return el
}

/** Jede Aufnahme an ihrer Uhrzeit — das Zeitband zeigt Lücken und Ausreißer. */
function baueZeitband(b: Pruefbefund): HTMLElement {
  const el = document.createElement('div')
  el.className = 'zeitband'
  const spanne = Math.max(1, b.bisMs - b.vonMs)
  const anteil = (ms: number): number => ((ms - b.vonMs) / spanne) * 100
  const kopf = document.createElement('div')
  kopf.className = 'kopf'
  kopf.textContent = `${b.aufnahmen.length} Aufnahme${b.aufnahmen.length > 1 ? 'n' : ''} an ihrer Uhrzeit`
  el.appendChild(kopf)

  const innen = document.createElement('div')
  innen.className = 'innen'
  el.appendChild(innen)
  const bahn = document.createElement('div')
  bahn.className = 'bahn'
  // Zu dicht beieinander liegende Aufnahmen zu einer Marke bündeln — sonst
  // überdecken sich bei 50 Fotos die Bilder gegenseitig.
  const gruppen: Array<{ anteil: number; items: AufnahmeBefund[] }> = []
  for (const a of b.aufnahmen) {
    const x = anteil(a.zeitMs)
    const letzte = gruppen[gruppen.length - 1]
    if (letzte && x - letzte.anteil < 3.6) letzte.items.push(a)
    else gruppen.push({ anteil: x, items: [a] })
  }
  for (const g of gruppen) {
    const erste = g.items[0] as AufnahmeBefund
    const datei = medienDateien.find((d) => d.name === erste.datei)
    const stiel = document.createElement('div')
    stiel.className = 'stiel'
    stiel.style.left = `${g.anteil.toFixed(2)}%`
    bahn.appendChild(stiel)
    const bild = document.createElement('div')
    bild.className = 'bild'
    bild.style.left = `${g.anteil.toFixed(2)}%`
    bild.style.bottom = '18px'
    if (!erste.ort) bild.classList.add('ohne-ort')
    if (b.track && (erste.zeitMs < b.track.startMs - 20 * 60000 || erste.zeitMs > b.track.endMs + 20 * 60000)) {
      bild.classList.add('ausserhalb')
    }
    if (erste.typ === 'photo' && datei) bild.style.backgroundImage = `url("${vorschauUrl(datei)}")`
    else bild.innerHTML = `<span class="film">${icon('film')}</span>`
    if (g.items.length > 1) {
      const zahl = document.createElement('span')
      zahl.className = 'zahl'
      zahl.textContent = String(g.items.length)
      bild.appendChild(zahl)
    }
    bild.title = g.items.map((i) => `${i.datei} · ${uhr(i.zeitMs)}`).join('\n')
    bahn.appendChild(bild)
  }
  innen.appendChild(bahn)

  const achse = document.createElement('div')
  achse.className = 'achse'
  if (b.track) {
    // Zeit ohne Aufzeichnung gestreift: dort lief nichts mit.
    const luecke = document.createElement('div')
    luecke.className = 'luecke'
    luecke.style.left = '0'
    luecke.style.right = '0'
    achse.appendChild(luecke)
    const spannenEl = document.createElement('div')
    spannenEl.className = 'spanne'
    spannenEl.style.left = `${anteil(b.track.startMs).toFixed(2)}%`
    spannenEl.style.width = `${(anteil(b.track.endMs) - anteil(b.track.startMs)).toFixed(2)}%`
    achse.appendChild(spannenEl)
  } else {
    const spannenEl = document.createElement('div')
    spannenEl.className = 'spanne'
    spannenEl.style.left = '0'
    spannenEl.style.right = '0'
    achse.appendChild(spannenEl)
  }
  innen.appendChild(achse)

  const stunden = document.createElement('div')
  stunden.className = 'stunden'
  const schrittH = Math.max(1, Math.ceil(spanne / 3600000 / 5))
  const erste = new Date(b.vonMs)
  erste.setMinutes(0, 0, 0)
  for (let t = erste.getTime(); t <= b.bisMs; t += schrittH * 3600000) {
    if (t < b.vonMs) continue
    const marke = document.createElement('span')
    marke.style.left = `${anteil(t).toFixed(2)}%`
    marke.textContent = uhr(t)
    stunden.appendChild(marke)
  }
  innen.appendChild(stunden)
  return el
}

// — Dateien annehmen: Fenster-Knopf, Kachel, Dateidialog, ganze Seite als Ablage —

els.dateien.addEventListener('change', () => {
  if (els.dateien.files?.length) void nimmDateienAn(els.dateien.files)
  els.dateien.value = ''
})
els.neuMehr.addEventListener('click', () => els.dateien.click())
els.neuOben.addEventListener('click', () => oeffneNeu())
els.neuSchliessen.addEventListener('click', () => schliesseNeu())
els.neuHinter.addEventListener('click', (e) => {
  if (e.target === els.neuHinter) schliesseNeu()
})
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !els.neuHinter.hidden) schliesseNeu()
})

let dropTiefe = 0
document.addEventListener('dragenter', (e) => {
  if (els.appView.hidden || !e.dataTransfer?.types.includes('Files')) return
  dropTiefe++
  els.dropOverlay.hidden = false
})
document.addEventListener('dragover', (e) => {
  if (!els.dropOverlay.hidden) e.preventDefault()
})
document.addEventListener('dragleave', () => {
  dropTiefe = Math.max(0, dropTiefe - 1)
  if (!dropTiefe) els.dropOverlay.hidden = true
})
document.addEventListener('drop', (e) => {
  if (els.appView.hidden) return
  e.preventDefault()
  dropTiefe = 0
  els.dropOverlay.hidden = true
  if (e.dataTransfer?.files.length) void nimmDateienAn(e.dataTransfer.files)
})

// — Bauen: Manifest → PUTs → Finalize —

async function warteAufBereit(id: string): Promise<'bereit' | 'fehler' | 'verarbeitung'> {
  for (let i = 0; i < 60; i++) {
    const t = await api.tour(id)
    if (t.schema === 'maptale/tour@1' || t.status === 'bereit') return 'bereit'
    if (t.status === 'fehler') return 'fehler'
    await new Promise((r) => setTimeout(r, 1000))
  }
  return 'verarbeitung'
}

els.neuBauen.addEventListener('click', async () => {
  if (!befund?.bereit || laeuftUpload) return
  if (uploadGesperrt) {
    setzeNeuStatus('Bitte zuerst die E-Mail-Adresse bestätigen.', 'fehler')
    return
  }
  laeuftUpload = true
  els.neuBauen.disabled = true
  const modus = els.neuModus.value
  const sicht = els.neuSicht.value as 'private' | 'unlisted' | 'public'
  const medienUpload = medienDateien.filter((d) => befunde.some((b) => b.datei === d.name))

  try {
    const medien = medienAusBefund(befund, (ms) => isoMitZone(ms, ZONE))
    const kennung = `studio:${(gpxDatei?.name ?? befund.aufnahmen[0]?.datei ?? 'tour').slice(0, 60)}:${befund.vonMs}`
    const manifest = baueUploadManifest({
      clientTourId: kennung,
      title: null,
      zeitspanne: { startMs: befund.vonMs, endMs: befund.bisMs },
      zone: ZONE,
      trackMode: modus,
      medien,
    })
    // Ohne Aufzeichnung sind die Foto-Orte die Strecke: das Manifest trägt dann
    // `segments` statt `trackFile` (beides erlaubt das Schema, genau eines).
    if (!befund.track) {
      const segmente = baueFotoSegmente(befund.aufnahmen, modus)
      if (!segmente.length) throw new Error('Zu wenige verortete Fotos für eine Strecke.')
      delete (manifest as { trackFile?: string }).trackFile
      ;(manifest as unknown as { segments: unknown }).segments = segmente
    }

    zeigeFortschritt(0, medienUpload.length + 2)
    const { id, wiederverwendet } = await api.legeTourAn(manifest)
    if (wiederverwendet) {
      const vorhanden = await api.tour(id)
      if (vorhanden.schema === 'maptale/tour@1' || vorhanden.status === 'bereit') {
        setzeNeuStatus('Diese Tour gibt es bereits.', 'fehler')
        return
      }
    }

    let getan = 0
    if (gpxText) {
      await api.ladeTrack(id, gpxText)
      zeigeFortschritt(++getan, medienUpload.length + 2)
    }
    for (const eintrag of medien) {
      const datei = medienUpload.find((d) => d.name === eintrag.file)
      if (!datei) continue
      await api.ladeMedium(id, eintrag.id, datei)
      zeigeFortschritt(++getan, medienUpload.length + 2)
    }
    if (sicht !== 'private') await api.patchTour(id, { visibility: sicht })

    setzeNeuStatus('Verarbeitung läuft …')
    await api.finalisiere(id)
    // Das Fenster darf jetzt zu: die Kachel in der Bibliothek zeigt weiter an,
    // dass die Tour entsteht — dafür muss niemand hier warten.
    laeuftUpload = false
    els.neuHinter.hidden = true
    els.neuFortschritt.hidden = true
    leereAuswahl()
    await ladeListe()
    const status = await warteAufBereit(id)
    if (status === 'fehler') {
      const t = await api.tour(id)
      hinweisToast(`Verarbeitung fehlgeschlagen: ${t.fehler ?? 'unbekannt'}`, true)
    }
    await ladeListe()
    zeigeSitzung(await api.me()) // Quota nachziehen
  } catch (fehler) {
    setzeNeuStatus((fehler as Error).message, 'fehler')
  } finally {
    laeuftUpload = false
    els.neuFortschritt.hidden = true
    els.neuBauen.disabled = !befund?.bereit
  }
})

function zeigeFortschritt(getan: number, gesamt: number): void {
  els.neuFortschritt.hidden = false
  els.neuFortschrittText.innerHTML = `<b>${getan}</b> von ${gesamt} übertragen`
}

// — Start —
fuelleTopNav(document.querySelector('#app-view .top-nav'), 'studio')
// Editor-Chunk parallel zu Auth vorladen, wenn der Deep-Link ihn sowieso braucht.
if (editIdAusUrl()) void import('./editor.js')
void pruefeAnmeldung()
