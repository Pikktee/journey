// Hülle der Profilseite: holt die Daten und hängt sie in den DOM. Alles, was
// entschieden werden muss, steht in profilmodell.ts.
//
// Die Seite ist zweierlei: die öffentliche Visitenkarte einer Person und — für
// genau eine Person — die Stelle, an der sie sie bearbeitet. Das Bearbeiten
// wird deshalb NACHGELADEN (`import()` unten): Der Dialog samt Handle-Prüfung
// und Bildwahl ist der größere Teil des Codes und interessiert niemanden, der
// hier nur jemandem beim Reisen zusieht.

import { alsKarte, wenAusAdresse, type GalerieTour } from '../galerie/galeriemodell.js'
import { profilPfad } from '../routen.js'
import { standardTitelbild, titelbildPfad } from './titelbilder.js'
import {
  anfangsbuchstabe,
  istEigenes,
  kennzahlChips,
  linkChips,
  profilKopf,
  type ProfilAntwort,
} from './profilmodell.js'

const SVG_NS = 'http://www.w3.org/2000/svg'

/** Die Zeichen der Oberfläche — Pfaddaten, damit sie nicht als Markup im HTML stehen. */
const ZEICHEN: Record<string, string> = {
  tours: 'M4 17l4-10 4 6 3-4 5 8|M8 7a1.4 1.4 0 100-.01|M19 17a1.4 1.4 0 100-.01',
  km: 'M5 17.5c3.5 0 3-8 7-8s3.5 5 7 5',
  elevationGain: 'M2.5 19l6-9 3.5 4.5 3-4 6.5 8.5z|M8.5 10L11 6.5',
  location:
    'M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11z|M12 12.6a2.6 2.6 0 100-5.2 2.6 2.6 0 000 5.2z',
  web: 'M20.5 12a8.5 8.5 0 11-17 0 8.5 8.5 0 0117 0z|M3.5 12h17|M12 3.5c2.6 2.7 2.6 14.3 0 17-2.6-2.7-2.6-14.3 0-17z',
  instagram:
    'M8.6 4h6.8A4.6 4.6 0 0120 8.6v6.8a4.6 4.6 0 01-4.6 4.6H8.6A4.6 4.6 0 014 15.4V8.6A4.6 4.6 0 018.6 4z|M15.6 12a3.6 3.6 0 11-7.2 0 3.6 3.6 0 017.2 0z|M17.4 7.1a.9.9 0 11-1.8 0 .9.9 0 011.8 0z',
  privat: 'M6.25 10.5h11.5v10h-11.5z|M8.5 10.5V8a3.5 3.5 0 017 0v2.5',
  stift: 'M4 20h4l10-10-4-4L4 16z|M13.5 6.5l4 4',
  bild: 'M5.5 4.5h13a2 2 0 012 2v11a2 2 0 01-2 2h-13a2 2 0 01-2-2v-11a2 2 0 012-2z|M4 18l5-6 4 4.5 3-3.5 4 5|M17.1 8a1.6 1.6 0 11-3.2 0 1.6 1.6 0 013.2 0z',
  // Für den Titelbild-Dialog: Hochladen, Weiter-Pfeil, Kamera (Avatar-Überlage).
  hoch: 'M12 16.5V4.5|M7.4 9.1L12 4.5l4.6 4.6|M4 15.5v3A1.5 1.5 0 005.5 20h13a1.5 1.5 0 001.5-1.5v-3',
  pfeil: 'M9 6l6 6-6 6',
  // Vor der Handle-Meldung: Haken, wenn die Adresse geht, Kreuz, wenn nicht.
  haken: 'M20 6L9 17l-5-5',
  kreuz: 'M18 6L6 18M6 6l12 12',
  kamera:
    'M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z|M16 13a4 4 0 11-8 0 4 4 0 018 0z',
  teilen:
    'M8.7 13.4l6.6 3.9|M15.3 6.7L8.7 10.6|M6.5 12a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z|M20.5 5.5a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z|M20.5 18.5a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z',
}

/** Ein Icon aus `ZEICHEN`; die Pfade sind mit `|` getrennt. */
export function zeichne(art: string): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '1.75')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  for (const d of (ZEICHEN[art] ?? '').split('|')) {
    const pfad = document.createElementNS(SVG_NS, 'path')
    pfad.setAttribute('d', d)
    svg.appendChild(pfad)
  }
  return svg
}

const $ = (id: string): HTMLElement | null => document.getElementById(id)

function zeigeFehler(ziel: HTMLElement, text: string): void {
  ziel.replaceChildren()
  const p = document.createElement('p')
  p.className = 'hinweis'
  p.textContent = text
  ziel.appendChild(p)
}

