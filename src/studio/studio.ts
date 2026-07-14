// Studio-UI (M6): Login, Tour-Liste und der Upload-Fluss (GPX + Medien →
// Manifest → PUTs → Finalize → Status-Polling). Reine Logik liegt in upload.ts
// (Manifest-Bau) und exif.ts (Foto-Metadaten); hier nur DOM + Ablaufsteuerung.

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
  loginForm: $<HTMLFormElement>('login-form'),
  email: $<HTMLInputElement>('email'),
  passwort: $<HTMLInputElement>('passwort'),
  loginFehler: $('login-fehler'),
  gpx: $<HTMLInputElement>('gpx'),
  gpxInfo: $('gpx-info'),
  titel: $<HTMLInputElement>('titel'),
  mode: $<HTMLSelectElement>('mode'),
  medien: $<HTMLInputElement>('medien'),
  medienInfo: $('medien-info'),
  hochladen: $<HTMLButtonElement>('hochladen'),
  fortschritt: $<HTMLProgressElement>('fortschritt'),
  uploadStatus: $('upload-status'),
  liste: $('liste'),
}

let gpxText: string | null = null

// — Ansicht Login/App —

function zeige(angemeldet: boolean): void {
  els.loginView.hidden = angemeldet
  els.appView.hidden = !angemeldet
  els.abmelden.hidden = !angemeldet
}

async function pruefeAnmeldung(): Promise<void> {
  const benutzer = await api.me()
  zeige(!!benutzer)
  if (benutzer) await ladeListe()
}

els.loginForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  els.loginFehler.textContent = ''
  try {
    await api.login(els.email.value.trim(), els.passwort.value)
    els.passwort.value = ''
    zeige(true)
    await ladeListe()
  } catch (fehler) {
    els.loginFehler.textContent = (fehler as Error).message
  }
})

els.abmelden.addEventListener('click', async () => {
  await api.logout()
  zeige(false)
})

// — Tour-Liste —

function badge(status: string): string {
  const klasse = ['bereit', 'verarbeitung', 'fehler', 'angelegt'].includes(status) ? status : 'angelegt'
  return `<span class="badge ${klasse}">${status}</span>`
}

async function ladeListe(): Promise<void> {
  let touren: api.TourListe[]
  try {
    touren = await api.listeTouren()
  } catch {
    els.liste.innerHTML = '<div class="leer fehler">Touren konnten nicht geladen werden.</div>'
    return
  }
  if (!touren.length) {
    els.liste.innerHTML = '<div class="leer">Noch keine Touren — lade oben deine erste hoch.</div>'
    return
  }
  els.liste.innerHTML = ''
  for (const t of touren) {
    const el = document.createElement('div')
    el.className = 'tour'
    const km = t.stats ? `${t.stats.km} km` : ''
    el.innerHTML = `
      <div class="titel">${t.no} · ${escape(t.title ?? '(ohne Titel)')}<small>${km}${t.fehler ? ' · ' + escape(t.fehler) : ''}</small></div>
      ${badge(t.status)}
      <div class="tour-actions">
        ${t.status === 'bereit' ? `<a href="/?tour=srv:${t.id}" target="_blank" rel="noopener">Abspielen</a>` : ''}
        ${t.status === 'bereit' || t.status === 'fehler' ? `<button class="leise" data-bearbeiten="${t.id}">Bearbeiten</button>` : ''}
        <button class="leise" data-loeschen="${t.id}">Löschen</button>
      </div>`
    els.liste.appendChild(el)
  }
  els.liste.querySelectorAll<HTMLButtonElement>('[data-loeschen]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Diese Tour endgültig löschen?')) return
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

// — GPX/Medien-Auswahl —

els.gpx.addEventListener('change', async () => {
  const datei = els.gpx.files?.[0]
  gpxText = null
  if (!datei) {
    els.gpxInfo.textContent = ''
    els.hochladen.disabled = true
    return
  }
  gpxText = await datei.text()
  const spanne = gpxZeitspanne(gpxText)
  const punkte = gpxPunktAnzahl(gpxText)
  if (!spanne) {
    els.gpxInfo.className = 'hinweis fehler'
    els.gpxInfo.textContent = `${punkte} Punkte, aber keine Zeitstempel — für Auto-Wetter/Tag-Nacht werden <time>-Einträge gebraucht.`
    els.hochladen.disabled = true
    return
  }
  const dauerH = ((spanne.endMs - spanne.startMs) / 3600000).toFixed(1)
  els.gpxInfo.className = 'hinweis ok'
  els.gpxInfo.textContent = `${punkte} Punkte · ${dauerH} h`
  els.hochladen.disabled = false
})

els.medien.addEventListener('change', () => {
  const dateien = [...(els.medien.files ?? [])]
  const gueltig = dateien.filter((f) => medientyp(f.name))
  els.medienInfo.className = 'hinweis'
  els.medienInfo.textContent = dateien.length
    ? `${gueltig.length} Medien ausgewählt${gueltig.length < dateien.length ? ` (${dateien.length - gueltig.length} ignoriert)` : ''}`
    : ''
})

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
  const gpxDatei = els.gpx.files?.[0]
  if (!gpxText || !gpxDatei) return
  const spanne = gpxZeitspanne(gpxText)
  if (!spanne) return

  els.hochladen.disabled = true
  const dateien = [...(els.medien.files ?? [])]
  try {
    setzeStatus('Medien werden vorbereitet …')
    const { eingaben, dateien: medienDateien } = await medienEingaben(dateien)

    const manifest = baueUploadManifest({
      // Dateinamen kappen: clientTourId hat serverseitig maxLength 100
      clientTourId: `studio:${gpxDatei.name.slice(0, 60)}:${spanne.startMs}`,
      title: els.titel.value.trim() || null,
      zeitspanne: spanne,
      zone: ZONE,
      trackMode: els.mode.value,
      medien: eingaben,
    })

    els.fortschritt.hidden = false
    els.fortschritt.max = medienDateien.length + 2 // GPX + Medien + finalize
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

    for (const { mid, datei } of medienDateien) {
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
      fertig(id, unplatziert ? `Fertig — ${unplatziert} Medien blieben unplatziert.` : 'Fertig!')
    }
    await ladeListe()
  } catch (fehler) {
    setzeStatus((fehler as Error).message, 'fehler')
  } finally {
    els.hochladen.disabled = false
    els.fortschritt.hidden = true
  }
})

function fertig(id: string, text: string): void {
  els.uploadStatus.className = 'hinweis ok'
  els.uploadStatus.innerHTML = `${escape(text)} <a href="/?tour=srv:${id}" target="_blank" rel="noopener">Abspielen ▸</a>`
  els.gpx.value = ''
  els.medien.value = ''
  els.titel.value = ''
  els.gpxInfo.textContent = ''
  els.medienInfo.textContent = ''
  gpxText = null
  void ladeListe()
}

// — Start —
void pruefeAnmeldung()
