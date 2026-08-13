// DOM-Schicht: Overlays, Steuerleiste, Höhenprofil, Telemetrie. Keine Map-Logik.
import { pointAt, type Route, type Stopp, type StoppFoto } from './geo.js'
import type { Wegpunkt } from './tours.js'
import { videoLautstaerke, videoTonHuelle } from './audiotracks.js'
import { HOLD_HIDE, klemmeSeitenverhaeltnis } from './einblendung.js'

/**
 * Ein Medium, wie die Anzeige es braucht — Foto ODER Video (M4). Bewusst das
 * Subset, das diese Datei und die Engine anfassen: die volle Form steht in
 * `RemoteMedium` (src/remote.ts) bzw. `TourFoto` (src/tours.ts); `s` kommt aus
 * der Verankerung in main.ts (nearestS).
 */
export interface PlayerMedium extends StoppFoto {
  src: string
  title: string
  caption: string
  /** fehlt bei den statischen Touren — dort ist alles ein Foto */
  type?: 'photo' | 'video'
  /** Standbild eines Videos (auch Quelle des Seitenverhältnisses) */
  poster?: string
  /** Kachel-Fassung für den Pin-Kopf */
  thumb?: string
  /** Anzeige-Optionen aus dem Studio (Kreativbaukasten) */
  display?: { holdS?: number; kenBurns?: boolean }
}

/** Ein Halt: Streckenmeter des ersten Mediums plus alles, was dort gezeigt wird. */
export type PlayerStopp = Stopp<PlayerMedium>

/** Was die Engine pro Telemetrie-Takt (10 Hz) meldet. */
export interface Telemetrie {
  km: number
  ele: number
  /** Streckenanteil 0..1 — Fortschrittsleiste und Playhead */
  frac: number
  /** Nächster Halt oder null (Intro/Finale, hinter dem letzten Halt) */
  next: { title: string; km: number } | null
  modeKey: string
  /** Füllstand des Anzeige-Balkens; null = Video (ui füllt ihn aus der Videozeit) */
  holdFrac: number | null
}

/**
 * `requestVideoFrameCallback` steht nicht in jeder lib.dom-Fassung und fehlt in
 * manchen Browsern ganz — deshalb die schmale Erweiterung statt einer Zusage.
 */
type VideoMitFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number
}

/**
 * Pflicht-Element aus [erlebnis.html](../erlebnis.html) — fehlt es, ist der Player kaputt.
 * Exportiert, weil der Verdrahter (main.ts) auf dasselbe DOM zugreift und die
 * benannte Meldung dort genauso zählt wie hier.
 */
export const $ = <T extends Element = HTMLElement>(id: string): T => {
  const el = document.getElementById(id)
  if (!el) throw new Error(`Player-DOM: #${id} fehlt (erlebnis.html)`)
  return el as unknown as T
}

export const pflicht = <T extends Element>(wurzel: Element, wahl: string): T => {
  const el = wurzel.querySelector(wahl)
  if (!el) throw new Error(`Player-DOM: ${wahl} fehlt (erlebnis.html)`)
  return el as T
}

const fmtDE = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 })

const PROFILE_SAMPLES = 140
const VB_H = 30 // viewBox-Höhe des Profil-SVGs

export class UI {
  stops: PlayerStopp[]
  route: Route
  total: number
  spotSync: ((s: number) => void) | null
  els: {
    intro: HTMLElement
    dock: HTMLElement
    layer: HTMLElement
    card: HTMLElement
    frame: HTMLElement
    img: HTMLImageElement
    video: VideoMitFrameCallback
    standbild: HTMLImageElement
    sound: HTMLButtonElement
    flash: HTMLElement
    pTitle: HTMLElement
    pSub: HTMLElement
    pChip: HTMLElement
    pCount: HTMLElement
    holdFill: HTMLElement
    finale: HTMLElement
    profileBase: SVGPathElement
    profileFill: SVGPathElement
    progRect: SVGRectElement
    head: HTMLElement
    dots: HTMLElement
    teleKm: HTMLElement
    teleEle: HTMLElement
    nextStop: HTMLElement
    nextName: HTMLElement
    nextKm: HTMLElement
    blink: HTMLElement
    iconPlay: SVGElement
    iconPause: SVGElement
  }
  profileY: number[] = []

