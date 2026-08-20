// Benutzerverwaltung — DOM und Ablaufsteuerung. Was gerechnet wird, liegt in
// adminmodell.ts (DOM-frei, getestet); hier steht nur, wie es aussieht und was
// auf einen Klick passiert.
//
// Kein Router: Sperrseite und Verwaltung liegen beide im DOM und werden per
// `hidden` umgeschaltet — dasselbe Muster wie im Studio. Innerhalb der
// Verwaltung gilt es ein zweites Mal: Die vier Bereiche sind Reiter, alle vier
// Panels liegen im DOM, sichtbar ist eins.

import { montiereAppHeader, schreibeAppFooter, type AppFooterLink } from '../app-nav.js'
import { pfad } from '../routen.js'
import { haengePasswortfeld } from '../passwortfeld.js'
import * as api from './api.js'
import {
  beschreibeAbsender,
  beschreibeEinladung,
  beschreibeProtokoll,
  beschreibeVorlage,
  beschreibeWartenden,
  einladenGesperrt,
  einladungsLink,
  filtereBenutzer,
  filtereEinladungen,
  filtereProtokoll,
  filtereRueckmeldungen,
  filtereWarteliste,
  formatiereBytes,
  formatiereDatum,
  formatiereZeitpunkt,
  initiale,
  kontextZeile,
  loeschenGesperrt,
  rolleGesperrt,
  RUECKMELDUNG_WORTE,
  tabAusHash,
  wartelisteAngeboten,
  zaehleAdmins,
  zaehleEinladungen,
  zaehleProtokoll,
  zaehleRueckmeldungen,
  zaehleWarteliste,
  TABS,
  type AdminBenutzer,
  type AdminEinladung,
  type AdminRueckmeldung,
  type AdminWartender,
  type RueckmeldungFilter,
  type RueckmeldungStatus,
  type EinladungsFilter,
  type KontenFilter,
  type MailBausteine,
  type MailVorlage,
  type ProtokollEintrag,
  type ProtokollFilter,
  type Rolle,
  type TabId,
  type WartelistenFilter,
  istLokal,
} from './adminmodell.js'

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

const els = {
  sperre: $('sperre-view'),
  sperreTitel: $('sperre-titel'),
  sperreText: $('sperre-text'),
  sperreWeg: $<HTMLAnchorElement>('sperre-weg'),
  admin: $('admin-view'),
  reiter: $('reiter'),
  // Konten
  kontenListe: $('konten-liste'),
  kontenFilter: $('konten-filter'),
  kontenSuche: $<HTMLInputElement>('konten-suche'),
  kontoNeu: $<HTMLButtonElement>('konto-neu'),
  // Einladungen
  pflichtSchalter: $<HTMLButtonElement>('pflicht-schalter'),
  pflichtText: $('pflicht-text'),
  zuWarnung: $('zu-warnung'),
  einladungenListe: $('einladungen-liste'),
  einladungenFilter: $('einladungen-filter'),
  einladungenSuche: $<HTMLInputElement>('einladungen-suche'),
  einladungNeu: $<HTMLButtonElement>('einladung-neu'),
  // Warteliste
  wlSchalter: $<HTMLButtonElement>('wl-schalter'),
  wlSchalterText: $('wl-schalter-text'),
  wlZurPflicht: $<HTMLButtonElement>('wl-zur-pflicht'),
  wartelisteListe: $('warteliste-liste'),
  wartelisteFilter: $('warteliste-filter'),
  wartelisteSuche: $<HTMLInputElement>('warteliste-suche'),
  // Rückmeldungen
  rueckmeldungenListe: $('rueckmeldungen-liste'),
  rueckmeldungenFilter: $('rueckmeldungen-filter'),
  rueckmeldungenSuche: $<HTMLInputElement>('rueckmeldungen-suche'),
  // Protokoll
  protokollZusammenfassung: $('protokoll-zusammenfassung'),
  protokollListe: $('protokoll-liste'),
  protokollFilter: $('protokoll-filter'),
  protokollSuche: $<HTMLInputElement>('protokoll-suche'),
  // Rückfrage
  frageDialog: $<HTMLDialogElement>('frage-dialog'),
  frageForm: $<HTMLFormElement>('frage-form'),
  fdTitel: $('fd-titel'),
  fdText: $('fd-text'),
  fdJa: $<HTMLButtonElement>('fd-ja'),
  fdNein: $<HTMLButtonElement>('fd-nein'),
  // Konto-Dialog
  kontoDialog: $<HTMLDialogElement>('konto-dialog'),
  kontoForm: $<HTMLFormElement>('konto-form'),
  kdTitel: $('kd-titel'),
  kdUnterzeile: $('kd-unterzeile'),
  kdName: $<HTMLInputElement>('kd-name'),
  kdEmail: $<HTMLInputElement>('kd-email'),
  kdPasswort: $<HTMLInputElement>('kd-passwort'),
  kdPwZusatz: $('kd-pw-zusatz'),
  kdRolle: $<HTMLSelectElement>('kd-rolle'),
  kdRolleHinweis: $('kd-rolle-hinweis'),
  kdVerifiziert: $<HTMLInputElement>('kd-verifiziert'),
  kdFehler: $('kd-fehler'),
  kdSpeichern: $<HTMLButtonElement>('kd-speichern'),
  kdAbbrechen: $<HTMLButtonElement>('kd-abbrechen'),
  // Einladungs-Dialog
  einladungDialog: $<HTMLDialogElement>('einladung-dialog'),
  einladungForm: $<HTMLFormElement>('einladung-form'),
  edNotiz: $<HTMLInputElement>('ed-notiz'),
  edGueltig: $<HTMLSelectElement>('ed-gueltig'),
  edFehler: $('ed-fehler'),
  edAbbrechen: $<HTMLButtonElement>('ed-abbrechen'),
  // System-Mails
  mailListe: $('mail-liste'),
  mailZusammenfassung: $('mail-zusammenfassung'),
  mailDialog: $<HTMLDialogElement>('mail-dialog'),
  mailForm: $<HTMLFormElement>('mail-form'),
  mdTitel: $('md-titel'),
  mdAnlass: $('md-anlass'),
  mdPlatzhalter: $('md-platzhalter'),
  mdBetreff: $<HTMLInputElement>('md-betreff'),
  mdMtitel: $<HTMLInputElement>('md-mtitel'),
  mdText: $<HTMLTextAreaElement>('md-text'),
  mdKnopf: $<HTMLInputElement>('md-knopf'),
  mdFuss: $<HTMLTextAreaElement>('md-fuss'),
  mdVbetreff: $('md-vbetreff'),
  mdVorschau: $<HTMLIFrameElement>('md-vorschau'),
  mdProbleme: $('md-probleme'),
  mdFehler: $('md-fehler'),
  mdStand: $('md-stand'),
  mdTest: $<HTMLButtonElement>('md-test'),
  mdZuruecksetzen: $<HTMLButtonElement>('md-zuruecksetzen'),
  mdAbbrechen: $<HTMLButtonElement>('md-abbrechen'),
  mdSpeichern: $<HTMLButtonElement>('md-speichern'),
}

interface Zustand {
  ichId: string
  tab: TabId
  /** Solange die vier Anfragen laufen, zeigen die Listen ein Skelett. */
  laedt: boolean
  /** Ist das Laden gescheitert, steht der Grund IN der Liste — samt zweitem Versuch. */
  fehler: string
  benutzer: AdminBenutzer[]
  invitations: AdminEinladung[]
  warteliste: AdminWartender[]
  mailvorlagen: MailVorlage[]
  invitationRequired: boolean
  waitlistOpen: boolean
  registrationOpen: boolean
  baseUrl: string
  kontenSuche: string
  kontenFilter: KontenFilter
  einladungenSuche: string
  einladungenFilter: EinladungsFilter
  wartelisteSuche: string
  wartelisteFilter: WartelistenFilter
  rueckmeldungen: AdminRueckmeldung[]
  rueckmeldungenSuche: string
  rueckmeldungenFilter: RueckmeldungFilter
  protokoll: ProtokollEintrag[]
  /** Meldungen, die eintrafen, während jemand liest — sie warten hinter dem Streifen. */
  protokollWartend: ProtokollEintrag[]
  protokollGestartet: string | null
  protokollSuche: string
  protokollFilter: ProtokollFilter
}

