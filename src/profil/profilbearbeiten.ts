// Das Bearbeiten-Modal — nur für den Besitzer, deshalb erst hier nachgeladen
// (s. profil.ts). Es baut seinen DOM selbst: Als Markup in profil.html läge es
// bei jedem Besucher im Dokument, der es nie öffnen kann.
//
// Bewusst ein Modal und kein `contenteditable` im Text: Enter, eingefügtes
// HTML und Firefox' eigene Vorstellungen davon sind drei Baustellen, und
// „Verwerfen" ist in einem Formular ein Schließen statt einer Rücknahme.

import { oeffneSchicht } from '../dialogschicht.js'
import { HANDLE_TEXTE, pruefeHandleForm, zuHandle } from '../handle.js'
import { profilPfad } from '../routen.js'
import { zeichne } from './profil.js'
import type { ProfilAntwort } from './profilmodell.js'
import { TITELBILDER, titelbildPfad } from './titelbilder.js'

/** Bio-Grenze wie im Server-Schema (dort 500) — hier die Empfehlung des Mockups. */
const BIO_MAX = 300

interface Felder {
  anzeigename: HTMLInputElement
  ort: HTMLInputElement
  handle: HTMLInputElement
  bio: HTMLTextAreaElement
  website: HTMLInputElement
  instagram: HTMLInputElement
  sichtbarkeit: HTMLInputElement
}

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

/** Feld mit Beschriftung; `vorsatz` ist das feststehende Zeichen davor („@"). */
function feld(
  id: string,
  beschriftung: string,
  wert: string,
  vorsatz?: string,
): { huelle: HTMLElement; eingabe: HTMLInputElement } {
  const huelle = el('div', 'sp-feld')
  const label = el('label', undefined, beschriftung)
  label.htmlFor = id
  huelle.appendChild(label)
  const eingabe = el('input')
  eingabe.id = id
  eingabe.type = 'text'
  eingabe.value = wert
  eingabe.autocomplete = 'off'
  if (vorsatz) {
    const kasten = el('div', 'vorsatz-feld')
    kasten.appendChild(el('span', 'fest', vorsatz))
    kasten.appendChild(eingabe)
    huelle.appendChild(kasten)
  } else {
    huelle.appendChild(eingabe)
  }
  return { huelle, eingabe }
}

async function sendeProfil(daten: Record<string, unknown>): Promise<{ ok: true } | { ok: false; fehler: string }> {
  try {
    const antwort = await fetch('/api/auth/me/profil', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(daten),
    })
    if (antwort.ok) return { ok: true }
    const koerper = (await antwort.json().catch(() => ({}))) as { fehler?: string }
    return { ok: false, fehler: koerper.fehler ?? 'Das ließ sich gerade nicht speichern.' }
  } catch {
    return { ok: false, fehler: 'Keine Verbindung zum Server.' }
  }
}

/**
 * Der Titelbild-Dialog: vier Vorschläge und ein eigenes Bild.
 *
 * Die Vorschläge sind statische Dateien im Build, das eigene Bild geht den Weg
 * des Avatars. Beide enden im selben Feld — welcher Fall vorliegt, erkennt der
 * Server am Schrägstrich (s. server/src/profilfelder.ts).
 */
