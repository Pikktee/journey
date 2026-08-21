// Wiedergabe in der Zeitleiste: der Abspielkopf läuft, Musik und Klänge
// erklingen, an jedem Halt blendet die Aufnahme auf.
//
// Das ist bewusst KEIN zweiter Player — die 3D-Kamerafahrt bleibt dem echten
// Player vorbehalten (Knopf „Vorschau"). Hier geht es darum, den SCHNITT zu
// prüfen: Kommt die Musik zum Strandabschnitt? Reißt der Halt am Gipfel die
// Fahrt auseinander? Dafür genügen Kopf, Ton und Bild.
//
// Gerechnet wird in ANTEILEN 0..1 der Zeitleisten-Achse — derselben Größe, in
// der die ganze Leiste denkt. Wie schnell die Marke darüberläuft, sagt die
// FILMKURVE (timeline.ts): je Achsenstück so viel Zeit, wie der fertige
// Film dort braucht. Eine konstante Rate hing hier minutenlang in realen
// Pausen — die haben viel Aufnahmezeit, aber keine Strecke, und der Film
// fährt nach Strecke.
//
// Foto-Halte sind seit der Filmzeit-Achse ACHSENBREITE (die Standzeit steckt
// als Sprung in der Achse): die Marke läuft gleichmäßig durch den Halt
// hindurch. WELCHE Aufnahme dabei zu sehen ist, entscheidet dieses Modul NICHT
// mehr — das ist eine Funktion der Kopfposition (`stopAtFilmS`), und der
// Editor wertet sie bei jeder Kopfbewegung aus. Als Überfahr-MARKE gedacht
// (der Abspieler stieß die Einblendung an, ein Timer nahm sie zurück) hatte sie
// zwei Fehler, die derselbe Satz erklärt: Sie hing nicht am Kopf, sondern an
// einer Uhr — beim Scrubben erschien gar kein Bild, und beim Abspielen ging es
// 0,8 s zu früh (der Timer lief über die Standzeit, der Klip aber über
// Standzeit + Ausblendung).
//
// Reine Logik (tick, seitKlipbeginnS) ist DOM-frei und unter Vitest getestet; das
// Modul wird erst beim ersten Play geladen (editor.ts), damit die Audio-Elemente
// niemanden belasten, der nur schneidet.

import {
  asEnvelope,
  musicOffsetS,
  sfxShouldFire,
  musicDuck,
  type DuckVolumes,
} from '../audiotracks.js'
import { fractionAt, filmAt, type FilmCurve } from './timeline.js'

/** Musik-Bereich auf der Zeitachse. */
export interface MusicClip {
  from: number
  to: number
  url: string
  volume: number
  /** Einstieg in die DATEI (s, linker Trim); fehlt = Dateianfang */
  startS?: number
  /** Wiederholung über das Dateiende hinaus; fehlt = ja (das alte Verhalten) */
  loop?: boolean
}

/** Klang, der beim Überfahren einmal auslöst. */
export interface SoundCue {
  /** Index im Overlay-Array — der Editor lässt seine Marke damit pulsen */
  index: number
  fraction: number
  url: string
  volume: number
  /** Einstieg in die DATEI (s, linker Trim); fehlt = Dateianfang */
  startS?: number
}

/** Alles, was eine Wiedergabe braucht — beim Start einmal eingesammelt. */
export interface PlaybackPlan {
  /** Startposition (Anteil 0..1) */
  playhead: number
  /** Achsen-Anteil ↔ Filmsekunden der Wiedergabe (timeline.ts, buildPlaybackCurve) */
  curve: FilmCurve
  music: MusicClip[]
  sounds: SoundCue[]
}

/** Laufender Zustand der Wiedergabe. */
export interface PlaybackState {
  playhead: number
  /** 0 = angehalten, 1 = normal, ±2 to ±8 = Schnelllauf (J/L wie in Final Cut) */
  tempo: number
}

/** Ergebnis eines Schritts. */
export interface Step {
  state: PlaybackState
  /** Marke VOR dem Schritt — die Kante, an der Klänge auslösen */
  before: number
  /** Streckenende in Laufrichtung erreicht */
  end: boolean
}

export const EMPTY_STATE: PlaybackState = { playhead: 0, tempo: 0 }

/**
 * Ein Zeitschritt der Wiedergabe — rein, ohne Uhr und ohne DOM.
 *
 * Eine Feinheit, die sich im Mockup erst nach Fehlern ergab: Das Ende gilt
 * RICHTUNGSABHÄNGIG. Prüfte man beide Ränder, hielte ein Start bei Marke 0
 * sofort wieder an — der erste Frame hat dt = 0, die Marke bleibt 0 und träfe
 * die Bedingung „≤ 0".
 */
