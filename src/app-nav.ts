/**
 * App-Chrome: Kopf- und Fußzeile der Produkt-Seiten.
 *
 * Eine Quelle für Studio, Entdecken, Profil, Konto und Verwaltung — Markup
 * (`appHeaderHtml` / `appFooterHtml`), Icons, Aktiv-Zustand und Konto-Menü.
 * Sonst driftet Nav, CTA und die Rechtstext-Links auseinander.
 */

import { pfad, profilPfad } from './routen.js'
import {
  leseProfilCache,
  merkeAngemeldet,
  merkeProfilCache,
  vergesseAngemeldet,
} from './session-hinweis.js'
import { version as APP_VERSION } from '../package.json'
import { montiereStandChip, standChipHtml } from './entwicklungsstand.js'
import { feedbackKnopfHtml, montiereFeedbackKnopf } from './feedbackknopf.js'

export { APP_VERSION }

/**
 * Auf welcher Seite die Nav steht. 'profil', 'konto' und 'admin' tauchen selbst
 * NICHT in der Nav auf — sie markieren nur, dass keiner der beiden Einträge
 * aktiv ist.
 */
export type AppNavSeite = 'studio' | 'galerie' | 'profil' | 'konto' | 'admin'

/** Wegpunkt-Route: aktive „Meine Touren"-Marke in der App-Nav. */
export const ICON_TOUREN =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 17l4-10 4 6 3-4 5 8"/><circle cx="8" cy="7" r="1.4"/><circle cx="19" cy="17" r="1.4"/></svg>'

/** Globus: „Entdecken". */
export const ICON_ENTDECKEN =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c2.5 2.5 2.5 13 0 16-2.5-3-2.5-13.5 0-16z"/></svg>'

const ICON_ABMELDEN =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>'

/** Mittelteil der Topbar — dieselben zwei Links auf jeder App-Seite. */
export function topNavHtml(aktiv: AppNavSeite): string {
  const touren = aktiv === 'studio' ? ' class="aktiv"' : ''
  const entdecken = aktiv === 'galerie' ? ' class="aktiv"' : ''
  return (
    `<a href="${pfad('app')}"${touren}>${ICON_TOUREN}Meine Touren</a>` +
    `<a href="${pfad('galerie')}"${entdecken}>${ICON_ENTDECKEN}Entdecken</a>`
  )
}

export function fuelleTopNav(el: Element | null, aktiv: AppNavSeite): void {
  if (!el) return
  el.innerHTML = topNavHtml(aktiv)
}

const ICON_PROFIL =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/></svg>'

const ICON_KONTO =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3.1"/><path d="M12 2.6l1.1 2.3 2.5-.5.4 2.5 2.3 1.1-1.4 2.1 1.4 2.1-2.3 1.1-.4 2.5-2.5-.5L12 21.4l-1.1-2.3-2.5.5-.4-2.5-2.3-1.1L7.1 13.8 5.7 11.7l2.3-1.1.4-2.5 2.5.5z"/></svg>'

const ICON_ADMIN =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 1 0 7.75"/></svg>'

/** Welche rechte Seite die Kopfleiste trägt. */
export type AppHeaderVariante = 'oeffentlich' | 'studio' | 'admin'

/**
 * Die ganze Produkt-Kopfleiste — eine HTML-Quelle für Studio, Entdecken,
 * Profil, Konto und Verwaltung. Die Seiten tragen dasselbe Markup schon im
 * HTML (erster Paint / View Transition); `schreibeAppHeader` hält es deckungsgleich.
 */
