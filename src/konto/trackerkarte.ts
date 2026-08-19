// Die Karte „Verbundene Dienste" auf der Kontoseite.
//
// Sie ist die erste Oberfläche für die Tracker-Anbindung: verbinden, trennen,
// sehen was ankam. Die rechnenden Teile (Sätze, Ton, Daten) liegen DOM-frei in
// [trackermodell.ts](trackermodell.ts) — hier steht nur, was Knoten baut.

import { oeffneSchicht } from '../dialogschicht.js'
import { tourPfad } from '../routen.js'
import {
  anbieterKnopf,
  anbieterSatz,
  datumMitZeit,
  importSatz,
  importTitel,
  importTon,
  letzterAnkunftsSatz,
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
  importe: readonly ImportStand[],
  beiKlick: (a: AnbieterStand) => void,
): HTMLElement {
  // Ein Anbieter, den dieser Server nicht anbietet, tritt zurück — dieselbe
  // Sprache wie eine Zeile, deren Schalter auf etwas wartet.
  const zeile = el('div', a.verfuegbar ? 'zeile' : 'zeile ruht')
  const z = el('span', 'z')
  z.appendChild(el('span', 't', a.name))
  z.appendChild(el('span', 'b', anbieterSatz(a)))
  const ankunft = letzterAnkunftsSatz(importe)
  if (ankunft) z.appendChild(el('span', 'b', ankunft))
  zeile.appendChild(z)

  // Der Verlauf hängt am DIENST, nicht in einem eigenen Abschnitt darunter:
  // Die Frage „was ist von Polar angekommen?" stellt man bei Polar. Der Knopf
  // erscheint nur, wenn es etwas zu zeigen gibt — ein Symbol, das einen leeren
  // Dialog öffnet, ist eine Zusage ohne Inhalt.
  if (importe.length) {
    const verlauf = el('button', 'knopf still')
    // Ein SVG und kein Emoji: Die Seite zeichnet ihre Symbole (`.sym svg`)
    // durchgehend als Strichgrafik in der Textfarbe — ein Emoji brächte eine
    // fremde Schrift, eine eigene Farbe und auf jedem System ein anderes Bild.
    verlauf.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<circle cx="12" cy="12" r="9" /><path d="M12 7.5V12l3 1.8" /></svg>'
    verlauf.type = 'button'
    verlauf.title = `Verlauf von ${a.name} ansehen`
    verlauf.setAttribute('aria-label', `Verlauf von ${a.name} ansehen`)
    verlauf.addEventListener('click', () => zeigeVerlauf(a, importe))
    zeile.appendChild(verlauf)
  }

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
function importZeile(i: ImportStand): HTMLElement {
  const spielbar = i.tourId && i.tour?.status === 'bereit'
  const zeile = el(spielbar ? 'a' : 'div', spielbar ? 'zeile klickbar' : 'zeile')
  if (spielbar && i.tourId) (zeile as HTMLAnchorElement).href = tourPfad(i.tourId)
  zeile.appendChild(el('span', `punkt ${importTon(i)}`))
  const z = el('span', 'z')
  const titel = importTitel(i)
  // Ohne Tour rückt der Satz nach oben, statt unter einer Wiederholung des
  // Dienstnamens zu stehen: Jede Zeile hat eine Hauptaussage, und bei einer
  // übersprungenen Einheit IST der Grund die Hauptaussage.
  if (titel) {
    z.appendChild(el('span', 't', titel))
    z.appendChild(el('span', 'b', importSatz(i)))
  } else {
    z.appendChild(el('span', 't', importSatz(i)))
  }
  zeile.appendChild(z)
  // Der Zeitpunkt der ANKUNFT, nicht der Meldung: Bei einem Import, der
  // dreimal anlief, ist die erste Meldung nicht der Moment, in dem die Tour da
  // war.
  zeile.appendChild(el('span', 'wann', datumMitZeit(i.fertigAm ?? i.gemeldetAm)))
  return zeile
}

/**
 * Der vollständige Verlauf eines Dienstes.
 *
 * Vollständig und nicht „die letzten zehn": Der frühere Abschnitt schnitt bei
 * zehn ab und schrieb „… und 12 weitere" — eine Auskunft darüber, dass es mehr
 * gibt, ohne einen Weg dorthin. In einem Dialog, der scrollt, kostet die
 * ganze Liste nichts.
 */
function zeigeVerlauf(a: AnbieterStand, importe: readonly ImportStand[]): void {
  const dialog = oeffneSchicht(`Verlauf · ${a.name}`)
  const tafel = el('div', 'tafel verlauf')
  tafel.replaceChildren(...importe.map((i) => importZeile(i)))
  dialog.koerper.appendChild(tafel)
  const schliessen = el('button', 'knopf', 'Schließen')
  schliessen.type = 'button'
  schliessen.addEventListener('click', dialog.schliesse)
  dialog.fuss.appendChild(schliessen)
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
    const antwort = await fetch(`/api/tracker/${encodeURIComponent(a.id)}`, {
      method: 'DELETE',
    }).catch(() => null)
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

  // Der Verlauf wird VOR den Zeilen geholt, weil jede ihren letzten Stand
  // nennt. Fällt er aus, bleibt die Karte trotzdem bedienbar — verbinden und
  // trennen hängen nicht daran.
  const importe = await ladeImporte()

  tafel.replaceChildren(
    ...anbieter.map((a) =>
      anbieterZeile(
        a,
        importe.filter((i) => i.anbieter === a.id),
        (ziel) => {
          if (ziel.verbunden && ziel.status !== 'abgelaufen') void trenne(ziel)
          else void verbinde(ziel)
        },
      ),
    ),
  )
}

/** Der Verlauf aller Dienste — die Karte teilt ihn selbst auf. */
async function ladeImporte(): Promise<ImportStand[]> {
  try {
    const antwort = await fetch('/api/tracker/imports')
    if (!antwort.ok) throw new Error(String(antwort.status))
    return ((await antwort.json()) as { importe: ImportStand[] }).importe
  } catch {
    return []
  }
}