const z: Zustand = {
  ichId: '',
  tab: tabAusHash(location.hash),
  laedt: true,
  fehler: '',
  benutzer: [],
  invitations: [],
  warteliste: [],
  mailvorlagen: [],
  invitationRequired: true,
  waitlistOpen: true,
  registrationOpen: true,
  baseUrl: location.origin,
  kontenSuche: '',
  kontenFilter: 'alle',
  einladungenSuche: '',
  einladungenFilter: 'alle',
  wartelisteSuche: '',
  wartelisteFilter: 'alle',
  rueckmeldungen: [],
  rueckmeldungenSuche: '',
  rueckmeldungenFilter: 'alle',
  protokoll: [],
  protokollWartend: [],
  protokollGestartet: null,
  protokollSuche: '',
  protokollFilter: 'alle',
}

/** Welches Konto der Dialog gerade bearbeitet; null = ein neues anlegen. */
let bearbeitet: AdminBenutzer | null = null

// Auch ein vom Admin gesetztes Passwort wird bewertet — es schützt dasselbe
// Konto wie ein selbst gewähltes. Beim Bearbeiten darf das Feld leer bleiben
// („nicht ändern"), deshalb sperrt der Knopf nur bei tatsächlich schwacher Wahl.
const kdPasswortfeld = haengePasswortfeld(els.kdPasswort, {
  persoenlich: () => [els.kdName.value, els.kdEmail.value],
  beiAenderung: (befund) => {
    els.kdSpeichern.disabled = els.kdPasswort.value.length > 0 && !befund.reicht
  },
})

// — Rückmeldung —

const ICON_OK =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>'
const ICON_FEHLER =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>'

let flashEl: HTMLElement | null = null
let flashTimer = 0

/**
 * Eine Meldung zur Zeit, mittig unter der Kopfleiste (DESIGN.md).
 *
 * Ein Fehler steht länger als ein Erfolg: Bei „gespeichert" reicht der Blick,
 * bei „ging nicht" will man den Satz lesen.
 */
function flash(text: string, art: 'ok' | 'failed' = 'ok'): void {
  flashEl?.remove()
  const el = document.createElement('div')
  el.className = `flash ${art}`
  el.setAttribute('role', 'status')
  el.innerHTML = art === 'failed' ? ICON_FEHLER : ICON_OK
  const wort = document.createElement('span')
  wort.textContent = text
  el.append(wort)
  document.body.appendChild(el)
  flashEl = el
  requestAnimationFrame(() => el.classList.add('zeigt'))
  clearTimeout(flashTimer)
  flashTimer = window.setTimeout(
    () => {
      el.classList.remove('zeigt')
      window.setTimeout(() => el.remove(), 240)
    },
    art === 'failed' ? 7000 : 4200,
  )
}

const fehlerText = (fehler: unknown): string =>
  fehler instanceof Error ? fehler.message : 'Unbekannter Fehler'

/**
 * Rückfrage vor allem, was sich nicht zurücknehmen lässt.
 *
 * `window.confirm` sah aus wie ein Browser-Alarm, nannte oben die Domain und
 * gab dem gefährlichen Knopf dieselbe Gestalt wie dem harmlosen. Hier trägt
 * der Titel die Frage, der Text die Folge — und der bestätigende Knopf ist
 * rot, wenn etwas verloren geht.
 */
interface Rueckfrage {
  titel: string
  text: string
  ja?: string
  gefahr?: boolean
}

/**
 * Die offene Frage. Sie wird von den Knöpfen aufgelöst, NICHT vom
 * `close`-Ereignis des Dialogs: Das kam in der Abnahme nicht an, und ein
 * Versprechen, das an einem Ereignis hängt, das ausbleibt, hängt für immer —
 * der Löschen-Knopf tat dann schlicht nichts. `close`/`cancel` bleiben als
 * Auffangnetz für die Esc-Taste und den Rücken-Knopf.
 */
let frageAufloesen: ((ja: boolean) => void) | null = null

function beendeFrage(ja: boolean): void {
  const aufloesen = frageAufloesen
  frageAufloesen = null
  if (els.frageDialog.open) els.frageDialog.close()
  aufloesen?.(ja)
}

function frage(o: Rueckfrage): Promise<boolean> {
  // Eine zweite Frage über der ersten kann es nicht geben — käme sie doch,
  // gilt die alte als verneint, statt still liegen zu bleiben.
  frageAufloesen?.(false)
  els.fdTitel.textContent = o.titel
  els.fdText.textContent = o.text
  els.fdJa.textContent = o.ja ?? 'Bestätigen'
  els.fdJa.className = o.gefahr ? 'zerstoerend' : 'primaer'
  // Kein Fokus auf den bestätigenden Knopf: `showModal` fokussiert das erste
  // Element im Formular — „Abbrechen". Bei einer Löschung ist das die richtige
  // Vorbelegung für ein gedankenloses Enter.
  els.frageDialog.showModal()
  return new Promise((aufloesen) => {
    frageAufloesen = aufloesen
  })
}

els.frageForm.addEventListener('submit', (e) => {
  e.preventDefault()
  beendeFrage(true)
})
els.fdNein.addEventListener('click', () => beendeFrage(false))
for (const art of ['close', 'cancel']) {
  els.frageDialog.addEventListener(art, () => beendeFrage(false))
}

// — Laden —

async function lade(): Promise<void> {
  z.fehler = ''
  try {
    const [konten, einladungen, warteliste, rueckmeldungen, mails, protokoll, stats] =
      await Promise.all([
        api.benutzer(),
        api.einladungen(),
        api.warteliste(),
        api.rueckmeldungen(),
        api.mailvorlagen(),
        api.protokoll(),
        api.statistiken().catch(() => ({
          realtime: 0,
          today: { pageviews: 0, visitors: 0 },
          last7Days: { pageviews: 0, visitors: 0 },
          total: 0,
          referrer: [],
          pages: [],
        })),
      ])
    z.benutzer = konten.users
    z.invitations = einladungen.invitations
    z.invitationRequired = einladungen.invitationRequired
    z.registrationOpen = einladungen.registrationOpen
    z.baseUrl = einladungen.baseUrl || location.origin
    z.warteliste = warteliste.entries
    z.waitlistOpen = warteliste.waitlistOpen
    z.rueckmeldungen = rueckmeldungen.feedback
    z.protokoll = protokoll.entries
    z.protokollWartend = []
    z.protokollGestartet = protokoll.startedAt
    z.mailvorlagen = mails.templates
    rendereStatistiken(stats)
  } catch (fehler) {
    z.fehler = fehlerText(fehler)
    throw fehler
  } finally {
    z.laedt = false
    render()
  }
}

