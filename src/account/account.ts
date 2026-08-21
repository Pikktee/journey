// Hülle der Kontoeinstellungen: holt die Daten und hängt sie in den DOM. Alles,
// was entschieden oder gerechnet werden muss, steht in account-model.ts, die
// Formulare in kontodialoge.ts (nachgeladen — s. dort).
//
// Die Seite ist bewusst NICHT Teil des Studios: Das Studio ist der
// Schneideraum, das hier ist der Ordner mit den Papieren. Sie ist auch nicht
// die Profilseite — dort steht, was andere sehen, hier, was das Konto ausmacht.
// Der einzige Zustand, den sich beide teilen (öffentlich ja/nein), steht
// deshalb an beiden Stellen und schreibt dasselbe Feld.

import { path, profilePath } from '../routes.js'
import { profileVisibilitySentence, searchIndexingSentence } from '../visibility.js'
import { loadTracker, redeemTrackerReturn } from './tracker-card.js'
import {
  usedPercent,
  dataExportLine,
  deviceName,
  deviceIcon,
  deviceSubline,
  formatBytes,
  storageBarSegments,
  storageLow,
  type DataExportStatus,
  type Device,
  type StorageStatus,
} from './account-model.js'

const SVG_NS = 'http://www.w3.org/2000/svg'

/** Die Zeichen der Oberfläche — Pfaddaten, damit sie nicht als Markup im HTML stehen. */
const ICONS: Record<string, string> = {
  desktop: 'M3 4.5h18a1 1 0 011 1v9a1 1 0 01-1 1H3a1 1 0 01-1-1v-9a1 1 0 011-1z|M8 19.5h8',
  phone: 'M7.5 2.5h9a2 2 0 012 2v15a2 2 0 01-2 2h-9a2 2 0 01-2-2v-15a2 2 0 012-2z|M10.5 18.5h3',
  app: 'M7.5 2.5h9a2 2 0 012 2v15a2 2 0 01-2 2h-9a2 2 0 01-2-2v-15a2 2 0 012-2z|M9 6.8l3.2 4.2L15 8.4l0 3.6',
  check: 'M20 6L9 17l-5-5',
  warning: 'M12 4.5l8.5 15h-17z|M12 10v4M12 16.8v.2',
}

/** Farben der Balkenabschnitte — dieselbe Reihenfolge wie in `storageBarSegments`. */
const COLORS: Record<string, string> = {
  photos: 'var(--primary)',
  videos: 'var(--secondary)',
  audio: 'var(--accent-violet)',
  recordings: 'var(--info)',
  other: 'rgba(242, 237, 227, 0.42)',
}

function icon(kind: string, strokeWidth = '1.7'): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', strokeWidth)
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

/** Kurze Rückmeldung unten rechts; sie verschwindet von selbst. */
let toastTimer: number | undefined
function toast(text: string): void {
  const toast = $('toast')
  const content = $('toast-text')
  if (!toast || !content) return
  content.textContent = text
  toast.classList.add('visible')
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => toast.classList.remove('visible'), 4000)
}

function showNotice(text: string, link?: { text: string; href: string }): void {
  const target = $('message')
  if (!target) return
  const p = el('p', 'hint', text)
  if (link) {
    p.appendChild(document.createTextNode(' '))
    const a = el('a', undefined, link.text)
    a.href = link.href
    a.style.color = 'var(--primary)'
    p.appendChild(a)
  }
  target.replaceChildren(p)
}

interface MeResponse {
  user: { id: string; email: string; name: string; role: string } | null
  verified?: boolean
  newsletter?: boolean
  profile?: {
    handle: string | null
    displayName: string | null
    visibility: 'private' | 'public'
    searchIndexing?: boolean
  }
  export?: DataExportStatus | null
}

// ————— Anmeldung & Sicherheit —————

function renderAccount(data: MeResponse): void {
  const mailEl = $('account-email')
  if (mailEl) mailEl.textContent = data.user?.email ?? ''

  const status = $('account-mail-status')
  if (status) {
    status.replaceChildren()
    if (data.verified) {
      status.className = 'marker good'
      status.appendChild(icon('check', '2.4'))
      status.appendChild(document.createTextNode('bestätigt'))
    } else {
      // Kein stiller Haken auf einer unbestätigten Adresse: Ohne Bestätigung
      // lässt sich nichts hochladen, und das steht sonst nirgends auf dieser Seite.
      status.className = 'marker open'
      status.appendChild(icon('warning', '1.9'))
      status.appendChild(document.createTextNode('unbestätigt'))
    }
  }
}

