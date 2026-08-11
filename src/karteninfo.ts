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
 * den `attribution`-Feldern der Stil-Quellen (siehe map.js). Eine neue
 * Kachelquelle erscheint damit von selbst — auch wenn niemand an diese Datei
 * denkt. Ohne Rollen-Eintrag heißt sie schlicht „Kartendaten"; ungenannt
 * bleibt sie nie.
 *
 * Das Element hängt am BODY, nicht als MapLibre-Control im Kartencontainer:
 * dessen z-index gilt nur innerhalb des Karten-Stacking-Contexts, und das
 * Popup verschwand dort hinter der Steuerleiste.
 */

import type { Map as MapLibreKarte } from 'maplibre-gl'

export interface Datenquelle {
  /** Was man dieser Quelle im Bild ansieht („Satellitenbild", „Gelände") */
  rolle: string
  /** Rechtezeile. HTML erlaubt (Links) — die Texte stammen aus unserem Code. */
  html: string
}

/** Quellen-ID im Stil → was der Zuschauer davon sieht */
const ROLLEN: Record<string, string> = {
  satellite: 'Satellitenbild',
  dem: 'Gelände & Höhen',
}

/**
 * Baut die Liste für das Popup aus den Stil-Quellen (+ Quellen ohne Kachel,
 * etwa das Wetter-Archiv). Quellen ohne `attribution` fallen weg, Duplikate
 * derselben Rechtezeile werden zusammengefasst.
 */
export function sammleQuellen(
  sources: Record<string, { attribution?: string | undefined } | undefined>,
  extra: readonly Datenquelle[] = [],
): Datenquelle[] {
  const aus: Datenquelle[] = []
  const gesehen = new Set<string>()
  for (const [id, quelle] of Object.entries(sources)) {
    const html = quelle?.attribution?.trim()
    if (!html || gesehen.has(html)) continue
    gesehen.add(html)
    aus.push({ rolle: ROLLEN[id] ?? 'Kartendaten', html })
  }
  for (const q of extra) {
    if (gesehen.has(q.html)) continue
    gesehen.add(q.html)
    aus.push(q)
  }
  return aus
}

const ICON =
  '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" ' +
  'stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
  '<circle cx="12" cy="12" r="9.2"/><path d="M12 11.1v5.3"/><path d="M12 7.7h.01"/></svg>'

export function createKartenInfo(
  karte: MapLibreKarte,
  extra: readonly Datenquelle[] = [],
): { entferne(): void } {
  let offen = false
  let zuTimer = 0

  const el = document.createElement('div')
  el.className = 'karten-info'

  const knopf = document.createElement('button')
  knopf.type = 'button'
  knopf.className = 'karten-info-knopf'
  knopf.title = 'Kartendaten & Quellen'
  knopf.setAttribute('aria-label', 'Kartendaten und Quellen')
  knopf.setAttribute('aria-expanded', 'false')
  knopf.setAttribute('aria-controls', 'karten-info-popup')
  knopf.innerHTML = ICON

  const popup = document.createElement('div')
  popup.className = 'karten-info-popup'
  popup.id = 'karten-info-popup'
  popup.hidden = true

  el.append(popup, knopf)

  const baueInhalt = () => {
    if (popup.dataset.gefuellt) return
    // getStyle() wirft, solange der Stil noch nicht geladen ist — der Inhalt
    // wird beim ersten Öffnen gebaut, dann ist er längst da.
    let sources: Record<string, { attribution?: string }> = {}
    try {
      sources = (karte.getStyle()?.sources ?? {}) as Record<string, { attribution?: string }>
    } catch {
      /* Stil noch nicht bereit: dann zeigen wir nur die Extra-Quellen */
    }
    const quellen = sammleQuellen(sources, extra)
    popup.innerHTML =
      '<p class="ki-titel">Kartendaten</p>' +
      quellen
        .map(
          (q) =>
            `<div class="ki-zeile"><span class="ki-rolle">${q.rolle}</span>` +
            `<span class="ki-quelle">${q.html}</span></div>`,
        )
        .join('')
    // Links verlassen den Player immer in einem neuen Tab: ein Wegnavigieren
    // mitten in der Fahrt wäre der teuerste mögliche Klick.
    for (const a of popup.querySelectorAll('a')) {
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
    }
    popup.dataset.gefuellt = '1'
  }

  const setzeOffen = (auf: boolean) => {
    if (auf === offen) return
    offen = auf
    knopf.setAttribute('aria-expanded', String(auf))
    // Solange die Quellen offen sind, zieht sich die UI nicht zurück (main.js) —
    // sonst blendete der Text weg, während man ihn liest.
    document.body.classList.toggle('info-offen', auf)
    clearTimeout(zuTimer)
    if (auf) {
      baueInhalt()
      popup.hidden = false
      // Ein Frame Abstand: direkt aus display:none heraus überspringt der
      // Browser die Transition und das Popup erschiene ohne Bewegung.
      requestAnimationFrame(() => {
        if (offen) popup.classList.add('offen')
      })
    } else {
      popup.classList.remove('offen')
      zuTimer = window.setTimeout(() => {
        if (!offen) popup.hidden = true
      }, 220)
    }
  }

  const aufKnopf = (e: MouseEvent) => {
    e.stopPropagation()
    setzeOffen(!offen)
  }
  // Klick im Popup (etwa auf einen Link) darf nicht als „woanders" gelten
  const aufPopup = (e: MouseEvent) => e.stopPropagation()
  const aufDokument = (e: Event) => {
    if (offen && !el.contains(e.target as Node)) setzeOffen(false)
  }
  const aufTaste = (e: KeyboardEvent) => {
    if (offen && e.key === 'Escape') {
      setzeOffen(false)
      knopf.focus()
    }
  }

  knopf.addEventListener('click', aufKnopf)
  popup.addEventListener('click', aufPopup)
  document.addEventListener('pointerdown', aufDokument)
  document.addEventListener('keydown', aufTaste)
  document.body.appendChild(el)

  return {
    entferne() {
      knopf.removeEventListener('click', aufKnopf)
      popup.removeEventListener('click', aufPopup)
      document.removeEventListener('pointerdown', aufDokument)
      document.removeEventListener('keydown', aufTaste)
      clearTimeout(zuTimer)
      document.body.classList.remove('info-offen')
      el.remove()
    },
  }
}
