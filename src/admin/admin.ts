// Benutzerverwaltung — DOM und Ablaufsteuerung. Was gerechnet wird, liegt in
// adminmodell.ts (DOM-frei, getestet); hier steht nur, wie es aussieht und was
// auf einen Klick passiert.
//
// Kein Router: Sperrseite und Verwaltung liegen beide im DOM und werden per
// `hidden` umgeschaltet — dasselbe Muster wie im Studio.

import { fuelleTopNav, montiereNavRechts } from '../app-nav.js'
import { haengePasswortfeld } from '../passwortfeld.js'
import * as api from './api.js'
import {
  beschreibeEinladung,
  beschreibeWartenden,
  einladenGesperrt,
  einladungsLink,
  filtereBenutzer,
  formatiereBytes,
  formatiereDatum,
  loeschenGesperrt,
  rolleGesperrt,
  zaehleAdmins,
  zaehleEinladungen,
  zaehleWarteliste,
  type AdminBenutzer,
  type AdminEinladung,
  type AdminWartender,
  type Rolle,
} from './adminmodell.js'

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

const els = {
  topNav: document.getElementById('top-nav'),
  navRechts: document.getElementById('nav-rechts'),
  sperre: $('sperre-view'),
  sperreTitel: $('sperre-titel'),
  sperreText: $('sperre-text'),
  sperreWeg: $<HTMLAnchorElement>('sperre-weg'),
  admin: $('admin-view'),
  pflichtSchalter: $<HTMLButtonElement>('pflicht-schalter'),
  pflichtText: $('pflicht-text'),
  zuWarnung: $('zu-warnung'),
  wlSchalter: $<HTMLButtonElement>('wl-schalter'),
  wlSchalterText: $('wl-schalter-text'),
  wartelisteListe: $('warteliste-liste'),
  wartelisteZusammenfassung: $('warteliste-zusammenfassung'),
  einladungenListe: $('einladungen-liste'),
  einladungenZusammenfassung: $('einladungen-zusammenfassung'),
  einladungNeu: $<HTMLButtonElement>('einladung-neu'),
  kontenListe: $('konten-liste'),
  kontenZusammenfassung: $('konten-zusammenfassung'),
  kontenSuche: $<HTMLInputElement>('konten-suche'),
  kontoNeu: $<HTMLButtonElement>('konto-neu'),
  // Konto-Dialog
  kontoDialog: $<HTMLDialogElement>('konto-dialog'),
  kontoForm: $<HTMLFormElement>('konto-form'),
  kdTitel: $('kd-titel'),
  kdUnterzeile: $('kd-unterzeile'),
  kdName: $<HTMLInputElement>('kd-name'),
  kdEmail: $<HTMLInputElement>('kd-email'),
  kdPasswort: $<HTMLInputElement>('kd-passwort'),
  kdPwZusatz: $('kd-pw-zusatz'),
  kdRolle: $<HTMLSelectElement>('kd-rolle'),
  kdRolleHinweis: $('kd-rolle-hinweis'),
  kdVerifiziert: $<HTMLInputElement>('kd-verifiziert'),
  kdFehler: $('kd-fehler'),
  kdSpeichern: $<HTMLButtonElement>('kd-speichern'),
  kdAbbrechen: $<HTMLButtonElement>('kd-abbrechen'),
  // Einladungs-Dialog
  einladungDialog: $<HTMLDialogElement>('einladung-dialog'),
  einladungForm: $<HTMLFormElement>('einladung-form'),
  edNotiz: $<HTMLInputElement>('ed-notiz'),
  edGueltig: $<HTMLSelectElement>('ed-gueltig'),
  edFehler: $('ed-fehler'),
  edAbbrechen: $<HTMLButtonElement>('ed-abbrechen'),
}

interface Zustand {
  ichId: string
  benutzer: AdminBenutzer[]
  einladungen: AdminEinladung[]
  warteliste: AdminWartender[]
  einladungPflicht: boolean
  wartelisteOffen: boolean
  registrierungOffen: boolean
  basisUrl: string
  suche: string
}

const z: Zustand = {
  ichId: '',
  benutzer: [],
  einladungen: [],
  warteliste: [],
  einladungPflicht: true,
  wartelisteOffen: true,
  registrierungOffen: true,
  basisUrl: location.origin,
  suche: '',
}