// ————— Geräte —————

function deviceRow(device: Device, onSignOut: (g: Device) => void): HTMLElement {
  const row = el('div', device.current ? 'row current' : 'row')

  const iconEl = el('span', 'sym')
  iconEl.appendChild(icon(deviceIcon(device)))
  row.appendChild(iconEl)

  const z = el('span', 'z')
  const title = el('span', 't')
  title.appendChild(document.createTextNode(deviceName(device)))
  if (device.current) {
    const self = el('span', 'self', ' · dieses Gerät')
    title.appendChild(self)
  }
  z.appendChild(title)
  const subline = deviceSubline(device)
  if (subline) z.appendChild(el('span', 'b', subline))
  row.appendChild(z)

  // Das eigene Gerät bekommt keinen Knopf: Sich hier abzumelden gewinnt nichts,
  // außer sich gleich wieder anmelden zu dürfen — dafür gibt es das Konto-Menü.
  if (!device.current) {
    const button = el('button', 'button danger', 'Abmelden')
    button.type = 'button'
    button.addEventListener('click', () => {
      button.disabled = true
      onSignOut(device)
    })
    row.appendChild(button)
  }
  return row
}

async function loadDevices(): Promise<void> {
  const panel = $('devices')
  if (!panel) return
  let devices: Device[] = []
  try {
    const response = await fetch('/api/auth/me/devices')
    if (!response.ok) throw new Error(String(response.status))
    devices = ((await response.json()) as { devices: Device[] }).devices
  } catch {
    panel.replaceChildren(rowWithText('Die Geräteliste ließ sich gerade nicht laden.'))
    return
  }

  const signOut = async (device: Device): Promise<void> => {
    const response = await fetch(`/api/auth/me/devices/${encodeURIComponent(device.id)}`, {
      method: 'DELETE',
    })
    if (!response.ok) {
      toast('Das Gerät ließ sich nicht abmelden.')
      return
    }
    toast(`${deviceName(device)} wurde abgemeldet.`)
    void loadDevices()
  }

  panel.replaceChildren(...devices.map((g) => deviceRow(g, (target) => void signOut(target))))
}

function rowWithText(text: string): HTMLElement {
  const row = el('div', 'row')
  const z = el('span', 'z')
  z.appendChild(el('span', 'b', text))
  row.appendChild(z)
  return row
}

// ————— Speicher —————

async function loadStorage(): Promise<void> {
  const bar = $('storage-bar')
  const legend = $('storage-legend')
  if (!bar || !legend) return
  let status: StorageStatus
  try {
    const response = await fetch('/api/auth/me/storage')
    if (!response.ok) throw new Error(String(response.status))
    status = (await response.json()) as StorageStatus
  } catch {
    legend.replaceChildren(el('span', undefined, 'Der Speicherstand ließ sich gerade nicht laden.'))
    return
  }

  const usedEl = $('storage-used')
  if (usedEl) usedEl.textContent = formatBytes(status.used)
  const ofEl = $('storage-of')
  if (ofEl) ofEl.textContent = `von ${formatBytes(status.limit)} belegt`
  const percentEl = $('storage-percent')
  if (percentEl) percentEl.textContent = `${Math.round(usedPercent(status))} %`

  const segments = storageBarSegments(status)
  bar.replaceChildren(
    ...segments.map((a) => {
      const i = el('i')
      i.style.width = `${a.percent}%`
      i.style.background = COLORS[a.kind] ?? COLORS.other!
      return i
    }),
  )
  legend.replaceChildren(
    ...segments.map((a) => {
      const span = el('span')
      const dot = el('i')
      dot.style.background = COLORS[a.kind] ?? COLORS.other!
      span.appendChild(dot)
      span.appendChild(document.createTextNode(`${a.label} `))
      span.appendChild(el('b', undefined, formatBytes(a.bytes)))
      return span
    }),
  )
  // Ein leeres Konto bekommt keine leere Legende hingestellt.
  if (!segments.length) legend.replaceChildren(el('span', undefined, 'Noch nichts hochgeladen.'))

  const warning = $('storage-warning')
  if (warning) warning.hidden = !storageLow(status)
}

// ————— Sichtbarkeit —————