/**
 * Eine Tour-Kachel.
 *
 * Ohne Urheber-Zeile — der Name steht im Kopf der Seite. Das Bild sitzt als
 * `background-image` im Element und nicht als `<img>`: Es ist ein Ausschnitt in
 * fester Höhe, kein Bild mit eigenem Seitenverhältnis, und `background-size:
 * cover` erledigt genau das ohne zweite Box.
 */
function tourKachel(tour: GalerieTour): HTMLElement {
  const karte = alsKarte(tour)
  const a = document.createElement('a')
  a.className = 'tour'
  a.href = karte.spielLink

  const bild = document.createElement('div')
  bild.className = 'bild'
  // Der Pfad kommt vom Server, wird aber über CSS.setProperty gesetzt statt in
  // einen style-String interpoliert: Ein Anführungszeichen im Dateinamen könnte
  // sonst aus der url() ausbrechen.
  if (karte.cover) bild.style.backgroundImage = `url("${karte.cover.replace(/"/g, '%22')}")`
  a.appendChild(bild)

  const txt = document.createElement('div')
  txt.className = 'txt'
  const titel = document.createElement('div')
  titel.className = 'titel'
  titel.textContent = karte.titel
  txt.appendChild(titel)
  if (karte.unterzeile) {
    const meta = document.createElement('div')
    meta.className = 'meta'
    meta.textContent = karte.unterzeile
    txt.appendChild(meta)
  }
  a.appendChild(txt)
  return a
}

/** Der Kopf: Avatar, Name, Handle, Ort, Beitritt. */
function zeichneKopf(profile: ProfilAntwort): void {
  const kopf = profilKopf(profile)
  document.title = `${kopf.name} · Maptale`

  const avatar = $('avatar')
  if (avatar) {
    avatar.replaceChildren()
    if (kopf.bild) {
      const img = document.createElement('img')
      img.src = kopf.bild
      img.alt = ''
      avatar.appendChild(img)
    } else {
      avatar.textContent = anfangsbuchstabe(profile)
    }
  }

  const name = $('p-name')
  if (name) name.textContent = kopf.name

  const beiwerk = $('p-beiwerk')
  if (beiwerk) {
    beiwerk.replaceChildren()
    if (kopf.handle) {
      const h = document.createElement('span')
      h.className = 'handle'
      h.textContent = kopf.handle
      beiwerk.appendChild(h)
    }
    if (kopf.location) {
      const o = document.createElement('span')
      o.appendChild(zeichne('ort'))
      const t = document.createElement('span')
      t.textContent = kopf.location
      o.appendChild(t)
      beiwerk.appendChild(o)
    }
    if (kopf.memberSince) {
      const d = document.createElement('span')
      d.textContent = kopf.memberSince
      beiwerk.appendChild(d)
    }
  }

  const bio = $('p-bio')
  if (bio) {
    bio.textContent = kopf.bio ?? ''
    bio.hidden = !kopf.bio
  }
}

/**
 * Titelbild — das gewählte oder eines der mitgelieferten.
 *
 * Wer keines gewählt hat, bekommt trotzdem eins (`standardTitelbild`): Die vier
 * Bilder liegen im Build, und ein leeres Banner ist keine Zurückhaltung,
 * sondern 230 px graue Fläche über fast jedem Profil. Die ruhige Fläche
 * (`.leer`) bleibt als Rückfall im CSS, falls das Bild nicht lädt.
 */
function zeichneBanner(profile: ProfilAntwort): void {
  const banner = $('p-banner')
  if (!banner) return
  const bild = profile.bannerUrl ?? titelbildPfad(standardTitelbild(profile.handle))
  banner.style.backgroundImage = `url("${bild.replace(/"/g, '%22')}")`
  banner.classList.remove('leer')
}

function zeichneLinks(profile: ProfilAntwort): void {
  const ziel = $('p-links')
  if (!ziel) return
  ziel.replaceChildren()
  for (const chip of linkChips(profile)) {
    const a = document.createElement('a')
    a.className = 'link-chip'
    a.href = chip.href
    // Fremde Ziele: kein Zugriff auf dieses Fenster, kein Referrer. `noopener`
    // ist bei target=_blank Pflicht, sonst kann die Zielseite hierher zurückgreifen.
    a.target = '_blank'
    a.rel = 'noopener noreferrer nofollow'
    a.appendChild(zeichne(chip.art))
    const span = document.createElement('span')
    span.textContent = chip.text
    a.appendChild(span)
    ziel.appendChild(a)
  }
}

function zeichneKennzahlen(profile: ProfilAntwort): void {
  const ziel = $('p-kennzahlen')
  if (!ziel) return
  ziel.replaceChildren()
  for (const chip of kennzahlChips(profile.stats)) {
    const span = document.createElement('span')
    span.className = 'kz'
    span.appendChild(zeichne(chip.art))
    const b = document.createElement('b')
    b.textContent = chip.zahl
    span.appendChild(b)
    span.appendChild(document.createTextNode(` ${chip.wort}`))
    ziel.appendChild(span)
  }
}

