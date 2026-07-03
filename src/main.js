import 'maplibre-gl/dist/maplibre-gl.css'
import './style.css'
import { TOURS } from './tours.js'
import { buildRoute, nearestS, pointAt } from './geo.js'
import { createMap, addRouteLayers, createRider, setRiderIcon, addSpotLayers, setBuildingsNight } from './map.js'
import { createDayNight } from './daynight.js'
import { createPhotoreal } from './photoreal.js'
import { sampleElevations, smoothValues } from './elevation.js'
import { UI } from './ui.js'
import { Tour } from './tour.js'

// — Tour-Auswahl via ?tour=… —
const params = new URLSearchParams(location.search)
const tourId = TOURS[params.get('tour')] ? params.get('tour') : 'oberland'
const cfg = TOURS[tourId]

// Segmente zu einer Wegpunktliste verbinden (Nahtpunkte dedupen)
const waypoints = []
for (const seg of cfg.segments) {
  waypoints.push(...(waypoints.length ? seg.pts.slice(1) : seg.pts))
}
const route = buildRoute(waypoints)
const modes = cfg.segments.map((seg) => ({
  s: nearestS(route, seg.pts[0]),
  mode: seg.mode,
  label: seg.label ?? seg.mode,
}))
modes[0].s = 0
const photos = cfg.photos.map((p) => ({ ...p, s: nearestS(route, p.anchor) })).sort((a, b) => a.s - b.s)
// Fotos mit nahe beieinanderliegenden Ankern zu einem Stopp gruppieren —
// dort werden sie nacheinander gezeigt (ein Halt, mehrere Bilder)
const stops = []
for (const p of photos) {
  const last = stops[stops.length - 1]
  if (last && p.s - last.s < 120) last.items.push(p)
  else stops.push({ s: p.s, items: [p] })
}
const start = pointAt(route, 0)

// — Texte aus der Tour-Konfiguration —
const setText = (id, text) => (document.getElementById(id).textContent = text)
document.title = `Journey — ${cfg.brandTitle}`
setText('brand-kicker', `Journey · ${cfg.no}`)
setText('brand-title', cfg.brandTitle)
setText('brand-route', cfg.stops.join(' — '))
setText('intro-kicker', cfg.kicker)
document.getElementById('intro-title').innerHTML = cfg.titleHtml
setText('intro-route', cfg.stops.join('  →  '))
setText('finale-title', cfg.finaleTitle)
setText('chip-photos', `${photos.length} Fotos`)
setText('final-photos', String(photos.length))

// Tour-Auswahl im Intro
for (const btn of document.querySelectorAll('#tour-picker button')) {
  btn.classList.toggle('active', btn.dataset.tour === tourId)
  btn.addEventListener('click', () => {
    if (btn.dataset.tour !== tourId) location.search = `?tour=${btn.dataset.tour}`
  })
}

const map = createMap('map', [start[0], start[1]], cfg.demMaxzoom)
window.__j = { map, route }

map.on('error', (e) => console.error('map error:', e.error?.message ?? e))

