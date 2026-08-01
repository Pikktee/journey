// Ein Passwortfeld, das mitdenkt: Stärkebalken, ein Satz Rat und der Schalter
// „anzeigen". Hängt sich an ein vorhandenes <input type="password"> — die
// Formulare in studio.html und admin.html bleiben also lesbares HTML.
//
// Warum die Anzeige erst NACH der ersten Eingabe kommt: Ein roter Balken unter
// einem leeren Feld ist kein Hinweis, sondern ein Vorwurf für etwas, das man
// noch gar nicht getan hat.
//
// Das CSS bringt die Komponente selbst mit (einmalig, per <style> im head). Das
// bricht mit „CSS steht in der HTML-Datei", ist hier aber die kleinere Sünde:
// Sonst stünde derselbe Block in zwei Seiten und würde beim nächsten Feinschliff
// auseinanderlaufen.

import { bewertePasswort, type Passwortbefund } from './passwortstaerke.js'

const STIL_ID = 'pw-staerke-stil'

const STIL = `
.pw-huelle { position: relative; }
.pw-huelle > input { padding-right: 42px; }
.pw-auge {
  position: absolute; top: 0; right: 0; height: 100%; width: 40px;
  display: grid; place-items: center;
  background: none; border: none; padding: 0; cursor: pointer;
  color: var(--text-3); border-radius: 0 10px 10px 0;
}
.pw-auge:hover { background: none; border: none; color: var(--text-2); }
.pw-auge:active { transform: none; }
.pw-auge svg { width: 17px; height: 17px; }
.pw-staerke { margin-top: 8px; }
.pw-balken { display: flex; gap: 4px; }
.pw-balken i {
  flex: 1; height: 3px; border-radius: 2px;
  background: var(--rand, #222b37);
  transition: background 260ms ease;
}
.pw-zeile {
  display: flex; justify-content: space-between; gap: 12px;
  margin-top: 6px; font-size: 12px; line-height: 1.35;
  min-height: 1.35em;
}
.pw-tipp { color: var(--text-3, #67727f); }
.pw-wort { font-weight: 550; white-space: nowrap; }
.pw-s0 .pw-wort, .pw-s1 .pw-wort { color: var(--rot, #e5484d); }
.pw-s2 .pw-wort { color: var(--warn, #e8a13c); }
.pw-s3 .pw-wort, .pw-s4 .pw-wort { color: var(--gruen, #3ecf8e); }
.pw-s0 .pw-balken i:nth-child(-n+1),
.pw-s1 .pw-balken i:nth-child(-n+1) { background: var(--rot, #e5484d); }
.pw-s2 .pw-balken i:nth-child(-n+2) { background: var(--warn, #e8a13c); }
.pw-s3 .pw-balken i:nth-child(-n+3) { background: var(--gruen, #3ecf8e); }
.pw-s4 .pw-balken i { background: var(--gruen, #3ecf8e); }
@media (prefers-reduced-motion: reduce) { .pw-balken i { transition: none; } }
`

const AUGE_AUF =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>'
const AUGE_ZU =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M10.6 5.2A9.9 9.9 0 0112 5c6.4 0 10 7 10 7a17.6 17.6 0 01-3.3 4.2M6.4 6.5A17.4 17.4 0 002 12s3.6 7 10 7c1.7 0 3.2-.5 4.5-1.2"/><path d="M9.9 9.9a3 3 0 004.2 4.2"/></svg>'

function sorgeFuerStil(): void {
  if (document.getElementById(STIL_ID)) return
  const el = document.createElement('style')
  el.id = STIL_ID
  el.textContent = STIL
  document.head.appendChild(el)
}

export interface Passwortfeld {
  /** Aktuelle Bewertung — die Formulare fragen `reicht` vor dem Absenden. */
  befund: () => Passwortbefund
  /** Neu bewerten, z. B. nachdem sich Name oder E-Mail geändert haben. */
  aktualisiere: () => void
  /** Feld leeren und die Anzeige zurücksetzen (nach dem Absenden). */
  leere: () => void
}

export interface PasswortfeldOptionen {
  /**
   * Name und E-Mail des Anmelders, als Funktion — sie stehen in Feldern, die
   * sich noch ändern, während das Passwort schon getippt ist.
   */
  persoenlich?: () => string[]
  /** Wird nach jeder Bewertung gerufen (z. B. um den Absenden-Knopf zu schalten). */
  beiAenderung?: (befund: Passwortbefund) => void
}

/**
 * Hängt Stärkeanzeige und Sichtbarkeits-Schalter an ein Passwortfeld.
 *
 * Das Input wird dabei in eine Hülle gepackt — der Augen-Knopf braucht einen
 * positionierten Vorfahren, und den bringt das nackte Feld nicht mit.
 */
export function haengePasswortfeld(input: HTMLInputElement, optionen: PasswortfeldOptionen = {}): Passwortfeld {
  sorgeFuerStil()

  const huelle = document.createElement('div')
  huelle.className = 'pw-huelle'
  input.parentNode?.insertBefore(huelle, input)
  huelle.appendChild(input)

  const auge = document.createElement('button')
  auge.type = 'button'
  auge.className = 'pw-auge'
  auge.innerHTML = AUGE_AUF
  auge.setAttribute('aria-label', 'Passwort anzeigen')
  huelle.appendChild(auge)

  const anzeige = document.createElement('div')
  anzeige.className = 'pw-staerke'
  anzeige.hidden = true
  anzeige.innerHTML =
    '<div class="pw-balken" aria-hidden="true"><i></i><i></i><i></i><i></i></div>' +
    '<div class="pw-zeile"><span class="pw-tipp"></span><span class="pw-wort"></span></div>'
  huelle.parentNode?.insertBefore(anzeige, huelle.nextSibling)
  const tippEl = anzeige.querySelector('.pw-tipp') as HTMLElement
  const wortEl = anzeige.querySelector('.pw-wort') as HTMLElement

  // Die Bewertung ist eine Empfehlung, kein Fehler: `polite` liest sie in einer
  // Pause vor, statt jeden Tastendruck dazwischenzurufen.
  anzeige.setAttribute('aria-live', 'polite')

  let letzter: Passwortbefund = bewertePasswort('')

  const aktualisiere = (): void => {
    letzter = bewertePasswort(input.value, optionen.persoenlich?.() ?? [])
    anzeige.hidden = !input.value
    anzeige.className = `pw-staerke pw-s${letzter.score}`
    tippEl.textContent = letzter.tipp
    wortEl.textContent = letzter.wort
    optionen.beiAenderung?.(letzter)
  }

  input.addEventListener('input', aktualisiere)

  auge.addEventListener('click', () => {
    const sichtbar = input.type === 'text'
    input.type = sichtbar ? 'password' : 'text'
    auge.innerHTML = sichtbar ? AUGE_AUF : AUGE_ZU
    auge.setAttribute('aria-label', sichtbar ? 'Passwort anzeigen' : 'Passwort verbergen')
    // Der Fokus gehört zurück ins Feld — sonst tippt man nach dem Blick weiter
    // ins Leere.
    input.focus()
  })

  return {
    befund: () => letzter,
    aktualisiere,
    leere: () => {
      input.value = ''
      // Nach dem Absenden wieder verdeckt: Das nächste Formular startet nicht
      // mit einem offen liegenden Passwortfeld.
      input.type = 'password'
      auge.innerHTML = AUGE_AUF
      aktualisiere()
    },
  }
}
