// Der Weg zum Rückmelde-Formular: ein eigener Knopf in der Kopfleiste.
//
// Bewusst GETRENNT vom Alpha-Hinweis an der Wortmarke. Die beiden tun
// Verschiedenes: Der Hinweis erklärt einen Zustand („womit muss ich rechnen?"),
// der Knopf ist eine Handlung („ich habe etwas gefunden"). Steckt die Handlung
// im Hinweis, findet sie nur, wer erst auf ein Wort klickt, das er womöglich
// schon zu kennen glaubt.
//
// Der Knopf öffnet das Formular ÜBER der aktuellen Seite und schickt nicht auf
// `/feedback`: Damit bleibt der technische Kontext der Seite erhalten, auf der
// jemand etwas bemerkt hat. Die Seite `/feedback` gibt es trotzdem — für die
// App im WebView und für Links, die man weitergeben kann.
//
// Das Markup steht hier, das Aussehen des Knopfes in `page-elements.css` bzw.
// im Stilblock der Landing: Was im HTML der Seite liegt, darf sein CSS nicht
// erst per JavaScript bekommen (sonst blitzt es ungestaltet auf). Die Optik der
// Dialogschicht wird dagegen hier eingehängt — sie entsteht erst auf Klick.

const ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.3-.6L3 21l1.7-5a8.2 8.2 0 0 1-.7-3.4 8.4 8.4 0 0 1 8.4-8.5h.5a8.4 8.4 0 0 1 8.1 8z"/></svg>'

/** Der Knopf als Markup. Das Wort verschwindet auf schmalen Schirmen, das Symbol bleibt. */
export function feedbackButtonHtml(): string {
  return (
    `<button type="button" class="feedback-button" aria-haspopup="dialog"` +
    ` title="Rückmeldung geben">${ICON}<span>Feedback</span></button>`
  )
}

const STYLE_ID = 'feedback-layer-style'

const STYLE = `
.feedback-layer {
  position: fixed;
  inset: 0;
  z-index: 1300;
  display: grid;
  place-items: start center;
  padding: 72px 16px 24px;
  overflow-y: auto;
  background: rgba(3, 5, 8, 0.62);
  backdrop-filter: blur(3px);
}
.fb-dialog {
  width: min(460px, 100%);
  padding: 20px 22px 22px;
  border-radius: var(--radius-lg, 12px);
  border: 1px solid var(--glass-border, rgba(255, 255, 255, 0.1));
  background: var(--surface-1, #111722);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.55);
  font-family: var(--font-ui);
}
.feedback-dialog-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 6px;
}
.fb-dialog h2 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 18px;
  font-weight: 650;
  letter-spacing: -0.01em;
  color: var(--text, #f2ede3);
}
.feedback-dialog-close {
  margin-left: auto;
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  flex: none;
  /* padding 0 ist Pflicht, nicht Kosmetik: In Studio und Verwaltung gilt
     toolkit.css mit 9px 14px Innenabstand an jedem button, und in einem
     30x30-Feld schob das den Kreuz-Inhalt aus der Mitte — der runde Hover lag
     daneben. */
  padding: 0;
  background: none;
  border: none;
  border-radius: var(--radius-full, 999px);
  color: var(--text-3, #7e8a99);
  cursor: pointer;
  transition: color 150ms ease, background 150ms ease;
}
.feedback-dialog-close svg { width: 16px; height: 16px; }
.feedback-dialog-close:hover {
  color: var(--text, #f2ede3);
  background: rgba(255, 255, 255, 0.07);
  border: none;
}
.feedback-dialog-close:active { transform: none; }
.fb-dialog > p {
  margin: 0 0 16px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-2, #a7b1bf);
}
`

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = STYLE
  document.head.appendChild(style)
}

let open: (() => void) | null = null

/** Öffnet das Formular über der aktuellen Seite. Mehrfachaufrufe holen nur den Fokus. */
export function openFeedback(): void {
  if (open) return
  ensureStyle()
  const layer = document.createElement('div')
  layer.className = 'feedback-layer'
  const dialog = document.createElement('div')
  dialog.className = 'fb-dialog'
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('aria-modal', 'true')
  dialog.setAttribute('aria-label', 'Rückmeldung geben')
  dialog.innerHTML =
    `<div class="feedback-dialog-header"><h2>Rückmeldung geben</h2>` +
    // Kreuz statt des Wortes „Schließen": Das Wort stand als zweiter Text neben
    // der Überschrift und las sich wie ein Menüpunkt. Der Weg zurück beim
    // AUSFÜLLEN ist ohnehin der Abbrechen-Knopf unten im Formular.
    `<button type="button" class="feedback-dialog-close" aria-label="Schließen" title="Schließen">` +
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>` +
    `</button></div>` +
    `<p>Maptale ist in der Alpha. Jedes Feedback fließt direkt in die Entwicklung.</p>` +
    `<div class="fb-mount"></div>`
  layer.appendChild(dialog)
  document.body.appendChild(layer)

  const close = (): void => {
    layer.remove()
    document.removeEventListener('keydown', onKey)
    open = null
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') close()
  }
  // Klick auf die Schicht selbst schließt, ein Klick IM Dialog nicht — sonst
  // fiele das halb getippte Formular beim Danebengreifen weg.
  layer.addEventListener('mousedown', (e) => {
    if (e.target === layer) close()
  })
  dialog.querySelector('.feedback-dialog-close')?.addEventListener('click', close)
  document.addEventListener('keydown', onKey)
  open = close

  const mount = dialog.querySelector('.fb-mount') as HTMLElement
  void import('./feedback-form.js').then(({ mountFeedbackForm }) => {
    const focusFirst = mountFeedbackForm(mount, {
      // Nach dem Senden bleibt der Dialog kurz stehen, damit die Bestätigung
      // gelesen werden kann — er schließt sich dann von selbst.
      onSuccess: () => window.setTimeout(() => open?.(), 1400),
      // Nur HIER, nicht auf der Seite /feedback: Im Dialog gibt es ein Ziel für
      // „Abbrechen", und er steht da, wo man beim Ausfüllen hinsieht.
      onCancel: close,
    })
    focusFirst()
  })
}

let wired = false

/**
 * Verdrahtet alle Feedback-Knöpfe der Seite — als Delegation am `document`,
 * weil die Kopfleiste nach dem Konto-Abgleich neu geschrieben wird.
 */
export function mountFeedbackButton(): void {
  if (wired) return
  wired = true
  document.addEventListener('click', (e) => {
    const button = (e.target as Element | null)?.closest?.('.feedback-button')
    if (!button) return
    openFeedback()
  })
}