  /** Vom Verdrahter (main.ts) gesetzt — Fahrer-Marker und Spur pro Frame. */
  updateTrace!: (s: number, pos: Wegpunkt) => void
  /** Moduswechsel: Marker-Icon + Motorloop (main.ts) */
  onModeChange?: (mode: string) => void
  /** 10-Hz-Takt, z. B. Tag/Nacht-Regie */
  onTick?: (frac: number) => void
  /** Tempo-Anzeige (Faktor + Richtung) */
  onSpeed?: (mult: number, dir: number) => void
  /** Video-Ton-Hülle 0..1 → Musik-Ducking */
  onVideoTon: ((huelle: number) => void) | null
  /** Video am Stopp durchgelaufen → weiter wie nach abgelaufenem Foto-HOLD */
  onMediaEnded?: () => void

  private _lastSyncS: number
  private _preloaded: Set<number>
  private _preloadImgs: HTMLImageElement[]
  private _soundOn: boolean
  private _videoTonGemeldet: number
  private _standbildTimer: number
  private _standbildGen: number
  private _mode?: string

  constructor(stops: PlayerStopp[], route: Route) {
    this.stops = stops // [{ s, items: [Foto, …] }]
    this.route = route
    this.total = route.total
    this.spotSync = null // GL-Wegpunkte, via registerSpots()
    const card = $('photo-card')
    this.els = {
      intro: $('intro'),
      dock: $('dock'),
      layer: $('photo-layer'),
      card,
      // .photo-frame trägt keine id — Träger der Ken-Burns-Klasse/-Dauer (display)
      frame: pflicht<HTMLElement>(card, '.photo-frame'),
      img: $<HTMLImageElement>('photo-img'),
      video: $<VideoMitFrameCallback>('photo-video'),
      standbild: $<HTMLImageElement>('photo-video-standbild'),
      sound: $<HTMLButtonElement>('photo-sound'),
      flash: $('photo-flash'),
      pTitle: $('photo-title'),
      pSub: $('photo-sub'),
      pChip: $('photo-chip'),
      pCount: $('photo-count'),
      holdFill: $('photo-hold-fill'),
      finale: $('finale'),
      profileBase: $<SVGPathElement>('profile-base'),
      profileFill: $<SVGPathElement>('profile-fill'),
      progRect: $<SVGRectElement>('prog-rect'),
      head: $('progress-head'),
      dots: $('progress-dots'),
      teleKm: $('tele-km'),
      teleEle: $('tele-ele'),
      nextStop: $('next-stop'),
      nextName: $('next-stop-name'),
      nextKm: $('next-stop-km'),
      blink: $('blink'),
      iconPlay: $<SVGElement>('icon-play'),
      iconPause: $<SVGElement>('icon-pause'),
    }
    this.buildProfile()
    this.buildDots()
    this._lastSyncS = -1
    this._preloaded = new Set()
    this._preloadImgs = [] // Referenzen halten, sonst darf der Browser abbrechen

    // Video-Stopps (M4): Die Ton-Wahl bleibt für die Session gemerkt. Ende des
    // Videos → onMediaEnded stößt denselben Weiter-Pfad an wie ein abgelaufenes
    // Foto-HOLD (main.ts → tour.ts).
    // Ton AN als Vorgabe: Der Player startet immer erst nach einem Klick auf
    // „Tour starten" — damit gilt die Nutzergeste, die Browser für Autoplay mit
    // Ton verlangen. Nur ein explizites „aus" in der Session überschreibt das.
    // Wo Unmuted-Play doch scheitert, schaltet der Fallback in setPhotoContent
    // stumm und spielt weiter, statt gar nichts zu zeigen.
    this._soundOn = true
    this._videoTonGemeldet = -1 // gerundeter Hüllen-Pegel; -1 = noch nie gemeldet
    this.onVideoTon = null // (huelle: 0..1) → Musik-Ducking in main.ts
    this._standbildTimer = 0
    this._standbildGen = 0 // verwirft veraltete Frame-Callbacks nach Stopp/Wechsel
    try {
      const gemerkt = sessionStorage.getItem('maptale:video-sound')
      if (gemerkt !== null) this._soundOn = gemerkt === '1'
    } catch { /* Storage kann in restriktiven Kontexten fehlen */ }
    this.els.video.addEventListener('ended', () => {
      this._aktualisiereVideoTon()
      this.onMediaEnded?.()
    })
    // Kann das Video nicht abspielen (Dekodierfehler, unspielbarer Codec), darf
    // die Tour nicht am Stopp hängen bleiben — weiter wie bei einem Video-Ende.
    this.els.video.addEventListener('error', () => this.onMediaEnded?.())
    this.els.video.addEventListener('timeupdate', () => {
      // Fortschrittsbalken folgt der Videozeit (tour.ts liefert holdFrac=null,
      // rührt den Balken bei Videos also nicht an)
      const v = this.els.video
      if (v.duration > 0) this.els.holdFill.style.transform = `scaleX(${(v.currentTime / v.duration).toFixed(3)})`
      this._aktualisiereVideoTon()
    })
    this.els.sound.addEventListener('click', (e) => {
      e.stopPropagation() // nicht die Foto-Karte anhalten (deren Klick pausiert)
      this._soundOn = !this._soundOn
      this.els.video.muted = !this._soundOn
      if (this._soundOn) this.els.video.play().catch(() => {})
      try {
        sessionStorage.setItem('maptale:video-sound', this._soundOn ? '1' : '0')
      } catch { /* ignorieren */ }
      this._syncSoundBtn()
      this._aktualisiereVideoTon()
    })
    // play/pause: Hülle + Ducking nachziehen (timeupdate deckt den laufenden Clip ab)
    for (const ev of ['play', 'pause'] as const) {
      this.els.video.addEventListener(ev, () => this._aktualisiereVideoTon())
    }
  }

