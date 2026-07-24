import 'maplibre-gl/dist/maplibre-gl.css'
import './style.css'
import { TOURS } from './tours.js'
import { loadRemoteTour, createTimeAt } from './remote'
import { buildRoute, nearestS, pointAt } from './geo.js'
import { createMap, addRouteLayers, createRider, setRiderIcon, addSpotLayers, setBuildingsNight } from './map.js'
import { createDayNight } from './daynight.js'
import { sunPosition } from './sun.js'
import { createAtmosphere } from './atmosphere.js'
import { createWeather } from './weather.js'
import { createMusic } from './music.js'
import { createAudioTracks } from './audiotracks.js'
import { createVehicle } from './vehicle.js'
import { buildWeatherTimeline, weatherAt } from './autoweather.js'
import { installBuildingEnhancer } from './buildings.js'
import { installBuildingShadows } from './shadows.js'
import { sampleElevations, smoothValues } from './elevation.js'
import { UI } from './ui.js'
import { Tour } from './tour.js'

// — Tour-Auswahl via ?tour=… — statische Registry oder aufgezeichnete Tour vom
// Backend (?tour=srv:<id>, remote.ts). Top-Level-Await hält bewusst den Boot-
// Screen, bis die Tour-Daten da sind (Vite/Zielbrowser können TLA seit ES2022);
// scheitert das Laden, fällt der Player auf die Standard-Tour zurück.
const params = new URLSearchParams(location.search)
const tourParam = params.get('tour') ?? 'kohphangan'

// — App-Modus (?app=1): der Player läuft in der WebView der Android-App —
// Dort sind Verweise auf die Landing-Seite sinnlos (es gibt keine „Startseite",
// aus der man käme) und die Tour-Auswahl überflüssig — gewählt wird in der
// Tourliste der App bzw. im Studio. body.app blendet beides aus (style.css).
const appModus = params.get('app') === '1'
if (appModus) document.body.classList.add('app')

// — Verfügbare Viewport-Höhe als CSS-Variable —
// Die Foto-Karte bemisst sich daran (--photo-h in style.css). CSS-Einheiten
// taugen dafür nicht: `100dvh` ist in der Android-WebView der App NULL (kein
// dynamischer Viewport ohne Adressleiste) und meldet über CSS.supports trotzdem
// Unterstützung — am Gerät gemessen kollabierte der Foto-Rahmen dadurch auf 0×0.
// window.innerHeight stimmt überall; visualViewport folgt zusätzlich der
// Tastatur/Leisten-Änderung, wo es sie gibt.
// Zugleich die Ausrichtung als Klasse setzen: Die Media Features `orientation`
// und `max-height` sind in der App-WebView UNBRAUCHBAR — bei 375×843 (klar
// hochkant) meldet sie dort `orientation: landscape` UND `max-height: 500px`
// als zutreffend. Das kompakte Querformat-Layout schlug deshalb im Hochformat
// zu (Bild neben Text, Steuerung in einer engen Zeile). innerWidth/innerHeight
// stimmen dagegen — also entscheidet JS, und das CSS hängt an body.kompakt-quer.
const KOMPAKT_HOEHE = 560 // darüber ist auch quer genug Platz für das Normal-Layout
const setzeViewportHoehe = () => {
  const h = window.visualViewport?.height || window.innerHeight
  if (h > 0) document.documentElement.style.setProperty('--vh-app', `${Math.round(h)}px`)
  const quer = window.innerWidth > window.innerHeight && window.innerHeight <= KOMPAKT_HOEHE
  document.body.classList.toggle('kompakt-quer', quer)
}
setzeViewportHoehe()
window.addEventListener('resize', setzeViewportHoehe)
window.addEventListener('orientationchange', setzeViewportHoehe)
window.visualViewport?.addEventListener('resize', setzeViewportHoehe)
// Sicherheitsnetz: ein ResizeObserver meldet Größenänderungen auch dort, wo kein
// resize-Event ankommt (WebViews, eingebettete Ansichten) — sonst bliebe nach
// einer Drehung das Layout des vorherigen Formats stehen.
new ResizeObserver(setzeViewportHoehe).observe(document.documentElement)
let remoteCfg = null
let remoteFehler = null // Meldung fürs Toast, sobald die UI steht (Fallback lief)
if (tourParam.startsWith('srv:')) {
  remoteCfg = await loadRemoteTour(tourParam.slice('srv:'.length)).catch((err) => {
    remoteFehler = err?.message ?? String(err)
    console.error('Remote-Tour nicht ladbar:', remoteFehler)
    return null
  })
}
// tourId bleibt der Schlüssel für Positions-Merker und Tour-Picker — für
// Server-Touren der volle „srv:…"-Param (eigener Merker pro Aufzeichnung).
// Lookup via Object.hasOwn: ?tour=constructor o. Ä. darf nicht über die
// Prototypkette eine Funktion statt einer Tour liefern.
const tourId = remoteCfg ? tourParam : Object.hasOwn(TOURS, tourParam) ? tourParam : 'kohphangan'
const cfg = remoteCfg ?? TOURS[tourId]

