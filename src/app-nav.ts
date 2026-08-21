/**
 * App-Chrome: Kopf- und Fußzeile der Produkt-Seiten.
 *
 * Eine Quelle für Studio, Entdecken, Profil, Konto und Verwaltung — Markup
 * (`appHeaderHtml` / `appFooterHtml`), Icons, Aktiv-Zustand und Konto-Menü.
 * Sonst driftet Nav, CTA und die Rechtstext-Links auseinander.
 */

import { path, profilePath, requiresAccount } from './routes.js'
import {
  readProfileCache,
  rememberSignedIn,
  rememberProfileCache,
  forgetSignedIn,
} from './session-notice.js'
import { version as APP_VERSION } from '../package.json'
import { mountStageChip, stageChipHtml } from './release-stage.js'
import { feedbackButtonHtml, mountFeedbackButton } from './feedback-button.js'

export { APP_VERSION }

/**
 * Auf welcher Seite die Nav steht. 'profile', 'account' und 'admin' tauchen selbst
 * NICHT in der Nav auf — sie markieren nur, dass keiner der beiden Einträge
 * aktiv ist.
 */
export type AppNavPage = 'studio' | 'gallery' | 'profile' | 'account' | 'admin'

/** Wegpunkt-Route: aktive „Meine Touren"-Marke in der App-Nav. */
export const ICON_TOURS =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 17l4-10 4 6 3-4 5 8"/><circle cx="8" cy="7" r="1.4"/><circle cx="19" cy="17" r="1.4"/></svg>'

/** Globus: „Entdecken". */
export const ICON_DISCOVER =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c2.5 2.5 2.5 13 0 16-2.5-3-2.5-13.5 0-16z"/></svg>'

const ICON_LOGOUT =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>'

/** Mittelteil der Topbar — dieselben zwei Links auf jeder App-Seite. */
export function topNavHtml(active: AppNavPage): string {
  const toursClass = active === 'studio' ? ' class="active"' : ''
  const discoverClass = active === 'gallery' ? ' class="active"' : ''
  return (
    `<a href="${path('app')}"${toursClass}>${ICON_TOURS}Meine Touren</a>` +
    `<a href="${path('gallery')}"${discoverClass}>${ICON_DISCOVER}Entdecken</a>`
  )
}

export function fillTopNav(el: Element | null, active: AppNavPage): void {
  if (!el) return
  el.innerHTML = topNavHtml(active)
}

const ICON_PROFILE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/></svg>'

const ICON_ACCOUNT =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3.1"/><path d="M12 2.6l1.1 2.3 2.5-.5.4 2.5 2.3 1.1-1.4 2.1 1.4 2.1-2.3 1.1-.4 2.5-2.5-.5L12 21.4l-1.1-2.3-2.5.5-.4-2.5-2.3-1.1L7.1 13.8 5.7 11.7l2.3-1.1.4-2.5 2.5.5z"/></svg>'

const ICON_ADMIN =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 1 0 7.75"/></svg>'

/** Welche rechte Seite die Kopfleiste trägt. */
export type AppHeaderVariant = 'public' | 'studio' | 'admin'

/**
 * Die ganze Produkt-Kopfleiste — eine HTML-Quelle für Studio, Entdecken,
 * Profil, Konto und Verwaltung. Die Seiten tragen dasselbe Markup schon im
 * HTML (erster Paint / View Transition); `writeAppHeader` hält es deckungsgleich.
 */