export function appHeaderHtml(opts: { aktiv: AppNavSeite; variante?: AppHeaderVariante }): string {
  const variante = opts.variante ?? 'oeffentlich'
  // Wortmarke und Stand-Chip stehen in einer eigenen Gruppe: Der Chip gehört
  // an die Marke, nicht in den Nav-Abstand dahinter (`--nav-marken-gap`).
  const brand =
    `<span class="marken-gruppe">` +
    `<a href="/" class="brand" title="Zur Startseite">` +
    `<img src="/logo-mark.svg" alt="" height="28" />` +
    `<span>Maptale</span></a>` +
    standChipHtml() +
    `</span>`
  const mitte = `<nav class="top-nav" aria-label="Hauptnavigation">${topNavHtml(opts.aktiv)}</nav>`

  let rechts: string
  if (variante === 'studio') {
    rechts =
      `<div class="nav-right">` +
      `<button class="knopf-primaer" id="neu-oben" hidden><svg><use href="#i-plus"/></svg>Neue Tour</button>` +
      `<div class="konto-wrap">` +
      `<button class="benutzer-chip" id="benutzer-chip" hidden aria-haspopup="true" aria-expanded="false">` +
      `<span class="punkt" id="benutzer-initial"></span><span id="benutzer-name"></span>` +
      `</button>` +
      `<div class="konto-menue" id="konto-menue" hidden>` +
      `<div class="km-mail" id="km-mail"></div>` +
      `<div class="km-quota">` +
      `<div class="km-quota-kopf"><span>Speicher</span><span id="km-quota-text"></span></div>` +
      `<div class="km-balken"><span id="km-balken-fuell"></span></div>` +
      `</div>` +
      `<div class="km-trenner" role="separator"></div>` +
      `<a class="km-eintrag knopf" id="km-profil" href="/profil" hidden>${ICON_PROFIL}Mein Profil</a>` +
      `<a class="km-eintrag knopf" id="km-konto" href="${pfad('konto')}">${ICON_KONTO}Kontoeinstellungen</a>` +
      `<a class="km-eintrag knopf" id="km-verwaltung" href="${pfad('verwaltung')}" hidden>${ICON_ADMIN}Administration</a>` +
      `<button type="button" class="km-eintrag" id="abmelden">` +
      `<svg aria-hidden="true"><use href="#i-abmelden"/></svg>Abmelden</button>` +
      `</div></div></div>`
  } else if (variante === 'admin') {
    rechts = `<div class="nav-right" id="nav-rechts"></div>`
  } else {
    rechts =
      `<div class="nav-right" id="nav-right">` +
      `<a href="${pfad('app')}" class="nav-cta" data-gast>Anmelden</a>` +
      `<div class="konto-wrap" data-dabei>` +
      `<button type="button" class="benutzer-chip" disabled aria-busy="true" aria-label="Profil wird geladen">` +
      `<span class="punkt"></span><span class="nav-profil-name"></span>` +
      `</button></div></div>`
  }

  // Der Feedback-Knopf steht NEBEN `.nav-right`, nicht darin: `montiereNavRechts`
  // schreibt diesen Container per `innerHTML` neu, sobald `/auth/me` antwortet —
  // ein Knopf darin wäre nach dem ersten Konto-Abgleich spurlos verschwunden.
  return `${brand}${mitte}${feedbackKnopfHtml()}${rechts}`
}

/** Schreibt die Kopfleiste in einen vorhandenen `.nav`-Mount (synchron). */
export function schreibeAppHeader(
  nav: Element | null,
  opts: { aktiv: AppNavSeite; variante?: AppHeaderVariante },
): void {
  if (!nav) return
  nav.innerHTML = `<div class="wrap">${appHeaderHtml(opts)}</div>`
  montiereStandChip()
  montiereFeedbackKnopf()
}

/**
 * Schlanke Produkt-Fußzeile (Marke + Version · Links). Standard: Impressum und
 * Datenschutz. Die Landing ergänzt Abschnittsanker; Rechtstext-Seiten haben
 * eigene Füße.
 */
export type AppFooterLink = { href: string; label: string }

export function appFooterHtml(opts?: { links?: AppFooterLink[]; ariaLabel?: string }): string {
  const links = opts?.links ?? [
    { href: pfad('impressum'), label: 'Impressum' },
    { href: pfad('datenschutz'), label: 'Datenschutz' },
  ]
  const aria = opts?.ariaLabel ?? 'Rechtliches'
  return (
    `<div class="wrap">` +
    `<span class="fuss-marke">Maptale` +
    `<span class="fuss-version">v${APP_VERSION}</span></span>` +
    `<nav class="fuss-links" aria-label="${aria}">` +
    links
      .map((l) => `<a href="${l.href}">${l.label}</a>`)
      .join('<span class="fuss-sep" aria-hidden="true">·</span>') +
    `</nav>` +
    `</div>`
  )
}

/** Schreibt die Fußzeile in einen vorhandenen `footer`-Mount (synchron). */
export function schreibeAppFooter(
  footer: Element | null,
  opts?: { links?: AppFooterLink[]; ariaLabel?: string },
): void {
  if (!footer) return
  footer.innerHTML = appFooterHtml(opts)
}

type Quota = { used: number; limit: number }