/**
 * Teilen — mit dem System-Dialog, wo es ihn gibt, sonst in die Zwischenablage.
 *
 * Die Beschriftung richtet sich nach dem, was das Gerät kann: „Teilen" auf einem
 * Telefon, „Link kopieren" am Schreibtisch. Ein Knopf, der „Teilen" verspricht
 * und dann nur kopiert, ist ein gebrochenes Versprechen.
 */
function verdrahteTeilen(profile: ProfilAntwort): void {
  const knopf = $('btn-teilen') as HTMLButtonElement | null
  if (!knopf || !profile.handle) return
  const adresse = new URL(profilPfad(profile.handle), window.location.origin).href
  const kannTeilen = typeof navigator.share === 'function'
  const beschriftung = $('teilen-text')
  if (beschriftung) beschriftung.textContent = kannTeilen ? 'Teilen' : 'Link kopieren'
  knopf.hidden = false
  knopf.addEventListener('click', async () => {
    try {
      if (kannTeilen) {
        await navigator.share({ url: adresse, title: document.title })
        return
      }
      await navigator.clipboard.writeText(adresse)
      const alt = beschriftung?.textContent ?? ''
      if (beschriftung) beschriftung.textContent = 'Kopiert'
      window.setTimeout(() => {
        if (beschriftung) beschriftung.textContent = alt
      }, 1600)
    } catch {
      // Abgebrochener Teilen-Dialog und verweigerte Zwischenablage sehen gleich
      // aus und sind beide kein Fehler, den jemand gemeldet bekommen möchte.
    }
  })
}

/** Wer bin ich? Nur der Handle wird gebraucht — der Rest steht im Modal. */
async function eigenerHandle(): Promise<string | null> {
  try {
    const antwort = await fetch('/api/auth/me')
    if (!antwort.ok) return null
    const daten = (await antwort.json()) as { profile?: { handle?: string | null } }
    return daten.profile?.handle ?? null
  } catch {
    return null
  }
}

/** Profilseite: Kopf, Kennzahlen und die öffentlichen Touren dieser Person. */
export async function starteProfil(): Promise<void> {
  const buehne = $('buehne')
  const gitter = $('touren')
  const meldung = $('meldung')
  if (!buehne || !gitter || !meldung) return

  // Handle aus dem Pfad (/@henrik) oder ID aus der Query (?id=…) — die alte
  // Form bleibt bedienbar, weil solche Links längst geteilt sind.
  const wen = wenAusAdresse(window.location.pathname, window.location.search)
  if (!wen) {
    buehne.hidden = true
    zeigeFehler(meldung, 'Kein Profil angegeben.')
    return
  }

  let daten: ProfilAntwort
  try {
    const antwort = await fetch(`/api/users/${encodeURIComponent(wen)}/profile`)
    if (antwort.status === 404) {
      buehne.hidden = true
      zeigeFehler(meldung, 'Dieses Profil gibt es nicht (mehr).')
      return
    }
    if (!antwort.ok) throw new Error(String(antwort.status))
    daten = (await antwort.json()) as ProfilAntwort
  } catch {
    buehne.hidden = true
    zeigeFehler(meldung, 'Das Profil ließ sich gerade nicht laden.')
    return
  }

  // Auf die kanonische Adresse umschreiben, wenn der Aufruf über die alte Form
  // kam (?id=… oder ein aufgegebener Handle). Kein Redirect, sondern
  // replaceState: Die Seite steht schon, und ein zweiter Ladevorgang für
  // dieselbe Antwort wäre nur Wartezeit — der Verlauf bleibt sauber.
  if (daten.handle && window.location.pathname !== profilPfad(daten.handle)) {
    window.history.replaceState(null, '', profilPfad(daten.handle))
  }

  buehne.hidden = false
  zeichneBanner(daten)
  zeichneKopf(daten)
  zeichneLinks(daten)
  zeichneKennzahlen(daten)

  if (daten.tours.length === 0) {
    const leer = document.createElement('p')
    leer.className = 'hinweis'
    leer.textContent = 'Noch keine öffentlichen Reisen.'
    gitter.replaceWith(leer)
  } else {
    gitter.replaceChildren(...daten.tours.map(tourKachel))
  }

  const meins = istEigenes(daten, await eigenerHandle())
  if (daten.ownerOnly) {
    // Der Hinweis gilt nur dem Besitzer — sonst käme die Antwort gar nicht erst
    // an (404). Statt eines toten Teilen-Knopfes steht hier, warum.
    const chip = $('privat-chip')
    if (chip) chip.hidden = false
  } else {
    verdrahteTeilen(daten)
  }
  if (meins) {
    const { montiereBearbeiten } = await import('./profilbearbeiten.js')
    montiereBearbeiten(daten, () => window.location.reload())
  }
}
