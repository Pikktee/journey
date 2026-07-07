// Kamera-Engine auf Basis der FreeCamera-API: Die Kamera hat eine explizite Position
// über dem Gelände (Bodenpunkt + Flughöhe) und einen Blickpunkt. Beide werden pro
// Skalar exponentiell geglättet — Phasenwechsel (Intro → Fahrt, Foto-Orbit, Finale)
// werden dadurch automatisch zu weichen Kamerafahrten. Eine explizite Flughöhe ist
// nötig, weil zoom-basierte Kameras (jumpTo) in steilem Gelände im Hang stecken bleiben.
import maplibregl from 'maplibre-gl'
import { pointAt, bearingAt, dist, bearing, angleDelta, destination } from './geo.js'
import { EXAGGERATION } from './map.js'

// Bewusst weit gespreizt: Nah klebt dicht hinterm Fahrer, Weit ist Panorama —
// die Stufen sollen sich wie drei verschiedene Einstellungsgrößen anfühlen
export const PRESETS = {
  nah: { behind: 280, hover: 160 },
  mittel: { behind: 720, hover: 410 },
  weit: { behind: 1900, hover: 1300 },
}

const HOLD_HIDE = 5.2 // s sichtbare Foto-Karte, danach ausblenden bzw. nächstes Foto
const HOLD_END = 6.0 // s: weiterfahren (Ausblend-Animation ist durch)

// „Himmel-Momente": Zur Golden Hour und nachts kippt die Kamera nach oben, damit
// Horizont + Sonne/Sterne ins Bild kommen und der Fahrer ins untere Drittel rutscht.
// Statt den Blickpunkt um eine feste Fraktion zu heben (zu indirekt — bei hoher
// Kamera bleibt der Horizont trotzdem am oberen Rand), steuern wir den ZIEL-Blick-
// winkel direkt: der Blick-nach-unten-Winkel wird von seinem natürlichen Wert
// Richtung SKY_MIN_DOWN abgeflacht. Das kippt die Kamera geometrieunabhängig bis
// knapp über den Horizont. Tagsüber ist skyLift 0 ⇒ exakt der bisherige Blick.
const SKY_MIN_DOWN = 3 * (Math.PI / 180) // flachster Blick-nach-unten (Pitch ~87°, von maxPitch gedeckelt)
const SKY_LIFT_TAU = 3.5 // Einschwingzeit der Anhebung (weich, kein Ruck)
const _cl = (x) => (x < 0 ? 0 : x > 1 ? 1 : x)
const _ss = (a, b, x) => { const t = _cl((x - a) / (b - a)); return t * t * (3 - 2 * t) }

class Smooth {
  constructor(v) {
    this.v = v
  }
  to(target, dt, tau) {
    this.v += (target - this.v) * (1 - Math.exp(-dt / tau))
  }
  set(v) {
    this.v = v
  }
}

// Tempo- und Kameradistanz-Faktoren je Fortbewegungsmodus: schnelle Modi
// fahren deutlich schneller UND die Kamera zoomt weiter heraus — die
// Spreizung macht den Moduswechsel körperlich spürbar.
// hover > behind bei walk: in Städten schaut die Kamera dadurch etwas steiler
// über die Dächer, statt hinter Häuserzeilen zu hängen
const MODE_SPEED = { walk: 0.4, moped: 1.15, bike: 1, jeep: 1.45, tram: 1.25, ferry: 2.5 }
const MODE_SCALE = {
  walk: { behind: 0.5, hover: 0.68 },
  moped: { behind: 0.95, hover: 1 }, // wendig wie ein Rad, Kamera dicht dran
  jeep: { behind: 1.25, hover: 1.25 }, // Wagen: sitzt etwas höher/weiter zurück
  tram: { behind: 1.15, hover: 1.2 },
  ferry: { behind: 2.3, hover: 2.2 },
  bike: { behind: 1, hover: 1 },
}

