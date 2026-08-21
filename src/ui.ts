// DOM-Schicht: Overlays, Steuerleiste, Höhenprofil, Telemetrie. Keine Map-Logik.
import { pointAt, type Route, type Stop, type StopItem } from './geo.js'
import type { Waypoint } from './tours.js'
import { rampedVolume, videoVolume, videoVolumeEnvelope } from './audiotracks.js'
import {
  trimmedDurationS,
  clampAspectRatio,
  VIDEO_HAS_FRAME,
  videoSeekDecision,
  videoPositionS,
} from './card-timing.js'
import { createCardLayer, type CardLayer } from './card-layer.js'
import type { CardMedium, CardSource, CardText } from './card-painter.js'

/**
 * Ein Medium, wie die Anzeige es braucht — Foto ODER Video (M4). Bewusst das
 * Subset, das diese Datei und die Engine anfassen: die volle Form steht in
 * `RemoteMedium` (src/remote.ts) bzw. `TourFoto` (src/tours.ts); `s` kommt aus
 * der Verankerung in main.ts (nearestS).
 */
export interface PlayerMedium extends StopItem {
  src: string
  title: string
  /** fehlt bei den statischen Touren — dort ist alles ein Foto */
  type?: 'photo' | 'video'
  /**
   * Aufnahmezeit (ISO mit Offset). Nur aufgezeichnete Touren haben sie; die
   * Karte zeigt daraus die Uhrzeit neben dem Kilometerstand, genau wie der
   * Editor. Vorher stand sie als TEXT in `caption` und damit unter dem Titel,
   * wo sie wie eine Bildunterschrift aussah.
   */
  takenAt?: string
  /** Standbild eines Videos (auch Quelle des Seitenverhältnisses) */
  poster?: string
  /** Kachel-Fassung für den Pin-Kopf */
  thumb?: string
  /** Anzeige-Optionen aus dem Studio (Kreativbaukasten) */
  display?: { holdS?: number; kenBurns?: boolean }
}

/** Ein Halt: Streckenmeter des ersten Mediums plus alles, was dort gezeigt wird. */
export type PlayerStop = Stop<PlayerMedium>

/**
 * Was die Engine pro Telemetrie-Takt (10 Hz) meldet.
 *
 * **Zwei Anteile, zwei Namen.** `frac` ist eine Auskunft über den ORT
 * (Sonnenstand, Pseudo-Uhrzeit, Wetter-Regie, `next.km`, `syncDots`), `filmFrac`
 * eine über die ZEIT (Balken, Playhead, Profil-x, Dot-x). Ein Halt kostet
 * Filmzeit, ohne Strecke zu kosten — dort laufen die beiden auseinander, und
 * genau dort entstehen die Fehler. Deshalb gibt es kein Feld, das beides heißt.
 */
export interface Telemetry {
  km: number
  ele: number
  /** Streckenanteil 0..1 — alles, was den ORT meint */
  frac: number
  /** Filmanteil 0..1 — alles, was die ZEIT meint (Leiste, Playhead, Profil) */
  filmFrac: number
  /** Nächster Halt oder null (Intro/Finale, hinter dem letzten Halt) */
  next: { title: string; km: number } | null
  modeKey: string
}

/**
 * Was die Leiste von der Filmachse braucht.
 *
 * Bewusst ein eigenes, schmales Gegenstück zu `FilmTrack` (src/tour.ts) statt
 * eines Imports: `tour.ts` importiert aus dieser Datei, und die Anzeige braucht
 * von der Achse nur die drei Rechnungen, mit denen sie ihre x-Achse aufspannt.
 */
export interface ProgressBar {
  /** Gesamtdauer des Films in Sekunden */
  totalS: number
  /** Streckenmeter zu einer Filmsekunde — spannt Profil und Halt-Flächen auf */
  sAtFilmTime: (filmS: number) => number
  /** Filmsekunde an einem Streckenmeter (im Halt: seine Ankunft) */
  filmTimeAtS: (s: number) => number
  /** Der Halt, in dem diese Filmsekunde steht — `null` heißt Fahrt */
  stopAtFilmTime: (filmS: number) => { filmFrom: number; filmTo: number } | null
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

export const requireElement = <T extends Element>(root: Element, choice: string): T => {
  const el = root.querySelector(choice)
  if (!el) throw new Error(`Player-DOM: ${choice} fehlt (erlebnis.html)`)
  return el as T
}

const fmtDE = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 })

const PROFILE_SAMPLES = 140
const VB_H = 30 // viewBox-Höhe des Profil-SVGs

