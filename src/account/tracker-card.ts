// Die Karte „Verbundene Dienste" auf der Kontoseite.
//
// Sie ist die erste Oberfläche für die Tracker-Anbindung: verbinden, trennen,
// sehen was ankam. Die rechnenden Teile (Sätze, Ton, Daten) liegen DOM-frei in
// [tracker-model.ts](tracker-model.ts) — hier steht nur, was Knoten baut.

import { openDialogLayer } from '../dialog-layer.js'
import { tourPath } from '../routes.js'
import {
  providerButtonLabel,
  providerSentence,
  formatDateTime,
  importSentence,
  importTitle,
  importTone,
  lastArrivalSentence,
  returnText,
  type ProviderState,
  type ImportEntry,
} from './tracker-model.js'

const $ = (id: string): HTMLElement | null => document.getElementById(id)

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

/**
 * `#tracker=…` aus der Adresszeile lesen und sofort räumen.
 *
 * Der Hash kommt von der Rückkehr-Route des Servers. Bliebe er stehen, meldete
 * ein Neuladen dieselbe Nachricht ein zweites Mal — und „Verbunden." nach
 * einem Neuladen, bei dem nichts verbunden wurde, ist schlicht falsch.
 */
export function redeemTrackerReturn(): string | null {
  const hit = /^#tracker=([a-z]+)$/.exec(window.location.hash)
  if (!hit?.[1]) return null
  window.history.replaceState(null, '', window.location.pathname)
  return returnText(hit[1])
}

function providerRow(
  a: ProviderState,
  imports: readonly ImportEntry[],
  onClick: (a: ProviderState) => void,
): HTMLElement {
  // Ein Anbieter, den dieser Server nicht anbietet, tritt zurück — dieselbe
  // Sprache wie eine Zeile, deren Schalter auf etwas wartet.
  const row = el('div', a.available ? 'row' : 'row idle')
  const z = el('span', 'z')
  z.appendChild(el('span', 't', a.name))
  z.appendChild(el('span', 'b', providerSentence(a)))
  const arrival = lastArrivalSentence(imports)
  if (arrival) z.appendChild(el('span', 'b', arrival))
  row.appendChild(z)

  // Der Verlauf hängt am DIENST, nicht in einem eigenen Abschnitt darunter:
  // Die Frage „was ist von Polar angekommen?" stellt man bei Polar. Der Knopf
  // erscheint nur, wenn es etwas zu zeigen gibt — ein Symbol, das einen leeren
  // Dialog öffnet, ist eine Zusage ohne Inhalt.
  if (imports.length) {
    const history = el('button', 'button subtle')
    // Ein SVG und kein Emoji: Die Seite zeichnet ihre Symbole (`.sym svg`)
    // durchgehend als Strichgrafik in der Textfarbe — ein Emoji brächte eine
    // fremde Schrift, eine eigene Farbe und auf jedem System ein anderes Bild.
    history.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<circle cx="12" cy="12" r="9" /><path d="M12 7.5V12l3 1.8" /></svg>'
    history.type = 'button'
    history.title = `Verlauf von ${a.name} ansehen`
    history.setAttribute('aria-label', `Verlauf von ${a.name} ansehen`)
    history.addEventListener('click', () => showHistory(a, imports))
    row.appendChild(history)
  }

  const button = providerButtonLabel(a)
  if (button) {
    const b = el('button', button.tone === 'danger' ? 'button danger' : 'button', button.text)
    b.type = 'button'
    // Trennen ist unumkehrbar: Die Berechtigung beim Anbieter ist danach
    // widerrufen und das Abruf-Protokoll gelöscht (die Zusage aus dem
    // Datenschutz). Deshalb fragt der Knopf einmal nach — in der Sprache der
    // Seite, wie im Studio, statt mit einem confirm()-Kasten. Die Beruhigung
    // („die Touren bleiben") gehört VOR den Klick, nicht danach.
    if (button.tone === 'danger') {
      const spacer = button.text
      let clock: number | null = null
      b.addEventListener('click', () => {
        if (b.dataset['scharf']) {
          if (clock) window.clearTimeout(clock)
          b.disabled = true
          onClick(a)
          return
        }
        b.dataset['scharf'] = '1'
        b.textContent = 'Wirklich trennen?'
        b.title = `Der Zugang zu ${a.name} wird widerrufen. Deine bereits importierten Touren bleiben.`
        clock = window.setTimeout(() => {
          delete b.dataset['scharf']
          b.textContent = spacer
          b.title = ''
        }, 6000)
      })
    } else {
      b.addEventListener('click', () => {
        b.disabled = true
        onClick(a)
      })
    }
    row.appendChild(b)
  }
  return row
}

/**
 * Eine Zeile des Verlaufs.
 *
 * **Wo eine Tour daraus wurde, IST die Zeile der Weg dorthin** — ein Verlauf,
 * der eine angekommene Fahrt nennt und sie nicht öffnen lässt, schickt zum
 * Suchen in die Bibliothek. Ein `<a>` und kein Klick-Handler, damit
 * Mittelklick und „in neuem Tab öffnen" tun, was jeder erwartet. Verlinkt wird
 * nur eine SPIELBEREITE Tour: Wer auf eine halb gerenderte klickt, landet auf
 * einer Seite, die nichts zeigt.
 */