function oeffneTitelbild(fertig: () => void): void {
  const { koerper, fuss, schliesse } = oeffneSchicht('Titelbild')
  koerper.appendChild(
    el(
      'p',
      'sp-hinweis',
      'Das Bild über deinem Profil — quer, breit und am besten aus einer deiner Touren. ' +
        'Ohne eigene Wahl steht dort eines der vier.',
    ),
  )

  let wahl: string | null = null
  const raster = el('div', 'stile')
  for (const bild of TITELBILDER) {
    const knopf = el('button', 'stil')
    knopf.type = 'button'
    knopf.style.backgroundImage = `url("${titelbildPfad(bild.datei)}")`
    knopf.setAttribute('aria-label', bild.wort)
    knopf.addEventListener('click', () => {
      wahl = bild.datei
      for (const k of raster.querySelectorAll('.stil')) k.classList.remove('gewaehlt')
      knopf.classList.add('gewaehlt')
    })
    raster.appendChild(knopf)
  }
  koerper.appendChild(raster)

  const datei = el('input')
  datei.type = 'file'
  datei.accept = 'image/*'
  datei.hidden = true
  koerper.appendChild(datei)

  const eigenes = el('button', 'still')
  eigenes.type = 'button'
  eigenes.appendChild(zeichne('bild'))
  eigenes.appendChild(document.createTextNode(' Eigenes Bild hochladen'))
  eigenes.addEventListener('click', () => datei.click())

  // „Zurücksetzen" und nicht „Entfernen": Danach steht dort nicht nichts,
  // sondern wieder das mitgelieferte Bild (s. standardTitelbild).
  const entfernen = el('button', 'still', 'Zurücksetzen')
  entfernen.type = 'button'

  const zeile = el('div', 'sp-nebenzeile')
  zeile.append(eigenes, entfernen)
  koerper.appendChild(zeile)

  const melde = el('p', 'sp-fehler')
  melde.hidden = true
  koerper.appendChild(melde)

  const abbrechen = el('button', 'still', 'Abbrechen')
  abbrechen.type = 'button'
  abbrechen.addEventListener('click', schliesse)
  const uebernehmen = el('button', 'primaer', 'Übernehmen')
  uebernehmen.type = 'button'
  fuss.append(abbrechen, uebernehmen)

  const scheitere = (text: string): void => {
    melde.textContent = text
    melde.hidden = false
  }

  datei.addEventListener('change', async () => {
    const bild = datei.files?.[0]
    if (!bild) return
    uebernehmen.disabled = true
    eigenes.disabled = true
    try {
      const antwort = await fetch('/api/auth/me/titelbild', {
        method: 'PUT',
        headers: { 'content-type': 'image/jpeg' },
        body: bild,
      })
      if (!antwort.ok) throw new Error(String(antwort.status))
      schliesse()
      fertig()
    } catch {
      scheitere('Das Bild ließ sich nicht hochladen. Vielleicht ist es zu groß?')
      uebernehmen.disabled = false
      eigenes.disabled = false
    }
  })

  entfernen.addEventListener('click', async () => {
    await fetch('/api/auth/me/titelbild', { method: 'DELETE' }).catch(() => undefined)
    // Auch die gewählte Vorschlags-WAHL muss weg, nicht nur das hochgeladene
    // Bild: Zurückgesetzt wird auf „keine eigene Entscheidung" — was danach im
    // Banner steht, bestimmt `standardTitelbild`.
    await sendeProfil({ titelbild: '' })
    schliesse()
    fertig()
  })

  uebernehmen.addEventListener('click', async () => {
    if (!wahl) return schliesse()
    uebernehmen.disabled = true
    const ergebnis = await sendeProfil({ titelbild: wahl })
    if (!ergebnis.ok) {
      scheitere(ergebnis.fehler)
      uebernehmen.disabled = false
      return
    }
    schliesse()
    fertig()
  })
}