  // Läuft das sichtbare Video gerade mit Ton? (nicht stumm, nicht pausiert)
  _videoTonLaeuft(): boolean {
    const v = this.els.video
    return !v.hidden && !!v.getAttribute('src') && !v.muted && !v.paused
  }

  /**
   * Video-Lautstärke nach Hülle (Ein-/Ausblende) setzen und Musik-Ducking melden.
   * Die Hülle steuert beides — so crossfadet Video-Ton mit der Hintergrundmusik.
   */
  _aktualisiereVideoTon(): void {
    const v = this.els.video
    let huelle = 0
    if (this._videoTonLaeuft() && v.duration > 0 && Number.isFinite(v.duration)) {
      huelle = videoTonHuelle(v.currentTime, v.duration)
      const laut = videoLautstaerke(huelle)
      // Nur setzen, wenn nötig — sonst feuert mancher Browser volumechange im Kreis
      if (Math.abs(v.volume - laut) > 0.004) v.volume = laut
    } else if (v.getAttribute('src') && v.volume !== 0) {
      v.volume = 0
    }
    const gerundet = Math.round(huelle * 100) / 100
    if (gerundet === this._videoTonGemeldet) return
    this._videoTonGemeldet = gerundet
    this.onVideoTon?.(gerundet)
  }

  _syncSoundBtn(): void {
    const { sound } = this.els
    sound.setAttribute('aria-pressed', this._soundOn ? 'true' : 'false')
    pflicht<HTMLElement>(sound, '.ico-muted').hidden = this._soundOn
    pflicht<HTMLElement>(sound, '.ico-sound').hidden = !this._soundOn
  }