/** Welches Konto der Dialog gerade bearbeitet; null = ein neues anlegen. */
let bearbeitet: AdminBenutzer | null = null

// Auch ein vom Admin gesetztes Passwort wird bewertet — es schützt dasselbe
// Konto wie ein selbst gewähltes. Beim Bearbeiten darf das Feld leer bleiben
// („nicht ändern"), deshalb sperrt der Knopf nur bei tatsächlich schwacher Wahl.
const kdPasswortfeld = haengePasswortfeld(els.kdPasswort, {
  persoenlich: () => [els.kdName.value, els.kdEmail.value],
  beiAenderung: (befund) => {
    els.kdSpeichern.disabled = els.kdPasswort.value.length > 0 && !befund.reicht
  },
})

// — Rückmeldung —

let flashTimer = 0
function flash(text: string, art: 'ok' | 'fehler' = 'ok'): void {
  document.querySelector('.flash')?.remove()
  const el = document.createElement('div')
  el.className = art === 'fehler' ? 'flash fehler' : 'flash'
  el.textContent = text
  el.setAttribute('role', 'status')
  document.body.appendChild(el)
  clearTimeout(flashTimer)
  flashTimer = window.setTimeout(() => el.remove(), 4200)
}

const fehlerText = (fehler: unknown): string =>
  fehler instanceof Error ? fehler.message : 'Unbekannter Fehler'

// — Laden —

async function lade(): Promise<void> {
  const [konten, einladungen, warteliste] = await Promise.all([api.benutzer(), api.einladungen(), api.warteliste()])
  z.benutzer = konten.benutzer
  z.einladungen = einladungen.einladungen
  z.einladungPflicht = einladungen.einladungPflicht
  z.registrierungOffen = einladungen.registrierungOffen
  z.basisUrl = einladungen.basisUrl || location.origin
  z.warteliste = warteliste.eintraege
  z.wartelisteOffen = warteliste.wartelisteOffen
  render()
}

async function start(): Promise<void> {
  fuelleTopNav(els.topNav, 'admin')
  void montiereNavRechts(els.navRechts)
  const sitzung = await api.me()
  if (!sitzung.benutzer) {
    els.sperreTitel.textContent = 'Nicht angemeldet'
    els.sperreText.textContent = 'Melde dich an, um die Verwaltung zu öffnen.'
    els.sperreWeg.textContent = 'Zur Anmeldung'
    els.sperre.hidden = false
    return
  }
  if (sitzung.benutzer.rolle !== 'admin') {
    els.sperre.hidden = false
    return
  }
  z.ichId = sitzung.benutzer.id
  els.admin.hidden = false
  try {
    await lade()
  } catch (fehler) {
    flash(fehlerText(fehler), 'fehler')
  }
}

// — Rendern —

function render(): void {
  rendereRegistrierung()
  rendereWarteliste()
  rendereEinladungen()
  rendereKonten()
}

function rendereRegistrierung(): void {
  els.pflichtSchalter.setAttribute('aria-pressed', String(z.einladungPflicht))
  els.pflichtText.textContent = z.einladungPflicht
    ? 'Neue Konten entstehen nur über einen Einladungscode. Schalte es aus, damit sich jeder selbst anmelden kann.'
    : 'Jeder kann sich selbst anmelden — die Bestätigungsmail bleibt Pflicht. Schalte es ein, um wieder nur Eingeladene hereinzulassen.'
  els.zuWarnung.hidden = z.registrierungOffen

  els.wlSchalter.setAttribute('aria-pressed', String(z.wartelisteOffen))
  // Der Schalter ist eingeschaltet und trotzdem wirkungslos, solange sich jeder
  // anmelden kann — das gehört dazugesagt, sonst sucht man den Eintrag
  // vergeblich vor der Tür.
  const wirkungslos = z.wartelisteOffen && z.einladungPflicht === false && z.registrierungOffen
  els.wlSchalterText.textContent = wirkungslos
    ? 'Angeschaltet, aber ohne Wirkung: Solange sich jeder selbst anmelden kann, braucht niemand eine Warteliste.'
    : z.wartelisteOffen
      ? 'Wer keinen Code hat, kann seine Adresse hinterlassen und wird per Mail eingeladen.'
      : 'Ohne Code endet der Weg vor der Tür. Schalte es ein, um Adressen zu sammeln.'
}

