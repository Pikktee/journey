// Studio-UI (M6): Login, Tour-Liste und der Upload-Fluss (GPX + Medien →
// Manifest → PUTs → Finalize → Status-Polling). Reine Logik liegt in upload.ts
// (Manifest-Bau) und exif.ts (Foto-Metadaten); hier nur DOM + Ablaufsteuerung.
// Eine Dropzone nimmt GPX und Medien gemeinsam an und sortiert nach Dateityp.

import * as api from './api.js'
import { liesExif } from './exif.js'
import {
  baueUploadManifest,
  exifDatumZuMs,
  gpxPunktAnzahl,
  gpxZeitspanne,
  isoMitZone,
  medientyp,
  type MediumEingabe,
} from './upload.js'

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T
const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

const els = {
  loginView: $('login-view'),
  appView: $('app-view'),
  abmelden: $<HTMLButtonElement>('abmelden'),
  benutzerChip: $<HTMLButtonElement>('benutzer-chip'),
  benutzerName: $('benutzer-name'),
  benutzerInitial: $('benutzer-initial'),
  loginForm: $<HTMLFormElement>('login-form'),
  email: $<HTMLInputElement>('email'),
  passwort: $<HTMLInputElement>('passwort'),
  loginFehler: $('login-fehler'),
  // M9: Registrierung / Passwort-Reset
  authBox: $('auth-box'),
  registerForm: $<HTMLFormElement>('register-form'),
  regName: $<HTMLInputElement>('reg-name'),
  regEmail: $<HTMLInputElement>('reg-email'),
  regPasswort: $<HTMLInputElement>('reg-passwort'),
  registerFehler: $('register-fehler'),
  resetAnfordernForm: $<HTMLFormElement>('reset-anfordern-form'),
  resetEmail: $<HTMLInputElement>('reset-email'),
  resetAnfordernStatus: $('reset-anfordern-status'),
  resetSetzenForm: $<HTMLFormElement>('reset-setzen-form'),
  resetPasswort: $<HTMLInputElement>('reset-passwort'),
  resetSetzenFehler: $('reset-setzen-fehler'),
  // M9: Konto-Menü + Verifikations-Banner
  kontoMenue: $('konto-menue'),
  kmMail: $('km-mail'),
  kmQuotaText: $('km-quota-text'),
  kmBalkenFuell: $('km-balken-fuell'),
  kontoLoeschen: $<HTMLButtonElement>('konto-loeschen'),
  verifyBanner: $('verify-banner'),
  dropzone: $('dropzone'),
  dateien: $<HTMLInputElement>('dateien'),
  gpxChip: $('gpx-chip'),
  medienRaster: $('medien-raster'),
  medienInfo: $('medien-info'),
  titel: $<HTMLInputElement>('titel'),
  hochladen: $<HTMLButtonElement>('hochladen'),
  fortschritt: $<HTMLProgressElement>('fortschritt'),
  uploadStatus: $('upload-status'),
  liste: $('liste'),
  tourenAnzahl: $('touren-anzahl'),
}