function wireVisibility(data: MeResponse): void {
  const switchInput = $('switch-profile') as HTMLInputElement | null
  const explainEl = $('switch-profile-hint')
  if (!switchInput) return
  const handle = data.profile?.handle ?? null
  const address = handle ? `${window.location.host}${profilePath(handle)}` : 'deiner Profilseite'
  switchInput.checked = data.profile?.visibility === 'public'
  const showSentence = (): void => {
    if (explainEl) explainEl.textContent = profileVisibilitySentence(switchInput.checked, address)
  }
  showSentence()
  switchInput.addEventListener('change', async () => {
    const wanted = switchInput.checked
    switchInput.disabled = true
    const response = await fetch('/api/auth/me/profile', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ visibility: wanted ? 'public' : 'private' }),
    }).catch(() => null)
    switchInput.disabled = false
    if (!response?.ok) {
      // Zurückstellen statt eine Änderung zu zeigen, die der Server nicht kennt.
      switchInput.checked = !wanted
      showSentence()
      toast('Die Sichtbarkeit ließ sich nicht ändern.')
      return
    }
    showSentence()
    toast(wanted ? 'Dein Profil ist jetzt öffentlich.' : 'Dein Profil ist jetzt privat.')
    // Der Schalter darunter hängt an diesem: Ohne öffentliches Profil ist „In
    // Suchmaschinen erscheinen" folgenlos — und das muss man sehen, ohne die
    // Seite neu zu laden.
    showSearchIndexing()
  })
}

// ————— In Suchmaschinen erscheinen —————

/**
 * Zeile und Zustand des Schalters „In Suchmaschinen erscheinen".
 *
 * Bei privatem Profil ist er GESPERRT und die Zeile sagt, worauf er wartet: Ein
 * bedienbarer Schalter, der nichts tut, ist die schlechtere Auskunft als einer,
 * der sichtbar auf etwas wartet. Entschieden wird ohnehin im Server: `index`
 * gibt es nur für ein öffentliches Profil MIT diesem Schalter
 * (server/src/routes/pages.ts).
 *
 * Eigene Funktion, weil zwei Stellen sie brauchen: der Aufbau und jeder Wechsel
 * der Sichtbarkeit darüber.
 */
function showSearchIndexing(): void {
  const switchInput = $('switch-search-indexing') as HTMLInputElement | null
  const profileSwitch = $('switch-profile') as HTMLInputElement | null
  const row = $('switch-search-indexing-hint')
  if (!switchInput) return
  const isPublic = profileSwitch?.checked === true
  switchInput.disabled = !isPublic
  switchInput.closest('.row')?.classList.toggle('idle', !isPublic)
  if (row) row.textContent = searchIndexingSentence(switchInput.checked, isPublic)
}

function wireSearchIndexing(data: MeResponse): void {
  const switchInput = $('switch-search-indexing') as HTMLInputElement | null
  if (!switchInput) return
  switchInput.checked = data.profile?.searchIndexing === true
  showSearchIndexing()

  switchInput.addEventListener('change', async () => {
    const wanted = switchInput.checked
    switchInput.disabled = true
    const response = await fetch('/api/auth/me/search-indexing', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: wanted }),
    }).catch(() => null)
    switchInput.disabled = false
    if (!response?.ok) {
      // Zurückstellen statt eine Einstellung zu zeigen, die der Server nicht kennt.
      switchInput.checked = !wanted
      showSearchIndexing()
      toast('Die Einstellung ließ sich nicht ändern.')
      return
    }
    showSearchIndexing()
    toast(
      wanted
        ? 'Deine Profilseite darf in Suchergebnissen erscheinen.'
        : 'Deine Profilseite erscheint nicht mehr in Suchergebnissen.',
    )
  })
}

// ————— Datenexport —————

/**
 * Der Knopf „ZIP anfordern".
 *
 * Er wartet NICHT auf das Archiv: Die Route antwortet sofort, gebaut wird im
 * Hintergrund, und das Ergebnis kommt per Mail. Deshalb sagt die Rückmeldung
 * genau das — ein Spinner, der Minuten läuft, wäre eine Lüge über die Dauer,
 * und ein Fortschrittsbalken bräuchte einen zweiten Kanal, den es nicht gibt.
 *
 * Läuft schon einer, antwortet der Server mit demselben Auftrag (er legt keinen
 * zweiten an), und wir sagen es an der Zeile. Der Knopf bleibt danach gesperrt:
 * Ein zweiter Klick änderte nichts, sähe aber aus, als täte er es.
 */
