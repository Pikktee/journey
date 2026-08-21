// Das Rückmelde-Formular — ein Baustein, zwei Orte: im Alpha-Kärtchen hinter
// der Wortmarke und als ganze Seite unter `/feedback` (die auch die App im
// WebView öffnet).
//
// Für den Absender ist es EIN Feld. Kategorie, Priorität und Status vergibt,
// wer sichtet — jede Pflichtangabe im Formular kostet in einer Alpha
// Meldungen, und die Einordnung kann der Betreiber ohnehin besser.
//
// Das CSS bringt der Baustein selbst mit, aus demselben Grund wie beim
// Alpha-Chip: Die Landing lädt `page-elements.css` nicht.

import { version as APP_VERSION } from '../package.json'
import {
  MAX_TEXT,
  contextLines,
  collectContext,
  canSubmitText,
  type FeedbackContext,
} from './feedback-model.js'

const STYLE_ID = 'feedback-style'

const STYLE = `
.fb-form { display: flex; flex-direction: column; gap: 6px; }
.fb-form label {
  font-size: 12.5px;
  color: var(--text-2, #a7b1bf);
  font-weight: 550;
  display: flex;
  align-items: baseline;
  gap: 12px;
}
/* Pflicht/optional als Wort im Label und rechtsbündig am Feldrand: Das Wort
   steht da, wo die Frage aufkommt, ohne den Labeltext auseinanderzuziehen.
   Kein Sternchen (braucht eine Legende) und KEINE blasse Mikroschrift — NN/g
   warnt ausdrücklich vor kontrastarmen, winzigen Auszeichnungen. Deshalb
   11,5 px und text-2 statt einer grauen Kapsel. */
.fb-form .field-type {
  margin-left: auto;
  font-size: 11.5px;
  font-weight: 500;
  color: var(--text-3, #7e8a99);
  letter-spacing: 0.01em;
}
.fb-form .field-type.required { color: var(--text-2, #a7b1bf); }
.fb-form textarea, .fb-form input[type='email'] {
  width: 100%;
  margin-bottom: 6px;
  font-family: var(--font-ui);
  font-size: 13px;
  color: var(--text, #f2ede3);
  background: var(--bg-deep, #06080c);
  border: 1px solid var(--border, #232d3d);
  border-radius: var(--radius-md, 8px);
  padding: 9px 10px;
}
.fb-form textarea { min-height: 96px; resize: vertical; line-height: 1.45; }
.fb-form textarea:focus, .fb-form input[type='email']:focus {
  outline: none;
  border-color: var(--primary, #f59e0b);
}
.feedback-row { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-2, #a7b1bf); }
.feedback-row label { font-weight: 500; }
.feedback-row input[type='checkbox'] { accent-color: var(--primary, #f59e0b); }
.feedback-details { font-size: 12px; color: var(--text-3, #7e8a99); }
.feedback-details summary { cursor: pointer; width: fit-content; }
.feedback-details summary:hover { color: var(--text-2, #a7b1bf); }
/* Dreispaltig: Sechs Paare untereinander lasen sich wie ein Protokoll; in drei
   Spalten sind es zwei Zeilen, die man mit einem Blick erfasst. auto-fit mit
   kleiner Mindestbreite lässt es auf schmalen Schirmen von selbst auf zwei und
   dann eine Spalte fallen — eine feste Dreiteilung risse die Werte sonst
   mitten im Wort um. */
.feedback-details dl {
  margin: 9px 0 2px;
  padding: 11px 13px;
  border-radius: var(--radius-md, 8px);
  background: var(--bg-deep, #06080c);
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(98px, 1fr));
  gap: 9px 16px;
  font-variant-numeric: tabular-nums;
}
.feedback-details dl > div { min-width: 0; }
.feedback-details dt { font-size: 10.5px; color: var(--text-3, #7e8a99); }
.feedback-details dd {
  margin: 1px 0 0;
  color: var(--text-2, #a7b1bf);
  overflow-wrap: anywhere;
}
.feedback-footer { display: flex; align-items: center; gap: 10px; margin-top: 6px; }
.feedback-send {
  font-family: var(--font-ui);
  font-size: 13px;
  font-weight: 600;
  color: var(--on-cta, #1a1206);
  background: var(--primary, #f59e0b);
  border: none;
  border-radius: var(--radius-md, 8px);
  padding: 10px 16px;
  cursor: pointer;
}
/* Fläche in JEDEM Zustand wiederholen: Studio und Verwaltung laden
   toolkit.css, dessen \`button:hover\` (0,1,1) und \`button:disabled:hover\`
   sonst die Markenfläche schlagen — der Knopf wurde dort beim Überfahren grau
   (s. DESIGN.md, „Primary button"). Dieselbe Falle beim :active-Skalieren. */
.feedback-send:hover {
  background: var(--primary, #f59e0b);
  border: none;
  filter: brightness(1.06);
}
.feedback-send:active { transform: none; }
.feedback-send:disabled,
.feedback-send:disabled:hover {
  background: var(--primary, #f59e0b);
  opacity: 0.5;
  cursor: default;
  filter: none;
}
/* Der Abbrechen-Knopf steht LINKS und ohne Fläche: Er ist der Weg zurück, nicht
   die zweite Wahl — als gleichwertiger Kasten daneben ließe er zögern. */
.feedback-cancel {
  reihe: -1;
  font-family: var(--font-ui);
  font-size: 13px;
  font-weight: 500;
  color: var(--text-3, #7e8a99);
  background: none;
  border: none;
  padding: 10px 4px;
  cursor: pointer;
}
.feedback-cancel:hover { color: var(--text-2, #a7b1bf); background: none; border: none; }
.feedback-cancel:active { transform: none; }
.feedback-footer .feedback-send { margin-left: auto; }
.feedback-message { font-size: 12.5px; line-height: 1.45; margin: 2px 0 0; }
.feedback-message.error { color: var(--danger, #e5484d); }
.feedback-message.good { color: var(--success, #3ecf8e); }
`

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = STYLE
  document.head.appendChild(style)
}