export function appHeaderHtml(opts: { active: AppNavPage; variant?: AppHeaderVariant }): string {
  const variant = opts.variant ?? 'public'
  // Wortmarke und Stand-Chip stehen in einer eigenen Gruppe: Der Chip gehört
  // an die Marke, nicht in den Nav-Abstand dahinter (`--nav-brand-gap`).
  const brand =
    `<span class="brand-group">` +
    `<a href="/" class="brand" title="Zur Startseite">` +
    `<img src="/logo-mark.svg" alt="" height="28" />` +
    `<span>Maptale</span></a>` +
    stageChipHtml() +
    `</span>`
  const center = `<nav class="top-nav" aria-label="Hauptnavigation">${topNavHtml(opts.active)}</nav>`

  let right: string
  if (variant === 'studio') {
    right =
      `<div class="nav-right">` +
      `<button class="button-primary" id="new-top" hidden><svg><use href="#i-plus"/></svg>Neue Tour</button>` +
      `<div class="account-wrap">` +
      `<button class="user-chip" id="user-chip" hidden aria-haspopup="true" aria-expanded="false">` +
      `<span class="dot" id="user-initial"></span><span id="user-name"></span>` +
      `</button>` +
      `<div class="account-menu" id="account-menu" hidden>` +
      `<div class="am-mail" id="am-mail"></div>` +
      `<div class="am-quota">` +
      `<div class="am-quota-header"><span>Speicher</span><span id="am-quota-text"></span></div>` +
      `<div class="am-bar"><span id="am-bar-fill"></span></div>` +
      `</div>` +
      `<div class="am-divider" role="separator"></div>` +
      `<a class="am-item button" id="am-profile" href="/profil" hidden>${ICON_PROFILE}Mein Profil</a>` +
      `<a class="am-item button" id="am-account" href="${path('account')}">${ICON_ACCOUNT}Kontoeinstellungen</a>` +
      `<a class="am-item button" id="am-admin" href="${path('admin')}" hidden>${ICON_ADMIN}Administration</a>` +
      `<button type="button" class="am-item" id="logout">` +
      `<svg aria-hidden="true"><use href="#i-logout"/></svg>Abmelden</button>` +
      `</div></div></div>`
  } else if (variant === 'admin') {
    right = `<div class="nav-right" id="nav-right"></div>`
  } else {
    right =
      `<div class="nav-right" id="nav-right">` +
      `<a href="${path('app')}" class="nav-cta" data-guest>Anmelden</a>` +
      `<div class="account-wrap" data-signed-in>` +
      `<button type="button" class="user-chip" disabled aria-busy="true" aria-label="Profil wird geladen">` +
      `<span class="dot"></span><span class="nav-profile-name"></span>` +
      `</button></div></div>`
  }

  // Der Feedback-Knopf steht NEBEN `.nav-right`, nicht darin: `mountNavRight`
  // schreibt diesen Container per `innerHTML` neu, sobald `/auth/me` antwortet —
  // ein Knopf darin wäre nach dem ersten Konto-Abgleich spurlos verschwunden.
  return `${brand}${center}${feedbackButtonHtml()}${right}`
}

/** Schreibt die Kopfleiste in einen vorhandenen `.nav`-Mount (synchron). */
export function writeAppHeader(
  nav: Element | null,
  opts: { active: AppNavPage; variant?: AppHeaderVariant },
): void {
  if (!nav) return
  nav.innerHTML = `<div class="wrap">${appHeaderHtml(opts)}</div>`
  mountStageChip()
  mountFeedbackButton()
}

/**
 * Schlanke Produkt-Fußzeile (Marke + Version · Links). Standard: Impressum und
 * Datenschutz. Die Landing ergänzt Abschnittsanker; Rechtstext-Seiten haben
 * eigene Füße.
 */
export type AppFooterLink = { href: string; label: string }

export function appFooterHtml(opts?: { links?: AppFooterLink[]; ariaLabel?: string }): string {
  const links = opts?.links ?? [
    { href: path('imprint'), label: 'Impressum' },
    { href: path('privacy'), label: 'Datenschutz' },
  ]
  const aria = opts?.ariaLabel ?? 'Rechtliches'
  return (
    `<div class="wrap">` +
    `<span class="footer-brand">Maptale` +
    `<span class="footer-version">v${APP_VERSION}</span></span>` +
    `<nav class="footer-links" aria-label="${aria}">` +
    links
      .map((l) => `<a href="${l.href}">${l.label}</a>`)
      .join('<span class="footer-sep" aria-hidden="true">·</span>') +
    `</nav>` +
    `</div>`
  )
}

/** Schreibt die Fußzeile in einen vorhandenen `footer`-Mount (synchron). */
export function writeAppFooter(
  footer: Element | null,
  opts?: { links?: AppFooterLink[]; ariaLabel?: string },
): void {
  if (!footer) return
  footer.innerHTML = appFooterHtml(opts)
}

type Quota = { used: number; limit: number }

type MeResponse = {
  user?: { name?: string; email?: string; role?: string }
  profile?: { displayName?: string; avatarUrl?: string; handle?: string | null }
  quota?: Quota
}

