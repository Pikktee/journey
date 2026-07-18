// Studio-Editor (M7 + Kreativbaukasten): Karten-Editor über den Editor-Daten
// des Backends — Medien platzieren/verschieben/löschen, Captions, Modus- und
// Kamera-Grenzen, Trim (per Zeitleisten-Griff), Musik/SFX mit Streckenbereich,
// Foto-Anzeigeoptionen. Reine Logik liegt in editmodell.ts + zeitleiste.ts;
// hier nur DOM + MapLibre. Wird aus studio.ts lazy importiert, damit MapLibre
// nur bei Bedarf ins Studio-Bundle kommt.

import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import * as api from './api.js'
import {
  effektiveMedien,
  isoZuOffset,
  LEERES_OVERLAY,
  mitAudioEintrag,
  mitAudioPatch,
  mitKameraGrenze,
  mitMedienEdit,
  mitModusGrenze,
  mitTrim,
  ohneAudioEintrag,
  ohneKameraGrenze,
  ohneModusGrenze,
  offsetZuIso,
  projiziereAufTrack,
  pruefeOverlay,
  punktZuOffset,
  zerlegeFuerAnzeige,
  type AudioEintrag,
  type EditOverlay,
  type EditorSegment,
  type KameraPreset,
  type MediumAnzeige,
  type MediumBasis,
  type Modus,
  type TrackPunkt,
} from './editmodell.js'
import {
  anteilZuOffset,
  audioWirdVerworfen,
  baueAudioBalken,
  baueBaender,
  baueMedienDots,
  bauePins,
  baueSkala,
  baueTicks,
  baueTrimGriffe,
  offsetZuAnteil,
  type ZeitSkala,
} from './zeitleiste.js'

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