export class UI {
  stops: PlayerStop[]
  route: Route
  total: number
  /** Die Filmachse, wie die Anzeige sie liest — die Leiste ist filmlinear */
  film: ProgressBar
  spotSync: ((s: number) => void) | null
  els: {
    intro: HTMLElement
    dock: HTMLElement
    layer: HTMLElement
    card: HTMLElement
    image: HTMLElement
    img: HTMLImageElement
    video: HTMLVideoElement
    poster: HTMLImageElement
    sound: HTMLButtonElement
    pTitle: HTMLElement
    pChip: HTMLElement
    pCount: HTMLElement
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
  updateTrace!: (s: number, pos: Waypoint) => void
  /** Moduswechsel: Marker-Icon + Motorloop (main.ts) */
  onModeChange?: (mode: string) => void
  /** 10-Hz-Takt, z. B. Tag/Nacht-Regie */
  onTick?: (frac: number) => void
  /** Tempo-Anzeige (Faktor + Richtung) */
  onSpeed?: (mult: number, dir: number) => void
  /** Video-Ton-Hülle 0..1 → Musik-Ducking */
  onVideoAudio: ((envelope: number) => void) | null
  /** Video am Stopp durchgelaufen → weiter wie nach abgelaufenem Foto-HOLD */
  onMediaEnded?: () => void

  private _lastSyncS: number
  private _preloaded: Set<number>
  private _preloadImgs: HTMLImageElement[]
  /** Vorab geholte Video-Köpfe (s. `_weckeVideo`). */
  private _wokenVideos: HTMLVideoElement[]
  private _soundOn: boolean
  private _videoAudioReported: number
  /** Die Leinwand der Foto-Karte — der eine Aufrufer des Malers. */
  private cardLayer: CardLayer
  /** Was auf der Karte liegt: Medium und Beschriftung, DOM-frei als Werte. */
  private _cardMedium: CardMedium
  private _cardText: CardText
  private _posterGen: number
  /** Hat das laufende Video schon je einen Frame geliefert? (s. `_kartenQuelle`) */
  private _videoHadFrame: boolean
  /** Wanduhr-Marke des letzten begonnenen Suchlaufs (`performance.now()`). */
  private _lastSeekAt: number
  /** Geführter Pegel des Video-Tons 0..1 (s. `gerampterPegel`). */
  private _videoEnvelope: number
  /** Wanduhr-Marke des letzten Pegel-Schritts (`performance.now()`). */
  private _videoVolumeAt: number
  /** Läuft diese Seite als Export-Takt? (`body.export`) */
  private _inExport: boolean
  private _mode?: string

  /**
   * Zone der Tour (`cfg.time.zone`) — für die Uhrzeit auf der Karte. Ohne sie
   * rechnete `Intl` in die Zone des BETRACHTERS um, und eine Tour in Thailand
   * zeigte in Frankfurt eine andere Uhrzeit als im Studio.
   */
  timeZone: string | null = null

  /**
   * Zeitspanne der Tour (`cfg.time`) in ms — die Uhrzeit erscheint NUR, wenn die
   * Aufnahmezeit darin liegt. Der Befund stammt aus der Pipeline und ist mit der
   * Uhrzeit hierher gewandert: Wo kein EXIF steht, fällt die App auf die
   * Dateizeit zurück, und die kann Tage neben der Tour liegen. „14:32 Uhr" wäre
   * dann eine Angabe, die nichts mit der Aufnahme zu tun hat.
   */
  timeWindow: [number, number] | null = null

  constructor(stops: PlayerStop[], route: Route, film: ProgressBar) {
    this.stops = stops // [{ s, items: [Foto, …] }]
    this.route = route
    this.total = route.total
    this.film = film
    this.spotSync = null // GL-Wegpunkte, via registerSpots()
    const card = $('photo-card')
    this.els = {
      intro: $('intro'),
      dock: $('dock'),
      layer: $('photo-layer'),
      card,
      image: $('photo-image'),
      img: $<HTMLImageElement>('photo-img'),
      video: $<HTMLVideoElement>('photo-video'),
      poster: $<HTMLImageElement>('photo-video-still'),
      sound: $<HTMLButtonElement>('photo-sound'),
      pTitle: $('photo-title'),
      pChip: $('photo-chip'),
      pCount: $('photo-count'),
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
    this._wokenVideos = []

    // Video-Stopps (M4): Die Ton-Wahl bleibt für die Session gemerkt. Ende des
    // Videos → onMediaEnded stößt denselben Weiter-Pfad an wie ein abgelaufenes
    // Foto-HOLD (main.ts → tour.ts).
    // Ton AN als Vorgabe: Der Player startet immer erst nach einem Klick auf
    // „Tour starten" — damit gilt die Nutzergeste, die Browser für Autoplay mit
    // Ton verlangen. Nur ein explizites „aus" in der Session überschreibt das.
    // Wo Unmuted-Play doch scheitert, schaltet der Fallback in setPhotoContent
    // stumm und spielt weiter, statt gar nichts zu zeigen.
    this._soundOn = true
    this._videoAudioReported = -1 // gerundeter Hüllen-Pegel; -1 = noch nie gemeldet
    this._cardMedium = { kind: 'photo', ar: null }
    this._cardText = { title: '', kmText: '', counterText: '' }
    // Die Leinwand hängt am body wie Wetter und Atmosphäre; ihren Platz in der
    // Schichtung bestimmt das CSS (`.card-canvas`, z-index 12).
    this.cardLayer = createCardLayer({
      container: document.body,
      controls: { card: this.els.card, image: this.els.image },
      // Der Schleier liegt unter der Leinwand und bekommt seine Deckkraft aus
      // der Filmzeit — er ist das, was den Halt seit dem Rückbau des
      // Kamerablitzes markiert.
      scrim: document.getElementById('photo-backdrop'),
      inExport: document.body.classList.contains('export'),
    })
    this.onVideoAudio = null // (huelle: 0..1) → Musik-Ducking in main.ts
    this._posterGen = 0 // verwirft veraltete Poster-Rückrufe nach Stopp/Wechsel
    this._videoHadFrame = false
    this._lastSeekAt = -Infinity
    this._videoEnvelope = 0
    this._videoVolumeAt = 0
    this._inExport = document.body.classList.contains('export')
    try {
      const remembered = sessionStorage.getItem('maptale:video-sound')
      if (remembered !== null) this._soundOn = remembered === '1'
    } catch {
      /* Storage kann in restriktiven Kontexten fehlen */
    }
    // `ended` und `error` sind seit Etappe 4 nur noch Notausgänge: Der Halt
    // endet an der ACHSE, nicht am Dateiende (tour.ts, `onMediaEnded`).
    this.els.video.addEventListener('ended', () => this.onMediaEnded?.())
    this.els.video.addEventListener('error', () => this.onMediaEnded?.())
    this.els.sound.addEventListener('click', (e) => {
      e.stopPropagation() // nicht die Foto-Karte anhalten (deren Klick pausiert)
      this._soundOn = !this._soundOn
      this.els.video.muted = !this._soundOn
      try {
        sessionStorage.setItem('maptale:video-sound', this._soundOn ? '1' : '0')
      } catch {
        /* ignorieren */
      }
      this._syncSoundBtn()
      // Pegel und Ducking zieht der nächste Kopfschritt nach (synchronisiereKarte).
    })
  }

  /**
   * Musik-Ducking melden — nur an der Kante des gerundeten Pegels.
   * Die Hülle steuert beides: Video-Lautstärke UND das Absenken der Musik.
   */
  private _reportVideoAudio(envelope: number): void {
    const rounded = Math.round(envelope * 100) / 100
    if (rounded === this._videoAudioReported) return
    this._videoAudioReported = rounded
    this.onVideoAudio?.(rounded)
  }

  _syncSoundBtn(): void {
    const { sound } = this.els
    sound.setAttribute('aria-pressed', this._soundOn ? 'true' : 'false')
    requireElement<HTMLElement>(sound, '.ico-muted').hidden = this._soundOn
    requireElement<HTMLElement>(sound, '.ico-sound').hidden = !this._soundOn
  }

  // Laufendes Video anhalten und die Ressource freigeben (Stopp-Wechsel/Ausblenden)
  _stopVideo(): void {
    this._posterGen++ // ausstehende Poster-Rückrufe verwerfen
    const { video: v, poster } = this.els
    poster.hidden = true
    poster.removeAttribute('src')
    this._videoHadFrame = false
    this._lastSeekAt = -Infinity
    this._videoEnvelope = 0
    this._videoVolumeAt = 0
    this._reportVideoAudio(0)
    if (!v.getAttribute('src')) return
    v.pause()
    v.removeAttribute('src')
    v.removeAttribute('poster')
    v.load()
  }

  // Fotos gestaffelt vorladen: immer nur den nächsten und übernächsten Stopp —
  // alle auf einmal (bis ~14 MB) würden beim Start mit den Karten-Tiles um
  // die Bandbreite konkurrieren
  preloadStop(i: number, withVideo = false): void {
    const st = this.stops[i]
    if (!st || this._preloaded.has(i)) return
    this._preloaded.add(i)
    for (const p of st.items) {
      // Video-Stopps laden ihr Poster vor — daraus setzen wir beim Öffnen sofort
      // das Seitenverhältnis und das Standbild (kein Sprung auf 3:2).
      const url = p.type === 'video' ? p.poster : p.src
      if (url) {
        const img = new Image()
        img.src = url
        this._preloadImgs.push(img)
      }
      if (withVideo && p.type === 'video' && p.src) this._wakeVideo(p.src)
    }
  }

  /**
   * Den Kopf eines Videos schon vor dem Halt holen.
   *
   * Das Video-Element bekommt seine Datei erst, wenn der Halt beginnt — auf dem
   * Telefon über Mobilfunk vergeht danach rund eine Sekunde, bis der erste
   * Frame steht, und genau in dieser Sekunde lief die Karte vorher leer. Hier
   * wird nur der KOPF geholt (`metadata`), nicht die ganze Datei: Ein Halt kann
   * zwei Videos haben, und `auto` zöge zweistellige Megabytes neben den
   * Kartenkacheln, um dieselbe Bandbreite. Der HTTP-Cache der Medien ist
   * `immutable` (server/src/routes/media.ts) — das eigentliche Element findet
   * den Kopf also vor.
   *
   * Die Elemente werden gehalten, weil ein eingesammeltes Element seinen Abruf
   * abbricht; mehr als vier sind es nie, sonst hingen an einer Tour mit vielen
   * Videos beliebig viele Puffer.
   */
  private _wakeVideo(src: string): void {
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.muted = true
    v.playsInline = true
    v.src = src
    this._wokenVideos.push(v)
    while (this._wokenVideos.length > 4) {
      const alt = this._wokenVideos.shift()
      if (!alt) break
      alt.removeAttribute('src')
      alt.load()
    }
  }

  /**
   * Höhenprofil der Route als Flächenpfad (viewBox 0..100 × 0..30) — abgetastet
   * in gleichen FILM-Schritten, nicht in gleichen Metern.
   *
   * Die Leiste ist seit Etappe 5 die Zeitachse des Films, und das Profil ist
   * ihre Kurve: Wo der Film steht, steht auch sie. Halte werden dadurch von
   * selbst zu flachen Plateaus, und ein langsamer Fußweg bekommt die Breite,
   * die er im Film einnimmt — sonst zeigte die Kurve an einer Stelle eine Höhe,
   * die der Playhead darüber zu einer ganz anderen Zeit erreicht.
   */
  buildProfile(): void {
    const ys: number[] = []
    let minE = Infinity
    let maxE = -Infinity
    for (let i = 0; i < PROFILE_SAMPLES; i++) {
      const s = this.film.sAtFilmTime((this.film.totalS * i) / (PROFILE_SAMPLES - 1))
      const ele = pointAt(this.route, s)[2]
      ys.push(ele)
      minE = Math.min(minE, ele)
      maxE = Math.max(maxE, ele)
    }
    // Mindest-Spanne: flache Touren (Stockholm ~30 m) sollen als sanfte Linie
    // erscheinen, nicht als voll skaliertes DEM-Rauschen
    const span = Math.max(maxE - minE, 150)
    this.profileY = ys.map((e) => 3 + (VB_H - 8) * (1 - (e - minE) / span)) // 3..25, Basis 30
    const pts = this.profileY
      .map((y, i) => `L${((i / (PROFILE_SAMPLES - 1)) * 100).toFixed(2)},${y.toFixed(2)}`)
      .join(' ')
    const d = `M0,${VB_H} ${pts} L100,${VB_H} Z`
    this.els.profileBase.setAttribute('d', d)
    this.els.profileFill.setAttribute('d', d)
  }

  // Y-Position (in % der Leistenhöhe) an einem FILManteil — das Profil ist
  // filmäquidistant abgetastet, ein Streckenanteil träfe hier den falschen Punkt
  yAt(filmFrac: number): number {
    const x = Math.max(0, Math.min(1, filmFrac)) * (PROFILE_SAMPLES - 1)
    const i = Math.min(Math.floor(x), PROFILE_SAMPLES - 2)
    // Die Indizes liegen per Konstruktion im Feld (0 … SAMPLES−1)
    const y = this.profileY[i]! + (this.profileY[i + 1]! - this.profileY[i]!) * (x - i)
    return (y / VB_H) * 100
  }

  /**
   * Halte auf die Leiste zeichnen: je Halt eine FLÄCHE und einen Punkt.
   *
   * Die Fläche ist die Filmzeit, die der Halt kostet — ohne sie liefe der
   * Playhead über ihn hinweg, während das Bild steht (genau der Defekt, den die
   * Studio-Zeitleiste am 2026-08-05 verlassen hat). Sie ist bewusst
   * `pointer-events: none`: Wäre sie der Griff, spränge ein Tipp in ihrer Mitte
   * auf die ANKUNFT des Halts — dann wäre die Breite zwar zu sehen, aber nicht
   * anzufahren. So zieht ein Scrub quer durch sie hindurch und landet auf der
   * Filmsekunde, die man getroffen hat (E15 zeigt dort das Bild).
   *
   * Der Punkt bleibt der Griff und sitzt am BEGINN des Halts: „hier kommt man
   * an" ist die Stelle, die ein Sprung meint.
   */
  buildDots(): void {
    for (const st of this.stops) {
      const from = this.film.filmTimeAtS(st.s)
      const stop = this.film.stopAtFilmTime(from)
      const filmFrac = from / this.film.totalS
      const width = stop ? (stop.filmTo - stop.filmFrom) / this.film.totalS : 0
      if (width > 0) {
        const span = document.createElement('div')
        span.className = 'stop-span'
        span.style.left = `${filmFrac * 100}%`
        span.style.width = `${width * 100}%`
        this.els.dots.appendChild(span)
      }
      const dot = document.createElement('button')
      dot.className = 'photo-dot'
      dot.style.left = `${filmFrac * 100}%`
      dot.style.top = `${this.yAt(filmFrac)}%`
      dot.title = st.items.map((p) => p.title).join(' · ')
      dot.dataset.s = String(st.s)
      dot.dataset.filmFrac = String(filmFrac)
      this.els.dots.appendChild(dot)
    }
  }

  /**
   * Alle Timeline-Punkte. Ausdrücklich nur die Knöpfe: Im selben Container
   * liegen seit Etappe 5 auch die Halt-Flächen, und die tragen kein `dataset.s`.
   */
  private get dotEls(): NodeListOf<HTMLElement> {
    return this.els.dots.querySelectorAll<HTMLElement>('.photo-dot')
  }

  registerSpots(syncFn: (s: number) => void): void {
    this.spotSync = syncFn // (s) => Feature-States der GL-Wegpunkte setzen
  }

  // Nach dem Eintreffen echter DEM-Höhen: Profil und Dot-Positionen neu aufbauen
  rebuildProfile(): void {
    this.buildProfile()
    for (const dot of this.dotEls) {
      dot.style.top = `${this.yAt(Number(dot.dataset.filmFrac))}%`
    }
  }

  syncDots(s: number): void {
    this._lastSyncS = s
    let nextFound = false
    for (const dot of this.dotEls) {
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
      // Nur der NÄCHSTE Halt weckt sein Video: der übernächste liegt oft noch
      // Minuten entfernt, und zwei Köpfe gleichzeitig wären zwei Abrufe neben
      // den Kacheln, von denen einer sicher zu früh kommt.
      this.preloadStop(n, true)
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
    // Das laufende Video zieht `synchronisiereKarte` nach: Es läuft genau dann,
    // wenn die Filmzeit mit Tempo 1 vorwärts läuft — ein zweiter Griff hier
    // wäre eine zweite Wahrheit über denselben Zustand.
  }

  /**
   * Laufendes Video hart anhalten, OHNE den Wiedergabe-Zustand anzufassen
   * (kein „Angehalten"-Abzeichen, kein Icon-Wechsel).
   *
   * Für die Seite im Hintergrund: `setPlaying(false)` wäre dort falsch — der
   * Nutzer hat nichts angehalten, er hat den Tab gewechselt. Das Video braucht
   * den Griff trotzdem, und zwar aus dem Ereignis heraus: Es hängt an der
   * Wanduhr des Browsers, die Sync dagegen an `requestAnimationFrame` — und
   * genau das läuft im Hintergrund nicht mehr (src/film-clock.ts). Beim
   * Zurückkommen holt der nächste Kopfschritt das Video von selbst wieder.
   */
  pauseVideo(): void {
    const v = this.els.video
    if (!v.paused) v.pause()
    this._reportVideoAudio(0)
  }

  setPhotoContent(photo: PlayerMedium, idx: number, count: number): void {
    const { img, video, poster, sound, pTitle, pChip, pCount } = this.els
    const isVideo = photo.type === 'video'
    // Anzeige-Optionen aus dem Studio (Kreativbaukasten): Ken-Burns abschaltbar.
    // Die Drift-DAUER kommt nicht von hier, sondern aus der Filmzeit (die
    // Klip-Länge). Sie stand hier einmal auf `holdS + 1.8` gegen die 0,8 des
    // Editors — die 1-Sekunden-Abweichung aus §6C des Gleichlauf-Konzepts.
    this._cardMedium = {
      kind: isVideo ? 'video' : 'photo',
      // Das Seitenverhältnis des VORIGEN Mediums bleibt stehen, bis das neue
      // vermessen ist: Ein Zwischen-Reset auf 3:2 ließe den Rahmen zucken.
      ar: this._cardMedium.ar,
      ...(photo.display?.kenBurns === false ? { noKenBurns: true } : {}),
    }
    const rememberAspectRatio = (el: HTMLImageElement | HTMLVideoElement) => {
      const image = el instanceof HTMLImageElement
      const b = image ? el.naturalWidth : el.videoWidth
      const h = image ? el.naturalHeight : el.videoHeight
      const ar = clampAspectRatio(b, h)
      if (ar === null) return
      this._cardMedium = { ...this._cardMedium, ar }
    }
    if (isVideo) {
      this._stopVideo() // ein evtl. noch laufendes Video sauber ablösen
      img.hidden = true
      video.hidden = false
      sound.hidden = false
      video.muted = !this._soundOn
      video.volume = 0 // Einblendung übernimmt _aktualisiereVideoTon ab dem ersten Frame
      this._syncSoundBtn()
      // Poster als eigenes Standbild (nicht video.poster): Rahmen-AR sofort aus dem
      // oft schon vorgeladenen JPEG, und es überbrückt, bis der erste Frame da
      // ist. Es bleibt bis zum Stopp-Wechsel liegen — abgeräumt wird es NICHT
      // mehr nach einer Frist: Der Maler nimmt von selbst das Video, sobald es
      // einen Frame hat (`_kartenQuelle`), und die alte 1,5-s-Frist nahm auf dem
      // Telefon genau das Bild weg, das über das Laden hinweghalf. Danach stand
      // die Karte schwarz, bis das Video lief.
      const gen = this._posterGen
      if (photo.poster) {
        poster.hidden = false
        poster.src = photo.poster
        if (poster.complete && poster.naturalWidth) rememberAspectRatio(poster)
        else {
          poster.addEventListener(
            'load',
            () => {
              if (gen === this._posterGen) rememberAspectRatio(poster)
            },
            { once: true },
          )
        }
      } else {
        poster.hidden = true
      }
      video.addEventListener('loadedmetadata', () => rememberAspectRatio(video), { once: true })
      video.src = photo.src
      // Kein `play()` hier: Ob das Video läuft, sagt die FILMZEIT — der nächste
      // Kopfschritt startet es (synchronisiereKarte). Ein Start von hier aus
      // liefe beim Scrubben und rückwärts nach eigener Uhr.
    } else {
      this._stopVideo()
      video.hidden = true
      sound.hidden = true
      img.hidden = false
      img.src = photo.src
      img.alt = photo.title
      // Aus dem Cache ist das Bild sofort vollständig — dann feuert onload nicht mehr
      if (img.complete) rememberAspectRatio(img)
      else img.addEventListener('load', () => rememberAspectRatio(img), { once: true })
    }
    // Die Beschriftung geht ZWEIMAL heraus, und das ist Absicht: als Werte an
    // den Maler (er liest kein `textContent` — genau das war der Weg, auf dem
    // der Export bisher an die Texte kam) und als versteckte Kopie ins
    // Dokument, damit ein Screenreader sie weiter findet (Konzept §3.4/Falle 1).
    // „12.3 km" statt „KM 12.3": Die Pillen stehen in Satzschrift, das
    // vorangestellte Versal-Kürzel war Teil des alten Sperrsatz-Etiketts.
    //
    // Uhrzeit UND Kilometerstand stehen rechts auf der Titelzeile, wie im
    // Editor. Bis zum 2026-08-18 kam die Uhrzeit als fertiger TEXT vom Server
    // („Foto · 09:09") und landete in der Unterzeile, wo sie wie eine
    // Bildunterschrift aussah — dieselbe Aufnahme sah in Editor und Player
    // verschieden aus. Jetzt rechnet sie der Player aus `takenAt`; die
    // Unterzeile bleibt echten Bildunterschriften vorbehalten (die
    // kuratierten Touren haben sie).
    const km = `${(photo.s / 1000).toFixed(1).replace('.', ',')} km`
    const clock = this._clockTime(photo.takenAt)
    const kmText = clock ? `${clock} · ${km}` : km
    // Nur die Zählung, ohne das Wort „Foto"/„Video": Was man sieht, muss die
    // Karte nicht auch noch benennen. Was man NICHT sieht, ist, dass dieser Halt
    // mehrere Aufnahmen hat — das bleibt.
    const counterText = count < 2 ? '' : `${idx + 1}/${count}`
    this._cardText = { title: photo.title, kmText, counterText: counterText }
    pTitle.textContent = photo.title
    pChip.textContent = kmText
    pCount.hidden = !counterText
    pCount.textContent = counterText
  }

  /** „09:09 Uhr" in der Zone der Tour; leer, wenn die Aufnahmezeit fehlt. */
  private _clockTime(iso?: string): string {
    if (!iso) return ''
    const ms = Date.parse(iso)
    if (!Number.isFinite(ms)) return ''
    if (this.timeWindow && (ms < this.timeWindow[0] || ms > this.timeWindow[1])) return ''
    try {
      const f = new Intl.DateTimeFormat('de-DE', {
        hour: '2-digit',
        minute: '2-digit',
        ...(this.timeZone ? { timeZone: this.timeZone } : {}),
      })
      return `${f.format(new Date(iso))} Uhr`
    } catch {
      return ''
    }
  }

  /**
   * Die Zeichenquelle dieser Filmsekunde — Foto, Video oder das Poster, das ein
   * Video überbrückt, bis sein erster Frame da ist.
   *
   * `bereit` ist die Zusicherung, die der Maler braucht: `drawImage` auf einem
   * noch suchenden `<video>` zeichnet ohne Fehler das ALTE Bild (Konzept §5).
   * Der Maler zeichnet es trotzdem — das alte Bild ist auf der Bühne die
   * bessere Auskunft als ein schwarzes Feld —, und der Video-Export wartet
   * genau auf diese Zusicherung, bevor er ein Bild abgreift.
   *
   * **Sobald das Video einmal einen Frame geliefert hat, bleibt es die Quelle.**
   * `readyState` fällt bei einem Suchlauf und beim Nachpuffern wieder unter
   * `VIDEO_HAT_FRAME` zurück; ohne diesen Merker wechselte die Karte dort auf
   * das Poster und beim nächsten Frame zurück — auf dem Telefon (langsame
   * Suchläufe, Mobilfunk-Nachpuffern) war das ein Flackern zwischen zwei
   * Bildern. Das Poster überbrückt nur den Anfang, nicht jede Störung.
   */
  private _cardSource(): { source: CardSource | null; ready: boolean } {
    const { img, video, poster } = this.els
    if (!video.hidden && video.getAttribute('src')) {
      const hasFrame = video.readyState >= VIDEO_HAS_FRAME
      if (hasFrame) this._videoHadFrame = true
      if (video.videoWidth > 0 && (hasFrame || this._videoHadFrame)) {
        return {
          source: {
            image: video,
            width: video.videoWidth,
            height: video.videoHeight,
            key: video.src,
          },
          ready: hasFrame && !video.seeking,
        }
      }
      // Noch kein Frame: das Poster hält die Stelle. Es ist ein anderes Bild als
      // das Video, aber ein richtiges — ein leerer Rahmen wäre die schlechtere
      // Auskunft, und im Film wäre er ein schwarzes Feld.
      if (!poster.hidden && poster.complete && poster.naturalWidth > 0) {
        return {
          source: {
            image: poster,
            width: poster.naturalWidth,
            height: poster.naturalHeight,
            key: poster.src,
          },
          ready: true,
        }
      }
      return { source: null, ready: false }
    }
    if (!img.hidden && img.complete && img.naturalWidth > 0) {
      return {
        source: { image: img, width: img.naturalWidth, height: img.naturalHeight, key: img.src },
        ready: true,
      }
    }
    return { source: null, ready: false }
  }

  /** Stand der letzten Zeichnung — der Video-Export fragt danach (Konzept §5). */
  cardReady(): boolean {
    return this.cardLayer.ready()
  }

  /**
   * Abnahme-Griff: die Werte, aus denen die Leinwand gerade gemalt ist.
   *
   * Ein Screenshot zeigt das Bild, aber nicht seine Eingaben — und der
   * Bildvergleich der Etappe 2 braucht genau die, um denselben Stand ein zweites
   * Mal mit den Film-Einstellungen zu malen
   * (scripts/messungen/kartenleinwand.mjs).
   */
  cardFrame(): unknown {
    return this.cardLayer.frame()
  }

  /**
   * Die Karte für diese Aufnahme aufbauen und auf die Bühne legen.
   *
   * Der Auftritt wird hier NICHT gestartet — er ist eine dauerhaft pausierte
   * Animation, deren Fortschritt `synchronisiereKarte` aus der Filmzeit setzt.
   * Deshalb gibt es hier auch keine erzwungenen Reflows mehr: Es gibt nichts
   * „neu zu starten", der Stand kommt aus dem Delay.
   */
  showCard(photo: PlayerMedium, idx: number, count: number): void {
    const { layer } = this.els
    this.setPhotoContent(photo, idx, count)
    layer.classList.add('show')
    layer.setAttribute('aria-hidden', 'false')
    // Trägt den Schleier unter der Leinwand — der ist Geschwister der Schicht
    // und hängt deshalb am body, nicht an `.photo-layer.show`.
    document.body.classList.add('cinema')
    this.syncDots(photo.s)
  }

  /**
   * Die Karte auf den Stand DIESER Filmsekunde bringen (E15).
   *
   * `imS` ist der Stand im Klip, `dauerS` seine Länge (Standzeit + Ausblendung),
   * `tempo` der Faktor auf die Filmzeit — 1 = normale Fahrt, 0 = steht,
   * negativ = rückwärts. Alles Sichtbare hängt daran: Auftritt, „Entwickeln",
   * Ken-Burns-Zug, Abgang, Fortschrittsbalken und die Stelle im Video.
   *
   * Läuft in JEDEM Frame — deshalb werden die Variablen nur bei Änderung
   * geschrieben und die Video-Zeit nur bei merklicher Abweichung nachgezogen
   * (ein Seek je Frame ruckelt sichtbar).
   */
  syncCard(inS: number, durationS: number, speed: number): void {
    const { video } = this.els
    const { source, ready } = this._cardSource()
    this.cardLayer.paint({
      inS: inS,
      durationS: durationS,
      medium: this._cardMedium,
      text: this._cardText,
      source: source,
      ready: ready,
    })

    if (video.hidden || !video.getAttribute('src')) {
      this._reportVideoAudio(0)
      return
    }
    // Der Player liefert die GESCHNITTENE Datei aus — der Ausschnitt beginnt
    // bei 0. Kennt sie ihre Länge noch nicht, steht das Ende offen; die Klemme
    // greift dann erst mit `loadedmetadata`.
    const toS = video.duration > 0 && Number.isFinite(video.duration) ? video.duration : Infinity
    const { targetS, atEnd } = videoPositionS(0, toS, inS)
    // Ein Video kann nicht rückwärts spielen: Im Schnelllauf und rückwärts
    // steht es auf dem Frame der Kopfposition und schweigt — wie im Editor.
    const playing = speed === 1 && !atEnd
    // Die Entscheidung ist DOM-frei und mit dem Editor geteilt
    // (`videoSeekDecision` in card-timing.ts): Wann gesucht werden DARF, hängt
    // an einem laufenden Suchlauf, am Pufferstand und an der Wanduhr — ohne
    // diese drei Rückfragen wurde auf dem Telefon in jedem Frame neu gesucht
    // und keiner der Suchläufe kam je an.
    const decision = videoSeekDecision({
      targetS,
      isS: video.currentTime,
      playing: playing,
      paused: video.paused,
      seeking: video.seeking,
      readyState: video.readyState,
      sinceSeekS: (performance.now() - this._lastSeekAt) / 1000,
      frameExact: this._inExport,
    })
    if (decision.seek) this._setVideoTime(targetS)
    if (decision.play) {
      video.play().catch(() => {
        // Unmuted-Autoplay ohne frische Nutzergeste wird geblockt → stumm
        // erzwingen, damit das Bild überhaupt läuft; sonst stünde am
        // Video-Halt ein Standbild. Ein Klick auf den Ton-Knopf schaltet ihn
        // danach nach der Gesten-Regel wieder ein.
        video.muted = true
        this._soundOn = false
        this._syncSoundBtn()
        video.play().catch(() => {})
      })
    }
    if (decision.pause) video.pause()

    // Ton-Hülle über den Ausschnitt: Ein- und Ausblende liegen an den
    // Schnittkanten, und sie steuert zugleich das Ducking der Musik.
    // Geteilt mit dem Editor (`trimmedDurationS`): Der Player liefert die
    // geschnittene Fassung aus, sein linker Schnitt ist also 0.
    const trimS = trimmedDurationS(durationS, 0, toS)
    // Die Hülle wird von ZWEI Uhren geführt, und es gilt die kleinere: der
    // Filmzeit (dort liegen die Schnittkanten) und der Wiedergabeposition der
    // Datei. Die zweite ist der Knacks-Schutz — läuft das Video verspätet an,
    // steht die Filmzeit schon mitten im Klip, und der Ton setzte bisher mit
    // voller Lautstärke ein. Wer sucht oder noch keinen Frame hat, klingt gar
    // nicht: Dort gibt es nichts zu hören, was leiser werden könnte.
    const audible = playing && !video.muted && !video.seeking && video.readyState >= VIDEO_HAS_FRAME
    const target = audible
      ? Math.min(videoVolumeEnvelope(inS, trimS), videoVolumeEnvelope(video.currentTime, trimS))
      : 0
    // Und über beidem die Rampe — sie deckelt jeden Sprung, den ein Anlauf, ein
    // Suchlauf oder ein Tempowechsel sonst hart in den Pegel schriebe. Im Export
    // gibt es keine Wanduhr, die sie führen könnte (ein Filmbild kostet dort
    // 0,3–2 s), also steht dort der Zielwert.
    const now = performance.now()
    const dtS = (now - this._videoVolumeAt) / 1000
    this._videoVolumeAt = now
    this._videoEnvelope = this._inExport ? target : rampedVolume(this._videoEnvelope, target, dtS)
    const loud = videoVolume(this._videoEnvelope)
    // Nur bei Bedarf setzen — sonst feuert mancher Browser volumechange im Kreis
    if (Math.abs(video.volume - loud) > 0.004) video.volume = loud
    this._reportVideoAudio(this._videoEnvelope)
  }

  private _setVideoTime(second: number): void {
    // Die Marke wird VOR dem Sprung gesetzt: `videoSeekDecision` misst damit die
    // Ruhe zwischen zwei Suchläufen, und die beginnt mit dem Anstoß, nicht mit
    // dem Eintreffen. Auch ein fehlgeschlagener Sprung zählt — sonst versuchte
    // es der nächste Frame sofort wieder.
    this._lastSeekAt = performance.now()
    try {
      this.els.video.currentTime = Math.max(0, second)
    } catch {
      /* Seek vor dem Puffern kann fehlschlagen — der nächste Kopfschritt holt es nach */
    }
  }

  /** Die Karte wegnehmen — außerhalb jedes Halts und beim Verlassen der Tour. */
  hideCard(): void {
    const { layer, card } = this.els
    this._stopVideo() // Video anhalten + Ressource freigeben (+ Ducking aus)
    this.els.video.hidden = true
    this.els.sound.hidden = true
    card.classList.remove('held')
    layer.classList.remove('show')
    layer.setAttribute('aria-hidden', 'true')
    document.body.classList.remove('cinema')
    this.cardLayer.clear()
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

  stats({ km, ele, frac, filmFrac, next, modeKey }: Telemetry): void {
    this.els.teleKm.textContent = `${km.toFixed(1)} km`
    this.els.teleEle.textContent = `${fmtDE.format(ele)} m`
    // Der Modus wird nicht mehr angezeigt, aber weiter verfolgt: an der Kante
    // hängen Marker-Icon und Motorloop (onModeChange in main.ts).
    if (modeKey && modeKey !== this._mode) {
      this._mode = modeKey
      this.onModeChange?.(modeKey)
    }
    // Balken und Playhead laufen in FILMZEIT: Im Halt steht die Strecke, der
    // Film aber nicht — mit `frac` stünde der Kopf dort mehrere Sekunden still
    // und spränge danach über die Halt-Fläche.
    this.els.progRect.setAttribute('width', (filmFrac * 100).toFixed(2))
    this.els.head.style.left = `${filmFrac * 100}%` // Playhead: vertikale Linie, nur X
    if (next) {
      this.els.nextStop.hidden = false
      this.els.nextName.textContent = next.title
      this.els.nextKm.textContent = next.km < 0.1 ? 'jetzt' : `in ${next.km.toFixed(1)} km`
    } else {
      this.els.nextStop.hidden = true
    }
    // Ab hier wieder der ORT: Punkt-Zustände, Vorladen und die Tag/Nacht-Regie
    // fragen, wo man IST. Mit dem Filmanteil wanderte die Sonne im Halt weiter,
    // während der Film steht.
    const s = frac * this.total
    if (Math.abs(s - this._lastSyncS) > 60) this.syncDots(s)
    this.onTick?.(frac) // z.B. Tag/Nacht-Regie (main.ts), läuft im 10-Hz-Takt
  }
}