type MeAntwort = {
  user?: { name?: string; email?: string; role?: string }
  profile?: { displayName?: string; avatarUrl?: string; handle?: string | null }
  quota?: Quota
}

function mb(b: number): string {
  return (b / (1024 * 1024)).toFixed(0)
}

function quotaHtml(quota: Quota | undefined): string {
  if (!quota || !(quota.limit > 0)) return ''
  const anteil = Math.min(100, (quota.used / quota.limit) * 100)
  return `<div class="km-quota">
    <div class="km-quota-kopf"><span>Speicher</span><span>${mb(quota.used)} / ${mb(quota.limit)} MB</span></div>
    <div class="km-balken"><span style="width:${anteil.toFixed(0)}%"${anteil > 90 ? ' class="voll"' : ''}></span></div>
  </div>`
}

function wendeProfilDatenAn(
  container: HTMLElement,
  daten: { name: string; initial: string; avatarUrl?: string | null | undefined },
): void {
  const nameEl = container.querySelector('.nav-profil-name')
  if (nameEl && nameEl.textContent !== daten.name) {
    nameEl.textContent = daten.name
  }
  const chip = container.querySelector('.benutzer-chip') as HTMLButtonElement | null
  if (chip) {
    chip.removeAttribute('disabled')
    chip.removeAttribute('aria-busy')
    chip.removeAttribute('aria-label')
  }

  const punkt = container.querySelector('.benutzer-chip .punkt')
  if (punkt) {
    if (daten.avatarUrl) {
      if (punkt instanceof HTMLImageElement) {
        if (punkt.src !== daten.avatarUrl) punkt.src = daten.avatarUrl
      } else {
        const img = document.createElement('img')
        img.className = 'punkt'
        img.src = daten.avatarUrl
        img.width = 20
        img.height = 20
        punkt.replaceWith(img)
      }
    } else if (daten.initial) {
      if (punkt instanceof HTMLImageElement) {
        const span = document.createElement('span')
        span.className = 'punkt'
        span.textContent = daten.initial
        punkt.replaceWith(span)
      } else {
        if (punkt.textContent !== daten.initial) punkt.textContent = daten.initial
      }
    }
  }
}

/**
 * Rechte Seite der öffentlichen Topbar (Entdecken / Profil): Gast sieht
 * „Anmelden", Eingeloggte denselben Konto-Chip wie im Studio — ohne
 * „Neue Tour" (der bleibt Studio-only).
 */
