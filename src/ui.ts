// DOM-Schicht: Overlays, Steuerleiste, Höhenprofil, Telemetrie. Keine Map-Logik.
import { pointAt, type Route, type Stopp, type StoppFoto } from './geo.js'
import type { Wegpunkt } from './tours.js'
import { videoLautstaerke, videoTonHuelle } from './audiotracks.js'
import { ausschnittDauerS, klemmeSeitenverhaeltnis, videoStandS } from './einblendung.js'
import { createKartenSchicht, type KartenSchicht } from './kartenschicht.js'
import type { KartenMedium, KartenQuelle, KartenText } from './kartenmaler.js'

/**
 * Ein Medium, wie die Anzeige es braucht — Foto ODER Video (M4). Bewusst das
 * Subset, das diese Datei und die Engine anfassen: die volle Form steht in
 * `RemoteMedium` (src/remote.ts) bzw. `TourFoto` (src/tours.ts); `s` kommt aus
 * der Verankerung in main.ts (nearestS).
 */
export interface PlayerMedium extends StoppFoto {
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
export type PlayerStopp = Stopp<PlayerMedium>

/**
 * Was die Engine pro Telemetrie-Takt (10 Hz) meldet.
 *
 * **Zwei Anteile, zwei Namen.** `frac` ist eine Auskunft über den ORT
 * (Sonnenstand, Pseudo-Uhrzeit, Wetter-Regie, `next.km`, `syncDots`), `filmFrac`
 * eine über die ZEIT (Balken, Playhead, Profil-x, Dot-x). Ein Halt kostet
 * Filmzeit, ohne Strecke zu kosten — dort laufen die beiden auseinander, und
 * genau dort entstehen die Fehler. Deshalb gibt es kein Feld, das beides heißt.
 */
export interface Telemetrie {
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
 * Bewusst ein eigenes, schmales Gegenstück zu `Filmspur` (src/tour.ts) statt
 * eines Imports: `tour.ts` importiert aus dieser Datei, und die Anzeige braucht
 * von der Achse nur die drei Rechnungen, mit denen sie ihre x-Achse aufspannt.
 */
export interface Filmleiste {
  /** Gesamtdauer des Films in Sekunden */
  gesamtS: number
  /** Streckenmeter zu einer Filmsekunde — spannt Profil und Halt-Flächen auf */
  sBeiFilm: (filmS: number) => number
  /** Filmsekunde an einem Streckenmeter (im Halt: seine Ankunft) */
  filmBeiS: (s: number) => number
  /** Der Halt, in dem diese Filmsekunde steht — `null` heißt Fahrt */
  haltBeiFilm: (filmS: number) => { filmVon: number; filmBis: number } | null
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
  /** Die Filmachse, wie die Anzeige sie liest — die Leiste ist filmlinear */
  film: Filmleiste
  spotSync: ((s: number) => void) | null
  els: {
    intro: HTMLElement
    dock: HTMLElement
    layer: HTMLElement
    card: HTMLElement
    bild: HTMLElement
    img: HTMLImageElement
    video: VideoMitFrameCallback
    standbild: HTMLImageElement
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
  /** Die Leinwand der Foto-Karte — der eine Aufrufer des Malers. */
  private karten: KartenSchicht
  /** Was auf der Karte liegt: Medium und Beschriftung, DOM-frei als Werte. */
  private _kartenMedium: KartenMedium
  private _kartenText: KartenText
  private _standbildTimer: number
  private _standbildGen: number
  private _mode?: string

  /**
   * Zone der Tour (`cfg.time.zone`) — für die Uhrzeit auf der Karte. Ohne sie
   * rechnete `Intl` in die Zone des BETRACHTERS um, und eine Tour in Thailand
   * zeigte in Frankfurt eine andere Uhrzeit als im Studio.
   */
  zeitzone: string | null = null

  /**
   * Zeitspanne der Tour (`cfg.time`) in ms — die Uhrzeit erscheint NUR, wenn die
   * Aufnahmezeit darin liegt. Der Befund stammt aus der Pipeline und ist mit der
   * Uhrzeit hierher gewandert: Wo kein EXIF steht, fällt die App auf die
   * Dateizeit zurück, und die kann Tage neben der Tour liegen. „14:32 Uhr" wäre
   * dann eine Angabe, die nichts mit der Aufnahme zu tun hat.
   */
  zeitfenster: [number, number] | null = null

  constructor(stops: PlayerStopp[], route: Route, film: Filmleiste) {
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
      bild: $('photo-bild'),
      img: $<HTMLImageElement>('photo-img'),
      video: $<VideoMitFrameCallback>('photo-video'),
      standbild: $<HTMLImageElement>('photo-video-standbild'),
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
    this._kartenMedium = { art: 'foto', ar: null }
    this._kartenText = { titel: '', kmText: '', zaehlerText: '' }
    // Die Leinwand hängt am body wie Wetter und Atmosphäre; ihren Platz in der
    // Schichtung bestimmt das CSS (`.karten-leinwand`, z-index 12).
    this.karten = createKartenSchicht({
      container: document.body,
      bedienung: { karte: this.els.card, bild: this.els.bild },
      // Der Schleier liegt unter der Leinwand und bekommt seine Deckkraft aus
      // der Filmzeit — er ist das, was den Halt seit dem Rückbau des
      // Kamerablitzes markiert.
      schleier: document.getElementById('photo-backdrop'),
      imExport: document.body.classList.contains('export'),
    })
    this.onVideoTon = null // (huelle: 0..1) → Musik-Ducking in main.ts
    this._standbildTimer = 0
    this._standbildGen = 0 // verwirft veraltete Frame-Callbacks nach Stopp/Wechsel
    try {
      const gemerkt = sessionStorage.getItem('maptale:video-sound')
      if (gemerkt !== null) this._soundOn = gemerkt === '1'
    } catch { /* Storage kann in restriktiven Kontexten fehlen */ }
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
      } catch { /* ignorieren */ }
      this._syncSoundBtn()
      // Pegel und Ducking zieht der nächste Kopfschritt nach (synchronisiereKarte).
    })
  }

