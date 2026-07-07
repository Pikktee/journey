// DOM-Schicht: Overlays, Steuerleiste, Höhenprofil, Telemetrie. Keine Map-Logik.
import { pointAt } from './geo.js'

const $ = (id) => document.getElementById(id)
const fmtDE = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 })

const PROFILE_SAMPLES = 140
const VB_H = 30 // viewBox-Höhe des Profil-SVGs

export class UI {
  constructor(stops, route) {
    this.stops = stops // [{ s, items: [Foto, …] }]
    this.route = route
    this.total = route.total
    this.spotSync = null // GL-Wegpunkte, via registerSpots()
    this.els = {
      intro: $('intro'),
      dock: $('dock'),
      layer: $('photo-layer'),
      card: $('photo-card'),
      img: $('photo-img'),
      flash: $('photo-flash'),
      pTitle: $('photo-title'),
      pSub: $('photo-sub'),
      pChip: $('photo-chip'),
      pCount: $('photo-count'),
      holdFill: $('photo-hold-fill'),
      finale: $('finale'),
      profileBase: $('profile-base'),
      profileFill: $('profile-fill'),
      progRect: $('prog-rect'),
      head: $('progress-head'),
      dots: $('progress-dots'),
      teleKm: $('tele-km'),
      teleEle: $('tele-ele'),
      teleMode: $('tele-mode'),
      nextStop: $('next-stop'),
      nextName: $('next-stop-name'),
      nextKm: $('next-stop-km'),
      blink: $('blink'),
      iconPlay: $('icon-play'),
      iconPause: $('icon-pause'),
    }
    this.buildProfile()
    this.buildDots()
    this._lastSyncS = -1
    this._preloaded = new Set()
    this._preloadImgs = [] // Referenzen halten, sonst darf der Browser abbrechen
  }

  // Fotos gestaffelt vorladen: immer nur den nächsten und übernächsten Stopp —
  // alle auf einmal (bis ~14 MB) würden beim Start mit den Karten-Tiles um
  // die Bandbreite konkurrieren
  preloadStop(i) {
    const st = this.stops[i]
    if (!st || this._preloaded.has(i)) return
    this._preloaded.add(i)
    for (const p of st.items) {
      const img = new Image()
      img.src = p.src
      this._preloadImgs.push(img)
    }
  }

  // Höhenprofil der Route als Flächenpfad (viewBox 0..100 × 0..30)
  buildProfile() {
    const ys = []
    let minE = Infinity
    let maxE = -Infinity
    for (let i = 0; i < PROFILE_SAMPLES; i++) {
      const ele = pointAt(this.route, (this.total * i) / (PROFILE_SAMPLES - 1))[2]
      ys.push(ele)
      minE = Math.min(minE, ele)
      maxE = Math.max(maxE, ele)
    }
    // Mindest-Spanne: flache Touren (Stockholm ~30 m) sollen als sanfte Linie
    // erscheinen, nicht als voll skaliertes DEM-Rauschen
    const span = Math.max(maxE - minE, 150)
    this.profileY = ys.map((e) => 3 + (VB_H - 8) * (1 - (e - minE) / span)) // 3..25, Basis 30
    const pts = this.profileY.map((y, i) => `L${((i / (PROFILE_SAMPLES - 1)) * 100).toFixed(2)},${y.toFixed(2)}`).join(' ')
    const d = `M0,${VB_H} ${pts} L100,${VB_H} Z`
    this.els.profileBase.setAttribute('d', d)
    this.els.profileFill.setAttribute('d', d)
  }

  // Y-Position (in % der Leistenhöhe) an Streckenanteil frac
  yAt(frac) {
    const x = Math.max(0, Math.min(1, frac)) * (PROFILE_SAMPLES - 1)
    const i = Math.min(Math.floor(x), PROFILE_SAMPLES - 2)
    const y = this.profileY[i] + (this.profileY[i + 1] - this.profileY[i]) * (x - i)
    return (y / VB_H) * 100
  }

  buildDots() {
    for (const st of this.stops) {
      const frac = st.s / this.total
      const dot = document.createElement('button')
      dot.className = 'photo-dot'
      dot.style.left = `${frac * 100}%`
      dot.style.top = `${this.yAt(frac)}%`
      dot.title = st.items.map((p) => p.title).join(' · ')
      dot.dataset.s = st.s
      this.els.dots.appendChild(dot)
    }
  }

  registerSpots(syncFn) {
    this.spotSync = syncFn // (s) => Feature-States der GL-Wegpunkte setzen
  }

  // Nach dem Eintreffen echter DEM-Höhen: Profil und Dot-Positionen neu aufbauen
  rebuildProfile() {
    this.buildProfile()
    for (const dot of this.els.dots.children) {
      dot.style.top = `${this.yAt(Number(dot.dataset.s) / this.total)}%`
    }
  }

  syncDots(s) {
    this._lastSyncS = s
    let nextFound = false
    for (const dot of this.els.dots.children) {
      const done = Number(dot.dataset.s) <= s + 200
      dot.classList.toggle('seen', done)
      dot.classList.toggle('is-next', !done && !nextFound && (nextFound = true))
    }
    this.spotSync?.(s)
    // 300 m Vorlauf: auch der Stopp, dessen Anfahrt gerade beginnt, zählt noch
    const n = this.stops.findIndex((st) => st.s >= s - 300)
    if (n !== -1) {
      this.preloadStop(n)
      this.preloadStop(n + 1)
    }
  }

