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
  cssClass?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (cssClass) node.className = cssClass
  if (text !== undefined) node.textContent = text
  return node
}

export interface Dialog {
  layer: HTMLElement
  body: HTMLElement
  footer: HTMLElement
  close: () => void
}

/** Läuft hoch, damit zwei gleichzeitig offene Dialoge sich nicht dieselbe ID teilen. */
let dialogCount = 0

export function openDialogLayer(title: string): Dialog {
  const outer = el('div', 'dialog-layer')
  const dialog = el('div', 'dialog')
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('aria-modal', 'true')
  const header = el('div', 'modal-header')
  const heading = el('h2', undefined, title)
  // `aria-labelledby` statt `aria-label`: Der Name des Dialogs ist dann DIE
  // sichtbare Überschrift und keine zweite Kopie desselben Textes — sonst
  // liest ein Screenreader irgendwann etwas anderes vor, als auf dem Schirm
  // steht (spätestens bei Mehrsprachigkeit).
  heading.id = `dialog-title-${++dialogCount}`
  dialog.setAttribute('aria-labelledby', heading.id)
  header.appendChild(heading)
  dialog.appendChild(header)
  const body = el('div', 'modal-body')
  dialog.appendChild(body)
  const footer = el('div', 'modal-footer')
  dialog.appendChild(footer)
  outer.appendChild(dialog)

  const close = (): void => {
    outer.remove()
    document.removeEventListener('keydown', onKey)
    document.body.classList.remove('dialog-open')
  }
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close()
  }
  document.addEventListener('keydown', onKey)
  // Nur ein Klick, der AUF der Schicht beginnt, schließt: Ein Zug, der im
  // Dialog anfängt (Textauswahl) und über dem Rand endet, schlösse ihn sonst
  // mitten im Tippen. Deshalb `mousedown` auf `aussen` und kein `click`.
  outer.addEventListener('mousedown', (e) => {
    if (e.target === outer) close()
  })
  document.body.classList.add('dialog-open')
  document.body.appendChild(outer)
  return { layer: outer, body, footer, close }
}

/** Beschriftetes Eingabefeld für einen Dialogkörper. */
export function dialogField(
  id: string,
  labelText: string,
  type: 'text' | 'email' | 'password' = 'text',
): { wrap: HTMLElement; input: HTMLInputElement } {
  const wrap = el('div', 'modal-field')
  const label = el('label', undefined, labelText)
  label.htmlFor = id
  wrap.appendChild(label)
  const input = el('input')
  input.id = id
  input.type = type
  input.autocomplete = type === 'password' ? 'current-password' : 'off'
  wrap.appendChild(input)
  return { wrap, input }
}
