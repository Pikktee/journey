// Unaufdringliche Hintergrundmusik während der Track-Animation. Nahtlos geloopt
// (SeamlessLoop mit langem Crossfade), weich ein-/ausgeblendet, an-/abschaltbar.
// Spielt nur, wenn das Gate wahr ist (z.B. „Tour läuft, nicht im Menü") UND die Musik
// aktiviert ist — sonst blendet sie sanft aus und pausiert.
// Ducking bei Video-Ton: folgt der Video-Hülle (Equal-Power), s. audiotracks.js.
import { SeamlessLoop } from './audioloop.js'
import { alsHuelle, videoMusikDuck, type DuckPegel } from './audiotracks.js'

export interface Hintergrundmusik {
  setGate(fn: () => boolean): void
  setEnabled(on: boolean): void
  /** Video-Ton-Hülle 0..1 → Musik ducken; true/false bleibt kompatibel. */
  setDucking(pegel: DuckPegel): void
  readonly enabled: boolean
  /** Debug/Abnahme */
  readonly playing: boolean
  /** Debug/Abnahme */
  readonly level: number
  destroy(): void
}

export function createMusic(url: string, { volume = 0.16 }: { volume?: number } = {}): Hintergrundmusik {
  const loop = new SeamlessLoop(url, { xfade: 1.4 })
  let enabled = true
  let gate = (): boolean => false
  let master = 0
  let duckTgt = 1
  let duck = 1

  // Träge Blende + Play/Pause nach Ziel (aktiviert && Gate). Eigener Timer, damit die
  // Musik unabhängig von der Wetter-/Kamera-Schleife läuft.
  const timer = setInterval(() => {
    const want = enabled && gate()
    const tgt = want ? volume : 0
    master += (tgt - master) * 0.06 // ~2,5 s Blende bei 60 ms Tick
    duck += (duckTgt - duck) * 0.45 // folgt der Video-Hülle eng (~0,15 s)
    if (want && loop.paused && !loop._blocked) loop.play().catch(() => {})
    loop.volume = master * duck
    if (!want && !loop.paused && master < 0.004) loop.pause()
  }, 60)

  // Autoplay-Block nach der ersten User-Geste aufheben (Retry im Timer)
  window.addEventListener('pointerdown', () => { loop._blocked = false }, { passive: true })

  return {
    setGate: (fn: () => boolean) => { gate = fn },
    setEnabled: (on: boolean) => { enabled = on },
    // Video-Ton-Hülle 0..1 → Musik ducken; true/false bleibt kompatibel.
    setDucking: (pegel: DuckPegel) => { duckTgt = videoMusikDuck(alsHuelle(pegel)) },
    get enabled() { return enabled },
    get playing() { return !loop.paused }, // Debug/Abnahme
    get level() { return master }, // Debug/Abnahme
    destroy: () => { clearInterval(timer); loop.pause() },
  }
}
