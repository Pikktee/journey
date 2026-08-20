// Hülle der Galerie: holt die Daten und hängt die Karten in den DOM. Alles, was
// entschieden werden muss, steht in galeriemodell.ts.
//
// Die Profilseite hatte hier lange ihren zweiten Einstieg — sie hat seit
// Etappe 2 ihre eigene Hülle (src/profil/), weil sie inzwischen mehr ist als
// dieselben Karten unter einer Überschrift: Titelbild, Kennzahlen, Bearbeiten.
// Geblieben ist die gemeinsame Quelle der Kartendaten (galeriemodell.ts).
import { alsKarte, type GalerieAntwort, type Karte } from './galeriemodell'

const SEITE = 24

/**
 * Eine Karte besteht aus ZWEI Geschwistern, nicht aus einem Link mit einem
 * zweiten darin: Der Tour-Link umfasst Bild und Titel, die Urheber-Zeile steht
 * daneben. Ein Link im Link ist ungültiges HTML — Browser brechen den äußeren
 * dort auf, und welcher Klick wohin führt, wird zur Glückssache.
 */
function karteElement(karte: Karte): HTMLElement {
  const karten = document.createElement('article')
  karten.className = 'karte'

  const a = document.createElement('a')
  a.className = 'karte-haupt'
  a.href = karte.spielLink

  const bild = document.createElement('div')
  bild.className = 'karte-bild'
  if (karte.cover) {
    const img = document.createElement('img')
    img.src = karte.cover
    img.alt = ''
    img.loading = 'lazy'
    bild.appendChild(img)
  }
  a.appendChild(bild)

  const text = document.createElement('div')
  text.className = 'karte-text'
  const h3 = document.createElement('h3')
  h3.textContent = karte.titel
  text.appendChild(h3)
  if (karte.unterzeile) {
    const meta = document.createElement('p')
    meta.className = 'karte-meta'
    meta.textContent = karte.unterzeile
    text.appendChild(meta)
  }
  a.appendChild(text)
  karten.appendChild(a)

  if (karte.autorName) karten.appendChild(autorZeile(karte))
  return karten
}

/** Urheber-Zeile am Fuß der Karte; verlinkt nur bei öffentlicher Profilseite. */
function autorZeile(karte: Karte): HTMLElement {
  const zeile = document.createElement(karte.autorLink ? 'a' : 'div')
  zeile.className = 'karte-autor'
  if (karte.autorLink && zeile instanceof HTMLAnchorElement) zeile.href = karte.autorLink
  if (karte.autorBild) {
    const bild = document.createElement('img')
    bild.src = karte.autorBild
    bild.alt = ''
    bild.loading = 'lazy'
    zeile.appendChild(bild)
  }
  const name = document.createElement('span')
  name.textContent = karte.autorName ?? ''
  zeile.appendChild(name)
  return zeile
}

function zeigeFehler(ziel: HTMLElement, text: string): void {
  ziel.replaceChildren()
  const p = document.createElement('p')
  p.className = 'hinweis'
  p.textContent = text
  ziel.appendChild(p)
}

/** Galerie-Seite: Karten laden, „Mehr"-Knopf bedienen. */
export async function starteGalerie(): Promise<void> {
  const gitter = document.getElementById('gitter')
  const mehrKnopf = document.getElementById('mehr') as HTMLButtonElement | null
  if (!gitter || !mehrKnopf) return
  let offset = 0

  async function ladeSeite(): Promise<void> {
    mehrKnopf!.disabled = true
    try {
      const antwort = await fetch(`/api/gallery?limit=${SEITE}&offset=${offset}`)
      if (!antwort.ok) throw new Error(String(antwort.status))
      const daten = (await antwort.json()) as GalerieAntwort
      if (offset === 0 && daten.tours.length === 0) {
        zeigeFehler(
          gitter!,
          'Hier ist noch nichts zu sehen. Die erste öffentliche Reise fehlt noch.',
        )
        mehrKnopf!.hidden = true
        return
      }
      for (const tour of daten.tours) gitter!.appendChild(karteElement(alsKarte(tour)))
      offset += daten.tours.length
      mehrKnopf!.hidden = !daten.hasMore
    } catch {
      zeigeFehler(gitter!, 'Die Galerie ließ sich gerade nicht laden.')
      mehrKnopf!.hidden = true
    } finally {
      mehrKnopf!.disabled = false
    }
  }

  mehrKnopf.addEventListener('click', () => void ladeSeite())
  await ladeSeite()
}
