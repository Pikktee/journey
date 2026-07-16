// Studio-Editor (M7): Karten-Editor über den Editor-Daten des Backends —
// Medien platzieren/verschieben/löschen, Captions, Modus-Grenzen, Trim,
// Titel/Beschreibung. Reine Logik liegt in editmodell.ts; hier nur DOM +
// MapLibre. Wird aus studio.ts lazy importiert, damit MapLibre nur bei
// Bedarf ins Studio-Bundle kommt.

import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import * as api from './api.js'
import {
  effektiveMedien,
  isoZuOffset,
  LEERES_OVERLAY,
  mitMedienEdit,
  mitModusGrenze,
  mitTrim,
  naechsterPunktIndex,
  offsetZuIso,
  ohneModusGrenze,
  pruefeOverlay,
  zerlegeFuerAnzeige,
  type EditOverlay,
  type EditorSegment,
  type MediumAnzeige,
  type MediumBasis,
  type Modus,
  type TrackPunkt,
} from './editmodell.js'

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

const MODUS_FARBEN: Record<Modus, string> = { walk: '#3ecf8e', bike: '#5b9dff', tram: '#f5a524', ferry: '#c58bff' }
const MODUS_NAMEN: Record<Modus, string> = { walk: 'Zu Fuß', bike: 'Rad', tram: 'Tram', ferry: 'Fähre' }
const PLACEMENT_NAMEN: Record<string, string> = { gps: 'GPS', zeit: 'Zeit', manuell: 'manuell', unplatziert: 'unplatziert' }

interface Zustand {
  tourId: string
  daten: api.EditorDaten
  edits: EditOverlay
  /** JSON-Schnappschuss des gespeicherten Overlays (Dirty-Erkennung) */
  gespeichert: string
  /** Trackpunkte flach über alle Segmente */
  track: TrackPunkt[]
  auswahl: number | null
  /** Medien-ID im „auf den Track klicken"-Platzieren-Modus */
  platzieren: string | null
}

let karte: maplibregl.Map | null = null
let z: Zustand | null = null
let marker: maplibregl.Marker[] = []
let zurueckCb: (() => void) | null = null
let verdrahtet = false

// — Einstieg —

export async function oeffneEditor(tourId: string, zurueck: () => void): Promise<void> {
  zurueckCb = zurueck
  verdrahteEinmal()
  $('editor-view').hidden = false
  status('Editor wird geladen …')
  try {
    await ladeDaten(tourId)
    status('')
  } catch (fehler) {
    status((fehler as Error).message, 'fehler')
  }
}

async function ladeDaten(tourId: string): Promise<void> {
  const daten = await api.editorDaten(tourId)
  const edits = ((daten.edits as EditOverlay | null) ?? LEERES_OVERLAY)
  z = {
    tourId,
    daten,
    edits,
    gespeichert: JSON.stringify(edits),
    track: daten.segmente.flatMap((s) => s.pts),
    auswahl: null,
    platzieren: null,
  }
  ;($('editor-titel') as HTMLInputElement).value = daten.title ?? ''
  ;($('editor-beschreibung') as HTMLTextAreaElement).value = daten.description ?? ''
  ;($('editor-vorschau') as HTMLAnchorElement).href = `/?tour=srv:${tourId}`
  ;($('editor-vorschau') as HTMLAnchorElement).style.display = daten.status === 'bereit' ? '' : 'none'

  if (!karte) {
    karte = baueKarte()
    await new Promise<void>((erfuellt) => karte?.once('load', () => erfuellt()))
    baueTrackLayer(karte)
  }
  passeAusschnittAn()
  renderAlles()
}

function schliesse(): void {
  $('editor-view').hidden = true
  karte?.remove()
  karte = null
  z = null
  marker = []
  zurueckCb?.()
}

// — Karte —

function baueKarte(): maplibregl.Map {
  const k = new maplibregl.Map({
    container: 'editor-map',
    // Schlanker Raster-Stil (Esri-Satellit wie im Player) — der Editor braucht
    // kein Terrain und keinen Player: nur Orientierung + Klickbarkeit.
    style: {
      version: 8,
      sources: {
        sat: {
          type: 'raster',
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
          tileSize: 256,
          maxzoom: 19,
          attribution: 'Esri, Maxar, Earthstar Geographics',
        },
      },
      layers: [{ id: 'sat', type: 'raster', source: 'sat' }],
    },
  })
  k.addControl(new maplibregl.NavigationControl({ showCompass: false }))
  k.on('click', (e) => klickAufKarte(e))
  return k
}