map.on('load', () => {
  const syncTrace = addRouteLayers(map, route)
  const rider = createRider(map, [start[0], start[1]], modes[0].mode)

  const photoreal = createPhotoreal('g3d', route, cfg.geoid ?? 0)

  const ui = new UI(stops, route)
  ui.updateTrace = (s, pos) => {
    syncTrace(s, pos)
    rider.setLngLat([pos[0], pos[1]])
    photoreal.setProgress(pos) // no-op, solange der Google-3D-Modus aus ist
  }
  ui.onModeChange = (mode) => setRiderIcon(rider, mode)
  document.getElementById('tele-mode').textContent = modes[0].label

  const km = `${(route.total / 1000).toFixed(1)} km`
  const setGain = (hm) => {
    document.getElementById('chip-gain').textContent = `${Math.round(hm)} hm`
    document.getElementById('final-gain').textContent = `${Math.round(hm)} hm`
  }
  document.getElementById('chip-distance').textContent = km
  document.getElementById('final-km').textContent = km
  setGain(route.gain)

  // Echte DEM-Höhen nachladen: korrigiert Höhenprofil, Telemetrie und
  // Höhenmeter — die Wegpunkt-Höhen sind nur der Startwert.
  const modeAtS = (s) => {
    let cur = modes[0]
    for (const m of modes) if (m.s <= s + 1) cur = m
    return cur
  }
  window.__j.eleReady = sampleElevations(route.coords)
    .then((eles) => {
      const sm = smoothValues(eles, 9)
      route.coords.forEach((c, i) => (c[2] = sm[i]))
      // Fähr-Abschnitte auf Meereshöhe klemmen: das DEM rauscht über der
      // Ostsee um einige Meter und würde Phantom-Höhenmeter aufsummieren
      route.coords.forEach((c, i) => {
        if (modeAtS(route.cum[i]).mode === 'ferry') c[2] = 0
      })
      let gain = 0
      const cs = route.coords
      for (let i = 1; i < cs.length; i++) if (cs[i][2] > cs[i - 1][2]) gain += cs[i][2] - cs[i - 1][2]
      route.gain = gain
      setGain(gain)
      ui.rebuildProfile()
      return 'dem'
    })
    .catch(() => 'fallback') // Offline o. Ä.: Profil bleibt bei Wegpunkt-Höhen

  map.dragPan.disable()
  map.scrollZoom.disable()
  map.doubleClickZoom.disable()
  map.touchZoomRotate.disable()
  map.touchPitch.disable()

  const tour = new Tour(map, route, stops, ui, { modes })
  Object.assign(window.__j, { tour, rider })

  // Foto-Wegpunkte + Startpunkt als GL-Layer auf der Karte
  const syncSpots = addSpotLayers(
    map,
    stops.map((st) => {
      const pos = pointAt(route, st.s)
      return { lnglat: [pos[0], pos[1]], s: st.s }
    }),
    [start[0], start[1]],
    (s) => tour.jumpToPhoto(s) // Wegpunkt-Klick öffnet das Foto direkt
  )
  ui.registerSpots(syncSpots)
  ui.syncDots(0)

  // — Steuerung —
  document.getElementById('btn-start').addEventListener('click', () => tour.begin())
  document.getElementById('btn-play').addEventListener('click', () => tour.setPlaying(!tour.playing))
  document.getElementById('btn-replay').addEventListener('click', () => tour.restart())

  const speedBtn = document.getElementById('btn-speed')
  // Tempo-Label aus dem Tour-Zustand: Faktor + Richtung (−4× = 4× rückwärts).
  // Wird pro Stats-Tick aufgerufen, bleibt also auch nach JKL-Shuttle aktuell.
  ui.onSpeed = (mult, dir) => {
    const txt = `${dir < 0 ? '−' : ''}${mult}×`
    if (speedBtn.textContent !== txt) speedBtn.textContent = txt
  }
  speedBtn.addEventListener('click', () => {
    tour.dir = 1 // Button ist ein Vorwärts-Tempo-Umschalter
    ui.onSpeed(tour.cycleSpeed(), tour.dir)
  })

  for (const btn of document.querySelectorAll('.preset-btn')) {
    btn.addEventListener('click', () => {
      document.querySelector('.preset-btn.active')?.classList.remove('active')
      btn.classList.add('active')
      tour.setPreset(btn.dataset.preset)
    })
  }

  // Tag/Nacht: Streckenanteil ↦ Pseudo-Uhrzeit ↦ Sonnenstand ↦ Szenenstimmung
  if (cfg.time) {
    const t0 = Date.parse(cfg.time.start)
    const t1 = Date.parse(cfg.time.end)
    const fmt = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: cfg.time.zone })
    const teleTime = document.getElementById('tele-time')
    document.getElementById('tele-time-wrap').hidden = false
    const dayNight = createDayNight(map, (on) => setBuildingsNight(map, on))
    ui.onTick = (frac) => {
      const date = new Date(t0 + frac * (t1 - t0))
      const pos = pointAt(route, frac * route.total)
      dayNight(date, [pos[0], pos[1]])
      teleTime.textContent = fmt.format(date)
    }
    ui.onTick(0) // Startstimmung sofort, nicht erst beim ersten Stats-Tick
  }

  // Dock-Höhe als CSS-Variable: mobil rückt die (Pflicht-)Attribution darüber
  const dockEl = document.getElementById('dock')
  new ResizeObserver(() => {
    document.documentElement.style.setProperty('--dock-h', `${dockEl.offsetHeight}px`)
  }).observe(dockEl)

  // Timeline: Ziehen scrubbt wie im Video-Editor, Tippen springt. Auch die
  // Foto-Dots laufen über diesen Weg — Chromes Touch-Zielkorrektur legt den
  // Finger gern auf einen Dot, ein separater Dot-Handler würde Scrubs schlucken.
  // Tap ohne Bewegung auf einem Dot = Sprung kurz vor dessen Foto-Stopp.
  const progress = document.getElementById('progress')
  const fracAt = (e) => {
    const rect = progress.getBoundingClientRect()
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  }
  let scrubMoved = false
  let scrubDot = null
  let scrubDownX = 0
  progress.addEventListener('pointerdown', (e) => {
    scrubMoved = false
    scrubDot = e.target.classList.contains('photo-dot') ? Number(e.target.dataset.s) : null
    scrubDownX = e.clientX
    progress.setPointerCapture(e.pointerId)
    document.body.classList.add('scrubbing') // Scrub-Cursor, auch über den Dots
    tour.beginScrub(fracAt(e))
  })
  progress.addEventListener('pointermove', (e) => {
    if (!tour.scrubbing) return
    if (!scrubMoved && Math.abs(e.clientX - scrubDownX) < 4) return // Tipp-Zittern ist kein Scrub
    scrubMoved = true
    tour.scrub(fracAt(e))
  })
  progress.addEventListener('pointerup', (e) => {
    document.body.classList.remove('scrubbing')
    if (!tour.scrubbing) return
    if (!scrubMoved && scrubDot != null) tour.jumpToPhoto(scrubDot) // Dot-Tap: Foto sofort
    else tour.endScrub(fracAt(e))
  })
  progress.addEventListener('pointercancel', () => {
    document.body.classList.remove('scrubbing')
    // abgebrochene Gesten liefern keine brauchbaren Koordinaten mehr
    if (tour.scrubbing) tour.endScrub(tour.s / route.total)
  })

  for (const dot of document.querySelectorAll('.photo-dot')) {
    dot.addEventListener('click', (e) => {
      e.stopPropagation()
      // Pointer-Gesten laufen über das Scrubbing oben — hier nur noch die
      // Tastatur-Aktivierung (Enter/Leertaste erzeugt click mit detail 0)
      if (e.detail === 0) tour.jumpToPhoto(Number(dot.dataset.s))
    })
  }

  // Klick aufs Foto hält die Anzeige an (und löst sie wieder); „Weiter“
  // springt zum nächsten Foto des Stopps bzw. setzt die Fahrt fort
  document.getElementById('photo-card').addEventListener('click', () => tour.togglePhotoHold())
  document.getElementById('photo-next').addEventListener('click', (e) => {
    e.stopPropagation()
    tour.photoNext()
  })

  // UI ein-/ausblenden (Kino-Modus) — das Icon zeigt immer die AKTION:
  // durchgestrichenes Auge = ausblenden, offenes Auge = wieder einblenden
  const uiBtn = document.getElementById('btn-ui')
  const iconEye = document.getElementById('icon-eye')
  const iconEyeOff = document.getElementById('icon-eye-off')
  const setClean = (on) => {
    document.body.classList.toggle('ui-clean', on)
    // toggleAttribute statt .hidden: SVGs haben keine hidden-Property
    iconEyeOff.toggleAttribute('hidden', on)
    iconEye.toggleAttribute('hidden', !on)
    uiBtn.title = on ? 'UI einblenden (H)' : 'UI ausblenden (H)'
    uiBtn.setAttribute('aria-label', on ? 'UI einblenden' : 'UI ausblenden')
    uiBtn.setAttribute('aria-pressed', String(on))
  }
  uiBtn.addEventListener('click', () => setClean(!document.body.classList.contains('ui-clean')))

  // Zurück ins Hauptmenü — ein evtl. aktiver Kino-Modus endet dabei mit
  document.getElementById('btn-menu').addEventListener('click', () => {
    setClean(false)
    tour.toMenu()
  })

  // — Google Photorealistic 3D Tiles (Testmodus) —
  // MapLibre läuft unsichtbar weiter (Tour-Engine braucht dessen Terrain);
  // Cesium spiegelt die Kamera. Der API-Schlüssel bleibt im localStorage.
  const toastEl = document.getElementById('toast')
  let toastT = null
  const toast = (msg) => {
    toastEl.textContent = msg
    toastEl.hidden = false
    clearTimeout(toastT)
    toastT = setTimeout(() => (toastEl.hidden = true), 5200)
  }

  const g3dBtn = document.getElementById('btn-g3d')
  const g3dModal = document.getElementById('g3d-modal')
  const g3dKeyInput = document.getElementById('g3d-key')
  let g3dOn = false
  let g3dBusy = false

  // Nur im lokalen Dev-Server: Google-Schlüssel aus der .env (VITE_GOOGLE_MAP_TILES_API_KEY).
  // Der DEV-Guard lässt den Wert beim Produktions-Build als toten Code wegfallen —
  // im deployten Bundle landet er nie.
  const g3dEnvKey = import.meta.env.DEV ? import.meta.env.VITE_GOOGLE_MAP_TILES_API_KEY || '' : ''

  const setG3d = async (on) => {
    if (g3dBusy) return
    if (!on) {
      g3dOn = false
      tour.extCamera = null
      photoreal.disable()
      document.getElementById('map').style.visibility = ''
      g3dBtn.classList.remove('active')
      g3dBtn.setAttribute('aria-pressed', 'false')
      return
    }
    const key = localStorage.getItem('g3dKey') || g3dEnvKey
    if (!key) {
      g3dModal.hidden = false
      g3dKeyInput.focus()
      return
    }
    g3dBusy = true
    g3dBtn.classList.add('active')
    try {
      await photoreal.enable(key)
      g3dOn = true
      tour.extCamera = photoreal.setCamera
      document.getElementById('map').style.visibility = 'hidden'
      g3dBtn.setAttribute('aria-pressed', 'true')
      tour.applyCamera() // Cesium sofort auf die aktuelle Pose setzen
      toast('Google Photorealistic 3D aktiv (Testmodus)')
    } catch (err) {
      console.error('Google 3D Tiles:', err)
      g3dBtn.classList.remove('active')
      toast('Google 3D Tiles ließen sich nicht laden — Schlüssel/Abrechnung prüfen. Details in der Konsole.')
      localStorage.removeItem('g3dKey') // beim nächsten Versuch neu abfragen
    }
    g3dBusy = false
  }

  g3dBtn.addEventListener('click', () => setG3d(!g3dOn))
  document.getElementById('g3d-cancel').addEventListener('click', () => (g3dModal.hidden = true))
  document.getElementById('g3d-save').addEventListener('click', () => {
    const key = g3dKeyInput.value.trim()
    if (!key) return
    localStorage.setItem('g3dKey', key)
    g3dModal.hidden = true
    setG3d(true)
  })

  // Tastatursteuerung des Players (wie in Videoschnitt-Software)
  window.addEventListener('keydown', (e) => {
    // In Textfeldern (z. B. Google-Key-Dialog) nichts abfangen
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
    if (tour.phase === 'intro') return // vor dem Start hat der Player keine Tasten

    switch (e.code) {
      case 'Space': // Start/Stopp
        e.preventDefault()
        tour.setPlaying(!tour.playing)
        break
      case 'KeyH': // UI ein-/ausblenden
        setClean(!document.body.classList.contains('ui-clean'))
        break
      case 'ArrowRight': // ein Bild vor (Shift: 12 Bilder)
        e.preventDefault()
        tour.nudge(e.shiftKey ? 12 : 1)
        break
      case 'ArrowLeft': // ein Bild zurück
        e.preventDefault()
        tour.nudge(e.shiftKey ? -12 : -1)
        break
      case 'KeyL': // JKL: vorwärts (nochmal = schneller)
        e.preventDefault()
        tour.shuttle(1)
        break
      case 'KeyJ': // JKL: rückwärts (nochmal = schneller)
        e.preventDefault()
        tour.shuttle(-1)
        break
      case 'KeyK': // JKL: anhalten
        e.preventDefault()
        tour.mult = 1
        tour.dir = 1
        tour.setPlaying(false)
        break
    }
  })
})
