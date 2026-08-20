// Das Rückmelde-Formular — ein Baustein, zwei Orte: im Alpha-Kärtchen hinter
// der Wortmarke und als ganze Seite unter `/feedback` (die auch die App im
// WebView öffnet).
//
// Für den Absender ist es EIN Feld. Kategorie, Priorität und Status vergibt,
// wer sichtet — jede Pflichtangabe im Formular kostet in einer Alpha
// Meldungen, und die Einordnung kann der Betreiber ohnehin besser.
//
// Das CSS bringt der Baustein selbst mit, aus demselben Grund wie beim
// Alpha-Chip: Die Landing lädt `grundelemente.css` nicht.

import { version as APP_VERSION } from '../package.json'
import {
  MAX_TEXT,
  kontextZeilen,
  sammleKontext,
  textTaugt,
  type FeedbackKontext,
} from './feedbackmodell.js'

const STIL_ID = 'feedback-stil'

const STIL = `
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
.fb-form .feld-art {
  margin-left: auto;
  font-size: 11.5px;
  font-weight: 500;
  color: var(--text-3, #7e8a99);
  letter-spacing: 0.01em;
}
.fb-form .feld-art.pflicht { color: var(--text-2, #a7b1bf); }
.fb-form textarea, .fb-form input[type='email'] {
  width: 100%;
  margin-bottom: 6px;
  font-family: var(--font-ui);
  font-size: 13px;
  color: var(--text, #f2ede3);
  background: var(--bg-tief, #06080c);
  border: 1px solid var(--rand, #232d3d);
  border-radius: var(--radius-md, 8px);
  padding: 9px 10px;
}
.fb-form textarea { min-height: 96px; resize: vertical; line-height: 1.45; }
.fb-form textarea:focus, .fb-form input[type='email']:focus {
  outline: none;
  border-color: var(--akzent, #f59e0b);
}
.fb-zeile { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-2, #a7b1bf); }
.fb-zeile label { font-weight: 500; }
.fb-zeile input[type='checkbox'] { accent-color: var(--akzent, #f59e0b); }
.fb-angaben { font-size: 12px; color: var(--text-3, #7e8a99); }
.fb-angaben summary { cursor: pointer; width: fit-content; }
.fb-angaben summary:hover { color: var(--text-2, #a7b1bf); }
/* Dreispaltig: Sechs Paare untereinander lasen sich wie ein Protokoll; in drei
   Spalten sind es zwei Zeilen, die man mit einem Blick erfasst. auto-fit mit
   kleiner Mindestbreite lässt es auf schmalen Schirmen von selbst auf zwei und
   dann eine Spalte fallen — eine feste Dreiteilung risse die Werte sonst
   mitten im Wort um. */
.fb-angaben dl {
  margin: 9px 0 2px;
  padding: 11px 13px;
  border-radius: var(--radius-md, 8px);
  background: var(--bg-tief, #06080c);
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(98px, 1fr));
  gap: 9px 16px;
  font-variant-numeric: tabular-nums;
}
.fb-angaben dl > div { min-width: 0; }
.fb-angaben dt { font-size: 10.5px; color: var(--text-3, #7e8a99); }
.fb-angaben dd {
  margin: 1px 0 0;
  color: var(--text-2, #a7b1bf);
  overflow-wrap: anywhere;
}
.fb-fuss { display: flex; align-items: center; gap: 10px; margin-top: 6px; }
.fb-senden {
  font-family: var(--font-ui);
  font-size: 13px;
  font-weight: 600;
  color: var(--auf-akzent, #1a1206);
  background: var(--akzent, #f59e0b);
  border: none;
  border-radius: var(--radius-md, 8px);
  padding: 10px 16px;
  cursor: pointer;
}
/* Fläche in JEDEM Zustand wiederholen: Studio und Verwaltung laden
   werkzeug.css, dessen \`button:hover\` (0,1,1) und \`button:disabled:hover\`
   sonst die Markenfläche schlagen — der Knopf wurde dort beim Überfahren grau
   (s. DESIGN.md, „Primary button"). Dieselbe Falle beim :active-Skalieren. */
.fb-senden:hover {
  background: var(--akzent, #f59e0b);
  border: none;
  filter: brightness(1.06);
}
.fb-senden:active { transform: none; }
.fb-senden:disabled,
.fb-senden:disabled:hover {
  background: var(--akzent, #f59e0b);
  opacity: 0.5;
  cursor: default;
  filter: none;
}
/* Der Abbrechen-Knopf steht LINKS und ohne Fläche: Er ist der Weg zurück, nicht
   die zweite Wahl — als gleichwertiger Kasten daneben ließe er zögern. */
.fb-abbrechen {
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
.fb-abbrechen:hover { color: var(--text-2, #a7b1bf); background: none; border: none; }
.fb-abbrechen:active { transform: none; }
.fb-fuss .fb-senden { margin-left: auto; }
.fb-meldung { font-size: 12.5px; line-height: 1.45; margin: 2px 0 0; }
.fb-meldung.fehler { color: var(--rot, #e5484d); }
.fb-meldung.gut { color: var(--gruen, #3ecf8e); }
`

function stellStilBereit(): void {
  if (document.getElementById(STIL_ID)) return
  const stil = document.createElement('style')
  stil.id = STIL_ID
  stil.textContent = STIL
  document.head.appendChild(stil)
}