export async function montiereNavRechts(
  container: HTMLElement | null,
  /**
   * Knopf links neben dem Chip. Die Landing zeigt dort „Meine Touren" — sie hatte
   * deshalb lange eine EIGENE Kopie dieses Menüs im Inline-Skript, und in der
   * fehlten „Mein Profil" und „Kontoeinstellungen" schlicht. Ein Parameter ist
   * billiger als eine zweite Fassung, die niemand mitpflegt.
   */
  cta?: { text: string; href: string },
): Promise<void> {
  // Auch hier und nicht nur in `schreibeAppHeader`: Die Landing hat ihre eigene
  // Kopfleiste im HTML und montiert nur die rechte Seite nach.
  montiereStandChip()
  montiereFeedbackKnopf()
  if (!container) return

  // Versuche Profil vorab aus dem Cache zu setzen, damit kein Layout-Sprung entsteht
  const cache = leseProfilCache()
  if (cache) {
    wendeProfilDatenAn(container, cache)
  }

  try {
    const r = await fetch('/api/auth/me', { credentials: 'include' })
    const daten = (r.ok ? await r.json() : null) as MeAntwort | null
    if (!daten?.user) {
      vergesseAngemeldet()
      return
    }
    merkeAngemeldet()

    const name = daten.profile?.displayName || daten.user.name || 'Profil'
    const initial = (name.trim().charAt(0) || '?').toUpperCase()
    const avatar = daten.profile?.avatarUrl
    const mail = daten.user.email || ''

    merkeProfilCache({ name, initial, avatarUrl: avatar })
    wendeProfilDatenAn(container, { name, initial, avatarUrl: avatar })

    const adminLink =
      daten.user.role === 'admin'
        ? `<a href="${pfad('verwaltung')}" class="km-eintrag">${ICON_ADMIN}Administration</a>`
        : ''

    const profilLink = daten.profile?.handle
      ? `<a href="${profilPfad(daten.profile.handle)}" class="km-eintrag">${ICON_PROFIL}Mein Profil</a>`
      : ''

    let kontoWrap = container.querySelector('.konto-wrap') as HTMLElement | null
    if (!kontoWrap) {
      const avatarHtml = avatar
        ? `<img class="punkt" src="${avatar}" alt="" width="20" height="20" />`
        : `<span class="punkt">${initial}</span>`
      container.innerHTML = `
        ${cta ? `<a href="${cta.href}" class="nav-cta nav-hide-sm" data-dabei>${cta.text}</a>` : ''}
        <div class="konto-wrap" data-dabei>
          <button type="button" class="benutzer-chip" id="nav-profil" aria-haspopup="true" aria-expanded="false">
            ${avatarHtml}<span class="nav-profil-name">${name}</span>
          </button>
          <div class="konto-menue" id="nav-konto-menue" hidden></div>
        </div>`
      kontoWrap = container.querySelector('.konto-wrap')
    }

    // Falls die .konto-wrap aus der HTML-Vorlage stammt, fehlt ihr das
    // Dropdown-Menü — es muss nachträglich eingefügt werden.
    if (kontoWrap && !kontoWrap.querySelector('.konto-menue')) {
      const menueDiv = document.createElement('div')
      menueDiv.className = 'konto-menue'
      menueDiv.id = 'nav-konto-menue'
      menueDiv.hidden = true
      kontoWrap.appendChild(menueDiv)
    }

    const menue = container.querySelector('#nav-konto-menue, .konto-menue') as HTMLElement | null
    if (menue) {
      menue.id = 'nav-konto-menue'
      menue.innerHTML = `
        ${mail ? `<div class="km-mail">${mail}</div>` : ''}
        ${quotaHtml(daten.quota)}
        <div class="km-trenner" role="separator"></div>
        ${profilLink}
        <a href="${pfad('konto')}" class="km-eintrag">${ICON_KONTO}Kontoeinstellungen</a>
        ${adminLink}
        <button type="button" class="km-eintrag" id="nav-abmelden">
          ${ICON_ABMELDEN}Abmelden
        </button>`
    }

    const chip = container.querySelector('.benutzer-chip') as HTMLButtonElement | null
    if (chip && menue && !chip.dataset.listener) {
      chip.dataset.listener = 'true'
      chip.disabled = false
      chip.removeAttribute('aria-busy')
      chip.removeAttribute('aria-label')
      chip.id = 'nav-profil'
      chip.setAttribute('aria-haspopup', 'true')
      chip.setAttribute('aria-expanded', 'false')

      chip.addEventListener('click', (e) => {
        e.stopPropagation()
        const auf = menue.hidden
        menue.hidden = !auf
        chip.setAttribute('aria-expanded', String(auf))
      })
      document.addEventListener('click', (e) => {
        if (!menue.hidden && !(e.target as Element | null)?.closest?.('.konto-wrap')) {
          menue.hidden = true
          chip.setAttribute('aria-expanded', 'false')
        }
      })
      container.querySelector('#nav-abmelden')?.addEventListener('click', () => {
        vergesseAngemeldet()
        fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).finally(() =>
          location.reload(),
        )
      })
    }
  } catch {
    /* Gast bleibt bei „Anmelden" */
  }
}

/**
 * Gemeinsamer Einstieg für die Produkt-Kopfleiste: Markup schreiben, dann
 * rechts den Konto-Chip (bzw. Gast-CTA) montieren. Studio übergibt
 * `variante: 'studio'` und `rechts: null` (eigener Chip, Quota-Live-Updates).
 */
export async function montiereAppHeader(
  nav: Element | null,
  opts: {
    aktiv: AppNavSeite
    variante?: AppHeaderVariante
    /** `null` = rechte Seite nicht antasten (Studio nach schreibeAppHeader). */
    rechts?: HTMLElement | null
    cta?: { text: string; href: string }
  },
): Promise<void> {
  if (!nav) return
  schreibeAppHeader(nav, {
    aktiv: opts.aktiv,
    ...(opts.variante !== undefined ? { variante: opts.variante } : {}),
  })
  if (opts.rechts === null || opts.variante === 'studio') return
  const rechts =
    opts.rechts ??
    (nav.querySelector('.nav-right') as HTMLElement | null) ??
    (nav.querySelector('#nav-right') as HTMLElement | null)
  await montiereNavRechts(rechts, opts.cta)
}
