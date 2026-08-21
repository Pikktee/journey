// Die vier Dialoge der Kontoeinstellungen: E-Mail ändern, Passwort ändern,
// Gerät abmelden, Konto löschen.
//
// Sie werden NACHGELADEN (`import()` in konto.ts) — wer die Seite nur öffnet,
// um seinen Speicherstand zu sehen, braucht weder die Passwortbewertung noch
// das Formular für den Adresswechsel im Bundle.
//
// Drei Dinge stehen in jedem dieser Dialoge und sind kein Zufall:
// das PASSWORT (eine offene Sitzung beweist nur, dass jemand am Gerät saß),
// die FOLGE im Klartext (was nach dem Klick passiert), und ein Fehlerplatz
// unter den Feldern — die Antwort des Servers ist die einzige, die zählt.

import { openDialogLayer, dialogField } from '../dialog-layer.js'
import { attachPasswordField } from '../password-field.js'

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cssClass?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (cssClass) node.className = cssClass
  if (text !== undefined) node.textContent = text
  return node
}

async function send(
  url: string,
  data: Record<string, unknown>,
  httpMethod = 'POST',
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const response = await fetch(url, {
      method: httpMethod,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (response.ok) return { ok: true }
    const responseBody = (await response.json().catch(() => ({}))) as { error?: string }
    return { ok: false, error: responseBody.error ?? 'Das hat gerade nicht geklappt.' }
  } catch {
    return { ok: false, error: 'Keine Verbindung zum Server.' }
  }
}

/**
 * E-Mail-Adresse ändern.
 *
 * Der Dialog schließt mit einer Zusage, nicht mit einem Vollzug: Die Adresse
 * wechselt erst nach dem Klick im NEUEN Postfach (s. server/src/routes/auth.ts).
 * Ein „E-Mail geändert" hier wäre gelogen — und der schlimmste Zeitpunkt, das
 * zu merken, wäre die nächste Anmeldung.
 */
export function openEmailDialog(notify: (text: string) => void): void {
  const { body, footer, close } = openDialogLayer('E-Mail-Adresse ändern')
  body.appendChild(
    el(
      'p',
      'modal-hint',
      'Wir schicken einen Bestätigungslink an die neue Adresse. Bis du ihn anklickst, meldest du dich weiter mit der bisherigen an.',
    ),
  )
  const mailField = dialogField('k-neue-mail', 'Neue Adresse', 'email')
  mailField.input.placeholder = 'name@beispiel.de'
  const pw = dialogField('k-mail-pw', 'Dein Passwort', 'password')
  body.append(mailField.wrap, pw.wrap)
  // Ohne Bewertung: Hier wird ein vorhandenes Passwort eingegeben, keine Note
  // dafür vergeben. Der Sichtbarkeits-Schalter rettet trotzdem jeden Tippfehler.
  attachPasswordField(pw.input, { showStrength: false })

  const error = el('p', 'modal-error')
  error.hidden = true
  body.appendChild(error)

  const cancelButton = el('button', 'subtle', 'Abbrechen')
  cancelButton.type = 'button'
  cancelButton.addEventListener('click', close)
  const submitButton = el('button', 'primary', 'Link senden')
  submitButton.type = 'button'
  footer.append(cancelButton, submitButton)
  window.setTimeout(() => mailField.input.focus(), 0)

  submitButton.addEventListener('click', async () => {
    submitButton.disabled = true
    error.hidden = true
    const result = await send('/api/auth/me/email', {
      email: mailField.input.value.trim(),
      password: pw.input.value,
    })
    if (!result.ok) {
      error.textContent = result.error
      error.hidden = false
      submitButton.disabled = false
      return
    }
    close()
    notify('Bestätigungslink verschickt. Schau in dein neues Postfach.')
  })
}

/**
 * Passwort ändern.
 *
 * Das alte Passwort steht dabei, und darunter steht, was der Wechsel kostet:
 * Alle anderen Geräte fallen — auch die App. Das ist die richtige Wirkung
 * (wer wechselt, weil er sich Sorgen macht, meint das Telefon mit), aber sie
 * darf niemanden überraschen.
 */
export function openPasswordDialog(notify: (text: string) => void, personal: () => string[]): void {
  const { body, footer, close } = openDialogLayer('Passwort ändern')
  const previous = dialogField('k-pw-alt', 'Aktuelles Passwort', 'password')
  const next = dialogField('k-pw-neu', 'Neues Passwort', 'password')
  next.input.autocomplete = 'new-password'
  next.input.placeholder = 'Am besten drei zufällige Wörter'
  body.append(previous.wrap, next.wrap)
  attachPasswordField(previous.input, { showStrength: false })

  const cancelButton = el('button', 'subtle', 'Abbrechen')
  cancelButton.type = 'button'
  cancelButton.addEventListener('click', close)
  const applyButton = el('button', 'primary', 'Ändern')
  applyButton.type = 'button'
  applyButton.disabled = true

  // Die Bewertung entscheidet über den Knopf — aber erst, wenn etwas im Feld
  // steht: Ein von Anfang an grauer Knopf sieht aus, als wäre das Formular
  // kaputt (dieselbe Regel wie in der Registrierung, s. password-field.ts).
  const strength = attachPasswordField(next.input, {
    personal,
    onChange: (assessment) => {
      applyButton.disabled = !!next.input.value && !assessment.acceptable
    },
  })

  const hint = el(
    'p',
    'modal-hint',
    'Danach sind alle anderen Geräte abgemeldet, auch die Maptale App. Du bleibst hier angemeldet.',
  )
  body.appendChild(hint)
  const error = el('p', 'modal-error')
  error.hidden = true
  body.appendChild(error)
  footer.append(cancelButton, applyButton)
  window.setTimeout(() => previous.input.focus(), 0)

  const check = (): void => {
    applyButton.disabled =
      !previous.input.value || !next.input.value || !strength.assessment().acceptable
  }
  previous.input.addEventListener('input', check)
  next.input.addEventListener('input', check)

  applyButton.addEventListener('click', async () => {
    applyButton.disabled = true
    error.hidden = true
    const result = await send('/api/auth/me/password', {
      old: previous.input.value,
      new: next.input.value,
    })
    if (!result.ok) {
      error.textContent = result.error
      error.hidden = false
      check()
      return
    }
    close()
    notify('Passwort geändert.')
  })
}

/**
 * Rückfrage vor dem Datenexport.
 *
 * KEINE Warnung — der Export nimmt nichts weg. Er ist trotzdem kein Knopf zum
 * Nebenbei-Drücken: Er stößt einen Lauf über alle Medien des Kontos an, der
 * Minuten dauert, danach 48 Stunden lang ein Archiv mit allen eigenen Fotos
 * bereithält und pro Konto nur einmal gleichzeitig laufen kann — wer ihn aus
 * Versehen trifft, wartet, bis er ihn wieder benutzen darf. Der Dialog sagt
 * deshalb, was gleich passiert, statt „Bist du sicher?" zu fragen.
 */
export function openDataExportDialog(start: () => Promise<void>): void {
  const { body, footer, close } = openDialogLayer('Alle Daten exportieren')
  body.appendChild(
    el(
      'p',
      'modal-hint',
      'Wir packen deine Touren, Fotos, Videos, Klänge und Konto-Angaben in ein ZIP. ' +
        'Der Bau dauert einen Moment; den Link bekommst du per Mail.',
    ),
  )

  const cancelButton = el('button', 'subtle', 'Abbrechen')
  cancelButton.type = 'button'
  cancelButton.addEventListener('click', close)
  const requestButton = el('button', 'primary', 'ZIP anfordern')
  requestButton.type = 'button'
  requestButton.addEventListener('click', async () => {
    requestButton.disabled = true
    // Erst schließen, dann starten: Die Rückmeldung (Erfolg wie Fehler) steht
    // als Flash-Meldung an der Seite, nicht im Dialog — sonst müsste man sie
    // zweimal bauen.
    close()
    await start()
  })
  footer.append(cancelButton, requestButton)
  window.setTimeout(() => requestButton.focus(), 0)
}

/**
 * Konto löschen.
 *
 * Der Knopf bleibt gesperrt, bis das Wort dasteht. Kein Passwort, sondern ein
 * abgetipptes „LÖSCHEN": Ein Passwortfeld füllt der Passwortmanager von selbst
 * aus — der Tippzwang ist der einzige Riegel, den keine Automatik öffnet.
 */
export function openDeleteAccountDialog(done: () => void): void {
  const { body, footer, close } = openDialogLayer('Konto löschen')
  body.appendChild(
    el(
      'p',
      'modal-hint',
      'Damit verschwinden dein Konto, alle Touren und alle hochgeladenen Fotos, Videos und Klänge. Das lässt sich nicht rückgängig machen.',
    ),
  )
  const field = dialogField('k-loesch', 'Tippe LÖSCHEN, um zu bestätigen')
  field.input.placeholder = 'LÖSCHEN'
  body.appendChild(field.wrap)
  const error = el('p', 'modal-error')
  error.hidden = true
  body.appendChild(error)

  const cancelButton = el('button', 'subtle', 'Doch nicht')
  cancelButton.type = 'button'
  cancelButton.addEventListener('click', close)
  const deleteButton = el('button', 'button danger', 'Konto löschen')
  deleteButton.type = 'button'
  deleteButton.disabled = true
  footer.append(cancelButton, deleteButton)
  window.setTimeout(() => field.input.focus(), 0)

  field.input.addEventListener('input', () => {
    deleteButton.disabled = field.input.value.trim().toUpperCase() !== 'LÖSCHEN'
  })

  deleteButton.addEventListener('click', async () => {
    deleteButton.disabled = true
    const result = await send('/api/auth/me', {}, 'DELETE')
    if (!result.ok) {
      error.textContent = result.error
      error.hidden = false
      deleteButton.disabled = false
      return
    }
    close()
    done()
  })
}
