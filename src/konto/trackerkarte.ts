// Die Karte „Verbundene Dienste" auf der Kontoseite.
//
// Sie ist die erste Oberfläche für die Tracker-Anbindung: verbinden, trennen,
// sehen was ankam. Die rechnenden Teile (Sätze, Ton, Daten) liegen DOM-frei in
// [trackermodell.ts](trackermodell.ts) — hier steht nur, was Knoten baut.

import {
  anbieterKnopf,
  anbieterSatz,
  datumMitZeit,
  importSatz,
  importTon,
  rueckkehrText,
  type AnbieterStand,
  type ImportStand,
} from './trackermodell.js'

const $ = (id: string): HTMLElement | null => document.getElementById(id)

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

/**
 * `#tracker=…` aus der Adresszeile lesen und sofort räumen.
 *
 * Der Hash kommt von der Rückkehr-Route des Servers. Bliebe er stehen, meldete
 * ein Neuladen dieselbe Nachricht ein zweites Mal — und „Verbunden." nach
 * einem Neuladen, bei dem nichts verbunden wurde, ist schlicht falsch.
 */
export function loeseTrackerRueckkehrEin(): string | null {
  const treffer = /^#tracker=([a-z]+)$/.exec(window.location.hash)
  if (!treffer?.[1]) return null
  window.history.replaceState(null, '', window.location.pathname)
  return rueckkehrText(treffer[1])
}

function anbieterZeile(
  a: AnbieterStand,
  beiKlick: (a: AnbieterStand) => void,
): HTMLElement {
  // Ein Anbieter, den dieser Server nicht anbietet, tritt zurück — dieselbe
  // Sprache wie eine Zeile, deren Schalter auf etwas wartet.
  const zeile = el('div', a.verfuegbar ? 'zeile' : 'zeile ruht')
  const z = el('span', 'z')
  z.appendChild(el('span', 't', a.name))
  z.appendChild(el('span', 'b', anbieterSatz(a)))
  zeile.appendChild(z)

  const knopf = anbieterKnopf(a)
  if (knopf) {
    const b = el('button', knopf.art === 'gefahr' ? 'knopf gefahr' : 'knopf', knopf.text)
    b.type = 'button'
    // Trennen ist unumkehrbar: Die Berechtigung beim Anbieter ist danach
    // widerrufen und das Abruf-Protokoll gelöscht (die Zusage aus dem
    // Datenschutz). Deshalb fragt der Knopf einmal nach — in der Sprache der
    // Seite, wie im Studio, statt mit einem confirm()-Kasten. Die Beruhigung
    // („die Touren bleiben") gehört VOR den Klick, nicht danach.
    if (knopf.art === 'gefahr') {
      const ruhe = knopf.text
      let uhr: number | null = null
      b.addEventListener('click', () => {
        if (b.dataset['scharf']) {
          if (uhr) window.clearTimeout(uhr)
          b.disabled = true
          beiKlick(a)
          return
        }
        b.dataset['scharf'] = '1'
        b.textContent = 'Wirklich trennen?'
        b.title = `Der Zugang zu ${a.name} wird widerrufen. Deine bereits importierten Touren bleiben.`
        uhr = window.setTimeout(() => {
          delete b.dataset['scharf']
          b.textContent = ruhe
          b.title = ''
        }, 6000)
      })
    } else {
      b.addEventListener('click', () => {
        b.disabled = true
        beiKlick(a)
      })
    }
    zeile.appendChild(b)
  }
  return zeile
}

function importZeile(i: ImportStand): HTMLElement {
  const zeile = el('div', 'zeile')
  zeile.appendChild(el('span', `punkt ${importTon(i)}`))
  const z = el('span', 'z')
  z.appendChild(el('span', 't', importSatz(i)))
  zeile.appendChild(z)
  zeile.appendChild(el('span', 'wann', datumMitZeit(i.gemeldetAm)))
  return zeile
}

function zeileMitText(text: string): HTMLElement {
  const zeile = el('div', 'zeile')
  const z = el('span', 'z')
  z.appendChild(el('span', 'b', text))
  zeile.appendChild(z)
  return zeile
}

