// Hülle der Galerie: holt die Daten und hängt die Karten in den DOM. Alles, was
// entschieden werden muss, steht in gallery-model.ts.
//
// Die Profilseite hatte hier lange ihren zweiten Einstieg — sie hat seit
// Etappe 2 ihre eigene Hülle (src/profile/), weil sie inzwischen mehr ist als
// dieselben Karten unter einer Überschrift: Titelbild, Kennzahlen, Bearbeiten.
// Geblieben ist die gemeinsame Quelle der Kartendaten (gallery-model.ts).
import { toTourCard, type GalleryResponse, type TourCard } from './gallery-model'

const PAGE_SIZE = 24

/**
 * Eine Karte besteht aus ZWEI Geschwistern, nicht aus einem Link mit einem
 * zweiten darin: Der Tour-Link umfasst Bild und Titel, die Urheber-Zeile steht
 * daneben. Ein Link im Link ist ungültiges HTML — Browser brechen den äußeren
 * dort auf, und welcher Klick wohin führt, wird zur Glückssache.
 */
function cardElement(card: TourCard): HTMLElement {
  const article = document.createElement('article')
  article.className = 'card'

  const a = document.createElement('a')
  a.className = 'card-main'
  a.href = card.playLink

  const image = document.createElement('div')
  image.className = 'card-image'
  if (card.cover) {
    const img = document.createElement('img')
    img.src = card.cover
    img.alt = ''
    img.loading = 'lazy'
    image.appendChild(img)
  }
  a.appendChild(image)

  const text = document.createElement('div')
  text.className = 'card-text'
  const h3 = document.createElement('h3')
  h3.textContent = card.title
  text.appendChild(h3)
  if (card.subline) {
    const meta = document.createElement('p')
    meta.className = 'card-meta'
    meta.textContent = card.subline
    text.appendChild(meta)
  }
  a.appendChild(text)
  article.appendChild(a)

  if (card.authorName) article.appendChild(authorRow(card))
  return article
}

/** Urheber-Zeile am Fuß der Karte; verlinkt nur bei öffentlicher Profilseite. */
function authorRow(card: TourCard): HTMLElement {
  const row = document.createElement(card.authorLink ? 'a' : 'div')
  row.className = 'card-author'
  if (card.authorLink && row instanceof HTMLAnchorElement) row.href = card.authorLink
  if (card.authorImage) {
    const image = document.createElement('img')
    image.src = card.authorImage
    image.alt = ''
    image.loading = 'lazy'
    row.appendChild(image)
  }
  const name = document.createElement('span')
  name.textContent = card.authorName ?? ''
  row.appendChild(name)
  return row
}

function showError(target: HTMLElement, text: string): void {
  target.replaceChildren()
  const p = document.createElement('p')
  p.className = 'hint'
  p.textContent = text
  target.appendChild(p)
}

/** Galerie-Seite: Karten laden, „Mehr"-Knopf bedienen. */
export async function startGallery(): Promise<void> {
  const grid = document.getElementById('grid')
  const moreButton = document.getElementById('more') as HTMLButtonElement | null
  if (!grid || !moreButton) return
  let offset = 0

  async function loadPage(): Promise<void> {
    moreButton!.disabled = true
    try {
      const response = await fetch(`/api/gallery?limit=${PAGE_SIZE}&offset=${offset}`)
      if (!response.ok) throw new Error(String(response.status))
      const data = (await response.json()) as GalleryResponse
      if (offset === 0 && data.tours.length === 0) {
        showError(grid!, 'Hier ist noch nichts zu sehen. Die erste öffentliche Reise fehlt noch.')
        moreButton!.hidden = true
        return
      }
      for (const tour of data.tours) grid!.appendChild(cardElement(toTourCard(tour)))
      offset += data.tours.length
      moreButton!.hidden = !data.hasMore
    } catch {
      showError(grid!, 'Die Galerie ließ sich gerade nicht laden.')
      moreButton!.hidden = true
    } finally {
      moreButton!.disabled = false
    }
  }

  moreButton.addEventListener('click', () => void loadPage())
  await loadPage()
}
