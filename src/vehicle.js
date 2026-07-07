// Fahrzeug-Motorgeräusche: pro Fortbewegungsmodus ein leiser, nahtlos geloopter
// Motor-Loop, der während der Fahrt im Hintergrund läuft und beim Moduswechsel weich
// überblendet. Läuft nur, wenn das Gate wahr ist (z.B. „Tour fährt gerade") — bei
// Foto-Stopp, Pause, Scrub oder im Menü blendet der Motor sanft aus (wie ein Standgas,
// das ausgeht). Modi ohne Motor (walk/bike/tram) ⇒ Stille.
import { SeamlessLoop } from './audioloop.js'

// Segment-Modus → Motor-Loop-Datei (public/audio/<name>.mp3). Die drei Fahrmodi der
// Koh-Pha-ngan-Tour: Moped (Honda Wave 110, Küstenfahrt), Jeep (Bergüberquerung),
// Boot (thailändisches Longtail auf dem Golf). Modi ohne Motor (walk/bike/tram) ⇒ Stille.
const MODE_SOUND = { moped: 'eng-moped', jeep: 'eng-jeep', ferry: 'eng-boat' }

export function createVehicle(base = '/audio', { volume = 0.2 } = {}) {
  const loops = {} // Sound-Name → SeamlessLoop (lazy: erst beim ersten Gebrauch geladen)
  const level = {} // Sound-Name → aktuelle Lautstärke (für den Crossfade)
  let curSnd = null // gewünschter Sound aus dem aktiven Modus (null = Stille)
  let gate = () => false
  let enabled = true

  const getLoop = (snd) => (loops[snd] ||= new SeamlessLoop(`${base}/${snd}.mp3`, { xfade: 0.6 }))

  // Eigener Timer: blendet jeden angelegten Loop Richtung Ziel (nur der gewünschte
  // Sound bekommt volume, alle anderen 0) — Moduswechsel wird so ein weicher Crossfade.
  const timer = setInterval(() => {
    const want = enabled && gate() ? curSnd : null
    for (const snd of Object.keys(loops)) {
      const tgt = snd === want ? volume : 0
      level[snd] = (level[snd] ?? 0) + (tgt - (level[snd] ?? 0)) * 0.12 // ~0,7 s Blende
      const loop = loops[snd]
      if (level[snd] > 0.003) {
        if (loop.paused && !loop._blocked) loop.play().catch(() => {})
        loop.volume = level[snd]
      } else if (!loop.paused) { loop.volume = 0; loop.pause() }
    }
  }, 60)

  // Autoplay-Block nach der ersten User-Geste aufheben (Retry im Timer)
  window.addEventListener('pointerdown', () => { for (const l of Object.values(loops)) l._blocked = false }, { passive: true })

  return {
    // Aktiven Modus setzen (aus ui.onModeChange). Unbekannte/motorlose Modi ⇒ Stille.
    setMode: (modeKey) => {
      const snd = MODE_SOUND[modeKey] ?? null
      curSnd = snd
      if (snd) getLoop(snd) // Loop bei Bedarf anlegen → MP3 wird vorgeladen
    },
    setGate: (fn) => { gate = fn },
    setEnabled: (on) => { enabled = on },
    get sound() { return curSnd }, // Debug/Abnahme
    get level() { return curSnd ? (level[curSnd] ?? 0) : 0 }, // Debug/Abnahme
    destroy: () => { clearInterval(timer); for (const l of Object.values(loops)) l.pause() },
  }
}