function rendereWarteliste(): void {
  const zahl = zaehleWarteliste(z.warteliste)
  els.wartelisteZusammenfassung.textContent = z.warteliste.length
    ? `${zahl.wartend} ${zahl.wartend === 1 ? 'wartet' : 'warten'} · ${zahl.unbestaetigt} unbestätigt · ${zahl.eingeladen} eingeladen`
    : 'Noch niemand hat sich eingetragen.'

  els.wartelisteListe.replaceChildren(
    ...z.warteliste.map((e) => {
      const zeile = document.createElement('div')
      zeile.className = 'zeile zeile-warteliste'

      const haupt = document.createElement('div')
      haupt.className = 'haupt'
      const oben = document.createElement('div')
      oben.className = 'oben'
      const adresse = document.createElement('span')
      adresse.className = 'name'
      adresse.textContent = e.email
      const zustand = document.createElement('span')
      zustand.className = `badge ${{ unbestaetigt: 'unbestaetigt', wartend: 'offen', eingeladen: 'eingeloest' }[e.zustand]}`
      zustand.textContent = { unbestaetigt: 'Unbestätigt', wartend: 'Wartet', eingeladen: 'Eingeladen' }[e.zustand]
      oben.append(adresse, zustand)
      const unten = document.createElement('div')
      unten.className = 'unten'
      unten.textContent = beschreibeWartenden(e)
      haupt.append(oben, unten)
      if (e.notiz) {
        const zitat = document.createElement('div')
        zitat.className = 'zitat'
        zitat.textContent = `„${e.notiz}"`
        zitat.title = e.notiz
        haupt.append(zitat)
      }

      const datum = document.createElement('div')
      datum.className = 'kennzahl'
      datum.innerHTML = `<b>${formatiereDatum(e.eingetragenAm)}</b><span>eingetragen</span>`

      const griffe = document.createElement('div')
      griffe.className = 'griffe'
      const einladen = document.createElement('button')
      einladen.type = 'button'
      einladen.className = 'still'
      einladen.textContent = 'Einladen'
      const gesperrt = einladenGesperrt(e)
      if (gesperrt) {
        einladen.disabled = true
        einladen.title = gesperrt
        einladen.setAttribute('aria-label', `Einladen — ${gesperrt}`)
      } else {
        einladen.addEventListener('click', () => void ladeEinAusWarteliste(e, einladen))
      }
      const weg = document.createElement('button')
      weg.type = 'button'
      weg.className = 'still gefahr'
      weg.textContent = 'Entfernen'
      weg.addEventListener('click', () => void entferneWartenden(e))
      griffe.append(einladen, weg)

      zeile.append(haupt, datum, griffe)
      return zeile
    }),
  )
  if (!z.warteliste.length) {
    const leer = document.createElement('div')
    leer.className = 'leer'
    leer.textContent = 'Wer keinen Code hat, trägt sich hier ein — nach der Bestätigung per Mail steht er in dieser Liste.'
    els.wartelisteListe.append(leer)
  }
}

function rendereEinladungen(): void {
  const zahl = zaehleEinladungen(z.einladungen)
  els.einladungenZusammenfassung.textContent = z.einladungen.length
    ? `${zahl.offen} offen · ${zahl.eingeloest} eingelöst · ${zahl.abgelaufen} abgelaufen`
    : 'Noch keine Einladung erstellt.'

  els.einladungenListe.replaceChildren(
    ...z.einladungen.map((e) => {
      const zeile = document.createElement('div')
      zeile.className = 'zeile zeile-einladung'

      const haupt = document.createElement('div')
      haupt.className = 'haupt'
      const oben = document.createElement('div')
      oben.className = 'oben'
      const code = document.createElement('span')
      code.className = 'code'
      code.textContent = e.code
      const zustand = document.createElement('span')
      zustand.className = `badge ${e.zustand}`
      zustand.textContent = { offen: 'Offen', eingeloest: 'Eingelöst', abgelaufen: 'Abgelaufen' }[e.zustand]
      oben.append(code, zustand)
      if (e.notiz) {
        const notiz = document.createElement('span')
        notiz.style.color = 'var(--text-2)'
        notiz.style.fontSize = '13px'
        notiz.textContent = e.notiz
        oben.append(notiz)
      }
      const unten = document.createElement('div')
      unten.className = 'unten'
      unten.textContent = beschreibeEinladung(e)
      haupt.append(oben, unten)

      const griffe = document.createElement('div')
      griffe.className = 'griffe'
      if (e.zustand === 'offen') {
        const kopieren = document.createElement('button')
        kopieren.type = 'button'
        kopieren.className = 'still'
        kopieren.textContent = 'Link kopieren'
        kopieren.addEventListener('click', () => void kopiereLink(e.code))
        griffe.append(kopieren)
      }
      const weg = document.createElement('button')
      weg.type = 'button'
      weg.className = 'still gefahr'
      weg.textContent = e.zustand === 'offen' ? 'Widerrufen' : 'Entfernen'
      weg.addEventListener('click', () => void widerrufe(e))
      griffe.append(weg)

      const datum = document.createElement('div')
      datum.className = 'kennzahl'
      datum.innerHTML = `<b>${formatiereDatum(e.erstelltAm)}</b><span>erstellt</span>`

      zeile.append(haupt, datum, griffe)
      return zeile
    }),
  )
  if (!z.einladungen.length) {
    const leer = document.createElement('div')
    leer.className = 'leer'
    leer.textContent = 'Wer eingeladen wird, bekommt einen Code und einen Link dazu.'
    els.einladungenListe.append(leer)
  }
}

