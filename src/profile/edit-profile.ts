// Das Bearbeiten-Modal — nur für den Besitzer, deshalb erst hier nachgeladen
// (s. profile.ts). Es baut seinen DOM selbst: Als Markup in profile.html läge es
// bei jedem Besucher im Dokument, der es nie öffnen kann.
//
// Bewusst ein Modal und kein `contenteditable` im Text: Enter, eingefügtes
// HTML und Firefox' eigene Vorstellungen davon sind drei Baustellen, und
// „Verwerfen" ist in einem Formular ein Schließen statt einer Rücknahme.

import { openDialogLayer } from '../dialog-layer.js'
import { HANDLE_ERROR_TEXTS, validateHandleForm, toHandle } from '../handle.js'
import { profilePath } from '../routes.js'
import { profileVisibilitySentence } from '../visibility.js'
import { render } from './profile.js'
import { avatarInitial, type ProfileResponse } from './profile-model.js'
import { BANNERS, bannerPath } from './profile-banners.js'

/** Bio-Grenze wie im Server-Schema (dort 500) — hier die Empfehlung des Mockups. */
const BIO_MAX = 300

interface Fields {
  displayName: HTMLInputElement
  location: HTMLInputElement
  handle: HTMLInputElement
  bio: HTMLTextAreaElement
  website: HTMLInputElement
  instagram: HTMLInputElement
  visibility: HTMLInputElement
}

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

/** Feld mit Beschriftung; `vorsatz` ist das feststehende Zeichen davor („@"). */
function field(
  id: string,
  labelText: string,
  value: string,
  prefix?: string,
): { wrap: HTMLElement; input: HTMLInputElement } {
  const wrap = el('div', 'modal-field')
  const label = el('label', undefined, labelText)
  label.htmlFor = id
  wrap.appendChild(label)
  const input = el('input')
  input.id = id
  input.type = 'text'
  input.value = value
  input.autocomplete = 'off'
  if (prefix) {
    const box = el('div', 'prefix-field')
    box.appendChild(el('span', 'fixed', prefix))
    box.appendChild(input)
    wrap.appendChild(box)
  } else {
    wrap.appendChild(input)
  }
  return { wrap, input }
}

async function sendProfile(
  data: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const response = await fetch('/api/auth/me/profile', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (response.ok) return { ok: true }
    const body = (await response.json().catch(() => ({}))) as { error?: string }
    return { ok: false, error: body.error ?? 'Das ließ sich gerade nicht speichern.' }
  } catch {
    return { ok: false, error: 'Keine Verbindung zum Server.' }
  }
}

/**
 * Der Titelbild-Dialog: vier Vorschläge und ein eigenes Bild.
 *
 * Die Vorschläge sind statische Dateien im Build, das eigene Bild geht den Weg
 * des Avatars. Beide enden im selben Feld — welcher Fall vorliegt, erkennt der
 * Server am Schrägstrich (s. server/src/profilfelder.ts).
 */