export interface FeedbackOptions {
  /** Wird nach erfolgreichem Senden gerufen (z. B. um das Kärtchen zu schließen). */
  onSuccess?: () => void
  /**
   * Gesetzt = es gibt einen Weg zurück, und dann bekommt das Formular einen
   * „Abbrechen"-Knopf. Im Dialog ist das richtig: Er steht da, wo man beim
   * Ausfüllen hinsieht, während das Kreuz oben eine Ecke weit weg liegt. Auf
   * der SEITE `/feedback` bleibt er weg — dort gäbe es kein Ziel für ihn, und
   * ein Knopf, der nur „zurück" bedeutet, doppelt den Browser-Knopf.
   */
  onCancel?: () => void
  /** Kontext-Angaben, die der Aufrufer beisteuert (die App: Gerät, App-Version). */
  extraContext?: FeedbackContext
  source?: 'web' | 'app'
}

/**
 * Baut das Formular in `mount`. Gibt eine Funktion zurück, die den Fokus ins
 * Textfeld setzt — der Aufrufer entscheidet, wann das passt (im Dialog sofort,
 * auf der Seite erst nach dem Aufbau).
 */
export function mountFeedbackForm(mount: HTMLElement, options: FeedbackOptions = {}): () => void {
  ensureStyle()

  const context: FeedbackContext = {
    ...collectContext({
      href: location.href,
      version: APP_VERSION,
      userAgent: navigator.userAgent,
      width: window.innerWidth,
      height: window.innerHeight,
      language: navigator.language,
    }),
    ...options.extraContext,
  }

  const form = document.createElement('form')
  form.className = 'fb-form'
  form.noValidate = true
  // Jedes Feld sagt im Label, ob es sein muss („Pflicht" / „optional",
  // `.field-type` — dieselbe Konvention wie in den Auth-Formularen, s. DESIGN.md).
  // BEIDE Sorten sind markiert (NN/g und Baymard empfehlen genau das): Aus dem
  // Fehlen schließen zu müssen kostet den Moment Unsicherheit, der Formulare
  // zäh macht. Das Pflichtfeld trägt zusätzlich `required`/`aria-required` —
  // die Auszeichnung darf nicht nur eine optische sein.
  form.innerHTML =
    `<label for="fb-text">Was ist dir aufgefallen? <span class="field-type required">Pflicht</span></label>` +
    `<textarea id="fb-text" required aria-required="true" maxlength="${MAX_TEXT}"` +
    ` placeholder="Was wolltest du tun, und was ist stattdessen passiert?"></textarea>` +
    `<label for="fb-mail">E-Mail-Adresse für Rückfragen <span class="field-type">optional</span></label>` +
    `<input type="email" id="fb-mail" autocomplete="email" placeholder="du@example.com" />` +
    `<div class="feedback-row">` +
    `<input type="checkbox" id="feedback-context" checked />` +
    `<label for="feedback-context">Technische Angaben mitsenden</label>` +
    `</div>` +
    `<details class="feedback-details"><summary>Diese Angaben ansehen</summary>` +
    `<dl>${contextLines(context)
      .map(([name, value]) => `<div><dt>${name}</dt><dd>${value}</dd></div>`)
      .join('')}</dl></details>` +
    `<div class="feedback-footer">` +
    (options.onCancel ? `<button type="button" class="feedback-cancel">Abbrechen</button>` : '') +
    `<button type="submit" class="feedback-send">Feedback absenden</button>` +
    `</div>` +
    `<p class="feedback-message" role="status" aria-live="polite"></p>`
  mount.appendChild(form)

  const textField = form.querySelector('#fb-text') as HTMLTextAreaElement
  const mailField = form.querySelector('#fb-mail') as HTMLInputElement
  const contextSwitch = form.querySelector('#feedback-context') as HTMLInputElement
  const submitButton = form.querySelector('.feedback-send') as HTMLButtonElement
  const messageEl = form.querySelector('.feedback-message') as HTMLElement
  form.querySelector('.feedback-cancel')?.addEventListener('click', () => options.onCancel?.())

  const say = (text: string, tone: 'error' | 'good' | '' = ''): void => {
    messageEl.textContent = text
    messageEl.className = `feedback-message${tone ? ` ${tone}` : ''}`
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault()
    if (!canSubmitText(textField.value)) {
      say('Schreib bitte kurz, worum es geht.', 'error')
      textField.focus()
      return
    }
    submitButton.disabled = true
    say('Wird gesendet …')
    void fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // `credentials: same-origin` ist der Standard; die Sitzung geht also mit,
      // und der Server hängt die Konto-Kennung an. Wer nicht angemeldet ist,
      // meldet trotzdem — das ist der Punkt.
      body: JSON.stringify({
        text: textField.value.trim(),
        ...(mailField.value.trim() ? { email: mailField.value.trim() } : {}),
        ...(contextSwitch.checked ? { context } : {}),
        source: options.source ?? 'web',
      }),
    })
      .then(async (response) => {
        if (response.ok) {
          form.reset()
          say('Angekommen. Danke dafür.', 'good')
          options.onSuccess?.()
          return
        }
        const data = (await response.json().catch(() => ({}))) as { error?: string }
        say(data.error ?? 'Das hat nicht geklappt. Bitte versuch es später noch einmal.', 'error')
      })
      .catch(() => {
        // Offline ist der wahrscheinlichste Fall — und ausgerechnet dann will
        // jemand vielleicht melden, dass nichts lädt.
        say('Keine Verbindung. Der Text bleibt stehen, versuch es gleich noch einmal.', 'error')
      })
      .finally(() => {
        submitButton.disabled = false
      })
  })

  return () => textField.focus()
}
