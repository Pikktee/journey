// Unaufdringliche Hintergrundmusik während der Track-Animation. Nahtlos geloopt
// (SeamlessLoop mit langem Crossfade), weich ein-/ausgeblendet, an-/abschaltbar.
// Spielt nur, wenn das Gate wahr ist (z.B. „Tour läuft, nicht im Menü") UND die Musik
// aktiviert ist — sonst blendet sie sanft aus und pausiert.
// Ducking bei Video-Ton: folgt der Video-Hülle (Equal-Power), s. audiotracks.js.
import { SeamlessLoop } from './audioloop.js'
import { videoMusikDuck } from './audiotracks.js'

export function createMusic(url, { volume = 0.16 } = {}) {
  const loop = new SeamlessLoop(url, { xfade: 1.4 })
  let enabled = true
  let gate = () => false
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
    setGate: (fn) => { gate = fn },
    setEnabled: (on) => { enabled = on },
    // Video-Ton-Hülle 0..1 → Musik ducken; true/false bleibt kompatibel.
    setDucking: (pegel) => {
      const g = pegel === true ? 1 : pegel === false ? 0 : Math.max(0, Math.min(1, Number(pegel) || 0))
      duckTgt = videoMusikDuck(g)
    },
    get enabled() { return enabled },
    get playing() { return !loop.paused }, // Debug/Abnahme
    get level() { return master }, // Debug/Abnahme
    destroy: () => { clearInterval(timer); loop.pause() },
  }
}