function openBannerDialog(profile: ProfileResponse, done: () => void): void {
  const { body, footer, close } = openDialogLayer('Titelbild')
  body.appendChild(el('p', 'modal-hint', 'Quer, breit und am besten aus einer deiner Touren.'))

  const fileInput = el('input')
  fileInput.type = 'file'
  fileInput.accept = 'image/*'
  fileInput.hidden = true
  body.appendChild(fileInput)

  // Das eigene Foto steht OBEN und als eigene Fläche: Für die meisten ist es
  // der eigentliche Weg, als Knopf unter den Vorschauen ging es unter.
  const ownButton = el('button', 'style-custom')
  ownButton.type = 'button'
  const circle = el('span', 'circle')
  circle.appendChild(render('upload'))
  const words = el('span', 'z')
  words.appendChild(el('span', 't', 'Eigenes Foto hochladen'))
  words.appendChild(el('span', 'b', 'Quer, mindestens 1600 px breit'))
  const arrow = el('span', 'arrow')
  arrow.appendChild(render('arrow'))
  ownButton.append(circle, words, arrow)
  ownButton.addEventListener('click', () => fileInput.click())
  body.appendChild(ownButton)

  const heading = el('p', 'styles-title', 'Oder eines von uns')
  heading.id = 'l-stile'
  body.appendChild(heading)

  let choice: string | null = null
  const grid = el('div', 'styles')
  grid.setAttribute('role', 'group')
  grid.setAttribute('aria-labelledby', heading.id)
  for (const image of BANNERS) {
    const button = el('button', 'style')
    button.type = 'button'
    // Der gewählte Zustand ist `aria-pressed` und keine eigene Klasse: Er ist
    // eine Auskunft über den Knopf, und die Vorlesehilfe bekommt sie mit. Was
    // heute im Banner steht, ist von Anfang an markiert — sonst sieht der
    // Dialog aus, als stünde dort noch nichts.
    button.setAttribute('aria-pressed', String(profile.bannerUrl === bannerPath(image.file)))
    button.setAttribute('aria-label', image.alt)
    const swatch = el('span', 'swatch')
    swatch.style.backgroundImage = `url("${bannerPath(image.file)}")`
    button.append(swatch, el('span', 'name', image.name))
    button.addEventListener('click', () => {
      choice = image.file
      for (const k of grid.querySelectorAll('.style'))
        k.setAttribute('aria-pressed', String(k === button))
    })
    grid.appendChild(button)
  }
  body.appendChild(grid)

  const errorEl = el('p', 'modal-error')
  errorEl.hidden = true
  body.appendChild(errorEl)

  // „Zurücksetzen" und nicht „Entfernen": Danach steht dort nicht nichts,
  // sondern wieder das mitgelieferte Bild (s. defaultBanner). Es steht
  // links in der Fußzeile und nur dann, wenn ein EIGENES Bild hochgeladen ist —
  // wer eines der vier gewählt hat, wechselt einfach zu einem anderen. Woran
  // man beide unterscheidet, ist der Pfad: Vorschläge liegen als statische
  // Datei unter /titelbilder/, eigene Bilder kommen aus der API.
  const hasOwnImage =
    !!profile.bannerUrl && !BANNERS.some((b) => bannerPath(b.file) === profile.bannerUrl)
  const resetButton = el('button', 'subtle', 'Zurücksetzen')
  resetButton.type = 'button'
  if (hasOwnImage) footer.append(resetButton, el('span', 'modal-spacer'))

  const cancelButton = el('button', 'subtle', 'Abbrechen')
  cancelButton.type = 'button'
  cancelButton.addEventListener('click', close)
  const applyButton = el('button', 'primary', 'Übernehmen')
  applyButton.type = 'button'
  footer.append(cancelButton, applyButton)

  const fail = (text: string): void => {
    errorEl.textContent = text
    errorEl.hidden = false
  }

  fileInput.addEventListener('change', async () => {
    const image = fileInput.files?.[0]
    if (!image) return
    applyButton.disabled = true
    ownButton.disabled = true
    try {
      const response = await fetch('/api/auth/me/banner', {
        method: 'PUT',
        headers: { 'content-type': 'image/jpeg' },
        body: image,
      })
      if (!response.ok) throw new Error(String(response.status))
      close()
      done()
    } catch {
      fail('Das Bild ließ sich nicht hochladen. Vielleicht ist es zu groß?')
      applyButton.disabled = false
      ownButton.disabled = false
    }
  })

  resetButton.addEventListener('click', async () => {
    await fetch('/api/auth/me/banner', { method: 'DELETE' }).catch(() => undefined)
    // Auch die gewählte Vorschlags-WAHL muss weg, nicht nur das hochgeladene
    // Bild: Zurückgesetzt wird auf „keine eigene Entscheidung" — was danach im
    // Banner steht, bestimmt `defaultBanner`.
    await sendProfile({ banner: '' })
    close()
    done()
  })

  applyButton.addEventListener('click', async () => {
    if (!choice) return close()
    applyButton.disabled = true
    const result = await sendProfile({ banner: choice })
    if (!result.ok) {
      fail(result.error)
      applyButton.disabled = false
      return
    }
    close()
    done()
  })
}