function importRow(i: ImportEntry): HTMLElement {
  const playable = i.tourId && i.tour?.status === 'ready'
  const row = el(playable ? 'a' : 'div', playable ? 'row klickbar' : 'row')
  if (playable && i.tourId) (row as HTMLAnchorElement).href = tourPath(i.tourId)
  row.appendChild(el('span', `punkt ${importTone(i)}`))
  const z = el('span', 'z')
  const title = importTitle(i)
  // Ohne Tour rückt der Satz nach oben, statt unter einer Wiederholung des
  // Dienstnamens zu stehen: Jede Zeile hat eine Hauptaussage, und bei einer
  // übersprungenen Einheit IST der Grund die Hauptaussage.
  if (title) {
    z.appendChild(el('span', 't', title))
    z.appendChild(el('span', 'b', importSentence(i)))
  } else {
    z.appendChild(el('span', 't', importSentence(i)))
  }
  row.appendChild(z)
  // Der Zeitpunkt der ANKUNFT, nicht der Meldung: Bei einem Import, der
  // dreimal anlief, ist die erste Meldung nicht der Moment, in dem die Tour da
  // war.
  row.appendChild(el('span', 'when', formatDateTime(i.finishedAt ?? i.reportedAt)))
  return row
}

/**
 * Der vollständige Verlauf eines Dienstes.
 *
 * Vollständig und nicht „die letzten zehn": Der frühere Abschnitt schnitt bei
 * zehn ab und schrieb „… und 12 weitere" — eine Auskunft darüber, dass es mehr
 * gibt, ohne einen Weg dorthin. In einem Dialog, der scrollt, kostet die
 * ganze Liste nichts.
 */
function showHistory(a: ProviderState, imports: readonly ImportEntry[]): void {
  const dialog = openDialogLayer(`Verlauf · ${a.name}`)
  const panel = el('div', 'card history')
  panel.replaceChildren(...imports.map((i) => importRow(i)))
  dialog.body.appendChild(panel)
  const close = el('button', 'button', 'Schließen')
  close.type = 'button'
  close.addEventListener('click', dialog.close)
  dialog.footer.appendChild(close)
}

/**
 * Karte aufbauen und laden.
 *
 * `melde` ist die Toast-Funktion der Kontoseite — sie wird hereingereicht,
 * statt sie zu importieren: Die Karte soll nichts über den Rest der Seite
 * wissen müssen.
 */
export async function loadTracker(notify: (text: string) => void): Promise<void> {
  const block = $('tracker-block')
  const panel = $('tracker')
  if (!block || !panel) return

  let provider: ProviderState[] = []
  try {
    const response = await fetch('/api/tracker/providers')
    if (!response.ok) throw new Error(String(response.status))
    provider = ((await response.json()) as { provider: ProviderState[] }).provider
  } catch {
    // Kein Hinweis-Kasten: Ein Dienst, den es vielleicht gar nicht gibt, soll
    // die Kontoseite nicht mit einer Fehlermeldung beginnen lassen.
    return
  }
  // Nichts registriert: Der ganze Block bleibt aus. Eine Überschrift über
  // einer leeren Tafel wäre eine Auskunft über nichts.
  if (!provider.length) return
  block.hidden = false

  const connect = async (a: ProviderState): Promise<void> => {
    try {
      const response = await fetch(`/api/tracker/${encodeURIComponent(a.id)}/connect`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ target: 'web' }),
      })
      if (!response.ok) throw new Error(String(response.status))
      const { authorizationUrl } = (await response.json()) as { authorizationUrl: string }
      // Kein neues Fenster: Der Weg führt über den Anbieter zurück auf genau
      // diese Seite (`/konto#tracker=…`) — ein zweiter Tab hätte danach keinen
      // Weg zurück, nur ein Schließkreuz.
      window.location.href = authorizationUrl
    } catch {
      notify(`${a.name} ließ sich gerade nicht verbinden.`)
      void loadTracker(notify)
    }
  }

  const divider = async (a: ProviderState): Promise<void> => {
    const response = await fetch(`/api/tracker/${encodeURIComponent(a.id)}`, {
      method: 'DELETE',
    }).catch(() => null)
    if (!response?.ok) {
      notify(`${a.name} ließ sich nicht trennen.`)
      void loadTracker(notify)
      return
    }
    // Die Zusage gehört in die Rückmeldung, nicht ins Kleingedruckte: Wer
    // trennt, fragt sich als Erstes, ob seine Touren mitgehen.
    notify(`${a.name} getrennt. Deine bereits importierten Touren bleiben erhalten.`)
    void loadTracker(notify)
  }

  // Der Verlauf wird VOR den Zeilen geholt, weil jede ihren letzten Stand
  // nennt. Fällt er aus, bleibt die Karte trotzdem bedienbar — verbinden und
  // trennen hängen nicht daran.
  const imports = await loadImports()

  panel.replaceChildren(
    ...provider.map((a) =>
      providerRow(
        a,
        imports.filter((i) => i.provider === a.id),
        (target) => {
          if (target.connected && target.status !== 'expired') void divider(target)
          else void connect(target)
        },
      ),
    ),
  )
}

/** Der Verlauf aller Dienste — die Karte teilt ihn selbst auf. */
async function loadImports(): Promise<ImportEntry[]> {
  try {
    const response = await fetch('/api/tracker/imports')
    if (!response.ok) throw new Error(String(response.status))
    return ((await response.json()) as { imports: ImportEntry[] }).imports
  } catch {
    return []
  }
}