/** Das Profil-Formular. */
function oeffneProfil(profil: ProfilAntwort, fertig: () => void): void {
  const { koerper, fuss, schliesse } = oeffneSchicht('Profil bearbeiten')

  const name = feld('e-name', 'Name', profil.anzeigename ?? '')
  const ort = feld('e-ort', 'Ort', profil.ort ?? '')
  const paar = el('div', 'sp-reihe')
  paar.append(name.huelle, ort.huelle)
  koerper.appendChild(paar)

  const handle = feld('e-handle', 'Profil-Adresse', profil.handle ?? '', `${window.location.host}/@`)
  handle.eingabe.maxLength = 30
  handle.eingabe.spellcheck = false
  const handleStand = el('div', 'handle-stand')
  handleStand.setAttribute('role', 'status')
  handle.huelle.appendChild(handleStand)
  koerper.appendChild(handle.huelle)

  const bioHuelle = el('div', 'sp-feld')
  const bioLabel = el('label', undefined, 'Über mich ')
  bioLabel.htmlFor = 'e-bio'
  const zaehler = el('span', 'zaehler')
  bioLabel.appendChild(zaehler)
  bioHuelle.appendChild(bioLabel)
  const bio = el('textarea')
  bio.id = 'e-bio'
  bio.maxLength = BIO_MAX
  bio.value = profil.bio ?? ''
  bio.placeholder = 'Zwei Sätze über dich und deine Reisen.'
  bioHuelle.appendChild(bio)
  koerper.appendChild(bioHuelle)

  const web = feld('e-web', 'Website', profil.website ?? '', 'https://')
  web.eingabe.placeholder = 'beispiel.de'
  const insta = feld('e-insta', 'Instagram', profil.instagram ?? '', '@')
  insta.eingabe.placeholder = 'benutzername'
  const linkPaar = el('div', 'sp-reihe')
  linkPaar.append(web.huelle, insta.huelle)
  koerper.appendChild(linkPaar)

  // Zweite Bedienstelle für denselben Zustand (die erste kommt mit den
  // Kontoeinstellungen). Bewusst doppelt: Hier sucht man sie beim Bearbeiten,
  // dort beim Aufräumen — auseinanderlaufen kann nichts, weil beide dasselbe
  // Feld schreiben.
  const schalterZeile = el('div', 'sp-schalterzeile')
  const schalterText = el('label', 'z')
  schalterText.htmlFor = 's-profil'
  schalterText.appendChild(el('span', 't', 'Öffentliches Profil'))
  const erklaerung = el('span', 'b')
  schalterText.appendChild(erklaerung)
  const schalter = el('input')
  schalter.id = 's-profil'
  schalter.type = 'checkbox'
  schalter.className = 'schalter'
  schalter.checked = !profil.nurFuerDich
  schalterZeile.append(schalterText, schalter)
  koerper.appendChild(schalterZeile)

  const melde = el('p', 'sp-fehler')
  melde.hidden = true
  koerper.appendChild(melde)

  const felder: Felder = {
    anzeigename: name.eingabe,
    ort: ort.eingabe,
    handle: handle.eingabe,
    bio,
    website: web.eingabe,
    instagram: insta.eingabe,
    sichtbarkeit: schalter,
  }

  const abbrechen = el('button', 'still', 'Abbrechen')
  abbrechen.type = 'button'
  abbrechen.addEventListener('click', schliesse)
  const speichern = el('button', 'primaer', 'Speichern')
  speichern.type = 'button'
  fuss.append(abbrechen, speichern)

  // — Laufende Rückmeldung —

  const zeigeBio = (): void => {
    zaehler.textContent = `${bio.value.length}/${BIO_MAX}`
    zaehler.classList.toggle('knapp', bio.value.length > BIO_MAX - 40)
  }

  const zeigeHandle = (): void => {
    const wert = felder.handle.value.trim().toLowerCase()
    const eigener = (profil.handle ?? '').toLowerCase()
    // Der eigene Handle ist immer in Ordnung — die Prüfung sagt sonst
    // „reserviert", sobald jemand zufällig so heißt wie eine Seite.
    const fehler = wert === eigener ? null : pruefeHandleForm(wert)
    handleStand.className = `handle-stand ${fehler ? 'belegt' : 'frei'}`
    handleStand.textContent = fehler
      ? HANDLE_TEXTE[fehler]
      : wert === eigener
        ? 'Das ist deine aktuelle Adresse.'
        : `@${wert} sieht gut aus — ob sie frei ist, sagt dir das Speichern.`
    erklaerung.textContent = `Name, Ort, Text, Links und deine öffentlichen Touren sind unter ${window.location.host}${profilPfad(wert || '…')} für alle sichtbar.`
    speichern.disabled = !!fehler
  }

  bio.addEventListener('input', zeigeBio)
  // Kleinschreibung erzwingen: Groß/Klein unterscheidet in URLs nicht, ein
  // gemischtes @Henrik wäre nur Zierde mit Fehlerquelle. Die Schreibmarke muss
  // dabei mitwandern, sonst springt sie bei jedem Zeichen ans Ende.
  felder.handle.addEventListener('input', () => {
    const vorher = felder.handle.value
    const pos = felder.handle.selectionStart ?? vorher.length
    const neu = zuHandle(vorher)
    if (neu !== vorher) {
      felder.handle.value = neu
      const versatz = Math.max(0, pos + neu.length - vorher.length)
      felder.handle.setSelectionRange(versatz, versatz)
    }
    zeigeHandle()
  })
  zeigeBio()
  zeigeHandle()
  window.setTimeout(() => felder.anzeigename.focus(), 0)

  speichern.addEventListener('click', async () => {
    speichern.disabled = true
    melde.hidden = true
    const ergebnis = await sendeProfil({
      anzeigename: felder.anzeigename.value,
      ort: felder.ort.value,
      handle: felder.handle.value,
      bio: felder.bio.value,
      website: felder.website.value,
      instagram: felder.instagram.value,
      sichtbarkeit: felder.sichtbarkeit.checked ? 'public' : 'private',
    })
    if (!ergebnis.ok) {
      melde.textContent = ergebnis.fehler
      melde.hidden = false
      speichern.disabled = false
      return
    }
    schliesse()
    fertig()
  })
}

/**
 * Hängt die Bearbeiten-Knöpfe an die Seite. `fertig` läuft nach jedem
 * gespeicherten Zug — die Seite lädt sich dann neu, statt den halben DOM von
 * Hand nachzuziehen (der Sichtbarkeits-Schalter ändert auch, was der Server
 * überhaupt ausliefert).
 */
export function montiereBearbeiten(profil: ProfilAntwort, fertig: () => void): void {
  const bearbeiten = document.getElementById('btn-bearbeiten') as HTMLButtonElement | null
  if (bearbeiten) {
    bearbeiten.hidden = false
    bearbeiten.addEventListener('click', () => oeffneProfil(profil, fertig))
  }
  const titelbild = document.getElementById('btn-titelbild') as HTMLButtonElement | null
  if (titelbild) {
    titelbild.hidden = false
    titelbild.addEventListener('click', () => oeffneTitelbild(fertig))
  }
}
