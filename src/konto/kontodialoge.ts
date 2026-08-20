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

import { oeffneSchicht, dialogFeld } from '../dialogschicht.js'
import { haengePasswortfeld } from '../passwortfeld.js'

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  klasse?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const knoten = document.createElement(tag)
  if (klasse) knoten.className = klasse
  if (text !== undefined) knoten.textContent = text
  return knoten
}

async function sende(
  url: string,
  daten: Record<string, unknown>,
  methode = 'POST',
): Promise<{ ok: true } | { ok: false; fehler: string }> {
  try {
    const antwort = await fetch(url, {
      method: methode,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(daten),
    })
    if (antwort.ok) return { ok: true }
    const koerper = (await antwort.json().catch(() => ({}))) as { error?: string }
    return { ok: false, fehler: koerper.error ?? 'Das hat gerade nicht geklappt.' }
  } catch {
    return { ok: false, fehler: 'Keine Verbindung zum Server.' }
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
export function oeffneMailDialog(meldung: (text: string) => void): void {
  const { koerper, fuss, schliesse } = oeffneSchicht('E-Mail-Adresse ändern')
  koerper.appendChild(
    el(
      'p',
      'sp-hinweis',
      'Wir schicken einen Bestätigungslink an die neue Adresse. Bis du ihn anklickst, meldest du dich weiter mit der bisherigen an.',
    ),
  )
  const mail = dialogFeld('k-neue-mail', 'Neue Adresse', 'email')
  mail.eingabe.placeholder = 'name@beispiel.de'
  const pw = dialogFeld('k-mail-pw', 'Dein Passwort', 'password')
  koerper.append(mail.huelle, pw.huelle)
  // Ohne Bewertung: Hier wird ein vorhandenes Passwort eingegeben, keine Note
  // dafür vergeben. Der Sichtbarkeits-Schalter rettet trotzdem jeden Tippfehler.
  haengePasswortfeld(pw.eingabe, { bewertung: false })

  const fehler = el('p', 'sp-fehler')
  fehler.hidden = true
  koerper.appendChild(fehler)

  const abbrechen = el('button', 'still', 'Abbrechen')
  abbrechen.type = 'button'
  abbrechen.addEventListener('click', schliesse)
  const senden = el('button', 'primaer', 'Link senden')
  senden.type = 'button'
  fuss.append(abbrechen, senden)
  window.setTimeout(() => mail.eingabe.focus(), 0)

  senden.addEventListener('click', async () => {
    senden.disabled = true
    fehler.hidden = true
    const ergebnis = await sende('/api/auth/me/email', {
      email: mail.eingabe.value.trim(),
      password: pw.eingabe.value,
    })
    if (!ergebnis.ok) {
      fehler.textContent = ergebnis.fehler
      fehler.hidden = false
      senden.disabled = false
      return
    }
    schliesse()
    meldung('Bestätigungslink verschickt. Schau in dein neues Postfach.')
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
export function oeffnePasswortDialog(
  meldung: (text: string) => void,
  persoenlich: () => string[],
): void {
  const { koerper, fuss, schliesse } = oeffneSchicht('Passwort ändern')
  const alt = dialogFeld('k-pw-alt', 'Aktuelles Passwort', 'password')
  const neu = dialogFeld('k-pw-neu', 'Neues Passwort', 'password')
  neu.eingabe.autocomplete = 'new-password'
  neu.eingabe.placeholder = 'Am besten drei zufällige Wörter'
  koerper.append(alt.huelle, neu.huelle)
  haengePasswortfeld(alt.eingabe, { bewertung: false })

  const abbrechen = el('button', 'still', 'Abbrechen')
  abbrechen.type = 'button'
  abbrechen.addEventListener('click', schliesse)
  const aendern = el('button', 'primaer', 'Ändern')
  aendern.type = 'button'
  aendern.disabled = true

  // Die Bewertung entscheidet über den Knopf — aber erst, wenn etwas im Feld
  // steht: Ein von Anfang an grauer Knopf sieht aus, als wäre das Formular
  // kaputt (dieselbe Regel wie in der Registrierung, s. passwortfeld.ts).
  const staerke = haengePasswortfeld(neu.eingabe, {
    persoenlich,
    beiAenderung: (befund) => {
      aendern.disabled = !!neu.eingabe.value && !befund.reicht
    },
  })

  const hinweis = el(
    'p',
    'sp-hinweis',
    'Danach sind alle anderen Geräte abgemeldet, auch die Maptale App. Du bleibst hier angemeldet.',
  )
  koerper.appendChild(hinweis)
  const fehler = el('p', 'sp-fehler')
  fehler.hidden = true
  koerper.appendChild(fehler)
  fuss.append(abbrechen, aendern)
  window.setTimeout(() => alt.eingabe.focus(), 0)

  const pruefe = (): void => {
    aendern.disabled = !alt.eingabe.value || !neu.eingabe.value || !staerke.befund().reicht
  }
  alt.eingabe.addEventListener('input', pruefe)
  neu.eingabe.addEventListener('input', pruefe)

  aendern.addEventListener('click', async () => {
    aendern.disabled = true
    fehler.hidden = true
    const ergebnis = await sende('/api/auth/me/password', {
      old: alt.eingabe.value,
      new: neu.eingabe.value,
    })
    if (!ergebnis.ok) {
      fehler.textContent = ergebnis.fehler
      fehler.hidden = false
      pruefe()
      return
    }
    schliesse()
    meldung('Passwort geändert.')
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
export function oeffneExportDialog(starte: () => Promise<void>): void {
  const { koerper, fuss, schliesse } = oeffneSchicht('Alle Daten exportieren')
  koerper.appendChild(
    el(
      'p',
      'sp-hinweis',
      'Wir packen deine Touren, Fotos, Videos, Klänge und Konto-Angaben in ein ZIP. ' +
        'Der Bau dauert einen Moment; den Link bekommst du per Mail.',
    ),
  )

  const abbrechen = el('button', 'still', 'Abbrechen')
  abbrechen.type = 'button'
  abbrechen.addEventListener('click', schliesse)
  const anfordern = el('button', 'primaer', 'ZIP anfordern')
  anfordern.type = 'button'
  anfordern.addEventListener('click', async () => {
    anfordern.disabled = true
    // Erst schließen, dann starten: Die Rückmeldung (Erfolg wie Fehler) steht
    // als Flash-Meldung an der Seite, nicht im Dialog — sonst müsste man sie
    // zweimal bauen.
    schliesse()
    await starte()
  })
  fuss.append(abbrechen, anfordern)
  window.setTimeout(() => anfordern.focus(), 0)
}

/**
 * Konto löschen.
 *
 * Der Knopf bleibt gesperrt, bis das Wort dasteht. Kein Passwort, sondern ein
 * abgetipptes „LÖSCHEN": Ein Passwortfeld füllt der Passwortmanager von selbst
 * aus — der Tippzwang ist der einzige Riegel, den keine Automatik öffnet.
 */
export function oeffneLoeschDialog(fertig: () => void): void {
  const { koerper, fuss, schliesse } = oeffneSchicht('Konto löschen')
  koerper.appendChild(
    el(
      'p',
      'sp-hinweis',
      'Damit verschwinden dein Konto, alle Touren und alle hochgeladenen Fotos, Videos und Klänge. Das lässt sich nicht rückgängig machen.',
    ),
  )
  const feld = dialogFeld('k-loesch', 'Tippe LÖSCHEN, um zu bestätigen')
  feld.eingabe.placeholder = 'LÖSCHEN'
  koerper.appendChild(feld.huelle)
  const fehler = el('p', 'sp-fehler')
  fehler.hidden = true
  koerper.appendChild(fehler)

  const abbrechen = el('button', 'still', 'Doch nicht')
  abbrechen.type = 'button'
  abbrechen.addEventListener('click', schliesse)
  const loeschen = el('button', 'knopf gefahr', 'Konto löschen')
  loeschen.type = 'button'
  loeschen.disabled = true
  fuss.append(abbrechen, loeschen)
  window.setTimeout(() => feld.eingabe.focus(), 0)

  feld.eingabe.addEventListener('input', () => {
    loeschen.disabled = feld.eingabe.value.trim().toUpperCase() !== 'LÖSCHEN'
  })

  loeschen.addEventListener('click', async () => {
    loeschen.disabled = true
    const ergebnis = await sende('/api/auth/me', {}, 'DELETE')
    if (!ergebnis.ok) {
      fehler.textContent = ergebnis.fehler
      fehler.hidden = false
      loeschen.disabled = false
      return
    }
    schliesse()
    fertig()
  })
}
