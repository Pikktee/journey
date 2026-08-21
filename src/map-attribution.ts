/**
 * Pflicht-Attribution als ⓘ-Knopf mit Popup — MapLibre-Control, unten rechts.
 *
 * MapLibres eingebautes compact-Control ist eine Zeile Kleingedrucktes, die
 * beim Aufklappen als grauer Balken quer über die Bildecke läuft und sich nur
 * über denselben winzigen Knopf wieder schließen lässt. Hier ist derselbe
 * (rechtlich nötige) Inhalt eine Karte im Glas-Look des Players: pro Quelle
 * steht, WAS man ihr im Bild ansieht — Satellitenbild, Gelände, Routen —
 * und wem sie gehört. Klick auf den Knopf öffnet und schließt, ein Klick
 * irgendwo sonst und Escape schließen ebenfalls.
 *
 * Der Inhalt kommt NICHT aus einer zweiten, handgeführten Liste, sondern aus
 * den `attribution`-Feldern der Stil-Quellen (siehe map.ts). Eine neue
 * Kachelquelle erscheint damit von selbst — auch wenn niemand an diese Datei
 * denkt. Ohne Rollen-Eintrag heißt sie schlicht „Kartendaten"; ungenannt
 * bleibt sie nie.
 *
 * Das Element hängt am BODY, nicht als MapLibre-Control im Kartencontainer:
 * dessen z-index gilt nur innerhalb des Karten-Stacking-Contexts, und das
 * Popup verschwand dort hinter der Steuerleiste.
 */

import type { Map as MapLibreMap } from 'maplibre-gl'

export interface MapSource {
  /** Was man dieser Quelle im Bild ansieht („Satellitenbild", „Gelände") */
  role: string
  /** Rechtezeile. HTML erlaubt (Links) — die Texte stammen aus unserem Code. */
  html: string
}

/** Quellen-ID im Stil → was der Zuschauer davon sieht */
const ROLES: Record<string, string> = {
  satellite: 'Satellitenbild',
  dem: 'Gelände & Höhen',
}

/**
 * Baut die Liste für das Popup aus den Stil-Quellen (+ Quellen ohne Kachel,
 * etwa das Wetter-Archiv). Quellen ohne `attribution` fallen weg, Duplikate
 * derselben Rechtezeile werden zusammengefasst.
 */
export function collectSources(
  sources: Record<string, { attribution?: string | undefined } | undefined>,
  extra: readonly MapSource[] = [],
): MapSource[] {
  const out: MapSource[] = []
  const seen = new Set<string>()
  for (const [id, source] of Object.entries(sources)) {
    const html = source?.attribution?.trim()
    if (!html || seen.has(html)) continue
    seen.add(html)
    out.push({ role: ROLES[id] ?? 'Kartendaten', html })
  }
  for (const q of extra) {
    if (seen.has(q.html)) continue
    seen.add(q.html)
    out.push(q)
  }
  return out
}

/** HTML-Rechtezeile zu reinem Text (für eingebrannte Attribution im Export). */
export function htmlToText(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&copy;/g, '©')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Eine Zeile für den Einbrand: Rolle und Rechte, durch Punkte getrennt.
 * Dieselben Felder wie das Popup, ohne Markup.
 */
export function sourcesAsText(sources: readonly MapSource[]): string {
  return sources.map((q) => `${q.role}: ${htmlToText(q.html)}`).join(' · ')
}

/**
 * Einbrand ohne Rollen-Präfix: im Clip zählt der Rechteinhaber, nicht die
 * Zeilenüberschrift des Popups. Kürzer, dieselben Quellen.
 */
export function sourcesForBurnIn(sources: readonly MapSource[]): string {
  return sources.map((q) => htmlToText(q.html)).join(' · ')
}

const ICON =
  '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" ' +
  'stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
  '<circle cx="12" cy="12" r="9.2"/><path d="M12 11.1v5.3"/><path d="M12 7.7h.01"/></svg>'

export function createMapAttribution(
  map: MapLibreMap,
  extra: readonly MapSource[] = [],
): { remove(): void } {
  let open = false
  let closeTimer = 0

  const el = document.createElement('div')
  el.className = 'map-attribution'

  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'map-attribution-button'
  button.title = 'Kartendaten & Quellen'
  button.setAttribute('aria-label', 'Kartendaten und Quellen')
  button.setAttribute('aria-expanded', 'false')
  button.setAttribute('aria-controls', 'map-attribution-popup')
  button.innerHTML = ICON

  const popup = document.createElement('div')
  popup.className = 'map-attribution-popup'
  popup.id = 'map-attribution-popup'
  popup.hidden = true

  el.append(popup, button)

  const buildContent = () => {
    if (popup.dataset.filled) return
    // getStyle() wirft, solange der Stil noch nicht geladen ist — der Inhalt
    // wird beim ersten Öffnen gebaut, dann ist er längst da.
    let styleSources: Record<string, { attribution?: string }> = {}
    try {
      styleSources = (map.getStyle()?.sources ?? {}) as Record<string, { attribution?: string }>
    } catch {
      /* Stil noch nicht bereit: dann zeigen wir nur die Extra-Quellen */
    }
    const sources = collectSources(styleSources, extra)
    popup.innerHTML =
      '<p class="attribution-title">Kartendaten</p>' +
      sources
        .map(
          (q) =>
            `<div class="attribution-row"><span class="attribution-role">${q.role}</span>` +
            `<span class="attribution-source">${q.html}</span></div>`,
        )
        .join('')
    // Links verlassen den Player immer in einem neuen Tab: ein Wegnavigieren
    // mitten in der Fahrt wäre der teuerste mögliche Klick.
    for (const a of popup.querySelectorAll('a')) {
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
    }
    popup.dataset.filled = '1'
  }

  const setOpen = (on: boolean) => {
    if (on === open) return
    open = on
    button.setAttribute('aria-expanded', String(on))
    // Solange die Quellen offen sind, zieht sich die UI nicht zurück (main.ts) —
    // sonst blendete der Text weg, während man ihn liest.
    document.body.classList.toggle('attribution-open', on)
    clearTimeout(closeTimer)
    if (on) {
      buildContent()
      popup.hidden = false
      // Ein Frame Abstand: direkt aus display:none heraus überspringt der
      // Browser die Transition und das Popup erschiene ohne Bewegung.
      requestAnimationFrame(() => {
        if (open) popup.classList.add('open')
      })
    } else {
      popup.classList.remove('open')
      closeTimer = window.setTimeout(() => {
        if (!open) popup.hidden = true
      }, 220)
    }
  }

  const onButton = (e: MouseEvent) => {
    e.stopPropagation()
    setOpen(!open)
  }
  // Klick im Popup (etwa auf einen Link) darf nicht als „woanders" gelten
  const onPopup = (e: MouseEvent) => e.stopPropagation()
  const onDocument = (e: Event) => {
    if (open && !el.contains(e.target as Node)) setOpen(false)
  }
  const onKey = (e: KeyboardEvent) => {
    if (open && e.key === 'Escape') {
      setOpen(false)
      button.focus()
    }
  }

  button.addEventListener('click', onButton)
  popup.addEventListener('click', onPopup)
  document.addEventListener('pointerdown', onDocument)
  document.addEventListener('keydown', onKey)
  document.body.appendChild(el)

  return {
    remove() {
      button.removeEventListener('click', onButton)
      popup.removeEventListener('click', onPopup)
      document.removeEventListener('pointerdown', onDocument)
      document.removeEventListener('keydown', onKey)
      clearTimeout(closeTimer)
      document.body.classList.remove('attribution-open')
      el.remove()
    },
  }
}