function baueTrackLayer(k: maplibregl.Map): void {
  k.addSource('track', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  // Dunkle Kontur unter der Linie: Lesbarkeit auf hellem Satellitenbild
  k.addLayer({
    id: 'track-kontur',
    type: 'line',
    source: 'track',
    paint: { 'line-color': '#0a0d12', 'line-width': 7, 'line-opacity': 0.55 },
    layout: { 'line-cap': 'round', 'line-join': 'round' },
  })
  k.addLayer({
    id: 'track-inaktiv',
    type: 'line',
    source: 'track',
    filter: ['==', ['get', 'aktiv'], 0],
    paint: { 'line-color': '#8a95a5', 'line-width': 3, 'line-dasharray': [1.5, 2] },
  })
  k.addLayer({
    id: 'track-aktiv',
    type: 'line',
    source: 'track',
    filter: ['==', ['get', 'aktiv'], 1],
    paint: { 'line-color': ['get', 'farbe'], 'line-width': 4 },
    layout: { 'line-cap': 'round', 'line-join': 'round' },
  })
}

function passeAusschnittAn(): void {
  if (!karte || !z || !z.track.length) return
  // Der Container ist Teil eines frisch eingeblendeten Grids — Maß nachziehen,
  // bevor der Ausschnitt gerechnet wird (sonst passt fitBounds auf alte Größe).
  karte.resize()
  const grenzen = new maplibregl.LngLatBounds()
  for (const p of z.track) grenzen.extend([p[0], p[1]])
  karte.fitBounds(grenzen, { padding: 56, duration: 0 })
}

function klickAufKarte(e: maplibregl.MapMouseEvent): void {
  if (!karte || !z) return
  const r = 8
  const treffer = karte.queryRenderedFeatures(
    [
      [e.point.x - r, e.point.y - r],
      [e.point.x + r, e.point.y + r],
    ],
    { layers: ['track-aktiv', 'track-inaktiv'] },
  )
  if (!treffer.length) return
  const idx = naechsterPunktIndex(z.track, e.lngLat.lng, e.lngLat.lat)
  const punkt = z.track[idx]
  if (!punkt) return
  if (z.platzieren) {
    // Platzieren-Modus: das gewählte Medium auf diesen Trackpunkt ankern
    z.edits = mitMedienEdit(z.edits, z.platzieren, { anchor: [punkt[0], punkt[1]] })
    z.platzieren = null
    renderAlles()
  } else {
    z.auswahl = idx
    renderAlles()
  }
}

// — Anzeige —

function renderAlles(): void {
  if (!karte || !z) return
  zeichneTrack()
  zeichneMarker()
  renderAuswahl()
  renderTrimUndGrenzen()
  renderMedien()
  $('editor-map').classList.toggle('platzieren', z.platzieren !== null)
  $('editor-medien-hinweis').textContent = z.platzieren
    ? 'Auf den Track klicken, um das Medium dort zu verankern — erneut „Platzieren" drücken bricht ab.'
    : ''
}

function zeichneTrack(): void {
  if (!karte || !z) return
  const abschnitte = zerlegeFuerAnzeige(z.daten.segmente as EditorSegment[], z.edits, z.daten.time.start)
  const quelle = karte.getSource('track') as maplibregl.GeoJSONSource
  quelle.setData({
    type: 'FeatureCollection',
    features: abschnitte.map((a) => ({
      type: 'Feature',
      properties: { farbe: MODUS_FARBEN[a.mode], aktiv: a.aktiv ? 1 : 0 },
      geometry: { type: 'LineString', coordinates: a.pts.map((p) => [p[0], p[1]]) },
    })),
  })
}

function zeichneMarker(): void {
  if (!karte || !z) return
  for (const m of marker) m.remove()
  marker = []

  // Medien (nur verankerte, nicht gelöschte) — per Drag auf den Track schieben
  for (const m of medienAnzeige()) {
    if (!m.anchor || m.geloescht) continue
    const el = document.createElement('div')
    el.className = 'm-marker'
    const thumb = m.type === 'photo' ? m.src : m.poster
    if (thumb) el.style.backgroundImage = `url("${thumb}")`
    else el.innerHTML = '<svg aria-hidden="true"><use href="#i-film"/></svg>' // statisches Sprite-Icon

    el.title = `${m.id} · ${PLACEMENT_NAMEN[m.placement] ?? m.placement}`
    const mk = new maplibregl.Marker({ element: el, draggable: true }).setLngLat(m.anchor).addTo(karte)
    mk.on('dragend', () => {
      if (!z) return
      const ziel = mk.getLngLat()
      const punkt = z.track[naechsterPunktIndex(z.track, ziel.lng, ziel.lat)]
      if (punkt) z.edits = mitMedienEdit(z.edits, m.id, { anchor: [punkt[0], punkt[1]] })
      renderAlles()
    })
    marker.push(mk)
  }

  // Modus-Grenzen + Trim-Kanten als beschriftete Pins am jeweiligen Trackpunkt
  const pin = (klasse: string, text: string, iso: string): void => {
    if (!karte || !z) return
    const punkt = punktZurZeit(iso)
    if (!punkt) return
    const el = document.createElement('div')
    el.className = klasse
    el.textContent = text
    marker.push(new maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, -6] }).setLngLat([punkt[0], punkt[1]]).addTo(karte))
  }
  for (const g of z.edits.modi ?? []) pin('g-marker', `${MODUS_NAMEN[g.mode]} ▸`, g.ab)
  if (z.edits.trim?.start !== undefined) pin('t-marker', '⟦ Start', z.edits.trim.start)
  if (z.edits.trim?.ende !== undefined) pin('t-marker', 'Ende ⟧', z.edits.trim.ende)

  // Auswahl-Punkt zuletzt (oben)
  if (z.auswahl !== null) {
    const p = z.track[z.auswahl]
    if (p) {
      const el = document.createElement('div')
      el.className = 'sel-marker'
      marker.push(new maplibregl.Marker({ element: el }).setLngLat([p[0], p[1]]).addTo(karte))
    }
  }
}