/** Statisches Icon aus dem Sprite in studio.html (nur für vertrauten Markup-Bau). */
const icon = (name: string): string => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`

// — Auswahl-Zustand des Uploads —

let gpxDatei: File | null = null
let gpxText: string | null = null
let medienDateien: File[] = []
const vorschauUrls = new Map<File, string>()

// — Ansicht Login/App —

function zeige(angemeldet: boolean): void {
  els.loginView.hidden = angemeldet
  els.appView.hidden = !angemeldet
  els.abmelden.hidden = !angemeldet
  els.benutzerChip.hidden = !angemeldet
}

function zeigeBenutzer(benutzer: api.Benutzer | null): void {
  const anzeige = benutzer?.name || benutzer?.email || ''
  els.benutzerName.textContent = anzeige
  els.benutzerInitial.textContent = anzeige.slice(0, 1)
  els.kmMail.textContent = benutzer?.email ?? ''
}

// — Auth-Modus umschalten (Anmelden / Registrieren / Reset) —
type AuthModus = 'login' | 'register' | 'reset-anfordern' | 'reset-setzen'
const authFormen: Record<AuthModus, HTMLFormElement> = {
  login: els.loginForm,
  register: els.registerForm,
  'reset-anfordern': els.resetAnfordernForm,
  'reset-setzen': els.resetSetzenForm,
}

function zeigeAuthModus(modus: AuthModus): void {
  for (const [name, form] of Object.entries(authFormen)) form.hidden = name !== modus
}

// Modus-Wechsel-Links (data-modus) in allen Auth-Formularen
els.authBox.querySelectorAll<HTMLButtonElement>('[data-modus]').forEach((btn) => {
  btn.addEventListener('click', () => {
    els.loginFehler.textContent = ''
    els.registerFehler.textContent = ''
    zeigeAuthModus(btn.dataset.modus as AuthModus)
  })
})

/** Verifikations-Stand: Banner + Upload-Sperre + Quota-Balken aktualisieren. */
let uploadGesperrt = false

function zeigeSitzung(sitzung: api.Sitzung): void {
  const unbestaetigt = sitzung.benutzer !== null && sitzung.verifiziert === false
  els.verifyBanner.hidden = !unbestaetigt
  uploadGesperrt = unbestaetigt
  els.hochladen.title = unbestaetigt ? 'Erst E-Mail bestätigen' : ''
  aktualisiereUploadKnopf()
  if (sitzung.quota) {
    const mb = (b: number): string => (b / (1024 * 1024)).toFixed(0)
    const anteil = sitzung.quota.limit > 0 ? sitzung.quota.benutzt / sitzung.quota.limit : 0
    els.kmQuotaText.textContent = `${mb(sitzung.quota.benutzt)} / ${mb(sitzung.quota.limit)} MB`
    els.kmBalkenFuell.style.width = `${Math.min(100, anteil * 100).toFixed(0)}%`
    els.kmBalkenFuell.classList.toggle('voll', anteil > 0.9)
  }
}

async function ladeSitzung(): Promise<api.Sitzung> {
  const sitzung = await api.me()
  zeigeBenutzer(sitzung.benutzer)
  zeige(!!sitzung.benutzer)
  if (sitzung.benutzer) {
    zeigeSitzung(sitzung)
    await ladeListe()
  }
  return sitzung
}

async function pruefeAnmeldung(): Promise<void> {
  // Zuerst Mail-Links aus der URL abarbeiten (#verify=… / #reset=…)
  await behandleAuthHash()
  await ladeSitzung()
}

/** E-Mail-Bestätigung / Reset-Link aus dem URL-Fragment behandeln. */
async function behandleAuthHash(): Promise<void> {
  const hash = location.hash.slice(1)
  const verify = hash.match(/(?:^|&)verify=([^&]+)/)?.[1]
  const reset = hash.match(/(?:^|&)reset=([^&]+)/)?.[1]
  if (verify) {
    history.replaceState(null, '', location.pathname + location.search)
    try {
      await api.verifiziereEmail(decodeURIComponent(verify))
      hinweisToast('E-Mail bestätigt — du kannst jetzt hochladen.') // danach eingeloggt → App-View sichtbar
    } catch (fehler) {
      // Fehlschlag heißt: nicht eingeloggt → App-View bleibt verborgen. Die
      // Meldung gehört daher ins (sichtbare) Login-Fehlerfeld.
      els.loginFehler.textContent = (fehler as Error).message
    }
  } else if (reset) {
    history.replaceState(null, '', location.pathname + location.search)
    resetToken = decodeURIComponent(reset)
    zeigeAuthModus('reset-setzen')
  }
}

let resetToken: string | null = null

els.loginForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  els.loginFehler.textContent = ''
  try {
    await api.login(els.email.value.trim(), els.passwort.value)
    els.passwort.value = ''
    await ladeSitzung()
  } catch (fehler) {
    els.loginFehler.textContent = (fehler as Error).message
  }
})

els.registerForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  els.registerFehler.textContent = ''
  try {
    await api.registriere(els.regEmail.value.trim(), els.regPasswort.value, els.regName.value.trim())
    els.regPasswort.value = ''
    await ladeSitzung() // direkt eingeloggt; Banner „bitte bestätigen" erscheint
  } catch (fehler) {
    els.registerFehler.textContent = (fehler as Error).message
  }
})

els.resetAnfordernForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  await api.passwortResetAnfordern(els.resetEmail.value.trim())
  // Bewusst neutrale Rückmeldung (keine Existenz-Auskunft)
  els.resetAnfordernStatus.textContent = 'Falls ein Konto existiert, ist eine E-Mail unterwegs.'
  els.resetAnfordernStatus.className = 'hinweis ok'
})

els.resetSetzenForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  els.resetSetzenFehler.textContent = ''
  if (!resetToken) return
  try {
    await api.passwortReset(resetToken, els.resetPasswort.value)
    resetToken = null
    await ladeSitzung()
  } catch (fehler) {
    els.resetSetzenFehler.textContent = (fehler as Error).message
  }
})

els.abmelden.addEventListener('click', async () => {
  await api.logout()
  zeige(false)
  zeigeAuthModus('login')
})

// — Konto-Menü (Quota + Konto löschen) —
els.benutzerChip.addEventListener('click', () => {
  const auf = els.kontoMenue.hidden
  els.kontoMenue.hidden = !auf
  els.benutzerChip.setAttribute('aria-expanded', String(auf))
})
document.addEventListener('click', (e) => {
  if (!els.kontoMenue.hidden && !(e.target as HTMLElement).closest('.konto-wrap')) {
    els.kontoMenue.hidden = true
    els.benutzerChip.setAttribute('aria-expanded', 'false')
  }
})

els.kontoLoeschen.addEventListener('click', async () => {
  // Zweistufig: erster Klick schärft, zweiter löscht endgültig.
  if (!els.kontoLoeschen.dataset.scharf) {
    els.kontoLoeschen.dataset.scharf = '1'
    els.kontoLoeschen.textContent = 'Endgültig löschen — alle Touren!'
    setTimeout(() => {
      if (!els.kontoLoeschen.isConnected || !els.kontoLoeschen.dataset.scharf) return
      delete els.kontoLoeschen.dataset.scharf
      els.kontoLoeschen.textContent = 'Konto löschen …'
    }, 4000)
    return
  }
  await api.loescheKonto()
  location.reload()
})

function hinweisToast(text: string, fehler = false): void {
  els.uploadStatus.textContent = text
  els.uploadStatus.className = fehler ? 'upload-status fehler' : 'upload-status ok'
}

// — Tour-Liste —

function badge(status: string): string {
  const klasse = ['bereit', 'verarbeitung', 'fehler', 'angelegt'].includes(status) ? status : 'angelegt'
  return `<span class="badge ${klasse}">${status}</span>`
}

function datum(iso: string): string {
  const d = new Date(iso)
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : ''
}

/** Sichtbarkeits-Auswahl je Tour (M9): privat / per Link / öffentlich. */
function sichtbarkeitSelect(id: string, aktuell: string): string {
  const opt = (wert: string, text: string): string =>
    `<option value="${wert}"${wert === aktuell ? ' selected' : ''}>${text}</option>`
  return `<select class="sicht-select" data-sicht="${id}" title="Sichtbarkeit" aria-label="Sichtbarkeit">
    ${opt('private', 'Privat')}${opt('unlisted', 'Per Link')}${opt('public', 'Öffentlich')}
  </select>`
}

async function ladeListe(): Promise<void> {
  els.liste.innerHTML = '<div class="skelett"><div class="zeile"></div><div class="zeile"></div><div class="zeile"></div></div>'
  els.tourenAnzahl.textContent = ''
  let touren: api.TourListe[]
  try {
    touren = await api.listeTouren()
  } catch {
    els.liste.innerHTML = '<div class="leer-buehne"><div class="lb-titel">Touren konnten nicht geladen werden</div><p>Der Server hat nicht geantwortet — kurz warten und die Seite neu laden.</p></div>'
    return
  }
  els.tourenAnzahl.textContent = touren.length === 1 ? '1 Tour' : `${touren.length} Touren`
  if (!touren.length) {
    els.liste.innerHTML = `<div class="leer-buehne">${icon('route')}<div class="lb-titel">Noch keine Touren</div><p>Zieh links eine GPX-Aufzeichnung mit Fotos und Videos hinein — daraus wird deine erste Kamerafahrt.</p></div>`
    return
  }
  els.liste.innerHTML = ''
  for (const t of touren) {
    const el = document.createElement('article')
    el.className = 'tour'
    const meta = [t.stats ? `${t.stats.km} km` : '', datum(t.createdAt), t.fehler ? escape(t.fehler) : '']
      .filter(Boolean)
      .join(' · ')
    el.innerHTML = `
      <span class="nummer">${escape(t.no)}</span>
      <div class="titel"><div class="t-name">${escape(t.title ?? '(ohne Titel)')}</div><small>${meta}</small></div>
      ${badge(t.status)}
      <div class="tour-actions">
        ${t.status === 'bereit' ? sichtbarkeitSelect(t.id, t.visibility) : ''}
        ${t.status === 'bereit' ? `<a class="knopf" href="/?tour=srv:${t.id}" target="_blank" rel="noopener">${icon('play')}Abspielen</a>` : ''}
        ${t.status === 'bereit' || t.status === 'fehler' ? `<button data-bearbeiten="${t.id}">${icon('stift')}Bearbeiten</button>` : ''}
        <button class="icon gefahr" data-loeschen="${t.id}" title="Tour löschen" aria-label="Tour löschen">${icon('muell')}</button>
      </div>`
    els.liste.appendChild(el)
  }
  // Sichtbarkeit ändern → PATCH; „unlisted"/„public" = per Link teilbar
  els.liste.querySelectorAll<HTMLSelectElement>('[data-sicht]').forEach((sel) => {
    sel.addEventListener('change', async () => {
      await api.patchTour(sel.dataset.sicht!, { visibility: sel.value as 'private' | 'unlisted' | 'public' })
    })
  })
  els.liste.querySelectorAll<HTMLButtonElement>('[data-loeschen]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      // Zweistufig statt confirm(): erster Klick schärft, zweiter löscht.
      if (!btn.dataset.scharf) {
        btn.dataset.scharf = '1'
        btn.classList.remove('icon')
        btn.textContent = 'Wirklich löschen?'
        setTimeout(() => {
          if (!btn.isConnected || !btn.dataset.scharf) return
          delete btn.dataset.scharf
          btn.classList.add('icon')
          btn.innerHTML = icon('muell')
        }, 3500)
        return
      }
      btn.disabled = true
      await api.loescheTour(btn.dataset.loeschen!)
      await ladeListe()
    })
  })
  // Editor (M7) lazy laden — MapLibre kommt erst beim ersten Bearbeiten
  els.liste.querySelectorAll<HTMLButtonElement>('[data-bearbeiten]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const { oeffneEditor } = await import('./editor.js')
      els.appView.hidden = true
      await oeffneEditor(btn.dataset.bearbeiten!, () => {
        els.appView.hidden = false
        void ladeListe()
      })
    })
  })
}

function escape(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
}

// — Dropzone: GPX + Medien gemeinsam annehmen, nach Typ sortieren —

els.dropzone.addEventListener('click', () => els.dateien.click())
els.dropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    els.dateien.click()
  }
})
els.dropzone.addEventListener('dragover', (e) => {
  e.preventDefault()
  els.dropzone.classList.add('aktiv')
})
els.dropzone.addEventListener('dragleave', () => els.dropzone.classList.remove('aktiv'))
els.dropzone.addEventListener('drop', (e) => {
  e.preventDefault()
  els.dropzone.classList.remove('aktiv')
  if (e.dataTransfer?.files.length) void nimmDateienAn(e.dataTransfer.files)
})
// Daneben gezielte Dateien dürfen die Seite nicht ersetzen
for (const ereignis of ['dragover', 'drop'] as const) {
  document.addEventListener(ereignis, (e) => e.preventDefault())
}
els.dateien.addEventListener('change', () => {
  if (els.dateien.files?.length) void nimmDateienAn(els.dateien.files)
  els.dateien.value = ''
})

async function nimmDateienAn(liste: FileList): Promise<void> {
  let ignoriert = 0
  for (const datei of [...liste]) {
    if (datei.name.toLowerCase().endsWith('.gpx')) {
      gpxDatei = datei
      gpxText = await datei.text()
    } else if (medientyp(datei.name)) {
      const doppelt = medienDateien.some(
        (m) => m.name === datei.name && m.size === datei.size && m.lastModified === datei.lastModified,
      )
      if (!doppelt) medienDateien.push(datei)
    } else {
      ignoriert++
    }
  }
  els.medienInfo.className = 'hinweis'
  els.medienInfo.textContent = ignoriert ? `${ignoriert} Datei${ignoriert > 1 ? 'en' : ''} ignoriert (kein GPX/Foto/Video).` : ''
  renderAuswahl()
}

function entferneMedium(datei: File): void {
  medienDateien = medienDateien.filter((m) => m !== datei)
  const url = vorschauUrls.get(datei)
  if (url) URL.revokeObjectURL(url)
  vorschauUrls.delete(datei)
  renderAuswahl()
}

function leereAuswahl(): void {
  gpxDatei = null
  gpxText = null
  medienDateien = []
  for (const url of vorschauUrls.values()) URL.revokeObjectURL(url)
  vorschauUrls.clear()
  els.titel.value = ''
  els.medienInfo.textContent = ''
  renderAuswahl()
}

function renderAuswahl(): void {
  // GPX-Chip: Name + Punkte/Dauer (oder warum es nicht reicht)
  els.gpxChip.innerHTML = ''
  if (gpxDatei && gpxText !== null) {
    const spanne = gpxZeitspanne(gpxText)
    const punkte = gpxPunktAnzahl(gpxText)
    const chip = document.createElement('div')
    chip.className = 'gpx-chip'
    chip.innerHTML = `${icon('route')}<div class="gc-text"><div class="gc-name"></div><div class="gc-meta"></div></div>`
    chip.querySelector('.gc-name')!.textContent = gpxDatei.name
    const metaEl = chip.querySelector<HTMLElement>('.gc-meta')!
    if (spanne) {
      const dauerH = ((spanne.endMs - spanne.startMs) / 3600000).toFixed(1)
      metaEl.textContent = `${punkte} Punkte · ${dauerH} h`
    } else {
      metaEl.className = 'gc-meta fehler'
      metaEl.textContent = `${punkte} Punkte, keine Zeitstempel — für Auto-Wetter/Tag-Nacht werden <time>-Einträge gebraucht.`
    }
    const x = document.createElement('button')
    x.type = 'button'
    x.className = 'chip-x'
    x.title = 'GPX entfernen'
    x.setAttribute('aria-label', 'GPX entfernen')
    x.textContent = '×'
    x.addEventListener('click', () => {
      gpxDatei = null
      gpxText = null
      renderAuswahl()
    })
    chip.appendChild(x)
    els.gpxChip.appendChild(chip)
  }

  // Medien-Kacheln mit Vorschau (Fotos) bzw. Film-Symbol (Videos)
  els.medienRaster.innerHTML = ''
  for (const datei of medienDateien) {
    const kachel = document.createElement('div')
    kachel.className = 'medien-kachel'
    kachel.title = datei.name
    if (medientyp(datei.name) === 'photo') {
      let url = vorschauUrls.get(datei)
      if (!url) {
        url = URL.createObjectURL(datei)
        vorschauUrls.set(datei, url)
      }
      kachel.style.backgroundImage = `url("${url}")`
    } else {
      kachel.innerHTML = `<span class="mk-video">${icon('film')}</span>`
    }
    const x = document.createElement('button')
    x.type = 'button'
    x.className = 'chip-x'
    x.title = `${datei.name} entfernen`
    x.setAttribute('aria-label', `${datei.name} entfernen`)
    x.textContent = '×'
    x.addEventListener('click', () => entferneMedium(datei))
    kachel.appendChild(x)
    els.medienRaster.appendChild(kachel)
  }

  aktualisiereUploadKnopf()
}

// Upload nur bei gültigem GPX UND bestätigter E-Mail (M9). Beide Quellen
// (Dateiwahl, Verifikations-Stand) rufen diesen einen Ort.
function aktualisiereUploadKnopf(): void {
  const bereit = gpxText !== null && !!gpxZeitspanne(gpxText ?? '')
  els.hochladen.disabled = !bereit || uploadGesperrt
}

// — Upload —

async function medienEingaben(dateien: File[]): Promise<{ eingaben: MediumEingabe[]; dateien: { mid: string; datei: File }[] }> {
  const eingaben: MediumEingabe[] = []
  const upload: { mid: string; datei: File }[] = []
  for (const datei of dateien) {
    const typ = medientyp(datei.name)
    if (!typ) continue
    const mid = `m${eingaben.length + 1}`
    let takenAtMs = datei.lastModified
    let anchor: [number, number] | undefined
    if (typ === 'photo') {
      const exif = liesExif(await datei.arrayBuffer())
      if (exif.datum) takenAtMs = exifDatumZuMs(exif.datum, ZONE)
      if (exif.gps) anchor = exif.gps
    }
    const eintrag: MediumEingabe = { id: mid, type: typ, file: datei.name, takenAt: isoMitZone(takenAtMs, ZONE) }
    if (anchor) eintrag.anchor = anchor
    eingaben.push(eintrag)
    upload.push({ mid, datei })
  }
  return { eingaben, dateien: upload }
}

async function warteAufBereit(id: string): Promise<'bereit' | 'fehler' | 'verarbeitung'> {
  for (let i = 0; i < 60; i++) {
    const t = await api.tour(id)
    if (t.schema === 'luhambo/tour@1' || t.status === 'bereit') return 'bereit'
    if (t.status === 'fehler') return 'fehler'
    await new Promise((r) => setTimeout(r, 1000))
  }
  return 'verarbeitung'
}

function setzeStatus(text: string, klasse = ''): void {
  els.uploadStatus.className = `hinweis ${klasse}`
  els.uploadStatus.textContent = text
}

els.hochladen.addEventListener('click', async () => {
  if (!gpxText || !gpxDatei) return
  const spanne = gpxZeitspanne(gpxText)
  if (!spanne) return
  const modus = document.querySelector<HTMLInputElement>('input[name="mode"]:checked')?.value ?? 'walk'

  els.hochladen.disabled = true
  try {
    setzeStatus('Medien werden vorbereitet …')
    const { eingaben, dateien: medienUpload } = await medienEingaben(medienDateien)

    const manifest = baueUploadManifest({
      // Dateinamen kappen: clientTourId hat serverseitig maxLength 100
      clientTourId: `studio:${gpxDatei.name.slice(0, 60)}:${spanne.startMs}`,
      title: els.titel.value.trim() || null,
      zeitspanne: spanne,
      zone: ZONE,
      trackMode: modus,
      medien: eingaben,
    })

    els.fortschritt.hidden = false
    els.fortschritt.max = medienUpload.length + 2 // GPX + Medien + finalize
    els.fortschritt.value = 0

    const { id, wiederverwendet } = await api.legeTourAn(manifest)
    if (wiederverwendet) {
      const vorhanden = await api.tour(id)
      if (vorhanden.schema === 'luhambo/tour@1' || vorhanden.status === 'bereit') {
        fertig(id, 'Diese Tour gibt es bereits.')
        return
      }
    }

    setzeStatus('GPX wird hochgeladen …')
    await api.ladeTrack(id, gpxText)
    els.fortschritt.value = 1

    for (const { mid, datei } of medienUpload) {
      setzeStatus(`Lade ${datei.name} …`)
      await api.ladeMedium(id, mid, datei)
      els.fortschritt.value += 1
    }

    setzeStatus('Verarbeitung läuft …')
    await api.finalisiere(id)
    const status = await warteAufBereit(id)
    els.fortschritt.value = els.fortschritt.max

    if (status === 'fehler') {
      const t = await api.tour(id)
      setzeStatus(`Verarbeitung fehlgeschlagen: ${t.fehler ?? 'unbekannt'}`, 'fehler')
    } else if (status === 'verarbeitung') {
      setzeStatus('Tour ist hochgeladen und wird noch verarbeitet — sie erscheint gleich in der Liste.', 'ok')
    } else {
      const t = await api.tour(id)
      const unplatziert = (t.media ?? []).filter((m) => m.placement === 'unplatziert').length
      fertig(
        id,
        unplatziert
          ? `Fertig — ${unplatziert === 1 ? 'ein Medium blieb' : `${unplatziert} Medien blieben`} unplatziert (im Editor platzierbar).`
          : 'Fertig.',
      )
    }
    await ladeListe()
    // Quota nach dem Upload nachziehen (Balken im Konto-Menü)
    zeigeSitzung(await api.me())
  } catch (fehler) {
    setzeStatus((fehler as Error).message, 'fehler')
  } finally {
    aktualisiereUploadKnopf()
    els.fortschritt.hidden = true
    renderAuswahl()
  }
})

function fertig(id: string, text: string): void {
  els.uploadStatus.className = 'hinweis ok'
  els.uploadStatus.innerHTML = `${escape(text)} <a href="/?tour=srv:${id}" target="_blank" rel="noopener">Abspielen ▸</a>`
  leereAuswahl()
  void ladeListe()
}

// — Start —
void pruefeAnmeldung()
