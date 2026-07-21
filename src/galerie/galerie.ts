// Hülle der öffentlichen Seiten: holt die Daten und hängt die Karten in den
// DOM. Alles, was entschieden werden muss, steht in galeriemodell.ts.
import { alsKarte, idAusAdresse, profilKopf, type GalerieAntwort, type Karte, type ProfilAntwort } from './galeriemodell'

const SEITE = 24

/**
 * Eine Karte besteht aus ZWEI Geschwistern, nicht aus einem Link mit einem
 * zweiten darin: Der Tour-Link umfasst Bild und Titel, die Urheber-Zeile steht
 * daneben. Ein Link im Link ist ungültiges HTML — Browser brechen den äußeren
 * dort auf, und welcher Klick wohin führt, wird zur Glückssache.
 */
function karteElement(karte: Karte, mitAutor = true): HTMLElement {
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

  if (mitAutor && karte.autorName) karten.appendChild(autorZeile(karte))
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
      const antwort = await fetch(`/api/galerie?limit=${SEITE}&offset=${offset}`)
      if (!antwort.ok) throw new Error(String(antwort.status))
      const daten = (await antwort.json()) as GalerieAntwort
      if (offset === 0 && daten.touren.length === 0) {
        zeigeFehler(gitter!, 'Hier ist noch nichts zu sehen. Die erste öffentliche Reise fehlt noch.')
        mehrKnopf!.hidden = true
        return
      }
      for (const tour of daten.touren) gitter!.appendChild(karteElement(alsKarte(tour)))
      offset += daten.touren.length
      mehrKnopf!.hidden = !daten.mehr
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

/** Profilseite: Kopf + die öffentlichen Touren dieser Person. */
export async function starteProfil(): Promise<void> {
  const kopf = document.getElementById('kopf')
  const gitter = document.getElementById('gitter')
  if (!kopf || !gitter) return

  const id = idAusAdresse(window.location.search)
  if (!id) {
    zeigeFehler(kopf, 'Kein Profil angegeben.')
    return
  }

  try {
    const antwort = await fetch(`/api/benutzer/${encodeURIComponent(id)}/profil`)
    if (antwort.status === 404) {
      zeigeFehler(kopf, 'Dieses Profil gibt es nicht (mehr).')
      return
    }
    if (!antwort.ok) throw new Error(String(antwort.status))
    const daten = (await antwort.json()) as ProfilAntwort
    const { name, bio, bild } = profilKopf(daten)
    document.title = `${name} · Luhambo`

    if (bild) {
      const img = document.createElement('img')
      img.className = 'profil-bild'
      img.src = bild
      img.alt = ''
      kopf.appendChild(img)
    }
    const h1 = document.createElement('h1')
    h1.textContent = name
    kopf.appendChild(h1)
    if (bio) {
      const p = document.createElement('p')
      p.className = 'profil-bio'
      p.textContent = bio
      kopf.appendChild(p)
    }

    if (daten.touren.length === 0) {
      zeigeFehler(gitter, 'Noch keine öffentlichen Reisen.')
      return
    }
    // Ohne Urheber-Zeile: der Name steht schon im Kopf der Seite
    for (const tour of daten.touren) gitter.appendChild(karteElement(alsKarte(tour), false))
  } catch {
    zeigeFehler(kopf, 'Das Profil ließ sich gerade nicht laden.')
  }
}