export class Tour {
  constructor(map, route, stops, ui, opts = {}) {
    this.map = map
    this.route = route
    this.stops = stops // [{ s, items: [Foto, …] }] aufsteigend nach s
    this.ui = ui
    this.modes = opts.modes ?? [{ s: 0, mode: 'bike', label: 'Rad' }]
    const sc0 = MODE_SCALE[this.modes[0].mode] ?? MODE_SCALE.bike
    this.scaleSm = new Smooth(sc0.behind)
    this.hoverSm = new Smooth(sc0.hover)

    this.phase = 'intro'
    this.playing = false
    this.scrubbing = false
    // Steht die Kamera in der Pause bereits auf der idealen Fahrt-Pose? Nur dann
    // schneidet die Einzelbild-Taste hart; sonst schwingt sie erst weich ein
    // (verhindert den Sprung beim ersten Cursortasten-Druck).
    this.settled = false
    // Explizit angeforderte Kamera-Umposition im Pause-Modus (Einzelbild-Taste,
    // Kameradistanz-Wechsel). Nur wenn gesetzt, darf sich die Kamera in Pause
    // bewegen — ein einfacher Pause-Klick friert dagegen exakt ein (kein Nachziehen).
    this.repose = false
    // Aktiver zeitbasierter Kameraschwenk (Scrub-Sprung im Pause-Modus) oder null.
    this.reposeTween = null
    this.s = 0
    this.speed = 0
    this.baseSpeed = 120 // m/s Streckenfortschritt bei 1×
    this.mult = 1
    this.dir = 1 // Wiedergaberichtung: +1 vorwärts, −1 rückwärts (JKL-Shuttle)
    this.preset = PRESETS.mittel
    this.nextIdx = 0 // Index des nächsten Foto-Stopps
    this.itemIdx = 0 // Foto innerhalb des aktuellen Stopps
    this.holdT = 0
    this.photoShown = false
    this.glide = 1 // Tau-Multiplikator, >1 direkt nach Phasenwechseln (epischere Schwenks)
    this.course = bearingAt(route, 0) // stark geglättete Fahrtrichtung für die Kameraposition
    this.tuck = new Smooth(1) // 1 = voller Abstand; <1 = näher am Fahrer (Hindernis im Rücken)
    this.skyLift = new Smooth(0) // 0 = Blick nach unten (Tag); →1 = Kamera kippt zum Horizont
    this.skyLiftTarget = 0 // von setSunAlt aus dem Sonnenstand gespeist

    // Übersichts-Orbit für Intro und Finale (bei großen Touren gedeckelt)
    const mid = pointAt(route, route.total * 0.5)
    const b = this.boundsOf(route)
    this.mid = mid
    this.diag = dist([b[0][0], b[0][1]], [b[1][0], b[1][1]])
    this.ovR = Math.min(this.diag * 1.15, 17000)
    this.ovA = Math.min(this.diag * 0.95, 14000)
    this.orbitA = 205 // Blick von Süden

    const ovGround = destination([mid[0], mid[1]], this.ovR, this.orbitA)
    this.cg = { lng: new Smooth(ovGround[0]), lat: new Smooth(ovGround[1]) }
    this.alt = new Smooth(mid[2] * EXAGGERATION + this.ovA)
    this.lt = { lng: new Smooth(mid[0]), lat: new Smooth(mid[1]) }
    this.ltAlt = new Smooth(mid[2] * EXAGGERATION)

    this.applyCamera()
    this.updateMapLock() // Intro-Orbit: Karte gesperrt, kein Greifhand-Cursor
    this.lastT = performance.now()
    this.uiClock = 0
    this._tick = this.tick.bind(this)
    requestAnimationFrame(this._tick)
  }

