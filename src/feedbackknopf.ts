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
// Das Markup steht hier, das Aussehen des Knopfes in `grundelemente.css` bzw.
// im Stilblock der Landing: Was im HTML der Seite liegt, darf sein CSS nicht
// erst per JavaScript bekommen (sonst blitzt es ungestaltet auf). Die Optik der
// Dialogschicht wird dagegen hier eingehängt — sie entsteht erst auf Klick.

const ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.3-.6L3 21l1.7-5a8.2 8.2 0 0 1-.7-3.4 8.4 8.4 0 0 1 8.4-8.5h.5a8.4 8.4 0 0 1 8.1 8z"/></svg>'

/** Der Knopf als Markup. Das Wort verschwindet auf schmalen Schirmen, das Symbol bleibt. */
export function feedbackKnopfHtml(): string {
  return (
    `<button type="button" class="feedback-knopf" aria-haspopup="dialog"` +
    ` title="Rückmeldung geben">${ICON}<span>Feedback</span></button>`
  )
}

const STIL_ID = 'feedback-schicht-stil'

const STIL = `
.fb-schicht {
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
  border: 1px solid var(--glas-rand, rgba(255, 255, 255, 0.1));
  background: var(--fl-1, #111722);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.55);
  font-family: var(--font-ui);
}
.fb-dialog-kopf {
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
.fb-dialog-zu {
  margin-left: auto;
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  flex: none;
  /* padding 0 ist Pflicht, nicht Kosmetik: In Studio und Verwaltung gilt
     werkzeug.css mit 9px 14px Innenabstand an jedem button, und in einem
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
.fb-dialog-zu svg { width: 16px; height: 16px; }
.fb-dialog-zu:hover {
  color: var(--text, #f2ede3);
  background: rgba(255, 255, 255, 0.07);
  border: none;
}
.fb-dialog-zu:active { transform: none; }
.fb-dialog > p {
  margin: 0 0 16px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-2, #a7b1bf);
}
`

function stellStilBereit(): void {
  if (document.getElementById(STIL_ID)) return
  const stil = document.createElement('style')
  stil.id = STIL_ID
  stil.textContent = STIL
  document.head.appendChild(stil)
}

let offen: (() => void) | null = null

/** Öffnet das Formular über der aktuellen Seite. Mehrfachaufrufe holen nur den Fokus. */
export function oeffneFeedback(): void {
  if (offen) return
  stellStilBereit()
  const schicht = document.createElement('div')
  schicht.className = 'fb-schicht'
  const dialog = document.createElement('div')
  dialog.className = 'fb-dialog'
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('aria-modal', 'true')
  dialog.setAttribute('aria-label', 'Rückmeldung geben')
  dialog.innerHTML =
    `<div class="fb-dialog-kopf"><h2>Rückmeldung geben</h2>` +
    // Kreuz statt des Wortes „Schließen": Das Wort stand als zweiter Text neben
    // der Überschrift und las sich wie ein Menüpunkt. Der Weg zurück beim
    // AUSFÜLLEN ist ohnehin der Abbrechen-Knopf unten im Formular.
    `<button type="button" class="fb-dialog-zu" aria-label="Schließen" title="Schließen">` +
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>` +
    `</button></div>` +
    `<p>Maptale ist in der Alpha. Jedes Feedback fließt direkt in die Entwicklung.</p>` +
    `<div class="fb-mount"></div>`
  schicht.appendChild(dialog)
  document.body.appendChild(schicht)

  const schliesse = (): void => {
    schicht.remove()
    document.removeEventListener('keydown', beiTaste)
    offen = null
  }
  function beiTaste(e: KeyboardEvent): void {
    if (e.key === 'Escape') schliesse()
  }
  // Klick auf die Schicht selbst schließt, ein Klick IM Dialog nicht — sonst
  // fiele das halb getippte Formular beim Danebengreifen weg.
  schicht.addEventListener('mousedown', (e) => {
    if (e.target === schicht) schliesse()
  })
  dialog.querySelector('.fb-dialog-zu')?.addEventListener('click', schliesse)
  document.addEventListener('keydown', beiTaste)
  offen = schliesse

  const mount = dialog.querySelector('.fb-mount') as HTMLElement
  void import('./feedbackformular.js').then(({ montiereFeedbackFormular }) => {
    const fokussiere = montiereFeedbackFormular(mount, {
      // Nach dem Senden bleibt der Dialog kurz stehen, damit die Bestätigung
      // gelesen werden kann — er schließt sich dann von selbst.
      beiErfolg: () => window.setTimeout(() => offen?.(), 1400),
      // Nur HIER, nicht auf der Seite /feedback: Im Dialog gibt es ein Ziel für
      // „Abbrechen", und er steht da, wo man beim Ausfüllen hinsieht.
      beiAbbruch: schliesse,
    })
    fokussiere()
  })
}

let verdrahtet = false

/**
 * Verdrahtet alle Feedback-Knöpfe der Seite — als Delegation am `document`,
 * weil die Kopfleiste nach dem Konto-Abgleich neu geschrieben wird.
 */
export function montiereFeedbackKnopf(): void {
  if (verdrahtet) return
  verdrahtet = true
  document.addEventListener('click', (e) => {
    const knopf = (e.target as Element | null)?.closest?.('.feedback-knopf')
    if (!knopf) return
    oeffneFeedback()
  })
}
