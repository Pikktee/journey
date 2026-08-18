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
let blase: HTMLElement | null = null
let offenerGriff: HTMLElement | null = null

function baueBlase(): HTMLElement {
  if (blase) return blase
  const el = document.createElement('div')
  el.className = 'tipp-blase'
  el.setAttribute('role', 'tooltip')
  el.id = 'tipp-blase'
  el.hidden = true
  document.body.append(el)
  blase = el
  return el
}

function schliesse(): void {
  if (!blase) return
  blase.hidden = true
  offenerGriff?.removeAttribute('aria-describedby')
  offenerGriff?.setAttribute('aria-expanded', 'false')
  offenerGriff = null
}

/** Ein Rechteck, wie es `getBoundingClientRect` liefert (nur was hier zählt). */
export interface Kasten {
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
export function lageFuer(
  griff: Kasten,
  blase: Kasten,
  fenster: { breite: number; hoehe: number },
  luft = 8,
): { x: number; y: number; seite: 'links' | 'unten' | 'oben' } {
  // Ohne echte Fenstergröße wird GAR NICHT geklemmt: Ein geratener Rand ist
  // schlechter als keiner — er zöge die Blase an einen Rand, den es nicht gibt.
  const bekannt = fenster.breite > 0 && fenster.hoehe > 0
  const breite = fenster.breite
  const hoehe = fenster.hoehe
  const klemme = (wert: number, max: number): number =>
    bekannt ? Math.min(Math.max(luft, wert), Math.max(luft, max)) : wert

  const linksX = griff.left - blase.width - luft
  if (linksX >= luft) {
    const mitte = griff.top + griff.height / 2 - blase.height / 2
    return { x: linksX, y: klemme(mitte, hoehe - blase.height - luft), seite: 'links' }
  }
  const untenY = griff.top + griff.height + luft
  const passtUnten = !bekannt || untenY + blase.height <= hoehe - luft
  return {
    x: klemme(griff.left + griff.width / 2 - blase.width / 2, breite - blase.width - luft),
    y: passtUnten ? untenY : Math.max(luft, griff.top - blase.height - luft),
    seite: passtUnten ? 'unten' : 'oben',
  }
}

function zeige(griff: HTMLElement, text: string): void {
  const el = baueBlase()
  el.textContent = text
  el.hidden = false
  offenerGriff = griff
  griff.setAttribute('aria-describedby', el.id)
  griff.setAttribute('aria-expanded', 'true')

  const lage = lageFuer(griff.getBoundingClientRect(), el.getBoundingClientRect(), {
    breite: window.innerWidth || document.documentElement.clientWidth,
    hoehe: window.innerHeight || document.documentElement.clientHeight,
  })
  el.style.left = `${Math.round(lage.x)}px`
  el.style.top = `${Math.round(lage.y)}px`
  el.dataset.seite = lage.seite
}

/**
 * Hängt die Tipps unter `wurzel` ein: jeder `[data-tipp]` bekommt Zeigen und
 * Verbergen. Mehrfach aufrufbar (der Editor baut Panels neu auf) — verdrahtete
 * Griffe merkt sich ein Datenattribut.
 */
export function verdrahteTipps(wurzel: ParentNode = document): void {
  verdrahteGlobal()
  for (const griff of wurzel.querySelectorAll<HTMLElement>('[data-tipp]')) {
    if (griff.dataset.tippBereit === '1') continue
    griff.dataset.tippBereit = '1'
    const text = griff.dataset.tipp ?? ''
    if (!griff.hasAttribute('title')) griff.title = text
    griff.setAttribute('aria-expanded', 'false')
    griff.addEventListener('pointerenter', () => zeige(griff, text))
    griff.addEventListener('pointerleave', () => {
      if (offenerGriff === griff && document.activeElement !== griff) schliesse()
    })
    griff.addEventListener('focus', () => zeige(griff, text))
    griff.addEventListener('blur', () => {
      if (offenerGriff === griff) schliesse()
    })
    // Touch: Der Zeiger bleibt nach dem Tippen „drin", ein zweiter Tipp schließt.
    griff.addEventListener('click', (e) => {
      e.preventDefault()
      if (offenerGriff === griff) schliesse()
      else zeige(griff, text)
    })
  }
}

/**
 * Escape schließt, egal wo der Fokus steht — und ein Scroll ebenfalls: Die Lage
 * ist einmal berechnet, mitgeführt würde sie eine Rechnung pro Frame kosten.
 *
 * Beim ersten `verdrahteTipps` und nicht beim Import: Ein Modul, das schon beim
 * Laden am `document` hängt, ist ohne Browser nicht einmal importierbar — und
 * die Lage-Rechnung darüber damit nicht prüfbar.
 */
let globalVerdrahtet = false
function verdrahteGlobal(): void {
  if (globalVerdrahtet) return
  globalVerdrahtet = true
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') schliesse()
  })
  window.addEventListener('scroll', schliesse, true)
}