const MODUS_FARBEN: Record<Modus, string> = { walk: '#3ecf8e', bike: '#5b9dff', tram: '#f5a524', ferry: '#c58bff' }
const MODUS_NAMEN: Record<Modus, string> = { walk: 'Zu Fuß', bike: 'Rad', tram: 'Tram', ferry: 'Fähre' }
const PRESET_NAMEN: Record<KameraPreset, string> = { nah: 'Nah', mittel: 'Mittel', weit: 'Weit' }
const PLACEMENT_NAMEN: Record<string, string> = { gps: 'GPS', zeit: 'Zeit', manuell: 'manuell', unplatziert: 'unplatziert' }
const AUDIO_ENDUNGEN = ['mp3', 'm4a', 'ogg', 'wav']
/** Icon aus dem Sprite in studio.html (nur für vertrauten, statischen Markup-Bau). */
const icon = (name: string): string => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`

interface Zustand {
  tourId: string
  daten: api.EditorDaten
  edits: EditOverlay
  /** JSON-Schnappschuss des gespeicherten Overlays (Dirty-Erkennung) */
  gespeichert: string
  /** Trackpunkte flach über alle Segmente */
  track: TrackPunkt[]
  /** ausgewählter Punkt AUF der Track-Linie (interpoliert, inkl. tOffset) */
  auswahl: TrackPunkt | null
  /** Medien-ID im „auf den Track klicken"-Platzieren-Modus */
  platzieren: string | null
}

let karte: maplibregl.Map | null = null
let z: Zustand | null = null
let marker: maplibregl.Marker[] = []
let medienMarker = new Map<string, HTMLElement>()
let hoverMarker: maplibregl.Marker | null = null
let vorschau: { audio: HTMLAudioElement; datei: string } | null = null
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
  ;($('editor-vorschau') as HTMLAnchorElement).href = `/erlebnis.html?tour=srv:${tourId}`
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
  stoppeVorschau()
  karte?.remove()
  karte = null
  z = null
  marker = []
  medienMarker = new Map()
  hoverMarker = null
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
  // Unten mehr Luft: dort schwebt die Zeitleiste über der Karte. Auf kleinen
  // (Mobil-)Karten das Padding proportional klemmen — übersteigt es den
  // Container, wirft MapLibre und der Editor bliebe in der Weltansicht.
  const wrap = karte.getContainer()
  const skal = Math.min(1, wrap.clientWidth / (70 + 70 + 60), wrap.clientHeight / (70 + 185 + 60))
  const px = (p: number): number => Math.round(p * skal)
  karte.fitBounds(grenzen, { padding: { top: px(70), right: px(70), bottom: px(185), left: px(70) }, duration: 0 })
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
  // Lotfußpunkt auf der LINIE — nicht der nächste Stützpunkt: der Track ist
  // vereinfacht, auf Geraden (Fähre) liegen Stützpunkte kilometerweit auseinander.
  const projektion = projiziereAufTrack(z.track, e.lngLat.lng, e.lngLat.lat)
  if (z.platzieren) {
    z.edits = mitMedienEdit(z.edits, z.platzieren, { anchor: [projektion.punkt[0], projektion.punkt[1]] })
    z.platzieren = null
  } else {
    z.auswahl = projektion.punkt
  }
  renderAlles()
}

// — Anzeige —

function renderAlles(): void {
  if (!karte || !z) return
  zeichneTrack()
  zeichneMarker()
  renderAuswahl()
  renderTrimUndGrenzen()
  renderKamera()
  renderAudio()
  renderMedien()
  renderZeitleiste()
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
  medienMarker = new Map()

  // Medien (nur verankerte, nicht gelöschte) — per Drag auf den Track schieben
  for (const m of medienAnzeige()) {
    if (!m.anchor || m.geloescht) continue
    const el = document.createElement('div')
    el.className = 'm-marker'
    const thumb = m.type === 'photo' ? m.src : m.poster
    if (thumb) el.style.backgroundImage = `url("${thumb}")`
    else el.innerHTML = icon('film')
    el.title = `${m.id} · ${PLACEMENT_NAMEN[m.placement] ?? m.placement}`
    const mk = new maplibregl.Marker({ element: el, draggable: true }).setLngLat(m.anchor).addTo(karte)
    let gezogen = false
    mk.on('dragstart', () => {
      gezogen = true
    })
    mk.on('dragend', () => {
      if (!z) return
      const ziel = mk.getLngLat()
      const projektion = projiziereAufTrack(z.track, ziel.lng, ziel.lat)
      z.edits = mitMedienEdit(z.edits, m.id, { anchor: [projektion.punkt[0], projektion.punkt[1]] })
      renderAlles()
    })
    // Klick auf den Marker → zugehörige Zeile in der Liste aufblitzen lassen
    el.addEventListener('click', (ev) => {
      ev.stopPropagation()
      if (gezogen) {
        gezogen = false
        return
      }
      blitzeZeile(m.id)
    })
    medienMarker.set(m.id, el)
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
  if (z.auswahl) {
    const el = document.createElement('div')
    el.className = 'sel-marker'
    marker.push(new maplibregl.Marker({ element: el }).setLngLat([z.auswahl[0], z.auswahl[1]]).addTo(karte))
  }
}

/** Interpolierte Track-Position zu einem absoluten Zeitpunkt (Grenz-/Trim-Pins). */
function punktZurZeit(iso: string): TrackPunkt | null {
  if (!z) return null
  const offset = isoZuOffset(z.daten.time.start, iso)
  if (!Number.isFinite(offset)) return null
  return punktZuOffset(z.track, offset)
}

/** Uhrzeit in der Tour-Zone; Datum nur, wenn es vom Tour-Tag abweicht (mtime-Fallen!). */
function zeitText(iso: string): string {
  if (!z) return iso
  try {
    const zone = z.daten.time.zone
    const zeit = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: zone }).format(new Date(iso))
    const tagFmt = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', timeZone: zone })
    const tag = tagFmt.format(new Date(iso))
    const tourTag = tagFmt.format(new Date(z.daten.time.start))
    return tag === tourTag ? zeit : `${tag}. ${zeit}`
  } catch {
    return iso
  }
}

function renderAuswahl(): void {
  if (!z) return
  const aktivierbar = z.auswahl !== null
  for (const id of ['e-trim-start', 'e-trim-ende', 'e-grenze', 'e-kamera']) {
    ;($(id) as HTMLButtonElement).disabled = !aktivierbar
  }
  const info = $('editor-punkt-info')
  if (!z.auswahl) {
    info.textContent = 'Auf den Track oder die Zeitleiste klicken, um einen Punkt zu wählen.'
    return
  }
  info.textContent = `Punkt bei ${zeitText(offsetZuIso(z.daten.time.start, z.auswahl[3]))} Uhr`
}

function renderTrimUndGrenzen(): void {
  if (!z) return
  const trimEl = $('editor-trim')
  trimEl.innerHTML = ''
  const { start, ende } = z.edits.trim ?? {}
  if (start === undefined && ende === undefined) {
    trimEl.textContent = 'Kein Trim — Griffe an der Zeitleiste ziehen oder einen Punkt wählen.'
  } else {
    for (const [teil, iso] of [['start', start], ['ende', ende]] as Array<['start' | 'ende', string | undefined]>) {
      if (iso === undefined) continue
      const zeile = document.createElement('div')
      zeile.className = 'grenz-zeile'
      const text = document.createElement('span')
      text.textContent = `${teil === 'start' ? 'Start ab' : 'Ende bei'} ${zeitText(iso)} Uhr`
      zeile.appendChild(text)
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
    const text = document.createElement('span')
    text.textContent = `ab ${zeitText(g.ab)} Uhr: ${MODUS_NAMEN[g.mode]}`
    zeile.appendChild(text)
    zeile.appendChild(entfernenKnopf(() => z && (z.edits = ohneModusGrenze(z.edits, g.ab))))
    grenzenEl.appendChild(zeile)
  }
}

function renderKamera(): void {
  if (!z) return
  const el = $('editor-kamera')
  el.innerHTML = ''
  const kamera = z.edits.kamera ?? []
  if (!kamera.length) {
    el.textContent = 'Keine Verläufe — die Kamera bleibt beim Preset des Zuschauers.'
    return
  }
  for (const g of kamera) {
    const zeile = document.createElement('div')
    zeile.className = 'grenz-zeile'
    const sym = document.createElement('span')
    sym.innerHTML = icon('kamera')
    sym.style.cssText = 'display:inline-flex;width:13px;height:13px;color:var(--text-2)'
    zeile.appendChild(sym)
    const text = document.createElement('span')
    text.textContent = `ab ${zeitText(g.ab)} Uhr: ${PRESET_NAMEN[g.preset]}`
    zeile.appendChild(text)
    zeile.appendChild(entfernenKnopf(() => z && (z.edits = ohneKameraGrenze(z.edits, g.ab))))
    el.appendChild(zeile)
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

/** Karte zum Anker fliegen + Marker pulsieren lassen (Liste→Karte-Sync). */
function fliegeZuMedium(m: MediumAnzeige): void {
  if (!karte || !m.anchor) return
  karte.flyTo({ center: m.anchor, zoom: Math.max(karte.getZoom(), 15), duration: 700 })
  const el = medienMarker.get(m.id)
  if (el) {
    el.classList.remove('puls')
    void el.offsetWidth // Animation neu starten
    el.classList.add('puls')
  }
}

/** Medien-Zeile in der Sidebar aufblitzen lassen (Karte→Liste-Sync). */
function blitzeZeile(id: string): void {
  const zeile = document.querySelector<HTMLElement>(`.medien-zeile[data-id="${id}"]`)
  if (!zeile) return
  zeile.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  zeile.classList.remove('blitz')
  void zeile.offsetWidth
  zeile.classList.add('blitz')
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
    zeile.dataset['id'] = m.id

    const thumb = document.createElement(m.type === 'photo' || m.poster ? 'img' : 'div') as HTMLImageElement
    thumb.className = 'thumb'
    if (m.type === 'photo') thumb.src = m.src
    else if (m.poster) thumb.src = m.poster
    else thumb.innerHTML = icon('film')
    thumb.style.cursor = m.anchor ? 'pointer' : ''
    thumb.title = m.anchor ? 'Auf der Karte zeigen' : ''
    thumb.addEventListener('click', () => fliegeZuMedium(m))
    zeile.appendChild(thumb)

    const info = document.createElement('div')
    info.className = 'm-info'
    // Kein innerHTML: zeitText() fällt bei kaputtem takenAt auf den ROHEN
    // Manifest-String zurück — Nutzerdaten gehören nur in Textknoten.
    const kopf = document.createElement('div')
    kopf.className = 'm-kopf'
    const zeit = document.createElement('span')
    zeit.className = 'm-zeit'
    zeit.textContent = `${zeitText(m.takenAt)} Uhr`
    zeit.title = zeit.textContent
    kopf.appendChild(zeit)
    const badgeEl = document.createElement('span')
    badgeEl.className = `badge ${m.geloescht ? 'geloescht' : m.placement}`
    badgeEl.textContent = m.geloescht ? 'gelöscht' : (PLACEMENT_NAMEN[m.placement] ?? m.placement)
    if (m.placement === 'zeit' && m.gpsAnker) {
      badgeEl.title = 'GPS-Ort lag zu weit ab vom Track — über die Aufnahmezeit platziert.'
    }
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

    // Anzeigeoptionen (nur Fotos: Videos halten so lange wie das Video läuft)
    if (m.type === 'photo' && !m.geloescht) {
      const optionen = document.createElement('div')
      optionen.className = 'm-optionen'
      const hold = document.createElement('select')
      hold.title = 'Haltedauer des Foto-Stopps'
      for (const [wert, text] of [['', 'Auto (5 s)'], ['3', '3 s'], ['5', '5 s'], ['8', '8 s'], ['12', '12 s'], ['20', '20 s']]) {
        const opt = document.createElement('option')
        opt.value = wert as string
        opt.textContent = text as string
        hold.appendChild(opt)
      }
      hold.value = m.display?.holdS !== undefined ? String(m.display.holdS) : ''
      hold.addEventListener('change', () => {
        if (!z) return
        const display = { ...(z.edits.medien?.[m.id]?.display ?? {}) }
        if (hold.value === '') delete display.holdS
        else display.holdS = Number(hold.value)
        z.edits = mitMedienEdit(z.edits, m.id, { display })
      })
      optionen.appendChild(hold)
      const kb = document.createElement('label')
      kb.className = 'kb'
      const kbBox = document.createElement('input')
      kbBox.type = 'checkbox'
      kbBox.checked = m.display?.kenBurns !== false
      kbBox.addEventListener('change', () => {
        if (!z) return
        const display = { ...(z.edits.medien?.[m.id]?.display ?? {}) }
        if (kbBox.checked) delete display.kenBurns
        else display.kenBurns = false
        z.edits = mitMedienEdit(z.edits, m.id, { display })
      })
      kb.append(kbBox, 'Ken-Burns')
      kb.title = 'Langsamer Bild-Drift während des Stopps'
      optionen.appendChild(kb)
      info.appendChild(optionen)
    }
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
    if (m.gpsAnker && m.placement === 'zeit') {
      const gps = document.createElement('button')
      gps.className = 'm-gps-knopf'
      gps.textContent = 'GPS-Ort'
      gps.title = 'Den echten Aufnahmeort als Anker verwenden (Abstecher abseits des Tracks)'
      gps.addEventListener('click', () => {
        if (!z || !m.gpsAnker) return
        z.edits = mitMedienEdit(z.edits, m.id, { anchor: m.gpsAnker })
        renderAlles()
      })
      aktionen.appendChild(gps)
    }
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

// — Musik & Sound (Audio-Assets + Overlay-Einträge) —

function stoppeVorschau(): void {
  if (!vorschau) return
  vorschau.audio.pause()
  vorschau.audio.removeAttribute('src')
  vorschau.audio.load()
  vorschau = null
}

function audioStatus(text: string, klasse = ''): void {
  const el = $('editor-audio-status')
  el.className = `hinweis ${klasse}`
  el.textContent = text
}

async function audioHochladen(datei: File): Promise<void> {
  if (!z) return
  const endung = datei.name.toLowerCase().split('.').pop() ?? ''
  if (!AUDIO_ENDUNGEN.includes(endung)) {
    audioStatus(`Nicht unterstützt: .${endung} (erlaubt: ${AUDIO_ENDUNGEN.join(', ')})`, 'fehler')
    return
  }
  // Dateiname säubern + eindeutig machen (Server verbietet Überschreiben)
  const basis = (datei.name.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'audio').slice(0, 40)
  const vorhandene = new Set((z.daten.audio ?? []).map((a) => a.datei))
  let name = `${basis}.${endung}`
  for (let n = 2; vorhandene.has(name); n++) name = `${basis}-${n}.${endung}`
  audioStatus(`${datei.name} wird hochgeladen …`)
  try {
    await api.ladeAudio(z.tourId, name, datei)
  } catch (fehler) {
    audioStatus((fehler as Error).message, 'fehler')
    return
  }
  z.daten.audio = [...(z.daten.audio ?? []), { datei: name, groesse: datei.size }]
  // Standard-Eintrag: Musik ab Tour-Beginn (bzw. Trim-Start) bis zum Ende
  const start = z.daten.time.start
  const skala = baueSkala(z.track)
  const abOffset = z.edits.trim?.start !== undefined ? isoZuOffset(start, z.edits.trim.start) : (skala?.vonS ?? 0)
  z.edits = mitAudioEintrag(z.edits, { datei: name, typ: 'musik', ab: offsetZuIso(start, abOffset) })
  audioStatus('Hochgeladen — Typ und Bereich unten anpassen, dann Speichern.', 'ok')
  renderAlles()
}

function renderAudio(): void {
  const zz = z // Modul-let: Narrowing überlebt die Closures unten nicht
  if (!zz) return
  const container = $('editor-audio')
  container.innerHTML = ''
  const eintraege = zz.edits.audio ?? []
  const dateien = zz.daten.audio ?? []
  if (!eintraege.length && !dateien.length) {
    container.innerHTML = '<div class="leer">Eigene Musik oder Soundeffekte für diese Tour hochladen (MP3, M4A, OGG, WAV).</div>'
    return
  }
  const start = zz.daten.time.start
  const trimSkala = baueSkala(zz.track)

  eintraege.forEach((a, index) => {
    const zeile = document.createElement('div')
    zeile.className = 'audio-zeile'
    // Liegt der Eintrag komplett im weggetrimmten Bereich, verwirft ihn die
    // Pipeline still — hier sichtbar machen, statt den Nutzer rätseln zu lassen
    const verworfen = trimSkala !== null && audioWirdVerworfen(a, zz.edits, start, trimSkala)

    const kopf = document.createElement('div')
    kopf.className = 'a-kopf'
    kopf.innerHTML = icon(a.typ === 'musik' ? 'note' : 'blitz')
    const name = document.createElement('span')
    name.className = 'a-name'
    name.textContent = a.datei
    name.title = a.datei
    kopf.appendChild(name)
    const typ = document.createElement('select')
    for (const [wert, text] of [['musik', 'Musik'], ['sfx', 'Sound']]) {
      const opt = document.createElement('option')
      opt.value = wert as string
      opt.textContent = text as string
      typ.appendChild(opt)
    }
    typ.value = a.typ
    typ.addEventListener('change', () => {
      if (!z) return
      z.edits = mitAudioPatch(z.edits, index, { typ: typ.value as 'musik' | 'sfx' })
      renderAlles()
    })
    kopf.appendChild(typ)
    const weg = document.createElement('button')
    weg.className = 'chip-x'
    weg.textContent = '×'
    weg.title = 'Eintrag entfernen'
    weg.setAttribute('aria-label', `${a.datei} entfernen`)
    weg.addEventListener('click', () => void audioEintragEntfernen(index))
    kopf.appendChild(weg)
    zeile.appendChild(kopf)

    if (verworfen) {
      const warnung = document.createElement('div')
      warnung.className = 'a-warnung'
      warnung.textContent =
        a.typ === 'sfx'
          ? 'Liegt im weggetrimmten Bereich — wird nicht abgespielt.'
          : 'Bereich liegt außerhalb des getrimmten Tracks — wird nicht abgespielt.'
      zeile.appendChild(warnung)
    }

    const zeiten = document.createElement('div')
    zeiten.className = 'a-zeiten'
    const abText = document.createElement('span')
    abText.textContent = `ab ${zeitText(a.ab)}`
    zeiten.appendChild(abText)
    const abKnopf = document.createElement('button')
    abKnopf.textContent = '→ Punkt'
    abKnopf.title = 'Beginn auf den gewählten Punkt setzen'
    abKnopf.disabled = !zz.auswahl
    abKnopf.addEventListener('click', () => {
      if (!z || !z.auswahl) return
      z.edits = mitAudioPatch(z.edits, index, { ab: offsetZuIso(start, z.auswahl[3]) })
      renderAlles()
    })
    zeiten.appendChild(abKnopf)
    if (a.typ === 'musik') {
      const bisText = document.createElement('span')
      bisText.textContent = a.bis !== undefined ? `bis ${zeitText(a.bis)}` : 'bis Ende'
      zeiten.appendChild(bisText)
      const bisKnopf = document.createElement('button')
      bisKnopf.textContent = '→ Punkt'
      bisKnopf.title = 'Ende auf den gewählten Punkt setzen'
      bisKnopf.disabled = !zz.auswahl
      bisKnopf.addEventListener('click', () => {
        if (!z || !z.auswahl) return
        z.edits = mitAudioPatch(z.edits, index, { bis: offsetZuIso(start, z.auswahl[3]) })
        renderAlles()
      })
      zeiten.appendChild(bisKnopf)
      if (a.bis !== undefined) {
        const bisWeg = document.createElement('button')
        bisWeg.textContent = '× Ende'
        bisWeg.title = 'Wieder bis zum Tour-Ende spielen'
        bisWeg.addEventListener('click', () => {
          if (!z) return
          z.edits = mitAudioPatch(z.edits, index, { bis: undefined })
          renderAlles()
        })
        zeiten.appendChild(bisWeg)
      }
    }
    zeile.appendChild(zeiten)

    const fuss = document.createElement('div')
    fuss.className = 'a-fuss'
    const hoeren = document.createElement('button')
    const spielt = vorschau?.datei === a.datei
    hoeren.innerHTML = spielt ? '■' : icon('play')
    hoeren.title = spielt ? 'Vorhören stoppen' : 'Vorhören'
    hoeren.addEventListener('click', () => {
      if (!z) return
      if (vorschau?.datei === a.datei) {
        stoppeVorschau()
      } else {
        stoppeVorschau()
        const audio = new Audio(`/api/media/${z.tourId}/${encodeURIComponent(a.datei)}`)
        audio.volume = a.lautstaerke ?? 1
        audio.addEventListener('ended', () => {
          stoppeVorschau()
          renderAudio()
        })
        void audio.play().catch(() => audioStatus('Vorhören blockiert — einmal in die Seite klicken.', 'fehler'))
        vorschau = { audio, datei: a.datei }
      }
      renderAudio()
    })
    fuss.appendChild(hoeren)
    const regler = document.createElement('input')
    regler.type = 'range'
    regler.min = '0'
    regler.max = '100'
    regler.value = String(Math.round((a.lautstaerke ?? 1) * 100))
    regler.title = 'Lautstärke'
    const lautText = document.createElement('span')
    lautText.className = 'laut'
    lautText.textContent = `${regler.value} %`
    regler.addEventListener('input', () => {
      lautText.textContent = `${regler.value} %`
      if (vorschau?.datei === a.datei) vorschau.audio.volume = Number(regler.value) / 100
    })
    regler.addEventListener('change', () => {
      if (!z) return
      const wert = Number(regler.value) / 100
      z.edits = mitAudioPatch(z.edits, index, { lautstaerke: wert === 1 ? undefined : wert })
      renderZeitleiste()
    })
    fuss.appendChild(regler)
    fuss.appendChild(lautText)
    zeile.appendChild(fuss)

    container.appendChild(zeile)
  })

  // Hochgeladene Dateien ohne Eintrag (nach „Eintrag entfernen" — Löschen ist
  // hier ein bewusster zweiter Schritt; referenzierte Dateien lehnt der Server ab)
  const benutzt = new Set(eintraege.map((a) => a.datei))
  for (const d of dateien.filter((d) => !benutzt.has(d.datei))) {
    const zeile = document.createElement('div')
    zeile.className = 'audio-zeile'
    const kopf = document.createElement('div')
    kopf.className = 'a-kopf'
    kopf.innerHTML = icon('note')
    const name = document.createElement('span')
    name.className = 'a-name'
    name.textContent = d.datei
    name.title = `${d.datei} · ${(d.groesse / 1048576).toFixed(1)} MB — nicht eingesetzt`
    name.style.opacity = '0.6'
    kopf.appendChild(name)
    const nutzen = document.createElement('button')
    nutzen.textContent = 'Einsetzen'
    nutzen.addEventListener('click', () => {
      if (!z) return
      const skala = baueSkala(z.track)
      z.edits = mitAudioEintrag(z.edits, { datei: d.datei, typ: 'musik', ab: offsetZuIso(z.daten.time.start, skala?.vonS ?? 0) })
      renderAlles()
    })
    kopf.appendChild(nutzen)
    const weg = document.createElement('button')
    weg.className = 'chip-x'
    weg.textContent = '×'
    weg.title = 'Datei vom Server löschen'
    weg.addEventListener('click', () => void audioDateiLoeschen(d.datei))
    kopf.appendChild(weg)
    zeile.appendChild(kopf)
    container.appendChild(zeile)
  }
}

function audioEintragEntfernen(index: number): void {
  if (!z) return
  const eintrag = (z.edits.audio ?? [])[index]
  if (!eintrag) return
  if (vorschau?.datei === eintrag.datei) stoppeVorschau()
  z.edits = ohneAudioEintrag(z.edits, index)
  // Die Datei bleibt BEWUSST auf dem Server: das Overlay ist erst beim
  // Speichern persistiert, und ein evtl. schon gerendertes tour.json
  // referenziert sie ggf. noch. Sie erscheint unten als „nicht eingesetzt"
  // und ist dort explizit löschbar (der Server schützt referenzierte Dateien).
  audioStatus(`Eintrag entfernt — ${eintrag.datei} bleibt gespeichert.`, 'ok')
  renderAlles()
}

async function audioDateiLoeschen(datei: string, still = false): Promise<void> {
  if (!z) return
  try {
    await api.loescheAudio(z.tourId, datei)
    z.daten.audio = (z.daten.audio ?? []).filter((a) => a.datei !== datei)
    if (!still) audioStatus(`${datei} gelöscht.`, 'ok')
  } catch (fehler) {
    if (!still) audioStatus((fehler as Error).message, 'fehler')
  }
  renderAlles()
}

// — Zeitleiste: Bänder, Trim-Griffe, Pins, Medien-Dots, Audio-Spur —

interface ZugZustand {
  rolle: string
  /** Overlay-Identität: ISO-`ab` bei Pins, Index bei Audio */
  ab?: string
  mode?: Modus
  preset?: KameraPreset
  index?: number
  /** Abstand Cursor↔Balkenanfang beim Greifen (Anteil), für ruckfreies Schieben */
  griffVersatz?: number
  bewegt: boolean
}

let zug: ZugZustand | null = null

function spurAnteil(clientX: number): number {
  const spur = document.querySelector<HTMLElement>('#zeitleiste .zl-spur')
  if (!spur) return 0
  const r = spur.getBoundingClientRect()
  return Math.max(0, Math.min(1, (clientX - r.left) / r.width))
}

function renderZeitleiste(): void {
  if (!z) return
  const el = $('zeitleiste')
  const skala = baueSkala(z.track)
  if (!skala) {
    el.hidden = true
    return
  }
  el.hidden = false
  const start = z.daten.time.start
  const pos = (anteil: number): string => `${(anteil * 100).toFixed(3)}%`

  el.innerHTML = ''
  const spur = document.createElement('div')
  spur.className = 'zl-spur'

  const grund = document.createElement('div')
  grund.className = 'zl-grund'
  grund.dataset['rolle'] = 'spur'
  for (const b of baueBaender(zerlegeFuerAnzeige(z.daten.segmente as EditorSegment[], z.edits, start), skala)) {
    const band = document.createElement('div')
    band.className = `zl-band${b.aktiv ? '' : ' inaktiv'}`
    band.style.left = pos(b.von)
    band.style.width = pos(b.bis - b.von)
    band.style.background = MODUS_FARBEN[b.mode]
    grund.appendChild(band)
  }
  spur.appendChild(grund)

  // Trim: abgedunkelte Außenbereiche + zwei Griffe
  const trim = baueTrimGriffe(z.edits, start, skala)
  const links = document.createElement('div')
  links.className = 'zl-schatten links'
  links.style.width = pos(trim.start)
  spur.appendChild(links)
  const rechts = document.createElement('div')
  rechts.className = 'zl-schatten rechts'
  rechts.style.width = pos(1 - trim.ende)
  spur.appendChild(rechts)
  for (const [rolle, anteil, titel] of [
    ['trim-start', trim.start, 'Start der Wiedergabe (ganz nach links = kein Trim)'],
    ['trim-ende', trim.ende, 'Ende der Wiedergabe (ganz nach rechts = kein Trim)'],
  ] as const) {
    const griff = document.createElement('div')
    griff.className = 'zl-griff'
    griff.style.left = pos(anteil)
    griff.dataset['rolle'] = rolle
    griff.title = titel
    spur.appendChild(griff)
  }

  // Modus- und Kamera-Pins (draggable)
  for (const g of z.edits.modi ?? []) {
    const p = bauePins([{ ab: g.ab, text: MODUS_NAMEN[g.mode] }], start, skala)[0]
    if (!p) continue
    const pin = document.createElement('div')
    pin.className = 'zl-pin'
    pin.style.left = pos(p.anteil)
    pin.style.background = MODUS_FARBEN[g.mode]
    pin.dataset['rolle'] = 'grenze'
    pin.dataset['ab'] = g.ab
    pin.dataset['mode'] = g.mode
    pin.title = `${MODUS_NAMEN[g.mode]} ab ${zeitText(g.ab)} — ziehen zum Verschieben`
    spur.appendChild(pin)
  }
  for (const g of z.edits.kamera ?? []) {
    const p = bauePins([{ ab: g.ab, text: g.preset }], start, skala)[0]
    if (!p) continue
    const pin = document.createElement('div')
    pin.className = 'zl-pin kamera'
    pin.style.left = pos(p.anteil)
    pin.dataset['rolle'] = 'kamera'
    pin.dataset['ab'] = g.ab
    pin.dataset['preset'] = g.preset
    pin.title = `Kamera ${PRESET_NAMEN[g.preset]} ab ${zeitText(g.ab)} — ziehen zum Verschieben`
    spur.appendChild(pin)
  }

  // Medien-Dots an ihrer Wiedergabe-Position
  for (const d of baueMedienDots(medienAnzeige(), z.track, skala)) {
    const dot = document.createElement('div')
    dot.className = `zl-dot${d.type === 'video' ? ' video' : ''}`
    dot.style.left = pos(d.anteil)
    dot.dataset['rolle'] = 'dot'
    dot.dataset['id'] = d.id
    dot.title = d.id
    spur.appendChild(dot)
  }

  // Auswahl-/Hover-Linie
  if (z.auswahl) {
    const sel = document.createElement('div')
    sel.className = 'zl-hover'
    sel.style.display = 'block'
    sel.style.opacity = '0.9'
    sel.style.background = 'var(--akzent)'
    sel.style.left = pos(offsetZuAnteil(skala, z.auswahl[3]))
    spur.appendChild(sel)
  }
  const hover = document.createElement('div')
  hover.className = 'zl-hover'
  hover.dataset['teil'] = 'hover'
  spur.appendChild(hover)
  const tip = document.createElement('div')
  tip.className = 'zl-tip'
  tip.dataset['teil'] = 'tip'
  spur.appendChild(tip)

  el.appendChild(spur)

  // Audio-Spur (Musik-Balken + SFX-Rauten)
  const audioSpur = document.createElement('div')
  audioSpur.className = 'zl-audio'
  for (const b of baueAudioBalken(z.edits.audio ?? [], start, skala)) {
    if (b.typ === 'musik') {
      const balken = document.createElement('div')
      balken.className = 'zl-audio-balken'
      balken.style.left = pos(b.von)
      balken.style.width = pos(Math.max(0.004, b.bis - b.von))
      balken.dataset['rolle'] = 'audio-balken'
      balken.dataset['index'] = String(b.index)
      balken.title = `${b.datei} — ziehen zum Verschieben, Kanten für den Bereich`
      for (const kante of ['von', 'bis'] as const) {
        const griff = document.createElement('div')
        griff.className = `kante ${kante}`
        griff.dataset['rolle'] = `audio-${kante}`
        griff.dataset['index'] = String(b.index)
        balken.appendChild(griff)
      }
      audioSpur.appendChild(balken)
    } else {
      const raute = document.createElement('div')
      raute.className = 'zl-sfx'
      raute.style.left = pos(b.von)
      raute.dataset['rolle'] = 'sfx'
      raute.dataset['index'] = String(b.index)
      raute.title = `${b.datei} — ziehen zum Verschieben`
      audioSpur.appendChild(raute)
    }
  }
  el.appendChild(audioSpur)

  // Zeit-Ticks
  const ticks = document.createElement('div')
  ticks.className = 'zl-ticks'
  for (const t of baueTicks(start, skala, z.daten.time.zone)) {
    const s = document.createElement('span')
    s.style.left = pos(t.anteil)
    s.textContent = t.text
    ticks.appendChild(s)
  }
  el.appendChild(ticks)
}

/** Während eines Zugs nur die betroffenen Teile neu zeichnen (Karte + Leiste). */
function renderNachZug(): void {
  zeichneTrack()
  renderZeitleiste()
  renderTrimUndGrenzen()
  renderKamera()
}

function zeitleisteZug(e: PointerEvent): void {
  if (!z || !zug) return
  const skala = baueSkala(z.track)
  if (!skala) return
  const start = z.daten.time.start
  const anteil = spurAnteil(e.clientX)
  const iso = (a: number): string => offsetZuIso(start, anteilZuOffset(skala, a))
  zug.bewegt = true

  switch (zug.rolle) {
    case 'trim-start': {
      const ende = baueTrimGriffe(z.edits, start, skala).ende
      const a = Math.min(anteil, ende - 0.005)
      z.edits = mitTrim(z.edits, 'start', a <= 0.002 ? null : iso(a))
      break
    }
    case 'trim-ende': {
      const startA = baueTrimGriffe(z.edits, start, skala).start
      const a = Math.max(anteil, startA + 0.005)
      z.edits = mitTrim(z.edits, 'ende', a >= 0.998 ? null : iso(a))
      break
    }
    case 'grenze': {
      if (zug.ab === undefined || !zug.mode) break
      const neuAb = iso(anteil)
      // Kollisions-Schutz: exakt auf einer ANDEREN Grenze würde die
      // Ersetzen-Semantik von mitModusGrenze diese verschlucken → Zug auslassen
      if (neuAb !== zug.ab && z.edits.modi?.some((g) => g.ab === neuAb)) break
      z.edits = mitModusGrenze(ohneModusGrenze(z.edits, zug.ab), neuAb, zug.mode)
      zug.ab = neuAb
      break
    }
    case 'kamera': {
      if (zug.ab === undefined || !zug.preset) break
      const neuAb = iso(anteil)
      if (neuAb !== zug.ab && z.edits.kamera?.some((g) => g.ab === neuAb)) break
      z.edits = mitKameraGrenze(ohneKameraGrenze(z.edits, zug.ab), neuAb, zug.preset)
      zug.ab = neuAb
      break
    }
    case 'audio-balken': {
      if (zug.index === undefined) break
      const a = (z.edits.audio ?? [])[zug.index]
      if (!a) break
      const von = offsetZuAnteil(skala, isoZuOffset(start, a.ab))
      const laenge = a.bis !== undefined ? offsetZuAnteil(skala, isoZuOffset(start, a.bis)) - von : null
      const neuVon = Math.max(0, Math.min(anteil - (zug.griffVersatz ?? 0), laenge !== null ? 1 - laenge : 1))
      const patch: { ab: string; bis?: string } = { ab: iso(neuVon) }
      if (laenge !== null) patch.bis = iso(neuVon + laenge)
      z.edits = mitAudioPatch(z.edits, zug.index, patch)
      break
    }
    case 'audio-von': {
      if (zug.index === undefined) break
      const a = (z.edits.audio ?? [])[zug.index]
      if (!a) break
      const bisA = a.bis !== undefined ? offsetZuAnteil(skala, isoZuOffset(start, a.bis)) : 1
      z.edits = mitAudioPatch(z.edits, zug.index, { ab: iso(Math.min(anteil, bisA - 0.005)) })
      break
    }
    case 'audio-bis': {
      if (zug.index === undefined) break
      const a = (z.edits.audio ?? [])[zug.index]
      if (!a) break
      const vonA = offsetZuAnteil(skala, isoZuOffset(start, a.ab))
      const b = Math.max(anteil, vonA + 0.005)
      z.edits = mitAudioPatch(z.edits, zug.index, { bis: b >= 0.998 ? undefined : iso(b) })
      break
    }
    case 'sfx': {
      if (zug.index === undefined) break
      z.edits = mitAudioPatch(z.edits, zug.index, { ab: iso(anteil) })
      break
    }
  }
  renderNachZug()
}

function verdrahteZeitleiste(): void {
  const el = $('zeitleiste')

  el.addEventListener('pointerdown', (e) => {
    if (!z) return
    const ziel = (e.target as HTMLElement).closest<HTMLElement>('[data-rolle]')
    if (!ziel) return
    const rolle = ziel.dataset['rolle']!
    if (rolle === 'dot') return // Klick, kein Zug
    e.preventDefault()
    el.setPointerCapture(e.pointerId)
    zug = { rolle, bewegt: false }
    if (ziel.dataset['ab'] !== undefined) zug.ab = ziel.dataset['ab']
    if (ziel.dataset['mode']) zug.mode = ziel.dataset['mode'] as Modus
    if (ziel.dataset['preset']) zug.preset = ziel.dataset['preset'] as KameraPreset
    if (ziel.dataset['index'] !== undefined) zug.index = Number(ziel.dataset['index'])
    if (rolle === 'audio-balken') {
      // Versatz zwischen Cursor und Balkenanfang merken → ruckfreies Schieben
      const skala = baueSkala(z.track)
      const a = (z.edits.audio ?? [])[zug.index ?? -1]
      if (skala && a) {
        zug.griffVersatz = spurAnteil(e.clientX) - offsetZuAnteil(skala, isoZuOffset(z.daten.time.start, a.ab))
      }
    }
  })

  el.addEventListener('pointermove', (e) => {
    if (!z) return
    if (zug) {
      zeitleisteZug(e)
      return
    }
    // Hover: Linie + Zeit-Tooltip + Positions-Marker auf der Karte
    const skala = baueSkala(z.track)
    if (!skala || !karte) return
    const anteil = spurAnteil(e.clientX)
    const offset = anteilZuOffset(skala, anteil)
    const hover = el.querySelector<HTMLElement>('[data-teil="hover"]')
    const tip = el.querySelector<HTMLElement>('[data-teil="tip"]')
    if (hover && tip) {
      hover.style.display = 'block'
      hover.style.left = `${anteil * 100}%`
      tip.style.display = 'block'
      tip.style.left = `${anteil * 100}%`
      tip.textContent = zeitText(offsetZuIso(z.daten.time.start, offset))
    }
    const punkt = punktZuOffset(z.track, offset)
    if (punkt) {
      if (!hoverMarker) {
        const dot = document.createElement('div')
        dot.className = 'hover-marker'
        hoverMarker = new maplibregl.Marker({ element: dot }).setLngLat([punkt[0], punkt[1]]).addTo(karte)
      } else {
        hoverMarker.setLngLat([punkt[0], punkt[1]])
      }
    }
  })

  const zugEnde = (e: PointerEvent): void => {
    const zz = z // Modul-let: Narrowing überlebt Funktionsaufrufe nicht
    if (!zz) return
    if (zug) {
      const war = zug
      zug = null
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
      if (war.bewegt) {
        renderAlles()
        return
      }
      // Kein Zug = Klick: auf der Spur einen Punkt wählen
      if (war.rolle === 'spur' || war.rolle === 'trim-start' || war.rolle === 'trim-ende') {
        const skala = baueSkala(zz.track)
        if (skala) {
          zz.auswahl = punktZuOffset(zz.track, anteilZuOffset(skala, spurAnteil(e.clientX)))
          renderAlles()
        }
      }
    }
  }
  el.addEventListener('pointerup', (e) => {
    // Dot-Klick: Karte + Liste synchronisieren
    const dot = (e.target as HTMLElement).closest<HTMLElement>('[data-rolle="dot"]')
    if (dot && z) {
      const medium = medienAnzeige().find((m) => m.id === dot.dataset['id'])
      if (medium) {
        fliegeZuMedium(medium)
        blitzeZeile(medium.id)
      }
    }
    zugEnde(e)
  })
  el.addEventListener('pointercancel', zugEnde)
  el.addEventListener('pointerleave', () => {
    if (zug) return
    const hover = el.querySelector<HTMLElement>('[data-teil="hover"]')
    const tip = el.querySelector<HTMLElement>('[data-teil="tip"]')
    if (hover) hover.style.display = 'none'
    if (tip) tip.style.display = 'none'
    hoverMarker?.remove()
    hoverMarker = null
  })
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
    if (!z || !z.auswahl) return
    const mode = ($('e-grenze-mode') as HTMLSelectElement).value as Modus
    z.edits = mitModusGrenze(z.edits, offsetZuIso(z.daten.time.start, z.auswahl[3]), mode)
    renderAlles()
  })
  $('e-kamera').addEventListener('click', () => {
    if (!z || !z.auswahl) return
    const preset = ($('e-kamera-preset') as HTMLSelectElement).value as KameraPreset
    z.edits = mitKameraGrenze(z.edits, offsetZuIso(z.daten.time.start, z.auswahl[3]), preset)
    renderAlles()
  })
  $('e-audio-hinzu').addEventListener('click', () => $('e-audio-datei').click())
  $('e-audio-datei').addEventListener('change', () => {
    const eingabe = $('e-audio-datei') as HTMLInputElement
    const datei = eingabe.files?.[0]
    if (datei) void audioHochladen(datei)
    eingabe.value = ''
  })
  verdrahteZeitleiste()
}

function trimSetzen(teil: 'start' | 'ende'): void {
  if (!z || !z.auswahl) return
  z.edits = mitTrim(z.edits, teil, offsetZuIso(z.daten.time.start, z.auswahl[3]))
  renderAlles()
}

// Debug-Handle (Konvention wie window.__j im Player) — auch fürs Browser-E2E:
// Karte und Zustand inspizieren, Track-Koordinaten in Pixel projizieren.
;(window as unknown as Record<string, unknown>)['__studio'] = {
  karte: () => karte,
  zustand: () => z,
}