// — Tour-eigene Audio-Spuren (Kreativbaukasten, cfg.audio aus remote.ts):
// Musik-Bereiche + SFX-One-Shots, f-verankert. Statische Touren haben kein
// cfg.audio → null, der restliche Code chaint optional (bitidentisches Verhalten).
const tourAudio = cfg.audio?.length ? createAudioTracks(cfg.audio) : null
// Bringt die Tour eigene Musik mit, ersetzt sie den Ambient-Loop komplett —
// sonst liefen beide Musiken übereinander (der Musik-Schalter steuert dann tourAudio).
const hatEigeneMusik = !!cfg.audio?.some((a) => a.type === 'music')

// Position (und Play/Pause-Zustand) über Reloads hinweg merken — u.a. damit ein
// Renderer-/Ansicht-Wechsel (Full-Reload) am selben Frame und im selben Wieder-
// gabezustand weiterläuft. Modulweit, weil auch der Ansicht-Umschalter davor speichert.
const POS_KEY = `luhambo:pos:${tourId}`
const savePos = (tour) => {
  if (tour.phase === 'ride' || tour.phase === 'photo' || tour.phase === 'moment') {
    localStorage.setItem(POS_KEY, JSON.stringify({ s: tour.s, ts: Date.now(), playing: tour.playing }))
  } else {
    localStorage.removeItem(POS_KEY)
  }
}

// ?reverse=1: Tour rückwärts abspielen (nur Wegpunkt-/Segment-Reihenfolge umgedreht,
// nichts am Kamera-/Sonnen-Code). Grund: Die Pseudo-Zeit koppelt Sonnenuntergang an den
// Streckenfortschritt — je nach Route zeigt die Fahrtrichtung dann zur oder von der Sonne
// weg. Für Stockholm liegt die untergehende Sonne rückwärts die GANZE Golden Hour voraus
// (vorwärts nur an einer einzigen Stelle). Fotos werden per nearestS neu verankert.
const reverse = params.get('reverse') === '1'
const segsSrc = reverse
  ? cfg.segments.slice().reverse().map((seg) => ({ ...seg, pts: seg.pts.slice().reverse() }))
  : cfg.segments

// Segmente zu einer Wegpunktliste verbinden (Nahtpunkte dedupen)
const waypoints = []
for (const seg of segsSrc) {
  waypoints.push(...(waypoints.length ? seg.pts.slice(1) : seg.pts))
}
const route = buildRoute(waypoints)

// Modus-Grenzen. Vorwärts: sauber via nearestS je Segment-Startpunkt. Rückwärts:
// die VORWÄRTS-Grenzen an der Streckenmitte spiegeln — nearestS auf reversierte
// Segment-Nähte ist mehrdeutig (Inseln wie Fjäderholmarna liegen nah an der
// Stadtstrecke → die Fähre würde über die halbe Route „auslaufen").
let modes
if (reverse) {
  const fwdWp = []
  for (const seg of cfg.segments) fwdWp.push(...(fwdWp.length ? seg.pts.slice(1) : seg.pts))
  const fwdRoute = buildRoute(fwdWp)
  const T = fwdRoute.total
  const fwd = cfg.segments.map((seg) => ({ s: nearestS(fwdRoute, seg.pts[0]), mode: seg.mode, label: seg.label ?? seg.mode }))
  fwd[0].s = 0
  const bounds = fwd.map((m) => m.s).concat([T]) // [0, s1, …, T] — Segment-Intervalle
  const scale = route.total / T // reversierte Route ist minimal anders lang
  modes = fwd
    .map((m, i) => ({ s: (T - bounds[i + 1]) * scale, mode: m.mode, label: m.label }))
    .sort((a, b) => a.s - b.s)
} else {
  modes = cfg.segments.map((seg) => ({ s: nearestS(route, seg.pts[0]), mode: seg.mode, label: seg.label ?? seg.mode }))
}
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
// Kamera-Momente (Kreativbaukasten): Punkt-Ereignisse, f → Streckenmeter s.
// Die Engine hält dort an und führt eine Kamerabewegung aus (src/tour.js).
const moments = (cfg.moments ?? [])
  .map((m) => ({ s: m.f * route.total, art: m.art, dauerS: m.dauerS }))
  .sort((a, b) => a.s - b.s)
const start = pointAt(route, 0)

// — Texte aus der Tour-Konfiguration —
const setText = (id, text) => (document.getElementById(id).textContent = text)
document.title = 'Luhambo — deine Reisen als kinematische 3D-Erlebnisse'
setText('brand-kicker', `Luhambo · ${cfg.no}`)
setText('brand-title', cfg.brandTitle)
setText('brand-route', cfg.stops.join(' — '))
setText('intro-kicker', cfg.kicker)
document.getElementById('intro-title').innerHTML = cfg.titleHtml
setText('intro-route', cfg.stops.join('  →  '))
setText('finale-title', cfg.finaleTitle)
setText('chip-photos', `${photos.length} Fotos`)
setText('final-photos', String(photos.length))

// Im App-Modus zeigt der Kicker sonst auf die Landing — dort führt er ins Leere.
// Der Titel muss mit weg, sonst kündigen Tooltip und Screenreader weiterhin eine
// „Startseite" an, die es in der App nicht gibt.
if (appModus) {
  const kicker = document.getElementById('brand-kicker')
  kicker.removeAttribute('href')
  kicker.removeAttribute('title')
}