  // Laufendes Video anhalten und die Ressource freigeben (Stopp-Wechsel/Ausblenden)
  _stopVideo(): void {
    this._standbildGen++ // ausstehende Frame-Callbacks verwerfen
    clearTimeout(this._standbildTimer)
    const { video: v, standbild } = this.els
    standbild.hidden = true
    standbild.classList.remove('weg')
    standbild.removeAttribute('src')
    if (!v.getAttribute('src')) {
      this._aktualisiereVideoTon()
      return
    }
    v.pause()
    v.removeAttribute('src')
    v.removeAttribute('poster')
    v.load()
    this._aktualisiereVideoTon()
  }

  // Ersten Video-Frame abwarten, dann Standbild weich ausblenden — ohne das
  // springt der Browser hart von Standbild/Poster auf den dekodierten Frame.
  _warteAufErstenFrame(video: VideoMitFrameCallback, gen: number): void {
    let fertig = false
    const weiter = () => {
      if (fertig || gen !== this._standbildGen) return
      fertig = true
      this._videoStandbildWeg(gen)
    }
    if (typeof video.requestVideoFrameCallback === 'function') {
      video.requestVideoFrameCallback(() => weiter())
    }
    video.addEventListener('playing', () => {
      // Fallback ohne rvfc: zwei rAFs ≈ Frame ist auf dem Screen
      requestAnimationFrame(() => requestAnimationFrame(weiter))
    }, { once: true })
    // Notausgang: lieber Standbild weg als ewig darüber hängen
    clearTimeout(this._standbildTimer)
    this._standbildTimer = window.setTimeout(weiter, 1500)
  }

  _videoStandbildWeg(gen: number): void {
    if (gen !== this._standbildGen) return
    const { standbild } = this.els
    if (standbild.hidden) return
    standbild.classList.add('weg')
    clearTimeout(this._standbildTimer)
    this._standbildTimer = window.setTimeout(() => {
      if (gen !== this._standbildGen) return
      standbild.hidden = true
      standbild.classList.remove('weg')
      standbild.removeAttribute('src')
    }, 240)
  }

  // Fotos gestaffelt vorladen: immer nur den nächsten und übernächsten Stopp —
  // alle auf einmal (bis ~14 MB) würden beim Start mit den Karten-Tiles um
  // die Bandbreite konkurrieren
  preloadStop(i: number): void {
    const st = this.stops[i]
    if (!st || this._preloaded.has(i)) return
    this._preloaded.add(i)
    for (const p of st.items) {
      // Video-Stopps laden ihr Poster vor — daraus setzen wir beim Öffnen sofort
      // das Seitenverhältnis und das Standbild (kein Sprung auf 3:2).
      const url = p.type === 'video' ? p.poster : p.src
      if (!url) continue
      const img = new Image()
      img.src = url
      this._preloadImgs.push(img)
    }
  }