/** Erster Trackpunkt mit tOffset ≥ Zeitpunkt (für Grenz-/Trim-Pins). */
function punktZurZeit(iso: string): TrackPunkt | null {
  if (!z) return null
  const offset = isoZuOffset(z.daten.time.start, iso)
  if (!Number.isFinite(offset)) return null
  return z.track.find((p) => p[3] >= offset) ?? z.track[z.track.length - 1] ?? null
}

function uhrzeit(iso: string): string {
  if (!z) return iso
  try {
    return new Intl.DateTimeFormat('de-DE', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZone: z.daten.time.zone,
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

function renderAuswahl(): void {
  if (!z) return
  const aktivierbar = z.auswahl !== null
  ;($('e-trim-start') as HTMLButtonElement).disabled = !aktivierbar
  ;($('e-trim-ende') as HTMLButtonElement).disabled = !aktivierbar
  ;($('e-grenze') as HTMLButtonElement).disabled = !aktivierbar
  const info = $('editor-punkt-info')
  if (z.auswahl === null) {
    info.textContent = 'Auf den Track klicken, um einen Punkt zu wählen.'
    return
  }
  const p = z.track[z.auswahl]
  if (!p) return
  info.textContent = `Punkt bei ${uhrzeit(offsetZuIso(z.daten.time.start, p[3]))} Uhr`
}

function renderTrimUndGrenzen(): void {
  if (!z) return
  const trimEl = $('editor-trim')
  trimEl.innerHTML = ''
  const { start, ende } = z.edits.trim ?? {}
  if (start === undefined && ende === undefined) {
    trimEl.textContent = 'Kein Trim — die ganze Aufzeichnung wird abgespielt.'
  } else {
    for (const [teil, iso] of [['start', start], ['ende', ende]] as Array<['start' | 'ende', string | undefined]>) {
      if (iso === undefined) continue
      const zeile = document.createElement('div')
      zeile.className = 'grenz-zeile'
      zeile.append(`${teil === 'start' ? 'Start ab' : 'Ende bei'} ${uhrzeit(iso)} Uhr`)
      zeile.appendChild(entfernenKnopf(() => z && (z.edits = mitTrim(z.edits, teil, null))))
      trimEl.appendChild(zeile)
    }
  }

  const grenzenEl = $('editor-grenzen')
  grenzenEl.innerHTML = ''
  const modi = z.edits.modi ?? []
  if (!modi.length) {
    grenzenEl.textContent = 'Keine Grenzen — es gelten die Modi der Aufzeichnung.'
    return
  }
  for (const g of modi) {
    const zeile = document.createElement('div')
    zeile.className = 'grenz-zeile'
    const farbe = document.createElement('span')
    farbe.className = 'farbe'
    farbe.style.background = MODUS_FARBEN[g.mode]
    zeile.appendChild(farbe)
    zeile.append(`ab ${uhrzeit(g.ab)} Uhr: ${MODUS_NAMEN[g.mode]}`)
    zeile.appendChild(entfernenKnopf(() => z && (z.edits = ohneModusGrenze(z.edits, g.ab))))
    grenzenEl.appendChild(zeile)
  }
}

function entfernenKnopf(aktion: () => void): HTMLButtonElement {
  const knopf = document.createElement('button')
  knopf.textContent = 'Entfernen'
  knopf.addEventListener('click', () => {
    aktion()
    renderAlles()
  })
  return knopf
}

function medienAnzeige(): MediumAnzeige[] {
  if (!z) return []
  return effektiveMedien(z.daten.medien as MediumBasis[], z.edits)
}

function renderMedien(): void {
  if (!z) return
  const container = $('editor-medien')
  container.innerHTML = ''
  const liste = medienAnzeige()
  if (!liste.length) {
    container.innerHTML = '<div class="leer">Keine Medien.</div>'
    return
  }
  for (const m of liste) {
    const zeile = document.createElement('div')
    zeile.className = `medien-zeile${m.geloescht ? ' geloescht' : ''}`

    const thumb = document.createElement(m.type === 'photo' || m.poster ? 'img' : 'div') as HTMLImageElement
    thumb.className = 'thumb'
    if (m.type === 'photo') thumb.src = m.src
    else if (m.poster) thumb.src = m.poster
    else thumb.innerHTML = '<svg aria-hidden="true"><use href="#i-film"/></svg>' // statisches Sprite-Icon
    zeile.appendChild(thumb)

    const info = document.createElement('div')
    info.className = 'm-info'
    // Kein innerHTML: uhrzeit() fällt bei kaputtem takenAt auf den ROHEN
    // Manifest-String zurück — Nutzerdaten gehören nur in Textknoten.
    const kopf = document.createElement('div')
    kopf.className = 'm-kopf'
    // Eigener Span mit Ellipsis: bei unparsebarem takenAt fällt uhrzeit() auf
    // den rohen ISO-String zurück — der darf das Layout nicht sprengen.
    const zeit = document.createElement('span')
    zeit.className = 'm-zeit'
    zeit.textContent = `${uhrzeit(m.takenAt)} Uhr`
    zeit.title = zeit.textContent
    kopf.appendChild(zeit)
    const badgeEl = document.createElement('span')
    badgeEl.className = `badge ${m.geloescht ? 'geloescht' : m.placement}`
    badgeEl.textContent = m.geloescht ? 'gelöscht' : (PLACEMENT_NAMEN[m.placement] ?? m.placement)
    kopf.appendChild(badgeEl)
    info.appendChild(kopf)
    const caption = document.createElement('input')
    caption.type = 'text'
    caption.placeholder = 'Bildunterschrift'
    caption.value = m.caption
    caption.addEventListener('change', () => {
      if (!z) return
      const basis = z.daten.medien.find((b) => b.id === m.id)
      // Gleicht der Text wieder dem Original, fliegt der Override raus
      z.edits = mitMedienEdit(z.edits, m.id, {
        caption: caption.value === (basis?.caption ?? '') ? undefined : caption.value,
      })
    })
    info.appendChild(caption)
    zeile.appendChild(info)

    const aktionen = document.createElement('div')
    aktionen.className = 'm-aktionen'
    const platzieren = document.createElement('button')
    platzieren.className = z.platzieren === m.id ? 'aktiv' : ''
    platzieren.textContent = z.platzieren === m.id ? 'Abbrechen' : 'Platzieren'
    platzieren.addEventListener('click', () => {
      if (!z) return
      z.platzieren = z.platzieren === m.id ? null : m.id
      renderAlles()
    })
    aktionen.appendChild(platzieren)
    if (z.edits.medien?.[m.id]?.anchor) {
      const auto = document.createElement('button')
      auto.textContent = 'Auto-Anker'
      auto.title = 'Manuellen Anker verwerfen, Auto-Platzierung gilt wieder'
      auto.addEventListener('click', () => {
        if (!z) return
        z.edits = mitMedienEdit(z.edits, m.id, { anchor: undefined })
        renderAlles()
      })
      aktionen.appendChild(auto)
    }
    const loeschen = document.createElement('button')
    loeschen.textContent = m.geloescht ? 'Wiederherstellen' : 'Löschen'
    loeschen.addEventListener('click', () => {
      if (!z) return
      z.edits = mitMedienEdit(z.edits, m.id, { geloescht: !m.geloescht })
      renderAlles()
    })
    aktionen.appendChild(loeschen)
    zeile.appendChild(aktionen)

    container.appendChild(zeile)
  }
}

function status(text: string, klasse = ''): void {
  const el = $('editor-status')
  el.className = `hinweis ${klasse}`
  el.textContent = text
}

// — Speichern / Neu verarbeiten —

async function warteAufBereit(id: string): Promise<void> {
  for (let i = 0; i < 90; i++) {
    const t = await api.tour(id)
    if (t.schema === 'luhambo/tour@1' || t.status === 'bereit') return
    if (t.status === 'fehler') throw new Error(`Verarbeitung fehlgeschlagen: ${t.fehler ?? 'unbekannt'}`)
    await new Promise((weiter) => setTimeout(weiter, 900))
  }
  throw new Error('Verarbeitung dauert ungewöhnlich lange — Liste später prüfen.')
}

async function speichern(): Promise<void> {
  if (!z) return
  const problem = pruefeOverlay(z.edits)
  if (problem) {
    status(problem, 'fehler')
    return
  }
  const speichernKnopf = $('editor-speichern') as HTMLButtonElement
  speichernKnopf.disabled = true
  try {
    // 1. Overlay (falls geändert) — der Server rendert die Tour neu
    if (JSON.stringify(z.edits) !== z.gespeichert) {
      status('Bearbeitungen werden gespeichert …')
      const antwort = await api.speichereEdits(z.tourId, z.edits)
      if (antwort.status === 'verarbeitung') await warteAufBereit(z.tourId)
    }
    // 2. Titel/Beschreibung (falls geändert) — eigener Endpunkt, eigener Re-Render;
    //    bewusst NACH dem Overlay, damit sich die Renderer nie überlappen
    const titel = ($('editor-titel') as HTMLInputElement).value.trim()
    const beschreibung = ($('editor-beschreibung') as HTMLTextAreaElement).value.trim()
    const felder: { title?: string; description?: string } = {}
    if (titel && titel !== (z.daten.title ?? '')) felder.title = titel
    if (beschreibung !== (z.daten.description ?? '')) felder.description = beschreibung
    if (Object.keys(felder).length) {
      status('Titel/Beschreibung werden gespeichert …')
      await api.patchTour(z.tourId, felder)
      // Nur warten, wenn PATCH wirklich einen Re-Render gestartet hat — auf
      // einer fehler-Tour würde warteAufBereit sonst den ALTEN Pipeline-
      // Fehler als Speicher-Fehler melden (Review-Fund).
      const stand = await api.tour(z.tourId)
      if (stand.status === 'verarbeitung') await warteAufBereit(z.tourId)
    }
    await ladeDaten(z.tourId)
    status('Gespeichert.', 'ok')
  } catch (fehler) {
    status((fehler as Error).message, 'fehler')
  } finally {
    speichernKnopf.disabled = false
  }
}

async function neuVerarbeiten(): Promise<void> {
  if (!z) return
  const knopf = $('editor-reprocess') as HTMLButtonElement
  knopf.disabled = true
  try {
    status('Tour wird neu verarbeitet (Benennung/Wetter) …')
    await api.reprocess(z.tourId)
    await warteAufBereit(z.tourId)
    await ladeDaten(z.tourId)
    status('Neu verarbeitet — Bearbeitungen sind erhalten.', 'ok')
  } catch (fehler) {
    status((fehler as Error).message, 'fehler')
  } finally {
    knopf.disabled = false
  }
}

// — Einmalige Verdrahtung der statischen Editor-Elemente —

function verdrahteEinmal(): void {
  if (verdrahtet) return
  verdrahtet = true
  $('editor-zurueck').addEventListener('click', schliesse)
  $('editor-speichern').addEventListener('click', () => void speichern())
  $('editor-reprocess').addEventListener('click', () => void neuVerarbeiten())
  $('e-trim-start').addEventListener('click', () => trimSetzen('start'))
  $('e-trim-ende').addEventListener('click', () => trimSetzen('ende'))
  $('e-grenze').addEventListener('click', () => {
    if (!z || z.auswahl === null) return
    const p = z.track[z.auswahl]
    if (!p) return
    const mode = ($('e-grenze-mode') as HTMLSelectElement).value as Modus
    z.edits = mitModusGrenze(z.edits, offsetZuIso(z.daten.time.start, p[3]), mode)
    renderAlles()
  })
}

function trimSetzen(teil: 'start' | 'ende'): void {
  if (!z || z.auswahl === null) return
  const p = z.track[z.auswahl]
  if (!p) return
  z.edits = mitTrim(z.edits, teil, offsetZuIso(z.daten.time.start, p[3]))
  renderAlles()
}

// Debug-Handle (Konvention wie window.__j im Player) — auch fürs Browser-E2E:
// Karte und Zustand inspizieren, Track-Koordinaten in Pixel projizieren.
;(window as unknown as Record<string, unknown>)['__studio'] = {
  karte: () => karte,
  zustand: () => z,
}