function mb(b: number): string {
  return (b / (1024 * 1024)).toFixed(0)
}

function quotaHtml(quota: Quota | undefined): string {
  if (!quota || !(quota.limit > 0)) return ''
  const share = Math.min(100, (quota.used / quota.limit) * 100)
  return `<div class="am-quota">
    <div class="am-quota-header"><span>Speicher</span><span>${mb(quota.used)} / ${mb(quota.limit)} MB</span></div>
    <div class="am-bar"><span style="width:${share.toFixed(0)}%"${share > 90 ? ' class="full"' : ''}></span></div>
  </div>`
}

function applyProfileData(
  container: HTMLElement,
  data: { name: string; initial: string; avatarUrl?: string | null | undefined },
): void {
  const nameEl = container.querySelector('.nav-profile-name')
  if (nameEl && nameEl.textContent !== data.name) {
    nameEl.textContent = data.name
  }
  const chip = container.querySelector('.user-chip') as HTMLButtonElement | null
  if (chip) {
    chip.removeAttribute('disabled')
    chip.removeAttribute('aria-busy')
    chip.removeAttribute('aria-label')
  }

  const dot = container.querySelector('.user-chip .dot')
  if (dot) {
    if (data.avatarUrl) {
      if (dot instanceof HTMLImageElement) {
        if (dot.src !== data.avatarUrl) dot.src = data.avatarUrl
      } else {
        const img = document.createElement('img')
        img.className = 'dot'
        img.src = data.avatarUrl
        img.width = 20
        img.height = 20
        dot.replaceWith(img)
      }
    } else if (data.initial) {
      if (dot instanceof HTMLImageElement) {
        const span = document.createElement('span')
        span.className = 'dot'
        span.textContent = data.initial
        dot.replaceWith(span)
      } else {
        if (dot.textContent !== data.initial) dot.textContent = data.initial
      }
    }
  }
}

/**
 * Rechte Seite der öffentlichen Topbar (Entdecken / Profil): Gast sieht
 * „Anmelden", Eingeloggte denselben Konto-Chip wie im Studio — ohne
 * „Neue Tour" (der bleibt Studio-only).
 */
