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
      // .photo-frame trägt keine id — Träger der Ken-Burns-Klasse/-Dauer (display)
      frame: $('photo-card').querySelector('.photo-frame'),
      img: $('photo-img'),
      video: $('photo-video'),
      sound: $('photo-sound'),
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

    // Video-Stopps (M4): Ton ist Opt-in (Autoplay-Policy erzwingt muted), die
    // Wahl bleibt für die Session gemerkt. Ende des Videos → onMediaEnded stößt
    // denselben Weiter-Pfad an wie ein abgelaufenes Foto-HOLD (main.js → tour.js).
    this._soundOn = false
    try {
      this._soundOn = sessionStorage.getItem('luhambo:video-sound') === '1'
    } catch { /* Storage kann in restriktiven Kontexten fehlen */ }
    this.els.video.addEventListener('ended', () => this.onMediaEnded?.())
    // Kann das Video nicht abspielen (Dekodierfehler, unspielbarer Codec), darf
    // die Tour nicht am Stopp hängen bleiben — weiter wie bei einem Video-Ende.
    this.els.video.addEventListener('error', () => this.onMediaEnded?.())
    this.els.video.addEventListener('timeupdate', () => {
      // Fortschrittsbalken folgt der Videozeit (tour.js liefert holdFrac=null,
      // rührt den Balken bei Videos also nicht an)
      const v = this.els.video
      if (v.duration > 0) this.els.holdFill.style.transform = `scaleX(${(v.currentTime / v.duration).toFixed(3)})`
    })
    this.els.sound.addEventListener('click', (e) => {
      e.stopPropagation() // nicht die Foto-Karte anhalten (deren Klick pausiert)
      this._soundOn = !this._soundOn
      this.els.video.muted = !this._soundOn
      if (this._soundOn) this.els.video.play().catch(() => {})
      try {
        sessionStorage.setItem('luhambo:video-sound', this._soundOn ? '1' : '0')
      } catch { /* ignorieren */ }
      this._syncSoundBtn()
    })

    // Solange das Intro offen ist, blendet die Brand oben links aus (sonst stehen
    // Ort + Route doppelt: groß im Hero UND oben links). Sie kommt mit dem Tour-Start.
    document.body.classList.add('intro-open')
  }

  _syncSoundBtn() {
    const { sound } = this.els
    sound.setAttribute('aria-pressed', this._soundOn ? 'true' : 'false')
    sound.querySelector('.ico-muted').hidden = this._soundOn
    sound.querySelector('.ico-sound').hidden = !this._soundOn
  }

  // Laufendes Video anhalten und die Ressource freigeben (Stopp-Wechsel/Ausblenden)
  _stopVideo() {
    const v = this.els.video
    if (!v.getAttribute('src')) return
    v.pause()
    v.removeAttribute('src')
    v.load()
  }

  // Fotos gestaffelt vorladen: immer nur den nächsten und übernächsten Stopp —
  // alle auf einmal (bis ~14 MB) würden beim Start mit den Karten-Tiles um
  // die Bandbreite konkurrieren
  preloadStop(i) {
    const st = this.stops[i]
    if (!st || this._preloaded.has(i)) return
    this._preloaded.add(i)
    for (const p of st.items) {
      // Video-Stopps laden ihr Poster vor (das Video selbst holt der <video>-Tag
      // beim Anzeigen per preload="metadata" — ein Vollabruf wäre Verschwendung)
      const url = p.type === 'video' ? p.poster : p.src
      if (!url) continue
      const img = new Image()
      img.src = url
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
      // „Besucht" erst, wenn der Playhead den Punkt tatsächlich erreicht hat
      // (kleiner 25-m-Vorlauf, damit der Zustand exakt mit dem Einblenden der
      // Foto-Karte kippt) — NICHT mehr 200 m davor. So ist die Timeline ehrlich:
      // der Amber-Fortschrittsbalken und der gefüllte Punkt laufen gemeinsam vorbei.
      const visited = Number(dot.dataset.s) <= s + 25
      dot.classList.toggle('seen', visited)
      dot.classList.toggle('is-next', !visited && !nextFound && (nextFound = true))
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
    document.body.classList.remove('intro-open') // Brand oben links jetzt einblenden
    $('btn-ui').hidden = false // der UI-Toggle gehört zur Tour, nicht zum Intro
    this.els.dock.hidden = false
    void this.els.dock.offsetWidth // Reflow, damit die Einblende-Transition greift
    this.els.dock.classList.add('up')
    this.setPlaying(true)
  }

  showIntro() {
    this.els.intro.classList.remove('gone')
    document.body.classList.add('intro-open') // im Menü wieder die Brand-Dopplung vermeiden
  }

  // Zurück ins Hauptmenü: Intro wieder zeigen, Tour-UI komplett einziehen
  showMenu() {
    this.els.dock.classList.remove('up')
    this.els.dock.hidden = true
    $('btn-ui').hidden = true
    this.showIntro()
  }

  setPlaying(on) {
    // SVG-Elemente haben keine hidden-Property (nur HTMLElement) — die
    // Zuweisung war ein wirkungsloses Expando, das Icon wechselte nie
    this.els.iconPlay.toggleAttribute('hidden', on)
    this.els.iconPause.toggleAttribute('hidden', !on)
    // Angehaltene Foto-Karte kennzeichnen (Badge „Angehalten“)
    this.els.card.classList.toggle('held', !on)
    // Video-Stopp: Pause/Weiter hält auch das laufende Video an bzw. weiter
    const v = this.els.video
    if (!v.hidden && v.getAttribute('src')) {
      if (on) v.play().catch(() => {})
      else v.pause()
    }
  }

  setPhotoContent(photo, idx, count) {
    const { frame, img, video, sound, pTitle, pSub, pChip, pCount } = this.els
    const istVideo = photo.type === 'video'
    // Anzeige-Optionen aus dem Studio (Kreativbaukasten): Ken-Burns abschaltbar,
    // die Drift-Dauer folgt der Anzeigedauer (holdS + Ausblende) — der Drift
    // läuft so nie vor der Karte aus. Default (7 s) bleibt ohne display identisch.
    frame.classList.toggle('kein-kb', photo.display?.kenBurns === false)
    frame.style.setProperty('--kb-dauer', `${(photo.display?.holdS ?? 5.2) + 1.8}s`)
    // Rahmen aufs echte Seitenverhältnis stellen (s. --photo-ar in style.css) —
    // ohne das schneidet der starre 3:2-Rahmen aus einem Hochformat-Foto einen
    // Mittelstreifen heraus. Zurück auf 3:2, bis das neue Medium vermessen ist.
    frame.style.removeProperty('--photo-ar')
    const merkeSeitenverhaeltnis = (el) => {
      const b = el.naturalWidth || el.videoWidth
      const h = el.naturalHeight || el.videoHeight
      if (!b || !h) return
      // Deckeln: extreme Panoramen/Hochformate sonst breiter/höher als die Bühne
      const ar = Math.max(0.62, Math.min(1.85, b / h))
      frame.style.setProperty('--photo-ar', ar.toFixed(4))
    }
    if (istVideo) {
      this._stopVideo() // ein evtl. noch laufendes Video sauber ablösen
      img.hidden = true
      video.hidden = false
      sound.hidden = false
      if (photo.poster) video.poster = photo.poster
      video.muted = !this._soundOn
      this._syncSoundBtn()
      video.addEventListener('loadedmetadata', () => merkeSeitenverhaeltnis(video), { once: true })
      video.src = photo.src
      video.play().catch(() => {
        // Unmuted-Autoplay ohne frische Nutzergeste wird geblockt (Ton-Opt-in aus
        // der Session) → stumm erzwingen, damit das Video überhaupt läuft und
        // 'ended' feuert; sonst bliebe die Tour am Video-Stopp stehen.
        video.muted = true
        video.play().catch(() => {})
      })
    } else {
      this._stopVideo()
      video.hidden = true
      sound.hidden = true
      img.hidden = false
      img.src = photo.src
      img.alt = photo.title
      // Aus dem Cache ist das Bild sofort vollständig — dann feuert onload nicht mehr
      if (img.complete) merkeSeitenverhaeltnis(img)
      else img.addEventListener('load', () => merkeSeitenverhaeltnis(img), { once: true })
    }
    pTitle.textContent = photo.title
    pSub.textContent = photo.caption
    pChip.textContent = `KM ${(photo.s / 1000).toFixed(1)}`
    pCount.hidden = count < 2
    pCount.textContent = `${istVideo ? 'Video' : 'Foto'} ${idx + 1}/${count}`
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
    const { card, frame, img } = this.els
    card.classList.add('swapping')
    this.els.holdFill.style.transform = 'scaleX(0)'
    setTimeout(() => {
      this.setPhotoContent(photo, idx, count)
      // „Entwickeln“-Blende (animation) für das neue Bild IMMER neu starten —
      // sie ist die Foto-Signatur, unabhängig von Ken Burns. Der Drift-Reset
      // (transform/transition) bleibt auf Ken-Burns-Bilder beschränkt: bei
      // kein-kb würde der Inline-Reset scale(1.12) hart erzwingen.
      const mitKb = !frame.classList.contains('kein-kb')
      img.style.animation = 'none'
      if (mitKb) {
        img.style.transition = 'none'
        img.style.transform = 'scale(1.12)'
      }
      void img.offsetWidth
      img.style.animation = ''
      if (mitKb) {
        img.style.transition = ''
        img.style.transform = ''
      }
      card.classList.remove('swapping')
    }, 260)
  }

  hidePhoto() {
    const { layer, card } = this.els
    this._stopVideo() // Video anhalten + Ressource freigeben
    this.els.video.hidden = true
    this.els.sound.hidden = true
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
