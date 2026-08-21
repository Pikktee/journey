// Die Gliederung der Datenschutzerklärung: markiert, wo man gerade liest.
//
// Bewusst ein SCROLL-Beobachter und kein IntersectionObserver, obwohl der die
// naheliegende Wahl wäre: Ein Abschnitt dieser Erklärung ist oft höher als das
// Fenster, „sichtbar" sind dann zwei gleichzeitig oder keiner — der Observer
// müsste über Schwellen und Randmasken zu genau dem zurückgerechnet werden, was
// hier in einer Zeile steht: Welche Überschrift ist die letzte OBERHALB der
// Lesekante? Dazu kommt, dass sich IO in der Vorschau-Ansicht nicht prüfen
// lässt (sie pausiert den Rendering-Lebenszyklus, wenn sie unsichtbar ist).
//
// Der Zuhörer läuft passiv und rechnet erst im nächsten Frame — Scrollen darf
// nicht am Markieren hängen.

/** Wo im Fenster die „Lesekante" liegt: knapp unter der fixierten Kopfleiste. */
export const EDGE = 140

/**
 * Welcher Abschnitt gilt als „gerade gelesen"?
 *
 * DOM-frei, damit die Regel prüfbar ist: Der Aufrufer misst die Oberkanten der
 * Überschriften (relativ zum Fenster), diese Funktion entscheidet. Drei Fälle,
 * und jeder davon ist einmal falsch gewesen:
 *
 *   1. Der Normalfall — die LETZTE Überschrift oberhalb der Lesekante.
 *   2. Ganz oben, noch vor der ersten Überschrift: der erste Punkt. Sonst
 *      stünde die Gliederung beim Seitenanfang ohne jede Marke da.
 *   3. Am Dokumentende: der letzte Punkt. Ein kurzer Schlussabschnitt erreicht
 *      die Lesekante nie — ohne diesen Fall bliebe die Marke zwei Abschnitte
 *      zurück, gerade dort, wo „Deine Rechte" steht.
 */
export function activeSection(tops: readonly number[], atEnd = false, edge = EDGE): number {
  if (!tops.length) return -1
  if (atEnd) return tops.length - 1
  let hit = 0
  for (let i = 0; i < tops.length; i++) {
    if ((tops[i] as number) <= edge) hit = i
  }
  return hit
}

export function mountOutline(root: HTMLElement | null): void {
  if (!root) return
  const anchors = [...root.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')]
  const targets = anchors
    .map((a) => {
      const el = document.getElementById(decodeURIComponent(a.hash.slice(1)))
      return el ? { a, el } : null
    })
    .filter((x): x is { a: HTMLAnchorElement; el: HTMLElement } => x !== null)
  if (!targets.length) return

  let active: HTMLAnchorElement | null = null
  let scheduled = false

  const mark = (): void => {
    scheduled = false
    const atEnd = window.innerHeight + window.scrollY >= document.body.scrollHeight - 4
    const index = activeSection(
      targets.map((t) => t.el.getBoundingClientRect().top),
      atEnd,
    )
    const hit = targets[index] as { a: HTMLAnchorElement; el: HTMLElement }
    if (!hit || hit.a === active) return
    active?.removeAttribute('aria-current')
    hit.a.setAttribute('aria-current', 'true')
    active = hit.a
  }

  const onScroll = (): void => {
    if (scheduled) return
    scheduled = true
    requestAnimationFrame(mark)
  }

  // Ein Sprung in der Gliederung ist Navigation IM Dokument, kein
  // Seitenwechsel: Ohne das Abfangen legt jeder Klick einen History-Eintrag an,
  // und der „Zurück"-Knopf oben arbeitet danach erst zwölf Sprungmarken ab,
  // bevor er die Seite verlässt. `replaceState` hält die Adresse trotzdem
  // aktuell — der Link auf einen Abschnitt bleibt kopierbar.
  for (const { a, el } of targets) {
    a.addEventListener('click', (e) => {
      // Modifikator-Klicks (neuer Tab, neues Fenster) gehören dem Browser.
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      e.preventDefault()
      el.scrollIntoView({ block: 'start' })
      history.replaceState(null, '', a.hash)
      // Der Abschnitt bekommt den Fokus, sonst bliebe er auf dem Link — die
      // nächste Tabulator-Taste führte zurück in die Gliederung statt in den
      // Text.
      el.setAttribute('tabindex', '-1')
      el.focus({ preventScroll: true })
    })
  }

  mark()
  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('resize', onScroll)
}
