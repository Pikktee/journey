// Hülle der Profilseite: holt die Daten und hängt sie in den DOM. Alles, was
// entschieden werden muss, steht in profile-model.ts.
//
// Die Seite ist zweierlei: die öffentliche Visitenkarte einer Person und — für
// genau eine Person — die Stelle, an der sie sie bearbeitet. Das Bearbeiten
// wird deshalb NACHGELADEN (`import()` unten): Der Dialog samt Handle-Prüfung
// und Bildwahl ist der größere Teil des Codes und interessiert niemanden, der
// hier nur jemandem beim Reisen zusieht.

import { toTourCard, handleOrIdFromUrl, type GalleryTour } from '../gallery/gallery-model.js'
import { profilePath } from '../routes.js'
import { defaultBanner, bannerPath } from './profile-banners.js'
import {
  avatarInitial,
  isOwn,
  statChips,
  linkChips,
  profileHeading,
  type ProfileResponse,
} from './profile-model.js'

const SVG_NS = 'http://www.w3.org/2000/svg'

/** Die Zeichen der Oberfläche — Pfaddaten, damit sie nicht als Markup im HTML stehen. */
const ICONS: Record<string, string> = {
  tours: 'M4 17l4-10 4 6 3-4 5 8|M8 7a1.4 1.4 0 100-.01|M19 17a1.4 1.4 0 100-.01',
  km: 'M5 17.5c3.5 0 3-8 7-8s3.5 5 7 5',
  elevation: 'M2.5 19l6-9 3.5 4.5 3-4 6.5 8.5z|M8.5 10L11 6.5',
  location:
    'M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11z|M12 12.6a2.6 2.6 0 100-5.2 2.6 2.6 0 000 5.2z',
  web: 'M20.5 12a8.5 8.5 0 11-17 0 8.5 8.5 0 0117 0z|M3.5 12h17|M12 3.5c2.6 2.7 2.6 14.3 0 17-2.6-2.7-2.6-14.3 0-17z',
  instagram:
    'M8.6 4h6.8A4.6 4.6 0 0120 8.6v6.8a4.6 4.6 0 01-4.6 4.6H8.6A4.6 4.6 0 014 15.4V8.6A4.6 4.6 0 018.6 4z|M15.6 12a3.6 3.6 0 11-7.2 0 3.6 3.6 0 017.2 0z|M17.4 7.1a.9.9 0 11-1.8 0 .9.9 0 011.8 0z',
  private: 'M6.25 10.5h11.5v10h-11.5z|M8.5 10.5V8a3.5 3.5 0 017 0v2.5',
  pencil: 'M4 20h4l10-10-4-4L4 16z|M13.5 6.5l4 4',
  image:
    'M5.5 4.5h13a2 2 0 012 2v11a2 2 0 01-2 2h-13a2 2 0 01-2-2v-11a2 2 0 012-2z|M4 18l5-6 4 4.5 3-3.5 4 5|M17.1 8a1.6 1.6 0 11-3.2 0 1.6 1.6 0 013.2 0z',
  // Für den Titelbild-Dialog: Hochladen, Weiter-Pfeil, Kamera (Avatar-Überlage).
  upload:
    'M12 16.5V4.5|M7.4 9.1L12 4.5l4.6 4.6|M4 15.5v3A1.5 1.5 0 005.5 20h13a1.5 1.5 0 001.5-1.5v-3',
  arrow: 'M9 6l6 6-6 6',
  // Vor der Handle-Meldung: Haken, wenn die Adresse geht, Kreuz, wenn nicht.
  check: 'M20 6L9 17l-5-5',
  cross: 'M18 6L6 18M6 6l12 12',
  camera:
    'M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z|M16 13a4 4 0 11-8 0 4 4 0 018 0z',
  share:
    'M8.7 13.4l6.6 3.9|M15.3 6.7L8.7 10.6|M6.5 12a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z|M20.5 5.5a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z|M20.5 18.5a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z',
}

/** Ein Icon aus `ZEICHEN`; die Pfade sind mit `|` getrennt. */
export function render(kind: string): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '1.75')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  for (const d of (ICONS[kind] ?? '').split('|')) {
    const pathEl = document.createElementNS(SVG_NS, 'path')
    pathEl.setAttribute('d', d)
    svg.appendChild(pathEl)
  }
  return svg
}

const $ = (id: string): HTMLElement | null => document.getElementById(id)

function showError(target: HTMLElement, text: string): void {
  target.replaceChildren()
  const p = document.createElement('p')
  p.className = 'hint'
  p.textContent = text
  target.appendChild(p)
}