export function tick(state: PlaybackState, dtS: number, plan: PlaybackPlan): Step {
  const old = state.playhead
  let m = fractionAt(plan.curve, filmAt(plan.curve, old) + state.tempo * dtS)
  // Richtungsklemme: Steht die Marke MITTEN in einem Plateau (dorthin
  // gescrubbt), liefert der Roundtrip den Plateau-Anfang — vorwärts darf sie
  // dadurch nie zurückspringen (erster Frame hat dt = 0), rückwärts nie vor.
  if (state.tempo > 0) m = Math.max(old, m)
  else if (state.tempo < 0) m = Math.min(old, m)
  let end = false
  if (state.tempo > 0 && m >= 1) {
    m = 1
    end = true
  } else if (state.tempo < 0 && m <= 0) {
    m = 0
    end = true
  }

  return { state: { playhead: m, tempo: state.tempo }, before: old, end }
}

/**
 * Filmzeit, die seit dem Beginn eines Ton-Klips vergangen ist — das Argument von
 * `musikVersatzS` (src/audiotracks.ts, geteilt mit dem Player).
 *
 * Gerechnet über die SPIELKURVE: Eine reale Pause im Bereich zählt nicht als
 * Spielzeit. Die Funktion selbst kennt keine Kurve mehr — sie ist seit Paket D
 * die gemeinsame Rechnung beider Bühnen, und der Player hat keine Filmkurve,
 * sondern eine Filmachse.
 */
export function sinceClipStartS(fraction: number, clipFrom: number, curve: FilmCurve): number {
  return Math.max(0, filmAt(curve, fraction) - filmAt(curve, clipFrom))
}

/**
 * ALLE Musik-Bereiche an einer Position (halboffen [von, bis) wie im Player),
 * als Indizes in den Plan. Überlappende Bereiche mischen sich im fertigen Film
 * (audiotracks.js spielt je Spur ein eigenes Element) — die Schnittprüfung
 * muss dasselbe hören, sonst prüft sie einen anderen Film. Indizes statt
 * Klips, weil zwei Bereiche dieselbe Datei tragen können: die Identität ist
 * der Platz im Plan, nicht die URL.
 */
export function clipsAt(music: readonly MusicClip[], fraction: number): number[] {
  const indexes: number[] = []
  music.forEach((k, i) => {
    if (fraction >= k.from && fraction < k.to) indexes.push(i)
  })
  return indexes
}

// — Der Abspieler: rAF-Schleife, Ton und Rückrufe in den Editor —

export interface PlaybackOptions {
  /** Plan einsammeln — bei jedem Start neu, das Overlay kann sich geändert haben */
  get: () => PlaybackPlan | null
  /** Marke setzen (Anteil 0..1): bewegt Kopfstrich, Kopf-Uhr und Läufer — und
   *  damit auch die Foto-Einblendung, die an der Kopfposition hängt. */
  setPlayhead: (fraction: number) => void
  /** Transportanzeige (Knopf-Symbol, Tempo-Chip) */
  showTempo: (tempo: number) => void
  /** Klang-Marke in der Leiste pulsen lassen */
  pulseSound?: (index: number) => void
}

export interface Playback {
  /** Play ↔ Pause; am Ende angekommen, fängt Play wieder von vorn an */
  toggle: () => void
  setTempo: (tempo: number) => void
  pause: () => void
  running: () => boolean
  tempo: () => number
  /** Debug/E2E: welche Musik gerade läuft (die Elemente hängen nicht im DOM).
   *  `urls` listet ALLE laufenden Spuren — bei Überlappung mehr als eine. */
  audioState: () => { url: string | null; running: boolean; urls: string[] }
  /**
   * Video-Ton-Hülle 0..1 → Musik ducken, wie `AudioTracks.setDucking` im Player.
   * Ohne sie liefe die Filmmusik im Editor unter dem Ton der Aufnahme ungedämpft
   * weiter — der Schnitt klänge anders als der Film, und genau das soll das
   * Abspielen prüfen. SFX werden wie im Player NICHT gedämpft: Ein Effekt, der
   * zur Szene gehört, soll nicht unter deren eigenem Ton wegtauchen.
   */
  setDucking: (volume: DuckVolumes) => void
  /** Alles verstummen und Elemente freigeben (Editor verlassen) */
  close: () => void
}