function rendereKonten(): void {
  const sichtbar = filtereBenutzer(z.benutzer, z.suche)
  const admins = zaehleAdmins(z.benutzer)
  els.kontenZusammenfassung.textContent =
    `${z.benutzer.length} ${z.benutzer.length === 1 ? 'Konto' : 'Konten'} · ${admins} mit Verwaltungsrecht` +
    (z.suche.trim() ? ` · ${sichtbar.length} passend` : '')

  els.kontenListe.replaceChildren(
    ...sichtbar.map((b) => {
      const zeile = document.createElement('div')
      zeile.className = 'zeile zeile-konto'

      const haupt = document.createElement('div')
      haupt.className = 'haupt'
      const oben = document.createElement('div')
      oben.className = 'oben'
      const name = document.createElement('span')
      name.className = 'name'
      name.textContent = b.name || b.email
      const rolle = document.createElement('span')
      rolle.className = `badge ${b.rolle}`
      rolle.textContent = b.rolle === 'admin' ? 'Administrator' : 'Nutzer'
      oben.append(name, rolle)
      if (b.fest) {
        const fest = document.createElement('span')
        fest.className = 'badge nutzer'
        fest.title = 'Steht in der Konfiguration — Rolle und Konto sind unantastbar'
        fest.textContent = 'Fest'
        oben.append(fest)
      }
      if (!b.verifiziert) {
        const offen = document.createElement('span')
        offen.className = 'badge unbestaetigt'
        offen.title = 'E-Mail noch nicht bestätigt — Hochladen ist gesperrt'
        offen.textContent = 'Unbestätigt'
        oben.append(offen)
      }
      const unten = document.createElement('div')
      unten.className = 'unten'
      unten.textContent = `${b.email} · seit ${formatiereDatum(b.angelegtAm)}`
      haupt.append(oben, unten)

      const touren = document.createElement('div')
      touren.className = 'kennzahl'
      touren.innerHTML = `<b>${b.touren}</b><span>${b.touren === 1 ? 'Tour' : 'Touren'}</span>`

      const speicher = document.createElement('div')
      speicher.className = 'kennzahl'
      speicher.innerHTML = `<b>${formatiereBytes(b.speicher)}</b><span>belegt</span>`

      const griffe = document.createElement('div')
      griffe.className = 'griffe'
      const bearbeiten = document.createElement('button')
      bearbeiten.type = 'button'
      bearbeiten.className = 'still'
      bearbeiten.textContent = 'Bearbeiten'
      bearbeiten.addEventListener('click', () => oeffneKonto(b))
      const weg = document.createElement('button')
      weg.type = 'button'
      weg.className = 'still gefahr'
      weg.textContent = 'Löschen'
      const gesperrt = loeschenGesperrt(b, z.ichId, admins)
      if (gesperrt) {
        weg.disabled = true
        weg.title = gesperrt
        // Der Grund gehört IN den Namen, nicht nur in den Tooltip: Ein `title`
        // allein verdrängt je nach Vorlese-Werkzeug das Wort „Löschen", und ein
        // gesperrter Knopf ohne Begründung ist eine Sackgasse.
        weg.setAttribute('aria-label', `Löschen — ${gesperrt}`)
      } else {
        weg.addEventListener('click', () => void loescheKonto(b))
      }
      griffe.append(bearbeiten, weg)

      zeile.append(haupt, touren, speicher, griffe)
      return zeile
    }),
  )
  if (!sichtbar.length) {
    const leer = document.createElement('div')
    leer.className = 'leer'
    leer.textContent = z.suche.trim() ? 'Kein Konto passt zur Suche.' : 'Noch keine Konten.'
    els.kontenListe.append(leer)
  }
}

