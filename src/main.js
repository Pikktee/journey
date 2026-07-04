import 'maplibre-gl/dist/maplibre-gl.css'
import './style.css'
import { TOURS } from './tours.js'
import { buildRoute, nearestS, pointAt } from './geo.js'
import { createMap, addRouteLayers, createRider, setRiderIcon, addSpotLayers, setBuildingsNight } from './map.js'
import { createDayNight } from './daynight.js'
import { installBuildingEnhancer } from './buildings.js'
import { installBuildingShadows } from './shadows.js'
import { sampleElevations, smoothValues } from './elevation.js'
import { UI } from './ui.js'
import { Tour } from './tour.js'

// — Tour-Auswahl via ?tour=… —
const params = new URLSearchParams(location.search)
const tourId = TOURS[params.get('tour')] ? params.get('tour') : 'stockholm'
const cfg = TOURS[tourId]

// Position (und Play/Pause-Zustand) über Reloads hinweg merken — u.a. damit ein
// Renderer-/Ansicht-Wechsel (Full-Reload) am selben Frame und im selben Wieder-
// gabezustand weiterläuft. Modulweit, weil auch der Ansicht-Umschalter davor speichert.
const POS_KEY = `luhambo:pos:${tourId}`
const savePos = (tour) => {
  if (tour.phase === 'ride' || tour.phase === 'photo') {
    localStorage.setItem(POS_KEY, JSON.stringify({ s: tour.s, ts: Date.now(), playing: tour.playing }))
  } else {
    localStorage.removeItem(POS_KEY)
  }
}

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
document.title = `Luhambo — ${cfg.brandTitle}`
setText('brand-kicker', `Luhambo · ${cfg.no}`)
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

const map = createMap('map', [start[0], start[1]])
window.__j = { map, route }

// Boot-Screen sanft ausblenden, sobald die Karte da ist. 'idle' gibt das
// schönste Timing (Kacheln gerendert); 'load' und ein absoluter Timeout sind
// Fallbacks, damit der Screen nie hängen bleibt (z.B. gedrosselter Hintergrund-Tab).
const boot = document.getElementById('boot')
if (boot) {
  let dismissed = false
  const dismissBoot = () => {
    if (dismissed) return
    dismissed = true
    boot.classList.add('gone')
    setTimeout(() => boot.remove(), 800)
  }
  map.once('idle', dismissBoot)
  map.once('load', dismissBoot)
  setTimeout(dismissBoot, 4000)
}

map.on('error', (e) => console.error('map error:', e.error?.message ?? e))