export async function mountNavRight(
  container: HTMLElement | null,
  /**
   * Knopf links neben dem Chip. Die Landing zeigt dort „Meine Touren" — sie hatte
   * deshalb lange eine EIGENE Kopie dieses Menüs im Inline-Skript, und in der
   * fehlten „Mein Profil" und „Kontoeinstellungen" schlicht. Ein Parameter ist
   * billiger als eine zweite Fassung, die niemand mitpflegt.
   */
  cta?: { text: string; href: string },
): Promise<void> {
  // Auch hier und nicht nur in `writeAppHeader`: Die Landing hat ihre eigene
  // Kopfleiste im HTML und montiert nur die rechte Seite nach.
  mountStageChip()
  mountFeedbackButton()
  if (!container) return

  // Versuche Profil vorab aus dem Cache zu setzen, damit kein Layout-Sprung entsteht
  const cache = readProfileCache()
  if (cache) {
    applyProfileData(container, cache)
  }

  try {
    const r = await fetch('/api/auth/me', { credentials: 'include' })
    const data = (r.ok ? await r.json() : null) as MeResponse | null
    if (!data?.user) {
      forgetSignedIn()
      return
    }
    rememberSignedIn()

    const name = data.profile?.displayName || data.user.name || 'Profil'
    const initial = (name.trim().charAt(0) || '?').toUpperCase()
    const avatar = data.profile?.avatarUrl
    const mail = data.user.email || ''

    rememberProfileCache({ name, initial, avatarUrl: avatar })
    applyProfileData(container, { name, initial, avatarUrl: avatar })

    const adminLink =
      data.user.role === 'admin'
        ? `<a href="${path('admin')}" class="am-item">${ICON_ADMIN}Administration</a>`
        : ''

    const profileLink = data.profile?.handle
      ? `<a href="${profilePath(data.profile.handle)}" class="am-item">${ICON_PROFILE}Mein Profil</a>`
      : ''

    let accountWrap = container.querySelector('.account-wrap') as HTMLElement | null
    if (!accountWrap) {
      const avatarHtml = avatar
        ? `<img class="dot" src="${avatar}" alt="" width="20" height="20" />`
        : `<span class="dot">${initial}</span>`
      container.innerHTML = `
        ${cta ? `<a href="${cta.href}" class="nav-cta nav-hide-sm" data-signed-in>${cta.text}</a>` : ''}
        <div class="account-wrap" data-signed-in>
          <button type="button" class="user-chip" id="nav-profile" aria-haspopup="true" aria-expanded="false">
            ${avatarHtml}<span class="nav-profile-name">${name}</span>
          </button>
          <div class="account-menu" id="nav-account-menu" hidden></div>
        </div>`
      accountWrap = container.querySelector('.account-wrap')
    }

    // Falls die .konto-wrap aus der HTML-Vorlage stammt, fehlt ihr das
    // Dropdown-Menü — es muss nachträglich eingefügt werden.
    if (accountWrap && !accountWrap.querySelector('.account-menu')) {
      const menuDiv = document.createElement('div')
      menuDiv.className = 'account-menu'
      menuDiv.id = 'nav-account-menu'
      menuDiv.hidden = true
      accountWrap.appendChild(menuDiv)
    }

    const menu = container.querySelector('#nav-account-menu, .account-menu') as HTMLElement | null
    if (menu) {
      menu.id = 'nav-account-menu'
      menu.innerHTML = `
        ${mail ? `<div class="am-mail">${mail}</div>` : ''}
        ${quotaHtml(data.quota)}
        <div class="am-divider" role="separator"></div>
        ${profileLink}
        <a href="${path('account')}" class="am-item">${ICON_ACCOUNT}Kontoeinstellungen</a>
        ${adminLink}
        <button type="button" class="am-item" id="nav-logout">
          ${ICON_LOGOUT}Abmelden
        </button>`
    }

    const chip = container.querySelector('.user-chip') as HTMLButtonElement | null
    if (chip && menu && !chip.dataset.listener) {
      chip.dataset.listener = 'true'
      chip.disabled = false
      chip.removeAttribute('aria-busy')
      chip.removeAttribute('aria-label')
      chip.id = 'nav-profile'
      chip.setAttribute('aria-haspopup', 'true')
      chip.setAttribute('aria-expanded', 'false')

      chip.addEventListener('click', (e) => {
        e.stopPropagation()
        const open = menu.hidden
        menu.hidden = !open
        chip.setAttribute('aria-expanded', String(open))
      })
      document.addEventListener('click', (e) => {
        if (!menu.hidden && !(e.target as Element | null)?.closest?.('.account-wrap')) {
          menu.hidden = true
          chip.setAttribute('aria-expanded', 'false')
        }
      })
      container.querySelector('#nav-logout')?.addEventListener('click', () => {
        forgetSignedIn()
        // Wer sich auf einer Seite abmeldet, die es ohne Konto nicht gibt, kann
        // dort nicht bleiben: Ein Neuladen brachte ihn auf derselben Adresse
        // wieder heraus, mit „Für die Kontoeinstellungen musst du angemeldet
        // sein" — die Zurückweisung einer Entscheidung, die er gerade selbst
        // getroffen hat. Überall sonst wird neu geladen und nicht umgeleitet:
        // Wer in einer Tour oder auf einem Profil abmeldet, will sie
        // weiterlesen, nur eben als Gast.
        const weiter = requiresAccount(location.pathname)
          ? () => location.assign(path('start'))
          : () => location.reload()
        fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).finally(weiter)
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
export async function mountAppHeader(
  nav: Element | null,
  opts: {
    active: AppNavPage
    variant?: AppHeaderVariant
    /** `null` = rechte Seite nicht antasten (Studio nach schreibeAppHeader). */
    right?: HTMLElement | null
    cta?: { text: string; href: string }
  },
): Promise<void> {
  if (!nav) return
  writeAppHeader(nav, {
    active: opts.active,
    ...(opts.variant !== undefined ? { variant: opts.variant } : {}),
  })
  if (opts.right === null || opts.variant === 'studio') return
  const right =
    opts.right ??
    (nav.querySelector('.nav-right') as HTMLElement | null) ??
    (nav.querySelector('#nav-right') as HTMLElement | null)
  await mountNavRight(right, opts.cta)
}