  /**
   * Musik-Ducking melden — nur an der Kante des gerundeten Pegels.
   * Die Hülle steuert beides: Video-Lautstärke UND das Absenken der Musik.
   */
  private _meldeVideoTon(huelle: number): void {
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
    standbild.removeAttribute('src')
    this._meldeVideoTon(0)
    if (!v.getAttribute('src')) return
    v.pause()
    v.removeAttribute('src')
    v.removeAttribute('poster')
    v.load()
  }

  // Ersten Video-Frame abwarten, dann das Standbild abräumen.
  //
  // Seit die Karte auf einer Leinwand liegt, gibt es hier keine Überblendung
  // mehr: Der Maler nimmt das Standbild nur, SOLANGE das Video keinen Frame
  // liefert (`_kartenQuelle`), und schaltet danach von sich aus um. Die alte
  // 240-ms-Blende war eine CSS-Transition auf zwei gestapelten Elementen — von
  // denen keines mehr sichtbar ist.
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
    clearTimeout(this._standbildTimer)
    standbild.hidden = true
    standbild.removeAttribute('src')
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
      const s = this.film.sBeiFilm((this.film.gesamtS * i) / (PROFILE_SAMPLES - 1))
      const ele = pointAt(this.route, s)[2]
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
      const von = this.film.filmBeiS(st.s)
      const halt = this.film.haltBeiFilm(von)
      const filmFrac = von / this.film.gesamtS
      const breite = halt ? (halt.filmBis - halt.filmVon) / this.film.gesamtS : 0
      if (breite > 0) {
        const flaeche = document.createElement('div')
        flaeche.className = 'halt-flaeche'
        flaeche.style.left = `${filmFrac * 100}%`
        flaeche.style.width = `${breite * 100}%`
        this.els.dots.appendChild(flaeche)
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
  private get punkte(): NodeListOf<HTMLElement> {
    return this.els.dots.querySelectorAll<HTMLElement>('.photo-dot')
  }

  registerSpots(syncFn: (s: number) => void): void {
    this.spotSync = syncFn // (s) => Feature-States der GL-Wegpunkte setzen
  }

  // Nach dem Eintreffen echter DEM-Höhen: Profil und Dot-Positionen neu aufbauen
  rebuildProfile(): void {
    this.buildProfile()
    for (const dot of this.punkte) {
      dot.style.top = `${this.yAt(Number(dot.dataset.filmFrac))}%`
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
   * genau das läuft im Hintergrund nicht mehr (src/filmuhr.ts). Beim
   * Zurückkommen holt der nächste Kopfschritt das Video von selbst wieder.
   */
  haltVideoAn(): void {
    const v = this.els.video
    if (!v.paused) v.pause()
    this._meldeVideoTon(0)
  }

  setPhotoContent(photo: PlayerMedium, idx: number, count: number): void {
    const { img, video, standbild, sound, pTitle, pChip, pCount } = this.els
    const istVideo = photo.type === 'video'
    // Anzeige-Optionen aus dem Studio (Kreativbaukasten): Ken-Burns abschaltbar.
    // Die Drift-DAUER kommt nicht von hier, sondern aus der Filmzeit (die
    // Klip-Länge). Sie stand hier einmal auf `holdS + 1.8` gegen die 0,8 des
    // Editors — die 1-Sekunden-Abweichung aus §6C des Gleichlauf-Konzepts.
    this._kartenMedium = {
      art: istVideo ? 'video' : 'foto',
      // Das Seitenverhältnis des VORIGEN Mediums bleibt stehen, bis das neue
      // vermessen ist: Ein Zwischen-Reset auf 3:2 ließe den Rahmen zucken.
      ar: this._kartenMedium.ar,
      ...(photo.display?.kenBurns === false ? { keinKenBurns: true } : {}),
    }
    const merkeSeitenverhaeltnis = (el: HTMLImageElement | HTMLVideoElement) => {
      const bild = el instanceof HTMLImageElement
      const b = bild ? el.naturalWidth : el.videoWidth
      const h = bild ? el.naturalHeight : el.videoHeight
      const ar = klemmeSeitenverhaeltnis(b, h)
      if (ar === null) return
      this._kartenMedium = { ...this._kartenMedium, ar }
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
      if (img.complete) merkeSeitenverhaeltnis(img)
      else img.addEventListener('load', () => merkeSeitenverhaeltnis(img), { once: true })
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
    const uhr = this._uhrzeit(photo.takenAt)
    const kmText = uhr ? `${uhr} · ${km}` : km
    // Nur die Zählung, ohne das Wort „Foto"/„Video": Was man sieht, muss die
    // Karte nicht auch noch benennen. Was man NICHT sieht, ist, dass dieser Halt
    // mehrere Aufnahmen hat — das bleibt.
    const zaehlerText = count < 2 ? '' : `${idx + 1}/${count}`
    this._kartenText = { titel: photo.title, kmText, zaehlerText }
    pTitle.textContent = photo.title
    pChip.textContent = kmText
    pCount.hidden = !zaehlerText
    pCount.textContent = zaehlerText
  }

  /** „09:09 Uhr" in der Zone der Tour; leer, wenn die Aufnahmezeit fehlt. */
  private _uhrzeit(iso?: string): string {
    if (!iso) return ''
    const ms = Date.parse(iso)
    if (!Number.isFinite(ms)) return ''
    if (this.zeitfenster && (ms < this.zeitfenster[0] || ms > this.zeitfenster[1])) return ''
    try {
      const f = new Intl.DateTimeFormat('de-DE', {
        hour: '2-digit',
        minute: '2-digit',
        ...(this.zeitzone ? { timeZone: this.zeitzone } : {}),
      })
      return `${f.format(new Date(iso))} Uhr`
    } catch {
      return ''
    }
  }

  /**
   * Die Zeichenquelle dieser Filmsekunde — Foto, Video oder das Standbild, das
   * ein Video überbrückt, bis sein erster Frame da ist.
   *
   * `bereit` ist die Zusicherung, die der Maler braucht: `drawImage` auf einem
   * noch suchenden `<video>` zeichnet ohne Fehler das ALTE Bild (Konzept §5).
   */
  private _kartenQuelle(): { quelle: KartenQuelle | null; bereit: boolean } {
    const { img, video, standbild } = this.els
    if (!video.hidden && video.getAttribute('src')) {
      if (video.readyState >= 2 && video.videoWidth > 0) {
        return {
          quelle: { bild: video, breite: video.videoWidth, hoehe: video.videoHeight, kennung: video.src },
          bereit: !video.seeking,
        }
      }
      // Noch kein Frame: das Poster hält die Stelle. Es ist ein anderes Bild als
      // das Video, aber ein richtiges — ein leerer Rahmen wäre die schlechtere
      // Auskunft, und im Film wäre er ein schwarzes Feld.
      if (!standbild.hidden && standbild.complete && standbild.naturalWidth > 0) {
        return {
          quelle: { bild: standbild, breite: standbild.naturalWidth, hoehe: standbild.naturalHeight, kennung: standbild.src },
          bereit: true,
        }
      }
      return { quelle: null, bereit: false }
    }
    if (!img.hidden && img.complete && img.naturalWidth > 0) {
      return {
        quelle: { bild: img, breite: img.naturalWidth, hoehe: img.naturalHeight, kennung: img.src },
        bereit: true,
      }
    }
    return { quelle: null, bereit: false }
  }

  /** Stand der letzten Zeichnung — der Video-Export fragt danach (Konzept §5). */
  kartenBereit(): boolean {
    return this.karten.bereit()
  }

  /**
   * Abnahme-Griff: die Werte, aus denen die Leinwand gerade gemalt ist.
   *
   * Ein Screenshot zeigt das Bild, aber nicht seine Eingaben — und der
   * Bildvergleich der Etappe 2 braucht genau die, um denselben Stand ein zweites
   * Mal mit den Film-Einstellungen zu malen
   * (scripts/messungen/kartenleinwand.mjs).
   */
  kartenStand(): unknown {
    return this.karten.stand()
  }

  /**
   * Die Karte für diese Aufnahme aufbauen und auf die Bühne legen.
   *
   * Der Auftritt wird hier NICHT gestartet — er ist eine dauerhaft pausierte
   * Animation, deren Fortschritt `synchronisiereKarte` aus der Filmzeit setzt.
   * Deshalb gibt es hier auch keine erzwungenen Reflows mehr: Es gibt nichts
   * „neu zu starten", der Stand kommt aus dem Delay.
   */
  zeigeKarte(photo: PlayerMedium, idx: number, count: number): void {
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
  synchronisiereKarte(imS: number, dauerS: number, tempo: number): void {
    const { video } = this.els
    const { quelle, bereit } = this._kartenQuelle()
    this.karten.male({
      imS,
      dauerS,
      medium: this._kartenMedium,
      text: this._kartenText,
      quelle,
      bereit,
    })

    if (video.hidden || !video.getAttribute('src')) {
      this._meldeVideoTon(0)
      return
    }
    // Der Player liefert die GESCHNITTENE Datei aus — der Ausschnitt beginnt
    // bei 0. Kennt sie ihre Länge noch nicht, steht das Ende offen; die Klemme
    // greift dann erst mit `loadedmetadata`.
    const endeS = video.duration > 0 && Number.isFinite(video.duration) ? video.duration : Infinity
    const { zielS, ausgelaufen } = videoStandS(0, endeS, imS)
    // Ein Video kann nicht rückwärts spielen: Im Schnelllauf und rückwärts
    // steht es auf dem Frame der Kopfposition und schweigt — wie im Editor.
    const laeuft = tempo === 1 && !ausgelaufen
    if (laeuft) {
      // Im Lauf trägt das Video seine eigene Uhr; nachgezogen wird erst, wenn
      // es merklich auseinanderläuft.
      if (Math.abs(video.currentTime - zielS) > 0.34) this._setzeVideoZeit(zielS)
      if (video.paused) {
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
    } else if (!video.paused) {
      video.pause()
    }
    if (!laeuft && Math.abs(video.currentTime - zielS) > 0.04) this._setzeVideoZeit(zielS)

    // Ton-Hülle über den Ausschnitt: Ein- und Ausblende liegen an den
    // Schnittkanten, und sie steuert zugleich das Ducking der Musik.
    // Geteilt mit dem Editor (`ausschnittDauerS`): Der Player liefert die
    // geschnittene Fassung aus, sein linker Schnitt ist also 0.
    const ausschnittS = ausschnittDauerS(dauerS, 0, endeS)
    const huelle = laeuft && !video.muted ? videoTonHuelle(imS, ausschnittS) : 0
    const laut = videoLautstaerke(huelle)
    // Nur bei Bedarf setzen — sonst feuert mancher Browser volumechange im Kreis
    if (Math.abs(video.volume - laut) > 0.004) video.volume = laut
    this._meldeVideoTon(huelle)
  }

  private _setzeVideoZeit(sekunde: number): void {
    try {
      this.els.video.currentTime = Math.max(0, sekunde)
    } catch {
      /* Seek vor dem Puffern kann fehlschlagen — der nächste Kopfschritt holt es nach */
    }
  }

  /** Die Karte wegnehmen — außerhalb jedes Halts und beim Verlassen der Tour. */
  verbergeKarte(): void {
    const { layer, card } = this.els
    this._stopVideo() // Video anhalten + Ressource freigeben (+ Ducking aus)
    this.els.video.hidden = true
    this.els.sound.hidden = true
    card.classList.remove('held')
    layer.classList.remove('show')
    layer.setAttribute('aria-hidden', 'true')
    document.body.classList.remove('cinema')
    this.karten.raeume()
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

  stats({ km, ele, frac, filmFrac, next, modeKey }: Telemetrie): void {
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