function rendereStatistiken(s: api.AdminStatistiken): void {
  const format = (n: number) => n.toLocaleString('de-DE')
  const echtzeit = $('stat-echtzeit')
  if (echtzeit) echtzeit.textContent = format(s.realtime)
  const heuteAufrufe = $('stat-heute-aufrufe')
  if (heuteAufrufe) heuteAufrufe.textContent = format(s.today.pageviews)
  const heuteBesucher = $('stat-heute-besucher')
  if (heuteBesucher) heuteBesucher.textContent = `${format(s.today.visitors)} Besucher`
  const tage7Aufrufe = $('stat-7d-aufrufe')
  if (tage7Aufrufe) tage7Aufrufe.textContent = format(s.last7Days.pageviews)
  const tage7Besucher = $('stat-7d-besucher')
  if (tage7Besucher) tage7Besucher.textContent = `${format(s.last7Days.visitors)} Besucher`
  const gesamt = $('stat-gesamt')
  if (gesamt) gesamt.textContent = format(s.total)

  const refListe = $('stat-referrer-liste')
  if (refListe) {
    if (!s.referrer.length) {
      refListe.innerHTML =
        '<div style="color: var(--text-3); font-size: 13px; padding: 6px 0;">Noch keine Daten erfasst.</div>'
    } else {
      refListe.innerHTML = s.referrer
        .map(
          (r) =>
            `<div class="stat-zeile"><span class="name">${r.quelle}</span><span class="anzahl">${format(r.count)}</span></div>`,
        )
        .join('')
    }
  }

  const seitenListe = $('stat-seiten-liste')
  if (seitenListe) {
    if (!s.pages.length) {
      seitenListe.innerHTML =
        '<div style="color: var(--text-3); font-size: 13px; padding: 6px 0;">Noch keine Daten erfasst.</div>'
    } else {
      seitenListe.innerHTML = s.pages
        .map(
          (p) =>
            `<div class="stat-zeile"><span class="name">${p.path}</span><span class="anzahl">${format(p.count)}</span></div>`,
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
function fussLinks(): { links: AppFooterLink[] } {
  const links: AppFooterLink[] = [
    { href: pfad('impressum'), label: 'Impressum' },
    { href: pfad('datenschutz'), label: 'Datenschutz' },
  ]
  if (istLokal(location.hostname)) links.push({ href: '/doku/', label: 'Doku (lokal)' })
  return { links }
}

async function start(): Promise<void> {
  await montiereAppHeader(document.getElementById('app-header'), {
    aktiv: 'admin',
    variante: 'admin',
  })
  schreibeAppFooter(document.getElementById('app-footer'), fussLinks())
  const sitzung = await api.me()
  if (!sitzung.user) {
    els.sperreTitel.textContent = 'Nicht angemeldet'
    els.sperreText.textContent = 'Melde dich an, um die Verwaltung zu öffnen.'
    els.sperreWeg.textContent = 'Zur Anmeldung'
    els.sperre.hidden = false
    return
  }
  if (sitzung.user.role !== 'admin') {
    els.sperre.hidden = false
    return
  }
  z.ichId = sitzung.user.id
  els.admin.hidden = false
  zeigeTab(z.tab)
  render()
  try {
    await lade()
  } catch (fehler) {
    flash(fehlerText(fehler), 'failed')
  }
}

// — Reiter —

/**
 * Was am Reiter steht. Die Zahl ist nicht überall dieselbe Sorte: Bei den
 * Konten sind es alle, bei Einladungen und Warteliste nur die, auf die man
 * handeln kann — sonst wäre der Zähler eine Statistik statt eines Hinweises.
 */
function reiterZahl(id: TabId): { wert: number; wichtig: boolean } {
  if (id === 'konten') return { wert: z.benutzer.length, wichtig: false }
  if (id === 'statistiken') return { wert: 0, wichtig: false }
  if (id === 'einladungen') return { wert: zaehleEinladungen(z.invitations).open, wichtig: false }
  if (id === 'warteliste') {
    const wartend = zaehleWarteliste(z.warteliste).pending
    return { wert: wartend, wichtig: wartend > 0 }
  }
  // Wie bei der Warteliste zählt nur, worauf man handeln kann: OFFENE
  // Meldungen. Eine erledigte an den Reiter zu schreiben hieße, dauerhaft eine
  // Zahl zu zeigen, die nie kleiner wird.
  if (id === 'rueckmeldungen') {
    const offen = zaehleRueckmeldungen(z.rueckmeldungen).open
    return { wert: offen, wichtig: offen > 0 }
  }
  // Beim Protokoll zählen die FEHLER, nicht alle Meldungen: Eine Warnung ist
  // Betrieb, ein Fehler ist etwas, das jemand ansehen sollte — und nur das
  // gehört als amberne Zahl an einen Reiter.
  if (id === 'protokoll') {
    const fehler = zaehleProtokoll([...z.protokoll, ...z.protokollWartend]).failed
    return { wert: fehler, wichtig: fehler > 0 }
  }
  return { wert: z.mailvorlagen.length, wichtig: false }
}

function rendereReiter(): void {
  els.reiter.replaceChildren(
    ...TABS.map((t) => {
      const aktiv = t.id === z.tab
      const button = document.createElement('button')
      button.type = 'button'
      button.id = `reiter-${t.id}`
      button.setAttribute('role', 'tab')
      button.setAttribute('aria-selected', String(aktiv))
      button.setAttribute('aria-controls', `panel-${t.id}`)
      // Rollender Tabindex: Aus der Leiste führt EIN Tabstopp heraus, zwischen
      // den Reitern bewegt man sich mit den Pfeiltasten (ARIA-Muster „tabs").
      button.tabIndex = aktiv ? 0 : -1
      const name = document.createElement('span')
      name.textContent = t.name
      button.append(name)
      if (!z.laedt) {
        const { wert, wichtig } = reiterZahl(t.id)
        const zahl = document.createElement('span')
        zahl.className = wichtig ? 'z wichtig' : 'z'
        zahl.textContent = String(wert)
        button.append(zahl)
        button.setAttribute('aria-label', `${t.name}, ${wert} ${t.zaehlt}`)
        button.title = `${wert} ${t.zaehlt}`
      }
      button.addEventListener('click', () => setzeTab(t.id))
      return button
    }),
  )
}

/** Nur die Sichtbarkeit umlegen — ohne die Adresszeile anzufassen. */
function zeigeTab(id: TabId): void {
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
function setzeTab(id: TabId, opt: { fokus?: boolean } = {}): void {
  z.tab = id
  zeigeTab(id)
  rendereReiter()
  const button = document.getElementById(`reiter-${id}`)
  // Am Telefon passen nicht alle vier in die Leiste. `block: 'nearest'` hält
  // die Seite dabei senkrecht in Ruhe — sonst spränge sie bei jedem Wechsel.
  button?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  if (opt.fokus) button?.focus()
  const anhang = `#${id}`
  if (location.hash !== anhang) history.replaceState(null, '', anhang)
}

els.reiter.addEventListener('keydown', (e) => {
  const jetzt = TABS.findIndex((t) => t.id === z.tab)
  let ziel = -1
  if (e.key === 'ArrowRight') ziel = (jetzt + 1) % TABS.length
  else if (e.key === 'ArrowLeft') ziel = (jetzt - 1 + TABS.length) % TABS.length
  else if (e.key === 'Home') ziel = 0
  else if (e.key === 'End') ziel = TABS.length - 1
  else return
  e.preventDefault()
  const tab = TABS[ziel]
  if (tab) setzeTab(tab.id, { fokus: true })
})

// Von Hand geänderter Anhang (oder ein Sprung aus dem Verlauf).
window.addEventListener('hashchange', () => {
  const id = tabAusHash(location.hash)
  if (id === z.tab) return
  z.tab = id
  zeigeTab(id)
  rendereReiter()
})

// — Bausteine der Listen —

interface Chip<T extends string> {
  wert: T
  name: string
  zahl: number
}

/**
 * Filter-Segmente. Die Zahlen zählen INNERHALB der laufenden Suche — dadurch
 * beantwortet die Leiste zwei Fragen auf einmal: wie viele passen, und wie sie
 * sich auf die Zustände verteilen.
 */
function rendereFilter<T extends string>(
  el: HTMLElement,
  chips: readonly Chip<T>[],
  aktiv: T,
  waehle: (wert: T) => void,
): void {
  el.replaceChildren(
    ...chips.map((c) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.setAttribute('aria-pressed', String(c.wert === aktiv))
      const name = document.createElement('span')
      name.textContent = c.name
      const zahl = document.createElement('span')
      zahl.className = 'z'
      zahl.textContent = String(c.zahl)
      button.append(name, zahl)
      // Aus dem Inhalt gelesen ergäbe der Name „Alle3" — zwei aneinander
      // stoßende Inline-Elemente bekommen keinen Zwischenraum.
      button.setAttribute('aria-label', `${c.name}, ${c.zahl}`)
      button.addEventListener('click', () => waehle(c.wert))
      return button
    }),
  )
}

function skelett(count: number): HTMLElement[] {
  return Array.from({ length: count }, () => {
    const zeile = document.createElement('div')
    zeile.className = 'skelett'
    zeile.append(document.createElement('span'), document.createElement('span'))
    return zeile
  })
}

function leerZustand(
  titel: string,
  text: string,
  aktion?: { name: string; tu: () => void },
): HTMLElement {
  const leer = document.createElement('div')
  leer.className = 'leer'
  const b = document.createElement('b')
  b.textContent = titel
  const p = document.createElement('p')
  p.textContent = text
  leer.append(b, p)
  if (aktion) {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = aktion.name
    button.addEventListener('click', aktion.tu)
    leer.append(button)
  }
  return leer
}

/**
 * Gemeinsamer Rahmen jeder Liste: Skelett beim Laden, Grund samt zweitem
 * Versuch beim Scheitern, sonst die Zeilen. Ohne das stünde nach einem
 * abgerissenen Netz überall „Noch keine Konten" — eine Behauptung, die keiner
 * geprüft hat.
 */
function fuelleListe(el: HTMLElement, zeilen: HTMLElement[], leer: () => HTMLElement): void {
  if (z.laedt) {
    el.replaceChildren(...skelett(4))
    return
  }
  if (z.fehler) {
    el.replaceChildren(
      leerZustand('Konnte nicht geladen werden', z.fehler, {
        name: 'Erneut versuchen',
        tu: () => {
          z.laedt = true
          render()
          void lade().catch((f) => flash(fehlerText(f), 'failed'))
        },
      }),
    )
    return
  }
  el.replaceChildren(...(zeilen.length ? zeilen : [leer()]))
}

/** Kopf einer Zeile: Punkt, fette Zeile mit Plaketten, graue Zeile darunter. */
function haupt(punkt: string | null): {
  wurzel: HTMLElement
  oben: HTMLElement
  text: HTMLElement
} {
  const wurzel = document.createElement('div')
  wurzel.className = 'haupt'
  if (punkt !== null) {
    const kreis = document.createElement('span')
    kreis.className = 'punkt-gross'
    kreis.setAttribute('aria-hidden', 'true')
    kreis.textContent = punkt
    wurzel.append(kreis)
  }
  const text = document.createElement('div')
  text.className = 'haupt-text'
  const oben = document.createElement('div')
  oben.className = 'oben'
  text.append(oben)
  wurzel.append(text)
  return { wurzel, oben, text }
}

function plakette(art: string, wort: string, erklaerung?: string): HTMLElement {
  const el = document.createElement('span')
  el.className = `badge ${art}`
  el.textContent = wort
  if (erklaerung) el.title = erklaerung
  return el
}

function kennzahl(wert: string, wort: string): HTMLElement {
  const el = document.createElement('div')
  el.className = 'kennzahl'
  const b = document.createElement('b')
  b.textContent = wert
  const span = document.createElement('span')
  span.textContent = wort
  el.append(b, span)
  return el
}

/**
 * Ein Griff am rechten Rand. `gesperrt` ist der GRUND, nicht ein Wahrheitswert:
 * Er landet im Tooltip UND im `aria-label`, denn ein `title` allein verdrängt
 * je nach Vorlese-Werkzeug das Wort „Löschen" — und ein gesperrter Knopf ohne
 * Begründung ist eine Sackgasse.
 */
function griff(
  wort: string,
  tu: () => void,
  opt: { gefahr?: boolean; gesperrt?: string } = {},
): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = opt.gefahr ? 'still gefahr' : 'still'
  button.textContent = wort
  if (opt.gesperrt) {
    button.disabled = true
    button.title = opt.gesperrt
    button.setAttribute('aria-label', `${wort}, ${opt.gesperrt}`)
  } else {
    button.addEventListener('click', tu)
  }
  return button
}

function griffe(...knoepfe: HTMLElement[]): HTMLElement {
  const el = document.createElement('div')
  el.className = 'griffe'
  el.append(...knoepfe)
  return el
}

// — Rendern —

function render(): void {
  rendereReiter()
  rendereRegistrierung()
  rendereKonten()
  rendereEinladungen()
  rendereWarteliste()
  rendereRueckmeldungen()
  rendereMailvorlagen()
  rendereProtokoll()
}

function rendereRegistrierung(): void {
  els.pflichtSchalter.setAttribute('aria-pressed', String(z.invitationRequired))
  els.pflichtText.textContent = z.invitationRequired
    ? 'Neue Konten entstehen nur über einen Einladungscode. Schalte es aus, damit sich jeder selbst anmelden kann.'
    : 'Jeder kann sich selbst anmelden. Die Bestätigungsmail bleibt Pflicht. Schalte es ein, um wieder nur Eingeladene hereinzulassen.'
  els.zuWarnung.hidden = z.registrationOpen

  els.wlSchalter.setAttribute('aria-pressed', String(z.waitlistOpen))
  // Der Schalter ist eingeschaltet und trotzdem wirkungslos, solange sich jeder
  // anmelden kann — das gehört dazugesagt, sonst sucht man den Eintrag
  // vergeblich vor der Tür. Und weil die Ursache im anderen Reiter liegt,
  // steht daneben der Weg dorthin.
  const wirkungslos =
    z.waitlistOpen && !wartelisteAngeboten(z.waitlistOpen, z.invitationRequired, z.registrationOpen)
  els.wlSchalterText.textContent = wirkungslos
    ? 'Angeschaltet, aber ohne Wirkung: Solange sich jeder selbst anmelden kann, braucht niemand eine Warteliste.'
    : z.waitlistOpen
      ? 'Wer keinen Code hat, kann seine Adresse hinterlassen und wird per Mail eingeladen.'
      : 'Ohne Code endet der Weg vor der Tür. Schalte es ein, um Adressen zu sammeln.'
  els.wlZurPflicht.hidden = !wirkungslos
}

function rendereKonten(): void {
  const gesucht = filtereBenutzer(z.benutzer, z.kontenSuche)
  // Die Sperr-Regeln zählen über ALLE Konten, nicht über die sichtbaren: Ein
  // Filter darf nicht darüber entscheiden, ob der letzte Admin löschbar wird.
  const admins = zaehleAdmins(z.benutzer)
  rendereFilter(
    els.kontenFilter,
    [
      { wert: 'alle', name: 'Alle', zahl: gesucht.length },
      {
        wert: 'admins',
        name: 'Administratoren',
        zahl: gesucht.filter((b) => b.role === 'admin').length,
      },
      {
        wert: 'unconfirmed',
        name: 'Unbestätigt',
        zahl: gesucht.filter((b) => !b.verified).length,
      },
    ] satisfies Chip<KontenFilter>[],
    z.kontenFilter,
    (wert) => {
      z.kontenFilter = wert
      rendereKonten()
    },
  )

  const sichtbar = filtereBenutzer(gesucht, '', z.kontenFilter)
  const zeilen = sichtbar.map((b) => {
    const zeile = document.createElement('div')
    zeile.className = 'zeile zeile-konto'

    const kopf = haupt(initiale(b.name || b.email))
    const name = document.createElement('span')
    name.className = 'name'
    name.textContent = b.name || b.email
    kopf.oben.append(name, plakette(b.role, b.role === 'admin' ? 'Administrator' : 'Nutzer'))
    if (b.fixed) {
      kopf.oben.append(
        plakette('user', 'Fest', 'Steht in der Konfiguration: Rolle und Konto sind unantastbar'),
      )
    }
    if (!b.verified) {
      kopf.oben.append(
        plakette(
          'unconfirmed',
          'Unbestätigt',
          'E-Mail noch nicht bestätigt. Hochladen ist gesperrt',
        ),
      )
    }
    const unten = document.createElement('div')
    unten.className = 'unten'
    unten.textContent = `${b.email} · seit ${formatiereDatum(b.createdAt)}`
    kopf.text.append(unten)

    zeile.append(
      kopf.wurzel,
      kennzahl(String(b.tours), b.tours === 1 ? 'Tour' : 'Touren'),
      kennzahl(formatiereBytes(b.storage), 'belegt'),
      griffe(
        griff('Bearbeiten', () => oeffneKonto(b)),
        griff('Löschen', () => void deleteAccount(b), {
          gefahr: true,
          gesperrt: loeschenGesperrt(b, z.ichId, admins),
        }),
      ),
    )
    return zeile
  })

  fuelleListe(els.kontenListe, zeilen, () =>
    z.benutzer.length
      ? leerZustand(
          'Kein Konto passt',
          'Weder Name noch E-Mail treffen die Suche, oder der Filter blendet sie aus.',
          {
            name: 'Suche und Filter zurücksetzen',
            tu: () => {
              z.kontenSuche = ''
              z.kontenFilter = 'alle'
              els.kontenSuche.value = ''
              rendereKonten()
            },
          },
        )
      : leerZustand(
          'Noch keine Konten',
          'Hier stehen alle, die sich angemeldet haben, samt Touren und belegtem Speicher.',
          {
            name: 'Konto anlegen',
            tu: () => oeffneKonto(null),
          },
        ),
  )
}

function rendereEinladungen(): void {
  const gesucht = filtereEinladungen(z.invitations, z.einladungenSuche)
  const zahl = zaehleEinladungen(gesucht)
  rendereFilter(
    els.einladungenFilter,
    [
      { wert: 'alle', name: 'Alle', zahl: gesucht.length },
      { wert: 'open', name: 'Offen', zahl: zahl.open },
      { wert: 'redeemed', name: 'Eingelöst', zahl: zahl.redeemed },
      { wert: 'expired', name: 'Abgelaufen', zahl: zahl.expired },
    ] satisfies Chip<EinladungsFilter>[],
    z.einladungenFilter,
    (wert) => {
      z.einladungenFilter = wert
      rendereEinladungen()
    },
  )

  const sichtbar = filtereEinladungen(gesucht, '', z.einladungenFilter)
  const zeilen = sichtbar.map((e) => {
    const zeile = document.createElement('div')
    zeile.className = 'zeile zeile-einladung'

    const kopf = haupt(null)
    const code = document.createElement('span')
    code.className = 'code'
    code.textContent = e.code
    kopf.oben.append(
      code,
      plakette(e.state, { open: 'Offen', redeemed: 'Eingelöst', expired: 'Abgelaufen' }[e.state]),
    )
    if (e.note) {
      const note = document.createElement('span')
      note.className = 'notiz'
      note.textContent = e.note
      note.title = e.note
      kopf.oben.append(note)
    }
    const unten = document.createElement('div')
    unten.className = 'unten'
    unten.textContent = beschreibeEinladung(e)
    kopf.text.append(unten)

    const knoepfe: HTMLElement[] = []
    if (e.state === 'open') knoepfe.push(griff('Link kopieren', () => void kopiereLink(e.code)))
    knoepfe.push(
      griff(e.state === 'open' ? 'Widerrufen' : 'Entfernen', () => void widerrufe(e), {
        gefahr: true,
      }),
    )

    zeile.append(
      kopf.wurzel,
      kennzahl(formatiereDatum(e.createdAt), 'erstellt'),
      griffe(...knoepfe),
    )
    return zeile
  })

  fuelleListe(els.einladungenListe, zeilen, () =>
    z.invitations.length
      ? leerZustand(
          'Keine passende Einladung',
          'Kein Code und keine Notiz trifft die Suche, oder der Filter blendet sie aus.',
          {
            name: 'Suche und Filter zurücksetzen',
            tu: () => {
              z.einladungenSuche = ''
              z.einladungenFilter = 'alle'
              els.einladungenSuche.value = ''
              rendereEinladungen()
            },
          },
        )
      : leerZustand(
          'Noch keine Einladung',
          'Wer eingeladen wird, bekommt einen Code und einen Link dazu, einmal einlösbar.',
          {
            name: 'Einladung erstellen',
            tu: () => oeffneEinladung(),
          },
        ),
  )
}

function rendereWarteliste(): void {
  const gesucht = filtereWarteliste(z.warteliste, z.wartelisteSuche)
  const zahl = zaehleWarteliste(gesucht)
  rendereFilter(
    els.wartelisteFilter,
    [
      { wert: 'alle', name: 'Alle', zahl: gesucht.length },
      { wert: 'pending', name: 'Wartet', zahl: zahl.pending },
      { wert: 'unconfirmed', name: 'Unbestätigt', zahl: zahl.unconfirmed },
      { wert: 'invited', name: 'Eingeladen', zahl: zahl.invited },
    ] satisfies Chip<WartelistenFilter>[],
    z.wartelisteFilter,
    (wert) => {
      z.wartelisteFilter = wert
      rendereWarteliste()
    },
  )

  const sichtbar = filtereWarteliste(gesucht, '', z.wartelisteFilter)
  const zeilen = sichtbar.map((e) => {
    const zeile = document.createElement('div')
    zeile.className = 'zeile zeile-warteliste'

    const kopf = haupt(initiale(e.email))
    const adresse = document.createElement('span')
    adresse.className = 'name'
    adresse.textContent = e.email
    kopf.oben.append(
      adresse,
      plakette(
        { unconfirmed: 'unbestaetigt', pending: 'offen', invited: 'eingeloest' }[e.state],
        { unconfirmed: 'Unbestätigt', pending: 'Wartet', invited: 'Eingeladen' }[e.state],
      ),
    )
    const unten = document.createElement('div')
    unten.className = 'unten'
    unten.textContent = beschreibeWartenden(e)
    kopf.text.append(unten)
    // Was jemand freiwillig geschrieben hat, ist das Kriterium fürs
    // Freischalten — eigene Zeile, nicht hinter zwei Daten gequetscht.
    if (e.note) {
      const zitat = document.createElement('div')
      zitat.className = 'zitat'
      zitat.textContent = `„${e.note}"`
      zitat.title = e.note
      kopf.text.append(zitat)
    }

    // Der Knopf bezieht sich auf sich selbst (er sperrt sich für die Dauer des
    // Versands) — die Pfeilfunktion läuft erst beim Klick, da steht er längst.
    const einladen: HTMLButtonElement = griff(
      'Einladen',
      () => void ladeEinAusWarteliste(e, einladen),
      { gesperrt: einladenGesperrt(e) },
    )

    zeile.append(
      kopf.wurzel,
      kennzahl(formatiereDatum(e.joinedAt), 'eingetragen'),
      griffe(
        einladen,
        griff('Entfernen', () => void entferneWartenden(e), { gefahr: true }),
      ),
    )
    return zeile
  })

  fuelleListe(els.wartelisteListe, zeilen, () =>
    z.warteliste.length
      ? leerZustand(
          'Kein passender Eintrag',
          'Weder Adresse noch Notiz trifft die Suche, oder der Filter blendet sie aus.',
          {
            name: 'Suche und Filter zurücksetzen',
            tu: () => {
              z.wartelisteSuche = ''
              z.wartelisteFilter = 'alle'
              els.wartelisteSuche.value = ''
              rendereWarteliste()
            },
          },
        )
      : leerZustand(
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
function rendereMailvorlagen(): void {
  if (z.laedt || z.fehler) {
    els.mailZusammenfassung.textContent = z.fehler || 'Wird geladen …'
    els.mailListe.replaceChildren()
    return
  }
  const angepasst = z.mailvorlagen.filter((v) => v.customized).length
  els.mailZusammenfassung.textContent = angepasst
    ? `${z.mailvorlagen.length} Vorlagen · ${angepasst} angepasst. Bearbeitbar sind die Worte; Layout und Logo stehen fest.`
    : `${z.mailvorlagen.length} Vorlagen im Auslieferungszustand. Bearbeitbar sind die Worte; Layout und Logo stehen fest.`

  els.mailListe.replaceChildren(
    ...z.mailvorlagen.map((v) => {
      const karte = document.createElement('div')
      karte.className = 'mail-karte'

      const oben = document.createElement('div')
      oben.className = 'oben'
      const name = document.createElement('span')
      name.className = 'name'
      name.textContent = v.name
      oben.append(
        name,
        plakette(v.customized ? 'angepasst' : 'standard', v.customized ? 'Angepasst' : 'Standard'),
      )

      const betreff = document.createElement('div')
      betreff.className = 'betreff'
      betreff.textContent = v.blocks.subject
      betreff.title = v.blocks.subject

      const unten = document.createElement('div')
      unten.className = 'unten'
      unten.textContent = beschreibeVorlage(v)

      const test = griff('Testmail', () => void schickeTestmail(v.key, undefined, test))
      karte.append(
        oben,
        betreff,
        unten,
        griffe(
          griff('Bearbeiten', () => oeffneMail(v)),
          test,
        ),
      )
      return karte
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
function rendereRueckmeldungen(): void {
  const gesucht = filtereRueckmeldungen(z.rueckmeldungen, z.rueckmeldungenSuche)
  const zahl = zaehleRueckmeldungen(gesucht)
  rendereFilter(
    els.rueckmeldungenFilter,
    [
      { wert: 'alle', name: 'Alle', zahl: gesucht.length },
      { wert: 'open', name: RUECKMELDUNG_WORTE.open, zahl: zahl.open },
      { wert: 'in_progress', name: RUECKMELDUNG_WORTE.in_progress, zahl: zahl.in_progress },
      { wert: 'done', name: RUECKMELDUNG_WORTE.done, zahl: zahl.done },
    ] satisfies Chip<RueckmeldungFilter>[],
    z.rueckmeldungenFilter,
    (wert) => {
      z.rueckmeldungenFilter = wert
      rendereRueckmeldungen()
    },
  )

  const sichtbar = filtereRueckmeldungen(gesucht, '', z.rueckmeldungenFilter)
  const zeilen = sichtbar.map((r) => {
    const zeile = document.createElement('div')
    zeile.className = 'zeile zeile-rueckmeldung'

    const kopf = haupt(initiale(r.benutzerName ?? r.email ?? '?'))
    const absender = document.createElement('span')
    absender.className = 'name'
    absender.textContent = beschreibeAbsender(r)
    kopf.oben.append(
      absender,
      plakette(
        { open: 'offen', in_progress: 'unbestaetigt', done: 'eingeloest' }[r.status],
        RUECKMELDUNG_WORTE[r.status],
      ),
    )
    if (r.quelle === 'app') kopf.oben.append(plakette('unconfirmed', 'App'))

    // Der Text steht ungekürzt: Er IST die Meldung. Eine Zeile mit „…" zwänge
    // dazu, jede einzelne aufzuklappen, um zu wissen, worum es überhaupt geht.
    const text = document.createElement('div')
    text.className = 'zitat'
    text.textContent = r.text
    kopf.text.append(text)

    const unten = document.createElement('div')
    unten.className = 'unten'
    unten.textContent = `${formatiereDatum(r.createdAt)} · ${kontextZeile(r)}`
    unten.title = kontextZeile(r)
    kopf.text.append(unten)

    if (r.note) {
      const note = document.createElement('div')
      note.className = 'unten'
      note.textContent = `Notiz: ${r.note}`
      kopf.text.append(note)
    }

    const wahl = document.createElement('select')
    wahl.className = 'still status-wahl'
    wahl.setAttribute('aria-label', `Status von ${beschreibeAbsender(r)}`)
    for (const [wert, wort] of Object.entries(RUECKMELDUNG_WORTE)) {
      const option = document.createElement('option')
      option.value = wert
      option.textContent = wort
      option.selected = wert === r.status
      wahl.append(option)
    }
    wahl.addEventListener('change', () => {
      void setzeRueckmeldungsStatus(r, wahl.value as RueckmeldungStatus, wahl)
    })

    zeile.append(
      kopf.wurzel,
      griffe(
        wahl,
        griff('Notiz', () => void notiereRueckmeldung(r)),
        griff('Löschen', () => void loescheRueckmeldung(r), { gefahr: true }),
      ),
    )
    return zeile
  })

  fuelleListe(els.rueckmeldungenListe, zeilen, () =>
    z.rueckmeldungen.length
      ? leerZustand(
          'Keine passende Rückmeldung',
          'Weder Text noch Absender trifft die Suche, oder der Filter blendet sie aus.',
          {
            name: 'Suche und Filter zurücksetzen',
            tu: () => {
              z.rueckmeldungenSuche = ''
              z.rueckmeldungenFilter = 'alle'
              els.rueckmeldungenSuche.value = ''
              rendereRueckmeldungen()
            },
          },
        )
      : leerZustand(
          'Noch nichts gemeldet',
          'Hier landet, was Besucher über den Alpha-Hinweis oder /feedback schreiben.',
        ),
  )
}

async function setzeRueckmeldungsStatus(
  r: AdminRueckmeldung,
  status: RueckmeldungStatus,
  wahl: HTMLSelectElement,
): Promise<void> {
  wahl.disabled = true
  try {
    const { rueckmeldung } = await api.aendereRueckmeldung(r.id, { status })
    Object.assign(r, rueckmeldung)
    flash(`Auf „${RUECKMELDUNG_WORTE[status]}" gesetzt.`)
  } catch (fehler) {
    // Zurück auf den alten Wert: Ein Auswahlfeld, das den nicht gespeicherten
    // Zustand zeigt, behauptet eine Änderung, die es nicht gibt.
    wahl.value = r.status
    flash(fehlerText(fehler), 'failed')
  } finally {
    wahl.disabled = false
    rendereReiter()
    rendereRueckmeldungen()
  }
}

async function notiereRueckmeldung(r: AdminRueckmeldung): Promise<void> {
  // Ein `prompt` und kein eigener Dialog: Es ist ein Feld, und die Notiz ist
  // eine Gedächtnisstütze für den Betreiber, kein Formular.
  const note = window.prompt('Interne Notiz zu dieser Rückmeldung', r.note ?? '')
  if (note === null) return
  try {
    const { rueckmeldung } = await api.aendereRueckmeldung(r.id, { note: note.trim() || null })
    Object.assign(r, rueckmeldung)
    flash('Notiz gespeichert.')
  } catch (fehler) {
    flash(fehlerText(fehler), 'failed')
  }
  rendereRueckmeldungen()
}

async function loescheRueckmeldung(r: AdminRueckmeldung): Promise<void> {
  const ja = await frage({
    titel: 'Rückmeldung löschen?',
    text: 'Der Text und alles daran ist danach weg. Erledigte verschwinden ohnehin nach einem halben Jahr von selbst.',
    ja: 'Löschen',
    gefahr: true,
  })
  if (!ja) return
  try {
    await api.loescheRueckmeldung(r.id)
    z.rueckmeldungen = z.rueckmeldungen.filter((x) => x.id !== r.id)
    flash('Rückmeldung gelöscht.')
  } catch (fehler) {
    flash(fehlerText(fehler), 'failed')
  }
  rendereReiter()
  rendereRueckmeldungen()
}

function rendereProtokoll(): void {
  const gesucht = filtereProtokoll(z.protokoll, z.protokollSuche)
  const zahl = zaehleProtokoll(gesucht)
  rendereFilter(
    els.protokollFilter,
    [
      { wert: 'alle', name: 'Alle', zahl: gesucht.length },
      { wert: 'failed', name: 'Fehler', zahl: zahl.failed },
      { wert: 'warning', name: 'Warnungen', zahl: zahl.warning },
    ] satisfies Chip<ProtokollFilter>[],
    z.protokollFilter,
    (wert) => {
      z.protokollFilter = wert
      rendereProtokoll()
    },
  )

  // Der Satz beschreibt den PUFFER, nicht die Liste — also zählt er auch, was
  // noch hinter dem Streifen wartet. Sonst widerspräche er dem Reiter (der aus
  // demselben Grund alles zählt), und zwei Zahlen für dieselbe Sache, die
  // nebeneinander stehen und nicht übereinstimmen, liest man als Fehler.
  const gesamt = [...z.protokollWartend, ...z.protokoll]
  els.protokollZusammenfassung.textContent = z.laedt
    ? 'Wird geladen …'
    : beschreibeProtokoll(gesamt.length, zaehleProtokoll(gesamt).failed, z.protokollGestartet)

  const sichtbar = filtereProtokoll(gesucht, '', z.protokollFilter)
  const gefiltert = !!z.protokollSuche.trim() || z.protokollFilter !== 'alle'
  fuelleListe(
    els.protokollListe,
    sichtbar.map((e) => {
      const zeile = document.createElement('div')
      zeile.className = 'zeile zeile-protokoll'

      const zeit = document.createElement('div')
      zeit.className = 'zeit'
      zeit.textContent = formatiereZeitpunkt(e.zeit)
      zeit.title = new Date(e.zeit).toLocaleString('de-DE')

      const meldung = document.createElement('div')
      meldung.className = 'meldung'
      const text = document.createElement('div')
      text.className = 'text'
      text.textContent = e.text
      meldung.append(text)
      if (e.detail) {
        const detail = document.createElement('div')
        detail.className = 'detail'
        detail.textContent = e.detail
        meldung.append(detail)
      }

      zeile.append(zeit, plakette(e.level, e.level === 'failed' ? 'Fehler' : 'Warnung'), meldung)
      return zeile
    }),
    () =>
      gefiltert
        ? leerZustand('Keine passende Meldung', 'Andere Suche oder anderer Filter.', {
            name: 'Filter zurücksetzen',
            tu: () => {
              z.protokollSuche = ''
              z.protokollFilter = 'alle'
              els.protokollSuche.value = ''
              rendereProtokoll()
            },
          })
        : leerZustand(
            'Nichts vorgefallen',
            'Seit dem Start der API gab es weder Warnung noch Fehler.',
          ),
  )

  // Was WÄHREND des Lesens eintraf, rutscht nicht von selbst in die Liste —
  // es wartet hinter einem Streifen, bis jemand ihn antippt.
  if (z.protokollWartend.length) {
    const count = z.protokollWartend.length
    const streifen = document.createElement('button')
    streifen.type = 'button'
    streifen.className = 'protokoll-neu'
    streifen.textContent = `${count} neue ${count === 1 ? 'Meldung' : 'Meldungen'} anzeigen`
    streifen.addEventListener('click', () => {
      z.protokoll = [...z.protokollWartend, ...z.protokoll]
      z.protokollWartend = []
      rendereProtokoll()
    })
    els.protokollListe.prepend(streifen)
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
async function holeNeueMeldungen(): Promise<void> {
  if (z.tab !== 'protokoll' || document.hidden || z.laedt || z.fehler) return
  const hoechste = Math.max(
    0,
    ...z.protokoll.map((e) => e.no),
    ...z.protokollWartend.map((e) => e.no),
  )
  try {
    const antwort = await api.protokoll(hoechste)
    if (antwort.startedAt !== z.protokollGestartet) {
      const frisch = await api.protokoll()
      z.protokoll = frisch.entries
      z.protokollWartend = []
      z.protokollGestartet = frisch.startedAt
    } else if (antwort.entries.length) {
      z.protokollWartend = [...antwort.entries, ...z.protokollWartend]
    } else {
      return
    }
    rendereProtokoll()
    rendereReiter()
  } catch {
    // Still: Ein Protokoll, das sich über sich selbst beschwert, ist Lärm.
    // Beim nächsten Reiterwechsel lädt `lade()` ohnehin neu.
  }
}

window.setInterval(() => void holeNeueMeldungen(), 5000)
// Wer den Tab wieder nach vorn holt, will den aktuellen Stand sehen und nicht
// bis zum nächsten Intervall warten.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) void holeNeueMeldungen()
})

// — Aktionen —

async function kopiereLink(code: string): Promise<void> {
  const link = einladungsLink(z.baseUrl, code)
  try {
    await navigator.clipboard.writeText(link)
    flash('Einladungslink kopiert')
  } catch {
    // Ohne Zwischenablage-Recht (unsicherer Kontext, alter Browser) bleibt der
    // Link wenigstens sichtbar und markierbar.
    window.prompt('Diesen Link weitergeben:', link)
  }
}

async function widerrufe(e: AdminEinladung): Promise<void> {
  const offen = e.state === 'open'
  const ja = await frage({
    titel: offen ? `Einladung ${e.code} widerrufen?` : `Einladung ${e.code} entfernen?`,
    text: offen
      ? 'Wer sie noch nicht eingelöst hat, kommt damit nicht mehr herein.'
      : 'Sie verschwindet aus der Liste und damit auch der Nachweis, wer über sie hereingekommen ist.',
    ja: offen ? 'Widerrufen' : 'Entfernen',
    gefahr: true,
  })
  if (!ja) return
  try {
    await api.widerrufe(e.code)
    await lade()
    flash('Einladung entfernt')
  } catch (fehler) {
    flash(fehlerText(fehler), 'failed')
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
async function ladeEinAusWarteliste(e: AdminWartender, button: HTMLButtonElement): Promise<void> {
  const ja = await frage({
    titel: `Einladung an ${e.email} schicken?`,
    text: 'Der Code geht sofort per Mail raus.',
    ja: 'Einladung schicken',
  })
  if (!ja) return
  button.disabled = true
  try {
    const { einladung } = await api.ladeWartendenEin(e.id)
    await lade()
    flash(`Einladung ${einladung.code} an ${e.email} verschickt`)
  } catch (fehler) {
    flash(fehlerText(fehler), 'failed')
    button.disabled = false
  }
}

async function entferneWartenden(e: AdminWartender): Promise<void> {
  const ja = await frage({
    titel: `${e.email} von der Warteliste entfernen?`,
    text: 'Die Adresse wird gelöscht. Eine noch offene Einladung an sie wird dabei widerrufen.',
    ja: 'Entfernen',
    gefahr: true,
  })
  if (!ja) return
  try {
    await api.loescheWartenden(e.id)
    await lade()
    flash('Von der Warteliste entfernt')
  } catch (fehler) {
    flash(fehlerText(fehler), 'failed')
  }
}

async function deleteAccount(b: AdminBenutzer): Promise<void> {
  const was =
    b.tours > 0
      ? `Damit gehen ${b.tours} ${b.tours === 1 ? 'Tour' : 'Touren'} samt Fotos verloren.`
      : 'Das Konto hat noch keine Touren.'
  const ja = await frage({
    titel: `Konto „${b.name || b.email}" endgültig löschen?`,
    text: `${was} Das lässt sich nicht rückgängig machen.`,
    ja: 'Endgültig löschen',
    gefahr: true,
  })
  if (!ja) return
  try {
    await api.loesche(b.id)
    await lade()
    flash('Konto gelöscht')
  } catch (fehler) {
    flash(fehlerText(fehler), 'failed')
  }
}

els.pflichtSchalter.addEventListener('click', async () => {
  const neu = !z.invitationRequired
  els.pflichtSchalter.disabled = true
  try {
    const antwort = await api.setzeEinstellungen({ invitationRequired: neu })
    z.invitationRequired = antwort.invitationRequired
    z.waitlistOpen = antwort.waitlistOpen
    rendereRegistrierung()
    flash(neu ? 'Registrierung nur noch mit Einladung' : 'Registrierung steht allen offen')
  } catch (fehler) {
    flash(fehlerText(fehler), 'failed')
  } finally {
    els.pflichtSchalter.disabled = false
  }
})

els.wlSchalter.addEventListener('click', async () => {
  const neu = !z.waitlistOpen
  els.wlSchalter.disabled = true
  try {
    const antwort = await api.setzeEinstellungen({ waitlistOpen: neu })
    z.invitationRequired = antwort.invitationRequired
    z.waitlistOpen = antwort.waitlistOpen
    rendereRegistrierung()
    flash(
      neu ? 'Die Warteliste steht wieder vor der Tür' : 'Die Warteliste wird nicht mehr angeboten',
    )
  } catch (fehler) {
    flash(fehlerText(fehler), 'failed')
  } finally {
    els.wlSchalter.disabled = false
  }
})

els.wlZurPflicht.addEventListener('click', () => setzeTab('einladungen', { fokus: true }))

els.kontenSuche.addEventListener('input', () => {
  z.kontenSuche = els.kontenSuche.value
  rendereKonten()
})
els.einladungenSuche.addEventListener('input', () => {
  z.einladungenSuche = els.einladungenSuche.value
  rendereEinladungen()
})
els.wartelisteSuche.addEventListener('input', () => {
  z.wartelisteSuche = els.wartelisteSuche.value
  rendereWarteliste()
})
els.rueckmeldungenSuche.addEventListener('input', () => {
  z.rueckmeldungenSuche = els.rueckmeldungenSuche.value
  rendereRueckmeldungen()
})
els.protokollSuche.addEventListener('input', () => {
  z.protokollSuche = els.protokollSuche.value
  rendereProtokoll()
})

// — Konto-Dialog —

function oeffneKonto(b: AdminBenutzer | null): void {
  bearbeitet = b
  els.kdFehler.textContent = ''
  els.kdTitel.textContent = b ? 'Konto bearbeiten' : 'Konto anlegen'
  els.kdUnterzeile.textContent = b
    ? 'Änderungen greifen sofort.'
    : 'Das Konto ist sofort nutzbar, ohne Bestätigungsmail.'
  els.kdName.value = b?.name ?? ''
  els.kdEmail.value = b?.email ?? ''
  // Über `leere()`, nicht über `value = ''`: sonst bliebe die Stärkeanzeige des
  // vorigen Aufrufs stehen und der Speichern-Knopf womöglich gesperrt.
  kdPasswortfeld.leere()
  els.kdPasswort.required = !b
  els.kdPwZusatz.textContent = b ? 'leer lassen, um es nicht zu ändern' : 'mindestens 8 Zeichen'
  els.kdRolle.value = b?.role ?? 'user'
  els.kdVerifiziert.checked = b ? b.verified : true
  els.kdSpeichern.textContent = b ? 'Speichern' : 'Anlegen'

  // Eine Rolle, die der Server ohnehin ablehnen würde, gar nicht erst anbieten.
  const gesperrt = b ? rolleGesperrt(b, z.ichId, zaehleAdmins(z.benutzer)) : ''
  els.kdRolle.disabled = !!gesperrt
  els.kdRolleHinweis.textContent = gesperrt
  els.kontoDialog.showModal()
  els.kdName.focus()
}

els.kontoNeu.addEventListener('click', () => oeffneKonto(null))
els.kdAbbrechen.addEventListener('click', () => els.kontoDialog.close())
els.edAbbrechen.addEventListener('click', () => els.einladungDialog.close())

els.kontoForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  els.kdFehler.textContent = ''
  const name = els.kdName.value.trim()
  const email = els.kdEmail.value.trim()
  const passwort = els.kdPasswort.value
  const rolle = els.kdRolle.value as Rolle
  const verifiziert = els.kdVerifiziert.checked
  els.kdSpeichern.disabled = true
  try {
    if (bearbeitet) {
      const felder: api.KontoFelder = { name, email, verified: verifiziert }
      // Die Rolle nur mitschicken, wenn sie überhaupt wählbar war — sonst
      // hinge an einem gesperrten Feld eine stille Änderung.
      if (!els.kdRolle.disabled) felder.role = rolle
      if (passwort) felder.password = passwort
      await api.aendere(bearbeitet.id, felder)
    } else {
      await api.legeAn({ name, email, password: passwort, role: rolle, verified: verifiziert })
    }
    els.kontoDialog.close()
    await lade()
    flash(bearbeitet ? 'Konto gespeichert' : 'Konto angelegt')
  } catch (fehler) {
    els.kdFehler.textContent = fehlerText(fehler)
  } finally {
    els.kdSpeichern.disabled = false
  }
})

// — Einladungs-Dialog —

function oeffneEinladung(): void {
  els.edFehler.textContent = ''
  els.edNotiz.value = ''
  els.einladungDialog.showModal()
  els.edNotiz.focus()
}

els.einladungNeu.addEventListener('click', oeffneEinladung)

els.einladungForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  els.edFehler.textContent = ''
  try {
    const { einladung } = await api.ladeEin(els.edNotiz.value.trim(), Number(els.edGueltig.value))
    els.einladungDialog.close()
    await lade()
    // Direkt in die Zwischenablage: Der Code ist genau dann nützlich, wenn er
    // beim Empfänger ankommt — ein Extra-Klick dazwischen ist nur Wartezeit.
    await kopiereLink(einladung.code)
  } catch (fehler) {
    els.edFehler.textContent = fehlerText(fehler)
  }
})

// — Mail-Dialog —
//
// Zwei Dinge halten ihn zusammen: Die Vorschau kommt vom SERVER (dasselbe
// Layout, das später verschickt wird — ein zweiter Renderer im Browser wäre
// genau die Kopie, die auseinanderläuft), und sie wird gebremst nachgezogen,
// nicht bei jedem Tastendruck.

let mailVorlage: MailVorlage | null = null
let vorschauTimer = 0
/** Zuletzt angefasstes Textfeld — dorthin fügen die Platzhalter-Chips ein. */
let letztesFeld: HTMLInputElement | HTMLTextAreaElement = els.mdText

const mailFelder = [els.mdBetreff, els.mdMtitel, els.mdText, els.mdKnopf, els.mdFuss]

const bausteineAusFeldern = (): MailBausteine => ({
  subject: els.mdBetreff.value,
  titel: els.mdMtitel.value,
  text: els.mdText.value,
  button: els.mdKnopf.value,
  footer: els.mdFuss.value,
})

function setzeMailStand(text: string, art: 'ok' | 'failed' = 'ok'): void {
  els.mdStand.textContent = text
  els.mdStand.classList.toggle('failed', art === 'failed')
}

function oeffneMail(v: MailVorlage): void {
  mailVorlage = v
  els.mdFehler.textContent = ''
  setzeMailStand('')
  els.mdTitel.textContent = v.name
  els.mdAnlass.textContent = v.occasion
  els.mdBetreff.value = v.blocks.subject
  els.mdMtitel.value = v.blocks.titel
  els.mdText.value = v.blocks.text
  els.mdKnopf.value = v.blocks.button
  els.mdFuss.value = v.blocks.footer
  els.mdZuruecksetzen.hidden = !v.customized
  letztesFeld = els.mdText

  // Die Chips tragen die Erklärung im `title`: Was `{{code}}` einsetzt, sieht
  // man am Namen nicht — und eine Legende darunter läse niemand.
  els.mdPlatzhalter.replaceChildren(
    ...v.placeholders.map((p) => {
      const chip = document.createElement('button')
      chip.type = 'button'
      chip.textContent = `{{${p.name}}}`
      chip.title = p.description
      chip.setAttribute('aria-label', `${p.name} einfügen, ${p.description}`)
      chip.addEventListener('click', () => fuegeEin(`{{${p.name}}}`))
      return chip
    }),
  )

  els.mailDialog.showModal()
  els.mdBetreff.focus()
  void zieheVorschau()
}

/** Platzhalter an der Einfügemarke des zuletzt benutzten Feldes einsetzen. */
function fuegeEin(text: string): void {
  const feld = letztesFeld
  const start = feld.selectionStart ?? feld.value.length
  const ende = feld.selectionEnd ?? feld.value.length
  feld.value = feld.value.slice(0, start) + text + feld.value.slice(ende)
  feld.focus()
  feld.setSelectionRange(start + text.length, start + text.length)
  planeVorschau()
}

function planeVorschau(): void {
  clearTimeout(vorschauTimer)
  vorschauTimer = window.setTimeout(() => void zieheVorschau(), 400)
}

async function zieheVorschau(): Promise<void> {
  if (!mailVorlage) return
  const key = mailVorlage.key
  try {
    const antwort = await api.vorschau(key, bausteineAusFeldern())
    // Zwischenzeitlich einen anderen Dialog geöffnet? Dann ist diese Antwort alt.
    if (mailVorlage?.key !== key) return
    els.mdVbetreff.textContent = antwort.subject || '–'
    els.mdVorschau.srcdoc = antwort.html
    els.mdProbleme.textContent = antwort.issues.join(' ')
    els.mdProbleme.hidden = antwort.issues.length === 0
    els.mdSpeichern.disabled = antwort.issues.length > 0
  } catch (fehler) {
    els.mdFehler.textContent = fehlerText(fehler)
  }
}

for (const feld of mailFelder) {
  feld.addEventListener('input', () => {
    setzeMailStand('')
    planeVorschau()
  })
  feld.addEventListener('focus', () => {
    letztesFeld = feld
  })
}

/**
 * Zumachen und aufräumen in einem Zug. Nicht nur am `close`-Ereignis hängend:
 * Das kam in der Abnahme nicht an — sonst bliebe die Vorlage gesetzt und eine
 * unterwegs befindliche Vorschau schriebe in einen geschlossenen Dialog.
 */
function schliesseMail(): void {
  mailVorlage = null
  clearTimeout(vorschauTimer)
  if (els.mailDialog.open) els.mailDialog.close()
}

els.mdAbbrechen.addEventListener('click', schliesseMail)
els.mailDialog.addEventListener('close', schliesseMail)

els.mailForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  if (!mailVorlage) return
  els.mdFehler.textContent = ''
  els.mdSpeichern.disabled = true
  try {
    await api.speichereVorlage(mailVorlage.key, bausteineAusFeldern())
    schliesseMail()
    await lade()
    flash('Mail-Text gespeichert')
  } catch (fehler) {
    els.mdFehler.textContent = fehlerText(fehler)
  } finally {
    els.mdSpeichern.disabled = false
  }
})

els.mdZuruecksetzen.addEventListener('click', async () => {
  if (!mailVorlage) return
  const v = mailVorlage
  // Die Rückfrage nennt den Grund: Nach dem Zurücksetzen hängt die Vorlage
  // wieder am Code — spätere Textverbesserungen kommen dann von allein mit.
  const ja = await frage({
    titel: `„${v.name}" auf den Auslieferungstext zurücksetzen?`,
    text: 'Deine Fassung geht dabei verloren. Dafür kommen spätere Textverbesserungen wieder von allein mit.',
    ja: 'Zurücksetzen',
    gefahr: true,
  })
  if (!ja) return
  try {
    await api.setzeVorlageZurueck(v.key)
    schliesseMail()
    await lade()
    flash('Auf den Standardtext zurückgesetzt')
  } catch (fehler) {
    els.mdFehler.textContent = fehlerText(fehler)
  }
})

els.mdTest.addEventListener('click', () => {
  if (!mailVorlage) return
  // Aus dem offenen Dialog geht die Fassung raus, die gerade in den Feldern
  // steht — sonst prüfte die Testmail den alten Stand.
  void schickeTestmail(mailVorlage.key, bausteineAusFeldern(), els.mdTest)
})

/**
 * Testmail an die eigene Adresse.
 *
 * Wo die Antwort erscheint, hängt daran, ob ein Dialog offen steht: Ein
 * modaler Dialog liegt im Top-Layer über allem, ein Toast dahinter läge unter
 * dessen Backdrop. Aus dem Dialog heraus meldet deshalb seine Fußzeile.
 */
async function schickeTestmail(
  key: string,
  blocks: MailBausteine | undefined,
  button: HTMLButtonElement,
): Promise<void> {
  const imDialog = els.mailDialog.open
  button.disabled = true
  if (imDialog) setzeMailStand('Wird verschickt …')
  try {
    const { an } = await api.testeVorlage(key, blocks)
    if (imDialog) setzeMailStand(`Testmail an ${an} verschickt`)
    else flash(`Testmail an ${an} verschickt`)
  } catch (fehler) {
    if (imDialog) setzeMailStand(fehlerText(fehler), 'failed')
    else flash(fehlerText(fehler), 'failed')
  } finally {
    button.disabled = false
  }
}

void start()