  boundsOf(route) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const c of route.coords) {
      minX = Math.min(minX, c[0]); maxX = Math.max(maxX, c[0])
      minY = Math.min(minY, c[1]); maxY = Math.max(maxY, c[1])
    }
    return [[minX, minY], [maxX, maxY]]
  }

  // Szenenhöhe (überhöhtes Terrain) an einem Punkt; Fallback: Höhenprofil der Route
  groundAlt(lnglat, fallbackEle) {
    const e = this.map.queryTerrainElevation(lnglat)
    return e ?? fallbackEle * EXAGGERATION
  }

  // Sonnenstand (Grad) → Ziel-Anhebung der Kamera + gemerkter Sonnen-Azimut fürs
  // Yaw. Golden Hour (Sonne tief) hebt voll an, tiefe Nacht moderat (damit Sterne
  // sichtbar sind, ohne den ganzen Nachtteil in Dauerschräglage zu zwingen), heller
  // Tag gar nicht. Wird von der Tag/Nacht-Regie (main.js) gespeist; die Smooths in
  // update() ziehen weich nach.
  setSun(sun) {
    this.sunAlt = sun.altitude
    this.sunAz = sun.azimuth
    const gh = _ss(14, 1, sun.altitude) // 0 bei 14°, 1 bei ≤1° (Sonne nähert sich Horizont)
    const night = _ss(-6, -12, sun.altitude) // 0 bei −6°, 1 bei ≤−12° (tiefe Nacht)
    // Moderate Anhebung: etwas Himmel/Horizont ins Bild, aber der Fahrer/Wegpunkt
    // bleibt klar über der Navigationsleiste sichtbar. FRÜHER hob Nacht auf 0.9 —
    // dabei rutschte der Marker unter das Dock und war nicht mehr zu sehen.
    this.skyLiftTarget = Math.max(0.5 * gh * (1 - night), 0.28 * night)
  }

  // Kamera-Standrichtung: immer in Fahrtrichtung hinter dem Fahrer. FRÜHER drehte sie
  // sich zur Golden Hour bis ±140° zur Sonne ein — das riss die Kamera aber vom
  // Wegpunkt weg (zu weit, nicht mehr auf der Marke ausgerichtet). Bewusst KEIN
  // Sonnen-Eindrehen mehr: liegt der Untergang ohnehin voraus, ist er im Bild; steht
  // die Sonne seitlich/im Rücken, wird nicht extra dorthin geschwenkt.
  yawedBackDir(course) {
    return (course + 180) % 360
  }

  // Blickpunkt-Höhe für eine Fahrt-Pose inkl. Himmel-Anhebung. Der natürliche Blick-
  // nach-unten-Winkel (Kamera→Fahrer) wird per skyLift Richtung SKY_MIN_DOWN abge-
  // flacht — das kippt die Kamera geometrieunabhängig zum Horizont. Rückgabe: Ziel-
  // ltAlt für den Blickpunkt (bei skyLift 0 exakt die Fahrer-Bodenhöhe).
  liftedLtAlt(cgPos, riderLngLat, riderGround, camAlt) {
    const D = Math.max(dist(cgPos, riderLngLat), 50) // horizontaler Kamera-Fahrer-Abstand (m)
    const thNat = Math.atan2(camAlt - riderGround, D) // natürlicher Blick-nach-unten (rad)
    const th = Math.min(thNat, thNat * (1 - this.skyLift.v) + SKY_MIN_DOWN * this.skyLift.v)
    return camAlt - D * Math.tan(th)
  }

  begin() {
    this.phase = 'ride'
    this.playing = true
    this.settled = false
    this.glide = 2.4 // langer, epischer Anflug hinter den Startpunkt
    this.ui.hideIntro()
    this.updateMapLock() // Fahrt läuft ⇒ Karte gesperrt, kein Greifhand-Cursor
  }

  setPlaying(on) {
    if (on === this.playing) return
    this.playing = on
    this.ui.setPlaying(on)
    this.repose = false // weder Play noch Pause ziehen automatisch nach
    this.reposeTween = null // laufenden Scrub-Schwenk abbrechen
    if (on) {
      this.settled = false // Bewegung ⇒ Kamera muss sich neu einschwingen
      // Nur blenden, wenn der Nutzer die Karte in der Pause tatsächlich verschoben
      // hat — dann ist das Fortsetzen ein harter Rücksprung. Beim bloßen Weiter-
      // Drücken (Space, ohne die Karte anzufassen) läuft das Bild nahtlos weiter.
      const moved = this._camMoved()
      this.updateMapLock() // Karte sperren (Kamera folgt wieder der Tour)
      if (moved) this.ui.blink(() => {})
    } else {
      // Pause: Kamera exakt an der aktuellen Pose einfrieren — KEIN Nachziehen auf
      // eine „ideale" Pose (das wirkte als störender Nachschwenk nach dem Stopp).
      this.updateMapLock() // Karte freigeben (Pannen/Zoomen) + camSnap merken
    }
  }

  // Karten-Interaktion an den Zustand koppeln: NUR in der Fahrt-Pause darf frei
  // gepannt/gezoomt werden. In jeder von der Tour geführten Phase (Intro, laufende
  // Fahrt, Foto, Finale) wird die Karte gesperrt — sonst kämpfen Nutzer-Geste und
  // Kamerafahrt gegeneinander. `cam-locked` unterdrückt zusätzlich den Greifhand-
  // Cursor, den MapLibre sonst über die interactive-Klasse dauerhaft zeigt.
  updateMapLock() {
    const free = !this.playing && !this.scrubbing && this.phase === 'ride'
    const act = free ? 'enable' : 'disable'
    this.map.dragPan[act]()
    this.map.scrollZoom[act]()
    this.map.touchZoomRotate[act]()
    this.map.touchPitch[act]()
    document.body.classList.toggle('cam-locked', !free)
    if (free) this.camSnap = this._camNow() // Referenzpose, um späteres Pannen zu erkennen
  }

  // Kamerastand als Signatur (Vergleich für den bedingten Resume-Fade)
  _camNow() {
    const c = this.map.getCenter()
    return { lng: c.lng, lat: c.lat, zoom: this.map.getZoom(), bearing: this.map.getBearing(), pitch: this.map.getPitch() }
  }

  _camMoved() {
    const s = this.camSnap
    if (!s) return false
    const c = this.map.getCenter()
    return (
      Math.abs(c.lng - s.lng) > 1e-6 ||
      Math.abs(c.lat - s.lat) > 1e-6 ||
      Math.abs(this.map.getZoom() - s.zoom) > 1e-3 ||
      Math.abs(this.map.getBearing() - s.bearing) > 0.05 ||
      Math.abs(this.map.getPitch() - s.pitch) > 0.05
    )
  }

  setPreset(p) {
    this.preset = PRESETS[p] ?? PRESETS.mittel
    // Zügig ausfahren: der Wechsel soll sich wie ein Schnitt anfühlen, nicht
    // wie eine Kamerafahrt (Tile-Nachladen fangen Fade + größerer Cache ab)
    this.glide = Math.min(this.glide, 0.6)
    // Auch im Pause-Modus soll der Distanz-Wechsel sichtbar sein: einmalige
    // Umposition anfordern (repose), die Kamera zieht dann weich auf die neue
    // Kameradistanz und rastet danach wieder ein.
    if (!this.playing && !this.scrubbing && this.phase === 'ride') {
      this.repose = true
      this.reposeTween = null // velocity-basiertes Ease auf die neue Distanz (kein Sprung-Schwenk)
      this.settled = false
    }
  }

  seek(frac) {
    const s = Math.max(0, Math.min(1, frac)) * this.route.total
    if (this.phase === 'photo') this.ui.hidePhoto()
    if (this.phase === 'intro') this.ui.hideIntro()
    if (this.phase === 'finale') this.ui.hideFinale()
    this.phase = 'ride'
    this.s = s
    this.speed = 0
    this.dir = 1
    this.glide = 1.6
    this.photoShown = false
    this.course = bearingAt(this.route, s) // nach Teleport nicht minutenlang nachdrehen
    this.tuck.set(1)
    this.syncNextIdx()
    this.ui.syncDots(s)
    this.emitStats() // Kopf/Telemetrie sofort auf die Zielposition
    // Wiedergabezustand vom Scrubben beibehalten:
    if (this.playing) {
      // Läuft weiter: Kamera zieht von der aktuellen (Scrub-)Pose weich an die
      // neue Stelle. camSnap auf die aktuelle Pose, damit kein Resume-Fade entsteht.
      this.camSnap = this._camNow()
    } else {
      // Pausiert bleiben, aber weich: statt eines harten Schnitts ein kurzer,
      // zügiger Schwenk (~0,7 s, sanft auslaufend) von der aktuellen (Scrub-)Pose
      // auf die ideale Zielpose, dann einfrieren. Bei echtem Ziehen ist der Rest-
      // Weg klein (die Kamera folgte live), bei einem weiten Sprung wird es ein
      // schneller, weich auslaufender Schwenk — nie ruckartig, nie Nachkriechen.
      this.ui.updateTrace(this.s, pointAt(this.route, this.s)) // Fahrer-Marker sofort an die Zielposition
      this._beginReposeTween(0.7)
      this.camSnap = this._camNow()
    }
  }

  // Nach einem Reload an die gemerkte Position zurückkehren, OHNE Intro-Orbit:
  // Fahrt-Phase, Kamera hart auf die Pose schneiden (kein Einschwingen aus der
  // Übersicht), standardmäßig pausiert — so zeigt ein Reload exakt denselben Frame
  // (nötig fürs A/B-Vergleichen). Terrain-Höhen sind evtl. noch nicht geladen →
  // groundAlt fällt aufs Höhenprofil zurück, die Pose sitzt beim nächsten Tick sauber.
  resumeAt(s, play = false) {
    this.ui.hideIntro()
    this.phase = 'ride'
    this.playing = false
    this.scrubbing = false
    this.s = Math.max(0, Math.min(this.route.total, s))
    this.speed = 0
    this.dir = 1
    this.glide = 1
    this.photoShown = false
    this.tuck.set(1)
    this.syncNextIdx()
    this._snapRideCamera() // setzt cg/lt/alt hart + applyCamera
    this.settled = true
    this.updateMapLock() // Karte je nach Play/Pause sperren/freigeben (+ camSnap)
    this.ui.syncDots(this.s)
    this.ui.updateTrace(this.s, pointAt(this.route, this.s))
    this.emitStats()
    if (play) this.setPlaying(true)
    else this.ui.setPlaying(false) // Play/Pause-Icon auf Pause stellen (hideIntro setzt es auf Play)
  }

  // Index des nächsten (vorwärts liegenden) Foto-Stopps neu bestimmen — nötig
  // nach jedem Sprung/Richtungswechsel, damit Stopps korrekt wieder auslösen
  syncNextIdx() {
    this.nextIdx = this.stops.findIndex((st) => st.s > this.s + 160)
    if (this.nextIdx === -1) this.nextIdx = this.stops.length
  }

  // — Timeline-Scrubbing (Ziehen wie im Video-Editor) —
  // Während des Ziehens folgt die Kamera straff der Position, aber es wird
  // nichts ausgelöst: keine Foto-Stopps, kein Finale, kein Streckenfortschritt.
  beginScrub(frac) {
    if (this.phase === 'photo') this.ui.hidePhoto()
    if (this.phase === 'finale') this.ui.hideFinale()
    this.scrubbing = true
    this.phase = 'ride'
    this.photoShown = false
    this.settled = false
    this.speed = 0
    this.scrub(frac)
  }

  scrub(frac) {
    this.s = Math.max(0, Math.min(1, frac)) * this.route.total
    this.glide = Math.min(this.glide, 0.5) // Kamera zieht straff nach statt zu schweben
    this.syncNextIdx()
    this.emitStats() // Kopf und Telemetrie sofort, nicht erst beim 10-Hz-Takt
  }

  endScrub(frac) {
    this.scrubbing = false
    this.seek(frac) // setzt Kurs, nächsten Stopp und Wiedergabe wie ein Sprung
  }

  // „Weiter“: nächstes Foto des Stopps zeigen, sonst Fahrt fortsetzen.
  // Holt die Tour auch aus einer Foto-Pause zurück.
  photoNext() {
    if (this.phase !== 'photo' || this.photoShown !== true) return
    const items = this.shownStop.items
    if (this.itemIdx + 1 < items.length) {
      this.itemIdx++
      this.holdT = 0
      this.ui.swapPhoto(items[this.itemIdx], this.itemIdx, items.length)
    } else {
      this.photoShown = 'hiding'
      this.holdT = HOLD_HIDE
      this.ui.hidePhoto()
    }
    if (!this.playing) this.setPlaying(true)
  }

  // Klick aufs Foto: Anzeige anhalten bzw. weiterlaufen lassen
  togglePhotoHold() {
    if (this.phase === 'photo' && this.photoShown === true) this.setPlaying(!this.playing)
  }

  // Zurück ins Hauptmenü: Intro-Overlay + Übersichts-Orbit, Tour-UI einziehen.
  // Kein harter Schnitt — die Kamera zieht majestätisch zur Übersicht auf.
  toMenu() {
    this.ui.hidePhoto()
    this.ui.hideFinale()
    this.phase = 'intro'
    this.playing = false
    this.scrubbing = false
    this.speed = 0
    this.s = 0
    this.nextIdx = 0
    this.photoShown = false
    this.glide = 2.2
    // Orbit dort weiterdrehen, wo die Kamera gerade steht (kein Sprung)
    this.orbitA = bearing([this.mid[0], this.mid[1]], [this.cg.lng.v, this.cg.lat.v])
    this.ui.syncDots(0)
    this.ui.showMenu()
    this.updateMapLock() // Intro-Orbit: Karte gesperrt wie beim ersten Laden
  }

  // Foto-Stopp direkt öffnen (Klick auf Timeline-Dot oder Karten-Wegpunkt):
  // Kamera hart hinter den Punkt setzen — der Schnitt liegt unter der Blende —
  // und die Karte sofort zeigen statt erst 600 m anzufahren.
  jumpToPhoto(s) {
    const idx = this.stops.findIndex((st) => Math.abs(st.s - s) < 1)
    if (idx === -1) return this.seek(Math.max(0, s - 600) / this.route.total)
    const st = this.stops[idx]
    this.ui.hidePhoto()
    if (this.phase === 'finale') this.ui.hideFinale()
    this.scrubbing = false
    this.ui.blink(() => {
      const p = pointAt(this.route, st.s)
      const b = bearingAt(this.route, st.s)
      const sc = MODE_SCALE[this.modeAt(st.s).mode] ?? MODE_SCALE.bike
      this.scaleSm.set(sc.behind)
      this.hoverSm.set(sc.hover)
      this.tuck.set(1)
      const ground = this.groundAlt([p[0], p[1]], p[2])
      const cg = destination([p[0], p[1]], this.preset.behind * sc.behind, (b + 180) % 360)
      this.cg.lng.set(cg[0])
      this.cg.lat.set(cg[1])
      this.alt.set(Math.max(ground + this.preset.hover * sc.hover, this.groundAlt(cg, p[2]) + 110))
      this.lt.lng.set(p[0])
      this.lt.lat.set(p[1])
      this.ltAlt.set(ground)
      this.s = st.s
      this.course = b
      this.speed = 0
      this.dir = 1
      this.phase = 'photo'
      this.shownStop = st
      this.nextIdx = idx + 1
      this.itemIdx = 0
      this.holdT = 0
      this.photoShown = true
      this.ui.syncDots(st.s)
      this.ui.updateTrace(st.s, p)
      if (!this.playing) this.setPlaying(true)
      this.applyCamera()
      this.ui.showPhoto(st.items[0], 0, st.items.length)
    })
  }

  restart() {
    this.ui.hidePhoto()
    this.ui.hideFinale()
    this.ui.blink(() => {
      this.s = 0
      this.speed = 0
      this.dir = 1
      this.nextIdx = 0
      this.phase = 'ride'
      this.glide = 1
      this.photoShown = false
      this.course = bearingAt(this.route, 0)
      this.ui.syncDots(0)
      // Kamera hart hinter den Start setzen (Schnitt liegt unter der Blende)
      const start = pointAt(this.route, 0)
      const b0 = bearingAt(this.route, 0)
      const cg = destination([start[0], start[1]], this.preset.behind, (b0 + 180) % 360)
      this.cg.lng.set(cg[0]); this.cg.lat.set(cg[1])
      this.alt.set(this.groundAlt([start[0], start[1]], start[2]) + this.preset.hover)
      this.lt.lng.set(start[0]); this.lt.lat.set(start[1])
      this.ltAlt.set(this.groundAlt([start[0], start[1]], start[2]))
      if (!this.playing) this.setPlaying(true)
      this.applyCamera()
    })
  }

  cycleSpeed() {
    this.mult = this.mult >= 4 ? 1 : this.mult * 2
    return this.mult
  }

  // — Tastatursteuerung wie im Video-Editor —

  // Einzelbild vor/zurück (Cursortasten). Ein „Bild“ = Strecke bei 1× in 1/24 s
  // des aktuellen Modus. Bleibt angehalten, snappt die Kamera hart auf die neue
  // Position (kein Nachschweben) und aktualisiert Kamerastand → kein Resume-Fade.
  nudge(frames) {
    if (this.phase === 'intro') return
    if (this.phase === 'photo') this.ui.hidePhoto()
    if (this.phase === 'finale') this.ui.hideFinale()
    // Kam die Kamera gerade aus der Fahrt (noch nicht eingeschwungen), läge sie
    // auf einer nachlaufenden Pose — ein harter Snap auf die ideale Pose wäre
    // dann genau der sichtbare Sprung. In dem Fall NICHT snappen, sondern die
    // Einschwing-Schleife (tick) die Kamera weich nachziehen lassen; ab dem
    // nächsten Bild sitzt sie auf ideal und die Taste schneidet knackig.
    const wasSettled = this.settled && this.phase === 'ride'
    this.phase = 'ride'
    this.photoShown = false
    this.dir = 1
    this.speed = 0
    this.setPlaying(false)
    const mo = this.modeAt(this.s)
    const step = frames * this.baseSpeed * (MODE_SPEED[mo.mode] ?? 1) / 24
    this.s = Math.max(0, Math.min(this.route.total, this.s + step))
    this.syncNextIdx()
    if (wasSettled) {
      this._snapRideCamera() // eingeschwungen ⇒ harter Einzelbild-Schnitt, kein Sprung
      this.settled = true
      this.camSnap = this._camNow() // Kamera steht auf der Tour-Pose ⇒ Fortsetzen ohne Blende
    } else {
      this.settled = false // tick schwingt die Kamera jetzt weich auf die neue Pose ein
      this.repose = true // Umposition erlauben (sonst bliebe die Pause eingefroren)
      this.reposeTween = null // velocity-basiertes Ease (kein Sprung-Schwenk)
      this.glide = Math.min(this.glide, 0.45) // zügig, damit es nur kurz „nachzieht“
    }
    this.ui.updateTrace(this.s, pointAt(this.route, this.s))
    this.ui.syncDots(this.s)
    this.emitStats()
  }

  // Ideale Fahrt-Pose (Kameraposition + Blickpunkt) für Streckenmeter s berechnen,
  // OHNE etwas zu setzen. Spiegelt bewusst die Rahmung des else-Zweigs in update().
  // Geteilt vom harten Snap und vom weichen Scrub-Schwenk.
  _ridePose(s) {
    const { route, preset } = this
    const rider = pointAt(route, s)
    const mo = this.modeAt(s)
    const course = bearingAt(route, s)
    const backDir = this.yawedBackDir(course) // Golden Hour: zur Sonne eindrehen (Pause/Scrub konsistent)
    const riderG = this.groundAlt([rider[0], rider[1]], rider[2])
    const sc = MODE_SCALE[mo.mode] ?? MODE_SCALE.bike
    const behind = preset.behind * sc.behind
    const hover = preset.hover * sc.hover
    let k = 1
    while (k > 0.4) {
      const cand = destination([rider[0], rider[1]], behind * k, backDir)
      if (this.groundAlt(cand, rider[2]) + 110 <= riderG + hover * k) break
      k -= 0.12
    }
    const cgPos = destination([rider[0], rider[1]], behind * k, backDir)
    const alt = Math.max(riderG + hover * k, this.groundAlt(cgPos, rider[2]) + 110)
    return {
      course, sc, k,
      cg: cgPos,
      alt,
      lt: [rider[0], rider[1]],
      ltAlt: this.liftedLtAlt(cgPos, [rider[0], rider[1]], riderG, alt), // Himmel-Moment auch bei Pause/Scrub
    }
  }

  // Fahrt-Kamera für this.s ohne Glättung setzen (harter Snap), nur mit .set().
  _snapRideCamera() {
    const p = this._ridePose(this.s)
    this.course = p.course
    this.scaleSm.set(p.sc.behind)
    this.hoverSm.set(p.sc.hover)
    this.tuck.set(p.k)
    this.cg.lng.set(p.cg[0])
    this.cg.lat.set(p.cg[1])
    this.alt.set(p.alt)
    this.lt.lng.set(p.lt[0])
    this.lt.lat.set(p.lt[1])
    this.ltAlt.set(p.ltAlt)
    this.glide = 1
    this.applyCamera()
  }

  // Kurzer, zeitbasierter Kameraschwenk auf die ideale Fahrt-Pose der aktuellen
  // Position (Scrub-Sprung im Pause-Modus): weich, sanft auslaufend, und — anders
  // als exponentielles Nachziehen — nach `dur` garantiert sauber am Ziel. Ersetzt
  // den harten, ruckartigen Schnitt. Kurs/Distanz-Skalierung werden sofort auf den
  // Zielwert gesetzt (sie bestimmen die feste Ziel-Pose), nur cg/alt/Blickpunkt
  // werden über die Zeit interpoliert.
  _beginReposeTween(dur) {
    const to = this._ridePose(this.s)
    this.course = to.course
    this.scaleSm.set(to.sc.behind)
    this.hoverSm.set(to.sc.hover)
    this.tuck.set(to.k)
    this.reposeTween = {
      t: 0,
      dur,
      from: { cgLng: this.cg.lng.v, cgLat: this.cg.lat.v, alt: this.alt.v, ltLng: this.lt.lng.v, ltLat: this.lt.lat.v, ltAlt: this.ltAlt.v },
      to: { cgLng: to.cg[0], cgLat: to.cg[1], alt: to.alt, ltLng: to.lt[0], ltLat: to.lt[1], ltAlt: to.ltAlt },
    }
    this.repose = true
    this.settled = false
  }

  // JKL-Shuttle: L (dir +1) / J (dir −1). Erneut in dieselbe Richtung = schneller;
  // Richtungswechsel startet wieder bei 1×. K hält an (in main.js verdrahtet).
  shuttle(dir) {
    if (this.phase === 'intro') return
    if (this.phase === 'photo') this.ui.hidePhoto()
    if (this.phase === 'finale') this.ui.hideFinale()
    this.phase = 'ride'
    this.photoShown = false
    if (this.playing && this.dir === dir) {
      this.mult = this.mult >= 8 ? 8 : this.mult * 2
    } else {
      this.dir = dir
      this.mult = 1
      this.syncNextIdx() // Richtung/Position neu ⇒ nächsten Stopp neu bestimmen
    }
    if (!this.playing) this.setPlaying(true)
  }

  // — pro Frame —

  tick(now) {
    const dt = Math.min((now - this.lastT) / 1000, 0.05)
    this.lastT = now

    if (this.phase === 'intro') {
      this.orbitA += 1.7 * dt
      this.updateOrbitCamera(dt, this.mid, this.ovR, this.ovA)
    } else if (this.playing || this.scrubbing) {
      this.update(dt) // beim Scrubben muss die Kamera auch in Pause folgen
    } else if (this.phase === 'ride' && this.repose && !this.settled) {
      // Pausiert, aber eine Umposition wurde explizit angefordert. Ohne repose
      // bleibt die Pause bewegungslos eingefroren.
      if (this.reposeTween) {
        // Scrub-Sprung: zeitbasierter Schwenk fester Dauer, sanft auslaufend
        // (easeOut) — nie ruckartig, nie sekundenlanges Nachkriechen. camSnap
        // mitführen, damit die Drag-Erkennung diese Systembewegung nicht für ein
        // Nutzer-Verschieben hält.
        const tw = this.reposeTween
        tw.t += dt
        const f = Math.min(tw.t / tw.dur, 1)
        const e = 1 - Math.pow(1 - f, 3) // easeOutCubic: schnell los, weich aus
        const L = (a, b) => a + (b - a) * e
        this.cg.lng.set(L(tw.from.cgLng, tw.to.cgLng))
        this.cg.lat.set(L(tw.from.cgLat, tw.to.cgLat))
        this.alt.set(L(tw.from.alt, tw.to.alt))
        this.lt.lng.set(L(tw.from.ltLng, tw.to.ltLng))
        this.lt.lat.set(L(tw.from.ltLat, tw.to.ltLat))
        this.ltAlt.set(L(tw.from.ltAlt, tw.to.ltAlt))
        this.applyCamera()
        this.camSnap = this._camNow()
        if (f >= 1) { this.settled = true; this.repose = false; this.reposeTween = null }
      } else {
        // Kameradistanz-Wechsel / Einzelbild: Kamera weich auf die neue Pose
        // ziehen, Einrasten GESCHWINDIGKEITSbasiert (kommt die Bewegung pro Bild
        // zum Stillstand). camSnap mitführen (s.o.).
        const prev = this._camNow()
        this.update(dt)
        const cur = this._camNow()
        this.camSnap = cur
        const stopped =
          Math.abs(cur.lng - prev.lng) < 1e-7 &&
          Math.abs(cur.lat - prev.lat) < 1e-7 &&
          Math.abs(cur.zoom - prev.zoom) < 5e-4 &&
          Math.abs(cur.bearing - prev.bearing) < 0.02 &&
          Math.abs(cur.pitch - prev.pitch) < 0.02
        if (stopped) { this.settled = true; this.repose = false }
      }
    }

    this.uiClock += dt
    if (this.uiClock > 0.1) {
      this.uiClock = 0
      this.emitStats()
    }
    requestAnimationFrame(this._tick)
  }

  // Aktueller Fortbewegungsmodus bei Streckenmeter s
  modeAt(s) {
    let cur = this.modes[0]
    for (const m of this.modes) if (m.s <= s + 1) cur = m
    return cur
  }

  update(dt) {
    const { route, preset } = this
    this.glide += (1 - this.glide) * (1 - Math.exp(-dt / 2.2))
    this.skyLift.to(this.skyLiftTarget, dt, SKY_LIFT_TAU) // Himmel-Anhebung weich nachziehen
    const mo = this.modeAt(this.s)

    if (this.phase === 'photo' && this.photoShown) {
      // Foto sichtbar: Route UND Kamera stehen komplett still — kein Orbit,
      // kein Nachschwingen. Der Einfrier-Moment liegt unter dem Kamerablitz.
      this.speed = 0
      this.holdT += dt
      const items = this.shownStop.items
      if (this.photoShown === true && this.holdT >= HOLD_HIDE) {
        if (this.itemIdx + 1 < items.length) {
          // nächstes Foto am selben Halt — Karte bleibt, Inhalt blendet um
          this.itemIdx++
          this.holdT = 0
          this.ui.swapPhoto(items[this.itemIdx], this.itemIdx, items.length)
        } else {
          this.photoShown = 'hiding'
          this.ui.hidePhoto()
        }
      }
      if (this.photoShown === 'hiding' && this.holdT >= HOLD_END) {
        this.phase = 'ride'
        this.photoShown = false
        this.glide = 1.5
      }
      return
    } else {
      const speedTarget =
        this.phase === 'ride' && !this.scrubbing && this.playing
          ? this.baseSpeed * this.mult * (MODE_SPEED[mo.mode] ?? 1)
          : 0
      const speedTau = this.phase === 'photo' ? 0.55 : 1.1
      this.speed += (speedTarget - this.speed) * (1 - Math.exp(-dt / speedTau))
      // Beim Scrubben bestimmt allein der Zeigefinger die Position; sonst trägt
      // die Richtung (this.dir) das Vorzeichen — Rückwärtswiedergabe per JKL.
      // In Pause (nur Einschwingen) darf sich s nicht bewegen.
      if (!this.scrubbing && this.playing) {
        this.s = Math.max(0, Math.min(this.s + this.dir * this.speed * dt, route.total))
        if (this.dir < 0 && this.s <= 0) { this.dir = 1; this.setPlaying(false) } // am Anfang angekommen
      }

      // Foto-Trigger: Bremsweg der Ausrollkurve (≈ speed · τ) einplanen,
      // damit der Stopp nahe am Ankerpunkt landet (nur vorwärts — beim Zurück-
      // spulen soll die Fahrt nicht an jedem Stopp hängenbleiben)
      if (this.phase === 'ride' && !this.scrubbing && this.playing && this.dir > 0 && this.nextIdx < this.stops.length) {
        const brake = this.speed * 0.62
        if (this.s >= this.stops[this.nextIdx].s - brake) {
          this.phase = 'photo'
          this.shownStop = this.stops[this.nextIdx]
          this.nextIdx++
        }
      }
      // Ausgerollt: Karte zeigen — ab jetzt steht alles still
      if (this.phase === 'photo' && this.speed < 4) {
        this.speed = 0
        this.photoShown = true
        this.itemIdx = 0
        this.holdT = 0
        this.ui.showPhoto(this.shownStop.items[0], 0, this.shownStop.items.length)
      }
    }

    if (this.s >= route.total && this.dir > 0 && this.phase !== 'photo' && !this.scrubbing && this.playing) {
      if (this.phase !== 'finale') {
        this.phase = 'finale'
        this.glide = 2.2
        this.orbitA = bearing([this.mid[0], this.mid[1]], [this.cg.lng.v, this.cg.lat.v])
        this.ui.showFinale()
      }
      this.orbitA += 3 * dt
      this.updateOrbitCamera(dt, this.mid, this.ovR * 0.78, this.ovA * 0.65)
    } else {
      // Fahrt: Der Blickpunkt IST der Fahrer — er bleibt dadurch immer exakt in
      // der Bildmitte. Die Kamera hängt in festem Luftlinien-Abstand hinter einer
      // stark geglätteten Fahrtrichtung — Spitzkehren werden so zu einem einzigen
      // ruhigen Schwenk statt hektischer Kamerasprünge entlang der Route.
      const rider = pointAt(route, this.s)
      this.course += angleDelta(this.course, bearingAt(route, this.s)) * (1 - Math.exp(-dt / (2.8 * this.glide)))
      const backDir = this.yawedBackDir(this.course) // Golden Hour: zur Sonne eindrehen
      const riderG = this.groundAlt([rider[0], rider[1]], rider[2])
      // Kameradistanz an den Fortbewegungsmodus anpassen (zu Fuß nah, Fähre weit)
      const sc = MODE_SCALE[mo.mode] ?? MODE_SCALE.bike
      this.scaleSm.to(sc.behind, dt, 2.2)
      this.hoverSm.to(sc.hover, dt, 2.2)
      const behind = preset.behind * this.scaleSm.v
      const hover = preset.hover * this.hoverSm.v
      // Steht eine Felswand hinter dem Fahrer, die Kamera nicht darüber heben
      // (das kippt die Sicht in die Draufsicht), sondern proportional näher an
      // den Fahrer heranziehen — Abstand:Höhe bleibt gleich, der Pitch konstant.
      let k = 1
      while (k > 0.4) {
        const cand = destination([rider[0], rider[1]], behind * k, backDir)
        if (this.groundAlt(cand, rider[2]) + 110 <= riderG + hover * k) break
        k -= 0.12
      }
      this.tuck.to(k, dt, 1.4 * this.glide)
      const kk = this.tuck.v
      const cgPos = destination([rider[0], rider[1]], behind * kk, backDir)
      const cg = [cgPos[0], cgPos[1], rider[2]]
      const alt = Math.max(riderG + hover * kk, this.groundAlt(cgPos, rider[2]) + 110)
      // Himmel-Moment: Blickwinkel abflachen → Kamera kippt zum Horizont
      this.smoothTowards(dt, cg, alt, rider, this.liftedLtAlt(cgPos, [rider[0], rider[1]], riderG, alt))
      if (!this.playing && !this.scrubbing) {
        // Pausiert: sobald die Kamera praktisch auf der idealen Fahrt-Pose sitzt,
        // gilt sie als eingeschwungen — ab dann schneidet die Einzelbild-Taste hart.
        const near =
          Math.abs(this.cg.lng.v - cg[0]) < 2e-6 &&
          Math.abs(this.cg.lat.v - cg[1]) < 2e-6 &&
          Math.abs(this.alt.v - alt) < 0.5 &&
          Math.abs(angleDelta(this.course, bearingAt(route, this.s))) < 0.15
        if (near) { this.settled = true; this.repose = false; this.reposeTween = null }
      }
    }

    this.applyCamera()
    this.ui.updateTrace(this.s, pointAt(route, this.s))
  }

  updateOrbitCamera(dt, point, radius, height) {
    const cg = destination([point[0], point[1]], radius, this.orbitA)
    const ground = this.groundAlt([point[0], point[1]], point[2])
    this.smoothTowards(dt, cg, ground + height, point)
    if (this.phase === 'intro') this.applyCamera()
  }

  smoothTowards(dt, cgTarget, altTarget, lookTarget, ltAltTarget) {
    // Kameraposition träge (ruhige Fahrt), Blickpunkt straff (Fahrer zentriert)
    const g = this.glide
    this.cg.lng.to(cgTarget[0], dt, 2.2 * g)
    this.cg.lat.to(cgTarget[1], dt, 2.2 * g)
    this.alt.to(altTarget, dt, 2.6 * g)
    this.lt.lng.to(lookTarget[0], dt, 0.55 * g)
    this.lt.lat.to(lookTarget[1], dt, 0.55 * g)
    // ltAltTarget explizit (Himmel-Momente heben den Blickpunkt an); sonst Boden
    const ltA = ltAltTarget != null ? ltAltTarget : this.groundAlt([lookTarget[0], lookTarget[1]], lookTarget[2])
    this.ltAlt.to(ltA, dt, 0.8 * g)
  }

  applyCamera() {
    // Kamera bei (cg, alt) blickt auf (lt, ltAlt); MapLibre leitet daraus
    // center/zoom/pitch/bearing ab und hält die Kamera über dem Terrain.
    const opts = this.map.calculateCameraOptionsFromTo(
      new maplibregl.LngLat(this.cg.lng.v, this.cg.lat.v),
      this.alt.v,
      new maplibregl.LngLat(this.lt.lng.v, this.lt.lat.v),
      this.ltAlt.v
    )
    this.map.jumpTo(opts)
    const pose = {
      cg: [this.cg.lng.v, this.cg.lat.v],
      alt: this.alt.v,
      lt: [this.lt.lng.v, this.lt.lat.v],
      ltAlt: this.ltAlt.v,
    }
    // Optionaler Zweit-Renderer (Google-3D-Testmodus) bekommt dieselbe Pose
    this.extCamera?.(pose)
    // Sonnen-Flare-Overlay (sunflare.js) — läuft renderer-unabhängig immer mit
    this.onPose?.(pose)
  }

  emitStats() {
    const p = pointAt(this.route, this.s)
    const inTour = this.phase === 'ride' || this.phase === 'photo'
    const next = inTour && this.nextIdx < this.stops.length ? this.stops[this.nextIdx] : null
    const mo = this.modeAt(this.s)
    this.ui.stats({
      km: this.s / 1000,
      ele: p[2],
      frac: this.s / this.route.total,
      modeKey: mo.mode,
      modeLabel: mo.label,
      next: next ? { title: next.items[0].title, km: (next.s - this.s) / 1000 } : null,
      // Füllstand des Anzeige-Balkens auf der Foto-Karte (steht bei Pause)
      holdFrac: this.photoShown === true ? Math.min(this.holdT / HOLD_HIDE, 1) : null,
    })
    // Tempo-Anzeige (Button) mit Faktor + Richtung aktuell halten — auch nach
    // JKL-Shuttle oder automatischem Stopp am Streckenanfang
    this.ui.onSpeed?.(this.mult, this.dir)
  }
}