map.on('load', () => {
  const syncTrace = addRouteLayers(map, route)
  const rider = createRider(map, [start[0], start[1]], modes[0].mode)

  let tiles3d = null // „Google 3D"-Modus via Three.js (?tiles3d=1), lazy geladen

  let scene = null // reine deck-Szene (?scene=1), async geladen — Trace/Tag-Nacht hängen daran

  const ui = new UI(stops, route)
  ui.updateTrace = (s, pos) => {
    syncTrace(s, pos)
    rider.setLngLat([pos[0], pos[1]])
    scene?.setProgress(s, pos) // reine deck-Szene: Trace bis exakt zum Fahrer nachziehen
    tiles3d?.setProgress(s, pos) // Google-3D-Modus: Trace + Fahrer-Marker (no-op solange aus)
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

  // Diagnose-Helfer (Konsole): alle Baukörper um [x,y] Pixel verschieben. Bringt ein
  // KONSTANTER Versatz die Häuser sauber auf ihre Satelliten-Textur, ist es ein
  // Registrierungs-Offset (OSM↔Esri, ggf. korrigierbar). Bleibt der Versatz nur
  // teilweise weg / kippt je nach Blickrichtung, ist es Luftbild-Parallaxe (nicht
  // korrigierbar, nur mit eigenen Gebäude-Tiles). __j.nudgeBuildings() setzt zurück.
  window.__j.nudgeBuildings = (x = 0, y = 0) =>
    map.setPaintProperty('buildings-3d', 'fill-extrusion-translate', [x, y])

  // Gebäude-Renderer wählen. Default: der MapLibre-fill-extrusion-Layer, aufgewertet
  // per Satelliten-Dachfarbe (buildings.js). Mit ?deck=1: HYBRID-Renderer — MapLibre
  // behält Boden/Terrain/Schatten, deck.gl rendert die Gebäude interleaved mit
  // gerichteter Beleuchtung und prozeduraler Fassade (Etagen/Fenster). Der MapLibre-
  // Gebäudelayer wird dann ausgeblendet, damit sich nichts überlagert. Siehe deckbuildings.js.
  // Stufe 0 des Renderer-Plans: eigenständige deck.gl-Terrain-Szene (Terrain+Satellit),
  // MapLibre unsichtbar als Kamera-/Terrain-Rechner. Spiegelt die Pose über tour.extCamera.
  if (params.get('scene') === '1') {
    import('./deckscene.js').then(({ installDeckScene }) => {
      scene = installDeckScene(map, { route, stops, shadows: params.get('shadows') === '1' })
      scene.enable()
      tour.extCamera = scene.setCamera
      tour.applyCamera() // Szene sofort auf die aktuelle Pose ziehen
      if (isNight) scene.setNight(true) // Nacht-Zustand nachziehen, falls schon aktiv
      window.__j.scene = scene
    })
  }

  // Leichter Dächer-Renderer (?roofs=1): MapLibre-Boden bleibt, der flache fill-extrusion-Layer
  // wird ausgeblendet und durch prozedurale 3D-Gebäude mit Dächern (Three.js-Custom-Layer) ersetzt.
  // Statische Geometrie → leicht, kein Lüfter. Stil (nordic/alpine) passt zur Region.
  if (params.get('roofs') === '1') {
    if (map.getLayer('buildings-3d')) map.setLayoutProperty('buildings-3d', 'visibility', 'none')
    import('./buildings3d.js').then(({ installBuildings3D }) => {
      const style = cfg.buildingStyle || (tourId === 'oberland' ? 'alpine' : 'nordic')
      window.__j.buildings3d = installBuildings3D(map, { route, style })
      window.__j.buildings3d.setVisible(buildings3dOn) // „Gebäude ausblenden"-Zustand beim Laden nachziehen
      if (isNight) window.__j.buildings3d.setNight(true) // Nacht-Zustand nachziehen, falls schon aktiv
    })
  }

  let shadows = null
  // Geerdete Wurf-Schatten in beiden Pfaden (erden auch die deck-Gebäude). ?noshadows=1
  // zum A/B-Vergleich. Nachts unten über die Tag/Nacht-Regie abgeschaltet.
  if (params.get('noshadows') !== '1' && params.get('roofs') !== '1') shadows = installBuildingShadows(map)
  window.__j.shadows = shadows

  const deckMode = params.get('deck') === '1'
  const roofsMode = params.get('roofs') === '1' // Dächer-Renderer aktiv → flache Ebene bleibt AUS
  if (deckMode) {
    // HYBRID: MapLibre-Boden behalten, Gebäude aus deck.gl (interleaved, beleuchtet, echte
    // Satellitenfarbe). MapLibre-Gebäudelayer aus, damit sich nichts überlagert.
    map.setLayoutProperty('buildings-3d', 'visibility', 'none')
    import('./deckbuildings.js').then(({ installDeckBuildings }) => {
      // Route mitgeben → Satellitenkacheln des Korridors vorab laden (kein Nachfärben zur Fahrt).
      window.__j.buildings2 = installDeckBuildings(map, { route })
      if (!buildings3dOn) window.__j.buildings2.setVisible(false) // falls vor dem Laden umgeschaltet
      if (isNight) window.__j.buildings2.setNight(true) // Nacht-Zustand nachziehen, falls schon aktiv
    })
  } else {
    window.__j.buildings = installBuildingEnhancer(map)
  }

  // Gebäude-Sichtbarkeit aus dem Modus abgeleitet (?buildings=off = „Gebäude ausblenden"). Wird
  // auch von der Tag/Nacht- und Schatten-Logik genutzt (buildings3dOn), daher als Funktion erhalten.
  let buildings3dOn = params.get('buildings') !== 'off'
  let isNight = false
  const applyShadows = () => shadows?.setVisible(buildings3dOn && !isNight)
  const setBuildings3d = (on) => {
    buildings3dOn = on
    if (deckMode) window.__j.buildings2?.setVisible(on)
    // Im Roofs-Modus die flache fill-extrusion-Ebene NICHT anfassen — sie bleibt dauerhaft aus
    // (die Three.js-Dächer ersetzen sie); sonst rendern beide doppelt und „Ausblenden" greift nicht.
    else if (!roofsMode && map.getLayer('buildings-3d')) map.setLayoutProperty('buildings-3d', 'visibility', on ? 'visible' : 'none')
    window.__j.buildings3d?.setVisible(on) // Dächer-Renderer (?roofs=1) folgt dem Umschalter mit
    applyShadows()
  }
  setBuildings3d(buildings3dOn) // Anfangszustand anwenden (v.a. „Gebäude ausblenden")

  // Ansicht-Dropdown: EINE Radio-Gruppe, alle Optionen schließen sich gegenseitig aus. Auswahl
  // lädt in den gewählten Modus (Query-Param); der aktive Modus wird aus der URL abgeleitet.
  const layersBtn = document.getElementById('btn-layers')
  const layersMenu = document.getElementById('layers-menu')
  const closeLayers = () => { layersMenu.hidden = true; layersBtn.setAttribute('aria-expanded', 'false') }
  const openLayers = () => { layersMenu.hidden = false; layersBtn.setAttribute('aria-expanded', 'true') }
  const curMode = params.get('tiles3d') === '1' ? 'google'
    : params.get('scene') === '1' ? 'scene'
    : deckMode ? 'deck'
    : params.get('buildings') === 'off' ? 'hidden'
    : 'maplibre'
  layersMenu.querySelectorAll('[data-mode]').forEach((el) => {
    const active = el.dataset.mode === curMode
    el.classList.toggle('on', active)
    el.setAttribute('aria-checked', String(active))
    el.addEventListener('click', () => {
      if (el.dataset.mode === curMode) { closeLayers(); return }
      const u = new URL(location.href)
      ;['deck', 'scene', 'g3d', 'tiles3d', 'buildings'].forEach((p) => u.searchParams.delete(p))
      const m = el.dataset.mode
      if (m === 'deck') u.searchParams.set('deck', '1')
      else if (m === 'scene') u.searchParams.set('scene', '1')
      else if (m === 'google') u.searchParams.set('tiles3d', '1')
      else if (m === 'hidden') u.searchParams.set('buildings', 'off')
      savePos(tour) // Position + Play/Pause-Zustand sichern → Reload läuft nahtlos weiter
      location.href = u.toString() // Reload in den gewählten Modus
    })
  })
  layersBtn.addEventListener('click', (e) => { e.stopPropagation(); layersMenu.hidden ? openLayers() : closeLayers() })
  document.addEventListener('click', (e) => {
    if (!layersMenu.hidden && !layersMenu.contains(e.target) && e.target !== layersBtn) closeLayers()
  })
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLayers() })

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

  // Position über Reloads hinweg merken (z.B. beim Umschalten von Query-Parametern
  // für A/B-Vergleiche): Die eine Zustandsgröße `s` reicht. Nur während der Fahrt/
  // Foto-Phase sichern; im Menü/Finale wird der Merker gelöscht, damit ein Reload
  // dort normal ins Intro startet. Wiederhergestellt wird pausiert am selben Frame.
  try {
    const saved = JSON.parse(localStorage.getItem(POS_KEY) || 'null')
    if (saved && Date.now() - saved.ts < 30 * 60 * 1000 && saved.s > 5) {
      // War die Tour beim Reload am Abspielen, läuft sie danach direkt weiter;
      // war sie pausiert, bleibt sie pausiert (z.B. A/B-Vergleich am selben Frame).
      tour.resumeAt(saved.s, saved.playing === true)
    }
  } catch {
    /* defekter Merker: ignorieren, normal ins Intro starten */
  }
  setInterval(() => savePos(tour), 600)

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
    const dayNight = createDayNight(
      map,
      (on) => {
        isNight = on
        setBuildingsNight(map, on)
        window.__j.buildings2?.setNight(on) // deck-Gebäude (Hybrid) nachts mit abdunkeln
        window.__j.buildings3d?.setNight(on) // Dächer-Renderer (?roofs=1) nachts mit abdunkeln
        tiles3d?.setNight(on) // Google-3D: Himmel/Licht dezent abtönen (Tiles sind tag-fotografiert)
        applyShadows() // nachts kein Sonnenschatten; folgt auch dem Gebäude-Umschalter
      },
      // deck-Szene + Dächer-Renderer + Google-3D der Regie folgen lassen (dimmen mit dem Boden)
      (p, sun) => { scene?.applyDayNight(p, sun); window.__j.buildings3d?.applyDayNight(p, sun); tiles3d?.applyDayNight(p, sun) },
    )
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

  // — Google Photorealistic 3D Tiles („Google 3D"-Modus) —
  // MapLibre läuft unsichtbar weiter (Tour-Engine braucht dessen Terrain-Abfragen); ein schlanker
  // Three.js-Renderer (tiles3d.js, 3DTilesRendererJS — kein Cesium) rendert die Google-Tiles und
  // spiegelt die Kamera. Der API-Schlüssel bleibt im localStorage. Aktiv über ?tiles3d=1.
  const toastEl = document.getElementById('toast')
  let toastT = null
  const toast = (msg) => {
    toastEl.textContent = msg
    toastEl.hidden = false
    clearTimeout(toastT)
    toastT = setTimeout(() => (toastEl.hidden = true), 5200)
  }

  const g3dModal = document.getElementById('g3d-modal')
  const g3dKeyInput = document.getElementById('g3d-key')
  let g3dBusy = false

  // Nur im lokalen Dev-Server: Google-Schlüssel aus der .env (VITE_GOOGLE_MAP_TILES_API_KEY).
  // Der DEV-Guard lässt den Wert beim Produktions-Build als toten Code wegfallen.
  const g3dEnvKey = import.meta.env.DEV ? import.meta.env.VITE_GOOGLE_MAP_TILES_API_KEY || '' : ''

  const enableGoogle3d = () => {
    if (g3dBusy || tiles3d) return
    const key = localStorage.getItem('g3dKey') || g3dEnvKey
    if (!key) { g3dModal.hidden = false; g3dKeyInput.focus(); return }
    g3dBusy = true
    // FreeCamera-FOV von MapLibre übernehmen, damit die Google-Ansicht denselben Bildausschnitt hat.
    import('./tiles3d.js').then(({ createTiles3D }) => {
      tiles3d = createTiles3D(route, cfg.geoid ?? 0, map.transform?.fov ?? 45, stops)
      tiles3d.enable(key)
      if (isNight) tiles3d.setNight(true)
      tour.extCamera = tiles3d.setCamera
      document.getElementById('map').style.visibility = 'hidden'
      tour.applyCamera()
      window.__j.tiles3d = tiles3d
      toast('Google Photorealistic 3D aktiv')
      g3dBusy = false
    }).catch((err) => {
      console.error('tiles3d:', err)
      toast('Google 3D ließ sich nicht laden — Schlüssel/Abrechnung prüfen. Details in der Konsole.')
      localStorage.removeItem('g3dKey')
      g3dBusy = false
    })
  }

  // „Google 3D" ist ein Modus der Ansicht-Radiogruppe (?tiles3d=1) → beim Laden aktivieren.
  // Fehlt der Schlüssel, öffnet enableGoogle3d den Key-Dialog.
  if (params.get('tiles3d') === '1') enableGoogle3d()
  document.getElementById('g3d-cancel').addEventListener('click', () => (g3dModal.hidden = true))
  document.getElementById('g3d-save').addEventListener('click', () => {
    const key = g3dKeyInput.value.trim()
    if (!key) return
    localStorage.setItem('g3dKey', key)
    g3dModal.hidden = true
    enableGoogle3d()
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