  hideIntro() {
    this.els.intro.classList.add('gone')
    $('btn-ui').hidden = false // der UI-Toggle gehört zur Tour, nicht zum Intro
    $('btn-music').hidden = false // Musik-Toggle ebenso (schwebt unter dem UI-Toggle)
    this.els.dock.hidden = false
    void this.els.dock.offsetWidth // Reflow, damit die Einblende-Transition greift
    this.els.dock.classList.add('up')
    this.setPlaying(true)
  }

  showIntro() {
    this.els.intro.classList.remove('gone')
  }

  // Zurück ins Hauptmenü: Intro wieder zeigen, Tour-UI komplett einziehen
  showMenu() {
    this.els.dock.classList.remove('up')
    this.els.dock.hidden = true
    $('btn-ui').hidden = true
    $('btn-music').hidden = true
    this.showIntro()
  }

  setPlaying(on) {
    // SVG-Elemente haben keine hidden-Property (nur HTMLElement) — die
    // Zuweisung war ein wirkungsloses Expando, das Icon wechselte nie
    this.els.iconPlay.toggleAttribute('hidden', on)
    this.els.iconPause.toggleAttribute('hidden', !on)
    // Angehaltene Foto-Karte kennzeichnen (Badge „Angehalten“)
    this.els.card.classList.toggle('held', !on)
  }

  setPhotoContent(photo, idx, count) {
    const { img, pTitle, pSub, pChip, pCount } = this.els
    img.src = photo.src
    img.alt = photo.title
    pTitle.textContent = photo.title
    pSub.textContent = photo.caption
    pChip.textContent = `KM ${(photo.s / 1000).toFixed(1)}`
    pCount.hidden = count < 2
    pCount.textContent = `Foto ${idx + 1}/${count}`
  }

  showPhoto(photo, idx, count) {
    const { layer, card, flash } = this.els
    this.setPhotoContent(photo, idx, count)
    this.els.holdFill.style.transform = 'scaleX(0)'
    layer.classList.add('show')
    layer.setAttribute('aria-hidden', 'false')
    document.body.classList.add('cinema')
    // Blitz + Karten-Transition sicher neu starten
    flash.classList.remove('on')
    void flash.offsetWidth
    flash.classList.add('on')
    void card.offsetWidth
    card.classList.add('in')
    this.syncDots(photo.s)
  }

  // Nächstes Foto am selben Halt: Inhalt kurz aus- und wieder einblenden
  swapPhoto(photo, idx, count) {
    const { card, img } = this.els
    card.classList.add('swapping')
    this.els.holdFill.style.transform = 'scaleX(0)'
    setTimeout(() => {
      this.setPhotoContent(photo, idx, count)
      // Ken-Burns-Drift und „Entwickeln“ für das neue Bild neu starten
      img.style.transition = 'none'
      img.style.animation = 'none'
      img.style.transform = 'scale(1.12)'
      void img.offsetWidth
      img.style.transition = ''
      img.style.animation = ''
      img.style.transform = ''
      card.classList.remove('swapping')
    }, 260)
  }

  hidePhoto() {
    const { layer, card } = this.els
    card.classList.remove('in')
    card.classList.remove('held')
    layer.classList.remove('show')
    layer.setAttribute('aria-hidden', 'true')
    document.body.classList.remove('cinema')
  }

  showFinale() {
    this.els.finale.hidden = false
    void this.els.finale.offsetWidth
    this.els.finale.classList.add('in')
  }

  hideFinale() {
    this.els.finale.classList.remove('in')
    this.els.finale.hidden = true
  }

  blink(cb) {
    this.els.blink.classList.add('on')
    setTimeout(cb, 240)
    setTimeout(() => this.els.blink.classList.remove('on'), 650)
  }

  stats({ km, ele, frac, next, modeKey, modeLabel, holdFrac }) {
    this.els.teleKm.textContent = `${km.toFixed(1)} km`
    this.els.teleEle.textContent = `${fmtDE.format(ele)} m`
    if (holdFrac != null) this.els.holdFill.style.transform = `scaleX(${holdFrac.toFixed(3)})`
    if (modeKey && modeKey !== this._mode) {
      this._mode = modeKey
      this.els.teleMode.textContent = modeLabel
      this.onModeChange?.(modeKey)
    }
    this.els.progRect.setAttribute('width', (frac * 100).toFixed(2))
    this.els.head.style.left = `${frac * 100}%` // Playhead: vertikale Linie, nur X
    if (next) {
      this.els.nextStop.hidden = false
      this.els.nextName.textContent = next.title
      this.els.nextKm.textContent = next.km < 0.1 ? 'jetzt' : `in ${next.km.toFixed(1)} km`
    } else {
      this.els.nextStop.hidden = true
    }
    const s = frac * this.total
    if (Math.abs(s - this._lastSyncS) > 60) this.syncDots(s)
    this.onTick?.(frac) // z.B. Tag/Nacht-Regie (main.js), läuft im 10-Hz-Takt
  }
}