/**
 * Der Avatar im Bearbeiten-Modal: Klick öffnet die Dateiauswahl, darunter der
 * Weg zurück zum Initialen-Kreis.
 *
 * Das Bild geht SOFORT zum Server und nicht erst beim Speichern — es ist eine
 * eigene Route (`PUT /api/auth/me/avatar`, der Rest des Formulars läuft über
 * `PATCH …/profile`), und ein Bild bis zum Absenden im Speicher zu halten hieße,
 * es zweimal hochzuladen, wenn jemand sich umentscheidet. Der Dialog bleibt
 * dabei offen: Ein `fertig()` lüde die Seite neu und würfe alles weg, was
 * daneben schon getippt war.
 */
function avatarField(profile: ProfileResponse, fail: (text: string) => void): HTMLElement {
  const column = el('div', 'modal-avatar-column')
  const button = el('button', 'modal-avatar-box')
  button.type = 'button'
  button.setAttribute('aria-label', 'Profilbild ändern')
  const letterEl = el('span', undefined, avatarInitial(profile))
  const image = el('img')
  image.alt = ''
  const overlay = el('span', 'about')
  overlay.appendChild(render('camera'))
  overlay.appendChild(document.createTextNode('Ändern'))
  button.append(letterEl, image, overlay)

  const fileInput = el('input')
  fileInput.type = 'file'
  fileInput.accept = 'image/*'
  fileInput.hidden = true
  const removeButton = el('button', 'modal-avatar-remove', 'Bild entfernen')
  removeButton.type = 'button'

  // Ein Ort für die Frage „ist ein Bild da?" — er hängt an drei Stellen: dem
  // Kreis hier, dem Kopf der Seite dahinter und dem Entfernen-Weg.
  const show = (url: string | null): void => {
    image.hidden = !url
    letterEl.hidden = !!url
    removeButton.hidden = !url
    // Der Entfernen-Link liegt außerhalb des Flusses (sonst verschöbe er die
    // Mitte, an der Name und Ort hängen) — die Klasse macht die Reihe darunter
    // um seine Höhe länger.
    column.classList.toggle('has-image', !!url)
    if (url) image.src = url
    const inHead = document.getElementById('avatar')
    if (inHead) {
      inHead.replaceChildren()
      if (url) {
        const headImage = el('img')
        headImage.src = url
        headImage.alt = ''
        inHead.appendChild(headImage)
      } else {
        inHead.textContent = avatarInitial(profile)
      }
    }
  }
  show(profile.avatarUrl)

  button.addEventListener('click', () => fileInput.click())
  fileInput.addEventListener('change', async () => {
    const chosen = fileInput.files?.[0]
    if (!chosen) return
    button.disabled = true
    try {
      const response = await fetch('/api/auth/me/avatar', {
        method: 'PUT',
        headers: { 'content-type': 'image/jpeg' },
        body: chosen,
      })
      if (!response.ok) throw new Error(String(response.status))
      const body = (await response.json()) as { avatarUrl?: string }
      show(body.avatarUrl ?? null)
    } catch {
      fail('Das Profilbild ließ sich nicht hochladen. Vielleicht ist es zu groß?')
    }
    // Damit dieselbe Datei ein zweites Mal ein `change` auslöst, wenn der
    // erste Versuch schiefging.
    fileInput.value = ''
    button.disabled = false
  })
  removeButton.addEventListener('click', async () => {
    await fetch('/api/auth/me/avatar', { method: 'DELETE' }).catch(() => undefined)
    show(null)
  })

  column.append(button, fileInput, removeButton)
  return column
}