/**
 * Karte aufbauen und laden.
 *
 * `melde` ist die Toast-Funktion der Kontoseite — sie wird hereingereicht,
 * statt sie zu importieren: Die Karte soll nichts über den Rest der Seite
 * wissen müssen.
 */
export async function ladeTracker(melde: (text: string) => void): Promise<void> {
  const block = $('tracker-block')
  const tafel = $('tracker')
  if (!block || !tafel) return

  let anbieter: AnbieterStand[] = []
  try {
    const antwort = await fetch('/api/tracker/providers')
    if (!antwort.ok) throw new Error(String(antwort.status))
    anbieter = ((await antwort.json()) as { anbieter: AnbieterStand[] }).anbieter
  } catch {
    // Kein Hinweis-Kasten: Ein Dienst, den es vielleicht gar nicht gibt, soll
    // die Kontoseite nicht mit einer Fehlermeldung beginnen lassen.
    return
  }
  // Nichts registriert: Der ganze Block bleibt aus. Eine Überschrift über
  // einer leeren Tafel wäre eine Auskunft über nichts.
  if (!anbieter.length) return
  block.hidden = false

  const verbinde = async (a: AnbieterStand): Promise<void> => {
    try {
      const antwort = await fetch(`/api/tracker/${encodeURIComponent(a.id)}/connect`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ziel: 'web' }),
      })
      if (!antwort.ok) throw new Error(String(antwort.status))
      const { autorisierungsUrl } = (await antwort.json()) as { autorisierungsUrl: string }
      // Kein neues Fenster: Der Weg führt über den Anbieter zurück auf genau
      // diese Seite (`/konto#tracker=…`) — ein zweiter Tab hätte danach keinen
      // Weg zurück, nur ein Schließkreuz.
      window.location.href = autorisierungsUrl
    } catch {
      melde(`${a.name} ließ sich gerade nicht verbinden.`)
      void ladeTracker(melde)
    }
  }

  const trenne = async (a: AnbieterStand): Promise<void> => {
    const antwort = await fetch(`/api/tracker/${encodeURIComponent(a.id)}`, { method: 'DELETE' }).catch(() => null)
    if (!antwort?.ok) {
      melde(`${a.name} ließ sich nicht trennen.`)
      void ladeTracker(melde)
      return
    }
    // Die Zusage gehört in die Rückmeldung, nicht ins Kleingedruckte: Wer
    // trennt, fragt sich als Erstes, ob seine Touren mitgehen.
    melde(`${a.name} getrennt. Deine bereits importierten Touren bleiben erhalten.`)
    void ladeTracker(melde)
  }

  tafel.replaceChildren(
    ...anbieter.map((a) =>
      anbieterZeile(a, (ziel) => {
        if (ziel.verbunden && ziel.status !== 'abgelaufen') void trenne(ziel)
        else void verbinde(ziel)
      }),
    ),
  )

  await ladeImporte()
}

/** Die Chronik unter den Anbietern — nur, wenn es etwas zu erzählen gibt. */
async function ladeImporte(): Promise<void> {
  const kasten = $('tracker-importe')
  const liste = $('tracker-importliste')
  if (!kasten || !liste) return
  let importe: ImportStand[] = []
  try {
    const antwort = await fetch('/api/tracker/imports')
    if (!antwort.ok) throw new Error(String(antwort.status))
    importe = ((await antwort.json()) as { importe: ImportStand[] }).importe
  } catch {
    kasten.hidden = true
    return
  }
  if (!importe.length) {
    kasten.hidden = true
    return
  }
  kasten.hidden = false
  // Die letzten zehn genügen: Die Liste beantwortet „kam meine Fahrt an?",
  // nicht „was lief in den letzten Monaten?".
  const gezeigt = importe.slice(0, 10)
  liste.replaceChildren(...gezeigt.map(importZeile))
  if (importe.length > gezeigt.length) {
    liste.appendChild(zeileMitText(`… und ${importe.length - gezeigt.length} weitere`))
  }
}
