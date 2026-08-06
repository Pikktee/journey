/**
 * App-Topbar: Meine Touren · Entdecken.
 *
 * Eine Quelle für Studio, Entdecken und Profil — Icons, Link-Markup und das
 * Konto-Menü der öffentlichen Seiten. Sonst driftet der aktive Nav-Eintrag
 * (andere SVG-Pfade) und die rechte Seite (CTA vs. Chip) auseinander.
 */

import { pfad, profilPfad } from './routen.js'
import { merkeAngemeldet, vergesseAngemeldet } from './session-hinweis.js'

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

type Quota = { benutzt: number; limit: number }

type MeAntwort = {
  benutzer?: { name?: string; email?: string; rolle?: string }
  profil?: { anzeigename?: string; avatarUrl?: string; handle?: string | null }
  quota?: Quota
}

const ICON_PROFIL =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/></svg>'

const ICON_KONTO =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3.1"/><path d="M12 2.6l1.1 2.3 2.5-.5.4 2.5 2.3 1.1-1.4 2.1 1.4 2.1-2.3 1.1-.4 2.5-2.5-.5L12 21.4l-1.1-2.3-2.5.5-.4-2.5-2.3-1.1L7.1 13.8 5.7 11.7l2.3-1.1.4-2.5 2.5.5z"/></svg>'

const ICON_ADMIN =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 1 0 7.75"/></svg>'

function mb(b: number): string {
  return (b / (1024 * 1024)).toFixed(0)
}

function quotaHtml(quota: Quota | undefined): string {
  if (!quota || !(quota.limit > 0)) return ''
  const anteil = Math.min(100, (quota.benutzt / quota.limit) * 100)
  return `<div class="km-quota">
    <div class="km-quota-kopf"><span>Speicher</span><span>${mb(quota.benutzt)} / ${mb(quota.limit)} MB</span></div>
    <div class="km-balken"><span style="width:${anteil.toFixed(0)}%"${anteil > 90 ? ' class="voll"' : ''}></span></div>
  </div>`
}

/**
 * Rechte Seite der öffentlichen Topbar (Entdecken / Profil): Gast sieht
 * „Anmelden", Eingeloggte denselben Konto-Chip wie im Studio — ohne
 * „Neue Tour" (der bleibt Studio-only).
 */
export async function montiereNavRechts(container: HTMLElement | null): Promise<void> {
  if (!container) return
  try {
    const r = await fetch('/api/auth/me', { credentials: 'include' })
    const daten = (r.ok ? await r.json() : null) as MeAntwort | null
    if (!daten?.benutzer) {
      vergesseAngemeldet()
      return
    }
    merkeAngemeldet()

    const name = daten.profil?.anzeigename || daten.benutzer.name || 'Profil'
    const initial = (name.trim().charAt(0) || '?').toUpperCase()
    const avatar = daten.profil?.avatarUrl
    const mail = daten.benutzer.email || ''
    const avatarHtml = avatar
      ? `<img class="punkt" src="${avatar}" alt="" width="20" height="20" />`
      : `<span class="punkt">${initial}</span>`

    const adminLink = daten.benutzer.rolle === 'admin'
      ? `<a href="${pfad('verwaltung')}" class="km-eintrag">${ICON_ADMIN}Administration</a>`
      : ''

    // „Mein Profil" führt an die Adresse der Person (/@henrik), nicht auf
    // `/profil` — dort steht ohne Handle nichts, und die Adresse ist die, die
    // man auch teilt. Ohne Handle bleibt der Eintrag weg statt ins Leere zu
    // zeigen; ein Konto ohne Handle gibt es zwar nicht mehr (Migration 12),
    // aber ein toter Menüeintrag wäre der schlechtere Rückfall.
    const profilLink = daten.profil?.handle
      ? `<a href="${profilPfad(daten.profil.handle)}" class="km-eintrag">${ICON_PROFIL}Mein Profil</a>`
      : ''

    container.innerHTML = `
      <div class="konto-wrap">
        <button type="button" class="benutzer-chip" id="nav-profil" aria-haspopup="true" aria-expanded="false">
          ${avatarHtml}<span class="nav-profil-name"></span>
        </button>
        <div class="konto-menue" id="nav-konto-menue" hidden>
          ${mail ? '<div class="km-mail"></div>' : ''}
          ${quotaHtml(daten.quota)}
          <div class="km-trenner" role="separator"></div>
          ${profilLink}
          <a href="${pfad('konto')}" class="km-eintrag">${ICON_KONTO}Kontoeinstellungen</a>
          ${adminLink}
          <button type="button" class="km-eintrag" id="nav-abmelden">
            ${ICON_ABMELDEN}Abmelden
          </button>
        </div>
      </div>`

    const nameEl = container.querySelector('.nav-profil-name')
    if (nameEl) nameEl.textContent = name
    const mailEl = container.querySelector('.km-mail')
    if (mailEl) mailEl.textContent = mail

    const chip = container.querySelector('#nav-profil') as HTMLButtonElement | null
    const menue = container.querySelector('#nav-konto-menue') as HTMLElement | null
    if (!chip || !menue) return

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
  } catch {
    /* Gast bleibt bei „Anmelden" */
  }
}
