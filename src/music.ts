// Unaufdringliche Hintergrundmusik während der Track-Animation. Nahtlos geloopt
// (SeamlessLoop mit langem Crossfade), weich ein-/ausgeblendet, an-/abschaltbar.
// Spielt nur, wenn das Gate wahr ist (z.B. „Tour läuft, nicht im Menü") UND die Musik
// aktiviert ist — sonst blendet sie sanft aus und pausiert.
// Ducking bei Video-Ton: folgt der Video-Hülle (Equal-Power), s. audiotracks.ts.
import { SeamlessLoop } from './audioloop.js'
import { asEnvelope, FADE_OUT_S, musicDuck, type DuckVolumes } from './audiotracks.js'

export interface BackgroundMusic {
  setGate(fn: () => boolean): void
  setEnabled(on: boolean): void
  /** Video-Ton-Hülle 0..1 → Musik ducken; true/false bleibt kompatibel. */
  setDucking(pegel: DuckVolumes): void
  /**
   * Schneller ausklingen als an einer gewöhnlichen Gate-Kante (~0,9 s statt
   * 2,5 s) — der Weg zum Endscreen und zurück zum Startscreen. Die Tour-Musik
   * kennt dasselbe Wort (audiotracks.ts), damit beide Quellen zusammen enden
   * und nicht die eine noch unter dem stehenden Startscreen weiterläuft.
   */
  verklinge(): void
  readonly enabled: boolean
  /** Debug/Abnahme */
  readonly playing: boolean
  /** Debug/Abnahme */
  readonly level: number
  destroy(): void
}

export function createMusic(
  url: string,
  { volume = 0.16 }: { volume?: number } = {},
): BackgroundMusic {
  const loop = new SeamlessLoop(url, { xfade: 1.4 })
  let enabled = true
  let gate = (): boolean => false
  let master = 0
  let duckTgt = 1
  let duck = 1
  let verklingt = false

  // Träge Blende + Play/Pause nach Ziel (aktiviert && Gate). Eigener Timer, damit die
  // Musik unabhängig von der Wetter-/Kamera-Schleife läuft.
  const timer = setInterval(() => {
    const want = enabled && gate()
    if (want) verklingt = false
    const tgt = want ? volume : 0
    master += (tgt - master) * (verklingt ? FADE_OUT_S : 0.06) // 2,5 s, beim Verklingen 0,9 s
    duck += (duckTgt - duck) * 0.45 // folgt der Video-Hülle eng (~0,15 s)
    if (want && loop.paused && !loop._blocked) loop.play().catch(() => {})
    loop.volume = master * duck
    if (!want && !loop.paused && master < 0.004) loop.pause()
  }, 60)

  // Autoplay-Block nach der ersten User-Geste aufheben (Retry im Timer)
  window.addEventListener(
    'pointerdown',
    () => {
      loop._blocked = false
    },
    { passive: true },
  )

  return {
    setGate: (fn: () => boolean) => {
      gate = fn
    },
    setEnabled: (on: boolean) => {
      enabled = on
    },
    // Video-Ton-Hülle 0..1 → Musik ducken; true/false bleibt kompatibel.
    setDucking: (pegel: DuckVolumes) => {
      duckTgt = musicDuck(asEnvelope(pegel))
    },
    verklinge: () => {
      verklingt = true
    },
    get enabled() {
      return enabled
    },
    get playing() {
      return !loop.paused
    }, // Debug/Abnahme
    get level() {
      return master
    }, // Debug/Abnahme
    destroy: () => {
      clearInterval(timer)
      loop.pause()
    },
  }
}