// — Aktionen —

async function kopiereLink(code: string): Promise<void> {
  const link = einladungsLink(z.basisUrl, code)
  try {
    await navigator.clipboard.writeText(link)
    flash('Einladungslink kopiert')
  } catch {
    // Ohne Zwischenablage-Recht (unsicherer Kontext, alter Browser) bleibt der
    // Link wenigstens sichtbar und markierbar.
    window.prompt('Diesen Link weitergeben:', link)
  }
}

async function widerrufe(e: AdminEinladung): Promise<void> {
  const frage =
    e.zustand === 'offen'
      ? `Einladung ${e.code} widerrufen? Wer sie noch nicht eingelöst hat, kommt damit nicht mehr herein.`
      : `Einladung ${e.code} aus der Liste entfernen?`
  if (!window.confirm(frage)) return
  try {
    await api.widerrufe(e.code)
    await lade()
    flash('Einladung entfernt')
  } catch (fehler) {
    flash(fehlerText(fehler), 'fehler')
  }
}

/**
 * Einladen: Code erzeugen und verschicken — ein Klick, der eine Mail auslöst.
 *
 * Deshalb die Rückfrage mit der Adresse darin: Die Liste ist nach Datum
 * sortiert und rückt bei jedem Neuladen nach, ein Fehlgriff wäre eine Nachricht
 * an die falsche Person. Der Knopf sperrt währenddessen — der Server erzeugt
 * sonst zwei Codes für dieselbe Zeile.
 */
async function ladeEinAusWarteliste(e: AdminWartender, knopf: HTMLButtonElement): Promise<void> {
  if (!window.confirm(`Einladung an ${e.email} schicken? Der Code geht sofort per Mail raus.`)) return
  knopf.disabled = true
  try {
    const { einladung } = await api.ladeWartendenEin(e.id)
    await lade()
    flash(`Einladung ${einladung.code} an ${e.email} verschickt`)
  } catch (fehler) {
    flash(fehlerText(fehler), 'fehler')
    knopf.disabled = false
  }
}

async function entferneWartenden(e: AdminWartender): Promise<void> {
  if (!window.confirm(`${e.email} von der Warteliste entfernen? Die Adresse wird gelöscht.`)) return
  try {
    await api.loescheWartenden(e.id)
    await lade()
    flash('Von der Warteliste entfernt')
  } catch (fehler) {
    flash(fehlerText(fehler), 'fehler')
  }
}

async function loescheKonto(b: AdminBenutzer): Promise<void> {
  const was = b.touren > 0 ? ` Damit gehen ${b.touren} ${b.touren === 1 ? 'Tour' : 'Touren'} samt Fotos verloren.` : ''
  if (!window.confirm(`Konto „${b.name || b.email}" endgültig löschen?${was}`)) return
  try {
    await api.loesche(b.id)
    await lade()
    flash('Konto gelöscht')
  } catch (fehler) {
    flash(fehlerText(fehler), 'fehler')
  }
}

els.pflichtSchalter.addEventListener('click', async () => {
  const neu = !z.einladungPflicht
  els.pflichtSchalter.disabled = true
  try {
    const antwort = await api.setzeEinstellungen({ einladungPflicht: neu })
    z.einladungPflicht = antwort.einladungPflicht
    z.wartelisteOffen = antwort.wartelisteOffen
    rendereRegistrierung()
    flash(neu ? 'Registrierung nur noch mit Einladung' : 'Registrierung steht allen offen')
  } catch (fehler) {
    flash(fehlerText(fehler), 'fehler')
  } finally {
    els.pflichtSchalter.disabled = false
  }
})

