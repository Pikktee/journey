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

import { scorePassword, type PasswordAssessment } from './password-strength.js'

const STYLE_ID = 'pw-strength-style'

const STYLE = `
.pw-wrap { position: relative; }
.pw-wrap > input { padding-right: 42px; }
.pw-eye {
  position: absolute; top: 0; right: 0; height: 100%; width: 40px;
  display: grid; place-items: center;
  background: none; border: none; padding: 0; cursor: pointer;
  color: var(--text-3); border-radius: 0 10px 10px 0;
}
.pw-eye:hover { background: none; border: none; color: var(--text-2); }
.pw-eye:active { transform: none; }
.pw-eye svg { width: 17px; height: 17px; }
.pw-strength { margin-top: 8px; }
.pw-bar { display: flex; gap: 4px; }
.pw-bar i {
  flex: 1; height: 3px; border-radius: 2px;
  background: var(--border, #222b37);
  transition: background 260ms ease;
}
.pw-row {
  display: flex; justify-content: space-between; gap: 12px;
  margin-top: 6px; font-size: 12px; line-height: 1.35;
  min-height: 1.35em;
}
.pw-tip { color: var(--text-3, #67727f); }
.pw-word { font-weight: 550; white-space: nowrap; }
.pw-s0 .pw-word, .pw-s1 .pw-word { color: var(--danger, #e5484d); }
.pw-s2 .pw-word { color: var(--warn, #e8a13c); }
.pw-s3 .pw-word, .pw-s4 .pw-word { color: var(--success, #3ecf8e); }
.pw-s0 .pw-bar i:nth-child(-n+1),
.pw-s1 .pw-bar i:nth-child(-n+1) { background: var(--danger, #e5484d); }
.pw-s2 .pw-bar i:nth-child(-n+2) { background: var(--warn, #e8a13c); }
.pw-s3 .pw-bar i:nth-child(-n+3) { background: var(--success, #3ecf8e); }
.pw-s4 .pw-bar i { background: var(--success, #3ecf8e); }
@media (prefers-reduced-motion: reduce) { .pw-bar i { transition: none; } }
`

const EYE_OPEN =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>'
const EYE_CLOSED =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M10.6 5.2A9.9 9.9 0 0112 5c6.4 0 10 7 10 7a17.6 17.6 0 01-3.3 4.2M6.4 6.5A17.4 17.4 0 002 12s3.6 7 10 7c1.7 0 3.2-.5 4.5-1.2"/><path d="M9.9 9.9a3 3 0 004.2 4.2"/></svg>'

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return
  const el = document.createElement('style')
  el.id = STYLE_ID
  el.textContent = STYLE
  document.head.appendChild(el)
}

export interface PasswordField {
  /** Aktuelle Bewertung — die Formulare fragen `acceptable` vor dem Absenden. */
  assessment: () => PasswordAssessment
  /** Neu bewerten, z. B. nachdem sich Name oder E-Mail geändert haben. */
  update: () => void
  /** Feld leeren und die Anzeige zurücksetzen (nach dem Absenden). */
  clear: () => void
}

export interface PasswordFieldOptions {
  /**
   * Name und E-Mail des Anmelders, als Funktion — sie stehen in Feldern, die
   * sich noch ändern, während das Passwort schon getippt ist.
   */
  personal?: () => string[]
  /** Wird nach jeder Bewertung gerufen (z. B. um den Absenden-Knopf zu schalten). */
  onChange?: (assessment: PasswordAssessment) => void
  /**
   * Stärkeanzeige mitliefern? Vorgabe ja.
   *
   * Beim ANMELDEN nicht: Dort gibt jemand ein Passwort ein, das längst gewählt
   * ist — eine Note dafür ändert nichts mehr und liest sich wie ein Vorwurf.
   * Der Sichtbarkeits-Schalter gehört trotzdem hin; er rettet jeden Tippfehler,
   * ohne dass man das Feld leeren muss.
   */
  showStrength?: boolean
}

/**
 * Hängt Stärkeanzeige und Sichtbarkeits-Schalter an ein Passwortfeld.
 *
 * Das Input wird dabei in eine Hülle gepackt — der Augen-Knopf braucht einen
 * positionierten Vorfahren, und den bringt das nackte Feld nicht mit.
 */
export function attachPasswordField(
  input: HTMLInputElement,
  options: PasswordFieldOptions = {},
): PasswordField {
  ensureStyle()

  const wrap = document.createElement('div')
  wrap.className = 'pw-wrap'
  input.parentNode?.insertBefore(wrap, input)
  wrap.appendChild(input)

  const eye = document.createElement('button')
  eye.type = 'button'
  eye.className = 'pw-eye'
  eye.innerHTML = EYE_OPEN
  eye.setAttribute('aria-label', 'Passwort anzeigen')
  wrap.appendChild(eye)

  const withStrength = options.showStrength !== false

  const strengthEl = document.createElement('div')
  strengthEl.className = 'pw-strength'
  strengthEl.hidden = true
  strengthEl.innerHTML =
    '<div class="pw-bar" aria-hidden="true"><i></i><i></i><i></i><i></i></div>' +
    '<div class="pw-row"><span class="pw-tip"></span><span class="pw-word"></span></div>'
  if (withStrength) wrap.parentNode?.insertBefore(strengthEl, wrap.nextSibling)
  const hintEl = strengthEl.querySelector('.pw-tip') as HTMLElement
  const labelEl = strengthEl.querySelector('.pw-word') as HTMLElement

  // Die Bewertung ist eine Empfehlung, kein Fehler: `polite` liest sie in einer
  // Pause vor, statt jeden Tastendruck dazwischenzurufen.
  strengthEl.setAttribute('aria-live', 'polite')

  let last: PasswordAssessment = scorePassword('')

  const update = (): void => {
    if (!withStrength) return
    last = scorePassword(input.value, options.personal?.() ?? [])
    strengthEl.hidden = !input.value
    strengthEl.className = `pw-strength pw-s${last.score}`
    hintEl.textContent = last.hint
    labelEl.textContent = last.label
    options.onChange?.(last)
  }

  input.addEventListener('input', update)

  eye.addEventListener('click', () => {
    const visible = input.type === 'text'
    input.type = visible ? 'password' : 'text'
    eye.innerHTML = visible ? EYE_OPEN : EYE_CLOSED
    eye.setAttribute('aria-label', visible ? 'Passwort anzeigen' : 'Passwort verbergen')
    // Der Fokus gehört zurück ins Feld — sonst tippt man nach dem Blick weiter
    // ins Leere.
    input.focus()
  })

  return {
    assessment: () => last,
    update,
    clear: () => {
      input.value = ''
      // Nach dem Absenden wieder verdeckt: Das nächste Formular startet nicht
      // mit einem offen liegenden Passwortfeld.
      input.type = 'password'
      eye.innerHTML = EYE_OPEN
      update()
    },
  }
}
