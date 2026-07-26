// Tour-eigene Audio-Spuren (Kreativbaukasten): vom Autor im Studio hinterlegte
// Musik-Bereiche und SFX-One-Shots, verankert am Streckenanteil f (cfg.audio aus
// remote.ts). Musik läuft geloopt, solange der Playhead im Bereich [f0,f1) steht —
// mit träger Blende an den Grenzen (wie music.js); SFX feuern einmalig beim
// Vorwärts-Überfahren ihres f0 (nur echte Wiedergabe, keine Scrub-/Seek-Sprünge).
// Läuft nur, wenn das Gate wahr ist (z.B. „Tour läuft/Foto/Scrub"). Pause INNERHALB
// des Bereichs stoppt den Ton SOFORT und hält die Position — Weiterlaufen setzt
// genau dort fort (wie im Studio-Abspieler). Bereich verlassen / Musik aus: weiche
// Blende. setDucking: Video-Ton senkt laufende Musik (nicht SFX) auf VIDEO_DUCK ab.

// — Reine Helfer (DOM-frei) — direkt testbar (test/audiotracks.test.ts, Node ohne Audio) —

// Steht der Playhead im Bereich einer Musik-Spur? Halboffenes Intervall [f0,f1):
// an der Endgrenze ist die Spur schon aus (die Blende übernimmt das Weiche).
export function istAktiv(spur, frac) {
  return spur.f0 <= frac && frac < spur.f1
}

// Soll ein SFX-One-Shot feuern? Nur beim VORWÄRTS-Überfahren von f0, nur bei
// echter Wiedergabe (istPlayback) und nur bei Frame-kleiner Sprungweite — ein
// Scrub/Seek quer über die Marke soll nicht knallen. Nach jedem Aufruf zieht
// der Aufrufer die Vorher-Position hart nach, Sprünge „verbrauchen" die Marke also.
// Sonderfall f0=0: „vorher < 0" gibt es nie — die Marke am Tour-Start feuert
// stattdessen beim ersten echten Vorwärts-Tick aus der Nullposition heraus.
export function sfxSollFeuern(vorher, nachher, f0, istPlayback) {
  if (!istPlayback || nachher - vorher >= 0.02) return false
  if (f0 === 0) return vorher === 0 && nachher > 0
  return vorher < f0 && nachher >= f0
}

// Ducking bei Video-Ton: volle Video-Lautstärke senkt die Musik auf diesen Anteil
// (~−13 dB). Der tatsächliche Duck-Pegel folgt der Video-Ton-Hülle (Equal-Power-
// Crossfade) — s. videoTonHuelle / videoMusikDuck. Später im Editor pro Medium
// individualisierbar; bis dahin fester Default.
export const VIDEO_DUCK = 0.22

/** Dauer der Video-Ton-Ein-/Ausblendung (Sekunden); bei kurzen Clips max. Hälfte. */
export const VIDEO_FADE_S = 1.4

/**
 * Lineare Ton-Hülle 0..1 über die Videodauer: Fade-in am Anfang, Fade-out am
 * Ende. DOM-frei — steuert sowohl video.volume als auch den Musik-Duck.
 */
export function videoTonHuelle(t, dauer, fadeS = VIDEO_FADE_S) {
  if (!(dauer > 0) || !(t >= 0) || t >= dauer) return 0
  const fade = Math.min(Math.max(0, fadeS), dauer / 2)
  if (fade <= 0) return 1
  let x = 1
  if (t < fade) x = t / fade
  const rest = dauer - t
  if (rest < fade) x = Math.min(x, rest / fade)
  return x
}

/** Equal-Power-Kurve fürs Video (sin): konstante empfundene Lautheit im Crossfade. */
export function videoLautstaerke(huelle) {
  const g = Math.max(0, Math.min(1, huelle))
  return Math.sin((g * Math.PI) / 2)
}

/**
 * Musik-Multiplikator zum Video-Pegel: bei Hülle 0 → 1 (voll), bei 1 → VIDEO_DUCK.
 * cos-Zweig zu videoLautstaerke — zusammen Equal-Power.
 */
