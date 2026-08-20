/**
 * Erklärungen als Tooltip statt als Zeile unter dem Feld.
 *
 * Die Tour-Einstellungen trugen unter drei Feldern je einen Satz Kleingedrucktes
 * („Steht klein über dem Titel. Leer = keine Zeile."). Jeder davon ist beim
 * ersten Mal nützlich und danach Grundrauschen — und zu dritt zerfiel das Panel
 * in Text mit ein paar Feldern dazwischen. Sie hängen jetzt an einem Griff neben
 * dem Label und kommen, wenn man sie sucht.
 *
 * Drei Dinge, die man dabei kippt:
 *
 *  · **Die Blase gehört an den `body`.** Das Inspector-Panel scrollt
 *    (`overflow-y: auto`), und ein Kind darin wird an seiner Kante
 *    abgeschnitten — `z-index` hilft dagegen nicht. Deshalb `position: fixed`
 *    am Dokument und die Lage aus `getBoundingClientRect` des Griffs.
 *  · **`title` reicht nicht.** Der native Tooltip erscheint erst nach etwa einer
 *    Sekunde, nur bei Maus und in der Systemschrift. Er bleibt trotzdem als
 *    Rückfall stehen, falls dieses Modul einmal nicht geladen ist.
 *  · **Tastatur und Touch müssen mit.** Der Griff ist ein `button`, kein `span`:
 *    Er ist fokussierbar, reagiert auf Klick (Touch) und schließt mit Escape.
 */

/** Die eine Blase; es kann immer nur eine offen sein. */
let bubble: HTMLElement | null = null
let openGrip: HTMLElement | null = null

function buildBubble(): HTMLElement {
  if (bubble) return bubble
  const el = document.createElement('div')
  el.className = 'tooltip-bubble'
  el.setAttribute('role', 'tooltip')
  el.id = 'tooltip-bubble'
  el.hidden = true
  document.body.append(el)
  bubble = el
  return el
}

function close(): void {
  if (!bubble) return
  bubble.hidden = true
  openGrip?.removeAttribute('aria-describedby')
  openGrip?.setAttribute('aria-expanded', 'false')
  openGrip = null
}

/** Ein Rechteck, wie es `getBoundingClientRect` liefert (nur was hier zählt). */
export interface Box {
  left: number
  top: number
  width: number
  height: number
}

/**
 * Wohin die Blase gehört — DOM-frei, damit die Wahl prüfbar ist.
 *
 * LINKS neben den Griff, wenn dort Platz ist. Die Griffe stehen in einem Panel
 * am rechten Rand: nach unten deckte die Blase das Feld zu, zu dem sie gehört,
 * nach oben die Panel-Überschrift. Daneben liegt die Karte, und die erklärt in
 * diesem Moment nichts.
 *
 * Der Rückfall auf die Dokumentbreite ist kein Zierrat: In einer Sandbox ohne
 * echte Fenstergröße meldet `innerWidth` 0 (die Browser-Pane tut das, sobald
 * sie unsichtbar ist), und dann klemmte jede Rechnung die Blase in die linke
 * obere Ecke — sichtbar als Kasten am Fensterrand, weit weg von seinem Griff.
 */
export function positionFor(
  grip: Box,
  bubble: Box,
  viewport: { width: number; height: number },
  gap = 8,
): { x: number; y: number; side: 'left' | 'bottom' | 'top' } {
  // Ohne echte Fenstergröße wird GAR NICHT geklemmt: Ein geratener Rand ist
  // schlechter als keiner — er zöge die Blase an einen Rand, den es nicht gibt.
  const known = viewport.width > 0 && viewport.height > 0
  const width = viewport.width
  const height = viewport.height
  const clamp = (value: number, max: number): number =>
    known ? Math.min(Math.max(gap, value), Math.max(gap, max)) : value

  const linksX = grip.left - bubble.width - gap
  if (linksX >= gap) {
    const center = grip.top + grip.height / 2 - bubble.height / 2
    return { x: linksX, y: clamp(center, height - bubble.height - gap), side: 'left' }
  }
  const bottomY = grip.top + grip.height + gap
  const fitsBelow = !known || bottomY + bubble.height <= height - gap
  return {
    x: clamp(grip.left + grip.width / 2 - bubble.width / 2, width - bubble.width - gap),
    y: fitsBelow ? bottomY : Math.max(gap, grip.top - bubble.height - gap),
    side: fitsBelow ? 'bottom' : 'top',
  }
}

function show(grip: HTMLElement, text: string): void {
  const el = buildBubble()
  el.textContent = text
  el.hidden = false
  openGrip = grip
  grip.setAttribute('aria-describedby', el.id)
  grip.setAttribute('aria-expanded', 'true')

  const position = positionFor(grip.getBoundingClientRect(), el.getBoundingClientRect(), {
    width: window.innerWidth || document.documentElement.clientWidth,
    height: window.innerHeight || document.documentElement.clientHeight,
  })
  el.style.left = `${Math.round(position.x)}px`
  el.style.top = `${Math.round(position.y)}px`
  el.dataset.side = position.side
}

/**
 * Hängt die Tipps unter `root` ein: jeder `[data-tooltip]` bekommt Zeigen und
 * Verbergen. Mehrfach aufrufbar (der Editor baut Panels neu auf) — verdrahtete
 * Griffe merkt sich ein Datenattribut.
 */
export function wireTooltips(root: ParentNode = document): void {
  wireGlobal()
  for (const grip of root.querySelectorAll<HTMLElement>('[data-tooltip]')) {
    if (grip.dataset.tooltipReady === '1') continue
    grip.dataset.tooltipReady = '1'
    const text = grip.dataset.tooltip ?? ''
    if (!grip.hasAttribute('title')) grip.title = text
    grip.setAttribute('aria-expanded', 'false')
    grip.addEventListener('pointerenter', () => show(grip, text))
    grip.addEventListener('pointerleave', () => {
      if (openGrip === grip && document.activeElement !== grip) close()
    })
    grip.addEventListener('focus', () => show(grip, text))
    grip.addEventListener('blur', () => {
      if (openGrip === grip) close()
    })
    // Touch: Der Zeiger bleibt nach dem Tippen „drin", ein zweiter Tipp schließt.
    grip.addEventListener('click', (e) => {
      e.preventDefault()
      if (openGrip === grip) close()
      else show(grip, text)
    })
  }
}

/**
 * Escape schließt, egal wo der Fokus steht — und ein Scroll ebenfalls: Die Lage
 * ist einmal berechnet, mitgeführt würde sie eine Rechnung pro Frame kosten.
 *
 * Beim ersten `wireTooltips` und nicht beim Import: Ein Modul, das schon beim
 * Laden am `document` hängt, ist ohne Browser nicht einmal importierbar — und
 * die Lage-Rechnung darüber damit nicht prüfbar.
 */
let globalWired = false
function wireGlobal(): void {
  if (globalWired) return
  globalWired = true
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close()
  })
  window.addEventListener('scroll', close, true)
}