/**
 * Eine Tour-Kachel.
 *
 * Ohne Urheber-Zeile — der Name steht im Kopf der Seite. Das Bild sitzt als
 * `background-image` im Element und nicht als `<img>`: Es ist ein Ausschnitt in
 * fester Höhe, kein Bild mit eigenem Seitenverhältnis, und `background-size:
 * cover` erledigt genau das ohne zweite Box.
 */
function tourTile(tour: GalleryTour): HTMLElement {
  const card = toTourCard(tour)
  const a = document.createElement('a')
  a.className = 'tour'
  a.href = card.playLink

  const image = document.createElement('div')
  image.className = 'image'
  // Der Pfad kommt vom Server, wird aber über CSS.setProperty gesetzt statt in
  // einen style-String interpoliert: Ein Anführungszeichen im Dateinamen könnte
  // sonst aus der url() ausbrechen.
  if (card.cover) image.style.backgroundImage = `url("${card.cover.replace(/"/g, '%22')}")`
  a.appendChild(image)

  const txt = document.createElement('div')
  txt.className = 'txt'
  const titleEl = document.createElement('div')
  titleEl.className = 'title'
  titleEl.textContent = card.title
  txt.appendChild(titleEl)
  if (card.subline) {
    const meta = document.createElement('div')
    meta.className = 'meta'
    meta.textContent = card.subline
    txt.appendChild(meta)
  }
  a.appendChild(txt)
  return a
}

/** Der Kopf: Avatar, Name, Handle, Ort, Beitritt. */
function renderHead(profile: ProfileResponse): void {
  const head = profileHeading(profile)
  document.title = `${head.name} · Maptale`

  const avatar = $('avatar')
  if (avatar) {
    avatar.replaceChildren()
    if (head.image) {
      const img = document.createElement('img')
      img.src = head.image
      img.alt = ''
      avatar.appendChild(img)
    } else {
      avatar.textContent = avatarInitial(profile)
    }
  }

  const name = $('p-name')
  if (name) name.textContent = head.name

  const extras = $('profile-extras')
  if (extras) {
    extras.replaceChildren()
    if (head.handle) {
      const h = document.createElement('span')
      h.className = 'handle'
      h.textContent = head.handle
      extras.appendChild(h)
    }
    if (head.location) {
      const o = document.createElement('span')
      o.appendChild(render('location'))
      const t = document.createElement('span')
      t.textContent = head.location
      o.appendChild(t)
      extras.appendChild(o)
    }
    if (head.memberSince) {
      const d = document.createElement('span')
      d.textContent = head.memberSince
      extras.appendChild(d)
    }
  }

  const bio = $('p-bio')
  if (bio) {
    bio.textContent = head.bio ?? ''
    bio.hidden = !head.bio
  }
}

/**
 * Titelbild — das gewählte oder eines der mitgelieferten.
 *
 * Wer keines gewählt hat, bekommt trotzdem eins (`defaultBanner`): Die vier
 * Bilder liegen im Build, und ein leeres Banner ist keine Zurückhaltung,
 * sondern 230 px graue Fläche über fast jedem Profil. Die ruhige Fläche
 * (`.empty`) bleibt als Rückfall im CSS, falls das Bild nicht lädt.
 */
function renderBanner(profile: ProfileResponse): void {
  const banner = $('p-banner')
  if (!banner) return
  const image = profile.bannerUrl ?? bannerPath(defaultBanner(profile.handle))
  banner.style.backgroundImage = `url("${image.replace(/"/g, '%22')}")`
  banner.classList.remove('empty')
}

function renderLinks(profile: ProfileResponse): void {
  const target = $('profile-links')
  if (!target) return
  target.replaceChildren()
  for (const chip of linkChips(profile)) {
    const a = document.createElement('a')
    a.className = 'link-chip'
    a.href = chip.href
    // Fremde Ziele: kein Zugriff auf dieses Fenster, kein Referrer. `noopener`
    // ist bei target=_blank Pflicht, sonst kann die Zielseite hierher zurückgreifen.
    a.target = '_blank'
    a.rel = 'noopener noreferrer nofollow'
    a.appendChild(render(chip.kind))
    const span = document.createElement('span')
    span.textContent = chip.text
    a.appendChild(span)
    target.appendChild(a)
  }
}

function renderStats(profile: ProfileResponse): void {
  const target = $('profile-stats')
  if (!target) return
  target.replaceChildren()
  for (const chip of statChips(profile.stats)) {
    const span = document.createElement('span')
    span.className = 'stat'
    span.appendChild(render(chip.kind))
    const b = document.createElement('b')
    b.textContent = chip.value
    span.appendChild(b)
    span.appendChild(document.createTextNode(` ${chip.label}`))
    target.appendChild(span)
  }
}