export interface FeedbackOptionen {
  /** Wird nach erfolgreichem Senden gerufen (z. B. um das Kärtchen zu schließen). */
  beiErfolg?: () => void
  /**
   * Gesetzt = es gibt einen Weg zurück, und dann bekommt das Formular einen
   * „Abbrechen"-Knopf. Im Dialog ist das richtig: Er steht da, wo man beim
   * Ausfüllen hinsieht, während das Kreuz oben eine Ecke weit weg liegt. Auf
   * der SEITE `/feedback` bleibt er weg — dort gäbe es kein Ziel für ihn, und
   * ein Knopf, der nur „zurück" bedeutet, doppelt den Browser-Knopf.
   */
  beiAbbruch?: () => void
  /** Kontext-Angaben, die der Aufrufer beisteuert (die App: Gerät, App-Version). */
  zusatzKontext?: FeedbackKontext
  quelle?: 'web' | 'app'
}

/**
 * Baut das Formular in `mount`. Gibt eine Funktion zurück, die den Fokus ins
 * Textfeld setzt — der Aufrufer entscheidet, wann das passt (im Dialog sofort,
 * auf der Seite erst nach dem Aufbau).
 */
export function montiereFeedbackFormular(
  mount: HTMLElement,
  optionen: FeedbackOptionen = {},
): () => void {
  stellStilBereit()

  const context: FeedbackKontext = {
    ...sammleKontext({
      href: location.href,
      version: APP_VERSION,
      userAgent: navigator.userAgent,
      breite: window.innerWidth,
      hoehe: window.innerHeight,
      language: navigator.language,
    }),
    ...optionen.zusatzKontext,
  }

  const form = document.createElement('form')
  form.className = 'fb-form'
  form.noValidate = true
  // Jedes Feld sagt im Label, ob es sein muss („Pflicht" / „optional",
  // `.feld-art` — dieselbe Konvention wie in den Auth-Formularen, s. DESIGN.md).
  // BEIDE Sorten sind markiert (NN/g und Baymard empfehlen genau das): Aus dem
  // Fehlen schließen zu müssen kostet den Moment Unsicherheit, der Formulare
  // zäh macht. Das Pflichtfeld trägt zusätzlich `required`/`aria-required` —
  // die Auszeichnung darf nicht nur eine optische sein.
  form.innerHTML =
    `<label for="fb-text">Was ist dir aufgefallen? <span class="feld-art pflicht">Pflicht</span></label>` +
    `<textarea id="fb-text" required aria-required="true" maxlength="${MAX_TEXT}"` +
    ` placeholder="Was wolltest du tun, und was ist stattdessen passiert?"></textarea>` +
    `<label for="fb-mail">E-Mail-Adresse für Rückfragen <span class="feld-art">optional</span></label>` +
    `<input type="email" id="fb-mail" autocomplete="email" placeholder="du@example.com" />` +
    `<div class="fb-zeile">` +
    `<input type="checkbox" id="fb-kontext" checked />` +
    `<label for="fb-kontext">Technische Angaben mitsenden</label>` +
    `</div>` +
    `<details class="fb-angaben"><summary>Diese Angaben ansehen</summary>` +
    `<dl>${kontextZeilen(context)
      .map(([name, wert]) => `<div><dt>${name}</dt><dd>${wert}</dd></div>`)
      .join('')}</dl></details>` +
    `<div class="fb-fuss">` +
    (optionen.beiAbbruch ? `<button type="button" class="fb-abbrechen">Abbrechen</button>` : '') +
    `<button type="submit" class="fb-senden">Feedback absenden</button>` +
    `</div>` +
    `<p class="fb-meldung" role="status" aria-live="polite"></p>`
  mount.appendChild(form)

  const feld = form.querySelector('#fb-text') as HTMLTextAreaElement
  const mail = form.querySelector('#fb-mail') as HTMLInputElement
  const schalter = form.querySelector('#fb-kontext') as HTMLInputElement
  const knopf = form.querySelector('.fb-senden') as HTMLButtonElement
  const meldung = form.querySelector('.fb-meldung') as HTMLElement
  form.querySelector('.fb-abbrechen')?.addEventListener('click', () => optionen.beiAbbruch?.())

  const sage = (text: string, art: 'fehler' | 'gut' | '' = ''): void => {
    meldung.textContent = text
    meldung.className = `fb-meldung${art ? ` ${art}` : ''}`
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault()
    if (!textTaugt(feld.value)) {
      sage('Schreib bitte kurz, worum es geht.', 'fehler')
      feld.focus()
      return
    }
    knopf.disabled = true
    sage('Wird gesendet …')
    void fetch('/api/rueckmeldung', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // `credentials: same-origin` ist der Standard; die Sitzung geht also mit,
      // und der Server hängt die Konto-Kennung an. Wer nicht angemeldet ist,
      // meldet trotzdem — das ist der Punkt.
      body: JSON.stringify({
        text: feld.value.trim(),
        ...(mail.value.trim() ? { email: mail.value.trim() } : {}),
        ...(schalter.checked ? { context } : {}),
        quelle: optionen.quelle ?? 'web',
      }),
    })
      .then(async (antwort) => {
        if (antwort.ok) {
          form.reset()
          sage('Angekommen. Danke dafür.', 'gut')
          optionen.beiErfolg?.()
          return
        }
        const daten = (await antwort.json().catch(() => ({}))) as { fehler?: string }
        sage(
          daten.fehler ?? 'Das hat nicht geklappt. Bitte versuch es später noch einmal.',
          'fehler',
        )
      })
      .catch(() => {
        // Offline ist der wahrscheinlichste Fall — und ausgerechnet dann will
        // jemand vielleicht melden, dass nichts lädt.
        sage('Keine Verbindung. Der Text bleibt stehen, versuch es gleich noch einmal.', 'fehler')
      })
      .finally(() => {
        knopf.disabled = false
      })
  })

  return () => feld.focus()
}