// — Der Weg zurück führt DORTHIN, WO MAN HERKAM —
// Wer aus dem Studio, der Galerie oder einem Profil kommt, will dorthin zurück
// und nicht auf die Landing. Die Herkunft steht im Referrer; `history.back()`
// statt einer Navigation, damit Scrollposition und Zustand der Liste erhalten
// bleiben. Ohne Referrer (direkt geöffneter Link) bleibt es bei der Startseite.
const HERKUNFT = { '/studio.html': 'Studio', '/galerie.html': 'Galerie', '/profil.html': 'Profil' }
if (!appModus) {
  let her = null
  try {
    const r = new URL(document.referrer)
    // Nur echte Zwischenseiten übernehmen; die Landing „/" ist selbst die
    // Startseite und bleibt beim Default-Knopf.
    if (r.origin === location.origin && r.pathname !== location.pathname && r.pathname !== '/') her = r
  } catch {}
  if (her) {
    const wort = HERKUNFT[her.pathname] ?? 'Zurück'
    const zurueck = document.querySelector('.intro-back')
    if (zurueck) {
      zurueck.href = her.href
      zurueck.setAttribute('aria-label', `Zurück zu: ${wort}`)
      zurueck.querySelector('.ib-word').textContent = wort
      zurueck.addEventListener('click', (e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || history.length < 2) return
        e.preventDefault()
        history.back()
      })
    }
  }
}