function wireDataExport(data: MeResponse): void {
  const button = $('btn-export') as HTMLButtonElement | null
  const row = $('data-export-status')
  if (!button) return

  const show = (status: DataExportStatus | null | undefined): void => {
    if (row) row.textContent = dataExportLine(status)
    button.disabled = status?.status === 'running'
  }
  show(data.export)

  // Der Klick fragt erst nach (s. openDataExportDialog) — der Lauf dahinter
  // dauert Minuten und lässt sich nicht abbrechen.
  const start = async (): Promise<void> => {
    button.disabled = true
    const response = await fetch('/api/auth/me/export', { method: 'POST' }).catch(() => null)
    if (!response?.ok) {
      button.disabled = false
      toast(
        response?.status === 429
          ? 'Du hast in der letzten Stunde schon mehrere Archive angefordert.'
          : 'Der Export ließ sich nicht starten.',
      )
      return
    }
    const status = (await response.json().catch(() => null)) as { export?: DataExportStatus } | null
    show(status?.export)
    toast('Export gestartet. Du bekommst eine Mail, sobald das Archiv bereitliegt.')
  }

  button.addEventListener('click', async () => {
    const { openDataExportDialog } = await import('./account-dialogs.js')
    openDataExportDialog(start)
  })
}

// ————— Newsletter —————

/**
 * Der Schalter „Updates & Neues von Maptale".
 *
 * Er ist NICHT gesperrt, solange die Adresse unbestätigt ist — gesperrt ist der
 * Versand (der Server schickt nur an bestätigte Adressen). Ein toter Schalter
 * ließe jemanden rätseln, ob die Einwilligung angekommen ist; die Zeile darunter
 * sagt stattdessen, worauf es noch wartet.
 */
function wireNewsletter(data: MeResponse): void {
  const switchInput = $('s-news') as HTMLInputElement | null
  const idleEl = $('switch-news-idle')
  if (!switchInput) return
  switchInput.checked = data.newsletter === true
  const showIdle = (): void => {
    if (idleEl) idleEl.hidden = !(switchInput.checked && data.verified !== true)
  }
  showIdle()

  switchInput.addEventListener('change', async () => {
    const wanted = switchInput.checked
    switchInput.disabled = true
    const response = await fetch('/api/auth/me/newsletter', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: wanted }),
    }).catch(() => null)
    switchInput.disabled = false
    if (!response?.ok) {
      // Zurückstellen statt eine Einwilligung zu zeigen, die niemand
      // protokolliert hat.
      switchInput.checked = !wanted
      showIdle()
      toast('Die Einstellung ließ sich nicht ändern.')
      return
    }
    showIdle()
    toast(
      wanted
        ? data.verified === true
          ? 'Du bekommst künftig Updates von Maptale.'
          : 'Notiert. Es geht los, sobald deine E-Mail-Adresse bestätigt ist.'
        : 'Du bekommst keine Updates mehr.',
    )
  })
}

/**
 * `#newsletter-aus=<token>` — der Weg aus jeder Werbemail.
 *
 * Er führt hierher und nicht auf eine eigene Seite: Wer sich abmeldet, ist im
 * selben Atemzug an der Stelle, an der er es sich anders überlegen kann. Er
 * funktioniert OHNE Anmeldung (der Token ist signiert), deshalb läuft er vor
 * der `/auth/me`-Abfrage — und wie beim Adresswechsel wird der Hash sofort aus
 * der Adresszeile geräumt.
 *
 * Der Klick auf den Link trägt schon aus; ein Bestätigungsknopf davor wäre bei
 * einer ABMELDUNG die falsche Reihenfolge (bei der Warteliste steht er, weil
 * dort eine Löschung dranhängt — hier ist die Rücknahme ein Schalter weiter
 * unten). Mail-Scanner, die Links vorab öffnen, lösen das nicht aus: Der Weg
 * ist ein POST.
 */