  // Höhenprofil der Route als Flächenpfad (viewBox 0..100 × 0..30)
  buildProfile(): void {
    const ys: number[] = []
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
  yAt(frac: number): number {
    const x = Math.max(0, Math.min(1, frac)) * (PROFILE_SAMPLES - 1)
    const i = Math.min(Math.floor(x), PROFILE_SAMPLES - 2)
    // Die Indizes liegen per Konstruktion im Feld (0 … SAMPLES−1)
    const y = this.profileY[i]! + (this.profileY[i + 1]! - this.profileY[i]!) * (x - i)
    return (y / VB_H) * 100
  }

  buildDots(): void {
    for (const st of this.stops) {
      const frac = st.s / this.total
      const dot = document.createElement('button')
      dot.className = 'photo-dot'
      dot.style.left = `${frac * 100}%`
      dot.style.top = `${this.yAt(frac)}%`
      dot.title = st.items.map((p) => p.title).join(' · ')
      dot.dataset.s = String(st.s)
      this.els.dots.appendChild(dot)
    }
  }

  /** Alle Timeline-Punkte — `children` ist live, die Punkte sind hier gebaut. */
  private get punkte(): HTMLCollectionOf<HTMLElement> {
    return this.els.dots.children as HTMLCollectionOf<HTMLElement>
  }

  registerSpots(syncFn: (s: number) => void): void {
    this.spotSync = syncFn // (s) => Feature-States der GL-Wegpunkte setzen
  }

  // Nach dem Eintreffen echter DEM-Höhen: Profil und Dot-Positionen neu aufbauen
  rebuildProfile(): void {
    this.buildProfile()
    for (const dot of this.punkte) {
      dot.style.top = `${this.yAt(Number(dot.dataset.s) / this.total)}%`
    }
  }

  syncDots(s: number): void {
    this._lastSyncS = s
    let nextFound = false
    for (const dot of this.punkte) {
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

  hideIntro(): void {
    this.els.intro.classList.add('gone')
    this.els.dock.hidden = false
    void this.els.dock.offsetWidth // Reflow, damit die Einblende-Transition greift
    this.els.dock.classList.add('up')
    this.setPlaying(true)
  }

  showIntro(): void {
    this.els.intro.classList.remove('gone')
  }

  // Zurück ins Hauptmenü: Intro wieder zeigen, Tour-UI komplett einziehen
  showMenu(): void {
    this.els.dock.classList.remove('up')
    this.els.dock.hidden = true
    this.showIntro()
  }

  setPlaying(on: boolean): void {
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
    // play/pause-Events aktualisieren die Hülle; hier zusätzlich, falls play() synchron scheitert
    this._aktualisiereVideoTon()
  }

  /**
   * Laufendes Video anhalten/weiterlaufen lassen, OHNE den Wiedergabe-Zustand
   * anzufassen (kein „Angehalten"-Abzeichen, kein Icon-Wechsel).
   *
   * Für die Seite im Hintergrund: `setPlaying(false)` wäre dort falsch — der
   * Nutzer hat nichts angehalten, er hat den Tab gewechselt, und beim
   * Zurückkommen soll der Film weiterlaufen, nicht pausiert dastehen. Das
   * Video braucht den Griff trotzdem: Es hängt an der Wanduhr des Browsers und
   * liefe sonst durch, während die Filmuhr steht (src/filmuhr.ts).
   */
  setzeVideoLauf(on: boolean): void {
    const v = this.els.video
    if (v.hidden || !v.getAttribute('src')) return
    if (on) v.play().catch(() => {})
    else v.pause()
    this._aktualisiereVideoTon()
  }

  setPhotoContent(photo: PlayerMedium, idx: number, count: number): void {
    const { frame, img, video, standbild, sound, pTitle, pSub, pChip, pCount } = this.els
    const istVideo = photo.type === 'video'
    // Anzeige-Optionen aus dem Studio (Kreativbaukasten): Ken-Burns abschaltbar,
    // die Drift-Dauer folgt der Anzeigedauer (holdS + Ausblende) — der Drift
    // läuft so nie vor der Karte aus. Default (7 s) bleibt ohne display identisch.
    frame.classList.toggle('kein-kb', photo.display?.kenBurns === false)
    frame.style.setProperty('--kb-dauer', `${(photo.display?.holdS ?? HOLD_HIDE) + 1.8}s`)
    // Seitenverhältnis erst setzen, wenn das neue Medium vermessen ist — das alte
    // --photo-ar belassen (kein Zwischen-Reset auf 3:2), sonst springt der Rahmen.
    const merkeSeitenverhaeltnis = (el: HTMLImageElement | HTMLVideoElement) => {
      const bild = el instanceof HTMLImageElement
      const b = bild ? el.naturalWidth : el.videoWidth
      const h = bild ? el.naturalHeight : el.videoHeight
      const ar = klemmeSeitenverhaeltnis(b, h)
      if (ar === null) return
      frame.style.setProperty('--photo-ar', ar.toFixed(4))
    }
    if (istVideo) {
      this._stopVideo() // ein evtl. noch laufendes Video sauber ablösen
      img.hidden = true
      video.hidden = false
      sound.hidden = false
      video.muted = !this._soundOn
      video.volume = 0 // Einblendung übernimmt _aktualisiereVideoTon ab dem ersten Frame
      this._syncSoundBtn()
      // Poster als eigenes Standbild (nicht video.poster): Rahmen-AR sofort aus dem
      // oft schon vorgeladenen JPEG, und weicher Übergang zum ersten Frame.
      const gen = this._standbildGen
      if (photo.poster) {
        standbild.classList.remove('weg')
        standbild.hidden = false
        standbild.src = photo.poster
        if (standbild.complete && standbild.naturalWidth) merkeSeitenverhaeltnis(standbild)
        else standbild.addEventListener('load', () => merkeSeitenverhaeltnis(standbild), { once: true })
      } else {
        standbild.hidden = true
      }
      video.addEventListener('loadedmetadata', () => merkeSeitenverhaeltnis(video), { once: true })
      this._warteAufErstenFrame(video, gen)
      video.src = photo.src
      video.play().catch(() => {
        // Unmuted-Autoplay ohne frische Nutzergeste wird geblockt → stumm
        // erzwingen, damit das Video überhaupt läuft und 'ended' feuert; sonst
        // bliebe die Tour am Video-Stopp stehen. Button zeigt „stumm", ein Klick
        // schaltet den Ton dann nach der Gesten-Regel wieder ein.
        video.muted = true
        this._soundOn = false
        this._syncSoundBtn()
        video.play().catch(() => {})
        this._aktualisiereVideoTon()
      })
      this._aktualisiereVideoTon()
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
    // „12.3 km" statt „KM 12.3": Die Chips stehen jetzt in Satzschrift, das
    // vorangestellte Versal-Kürzel war Teil des alten Sperrsatz-Etiketts.
    pChip.textContent = `${(photo.s / 1000).toFixed(1)} km`
    pCount.hidden = count < 2
    pCount.textContent = `${istVideo ? 'Video' : 'Foto'} ${idx + 1}/${count}`
  }

  showPhoto(photo: PlayerMedium, idx: number, count: number): void {
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
  swapPhoto(photo: PlayerMedium, idx: number, count: number): void {
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

  hidePhoto(): void {
    const { layer, card } = this.els
    this._stopVideo() // Video anhalten + Ressource freigeben (+ Ducking aus)
    this.els.video.hidden = true
    this.els.sound.hidden = true
    card.classList.remove('in')
    card.classList.remove('held')
    layer.classList.remove('show')
    layer.setAttribute('aria-hidden', 'true')
    document.body.classList.remove('cinema')
    this._aktualisiereVideoTon()
  }

  showFinale(): void {
    this.els.finale.hidden = false
    void this.els.finale.offsetWidth
    this.els.finale.classList.add('in')
  }

  hideFinale(): void {
    this.els.finale.classList.remove('in')
    this.els.finale.hidden = true
  }

  blink(cb: () => void): void {
    this.els.blink.classList.add('on')
    setTimeout(cb, 240)
    setTimeout(() => this.els.blink.classList.remove('on'), 650)
  }

  stats({ km, ele, frac, next, modeKey, holdFrac }: Telemetrie): void {
    this.els.teleKm.textContent = `${km.toFixed(1)} km`
    this.els.teleEle.textContent = `${fmtDE.format(ele)} m`
    if (holdFrac != null) this.els.holdFill.style.transform = `scaleX(${holdFrac.toFixed(3)})`
    // Der Modus wird nicht mehr angezeigt, aber weiter verfolgt: an der Kante
    // hängen Marker-Icon und Motorloop (onModeChange in main.ts).
    if (modeKey && modeKey !== this._mode) {
      this._mode = modeKey
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
    this.onTick?.(frac) // z.B. Tag/Nacht-Regie (main.ts), läuft im 10-Hz-Takt
  }
}