export function createPlayback(options: PlaybackOptions): Playback {
  let plan: PlaybackPlan | null = null
  let state: PlaybackState = { ...EMPTY_STATE }
  let af: number | null = null
  let lastTs = 0

  // Je Musik-Klip (Index im Plan) ein EIGENES Element — überlappende Bereiche
  // mischen sich damit wie im fertigen Film, statt einander zu verdrängen.
  // Elemente entstehen erst beim ersten Eintritt in ihren Bereich; eine Tour
  // ohne Musikspur legt keins an (die reine Logik bleibt ohne Browser prüfbar).
  let musicElements = new Map<number, HTMLAudioElement>()

  // Laufende Klänge merken, damit Pause sie WIRKLICH verstummen lässt — ein
  // angestoßener Donner klänge sonst nach dem Anhalten sekundenlang weiter.
  let activeSounds: HTMLAudioElement[] = []

  // Musik-Dämpfung unter laufendem Video-Ton (1 = ungedämpft). Anders als im
  // Player ohne Glättung: Dort läuft ein eigener 60-ms-Timer, hier kommt der
  // Wert aus `syncImage` — also aus jedem Kopfschritt, und die Hülle
  // selbst ist schon die weiche Blende (videoTonHuelle über VIDEO_FADE_S).
  let duck = 1

  /** Pegel eines Klips inklusive Dämpfung — die EINE Stelle, die el.volume rechnet. */
  const volume = (clip: MusicClip): number => Math.max(0, Math.min(1, clip.volume * duck))

  function stopSounds(): void {
    for (const el of musicElements.values()) el.pause()
    for (const a of activeSounds) {
      a.pause()
      try {
        a.currentTime = 0
      } catch {
        /* manche Formate lassen sich nicht zurückspulen — Pause genügt */
      }
    }
    activeSounds = []
  }

  function playMusic(fraction: number): void {
    // Nur bei normaler Vorwärtsfahrt: im Schnelllauf oder rückwärts klänge sie
    // wie ein durchgedrehter Kassettenrekorder. Der Foto-Halt behält Tempo 1,
    // die Musik trägt also durch ihn hindurch.
    const active = plan && state.tempo === 1 ? clipsAt(plan.music, fraction) : []
    const activeSet = new Set(active)
    // Verlassene Bereiche verstummen; die Position bleibt stehen (Weiterlaufen
    // im Bereich seekt unten ohnehin auf die Film-Position).
    for (const [i, el] of musicElements) {
      if (!activeSet.has(i) && !el.paused) el.pause()
    }
    if (!plan) return
    for (const i of active) {
      const clip = plan.music[i]
      if (!clip) continue
      let el = musicElements.get(i)
      // Der Eintrag kann sich geändert haben, seit das Element entstand — die
      // Elemente überleben Pause und Neustart, der Plan wird bei jedem Start
      // frisch geholt. Ein getauschtes Stück braucht ein neues Element,
      // Lautstärke und Loop werden schlicht nachgezogen: Sonst klang der Klip
      // für den Rest der Sitzung mit dem Wert, den er beim ersten Play hatte
      // (am Regler hörte man die Änderung, im Abspielen nicht).
      if (el && el.dataset['url'] !== clip.url) {
        el.pause()
        el.removeAttribute('src')
        musicElements.delete(i)
        el = undefined
      }
      if (el) {
        el.volume = volume(clip)
        el.loop = clip.loop ?? true
      }
      if (!el) {
        el = new Audio()
        el.loop = clip.loop ?? true
        el.preload = 'none'
        el.src = clip.url
        el.dataset['url'] = clip.url // `el.src` ist absolut aufgelöst, der Plan trägt den rohen Verweis
        el.volume = volume(clip)
        const curve = plan.curve
        const onEntry = fraction
        el.addEventListener(
          'loadedmetadata',
          () => {
            if (!el || !el.duration) return
            try {
              el.currentTime = musicOffsetS(
                sinceClipStartS(onEntry, clip.from, curve),
                el.duration,
                clip.startS,
                el.loop,
              )
            } catch {
              /* Seek vor dem Puffern kann fehlschlagen — dann läuft sie ab 0 */
            }
          },
          { once: true },
        )
        musicElements.set(i, el)
        void el.play().catch(() => {
          /* Autoplay-Sperre: der Play-Knopf ist eine Geste, danach greift es */
        })
      } else if (el.paused) {
        // Wiedereintritt oder Weiterlaufen nach Pause: auf die Stelle seeken,
        // die im Film JETZT liefe — ohne die Datei neu zu laden.
        if (el.duration) {
          try {
            el.currentTime = musicOffsetS(
              sinceClipStartS(fraction, clip.from, plan.curve),
              el.duration,
              clip.startS,
              el.loop,
            )
          } catch {
            /* s. o. */
          }
        }
        // Ohne Loop ist eine durchgelaufene Datei fertig — play() finge sonst
        // wieder bei 0 an und der Klip klänge endlos.
        if (!el.ended) void el.play().catch(() => {})
      }
    }
  }

  function checkSounds(before: number, after: number): void {
    if (!plan) return
    // Die Kante wird in FILMSEKUNDEN geprüft, nicht in Achsen-Anteilen (E10):
    // Die Schwelle, ab der ein Schritt als Sprung gilt, ist eine Frame-Zeit —
    // im Anteil hinge sie an der Länge der Tour, und dieselbe Geste feuerte in
    // einem kurzen Film anders als in einem langen. Der Umweg über die Kurve
    // ist zugleich der Grund, dass beide Bühnen dieselbe Zahl vergleichen.
    const filmBefore = filmAt(plan.curve, before)
    const filmAfter = filmAt(plan.curve, after)
    for (const k of plan.sounds) {
      // Dieselbe Regel wie im Player (audiotracks.ts): nur beim Vorwärts-
      // Überfahren, und ein Sprung „verbraucht" die Marke lautlos.
      if (!sfxShouldFire(filmBefore, filmAfter, filmAt(plan.curve, k.fraction), true)) continue
      const a = new Audio(k.url)
      a.volume = Math.max(0, Math.min(1, k.volume))
      if (k.startS) a.currentTime = k.startS // linker Trim gilt auch beim One-Shot
      activeSounds.push(a)
      a.addEventListener('ended', () => {
        activeSounds = activeSounds.filter((x) => x !== a)
      })
      void a.play().catch(() => {})
      options.pulseSound?.(k.index)
    }
  }

  function step(ts: number): void {
    af = null
    if (!plan) return
    const dtS = lastTs ? Math.min((ts - lastTs) / 1000, 0.1) : 0
    lastTs = ts
    const erg = tick(state, dtS, plan)
    state = erg.state
    if (state.playhead !== erg.before) options.setPlayhead(state.playhead)
    playMusic(state.playhead)
    checkSounds(erg.before, state.playhead)
    if (erg.end) {
      pause()
      return
    }
    af = requestAnimationFrame(step)
  }

  /**
   * Anhalten heißt: die Schleife WIRKLICH beenden. Nur das Tempo auf 0 zu setzen
   * genügte nicht — der nächste Frame liefe noch, stieße die Musik erneut an,
   * und der Ton spielte nach dem Anhalten weiter.
   */
  function pause(): void {
    if (af !== null) cancelAnimationFrame(af)
    af = null
    state = { ...state, tempo: 0 }
    stopSounds()
    options.showTempo(0)
  }

  function setTempo(t: number): void {
    if (t === 0) {
      pause()
      return
    }
    const fresh = options.get()
    if (!fresh) return
    plan = fresh
    state = { playhead: fresh.playhead, tempo: t }
    options.showTempo(t)
    if (af === null) {
      lastTs = 0
      af = requestAnimationFrame(step)
    }
  }

  return {
    toggle: () => {
      if (state.tempo !== 0) {
        pause()
        return
      }
      // Steht der Kopf am Ende, beginnt Play wieder von vorn. Das deckt „zurück
      // an den Anfang" mit ab — ein eigener Stopp-Knopf wäre in einer
      // scrub-basierten Leiste nicht selbsterklärend („Stopp" ≠ „Pause"?).
      if ((options.get()?.playhead ?? 0) >= 0.999) options.setPlayhead(0)
      setTempo(1)
    },
    setTempo,
    pause,
    running: () => state.tempo !== 0,
    tempo: () => state.tempo,
    audioState: () => {
      const playing = [...musicElements.values()].filter((el) => !el.paused)
      return {
        url: playing[0]?.src ?? null,
        running: playing.length > 0,
        urls: playing.map((el) => el.src),
      }
    },
    setDucking: (p: DuckVolumes) => {
      const next = musicDuck(asEnvelope(p))
      if (next === duck) return
      duck = next
      // Laufende Elemente sofort nachziehen: Der nächste `playMusic`-Durchlauf
      // käme erst beim nächsten Frame, und ohne laufende Wiedergabe (Scrubben
      // durch ein Video) gar nicht — die Dämpfung bliebe dann stehen.
      if (!plan) return
      for (const [i, el] of musicElements) {
        const clip = plan.music[i]
        if (clip) el.volume = volume(clip)
      }
    },
    close: () => {
      pause()
      for (const el of musicElements.values()) el.removeAttribute('src')
      musicElements = new Map()
      plan = null
    },
  }
}