/**
 * Teilen — mit dem System-Dialog, wo es ihn gibt, sonst in die Zwischenablage.
 *
 * Die Beschriftung richtet sich nach dem, was das Gerät kann: „Teilen" auf einem
 * Telefon, „Link kopieren" am Schreibtisch. Ein Knopf, der „Teilen" verspricht
 * und dann nur kopiert, ist ein gebrochenes Versprechen.
 */
function wireShare(profile: ProfileResponse): void {
  const button = $('btn-share') as HTMLButtonElement | null
  if (!button || !profile.handle) return
  const address = new URL(profilePath(profile.handle), window.location.origin).href
  const canShare = typeof navigator.share === 'function'
  const labelEl = $('share-text')
  if (labelEl) labelEl.textContent = canShare ? 'Teilen' : 'Link kopieren'
  button.hidden = false
  button.addEventListener('click', async () => {
    try {
      if (canShare) {
        await navigator.share({ url: address, title: document.title })
        return
      }
      await navigator.clipboard.writeText(address)
      const previous = labelEl?.textContent ?? ''
      if (labelEl) labelEl.textContent = 'Kopiert'
      window.setTimeout(() => {
        if (labelEl) labelEl.textContent = previous
      }, 1600)
    } catch {
      // Abgebrochener Teilen-Dialog und verweigerte Zwischenablage sehen gleich
      // aus und sind beide kein Fehler, den jemand gemeldet bekommen möchte.
    }
  })
}

/** Wer bin ich? Nur der Handle wird gebraucht — der Rest steht im Modal. */
async function ownHandle(): Promise<string | null> {
  try {
    const response = await fetch('/api/auth/me')
    if (!response.ok) return null
    const data = (await response.json()) as { profile?: { handle?: string | null } }
    return data.profile?.handle ?? null
  } catch {
    return null
  }
}

/** Profilseite: Kopf, Kennzahlen und die öffentlichen Touren dieser Person. */
export async function startProfile(): Promise<void> {
  const stage = $('stage')
  const grid = $('tours')
  const messageEl = $('message')
  if (!stage || !grid || !messageEl) return

  // Handle aus dem Pfad (/@henrik) oder ID aus der Query (?id=…) — die alte
  // Form bleibt bedienbar, weil solche Links längst geteilt sind.
  const who = handleOrIdFromUrl(window.location.pathname, window.location.search)
  if (!who) {
    stage.hidden = true
    showError(messageEl, 'Kein Profil angegeben.')
    return
  }

  let data: ProfileResponse
  try {
    const response = await fetch(`/api/users/${encodeURIComponent(who)}/profile`)
    if (response.status === 404) {
      stage.hidden = true
      showError(messageEl, 'Dieses Profil gibt es nicht (mehr).')
      return
    }
    if (!response.ok) throw new Error(String(response.status))
    data = (await response.json()) as ProfileResponse
  } catch {
    stage.hidden = true
    showError(messageEl, 'Das Profil ließ sich gerade nicht laden.')
    return
  }

  // Auf die kanonische Adresse umschreiben, wenn der Aufruf über die alte Form
  // kam (?id=… oder ein aufgegebener Handle). Kein Redirect, sondern
  // replaceState: Die Seite steht schon, und ein zweiter Ladevorgang für
  // dieselbe Antwort wäre nur Wartezeit — der Verlauf bleibt sauber.
  if (data.handle && window.location.pathname !== profilePath(data.handle)) {
    window.history.replaceState(null, '', profilePath(data.handle))
  }

  stage.hidden = false
  renderBanner(data)
  renderHead(data)
  renderLinks(data)
  renderStats(data)

  if (data.tours.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'hint'
    empty.textContent = 'Noch keine öffentlichen Reisen.'
    grid.replaceWith(empty)
  } else {
    grid.replaceChildren(...data.tours.map(tourTile))
  }

  const mine = isOwn(data, await ownHandle())
  if (data.ownerOnly) {
    // Der Hinweis gilt nur dem Besitzer — sonst käme die Antwort gar nicht erst
    // an (404). Statt eines toten Teilen-Knopfes steht hier, warum.
    const chip = $('private-chip')
    if (chip) chip.hidden = false
  } else {
    wireShare(data)
  }
  if (mine) {
    const { mountEditProfile } = await import('./edit-profile.js')
    mountEditProfile(data, () => window.location.reload())
  }
}
