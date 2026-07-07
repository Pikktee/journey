// Wetter-Overlay: animierte Regen-/Schnee-/Gewitter-Effekte auf einem eigenen
// Screen-Space-Canvas (#weather), über der Atmosphäre und unter Vignette/Grain/UI.
// Läuft in einer EIGENEN rAF-Schleife (unabhängig von der Tour-Kamera), friert aber
// über das Gate (setGate) ein, wenn die Szene pausiert — stehender Regen zu stehender
// Kamera. Niederschlag blendet über ein Level LANGSAM ein/aus (Regen „setzt ein")
// und skaliert über eine Intensität (setIntensity, 0..1) — Dichte, Tempo, Wind,
// Böen, Blitzrate und Sound ziehen alle mit. Manuell umschaltbar; noch NICHT aus
// den Fotos abgeleitet. Die Modi „Wolkig"/„Nebel" haben hier KEINE Partikel — ihren
// Himmel zeichnet die Atmosphäre (atmo.setWeather), verdrahtet in main.js.
// Reines 2D-Canvas, keine externen Abhängigkeiten.
import { SeamlessLoop } from './audioloop.js'

const rand = () => Math.random()

// Tiefen-Bänder für Parallaxe: fern (dünn/blass/langsam) … nah (dick/hell/schnell).
// Ein Stroke/Fill je Band hält die Zeichenlast niedrig (ein Pfad statt tausender
// Einzel-Striche). Bewusst fein + transluzent — echter Regen ist kein Gitter opaker Striche.
const BUCKETS = [
  { th: 0.6, a: 0.13 },
  { th: 1.0, a: 0.22 },
  { th: 1.5, a: 0.36 },
]

// Modus-Profile bei VOLLER Intensität (k = 1). density = Partikel pro Pixel²,
// v = Fallgeschwindigkeit (px/s), len = Streak-Länge (px) bzw. r = Flockenradius,
// wind/gust = Seitwind (px/s) + Böenamplitude, sqAmp = Regenwellen (Schauer-Wogen,
// 0..1 Alpha-Modulation), aMul = Alpha-Faktor, wash/dark = kühle Eintrübung +
// Abdunklung (Overcast). Regen fällt nahezu senkrecht mit sanfter Drift; GEWITTER-
// Regen peitscht dagegen sichtbar schräg und die Böen reißen an ihm — Neigung und
// Drift kommen aus DEMSELBEN Windvektor (vRef), Bewegung und Bild passen zusammen.
// Schnee fällt langsam und taumelt (sway = seitliche Pendel-Geschwindigkeit).
const VREF = 1300 // Referenz-Fallgeschwindigkeit: Streak-Neigung = wind/VREF
const PROFILES = {
  // dark-Werte bewusst niedrig: die Grund-Abdunklung bei bedecktem Himmel macht
  // inzwischen die Atmosphäre (drawOvercast, folgt wxCur.dark) — hier nur der Rest.
  rain: { density: 0.0005, vmin: 950, vmax: 1600, lmin: 15, lmax: 32, wind: -26, gust: 22, sqAmp: 0.16, aMul: 1, wash: 'rgba(120,138,164,0.06)', dark: 'rgba(12,16,24,0.04)' },
  storm: { density: 0.001, vmin: 1500, vmax: 2450, lmin: 26, lmax: 58, wind: -240, gust: 215, sqAmp: 0.42, aMul: 1.15, wash: 'rgba(104,122,146,0.09)', dark: 'rgba(8,11,18,0.12)' },
  snow: { density: 0.0005, vmin: 46, vmax: 130, rmin: 1.1, rmax: 3.4, sway: 30, wind: -10, gust: 8, sqAmp: 0.08, aMul: 1, wash: 'rgba(214,222,233,0.1)', dark: 'rgba(26,30,40,0.04)', flakes: true },
}

// Niederschlag setzt langsam ein und klingt langsam aus (Sekunden pro Level-Einheit)
const RAMP_IN = 4.5
const RAMP_OUT = 3.2

// Modus → Ambience-Loop (Schnee bekommt leisen Winterwind statt Regenrauschen)
const LOOP_FOR = { rain: 'rain', storm: 'storm', snow: 'wind' }
const LOOPS = ['rain', 'storm', 'wind']
// Donner-Varianten: naher Schlag, fernes Grollen, scharfer Krachen — zufällig gemischt
const THUNDERS = ['thunder', 'thunder2', 'thunder3']