const map = createMap('map', [start[0], start[1]])
window.__j = { map, route, tourAudio }

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
  let kamFolger = null // Kamera-Keyframe-Folger (nur bei cfg.camera, s. unten)
  ui.updateTrace = (s, pos) => {
    syncTrace(s, pos)
    rider.setLngLat([pos[0], pos[1]])
    scene?.setProgress(s, pos) // reine deck-Szene: Trace bis exakt zum Fahrer nachziehen
    tiles3d?.setProgress(s, pos) // Google-3D-Modus: Trace + Fahrer-Marker (no-op solange aus)
    // Tour-Audio folgt dem Streckenanteil pro Frame: Musik-Bereiche + SFX-Kanten.
    // istPlayback nur bei echter Wiedergabe — Scrub-/Seek-Sprünge feuern keine SFX.
    tourAudio?.setFrac(s / route.total, tour.playing && !tour.scrubbing)
    kamFolger?.(s / route.total)
  }
  // Fahrzeug-Motorloop (dezent): folgt dem aktiven Segment-Modus, läuft nur während
  // der eigentlichen Fahrt (Gate unten). Moduswechsel blendet den Motor weich über.
  const vehicle = createVehicle('/audio')
  vehicle.setMode(modes[0].mode)
  window.__j.vehicle = vehicle
  ui.onModeChange = (mode) => { setRiderIcon(rider, mode); vehicle.setMode(mode) }
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

  const tour = new Tour(map, route, stops, ui, { modes, moments })
  Object.assign(window.__j, { tour, rider })

  // — Kamera-Folger (Kreativbaukasten, cfg.camera): vom Autor gesetzte Preset-
  // Keyframes über den Streckenanteil f. Es gilt der letzte Keyframe mit f <= frac
  // (Punktfunktion wie die Modi); vor dem ersten Keyframe bleibt der Player-Default.
  // Feuert NUR bei Preset-Änderung — setPreset klemmt glide, nie pro Frame rufen.
  // Ein manueller Klick auf einen Preset-Button schaltet den Folger dauerhaft aus
  // (bis Reload): der Nutzer hat das letzte Wort über die Kameradistanz.
  let kamManuell = false
  if (cfg.camera?.length) {
    const keyframes = cfg.camera.slice().sort((a, b) => a.f - b.f)
    // Vor dem ersten Keyframe gilt der Player-Default — der ist beim Boot der
    // aktive Button (statisch „mittel"). Auch nach Rückwärts-Scrub/Restart.
    const defaultPreset = document.querySelector('.preset-btn.active')?.dataset.preset ?? 'mittel'
    let kamAktiv = null // zuletzt angewendete Preset+Skala-Kennung (gegen Dauer-Reapply)
    kamFolger = (frac) => {
      if (kamManuell) return
      // Lineare Suche reicht (≤100 Einträge) und übersteht Rückwärts/Sprünge
      let k = null
      for (const kf of keyframes) if (kf.f <= frac) k = kf
      const preset = k ? k.preset : kamAktiv === null ? null : defaultPreset
      const skala = k ? (k.skala ?? 1) : 1
      // Kennung aus Preset+Skala: eine reine Feinjustierung (gleiches Preset,
      // andere Skala) muss ebenfalls neu angewendet werden.
      const kennung = preset === null ? null : `${preset}:${skala}`
      if (kennung === null || kennung === kamAktiv) return
      kamAktiv = kennung
      tour.setPreset(preset, skala)
      // Button-Zustand nachziehen (gleiches Muster wie der Klick-Handler unten)
      document.querySelector('.preset-btn.active')?.classList.remove('active')
      document.querySelector(`.preset-btn[data-preset="${preset}"]`)?.classList.add('active')
    }
  }

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

  // Gebäude-Sichtbarkeit aus dem Modus abgeleitet. Standard ist AUS („Gebäude ausblenden")
  // — nur ein expliziter Modus-Wunsch (?buildings=on oder ein anderer 3D-Renderer) schaltet sie
  // ein; ?buildings=off erzwingt aus, auch innerhalb eines sonst gebäudefähigen Renderers. Wird
  // auch von der Tag/Nacht- und Schatten-Logik genutzt (buildings3dOn), daher als Funktion erhalten.
  let buildings3dOn =
    params.get('buildings') !== 'off' &&
    (params.get('buildings') === 'on' || deckMode || roofsMode || params.get('scene') === '1' || params.get('tiles3d') === '1')
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
  const openLayers = () => { closeWeather(); layersMenu.hidden = false; layersBtn.setAttribute('aria-expanded', 'true') }
  const curMode = params.get('tiles3d') === '1' ? 'google'
    : params.get('scene') === '1' ? 'scene'
    : deckMode ? 'deck'
    : params.get('buildings') === 'on' ? 'maplibre'
    : 'hidden'
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
      else if (m === 'maplibre') u.searchParams.set('buildings', 'on')
      else if (m === 'hidden') u.searchParams.set('buildings', 'off')
      savePos(tour) // Position + Play/Pause-Zustand sichern → Reload läuft nahtlos weiter
      location.href = u.toString() // Reload in den gewählten Modus
    })
  })
  layersBtn.addEventListener('click', (e) => { e.stopPropagation(); layersMenu.hidden ? openLayers() : closeLayers() })
  document.addEventListener('click', (e) => {
    if (!layersMenu.hidden && !layersMenu.contains(e.target) && e.target !== layersBtn) closeLayers()
  })
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeLayers(); closeWeather(); document.getElementById('options-modal').hidden = true } })

  // — Wetter-Dropdown (Regen/Gewitter) — live umschaltbar, unabhängig vom Renderer UND
  // von Tag/Nacht. Das Overlay läuft in eigener Schleife, friert aber über das Gate
  // ein, sobald die Szene pausiert (stehende Kamera = stehender Regen). Kein Reload
  // wie bei der Ansicht-Radiogruppe: setMode wirkt sofort. Wahl + Stärke werden gemerkt.
  const weather = createWeather(document.body)
  // Animiert die Szene? Fahrt läuft, Nutzer scrubbt, oder eine Orbit-Phase dreht
  // (Intro/Finale drehen unabhängig von playing) — nur dann läuft auch das Wetter.
  const sceneAnimating = () => tour.playing || tour.scrubbing || tour.phase === 'intro' || tour.phase === 'finale'
  weather.setGate(sceneAnimating)
  window.__j.weather = weather

  // Motorloop nur während der eigentlichen Fahrt: nicht im Foto-Stopp, Intro/Finale,
  // beim Scrubben oder in Pause (dort geht der Motor weich aus wie an einer Ampel).
  vehicle.setGate(() => tour.playing && !tour.scrubbing && tour.phase === 'ride')
  const WEATHER_KEY = 'luhambo:weather'
  const WEATHER_INT_KEY = 'luhambo:weather-int'
  // Wetter-Stärke: drei UI-Stufen auf einer stufenlosen Skala (die API nimmt jedes
  // 0..1 — ein späteres Echtwetter kann feiner dosieren). Default Mittel.
  const WEATHER_INT = { leicht: 0.4, mittel: 0.7, stark: 1 }
  let weatherInt = 'mittel'
  // Himmel je Wetter-Modus: Wolkendeckung als SPANNE [c0..c1] über die Stärke —
  // die Atmosphäre formt daraus die Wolken selbst (locker → aufgerissen →
  // geschlossen). „Wolkig" spannt den ganzen Bogen: Leicht = einzelne Wolken
  // (Sonne frei), Mittel = aufgerissener Himmel, Stark = geschlossene Decke ohne
  // sichtbare Sonne. Niederschlags-Modi starten dagegen schon bedeckt (auch
  // leichter Regen fällt nicht aus heiterem Himmel). Die Atmosphäre existiert erst
  // nach dem Tag/Nacht-Block (cfg.time) → später via atmoWeather-Hook gekoppelt.
  const WEATHER_SKY = {
    off: { c0: 0, c1: 0, dark: 0, fog: 0 },
    clouds: { c0: 0.28, c1: 0.98, dark: 0.34, fog: 0 },
    fog: { c0: 0.22, c1: 0.45, dark: 0.2, fog: 1 },
    rain: { c0: 0.72, c1: 1, dark: 0.55, fog: 0.16 },
    snow: { c0: 0.62, c1: 0.96, dark: 0.3, fog: 0.4 },
    storm: { c0: 0.88, c1: 1, dark: 0.8, fog: 0.12 },
  }
  const skyFor = (m, k) => {
    const b = WEATHER_SKY[m] ?? WEATHER_SKY.off
    // k läuft im UI 0.4..1 (Leicht..Stark); darunter (künftiges Echtwetter,
    // stufenlos) bleibt die Deckung am unteren Ende der Spanne
    const t = Math.max(0, Math.min(1, (k - 0.4) / 0.6))
    return { cover: b.c0 + (b.c1 - b.c0) * t, dark: b.dark * (0.4 + 0.6 * k), fog: b.fog * (0.35 + 0.65 * k) }
  }
  let atmoWeather = null // () => atmo.setWeather(skyFor(...)), gesetzt sobald atmo existiert
  let groundSnow = null // () => dayNight.setSnow(...), gesetzt sobald die Tag/Nacht-Regie existiert
  const weatherBtn = document.getElementById('btn-weather')
  const weatherMenu = document.getElementById('weather-menu')
  const closeWeather = () => { weatherMenu.hidden = true; weatherBtn.setAttribute('aria-expanded', 'false') }
  const openWeather = () => { closeLayers(); weatherMenu.hidden = false; weatherBtn.setAttribute('aria-expanded', 'true') }
  const syncWeatherUI = (m) => {
    weatherBtn.classList.toggle('active', m !== 'off') // aktiver Zustand am Button ablesbar
    weatherMenu.querySelectorAll('[data-weather]').forEach((el) => {
      const on = el.dataset.weather === m
      el.classList.toggle('on', on)
      el.setAttribute('aria-checked', String(on))
    })
    weatherMenu.querySelectorAll('[data-wlevel]').forEach((el) => {
      const on = el.dataset.wlevel === weatherInt
      el.classList.toggle('on', on)
      el.setAttribute('aria-checked', String(on))
    })
  }
  // — Auto-Wetter: echtes historisches Wetter (Open-Meteo + EXIF, autoweather.js) —
  // Default-Modus; jede manuelle Wahl im Menü überschreibt ihn (und wird gemerkt).
  // Die Timeline lädt asynchron; bis dahin (und bei Fetch-Fehlern) bleibt es bei
  // „Kein Wetter". k ist im Auto-Modus stufenlos (dafür ist setIntensity gebaut).
  let weatherK = WEATHER_INT[weatherInt] // wirksame Stärke (UI-Stufe bzw. Auto-Wert)
  let weatherAuto = false
  let wxTimeline = null // [{s, mode, k}] sobald geladen
  let wxSegment = null // zuletzt angewandter Timeline-Eintrag (gegen Dauer-Reapply)

  const applyWx = (m, k) => {
    weatherK = k
    weather.setIntensity(k)
    weather.setMode(m)
    atmoWeather?.()
    groundSnow?.()
  }
  const applyAutoNow = () => {
    const e = weatherAt(wxTimeline, tour.s)
    if (!e) { applyWx('off', WEATHER_INT[weatherInt]); return }
    if (wxSegment === e) return
    wxSegment = e
    applyWx(e.mode, e.k)
  }
  const applyWeather = (m, persist = true) => {
    weatherAuto = m === 'auto'
    if (weatherAuto) {
      wxSegment = null
      applyAutoNow()
    } else {
      applyWx(m, WEATHER_INT[weatherInt])
    }
    syncWeatherUI(weatherAuto ? 'auto' : weather.mode)
    if (persist) {
      try {
        localStorage.setItem(WEATHER_KEY, weatherAuto ? 'auto' : weather.mode)
        localStorage.setItem(WEATHER_INT_KEY, weatherInt)
      } catch { /* Storage evtl. gesperrt */ }
    }
  }
  // Beim Fahren die Abschnittsmitten überwachen (die Übergänge blenden weich in
  // weather.js/atmosphere.js) — 0,8 s reichen, Wetter ändert sich gemächlich.
  // Zugleich den Wetter-Ton beim Finale („Ziel erreicht") ausblenden (nur der
  // Sound; die Regen-Partikel laufen im Orbit weiter) — kommt beim Neustart zurück.
  setInterval(() => {
    if (weatherAuto && wxTimeline) applyAutoNow()
    // Wetter-SFX folgt dem Audio-Master (Optionen) UND blendet beim Finale aus
    weather.setSoundEnabled(audioOn && tour.phase !== 'finale')
  }, 800)
  weatherMenu.querySelectorAll('[data-weather]').forEach((el) => {
    el.addEventListener('click', () => { applyWeather(el.dataset.weather); closeWeather() })
  })
  // Stärke-Umschalter (Leicht/Mittel/Stark): wirkt live auf den laufenden Modus,
  // Menü bleibt offen (man will die Wirkung direkt vergleichen)
  weatherMenu.querySelectorAll('[data-wlevel]').forEach((el) => {
    el.addEventListener('click', () => {
      weatherInt = WEATHER_INT[el.dataset.wlevel] ? el.dataset.wlevel : 'mittel'
      // Im Auto-Modus bleibt Auto aktiv (die Stärke kommt dort aus den Wetterdaten,
      // die Stufe greift erst wieder bei manueller Wahl)
      applyWeather(weatherAuto ? 'auto' : weather.mode)
    })
  })
  weatherBtn.addEventListener('click', (e) => { e.stopPropagation(); weatherMenu.hidden ? openWeather() : closeWeather() })
  document.addEventListener('click', (e) => {
    if (!weatherMenu.hidden && !weatherMenu.contains(e.target) && e.target !== weatherBtn) closeWeather()
  })
  // Gemerkte Wetter-Wahl + Stärke wiederherstellen. OHNE gemerkte Wahl ist
  // AUTO der Default (echtes Wetter der Reise); „off" bleibt eine bewusste Wahl.
  try {
    const savedI = localStorage.getItem(WEATHER_INT_KEY)
    if (savedI && WEATHER_INT[savedI]) weatherInt = savedI
    const savedW = localStorage.getItem(WEATHER_KEY)
    if (savedW == null || savedW === 'auto') applyWeather('auto', false)
    else if (WEATHER_SKY[savedW] && savedW !== 'off') applyWeather(savedW, false)
    else syncWeatherUI('off')
  } catch { syncWeatherUI('off') }

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
  // Vom „Ziel erreicht“-Screen zurück ins Hauptmenü (wie der Dock-Menü-Knopf)
  document.getElementById('btn-finale-menu').addEventListener('click', () => {
    setClean(false)
    tour.toMenu()
  })

  // — Hintergrundmusik (unaufdringlich, nahtlos geloopt) — läuft während der
  // Track-Animation (Fahrt/Foto), pausiert im Menü; per Dock-Knopf abschaltbar.
  // Beim Finale („Ziel erreicht") aus dem Gate → die Musik blendet über die
  // eingebaute ~2,5-s-Blende aus (kommt beim „Noch einmal erleben" wieder).
  // Bringt die Tour EIGENE Musik mit (cfg.audio), entfällt der Ambient-Loop —
  // der Musik-Schalter in den Optionen steuert dann die Tour-Musik (tourAudio).
  const music = hatEigeneMusik ? null : createMusic('/audio/ambient.mp3')
  music?.setGate(() => tour.phase !== 'intro' && tour.phase !== 'finale')
  window.__j.music = music

  // Tour-Audio-Gate: Musik läuft während Fahrt/Foto/Scrub und friert bei Pause
  // ein (Level-Rampe) — bewusst anders als music.js, denn die eigene Musik gehört
  // zur SZENE, nicht zur App. Menü (intro) und Finale blenden aus.
  tourAudio?.setGate(
    () => tour.phase !== 'intro' && tour.phase !== 'finale' && (tour.playing || tour.scrubbing || tour.phase === 'photo'),
  )

  // — Optionen (Endnutzer): Ton (Master) · Musik · Wetter-Effekte —
  // Switches im Optionen-Dialog, Zustände in localStorage. „Ton" ist der Master über
  // ALLE Klänge (Motor, Musik, Wetter-SFX); „Musik" schaltet nur den Ambient-Loop;
  // „Wetter-Effekte" schaltet global zwischen Auto-Wetter (echt) und Aus.
  const MUSIC_KEY = 'luhambo:music'
  const AUDIO_KEY = 'luhambo:audio'
  let musicOn = true
  let audioOn = true
  try { musicOn = localStorage.getItem(MUSIC_KEY) !== 'off' } catch { /* Storage evtl. gesperrt */ }
  try { audioOn = localStorage.getItem(AUDIO_KEY) !== 'off' } catch { /* Storage evtl. gesperrt */ }
  // Master wirkt auf Motor + Musik sofort; der Wetter-Ton hängt zusätzlich am 800-ms-Tick.
  // Tour-Audio: der Musik-Schalter steuert die Musik-Spuren, SFX hängen nur am Master.
  const applyAudio = () => {
    vehicle.setEnabled(audioOn)
    music?.setEnabled(audioOn && musicOn)
    tourAudio?.setMusikEnabled(audioOn && musicOn)
    tourAudio?.setSfxEnabled(audioOn)
  }
  applyAudio()

  const optAudio = document.getElementById('opt-audio')
  const optMusic = document.getElementById('opt-music')
  const optWeather = document.getElementById('opt-weather')
  const setSwitch = (el, on) => el.setAttribute('aria-checked', String(on))
  setSwitch(optAudio, audioOn)
  setSwitch(optMusic, musicOn)
  optAudio.addEventListener('click', () => {
    audioOn = !audioOn
    setSwitch(optAudio, audioOn)
    applyAudio()
    try { localStorage.setItem(AUDIO_KEY, audioOn ? 'on' : 'off') } catch { /* Storage evtl. gesperrt */ }
  })
  optMusic.addEventListener('click', () => {
    musicOn = !musicOn
    setSwitch(optMusic, musicOn)
    applyAudio()
    try { localStorage.setItem(MUSIC_KEY, musicOn ? 'on' : 'off') } catch { /* Storage evtl. gesperrt */ }
  })
  // Wetter-Effekte: an = Auto-Wetter (echt), aus = kein Wetter. Steuert dieselbe
  // Wetter-Logik wie das Dev-Menü (das Dev-Menü kann darüber hinaus feiner dosieren).
  const syncWeatherSwitch = () => setSwitch(optWeather, weather.mode !== 'off')
  syncWeatherSwitch()
  optWeather.addEventListener('click', () => {
    applyWeather(weather.mode === 'off' ? 'auto' : 'off')
    syncWeatherSwitch()
  })

  // Optionen-Dialog öffnen/schließen (Wetter-Switch beim Öffnen aktualisieren, falls
  // im Dev-Menü verstellt). Klick auf den abgedunkelten Hintergrund schließt.
  const optModal = document.getElementById('options-modal')
  const openOptions = () => { syncWeatherSwitch(); optModal.hidden = false }
  const closeOptions = () => { optModal.hidden = true }
  document.getElementById('btn-options').addEventListener('click', openOptions)
  document.getElementById('opt-close').addEventListener('click', closeOptions)
  optModal.addEventListener('click', (e) => { if (e.target === optModal) closeOptions() })

  // — Entwicklermodus — blendet Dev-Regler (Render-Art, Wetter-Palette, Kamera-
  // distanz) ein. Aktivierung: ?dev=1 ODER Tippfolge „dev". Merker in localStorage,
  // damit ein Reload (z.B. Renderer-Wechsel) den Modus behält.
  const DEV_KEY = 'luhambo:dev'
  let devOn = params.get('dev') === '1'
  try { devOn = devOn || localStorage.getItem(DEV_KEY) === '1' } catch { /* Storage evtl. gesperrt */ }
  const setDev = (on) => {
    devOn = on
    document.body.classList.toggle('dev', on)
    try { localStorage.setItem(DEV_KEY, on ? '1' : '0') } catch { /* Storage evtl. gesperrt */ }
  }
  setDev(devOn)
  let devSeq = ''
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
    devSeq = (devSeq + e.key).slice(-3).toLowerCase()
    if (devSeq === 'dev') { setDev(!devOn); toast(devOn ? 'Entwicklermodus an' : 'Entwicklermodus aus') }
  })

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
      kamManuell = true // manueller Eingriff: Kamera-Folger dauerhaft aus (bis Reload)
      document.querySelector('.preset-btn.active')?.classList.remove('active')
      btn.classList.add('active')
      tour.setPreset(btn.dataset.preset)
    })
  }

  // Tag/Nacht: Streckenanteil ↦ Pseudo-Uhrzeit ↦ Sonnenstand ↦ Szenenstimmung.
  // Aufgezeichnete Touren (M2) bringen timeline-Stützstellen mit — die Pseudo-
  // Uhr folgt dann dem echten Tempo (Pausen serverseitig komprimiert) statt
  // linear über die Strecke zu laufen; statische Touren bleiben linear.
  if (cfg.time) {
    const t0 = Date.parse(cfg.time.start)
    const t1 = Date.parse(cfg.time.end)
    const timeAt = createTimeAt(cfg.timeline, t0, t1)
    const fmt = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: cfg.time.zone })
    const teleTime = document.getElementById('tele-time')
    document.getElementById('tele-time-wrap').hidden = false

    // Atmosphäre-Overlay (Horizont-Dunst, Sterne, Sonne + Lens-Flare): folgt der
    // Tour-Kamera pro Frame (tour.onPose), unabhängig vom aktiven Renderer.
    const atmo = createAtmosphere(document.body)
    atmo.setFov(map.transform?.fov ?? 36.87)
    // Echte (geclampte) Render-Kamera fürs Overlay — die Tour-Pose kennt MapLibres
    // maxPitch-Clamp nicht; ohne das säße die Sonne unter der gerenderten Horizontkante.
    atmo.setCamera(() => ({ pitch: map.getPitch(), bearing: map.getBearing() }))
    // DEM-Sonde: verdeckt nahes Gelände die Horizontlinie (Talkessel/Bergwand),
    // blendet die Atmosphäre ihre horizont-verankerten Ebenen (Dunst-Band, Glut) aus
    atmo.setTerrain((lng, lat) => map.queryTerrainElevation([lng, lat]))
    // Sonnenstand PRO FRAME exakt aus der Pseudo-Zeit (die Astronomie ist billig):
    // kein Drossel-Lag, keine Glättung im Overlay — Scrubben/Springen landet damit
    // IMMER auf exakt demselben Sonnenstand (Himmelsrichtung/Geografie/Jahreszeit echt
    // via sunPosition). Die Tag/Nacht-Regie drosselt nur noch die teuren Map-Paints.
    tour.onPose = (pose) => {
      const frac = Math.max(0, Math.min(1, tour.s / route.total))
      const date = new Date(timeAt(frac))
      const pos = pointAt(route, frac * route.total)
      const sun = sunPosition(date, pos[1], pos[0])
      atmo.setSun(sun)
      tour.setSun(sun) // Kamera-Himmel-Momente (skyLift/Yaw) folgen ohne Drossel-Lag
      atmo.render(pose)
    }
    window.__j.atmo = atmo
    // Wetter-Himmel jetzt an die Atmosphäre koppeln + den ggf. wiederhergestellten
    // Modus nachziehen (der Restore lief, bevor die Atmosphäre existierte).
    // Gleiches Pause-Gate wie das Partikel-Overlay: Wolken-Drift steht in der Pause.
    atmoWeather = () => atmo.setWeather(skyFor(weather.mode, weatherK))
    atmoWeather()
    atmo.setGate(sceneAnimating)

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
      // deck-Szene + Dächer-Renderer + Google-3D + Atmosphäre der Regie folgen lassen.
      // (atmo.setSun/tour.setSun laufen NICHT mehr hier — die Drossel machte den
      // Sonnenstand beim Scrubben pfadabhängig; beide werden pro Frame in onPose gesetzt.)
      (p, sun) => {
        scene?.applyDayNight(p, sun)
        window.__j.buildings3d?.applyDayNight(p, sun)
        tiles3d?.applyDayNight(p, sun)
        atmo.setSky(p.hor, p.sky, p.fog) // Dunst an Horizont/Himmel/Fog der Tageszeit koppeln
      },
    )
    // Schneedecke aufs Satellitenbild koppeln (Stärke → Deckungsgrad); den ggf.
    // wiederhergestellten Schnee-Modus nachziehen (Restore lief vor der Regie)
    groundSnow = () => dayNight.setSnow(
      weather.mode === 'snow' ? 0.3 + 0.7 * Math.max(0, (weatherK - 0.4) / 0.6) : 0,
    )
    groundSnow()
    // Auto-Wetter-Timeline laden (asynchron; braucht die Pseudo-Zeit dieser Tour).
    // Bei Fetch-Fehlern (offline, API weg) bleibt Auto still bei „Kein Wetter".
    // Kuratierte Wetter-Timeline der Tour (cfg.weather, km entlang der Route) hat
    // Vorrang vor dem Auto-Wetter — nötig, weil das ERA5-Archiv für manche Orte nie
    // ein Gewitter codiert (z.B. Koh Pha-ngan). Sonst echtes historisches Wetter.
    const wxSource = cfg.weather
      ? Promise.resolve(cfg.weather.map((w) => ({ s: w.km * 1000, mode: w.mode, k: w.k })).sort((a, b) => a.s - b.s))
      : buildWeatherTimeline({ photos, route, time: cfg.time, pointAt })
    wxSource
      .then((tl) => {
        wxTimeline = tl
        window.__j.wxTimeline = tl
        if (weatherAuto) { wxSegment = null; applyAutoNow() }
      })
      .catch((err) => console.info('Auto-Wetter nicht verfügbar:', err?.message ?? err))
    ui.onTick = (frac) => {
      const date = new Date(timeAt(frac))
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
  // Video-Stopp durchgelaufen: weiter wie nach einem abgelaufenen Foto-HOLD (M4)
  ui.onMediaEnded = () => tour.onMediaEnded()

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

  // — Auto-Rückzug der Bedienelemente auf Touch —
  // Auf Handy-Schirmen (quer erst recht) ist Fläche die knappste Ressource:
  // während der FAHRT zieht sich die UI nach kurzer Ruhe zurück und ist bei der
  // nächsten Berührung sofort wieder da. Nur mit Touch — bei Maus/Trackpad wäre
  // verschwindende UI irritierend, und dort fehlt der Platz auch nicht.
  if (window.matchMedia('(pointer: coarse)').matches) {
    let ruheTimer = 0
    const planeRueckzug = () => {
      clearTimeout(ruheTimer)
      ruheTimer = setTimeout(() => {
        // Bei Pause, Foto-Stopp, Intro und Finale gehören die Bedienelemente auf
        // den Schirm — dann später erneut prüfen statt den Rückzug zu vergessen
        // (die Fahrt läuft nach einem Foto-Stopp ohne Zutun weiter).
        if (tour.phase === 'ride' && tour.playing) setClean(true)
        else planeRueckzug()
      }, 4000)
    }
    const weckeUi = () => {
      if (document.body.classList.contains('ui-clean')) setClean(false)
      planeRueckzug()
    }
    document.addEventListener('pointerdown', weckeUi, { passive: true })
    document.addEventListener('keydown', weckeUi, { passive: true })
    planeRueckzug()
  }

  // Zurück ins Hauptmenü — ein evtl. aktiver Kino-Modus endet dabei mit
  document.getElementById('btn-menu').addEventListener('click', () => {
    setClean(false)
    tour.toMenu()
  })

  // Player verlassen (nur im App-Modus sichtbar): die Android-App stellt dafür
  // eine Brücke bereit (PlayerScreen.kt, @JavascriptInterface). Fehlt sie — etwa
  // weil jemand ?app=1 im normalen Browser aufruft —, bleibt der History-Rückweg.
  document.getElementById('btn-app-zurueck').addEventListener('click', () => {
    if (window.LuhamboApp?.verlassen) window.LuhamboApp.verlassen()
    else history.back()
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

  // Konnte eine ?tour=srv:… nicht geladen werden (gelöscht, noch in
  // Verarbeitung, Server weg), läuft die Standard-Tour — das dem Nutzer
  // sichtbar sagen, nicht nur der Konsole.
  if (remoteFehler) toast(remoteFehler)

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

  // — Bildraten-Protokoll (?app=1 oder ?fps=1) —
  // In der App-WebView gibt es kein DevTools-Fenster; der WebChromeClient leitet
  // console-Ausgaben aber ins Logcat (Tag „LuhamboPlayer"). So lässt sich die
  // Flüssigkeit auf dem echten Gerät messen statt zu raten:
  //   adb logcat -s LuhamboPlayer | grep fps
  if (appModus || params.get('fps') === '1') {
    let bilder = 0
    let fenster = performance.now()
    const zaehle = () => {
      bilder++
      const jetzt = performance.now()
      if (jetzt - fenster >= 3000) {
        const fps = (bilder * 1000) / (jetzt - fenster)
        console.info(
          `[luhambo] fps ${fps.toFixed(1)} · ${innerWidth}×${innerHeight} @${devicePixelRatio} · Phase ${tour.phase}`,
        )
        bilder = 0
        fenster = jetzt
      }
      requestAnimationFrame(zaehle)
    }
    requestAnimationFrame(zaehle)
  }

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