async function redeemNewsletterUnsubscribe(): Promise<{ ok: boolean; text: string } | null> {
  const hit = /^#newsletter-aus=(.+)$/.exec(window.location.hash)
  if (!hit?.[1]) return null
  const token = decodeURIComponent(hit[1])
  window.history.replaceState(null, '', window.location.pathname)
  const response = await fetch('/api/newsletter/unsubscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  }).catch(() => null)
  if (response?.ok) return { ok: true, text: 'Du bekommst keine Updates mehr von Maptale.' }
  const body = (await response?.json().catch(() => ({}))) as { error?: string } | undefined
  return { ok: false, text: body?.error ?? 'Dieser Abmeldelink gilt nicht mehr.' }
}

// ————— Der Bestätigungslink aus der Mail —————

/**
 * `#email=<token>` einlösen.
 *
 * Der Hash wird sofort aus der Adresszeile geräumt — ein Token, das im Verlauf
 * und in jedem geteilten Screenshot steht, ist keins mehr. Wirkt nur beim
 * LADEN der Seite (wie `#verify=`/`#reset=` im Studio), nicht bei einem
 * Hash-Wechsel in einem offenen Tab.
 */
async function redeemEmailChange(): Promise<boolean> {
  const hit = /^#email=(.+)$/.exec(window.location.hash)
  if (!hit?.[1]) return false
  const token = decodeURIComponent(hit[1])
  window.history.replaceState(null, '', window.location.pathname)
  const response = await fetch('/api/auth/confirm-email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  }).catch(() => null)
  if (response?.ok) {
    toast('Deine neue E-Mail-Adresse ist bestätigt.')
    return true
  }
  const body = (await response?.json().catch(() => ({}))) as { error?: string } | undefined
  toast(body?.error ?? 'Dieser Bestätigungslink gilt nicht mehr.')
  return false
}

// ————— Aufbau —————

export async function startAccount(): Promise<void> {
  const stage = $('stage')
  if (!stage) return

  // Die Links aus der Mail zuerst: Sie ändern, was gleich darunter angezeigt
  // wird (Adresse bzw. Newsletter-Schalter) — in der anderen Reihenfolge stünde
  // eine Sekunde lang der alte Stand da. Die Abmeldung geht auch ohne
  // Anmeldung, deshalb steht sie vor jeder Prüfung.
  await redeemEmailChange()
  const unsubscribed = await redeemNewsletterUnsubscribe()
  // Die Rückkehr vom Tracker-Anbieter: Der Hash wird sofort geräumt, damit ein
  // Neuladen nicht „Verbunden." meldet, ohne dass etwas verbunden wurde.
  const trackerReturn = redeemTrackerReturn()

  let data: MeResponse
  try {
    const response = await fetch('/api/auth/me')
    if (!response.ok) throw new Error(String(response.status))
    data = (await response.json()) as MeResponse
  } catch {
    showNotice('Die Kontoeinstellungen ließen sich gerade nicht laden.')
    return
  }
  if (!data.user) {
    // Wer aus einer Mail kommt, hat sein Anliegen hier schon erledigt — ihm
    // eine Anmeldemaske hinzustellen, hieße, den Widerruf hinter eine Hürde zu
    // schieben, die er gerade nicht gebraucht hat.
    if (unsubscribed) {
      showNotice(unsubscribed.text, { text: 'Zu deinem Konto', href: path('login') })
      return
    }
    showNotice('Für die Kontoeinstellungen musst du angemeldet sein.', {
      text: 'Anmelden',
      href: path('login'),
    })
    return
  }
  if (unsubscribed) toast(unsubscribed.text)

  stage.hidden = false
  document.title = 'Kontoeinstellungen · Maptale'

  renderAccount(data)
  wireNewsletter(data)
  wireVisibility(data)
  wireSearchIndexing(data)
  wireDataExport(data)
  void loadDevices()
  void loadStorage()
  void loadTracker(toast)
  if (trackerReturn) toast(trackerReturn)

  // Die Formulare erst beim ersten Griff — sie bringen die Passwortbewertung mit.
  const dialogs = async (): Promise<typeof import('./account-dialogs.js')> =>
    import('./account-dialogs.js')

  $('btn-mail')?.addEventListener('click', async () => {
    ;(await dialogs()).openEmailDialog(toast)
  })
  $('btn-password')?.addEventListener('click', async () => {
    // Name und Adresse fließen in die Bewertung ein: Ein Passwort, in dem der
    // eigene Name steht, ist kein gutes.
    const personal = (): string[] =>
      [data.user?.name, data.user?.email, data.profile?.displayName].filter((w): w is string => !!w)
    ;(await dialogs()).openPasswordDialog((text) => {
      toast(text)
      // Der Wechsel hat alle anderen Zugänge beendet — die Liste zeigt es.
      void loadDevices()
    }, personal)
  })
  $('btn-delete')?.addEventListener('click', async () => {
    ;(await dialogs()).openDeleteAccountDialog(() => {
      window.location.href = path('start')
    })
  })
}