const smooth01 = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t))

export function createWeather(container) {
  const canvas = document.createElement('canvas')
  canvas.id = 'weather'
  canvas.setAttribute('aria-hidden', 'true')
  container.appendChild(canvas)
  const ctx = canvas.getContext('2d')
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  // Blitze flackern → bei reduzierter Bewegung abschalten (Barrierefreiheit)
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

  let w = 0, h = 0
  let mode = 'off'
  let k = 0.7 // Intensität 0..1 (Leicht/Mittel/Stark — Default Mittel)
  let pAct = null // aktives Partikel-Profil; bleibt beim Ausklingen erhalten (mode ist da schon 'off')
  let level = 0 // 0..1 Einsetz-/Ausklinglevel (Regen fängt langsam an / hört langsam auf)
  let drops = []
  let windPhase = 0, swayT = 0, sqT = 0
  let flash = 0, strikeIn = 4
  let bolt = null, boltLife = 0 // sichtbarer Blitz-Pfad (zusätzlich zum Vollbild-Flash)
  let flakeSprite = null // weiches Flocken-Sprite (lazy, s. Schnee-Zeichnung)
  let raf = null, lastT = 0
  let gate = null // () => true solange die Szene animiert; false ⇒ Overlay friert ein
  let frozen = false

  // Intensitäts-Ableitungen: Dichte skaliert voll, Tempo/Länge/Wind nur teilweise —
  // leichter Regen ist vor allem SPÄRLICHER, nicht nur langsamer.
  const kv = () => 0.8 + 0.2 * k
  const klen = () => 0.65 + 0.35 * k
  const kw = () => 0.55 + 0.45 * k

  // — Sound (Regen-/Sturm-/Wind-Loop + Donner-Varianten) —
  // Erst nach einer User-Geste erlaubt (Autoplay-Policy); setMode kommt per Klick → ok.
  // Bei Auto-Restore (localStorage) ist play() evtl. blockiert → beim ersten Pointer nachholen.
  // Dateien liegen in public/audio/ (per scripts/gen-weather-audio.mjs via ElevenLabs erzeugt).
  const VOL = { rain: 0.4, storm: 0.5, wind: 0.26 }
  const volFor = (key) => VOL[key] * (0.4 + 0.6 * k) // Lautstärke folgt der Intensität
  const sounds = {}
  let soundsReady = false
  const initSounds = () => {
    if (soundsReady) return
    soundsReady = true
    // Loops (Regen/Sturm/Wind) über den Crossfade-Wrapper — kein harter Schnitt mehr
    // am Loop-Punkt; das Level koppelt weiter über .volume (get/set) in step().
    for (const key of LOOPS) sounds[key] = new SeamlessLoop(`/audio/${key}.mp3`)
    // Donner sind Einzelschüsse (dürfen sich überlappen) → normale Audio-Elemente
    for (const key of THUNDERS) { const a = new Audio(`/audio/${key}.mp3`); a.preload = 'auto'; sounds[key] = a }
  }
  const rampVol = (a, to, dur, done) => {
    if (a._ramp) clearInterval(a._ramp)
    const from = a.volume, t0 = performance.now()
    a._ramp = setInterval(() => {
      const f = Math.min((performance.now() - t0) / dur, 1)
      a.volume = Math.max(0, Math.min(1, from + (to - from) * f))
      if (f >= 1) { clearInterval(a._ramp); a._ramp = null; done && done() }
    }, 40)
  }
  // Der aktive Ambience-Loop wird NICHT mehr per fester Umschalt-Rampe gefahren,
  // sondern folgt in step() dem Einsetz-Level: der Regen RAUSCHT so langsam an
  // und ab, wie er fällt (User: „insbesondere das Audio langsam einblenden").
  // loopAct bleibt beim Ausklingen gesetzt (mode ist da schon 'off'), damit der
  // Sound mit dem Level verklingt; shutdown() räumt am Ende auf.
  let loopAct = null
  const tryPlay = (a) => {
    if (!a.paused) return
    // Autoplay-Block merken statt jedes Frame erneut anzuspielen (Promise-Spam);
    // der pointerdown-Handler unten setzt das Flag nach der ersten Geste zurück.
    a.play().then(() => { a._blocked = false }).catch(() => { a._blocked = true })
  }
  const thunder = () => {
    if (frozen) return // in der Pause donnert nichts nach
    const base = sounds[THUNDERS[Math.floor(rand() * THUNDERS.length)]]
    if (!base) return
    const a = base.cloneNode() // Klon → Donnerschläge dürfen sich überlappen
    a.volume = (0.5 + rand() * 0.4) * (0.55 + 0.45 * k)
    a.playbackRate = 0.85 + rand() * 0.4 // Tonhöhen-/Längenvariation
    a.play().catch(() => {})
  }
  // Pause: Loops zügig wegblenden (der lange Ausklang-Fade wäre hier falsch).
  // Das Wieder-Anrauschen bei Wiedergabe übernimmt die Level-Kopplung in step().
  const freezeAudio = () => { for (const key of LOOPS) { const a = sounds[key]; if (a && !a.paused) rampVol(a, 0, 350, () => a.pause()) } }

  // Seitwind schiebt den Vorhang nach links (wind < 0) — der Spawn-Bereich reicht
  // entsprechend weiter nach rechts hinaus, sonst dünnt der rechte Rand bei Böen aus
  const marginR = (p) => (p.flakes ? 0 : Math.abs(p.wind) * 1.2)
  const spawn = (p, top) => {
    const z = rand() // Tiefe 0..1 (fern..nah)
    const d = {
      x: rand() * (w + 240 + marginR(p)) - 120,
      y: top ? -20 - rand() * h * 0.6 : rand() * h, // top: oberhalb neu einsetzen
      v: (p.vmin + (p.vmax - p.vmin) * z) * kv(),
      b: z < 0.34 ? 0 : z < 0.67 ? 1 : 2, // Tiefen-Band
    }
    if (p.flakes) {
      d.r = (p.rmin + (p.rmax - p.rmin) * z) * (0.75 + 0.25 * k)
      d.ph = rand() * Math.PI * 2 // Taumel-Phase
      d.fq = 0.7 + rand() * 1.6 // Taumel-Frequenz
    } else {
      d.len = (p.lmin + (p.lmax - p.lmin) * z) * klen()
    }
    return d
  }

  const resize = () => {
    w = window.innerWidth; h = window.innerHeight
    canvas.width = w * dpr; canvas.height = h * dpr
    canvas.style.width = `${w}px`; canvas.style.height = `${h}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    // Kein Hard-Rebuild: der Bestand bleibt, die Zielanzahl (targetN in step)
    // zieht die Menge über Nachschub/Recycling weich auf die neue Fläche.
  }

  // Gezackter Blitz-Pfad: Hauptstrang von oben bis über den Horizontbereich,
  // 1–2 kurze Abzweigungen. Wird für die Dauer des Flashs mit Glow gezeichnet.
  const makeBolt = () => {
    const x0 = w * (0.15 + rand() * 0.7)
    const yEnd = h * (0.45 + rand() * 0.3)
    const lean = (rand() - 0.5) * 0.5 // leichte Gesamtneigung
    const pts = [[x0, -20]]
    const n = 11 + Math.floor(rand() * 5)
    for (let i = 1; i <= n; i++) {
      const y = -20 + ((yEnd + 20) * i) / n
      pts.push([x0 + lean * (y + 20) + (rand() - 0.5) * w * 0.045, y])
    }
    const branches = []
    const nb = 1 + (rand() < 0.5 ? 1 : 0)
    for (let bi = 0; bi < nb; bi++) {
      const ki = 2 + Math.floor(rand() * (pts.length - 4))
      const dir = rand() < 0.5 ? -1 : 1
      const bp = [pts[ki]]
      const segs = 3 + Math.floor(rand() * 3)
      for (let j = 1; j <= segs; j++) {
        const [px, py] = bp[j - 1]
        bp.push([px + dir * (8 + rand() * 26), py + 14 + rand() * 26])
      }
      branches.push(bp)
    }
    return { pts, branches }
  }

  const drawBolt = (t) => {
    const a = Math.min(1, t * 1.6) // steht kurz voll, klingt dann aus (länger als der Flash)
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.lineJoin = 'round'
    const paths = [bolt.pts, ...bolt.branches]
    // drei Durchgänge: weiter Glow → enger Schein → weißglühender Kern
    const passes = [
      [10, `rgba(150,180,255,${0.28 * a})`],
      [3.4, `rgba(210,228,255,${0.75 * a})`],
      [1.4, `rgba(255,255,255,${a})`],
    ]
    for (const [lw, col] of passes) {
      ctx.lineWidth = lw
      ctx.strokeStyle = col
      for (const path of paths) {
        ctx.beginPath()
        ctx.moveTo(path[0][0], path[0][1])
        for (let i = 1; i < path.length; i++) ctx.lineTo(path[i][0], path[i][1])
        ctx.stroke()
      }
    }
    ctx.restore()
  }

  const step = (dt) => {
    const p = pAct
    if (!p) return
    if (!(w > 0 && h > 0)) return // vor dem ersten Layout / im Hintergrund-Tab

    // Einsetzen/Ausklingen: Level wandert langsam zum Ziel; Dichte folgt dem Level,
    // ganz am Ende (bzw. Anfang) blendet zusätzlich das Alpha — so hört auch träger
    // Schnee sichtbar auf, statt minutenlang auszurieseln.
    const tgt = PROFILES[mode] ? 1 : 0
    if (level < tgt) level = Math.min(tgt, level + dt / RAMP_IN)
    else if (level > tgt) level = Math.max(tgt, level - dt / RAMP_OUT)
    if (!tgt && level <= 0.002) return shutdown()
    const fadeA = smooth01(level / 0.35) // nur die letzten ~35 % dimmen/heben zusätzlich

    // Sound folgt dem Level: der aktive Loop zieht weich auf Lautstärke×Level,
    // alle anderen auf 0 (Moduswechsel Regen→Gewitter = ~1-s-Crossfade). Damit
    // setzt das Rauschen mit dem Regen ein und verklingt mit ihm — statt der
    // früheren festen 2,2-s-Rampe direkt beim Umschalten.
    if (soundsReady) {
      const kA = 1 - Math.exp(-dt / 1.1)
      for (const key of LOOPS) {
        const a = sounds[key]
        if (!a) continue
        const vTgt = key === loopAct ? volFor(key) * smooth01(level) : 0
        a.volume = Math.max(0, Math.min(1, a.volume + (vTgt - a.volume) * kA))
        if (vTgt > 0 && a.paused && !a._blocked) tryPlay(a)
        else if (vTgt === 0 && !a.paused && a.volume < 0.004) { a.pause(); a.volume = 0 }
      }
    }

    ctx.clearRect(0, 0, w, h)
    // Overcast: kühle Eintrübung + minimale Abdunklung — macht den Niederschlag
    // glaubhaft; folgt Level und Intensität
    ctx.globalAlpha = fadeA * (0.5 + 0.5 * k)
    ctx.fillStyle = p.wash; ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = p.dark; ctx.fillRect(0, 0, w, h)
    ctx.globalAlpha = 1

    // Böen: zwei überlagerte Frequenzen → unregelmäßiges Reißen statt gleichmäßigem
    // Pendeln. Regenwellen (Schauer-Wogen): der ganze Vorhang wird periodisch
    // dichter/lichter — beim Gewitter deutlich, beim Landregen nur ein Atmen.
    windPhase += dt * (p.flakes ? 0.5 : 0.7)
    const gustN = 0.62 * Math.sin(windPhase) + 0.38 * Math.sin(windPhase * 2.33 + 1.7)
    const wind = (p.wind + p.gust * gustN) * kw()
    sqT += dt * 0.45
    const squall = 1 - p.sqAmp * (0.5 + 0.5 * Math.sin(sqT + 1.1 * Math.sin(sqT * 0.37)))
    swayT += dt

    // Zielmenge: Fläche × Profil-Dichte × Intensität × Level. Nachschub tröpfelt
    // OBERHALB des Bildes ein (Regen „kommt an"), Überschuss verschwindet beim
    // Recycling am unteren Rand — nie ein sichtbarer Schnitt im Bestand.
    const targetN = Math.round(w * h * p.density * k * smooth01(level))
    if (drops.length < targetN) {
      const add = Math.min(targetN - drops.length, Math.max(2, Math.round(targetN * dt / 1.2)))
      for (let i = 0; i < add; i++) drops.push(spawn(p, true))
    }

    // Position fortschreiben (schnelle Tropfen driften stärker im Wind; Flocken taumeln)
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i]
      d.y += d.v * dt
      d.x += wind * dt * (d.v / (p.flakes ? 160 : VREF))
      if (p.flakes) d.x += Math.sin(swayT * d.fq + d.ph) * p.sway * dt
      if (d.y > h + 24 || d.x < -140 || d.x > w + 140 + marginR(p)) {
        if (drops.length > targetN) drops.splice(i, 1) // Ausklingen: raus statt respawnen
        else Object.assign(d, spawn(p, true))
      }
    }
    // Nach Tiefen-Band gebündelt zeichnen
    if (p.flakes) {
      // Weiche Flocken-Sprites statt harter Kreise: echte Flocken sind unscharfe
      // Lichtpunkte (Bewegungs-/Fokusunschärfe), harte Scheiben lasen sich als
      // Konfetti. Ein Sprite (Radial-Verlauf), pro Flocke skaliert gezeichnet.
      if (!flakeSprite) {
        flakeSprite = document.createElement('canvas')
        flakeSprite.width = flakeSprite.height = 48
        const fc = flakeSprite.getContext('2d')
        const g = fc.createRadialGradient(24, 24, 0, 24, 24, 24)
        g.addColorStop(0, 'rgba(244,248,255,1)')
        g.addColorStop(0.38, 'rgba(244,248,255,0.85)')
        g.addColorStop(0.7, 'rgba(240,246,255,0.28)')
        g.addColorStop(1, 'rgba(240,246,255,0)')
        fc.fillStyle = g
        fc.fillRect(0, 0, 48, 48)
      }
      for (let bi = 0; bi < BUCKETS.length; bi++) {
        const bk = BUCKETS[bi]
        ctx.globalAlpha = Math.min(0.95, (bk.a + 0.14) * p.aMul * squall * fadeA)
        for (const d of drops) {
          if (d.b !== bi) continue
          const s = d.r * 4.2 // Sprite deutlich größer als der Kern (weicher Saum)
          ctx.drawImage(flakeSprite, d.x - s / 2, d.y - s / 2, s, s)
        }
      }
      ctx.globalAlpha = 1
    } else {
      // Streak-Neigung = echter Fallvektor (wind/VREF) — das Bild passt zur Drift.
      // Beim Blitz leuchtet der Regen auf (Gegenlicht) — flash hebt das Alpha kurz an.
      const tilt = wind / VREF
      const boost = 1 + flash * 1.5
      for (let bi = 0; bi < BUCKETS.length; bi++) {
        const bk = BUCKETS[bi]
        ctx.strokeStyle = `rgba(202,216,236,${Math.min(0.9, bk.a * p.aMul * squall * fadeA * boost)})`
        ctx.lineWidth = bk.th
        ctx.beginPath()
        for (const d of drops) {
          if (d.b !== bi) continue
          ctx.moveTo(d.x, d.y)
          ctx.lineTo(d.x - tilt * d.len, d.y - d.len)
        }
        ctx.stroke()
      }

    }

    // Gewitter: gelegentliche Blitze — heller Vollbild-Flash, meist mit sichtbarem
    // gezacktem Blitz-Pfad, gelegentlich nur Wetterleuchten (Flash ohne Pfad).
    // Rate folgt der Intensität; während des Einsetzens blitzt es noch nicht.
    if (mode === 'storm' && !reduce && level > 0.55) {
      strikeIn -= dt
      if (strikeIn <= 0) {
        flash = 0.9 + rand() * 0.1
        // gelegentlich ein rasches Nachzucken (Doppelblitz), sonst lange Pause
        const dbl = rand() < 0.4
        strikeIn = dbl ? 0.12 + rand() * 0.1 : (4 + rand() * 8) / (0.45 + 0.55 * k)
        if (!dbl) {
          if (rand() < 0.65) { bolt = makeBolt(); boltLife = 0.4 }
          // Donner folgt dem Blitz mit Verzögerung (Entfernung); ein Donner je Einschlag
          setTimeout(thunder, 200 + rand() * 1100)
        }
      }
      if (boltLife > 0 && bolt) { drawBolt(boltLife / 0.4); boltLife -= dt }
      if (flash > 0) {
        ctx.fillStyle = `rgba(212,226,255,${flash * flash * 0.55})`
        ctx.fillRect(0, 0, w, h)
        flash -= dt * 3.2
      }
    } else if (flash > 0) flash = Math.max(0, flash - dt * 3.2)
  }

  // Vollständiger Stopp NACH dem Ausklingen (setMode('off') lässt den Bestand erst
  // leerregnen; hier wird wirklich aufgeräumt)
  const shutdown = () => {
    ctx.clearRect(0, 0, w, h)
    drops = []; bolt = null; boltLife = 0; flash = 0
    pAct = null; level = 0
    for (const key of LOOPS) { const a = sounds[key]; if (a && !a.paused) { a.pause(); a.volume = 0 } }
    loopAct = null
    if (raf) cancelAnimationFrame(raf)
    raf = null
  }

  const frame = (now) => {
    if (!pAct) { raf = null; return }
    // Pause-Gate: solange die Szene steht, steht auch das Wetter — letztes Bild
    // bleibt eingefroren stehen, die Loops verstummen; Wiedergabe taut alles auf.
    const animating = gate ? !!gate() : true
    if (!animating && !frozen) { frozen = true; freezeAudio() }
    else if (animating && frozen) { frozen = false; lastT = 0 } // Audio raut in step() wieder an (Level-Kopplung)
    if (frozen) { raf = requestAnimationFrame(frame); return }
    if (!lastT) lastT = now
    let dt = (now - lastT) / 1000
    lastT = now
    // Echte Zeit begrenzt NACHHOLEN statt verwerfen: rAF läuft gedrosselt (Hintergrund-
    // Tab, headless) mit Frame-Abständen um 1 s — würde dt dann auf 0.016 gekappt,
    // kröchen Einsetz-Level, Böen und Blitz-Takt 60× zu langsam. Bis 0,5 s springen
    // die Partikel einfach weiter (Recycling fängt sie), nur echte Ausreißer kappen.
    if (!(dt > 0)) dt = 0.016
    else if (dt > 0.5) dt = 0.5
    step(dt)
    raf = requestAnimationFrame(frame)
  }

  const setMode = (m) => {
    if (!['clouds', 'fog', 'rain', 'snow', 'storm'].includes(m)) m = 'off'
    if (m === mode) return
    mode = m
    const p = PROFILES[mode]
    if (!p) {
      // off/wolkig/nebel: Ziel-Level 0 — der Niederschlag klingt in der Schleife
      // langsam aus, der Sound verklingt mit ihm (Level-Kopplung in step();
      // loopAct bleibt dafür stehen). Im eingefrorenen Zustand kann nichts
      // ausklingen → Standbild sofort räumen.
      if (frozen) shutdown()
      return
    }
    initSounds()
    loopAct = LOOP_FOR[mode] // step() blendet den neuen Loop ein, die alten aus
    // Kein Hard-Rebuild beim Moduswechsel: Bestand recycelt Tropfen für Tropfen in
    // die neuen Parameter (Regen→Gewitter wird von selbst dichter/schneller).
    pAct = p
    flash = 0; boltLife = 0; strikeIn = 1.5 + rand() * 3
    if (!raf) { lastT = 0; raf = requestAnimationFrame(frame) }
  }

  // Intensität 0..1 (UI: Leicht/Mittel/Stark; API bewusst stufenlos — späteres
  // Echtwetter kann beliebige Stärken liefern). Wirkt live: Neuspawns übernehmen
  // Tempo/Größe, Zielmenge/Wind/Alpha/Sound ziehen sofort nach.
  const setIntensity = (v) => {
    k = Math.max(0.15, Math.min(1, +v || 0.7))
    // Lautstärke zieht über die Level-Kopplung in step() von selbst nach
  }

  resize()
  window.addEventListener('resize', resize)
  // Autoplay-Policy: war das Audio beim Auto-Restore blockiert, nach der ersten
  // User-Geste den laufenden Loop nachstarten.
  window.addEventListener('pointerdown', () => {
    if (frozen || !loopAct) return
    const a = sounds[loopAct]
    if (a) { a._blocked = false; if (a.paused && pAct) tryPlay(a) } // Lautstärke hebt step() (Level-Kopplung)
  }, { passive: true })

  return { setMode, setIntensity, setGate: (fn) => { gate = fn }, get mode() { return mode }, get intensity() { return k } }
}