/** Das Profil-Formular. */
function openProfileDialog(profile: ProfileResponse, done: () => void): void {
  const { body, footer, close } = openDialogLayer('Profil bearbeiten')

  const errorEl = el('p', 'modal-error')
  errorEl.hidden = true
  const fail = (text: string): void => {
    errorEl.textContent = text
    errorEl.hidden = false
  }

  const name = field('e-name', 'Name', profile.displayName ?? '')
  const place = field('e-ort', 'Ort', profile.location ?? '')
  const pair = el('div', 'modal-row')
  pair.append(name.wrap, place.wrap)
  // Der Avatar teilt sich die Zeile mit Name und Ort: als eigener Block darüber
  // kostete er die Höhe, ab der das Modal zu scrollen beginnt.
  const headRow = el('div', 'modal-header-row')
  headRow.append(avatarField(profile, fail), pair)
  body.appendChild(headRow)

  const handle = field(
    'e-handle',
    'Profil-Adresse',
    profile.handle ?? '',
    `${window.location.host}/@`,
  )
  handle.input.maxLength = 30
  handle.input.spellcheck = false
  const handleStatus = el('div', 'handle-status')
  handleStatus.setAttribute('role', 'status')
  handle.wrap.appendChild(handleStatus)
  body.appendChild(handle.wrap)

  const bioWrap = el('div', 'modal-field')
  const bioLabel = el('label', undefined, 'Über mich')
  bioLabel.htmlFor = 'e-bio'
  const counter = el('span', 'counter')
  bioLabel.appendChild(counter)
  bioWrap.appendChild(bioLabel)
  const bio = el('textarea')
  bio.id = 'e-bio'
  bio.maxLength = BIO_MAX
  bio.value = profile.bio ?? ''
  bio.placeholder = 'Zwei Sätze über dich und deine Reisen.'
  bioWrap.appendChild(bio)
  body.appendChild(bioWrap)

  const web = field('e-web', 'Website', profile.website ?? '', 'https://')
  web.input.placeholder = 'beispiel.de'
  const insta = field('e-insta', 'Instagram', profile.instagram ?? '', '@')
  insta.input.placeholder = 'benutzername'
  const linkPair = el('div', 'modal-row')
  linkPair.append(web.wrap, insta.wrap)
  body.appendChild(linkPair)

  // Zweite Bedienstelle für denselben Zustand (die erste kommt mit den
  // Kontoeinstellungen). Bewusst doppelt: Hier sucht man sie beim Bearbeiten,
  // dort beim Aufräumen — auseinanderlaufen kann nichts, weil beide dasselbe
  // Feld schreiben.
  const switchRow = el('div', 'modal-switch-row')
  const switchLabel = el('label', 'z')
  switchLabel.htmlFor = 'switch-profile'
  switchLabel.appendChild(el('span', 't', 'Öffentliches Profil'))
  const explainEl = el('span', 'b')
  switchLabel.appendChild(explainEl)
  const switchInput = el('input')
  switchInput.id = 'switch-profile'
  switchInput.type = 'checkbox'
  switchInput.className = 'switch'
  switchInput.checked = !profile.ownerOnly
  switchRow.append(switchLabel, switchInput)
  body.appendChild(switchRow)

  body.appendChild(errorEl)

  const fields: Fields = {
    displayName: name.input,
    location: place.input,
    handle: handle.input,
    bio,
    website: web.input,
    instagram: insta.input,
    visibility: switchInput,
  }

  const cancelButton = el('button', 'subtle', 'Abbrechen')
  cancelButton.type = 'button'
  cancelButton.addEventListener('click', close)
  const saveButton = el('button', 'primary', 'Speichern')
  saveButton.type = 'button'
  footer.append(cancelButton, saveButton)

  // — Laufende Rückmeldung —

  // Der Satz unter dem Schalter hängt an ZWEI Feldern: an ihm selbst und am
  // Handle darüber (die Adresse steht darin). Deshalb eine eigene Funktion.
  const showVisibility = (): void => {
    const value = fields.handle.value.trim().toLowerCase()
    explainEl.textContent = profileVisibilitySentence(
      switchInput.checked,
      `${window.location.host}${profilePath(value || '…')}`,
    )
  }
  switchInput.addEventListener('change', showVisibility)

  const showBio = (): void => {
    counter.textContent = `${bio.value.length}/${BIO_MAX}`
    counter.classList.toggle('low', bio.value.length > BIO_MAX - 40)
  }

  const showHandle = (): void => {
    const value = fields.handle.value.trim().toLowerCase()
    const own = (profile.handle ?? '').toLowerCase()
    // Der eigene Handle ist immer in Ordnung — die Prüfung sagt sonst
    // „reserviert", sobald jemand zufällig so heißt wie eine Seite.
    const error = value === own ? null : validateHandleForm(value)
    handleStatus.className = `handle-status ${error ? 'taken' : 'available'}`
    // Haken oder Kreuz VOR dem Satz: Die Auskunft ist an der Farbe allein nicht
    // zu erkennen, wenn man Rot und Grün nicht unterscheidet.
    const icon = render(error ? 'cross' : 'check')
    icon.setAttribute('stroke-width', '2.2')
    handleStatus.replaceChildren(
      icon,
      el(
        'span',
        undefined,
        error
          ? HANDLE_ERROR_TEXTS[error]
          : value === own
            ? 'Das ist deine aktuelle Adresse.'
            : `@${value} sieht gut aus. Ob sie frei ist, sagt dir das Speichern.`,
      ),
    )
    showVisibility()
    saveButton.disabled = !!error
  }

  bio.addEventListener('input', showBio)
  // Kleinschreibung erzwingen: Groß/Klein unterscheidet in URLs nicht, ein
  // gemischtes @Henrik wäre nur Zierde mit Fehlerquelle. Die Schreibmarke muss
  // dabei mitwandern, sonst springt sie bei jedem Zeichen ans Ende.
  fields.handle.addEventListener('input', () => {
    const before = fields.handle.value
    const pos = fields.handle.selectionStart ?? before.length
    const next = toHandle(before)
    if (next !== before) {
      fields.handle.value = next
      const offset = Math.max(0, pos + next.length - before.length)
      fields.handle.setSelectionRange(offset, offset)
    }
    showHandle()
  })
  showBio()
  showHandle()
  window.setTimeout(() => fields.displayName.focus(), 0)

  saveButton.addEventListener('click', async () => {
    saveButton.disabled = true
    errorEl.hidden = true
    const result = await sendProfile({
      displayName: fields.displayName.value,
      location: fields.location.value,
      handle: fields.handle.value,
      bio: fields.bio.value,
      website: fields.website.value,
      instagram: fields.instagram.value,
      visibility: fields.visibility.checked ? 'public' : 'private',
    })
    if (!result.ok) {
      errorEl.textContent = result.error
      errorEl.hidden = false
      saveButton.disabled = false
      return
    }
    close()
    done()
  })
}

/**
 * Hängt die Bearbeiten-Knöpfe an die Seite. `fertig` läuft nach jedem
 * gespeicherten Zug — die Seite lädt sich dann neu, statt den halben DOM von
 * Hand nachzuziehen (der Sichtbarkeits-Schalter ändert auch, was der Server
 * überhaupt ausliefert).
 */
export function mountEditProfile(profile: ProfileResponse, done: () => void): void {
  const editButton = document.getElementById('btn-edit') as HTMLButtonElement | null
  if (editButton) {
    editButton.hidden = false
    editButton.addEventListener('click', () => openProfileDialog(profile, done))
  }
  const bannerButton = document.getElementById('btn-banner') as HTMLButtonElement | null
  if (bannerButton) {
    bannerButton.hidden = false
    bannerButton.addEventListener('click', () => openBannerDialog(profile, done))
  }
}
