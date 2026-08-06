// Eine Dialogschicht, wie Profil- und Kontoseite sie brauchen: Kopf, Körper,
// Fußzeile — und die drei Wege hinaus (Knopf, Escape, Klick daneben).
//
// Sie steht hier und nicht in einer der beiden Seiten, weil sie sonst zweimal
// stünde: Die Klassennamen sind in beiden HTML-Dateien dieselben, und die
// Fallen (Klick, der IM Dialog beginnt; Tastatur-Zuhörer, der nach dem
// Schließen liegen bleibt) müsste man in beiden Fassungen erneut vermeiden.
//
// Bewusst DOM-bauend und nicht `<dialog>`: Das native Element bringt seine
// eigene Backdrop-Gestaltung und eine Fokus-Behandlung mit, die sich mit dem
// hier gewünschten Verhalten beißt — und es müsste ohnehin in jeder Seite als
// Markup liegen, obwohl die meisten Besucher es nie öffnen.

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

export interface Dialog {
  schicht: HTMLElement
  koerper: HTMLElement
  fuss: HTMLElement
  schliesse: () => void
}

/** Läuft hoch, damit zwei gleichzeitig offene Dialoge sich nicht dieselbe ID teilen. */
let laufendeNummer = 0

export function oeffneSchicht(titel: string): Dialog {
  const aussen = el('div', 'dialogschicht')
  const dialog = el('div', 'dialog')
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('aria-modal', 'true')
  const kopf = el('div', 'sp-kopf')
  const ueberschrift = el('h2', undefined, titel)
  // `aria-labelledby` statt `aria-label`: Der Name des Dialogs ist dann DIE
  // sichtbare Überschrift und keine zweite Kopie desselben Textes — sonst
  // liest ein Screenreader irgendwann etwas anderes vor, als auf dem Schirm
  // steht (spätestens bei Mehrsprachigkeit).
  ueberschrift.id = `dialog-titel-${++laufendeNummer}`
  dialog.setAttribute('aria-labelledby', ueberschrift.id)
  kopf.appendChild(ueberschrift)
  dialog.appendChild(kopf)
  const koerper = el('div', 'sp-koerper')
  dialog.appendChild(koerper)
  const fuss = el('div', 'sp-fuss')
  dialog.appendChild(fuss)
  aussen.appendChild(dialog)

  const schliesse = (): void => {
    aussen.remove()
    document.removeEventListener('keydown', beiTaste)
    document.body.classList.remove('dialog-offen')
  }
  const beiTaste = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') schliesse()
  }
  document.addEventListener('keydown', beiTaste)
  // Nur ein Klick, der AUF der Schicht beginnt, schließt: Ein Zug, der im
  // Dialog anfängt (Textauswahl) und über dem Rand endet, schlösse ihn sonst
  // mitten im Tippen. Deshalb `mousedown` auf `aussen` und kein `click`.
  aussen.addEventListener('mousedown', (e) => {
    if (e.target === aussen) schliesse()
  })
  document.body.classList.add('dialog-offen')
  document.body.appendChild(aussen)
  return { schicht: aussen, koerper, fuss, schliesse }
}

/** Beschriftetes Eingabefeld für einen Dialogkörper. */
export function dialogFeld(
  id: string,
  beschriftung: string,
  typ: 'text' | 'email' | 'password' = 'text',
): { huelle: HTMLElement; eingabe: HTMLInputElement } {
  const huelle = el('div', 'sp-feld')
  const label = el('label', undefined, beschriftung)
  label.htmlFor = id
  huelle.appendChild(label)
  const eingabe = el('input')
  eingabe.id = id
  eingabe.type = typ
  eingabe.autocomplete = typ === 'password' ? 'current-password' : 'off'
  huelle.appendChild(eingabe)
  return { huelle, eingabe }
}