export function videoMusikDuck(huelle) {
  const g = Math.max(0, Math.min(1, Number(huelle) || 0))
  return VIDEO_DUCK + (1 - VIDEO_DUCK) * Math.cos((g * Math.PI) / 2)
}
export function createAudioTracks(tracks, { volume = 0.22 } = {}) {
  // Musik-Spuren: je Spur ein lazy HTMLAudioElement (erst beim ersten Eintritt
  // geladen, preload='none'), eigener Blend-Level für die weiche Bereichsgrenze.
  const musik = tracks
    .filter((t) => t.type === 'music')
    .map((t) => ({ ...t, el: null, level: 0, drin: false, blocked: false }))
  const sfx = tracks.filter((t) => t.type === 'sfx')
  let musikEnabled = true
  let sfxEnabled = true
  let gate = () => false
  let frac = 0
  let vorher = 0 // interne Vorher-Position für die SFX-Kantenerkennung
  let duckTgt = 1
  let duck = 1

  const vol = (t) => Math.max(0, Math.min(1, volume * (t.gain ?? 1)))

  // Träge Blende + Play/Pause nach Ziel (aktiviert && Gate && im Bereich). Eigener
  // Timer wie music.js, damit der Ton unabhängig von der Render-Schleife läuft.
  const timer = setInterval(() => {
    const offen = gate()
    duck += (duckTgt - duck) * 0.45 // folgt der Video-Hülle eng (~0,15 s), ohne zu rattern
    for (const spur of musik) {
      const drin = istAktiv(spur, frac)
      const want = musikEnabled && offen && drin
      // Eintritt in den Bereich (auch nach Scrub/Jump): von vorn starten —
      // Pause/Weiter INNERHALB des Bereichs setzt dagegen nicht zurück (Einfrieren)
      if (drin && !spur.drin) {
        if (!spur.el) {
          // lazy: Element erst beim ersten Eintritt anlegen; preload='none' VOR
          // src, sonst lädt der Browser schon beim Anlegen (erst play() lädt)
          spur.el = new Audio()
          spur.el.preload = 'none'
          // Loop bis zur Bereichsgrenze — wie im Studio (abspielen.ts); ohne Loop
          // verstummte die Spur, sobald die Datei einmal durchgelaufen war.
          spur.el.loop = true
          spur.el.src = spur.src
        }
        spur.el.currentTime = 0
        if (want) spur.el.play().catch(() => { spur.blocked = true })
      }
      spur.drin = drin
      const el = spur.el
      if (!el) continue

      // Pause innerhalb des Bereichs (Gate zu, Playhead noch drin): Ton SOFORT
      // stoppen, Position und Level halten — Weiterlaufen setzt genau dort fort.
      // Bereich verlassen / Musik aus: unten die weiche Blende.
      if (drin && !offen) {
        if (!el.paused) el.pause()
        el.volume = Math.max(0, Math.min(1, spur.level * duck))
        continue
      }

      const tgt = want ? vol(spur) : 0
      spur.level += (tgt - spur.level) * 0.06 // ~2,5 s Blende bei 60 ms Tick (wie music.js)
      el.volume = Math.max(0, Math.min(1, spur.level * duck))
      // Retry nach Autoplay-Block bzw. nach Pause-Einfrieren
      if (want && el.paused && !spur.blocked) el.play().catch(() => { spur.blocked = true })
      if (!want && !el.paused && spur.level < 0.004) el.pause()
    }
  }, 60)

  // Autoplay-Block nach der ersten User-Geste aufheben (Retry im Timer)
  window.addEventListener('pointerdown', () => { for (const s of musik) s.blocked = false }, { passive: true })

  return {
    // Streckenanteil pro Frame zuführen (updateTrace-Wrapper in main.js). Musik
    // liest ihn im Timer; SFX prüfen hier sofort die Vorwärts-Kante über f0.
    setFrac: (f, istPlayback) => {
      frac = f
      for (const s of sfx) {
        if (sfxEnabled && sfxSollFeuern(vorher, f, s.f0, istPlayback)) {
          const el = new Audio(s.src) // One-Shot: eigenes Element, spielt aus und verfällt
          el.volume = vol(s)
          el.play().catch(() => {}) // Autoplay-Block: One-Shot verfällt (kein Nachholen)
        }
      }
      vorher = f // Vorher-Position hart nachziehen — auch nach Sprüngen/Scrubs
    },
    setGate: (fn) => { gate = fn },
    setMusikEnabled: (on) => { musikEnabled = on },
    setSfxEnabled: (on) => { sfxEnabled = on },
    // Video-Ton-Hülle 0..1 → Musik ducken (Equal-Power); true/false bleibt kompatibel.
    setDucking: (pegel) => {
      const g = pegel === true ? 1 : pegel === false ? 0 : Math.max(0, Math.min(1, Number(pegel) || 0))
      duckTgt = videoMusikDuck(g)
    },
    get level() { return musik.reduce((m, s) => Math.max(m, s.level), 0) }, // Debug/E2E
    get aktiveSpur() { return musik.find((s) => istAktiv(s, frac))?.src ?? null }, // Debug/E2E
    destroy: () => { clearInterval(timer); for (const s of musik) s.el?.pause() },
  }
}