els.wlSchalter.addEventListener('click', async () => {
  const neu = !z.wartelisteOffen
  els.wlSchalter.disabled = true
  try {
    const antwort = await api.setzeEinstellungen({ wartelisteOffen: neu })
    z.einladungPflicht = antwort.einladungPflicht
    z.wartelisteOffen = antwort.wartelisteOffen
    rendereRegistrierung()
    flash(neu ? 'Die Warteliste steht wieder vor der Tür' : 'Die Warteliste wird nicht mehr angeboten')
  } catch (fehler) {
    flash(fehlerText(fehler), 'fehler')
  } finally {
    els.wlSchalter.disabled = false
  }
})

els.kontenSuche.addEventListener('input', () => {
  z.suche = els.kontenSuche.value
  rendereKonten()
})

// — Konto-Dialog —

function oeffneKonto(b: AdminBenutzer | null): void {
  bearbeitet = b
  els.kdFehler.textContent = ''
  els.kdTitel.textContent = b ? 'Konto bearbeiten' : 'Konto anlegen'
  els.kdUnterzeile.textContent = b
    ? 'Änderungen greifen sofort.'
    : 'Das Konto ist sofort nutzbar — ohne Bestätigungsmail.'
  els.kdName.value = b?.name ?? ''
  els.kdEmail.value = b?.email ?? ''
  // Über `leere()`, nicht über `value = ''`: sonst bliebe die Stärkeanzeige des
  // vorigen Aufrufs stehen und der Speichern-Knopf womöglich gesperrt.
  kdPasswortfeld.leere()
  els.kdPasswort.required = !b
  els.kdPwZusatz.textContent = b ? '— leer lassen, um es nicht zu ändern' : '— mindestens 8 Zeichen'
  els.kdRolle.value = b?.rolle ?? 'nutzer'
  els.kdVerifiziert.checked = b ? b.verifiziert : true
  els.kdSpeichern.textContent = b ? 'Speichern' : 'Anlegen'

  // Eine Rolle, die der Server ohnehin ablehnen würde, gar nicht erst anbieten.
  const gesperrt = b ? rolleGesperrt(b, z.ichId, zaehleAdmins(z.benutzer)) : ''
  els.kdRolle.disabled = !!gesperrt
  els.kdRolleHinweis.textContent = gesperrt
  els.kontoDialog.showModal()
  els.kdName.focus()
}

els.kontoNeu.addEventListener('click', () => oeffneKonto(null))
els.kdAbbrechen.addEventListener('click', () => els.kontoDialog.close())
els.edAbbrechen.addEventListener('click', () => els.einladungDialog.close())

els.kontoForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  els.kdFehler.textContent = ''
  const name = els.kdName.value.trim()
  const email = els.kdEmail.value.trim()
  const passwort = els.kdPasswort.value
  const rolle = els.kdRolle.value as Rolle
  const verifiziert = els.kdVerifiziert.checked
  els.kdSpeichern.disabled = true
  try {
    if (bearbeitet) {
      const felder: api.KontoFelder = { name, email, verifiziert }
      // Die Rolle nur mitschicken, wenn sie überhaupt wählbar war — sonst
      // hinge an einem gesperrten Feld eine stille Änderung.
      if (!els.kdRolle.disabled) felder.rolle = rolle
      if (passwort) felder.passwort = passwort
      await api.aendere(bearbeitet.id, felder)
    } else {
      await api.legeAn({ name, email, passwort, rolle, verifiziert })
    }
    els.kontoDialog.close()
    await lade()
    flash(bearbeitet ? 'Konto gespeichert' : 'Konto angelegt')
  } catch (fehler) {
    els.kdFehler.textContent = fehlerText(fehler)
  } finally {
    els.kdSpeichern.disabled = false
  }
})

// — Einladungs-Dialog —

els.einladungNeu.addEventListener('click', () => {
  els.edFehler.textContent = ''
  els.edNotiz.value = ''
  els.einladungDialog.showModal()
  els.edNotiz.focus()
})

els.einladungForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  els.edFehler.textContent = ''
  try {
    const { einladung } = await api.ladeEin(els.edNotiz.value.trim(), Number(els.edGueltig.value))
    els.einladungDialog.close()
    await lade()
    // Direkt in die Zwischenablage: Der Code ist genau dann nützlich, wenn er
    // beim Empfänger ankommt — ein Extra-Klick dazwischen ist nur Wartezeit.
    await kopiereLink(einladung.code)
  } catch (fehler) {
    els.edFehler.textContent = fehlerText(fehler)
  }
})

void start()
